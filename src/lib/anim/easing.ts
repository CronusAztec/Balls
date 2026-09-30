/**
 * Easing and spring curves shared by the animations of the site (first used by Beat Drop's obstructions, feature
 * beat-drop – src/lib/physics/modes/beatDrop.ts and components/simulator/beatDropRenderer.ts). Every function is pure,
 * maps a progress `t` in [0, 1] to an eased value (clamped outside it, so a caller never has to), allocates nothing and
 * is deterministic, so an animation driven by the simulation clock replays frame for frame in a recording or a fast
 * export. `ease*Out*` curves start fast and settle (arrivals), `ease*In*` curves start slow and speed up (departures);
 * the `Back` variants overshoot a little (the default overshoot 1.70158 gives the classic ~10 % pull-back).
 */

export type Easing = (t: number) => number;

/** `t` clamped to [0, 1]; NaN counts as 0. */
export function clamp01(t: number): number {
  return t > 0 ? (t < 1 ? t : 1) : 0;
}

/** Linear interpolation from `a` to `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where `value` lies between `a` and `b` as a 0–1 fraction (clamped); 0 when a = b. */
export function progress(a: number, b: number, value: number): number {
  return b !== a ? clamp01((value - a) / (b - a)) : value >= b ? 1 : 0;
}

export function linear(t: number): number {
  return clamp01(t);
}

export function easeInQuad(t: number): number {
  const u = clamp01(t);
  return u * u;
}

export function easeOutQuad(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u;
}

export function easeInCubic(t: number): number {
  const u = clamp01(t);
  return u * u * u;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** The classic overshoot of the Back curves. */
export const BACK_OVERSHOOT = 1.70158;

/** Starts by pulling back a little (below 0), then accelerates to 1. */
export function easeInBack(t: number, overshoot = BACK_OVERSHOOT): number {
  const u = clamp01(t);
  return (overshoot + 1) * u * u * u - overshoot * u * u;
}

/** Shoots past 1 a little and settles back on it – an arrival with a bit of bounce. */
export function easeOutBack(t: number, overshoot = BACK_OVERSHOOT): number {
  const u = clamp01(t) - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

/** Hermite smoothstep: zero slope at both ends. */
export function smoothstep(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** Largest value `easeOutBack` reaches (at t = 2·s / (3·(s + 1))) – how far past the target an arrival overshoots. */
export function easeOutBackPeak(overshoot = BACK_OVERSHOOT): number {
  const t = 1 - (2 * overshoot) / (3 * (overshoot + 1));
  return easeOutBack(t, overshoot);
}

/**
 * A damped spring let go at `age` seconds after a kick: 1 at the kick, oscillating around 0 at `frequency` Hz and dying
 * away with the damping ratio `damping` (0 < damping < 1: under-damped, a wobble). 0 before the kick (negative age).
 * Scale it by an amplitude for squash-and-stretch, a pad's give or a glow's pulse.
 */
export function springDecay(age: number, frequency: number, damping: number): number {
  if (!(age >= 0) || !Number.isFinite(age)) return 0;
  const w = 2 * Math.PI * Math.max(0, frequency);
  const z = Math.max(0, Math.min(0.999, damping));
  const wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * age) * Math.cos(wd * age);
}

/**
 * One step of a critically damped spring toward a fixed `target` (the exact solution over `dt`, so the result does not
 * depend on how the time is cut into steps): `state.x` moves to the target without overshooting, `state.v` is its
 * velocity; `omega` (rad/s) sets how quickly (the settling time is about 4.7 / omega). In place.
 */
export function criticallyDampedStep(state: { x: number; v: number }, target: number, omega: number, dt: number): void {
  if (!(dt > 0) || !(omega > 0)) return;
  const e = state.x - target;
  const k = state.v + omega * e;
  const decay = Math.exp(-omega * dt);
  state.x = target + (e + k * dt) * decay;
  state.v = (state.v - omega * k * dt) * decay;
}

/** Every easing by name (the ones an obstruction may arrive or leave with). */
export const EASINGS = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInBack: (t: number) => easeInBack(t),
  easeOutBack: (t: number) => easeOutBack(t),
  smoothstep,
} as const satisfies Record<string, Easing>;

export type EasingName = keyof typeof EASINGS;
