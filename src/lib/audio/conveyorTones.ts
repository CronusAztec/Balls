/**
 * The Conveyor Belt's machinery (lib/physics/modes/conveyor.ts, feature gerald-conveyor), and the drop-in click of the respawn
 * timer of Classic and Multiply (lib/physics/respawn.ts):
 *
 * - **hum** – the belt's motor while it carries a ball: a low sawtooth (and a quieter one a fifth above) through a low-pass
 *   filter, with a slow wobble in its pitch, fading in and out over `seconds`;
 * - **click** – a ball dropping off the belt: a short band-passed noise tick over a small sine "thunk" that drops in pitch.
 *
 * They are machinery, not notes: never snapped to the scale, never a melody note, a hit sample or a song slice (the bounces
 * around them are the notes). The ToneGenerator (`playConveyor()`) schedules them on the beat grid when the beat lock is on;
 * the click ducks the music bed, the hum sits under it. The recipes are data and the scheduling pure functions of the audio
 * graph, testable with a fake AudioContext.
 */

export interface HumTone {
  /** Peak gain of the main sawtooth at level 1, and of the one a fifth above (a share of it). */
  gain: number;
  fifth: number;
  /** Seconds the hum takes to swell and to fade. */
  attack: number;
  release: number;
  /** The low-pass filter's cutoff (Hz) and Q. */
  cutoff: number;
  q: number;
  /** The wobble: its rate (Hz) and depth (Hz). */
  wobbleRate: number;
  wobbleDepth: number;
}

export const HUM_TONE: HumTone = { gain: 0.09, fifth: 0.4, attack: 0.08, release: 0.14, cutoff: 380, q: 1.1, wobbleRate: 6, wobbleDepth: 1.6 };

export interface ClickTone {
  /** Seconds the noise tick lasts, its peak gain at level 1, the band it sits in (Hz) and the band's Q. */
  duration: number;
  gain: number;
  band: number;
  q: number;
  /** The thunk under it: from and to (Hz), its peak gain at level 1 and its length (s). */
  thunkFrom: number;
  thunkTo: number;
  thunkGain: number;
  thunkTime: number;
}

export const CLICK_TONE: ClickTone = { duration: 0.035, gain: 0.34, band: 2800, q: 1.3, thunkFrom: 240, thunkTo: 95, thunkGain: 0.22, thunkTime: 0.09 };

/** The hum's pitch without one (a low A). */
export const DEFAULT_HUM_FREQUENCY = 55;
/** The shortest and the longest hum (s): a ride is never shorter than the swell and the fade, nor longer than a long belt. */
export const MIN_HUM_SEC = 0.25;
export const MAX_HUM_SEC = 15;

/** The length (s) of a hum asked to last `seconds`: within `MIN_HUM_SEC` – `MAX_HUM_SEC` (1 s when it is not a number). */
export function humLength(seconds: number | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return 1;
  return Math.max(MIN_HUM_SEC, Math.min(MAX_HUM_SEC, seconds));
}

/** The loudness of a sound of `level` (0–1; 1 when absent or invalid). */
export function conveyorLevel(level: number | undefined): number {
  return typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1;
}

/** Builds and starts the belt's hum at `time` (AudioContext seconds) into `destination`, `seconds` long. */
export function scheduleConveyorHum(ctx: BaseAudioContext, destination: AudioNode, frequency: number, time: number, seconds: number, level = 1, tone: HumTone = HUM_TONE) {
  const length = humLength(seconds);
  const loud = conveyorLevel(level);
  const f = frequency > 0 && Number.isFinite(frequency) ? frequency : DEFAULT_HUM_FREQUENCY;
  const end = time + length;
  const attack = Math.min(tone.attack, length / 3);
  const release = Math.min(tone.release, length / 3);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tone.cutoff;
  filter.Q.value = tone.q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(Math.max(0.0005, tone.gain * loud), time + attack);
  gain.gain.setValueAtTime(Math.max(0.0005, tone.gain * loud), end - release);
  gain.gain.linearRampToValueAtTime(0, end);
  filter.connect(gain);
  gain.connect(destination);
  // The wobble: a slow sine on both saws' pitch.
  const wobble = ctx.createOscillator();
  const wobbleGain = ctx.createGain();
  wobble.type = "sine";
  wobble.frequency.value = tone.wobbleRate;
  wobbleGain.gain.value = tone.wobbleDepth;
  wobble.connect(wobbleGain);
  for (const [ratio, share] of [
    [1, 1],
    [1.5, tone.fifth],
  ] as const) {
    const saw = ctx.createOscillator();
    const sawGain = ctx.createGain();
    saw.type = "sawtooth";
    saw.frequency.value = f * ratio;
    wobbleGain.connect(saw.frequency);
    sawGain.gain.value = share;
    saw.connect(sawGain);
    sawGain.connect(filter);
    saw.start(time);
    saw.stop(end + 0.02);
  }
  wobble.start(time);
  wobble.stop(end + 0.02);
}

/** Builds and starts the click of a ball dropping off the belt at `time` (AudioContext seconds) into `destination`, from the noise in `noise`. */
export function scheduleConveyorClick(ctx: BaseAudioContext, destination: AudioNode, time: number, noise: AudioBuffer, level = 1, tone: ClickTone = CLICK_TONE) {
  const loud = conveyorLevel(level);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = tone.band;
  band.Q.value = tone.q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.0005, tone.gain * loud), time);
  gain.gain.exponentialRampToValueAtTime(0.0005, time + tone.duration);
  source.connect(band);
  band.connect(gain);
  gain.connect(destination);
  source.start(time, 0, Math.min(noise.duration, tone.duration + 0.02));
  source.stop(time + tone.duration + 0.02);

  const thunk = ctx.createOscillator();
  const thunkGain = ctx.createGain();
  thunk.type = "sine";
  thunk.frequency.value = tone.thunkFrom;
  thunk.frequency.setValueAtTime(tone.thunkFrom, time);
  thunk.frequency.exponentialRampToValueAtTime(tone.thunkTo, time + tone.thunkTime);
  thunkGain.gain.setValueAtTime(0, time);
  thunkGain.gain.linearRampToValueAtTime(Math.max(0.0005, tone.thunkGain * loud), time + 0.004);
  thunkGain.gain.exponentialRampToValueAtTime(0.0005, time + tone.thunkTime);
  thunk.connect(thunkGain);
  thunkGain.connect(destination);
  thunk.start(time);
  thunk.stop(time + tone.thunkTime + 0.02);
}
