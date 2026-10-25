/*
 * --- blueprint --- One run of a Blueprint inside the engine: the interpreter the blueprint mode (Mode Lab,
 * lib/physics/modes/blueprint.ts) steps through its GameMode hooks. Each fixed 60 Hz step:
 *
 *  1. `preStep()` (onPreUpdate): the clock – `start` (the first step), `beat` / `bar` (sound.bpm), each `timer` rule –, the
 *     spawners (their balls are queued), and the rim, the rings and the spinners turn;
 *  2. the engine moves every ball; `ballStep()` (onBallStep) and `subStep()` (onPostSubStep) let the world resolve the
 *     contacts (runtime/world.ts). Those callbacks only RECORD: each event is counted at once (escapes, the first ball out,
 *     its voice) and queued for the rules up to BLUEPRINT_EVENTS_PER_STEP (the rest are dropped and counted);
 *  3. `postStep()` (onPostUpdate) runs the rules, the one place they run (runtime/rules.ts), up to
 *     BLUEPRINT_RULE_FIRINGS_PER_STEP firings; an event an action causes waits for the NEXT step's queue, so a chain of rules
 *     can never recurse inside a step. Then removals are swept, queued balls join the engine (BLUEPRINT_SPAWNS_PER_STEP a
 *     step, never past BLUEPRINT_BALL_CEILING: ARENA FULL, counted), the finish is checked (runtime/finish.ts), and the
 *     step's sounds and effects go to the engine.
 *
 * Fault containment: the rule dispatch is wrapped – should it ever throw, the rules stop and the run ends 1 s later with
 * reason "fault". --- review fix (blueprint) --- So is every other hook: should the physics callbacks (a ball's contacts,
 * the pair pass) or the step's own bookkeeping ever throw, the fault is counted (`crashes`, and `faults`), the ball or the
 * pair pass it came from stops, and the run ends the same way; nothing is ever thrown out of the engine. Randomness: only the run's own seeded generator (the mode seeds
 * it from ctx.random() once, so the engine's other draws – the cinematic director's – never shift it), drawn only where the
 * spec asks for it. No clock: a seed replays exactly. A finished run keeps its world turning (the balls still bounce under
 * the end banner) but records, plays and fires nothing more.
 */
import { BLUEPRINT_LIMITS as L, BLUEPRINT_STEP_BUDGETS as BUDGET, BLUEPRINT_BALL_CEILING, BLUEPRINT_RADIUS_CEILING, BLUEPRINT_SPEED_CEILING } from "../limits";
import { evaluateBlueprintFormula, SLOT } from "../formula";
import type { Blueprint, FxKind, Trigger, Voice, VoiceTrigger } from "../schema";
import { compileBlueprint, type CompiledBlueprint, type CompiledNum } from "./compile";
import { EventQueue, type WorldEvents } from "./events";
import { checkFinish, endWithFault } from "./finish";
import { countRules, dispatch } from "./rules";
import { placeBalls } from "./actions";
import { BlueprintWorld, MIN_HIT_SPEED, type NewWorldBall, type WorldBall } from "./world";
import type { Ball, ModeContext } from "@/lib/physics/types";

export type FinishReason = "condition" | "timeout" | "fault";

/** What a run counts: every number is deterministic (no clock). */
export interface RunStats {
  steps: number;
  peakBalls: number;
  /** Balls refused at the ball ceiling (ARENA FULL). */
  arenaFull: number;
  /** World events past the per-step budget. */
  droppedEvents: number;
  /** Rule firings past the per-step budget. */
  droppedFirings: number;
  /** Actions that had nothing to act on or a meaningless result (a formula giving NaN, a merge without another ball…). */
  refusedActions: number;
  faults: number;
  /**
   * --- review fix (blueprint) --- Faults outside the rules (counted in `faults` too): a physics callback or the step's
   * bookkeeping threw. The sandbox contains them; the check says the game stopped on an error.
   */
  crashes: number;
  /** Balls that went non-finite and were taken out. */
  nanBalls: number;
  /** --- review fix (blueprint) --- Balls past the speed ceiling (BLUEPRINT_SPEED_CEILING) that were taken out. */
  fastBalls: number;
  /** --- review fix (blueprint) --- Sub-steps whose ball-pair tests ran past their share of the step's (the rest skipped). */
  droppedPairs: number;
  /** --- review fix (blueprint) --- Ball sub-steps that skipped their tile sweep, past the step's tile budget (BLUEPRINT_TILE_TESTS_PER_STEP). */
  droppedTiles: number;
  /** --- review fix (blueprint) --- The run's tile work: tiles looked at and tested, tile-grid cells visited (TileField.stats). */
  tileTests: number;
  /** --- review fix (blueprint) --- The run's tile sweeps (TileField.stats.queries: up to four a ball's sub-step among tiles). */
  tileSweeps: number;
  /** --- review fix (blueprint) --- Actions dropped because the step's actions had already changed BLUEPRINT_ACTION_BALLS_PER_STEP balls. */
  droppedActions: number;
  /** --- review fix (blueprint) --- Ball sub-steps of the run (each ball's move and contacts in one sub-step: a work count). */
  ballSteps: number;
  /** --- review fix (blueprint) --- Balls the rules' actions changed. */
  actionBalls: number;
  /**
   * --- review fix (blueprint) --- The run's work so far, in units a tab pays for (deterministic, about 30 ns each in Node):
   * ball sub-steps, events, rule firings, the balls their actions changed, contact tests and pair-grid items walked, the
   * pairs found overlapping, and the tile work and sweeps, each weighted by what it costs (STEP_COST). The check judges a
   * step by it.
   */
  cost: number;
  sounds: number;
  /** Sounds past the per-step budget (silent, not an error). */
  soundsCapped: number;
  /** Seconds until a ball first moves (null: never). */
  firstMotionSec: number | null;
  /** Seconds until the first payoff: a tile broken, an escape, a ring passed, a merge or a split (null: none). */
  payoffSec: number | null;
  events: number;
  firings: number;
  spawned: number;
  escaped: number;
  tilesBroken: number;
  effects: number;
  /** The world's contact tests and pair checks. */
  contacts: number;
}

export interface RunResult {
  finished: boolean;
  reason: FinishReason | null;
  /** The finish condition met (its index in finish.any), or −1. */
  condition: number;
  timeSec: number;
  /** The winning team (−1: none). */
  winner: number;
  /** The end banner's line ("RED WINS", "CLEARED", "TIME UP"…). */
  result: string;
}

export interface RunOptions {
  /** The run's random numbers in [0, 1): a seeded generator (the mode's is Mulberry32 of a seed drawn from ctx.random()). */
  random: () => number;
  /** Conformance tests only: firing rule i throws, to prove fault containment. */
  faultOnRule?: number;
}

/** Mulberry32: the engine's seeded generator. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sound of the step: a voice and a scale degree. */
export interface StepSound {
  voice: Voice;
  pitch: number;
}

/** A visual effect of the step, where it happened: the spec's fx kinds and the interpreter's own (a merge, a split, a pop). */
export type EffectKind = FxKind | "merge" | "split" | "pop";
export interface StepEffect {
  kind: EffectKind;
  x: number;
  y: number;
  color: number;
  r: number;
}

/**
 * --- review fix (blueprint) --- What each kind of work costs a step, in RunStats.cost units (about 30 ns in Node; measured on
 * the catalog and the review's hostile specs): a ball's sub-step (its move, tiles, obstacles, arena) and an event dominate,
 * a pair test or a grid item walked is cheap, and a pair found overlapping – resolved and looked up in the step's reported
 * pairs – costs about a ball's sub-step's tenth (400 balls the size of the arena that pass through each other overlap in
 * every pair test: 60,000 a step, the most of any spec measured). --- review fix (blueprint) --- Tile work weighs a unit an
 * item (a tile looked at or tested, a tile-grid cell visited: 20-35 ns measured, sectors the dearest) and a sweep five (its
 * set-up and its rebound): 60 balls the size of the arena over 600 tiles did 630,000 items a step, 14 ms.
 */
export const STEP_COST = { ballStep: 10, event: 20, firing: 20, actionBall: 5, pairTest: 0.1, overlap: 1.2, tileTest: 1, tileSweep: 5 } as const;

/** A count from a slot's value: whole, from 0 to `max`; −1 for a value that means nothing. */
function wholeCount(v: number, max: number): number {
  if (!Number.isFinite(v)) return -1;
  const k = Math.round(v);
  return k < 0 ? 0 : k > max ? max : k;
}

/** countWas before a countReached rule's first look at its count (the first look is its baseline: it never fires on it). */
export const COUNT_UNSEEN = 2;

/** The up-and-down walk of scale degrees the wall hits play by default, one step a hit (a run of bounces is a tune, not one note). */
const WALL_WALK = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1] as const;

export class BlueprintRun implements WorldEvents {
  readonly bp: Blueprint;
  readonly ctx: ModeContext;
  readonly world: BlueprintWorld;
  readonly compiled: CompiledBlueprint;
  readonly vars: Float64Array;
  readonly random: () => number;
  readonly faultOnRule: number;
  readonly stats: RunStats = {
    steps: 0,
    peakBalls: 0,
    arenaFull: 0,
    droppedEvents: 0,
    droppedFirings: 0,
    refusedActions: 0,
    faults: 0,
    crashes: 0,
    nanBalls: 0,
    fastBalls: 0,
    droppedPairs: 0,
    droppedTiles: 0,
    tileTests: 0,
    tileSweeps: 0,
    droppedActions: 0,
    ballSteps: 0,
    actionBalls: 0,
    cost: 0,
    sounds: 0,
    soundsCapped: 0,
    firstMotionSec: null,
    payoffSec: null,
    events: 0,
    firings: 0,
    spawned: 0,
    escaped: 0,
    tilesBroken: 0,
    effects: 0,
    contacts: 0,
  };
  timeSec = 0;
  beats = 0;
  /** This step's sounds, in order (turned into the engine's SoundEvents at the end of the step; the check counts them). */
  readonly stepSounds: StepSound[] = [];
  /** This step's visual effects, where they happened (world px). */
  readonly stepEffects: StepEffect[] = [];
  /* (the interpreter's modules – rules.ts, actions.ts, finish.ts – read and write the fields below) */
  queue = new EventQueue(BUDGET.events);
  pending = new EventQueue(BUDGET.events);
  firingsThisStep = 0;
  /** --- review fix (blueprint) --- Balls this step's actions changed (BLUEPRINT_ACTION_BALLS_PER_STEP). */
  actionBallsThisStep = 0;
  readonly ruleMatches: Float64Array;
  readonly ruleFires: Float64Array;
  readonly ruleLast: Float64Array;
  readonly ruleTimerFired: Float64Array;
  readonly countWas: Uint8Array;
  readonly finishArmed: Uint8Array;
  firstOutTeam = -1;
  lastOutTeam = -1;
  rulesOff = false;
  /** --- review fix (blueprint) --- The pair pass threw once: it stays off for the run (the balls pass through each other). */
  pairsOff = false;
  faultAt = -1;
  faultStep = -1;
  teamsSeen = 0;
  done: RunResult = { finished: false, reason: null, condition: -1, timeSec: 0, winner: -1, result: "" };
  /** When the arena last refused a ball (s; −Infinity: never) – the ARENA FULL badge. */
  arenaFullAtSec = -Infinity;
  /** When the last flash and shake effects fired (s). */
  flashAtSec = -Infinity;
  private readonly slots: Float64Array;
  private readonly spawnQueue: NewWorldBall[] = [];
  private soundsThisStep = 0;
  private wallHits = 0;
  private readonly spawnerFired: number[];
  /** --- review fix (blueprint) --- How many times each spawner fired (its formulas' n), apart from the period it is in. */
  private readonly spawnerFirings: number[];
  private readonly spawnerMade: number[];
  private readonly escapedByBody: number[];
  private readonly finishSounds: Voice[] = [];

  constructor(bp: Blueprint, ctx: ModeContext, options: RunOptions) {
    this.bp = bp;
    this.ctx = ctx;
    this.world = new BlueprintWorld(bp, ctx.config.width, ctx.config.height);
    this.compiled = compileBlueprint(bp);
    this.random = options.random;
    this.faultOnRule = options.faultOnRule ?? -1;
    this.vars = Float64Array.from(bp.vars.map((v) => v.start));
    this.slots = new Float64Array(SLOT.firstVar + bp.vars.length);
    const n = bp.rules.length;
    this.ruleMatches = new Float64Array(n);
    this.ruleFires = new Float64Array(n);
    this.ruleLast = new Float64Array(n).fill(-Infinity);
    this.ruleTimerFired = new Float64Array(n);
    this.countWas = new Uint8Array(n).fill(COUNT_UNSEEN);
    this.finishArmed = new Uint8Array(bp.finish.any.length);
    this.spawnerFired = new Array(bp.spawners.length).fill(0);
    this.spawnerFirings = new Array(bp.spawners.length).fill(0);
    this.spawnerMade = new Array(bp.spawners.length).fill(0);
    this.escapedByBody = new Array(bp.bodies.length).fill(0);
    // the first balls: every spawner due at 0 s places its balls at once (so the engine adds no default ball of its own)
    try {
      this.runSpawners(true);
      this.drainSpawns(Infinity);
      this.noteBalls();
    } catch {
      this.crash(); // --- review fix (blueprint) --- (never thrown out of the engine's initMode)
    }
  }

  get finished(): boolean {
    return this.done.finished;
  }

  result(): RunResult {
    return { ...this.done };
  }

  /* ------------------------------------------------------------------ the engine's hooks */

  /** onPreUpdate: the clock, the spawners, the turning parts (under fault containment). */
  preStep(dtMs: number): void {
    try {
      this.beginStep(dtMs);
    } catch {
      this.crash();
    }
  }

  private beginStep(dtMs: number): void {
    const dt = dtMs / 1000;
    this.timeSec += dt;
    this.world.advance(dt);
    this.world.wallBounciness = this.ctx.getPhysicsExtras().wallBounciness;
    this.world.tiles.clockMs = this.timeSec * 1000;
    if (this.done.finished) {
      this.world.beginStep(this.stats.steps, this.timeSec, dt);
      return;
    }
    this.stats.steps++;
    this.world.beginStep(this.stats.steps, this.timeSec, dt);
    this.firingsThisStep = 0;
    this.actionBallsThisStep = 0;
    this.soundsThisStep = 0;
    this.stepSounds.length = 0;
    this.stepEffects.length = 0;
    // the events actions caused last step come first
    const next = this.pending;
    this.pending = this.queue;
    this.queue = next;
    this.pending.clear();
    this.stats.events += this.queue.length;
    if (this.stats.steps === 1) {
      this.world.sweep(this.ctx); // (the engine's own first ball, added when no spawner starts at 0 s)
      this.push("start", null, null, -1, -1);
    }
    this.clockEvents();
    this.runSpawners(false);
  }

  /**
   * onBallStep: one engine ball's contacts in this sub-step (a ball the world does not know – a ghost – is left alone). ---
   * review fix (blueprint) --- Should they ever throw, the ball is taken out and the fault counted (crash()).
   */
  ballStep(ball: Ball, dtSec: number): void {
    const wb = this.world.byId.get(ball.id);
    if (!wb) return;
    this.stats.ballSteps++;
    try {
      this.world.ballStep(wb, dtSec, this);
    } catch {
      wb.alive = false;
      this.crash();
    }
  }

  /** onPostSubStep: the balls against each other (--- review fix (blueprint) --- a pass that throws is stopped for the run, counted). */
  subStep(): void {
    this.world.endSubStep();
    if (this.pairsOff) return;
    try {
      this.world.collidePairs(this);
    } catch {
      this.pairsOff = true;
      this.crash();
    }
  }

  /**
   * --- review fix (blueprint) --- A fault outside the rules: counted (crashes, faults), the rules stop, and the run ends 1 s
   * later with reason "fault" – at once when it is the step's bookkeeping that threw, as the step that would end it may
   * never come.
   */
  private crash(bookkeeping = false): void {
    this.stats.crashes++;
    this.stats.faults++;
    this.rulesOff = true;
    if (this.faultAt < 0) {
      this.faultAt = this.timeSec;
      this.faultStep = this.stats.steps;
    }
    if (!bookkeeping || this.done.finished) return;
    try {
      endWithFault(this);
    } catch {
      this.done = { finished: true, reason: "fault", condition: -1, timeSec: this.timeSec, winner: -1, result: "STOPPED" };
    }
  }

  /** onPostUpdate: the rules, the sweep, the new balls, the finish, the sounds (under fault containment). */
  postStep(): void {
    try {
      this.endStep();
    } catch {
      this.crash(true);
    }
  }

  private endStep(): void {
    if (this.done.finished) {
      this.world.cull();
      this.world.sweep(this.ctx);
      return;
    }
    if (!this.rulesOff) {
      try {
        dispatch(this);
        countRules(this);
      } catch {
        this.stats.faults++;
        this.rulesOff = true;
        this.faultAt = this.timeSec;
        this.faultStep = this.stats.steps;
      }
    }
    this.queue.clear();
    this.world.cull(); // --- review fix (blueprint) --- (an action's ball gone non-finite or too fast never reaches the canvas)
    this.world.sweep(this.ctx);
    this.drainSpawns(BUDGET.spawns);
    this.noteBalls();
    this.stats.nanBalls = this.world.nanBalls;
    this.stats.fastBalls = this.world.fastBalls;
    this.stats.droppedPairs = this.world.droppedPairs;
    this.stats.droppedTiles = this.world.droppedTiles;
    this.stats.tileTests = this.world.tileTests();
    this.stats.tileSweeps = this.world.tiles.stats.queries;
    this.stats.contacts = this.world.work;
    const st = this.stats;
    st.cost =
      STEP_COST.ballStep * st.ballSteps +
      STEP_COST.event * st.events +
      STEP_COST.firing * st.firings +
      STEP_COST.actionBall * st.actionBalls +
      STEP_COST.pairTest * (this.world.work + this.world.pairVisits) +
      STEP_COST.overlap * this.world.overlaps +
      STEP_COST.tileTest * st.tileTests +
      STEP_COST.tileSweep * st.tileSweeps;
    checkFinish(this);
    this.flush();
  }

  /** Called by finish.ts when the run ends: the payoff chord (or a minor one on a timeout). */
  onFinish(): void {
    this.finishSounds.length = 0;
    this.finishSounds.push(this.done.reason === "condition" ? "merge" : "hit");
  }

  /**
   * The fastest speed of a ball in play (px/s), or 0 when the engine's own sub-steps are enough (stepSpeedBound). --- review
   * fix (blueprint) --- Every ball is planned for: the engine's sub-steps up to the mode's ceiling (BLUEPRINT_SUBSTEP_CEILING),
   * slow motion beyond; a ball past the speed ceiling is not – the step's cull() takes it out.
   */
  fastestBall(stepSec: number): number {
    let vmax = 0;
    let rmin = Infinity;
    for (const b of this.world.balls) {
      if (!b.alive) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (!(v <= BLUEPRINT_SPEED_CEILING)) continue;
      if (v > vmax) vmax = v;
      if (b.r < rmin) rmin = b.r;
    }
    if (vmax === 0) return 0;
    const move = Math.max(0.25, Math.min(rmin / 2, 4));
    return (1.25 * vmax * stepSec) / move > 4 ? vmax : 0;
  }

  /* ------------------------------------------------------------------ the clock and the spawners */

  /**
   * Queues an event for the rules. --- review fix (blueprint) --- An event no rule listens to is not queued: it never uses
   * the step's event budget (a crowd's contacts would crowd out the tile a rule waits for). Its count, sound and payoff
   * are the caller's, already done.
   */
  private push(trigger: Trigger, self: WorldBall | null, other: WorldBall | null, tile: number, rule: number) {
    if (rule < 0 && this.compiled.byTrigger[trigger].length === 0) return;
    if (!this.queue.push(trigger, self, other, tile, rule)) {
      this.stats.droppedEvents++;
      return;
    }
    this.stats.events++;
  }

  private clockEvents() {
    const t = this.timeSec;
    const bpm = this.bp.sound.bpm;
    const beatSec = 60 / bpm;
    const beats = Number.isFinite(beatSec) && beatSec > 0 ? Math.floor(t / beatSec + 1e-9) : 0;
    if (beats > this.beats) {
      const barNow = Math.floor(beats / 4) > Math.floor(this.beats / 4);
      this.beats = beats;
      this.push("beat", null, null, -1, -1);
      if (barNow) this.push("bar", null, null, -1, -1);
    }
    for (const i of this.compiled.byTrigger.timer) {
      const sec = this.compiled.rules[i].spec.sec;
      const due = Math.floor(t / sec + 1e-9);
      if (due > this.ruleTimerFired[i]) {
        this.ruleTimerFired[i] = due;
        this.push("timer", null, null, -1, i);
      }
    }
  }

  /** Spawners due now queue their balls (one firing a step at most, whatever their period). */
  private runSpawners(initial: boolean) {
    const t = this.timeSec;
    this.compiled.spawners.forEach((s, i) => {
      const spec = s.spec;
      if (this.spawnerMade[i] >= spec.maxTotal) return;
      let due: number;
      if (spec.onBeat) {
        if (initial || t < spec.startSec) return;
        due = this.beats;
        if (due <= this.spawnerFired[i]) return;
      } else {
        if (t + 1e-9 < spec.startSec) return;
        if (initial && spec.startSec > 0) return;
        due = spec.everySec > 0 ? Math.floor((t - spec.startSec) / spec.everySec + 1e-9) + 1 : 1;
        if (due <= this.spawnerFired[i]) return;
      }
      this.spawnerFired[i] = due;
      // --- review fix (blueprint) --- n is how many times the spawner fired (1 the first time), not the period it is in
      const n = ++this.spawnerFirings[i];
      const want = this.countOf(s.count, n, null, L.perSpawn);
      // a count or a speed that means nothing (a formula giving NaN) refuses the firing: counted, never applied
      if (want < 0) {
        this.stats.refusedActions++;
        return;
      }
      const count = Math.min(spec.maxTotal - this.spawnerMade[i], want);
      if (count <= 0) return;
      const speed = this.valueOf(s.speed, n, null);
      if (!Number.isFinite(speed)) {
        this.stats.refusedActions++;
        return;
      }
      this.spawnerMade[i] += count;
      placeBalls(this, s.body, count, spec.at, null, -1, speed, spec.dir);
    });
  }

  /**
   * Queues a new ball (it joins at the end of the step); a queue as long as the ball ceiling refuses it (ARENA FULL). ---
   * review fix (blueprint) --- A ball that would be meaningless – a position, a velocity or a radius that is not a finite
   * number, a radius of 0 or less, a speed past the ceiling – is refused and counted, never queued; a radius past the radius
   * ceiling stops at it. True when it was queued.
   */
  queueBall(ball: NewWorldBall): boolean {
    if (!(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.vx) && Number.isFinite(ball.vy) && ball.r > 0 && Number.isFinite(ball.r)) || ball.vx * ball.vx + ball.vy * ball.vy > BLUEPRINT_SPEED_CEILING * BLUEPRINT_SPEED_CEILING) {
      this.stats.refusedActions++;
      return false;
    }
    if (ball.r > BLUEPRINT_RADIUS_CEILING) ball.r = BLUEPRINT_RADIUS_CEILING;
    if (this.spawnQueue.length >= BLUEPRINT_BALL_CEILING) {
      this.noteArenaFull();
      return false;
    }
    this.spawnQueue.push(ball);
    return true;
  }

  /** --- review fix (blueprint) --- How many more balls the arena takes: the ball ceiling less the balls in play and those queued. */
  ballRoom(): number {
    return BLUEPRINT_BALL_CEILING - this.world.aliveCount() - this.spawnQueue.length;
  }

  /**
   * --- review fix (blueprint) --- Takes `balls` from the step's action budget (BLUEPRINT_ACTION_BALLS_PER_STEP): false – and
   * the action dropped and counted – when the step's actions have already changed that many balls.
   */
  spendActionBalls(balls: number): boolean {
    if (this.actionBallsThisStep + balls > BUDGET.actionBalls) {
      this.stats.droppedActions++;
      this.actionBallsThisStep = BUDGET.actionBalls; // (the budget is spent: the step's further actions on balls are dropped at once)
      return false;
    }
    this.actionBallsThisStep += balls;
    this.stats.actionBalls += balls;
    return true;
  }

  /** Whether this step's actions have changed as many balls as they may. */
  actionBudgetSpent(): boolean {
    return this.actionBallsThisStep >= BUDGET.actionBalls;
  }

  noteArenaFull() {
    this.stats.arenaFull++;
    this.arenaFullAtSec = this.timeSec;
    this.ctx.noteArenaFull?.();
  }

  /** Queued balls join the world in order: at most `budget` this step, never past the ball ceiling. */
  private drainSpawns(budget: number) {
    if (!this.spawnQueue.length) return;
    let alive = this.world.aliveCount();
    let added = 0;
    let taken = 0;
    while (taken < this.spawnQueue.length && added < budget) {
      const next = this.spawnQueue[taken++];
      if (alive >= BLUEPRINT_BALL_CEILING) {
        this.noteArenaFull();
        continue;
      }
      this.world.addBall(this.ctx, next);
      alive++;
      added++;
      this.stats.spawned++;
    }
    this.spawnQueue.splice(0, taken);
  }

  private noteBalls() {
    let alive = 0;
    let moving = false;
    for (const b of this.world.balls) {
      if (!b.alive) continue;
      alive++;
      if (!moving && b.vx * b.vx + b.vy * b.vy > 1) moving = true;
    }
    const teams = this.teamsLeft();
    if (alive > this.stats.peakBalls) this.stats.peakBalls = alive;
    if (teams > this.teamsSeen) this.teamsSeen = teams;
    if (moving && this.stats.firstMotionSec === null) this.stats.firstMotionSec = this.timeSec;
  }

  payoff() {
    if (this.stats.payoffSec === null) this.stats.payoffSec = this.timeSec;
  }

  /* ------------------------------------------------------------------ the world's events (recorded only) */

  wallHit(ball: WorldBall, impact: number): void {
    if (this.done.finished) return;
    this.ctx.noteBounce?.(ball.ball); // --- bounce-math --- a rebound off the rim, a box wall or a ring is a bounce
    this.voice("wallHit", WALL_WALK[this.wallHits++ % WALL_WALK.length] + ball.tier - 1, impact);
    this.push("wallHit", ball, null, -1, -1);
  }

  obstacleHit(ball: WorldBall, _obstacle: number, impact: number): void {
    if (this.done.finished) return;
    this.ctx.noteBounce?.(ball.ball); // --- bounce-math --- (the engine notes its own obstacles' hits the same way)
    // higher on the board, higher the note: a ball falling through pegs plays a descending run
    const w = this.world;
    const height = Math.round(((w.cy + w.R - ball.y) / Math.max(1, 2 * w.R)) * 9);
    this.voice("obstacleHit", height < 0 ? 0 : height, impact);
    this.push("obstacleHit", ball, null, -1, -1);
  }

  tileHit(ball: WorldBall, tile: number, broke: boolean, impact: number): void {
    if (this.done.finished) return;
    const by = this.bp.tiles?.pitchBy ?? "none";
    const f = this.world.tiles;
    const pitch = by === "row" ? f.row[tile] : by === "col" ? f.col[tile] : 0;
    this.ctx.noteBounce?.(ball.ball);
    if (broke) {
      this.stats.tilesBroken++;
      this.payoff();
      this.ctx.creditWallBreak?.(ball.ball); // --- bounce-math --- a tile broken is a break
      this.voice("tileBroken", pitch);
    } else this.voice("tileHit", pitch, impact);
    this.push("tileHit", ball, null, tile, -1);
    if (broke) this.push("tileBroken", ball, null, tile, -1);
  }

  /**
   * A contact that starts: `a` is self, the ball that was faster before it (the world measured both before the bounce –
   * --- review fix (blueprint) --- after it, a head-on hit of equal balls has swapped their speeds).
   */
  ballHit(a: WorldBall, b: WorldBall, impact: number): void {
    if (this.done.finished) return;
    if (impact >= MIN_HIT_SPEED) {
      this.ctx.noteCollide?.(a.ball, b.ball); // --- bounce-math --- a ball-to-ball hit
      this.voice("ballHit", Math.max(a.tier, b.tier) - 1, impact);
    }
    this.push("ballHit", a, b, -1, -1);
  }

  ringPass(ball: WorldBall, ring: number): void {
    if (this.done.finished) return;
    this.payoff();
    this.ctx.notePass?.(ball.ball, ring); // --- bounce-math --- a gap passed
    if (!this.world.ringAlive[ring]) this.ctx.creditWallBreak?.(ball.ball); // --- bounce-math --- and a ring broken
    this.voice("ringPass", ring);
    if (!this.world.ringAlive[ring]) this.effect("burst", ball.x, ball.y, ball.color, this.world.ringR[ring] * 0.1);
    this.push("ringPass", ball, null, -1, -1);
  }

  escape(ball: WorldBall): void {
    if (this.done.finished) return;
    this.stats.escaped++;
    this.escapedByBody[ball.body]++;
    if (this.firstOutTeam < 0) this.firstOutTeam = ball.team;
    this.lastOutTeam = ball.team;
    this.payoff();
    this.ctx.notePass?.(ball.ball, this.world.ringR.length); // --- bounce-math --- out through an exit or past the last ring
    this.ctx.creditEscape?.(ball.ball);
    this.voice("escape", this.stats.escaped - 1);
    this.push("escape", ball, null, -1, -1);
  }

  /** A sound: a world event's voice (when the spec gives it one and the hit is a hit) or an action's. */
  voice(trigger: VoiceTrigger, pitch: number, impact = Infinity) {
    const v = this.bp.sound.voices[trigger];
    if (v === "none" || impact < MIN_HIT_SPEED) return;
    this.sound(v, pitch);
  }

  sound(voice: Voice, pitch: number) {
    if (this.soundsThisStep >= BUDGET.sounds) {
      this.stats.soundsCapped++;
      return;
    }
    this.soundsThisStep++;
    this.stats.sounds++;
    this.stepSounds.push({ voice, pitch });
  }

  /** A visual effect (recorded for the renderer, and the engine's particles and camera moments where it has them). */
  effect(kind: EffectKind, x: number, y: number, color: number, r: number) {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r))) return; // --- review fix (blueprint) --- (never a burst the canvas cannot draw)
    if (this.stepEffects.length < 32) this.stepEffects.push({ kind, x, y, color, r });
    if (kind === "flash") this.flashAtSec = this.timeSec;
  }

  /** The step's sounds and effects go to the engine. */
  private flush() {
    const ctx = this.ctx;
    const palette = this.bp.look.palette;
    for (const e of this.stepEffects) {
      const color = palette[e.color] ?? palette[0];
      switch (e.kind) {
        case "burst":
        case "merge":
        case "split":
        case "pop":
          ctx.spawnMergeBurst?.(e.x, e.y, color, Math.max(6, e.r));
          break;
        case "confetti":
          ctx.spawnConfetti(e.x, e.y);
          break;
        case "shake":
          ctx.noteImpact?.();
          break;
        case "slowmo":
          ctx.noteNearMiss?.();
          break;
        default:
          break;
      }
    }
    for (const s of this.stepSounds) ctx.addPendingSoundEvent(blueprintSoundEvent(this.bp, s.voice, s.pitch));
    if (this.done.finished && this.finishSounds.length) {
      ctx.addPendingSoundEvent(blueprintFinishSound(this.bp, this.done.reason === "condition"));
      this.finishSounds.length = 0;
    }
  }

  /* ------------------------------------------------------------------ numbers and counts */

  /** A number slot's value: the constant, or the formula over the run's slots (self: the ball it is about). */
  valueOf(num: CompiledNum | undefined, n: number, self: WorldBall | null): number {
    if (num === undefined) return NaN;
    if (typeof num === "number") return num;
    this.prepareSlots(num, n);
    return this.slotValue(num, self);
  }

  /**
   * --- review fix (blueprint) --- The slots a formula reads that are the same for every ball of an action – n, the clock,
   * the counts and the variables –, filled once per action (an action on every ball no longer counts the balls once a ball).
   * A constant needs none.
   */
  prepareSlots(num: CompiledNum | undefined, n: number) {
    if (num === undefined || typeof num === "number") return;
    const s = this.slots;
    s[SLOT.n] = n;
    s[SLOT.t] = this.timeSec;
    s[SLOT.b] = this.beats;
    s[SLOT.balls] = this.world.aliveCount();
    s[SLOT.tiles] = this.world.tilesAlive;
    s[SLOT.escaped] = this.stats.escaped;
    for (let i = 0; i < this.vars.length; i++) s[SLOT.firstVar + i] = this.vars[i];
  }

  /** A number slot's value for one ball, after prepareSlots(): the ball's own slots (tier, size, speed) and a fresh r. */
  slotValue(num: CompiledNum | undefined, self: WorldBall | null): number {
    if (num === undefined) return NaN;
    if (typeof num === "number") return num;
    const s = this.slots;
    s[SLOT.r] = num.usesR ? this.random() : 0;
    s[SLOT.tier] = self ? self.tier : 0;
    s[SLOT.size] = self ? self.r : 0;
    s[SLOT.speed] = self ? Math.hypot(self.vx, self.vy) : 0;
    return evaluateBlueprintFormula(num, s);
  }

  /** A count slot: whole, from 0 to `max`; −1 when the result means nothing (NaN, ±Infinity) – the caller refuses it. */
  countOf(num: CompiledNum | undefined, n: number, self: WorldBall | null, max: number): number {
    return wholeCount(this.valueOf(num, n, self), max);
  }

  /** A count slot for one ball after prepareSlots() (an action on several balls). */
  countOfSlot(num: CompiledNum | undefined, self: WorldBall | null, max: number): number {
    return wholeCount(this.slotValue(num, self), max);
  }

  /** A count the spec names (`what`), of a body (−1: every ball). */
  count(what: string, of = -1): number {
    switch (what) {
      case "balls": {
        let k = 0;
        for (const b of this.world.balls) if (b.alive && (of < 0 || b.body === of)) k++;
        return k;
      }
      case "tiles":
        return this.world.tilesAlive;
      case "rings":
        return this.world.ringsAlive();
      case "escaped":
        return of < 0 ? this.stats.escaped : (this.escapedByBody[of] ?? 0);
      case "teams":
        return this.teamsLeft();
      case "tier": {
        let t = 0;
        for (const b of this.world.balls) if (b.alive && b.tier > t) t = b.tier;
        return t;
      }
      case "time":
        return this.timeSec;
      // --- review fix (blueprint) --- balls that still fit through an exit (between its two edges)
      case "fit": {
        const fit = this.world.exitFitRadius();
        let k = 0;
        for (const b of this.world.balls) if (b.alive && (of < 0 || b.body === of) && b.r <= fit) k++;
        return k;
      }
      default: {
        const v = this.compiled.varIndex.get(what);
        return v === undefined ? 0 : this.vars[v];
      }
    }
  }

  /** Teams with a ball in the arena (no allocation: teams are 0-5). */
  teamsLeft(): number {
    let mask = 0;
    for (const b of this.world.balls) if (b.alive) mask |= 1 << (b.team & 31);
    let n = 0;
    for (; mask; mask &= mask - 1) n++;
    return n;
  }

  /** Balls per team, in team order. */
  teamCounts(): Map<number, number> {
    const m = new Map<number, number>();
    for (const b of this.world.balls) if (b.alive) m.set(b.team, (m.get(b.team) ?? 0) + 1);
    return new Map([...m].sort((x, y) => x[0] - y[0]));
  }
}

/* ------------------------------------------------------------------ sounds */

/** The scale degree's MIDI note on the spec's root (C4 + root), wrapping after two octaves, as the tiles' notes do. */
export function blueprintMidi(bp: Blueprint, degree: number): number {
  const scale = BLUEPRINT_SCALES[bp.sound.scale] ?? BLUEPRINT_SCALES.major;
  const n = scale.length;
  const wrap = n * 2;
  const d0 = Number.isFinite(degree) ? Math.round(degree) : 0;
  const d = ((d0 % wrap) + wrap) % wrap;
  const octave = Math.floor(d / n);
  return 60 + bp.sound.root + 12 * octave + scale[d - octave * n];
}

const BLUEPRINT_SCALES: Readonly<Record<Blueprint["sound"]["scale"], readonly number[]>> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * A voice as the engine's generic SoundEvent (so the page, the fast export, the batch render and the bot play it with no new
 * tone code): hit – the bounce instrument, a note of the tune; gap – a bell chime; merge – a tuned bar an octave down;
 * split – a bright pluck an octave up. The loop voices accompany (`melody: false`).
 */
export function blueprintSoundEvent(bp: Blueprint, voice: Voice, pitch: number) {
  const f = hz(blueprintMidi(bp, pitch));
  switch (voice) {
    case "gap":
      return { type: "hit" as const, wallIndex: 0, loop: "chime" as const, frequency: f, level: 0.75, melody: false as const };
    case "merge":
      return { type: "hit" as const, wallIndex: 0, loop: "bar" as const, frequency: f / 2, level: 0.9, melody: false as const };
    case "split":
      return { type: "hit" as const, wallIndex: 0, loop: "pluck" as const, frequency: f * 2, level: 0.7, loopBright: true, melody: false as const };
    default:
      return { type: "hit" as const, wallIndex: 0, frequency: f, level: 0.8 };
  }
}

/** The end of a run: the completion chord on the spec's root (minor when it ran out of time). */
export function blueprintFinishSound(bp: Blueprint, won: boolean) {
  return { type: "hit" as const, wallIndex: 0, loop: "chord" as const, frequency: hz(48 + bp.sound.root), level: 0.9, melody: false as const, ...(won ? {} : { loopMinor: true }) };
}
