import { multiplierArpeggio } from "@/lib/physics/multipliers";
import { playVoice, type InstrumentId, type PluckCache } from "./instruments";

/**
 * The sound of a stat multiplier stacking (a pickup orb in the ring modes, a gate of the multipliers board): a quick
 * rising arpeggio that climbs with the new total – more notes and a higher root the bigger the stack
 * (`multiplierArpeggio()` in lib/physics/multipliers.ts). The ToneGenerator plays it like every other sound
 * (`playMultiplier()`): with the bounce instrument (or, with a melody loaded, rooted on the melody's next note with the
 * melody voice), as a hit sample transposed to every note in sample mode, as the next slice while the song slicer is
 * on, snapped to the scale, its first note on the beat grid when the beat lock is on, and ducking the music bed.
 */

/** Seconds between two notes of the arpeggio, the length of one note and the level of the first. */
export const ARPEGGIO_STEP = 0.065;
export const ARPEGGIO_NOTE = 0.2;
export const ARPEGGIO_GAIN = 0.2;

export interface ArpeggioNote {
  frequency: number;
  /** Seconds after the first note. */
  offset: number;
  gain: number;
}

/**
 * The notes of the arpeggio for a new total, optionally re-rooted on `root` (Hz – a melody's next note): evenly spaced,
 * each a little louder than the last so the run lands on its top note.
 */
export function arpeggioNotes(total: number, root?: number): ArpeggioNote[] {
  const freqs = multiplierArpeggio(total);
  const shift = root !== undefined && root > 0 && freqs.length > 0 ? root / freqs[0] : 1;
  return freqs.map((f, i) => ({ frequency: f * shift, offset: i * ARPEGGIO_STEP, gain: ARPEGGIO_GAIN * (0.8 + (0.4 * i) / Math.max(1, freqs.length - 1)) }));
}

/** Plays the notes with `instrument` from `time` (AudioContext seconds) into `out`; `snap` places each pitch on the scale. */
export function scheduleArpeggio(
  ctx: BaseAudioContext,
  out: AudioNode,
  instrument: InstrumentId,
  notes: readonly ArpeggioNote[],
  time: number,
  snap: (frequency: number) => number = (f) => f,
  pluckCache?: PluckCache,
) {
  for (const note of notes) playVoice(ctx, out, instrument, { frequency: snap(note.frequency), time: time + note.offset, duration: ARPEGGIO_NOTE, gain: note.gain }, pluckCache);
}
