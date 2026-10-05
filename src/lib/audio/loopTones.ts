import { KICK_TONE, scheduleKick, type KickTone } from "./beatDropTones";
import { playVoice, type PluckCache } from "./instruments";
import { midiToFrequency } from "./scales";
import { scheduleSwooshTone, type SwooshTone } from "./swooshTone";
import { degreeToMidi, LOOP_BASE_MIDI, type LoopScale } from "./loopPitch";

/*
 * --- loop-foundation --- The loop sound library: ORIGINAL Web Audio synthesis for the loop-style clips (the owner's
 * "loopmechanics" families). No audio is copied from anywhere: every recipe below recreates the CHARACTER of a measured
 * sound – its scale, register, timbre class, envelope, event sync and mix – from oscillators, the seeded noise buffer of
 * stringBattleTones.ts and the existing voices (instruments.ts, beatDropTones.ts KICK_TONE, swooshTone.ts). Every family has a
 * custom clip slot (loopClips.ts) where the owner can load audio they licence themselves; such a clip stays in the session.
 *
 * API – what a mode wires (the scheduling lives here; the ToneGenerator calls it through `playLoop(kind, frequency?, level?,
 * opts?)` at the event's context time, so the live preview, the fast export, the batch render and the bot – which all build
 * their mix with `ToneGenerator.createOfflineTwin()` – render it identically):
 *
 *  1. pentaPluck (bounces, gate pings, plinks)       `schedulePentaPluck(ctx, out, f, time, { level, t60, bright })`
 *     sine f + sine 2f at −13 dB (+ 3f at −24 dB for small or fast objects), 5 ms linear attack, exponential ring to −60 dB
 *     over the T60 (0.75 s dense, 1.5 s sparse, 0.4 s above 10 onsets/s), stopped 20 ms later. No click, no reverb, no pan.
 *     Pitch: loopPitch.ts `degreeFromScalar()` – one physical scalar to a pentatonic degree. Slot "bounce".
 *  2. tunedBar (marble bars, bell rows, chimes)       `scheduleBarStrike(ctx, out, f, time, noise, { level })`,
 *     `scheduleChime(…)` – additive f (T60 2.7 s) + 4f −3 dB (0.5 s) + 10f −18 dB (0.12 s) + a 4 ms 3–8 kHz click at −35 dB;
 *     the glock chime f + 2.76f + 5.40f. Slots "barStrike", "chime" (pitch-follow on by default).
 *  3. progressLadder (pieces placed, lines cleared)  `scheduleProgressStep(ctx, out, f, time, { last, chip })`,
 *     `scheduleLandThump(ctx, out, time, level)` with `LoopLadder` (loopPitch.ts) for the rising degree. Slots
 *     "progressStep", "land".
 *  4. grooveBed (kick + sub + pad, the drop)          `startGrooveBed(ctx, out, time, chordMidi, opts)` → handle
 *     `{ setChord, kick, arp, stop }` (≤ 10 persistent nodes); `grooveProgression(random, rootMidi)` picks an ORIGINAL 4-chord
 *     loop by seed. Slot "bed" (musicBed.ts ducking).
 *  5. impactAccent (convergence on a bar line)        `scheduleImpactAccent(ctx, out, time, noise, chordHz, { level, crack })`,
 *     `schedulePreDrop(…)`. Slot "impact".
 *  6. completionChord (a fill, a solved puzzle)       `scheduleCompletionChord(ctx, out, rootHz, time, { level, tremolo, minor,
 *     ding, sub })`, `scheduleRiser(…)`. Slot "completion" (pre-roll aligns its transient to the frame).
 *  7. resetTransition (the loop seam)                 `scheduleResetGlide(ctx, out, fromHz, toHz, time, seconds)`,
 *     `scheduleNoiseWash(ctx, out, time, noise, seconds)`, `scheduleRatchet(ctx, out, time, seconds, noise)`; the hard cut
 *     is the ToneGenerator's (`playLoop("cut")` ramps the loop voices to 0 in 10 ms). Slot "reset".
 *  8. fieldSonification (the sound as a measurement)  `scheduleScanStrike(ctx, out, f, time, amplitude, noise)` (skips
 *     strikes under −40 dB), `startDrone(ctx, out, rootHz, time, noise)` → handle `{ setEnergy, setSpeed, stop }` (updates
 *     at most 30 Hz, `setTargetAtTime`, no new nodes), `startSectionRoot(…)`. Slot "drone".
 *
 * Budget (`LoopVoiceBudget`): per 60 Hz tick at most 6 new pluck / bar notes (≤ 18 oscillators with partials), 1 thump and 1
 * noise burst; at most 24 notes ring at once; a same-frequency hit within 30 ms merges into the sounding note (n merged
 * hits are √n × one, i.e. 1/√n each). Mix: dual-mono (no StereoPanner anywhere), note peaks around −9 dB RMS, beds 12–18 dB
 * under them; the live preview has the master limiter (masterBus.ts) and the offline mix is normalised to −14 LUFS with a
 * −1 dBTP ceiling (loudness.ts). Every random choice is seeded by the caller (`random` arguments) and the noise is the
 * seeded buffer, so a render is deterministic; event times come from the simulation clock (the context time the
 * ToneGenerator reads), never from wall time.
 */

/* ------------------------------------------------------------------ descriptors */

/** One partial of an additive voice: frequency ratio, gain relative to the fundamental and its own T60 (s). */
export interface LoopPartial {
  ratio: number;
  gain: number;
  t60: number;
}

/** The pentatonic pluck (family 1). */
export interface LoopPluckTone {
  /** Gains of f, 2f and 3f: the octave at −13 dB (0.22), the twelfth at −24 dB (0.06) for small / fast objects. */
  partials: readonly number[];
  /** Linear attack (s). */
  attack: number;
  /** T60 (s) of a sparse mode, a dense mode and of any mode above `busyRate` onsets a second. */
  t60Sparse: number;
  t60Dense: number;
  t60Busy: number;
  busyRate: number;
  /** Peak gain of the fundamental at level 1 (about −9 dB RMS before the master normalisation). */
  gain: number;
  /** The oscillators stop this long after the T60. */
  tail: number;
}

export const LOOP_PLUCK: LoopPluckTone = { partials: [1, 0.22, 0.06], attack: 0.005, t60Sparse: 1.5, t60Dense: 0.75, t60Busy: 0.4, busyRate: 10, gain: 0.3, tail: 0.02 };

/** A struck bar or bell (family 2): additive partials, each with its own ring, and a band-passed noise click. */
export interface LoopBarTone {
  partials: readonly LoopPartial[];
  attack: number;
  /** Peak gain of the fundamental at level 1. */
  gain: number;
  /** The strike click: a `clickSec` noise burst band-passed between `clickLow` and `clickHigh` Hz at `clickGain` (0 = none). */
  clickGain: number;
  clickSec: number;
  clickLow: number;
  clickHigh: number;
  tail: number;
}

export const LOOP_BAR: LoopBarTone = {
  partials: [
    { ratio: 1, gain: 1, t60: 2.7 },
    { ratio: 4, gain: 0.708, t60: 0.5 },
    { ratio: 10, gain: 0.126, t60: 0.12 },
  ],
  attack: 0.002,
  gain: 0.26,
  clickGain: 0.0178,
  clickSec: 0.004,
  clickLow: 3000,
  clickHigh: 8000,
  tail: 0.02,
};

/** The glock chime: partials near 2.76× and 5.40× (−6 / −12 dB), register A5–A6. */
export const LOOP_CHIME: LoopBarTone = {
  partials: [
    { ratio: 1, gain: 1, t60: 1.5 },
    { ratio: 2.76, gain: 0.5, t60: 1 },
    { ratio: 5.4, gain: 0.25, t60: 0.6 },
  ],
  attack: 0.002,
  gain: 0.18,
  clickGain: 0,
  clickSec: 0,
  clickLow: 3000,
  clickHigh: 8000,
  tail: 0.02,
};

/** The field-sonification strike: the bar with a shorter ring (~1 s). */
export const LOOP_SCAN: LoopBarTone = {
  ...LOOP_BAR,
  partials: [
    { ratio: 1, gain: 1, t60: 1 },
    { ratio: 4, gain: 0.708, t60: 0.35 },
    { ratio: 10, gain: 0.126, t60: 0.1 },
  ],
};

/** The completion ding: 880–990 Hz with glock partials at −10 / −16 dB, 1 ms attack, T60 1.2 s. */
export const LOOP_DING: LoopBarTone = {
  partials: [
    { ratio: 1, gain: 1, t60: 1.2 },
    { ratio: 2.76, gain: 0.316, t60: 0.8 },
    { ratio: 5.4, gain: 0.158, t60: 0.5 },
  ],
  attack: 0.001,
  gain: 0.16,
  clickGain: 0,
  clickSec: 0,
  clickLow: 3000,
  clickHigh: 8000,
  tail: 0.02,
};

/** The progress ladder's step (family 3): triangle (or sine + 3f at −10 dB), 3 ms attack, T60 0.6 s; the last step +3 dB. */
export interface LoopStepTone {
  attack: number;
  t60: number;
  gain: number;
  /** The sine voice's 3f partial (−10 dB). */
  thirdGain: number;
  /** The last step of a run plays this much louder (+3 dB). */
  lastBoost: number;
  /** The chiptune variant: a square of this duty-ish level (the instruments.ts "chip" voice), its T60. */
  chipT60: number;
}

export const LOOP_STEP: LoopStepTone = { attack: 0.003, t60: 0.6, gain: 0.26, thirdGain: 0.316, lastBoost: 1.413, chipT60: 0.7 };

/** The landing thump: a sine 150 → 50 Hz over 60 ms ringing 250 ms, 6 dB under the dings (beatDropTones' kick, shortened). */
export const LOOP_THUMP: KickTone = { start: 150, end: 50, sweep: 0.06, duration: 0.25, gain: 0.3, clickFrequency: 1400, clickGain: 0.03, clickDuration: 0.006 };

/** The groove kick (family 4): KICK_TONE with the sweep shortened to 60 ms, ending at 55 Hz. */
export const LOOP_KICK: KickTone = { ...KICK_TONE, sweep: 0.06, end: 55 };

/** The pad, the sub and the arp of the groove bed (family 4). */
export interface LoopBedTone {
  /** Pad: triangle voices, attack / release (s), low-pass (Hz), level (~−28 dB RMS alone). */
  padAttack: number;
  padRelease: number;
  padLowpass: number;
  padGain: number;
  /** Sub: a sine on the chord root, 20 ms attack, at `subGain` (~−4 dB under the kick). */
  subAttack: number;
  subGain: number;
  /** Arp: a pluck (instruments.ts) of a chord tone at `arpGain`. */
  arpGain: number;
  arpDuration: number;
  /** Seconds a chord change glides the pad's voices over. */
  glide: number;
}

export const LOOP_PAD: LoopBedTone = { padAttack: 0.25, padRelease: 0.6, padLowpass: 2000, padGain: 0.045, subAttack: 0.02, subGain: 0.16, arpGain: 0.08, arpDuration: 0.3, glide: 0.04 };

/** The impact accent (family 5): kick +3 dB, a white-noise crack high-passed at 1 kHz (−6 dB), a re-struck chord. */
export interface LoopImpactTone {
  kickBoost: number;
  crackGain: number;
  crackDecay: number;
  crackHighpass: number;
  stabGain: number;
  stabAttack: number;
  stabDecay: number;
  /** The pre-drop swell: rising band-passed noise at −24 dB over `swellSec`. */
  swellGain: number;
  swellSec: number;
}

export const LOOP_IMPACT: LoopImpactTone = { kickBoost: 1.413, crackGain: 0.31, crackDecay: 0.08, crackHighpass: 1000, stabGain: 0.2, stabAttack: 0.005, stabDecay: 1.2, swellGain: 0.063, swellSec: 0.4 };

/** The completion chord (family 6): open voicing [1, 1.5, 2, 3] × root + a soft 10th, each a sine + 2f at −12 dB. */
export interface LoopChordTone {
  ratios: readonly number[];
  /** The 10th above the root (major / minor, equal-tempered) and its gain (−18 dB). */
  tenthMajor: number;
  tenthMinor: number;
  tenthGain: number;
  /** Each voice's 2f partial (−12 dB). */
  octaveGain: number;
  /** Attacks spread from `attackMin` to `attackMax` (s) over the voices, so the chord blooms. */
  attackMin: number;
  attackMax: number;
  /** Decay in dB a second (T60 = 60 / it). */
  decayDbPerSec: number;
  /** The tremolo variant: `sustain` s at full level with a `tremoloHz` tremolo of `tremoloDepth`, then the decay. */
  sustain: number;
  tremoloHz: number;
  tremoloDepth: number;
  /** Peak gain of all voices together at level 1 (shared out with `chordGain()`: ~−7 dB RMS, the loudest sustained moment). */
  gain: number;
  /** The ding's pitch (Hz) and the sub thump's (55 Hz, −6 dB). */
  dingHz: number;
  subHz: number;
  subGain: number;
}

export const LOOP_CHORD: LoopChordTone = {
  ratios: [1, 1.5, 2, 3],
  tenthMajor: 2 ** (16 / 12),
  tenthMinor: 2 ** (15 / 12),
  tenthGain: 0.126,
  octaveGain: 0.25,
  attackMin: 0.01,
  attackMax: 0.06,
  decayDbPerSec: 15,
  sustain: 2,
  tremoloHz: 1.7,
  tremoloDepth: 0.3,
  gain: 0.5,
  dingHz: 932,
  subHz: 55,
  subGain: 0.5,
};

/** The riser into a completion: a sine gliding `octaves` up over the last `seconds`, its level rising +6 dB. */
export const LOOP_RISER = { octaves: 2, gain: 0.05, boost: 2 } as const;

/** The reset glide (family 7): a sine (+ 2f at −20 dB) on an exponential ramp, its level a raised-cosine bell. */
export interface LoopGlideTone {
  /** Peak gain of the bell (10–20 dB under the note peaks). */
  gain: number;
  octaveGain: number;
  /** Line segments the bell is drawn with. */
  bellPoints: number;
}

export const LOOP_GLIDE: LoopGlideTone = { gain: 0.06, octaveGain: 0.1, bellPoints: 8 };

/** The noise wash (family 7): band-passed noise sweeping 400 Hz → 3 kHz (Q 0.8), a 300 ms swell, high bands at 3.5 / 6 kHz. */
export interface LoopWashTone {
  swoosh: SwooshTone;
  /** The swell (s) before the fade. */
  swell: number;
  highBands: readonly number[];
  /** The high bands' gain relative to the sweep (−12 dB) and their Q. */
  highGain: number;
  highQ: number;
}

export const LOOP_WASH: LoopWashTone = {
  swoosh: { duration: 2, gain: 0.12, peakAt: 0.15, bandFrom: 400, bandTo: 3000, q: 0.8, glideFrom: 0, glideTo: 0, glideGain: 0 },
  swell: 0.3,
  highBands: [3500, 6000],
  highGain: 0.25,
  highQ: 2,
};

/** The ratchet (family 7): 2 ms noise ticks through a 1.5 kHz band-pass (Q 4) at ~6 Hz while something scrolls, −20 dB. */
export const LOOP_RATCHET = { rateHz: 6, tickSec: 0.002, band: 1500, q: 4, gain: 0.3, maxTicks: 600 } as const;

/** The drone (family 8): root × [1, 2, 4, 3, 6] at [0, −2.5, −12, −22, −23.5] dB; the level follows √(E/E0). */
export interface LoopDroneTone {
  ratios: readonly number[];
  gainsDb: readonly number[];
  /** Level of the drone at full energy (−15 dB). */
  gain: number;
  /** The ripple: × (rippleBase + rippleSpeed · penSpeedNorm). */
  rippleBase: number;
  rippleSpeed: number;
  /** The pen scratch: noise high-passed at `scratchLow`, low-passed at `scratchHigh`, gain `scratchGain` × speed. */
  scratchLow: number;
  scratchHigh: number;
  scratchGain: number;
  /** Parameter updates: at most `updateHz` a second, each a `setTargetAtTime` with this time constant. */
  updateHz: number;
  timeConstant: number;
}

export const LOOP_DRONE: LoopDroneTone = { ratios: [1, 2, 4, 3, 6], gainsDb: [0, -2.5, -12, -22, -23.5], gain: 0.178, rippleBase: 0.85, rippleSpeed: 0.15, scratchLow: 2000, scratchHigh: 7000, scratchGain: 0.06, updateHz: 30, timeConstant: 0.05 };

/** The section root under a scanned bell row: sine + 2f, ~13 dB under the bells, 1 s crossfade. */
export const LOOP_SECTION_ROOT = { gain: 0.06, octaveGain: 0.3, crossfade: 1 } as const;

/* ------------------------------------------------------------------ helpers */

/** dB → linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Level of each of `notes` notes sounding together (n of them add up to √n × one) – the rule of `chordGain()`. */
export function loopChordGain(notes: number): number {
  return 1 / Math.sqrt(Math.max(1, notes));
}

/** A level as a gain factor: finite and ≥ 0 (1 when absent). */
export function loopLevel(level: number | undefined): number {
  return typeof level === "number" && Number.isFinite(level) && level > 0 ? level : level === 0 ? 0 : 1;
}

/**
 * A percussive envelope on `param`: 0 at `time`, a linear attack to `peak`, an exponential ring to −60 dB (peak / 1000) over
 * `t60`, then a 10 ms ramp to 0 – so the oscillator's stop `tail` later never clicks. Returns the time it is silent.
 */
export function schedulePercussive(param: AudioParam, peak: number, time: number, attack: number, t60: number): number {
  const top = Math.max(1e-5, peak);
  const ringEnd = time + attack + Math.max(0.005, t60);
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(top, time + attack);
  param.exponentialRampToValueAtTime(top * 0.001, ringEnd);
  param.linearRampToValueAtTime(0, ringEnd + 0.01);
  return ringEnd + 0.01;
}

function sine(ctx: BaseAudioContext, frequency: number, time: number, end: number, destination: AudioNode): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = frequency;
  osc.connect(destination);
  osc.start(time);
  osc.stop(end);
  osc.onended = () => {
    try {
      osc.disconnect();
    } catch {
      /* already disconnected */
    }
  };
  return osc;
}

function gainNode(ctx: BaseAudioContext, value: number, time: number, destination: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(value, time);
  g.connect(destination);
  return g;
}

/** A noise source from the seeded buffer, looping when `seconds` outlasts it. */
function noiseSource(ctx: BaseAudioContext, noise: AudioBuffer, time: number, seconds: number, offset = 0): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const span = Math.max(0.001, seconds);
  if (span > noise.duration - offset) source.loop = true;
  source.start(time, Math.max(0, Math.min(offset, Math.max(0, noise.duration - 0.01))), span);
  source.stop(time + span + 0.01);
  return source;
}

/* ------------------------------------------------------------------ 1. pentaPluck */

/** A started note: its envelope (a merge rescales it), its peak, start and end – what `LoopVoiceBudget` merges into. */
export interface LoopVoice {
  env: GainNode;
  /** The single hit's peak (a merge of n hits rescales to √n × it) and the current one. */
  base: number;
  peak: number;
  start: number;
  end: number;
  attack: number;
  t60: number;
}

export interface PluckOptions {
  /** Loudness (velocity: 0.8 + 0.2 · impact speed is the narrow rule); 1 when absent. */
  level?: number;
  /** Ring time; LOOP_PLUCK.t60Sparse when absent. */
  t60?: number;
  /** Adds the 3f partial (small or fast objects). */
  bright?: boolean;
  tone?: LoopPluckTone;
}

/**
 * The pentatonic pluck at `frequency` from `time`: sine f and sine 2f (gain 0.22), with `bright` sine 3f (0.06), under one
 * percussive envelope (5 ms attack, exponential ring over the T60), stopped 20 ms after it. Returns the voice (null at level 0).
 */
export function schedulePentaPluck(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, opts: PluckOptions = {}): LoopVoice | null {
  const tone = opts.tone ?? LOOP_PLUCK;
  const peak = tone.gain * loopLevel(opts.level);
  if (!(peak > 0) || !(frequency > 0)) return null;
  const t60 = opts.t60 !== undefined && opts.t60 > 0 ? opts.t60 : tone.t60Sparse;
  const env = ctx.createGain();
  const silentAt = schedulePercussive(env.gain, peak, time, tone.attack, t60);
  env.connect(out);
  const end = Math.max(silentAt, time + tone.attack + t60 + tone.tail);
  const count = opts.bright ? Math.min(3, tone.partials.length) : Math.min(2, tone.partials.length);
  for (let i = 0; i < count; i++) {
    const f = frequency * (i + 1);
    if (i === 0) sine(ctx, f, time, end, env);
    else sine(ctx, f, time, end, gainNode(ctx, tone.partials[i], time, env));
  }
  return { env, base: peak, peak, start: time, end, attack: tone.attack, t60 };
}

/** Re-shapes a just-started voice's envelope to `peak` (a same-tick merge: n hits on one pitch sound √n × one). */
export function rescaleVoice(voice: LoopVoice, peak: number) {
  const g = voice.env.gain;
  g.cancelScheduledValues(voice.start);
  schedulePercussive(g, peak, voice.start, voice.attack, voice.t60);
  voice.peak = peak;
}

/* ------------------------------------------------------------------ 2. tunedBar */

export interface BarOptions {
  level?: number;
  tone?: LoopBarTone;
}

/** A struck bar (or, with LOOP_CHIME / LOOP_DING / LOOP_SCAN, a chime, the ding, a scanned bell) at `frequency` from `time`. */
export function scheduleBarStrike(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, noise: AudioBuffer | null, opts: BarOptions = {}): number {
  const tone = opts.tone ?? LOOP_BAR;
  const level = loopLevel(opts.level);
  if (!(level > 0) || !(frequency > 0)) return time;
  let end = time;
  for (const p of tone.partials) {
    const env = ctx.createGain();
    const silentAt = schedulePercussive(env.gain, tone.gain * level * p.gain, time, tone.attack, p.t60);
    env.connect(out);
    const stop = Math.max(silentAt, time + tone.attack + p.t60 + tone.tail);
    sine(ctx, frequency * p.ratio, time, stop, env);
    if (stop > end) end = stop;
  }
  if (tone.clickGain > 0 && tone.clickSec > 0 && noise) {
    const source = noiseSource(ctx, noise, time, tone.clickSec + 0.002);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    const centre = Math.sqrt(tone.clickLow * tone.clickHigh);
    band.frequency.value = centre;
    band.Q.value = centre / Math.max(1, tone.clickHigh - tone.clickLow);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(tone.clickGain * level, time + 0.0005);
    env.gain.linearRampToValueAtTime(0, time + tone.clickSec);
    source.connect(band);
    band.connect(env);
    env.connect(out);
  }
  return end;
}

/** The glock chime at `frequency` (A5–A6; its degree rises with the ring's speed). */
export function scheduleChime(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, opts: Omit<BarOptions, "tone"> = {}): number {
  return scheduleBarStrike(ctx, out, frequency, time, null, { ...opts, tone: LOOP_CHIME });
}

/** The phrase bass of a machine: a sine/triangle 55–220 Hz with a 300 ms attack and a 2 s decay, every 2 bars. */
export function schedulePhraseBass(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, level = 1): number {
  const env = ctx.createGain();
  const peak = 0.12 * loopLevel(level);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(peak, time + 0.3);
  env.gain.exponentialRampToValueAtTime(peak * 0.001, time + 2.3);
  env.gain.linearRampToValueAtTime(0, time + 2.31);
  env.connect(out);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = Math.max(55, Math.min(220, frequency));
  osc.connect(env);
  osc.start(time);
  osc.stop(time + 2.33);
  return time + 2.33;
}

/* ------------------------------------------------------------------ 3. progressLadder */

export interface StepOptions {
  level?: number;
  /** The last step of a run (+3 dB). */
  last?: boolean;
  /** The chiptune variant (instruments.ts "chip": a square blip) instead of the sine + 3f. */
  chip?: boolean;
  tone?: LoopStepTone;
}

/** One step of the audible progress bar at `frequency` (1–3.5 kHz): a sine with 3f at −10 dB, or the chip square. */
export function scheduleProgressStep(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, opts: StepOptions = {}): number {
  const tone = opts.tone ?? LOOP_STEP;
  const level = loopLevel(opts.level) * (opts.last ? tone.lastBoost : 1);
  if (!(level > 0) || !(frequency > 0)) return time;
  if (opts.chip) {
    playVoice(ctx, out, "chip", { frequency, time, duration: tone.chipT60, gain: tone.gain * level });
    return time + tone.chipT60 + 0.02;
  }
  const env = ctx.createGain();
  const silentAt = schedulePercussive(env.gain, tone.gain * level, time, tone.attack, tone.t60);
  env.connect(out);
  const end = Math.max(silentAt, time + tone.attack + tone.t60 + 0.02);
  sine(ctx, frequency, time, end, env);
  sine(ctx, 3 * frequency, time, end, gainNode(ctx, tone.thirdGain, time, env));
  return end;
}

/** The soft landing thump under a ladder step (LOOP_THUMP: 150 → 50 Hz over 60 ms, 250 ms). */
export function scheduleLandThump(ctx: BaseAudioContext, out: AudioNode, time: number, level = 1, frequency?: number): void {
  const tone = frequency !== undefined && frequency > 0 ? { ...LOOP_THUMP, end: frequency, start: 3 * frequency } : LOOP_THUMP;
  scheduleKick(ctx, out, time, loopLevel(level), tone);
}

/* ------------------------------------------------------------------ 4. grooveBed */

/** Chords of the bed as semitones above the key's root: I, ii, iii, IV, V, vi. */
const CHORD_ROOTS = { I: 0, ii: 2, iii: 4, IV: 5, V: 7, vi: 9 } as const;
type ChordName = keyof typeof CHORD_ROOTS;
/** The ORIGINAL 4-chord loops a bed picks from by seed (common, unowned progressions – never a song's hook). */
export const GROOVE_PROGRESSIONS: readonly (readonly ChordName[])[] = [
  ["I", "V", "vi", "IV"],
  ["vi", "IV", "I", "V"],
  ["I", "vi", "IV", "V"],
];

/** The progression's chords as root MIDI notes (the key's root `rootMidi`, minor for ii, iii and vi), picked by `random()`. */
export function grooveProgression(random: () => number, rootMidi = LOOP_BASE_MIDI): { root: number; minor: boolean }[] {
  const pick = GROOVE_PROGRESSIONS[Math.min(GROOVE_PROGRESSIONS.length - 1, Math.floor(random() * GROOVE_PROGRESSIONS.length))];
  return pick.map((name) => ({ root: rootMidi + CHORD_ROOTS[name], minor: name === "ii" || name === "iii" || name === "vi" }));
}

/** The pad's open voicing of a chord: root, 5th, octave and 10th (minor or major), moved by octaves into 110–440 Hz. */
export function padVoicing(rootMidi: number, minor = false): number[] {
  let root = rootMidi;
  while (root < 45) root += 12; // A2 = 110 Hz
  while (root > 52) root -= 12; // keeps the 10th (root + 16) under A4 = 440 Hz
  return [root, root + 7, root + 12, root + (minor ? 15 : 16)];
}

/** The sub's pitch of a chord root: 55–110 Hz (A1–A2). */
export function subMidi(rootMidi: number): number {
  let m = rootMidi;
  while (m < 33) m += 12;
  while (m > 45) m -= 12;
  return m;
}

export interface GrooveBedHandle {
  /** Re-voices the pad and moves the sub to `chordMidi` (a chord root) at `time`. */
  setChord(rootMidi: number, minor: boolean, time: number): void;
  /** A kick (LOOP_KICK) at `time`. */
  kick(time: number, level?: number): void;
  /** An arp pluck of a chord tone at `time`. */
  arp(frequency: number, time: number, level?: number): void;
  /** Releases the pad and the sub from `time` and stops their oscillators. */
  stop(time: number): void;
  /** Persistent nodes the bed holds (≤ 10). */
  readonly nodes: number;
}

/**
 * Starts the groove bed's persistent part at `time`: 4 triangle pad voices in an open voicing (250 ms attack) through a 2 kHz
 * low-pass, and a sine sub on the chord root (20 ms attack) – 8 nodes. The kick and the arp are per-event voices.
 */
export function startGrooveBed(ctx: BaseAudioContext, out: AudioNode, time: number, rootMidi: number, minor = false, level = 1, pluckCache?: PluckCache, tone: LoopBedTone = LOOP_PAD): GrooveBedHandle {
  const l = loopLevel(level);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = tone.padLowpass;
  lowpass.connect(out);
  const pad = ctx.createGain();
  pad.gain.setValueAtTime(0, time);
  pad.gain.linearRampToValueAtTime(tone.padGain * l, time + tone.padAttack);
  pad.connect(lowpass);
  const voices = padVoicing(rootMidi, minor).map((m) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(m);
    osc.connect(pad);
    osc.start(time);
    return osc;
  });
  const sub = ctx.createGain();
  sub.gain.setValueAtTime(0, time);
  sub.gain.linearRampToValueAtTime(tone.subGain * l, time + tone.subAttack);
  sub.connect(out);
  const subOsc = ctx.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.value = midiToFrequency(subMidi(rootMidi));
  subOsc.connect(sub);
  subOsc.start(time);
  let stopped = false;
  return {
    nodes: 8,
    setChord(root, isMinor, at) {
      if (stopped) return;
      const notes = padVoicing(root, isMinor);
      voices.forEach((osc, i) => osc.frequency.setTargetAtTime(midiToFrequency(notes[i]), at, tone.glide));
      subOsc.frequency.setTargetAtTime(midiToFrequency(subMidi(root)), at, tone.glide);
      // a chord change re-swells the pad a little: it re-attacks without a gap
      pad.gain.setValueAtTime(tone.padGain * l * 0.6, at);
      pad.gain.linearRampToValueAtTime(tone.padGain * l, at + tone.padAttack);
    },
    kick(at, kickLevel = 1) {
      if (!stopped) scheduleKick(ctx, out, at, l * loopLevel(kickLevel), LOOP_KICK);
    },
    arp(frequency, at, arpLevel = 1) {
      if (!stopped && frequency > 0) playVoice(ctx, out, "pluck", { frequency, time: at, duration: tone.arpDuration, gain: tone.arpGain * l * loopLevel(arpLevel) }, pluckCache);
    },
    stop(at) {
      if (stopped) return;
      stopped = true;
      pad.gain.cancelScheduledValues(at);
      pad.gain.setTargetAtTime(0, at, tone.padRelease / 4);
      sub.gain.cancelScheduledValues(at);
      sub.gain.setTargetAtTime(0, at, 0.05);
      const end = at + tone.padRelease + 0.2;
      for (const osc of voices) osc.stop(end);
      subOsc.stop(end);
    },
  };
}

/* ------------------------------------------------------------------ 5. impactAccent */

export interface ImpactOptions {
  level?: number;
  /** The bright crack (off for calm modes). */
  crack?: boolean;
  tone?: LoopImpactTone;
}

/**
 * The payoff on a bar line: the kick +3 dB, a white-noise crack (1 ms attack, 80 ms decay, high-passed at 1 kHz, −6 dB under
 * the kick) and the chord `chordHz` (up to 4 pitches) re-struck (5 ms attack, 1.2 s decay), shared out with `loopChordGain()`.
 */
export function scheduleImpactAccent(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer | null, chordHz: readonly number[], opts: ImpactOptions = {}): void {
  const tone = opts.tone ?? LOOP_IMPACT;
  const level = loopLevel(opts.level);
  if (!(level > 0)) return;
  scheduleKick(ctx, out, time, level * tone.kickBoost, LOOP_KICK);
  if (opts.crack !== false && noise) {
    const source = noiseSource(ctx, noise, time, tone.crackDecay + 0.02, 0.11);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = tone.crackHighpass;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(tone.crackGain * level, time + 0.001);
    env.gain.exponentialRampToValueAtTime(tone.crackGain * level * 0.001, time + tone.crackDecay);
    env.gain.linearRampToValueAtTime(0, time + tone.crackDecay + 0.01);
    source.connect(hp);
    hp.connect(env);
    env.connect(out);
  }
  const notes = chordHz.filter((f) => f > 0).slice(0, 4);
  const each = tone.stabGain * level * loopChordGain(notes.length);
  for (const f of notes) {
    const env = ctx.createGain();
    const silentAt = schedulePercussive(env.gain, each, time, tone.stabAttack, tone.stabDecay);
    env.connect(out);
    sine(ctx, f, time, silentAt + 0.01, env);
  }
}

/** The breath before an impact: a rising band-passed noise swell at −24 dB over the last `seconds` before `impactTime`. */
export function schedulePreDrop(ctx: BaseAudioContext, out: AudioNode, impactTime: number, noise: AudioBuffer, seconds: number = LOOP_IMPACT.swellSec, level = 1): void {
  const start = impactTime - Math.max(0.05, seconds);
  const source = noiseSource(ctx, noise, start, impactTime - start, 0.21);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1;
  band.frequency.setValueAtTime(500, start);
  band.frequency.exponentialRampToValueAtTime(4000, impactTime);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, LOOP_IMPACT.swellGain * loopLevel(level)), impactTime - 0.005);
  env.gain.linearRampToValueAtTime(0, impactTime);
  source.connect(band);
  band.connect(env);
  env.connect(out);
}

/* ------------------------------------------------------------------ 6. completionChord */

export interface ChordOptions {
  level?: number;
  /** Sustain 2 s with a 1.7 Hz tremolo before the decay. */
  tremolo?: boolean;
  /** The minor 10th (a "fail" ending). */
  minor?: boolean;
  /** The bright bell ding on the completion frame (default on), at `dingHz`. */
  ding?: boolean;
  dingHz?: number;
  /** The 55 Hz sub thump (default on). */
  sub?: boolean;
  tone?: LoopChordTone;
}

/** The voices (Hz, relative gain) of a completion chord on `rootHz`: [1, 1.5, 2, 3] × root and the soft 10th. */
export function completionChordVoices(rootHz: number, minor = false, tone: LoopChordTone = LOOP_CHORD): { frequency: number; gain: number }[] {
  const out = tone.ratios.map((r) => ({ frequency: rootHz * r, gain: 1 }));
  out.push({ frequency: rootHz * (minor ? tone.tenthMinor : tone.tenthMajor), gain: tone.tenthGain });
  return out;
}

/**
 * The resolve: an open chord on `rootHz` (98–110 Hz: the key's tonic or dominant) – 5 voices, each a sine + 2f at −12 dB with
 * attacks spread over 10–60 ms, shared out with `loopChordGain()` and decaying ~15 dB/s (or held 2 s with a 1.7 Hz tremolo) –
 * plus one bright ding on the completion frame and a 55 Hz sub thump. Returns the time the chord is silent.
 */
export function scheduleCompletionChord(ctx: BaseAudioContext, out: AudioNode, rootHz: number, time: number, opts: ChordOptions = {}): number {
  const tone = opts.tone ?? LOOP_CHORD;
  const level = loopLevel(opts.level);
  if (!(level > 0) || !(rootHz > 0)) return time;
  const voices = completionChordVoices(rootHz, !!opts.minor, tone);
  const each = tone.gain * level * loopChordGain(voices.length);
  const t60 = 60 / Math.max(1, tone.decayDbPerSec);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(1, time);
  bus.connect(out);
  let end = time;
  const hold = opts.tremolo ? tone.sustain : 0;
  voices.forEach((v, i) => {
    const attack = tone.attackMin + ((tone.attackMax - tone.attackMin) * i) / Math.max(1, voices.length - 1);
    const env = ctx.createGain();
    const peak = Math.max(1e-5, each * v.gain);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + attack);
    if (hold > 0) env.gain.setValueAtTime(peak, time + attack + hold);
    env.gain.exponentialRampToValueAtTime(peak * 0.001, time + attack + hold + t60);
    env.gain.linearRampToValueAtTime(0, time + attack + hold + t60 + 0.01);
    env.connect(bus);
    const stop = time + attack + hold + t60 + 0.03;
    sine(ctx, v.frequency, time, stop, env);
    sine(ctx, 2 * v.frequency, time, stop, gainNode(ctx, tone.octaveGain, time, env));
    if (stop > end) end = stop;
  });
  if (opts.tremolo && hold > 0) {
    // a 1.7 Hz tremolo of 30 % depth on the chord bus while it is held: bus gain = 1 − depth/2 + depth/2 · sin
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = tone.tremoloHz;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(tone.tremoloDepth / 2, time);
    depth.gain.setValueAtTime(0, time + hold);
    bus.gain.setValueAtTime(1 - tone.tremoloDepth / 2, time);
    bus.gain.setValueAtTime(1, time + hold);
    lfo.connect(depth);
    depth.connect(bus.gain);
    lfo.start(time);
    lfo.stop(time + hold + 0.05);
  }
  if (opts.ding !== false) scheduleBarStrike(ctx, out, opts.dingHz && opts.dingHz > 0 ? opts.dingHz : tone.dingHz, time, null, { level, tone: LOOP_DING });
  if (opts.sub !== false) scheduleKick(ctx, out, time, level * tone.subGain, { ...LOOP_THUMP, start: 2 * tone.subHz, end: tone.subHz, sweep: 0.05, duration: 0.35 });
  return end;
}

/** The riser into a completion: a sine from `fromHz` gliding `LOOP_RISER.octaves` up over `seconds`, +6 dB, stopping at `time + seconds`. */
export function scheduleRiser(ctx: BaseAudioContext, out: AudioNode, fromHz: number, time: number, seconds: number, level = 1): void {
  const l = loopLevel(level);
  if (!(l > 0) || !(fromHz > 0) || !(seconds > 0)) return;
  const end = time + seconds;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, time);
  env.gain.exponentialRampToValueAtTime(LOOP_RISER.gain * l, time + Math.min(0.05, seconds / 2));
  env.gain.exponentialRampToValueAtTime(LOOP_RISER.gain * LOOP_RISER.boost * l, end - 0.004);
  env.gain.linearRampToValueAtTime(0, end);
  env.connect(out);
  const osc = sine(ctx, fromHz, time, end + 0.005, env);
  osc.frequency.setValueAtTime(fromHz, time);
  osc.frequency.exponentialRampToValueAtTime(fromHz * 2 ** LOOP_RISER.octaves, end);
}

/* ------------------------------------------------------------------ 7. resetTransition */

/** The raised-cosine bell (0 at both ends, 1 in the middle) at `x` in [0, 1]. */
export function raisedCosine(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return 0.5 * (1 - Math.cos(2 * Math.PI * c));
}

/**
 * The reset glide over the loop's seam: a sine (+ 2f at −20 dB) gliding exponentially from `fromHz` to `toHz` (near, or an
 * octave under, the loop's first note) over `seconds`, its level a raised-cosine bell that peaks 10–20 dB under the notes and
 * is silent exactly at `time + seconds` – the loop point.
 */
export function scheduleResetGlide(ctx: BaseAudioContext, out: AudioNode, fromHz: number, toHz: number, time: number, seconds: number, level = 1, tone: LoopGlideTone = LOOP_GLIDE): number {
  const l = loopLevel(level);
  if (!(l > 0) || !(fromHz > 0) || !(toHz > 0) || !(seconds > 0)) return time;
  const end = time + seconds;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  const points = Math.max(2, Math.floor(tone.bellPoints));
  for (let i = 1; i <= points; i++) env.gain.linearRampToValueAtTime(tone.gain * l * raisedCosine(i / points), time + (seconds * i) / points);
  env.connect(out);
  const a = sine(ctx, fromHz, time, end + 0.01, env);
  a.frequency.setValueAtTime(fromHz, time);
  a.frequency.exponentialRampToValueAtTime(toHz, end);
  const b = sine(ctx, 2 * fromHz, time, end + 0.01, gainNode(ctx, tone.octaveGain, time, env));
  b.frequency.setValueAtTime(2 * fromHz, time);
  b.frequency.exponentialRampToValueAtTime(2 * toHz, end);
  return end;
}

/**
 * The noise wash of a remix or a big reset: the seeded noise through a band-pass sweeping 400 Hz → 3 kHz (Q 0.8) – the
 * swoosh of swooshTone.ts stretched to `seconds` – plus high bands at 3.5 and 6 kHz 12 dB under it; a 300 ms swell, then
 * the fade (≈ −30 dB RMS).
 */
export function scheduleNoiseWash(ctx: BaseAudioContext, out: AudioNode, time: number, noise: AudioBuffer, seconds: number = LOOP_WASH.swoosh.duration, level = 1, tone: LoopWashTone = LOOP_WASH): number {
  const l = loopLevel(level);
  const duration = Math.max(0.1, seconds);
  if (!(l > 0)) return time;
  const swoosh: SwooshTone = { ...tone.swoosh, gain: tone.swoosh.gain * l, peakAt: Math.min(0.9, tone.swell / duration) };
  scheduleSwooshTone(ctx, out, time, noise, swoosh, duration);
  const end = time + duration;
  for (const band of tone.highBands) {
    const source = noiseSource(ctx, noise, time, duration, 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = band;
    bp.Q.value = tone.highQ;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone.swoosh.gain * tone.highGain * l), time + Math.min(tone.swell, duration * 0.9));
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(bp);
    bp.connect(env);
    env.connect(out);
  }
  return end;
}

/** The ratchet of a scroll: 2 ms noise ticks through a 1.5 kHz band-pass (Q 4) at `rateHz` for `seconds` (one source, one gain). */
export function scheduleRatchet(ctx: BaseAudioContext, out: AudioNode, time: number, seconds: number, noise: AudioBuffer, level = 1, rateHz: number = LOOP_RATCHET.rateHz): number {
  const l = loopLevel(level);
  if (!(l > 0) || !(seconds > 0) || !(rateHz > 0)) return time;
  const ticks = Math.min(LOOP_RATCHET.maxTicks, Math.floor(seconds * rateHz));
  if (ticks < 1) return time;
  const source = noiseSource(ctx, noise, time, seconds + 0.01, 0.31);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = LOOP_RATCHET.band;
  bp.Q.value = LOOP_RATCHET.q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  const peak = LOOP_RATCHET.gain * l;
  for (let k = 0; k < ticks; k++) {
    const t = time + k / rateHz;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + LOOP_RATCHET.tickSec / 4);
    env.gain.linearRampToValueAtTime(0, t + LOOP_RATCHET.tickSec);
  }
  source.connect(bp);
  bp.connect(env);
  env.connect(out);
  return time + seconds;
}

/* ------------------------------------------------------------------ 8. fieldSonification */

/** Strikes quieter than this (−40 dB) are skipped. */
export const SCAN_FLOOR = 0.01;

/** The loudness of a scanned bell over a field amplitude: (|a| / max)^1.5, clamped to 0–1. */
export function scanGain(amplitude: number, maxAmplitude: number): number {
  if (!(maxAmplitude > 0) || !Number.isFinite(amplitude)) return 0;
  const x = Math.min(1, Math.abs(amplitude) / maxAmplitude);
  return Math.pow(x, 1.5);
}

/** The bells of a scanned row: `count` (12–16) across the width in major pentatonic over 2 octaves from `rootMidi`. */
export function scanBellFrequencies(count: number, rootMidi = 57, scale: LoopScale = "majorPentatonic"): number[] {
  const n = Math.max(1, Math.floor(count));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(midiToFrequency(degreeToMidi(Math.round((10 * i) / Math.max(1, n - 1)), rootMidi, scale)));
  return out;
}

/** One bell of a scanned row at `frequency`, as loud as the field under it (`scanGain()`); false when it is under −40 dB. */
export function scheduleScanStrike(ctx: BaseAudioContext, out: AudioNode, frequency: number, time: number, amplitude: number, noise: AudioBuffer | null, maxAmplitude = 1): boolean {
  const g = scanGain(amplitude, maxAmplitude);
  if (g < SCAN_FLOOR) return false;
  scheduleBarStrike(ctx, out, frequency, time, noise, { level: g, tone: LOOP_SCAN });
  return true;
}

export interface DroneHandle {
  /** The system's energy over its starting energy (E / E0): the drone's level is √ of it. */
  setEnergy(energyRatio: number, time: number): void;
  /** The pen's speed, 0–1: the ripple and the scratch follow it. */
  setSpeed(speedNorm: number, time: number): void;
  stop(time: number): void;
  readonly nodes: number;
}

/**
 * The energy drone: sines at root × [1, 2, 4, 3, 6] at [0, −2.5, −12, −22, −23.5] dB, its level √(E/E0) × (0.85 + 0.15 · pen
 * speed), and the pen's scratch (noise high-passed at 2 kHz, low-passed at 7 kHz, 0.06 × speed). Updates are throttled to
 * 30 Hz and glide with `setTargetAtTime` – no new nodes after the start (5 + 2 + 3 = 10 nodes).
 */
export function startDrone(ctx: BaseAudioContext, out: AudioNode, rootHz: number, time: number, noise: AudioBuffer | null, level = 1, tone: LoopDroneTone = LOOP_DRONE): DroneHandle {
  const l = loopLevel(level);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, time);
  master.gain.setTargetAtTime(tone.gain * l, time, tone.timeConstant);
  master.connect(out);
  const oscs = tone.ratios.map((r, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = rootHz * r;
    osc.connect(gainNode(ctx, dbToGain(tone.gainsDb[i] ?? -24), time, master));
    osc.start(time);
    return osc;
  });
  let scratchSource: AudioBufferSourceNode | null = null;
  let scratch: GainNode | null = null;
  if (noise) {
    scratchSource = ctx.createBufferSource();
    scratchSource.buffer = noise;
    scratchSource.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = tone.scratchLow;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = tone.scratchHigh;
    scratch = ctx.createGain();
    scratch.gain.setValueAtTime(0, time);
    scratchSource.connect(hp);
    hp.connect(lp);
    lp.connect(scratch);
    scratch.connect(out);
    scratchSource.start(time);
  }
  let energy = 1;
  let ripple = tone.rippleBase + tone.rippleSpeed;
  let lastUpdate = -Infinity;
  let stopped = false;
  const minGap = 1 / Math.max(1, tone.updateHz);
  const apply = (at: number) => master.gain.setTargetAtTime(tone.gain * l * Math.sqrt(Math.max(0, energy)) * ripple, at, tone.timeConstant);
  return {
    nodes: oscs.length * 2 + 1 + (noise ? 5 : 0),
    setEnergy(ratio, at) {
      if (stopped) return;
      energy = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
      if (at - lastUpdate < minGap - 1e-9) return;
      lastUpdate = at;
      apply(at);
    },
    setSpeed(speed, at) {
      if (stopped) return;
      const s = Number.isFinite(speed) ? Math.max(0, Math.min(1, speed)) : 0;
      ripple = tone.rippleBase + tone.rippleSpeed * s;
      if (at - lastUpdate < minGap - 1e-9) return;
      lastUpdate = at;
      apply(at);
      scratch?.gain.setTargetAtTime(tone.scratchGain * l * s, at, tone.timeConstant);
    },
    stop(at) {
      if (stopped) return;
      stopped = true;
      master.gain.cancelScheduledValues(at);
      master.gain.setTargetAtTime(0, at, 0.05);
      scratch?.gain.cancelScheduledValues(at);
      scratch?.gain.setTargetAtTime(0, at, 0.05);
      for (const osc of oscs) osc.stop(at + 0.4);
      scratchSource?.stop(at + 0.4);
    },
  };
}

export interface SectionRootHandle {
  /** Crossfades to a new root (1 s) at `time`. */
  setRoot(rootHz: number, time: number): void;
  stop(time: number): void;
}

/** The section root under a scanned bell row: a sine + 2f ~13 dB under the bells, crossfading over 1 s on a section change. */
export function startSectionRoot(ctx: BaseAudioContext, out: AudioNode, rootHz: number, time: number, level = 1): SectionRootHandle {
  const l = loopLevel(level);
  const make = (hz: number, at: number) => {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(LOOP_SECTION_ROOT.gain * l, at + LOOP_SECTION_ROOT.crossfade);
    env.connect(out);
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = hz;
    a.connect(env);
    a.start(at);
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = 2 * hz;
    b.connect(gainNode(ctx, LOOP_SECTION_ROOT.octaveGain, at, env));
    b.start(at);
    return { env, a, b };
  };
  let current = make(rootHz, time);
  const release = (voice: typeof current, at: number) => {
    voice.env.gain.cancelScheduledValues(at);
    voice.env.gain.setValueAtTime(LOOP_SECTION_ROOT.gain * l, at);
    voice.env.gain.linearRampToValueAtTime(0, at + LOOP_SECTION_ROOT.crossfade);
    voice.a.stop(at + LOOP_SECTION_ROOT.crossfade + 0.05);
    voice.b.stop(at + LOOP_SECTION_ROOT.crossfade + 0.05);
  };
  return {
    setRoot(hz, at) {
      release(current, at);
      current = make(hz, at);
    },
    stop(at) {
      release(current, at);
    },
  };
}

/* ------------------------------------------------------------------ the budget */

/** The voice budget per 60 Hz tick and overall (see the header). */
export const LOOP_TICK_SEC = 1 / 60;
export const LOOP_NOTES_PER_TICK = 6;
export const LOOP_THUMPS_PER_TICK = 1;
export const LOOP_NOISES_PER_TICK = 1;
export const LOOP_MAX_CONCURRENT = 24;
export const LOOP_MERGE_SEC = 0.03;
/** Onsets a second above which the plucks ring short (T60 0.4 s), and the window they are counted over. */
export const LOOP_BUSY_WINDOW_SEC = 1;

/** What the budget decided for a note: start it, merge it into a recent note of the same pitch, or drop it. */
export interface LoopNoteVerdict {
  action: "start" | "merge" | "drop";
  /** The recent note it merges into (an index into the budget's recent-note table; a started note takes this slot). */
  slot: number;
  /** Hits that note stands for now (1 for a fresh note). */
  count: number;
  /** True when the merged note started in this same tick (its level can still be reshaped: √count × one). */
  sameTick: boolean;
}

/**
 * The per-tick voice budget of the loop sounds (allocation-free: fixed tables, one verdict object reused). Times are context
 * seconds; a tick is 1/60 s from the first event in it.
 */
export class LoopVoiceBudget {
  private tickStart = -Infinity;
  private notes = 0;
  private thumps = 0;
  private noises = 0;
  /** End times of the notes that may still ring (a ring of LOOP_MAX_CONCURRENT). */
  private readonly ends = new Float64Array(LOOP_MAX_CONCURRENT);
  private endCursor = 0;
  /** Recent notes (for same-pitch merges): pitch, start, count. */
  private readonly recentHz = new Float64Array(LOOP_NOTES_PER_TICK * 2);
  private readonly recentAt = new Float64Array(LOOP_NOTES_PER_TICK * 2).fill(-Infinity);
  private readonly recentCount = new Uint16Array(LOOP_NOTES_PER_TICK * 2);
  private recentCursor = 0;
  /** Onset times of the last second (density → the pluck's T60). */
  private readonly onsets = new Float64Array(32).fill(-Infinity);
  private onsetCursor = 0;
  private readonly verdict: LoopNoteVerdict = { action: "drop", slot: -1, count: 0, sameTick: false };

  constructor() {
    this.ends.fill(-Infinity);
  }

  private beginTick(time: number) {
    if (time >= this.tickStart + LOOP_TICK_SEC - 1e-9 || time < this.tickStart - 1e-9) {
      this.tickStart = time;
      this.notes = 0;
      this.thumps = 0;
      this.noises = 0;
    }
  }

  /** Notes still ringing at `time`. */
  live(time: number): number {
    let n = 0;
    for (let i = 0; i < this.ends.length; i++) if (this.ends[i] > time) n++;
    return n;
  }

  /** Onsets in the second before `time` (the density the pluck's T60 follows). */
  onsetRate(time: number): number {
    let n = 0;
    for (let i = 0; i < this.onsets.length; i++) if (this.onsets[i] > time - LOOP_BUSY_WINDOW_SEC && this.onsets[i] <= time + 1e-9) n++;
    return n / LOOP_BUSY_WINDOW_SEC;
  }

  /**
   * A note of `frequency` at `time` ringing until `end`: merged into a note of the same pitch started within 30 ms, else
   * started while the tick has room (6 notes) and fewer than 24 notes ring, else dropped. The verdict object is reused.
   */
  note(time: number, frequency: number, end: number): LoopNoteVerdict {
    this.beginTick(time);
    const v = this.verdict;
    this.onsets[this.onsetCursor] = time;
    this.onsetCursor = (this.onsetCursor + 1) % this.onsets.length;
    for (let i = 0; i < this.recentHz.length; i++) {
      if (this.recentAt[i] > time - LOOP_MERGE_SEC - 1e-9 && this.recentAt[i] <= time + 1e-9 && Math.abs(this.recentHz[i] - frequency) < 1e-3 * Math.max(1, frequency)) {
        this.recentCount[i]++;
        v.action = "merge";
        v.slot = i;
        v.count = this.recentCount[i];
        v.sameTick = Math.abs(this.recentAt[i] - time) < 1e-6;
        return v;
      }
    }
    if (this.notes >= LOOP_NOTES_PER_TICK || this.live(time) >= LOOP_MAX_CONCURRENT) {
      v.action = "drop";
      v.slot = -1;
      v.count = 0;
      v.sameTick = false;
      return v;
    }
    this.notes++;
    const slot = this.recentCursor;
    this.recentCursor = (this.recentCursor + 1) % this.recentHz.length;
    this.recentHz[slot] = frequency;
    this.recentAt[slot] = time;
    this.recentCount[slot] = 1;
    let oldest = 0;
    for (let i = 1; i < this.ends.length; i++) if (this.ends[i] < this.ends[oldest]) oldest = i;
    this.ends[oldest] = end;
    this.endCursor = oldest;
    v.action = "start";
    v.slot = slot;
    v.count = 1;
    v.sameTick = true;
    return v;
  }

  /** A landing thump at `time`: true while the tick has room for one. */
  thump(time: number): boolean {
    this.beginTick(time);
    if (this.thumps >= LOOP_THUMPS_PER_TICK) return false;
    this.thumps++;
    return true;
  }

  /** A noise burst (click, crack, wash) at `time`: true while the tick has room for one. */
  noise(time: number): boolean {
    this.beginTick(time);
    if (this.noises >= LOOP_NOISES_PER_TICK) return false;
    this.noises++;
    return true;
  }

  /** Forgets everything (a new run). */
  reset() {
    this.tickStart = -Infinity;
    this.notes = this.thumps = this.noises = 0;
    this.ends.fill(-Infinity);
    this.endCursor = 0;
    this.recentAt.fill(-Infinity);
    this.recentCount.fill(0);
    this.recentCursor = 0;
    this.onsets.fill(-Infinity);
    this.onsetCursor = 0;
  }
}

/** The pluck's T60 for the density at hand: the mode's own (dense / sparse), short above `busyRate` onsets a second. */
export function pluckT60(onsetsPerSec: number, dense: boolean, tone: LoopPluckTone = LOOP_PLUCK): number {
  if (onsetsPerSec > tone.busyRate) return tone.t60Busy;
  return dense ? tone.t60Dense : tone.t60Sparse;
}

/** The narrow velocity rule of the pluck: 0.8 + 0.2 · impact speed (normalised, clamped 0–1). */
export function pluckVelocity(speedNorm: number): number {
  const s = Number.isFinite(speedNorm) ? Math.max(0, Math.min(1, speedNorm)) : 0;
  return 0.8 + 0.2 * s;
}
