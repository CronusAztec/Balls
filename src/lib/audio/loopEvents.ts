import type { SoundEvent } from "@/lib/physics/types";

/*
 * --- loop-foundation --- What a loop sound event (`SoundEvent.loop`) asks of `ToneGenerator.playLoop()` besides its kind,
 * pitch and level – shared by the three dispatchers (the page's sound loop in Simulator.tsx, the fast export's
 * `playSoundEvent()`, the other arenas' `playArenaSound()`), so they stay in step.
 */

/** The options of one loop sound (`ToneGenerator.playLoop()`). */
export interface LoopPlayOptions {
  /** Seconds a glide, a wash, a ratchet or a riser lasts. */
  durationSec?: number;
  /** The glide's target pitch (Hz). */
  toFrequency?: number;
  /** The pluck's 3f partial (a small or fast object). */
  bright?: boolean;
  /** A dense mode's shorter pluck ring (0.75 s instead of 1.5 s). */
  dense?: boolean;
  /** The last step of a ladder run (+3 dB); the chiptune ladder step. */
  last?: boolean;
  chip?: boolean;
  /** The completion chord's minor colour and tremolo. */
  minor?: boolean;
  tremolo?: boolean;
  /** Pitches (Hz) of an impact's re-struck chord. */
  chord?: readonly number[];
  /** The drone's pen speed (0–1). */
  speed?: number;
  /** --- song-ring --- The pitch as given: not snapped to the Sound section's scale (a note of a fixed tune). */
  exact?: boolean;
}

/** The `playLoop()` options a loop sound event carries (its duration, glide target, brightness, chord; `accent` = a last step). */
export function loopPlayOptions(ev: SoundEvent): LoopPlayOptions {
  // --- ellipse-foci --- (the groove bed's minor chords) --- colour-sort --- (the completion chord's tremolo and minor colour)
  // --- drawing-machine --- (a drone's pen speed: its ripple and scratch)
  return { durationSec: ev.loopSec, toFrequency: ev.loopTo, bright: ev.loopBright, chord: ev.chord, last: ev.accent, tremolo: ev.loopTremolo, minor: ev.loopMinor, speed: ev.loopSpeed, ...(ev.loopChip ? { chip: true } : {}) /* --- perfect-fit --- (the chip ladder) */, ...(ev.loopExact ? { exact: true } : {}) /* --- song-ring --- (a fixed tune's note) */ };
}

// --- ring-voices --- (review fix B2)
/**
 * A ring mode's voice event (`SoundEvent.ringVoice`) as the page plays it: as it is while the visitor has no sound of their own;
 * with one (`ownSound`: a song to slice, a melody, a hit sample, a wall-break clip – `ToneGenerator.hasOwnSound()`), a
 * "contact" voice becomes the plain bounce or break it stands for, so the song steps on, the melody plays its note, the sample
 * and the clip sound, the beat lock places it and the face reacts to the break, as in Classic – and an "extra" (a sound with no
 * contact behind it) is left out (null). Shared by the page's sound loop (Simulator.tsx) and the fast export's
 * `playSoundEvent()`, so a clip sounds as the page did.
 */
export function ringVoiceEvent(ev: SoundEvent, ownSound: boolean): SoundEvent | null {
  if (!ev.ringVoice || !ownSound) return ev;
  if (ev.ringVoice === "extra") return null;
  return ev.type === "gap" ? { type: "gap", wallIndex: ev.wallIndex } : { type: "hit", wallIndex: ev.wallIndex };
}
