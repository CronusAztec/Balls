import type { BeatMachineView } from "@/lib/physics/modes/beatMachine";
import { BM_TIME_EPS, marblePosition, marbleState, stairsPosition, type BeatMachinePlan } from "@/lib/simulation/beatMachinePlan";

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
 * Nothing is allocated per frame: no gradients (the gloss is two flat circles), the shared scratch points, one path a layer.
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
export const BM_MARBLES_LOOK = { brass: "#8c7350", brassDark: "#5e4c33", tube: "rgba(255, 240, 220, 0.38)", cap: "rgba(255, 240, 220, 0.55)" } as const;
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

const POINT = { x: 0, y: 0 };
const MARBLE = marbleState();

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
    ctx.lineWidth = Math.max(hair, 0.004 * k);
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
    ctx.lineWidth = Math.max(hair, 0.003 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.brassDark;
    ctx.stroke();
    this.rungsDrawn = rungs;
    // the top rail, under the marbles rolling back
    ctx.beginPath();
    ctx.moveTo(this.wx(view, m.liftX + railHalf), this.wy(view, m.railY + r));
    ctx.lineTo(this.wx(view, m.railLeft - r), this.wy(view, m.railY + r));
    ctx.lineWidth = Math.max(hair, 0.005 * k);
    ctx.strokeStyle = BM_MARBLES_LOOK.brass;
    ctx.lineCap = "round";
    ctx.stroke();
    // the tubes: thin pale outlines with a base cap
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
    ctx.lineWidth = hair;
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
    // the bars: a struck bar brightens, glows and dips
    let glowing = 0;
    for (let b = 0; b < m.bars.length; b++) {
      const bar = m.bars[b];
      const since = sinceNote(view, b, t);
      const glow = since < BM_GLOW_SEC ? 1 - since / BM_GLOW_SEC : 0;
      const dip = since < BM_DIP_SEC ? BM_DIP_UNITS * Math.sin((Math.PI * since) / BM_DIP_SEC) : 0;
      if (glow > 0) glowing++;
      const x = this.wx(view, bar.x - m.barW / 2);
      const y = this.wy(view, bar.top + dip);
      ctx.beginPath();
      roundRect(ctx, x, y, m.barW * k, m.barH * k, 0.25 * m.barH * k);
      ctx.fillStyle = bar.color;
      ctx.shadowColor = bar.color;
      ctx.shadowBlur = glow > 0 ? (opts.showGlow ? 26 : 16) * glow : 0;
      ctx.fill();
      if (glow > 0) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.45 * glow;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    this.glowing = glowing;
    ctx.restore();
  }

  private drawMarbles(ctx: CanvasRenderingContext2D, view: BeatMachineView, plan: BeatMachinePlan, t: number, opts: BeatMachineRenderOptions) {
    const m = plan.marbles!;
    const k = view.frame.scale;
    const r = m.radius * k;
    let drawn = 0;
    ctx.save();
    for (let b = 0; b < m.tubes.length; b++) {
      const color = m.bars[b].color;
      const count = m.tubes[b].count;
      // the soft glow (one path for the tube's marbles), the bodies, the gloss and the specular dots
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        marblePosition(plan, b, i, t, MARBLE);
        const x = this.wx(view, MARBLE.x);
        const y = this.wy(view, MARBLE.y);
        ctx.moveTo(x + r * 1.8, y);
        ctx.arc(x, y, r * (opts.showGlow ? 2.2 : 1.8), 0, Math.PI * 2);
      }
      ctx.globalAlpha = 0.16;
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
      ctx.globalAlpha = 0.28;
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
      drawn += count;
    }
    ctx.restore();
    this.marblesDrawn = drawn;
  }
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
export const BEAT_MACHINE_DATA_KEYS = ["bmVariant", "bmTime", "bmLoop", "bmLoopIndex", "bmBpm", "bmNotes", "bmPlayed", "bmSounds", "bmSeams", "bmSeamNotes", "bmSeamSounds", "bmSeamError", "bmBalls", "bmMarbles", "bmSpares", "bmConflicts", "bmInFlight", "bmInFlightMax", "bmReleases", "bmLifts", "bmGlides", "bmBasses", "bmSource", "bmNan", "bmLit", "bmRungs", "bmGlowing", "bmDrawn"] as const;

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
}
