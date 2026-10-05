import { SameTimeVoices } from "./masterBus";
import { FlSynthCache, scheduleFlRecipe } from "./flSynth";
import { FL_TIER_PEAK, flTrimKey } from "./flRecipes";
import { FL_RECIPE_TRIMS } from "./flRecipeTrims";
import { FL_BUSES, type FlBus, type FlResolution, type FlVoice } from "./flSoundResolve";

/**
 * --- fl-overhaul --- (Stage 4) Fight League's mixer: the voices a resolved cue names (flSoundResolve.ts) played through seven
 * buses – swing, shoot, hit, ability, ambient (the energy blades' hums), match (the stings) and announcer – into the
 * ToneGenerator's master gain. Every recipe is normalised by its generated trim (flRecipeTrims.ts: one-shot peak 0.40,
 * charge 0.30, held 0.25) and a clip by its measured peak; a bus has its level (× the settings' scale) and its voice limit
 * (identical same-time voices share it like the bounces do – SameTimeVoices); past the limit the quietest-priority, oldest
 * voice is stolen with a 15 ms fade (25 ms for the announcer). The same recipe of the same fighter within 40 ms plays once.
 * A sting (match, announcer, a KO) ducks the weapon buses (−6 dB, the abilities −3 dB) for its length and the music bed
 * through `hooks.duckBed`; a big hit ducks the bed too. Loops (a blade's hum) live on a lease that every loopStart renews and
 * fade out when it runs out (no housekeeping needed, also in an offline render); a held ability's sustain can be cut short
 * by its loopStop; a swing swishes its fighter's hum.
 */

export const FL_BUS_GAIN: Readonly<Record<FlBus, number>> = { announcer: 1, match: 0.9, ability: 0.8, hit: 0.7, shoot: 0.55, swing: 0.4, ambient: 0.5 };
export const FL_BUS_VOICES: Readonly<Record<FlBus, number>> = { announcer: 1, match: 2, ability: 4, ambient: 3, hit: 6, shoot: 4, swing: 3 };
export const FL_BUS_PRIORITY: Readonly<Record<FlBus, number>> = { announcer: 4, match: 4, ability: 3, hit: 2, shoot: 1.5, swing: 1, ambient: 1 };
/** Voices at once over every bus (the loops apart). */
export const FL_MAX_VOICES = 18;
/**
 * The weapon buses' new voices per `FL_RATE_WINDOW_SEC` of audio time: a fast playback (8×) or a beat-locked pile-up plays
 * the first ones and drops the rest (the cues themselves stay the tick budget's – this only thins how densely they sound).
 */
export const FL_RATE_WINDOW_SEC = 0.05;
export const FL_BUS_RATE: Readonly<Partial<Record<FlBus, number>>> = { swing: 2, shoot: 3, hit: 4 };
export const FL_MAX_LOOPS = 6;
/** The same recipe of the same fighter this close plays once (s). */
export const FL_MERGE_SEC = 0.04;
/** A stolen voice's fade (s); the announcer's. */
export const FL_STEAL_SEC = 0.015;
export const FL_STEAL_ANNOUNCER_SEC = 0.025;
/** A sting's ducking of the weapon buses (−6 dB) and of the abilities (−3 dB), held this long past its end (s). */
export const FL_DUCK_WEAPONS = 0.5;
export const FL_DUCK_ABILITY = 0.71;
export const FL_DUCK_TAIL_SEC = 0.18;
/** A loop's fade in / out (s). */
export const FL_LOOP_FADE_IN = 0.06;
export const FL_LOOP_FADE_OUT = 0.15;
/** The peak a clip is normalised to and the longest it plays (s). */
export const FL_CLIP_PEAK = 0.4;
export const FL_CLIP_MAX_SEC = 3;

/** The gain that brings `text` played at pitch `h` to its tier's peak (1 for a recipe without a trim). */
export function flTrim(text: string, h: number): number {
  return FL_RECIPE_TRIMS[flTrimKey(text, h)] ?? 1;
}

export interface FlMixerHooks {
  /** Ducks the music bed at `time` (the ToneGenerator's MusicBed). */
  duckBed?: (time: number) => void;
  /** A decoded clip by key, with its measured peak (null: not decoded). */
  clip?: (key: string) => { buffer: AudioBuffer; peak: number } | null;
}

/** How one cue plays: its context time, pitches and level (the cue's level × the arena's), position, variation and holds. */
export interface FlPlayParams {
  time: number;
  F: number;
  R: number;
  level: number;
  pan: number;
  variant: number;
  slow: number;
  /** A held voice's hold (s; the cue's flSec), a loop's lease. */
  sustainSec?: number;
  /** × every length (a longer telegraph class). */
  stretch?: number;
  /** The fighter it belongs to (`${arena}:${slot}`; "" for the match): merging, swishes. */
  fighter: string;
  /** A held sound's key (`${arena}:${flLoop}`). */
  loopKey?: string;
  /** Whether a swing swishes its fighter's hum. */
  swish?: boolean;
}

interface Voice {
  bus: FlBus;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  start: number;
  end: number;
  prio: number;
  loopKey?: string;
}

interface Loop {
  gain: GainNode;
  swishFilter: BiquadFilterNode | null;
  sources: AudioScheduledSourceNode[];
  level: number;
  leaseUntil: number;
  started: number;
  fighter: string;
  recipe: string;
  bus: FlBus;
}

function setTarget(p: AudioParam, value: number, time: number, tau: number) {
  if (typeof p.setTargetAtTime === "function") p.setTargetAtTime(value, time, Math.max(0.001, tau));
  else p.setValueAtTime(value, time);
}

function cancel(p: AudioParam, time: number) {
  if (typeof p.cancelScheduledValues === "function") p.cancelScheduledValues(time);
}

function stopAll(sources: readonly AudioScheduledSourceNode[], time: number) {
  for (const s of sources) {
    try {
      s.stop(time);
    } catch {
      // already stopped
    }
  }
}

export class FlMixer {
  private readonly bus: Record<FlBus, GainNode>;
  private readonly duck: Record<FlBus, GainNode>;
  private readonly duckUntil: Record<FlBus, number>;
  private readonly stacks: Record<FlBus, SameTimeVoices>;
  private voices: Voice[] = [];
  private readonly held = new Map<string, Voice>();
  private readonly loops = new Map<string, Loop>();
  private readonly recent = new Map<string, number>();
  private readonly rate: Partial<Record<FlBus, { start: number; n: number }>> = {};
  private readonly cache = new FlSynthCache();
  private levelScale = 1;
  /** Voices started (for the tests and the page's counters). */
  started = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    private readonly hooks: FlMixerHooks = {},
  ) {
    const bus = {} as Record<FlBus, GainNode>;
    const duck = {} as Record<FlBus, GainNode>;
    const until = {} as Record<FlBus, number>;
    const stacks = {} as Record<FlBus, SameTimeVoices>;
    for (const b of FL_BUSES) {
      const g = ctx.createGain();
      g.gain.value = FL_BUS_GAIN[b];
      const d = ctx.createGain();
      d.gain.value = 1;
      g.connect(d);
      d.connect(out);
      bus[b] = g;
      duck[b] = d;
      until[b] = -Infinity;
      stacks[b] = new SameTimeVoices(FL_BUS_VOICES[b] * 2);
    }
    this.bus = bus;
    this.duck = duck;
    this.duckUntil = until;
    this.stacks = stacks;
  }

  /** The buses' level scale (the settings' master for the fight's sounds). */
  setLevelScale(scale: number) {
    this.levelScale = Number.isFinite(scale) ? Math.max(0, scale) : 1;
    for (const b of FL_BUSES) this.bus[b].gain.value = FL_BUS_GAIN[b] * this.levelScale;
  }

  /** The bus's input (a voice connects here). */
  busInput(b: FlBus): GainNode {
    return this.bus[b];
  }

  /** Voices playing at `now` (the loops apart). */
  activeVoices(now: number): number {
    let n = 0;
    for (const v of this.voices) if (v.end > now) n++;
    return n;
  }

  loopCount(): number {
    return this.loops.size;
  }

  /** Plays the voices of `res` (see FlPlayParams); returns how many started. */
  play(res: FlResolution, p: FlPlayParams): number {
    const now = this.ctx.currentTime;
    this.prune(now);
    let n = 0;
    for (const v of res.voices) {
      const t = Math.max(now, p.time + v.delay);
      if (v.loop) {
        if (p.loopKey !== undefined && v.recipe) n += this.loopStart(p.loopKey, v, p, t) ? 1 : 0;
        continue;
      }
      n += this.voice(v, p, t) ? 1 : 0;
    }
    if (p.swish) this.swish(p.fighter, Math.max(now, p.time));
    this.started += n;
    return n;
  }

  /** Stops the loop or held sound `key` (a fade); `prefix` stops every one whose key starts with it (an arena's). */
  stop(key: string, time: number, prefix = false) {
    const t = Math.max(this.ctx.currentTime, time);
    for (const [k, loop] of this.loops) {
      if (prefix ? !k.startsWith(key) : k !== key) continue;
      this.releaseLoop(loop, t);
      this.loops.delete(k);
    }
    for (const [k, v] of this.held) {
      if (prefix ? !k.startsWith(key) : k !== key) continue;
      this.fade(v, t, 0.05);
      this.held.delete(k);
    }
  }

  /** Everything off now (a reset, a stop). */
  stopEverything() {
    const t = this.ctx.currentTime;
    for (const loop of this.loops.values()) this.releaseLoop(loop, t);
    this.loops.clear();
    for (const v of this.voices) this.fade(v, t, FL_STEAL_SEC);
    this.voices = [];
    this.held.clear();
    this.recent.clear();
  }

  private prune(now: number) {
    if (this.voices.length > 0 && this.voices[0].end <= now) this.voices = this.voices.filter((v) => v.end > now);
    if (this.recent.size > 256) for (const [k, t] of this.recent) if (now - t > 1) this.recent.delete(k);
    for (const [k, v] of this.held) if (v.end <= now) this.held.delete(k);
    for (const [k, loop] of this.loops) if (loop.leaseUntil + FL_LOOP_FADE_OUT < now) this.loops.delete(k);
  }

  private fade(v: Voice, t: number, sec: number) {
    cancel(v.gain.gain, t);
    setTarget(v.gain.gain, 0, t, sec / 3);
    stopAll(v.sources, t + sec * 4);
    v.end = Math.min(v.end, t + sec * 4);
  }

  /** Makes room for a voice of priority `prio` on `bus`; false when every candidate outranks it (the new one is dropped). */
  private room(bus: FlBus, prio: number, now: number): boolean {
    const playing = this.voices.filter((v) => v.end > now);
    const onBus = playing.filter((v) => v.bus === bus);
    const steal = (pool: Voice[]): boolean => {
      let pick: Voice | null = null;
      for (const v of pool) if (!pick || v.prio < pick.prio || (v.prio === pick.prio && v.start < pick.start)) pick = v;
      if (!pick || pick.prio > prio) return false;
      this.fade(pick, now, pick.bus === "announcer" ? FL_STEAL_ANNOUNCER_SEC : FL_STEAL_SEC);
      // (gone from the count at once: it only fades out)
      const stolen = pick;
      this.voices = this.voices.filter((v) => v !== stolen);
      if (stolen.loopKey !== undefined && this.held.get(stolen.loopKey) === stolen) this.held.delete(stolen.loopKey);
      playing.splice(playing.indexOf(stolen), 1);
      return true;
    };
    if (onBus.length >= FL_BUS_VOICES[bus] && !steal(onBus)) return false;
    if (playing.length >= FL_MAX_VOICES && !steal(playing)) return false;
    return true;
  }

  private voice(v: FlVoice, p: FlPlayParams, t: number): boolean {
    const ctx = this.ctx;
    const what = v.clip ?? v.recipe ?? "";
    const mergeKey = `${p.fighter}|${what}|${v.rMul}`;
    const last = this.recent.get(mergeKey);
    if (last !== undefined && Math.abs(t - last) < FL_MERGE_SEC) return false;
    const cap = FL_BUS_RATE[v.bus];
    if (cap !== undefined) {
      const w = this.rate[v.bus] ?? (this.rate[v.bus] = { start: -Infinity, n: 0 });
      if (!(Math.abs(t - w.start) < FL_RATE_WINDOW_SEC)) {
        w.start = t;
        w.n = 0;
      }
      if (w.n >= cap) return false;
      w.n++;
    }
    const share = this.stacks[v.bus].add(t, what, p.F * 7 + v.h);
    if (share <= 0) return false;
    const prio = FL_BUS_PRIORITY[v.bus];
    if (!this.room(v.bus, prio, ctx.currentTime)) return false;
    const gain = ctx.createGain();
    const sources: AudioScheduledSourceNode[] = [];
    let end = t;
    if (v.clip) {
      const clip = this.hooks.clip?.(v.clip);
      if (!clip) return false;
      gain.gain.value = Math.min(4, FL_CLIP_PEAK / Math.max(0.05, clip.peak)) * p.level * v.gain * share;
      const s = ctx.createBufferSource();
      s.buffer = clip.buffer;
      if (Math.abs(p.slow - 1) > 1e-3) s.playbackRate.value = p.slow;
      s.connect(gain);
      const sec = Math.min(FL_CLIP_MAX_SEC, clip.buffer.duration);
      s.start(t, 0, sec);
      sources.push(s);
      end = t + sec / Math.max(0.25, p.slow);
    } else if (v.recipe) {
      gain.gain.value = flTrim(v.recipe, v.h) * p.level * v.gain * share;
      const r = scheduleFlRecipe(ctx, gain, v.recipe, t, {
        F: p.F,
        R: p.R * v.rMul,
        H: v.h,
        pan: p.pan,
        variant: p.variant,
        slow: p.slow,
        stretch: p.stretch,
        sustainSec: v.held ? p.sustainSec : undefined,
        cache: this.cache,
        sources,
      });
      end = r.end;
    } else return false;
    gain.connect(this.bus[v.bus]);
    const voice: Voice = { bus: v.bus, gain, sources, start: t, end, prio };
    this.voices.push(voice);
    this.voices.sort((a, b) => a.end - b.end);
    this.recent.set(mergeKey, t);
    if (v.held && p.loopKey !== undefined) {
      const old = this.held.get(p.loopKey);
      if (old) this.fade(old, t, 0.05);
      voice.loopKey = p.loopKey;
      this.held.set(p.loopKey, voice);
    }
    this.duckFor(v, p, t, end);
    return true;
  }

  /** A sting ducks the weapons (and the bed); a big hit or an ability's cast ducks the bed. */
  private duckFor(v: FlVoice, p: FlPlayParams, t: number, end: number) {
    // (a short tick – the count, the clock – ducks nothing)
    const sting = (v.bus === "match" || v.bus === "announcer") && (!Number.isFinite(end) || end - t > 0.2);
    if (sting) {
      const until = (Number.isFinite(end) ? end : t + 1) + FL_DUCK_TAIL_SEC;
      for (const b of ["hit", "shoot", "swing", "ambient", "ability"] as const) this.duckBus(b, b === "ability" ? FL_DUCK_ABILITY : FL_DUCK_WEAPONS, t, until);
    }
    if (sting || (v.bus === "ability" && v.tier === "oneShot" && v.source !== "tint") || (v.bus === "hit" && p.level >= 0.95)) this.hooks.duckBed?.(t);
  }

  private duckBus(b: FlBus, level: number, t: number, until: number) {
    const g = this.duck[b].gain;
    const end = Math.max(until, this.duckUntil[b]);
    cancel(g, t);
    setTarget(g, level, t, 0.01);
    setTarget(g, 1, end, 0.05);
    this.duckUntil[b] = end;
  }

  private loopStart(key: string, v: FlVoice, p: FlPlayParams, t: number): boolean {
    const lease = Math.max(0.2, Number.isFinite(p.sustainSec) && (p.sustainSec as number) > 0 ? (p.sustainSec as number) : 1.5);
    const existing = this.loops.get(key);
    if (existing && existing.recipe === v.recipe && existing.leaseUntil + FL_LOOP_FADE_OUT > t) {
      existing.leaseUntil = Math.max(existing.leaseUntil, t + lease);
      this.scheduleLease(existing, t);
      return false;
    }
    if (existing) {
      this.releaseLoop(existing, t);
      this.loops.delete(key);
    }
    if (this.loops.size >= FL_MAX_LOOPS) {
      let oldest: [string, Loop] | null = null;
      for (const e of this.loops) if (!oldest || e[1].started < oldest[1].started) oldest = e;
      if (oldest) {
        this.releaseLoop(oldest[1], t);
        this.loops.delete(oldest[0]);
      }
    }
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let swishFilter: BiquadFilterNode | null = null;
    let into: AudioNode = gain;
    if (typeof ctx.createBiquadFilter === "function") {
      swishFilter = ctx.createBiquadFilter();
      swishFilter.type = "peaking";
      swishFilter.frequency.value = 700;
      swishFilter.Q.value = 0.8;
      swishFilter.gain.value = 0;
      swishFilter.connect(gain);
      into = swishFilter;
    }
    gain.connect(this.bus[v.bus]);
    const sources: AudioScheduledSourceNode[] = [];
    const level = flTrim(v.recipe!, v.h) * p.level * v.gain;
    scheduleFlRecipe(ctx, into, v.recipe!, t, { F: p.F, R: p.R, H: v.h, pan: p.pan, variant: p.variant, slow: p.slow, sustainSec: Infinity, cache: this.cache, sources });
    const loop: Loop = { gain, swishFilter, sources, level, leaseUntil: t + lease, started: t, fighter: p.fighter, recipe: v.recipe!, bus: v.bus };
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + FL_LOOP_FADE_IN);
    this.scheduleLease(loop, t + FL_LOOP_FADE_IN);
    this.loops.set(key, loop);
    return true;
  }

  /** The loop's fade-out at the end of its lease (rescheduled at every renewal) and its sources' stop. */
  private scheduleLease(loop: Loop, t: number) {
    const g = loop.gain.gain;
    const from = Math.max(t, this.ctx.currentTime);
    cancel(g, from);
    g.setValueAtTime(loop.level, from);
    g.setValueAtTime(loop.level, Math.max(from, loop.leaseUntil));
    g.linearRampToValueAtTime(0, Math.max(from, loop.leaseUntil) + FL_LOOP_FADE_OUT);
    stopAll(loop.sources, Math.max(from, loop.leaseUntil) + FL_LOOP_FADE_OUT + 0.05);
  }

  private releaseLoop(loop: Loop, t: number) {
    loop.leaseUntil = Math.min(loop.leaseUntil, t);
    const g = loop.gain.gain;
    cancel(g, t);
    g.setValueAtTime(loop.level, t);
    g.linearRampToValueAtTime(0, t + FL_LOOP_FADE_OUT);
    stopAll(loop.sources, t + FL_LOOP_FADE_OUT + 0.05);
  }

  /** A swing brightens its fighter's hum for a moment (the blade's angular speed). */
  private swish(fighter: string, t: number) {
    for (const loop of this.loops.values()) {
      if (loop.fighter !== fighter || loop.bus !== "ambient" || !loop.swishFilter || loop.leaseUntil < t) continue;
      const f = loop.swishFilter;
      cancel(f.gain, t);
      cancel(f.frequency, t);
      f.gain.setValueAtTime(0, t);
      f.gain.linearRampToValueAtTime(9, t + 0.12);
      f.gain.linearRampToValueAtTime(0, t + 0.36);
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(1700, t + 0.14);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.36);
    }
  }
}

/** The peak a recipe of `tier` is normalised to (re-exported for the page's level meter). */
export const FL_PEAKS = FL_TIER_PEAK;
