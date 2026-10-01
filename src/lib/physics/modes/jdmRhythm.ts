import { SCALE_INTERVALS, midiToFrequency, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import type { ModeId } from "../types";
import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Shared bits of the feature jdm-rhythm-runner (the project.jdm "Added realistic gravity to Geometry Dash" rhythm runner
 * and the "Ball Bounce Game with Moving Platform" keep-up game): the two mode ids and the notes both modes play. The
 * modes themselves live in runner.ts and paddle.ts; jdmRhythmFields.ts glues their settings into settings.ts.
 */

export const JDM_RHYTHM_MODES = ["runner", "paddle"] as const satisfies readonly ModeId[];

/** True for the Beat Runner and the Paddle Keep-Up modes (no rings: they own their playfields). */
export function isJdmRhythmMode(mode: ModeId | string | null | undefined): boolean {
  return mode === "runner" || mode === "paddle";
}

/** MIDI note of degree 0 before the root is added (C4). */
export const RHYTHM_BASE_MIDI = 60;

/** The degrees the notes climb: the Sound section's scale, or a diatonic major scale while it is chromatic. */
export function rhythmScale(scale: ScaleId): readonly number[] {
  return scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[scale];
}

/** MIDI note of scale degree `degree` (0 = the root at C4 + root; negative degrees go below it). */
export function rhythmDegreeMidi(degree: number, scale: ScaleId, rootNote: number): number {
  const steps = rhythmScale(scale);
  const n = steps.length;
  const d = Math.round(Number.isFinite(degree) ? degree : 0);
  const octave = Math.floor(d / n);
  const k = d - octave * n;
  return RHYTHM_BASE_MIDI + normalizeRootNote(rootNote) + 12 * octave + steps[k];
}

/** Pitch (Hz) of scale degree `degree`. */
export function rhythmPitch(degree: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(rhythmDegreeMidi(degree, scale, rootNote));
}

/** The tonic triad and the octave above degree `degree` (a finale chord). */
export function rhythmChord(degree: number, scale: ScaleId, rootNote: number): number[] {
  const n = rhythmScale(scale).length;
  return [degree, degree + Math.min(2, n - 1), degree + Math.min(4, n - 1), degree + n].map((d) => rhythmPitch(d, scale, rootNote));
}

/** mulberry32: the visual particles' own seeded generator (never the physics stream). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamps a number-like value to a range; the fallback for anything that is not a finite number. */
export function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds to a slider step (so URL and preset values land on the slider). */
export function toStep(value: number, step: number): number {
  return step > 0 ? Number((Math.round(value / step) * step).toFixed(6)) : value;
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
