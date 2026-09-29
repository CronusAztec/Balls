import type { ModeId } from "./types";

/**
 * Wobbly walls – the project.jdm "Bouncy Circle" look (feature jdm-illusions). Render-only: nothing here moves a
 * ball, so seeds, rigged outcomes and Find Simulation are untouched.
 *
 * When a ball hits a circular wall the wall deforms with a radial displacement wave around the contact point: two
 * raised-cosine bumps leave the contact point in both directions at `WOBBLE_WAVE_SPEED` rad/s, the whole wave rings in
 * and out at `WOBBLE_FREQUENCY_HZ` and dies away with the time constant `WOBBLE_DECAY_SEC`:
 *
 *   d(φ, t) = s · e^(−age/τ) · cos(2π f age) · ½ [B(φ − φ₀ − c·age) + B(φ − φ₀ + c·age)]
 *
 * (B = raised cosine of half-width `WOBBLE_HALF_WIDTH`, s = the hit's strength, positive outward). At the moment of
 * the hit the two bumps coincide and the wall bulges by exactly `s` at the contact point; |d| ≤ |s| e^(−age/τ) ever
 * after. Each wall is sampled at `WOBBLE_SAMPLES` (64) angles – cheap enough for every ring of every mode – and the
 * canvas traces the displaced wall through those samples.
 *
 * Determinism: the engine records every contact with its simulation time in a `WallContactLog` (typed arrays, a ring
 * of the last `CONTACT_LOG_CAPACITY` contacts); the canvas copies the new ones into a `WobbleField` and samples it at
 * the frame's simulation time, so the displacement is a pure function of the run and its clock: a pause freezes it,
 * 8× playback speeds it up and a recording of a seed wobbles the same way every time.
 */

/** Samples per wall. */
export const WOBBLE_SAMPLES = 64;
/** Angular spacing of the samples. */
export const WOBBLE_STEP = (2 * Math.PI) / WOBBLE_SAMPLES;
/** Time constant (s) of the exponential decay of a hit's wave. */
export const WOBBLE_DECAY_SEC = 0.42;
/** The wave rings in and out at this frequency (Hz). */
export const WOBBLE_FREQUENCY_HZ = 2.4;
/** Angular speed (rad/s) at which the two bumps travel away from the contact point. */
export const WOBBLE_WAVE_SPEED = 2.6;
/** Half-width (rad) of a bump. */
export const WOBBLE_HALF_WIDTH = 0.6;
/** A hit older than this (s) is dropped (e^(−6) ≈ 0.25 % of its strength is left). */
export const WOBBLE_MAX_AGE_SEC = 6 * WOBBLE_DECAY_SEC;
/** Displacement at Wobbly Walls = 1 and strength 1, as a fraction of the wall's radius. */
export const WOBBLE_FRACTION = 0.09;
/** …and never more than this many px, whatever the radius. */
export const WOBBLE_MAX_PX = 30;
/** Strongest hit (1 = a head-on hit at the ball speed). */
export const MAX_WOBBLE_STRENGTH = 1.5;
/** Hits kept per wall (the newest replace the oldest). */
export const WOBBLE_HITS_PER_WALL = 12;
/** Walls a field can hold (ring modes have up to 20, the Illusion mode up to 17 circles). */
export const MAX_WOBBLE_WALLS = 64;
/** Contacts the engine's log keeps between two frames (more are dropped – render-only). */
export const CONTACT_LOG_CAPACITY = 256;
/** A wall whose largest displacement is below this (in units of the full amplitude) is drawn as a plain arc. */
export const WOBBLE_QUIET = 0.004;

/* ------------------------------------------------------------------ the setting */

/** The modes with circular walls a ball hits: the ten ring modes and the Circle Illusion (the Wobbly Walls slider shows there). */
export const WOBBLE_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow", "illusion"];

/** Slider range, spread into `RANGES` by settings.ts (URL `wob`). */
export const WOBBLE_RANGES = {
  wallWobble: { min: 0, max: 1, step: 0.05 },
} as const;

/** Off by default: the walls stay perfect circles. */
export const DEFAULT_WALL_WOBBLE = 0;

/** Clamps a Wobbly Walls value (URL parameter or preset) into 0–1; anything that is not a finite number is "off". */
export function resolveWallWobble(value: unknown): number {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_WALL_WOBBLE;
  const { min, max } = WOBBLE_RANGES.wallWobble;
  return Math.max(min, Math.min(max, n));
}

/* ------------------------------------------------------------------ the wave */

/** Wraps an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  const t = a % (2 * Math.PI);
  if (t > Math.PI) return t - 2 * Math.PI;
  if (t <= -Math.PI) return t + 2 * Math.PI;
  return t;
}

/** Envelope of a hit's wave `ageSec` after it: e^(−age/τ) · cos(2π f age); 0 before the hit and once it is dropped. */
export function wobbleEnvelope(ageSec: number): number {
  if (ageSec < 0 || ageSec > WOBBLE_MAX_AGE_SEC) return 0;
  return Math.exp(-ageSec / WOBBLE_DECAY_SEC) * Math.cos(2 * Math.PI * WOBBLE_FREQUENCY_HZ * ageSec);
}

/** A bump at angular offset `offset` from its centre: a raised cosine, 1 at the centre, 0 beyond ±`WOBBLE_HALF_WIDTH`. */
export function wobbleBump(offset: number): number {
  const x = wrapAngle(offset);
  if (x <= -WOBBLE_HALF_WIDTH || x >= WOBBLE_HALF_WIDTH) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * x) / WOBBLE_HALF_WIDTH));
}

/** Radial displacement (in units of the full amplitude) at angle `phi` of a wall hit at `phi0` with `strength`, `ageSec` later. */
export function wobbleDisplacement(phi: number, phi0: number, ageSec: number, strength: number): number {
  const env = wobbleEnvelope(ageSec);
  if (env === 0) return 0;
  const travel = WOBBLE_WAVE_SPEED * ageSec;
  const offset = phi - phi0;
  return strength * env * 0.5 * (wobbleBump(offset - travel) + wobbleBump(offset + travel));
}

/** Upper bound of |displacement| anywhere on the wall `ageSec` after a hit of `strength`: |s| e^(−age/τ). */
export function wobbleBound(ageSec: number, strength: number): number {
  if (ageSec < 0 || ageSec > WOBBLE_MAX_AGE_SEC) return 0;
  return Math.abs(strength) * Math.exp(-ageSec / WOBBLE_DECAY_SEC);
}

/** Strength of a hit from its approach speed along the wall's normal and the reference (ball) speed, 0 … `MAX_WOBBLE_STRENGTH`. */
export function wobbleStrength(normalSpeed: number, referenceSpeed: number): number {
  if (!(referenceSpeed > 0) || !Number.isFinite(normalSpeed)) return 0;
  return Math.min(MAX_WOBBLE_STRENGTH, Math.abs(normalSpeed) / referenceSpeed);
}

/** Full amplitude (px) of a wall of `radius` at Wobbly Walls `amount`: `WOBBLE_FRACTION` of the radius, at most `WOBBLE_MAX_PX`. */
export function wobbleAmplitudePx(amount: number, radius: number): number {
  if (!(amount > 0) || !(radius > 0)) return 0;
  return Math.min(WOBBLE_MAX_PX, WOBBLE_FRACTION * radius) * Math.min(1, amount);
}

/* ------------------------------------------------------------------ the engine's contact log */

/**
 * The contacts of the run, newest last: wall index, contact angle (radians, world frame – the angle of the contact point
 * seen from the wall's centre), strength (positive: the wall is pushed outward, negative: inward) and simulation time
 * (ms). A ring of `CONTACT_LOG_CAPACITY` entries in typed arrays (no allocation per contact); `serial` counts every
 * contact ever recorded and `generation` changes with every `clear()` (a restart), so a reader can tell new contacts
 * from the ones it has already seen and a new run from the old one. Recording never touches the physics.
 */
export class WallContactLog {
  readonly wall = new Int16Array(CONTACT_LOG_CAPACITY);
  readonly angle = new Float64Array(CONTACT_LOG_CAPACITY);
  readonly strength = new Float32Array(CONTACT_LOG_CAPACITY);
  readonly timeMs = new Float64Array(CONTACT_LOG_CAPACITY);
  /** Contacts recorded since the log was created (never reset). */
  serial = 0;
  /** Serial of the first contact of the current run. */
  runStart = 0;
  /** Changes with every `clear()`. */
  generation = 0;

  record(wall: number, angle: number, strength: number, timeMs: number) {
    if (!(wall >= 0 && wall < MAX_WOBBLE_WALLS) || !Number.isFinite(angle) || !Number.isFinite(timeMs) || !(strength !== 0)) return;
    const i = this.serial % CONTACT_LOG_CAPACITY;
    this.wall[i] = wall;
    this.angle[i] = angle;
    this.strength[i] = Math.max(-MAX_WOBBLE_STRENGTH, Math.min(MAX_WOBBLE_STRENGTH, strength));
    this.timeMs[i] = timeMs;
    this.serial++;
  }

  /** A new run: the contacts so far belong to the old one. */
  clear() {
    this.runStart = this.serial;
    this.generation++;
  }

  /** Serial of the oldest contact still held (older ones were overwritten). */
  oldestSerial(): number {
    return Math.max(this.runStart, this.serial - CONTACT_LOG_CAPACITY);
  }

  /** Index into the arrays of contact `serial` (valid for `oldestSerial()` ≤ serial < `serial`). */
  indexOf(serial: number): number {
    return serial % CONTACT_LOG_CAPACITY;
  }
}

/* ------------------------------------------------------------------ the field the canvas samples */

/**
 * The recent hits of every wall and their displacement waves. `sync()` copies the contacts a `WallContactLog` gained since
 * the last call (a new generation starts the field over); `sample()` evaluates the waves of one wall at the 64 sample
 * angles for a simulation time. Pure and allocation-free after construction.
 */
export class WobbleField {
  private readonly hitAngle = new Float64Array(MAX_WOBBLE_WALLS * WOBBLE_HITS_PER_WALL);
  private readonly hitTime = new Float64Array(MAX_WOBBLE_WALLS * WOBBLE_HITS_PER_WALL);
  private readonly hitStrength = new Float32Array(MAX_WOBBLE_WALLS * WOBBLE_HITS_PER_WALL);
  private readonly hitCount = new Int32Array(MAX_WOBBLE_WALLS);
  private readonly nextSlot = new Int32Array(MAX_WOBBLE_WALLS);
  /** Latest hit time per wall (ms; −Infinity without hits). */
  private readonly lastTime = new Float64Array(MAX_WOBBLE_WALLS).fill(-Infinity);
  private seenSerial = 0;
  private seenGeneration = -1;

  reset() {
    this.hitCount.fill(0);
    this.nextSlot.fill(0);
    this.lastTime.fill(-Infinity);
  }

  addHit(wall: number, angle: number, strength: number, timeMs: number) {
    if (!(wall >= 0 && wall < MAX_WOBBLE_WALLS)) return;
    const slot = this.nextSlot[wall];
    const i = wall * WOBBLE_HITS_PER_WALL + slot;
    this.hitAngle[i] = angle;
    this.hitTime[i] = timeMs;
    this.hitStrength[i] = strength;
    this.nextSlot[wall] = (slot + 1) % WOBBLE_HITS_PER_WALL;
    if (this.hitCount[wall] < WOBBLE_HITS_PER_WALL) this.hitCount[wall]++;
    if (timeMs > this.lastTime[wall]) this.lastTime[wall] = timeMs;
  }

  /** Copies the contacts `log` gained since the last call; returns how many. A new generation (a restart) empties the field first. */
  sync(log: WallContactLog): number {
    if (log.generation !== this.seenGeneration) {
      this.seenGeneration = log.generation;
      this.seenSerial = log.runStart;
      this.reset();
    }
    const from = Math.max(this.seenSerial, log.oldestSerial());
    for (let s = from; s < log.serial; s++) {
      const i = log.indexOf(s);
      this.addHit(log.wall[i], log.angle[i], log.strength[i], log.timeMs[i]);
    }
    const added = log.serial - from;
    this.seenSerial = log.serial;
    return added > 0 ? added : 0;
  }

  /** True when wall `wall` has a hit recent enough to still move it at `nowMs`. */
  isLive(wall: number, nowMs: number): boolean {
    if (!(wall >= 0 && wall < MAX_WOBBLE_WALLS) || this.hitCount[wall] === 0) return false;
    // A hit "in the future" (a view drawn a step behind the engine) is live too.
    return (nowMs - this.lastTime[wall]) / 1000 <= WOBBLE_MAX_AGE_SEC;
  }

  /**
   * Writes the displacement of wall `wall` at simulation time `nowMs` into `out` (`WOBBLE_SAMPLES` values, sample k at
   * angle k · 2π / 64, in units of the full amplitude, positive outward) and returns the largest |value|.
   */
  sample(wall: number, nowMs: number, out: Float32Array): number {
    out.fill(0);
    if (!(wall >= 0 && wall < MAX_WOBBLE_WALLS)) return 0;
    const n = this.hitCount[wall];
    const base = wall * WOBBLE_HITS_PER_WALL;
    for (let h = 0; h < n; h++) {
      const i = base + h;
      const age = (nowMs - this.hitTime[i]) / 1000;
      const env = wobbleEnvelope(age);
      if (env === 0) continue;
      const amp = 0.5 * this.hitStrength[i] * env;
      if (Math.abs(amp) < 1e-5) continue;
      const travel = WOBBLE_WAVE_SPEED * age;
      addBump(out, this.hitAngle[i] + travel, amp);
      addBump(out, this.hitAngle[i] - travel, amp);
    }
    let max = 0;
    for (let k = 0; k < WOBBLE_SAMPLES; k++) {
      const a = Math.abs(out[k]);
      if (a > max) max = a;
    }
    return max;
  }
}

/** Adds `amp` × a bump centred at angle `centre` to the samples it covers. */
function addBump(out: Float32Array, centre: number, amp: number) {
  const k0 = Math.ceil((centre - WOBBLE_HALF_WIDTH) / WOBBLE_STEP);
  const k1 = Math.floor((centre + WOBBLE_HALF_WIDTH) / WOBBLE_STEP);
  for (let k = k0; k <= k1; k++) {
    const x = k * WOBBLE_STEP - centre;
    if (x <= -WOBBLE_HALF_WIDTH || x >= WOBBLE_HALF_WIDTH) continue;
    const idx = ((k % WOBBLE_SAMPLES) + WOBBLE_SAMPLES) % WOBBLE_SAMPLES;
    out[idx] += amp * 0.5 * (1 + Math.cos((Math.PI * x) / WOBBLE_HALF_WIDTH));
  }
}

/** The displacement at any angle, linearly interpolated between the 64 samples of `samples`. */
export function sampleAt(samples: Float32Array, angle: number): number {
  let pos = angle / WOBBLE_STEP;
  pos -= Math.floor(pos / WOBBLE_SAMPLES) * WOBBLE_SAMPLES;
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  const a = samples[i0 % WOBBLE_SAMPLES];
  const b = samples[(i0 + 1) % WOBBLE_SAMPLES];
  return a + (b - a) * frac;
}
