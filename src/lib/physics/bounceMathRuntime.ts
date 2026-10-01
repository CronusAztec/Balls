import type { Ball, ModeContext, ModeId, SoundEvent } from "./types";
import type { MultiplierRuntime } from "./multipliers";
import { MULTIPLY_MAX_BALLS } from "./modes/multiply";
import { CROWD_LIMIT } from "@/lib/unlimited"; // --- unlimited ---
import { OBSTACLE_EDITOR_MODES } from "./obstacleEditor";
import { wallHitFrequency } from "@/lib/audio/sampler";
import { beatTimeSec, firstBeatAtOrAfter, sameBeatSchedule } from "@/lib/simulation/beatSchedule";
import { GAP_SIZED_MODES } from "@/lib/simulation/timeline";
import {
  BOUNCE_PARAM_KIND,
  BOUNCE_TRIGGERS,
  DEFAULT_TRAIL_POINTS,
  FLOAT_CEILING,
  applyRule,
  compileRule,
  rotateHue,
  serializeRules,
  type BounceMathConfig,
  type BounceParam,
  type BounceTrigger,
  type CompiledRule,
  type RuleContext,
} from "@/lib/simulation/bounceMath";

/**
 * The engine's half of bounce math (lib/simulation/bounceMath.ts has the rules, the formulas and `applyRule()`). The
 * PhysicsEngine owns one `BounceMathRuntime` and calls it from small delimited hooks:
 *
 * - `note()` where the engine already handles a wall / ring bounce, an obstacle hit, a ball pair and a gap pass (and the
 *   modes' `ctx.creditBounce()` / `ctx.noteBounce()` / `ctx.noteCollide()` – every mode that resolves its own walls, pegs,
 *   panes, arcs or ball pairs reports them), `noteBreakBall()` where a wall break is reported;
 * - `beginStep()` / `endStep()` around every fixed 60 Hz step: the start trigger fires at the start of a run's first
 *   step; at the end of every step the step's wall breaks (its "gap" sound events), the beats and bars of the beat grid
 *   and the seconds of run time that fell into the step are queued, and the queue is applied in order – every rule of the
 *   trigger in list order – so a change always lands between two steps (the multipliers' step plan then covers it).
 *
 * Everything is deterministic: rules draw their random numbers from the engine's seeded `random()` (only "random" rules
 * and formulas that read r draw), nothing reads the wall clock, and a run without rules never enters any of this – the
 * engine takes its exact old code paths. So the seed finder, split-screen arenas, the batch renderer and the fast export,
 * which all build their engines from the page engine's config, replay a rule run exactly.
 *
 * Where a parameter lives:
 *  - per ball: bounciness is `ball.restitution` (the rebound speed factor of the engine's ring rebounds, of obstacle hits –
 *    on top of the obstacle's capped restitution, lifting at most to the cruising speed × it – and of Glass Smash's hops), speed and size are the ball's multipliers (`MultiplierRuntime.apply()`: the speed scale – velocity at once,
 *    the cruising speed from then on – and the radius, so the multipliers' sub-step planner keeps fast balls from
 *    tunnelling and a ball grown past the arena ends the run with their OUTGREW THE ARENA finish), hue turns
 *    `ball.color`, pitch is `ball.pitchShift` (semitones on the ball's bounce notes, through the sound event's pitch);
 *  - the world: gravity, the ring spin speed and the gap size go into the engine's config (restored to the page's values
 *    when the next run starts; the gap only in the modes whose rings are built from it); air drag, the clock scale, the
 *    trail length, the wall thickness and the wobble are held here (the canvas reads the last three);
 *  - balls: copies of the involved ball (the multipliers' clone with a seeded turn), within Multiply's memory-safe
 *    ceiling of `MULTIPLY_MAX_BALLS` (--- unlimited --- with No limits on: up to the run's full-physics balls, the rest
 *    join the crowd).
 * A parameter a mode has no use for is ignored there (`BOUNCE_MATH_BALL_MODES`, `BOUNCE_MATH_SPAWN_MODES`,
 * `BOUNCE_MATH_CLOCK_MODES`, `GAP_SIZED_MODES`).
 */

/** Trigger codes (`BOUNCE_TRIGGERS` order): what the engine's hooks pass to `note()`. */
export const BM_BOUNCE = 0;
export const BM_PASS = 1;
export const BM_COLLIDE = 2;
export const BM_BREAK = 3;
export const BM_BEAT = 4;
export const BM_BAR = 5;
export const BM_SECOND = 6;
export const BM_START = 7;

/** The modes whose balls move under the engine's own physics: bounciness, speed and size act there. */
export const BOUNCE_MATH_BALL_MODES: readonly ModeId[] = [...OBSTACLE_EDITOR_MODES, "drop", "box", "glass", "bullseye", "journey"];
/** The modes where "balls" spawns copies (the ten ring modes: extra balls are ordinary balls there). */
export const BOUNCE_MATH_SPAWN_MODES: readonly ModeId[] = OBSTACLE_EDITOR_MODES;
/** The modes whose clock "timeScale" may scale (the engine integrates every ball there; the step planner covers it). */
export const BOUNCE_MATH_CLOCK_MODES: readonly ModeId[] = [...BOUNCE_MATH_BALL_MODES, "multipliers"];

/** Whether `param` does anything in `mode` (the panel marks a rule whose parameter the mode ignores). */
export function bounceParamApplies(param: BounceParam, mode: ModeId): boolean {
  switch (param) {
    case "bounciness":
    case "speed":
    case "size":
      return BOUNCE_MATH_BALL_MODES.includes(mode);
    case "gap":
      return GAP_SIZED_MODES.includes(mode);
    case "timeScale":
      return BOUNCE_MATH_CLOCK_MODES.includes(mode);
    case "balls":
      return BOUNCE_MATH_SPAWN_MODES.includes(mode);
    default:
      return true;
  }
}

/** The modes whose balls pass the gaps of the engine's rings ("pass"): the ten ring modes and the Journey's ring stage. */
export const BOUNCE_MATH_PASS_MODES: readonly ModeId[] = [...OBSTACLE_EDITOR_MODES, "journey"];
/**
 * The modes with ball-to-ball hits ("collide"): the engine's pair pass (the ring modes with two balls or more, Ball Drop,
 * String Battle) and the modes that resolve their own and report them (`ctx.noteCollide()`).
 */
export const BOUNCE_MATH_COLLIDE_MODES: readonly ModeId[] = [...OBSTACLE_EDITOR_MODES, "drop", "stringBattle", "collide", "multipliers", "battle", "ctf", "doublePendulum"];
/** The modes where something breaks with the wall-break sound ("break": a ring, a pane, a cleared stack, a KO, a crash). */
export const BOUNCE_MATH_BREAK_MODES: readonly ModeId[] = [...OBSTACLE_EDITOR_MODES, "glass", "multipliers", "battle", "paddle", "powerLayers", "runner", "journey"];
// --- odd-territory --- Territory: its balls hit each other in the engine's pair pass, and a bomber's blast plays the wall-break sound
(BOUNCE_MATH_COLLIDE_MODES as ModeId[]).push("territory");
(BOUNCE_MATH_BREAK_MODES as ModeId[]).push("territory");

/**
 * Whether `trigger` ever fires in `mode` (the panel marks a rule whose trigger the mode never sets off). Every mode reports
 * its bounces – the engine's rings and obstacles, the modes' own walls, pegs, panes and arcs (`ctx.noteBounce()`), and in
 * the rhythm modes without contacts the ball's note (a pendulum's swing note, a harp pluck, a vortex ring, a landing) –
 * and the beat, bar, second and start come from the clock.
 */
export function bounceTriggerApplies(trigger: BounceTrigger, mode: ModeId): boolean {
  switch (trigger) {
    case "pass":
      return BOUNCE_MATH_PASS_MODES.includes(mode);
    case "collide":
      return BOUNCE_MATH_COLLIDE_MODES.includes(mode);
    case "break":
      return BOUNCE_MATH_BREAK_MODES.includes(mode);
    default:
      return true;
  }
}

/** A second pass of the same ball through the same wall within this many simulation ms is the same pass. */
export const PASS_DEDUPE_MS = 250;
/** Most trigger events queued per step (a crowd of colliding balls); the rest are counted as dropped. */
export const MAX_EVENTS_PER_STEP = 512;
/** Most beats / bars / seconds one step may fire (a huge clock scale); the schedule then skips ahead. */
export const MAX_TIME_FIRES_PER_STEP = 64;
/** A ball in a mode without rings grows at most to this share of the canvas' smaller side (there is no arena to eat). */
export const OPEN_FIELD_SIZE_SHARE = 0.45;
/** The bounce notes a pitch rule may reach, Hz. */
export const PITCH_MIN_HZ = 20;
export const PITCH_MAX_HZ = 12000;

type WorldKey = "gravity" | "rotationSpeed" | "gapSize";
const WORLD_KEYS: readonly WorldKey[] = ["gravity", "rotationSpeed", "gapSize"];

/** What the runtime needs from the engine. */
export interface BounceMathHost {
  ctx(): ModeContext;
  mode(): ModeId | undefined;
  multipliers(): MultiplierRuntime;
  /** Writes a world value into the engine's config (the gap size resizes the rings' gaps in place). */
  setWorld(key: WorldKey, value: number): void;
  /** The physics extras' air drag (the "damping" parameter's value until a rule sets it). */
  airDrag(): number;
  /** The sound events queued since the last frame (a step's "gap" events are its wall breaks). */
  soundEvents(): readonly SoundEvent[];
}

/** What the panel's readout and the canvas' HUD show; the same object every call. */
export interface BounceMathView {
  /** Rules are in play. */
  active: boolean;
  /** "Show values": the HUD badge is wanted. */
  showValues: boolean;
  /** The ball that bounced last (else the first ball) exists: its values below are meaningful. */
  hasBall: boolean;
  bounciness: number;
  /** The ball's colour (a colour shift turns it). */
  color: string;
  /** px/s. */
  speed: number;
  /** Radius, px. */
  size: number;
  gravity: number;
  balls: number;
  timeScale: number;
  /** NaN while no rule changed it (the page's own value stands). */
  thickness: number;
  wobble: number;
  damping: number;
  trail: number;
  /** How often each rule has fired this run (list order). */
  fires: number[];
  totalFires: number;
  /** Simulation ms of the last fire and the rule that fired (−1 before any). */
  lastFireMs: number;
  lastRule: number;
  /** Trigger events that did not fit into a step's queue. */
  dropped: number;
}

function freshView(): BounceMathView {
  return {
    active: false,
    showValues: true,
    hasBall: false,
    bounciness: 1,
    color: "",
    speed: 0,
    size: 0,
    gravity: 0,
    balls: 0,
    timeScale: 1,
    thickness: NaN,
    wobble: NaN,
    damping: 0,
    trail: DEFAULT_TRAIL_POINTS,
    fires: [],
    totalFires: 0,
    lastFireMs: -Infinity,
    lastRule: -1,
    dropped: 0,
  };
}

/** A pitch `semitones` above `hz`, kept audible. */
export function pitchedFrequency(hz: number, semitones: number): number {
  const f = hz * Math.pow(2, semitones / 12);
  return Number.isNaN(f) ? hz : Math.max(PITCH_MIN_HZ, Math.min(PITCH_MAX_HZ, f));
}

/** The fastest a ball may move, px/s: the float ceiling of a runaway bounciness (not a gameplay limit – see `FLOAT_CEILING`). */
export const SPEED_CEILING = FLOAT_CEILING;

/** The "hit" sound event of a ring bounce off wall `wallIndex` – with the ball's pitch shift (bounce math's "pitch") when it has one. */
export function bounceHitEvent(wallIndex: number, ball: Pick<Ball, "pitchShift">): SoundEvent {
  return ball.pitchShift ? { type: "hit", wallIndex, frequency: pitchedFrequency(wallHitFrequency(wallIndex), ball.pitchShift) } : { type: "hit", wallIndex };
}

/** An obstacle hit's pitch (the mode's, else the innermost-wall tone) with the ball's pitch shift; undefined leaves the event as it was. */
export function shiftedObstacleFrequency(frequency: number | undefined, ball: Pick<Ball, "pitchShift">): number | undefined {
  if (!ball.pitchShift) return frequency;
  return pitchedFrequency(frequency ?? wallHitFrequency(0), ball.pitchShift);
}

/** Keeps the newest `cap` points of a ball's trail, oldest first, as the engine's ring buffer expects (allocates: only when a trail rule fires). */
export function resizeTrail(ball: Pick<Ball, "trail" | "trailIndex">, cap: number): void {
  const trail = ball.trail;
  const len = trail.length;
  const ordered = len === 0 ? [] : [...trail.slice(ball.trailIndex), ...trail.slice(0, ball.trailIndex)];
  ball.trail = ordered.length > cap ? ordered.slice(ordered.length - cap) : ordered;
  ball.trailIndex = 0;
}

export class BounceMathRuntime {
  private config: BounceMathConfig | null = null;
  private rules: CompiledRule[] = [];
  private signature = "";
  /** Rule indices by trigger code. */
  private byTrigger: number[][] = BOUNCE_TRIGGERS.map(() => []);
  private readonly wants = new Uint8Array(BOUNCE_TRIGGERS.length);
  private counts: number[] = [];
  private fires: number[] = [];
  // --- the run
  private started = false;
  private nextBeat = -1;
  private nextBeatSec = NaN;
  private lastBeatSec = 0;
  private beatsFired = 0;
  private nextSecond = 1;
  private stepEventsFrom = 0;
  private timeScale = 1;
  private drag = NaN;
  private trail = DEFAULT_TRAIL_POINTS;
  private thickness = NaN;
  private wobble = NaN;
  private readonly base: Record<WorldKey, number> = { gravity: NaN, rotationSpeed: NaN, gapSize: NaN };
  private publicCache: { from: object; out: object } | null = null;
  private focus: Ball | null = null;
  // --- the step's queue (preallocated: noting a trigger allocates nothing)
  private readonly qKind = new Uint8Array(MAX_EVENTS_PER_STEP);
  private readonly qA: (Ball | null)[] = new Array(MAX_EVENTS_PER_STEP).fill(null);
  private readonly qB: (Ball | null)[] = new Array(MAX_EVENTS_PER_STEP).fill(null);
  private qLen = 0;
  private readonly breakBalls: (Ball | null)[] = new Array(64).fill(null);
  private breakLen = 0;
  private readonly passes = new Map<number, number>();
  private readonly hues = new WeakMap<Ball, { base: string; written: string }>();
  /** The bounciness each ball's speed already carries from rebounds a mode set itself (`modeReboundFactor()`). */
  private carried = new WeakMap<Ball, number>();
  private readonly ruleCtx: RuleContext;
  private readonly view: BounceMathView = freshView();

  constructor(private readonly host: BounceMathHost) {
    this.ruleCtx = { n: 0, t: 0, b: 0, random: () => this.host.ctx().random() };
  }

  /** Rules are in play (the engine's hooks check this first: a run without rules takes the old code paths). */
  get on(): boolean {
    return this.rules.length > 0;
  }

  /** A trigger some rule listens to. */
  wantsTrigger(code: number): boolean {
    return this.wants[code] === 1;
  }

  /**
   * The rules, the beat grid and the canvas parameters' starting values arrive (`PhysicsConfig.bounceMath`). New rules
   * start counting from zero (the run goes on); a new beat grid re-plans the beats from `nowMs`.
   */
  configure(config: BounceMathConfig | null | undefined, nowMs: number) {
    const rules = config?.rules ?? [];
    const signature = serializeRules(rules);
    if (signature !== this.signature) {
      this.signature = signature;
      this.rules = [];
      for (const rule of rules) {
        const compiled = compileRule(rule);
        if (compiled) this.rules.push(compiled);
      }
      this.byTrigger = BOUNCE_TRIGGERS.map(() => []);
      this.wants.fill(0);
      this.rules.forEach((c, i) => {
        const code = BOUNCE_TRIGGERS.indexOf(c.rule.trigger);
        this.byTrigger[code].push(i);
        this.wants[code] = 1;
      });
      this.counts = this.rules.map(() => 0);
      this.fires = this.rules.map(() => 0);
      this.view.fires = this.rules.map(() => 0);
      this.view.totalFires = 0;
    }
    const beatChanged = !!config && (!this.config || !sameBeatSchedule(this.config.beat, config.beat));
    this.config = config ?? null;
    if (beatChanged && this.started) this.planBeats(nowMs / 1000);
    this.view.active = this.rules.length > 0;
    this.view.showValues = config?.showValues ?? true;
  }

  /** A new run: counters, the time triggers, the held values and the queue start over (the engine restores the world first). */
  reset() {
    this.started = false;
    this.nextBeat = -1;
    this.nextBeatSec = NaN;
    this.lastBeatSec = 0;
    this.beatsFired = 0;
    this.nextSecond = 1;
    this.stepEventsFrom = 0;
    this.timeScale = 1;
    this.drag = NaN;
    this.trail = DEFAULT_TRAIL_POINTS;
    this.thickness = NaN;
    this.wobble = NaN;
    this.focus = null;
    this.clearQueue();
    this.breakBalls.fill(null, 0, this.breakLen);
    this.breakLen = 0;
    this.passes.clear();
    this.carried = new WeakMap();
    this.counts.fill(0);
    this.fires.fill(0);
    const v = this.view;
    v.fires.fill(0);
    v.totalFires = 0;
    v.lastFireMs = -Infinity;
    v.lastRule = -1;
    v.dropped = 0;
    v.timeScale = 1;
    v.thickness = NaN;
    v.wobble = NaN;
    v.trail = DEFAULT_TRAIL_POINTS;
    v.hasBall = false;
  }

  /* ---------------------------------------------------------------- world values */

  /** The page's values of the world settings the rules changed this run (the engine puts them back when the next run starts), or null. */
  takeWorldBase(): Partial<Record<WorldKey, number>> | null {
    let patch: Partial<Record<WorldKey, number>> | null = null;
    for (const key of WORLD_KEYS) {
      if (Number.isNaN(this.base[key])) continue;
      (patch ??= {})[key] = this.base[key];
      this.base[key] = NaN;
    }
    this.publicCache = null;
    return patch;
  }

  /** Some world setting holds a rule's value (its page value waits in `base`). */
  worldTouched(): boolean {
    return !Number.isNaN(this.base.gravity) || !Number.isNaN(this.base.rotationSpeed) || !Number.isNaN(this.base.gapSize);
  }

  /**
   * A page's `setConfig()` patch without the world settings it merely re-sends (the page's value of a setting a rule holds,
   * sent again because another setting of the same effect changed): the rule keeps its value. The same object when there
   * is nothing to take out.
   */
  filterPatch<T extends object>(patch: T): T {
    const p = patch as Partial<Record<WorldKey, unknown>>;
    let out: Record<string, unknown> | null = null;
    for (const key of WORLD_KEYS) {
      if (Number.isNaN(this.base[key]) || p[key] !== this.base[key]) continue;
      out ??= { ...(patch as Record<string, unknown>) };
      delete out[key];
    }
    return (out ?? patch) as T;
  }

  /** A `setConfig()` patch: a value it sets for a world setting a rule changed becomes that setting's page value. */
  notePatch(patch: object) {
    if (!this.worldTouched()) return;
    const p = patch as Partial<Record<WorldKey, unknown>>;
    for (const key of WORLD_KEYS) {
      const value = p[key];
      if (typeof value === "number" && !Number.isNaN(this.base[key])) this.base[key] = value;
    }
    this.publicCache = null;
  }

  /**
   * The config as the page set it: the engine's config with the page's values of the world settings a rule changed
   * (cached per config object) – what `engine.config` returns, so the finder, the arenas and the fast export, which copy
   * it, start their runs from the page's gravity, spin and gap, not from a rule's.
   */
  publicConfig<T extends object>(config: T): T {
    if (!this.worldTouched()) return config;
    if (this.publicCache && this.publicCache.from === config) return this.publicCache.out as T;
    const out: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    for (const key of WORLD_KEYS) if (!Number.isNaN(this.base[key])) out[key] = this.base[key];
    this.publicCache = { from: config, out };
    return out as T;
  }

  /** The clock scale of the "timeScale" parameter in `mode` (1 without one): the engine's step covers that much simulated time. */
  clockScale(mode: ModeId | undefined): number {
    return this.timeScale !== 1 && mode !== undefined && BOUNCE_MATH_CLOCK_MODES.includes(mode) ? this.timeScale : 1;
  }

  /** The air drag in effect: a rule's value, else the physics extras' `extrasDrag`. */
  airDrag(extrasDrag: number): number {
    return Number.isNaN(this.drag) ? extrasDrag : this.drag;
  }

  /** How many trail points each ball keeps (20 without a trail rule). */
  trailCap(): number {
    return this.trail;
  }

  /* ---------------------------------------------------------------- triggers */

  /**
   * A trigger with the ball(s) it involves – `b` is the second ball of a collision. The ball of a bounce becomes the
   * readout's ball (the one that bounced last) whether or not a rule listens. Allocation-free.
   */
  note(code: number, a: Ball | null, b: Ball | null = null) {
    if (code === BM_BOUNCE && a) this.focus = a;
    if (this.wants[code] !== 1) return;
    this.enqueue(code, a, b);
  }

  /** A gap pass of `ball` through wall `wallIndex` at `nowMs`: counted once per pass (a pass takes a few sub-steps in the gap). */
  notePass(ball: Ball, wallIndex: number, nowMs: number) {
    if (this.wants[BM_PASS] !== 1) return;
    const key = ball.id * 1024 + wallIndex;
    const last = this.passes.get(key);
    this.passes.set(key, nowMs);
    if (last !== undefined && nowMs - last < PASS_DEDUPE_MS) return;
    this.enqueue(BM_PASS, ball, null);
  }

  /** The ball behind a wall break reported this step (paired, in order, with the step's "gap" sound events). */
  noteBreakBall(ball: Ball) {
    if (this.wants[BM_BREAK] !== 1 || this.breakLen >= this.breakBalls.length) return;
    this.breakBalls[this.breakLen++] = ball;
  }

  private enqueue(code: number, a: Ball | null, b: Ball | null) {
    if (this.qLen >= MAX_EVENTS_PER_STEP) {
      this.view.dropped++;
      return;
    }
    this.qKind[this.qLen] = code;
    this.qA[this.qLen] = a;
    this.qB[this.qLen] = b;
    this.qLen++;
  }

  private clearQueue() {
    for (let i = 0; i < this.qLen; i++) {
      this.qA[i] = null;
      this.qB[i] = null;
    }
    this.qLen = 0;
  }

  /* ---------------------------------------------------------------- the step */

  /** Start of a fixed step at `nowMs` (`eventCount`: the sound events queued so far). The run's first step fires "start". */
  beginStep(nowMs: number, eventCount: number) {
    this.stepEventsFrom = eventCount;
    if (this.started) return;
    this.started = true;
    this.planBeats(nowMs / 1000);
    this.nextSecond = Math.floor(nowMs / 1000 + 1e-9) + 1; // (rules added mid-run count from there)
    if (this.wants[BM_START] === 1) {
      this.enqueue(BM_START, null, null);
      this.process(nowMs);
    }
  }

  /**
   * End of a fixed step that ended at `toMs`: the step's wall breaks, beats, bars and seconds are queued after its bounces,
   * passes and collisions, and every rule applies in order. Returns true when a rule fired.
   */
  endStep(toMs: number): boolean {
    if (this.wants[BM_BREAK] === 1) {
      const events = this.host.soundEvents();
      let k = 0;
      for (let i = Math.min(this.stepEventsFrom, events.length); i < events.length; i++) {
        if (events[i].type !== "gap") continue;
        this.enqueue(BM_BREAK, k < this.breakLen ? this.breakBalls[k] : null, null);
        k++;
      }
    }
    this.breakBalls.fill(null, 0, this.breakLen);
    this.breakLen = 0;
    const toSec = toMs / 1000;
    // Beats (and every fourth one a bar) of the grid that sounded during the step.
    let guard = 0;
    while (this.nextBeatSec <= toSec + 1e-9 && guard < MAX_TIME_FIRES_PER_STEP) {
      if (this.wants[BM_BEAT] === 1) this.enqueue(BM_BEAT, null, null);
      if (this.wants[BM_BAR] === 1 && ((this.nextBeat % 4) + 4) % 4 === 0) this.enqueue(BM_BAR, null, null);
      this.beatsFired++;
      this.lastBeatSec = this.nextBeatSec;
      this.nextBeat++;
      this.nextBeatSec = this.config ? beatTimeSec(this.config.beat, this.nextBeat) : NaN;
      guard++;
    }
    if (guard >= MAX_TIME_FIRES_PER_STEP) this.planBeats(toSec);
    // Whole seconds of run time.
    guard = 0;
    while (this.nextSecond * 1000 <= toMs + 1e-6 && guard < MAX_TIME_FIRES_PER_STEP) {
      if (this.wants[BM_SECOND] === 1) this.enqueue(BM_SECOND, null, null);
      this.nextSecond++;
      guard++;
    }
    if (guard >= MAX_TIME_FIRES_PER_STEP) this.nextSecond = Math.floor(toMs / 1000) + 1;
    const fired = this.qLen > 0 && this.process(toMs);
    this.summarize();
    return fired;
  }

  /** The next beat of the grid at or after `fromSec`. */
  private planBeats(fromSec: number) {
    const beat = this.config?.beat;
    if (!beat) {
      this.nextBeat = -1;
      this.nextBeatSec = NaN;
      return;
    }
    this.nextBeat = firstBeatAtOrAfter(beat, Math.max(0, fromSec));
    this.nextBeatSec = this.nextBeat >= 0 ? beatTimeSec(beat, this.nextBeat) : NaN;
  }

  /** Beats elapsed at `tSec`: the beats that sounded this run plus the fraction of the way to the next one. */
  private beatsElapsed(tSec: number): number {
    if (this.beatsFired === 0) return 0;
    const span = this.nextBeatSec - this.lastBeatSec;
    const frac = span > 0 && Number.isFinite(span) ? Math.max(0, Math.min(1, (tSec - this.lastBeatSec) / span)) : 0;
    return this.beatsFired - 1 + frac;
  }

  /** Applies the queued triggers in order – for each, the rules of its trigger in list order. */
  private process(nowMs: number): boolean {
    let fired = false;
    for (let e = 0; e < this.qLen; e++) {
      const list = this.byTrigger[this.qKind[e]];
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const count = ++this.counts[i];
        if (count % this.rules[i].rule.every !== 0) continue;
        this.fire(i, this.qA[e], this.qB[e], nowMs);
        fired = true;
      }
      if (this.host.multipliers().isOutgrown()) break;
    }
    this.clearQueue();
    return fired;
  }

  private fire(i: number, a: Ball | null, b: Ball | null, nowMs: number) {
    const compiled = this.rules[i];
    const rule = compiled.rule;
    const n = ++this.fires[i];
    const ctx = this.ruleCtx;
    ctx.n = n;
    ctx.t = nowMs / 1000;
    ctx.b = this.beatsElapsed(ctx.t);
    const v = this.view;
    v.fires[i] = n;
    v.totalFires++;
    v.lastFireMs = nowMs;
    v.lastRule = i;
    const kind = BOUNCE_PARAM_KIND[rule.param];
    if (kind === "world") {
      this.applyWorld(compiled);
      return;
    }
    if (kind === "count") {
      this.applyCount(compiled, a ?? this.focusBall());
      return;
    }
    if (rule.scope === "all") {
      const balls = this.host.ctx().getBalls();
      for (let k = 0; k < balls.length; k++) this.applyBall(compiled, balls[k]);
      return;
    }
    const target = a ?? this.focusBall();
    if (target) this.applyBall(compiled, target);
    if (b && b !== target) this.applyBall(compiled, b);
  }

  /** The ball that bounced last while it is in play, else the first ball that moves. */
  private focusBall(): Ball | null {
    const balls = this.host.ctx().getBalls();
    if (this.focus && balls.includes(this.focus)) return this.focus;
    for (let i = 0; i < balls.length; i++) if (!balls[i].frozen) return balls[i];
    return null;
  }

  private applyBall(compiled: CompiledRule, ball: Ball) {
    if (ball.frozen) return;
    const param = compiled.rule.param;
    const mode = this.host.mode();
    const physical = mode !== undefined && BOUNCE_MATH_BALL_MODES.includes(mode);
    switch (param) {
      case "bounciness": {
        if (!physical) return;
        const v = ball.restitution ?? 1;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next === v) return;
        ball.restitution = next;
        this.host.multipliers().markTouched(); // the step planner now bounds the ball's rebounds with it
        return;
      }
      case "speed": {
        if (!physical) return;
        const v = Math.hypot(ball.vx, ball.vy);
        if (!(v > 1e-9)) return; // a ball at rest has no direction to keep
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next !== v) this.host.multipliers().apply(ball, "speed", next / v);
        return;
      }
      case "size": {
        if (!physical) return;
        const v = ball.radius;
        let next = applyRule(v, compiled, this.ruleCtx);
        const ctx = this.host.ctx();
        // With rings the arena is the limit: the multipliers' refit bursts the rings the ball no longer fits in and ends the
        // run with OUTGREW THE ARENA once it fills the outermost one. Without rings the ball stops growing at the field's size.
        if (ctx.getCircularWalls().length === 0) next = Math.min(next, OPEN_FIELD_SIZE_SHARE * Math.min(ctx.config.width, ctx.config.height));
        if (next !== v && v > 0) this.host.multipliers().apply(ball, "size", next / v);
        return;
      }
      case "hue": {
        const v = ball.hueShift ?? 0;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next === v) return;
        ball.hueShift = next;
        ball.color = this.shiftedColor(ball, next);
        return;
      }
      case "pitch": {
        const v = ball.pitchShift ?? 0;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next !== v) ball.pitchShift = next;
        return;
      }
    }
  }

  /** The ball's colour turned `shift` degrees from its unturned colour (a colour a mode or the page set since becomes the new start). */
  private shiftedColor(ball: Ball, shift: number): string {
    const rec = this.hues.get(ball);
    const base = rec && rec.written === ball.color ? rec.base : ball.color;
    const written = rotateHue(base, shift);
    if (rec) {
      rec.base = base;
      rec.written = written;
    } else this.hues.set(ball, { base, written });
    return written;
  }

  /**
   * The factor for a mirror reflection a mode made itself, keeping the speed (Bouncing Shapes' walls): the change of the ball's bounciness since its last such rebound – so its speed carries the bounciness exactly
   * once (natural speed × bounciness, like the engine's ring rebounds) instead of compounding it hit after hit. 1 when
   * nothing changed; a ball stopped by a bounciness of 0 stays stopped (its velocity has no direction to scale).
   */
  modeReboundFactor(ball: Ball): number {
    const r = ball.restitution ?? 1;
    const carried = this.carried.get(ball) ?? 1;
    if (r === carried) return 1;
    this.carried.set(ball, r);
    return carried > 0 ? r / carried : 1;
  }

  /** A clone or a split half carries its parent's bounce-math values (restitution, hue, pitch). */
  inherit(parent: Ball, child: Ball) {
    if (parent.restitution !== undefined) child.restitution = parent.restitution;
    const carried = this.carried.get(parent);
    if (carried !== undefined) this.carried.set(child, carried);
    if (parent.pitchShift !== undefined) child.pitchShift = parent.pitchShift;
    if (parent.hueShift !== undefined) {
      child.hueShift = parent.hueShift;
      const rec = this.hues.get(parent);
      if (rec && rec.written === child.color) this.hues.set(child, { base: rec.base, written: rec.written });
    }
  }

  private setWorld(key: WorldKey, value: number, current: number) {
    if (Number.isNaN(this.base[key])) this.base[key] = current;
    this.publicCache = null;
    this.host.setWorld(key, value);
  }

  private applyWorld(compiled: CompiledRule) {
    const ctx = this.host.ctx();
    const config = ctx.config;
    const mode = this.host.mode();
    switch (compiled.rule.param) {
      case "gravity": {
        const v = config.gravity;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next !== v) this.setWorld("gravity", next, v);
        return;
      }
      case "rotation": {
        const v = config.rotationSpeed ?? 1;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next !== v) this.setWorld("rotationSpeed", next, v);
        return;
      }
      case "gap": {
        if (mode === undefined || !GAP_SIZED_MODES.includes(mode)) return;
        const v = config.gapSize || 0.3;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next !== v) this.setWorld("gapSize", next, v);
        return;
      }
      case "thickness": {
        const v = Number.isNaN(this.thickness) ? (this.config?.wallThickness ?? 2) : this.thickness;
        this.thickness = applyRule(v, compiled, this.ruleCtx);
        return;
      }
      case "wobble": {
        const v = Number.isNaN(this.wobble) ? (this.config?.wallWobble ?? 0) : this.wobble;
        this.wobble = applyRule(v, compiled, this.ruleCtx);
        return;
      }
      case "damping": {
        const v = this.airDrag(this.host.airDrag());
        this.drag = applyRule(v, compiled, this.ruleCtx);
        return;
      }
      case "trail": {
        const v = this.trail;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next === v) return;
        this.trail = next;
        const balls = ctx.getBalls();
        for (let i = 0; i < balls.length; i++) if (balls[i].trail.length > next) resizeTrail(balls[i], next);
        return;
      }
      case "timeScale": {
        if (mode === undefined || !BOUNCE_MATH_CLOCK_MODES.includes(mode)) return;
        const v = this.timeScale;
        const next = applyRule(v, compiled, this.ruleCtx);
        if (next === v) return;
        this.timeScale = next;
        this.host.multipliers().markTouched(); // the step planner sub-steps the scaled step
        return;
      }
    }
  }

  private applyCount(compiled: CompiledRule, ball: Ball | null) {
    const mode = this.host.mode();
    if (mode === undefined || !BOUNCE_MATH_SPAWN_MODES.includes(mode)) return;
    const ctx = this.host.ctx();
    const balls = ctx.getBalls();
    const v = balls.length;
    const next = applyRule(v, compiled, this.ruleCtx);
    const copies = next - v;
    // --- unlimited --- with No limits on Multiply's ceiling is lifted here too: the copies fill the run's full-physics balls
    // and the rest join the crowd (ARENA FULL once it is full), like Multiply's clone storms; null while the switch is off
    const room = ctx.unlimitedRoom?.() ?? null;
    if (!(copies >= 1) || (room === null && v >= MULTIPLY_MAX_BALLS)) return;
    const source = ball && !ball.frozen && balls.includes(ball) ? ball : this.focusBall();
    if (!source) return;
    // Multiply's swarm ceiling: never more than MULTIPLY_MAX_BALLS balls, however big the count gets (a soft, memory-safe limit).
    if (room === null) this.host.multipliers().cloneBall(ctx, source, Math.min(copies, MULTIPLY_MAX_BALLS) + 1, MULTIPLY_MAX_BALLS);
    else this.host.multipliers().cloneBall(ctx, source, Math.min(copies, CROWD_LIMIT) + 1, v + room); // --- unlimited ---
  }

  /* ---------------------------------------------------------------- the readout */

  private summarize() {
    const v = this.view;
    const ctx = this.host.ctx();
    // Float safety: a runaway bounciness compounds on obstacle reflections; a ball is never faster than SPEED_CEILING (and a
    // non-finite velocity – which would turn its position into NaN – stops it).
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.restitution === undefined && !b.mult) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed <= SPEED_CEILING) continue;
      if (Number.isFinite(speed)) {
        const k = SPEED_CEILING / speed;
        b.vx *= k;
        b.vy *= k;
      } else {
        b.vx = 0;
        b.vy = 0;
      }
    }
    const ball = this.focusBall();
    v.hasBall = !!ball;
    if (ball) {
      v.bounciness = ball.restitution ?? 1;
      v.color = ball.color;
      v.speed = Math.hypot(ball.vx, ball.vy);
      v.size = ball.radius;
    }
    v.gravity = ctx.config.gravity;
    v.balls = ctx.getBalls().length;
    v.timeScale = this.timeScale;
    v.thickness = this.thickness;
    v.wobble = this.wobble;
    v.damping = this.airDrag(this.host.airDrag());
    v.trail = this.trail;
  }

  getView(): BounceMathView {
    return this.view;
  }

  /** The rule list the engine plays (compiled; invalid rules are not in it). */
  ruleCount(): number {
    return this.rules.length;
  }

  /** How often rule `index` has fired this run. */
  firesOf(index: number): number {
    return this.fires[index] ?? 0;
  }
}
