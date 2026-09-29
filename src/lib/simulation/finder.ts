import { PhysicsEngine } from "@/lib/physics/engine";
import { resolvePhysicsExtras } from "@/lib/physics/extras";
import type { BoxSettings, DropSettings } from "@/lib/physics/modes";
import { resolveBoxSettings } from "@/lib/physics/modes/box";
import { resolveDropSettings } from "@/lib/physics/modes/drop";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";

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
}

/** Modes whose run never "finishes" (there is no escape to time), whatever the settings. */
export const ENDLESS_MODES: ModeId[] = ["multiply", "lines", "paint", "grow"];

/**
 * True when a run of `mode` with these settings can never finish, so there is no duration to search
 * for: the endless modes, Ball Drop while it rains and Bouncing Shapes with the countdown off. The
 * finder resolves at once with `endless` set instead of simulating, and the page hides its button.
 */
export function runNeverFinishes(mode: ModeId, settings: Pick<ModeSettings, "drop" | "box">): boolean {
  if (ENDLESS_MODES.includes(mode)) return true;
  if (mode === "drop") return resolveDropSettings(settings.drop).loop;
  if (mode === "box") return resolveBoxSettings(settings.box).countdown === 0;
  return false;
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
}

export interface FinderResult {
  found: boolean;
  seed: number;
  duration: number;
  seedsTested: number;
  /** The run can never finish with these settings (see `runNeverFinishes()`): nothing was simulated. */
  endless?: boolean;
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
    const targetMs = request.targetDurationSec * 1000;
    const toleranceMs = request.toleranceSec * 1000;
    const maxSimMs = request.maxSimTimeSec * 1000;
    const batchSize = 50;
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
