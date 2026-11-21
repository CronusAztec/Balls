import { SONG_RING_TUNES, type SongRingTuneId } from "@/lib/physics/modes/songRing";

/*
 * --- beat-machine-tunes --- The known tunes the marble xylophone plays (Beat Machines' "tune" source): one verse of each, its
 * bass line and the chord it ends on. The verse opens with the very phrase Song Ring plays (`SONG_RING_TUNES`, shared, never
 * copied) and goes on with the rest of the verse written below in the same form – MIDI pitch and length in slots – so a viewer
 * hears the tune through to its home note. Every melody is in the public domain (see Song Ring's list: a traditional tune or a
 * composer dead for well over a century).
 *
 * The machine's bars are the verse's own pitches, low to high (`tuneBarMidis()`), so every note lands on a bar of its exact
 * pitch: no scale snaps it. The loop is the verse and BM_TUNE_CODA_BEATS more, in which the last note's chord rings out under
 * the end banner (lib/physics/modes/beatMachine.ts, Canvas.tsx); `bpm` is the tempo a pick of the tune sets on the panel.
 */

/** The tunes, in the panel's order (the first is the start look's). */
export const BM_TUNES = ["ode", "twinkle", "jacques", "elise", "mountain"] as const satisfies readonly SongRingTuneId[];
export type BmTune = (typeof BM_TUNES)[number];

export function isBmTune(value: unknown): value is BmTune {
  return typeof value === "string" && (BM_TUNES as readonly string[]).includes(value);
}

/** Beats after the verse's last note's end in which its chord rings out before the loop starts over. */
export const BM_TUNE_CODA_BEATS = 2;

/** A verse beyond Song Ring's phrase. */
export interface BmTuneVerse {
  /** Beats one slot lasts: 1 for a tune in quarter notes, ½ for one in eighths or sixteenths. */
  slotBeats: number;
  /** The verse after Song Ring's phrase: MIDI pitch and length in slots, in playing order. */
  rest: readonly (readonly [midi: number, slots: number])[];
  /** The bass under the verse: the slot each note starts on and its MIDI pitch (a phrase bass each, held). */
  bass: readonly (readonly [slot: number, midi: number])[];
  /** The tempo (BPM) the tune is picked with. */
  bpm: number;
  /** The verse played this many times a loop (a short theme twice, as the piece itself does). */
  times: number;
}

/**
 * The rest of each verse:
 *  - ode: Ode to Joy's whole first period, the phrase answered twice (… C C D E E. D D, … C C D E D. C C), 32 beats;
 *  - twinkle: the three lines of the nursery tune (… F F E E D D C, G G F F E E D twice, then the first line again), 48 beats;
 *  - jacques: Frère Jacques once through (… E F G twice, G A G F E C twice, C G C twice), 32 beats;
 *  - elise: Für Elise's first period in sixteenths, from the phrase through C E A, B, E G# B, C, the return and E C B A;
 *  - mountain: the Mountain King's four-bar theme in eighths (… F C# F, E C E, the climb to B, A F# D F# A), twice.
 */
export const BM_TUNE_VERSES: Readonly<Record<BmTune, BmTuneVerse>> = {
  ode: {
    slotBeats: 1,
    rest: [[72, 1], [72, 1], [74, 1], [76, 1], [76, 1.5], [74, 0.5], [74, 2], [76, 1], [76, 1], [77, 1], [79, 1], [79, 1], [77, 1], [76, 1], [74, 1], [72, 1], [72, 1], [74, 1], [76, 1], [74, 1.5], [72, 0.5], [72, 2]],
    bass: [[0, 48], [4, 43], [8, 48], [12, 43], [16, 48], [20, 43], [24, 48], [28, 43], [30, 48]],
    bpm: 100,
    times: 1,
  },
  twinkle: {
    slotBeats: 1,
    rest: [[77, 1], [77, 1], [76, 1], [76, 1], [74, 1], [74, 1], [72, 2], [79, 1], [79, 1], [77, 1], [77, 1], [76, 1], [76, 1], [74, 2], [79, 1], [79, 1], [77, 1], [77, 1], [76, 1], [76, 1], [74, 2], [72, 1], [72, 1], [79, 1], [79, 1], [81, 1], [81, 1], [79, 2], [77, 1], [77, 1], [76, 1], [76, 1], [74, 1], [74, 1], [72, 2]],
    bass: [[0, 48], [4, 41], [6, 48], [8, 41], [10, 48], [12, 43], [14, 48], [16, 48], [18, 41], [20, 48], [22, 43], [24, 48], [26, 41], [28, 48], [30, 43], [32, 48], [36, 41], [38, 48], [40, 41], [42, 48], [44, 43], [46, 48]],
    bpm: 132,
    times: 1,
  },
  jacques: {
    slotBeats: 1,
    rest: [[76, 1], [77, 1], [79, 2], [76, 1], [77, 1], [79, 2], [79, 0.5], [81, 0.5], [79, 0.5], [77, 0.5], [76, 1], [72, 1], [79, 0.5], [81, 0.5], [79, 0.5], [77, 0.5], [76, 1], [72, 1], [72, 1], [67, 1], [72, 2], [72, 1], [67, 1], [72, 2]],
    bass: [[0, 48], [8, 48], [16, 48], [24, 43], [26, 48], [28, 43], [30, 48]],
    bpm: 100,
    times: 1,
  },
  elise: {
    slotBeats: 0.5,
    rest: [[60, 1], [64, 1], [69, 1], [71, 3], [64, 1], [68, 1], [71, 1], [72, 3], [64, 1], [76, 1], [75, 1], [76, 1], [75, 1], [76, 1], [71, 1], [74, 1], [72, 1], [69, 3], [60, 1], [64, 1], [69, 1], [71, 3], [64, 1], [72, 1], [71, 1], [69, 6]],
    bass: [[8, 45], [15, 40], [21, 45], [33, 45], [39, 40], [45, 45]],
    bpm: 150,
    times: 1,
  },
  mountain: {
    slotBeats: 0.5,
    rest: [[77, 1], [73, 1], [77, 2], [76, 1], [72, 1], [76, 2], [71, 1], [73, 1], [74, 1], [76, 1], [78, 1], [74, 1], [78, 1], [83, 1], [81, 1], [78, 1], [74, 1], [78, 1], [81, 4]],
    bass: [[0, 47], [8, 49], [12, 48], [16, 47], [24, 42]],
    bpm: 120,
    times: 2,
  },
};

/** One note of a tune's loop: its beat from the loop's start, its MIDI pitch and length (beats). */
export interface BmTuneNote {
  beat: number;
  midi: number;
  beats: number;
}

/** A tune laid out for one loop: its notes, its bass, the chord at its end and the loop's length. */
export interface BmTuneLoop {
  tune: BmTune;
  notes: BmTuneNote[];
  bass: { beat: number; midi: number }[];
  /** The last note's beat (where the chord rings and the banner comes up), the verse's end, the loop's beats (whole). */
  lastBeat: number;
  verseBeats: number;
  loopBeats: number;
  /** The chord's root (MIDI: Song Ring's own, C3 to A2) and colour. */
  chordRoot: number;
  minor: boolean;
}

/** The loop of `tune`: Song Ring's phrase, the verse's rest, `times` over; the bass under each pass; the chord on its last note. */
export function tuneLoop(tune: BmTune): BmTuneLoop {
  const head = SONG_RING_TUNES[tune];
  const verse = BM_TUNE_VERSES[tune];
  const k = verse.slotBeats;
  const notes: BmTuneNote[] = [];
  const bass: { beat: number; midi: number }[] = [];
  let slot = 0;
  for (let pass = 0; pass < Math.max(1, verse.times); pass++) {
    const from = slot;
    for (const [midi, slots] of [...head.notes, ...verse.rest]) {
      notes.push({ beat: slot * k, midi, beats: slots * k });
      slot += slots;
    }
    for (const [at, midi] of verse.bass) bass.push({ beat: (from + at) * k, midi });
  }
  const last = notes[notes.length - 1];
  const verseBeats = slot * k;
  return {
    tune,
    notes,
    bass,
    lastBeat: last.beat,
    verseBeats,
    loopBeats: Math.ceil(verseBeats - 1e-9) + BM_TUNE_CODA_BEATS,
    chordRoot: head.root,
    minor: head.minor,
  };
}

/** The bars of a tune: its distinct pitches (MIDI), low to high. */
export function tuneBarMidis(loop: Pick<BmTuneLoop, "notes">): number[] {
  return [...new Set(loop.notes.map((n) => n.midi))].sort((a, b) => a - b);
}
