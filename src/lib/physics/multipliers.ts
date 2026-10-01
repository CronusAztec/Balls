import type { Ball, CircularWall, ModeContext, ModeId, SoundEvent } from "./types";

/**
 * Stat multipliers (the geraldbounces "multipliers" formats: "the ball gets faster to unlimited, and size and damage
 * etc"). Every ball may carry a `mult` record – speed, size, damage, bounce and gravity, all starting at ×1 – that
 * stacks multiplicatively and, by default, WITHOUT ANY CAP (`mpUnlimited`; `mpCap` > 0 with unlimited off caps every
 * stat at ×cap). A ball without the record is an ordinary ×1 ball, so modes and seeds that never touch a multiplier
 * take exactly their old code paths.
 *
 *  - speed   scales the velocity at once and the ball's cruising speed from then on (the engine's rebound speed and
 *            the slow-ball boost of the ring modes read `cruiseSpeed()`; Grow, Accumulation and Multiply's children too);
 *  - size    scales the radius (and `radiusScale`, so a live Ball Size change keeps it); a grown ball is refitted into
 *            its corridor between the rings (`fitBallToRings()`): a ring it no longer fits inside bursts, and a ball
 *            bigger than the arena "outgrows" it – the run ends with a celebration instead of glitching;
 *  - damage  scales what every hit takes off anything with hit points (`hitDamage()`: Shatter segments, Target's
 *            countdown, the blockers of the multipliers board) and, from `wallSmashThreshold` (×4) on, the ball smashes
 *            the ring walls it touches without needing the gap (`smashesWalls()`);
 *  - bounce  scales the restitution of the engine's rebounds and of obstacles (`effectiveBounce()`, capped at ×1.5 for
 *            stability – the stat itself stays uncapped);
 *  - gravity scales the ball's `gravityScale`.
 *
 * Physics safety at extreme values lives here too: `planSteps()` picks, per 60 Hz step, enough sub-steps that no ball
 * moves more than half its radius (at most 4 px) per sub-step, up to `MAX_SUBSTEPS`; beyond that the step itself is
 * shortened by a power of two ("time dilation": the simulation clock slows and the HUD shows SLOW-MO) instead of
 * letting a ball tunnel through a wall. The obstacle and wall tests stay swept on top of that.
 *
 * Pickups (`MultiplierRuntime`): in the ring modes, `multiplierPickups` spawns floating orbs – x2 SPEED, x1.5 SIZE,
 * x2 DMG, x2 BALLS, x1.25 BOUNCE, x2 GRAV – at seeded times and places inside the ball's corridor; touching one applies
 * it at the end of the step with a burst, a rising arpeggio (a "multiplier" sound event) and a pop of the HUD badge.
 * Everything that affects the physics draws from the engine's seeded RNG, so a seed replays exactly.
 */

/* ------------------------------------------------------------------ stats */

export const MULTIPLIER_STATS = ["speed", "size", "damage", "bounce", "gravity"] as const;
export type MultiplierStat = (typeof MULTIPLIER_STATS)[number];

/** A ball's stacked stat multipliers (all ×1 for a fresh ball). */
export type BallMultipliers = Record<MultiplierStat, number>;

export function unitMultipliers(): BallMultipliers {
  return { speed: 1, size: 1, damage: 1, bounce: 1, gravity: 1 };
}

/** A fresh copy of a ball's multipliers (undefined stays undefined: a ×1 ball). */
export function copyMultipliers(mult: BallMultipliers | undefined): BallMultipliers | undefined {
  return mult ? { speed: mult.speed, size: mult.size, damage: mult.damage, bounce: mult.bounce, gravity: mult.gravity } : undefined;
}

/**
 * Keeps a stacked value a finite float: 1e15 is far beyond anything a run reaches (2⁵⁰), so it is not a gameplay cap
 * – it only stops a pathological stack from overflowing to Infinity.
 */
export const MULTIPLIER_CEILING = 1e15;
/** The restitution factor a bounce multiplier may reach (the stat is uncapped, its effect is not – for stability). */
export const MAX_EFFECTIVE_BOUNCE = 1.5;

/** The cap in effect: Infinity while unlimited (or with the cap at 0). */
export function effectiveCap(config: Pick<MultiplierConfig, "mpUnlimited" | "mpCap">): number {
  return !config.mpUnlimited && config.mpCap > 0 ? config.mpCap : Infinity;
}

/** A stacked value clamped to [1/cap, cap] (and to the float ceiling). */
export function clampMultiplier(value: number, cap = Infinity): number {
  if (!Number.isFinite(value) || value <= 0) return value === Infinity ? Math.min(cap, MULTIPLIER_CEILING) : 1;
  const hi = Math.min(cap, MULTIPLIER_CEILING);
  return Math.max(1 / hi, Math.min(hi, value));
}

/** The value of `stat` after stacking `factor` on `current` (multiplicative, clamped by the cap). */
export function stackMultiplier(current: number, factor: number, cap = Infinity): number {
  return clampMultiplier(current * factor, cap);
}

/**
 * Stacks `factor` on one stat of `ball` and applies it: speed scales the velocity, size the radius (and
 * `radiusScale`), gravity the ball's `gravityScale`; damage and bounce are read where they act. Returns the factor
 * actually applied (smaller than `factor` when the cap stopped it). The ring modes refit a grown ball afterwards
 * (`fitBallToRings()`).
 */
export function applyMultiplier(ball: Ball, stat: MultiplierStat, factor: number, cap = Infinity): number {
  if (!(factor > 0) || !Number.isFinite(factor)) return 1;
  const mult = (ball.mult ??= unitMultipliers());
  const before = mult[stat];
  const after = stackMultiplier(before, factor, cap);
  mult[stat] = after;
  const applied = after / before;
  if (applied === 1) return 1;
  if (stat === "speed") {
    ball.vx *= applied;
    ball.vy *= applied;
  } else if (stat === "size") {
    ball.radius *= applied;
    ball.radiusScale = (ball.radiusScale ?? 1) * applied;
  } else if (stat === "gravity") {
    ball.gravityScale = (ball.gravityScale ?? 1) * applied;
  }
  return applied;
}

/** The product of a ball's multipliers (the "total" the pickup arpeggio climbs with). */
export function multiplierTotal(mult: BallMultipliers | undefined): number {
  if (!mult) return 1;
  return clampMultiplier(mult.speed * mult.size * mult.damage * mult.bounce * mult.gravity);
}

/** Cruising speed of a ball: the Ball Speed times its speed multiplier. */
export function cruiseSpeed(ball: Pick<Ball, "mult">, baseSpeed: number): number {
  return ball.mult ? baseSpeed * ball.mult.speed : baseSpeed;
}

/** Damage one hit of this ball deals to anything with hit points (1 for a plain ball). */
export function hitDamage(ball: Pick<Ball, "mult">): number {
  return ball.mult ? ball.mult.damage : 1;
}

/** Restitution factor of a ball's bounce multiplier (capped at `MAX_EFFECTIVE_BOUNCE`; --- unlimited --- No limits passes Infinity). */
export function effectiveBounce(ball: Pick<Ball, "mult">, cap = MAX_EFFECTIVE_BOUNCE): number {
  return ball.mult ? Math.min(cap, ball.mult.bounce) : 1;
}

/** Modes whose rings a ball with enough damage may smash (escape formats; Lines, Paint, Grow and Target keep their arena). */
export const SMASH_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "shatter", "colorMatch", "portal"];

/** True when the ball's damage reached the smash threshold in a mode whose rings can be smashed. */
export function smashesWalls(ball: Pick<Ball, "mult">, threshold: number, mode: ModeId | undefined): boolean {
  return !!ball.mult && ball.mult.damage >= threshold && mode !== undefined && SMASH_MODES.includes(mode);
}

/** The clock rate of a dilated step for the HUD: x0.5, x0.25, x0.125, then x1/16, x1/32 … */
export function formatDilation(dilation: number): string {
  if (!(dilation > 0)) return "x0";
  return dilation >= 0.1 ? `x${Math.round(dilation * 1000) / 1000}` : `x1/${Math.round(1 / dilation)}`;
}

/** "x2", "x1.5", "x16", "x1.2k", "x3.4M" … (a division shows as ÷). */
export function formatMultiplier(value: number): string {
  if (!Number.isFinite(value)) return "x∞";
  if (value < 1 && value > 0) return `÷${formatNumber(1 / value)}`;
  return `x${formatNumber(value)}`;
}

function formatNumber(v: number): string {
  if (v < 10) return String(Math.round(v * 100) / 100);
  if (v < 1000) return String(Math.round(v));
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [size, unit] of units) {
    if (v >= size) {
      const n = v / size;
      if (n >= 1000) return v.toExponential(1).replace("+", "");
      return `${n < 10 ? Math.round(n * 10) / 10 : Math.round(n)}${unit}`;
    }
  }
  return String(Math.round(v));
}

/* ------------------------------------------------------------------ settings */

export const PICKUP_KINDS = ["speed", "size", "damage", "balls", "bounce", "gravity"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

export function isPickupKind(value: unknown): value is PickupKind {
  return typeof value === "string" && (PICKUP_KINDS as readonly string[]).includes(value);
}

/** What touching an orb stacks on the ball (x2 BALLS clones it). */
export const PICKUP_FACTORS: Record<PickupKind, number> = { speed: 2, size: 1.5, damage: 2, balls: 2, bounce: 1.25, gravity: 2 };
/** The stat an orb multiplies (none for x2 BALLS). */
export const PICKUP_STATS: Record<PickupKind, MultiplierStat | null> = { speed: "speed", size: "size", damage: "damage", balls: null, bounce: "bounce", gravity: "gravity" };
/** Colour of each kind (orbs, gates, HUD badges). */
export const MULTIPLIER_COLORS: Record<PickupKind | "reverse" | "release", string> = {
  speed: "#22d3ee",
  size: "#a78bfa",
  damage: "#f87171",
  balls: "#93d119",
  bounce: "#fbbf24",
  gravity: "#60a5fa",
  reverse: "#fb7185",
  release: "#f59e0b",
};

/**
 * The stat-multiplier settings that travel inside `PhysicsConfig` (like the physics extras), so the page's engine and
 * the finder's headless engines get the same pickups, cap and smash threshold from one `setConfig()`.
 */
export interface MultiplierConfig {
  /** No cap on any multiplier (default). */
  mpUnlimited: boolean;
  /** With unlimited off: the highest value a stat may stack to (and 1/cap the lowest); 0 = unlimited. */
  mpCap: number;
  /** Damage from which a ball smashes the ring walls on contact (×4 by default). */
  wallSmashThreshold: number;
  /** Floating multiplier orbs in the ring modes. */
  multiplierPickups: boolean;
  /** Orbs per 10 seconds, 0–3. */
  pickupRate: number;
  /** The orb kinds that may spawn, comma separated (e.g. "speed,size,damage,balls"). */
  pickupTypes: string;
  /** Seconds an orb floats before it fades out. */
  pickupLifetime: number;
}

export const DEFAULT_PICKUP_TYPES = "speed,size,damage,balls";

export const DEFAULT_MULTIPLIER_CONFIG: MultiplierConfig = {
  mpUnlimited: true,
  mpCap: 0,
  wallSmashThreshold: 4,
  multiplierPickups: false,
  pickupRate: 1,
  pickupTypes: DEFAULT_PICKUP_TYPES,
  pickupLifetime: 8,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const MULTIPLIER_RANGES = {
  mpCap: { min: 0, max: 1000, step: 1 },
  wallSmashThreshold: { min: 2, max: 64, step: 1 },
  pickupRate: { min: 0, max: 3, step: 0.1 },
  pickupLifetime: { min: 2, max: 30, step: 1 },
} as const;

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Keeps the known kinds of a comma-separated list, in canonical order, without duplicates ("" when none is left). */
export function sanitizePickupTypes(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PICKUP_TYPES;
  const wanted = new Set(value.split(/[\s,;.|]+/).map((s) => s.trim().toLowerCase()));
  return PICKUP_KINDS.filter((k) => wanted.has(k)).join(",");
}

/** The kinds of a (sanitized) type list. */
export function parsePickupTypes(value: string): PickupKind[] {
  return sanitizePickupTypes(value)
    .split(",")
    .filter(isPickupKind);
}

/** Fills in the defaults and clamps every value (the cap and the threshold become whole numbers; bad input falls back). */
export function resolveMultiplierConfig(config: Partial<MultiplierConfig> | null | undefined): MultiplierConfig {
  const out = { ...DEFAULT_MULTIPLIER_CONFIG };
  if (!config) return out;
  if (typeof config.mpUnlimited === "boolean") out.mpUnlimited = config.mpUnlimited;
  if (config.mpCap !== undefined) out.mpCap = Math.round(clampNumber(config.mpCap, MULTIPLIER_RANGES.mpCap, out.mpCap));
  if (config.wallSmashThreshold !== undefined) out.wallSmashThreshold = Math.round(clampNumber(config.wallSmashThreshold, MULTIPLIER_RANGES.wallSmashThreshold, out.wallSmashThreshold));
  if (typeof config.multiplierPickups === "boolean") out.multiplierPickups = config.multiplierPickups;
  if (config.pickupRate !== undefined) out.pickupRate = clampNumber(config.pickupRate, MULTIPLIER_RANGES.pickupRate, out.pickupRate);
  if (config.pickupTypes !== undefined) out.pickupTypes = sanitizePickupTypes(config.pickupTypes);
  if (config.pickupLifetime !== undefined) out.pickupLifetime = clampNumber(config.pickupLifetime, MULTIPLIER_RANGES.pickupLifetime, out.pickupLifetime);
  return out;
}

/** Picks the multiplier settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setConfig()`. */
export function multiplierConfigOf(source: MultiplierConfig): MultiplierConfig {
  return {
    mpUnlimited: source.mpUnlimited,
    mpCap: source.mpCap,
    wallSmashThreshold: source.wallSmashThreshold,
    multiplierPickups: source.multiplierPickups,
    pickupRate: source.pickupRate,
    pickupTypes: source.pickupTypes,
    pickupLifetime: source.pickupLifetime,
  };
}

/** The ring modes that spawn pickups (the multipliers board has gates instead; the rhythm modes have none). */
export const PICKUP_MODES: readonly ModeId[] = ["classic", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow", "accumulation"];
/** Pickup modes where x2 BALLS may spawn (the ones that play with several balls). */
export const CLONE_MODES: readonly ModeId[] = ["classic", "multiply", "lines", "shatter", "grow"];

/* ------------------------------------------------------------------ physics safety */

/** Most sub-steps one 60 Hz step may take; beyond that the step is shortened instead (time dilation). */
export const MAX_SUBSTEPS = 64;
/** The most a ball may move per sub-step, px (and never more than half its radius). */
export const MAX_MOVE_PX = 4;
/** The slowest the clock may run (a power of two); only absurd stacks ever get here. */
export const MIN_DILATION = 1 / 1048576;
/** Extra room in the speed bound for what the step itself may add (a beat kick, wind, a collision). */
export const SPEED_MARGIN = 1.25;

/** The most a ball of this radius may move per sub-step: half its radius, at most `MAX_MOVE_PX`. */
export function maxMovePerSubStep(radius: number): number {
  return Math.max(0.25, Math.min(radius / 2, MAX_MOVE_PX));
}

export interface StepPlan {
  /** Sub-steps the step needs (0 = no requirement: the engine keeps its own count). */
  subSteps: number;
  /** Fraction of the fixed step the clock advances (1 = real time; 0.5 = SLOW-MO x0.5). */
  dilation: number;
}

/**
 * The plan for a step whose fastest ball needs `ratio` = (distance it may cover in the step) / (its allowed move per
 * sub-step): that many sub-steps up to `MAX_SUBSTEPS`, else the largest power-of-two dilation d that brings
 * ⌈ratio · d⌉ under the cap (the clock slows, the ball still moves at most its limit per sub-step).
 */
export function planForRatio(ratio: number, out: StepPlan = { subSteps: 0, dilation: 1 }): StepPlan {
  if (!(ratio > 0) || !Number.isFinite(ratio)) {
    out.subSteps = Number.isFinite(ratio) ? 0 : MAX_SUBSTEPS;
    out.dilation = Number.isFinite(ratio) ? 1 : MIN_DILATION;
    return out;
  }
  let dilation = 1;
  while (Math.ceil(ratio * dilation) > MAX_SUBSTEPS && dilation > MIN_DILATION) dilation /= 2;
  out.dilation = dilation;
  out.subSteps = Math.min(MAX_SUBSTEPS, Math.ceil(ratio * dilation));
  return out;
}

/* ------------------------------------------------------------------ fitting a grown ball */

export interface RingFit {
  /** Walls (indices) the ball no longer fits inside: they burst, in the order they broke. */
  burst: number[];
  /** The ball does not fit inside the outermost intact ring – the arena – any more. */
  outgrown: boolean;
  /** Where the ball's centre should sit from the centre (unchanged when it already fits). */
  dist: number;
}

/** Room left between a refitted ball and the rings around it, px. */
export const FIT_MARGIN = 1;

/**
 * Refits a ball of `radius` whose centre sits `dist` from the arena centre into the concentric rings (intact ones
 * only). Its corridor is bounded by the largest intact ring inside it (0 when none) and the smallest intact ring
 * around it. A ball that fits is only moved radially so it clears both rings. A ball that does not fit bursts the ring
 * around it and tries the next corridor out; in the outermost corridor it bursts the ring inside it instead; with no
 * ring left inside and still no room it has outgrown the arena. A ball outside every intact ring is left alone.
 *
 * `baseRadius` is the ball's size before its size multiplier: a corridor too narrow even for that (a small canvas with
 * many rings) is not the multiplier's doing, so it is left as the engine always handled it. Writes into `out`
 * (reused by the engine, so the per-step check allocates nothing).
 */
export function fitBallToRings(
  dist: number,
  radius: number,
  walls: readonly CircularWall[],
  broken: ReadonlySet<number>,
  baseRadius = radius,
  out: RingFit = { burst: [], outgrown: false, dist },
): RingFit {
  out.burst.length = 0;
  out.outgrown = false;
  out.dist = dist;
  if (walls.length === 0) return out;
  const need = radius + FIT_MARGIN;
  const baseNeed = baseRadius + FIT_MARGIN;
  for (let guard = 0; guard <= walls.length; guard++) {
    let inner = 0;
    let innerIndex = -1;
    let outerIndex = -1;
    let arenaIndex = -1;
    for (let w = 0; w < walls.length; w++) {
      if (broken.has(w) || out.burst.includes(w)) continue;
      const r = walls[w].radius;
      if (arenaIndex < 0 || r > walls[arenaIndex].radius) arenaIndex = w;
      if (r < dist) {
        if (r > inner) {
          inner = r;
          innerIndex = w;
        }
      } else if (outerIndex < 0 || r < walls[outerIndex].radius) outerIndex = w;
    }
    if (outerIndex < 0) return out; // outside every intact ring: free
    const outer = walls[outerIndex].radius;
    const room = inner > 0 ? (outer - inner) / 2 : outer;
    if (room >= need || (inner > 0 && room < baseNeed)) {
      if (room >= need) out.dist = Math.max(inner > 0 ? inner + need : 0, Math.min(outer - need, dist));
      return out;
    }
    if (outerIndex !== arenaIndex) out.burst.push(outerIndex);
    else if (innerIndex >= 0) out.burst.push(innerIndex);
    else {
      out.outgrown = true;
      return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ pickups */

export interface PickupOrb {
  id: number;
  kind: PickupKind;
  factor: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Simulation time it appeared and how long it floats (ms). */
  bornMs: number;
  lifeMs: number;
}

/** Most orbs afloat at once. */
export const MAX_ORBS = 5;
/** Orb drift speed range, px/s. */
export const ORB_DRIFT_MIN = 12;
export const ORB_DRIFT_MAX = 30;

/** Seconds until the next orb for a rate of `rate` orbs per 10 s and a uniform draw `u` (0.5–1.5 × the mean interval). */
export function pickupInterval(rate: number, u: number): number {
  if (!(rate > 0)) return Infinity;
  return (10 / rate) * (0.5 + u);
}

/** Radius of an orb for an arena of `arenaRadius` px. */
export function orbRadius(arenaRadius: number, ballRadius: number): number {
  return Math.max(14, 0.1 * arenaRadius, 2 * ballRadius);
}

/** The corridor [inner, outer] (radii) the ball at `dist` moves in between the intact rings, or null outside every ring. */
export function ballCorridor(dist: number, walls: readonly CircularWall[], broken: ReadonlySet<number>): { inner: number; outer: number } | null {
  let inner = 0;
  let outer = Infinity;
  for (let w = 0; w < walls.length; w++) {
    if (broken.has(w)) continue;
    const r = walls[w].radius;
    if (r < dist) inner = Math.max(inner, r);
    else outer = Math.min(outer, r);
  }
  return outer === Infinity ? null : { inner, outer };
}

/** Frequencies of the pickup arpeggio for a new total: more notes and a higher root the bigger the stack (C5 major, up to an octave higher). */
export function multiplierArpeggio(total: number): number[] {
  const steps = [0, 4, 7, 12, 16, 19, 24];
  const level = Math.max(0, Math.log2(Math.max(1, total)));
  const count = Math.max(3, Math.min(steps.length, 3 + Math.floor(level / 2)));
  const shift = Math.min(12, Math.round(level));
  const root = 523.25 * Math.pow(2, shift / 12);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(root * Math.pow(2, steps[i] / 12));
  return out;
}

/* ------------------------------------------------------------------ the runtime (engine side) */

/** What the canvas shows about the multipliers; the same object every call. */
export interface MultiplierView {
  /** Multipliers are in play this run (pickups on, the board mode, or a stat changed). */
  active: boolean;
  /** Highest value of every stat over the balls in play (1 when none carries it). */
  speed: number;
  size: number;
  damage: number;
  bounce: number;
  gravity: number;
  /** Balls in play. */
  balls: number;
  /** Simulation time (ms) each badge last changed (for the pop), −Infinity before. */
  changedAt: Record<MultiplierStat | "balls", number>;
  /** Pickup orbs afloat (ring modes). */
  orbs: PickupOrb[];
  /** Orbs taken, walls smashed and rings burst by a grown ball this run. */
  pickupsTaken: number;
  smashes: number;
  bursts: number;
  /** Clock rate of the last step (1 = real time) and the sub-steps it took. */
  dilation: number;
  subSteps: number;
  /** A ball outgrew the arena: the run is over (at `outgrewAt`, simulation ms). */
  outgrown: boolean;
  outgrewAt: number;
  /** The kind of the last orb taken and when (for the HUD flash). */
  lastPickup: PickupKind | null;
  lastPickupAt: number;
}

export interface MultiplierHost {
  /** A burst of coloured particles (visual only). */
  burst(x: number, y: number, color: string, radius: number): void;
  /** A ring breaks for good (wall-break effect, sound, split reporting), as a smash does. */
  breakWall(ball: Ball, wallIndex: number): void;
  /** A ball was cloned (x2 BALLS): the mode copies its per-ball state (Multiply marks the clone of an escaped ball). */
  cloned(parent: Ball, clone: Ball): void;
}

interface QueuedPickup {
  ball: Ball;
  kind: PickupKind;
  factor: number;
  x: number;
  y: number;
}

/**
 * The engine's multiplier state for one run: the resolved config, the pickup orbs and their schedule, the queue of
 * pickups touched during the current step (applied at its end, so the sub-step plan of a step always covers the
 * speeds it runs with), the time-dilation plan and the outgrow state. `reset()` starts a new run.
 */
export class MultiplierRuntime {
  constructor(private readonly host: MultiplierHost) {}
  private config: MultiplierConfig = { ...DEFAULT_MULTIPLIER_CONFIG };
  private cap = Infinity;
  private kinds: PickupKind[] = parsePickupTypes(DEFAULT_PICKUP_TYPES);
  /** A multiplier was applied this run: the adaptive sub-stepping stays on until the next reset. */
  private touched = false;
  private nextOrbId = 0;
  /** Simulation ms of the next orb (NaN = not scheduled yet). */
  private nextSpawnMs = Number.NaN;
  private readonly queue: QueuedPickup[] = [];
  /** Balls whose size changed this step (they are moved clear of the rings at its end). */
  private readonly resized: Ball[] = [];
  private readonly fit: RingFit = { burst: [], outgrown: false, dist: 0 };
  private mode: ModeId | undefined;
  private readonly plan: StepPlan = { subSteps: 0, dilation: 1 };
  /** --- unlimited --- The most a bounce multiplier may scale a rebound (`MAX_EFFECTIVE_BOUNCE`; Infinity with No limits on). */
  bounceCap = MAX_EFFECTIVE_BOUNCE;
  private readonly view: MultiplierView = {
    active: false,
    speed: 1,
    size: 1,
    damage: 1,
    bounce: 1,
    gravity: 1,
    balls: 0,
    changedAt: { speed: -Infinity, size: -Infinity, damage: -Infinity, bounce: -Infinity, gravity: -Infinity, balls: -Infinity },
    orbs: [],
    pickupsTaken: 0,
    smashes: 0,
    bursts: 0,
    dilation: 1,
    subSteps: 0,
    outgrown: false,
    outgrewAt: -Infinity,
    lastPickup: null,
    lastPickupAt: -Infinity,
  };

  setConfig(config: Partial<MultiplierConfig> | null | undefined) {
    const next = resolveMultiplierConfig(config);
    const wasOn = this.config.multiplierPickups;
    this.config = next;
    this.cap = effectiveCap(next);
    this.kinds = parsePickupTypes(next.pickupTypes);
    // Switched on (or the rate changed) mid-run: the schedule starts over from the next step.
    if (!wasOn && next.multiplierPickups) this.nextSpawnMs = Number.NaN;
    if (!next.multiplierPickups) this.view.orbs.length = 0;
  }
  getConfig(): MultiplierConfig {
    return this.config;
  }
  getCap(): number {
    return this.cap;
  }
  getView(): MultiplierView {
    return this.view;
  }

  /** A new run (mode init / restart). */
  reset() {
    const v = this.view;
    this.touched = false;
    this.nextOrbId = 0;
    this.nextSpawnMs = Number.NaN;
    this.queue.length = 0;
    this.resized.length = 0;
    v.active = false;
    v.speed = v.size = v.damage = v.bounce = v.gravity = 1;
    v.balls = 0;
    for (const key of Object.keys(v.changedAt) as (MultiplierStat | "balls")[]) v.changedAt[key] = -Infinity;
    v.orbs.length = 0;
    v.pickupsTaken = 0;
    v.smashes = 0;
    v.bursts = 0;
    v.dilation = 1;
    v.subSteps = 0;
    v.outgrown = false;
    v.outgrewAt = -Infinity;
    v.lastPickup = null;
    v.lastPickupAt = -Infinity;
  }

  /** Marks the run as using multipliers (a mode applied one itself, e.g. a gate of the multipliers board). */
  markTouched() {
    this.touched = true;
  }

  /** Pickups spawn in this mode (and the run is not over). */
  pickupsLive(mode: ModeId | undefined): boolean {
    return this.config.multiplierPickups && mode !== undefined && PICKUP_MODES.includes(mode) && !this.view.outgrown;
  }

  /** Multipliers matter this run: the adaptive sub-stepping, the HUD and the fit checks are on. */
  isActive(mode: ModeId | undefined): boolean {
    return this.touched || this.pickupsLive(mode) || mode === "multipliers";
  }

  isOutgrown() {
    return this.view.outgrown;
  }

  /** Applies a multiplier through the cap in effect and remembers that the run uses multipliers. */
  apply(ball: Ball, stat: MultiplierStat, factor: number): number {
    this.touched = true;
    const applied = applyMultiplier(ball, stat, factor, this.cap);
    if (stat === "size" && applied !== 1 && !this.resized.includes(ball)) this.resized.push(ball);
    return applied;
  }

  noteSmash() {
    this.view.smashes++;
  }

  /**
   * The step plan for balls moving under `gravity` (px/s² of a normal-weight ball) whose rebounds may reach
   * `reboundSpeed` × their speed multiplier (0 for a mode without the engine's rebounds): sub-steps so no ball moves
   * more than its limit, and the dilation when 64 sub-steps are not enough.
   */
  planStep(balls: readonly Ball[], stepSec: number, gravity: number, reboundSpeed: number): StepPlan {
    let ratio = 0;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.frozen) continue;
      const v = Math.hypot(b.vx, b.vy);
      let rebound = b.mult ? reboundSpeed * b.mult.speed * Math.min(this.bounceCap, b.mult.bounce) : reboundSpeed; // --- unlimited --- (the cap in effect)
      if (b.restitution !== undefined) rebound *= b.restitution; // --- bounce-math --- the ball's bounciness scales its rebounds
      const bound = SPEED_MARGIN * (v > rebound ? v : rebound) + Math.abs(gravity * (b.gravityScale ?? 1)) * stepSec;
      const r = (bound * stepSec) / maxMovePerSubStep(b.radius);
      if (r > ratio) ratio = r;
    }
    planForRatio(ratio, this.plan);
    this.view.dilation = this.plan.dilation;
    this.view.subSteps = this.plan.subSteps;
    return this.plan;
  }

  /**
   * Once per step while pickups are live: schedules and spawns orbs inside the corridor of the first ball, drifts them
   * (reflecting off the corridor's rings) and lets old ones fade out.
   */
  stepPickups(ctx: ModeContext, stepMs: number) {
    const now = ctx.getElapsedMs();
    const v = this.view;
    const orbs = v.orbs;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const walls = ctx.getCircularWalls();
    const broken = ctx.getBrokenWalls();
    const stepSec = stepMs / 1000;
    // Drift and fade.
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      if (now - o.bornMs >= o.lifeMs) {
        orbs.splice(i, 1);
        continue;
      }
      o.x += o.vx * stepSec;
      o.y += o.vy * stepSec;
      const dx = o.x - cx;
      const dy = o.y - cy;
      const d = Math.hypot(dx, dy);
      const lane = ballCorridor(d, walls, broken);
      if (lane && d > 0) {
        const nx = dx / d;
        const ny = dy / d;
        const vn = o.vx * nx + o.vy * ny;
        if (d + o.radius > lane.outer && vn > 0) {
          o.vx -= 2 * vn * nx;
          o.vy -= 2 * vn * ny;
        } else if (lane.inner > 0 && d - o.radius < lane.inner && vn < 0) {
          o.vx -= 2 * vn * nx;
          o.vy -= 2 * vn * ny;
        }
      }
    }
    if (this.kinds.length === 0 || !(this.config.pickupRate > 0)) return;
    if (Number.isNaN(this.nextSpawnMs)) this.nextSpawnMs = now + 1000 * pickupInterval(this.config.pickupRate, ctx.random());
    if (now < this.nextSpawnMs) return;
    this.nextSpawnMs = now + 1000 * pickupInterval(this.config.pickupRate, ctx.random());
    if (orbs.length >= MAX_ORBS) return;
    const balls = ctx.getBalls();
    const ref = balls.find((b) => !b.frozen);
    if (!ref || walls.length === 0) return;
    const lane = ballCorridor(Math.hypot(ref.x - cx, ref.y - cy), walls, broken);
    if (!lane) return; // the ball is out: no more orbs
    const kinds = this.mode !== undefined && CLONE_MODES.includes(this.mode) ? this.kinds : this.kinds.filter((k) => k !== "balls");
    if (kinds.length === 0) return;
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(ctx.random() * kinds.length))];
    const arena = walls[walls.length - 1].radius;
    const radius = orbRadius(arena, ctx.config.ballRadius || 8);
    const margin = 4;
    const lo = lane.inner > 0 ? lane.inner + radius + margin : 0;
    const hi = lane.outer - radius - margin;
    const angle = ctx.random() * 2 * Math.PI;
    const u = ctx.random();
    const rho = hi <= lo ? Math.max(0, (lane.inner + lane.outer) / 2) : lo === 0 ? hi * Math.sqrt(0.15 + 0.85 * u) : lo + (hi - lo) * u;
    const driftA = ctx.random() * 2 * Math.PI;
    const drift = ORB_DRIFT_MIN + (ORB_DRIFT_MAX - ORB_DRIFT_MIN) * ctx.random();
    orbs.push({
      id: this.nextOrbId++,
      kind,
      factor: PICKUP_FACTORS[kind],
      x: cx + Math.cos(angle) * rho,
      y: cy + Math.sin(angle) * rho,
      vx: Math.cos(driftA) * drift,
      vy: Math.sin(driftA) * drift,
      radius,
      bornMs: now,
      lifeMs: 1000 * this.config.pickupLifetime,
    });
  }

  /** The mode the runtime works for (set by the engine at every activation). */
  setMode(mode: ModeId | undefined) {
    this.mode = mode;
  }

  /** Orbs afloat (the engine only checks touches while there are any). */
  hasOrbs() {
    return this.view.orbs.length > 0;
  }

  /**
   * A ball moved (sub-step): an orb it touches is taken now and applied at the end of the step. With `noClone` (the
   * rigged forced winner keeps the other teams from cloning themselves) an x2 BALLS orb is left floating instead.
   */
  touch(ball: Ball, noClone = false) {
    const orbs = this.view.orbs;
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      if (noClone && o.kind === "balls") continue;
      const dx = ball.x - o.x;
      const dy = ball.y - o.y;
      const reach = ball.radius + o.radius;
      if (dx * dx + dy * dy >= reach * reach) continue;
      orbs.splice(i, 1);
      this.queue.push({ ball, kind: o.kind, factor: o.factor, x: o.x, y: o.y });
    }
  }

  /**
   * End of a step: applies the orbs taken during it (stat stacks, x2 BALLS clones within `maxBalls`), refits grown
   * balls into the rings (bursting rings they no longer fit, the outgrow finish beyond the arena) and updates the HUD
   * summary. `refit` is false for modes without rings.
   */
  endStep(ctx: ModeContext, maxBalls: number, refit: boolean) {
    const host = this.host;
    const now = ctx.getElapsedMs();
    const v = this.view;
    if (this.queue.length > 0) {
      for (const q of this.queue) {
        const balls = ctx.getBalls();
        if (!balls.includes(q.ball)) continue;
        this.touched = true;
        v.pickupsTaken++;
        v.lastPickup = q.kind;
        v.lastPickupAt = now;
        const stat = PICKUP_STATS[q.kind];
        if (stat) this.apply(q.ball, stat, q.factor);
        else this.cloneBall(ctx, q.ball, q.factor, maxBalls);
        host.burst(q.x, q.y, MULTIPLIER_COLORS[q.kind], q.ball.radius + 6);
        const total = stat ? q.ball.mult![stat] : ctx.getBalls().length;
        const event: SoundEvent = { type: "multiplier", wallIndex: 0, multiplier: total };
        ctx.addPendingSoundEvent(event);
      }
      this.queue.length = 0;
    }
    if (refit && !v.outgrown) this.refitAll(ctx);
    else this.resized.length = 0;
    this.summarize(ctx.getBalls(), now);
  }

  /** x2 BALLS: the ball gets `factor − 1` twins (fewer when `maxBalls` is reached), each diverging by a seeded angle. */
  cloneBall(ctx: ModeContext, ball: Ball, factor: number, maxBalls: number) {
    const host = this.host;
    const copies = Math.max(0, Math.round(factor) - 1);
    for (let k = 0; k < copies; k++) {
      if (ctx.getBalls().length >= maxBalls) {
        // --- unlimited --- with No limits on the clones past the full-physics balls join the crowd (ARENA FULL once it is full)
        if (ctx.unlimitedRoom?.() != null) ctx.spawnCrowd?.(copies - k, ball.x, ball.y, Math.hypot(ball.vx, ball.vy), ball.radius, Math.atan2(ball.vy, ball.vx), 0);
        return;
      }
      const turn = (ctx.random() < 0.5 ? -1 : 1) * (0.35 + 0.35 * ctx.random());
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      ctx.addBall({
        x: ball.x,
        y: ball.y,
        vx: ball.vx * c - ball.vy * s,
        vy: ball.vx * s + ball.vy * c,
        radius: ball.radius,
        color: ball.color,
        lifetime: ball.lifetime,
        gravityScale: ball.gravityScale,
        radiusScale: ball.radiusScale,
        mult: copyMultipliers(ball.mult),
      });
      const balls = ctx.getBalls();
      host.cloned(ball, balls[balls.length - 1]);
    }
  }

  /**
   * Grown balls inside the rings are checked against their corridor: rings they no longer fit burst, the arena is
   * outgrown. Only a ball resized this step is also moved radially to clear the rings (a ball half-way through a gap
   * must not be pulled back).
   */
  private refitAll(ctx: ModeContext) {
    const host = this.host;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const broken = ctx.getBrokenWalls();
    const fit = this.fit;
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (ball.frozen || !ball.mult || !(ball.mult.size > 1)) continue;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy);
      fitBallToRings(dist, ball.radius, walls, broken, ball.radius / ball.mult.size, fit);
      for (const w of fit.burst) {
        host.breakWall(ball, w);
        this.view.bursts++;
      }
      if (fit.outgrown) {
        this.outgrow(ctx, ball);
        break;
      }
      if (fit.dist !== dist && this.resized.includes(ball)) {
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        ball.x = cx + nx * fit.dist;
        ball.y = cy + ny * fit.dist;
      }
    }
    this.resized.length = 0;
  }

  /**
   * A ball outgrew the arena: the run ends with a celebration – everything stops, the ball fills the arena (the rings'
   * centre; a mode without rings passes the largest radius it may keep), confetti, the wall-break sound and one more
   * arpeggio. The engine stops stepping the physics and reports the run as finished.
   */
  outgrow(ctx: ModeContext, ball: Ball, limitRadius?: number) {
    const v = this.view;
    if (v.outgrown) return;
    v.outgrown = true;
    v.outgrewAt = ctx.getElapsedMs();
    v.orbs.length = 0;
    this.touched = true;
    for (const b of ctx.getBalls()) {
      b.vx = 0;
      b.vy = 0;
    }
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) {
      const cx = ctx.config.width / 2;
      const cy = ctx.config.height / 2;
      const arena = walls[walls.length - 1].radius;
      ball.radius = Math.min(ball.radius, arena);
      ball.x = cx;
      ball.y = cy;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * Math.PI;
        ctx.spawnConfetti(cx + Math.cos(a) * 0.6 * arena, cy + Math.sin(a) * 0.6 * arena);
      }
    } else {
      if (limitRadius !== undefined) ball.radius = Math.min(ball.radius, limitRadius);
      for (let i = 0; i < 4; i++) ctx.spawnConfetti(ball.x + (i - 1.5) * 0.5 * ball.radius, ball.y);
    }
    this.host.burst(ball.x, ball.y, MULTIPLIER_COLORS.size, ball.radius);
    ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: ball.mult ? ball.mult.size : 2 });
    this.summarize(ctx.getBalls(), v.outgrewAt);
  }

  /** The HUD summary: the highest value of every stat over the balls, the ball count, and when each changed. */
  summarize(balls: readonly Ball[], now: number) {
    const v = this.view;
    v.active = true;
    // An empty board (every ball home) keeps the last values, so the badges stay up under the final banner.
    if (balls.length === 0) return;
    let speed = 1;
    let size = 1;
    let damage = 1;
    let bounce = 1;
    let gravity = 1;
    let any = false;
    for (let i = 0; i < balls.length; i++) {
      const m = balls[i].mult;
      if (!m) continue;
      if (!any) {
        speed = m.speed;
        size = m.size;
        damage = m.damage;
        bounce = m.bounce;
        gravity = m.gravity;
        any = true;
        continue;
      }
      if (m.speed > speed) speed = m.speed;
      if (m.size > size) size = m.size;
      if (m.damage > damage) damage = m.damage;
      if (m.bounce > bounce) bounce = m.bounce;
      if (m.gravity > gravity) gravity = m.gravity;
    }
    if (speed !== v.speed) v.changedAt.speed = now;
    if (size !== v.size) v.changedAt.size = now;
    if (damage !== v.damage) v.changedAt.damage = now;
    if (bounce !== v.bounce) v.changedAt.bounce = now;
    if (gravity !== v.gravity) v.changedAt.gravity = now;
    if (balls.length !== v.balls && v.balls > 0) v.changedAt.balls = now;
    v.speed = speed;
    v.size = size;
    v.damage = damage;
    v.bounce = bounce;
    v.gravity = gravity;
    v.balls = balls.length;
  }
}
