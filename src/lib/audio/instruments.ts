/**
 * Instrument voices for the bounce sounds. `playVoice()` builds a short Web Audio graph
 * for one note and lets it free itself when the note ends, so a voice costs nothing
 * between hits. The synthesis recipes:
 *  - sine / triangle / square / saw: a plain oscillator with an exponential decay
 *    (triangle is today's default bounce tone, kept bit-for-bit);
 *  - pluck: Karplus–Strong – a burst of noise fed through a feedback delay line whose
 *    length sets the pitch. Web Audio's DelayNode cannot go below one render quantum
 *    (128 samples ≈ 340 Hz) inside a feedback loop, so the delay line is rendered in
 *    software by `renderPluck()` (pure, seeded, unit-tested) and played from a buffer;
 *  - marimba: two-operator FM – a sine carrier whose frequency is modulated by a sine
 *    four times higher with a modulation index that collapses within ~100 ms, giving
 *    the woody "tonk" of a mallet hit;
 *  - chip: a square wave that starts an octave up and drops to the target pitch in a
 *    few tens of milliseconds, like an 8-bit sound chip blip.
 */

export const INSTRUMENT_IDS = ["sine", "triangle", "square", "saw", "pluck", "marimba", "chip"] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

export function isInstrumentId(value: unknown): value is InstrumentId {
  return typeof value === "string" && (INSTRUMENT_IDS as readonly string[]).includes(value);
}

/** One note to play: `time` is an AudioContext time (may be slightly in the past). */
export interface Voice {
  frequency: number;
  time: number;
  /** Nominal length in seconds; percussive instruments ring for roughly this long. */
  duration: number;
  /** Peak gain, 0–1; the louder waveforms are scaled down to match the default triangle. */
  gain: number;
}

/** How long a plucked string rings in seconds (seeded noise → deterministic samples). */
export const PLUCK_DURATION = 0.45;
const PLUCK_SEED = 0x9e3779b9;

/**
 * Renders a Karplus–Strong pluck into PCM samples. The delay line (one period long) starts
 * full of white noise; each pass averages neighbouring samples (a one-zero low-pass) and
 * scales them by `decay`, so highs die first and the burst turns into a plucked string.
 * The last 20 ms fade out linearly to avoid a click when the buffer ends.
 */
export function renderPluck(sampleRate: number, frequency: number, duration = PLUCK_DURATION, decay = 0.996, seed = PLUCK_SEED): Float32Array<ArrayBuffer> {
  const period = Math.max(2, Math.round(sampleRate / Math.max(20, frequency)));
  const length = Math.max(period, Math.round(sampleRate * duration));
  const out = new Float32Array(length);
  const ring = new Float32Array(period);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < period; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    ring[i] = (state / 4294967296) * 2 - 1;
  }
  let index = 0;
  for (let i = 0; i < length; i++) {
    const current = ring[index];
    const next = ring[index + 1 === period ? 0 : index + 1];
    out[i] = current;
    ring[index] = decay * 0.5 * (current + next);
    index = index + 1 === period ? 0 : index + 1;
  }
  const fade = Math.min(length, Math.round(sampleRate * 0.02));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

/** Caches rendered pluck buffers per (sample rate, pitch); melodies reuse a few dozen notes. */
export class PluckCache {
  private buffers = new Map<string, AudioBuffer>();

  get(ctx: BaseAudioContext, frequency: number): AudioBuffer {
    const key = `${ctx.sampleRate}:${frequency.toFixed(1)}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      if (this.buffers.size >= 128) this.buffers.clear();
      const samples = renderPluck(ctx.sampleRate, frequency);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  clear() {
    this.buffers.clear();
  }
}

/** Relative loudness so that switching instrument does not change the perceived volume much. */
const LEVEL: Record<InstrumentId, number> = {
  sine: 1,
  triangle: 1,
  square: 0.45,
  saw: 0.55,
  pluck: 0.8,
  marimba: 1,
  chip: 0.45,
};

const OSC_TYPE: Partial<Record<InstrumentId, OscillatorType>> = { sine: "sine", triangle: "triangle", square: "square", saw: "sawtooth" };

/** Plays one note of `instrument` into `out`; the nodes disconnect themselves when done. */
export function playVoice(ctx: BaseAudioContext, out: AudioNode, instrument: InstrumentId, voice: Voice, pluckCache?: PluckCache): void {
  const gain = voice.gain * LEVEL[instrument];
  switch (instrument) {
    case "pluck":
      return playPluck(ctx, out, voice, gain, pluckCache);
    case "marimba":
      return playMarimba(ctx, out, voice, gain);
    case "chip":
      return playChip(ctx, out, voice, gain);
    default:
      return playOscillator(ctx, out, OSC_TYPE[instrument] || "triangle", voice, gain);
  }
}

function playOscillator(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, voice: Voice, gain: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = voice.frequency;
  osc.connect(env);
  env.connect(out);
  env.gain.setValueAtTime(gain, voice.time);
  env.gain.exponentialRampToValueAtTime(0.01, voice.time + voice.duration);
  osc.start(voice.time);
  osc.stop(voice.time + voice.duration);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}

function playPluck(ctx: BaseAudioContext, out: AudioNode, voice: Voice, gain: number, cache?: PluckCache) {
  const source = ctx.createBufferSource();
  source.buffer = cache ? cache.get(ctx, voice.frequency) : renderPluckBuffer(ctx, voice.frequency);
  const env = ctx.createGain();
  env.gain.value = gain;
  source.connect(env);
  env.connect(out);
  source.start(voice.time);
  source.onended = () => {
    source.disconnect();
    env.disconnect();
  };
}

function renderPluckBuffer(ctx: BaseAudioContext, frequency: number): AudioBuffer {
  const samples = renderPluck(ctx.sampleRate, frequency);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

function playMarimba(ctx: BaseAudioContext, out: AudioNode, voice: Voice, gain: number) {
  const t = voice.time;
  const length = Math.max(0.25, voice.duration * 2);
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modDepth = ctx.createGain();
  const env = ctx.createGain();
  carrier.type = "sine";
  carrier.frequency.value = voice.frequency;
  modulator.type = "sine";
  modulator.frequency.value = voice.frequency * 4;
  // Modulation index starts high (bright attack) and collapses fast (dull, woody sustain).
  modDepth.gain.setValueAtTime(voice.frequency * 1.6, t);
  modDepth.gain.exponentialRampToValueAtTime(voice.frequency * 0.02, t + 0.1);
  modulator.connect(modDepth);
  modDepth.connect(carrier.frequency);
  carrier.connect(env);
  env.connect(out);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.001, t + length);
  carrier.start(t);
  modulator.start(t);
  carrier.stop(t + length);
  modulator.stop(t + length);
  carrier.onended = () => {
    carrier.disconnect();
    modulator.disconnect();
    modDepth.disconnect();
    env.disconnect();
  };
}

function playChip(ctx: BaseAudioContext, out: AudioNode, voice: Voice, gain: number) {
  const t = voice.time;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(voice.frequency * 2, t);
  osc.frequency.exponentialRampToValueAtTime(voice.frequency, t + 0.045);
  osc.connect(env);
  env.connect(out);
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.01, t + voice.duration);
  osc.start(t);
  osc.stop(t + voice.duration);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}
