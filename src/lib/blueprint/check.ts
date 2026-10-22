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
 */
import { BLUEPRINT_BALL_CEILING, BLUEPRINT_STEP_BUDGETS } from "./limits";
import { DEFAULT_SAY, type Blueprint } from "./schema";
import { runBlueprint } from "./headless";
import type { FinishReason } from "./runtime/run";

export const PLAYABLE_MIN_SEC = 6;
export const PLAYABLE_MIN_SOUNDS = 5;
export const PLAYABLE_FIRST_MOTION_SEC = 1;
export const DEFAULT_CHECK_SEEDS: readonly number[] = [1, 2, 3, 4];

export type PlayabilityVerdict = "playable" | "endless" | "broken";

export interface SeedReport {
  seed: number;
  reason: FinishReason;
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
  sounds: number;
  firstMotionSec: number | null;
  payoffSec: number | null;
  escaped: number;
  tilesBroken: number;
  /** Events plus rule firings: the interpreter's work. */
  workUnits: number;
  workPerSec: number;
}

export interface PlayabilityReport {
  verdict: PlayabilityVerdict;
  /** Plain sentences: what is wrong and what to change (or why it is playable). */
  feedback: string[];
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

/** Runs one seed of a spec to its end. */
export function checkSeed(bp: Blueprint, seed: number, faultOnRule?: number): SeedReport {
  const { result, stats } = runBlueprint(bp, { seed, faultOnRule });
  const reason = result.reason ?? "timeout";
  const work = stats.events + stats.firings;
  return {
    seed,
    reason,
    condition: result.condition,
    timeSec: round(result.timeSec, 3),
    result: result.result,
    winner: result.winner,
    peakBalls: stats.peakBalls,
    arenaFull: stats.arenaFull,
    droppedEvents: stats.droppedEvents,
    droppedFirings: stats.droppedFirings,
    refusedActions: stats.refusedActions,
    faults: stats.faults,
    nanBalls: stats.nanBalls,
    sounds: stats.sounds,
    firstMotionSec: stats.firstMotionSec === null ? null : round(stats.firstMotionSec, 3),
    payoffSec: stats.payoffSec === null ? null : round(stats.payoffSec, 3),
    escaped: stats.escaped,
    tilesBroken: stats.tilesBroken,
    workUnits: work,
    workPerSec: round(work / Math.max(result.timeSec, 1e-9), 1),
  };
}

/** The verdict on a resolved spec (sanitizeBlueprint's output) over a few seeds, with plain feedback. */
export function playabilityCheck(bp: Blueprint, options: CheckOptions = {}): PlayabilityReport {
  const seeds = (options.seeds ?? DEFAULT_CHECK_SEEDS).slice(0, 16);
  return judgeSeeds(bp, seeds.map((s) => checkSeed(bp, s, options.faultOnRule)));
}

/** The verdict on the seeds' reports (a page runs `checkSeed()` one seed a frame, then judges them here). */
export function judgeSeeds(bp: Blueprint, reports: SeedReport[]): PlayabilityReport {
  const n = reports.length;
  const byCondition = reports.filter((r) => r.reason === "condition");
  const med = round(median(reports.map((r) => (r.reason === "condition" ? r.timeSec : bp.finish.timeoutSec))), 2);
  const need = Math.ceil(n * 0.75);
  const feedback: string[] = [];
  const seedList = (rs: SeedReport[]) => rs.map((r) => r.seed).join(", ");

  const faults = reports.filter((r) => r.faults > 0);
  const nan = reports.filter((r) => r.nanBalls > 0);
  const droppedEvents = reports.filter((r) => r.droppedEvents > 0);
  const droppedFirings = reports.filter((r) => r.droppedFirings > 0);
  const full = reports.filter((r) => r.arenaFull > 0);
  const quiet = median(reports.map((r) => r.sounds)) < PLAYABLE_MIN_SOUNDS ? reports.filter((r) => r.sounds < PLAYABLE_MIN_SOUNDS) : [];
  const still = reports.filter((r) => r.firstMotionSec === null || r.firstMotionSec > PLAYABLE_FIRST_MOTION_SEC);

  if (faults.length) feedback.push(`A rule failed while running on seed ${seedList(faults)}: the rules stopped and the run ended 1 s later. Simplify the rule that fired last.`);
  if (nan.length) feedback.push(`Balls went out of range (NaN or infinity) on seed ${seedList(nan)}: a speed, a gravity or a formula gave numbers too big to move. Use smaller values or bound the formula with min() or clamp().`);
  if (droppedEvents.length)
    feedback.push(`Too much happens at once on seed ${seedList(droppedEvents)}: events past the ${BLUEPRINT_STEP_BUDGETS.events} a step were dropped. Use fewer balls touching each other, or fewer and smaller balls.`);
  if (droppedFirings.length)
    feedback.push(`Rules fire too often on seed ${seedList(droppedFirings)}: firings past the ${BLUEPRINT_STEP_BUDGETS.ruleFirings} a step were dropped. Add a cooldownSec, an every or a chance to the busiest rule.`);
  if (full.length) feedback.push(`The arena filled up (${BLUEPRINT_BALL_CEILING} balls: ARENA FULL) on seed ${seedList(full)}. Spawn or split less, or end the run earlier with a ball-count finish below ${BLUEPRINT_BALL_CEILING}.`);
  if (quiet.length) feedback.push(`It is too quiet: the median seed plays fewer than ${PLAYABLE_MIN_SOUNDS} sounds (seed ${seedList(quiet)}). Give the hits a voice (sound.voices) or add sound actions.`);
  if (still.length) feedback.push(`Nothing moves within the first ${PLAYABLE_FIRST_MOTION_SEC} s on seed ${seedList(still)}: give a spawner a speed and a startSec of 0, or the arena gravity.`);

  const broken = faults.length + nan.length + droppedEvents.length + droppedFirings.length + full.length + quiet.length + still.length > 0;
  let verdict: PlayabilityVerdict;
  if (!broken && byCondition.length === 0) {
    verdict = "endless";
    feedback.push(
      bp.finish.any.length
        ? `It never ends by itself: every seed ran into the ${bp.finish.timeoutSec} s timeout before ${bp.finish.any.map((c) => c.when).join(" or ")}. Make the finish easier to reach (fewer tiles or rings, a wider exit, a lower count) or give it more time.`
        : `It never ends by itself: there is no finish condition, so every seed runs into the ${bp.finish.timeoutSec} s timeout. Add one to finish.any (escaped, tilesCleared, ringsCleared, count, tier or teamsLeft).`,
    );
  } else {
    const fewEnd = byCondition.length < need;
    const short = med < PLAYABLE_MIN_SEC;
    const long = med >= bp.finish.timeoutSec;
    if (fewEnd)
      feedback.push(
        `Only ${byCondition.length} of ${n} seeds end by a finish condition (at least ${need} should): the others ran into the ${bp.finish.timeoutSec} s timeout. Make the finish easier to reach, or give it more time.`,
      );
    if (short) feedback.push(`It ends after a median ${med} s: too quick for a clip. Aim for ${PLAYABLE_MIN_SEC} s or more – slower balls, more tiles, a narrower exit, a higher count.`);
    if (long && !fewEnd) feedback.push(`The median end (${med} s) is at the timeout: most runs only just make it. Make the finish a little easier to reach.`);
    verdict = broken || fewEnd || short || long ? "broken" : "playable";
  }
  if (verdict === "playable") {
    const ends = [...new Set(byCondition.map((r) => r.condition))].map((i) => `"${bp.finish.any[i].say || DEFAULT_SAY[bp.finish.any[i].when]}" (${bp.finish.any[i].when})`);
    feedback.unshift(`Playable: it ends by ${ends.join(" or ")} after a median ${med} s, on ${byCondition.length} of ${n} seeds.`);
  }
  return { verdict, feedback, seeds: reports, finishedByCondition: byCondition.length, medianFinishSec: med };
}
