/**
 * --- unlimited --- No limits on the physics side: allowed to melt, never to crash.
 *
 * With the switch on (`PhysicsConfig.unlimited`) the engine takes every setting past its slider range, and this runtime
 * keeps the run alive at any value:
 *
 *  - **Soft ceilings** (`ceilPatch()`): the config values the engine runs are capped at float-safety or memory ceilings
 *    (`ENGINE_CEILINGS` in lib/unlimited.ts – e.g. at most `LIVE_WALL_LIMIT` rings, speeds below 1e12 px/s); the page keeps
 *    the typed value. The physics extras and the split limits are lifted past their ranges (`liftPhysics()`), and the
 *    multiplier cap is off – stacks multiply without a ceiling (the float-safety one of multipliers.ts aside).
 *  - **The crowd** (crowd.ts): a Ball Count past the team balls and every spawn past `OBJECT_BALL_LIMIT` full-physics balls
 *    become crowd balls in typed arrays, up to `CROWD_LIMIT`; beyond that spawning stops with the ARENA FULL badge.
 *  - **Bounded steps**: the engine plans every step like a multiplier run – enough sub-steps that no ball moves more than
 *    half its radius, at most 64; beyond that the step itself is shortened (time dilation, the simulation runs in slow
 *    motion) – and hashes every ball pair. How much of that the page runs per frame is the frame budget's call
 *    (lib/simulation/frameBudget.ts: whole steps only, so a seed plays the same at any budget).
 *  - **Finite numbers**: a ball whose position, velocity or radius is no longer a finite number is put back at the centre
 *    at the Ball Speed; speeds are capped at `MAX_SAFE_SPEED`.
 *  - **The ball ate the arena**: a ball bigger than a ring bursts it, and a ball bigger than the whole arena ends the run
 *    with its own banner and sound (the multipliers' outgrow finish, which stops the physics and holds the banner).
 *  - **Sound**: at most `MAX_SOUNDS_PER_FRAME` events reach the synth per frame (breaks and stacks first), and the crowd's
 *    thousands of bounces play as one soft hit at most every 90 ms.
 *
 * Nothing here draws from the engine's RNG, and every decision depends on the simulation state only, so runs stay
 * deterministic for a seed. With the switch off nothing here runs and the engine takes its old code paths.
 */
import { Crowd } from "./crowd";
import { MAX_SUBSTEPS, fitBallToRings, type MultiplierRuntime, type RingFit, type StepPlan } from "./multipliers";
import { PHYSICS_EXTRA_KEYS, PHYSICS_EXTRA_RANGES } from "./extras";
import { BALL_INTERACTION_RANGES } from "./interactions";
import { TWO_PI, type Ball, type BallInteractionConfig, type ModeContext, type PhysicsConfig, type PhysicsExtras, type SoundEvent } from "./types";
import { CROWD_LIMIT, ENGINE_CEILINGS, OBJECT_BALL_LIMIT, parseUnlimitedValue } from "@/lib/unlimited";

/** The No limits fields of the physics config. */
export interface UnlimitedConfig {
  /** No limits is on (the settings' `unlimited`). */
  unlimited: boolean;
  /** Crowd balls a multi-ball mode starts with on top of its team balls (the Ball Count past them). */
  crowdCount: number;
}

export const DEFAULT_UNLIMITED_CONFIG: UnlimitedConfig = { unlimited: false, crowdCount: 0 };

/** The fastest a ball may move (px/s): far beyond anything visible, well inside float range. */
export const MAX_SAFE_SPEED = 1e12;
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
 * Full-physics balls up to which ball-to-ball collisions run (every pair through the spatial hash). Past it – a clone
 * storm spawned in one spot, where even the hash finds hundreds of thousands of touching pairs – they pass through each
 * other like the crowd does.
 */
export const PAIR_COLLISIONS_UP_TO = 500;
/** From this many balls (full-physics + crowd) the canvas drops glow and trails and draws plain discs in batches. */
export const LOD_PLAIN_FROM = 2_000;
/** From this many crowd balls the crowd is drawn as points into one image. */
export const LOD_POINTS_FROM = 20_000;

/** The No limits config of the page's settings: `teamBalls` is the ball count the mode plays with (effectiveBallCount()). */
export function unlimitedConfigOf(settings: { unlimited: boolean; ballCount: number }, teamBalls: number, multiBallMode: boolean): UnlimitedConfig {
  if (!settings.unlimited) return { ...DEFAULT_UNLIMITED_CONFIG };
  const extra = multiBallMode && Number.isFinite(settings.ballCount) ? Math.floor(settings.ballCount) - teamBalls : 0;
  return { unlimited: true, crowdCount: Math.max(0, Math.min(CROWD_LIMIT, extra)) };
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
  /** A ball ate the arena (the run is over). */
  ate: boolean;
  /** Balls put back at the centre after their numbers went non-finite. */
  rescued: number;
}

/** What the runtime asks of the engine at the end of a step. */
export interface LimitsHost {
  /** A ring bursts under a ball too big for it (the engine's smash: effect, sound, split reporting). */
  breakWall(ball: Ball, wallIndex: number): void;
}

const CONFIG_KEYS = ["ballSpeed", "ballRadius", "gravity", "rotationSpeed", "wallCount"] as const;

export class UnlimitedRuntime {
  on = false;
  readonly crowd = new Crowd();
  private crowdTarget = 0;
  /** The crowd of this run was spawned (it is, once, at the first step: the run's first frame already shows it). */
  private crowdSpawned = false;
  private ate = false;
  private rescued = 0;
  private readonly fit: RingFit = { burst: [], outgrown: false, dist: 0 };
  private readonly view: UnlimitedView = { on: false, crowd: 0, objects: 0, full: false, bounces: 0, ate: false, rescued: 0 };

  /** Reads the switch and the crowd size from the config (every `setConfig()` and the constructor). */
  configure(config: Partial<PhysicsConfig>) {
    this.on = config.unlimited === true;
    const target = this.on ? Math.max(0, Math.min(CROWD_LIMIT, Math.floor(Number(config.crowdCount) || 0))) : 0;
    if (target !== this.crowdTarget) {
      this.crowdTarget = target;
      // A live change of the Ball Count: the crowd is rebuilt at the next step (a new count invalidates a found seed anyway).
      this.crowdSpawned = false;
    }
    if (!this.on && this.crowd.count > 0) this.crowd.reset();
  }

  /**
   * The config patch as the engine runs it: with the switch on (in the patch, or already), the core values are capped at
   * their engine ceilings (the page keeps the typed values). Without it the patch is returned as it is.
   */
  ceilPatch<T extends Partial<PhysicsConfig>>(patch: T, current: Partial<PhysicsConfig>): T {
    const on = patch.unlimited ?? current.unlimited;
    if (on !== true) return patch;
    let out: T | null = null;
    for (const key of CONFIG_KEYS) {
      const value = patch[key];
      if (typeof value !== "number") continue;
      const ceiling = ENGINE_CEILINGS[key];
      const next = !Number.isFinite(value) ? undefined : Math.min(ceiling, value);
      if (next === value) continue;
      out ??= { ...patch };
      if (next === undefined) delete (out as Partial<PhysicsConfig>)[key];
      else (out as Record<string, unknown>)[key] = key === "wallCount" ? Math.max(1, Math.round(next)) : next;
    }
    return out ?? patch;
  }

  /**
   * Bounds a step's plan (the multipliers' planner, in place): at most `STEP_WORK_CAP` ball sub-steps (4 to 64 sub-steps);
   * fewer sub-steps shorten the step in proportion, so no ball moves further per sub-step than the plan allowed.
   */
  boundPlan(plan: StepPlan, balls: number) {
    if (!this.on || balls <= 0) return;
    const maxSub = Math.max(4, Math.min(MAX_SUBSTEPS, Math.floor(STEP_WORK_CAP / balls)));
    if (plan.subSteps <= maxSub) return;
    plan.dilation *= maxSub / plan.subSteps;
    plan.subSteps = maxSub;
  }

  /** Whether ball-to-ball collisions run this sub-step (always without the switch; up to `PAIR_COLLISIONS_UP_TO` balls with it). */
  pairsAllowed(balls: number): boolean {
    return !this.on || balls <= PAIR_COLLISIONS_UP_TO;
  }

  /** A count a setter hands the engine (spikes, Target numbers…), at its soft ceiling with the switch on (as it is without). */
  ceilValue(key: string, value: number): number {
    if (!this.on) return value;
    const ceiling = ENGINE_CEILINGS[key];
    if (ceiling === undefined) return value;
    return Number.isFinite(value) ? Math.min(ceiling, value) : ceiling;
  }

  /** Lifts the physics extras and the split limits past their ranges (the resolvers clamped them to the sliders). */
  liftPhysics(extras: PhysicsExtras, interaction: BallInteractionConfig, config: Partial<PhysicsConfig>) {
    if (!this.on) return;
    for (const key of PHYSICS_EXTRA_KEYS) {
      const raw = config[key];
      if (raw === undefined) continue;
      const range = PHYSICS_EXTRA_RANGES[key];
      const value = parseUnlimitedValue(key, raw, range);
      if (value === null) continue;
      const ceiling = ENGINE_CEILINGS[key] ?? Number.MAX_VALUE;
      extras[key] = Math.max(-ceiling, Math.min(ceiling, value));
    }
    const split = config.splitMinRadius !== undefined ? parseUnlimitedValue("splitMinRadius", config.splitMinRadius, BALL_INTERACTION_RANGES.splitMinRadius) : null;
    if (split !== null) interaction.splitMinRadius = Math.min(ENGINE_CEILINGS.splitMinRadius, split);
    const max = config.maxBalls !== undefined ? parseUnlimitedValue("maxBalls", config.maxBalls, BALL_INTERACTION_RANGES.maxBalls) : null;
    if (max !== null) interaction.maxBalls = Math.min(OBJECT_BALL_LIMIT, max);
  }

  /** A new run (mode init / restart / clear): no crowd yet – it is spawned at the first step. */
  reset() {
    this.crowd.reset();
    this.crowdSpawned = false;
    this.ate = false;
    this.rescued = 0;
  }

  /** How many more full-physics balls fit (spawns past them join the crowd). */
  objectRoom(balls: number): number {
    return Math.max(0, OBJECT_BALL_LIMIT - balls);
  }

  /** Spawns past the full-physics balls: a burst into the crowd (false, and ARENA FULL, when it is at its limit). */
  overflow(n: number, x: number, y: number, speed: number, radius: number, angle: number, color: number): boolean {
    const want = Math.max(0, Math.floor(n));
    return this.crowd.spawnBurst(want, x, y, Math.min(MAX_SAFE_SPEED, speed), Math.max(1, Math.min(FIT_FROM_RADIUS, radius)), angle, color, 1) === want;
  }

  /**
   * Once per step, before the ball loop: the crowd of a new run appears (evenly spread directions from the centre, the
   * colours of the `palette` ball slots), and balls past the comfortable size range are fitted into their rings before
   * the rings can fling them (a ball bigger than the arena eats it right away). Pure: no random numbers.
   */
  beginStep(ctx: ModeContext, mult: MultiplierRuntime, host: LimitsHost, palette: number) {
    if (!this.on) return;
    const config = ctx.config;
    if (!this.crowdSpawned) {
      this.crowdSpawned = true;
      this.crowd.reset();
      if (this.crowdTarget > 0) {
        const speed = Math.min(MAX_SAFE_SPEED, config.ballSpeed || 400);
        const radius = Math.max(1, Math.min(FIT_FROM_RADIUS, (config.ballRadius || 8) * 0.75));
        this.crowd.reserve(this.crowdTarget);
        this.crowd.spawnBurst(this.crowdTarget, config.width / 2, config.height / 2, speed, radius, 0.5, 0, palette);
      }
    }
    if (!mult.isOutgrown()) this.fitBigBalls(ctx, mult, host, ctx.getCircularWalls(), ctx.getBrokenWalls(), config.width / 2, config.height / 2);
    this.noteAte(ctx, mult);
  }

  /** The first step after the outgrow finish: the gulp (once). */
  private noteAte(ctx: ModeContext, mult: MultiplierRuntime) {
    if (!mult.isOutgrown() || this.ate) return;
    this.ate = true;
    ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0, ate: true });
  }

  /**
   * The end of a step: the crowd moves (one pass, one soft sound at most), balls with non-finite numbers are rescued,
   * speeds capped, balls too big for their rings burst them and a ball bigger than the arena ends the run.
   */
  endStep(ctx: ModeContext, mult: MultiplierRuntime, host: LimitsHost, stepSec: number, gx: number, gy: number) {
    if (!this.on) return;
    const config = ctx.config;
    const cx = config.width / 2;
    const cy = config.height / 2;
    const speed = Math.min(MAX_SAFE_SPEED, config.ballSpeed || 400);
    const walls = ctx.getCircularWalls();
    const broken = ctx.getBrokenWalls();
    const rotations = ctx.getWallRotations();
    if (this.crowd.count > 0) {
      const loud = this.crowd.step(stepSec, { cx, cy, width: config.width, height: config.height, walls, rotations, broken, gx, gy, speed });
      if (loud) ctx.addPendingSoundEvent({ type: "hit", wallIndex: Math.max(0, this.crowd.lastHitWall), level: Crowd.hitLevel(this.crowd.hitsThisStep), melody: false });
    }
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!Number.isFinite(b.radius) || b.radius <= 0) b.radius = Math.min(ENGINE_CEILINGS.ballRadius, config.ballRadius || 8);
      if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy))) {
        const a = TWO_PI * ((Math.abs(b.id) * 0.618033988749895) % 1);
        b.x = cx;
        b.y = cy;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        b.trail.length = 0;
        b.trailIndex = 0;
        this.rescued++;
        continue;
      }
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 > MAX_SAFE_SPEED * MAX_SAFE_SPEED) {
        const k = MAX_SAFE_SPEED / Math.sqrt(v2);
        b.vx *= k;
        b.vy *= k;
      }
    }
    if (!mult.isOutgrown()) this.fitBigBalls(ctx, mult, host, walls, broken, cx, cy);
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
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (ball.frozen || !(ball.radius > FIT_FROM_RADIUS)) continue;
      if (walls.length === 0) {
        if (ball.radius >= screen) {
          mult.outgrow(ctx, ball, screen);
          return;
        }
        continue;
      }
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy);
      fitBallToRings(dist, ball.radius, walls, broken, FIT_FROM_RADIUS, this.fit);
      for (const w of this.fit.burst) host.breakWall(ball, w);
      if (this.fit.outgrown) {
        mult.outgrow(ctx, ball);
        return;
      }
    }
  }

  /**
   * At most `MAX_SOUNDS_PER_FRAME` events per frame (in place): every non-bounce event first (breaks, stacks, merges, the
   * ate-the-arena sound), then bounces spread evenly over the frame. Without the switch the queue is untouched.
   */
  thinSounds(events: SoundEvent[]): SoundEvent[] {
    if (!this.on || events.length <= MAX_SOUNDS_PER_FRAME) return events;
    const keep: SoundEvent[] = [];
    for (const ev of events) if (ev.type !== "hit" && keep.length < MAX_SOUNDS_PER_FRAME / 2) keep.push(ev);
    const hits = events.filter((ev) => ev.type === "hit");
    const room = MAX_SOUNDS_PER_FRAME - keep.length;
    const every = Math.max(1, Math.ceil(hits.length / room));
    for (let i = 0; i < hits.length && keep.length < MAX_SOUNDS_PER_FRAME; i += every) keep.push(hits[i]);
    return keep;
  }

  getView(objects: number): UnlimitedView {
    const v = this.view;
    v.on = this.on;
    v.crowd = this.crowd.count;
    v.objects = objects;
    v.full = this.crowd.full;
    v.bounces = this.crowd.bounces;
    v.ate = this.ate;
    v.rescued = this.rescued + this.crowd.rescued;
    return v;
  }
}
