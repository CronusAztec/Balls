import { playVoice, type InstrumentId, type PluckCache } from "./instruments";

/**
 * The two little tunes of the Square Racing Grand Prix (modes/race.ts), played through the ToneGenerator
 * (`playRaceArpeggio()`) like every other sound – the bounce instrument (or, with a melody loaded, rooted on the
 * melody's next note with the melody voice), the hit sample transposed to every note in sample mode, the next slice
 * while the song slicer plays, every pitch snapped to the scale, the first note on the beat grid, ducking the music bed:
 *
 * - **chime**: a quick rising major arpeggio (root, third, fifth, octave) when a racer overtakes another;
 * - **fanfare**: "ta-ta-ta-taaa, ta-TAAA" – a C-major arpeggio climbing to the octave and a held chord – when the winner
 *   crosses the finish line.
 *
 * Pure data plus one scheduling function (testable with a fake AudioContext).
 */

export type RaceArpeggioKind = "chime" | "fanfare";

export interface RaceNote {
  frequency: number;
  /** Seconds after the first note. */
  offset: number;
  /** Seconds the note sounds. */
  duration: number;
  gain: number;
}

/** Default roots: the chime from G5, the fanfare from C5. */
export const CHIME_ROOT = 783.99;
export const FANFARE_ROOT = 523.25;

const CHIME: readonly [number, number, number, number][] = [
  // ratio to the root, offset (s), duration (s), gain
  [1, 0, 0.14, 0.13],
  [1.25, 0.05, 0.14, 0.14],
  [1.5, 0.1, 0.16, 0.15],
  [2, 0.15, 0.3, 0.17],
];

const FANFARE: readonly [number, number, number, number][] = [
  [1, 0, 0.12, 0.17],
  [1.25, 0.1, 0.12, 0.17],
  [1.5, 0.2, 0.12, 0.18],
  [2, 0.3, 0.26, 0.2],
  [1.5, 0.5, 0.1, 0.17],
  [2, 0.6, 0.8, 0.2],
  [1.25, 0.6, 0.8, 0.12],
  [1.5, 0.6, 0.8, 0.12],
];

/** The notes of a tune, rooted on `root` (Hz) when given (a melody's next note, a racer's note), else on its default root. */
export function raceArpeggioNotes(kind: RaceArpeggioKind, root?: number): RaceNote[] {
  const table = kind === "fanfare" ? FANFARE : CHIME;
  const base = root !== undefined && Number.isFinite(root) && root > 0 ? root : kind === "fanfare" ? FANFARE_ROOT : CHIME_ROOT;
  return table.map(([ratio, offset, duration, gain]) => ({ frequency: base * ratio, offset, duration, gain }));
}

/** How long a tune lasts (s), its last note included. */
export function raceArpeggioLength(kind: RaceArpeggioKind): number {
  return raceArpeggioNotes(kind).reduce((end, n) => Math.max(end, n.offset + n.duration), 0);
}

/** Plays the notes with `instrument` from `time` (AudioContext seconds) into `out`; `snap` places each pitch on the scale. */
export function scheduleRaceNotes(
  ctx: BaseAudioContext,
  out: AudioNode,
  instrument: InstrumentId,
  notes: readonly RaceNote[],
  time: number,
  snap: (frequency: number) => number = (f) => f,
  pluckCache?: PluckCache,
) {
  for (const note of notes) playVoice(ctx, out, instrument, { frequency: snap(note.frequency), time: time + note.offset, duration: note.duration, gain: note.gain }, pluckCache);
}
