import { SCALE_INTERVALS, isScaleId, midiToFrequency, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import { circleObstacle, resolveBallCircle, segmentBetween, type CircleObstacle, type Obstacle } from "../obstacles";
import type { Ball, GameMode, ModeContext, ObstacleHitResult, SoundEvent } from "../types";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * Bullseye ("bullseye" mode, feature gerald-bullseye – the geraldbounces "bulleye!!" clips). No rings to escape: a portrait
 * playfield with a concentric scoring target – 3–10 rings in dartboard colours, seen in perspective like a board lying
 * on the floor – at the bottom. Balls are launched from the top one after another (`shots`, `interval` seconds apart)
 * through a short field of pegs and bumpers (`chaos` 0–1 decides how many of the candidate deflectors are in play) and
 * land on the target: the ring a ball lands in scores (10 for the centre, down to about 1 for the outermost ring, 0 off
 * the target), with a score popup and a running total. A centre hit is a "BULLSEYE!" – confetti, a fanfare and half a
 * second of slow motion. Landed balls stick where they land and become small obstacles, so later shots can be deflected
 * by earlier ones (a ball that comes to rest on them sticks there, scored by the ring under it; one perched on a peg is
 * nudged off, a long pinball rally tires and a weak gravity is topped up, so no ball ever sticks in mid-air). With `moving` the
 * target slides left and right, carrying the balls stuck in it. The run finishes `FINAL_HOLD_MS` after the last landing
 * – the final banner shows the total and the best shot.
 *
 * Physics: the balls are ordinary engine balls under the engine's gravity, bouncing off the mode's obstacles (the side
 * walls, pegs and bumpers of `buildBullseyeLayout()`, see ../obstacles.ts); the mode resolves them against the stuck
 * balls itself (`resolveBallCircle()` against its own circle obstacles, so a stuck ball never pushes itself), detects
 * the landing and pins the stuck balls. The flying balls pass through each other (`ballsPassThrough`) and may rest
 * (`ballsMayRest`: no slow-ball boost).
 *
 * Slow motion is part of the physics, so it is deterministic and every export gets it: the mode runs a world clock that
 * advances at `timeScale` × the simulation clock, and while the scale is below 1 every flying ball's velocity is scaled
 * by it and its gravity by its square (a ballistic path traversed at `timeScale` speed – the same path, slower). The
 * launch schedule, the moving target and every animation follow the world clock.
 *
 * Rigging hook: `perfect` (1-based shot number, 0 = off) makes the director steer that shot into the bull: it is aimed
 * at a free spot of the bull, steered gently while it bounces through the deflectors (a lateral acceleration of at most
 * `STEER_ACCEL` × g toward the velocity that lands it there) and exactly once it is below them; it flies through the
 * stuck balls and, should the bull be full, stacks on them. It always scores 10, deterministically for a seed.
 *
 * Randomness: `init()` draws everything from `ctx.random()` up front – the deflector selection's salt, the moving
 * target's phase and per shot the launch jitter and the aim – so a seed replays identically and Find Simulation works
 * (the run length moves with the last shot's flight and the slow motions of the bullseyes).
 */

/* ------------------------------------------------------------------ settings */

export interface BullseyeSettings {
  /** Balls launched, 1–30. */
  shots: number;
  /** Seconds between two launches (world time), 0.3–4. */
  interval: number;
  /** 0–1: how many of the candidate pegs and bumpers are in play (0 = a clear shot). */
  chaos: number;
  /** Scoring rings of the target, 3–10. */
  rings: number;
  /** The target slides left and right. */
  moving: boolean;
  /** Rigging: the shot (1-based) the director steers into the bull; 0 = off. */
  perfect: number;
  /** The Sound section's scale and root: the peg notes and the thuds follow them (live). */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_BULLSEYE_SETTINGS: BullseyeSettings = {
  shots: 12,
  interval: 2.2,
  chaos: 0.5,
  rings: 10,
  moving: false,
  perfect: 0,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const BULLSEYE_RANGES = {
  byShots: { min: 1, max: 30, step: 1 },
  byInterval: { min: 0.3, max: 4, step: 0.1 },
  byChaos: { min: 0, max: 1, step: 0.05 },
  byRings: { min: 3, max: 10, step: 1 },
  byPerfect: { min: 0, max: 30, step: 1 },
} as const;

/** The Bullseye fields of the SimulatorSettings object (URL keys bys, byi, byc, byr, bym, byp). */
export interface BullseyeFields {
  byShots: number;
  byInterval: number;
  byChaos: number;
  byRings: number;
  byTargetMoving: boolean;
  byPerfect: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Rounds onto a slider's step, two decimals at most. */
function onStep(value: number, step: number) {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** Fills in the defaults and clamps every value onto its slider (counts whole, the rest on their steps); bad values fall back to the defaults. */
export function resolveBullseyeSettings(config: Partial<BullseyeSettings> | null | undefined, unlimited = false): BullseyeSettings {
  const out = { ...DEFAULT_BULLSEYE_SETTINGS };
  if (!config) return out;
  const R = rangesFor(BULLSEYE_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (config.shots !== undefined) out.shots = Math.round(clampNumber(config.shots, R.byShots, out.shots));
  if (config.interval !== undefined) out.interval = onStep(clampNumber(config.interval, R.byInterval, out.interval), R.byInterval.step);
  if (config.chaos !== undefined) out.chaos = onStep(clampNumber(config.chaos, R.byChaos, out.chaos), R.byChaos.step);
  if (config.rings !== undefined) out.rings = Math.round(clampNumber(config.rings, R.byRings, out.rings));
  if (typeof config.moving === "boolean") out.moving = config.moving;
  if (config.perfect !== undefined) out.perfect = Math.round(clampNumber(config.perfect, R.byPerfect, out.perfect));
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** Picks the Bullseye settings (and the Sound section's scale and root) out of a bigger object for `engine.setBullseyeSettings()`. */
export function bullseyeSettingsOf(source: BullseyeFields & { scale?: ScaleId; rootNote?: number }): BullseyeSettings {
  return {
    shots: source.byShots,
    interval: source.byInterval,
    chaos: source.byChaos,
    rings: source.byRings,
    moving: source.byTargetMoving,
    perfect: source.byPerfect,
    scale: source.scale ?? DEFAULT_BULLSEYE_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_BULLSEYE_SETTINGS.rootNote,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function bullseyeSettingFields(settings: BullseyeSettings): BullseyeFields {
  return {
    byShots: settings.shots,
    byInterval: settings.interval,
    byChaos: settings.chaos,
    byRings: settings.rings,
    byTargetMoving: settings.moving,
    byPerfect: settings.perfect,
  };
}

/** The defaults of the feature's fields. */
export function defaultBullseyeFields(): BullseyeFields {
  return bullseyeSettingFields(DEFAULT_BULLSEYE_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers on their steps, a real boolean. */
export function resolveBullseyeFields(source: Partial<BullseyeFields>): BullseyeFields {
  return bullseyeSettingFields(
    resolveBullseyeSettings({
      shots: source.byShots,
      interval: source.byInterval,
      chaos: source.byChaos,
      rings: source.byRings,
      moving: source.byTargetMoving,
      perfect: source.byPerfect,
    }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { bys: "byShots", byi: "byInterval", byc: "byChaos", byr: "byRings", byp: "byPerfect" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: bys, byi, byc, byr, bym and byp. */
export function writeBullseyeParams(settings: BullseyeFields, base: BullseyeFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.byTargetMoving !== base.byTargetMoving) params.set("bym", settings.byTargetMoving ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readBullseyeParams(params: URLSearchParams, settings: BullseyeFields) {
  const next: Partial<BullseyeFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const moving = params.get("bym");
  if (moving === "1") next.byTargetMoving = true;
  else if (moving === "0") next.byTargetMoving = false;
  Object.assign(settings, resolveBullseyeFields(next));
}

/** The shot (0-based) the director steers into the bull, or −1 (off, or beyond the last shot). */
export function perfectShotIndex(settings: Pick<BullseyeSettings, "perfect" | "shots">): number {
  return settings.perfect >= 1 && settings.perfect <= settings.shots ? settings.perfect - 1 : -1;
}

/* ------------------------------------------------------------------ scoring geometry */

/** Most scoring rings (the view's arrays are allocated at this size). */
export const MAX_BULLSEYE_RINGS = 10;

/** Score of ring `ring` (0 = the bull) of `rings`: 10 for the bull down to about 1 for the outermost ring; 0 off the target. */
export function ringScore(ring: number, rings: number): number {
  if (!(ring >= 0) || ring >= rings) return 0;
  return Math.max(1, Math.round((10 * (rings - ring)) / rings));
}

/**
 * The ring a landing `dx` px from the target's centre falls in – the rings are `radius / rings` wide, the bull is ring 0
 * – or −1 off the target (a landing exactly on the rim still counts).
 */
export function ringAt(dx: number, radius: number, rings: number): number {
  const d = Math.abs(dx);
  if (!(radius > 0) || !(d <= radius)) return -1;
  return Math.min(rings - 1, Math.floor((d / radius) * rings));
}

/** Score of a landing `dx` px from the target's centre. */
export function scoreAt(dx: number, radius: number, rings: number): number {
  return ringScore(ringAt(dx, radius, rings), rings);
}

/** Half-width of the bull (px) of a target of `radius` with `rings` rings. */
export function bullHalfWidth(radius: number, rings: number): number {
  return radius / Math.max(1, rings);
}

/** Seconds the moving target takes for one sweep left, right and back. */
export const TARGET_PERIOD_SEC = 3.2;

/** Offset (px) of the moving target from the middle of the field at world time `worldSec`; 0 when it does not move. */
export function targetOffset(amplitude: number, worldSec: number, phase: number, moving: boolean): number {
  return moving ? amplitude * Math.sin((2 * Math.PI * worldSec) / TARGET_PERIOD_SEC + phase) : 0;
}

/** Velocity (world px/s) of the moving target at world time `worldSec`. */
export function targetVelocity(amplitude: number, worldSec: number, phase: number, moving: boolean): number {
  const w = (2 * Math.PI) / TARGET_PERIOD_SEC;
  return moving ? amplitude * w * Math.cos(w * worldSec + phase) : 0;
}

/* ------------------------------------------------------------------ layout */

/**
 * Target radius as a fraction of the field width (a smaller target when it moves, so it has room to slide), the
 * perspective squash of its ellipse and the launcher's place.
 */
export const TARGET_AT = 0.4;
export const MOVING_TARGET_AT = 0.32;
export const TARGET_TILT = 0.22;
export const LAUNCH_AT = 0.07;
/** The deflector band, as fractions of the field height from its top. */
export const BAND_TOP_AT = 0.22;
export const BAND_BOTTOM_AT = 0.58;
/** Rows of candidate deflectors (every other one staggered); in the staggered rows every other candidate is a bumper. */
export const DEFLECTOR_ROWS = 5;
export const PEG_RESTITUTION = 0.5;
export const BUMPER_RESTITUTION = 0.75;
export const WALL_RESTITUTION = 0.55;
/** A stuck ball as an obstacle: a soft rebound – and a ball that drops onto one slower than `STICK_SPEED` (world px/s) sticks to it. */
export const STUCK_RESTITUTION = 0.45;
export const STICK_SPEED = 90;
/** Extra sideways speed (world px/s) a bumper kicks a ball away from its crown with. */
export const BUMPER_KICK = 35;

/** What an obstacle of the layout is (`BullseyeLayout.kinds`). */
export const KIND_WALL = 0;
export const KIND_PEG = 1;
export const KIND_BUMPER = 2;

export interface BullseyeLayout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  fieldWidth: number;
  fieldHeight: number;
  /** Middle of the field. */
  cx: number;
  /** The landing line: the target's centre line (its ellipse is drawn around it). */
  floorY: number;
  targetRadius: number;
  /** Vertical semi-axis of the target's ellipse (perspective). */
  targetDepth: number;
  /** How far the moving target slides each way (px). */
  amplitude: number;
  launchX: number;
  launchY: number;
  bandTop: number;
  bandBottom: number;
  pegRadius: number;
  bumperRadius: number;
  /** Candidate deflectors and how many of them are in play. */
  candidates: number;
  deflectors: number;
  /** The side walls first, then the deflectors in play. */
  obstacles: Obstacle[];
  /** Per obstacle: KIND_WALL, KIND_PEG or KIND_BUMPER, and the note slot (0 = the field's left edge, one per half column). */
  kinds: Uint8Array;
  slots: Int16Array;
  /** The ball radius the layout was built for. */
  ballRadius: number;
}

/** A tiny integer hash → [0, 1): the key that orders the candidate deflectors for a seed's salt. */
export function hash01(salt: number, a: number, b: number): number {
  let h = (salt ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * Lays out the playfield for a canvas of `width` × `height`: a portrait field that uses the full height and fits the
 * centred square the recorder crops to (like Ball Drop), the target at the bottom, the launcher at the top and between
 * them `DEFLECTOR_ROWS` staggered rows of candidate pegs and bumpers spaced for the ball size. `chaos` keeps that
 * fraction of them – the ones with the lowest `hash01(salt, row, column)` –, so a seed picks its own field and a layout
 * rebuilt at another size (or ball size) keeps the same choice.
 */
export function buildBullseyeLayout(width: number, height: number, ballRadius: number, chaos: number, salt: number, moving = false): BullseyeLayout {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const fieldHeight = Math.max(60, height - 2 * margin);
  const fieldWidth = Math.max(60, Math.min(width - 2 * margin, 0.82 * fieldHeight));
  const left = (width - fieldWidth) / 2;
  const right = left + fieldWidth;
  const top = margin;
  const bottom = top + fieldHeight;
  const cx = (left + right) / 2;
  const r = Math.max(2, ballRadius);
  const targetRadius = (moving ? MOVING_TARGET_AT : TARGET_AT) * fieldWidth;
  const targetDepth = TARGET_TILT * targetRadius;
  const floorY = bottom - targetDepth - 0.025 * fieldHeight;
  const amplitude = Math.max(0, fieldWidth / 2 - targetRadius - 1.2 * r - 2);
  const bandTop = top + BAND_TOP_AT * fieldHeight;
  const bandBottom = top + BAND_BOTTOM_AT * fieldHeight;
  const pegRadius = Math.max(3, Math.min(7, 0.012 * fieldHeight));
  const bumperRadius = Math.max(pegRadius + 3, Math.min(16, 0.026 * fieldHeight));
  // Openings wide enough for the ball between two pegs and past a bumper.
  const columnGap = Math.max(44, 5 * r + 2 * bumperRadius);
  const cols = Math.max(2, Math.floor(fieldWidth / columnGap));
  const spacing = fieldWidth / cols;
  const rowGap = (bandBottom - bandTop) / (DEFLECTOR_ROWS - 1);

  const obstacles: Obstacle[] = [];
  const kinds: number[] = [];
  const slots: number[] = [];
  // The side walls run from well above the top (a ball kicked up never leaves) down past the landing line.
  const wallTop = top - height;
  obstacles.push(segmentBetween(left, wallTop, left, bottom, { restitution: WALL_RESTITUTION }));
  kinds.push(KIND_WALL);
  slots.push(0);
  obstacles.push(segmentBetween(right, wallTop, right, bottom, { restitution: WALL_RESTITUTION }));
  kinds.push(KIND_WALL);
  slots.push(2 * cols);

  const candidates: { key: number; x: number; y: number; kind: number; slot: number }[] = [];
  for (let row = 0; row < DEFLECTOR_ROWS; row++) {
    const staggered = row % 2 === 1;
    const count = staggered ? cols - 1 : cols;
    const y = bandTop + row * rowGap;
    for (let j = 0; j < count; j++) {
      const slot = staggered ? 2 * (j + 1) : 2 * j + 1;
      const x = left + (slot * spacing) / 2;
      const kind = staggered && j % 2 === 0 ? KIND_BUMPER : KIND_PEG;
      candidates.push({ key: hash01(salt, row, j), x, y, kind, slot });
    }
  }
  const keep = Math.round(Math.max(0, Math.min(1, chaos)) * candidates.length);
  const chosen = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.key - b.c.key || a.i - b.i)
    .slice(0, keep)
    .sort((a, b) => a.i - b.i);
  for (const { c } of chosen) {
    const radius = c.kind === KIND_BUMPER ? bumperRadius : pegRadius;
    obstacles.push(circleObstacle(c.x, c.y, radius, { restitution: c.kind === KIND_BUMPER ? BUMPER_RESTITUTION : PEG_RESTITUTION }));
    kinds.push(c.kind);
    slots.push(c.slot);
  }
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    fieldWidth,
    fieldHeight,
    cx,
    floorY,
    targetRadius,
    targetDepth,
    amplitude,
    launchX: cx,
    launchY: top + LAUNCH_AT * fieldHeight,
    bandTop,
    bandBottom,
    pegRadius,
    bumperRadius,
    candidates: candidates.length,
    deflectors: chosen.length,
    obstacles,
    kinds: Uint8Array.from(kinds),
    slots: Int16Array.from(slots),
    ballRadius: r,
  };
}

/* ------------------------------------------------------------------ flight maths */

/**
 * Seconds until a ball at height `y` moving down at `vy` (px/s, positive = down) under gravity `g` (px/s²) reaches
 * `floorY`; Infinity when it never does (no gravity and moving up or still).
 */
export function timeToFloor(y: number, vy: number, floorY: number, g: number): number {
  const d = floorY - y;
  if (d <= 0) return 0;
  if (g > 1e-6) return (-vy + Math.sqrt(vy * vy + 2 * g * d)) / g;
  return vy > 1e-6 ? d / vy : Infinity;
}

/**
 * The director's steering of the perfect shot (world units): the horizontal velocity that takes the ball from `x` to
 * `goalX` in `tRemain` seconds, reached at once (`exact`, below the deflectors) or by at most `maxDelta` px/s this
 * sub-step (among them, so the pegs still bounce it around naturally).
 */
export function steerVx(x: number, vx: number, goalX: number, tRemain: number, maxDelta: number, exact: boolean): number {
  if (!(tRemain > 1e-4) || !Number.isFinite(tRemain)) return vx;
  const need = (goalX - x) / tRemain;
  if (exact) return need;
  const delta = need - vx;
  return vx + Math.max(-maxDelta, Math.min(maxDelta, delta));
}

/* ------------------------------------------------------------------ slow motion */

/** Simulation ms of slow motion after a bullseye, its time scale and the ramps into and out of it. */
export const SLOW_MO_MS = 500;
export const SLOW_MO_FACTOR = 0.3;
export const SLOW_MO_RAMP_IN_MS = 60;
export const SLOW_MO_RAMP_OUT_MS = 140;

/** The world clock's speed `sinceMs` simulation ms after a bullseye (1 outside the window). */
export function slowMoScale(sinceMs: number): number {
  if (!(sinceMs >= 0) || sinceMs >= SLOW_MO_MS) return 1;
  if (sinceMs < SLOW_MO_RAMP_IN_MS) return 1 + (SLOW_MO_FACTOR - 1) * (sinceMs / SLOW_MO_RAMP_IN_MS);
  const out = SLOW_MO_MS - SLOW_MO_RAMP_OUT_MS;
  if (sinceMs > out) return SLOW_MO_FACTOR + (1 - SLOW_MO_FACTOR) * ((sinceMs - out) / SLOW_MO_RAMP_OUT_MS);
  return SLOW_MO_FACTOR;
}

/* ------------------------------------------------------------------ sound */

/** The degrees the pegs and thuds climb: the chosen scale, or a diatonic major scale while the Sound section is chromatic. */
export function bullseyeScale(scale: ScaleId): readonly number[] {
  return scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[scale];
}

function degreeMidi(base: number, degree: number, scale: ScaleId, rootNote: number): number {
  const steps = bullseyeScale(scale);
  const n = steps.length;
  const d = Math.max(0, Math.round(degree));
  return base + normalizeRootNote(rootNote) + 12 * Math.floor(d / n) + steps[d % n];
}

/** Pitch (Hz) of a deflector in note slot `slot` (0 = the field's left edge): a keyboard from C4 on the left upwards. */
export function pegPitch(slot: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(60, slot, scale, rootNote));
}

/** Pitch (Hz) of a stuck ball being hit: a high tick two octaves above the keyboard's start. */
export function stuckPitch(scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(84, 4, scale, rootNote));
}

/** Pitch (Hz) of the landing thud of a `score`-point landing (0 = off the target): degree `score` of the scale from C2. */
export function thudPitch(score: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(36, Math.max(0, Math.min(10, score)), scale, rootNote));
}

/** Root (Hz) of the bullseye fanfare: C5 on the root note. */
export function fanfareRoot(rootNote: number): number {
  return midiToFrequency(72 + normalizeRootNote(rootNote));
}

/** Most peg / stuck-ball notes one 60 Hz step queues (the rest still bounce and glow). */
export const MAX_NOTES_PER_STEP = 6;

/* ------------------------------------------------------------------ run length */

/** Most shots (the view's arrays are allocated once at this size). */
export const MAX_BULLSEYE_SHOTS = 30;
/** Simulation ms the final banner holds after the last landing before the run finishes. */
export const FINAL_HOLD_MS = 2500;
/**
 * A flying ball slower than this (world px/s) for `REST_MS` of world time is at rest: on stuck balls it sticks there; perched
 * on a peg or a bumper it is nudged off sideways (`PERCH_KICK` world px/s toward the middle) – the perfect shot always, the
 * others up to `MAX_PERCHES` times before they stick where they are.
 */
export const REST_SPEED = 14;
export const REST_MS = 350;
export const PERCH_KICK = 45;
export const MAX_PERCHES = 3;
/** Among the deflectors the director steers the perfect shot only while it moves at least this fast (world px/s), so it never balances it on a peg. */
export const STEER_MIN_SPEED = 60;
/** A ball still flying after this long (world ms) sticks where it is (a safety net). */
export const MAX_FLIGHT_MS = 12000;
/**
 * A ball that has been bouncing among the deflectors for this long (world ms) tires: every further peg or bumper hit keeps
 * only `TIRED_DAMPING` of its speed (and bumpers no longer kick), so a pinball rally in a tall field still comes down.
 */
export const TIRED_MS = 4000;
export const TIRED_DAMPING = 0.5;
/** Gravity (world px/s²) the flights get at least – without it a ball kicked upward would never come down. */
export const MIN_GRAVITY = 120;

/** A typical flight from the launcher to the target at the default gravity (s). */
export const TYPICAL_FLIGHT_SEC = 1.6;

/**
 * About how long a run lasts (s) at the default gravity on a desktop canvas: the last launch, a typical flight and the
 * final hold (the seed moves it by the last shot's flight and the bullseyes' slow motion).
 */
export function bullseyeNominalRunSec(settings: Partial<BullseyeSettings> | null | undefined, unlimited = false): number {
  const s = resolveBullseyeSettings(settings, unlimited); // --- unlimited --- (as the mode resolves them)
  return (s.shots - 1) * s.interval + TYPICAL_FLIGHT_SEC + FINAL_HOLD_MS / 1000;
}

/* ------------------------------------------------------------------ aim */

/** Launch jitter (fraction of the field width, each way) and the aim spread (fraction of the field width, each way). */
export const LAUNCH_JITTER = 0.04;
export const AIM_SPREAD = 0.42;
/** Launch speed (downwards) as a fraction of the Ball Speed, and at least this many px/s (a ball is never "at rest" at the launcher). */
export const LAUNCH_SPEED = 0.25;
export const MIN_LAUNCH_SPEED = 40;
/** The director's lateral acceleration among the deflectors, as a multiple of the gravity. */
export const STEER_ACCEL = 1.2;
/** Where the director aims the perfect shot inside the bull: offsets as fractions of the bull's half-width, best first. */
export const PERFECT_SPOTS = [0, 0.4, -0.4, 0.75, -0.75];

/* ------------------------------------------------------------------ view */

/** Colour of shot `k`: the first wears the Ball Colour (Gerald), the others a palette. */
export const BULLSEYE_BALL_COLORS = ["#ffffff", "#ffb238", "#2de2e6", "#ff5d73", "#b388ff", "#5dffb0", "#f7f052", "#4d9dff", "#ff7ad9", "#c6ff5d"];

export function bullseyeBallColor(shot: number, ballColor: string): string {
  if (shot === 0) return ballColor || "#ffffff";
  return BULLSEYE_BALL_COLORS[1 + ((shot - 1) % (BULLSEYE_BALL_COLORS.length - 1))];
}

/** A shot's state (`BullseyeView.shotState`). */
export const SHOT_WAITING = 0;
export const SHOT_FLYING = 1;
export const SHOT_LANDED = 2;

export interface BullseyeView {
  settings: BullseyeSettings;
  layout: BullseyeLayout | null;
  /** The world clock (ms) – slowed during slow motion; every animation runs on it – and the simulation clock (ms). */
  timeMs: number;
  simMs: number;
  /** The target's centre (px) and velocity (world px/s) now. */
  targetX: number;
  targetVx: number;
  /** The world clock's speed now (1, or less in slow motion), slow-motion windows so far and when the last one started (simulation ms). */
  timeScale: number;
  slowMos: number;
  slowStartMs: number;
  /** The perfect shot (0-based) or −1. */
  perfectShot: number;
  /** Counters. */
  shots: number;
  launched: number;
  landed: number;
  total: number;
  bullseyes: number;
  /** The best shot (0-based, −1 before the first landing) and its score. */
  bestShot: number;
  best: number;
  lastShot: number;
  lastScore: number;
  lastRing: number;
  /** Peg / bumper / stuck-ball notes and landing thuds queued. */
  notes: number;
  thuds: number;
  /** Per shot: state, colour, launch time (world ms), landing place, landing time (world ms), ring and score (−1 before landing). */
  shotState: Uint8Array;
  shotColor: string[];
  shotLaunchMs: Float64Array;
  shotX: Float64Array;
  shotY: Float64Array;
  shotLandMs: Float64Array;
  shotRing: Int8Array;
  shotScore: Int8Array;
  /** The launcher's aim for the next shot (radians, π/2 = straight down) and the last launch (world ms). */
  aimAngle: number;
  launchMs: number;
  /** Last time (world ms) each ring was hit, and the last bullseye's time (world ms) and place. */
  ringHitMs: Float64Array;
  bullseyeMs: number;
  bullseyeX: number;
  bullseyeY: number;
  /** Every shot has landed: the final banner shows through the hold before the end. */
  allLanded: boolean;
  finished: boolean;
  /** Simulation ms the run finished at (−1 while it has not). */
  finishedMs: number;
}

function createView(): BullseyeView {
  return {
    settings: { ...DEFAULT_BULLSEYE_SETTINGS },
    layout: null,
    timeMs: 0,
    simMs: 0,
    targetX: 0,
    targetVx: 0,
    timeScale: 1,
    slowMos: 0,
    slowStartMs: -Infinity,
    perfectShot: -1,
    shots: 0,
    launched: 0,
    landed: 0,
    total: 0,
    bullseyes: 0,
    bestShot: -1,
    best: 0,
    lastShot: -1,
    lastScore: -1,
    lastRing: -1,
    notes: 0,
    thuds: 0,
    shotState: new Uint8Array(MAX_BULLSEYE_SHOTS),
    shotColor: new Array<string>(MAX_BULLSEYE_SHOTS).fill("#ffffff"),
    shotLaunchMs: new Float64Array(MAX_BULLSEYE_SHOTS).fill(-Infinity),
    shotX: new Float64Array(MAX_BULLSEYE_SHOTS),
    shotY: new Float64Array(MAX_BULLSEYE_SHOTS),
    shotLandMs: new Float64Array(MAX_BULLSEYE_SHOTS).fill(-Infinity),
    shotRing: new Int8Array(MAX_BULLSEYE_SHOTS).fill(-1),
    shotScore: new Int8Array(MAX_BULLSEYE_SHOTS).fill(-1),
    aimAngle: Math.PI / 2,
    launchMs: -Infinity,
    ringHitMs: new Float64Array(MAX_BULLSEYE_RINGS).fill(-Infinity),
    bullseyeMs: -Infinity,
    bullseyeX: 0,
    bullseyeY: 0,
    allLanded: false,
    finished: false,
    finishedMs: -1,
  };
}

/* ------------------------------------------------------------------ the mode */

export class BullseyeMode implements GameMode {
  readonly name = "bullseye";
  /** Balls land and stick: no slow-ball boost. */
  readonly ballsMayRest = true;
  /** Flying balls pass through each other; the stuck ones are the mode's own obstacles. */
  readonly ballsPassThrough = true;
  private settings: BullseyeSettings = { ...DEFAULT_BULLSEYE_SETTINGS };
  /** --- unlimited --- No limits was on at the last `setSettings()` (the plans built from the settings resolve them the same way). */
  private unlimited = false;
  private readonly view: BullseyeView = createView();
  private layout: BullseyeLayout | null = null;
  /** The simulation clock (the sum of the fixed steps) and the world clock (slowed in slow motion), ms. */
  private clockMs = 0;
  private worldMs = 0;
  private timeScale = 1;
  /** The seed's draws: the deflector salt, the moving target's phase and per shot the launch jitter and aim (−1…1). */
  private salt = 0;
  private phase = 0;
  private jitter = new Float64Array(MAX_BULLSEYE_SHOTS);
  private aim = new Float64Array(MAX_BULLSEYE_SHOTS);
  /** Per shot: its engine ball id, the world ms it has been at rest, whether it rides the target and where it sticks. */
  private ballId = new Int32Array(MAX_BULLSEYE_SHOTS).fill(-1);
  private readonly slotOfId = new Map<number, number>();
  private restMs = new Float64Array(MAX_BULLSEYE_SHOTS);
  /** Per shot: the world ms it last touched a stuck ball, and how often it was nudged off a deflector it rested on. */
  private touchMs = new Float64Array(MAX_BULLSEYE_SHOTS);
  private perches = new Uint8Array(MAX_BULLSEYE_SHOTS);
  private onTarget = new Uint8Array(MAX_BULLSEYE_SHOTS);
  /** A stuck ball's offset from the target's centre (on the target) or the field's middle (off it), and its height above the floor beyond its radius. */
  private stuckDx = new Float64Array(MAX_BULLSEYE_SHOTS);
  private stuckLift = new Float64Array(MAX_BULLSEYE_SHOTS);
  /** The stuck balls as circle obstacles (the mode resolves the flying balls against them), in landing order. */
  private readonly stuck: CircleObstacle[] = [];
  private readonly stuckShot: number[] = [];
  /** The perfect shot's spot in the bull (px from the target's centre). */
  private perfectSpot = 0;
  private notesThisStep = 0;
  private lastLandMs = 0;

  getSettings(): BullseyeSettings {
    return this.settings;
  }
  /** Shots, interval, chaos, rings, the moving target and the perfect shot apply on the next init; the scale and root at once. */
  /** `unlimited`: No limits is on – the unlimited settings run past their sliders, up to their soft ceilings. */
  setSettings(patch: Partial<BullseyeSettings>, unlimited = false) {
    this.unlimited = unlimited; // --- unlimited ---
    this.settings = resolveBullseyeSettings({ ...this.settings, ...patch }, unlimited);
    this.view.settings.scale = this.settings.scale;
    this.view.settings.rootNote = this.settings.rootNote;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): BullseyeView {
    return this.view;
  }
  getLayout(): BullseyeLayout | null {
    return this.layout;
  }
  getProgress() {
    const v = this.view;
    return {
      shots: v.shots,
      launched: v.launched,
      landed: v.landed,
      total: v.total,
      best: v.best,
      bestShot: v.bestShot,
      bullseyes: v.bullseyes,
      slowMos: v.slowMos,
      perfectShot: v.perfectShot,
      allLanded: v.allLanded,
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
    // The seed, all up front: the deflectors, the target's phase, then per shot its launch jitter and its aim.
    this.salt = Math.floor(ctx.random() * 0x100000000) >>> 0;
    this.phase = ctx.random() * 2 * Math.PI;
    for (let k = 0; k < s.shots; k++) {
      this.jitter[k] = 2 * ctx.random() - 1;
      this.aim[k] = ctx.random() + ctx.random() - 1;
    }
    this.clockMs = 0;
    this.worldMs = 0;
    this.timeScale = 1;
    this.notesThisStep = 0;
    this.lastLandMs = 0;
    this.slotOfId.clear();
    this.ballId.fill(-1);
    this.restMs.fill(0);
    this.touchMs.fill(-Infinity);
    this.perches.fill(0);
    this.onTarget.fill(0);
    this.stuck.length = 0;
    this.stuckShot.length = 0;
    this.perfectSpot = 0;
    v.timeMs = 0;
    v.simMs = 0;
    v.timeScale = 1;
    v.slowMos = 0;
    v.slowStartMs = -Infinity;
    v.perfectShot = perfectShotIndex(s);
    v.shots = s.shots;
    v.launched = 0;
    v.landed = 0;
    v.total = 0;
    v.bullseyes = 0;
    v.bestShot = -1;
    v.best = 0;
    v.lastShot = -1;
    v.lastScore = -1;
    v.lastRing = -1;
    v.notes = 0;
    v.thuds = 0;
    this.ensureCapacity(s.shots, s.rings); // --- unlimited --- (more shots and rings than the slider's with No limits on)
    v.shotState.fill(SHOT_WAITING);
    v.shotLaunchMs.fill(-Infinity);
    v.shotLandMs.fill(-Infinity);
    v.shotRing.fill(-1);
    v.shotScore.fill(-1);
    for (let k = 0; k < s.shots; k++) v.shotColor[k] = bullseyeBallColor(k, ctx.config.ballColor);
    v.launchMs = -Infinity;
    v.ringHitMs.fill(-Infinity);
    v.bullseyeMs = -Infinity;
    v.allLanded = false;
    v.finished = false;
    v.finishedMs = -1;
    this.rebuild(ctx);
    this.updateTarget();
    // The first shot leaves at once (the engine then adds no default ball).
    this.launch(ctx, 0);
    this.updateAim(ctx);
  }

  /**
   * --- unlimited --- The per-shot and per-ring arrays hold `MAX_BULLSEYE_SHOTS` and `MAX_BULLSEYE_RINGS` (the sliders' ends);
   * a run with more (No limits) grows them once – the mode's and the view's alike – before it starts. Grow-only.
   */
  private ensureCapacity(shots: number, rings: number) {
    const v = this.view;
    if (shots > this.jitter.length) {
      const n = Math.ceil(shots);
      this.jitter = new Float64Array(n);
      this.aim = new Float64Array(n);
      this.ballId = new Int32Array(n).fill(-1);
      this.restMs = new Float64Array(n);
      this.touchMs = new Float64Array(n);
      this.perches = new Uint8Array(n);
      this.onTarget = new Uint8Array(n);
      this.stuckDx = new Float64Array(n);
      this.stuckLift = new Float64Array(n);
      v.shotState = new Uint8Array(n);
      v.shotColor = new Array<string>(n).fill("#ffffff");
      v.shotLaunchMs = new Float64Array(n).fill(-Infinity);
      v.shotX = new Float64Array(n);
      v.shotY = new Float64Array(n);
      v.shotLandMs = new Float64Array(n).fill(-Infinity);
      v.shotRing = new Int8Array(n).fill(-1);
      v.shotScore = new Int8Array(n).fill(-1);
    }
    if (rings > v.ringHitMs.length) v.ringHitMs = new Float64Array(Math.ceil(rings)).fill(-Infinity);
  }

  private rebuild(ctx: ModeContext) {
    this.layout = buildBullseyeLayout(ctx.config.width, ctx.config.height, ctx.config.ballRadius || 8, this.settings.chaos, this.salt, this.settings.moving);
    this.view.layout = this.layout;
    ctx.setObstacles(this.layout.obstacles);
  }

  private updateTarget() {
    const L = this.layout!;
    const sec = this.worldMs / 1000;
    this.view.targetX = L.cx + targetOffset(L.amplitude, sec, this.phase, this.settings.moving);
    this.view.targetVx = targetVelocity(L.amplitude, sec, this.phase, this.settings.moving);
  }

  /** The target's centre at world time `worldMs` + `aheadSec`. */
  private targetXAt(aheadSec: number) {
    const L = this.layout!;
    return L.cx + targetOffset(L.amplitude, this.worldMs / 1000 + aheadSec, this.phase, this.settings.moving);
  }

  /** Gravity on a ball of normal weight (world px/s²), as the engine applies it (without the music's boost). */
  private engineGravity(ctx: ModeContext) {
    return (ctx.config.gravity ?? 0) * ((ctx.config.ballSpeed || 400) / 300);
  }
  /** Gravity of a flight (world px/s²): the engine's, at least `MIN_GRAVITY` (the mode adds the difference). */
  private gravity(ctx: ModeContext) {
    return Math.max(MIN_GRAVITY, this.engineGravity(ctx));
  }

  /** Where shot `k` leaves the launcher and with which velocity (world units), from its seeded draws. */
  private launchState(ctx: ModeContext, k: number, out: { x: number; y: number; vx: number; vy: number }) {
    const L = this.layout!;
    const r = ctx.config.ballRadius || 8;
    out.x = L.launchX + this.jitter[k] * LAUNCH_JITTER * L.fieldWidth;
    out.y = L.launchY;
    out.vy = Math.max(MIN_LAUNCH_SPEED, LAUNCH_SPEED * (ctx.config.ballSpeed || 400));
    const t = timeToFloor(out.y, out.vy, L.floorY - r, this.gravity(ctx));
    let goal: number;
    if (k === this.view.perfectShot) {
      this.perfectSpot = this.freePerfectSpot(r);
      goal = this.targetXAt(Number.isFinite(t) ? t : 0) + this.perfectSpot;
    } else goal = L.cx + this.aim[k] * AIM_SPREAD * L.fieldWidth;
    goal = Math.max(L.left + r, Math.min(L.right - r, goal));
    out.vx = Number.isFinite(t) && t > 1e-3 ? (goal - out.x) / t : 0;
  }
  private readonly scratch = { x: 0, y: 0, vx: 0, vy: 0 };

  /** Shot `k` leaves the launcher. */
  private launch(ctx: ModeContext, k: number) {
    const v = this.view;
    const st = this.scratch;
    this.launchState(ctx, k, st);
    const ts = this.timeScale;
    ctx.addBall({
      x: st.x,
      y: st.y,
      vx: st.vx * ts,
      vy: st.vy * ts,
      radius: ctx.config.ballRadius || 8,
      radiusScale: 1,
      color: v.shotColor[k],
      gravityScale: ts * ts,
    });
    const id = ctx.getNextId() - 1;
    this.ballId[k] = id;
    this.slotOfId.set(id, k);
    this.restMs[k] = 0;
    v.shotState[k] = SHOT_FLYING;
    v.shotLaunchMs[k] = this.worldMs;
    v.launchMs = this.worldMs;
    v.launched++;
  }

  /** The launcher points along the next shot's launch (straight down once every shot is out). */
  private updateAim(ctx: ModeContext) {
    const v = this.view;
    if (v.launched >= v.shots) {
      v.aimAngle = Math.PI / 2;
      return;
    }
    const st = this.scratch;
    const keep = this.perfectSpot;
    this.launchState(ctx, v.launched, st);
    this.perfectSpot = keep;
    v.aimAngle = Math.atan2(st.vy, st.vx);
  }

  /** A spot of the bull (offset from its centre) no stuck ball takes – the bull's centre first –, or 0 when it is full. */
  private freePerfectSpot(r: number): number {
    const L = this.layout!;
    const half = bullHalfWidth(L.targetRadius, this.settings.rings);
    for (const f of PERFECT_SPOTS) {
      const spot = f * Math.max(0, half - 0.5);
      let free = true;
      for (let i = 0; i < this.stuck.length && free; i++) {
        const k = this.stuckShot[i];
        if (!this.onTarget[k] || this.stuckLift[k] > 0.5) continue;
        if (Math.abs(this.stuckDx[k] - spot) < r + this.stuck[i].radius) free = false;
      }
      if (free) return spot;
    }
    return 0;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    this.notesThisStep = 0;
    // A live change of the ball size re-spaces the deflectors and re-seats the stuck balls.
    if (this.layout && (ctx.config.ballRadius || 8) !== this.layout.ballRadius) {
      this.rebuild(ctx);
      this.reseat(ctx);
    }
    const stepStart = this.clockMs;
    this.clockMs += dtMs;
    // Slow motion: the world clock's speed for this step; flying balls follow the change of scale.
    const scale = slowMoScale(stepStart - v.slowStartMs);
    if (scale !== this.timeScale) this.rescale(ctx, scale);
    this.worldMs += dtMs * this.timeScale;
    v.timeMs = this.worldMs;
    v.simMs = this.clockMs;
    v.timeScale = this.timeScale;
    this.updateTarget();
    // The target carries its stuck balls.
    if (this.settings.moving) for (let i = 0; i < this.stuck.length; i++) this.placeStuck(this.stuckShot[i], i);
    // Shots due by now leave the launcher.
    let launched = false;
    while (v.launched < v.shots && this.worldMs + 1e-6 >= v.launched * this.settings.interval * 1000) {
      this.launch(ctx, v.launched);
      launched = true;
    }
    if (launched || v.launched < v.shots) this.updateAim(ctx);
  }

  /** The world clock changes speed from `timeScale` to `scale`: every flying ball's velocity and gravity follow. */
  private rescale(ctx: ModeContext, scale: number) {
    const ratio = scale / this.timeScale;
    for (const ball of ctx.getBalls()) {
      const k = this.slotOfId.get(ball.id);
      if (k === undefined || this.view.shotState[k] !== SHOT_FLYING) continue;
      ball.vx *= ratio;
      ball.vy *= ratio;
      ball.gravityScale = scale * scale;
    }
    this.timeScale = scale;
  }

  /** Puts stuck shot `k` (entry `i` of the stuck list) where it sticks: on the target it rides along. */
  private placeStuck(k: number, i: number) {
    const L = this.layout!;
    const o = this.stuck[i];
    o.x = (this.onTarget[k] ? this.view.targetX : L.cx) + this.stuckDx[k];
    o.y = L.floorY - o.radius - this.stuckLift[k];
    this.view.shotX[k] = o.x;
    this.view.shotY[k] = o.y;
  }

  /** After a rebuild (canvas or ball size): the stuck balls take their ball's size and sit on the new floor. */
  private reseat(ctx: ModeContext) {
    const r = ctx.config.ballRadius || 8;
    for (let i = 0; i < this.stuck.length; i++) {
      this.stuck[i].radius = r;
      this.placeStuck(this.stuckShot[i], i);
    }
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const k = this.slotOfId.get(ball.id);
    if (k === undefined) return;
    const v = this.view;
    const L = this.layout!;
    // The first shot wears the Ball Colour (it follows a change), the others keep their palette colour.
    if (k === 0) v.shotColor[0] = ctx.config.ballColor || "#ffffff";
    ball.color = v.shotColor[k];
    if (v.shotState[k] === SHOT_LANDED) {
      // Stuck: pinned to its place (riding the target), still.
      ball.x = v.shotX[k];
      ball.y = v.shotY[k];
      ball.vx = this.onTarget[k] && this.settings.moving ? v.targetVx * this.timeScale : 0;
      ball.vy = 0;
      ball.gravityScale = 0;
      return;
    }
    if (v.shotState[k] !== SHOT_FLYING) return;
    const perfect = k === v.perfectShot;
    // Weak (or no) gravity: the mode adds the rest of MIN_GRAVITY, so every flight comes down.
    const missing = MIN_GRAVITY - this.engineGravity(ctx);
    if (missing > 0) ball.vy += missing * dtSec * this.timeScale * this.timeScale;
    // Earlier shots stuck in the target deflect it (the perfect shot flies past them).
    if (!perfect) {
      const bounciness = ctx.getPhysicsExtras().wallBounciness;
      // --- bounce-math --- the ball's own bounciness on top (after the restitution cap), lifting at most to the ball speed × it
      const ballBounce = ball.restitution ?? 1;
      const lift = ballBounce > 1 ? (ctx.config.ballSpeed || 400) * bounciness * ballBounce * this.timeScale : Infinity;
      for (let i = 0; i < this.stuck.length; i++) {
        const o = this.stuck[i];
        const approach = Math.hypot(ball.vx, ball.vy) / this.timeScale;
        const impact = resolveBallCircle(ball, o, dtSec, bounciness, undefined, ballBounce, lift);
        if (impact < 0) continue;
        this.touchMs[k] = this.worldMs;
        // A slow drop onto a stuck ball sticks to it (a dart in a dart); a fast one is deflected.
        if (approach < STICK_SPEED && ball.y < o.y - 0.3 * (ball.radius + o.radius)) {
          this.land(ctx, ball, k);
          return;
        }
        if (impact >= 40 * this.timeScale) ctx.noteBounce?.(ball); // --- bounce-math --- a deflection off a stuck ball is a bounce
        if (impact >= 40 * this.timeScale && this.notesThisStep < MAX_NOTES_PER_STEP) {
          this.notesThisStep++;
          v.notes++;
          ctx.addPendingSoundEvent({ type: "hit", wallIndex: 2, frequency: stuckPitch(v.settings.scale, v.settings.rootNote), level: 0.6 });
        }
      }
    } else this.steer(ctx, ball, dtSec);
    // The landing line.
    if (ball.y + ball.radius >= L.floorY) this.land(ctx, ball, k);
  }

  /** The director at work on the perfect shot: toward its spot in the bull, gently among the deflectors, exactly below them. */
  private steer(ctx: ModeContext, ball: Ball, dtSec: number) {
    const L = this.layout!;
    const ts = this.timeScale;
    const g = this.gravity(ctx);
    const vyw = ball.vy / ts;
    const t = timeToFloor(ball.y, vyw, L.floorY - ball.radius, g);
    if (!Number.isFinite(t)) return;
    this.perfectSpot = this.freePerfectSpot(ball.radius);
    const goal = Math.max(L.left + ball.radius, Math.min(L.right - ball.radius, this.targetXAt(t) + this.perfectSpot));
    const among = ball.y - ball.radius < L.bandBottom + L.bumperRadius;
    // Among the deflectors a slow ball is left alone (steering it back over the peg under it would balance it there).
    if (among && Math.hypot(ball.vx, vyw * ts) / ts < STEER_MIN_SPEED) return;
    const maxDelta = STEER_ACCEL * Math.max(g, 200) * dtSec * ts;
    ball.vx = steerVx(ball.x, ball.vx / ts, goal, t, maxDelta, !among) * ts;
  }

  /** Shot `k`'s ball lands (or comes to rest): it sticks, scores by the ring under it, thuds – and maybe it is a bullseye. */
  private land(ctx: ModeContext, ball: Ball, k: number) {
    const v = this.view;
    const L = this.layout!;
    const s = v.settings;
    const r = ball.radius;
    let x = Math.max(L.left + r, Math.min(L.right - r, ball.x));
    let y = Math.min(ball.y, L.floorY - r);
    let ring = ringAt(x - v.targetX, L.targetRadius, s.rings);
    // The rigging's hard constraint: the perfect shot is in the bull, whatever happened on the way.
    if (k === v.perfectShot && ring !== 0) {
      const half = Math.max(0, bullHalfWidth(L.targetRadius, s.rings) - 0.5);
      x = v.targetX + Math.max(-half, Math.min(half, x - v.targetX));
      ring = 0;
    }
    // Landing on the floor where a stuck ball already sits (the perfect shot flies past them): stack on top.
    if (y >= L.floorY - r - 0.5) y = this.stackedY(x, y, r);
    const score = ringScore(ring, s.rings);
    ball.x = x;
    ball.y = y;
    ball.vx = 0;
    ball.vy = 0;
    ball.gravityScale = 0;
    v.shotState[k] = SHOT_LANDED;
    this.onTarget[k] = ring >= 0 ? 1 : 0;
    this.stuckDx[k] = x - (ring >= 0 ? v.targetX : L.cx);
    this.stuckLift[k] = Math.max(0, L.floorY - r - y);
    this.stuck.push(circleObstacle(x, y, r, { restitution: STUCK_RESTITUTION }));
    this.stuckShot.push(k);
    v.shotX[k] = x;
    v.shotY[k] = y;
    v.shotLandMs[k] = this.worldMs;
    v.shotRing[k] = ring;
    v.shotScore[k] = score;
    v.landed++;
    v.total += score;
    v.lastShot = k;
    v.lastScore = score;
    v.lastRing = ring;
    if (ring >= 0) v.ringHitMs[ring] = this.worldMs;
    // The best shot: the highest score, the one nearer the centre on a tie.
    if (v.bestShot < 0 || score > v.best || (score === v.best && ring >= 0 && Math.abs(this.stuckDx[k]) < Math.abs(this.stuckDx[v.bestShot]))) {
      v.bestShot = k;
      v.best = score;
    }
    // The thud, pitched by the ring (a louder one for the bull); the reactive background flashes.
    v.thuds++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: Math.max(0, ring), frequency: thudPitch(score, s.scale, s.rootNote), thud: true, level: ring === 0 ? 1 : 0.55 + 0.04 * score });
    ctx.addWallHit(Math.max(0, ring), Math.PI / 2, L.targetRadius);
    if (ring === 0) {
      v.bullseyes++;
      v.bullseyeMs = this.worldMs;
      v.bullseyeX = x;
      v.bullseyeY = y;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: fanfareRoot(s.rootNote), race: "fanfare" });
      ctx.spawnConfetti(x, y - 2 * r);
      // Slow motion: a new window, or – while one runs – held at its slowest a little longer.
      const since = this.clockMs - v.slowStartMs;
      if (since >= 0 && since < SLOW_MO_MS) v.slowStartMs = this.clockMs - SLOW_MO_RAMP_IN_MS;
      else {
        v.slowStartMs = this.clockMs;
        v.slowMos++;
      }
      ctx.noteImpact?.();
    }
    this.lastLandMs = this.clockMs;
    if (v.landed >= v.shots) v.allLanded = true;
  }

  /** The height a ball of radius `r` at `x` sits at when it lands among the stuck balls (on top of those under it). */
  private stackedY(x: number, y: number, r: number): number {
    let out = y;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const o of this.stuck) {
        const reach = r + o.radius;
        const dx = x - o.x;
        if (Math.abs(dx) >= reach) continue;
        const top = o.y - Math.sqrt(reach * reach - dx * dx);
        if (out > top + 1e-6) {
          out = top;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return out;
  }

  /** Safety net behind the walls: a ball shoved across a side wall is put back inside. */
  onPostSubStep(ctx: ModeContext) {
    const L = this.layout;
    if (!L) return;
    for (const ball of ctx.getBalls()) {
      if (ball.x < L.left) {
        ball.x = L.left + ball.radius;
        if (ball.vx < 0) ball.vx = -ball.vx * WALL_RESTITUTION;
      } else if (ball.x > L.right) {
        ball.x = L.right - ball.radius;
        if (ball.vx > 0) ball.vx = -ball.vx * WALL_RESTITUTION;
      }
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /** Pegs play the note of their slot (a keyboard from left to right), bumpers the same note accented with a kick; walls are silent. */
  onObstacleHit(ctx: ModeContext, ball: Ball, obstacle: Obstacle, index: number): ObstacleHitResult {
    const L = this.layout;
    const v = this.view;
    if (!L || index >= L.kinds.length) return { suppressSound: true };
    const kind = L.kinds[index];
    if (kind === KIND_WALL) return { suppressSound: true };
    const k = this.slotOfId.get(ball.id);
    const tired = k !== undefined && this.worldMs - v.shotLaunchMs[k] > TIRED_MS;
    if (tired) {
      ball.vx *= TIRED_DAMPING;
      ball.vy *= TIRED_DAMPING;
    } else if (kind === KIND_BUMPER && obstacle.kind === "circle") {
      // The kick flings the ball sideways, away from the bumper's crown (never upwards: a bumper is not a trampoline).
      const dx = ball.x - obstacle.x;
      ball.vx += BUMPER_KICK * this.timeScale * (dx < 0 ? -1 : 1);
    }
    if (this.notesThisStep >= MAX_NOTES_PER_STEP) return { suppressSound: true };
    this.notesThisStep++;
    v.notes++;
    const frequency = pegPitch(L.slots[index], v.settings.scale, v.settings.rootNote);
    if (kind === KIND_BUMPER) {
      const event: SoundEvent = { type: "hit", wallIndex: 1, frequency, accent: true };
      ctx.addPendingSoundEvent(event);
      return { suppressSound: true };
    }
    return { frequency };
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const worldDt = dtMs * this.timeScale;
    // A flying ball that came to rest on stuck balls sticks there; one perched on a peg or a bumper is nudged off it (a few
    // times at most, the perfect shot always); one flying for ever sticks where it is.
    const L = this.layout!;
    for (const ball of ctx.getBalls()) {
      const k = this.slotOfId.get(ball.id);
      if (k === undefined || v.shotState[k] !== SHOT_FLYING) continue;
      const speed = Math.hypot(ball.vx, ball.vy) / this.timeScale;
      this.restMs[k] = speed < REST_SPEED ? this.restMs[k] + worldDt : 0;
      if (this.worldMs - v.shotLaunchMs[k] > MAX_FLIGHT_MS) {
        this.land(ctx, ball, k);
        continue;
      }
      if (this.restMs[k] < REST_MS) continue;
      const onStuck = this.worldMs - this.touchMs[k] < 150;
      if (onStuck || (k !== v.perfectShot && this.perches[k] >= MAX_PERCHES)) this.land(ctx, ball, k);
      else {
        ball.vx += PERCH_KICK * this.timeScale * (ball.x <= L.cx ? 1 : -1);
        this.restMs[k] = 0;
        if (this.perches[k] < 255) this.perches[k]++;
      }
    }
    if (!v.finished && v.allLanded && this.timeScale === 1 && this.clockMs >= this.lastLandMs + FINAL_HOLD_MS - 1e-6) {
      v.finished = true;
      v.finishedMs = this.clockMs;
    }
  }

  /**
   * A resize rebuilds the field for the new canvas. Before the first step the shots in the air are launched afresh from
   * their seeded draws – exactly as an init at the new size would launch them (the seed finder builds its engine at the
   * page's size: the same seed replays the same run); later every ball keeps its place in the field.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || !this.layout) return true;
    const old = this.layout;
    this.rebuild(ctx);
    const L = this.layout!;
    this.updateTarget();
    const fresh = this.clockMs === 0;
    const kx = L.fieldWidth / old.fieldWidth;
    const ky = L.fieldHeight / old.fieldHeight;
    for (const ball of ctx.getBalls()) {
      const k = this.slotOfId.get(ball.id);
      if (k === undefined) continue;
      ball.trail.length = 0;
      ball.trailIndex = 0;
      if (this.view.shotState[k] === SHOT_LANDED) continue;
      if (fresh) {
        const st = this.scratch;
        this.launchState(ctx, k, st);
        ball.x = st.x;
        ball.y = st.y;
        ball.vx = st.vx * this.timeScale;
        ball.vy = st.vy * this.timeScale;
        continue;
      }
      // The engine scaled the positions around the canvas centre; take them back and map them into the new field.
      const ox = old.width / 2 + ((ball.x - L.width / 2) * old.width) / L.width;
      const oy = old.height / 2 + ((ball.y - L.height / 2) * old.height) / L.height;
      ball.x = L.left + (ox - old.left) * kx;
      ball.y = L.top + (oy - old.top) * ky;
    }
    for (let i = 0; i < this.stuck.length; i++) {
      const k = this.stuckShot[i];
      this.stuckDx[k] *= kx;
      this.stuckLift[k] *= ky;
      this.placeStuck(k, i);
    }
    this.updateAim(ctx);
    return true;
  }

  /** There are no engine rings: the field is the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { shots: v.shots, launched: v.launched, landed: v.landed, total: v.total, best: v.best, bullseyes: v.bullseyes, finished: v.finished };
  }
}
