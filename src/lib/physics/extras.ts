import type { PhysicsExtras } from "./types";

/**
 * "Physics extras": air drag, wind, spin (with a Magnus-style curve force), wall bounciness,
 * breathing walls and rotating gravity. They travel inside `PhysicsConfig` (see types.ts) and
 * the engine applies them in its fixed 60 Hz steps and sub-steps. Everything here is pure and
 * deterministic – no randomness, no wall-clock time – so a seed found by the finder replays
 * identically with the extras on. Every extra is off by default (`DEFAULT_PHYSICS_EXTRAS`),
 * and the engine takes its old code path whenever an extra sits at its default, so existing
 * seeds and links behave exactly as before.
 */

export const DEFAULT_PHYSICS_EXTRAS: PhysicsExtras = {
  airDrag: 0,
  windX: 0,
  windY: 0,
  spinStrength: 0,
  wallBounciness: 1,
  breathingAmplitude: 0,
  breathingSpeed: 1,
  rotatingGravity: 0,
};

/** Slider ranges (also used to validate URL parameters and presets; spread into `RANGES` in settings.ts). */
export const PHYSICS_EXTRA_RANGES = {
  airDrag: { min: 0, max: 0.05, step: 0.001 },
  windX: { min: -0.5, max: 0.5, step: 0.01 },
  windY: { min: -0.5, max: 0.5, step: 0.01 },
  spinStrength: { min: 0, max: 1, step: 0.05 },
  wallBounciness: { min: 0.5, max: 1.2, step: 0.05 },
  breathingAmplitude: { min: 0, max: 0.3, step: 0.01 },
  breathingSpeed: { min: 0.1, max: 3, step: 0.1 },
  rotatingGravity: { min: 0, max: 180, step: 5 },
} as const;

export const PHYSICS_EXTRA_KEYS = Object.keys(DEFAULT_PHYSICS_EXTRAS) as (keyof PhysicsExtras)[];

/**
 * Magnus force scale: acceleration = spinStrength × MAGNUS_COEFFICIENT × spin × (−vy, vx).
 * With a full-strength spin of ~50 rad/s (a 400 px/s ball rolling on an 8 px radius) and a
 * 400 px/s flight this gives ~240 px/s², a curve comparable to the default gravity.
 */
export const MAGNUS_COEFFICIENT = 0.012;
/** Spin lost per second in flight (exponential), so the sprite rotation eases off between hits. */
export const SPIN_DECAY_PER_SECOND = 0.5;

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

function clamp(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults for missing extras and clamps every value to its range (bad input falls back to the default). */
export function resolvePhysicsExtras(config: Partial<PhysicsExtras> | null | undefined): PhysicsExtras {
  const out = { ...DEFAULT_PHYSICS_EXTRAS };
  if (!config) return out;
  for (const key of PHYSICS_EXTRA_KEYS) {
    if (config[key] !== undefined) out[key] = clamp(config[key], PHYSICS_EXTRA_RANGES[key], DEFAULT_PHYSICS_EXTRAS[key]);
  }
  return out;
}

/** Picks the extras out of a bigger object (the SimulatorSettings, a preset…) for `engine.setConfig()`. */
export function physicsExtrasOf(source: PhysicsExtras): PhysicsExtras {
  return {
    airDrag: source.airDrag,
    windX: source.windX,
    windY: source.windY,
    spinStrength: source.spinStrength,
    wallBounciness: source.wallBounciness,
    breathingAmplitude: source.breathingAmplitude,
    breathingSpeed: source.breathingSpeed,
    rotatingGravity: source.rotatingGravity,
  };
}

/** True when any extra is away from its default (i.e. the run would differ from the plain engine). */
export function hasPhysicsExtras(extras: PhysicsExtras): boolean {
  return PHYSICS_EXTRA_KEYS.some((key) => extras[key] !== DEFAULT_PHYSICS_EXTRAS[key]);
}

/**
 * Direction of gravity in radians at simulation time `tSec`: straight down (+y, π/2) at t = 0,
 * turning by `rotatingGravity` degrees per second.
 */
export function gravityAngle(rotatingGravity: number, tSec: number): number {
  return Math.PI / 2 + rotatingGravity * DEG * tSec;
}

/**
 * Direction of gravity in radians after it has turned `turnedDeg` degrees from straight down – the angle for a turning
 * rate that changes over time (timeline keyframes), where `turnedDeg` is the rate integrated since t = 0.
 */
export function gravityAngleTurned(turnedDeg: number): number {
  return Math.PI / 2 + turnedDeg * DEG;
}

/** Wall radius multiplier at simulation time `tSec`: 1 ± amplitude, `speedHz` pulses per second, 1 at t = 0. */
export function breathingScale(amplitude: number, speedHz: number, tSec: number): number {
  if (amplitude === 0) return 1;
  return 1 + amplitude * Math.sin(TWO_PI * speedHz * tSec);
}

/**
 * Wall radius multiplier after `cycles` pulses (1 ± amplitude, 1 at 0 cycles) – for a pulse speed that changes over
 * time (timeline keyframes), where `cycles` is the speed integrated since t = 0.
 */
export function breathingScaleAtPhase(amplitude: number, cycles: number): number {
  if (amplitude === 0) return 1;
  return 1 + amplitude * Math.sin(TWO_PI * cycles);
}

/**
 * Angular velocity (rad/s) a ball would pick up by rolling against the wall it just touched,
 * i.e. the no-slip condition at the contact point. `(nx, ny)` is the unit vector from the
 * arena centre to the ball, `inside` tells whether the ball is inside the ring (the contact
 * point is then on its outer side), and `surfaceSpeed` is the wall's own tangential speed at
 * the contact (rotation rate × radius, positive towards increasing angle).
 */
export function contactSpin(vx: number, vy: number, nx: number, ny: number, inside: boolean, surfaceSpeed: number, ballRadius: number): number {
  // Tangential velocity of the ball along the direction of increasing angle, (−ny, nx).
  const tangential = -vx * ny + vy * nx;
  const relative = tangential - surfaceSpeed;
  return inside ? -relative / ballRadius : relative / ballRadius;
}

/** Per-sub-step factor that leaves the spin decayed by `SPIN_DECAY_PER_SECOND` after one second. */
export function spinDecayFactor(subSec: number): number {
  return Math.exp(-SPIN_DECAY_PER_SECOND * subSec);
}
