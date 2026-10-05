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
}

/** The `playLoop()` options a loop sound event carries (its duration, glide target, brightness, chord; `accent` = a last step). */
export function loopPlayOptions(ev: SoundEvent): LoopPlayOptions {
  return { durationSec: ev.loopSec, toFrequency: ev.loopTo, bright: ev.loopBright, chord: ev.chord, last: ev.accent };
}
