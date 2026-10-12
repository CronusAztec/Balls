import { perfectFitBeatSec, resolvePerfectFitSettings, type PerfectFitSettings } from "@/lib/physics/perfectFit";
import { planPerfectFit, type PerfectFitPlan } from "./polyominoPlan";
import type { FinderRequest, FinderResult } from "./finder";

/*
 * --- perfect-fit --- Find Simulation in Perfect Fit (lib/simulation/polyominoPlan.ts). Every box ends exactly full by
 * construction, so there is no run length to search: the solution seed only picks the tilings and their drop orders. The two
 * outcomes, without simulating anything (a plan is computed per seed):
 *
 * - **most-on-floor** (the rectangles): of the solution seeds tested (PF_FINDER_TRIES at most), the one whose rectangles have
 *   the most pieces landing on the box's floor – found whenever a seed was tested; the page keeps it as the Solution seed.
 * - **landings-on-beat**: every landing on the beat of the page's tempo – the page turns Land on the beat on (each piece's slot
 *   becomes the power of two of beats nearest Seconds per piece, every completion whole beats, the loop whole bars); the seed is
 *   the page's.
 *
 * The clip is the whole loops of the run that fit the target (at least one).
 */

/** Solution seeds a "most on the floor" search tests at most (the page's seed count when it asks for fewer). */
export const PF_FINDER_TRIES = 24;

/** What a Perfect Fit search found. */
export interface PerfectFitFound {
  /** The solution seed (most-on-floor; 0: the page's own) and the pieces on the floor of all its rectangles, out of the pieces. */
  seed: number;
  floor: number;
  pieces: number;
  /** Every landing on the beat: the beat (s; 0 free timing). */
  beatSec: number;
  /** The loop (s) and the loops in the clip. */
  loopSec: number;
  loops: number;
}

/** The plan of `settings` with the solution seed `seed` (the mode's init does the same with its seed). */
export function perfectFitPlanOf(settings: PerfectFitSettings, seed: number): PerfectFitPlan {
  return planPerfectFit({ variant: settings.variant, boxes: settings.boxes, pieceSec: settings.pieceSec, sections: settings.sections, wellW: settings.wellW, wellH: settings.wellH, hold: settings.hold, beatSec: perfectFitBeatSec(settings), seed });
}

/** The search (see the file's comment); solution seeds from `base` up. */
export function findPerfectFitRun(request: Pick<FinderRequest, "targetDurationSec" | "maxSeeds" | "modeSettings" | "outcome">, base = 1): FinderResult {
  const s = resolvePerfectFitSettings(request.modeSettings.perfectFit);
  const target = Number.isFinite(request.targetDurationSec) && request.targetDurationSec > 0 ? request.targetDurationSec : 30;
  if (request.outcome?.kind === "most-on-floor") {
    const tries = Math.max(1, Math.min(Math.floor(request.maxSeeds) || PF_FINDER_TRIES, PF_FINDER_TRIES));
    let best: PerfectFitPlan | null = null;
    let bestSeed = base;
    for (let j = 0; j < tries; j++) {
      const plan = perfectFitPlanOf({ ...s, variant: "pento" }, base + j);
      if (!best || plan.floor > best.floor) {
        best = plan;
        bestSeed = base + j;
      }
    }
    const plan = best!;
    const loops = Math.max(1, Math.floor(target / plan.loopSec + 1e-9));
    return { found: plan.rects > 0, seed: bestSeed, duration: loops * plan.loopSec, seedsTested: tries, outcome: "most-on-floor", finished: false, perfectFit: { seed: bestSeed, floor: plan.floor, pieces: plan.pieceCount, beatSec: plan.beatSec, loopSec: plan.loopSec, loops } };
  }
  // every landing on the beat: the plan with the beat on (the page's tempo), its loop of whole bars
  const beat = { ...s, beat: true };
  const plan = perfectFitPlanOf(beat, s.seed > 0 ? s.seed : base);
  const loops = Math.max(1, Math.floor(target / plan.loopSec + 1e-9));
  return { found: plan.pieceCount > 0, seed: base, duration: loops * plan.loopSec, seedsTested: 1, outcome: "landings-on-beat", finished: false, perfectFit: { seed: 0, floor: plan.floor, pieces: plan.pieceCount, beatSec: plan.beatSec, loopSec: plan.loopSec, loops } };
}
