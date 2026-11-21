import type { Ball } from "@/lib/physics/types";
import type { GrowView } from "@/lib/physics/modes/grow";
import { DEFAULT_GROW_RAMP, parseRamp, rampColor } from "@/lib/physics/growFill";

/*
 * --- loop-foundation --- Grow's fill-and-loop look (lib/physics/modes/grow.ts runs it): the ball's colour by its size along
 * the ramp's colour stops (r / cap), the contact markers – a small ring where the ball hit, fading (and widening) over their
 * lifetime, at most the mode's ring buffer of 64 – and the hold and the shrink drawn as a solid disc. The classic Grow (no
 * colour by size, no loop) keeps the page's own ball drawing.
 */

export interface GrowLook {
  /** Colour by size along `ramp`. */
  hue: boolean;
  ramp: readonly string[];
  /** Contact markers and their lifetime (s). */
  markers: boolean;
  markerLife: number;
}

export const DEFAULT_GROW_LOOK: GrowLook = { hue: false, ramp: DEFAULT_GROW_RAMP.split(","), markers: false, markerLife: 0.3 };

/** The look of the page's settings. */
export function growLookOf(s: { growHue: boolean; growRamp: string; growMarkers: boolean; growMarkerLife: number }): GrowLook {
  return { hue: s.growHue, ramp: parseRamp(s.growRamp), markers: s.growMarkers, markerLife: Number.isFinite(s.growMarkerLife) && s.growMarkerLife >= 0 ? s.growMarkerLife : 0.3 };
}

/** The widest a marker ring grows (px, at the end of its life) and its start radius. */
const MARKER_START_R = 3;
const MARKER_GROW_R = 9;
/** The marker ring's line (world px). */
const MARKER_LINE = 2;

/** The data-grow-* attributes the smoke test and tools read (Canvas.tsx writes them in Grow). */
export const GROW_DATA_KEYS = ["growLaw", "growFill", "growPhase", "growFills", "growFirstFill", "growSeams", "growCycle", "growBounces", "growTotalBounces", "growRadius", "growCap", "growStart", "growMarkers", "growFull" /* --- grow-fill-clip --- */] as const;

// --- grow-fill-clip ---
/*
 * The stake on screen from the first second (draw only, every Grow run): the ring's inside washes with the ball's colour as it
 * grows and glows round its outside, a meter runs round the ring from the top – the ball's width as a share of the ring's,
 * r / cap, the share a viewer reads by eye, with its number over the ring – and every fill lands as a moment: the ring flashes
 * white and a shockwave leaves it.
 * Everything is drawn from the view and the simulation clock, so a frame is the same live, in the fast export and in the
 * Windows app's render queue.
 */
/** How long a fill's burst lasts (simulation ms): the ring's white flash, the shockwave and the meter's flare. */
export const GROW_BURST_MS = 1100;
/** The ring's inside: the ball's colour at this alpha when empty and at the top one full (and a halo round the ring as it fills). */
export const GROW_WASH_MIN = 0.12;
export const GROW_WASH_MAX = 0.36;
export const GROW_HALO_MAX = 0.3;
/** The meter: its line width as a share of the ring's radius, and its track's alpha. */
export const GROW_METER_WIDTH = 0.035;
const GROW_METER_TRACK = 0.16;

/** How full the ring is, 0–1: the smallest ball's width as a share of the most it can grow to, r / cap (a fill is every ball at its cap). */
export function growCoverage(balls: readonly Ball[], cap: number): number {
  if (!(cap > 0) || balls.length === 0) return 0;
  let r = Infinity;
  for (const ball of balls) if (ball.radius > 0) r = Math.min(r, ball.radius);
  if (!Number.isFinite(r)) return 0;
  return Math.min(1, r / cap);
}

/** The burst of a fill `ageMs` (simulation ms) after it: its 0–1 progress, or null outside it. */
export function growBurstAt(ageMs: number): number | null {
  return ageMs >= 0 && ageMs < GROW_BURST_MS ? ageMs / GROW_BURST_MS : null;
}

/** The view's newest fill (simulation ms), or −1. */
function lastFillOf(view: GrowView): number {
  return view.fills > 0 ? view.lastFillMs : -1;
}
// --- end grow-fill-clip ---

export class GrowLayer {
  /** True when Grow draws the balls itself: colour by size, or the loop's hold / shrink (a solid disc). */
  drawsBodies(look: GrowLook | null, view: GrowView): boolean {
    return (!!look && look.hue) || (view.onFill !== "stay" && (view.phase === "hold" || view.phase === "shrink" || view.phase === "done"));
  }

  /** A ball's colour: along the ramp by r / cap with colour by size, else its own. */
  colorOf(ball: Ball, view: GrowView, look: GrowLook | null): string {
    if (!look || !look.hue || !(view.cap > 0)) return ball.color;
    return rampColor(look.ramp, ball.radius / view.cap);
  }

  /** The contact markers alive at `nowMs` (simulation ms): rings fading out over the lifetime, under the balls. */
  drawMarkers(ctx: CanvasRenderingContext2D, view: GrowView, look: GrowLook, nowMs: number, color: string) {
    const life = 1000 * look.markerLife;
    if (!look.markers || !(life > 0)) return;
    const m = view.markers;
    ctx.save();
    ctx.lineWidth = MARKER_LINE;
    ctx.strokeStyle = color;
    for (let i = 0; i < m.count; i++) {
      const age = nowMs - m.ts[i];
      if (age < 0 || age >= life) continue;
      const f = age / life;
      ctx.globalAlpha = 0.9 * (1 - f);
      ctx.beginPath();
      ctx.arc(m.xs[i], m.ys[i], MARKER_START_R + MARKER_GROW_R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- grow-fill-clip ---
  /**
   * Under the balls: the ring's inside washed with `color` (stronger as the ball covers more of it) and the meter round the
   * ring from the top – a faint track, the covered share in `color`, flaring white at a fill.
   */
  drawWorld(ctx: CanvasRenderingContext2D, view: GrowView, balls: readonly Ball[], nowMs: number, color: string, cx: number, cy: number) {
    const R = view.ring;
    if (!(R > 0)) return;
    const f = view.phase === "grow" ? growCoverage(balls, view.cap) : 1;
    const fill = lastFillOf(view);
    const burst = fill >= 0 ? growBurstAt(nowMs - fill) : null;
    ctx.save();
    // the halo round the ring, stronger as it fills (one gradient a frame: the colour moves with the ball's size)
    if (f > 0.02 && typeof ctx.createRadialGradient === "function") {
      const halo = ctx.createRadialGradient(cx, cy, R, cx, cy, 1.45 * R);
      halo.addColorStop(0, color);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.globalAlpha = GROW_HALO_MAX * f;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.45 * R, 0, Math.PI * 2);
      ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
      ctx.fill();
    }
    ctx.globalAlpha = GROW_WASH_MIN + (GROW_WASH_MAX - GROW_WASH_MIN) * f;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    const lw = Math.max(2, GROW_METER_WIDTH * R);
    const mr = R + 0.9 * lw;
    ctx.lineCap = "round";
    ctx.lineWidth = lw;
    ctx.globalAlpha = GROW_METER_TRACK;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, mr, 0, Math.PI * 2);
    ctx.stroke();
    if (f > 0.002) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = burst !== null ? "#ffffff" : color;
      ctx.beginPath();
      ctx.arc(cx, cy, mr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, f));
      ctx.stroke();
    }
    // the number over the ring: "63%" (no words: it reads the same in every language)
    const fs = Math.max(12, 0.16 * R);
    ctx.globalAlpha = 0.92;
    ctx.font = `bold ${Math.round(fs)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = Math.max(2, 0.12 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    const text = `${Math.floor(100 * Math.min(1, f) + 1e-9)}%`;
    const ty = cy - mr - 0.8 * lw;
    ctx.strokeText(text, cx, ty);
    ctx.fillStyle = burst !== null ? "#ffffff" : color;
    ctx.fillText(text, cx, ty);
    ctx.restore();
  }

  /** Over the balls: a fill's burst – the ring flashing white and a shockwave leaving it in the ball's colour. */
  drawEffects(ctx: CanvasRenderingContext2D, view: GrowView, nowMs: number, color: string, cx: number, cy: number) {
    const R = view.ring;
    const fill = lastFillOf(view);
    const p = fill >= 0 && R > 0 ? growBurstAt(nowMs - fill) : null;
    if (p === null) return;
    ctx.save();
    // the flash: the whole ring white, fading over the first third
    if (p < 0.35) {
      ctx.globalAlpha = 0.55 * (1 - p / 0.35);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }
    // two shockwaves out of the ring, the second a beat behind
    for (const lag of [0, 0.18]) {
      const q = (p - lag) / (1 - lag);
      if (q <= 0) continue;
      const eq = 1 - (1 - q) * (1 - q) * (1 - q);
      ctx.globalAlpha = 0.85 * (1 - q);
      ctx.strokeStyle = lag === 0 ? "#ffffff" : color;
      ctx.lineWidth = Math.max(2, (0.06 - 0.04 * eq) * R);
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1 + 0.55 * eq), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // --- end grow-fill-clip ---

  /** The balls as flat discs in their colours (the hold and the shrink always flat: the loop's solid disc). */
  drawBodies(ctx: CanvasRenderingContext2D, balls: readonly Ball[], view: GrowView, look: GrowLook | null) {
    for (const ball of balls) {
      if (!(ball.radius > 0)) continue;
      ctx.fillStyle = this.colorOf(ball, view, look);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Mirrors the run onto the canvas element (data-grow-*): the law, the phase, the fills, the seams, the cycle, the bounces. */
export function writeGrowDataset(view: GrowView, balls: readonly Ball[], set: (key: string, value: string) => void) {
  set("growLaw", view.law);
  set("growFill", view.onFill);
  set("growPhase", view.phase);
  set("growFills", String(view.fills));
  set("growFirstFill", view.firstFillMs >= 0 ? (view.firstFillMs / 1000).toFixed(3) : "");
  set("growSeams", String(view.seams));
  set("growCycle", view.cycleSec > 0 ? view.cycleSec.toFixed(3) : "");
  set("growBounces", String(view.bounces));
  set("growTotalBounces", String(view.totalBounces));
  set("growRadius", balls.length > 0 ? balls[0].radius.toFixed(2) : "");
  set("growCap", view.cap.toFixed(2));
  set("growStart", view.startRadius.toFixed(2));
  set("growMarkers", String(view.markers.count));
  set("growFull", view.cap > 0 ? (100 * growCoverage(balls, view.cap)).toFixed(1) : ""); // --- grow-fill-clip --- (the meter's share, %)
}
