import { hoopHue, scheduleTurns, type HoopsView } from "@/lib/physics/modes/hoops";

/*
 * --- bead-hoops --- The Spinning Hoops picture (lib/physics/modes/hoops.ts runs the physics): every hoop drawn face-on as an
 * ellipse 2R |cos φ| wide and 2R tall – φ = 2π · the schedule's turns at the frame's exact simulation time, so it reads as a
 * hoop spinning about its vertical diameter – rainbow by hoop (red outside, violet inside; the wall colour with Rainbow Walls
 * off), the half turned away from the camera dimmer and drawn first, then the beads behind, the near halves and the beads in
 * front; a bead sits at x = R sin θ cos φ, y = R cos θ (screen down) with its depth R sin θ sin φ setting its size and its
 * light; it glows in its hoop's colour. A faint vertical axis runs through the hoops down to a small dark pivot disc under the
 * outer hoop. A frame is drawn at its own simulation time (what the page has fed the engine, one step behind – like the
 * orbs' renderer): the spin from the closed-form schedule, a bead's angle between the last two steps or, a frame just past the
 * latest one, carried on along its velocity – so 30, 60 and 120 fps and the fast export show the same smooth motion. The title,
 * the subtitle and the amber counter are the loop HUD's (lib/loop/hud.ts).
 */

export interface HoopsRenderOptions {
  /** The hoops' line (world px): the Wall Thickness. */
  wallThickness: number;
  /** Rainbow hoops by index; off: every hoop in `wallColor`. */
  rainbow: boolean;
  wallColor: string;
  /** A soft glow around the hoops (Wall Glow). */
  wallGlow: boolean;
}

/** The engine's fixed step (ms). */
const STEP_MS = 1000 / 60;

/**
 * The simulation time (ms) a frame is drawn at: the engine's time, the part of a step it holds and the page's own leftover,
 * one fixed step behind (the step that made the frame's sounds) – never more than a step away from the engine's time and
 * never below 0 (the formula of the orbs' renderer, `orbRenderTimeMs()`).
 */
export function hoopsRenderTimeMs(elapsedMs: number, engineRemainderMs: number, pageLeftoverMs: number, stepMs: number = STEP_MS): number {
  const step = stepMs > 0 && Number.isFinite(stepMs) ? stepMs : STEP_MS;
  let t = elapsedMs + (engineRemainderMs + pageLeftoverMs - STEP_MS) * (step / STEP_MS);
  if (t > elapsedMs + step) t = elapsedMs + step;
  if (t < elapsedMs - step) t = elapsedMs - step;
  return t > 0 ? t : 0;
}

/**
 * Where a frame at `timeMs` sees the run: the hoops' turn φ (rad); a bead's angle between the last two steps (`alpha`, 0–1),
 * or – a frame past the latest step – that step's angle carried on along the bead's velocity for `aheadSec`.
 */
export interface HoopsFrame {
  phi: number;
  alpha: number;
  aheadSec: number;
}

/** The spin and the step blend of a frame at `timeMs` (simulation ms, within a step of the view's latest one). */
export function hoopsFrameAt(view: HoopsView, timeMs: number, out: HoopsFrame = { phi: 0, alpha: 1, aheadSec: 0 }): HoopsFrame {
  const sc = view.schedule;
  let tau = (timeMs - view.cycleStartMs) / 1000;
  // a frame just before the latest seam is in the previous cycle (a whole number of turns: the same angle)
  if (tau < 0 && sc.loop && sc.cycle > 0) tau += sc.cycle;
  // (a finished run stands still at its end)
  if (view.finished && !sc.loop && tau > sc.cycle) tau = sc.cycle;
  const turns = scheduleTurns(sc, tau > 0 ? tau : 0);
  out.phi = 2 * Math.PI * (turns - Math.floor(turns));
  const step = view.stepMs > 0 ? view.stepMs : STEP_MS;
  const a = (timeMs - (view.timeMs - step)) / step;
  out.alpha = a < 0 ? 0 : a > 1 ? 1 : a;
  out.aheadSec = !view.finished && timeMs > view.timeMs ? Math.min(step, timeMs - view.timeMs) / 1000 : 0;
  return out;
}

/** A bead's angle (rad) at a frame: between the last two steps, or carried on along its velocity past the latest one. */
export function hoopsBeadAngle(view: HoopsView, index: number, frame: HoopsFrame): number {
  if (frame.aheadSec > 0) return view.theta[index] + view.thetaDot[index] * frame.aheadSec;
  return view.thetaPrev[index] + (view.theta[index] - view.thetaPrev[index]) * frame.alpha;
}

/** How far (world px) the rig reaches above and below the hoops' centre: the outer hoop, the axis' tip and the pivot disc under it. */
export function hoopsExtentPx(view: Pick<HoopsView, "count" | "radiusPx" | "half">): number {
  let outer = 0;
  for (let i = 0; i < view.count; i++) if (view.radiusPx[i] > outer) outer = view.radiusPx[i];
  return outer + 0.09 * view.half;
}

/** A hoop's colour: rainbow by index (hsl), else the wall colour. */
export function hoopColor(index: number, count: number, opts: Pick<HoopsRenderOptions, "rainbow" | "wallColor">): string {
  return opts.rainbow ? `hsl(${Math.round(hoopHue(index, count))}, 92%, 62%)` : opts.wallColor;
}

/** The data-hoops-* attributes the smoke test and tools read (Canvas.tsx writes them in Spinning Hoops). */
export const HOOPS_DATA_KEYS = ["hoopsCount", "hoopsUp", "hoopsLifts", "hoopsSettles", "hoopsTicks", "hoopsOrder", "hoopsOrdered", "hoopsOmega", "hoopsPhase", "hoopsCycle", "hoopsAllUp", "hoopsSide", "hoopsDone", "hoopsTheta"] as const;

const FRAME: HoopsFrame = { phi: 0, alpha: 1, aheadSec: 0 };

export class HoopsLayer {
  private colors: string[] = [];
  private colorKey = "";
  private sprites = new Map<string, HTMLCanvasElement | null>();
  private orderText = "";
  private orderLength = -1;
  private orderGeneration = -1;
  private orderCycle = -1;

  /** The hoops' colours for this frame (rebuilt only when the count or the colour choice changes). */
  private colorsOf(view: HoopsView, opts: HoopsRenderOptions): string[] {
    const key = `${view.count}|${opts.rainbow ? "r" : opts.wallColor}`;
    if (key !== this.colorKey) {
      this.colorKey = key;
      this.colors = [];
      for (let i = 0; i < view.count; i++) this.colors.push(hoopColor(i, view.count, opts));
    }
    return this.colors;
  }

  /** A bead's glow sprite in `color` (a radial fade, drawn once; null where no DOM canvas exists – then plain discs). */
  private spriteOf(color: string): HTMLCanvasElement | null {
    let sprite = this.sprites.get(color);
    if (sprite !== undefined) return sprite;
    sprite = null;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, color);
        grad.addColorStop(0.35, color);
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        g.globalAlpha = 0.55;
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        sprite = c;
      }
    }
    this.sprites.set(color, sprite);
    return sprite;
  }

  /** One half of hoop `i` (the right half on screen, or the left one), in `color` at `alpha`. */
  private half(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, squash: number, right: boolean, width: number, color: string, alpha: number, glow: boolean) {
    const rx = Math.abs(squash) * r;
    const start = right ? -Math.PI / 2 : Math.PI / 2;
    const end = start + Math.PI;
    ctx.strokeStyle = color;
    if (glow) {
      ctx.globalAlpha = 0.14 * alpha;
      ctx.lineWidth = width * 4;
      ctx.beginPath();
      if (rx > 0.25) ctx.ellipse(cx, cy, rx, r, 0, start, end);
      else {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx, cy + r);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (rx > 0.25) ctx.ellipse(cx, cy, rx, r, 0, start, end);
    else {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
    }
    ctx.stroke();
  }

  /** The beads on the `front` (true) or the far (false) side of the hoops at the frame's spin and angles. */
  private beads(ctx: CanvasRenderingContext2D, view: HoopsView, colors: readonly string[], frame: HoopsFrame, front: boolean) {
    const c = Math.cos(frame.phi);
    const s = Math.sin(frame.phi);
    for (let i = 0; i < view.count; i++) {
      const th = hoopsBeadAngle(view, i, frame);
      const sinT = Math.sin(th);
      const depth = sinT * s; // −1 … 1: the bead's depth (towards the camera positive)
      if (front !== depth >= 0) continue;
      const r = view.radiusPx[i];
      const x = view.cx + r * sinT * c;
      const y = view.cy + r * Math.cos(th);
      const size = view.beadRadius * (1 + 0.18 * depth);
      const light = depth >= 0 ? 1 : 0.5 + 0.5 * (1 + depth);
      const color = colors[i];
      const sprite = this.spriteOf(color);
      if (sprite) {
        const g = size * 3.2;
        ctx.globalAlpha = light;
        ctx.drawImage(sprite, x - g, y - g, 2 * g, 2 * g);
      }
      ctx.globalAlpha = light;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fill();
      // a small highlight: the bead is a glossy sphere
      ctx.globalAlpha = 0.55 * light;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x - 0.3 * size, y - 0.3 * size, 0.35 * size, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  /** Draws the rig at simulation time `timeMs`: the axis, the pivot, the hoops' far halves, the far beads, the near halves, the near beads. */
  draw(ctx: CanvasRenderingContext2D, view: HoopsView, timeMs: number, opts: HoopsRenderOptions) {
    if (view.count <= 0) return;
    const frame = hoopsFrameAt(view, timeMs, FRAME);
    const phi = frame.phi;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const colors = this.colorsOf(view, opts);
    let outer = 0;
    for (let i = 0; i < view.count; i++) if (view.radiusPx[i] > outer) outer = view.radiusPx[i];
    const unit = view.half;
    const width = Math.max(0.6, opts.wallThickness * (unit / 225));
    ctx.save();
    ctx.lineCap = "round";
    // the axis through the hoops and the pivot disc under the outer one
    const pivotY = view.cy + outer + 0.055 * unit;
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#cfd8ff";
    ctx.lineWidth = Math.max(0.6, 0.004 * unit);
    ctx.beginPath();
    ctx.moveTo(view.cx, view.cy - outer - 0.06 * unit);
    ctx.lineTo(view.cx, pivotY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#1a2133";
    ctx.strokeStyle = "#3d4a6b";
    ctx.lineWidth = Math.max(0.6, 0.006 * unit);
    ctx.beginPath();
    ctx.arc(view.cx, pivotY, 0.03 * unit, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    // the right half on screen is the far one while sin φ · cos φ < 0
    const rightFar = s * c < 0;
    for (let i = 0; i < view.count; i++) this.half(ctx, view.cx, view.cy, view.radiusPx[i], c, rightFar, 0.8 * width, colors[i], 0.4, false);
    this.beads(ctx, view, colors, frame, false);
    for (let i = 0; i < view.count; i++) this.half(ctx, view.cx, view.cy, view.radiusPx[i], c, !rightFar, width, colors[i], 1, opts.wallGlow);
    this.beads(ctx, view, colors, frame, true);
    ctx.restore();
  }

  /** The run's counters as data-hoops-* attributes (`set` writes one only when it changed). */
  writeData(set: (key: string, value: string) => void, view: HoopsView) {
    set("hoopsCount", String(view.count));
    set("hoopsUp", String(view.upCount));
    set("hoopsLifts", String(view.lifts));
    set("hoopsSettles", String(view.settles));
    set("hoopsTicks", String(view.ticks));
    if (view.liftOrder.length !== this.orderLength || view.generation !== this.orderGeneration || view.cycleIndex !== this.orderCycle) {
      this.orderLength = view.liftOrder.length;
      this.orderGeneration = view.generation;
      this.orderCycle = view.cycleIndex;
      this.orderText = view.liftOrder.slice(0, 64).join(",");
    }
    set("hoopsOrder", this.orderText);
    set("hoopsOrdered", view.orderOk ? "1" : "0");
    set("hoopsOmega", view.omega.toFixed(3));
    set("hoopsPhase", view.phase);
    set("hoopsCycle", String(view.cycleIndex));
    set("hoopsAllUp", view.firstAllUpMs >= 0 ? (view.firstAllUpMs / 1000).toFixed(3) : "");
    set("hoopsSide", String(view.side));
    set("hoopsDone", view.finished ? "1" : "0");
    set("hoopsTheta", view.count > 0 ? ((view.theta[0] * 180) / Math.PI).toFixed(1) : "0");
  }
}
