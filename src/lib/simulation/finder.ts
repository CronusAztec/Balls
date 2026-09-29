import { PhysicsEngine } from "@/lib/physics/engine";
import { resolvePhysicsExtras } from "@/lib/physics/extras";
import type { BoxSettings, DropSettings, PendulumSettings } from "@/lib/physics/modes";
import { resolveBoxSettings } from "@/lib/physics/modes/box";
import { resolveDropSettings } from "@/lib/physics/modes/drop";
import { resolvePendulumSettings } from "@/lib/physics/modes/pendulum";
// --- jdm-polyrhythm ---
import { polyrhythmCycleSeconds, resolvePolyrhythmSettings, type PolyrhythmSettings } from "@/lib/physics/modes/polyrhythm";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";
// --- jdm-collisions ---
import type { CollideSettings } from "@/lib/physics/modes/collide";
// --- boris-glass ---
import type { GlassSettings } from "@/lib/physics/modes/glass";
// --- boris-multipliers ---
import { countTolerance, resolveMultipliersSettings, type MultipliersSettings } from "@/lib/physics/modes/multipliers";
// --- rigged ---
import { startBallCount } from "@/lib/physics/ballStats";
import { rigNeverFinishes } from "@/lib/physics/rigged";
import { outcomeClipSec, outcomeFigure, outcomeHorizonMs, outcomeMatches, outcomeMiss, outcomeSettled, winnerNeedsEnd, type FinderOutcome, type FinderOutcomeKind, type RunSummary } from "./outcomes";
// --- jdm-double-pendulum ---
import { resolveDoublePendulumSettings, type DoublePendulumSettings } from "@/lib/physics/modes/doublePendulum";
// --- jdm-illusions ---
import { illusionFixedDurationSec, illusionRunNeverFinishes, type IllusionSettings } from "@/lib/physics/modes/illusion";
// --- odd-string-battle ---
import type { StringBattleSettings } from "@/lib/physics/modes/stringBattle";
// --- odd-power-layers ---
import { powerLayersFixedDurationSec, type PowerLayersSettings } from "@/lib/physics/modes/powerLayers";
// --- jdm-race ---
import type { RaceSettings } from "@/lib/physics/modes/race";
// --- jdm-arena-games ---
import type { BattleSettings, CtfSettings } from "@/lib/physics/modes/arenaGames";

/**
 * Headless seed search: simulates candidate seeds with the current settings until one
 * finishes within `toleranceSec` of the target duration. Runs in batches on
 * requestAnimationFrame so the UI stays responsive, and can be cancelled with an AbortSignal.
 */

export interface ModeSettings {
  bouncierEnabled: boolean;
  countdownTotal: number;
  countdownRandom: boolean;
  colorMatchColorCount: number;
  accumulationTimerMax: number;
  spikesEnabled: boolean;
  spikeCount: number;
  multiplySpawnCount: number;
  shatterSegmentsPerWall: number;
  shatterHpPerSegment: number;
  growRate: number;
  portalCount: number;
  twoBalls: boolean;
  /** Ball Drop: ball count, size / gravity spread, rows, release interval and rain (see modes/drop.ts). */
  drop: Partial<DropSettings>;
  /** Bouncing Shapes: shape count / kind, box aspect, gravity, countdown, growth and speed ratio (see modes/box.ts). */
  box: Partial<BoxSettings>;
  /** Pendulum Wave: count, tuning, layout, sound and cycles (see modes/pendulum.ts); the defaults when left out. */
  pendulum?: Partial<PendulumSettings>;
  // --- jdm-polyrhythm ---
  /** Metronomes & Polyrhythms: voices, tempo series, cycle and cycles (see modes/polyrhythm.ts); the defaults when left out. */
  polyrhythm?: Partial<PolyrhythmSettings>;
  // --- jdm-collisions ---
  /** Collision Playground: count, sizes, container, gravity, restitution and the variants (see modes/collide.ts); the defaults when left out. */
  collide?: Partial<CollideSettings>;
  // --- teams ---
  /** Balls the multi-ball modes start with (1–6, a team roster's size); overrides `twoBalls` when set. */
  ballCount?: number;
  // --- boris-glass ---
  /** Glass Smash: rows, hit points, stages, sliding panes and holes (see modes/glass.ts); the defaults when left out. Every run ends at HOME, so the finder searches it. */
  glass?: Partial<GlassSettings>;
  // --- boris-multipliers ---
  /** Multipliers board: rows, gate mix, start balls, ball cap and the count target (see modes/multipliers.ts); the defaults when left out. */
  multipliers?: Partial<MultipliersSettings>;
  // --- jdm-double-pendulum ---
  /** Double Pendulum: rig, start, damping, strings, sparring and the end (clip length or endless; see modes/doublePendulum.ts); the defaults when left out. */
  doublePendulum?: Partial<DoublePendulumSettings>;
  // --- jdm-illusions ---
  /** Circle Illusion: type, counts, pattern, speed and cycles (see modes/illusion.ts); the defaults when left out. The whitespace type ends when its picture is revealed, so the finder searches it. */
  illusion?: Partial<IllusionSettings>;
  // --- odd-string-battle ---
  /** String Battle: balls, lives, threads, rule, clip limit and finale (see modes/stringBattle.ts); the defaults when left out. Every battle ends, so the finder searches it – by length or by winner. */
  stringBattle?: Partial<StringBattleSettings>;
  // --- odd-power-layers ---
  /** Power Layers: layers, sequence, drift and bounce speed (see modes/powerLayers.ts); the defaults when left out. Every run ends in freedom after hits × the bounce period. */
  powerLayers?: Partial<PowerLayersSettings>;
  // --- jdm-race ---
  /** Square Racing Grand Prix: racers, track length, laps, obstacle mix, the favourite and the cup (see modes/race.ts); the defaults when left out. Every race ends (a podium after the last racer home, or DNFs after a grace period), so the finder times it. */
  race?: Partial<RaceSettings>;
  // --- jdm-arena-games ---
  /**
   * Battle Royale and Capture the Flag (see modes/arenaGames.ts); the defaults when left out. A battle always ends with one
   * square standing and a capture-the-flag game on the score or at its time limit (`clipSeconds`), so the finder searches both.
   */
  battle?: Partial<BattleSettings>;
  ctf?: Partial<CtfSettings>;
}

// --- odd-string-battle ---
/** Seeds of the String Battle simulated per animation frame (a battle takes a few ms per simulated second). */
export const STRING_BATTLE_FINDER_BATCH = 6;

// --- jdm-race ---
/** Seeds of the race simulated per animation frame (a seed runs a whole race of up to 16 racers). */
export const RACE_FINDER_BATCH = 3;

// --- jdm-illusions ---
/** Seeds of the Circle Illusion simulated per animation frame (a whitespace seed paints a grid for tens of seconds). */
export const ILLUSION_FINDER_BATCH = 4;

/** Modes whose run never "finishes" (there is no escape to time), whatever the settings. */
export const ENDLESS_MODES: ModeId[] = ["multiply", "lines", "paint", "grow"];

/**
 * True when a run of `mode` with these settings can never finish, so there is no duration to search
 * for: the endless modes, Ball Drop while it rains, Bouncing Shapes with the countdown off and a Pendulum
 * Wave with the cycles set to never. The finder resolves at once with `endless` set instead of simulating,
 * and the page hides its button.
 */
export function runNeverFinishes(mode: ModeId, settings: Pick<ModeSettings, "drop" | "box" | "pendulum" | "polyrhythm" | "doublePendulum" | "illusion">): boolean {
  if (ENDLESS_MODES.includes(mode)) return true;
  // --- jdm-collisions --- the Collision Playground never finishes (there is no escape or end to time).
  if (mode === "collide") return true;
  if (mode === "drop") return resolveDropSettings(settings.drop).loop;
  if (mode === "box") return resolveBoxSettings(settings.box).countdown === 0;
  if (mode === "pendulum") return resolvePendulumSettings(settings.pendulum).cycles === 0;
  // --- jdm-polyrhythm --- (cycles at "never")
  if (mode === "polyrhythm") return resolvePolyrhythmSettings(settings.polyrhythm).cycles === 0;
  // --- jdm-double-pendulum --- (endless: it swings until it is stopped)
  if (mode === "doublePendulum") return resolveDoublePendulumSettings(settings.doublePendulum).endless;
  // --- jdm-illusions --- the nested circles bounce forever; lines and rings with the cycles at "never"
  if (mode === "illusion") return illusionRunNeverFinishes(settings.illusion);
  return false;
}

/**
 * The run length (seconds) when the settings fix it whatever the seed – a Pendulum Wave lasts exactly
 * cycles × cycle length – or null when the length depends on the seed and is worth searching for. The
 * finder does not search a fixed length that misses the target: it resolves at once with `fixedDuration`
 * set and the page says what to change instead.
 */
export function fixedRunDurationSec(mode: ModeId, settings: Pick<ModeSettings, "pendulum" | "polyrhythm" | "doublePendulum" | "illusion">): number | null {
  // --- jdm-polyrhythm --- (cycles × the cycle length, the seed only picks the direction)
  if (mode === "polyrhythm") {
    const p = resolvePolyrhythmSettings(settings.polyrhythm);
    return p.cycles > 0 ? p.cycles * polyrhythmCycleSeconds(p) : null;
  }
  // --- jdm-double-pendulum --- (it finishes at the clip length, whatever the seed)
  if (mode === "doublePendulum") {
    const dp = resolveDoublePendulumSettings(settings.doublePendulum);
    return dp.endless ? null : dp.clipSeconds;
  }
  // --- jdm-illusions --- lines and rings: cycles × the cycle length, whatever the seed
  if (mode === "illusion") return illusionFixedDurationSec(settings.illusion);
  // --- odd-power-layers --- every sequence but chaos: the plan's hit count × the bounce period (+ the celebration), whatever the seed
  if (mode === "powerLayers") return powerLayersFixedDurationSec((settings as Pick<ModeSettings, "powerLayers">).powerLayers);
  if (mode !== "pendulum") return null;
  const p = resolvePendulumSettings(settings.pendulum);
  return p.cycles > 0 ? p.cycles * p.cycleSeconds : null;
}

export interface FinderRequest {
  targetDurationSec: number;
  toleranceSec: number;
  maxSeeds: number;
  maxSimTimeSec: number;
  physicsConfig: PhysicsConfig;
  mode: ModeId;
  modeSettings: ModeSettings;
  // --- rigged ---
  /** What the found run must do (see outcomes.ts); absent or "duration": last `targetDurationSec` ± `toleranceSec`. */
  outcome?: FinderOutcome;
}

export interface FinderProgress {
  seedsTested: number;
  maxSeeds: number;
  currentSeed: number;
  bestDuration: number;
  bestSeed: number;
  // --- boris-multipliers --- a count search (multipliers board with a target): the closest final count so far
  bestCount?: number;
}

export interface FinderResult {
  found: boolean;
  seed: number;
  duration: number;
  seedsTested: number;
  /** The run can never finish with these settings (see `runNeverFinishes()`): nothing was simulated. */
  endless?: boolean;
  /** The run always lasts `duration` with these settings, whatever the seed (see `fixedRunDurationSec()`), and that misses the target: nothing was simulated. */
  fixedDuration?: boolean;
  // --- boris-multipliers ---
  /** A count search (multipliers board with a target): the final count of the seed found – or of the closest one. */
  count?: number;
  // --- rigged ---
  /**
   * An outcome search (never-escapes, escapes-at, winner): the outcome searched for. `duration` is then the clip to
   * record for a found run (`outcomeClipSec()`) – and for the closest run the figure the page shows (`outcomeFigure()`:
   * its survival, its first escape or its length).
   */
  outcome?: FinderOutcomeKind;
  /** The first escape (seconds) of the run found – or of the closest one – when it had one. */
  escapeAt?: number;
  /** An outcome search: the run found ended (the mode's own finish) within the clip – the page holds its end screen. */
  finished?: boolean;
}

/**
 * Builds a headless engine that mirrors the page's engine for one seed. The physics extras
 * (drag, wind, spin, bounciness, breathing walls, rotating gravity) travel inside `config`
 * and are resolved here exactly as `PhysicsEngine.setConfig()` does, so a found seed replays
 * identically in the page with the same extras.
 */
export function createEngineForSettings(config: PhysicsConfig, mode: ModeId, settings: ModeSettings, seed: number): PhysicsEngine {
  const engine = new PhysicsEngine({ ...config, ...resolvePhysicsExtras(config), twoBalls: settings.twoBalls, ...(settings.ballCount !== undefined ? { ballCount: settings.ballCount } : {}) }); // --- teams --- (ballCount)
  engine.setBouncier(settings.bouncierEnabled);
  if (mode === "target") {
    engine.setCountdownTotal(settings.countdownTotal);
    engine.setCountdownRandomOrder(settings.countdownRandom);
  }
  if (mode === "colorMatch") engine.setColorMatchColorCount(settings.colorMatchColorCount);
  if (mode === "accumulation") {
    engine.setAccumulationTimerMax(settings.accumulationTimerMax);
    engine.setSpikesEnabled(settings.spikesEnabled);
    engine.setSpikeCount(settings.spikeCount);
  }
  if (mode === "multiply") engine.setMultiplySpawnCount(settings.multiplySpawnCount);
  if (mode === "shatter") {
    engine.setShatterSegmentsPerWall(settings.shatterSegmentsPerWall);
    engine.setShatterHpPerSegment(settings.shatterHpPerSegment);
  }
  if (mode === "grow") engine.setGrowRate(settings.growRate);
  if (mode === "portal") engine.setPortalCount(settings.portalCount);
  if (mode === "drop") engine.setDropSettings(settings.drop);
  if (mode === "box") engine.setBoxSettings(settings.box);
  if (mode === "pendulum") engine.setPendulumSettings(settings.pendulum ?? {});
  if (mode === "polyrhythm") engine.setPolyrhythmSettings(settings.polyrhythm ?? {}); // --- jdm-polyrhythm ---
  // --- jdm-collisions ---
  if (mode === "collide") engine.setCollideSettings(settings.collide ?? {});
  // --- boris-glass ---
  if (mode === "glass") engine.setGlassSettings(settings.glass ?? {});
  // --- boris-multipliers ---
  if (mode === "multipliers") engine.setMultipliersSettings(settings.multipliers ?? {});
  // --- jdm-double-pendulum ---
  if (mode === "doublePendulum") engine.setDoublePendulumSettings(settings.doublePendulum ?? {});
  // --- jdm-illusions ---
  if (mode === "illusion") engine.setIllusionSettings(settings.illusion ?? {});
  // --- odd-string-battle ---
  if (mode === "stringBattle") engine.setStringBattleSettings(settings.stringBattle ?? {});
  // --- odd-power-layers ---
  if (mode === "powerLayers") engine.setPowerLayersSettings(settings.powerLayers ?? {});
  // --- jdm-race ---
  if (mode === "race") engine.setRaceSettings(settings.race ?? {});
  // --- jdm-arena-games ---
  if (mode === "battle") engine.setBattleSettings(settings.battle ?? {});
  if (mode === "ctf") engine.setCtfSettings(settings.ctf ?? {});
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

/** Simulates one seed headlessly and returns how long it ran (ms) before finishing. */
export function simulateSeed(seed: number, request: FinderRequest, maxSimMs: number): number {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  // --- odd-power-layers --- the run length is known as soon as the seed's plan is drawn: the hit count × the bounce period + the celebration
  if (request.mode === "powerLayers") return Math.min(maxSimMs, engine.getPowerLayersProgress().plannedMs);
  const step = 1000 / 60;
  let elapsed = 0;
  while (elapsed < maxSimMs) {
    engine.update(step, 0);
    elapsed += step;
    if (engine.isSimulationFinished()) return elapsed;
  }
  return maxSimMs;
}

// --- boris-multipliers ---
/** The count target of a request (a multipliers board with `target` > 0), or 0 for a search by duration. */
export function countTarget(request: Pick<FinderRequest, "mode" | "modeSettings">): number {
  return request.mode === "multipliers" ? resolveMultipliersSettings(request.modeSettings.multipliers).target : 0;
}

/**
 * Simulates one seed of the multipliers board headlessly and returns how long it ran and how many balls made it home.
 * A run that has already sent more than `stopAbove` balls home is cut short (it can only end further off the target).
 */
export function simulateMultipliersSeed(seed: number, request: FinderRequest, maxSimMs: number, stopAbove = Infinity): { durationMs: number; count: number } {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const step = 1000 / 60;
  let elapsed = 0;
  while (elapsed < maxSimMs) {
    engine.update(step, 0);
    elapsed += step;
    engine.consumeSoundEvents();
    const home = engine.getMultipliersProgress().home;
    if (engine.isSimulationFinished() || home > stopAbove) return { durationMs: elapsed, count: home };
  }
  return { durationMs: maxSimMs, count: engine.getMultipliersProgress().home };
}
// --- end boris-multipliers ---

export function findSimulation(
  request: FinderRequest,
  onProgress: (p: FinderProgress) => void,
  signal?: AbortSignal,
): Promise<FinderResult> {
  return new Promise((resolve) => {
    // --- rigged --- the other outcomes (never escapes, first escape at, winner) search by what happens, not by the length
    if (request.outcome && request.outcome.kind !== "duration") {
      findByOutcome(request, request.outcome, onProgress, signal).then(resolve);
      return;
    }
    if (runNeverFinishes(request.mode, request.modeSettings)) {
      resolve({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
      return;
    }
    // --- rigged --- "never escape" keeps a mode that ends with an escape from ever ending: no length to search for either
    if (rigNeverFinishes(request.mode, request.physicsConfig)) {
      resolve({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
      return;
    }
    const fixed = fixedRunDurationSec(request.mode, request.modeSettings);
    if (fixed !== null && Math.abs(fixed - request.targetDurationSec) > request.toleranceSec) {
      resolve({ found: false, seed: 0, duration: fixed, seedsTested: 0, fixedDuration: true });
      return;
    }
    const targetMs = request.targetDurationSec * 1000;
    const toleranceMs = request.toleranceSec * 1000;
    const maxSimMs = request.maxSimTimeSec * 1000;
    // --- boris-multipliers --- a board of hundreds of balls costs a lot per seed: one seed per frame, and a target
    // count turns the search into "final count within 5 % of the target" (any run length)
    const targetCount = countTarget(request);
    if (targetCount > 0) {
      findByCount(request, targetCount, onProgress, signal).then(resolve);
      return;
    }
    const batchSize = request.mode === "multipliers" ? 1 : request.mode === "illusion" ? ILLUSION_FINDER_BATCH : request.mode === "race" ? RACE_FINDER_BATCH : request.mode === "stringBattle" ? STRING_BATTLE_FINDER_BATCH : 50; // --- jdm-illusions --- (a painted arena costs more per seed) --- jdm-race --- (a whole race per seed) --- odd-string-battle ---
    let tested = 0;
    let bestDuration = Infinity;
    let bestSeed = 0;
    let bestDiff = Infinity;
    const base = Date.now() | 0;
    const seedAt = (i: number) => (base + 0x9e3779b1 * i) | 0;

    const runBatch = () => {
      if (signal?.aborted) {
        resolve({ found: false, seed: bestSeed, duration: bestDuration === Infinity ? 0 : bestDuration / 1000, seedsTested: tested });
        return;
      }
      const end = Math.min(tested + batchSize, request.maxSeeds);
      for (let i = tested; i < end; i++) {
        const seed = seedAt(i);
        const durationMs = simulateSeed(seed, request, maxSimMs);
        const diff = Math.abs(durationMs - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestDuration = durationMs;
          bestSeed = seed;
        }
        if (diff <= toleranceMs) {
          resolve({ found: true, seed, duration: durationMs / 1000, seedsTested: i + 1 });
          return;
        }
      }
      tested = end;
      onProgress({
        seedsTested: tested,
        maxSeeds: request.maxSeeds,
        currentSeed: seedAt(tested - 1),
        bestDuration: bestDuration === Infinity ? 0 : bestDuration / 1000,
        bestSeed,
      });
      if (tested >= request.maxSeeds) {
        resolve({ found: false, seed: bestSeed, duration: bestDuration === Infinity ? 0 : bestDuration / 1000, seedsTested: tested });
      } else {
        requestAnimationFrame(runBatch);
      }
    };
    requestAnimationFrame(runBatch);
  });
}

// --- boris-multipliers ---
/** The count search of the multipliers board: seeds until one sends a number of balls home within 5 % of the target. */
function findByCount(request: FinderRequest, target: number, onProgress: (p: FinderProgress) => void, signal?: AbortSignal): Promise<FinderResult> {
  return new Promise((resolve) => {
    const tolerance = countTolerance(target);
    const maxSimMs = Math.max(request.maxSimTimeSec, 240) * 1000;
    let tested = 0;
    let best = { seed: 0, count: -1, durationMs: 0, diff: Infinity };
    const base = Date.now() | 0;
    const seedAt = (i: number) => (base + 0x9e3779b1 * i) | 0;
    const runOne = () => {
      if (signal?.aborted) {
        resolve({ found: false, seed: best.seed, duration: best.durationMs / 1000, seedsTested: tested, count: Math.max(0, best.count) });
        return;
      }
      const seed = seedAt(tested);
      const { durationMs, count } = simulateMultipliersSeed(seed, request, maxSimMs, target + tolerance);
      tested++;
      const diff = Math.abs(count - target);
      if (diff < best.diff) best = { seed, count, durationMs, diff };
      if (diff <= tolerance) {
        resolve({ found: true, seed, duration: durationMs / 1000, seedsTested: tested, count });
        return;
      }
      onProgress({ seedsTested: tested, maxSeeds: request.maxSeeds, currentSeed: seed, bestDuration: best.durationMs / 1000, bestSeed: best.seed, bestCount: best.count });
      if (tested >= request.maxSeeds) resolve({ found: false, seed: best.seed, duration: best.durationMs / 1000, seedsTested: tested, count: Math.max(0, best.count) });
      else requestAnimationFrame(runOne);
    };
    requestAnimationFrame(runOne);
  });
}

// --- rigged ---
/** Real time (ms) the outcome search spends per animation frame before it yields (a long run still takes one seed a frame). */
const OUTCOME_FRAME_BUDGET_MS = 30;

/**
 * Simulates one seed headlessly for an outcome search and sums the run up (outcomes.ts): how long it was followed,
 * whether it finished, its first escape (real time, like the recording) and the team totals at the end. It stops as
 * soon as the outcome is settled (`outcomeSettled()`), so a failing seed costs little. A battle's winner search follows
 * the battle to its end (`winnerNeedsEnd()`) – and gives up on it as soon as the chosen ball is out.
 */
export function simulateOutcomeRun(seed: number, request: FinderRequest, outcome: FinderOutcome): RunSummary {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const horizonMs = outcomeHorizonMs(outcome, request.maxSimTimeSec * 1000, request.mode);
  // --- odd-string-battle --- the chosen ball of a battle's winner search (−1: none to watch)
  const battleTeam = winnerNeedsEnd(outcome, request.mode) && request.mode === "stringBattle" ? (outcome.team ?? -1) : -1;
  const step = 1000 / 60;
  let elapsed = 0;
  let firstEscape = -1;
  let finished = false;
  while (elapsed < horizonMs - 1e-6) {
    engine.update(step, 0);
    elapsed += step;
    engine.consumeSoundEvents();
    if (firstEscape < 0 && engine.getFirstEscapeMs() >= 0) firstEscape = elapsed;
    finished = engine.isSimulationFinished();
    if (outcomeSettled(outcome, elapsed, firstEscape, finished, request.mode)) break;
    if (battleTeam >= 0 && engine.getStringBattleView().fighters[battleTeam]?.alive === false) break; // it cannot win any more
  }
  const teamCount = request.mode === "stringBattle" ? engine.getStringBattleView().count : startBallCount(engine.config, request.mode); // --- odd-string-battle --- (one team per ball)
  const teams = engine.getTeamStats().slice(0, teamCount).map((t) => ({ ...t }));
  return { mode: request.mode, durationMs: elapsed, finished, firstEscapeMs: firstEscape, teams };
}

/** The outcome search: seeds in the finder's order until one achieves the outcome, reporting the closest run so far. */
function findByOutcome(request: FinderRequest, outcome: FinderOutcome, onProgress: (p: FinderProgress) => void, signal?: AbortSignal): Promise<FinderResult> {
  return new Promise((resolve) => {
    let tested = 0;
    let best: { seed: number; run: RunSummary; miss: number } | null = null;
    const base = Date.now() | 0;
    const seedAt = (i: number) => (base + 0x9e3779b1 * i) | 0;
    const result = (found: boolean, seed: number, run: RunSummary | null): FinderResult => ({
      found,
      seed,
      duration: run ? (found ? outcomeClipSec(outcome, run) : outcomeFigure(outcome, run)) : 0,
      seedsTested: tested,
      outcome: outcome.kind,
      finished: run?.finished ?? false,
      ...(run && run.firstEscapeMs >= 0 ? { escapeAt: run.firstEscapeMs / 1000 } : {}),
    });
    const runBatch = () => {
      if (signal?.aborted) {
        resolve(result(false, best?.seed ?? 0, best?.run ?? null));
        return;
      }
      const start = performance.now();
      while (tested < request.maxSeeds) {
        const seed = seedAt(tested);
        const run = simulateOutcomeRun(seed, request, outcome);
        tested++;
        if (outcomeMatches(outcome, run)) {
          resolve(result(true, seed, run));
          return;
        }
        const miss = outcomeMiss(outcome, run);
        if (!best || miss < best.miss) best = { seed, run, miss };
        if (performance.now() - start > OUTCOME_FRAME_BUDGET_MS) break;
      }
      onProgress({ seedsTested: tested, maxSeeds: request.maxSeeds, currentSeed: seedAt(tested - 1), bestDuration: best ? outcomeFigure(outcome, best.run) : 0, bestSeed: best?.seed ?? 0 });
      if (tested >= request.maxSeeds) resolve(result(false, best?.seed ?? 0, best?.run ?? null));
      else requestAnimationFrame(runBatch);
    };
    requestAnimationFrame(runBatch);
  });
}
// --- end rigged ---
