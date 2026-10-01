import type { Ball, BallInteractionConfig, NewBall } from "./types";
import { isBallInteraction, TWO_PI } from "./types";
import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Ball interactions: what balls do to each other, and to themselves when they break a wall.
 *
 * - "bounce" (the default): the classic equal-mass elastic rebound in `PhysicsEngine.handleBallCollision()`.
 * - "merge": two touching balls fuse into one whose area is the sum of both (radius √(r₁² + r₂²)), with the
 *   momentum conserved (mass ∝ area) and the colours blended by mass.
 * - "split": every time a ball breaks through a wall – the engine's gap pass, a Multiply escape, a Shatter
 *   segment – it splits into two balls of half the area (radius r/√2) that fly apart, as long as both halves
 *   stay at least `splitMinRadius` big and there are fewer than `maxBalls` balls.
 * - "pass": balls ignore each other.
 *
 * Everything here is pure: the engine applies the results, and the only randomness (the divergence angle of
 * a split) comes from the `random` function the caller passes in – the engine hands over its seeded RNG, so
 * seeds and the finder stay deterministic. The settings travel inside `PhysicsConfig` like the physics extras
 * (`BallInteractionConfig` in types.ts), resolved by `resolveBallInteraction()`.
 */

export const DEFAULT_BALL_INTERACTION: BallInteractionConfig = {
  ballInteraction: "bounce",
  splitMinRadius: 4,
  maxBalls: 16,
};

/** Slider ranges (also used to validate URL parameters and presets; spread into `RANGES` in settings.ts). */
export const BALL_INTERACTION_RANGES = {
  splitMinRadius: { min: 4, max: 20, step: 1 },
  maxBalls: { min: 2, max: 64, step: 1 },
} as const;

/** Half-angle (radians) between the two halves of a split: 20°–36°, so the pair visibly diverges. */
export const SPLIT_HALF_ANGLE_MIN = Math.PI / 9;
export const SPLIT_HALF_ANGLE_MAX = Math.PI / 5;
/** Sideways speed (px/s) the halves of a resting ball get; a moving ball's halves scale with its own speed. */
const SPLIT_REST_SPEED = 200;
/** Tolerance of the smallest-half check, so 8 px → 5.66 px → 4 px halves still count as "at least 4 px". */
const RADIUS_EPSILON = 1e-6;

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(atLeastMin(n, range)) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Fills in the defaults and clamps the split limits to whole numbers in their ranges (bad or unknown input falls back to the defaults). */
export function resolveBallInteraction(config: Partial<BallInteractionConfig> | null | undefined): BallInteractionConfig {
  const out = { ...DEFAULT_BALL_INTERACTION };
  if (!config) return out;
  if (isBallInteraction(config.ballInteraction)) out.ballInteraction = config.ballInteraction;
  if (config.splitMinRadius !== undefined) out.splitMinRadius = clampInt(config.splitMinRadius, BALL_INTERACTION_RANGES.splitMinRadius, out.splitMinRadius);
  if (config.maxBalls !== undefined) out.maxBalls = clampInt(config.maxBalls, BALL_INTERACTION_RANGES.maxBalls, out.maxBalls);
  return out;
}

/** Picks the interaction settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setConfig()`. */
export function ballInteractionOf(source: BallInteractionConfig): BallInteractionConfig {
  return { ballInteraction: source.ballInteraction, splitMinRadius: source.splitMinRadius, maxBalls: source.maxBalls };
}

/* ------------------------------------------------------------------ merge */

/** Radius of the ball that holds the area of two balls: √(r₁² + r₂²). */
export function mergedRadius(r1: number, r2: number): number {
  return Math.sqrt(r1 * r1 + r2 * r2);
}

export type BallBody = Pick<Ball, "x" | "y" | "vx" | "vy" | "radius" | "color">;

/**
 * The ball two balls fuse into. Mass is proportional to area (r²), so the merged ball sits at the
 * mass-weighted centre, keeps the total momentum (m₁v₁ + m₂v₂ = (m₁ + m₂)v) and wears the mass-weighted
 * blend of both colours.
 */
export function mergeBalls(a: BallBody, b: BallBody): BallBody {
  const ma = a.radius * a.radius;
  const mb = b.radius * b.radius;
  const wb = mb / (ma + mb);
  const wa = 1 - wb;
  return {
    x: a.x * wa + b.x * wb,
    y: a.y * wa + b.y * wb,
    vx: a.vx * wa + b.vx * wb,
    vy: a.vy * wa + b.vy * wb,
    radius: mergedRadius(a.radius, b.radius),
    color: blendColors(a.color, b.color, wb),
  };
}

/** `#rgb` / `#rrggbb` → [r, g, b], or null for any other colour string. */
export function parseHexColor(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear blend of two hex colours (`t` = 0 → `a`, 1 → `b`); when either is not hex the weightier one wins outright. */
export function blendColors(a: string, b: string, t: number): string {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  const w = Math.max(0, Math.min(1, t));
  const channel = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * w);
  return `#${[channel(0), channel(1), channel(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------------ split */

/** Radius of each half of a ball: r/√2, so the two halves together hold the ball's area. */
export function splitRadius(radius: number): number {
  return radius / Math.SQRT2;
}

/** True when a ball of `radius` may split: both halves stay at least `minRadius` big and the cap leaves room for one more ball. */
export function canSplit(radius: number, minRadius: number, ballCount: number, maxBalls: number): boolean {
  return splitRadius(radius) + RADIUS_EPSILON >= minRadius && ballCount < maxBalls;
}

export type SplitHalf = Omit<NewBall, "color" | "lifetime" | "frozen">;

/**
 * The two halves of a ball. They sit side by side across the direction of flight (just not touching) and each
 * flies on with the ball's velocity plus an equal and opposite sideways push – so the pair keeps the ball's
 * momentum (each half has half the mass) while diverging by twice the half-angle drawn from `random`. A
 * resting ball's halves get a fixed sideways speed in a random direction.
 */
export function splitBall(ball: Pick<Ball, "x" | "y" | "vx" | "vy" | "radius">, random: () => number): [SplitHalf, SplitHalf] {
  const radius = splitRadius(ball.radius);
  const speed = Math.hypot(ball.vx, ball.vy);
  let dx: number;
  let dy: number;
  if (speed > 0) {
    dx = ball.vx / speed;
    dy = ball.vy / speed;
  } else {
    const a = random() * TWO_PI;
    dx = Math.cos(a);
    dy = Math.sin(a);
  }
  const halfAngle = SPLIT_HALF_ANGLE_MIN + (SPLIT_HALF_ANGLE_MAX - SPLIT_HALF_ANGLE_MIN) * random();
  const push = (speed > 0 ? speed : SPLIT_REST_SPEED) * Math.tan(halfAngle);
  const nx = -dy;
  const ny = dx;
  const offset = 1.05 * radius;
  return [
    { x: ball.x + nx * offset, y: ball.y + ny * offset, vx: ball.vx + nx * push, vy: ball.vy + ny * push, radius },
    { x: ball.x - nx * offset, y: ball.y - ny * offset, vx: ball.vx - nx * push, vy: ball.vy - ny * push, radius },
  ];
}
