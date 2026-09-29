import { placeBobAt, type BobPlacement, type PendulumView } from "@/lib/physics/modes/pendulum";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of the Pendulum Wave mode (lib/physics/modes/pendulum.ts): the rig of the chosen layout (the
 * bar and pivots of the row, the pivot ring of the arc, the radial guides and the circle / polygon outline of
 * the radial layouts, the rails, the floor), the strings, the bobs in their rainbow colours with a flash on
 * every note, the fading trails sampled from the analytic swing (the spiral arms of the galaxy live there) and
 * the screen flash of a big chord. Called from Canvas.tsx inside the camera transform (trails, rig, bobs) and
 * outside it (the flash); nothing is allocated per frame beyond the fill strings, so sixty bobs at 1080×1920
 * stay inside the frame budget.
 */

export interface PendulumRenderOptions {
  /** The canvas' wall colour function (rainbow walls apply), with an optional alpha. */
  wallColor: (index: number, alpha?: number) => string;
  wallThickness: number;
  showGlow: boolean;
}

const TWO_PI = Math.PI * 2;
/** How long a bob stays brightened after its note (simulation ms). */
export const NOTE_FLASH_MS = 220;
/** How long the screen flash of a big chord lasts (simulation ms). */
export const CHORD_FLASH_MS = 420;
/** Chords smaller than this do not flash the screen. */
export const CHORD_FLASH_MIN_NOTES = 3;

/** Simulation ms since sub-step `tick` (Infinity before the first event). */
export function ticksAgoMs(view: PendulumView, tick: number): number {
  return tick === -Infinity ? Infinity : (view.tick - tick) * view.tickMs;
}

/** Time constant (seconds) of the trail fade for a `trails` setting of 0–1: a third of a second at the default 0.3, three seconds at 1. */
export function trailTimeConstant(trails: number): number {
  return 0.12 + 3 * trails * trails;
}

/** Opacity of a trail where it leaves its bob. */
export const TRAIL_ALPHA = 0.8;
/** A trail is drawn back to the point where it has faded to this opacity (and not a pixel further). */
export const TRAIL_MIN_ALPHA = 0.02;
/** Steps of opacity along a trail (one stroke each). */
export const TRAIL_BANDS = 16;
/** Points per swing a trail is traced at (and at least 30 per second of simulation time for the slow bobs). */
export const TRAIL_POINTS_PER_SWING = 24;
/** Most trail points all the bobs together are traced at per frame: sixty fast bobs with the longest trails share it. */
export const MAX_TRAIL_POINTS = 8000;

/** How far back (seconds of simulation time) a trail reaches with the `trails` setting: until its opacity has faded to `TRAIL_MIN_ALPHA`; 0 with the trails off. */
export function trailWindowSec(trails: number): number {
  return trails > 0 ? trailTimeConstant(trails) * Math.log(TRAIL_ALPHA / TRAIL_MIN_ALPHA) : 0;
}

/** Opacity of a trail `ageSec` seconds of simulation time behind its bob, for a fade time constant. */
export function trailAlpha(ageSec: number, timeConstant: number): number {
  return TRAIL_ALPHA * Math.exp(-Math.max(0, ageSec) / timeConstant);
}

/** Spacing (seconds of simulation time) of the points a bob of `frequency` is traced at: `TRAIL_POINTS_PER_SWING` per swing, at least 30 per second. */
export function trailStepSec(frequency: number): number {
  return Math.min(1 / 30, 1 / (Math.max(frequency, 1e-6) * TRAIL_POINTS_PER_SWING));
}

/** How far back one bob's trail reaches and how fast it fades (see `trailReach()`). */
export interface TrailReach {
  windowSec: number;
  timeConstant: number;
}

/**
 * The trail of one bob of a rig of `bobs`: the setting's window and fade, unless its share of `MAX_TRAIL_POINTS` cannot
 * trace that window swing by swing (many fast bobs with long trails) – then the trail is shorter and fades over the
 * shorter window, so it still ends at `TRAIL_MIN_ALPHA` instead of being cut off, and it never degrades into long
 * aliased chords that would only paint over the whole rig.
 */
export function trailReach(trails: number, frequency: number, bobs: number, out: TrailReach): TrailReach {
  const full = trailWindowSec(trails);
  const budget = Math.max(2, Math.floor(MAX_TRAIL_POINTS / Math.max(1, bobs)));
  const reach = (budget - 1) * trailStepSec(frequency);
  if (full <= reach) {
    out.windowSec = full;
    out.timeConstant = trailTimeConstant(trails);
  } else {
    out.windowSec = reach;
    out.timeConstant = reach / Math.log(TRAIL_ALPHA / TRAIL_MIN_ALPHA);
  }
  return out;
}

/** Points (at least 2; 0 for an empty span) a bob of `frequency` is traced at over `spanSec` – at most its share of the budget for a span within its `trailReach()`. */
export function trailPointCount(spanSec: number, frequency: number): number {
  if (!(spanSec > 0)) return 0;
  return Math.max(2, Math.ceil(spanSec / trailStepSec(frequency) - 1e-9) + 1);
}

const REACH: TrailReach = { windowSec: 0, timeConstant: 1 };

/**
 * The fading trails, traced from the analytic swing (`placeBobAt()`) over the last `trailReach()` seconds of
 * simulation time – exactly the path every bob took, whatever the frame rate or speed – and drawn in
 * `TRAIL_BANDS` strokes of falling opacity per bob. Nothing accumulates between frames, so a trail fades out
 * completely (an offscreen layer faded by `destination-out` keeps an 8-bit residue of every path forever), it
 * freezes with a pause, follows a resize and starts empty on a restart.
 */
export function drawPendulumTrails(ctx: CanvasRenderingContext2D, view: PendulumView, scratch: BobPlacement) {
  const rig = view.rig;
  const trails = view.settings.trails;
  const n = view.bobs.length;
  const now = view.timeSec;
  if (!rig || !(trails > 0) || n === 0 || !(now > 0)) return;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, 0.7 * rig.bobRadius);
  for (let b = 0; b < n; b++) {
    const st = view.bobs[b];
    const reach = trailReach(trails, st.frequency, n, REACH);
    const span = Math.min(reach.windowSec, now);
    const points = trailPointCount(span, st.frequency);
    if (points < 2) continue;
    const dt = span / (points - 1);
    const perBand = Math.max(1, Math.ceil((points - 1) / TRAIL_BANDS));
    ctx.strokeStyle = `hsl(${Math.round(st.hue)}, 90%, 60%)`;
    placeBobAt(rig, view, st.index, st.frequency, now, scratch);
    let x = scratch.x;
    let y = scratch.y;
    // Bands of one opacity each, from the bob backwards; neighbouring bands share their end point.
    for (let k = 0; k < points - 1; ) {
      const kEnd = Math.min(points - 1, k + perBand);
      ctx.globalAlpha = trailAlpha(0.5 * (k + kEnd) * dt, reach.timeConstant);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = k + 1; j <= kEnd; j++) {
        placeBobAt(rig, view, st.index, st.frequency, now - j * dt, scratch);
        ctx.lineTo(scratch.x, scratch.y);
      }
      ctx.stroke();
      x = scratch.x;
      y = scratch.y;
      k = kEnd;
    }
  }
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

/** The rig of the layout in the wall colour: bar and pivots, pivot ring, radial guides and outline, rails or floor. */
export function drawPendulumRig(ctx: CanvasRenderingContext2D, view: PendulumView, o: PendulumRenderOptions) {
  const rig = view.rig;
  const f = view.field;
  if (!rig || !f) return;
  const n = rig.anchorX.length;
  if (n === 0) return;
  const thick = Math.max(1.5, o.wallThickness);
  const r = rig.bobRadius;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (rig.layout) {
    case "row": {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick + 2;
      line(ctx, rig.anchorX[0] - 3 * r, rig.barY, rig.anchorX[n - 1] + 3 * r, rig.barY);
      ctx.fillStyle = o.wallColor(0);
      const pr = Math.max(1.5, 0.3 * r);
      for (let i = 0; i < n; i++) dot(ctx, rig.anchorX[i], rig.barY, pr);
      break;
    }
    case "arc": {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, rig.ringRadius, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = o.wallColor(0);
      const pr = Math.max(1.5, 0.3 * r);
      for (let i = 0; i < n; i++) dot(ctx, rig.anchorX[i], rig.anchorY[i], pr);
      break;
    }
    case "circle":
    case "galaxy": {
      const outer = rig.rho0 + rig.rhoAmp;
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a = rig.direction[i] + view.frameAngle;
        line(ctx, f.cx, f.cy, f.cx + outer * Math.cos(a), f.cy + outer * Math.sin(a));
      }
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = thick;
      ctx.beginPath();
      const sides = view.settings.polygon;
      if (sides >= 3) {
        for (let k = 0; k <= sides; k++) {
          const a = view.polygonAngle + (TWO_PI * k) / sides;
          const x = f.cx + outer * Math.cos(a);
          const y = f.cy + outer * Math.sin(a);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else ctx.arc(f.cx, f.cy, outer, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = o.wallColor(0);
      dot(ctx, f.cx, f.cy, Math.max(2, 0.4 * r));
      break;
    }
    case "sliding": {
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = Math.max(1, 0.6 * thick);
      const x0 = f.cx - rig.swingX - r;
      const x1 = f.cx + rig.swingX + r;
      for (let i = 0; i < n; i++) {
        const y = rig.anchorY[i];
        line(ctx, x0, y, x1, y);
        line(ctx, x0, y - 0.6 * r, x0, y + 0.6 * r);
        line(ctx, x1, y - 0.6 * r, x1, y + 0.6 * r);
      }
      break;
    }
    case "bouncing": {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = o.wallColor(0);
      ctx.lineWidth = thick + 2;
      line(ctx, f.left, rig.floorY, f.right, rig.floorY);
      break;
    }
  }
  ctx.restore();
}

/** The bobs (with their strings, radius lines or floor shadows): rainbow by index, brightened for a moment after each note, glowing on request. */
export function drawPendulumBobs(ctx: CanvasRenderingContext2D, balls: Ball[], view: PendulumView, o: PendulumRenderOptions) {
  const rig = view.rig;
  if (!rig) return;
  const layout = rig.layout;
  ctx.save();
  ctx.lineCap = "round";
  for (const ball of balls) {
    const st = view.byId.get(ball.id);
    if (!st) continue;
    const r = ball.radius;
    const hue = Math.round(st.hue);
    const age = ticksAgoMs(view, st.lastNoteTick);
    const flash = age < NOTE_FLASH_MS ? 1 - age / NOTE_FLASH_MS : 0;
    const i = st.index;
    // The string (row, arc), the radius line (circle, galaxy) or the floor shadow (bouncing).
    if (layout === "row" || layout === "arc") {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `hsla(${hue}, 70%, 78%, ${(0.5 + 0.4 * flash).toFixed(2)})`;
      ctx.lineWidth = flash > 0 ? 1.6 : 1;
      line(ctx, rig.anchorX[i], rig.anchorY[i], ball.x, ball.y);
    } else if (layout === "circle" || layout === "galaxy") {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `hsla(${hue}, 70%, 70%, ${(0.25 + 0.4 * flash).toFixed(2)})`;
      ctx.lineWidth = 1;
      line(ctx, rig.anchorX[i], rig.anchorY[i], ball.x, ball.y);
    } else if (layout === "bouncing") {
      const height = rig.anchorY[i] - r - ball.y;
      const k = 1 - Math.min(1, height / Math.max(1, rig.length[i]));
      ctx.globalAlpha = 0.12 + 0.3 * k;
      ctx.fillStyle = `hsl(${hue}, 60%, 45%)`;
      ctx.beginPath();
      ctx.ellipse(ball.x, rig.anchorY[i], r * (0.5 + 0.6 * k), Math.max(1, 0.22 * r), 0, 0, TWO_PI);
      ctx.fill();
    }
    // Glow: two enlarged translucent discs (cheaper than a shadow blur).
    const glow = (o.showGlow ? 0.5 : 0) + 0.6 * flash;
    if (glow > 0.01) {
      ctx.fillStyle = `hsl(${hue}, 90%, 62%)`;
      ctx.globalAlpha = glow * 0.22;
      dot(ctx, ball.x, ball.y, r * 1.35 + 2);
      ctx.globalAlpha = glow * 0.1;
      dot(ctx, ball.x, ball.y, r * 1.8 + 4);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = `hsl(${hue}, 90%, ${Math.round(62 + 28 * flash)}%)`;
    dot(ctx, ball.x, ball.y, r);
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.3 + 0.5 * flash).toFixed(2)})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (r >= 3) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      dot(ctx, ball.x - 0.3 * r, ball.y - 0.3 * r, 0.33 * r);
    }
  }
  ctx.restore();
}

/** The white full-screen flash of a big chord – most of the row in line (screen space, outside the camera transform). */
export function drawPendulumChordFlash(ctx: CanvasRenderingContext2D, width: number, height: number, view: PendulumView) {
  if (view.lastChordSize < CHORD_FLASH_MIN_NOTES) return;
  const age = ticksAgoMs(view, view.lastChordTick);
  if (age >= CHORD_FLASH_MS) return;
  const strength = Math.min(1, view.lastChordSize / Math.max(1, view.bobs.length));
  const a = 0.4 * strength * (1 - age / CHORD_FLASH_MS);
  if (a < 0.005) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
