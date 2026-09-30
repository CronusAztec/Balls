/**
 * The swoosh of a Journey stage transition (feature gerald-journey; lib/physics/modes/journey.ts): the camera whooshes
 * down to the next stage and the ear follows – seeded white noise (the String Battle's noise buffer) through a band-pass
 * whose centre sweeps up from `bandFrom` to `bandTo` Hz, rising and falling in loudness, with a quiet sine glide from
 * `glideFrom` to `glideTo` Hz underneath for body. It is an effect, not a note: never snapped to the scale, never a
 * melody note or a hit sample; the ToneGenerator (`playSwoosh()`) schedules it on the beat grid when the beat lock is on
 * and ducks the music bed. The recipe is data and the scheduling a pure function of the audio graph, testable with a
 * fake AudioContext.
 */
export interface SwooshTone {
  /** Seconds the whoosh lasts. */
  duration: number;
  /** Peak gain of the noise and the moment it peaks (fraction of the duration). */
  gain: number;
  peakAt: number;
  /** The band-pass sweep (Hz) and its Q. */
  bandFrom: number;
  bandTo: number;
  q: number;
  /** The sine glide under it (Hz) and its peak gain. */
  glideFrom: number;
  glideTo: number;
  glideGain: number;
}

export const SWOOSH_TONE: SwooshTone = { duration: 0.42, gain: 0.5, peakAt: 0.45, bandFrom: 420, bandTo: 3600, q: 1.4, glideFrom: 180, glideTo: 720, glideGain: 0.05 };

/** Builds and starts the swoosh at `time` (AudioContext seconds) into `destination`, from the noise in `noise`. */
export function scheduleSwooshTone(ctx: BaseAudioContext, destination: AudioNode, time: number, noise: AudioBuffer, tone: SwooshTone = SWOOSH_TONE) {
  const end = time + tone.duration;
  const peak = time + tone.duration * tone.peakAt;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = tone.q;
  band.frequency.setValueAtTime(tone.bandFrom, time);
  band.frequency.exponentialRampToValueAtTime(tone.bandTo, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(tone.gain, peak);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(band);
  band.connect(gain);
  gain.connect(destination);
  source.start(time, 0, Math.min(noise.duration, tone.duration + 0.02));
  source.stop(end + 0.02);

  const glide = ctx.createOscillator();
  const glideGain = ctx.createGain();
  glide.type = "sine";
  glide.frequency.value = tone.glideFrom;
  glide.frequency.setValueAtTime(tone.glideFrom, time);
  glide.frequency.exponentialRampToValueAtTime(tone.glideTo, end);
  glideGain.gain.setValueAtTime(0.0001, time);
  glideGain.gain.exponentialRampToValueAtTime(tone.glideGain, peak);
  glideGain.gain.exponentialRampToValueAtTime(0.0001, end);
  glide.connect(glideGain);
  glideGain.connect(destination);
  glide.start(time);
  glide.stop(end + 0.02);
}
