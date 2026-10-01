import { SCALE_INTERVALS, isScaleId, midiToFrequency, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import { circleObstacle, resolveBallCircle, segmentBetween, type CircleObstacle, type Obstacle } from "../obstacles";
import type { Ball, CircularWall, GameMode, ModeContext, ObstacleHitResult } from "../types";
import { TWO_PI, passableGap } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---
import { DEFAULT_RESPAWN_EVERY, resolveRespawnEvery } from "../respawn";
import { cruiseSpeed } from "../multipliers";

/**
 * Conveyor Belt ("conveyor" mode, feature gerald-conveyor – the character-ball account's "conveyor belt loading" and "Gerald
 * respawns every 3 seconds" clips). A conveyor belt runs across the top of the playfield: a ball comes out of a hatch in
 * the left wall every `interval` seconds of the simulation clock (ball k at k × interval), rides the belt to its end in the
 * middle of the field and drops into the arena below – up to `maxBalls` balls. The arena is one of three:
 *
 * - **rings** – Classic's concentric rings with rotating gaps (the engine's own ring walls, sized and counted by the Wall
 *   Count and Gap Size settings as far as they fit): a dropped ball slides down a loading tube into the core, is launched at
 *   the Ball Speed in a seeded direction and has to work its way out ring by ring – the rings never break, so every new ball
 *   faces them all again. A ball's way through a gap plays an accented note, its escape the wall-break sound and confetti;
 *   escaped balls roll off the outer ring onto a second belt at the bottom, which carries them out of the field. A ball still
 *   inside after its patience (`PATIENCE_SEC`, more for some) gets the director's help ("Gerald always escapes"): its
 *   rebounds aim at the gap, and it slips through.
 * - **bowl** – a U-shaped container hanging in the middle of the field: the balls pile up in it and settle (ball-to-ball hits
 *   are damped like Ball Drop's); balls that spill over the rim fall onto the bottom belt and count as overflow.
 * - **pegs** – a Galton board: staggered pegs, each a note of the scale by its column, over a row of bins.
 *
 * With `freeze` a ball that lands freezes in place and becomes an obstacle (Accumulation style), so the pile grows visibly:
 * in the bowl and the peg field a ball freezes once it has come to rest; in the rings – where nothing rests – its freedom
 * lasts `FREEZE_SEC` (about four seconds), then it freezes where it is. Ball sizes (around the Ball Size) and colours (Gerald's
 * Ball Colour or a palette) vary with `variety`; the first ball is always Gerald.
 *
 * Sound: the belt hums while it carries a ball and clicks when one drops (`SoundEvent.conveyor`, the ToneGenerator's
 * `playConveyor()`); every bounce is a note through the ToneGenerator – the rings' own wall tones, the bowl's and the floor's
 * pitched by the ball's size (bigger = lower), the pegs' by their column, a ring passed by its index – so melodies,
 * instruments, hit samples, the beat lock and the music bed apply as everywhere.
 *
 * Determinism: `init()` draws every ball's numbers up front from `ctx.random()` (its size, colour, drop jitter and launch
 * angle, patience – the same six draws per ball whatever the arena), the schedule runs on the simulation clock and everything else is
 * physics, so a seed replays exactly and Find Simulation searches the run's length. The run finishes `FINAL_HOLD_MS` after
 * the last ball is out (rings: escaped or frozen, and carried away) or the arena has settled (bowl, pegs).
 */

/* ------------------------------------------------------------------ settings */

export const CONVEYOR_ARENAS = ["rings", "bowl", "pegs"] as const;
export type ConveyorArena = (typeof CONVEYOR_ARENAS)[number];

export function isConveyorArena(value: unknown): value is ConveyorArena {
  return typeof value === "string" && (CONVEYOR_ARENAS as readonly string[]).includes(value);
}

export interface ConveyorSettings {
  /** Seconds between two balls on the belt, 0.5–10 (any value from 0.5 typed). */
  interval: number;
  /** Balls the belt loads, 1–200 (any number from 1 typed; a run builds at most its memory-safety ceiling). */
  maxBalls: number;
  /** What the balls drop into. */
  arena: ConveyorArena;
  /** A ball that lands freezes in place and becomes an obstacle. */
  freeze: boolean;
  /** 0–1: how much the balls' sizes and colours vary. */
  variety: number;
  /** The Sound section's scale and root: the peg, bowl and ring-pass notes follow them (live). */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_CONVEYOR_SETTINGS: ConveyorSettings = {
  interval: 3,
  maxBalls: 8,
  arena: "rings",
  freeze: false,
  variety: 0.5,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const CONVEYOR_RANGES = {
  cvInterval: { min: 0.5, max: 10, step: 0.1 },
  cvMaxBalls: { min: 1, max: 200, step: 1 },
  cvVariety: { min: 0, max: 1, step: 0.05 },
} as const;

/** The Conveyor Belt fields of the SimulatorSettings object (URL keys cvi, cvn, cva, cvf, cvv) and the respawn timer of Classic and Multiply (`rse`). */
export interface ConveyorFields {
  cvInterval: number;
  cvMaxBalls: number;
  cvArena: ConveyorArena;
  cvFreeze: boolean;
  cvVariety: number;
  respawnEvery: number;
}

function clampNumber(value: unknown, range: { min: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds onto a slider's step, two decimals at most. */
function onStep(value: number, step: number) {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** Fills in the defaults and validates every value (counts whole, the rest on their steps, no maximum); bad values fall back to the defaults. */
export function resolveConveyorSettings(config: Partial<ConveyorSettings> | null | undefined): ConveyorSettings {
  const out = { ...DEFAULT_CONVEYOR_SETTINGS };
  if (!config) return out;
  const R = CONVEYOR_RANGES;
  if (config.interval !== undefined) out.interval = onStep(clampNumber(config.interval, R.cvInterval, out.interval), R.cvInterval.step) || R.cvInterval.min;
  if (config.maxBalls !== undefined) out.maxBalls = Math.round(clampNumber(config.maxBalls, R.cvMaxBalls, out.maxBalls));
  if (isConveyorArena(config.arena)) out.arena = config.arena;
  if (typeof config.freeze === "boolean") out.freeze = config.freeze;
  if (config.variety !== undefined) out.variety = onStep(clampNumber(config.variety, R.cvVariety, out.variety), R.cvVariety.step);
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** Picks the Conveyor Belt settings (and the Sound section's scale and root) out of a bigger object for `engine.setConveyorSettings()`. */
export function conveyorSettingsOf(source: Pick<ConveyorFields, "cvInterval" | "cvMaxBalls" | "cvArena" | "cvFreeze" | "cvVariety"> & { scale?: ScaleId; rootNote?: number }): ConveyorSettings {
  return {
    interval: source.cvInterval,
    maxBalls: source.cvMaxBalls,
    arena: source.cvArena,
    freeze: source.cvFreeze,
    variety: source.cvVariety,
    scale: source.scale ?? DEFAULT_CONVEYOR_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_CONVEYOR_SETTINGS.rootNote,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names (the respawn timer is not part of them). */
export function conveyorSettingFields(settings: ConveyorSettings): Omit<ConveyorFields, "respawnEvery"> {
  return { cvInterval: settings.interval, cvMaxBalls: settings.maxBalls, cvArena: settings.arena, cvFreeze: settings.freeze, cvVariety: settings.variety };
}

/** The defaults of the feature's fields. */
export function defaultConveyorFields(): ConveyorFields {
  return { ...conveyorSettingFields(DEFAULT_CONVEYOR_SETTINGS), respawnEvery: DEFAULT_RESPAWN_EVERY };
}

/** Validates the feature's fields (URL parameters and presets alike): numbers from their minimum up on their steps, a known arena, a real boolean. */
export function resolveConveyorFields(source: Partial<ConveyorFields>): ConveyorFields {
  return {
    ...conveyorSettingFields(resolveConveyorSettings({ interval: source.cvInterval, maxBalls: source.cvMaxBalls, arena: source.cvArena, freeze: source.cvFreeze, variety: source.cvVariety })),
    respawnEvery: source.respawnEvery === undefined ? DEFAULT_RESPAWN_EVERY : resolveRespawnEvery(source.respawnEvery),
  };
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { cvi: "cvInterval", cvn: "cvMaxBalls", cvv: "cvVariety", rse: "respawnEvery" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: cvi, cvn, cva, cvf, cvv and rse. */
export function writeConveyorParams(settings: ConveyorFields, base: ConveyorFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.cvArena !== base.cvArena) params.set("cva", settings.cvArena);
  if (settings.cvFreeze !== base.cvFreeze) params.set("cvf", settings.cvFreeze ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readConveyorParams(params: URLSearchParams, settings: ConveyorFields) {
  const next: Partial<ConveyorFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const arena = params.get("cva");
  if (isConveyorArena(arena)) next.cvArena = arena;
  const freeze = params.get("cvf");
  if (freeze === "1") next.cvFreeze = true;
  else if (freeze === "0") next.cvFreeze = false;
  Object.assign(settings, resolveConveyorFields(next));
}

/* ------------------------------------------------------------------ schedule */

/** Simulation ms at which ball `k` (0-based) comes out of the hatch onto the belt: k × the interval. */
export function conveyorLoadMs(k: number, interval: number): number {
  return k * interval * 1000;
}

/** The balls a run loads: the setting, at most its memory-safety ceiling. */
export function conveyorBallCount(settings: Pick<ConveyorSettings, "maxBalls">): number {
  return Math.max(1, memoryCeiling("cvMaxBalls", Math.round(settings.maxBalls)));
}

/** Seconds a ball rides the belt from the hatch to the drop point. */
export function conveyorRideSec(layout: Pick<ConveyorLayout, "beltStartX" | "dropX" | "beltSpeed">): number {
  return layout.beltSpeed > 0 ? Math.max(0, layout.dropX - layout.beltStartX) / layout.beltSpeed : 0;
}

/** Simulation ms at which ball `k` drops off the belt into the arena (its load time + the ride). */
export function conveyorDropMs(k: number, interval: number, rideSec: number): number {
  return conveyorLoadMs(k, interval) + rideSec * 1000;
}

/** A typical ride (s) on a desktop canvas, for the panel's summary. */
export const TYPICAL_RIDE_SEC = 1.1;
/** A typical way out of the rings, the settling of the pile, and the carry-off (s), for the panel's summary. */
export const TYPICAL_TAIL_SEC: Record<ConveyorArena, number> = { rings: 7, bowl: 3, pegs: 4 };

/** About how long a run lasts (s): the last ball's drop, a typical escape or settling, the hold. The seed moves it (the escapes, the bounces). */
export function conveyorNominalRunSec(settings: Partial<ConveyorSettings> | null | undefined): number {
  const s = resolveConveyorSettings(settings);
  return (conveyorBallCount(s) - 1) * s.interval + TYPICAL_RIDE_SEC + TYPICAL_TAIL_SEC[s.arena] + FINAL_HOLD_MS / 1000;
}

/* ------------------------------------------------------------------ sizes and colours */

/** Radii spread ±75 % of the Ball Size at full variety (like Ball Drop), never below `MIN_RADIUS` px. */
export const SIZE_SPREAD = 0.75;
export const MIN_RADIUS = 3;

/** The size (relative to the Ball Size) of ball `k` from its draw `u` (0–1): Gerald, the first ball, is always the Ball Size. */
export function conveyorBallScale(k: number, u: number, variety: number, ballRadius: number): number {
  if (k === 0) return 1;
  const v = Math.max(0, variety);
  const scale = 1 + v * SIZE_SPREAD * (2 * u - 1);
  return Math.max(MIN_RADIUS / Math.max(1e-9, ballRadius), scale);
}

/** The biggest ball the sizes can make (relative to the Ball Size), which the layout is spaced for. */
export function conveyorMaxScale(variety: number): number {
  return 1 + Math.max(0, variety) * SIZE_SPREAD;
}

/** The palette of the other balls (Gerald wears the Ball Colour). */
export const CONVEYOR_BALL_COLORS = ["#ffb238", "#2de2e6", "#ff5d73", "#b388ff", "#5dffb0", "#f7f052", "#4d9dff", "#ff7ad9", "#c6ff5d", "#ff8f3d"];

/** The colour of ball `k` from its draws: Gerald's Ball Colour for the first and – with a chance of 1 − variety – for every other, else a palette colour. */
export function conveyorBallColor(k: number, uColor: number, uPalette: number, variety: number, ballColor: string): string {
  if (k === 0 || !(uColor < variety)) return ballColor || "#ffffff";
  return CONVEYOR_BALL_COLORS[Math.min(CONVEYOR_BALL_COLORS.length - 1, Math.floor(uPalette * CONVEYOR_BALL_COLORS.length))];
}

/* ------------------------------------------------------------------ layout */

/** The field: a portrait column (this width per unit of height) fitting the centred square the recorder crops to. */
export const FIELD_ASPECT = 0.82;
/** The top belt's surface (fraction of the field height below its top) and thickness (fraction, at least 6 px). */
export const BELT_AT = 0.075;
export const BELT_THICKNESS = 0.024;
/** The belts' speeds, in field widths per second. */
export const BELT_SPEED = 0.42;
export const BOTTOM_BELT_SPEED = 0.5;
/** The bottom belt's surface, this fraction of the field height above its bottom. */
export const BOTTOM_BELT_AT = 0.05;
/** The rings: the outer radius (fraction of the field height) and the inner one (fraction of the outer one, at least what the biggest ball needs). */
export const RING_OUTER = 0.29;
export const RING_INNER = 0.3;
/** Rings are at least this many (biggest) ball radii (plus 3 px) apart, so the balls fit between two of them. */
export const MIN_RING_SPACING_RADII = 2.3;
/** The rings' gaps are this many times the Gap Size (like the Journey's rings stage): ball after ball, an escape should not drag on. */
export const RING_GAP_SCALE = 1.5;
/**
 * The bowl's inside fits about `BOWL_CAPACITY` balls of the average size (the variety's mean area, packed to `BOWL_PACKING`
 * of it); heaped up over the rim it takes about half as many again before the first one rolls off – whatever the frame,
 * so the overflow starts at about the same ball in every world shape. It is never wider than `BOWL_WIDTH` of the field nor
 * narrower than three balls, `BOWL_DEPTH_RATIO` half-widths deep (straight walls over a round bottom), and its rim sits
 * `BOWL_RIM_AT` of the field height below the top – in a tall frame higher, at most `BOWL_FALL_DEPTHS` of its depths below
 * the belt, so the drop never bounces a ball straight out of it.
 */
export const BOWL_CAPACITY = 20;
export const BOWL_PACKING = 0.7;
export const BOWL_WIDTH = 0.52;
export const BOWL_RIM_AT = 0.44;
export const BOWL_DEPTH_RATIO = 1.3;
export const BOWL_FALL_DEPTHS = 2.2;
export const BOWL_SEGMENTS = 14;
export const BOWL_THICKNESS = 4;
/** The peg field: its rows between these fractions of the field height, the bins from `BIN_TOP_AT` down. */
export const PEG_TOP_AT = 0.2;
export const PEG_BOTTOM_AT = 0.6;
export const BIN_TOP_AT = 0.67;
/** The ramps over the outermost pegs of the full rows rise this share of their run from the peg to the wall. */
export const RAMP_LIFT = 0.8;

export const WALL_RESTITUTION = 0.55;
export const BOWL_RESTITUTION = 0.45;
export const PEG_RESTITUTION = 0.6;
export const FLOOR_RESTITUTION = 0.4;
/** Escaped balls bounce off the outside of the outer ring with this restitution. */
export const DOME_RESTITUTION = 0.6;
/** Frozen balls as obstacles. */
export const FROZEN_RESTITUTION = 0.5;
/**
 * Fraction of the relative speed two colliding balls keep in the bowl and the peg field (the engine's pair rebound is
 * elastic; like Ball Drop this takes the energy out of the pile so it settles). The rings keep Classic's elastic hits.
 */
export const BALL_TO_BALL_RESTITUTION = 0.6;

/** What an obstacle of the layout is (`ConveyorLayout.kinds`). */
export const KIND_WALL = 0;
export const KIND_BOWL = 1;
export const KIND_PEG = 2;
export const KIND_DIVIDER = 3;
export const KIND_FLOOR = 4;

export interface ConveyorBowl {
  cx: number;
  rimY: number;
  /** The lowest point of the bowl's inside. */
  bottomY: number;
  halfWidth: number;
  /** Where the straight walls meet the round bottom. */
  arcTopY: number;
}

export interface ConveyorLayout {
  /** The canvas the layout was built for. */
  width: number;
  height: number;
  /** The field. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  fieldWidth: number;
  fieldHeight: number;
  cx: number;
  cy: number;
  /** The top belt: its surface (the balls ride on it), its thickness, where the balls come out of the left wall and where they drop. */
  beltY: number;
  beltThickness: number;
  beltStartX: number;
  dropX: number;
  /** Px per second of both belts. */
  beltSpeed: number;
  bottomBeltSpeed: number;
  /** The belt's underside: a free ball never flies above it. */
  ceilingY: number;
  /** The bottom belt's surface (rings, bowl), or −1 (the peg field has a floor and bins instead). */
  bottomBeltY: number;
  /** A ball on the bottom belt is gone once its centre passes this x (out through the gap under the right wall). */
  exitX: number;
  /** The rings' radii, inner to outer (rings only). */
  ringRadii: number[];
  bowl: ConveyorBowl | null;
  /** The peg field (pegs only): rows, the column spacing, the bins' top and floor, the bins' dividers (x). */
  pegRadius: number;
  pegRows: number;
  columnSpacing: number;
  binTop: number;
  floorY: number;
  binEdges: number[];
  /** Every obstacle (the side walls first), its kind and its note slot (the pegs' half-columns from the left; −1 otherwise). */
  obstacles: Obstacle[];
  kinds: Uint8Array;
  slots: Int16Array;
  /** The Ball Size and the biggest ball the layout was spaced for. */
  ballRadius: number;
  maxBallRadius: number;
}

/** The rings' radii for an outer radius, an inner one, a wanted count and the biggest ball: as many as fit, evenly spaced. */
export function conveyorRingRadii(outer: number, inner: number, wanted: number, maxBallRadius: number): number[] {
  const spacing = MIN_RING_SPACING_RADII * maxBallRadius + 3;
  const fit = 1 + Math.max(0, Math.floor((outer - inner) / Math.max(1e-9, spacing)));
  const count = Math.max(1, Math.min(Number.isFinite(wanted) ? Math.round(wanted) : 1, fit));
  const radii: number[] = [];
  for (let i = 0; i < count; i++) radii.push(count === 1 ? outer : inner + ((outer - inner) * i) / (count - 1));
  return radii;
}

/** The engine walls of the rings: one gap each (`RING_GAP_SCALE` × the Gap Size, at most half a turn), spread around like Classic's, never narrower than the biggest ball can pass. */
export function conveyorRingWalls(radii: readonly number[], gapSize: number, maxBallRadius: number): CircularWall[] {
  const n = radii.length;
  const gap = Math.min(Math.PI, (gapSize > 0 ? gapSize : 0.3) * RING_GAP_SCALE);
  return radii.map((radius, i) => {
    const start = (TWO_PI * i) / Math.max(1, n);
    return { radius, gaps: [{ startAngle: start, endAngle: start + passableGap(gap, radius, maxBallRadius) }] };
  });
}

/**
 * The bowl's half-width (px) for a Ball Size of `ballRadius` and sizes up to `maxScale` × it: room for `BOWL_CAPACITY` balls of
 * the mean area (the sizes spread evenly ±(maxScale − 1), so the mean area is 1 + (maxScale − 1)² / 3 times the Ball Size's) in
 * a U of `BOWL_DEPTH_RATIO` half-widths – (2 (ratio − 1) + π / 2) half-widths squared – within the field.
 */
export function conveyorBowlHalfWidth(ballRadius: number, maxScale: number, fieldWidth: number, maxBallRadius: number): number {
  const spread = Math.max(0, maxScale - 1);
  const meanArea = Math.PI * ballRadius * ballRadius * (1 + (spread * spread) / 3);
  const inside = (BOWL_CAPACITY * meanArea) / BOWL_PACKING;
  const fit = Math.sqrt(inside / (2 * (BOWL_DEPTH_RATIO - 1) + Math.PI / 2));
  return Math.max(3 * maxBallRadius + 4, Math.min((BOWL_WIDTH * fieldWidth) / 2, fit));
}

/**
 * Lays out the playfield for a canvas of `width` × `height`: a portrait field that uses the full height and fits the centred
 * square the recorder crops to (like Ball Drop and Bullseye), the belt along its top, and the arena below it – the rings centred
 * on the canvas (where the engine centres its walls), the bowl, or the peg field and its bins – spaced for the biggest ball.
 */
export function buildConveyorLayout(width: number, height: number, arena: ConveyorArena, ballRadius: number, maxScale: number, wallCount: number): ConveyorLayout {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const fieldHeight = Math.max(80, height - 2 * margin);
  const fieldWidth = Math.max(60, Math.min(width - 2 * margin, FIELD_ASPECT * fieldHeight));
  const left = (width - fieldWidth) / 2;
  const right = left + fieldWidth;
  const top = (height - fieldHeight) / 2;
  const bottom = top + fieldHeight;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(2, ballRadius);
  const maxR = Math.max(r, r * Math.max(1, maxScale));
  const beltThickness = Math.max(6, BELT_THICKNESS * fieldHeight);
  const beltY = top + BELT_AT * fieldHeight;
  const ceilingY = beltY + beltThickness;
  const beltStartX = left + maxR + 2;
  const dropX = cx;
  const beltSpeed = BELT_SPEED * fieldWidth;
  const bottomBeltSpeed = BOTTOM_BELT_SPEED * fieldWidth;
  const hasBottomBelt = arena !== "pegs";
  const bottomBeltY = hasBottomBelt ? bottom - BOTTOM_BELT_AT * fieldHeight : -1;
  const exitX = right + maxR + 2;

  const obstacles: Obstacle[] = [];
  const kinds: number[] = [];
  const slots: number[] = [];
  const push = (o: Obstacle, kind: number, slot = -1) => {
    obstacles.push(o);
    kinds.push(kind);
    slots.push(slot);
  };
  // The side walls: from the top of the field down to the bottom belt (the right one stops above it, so the carried balls
  // pass under it on their way out) or the floor of the bins.
  const floorY = hasBottomBelt ? bottomBeltY : bottom - 2;
  const exitGap = 2.4 * maxR + 6;
  push(segmentBetween(left, top, left, floorY, { restitution: WALL_RESTITUTION }), KIND_WALL);
  push(segmentBetween(right, top, right, hasBottomBelt ? Math.max(top + 1, floorY - exitGap) : floorY, { restitution: WALL_RESTITUTION }), KIND_WALL);

  let ringRadii: number[] = [];
  let bowl: ConveyorBowl | null = null;
  let pegRadius = 0;
  let pegRows = 0;
  let columnSpacing = 0;
  let binTop = bottom;
  const binEdges: number[] = [];
  if (arena === "rings") {
    // (room under the belt and over the bottom belt, and beside the outer ring for the escaped balls to fall past it)
    const room = Math.min(cy - ceilingY - 2.5 * maxR - 6, (hasBottomBelt ? bottomBeltY : bottom) - cy - 2.5 * maxR - 6, fieldWidth / 2 - 2.6 * maxR - 8);
    const outer = Math.max(2 * maxR + 4, Math.min(RING_OUTER * fieldHeight, room));
    const inner = Math.min(0.9 * outer, Math.max(RING_INNER * outer, 3.2 * maxR + 6));
    ringRadii = conveyorRingRadii(outer, inner, wallCount, maxR);
  } else if (arena === "bowl") {
    const halfWidth = conveyorBowlHalfWidth(r, maxScale, fieldWidth, maxR);
    const depth = BOWL_DEPTH_RATIO * halfWidth;
    const rimY = Math.min(top + BOWL_RIM_AT * fieldHeight, ceilingY + BOWL_FALL_DEPTHS * depth);
    const bottomY = Math.min(rimY + depth, (hasBottomBelt ? bottomBeltY : bottom) - 2.5 * maxR - 8);
    const arcTopY = Math.max(rimY, bottomY - halfWidth);
    bowl = { cx, rimY, bottomY, halfWidth, arcTopY };
    const opts = { restitution: BOWL_RESTITUTION, thickness: BOWL_THICKNESS };
    push(segmentBetween(cx - halfWidth, rimY, cx - halfWidth, arcTopY, opts), KIND_BOWL);
    const radiusY = bottomY - arcTopY;
    let px = cx - halfWidth;
    let py = arcTopY;
    for (let j = 1; j <= BOWL_SEGMENTS; j++) {
      const a = Math.PI - (Math.PI * j) / BOWL_SEGMENTS;
      const x = cx + halfWidth * Math.cos(a);
      const y = arcTopY + radiusY * Math.sin(a);
      push(segmentBetween(px, py, x, y, opts), KIND_BOWL);
      px = x;
      py = y;
    }
    push(segmentBetween(cx + halfWidth, arcTopY, cx + halfWidth, rimY, opts), KIND_BOWL);
  } else {
    pegRadius = Math.max(3, Math.min(6, 0.011 * fieldHeight));
    columnSpacing = Math.max(26, 2.6 * maxR + 2 * pegRadius + 6);
    const cols = Math.max(2, Math.floor(fieldWidth / columnSpacing));
    columnSpacing = fieldWidth / cols;
    const y0 = top + PEG_TOP_AT * fieldHeight;
    const y1 = top + PEG_BOTTOM_AT * fieldHeight;
    const rowGap = Math.max(2.2 * maxR + 2 * pegRadius, 0.8 * columnSpacing);
    pegRows = Math.max(1, Math.floor((y1 - y0) / rowGap) + 1);
    for (let row = 0; row < pegRows; row++) {
      const y = y0 + row * rowGap;
      // Row 0 has a peg right under the drop point (the middle of the field): with an even column count that is the
      // offset pattern; the rows alternate from there.
      const offset = (row + (cols % 2 === 0 ? 1 : 0)) % 2 === 1;
      const count = offset ? cols - 1 : cols;
      for (let j = 0; j < count; j++) {
        const half = offset ? 2 * (j + 1) : 2 * j + 1;
        push(circleObstacle(left + (half * columnSpacing) / 2, y, pegRadius, { restitution: PEG_RESTITUTION }), KIND_PEG, half);
      }
      // A ball too big for the gap between a wall and the row's outermost peg (half a column from it) would sit in that
      // corner for good: a ramp from the wall down onto the top of the peg rolls it inward, over the peg.
      if (!offset) {
        const edge = columnSpacing / 2;
        const top = y - pegRadius;
        push(segmentBetween(left, top - RAMP_LIFT * edge, left + edge, top, { restitution: WALL_RESTITUTION, thickness: 2 }), KIND_WALL);
        push(segmentBetween(right, top - RAMP_LIFT * edge, right - edge, top, { restitution: WALL_RESTITUTION, thickness: 2 }), KIND_WALL);
      }
    }
    binTop = Math.max(y0 + (pegRows - 1) * rowGap + pegRadius + 2.5 * maxR, top + BIN_TOP_AT * fieldHeight);
    for (let m = 1; m < cols; m++) {
      const x = left + m * columnSpacing;
      binEdges.push(x);
      push(segmentBetween(x, binTop, x, floorY, { restitution: BOWL_RESTITUTION, thickness: 2 }), KIND_DIVIDER);
    }
    push(segmentBetween(left, floorY, right, floorY, { restitution: FLOOR_RESTITUTION }), KIND_FLOOR);
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
    cy,
    beltY,
    beltThickness,
    beltStartX,
    dropX,
    beltSpeed,
    bottomBeltSpeed,
    ceilingY,
    bottomBeltY,
    exitX,
    ringRadii,
    bowl,
    pegRadius,
    pegRows,
    columnSpacing,
    binTop,
    floorY,
    binEdges,
    obstacles,
    kinds: Uint8Array.from(kinds),
    slots: Int16Array.from(slots),
    ballRadius: r,
    maxBallRadius: maxR,
  };
}

/* ------------------------------------------------------------------ sound */

/** The degrees the notes climb: the chosen scale, or a diatonic major scale while the Sound section is chromatic. */
function conveyorScale(scale: ScaleId): readonly number[] {
  return scale === "chromatic" ? SCALE_INTERVALS.major : SCALE_INTERVALS[scale];
}

function degreeMidi(base: number, degree: number, scale: ScaleId, rootNote: number): number {
  const steps = conveyorScale(scale);
  const n = steps.length;
  const d = Math.max(0, Math.round(degree));
  return base + normalizeRootNote(rootNote) + 12 * Math.floor(d / n) + steps[d % n];
}

export const PITCH_MIN_HZ = 110;
export const PITCH_MAX_HZ = 1760;

/** Pitch of a ball's hits on the bowl, the bins and the floor: bigger = lower (5280 / radius Hz, like Ball Drop), A2–A6. */
export function conveyorHitFrequency(radius: number): number {
  if (!(radius > 0)) return PITCH_MAX_HZ;
  return Math.max(PITCH_MIN_HZ, Math.min(PITCH_MAX_HZ, 5280 / radius));
}

/** Pitch (Hz) of a peg in half-column `slot` (1 = the leftmost): a keyboard from C4 on the left upwards. */
export function conveyorPegPitch(slot: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(60, Math.max(0, slot - 1), scale, rootNote));
}

/** Pitch (Hz) of a ball passing ring `ring` (0 = the innermost) on its way out: climbing from C5. */
export function conveyorPassPitch(ring: number, scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(72, 2 * Math.max(0, ring), scale, rootNote));
}

/** Pitch (Hz) of a ball hitting a frozen one: a high tick. */
export function conveyorFrozenPitch(scale: ScaleId, rootNote: number): number {
  return midiToFrequency(degreeMidi(84, 4, scale, rootNote));
}

/** The belt's hum (Hz): a low A, under everything. */
export const HUM_FREQUENCY = 55;
/** Most notes one 60 Hz step queues (the rest still bounce and glow). */
export const MAX_NOTES_PER_STEP = 6;
/** Hits slower than this (px/s) between two balls make no sound. */
export const COLLIDE_SOUND_SPEED = 60;

/* ------------------------------------------------------------------ the director's help (rings) */

export interface GapSteer {
  /** The ball relative to the rings' centre (px), where it rebounds off the inside of a ring. */
  bx: number;
  by: number;
  /** The ring it rebounds off, the ring inside it (0 = none: the core) and the ball's radius. */
  radius: number;
  innerRadius: number;
  ballRadius: number;
  /** The gap's middle (radians, rotation included) and how fast the ring turns (rad/s). */
  gapMid: number;
  omega: number;
  /** Half the angle the ball's centre may cross the ring in and pass the gap (the gap less the ball, each side); 0.05 when absent. */
  gapHalf?: number;
  /** The ball's speed leaving the wall (px/s) and gravity (px/s², down; the ball's own weight included). */
  speed: number;
  gravity: number;
  /** The ring modes' cruising speed (px/s): a slower ball speeds up by half its speed a second, as in the engine (0 = none). */
  cruise?: number;
  /**
   * The engine turns the rings once a step (by `omega` × `stepSec`), the next time `nextTurnSec` from now; without a step
   * the ring turns smoothly.
   */
  stepSec?: number;
  nextTurnSec?: number;
}

/** How far (radians) a ring turning at `p.omega` has turned `t` seconds from now: by whole steps, as the engine turns it. */
export function ringTurnBy(p: Pick<GapSteer, "omega" | "stepSec" | "nextTurnSec">, t: number): number {
  const step = p.stepSec ?? 0;
  if (!(step > 0)) return p.omega * t;
  const first = Math.max(0, p.nextTurnSec ?? 0);
  return t < first ? 0 : p.omega * step * (1 + Math.floor((t - first) / step + 1e-9));
}

/** Wraps an angle into (−π, π]. */
function wrapAngle(a: number): number {
  let w = a % TWO_PI;
  if (w > Math.PI) w -= TWO_PI;
  else if (w <= -Math.PI) w += TWO_PI;
  return w;
}

/** The director's flight model: the engine's sub-step (four to a 60 Hz step); the search flies at twice it, the final aim at it. */
export const STEER_DT = 1 / 240;
/** Rebound directions the director weighs on each side of the wall's inward normal. */
export const STEER_SAMPLES = 32;
/** The longest flight it plans (s). */
export const STEER_HORIZON_SEC = 1.2;
/**
 * A flight has to come back at the ring at least this steeply (its outward speed a share of its speed): the ball crosses
 * the wall quickly – through the gap before it turns away – and never just grazes along the wall from rebound to rebound.
 */
export const STEER_MIN_ARRIVAL = 0.2;

/** Where and when (s after the rebound) a flight reaches the ring again. */
export interface SteerLanding {
  t: number;
  phi: number;
}

/**
 * Flies a ball leaving (bx, by) at `aim` the way the engine moves it – gravity, then the cruising boost, then the move, in
 * sub-steps of `dt` – until its centre is back at `reach` from the centre (the ring it left: the landing, interpolated
 * between sub-steps, into `out`). False when it would touch the ring inside first (closer than `inner`), never leaves the
 * wall, comes back shallower than `STEER_MIN_ARRIVAL`, or is still flying at the horizon. The walls are the only thing it
 * sees (no other balls).
 */
export function steerFlight(p: GapSteer, aim: number, reach: number, inner: number, dt: number, out: SteerLanding): boolean {
  let x = p.bx;
  let y = p.by;
  let vx = Math.cos(aim) * p.speed;
  let vy = Math.sin(aim) * p.speed;
  const cruise = p.cruise ?? 0;
  const boost = 1 + 0.5 * dt;
  const reach2 = reach * reach;
  const inner2 = inner * inner;
  let away = false;
  let d2 = x * x + y * y;
  const steps = Math.ceil(STEER_HORIZON_SEC / dt);
  for (let i = 1; i <= steps; i++) {
    vy += p.gravity * dt;
    if (cruise > 0) {
      const sp = Math.hypot(vx, vy);
      if (sp > 0 && sp < cruise) {
        vx *= boost;
        vy *= boost;
      }
    }
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    const n2 = nx * nx + ny * ny;
    if (inner > 0 && n2 < inner2) return false;
    if (!away) {
      if (n2 < reach2) away = true;
      else if (i > 4) return false; // grazing along the wall
    } else if (n2 >= reach2) {
      const d0 = Math.sqrt(d2);
      const d1 = Math.sqrt(n2);
      const f = d1 > d0 ? Math.min(1, Math.max(0, (reach - d0) / (d1 - d0))) : 1;
      const ix = x + (nx - x) * f;
      const iy = y + (ny - y) * f;
      if ((ix * vx + iy * vy) / reach < STEER_MIN_ARRIVAL * Math.hypot(vx, vy)) return false;
      out.t = (i - 1 + f) * dt;
      out.phi = Math.atan2(iy, ix);
      return true;
    }
    x = nx;
    y = ny;
    d2 = n2;
  }
  return false;
}

/** Scratch space of `steerToGap()`: each direction's miss and flight time. */
const steerMiss = new Float64Array(2 * STEER_SAMPLES + 1);
const steerTime = new Float64Array(2 * STEER_SAMPLES + 1);

/**
 * The direction (radians) a ball rebounding off the inside of a ring should leave in to get out through the ring's gap. The
 * director flies every direction that leaves the wall inward through the engine's own motion (`steerFlight()`: gravity and
 * the cruising boost, the ring inside in the way, a steep enough return) and takes the one whose landing the gap's middle
 * reaches at the same moment (the ring turns step by step meanwhile), refined onto it. When no flight meets the gap, it
 * sets up the next one: the landing that leaves the gap a comfortable hop away when the ball gets there (no closer than
 * the shortest steep hop, no further than the ring inside lets a flight go), the quickest of them. Null when no flight
 * gets back to the ring. Draws no random numbers.
 */
export function steerToGap(p: GapSteer): number | null {
  const dist = Math.hypot(p.bx, p.by);
  if (!(dist > 0) || !(p.speed > 0) || !(p.radius > 0)) return null;
  const reach = Math.max(1, p.radius - p.ballRadius - 2);
  const inner = p.innerRadius > 0 ? p.innerRadius + p.ballRadius + 1 : 0;
  const land: SteerLanding = { t: 0, phi: 0 };
  /** How far (signed, radians) the gap's middle will be from where a flight at `aim` lands; NaN for no landing. */
  const missAt = (aim: number, dt: number) => (steerFlight(p, aim, reach, inner, dt, land) ? wrapAngle(p.gapMid + ringTurnBy(p, land.t) - land.phi) : Number.NaN);
  const inward = Math.atan2(-p.by, -p.bx);
  const span = Math.PI / 2 - 0.05;
  const step = span / STEER_SAMPLES;
  let best = Number.NaN;
  let bestMiss = Infinity;
  for (let i = -STEER_SAMPLES; i <= STEER_SAMPLES; i++) {
    const aim = inward + i * step;
    const miss = missAt(aim, 2 * STEER_DT);
    steerMiss[i + STEER_SAMPLES] = miss;
    steerTime[i + STEER_SAMPLES] = Number.isFinite(miss) ? land.t : Number.NaN;
    if (Math.abs(miss) < bestMiss - 1e-12) {
      bestMiss = Math.abs(miss);
      best = aim;
    }
  }
  if (!Number.isFinite(best)) return null;
  const tolerance = Math.max(0.02, p.gapHalf ?? 0.05);
  if (bestMiss > tolerance + 2 * step) {
    // No flight meets the gap: land where the gap will be a comfortable hop away.
    const shortest = 2 * Math.asin(STEER_MIN_ARRIVAL) + 0.05;
    const clear = inner > 0 ? Math.min(1, inner / reach) : -1;
    const longest = Math.max(shortest, Math.min(Math.PI, 2 * Math.acos(clear)) - 0.1);
    let bestCost = Infinity;
    let bestT = Infinity;
    for (let i = 0; i < steerMiss.length; i++) {
      const m = Math.abs(steerMiss[i]);
      if (!Number.isFinite(m)) continue;
      const cost = m < shortest ? shortest - m : m > longest ? m - longest : 0;
      const t = steerTime[i];
      if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && t < bestT)) {
        bestCost = cost;
        bestT = t;
        best = inward + (i - STEER_SAMPLES) * step;
      }
    }
    return best;
  }
  // Onto the gap itself: bisect toward a neighbouring direction that lands on its other side, when there is one.
  for (const side of [-1, 1]) {
    let a = best;
    let b = best + side * step;
    if (Math.abs(wrapAngle(b - inward)) > span + 1e-9) continue;
    let ma = missAt(a, STEER_DT);
    const mb = missAt(b, STEER_DT);
    if (!Number.isFinite(ma) || !Number.isFinite(mb) || ma === 0 || Math.sign(ma) === Math.sign(mb) || Math.abs(ma - mb) > Math.PI) continue;
    let landed = true;
    for (let k = 0; k < 16; k++) {
      const m = (a + b) / 2;
      const mm = missAt(m, STEER_DT);
      if (!Number.isFinite(mm)) {
        landed = false;
        break;
      }
      if (Math.sign(mm) === Math.sign(ma)) {
        a = m;
        ma = mm;
      } else b = m;
    }
    best = landed ? (a + b) / 2 : a;
    break;
  }
  return best;
}

/* ------------------------------------------------------------------ run */

/** Seconds the loading tube takes a ball from the belt into the core (rings). */
export const CHUTE_SEC = 0.45;
/** Rings: a ball's freedom with `freeze` on (s): then it freezes where it is. */
export const FREEZE_SEC = 4;
/**
 * Rings: after this long inside (s) – plus up to `PATIENCE_SPREAD_SEC` more, drawn per ball – the director aims a ball's
 * rebounds at the gap ("Gerald always escapes"), so the escapes spread out and the seed moves the run's length.
 */
export const PATIENCE_SEC = 2;
export const PATIENCE_SPREAD_SEC = 5;
/** Rings: a ball counts as out once its centre is this far (px) beyond the outer ring and its own radius. */
export const ESCAPE_MARGIN = 6;
/** Bowl and pegs: a ball that moved less than this (px) over a rest window (ms) is at rest. */
export const REST_DISTANCE = 2;
export const REST_WINDOW_MS = 500;
/** Pegs, no freeze: a ball resting on a peg is nudged off sideways (px/s), at most this many times. */
export const PERCH_KICK = 45;
export const MAX_PERCHES = 3;
/** Sideways speed (px/s, each way at most) a ball drops off the belt with, so it never balances on the peg below. */
export const DROP_JITTER = 24;
/** Simulation ms the final banner holds once everything is done, before the run finishes. */
export const FINAL_HOLD_MS = 1500;
/** Safety net: the run is done at the latest this long (ms) after the last drop, whatever is still moving. */
export const SETTLE_TIMEOUT_MS = 30000;
/** The first drop times the view keeps (for tools and the smoke test). */
export const DROP_LOG = 64;

/** A ball's state (`ConveyorView.slotState`). */
export const CV_WAITING = 0;
export const CV_RIDING = 1;
export const CV_CHUTE = 2;
export const CV_FREE = 3;
export const CV_ESCAPED = 4;
export const CV_CARRIED = 5;
export const CV_GONE = 6;
export const CV_FROZEN = 7;

export interface ConveyorView {
  settings: ConveyorSettings;
  layout: ConveyorLayout | null;
  /** The simulation clock (ms): the belts, the rollers and the hatch animate on it. */
  timeMs: number;
  /** Balls this run loads, and the counters. */
  max: number;
  /** Balls that came out of the hatch, and that dropped into the arena ("loaded"). */
  released: number;
  loaded: number;
  /** Rings: out of the ring system. Bowl: spilled over the rim. Pegs: reached the bins. */
  escaped: number;
  overflow: number;
  landed: number;
  frozen: number;
  /** Balls the bottom belt took out of the field. */
  carried: number;
  /** Rings passed on the way out, notes, hums and clicks queued. */
  passes: number;
  notes: number;
  hums: number;
  clicks: number;
  /** Balls on the belt and (rings) in the tube or inside the rings right now. */
  riding: number;
  inside: number;
  /** Simulation ms of the last drop and the last escape (−∞ before the first). */
  lastDropMs: number;
  lastEscapeMs: number;
  /** The drop times (simulation ms) of the first `DROP_LOG` balls. */
  dropTimes: number[];
  /** Per ball: its state, colour and size (relative to the Ball Size). */
  slotState: Uint8Array;
  slotColor: string[];
  slotScale: Float64Array;
  /** The frozen balls as the obstacles the others bounce off (the renderer frosts them). */
  frozenBalls: readonly CircleObstacle[];
  /** Everything is done: the final banner shows through the hold. The run then finishes. */
  allDone: boolean;
  doneAtMs: number;
  /** The safety net ended the run (something was still moving). */
  timedOut: boolean;
  finished: boolean;
  finishedMs: number;
}

function createView(): ConveyorView {
  return {
    settings: { ...DEFAULT_CONVEYOR_SETTINGS },
    layout: null,
    timeMs: 0,
    max: 0,
    released: 0,
    loaded: 0,
    escaped: 0,
    overflow: 0,
    landed: 0,
    frozen: 0,
    carried: 0,
    passes: 0,
    notes: 0,
    hums: 0,
    clicks: 0,
    riding: 0,
    inside: 0,
    lastDropMs: -Infinity,
    lastEscapeMs: -Infinity,
    dropTimes: [],
    slotState: new Uint8Array(0),
    slotColor: [],
    slotScale: new Float64Array(0),
    frozenBalls: [],
    allDone: false,
    doneAtMs: -1,
    timedOut: false,
    finished: false,
    finishedMs: -1,
  };
}

/** Per-ball flags. */
const FLAG_OVERFLOW = 1;
const FLAG_LANDED = 2;

/* ------------------------------------------------------------------ the mode */

export class ConveyorMode implements GameMode {
  readonly name = "conveyor";
  private settings: ConveyorSettings = { ...DEFAULT_CONVEYOR_SETTINGS };
  private readonly view: ConveyorView = createView();
  private layout: ConveyorLayout | null = null;
  /** The simulation clock (the sum of the fixed steps), ms; the current step's start, its sub-steps so far and their length. */
  private clockMs = 0;
  private stepStartMs = 0;
  private subIndex = 0;
  private subLenMs = 0;
  /** The end of the current sub-step (ms of the simulation clock): the time stamps of drops, launches and escapes. */
  private subMs = 0;
  /** The Ball Colour the balls were last coloured with (a change recolours the balls that wear it). */
  private lastBallColor = "";
  /** The seed's draws per ball: size, colour, palette, drop jitter, launch angle (0–1). */
  private uSize = new Float64Array(0);
  private uColor = new Float64Array(0);
  private uPalette = new Float64Array(0);
  private uJitter = new Float64Array(0);
  private uAngle = new Float64Array(0);
  private uPatience = new Float64Array(0);
  /** Per ball: its engine id, where it is on its script (px along the belt, the tube's 0–1), its pinned place, its times and flags. */
  private ballId = new Int32Array(0);
  private readonly slotOfId = new Map<number, number>();
  private progress = new Float64Array(0);
  private pinX = new Float64Array(0);
  private pinY = new Float64Array(0);
  private insideMs = new Float64Array(0);
  private layer = new Int16Array(0);
  private anchorX = new Float64Array(0);
  private anchorY = new Float64Array(0);
  private resting = new Uint8Array(0);
  private perches = new Uint8Array(0);
  private flags = new Uint8Array(0);
  /** Rings: the ring a ball rebounded off this sub-step that the director aims (at the sub-step's end), or −1. */
  private steerWall = new Int16Array(0);
  /** The frozen balls as obstacles, and which ball each one is. */
  private readonly frozen: CircleObstacle[] = [];
  private readonly frozenSlot: number[] = [];
  /** Escaped balls bounce off the outside of the outer ring. */
  private readonly dome: CircleObstacle = circleObstacle(0, 0, 1, { restitution: DOME_RESTITUTION });
  private notesThisStep = 0;
  /** The next rest window ends at this simulation time (ms). */
  private restWindowEndMs = REST_WINDOW_MS;
  /** Balls marked gone this step (removed from the engine at its end). */
  private goneThisStep = 0;
  /** The first ball's hum, queued at the run's first step. */
  private humPending = false;
  private lastWallCount = 7;
  private lastGapSize = 0.3;

  /** Balls fall and rest in the bowl and the peg field; the rings keep Classic's slow-ball boost (nothing rests there). */
  get ballsMayRest(): boolean {
    return this.settings.arena !== "rings";
  }

  getSettings(): ConveyorSettings {
    return this.settings;
  }
  /** The interval, the ball count, the arena, the freeze and the variety apply on the next init; the scale and root at once. */
  setSettings(patch: Partial<ConveyorSettings>) {
    this.settings = resolveConveyorSettings({ ...this.settings, ...patch });
    this.view.settings.scale = this.settings.scale;
    this.view.settings.rootNote = this.settings.rootNote;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): ConveyorView {
    return this.view;
  }
  getLayout(): ConveyorLayout | null {
    return this.layout;
  }
  getProgress() {
    const v = this.view;
    return {
      arena: v.settings.arena,
      max: v.max,
      released: v.released,
      loaded: v.loaded,
      escaped: v.escaped,
      overflow: v.overflow,
      landed: v.landed,
      frozen: v.frozen,
      carried: v.carried,
      passes: v.passes,
      allDone: v.allDone,
      timedOut: v.timedOut,
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
    const max = conveyorBallCount(s);
    this.ensureCapacity(max);
    // The seed, all up front: six numbers per ball, whatever the arena.
    for (let k = 0; k < max; k++) {
      this.uSize[k] = ctx.random();
      this.uColor[k] = ctx.random();
      this.uPalette[k] = ctx.random();
      this.uJitter[k] = ctx.random();
      this.uAngle[k] = ctx.random();
      this.uPatience[k] = ctx.random();
    }
    this.clockMs = 0;
    this.stepStartMs = 0;
    this.subIndex = 0;
    this.subLenMs = 0;
    this.subMs = 0;
    this.lastBallColor = ctx.config.ballColor;
    this.notesThisStep = 0;
    this.restWindowEndMs = REST_WINDOW_MS;
    this.goneThisStep = 0;
    this.slotOfId.clear();
    this.ballId.fill(-1);
    this.progress.fill(0);
    this.insideMs.fill(0);
    this.layer.fill(0);
    this.resting.fill(0);
    this.perches.fill(0);
    this.flags.fill(0);
    this.steerWall.fill(-1);
    this.frozen.length = 0;
    this.frozenSlot.length = 0;
    v.timeMs = 0;
    v.max = max;
    v.released = 0;
    v.loaded = 0;
    v.escaped = 0;
    v.overflow = 0;
    v.landed = 0;
    v.frozen = 0;
    v.carried = 0;
    v.passes = 0;
    v.notes = 0;
    v.hums = 0;
    v.clicks = 0;
    v.riding = 0;
    v.inside = 0;
    v.lastDropMs = -Infinity;
    v.lastEscapeMs = -Infinity;
    v.dropTimes = [];
    v.slotState.fill(CV_WAITING);
    const base = ctx.config.ballRadius || 8;
    for (let k = 0; k < max; k++) {
      v.slotScale[k] = conveyorBallScale(k, this.uSize[k], s.variety, base);
      v.slotColor[k] = conveyorBallColor(k, this.uColor[k], this.uPalette[k], s.variety, ctx.config.ballColor);
    }
    v.frozenBalls = this.frozen;
    v.allDone = false;
    v.doneAtMs = -1;
    v.timedOut = false;
    v.finished = false;
    v.finishedMs = -1;
    this.rebuild(ctx, true);
    // The first ball comes out of the hatch at once (the engine then adds no default ball); its hum starts with the first step.
    this.humPending = false;
    this.release(ctx, 0, false);
  }

  /** The per-ball arrays hold `max` balls (grown once before a run that loads more; grow-only). */
  private ensureCapacity(max: number) {
    if (max <= this.ballId.length) return;
    const n = Math.ceil(max);
    this.uSize = new Float64Array(n);
    this.uColor = new Float64Array(n);
    this.uPalette = new Float64Array(n);
    this.uJitter = new Float64Array(n);
    this.uAngle = new Float64Array(n);
    this.uPatience = new Float64Array(n);
    this.ballId = new Int32Array(n).fill(-1);
    this.progress = new Float64Array(n);
    this.pinX = new Float64Array(n);
    this.pinY = new Float64Array(n);
    this.insideMs = new Float64Array(n);
    this.layer = new Int16Array(n);
    this.anchorX = new Float64Array(n);
    this.anchorY = new Float64Array(n);
    this.resting = new Uint8Array(n);
    this.perches = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.steerWall = new Int16Array(n).fill(-1);
    this.view.slotState = new Uint8Array(n);
    this.view.slotColor = new Array<string>(n).fill("#ffffff");
    this.view.slotScale = new Float64Array(n).fill(1);
  }

  /** (Re)builds the layout (and the rings) for the canvas, the Ball Size, the variety and the Wall Count / Gap Size. */
  private rebuild(ctx: ModeContext, fresh = false) {
    const s = this.settings;
    const base = ctx.config.ballRadius || 8;
    this.layout = buildConveyorLayout(ctx.config.width, ctx.config.height, s.arena, base, conveyorMaxScale(s.variety), ctx.config.wallCount || 7);
    this.view.layout = this.layout;
    ctx.setObstacles(this.layout.obstacles);
    this.lastWallCount = ctx.config.wallCount || 7;
    this.lastGapSize = ctx.config.gapSize || 0.3;
    if (s.arena === "rings") {
      const walls = conveyorRingWalls(this.layout.ringRadii, ctx.config.gapSize || 0.3, this.layout.maxBallRadius);
      const rotations = ctx.getWallRotations();
      const keep = !fresh && rotations.length === walls.length ? rotations.slice() : walls.map(() => 0);
      ctx.setCircularWalls(walls);
      ctx.setWallRotations(keep);
      ctx.getBrokenWalls().clear();
    } else if (ctx.getCircularWalls().length > 0) {
      ctx.setCircularWalls([]);
      ctx.setWallRotations([]);
    }
  }

  /** The ball's slot, or −1 (not one of the conveyor's). */
  private slotOf(ball: Ball): number {
    const k = this.slotOfId.get(ball.id);
    return k === undefined ? -1 : k;
  }

  /** Rings: ball `k` has been inside longer than its patience (`PATIENCE_SEC` + its share of `PATIENCE_SPREAD_SEC`): the director helps it. */
  private helped(k: number): boolean {
    return this.subMs - this.insideMs[k] >= (PATIENCE_SEC + this.uPatience[k] * PATIENCE_SPREAD_SEC) * 1000;
  }

  /**
   * Ball `k` comes out of the hatch onto the belt (the hum starts: the belt carries it to the drop point). `hum` false: its hum
   * waits for the run's first step (`humPending`) – the first ball comes out at init, and a page plays nothing before its run.
   */
  private release(ctx: ModeContext, k: number, hum = true) {
    const L = this.layout!;
    const v = this.view;
    const base = ctx.config.ballRadius || 8;
    const radius = base * v.slotScale[k];
    // On the simulation clock: a ball due part-way through the step waits in the hatch for the rest of it (its progress
    // starts below 0), so it drops exactly `conveyorRideSec()` after its load time, whatever the frame rate.
    this.progress[k] = (-L.beltSpeed * Math.max(0, conveyorLoadMs(k, this.settings.interval) - this.stepStartMs)) / 1000;
    const x = L.beltStartX;
    const y = L.beltY - radius - 0.5;
    ctx.addBall({ x, y, vx: L.beltSpeed, vy: 0, radius, radiusScale: v.slotScale[k], color: v.slotColor[k], gravityScale: 0 });
    const id = ctx.getNextId() - 1;
    this.ballId[k] = id;
    this.slotOfId.set(id, k);
    this.pinX[k] = x;
    this.pinY[k] = y;
    v.slotState[k] = CV_RIDING;
    v.released++;
    if (hum) this.hum(ctx, k);
    else this.humPending = true;
  }

  /** The belt hums while it carries ball `k` – until the next ball comes out (their hums join up), the last one all the way. */
  private hum(ctx: ModeContext, k: number) {
    const v = this.view;
    v.hums++;
    const ride = conveyorRideSec(this.layout!);
    const seconds = k < v.max - 1 ? Math.min(ride, this.settings.interval) : ride;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: HUM_FREQUENCY, conveyor: "hum", cvSec: seconds, level: 0.7, melody: false });
  }

  /** Ball `k` reaches the end of the belt and drops: the click; into the loading tube (rings) or free (bowl, pegs). */
  private drop(ctx: ModeContext, ball: Ball, k: number) {
    const L = this.layout!;
    const v = this.view;
    ball.x = L.dropX;
    v.loaded++;
    v.clicks++;
    v.lastDropMs = this.subMs;
    if (v.dropTimes.length < DROP_LOG) v.dropTimes.push(Math.round(this.subMs));
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, conveyor: "click", level: 1, melody: false });
    if (this.settings.arena === "rings") {
      v.slotState[k] = CV_CHUTE;
      this.progress[k] = 0;
      this.pinX[k] = L.dropX;
      this.pinY[k] = ball.y;
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    v.slotState[k] = CV_FREE;
    ball.vx = (2 * this.uJitter[k] - 1) * DROP_JITTER;
    ball.vy = 0;
    ball.gravityScale = 1;
    this.insideMs[k] = this.subMs;
    this.anchorX[k] = ball.x;
    this.anchorY[k] = ball.y;
    this.resting[k] = 0;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    this.notesThisStep = 0;
    // A live change of the Ball Size re-spaces the arena (the rings' gaps, the pegs, the bowl) and re-seats the frozen balls;
    // a new Wall Count or Gap Size rebuilds the rings.
    if (this.layout && ((ctx.config.ballRadius || 8) !== this.layout.ballRadius || (ctx.config.wallCount || 7) !== this.lastWallCount || (ctx.config.gapSize || 0.3) !== this.lastGapSize)) {
      const sizeOnly = (ctx.config.ballRadius || 8) !== this.layout.ballRadius;
      this.rebuild(ctx);
      if (sizeOnly) this.reseatFrozen(ctx);
    }
    this.stepStartMs = this.clockMs;
    this.subIndex = 0;
    this.subLenMs = 0;
    this.subMs = this.clockMs;
    this.clockMs += dtMs;
    v.timeMs = this.clockMs;
    // A new Ball Colour: the balls that wear it follow (the engine handed it to every ball; the palette ones get theirs back).
    if (ctx.config.ballColor !== this.lastBallColor) this.recolor(ctx);
    if (this.humPending) {
      this.humPending = false;
      this.hum(ctx, 0);
    }
    // Balls due by now come out of the hatch.
    while (v.released < v.max && this.clockMs + 1e-6 >= conveyorLoadMs(v.released, this.settings.interval)) this.release(ctx, v.released);
  }

  /** Gerald and the balls that wear the Ball Colour take the new one; the others keep their palette colour. */
  private recolor(ctx: ModeContext) {
    const v = this.view;
    this.lastBallColor = ctx.config.ballColor;
    for (let k = 0; k < v.max; k++) v.slotColor[k] = conveyorBallColor(k, this.uColor[k], this.uPalette[k], this.settings.variety, ctx.config.ballColor);
    for (const ball of ctx.getBalls()) {
      const k = this.slotOf(ball);
      if (k >= 0) ball.color = v.slotColor[k];
    }
  }

  /** After a Ball Size change the frozen balls take their ball's new size. */
  private reseatFrozen(ctx: ModeContext) {
    const base = ctx.config.ballRadius || 8;
    for (let i = 0; i < this.frozen.length; i++) this.frozen[i].radius = base * this.view.slotScale[this.frozenSlot[i]];
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const k = this.slotOf(ball);
    if (k < 0 || !this.layout) return;
    const L = this.layout;
    const v = this.view;
    this.subLenMs = dtSec * 1000;
    this.subMs = this.stepStartMs + (this.subIndex + 1) * this.subLenMs;
    switch (v.slotState[k]) {
      case CV_RIDING: {
        this.progress[k] += L.beltSpeed * dtSec;
        ball.y = L.beltY - ball.radius - 0.5;
        ball.vx = L.beltSpeed;
        ball.vy = 0;
        ball.gravityScale = 0;
        if (L.beltStartX + this.progress[k] >= L.dropX) {
          ball.x = L.dropX;
          this.drop(ctx, ball, k);
        } else ball.x = L.beltStartX + Math.max(0, this.progress[k]);
        this.pinX[k] = ball.x;
        this.pinY[k] = ball.y;
        return;
      }
      case CV_CHUTE: {
        // Down the loading tube into the core, accelerating.
        this.progress[k] = Math.min(1, this.progress[k] + dtSec / CHUTE_SEC);
        const p = this.progress[k];
        const fromY = L.beltY - ball.radius - 0.5;
        const y = fromY + (L.cy - fromY) * p * p;
        ball.vx = 0;
        ball.vy = dtSec > 0 ? (y - ball.y) / dtSec : 0;
        ball.x = L.cx;
        ball.y = y;
        ball.gravityScale = 0;
        this.pinX[k] = ball.x;
        this.pinY[k] = ball.y;
        return;
      }
      case CV_CARRIED: {
        ball.x += L.bottomBeltSpeed * dtSec;
        ball.y = L.bottomBeltY - ball.radius - 0.5;
        ball.vx = L.bottomBeltSpeed;
        ball.vy = 0;
        ball.gravityScale = 0;
        this.pinX[k] = ball.x;
        this.pinY[k] = ball.y;
        if (ball.x - ball.radius > L.exitX) this.gone(k);
        return;
      }
      case CV_FROZEN:
        ball.x = this.pinX[k];
        ball.y = this.pinY[k];
        ball.vx = 0;
        ball.vy = 0;
        ball.gravityScale = 0;
        return;
      case CV_FREE:
      case CV_ESCAPED:
        this.stepFree(ctx, ball, k, dtSec);
        return;
      default:
        return;
    }
  }

  /** A ball under the physics: the frozen balls, the escaped balls' dome, the belt's underside and the bottom belt's catch. */
  private stepFree(ctx: ModeContext, ball: Ball, k: number, dtSec: number) {
    const L = this.layout!;
    const v = this.view;
    const bounciness = ctx.getPhysicsExtras().wallBounciness;
    const ballBounce = ball.restitution ?? 1; // --- bounce-math --- the ball's own bounciness on top of the obstacle's
    // The frozen balls are obstacles (resolved here, so a frozen ball never pushes itself).
    for (let i = 0; i < this.frozen.length; i++) {
      const o = this.frozen[i];
      const reach = o.radius + ball.radius + 2;
      const dx = ball.x - o.x;
      const dy = ball.y - o.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      const impact = resolveBallCircle(ball, o, dtSec, bounciness, undefined, ballBounce);
      if (impact >= COLLIDE_SOUND_SPEED) {
        ctx.noteBounce?.(ball); // --- bounce-math ---
        this.note(ctx, conveyorFrozenPitch(v.settings.scale, v.settings.rootNote), 0.55, 2);
      }
    }
    if (v.slotState[k] === CV_ESCAPED) {
      // Out of the rings: the outer ring is a dome to roll off.
      const walls = ctx.getCircularWalls();
      if (walls.length > 0) {
        const d = this.dome;
        d.x = ctx.config.width / 2;
        d.y = ctx.config.height / 2;
        d.radius = walls[walls.length - 1].radius + 1;
        resolveBallCircle(ball, d, dtSec, bounciness, undefined, ballBounce);
      }
    }
    // The belt's underside: nothing flies above it.
    if (ball.vy < 0 && ball.y - ball.radius < L.ceilingY) {
      ball.y = L.ceilingY + ball.radius;
      ball.vy = -ball.vy * WALL_RESTITUTION;
    }
    // The bottom belt catches whatever falls onto it.
    if (L.bottomBeltY > 0 && ball.vy >= 0 && ball.y + ball.radius >= L.bottomBeltY && ball.x > L.left - ball.radius && ball.x < L.exitX + ball.radius) {
      v.slotState[k] = CV_CARRIED;
      ball.y = L.bottomBeltY - ball.radius - 0.5;
      ball.vx = L.bottomBeltSpeed;
      ball.vy = 0;
      ball.gravityScale = 0;
      this.pinX[k] = ball.x;
      this.pinY[k] = ball.y;
      this.note(ctx, conveyorHitFrequency(ball.radius) / 2, 0.45, 3, false);
      return;
    }
    if (this.settings.arena === "bowl" && L.bowl && !(this.flags[k] & FLAG_OVERFLOW)) {
      // Spilled over the rim: below it and outside the bowl's walls.
      const b = L.bowl;
      if (ball.y > b.rimY + ball.radius && Math.abs(ball.x - b.cx) > b.halfWidth + BOWL_THICKNESS / 2 + 0.5 * ball.radius) {
        this.flags[k] |= FLAG_OVERFLOW;
        v.overflow++;
      }
    } else if (this.settings.arena === "pegs" && !(this.flags[k] & FLAG_LANDED) && ball.y - ball.radius > L.binTop) {
      this.flags[k] |= FLAG_LANDED;
      v.landed++;
    }
  }

  /** Queues a note of the mode (within the step's budget). `melody` false: an accompaniment that leaves the tune alone. */
  private note(ctx: ModeContext, frequency: number, level: number, wallIndex = 0, melody = true) {
    if (this.notesThisStep >= MAX_NOTES_PER_STEP) return;
    this.notesThisStep++;
    this.view.notes++;
    ctx.addPendingSoundEvent(melody ? { type: "hit", wallIndex, frequency, level } : { type: "hit", wallIndex, frequency, level, melody: false });
  }

  /** Ball `k` left the field: removed from the engine at the end of the step. */
  private gone(k: number) {
    const v = this.view;
    if (v.slotState[k] === CV_GONE) return;
    v.slotState[k] = CV_GONE;
    v.carried++;
    this.goneThisStep++;
  }

  onPostSubStep(ctx: ModeContext) {
    const L = this.layout;
    if (!L) return;
    const v = this.view;
    this.subMs = this.stepStartMs + (this.subIndex + 1) * this.subLenMs;
    const rings = this.settings.arena === "rings";
    const walls = rings ? ctx.getCircularWalls() : null;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const k = this.slotOf(ball);
      if (k < 0) continue;
      const state = v.slotState[k];
      if (state === CV_RIDING || state === CV_CHUTE || state === CV_CARRIED || state === CV_FROZEN) {
        // Scripted (and frozen) balls stay where their script has them, whatever the pair pass did.
        ball.x = this.pinX[k];
        ball.y = this.pinY[k];
        if (state === CV_CHUTE && this.progress[k] >= 1) this.launch(ctx, ball, k);
        continue;
      }
      if (state === CV_FREE && rings && walls && walls.length > 0) {
        if (this.steerWall[k] >= 0) this.steer(ctx, ball, k, walls, cx, cy);
        this.trackRings(ctx, ball, k, walls, cx, cy);
      }
      else if (state === CV_FREE || state === CV_ESCAPED) {
        // Safety net behind the side walls: a ball shoved across one is put back inside (the carried ones leave under the right one).
        if (ball.x < L.left) {
          ball.x = L.left + ball.radius;
          if (ball.vx < 0) ball.vx = -ball.vx * WALL_RESTITUTION;
        } else if (ball.x > L.right && !(L.bottomBeltY > 0 && ball.y > L.bottomBeltY - 2.4 * L.maxBallRadius - 6)) {
          ball.x = L.right - ball.radius;
          if (ball.vx > 0) ball.vx = -ball.vx * WALL_RESTITUTION;
        }
        // Anything that still got out of the field (under the right wall, or below it) is gone.
        if (ball.x - ball.radius > L.exitX || ball.y - ball.radius > L.height + 40) this.gone(k);
      }
    }
    this.subIndex++;
    this.subMs = this.stepStartMs + (this.subIndex + 1) * this.subLenMs;
  }

  /** Rings: ball `k` out of the tube in the core, launched at the Ball Speed in its seeded direction. */
  private launch(ctx: ModeContext, ball: Ball, k: number) {
    const v = this.view;
    const a = this.uAngle[k] * TWO_PI;
    const speed = (ctx.config.ballSpeed || 400) * (ball.mult ? ball.mult.speed : 1);
    ball.vx = Math.cos(a) * speed;
    ball.vy = Math.sin(a) * speed;
    ball.gravityScale = 1;
    v.slotState[k] = CV_FREE;
    this.insideMs[k] = this.subMs;
    this.layer[k] = 0;
    ctx.getLastWallLayer().set(ball.id, -1);
  }

  /** Rings: the rings a ball inside has passed (a note each) and its escape (the wall-break sound and confetti). */
  private trackRings(ctx: ModeContext, ball: Ball, k: number, walls: readonly CircularWall[], cx: number, cy: number) {
    const v = this.view;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    let passed = 0;
    for (let w = 0; w < walls.length; w++) if (dist > walls[w].radius + ball.radius) passed = w + 1;
    if (passed > this.layer[k]) {
      for (let w = this.layer[k]; w < passed && w < walls.length - 1; w++) {
        v.passes++;
        const angle = Math.atan2(dy, dx);
        ctx.addWallHit(w, angle < 0 ? angle + TWO_PI : angle, walls[w].radius);
        this.note(ctx, conveyorPassPitch(w, v.settings.scale, v.settings.rootNote), 0.9, w);
      }
      this.layer[k] = passed;
    }
    const outer = walls[walls.length - 1].radius;
    if (dist > outer + ball.radius + ESCAPE_MARGIN) {
      v.slotState[k] = CV_ESCAPED;
      v.escaped++;
      v.passes++;
      v.lastEscapeMs = this.subMs;
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: walls.length - 1 });
      ctx.spawnConfetti(ball.x, ball.y);
      ctx.noteImpact?.();
    }
  }

  onWallHit() {}

  /**
   * The rings never break: every ball faces them all (a gap pass is just a pass). A ball under the director's help slips
   * through cleanly: while it crosses the wall in the gap it heads straight out, turning with the ring, at its speed.
   */
  onGapPass(ctx: ModeContext, ball: Ball, wallIndex: number) {
    if (this.settings.arena !== "rings") return true;
    const k = this.slotOf(ball);
    if (k < 0 || this.view.slotState[k] !== CV_FREE || !this.helped(k)) return true;
    const dx = ball.x - ctx.config.width / 2;
    const dy = ball.y - ctx.config.height / 2;
    const d = Math.hypot(dx, dy);
    const speed = Math.hypot(ball.vx, ball.vy);
    if (!(d > 0) || !(speed > 0)) return true;
    const nx = dx / d;
    const ny = dy / d;
    const turn = Math.max(-0.5 * speed, Math.min(0.5 * speed, (ctx.config.rotationSpeed ?? 1) * 0.8 * (wallIndex % 2 === 0 ? 1 : -1) * d));
    const out = Math.sqrt(Math.max(0, speed * speed - turn * turn));
    ball.vx = nx * out - ny * turn;
    ball.vy = ny * out + nx * turn;
    return true;
  }

  /**
   * Rings: a ball inside for longer than its patience gets the director's help ("Gerald always escapes") – its rebound off
   * the ring it is in is aimed at that ring's gap at the end of the sub-step (`steer()`, with the speed the engine gave the
   * rebound). Draws no random numbers.
   */
  adjustRebound(ctx: ModeContext, ball: Ball, wallIndex: number, outAngle: number): number {
    if (this.settings.arena !== "rings") return outAngle;
    const k = this.slotOf(ball);
    if (k < 0 || this.view.slotState[k] !== CV_FREE || !this.helped(k)) return outAngle;
    this.steerWall[k] = wallIndex;
    return outAngle;
  }

  /**
   * Rings: the director's aim for ball `k`, which rebounded off ring `steerWall[k]` from inside this sub-step: the direction
   * whose flight – timed through the engine's own motion, the ring turning step by step meanwhile – meets the ring's gap
   * (`steerToGap()`), at the speed the rebound has.
   */
  private steer(ctx: ModeContext, ball: Ball, k: number, walls: readonly CircularWall[], cx: number, cy: number) {
    const w = this.steerWall[k];
    this.steerWall[k] = -1;
    const wall = walls[w];
    if (!wall || wall.gaps.length === 0) return;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const speed = Math.hypot(ball.vx, ball.vy);
    if (!(dist > 0) || dist >= wall.radius || !(speed > 0)) return;
    const base = ctx.config.ballSpeed || 400;
    const aim = steerToGap({
      bx: dx,
      by: dy,
      radius: wall.radius,
      innerRadius: w > 0 && walls[w - 1] ? walls[w - 1].radius : 0,
      ballRadius: ball.radius,
      gapMid: (wall.gaps[0].startAngle + wall.gaps[0].endAngle) / 2 + (ctx.getWallRotations()[w] ?? 0),
      omega: (ctx.config.rotationSpeed ?? 1) * 0.8 * (w % 2 === 0 ? 1 : -1),
      gapHalf: Math.max(0, (wall.gaps[0].endAngle - wall.gaps[0].startAngle) / 2 - Math.atan2(ball.radius, wall.radius)),
      speed,
      gravity: (ctx.config.gravity ?? 0) * (base / 300) * (ball.gravityScale ?? 1),
      cruise: cruiseSpeed(ball, base),
      stepSec: (this.clockMs - this.stepStartMs) / 1000,
      nextTurnSec: Math.max(0, this.clockMs - this.subMs) / 1000,
    });
    if (aim === null) return;
    ball.vx = Math.cos(aim) * speed;
    ball.vy = Math.sin(aim) * speed;
  }

  /** The side walls are silent; the bowl, the bins and the floor play the ball's size, the pegs their column. */
  onObstacleHit(ctx: ModeContext, ball: Ball, _obstacle: Obstacle, index: number): ObstacleHitResult {
    const L = this.layout;
    if (!L || index >= L.kinds.length) return { suppressSound: true };
    const kind = L.kinds[index];
    if (kind === KIND_WALL) return { suppressSound: true };
    if (this.notesThisStep >= MAX_NOTES_PER_STEP) return { suppressSound: true };
    this.notesThisStep++;
    this.view.notes++;
    const v = this.view;
    // Pegs, no freeze: a ball that keeps landing on the same peg is nudged off it later (onPostUpdate).
    if (kind === KIND_PEG) return { frequency: conveyorPegPitch(L.slots[index], v.settings.scale, v.settings.rootNote) };
    return { frequency: conveyorHitFrequency(ball.radius) };
  }

  /**
   * Right after the engine's elastic pair rebound: a frozen ball is an obstacle (it stays put and the other one rebounds off
   * it), the pile's hits are damped like Ball Drop's, and a hard hit plays a soft note.
   */
  onBallCollision(ctx: ModeContext, a: Ball, b: Ball) {
    const ka = this.slotOf(a);
    const kb = this.slotOf(b);
    const v = this.view;
    const fa = ka >= 0 && v.slotState[ka] === CV_FROZEN;
    const fb = kb >= 0 && v.slotState[kb] === CV_FROZEN;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const nx = dx / dist;
    const ny = dy / dist;
    if (fa || fb) {
      const frozen = fa ? a : b;
      const k = fa ? ka : kb;
      const other = fa ? b : a;
      // The engine's equal-mass rebound handed the frozen ball the other's approach: take it back as a static rebound.
      const rel = frozen.vx * nx + frozen.vy * ny; // (the other's normal speed toward the frozen one, along n from a to b)
      if (!(fa && fb)) {
        const e = FROZEN_RESTITUTION;
        other.vx -= e * rel * nx;
        other.vy -= e * rel * ny;
        // The frozen ball took half of the overlap's push-out: the other one takes all of it.
        const ox = frozen.x - this.pinX[k];
        const oy = frozen.y - this.pinY[k];
        other.x -= ox;
        other.y -= oy;
      }
      frozen.vx = 0;
      frozen.vy = 0;
      frozen.x = this.pinX[k];
      frozen.y = this.pinY[k];
      return;
    }
    const an = a.vx * nx + a.vy * ny;
    const bn = b.vx * nx + b.vy * ny;
    const impact = Math.abs(an - bn);
    if (this.settings.arena !== "rings") {
      const centre = (an + bn) / 2;
      const da = centre + BALL_TO_BALL_RESTITUTION * (an - centre) - an;
      const db = centre + BALL_TO_BALL_RESTITUTION * (bn - centre) - bn;
      a.vx += da * nx;
      a.vy += da * ny;
      b.vx += db * nx;
      b.vy += db * ny;
    }
    if (impact >= 2 * COLLIDE_SOUND_SPEED) this.note(ctx, conveyorHitFrequency(Math.min(a.radius, b.radius)), Math.min(0.6, 0.25 + impact / 1200), 1);
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const L = this.layout;
    if (!L) return;
    const v = this.view;
    const s = this.settings;
    const rings = s.arena === "rings";
    const balls = ctx.getBalls();
    // Rings: a ball's freedom runs out (freeze on).
    if (rings && s.freeze) {
      for (const ball of balls) {
        const k = this.slotOf(ball);
        if (k >= 0 && v.slotState[k] === CV_FREE && this.clockMs - this.insideMs[k] >= FREEZE_SEC * 1000) this.freeze(ball, k);
      }
    }
    // Bowl and pegs: the rest windows – a ball that moved less than REST_DISTANCE over one is at rest (and freezes with freeze on;
    // without it a ball resting on a peg above the bins is nudged off, a few times at most).
    if (!rings && this.clockMs + 1e-6 >= this.restWindowEndMs) {
      this.restWindowEndMs += REST_WINDOW_MS;
      for (const ball of balls) {
        const k = this.slotOf(ball);
        if (k < 0 || v.slotState[k] !== CV_FREE) continue;
        const moved = Math.hypot(ball.x - this.anchorX[k], ball.y - this.anchorY[k]);
        this.anchorX[k] = ball.x;
        this.anchorY[k] = ball.y;
        const rest = moved < REST_DISTANCE;
        this.resting[k] = rest ? 1 : 0;
        if (!rest) continue;
        if (s.freeze) this.freeze(ball, k);
        else if (s.arena === "pegs" && ball.y - ball.radius < L.binTop && this.perches[k] < MAX_PERCHES) {
          ball.vx += PERCH_KICK * (ball.x <= L.cx ? 1 : -1);
          this.perches[k]++;
          this.resting[k] = 0;
        }
      }
    }
    if (this.goneThisStep > 0) {
      ctx.setBalls(balls.filter((b) => {
        const k = this.slotOf(b);
        if (k >= 0 && v.slotState[k] === CV_GONE) {
          this.slotOfId.delete(b.id);
          return false;
        }
        return true;
      }));
      this.goneThisStep = 0;
    }
    // The counters the HUD shows, and the end.
    let riding = 0;
    let inside = 0;
    let active = 0;
    for (let k = 0; k < v.released; k++) {
      const st = v.slotState[k];
      if (st === CV_RIDING) riding++;
      if (st === CV_CHUTE || (rings && st === CV_FREE)) inside++;
      if (st === CV_RIDING || st === CV_CHUTE || st === CV_ESCAPED || st === CV_CARRIED) active++;
      else if (st === CV_FREE && (rings || !this.resting[k])) active++;
    }
    v.riding = riding;
    v.inside = inside;
    if (!v.allDone && v.loaded >= v.max) {
      const timedOut = this.clockMs - v.lastDropMs >= SETTLE_TIMEOUT_MS;
      if (active === 0 || timedOut) {
        v.allDone = true;
        v.timedOut = active > 0;
        v.doneAtMs = this.clockMs;
        ctx.spawnConfetti(L.cx, L.top + 0.4 * L.fieldHeight);
      }
    }
    if (v.allDone && !v.finished && this.clockMs >= v.doneAtMs + FINAL_HOLD_MS - 1e-6) {
      v.finished = true;
      v.finishedMs = this.clockMs;
    }
    void dtMs;
  }

  /** Ball `k` freezes where it is: an obstacle for the others from now on. */
  private freeze(ball: Ball, k: number) {
    const v = this.view;
    v.slotState[k] = CV_FROZEN;
    v.frozen++;
    ball.vx = 0;
    ball.vy = 0;
    ball.gravityScale = 0;
    this.pinX[k] = ball.x;
    this.pinY[k] = ball.y;
    this.frozen.push(circleObstacle(ball.x, ball.y, ball.radius, { restitution: FROZEN_RESTITUTION }));
    this.frozenSlot.push(k);
  }

  /**
   * A resize rebuilds the field for the new canvas. Before the first step the balls on the belt are placed afresh, exactly as
   * an init at the new size would place them (the seed finder builds its engine at the page's size: the same seed replays the
   * same run); later every ball keeps its place in the field – the belts' by their progress, the others mapped field to field.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean, wallCountChanged: boolean, gapChanged: boolean) {
    if (!this.layout) return true;
    if (!sizeChanged) {
      if (wallCountChanged || gapChanged) this.rebuild(ctx);
      return true;
    }
    const old = this.layout;
    this.rebuild(ctx, this.clockMs === 0);
    const L = this.layout!;
    const kx = L.fieldWidth / old.fieldWidth;
    const ky = L.fieldHeight / old.fieldHeight;
    const v = this.view;
    const mapX = (x: number) => L.left + (x - old.left) * kx;
    const mapY = (y: number) => L.top + (y - old.top) * ky;
    for (const ball of ctx.getBalls()) {
      const k = this.slotOf(ball);
      if (k < 0) continue;
      ball.trail.length = 0;
      ball.trailIndex = 0;
      const st = v.slotState[k];
      if (st === CV_RIDING) {
        this.progress[k] *= kx;
        ball.x = Math.min(L.dropX, L.beltStartX + Math.max(0, this.progress[k]));
        ball.y = L.beltY - ball.radius - 0.5;
      } else if (st === CV_CHUTE) {
        ball.x = L.cx;
        ball.y = L.beltY - ball.radius - 0.5 + (L.cy - (L.beltY - ball.radius - 0.5)) * this.progress[k] * this.progress[k];
      } else if (st === CV_CARRIED) {
        ball.x = mapX(this.pinX[k]);
        ball.y = L.bottomBeltY - ball.radius - 0.5;
      } else if (st === CV_FROZEN) {
        ball.x = mapX(this.pinX[k]);
        ball.y = mapY(this.pinY[k]);
      } else {
        // The engine scaled the positions around the canvas centre; take them back and map them into the new field.
        const ox = old.width / 2 + ((ball.x - L.width / 2) * old.width) / L.width;
        const oy = old.height / 2 + ((ball.y - L.height / 2) * old.height) / L.height;
        ball.x = mapX(ox);
        ball.y = mapY(oy);
        this.anchorX[k] = ball.x;
        this.anchorY[k] = ball.y;
      }
      this.pinX[k] = ball.x;
      this.pinY[k] = ball.y;
    }
    for (let i = 0; i < this.frozen.length; i++) {
      const k = this.frozenSlot[i];
      this.frozen[i].x = this.pinX[k];
      this.frozen[i].y = this.pinY[k];
    }
    return true;
  }

  /** The engine's rings resolve only the balls inside them (the rings arena); every other ball is the mode's or the obstacles'. */
  shouldSkipWallCollision(ball: Ball) {
    if (this.settings.arena !== "rings") return true;
    const k = this.slotOf(ball);
    return k < 0 || this.view.slotState[k] !== CV_FREE;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { arena: v.settings.arena, max: v.max, loaded: v.loaded, escaped: v.escaped, overflow: v.overflow, landed: v.landed, frozen: v.frozen, carried: v.carried, finished: v.finished };
  }
}
