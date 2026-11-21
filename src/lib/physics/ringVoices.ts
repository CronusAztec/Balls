import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- ring-voices --- The voices of the single-ring escape modes, which all played the engine's one 800 Hz blip and the same
 * arpeggio: Countdown, Color Match and Accumulation each get notes of their own, sent from their hooks as loop-family sound
 * events (lib/audio/loopTones.ts: the pentatonic pluck, the ladder step, the land thump, the completion chord). Every note is
 * something on screen and its pitch says what:
 *
 *  - Countdown: a right hit is a step of a ladder that climbs with every number and lands on the tonic with the last one
 *    (`countdownStepHz()`), a bell on it, the last one with the chord; every other bounce is a soft pluck an octave under the step the run is waiting
 *    for (`countdownSeekHz()`), so the search itself climbs as the countdown runs down.
 *  - Color Match: a bounce plays the note of the colour the ball turns (`colourNoteHz()`: colour k is degree k, so the cycle
 *    of colours is a scale); a match is its note with its triad struck over it (`colourChordHz()`), the last match the chord.

 *  - Accumulation: a bounce is a pluck that climbs as the ball's timer runs down (`timerPluckHz()`) and falls back with the
 *    next ball, a bounce off a frozen ball a high plink (`icePlinkHz()`), a freeze – on a spike or when the timer runs out –
 *    a thump a step lower for every ball already frozen (`freezeThumpHz()`) with a glassy crack over it, the way out the chord.
 *
 * A bounce is one "hit" event and a break one "gap" event, as before these voices: the modes swap the sound each event
 * makes, never how many there are, and each carries `ringVoice: "contact"`. The sounds that are events of their own are
 * Accumulation's freeze (the thump and the crack; on a spike the thump is the hit the engine's tone was), marked
 * `ringVoice: "extra"`: the crew's measured moments leave the extras out (lib/insights/score.ts: they counted them, and the
 * role eval's corpus moved – review fix B2), and the planner's facts read the first sound (a bounce, long before a timer
 * runs out) and the last one only in the rhythm modes' lastNote clips. A tick of the timer is not sent: the bounces climb
 * as it runs down instead. A visitor who brought a sound of their own (a song to slice, a melody, a hit sample, a
 * wall-break clip) hears it instead of these voices, as in Classic (lib/audio/loopEvents.ts `ringVoiceEvent()`).
 *
 * All in C major pentatonic, like Classic's ring sounds (ringEscape.ts). Pure: the modes call these with their own state,
 * never with a random draw, and a sound never moves a ball – a seed's run and its fingerprint are what they were.
 */

/** C5: the Countdown ladder's and the ticks' root. */
const LADDER_ROOT_MIDI = 72;
/** The ladder's last step: degree 10 of the pentatonic on C5 is C7, the tonic two octaves up. */
export const COUNTDOWN_TOP_DEGREE = 10;
/** C4: the colours' root. */
const COLOUR_ROOT_MIDI = 60;
/** The colours' notes wrap after two octaves of the pentatonic, so a hundred colours stay in register. */
export const COLOUR_WRAP = 10;
/** G3: the plucks of a ball on its timer start here. */
const TIMER_ROOT_MIDI = 55;
/** Degrees a ball's plucks climb over its timer. */
export const TIMER_SPAN = 7;

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * The step a right hit plays with `remaining` numbers still to hit after it: the last one (0) is C7, the one before it a
 * pentatonic degree lower, and so on down to C5 – a countdown longer than eleven starts on C5 and begins to climb when ten
 * are left.
 */
export function countdownStepHz(remaining: number): number {
  return midiToFrequency(degreeToMidi(COUNTDOWN_TOP_DEGREE - Math.min(COUNTDOWN_TOP_DEGREE, whole(remaining)), LADDER_ROOT_MIDI));
}

/** The soft pluck of a bounce that is not the hit, with `left` numbers still to hit: an octave under the step the run waits for. */
export function countdownSeekHz(left: number): number {
  return countdownStepHz(Math.max(0, whole(left) - 1)) / 2;
}

/** The note of colour `index`: degree `index` of the pentatonic on C4, wrapping after COLOUR_WRAP degrees. */
export function colourNoteHz(index: number): number {
  return midiToFrequency(degreeToMidi(whole(index) % COLOUR_WRAP, COLOUR_ROOT_MIDI));
}

/** The triad a match of colour `index` plays: its note with the pentatonic degrees two and four above it. */
export function colourChordHz(index: number): [number, number, number] {
  const degree = whole(index) % COLOUR_WRAP;
  return [0, 2, 4].map((up) => midiToFrequency(degreeToMidi(degree + up, COLOUR_ROOT_MIDI))) as [number, number, number];
}

/** The pluck of a bounce with `leftMs` of `maxMs` on the ball's timer: G3 with a full timer, TIMER_SPAN degrees up as it runs out. */
export function timerPluckHz(leftMs: number, maxMs: number): number {
  const spent = maxMs > 0 && Number.isFinite(leftMs) ? Math.max(0, Math.min(1, 1 - leftMs / maxMs)) : 0;
  return midiToFrequency(degreeToMidi(Math.min(TIMER_SPAN, Math.floor(spent * (TIMER_SPAN + 1))), TIMER_ROOT_MIDI));
}

/** The thump of a freeze on a spike with `frozen` balls already frozen: G2, a semitone lower for each of them, never under G1. */
export function freezeThumpHz(frozen: number): number {
  return midiToFrequency(43 - Math.min(12, whole(frozen)));
}

/** The glassy crack over a freeze, and the plink of a bounce off a frozen ball: high pentatonic notes, a degree lower per frozen ball (wrapping). */
export function icePlinkHz(frozen: number): number {
  return midiToFrequency(degreeToMidi(14 - (whole(frozen) % 5), COLOUR_ROOT_MIDI));
}
