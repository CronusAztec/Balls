/*
 * --- string-battle-alive --- The String Battle's FINAL DUEL soundtrack: ORIGINAL Web Audio synthesis (nothing sampled or
 * copied from anywhere) – oscillators and the seeded noise buffer of stringBattleTones.ts. The mode emits the events on its
 * own clock (`SoundEvent.sbDuel`: lib/physics/modes/stringBattle.ts), `ToneGenerator.playStringDuel()` schedules them here at
 * the context's time, so the live preview, the fast export, the batch render and the bot – which build their mix with
 * `ToneGenerator.createOfflineTwin()` – render it identically, through the master limiter (masterBus.ts), the offline mix
 * normalised like every mode's (loudness.ts):
 *
 *  - **riser** (the duel starts): a band-passed noise sweep of 0.8 s up into a low tom hit (`scheduleDuelRiser()`);
 *  - **heartbeat**: a soft kick pair – lub and a quieter dub – every beat, the tempo climbing from 100 to 160 BPM over 20 s of
 *    duel (`scheduleHeartbeat()`; the mode times the beats);
 *  - **drone**: two detuned sawtooths under a resonant low-pass that opens with the duel's speed factor (`droneCutoff()`),
 *    rising a semitone at every cut (`startDuelDrone()` → a handle; it lives on a lease every event renews, so a paused or
 *    restarted run lets it fade by itself);
 *  - **swell** (every cut): a short triangle-and-fifth swell over the slow-motion dip (`scheduleDuelSwell()`);
 *  - **tail** (the final cut): a long low-passed noise fall (`scheduleDuelTail()`).
 *
 * Dual-mono (no StereoPanner), no random choice (the noise is the seeded buffer). Peaks around −9 dB like the loop voices.
 */

/** The riser and its tom. */
export interface DuelRiserTone {
  /** The sweep's length (s) and its band-pass from → to (Hz), Q and peak gain. */
  seconds: number;
  fromHz: number;
  toHz: number;
  q: number;
  gain: number;
  /** The tom at the sweep's end: a sine falling from → to (Hz) over `tomSweep` s, `tomGain` loud, decaying over `tomDecay` s. */
  tomFrom: number;
  tomTo: number;
  tomSweep: number;
  tomGain: number;
  tomDecay: number;
}

export const DUEL_RISER: DuelRiserTone = { seconds: 0.8, fromHz: 320, toHz: 6400, q: 1.4, gain: 0.2, tomFrom: 150, tomTo: 64, tomSweep: 0.28, tomGain: 0.5, tomDecay: 0.5 };

/** The heartbeat: two sine thumps, the second softer and a little later in the beat. */
export interface HeartbeatTone {
  /** Each thump's sine falls from → to (Hz) over `sweep` s and decays over `decay` s. */
  from: number;
  to: number;
  sweep: number;
  decay: number;
  /** The lub's and the dub's peak gains. */
  lub: number;
  dub: number;
  /** The dub comes this share of the beat after the lub, at most `dubMaxSec`. */
  dubShare: number;
  dubMaxSec: number;
}

export const DUEL_HEARTBEAT: HeartbeatTone = { from: 96, to: 46, sweep: 0.07, decay: 0.22, lub: 0.42, dub: 0.26, dubShare: 0.3, dubMaxSec: 0.22 };

/** The tension drone. */
export interface DuelDroneTone {
  /** The two sawtooths sit this far apart (cents, ± half each). */
  detuneCents: number;
  /** Peak gain, the attack (s) and the release (s). */
  gain: number;
  attack: number;
  release: number;
  /** The low-pass: `cutoff` Hz at speed 1, × speed^`open` (at most `maxCutoff`), resonance `q`. */
  cutoff: number;
  open: number;
  maxCutoff: number;
  q: number;
  /** Every event renews the drone for this long (s); without one it fades out, and its oscillators stop `stopAfter` s later. */
  lease: number;
  stopAfter: number;
}

export const DUEL_DRONE: DuelDroneTone = { detuneCents: 14, gain: 0.075, attack: 0.6, release: 1.2, cutoff: 220, open: 1.6, maxCutoff: 8000, q: 3, lease: 2.5, stopAfter: 2.5 };

/** The swell of a cut. */
export interface DuelSwellTone {
  /** Rise and fall (s), peak gain, the partials' ratios to the drone's root and their gains. */
  rise: number;
  fall: number;
  gain: number;
  ratios: readonly number[];
  gains: readonly number[];
}

export const DUEL_SWELL: DuelSwellTone = { rise: 0.18, fall: 0.32, gain: 0.14, ratios: [4, 6], gains: [1, 0.5] };

/** The final cut's tail. */
export interface DuelTailTone {
  seconds: number;
  gain: number;
  fromHz: number;
  toHz: number;
}

export const DUEL_TAIL: DuelTailTone = { seconds: 2.4, gain: 0.26, fromHz: 5200, toHz: 260 };

/** The drone's low-pass cutoff (Hz) at the duel's speed factor `speed`: 220 Hz at 1, opening with the speed (≤ 8 kHz). */
export function droneCutoff(speed: number, tone: DuelDroneTone = DUEL_DRONE): number {
  const s = Number.isFinite(speed) && speed > 1 ? speed : 1;
  return Math.min(tone.maxCutoff, tone.cutoff * Math.pow(s, tone.open));
}

/** When the dub of a heartbeat at `bpm` comes after its lub (s). */
export function heartbeatDubDelay(bpm: number, tone: HeartbeatTone = DUEL_HEARTBEAT): number {
  const beat = 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : 100);
  return Math.min(tone.dubMaxSec, tone.dubShare * beat);
}

/** A fresh gain node into `out`: 0 → `peak` in `attack` s, then an exponential decay to silence by `time + duration`. */
function decay(ctx: BaseAudioContext, out: AudioNode, time: number, peak: number, duration: number, attack = 0.004): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(Math.max(1e-4, peak), time + attack);
  g.gain.exponentialRampToValueAtTime(0.001, time + Math.max(attack + 0.01, duration));
  g.connect(out);
  return g;
}

/** A sine thump at `time`: `from` → `to` Hz over `sweep` s, `peak` loud, decaying over `duration` s. */
function thump(ctx: BaseAudioContext, out: AudioNode, time: number, from: number, to: number, sweep: number, peak: number, duration: number) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = from;
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), time + sweep);
  osc.connect(decay(ctx, out, time, peak, duration));
  osc.start(time);
  osc.stop(time + duration + 0.03);
}

/** The looped noise buffer `noise` from `time` for `seconds` (+ a little) through a fresh filter of `type`; returns the filter. */
function noiseThrough(ctx: BaseAudioContext, noise: AudioBuffer, time: number, seconds: number, type: BiquadFilterType, frequency: number, q: number, into: AudioNode): BiquadFilterNode {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  source.connect(filter);
  filter.connect(into);
  source.start(time);
  source.stop(time + seconds + 0.05);
  return filter;
}

/**
 * The duel's riser at `time`: noise through a band-pass sweeping from `fromHz` up to `toHz` over `seconds`, swelling in, then a
 * low tom where it lands. Returns the tom's time (s).
 */
export function scheduleDuelRiser(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, level = 1, tone: DuelRiserTone = DUEL_RISER): number {
  const l = Number.isFinite(level) ? Math.max(0, level) : 1;
  const land = time + tone.seconds;
  if (l <= 0) return land;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(tone.gain * l, land - 0.02);
  g.gain.linearRampToValueAtTime(0, land + 0.03);
  g.connect(out);
  const filter = noiseThrough(ctx, noise, time, tone.seconds, "bandpass", tone.fromHz, tone.q, g);
  filter.frequency.setValueAtTime(tone.fromHz, time);
  filter.frequency.exponentialRampToValueAtTime(tone.toHz, land);
  thump(ctx, out, land, tone.tomFrom, tone.tomTo, tone.tomSweep, tone.tomGain * l, tone.tomDecay);
  return land;
}

/** A heartbeat at `time` and `bpm`: the lub, then the softer dub `heartbeatDubDelay()` later. */
export function scheduleHeartbeat(ctx: BaseAudioContext, out: AudioNode, time: number, bpm: number, level = 1, tone: HeartbeatTone = DUEL_HEARTBEAT) {
  const l = Number.isFinite(level) ? Math.max(0, level) : 1;
  if (l <= 0) return;
  thump(ctx, out, time, tone.from, tone.to, tone.sweep, tone.lub * l, tone.decay);
  thump(ctx, out, time + heartbeatDubDelay(bpm, tone), tone.from * 0.92, tone.to, tone.sweep, tone.dub * l, tone.decay);
}

/** A cut's swell at `time`: the drone's root `rootHz` × the swell's ratios (two octaves and a fifth above), rising and falling. */
export function scheduleDuelSwell(ctx: BaseAudioContext, out: AudioNode, rootHz: number, time: number, level = 1, tone: DuelSwellTone = DUEL_SWELL) {
  const l = Number.isFinite(level) ? Math.max(0, level) : 1;
  if (l <= 0 || !(rootHz > 0)) return;
  const end = time + tone.rise + tone.fall;
  tone.ratios.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? "triangle" : "sine";
    osc.frequency.value = rootHz * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(Math.max(1e-4, tone.gain * (tone.gains[i] ?? 0.5) * l), time + tone.rise);
    g.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(end + 0.03);
  });
}

/** The final cut's tail at `time`: the noise through a low-pass falling from `fromHz` to `toHz`, fading over `seconds`. */
export function scheduleDuelTail(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, level = 1, tone: DuelTailTone = DUEL_TAIL) {
  const l = Number.isFinite(level) ? Math.max(0, level) : 1;
  if (l <= 0) return;
  const g = decay(ctx, out, time, tone.gain * l, tone.seconds, 0.01);
  const filter = noiseThrough(ctx, noise, time, tone.seconds, "lowpass", tone.fromHz, 0.7, g);
  filter.frequency.setValueAtTime(tone.fromHz, time);
  filter.frequency.exponentialRampToValueAtTime(tone.toHz, time + tone.seconds);
}

/** A playing drone: re-pitch it, open its filter, renew its lease or let it go – all at context times, no new nodes. */
export interface DuelDroneHandle {
  setRoot(rootHz: number, time: number): void;
  setSpeed(speed: number, time: number): void;
  renew(time: number): void;
  release(time: number): void;
  /** Context time after which it is silent and its oscillators stopped (Infinity while held). */
  readonly endsAt: number;
}

/** Starts the drone on `rootHz` at `time` (its filter at `speed`), held for one lease. Four nodes: two sawtooths, a low-pass, a gain. */
export function startDuelDrone(ctx: BaseAudioContext, out: AudioNode, rootHz: number, time: number, speed = 1, level = 1, tone: DuelDroneTone = DUEL_DRONE): DuelDroneHandle {
  const l = Number.isFinite(level) ? Math.max(0, level) : 1;
  const half = tone.detuneCents / 2 / 1200;
  const oscs = [-half, half].map((d) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = rootHz * Math.pow(2, d);
    return osc;
  });
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = droneCutoff(speed, tone);
  filter.Q.value = tone.q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  for (const osc of oscs) {
    osc.connect(filter);
    osc.start(time);
  }
  filter.connect(gain);
  gain.connect(out);
  let endsAt = Infinity;
  let released = false;
  const stopAt = (t: number) => {
    for (const osc of oscs) {
      try {
        osc.stop(t);
      } catch {
        /* a stopped oscillator */
      }
    }
  };
  const handle: DuelDroneHandle = {
    setRoot(hz, t) {
      if (!(hz > 0)) return;
      oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(hz * Math.pow(2, i === 0 ? -half : half), t, 0.08));
    },
    setSpeed(s, t) {
      filter.frequency.setTargetAtTime(droneCutoff(s, tone), t, 0.25);
    },
    renew(t) {
      if (released) return;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(tone.gain * l, t, tone.attack / 3);
      gain.gain.setTargetAtTime(0, t + tone.lease, tone.release / 3);
      endsAt = t + tone.lease + tone.release + tone.stopAfter;
      stopAt(endsAt);
    },
    release(t) {
      if (released) return;
      released = true;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, tone.release / 3);
      endsAt = t + tone.release + 0.2;
      stopAt(endsAt);
    },
    get endsAt() {
      return endsAt;
    },
  };
  // the first lease (no cancel: the attack starts from silence)
  gain.gain.setTargetAtTime(tone.gain * l, time, tone.attack / 3);
  gain.gain.setTargetAtTime(0, time + tone.lease, tone.release / 3);
  endsAt = time + tone.lease + tone.release + tone.stopAfter;
  stopAt(endsAt);
  return handle;
}
