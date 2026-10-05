import { SCALE_INTERVALS, midiToFrequency } from "./scales";

/*
 * --- loop-foundation --- The pitch rules of the loop sound families (loopTones.ts), pure and unit-tested without Web Audio
 * (tests/loopTones.test.ts). Every note of a loop-style clip is caused by something on screen and its pitch encodes a physical
 * quantity: size (bigger = lower), position (left low, right high), a progress count (a rising ladder), the order of hits (a
 * run) or a category (a fixed degree). One key per video, major pentatonic by default (the `pentatonic` of scales.ts), and
 * the note sequence emerges from the physics – never a composed tune.
 */

/** The scales a loop family plays in: the major pentatonic of scales.ts, its relative minor pentatonic and the plain major. */
export const LOOP_SCALES = ["majorPentatonic", "minorPentatonic", "major"] as const;
export type LoopScale = (typeof LOOP_SCALES)[number];

/** The minor pentatonic (root, minor third, fourth, fifth, minor seventh): the "fail" colour and the darker keys. */
export const MINOR_PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];

/** Semitones above the root of every degree of one octave of each loop scale. */
export const LOOP_SCALE_INTERVALS: Readonly<Record<LoopScale, readonly number[]>> = {
  majorPentatonic: SCALE_INTERVALS.pentatonic,
  minorPentatonic: MINOR_PENTATONIC,
  major: SCALE_INTERVALS.major,
};

/** C3 (130.8 Hz): the bottom of the pluck register (C3–C6 holds a 14-degree span of the pentatonic). */
export const LOOP_BASE_MIDI = 48;
/** The roots a clip's key is picked from (C and A are the measured favourites): C3 and A2. */
export const LOOP_ROOTS: Readonly<Record<"C" | "A", number>> = { C: 48, A: 45 };
/** The default span of a size / position mapping: 14 pentatonic degrees, 2.8 octaves. */
export const LOOP_SPAN = 14;
/** A progress ladder wraps after this many degrees (2.5 octaves of the pentatonic), so it stays in register. */
export const LADDER_WRAP = 13;

export function isLoopScale(value: unknown): value is LoopScale {
  return typeof value === "string" && (LOOP_SCALES as readonly string[]).includes(value);
}

/**
 * The MIDI note of scale degree `degree` of `scale` on `rootMidi` (degree 0 = the root; 5 = the root an octave up in a
 * pentatonic; negative degrees go down). A fractional degree is rounded to the nearest one.
 */
export function degreeToMidi(degree: number, rootMidi: number = LOOP_BASE_MIDI, scale: LoopScale = "majorPentatonic"): number {
  const intervals = LOOP_SCALE_INTERVALS[scale] ?? LOOP_SCALE_INTERVALS.majorPentatonic;
  const n = intervals.length;
  const d = Number.isFinite(degree) ? Math.round(degree) : 0;
  const octave = Math.floor(d / n);
  return rootMidi + 12 * octave + intervals[d - octave * n];
}

/**
 * The degree (0 … `span`) a physical scalar maps to: `value` normalised over `min` … `max` (clamped), times the span, floored –
 * so equal values give equal degrees and successive equal degrees are allowed. With `invert` the top of the range is degree 0
 * (size: degree = floor((1 − sizeNorm) · span), the biggest object the lowest note). A range without width (min ≥ max) or a
 * value that is not a number gives the low end of the scalar (degree `span` inverted, else 0).
 */
export function scalarDegree(value: number, min: number, max: number, span: number = LOOP_SPAN, invert = false): number {
  const s = Number.isFinite(span) && span > 0 ? Math.floor(span) : 0;
  let norm = max > min && Number.isFinite(value) ? (value - min) / (max - min) : 0;
  norm = norm < 0 ? 0 : norm > 1 ? 1 : norm;
  const x = invert ? 1 - norm : norm;
  const degree = Math.floor(x * s + 1e-9);
  return degree > s ? s : degree;
}

/**
 * The MIDI note a physical scalar plays (`scalarDegree()` on `scale` from `rootMidi`): the pure pitch rule of the pentatonic
 * pluck – Grow plays `degreeFromScalar(log r, log r0, log cap, 14, true)`, so a bigger ball plays lower, a degree for every
 * couple of bounces.
 */
export function degreeFromScalar(value: number, min: number, max: number, span: number = LOOP_SPAN, invert = false, rootMidi: number = LOOP_BASE_MIDI, scale: LoopScale = "majorPentatonic"): number {
  return degreeToMidi(scalarDegree(value, min, max, span, invert), rootMidi, scale);
}

/** `degreeFromScalar()` in Hz (equal temperament, A4 = 440 Hz). */
export function frequencyFromScalar(value: number, min: number, max: number, span: number = LOOP_SPAN, invert = false, rootMidi: number = LOOP_BASE_MIDI, scale: LoopScale = "majorPentatonic"): number {
  return midiToFrequency(degreeFromScalar(value, min, max, span, invert, rootMidi, scale));
}

/** True when `midi` (rounded) is a note of `scale` on `rootMidi` – every note the loop rules give is. */
export function inLoopScale(midi: number, rootMidi: number = LOOP_BASE_MIDI, scale: LoopScale = "majorPentatonic"): boolean {
  const pc = (((Math.round(midi) - rootMidi) % 12) + 12) % 12;
  return (LOOP_SCALE_INTERVALS[scale] ?? []).includes(pc);
}

/**
 * The audible progress bar (the progress-ladder family): every piece placed / line cleared plays the next degree up, the
 * ladder wraps after `wrap` degrees and resets to its base at a completion; the descending variant steps down from the base
 * (a volley's hit order). Pure state: `step()` returns the degree of the step it took.
 */
export class LoopLadder {
  private index = 0;

  constructor(
    private readonly base = 0,
    private readonly wrap: number = LADDER_WRAP,
    private readonly direction: 1 | -1 = 1,
  ) {}

  /** The degree of the next step, then advances (wrapping after `wrap` steps). */
  step(): number {
    const w = this.wrap > 0 ? Math.floor(this.wrap) : 1;
    const degree = this.base + this.direction * (this.index % w);
    this.index++;
    return degree;
  }

  /** Steps taken since the last reset. */
  get steps(): number {
    return this.index;
  }

  /** Back to the base (a completion, the start of a volley). */
  reset() {
    this.index = 0;
  }
}
