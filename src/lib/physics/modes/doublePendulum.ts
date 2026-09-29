import { SCALE_INTERVALS, isScaleId, midiToFrequency, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";
import { PendulumChain, collideBobs, createContactScratch, type ContactScratch, type Vec2 } from "../pendulumChain";

/**
 * Double Pendulum ("doublePendulum" mode, the project.jdm "Double Pendulum HARP" and "2 Pendulums SPAR with Each
 * Other" formats): no rings. One to four double pendulums – or triple pendulums – swing from a pivot in the middle of
 * the centred square the recorder crops to, integrated with a fixed-step RK4 scheme (pendulumChain.ts; 8–96 sub-steps
 * per 60 Hz step, chosen from the fastest rod so a rod never turns more than `MAX_ANGLE_PER_SUBSTEP` per sub-step).
 * Several pendulums share the pivot and start a hair apart (`BUTTERFLY_OFFSET_DEG` on the last rod), so they swing as
 * one and then fly apart – the butterfly effect.
 *
 * HARP: 0–24 strings are drawn across the playfield – vertical, or radial spokes around the centre – and tuned to the
 * scale chosen in the Sound section (a diatonic major scale while it is chromatic, like a lever harp) across 1–4
 * octaves. Every bob that crosses a string plucks it: the crossing is solved on every sub-step (`crossedIndices()`),
 * the string vibrates (the renderer draws a decaying sine displacement) and plays its note as a "hit" sound event –
 * the plucks of one step together as one chord – so the ToneGenerator applies the instrument, the scale snap, the
 * beat lock, hit samples, a loaded melody and the music-bed ducking like it does to every other hit.
 *
 * SPARRING: two pendulums hang from pivots side by side, starting as mirror images, and their bobs collide elastically:
 * an overlapping, approaching pair exchanges an impulse along the line between the centres, applied to each chain's
 * angular velocities through its bob (`collideBobs()`: Δθ̇ = M⁻¹ Jᵀ P, which conserves the kinetic energy). Every hit
 * plays a low, percussive note (accented when it is hard) and flashes.
 *
 * The run finishes after the clip length (the Duration of the Recording section) or never; its last `FINALE_SEC` are the
 * finale – the rig holds still under the "TIME!" banner while the closing chord rings, so a recording of exactly the clip
 * ends on it. Everything random – a seeded start – comes from `ctx.random()`, so a run is deterministic for its seed and
 * settings.
 */

export const DP_STRING_LAYOUTS = ["vertical", "radial"] as const;
export type DpStringLayout = (typeof DP_STRING_LAYOUTS)[number];

export function isDpStringLayout(value: unknown): value is DpStringLayout {
  return typeof value === "string" && (DP_STRING_LAYOUTS as readonly string[]).includes(value);
}

export interface DoublePendulumSettings {
  /** Pendulums sharing the pivot, 1–4 (sparring always uses two). */
  count: number;
  /** Rods per pendulum: 2 (double) or 3 (triple). */
  segments: number;
  /** Relative rod lengths, 0.2–1 (the chain is scaled so its full reach fills the playfield). */
  length1: number;
  length2: number;
  length3: number;
  /** Bob masses, 0.2–5 (a heavier bob is drawn a little bigger). */
  mass1: number;
  mass2: number;
  mass3: number;
  /** Gravity as a multiple of 9.81 m/s² on a 1 m rig, 0.2–3. */
  gravity: number;
  /** Start angles of the rods in degrees from hanging straight down, −180…180 (ignored with `randomStart`). */
  angle1: number;
  angle2: number;
  angle3: number;
  /** Start from angles drawn from the seed instead of the three angles. */
  randomStart: boolean;
  /** Fraction of the angular velocity lost per 60 Hz step, 0–0.01 (0 = no friction at all). */
  damping: number;
  /** Seconds of simulation time the rainbow trail of the last bob reaches back, 0–10 (0 = no trail). */
  trailSeconds: number;
  /** Harp strings, 0–24 (0 = none). */
  strings: number;
  stringLayout: DpStringLayout;
  /** Octaves the strings are tuned across, 1–4. */
  octaves: number;
  /** Two pendulums side by side whose bobs collide. */
  spar: boolean;
  /** Keep swinging after the clip length. */
  endless: boolean;
  /** The clip length (the Recording section's Video Duration): the run finishes there unless it is endless. */
  clipSeconds: number;
  /** The scale and root of the Sound section: the strings are tuned to them. */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_DOUBLE_PENDULUM_SETTINGS: DoublePendulumSettings = {
  count: 1,
  segments: 2,
  length1: 1,
  length2: 1,
  length3: 1,
  mass1: 1,
  mass2: 1,
  mass3: 1,
  gravity: 1,
  angle1: 120,
  angle2: -30,
  angle3: 60,
  randomStart: true,
  damping: 0,
  trailSeconds: 4,
  strings: 15,
  stringLayout: "vertical",
  octaves: 2,
  spar: false,
  endless: false,
  clipSeconds: 30,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const DOUBLE_PENDULUM_RANGES = {
  dpCount: { min: 1, max: 4, step: 1 },
  dpSegments: { min: 2, max: 3, step: 1 },
  dpLength1: { min: 0.2, max: 1, step: 0.05 },
  dpLength2: { min: 0.2, max: 1, step: 0.05 },
  dpLength3: { min: 0.2, max: 1, step: 0.05 },
  dpMass1: { min: 0.2, max: 5, step: 0.1 },
  dpMass2: { min: 0.2, max: 5, step: 0.1 },
  dpMass3: { min: 0.2, max: 5, step: 0.1 },
  dpGravity: { min: 0.2, max: 3, step: 0.05 },
  dpAngle1: { min: -180, max: 180, step: 1 },
  dpAngle2: { min: -180, max: 180, step: 1 },
  dpAngle3: { min: -180, max: 180, step: 1 },
  dpDamping: { min: 0, max: 0.01, step: 0.0005 },
  dpTrailSeconds: { min: 0, max: 10, step: 0.5 },
  dpStrings: { min: 0, max: 24, step: 1 },
  dpOctaves: { min: 1, max: 4, step: 1 },
} as const;

/** The clip lengths the run can be told to finish at (seconds). */
const CLIP_RANGE = { min: 1, max: 600 };

/** The Double Pendulum fields of the SimulatorSettings object (URL keys in `DP_URL_KEYS`). */
export interface DoublePendulumSettingFields {
  dpCount: number;
  dpSegments: number;
  dpLength1: number;
  dpLength2: number;
  dpLength3: number;
  dpMass1: number;
  dpMass2: number;
  dpMass3: number;
  dpGravity: number;
  dpAngle1: number;
  dpAngle2: number;
  dpAngle3: number;
  dpRandomStart: boolean;
  dpDamping: number;
  dpTrailSeconds: number;
  dpStrings: number;
  dpStringLayout: DpStringLayout;
  dpOctaves: number;
  dpSpar: boolean;
  dpEndless: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value to its range (counts and angles become whole numbers, segments 2 or 3; unknown layouts, scales and non-boolean flags fall back to the defaults). */
export function resolveDoublePendulumSettings(config: Partial<DoublePendulumSettings> | null | undefined): DoublePendulumSettings {
  const out = { ...DEFAULT_DOUBLE_PENDULUM_SETTINGS };
  if (!config) return out;
  const R = DOUBLE_PENDULUM_RANGES;
  if (config.count !== undefined) out.count = Math.round(clampNumber(config.count, R.dpCount, out.count));
  if (config.segments !== undefined) out.segments = Math.round(clampNumber(config.segments, R.dpSegments, out.segments));
  if (config.length1 !== undefined) out.length1 = clampNumber(config.length1, R.dpLength1, out.length1);
  if (config.length2 !== undefined) out.length2 = clampNumber(config.length2, R.dpLength2, out.length2);
  if (config.length3 !== undefined) out.length3 = clampNumber(config.length3, R.dpLength3, out.length3);
  if (config.mass1 !== undefined) out.mass1 = clampNumber(config.mass1, R.dpMass1, out.mass1);
  if (config.mass2 !== undefined) out.mass2 = clampNumber(config.mass2, R.dpMass2, out.mass2);
  if (config.mass3 !== undefined) out.mass3 = clampNumber(config.mass3, R.dpMass3, out.mass3);
  if (config.gravity !== undefined) out.gravity = clampNumber(config.gravity, R.dpGravity, out.gravity);
  if (config.angle1 !== undefined) out.angle1 = Math.round(clampNumber(config.angle1, R.dpAngle1, out.angle1));
  if (config.angle2 !== undefined) out.angle2 = Math.round(clampNumber(config.angle2, R.dpAngle2, out.angle2));
  if (config.angle3 !== undefined) out.angle3 = Math.round(clampNumber(config.angle3, R.dpAngle3, out.angle3));
  if (typeof config.randomStart === "boolean") out.randomStart = config.randomStart;
  if (config.damping !== undefined) out.damping = clampNumber(config.damping, R.dpDamping, out.damping);
  if (config.trailSeconds !== undefined) out.trailSeconds = clampNumber(config.trailSeconds, R.dpTrailSeconds, out.trailSeconds);
  if (config.strings !== undefined) out.strings = Math.round(clampNumber(config.strings, R.dpStrings, out.strings));
  if (isDpStringLayout(config.stringLayout)) out.stringLayout = config.stringLayout;
  if (config.octaves !== undefined) out.octaves = Math.round(clampNumber(config.octaves, R.dpOctaves, out.octaves));
  if (typeof config.spar === "boolean") out.spar = config.spar;
  if (typeof config.endless === "boolean") out.endless = config.endless;
  if (config.clipSeconds !== undefined) out.clipSeconds = clampNumber(config.clipSeconds, CLIP_RANGE, out.clipSeconds);
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** What the settings object may carry besides the Double Pendulum fields: the clip length and the tuning of the Sound section. */
export interface DoublePendulumContext {
  recordingDuration?: number;
  scale?: ScaleId;
  rootNote?: number;
}

/** Picks the Double Pendulum settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setDoublePendulumSettings()`. */
export function doublePendulumSettingsOf(source: DoublePendulumSettingFields & DoublePendulumContext): DoublePendulumSettings {
  return {
    count: source.dpCount,
    segments: source.dpSegments,
    length1: source.dpLength1,
    length2: source.dpLength2,
    length3: source.dpLength3,
    mass1: source.dpMass1,
    mass2: source.dpMass2,
    mass3: source.dpMass3,
    gravity: source.dpGravity,
    angle1: source.dpAngle1,
    angle2: source.dpAngle2,
    angle3: source.dpAngle3,
    randomStart: source.dpRandomStart,
    damping: source.dpDamping,
    trailSeconds: source.dpTrailSeconds,
    strings: source.dpStrings,
    stringLayout: source.dpStringLayout,
    octaves: source.dpOctaves,
    spar: source.dpSpar,
    endless: source.dpEndless,
    clipSeconds: source.recordingDuration ?? DEFAULT_DOUBLE_PENDULUM_SETTINGS.clipSeconds,
    scale: source.scale ?? DEFAULT_DOUBLE_PENDULUM_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_DOUBLE_PENDULUM_SETTINGS.rootNote,
  };
}

/** Writes resolved Double Pendulum settings back into the SimulatorSettings field names (the clip length and tuning stay where they live). */
export function doublePendulumSettingFields(settings: DoublePendulumSettings): DoublePendulumSettingFields {
  return {
    dpCount: settings.count,
    dpSegments: settings.segments,
    dpLength1: settings.length1,
    dpLength2: settings.length2,
    dpLength3: settings.length3,
    dpMass1: settings.mass1,
    dpMass2: settings.mass2,
    dpMass3: settings.mass3,
    dpGravity: settings.gravity,
    dpAngle1: settings.angle1,
    dpAngle2: settings.angle2,
    dpAngle3: settings.angle3,
    dpRandomStart: settings.randomStart,
    dpDamping: settings.damping,
    dpTrailSeconds: settings.trailSeconds,
    dpStrings: settings.strings,
    dpStringLayout: settings.stringLayout,
    dpOctaves: settings.octaves,
    dpSpar: settings.spar,
    dpEndless: settings.endless,
  };
}

/** The Double Pendulum fields of a settings object, clamped to their ranges (URL parameters and presets alike). */
export function resolveDoublePendulumFields(source: DoublePendulumSettingFields): DoublePendulumSettingFields {
  return doublePendulumSettingFields(resolveDoublePendulumSettings(doublePendulumSettingsOf(source)));
}

/* ------------------------------------------------------------------ URL */

/** Short URL keys of the numeric and boolean fields (the string layout travels as `dpsl`). */
export const DP_URL_KEYS = {
  dpn: "dpCount",
  dpsg: "dpSegments",
  dpl1: "dpLength1",
  dpl2: "dpLength2",
  dpl3: "dpLength3",
  dpm1: "dpMass1",
  dpm2: "dpMass2",
  dpm3: "dpMass3",
  dpg: "dpGravity",
  dpa1: "dpAngle1",
  dpa2: "dpAngle2",
  dpa3: "dpAngle3",
  dprs: "dpRandomStart",
  dpd: "dpDamping",
  dptr: "dpTrailSeconds",
  dpst: "dpStrings",
  dpo: "dpOctaves",
  dpsp: "dpSpar",
  dpen: "dpEndless",
} as const satisfies Record<string, keyof DoublePendulumSettingFields>;

/** Up to four decimals (the damping steps by 0.0005), trailing zeros dropped, so slider values survive the URL. */
function formatDpNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Writes the Double Pendulum fields that differ from `base` (the defaults of the mode) into `params`. */
export function writeDoublePendulumParams(settings: DoublePendulumSettingFields, base: DoublePendulumSettingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(DP_URL_KEYS) as [string, keyof DoublePendulumSettingFields][]) {
    const value = settings[field];
    if (value === base[field]) continue;
    if (typeof value === "boolean") params.set(key, value ? "1" : "0");
    else if (typeof value === "number") params.set(key, formatDpNumber(value));
  }
  if (settings.dpStringLayout !== base.dpStringLayout) params.set("dpsl", settings.dpStringLayout);
}

/** Reads the Double Pendulum parameters of a URL into `settings` and clamps them (bad values fall back to the defaults). */
export function readDoublePendulumParams(params: URLSearchParams, settings: DoublePendulumSettingFields) {
  const target = settings as unknown as Record<string, number | boolean | string>;
  for (const [key, field] of Object.entries(DP_URL_KEYS) as [string, keyof DoublePendulumSettingFields][]) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (typeof settings[field] === "boolean") {
      if (raw === "1") target[field] = true;
      else if (raw === "0") target[field] = false;
    } else {
      const value = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(value)) target[field] = value;
    }
  }
  const layout = params.get("dpsl");
  if (isDpStringLayout(layout)) settings.dpStringLayout = layout;
  Object.assign(settings, resolveDoublePendulumFields(settings));
}

/* ------------------------------------------------------------------ physics constants */

/** Gravity of the model (units / s²) at the setting 1: the chain is 1 unit long, so it swings like a 1 m pendulum on Earth. */
export const DP_GRAVITY = 9.81;
/** Sub-steps per 60 Hz step: at least this many… */
export const MIN_SUBSTEPS = 8;
/** …and at most this many; in between, enough that no rod turns more than `MAX_ANGLE_PER_SUBSTEP` radians per sub-step. */
export const MAX_SUBSTEPS = 96;
export const MAX_ANGLE_PER_SUBSTEP = 0.015;
/** Each further pendulum sharing the pivot starts this much further on its last rod (degrees): together at first, then apart. */
export const BUTTERFLY_OFFSET_DEG = 0.05;
/** Sparring: the pivots are this far apart (model units; one chain is 1 long). */
export const SPAR_PIVOT_DISTANCE = 1;
/** A string plucked again within this many seconds does not sound again. */
export const PLUCK_COOLDOWN_SEC = 0.05;
/** A bob crossing a string at this speed (units / s) or faster plucks at full strength. */
export const PLUCK_FULL_SPEED = 4;
/** Sparring hits approaching slower than this (units / s) are silent contacts. */
export const HIT_SOUND_SPEED = 0.3;
/** Sparring hits approaching at this speed or faster are full strength (and accented from `HIT_ACCENT_STRENGTH`). */
export const HIT_FULL_SPEED = 3;
export const HIT_ACCENT_STRENGTH = 0.6;
/** Most distinct notes one step's plucks play as a chord. */
export const MAX_PLUCK_NOTES = 8;
/** Most sparring hits one step sounds. */
export const MAX_HIT_SOUNDS_PER_STEP = 2;
/** Recent sparring hits kept for the flashes. */
export const HIT_POOL = 8;
/** Trail samples kept per pendulum (a ring buffer of x, y, t): enough for the longest trail at a normal pace. */
export const TRAIL_CAPACITY = 6000;
/** A trail sample is taken once the last bob has moved this many pixels since the previous one. */
export const TRAIL_MIN_PX = 1.5;
/** The bob radius the configured ball size gives, as a fraction of the playfield side (the default 8 px ball is a fortieth). */
export const BOB_UNIT = 1 / 320;
/** The finale: the last seconds of the clip (at most a fifth of it), during which the rig holds still with the closing chord. */
export const FINALE_SEC = 1.5;

/** Simulation time at which the finale of a clip of `clipSeconds` starts (the rig stops; the run finishes at the clip length). */
export function finaleStartSec(clipSeconds: number): number {
  return clipSeconds - Math.min(FINALE_SEC, 0.2 * clipSeconds);
}

/** How much bigger a bob of mass m is drawn (and collides): the cube root, within 0.7×–1.6×. */
export function bobSizeFactor(mass: number): number {
  return Math.max(0.7, Math.min(1.6, Math.cbrt(Math.max(0, mass))));
}

/** The largest size factor of the bobs of a chain with these masses. */
export function maxBobSizeFactor(masses: readonly number[]): number {
  let f = 0.7;
  for (const m of masses) f = Math.max(f, bobSizeFactor(m));
  return f;
}

/**
 * Radius (model units) of a bob of `mass` for the configured ball radius (px of the default layout: a fortieth of the
 * side for the 8 px ball) on a rig of reach `spanHalf` whose biggest bob has the size factor `maxFactor` – the same
 * whatever the canvas size, because the field scale (`buildDpField()`) and the bob grow with the side alike.
 */
export function bobModelRadius(ballRadius: number, mass: number, maxFactor: number, spanHalf: number): number {
  const unit = BOB_UNIT * ballRadius;
  return (unit * bobSizeFactor(mass) * spanHalf) / Math.max(0.1, 0.47 - unit * maxFactor);
}

/** Damping rate k (1/s) of a per-step velocity loss `d`: the angular velocities keep (1 − d) per 60 Hz step. */
export function dampingRate(d: number, stepsPerSecond = 60): number {
  return d > 0 ? -Math.log(1 - Math.min(0.5, d)) * stepsPerSecond : 0;
}

/** Relative rod lengths of the settings, scaled so the chain is 1 unit long. */
export function chainLengths(settings: Pick<DoublePendulumSettings, "segments" | "length1" | "length2" | "length3">): number[] {
  const raw = [settings.length1, settings.length2, settings.length3].slice(0, settings.segments);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((l) => l / sum);
}

export function chainMasses(settings: Pick<DoublePendulumSettings, "segments" | "mass1" | "mass2" | "mass3">): number[] {
  return [settings.mass1, settings.mass2, settings.mass3].slice(0, settings.segments);
}

/** Sub-steps for a step of `stepSec` when the fastest rod turns at `maxRate` rad/s. */
export function subStepsFor(maxRate: number, stepSec: number): number {
  const n = Math.ceil((maxRate * stepSec) / MAX_ANGLE_PER_SUBSTEP);
  return Math.max(MIN_SUBSTEPS, Math.min(MAX_SUBSTEPS, Number.isFinite(n) ? n : MAX_SUBSTEPS));
}

/* ------------------------------------------------------------------ harp tuning */

/** MIDI note of the lowest string: C4 for one or two octaves, C3 for three or four, moved up to the root of the scale. */
export function harpBaseMidi(octaves: number, rootNote: number): number {
  return 60 - 12 * Math.floor((Math.max(1, octaves) - 1) / 2) + normalizeRootNote(rootNote);
}

/** The notes (MIDI) of the scale from the base across `octaves` octaves, both ends included; the chromatic "scale" (no snapping) tunes a diatonic major scale, like a lever harp. */
export function harpLadder(octaves: number, scale: ScaleId, rootNote: number): number[] {
  const intervals = scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[scale];
  const base = harpBaseMidi(octaves, rootNote);
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) for (const step of intervals) out.push(base + 12 * o + step);
  out.push(base + 12 * octaves);
  return out;
}

/** MIDI note of every string, low to high: the ladder sampled evenly, so the first string is the root and the last one the root `octaves` octaves up. */
export function harpStringMidi(strings: number, octaves: number, scale: ScaleId, rootNote: number): number[] {
  if (strings <= 0) return [];
  const ladder = harpLadder(octaves, scale, rootNote);
  if (strings === 1) return [ladder[0]];
  const out: number[] = [];
  for (let k = 0; k < strings; k++) out.push(ladder[Math.round((k * (ladder.length - 1)) / (strings - 1))]);
  return out;
}

/** Pitch (Hz) of a sparring hit: the root an octave under the harp for a hard hit, the fifth under the root for a light one. */
export function sparHitPitch(strength: number, octaves: number, rootNote: number): number {
  const base = harpBaseMidi(octaves, rootNote);
  return midiToFrequency(strength >= HIT_ACCENT_STRENGTH ? base - 12 : base - 5);
}

/** Loudness (0.35–1) of a pluck at `speed` units / s. */
export function pluckLevel(speed: number): number {
  return Math.max(0.35, Math.min(1, 0.35 + (0.65 * speed) / PLUCK_FULL_SPEED));
}

/* ------------------------------------------------------------------ string crossings */

/**
 * The whole numbers a point moving from `u0` to `u1` crosses, in the order it crosses them, appended to `out`: moving up
 * every k with u0 < k ≤ u1, moving down every k with u1 ≤ k < u0. Landing exactly on k counts once – leaving it again
 * does not – so a bob is never counted twice for one crossing, whatever the sub-step boundaries. Returns how many.
 */
export function crossedIndices(u0: number, u1: number, out: number[]): number {
  let n = 0;
  if (u1 > u0) {
    for (let k = Math.floor(u0) + 1; k <= u1; k++) {
      out.push(k);
      n++;
    }
  } else if (u1 < u0) {
    for (let k = Math.ceil(u0) - 1; k >= u1; k--) {
      out.push(k);
      n++;
    }
  }
  return n;
}

/** Wraps an angle difference into (−π, π]. */
export function wrapDelta(d: number): number {
  let a = d % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a <= -Math.PI) a += TWO_PI;
  return a;
}

/** Where the strings are, in model units around the field centre (one chain is 1 long). */
export interface HarpGeometry {
  layout: DpStringLayout;
  count: number;
  /** Vertical: x of the first string and the spacing; the strings run from `-halfHeight` to `halfHeight`. */
  first: number;
  spacing: number;
  halfHeight: number;
  /** Radial: angle of the first spoke (radians, screen coordinates) and the angle between spokes; spokes run from `hub` to `outer`. */
  firstAngle: number;
  angleStep: number;
  hub: number;
  outer: number;
}

/** Lays `count` strings out over the reach `spanHalf` (half the width the bobs can reach) and a field of `halfHeight` (half its side, model units). */
export function buildHarpGeometry(layout: DpStringLayout, count: number, spanHalf: number, halfHeight: number): HarpGeometry {
  const n = Math.max(0, count);
  const spacing = n > 0 ? (2 * spanHalf) / n : 0;
  return {
    layout,
    count: n,
    first: -spanHalf + 0.5 * spacing,
    spacing,
    halfHeight,
    firstAngle: n > 0 ? -Math.PI / 2 + Math.PI / n : 0,
    angleStep: n > 0 ? TWO_PI / n : 0,
    hub: 0.12 * spanHalf,
    outer: spanHalf,
  };
}

/**
 * Appends to `out` the strings a bob moving from (x0, y0) to (x1, y1) (model units around the field centre) crosses,
 * in crossing order. Vertical strings are crossed where the bob's x passes theirs; a radial spoke where the bob's
 * angle around the centre passes it while the bob is out of the hub (both ends at least `hub` from the centre, so
 * the angle is well defined over the move). Returns how many.
 */
export function harpCrossings(g: HarpGeometry, x0: number, y0: number, x1: number, y1: number, out: number[]): number {
  if (g.count <= 0) return 0;
  const start = out.length;
  if (g.layout === "vertical") {
    const u0 = (x0 - g.first) / g.spacing;
    const u1 = (x1 - g.first) / g.spacing;
    crossedIndices(u0, u1, out);
    // Only the real strings (the bob may move past the ends of the harp).
    let w = start;
    for (let i = start; i < out.length; i++) if (out[i] >= 0 && out[i] < g.count) out[w++] = out[i];
    out.length = w;
    return w - start;
  }
  const r0 = Math.hypot(x0, y0);
  const r1 = Math.hypot(x1, y1);
  if (r0 < g.hub || r1 < g.hub) return 0;
  const a0 = Math.atan2(y0, x0);
  const u0 = (a0 - g.firstAngle) / g.angleStep;
  const u1 = u0 + wrapDelta(Math.atan2(y1, x1) - a0) / g.angleStep;
  crossedIndices(u0, u1, out);
  for (let i = start; i < out.length; i++) out[i] = ((out[i] % g.count) + g.count) % g.count;
  return out.length - start;
}

/* ------------------------------------------------------------------ layout */

/** The centred square the recorder crops to (px) and the scale of the model in it. */
export interface DpField {
  left: number;
  top: number;
  right: number;
  bottom: number;
  side: number;
  cx: number;
  cy: number;
  /** Pixels per model unit (one chain is 1 unit long). */
  scale: number;
}

/**
 * Lays the field out for a canvas, the horizontal reach of the rig (`spanHalf`, model units: 1 around one pivot, 1.5
 * for two sparring pivots) and the largest bob (as a fraction of the side): the reach plus that bob fits inside the
 * square with a small margin. Every length is proportional to the side, so the model (and its collisions) is the same
 * whatever the canvas size.
 */
export function buildDpField(width: number, height: number, spanHalf: number, maxBobFraction: number): DpField {
  const side = Math.max(40, 0.96 * Math.min(width, height));
  const cx = width / 2;
  const cy = height / 2;
  const scale = (side * Math.max(0.1, 0.47 - maxBobFraction)) / spanHalf;
  return { left: cx - side / 2, top: cy - side / 2, right: cx + side / 2, bottom: cy + side / 2, side, cx, cy, scale };
}

/* ------------------------------------------------------------------ the mode */

/** One pendulum of the rig: its chain, its pivot, the bobs and the trail of its last bob. */
export interface DpPendulum {
  chain: PendulumChain;
  /** Pivot, model units around the field centre. */
  pivotX: number;
  pivotY: number;
  /** Base hue of the pendulum's rainbow (degrees). */
  hue: number;
  /** Bob positions, model units around the field centre (updated every sub-step). */
  bobX: Float64Array;
  bobY: Float64Array;
  /** Bob radii (model units) and the simulation time of each bob's last pluck (−Infinity before the first). */
  radius: Float64Array;
  pluckTime: Float64Array;
  /** Trail of the last bob: a ring buffer of positions (model units) and simulation times, `trailCount` samples ending at `trailHead − 1`. */
  trailX: Float64Array;
  trailY: Float64Array;
  trailT: Float64Array;
  trailHead: number;
  trailCount: number;
}

export interface DpString {
  /** MIDI note and pitch (Hz) of the string. */
  midi: number;
  pitch: number;
  /** Rainbow hue by pitch rank (degrees). */
  hue: number;
  /** Simulation time of the last pluck (−Infinity before the first) and its strength (0–1). */
  pluckTime: number;
  amp: number;
  plucks: number;
}

export interface DpHit {
  /** Contact point, model units around the field centre. */
  x: number;
  y: number;
  /** Simulation time of the hit (−Infinity for an empty slot) and its strength (0–1). */
  time: number;
  strength: number;
}

/** What the canvas needs: the field, the pendulums, the strings, the recent hits, the clock and the counters. */
export interface DoublePendulumView {
  /** The settings of the running rig (applied by `init()`; the trails, strings, tuning and the end follow a change live). */
  settings: DoublePendulumSettings;
  field: DpField | null;
  harp: HarpGeometry;
  /** Half the width the bobs can reach (model units): 1 around one pivot, 1.5 with two sparring pivots. */
  spanHalf: number;
  count: number;
  segments: number;
  pendulums: DpPendulum[];
  strings: DpString[];
  hits: DpHit[];
  /** Simulation time (seconds) and steps of the run; the clock stops when the run finishes. */
  timeSec: number;
  step: number;
  /** Sub-steps of the last step. */
  subSteps: number;
  plucks: number;
  hitCount: number;
  lastHitTime: number;
  lastHitStrength: number;
  /** Total energy at the start and now, and its natural scale (Σ m · g · 1): the drift of a run without friction is (energy − energy0) / energyScale. */
  energy0: number;
  energy: number;
  energyScale: number;
  /** The finale is on: the rig holds still (the clock runs on to the end of the clip, strings ring down, the trail fades). */
  finale: boolean;
  finished: boolean;
  /** Incremented by every init (a new run). */
  generation: number;
}

const SCRATCH_POS: Vec2 = { x: 0, y: 0 };

/** Colour of a pendulum's bobs for a hue. */
export function dpBobColor(hue: number): string {
  return `hsl(${Math.round(((hue % 360) + 360) % 360)}, 90%, 62%)`;
}

export class DoublePendulumMode implements GameMode {
  readonly name = "doublePendulum";
  /** The bobs are placed by the integrator: no slow-ball boost and no engine pair collisions (sparring resolves its own). */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: DoublePendulumSettings = { ...DEFAULT_DOUBLE_PENDULUM_SETTINGS };
  private readonly view: DoublePendulumView = {
    settings: { ...DEFAULT_DOUBLE_PENDULUM_SETTINGS },
    field: null,
    harp: buildHarpGeometry("vertical", 0, 1, 1),
    spanHalf: 1,
    count: 0,
    segments: 2,
    pendulums: [],
    strings: [],
    hits: [],
    timeSec: 0,
    step: 0,
    subSteps: 0,
    plucks: 0,
    hitCount: 0,
    lastHitTime: -Infinity,
    lastHitStrength: 0,
    energy0: 0,
    energy: 0,
    energyScale: 1,
    finale: false,
    finished: false,
    generation: 0,
  };
  private firstId = 0;
  private ballRadius = 8;
  private width = 800;
  private height = 600;
  private hitNext = 0;
  private readonly contact: ContactScratch = createContactScratch();
  /** Scratch of the step: crossed strings, the strings plucked this step and their loudest pluck, the sparring hits. */
  private readonly crossings: number[] = [];
  private readonly stepPitches: number[] = [];
  private stepLevel = 0;
  private readonly stepHits: number[] = [];
  private prevX = new Float64Array(0);
  private prevY = new Float64Array(0);

  constructor() {
    for (let i = 0; i < HIT_POOL; i++) this.view.hits.push({ x: 0, y: 0, time: -Infinity, strength: 0 });
  }

  getSettings(): DoublePendulumSettings {
    return this.settings;
  }

  /**
   * The rig (count, rods, lengths, masses, gravity, start, damping, sparring) is applied by the next init – the
   * Simulator re-inits the mode when one of them changes. The trail length, the strings (count, layout, octaves,
   * tuning), the end (endless, clip length) apply at once: they change what is drawn and heard, not the swing.
   */
  setSettings(patch: Partial<DoublePendulumSettings>) {
    this.settings = resolveDoublePendulumSettings({ ...this.settings, ...patch });
    const s = this.settings;
    const live = this.view.settings;
    const harpChanged = live.strings !== s.strings || live.stringLayout !== s.stringLayout || live.octaves !== s.octaves || live.scale !== s.scale || live.rootNote !== s.rootNote;
    this.view.settings = { ...live, trailSeconds: s.trailSeconds, strings: s.strings, stringLayout: s.stringLayout, octaves: s.octaves, scale: s.scale, rootNote: s.rootNote, endless: s.endless, clipSeconds: s.clipSeconds };
    if (harpChanged) this.buildStrings();
  }

  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): DoublePendulumView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return { plucks: v.plucks, hits: v.hitCount, timeSec: v.timeSec, clipSeconds: v.settings.clipSeconds, endless: v.settings.endless, count: v.count, segments: v.segments, strings: v.strings.length, spar: v.settings.spar, finale: v.finale, finished: v.finished };
  }

  /** |E − E₀| relative to the energy scale: the integrator's drift in a run without friction (and elastic hits). */
  energyDrift(): number {
    const v = this.view;
    return Math.abs(v.energy - v.energy0) / v.energyScale;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    const spar = s.spar;
    const count = spar ? 2 : s.count;
    const segments = s.segments;
    v.count = count;
    v.segments = segments;
    v.spanHalf = spar ? SPAR_PIVOT_DISTANCE / 2 + 1 : 1;
    v.timeSec = 0;
    v.step = 0;
    v.subSteps = 0;
    v.plucks = 0;
    v.hitCount = 0;
    v.lastHitTime = -Infinity;
    v.lastHitStrength = 0;
    v.finale = false;
    v.finished = false;
    v.generation++;
    for (const hit of v.hits) hit.time = -Infinity;
    this.hitNext = 0;
    this.width = ctx.config.width;
    this.height = ctx.config.height;
    this.ballRadius = ctx.config.ballRadius || 8;
    const lengths = chainLengths(s);
    const masses = chainMasses(s);
    const params = { links: segments, lengths, masses, gravity: DP_GRAVITY * s.gravity, damping: dampingRate(s.damping) };
    const start = this.startAngles(ctx, lengths, spar);
    v.pendulums = [];
    for (let p = 0; p < count; p++) {
      const chain = new PendulumChain(params);
      const angles = start.slice();
      if (spar && p === 1) for (let i = 0; i < segments; i++) angles[i] = -angles[i];
      // Every further pendulum a hair further on its last rod: together at first (mirrored, when sparring), then apart.
      angles[segments - 1] += (p * BUTTERFLY_OFFSET_DEG * Math.PI) / 180;
      chain.setState(angles);
      v.pendulums.push({
        chain,
        pivotX: spar ? (p === 0 ? -SPAR_PIVOT_DISTANCE / 2 : SPAR_PIVOT_DISTANCE / 2) : 0,
        pivotY: 0,
        hue: (360 * p) / count,
        bobX: new Float64Array(segments),
        bobY: new Float64Array(segments),
        radius: new Float64Array(segments),
        pluckTime: new Float64Array(segments).fill(-Infinity),
        trailX: new Float64Array(TRAIL_CAPACITY),
        trailY: new Float64Array(TRAIL_CAPACITY),
        trailT: new Float64Array(TRAIL_CAPACITY),
        trailHead: 0,
        trailCount: 0,
      });
    }
    this.prevX = new Float64Array(segments);
    this.prevY = new Float64Array(segments);
    this.rebuildLayout();
    for (const pen of v.pendulums) {
      this.placeBobs(pen);
      this.pushTrail(pen, 0, true);
    }
    v.energy0 = this.totalEnergy();
    v.energy = v.energy0;
    v.energyScale = Math.max(1e-9, count * masses.reduce((a, b) => a + b, 0) * DP_GRAVITY * s.gravity);
    this.buildStrings();
    const field = v.field!;
    this.firstId = ctx.getNextId();
    for (const pen of v.pendulums) {
      const color = dpBobColor(pen.hue);
      for (let k = 0; k < segments; k++) {
        const r = pen.radius[k] * field.scale;
        ctx.addBall({ x: field.cx + pen.bobX[k] * field.scale, y: field.cy + pen.bobY[k] * field.scale, vx: 0, vy: 0, radius: r, color, gravityScale: 0, radiusScale: r / this.ballRadius });
      }
    }
  }

  onPreUpdate(ctx: ModeContext) {
    // A live change of the ball size re-sizes the bobs (and the rig that makes room for them).
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.ballRadius) {
      this.ballRadius = radius;
      this.rebuildLayout();
      this.applyBalls(ctx);
    }
  }

  /** The engine moved the bob by its (zero) velocity, plus any wind; pin it where the integrator has it. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    const v = this.view;
    const f = v.field;
    const i = ball.id - this.firstId;
    if (f && i >= 0 && i < v.count * v.segments) {
      const pen = v.pendulums[Math.floor(i / v.segments)];
      const k = i % v.segments;
      ball.x = f.cx + pen.bobX[k] * f.scale;
      ball.y = f.cy + pen.bobY[k] * f.scale;
    }
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /**
   * Advances every pendulum by one 60 Hz step in RK4 sub-steps; after each sub-step the sparring contacts are resolved,
   * the string crossings of every bob found and the trails sampled. Then the step's plucks go out as one note or
   * chord, the hits as percussive notes. Once the finale starts (`finaleStartSec()` of the clip) the rig holds still
   * with the closing chord while the clock runs on, and the run finishes at the clip length (never when endless).
   */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    if (v.finished || v.pendulums.length === 0) return;
    const s = v.settings;
    const stepSec = dtMs / 1000;
    const finaleAt = s.endless ? Infinity : finaleStartSec(s.clipSeconds);
    // Endless switched on, or a longer clip, during the finale: the swing goes on.
    if (v.finale && v.timeSec < finaleAt - 1e-9) v.finale = false;
    if (v.finale) {
      v.step++;
      v.timeSec = v.step * stepSec;
      if (v.timeSec >= s.clipSeconds - 1e-9) v.finished = true;
      return;
    }
    let maxRate = 0;
    for (const pen of v.pendulums) maxRate = Math.max(maxRate, pen.chain.maxRate());
    const sub = subStepsFor(maxRate, stepSec);
    const h = stepSec / sub;
    v.subSteps = sub;
    this.stepPitches.length = 0;
    this.stepHits.length = 0;
    this.stepLevel = 0;
    const t0 = v.timeSec;
    for (let n = 0; n < sub; n++) {
      const t = t0 + (n + 1) * h;
      for (const pen of v.pendulums) {
        for (let k = 0; k < v.segments; k++) {
          this.prevX[k] = pen.bobX[k];
          this.prevY[k] = pen.bobY[k];
        }
        pen.chain.step(h);
        this.placeBobs(pen);
        this.detectPlucks(pen, h, t);
        this.pushTrail(pen, t, false);
      }
      if (s.spar && v.pendulums.length === 2) this.resolveContacts(t);
    }
    v.step++;
    v.timeSec = v.step * stepSec;
    v.energy = this.totalEnergy();
    this.queueSounds(ctx);
    if (v.timeSec >= finaleAt - 1e-9) this.startFinale(ctx);
    if (!s.endless && v.timeSec >= s.clipSeconds - 1e-9) v.finished = true;
    this.applyPositions(ctx);
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize re-lays the rig out (the trails are kept in model units, so they follow). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.width = ctx.config.width;
      this.height = ctx.config.height;
      if (this.view.pendulums.length > 0) {
        this.rebuildLayout();
        this.applyBalls(ctx);
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, step: v.step, plucks: v.plucks, hits: v.hitCount, finale: v.finale, finished: v.finished, energy: v.energy };
  }

  /* -------------------------------------------------------------- internals */

  /** The start angles (radians) of the first pendulum: the settings' angles, or – seeded – a high, chaotic start. */
  private startAngles(ctx: ModeContext, lengths: readonly number[], spar: boolean): number[] {
    const s = this.settings;
    const n = s.segments;
    const fixed = [s.angle1, s.angle2, s.angle3].slice(0, n).map((a) => (a * Math.PI) / 180);
    if (!s.randomStart) return fixed;
    // Four draws per try, whatever the rod count: the first rod 100°–170° to either side, the others anywhere.
    const draw = () => {
      const side = ctx.random() < 0.5 ? -1 : 1;
      const a1 = side * (100 + 70 * ctx.random());
      const a2 = -180 + 360 * ctx.random();
      const a3 = -180 + 360 * ctx.random();
      return [a1, a2, a3].slice(0, n).map((a) => (a * Math.PI) / 180);
    };
    let angles = draw();
    if (!spar) return angles;
    // Sparring starts as mirror images: draw again (a few times at most) while a bob would start inside the other pendulum's.
    const masses = chainMasses(s);
    const minDist = 2.2 * bobModelRadius(this.ballRadius, Math.max(...masses), maxBobSizeFactor(masses), SPAR_PIVOT_DISTANCE / 2 + 1);
    for (let tries = 0; tries < 8 && mirrorOverlaps(angles, lengths, minDist); tries++) angles = draw();
    return angles;
  }

  private totalEnergy(): number {
    let e = 0;
    for (const pen of this.view.pendulums) e += pen.chain.energy();
    return e;
  }

  /** Field, scale, bob radii and the harp geometry for the current canvas and ball size. */
  private rebuildLayout() {
    const v = this.view;
    const masses = chainMasses(v.settings);
    const maxFactor = maxBobSizeFactor(masses);
    const field = buildDpField(this.width, this.height, v.spanHalf, BOB_UNIT * this.ballRadius * maxFactor);
    v.field = field;
    for (const pen of v.pendulums) {
      for (let k = 0; k < v.segments; k++) pen.radius[k] = bobModelRadius(this.ballRadius, masses[k] ?? 1, maxFactor, v.spanHalf);
    }
    v.harp = buildHarpGeometry(v.settings.stringLayout, v.strings.length, v.spanHalf, (0.5 * field.side) / field.scale);
  }

  /** Tunes the strings to the scale and lays them out (a live change keeps the vibrations of strings that stay). */
  private buildStrings() {
    const v = this.view;
    const s = v.settings;
    const midis = harpStringMidi(s.strings, s.octaves, s.scale, s.rootNote);
    const old = v.strings;
    v.strings = midis.map((midi, k) => ({
      midi,
      pitch: midiToFrequency(midi),
      hue: midis.length > 1 ? (300 * k) / (midis.length - 1) : 0,
      pluckTime: old[k]?.pluckTime ?? -Infinity,
      amp: old[k]?.amp ?? 0,
      plucks: old[k]?.plucks ?? 0,
    }));
    const halfHeight = v.field ? (0.5 * v.field.side) / v.field.scale : v.spanHalf;
    v.harp = buildHarpGeometry(s.stringLayout, v.strings.length, v.spanHalf, halfHeight);
  }

  private placeBobs(pen: DpPendulum) {
    for (let k = 0; k < pen.chain.links; k++) {
      pen.chain.bobPosition(k, SCRATCH_POS);
      pen.bobX[k] = pen.pivotX + SCRATCH_POS.x;
      pen.bobY[k] = pen.pivotY + SCRATCH_POS.y;
    }
  }

  /** Samples the last bob into the trail once it moved `TRAIL_MIN_PX` since the previous sample (or always, with `force`). */
  private pushTrail(pen: DpPendulum, t: number, force: boolean) {
    const k = pen.chain.links - 1;
    const x = pen.bobX[k];
    const y = pen.bobY[k];
    if (!force && pen.trailCount > 0) {
      const last = (pen.trailHead - 1 + TRAIL_CAPACITY) % TRAIL_CAPACITY;
      const f = this.view.field;
      const minDist = f ? TRAIL_MIN_PX / f.scale : 0.005;
      const dx = x - pen.trailX[last];
      const dy = y - pen.trailY[last];
      if (dx * dx + dy * dy < minDist * minDist) return;
    }
    pen.trailX[pen.trailHead] = x;
    pen.trailY[pen.trailHead] = y;
    pen.trailT[pen.trailHead] = t;
    pen.trailHead = (pen.trailHead + 1) % TRAIL_CAPACITY;
    if (pen.trailCount < TRAIL_CAPACITY) pen.trailCount++;
  }

  /** Every string a bob of `pen` crossed during the sub-step that ended at `t` is plucked (once per `PLUCK_COOLDOWN_SEC`). */
  private detectPlucks(pen: DpPendulum, h: number, t: number) {
    const v = this.view;
    const g = v.harp;
    if (g.count <= 0) return;
    const out = this.crossings;
    for (let k = 0; k < pen.chain.links; k++) {
      out.length = 0;
      if (harpCrossings(g, this.prevX[k], this.prevY[k], pen.bobX[k], pen.bobY[k], out) === 0) continue;
      const speed = Math.hypot(pen.bobX[k] - this.prevX[k], pen.bobY[k] - this.prevY[k]) / h;
      for (let i = 0; i < out.length; i++) {
        const str = v.strings[out[i]];
        if (!str || t - str.pluckTime < PLUCK_COOLDOWN_SEC) continue;
        str.pluckTime = t;
        str.amp = Math.min(1, speed / PLUCK_FULL_SPEED);
        str.plucks++;
        v.plucks++;
        pen.pluckTime[k] = t;
        if (!this.stepPitches.includes(str.pitch)) this.stepPitches.push(str.pitch);
        this.stepLevel = Math.max(this.stepLevel, pluckLevel(speed));
      }
    }
  }

  /** Sparring: every overlapping, approaching pair of bobs of the two pendulums exchanges an elastic impulse. */
  private resolveContacts(t: number) {
    const v = this.view;
    const a = v.pendulums[0];
    const b = v.pendulums[1];
    for (let ka = 0; ka < a.chain.links; ka++) {
      for (let kb = 0; kb < b.chain.links; kb++) {
        const dx = b.bobX[kb] - a.bobX[ka];
        const dy = b.bobY[kb] - a.bobY[ka];
        const rr = a.radius[ka] + b.radius[kb];
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-18) continue;
        const d = Math.sqrt(d2);
        const speed = collideBobs(a.chain, ka, b.chain, kb, dx / d, dy / d, 1, this.contact);
        if (speed < HIT_SOUND_SPEED) continue;
        const strength = Math.min(1, speed / HIT_FULL_SPEED);
        v.hitCount++;
        v.lastHitTime = t;
        v.lastHitStrength = strength;
        const hit = v.hits[this.hitNext];
        this.hitNext = (this.hitNext + 1) % HIT_POOL;
        hit.x = a.bobX[ka] + (dx * a.radius[ka]) / d;
        hit.y = a.bobY[ka] + (dy * a.radius[ka]) / d;
        hit.time = t;
        hit.strength = strength;
        this.stepHits.push(strength);
      }
    }
  }

  /** The step's plucks as one note or chord, and its (at most two strongest) sparring hits as low, percussive notes. */
  private queueSounds(ctx: ModeContext) {
    const s = this.view.settings;
    const pitches = this.stepPitches;
    if (pitches.length > 0) {
      pitches.sort((x, y) => x - y);
      if (pitches.length > MAX_PLUCK_NOTES) pitches.length = MAX_PLUCK_NOTES;
      const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: pitches[0], level: this.stepLevel };
      if (pitches.length > 1) event.chord = pitches.slice();
      ctx.addPendingSoundEvent(event);
    }
    const hits = this.stepHits;
    if (hits.length > 0) {
      hits.sort((x, y) => y - x);
      for (let i = 0; i < hits.length && i < MAX_HIT_SOUNDS_PER_STEP; i++) {
        const strength = hits[i];
        const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: sparHitPitch(strength, s.octaves, s.rootNote), level: 0.45 + 0.55 * strength };
        if (strength >= HIT_ACCENT_STRENGTH) event.accent = true;
        ctx.addPendingSoundEvent(event);
      }
    }
  }

  /** The finale: the rig holds its pose (under the "TIME!" banner, then the end screen), a closing chord and confetti. */
  private startFinale(ctx: ModeContext) {
    const v = this.view;
    v.finale = true;
    ctx.addPendingSoundEvent(closingChordEvent(v.settings));
    if (v.field) ctx.spawnConfetti(v.field.cx, v.field.cy);
  }

  /** Writes the bob positions into the engine balls. */
  private applyPositions(ctx: ModeContext) {
    const v = this.view;
    const f = v.field;
    if (!f) return;
    const n = v.count * v.segments;
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.firstId;
      if (i < 0 || i >= n) continue;
      const pen = v.pendulums[Math.floor(i / v.segments)];
      const k = i % v.segments;
      ball.x = f.cx + pen.bobX[k] * f.scale;
      ball.y = f.cy + pen.bobY[k] * f.scale;
    }
  }

  /** Writes the bob radii and positions into every ball (`radiusScale` keeps the size right across `setConfig({ ballRadius })`). */
  private applyBalls(ctx: ModeContext) {
    const v = this.view;
    const f = v.field;
    if (!f) return;
    const n = v.count * v.segments;
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.firstId;
      if (i < 0 || i >= n) continue;
      const pen = v.pendulums[Math.floor(i / v.segments)];
      const k = i % v.segments;
      ball.radius = pen.radius[k] * f.scale;
      ball.radiusScale = ball.radius / this.ballRadius;
    }
    this.applyPositions(ctx);
  }
}

/** The chord the run closes with: the first, third and fifth degree of the harp's scale on its lowest string, and the octave – accented. */
export function closingChordEvent(settings: Pick<DoublePendulumSettings, "octaves" | "scale" | "rootNote">): SoundEvent {
  const intervals = settings.scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[settings.scale];
  const base = harpBaseMidi(settings.octaves, settings.rootNote);
  const chord = [0, intervals[2] ?? 4, intervals[4] ?? 7, 12].map((i) => midiToFrequency(base + i));
  return { type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true };
}

/**
 * Would two sparring pendulums starting as mirror images of `angles` (pivots `SPAR_PIVOT_DISTANCE` apart) have two bobs
 * closer than `minDist` (model units)? The seeded start draws again then, so a sparring run never starts tangled.
 */
export function mirrorOverlaps(angles: readonly number[], lengths: readonly number[], minDist: number): boolean {
  const xs: number[] = [];
  const ys: number[] = [];
  let x = -SPAR_PIVOT_DISTANCE / 2;
  let y = 0;
  for (let i = 0; i < angles.length; i++) {
    x += lengths[i] * Math.sin(angles[i]);
    y += lengths[i] * Math.cos(angles[i]);
    xs.push(x);
    ys.push(y);
  }
  // The mirror image of bob j sits at (−x, y).
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) if (Math.hypot(xs[i] + xs[j], ys[i] - ys[j]) < minDist) return true;
  return false;
}
