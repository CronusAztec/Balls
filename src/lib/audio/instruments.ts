/**
 * Instrument voices for the bounce sounds. `playVoice()` builds a short Web Audio graph
 * for one note and lets it free itself when the note ends, so a voice costs nothing
 * between hits. The synthesis recipes:
 *  - sine / triangle / square / saw: a plain oscillator with an exponential decay to a
 *    floor relative to its peak and a 5 ms fade after it (triangle is today's default
 *    bounce tone: its 0.25 → 0.01 decay is kept);
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
 * Renders a Karplus–Strong pluck into PCM samples. The delay line starts full of white noise;
 * each pass averages the sample with the one before it (a one-zero low-pass) and scales it by
 * `decay`, so highs die first and the burst turns into a plucked string. The averaging delays
 * the loop by half a sample and a first-order allpass (Jaffe–Smith) adds the fractional rest,
 * so the whole loop is exactly `sampleRate / frequency` samples long and the string plays in
 * tune (a whole-sample line alone would round the period and play up to ~50 cents sharp).
 * The last 20 ms fade out linearly to avoid a click when the buffer ends.
 */
export function renderPluck(sampleRate: number, frequency: number, duration = PLUCK_DURATION, decay = 0.996, seed = PLUCK_SEED): Float32Array<ArrayBuffer> {
  // --- review fix (audio) --- tuned loop: n whole samples + 0.5 (the average) + frac (the allpass) = sampleRate / frequency.
  const loop = sampleRate / Math.max(20, frequency);
  const n = Math.max(2, Math.floor(loop - 0.6));
  // frac stays in [0.1, 1.1) so the allpass stays well behaved; a pitch above what two samples can hold plays at the top.
  const frac = Math.max(0.1, loop - 0.5 - n);
  const c = (1 - frac) / (1 + frac);
  const length = Math.max(n, Math.round(sampleRate * duration));
  const out = new Float32Array(length);
  const ring = new Float32Array(n);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    ring[i] = 0.98 * ((state / 4294967296) * 2 - 1);
  }
  let index = 0;
  let previous = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < length; i++) {
    const delayed = ring[index];
    const average = decay * 0.5 * (delayed + previous);
    previous = delayed;
    const allpass = c * average + apIn - c * apOut;
    apIn = average;
    apOut = allpass;
    out[i] = delayed;
    ring[index] = allpass;
    index = index + 1 === n ? 0 : index + 1;
  }
  const fade = Math.min(length, Math.round(sampleRate * 0.02));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  // The allpass can overshoot the burst by a few per cent on the lowest notes: those are scaled back to full scale.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1) for (let i = 0; i < length; i++) out[i] /= peak;
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

// --- review fix (audio) ---
/**
 * Where a decaying voice ends, relative to its peak: the classic bounce decays from 0.25 to 0.01, so every level decays by
 * the same −28 dB (an absolute 0.01 floor let soft notes barely decay – or grow – before they stopped).
 */
export const DECAY_FLOOR = 0.04;
/** After the decay a voice fades to silence over this long before its oscillator stops, so the stop never clicks. */
export const RELEASE_SEC = 0.005;

/**
 * The exponential decay of a voice on `param`: from `gain` at `t` to `gain × DECAY_FLOOR` at `t + duration`, then linearly
 * to 0 over RELEASE_SEC. Returns the time the voice is silent (when to stop its oscillator).
 */
export function scheduleDecay(param: AudioParam, gain: number, t: number, duration: number): number {
  param.setValueAtTime(gain, t);
  param.exponentialRampToValueAtTime(Math.max(1e-6, gain * DECAY_FLOOR), t + duration);
  param.linearRampToValueAtTime(0, t + duration + RELEASE_SEC);
  return t + duration + RELEASE_SEC;
}
// --- end review fix (audio) ---

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
  const end = scheduleDecay(env.gain, gain, voice.time, voice.duration);
  osc.start(voice.time);
  osc.stop(end);
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
  env.gain.exponentialRampToValueAtTime(Math.max(1e-6, gain * 0.004), t + length); // −48 dB below the peak at every level (--- review fix (audio) ---)
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
  const end = scheduleDecay(env.gain, gain, t, voice.duration);
  osc.start(t);
  osc.stop(end);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}
