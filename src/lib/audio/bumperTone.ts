/**
 * The pinball "ding" of an obstacle-editor bumper (lib/physics/obstacleEditor.ts): a bright bell – a sine at the pitch
 * with a quick upward blip at the attack, plus a slightly inharmonic triangle partial a little over an octave up that
 * dies away faster – so a bumper kick stands out from the plain bounce tones. The ToneGenerator schedules it at the
 * time it hands over (on the beat grid when the beat lock is on) and snaps the pitch to the current scale through
 * `snap`; the recipe is data and the scheduling a pure function of the audio graph, testable with a fake AudioContext.
 */
export interface BumperTone {
  /** Seconds the body of the ding rings. */
  duration: number;
  /** Peak gain of the body (the partial plays at `partialGain`). */
  gain: number;
  /** The attack starts this factor above the pitch and drops onto it over `blip` seconds. */
  blipRatio: number;
  blip: number;
  /** Frequency ratio, level and length of the upper partial. */
  partialRatio: number;
  partialGain: number;
  partialDuration: number;
}

export const BUMPER_TONE: BumperTone = { duration: 0.32, gain: 0.26, blipRatio: 1.5, blip: 0.03, partialRatio: 2.76, partialGain: 0.09, partialDuration: 0.12 };

/** Pitch of a bumper hit without one (C6). */
export const DEFAULT_BUMPER_FREQUENCY = 1046.5;

/** Builds and starts the ding at `time` (AudioContext seconds) into `destination`. */
export function scheduleBumperTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  frequency: number,
  time: number,
  snap: (frequency: number) => number = (f) => f,
  tone: BumperTone = BUMPER_TONE,
) {
  const pitch = snap(frequency > 0 ? frequency : DEFAULT_BUMPER_FREQUENCY);
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = "sine";
  body.frequency.value = pitch;
  body.frequency.setValueAtTime(pitch * tone.blipRatio, time);
  body.frequency.exponentialRampToValueAtTime(pitch, time + tone.blip);
  bodyGain.gain.setValueAtTime(0, time);
  bodyGain.gain.linearRampToValueAtTime(tone.gain, time + 0.004);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + tone.duration);
  body.connect(bodyGain);
  bodyGain.connect(destination);
  body.start(time);
  body.stop(time + tone.duration + 0.02);

  const partial = ctx.createOscillator();
  const partialGain = ctx.createGain();
  partial.type = "triangle";
  partial.frequency.value = pitch * tone.partialRatio;
  partialGain.gain.setValueAtTime(0, time);
  partialGain.gain.linearRampToValueAtTime(tone.partialGain, time + 0.003);
  partialGain.gain.exponentialRampToValueAtTime(0.001, time + tone.partialDuration);
  partial.connect(partialGain);
  partialGain.connect(destination);
  partial.start(time);
  partial.stop(time + tone.partialDuration + 0.02);
}
