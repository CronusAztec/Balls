/**
 * The small maths behind a ball character's eyes and body (see ./character.ts), pure and allocation-free:
 *
 *  - eye tracking: `lookTarget()` points the pupils along the velocity, saturating smoothly with speed, and
 *    `smoothToward()` eases the look with a frame-rate independent exponential (two half steps = one full step);
 *  - blinking on a seeded schedule: `BlinkClock` walks a Mulberry32 sequence seeded from the run's seed and the
 *    ball id, so the same seed blinks at the same simulation times in every run and every recording, whatever
 *    the frame rate or the playback speed; `blinkSchedule()` lists the same blinks for tests and tools;
 *  - squash and stretch: `squashAmount()` is a damped oscillation after an impact (squash, then a smaller
 *    stretch), `squashScales()` turns it into the along / across scale factors the canvas applies.
 */

/* ------------------------------------------------------------------ eye tracking */

/** Speed (px/s) at which the look reaches ~63 % of its range (1 − e⁻¹); faster flights look further ahead. */
export const LOOK_REF_SPEED = 220;
/** Time constant (ms) of the eased look. */
export const LOOK_TAU_MS = 70;

export interface Vec {
  x: number;
  y: number;
}

/**
 * Writes into `out` the pupil offset for a ball flying at (vx, vy): along the velocity, of length
 * `maxOffset × (1 − e^(−speed / refSpeed))` – zero at rest, never beyond `maxOffset`. Returns `out`.
 */
export function lookTarget(vx: number, vy: number, maxOffset: number, out: Vec, refSpeed = LOOK_REF_SPEED): Vec {
  const speed = Math.hypot(vx, vy);
  if (!(speed > 1e-6) || !(maxOffset > 0) || !Number.isFinite(speed)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const reach = maxOffset * (1 - Math.exp(-speed / Math.max(1e-6, refSpeed)));
  out.x = (vx / speed) * reach;
  out.y = (vy / speed) * reach;
  return out;
}

/** Eases `current` toward `target` over `dtMs` with time constant `tauMs` (frame-rate independent). */
export function smoothToward(current: number, target: number, dtMs: number, tauMs = LOOK_TAU_MS): number {
  if (!(dtMs > 0)) return current;
  if (!(tauMs > 0)) return target;
  return target + (current - target) * Math.exp(-dtMs / tauMs);
}

/* ------------------------------------------------------------------ blinking */

/** Gap between two blinks (ms), drawn uniformly per blink. */
export const BLINK_MIN_GAP_MS = 1800;
export const BLINK_MAX_GAP_MS = 5000;
/** Length of one blink (ms): the lid closes fast and opens a little slower. */
export const BLINK_MS = 150;
/** Share of blinks followed by a second one `DOUBLE_BLINK_GAP_MS` later. */
export const DOUBLE_BLINK_CHANCE = 0.18;
export const DOUBLE_BLINK_GAP_MS = 230;
/** Share of a blink spent closing (the rest is opening). */
const BLINK_CLOSE_SHARE = 0.4;

/** Mixes the run's seed and a ball id into one 32-bit seed (so every ball of a run blinks on its own schedule). */
export function blinkSeed(seed: number, ballId: number): number {
  let h = (seed | 0) ^ Math.imul((ballId | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) | 0;
}

/**
 * The lid closure (0 open … 1 shut) at `phase` = time since the blink started ÷ `BLINK_MS`; 0 outside a blink.
 */
export function blinkClosure(phase: number): number {
  if (!(phase >= 0) || phase >= 1) return 0;
  return phase < BLINK_CLOSE_SHARE ? phase / BLINK_CLOSE_SHARE : 1 - (phase - BLINK_CLOSE_SHARE) / (1 - BLINK_CLOSE_SHARE);
}

/**
 * A ball's blink schedule as a cursor over a seeded sequence: `closure(t)` answers for any simulation time,
 * walking forward from the last answer (constant work per frame) and starting over when the time goes back (a
 * restart). The schedule depends only on the seed, never on when or how often it is sampled.
 */
export class BlinkClock {
  private seed = 0;
  private rng = 0;
  /** Start of the current / next blink (ms). */
  private start = 0;
  /** Whether the blink the cursor is on is the quick second one of a double blink. */
  private pendingDouble = false;
  private lastT = 0;

  constructor(seed = 0) {
    this.reset(seed);
  }

  reset(seed: number) {
    this.seed = seed | 0;
    this.rng = this.seed;
    this.pendingDouble = false;
    this.lastT = 0;
    // The first blink comes after a normal gap, never at t = 0 (a face that starts with its eyes shut looks broken).
    this.start = this.nextGap();
  }

  /** Mulberry32 (the engine's generator), private to this clock. */
  private random(): number {
    let t = (this.rng += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  private nextGap(): number {
    return BLINK_MIN_GAP_MS + (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS) * this.random();
  }

  /** Moves the cursor to the blink after the current one (a double blink never becomes a triple). */
  private advance() {
    if (!this.pendingDouble && this.random() < DOUBLE_BLINK_CHANCE) {
      this.pendingDouble = true;
      this.start += DOUBLE_BLINK_GAP_MS;
      return;
    }
    this.pendingDouble = false;
    this.start += this.nextGap();
  }

  /** Start time (ms) of the blink the cursor is on: the one in progress at the last query, or the next one. */
  nextBlinkStart(): number {
    return this.start;
  }

  /** Lid closure (0–1) at simulation time `t` (ms). */
  closure(t: number): number {
    if (!Number.isFinite(t)) return 0;
    if (t < this.lastT) this.reset(this.seed);
    this.lastT = t;
    while (t >= this.start + BLINK_MS) this.advance();
    return t < this.start ? 0 : blinkClosure((t - this.start) / BLINK_MS);
  }
}

/** Every blink start (ms) of a seed before `untilMs` – the schedule a `BlinkClock` follows. */
export function blinkSchedule(seed: number, untilMs: number): number[] {
  const clock = new BlinkClock(seed);
  const out: number[] = [];
  for (let guard = 0; guard < 100000; guard++) {
    const start = clock.nextBlinkStart();
    if (start >= untilMs) break;
    out.push(start);
    clock.closure(start + BLINK_MS);
  }
  return out;
}

/* ------------------------------------------------------------------ squash and stretch */

/** How long an impact wobbles the ball (ms). */
export const SQUASH_MS = 280;
/** Deepest squash at full strength and `ballSquash` 1: the ball shrinks by this fraction along the impact. */
export const MAX_SQUASH = 0.35;
/** Impacts weaker than this (relative) do not wobble the ball. */
export const SQUASH_MIN_IMPACT = 0.2;

/**
 * Deformation `ageMs` after an impact of relative `strength` (saturating at 1.5) with the `amount` setting
 * (0–1): positive = squashed along the impact normal, negative = stretched. A damped oscillation – a squash, a
 * smaller stretch, settled after `SQUASH_MS` – bounded by `MAX_SQUASH × amount`.
 */
export function squashAmount(ageMs: number, strength: number, amount: number): number {
  if (!(amount > 0) || !(strength > 0) || !(ageMs >= 0) || ageMs >= SQUASH_MS) return 0;
  const t = ageMs / SQUASH_MS;
  const s = Math.min(1, strength / 1.5);
  return MAX_SQUASH * Math.min(1, amount) * s * Math.exp(-3.2 * t) * Math.cos(2.6 * Math.PI * t) * (1 - t);
}

/** Scale factors for a deformation `d`: along the impact normal and across it (area-preserving: along × across = 1). */
export function squashScales(d: number, out: Vec): Vec {
  out.x = 1 - d;
  out.y = 1 / Math.max(0.2, 1 - d);
  return out;
}
