/**
 * --- slow-motion --- The real-time scheduler: how a run plays in real time while the Slow motion switch is off.
 *
 * With Slow motion on (the default) the page keeps its old loop (Canvas.tsx: the 100 ms frame cap, the 250 ms accumulator,
 * the frame budget that drops what it could not simulate), and so a heavy or time-dilated run plays slower than the clock.
 * With it off the page owes the run every millisecond of wall time × playback speed, a **debt** it pays with whole steps:
 *
 * - A step pays `STEP_MS × its time scale` (`PhysicsEngine.getStepTimeScale()`): a step the engine's time dilation shortened
 *   to a quarter pays a quarter, so four of them run in 16.666 ms – the dilation is repaid with steps, never with simulated
 *   time, and the run plays exactly the steps it always did (determinism: only how many a frame shows changes).
 * - A callback steps until the debt is paid, its budget is spent (at least one step always runs) or `MAX_STEPS_PER_CALLBACK`
 *   steps ran: `DRAW_BUDGET_MS` on a callback that draws, `CATCH_UP_BUDGET_MS` on one that skips its draw to catch up.
 * - It draws when its frame is due and the debt is paid, or when `MIN_DRAW_INTERVAL_MS` passed since the last drawn frame
 *   (so the canvas shows at least 10 frames a second); the wall time of the callbacks it skipped goes into the next drawn
 *   frame's `frameMs`.
 * - The debt is capped at `DEBT_CAP_MS` × playback speed: what a device truly cannot simulate is lost, counted in `lostMs`
 *   (the honest real-time badge shows it), instead of a spiral of ever longer frames. The cap is no cap on the run.
 * - A gap of more than `PAUSE_GAP_MS` between two callbacks (a hidden tab, a debugger) is a pause: the debt starts over and
 *   the callback counts as one frame.
 *
 * `OfflineRealTime` is the fast export's side: no wall clock at all, each video frame owes its frame time and pays it with
 * at most `EXPORT_CATCH_UP_STEPS` steps (in chunks the caller may yield between), so an export with the switch off is as
 * deterministic as one with it on. `RealTimeLanes` is a split-screen race's: one wall clock, budget and draw decision for
 * every arena, a debt per arena, whole steps round-robin. `playbackStepMs()` is what a step adds to a run's length as the
 * page plays it, for the seed finder. Pure, no DOM: the clock and the steps are the caller's (tests/realTime.test.ts).
 */
import { FRAME_BUDGET_MS } from "@/lib/simulation/frameBudget";

/** The page's step as the debt counts it (Canvas.tsx feeds `engine.update(16.666)`, one fixed step). */
export const STEP_MS = 16.666;
/** The most playback time (ms at 1x; × playback speed) the page may owe a run; past it the time is lost, and counted. */
export const DEBT_CAP_MS = 500;
/** A gap between two callbacks longer than this (ms) is a pause, not time the run owes. */
export const PAUSE_GAP_MS = 1000;
/** Wall-clock ms a callback that draws may spend on steps (the frame budget's, frameBudget.ts). */
export const DRAW_BUDGET_MS = FRAME_BUDGET_MS;
/** Wall-clock ms a callback that skips its draw to catch up may spend on steps. */
export const CATCH_UP_BUDGET_MS = 28;
/** The longest the canvas goes without a drawn frame while it catches up (ms): at least 10 frames a second. */
export const MIN_DRAW_INTERVAL_MS = 100;
/** The most steps one callback runs, however cheap they are and however little they pay (a dilation of 2^-20): the loop ends. */
export const MAX_STEPS_PER_CALLBACK = 4096;
/** The most steps the fast export runs for one video frame; past it the frame plays slower than real time, and is counted. */
export const EXPORT_CATCH_UP_STEPS = 256;
/** Steps the fast export runs between two looks at the clock (it yields to the page there once its time slice is spent). */
export const EXPORT_CATCH_UP_CHUNK = 8;
/** Rounding slack (ms) of the debt: four quarter steps pay a whole step's debt. */
const DEBT_EPSILON_MS = 1e-9;

/**
 * What a step pays of the debt (ms): `STEP_MS` × its time scale, and a whole step for a scale that is no positive finite
 * number (a run that is over, a clock that stands still), so a loop that pays steps always ends.
 */
export function stepCostMs(timeScale: number): number {
  return Number.isFinite(timeScale) && timeScale > 0 ? STEP_MS * timeScale : STEP_MS;
}

/**
 * The wall-clock ms between two callbacks as the real-time badge counts them (`FrameBudget.note()`, both switch states):
 * uncapped – a frame that took 300 ms counts 300, not the 100 the old loop feeds its steps – but a pause (a gap over
 * `PAUSE_GAP_MS`, a clock that went back) counts as one step, as the clock counts it, so a tab coming back shows no badge.
 */
export function realWallMs(gapMs: number): number {
  return gapMs >= 0 && gapMs <= PAUSE_GAP_MS ? gapMs : STEP_MS;
}

/** The caller's side of a live callback: its steps and its clock. */
export interface RealTimeStepper {
  /** Runs one whole step (`engine.update(STEP_MS)` and what follows it) and returns its time scale (`engine.getStepTimeScale()`). */
  step(): number;
  /** The current time in ms (`performance.now()`): the budget is measured on it. */
  now(): number;
}

/** What one live callback asks of the scheduler. */
export interface RealTimeInput {
  /** The run plays (started, not paused, not held): it owes time. Otherwise nothing is owed and nothing steps. */
  running: boolean;
  /** Playback speed (1, 2, 4, 8): the wall time it owes is multiplied by it. */
  simSpeed: number;
  /** The frame gate lets this callback draw (renderBudget.ts `FrameGate.due()`). */
  drawDue: boolean;
}

/** What one live callback did. */
export interface RealTimeTick {
  /** Wall-clock ms since the last callback as counted: uncapped, one step after a pause gap. */
  wallMs: number;
  /** Playback ms this callback owed the run (wall × speed; 0 while it does not run). */
  wantedMs: number;
  /** Playback ms its steps paid. */
  paidMs: number;
  /** Steps it ran. */
  steps: number;
  /** It draws its frame. */
  draw: boolean;
  /** Wall-clock ms the drawn frame covers, the skipped callbacks' time included (0 when it does not draw). */
  frameMs: number;
  /** It skipped its draw to catch up (the catch-up budget). */
  catchUp: boolean;
  /** The gap before it was a pause: the debt started over. */
  paused: boolean;
}

/** The live page's scheduler (one per canvas loop; a split-screen stage shares one between its arenas). */
export class RealTimeClock {
  /** Playback ms the run is owed right now (a step's rounding may leave it a little below 0). */
  debtMs = 0;
  /** Playback ms dropped past the debt cap since the last reset: time the device could not simulate. */
  lostMs = 0;
  /** Due frames skipped to catch up since the last reset. */
  framesSkipped = 0;
  /** Steps run since the last reset. */
  steps = 0;
  private lastNowMs: number | null = null;
  private lastDrawMs: number | null = null;
  private pendingFrameMs = 0;
  /** What the next step is expected to pay: the last step's cost (a whole step before the first). */
  private nextCostMs = STEP_MS;
  private readonly result: RealTimeTick = { wallMs: 0, wantedMs: 0, paidMs: 0, steps: 0, draw: false, frameMs: 0, catchUp: false, paused: false };

  /** The run owes at least the next step. */
  get owesStep(): boolean {
    return this.debtMs >= this.nextCostMs - DEBT_EPSILON_MS;
  }

  /**
   * The share of the next step the run is owed already, from 0 to just under 1: where a view drawn between steps stands
   * (the page's leftover accumulator ÷ one step in the old loop; a dilated step's share is of its own cost).
   */
  get stepFraction(): number {
    const f = this.debtMs / this.nextCostMs;
    return f > 0 ? Math.min(f, 1 - 1e-9) : 0;
  }

  /** A new run, a new loop or the switch turned over: nothing owed, nothing counted, the next callback starts the clock. */
  reset() {
    this.debtMs = 0;
    this.lostMs = 0;
    this.framesSkipped = 0;
    this.steps = 0;
    this.lastNowMs = null;
    this.lastDrawMs = null;
    this.pendingFrameMs = 0;
    this.nextCostMs = STEP_MS;
  }

  /**
   * One rAF callback at `nowMs` (its timestamp): adds the wall time it owes, runs the steps its budget allows and says
   * whether it draws. The result object is reused from call to call (nothing is allocated per frame).
   */
  tick(nowMs: number, input: RealTimeInput, stepper: RealTimeStepper): RealTimeTick {
    const out = this.result;
    out.wantedMs = 0;
    out.paidMs = 0;
    out.steps = 0;
    out.draw = false;
    out.frameMs = 0;
    out.catchUp = false;
    out.paused = false;
    let wall = this.lastNowMs === null ? 0 : nowMs - this.lastNowMs;
    this.lastNowMs = nowMs;
    // A hidden tab, a debugger or a clock that went back: a pause, never time the run owes.
    if (!(wall >= 0) || wall > PAUSE_GAP_MS) {
      out.paused = true;
      this.debtMs = 0;
      wall = STEP_MS;
    }
    out.wallMs = wall;
    this.pendingFrameMs += wall;
    if (input.running) {
      const speed = Number.isFinite(input.simSpeed) && input.simSpeed > 0 ? input.simSpeed : 1;
      out.wantedMs = wall * speed;
      this.debtMs += out.wantedMs;
      const cap = DEBT_CAP_MS * speed;
      if (this.debtMs > cap) {
        this.lostMs += this.debtMs - cap;
        this.debtMs = cap;
      }
      const start = stepper.now();
      this.runSteps(stepper, start, DRAW_BUDGET_MS, out);
      // Still owing after a drawing callback's budget, with no frame overdue: skip the draw and catch up a little longer.
      if (this.owesStep && out.steps < MAX_STEPS_PER_CALLBACK && !(input.drawDue && this.drawOverdue(nowMs))) {
        out.catchUp = true;
        this.runSteps(stepper, start, CATCH_UP_BUDGET_MS, out);
      }
    } else this.debtMs = 0; // (paused, not started or held: nothing is owed)
    out.draw = input.drawDue && (!input.running || !this.owesStep || this.drawOverdue(nowMs));
    if (out.draw) {
      out.frameMs = this.pendingFrameMs;
      this.pendingFrameMs = 0;
      this.lastDrawMs = nowMs;
    } else if (input.drawDue) this.framesSkipped++;
    return out;
  }

  /** No frame for `MIN_DRAW_INTERVAL_MS` (or none yet): the next due frame is drawn whatever is owed. */
  private drawOverdue(nowMs: number): boolean {
    return this.lastDrawMs === null || nowMs - this.lastDrawMs >= MIN_DRAW_INTERVAL_MS;
  }

  /** Whole steps while the run owes one, the budget (from `startMs`) remains – or no step ran yet – and the step guard allows. */
  private runSteps(stepper: RealTimeStepper, startMs: number, budgetMs: number, out: RealTimeTick) {
    while (this.owesStep && out.steps < MAX_STEPS_PER_CALLBACK) {
      if (out.steps > 0 && !(stepper.now() - startMs < budgetMs)) break;
      const cost = stepCostMs(stepper.step());
      this.nextCostMs = cost;
      this.debtMs -= cost;
      out.paidMs += cost;
      out.steps++;
      this.steps++;
    }
  }
}

/**
 * The fast export's scheduler with the switch off: no wall clock. A video frame owes its frame time (`beginFrame()`), its
 * steps pay it as the live page's do (`advance()`, in chunks the caller may yield between), at most `stepCap` steps a frame;
 * a frame its cap stopped with a step still owed plays slower than real time and is counted (`endFrame()`). The same seed
 * and the same steps give the same frames on every machine.
 */
export class OfflineRealTime {
  /** Playback ms the run is owed (capped at `DEBT_CAP_MS`, as the live page's at 1x). */
  debtMs = 0;
  /** Playback ms dropped past the debt cap. */
  lostMs = 0;
  /** Frames whose step cap stopped them with a step still owed: frames slower than real time. */
  laggedFrames = 0;
  /** Steps run in all. */
  steps = 0;
  private frameSteps = 0;
  private nextCostMs = STEP_MS;

  constructor(readonly stepCap: number = EXPORT_CATCH_UP_STEPS) {}

  /** A new video frame owes `frameMs` more playback time (1000 / fps of the export's frame clock). */
  beginFrame(frameMs: number = STEP_MS) {
    if (Number.isFinite(frameMs) && frameMs > 0) this.debtMs += frameMs;
    if (this.debtMs > DEBT_CAP_MS) {
      this.lostMs += this.debtMs - DEBT_CAP_MS;
      this.debtMs = DEBT_CAP_MS;
    }
    this.frameSteps = 0;
  }

  /** The frame still owes a step and its cap allows one. */
  get pending(): boolean {
    return this.debtMs >= this.nextCostMs - DEBT_EPSILON_MS && this.frameSteps < this.stepCap;
  }

  /** Runs at most `maxSteps` of this frame's steps (`step` runs one and returns its time scale); returns how many ran. */
  advance(step: () => number, maxSteps = Infinity): number {
    let ran = 0;
    while (ran < maxSteps && this.pending) {
      const cost = stepCostMs(step());
      this.nextCostMs = cost;
      this.debtMs -= cost;
      this.frameSteps++;
      this.steps++;
      ran++;
    }
    return ran;
  }

  /** The frame is done: true (and counted) when its step cap stopped it with a step still owed. */
  endFrame(): boolean {
    const lagged = this.frameSteps >= this.stepCap && this.debtMs >= this.nextCostMs - DEBT_EPSILON_MS;
    if (lagged) this.laggedFrames++;
    return lagged;
  }
}

/**
 * The playback time (ms) one step of `stepMs` adds to a run's length as the page plays it – what the seed finder, the bot and
 * the CLI's simulate tool count a run's length in. With Slow motion on, a whole step: the page plays one step a frame, so a
 * step the engine's time dilation shortened plays slowed and takes a whole frame. With it off, the step's share of a frame
 * (`stepMs` × its time scale, `PhysicsEngine.getStepTimeScale()`), as the real-time loop pays it – but never less than one
 * frame's share of the fast export's step cap (`stepMs / EXPORT_CATCH_UP_STEPS`): past the cap a frame plays slower than real
 * time on every machine, and a search over a run dilated to 2^-20 still ends. A whole step (scale 1) adds `stepMs` exactly,
 * so a default run measures the same either way, bit for bit.
 */
export function playbackStepMs(stepMs: number, slowMotionOn: boolean, timeScale: number): number {
  if (slowMotionOn || !(Number.isFinite(timeScale) && timeScale > 0) || timeScale >= 1) return stepMs;
  return stepMs * Math.max(timeScale, 1 / EXPORT_CATCH_UP_STEPS);
}

/** One arena of a split-screen race (`RealTimeLanes`): its own debt, paid by its own steps. */
export interface RealTimeLane {
  /** Playback ms this arena is owed. */
  debtMs: number;
  /** Playback ms dropped past the debt cap. */
  lostMs: number;
  /** Steps it ran. */
  steps: number;
  /** What its next step is expected to pay (its last step's cost). */
  nextCostMs: number;
}

/**
 * A split-screen race's scheduler with the switch off (splitScreenCanvas.tsx): one wall clock, one budget and one draw decision
 * for all the arenas, as `RealTimeClock` has them for one canvas, and a debt per arena – each owes the same wall time × speed
 * and pays it with its own steps at its own time scale, so a dilated arena runs more steps and every arena plays in real time.
 * The steps go round-robin: every arena that owes a step runs one before any runs a second, and the turn carries over from one
 * callback (and one budget) to the next, so under load the arenas' clocks stay level and none starves. At least one step runs
 * a callback (whoever owes it).
 */
export class RealTimeLanes {
  readonly lanes: RealTimeLane[] = [];
  /** Due frames skipped to catch up since the last reset. */
  framesSkipped = 0;
  private lastNowMs: number | null = null;
  private lastDrawMs: number | null = null;
  private pendingFrameMs = 0;
  private cursor = 0;
  private readonly result: RealTimeTick = { wallMs: 0, wantedMs: 0, paidMs: 0, steps: 0, draw: false, frameMs: 0, catchUp: false, paused: false };
  private readonly paid: number[] = [];

  /** Playback ms dropped past the debt cap, by the arena that lost the most. */
  get lostMs(): number {
    let lost = 0;
    for (const lane of this.lanes) if (lane.lostMs > lost) lost = lane.lostMs;
    return lost;
  }

  /** The most an arena is owed right now. */
  get debtMs(): number {
    let debt = 0;
    for (const lane of this.lanes) if (lane.debtMs > debt) debt = lane.debtMs;
    return debt;
  }

  /** Some arena owes at least its next step. */
  get owesStep(): boolean {
    for (const lane of this.lanes) if (lane.debtMs >= lane.nextCostMs - DEBT_EPSILON_MS) return true;
    return false;
  }

  /** A new race, a new loop or the switch turned over: nothing owed, nothing counted. */
  reset() {
    this.lanes.length = 0;
    this.framesSkipped = 0;
    this.lastNowMs = null;
    this.lastDrawMs = null;
    this.pendingFrameMs = 0;
    this.cursor = 0;
  }

  /**
   * One rAF callback at `nowMs` for the arenas `steps` (each runs one whole step of its arena and returns its time scale),
   * the budget measured on `now()`. The result's `paidMs` is the arena that paid the least (the real-time badge's slowest),
   * its `steps` the steps of all the arenas. The result object is reused from call to call.
   */
  tick(nowMs: number, input: RealTimeInput, steps: readonly (() => number)[], now: () => number): RealTimeTick {
    const out = this.result;
    const n = steps.length;
    while (this.lanes.length < n) this.lanes.push({ debtMs: 0, lostMs: 0, steps: 0, nextCostMs: STEP_MS });
    if (this.lanes.length > n) this.lanes.length = n;
    if (this.cursor >= n) this.cursor = 0;
    out.wantedMs = 0;
    out.paidMs = 0;
    out.steps = 0;
    out.draw = false;
    out.frameMs = 0;
    out.catchUp = false;
    out.paused = false;
    let wall = this.lastNowMs === null ? 0 : nowMs - this.lastNowMs;
    this.lastNowMs = nowMs;
    if (!(wall >= 0) || wall > PAUSE_GAP_MS) {
      out.paused = true;
      for (const lane of this.lanes) lane.debtMs = 0;
      wall = STEP_MS;
    }
    out.wallMs = wall;
    this.pendingFrameMs += wall;
    if (input.running && n > 0) {
      const speed = Number.isFinite(input.simSpeed) && input.simSpeed > 0 ? input.simSpeed : 1;
      out.wantedMs = wall * speed;
      const cap = DEBT_CAP_MS * speed;
      this.paid.length = n;
      for (let i = 0; i < n; i++) {
        const lane = this.lanes[i];
        lane.debtMs += out.wantedMs;
        if (lane.debtMs > cap) {
          lane.lostMs += lane.debtMs - cap;
          lane.debtMs = cap;
        }
        this.paid[i] = 0;
      }
      const start = now();
      const limit = MAX_STEPS_PER_CALLBACK * n;
      this.runRounds(steps, now, start, DRAW_BUDGET_MS, limit, out);
      if (this.owesStep && out.steps < limit && !(input.drawDue && this.drawOverdue(nowMs))) {
        out.catchUp = true;
        this.runRounds(steps, now, start, CATCH_UP_BUDGET_MS, limit, out);
      }
      let least = Infinity;
      for (let i = 0; i < n; i++) if (this.paid[i] < least) least = this.paid[i];
      out.paidMs = least;
    } else for (const lane of this.lanes) lane.debtMs = 0;
    out.draw = input.drawDue && (!input.running || !this.owesStep || this.drawOverdue(nowMs));
    if (out.draw) {
      out.frameMs = this.pendingFrameMs;
      this.pendingFrameMs = 0;
      this.lastDrawMs = nowMs;
    } else if (input.drawDue) this.framesSkipped++;
    return out;
  }

  private drawOverdue(nowMs: number): boolean {
    return this.lastDrawMs === null || nowMs - this.lastDrawMs >= MIN_DRAW_INTERVAL_MS;
  }

  /**
   * Whole steps, one arena after the other from the one whose turn it is (`cursor`, kept from step to step and callback to
   * callback), skipping an arena that owes nothing, while some arena owes a step and the budget (or no step yet) allows.
   */
  private runRounds(steps: readonly (() => number)[], now: () => number, startMs: number, budgetMs: number, limit: number, out: RealTimeTick) {
    const n = steps.length;
    let idle = 0; // arenas passed in a row that owed nothing: once all of them, nobody owes a step
    while (idle < n) {
      const i = this.cursor;
      const lane = this.lanes[i];
      if (!(lane.debtMs >= lane.nextCostMs - DEBT_EPSILON_MS)) {
        this.cursor = (i + 1) % n;
        idle++;
        continue;
      }
      if (out.steps >= limit || (out.steps > 0 && !(now() - startMs < budgetMs))) return;
      const cost = stepCostMs(steps[i]());
      lane.nextCostMs = cost;
      lane.debtMs -= cost;
      lane.steps++;
      this.paid[i] += cost;
      out.steps++;
      this.cursor = (i + 1) % n;
      idle = 0;
    }
  }
}
