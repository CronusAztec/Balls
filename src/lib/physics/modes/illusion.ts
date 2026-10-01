import { midiToFrequency } from "@/lib/audio/scales";
import { resolveBallObstacle } from "../obstacles";
import { CoverageGrid, ILLUSION_PATTERNS, buildIllusionPattern, isIllusionPatternId, isLegalPosition, type IllusionPattern, type IllusionPatternId } from "../illusionPatterns";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";
import { DEFAULT_WALL_WOBBLE, resolveWallWobble } from "../wobble";
import { buildPendulumField, pendulumPitch, type PendulumField } from "./pendulum";

/**
 * Circle Illusion ("illusion" mode, rhythm family – feature jdm-illusions; the project.jdm "Circle Bounce ILLUSION",
 * "This Circle ILLUSION is WILD", "GET THE WHITE SPACES" and "circle collide circle" formats). No rings to escape:
 * the mode owns its playfield like the other rhythm modes (the "none" ring layout, ordinary engine balls pinned to
 * the positions it computes – see pendulum.ts / polyrhythm.ts) and every contact is a note through the ToneGenerator.
 * Four types:
 *
 *  - `lines` – the straight-line / rolling-circle illusion (the Tusi couple): N balls each move back and forth along a
 *    diameter of the big circle, ball i on the diameter at angle i·π/N with the phase offset i·π/N:
 *        pᵢ(t) = c + A cos(θ(t) − i·π/N) · u(i·π/N + β),   θ(t) = ±2π t / T.
 *    Since cos(θ − α)·u(α) = ½[u(θ) + u(2α − θ)], every ball lies on the circle of radius A/2 around c + (A/2)·u(θ + β)
 *    – a smaller circle rolling inside the big one – at the angle 2α − θ, evenly spaced. Each ball plays its note when it
 *    touches the rim (the ends of its diameter): one touch every T / (2N), going round the rim.
 *  - `rings` – concentric rings that each hold one ball bouncing between the ring's inner and outer wall at a constant
 *    speed; ring k turns (K − k) times per cycle, so the bounce points form travelling spirals, and the bounces are
 *    staggered by a K-th of a traversal from ring to ring, so the notes ripple outward. Every cycle the balls line up
 *    again on one radius (a flash and an accent).
 *  - `nested` – a circle bouncing inside a circle inside a circle (2–5 moving circles in the fixed arena): elastic
 *    collisions between each circle and its container (masses ∝ radius, momentum and energy conserved), integrated in
 *    fixed sub-steps from seeded initial velocities; every layer's wall wobbles where it is hit (render-only).
 *  - `whitespace` – balls paint the white arena black wherever they go and bounce off invisible shapes they can never
 *    enter, every rebound steered toward the white they can still reach; the white spaces left are the hidden picture (a
 *    heart, a star, a smile… chosen by the seed), revealed with a flash when the paintable area is covered – or, from
 *    90 %, once the painters have found no new white for six seconds (see illusionPatterns.ts).
 *
 * Deterministic: lines and rings are analytic in the step counter (touches are counted exactly per step with the same
 * boundary values in consecutive steps, so none is missed or doubled), nested and whitespace integrate in fixed
 * sub-steps and draw every random number from `ctx.random()`. Wall contacts go to the engine's contact log
 * (`ctx.recordWallContact`) for the canvas' wobbly walls.
 */

export const ILLUSION_TYPES = ["lines", "rings", "nested", "whitespace"] as const;
export type IllusionType = (typeof ILLUSION_TYPES)[number];
export const ILLUSION_PATTERN_CHOICES = ["auto", ...ILLUSION_PATTERNS] as const;
export type IllusionPatternChoice = (typeof ILLUSION_PATTERN_CHOICES)[number];

export function isIllusionType(value: unknown): value is IllusionType {
  return typeof value === "string" && (ILLUSION_TYPES as readonly string[]).includes(value);
}
export function isIllusionPatternChoice(value: unknown): value is IllusionPatternChoice {
  return value === "auto" || isIllusionPatternId(value);
}

export interface IllusionSettings {
  type: IllusionType;
  /** lines: balls on diameters, 2–32. */
  balls: number;
  /** rings: rings, 2–16. */
  rings: number;
  /** nested: moving circles inside the arena, 2–5. */
  depth: number;
  /** whitespace: painting balls, 1–12. */
  painters: number;
  /** whitespace: the hidden picture, or "auto" – chosen by the seed. */
  pattern: IllusionPatternChoice;
  /** Tempo of every type, 0.25–3 (1 = a lines cycle of 4 s, a rings cycle of 24 s). */
  speed: number;
  /** lines: the diameters; rings: the rails the balls ride on. */
  tracks: boolean;
  /** lines: the hidden rolling circle; rings: a line through the balls (the travelling pattern). */
  reveal: boolean;
  /** lines / rings: the run finishes after this many cycles; 0 = never. */
  cycles: number;
}

export const DEFAULT_ILLUSION_SETTINGS: IllusionSettings = {
  type: "lines",
  balls: 8,
  rings: 8,
  depth: 3,
  painters: 5,
  pattern: "auto",
  speed: 1,
  tracks: true,
  reveal: false,
  cycles: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const ILLUSION_RANGES = {
  ilBalls: { min: 2, max: 32, step: 1 },
  ilRings: { min: 2, max: 16, step: 1 },
  ilDepth: { min: 2, max: 5, step: 1 },
  ilPainters: { min: 1, max: 12, step: 1 },
  ilSpeed: { min: 0.25, max: 3, step: 0.05 },
  ilCycles: { min: 0, max: 20, step: 1 },
} as const;

/** The Circle Illusion fields of the SimulatorSettings object (URL keys ilt, ilb, ilr, ild, ilp, ilpt, ils, iltr, ilrv, ilc). */
export interface IllusionSettingFields {
  ilType: IllusionType;
  ilBalls: number;
  ilRings: number;
  ilDepth: number;
  ilPainters: number;
  ilPattern: IllusionPatternChoice;
  ilSpeed: number;
  ilTracks: boolean;
  ilReveal: boolean;
  ilCycles: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value (counts and cycles whole, the speed on its 0.05 steps); unknown options fall back to the defaults. */
export function resolveIllusionSettings(config: Partial<IllusionSettings> | null | undefined): IllusionSettings {
  const out = { ...DEFAULT_ILLUSION_SETTINGS };
  if (!config) return out;
  const R = ILLUSION_RANGES;
  if (isIllusionType(config.type)) out.type = config.type;
  if (config.balls !== undefined) out.balls = Math.round(clampNumber(config.balls, R.ilBalls, out.balls));
  if (config.rings !== undefined) out.rings = Math.round(clampNumber(config.rings, R.ilRings, out.rings));
  if (config.depth !== undefined) out.depth = Math.round(clampNumber(config.depth, R.ilDepth, out.depth));
  if (config.painters !== undefined) out.painters = Math.round(clampNumber(config.painters, R.ilPainters, out.painters));
  if (isIllusionPatternChoice(config.pattern)) out.pattern = config.pattern;
  if (config.speed !== undefined) out.speed = Math.round(20 * clampNumber(config.speed, R.ilSpeed, out.speed)) / 20;
  if (typeof config.tracks === "boolean") out.tracks = config.tracks;
  if (typeof config.reveal === "boolean") out.reveal = config.reveal;
  if (config.cycles !== undefined) out.cycles = Math.round(clampNumber(config.cycles, R.ilCycles, out.cycles));
  return out;
}

/** Picks the Circle Illusion settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setIllusionSettings()`. */
export function illusionSettingsOf(source: IllusionSettingFields): IllusionSettings {
  return {
    type: source.ilType,
    balls: source.ilBalls,
    rings: source.ilRings,
    depth: source.ilDepth,
    painters: source.ilPainters,
    pattern: source.ilPattern,
    speed: source.ilSpeed,
    tracks: source.ilTracks,
    reveal: source.ilReveal,
    cycles: source.ilCycles,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function illusionSettingFields(settings: IllusionSettings): IllusionSettingFields {
  return {
    ilType: settings.type,
    ilBalls: settings.balls,
    ilRings: settings.rings,
    ilDepth: settings.depth,
    ilPainters: settings.painters,
    ilPattern: settings.pattern,
    ilSpeed: settings.speed,
    ilTracks: settings.tracks,
    ilReveal: settings.reveal,
    ilCycles: settings.cycles,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** Everything of this feature the SimulatorSettings carries: the Circle Illusion fields and the global Wobbly Walls amount. */
export type IllusionFeatureFields = IllusionSettingFields & { wallWobble: number };

/** The defaults of the feature's fields (Wobbly Walls off). */
export function defaultIllusionFields(): IllusionFeatureFields {
  return { ...illusionSettingFields(DEFAULT_ILLUSION_SETTINGS), wallWobble: DEFAULT_WALL_WOBBLE };
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers, known options, real booleans. */
export function resolveIllusionFields(source: Partial<IllusionFeatureFields>): IllusionFeatureFields {
  const settings = resolveIllusionSettings({
    type: source.ilType,
    balls: source.ilBalls,
    rings: source.ilRings,
    depth: source.ilDepth,
    painters: source.ilPainters,
    pattern: source.ilPattern,
    speed: source.ilSpeed,
    tracks: source.ilTracks,
    reveal: source.ilReveal,
    cycles: source.ilCycles,
  });
  return { ...illusionSettingFields(settings), wallWobble: resolveWallWobble(source.wallWobble) };
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { ilb: "ilBalls", ilr: "ilRings", ild: "ilDepth", ilp: "ilPainters", ils: "ilSpeed", ilc: "ilCycles", wob: "wallWobble" } as const;
const BOOLEAN_KEYS = { iltr: "ilTracks", ilrv: "ilReveal" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: ilt, ilb, ilr, ild, ilp, ilpt, ils, iltr, ilrv, ilc and wob. */
export function writeIllusionParams(settings: IllusionFeatureFields, base: IllusionFeatureFields, params: URLSearchParams) {
  if (settings.ilType !== base.ilType) params.set("ilt", settings.ilType);
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  if (settings.ilPattern !== base.ilPattern) params.set("ilpt", settings.ilPattern);
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readIllusionParams(params: URLSearchParams, settings: IllusionFeatureFields) {
  const next: Partial<IllusionFeatureFields> = { ...settings };
  const type = params.get("ilt");
  if (isIllusionType(type)) next.ilType = type;
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const pattern = params.get("ilpt");
  if (isIllusionPatternChoice(pattern)) next.ilPattern = pattern;
  Object.assign(settings, resolveIllusionFields(next));
}

/* ------------------------------------------------------------------ timing and the finder */

/** Seconds of one lines cycle (one turn of the hidden rolling circle) at speed 1. */
export const LINE_CYCLE_SEC = 4;
/** Seconds of one rings cycle (every ring back in line) at speed 1. */
export const RING_CYCLE_SEC = 24;
/** Traversals (inner wall ↔ outer wall) of every ring ball per cycle – even, so the radial pattern repeats too. */
export const RING_TRAVERSALS = 24;

/** Length (s) of a cycle – lines: one turn of the rolling circle; rings: the ring alignment – or 0 for the types without cycles. */
export function illusionCycleSeconds(settings: Partial<IllusionSettings> | null | undefined): number {
  const s = resolveIllusionSettings(settings);
  if (s.type === "lines") return LINE_CYCLE_SEC / s.speed;
  if (s.type === "rings") return RING_CYCLE_SEC / s.speed;
  return 0;
}

/** True when a run never finishes: the nested circles bounce forever, lines and rings with the cycles at "never". */
export function illusionRunNeverFinishes(settings: Partial<IllusionSettings> | null | undefined): boolean {
  const s = resolveIllusionSettings(settings);
  if (s.type === "nested") return true;
  if (s.type === "whitespace") return false;
  return s.cycles === 0;
}

/** The run length (s) when the settings fix it whatever the seed (lines / rings: cycles × the cycle length), else null. */
export function illusionFixedDurationSec(settings: Partial<IllusionSettings> | null | undefined): number | null {
  const s = resolveIllusionSettings(settings);
  if ((s.type === "lines" || s.type === "rings") && s.cycles > 0) return s.cycles * illusionCycleSeconds(s);
  return null;
}

/* ------------------------------------------------------------------ the maths of the lines */

/** Angle of ball i's diameter and its phase offset (both i·π/N) – the classic straight-line / rolling-circle arrangement. */
export function linePhase(index: number, count: number): number {
  return (index * Math.PI) / Math.max(1, count);
}

/** Signed position of ball i along its diameter, in units of the half-travel A: cos(θ − i·π/N). */
export function lineOffset(theta: number, index: number, count: number): number {
  return Math.cos(theta - linePhase(index, count));
}

/**
 * Where ball i of N is (relative to the centre) at phase θ with half-travel A and the figure turned by β, written into
 * `out`. All N balls lie on the circle of radius A/2 around (A/2)·u(θ + β) – see `rollingCircleCentre()`.
 */
export function linePosition(theta: number, index: number, count: number, amplitude: number, rotation: number, out: { x: number; y: number }) {
  const s = amplitude * lineOffset(theta, index, count);
  const a = linePhase(index, count) + rotation;
  out.x = s * Math.cos(a);
  out.y = s * Math.sin(a);
  return out;
}

/** Centre (relative to the big circle's centre) of the hidden circle the balls form at phase θ. */
export function rollingCircleCentre(theta: number, amplitude: number, rotation: number, out: { x: number; y: number }) {
  out.x = (amplitude / 2) * Math.cos(theta + rotation);
  out.y = (amplitude / 2) * Math.sin(theta + rotation);
  return out;
}

/**
 * The rim touch of slot m (time m · T / (2N)): which ball touches and at which end. With direction d the phase is
 * θ = d·π·m/N; ball i touches when θ − i·π/N is a multiple of π, i.e. i ≡ d·m (mod N), at the + end when that multiple
 * is even. Returns the ball index and the touch angle (relative to the figure, before β).
 */
export function lineTouch(slot: number, count: number, direction: number): { ball: number; angle: number } {
  const n = Math.max(1, count);
  const dm = direction * slot;
  const ball = ((dm % n) + n) % n;
  const k = (dm - ball) / n;
  const end = ((k % 2) + 2) % 2 === 0 ? 0 : Math.PI;
  return { ball, angle: linePhase(ball, n) + end };
}

/* ------------------------------------------------------------------ the maths of the rings */

/** Triangle wave of the radial phase u: 0 at even u (inner wall), 1 at odd u (outer wall), linear in between. */
export function ringFraction(u: number): number {
  const s = u - 2 * Math.floor(u / 2);
  return s <= 1 ? s : 2 - s;
}

/* ------------------------------------------------------------------ the view */

/** What the canvas needs; the same object for the life of the mode (arrays are replaced when the counts change). */
export interface IllusionView {
  /** The settings of the last init, with the live display switches (tracks, reveal) applied at once. */
  settings: IllusionSettings;
  type: IllusionType;
  /** Incremented by every init. */
  generation: number;
  field: PendulumField;
  cx: number;
  cy: number;
  /** The big circle (lines, whitespace), the outermost ring wall (rings) or the fixed arena (nested), px. */
  radius: number;
  /** Bodies: balls, ring balls, moving circles or painters. */
  count: number;
  x: Float64Array;
  y: Float64Array;
  r: Float64Array;
  colors: string[];
  /** Step count after each body's last note (lines, rings, whitespace) or collision (nested); −1 before. */
  lastHitStep: Float64Array;
  /** Steps simulated in this run, the length of one (ms; 0 before the first) and the clock (s). */
  step: number;
  stepMs: number;
  timeSec: number;
  /** ±1 from the seed: the way the circle rolls / the rings turn. */
  direction: number;
  /** Lines / rings: the length of a cycle (s) and the cycles completed. */
  cycleSec: number;
  cyclesDone: number;
  finished: boolean;
  /** Notes played (every touch or hit) and sound events queued. */
  noteCount: number;
  eventCount: number;
  // lines
  /** Half the travel of every ball along its diameter (px) and the phase θ of the rolling circle. */
  amplitude: number;
  theta: number;
  /** Angle of the first diameter (β). */
  rotation: number;
  /** Largest distance (px) of a ball from the hidden rolling circle – 0 up to rounding; a probe for tools and the smoke test. */
  circleError: number;
  // rings
  /** Radii of the K + 1 ring walls (inner hole first). */
  boundaries: Float64Array;
  /** Angle of every ring's rail. */
  ringAngle: Float64Array;
  /** Alignments reached (every ball back on one radius) and the step count after the last one (−1 before). */
  alignCount: number;
  lastAlignStep: number;
  // nested
  /** The fixed arena (layer 0) and the moving circles: centres and radii in px. */
  layerCount: number;
  layerX: Float64Array;
  layerY: Float64Array;
  layerR: Float64Array;
  collisions: number;
  // whitespace
  pattern: IllusionPattern | null;
  /** Every painter's path (x, y pairs in px, `pathLen` floats used), stroked by the canvas into its paint layer. */
  paths: Float32Array[];
  pathLen: Int32Array;
  /** Bumped when the paths were rescaled (a canvas resize): the canvas repaints its layer from scratch. */
  pathVersion: number;
  painterRadius: number;
  /** Painted share of the paintable arena, 0–1, the step count at which the picture was revealed and its simulation time in ms (−1 before). */
  coverage: number;
  revealStep: number;
  revealAtMs: number;
  /** Wobble the canvas gives this mode's circles even with Wobbly Walls at 0: the nested circles wobble by design. */
  intrinsicWobble: number;
}

/** Wobble of the nested circles when Wobbly Walls is 0. */
export const NESTED_WOBBLE = 0.6;
/** Radius of the big circle / ring stack / arena as a fraction of the side of the centred square. */
export const ARENA_FRACTION = 0.46;
/** Inner hole of the ring stack, as a fraction of the side. */
export const RING_HOLE_FRACTION = 0.08;
/** Speeds, in arena radii per second at speed 1. */
export const NESTED_SPEED = 0.55;
export const PAINTER_SPEED = 1;
/** Innermost nested circle and painter radius (arena radii) at the default 8 px ball size. */
export const NESTED_INNER = 0.1;
export const PAINTER_RADIUS = 0.045;
export const NESTED_SUBSTEPS = 8;
export const PAINTER_SUBSTEPS = 4;
/** Random turn (radians, ±) a painter's rebound off the rim gets – keeps the paint from settling into a fixed pattern. */
export const RIM_SCATTER = 0.12;
/** Turns (radians) a painter's rebound – off the rim or the picture – may take toward the most unpainted area it can reach, the mirror rebound first. */
export const STEER_ANGLES = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
/** Share of the paintable arena that reveals the picture. */
export const WHITESPACE_DONE = 0.98;
/**
 * The stall rule: once this share is painted, a run in which no painter has found a single new cell for
 * `WHITESPACE_STALL_SEC` (at speed 1; steps, so the finder and replays agree) is revealed as well – the last pockets can
 * sit where a painter barely fits (a big Ball Size) or where one or two painters take minutes to come back.
 */
export const WHITESPACE_STALL_COVERAGE = 0.9;
export const WHITESPACE_STALL_SEC = 6;

/** Steps without a newly painted cell after which a white-spaces run at `speed` (`sps` steps a second) has stalled. */
export function whitespaceStallSteps(sps: number, speed: number): number {
  return Math.max(1, Math.round((WHITESPACE_STALL_SEC * sps) / Math.max(0.01, speed)));
}

/** Is the picture due: `WHITESPACE_DONE` painted, or from `WHITESPACE_STALL_COVERAGE` on no new cell for the stall window? */
export function whitespaceRevealDue(coverage: number, stepsSincePaint: number, sps: number, speed: number): boolean {
  return coverage >= WHITESPACE_DONE || (coverage >= WHITESPACE_STALL_COVERAGE && stepsSincePaint >= whitespaceStallSteps(sps, speed));
}
/** A nested collision slower than this (arena radii per second) is a resting contact: no note, no wobble. */
export const NESTED_HIT_SPEED = 0.03;

/** Colour of body `index` of `count` (rainbow by index). */
export function illusionColor(index: number, count: number): string {
  const hue = count > 1 ? (360 * index) / count : 0;
  return `hsl(${Math.round(hue)}, 90%, 62%)`;
}

/** MIDI notes the nested containers play, outermost first (C3, G3, C4, E4, G4). */
const NESTED_MIDI = [48, 55, 60, 64, 67];
/** The chord of the whitespace reveal: C5 E5 G5 C6. */
const REVEAL_CHORD = [72, 76, 79, 84].map(midiToFrequency);

/** Pitch of a whitespace bounce: the coverage so far as a degree of C major from C4 up two octaves (the notes climb as the picture appears). */
export function whitespacePitch(coverage: number): number {
  const degrees = 16;
  const degree = Math.max(0, Math.min(degrees - 1, Math.floor(coverage * degrees)));
  return pendulumPitch(degree, degrees, "up");
}

const POINT = { x: 0, y: 0 };

function createView(): IllusionView {
  return {
    settings: { ...DEFAULT_ILLUSION_SETTINGS },
    type: "lines",
    generation: 0,
    field: buildPendulumField(800, 600),
    cx: 400,
    cy: 300,
    radius: 100,
    count: 0,
    x: new Float64Array(0),
    y: new Float64Array(0),
    r: new Float64Array(0),
    colors: [],
    lastHitStep: new Float64Array(0),
    step: 0,
    stepMs: 0,
    timeSec: 0,
    direction: 1,
    cycleSec: 0,
    cyclesDone: 0,
    finished: false,
    noteCount: 0,
    eventCount: 0,
    amplitude: 0,
    theta: 0,
    rotation: -Math.PI / 2,
    circleError: 0,
    boundaries: new Float64Array(0),
    ringAngle: new Float64Array(0),
    alignCount: 0,
    lastAlignStep: -1,
    layerCount: 0,
    layerX: new Float64Array(0),
    layerY: new Float64Array(0),
    layerR: new Float64Array(0),
    collisions: 0,
    pattern: null,
    paths: [],
    pathLen: new Int32Array(0),
    pathVersion: 0,
    painterRadius: 0,
    coverage: 0,
    revealStep: -1,
    revealAtMs: -1,
    intrinsicWobble: 0,
  };
}

/** A pending note of the current step. */
interface StepNote {
  pitch: number;
  level: number;
  accent: boolean;
}

export class IllusionMode implements GameMode {
  readonly name = "illusion";
  /** The bodies are placed by the mode: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: IllusionSettings = { ...DEFAULT_ILLUSION_SETTINGS };
  private readonly view: IllusionView = createView();
  private sps = 60;
  private firstId = 0;
  private initialized = false;
  private width = 800;
  private height = 600;
  private ballRadius = 8;
  private pitch: number[] = [];
  private readonly notes: StepNote[] = [];
  // lines: steps per cycle (the slot clock is (step · 2N) / cycleSteps, divided last so whole slots land exactly)
  private lineSteps = 240;
  private finalSlot = Infinity;
  // rings: steps per cycle (the traversal clock is (step · RING_TRAVERSALS) / cycleSteps)
  private ringSteps = 1440;
  private finalTraversal = Infinity;
  private ringBallRadius = 0;
  // nested (arena units: the fixed circle has radius 1)
  private nx = new Float64Array(0);
  private ny = new Float64Array(0);
  private nvx = new Float64Array(0);
  private nvy = new Float64Array(0);
  private nr = new Float64Array(0);
  private nm = new Float64Array(0);
  private nestedSpeed = NESTED_SPEED;
  // whitespace (px)
  private readonly grid = new CoverageGrid();
  private pvx = new Float64Array(0);
  private pvy = new Float64Array(0);
  /** The step after which a painter last painted a new cell (the stall rule counts from it). */
  private lastPaintStep = 0;
  private painterSpeed = 0;
  private patternId: IllusionPatternId = "heart";
  private patternOffsetX = 0;
  private patternOffsetY = 0;
  private patternScale = 1;
  private readonly scratch: Ball = { id: -1, x: 0, y: 0, vx: 0, vy: 0, radius: 1, color: "#fff", trail: [], trailIndex: 0, spin: 0, angle: 0 };

  getSettings(): IllusionSettings {
    return this.settings;
  }

  /**
   * Everything but the display switches takes effect on the next init (the Simulator restarts the mode when one of them
   * changes); the tracks and the reveal only change the drawing and apply at once.
   */
  setSettings(patch: Partial<IllusionSettings>) {
    this.settings = resolveIllusionSettings({ ...this.settings, ...patch });
    if (!this.initialized) return;
    this.view.settings = { ...this.view.settings, tracks: this.settings.tracks, reveal: this.settings.reveal };
  }

  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): IllusionView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return {
      type: v.type,
      finished: v.finished,
      cycles: v.cyclesDone,
      total: v.settings.cycles,
      notes: v.noteCount,
      alignments: v.alignCount,
      collisions: v.collisions,
      coverage: v.coverage,
      pattern: v.pattern?.id ?? null,
      count: v.count,
    };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    v.type = s.type;
    v.generation++;
    v.step = 0;
    v.stepMs = 0;
    v.timeSec = 0;
    v.cyclesDone = 0;
    v.finished = false;
    v.noteCount = 0;
    v.eventCount = 0;
    v.alignCount = 0;
    v.lastAlignStep = -1;
    v.collisions = 0;
    v.coverage = 0;
    v.revealStep = -1;
    v.revealAtMs = -1;
    v.circleError = 0;
    v.pattern = null;
    v.intrinsicWobble = s.type === "nested" ? NESTED_WOBBLE : 0;
    v.cycleSec = illusionCycleSeconds(s);
    this.sps = 60;
    this.width = ctx.config.width;
    this.height = ctx.config.height;
    this.ballRadius = ctx.config.ballRadius || 8;
    this.initialized = true;
    // The first random decision of every type: the direction the figure rolls / the rings turn.
    v.direction = ctx.random() < 0.5 ? -1 : 1;
    const count = s.type === "lines" ? s.balls : s.type === "rings" ? s.rings : s.type === "nested" ? s.depth : s.painters;
    this.allocate(count);
    this.layoutField();
    if (s.type === "lines") this.initLines();
    else if (s.type === "rings") this.initRings();
    else if (s.type === "nested") this.initNested(ctx);
    else this.initWhitespace(ctx);
    this.firstId = ctx.getNextId();
    for (let i = 0; i < v.count; i++) {
      ctx.addBall({ x: v.x[i], y: v.y[i], vx: 0, vy: 0, radius: v.r[i], color: v.colors[i], gravityScale: 0, radiusScale: v.r[i] / this.ballRadius });
    }
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const sps = Math.max(1, Math.round(1000 / dtMs));
    if (sps !== this.sps) {
      // Another step length (only ever the engine's 60 Hz in practice): the per-step rates follow it.
      this.sps = sps;
      this.updateRates();
    }
    // A live change of the ball size re-sizes the balls of the lines and the rings (the nested circles and the painters
    // keep theirs until the next start: the Simulator restarts those types).
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.ballRadius) {
      this.ballRadius = radius;
      if (this.view.type === "lines" || this.view.type === "rings") {
        this.layoutField();
        if (this.view.type === "lines") this.layoutLines();
        else this.layoutRings();
        this.placeAnalytic();
      }
    }
  }

  /** The engine moved the body by its (zero) velocity; pin it where the mode says it is. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    const i = ball.id - this.firstId;
    const v = this.view;
    if (i >= 0 && i < v.count) {
      ball.x = v.x[i];
      ball.y = v.y[i];
    }
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /** Advances the clock one step: the touches / collisions / paint of the step, its sounds, and every body's position. */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    if (v.finished) {
      // Finished: the figure holds its last position in silence (the whitespace reveal plays on the canvas).
      this.applyBalls(ctx);
      return;
    }
    const step = v.step;
    this.notes.length = 0;
    if (v.type === "lines") this.stepLines(ctx, step);
    else if (v.type === "rings") this.stepRings(ctx, step);
    else if (v.type === "nested") this.stepNested(ctx, step, dtMs / 1000);
    else this.stepWhitespace(ctx, step, dtMs / 1000);
    v.step = step + 1;
    v.stepMs = dtMs;
    if (v.type === "lines" || v.type === "rings") {
      v.timeSec = v.finished ? v.settings.cycles * v.cycleSec : v.step / this.sps;
      this.placeAnalytic();
    } else v.timeSec = v.step / this.sps;
    this.flushNotes(ctx);
    this.applyBalls(ctx);
    // --- bounce-math --- every body that touched a wall, the rim or another body this step bounced
    if (ctx.noteBounce) {
      const hit = v.lastHitStep;
      for (const ball of ctx.getBalls()) {
        const i = ball.id - this.firstId;
        if (i >= 0 && i < hit.length && hit[i] === step + 1) ctx.noteBounce(ball);
      }
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /** A canvas resize re-lays the playfield out and puts every body back in place (the whitespace paths and the painters are scaled with it). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged && this.initialized) {
      const v = this.view;
      const oldCx = v.cx;
      const oldCy = v.cy;
      const oldR = v.radius;
      this.width = ctx.config.width;
      this.height = ctx.config.height;
      this.layoutField();
      if (v.type === "lines") {
        this.layoutLines();
        this.placeAnalytic();
      } else if (v.type === "rings") {
        this.layoutRings();
        this.placeAnalytic();
      } else if (v.type === "nested") this.placeNested();
      else this.rescaleWhitespace(oldCx, oldCy, oldR);
      this.applyBalls(ctx);
    } else if (sizeChanged) {
      this.width = ctx.config.width;
      this.height = ctx.config.height;
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
    return { type: v.type, step: v.step, timeSec: v.timeSec, notes: v.noteCount, cyclesDone: v.cyclesDone, alignCount: v.alignCount, collisions: v.collisions, coverage: v.coverage, finished: v.finished };
  }

  /* ------------------------------------------------------------ shared */

  private allocate(n: number) {
    const v = this.view;
    if (v.x.length !== n) {
      v.x = new Float64Array(n);
      v.y = new Float64Array(n);
      v.r = new Float64Array(n);
      v.lastHitStep = new Float64Array(n);
    }
    v.count = n;
    v.lastHitStep.fill(-1);
    v.colors = [];
    for (let i = 0; i < n; i++) v.colors.push(illusionColor(i, n));
  }

  /** The centred square the recorder crops to and the big circle in it. */
  private layoutField() {
    const v = this.view;
    v.field = buildPendulumField(this.width, this.height);
    v.cx = v.field.cx;
    v.cy = v.field.cy;
    v.radius = ARENA_FRACTION * v.field.side;
  }

  /** The configured ball size on this field (the default 8 px ball is a fortieth of the side, like the other rhythm modes). */
  private ballUnit() {
    return (this.view.field.side / 320) * this.ballRadius;
  }

  private updateRates() {
    const v = this.view;
    const s = v.settings;
    if (v.type === "lines") {
      this.lineSteps = (LINE_CYCLE_SEC * this.sps) / s.speed;
      this.finalSlot = s.cycles > 0 ? 2 * v.count * s.cycles : Infinity;
    } else if (v.type === "rings") {
      this.ringSteps = (RING_CYCLE_SEC * this.sps) / s.speed;
      this.finalTraversal = s.cycles > 0 ? RING_TRAVERSALS * s.cycles : Infinity;
    }
  }

  /** Kinetic energy of the nested circles, Σ ½ m v² in arena units – constant, as the collisions are elastic (for tests and tools). */
  getNestedEnergy(): number {
    let e = 0;
    for (let i = 1; i < this.view.layerCount && i < this.nvx.length; i++) e += 0.5 * this.nm[i] * (this.nvx[i] * this.nvx[i] + this.nvy[i] * this.nvy[i]);
    return e;
  }

  private queueNote(pitch: number, level: number, accent: boolean) {
    this.notes.push({ pitch, level, accent });
  }

  /** All notes of a step go out as one sound event: a note, or a chord of their distinct pitches (at most 6), accented if any was. */
  private flushNotes(ctx: ModeContext) {
    const notes = this.notes;
    if (notes.length === 0) return;
    const v = this.view;
    v.noteCount += notes.length;
    const pitches: number[] = [];
    let level = 0;
    let accent = false;
    for (const n of notes) {
      if (!pitches.includes(n.pitch)) pitches.push(n.pitch);
      if (n.level > level) level = n.level;
      if (n.accent) accent = true;
    }
    pitches.sort((a, b) => a - b);
    const chosen = pitches.length > 6 ? pitches.filter((_, i) => i % Math.ceil(pitches.length / 6) === 0).slice(0, 6) : pitches;
    const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: chosen[0] };
    if (chosen.length > 1) event.chord = chosen;
    if (accent) event.accent = true;
    if (level < 1) event.level = level;
    ctx.addPendingSoundEvent(event);
    v.eventCount++;
  }

  /** Writes every body's position and radius into its engine ball. */
  private applyBalls(ctx: ModeContext) {
    const v = this.view;
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.firstId;
      if (i < 0 || i >= v.count) continue;
      ball.x = v.x[i];
      ball.y = v.y[i];
      ball.radius = v.r[i];
      ball.radiusScale = v.r[i] / this.ballRadius;
      ball.vx = 0;
      ball.vy = 0;
    }
  }

  private placeAnalytic() {
    if (this.view.type === "lines") this.placeLines();
    else this.placeRings();
  }

  /* ------------------------------------------------------------ lines */

  private initLines() {
    const v = this.view;
    v.rotation = -Math.PI / 2;
    this.pitch = [];
    for (let i = 0; i < v.count; i++) this.pitch.push(pendulumPitch(i, v.count, "up"));
    this.layoutLines();
    this.updateRates();
    this.placeLines();
  }

  private layoutLines() {
    const v = this.view;
    const n = v.count;
    // The balls sit on the rolling circle (circumference π·A): room for all of them, never bigger than a thirtieth of the side.
    const rMax = Math.min(0.035 * v.field.side, (0.3 * Math.PI * v.radius) / Math.max(2, n));
    const r = Math.max(2, Math.min(this.ballUnit(), rMax));
    for (let i = 0; i < n; i++) v.r[i] = r;
    v.amplitude = v.radius - r;
  }

  private stepLines(ctx: ModeContext, step: number) {
    const v = this.view;
    const n = v.count;
    // The rim touches of this step: slots m with u(step) ≤ m < u(step + 1), u(s) = s · 2N / (steps per cycle).
    const lo = Math.ceil((step * 2 * n) / this.lineSteps);
    let hi = Math.ceil(((step + 1) * 2 * n) / this.lineSteps);
    let final = false;
    if (hi > this.finalSlot) {
      hi = this.finalSlot + 1;
      final = true;
    }
    const slotSec = v.cycleSec / (2 * n);
    for (let m = lo; m < hi; m++) {
      const touch = lineTouch(m, n, v.direction);
      v.lastHitStep[touch.ball] = step + 1;
      this.queueNote(this.pitch[touch.ball], 1, false);
      ctx.recordWallContact?.(0, normalizeAngle(touch.angle + v.rotation), 0.8, 1000 * m * slotSec);
    }
    if (hi > 0) v.cyclesDone = Math.floor((hi - 1) / (2 * n));
    if (final) {
      v.finished = true;
      v.cyclesDone = v.settings.cycles;
      ctx.spawnConfetti(v.cx, v.cy);
    }
  }

  private placeLines() {
    const v = this.view;
    const n = v.count;
    // The phase from the step counter: θ = d·2π·t / T (exactly the start again after every cycle).
    const turns = v.finished ? v.settings.cycles : v.step / this.lineSteps;
    v.theta = v.direction * TWO_PI * (turns - Math.floor(turns));
    rollingCircleCentre(v.theta, v.amplitude, v.rotation, POINT);
    const ccx = POINT.x;
    const ccy = POINT.y;
    let err = 0;
    for (let i = 0; i < n; i++) {
      linePosition(v.theta, i, n, v.amplitude, v.rotation, POINT);
      v.x[i] = v.cx + POINT.x;
      v.y[i] = v.cy + POINT.y;
      const d = Math.abs(Math.hypot(POINT.x - ccx, POINT.y - ccy) - v.amplitude / 2);
      if (d > err) err = d;
    }
    v.circleError = err;
  }

  /* ------------------------------------------------------------ rings */

  private initRings() {
    const v = this.view;
    const k = v.count;
    if (v.boundaries.length !== k + 1) v.boundaries = new Float64Array(k + 1);
    if (v.ringAngle.length !== k) v.ringAngle = new Float64Array(k);
    this.pitch = [];
    for (let i = 0; i < k; i++) this.pitch.push(pendulumPitch(i, k, "down"));
    this.layoutRings();
    this.updateRates();
    this.placeRings();
  }

  private layoutRings() {
    const v = this.view;
    const k = v.count;
    const inner = RING_HOLE_FRACTION * v.field.side;
    const width = (v.radius - inner) / k;
    for (let j = 0; j <= k; j++) v.boundaries[j] = inner + j * width;
    const r = Math.max(1.5, Math.min(this.ballUnit(), 0.3 * width));
    this.ringBallRadius = r;
    for (let i = 0; i < k; i++) v.r[i] = r;
  }

  /** Radial phase of ring ball k after `w` traversals of the clock: the balls are staggered by a K-th of a traversal. */
  private ringPhase(w: number, k: number) {
    return w - k / this.view.count;
  }

  private stepRings(ctx: ModeContext, step: number) {
    const v = this.view;
    const K = v.count;
    // The traversal clock w(s) = s · RING_TRAVERSALS / (steps per cycle), divided last so whole traversals land exactly.
    const w0 = (step * RING_TRAVERSALS) / this.ringSteps;
    const w1 = ((step + 1) * RING_TRAVERSALS) / this.ringSteps;
    // The final alignment (the end of the last cycle) falls in this step: its touches are the last ones.
    const final = Math.ceil(w1) > this.finalTraversal && Math.ceil(w0) <= this.finalTraversal;
    const traversalSec = v.cycleSec / RING_TRAVERSALS;
    for (let k = 0; k < K; k++) {
      const lo = Math.ceil(this.ringPhase(w0, k));
      const hi = final ? Math.floor(this.finalTraversal - k / K) + 1 : Math.ceil(this.ringPhase(w1, k));
      for (let n = lo; n < hi; n++) {
        const outer = ((n % 2) + 2) % 2 === 1;
        const wall = outer ? k + 1 : k;
        const tSec = (n + k / K) * traversalSec;
        const angle = this.ringAngleAt(k, (n + k / K) / RING_TRAVERSALS);
        v.lastHitStep[k] = step + 1;
        const aligned = k === 0 && n % RING_TRAVERSALS === 0 && n > 0;
        this.queueNote(this.pitch[k], 1, aligned);
        // The ball pushes the outer wall outward and the inner wall inward.
        ctx.recordWallContact?.(wall, angle, outer ? 0.9 : -0.9, 1000 * tSec);
      }
    }
    // Alignments: every RING_TRAVERSALS traversals (the start does not count).
    const aLo = Math.max(1, Math.ceil(Math.ceil(w0) / RING_TRAVERSALS));
    const aHi = Math.ceil((final ? this.finalTraversal + 1 : Math.ceil(w1)) / RING_TRAVERSALS);
    if (aHi > aLo) {
      v.alignCount += aHi - aLo;
      v.lastAlignStep = step + 1;
      v.cyclesDone = aHi - 1;
    }
    if (final) {
      v.finished = true;
      v.cyclesDone = v.settings.cycles;
      ctx.spawnConfetti(v.cx, v.cy);
    }
  }

  /** Angle of ring k's rail `cycles` cycles into the run: ring k turns K − k times per cycle (the innermost fastest), all starting at 12 o'clock. */
  private ringAngleAt(k: number, cycles: number) {
    const v = this.view;
    const turns = (v.count - k) * cycles;
    return normalizeAngle(-Math.PI / 2 + v.direction * TWO_PI * (turns - Math.floor(turns)));
  }

  private placeRings() {
    const v = this.view;
    const K = v.count;
    const cycles = v.finished ? v.settings.cycles : v.step / this.ringSteps;
    const w = v.finished ? this.finalTraversal : (v.step * RING_TRAVERSALS) / this.ringSteps;
    const r = this.ringBallRadius;
    for (let k = 0; k < K; k++) {
      const a = this.ringAngleAt(k, cycles);
      v.ringAngle[k] = a;
      const inner = v.boundaries[k] + r;
      const outer = v.boundaries[k + 1] - r;
      const rho = inner + (outer - inner) * ringFraction(this.ringPhase(w, k));
      v.x[k] = v.cx + rho * Math.cos(a);
      v.y[k] = v.cy + rho * Math.sin(a);
    }
  }

  /* ------------------------------------------------------------ nested */

  private initNested(ctx: ModeContext) {
    const v = this.view;
    const d = v.count;
    const layers = d + 1;
    if (this.nx.length !== layers) {
      this.nx = new Float64Array(layers);
      this.ny = new Float64Array(layers);
      this.nvx = new Float64Array(layers);
      this.nvy = new Float64Array(layers);
      this.nr = new Float64Array(layers);
      this.nm = new Float64Array(layers);
      v.layerX = new Float64Array(layers);
      v.layerY = new Float64Array(layers);
      v.layerR = new Float64Array(layers);
    }
    v.layerCount = layers;
    // Radii fall geometrically from the arena (1) to the innermost circle, whose size follows the Ball Size.
    const innermost = Math.max(0.05, Math.min(0.2, (NESTED_INNER * this.ballRadius) / 8));
    const q = Math.pow(innermost, 1 / d);
    this.nestedSpeed = NESTED_SPEED * v.settings.speed;
    this.pitch = [];
    for (let i = 0; i < layers; i++) {
      this.nr[i] = Math.pow(q, i);
      // Hollow circles: the mass follows the circumference.
      this.nm[i] = this.nr[i];
      this.nx[i] = 0;
      this.ny[i] = 0;
      this.nvx[i] = 0;
      this.nvy[i] = 0;
      this.pitch.push(midiToFrequency(NESTED_MIDI[Math.min(i, NESTED_MIDI.length - 1)]));
    }
    // Seeded launch: every moving circle a direction and a speed within ±20 %.
    for (let i = 1; i < layers; i++) {
      const a = ctx.random() * TWO_PI;
      const speed = this.nestedSpeed * (0.8 + 0.4 * ctx.random());
      this.nvx[i] = speed * Math.cos(a);
      this.nvy[i] = speed * Math.sin(a);
    }
    this.placeNested();
  }

  private placeNested() {
    const v = this.view;
    const R = v.radius;
    for (let i = 0; i < v.layerCount; i++) {
      v.layerX[i] = v.cx + this.nx[i] * R;
      v.layerY[i] = v.cy + this.ny[i] * R;
      v.layerR[i] = this.nr[i] * R;
    }
    for (let b = 0; b < v.count; b++) {
      v.x[b] = v.layerX[b + 1];
      v.y[b] = v.layerY[b + 1];
      v.r[b] = v.layerR[b + 1];
    }
  }

  private stepNested(ctx: ModeContext, step: number, stepSec: number) {
    const v = this.view;
    const layers = v.layerCount;
    const dt = stepSec / NESTED_SUBSTEPS;
    const x = this.nx;
    const y = this.ny;
    const vx = this.nvx;
    const vy = this.nvy;
    const r = this.nr;
    const m = this.nm;
    for (let sub = 0; sub < NESTED_SUBSTEPS; sub++) {
      for (let i = 1; i < layers; i++) {
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
      }
      // Outer to inner: each circle against its container (the arena, layer 0, never moves).
      for (let i = 1; i < layers; i++) {
        const c = i - 1;
        const dx = x[i] - x[c];
        const dy = y[i] - y[c];
        const dist = Math.hypot(dx, dy);
        const limit = r[c] - r[i];
        if (dist <= limit || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const wi = 1 / m[i];
        const wc = c === 0 ? 0 : 1 / m[c];
        const over = dist - limit;
        x[i] -= nx * over * (wi / (wi + wc));
        y[i] -= ny * over * (wi / (wi + wc));
        if (wc > 0) {
          x[c] += nx * over * (wc / (wi + wc));
          y[c] += ny * over * (wc / (wi + wc));
        }
        const rel = (vx[i] - vx[c]) * nx + (vy[i] - vy[c]) * ny;
        if (rel <= 0) continue;
        // Elastic: the relative normal velocity is reflected, shared out by inverse mass.
        const j = (2 * rel) / (wi + wc);
        vx[i] -= j * wi * nx;
        vy[i] -= j * wi * ny;
        if (wc > 0) {
          vx[c] += j * wc * nx;
          vy[c] += j * wc * ny;
        }
        if (rel < NESTED_HIT_SPEED * v.settings.speed) continue;
        v.collisions++;
        const strength = Math.min(1.5, rel / this.nestedSpeed);
        const angle = normalizeAngle(Math.atan2(ny, nx));
        const tMs = 1000 * (step / this.sps + ((sub + 1) * dt));
        // The container is pushed outward where it is hit, the circle inside inward on the same side.
        ctx.recordWallContact?.(c, angle, strength, tMs);
        ctx.recordWallContact?.(i, angle, -strength, tMs);
        v.lastHitStep[i - 1] = step + 1;
        if (c > 0) v.lastHitStep[c - 1] = step + 1;
        this.queueNote(this.pitch[c], Math.min(1, 0.35 + 0.65 * strength), false);
      }
    }
    this.placeNested();
  }

  /* ------------------------------------------------------------ whitespace */

  private initWhitespace(ctx: ModeContext) {
    const v = this.view;
    const s = v.settings;
    const n = v.count;
    const R = v.radius;
    // Seeded: the picture (always drawn, so a fixed picture keeps the rest of the run), its place and size.
    const pick = ILLUSION_PATTERNS[Math.min(ILLUSION_PATTERNS.length - 1, Math.floor(ctx.random() * ILLUSION_PATTERNS.length))];
    this.patternId = s.pattern === "auto" ? pick : s.pattern;
    this.patternOffsetX = (2 * ctx.random() - 1) * 0.04;
    this.patternOffsetY = (2 * ctx.random() - 1) * 0.04;
    this.patternScale = 0.94 + 0.12 * ctx.random();
    const rp = R * Math.max(0.02, Math.min(0.09, (PAINTER_RADIUS * this.ballRadius) / 8));
    v.painterRadius = rp;
    this.painterSpeed = PAINTER_SPEED * R * s.speed;
    const pattern = buildIllusionPattern(this.patternId, v.cx, v.cy, R, this.patternOffsetX, this.patternOffsetY, this.patternScale);
    v.pattern = pattern;
    this.grid.build(v.cx, v.cy, R, rp, (px, py) => isLegalPosition(pattern, px, py, rp));
    if (this.pvx.length !== n) {
      this.pvx = new Float64Array(n);
      this.pvy = new Float64Array(n);
    }
    if (v.pathLen.length !== n) v.pathLen = new Int32Array(n);
    v.paths = [];
    v.pathVersion++;
    for (let j = 0; j < n; j++) {
      // A free, legal spot (outside the picture, clear of the painters placed so far), then a direction.
      let px = v.cx;
      let py = v.cy + 0.8 * (R - rp);
      for (let attempt = 0; attempt < 200; attempt++) {
        const a = ctx.random() * TWO_PI;
        const rho = Math.sqrt(ctx.random()) * (R - rp - 2);
        const cx = v.cx + rho * Math.cos(a);
        const cy = v.cy + rho * Math.sin(a);
        if (!isLegalPosition(pattern, cx, cy, rp + 1)) continue;
        let free = true;
        for (let o = 0; o < j; o++) if (Math.hypot(cx - v.x[o], cy - v.y[o]) < 2 * rp) free = false;
        if (!free) continue;
        px = cx;
        py = cy;
        break;
      }
      const dir = ctx.random() * TWO_PI;
      v.x[j] = px;
      v.y[j] = py;
      v.r[j] = rp;
      this.pvx[j] = this.painterSpeed * Math.cos(dir);
      this.pvy[j] = this.painterSpeed * Math.sin(dir);
      v.paths.push(new Float32Array(2048));
      v.pathLen[j] = 0;
      this.pushPath(j, px, py);
      this.grid.markSegment(px, py, px, py, rp);
    }
    v.coverage = this.grid.coverage();
    this.lastPaintStep = 0;
  }

  /** Appends a point to painter j's path (growing the buffer when needed). */
  private pushPath(j: number, x: number, y: number) {
    const v = this.view;
    let path = v.paths[j];
    const len = v.pathLen[j];
    if (len + 2 > path.length) {
      const grown = new Float32Array(path.length * 2);
      grown.set(path);
      path = grown;
      v.paths[j] = path;
    }
    path[len] = x;
    path[len + 1] = y;
    v.pathLen[j] = len + 2;
  }

  /** Paints the grid along painter j's last path segment and records the new point; returns the cells newly painted. */
  private paintTo(j: number, x: number, y: number): number {
    const v = this.view;
    const len = v.pathLen[j];
    const path = v.paths[j];
    const added = this.grid.markSegment(path[len - 2], path[len - 1], x, y, v.painterRadius);
    this.pushPath(j, x, y);
    return added;
  }

  private stepWhitespace(ctx: ModeContext, step: number, stepSec: number) {
    const v = this.view;
    const pattern = v.pattern;
    if (!pattern) return;
    const n = v.count;
    const dt = stepSec / PAINTER_SUBSTEPS;
    const rp = v.painterRadius;
    const limit = v.radius - rp;
    const speed = this.painterSpeed;
    const ball = this.scratch;
    ball.radius = rp;
    let bounced = false;
    let painted = 0;
    for (let sub = 0; sub < PAINTER_SUBSTEPS; sub++) {
      for (let j = 0; j < n; j++) {
        ball.x = v.x[j] + this.pvx[j] * dt;
        ball.y = v.y[j] + this.pvy[j] * dt;
        ball.vx = this.pvx[j];
        ball.vy = this.pvy[j];
        let hit = false;
        for (const o of pattern.obstacles) if (resolveBallObstacle(ball, o, dt, 1) > 0.05 * speed) hit = true;
        if (hit) {
          // Guided off the picture too: the rebound turns toward the most unpainted white it can reach. The wall's
          // normal (into the picture) is the direction the bounce took speed away along.
          const dvx = this.pvx[j] - ball.vx;
          const dvy = this.pvy[j] - ball.vy;
          const dl = Math.hypot(dvx, dvy);
          const sp = Math.hypot(ball.vx, ball.vy);
          if (dl > 1e-9 * speed && sp > 1e-9 * speed) {
            const turn = this.steerAngle(ball.x, ball.y, ball.vx / sp, ball.vy / sp, dvx / dl, dvy / dl);
            if (turn !== 0) {
              const c = Math.cos(turn);
              const s = Math.sin(turn);
              const tx = ball.vx * c - ball.vy * s;
              ball.vy = ball.vx * s + ball.vy * c;
              ball.vx = tx;
            }
          }
        }
        const dx = ball.x - v.cx;
        const dy = ball.y - v.cy;
        const dist = Math.hypot(dx, dy);
        if (dist > limit && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          ball.x = v.cx + nx * (limit - 0.01);
          ball.y = v.cy + ny * (limit - 0.01);
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn > 0) {
            let rvx = ball.vx - 2 * vn * nx;
            let rvy = ball.vy - 2 * vn * ny;
            // Guided: the rebound turns (by up to STEER_MAX) toward the direction with the most left to paint.
            const steer = this.steerAngle(ball.x, ball.y, rvx / speed, rvy / speed, nx, ny);
            // A seeded scatter of up to ±RIM_SCATTER on top, as long as the ball still heads inside.
            const turn = steer + (2 * ctx.random() - 1) * RIM_SCATTER;
            const c = Math.cos(turn);
            const s = Math.sin(turn);
            const tx = rvx * c - rvy * s;
            const ty = rvx * s + rvy * c;
            if (tx * nx + ty * ny < -0.05 * speed) {
              rvx = tx;
              rvy = ty;
            }
            ball.vx = rvx;
            ball.vy = rvy;
            hit = true;
            ctx.recordWallContact?.(0, normalizeAngle(Math.atan2(ny, nx)), Math.min(1.5, vn / speed), 1000 * (step / this.sps + (sub + 1) * dt));
          }
        }
        // Constant speed: the pattern's capped restitution never slows a painter down.
        const sp = Math.hypot(ball.vx, ball.vy);
        if (sp > 0) {
          this.pvx[j] = (ball.vx / sp) * speed;
          this.pvy[j] = (ball.vy / sp) * speed;
        }
        v.x[j] = ball.x;
        v.y[j] = ball.y;
        if (hit) {
          bounced = true;
          v.lastHitStep[j] = step + 1;
          painted += this.paintTo(j, ball.x, ball.y);
        }
      }
    }
    for (let j = 0; j < n; j++) painted += this.paintTo(j, v.x[j], v.y[j]);
    if (painted > 0) this.lastPaintStep = step + 1;
    v.coverage = this.grid.coverage();
    if (bounced) this.queueNote(whitespacePitch(v.coverage), 0.8, false);
    if (whitespaceRevealDue(v.coverage, step + 1 - this.lastPaintStep, this.sps, v.settings.speed)) {
      v.finished = true;
      v.revealStep = step + 1;
      v.revealAtMs = (1000 * (step + 1)) / this.sps;
      for (let j = 0; j < n; j++) {
        this.pvx[j] = 0;
        this.pvy[j] = 0;
      }
      for (const f of REVEAL_CHORD) this.queueNote(f, 1, true);
      ctx.spawnConfetti(pattern.probeX, pattern.probeY);
    }
  }

  /**
   * The turn (radians) that points a painter bouncing at (x, y) along (ux, uy) – n is the normal into the wall it
   * bounced off, the rim or the picture – at the most unpainted area it can reach: the candidates of `STEER_ANGLES` that
   * still head well away from the wall are scored by the unpainted cells along their path up to the first cell the
   * paint cannot reach (`CoverageGrid.rayScore()`: the picture or the rim, so white behind the picture does not lure a
   * painter into it); the first best one wins (0 first, so a tie keeps the mirror rebound). Pure grid reads: no random
   * number, no allocation.
   */
  private steerAngle(x: number, y: number, ux: number, uy: number, nx: number, ny: number): number {
    const rp = this.view.painterRadius;
    const reach = 2 * this.view.radius;
    let best = 0;
    let bestScore = 0;
    for (const delta of STEER_ANGLES) {
      const c = Math.cos(delta);
      const s = Math.sin(delta);
      const dx = ux * c - uy * s;
      const dy = ux * s + uy * c;
      const inward = -(dx * nx + dy * ny);
      if (inward < 0.25) continue;
      const score = this.grid.rayScore(x, y, dx, dy, reach, 0.6 * rp);
      if (score > bestScore) {
        bestScore = score;
        best = delta;
      }
    }
    return best;
  }

  /** A canvas resize: the painters, their paths, the picture and the grid's mapping scale with the arena. */
  private rescaleWhitespace(oldCx: number, oldCy: number, oldR: number) {
    const v = this.view;
    const k = oldR > 0 ? v.radius / oldR : 1;
    for (let j = 0; j < v.count; j++) {
      v.x[j] = v.cx + (v.x[j] - oldCx) * k;
      v.y[j] = v.cy + (v.y[j] - oldCy) * k;
      v.r[j] *= k;
      this.pvx[j] *= k;
      this.pvy[j] *= k;
      const path = v.paths[j];
      if (!path) continue;
      for (let p = 0; p < v.pathLen[j]; p += 2) {
        path[p] = v.cx + (path[p] - oldCx) * k;
        path[p + 1] = v.cy + (path[p + 1] - oldCy) * k;
      }
    }
    v.painterRadius *= k;
    this.painterSpeed *= k;
    v.pattern = buildIllusionPattern(this.patternId, v.cx, v.cy, v.radius, this.patternOffsetX, this.patternOffsetY, this.patternScale);
    this.grid.place(v.cx, v.cy, v.radius);
    v.pathVersion++;
  }
}

function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}
