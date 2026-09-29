import type { ModeId } from "../types";
import { PADDLE_RANGES, defaultPaddleFields, paddleNeverFinishes, paddleSettingsOf, readPaddleParams, resolvePaddleFields, writePaddleParams, type PaddleFields, type PaddleSettings } from "./paddle";
import { RUNNER_RANGES, defaultRunnerFields, readRunnerParams, resolveRunnerFields, resolveRunnerSettings, runnerSettingsOf, writeRunnerParams, type RunnerBeatInput, type RunnerFields, type RunnerSettings } from "./runner";

/**
 * The settings glue of feature jdm-rhythm-runner: the Beat Runner (runner.ts) and Paddle Keep-Up (paddle.ts) fields of
 * the SimulatorSettings object, their slider ranges, URL keys (rra rrn rrsp rrj rrd rrm rrbs · pda pdsk pdm pdw pdsp pdu)
 * and validation, so settings.ts only spreads and calls these.
 */

export type JdmRhythmFields = RunnerFields & PaddleFields;

export const JDM_RHYTHM_RANGES = { ...RUNNER_RANGES, ...PADDLE_RANGES } as const;

export function defaultJdmRhythmFields(): JdmRhythmFields {
  return { ...defaultRunnerFields(), ...defaultPaddleFields() };
}

/** Clamped numbers, known options, real booleans (URL parameters and presets alike). */
export function resolveJdmRhythmFields(source: Partial<JdmRhythmFields>): JdmRhythmFields {
  return { ...resolveRunnerFields(source), ...resolvePaddleFields(source) };
}

export function writeJdmRhythmParams(settings: JdmRhythmFields, base: JdmRhythmFields, params: URLSearchParams) {
  writeRunnerParams(settings, base, params);
  writePaddleParams(settings, base, params);
}

export function readJdmRhythmParams(params: URLSearchParams, settings: JdmRhythmFields) {
  readRunnerParams(params, settings);
  readPaddleParams(params, settings);
}

/** The two modes' settings for the finder (`ModeSettings.runner` / `.paddle`), from the page's settings. */
export function jdmRhythmFinderSettingsOf(s: JdmRhythmFields & { bpm?: number; scale?: RunnerSettings["scale"]; rootNote?: number }, beat?: RunnerBeatInput | null): { runner: RunnerSettings; paddle: PaddleSettings } {
  return { runner: runnerSettingsOf(s, beat), paddle: paddleSettingsOf(s) };
}

/**
 * True while the current run is played by hand: a Beat Runner without Auto Jump, a Paddle Keep-Up without Auto Platform.
 * The player's input is part of such a run and only the real-time recorder (Record Video) captures it – the fast export
 * and the batch render build a fresh engine from the seed that nobody would play – so the page leaves it to Record Video.
 */
export function jdmRhythmPlayedByHand(s: { mode: ModeId | string } & Pick<JdmRhythmFields, "runnerAutoJump" | "pdAuto">): boolean {
  return (s.mode === "runner" && !s.runnerAutoJump) || (s.mode === "paddle" && !s.pdAuto);
}

/** True when a run of the mode can never end: a runner played by hand (the finder cannot play it), a manual or perfect paddle. */
export function jdmRhythmNeverFinishes(mode: ModeId, settings: { runner?: Partial<RunnerSettings>; paddle?: Partial<PaddleSettings> }): boolean {
  if (mode === "runner") return !resolveRunnerSettings(settings.runner).autoJump;
  if (mode === "paddle") return paddleNeverFinishes(settings.paddle);
  return false;
}
