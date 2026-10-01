import { PhysicsEngine } from "@/lib/physics/engine";
import { resolvePhysicsExtras } from "@/lib/physics/extras";
import { unlimitedExtrasOf } from "@/lib/physics/limits"; // --- unlimited ---
import type { BoxSettings, DropSettings, PendulumSettings } from "@/lib/physics/modes";
import { resolveBoxSettings } from "@/lib/physics/modes/box";
import { resolveDropSettings } from "@/lib/physics/modes/drop";
import { resolvePendulumSettings } from "@/lib/physics/modes/pendulum";
// --- jdm-polyrhythm ---
import { polyrhythmCycleSeconds, resolvePolyrhythmSettings, type PolyrhythmSettings } from "@/lib/physics/modes/polyrhythm";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";
// --- jdm-collisions ---
import type { CollideSettings } from "@/lib/physics/modes/collide";
// --- gerald-glass ---
import type { GlassSettings } from "@/lib/physics/modes/glass";
// --- gerald-multipliers ---
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
import { resolveTerritorySettings, type TerritorySettings } from "@/lib/physics/modes/territory"; // --- odd-territory ---
// --- jdm-race ---
import type { RaceSettings } from "@/lib/physics/modes/race";
// --- jdm-arena-games ---
import type { BattleSettings, CtfSettings } from "@/lib/physics/modes/arenaGames";
// --- jdm-rhythm-runner ---
import type { RunnerSettings } from "@/lib/physics/modes/runner";
import type { PaddleSettings } from "@/lib/physics/modes/paddle";
import { jdmRhythmNeverFinishes } from "@/lib/physics/modes/jdmRhythmFields";
// --- gerald-vortex ---
import { resolveVortexSettings, type VortexSettings } from "@/lib/physics/modes/vortex";
import type { JourneySettings } from "@/lib/physics/modes/journey"; // --- gerald-journey ---
import type { BullseyeSettings } from "@/lib/physics/modes/bullseye"; // --- gerald-bullseye ---
// --- beat-drop ---
import type { BeatDropSettings } from "@/lib/physics/modes/beatDrop";
import type { OnBeatConfig } from "@/lib/physics/onBeat"; // --- video-beats ---
import type { MazeSettings } from "@/lib/physics/modes/maze"; // --- odd-maze ---

/**
 * Headless seed search: simulates candidate seeds with the current settings until one
 * finishes within `toleranceSec` of the target duration. Runs in slices of about
 * `FINDER_FRAME_BUDGET_MS` per requestAnimationFrame so the UI stays responsive, and can be
 * cancelled with an AbortSignal (it is checked between slices, so within a frame).
 */

export interface ModeSettings {
  bouncierEnabled: boolean;
  /** --- uncap-all --- The numeric Bounciness (the uncapped Bouncier; absent = what `bouncierEnabled` meant: 1.03 or off). */
  bounciness?: number;
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
  // --- review fix (modes-rhythm) ---
  /**
   * The Cinematic switch (director on/off); on when left out, like the page's default. The director draws from the run's
   * seeded RNG and steers rebounds, so a seed plays out differently with it off: the finder must run it as the page will.
   */
  cinematicEnabled?: boolean;
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
  // --- gerald-glass ---
  /** Glass Smash: rows, hit points, stages, sliding panes and holes (see modes/glass.ts); the defaults when left out. Every run ends at HOME, so the finder searches it. */
  glass?: Partial<GlassSettings>;
  // --- gerald-multipliers ---
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
  // --- jdm-rhythm-runner ---
  /**
   * Beat Runner (see modes/runner.ts; the defaults when left out): the course, the tempo and the loaded song's beat grid.
   * With auto jump the run ends at the finish line, planned at init, so the finder reads its length off the plan; played by
   * hand it has no length to search for (`runNeverFinishes()`).
   */
  runner?: Partial<RunnerSettings>;
  /** Paddle Keep-Up (see modes/paddle.ts): the auto controller below skill 1 misses deterministically, so the finder times the game over; manual or perfect play never ends. */
  paddle?: Partial<PaddleSettings>;
  // --- review fix (modes-rhythm) ---
  /**
   * Paint: true while a picture is loaded (Picture Paint). Its brush, beat sync, guidance and pacing follow the page's picture
   * and song, which a headless engine does not have, so the finder does not search it (`runNeverFinishes()`); classic Paint
   * (no picture) always ends at `COVERAGE_DONE` and is searched like any mode.
   */
  paintPicture?: boolean;
  // --- gerald-vortex ---
  /** Sound Vortex: balls, stagger, rings, duration, pull and loop (see modes/vortex.ts); the defaults when left out. Without the loop every run ends when the last ball is swallowed, and the seed's tempo moves that continuously, so the finder searches it. */
  vortex?: Partial<VortexSettings>;
  // --- gerald-journey ---
  /** Journey: the stage list or the auto count (see modes/journey.ts); the defaults when left out. Every journey reaches HOME (the stages never hold the ball for good), so the finder searches it. */
  journey?: Partial<JourneySettings>;
  // --- gerald-bullseye ---
  /** Bullseye: shots, interval, chaos, rings, the moving target and the perfect shot (see modes/bullseye.ts); the defaults when left out. Every run ends after the last landing, and the seed moves that (the last flight, the bullseyes' slow motion), so the finder searches it. */
  bullseye?: Partial<BullseyeSettings>;
  // --- beat-drop ---
  /**
   * Beat Drop: the mix, drift, scroll, bounce, anticipation, the beat it follows and the clip length (see modes/beatDrop.ts);
   * the defaults when left out. The run can never fail – every seed lands every beat – and it ends on the last landing that
   * fits in the clip, so the finder only picks a seed and reports how long the run covering the target's beats lasts.
   */
  beatDrop?: Partial<BeatDropSettings>;
  // --- video-beats ---
  /** On beat (physics/onBeat.ts): the ring modes' flights timed onto the beat grid – part of the run, so the finder searches with it. */
  onBeat?: Partial<OnBeatConfig>;
  // --- odd-territory ---
  /** Territory: board, teams, balls, powers and the countdown (see modes/territory.ts); the defaults when left out. Every run lasts the countdown, so the finder searches its winner. */
  territory?: Partial<TerritorySettings>;
  // --- odd-maze ---
  /**
   * Maze escape: columns, balls, brain, hand, pull, speed and the clip limit (see modes/maze.ts); the defaults when left out.
   * Every run ends – every ball out, or the clip limit – so the finder searches it by length or by winner.
   */
  maze?: Partial<MazeSettings>;
}

// --- odd-string-battle ---
/** Seeds of the String Battle simulated per animation frame (a battle takes a few ms per simulated second). */
export const STRING_BATTLE_FINDER_BATCH = 6;
// --- odd-territory ---
/** Seeds of Territory simulated per animation frame (a seed plays its whole countdown). */
export const TERRITORY_FINDER_BATCH = 2;

// --- jdm-race ---
/** Seeds of the race simulated per animation frame (a seed runs a whole race of up to 16 racers). */
export const RACE_FINDER_BATCH = 3;

// --- jdm-illusions ---
/** Seeds of the Circle Illusion simulated per animation frame (a whitespace seed paints a grid for tens of seconds). */
export const ILLUSION_FINDER_BATCH = 4;

// --- review fix (modes-rhythm) ---
/** Seeds of Paint simulated per animation frame (a seed paints for a minute or more before it covers the circle). */
export const PAINT_FINDER_BATCH = 2;

// --- odd-maze ---
/** Seeds of the Maze simulated per animation frame (a seed runs until every ball is out, up to the clip limit). */
export const MAZE_FINDER_BATCH = 6;

// --- review fix (modes-rhythm) ---
/**
 * True when a seed of `mode` plays the same run on any canvas size, a resize before Start or mid-run included (every margin,
 * size and speed is in field units; tests/arenaGames.test.ts checks it exactly), so the page keeps a found seed when the
 * canvas is resized. Any other mode's run can play out differently at another size (px speeds, float rounding), so a
 * resize drops its found seed.
 */
export function seedSurvivesResize(mode: ModeId): boolean {
  return mode === "battle" || mode === "ctf";
}

/**
 * Modes whose run never "finishes" (there is no escape to time), whatever the settings. Paint is not one: it finishes at
 * `COVERAGE_DONE` (the finder searches classic Paint; Picture Paint is left out in `runNeverFinishes()`).
 */
export const ENDLESS_MODES: ModeId[] = ["multiply", "lines", "grow"];

/**
 * True when a run of `mode` with these settings can never finish, so there is no duration to search
 * for: the endless modes, Ball Drop while it rains, Bouncing Shapes with the countdown off and a Pendulum
 * Wave with the cycles set to never. The finder resolves at once with `endless` set instead of simulating,
 * and the page hides its button.
 */
export function runNeverFinishes(mode: ModeId, settings: Pick<ModeSettings, "drop" | "box" | "pendulum" | "polyrhythm" | "doublePendulum" | "illusion" | "runner" | "paddle" | "vortex" | "paintPicture">): boolean {
  if (ENDLESS_MODES.includes(mode)) return true;
  // --- review fix (modes-rhythm) --- Picture Paint follows the page's picture and song: no length the finder can replay
  if (mode === "paint") return settings.paintPicture === true;
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
  // --- jdm-rhythm-runner --- the runner played by hand (the finder cannot play), the paddle played by hand or perfectly
  if (mode === "runner" || mode === "paddle") return jdmRhythmNeverFinishes(mode, settings);
  // --- gerald-vortex --- with the loop on every swallowed ball comes back: the vortex never ends
  if (mode === "vortex") return resolveVortexSettings(settings.vortex).loop;
  return false;
}

/**
 * The run length (seconds) when the settings fix it whatever the seed – a Pendulum Wave lasts exactly
 * cycles × cycle length – or null when the length depends on the seed and is worth searching for. The
 * finder does not search a fixed length that misses the target: it resolves at once with `fixedDuration`
 * set and the page says what to change instead.
 */
export function fixedRunDurationSec(mode: ModeId, settings: Pick<ModeSettings, "pendulum" | "polyrhythm" | "doublePendulum" | "illusion">): number | null {
  // (--- uncap-all --- the resolvers below are the engine's: every value past its slider, memory-safety ceilings aside)
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
  // --- odd-territory --- every run lasts its countdown, whatever the seed (the seed picks the winner)
  if (mode === "territory") return resolveTerritorySettings((settings as Pick<ModeSettings, "territory">).territory).duration;
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
  // --- gerald-multipliers --- a count search (multipliers board with a target): the closest final count so far
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
  // --- gerald-multipliers ---
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
  // --- video-beats ---
  /** On beat: the distinct beats the found run's wall hits land on, and its timed hits (set when On beat applies). */
  beatsCovered?: number;
  beatHits?: number;
  // --- unlimited ---
  /** A heavy No limits run: the search tested only this many seeds (the time budget; see unlimitedFinder.ts). */
  limitedSeeds?: number;
  // --- uncap-all ---
  /** Not one tested seed ended within the search's horizon: with these values the run never ends (the page says so). */
  neverEnded?: boolean;
}

/**
 * Builds a headless engine that mirrors the page's engine for one seed. The physics extras
 * (drag, wind, spin, bounciness, breathing walls, rotating gravity) travel inside `config`
 * and are resolved here exactly as `PhysicsEngine.setConfig()` does, so a found seed replays
 * identically in the page with the same extras.
 */
export function createEngineForSettings(config: PhysicsConfig, mode: ModeId, settings: ModeSettings, seed: number): PhysicsEngine {
  const engine = new PhysicsEngine({ ...config, ...resolvePhysicsExtras(config), ...unlimitedExtrasOf(config), twoBalls: settings.twoBalls, ...(settings.ballCount !== undefined ? { ballCount: settings.ballCount } : {}) }); // --- teams --- (ballCount) --- unlimited --- (the extras past their ranges, as the page's engine runs them)
  engine.setBouncier(settings.bouncierEnabled);
  if (settings.bounciness !== undefined) engine.setBounciness(settings.bounciness); // --- uncap-all ---
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
  // --- gerald-glass ---
  if (mode === "glass") engine.setGlassSettings(settings.glass ?? {});
  // --- gerald-multipliers ---
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
  // --- jdm-rhythm-runner ---
  if (mode === "runner") engine.setRunnerSettings(settings.runner ?? {});
  if (mode === "paddle") engine.setPaddleSettings(settings.paddle ?? {});
  // --- gerald-vortex ---
  if (mode === "vortex") engine.setVortexSettings(settings.vortex ?? {});
  if (mode === "journey") engine.setJourneySettings(settings.journey ?? {}); // --- gerald-journey ---
  if (mode === "bullseye") engine.setBullseyeSettings(settings.bullseye ?? {}); // --- gerald-bullseye ---
  if (mode === "beatDrop") engine.setBeatDropSettings(settings.beatDrop ?? {}); // --- beat-drop ---
  if (mode === "territory") engine.setTerritorySettings(settings.territory ?? {}); // --- odd-territory ---
  if (mode === "maze") engine.setMazeSettings(settings.maze ?? {}); // --- odd-maze ---
  if (settings.onBeat) engine.setOnBeat(settings.onBeat); // --- video-beats ---
  engine.setCinematicEnabled(settings.cinematicEnabled ?? true); // --- review fix (modes-rhythm) --- (as the page's initEngineForMode)
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

/** Simulates one seed headlessly and returns how long it ran (ms) before finishing. */
export function simulateSeed(seed: number, request: FinderRequest, maxSimMs: number): number {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  // --- odd-power-layers --- the run length is known as soon as the seed's plan is drawn: the hit count × the bounce period + the celebration
  if (request.mode === "powerLayers") return Math.min(maxSimMs, engine.getPowerLayersProgress().plannedMs);
  // --- jdm-rhythm-runner --- an auto runner's length is planned at init (the finish line + the celebration); the paddle game
  // runs on the mode's own fast path (the same 60 Hz steps as the page, without the engine loop around them)
  if (request.mode === "runner") return Math.min(maxSimMs, engine.getRunnerProgress().plannedMs);
  if (request.mode === "paddle") return engine.paddleRunLengthMs(maxSimMs);
  // --- beat-drop --- the run's end is planned at init: the last landing in the clip + the hold
  if (request.mode === "beatDrop") return Math.min(maxSimMs, engine.getBeatDropProgress().plannedMs);
  const step = 1000 / 60;
  let elapsed = 0;
  while (elapsed < maxSimMs) {
    engine.update(step, 0);
    elapsed += step;
    if (engine.isSimulationFinished()) return elapsed;
  }
  return maxSimMs;
}

// --- beat-drop ---
/**
 * The Beat Drop "search": the run cannot fail (every seed lands every beat), so the first seed is the one. The run for a
 * clip of the target length covers the beats up to the target (less the end hold) and ends then – its length is the
 * duration found, never more than the target.
 */
export function findBeatDropRun(request: Pick<FinderRequest, "targetDurationSec" | "physicsConfig" | "modeSettings">, seed = Date.now() | 0): FinderResult {
  const settings = { ...request.modeSettings, beatDrop: { ...request.modeSettings.beatDrop, clipSec: request.targetDurationSec } };
  const engine = createEngineForSettings(request.physicsConfig, "beatDrop", settings, seed);
  return { found: true, seed, duration: engine.getBeatDropProgress().plannedMs / 1000, seedsTested: 1 };
}
// --- end beat-drop ---
// --- video-beats ---
/**
 * With On beat on (a ring mode, a grid to follow): replays the found seed for `durationMs` and reports how many distinct
 * beats its wall hits landed on and how many hits were timed – the "beats covered" the page shows with a found run.
 */
export function beatCoverage(seed: number, request: FinderRequest, durationMs: number): { beatsCovered?: number; beatHits?: number } {
  if (!request.modeSettings.onBeat?.enabled) return {};
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const step = 1000 / 60;
  for (let elapsed = 0; elapsed < durationMs - 1e-6; elapsed += step) {
    engine.update(step, 0);
    engine.consumeSoundEvents();
  }
  const stats = engine.getOnBeatStats();
  return stats.active ? { beatsCovered: stats.beatsCovered, beatHits: stats.hits } : {};
}
// --- end video-beats ---

// --- gerald-multipliers ---
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
// --- end gerald-multipliers ---

/**
 * Real time (ms) a search spends per animation frame before it yields – the duration, count and outcome searches alike. A
 * seed that takes longer still runs whole (one seed a frame); the batch sizes below only cap how many seeds a frame may take.
 */
export const FINDER_FRAME_BUDGET_MS = 30;

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
    // --- beat-drop --- every seed lands every beat: any seed keeps the promise, the clip covers the target's beats
    if (request.mode === "beatDrop") {
      resolve(findBeatDropRun(request));
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
    // --- gerald-multipliers --- a board of hundreds of balls costs a lot per seed: one seed per frame, and a target
    // count turns the search into "final count within 5 % of the target" (any run length)
    const targetCount = countTarget(request);
    if (targetCount > 0) {
      findByCount(request, targetCount, onProgress, signal).then(resolve);
      return;
    }
    const batchSize = request.mode === "multipliers" ? 1 : request.mode === "illusion" ? ILLUSION_FINDER_BATCH : request.mode === "race" ? RACE_FINDER_BATCH : request.mode === "stringBattle" ? STRING_BATTLE_FINDER_BATCH : request.mode === "territory" ? TERRITORY_FINDER_BATCH /* --- odd-territory --- */ : request.mode === "paint" ? PAINT_FINDER_BATCH : request.mode === "maze" ? MAZE_FINDER_BATCH /* --- odd-maze --- */ : 50; // --- jdm-illusions --- (a painted arena costs more per seed) --- jdm-race --- (a whole race per seed) --- odd-string-battle ---
    let tested = 0;
    let bestDuration = Infinity;
    let bestSeed = 0;
    let bestDiff = Infinity;
    let unfinished = 0; // --- uncap-all --- seeds that ran to the horizon without ending
    const base = Date.now() | 0;
    const seedAt = (i: number) => (base + 0x9e3779b1 * i) | 0;

    const runBatch = () => {
      if (signal?.aborted) {
        resolve({ found: false, seed: bestSeed, duration: bestDuration === Infinity ? 0 : bestDuration / 1000, seedsTested: tested });
        return;
      }
      // Seeds until the frame's time budget is spent (at most `batchSize`): a slice of ~30 ms, whatever a seed costs.
      const start = performance.now();
      const end = Math.min(tested + batchSize, request.maxSeeds);
      let i = tested;
      while (i < end) {
        const seed = seedAt(i);
        const durationMs = simulateSeed(seed, request, maxSimMs);
        i++;
        if (durationMs >= maxSimMs) unfinished++; // --- uncap-all ---
        const diff = Math.abs(durationMs - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestDuration = durationMs;
          bestSeed = seed;
        }
        if (diff <= toleranceMs) {
          resolve({ found: true, seed, duration: durationMs / 1000, seedsTested: i, ...beatCoverage(seed, request, durationMs) }); // --- video-beats ---
          return;
        }
        if (performance.now() - start > FINDER_FRAME_BUDGET_MS) break;
      }
      tested = i;
      onProgress({
        seedsTested: tested,
        maxSeeds: request.maxSeeds,
        currentSeed: seedAt(tested - 1),
        bestDuration: bestDuration === Infinity ? 0 : bestDuration / 1000,
        bestSeed,
      });
      if (tested >= request.maxSeeds) {
        resolve({ found: false, seed: bestSeed, duration: bestDuration === Infinity ? 0 : bestDuration / 1000, seedsTested: tested, ...(tested > 0 && unfinished === tested ? { neverEnded: true } : {}) }); // --- uncap-all --- (a run that never ends says so)
      } else {
        requestAnimationFrame(runBatch);
      }
    };
    requestAnimationFrame(runBatch);
  });
}

// --- gerald-multipliers ---
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
      // Seeds until the frame's time budget is spent (a board of hundreds of balls usually takes the whole budget alone).
      const start = performance.now();
      let seed = 0;
      while (tested < request.maxSeeds) {
        seed = seedAt(tested);
        const { durationMs, count } = simulateMultipliersSeed(seed, request, maxSimMs, target + tolerance);
        tested++;
        const diff = Math.abs(count - target);
        if (diff < best.diff) best = { seed, count, durationMs, diff };
        if (diff <= tolerance) {
          resolve({ found: true, seed, duration: durationMs / 1000, seedsTested: tested, count });
          return;
        }
        if (performance.now() - start > FINDER_FRAME_BUDGET_MS) break;
      }
      onProgress({ seedsTested: tested, maxSeeds: request.maxSeeds, currentSeed: seed, bestDuration: best.durationMs / 1000, bestSeed: best.seed, bestCount: best.count });
      if (tested >= request.maxSeeds) resolve({ found: false, seed: best.seed, duration: best.durationMs / 1000, seedsTested: tested, count: Math.max(0, best.count) });
      else requestAnimationFrame(runOne);
    };
    requestAnimationFrame(runOne);
  });
}

// --- rigged ---
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
  const mazeTeam = winnerNeedsEnd(outcome, request.mode) && request.mode === "maze" ? (outcome.team ?? -1) : -1; // --- odd-maze ---
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
    // --- odd-maze --- the maze's verdict is final once a ball is out: another ball's win ends the search of this seed
    if (mazeTeam >= 0 && engine.getMazeView().winner >= 0 && engine.getMazeView().winner !== mazeTeam) break;
  }
  const teamCount = request.mode === "stringBattle" ? engine.getStringBattleView().count : request.mode === "territory" ? engine.getTerritoryView().teams /* --- odd-territory --- */ : request.mode === "maze" ? engine.getMazeView().teamCount /* --- odd-maze --- (one team per ball, the first six) */ : startBallCount(engine.config, request.mode); // --- odd-string-battle --- (one team per ball)
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
        if (performance.now() - start > FINDER_FRAME_BUDGET_MS) break;
      }
      onProgress({ seedsTested: tested, maxSeeds: request.maxSeeds, currentSeed: seedAt(tested - 1), bestDuration: best ? outcomeFigure(outcome, best.run) : 0, bestSeed: best?.seed ?? 0 });
      if (tested >= request.maxSeeds) resolve(result(false, best?.seed ?? 0, best?.run ?? null));
      else requestAnimationFrame(runBatch);
    };
    requestAnimationFrame(runBatch);
  });
}
// --- end rigged ---
