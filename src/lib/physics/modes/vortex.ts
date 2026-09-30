import { SCALE_INTERVALS, isScaleId, midiToFrequency, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";

/**
 * Sound Vortex ("vortex" mode, feature gerald-vortex – the geraldbounces "sound vortex, pew" clips). No rings to escape:
 * a spiral funnel seen from above – concentric "sound rings" over a glowing whirlpool – with a hole in the middle.
 * 1–30 balls enter at the rim one after another (`stagger` seconds apart), each with a tangential velocity, and spiral
 * inward under a central pull that grows toward the centre plus a light drag; every ring line a ball crosses on its way
 * in plays the next note of the scale (ring 0 at the rim is the lowest), so each ball is a rising glissando and the
 * staggered balls weave arpeggios. Reaching the hole plays a "pew" – a fast downward pitch sweep synthesised by the
 * ToneGenerator (`playPew()`, or the chosen wall-break clip) – and the ball is swallowed with a splash; with `loop` on it
 * comes back at the rim, otherwise the run finishes `SWALLOW_HOLD_SEC` after the last ball is gone.
 *
 * Physics: the balls are ordinary engine balls whose motion the mode owns (like Pendulum Wave: the "none" ring layout,
 * `gravityScale` 0, `ballsMayRest` + `ballsPassThrough`, positions overwritten in `onBallStep()`). Each ball is integrated
 * in polar coordinates (radius r, its speed r′, angle θ and the angular momentum L = r·v_θ per unit mass) under the
 * attraction g(r) = v_c² / r – it grows toward the centre, and a circular orbit has the same speed v_c at every radius, so
 * the angular speed v_c / r whirls up as the ball sinks – and a linear drag k:
 *
 *   L′ = −k·L,   r″ = L² / r³ − v_c² / r − k·r′,   θ′ = ±L / r².
 *
 * A ball entering on the circular speed with r′ = −k·r follows r(t) = r₀·e^(−k·t) exactly (the energy the drag takes is
 * all potential energy), so k = ln(r₀ / r_hole) / duration makes it reach the hole after `duration` seconds and rings
 * spaced geometrically between the entry and the hole are crossed at a steady tempo – a note every duration / (rings + 1)
 * seconds per ball. The central pull (`gravity`) sets v_c: how many laps the ball whirls on the way (the time stays the
 * duration). The seed draws the whirl direction, the entry angle, a run tempo of 1 ± `TEMPO_SPREAD` / 2 (it scales the
 * drag, so the run length is a continuous function of the seed and Find Simulation can land a target) and, per ball, an
 * entry speed of `ENTRY_SPEED_MIN`–1 × v_c (a slower ball dips in and wobbles a little around the spiral – the weave).
 * `stepSpiral()` is a semi-implicit Euler step (the drag on L exact) cut into sub-steps of at most `MAX_TURN_PER_STEP`
 * radians, so the fastest whirl by the hole stays accurate; everything is deterministic for a seed (`ctx.random()`).
 *
 * The optional depth cue (`depthScale`) shrinks a ball toward the centre (its `radiusScale`, so a Ball Size change keeps
 * it), and the canvas darkens the funnel's throat (components/simulator/vortexRenderer.ts).
 */

/* ------------------------------------------------------------------ settings */

export interface VortexSettings {
  /** Balls that go down the vortex, 1–30. */
  balls: number;
  /** Seconds between two balls entering at the rim, 0–3 (0 = all at once). */
  stagger: number;
  /** Sound rings between the rim and the hole, 6–24: a note each. */
  rings: number;
  /** Seconds a ball takes from the rim to the hole, 3–30 (the seed's tempo moves it by up to ±8 %). */
  duration: number;
  /** 0.2–3: the central pull – how fast the balls whirl (laps on the way), not how long they take. */
  gravity: number;
  /** A swallowed ball comes back at the rim: the vortex never ends. */
  loop: boolean;
  /** 0–1: the 3-D depth cue – balls shrink toward the centre and the throat darkens (live). */
  depthScale: number;
  /** The Sound section's scale and root: ring i plays degree i of it (live). */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_VORTEX_SETTINGS: VortexSettings = {
  balls: 12,
  stagger: 1.5,
  rings: 12,
  duration: 12.5,
  gravity: 1,
  loop: false,
  depthScale: 0.5,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const VORTEX_RANGES = {
  vxBalls: { min: 1, max: 30, step: 1 },
  vxStagger: { min: 0, max: 3, step: 0.05 },
  vxRings: { min: 6, max: 24, step: 1 },
  vxDuration: { min: 3, max: 30, step: 0.5 },
  vxGravity: { min: 0.2, max: 3, step: 0.05 },
  vxDepthScale: { min: 0, max: 1, step: 0.05 },
} as const;

/** The Sound Vortex fields of the SimulatorSettings object (URL keys vxn, vxs, vxr, vxd, vxg, vxl, vxds). */
export interface VortexFields {
  vxBalls: number;
  vxStagger: number;
  vxRings: number;
  vxDuration: number;
  vxGravity: number;
  vxLoop: boolean;
  vxDepthScale: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Rounds onto a slider's step (whole numbers stay whole). */
function onStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

/** Fills in the defaults and clamps every value onto its slider (counts whole, the rest on their steps); bad values fall back to the defaults. */
export function resolveVortexSettings(config: Partial<VortexSettings> | null | undefined): VortexSettings {
  const out = { ...DEFAULT_VORTEX_SETTINGS };
  if (!config) return out;
  const R = VORTEX_RANGES;
  if (config.balls !== undefined) out.balls = Math.round(clampNumber(config.balls, R.vxBalls, out.balls));
  if (config.stagger !== undefined) out.stagger = Math.round(onStep(clampNumber(config.stagger, R.vxStagger, out.stagger), 0.05) * 100) / 100;
  if (config.rings !== undefined) out.rings = Math.round(clampNumber(config.rings, R.vxRings, out.rings));
  if (config.duration !== undefined) out.duration = onStep(clampNumber(config.duration, R.vxDuration, out.duration), 0.5);
  if (config.gravity !== undefined) out.gravity = Math.round(onStep(clampNumber(config.gravity, R.vxGravity, out.gravity), 0.05) * 100) / 100;
  if (typeof config.loop === "boolean") out.loop = config.loop;
  if (config.depthScale !== undefined) out.depthScale = Math.round(onStep(clampNumber(config.depthScale, R.vxDepthScale, out.depthScale), 0.05) * 100) / 100;
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** Picks the Sound Vortex settings (and the Sound section's scale and root) out of a bigger object for `engine.setVortexSettings()`. */
export function vortexSettingsOf(source: VortexFields & { scale?: ScaleId; rootNote?: number }): VortexSettings {
  return {
    balls: source.vxBalls,
    stagger: source.vxStagger,
    rings: source.vxRings,
    duration: source.vxDuration,
    gravity: source.vxGravity,
    loop: source.vxLoop,
    depthScale: source.vxDepthScale,
    scale: source.scale ?? DEFAULT_VORTEX_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_VORTEX_SETTINGS.rootNote,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function vortexSettingFields(settings: VortexSettings): VortexFields {
  return {
    vxBalls: settings.balls,
    vxStagger: settings.stagger,
    vxRings: settings.rings,
    vxDuration: settings.duration,
    vxGravity: settings.gravity,
    vxLoop: settings.loop,
    vxDepthScale: settings.depthScale,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** The defaults of the feature's fields. */
export function defaultVortexFields(): VortexFields {
  return vortexSettingFields(DEFAULT_VORTEX_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers on their steps, a real boolean. */
export function resolveVortexFields(source: Partial<VortexFields>): VortexFields {
  return vortexSettingFields(
    resolveVortexSettings({
      balls: source.vxBalls,
      stagger: source.vxStagger,
      rings: source.vxRings,
      duration: source.vxDuration,
      gravity: source.vxGravity,
      loop: source.vxLoop,
      depthScale: source.vxDepthScale,
    }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { vxn: "vxBalls", vxs: "vxStagger", vxr: "vxRings", vxd: "vxDuration", vxg: "vxGravity", vxds: "vxDepthScale" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: vxn, vxs, vxr, vxd, vxg, vxl and vxds. */
export function writeVortexParams(settings: VortexFields, base: VortexFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.vxLoop !== base.vxLoop) params.set("vxl", settings.vxLoop ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readVortexParams(params: URLSearchParams, settings: VortexFields) {
  const next: Partial<VortexFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const loop = params.get("vxl");
  if (loop === "1") next.vxLoop = true;
  else if (loop === "0") next.vxLoop = false;
  Object.assign(settings, resolveVortexFields(next));
}

/* ------------------------------------------------------------------ geometry */

/** Rim radius as a fraction of the square the recorder crops to (the side of the smaller canvas dimension). */
export const RIM_AT = 0.46;
/** Balls enter this fraction of the rim radius from the centre (just inside the rim line). */
export const ENTRY_AT = 0.955;
/** Radius of the hole as a fraction of the rim radius. */
export const HOLE_AT = 0.075;
/** Most balls and rings (the view's arrays are allocated once at this size). */
export const MAX_VORTEX_BALLS = 30;
export const MAX_VORTEX_RINGS = 24;

export interface VortexField {
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Side of the square the recorder crops to (min of width and height). */
  size: number;
  rim: number;
  /** Radius the balls enter at. */
  entry: number;
  hole: number;
  /** Radii of the sound rings, outermost first (ring 0 is the lowest note); `ringCount` of them are in use. */
  rings: Float64Array;
  ringCount: number;
}

export function createVortexField(): VortexField {
  return { width: 0, height: 0, cx: 0, cy: 0, size: 0, rim: 0, entry: 0, hole: 0, rings: new Float64Array(MAX_VORTEX_RINGS), ringCount: 0 };
}

/**
 * Radii of `count` sound rings spaced geometrically between `entry` (exclusive) and `hole` (exclusive):
 * entry · (hole / entry)^((i + 1) / (count + 1)). A ball on the spiral r = entry · e^(−k·t) crosses them at a steady tempo.
 */
export function ringRadii(entry: number, hole: number, count: number, out: Float64Array | number[] = new Float64Array(count)): Float64Array | number[] {
  const ratio = hole / entry;
  for (let i = 0; i < count; i++) out[i] = entry * Math.pow(ratio, (i + 1) / (count + 1));
  return out;
}

/** Lays the funnel out in the centred square of a `width` × `height` canvas (into `out` when given: no allocation). */
export function buildVortexField(width: number, height: number, rings: number, out: VortexField = createVortexField()): VortexField {
  const size = Math.max(1, Math.min(width, height));
  out.width = width;
  out.height = height;
  out.cx = width / 2;
  out.cy = height / 2;
  out.size = size;
  out.rim = RIM_AT * size;
  out.entry = ENTRY_AT * out.rim;
  out.hole = HOLE_AT * out.rim;
  out.ringCount = Math.max(0, Math.min(MAX_VORTEX_RINGS, Math.round(rings)));
  ringRadii(out.entry, out.hole, out.ringCount, out.rings);
  return out;
}

/** Depth of radius `r` in the funnel, 0 at the entry → 1 at the hole (logarithmic, like the rings); clamped. */
export function vortexDepth(field: Pick<VortexField, "entry" | "hole">, r: number): number {
  if (!(r > 0)) return 1;
  const d = Math.log(field.entry / r) / Math.log(field.entry / field.hole);
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** At full depth scale a ball shrinks to 1 − `DEPTH_SHRINK` of its size by the hole. */
export const DEPTH_SHRINK = 0.6;

/** A ball's size factor at depth `depth` (0–1) with the depth cue `depthScale` (0–1). */
export function depthRadiusScale(depth: number, depthScale: number): number {
  return 1 - DEPTH_SHRINK * Math.max(0, Math.min(1, depthScale)) * Math.max(0, Math.min(1, depth));
}

/* ------------------------------------------------------------------ physics */

/** Angular speed (rad/s) of a circular orbit at the rim with the central pull at 1. */
export const BASE_OMEGA = 1.2;
/** The seed's run tempo lies in 1 ± TEMPO_SPREAD / 2; it scales the drag (a faster tempo = a shorter spiral). */
export const TEMPO_SPREAD = 0.16;
/** A ball enters with ENTRY_SPEED_MIN–1 × the circular speed (drawn per ball). */
export const ENTRY_SPEED_MIN = 0.96;
/** The run finishes this long after the last ball is swallowed (the splash and the pew play out). */
export const SWALLOW_HOLD_SEC = 1;
/** With the loop on, a swallowed ball re-enters at the rim this long after it was swallowed. */
export const RESPAWN_DELAY_SEC = 0.35;
/** The integrator cuts a sub-step into pieces that turn the ball by at most this many radians. */
export const MAX_TURN_PER_STEP = 0.08;
/** A ball still in flight after this many times its nominal spiral is swallowed (a safety net; never reached in practice). */
export const MAX_FLIGHT_FACTOR = 4;
/** Consecutive entries are this fraction of a turn apart (the golden angle), plus a seeded jitter. */
export const ENTRY_TURN = 0.381966;
export const ENTRY_JITTER = 0.35;

/** Speed (px/s) of a circular orbit – the same at every radius – for a rim of `rim` px and the central pull `gravity`. */
export function circularSpeed(rim: number, gravity: number): number {
  return rim * BASE_OMEGA * Math.sqrt(Math.max(0, gravity));
}

/** The drag rate k (1/s) that takes a ball from `entry` to `hole` in `durationSec` on the matched spiral r = entry · e^(−k·t). */
export function dragRate(entry: number, hole: number, durationSec: number): number {
  return Math.log(entry / hole) / Math.max(1e-3, durationSec);
}

/** Polar state of a ball (per unit mass): radius, radial speed, angle and angular momentum L = r · v_θ (≥ 0; the direction is separate). */
export interface SpiralState {
  r: number;
  vr: number;
  theta: number;
  L: number;
}

/**
 * Advances a ball by `dt` seconds under the pull v_c² / r and the drag `k` (see the file comment), turning in direction
 * `dir` (+1 or −1). Semi-implicit Euler in pieces of at most `MAX_TURN_PER_STEP` radians; the drag on L is exact. In place.
 */
export function stepSpiral(s: SpiralState, dt: number, vc: number, k: number, dir = 1, maxTurn = MAX_TURN_PER_STEP): void {
  if (!(dt > 0)) return;
  const omega = s.L / (s.r * s.r);
  const n = Math.max(1, Math.min(64, Math.ceil((omega * dt) / maxTurn)));
  const h = dt / n;
  const decay = Math.exp(-k * h);
  const vc2 = vc * vc;
  const floor = 1e-3;
  for (let i = 0; i < n; i++) {
    const r = s.r;
    s.vr += ((s.L * s.L) / (r * r * r) - vc2 / r - k * s.vr) * h;
    s.r = Math.max(floor, r + s.vr * h);
    s.L *= decay;
    s.theta += (dir * s.L * h) / (s.r * s.r);
  }
  if (s.theta > 1e6 || s.theta < -1e6) s.theta %= 2 * Math.PI;
}

/**
 * Ring crossings of a ball that moved to radius `r`: the index of the next ring it has not crossed yet, advanced past
 * every ring it is now inside (only inward, only once – a ball wobbling back out and in again does not replay a note).
 * `onCross(ring)` is called for each ring crossed, outermost first.
 */
export function crossRings(r: number, radii: ArrayLike<number>, count: number, nextRing: number, onCross?: (ring: number) => void): number {
  let next = nextRing;
  while (next < count && r < radii[next]) {
    onCross?.(next);
    next++;
  }
  return next;
}

/* ------------------------------------------------------------------ sound */

/** The degrees the rings climb: the chosen scale, or a diatonic major scale while the Sound section is chromatic. */
export function vortexScale(scale: ScaleId): readonly number[] {
  return scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[scale];
}

/** MIDI note (before the root) the outermost ring plays: C4, an octave lower at a time while the innermost would pass C7. */
export function vortexBaseMidi(rings: number, scale: ScaleId): number {
  const steps = vortexScale(scale);
  const n = steps.length;
  const top = Math.max(0, Math.round(rings) - 1);
  let base = 60;
  while (base > 36 && base + 12 * Math.floor(top / n) + steps[top % n] > 96) base -= 12;
  return base;
}

/** MIDI note of ring `ring` (0 = the rim, the lowest) out of `rings`: degree `ring` of the scale on the root. */
export function ringMidi(ring: number, rings: number, scale: ScaleId, rootNote: number): number {
  const steps = vortexScale(scale);
  const n = steps.length;
  const d = Math.max(0, Math.round(ring));
  return vortexBaseMidi(rings, scale) + normalizeRootNote(rootNote) + 12 * Math.floor(d / n) + steps[d % n];
}

/** Pitch (Hz) of ring `ring`: it rises with depth. */
export function ringPitch(ring: number, rings: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(ringMidi(ring, rings, scale, rootNote));
}

/** Where the pew starts (Hz): an octave above the innermost ring, kept between 600 Hz and 2.4 kHz. */
export function pewPitch(rings: number, scale: ScaleId, rootNote: number): number {
  const f = 2 * ringPitch(Math.max(0, Math.round(rings) - 1), rings, scale, rootNote);
  return Math.max(600, Math.min(2400, f));
}

/** Most distinct ring notes one 60 Hz step voices (a chord); most pews one step queues. */
export const MAX_RING_NOTES_PER_STEP = 4;
export const MAX_PEWS_PER_STEP = 2;

/* ------------------------------------------------------------------ run length */

/**
 * The nominal run length (s): the last ball enters after (balls − 1) × stagger and takes `duration` to the hole, and the
 * run ends `SWALLOW_HOLD_SEC` later; the seed moves it by the tempo (±8 % of the duration). Null with the loop on.
 */
export function vortexNominalRunSec(settings: Partial<VortexSettings> | null | undefined): number | null {
  const s = resolveVortexSettings(settings);
  if (s.loop) return null;
  return (s.balls - 1) * s.stagger + s.duration + SWALLOW_HOLD_SEC;
}

/** The shortest and longest run the seed's tempo allows (s), or null with the loop on. */
export function vortexRunRangeSec(settings: Partial<VortexSettings> | null | undefined): { min: number; max: number } | null {
  const s = resolveVortexSettings(settings);
  if (s.loop) return null;
  const lead = (s.balls - 1) * s.stagger + SWALLOW_HOLD_SEC;
  // A ball entering at ENTRY_SPEED_MIN × v_c sinks around a guiding radius that much smaller: a little sooner in.
  const early = 1 + Math.log(ENTRY_SPEED_MIN) / Math.log(ENTRY_AT / HOLE_AT);
  return { min: lead + (early * s.duration) / (1 + TEMPO_SPREAD / 2), max: lead + s.duration / (1 - TEMPO_SPREAD / 2) };
}

/* ------------------------------------------------------------------ view */

/** A ball being swallowed: where, in which colour and when (simulation ms) – the canvas draws the splash from it. */
export const MAX_SPLASHES = 32;

export const VORTEX_BALL_COLORS = ["#ffffff", "#ff5d73", "#ffb238", "#f7f052", "#93d119", "#2de2e6", "#4d9dff", "#b388ff", "#ff7ad9", "#5dffb0", "#ff8f5d", "#c6ff5d"];

/** Colour of ball slot `slot`: the first ball wears the Ball Colour (Gerald), the others a rainbow palette. */
export function vortexBallColor(slot: number, ballColor: string): string {
  if (slot === 0) return ballColor || "#ffffff";
  return VORTEX_BALL_COLORS[1 + ((slot - 1) % (VORTEX_BALL_COLORS.length - 1))];
}

export interface VortexView {
  /** The settings of the run (the depth cue, scale and root follow live). */
  settings: VortexSettings;
  field: VortexField;
  /** +1: the balls turn with increasing angle (clockwise on screen), −1 the other way. */
  dir: number;
  /** The seed's tempo (1 ± 8 %) and the resulting drag (1/s), circular speed (px/s) and nominal spiral time (s). */
  tempo: number;
  drag: number;
  circularSpeed: number;
  spiralSec: number;
  /** Simulation time of the run (ms). */
  timeMs: number;
  /** Last crossing time (simulation ms) of every ring (−Infinity: never). */
  ringHitMs: Float64Array;
  /** Per ball slot: 0 waiting to enter, 1 in the vortex, 2 swallowed; radius, angle, position, colour and the last note's time. */
  slotState: Uint8Array;
  slotR: Float64Array;
  slotTheta: Float64Array;
  slotX: Float64Array;
  slotY: Float64Array;
  slotNoteMs: Float64Array;
  slotColor: string[];
  /** Rings each ball has crossed (its next ring). */
  slotRing: Int16Array;
  slotCount: number;
  /** The splashes of swallowed balls (a ring buffer of `MAX_SPLASHES`, `splashCount` written so far). */
  splashX: Float64Array;
  splashY: Float64Array;
  splashMs: Float64Array;
  splashColor: string[];
  splashCount: number;
  /** Counters: balls entered, swallowed (pews), ring notes played, notes voiced as chords, the deepest ring reached. */
  entered: number;
  swallowed: number;
  notes: number;
  chords: number;
  deepestRing: number;
  inFlight: number;
  lastSwallowMs: number;
  /** Every ball has been swallowed (never with the loop): the "PEW!" banner shows through the `SWALLOW_HOLD_SEC` hold before the end. */
  allSwallowed: boolean;
  finished: boolean;
  /** Simulation time (ms) the run finished at (−1 while it has not). */
  finishedMs: number;
}

function createView(): VortexView {
  return {
    settings: { ...DEFAULT_VORTEX_SETTINGS },
    field: createVortexField(),
    dir: 1,
    tempo: 1,
    drag: 0,
    circularSpeed: 0,
    spiralSec: DEFAULT_VORTEX_SETTINGS.duration,
    timeMs: 0,
    ringHitMs: new Float64Array(MAX_VORTEX_RINGS).fill(-Infinity),
    slotState: new Uint8Array(MAX_VORTEX_BALLS),
    slotR: new Float64Array(MAX_VORTEX_BALLS),
    slotTheta: new Float64Array(MAX_VORTEX_BALLS),
    slotX: new Float64Array(MAX_VORTEX_BALLS),
    slotY: new Float64Array(MAX_VORTEX_BALLS),
    slotNoteMs: new Float64Array(MAX_VORTEX_BALLS).fill(-Infinity),
    slotColor: new Array<string>(MAX_VORTEX_BALLS).fill("#ffffff"),
    slotRing: new Int16Array(MAX_VORTEX_BALLS),
    slotCount: 0,
    splashX: new Float64Array(MAX_SPLASHES),
    splashY: new Float64Array(MAX_SPLASHES),
    splashMs: new Float64Array(MAX_SPLASHES).fill(-Infinity),
    splashColor: new Array<string>(MAX_SPLASHES).fill("#ffffff"),
    splashCount: 0,
    entered: 0,
    swallowed: 0,
    notes: 0,
    chords: 0,
    deepestRing: -1,
    inFlight: 0,
    lastSwallowMs: -Infinity,
    allSwallowed: false,
    finished: false,
    finishedMs: -1,
  };
}

/** A ball slot's state (`VortexView.slotState`): waiting to enter, in the vortex, swallowed. */
export const SLOT_WAITING = 0;
export const SLOT_FLYING = 1;
export const SLOT_SWALLOWED = 2;
const WAITING = SLOT_WAITING;
const FLYING = SLOT_FLYING;
const SWALLOWED = SLOT_SWALLOWED;

/* ------------------------------------------------------------------ the mode */

export class VortexMode implements GameMode {
  readonly name = "vortex";
  /** The mode moves the balls itself: no slow-ball boost. */
  readonly ballsMayRest = true;
  /** The balls weave through each other (nothing may disturb their spirals). */
  readonly ballsPassThrough = true;
  private settings: VortexSettings = { ...DEFAULT_VORTEX_SETTINGS };
  private readonly view: VortexView = createView();
  /** The mode's clock (ms): the sum of the fixed steps since init. */
  private clockMs = 0;
  private stepStartMs = 0;
  /** Per slot: the polar state, when it (re-)enters (s), its seeded entry speed factor and entry angle, its engine ball. */
  private readonly r = new Float64Array(MAX_VORTEX_BALLS);
  private readonly vr = new Float64Array(MAX_VORTEX_BALLS);
  private readonly theta = new Float64Array(MAX_VORTEX_BALLS);
  private readonly L = new Float64Array(MAX_VORTEX_BALLS);
  private readonly entryAt = new Float64Array(MAX_VORTEX_BALLS);
  private readonly enteredAtMs = new Float64Array(MAX_VORTEX_BALLS);
  private readonly speedFactor = new Float64Array(MAX_VORTEX_BALLS);
  private readonly entryAngle = new Float64Array(MAX_VORTEX_BALLS);
  private readonly ballId = new Int32Array(MAX_VORTEX_BALLS).fill(-1);
  private readonly slotOfId = new Map<number, number>();
  /** The first entry angle of the run (the seed's) and the entry angle of the last ball in. */
  private phase = 0;
  private lastAngle = 0;
  /** Rings crossed (and pews due) during the current step, voiced in `onPostUpdate()`. */
  private readonly stepRings = new Uint8Array(MAX_VORTEX_RINGS);
  private stepRingCount = 0;
  /** Where (the angle) a ring was last crossed this step: the reactive background's flash. */
  private stepAngle = 0;
  private stepPews = 0;
  /** Balls swallowed during the current step (their engine ids), removed from the engine at its end. */
  private readonly swallowedIds: number[] = [];
  private readonly state: SpiralState = { r: 0, vr: 0, theta: 0, L: 0 };

  getSettings(): VortexSettings {
    return this.settings;
  }
  /** Balls, stagger, rings, duration, pull and loop apply on the next init; the depth cue, scale and root at once. */
  setSettings(patch: Partial<VortexSettings>) {
    this.settings = resolveVortexSettings({ ...this.settings, ...patch });
    const live = this.view.settings;
    live.depthScale = this.settings.depthScale;
    live.scale = this.settings.scale;
    live.rootNote = this.settings.rootNote;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): VortexView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return {
      balls: v.slotCount,
      entered: v.entered,
      swallowed: v.swallowed,
      inFlight: v.inFlight,
      notes: v.notes,
      rings: v.field.ringCount,
      deepestRing: v.deepestRing,
      loop: v.settings.loop,
      tempo: v.tempo,
      allSwallowed: v.allSwallowed,
      finished: v.finished,
    };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    // The seed: the whirl direction, the run tempo and the first entry angle (per-ball draws follow as the balls enter).
    v.dir = ctx.random() < 0.5 ? -1 : 1;
    v.tempo = 1 + (ctx.random() - 0.5) * TEMPO_SPREAD;
    this.phase = ctx.random() * 2 * Math.PI;
    this.lastAngle = this.phase;
    this.clockMs = 0;
    this.stepStartMs = 0;
    this.stepRingCount = 0;
    this.stepRings.fill(0);
    this.stepPews = 0;
    this.swallowedIds.length = 0;
    this.slotOfId.clear();
    this.ballId.fill(-1);
    v.timeMs = 0;
    v.ringHitMs.fill(-Infinity);
    v.slotState.fill(WAITING);
    v.slotNoteMs.fill(-Infinity);
    v.slotRing.fill(0);
    v.slotCount = s.balls;
    v.splashMs.fill(-Infinity);
    v.splashCount = 0;
    v.entered = 0;
    v.swallowed = 0;
    v.notes = 0;
    v.chords = 0;
    v.deepestRing = -1;
    v.inFlight = 0;
    v.lastSwallowMs = -Infinity;
    v.allSwallowed = false;
    v.finished = false;
    v.finishedMs = -1;
    for (let i = 0; i < s.balls; i++) {
      this.entryAt[i] = i * s.stagger;
      v.slotColor[i] = vortexBallColor(i, ctx.config.ballColor);
    }
    this.layout(ctx.config.width, ctx.config.height);
    // The balls due at 0 s enter now (the first always: the engine then adds no default ball).
    for (let i = 0; i < s.balls; i++) if (this.entryAt[i] <= 1e-9) this.enter(ctx, i);
  }

  /** (Re)builds the funnel for the canvas size and the run's physics constants. */
  private layout(width: number, height: number) {
    const v = this.view;
    buildVortexField(width, height, this.settings.rings, v.field);
    v.circularSpeed = circularSpeed(v.field.rim, this.settings.gravity);
    v.spiralSec = this.settings.duration / v.tempo;
    v.drag = dragRate(v.field.entry, v.field.hole, v.spiralSec);
  }

  /** Slot `slot` enters at the rim: its seeded speed factor and angle are drawn, its ball is created. */
  private enter(ctx: ModeContext, slot: number) {
    const v = this.view;
    this.speedFactor[slot] = ENTRY_SPEED_MIN + (1 - ENTRY_SPEED_MIN) * ctx.random();
    const jitter = (ctx.random() - 0.5) * ENTRY_JITTER;
    const angle = v.entered === 0 ? this.phase : this.lastAngle + v.dir * 2 * Math.PI * ENTRY_TURN + jitter;
    this.lastAngle = angle;
    this.entryAngle[slot] = angle;
    this.enteredAtMs[slot] = this.clockMs;
    this.placeEntry(slot);
    const cfg = ctx.config;
    const radius = cfg.ballRadius || 8;
    ctx.addBall({ x: v.slotX[slot], y: v.slotY[slot], vx: 0, vy: 0, radius, radiusScale: 1, color: v.slotColor[slot], gravityScale: 0 });
    const id = ctx.getNextId() - 1;
    this.ballId[slot] = id;
    this.slotOfId.set(id, slot);
    v.slotState[slot] = FLYING;
    v.slotRing[slot] = 0;
    v.entered++;
    v.inFlight++;
    const balls = ctx.getBalls();
    const ball = balls[balls.length - 1];
    if (ball && ball.id === id) this.place(ctx, ball, slot);
  }

  /** The polar state of a ball just entering slot `slot`, from its seeded draws and the current funnel. */
  private placeEntry(slot: number) {
    const v = this.view;
    const f = v.field;
    this.r[slot] = f.entry;
    this.vr[slot] = -v.drag * f.entry;
    this.theta[slot] = this.entryAngle[slot];
    this.L[slot] = f.entry * v.circularSpeed * this.speedFactor[slot];
    v.slotR[slot] = f.entry;
    v.slotTheta[slot] = this.entryAngle[slot];
    v.slotX[slot] = f.cx + f.entry * Math.cos(this.entryAngle[slot]);
    v.slotY[slot] = f.cy + f.entry * Math.sin(this.entryAngle[slot]);
  }

  /** Writes slot `slot`'s polar state into its ball: position, velocity (the eyes look along it) and the depth-scaled size. */
  private place(ctx: ModeContext, ball: Ball, slot: number) {
    const v = this.view;
    const f = v.field;
    const r = this.r[slot];
    const th = this.theta[slot];
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const vt = (v.dir * this.L[slot]) / r;
    ball.x = f.cx + r * c;
    ball.y = f.cy + r * sn;
    ball.vx = this.vr[slot] * c - vt * sn;
    ball.vy = this.vr[slot] * sn + vt * c;
    const scale = depthRadiusScale(vortexDepth(f, r), v.settings.depthScale);
    ball.radiusScale = scale;
    ball.radius = (ctx.config.ballRadius || 8) * scale;
    // The first ball wears the Ball Colour (it follows a change), the others keep their palette colour.
    if (slot === 0) v.slotColor[0] = ctx.config.ballColor || "#ffffff";
    ball.color = v.slotColor[slot];
    v.slotR[slot] = r;
    v.slotTheta[slot] = th;
    v.slotX[slot] = ball.x;
    v.slotY[slot] = ball.y;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepStartMs = this.clockMs;
    this.clockMs += dtMs;
    this.view.timeMs = this.clockMs;
    // Balls due by the start of this step enter now (the loop's respawns too).
    const v = this.view;
    const startSec = this.stepStartMs / 1000 + 1e-9;
    for (let i = 0; i < v.slotCount; i++) if (v.slotState[i] === WAITING && this.entryAt[i] <= startSec) this.enter(ctx, i);
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const slot = this.slotOfId.get(ball.id);
    const v = this.view;
    if (slot === undefined || v.slotState[slot] !== FLYING) return;
    const st = this.state;
    st.r = this.r[slot];
    st.vr = this.vr[slot];
    st.theta = this.theta[slot];
    st.L = this.L[slot];
    stepSpiral(st, dtSec, v.circularSpeed, v.drag, v.dir);
    this.r[slot] = st.r;
    this.vr[slot] = st.vr;
    this.theta[slot] = st.theta;
    this.L[slot] = st.L;
    this.place(ctx, ball, slot);
    // The rings it sank past: a note each (voiced at the end of the step).
    const f = v.field;
    const before = v.slotRing[slot];
    let next = before;
    while (next < f.ringCount && st.r < f.rings[next]) {
      if (this.stepRings[next] === 0) {
        this.stepRings[next] = 1;
        this.stepRingCount++;
      }
      v.ringHitMs[next] = this.clockMs;
      this.stepAngle = st.theta;
      v.notes++;
      if (next > v.deepestRing) v.deepestRing = next;
      next++;
    }
    if (next !== before) {
      v.slotRing[slot] = next;
      v.slotNoteMs[slot] = this.clockMs;
    }
    // The hole: pew, splash, gone (a ball somehow still out after MAX_FLIGHT_FACTOR spirals goes too).
    const overdue = this.clockMs - this.enteredAtMs[slot] > 1000 * MAX_FLIGHT_FACTOR * v.spiralSec;
    if (st.r <= f.hole || overdue) this.swallow(ctx, ball, slot);
  }

  /** Slot `slot`'s ball reached the hole: the splash is recorded, the pew queued, the ball leaves at the end of the step. */
  private swallow(ctx: ModeContext, ball: Ball, slot: number) {
    const v = this.view;
    v.slotState[slot] = SWALLOWED;
    v.swallowed++;
    v.inFlight--;
    v.lastSwallowMs = this.clockMs;
    const k = v.splashCount % MAX_SPLASHES;
    v.splashX[k] = ball.x;
    v.splashY[k] = ball.y;
    v.splashMs[k] = this.clockMs;
    v.splashColor[k] = v.slotColor[slot];
    v.splashCount++;
    this.stepPews++;
    this.swallowedIds.push(ball.id);
    this.slotOfId.delete(ball.id);
    this.ballId[slot] = -1;
    if (v.settings.loop) {
      // It comes back at the rim a moment later, as a new entry.
      v.slotState[slot] = WAITING;
      this.entryAt[slot] = this.clockMs / 1000 + RESPAWN_DELAY_SEC;
    } else if (v.swallowed >= v.slotCount) v.allSwallowed = true;
  }

  onPostSubStep() {}

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const s = v.settings;
    const f = v.field;
    // The ring notes of this step: one note, or the distinct rings crossed together as one chord (rising with depth).
    if (this.stepRingCount > 0) {
      let first = -1;
      let chord: number[] | null = null;
      for (let i = 0; i < f.ringCount; i++) {
        if (this.stepRings[i] === 0) continue;
        this.stepRings[i] = 0;
        if (first < 0) first = i;
        else {
          if (!chord) chord = [ringPitch(first, f.ringCount, s.scale, s.rootNote)];
          if (chord.length < MAX_RING_NOTES_PER_STEP) chord.push(ringPitch(i, f.ringCount, s.scale, s.rootNote));
        }
      }
      this.stepRingCount = 0;
      const event: SoundEvent = { type: "hit", wallIndex: first, frequency: ringPitch(first, f.ringCount, s.scale, s.rootNote) };
      if (chord) {
        event.chord = chord;
        v.chords++;
      }
      ctx.addPendingSoundEvent(event);
      // The reactive background flashes where the ring was crossed.
      ctx.addWallHit(first, this.stepAngle, f.rings[first]);
    }
    // The pews: a fast downward sweep from an octave above the innermost ring.
    if (this.stepPews > 0) {
      const pew = pewPitch(f.ringCount, s.scale, s.rootNote);
      for (let i = 0; i < Math.min(MAX_PEWS_PER_STEP, this.stepPews); i++) ctx.addPendingSoundEvent({ type: "hit", wallIndex: f.ringCount, frequency: pew, pew: true });
      this.stepPews = 0;
    }
    // The swallowed balls leave the engine.
    if (this.swallowedIds.length > 0) {
      const balls = ctx.getBalls();
      for (let i = balls.length - 1; i >= 0; i--) if (this.swallowedIds.includes(balls[i].id)) balls.splice(i, 1);
      this.swallowedIds.length = 0;
    }
    if (!v.finished && !s.loop && v.swallowed >= v.slotCount && this.clockMs >= v.lastSwallowMs + 1000 * SWALLOW_HOLD_SEC - 1e-6) {
      v.finished = true;
      v.finishedMs = this.clockMs;
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /**
   * A resize keeps the run: the funnel follows the canvas and every ball keeps its place in it (radius and speeds scaled).
   * Before the first step a ball that entered at 0 s is placed afresh from its seeded draws, exactly as an init at the new
   * size would place it (the seed finder builds its engine at the page's size: the same seed replays the same run).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const v = this.view;
    const oldRim = v.field.rim;
    this.layout(ctx.config.width, ctx.config.height);
    const k = oldRim > 0 ? v.field.rim / oldRim : 1;
    const fresh = this.clockMs === 0;
    for (const ball of ctx.getBalls()) {
      const slot = this.slotOfId.get(ball.id);
      if (slot === undefined || v.slotState[slot] !== FLYING) continue;
      if (fresh) this.placeEntry(slot);
      else {
        this.r[slot] *= k;
        this.vr[slot] *= k;
        this.L[slot] *= k * k;
      }
      this.place(ctx, ball, slot);
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
    return true;
  }
  /** There are no engine rings: the funnel is the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { balls: v.slotCount, entered: v.entered, swallowed: v.swallowed, notes: v.notes, deepestRing: v.deepestRing, finished: v.finished };
  }
}
