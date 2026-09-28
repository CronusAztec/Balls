/**
 * The two sounds of the ball interactions (lib/physics/interactions.ts): a merge plays a low tone that
 * sinks an octave, a split a high one that rises an octave. Each is a single oscillator with a short
 * envelope, scheduled at the time the ToneGenerator hands over (so the beat lock applies) and snapped
 * to the current scale through the `snap` callback. The recipe is data and the scheduling a pure
 * function of the audio graph, so both are testable through a fake AudioContext.
 */
export interface InteractionTone {
  type: OscillatorType;
  /** Starting pitch in Hz. */
  frequency: number;
  /** Pitch the tone glides to over its duration. */
  endFrequency: number;
  /** Seconds. */
  duration: number;
  /** Peak gain. */
  gain: number;
}

export const INTERACTION_TONES = {
  /** C3 sinking to C2: a soft, low "thump" as two balls become one. */
  merge: { type: "sine", frequency: 130.81, endFrequency: 65.41, duration: 0.45, gain: 0.4 },
  /** C6 rising to C7: a short, bright chirp as one ball becomes two. */
  split: { type: "triangle", frequency: 1046.5, endFrequency: 2093, duration: 0.18, gain: 0.22 },
} as const satisfies Record<string, InteractionTone>;

export type InteractionKind = keyof typeof INTERACTION_TONES;

/** Builds and starts the tone at `time` (AudioContext seconds) into `destination`. */
export function scheduleInteractionTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  tone: InteractionTone,
  time: number,
  snap: (frequency: number) => number = (f) => f,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = snap(tone.frequency);
  osc.type = tone.type;
  osc.frequency.value = start;
  osc.frequency.setValueAtTime(start, time);
  osc.frequency.exponentialRampToValueAtTime(snap(tone.endFrequency), time + tone.duration);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(tone.gain, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, time + tone.duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + tone.duration + 0.02);
}
