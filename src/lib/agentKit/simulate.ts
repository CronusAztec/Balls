import type { PhysicsEngine } from "@/lib/physics/engine";
import type { GameMode, ModeId, SoundEvent } from "@/lib/physics/types";
import { DEFAULT_BOT_WORLD, finderRequestOfSettings, type BotWorld } from "@/lib/bot/finderRequest";
import { createEngineForSettings, simulateSeed, stepPlaybackMs } from "@/lib/simulation/finder";
import type { SimulatorSettings } from "@/lib/settings";
import { jsonView, roundNumber, type JsonValue } from "./jsonView";

/*
 * --- agent-cli --- `npm run agent -- simulate`: one seed of a settings object (a share link's, or a mode's defaults), run
 * headlessly in Node exactly as the seed finder runs it – the same `finderRequestOfSettings()` (the page's physics config and
 * mode settings), the same `createEngineForSettings()` and the same fixed 1/60 s steps as `simulateSeed()` – so the finish
 * time it reports is the finder's, and a found seed's link replays here. Reports what an agent needs to see a change to a
 * mode without a browser: whether and when the run finished, the balls on the field each second, the sound events by type,
 * the mode's own state and view (JSON-safe, typed arrays summarised), a NaN flag and work counts. Deterministic: the same
 * request gives byte-identical JSON (no wall clock in the result).
 */

export const SIMULATE_MAX_SECONDS = 600;

export interface SimulateRequest {
  settings: SimulatorSettings;
  seed: number;
  seconds: number;
  /** The world (the page canvas in CSS px); the finder's nominal 800 × 600 by default. */
  world?: BotWorld;
  /** Keep stepping after the run finished, up to `seconds` (default: stop at the finish, like the finder). */
  continueAfterFinish?: boolean;
}

export interface SimulateResult {
  mode: ModeId;
  seed: number;
  /** --- slow-motion --- The Slow motion switch the run played with (false for a link's `smo=0`: Bullseye's and Fight League's runs change, and every length is the playback time the page plays the run in). */
  slowMotion: boolean;
  world: BotWorld;
  /** Simulated seconds actually stepped. */
  simulatedSec: number;
  steps: number;
  finished: boolean;
  /** When the run finished (s, the finder's `simulateSeed()` time), null when it did not within `seconds`. */
  finishSec: number | null;
  /** The modes whose length is planned at init (Power Layers, Beat Runner, Paddle, Beat Drop): the finder's planned length (s). */
  plannedSec?: number;
  balls: { perSecond: number[]; max: number; final: number };
  sounds: { total: number; byType: Record<string, number>; perSecond: number[] };
  /** A ball's position or speed went NaN or infinite, or the mode's state, view or progress holds a NaN. */
  nan: boolean;
  /** The first second a ball went non-finite (null: never). */
  nanAtSec: number | null;
  work: { ballSteps: number; subSteps: number | null; pairs: number | null; maxBalls: number };
  walls: { count: number; broken: number };
  state: JsonValue;
  view: JsonValue;
  progress: JsonValue;
}

const PLANNED_MODES: readonly ModeId[] = ["powerLayers", "runner", "paddle", "beatDrop"];

const capitalised = (mode: string) => mode.charAt(0).toUpperCase() + mode.slice(1);

/** The engine's mode-specific getter `get<Mode><suffix>()`, called once, or undefined when the engine has none. */
function modeGetter(engine: PhysicsEngine, mode: ModeId, suffix: "View" | "Progress"): unknown {
  const fn = (engine as unknown as Record<string, unknown>)[`get${capitalised(mode)}${suffix}`];
  return typeof fn === "function" ? (fn as () => unknown).call(engine) : undefined;
}

/**
 * The running mode (the engine keeps it private: read here only, for its getState() and to count its sub-steps). A wrapped
 * hook calls the original with the same arguments, so the run is the finder's step for step.
 */
function currentModeOf(engine: PhysicsEngine): GameMode | null {
  return (engine as unknown as { currentMode?: GameMode | null }).currentMode ?? null;
}

/** Counts calls of an instance method (the original runs unchanged); false when the engine has no such method. */
function countCalls(target: object, name: string, onCall: () => void): boolean {
  const original = (target as Record<string, unknown>)[name];
  if (typeof original !== "function") return false;
  (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
    onCall();
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
  return true;
}

export function simulate(request: SimulateRequest): SimulateResult {
  const world = request.world ?? DEFAULT_BOT_WORLD;
  const seconds = Math.min(SIMULATE_MAX_SECONDS, Math.max(0, request.seconds));
  const maxMs = seconds * 1000;
  const finder = finderRequestOfSettings(request.settings, world, seconds);
  const engine = createEngineForSettings(finder.physicsConfig, finder.mode, finder.modeSettings, request.seed);

  let subSteps = 0;
  let pairs = 0;
  const modeObject = currentModeOf(engine);
  const countsSubSteps = modeObject ? countCalls(modeObject, "onPostSubStep", () => subSteps++) : false;
  const countsPairs = countCalls(engine, "handleBallCollision", () => pairs++);

  const byType: Record<string, number> = {};
  const soundsPerSecond: number[] = [];
  const ballsPerSecond: number[] = [];
  let soundTotal = 0;
  let ballSteps = 0;
  let maxBalls = 0;
  let nanAtSec: number | null = null;
  let finishedAt: number | null = null;
  let steps = 0;
  // The finder's clock: the same step and the same float sum as simulateSeed(), so the finish time is its own (--- slow-motion ---
  // with the Slow motion switch off, a link's smo=0, the playback time the page plays the run in: stepPlaybackMs())
  const step = 1000 / 60;
  let elapsed = 0;
  let soundsThisSecond = 0;
  while (elapsed < maxMs) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step);
    steps++;
    const events: SoundEvent[] = engine.consumeSoundEvents();
    for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
    soundTotal += events.length;
    soundsThisSecond += events.length;
    const balls = engine.getBalls();
    ballSteps += balls.length;
    if (balls.length > maxBalls) maxBalls = balls.length;
    if (nanAtSec === null) {
      for (const b of balls) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
          nanAtSec = roundNumber(elapsed / 1000);
          break;
        }
      }
    }
    if (steps % 60 === 0) {
      ballsPerSecond.push(balls.length);
      soundsPerSecond.push(soundsThisSecond);
      soundsThisSecond = 0;
    }
    if (finishedAt === null && engine.isSimulationFinished()) {
      finishedAt = elapsed;
      if (!request.continueAfterFinish) break;
    }
  }
  if (steps % 60 !== 0) soundsPerSecond.push(soundsThisSecond); // the part second at the end

  const state = jsonView(currentModeOf(engine)?.getState());
  const view = jsonView(modeGetter(engine, finder.mode, "View"));
  const progress = jsonView(modeGetter(engine, finder.mode, "Progress"));
  const finalBalls = engine.getBalls().length;
  const result: SimulateResult = {
    mode: finder.mode,
    seed: request.seed,
    slowMotion: engine.slowMotionOn(), // --- slow-motion ---
    world: { width: world.width, height: world.height },
    simulatedSec: roundNumber(elapsed / 1000),
    steps,
    finished: finishedAt !== null,
    finishSec: finishedAt === null ? null : roundNumber(finishedAt / 1000, 9),
    balls: { perSecond: ballsPerSecond, max: maxBalls, final: finalBalls },
    sounds: { total: soundTotal, byType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b))), perSecond: soundsPerSecond },
    nan: nanAtSec !== null || state.nan + view.nan + progress.nan > 0,
    nanAtSec,
    work: { ballSteps, subSteps: countsSubSteps ? subSteps : null, pairs: countsPairs ? pairs : null, maxBalls },
    walls: { count: engine.getCircularWalls().length, broken: engine.getBrokenWalls().size },
    state: state.value,
    view: view.value,
    progress: progress.value,
  };
  // The modes whose length the finder reads off the plan made at init (no stepping): its number, next to the stepped one.
  if (PLANNED_MODES.includes(finder.mode)) result.plannedSec = roundNumber(simulateSeed(request.seed, finder, maxMs) / 1000, 9);
  return result;
}
