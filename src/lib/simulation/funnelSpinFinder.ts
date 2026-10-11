import { FS_ENTRY_AT, ceilSteps, funnelDescentSteps, funnelStepTiming, wavesForRun } from "@/lib/physics/funnelSpin";
import { resolveVortexSettings } from "@/lib/physics/modes/vortex";
import type { FinderRequest, FinderResult } from "./finder";

/*
 * --- funnel-spin --- Find Simulation in the Sound Vortex's ring release (lib/physics/funnelSpin.ts): **ring-on-bar** – the last
 * ring vanishes into the hole on a bar line of the song (`outcome.atSec` is the bar's length at the Sound section's BPM, within
 * `toleranceSec`, ±20 ms by default). A ring run does not depend on the seed (the seed only turns the rings and picks the bed's
 * chords), so the search is over the settings that time it, without simulating a run: the wave interval (the last ring is
 * released (K − 1)·interval in) and the spin friction (it sets the descent). Each candidate's descent is integrated exactly as a
 * run integrates it, on the engine's 60 Hz steps (`funnelDescentSteps()`), so the vanish found is the run's to the step.
 *
 * With two waves or more the friction is kept and the interval solved for the nearest bar lines; when no interval of the
 * friction lands within the tolerance (or a single ring), the friction is searched around its value too. The candidate that
 * changes the settings least wins. The clip: whole cycles of the run (the refill included), at least one.
 */

/** The engine's step (s). */
export const FS_FINDER_STEP_SEC = 1 / 60;
/** How close (s) the vanish must land to the bar line by default. */
export const FS_FINDER_TOLERANCE_SEC = 0.02;
/** Friction candidates a search tests at most. */
export const FS_FINDER_FRICTION_TRIES = 240;

/** What a ring-on-bar search found. */
export interface FunnelSpinFound {
  /** The wave interval (s) and the spin friction (1/s) found. */
  interval: number;
  friction: number;
  /** When the last ring vanishes (s into the cycle), the bars it is, and how far off the bar line it lands (ms). */
  vanishSec: number;
  bars: number;
  offsetMs: number;
  /** The cycle (s) and the whole cycles in the clip. */
  cycleSec: number;
  loops: number;
}

interface Candidate {
  interval: number;
  friction: number;
  vanishSec: number;
  bars: number;
  offset: number;
  cost: number;
}

/** A value on the URL's grid (six decimals). */
function micro(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The interval that puts the last of `waves` rings' vanish (a descent of `descentSec`) nearest `bars` bars of `barSec`; null when it would be negative. */
function intervalFor(waves: number, descentSec: number, bars: number, barSec: number): number | null {
  if (waves < 2) return null;
  const interval = (bars * barSec - descentSec) / (waves - 1);
  return interval >= 0 ? interval : null;
}

/** The search (see the file's comment); `base` seeds the run (the clock by default: the seed only turns the rings and the bed). */
export function findFunnelSpinRun(request: Pick<FinderRequest, "targetDurationSec" | "modeSettings" | "outcome">, base = Date.now() | 0): FinderResult {
  const s = resolveVortexSettings(request.modeSettings.vortex);
  const fail = (tested: number): FinderResult => ({ found: false, seed: base, duration: 0, seedsTested: tested, outcome: "ring-on-bar", finished: false });
  if (s.release !== "rings") return fail(0);
  const step = FS_FINDER_STEP_SEC;
  const bar = request.outcome?.atSec && request.outcome.atSec > 0 ? request.outcome.atSec : 2;
  const tol = request.outcome?.toleranceSec && request.outcome.toleranceSec > 0 ? request.outcome.toleranceSec : FS_FINDER_TOLERANCE_SEC;
  const target = Number.isFinite(request.targetDurationSec) && request.targetDurationSec > 0 ? request.targetDurationSec : 30;
  const waves = wavesForRun(s.waves).length;
  const i0 = Math.max(0, s.waveInterval);
  const k0 = s.spinFriction > 0 ? s.spinFriction : 0.02;
  let best: Candidate | null = null;
  let tested = 0;
  const consider = (rawFriction: number) => {
    // (values on the URL's grid of a millionth, so the run a link replays is the one found)
    const friction = micro(rawFriction);
    if (!(friction > 0)) return;
    const steps = funnelDescentSteps(s.holeSize, friction, s.firstLap, step);
    tested++;
    if (!Number.isFinite(steps) || steps <= 0) return;
    const descent = steps * step;
    const now = ceilSteps(Math.max(0, waves - 1) * i0, step) + descent;
    const m0 = Math.max(1, Math.round(now / bar));
    for (let m = Math.max(1, m0 - 3); m <= m0 + 3; m++) {
      const solved = waves >= 2 ? intervalFor(waves, descent, m, bar) : i0;
      if (solved === null) continue;
      for (const interval of waves >= 2 ? [micro(solved), Math.floor(solved * 1e6) / 1e6, Math.ceil(solved * 1e6) / 1e6] : [i0]) {
        if (interval < 0) continue;
        const vanish = ceilSteps(Math.max(0, waves - 1) * interval, step) + descent;
        const offset = vanish - m * bar;
        if (Math.abs(offset) > tol + 1e-9) continue;
        const cost = Math.abs(interval - i0) / Math.max(0.5, i0) + Math.abs(friction - k0) / k0 + Math.abs(offset) * 1e-3;
        if (!best || cost < best.cost - 1e-12) best = { interval, friction, vanishSec: vanish, bars: m, offset, cost };
      }
    }
  };
  consider(k0);
  // the friction searched around its value (the bar count's analytic friction first, then a widening ladder), until found
  if (!best || waves < 2) {
    const hole = s.holeSize / 100;
    const descent0 = funnelDescentSteps(s.holeSize, k0, s.firstLap, step) * step;
    const lead = ceilSteps(Math.max(0, waves - 1) * i0, step);
    if (Number.isFinite(descent0) && FS_ENTRY_AT > hole) {
      const m0 = Math.max(1, Math.round((lead + descent0) / bar));
      for (let m = Math.max(1, m0 - 2); m <= m0 + 2 && tested < FS_FINDER_FRICTION_TRIES; m++) {
        const want = m * bar - lead;
        if (!(want > 0)) continue;
        const guess = (k0 * descent0) / want;
        for (let j = 0; j < 24 && tested < FS_FINDER_FRICTION_TRIES; j++) {
          const sign = j % 2 === 0 ? 1 : -1;
          consider(guess * (1 + sign * Math.ceil(j / 2) * 0.0005));
        }
      }
    }
  }
  if (!best) return fail(tested);
  const found: Candidate = best;
  const { interval, friction } = found;
  const timing = funnelStepTiming(waves, interval, s.holeSize, friction, s.firstLap, s.refillGap, step);
  const cycle = timing.cycleSec;
  const loops = Number.isFinite(cycle) && cycle > 0 ? Math.max(1, Math.floor(target / cycle + 1e-9)) : 1;
  return {
    found: true,
    seed: base,
    duration: Number.isFinite(cycle) ? loops * cycle : found.vanishSec,
    seedsTested: tested,
    outcome: "ring-on-bar",
    finished: !s.loop,
    funnelSpin: { interval, friction, vanishSec: timing.vanishSec, bars: found.bars, offsetMs: Math.round(1000 * (timing.vanishSec - found.bars * bar) * 10) / 10, cycleSec: cycle, loops },
  };
}
