import { SCALE_INTERVALS, isScaleId, midiToFrequency, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, ModeId, SoundEvent } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Power Layers ("powerLayers" mode, feature odd-power-layers – the oddplayground "It starts tiny and gets out of
 * control" and "800 layers between the ball and freedom" clips). No rings: a portrait playfield on navy – the column
 * the recorder's centred square shows in full – with a glowing ceiling bar in its upper third and, from mid-screen
 * down, a dense stack of 20–800 thin rainbow layers (the hue sweeps down the stack and repeats). One white ball bounces
 * between the ceiling and the top of the stack with a slight seeded sideways drift; gravity pulls it down, the ceiling
 * reflects it. Every impact on the stack destroys `power` layers – they shatter into coloured particles and the stack
 * top drops – and then the power advances by the sequence: double (1, 2, 4, 8 …), fibonacci, primes, +1 per hit or
 * chaos (each power drawn from the seed between 0 and twice the record so far: some hits destroy dozens, others change
 * nothing). When no layer is left the ball falls through the bottom – freedom – with a burst, and the run ends.
 *
 * The rhythm is exact: every bounce takes the same period T (the Bounce Speed), whatever the depth of the stack – the
 * mode solves, per bounce, the speed the ball must meet the ceiling with so that the up-leg (from the old top) plus the
 * down-leg (to the new, lower top) under the arc gravity take exactly T (`ceilingSpeed()`), so the ball speeds up as
 * the stack drops: "it gets out of control". The ball's vertical motion is analytic on the simulation clock (like
 * Pendulum Wave: `onBallStep()` overwrites the position), so the air drag, wind or keyframed gravity of the engine never
 * shift a hit. Hit k lands at T·(k + ½); after the last hit the ball leaves the field within T/2; the run finishes a
 * `FREEDOM_HOLD_SEC` celebration later. The run length is therefore the hit count times the bounce period plus the
 * hold – fixed by the settings for every sequence but chaos (`powerLayersFixedDurationSec()`), and known as soon as a
 * chaos seed's plan is drawn (`PowerLayersMode.getProgress().plannedMs`, the finder's duration predicate).
 *
 * Determinism: the whole plan (every power, every layer count) is drawn at init from `ctx.random()`; the drift kicks
 * at every hit too. The shatter particles are analytic (spawn state + age, no per-step update) and draw from a
 * separate generator seeded once at init, so they never touch the physics stream.
 *
 * Sound goes through the ToneGenerator as ordinary sound events (melody, instruments, hit samples, beat lock, slicer
 * and music bed keep working): every hit is the next note of the Sound section's scale (a diatonic major scale while
 * it is chromatic), rising with the level – a new sound every level; a hit that destroys `BIG_HIT_LAYERS` or more adds a
 * chord and a whoosh (the wall-break sound, which also shakes the cinematic camera); the hit that clears the stack plays
 * a fanfare (a chord and the rising multiplier arpeggio) and the fall through the bottom the wall-break sound.
 */

/* ------------------------------------------------------------------ settings */

export const PL_SEQUENCES = ["double", "fibonacci", "primes", "plusOne", "random"] as const;
export type PlSequence = (typeof PL_SEQUENCES)[number];
/** The corner badge: "SOUND ON", the flashing-lights warning, both, or none. */
export const PL_BADGES = ["sound", "warning", "both", "none"] as const;
export type PlBadge = (typeof PL_BADGES)[number];

export function isPlSequence(value: unknown): value is PlSequence {
  return typeof value === "string" && (PL_SEQUENCES as readonly string[]).includes(value);
}
export function isPlBadge(value: unknown): value is PlBadge {
  return typeof value === "string" && (PL_BADGES as readonly string[]).includes(value);
}

export interface PowerLayersSettings {
  /** Layers in the stack, 20–800. */
  layers: number;
  /** How the power advances after every hit. */
  sequence: PlSequence;
  /** 0–1: the seeded sideways drift of the ball (0 = straight up and down). */
  drift: number;
  /** 0.5–2: bounces per second relative to one a second (the bounce period is `BASE_PERIOD_SEC / speed`). */
  speed: number;
  /** The corner badge (live). */
  badge: PlBadge;
  /** The two rainbow rule pills at the top (live). */
  pills: boolean;
  /** The Sound section's scale and root: every level is the next degree of it (live). */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_POWER_LAYERS_SETTINGS: PowerLayersSettings = {
  layers: 120,
  sequence: "double",
  drift: 0.35,
  speed: 1,
  badge: "sound",
  pills: true,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const POWER_LAYERS_RANGES = {
  plLayers: { min: 20, max: 800, step: 10 },
  plDrift: { min: 0, max: 1, step: 0.05 },
  plSpeed: { min: 0.5, max: 2, step: 0.05 },
} as const;

/** The Power Layers fields of the SimulatorSettings object (URL keys pll, plq, pld, plsp, plb, plp). */
export interface PowerLayersFields {
  plLayers: number;
  plSequence: PlSequence;
  plDrift: number;
  plSpeed: number;
  plBadge: PlBadge;
  plPills: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Fills in the defaults and clamps every value (layers whole, drift and speed on their 0.05 steps); unknown options fall back to the defaults. */
export function resolvePowerLayersSettings(config: Partial<PowerLayersSettings> | null | undefined): PowerLayersSettings {
  const out = { ...DEFAULT_POWER_LAYERS_SETTINGS };
  if (!config) return out;
  const R = POWER_LAYERS_RANGES;
  if (config.layers !== undefined) out.layers = memoryCeiling("plLayers", Math.round(clampNumber(config.layers, R.plLayers, out.layers)));
  if (isPlSequence(config.sequence)) out.sequence = config.sequence;
  if (config.drift !== undefined) out.drift = Math.round(20 * clampNumber(config.drift, R.plDrift, out.drift)) / 20;
  if (config.speed !== undefined) out.speed = Math.round(20 * clampNumber(config.speed, R.plSpeed, out.speed)) / 20;
  if (isPlBadge(config.badge)) out.badge = config.badge;
  if (typeof config.pills === "boolean") out.pills = config.pills;
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** Picks the Power Layers settings (and the Sound section's scale and root) out of a bigger object for `engine.setPowerLayersSettings()`. */
export function powerLayersSettingsOf(source: PowerLayersFields & { scale?: ScaleId; rootNote?: number }): PowerLayersSettings {
  return {
    layers: source.plLayers,
    sequence: source.plSequence,
    drift: source.plDrift,
    speed: source.plSpeed,
    badge: source.plBadge,
    pills: source.plPills,
    scale: source.scale ?? DEFAULT_POWER_LAYERS_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_POWER_LAYERS_SETTINGS.rootNote,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function powerLayersSettingFields(settings: PowerLayersSettings): PowerLayersFields {
  return { plLayers: settings.layers, plSequence: settings.sequence, plDrift: settings.drift, plSpeed: settings.speed, plBadge: settings.badge, plPills: settings.pills };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** The defaults of the feature's fields. */
export function defaultPowerLayersFields(): PowerLayersFields {
  return powerLayersSettingFields(DEFAULT_POWER_LAYERS_SETTINGS);
}

/** The mode's own defaults of shared settings: a ball of radius 10 (the clips' white ball); nothing for the other modes. */
export function powerLayersModeDefaults(mode: ModeId): { ballRadius?: number } {
  return mode === "powerLayers" ? { ballRadius: 10 } : {};
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers, known options, real booleans. */
export function resolvePowerLayersFields(source: Partial<PowerLayersFields>): PowerLayersFields {
  return powerLayersSettingFields(
    resolvePowerLayersSettings({ layers: source.plLayers, sequence: source.plSequence, drift: source.plDrift, speed: source.plSpeed, badge: source.plBadge, pills: source.plPills }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { pll: "plLayers", pld: "plDrift", plsp: "plSpeed" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: pll, plq, pld, plsp, plb and plp. */
export function writePowerLayersParams(settings: PowerLayersFields, base: PowerLayersFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.plSequence !== base.plSequence) params.set("plq", settings.plSequence);
  if (settings.plBadge !== base.plBadge) params.set("plb", settings.plBadge);
  if (settings.plPills !== base.plPills) params.set("plp", settings.plPills ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readPowerLayersParams(params: URLSearchParams, settings: PowerLayersFields) {
  const next: Partial<PowerLayersFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const sequence = params.get("plq");
  if (isPlSequence(sequence)) next.plSequence = sequence;
  const badge = params.get("plb");
  if (isPlBadge(badge)) next.plBadge = badge;
  const pills = params.get("plp");
  if (pills === "1") next.plPills = true;
  else if (pills === "0") next.plPills = false;
  Object.assign(settings, resolvePowerLayersFields(next));
}

/* ------------------------------------------------------------------ the power sequences */

/** No power grows past this (the plan stops long before: a hit never needs more than the layers left). */
export const POWER_CAP = 1e9;

export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

/** The smallest prime above `n`. */
export function nextPrime(n: number): number {
  let m = Math.max(2, Math.floor(n) + 1);
  while (!isPrime(m)) m++;
  return m;
}

/**
 * The power of every hit: `power` is the power the next hit destroys with, `advance()` moves it on after a hit.
 *  - double: 1, 2, 4, 8, 16 …
 *  - fibonacci: 1, 1, 2, 3, 5, 8 …
 *  - primes: 2, 3, 5, 7, 11 …
 *  - plusOne: 1, 2, 3, 4 …
 *  - random ("chaos"): 1, then each power drawn uniformly from 0 … twice the record so far (one `random()` per
 *    advance), so zero-power hits change nothing, some hits destroy dozens, and the record keeps the chaos alive.
 */
export class PowerSequence {
  readonly kind: PlSequence;
  power: number;
  private fibNext = 1;
  private record = 1;
  private readonly random: () => number;

  constructor(kind: PlSequence, random: () => number = () => 0.5) {
    this.kind = kind;
    this.random = random;
    this.power = kind === "primes" ? 2 : 1;
  }

  advance(): number {
    switch (this.kind) {
      case "double":
        this.power = Math.min(POWER_CAP, 2 * this.power);
        break;
      case "fibonacci": {
        const next = Math.min(POWER_CAP, this.power + this.fibNext);
        this.power = this.fibNext;
        this.fibNext = next;
        break;
      }
      case "primes":
        this.power = this.power >= POWER_CAP ? POWER_CAP : nextPrime(this.power);
        break;
      case "plusOne":
        this.power = Math.min(POWER_CAP, this.power + 1);
        break;
      case "random": {
        const u = this.random();
        this.power = Math.min(POWER_CAP, Math.floor(Math.max(0, Math.min(0.999999999, u)) * (2 * this.record + 1)));
        if (this.power > this.record) this.record = this.power;
        break;
      }
    }
    return this.power;
  }
}

/** The first `count` powers of a sequence (the tests and the panel's hint use it). */
export function sequencePowers(kind: PlSequence, count: number, random?: () => number): number[] {
  const seq = new PowerSequence(kind, random);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(seq.power);
    seq.advance();
  }
  return out;
}

/** A run never takes more hits than this (only a pathological chaos seed could get near): the last one clears the rest. */
export const MAX_PLAN_HITS = 5000;

/** The whole run, drawn at init: what every hit destroys. */
export interface PowerPlan {
  layers: number;
  sequence: PlSequence;
  /** The power of every hit. */
  powers: number[];
  /** Layers every hit destroyed: min(power, layers left); 0 for a zero-power hit. */
  destroyed: number[];
  /** Layers gone after every hit (a running sum; the last is `layers`). */
  goneAfter: number[];
  /** The power after the last hit. */
  finalPower: number;
}

/** Plays the sequence against the stack until no layer is left. */
export function buildPowerPlan(layers: number, sequence: PlSequence, random: () => number = () => 0.5): PowerPlan {
  const total = Math.max(1, Math.round(layers));
  const seq = new PowerSequence(sequence, random);
  const powers: number[] = [];
  const destroyed: number[] = [];
  const goneAfter: number[] = [];
  let gone = 0;
  while (gone < total) {
    const p = seq.power;
    const left = total - gone;
    const d = powers.length >= MAX_PLAN_HITS - 1 ? left : Math.min(p, left);
    powers.push(p);
    destroyed.push(d);
    gone += d;
    goneAfter.push(gone);
    seq.advance();
  }
  return { layers: total, sequence, powers, destroyed, goneAfter, finalPower: seq.power };
}

/** Layers gone before hit `k` (0 before the first). */
export function goneBefore(plan: PowerPlan, k: number): number {
  return k <= 0 ? 0 : plan.goneAfter[Math.min(k, plan.goneAfter.length) - 1];
}

/* ------------------------------------------------------------------ timing */

/** The bounce period at Bounce Speed 1 (s). */
export const BASE_PERIOD_SEC = 1;
/** How long the freedom celebration plays after the ball left the field at the latest (s). */
export const FREEDOM_HOLD_SEC = 1.8;
/** A hit that destroys this many layers or more adds the chord whoosh. */
export const BIG_HIT_LAYERS = 10;

/** Seconds from one hit to the next. */
export function bouncePeriodSec(speed: number): number {
  const s = Number.isFinite(speed) ? atLeastMin(speed, POWER_LAYERS_RANGES.plSpeed) : 1; // --- uncap-all --- (no maximum)
  return BASE_PERIOD_SEC / s;
}

/** Simulation time of hit `k` (0-based): the ball drops from the ceiling for half a period, then one hit a period. */
export function hitTimeSec(k: number, period: number): number {
  return period * (k + 0.5);
}

/** When a run of `hits` hits is over: the last hit, half a period to fall out, and the celebration. */
export function runFinishSec(hits: number, period: number): number {
  return hits * period + FREEDOM_HOLD_SEC;
}

/** The fixed 60 Hz step at which a run of this length finishes, as the engine's clock reads it (ms). */
export function finishStepMs(finishSec: number, stepMs = 1000 / 60): number {
  return Math.ceil((1000 * finishSec - 1e-6) / stepMs) * stepMs;
}

/**
 * The run length (s) when the settings fix it whatever the seed – every sequence but chaos: the hit count of the plan
 * times the bounce period, plus the celebration – or null for chaos, whose hit count depends on the seed.
 */
export function powerLayersFixedDurationSec(settings: Partial<PowerLayersSettings> | null | undefined): number | null {
  const s = resolvePowerLayersSettings(settings);
  if (s.sequence === "random") return null;
  return runFinishSec(buildPowerPlan(s.layers, s.sequence).powers.length, bouncePeriodSec(s.speed));
}

/* ------------------------------------------------------------------ sound */

/** MIDI note of level 1 before the root is added (C4), and the octaves the levels climb before they fold back. */
export const PL_BASE_MIDI = 60;
export const PL_OCTAVES = 3;

/** The degrees the levels climb: the chosen scale, or a diatonic major scale while the Sound section is chromatic. */
export function levelScale(scale: ScaleId): readonly number[] {
  return scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[scale];
}

/** MIDI note of scale degree `degree` (0 = the root at C4 + root), not folded. */
export function degreeMidi(degree: number, scale: ScaleId, rootNote: number): number {
  const steps = levelScale(scale);
  const n = steps.length;
  const d = Math.max(0, Math.round(degree));
  return PL_BASE_MIDI + normalizeRootNote(rootNote) + 12 * Math.floor(d / n) + steps[d % n];
}

/** The degree hit `k` plays: k, folded into `PL_OCTAVES` octaves of the scale so a long run climbs again from the bottom. */
export function levelDegree(k: number, scale: ScaleId): number {
  const span = levelScale(scale).length * PL_OCTAVES;
  return Math.max(0, Math.round(k)) % span;
}

/** Pitch (Hz) of hit `k`: the next note of the scale every level. */
export function levelPitch(k: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(levelDegree(k, scale), scale, rootNote));
}

/** The chord of a big hit: the level's note with the third, the fifth and the octave above it in the scale. */
export function levelChord(k: number, scale: ScaleId, rootNote: number): number[] {
  const d = levelDegree(k, scale);
  const n = levelScale(scale).length;
  const third = Math.min(2, n - 1);
  const fifth = Math.min(4, n - 1);
  return [d, d + third, d + fifth, d + n].map((x) => midiToFrequency(degreeMidi(x, scale, rootNote)));
}

/** The fanfare chord when the stack is gone: the tonic triad and the octave, an octave above level 1. */
export function fanfareChord(scale: ScaleId, rootNote: number): number[] {
  const n = levelScale(scale).length;
  return [n, n + Math.min(2, n - 1), n + Math.min(4, n - 1), 2 * n].map((x) => midiToFrequency(degreeMidi(x, scale, rootNote)));
}

/* ------------------------------------------------------------------ layout */

/** Width of the playfield relative to its height (a 9:16-ish portrait column inside the recorder's square). */
export const PL_ASPECT = 0.62;
/** Underside of the ceiling bar, as a fraction of the field height from its top (the upper third). */
export const CEILING_AT = 0.3;
/** Thickness of the ceiling bar (field heights). */
export const CEILING_THICKNESS = 0.014;
/** Top and bottom of the full stack (field heights). */
export const STACK_TOP_AT = 0.52;
export const STACK_BOTTOM_AT = 0.965;

export interface PowerField {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  /** Underside of the ceiling bar (px). */
  ceiling: number;
  /** Top and bottom of the full stack (px). */
  stackTop: number;
  stackBottom: number;
}

/** The playfield for a canvas of `width` × `height`: a portrait column filling the height of the centred square the recorder crops to. */
export function buildPowerField(width: number, height: number, out?: PowerField): PowerField {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const side = Math.max(60, Math.min(width, height) - 2 * margin);
  const w = side * PL_ASPECT;
  const left = (width - w) / 2;
  const top = (height - side) / 2;
  const f = out ?? ({} as PowerField);
  f.left = left;
  f.right = left + w;
  f.top = top;
  f.bottom = top + side;
  f.width = w;
  f.height = side;
  f.cx = width / 2;
  f.ceiling = top + CEILING_AT * side;
  f.stackTop = top + STACK_TOP_AT * side;
  f.stackBottom = top + STACK_BOTTOM_AT * side;
  return f;
}

/** The y (px) of the top of the stack once `gone` of `layers` layers are gone. */
export function stackTopAt(field: PowerField, gone: number, layers: number): number {
  const L = Math.max(1, layers);
  return field.stackTop + (Math.max(0, Math.min(L, gone)) / L) * (field.stackBottom - field.stackTop);
}

/** Hue of layer `index` (0 = the top): the rainbow sweeps down the stack and repeats about three times. */
export function layerHue(index: number, layers: number): number {
  const cycle = Math.max(24, layers / 3);
  return (((index / cycle) * 360) % 360 + 360) % 360;
}

/* ------------------------------------------------------------------ the ball's flight */

/** Time (s) to cover `d` px starting at speed `u` px/s under acceleration `g` px/s²: the positive root of d = u t + g t²/2. */
export function fallTime(d: number, u: number, g: number): number {
  const dist = Math.max(0, d);
  const v = Math.max(0, u);
  if (!(g > 1e-9)) return v > 1e-9 ? dist / v : Infinity;
  return (Math.sqrt(v * v + 2 * g * dist) - v) / g;
}

/**
 * The speed (≥ 0, px/s) the ball meets the ceiling with so that rising `a` px to it and falling `b` px back takes
 * exactly `period` s under `g` (both legs are a fall from the ceiling at that speed). The flight time only shrinks as
 * the speed grows, so a bisection finds it; 0 when even a ball that just reaches the ceiling is faster than the period
 * (the arc gravity is chosen so that never happens).
 */
export function ceilingSpeed(a: number, b: number, g: number, period: number): number {
  const span = (u: number) => fallTime(a, u, g) + fallTime(b, u, g);
  if (!(period > 0) || !Number.isFinite(a + b + g) || span(0) <= period) return 0;
  let lo = 0;
  let hi = Math.max(1e-6, (Math.max(0, a) + Math.max(0, b)) / period);
  while (span(hi) > period) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (span(mid) > period) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * The arc gravity (px/s²): a fraction f of 8·d0/T², the most under which a ball that just reaches the ceiling still
 * takes the whole period over the first (shortest) bounce of height `d0` – so every bounce can be timed to T. The
 * Gravity setting picks f (300 → 0.55; lighter floats more evenly, heavier arcs harder).
 */
export function arcGravity(d0: number, period: number, gravitySetting: number): number {
  const factor = Number.isFinite(gravitySetting) ? gravitySetting / 300 : 1;
  const f = Math.max(0.12, Math.min(0.92, 0.55 * factor));
  return (f * 8 * Math.max(1, d0)) / (period * period);
}

/** Sideways drift speed at Drift 1, in field widths per second. */
export const DRIFT_MAX = 0.45;

/* ------------------------------------------------------------------ particles */

/** Shatter particles alive at once (the oldest make room). */
export const MAX_PL_PARTICLES = 640;
/** Most particles one hit throws. */
export const MAX_PARTICLES_PER_HIT = 120;
/** Particles of the freedom burst. */
export const FREEDOM_PARTICLES = 140;
/** Gravity of the particles in field heights per s². */
export const PARTICLE_GRAVITY = 1.5;

/** mulberry32: the particles' own seeded generator (never the physics stream). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ the view */

/** Ceiling contacts remembered for the wobble of the bar. */
export const CEILING_CONTACTS = 4;

/** What the canvas needs to draw the playfield; the same object every call. */
export interface PowerLayersView {
  settings: PowerLayersSettings;
  /** The playfield of the current canvas size. */
  field: PowerField;
  layers: number;
  sequence: PlSequence;
  periodSec: number;
  /** Simulation time (s) at the end of the last step. */
  timeSec: number;
  hits: number;
  totalHits: number;
  gone: number;
  /** The power the next hit destroys with (after the last hit: the power the sequence reached). */
  power: number;
  /** The level – the hit about to land (1 at the start), at most the planned hits. */
  level: number;
  lastDestroyed: number;
  lastHitSec: number;
  /** The layers the last hit destroyed: from `flashFrom` to `flashTo` layers gone (the renderer flashes the band). */
  flashFrom: number;
  flashTo: number;
  bigHits: number;
  lastBigSec: number;
  /** The ball's last ceiling contacts: simulation time and x (fraction of the field width), a ring of `CEILING_CONTACTS`. */
  ceilingSec: Float64Array;
  ceilingX: Float64Array;
  ceilingCount: number;
  freed: boolean;
  freedSec: number;
  freedX: number;
  finished: boolean;
  finishSec: number;
  /** Analytic particles (field-relative: x in widths from the left, y in heights from the top, per second). */
  partX: Float32Array;
  partY: Float32Array;
  partVx: Float32Array;
  partVy: Float32Array;
  partT0: Float64Array;
  partLife: Float32Array;
  partHue: Float32Array;
  partSize: Float32Array;
  /** Next slot to write and the particles thrown so far. */
  partNext: number;
  partSpawned: number;
}

function createView(): PowerLayersView {
  return {
    settings: { ...DEFAULT_POWER_LAYERS_SETTINGS },
    field: buildPowerField(800, 600),
    layers: DEFAULT_POWER_LAYERS_SETTINGS.layers,
    sequence: DEFAULT_POWER_LAYERS_SETTINGS.sequence,
    periodSec: BASE_PERIOD_SEC,
    timeSec: 0,
    hits: 0,
    totalHits: 0,
    gone: 0,
    power: 1,
    level: 1,
    lastDestroyed: 0,
    lastHitSec: -Infinity,
    flashFrom: 0,
    flashTo: 0,
    bigHits: 0,
    lastBigSec: -Infinity,
    ceilingSec: new Float64Array(CEILING_CONTACTS).fill(-Infinity),
    ceilingX: new Float64Array(CEILING_CONTACTS),
    ceilingCount: 0,
    freed: false,
    freedSec: -Infinity,
    freedX: 0.5,
    finished: false,
    finishSec: 0,
    partX: new Float32Array(MAX_PL_PARTICLES),
    partY: new Float32Array(MAX_PL_PARTICLES),
    partVx: new Float32Array(MAX_PL_PARTICLES),
    partVy: new Float32Array(MAX_PL_PARTICLES),
    partT0: new Float64Array(MAX_PL_PARTICLES).fill(-Infinity),
    partLife: new Float32Array(MAX_PL_PARTICLES),
    partHue: new Float32Array(MAX_PL_PARTICLES),
    partSize: new Float32Array(MAX_PL_PARTICLES),
    partNext: 0,
    partSpawned: 0,
  };
}

/** Where the ball is at a moment of the run (px) and how fast it moves vertically (px/s). */
interface FlightPoint {
  y: number;
  vy: number;
}

/* ------------------------------------------------------------------ the mode */

export class PowerLayersMode implements GameMode {
  readonly name = "powerLayers";
  /** The mode times the ball itself: no slow-ball boost. */
  readonly ballsMayRest = true;
  /** One ball; nothing to collide with. */
  readonly ballsPassThrough = true;
  private settings: PowerLayersSettings = { ...DEFAULT_POWER_LAYERS_SETTINGS };
  private readonly view: PowerLayersView = createView();
  private plan: PowerPlan = buildPowerPlan(DEFAULT_POWER_LAYERS_SETTINGS.layers, DEFAULT_POWER_LAYERS_SETTINGS.sequence);
  private ballId = -1;
  /** The mode's clock (ms): the sum of the fixed steps since init. */
  private clockMs = 0;
  private stepStartSec = 0;
  private sub = 0;
  /** Hits handled so far (their layers gone, their sounds queued). */
  private processed = 0;
  /** The ball's x as a fraction of the room it has across the field, and its drift in field widths per second. */
  private ux = 0.5;
  private vux = 0;
  private fx: () => number = mulberry32(1);
  /** The Gravity setting the run started with (it shapes the arcs; a change applies with the next run). */
  private gravity = 300;
  private sizeW = 0;
  private sizeH = 0;
  /** Cache of the bounce being flown (its inputs and the solved ceiling speed). */
  private cK = -99;
  private cA = NaN;
  private cB = NaN;
  private cG = NaN;
  private cU = 0;
  private cT1 = 0;
  private readonly point: FlightPoint = { y: 0, vy: 0 };

  getSettings(): PowerLayersSettings {
    return this.settings;
  }
  /** The layers, sequence, drift and speed apply on the next init; the badge, the pills and the scale at once. */
  setSettings(patch: Partial<PowerLayersSettings>) {
    this.settings = resolvePowerLayersSettings({ ...this.settings, ...patch });
    const live = this.view.settings;
    live.badge = this.settings.badge;
    live.pills = this.settings.pills;
    live.scale = this.settings.scale;
    live.rootNote = this.settings.rootNote;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): PowerLayersView {
    return this.view;
  }
  getPlan(): PowerPlan {
    return this.plan;
  }
  getProgress() {
    const v = this.view;
    return {
      hits: v.hits,
      totalHits: v.totalHits,
      gone: v.gone,
      layers: v.layers,
      power: v.power,
      level: v.level,
      sequence: v.sequence,
      periodSec: v.periodSec,
      freed: v.freed,
      finished: v.finished,
      /** When the run finishes on the engine's 60 Hz clock: the hit count × the bounce period + the celebration. */
      plannedMs: finishStepMs(v.finishSec),
    };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const plan = buildPowerPlan(s.layers, s.sequence, () => ctx.random());
    this.plan = plan;
    const period = bouncePeriodSec(s.speed);
    this.gravity = ctx.config.gravity;
    this.fx = mulberry32(Math.floor(ctx.random() * 0x7fffffff) + 1);
    this.ux = 0.5 + (ctx.random() - 0.5) * 0.3;
    const dir = ctx.random() < 0.5 ? -1 : 1;
    this.vux = dir * (0.5 + 0.5 * ctx.random()) * s.drift * DRIFT_MAX;
    this.clockMs = 0;
    this.stepStartSec = 0;
    this.sub = 0;
    this.processed = 0;
    this.cK = -99;
    const v = this.view;
    v.settings = { ...s };
    v.layers = plan.layers;
    v.sequence = s.sequence;
    v.periodSec = period;
    v.timeSec = 0;
    v.hits = 0;
    v.totalHits = plan.powers.length;
    v.gone = 0;
    v.power = plan.powers[0];
    v.level = 1;
    v.lastDestroyed = 0;
    v.lastHitSec = -Infinity;
    v.flashFrom = 0;
    v.flashTo = 0;
    v.bigHits = 0;
    v.lastBigSec = -Infinity;
    v.ceilingSec.fill(-Infinity);
    v.ceilingCount = 0;
    v.freed = false;
    v.freedSec = -Infinity;
    v.freedX = 0.5;
    v.finished = false;
    v.finishSec = runFinishSec(plan.powers.length, period);
    v.partT0.fill(-Infinity);
    v.partNext = 0;
    v.partSpawned = 0;
    const cfg = ctx.config;
    this.refreshField(cfg.width, cfg.height);
    const radius = cfg.ballRadius || 10;
    ctx.addBall({ x: v.field.cx, y: v.field.ceiling + radius, vx: 0, vy: 0, radius, color: cfg.ballColor || "#FFFFFF", gravityScale: 0 });
    this.ballId = ctx.getNextId() - 1;
    const ball = this.findBall(ctx);
    if (ball) this.place(ctx, ball, 0);
  }

  private refreshField(width: number, height: number) {
    if (width === this.sizeW && height === this.sizeH) return;
    this.sizeW = width;
    this.sizeH = height;
    buildPowerField(width, height, this.view.field);
    this.cK = -99;
  }

  private findBall(ctx: ModeContext): Ball | null {
    for (const b of ctx.getBalls()) if (b.id === this.ballId) return b;
    return null;
  }

  /** The ball's contact heights: its centre touching the ceiling, and touching the top of the stack with `gone` layers gone. */
  private ceilingY(r: number) {
    return this.view.field.ceiling + r;
  }
  private topY(gone: number, r: number) {
    return stackTopAt(this.view.field, gone, this.plan.layers) - r;
  }

  /** Solves (and caches) bounce `k`: from the top before hit k up to the ceiling and down to the top after it. */
  private bounce(k: number, r: number, g: number) {
    const c = this.ceilingY(r);
    const a = Math.max(1, this.topY(goneBefore(this.plan, k), r) - c);
    const b = Math.max(1, this.topY(this.plan.goneAfter[k], r) - c);
    if (k !== this.cK || a !== this.cA || b !== this.cB || g !== this.cG) {
      this.cK = k;
      this.cA = a;
      this.cB = b;
      this.cG = g;
      this.cU = ceilingSpeed(a, b, g, this.view.periodSec);
      this.cT1 = fallTime(a, this.cU, g);
    }
  }

  /** Vertical speed (px/s, downward) the ball lands on the stack with at hit `k`. */
  private impactSpeed(k: number, r: number, g: number, d0: number): number {
    const T = this.view.periodSec;
    if (k <= 0) return d0 / (T / 2) + (g * T) / 4;
    this.bounce(k - 1, r, g);
    return this.cU + g * (T - this.cT1);
  }

  /** The ball's height and vertical speed at simulation time `t` (s), from the plan and the current field. */
  private flight(t: number, r: number, gravity: number): FlightPoint {
    const out = this.point;
    const T = this.view.periodSec;
    const c = this.ceilingY(r);
    const d0 = Math.max(1, this.topY(0, r) - c);
    const g = arcGravity(d0, T, gravity);
    const hits = this.plan.powers.length;
    if (t < T / 2) {
      // The drop from the ceiling onto the full stack, timed to half a period.
      const u = d0 / (T / 2) - (g * T) / 4;
      out.y = c + u * t + 0.5 * g * t * t;
      out.vy = u + g * t;
      return out;
    }
    const k = Math.floor((t - T / 2) / T);
    if (k >= hits - 1) {
      // The last hit cleared the stack: the ball keeps falling and leaves the field within half a period.
      const last = hits - 1;
      const from = this.topY(goneBefore(this.plan, last), r);
      const w = this.impactSpeed(last, r, g, d0);
      const e = Math.max(1, this.exitY(r) - from);
      const acc = Math.max(g, (2 * (e - (w * T) / 2)) / ((T / 2) * (T / 2)));
      const s = t - hitTimeSec(last, T);
      out.y = from + w * s + 0.5 * acc * s * s;
      out.vy = w + acc * s;
      return out;
    }
    this.bounce(k, r, g);
    const sigma = t - hitTimeSec(k, T) - this.cT1;
    const abs = Math.abs(sigma);
    out.y = c + this.cU * abs + 0.5 * g * sigma * sigma;
    out.vy = (sigma < 0 ? -1 : 1) * (this.cU + g * abs);
    return out;
  }

  /** The line the ball's centre crosses when it has fallen out of the field. */
  private exitY(r: number) {
    return this.view.field.bottom + r + 2;
  }

  /** When (s) the ball crosses the exit line after the last hit. */
  private exitTimeSec(r: number, gravity: number): number {
    const T = this.view.periodSec;
    const hits = this.plan.powers.length;
    const last = hits - 1;
    const c = this.ceilingY(r);
    const d0 = Math.max(1, this.topY(0, r) - c);
    const g = arcGravity(d0, T, gravity);
    const from = this.topY(goneBefore(this.plan, last), r);
    const w = this.impactSpeed(last, r, g, d0);
    const e = Math.max(1, this.exitY(r) - from);
    const acc = Math.max(g, (2 * (e - (w * T) / 2)) / ((T / 2) * (T / 2)));
    return hitTimeSec(last, T) + Math.min(T / 2, fallTime(e, w, acc));
  }

  /** Puts the ball where the plan has it at time `t` (the drift gives its x). */
  private place(ctx: ModeContext, ball: Ball, t: number) {
    const f = this.view.field;
    const r = ball.radius;
    const p = this.flight(t, r, this.gravity);
    const room = Math.max(0, f.width - 2 * r);
    ball.x = f.left + r + this.ux * room;
    ball.y = p.y;
    ball.vx = this.vux * f.width;
    ball.vy = p.vy;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.refreshField(ctx.config.width, ctx.config.height);
    this.stepStartSec = this.clockMs / 1000;
    this.clockMs += dtMs;
    this.sub = 0;
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    if (ball.id !== this.ballId || this.view.freed) return;
    // The sideways drift bounces off the sides of the field.
    this.ux += this.vux * dtSec;
    if (this.ux < 0) {
      this.ux = -this.ux;
      this.vux = Math.abs(this.vux);
    } else if (this.ux > 1) {
      this.ux = 2 - this.ux;
      this.vux = -Math.abs(this.vux);
    }
    this.ux = Math.max(0, Math.min(1, this.ux));
    const t = Math.min(this.stepStartSec + (this.sub + 1) * dtSec, this.clockMs / 1000);
    this.place(ctx, ball, t);
  }

  onPostSubStep() {
    this.sub++;
  }

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const from = this.stepStartSec;
    const now = this.clockMs / 1000;
    v.timeSec = now;
    const T = v.periodSec;
    const hits = this.plan.powers.length;
    const ball = this.findBall(ctx);
    const r = ball ? ball.radius : ctx.config.ballRadius || 10;
    // The ceiling contact of the bounce in flight (the bar wobbles and glows where the ball touched it).
    if (ball && !v.freed && now >= T / 2) {
      const k = Math.floor((now - T / 2) / T);
      if (k < hits - 1) {
        const c = this.ceilingY(r);
        const d0 = Math.max(1, this.topY(0, r) - c);
        this.bounce(k, r, arcGravity(d0, T, this.gravity));
        const at = hitTimeSec(k, T) + this.cT1;
        if (at > from && at <= now) {
          const slot = v.ceilingCount % CEILING_CONTACTS;
          v.ceilingSec[slot] = at;
          v.ceilingX[slot] = (ball.x - v.field.left) / Math.max(1, v.field.width);
          v.ceilingCount++;
        }
      }
    }
    // The hits that landed during this step.
    while (this.processed < hits && hitTimeSec(this.processed, T) <= now + 1e-9) this.hit(ctx, this.processed++);
    // Freedom: the ball fell out of the bottom.
    if (!v.freed && this.processed >= hits && now >= this.exitTimeSec(r, this.gravity) - 1e-9) this.free(ctx, ball);
    if (!v.finished && this.clockMs >= 1000 * v.finishSec - 1e-6) v.finished = true;
  }

  /** Hit `k` lands: its layers shatter, the stack top drops, the power advances and the level plays its note. */
  private hit(ctx: ModeContext, k: number) {
    const v = this.view;
    const plan = this.plan;
    const T = v.periodSec;
    const at = hitTimeSec(k, T);
    const before = goneBefore(plan, k);
    const destroyed = plan.destroyed[k];
    const last = k === plan.powers.length - 1;
    v.hits = k + 1;
    v.gone = plan.goneAfter[k];
    v.lastDestroyed = destroyed;
    v.lastHitSec = at;
    v.flashFrom = before;
    v.flashTo = v.gone;
    v.power = last ? plan.finalPower : plan.powers[k + 1];
    v.level = Math.min(plan.powers.length, k + 2);
    if (destroyed >= BIG_HIT_LAYERS) {
      v.bigHits++;
      v.lastBigSec = at;
    }
    this.spawnShatter(before, v.gone, at);
    // --- bounce-math --- a hit on the stack is the ball's bounce
    if (ctx.noteBounce) {
      const ball = this.findBall(ctx);
      if (ball) ctx.noteBounce(ball);
    }
    // The seeded drift kick: never to a standstill while the drift is on.
    const drift = v.settings.drift * DRIFT_MAX;
    if (drift > 0) {
      let vux = 0.75 * this.vux + (2 * ctx.random() - 1) * 0.35 * drift;
      if (Math.abs(vux) < 0.25 * drift) vux = (vux < 0 ? -1 : 1) * 0.25 * drift;
      this.vux = Math.max(-1.4 * drift, Math.min(1.4 * drift, vux));
    }
    ctx.addWallHit(0, ((layerHue(before, plan.layers) / 360) * 2 * Math.PI) % (2 * Math.PI), 0);
    const { scale, rootNote } = v.settings;
    const pitch = levelPitch(k, scale, rootNote);
    if (last) {
      // The stack is gone: a fanfare – the tonic chord and the rising arpeggio of the multipliers.
      const chord = fanfareChord(scale, rootNote);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true });
      ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: Math.max(4, Math.min(64, plan.powers[k])) });
      return;
    }
    if (destroyed >= BIG_HIT_LAYERS) {
      // A big one: the level's chord and a whoosh (the wall-break sound, which also shakes the camera).
      const chord = levelChord(k, scale, rootNote);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true });
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
      return;
    }
    const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: pitch };
    if (destroyed === 0) event.level = 0.5;
    ctx.addPendingSoundEvent(event);
  }

  /** The ball crossed the bottom: the burst, confetti and the whoosh; the ball leaves the run. */
  private free(ctx: ModeContext, ball: Ball | null) {
    const v = this.view;
    const f = v.field;
    v.freed = true;
    const r = ball ? ball.radius : ctx.config.ballRadius || 10;
    v.freedSec = this.exitTimeSec(r, this.gravity);
    v.freedX = ball ? (ball.x - f.left) / Math.max(1, f.width) : this.ux;
    const x = f.left + v.freedX * f.width;
    ctx.spawnConfetti(x, f.bottom - 0.02 * f.height);
    ctx.spawnConfetti(x, f.bottom - 0.08 * f.height);
    this.spawnBurst(v.freedX, v.freedSec);
    ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    if (ball) ctx.setBalls(ctx.getBalls().filter((b) => b !== ball));
  }

  private nextParticleSlot(): number {
    const v = this.view;
    const slot = v.partNext;
    v.partNext = (v.partNext + 1) % MAX_PL_PARTICLES;
    v.partSpawned++;
    return slot;
  }

  /** The destroyed band (layers `from`…`to`) shatters: particles in the colours of its layers burst up and fall. */
  private spawnShatter(from: number, to: number, at: number) {
    const v = this.view;
    const d = to - from;
    if (d <= 0) return;
    const L = this.plan.layers;
    const y0 = STACK_TOP_AT + (from / L) * (STACK_BOTTOM_AT - STACK_TOP_AT);
    const y1 = STACK_TOP_AT + (to / L) * (STACK_BOTTOM_AT - STACK_TOP_AT);
    const n = Math.min(MAX_PARTICLES_PER_HIT, 6 + 3 * d);
    const rnd = this.fx;
    for (let i = 0; i < n; i++) {
      const s = this.nextParticleSlot();
      const u = rnd();
      v.partX[s] = rnd();
      v.partY[s] = y0 + u * (y1 - y0);
      v.partVx[s] = (rnd() - 0.5) * 0.9;
      v.partVy[s] = -(0.15 + 0.75 * rnd()) * (0.6 + 0.4 * Math.min(1, d / 20));
      v.partT0[s] = at;
      v.partLife[s] = 0.6 + 0.8 * rnd();
      v.partHue[s] = layerHue(from + Math.min(d - 1, Math.floor(u * d)), L);
      v.partSize[s] = 0.004 + 0.006 * rnd();
    }
  }

  /** The freedom burst from where the ball left the field: every colour of the stack. */
  private spawnBurst(x: number, at: number) {
    const v = this.view;
    const rnd = this.fx;
    for (let i = 0; i < FREEDOM_PARTICLES; i++) {
      const s = this.nextParticleSlot();
      v.partX[s] = Math.max(0, Math.min(1, x + (rnd() - 0.5) * 0.15));
      v.partY[s] = 0.985;
      v.partVx[s] = (rnd() - 0.5) * 1.6;
      v.partVy[s] = -(0.4 + 0.9 * rnd());
      v.partT0[s] = at;
      v.partLife[s] = 0.9 + 0.9 * rnd();
      v.partHue[s] = rnd() * 360;
      v.partSize[s] = 0.005 + 0.007 * rnd();
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A resize keeps the run: the field follows the canvas and the ball is put where the plan has it now. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    this.refreshField(ctx.config.width, ctx.config.height);
    const ball = this.findBall(ctx);
    if (ball && !this.view.freed) {
      this.place(ctx, ball, this.clockMs / 1000);
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
    return true;
  }
  /** There are no rings: the ceiling and the stack are the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { hits: v.hits, totalHits: v.totalHits, gone: v.gone, layers: v.layers, power: v.power, level: v.level, freed: v.freed, finished: v.finished };
  }
}
