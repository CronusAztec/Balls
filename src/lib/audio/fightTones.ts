import type { FightSoundKind } from "@/lib/physics/types";

/**
 * Fight League's sounds (lib/physics/modes/fightLeague.ts, feature fight-league): every weapon hit is an effect of its kind,
 * an ability a swell and a KO a heavy hit (`SoundEvent.fight`):
 *
 * - **blade** – a metallic ring (swords, claws, cards, a thrown shield): inharmonic sine partials (a struck bar's ratios)
 *   decaying at their own rates over a short high noise scrape;
 * - **blunt** – a thud (hammers, flails, fists, tails): a sine falling an octave and a half under a low-passed noise knock;
 * - **arrow** – a twang (bows): a plucked string that drops a little in pitch, and the arrow's whistle;
 * - **gun** – a shot (guns, shotguns): a band-passed noise crack over a low thump;
 * - **fire** – a whoosh (breath): noise swept up through a band-pass, swelling and fading;
 * - **magic** – a chime (wands, staffs, books, beams, sparks, webs, ice): two bell partials with a shimmer;
 * - **block** – a clang (a shield or bracers stopping a hit): a short, bright metallic ring and a click;
 * - **ability** – a swell (the 0.4 s telegraph): a rising fifth that grows louder until the cast;
 * - **ko** – a heavy hit: a deep boom with a noise crash.
 *
 * The weapon sounds take the hitting fighter's pitch (its own degree of the scale, snapped by the ToneGenerator) so a fight
 * stays in key; they are effects, not melody notes (never a hit sample or a song slice). The ToneGenerator
 * (`playFight()`) schedules them on the beat grid when the beat lock is on and ducks the music bed for the loud ones. The
 * recipes are data and the scheduling pure functions of the audio graph, testable with a fake AudioContext.
 */

export interface FightTone {
  /** Peak gain at level 1. */
  gain: number;
  /** Seconds the tone lasts. */
  duration: number;
  /** Pitch multiple of the event's frequency the tone is built on. */
  octave: number;
}

export const FIGHT_TONES: Readonly<Record<FightSoundKind, FightTone>> = {
  blade: { gain: 0.16, duration: 0.42, octave: 2 },
  blunt: { gain: 0.42, duration: 0.22, octave: 0.5 },
  arrow: { gain: 0.2, duration: 0.24, octave: 1 },
  gun: { gain: 0.36, duration: 0.14, octave: 1 },
  fire: { gain: 0.22, duration: 0.42, octave: 1 },
  magic: { gain: 0.14, duration: 0.55, octave: 2 },
  block: { gain: 0.2, duration: 0.2, octave: 4 },
  ability: { gain: 0.16, duration: 0.42, octave: 1 },
  ko: { gain: 0.6, duration: 0.7, octave: 1 },
};

/** A struck bar's partial ratios (the blade's ring). */
const BAR_RATIOS = [1, 2.76, 5.4, 8.93];
const BAR_GAINS = [1, 0.55, 0.3, 0.16];

/** The loudness of a sound of `level` (0–1; 1 when absent or invalid). */
export function fightLevel(level: number | undefined): number {
  return typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 1;
}

/** Whether `kind` is loud enough to duck the music bed (the hits and the KO; not the chimes and the swell). */
export function fightDucks(kind: FightSoundKind): boolean {
  return kind === "blunt" || kind === "gun" || kind === "ko" || kind === "blade" || kind === "block";
}

function envelope(ctx: BaseAudioContext, peak: number, time: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  return g;
}

function sine(ctx: BaseAudioContext, type: OscillatorType, frequency: number, time: number, end: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, Math.min(18000, frequency)), time);
  o.start(time);
  o.stop(end);
  return o;
}

function noiseBurst(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, time: number, filter: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, offset: number): BiquadFilterNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, time);
  f.Q.value = q;
  const g = envelope(ctx, peak, time, attack, decay);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  const length = noise.duration;
  src.start(time, length > 0 ? offset % Math.max(0.001, length - attack - decay - 0.05) : 0, attack + decay + 0.02);
  return f;
}

/**
 * Builds and starts Fight League sound `kind` at `time` (AudioContext seconds) into `out`: `frequency` is the event's pitch
 * (snapped through `snap`), `noise` a noise buffer, `level` 0–1, `variant` a number that moves the noise's read position (so
 * repeated sounds differ).
 */
export function scheduleFightSound(ctx: BaseAudioContext, out: AudioNode, kind: FightSoundKind, frequency: number, time: number, noise: AudioBuffer, level = 1, snap: (f: number) => number = (f) => f, variant = 0, tones: Readonly<Record<FightSoundKind, FightTone>> = FIGHT_TONES) {
  const tone = tones[kind];
  const loud = fightLevel(level);
  const peak = tone.gain * (0.35 + 0.65 * loud);
  const base = snap(frequency > 0 && Number.isFinite(frequency) ? frequency : 440) * tone.octave;
  const end = time + tone.duration + 0.05;
  switch (kind) {
    case "blade":
    case "block": {
      const short = kind === "block" ? 0.45 : 1;
      for (let k = 0; k < BAR_RATIOS.length; k++) {
        const o = sine(ctx, "sine", base * BAR_RATIOS[k], time, end);
        const g = envelope(ctx, peak * BAR_GAINS[k], time, 0.002, short * tone.duration * (1 - 0.18 * k));
        o.connect(g);
        g.connect(out);
      }
      noiseBurst(ctx, out, noise, time, "highpass", kind === "block" ? 2500 : 4200, 0.8, peak * 0.7, 0.001, 0.035, variant);
      return;
    }
    case "blunt": {
      const o = sine(ctx, "sine", Math.max(60, base), time, end);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, base * 0.35), time + tone.duration);
      const g = envelope(ctx, peak, time, 0.003, tone.duration);
      o.connect(g);
      g.connect(out);
      noiseBurst(ctx, out, noise, time, "lowpass", 900, 0.7, peak * 0.55, 0.002, 0.07, variant);
      return;
    }
    case "arrow": {
      const o = sine(ctx, "triangle", base, time, end);
      o.frequency.exponentialRampToValueAtTime(base * 0.94, time + tone.duration);
      const g = envelope(ctx, peak, time, 0.002, tone.duration);
      o.connect(g);
      g.connect(out);
      const whistle = noiseBurst(ctx, out, noise, time, "bandpass", 3000, 6, peak * 0.45, 0.01, 0.12, variant);
      whistle.frequency.exponentialRampToValueAtTime(1600, time + 0.13);
      return;
    }
    case "gun": {
      noiseBurst(ctx, out, noise, time, "bandpass", 1500, 0.9, peak, 0.001, 0.09, variant);
      const o = sine(ctx, "sine", 130, time, end);
      o.frequency.exponentialRampToValueAtTime(42, time + 0.11);
      const g = envelope(ctx, peak * 0.8, time, 0.002, 0.11);
      o.connect(g);
      g.connect(out);
      return;
    }
    case "fire": {
      const f = noiseBurst(ctx, out, noise, time, "bandpass", 380, 1.2, peak, 0.12, tone.duration - 0.12, variant);
      f.frequency.exponentialRampToValueAtTime(2100, time + tone.duration);
      return;
    }
    case "magic": {
      for (const [ratio, share] of [
        [1, 1],
        [1.5, 0.5],
        [3.01, 0.22],
      ] as const) {
        const o = sine(ctx, "sine", base * ratio, time, end);
        const g = envelope(ctx, peak * share, time, 0.006, tone.duration * (ratio > 2 ? 0.5 : 1));
        o.connect(g);
        g.connect(out);
      }
      return;
    }
    case "ability": {
      // A swell: a rising fifth, louder until the cast (the telegraph's 0.4 s).
      for (const [ratio, share] of [
        [1, 1],
        [1.5, 0.6],
      ] as const) {
        const o = sine(ctx, "sawtooth", base * ratio, time, end);
        o.frequency.exponentialRampToValueAtTime(base * ratio * 1.5, time + tone.duration);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(500, time);
        lp.frequency.exponentialRampToValueAtTime(3200, time + tone.duration);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * share), time + tone.duration * 0.92);
        g.gain.exponentialRampToValueAtTime(0.0001, time + tone.duration + 0.04);
        o.connect(lp);
        lp.connect(g);
        g.connect(out);
      }
      return;
    }
    case "ko": {
      const o = sine(ctx, "sine", 92, time, end);
      o.frequency.exponentialRampToValueAtTime(34, time + tone.duration);
      const g = envelope(ctx, peak, time, 0.004, tone.duration);
      o.connect(g);
      g.connect(out);
      noiseBurst(ctx, out, noise, time, "lowpass", 2400, 0.6, peak * 0.6, 0.002, 0.3, variant);
      noiseBurst(ctx, out, noise, time, "highpass", 5000, 0.7, peak * 0.3, 0.001, 0.05, variant + 0.37);
      return;
    }
  }
}
