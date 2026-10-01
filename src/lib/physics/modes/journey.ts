import { GLASS_GRAVITY, buildGlassField, glassGravity, glassTempo, hopSpeed, type GlassField } from "./glass";
import { MAX_STAGE_SOUNDS_PER_STEP, STAGE_HEIGHTS, rescaleObstacle, stageHeightPx, type JourneyStage, type StageEnv, type StageMap, type StageObstacleHit } from "../journey/stage";
import {
  DEFAULT_JOURNEY_STAGES,
  MAX_JOURNEY_STAGES,
  formatJourneyStages,
  generateJourneyStages,
  parseJourneyStages,
  sanitizeJourneyStages,
  type JourneyStageSpec,
} from "../journey/sequence";
import { createStage, stageRandom } from "../journey/stages";
import { RingsStage } from "../journey/rings";
import { HomeStage } from "../journey/home";
import { segmentBetween, type Obstacle, type SegmentObstacle } from "../obstacles";
import type { Ball, GameMode, ModeContext, ObstacleHitResult, SoundEvent, WallHitResult } from "../types";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * Journey ("journey" mode, feature gerald-journey – the geraldbounces "Gerald bounces through his commute", "The last stage
 * is so satisfying", "let him out!" clips): a vertical sequence of stages the ball clears one after another, the camera
 * scrolling down with it – a compact rings escape, glass panes, a peg field, multiplier gates, a funnel, a scoring
 * bullseye – until HOME, where Gerald walks through his door, the confetti flies and the total time shows. The stage
 * list is a setting (`journeyStages`, URL `js`: "rings,pegs,glass,multipliers,home", a size suffix "-s" / "-l" per
 * stage) or, with `journeyAutoStages` N, a seeded random sequence of N stages.
 *
 * The stages live in lib/physics/journey/ – each an adapter around the code the other modes already run (see stage.ts)
 * – and this mode is the conductor:
 *  - **Layout**: the column is Glass Smash's shaft (`buildGlassField()`: a portrait field filling the height of the
 *    centred square the recorder crops to); the stages are stacked top-down in it, each `STAGE_HEIGHTS` view heights
 *    tall and laid out from its own seeded generator (one number of the engine's each, so a resize before the run lays
 *    the same journey out again), between two column walls (engine obstacles, silent) that run from above the first
 *    stage down to the ground at HOME – except beside a rings chamber, which brings its own walls.
 *  - **Floating origin**: entering a stage shifts the whole world – stages, walls, the ball and its trail, the engine's
 *    particles (`ctx.shiftWorld()`) and the camera – so the active stage's centre is the canvas centre: the engine's ring
 *    walls are centred there, which lets a rings stage use them as they are.
 *  - **The ball**: one ordinary engine ball with `gravityScale` 0 – the mode integrates the journey's gravity itself in
 *    `onBallStep()` (Glass Smash's gravity at `JOURNEY_GRAVITY` view heights/s², the Gravity setting and the speed
 *    multiplier included), so the audio-reactive engine gravity never touches it and a seed replays exactly; a live
 *    rings stage switches to Classic's gravity and the slow-ball boost (`ballsMayRest` follows the active stage).
 *  - **Transitions**: when the ball's centre leaves the bottom of the active stage, the stage hears `onBallExit`, the
 *    next one is entered, its banner shows ("Stage 2/5: Glass") and a swoosh plays (`SoundEvent.swoosh`,
 *    `ToneGenerator.playSwoosh()`).
 *  - **Camera**: `JourneyView.cameraY` eases toward the active stage (centred when it fits the view, following the ball
 *    down a taller one) and never lets the ball out of the field; advanced per 60 Hz step, so it freezes with a pause.
 *  - **Safety**: a ball that has not moved for `STUCK_MS` (outside the stages that hold it on purpose) gets a seeded hop
 *    (and after `STUCK_SQUEEZE_AFTER` of them in one stage squeezes through to the next), a rings stage widens its gaps
 *    after a while, the bullseye opens its trapdoor – every run reaches HOME, which is what Find Simulation needs; the
 *    ball's speed is capped so it never tunnels through thin glass.
 *  - **The end**: HOME's celebration over, the run is finished; `JourneyView.homeAtMs` is the total time.
 */

/* ------------------------------------------------------------------ settings */

export interface JourneySettings {
  /** The stage list in its text form (see journey/sequence.ts); HOME is always last. */
  stages: string;
  /** 0: play `stages`; 1–12: a seeded random journey of that many stages before HOME (a new one per seed). */
  auto: number;
}

export const DEFAULT_JOURNEY_SETTINGS: JourneySettings = { stages: DEFAULT_JOURNEY_STAGES, auto: 0 };

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const JOURNEY_RANGES = {
  journeyAutoStages: { min: 0, max: MAX_JOURNEY_STAGES, step: 1 },
} as const;

/** The Journey fields of the SimulatorSettings object (URL keys js, jsa). */
export interface JourneyFields {
  journeyStages: string;
  journeyAutoStages: number;
}

/** Fills in the defaults, normalises the stage list and clamps the auto count; bad values fall back to the defaults. */
export function resolveJourneySettings(config: Partial<JourneySettings> | null | undefined, unlimited = false): JourneySettings {
  const out = { ...DEFAULT_JOURNEY_SETTINGS };
  if (!config) return out;
  const R = rangesFor(JOURNEY_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (typeof config.stages === "string") out.stages = sanitizeJourneyStages(config.stages);
  if (config.auto !== undefined) {
    const n = typeof config.auto === "number" || typeof config.auto === "string" ? Number(config.auto) : NaN;
    if (Number.isFinite(n)) out.auto = Math.round(Math.max(R.journeyAutoStages.min, Math.min(R.journeyAutoStages.max, n)));
  }
  return out;
}

/** Picks the Journey settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setJourneySettings()`. */
export function journeySettingsOf(source: JourneyFields): JourneySettings {
  return { stages: source.journeyStages, auto: source.journeyAutoStages };
}

export function journeySettingFields(settings: JourneySettings): JourneyFields {
  return { journeyStages: settings.stages, journeyAutoStages: settings.auto };
}

export function defaultJourneyFields(): JourneyFields {
  return journeySettingFields(DEFAULT_JOURNEY_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike). */
export function resolveJourneyFields(source: Partial<JourneyFields>): JourneyFields {
  return journeySettingFields(resolveJourneySettings({ stages: source.journeyStages, auto: source.journeyAutoStages }));
}

/** Writes the fields that differ from `base` into the URL: `js` (the stage list) and `jsa` (the auto count). */
export function writeJourneyParams(settings: JourneyFields, base: JourneyFields, params: URLSearchParams) {
  if (settings.journeyStages !== base.journeyStages) params.set("js", settings.journeyStages);
  if (settings.journeyAutoStages !== base.journeyAutoStages) params.set("jsa", String(settings.journeyAutoStages));
}

/** Reads `js` and `jsa` into `settings` (a stage list is normalised; bad values fall back to the defaults). */
export function readJourneyParams(params: URLSearchParams, settings: JourneyFields) {
  const next: Partial<JourneyFields> = { ...settings };
  const stages = params.get("js");
  if (stages !== null) next.journeyStages = stages;
  const auto = params.get("jsa");
  if (auto !== null && Number.isFinite(Number(auto))) next.journeyAutoStages = Number(auto);
  Object.assign(settings, resolveJourneyFields(next));
}

/** The stages a journey will play when they do not depend on the seed (null for an auto journey: the seed draws them). */
export function journeyStagesOf(settings: Partial<JourneySettings>): JourneyStageSpec[] | null {
  const s = resolveJourneySettings(settings);
  return s.auto > 0 ? null : parseJourneyStages(s.stages);
}

/* ------------------------------------------------------------------ constants */

/** The journey's gravity in view heights per s² at the default Gravity setting (Glass Smash uses 3.2). */
export const JOURNEY_GRAVITY = 2.4;
/** Room above the first stage's content where the ball starts, in view heights below its top. */
export const START_DROP = 0.04;
/** How long the stage banner shows (ms). */
export const JOURNEY_BANNER_MS = 1600;
/** Time constant of the camera (s). */
export const JOURNEY_CAMERA_TAU = 0.16;
/** Where the camera keeps the ball in a stage taller than the view (fraction of the view height from the top). */
export const JOURNEY_CAMERA_FOLLOW = 0.38;
/** A ball that moved less than `STUCK_PX` in `STUCK_MS` gets a seeded hop. */
export const STUCK_MS = 1200;
export const STUCK_PX = 3;
/**
 * After this many hops in one stage the ball squeezes through: it is set down just below the stage, at a seeded spot
 * within a tenth of the column's width of its centre line, drifting (a last resort for settings no layout foresaw – a
 * huge ball wedged somewhere – so every journey still reaches HOME).
 */
export const STUCK_SQUEEZE_AFTER = 4;
/** Fastest the ball may fly, in view heights per second (× its speed multiplier): it never tunnels through thin glass. */
export const MAX_BALL_SPEED = 4.2;
/** The column walls keep this much of the approach speed. */
export const COLUMN_RESTITUTION = 0.6;

/** The journey's gravity (px/s²) for a view `viewH` px tall: Glass Smash's, scaled to `JOURNEY_GRAVITY`. */
export function journeyGravity(gravitySetting: number, viewH: number): number {
  return (JOURNEY_GRAVITY / GLASS_GRAVITY) * glassGravity(gravitySetting, viewH);
}

/* ------------------------------------------------------------------ view */

/** What the canvas and the HUD need; the same object every call. */
export interface JourneyView {
  stages: JourneyStage[];
  /** The stage list played (for an auto journey: the one the seed drew). */
  specs: JourneyStageSpec[];
  /** Its text form. */
  sequence: string;
  /** The active stage. */
  active: number;
  field: GlassField | null;
  /** World offset the renderer scrolls by: screen y = world y − cameraY. */
  cameraY: number;
  timeMs: number;
  /** The stage whose banner shows, and since when (simulation ms). */
  bannerStage: number;
  bannerAtMs: number;
  /** 0–1 along the whole journey (the mini-map's ball). */
  progress: number;
  /** Stage heights in view heights (the mini-map's segments). */
  heights: number[];
  score: number;
  swooshes: number;
  notes: number;
  nudges: number;
  homeReached: boolean;
  homeAtMs: number;
  finished: boolean;
  /** Simulation time the run finished at (the celebration over), −1 before. */
  finishedAtMs: number;
}

function createView(): JourneyView {
  return { stages: [], specs: [], sequence: "", active: 0, field: null, cameraY: 0, timeMs: 0, bannerStage: 0, bannerAtMs: 0, progress: 0, heights: [], score: 0, swooshes: 0, notes: 0, nudges: 0, homeReached: false, homeAtMs: -Infinity, finished: false, finishedAtMs: -1 };
}

/* ------------------------------------------------------------------ the mode */

export class JourneyMode implements GameMode {
  readonly name = "journey";
  /** One ball, nothing to collide with. */
  readonly ballsPassThrough = true;
  private settings: JourneySettings = { ...DEFAULT_JOURNEY_SETTINGS };
  private readonly view: JourneyView = createView();
  private stages: JourneyStage[] = [];
  private walls: SegmentObstacle[] = [];
  private obstacles: Obstacle[] = [];
  private readonly ownerOf = new Map<Obstacle, JourneyStage>();
  private ballId = -1;
  private ctx: ModeContext | null = null;
  private soundsThisStep = 0;
  /** The random numbers of the last init, so a resize before the first step lays the journey out again at the new size. */
  private tape: number[] = [];
  private started = false;
  private layoutW = 0;
  private layoutH = 0;
  /** Stuck detection: where the ball was when it last moved, and for how long it has not. */
  private anchorX = 0;
  private anchorY = 0;
  private stillMs = 0;
  /** Hops given in the active stage. */
  private stageNudges = 0;
  private readonly hit: StageObstacleHit;
  private readonly env: StageEnv;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.env = {
      get ctx() {
        return self.ctx!;
      },
      get timeMs() {
        return self.view.timeMs;
      },
      get field() {
        return self.view.field!;
      },
      gravity: (ball) => this.gravity(ball),
      sound: (event, always) => this.queueSound(event, always),
      maxBallRadius: (from) => this.maxBallRadius(from),
      addScore: (points) => {
        this.view.score += points;
      },
    };
    this.hit = { env: this.env, ball: null as unknown as Ball, obstacle: null as unknown as Obstacle, impact: 0 };
  }

  /** The slow-ball boost is off except inside live rings (the active stage decides). */
  get ballsMayRest(): boolean {
    const stage = this.stages[this.view.active];
    return stage ? stage.ballMayRest() : true;
  }

  getSettings(): JourneySettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator re-inits the mode when a Journey setting changes). --- unlimited --- With `unlimited` (No limits on) the unlimited settings run past their sliders, up to their soft ceilings. */
  setSettings(patch: Partial<JourneySettings>, unlimited = false) {
    this.settings = resolveJourneySettings({ ...this.settings, ...patch }, unlimited);
  }
  getView(): JourneyView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    const stage = v.stages[v.active];
    return {
      stage: v.active + 1,
      stages: v.stages.length,
      kind: stage ? stage.kind : "home",
      sequence: v.sequence,
      swooshes: v.swooshes,
      score: v.score,
      home: v.homeReached,
      homeAtMs: v.homeAtMs,
      finished: v.finished,
      nudges: v.nudges,
    };
  }

  /* -------------------------------------------------------------- layout */

  init(ctx: ModeContext) {
    this.ctx = ctx;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const tape: number[] = [];
    const record = () => {
      const u = ctx.random();
      tape.push(u);
      return u;
    };
    this.tape = tape;
    this.started = false;
    const cfg = ctx.config;
    this.build(ctx, record);
    const field = this.view.field!;
    const first = this.stages[0];
    // The start: a seeded spot near the top of the first stage, drifting a little sideways.
    const startX = field.cx + (record() - 0.5) * 0.24 * field.width;
    const startVx = (record() - 0.5) * 0.1 * field.height;
    ctx.addBall({
      x: startX,
      y: first.bounds.top + START_DROP * field.height,
      vx: startVx,
      vy: 0,
      radius: cfg.ballRadius || 8,
      color: cfg.ballColor || "#FFFFFF",
      // The mode integrates its own gravity (onBallStep), so the audio-reactive engine gravity never touches the ball.
      gravityScale: 0,
    });
    this.ballId = ctx.getNextId() - 1;
    this.startRun(ctx);
    // Multiplier gates on the way: the run plays with multipliers from the start (HUD badges, adaptive sub-steps).
    if (this.stages.some((s) => s.kind === "multipliers")) ctx.getMultipliers?.()?.markTouched();
  }

  /** Lays the whole journey out for the current canvas from `random` (the engine's generator or the recorded tape). */
  private build(ctx: ModeContext, random: () => number) {
    const cfg = ctx.config;
    const v = this.view;
    const specs = this.settings.auto > 0 ? generateJourneyStages(this.settings.auto, random) : parseJourneyStages(this.settings.stages);
    const field = buildGlassField(cfg.width, cfg.height);
    const viewH = field.height;
    const r = Math.max(2, cfg.ballRadius || 8);
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    this.stages = specs.map((spec, i) => createStage(spec, i));
    let top = field.top;
    for (const stage of this.stages) {
      const h = stageHeightPx(stage.kind, stage.size, viewH);
      const seed = Math.floor(random() * 0x100000000);
      stage.init({ left: field.left, right: field.right, top, bottom: top + h, cx: field.cx, width: field.width, height: h, viewH }, stageRandom(seed), r);
      top += h;
    }
    // The column walls: one pair per run of stages without walls of their own (a rings chamber brings its own), from a
    // view height above the first stage down to the ground at HOME.
    const home = this.stages[this.stages.length - 1];
    const groundY = home instanceof HomeStage ? home.groundY : home.bounds.bottom;
    this.walls = [];
    let runTop = field.top - viewH;
    for (let i = 0; i <= this.stages.length; i++) {
      const stage = this.stages[i];
      if (stage && !stage.ownWalls) continue;
      const runBottom = stage ? stage.bounds.top : groundY;
      if (runBottom > runTop + 1) this.walls.push(segmentBetween(field.left, runTop, field.left, runBottom, { restitution: COLUMN_RESTITUTION }), segmentBetween(field.right, runTop, field.right, runBottom, { restitution: COLUMN_RESTITUTION }));
      if (stage) runTop = stage.bounds.bottom;
    }
    this.obstacles = [...this.walls];
    this.ownerOf.clear();
    for (const stage of this.stages) {
      for (const o of stage.obstacles) {
        this.obstacles.push(o);
        this.ownerOf.set(o, stage);
      }
    }
    ctx.setObstacles(this.obstacles);
    v.stages = this.stages;
    v.specs = specs;
    v.sequence = formatJourneyStages(specs);
    v.field = field;
    v.heights = specs.map((s) => STAGE_HEIGHTS[s.kind][s.size]);
  }

  /** Resets the run's counters and enters the first stage (the ball is in place). */
  private startRun(ctx: ModeContext) {
    const v = this.view;
    v.active = 0;
    v.cameraY = 0;
    v.timeMs = 0;
    v.bannerStage = 0;
    v.bannerAtMs = 0;
    v.progress = 0;
    v.score = 0;
    v.swooshes = 0;
    v.notes = 0;
    v.nudges = 0;
    v.homeReached = false;
    v.homeAtMs = -Infinity;
    v.finished = false;
    v.finishedAtMs = -1;
    this.soundsThisStep = 0;
    this.stillMs = 0;
    ctx.setCircularWalls([]);
    ctx.setWallRotations([]);
    ctx.getBrokenWalls().clear();
    const ball = this.findBall(ctx);
    if (ball) this.enterStage(ctx, 0, ball, false);
    v.cameraY = 0;
    if (ball) {
      this.anchorX = ball.x;
      this.anchorY = ball.y;
    }
  }

  /* -------------------------------------------------------------- helpers */

  private findBall(ctx: ModeContext): Ball | null {
    const balls = ctx.getBalls();
    for (const b of balls) if (b.id === this.ballId) return b;
    return balls.length > 0 ? balls[0] : null;
  }

  private gravity(ball?: Pick<Ball, "mult"> | null): number {
    const k = ball ? glassTempo(ball) : 1;
    const viewH = this.view.field ? this.view.field.height : 600;
    return journeyGravity(this.ctx ? this.ctx.config.gravity : 300, viewH) * k * k;
  }

  private queueSound(event: SoundEvent, always = false) {
    if (!always && this.soundsThisStep >= MAX_STAGE_SOUNDS_PER_STEP) return;
    this.soundsThisStep++;
    this.view.notes++;
    this.ctx?.addPendingSoundEvent(event);
  }

  /** The largest radius the ball may grow to and still pass every stage from `from` on (and a fifth of the column at most). */
  private maxBallRadius(from: number): number {
    const field = this.view.field;
    let max = field ? 0.1 * field.width : Infinity;
    for (let i = Math.max(0, from); i < this.stages.length; i++) max = Math.min(max, this.stages[i].maxBallRadius());
    return max;
  }

  /** Shifts the whole world by `dy` – stages, column walls, the ball and its trail, the engine's particles and the camera. */
  private shiftWorld(ctx: ModeContext, dy: number) {
    if (dy === 0) return;
    for (const stage of this.stages) stage.shift(dy);
    for (const w of this.walls) w.y += dy;
    ctx.shiftWorld?.(0, dy);
    this.view.cameraY += dy;
    this.anchorY += dy;
  }

  /** Makes stage `index` the active one: the world shifts so its centre is the canvas centre, its banner shows, a swoosh plays. */
  private enterStage(ctx: ModeContext, index: number, ball: Ball, swoosh: boolean) {
    const stage = this.stages[index];
    if (!stage) return;
    const dy = ctx.config.height / 2 - (stage.bounds.top + stage.bounds.bottom) / 2;
    this.shiftWorld(ctx, dy);
    this.view.active = index;
    this.stageNudges = 0;
    this.view.bannerStage = index;
    this.view.bannerAtMs = this.view.timeMs;
    stage.enter?.(this.env, ball);
    if (swoosh) {
      this.view.swooshes++;
      this.queueSound({ type: "hit", wallIndex: 0, swoosh: true, melody: false }, true);
    }
  }

  /** Where the camera wants to be for `stage` with the ball at `ballY`: the stage centred, or following the ball down a taller one. */
  private cameraTarget(stage: JourneyStage, ballY: number): number {
    const f = this.view.field!;
    const b = stage.bounds;
    let top: number;
    if (b.height <= 0.98 * f.height) top = (b.top + b.bottom) / 2 - f.height / 2;
    else top = Math.max(b.top, Math.min(b.bottom - f.height, ballY - JOURNEY_CAMERA_FOLLOW * f.height));
    return top - f.top;
  }

  /* -------------------------------------------------------------- the step */

  onPreUpdate(ctx: ModeContext) {
    this.ctx = ctx;
    this.soundsThisStep = 0;
    this.started = true;
    this.view.timeMs = ctx.getElapsedMs();
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    if (ball.id !== this.ballId) return;
    const stage = this.stages[this.view.active];
    if (!stage) return;
    if (!stage.controlsBall()) {
      const override = stage.gravityOverride ? stage.gravityOverride(this.env, ball) : -1;
      ball.vy += (override >= 0 ? override : this.gravity(ball)) * dtSec;
      // Never faster than the cap (× the speed multiplier): nothing tunnels through thin glass.
      const field = this.view.field!;
      const cap = Math.max(MAX_BALL_SPEED * field.height, 1.6 * (ctx.config.ballSpeed || 400)) * glassTempo(ball);
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > cap) {
        ball.vx *= cap / speed;
        ball.vy *= cap / speed;
      }
    }
    stage.onBallStep?.(this.env, ball, dtSec);
  }

  onPostSubStep(ctx: ModeContext) {
    const ball = this.findBall(ctx);
    const field = this.view.field;
    const stage = this.stages[this.view.active];
    if (!ball || !field || !stage) return;
    // Safety net behind the walls: the ball never leaves the column (or the active stage's chamber).
    const left = field.cx - stage.reach;
    const right = field.cx + stage.reach;
    if (ball.x < left + ball.radius) {
      ball.x = left + ball.radius;
      if (ball.vx < 0) ball.vx = -ball.vx * COLUMN_RESTITUTION;
    } else if (ball.x > right - ball.radius) {
      ball.x = right - ball.radius;
      if (ball.vx > 0) ball.vx = -ball.vx * COLUMN_RESTITUTION;
    }
  }

  onWallHit(): WallHitResult | void {
    const stage = this.stages[this.view.active];
    if (stage instanceof RingsStage) return stage.onWallHit();
  }

  onGapPass(): boolean {
    const stage = this.stages[this.view.active];
    // A live rings stage plays by Classic's rules (the default break); there are no other rings.
    return stage instanceof RingsStage ? stage.onGapPass() : true;
  }

  onObstacleHit(ctx: ModeContext, ball: Ball, obstacle: Obstacle, index: number, impact: number): ObstacleHitResult {
    this.ctx = ctx;
    const stage = this.ownerOf.get(obstacle);
    // The column walls are silent (the stages make the music).
    if (!stage || !stage.onObstacleHit) return { suppressSound: true };
    this.hit.ball = ball;
    this.hit.obstacle = obstacle;
    this.hit.impact = impact;
    const result = stage.onObstacleHit(this.hit);
    if (!result || result.frequency === undefined) return { suppressSound: true, ...(result ?? {}) };
    if (result.suppressSound) return result;
    if (this.soundsThisStep >= MAX_STAGE_SOUNDS_PER_STEP) return { ...result, suppressSound: true };
    this.soundsThisStep++;
    this.view.notes++;
    return result;
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const field = v.field;
    const ball = this.findBall(ctx);
    const dt = dtMs / 1000;
    for (let i = 0; i < this.stages.length; i++) this.stages[i].update?.(this.env, ball, dt, i === v.active);
    if (!ball || !field) return;
    // Out of the bottom of the active stage: on to the next one.
    const stage = this.stages[v.active];
    if (stage && v.active < this.stages.length - 1 && ball.y > stage.bounds.bottom) {
      stage.onBallExit?.(this.env, ball);
      this.enterStage(ctx, v.active + 1, ball, true);
    }
    const active = this.stages[v.active];
    // The camera eases toward the stage and never lets the ball out of the field.
    const target = this.cameraTarget(active, ball.y);
    v.cameraY += (target - v.cameraY) * (1 - Math.exp(-dt / JOURNEY_CAMERA_TAU));
    const margin = ball.radius + 4;
    const lo = ball.y - field.bottom + margin;
    const hi = ball.y - field.top - margin;
    if (v.cameraY < lo) v.cameraY = lo;
    if (v.cameraY > hi) v.cameraY = hi;
    // Progress along the whole journey (the mini-map).
    let before = 0;
    let total = 0;
    for (let i = 0; i < v.heights.length; i++) {
      if (i < v.active) before += v.heights[i];
      total += v.heights[i];
    }
    const b = active.bounds;
    const within = b.height > 0 ? Math.max(0, Math.min(1, (ball.y - b.top) / b.height)) : 0;
    v.progress = total > 0 ? Math.min(1, (before + within * v.heights[v.active]) / total) : 0;
    // HOME.
    if (active instanceof HomeStage) {
      if (active.home && !v.homeReached) {
        v.homeReached = true;
        v.homeAtMs = active.homeAtMs;
      }
      if (active.isFinished() && !v.finished) {
        v.finished = true;
        v.finishedAtMs = v.timeMs;
      }
    }
    this.checkStuck(ctx, ball, active, dtMs);
  }

  /** A ball that has not moved for a while (resting where no stage means it to) gets a seeded hop. */
  private checkStuck(ctx: ModeContext, ball: Ball, stage: JourneyStage, dtMs: number) {
    if (stage.controlsBall() || stage.holdsBall?.() || !stage.ballMayRest()) {
      this.stillMs = 0;
      this.anchorX = ball.x;
      this.anchorY = ball.y;
      return;
    }
    if (Math.hypot(ball.x - this.anchorX, ball.y - this.anchorY) > STUCK_PX) {
      this.anchorX = ball.x;
      this.anchorY = ball.y;
      this.stillMs = 0;
      return;
    }
    this.stillMs += dtMs;
    if (this.stillMs < STUCK_MS) return;
    const field = this.view.field!;
    this.stillMs = 0;
    this.view.nudges++;
    if (++this.stageNudges > STUCK_SQUEEZE_AFTER && stage.kind !== "home") {
      // Still stuck: squeeze through to just below the stage (the next step enters the next one) – at a seeded spot off
      // the centre line and drifting a little, so it does not land dead-centre on a peg straight below and balance there.
      ball.x = field.cx + (ctx.random() - 0.5) * 0.2 * field.width;
      ball.y = stage.bounds.bottom + 1;
      ball.vx = (ctx.random() - 0.5) * 0.1 * field.height;
      ball.vy = 0;
      for (const p of ball.trail) {
        p.x = ball.x;
        p.y = ball.y;
      }
      return;
    }
    ball.vy = -hopSpeed(this.gravity(ball), 0.07 * field.height);
    ball.vx = (ctx.random() < 0.5 ? -1 : 1) * 0.35 * field.height * glassTempo(ball);
  }

  shouldSkipWallCollision() {
    const stage = this.stages[this.view.active];
    return stage ? stage.skipsWallCollision() : true;
  }

  isFinished() {
    return this.view.finished;
  }

  getState() {
    const v = this.view;
    return { stage: v.active, stages: v.stages.length, sequence: v.sequence, cameraY: v.cameraY, score: v.score, swooshes: v.swooshes, home: v.homeReached, finished: v.finished };
  }

  /* -------------------------------------------------------------- resize */

  /**
   * A canvas resize before the first step lays the journey out afresh from the same random numbers (exactly what an init
   * at that size gives, so the run is the one Find Simulation measures); later it maps the whole world – stages, walls,
   * the ball and the camera – onto the new field, and a live rings stage rebuilds its rings there.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean, wallCountChanged: boolean, gapChanged: boolean) {
    this.ctx = ctx;
    const stage = this.stages[this.view.active];
    const ball = this.findBall(ctx);
    if (sizeChanged && this.view.field && this.layoutW > 0 && this.layoutH > 0) {
      if (this.started) this.rescale(ctx);
      else this.relayout(ctx);
    } else if (gapChanged && stage instanceof RingsStage && ball) stage.rebuildLive(this.env, ball.radius);
    return true;
  }

  private relayout(ctx: ModeContext) {
    let i = 0;
    const replay = () => (i < this.tape.length ? this.tape[i++] : 0.5);
    this.build(ctx, replay);
    const field = this.view.field!;
    const ball = this.findBall(ctx);
    if (ball) {
      ball.x = field.cx + (replay() - 0.5) * 0.24 * field.width;
      ball.vx = (replay() - 0.5) * 0.1 * field.height;
      ball.y = this.stages[0].bounds.top + START_DROP * field.height;
      ball.vy = 0;
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
    this.startRun(ctx);
  }

  private rescale(ctx: ModeContext) {
    const cfg = ctx.config;
    const v = this.view;
    const old = v.field!;
    const next = buildGlassField(cfg.width, cfg.height);
    const k = next.height / old.height;
    const ocx = this.layoutW / 2;
    const ocy = this.layoutH / 2;
    const ncx = cfg.width / 2;
    const ncy = cfg.height / 2;
    const map: StageMap = { x: (x) => ncx + (x - ocx) * k, y: (y) => ncy + (y - ocy) * k, k };
    // The engine moved the ball around the canvas centre already (per axis): undo that, then map it like everything else.
    for (const ball of ctx.getBalls()) {
      const x = ocx + (ball.x - ncx) * (this.layoutW / cfg.width);
      const y = ocy + (ball.y - ncy) * (this.layoutH / cfg.height);
      ball.x = map.x(x);
      ball.y = map.y(y);
      ball.vx *= k;
      ball.vy *= k;
    }
    for (const stage of this.stages) stage.rescale(map);
    for (const w of this.walls) rescaleObstacle(w, map);
    v.cameraY *= k;
    v.field = next;
    this.anchorX = map.x(this.anchorX);
    this.anchorY = map.y(this.anchorY);
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    const stage = this.stages[v.active];
    const ball = this.findBall(ctx);
    if (stage instanceof RingsStage && ball) stage.rebuildLive(this.env, ball.radius);
  }
}
