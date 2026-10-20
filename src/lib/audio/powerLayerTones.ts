/**
 * --- power-layers-crack --- The crack of one Power Layers layer (lib/physics/modes/powerLayers.ts), played by
 * `ToneGenerator.playPowerLayerCrack()`: the ball drills through the stack layer by layer and every layer that gives way
 * cracks – a short high-passed noise snap (the glass giving way) over a bright, quickly damped sine ping at the layer's
 * note with its octave and a faint inharmonic shimmer above it, and a soft low tick under it for weight (all sine voices). A cascade of them
 * climbs the scale as the ball sinks, so a big hit is a rising rattle of glassy ticks.
 *
 * The recipe is data and the scheduling a pure function of the audio graph (testable with a fake AudioContext), like the
 * other tone modules.
 */

export interface CrackTone {
  /** The snap: seconds, peak gain at level 1, high-pass cutoff (Hz) and Q. */
  snapDuration: number;
  snapGain: number;
  snapCutoff: number;
  snapQ: number;
  /** The ping: the fundamental's peak gain and decay (s), the octave's share of it and decay, the shimmer's ratio, share and decay. */
  pingGain: number;
  pingDecay: number;
  octaveShare: number;
  octaveDecay: number;
  shimmerRatio: number;
  shimmerShare: number;
  shimmerDecay: number;
  /** The tick under it: two octaves below the ping, its peak gain and decay (s). */
  tickGain: number;
  tickDecay: number;
}

export const CRACK_TONE: CrackTone = {
  snapDuration: 0.014,
  snapGain: 0.2,
  snapCutoff: 2600,
  snapQ: 0.9,
  pingGain: 0.16,
  pingDecay: 0.11,
  octaveShare: 0.45,
  octaveDecay: 0.06,
  shimmerRatio: 3.27,
  shimmerShare: 0.18,
  shimmerDecay: 0.035,
  tickGain: 0.12,
  tickDecay: 0.03,
};

/** The crack's pitch without one (C6). */
export const DEFAULT_CRACK_FREQUENCY = 1046.5;

/** The loudness of a crack of `level` (0–1; 1 when absent or invalid). */
export function crackLevel(level: number | undefined): number {
  return typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1;
}

/** A frequency to play: `frequency` when it is a positive number, else the default crack pitch. */
export function crackFrequency(frequency: number | undefined): number {
  return typeof frequency === "number" && Number.isFinite(frequency) && frequency > 0 ? frequency : DEFAULT_CRACK_FREQUENCY;
}

/** A damped sine at `frequency` from `time`, `gain` loud, gone after `decay` s, into `destination`. */
function ping(ctx: BaseAudioContext, destination: AudioNode, frequency: number, time: number, gain: number, decay: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0005, gain), time + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0005, time + decay);
  osc.connect(g);
  g.connect(destination);
  osc.start(time);
  osc.stop(time + decay + 0.02);
}

/** Builds and starts a crack at `time` (AudioContext seconds) into `destination`: the snap, the ping at `frequency`, the tick. */
export function scheduleCrack(ctx: BaseAudioContext, destination: AudioNode, time: number, frequency: number, noise: AudioBuffer, level = 1, tone: CrackTone = CRACK_TONE) {
  const loud = crackLevel(level);
  const f = crackFrequency(frequency);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = tone.snapCutoff;
  filter.Q.value = tone.snapQ;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0005, tone.snapGain * loud), time);
  g.gain.exponentialRampToValueAtTime(0.0005, time + tone.snapDuration);
  source.connect(filter);
  filter.connect(g);
  g.connect(destination);
  source.start(time, 0, Math.min(noise.duration, tone.snapDuration + 0.02));
  source.stop(time + tone.snapDuration + 0.02);
  ping(ctx, destination, f, time, tone.pingGain * loud, tone.pingDecay);
  ping(ctx, destination, 2 * f, time, tone.pingGain * tone.octaveShare * loud, tone.octaveDecay);
  ping(ctx, destination, f * tone.shimmerRatio, time, tone.pingGain * tone.shimmerShare * loud, tone.shimmerDecay);
  ping(ctx, destination, Math.max(40, f / 4), time, tone.tickGain * loud, tone.tickDecay);
}
