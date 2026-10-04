import { playVoice, type PluckCache } from "./instruments";

/**
 * --- string-circle --- The two sounds of the String Battle's circle style (lib/physics/modes/stringCircle.ts), played by
 * `ToneGenerator.playStringCircle()`:
 *
 * - **twang** – the strings the balls anchored: per team note a plucked string (the Karplus–Strong pluck of the instruments)
 *   with the twang of a string pulled taut on top – a soft triangle starting a fifth above the note and gliding down onto it
 *   within a few tens of milliseconds. The anchors of a step come as one event of up to three team notes (a chord), each at
 *   its share of the level, so twenty a second shimmer instead of buzzing;
 * - **snap** – strings cut: a short, bright crack of band-passed noise (the battle's seeded noise buffer) over a quick sine
 *   ping at the note of the fan that lost them, louder with more strings cut at once.
 *
 * The KO is the battle's own shatter (stringBattleTones.ts). Recipes are data and the scheduling pure functions of the audio
 * graph, testable with a fake AudioContext, like the other tone modules.
 */

export interface TwangTone {
  /** The pluck's peak gain at level 1 and how long it rings (s). */
  gain: number;
  duration: number;
  /** The glide on top: it starts at the note times `bendRatio` and reaches the note after `bendTime` s; its peak gain and decay (s). */
  bendRatio: number;
  bendTime: number;
  bendGain: number;
  bendDecay: number;
}

export const TWANG_TONE: TwangTone = { gain: 0.24, duration: 0.45, bendRatio: 1.5, bendTime: 0.045, bendGain: 0.05, bendDecay: 0.12 };

export interface SnapTone {
  /** The crack: seconds, peak gain at level 1, the band's centre (Hz) and Q. */
  noiseDuration: number;
  noiseGain: number;
  band: number;
  q: number;
  /** The ping under it: peak gain at level 1 and decay (s). */
  pingGain: number;
  pingDecay: number;
}

export const SNAP_TONE: SnapTone = { noiseDuration: 0.035, noiseGain: 0.3, band: 4800, q: 0.8, pingGain: 0.1, pingDecay: 0.07 };

/** The loudness factor of a `level` (clamped to 0–1; anything that is not a number is 1). */
export function scLevel(level: number | undefined): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 1;
  return Math.max(0, Math.min(1, level));
}

/** Plays a twang of `pitches` (Hz, a chord's notes – each at 1/√n of the level) from `time` into `out`. */
export function scheduleTwang(ctx: BaseAudioContext, out: AudioNode, pitches: readonly number[], time: number, level = 1, pluckCache?: PluckCache, tone: TwangTone = TWANG_TONE) {
  const notes = pitches.filter((f) => f > 0);
  if (notes.length === 0) return;
  const share = scLevel(level) / Math.sqrt(notes.length);
  for (const f of notes) {
    playVoice(ctx, out, "pluck", { frequency: f, time, duration: tone.duration, gain: tone.gain * share }, pluckCache);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = f * tone.bendRatio;
    osc.frequency.setValueAtTime(f * tone.bendRatio, time);
    osc.frequency.exponentialRampToValueAtTime(f, time + tone.bendTime);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(tone.bendGain * share, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, time + tone.bendDecay);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + tone.bendDecay + 0.02);
  }
}

/** Plays a snap at `frequency` (Hz) from `time` into `out`: the crack from `noise` and the ping. */
export function scheduleSnap(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, noise: AudioBuffer, level = 1, tone: SnapTone = SNAP_TONE) {
  const k = scLevel(level);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = tone.band;
  band.Q.value = tone.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(tone.noiseGain * k, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, time + tone.noiseDuration);
  source.connect(band);
  band.connect(g);
  g.connect(out);
  source.start(time);
  source.stop(time + tone.noiseDuration + 0.02);
  const ping = ctx.createOscillator();
  const pg = ctx.createGain();
  ping.type = "sine";
  ping.frequency.value = frequency > 0 ? frequency : 880;
  pg.gain.setValueAtTime(0, time);
  pg.gain.linearRampToValueAtTime(tone.pingGain * k, time + 0.002);
  pg.gain.exponentialRampToValueAtTime(0.0005, time + tone.pingDecay);
  ping.connect(pg);
  pg.connect(out);
  ping.start(time);
  ping.stop(time + tone.pingDecay + 0.02);
}
