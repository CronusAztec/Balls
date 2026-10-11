import {
  EF_BALL_SCALE,
  EF_COLLAPSE_HORIZON,
  EF_RANGES,
  EF_SAFE_RADIUS,
  collapsePasses,
  efLoopSeconds,
  launchAngles,
  resolveEllipseFociSettings,
} from "@/lib/physics/ellipseFoci";
import type { FinderRequest, FinderResult } from "./finder";

/*
 * --- ellipse-foci --- Find Simulation in Focus Shot (lib/physics/ellipseFoci.ts). Every volley converges on time by construction
 * (the focal property; the speed is 2a / T), so there is no seed to search for a run length – the seed only picks the colours
 * and the bed's chords. The two outcomes search the settings instead, without simulating a seed:
 *
 * - **converge-on-beat**: every convergence on a bar line of the song – the transit becomes the whole number of bars of the
 *   page's tempo (`outcome.atSec` is a bar's length) nearest the page's transit, T = bars × 4 × 60 / BPM, and the clip the whole
 *   loops of it that fit the target (at least one); the run's seed is the search's (new colours every search).
 * - **longest-collapse**: the start angle, within one step of the volley, whose swarm takes the most passes to narrow under two
 *   ball radii (`collapsePasses()` over EF_COLLAPSE_HORIZON passes; a ball fired nearly at the other focus swings out late, so
 *   the answer tends toward the long axis). The run found is left to collapse (the page sets At a convergence to Collapse) and
 *   its clip is those passes and one more – the comet. A circle never collapses: nothing is found.
 */

/** Start angles a collapse search tests at most (the page's seed count when it asks for fewer). */
export const EF_FINDER_TRIES = 90;
/** Focal passes a collapse search computes at most (balls × passes × angles): a volley of thousands tests fewer angles. */
export const EF_FINDER_WORK = 2_000_000;

/** What a Focus Shot search found. */
export interface EllipseFociFound {
  /** The transit (s) – on the beat a whole number of bars – the bars in it (0: not on the beat), the loop and the loops in the clip. */
  transitSec: number;
  bars: number;
  loopSec: number;
  loops: number;
  /** The start angle (°) and the passes until the swarm narrowed under two ball radii (−1: not within the horizon). */
  aimDeg: number;
  collapse: number;
}

/** The transit of a whole number of `barSec` bars nearest `transitSec` (at least one bar). */
export function transitOnBeat(transitSec: number, barSec: number): { transitSec: number; bars: number } {
  const bar = Number.isFinite(barSec) && barSec > 0 ? barSec : 2;
  const bars = Math.max(1, Math.round((Number.isFinite(transitSec) ? transitSec : 4) / bar));
  return { transitSec: Math.max(EF_RANGES.efTransit.min, bars * bar), bars };
}

/** The search (see the file's comment); `base` seeds the found run (the clock by default, so every search colours it anew). */
export function findEllipseFociRun(request: Pick<FinderRequest, "targetDurationSec" | "maxSeeds" | "modeSettings" | "outcome" | "physicsConfig">, base = Date.now() | 0): FinderResult {
  const s = resolveEllipseFociSettings(request.modeSettings.ellipseFoci);
  const kind = request.outcome?.kind ?? "converge-on-beat";
  const target = Number.isFinite(request.targetDurationSec) && request.targetDurationSec > 0 ? request.targetDurationSec : 30;
  if (kind !== "longest-collapse") {
    const beat = transitOnBeat(s.transitSec, request.outcome?.atSec ?? 2);
    const loopSec = efLoopSeconds(s.reset, s.passes, beat.transitSec) ?? s.passes * beat.transitSec;
    const loops = Math.max(1, Math.floor(target / loopSec + 1e-9));
    return {
      found: true,
      seed: base,
      duration: loops * loopSec,
      seedsTested: 1,
      outcome: "converge-on-beat",
      finished: false,
      ellipseFoci: { transitSec: beat.transitSec, bars: beat.bars, loopSec, loops, aimDeg: s.aimDeg, collapse: -1 },
    };
  }
  // the start angle within one step of the volley: a full turn's 360 / n, a fan's spread / (n − 1), one ball's whole turn
  const count = Math.max(1, s.count);
  const full = s.spreadDeg >= 360;
  const step = full ? s.spreadDeg / count : count > 1 ? s.spreadDeg / (count - 1) : 360;
  const tries = Math.max(1, Math.min(Math.max(1, Math.floor(request.maxSeeds) || EF_FINDER_TRIES), EF_FINDER_TRIES, Math.floor(EF_FINDER_WORK / (count * EF_COLLAPSE_HORIZON))));
  const cfg = request.physicsConfig;
  const unit = (s.sizePct / 100) * EF_SAFE_RADIUS * Math.min(cfg.width || 800, cfg.height || 450);
  const limit = (2 * Math.max(0.5, (cfg.ballRadius || 8) * EF_BALL_SCALE)) / Math.max(1e-9, unit);
  const angles = new Float64Array(count);
  let bestAim = s.aimDeg;
  let best = -2;
  for (let j = 0; j < tries; j++) {
    const aim = s.aimDeg + (j * step) / tries;
    launchAngles(count, s.spreadDeg, aim, angles);
    const passes = collapsePasses(s.eccentricity, s.launch, angles, limit, EF_COLLAPSE_HORIZON);
    if (passes > best) {
      best = passes;
      bestAim = aim;
    }
  }
  const aimDeg = Math.round(((bestAim % 360) + 360) % 360 * 1000) / 1000;
  const loopSec = efLoopSeconds(s.reset, s.passes, s.transitSec) ?? s.passes * s.transitSec;
  const found = best >= 0;
  return {
    found,
    seed: base,
    duration: found ? (Math.max(1, best) + 1) * s.transitSec : 0,
    seedsTested: tries,
    outcome: "longest-collapse",
    finished: false,
    ellipseFoci: { transitSec: s.transitSec, bars: 0, loopSec, loops: Math.max(1, Math.floor(target / loopSec + 1e-9)), aimDeg, collapse: best },
  };
}
