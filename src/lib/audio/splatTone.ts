/**
 * --- gerald-exit-splat --- The splat of the splat barrier (lib/physics/splats.ts): a ball that hits a ring wall leaves a
 * blob of paint there with a short, wet "splat" – seeded white noise (the String Battle's noise buffer) through a low-pass
 * whose cut-off drops fast from `bandFrom` to `bandTo` Hz, with a soft sine "blop" gliding down from `blopFrom` to `blopTo`
 * Hz under it for the body of the paint. It is an effect, not a note: never snapped to the scale, never a melody note or a
 * song slice; the ToneGenerator (`playSplat()`) schedules it on the beat grid when the beat lock is on (without taking a
 * bounce's slot), ducks the music bed and, in sample mode, plays the hit sample instead (an octave down and softer). The
 * recipe is data and the scheduling a pure function of the audio graph, testable with a fake AudioContext.
 */
export interface SplatTone {
  /** Seconds the noise burst lasts. */
  duration: number;
  /** Peak gain of the noise at level 1, and its attack (s). */
  gain: number;
  attack: number;
  /** The low-pass sweep (Hz) and its Q. */
  bandFrom: number;
  bandTo: number;
  q: number;
  /** The blop under it: its glide (Hz), peak gain at level 1 and length (s). */
  blopFrom: number;
  blopTo: number;
  blopGain: number;
  blopTime: number;
}

export const SPLAT_TONE: SplatTone = { duration: 0.16, gain: 0.34, attack: 0.002, bandFrom: 2600, bandTo: 320, q: 0.8, blopFrom: 260, blopTo: 95, blopGain: 0.14, blopTime: 0.09 };

/** The loudness of a splat of `level` (0–1; 0.6 when absent or invalid). */
export function splatLevel(level: number | undefined): number {
  return level === undefined || !Number.isFinite(level) ? 0.6 : Math.max(0, Math.min(1, level));
}

/** The playback rate of the hit sample that stands in for the splat in sample mode: an octave down. */
export const SPLAT_SAMPLE_RATE = 0.5;
/** Its loudness relative to a bounce's at level 1. */
export const SPLAT_SAMPLE_GAIN = 0.55;

/**
 * Builds and starts the splat at `time` (AudioContext seconds) into `destination`, from the noise in `noise` (read from
 * `offset` s in, so consecutive splats do not sound identical), `level` loud.
 */
export function scheduleSplatTone(ctx: BaseAudioContext, destination: AudioNode, time: number, noise: AudioBuffer, level = 1, offset = 0, tone: SplatTone = SPLAT_TONE) {
  const loud = splatLevel(level);
  const end = time + tone.duration;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.value = tone.q;
  lowpass.frequency.setValueAtTime(tone.bandFrom, time);
  lowpass.frequency.exponentialRampToValueAtTime(tone.bandTo, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(Math.max(0.0015, tone.gain * loud), time + tone.attack);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  source.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(destination);
  const room = Math.max(0, noise.duration - tone.duration - 0.02);
  const from = room > 0 ? ((offset % room) + room) % room : 0;
  source.start(time, from, Math.min(noise.duration - from, tone.duration + 0.02));
  source.stop(end + 0.02);

  const blop = ctx.createOscillator();
  const blopGain = ctx.createGain();
  blop.type = "sine";
  blop.frequency.value = tone.blopFrom;
  blop.frequency.setValueAtTime(tone.blopFrom, time);
  blop.frequency.exponentialRampToValueAtTime(tone.blopTo, time + tone.blopTime);
  blopGain.gain.setValueAtTime(0, time);
  blopGain.gain.linearRampToValueAtTime(Math.max(0.0015, tone.blopGain * loud), time + tone.attack);
  blopGain.gain.exponentialRampToValueAtTime(0.001, time + tone.blopTime);
  blop.connect(blopGain);
  blopGain.connect(destination);
  blop.start(time);
  blop.stop(time + tone.blopTime + 0.02);
}
