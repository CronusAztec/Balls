import { resolveBeatMachineSettings, type BeatMachineSettings } from "@/lib/physics/beatMachine";
import { buildPhrase, planBeatMachine, type BeatMachinePlan } from "./beatMachinePlan";
import type { FinderRequest, FinderResult } from "./finder";

/*
 * --- beat-machine --- Find Simulation in Beat Machines (lib/simulation/beatMachinePlan.ts). Every note lands on its beat by
 * construction, so there is no timing to search: the seed only writes the original phrase (the marbles' seeded tune). The two
 * outcomes search seeded phrases, without simulating anything – a plan is computed per seed:
 *
 * - **no-tube-conflict**: the first seed whose phrase every tube can play with the marbles it holds (Marbles per tube, one
 *   under auto): no marble is needed again before it is back, so no tube starts with a spare. None in the seeds tested: the
 *   seed with the fewest spares (not found).
 * - **most-in-flight**: of the seeds tested, the one whose phrase has the most marbles out of their tubes at once – the busiest
 *   machine (found whenever any seed was tested).
 *
 * The clip is the whole loops of the run that fit the target (at least one). A phrase that is not the original (a scale run, a
 * loaded melody, a typed list) is the same for every seed: one plan answers.
 */

/** Seeds a phrase search tests at most (the page's seed count when it asks for fewer). */
export const BM_FINDER_TRIES = 200;

/** What a Beat Machines search found. */
export interface BeatMachineFound {
  /** The phrase's spares (marbles added beyond the setting) and the tubes that needed one, the most marbles out at once. */
  spares: number;
  conflicts: number;
  inFlightMax: number;
  /** The loop (s), the loops in the clip and the notes a loop plays. */
  loopSec: number;
  loops: number;
  notes: number;
}

/** A plan of `settings` drawing its phrase from `random` (the mode's init does the same with the engine's seeded random). */
export function beatMachinePlanOf(settings: BeatMachineSettings, random: () => number): BeatMachinePlan {
  const phrase = buildPhrase({ variant: settings.variant, source: settings.source, slots: settings.variant === "stairs" ? settings.steps : settings.bars, loopBeats: settings.loopBeats, melody: settings.melody, custom: settings.notes, scale: settings.scale, root: settings.root }, random);
  return planBeatMachine({ variant: settings.variant, bpm: settings.bpm, steps: settings.steps, stepDxPct: settings.stepDx, stepDyPct: settings.stepDy, bars: settings.bars, dropPct: settings.dropPct, rebound: settings.rebound, perTube: settings.perTube, returnBeats: settings.returnBeats, loopBeats: settings.loopBeats, bass: settings.bass, phrase });
}

/**
 * The search (see the file's comment); seeds from `base` up (the page's seeds start at 1). `planOf` is the plan a seed's run
 * plays – the finder builds a headless engine for it (`createEngineForSettings()`), so the answer is exactly the page's run.
 */
export function findBeatMachineRun(request: Pick<FinderRequest, "targetDurationSec" | "maxSeeds" | "modeSettings" | "outcome">, planOf: (seed: number) => BeatMachinePlan, base = 1): FinderResult {
  const s = resolveBeatMachineSettings(request.modeSettings.beatMachine);
  const kind = request.outcome?.kind === "most-in-flight" ? "most-in-flight" : "no-tube-conflict";
  const target = Number.isFinite(request.targetDurationSec) && request.targetDurationSec > 0 ? request.targetDurationSec : 30;
  const seeded = s.source === "original" || (s.source === "melody" && s.melody.length === 0) || (s.source === "custom" && !/\S/.test(s.notes));
  const tries = seeded ? Math.max(1, Math.min(Math.floor(request.maxSeeds) || BM_FINDER_TRIES, BM_FINDER_TRIES)) : 1;
  let bestSeed = base;
  let best: BeatMachinePlan | null = null;
  let tested = 0;
  for (let j = 0; j < tries; j++) {
    const seed = base + j;
    const plan = planOf(seed);
    tested++;
    const better = !best || (kind === "most-in-flight" ? plan.inFlightMax > best.inFlightMax : plan.spares < best.spares);
    if (better) {
      best = plan;
      bestSeed = seed;
    }
    if (kind === "no-tube-conflict" && plan.spares === 0) break;
  }
  const plan = best!;
  const loops = Math.max(1, Math.floor(target / plan.loopSec + 1e-9));
  const found = kind === "most-in-flight" ? tested > 0 : plan.spares === 0;
  return {
    found,
    seed: bestSeed,
    duration: loops * plan.loopSec,
    seedsTested: tested,
    outcome: kind,
    finished: false,
    beatMachine: { spares: plan.spares, conflicts: plan.conflicts, inFlightMax: plan.inFlightMax, loopSec: plan.loopSec, loops, notes: plan.notes.length },
  };
}
