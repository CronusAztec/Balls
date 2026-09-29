import type { Ball } from "./types";

/**
 * Generic obstacles: circles (pegs) and straight bars (segments, optionally spinning around
 * their centre) that balls bounce off wherever they sit in the arena. The engine keeps a list
 * of them (`engine.getObstacles()`, set by a mode through `ctx.setObstacles()`), resolves every
 * ball against every obstacle in each sub-step and reports the hard hits to the mode
 * (`GameMode.onObstacleHit`) and to the canvas, which draws obstacles in the wall colour with
 * the wall glow. Ball Drop builds its peg board and playfield walls out of them; an obstacle
 * editor can reuse the same pieces in any mode.
 *
 * Everything here is pure and deterministic – no randomness, no wall-clock time – so seeds and
 * Find Simulation replay identically with obstacles in play. The resolvers mutate the ball in
 * place (position push-out and velocity impulse) and never allocate, so they are cheap enough
 * to run for 40 balls × 60 obstacles × 240 sub-steps per second.
 */

export interface CircleObstacle {
  kind: "circle";
  x: number;
  y: number;
  radius: number;
  /** Fraction of the approach speed kept along the contact normal (0 = dead stop, 1 = elastic). */
  restitution: number;
  /** Fraction of the sliding (tangential) speed lost at every resolved contact, 0–1. */
  friction: number;
}

export interface SegmentObstacle {
  kind: "segment";
  /** Centre of the bar. */
  x: number;
  y: number;
  /** Half the bar's length in px. */
  halfLength: number;
  /** Orientation in radians, 0 = horizontal (the screen's y axis points down, so positive angles turn clockwise). */
  angle: number;
  /** Radians per second the bar spins around its centre; 0 = a static bar. */
  angularVelocity: number;
  /** Full thickness in px; the collision treats the bar as a capsule of this width (0 = a thin line). */
  thickness: number;
  restitution: number;
  friction: number;
}

export type Obstacle = CircleObstacle | SegmentObstacle;

export interface ObstacleOptions {
  restitution?: number;
  friction?: number;
}

export interface SegmentOptions extends ObstacleOptions {
  angularVelocity?: number;
  thickness?: number;
}

/** Endpoints of a bar, written by `segmentEndpoints()` into a caller-owned object (no allocation per frame). */
export interface SegmentEnds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A peg keeps 70% of the approach speed; walls and floors usually get less (see Ball Drop). */
export const DEFAULT_OBSTACLE_RESTITUTION = 0.7;
/** 2% of the sliding speed per contact: a ball skidding along a floor stops within a second, a glancing peg hit is barely touched. */
export const DEFAULT_OBSTACLE_FRICTION = 0.02;
/** Highest restitution an obstacle may end up with (the wall-bounciness extra scales it), so a ball can never gain energy forever on a floor. */
export const MAX_OBSTACLE_RESTITUTION = 0.98;
/** Gap left between a ball and an obstacle after a push-out, so the next sub-step does not re-detect the same contact. */
const SEPARATION = 0.01;

export function circleObstacle(x: number, y: number, radius: number, options: ObstacleOptions = {}): CircleObstacle {
  return { kind: "circle", x, y, radius, restitution: options.restitution ?? DEFAULT_OBSTACLE_RESTITUTION, friction: options.friction ?? DEFAULT_OBSTACLE_FRICTION };
}

export function segmentObstacle(x: number, y: number, halfLength: number, angle: number, options: SegmentOptions = {}): SegmentObstacle {
  return {
    kind: "segment",
    x,
    y,
    halfLength,
    angle,
    angularVelocity: options.angularVelocity ?? 0,
    thickness: options.thickness ?? 0,
    restitution: options.restitution ?? DEFAULT_OBSTACLE_RESTITUTION,
    friction: options.friction ?? DEFAULT_OBSTACLE_FRICTION,
  };
}

/** A bar between two points (a wall, a floor…). */
export function segmentBetween(x1: number, y1: number, x2: number, y2: number, options: SegmentOptions = {}): SegmentObstacle {
  return segmentObstacle((x1 + x2) / 2, (y1 + y2) / 2, Math.hypot(x2 - x1, y2 - y1) / 2, Math.atan2(y2 - y1, x2 - x1), options);
}

/** The two endpoints of a bar at its current angle. */
export function segmentEndpoints(segment: SegmentObstacle, out: SegmentEnds = { x1: 0, y1: 0, x2: 0, y2: 0 }): SegmentEnds {
  const dx = Math.cos(segment.angle) * segment.halfLength;
  const dy = Math.sin(segment.angle) * segment.halfLength;
  out.x1 = segment.x - dx;
  out.y1 = segment.y - dy;
  out.x2 = segment.x + dx;
  out.y2 = segment.y + dy;
  return out;
}

/** True when any bar spins, i.e. when `advanceObstacles()` has work to do. */
export function hasSpinningObstacles(obstacles: readonly Obstacle[]): boolean {
  for (const o of obstacles) if (o.kind === "segment" && o.angularVelocity !== 0) return true;
  return false;
}

/** Turns every spinning bar by its angular velocity over `dtSec` (the angle is kept in (−π, π]). */
export function advanceObstacles(obstacles: readonly Obstacle[], dtSec: number): void {
  for (const o of obstacles) {
    if (o.kind !== "segment" || o.angularVelocity === 0) continue;
    let a = o.angle + o.angularVelocity * dtSec;
    if (a > Math.PI || a <= -Math.PI) a -= Math.floor((a + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
    o.angle = a;
  }
}

/**
 * Resolves `ball` against `obstacle`: pushes the ball out of the obstacle and applies the rebound
 * (restitution × `restitutionScale`, capped at MAX_OBSTACLE_RESTITUTION) when the ball is moving
 * into it, plus the contact friction. `dtSec` is the length of the sub-step that moved the ball to
 * its current position; it lets the resolver look at where the ball came from, so a fast ball that
 * crossed a thin bar or passed a peg's centre in one step is still bounced back to the side it came
 * from instead of popping out on the far side.
 *
 * Returns −1 when the ball does not touch the obstacle, otherwise the approach speed along the
 * contact normal (≥ 0; 0 for a resting or already separating contact). Callers use it to decide
 * whether the contact counts as a "hit" worth a sound and a glow.
 */
export function resolveBallObstacle(ball: Ball, obstacle: Obstacle, dtSec: number, restitutionScale = 1): number {
  return obstacle.kind === "circle" ? resolveBallCircle(ball, obstacle, dtSec, restitutionScale) : resolveBallSegment(ball, obstacle, dtSec, restitutionScale);
}

/** Ball vs peg: swept circle-circle test, so the contact normal is taken where the ball first touched the peg. */
export function resolveBallCircle(ball: Ball, peg: CircleObstacle, dtSec: number, restitutionScale = 1): number {
  const R = ball.radius + peg.radius;
  const dx = ball.x - peg.x;
  const dy = ball.y - peg.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return -1;

  // Where the ball was at the start of the sub-step (the engine integrates x += vx·dt before calling us).
  const mx = ball.vx * dtSec;
  const my = ball.vy * dtSec;
  const px = dx - mx;
  const py = dy - my;
  let nx: number;
  let ny: number;
  const p2 = px * px + py * py;
  const mm = mx * mx + my * my;
  if (p2 >= R * R && mm > 0) {
    // The ball came from outside: find the first moment of contact along its path, |p + t·m| = R.
    const b = px * mx + py * my;
    const c = p2 - R * R;
    const disc = b * b - mm * c;
    const t = disc >= 0 ? (-b - Math.sqrt(disc)) / mm : 0;
    const cx = px + mx * Math.max(0, Math.min(1, t));
    const cy = py + my * Math.max(0, Math.min(1, t));
    const len = Math.hypot(cx, cy);
    if (len > 1e-9) {
      nx = cx / len;
      ny = cy / len;
    } else {
      nx = 0;
      ny = -1;
    }
  } else {
    // Already overlapping before the step (a spawn inside, a push from another ball): push out radially.
    const dist = Math.sqrt(d2);
    if (dist > 1e-9) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const speed = Math.hypot(ball.vx, ball.vy);
      nx = speed > 1e-9 ? -ball.vx / speed : 0;
      ny = speed > 1e-9 ? -ball.vy / speed : -1;
    }
  }
  ball.x = peg.x + nx * (R + SEPARATION);
  ball.y = peg.y + ny * (R + SEPARATION);
  return rebound(ball, nx, ny, 0, 0, peg.restitution * restitutionScale, peg.friction);
}

/**
 * Ball vs bar: the bar is a capsule (its thickness plus the ball's radius around the centre line).
 * A ball that crossed the centre line within the step is treated as having hit the side it came
 * from. A spinning bar's surface velocity at the contact point is taken into account, so it can
 * fling the ball.
 */
export function resolveBallSegment(ball: Ball, bar: SegmentObstacle, dtSec: number, restitutionScale = 1): number {
  const ux = Math.cos(bar.angle);
  const uy = Math.sin(bar.angle);
  const reach = ball.radius + bar.thickness / 2;
  // Position of the ball relative to the bar's centre, projected on the bar (`along`) and across it (`across`).
  const rx = ball.x - bar.x;
  const ry = ball.y - bar.y;
  const along = rx * ux + ry * uy;
  const across = -rx * uy + ry * ux;
  const clamped = Math.max(-bar.halfLength, Math.min(bar.halfLength, along));
  // Vector from the closest point of the centre line to the ball.
  const qx = rx - clamped * ux;
  const qy = ry - clamped * uy;
  const dist2 = qx * qx + qy * qy;

  const mx = ball.vx * dtSec;
  const my = ball.vy * dtSec;
  // Where the ball started this sub-step, in bar coordinates.
  const prevAlong = along - (mx * ux + my * uy);
  const prevAcross = across - (-mx * uy + my * ux);
  const crossed = prevAcross * across < 0 && Math.abs(prevAlong) <= bar.halfLength + ball.radius && Math.abs(along) <= bar.halfLength + ball.radius;
  if (dist2 >= reach * reach && !crossed) return -1;

  let nx: number;
  let ny: number;
  let baseX: number;
  let baseY: number;
  if (crossed || Math.abs(along) <= bar.halfLength) {
    // Flat side of the bar: the normal is the bar's perpendicular, pointing to the side the ball came from.
    const side = crossed ? (prevAcross > 0 ? 1 : -1) : across !== 0 ? Math.sign(across) : prevAcross !== 0 ? Math.sign(prevAcross) : -1;
    nx = -uy * side;
    ny = ux * side;
    baseX = bar.x + clamped * ux;
    baseY = bar.y + clamped * uy;
  } else {
    // Rounded end cap: radial from the endpoint.
    const dist = Math.sqrt(dist2);
    baseX = bar.x + clamped * ux;
    baseY = bar.y + clamped * uy;
    if (dist > 1e-9) {
      nx = qx / dist;
      ny = qy / dist;
    } else {
      nx = -uy;
      ny = ux;
    }
  }
  ball.x = baseX + nx * (reach + SEPARATION);
  ball.y = baseY + ny * (reach + SEPARATION);
  // Surface velocity of a spinning bar at the contact point: ω × r.
  let sx = 0;
  let sy = 0;
  if (bar.angularVelocity !== 0) {
    const cx = baseX - bar.x;
    const cy = baseY - bar.y;
    sx = -bar.angularVelocity * cy;
    sy = bar.angularVelocity * cx;
  }
  return rebound(ball, nx, ny, sx, sy, bar.restitution * restitutionScale, bar.friction);
}

/**
 * Applies the collision response for a contact with unit normal (nx, ny) pointing from the obstacle
 * to the ball and a surface moving at (sx, sy): the normal component of the relative velocity is
 * reflected with `restitution` when the ball approaches, and the tangential component loses
 * `friction`. Returns the approach speed (0 when the ball was not moving into the surface).
 */
export function rebound(ball: Ball, nx: number, ny: number, sx: number, sy: number, restitution: number, friction: number): number {
  const e = Math.max(0, Math.min(MAX_OBSTACLE_RESTITUTION, restitution));
  let rvx = ball.vx - sx;
  let rvy = ball.vy - sy;
  const vn = rvx * nx + rvy * ny;
  let impact = 0;
  if (vn < 0) {
    const j = -(1 + e) * vn;
    ball.vx += j * nx;
    ball.vy += j * ny;
    impact = -vn;
    rvx += j * nx;
    rvy += j * ny;
  }
  if (friction > 0) {
    const f = Math.min(1, friction);
    const vn2 = rvx * nx + rvy * ny;
    ball.vx -= f * (rvx - vn2 * nx);
    ball.vy -= f * (rvy - vn2 * ny);
  }
  return impact;
}
