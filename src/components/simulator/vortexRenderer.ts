import { MAX_SPLASHES, SLOT_FLYING, depthRadiusScale, vortexDepth, type VortexView } from "@/lib/physics/modes/vortex";

/**
 * Canvas drawing of the Sound Vortex (feature gerald-vortex, lib/physics/modes/vortex.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls – the funnel's depth gradient, the whirlpool arms (logarithmic spirals turning with the
 * balls, their dashes flowing inward), the sound rings (cool at the rim, hot by the hole with the rainbow walls on, else
 * the wall colour; a ring lights up and glows when a ball sinks past it), the rim and the hole; the balls themselves are
 * the canvas' ordinary balls (faces, emoji, trails, glow – the mode shrinks them with depth); `drawEffects()` over them –
 * the darkening throat of the depth cue, a note pulse around a ball that just played a ring and the splash of a swallowed
 * ball (a ripple and droplets in its colour); and `drawOverlay()` in screen space – the swallowed counter at the top of
 * the square the recorder crops to. Everything animates on the simulation clock (`view.timeMs`), so a pause freezes it and
 * a recording replays it; nothing is allocated per frame but a couple of gradients (cached while the funnel stays put).
 */

export interface VortexRenderOptions {
  /** The wall colour with an alpha (the rings and the rim without the rainbow walls). */
  wallAlpha: (alpha: number) => string;
  /** Rainbow walls on: the rings run from cyan at the rim to magenta by the hole. */
  rainbow: boolean;
  wallThickness: number;
  showWallGlow: boolean;
  /** The Ball Size (px) – the note pulse around a ball is sized from it. */
  ballRadius: number;
}

export interface VortexLabels {
  /** The HUD's title. */
  title: string;
  /** "3 / 12 swallowed" */
  swallowed: (n: number, total: number) => string;
  /** With the loop on: "17 × PEW". */
  pews: (n: number) => string;
  /** The banner when every ball is gone, and its line (balls, notes). */
  done: string;
  doneSub: (balls: number, notes: number) => string;
}

export const DEFAULT_VORTEX_LABELS: VortexLabels = {
  title: "SOUND VORTEX",
  swallowed: (n, total) => `${n} / ${total} swallowed`,
  pews: (n) => `${n} × PEW`,
  done: "PEW!",
  doneSub: (balls, notes) => `${balls} ball${balls !== 1 ? "s" : ""} swallowed · ${notes} notes`,
};

/** How long (ms of simulation time) a ring glows after a ball sank past it, a note pulse and a splash last. */
export const RING_FLASH_MS = 380;
export const NOTE_PULSE_MS = 260;
export const SPLASH_MS = 900;
/** Whirlpool arms, how many turns each makes from the rim to the hole, and how fast (rad/s) the pattern turns. */
const ARMS = 4;
const ARM_TURNS = 1.75;
const ARM_POINTS = 72;
const ARM_SPIN = 0.35;
const DROPLETS = 10;
const TWO_PI = Math.PI * 2;

/** Hue of ring `i` of `n` with the rainbow walls: cyan at the rim to magenta by the hole. */
export function ringHue(i: number, n: number): number {
  return Math.round(185 + (n > 1 ? i / (n - 1) : 0) * 135) % 360;
}

/** Smooth 0 → 1 over t ∈ [0, 1] (ease-out). */
function easeOut(t: number) {
  const u = Math.max(0, Math.min(1, t));
  return 1 - (1 - u) * (1 - u);
}

/** A tiny deterministic hash of a splash number → an angle offset, so every splash looks a little different. */
function splashTurn(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * TWO_PI;
}

export class VortexLayer {
  private bgKey = "";
  private bg: CanvasGradient | null = null;
  private throatKey = "";
  private throat: CanvasGradient | null = null;
  private readonly dash = [0, 0];
  private readonly noDash: number[] = [];
  /** hsla() strings by a numeric key (hue, lightness, alpha in hundredths), so a frame builds no strings once they are cached. */
  private readonly colorCache = new Map<number, string>();

  private hsla(h: number, l: number, a: number) {
    const alpha = Math.max(0, Math.min(100, Math.round(100 * a)));
    const key = (Math.round(h) * 101 + Math.round(l)) * 101 + alpha;
    let c = this.colorCache.get(key);
    if (!c) {
      if (this.colorCache.size > 2000) this.colorCache.clear();
      c = `hsla(${Math.round(h)}, 92%, ${Math.round(l)}%, ${(alpha / 100).toFixed(2)})`;
      this.colorCache.set(key, c);
    }
    return c;
  }

  /** Colour of ring `i` at alpha `a`. */
  private ringColor(view: VortexView, i: number, a: number, opts: VortexRenderOptions) {
    return opts.rainbow ? this.hsla(ringHue(i, view.field.ringCount), 62, a) : opts.wallAlpha(a);
  }

  /** The funnel, the whirlpool arms, the rings, the rim and the hole (under the balls). */
  drawWorld(ctx: CanvasRenderingContext2D, view: VortexView, opts: VortexRenderOptions) {
    const f = view.field;
    if (!(f.rim > 0)) return;
    const { cx, cy, rim, hole } = f;
    const t = view.timeMs / 1000;
    ctx.save();
    ctx.globalAlpha = 1;
    // The funnel: lighter at the rim, black in the throat.
    const bgKey = `${cx}|${cy}|${rim}`;
    if (bgKey !== this.bgKey || !this.bg) {
      const g = ctx.createRadialGradient(cx, cy, hole, cx, cy, rim);
      g.addColorStop(0, "rgba(0, 0, 0, 0.95)");
      g.addColorStop(0.35, "rgba(8, 18, 36, 0.8)");
      g.addColorStop(1, "rgba(24, 48, 82, 0.55)");
      this.bg = g;
      this.bgKey = bgKey;
    }
    ctx.fillStyle = this.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, rim, 0, TWO_PI);
    ctx.fill();

    // The whirlpool arms: logarithmic spirals from the rim to the hole, turning with the balls, dashes flowing inward.
    const turn = view.dir * ARM_SPIN * t;
    const span = ARM_TURNS * TWO_PI * view.dir;
    const ratio = hole / rim;
    ctx.lineCap = "round";
    this.dash[0] = Math.max(6, 0.03 * rim);
    this.dash[1] = Math.max(8, 0.045 * rim);
    ctx.setLineDash(this.dash);
    ctx.lineDashOffset = -t * 0.12 * rim;
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass === 0 ? Math.max(4, 0.02 * rim) : Math.max(1.2, 0.006 * rim);
      ctx.strokeStyle = opts.rainbow ? this.hsla(pass === 0 ? 200 : 190, 60, pass === 0 ? 0.07 : 0.28) : opts.wallAlpha(pass === 0 ? 0.06 : 0.22);
      ctx.beginPath();
      for (let a = 0; a < ARMS; a++) {
        const base = turn + (a * TWO_PI) / ARMS;
        for (let i = 0; i <= ARM_POINTS; i++) {
          const u = i / ARM_POINTS;
          const r = rim * Math.pow(ratio, u);
          const th = base + span * u;
          const x = cx + r * Math.cos(th);
          const y = cy + r * Math.sin(th);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash(this.noDash);

    // The sound rings, glowing for a moment after a ball sank past.
    const baseWidth = Math.max(1, opts.wallThickness);
    for (let i = 0; i < f.ringCount; i++) {
      const r = f.rings[i];
      const age = view.timeMs - view.ringHitMs[i];
      const flash = age >= 0 && age < RING_FLASH_MS ? 1 - age / RING_FLASH_MS : 0;
      if (flash > 0 && opts.showWallGlow) {
        ctx.lineWidth = baseWidth * (3 + 4 * flash);
        ctx.strokeStyle = this.ringColor(view, i, 0.18 * flash, opts);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.lineWidth = baseWidth * (1 + flash);
      ctx.strokeStyle = this.ringColor(view, i, 0.3 + 0.7 * flash, opts);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.stroke();
    }

    // The rim.
    ctx.lineWidth = baseWidth + 2;
    ctx.strokeStyle = opts.rainbow ? this.hsla(ringHue(0, f.ringCount), 60, 0.9) : opts.wallAlpha(0.9);
    ctx.beginPath();
    ctx.arc(cx, cy, rim, 0, TWO_PI);
    ctx.stroke();

    // The hole: black, with a lime lip that pulses when it swallows a ball.
    const since = view.timeMs - view.lastSwallowMs;
    const pulse = since >= 0 && since < 500 ? 1 - since / 500 : 0;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(cx, cy, hole, 0, TWO_PI);
    ctx.fill();
    ctx.lineWidth = Math.max(2, 0.012 * rim) * (1 + 1.5 * pulse);
    ctx.strokeStyle = `rgba(147, 209, 25, ${(0.55 + 0.45 * pulse).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, hole + 0.5 * ctx.lineWidth, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  /** Over the balls: the darkening throat (depth cue), the note pulses and the splashes. */
  drawEffects(ctx: CanvasRenderingContext2D, view: VortexView, opts: VortexRenderOptions) {
    const f = view.field;
    if (!(f.rim > 0)) return;
    const { cx, cy, rim, hole } = f;
    const now = view.timeMs;
    ctx.save();
    ctx.globalAlpha = 1;
    // The throat: the deeper, the darker (a 3-D-ish funnel).
    const depth = view.settings.depthScale;
    if (depth > 0) {
      const key = `${cx}|${cy}|${rim}|${depth}`;
      if (key !== this.throatKey || !this.throat) {
        const g = ctx.createRadialGradient(cx, cy, hole, cx, cy, 0.6 * rim);
        g.addColorStop(0, `rgba(0, 0, 0, ${(0.6 * depth).toFixed(3)})`);
        g.addColorStop(0.45, `rgba(0, 0, 0, ${(0.25 * depth).toFixed(3)})`);
        g.addColorStop(1, "rgba(0, 0, 0, 0)");
        this.throat = g;
        this.throatKey = key;
      }
      ctx.fillStyle = this.throat;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.6 * rim, 0, TWO_PI);
      ctx.fill();
    }
    // A ring of light around a ball that just played its note.
    for (let s = 0; s < view.slotCount; s++) {
      if (view.slotState[s] !== SLOT_FLYING) continue;
      const age = now - view.slotNoteMs[s];
      if (!(age >= 0 && age < NOTE_PULSE_MS)) continue;
      const k = age / NOTE_PULSE_MS;
      const size = opts.ballRadius * depthRadiusScale(vortexDepth(f, view.slotR[s]), view.settings.depthScale);
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.strokeStyle = view.slotColor[s];
      ctx.lineWidth = 1.5 + 1.5 * (1 - k);
      ctx.beginPath();
      ctx.arc(view.slotX[s], view.slotY[s], size * (1.3 + 1.6 * k), 0, TWO_PI);
      ctx.stroke();
    }
    // The splashes of swallowed balls: a ripple out of the hole and droplets in the ball's colour.
    const first = Math.max(0, view.splashCount - MAX_SPLASHES);
    for (let n = first; n < view.splashCount; n++) {
      const k = n % MAX_SPLASHES;
      const age = now - view.splashMs[k];
      if (!(age >= 0 && age < SPLASH_MS)) continue;
      const u = age / SPLASH_MS;
      const e = easeOut(u);
      const color = view.splashColor[k];
      ctx.globalAlpha = 0.7 * (1 - u);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 0.01 * rim) * (1 - 0.7 * u);
      ctx.beginPath();
      ctx.arc(cx, cy, hole + 0.3 * rim * e, 0, TWO_PI);
      ctx.stroke();
      ctx.fillStyle = color;
      const sx = view.splashX[k];
      const sy = view.splashY[k];
      const reach = hole + 0.22 * rim;
      const spin = splashTurn(n);
      const drop = Math.max(1.2, 0.009 * rim) * (1 - 0.8 * u);
      ctx.globalAlpha = 0.9 * (1 - u);
      ctx.beginPath();
      for (let j = 0; j < DROPLETS; j++) {
        const a = spin + (j * TWO_PI) / DROPLETS;
        const d = reach * e * (0.55 + 0.45 * ((j * 7) % DROPLETS) / DROPLETS);
        const x = sx + d * Math.cos(a);
        const y = sy + d * Math.sin(a);
        ctx.moveTo(x + drop, y);
        ctx.arc(x, y, drop, 0, TWO_PI);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Screen space: the title and the swallowed counter in the top-left corner of the square the recorder crops to (the
   * funnel is round, the corners are free); `inset` moves it below the page's buttons over a nearly square canvas.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: VortexView, labels: VortexLabels, inset = 0) {
    const f = view.field;
    if (!(f.size > 0)) return;
    const left = f.cx - f.size / 2 + 0.035 * f.size;
    const top = f.cy - f.size / 2 + 0.03 * f.size + inset;
    const fs = Math.max(11, 0.03 * f.size);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(labels.title, left, top + 0.6 * fs);
    ctx.font = `600 ${(0.8 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#93d119";
    ctx.fillText(view.settings.loop ? labels.pews(view.swallowed) : labels.swallowed(view.swallowed, view.slotCount), left, top + 1.85 * fs);
    ctx.restore();
  }
}

/** The data-vortex-* attributes the canvas mirrors for tools and the smoke test. */
export const VORTEX_DATA_KEYS = ["vortexBalls", "vortexEntered", "vortexSwallowed", "vortexInFlight", "vortexNotes", "vortexChords", "vortexRings", "vortexDeepest", "vortexLoop", "vortexTempo", "vortexDepth", "vortexAllSwallowed", "vortexFinished", "vortexFinishedMs"];

export function writeVortexDataset(view: VortexView, set: (key: string, value: string) => void) {
  set("vortexBalls", String(view.slotCount));
  set("vortexEntered", String(view.entered));
  set("vortexSwallowed", String(view.swallowed));
  set("vortexInFlight", String(view.inFlight));
  set("vortexNotes", String(view.notes));
  set("vortexChords", String(view.chords));
  set("vortexRings", String(view.field.ringCount));
  set("vortexDeepest", String(view.deepestRing));
  set("vortexLoop", view.settings.loop ? "1" : "0");
  set("vortexTempo", view.tempo.toFixed(3));
  set("vortexDepth", String(view.settings.depthScale));
  set("vortexAllSwallowed", view.allSwallowed ? "1" : "0");
  set("vortexFinished", view.finished ? "1" : "0");
  set("vortexFinishedMs", String(Math.round(view.finishedMs)));
}
