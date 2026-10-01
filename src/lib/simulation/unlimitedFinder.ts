/**
 * --- unlimited --- Find Simulation for No limits runs: the same run-length search, respecting the frame budget.
 *
 * A heavy run (a crowd of hundreds of thousands, a thousand rings, a ball crawling at 1e-5 real time) can cost tens of
 * milliseconds a step, and one candidate seed is thousands of steps – the plain search, which simulates a batch of whole
 * seeds per animation frame, would freeze the page. This search time-slices instead: every frame it runs whole steps of
 * the current candidate until `FINDER_FRAME_BUDGET_MS` is spent, then yields, and carries on next frame (a step is never
 * cut, so every candidate plays exactly as the page will replay it). It measures what a step costs on the first
 * candidate and, when all of them would take more than `FINDER_TIME_BUDGET_MS`, tests fewer seeds (at least
 * `FINDER_MIN_SEEDS`) and says so (`limitedSeeds` in the result).
 *
 * Everything that is not a plain run-length search (outcomes, count targets, endless or fixed-length runs, Beat Drop) –
 * and every run with the switch off – goes to `findSimulation()` unchanged.
 */
import type { PhysicsEngine } from "@/lib/physics/engine";
import { createEngineForSettings, findSimulation, runNeverFinishes, type FinderProgress, type FinderRequest, type FinderResult } from "./finder";

/** Wall-clock ms the search simulates per animation frame. */
export const FINDER_FRAME_BUDGET_MS = 12;
/** Wall-clock ms a heavy search may take in all before it tests fewer seeds. */
export const FINDER_TIME_BUDGET_MS = 60_000;
/** Fewest seeds a limited search still tests. */
export const FINDER_MIN_SEEDS = 3;
/** Steps a candidate must run before its cost per step is trusted. */
const COST_SAMPLE_STEPS = 30;

/** True when the budgeted search takes this request (No limits on, a plain run-length search). */
export function usesBudgetedSearch(request: FinderRequest): boolean {
  if (request.physicsConfig.unlimited !== true) return false;
  if (request.outcome && request.outcome.kind !== "duration") return false;
  if (request.mode === "beatDrop" || request.mode === "multipliers") return false;
  return !runNeverFinishes(request.mode, request.modeSettings);
}

/** How many seeds fit the time budget at `stepMs` a step and `stepsPerSeed` steps a seed (at least FINDER_MIN_SEEDS, at most `maxSeeds`). */
export function seedsWithinBudget(maxSeeds: number, stepMs: number, stepsPerSeed: number, budgetMs = FINDER_TIME_BUDGET_MS): number {
  if (!(stepMs > 0) || !(stepsPerSeed > 0)) return maxSeeds;
  const fit = Math.floor(budgetMs / (stepMs * stepsPerSeed));
  return Math.max(Math.min(FINDER_MIN_SEEDS, maxSeeds), Math.min(maxSeeds, fit));
}

type Schedule = (fn: () => void) => void;

const nextFrame: Schedule = (fn) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
};

/**
 * The run-length search of `findSimulation()`, time-sliced by whole steps. `now` and `schedule` are the clock and the
 * frame scheduler (injectable for tests).
 */
export function findSimulationBudgeted(
  request: FinderRequest,
  onProgress: (p: FinderProgress) => void,
  signal?: AbortSignal,
  now: () => number = () => performance.now(),
  schedule: Schedule = nextFrame,
): Promise<FinderResult> {
  if (!usesBudgetedSearch(request)) return findSimulation(request, onProgress, signal);
  return new Promise((resolve) => {
    const targetMs = request.targetDurationSec * 1000;
    const toleranceMs = request.toleranceSec * 1000;
    const maxSimMs = request.maxSimTimeSec * 1000;
    const step = 1000 / 60;
    const stepsPerSeed = Math.ceil(maxSimMs / step);
    const base = Date.now() | 0;
    const seedAt = (i: number) => (base + 0x9e3779b1 * i) | 0;
    let maxSeeds = request.maxSeeds;
    let limited = false;
    let tested = 0;
    let best = { seed: 0, durationMs: Infinity, diff: Infinity };
    let engine: PhysicsEngine | null = null;
    let seed = 0;
    let elapsed = 0;
    let stepsTimed = 0;
    let timeSpent = 0;
    let unfinished = 0; // --- uncap-all --- seeds that ran to the horizon without ending
    const result = (found: boolean, s: number, durationMs: number): FinderResult => ({
      found,
      seed: s,
      duration: Number.isFinite(durationMs) ? durationMs / 1000 : 0,
      seedsTested: tested,
      ...(limited ? { limitedSeeds: maxSeeds } : {}),
      ...(!found && tested > 0 && unfinished === tested ? { neverEnded: true } : {}), // --- uncap-all --- (a run that never ends says so)
    });
    const finishSeed = (durationMs: number): boolean => {
      tested++;
      if (durationMs >= maxSimMs) unfinished++; // --- uncap-all ---
      const diff = Math.abs(durationMs - targetMs);
      if (diff < best.diff) best = { seed, durationMs, diff };
      engine = null;
      if (diff <= toleranceMs) {
        resolve(result(true, seed, durationMs));
        return true;
      }
      return false;
    };
    const run = () => {
      if (signal?.aborted) {
        resolve(result(false, best.seed, best.durationMs));
        return;
      }
      const start = now();
      while (now() - start < FINDER_FRAME_BUDGET_MS) {
        if (!engine) {
          if (tested >= maxSeeds) break;
          seed = seedAt(tested);
          engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
          elapsed = 0;
        }
        const t0 = now();
        engine.update(step, 0);
        engine.consumeSoundEvents();
        elapsed += step;
        stepsTimed++;
        timeSpent += now() - t0;
        // Once the cost of a step is known, a heavy run tests fewer seeds (and says so).
        if (!limited && stepsTimed === COST_SAMPLE_STEPS) {
          const fit = seedsWithinBudget(maxSeeds, timeSpent / stepsTimed, stepsPerSeed);
          if (fit < maxSeeds) {
            maxSeeds = fit;
            limited = true;
          }
        }
        const done = engine.isSimulationFinished();
        if (done || elapsed >= maxSimMs) {
          if (finishSeed(done ? elapsed : maxSimMs)) return;
        }
      }
      onProgress({ seedsTested: tested, maxSeeds, currentSeed: engine ? seed : seedAt(Math.max(0, tested - 1)), bestDuration: Number.isFinite(best.durationMs) ? best.durationMs / 1000 : 0, bestSeed: best.seed });
      if (!engine && tested >= maxSeeds) resolve(result(false, best.seed, best.durationMs));
      else schedule(run);
    };
    schedule(run);
  });
}
