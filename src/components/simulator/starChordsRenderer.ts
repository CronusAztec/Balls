import { SC_CHORD_CEILING, type StarChordsView } from "@/lib/physics/modes/starChords";
import { envelopeRadius, vertexAngle } from "@/lib/physics/starChords";

/*
 * --- chord-stars --- Chord Stars on the canvas (the mode: lib/physics/modes/starChords.ts). In world space, under the balls: the
 * thin circle, the inner circles every star's chords touch (always, never, or appearing as the star closes), the chords drawn so
 * far – kept in an offscreen layer that only ever adds the chords completed since the last frame and starts over with every
 * cycle –, the chord each ball is drawing now (from its last vertex to the ball) and a glint where it last bounced; then the
 * balls with a small glow, and the flash when every star closes. The drawing holds through the hold and fades out over the fade,
 * so the last frame of a cycle is the empty circle the next one starts from (a seamless loop). The title, the subtitle and the
 * "stars closed 3/5" counter are the loop HUD's (lib/loop/hud.ts), drawn into every export frame by the compositor.
 *
 * Everything is read from the view, the run's state on the simulation clock, so the fast export's offline canvas – a frame at
 * its own rate – draws the same picture. The layer strokes every chord on its own (a crossing blends the same whatever frame a
 * chord came in); a frame with more than SC_FRAME_CHORDS new chords (a star of a million points) draws the newest of them, and
 * past SC_CHORD_CEILING chords in a cycle the layer fades the oldest by half every quarter of the ceiling – nothing is stored
 * per chord, so the work stays bounded whatever the stars.
 */

/** The look's knobs the canvas hands over every frame. */
export interface StarChordsRenderOptions {
  /** Device px per world px (the layer's raster scale). */
  dpr: number;
  /** The page's wall colour (with an alpha; by angle for rainbow walls) – the circle's. */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  rainbow: boolean;
  wallThickness: number;
  /** A bigger glow round the balls (the page's Ball Glow); a small one is always there. */
  showGlow: boolean;
  /** The glints where the balls bounce (the page's Wall Glow). */
  showWallGlow: boolean;
}

/** The canvas' data-sc-* attributes (the smoke test and tools read the run there). */
export const STAR_CHORDS_DATA_KEYS = ["scBalls", "scCycles", "scPhase", "scClosed", "scChords", "scCycleChords", "scLastCycleChords", "scTotalChords", "scClosings", "scStars", "scEnvelope", "scPeriod", "scLayerChords", "scFaded"] as const;

/** Chords the layer draws in one frame at most (the newest of them when a frame brings more). */
export const SC_FRAME_CHORDS = 20_000;
/** Above this many new chords a frame, a ball's are stroked as one path (a crossing inside it no longer blends twice). */
const PER_CHORD_LIMIT = 512;
const CHORD_ALPHA = 0.82;
/** Seconds a bounce's glint, the closing flash and an inner circle's appearance take. */
const GLINT_SEC = 0.28;
const FLASH_SEC = 0.75;
const ENVELOPE_IN_SEC = 0.35;
/** The layer's fade past the ceiling: every quarter of it, the chords so far at half their strength. */
const FADE_EVERY = SC_CHORD_CEILING / 4;

/** Ease in-out (sine): the fade of the drawing. */
function ease(p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

export class StarChordsLayer {
  private layer: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  /** What the layer was painted for: the run, the raster, the circle, the line, the colours. */
  private gen = -1;
  private size = 0;
  private dpr = 0;
  private half = 0;
  private cx = 0;
  private cy = 0;
  private chordRadius = 0;
  private lineWidth = 0;
  private colorVersion = -1;
  private cycle = -1;
  /** Per ball: the chords already on the layer this cycle. */
  private drawn = new Float64Array(0);
  /** Chords on the layer this cycle, and the fades the ceiling made. */
  layerChords = 0;
  faded = 0;
  private readonly glowSprites = new Map<string, HTMLCanvasElement>();

  /** World space, under the balls: the circle, the inner circles, the chords (faded with the loop), the chords being drawn, the glints. */
  drawStage(ctx: CanvasRenderingContext2D, view: StarChordsView, o: StarChordsRenderOptions) {
    const f = view.field;
    const alpha = view.phase === "fade" ? 1 - ease(view.phaseProgress) : 1;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 0;
    this.drawCircle(ctx, view, o);
    if (view.envelope !== "off") this.drawEnvelopes(ctx, view, alpha);
    this.paintLayer(view, o.dpr);
    if (this.layer && this.size > 0 && alpha > 0.002) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.layer, f.cx - this.half, f.cy - this.half, 2 * this.half, 2 * this.half);
      ctx.globalAlpha = 1;
    }
    if (view.phase === "draw") this.drawCurrentChords(ctx, view);
    if (o.showWallGlow) this.drawGlints(ctx, view);
    ctx.restore();
  }

  /** The balls: a small glow (a bigger one with Ball Glow on) and the disc, in their colours. */
  drawBodies(ctx: CanvasRenderingContext2D, view: StarChordsView, o: StarChordsRenderOptions) {
    const r = view.field.ballRadius;
    const glowR = (o.showGlow ? 3.2 : 2.2) * r;
    ctx.save();
    ctx.shadowBlur = 0;
    for (let i = 0; i < view.count; i++) {
      const color = view.colors[i] ?? "#ffffff";
      const x = view.x[i];
      const y = view.y[i];
      ctx.globalAlpha = o.showGlow ? 0.85 : 0.6;
      ctx.drawImage(this.glowSprite(color), x - glowR, y - glowR, 2 * glowR, 2 * glowR);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The closing flash: a soft light from the centre over the circle as every star closes together. */
  drawFlash(ctx: CanvasRenderingContext2D, view: StarChordsView) {
    if (view.lastAllClosedSec < 0) return;
    const age = view.timeSec - view.lastAllClosedSec;
    if (age < 0 || age >= FLASH_SEC) return;
    const f = view.field;
    const k = 1 - age / FLASH_SEC;
    const grad = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, 1.08 * f.radius);
    grad.addColorStop(0, `rgba(255, 255, 255, ${(0.3 * k * k).toFixed(3)})`);
    grad.addColorStop(0.6, `rgba(200, 190, 255, ${(0.12 * k * k).toFixed(3)})`);
    grad.addColorStop(1, "rgba(200, 190, 255, 0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(f.cx, f.cy, 1.08 * f.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  /** The thin circle (the page's wall colour; by angle with rainbow walls), brighter for a moment as the stars close. */
  private drawCircle(ctx: CanvasRenderingContext2D, view: StarChordsView, o: StarChordsRenderOptions) {
    const f = view.field;
    const age = view.lastAllClosedSec >= 0 ? view.timeSec - view.lastAllClosedSec : Infinity;
    const lit = age >= 0 && age < FLASH_SEC ? 1 - age / FLASH_SEC : 0;
    ctx.lineWidth = Math.max(1, 0.75 * o.wallThickness) * (1 + 0.6 * lit);
    if (o.rainbow) {
      const segments = 72;
      for (let s = 0; s < segments; s++) {
        const a0 = (2 * Math.PI * s) / segments;
        const a1 = (2 * Math.PI * (s + 1)) / segments + 0.004;
        ctx.strokeStyle = o.wallColor(0, undefined, a0);
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, f.radius, a0, a1);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = o.wallColor(0);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, f.radius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** The inner circles: faint all the time ("on"), or appearing – brighter, with a soft halo – as each star closes ("closed"). */
  private drawEnvelopes(ctx: CanvasRenderingContext2D, view: StarChordsView, alpha: number) {
    const f = view.field;
    const halo = view.count <= 24;
    for (let i = 0; i < view.count; i++) {
      let a: number;
      if (view.envelope === "on") a = 0.32;
      else {
        const at = view.closedAt[i];
        if (at < 0) continue;
        a = 0.95 * Math.min(1, Math.max(0, (view.cycleTime - at) / ENVELOPE_IN_SEC));
      }
      a *= alpha;
      if (a <= 0.004) continue;
      const r = envelopeRadius(f.chordRadius, view.stars[i]);
      if (!(r > 0.5)) continue;
      ctx.strokeStyle = view.colors[i] ?? "#ffffff";
      if (halo && view.envelope === "closed") {
        ctx.globalAlpha = 0.22 * a;
        ctx.lineWidth = 4 * Math.max(1, view.lineWidth);
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(0.75, (view.envelope === "closed" ? 1.3 : 0.8) * view.lineWidth);
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** The chord every ball is drawing: from its last vertex to the ball (committed to the layer when the ball gets there). */
  private drawCurrentChords(ctx: CanvasRenderingContext2D, view: StarChordsView) {
    const f = view.field;
    ctx.globalAlpha = CHORD_ALPHA;
    ctx.lineWidth = view.lineWidth;
    for (let i = 0; i < view.count; i++) {
      const s = view.stars[i];
      const b = view.bounces[i];
      if (b >= s.n) continue;
      const a = vertexAngle(view.theta0[i], b, s);
      ctx.strokeStyle = view.colors[i] ?? "#ffffff";
      ctx.beginPath();
      ctx.moveTo(f.cx + f.chordRadius * Math.cos(a), f.cy + f.chordRadius * Math.sin(a));
      ctx.lineTo(view.x[i], view.y[i]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A short glint where each ball last bounced (and, as the stars close, at every start point). */
  private drawGlints(ctx: CanvasRenderingContext2D, view: StarChordsView) {
    const f = view.field;
    const T = view.cycleSec;
    for (let i = 0; i < view.count; i++) {
      const s = view.stars[i];
      const b = view.bounces[i];
      if (b <= 0) continue;
      const at = b >= s.n ? T : (b * T) / s.n;
      const age = view.cycleTime - at;
      if (age < 0 || age >= GLINT_SEC) continue;
      const k = 1 - age / GLINT_SEC;
      const a = vertexAngle(view.theta0[i], b, s);
      const x = f.cx + f.chordRadius * Math.cos(a);
      const y = f.cy + f.chordRadius * Math.sin(a);
      ctx.globalAlpha = 0.65 * k;
      ctx.fillStyle = view.colors[i] ?? "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, f.ballRadius * (1 + 1.6 * (1 - k)), 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Keeps the offscreen layer in step with the view: started over with a new run, raster, circle, line width or colours (the
   * chords of the cycle so far redrawn) and with every new cycle (empty); otherwise only the chords completed since the last frame.
   */
  private paintLayer(view: StarChordsView, dpr: number) {
    if (typeof document === "undefined") return;
    const f = view.field;
    const half = f.radius + 4 + 2 * view.lineWidth;
    const size = Math.max(1, Math.ceil(2 * half * dpr));
    const fresh = view.generation !== this.gen || size !== this.size || dpr !== this.dpr || f.cx !== this.cx || f.cy !== this.cy || f.chordRadius !== this.chordRadius || view.lineWidth !== this.lineWidth || view.colorVersion !== this.colorVersion || view.count !== this.drawn.length;
    if (fresh || !this.layer || !this.g) {
      if (!this.layer) this.layer = document.createElement("canvas");
      if (this.layer.width !== size) this.layer.width = size;
      if (this.layer.height !== size) this.layer.height = size;
      this.g = this.layer.getContext("2d");
      this.gen = view.generation;
      this.size = size;
      this.dpr = dpr;
      this.half = half;
      this.cx = f.cx;
      this.cy = f.cy;
      this.chordRadius = f.chordRadius;
      this.lineWidth = view.lineWidth;
      this.colorVersion = view.colorVersion;
      if (this.drawn.length !== view.count) this.drawn = new Float64Array(view.count);
      this.cycle = -1;
    }
    const g = this.g;
    if (!g) return;
    if (view.cycleIndex !== this.cycle) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, size, size);
      this.drawn.fill(0);
      this.cycle = view.cycleIndex;
      this.layerChords = 0;
      this.faded = 0;
    }
    // world px onto the layer's device px (the circle's centre in its middle)
    g.setTransform(dpr, 0, 0, dpr, (half - f.cx) * dpr, (half - f.cy) * dpr);
    let pending = 0;
    for (let i = 0; i < view.count; i++) pending += Math.max(0, view.bounces[i] - this.drawn[i]);
    if (pending <= 0) return;
    // past the ceiling the oldest fade: the layer at half strength every FADE_EVERY chords
    const before = Math.max(0, this.layerChords - SC_CHORD_CEILING);
    const after = Math.max(0, this.layerChords + pending - SC_CHORD_CEILING);
    const fades = Math.floor(after / FADE_EVERY) - Math.floor(before / FADE_EVERY) + (before === 0 && after > 0 ? 1 : 0);
    for (let k = 0; k < fades; k++) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "rgba(0, 0, 0, 0.5)";
      g.fillRect(0, 0, size, size);
      g.restore();
      this.faded++;
    }
    const share = pending > SC_FRAME_CHORDS ? SC_FRAME_CHORDS / pending : 1;
    const perChord = pending <= PER_CHORD_LIMIT;
    g.globalAlpha = CHORD_ALPHA;
    g.lineWidth = view.lineWidth;
    g.lineCap = "round";
    g.lineJoin = "round";
    const r = f.chordRadius;
    for (let i = 0; i < view.count; i++) {
      const target = view.bounces[i];
      const waiting = target - this.drawn[i];
      if (waiting <= 0) continue;
      const s = view.stars[i];
      const from = share < 1 ? Math.max(this.drawn[i], target - Math.ceil(waiting * share)) : this.drawn[i];
      g.strokeStyle = view.colors[i] ?? "#ffffff";
      let a = vertexAngle(view.theta0[i], from, s);
      let x = f.cx + r * Math.cos(a);
      let y = f.cy + r * Math.sin(a);
      if (!perChord) {
        g.beginPath();
        g.moveTo(x, y);
      }
      for (let j = from + 1; j <= target; j++) {
        a = vertexAngle(view.theta0[i], j, s);
        const nx = f.cx + r * Math.cos(a);
        const ny = f.cy + r * Math.sin(a);
        if (perChord) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(nx, ny);
          g.stroke();
        } else g.lineTo(nx, ny);
        x = nx;
        y = ny;
      }
      if (!perChord) g.stroke();
      this.drawn[i] = target;
    }
    g.globalAlpha = 1;
    this.layerChords += pending;
  }

  /** A soft round glow in `color` (one sprite per colour, scaled to any size). */
  private glowSprite(color: string): HTMLCanvasElement {
    let sprite = this.glowSprites.get(color);
    if (sprite) return sprite;
    const size = 64;
    sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const g = sprite.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, color);
      grad.addColorStop(0.35, color);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.globalAlpha = 0.5;
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    if (this.glowSprites.size > 256) this.glowSprites.clear();
    this.glowSprites.set(color, sprite);
    return sprite;
  }
}

/** Mirrors the run onto the canvas (data-sc-*): the balls, the cycles, the phase, the stars closed, the chords, the layer. */
export function writeStarChordsDataset(view: StarChordsView, layer: StarChordsLayer, set: (key: string, value: string) => void) {
  set("scBalls", String(view.count));
  set("scCycles", String(view.cycles));
  set("scPhase", view.phase);
  set("scClosed", String(view.closed));
  set("scChords", String(view.chordsThisCycle));
  set("scCycleChords", String(view.chordsPerCycle));
  set("scLastCycleChords", String(view.lastCycleChords));
  set("scTotalChords", String(view.totalChords));
  set("scClosings", String(view.closings));
  set("scStars", view.starsText);
  set("scEnvelope", view.envelope);
  set("scPeriod", view.periodSec.toFixed(3));
  set("scLayerChords", String(layer.layerChords));
  set("scFaded", String(layer.faded));
}
