import { playVoice, type PluckCache } from "./instruments";

/**
 * The two effect sounds of the String Battle (feature odd-string-battle; lib/physics/modes/stringBattle.ts): a thread
 * that is cut plays a **pluck** – a Karplus–Strong string at the pitch the mode chose from the thread's length, with a
 * short bright "snap" transient on top – and a ball that shatters plays a **noise burst**: seeded white noise through a
 * band-pass (the glassy crack) with a fast decay, plus three high sine "tinkles" of falling shards. The ToneGenerator
 * schedules both at the time it hands over (the beat grid when the beat lock is on) and snaps the pluck to the scale;
 * the recipes are data and the scheduling pure functions of the audio graph, testable with a fake AudioContext.
 */

export interface PluckTone {
  /** Seconds the string rings and its peak gain. */
  duration: number;
  gain: number;
  /** The snap on top: a sine this many times the pitch, its gain and length. */
  snapRatio: number;
  snapGain: number;
  snapDuration: number;
}

export const STRING_PLUCK: PluckTone = { duration: 0.45, gain: 0.32, snapRatio: 4, snapGain: 0.06, snapDuration: 0.035 };

export interface ShatterTone {
  /** Seconds and peak gain of the noise burst. */
  duration: number;
  gain: number;
  /** Centre frequency (Hz) and Q of the band-pass that makes the noise glassy. */
  band: number;
  q: number;
  /** Pitches (Hz) of the shard tinkles, their gain, length and the delay between them. */
  tinkles: readonly number[];
  tinkleGain: number;
  tinkleDuration: number;
  tinkleStep: number;
}

export const SHATTER_BURST: ShatterTone = { duration: 0.42, gain: 0.42, band: 3200, q: 0.9, tinkles: [2637.02, 3520, 4186.01], tinkleGain: 0.045, tinkleDuration: 0.22, tinkleStep: 0.045 };

/** Seconds of noise a burst plays from (the buffer is rendered once per sample rate). */
export const NOISE_SECONDS = 0.5;
const NOISE_SEED = 0x51f15e;

/** Seeded white noise in [−1, 1) (a linear congruential generator), so a burst sounds the same every time. */
export function noiseSamples(length: number, seed = NOISE_SEED): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(0, Math.floor(length)));
  let state = seed >>> 0 || 1;
  for (let i = 0; i < out.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state / 4294967296) * 2 - 1;
  }
  return out;
}

/** The noise buffer per sample rate. */
export class NoiseCache {
  private buffer: AudioBuffer | null = null;

  get(ctx: BaseAudioContext): AudioBuffer {
    if (this.buffer && this.buffer.sampleRate === ctx.sampleRate) return this.buffer;
    const samples = noiseSamples(Math.round(ctx.sampleRate * NOISE_SECONDS));
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    this.buffer = buffer;
    return buffer;
  }

  clear() {
    this.buffer = null;
  }
}

/** Plays a cut thread's pluck at `frequency` (snapped through `snap`) from `time` into `out`. */
export function scheduleStringPluck(
  ctx: BaseAudioContext,
  out: AudioNode,
  frequency: number,
  time: number,
  snap: (frequency: number) => number = (f) => f,
  pluckCache?: PluckCache,
  tone: PluckTone = STRING_PLUCK,
) {
  const pitch = snap(frequency > 0 ? frequency : 440);
  playVoice(ctx, out, "pluck", { frequency: pitch, time, duration: tone.duration, gain: tone.gain }, pluckCache);
  const click = ctx.createOscillator();
  const g = ctx.createGain();
  click.type = "sine";
  click.frequency.value = pitch * tone.snapRatio;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(tone.snapGain, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, time + tone.snapDuration);
  click.connect(g);
  g.connect(out);
  click.start(time);
  click.stop(time + tone.snapDuration + 0.02);
}

/** Plays a ball's shatter from `time` into `out`: the band-passed noise burst from `noise` and the shard tinkles. */
export function scheduleShatterBurst(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, tone: ShatterTone = SHATTER_BURST) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = tone.band;
  band.Q.value = tone.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(tone.gain, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, time + tone.duration);
  source.connect(band);
  band.connect(g);
  g.connect(out);
  source.start(time);
  source.stop(time + tone.duration + 0.02);
  tone.tinkles.forEach((f, i) => {
    const t = time + 0.02 + i * tone.tinkleStep;
    const osc = ctx.createOscillator();
    const tg = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(tone.tinkleGain, t + 0.003);
    tg.gain.exponentialRampToValueAtTime(0.001, t + tone.tinkleDuration);
    osc.connect(tg);
    tg.connect(out);
    osc.start(t);
    osc.stop(t + tone.tinkleDuration + 0.02);
  });
}
