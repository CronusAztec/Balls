import type { BrickRebuildView } from "@/lib/physics/modes/brickRebuild";
import { barLineDistanceMs, barSeconds, type FinderOutcome } from "./outcomes";
import type { FinderProgress, FinderRequest, FinderResult } from "./finder";

/*
 * --- brick-rebuild --- Find Simulation in Brick Smash (lib/physics/modes/brickRebuild.ts). The run loops forever (smash, settle,
 * rebuild, again), so the search is over its first smash, seed by seed, each seed's engine stepped headlessly until the smash
 * ends – 0 bricks, or its time limit – a slice of steps a frame (`FINDER_SLICE_MS`), so the page stays responsive and Cancel
 * lands within a frame:
 *
 * - **bricks-cleared-by**: the last brick falls within the chosen seconds (`atSec`);
 * - **last-brick-on-bar**: the last brick falls on a bar line of the Sound section's tempo (±20 ms, `atSec` is the bar), so the
 *   groove's payoff lands on a downbeat;
 * - **final-balls**: at least the chosen number of balls (`count`) are in play when the smash ends – the gold capsules' "from 3
 *   balls to 280".
 *
 * A found run's clip is its whole first cycle (the smash, the settle and the rebuild: the run's start again at its end), so Export
 * whole loops records exactly one loop. None found: the closest run tested is reported (not applied).
 */

/** Wall-clock ms a search may run a frame before it yields (a seed's run is stepped across frames). */
export const BR_FINDER_SLICE_MS = 30;
/** Seeds a search tests at most (each simulates a whole smash), and the wall-clock ms it may take in all. */
export const BR_FINDER_TRIES = 400;
export const BR_FINDER_BUDGET_MS = 60_000;
/** How close (s) the last brick has to fall to a bar line for last-brick-on-bar. */
export const BR_BAR_TOLERANCE_SEC = 0.02;

export const BR_FINDER_OUTCOMES = ["bricks-cleared-by", "last-brick-on-bar", "final-balls"] as const;
export type BrFinderOutcome = (typeof BR_FINDER_OUTCOMES)[number];

/** What a Brick Smash search found (or came closest to). */
export interface BrickRebuildFound {
  /** The first smash's clear (s; −1 when it ran out of time), the balls in play then, its distance from the nearest bar line (ms). */
  clearedSec: number;
  balls: number;
  barOffsetMs: number;
  /** The first cycle (s): the clip of a found run. */
  cycleSec: number;
}

/** The engine the search steps (a headless one per seed: `createEngineForSettings()`). */
export interface BrickRebuildFinderEngine {
  update(frameMs: number, audioIntensity: number): void;
  consumeSoundEvents(): unknown;
  getBrickRebuildView(): BrickRebuildView;
}

/** The first smash of a run, summed up (−1 clear: it ran out of time). */
export interface BrickRebuildRun {
  clearedMs: number;
  balls: number;
  cycleMs: number;
}

/** Steps a fresh run until its first smash ends (or `maxMs` of simulation); null while it goes on. */
export function brickRebuildRunOf(view: BrickRebuildView): BrickRebuildRun | null {
  if (view.firstEnd === "") return null;
  return { clearedMs: view.firstClearSec >= 0 ? 1000 * view.firstClearSec : -1, balls: view.firstBalls, cycleMs: view.nextSeamMs >= 0 ? view.nextSeamMs : 0 };
}

/** The outcome's bar (s): `atSec` when the page gave one, else a bar of four beats at 120 BPM. */
function barMsOf(outcome: Pick<FinderOutcome, "atSec">): number {
  return 1000 * (outcome.atSec !== undefined && outcome.atSec > 0 ? outcome.atSec : barSeconds(120));
}

/** Whether a run achieved `outcome`. */
export function brickRebuildMatches(outcome: Pick<FinderOutcome, "kind" | "atSec" | "count" | "toleranceSec">, run: BrickRebuildRun): boolean {
  switch (outcome.kind) {
    case "bricks-cleared-by":
      return run.clearedMs >= 0 && run.clearedMs <= 1000 * (outcome.atSec ?? 0) + 1e-6;
    case "last-brick-on-bar": {
      const barMs = barMsOf(outcome);
      const tolMs = 1000 * (outcome.toleranceSec ?? BR_BAR_TOLERANCE_SEC);
      return run.clearedMs >= barMs - tolMs && barLineDistanceMs(run.clearedMs, barMs) <= tolMs + 1e-6;
    }
    case "final-balls":
      return run.balls >= Math.max(1, Math.round(outcome.count ?? 1));
    default:
      return false;
  }
}

/** How far a run missed `outcome` (lower is better; 0 for a match): seconds past the limit / off the bar line, balls short. */
export function brickRebuildMiss(outcome: Pick<FinderOutcome, "kind" | "atSec" | "count" | "toleranceSec">, run: BrickRebuildRun): number {
  if (brickRebuildMatches(outcome, run)) return 0;
  switch (outcome.kind) {
    case "bricks-cleared-by":
      return run.clearedMs < 0 ? Infinity : run.clearedMs / 1000 - (outcome.atSec ?? 0);
    case "last-brick-on-bar":
      return run.clearedMs < 0 ? Infinity : barLineDistanceMs(run.clearedMs, barMsOf(outcome)) / 1000;
    case "final-balls":
      return Math.max(0, Math.round(outcome.count ?? 1) - run.balls);
    default:
      return Infinity;
  }
}

/** The found (or closest) run's figures for the page. */
export function brickRebuildFound(outcome: Pick<FinderOutcome, "atSec">, run: BrickRebuildRun): BrickRebuildFound {
  return { clearedSec: run.clearedMs >= 0 ? run.clearedMs / 1000 : -1, balls: run.balls, barOffsetMs: run.clearedMs >= 0 ? barLineDistanceMs(run.clearedMs, barMsOf(outcome)) : -1, cycleSec: run.cycleMs / 1000 };
}

/**
 * The search (see the file's comment): seeds `seedAt(0)`, `seedAt(1)`… (the page's seed order from `base`), each run stepped
 * until its smash ends or `horizonSec` of simulation, a slice a frame. `makeEngine(seed)` builds the page's run for a seed.
 */
export function findBrickRebuildRun(
  request: Pick<FinderRequest, "maxSeeds" | "outcome">,
  horizonSec: number,
  makeEngine: (seed: number) => BrickRebuildFinderEngine,
  onProgress: (p: FinderProgress) => void,
  signal?: AbortSignal,
  now: () => number = () => performance.now(),
  schedule: (fn: () => void) => void = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => fn()) : setTimeout(fn, 0)),
  base: number = Date.now() | 0,
): Promise<FinderResult> {
  const outcome = request.outcome ?? { kind: "bricks-cleared-by" as const, clipSec: 30, atSec: 20 };
  const kind = (BR_FINDER_OUTCOMES as readonly string[]).includes(outcome.kind) ? outcome.kind : "bricks-cleared-by";
  const rule = { ...outcome, kind };
  const tries = Math.max(1, Math.min(Math.floor(request.maxSeeds) || BR_FINDER_TRIES, BR_FINDER_TRIES));
  const seedAt = (i: number) => (base + 0x9e3779b1 * i) | 0;
  const step = 1000 / 60;
  const horizonMs = Math.max(step, 1000 * horizonSec);
  const began = now();
  return new Promise((resolve) => {
    let tested = 0;
    let engine: BrickRebuildFinderEngine | null = null;
    let simMs = 0;
    let best: { seed: number; run: BrickRebuildRun; miss: number } | null = null;
    const finish = (found: { seed: number; run: BrickRebuildRun } | null) => {
      const pick = found ?? best;
      const run = pick?.run ?? { clearedMs: -1, balls: 0, cycleMs: 0 };
      resolve({
        found: !!found,
        seed: pick?.seed ?? seedAt(0),
        duration: found ? run.cycleMs / 1000 : run.clearedMs >= 0 ? run.clearedMs / 1000 : 0,
        seedsTested: tested,
        outcome: kind as FinderResult["outcome"],
        finished: false,
        brickRebuild: brickRebuildFound(rule, run),
      });
    };
    const slice = () => {
      if (signal?.aborted) {
        finish(null);
        return;
      }
      const start = now();
      while (now() - start < BR_FINDER_SLICE_MS) {
        if (!engine) {
          engine = makeEngine(seedAt(tested));
          simMs = 0;
        }
        // a few steps at a time (the clock is read between them)
        for (let k = 0; k < 6 && simMs < horizonMs; k++) {
          engine.update(step, 0);
          engine.consumeSoundEvents();
          simMs += step;
          if (engine.getBrickRebuildView().firstEnd !== "") break;
        }
        const run = brickRebuildRunOf(engine.getBrickRebuildView()) ?? (simMs >= horizonMs ? { clearedMs: -1, balls: engine.getBrickRebuildView().balls, cycleMs: 0 } : null);
        if (!run) continue;
        const seed = seedAt(tested);
        tested++;
        engine = null;
        if (brickRebuildMatches(rule, run)) {
          finish({ seed, run });
          return;
        }
        const miss = brickRebuildMiss(rule, run);
        if (!best || miss < best.miss) best = { seed, run, miss };
        if (tested >= tries || now() - began > BR_FINDER_BUDGET_MS) {
          finish(null);
          return;
        }
      }
      const b = best as { seed: number; run: BrickRebuildRun } | null;
      onProgress({ seedsTested: tested, maxSeeds: tries, currentSeed: seedAt(tested), bestDuration: b && b.run.clearedMs >= 0 ? b.run.clearedMs / 1000 : 0, bestSeed: b?.seed ?? 0 });
      schedule(slice);
    };
    schedule(slice);
  });
}
