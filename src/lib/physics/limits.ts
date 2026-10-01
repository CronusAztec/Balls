/**
 * --- unlimited --- No limits on the physics side: allowed to melt, never to crash.
 *
 * With the switch on (`PhysicsConfig.unlimited`) the engine takes every setting past its slider range, and this runtime
 * keeps the run alive at any value:
 *
 *  - **Soft ceilings** (`ceilPatch()`): the config values the engine runs are capped at float-safety or memory ceilings
 *    (`ENGINE_CEILINGS` in lib/unlimited.ts – e.g. at most `LIVE_WALL_LIMIT` rings; --- uncap-all --- memory only); the page keeps
 *    the typed value. The physics extras and the split limits are lifted past their ranges (`liftPhysics()`), and the
 *    multiplier cap is off – stacks multiply without a ceiling (the float-safety one of multipliers.ts aside).
 *  - **The crowd** (crowd.ts): a Ball Count past the team balls and every spawn past the full-physics balls (`OBJECT_BALL_LIMIT`,
 *    fewer the more rings each of them is checked against: `objectLimitFor()`)
 *    become crowd balls in typed arrays, up to `CROWD_LIMIT`; beyond that spawning stops with the ARENA FULL badge.
 *  - **Bounded steps**: the engine plans every step like a multiplier run – enough sub-steps that no ball moves more than
 *    half its radius, at most 64; beyond that the step itself is shortened (time dilation, the simulation runs in slow
 *    motion) – and hashes every ball pair. How much of that the page runs per frame is the frame budget's call
 *    (lib/simulation/frameBudget.ts: whole steps only, so a seed plays the same at any budget).
 *  - **Finite numbers**: a ball whose position, velocity or radius is no longer a finite number is put back at the centre
 *    at the Ball Speed (--- uncap-all --- no speed ceiling below the float range).
 *  - **The ball ate the arena**: a ball bigger than a ring bursts it, and a ball bigger than the whole arena ends the run
 *    with its own banner and sound (the multipliers' outgrow finish, which stops the physics and holds the banner).
 *  - **Sound**: at most `MAX_SOUNDS_PER_FRAME` events reach the synth per frame (breaks and stacks first), and the crowd's
 *    thousands of bounces play as one soft hit at most every 90 ms.
 *
 * Nothing here draws from the engine's RNG, and every decision depends on the simulation state only, so runs stay
 * deterministic for a seed. With the switch off nothing here runs and the engine takes its old code paths.
 *
 * --- uncap-all --- No switch any more: the runtime engages by itself whenever a run needs it – a core value past its
 * slider's comfort range (`coreBeyondComfort()`), the page's `PhysicsConfig.unlimited` (any setting past its slider, see
 * `uncappedEngaged()` in settings.ts) or, mid-run, a Bounciness that grew the rebounds past the old Bouncier's ×3
 * (`engage()`) – and the soft ceilings are gone: speeds, sizes, gravity and rotation run as typed, the rescue only puts
 * back a ball whose numbers overflowed the float range. The only ceilings left are the memory-safety ones (the rings,
 * the crowd, the full-physics balls a step can carry – the rest join the crowd). At default values nothing engages and
 * the engine takes its old code paths.
 */
import { Crowd } from "./crowd";
import { FIT_MARGIN, MAX_SUBSTEPS, type MultiplierRuntime, type RingFit, type StepPlan } from "./multipliers";
import { PHYSICS_EXTRA_KEYS, PHYSICS_EXTRA_RANGES } from "./extras";
import { BALL_INTERACTION_RANGES } from "./interactions";
import { TWO_PI, type Ball, type BallInteractionConfig, type CircularWall, type ModeContext, type PhysicsConfig, type PhysicsExtras, type SoundEvent } from "./types";
import { CROWD_LIMIT, OBJECT_BALL_LIMIT, parseUnlimitedValue } from "@/lib/unlimited";
import { memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/** The No limits fields of the physics config. */
export interface UnlimitedConfig {
  /** No limits is on (the settings' `unlimited`). */
  unlimited: boolean;
  /** Crowd balls a multi-ball mode starts with on top of its team balls (the Ball Count past them). */
  crowdCount: number;
  /** --- uncap-all --- A setting is past its memory-safety ceiling: the run builds less than it asks for (ARENA FULL). */
  memoryFull?: boolean;
}

export const DEFAULT_UNLIMITED_CONFIG: UnlimitedConfig = { unlimited: false, crowdCount: 0 };

/**
 * --- uncap-all --- No speed ceiling any more: the fastest a ball may move is the float range itself (a speed past it
 * overflows to ±Infinity and the ball is rescued at the centre). Kept for the callers and tests that name it.
 */
export const MAX_SAFE_SPEED = Number.MAX_VALUE;

/**
 * --- uncap-all --- The comfort ranges' ends of the core config values (the Ball & Physics sliders, `RANGES` in settings.ts –
 * a test keeps them equal): past one of them the runtime engages by itself, also in an engine built without the page.
 */
export const CORE_COMFORT: Readonly<Record<"ballSpeed" | "ballRadius" | "gravity" | "rotationSpeed" | "wallCount", number>> = {
  ballSpeed: 800,
  ballRadius: 30,
  gravity: 2000,
  rotationSpeed: 5,
  wallCount: 20,
};

/** True when a config value sits past its slider's comfort range (core values, physics extras, split limits) or brings a crowd. */
export function coreBeyondComfort(config: Partial<PhysicsConfig>): boolean {
  for (const key of Object.keys(CORE_COMFORT) as (keyof typeof CORE_COMFORT)[]) {
    const v = config[key];
    if (typeof v === "number" && v > CORE_COMFORT[key]) return true;
  }
  for (const key of PHYSICS_EXTRA_KEYS) {
    const v = config[key];
    const r = PHYSICS_EXTRA_RANGES[key];
    if (typeof v === "number" && (v > r.max || v < r.min)) return true;
  }
  if (typeof config.splitMinRadius === "number" && config.splitMinRadius > BALL_INTERACTION_RANGES.splitMinRadius.max) return true;
  if (typeof config.maxBalls === "number" && config.maxBalls > BALL_INTERACTION_RANGES.maxBalls.max) return true;
  return (Number(config.crowdCount) || 0) > 0;
}
/** Sound events handed to the synth per frame at most while No limits is on. */
export const MAX_SOUNDS_PER_FRAME = 24;
/** Balls up to this radius are left to the engine's ring collisions; bigger ones are fitted into the rings (bursting them). */
export const FIT_FROM_RADIUS = 30;
/**
 * Ball sub-steps one step may take at most with No limits on (full-physics balls × sub-steps): past it the step has fewer
 * sub-steps and is shortened in proportion (more time dilation), so thousands of fast balls cost a bounded step.
 */
export const STEP_WORK_CAP = 4_000;
/**
 * Ball sub-steps × rings one step may take at most with No limits on (every full-physics ball is checked against every
 * ring a few times a sub-step): a thousand rings get fewer sub-steps (and more dilation), the default run keeps its 64.
 */
export const STEP_RING_WORK = 60_000;
/**
 * From this many rings (past the Wall Count slider) the rings are packed tighter than a ball, which then touches dozens at
 * once: with No limits on each pass of the ring collisions resolves one rebound and leaves the rest to the next pass
 * (at most five a sub-step), instead of rebounding off every overlapping ring in turn.
 */
export const DENSE_RINGS_FROM = 24;
/**
 * Full-physics balls up to which ball-to-ball collisions run (every pair through the spatial hash). Past it – a clone
 * storm spawned in one spot, where even the hash finds hundreds of thousands of touching pairs – they pass through each
 * other like the crowd does.
 */
export const PAIR_COLLISIONS_UP_TO = 500;
/** From this many balls (full-physics + crowd) the canvas drops glow and trails and draws plain discs in batches. */
export const LOD_PLAIN_FROM = 2_000;
/** From this many crowd balls the crowd is drawn as points into one image. */
export const LOD_POINTS_FROM = 20_000;
/**
 * Crowd balls that pour in per step at a run's start: a million-ball crowd appears over 20 steps (a third of a second) as
 * a stream from the centre instead of one 150 ms step that would freeze the first frame. By step count, so a seed replays it.
 */
export const CROWD_POUR_PER_STEP = 50_000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * --- uncap-all --- The size of a crowd ball: the crowd is the degraded, typed-array representation of balls past the
 * full-physics ones (lib/physics/crowd.ts) and moves its balls through ring lanes as small bodies, so a crowd ball is
 * drawn and bounced at most `FIT_FROM_RADIUS` px wide (a full-physics ball of any size is unaffected).
 */
function crowdRadius(radius: number): number {
  return radius > FIT_FROM_RADIUS ? FIT_FROM_RADIUS : radius < 1 || !(radius === radius) ? 1 : radius;
}

/**
 * `fitBallToRings()` of multipliers.ts for any number of rings: the same corridor walk – the ball's corridor between the
 * intact rings is too narrow, so the ring outside it bursts unless it is the arena (the largest intact ring), else the
 * ring inside it; once only the arena is left around a ball too big for it, the ball has outgrown the arena – on the ring
 * indices sorted by radius (`order`, the first `n` entries): O(log n) to find the corridor and O(1) a burst instead of a
 * scan of every ring for every burst, so a ball bigger than a thousand rings costs well under a millisecond, not half a
 * second. Rings in `broken` are skipped; the result goes into `out` (its `burst` list in bursting order).
 */
export function fitIntoSortedRings(dist: number, radius: number, walls: readonly CircularWall[], order: ArrayLike<number>, n: number, broken: ReadonlySet<number>, baseRadius: number, out: RingFit): RingFit {
  out.burst.length = 0;
  out.outgrown = false;
  out.dist = dist;
  let arena = n - 1;
  while (arena >= 0 && broken.has(order[arena])) arena--;
  if (arena < 0) return out;
  const need = radius + FIT_MARGIN;
  const baseNeed = baseRadius + FIT_MARGIN;
  // The first ring (in radius order) at or beyond the ball's centre: the corridor lies between it and the one before.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (walls[order[mid]].radius < dist) lo = mid + 1;
    else hi = mid;
  }
  let innerPos = lo - 1;
  let outerPos = lo;
  for (;;) {
    while (innerPos >= 0 && (broken.has(order[innerPos]) || !(walls[order[innerPos]].radius > 0))) innerPos--;
    while (outerPos < n && broken.has(order[outerPos])) outerPos++;
    if (outerPos >= n) return out; // outside every intact ring: free
    const inner = innerPos >= 0 ? walls[order[innerPos]].radius : 0;
    const outer = walls[order[outerPos]].radius;
    const room = inner > 0 ? (outer - inner) / 2 : outer;
    if (room >= need || (inner > 0 && room < baseNeed)) {
      if (room >= need) out.dist = Math.max(inner > 0 ? inner + need : 0, Math.min(outer - need, dist));
      return out;
    }
    if (outerPos !== arena) out.burst.push(order[outerPos++]);
    else if (innerPos >= 0) out.burst.push(order[innerPos--]);
    else {
      out.outgrown = true;
      return out;
    }
  }
}

/** The No limits config of the page's settings: `teamBalls` is the ball count the mode plays with (effectiveBallCount()). */
export function unlimitedConfigOf(settings: { unlimited: boolean; ballCount: number }, teamBalls: number, multiBallMode: boolean): UnlimitedConfig {
  return uncapConfigOf(settings.unlimited, settings.ballCount, teamBalls, multiBallMode);
}

/**
 * --- uncap-all --- The config the page sends: `engaged` (any setting past its slider – `uncappedEngaged()`) and the crowd –
 * the Ball Count past the team balls in a multi-ball mode, whatever the switch (up to the crowd's memory-safety ceiling).
 */
export function uncapConfigOf(engaged: boolean, ballCount: number, teamBalls: number, multiBallMode: boolean, memoryFull = false): UnlimitedConfig {
  const extra = multiBallMode && Number.isFinite(ballCount) ? Math.floor(ballCount) - teamBalls : 0;
  const crowdCount = extra > 0 ? memoryCeiling("ballCount", extra) : 0;
  // A million balls fill the crowd's typed arrays: the arena is full (ARENA FULL) from there on.
  const full = memoryFull || (multiBallMode && ballCount >= CROWD_LIMIT);
  return { unlimited: engaged || crowdCount > 0, crowdCount, memoryFull: full };
}

/**
 * The raw physics extras of a No limits config (the finder spreads the resolved – clamped – extras over its copy of the
 * page's config; these go back on top, so its engines lift them exactly like the page's). Empty with the switch off.
 */
export function unlimitedExtrasOf(config: Partial<PhysicsConfig>): Partial<PhysicsExtras> {
  if (config.unlimited !== true) return {};
  const out: Partial<PhysicsExtras> = {};
  for (const key of PHYSICS_EXTRA_KEYS) if (config[key] !== undefined) out[key] = config[key];
  return out;
}

/** What the canvas and the page read about a No limits run. */
export interface UnlimitedView {
  on: boolean;
  /** Crowd balls in play, and full-physics balls. */
  crowd: number;
  objects: number;
  /** A spawn was refused: the crowd is at its limit. */
  full: boolean;
  /** Crowd bounces so far. */
  bounces: number;
  /** A ball ate the arena (the run is over), and its radius (px) when it did. */
  ate: boolean;
  ateRadius: number;
  /** Balls put back at the centre after their numbers went non-finite. */
  rescued: number;
}

/** What the runtime asks of the engine at the end of a step. */
export interface LimitsHost {
  /**
   * A ring bursts under a ball too big for it (the engine's smash: effect, sound, split reporting); `quiet` skips the
   * visual effect (particles, shockwave) of a burst past the step's first `BREAK_EFFECTS_PER_STEP` – visual only.
   */
  breakWall(ball: Ball, wallIndex: number, quiet: boolean): void;
}

/**
 * Full-physics balls × rings a run may hold (with No limits on every full-physics ball is checked against every ring
 * several times a sub-step, and packed rings make it rebound off many at once): 2,000 balls up to 10 rings, 200 in 100
 * rings, 20 in a thousand. Spawns and clones past it join the crowd, whose rings cost O(1) a ball.
 */
export const RING_OBJECT_WORK = 20_000;
/** Full-physics balls a run may always hold, however many rings it has. */
export const OBJECT_MIN = 16;

/** The most full-physics balls a run with `rings` rings holds with No limits on (`RING_OBJECT_WORK`, within `OBJECT_MIN` … `OBJECT_BALL_LIMIT`). */
export function objectLimitFor(rings: number): number {
  return Math.max(OBJECT_MIN, Math.min(OBJECT_BALL_LIMIT, Math.floor(RING_OBJECT_WORK / Math.max(1, rings))));
}

/** Wall hits the engine keeps for the canvas' wall glow with No limits on (it drops the older half past it; visual only). */
export const WALL_HITS_KEPT = 512;
/** Ring bursts per step that get their wall-break effect (a ball eating a thousand rings at once shows the first few). */
export const BREAK_EFFECTS_PER_STEP = 12;

const CONFIG_KEYS = ["ballSpeed", "ballRadius", "gravity", "rotationSpeed", "wallCount"] as const;

export class UnlimitedRuntime {
  on = false;
  readonly crowd = new Crowd();
  private crowdTarget = 0;
  /** Crowd balls of this run poured in so far; −1 until the run's first step starts pouring them (`CROWD_POUR_PER_STEP` a step). */
  private crowdPoured = -1;
  /** A clone or spawn was refused at the full-physics limit (a mode without a crowd, e.g. the multipliers board): ARENA FULL. */
  private objectsFull = false;
  private ate = false;
  private rescued = 0;
  private readonly fit: RingFit = { burst: [], outgrown: false, dist: 0 };
  /** The ring indices sorted by radius for `fitIntoSortedRings()` (a scratch array, sorted when a big ball needs it). */
  private readonly ringOrder: number[] = [];
  /** Ring bursts of the current step (only the first `BREAK_EFFECTS_PER_STEP` get an effect). */
  private burstsThisStep = 0;
  /** Packed rings (`DENSE_RINGS_FROM`, the switch on): one rebound per pass of the ring collisions (the engine reads it). */
  onePerPass = false;
  /** Full-physics balls the run may hold at the current ring count (`objectLimitFor()`, updated every step). */
  private objectLimit = OBJECT_BALL_LIMIT;
  /** The engine's split settings and their ball limit as lifted (the ring count lowers it every step). */
  private interaction: BallInteractionConfig | null = null;
  private splitLimit = 0;
  private readonly view: UnlimitedView = { on: false, crowd: 0, objects: 0, full: false, bounces: 0, ate: false, ateRadius: 0, rescued: 0 };
  /** The radius of the ball that outgrew the arena (the banner shows it). */
  private ateRadius = 0;

  /**
   * Engaged mid-run by the engine (`engage()`): a Bounciness grew the rebounds past the old Bouncier's ×3. Together with
   * `on` (the config) it makes `live` – what every step reads.
   */
  private dynamic = false;
  /** --- uncap-all --- The runtime is engaged this step: by the config (`on`) or by the run itself (`engage()`). */
  get live(): boolean {
    return this.on || this.dynamic;
  }
  /** --- uncap-all --- The engine's per-step check: `grown` = the run needs the machinery now (the rebounds outgrew ×3). */
  engage(grown: boolean): boolean {
    this.dynamic = grown;
    return this.on || grown;
  }

  /** Reads the switch and the crowd size from the config (every `setConfig()` and the constructor). */
  configure(config: Partial<PhysicsConfig>) {
    // --- uncap-all --- engaged by the page (any setting past its slider) or by a core value past its comfort range
    this.on = config.unlimited === true || coreBeyondComfort(config);
    this.memoryFull = config.memoryFull === true;
    const crowd = Math.floor(Number(config.crowdCount) || 0);
    const target = this.on && crowd > 0 ? (crowd > CROWD_LIMIT ? CROWD_LIMIT : crowd) : 0; // (the crowd's memory-safety ceiling)
    if (target !== this.crowdTarget) {
      this.crowdTarget = target;
      // A live change of the Ball Count: the crowd is rebuilt at the next step (a new count invalidates a found seed anyway).
      this.crowdPoured = -1;
    }
    if (!this.on && this.crowd.count > 0) this.crowd.reset();
    if (!this.on) this.onePerPass = false;
  }

  /**
   * The config patch as the engine runs it (--- uncap-all --- whatever the switch): an invalid core value (NaN, ±Infinity)
   * is dropped and the Wall Count builds at most `LIVE_WALL_LIMIT` rings – its memory-safety ceiling (the page keeps the
   * typed value). Every other value runs as it is.
   */
  ceilPatch<T extends Partial<PhysicsConfig>>(patch: T, current: Partial<PhysicsConfig>): T {
    void current;
    let out: T | null = null;
    for (const key of CONFIG_KEYS) {
      const value = patch[key];
      if (typeof value !== "number") continue;
      const next = !Number.isFinite(value) ? undefined : key === "wallCount" ? Math.max(1, Math.round(memoryCeiling("wallCount", value))) : value;
      if (next === value) continue;
      out ??= { ...patch };
      if (next === undefined) delete (out as Partial<PhysicsConfig>)[key];
      else (out as Record<string, unknown>)[key] = next;
    }
    return out ?? patch;
  }

  /**
   * Bounds a step's plan (the multipliers' planner, in place): at most `STEP_WORK_CAP` ball sub-steps and `STEP_RING_WORK`
   * ball sub-steps × rings (4 to 64 sub-steps); fewer sub-steps shorten the step in proportion, so no ball moves further
   * per sub-step than the plan allowed.
   */
  boundPlan(plan: StepPlan, balls: number, rings = 0) {
    if (!this.live || balls <= 0) return;
    const maxSub = Math.max(4, Math.min(MAX_SUBSTEPS, Math.floor(STEP_WORK_CAP / balls), Math.floor(STEP_RING_WORK / (balls * Math.max(1, rings)))));
    if (plan.subSteps <= maxSub) return;
    plan.dilation *= maxSub / plan.subSteps;
    plan.subSteps = maxSub;
  }

  /** Whether ball-to-ball collisions run this sub-step (always without the switch; up to `PAIR_COLLISIONS_UP_TO` balls with it). */
  pairsAllowed(balls: number): boolean {
    return !this.live || balls <= PAIR_COLLISIONS_UP_TO;
  }

  /** A count a setter hands the engine (spikes, Target numbers…), at most its memory-safety ceiling (--- uncap-all --- whatever the switch). */
  ceilValue(key: string, value: number): number {
    return Number.isFinite(value) ? memoryCeiling(key, value) : memoryCeiling(key, Number.MAX_VALUE);
  }

  /** Lifts the physics extras and the split limits past their ranges (the resolvers clamped them to the sliders). */
  liftPhysics(extras: PhysicsExtras, interaction: BallInteractionConfig, config: Partial<PhysicsConfig>) {
    if (!this.on) return;
    // --- uncap-all --- the resolvers keep every value as typed now; a raw value the engine was handed is taken exactly
    for (const key of PHYSICS_EXTRA_KEYS) {
      const raw = config[key];
      if (raw === undefined) continue;
      const value = parseUnlimitedValue(key, raw, PHYSICS_EXTRA_RANGES[key]);
      if (value !== null) extras[key] = value;
    }
    const split = config.splitMinRadius !== undefined ? parseUnlimitedValue("splitMinRadius", config.splitMinRadius, BALL_INTERACTION_RANGES.splitMinRadius) : null;
    if (split !== null) interaction.splitMinRadius = split;
    // The split limit counts full-physics balls: past `OBJECT_BALL_LIMIT` they would join the crowd, which never splits.
    const max = config.maxBalls !== undefined ? parseUnlimitedValue("maxBalls", config.maxBalls, BALL_INTERACTION_RANGES.maxBalls) : null;
    if (max !== null) interaction.maxBalls = max > OBJECT_BALL_LIMIT ? OBJECT_BALL_LIMIT : max;
    this.interaction = interaction;
    this.splitLimit = interaction.maxBalls;
    interaction.maxBalls = Math.min(this.splitLimit, this.objectLimit);
  }

  /** A new run (mode init / restart / clear): no crowd yet – it pours in from the first step. */
  reset() {
    this.crowd.reset();
    this.crowdPoured = -1;
    this.objectsFull = false;
    this.ate = false;
    this.ateRadius = 0;
    this.rescued = 0;
  }

  /** How many more full-physics balls fit (spawns past them join the crowd). */
  objectRoom(balls: number): number {
    return Math.max(0, this.objectLimit - balls);
  }

  /**
   * The most balls x2 BALLS clones may bring into play with the switch on: every full-physics ball there is room for at the
   * current ring count (`objectLimitFor()`; the split limit `maxBalls` stays a limit of splits only); clones past it join
   * the crowd (multipliers.ts, `cloneBall()`).
   */
  cloneLimit(maxBalls: number): number {
    return this.live ? this.objectLimit : maxBalls;
  }

  /** A mode refused a clone at its ball limit with the switch on (the multipliers board's count gates): ARENA FULL. */
  noteFull() {
    if (this.live) this.objectsFull = true;
  }

  /** --- uncap-all --- A setting past its memory-safety ceiling built less than it asks for (the page says so): ARENA FULL. */
  memoryFull = false;

  /** Spawns past the full-physics balls: a burst into the crowd (false, and ARENA FULL, when it is at its limit). */
  overflow(n: number, x: number, y: number, speed: number, radius: number, angle: number, color: number): boolean {
    const want = Math.max(0, Math.floor(n));
    return this.crowd.spawnBurst(want, x, y, speed, crowdRadius(radius), angle, color, 1) === want; // --- uncap-all --- (no speed ceiling)
  }

  /**
   * Once per step, before the ball loop: the crowd of a new run pours in (`CROWD_POUR_PER_STEP` balls a step from the
   * centre, in evenly spread directions – golden-angle steps continued across the steps – and the colours of the
   * `palette` ball slots; its memory is reserved once), and balls past the comfortable size range are fitted into their
   * rings before the rings can fling them (a ball bigger than the arena eats it right away). Pure: no random numbers.
   */
  beginStep(ctx: ModeContext, mult: MultiplierRuntime, host: LimitsHost, palette: number) {
    if (!this.live) return;
    const config = ctx.config;
    this.burstsThisStep = 0;
    this.objectLimit = objectLimitFor(ctx.getCircularWalls().length);
    this.onePerPass = ctx.getCircularWalls().length >= DENSE_RINGS_FROM;
    if (this.interaction) this.interaction.maxBalls = Math.min(this.splitLimit, this.objectLimit);
    if (this.crowdPoured < 0) {
      this.crowdPoured = 0;
      this.crowd.reset();
      if (this.crowdTarget > 0) this.crowd.reserve(this.crowdTarget);
    }
    if (this.crowdPoured < this.crowdTarget) {
      const speed = config.ballSpeed || 400; // --- uncap-all --- (no speed ceiling)
      const radius = crowdRadius((config.ballRadius || 8) * 0.75);
      const k = Math.min(CROWD_POUR_PER_STEP, this.crowdTarget - this.crowdPoured);
      const slots = Math.max(1, palette);
      this.crowd.spawnBurst(k, config.width / 2, config.height / 2, speed, radius, 0.5 + GOLDEN_ANGLE * this.crowdPoured, this.crowdPoured % slots, slots);
      this.crowdPoured += k;
    }
    // (--- uncap-all --- engaged by the run alone – a Bounciness past ×3 – a big Grow ball keeps its mode's own rules)
    if (this.on && !mult.isOutgrown()) this.fitBigBalls(ctx, mult, host, ctx.getCircularWalls(), ctx.getBrokenWalls(), config.width / 2, config.height / 2);
    this.noteAte(ctx, mult);
  }

  /** The first step after the outgrow finish: the gulp (once). */
  private noteAte(ctx: ModeContext, mult: MultiplierRuntime) {
    if (!mult.isOutgrown() || this.ate) return;
    this.ate = true;
    // --- uncap-all --- a mode's own outgrow inside a step (Territory's ball wider than its board) names the size too
    if (!(this.ateRadius > 0)) this.ateRadius = mult.getView().outgrewRadius;
    ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0, ate: true });
  }

  /**
   * The end of a step: the crowd moves (one pass, one soft sound at most), balls with non-finite numbers are rescued,
   * speeds capped, balls too big for their rings burst them and a ball bigger than the arena ends the run.
   */
  endStep(ctx: ModeContext, mult: MultiplierRuntime, host: LimitsHost, stepSec: number, gx: number, gy: number) {
    if (!this.live) return;
    const config = ctx.config;
    const cx = config.width / 2;
    const cy = config.height / 2;
    const speed = Number.isFinite(config.ballSpeed) && config.ballSpeed > 0 ? config.ballSpeed : 400; // --- uncap-all --- (no speed ceiling)
    const walls = ctx.getCircularWalls();
    const broken = ctx.getBrokenWalls();
    const rotations = ctx.getWallRotations();
    if (this.crowd.count > 0) {
      const loud = this.crowd.step(stepSec, { cx, cy, width: config.width, height: config.height, walls, rotations, broken, gx, gy, speed });
      if (loud) ctx.addPendingSoundEvent({ type: "hit", wallIndex: Math.max(0, this.crowd.lastHitWall), level: Crowd.hitLevel(this.crowd.hitsThisStep), melody: false });
    }
    const balls = ctx.getBalls();
    let rescuedNow = 0;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!Number.isFinite(b.radius) || b.radius <= 0) b.radius = Number.isFinite(config.ballRadius) && config.ballRadius > 0 ? config.ballRadius : 8; // --- uncap-all --- (a radius that overflowed; no size ceiling)
      if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy))) {
        const a = TWO_PI * ((Math.abs(b.id) * 0.618033988749895) % 1);
        // --- uncap-all --- the first one back at the centre, the others of the same step on a golden-angle spiral around
        // it (a thousand balls put back on one point would be a pile every pair check has to look at)
        const k = rescuedNow++;
        const spread = k === 0 || !(b.radius < 1e6) ? 0 : 2.2 * b.radius * Math.sqrt(k);
        b.x = cx + spread * Math.cos(k * GOLDEN_ANGLE);
        b.y = cy + spread * Math.sin(k * GOLDEN_ANGLE);
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        b.trail.length = 0;
        b.trailIndex = 0;
        this.rescued++;
        continue;
      }
      // --- uncap-all --- no speed ceiling: a ball may go as fast as a float can say (past it the rescue above takes it)
    }
    if (this.on && !mult.isOutgrown()) this.fitBigBalls(ctx, mult, host, walls, broken, cx, cy); // (--- uncap-all --- as in beginStep())
    this.noteAte(ctx, mult);
  }

  /**
   * Balls past the comfortable size range: in the ring modes they are fitted into their rings like a grown ball (a ring
   * they no longer fit bursts; bigger than the outermost intact ring, the ball has eaten the arena); without rings, a
   * ball bigger than the canvas has eaten it.
   */
  private fitBigBalls(ctx: ModeContext, mult: MultiplierRuntime, host: LimitsHost, walls: ReturnType<ModeContext["getCircularWalls"]>, broken: ReadonlySet<number>, cx: number, cy: number) {
    const balls = ctx.getBalls();
    const config = ctx.config;
    const screen = 0.5 * Math.hypot(config.width, config.height);
    let sorted = false;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (ball.frozen || !(ball.radius > FIT_FROM_RADIUS)) continue;
      if (walls.length === 0) {
        if (ball.radius >= screen) {
          this.ateRadius = ball.radius;
          mult.outgrow(ctx, ball, screen);
          return;
        }
        continue;
      }
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy);
      if (!sorted) {
        sorted = true;
        const order = this.ringOrder;
        order.length = walls.length;
        for (let w = 0; w < walls.length; w++) order[w] = w;
        order.sort((a, b) => walls[a].radius - walls[b].radius || a - b);
      }
      fitIntoSortedRings(dist, ball.radius, walls, this.ringOrder, walls.length, broken, FIT_FROM_RADIUS, this.fit);
      for (const w of this.fit.burst) host.breakWall(ball, w, ++this.burstsThisStep > BREAK_EFFECTS_PER_STEP);
      if (this.fit.outgrown) {
        this.ateRadius = ball.radius;
        mult.outgrow(ctx, ball);
        return;
      }
    }
  }

  /**
   * At most `MAX_SOUNDS_PER_FRAME` events per frame (in place): the ate-the-arena gulp always (it is queued after the
   * step's bursts, so a ball eating a thousand rings would otherwise lose it behind their "gap" sounds), then the other
   * non-bounce events (breaks, stacks, merges) up to half the frame, then bounces spread evenly over the rest. While the
   * runtime is not engaged the queue is untouched.
   */
  thinSounds(events: SoundEvent[]): SoundEvent[] {
    if (!this.live || events.length <= MAX_SOUNDS_PER_FRAME) return events;
    const keep: SoundEvent[] = [];
    for (const ev of events) if (ev.ate) keep.push(ev);
    for (const ev of events) if (ev.type !== "hit" && !ev.ate && keep.length < MAX_SOUNDS_PER_FRAME / 2) keep.push(ev);
    const hits = events.filter((ev) => ev.type === "hit");
    const room = MAX_SOUNDS_PER_FRAME - keep.length;
    const every = Math.max(1, Math.ceil(hits.length / room));
    for (let i = 0; i < hits.length && keep.length < MAX_SOUNDS_PER_FRAME; i += every) keep.push(hits[i]);
    return keep;
  }

  getView(objects: number): UnlimitedView {
    const v = this.view;
    v.on = this.live; // --- uncap-all --- (engaged by the config or by the run)
    v.crowd = this.crowd.count;
    v.objects = objects;
    v.full = this.crowd.full || this.objectsFull || this.memoryFull; // --- uncap-all --- (or a setting past its memory-safety ceiling)
    v.bounces = this.crowd.bounces;
    v.ate = this.ate;
    v.ateRadius = this.ateRadius;
    v.rescued = this.rescued + this.crowd.rescued;
    return v;
  }
}
