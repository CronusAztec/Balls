import { isPhraseStart, type BeatMachineView } from "@/lib/physics/modes/beatMachine";
import { BM_TIME_EPS, marblePosition, marbleState, stairsPosition, type BeatMachinePlan } from "@/lib/simulation/beatMachinePlan";
import { frequencyToMidi } from "@/lib/audio/scales";

/*
 * --- beat-machine --- Beat Machines' picture (lib/physics/modes/beatMachine.ts runs it), drawn in world px under the page's
 * camera from the plan itself at the frame's own simulation time – the plan is a pure function of time, so the balls move
 * smoothly at any playback speed and a trail is the exact flight:
 *
 * - **stairs**: the rounded navy panel with its faint dot grid, the step bars on a mint-to-sky ramp (a step glows when the ball
 *   lands on it), the hook and the grey-teal return track, the cream ball with its glow and a short trail, and the progress dots
 *   under the panel – the step just played lit;
 * - **marbles**: the brass floor, the ladder lift with its rungs moving up, the top rail, the pale tubes with their stacked
 *   marbles and base caps, the rainbow bars (a struck bar brightens, glows and dips 2 px for a moment) and the glossy marbles,
 *   each with a white specular dot and a soft glow in its colour.
 *
 * --- beat-machine-tunes --- The marble machine is drawn to read on a phone: a warm lit stage fills the page's square behind
 * it; the bars are glowing keys BM_KEY_TALL times as tall as the plan's bar (hanging under the bar's top, where the marbles
 * strike, a gloss band on top and a shade at the foot), each with its note's name; the key
 * a marble is about to strike glows for the beat before it (the next note lit: the marbles falling onto their keys and the
 * one waiting at the foot of the next note's tube ringed in white), and a strike rings it – a white flash, a ring
 * spreading from the point of contact, larger on a phrase's accented first beat; the marbles are drawn BM_MARBLE_DRAWN times
 * their plan size, with a comet trail while they fall and bounce. All of it reads the plan at the frame's own time.
 *
 * Nothing is allocated per frame: no gradients (the gloss is two flat circles), the shared scratch points, one path a layer
 * (the keys' names are made once a plan).
 */

/** What the canvas hands the layer each frame. */
export interface BeatMachineRenderOptions {
  /** Device px per world px (hairlines stay a device pixel). */
  dpr: number;
  /** Ball Glow: stronger halos. */
  showGlow: boolean;
}

/** The staircase's colours (the clip's): panel, border, dots, track, ball, progress dots. */
export const BM_STAIRS_LOOK = { panel: "#0f1a28", border: "#1f2c3a", grid: "rgba(255, 255, 255, 0.05)", track: "#2a3b48", ball: "#ffe7a8", ballGlow: "rgba(255, 231, 168, 0.22)", dotOn: "#ffe7a8", dotOff: "rgba(255, 255, 255, 0.16)" } as const;
/** The marble machine's colours: the brass of the floor, rail and lift; the tubes' pale outline. */
export const BM_MARBLES_LOOK = { brass: "#c39a5c", brassDark: "#7a6040", tube: "rgba(255, 240, 220, 0.55)", cap: "rgba(255, 240, 220, 0.75)" } as const;
/** Seconds a struck bar (or a landed step) glows, and the bar's dip (2 px of the 720 px clip, in plan units) and its spring. */
export const BM_GLOW_SEC = 0.3;
export const BM_DIP_UNITS = 2 / 720;
export const BM_DIP_SEC = 0.12;
/** The stairs ball's trail: points, seconds apart. */
export const BM_TRAIL_POINTS = 8;
export const BM_TRAIL_STEP_SEC = 0.018;
/** The dot grid's spacing (units) and the panel's padding round the plan's box. */
export const BM_GRID_UNITS = 0.04;
export const BM_PANEL_PAD = 0.05;
// --- beat-machine-tunes ---
/** The marble machine's stage: the square's warm backdrop and its two lights (behind the keys, behind the tubes). */
export const BM_STAGE_LOOK = { backdrop: "#3b2a1d", light: "#8a603a", spot: "#c08a4f", keyShade: "rgba(0, 0, 0, 0.28)", gloss: "rgba(255, 255, 255, 0.3)", ring: "#ffffff", label: "rgba(255, 255, 255, 0.92)" } as const;
/** A key's drawn height (× the plan's bar), its drawn width (share of the bar pitch: the marbles pass between keys) and the label's size (share of the key's height). */
export const BM_KEY_TALL = 2.5;
export const BM_KEY_W_SHARE = 0.56;
export const BM_KEY_LABEL = 0.36;
/** The marbles' drawn size (× the plan's radius), their trail (points, seconds apart) while they fall and bounce. */
export const BM_MARBLE_DRAWN = 1.15;
export const BM_MARBLE_TRAIL_POINTS = 6;
export const BM_MARBLE_TRAIL_SEC = 0.022;
/** Seconds a strike's ring spreads, its reach (marble radii; an accent's farther), and how long before its note a key is lit. */
export const BM_RING_SEC = 0.42;
export const BM_RING_REACH = 5;
export const BM_ACCENT_REACH = 8;
export const BM_NEXT_BEATS = 1;
/** The note names of the keys (a tune's bars). */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const POINT = { x: 0, y: 0 };
const MARBLE = marbleState();
const TRAIL = marbleState();

/** The latest note time (s) ≤ t of a slot from the view's log, or −1. */
function sinceNote(view: BeatMachineView, slot: number, t: number): number {
  const at = view.lastNoteSec[slot] ?? -1;
  return at >= 0 && at <= t + BM_TIME_EPS ? t - at : Infinity;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export class BeatMachineLayer {
  /** What the last frame drew (data-bm-*): marbles drawn, rungs drawn, bars glowing, the stairs' lit dot. */
  marblesDrawn = 0;
  rungsDrawn = 0;
  glowing = 0;
  litDot = -1;
  /** --- beat-machine-tunes --- The key lit for the next note (−1: none), the last tube with a marble lit (−1: none), strike rings drawn, marbles with a trail. */
  nextKey = -1;
  litMarble = -1;
  rings = 0;
  trails = 0;
  /** The keys' note names, made once a plan. */
  private labelsOf: BeatMachinePlan | null = null;
  private labels: string[] = [];

  private wx(view: BeatMachineView, u: number) {
    const f = view.frame;
    return f.cx + (u - f.ux) * f.scale;
  }
  private wy(view: BeatMachineView, w: number) {
    const f = view.frame;
    return f.cy + (w - f.uy) * f.scale;
  }

  /** The machine – everything under the balls – at simulation time `t` (s). */
  drawStage(ctx: CanvasRenderingContext2D, view: BeatMachineView, t: number, opts: BeatMachineRenderOptions) {
    if (view.plan.stairs) {
      this.rungsDrawn = 0;
      this.marblesDrawn = 0;
      this.drawStairs(ctx, view, view.plan, t, opts);
    } else if (view.plan.marbles) {
      this.litDot = -1;
      this.drawMachine(ctx, view, view.plan, t, opts);
    }
  }

  /** The balls at simulation time `t`: the stairs' ball with its trail, or every marble. */
  drawBodies(ctx: CanvasRenderingContext2D, view: BeatMachineView, t: number, opts: BeatMachineRenderOptions) {
    if (view.plan.stairs) this.drawStairsBall(ctx, view, view.plan, t, opts);
    else if (view.plan.marbles) this.drawMarbles(ctx, view, view.plan, t, opts);
  }

  /* ---------------------------------------------------------------- stairs */

  private drawStairs(ctx: CanvasRenderingContext2D, view: BeatMachineView, plan: BeatMachinePlan, t: number, opts: BeatMachineRenderOptions) {
    const s = plan.stairs!;
    const k = view.frame.scale;
    const b = plan.bbox;
    const px = this.wx(view, b.x0 - BM_PANEL_PAD);
    const py = this.wy(view, b.y0 - BM_PANEL_PAD);
    const pw = (b.x1 - b.x0 + 2 * BM_PANEL_PAD) * k;
    const ph = (b.y1 - b.y0 + 2 * BM_PANEL_PAD) * k;
    ctx.save();
    // the panel and its border
    ctx.beginPath();
    roundRect(ctx, px, py, pw, ph, 0.03 * k);
    ctx.fillStyle = BM_STAIRS_LOOK.panel;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1 / Math.max(1e-6, opts.dpr));
    ctx.strokeStyle = BM_STAIRS_LOOK.border;
    ctx.stroke();
    // the faint dot grid (one path)
    const step = BM_GRID_UNITS * k;
    if (step >= 4) {
      const dot = Math.max(0.8, 0.0025 * k);
      ctx.beginPath();
      for (let y = py + step / 2; y < py + ph; y += step) for (let x = px + step / 2; x < px + pw; x += step) ctx.rect(x - dot / 2, y - dot / 2, dot, dot);
      ctx.fillStyle = BM_STAIRS_LOOK.grid;
      ctx.fill();
    }
    // the return track (1.5 px of the clip), along the ball's path on its outer side
    const T = plan.beatSec;
    if (s.track) {
      const tr = s.track;
      const off = s.radius;
      ctx.beginPath();
      for (let i = 0; i < tr.x.length; i++) {
        const a = Math.max(0, i - 1);
        const c = Math.min(tr.x.length - 1, i + 1);
        let dx = tr.x[c] - tr.x[a];
        let dy = tr.y[c] - tr.y[a];
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        // the outer normal (dy, −dx) of a path that runs down, left, up and over the tipping hook
        const x = this.wx(view, tr.x[i] + dy * off);
        const y = this.wy(view, tr.y[i] - dx * off);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = Math.max(1, (1.5 / 720) * k);
      ctx.strokeStyle = BM_STAIRS_LOOK.track;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    // the hook: a small cup under where the ball drops in
    if (s.hook) {
      ctx.beginPath();
      ctx.arc(this.wx(view, s.hook.x), this.wy(view, s.hook.y), s.radius * 1.45 * k, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = Math.max(1, 0.006 * k);
      ctx.strokeStyle = BM_STAIRS_LOOK.track;
      ctx.stroke();
    }
    // the steps on their ramp; the one just landed on glows
    for (let i = 0; i < s.steps.length; i++) {
      const st = s.steps[i];
      const since = sinceNote(view, i, t);
      const glow = since < BM_GLOW_SEC ? 1 - since / BM_GLOW_SEC : 0;
      const x = this.wx(view, st.x - s.stepW / 2);
      const y = this.wy(view, st.y - s.stepH / 2);
      ctx.beginPath();
      roundRect(ctx, x, y, s.stepW * k, s.stepH * k, (s.stepH * k) / 2);
      ctx.fillStyle = st.color;
      ctx.shadowColor = st.color;
      ctx.shadowBlur = glow > 0 ? (opts.showGlow ? 22 : 14) * glow : 0;
      ctx.globalAlpha = 0.82 + 0.18 * glow;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    // the progress dots under the panel: the step just played lit
    const n = s.steps.length;
    const P = plan.loopSec;
    const tl = t - Math.floor((t + BM_TIME_EPS) / P) * P;
    const lit = Math.min(n - 1, Math.floor((tl + BM_TIME_EPS) / T));
    this.litDot = lit;
    const gap = Math.min(0.03, (pw / k - 0.04) / Math.max(1, n));
    const dotR = Math.max(1.2, Math.min(0.006, gap * 0.28) * k);
    const y = py + ph + 0.045 * k;
    const x0 = px + pw / 2 - ((n - 1) * gap * k) / 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === lit) continue;
      ctx.moveTo(x0 + i * gap * k + dotR, y);
      ctx.arc(x0 + i * gap * k, y, dotR, 0, Math.PI * 2);
    }
    ctx.fillStyle = BM_STAIRS_LOOK.dotOff;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x0 + lit * gap * k, y, dotR * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = BM_STAIRS_LOOK.dotOn;
    ctx.shadowColor = BM_STAIRS_LOOK.dotOn;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
    this.glowing = 0;
    for (let i = 0; i < n; i++) if (sinceNote(view, i, t) < BM_GLOW_SEC) this.glowing++;
  }

  private drawStairsBall(ctx: CanvasRenderingContext2D, view: BeatMachineView, plan: BeatMachinePlan, t: number, opts: BeatMachineRenderOptions) {
    const s = plan.stairs!;
    const k = view.frame.scale;
    const r = s.radius * k;
    ctx.save();
    // the trail: the exact flight a moment back, fading and thinning
    for (let i = BM_TRAIL_POINTS; i >= 1; i--) {
      const at = t - i * BM_TRAIL_STEP_SEC;
      if (at < 0) continue;
      stairsPosition(plan, at, POINT);
      const u = 1 - i / (BM_TRAIL_POINTS + 1);
      ctx.beginPath();
      ctx.arc(this.wx(view, POINT.x), this.wy(view, POINT.y), r * (0.35 + 0.55 * u), 0, Math.PI * 2);
      ctx.fillStyle = BM_STAIRS_LOOK.ball;
      ctx.globalAlpha = 0.22 * u;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    stairsPosition(plan, t, POINT);
    const x = this.wx(view, POINT.x);
    const y = this.wy(view, POINT.y);
    // the glow, the body
    ctx.beginPath();
    ctx.arc(x, y, r * (opts.showGlow ? 2.6 : 2), 0, Math.PI * 2);
    ctx.fillStyle = BM_STAIRS_LOOK.ballGlow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = BM_STAIRS_LOOK.ball;
    ctx.shadowColor = BM_STAIRS_LOOK.ball;
    ctx.shadowBlur = opts.showGlow ? 18 : 10;
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------- marbles */

  private drawMachine(ctx: CanvasRenderingContext2D, view: BeatMachineView, plan: BeatMachinePlan, t: number, opts: BeatMachineRenderOptions) {
    const m = plan.marbles!;
    const k = view.frame.scale;
    const r = m.radius;
    const hair = Math.max(1, 1 / Math.max(1e-6, opts.dpr));
    ctx.save();
    // --- beat-machine-tunes --- the stage: the square's warm backdrop, a light behind the keys and a spot behind the tubes
    const side = view.frame.side > 0 ? view.frame.side : 0;
    if (side > 0) {
      ctx.fillStyle = BM_STAGE_LOOK.backdrop;
      ctx.fillRect(view.frame.cx - side / 2, view.frame.cy - side / 2, side, side);
      const keysY = this.wy(view, m.bars[0]?.top ?? 0);
      const midX = this.wx(view, ((m.bars[0]?.x ?? 0) + (m.bars[m.bars.length - 1]?.x ?? 0)) / 2);
      ctx.fillStyle = BM_STAGE_LOOK.light;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(midX, keysY, side * 0.5, side * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BM_STAGE_LOOK.spot;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.ellipse(midX, this.wy(view, m.tubes[0]?.exitY ?? 0), side * 0.32, side * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // the floor
    ctx.beginPath();
    roundRect(ctx, this.wx(view, m.floorLeft), this.wy(view, m.floorY), (m.floorRight - m.floorLeft) * k, 0.014 * k, 0.005 * k);
    ctx.fillStyle = BM_MARBLES_LOOK.brass;
    ctx.fill();
    // the lift: two rails and the rungs moving up (one passes the foot every rungSec, from t = 0)
    const railHalf = 1.7 * r;
    const liftL = this.wx(view, m.liftX - railHalf);
    const liftR = this.wx(view, m.liftX + railHalf);
    const footY = m.floorBallY + r;
    const topY = m.railY - r;
    ctx.beginPath();
    ctx.moveTo(liftL, this.wy(view, m.floorY));
    ctx.lineTo(liftL, this.wy(view, topY));
    ctx.moveTo(liftR, this.wy(view, m.floorY));
    ctx.lineTo(liftR, this.wy(view, topY));
    ctx.lineWidth = Math.max(hair, 0.005 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.brass;
    ctx.stroke();
    const height = footY - (m.railY + r);
    const first = Math.ceil((t - height / m.liftSpeed) / m.rungSec - 1e-9);
    const last = Math.floor(t / m.rungSec + 1e-9);
    ctx.beginPath();
    let rungs = 0;
    for (let i = Math.max(first, last - 400); i <= last; i++) {
      const y = footY - (t - i * m.rungSec) * m.liftSpeed;
      if (y < m.railY + r - 1e-9 || y > footY + 1e-9) continue;
      const wy = this.wy(view, y);
      ctx.moveTo(liftL, wy);
      ctx.lineTo(liftR, wy);
      rungs++;
    }
    ctx.lineWidth = Math.max(hair, 0.0035 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.brassDark;
    ctx.stroke();
    this.rungsDrawn = rungs;
    // the top rail, under the marbles rolling back
    ctx.beginPath();
    ctx.moveTo(this.wx(view, m.liftX + railHalf), this.wy(view, m.railY + r));
    ctx.lineTo(this.wx(view, m.railLeft - r), this.wy(view, m.railY + r));
    ctx.lineWidth = Math.max(hair, 0.006 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.brass;
    ctx.lineCap = "round";
    ctx.stroke();
    // the tubes: pale glass outlines with a base cap
    const half = r + 0.003;
    ctx.beginPath();
    for (const tube of m.tubes) {
      const l = this.wx(view, tube.x - half);
      const rr = this.wx(view, tube.x + half);
      const top = this.wy(view, tube.topY);
      const bottom = this.wy(view, tube.exitY + r);
      ctx.moveTo(l, top);
      ctx.lineTo(l, bottom);
      ctx.moveTo(rr, top);
      ctx.lineTo(rr, bottom);
    }
    ctx.lineWidth = Math.max(hair, 0.0025 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.tube;
    ctx.stroke();
    ctx.beginPath();
    for (const tube of m.tubes) {
      const y = this.wy(view, tube.exitY + r + 0.002);
      ctx.moveTo(this.wx(view, tube.x - half - 0.003), y);
      ctx.lineTo(this.wx(view, tube.x + half + 0.003), y);
    }
    ctx.lineWidth = Math.max(hair, 0.004 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.cap;
    ctx.stroke();
    // --- beat-machine-tunes --- the next note's key, lit for the beat before its strike
    const P = plan.loopSec;
    const tl = P > 0 ? t - Math.floor((t + BM_TIME_EPS) / P) * P : 0;
    const next = nextNoteAfter(plan, tl);
    this.nextKey = next && next.wait <= BM_NEXT_BEATS * plan.beatSec ? next.slot : -1;
    // the keys: tall glowing bars hanging under the bar's top (where the marbles strike); a struck key flashes and rings
    const keyH = BM_KEY_TALL * m.barH;
    const keyW = Math.min(m.barW, BM_KEY_W_SHARE * m.pitch);
    const labels = this.keyLabels(plan);
    let glowing = 0;
    let rings = 0;
    for (let b = 0; b < m.bars.length; b++) {
      const bar = m.bars[b];
      const since = sinceNote(view, b, t);
      const glow = since < BM_GLOW_SEC ? 1 - since / BM_GLOW_SEC : 0;
      const dip = since < BM_DIP_SEC ? BM_DIP_UNITS * Math.sin((Math.PI * since) / BM_DIP_SEC) : 0;
      if (glow > 0) glowing++;
      const x = this.wx(view, bar.x - keyW / 2);
      const y = this.wy(view, bar.top + dip);
      const w = keyW * k;
      const h = keyH * k;
      const lit = b === this.nextKey && glow === 0;
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, 0.18 * w);
      ctx.fillStyle = bar.color;
      ctx.shadowColor = bar.color;
      ctx.shadowBlur = glow > 0 ? (opts.showGlow ? 30 : 20) * glow : lit ? 12 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      // the gloss band on top and the shade at the foot
      ctx.save();
      ctx.clip();
      ctx.fillStyle = BM_STAGE_LOOK.gloss;
      ctx.fillRect(x, y, w, 0.22 * h);
      ctx.fillStyle = BM_STAGE_LOOK.keyShade;
      ctx.fillRect(x, y + 0.78 * h, w, 0.22 * h);
      if (glow > 0 || lit) {
        ctx.globalAlpha = glow > 0 ? 0.55 * glow : 0.18;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      if (labels.length > b && h > 14) {
        ctx.fillStyle = BM_STAGE_LOOK.label;
        ctx.font = `bold ${Math.round(Math.min(w * 0.62, h * BM_KEY_LABEL))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labels[b], x + w / 2, y + 0.58 * h);
      }
      // the strike's ring, spreading from the point of contact (farther on a phrase's first beat)
      if (since < BM_RING_SEC) {
        const u = since / BM_RING_SEC;
        const accent = P > 0 && isPhraseStart(((view.lastNoteSec[b] % P) + P) % P / Math.max(1e-9, plan.beatSec));
        const reach = (accent ? BM_ACCENT_REACH : BM_RING_REACH) * r * k;
        ctx.strokeStyle = accent ? BM_STAGE_LOOK.ring : bar.color;
        ctx.globalAlpha = (accent ? 0.9 : 0.7) * (1 - u);
        ctx.lineWidth = Math.max(hair, (accent ? 0.006 : 0.004) * k);
        ctx.beginPath();
        ctx.ellipse(this.wx(view, bar.x), this.wy(view, bar.top), Math.max(1, reach * (0.3 + 0.7 * u)), Math.max(1, 0.45 * reach * (0.3 + 0.7 * u)), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        rings++;
      }
    }
    this.glowing = glowing;
    this.rings = rings;
    ctx.restore();
  }

  /** --- beat-machine-tunes --- The keys' note names (each bar's pitch: a known tune's own, or the Sound section's scale), made once a plan. */
  private keyLabels(plan: BeatMachinePlan): string[] {
    if (this.labelsOf === plan) return this.labels;
    this.labelsOf = plan;
    this.labels = plan.marbles ? plan.marbles.bars.map((bar) => NOTE_NAMES[((Math.round(frequencyToMidi(bar.frequency)) % 12) + 12) % 12]) : [];
    return this.labels;
  }

  private drawMarbles(ctx: CanvasRenderingContext2D, view: BeatMachineView, plan: BeatMachinePlan, t: number, opts: BeatMachineRenderOptions) {
    const m = plan.marbles!;
    const k = view.frame.scale;
    const r = m.radius * k * BM_MARBLE_DRAWN;
    this.litMarble = -1;
    let drawn = 0;
    let trails = 0;
    ctx.save();
    for (let b = 0; b < m.tubes.length; b++) {
      const color = m.bars[b].color;
      const count = m.tubes[b].count;
      // --- beat-machine-tunes --- the comet trails of the marbles falling onto their key and bouncing off it
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        if (MARBLE.idle || MARBLE.segment > 1) continue;
        trails++;
        ctx.fillStyle = color;
        for (let j = BM_MARBLE_TRAIL_POINTS; j >= 1; j--) {
          const at = t - j * BM_MARBLE_TRAIL_SEC;
          if (at < 0) continue;
          marblePosition(plan, b, i, at, TRAIL);
          if (TRAIL.idle) continue;
          const u = 1 - j / (BM_MARBLE_TRAIL_POINTS + 1);
          ctx.globalAlpha = 0.32 * u;
          ctx.beginPath();
          ctx.arc(this.wx(view, TRAIL.x), this.wy(view, TRAIL.y), r * (0.4 + 0.5 * u), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      // the soft glow (one path for the tube's marbles), the bodies, the gloss and the specular dots
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        const x = this.wx(view, MARBLE.x);
        const y = this.wy(view, MARBLE.y);
        ctx.moveTo(x + r * 1.8, y);
        ctx.arc(x, y, r * (opts.showGlow ? 2.2 : 1.8), 0, Math.PI * 2);
      }
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        const x = this.wx(view, MARBLE.x);
        const y = this.wy(view, MARBLE.y);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        const x = this.wx(view, MARBLE.x) - 0.25 * r;
        const y = this.wy(view, MARBLE.y) - 0.25 * r;
        ctx.moveTo(x + 0.55 * r, y);
        ctx.arc(x, y, 0.55 * r, 0, Math.PI * 2);
      }
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        const x = this.wx(view, MARBLE.x) - 0.38 * r;
        const y = this.wy(view, MARBLE.y) - 0.38 * r;
        ctx.moveTo(x + 0.2 * r, y);
        ctx.arc(x, y, 0.2 * r, 0, Math.PI * 2);
      }
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      // --- beat-machine-tunes --- the next marbles lit: every marble falling onto its key, and the one waiting at the foot of
      // the next note's tube
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        const falling = !MARBLE.idle && MARBLE.segment === 0;
        const waiting = b === this.nextKey && MARBLE.idle && MARBLE.slot === 0;
        if (!falling && !waiting) continue;
        ctx.strokeStyle = BM_STAGE_LOOK.ring;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = Math.max(1, 0.25 * r);
        ctx.beginPath();
        ctx.arc(this.wx(view, MARBLE.x), this.wy(view, MARBLE.y), 1.45 * r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        this.litMarble = b;
      }
      drawn += count;
    }
    ctx.restore();
    this.marblesDrawn = drawn;
    this.trails = trails;
  }
}

// --- beat-machine-tunes ---
/** The end banner's line under a known tune's name (the name itself is Song Ring's: `SongRingLabels.song`). */
export interface BeatMachineLabels {
  tuneSub: (notes: number) => string;
}
export const DEFAULT_BEAT_MACHINE_LABELS: BeatMachineLabels = { tuneSub: (notes) => `${notes} notes, every one on the beat` };

/**
 * Whether the end banner is up at simulation time `t`: a known tune's marble machine, from its last note (the chord) to the
 * loop's end – in every loop, so a clip of whole loops ends on it and each pass names the tune again.
 */
export function beatMachineBannerShows(view: BeatMachineView, t: number): boolean {
  const plan = view.plan;
  if (!plan.tune || !plan.marbles || !(t > 0) || !(plan.loopSec > 0)) return false;
  const tl = t - Math.floor((t + BM_TIME_EPS) / plan.loopSec) * plan.loopSec;
  return tl >= plan.tune.lastBeat * plan.beatSec - BM_TIME_EPS;
}

const NEXT = { slot: -1, wait: 0 };
/** The next note after loop time `tl` (its bar and the seconds until it; the loop wraps), or null for a plan with no notes. */
export function nextNoteAfter(plan: BeatMachinePlan, tl: number): { slot: number; wait: number } | null {
  const ev = plan.events;
  let lo = 0;
  let hi = ev.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ev[mid].t <= tl + BM_TIME_EPS) lo = mid + 1;
    else hi = mid;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = pass === 0 ? lo : 0; i < (pass === 0 ? ev.length : lo); i++) {
      if (ev[i].kind !== "note") continue;
      NEXT.slot = ev[i].slot;
      NEXT.wait = ev[i].t - tl + (pass === 0 ? 0 : plan.loopSec);
      return NEXT;
    }
  }
  return null;
}

/** How far the machine reaches above and below its centre (world px, the stairs' panel and dots included): the loop HUD keeps clear of it. */
export function beatMachineExtentPx(view: BeatMachineView): number {
  const b = view.plan.bbox;
  const stairs = view.plan.variant === "stairs";
  const pad = stairs ? BM_PANEL_PAD : 0.02;
  const below = stairs ? 0.09 : 0;
  return ((b.y1 - b.y0 + 2 * pad + below) / 2) * view.frame.scale;
}

/** The canvas' data-bm-* keys (cleared when another mode runs). */
export const BEAT_MACHINE_DATA_KEYS = ["bmVariant", "bmTime", "bmLoop", "bmLoopIndex", "bmBpm", "bmNotes", "bmPlayed", "bmSounds", "bmSeams", "bmSeamNotes", "bmSeamSounds", "bmSeamError", "bmBalls", "bmMarbles", "bmSpares", "bmConflicts", "bmInFlight", "bmInFlightMax", "bmReleases", "bmLifts", "bmGlides", "bmBasses", "bmSource", "bmNan", "bmLit", "bmRungs", "bmGlowing", "bmDrawn", "bmTune", "bmAccents", "bmChords", "bmNextKey", "bmLitMarble", "bmRings", "bmTrails"] as const;

/** Mirrors a Beat Machines run onto the canvas' dataset (data-bm-*), for tools and the smoke test. */
export function writeBeatMachineDataset(view: BeatMachineView, layer: BeatMachineLayer, set: (key: string, value: string) => void) {
  const plan = view.plan;
  set("bmVariant", plan.variant);
  set("bmTime", view.timeSec.toFixed(3));
  set("bmLoop", plan.loopSec.toFixed(4));
  set("bmLoopIndex", String(view.loop));
  set("bmBpm", String(plan.bpm));
  set("bmNotes", String(plan.notes.length));
  set("bmPlayed", String(view.notes));
  set("bmSounds", String(view.sounds));
  set("bmSeams", String(view.seams));
  set("bmSeamNotes", view.seamNotes.join(","));
  set("bmSeamSounds", view.seamSounds.join(","));
  set("bmSeamError", view.seamError.toExponential(2));
  set("bmBalls", String(view.balls));
  set("bmMarbles", String(plan.ballCount));
  set("bmSpares", String(plan.spares));
  set("bmConflicts", String(plan.conflicts));
  set("bmInFlight", String(view.inFlight));
  set("bmInFlightMax", String(plan.inFlightMax));
  set("bmReleases", String(view.releases));
  set("bmLifts", String(view.lifts));
  set("bmGlides", String(view.glides));
  set("bmBasses", String(view.basses));
  set("bmSource", view.source);
  set("bmNan", String(view.nonFinite));
  set("bmLit", String(layer.litDot));
  set("bmRungs", String(layer.rungsDrawn));
  set("bmGlowing", String(layer.glowing));
  set("bmDrawn", String(plan.marbles ? layer.marblesDrawn : 1));
  // --- beat-machine-tunes ---
  set("bmTune", plan.tune ? plan.tune.tune : "");
  set("bmAccents", String(view.accents));
  set("bmChords", String(view.chords));
  set("bmNextKey", String(layer.nextKey));
  set("bmLitMarble", String(layer.litMarble));
  set("bmRings", String(layer.rings));
  set("bmTrails", String(layer.trails));
}
