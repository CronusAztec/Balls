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
// --- boris-multipliers ---
import { countTolerance, resolveMultipliersSettings, type MultipliersSettings } from "@/lib/physics/modes/multipliers";

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
  // --- boris-multipliers ---
  /** Multipliers board: rows, gate mix, start balls, ball cap and the count target (see modes/multipliers.ts); the defaults when left out. */
  multipliers?: Partial<MultipliersSettings>;
}

/** Modes whose run never "finishes" (there is no escape to time), whatever the settings. */
export const ENDLESS_MODES: ModeId[] = ["multiply", "lines", "paint", "grow"];

/**
 * True when a run of `mode` with these settings can never finish, so there is no duration to search
 * for: the endless modes, Ball Drop while it rains, Bouncing Shapes with the countdown off and a Pendulum
 * Wave with the cycles set to never. The finder resolves at once with `endless` set instead of simulating,
 * and the page hides its button.
 */
export function runNeverFinishes(mode: ModeId, settings: Pick<ModeSettings, "drop" | "box" | "pendulum" | "polyrhythm">): boolean {
  if (ENDLESS_MODES.includes(mode)) return true;
  // --- jdm-collisions --- the Collision Playground never finishes (there is no escape or end to time).
  if (mode === "collide") return true;
  if (mode === "drop") return resolveDropSettings(settings.drop).loop;
  if (mode === "box") return resolveBoxSettings(settings.box).countdown === 0;
  if (mode === "pendulum") return resolvePendulumSettings(settings.pendulum).cycles === 0;
  // --- jdm-polyrhythm --- (cycles at "never")
  if (mode === "polyrhythm") return resolvePolyrhythmSettings(settings.polyrhythm).cycles === 0;
  return false;
}

/**
 * The run length (seconds) when the settings fix it whatever the seed – a Pendulum Wave lasts exactly
 * cycles × cycle length – or null when the length depends on the seed and is worth searching for. The
 * finder does not search a fixed length that misses the target: it resolves at once with `fixedDuration`
 * set and the page says what to change instead.
 */
export function fixedRunDurationSec(mode: ModeId, settings: Pick<ModeSettings, "pendulum" | "polyrhythm">): number | null {
  // --- jdm-polyrhythm --- (cycles × the cycle length, the seed only picks the direction)
  if (mode === "polyrhythm") {
    const p = resolvePolyrhythmSettings(settings.polyrhythm);
    return p.cycles > 0 ? p.cycles * polyrhythmCycleSeconds(p) : null;
  }
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
}

/**
 * Builds a headless engine that mirrors the page's engine for one seed. The physics extras
 * (drag, wind, spin, bounciness, breathing walls, rotating gravity) travel inside `config`
 * and are resolved here exactly as `PhysicsEngine.setConfig()` does, so a found seed replays
 * identically in the page with the same extras.
 */
export function createEngineForSettings(config: PhysicsConfig, mode: ModeId, settings: ModeSettings, seed: number): PhysicsEngine {
  const engine = new PhysicsEngine({ ...config, ...resolvePhysicsExtras(config), twoBalls: settings.twoBalls });
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
  // --- boris-multipliers ---
  if (mode === "multipliers") engine.setMultipliersSettings(settings.multipliers ?? {});
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

/** Simulates one seed headlessly and returns how long it ran (ms) before finishing. */
export function simulateSeed(seed: number, request: FinderRequest, maxSimMs: number): number {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
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
    if (runNeverFinishes(request.mode, request.modeSettings)) {
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
    const batchSize = request.mode === "multipliers" ? 1 : 50;
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
