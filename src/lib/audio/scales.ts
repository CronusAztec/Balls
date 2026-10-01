/**
 * Musical grids for the bounce sounds, as pure functions so they can be unit-tested
 * without Web Audio:
 *  - pitch: snap any frequency to the nearest degree of a scale (major, minor, pentatonic…)
 *    built on a root note, so wall tones and melody notes always sound "in key";
 *  - time: the next point of a BPM grid (quarter, eighth or sixteenth notes) so a bounce
 *    sound can be delayed onto the beat.
 * The tone generator (toneGenerator.ts) applies both; the settings object decides when.
 */

export const SCALE_IDS = ["chromatic", "major", "minor", "pentatonic", "blues", "wholeTone"] as const;
export type ScaleId = (typeof SCALE_IDS)[number];

/** Semitone offsets from the root that belong to each scale (one octave). */
export const SCALE_INTERVALS: Record<ScaleId, readonly number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
};

/** Pitch-class names for the root-note picker (index = semitones above C). */
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const ROOT_NOTE_MIN = 0;
export const ROOT_NOTE_MAX = 11;

export function isScaleId(value: unknown): value is ScaleId {
  return typeof value === "string" && (SCALE_IDS as readonly string[]).includes(value);
}

/** Frequency in Hz → (fractional) MIDI note number; 440 Hz = A4 = 69. */
export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/** MIDI note number → frequency in Hz (equal temperament, A4 = 440 Hz). */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Clamps and rounds a root note into 0–11 (C … B); anything else falls back to C. */
export function normalizeRootNote(root: unknown): number {
  const n = Math.round(Number(root));
  if (!Number.isFinite(n)) return 0;
  return ((n % 12) + 12) % 12;
}

/**
 * Snaps a (possibly fractional) MIDI note to the nearest note of `scale` on `root`.
 * The chromatic scale leaves the pitch untouched (free pitch – this keeps the default
 * bounce tones exactly as they were). Exact ties go to the lower note.
 */
export function quantizeMidi(midi: number, scale: ScaleId, root = 0): number {
  if (scale === "chromatic" || !Number.isFinite(midi)) return midi;
  const intervals = SCALE_INTERVALS[scale];
  const r = normalizeRootNote(root);
  const base = Math.floor(midi);
  let best = midi;
  let bestDistance = Infinity;
  // Every scale has a degree within an octave in each direction, so this window always finds one.
  for (let note = base - 12; note <= base + 13; note++) {
    const pitchClass = (((note - r) % 12) + 12) % 12;
    if (!intervals.includes(pitchClass)) continue;
    const distance = Math.abs(note - midi);
    if (distance < bestDistance - 1e-9) {
      best = note;
      bestDistance = distance;
    }
  }
  return best;
}

/** Frequency in Hz → the nearest frequency that belongs to `scale` on `root` (Hz). */
export function quantizeFrequency(frequency: number, scale: ScaleId, root = 0): number {
  if (scale === "chromatic" || !(frequency > 0)) return frequency;
  return midiToFrequency(quantizeMidi(frequencyToMidi(frequency), scale, root));
}

/* ------------------------------------------------------------------ beat grid */

export const QUANTIZE_GRIDS = ["1/4", "1/8", "1/16"] as const;
export type QuantizeGrid = (typeof QUANTIZE_GRIDS)[number];

export const BPM_MIN = 60;
export const BPM_MAX = 200;

export function isQuantizeGrid(value: unknown): value is QuantizeGrid {
  return typeof value === "string" && (QUANTIZE_GRIDS as readonly string[]).includes(value);
}

/**
 * Length of one grid step in seconds: a quarter note is one beat at the given BPM (from BPM_MIN; --- review fix (uncap-all)
 * --- no maximum: a BPM past the slider's 200 quantizes to its own, finer grid).
 */
export function gridStepSeconds(bpm: number, grid: QuantizeGrid): number {
  const beat = 60 / (Number.isFinite(bpm) ? Math.max(BPM_MIN, bpm) : BPM_MIN);
  switch (grid) {
    case "1/4":
      return beat;
    case "1/8":
      return beat / 2;
    case "1/16":
      return beat / 4;
  }
}

/**
 * The first grid point at or after `now` (seconds, e.g. AudioContext.currentTime), on a grid
 * anchored at `origin`. A point up to `tolerance` seconds in the past still counts as "now",
 * so floating-point noise never turns an on-beat event into a full step of delay.
 * The result is always within one grid step of `now`.
 */
export function nextGridTime(now: number, bpm: number, grid: QuantizeGrid, origin = 0, tolerance = 0.001): number {
  const step = gridStepSeconds(bpm, grid);
  const steps = Math.ceil((now - origin - tolerance) / step);
  return origin + steps * step;
}
