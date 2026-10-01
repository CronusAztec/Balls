/**
 * --- unlimited --- The gulp: the sound of a ball eating the arena (No limits; lib/physics/limits.ts).
 *
 * A viral ending, not an error: a deep sine that dives an octave and a half (the swallow), a low-passed noise "chomp" on
 * top and a short high blip at the end (the burp of satisfaction). It is an effect, not a note: never snapped to the
 * scale, never a melody note, a hit sample or a song slice; the ToneGenerator (`playArenaEaten()`) schedules it on the
 * beat grid when the beat lock is on and ducks the music bed. The recipe is data and the scheduling a pure function of
 * the audio graph, testable with a fake AudioContext.
 */
export interface GulpTone {
  /** Seconds the swallow lasts, its start and end pitch (Hz) and peak gain. */
  duration: number;
  from: number;
  to: number;
  gain: number;
  /** The chomp: seconds of noise, the low-pass cut-off (Hz) and its gain. */
  chomp: number;
  cutoff: number;
  chompGain: number;
  /** The blip at the end: pitch (Hz), seconds and gain. */
  blip: number;
  blipDuration: number;
  blipGain: number;
}

export const GULP_TONE: GulpTone = { duration: 0.9, from: 220, to: 38, gain: 0.55, chomp: 0.16, cutoff: 900, chompGain: 0.45, blip: 1320, blipDuration: 0.08, blipGain: 0.12 };

/** Builds and starts the gulp at `time` (AudioContext seconds) into `destination`, the chomp from the noise in `noise`. */
export function scheduleGulpTone(ctx: BaseAudioContext, destination: AudioNode, time: number, noise: AudioBuffer, tone: GulpTone = GULP_TONE) {
  const end = time + tone.duration;
  const swallow = ctx.createOscillator();
  const swallowGain = ctx.createGain();
  swallow.type = "sine";
  swallow.frequency.setValueAtTime(tone.from, time);
  swallow.frequency.exponentialRampToValueAtTime(tone.to, end);
  swallowGain.gain.setValueAtTime(0.0001, time);
  swallowGain.gain.exponentialRampToValueAtTime(tone.gain, time + 0.04);
  swallowGain.gain.exponentialRampToValueAtTime(0.0001, end);
  swallow.connect(swallowGain);
  swallowGain.connect(destination);
  swallow.start(time);
  swallow.stop(end + 0.02);

  const chomp = ctx.createBufferSource();
  chomp.buffer = noise;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.setValueAtTime(tone.cutoff, time);
  const chompGain = ctx.createGain();
  chompGain.gain.setValueAtTime(tone.chompGain, time);
  chompGain.gain.exponentialRampToValueAtTime(0.0001, time + tone.chomp);
  chomp.connect(low);
  low.connect(chompGain);
  chompGain.connect(destination);
  chomp.start(time, 0, Math.min(noise.duration, tone.chomp + 0.02));
  chomp.stop(time + tone.chomp + 0.02);

  const blipAt = end - 0.05;
  const blip = ctx.createOscillator();
  const blipGain = ctx.createGain();
  blip.type = "triangle";
  blip.frequency.setValueAtTime(tone.blip, blipAt);
  blipGain.gain.setValueAtTime(0.0001, blipAt);
  blipGain.gain.exponentialRampToValueAtTime(tone.blipGain, blipAt + 0.01);
  blipGain.gain.exponentialRampToValueAtTime(0.0001, blipAt + tone.blipDuration);
  blip.connect(blipGain);
  blipGain.connect(destination);
  blip.start(blipAt);
  blip.stop(blipAt + tone.blipDuration + 0.02);
}
