/**
 * --- land-claim --- The sounds of Land Claim (lib/physics/modes/landClaim.ts), played by `ToneGenerator.playLandClaim()`:
 *
 * - **knock** – a block knocked off its column (or claimed): a short wooden click – a band-passed noise tick over two
 *   quickly damped sine partials a wood block has (the fundamental and an inharmonic 2.76× above it), pitched by the column;
 * - **spawn** – a new ball: a quick bright chime, three sine notes rising a third and a fifth with a soft octave partial;
 * - **ko** – a column's last block: a low thump falling an octave under a short dark noise burst; `accent` (the last block of
 *   the arena, the verdict) makes it louder and longer and adds a high sparkle.
 *
 * Recipes are data and the scheduling pure functions of the audio graph (testable with a fake AudioContext), like the other
 * tone modules.
 */

export interface KnockTone {
  /** The noise tick: seconds, peak gain at level 1, band (Hz) and Q. */
  tickDuration: number;
  tickGain: number;
  tickBand: number;
  tickQ: number;
  /** The wood: the fundamental's and the partial's peak gains, the partial's ratio, and their decay (s). */
  bodyGain: number;
  partialGain: number;
  partialRatio: number;
  bodyDecay: number;
  partialDecay: number;
}

export const KNOCK_TONE: KnockTone = { tickDuration: 0.018, tickGain: 0.28, tickBand: 3200, tickQ: 1.1, bodyGain: 0.3, partialGain: 0.12, partialRatio: 2.76, bodyDecay: 0.075, partialDecay: 0.04 };

export interface ChimeTone {
  /** The notes as ratios of the root, the gap between them (s), each note's decay (s), peak gain, and the octave partial's share. */
  ratios: readonly number[];
  gap: number;
  decay: number;
  gain: number;
  octave: number;
}

export const CHIME_TONE: ChimeTone = { ratios: [1, 1.25, 1.5], gap: 0.055, decay: 0.32, gain: 0.16, octave: 0.35 };

export interface KoTone {
  /** The thump: from the root down an octave over `drop` s, its peak gain and length (s). */
  drop: number;
  thumpGain: number;
  thumpTime: number;
  /** The burst: seconds, peak gain, low-pass cutoff (Hz). */
  burstTime: number;
  burstGain: number;
  cutoff: number;
  /** An accented KO: this much louder and longer, with a sparkle at 4× the root of this gain. */
  accentGain: number;
  accentLength: number;
  sparkleGain: number;
}

export const KO_TONE: KoTone = { drop: 0.16, thumpGain: 0.42, thumpTime: 0.24, burstTime: 0.12, burstGain: 0.22, cutoff: 1300, accentGain: 1.5, accentLength: 1.8, sparkleGain: 0.1 };

/** The knock's pitch without one (E5), and the KO's root without one (C3). */
export const DEFAULT_KNOCK_FREQUENCY = 659.25;
export const DEFAULT_KO_FREQUENCY = 130.81;

/** The loudness of a sound of `level` (0–1; 1 when absent or invalid). */
export function lcLevel(level: number | undefined): number {
  return typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1;
}

/** A frequency to play: `frequency` when it is a positive number, else `fallback`. */
export function lcFrequency(frequency: number | undefined, fallback: number): number {
  return typeof frequency === "number" && Number.isFinite(frequency) && frequency > 0 ? frequency : fallback;
}

/** A damped sine at `frequency` from `time`, `gain` loud, gone after `decay` s, into `destination`. */
function ping(ctx: BaseAudioContext, destination: AudioNode, frequency: number, time: number, gain: number, decay: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0005, gain), time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, time + decay);
  osc.connect(g);
  g.connect(destination);
  osc.start(time);
  osc.stop(time + decay + 0.02);
}

/** A filtered noise burst from `time`, `gain` loud, `duration` s long, into `destination`. */
function burst(ctx: BaseAudioContext, destination: AudioNode, noise: AudioBuffer, time: number, type: BiquadFilterType, frequency: number, q: number, gain: number, duration: number) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0005, gain), time);
  g.gain.exponentialRampToValueAtTime(0.0005, time + duration);
  source.connect(filter);
  filter.connect(g);
  g.connect(destination);
  source.start(time, 0, Math.min(noise.duration, duration + 0.02));
  source.stop(time + duration + 0.02);
}

/** Builds and starts a knock at `time` (AudioContext seconds) into `destination`: the tick and the wood at `frequency`. */
export function scheduleKnock(ctx: BaseAudioContext, destination: AudioNode, time: number, frequency: number, noise: AudioBuffer, level = 1, tone: KnockTone = KNOCK_TONE) {
  const loud = lcLevel(level);
  const f = lcFrequency(frequency, DEFAULT_KNOCK_FREQUENCY);
  burst(ctx, destination, noise, time, "bandpass", tone.tickBand, tone.tickQ, tone.tickGain * loud, tone.tickDuration);
  ping(ctx, destination, f, time, tone.bodyGain * loud, tone.bodyDecay);
  ping(ctx, destination, f * tone.partialRatio, time, tone.partialGain * loud, tone.partialDecay);
}

/** Builds and starts a spawn chime rooted on `frequency` at `time` into `destination`. */
export function scheduleSpawnChime(ctx: BaseAudioContext, destination: AudioNode, time: number, frequency: number, level = 1, tone: ChimeTone = CHIME_TONE) {
  const loud = lcLevel(level);
  const f = lcFrequency(frequency, 2 * DEFAULT_KNOCK_FREQUENCY);
  tone.ratios.forEach((ratio, i) => {
    const t = time + i * tone.gap;
    ping(ctx, destination, f * ratio, t, tone.gain * loud, tone.decay);
    ping(ctx, destination, 2 * f * ratio, t, tone.gain * tone.octave * loud, 0.6 * tone.decay);
  });
}

/** Builds and starts a KO rooted on `frequency` at `time` into `destination` (`accent`: the last block of the arena). */
export function scheduleKo(ctx: BaseAudioContext, destination: AudioNode, time: number, frequency: number, noise: AudioBuffer, level = 1, accent = false, tone: KoTone = KO_TONE) {
  const loud = lcLevel(level) * (accent ? tone.accentGain : 1);
  const length = accent ? tone.accentLength : 1;
  const f = lcFrequency(frequency, DEFAULT_KO_FREQUENCY);
  const thump = ctx.createOscillator();
  const g = ctx.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(f, time);
  thump.frequency.exponentialRampToValueAtTime(Math.max(20, f / 2), time + tone.drop * length);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0005, tone.thumpGain * loud), time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0005, time + tone.thumpTime * length);
  thump.connect(g);
  g.connect(destination);
  thump.start(time);
  thump.stop(time + tone.thumpTime * length + 0.02);
  burst(ctx, destination, noise, time, "lowpass", tone.cutoff, 0.7, tone.burstGain * loud, tone.burstTime * length);
  if (accent) ping(ctx, destination, 4 * f, time + 0.01, tone.sparkleGain * loud, 0.5);
}
