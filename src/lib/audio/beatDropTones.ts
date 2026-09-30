import type { BeatDropPadKind } from "@/lib/simulation/beatDropPlan";

/**
 * The drum kit and the pad accents of Beat Drop (feature beat-drop; lib/physics/modes/beatDrop.ts): every landing plays a
 * synthesised drum – a **kick** (a sine sweeping down from 150 Hz with a click on top) on beats 1 and 3 of the bar, louder on
 * the downbeat, a **snare** (band-limited noise and a short tonal body) on the backbeats 2 and 4 – and an off-beat **hat**
 * (high-passed noise) sounds between two landings; on top, the obstruction the ball landed on has its own **accent**: a
 * plank's wood-block knock, a block's low thud, a spring's "boing" (a rising glide with a wobble), a wedge's metallic tick, a
 * spinner's zip and a drum pad's tom. The ToneGenerator (`playBeatDrop()`) schedules them at the time it hands over – on the
 * beat grid when the beat lock is on – snaps the accent's pitch to the scale and leaves the music bed the lead: with a bed
 * playing only the downbeat's kick and the accents play, so the landings accent the song instead of drumming over it
 * (`beatDropVoices()`). The recipes are data and the scheduling pure functions of the audio graph (testable with a fake
 * AudioContext); the noise comes from the seeded buffer the String Battle's shatter uses (stringBattleTones.ts), so a hit
 * sounds the same every time – in a recording and in the fast export's offline render alike.
 */

export interface KickTone {
  /** The body sweeps from `start` to `end` Hz over `sweep` seconds and rings `duration` seconds at peak gain `gain`. */
  start: number;
  end: number;
  sweep: number;
  duration: number;
  gain: number;
  /** The beater's click: a short triangle blip at `clickFrequency`. */
  clickFrequency: number;
  clickGain: number;
  clickDuration: number;
}

export interface SnareTone {
  /** The noise: high-passed at `highpass` Hz, `noiseDuration` seconds at `noiseGain`. */
  highpass: number;
  noiseDuration: number;
  noiseGain: number;
  /** The shell's body: a triangle at `bodyFrequency` Hz. */
  bodyFrequency: number;
  bodyGain: number;
  bodyDuration: number;
}

export interface HatTone {
  highpass: number;
  duration: number;
  gain: number;
}

export const KICK_TONE: KickTone = { start: 150, end: 44, sweep: 0.11, duration: 0.42, gain: 0.62, clickFrequency: 1800, clickGain: 0.12, clickDuration: 0.012 };
export const SNARE_TONE: SnareTone = { highpass: 1400, noiseDuration: 0.19, noiseGain: 0.34, bodyFrequency: 190, bodyGain: 0.26, bodyDuration: 0.11 };
export const HAT_TONE: HatTone = { highpass: 7200, duration: 0.05, gain: 0.13 };

/** A pad's accent: an oscillator gliding from the pitch to `glide` × the pitch, with optional wobble, partial and noise. */
export interface PadAccentTone {
  wave: OscillatorType;
  /** Octaves above / below the accent pitch the voice starts at (2^octave). */
  octave: number;
  glide: number;
  duration: number;
  gain: number;
  /** A vibrato (Hz, depth as a fraction of the pitch) – the spring's wobble. */
  vibratoRate?: number;
  vibratoDepth?: number;
  /** An inharmonic partial (× the pitch) – the wedge's metal. */
  partial?: number;
  partialGain?: number;
  /** A band-passed noise burst at `noiseBand` Hz – the drum pad's skin, the spinner's zip. */
  noiseGain?: number;
  noiseBand?: number;
  noiseDuration?: number;
}

export const PAD_ACCENTS: Record<BeatDropPadKind, PadAccentTone> = {
  plank: { wave: "triangle", octave: 1, glide: 0.92, duration: 0.07, gain: 0.2 },
  block: { wave: "sine", octave: -1, glide: 0.6, duration: 0.14, gain: 0.26 },
  spring: { wave: "sine", octave: 0, glide: 2.4, duration: 0.36, gain: 0.2, vibratoRate: 22, vibratoDepth: 0.06 },
  wedge: { wave: "square", octave: 1, glide: 1, duration: 0.08, gain: 0.07, partial: 2.76, partialGain: 0.05 },
  spinner: { wave: "sawtooth", octave: 0, glide: 3, duration: 0.11, gain: 0.07, noiseGain: 0.08, noiseBand: 5200, noiseDuration: 0.09 },
  drum: { wave: "sine", octave: -1, glide: 0.62, duration: 0.3, gain: 0.34, noiseGain: 0.12, noiseBand: 900, noiseDuration: 0.08 },
};

/** Default accent pitch (Hz) when an event carries none: A4. */
export const DEFAULT_ACCENT_FREQUENCY = 440;

/** The levels (0 = silent) of the voices one Beat Drop sound event plays. */
export interface BeatDropVoices {
  kick: number;
  snare: number;
  hat: number;
  accent: number;
}

/**
 * Which voices a Beat Drop event plays and how loud: its drum (the kick – louder on the downbeat –, the snare, the hat) and
 * the pad's accent. With a music bed playing the bed leads: only the downbeat's kick and the accents remain.
 */
export function beatDropVoices(drum: string | undefined, hasPad: boolean, bedPlaying: boolean, downbeat: boolean, out: BeatDropVoices = { kick: 0, snare: 0, hat: 0, accent: 0 }): BeatDropVoices {
  out.kick = 0;
  out.snare = 0;
  out.hat = 0;
  out.accent = 0;
  if (drum === "kick") out.kick = bedPlaying ? (downbeat ? 0.7 : 0) : downbeat ? 1 : 0.8;
  else if (drum === "snare") out.snare = bedPlaying ? 0 : 1;
  else if (drum === "hat") out.hat = bedPlaying ? 0 : 1;
  if (hasPad) out.accent = downbeat ? 1 : 0.85;
  return out;
}

/** An exponential decay envelope on a fresh gain node: 0 → `peak` in `attack` s, down to silence by `time + duration`. */
function envelope(ctx: BaseAudioContext, out: AudioNode, time: number, peak: number, duration: number, attack = 0.002): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(Math.max(1e-4, peak), time + attack);
  g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(attack + 0.005, duration));
  g.connect(out);
  return g;
}

/** Plays a kick at `time` (AudioContext seconds) into `out`, `level` × its recipe's loudness. */
export function scheduleKick(ctx: BaseAudioContext, out: AudioNode, time: number, level = 1, tone: KickTone = KICK_TONE) {
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.value = tone.start;
  body.frequency.setValueAtTime(tone.start, time);
  body.frequency.exponentialRampToValueAtTime(tone.end, time + tone.sweep);
  body.connect(envelope(ctx, out, time, tone.gain * level, tone.duration, 0.003));
  body.start(time);
  body.stop(time + tone.duration + 0.02);
  const click = ctx.createOscillator();
  click.type = "triangle";
  click.frequency.value = tone.clickFrequency;
  click.connect(envelope(ctx, out, time, tone.clickGain * level, tone.clickDuration, 0.001));
  click.start(time);
  click.stop(time + tone.clickDuration + 0.02);
}

/** A noise burst from `noise` through a filter of `type` at `frequency` Hz, `duration` seconds at `peak`. */
function noiseBurst(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, time: number, type: BiquadFilterType, frequency: number, peak: number, duration: number, q = 0.8) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  source.connect(filter);
  filter.connect(envelope(ctx, out, time, peak, duration, 0.001));
  source.start(time);
  source.stop(time + duration + 0.02);
}

/** Plays a snare at `time` into `out`: high-passed noise and the shell's body. */
export function scheduleSnare(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, level = 1, tone: SnareTone = SNARE_TONE) {
  noiseBurst(ctx, out, noise, time, "highpass", tone.highpass, tone.noiseGain * level, tone.noiseDuration);
  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.value = tone.bodyFrequency;
  body.frequency.setValueAtTime(tone.bodyFrequency, time);
  body.frequency.exponentialRampToValueAtTime(tone.bodyFrequency * 0.75, time + tone.bodyDuration);
  body.connect(envelope(ctx, out, time, tone.bodyGain * level, tone.bodyDuration, 0.002));
  body.start(time);
  body.stop(time + tone.bodyDuration + 0.02);
}

/** Plays a closed hat at `time` into `out`. */
export function scheduleHat(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, level = 1, tone: HatTone = HAT_TONE) {
  noiseBurst(ctx, out, noise, time, "highpass", tone.highpass, tone.gain * level, tone.duration, 0.7);
}

/** The pitch (Hz) an accent's oscillator starts at for a snapped accent pitch. */
export function accentStartFrequency(kind: BeatDropPadKind, frequency: number): number {
  const f = frequency > 0 && Number.isFinite(frequency) ? frequency : DEFAULT_ACCENT_FREQUENCY;
  return f * Math.pow(2, PAD_ACCENTS[kind].octave);
}

/** Plays the accent of a pad of `kind` at `frequency` (already snapped) from `time` into `out`. */
export function schedulePadAccent(ctx: BaseAudioContext, out: AudioNode, kind: BeatDropPadKind, frequency: number, time: number, noise: AudioBuffer, level = 1) {
  const tone = PAD_ACCENTS[kind];
  const start = accentStartFrequency(kind, frequency);
  const osc = ctx.createOscillator();
  osc.type = tone.wave;
  osc.frequency.value = start;
  osc.frequency.setValueAtTime(start, time);
  if (tone.glide !== 1) osc.frequency.exponentialRampToValueAtTime(start * tone.glide, time + tone.duration);
  const env = envelope(ctx, out, time, tone.gain * level, tone.duration, 0.002);
  osc.connect(env);
  osc.start(time);
  osc.stop(time + tone.duration + 0.02);
  if (tone.vibratoRate && tone.vibratoDepth) {
    // The spring's wobble: an LFO on the pitch.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = tone.vibratoRate;
    depth.gain.value = start * tone.vibratoDepth;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(time);
    lfo.stop(time + tone.duration + 0.02);
  }
  if (tone.partial && tone.partialGain) {
    const p = ctx.createOscillator();
    p.type = "sine";
    p.frequency.value = start * tone.partial;
    p.connect(envelope(ctx, out, time, tone.partialGain * level, tone.duration * 0.8, 0.001));
    p.start(time);
    p.stop(time + tone.duration + 0.02);
  }
  if (tone.noiseGain && tone.noiseBand && tone.noiseDuration) noiseBurst(ctx, out, noise, time, "bandpass", tone.noiseBand, tone.noiseGain * level, tone.noiseDuration, 1.2);
}
