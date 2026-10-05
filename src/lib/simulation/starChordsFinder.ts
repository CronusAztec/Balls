import { SC_RANGES, cycleForClip, periodOf, resolveStarChordsSettings, searchStarSets, serializeStars } from "@/lib/physics/starChords";
import type { FinderRequest, FinderResult } from "./finder";

/*
 * --- chord-stars --- Find Simulation in Chord Stars (lib/physics/starChords.ts). "Every star closes within ε" holds by
 * construction – the speeds are set so that they all close on the same frame – so there is no seed to search for: the search
 * draws random star sets (distinct point counts, coprime steps; `randomStarSet()`, a seed a set), keeps the best-looking one
 * (`starSetScore()`: inner circles evenly spread, none a dot or a ring at the rim, about eight chords a ball) and fits the
 * drawing time to the clip in whole loops of drawing + hold + fade (`cycleForClip()`), as close to the page's as the clip
 * allows – so the found run's export is an exact loop of the clip's length.
 */

/** Star sets a search tests at most (the page's seed count when it asks for fewer). */
export const SC_FINDER_TRIES = 1000;
/** Star draws a search makes at most (a set of n balls is n draws): a run of thousands of balls tests fewer sets. */
export const SC_FINDER_WORK = 400_000;

/** What a Chord Stars search found: the stars (as stored), the drawing time, the loops in the clip and the set's score. */
export interface StarChordsFound {
  stars: string;
  cycleSec: number;
  loops: number;
  score: number;
}

/** The drawing time as the page keeps it: to the millisecond (a clean slider value and URL). */
function roundCycle(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/**
 * The search: `request.maxSeeds` star sets at most (fewer for a big run), drawn from seeds after `base` (the clock by default,
 * so every search finds another set), and the drawing time that fits `request.targetDurationSec` in whole loops. Found unless
 * not even one loop of the shortest drawing time fits the clip (`duration` is then that shortest loop).
 */
export function findStarChordsRun(request: Pick<FinderRequest, "targetDurationSec" | "maxSeeds" | "modeSettings">, base = Date.now() | 0): FinderResult {
  const s = resolveStarChordsSettings(request.modeSettings.starChords);
  const count = Math.max(1, s.balls);
  const tries = Math.max(1, Math.min(Math.max(1, Math.floor(request.maxSeeds) || SC_FINDER_TRIES), SC_FINDER_TRIES, Math.floor(SC_FINDER_WORK / count)));
  const best = searchStarSets(count, tries, (i) => (base + Math.imul(0x9e3779b1, i)) | 0);
  const stars = serializeStars(best.stars);
  const fit = cycleForClip(request.targetDurationSec, s.holdSec, s.fadeSec, s.cycleSec, SC_RANGES.scCycle.min);
  if (!fit) {
    const shortest = periodOf(SC_RANGES.scCycle.min, s.holdSec, s.fadeSec);
    return { found: false, seed: best.seed, duration: shortest, seedsTested: best.tested, outcome: "star-set", starChords: { stars, cycleSec: s.cycleSec, loops: 0, score: best.score } };
  }
  const cycleSec = Math.max(SC_RANGES.scCycle.min, roundCycle(fit.cycleSec));
  return { found: true, seed: best.seed, duration: request.targetDurationSec, seedsTested: best.tested, outcome: "star-set", finished: false, starChords: { stars, cycleSec, loops: fit.loops, score: best.score } };
}
