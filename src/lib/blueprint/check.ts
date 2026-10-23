/*
 * --- blueprint --- The playability check: does a spec make a clip? It plays the spec on a few seeds on the real runtime –
 * the engine in the blueprint mode, as the page, the fast export and the finder play it (headless.ts) – and judges it on
 * deterministic counts only, never on wall-clock time, so the verdict is the same on every machine and every run (a caller
 * may time it and add an advisory "slow").
 *
 *  - playable: at least 3 of 4 seeds end by a finish condition; the median end is between 6 s and the timeout; no seed has a
 *    fault, a ball gone non-finite, dropped events or rule firings, or an arena full of balls (the ceiling); the median seed
 *    plays at least 5 sounds, and on every seed something moves within the first second;
 *  - endless: every seed runs into the timeout, and nothing is broken;
 *  - broken: anything else.
 *
 * Every problem comes back as a plain sentence an author – a person, a coding agent or a 1.5B local model – can act on.
 *
 * --- review fix (blueprint) --- A seed is played to its decided end (its step ceiling bounds it, however slow), in slices
 * when a page asks (`SeedCheck.advance()`: the panel yields between them, so the tab never blocks), and it stops early, on
 * counts alone, when a tab could not play it: "heavy" – a second of steps costs more than CHECK_HEAVY_STEP_COST work units
 * a step on average (ball sub-steps, contact and pair tests, rule work) – or "slow" – five seconds of steps advanced the
 * run's clock by less than half that (the engine slows time to follow balls too fast for their size). Neither is ever
 * reported as a timeout.
 */
import { BLUEPRINT_ACTION_BALLS_PER_STEP, BLUEPRINT_BALL_CEILING, BLUEPRINT_PAIR_TESTS_PER_STEP, BLUEPRINT_SPEED_CEILING, BLUEPRINT_STEP_BUDGETS } from "./limits";
import { DEFAULT_SAY, type Blueprint } from "./schema";
import { HeadlessBlueprint, blueprintStepBound } from "./headless";
import type { FinishReason } from "./runtime/run";

export const PLAYABLE_MIN_SEC = 6;
export const PLAYABLE_MIN_SOUNDS = 5;
export const PLAYABLE_FIRST_MOTION_SEC = 1;
export const DEFAULT_CHECK_SEEDS: readonly number[] = [1, 2, 3, 4];
/**
 * Work units (RunStats.cost) a step may cost on average over a second of steps before the check calls the spec too heavy for
 * a tab: two thirds of the most the sandbox's ceilings let a step cost (about 2 ms a step in Node, a phone's whole frame).
 * A crowd of 400 balls piled in a bowl costs about 30,000; the catalog under 2,000.
 */
export const CHECK_HEAVY_STEP_COST = 60_000;
/** Steps the "slow" judgement looks back over (five seconds), and the least share of them the run's clock must advance. */
export const CHECK_SLOW_WINDOW_STEPS = 300;
export const CHECK_SLOW_MIN_SPEED = 0.5;

export type PlayabilityVerdict = "playable" | "endless" | "broken";

/** How a seed's check ended: the run's own end, or the check stopped it – too heavy for a tab, or slow motion. */
export type SeedEnd = FinishReason | "heavy" | "slow";

export interface SeedReport {
  seed: number;
  reason: SeedEnd;
  /** The finish condition met (index in finish.any), or −1. */
  condition: number;
  timeSec: number;
  result: string;
  winner: number;
  peakBalls: number;
  arenaFull: number;
  droppedEvents: number;
  droppedFirings: number;
  refusedActions: number;
  faults: number;
  nanBalls: number;
  /** Balls past the speed ceiling that were taken out. */
  fastBalls: number;
  /** Sub-steps whose pair tests ran past their share (the rest skipped). */
  droppedPairs: number;
  /** Actions dropped past the step's ball budget. */
  droppedActions: number;
  sounds: number;
  firstMotionSec: number | null;
  payoffSec: number | null;
  escaped: number;
  tilesBroken: number;
  /** Events plus rule firings: the interpreter's work. */
  workUnits: number;
  workPerSec: number;
  /** Steps played. */
  steps: number;
  /** The run's work units (RunStats.cost) on average a step, and over its costliest second of steps. */
  costPerStep: number;
  peakCostPerStep: number;
}

/** What a problem sentence is about (a page shows the first in its own language). */
export type CheckProblem = "fault" | "nan" | "droppedEvents" | "droppedFirings" | "arenaFull" | "heavy" | "slow" | "fast" | "crowded" | "busy" | "quiet" | "still" | "endless" | "fewEnd" | "short" | "long";

export interface PlayabilityReport {
  verdict: PlayabilityVerdict;
  /** Plain sentences: what is wrong and what to change (or why it is playable). */
  feedback: string[];
  /** --- review fix (blueprint) --- What each problem sentence is about, in the same order (none when playable). */
  problems: CheckProblem[];
  seeds: SeedReport[];
  finishedByCondition: number;
  medianFinishSec: number;
}

export interface CheckOptions {
  /** The seeds (default 1, 2, 3, 4). */
  seeds?: readonly number[];
  /** Conformance tests only: firing rule i throws (fault containment). */
  faultOnRule?: number;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One seed of a spec being checked, step by step: `advance(n)` plays up to n more steps and returns the seed's report once
 * it is over (null while it is not). A page calls it in slices and yields between them; `checkSeed()` plays it in one go.
 */
export class SeedCheck {
  readonly seed: number;
  private readonly h: HeadlessBlueprint;
  private readonly bound: number;
  /** Each step's cost and clock, over the last CHECK_SLOW_WINDOW_STEPS steps (rings). */
  private readonly costs = new Float64Array(60);
  private readonly clocks = new Float64Array(CHECK_SLOW_WINDOW_STEPS);
  private windowCost = 0;
  private peakWindowCost = 0;
  private lastCost = 0;
  private steps = 0;
  private report: SeedReport | null = null;

  constructor(bp: Blueprint, seed: number, faultOnRule?: number) {
    this.seed = seed;
    this.h = new HeadlessBlueprint(bp, { seed, faultOnRule });
    this.bound = blueprintStepBound(bp);
  }

  /** The report once the seed is over, else null. */
  get done(): SeedReport | null {
    return this.report;
  }

  /** Plays up to `maxSteps` more steps; the report once the seed is over. */
  advance(maxSteps = Infinity): SeedReport | null {
    if (this.report) return this.report;
    const h = this.h;
    for (let i = 0; i < maxSteps; i++) {
      if (h.finished) return this.end(null);
      if (this.steps >= this.bound) return this.end("slow");
      const clockWas = this.clocks[this.steps % CHECK_SLOW_WINDOW_STEPS];
      h.step();
      const k = this.steps++;
      const cost = h.stats.cost - this.lastCost;
      this.lastCost = h.stats.cost;
      this.windowCost += cost - this.costs[k % 60];
      this.costs[k % 60] = cost;
      this.clocks[k % CHECK_SLOW_WINDOW_STEPS] = h.run.timeSec;
      if (h.finished) return this.end(null);
      if (this.steps >= 60) {
        if (this.windowCost > this.peakWindowCost) this.peakWindowCost = this.windowCost;
        if (this.windowCost > 60 * CHECK_HEAVY_STEP_COST) return this.end("heavy");
      }
      // five seconds of steps moved the run's clock less than half that: slow motion
      if (this.steps > CHECK_SLOW_WINDOW_STEPS && h.run.timeSec - clockWas < (CHECK_SLOW_MIN_SPEED * CHECK_SLOW_WINDOW_STEPS) / 60) return this.end("slow");
    }
    return null;
  }

  private end(stopped: "heavy" | "slow" | null): SeedReport {
    const h = this.h;
    const result = h.result();
    const stats = h.stats;
    // (a decided run's own reason; never "timeout" for a run the check stopped)
    const reason: SeedEnd = stopped ?? result.reason ?? "slow";
    const time = result.finished ? result.timeSec : h.run.timeSec;
    const work = stats.events + stats.firings;
    this.report = {
      seed: this.seed,
      reason,
      condition: result.condition,
      timeSec: round(time, 3),
      result: result.result,
      winner: result.winner,
      peakBalls: stats.peakBalls,
      arenaFull: stats.arenaFull,
      droppedEvents: stats.droppedEvents,
      droppedFirings: stats.droppedFirings,
      refusedActions: stats.refusedActions,
      faults: stats.faults,
      nanBalls: stats.nanBalls,
      fastBalls: stats.fastBalls,
      droppedPairs: stats.droppedPairs,
      droppedActions: stats.droppedActions,
      sounds: stats.sounds,
      firstMotionSec: stats.firstMotionSec === null ? null : round(stats.firstMotionSec, 3),
      payoffSec: stats.payoffSec === null ? null : round(stats.payoffSec, 3),
      escaped: stats.escaped,
      tilesBroken: stats.tilesBroken,
      workUnits: work,
      workPerSec: round(work / Math.max(time, 1e-9), 1),
      steps: this.steps,
      costPerStep: Math.round(stats.cost / Math.max(1, this.steps)),
      peakCostPerStep: Math.round(Math.max(this.peakWindowCost, this.windowCost) / Math.min(60, Math.max(1, this.steps))),
    };
    return this.report;
  }
}

/** Runs one seed of a spec to its end (or until the check stops it: too heavy, or slow motion). */
export function checkSeed(bp: Blueprint, seed: number, faultOnRule?: number): SeedReport {
  return new SeedCheck(bp, seed, faultOnRule).advance()!;
}

/** The verdict on a resolved spec (sanitizeBlueprint's output) over a few seeds, with plain feedback. */
export function playabilityCheck(bp: Blueprint, options: CheckOptions = {}): PlayabilityReport {
  const seeds = (options.seeds ?? DEFAULT_CHECK_SEEDS).slice(0, 16);
  return judgeSeeds(bp, seeds.map((s) => checkSeed(bp, s, options.faultOnRule)));
}

/** The verdict on the seeds' reports (a page plays each seed's SeedCheck in slices, then judges them here). */
export function judgeSeeds(bp: Blueprint, reports: SeedReport[]): PlayabilityReport {
  const n = reports.length;
  const byCondition = reports.filter((r) => r.reason === "condition");
  const med = round(median(reports.map((r) => (r.reason === "condition" ? r.timeSec : bp.finish.timeoutSec))), 2);
  const need = Math.ceil(n * 0.75);
  const feedback: string[] = [];
  const problems: CheckProblem[] = [];
  const problem = (code: CheckProblem, sentence: string) => {
    problems.push(code);
    feedback.push(sentence);
  };
  const seedList = (rs: SeedReport[]) => rs.map((r) => r.seed).join(", ");

  const faults = reports.filter((r) => r.faults > 0);
  const nan = reports.filter((r) => r.nanBalls > 0);
  const droppedEvents = reports.filter((r) => r.droppedEvents > 0);
  const droppedFirings = reports.filter((r) => r.droppedFirings > 0);
  const full = reports.filter((r) => r.arenaFull > 0);
  const heavy = reports.filter((r) => r.reason === "heavy");
  const slow = reports.filter((r) => r.reason === "slow");
  const fast = reports.filter((r) => r.fastBalls > 0);
  const crowded = reports.filter((r) => r.droppedPairs > 0);
  const busy = reports.filter((r) => r.droppedActions > 0);
  const quiet = median(reports.map((r) => r.sounds)) < PLAYABLE_MIN_SOUNDS ? reports.filter((r) => r.sounds < PLAYABLE_MIN_SOUNDS) : [];
  const still = reports.filter((r) => r.firstMotionSec === null || r.firstMotionSec > PLAYABLE_FIRST_MOTION_SEC);

  if (faults.length) problem("fault", `A rule failed while running on seed ${seedList(faults)}: the rules stopped and the run ended 1 s later. Simplify the rule that fired last.`);
  if (nan.length) problem("nan", `Balls went out of range (NaN or infinity) on seed ${seedList(nan)}: a speed, a gravity or a formula gave numbers too big to move. Use smaller values or bound the formula with min() or clamp().`);
  if (droppedEvents.length)
    problem("droppedEvents", `Too much happens at once on seed ${seedList(droppedEvents)}: events past the ${BLUEPRINT_STEP_BUDGETS.events} a step were dropped. Use fewer balls touching each other, or fewer and smaller balls.`);
  if (droppedFirings.length)
    problem("droppedFirings", `Rules fire too often on seed ${seedList(droppedFirings)}: firings past the ${BLUEPRINT_STEP_BUDGETS.ruleFirings} a step were dropped. Add a cooldownSec, an every or a chance to the busiest rule.`);
  if (full.length) problem("arenaFull", `The arena filled up (${BLUEPRINT_BALL_CEILING} balls: ARENA FULL) on seed ${seedList(full)}. Spawn or split less, or end the run earlier with a ball-count finish below ${BLUEPRINT_BALL_CEILING}.`);
  if (heavy.length)
    problem("heavy", 
      `It is too heavy for a browser tab on seed ${seedList(heavy)}: a second of play costs more than ${CHECK_HEAVY_STEP_COST} work units a step (balls × sub-steps, contact and pair tests, rule work), so the check stopped it. Use fewer or smaller balls, fewer tiles, or rules that change fewer balls.`,
    );
  if (slow.length)
    problem("slow", `It plays in slow motion on seed ${seedList(slow)}: balls move too fast for their size, so the engine slows time to follow them and the run's clock barely moves. Slow the balls down, make them bigger, or stop a speed-up sooner.`);
  if (fast.length)
    problem("fast", `A ball got faster than ${BLUEPRINT_SPEED_CEILING} px/s and was taken out on seed ${seedList(fast)}. Bound the speed-up: a scale closer to 1, a maxFires on the rule, or min() in its formula.`);
  if (crowded.length)
    problem("crowded", `Too many balls touch at once on seed ${seedList(crowded)}: ball-pair tests past the ${BLUEPRINT_PAIR_TESTS_PER_STEP} a step were skipped. Use fewer or smaller balls.`);
  if (busy.length)
    problem("busy", `Rules change too many balls at once on seed ${seedList(busy)}: actions past the ${BLUEPRINT_ACTION_BALLS_PER_STEP} balls a step were dropped. Give the busiest rule a cooldownSec or an every, or target self instead of all.`);
  if (quiet.length) problem("quiet", `It is too quiet: the median seed plays fewer than ${PLAYABLE_MIN_SOUNDS} sounds (seed ${seedList(quiet)}). Give the hits a voice (sound.voices) or add sound actions.`);
  if (still.length) problem("still", `Nothing moves within the first ${PLAYABLE_FIRST_MOTION_SEC} s on seed ${seedList(still)}: give a spawner a speed and a startSec of 0, or the arena gravity.`);

  const broken = faults.length + nan.length + droppedEvents.length + droppedFirings.length + full.length + heavy.length + slow.length + fast.length + crowded.length + busy.length + quiet.length + still.length > 0;
  let verdict: PlayabilityVerdict;
  if (!broken && byCondition.length === 0) {
    verdict = "endless";
    problem(
      "endless",

      bp.finish.any.length
        ? `It never ends by itself: every seed ran into the ${bp.finish.timeoutSec} s timeout before ${bp.finish.any.map((c) => c.when).join(" or ")}. Make the finish easier to reach (fewer tiles or rings, a wider exit, a lower count) or give it more time.`
        : `It never ends by itself: there is no finish condition, so every seed runs into the ${bp.finish.timeoutSec} s timeout. Add one to finish.any (escaped, tilesCleared, ringsCleared, count, tier or teamsLeft).`,
    );
  } else {
    const fewEnd = byCondition.length < need;
    const short = med < PLAYABLE_MIN_SEC;
    const long = med >= bp.finish.timeoutSec;
    if (fewEnd)
      problem(
        "fewEnd",

        `Only ${byCondition.length} of ${n} seeds end by a finish condition (at least ${need} should): the others ran into the ${bp.finish.timeoutSec} s timeout. Make the finish easier to reach, or give it more time.`,
      );
    if (short) problem("short", `It ends after a median ${med} s: too quick for a clip. Aim for ${PLAYABLE_MIN_SEC} s or more – slower balls, more tiles, a narrower exit, a higher count.`);
    if (long && !fewEnd) problem("long", `The median end (${med} s) is at the timeout: most runs only just make it. Make the finish a little easier to reach.`);
    verdict = broken || fewEnd || short || long ? "broken" : "playable";
  }
  if (verdict === "playable") {
    const ends = [...new Set(byCondition.map((r) => r.condition))].map((i) => `"${bp.finish.any[i].say || DEFAULT_SAY[bp.finish.any[i].when]}" (${bp.finish.any[i].when})`);
    feedback.unshift(`Playable: it ends by ${ends.join(" or ")} after a median ${med} s, on ${byCondition.length} of ${n} seeds.`);
  }
  return { verdict, feedback, problems, seeds: reports, finishedByCondition: byCondition.length, medianFinishSec: med };
}

/**
 * --- review fix (blueprint) --- The check as a page runs it: every seed's SeedCheck in turn, in slices – `slice()` plays
 * steps until `budgetMs` of the caller's clock has passed (at least one step), so the page yields between slices and the
 * tab never blocks for a whole seed. The clock only decides where a slice ends: the verdict is the counts', the same as
 * playabilityCheck()'s on every machine.
 */
export class PlayabilityRun {
  readonly bp: Blueprint;
  readonly seeds: readonly number[];
  private readonly faultOnRule: number | undefined;
  private readonly reports: SeedReport[] = [];
  private current: SeedCheck | null = null;
  private report: PlayabilityReport | null = null;

  constructor(bp: Blueprint, seeds: readonly number[] = DEFAULT_CHECK_SEEDS, faultOnRule?: number) {
    this.bp = bp;
    this.seeds = seeds.slice(0, 16);
    this.faultOnRule = faultOnRule;
  }

  /** Seeds whose report is in. */
  get seedsDone(): number {
    return this.reports.length;
  }

  /** The verdict once every seed is in, else null. */
  get done(): PlayabilityReport | null {
    return this.report;
  }

  /** Plays until `budgetMs` of `now()` has passed (at least one step); the verdict once every seed is in. */
  slice(budgetMs: number, now: () => number): PlayabilityReport | null {
    if (this.report) return this.report;
    const start = now();
    do {
      if (this.reports.length >= this.seeds.length) {
        this.report = judgeSeeds(this.bp, this.reports);
        return this.report;
      }
      this.current ??= new SeedCheck(this.bp, this.seeds[this.reports.length], this.faultOnRule);
      const r = this.current.advance(1);
      if (r) {
        this.reports.push(r);
        this.current = null;
      }
    } while (now() - start < budgetMs);
    if (this.reports.length >= this.seeds.length) this.report = judgeSeeds(this.bp, this.reports);
    return this.report;
  }
}
