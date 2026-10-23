import { SCALE_INTERVALS, midiToFrequency } from "@/lib/audio/scales";
import { mergeBalls } from "../interactions";
import { rebound, segmentBetween, type Obstacle } from "../obstacles";
import type { Ball, GameMode, ModeContext, ObstacleHitResult } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Merge Ring ("mergeRing" mode, feature merge-ring – the "will the ball merge into its final form?" reels). No rings to
 * escape: a big circle arena whose rim is a thin rainbow stroke, a vertical chute from the top of the frame down into the
 * ring's top opening, and balls dropping through the chute one after another (`interval` seconds apart) to pile up under
 * gravity. Every ball carries a tier (1 … `tiers`) with its own emblem, colour and size (`tierRadius()`: tier k is
 * 1 + 0.42 · (k − 1) times the Ball Size); the chute spawns tiers 1 … `spawnTiers`, lower tiers more likely. When two
 * balls of the same tier touch they fuse into one ball of the next tier at their mass-weighted centre with their total
 * momentum (the maths of interactions.ts `mergeBalls()`, the size the next tier's own – not the area sum), with a halo,
 * the merge burst and sound, and a pentatonic note rising with the tier. The top tier never merges: its first
 * appearance is the FINAL FORM (the rim flashes, confetti, a chord), the run finishes `FINAL_HOLD_MS` later. OVERFLOW
 * ends the run too: a ball that has rested inside the chute, above the ring's opening, for `OVERFLOW_MS`.
 *
 * Physics: the balls are ordinary engine balls under the engine's gravity (× `gravity`, through `gravityScale`),
 * bouncing off the chute walls, which are capsule segments of ../obstacles.ts; the mode resolves the rim itself in
 * `onBallStep()` (`rebound()` of obstacles.ts: a soft restitution, the wall bounciness extra on top) and the balls
 * against each other in `onPostSubStep()` (`ballsPassThrough`: not the engine's elastic, equal-mass pair pass) – a mass
 * by area, so a big ball shoves a small one aside and not the other way round, a soft restitution (`PAIR_RESTITUTION`)
 * and contact friction, so a drop lands on the pile with a thud and stays instead of ricocheting – and then fuses the
 * touching pairs of one tier. Balls may rest (`ballsMayRest`: no slow-ball boost), and a ball that touches the pile or
 * the rim loses a little speed each step (`CONTACT_DAMPING`), so the pile settles like a jar of fruit and keeps merging.
 * A big pile is solved from a broadphase list of the pairs that can touch (`buildCandidates()`, `BROADPHASE_MARGIN`): the
 * same pairs in the same order as the plain double loop, so a run is the same bit for bit, at a few checks a ball.
 *
 * Randomness: the spawn tiers and the launch jitter come from `ctx.random()` as the balls leave, so a seed replays
 * identically and Find Simulation can search a clip length (the seed decides when the final form or the overflow comes).
 */

/* ------------------------------------------------------------------ settings */

export interface MergeRingSettings {
  /** Tiers of the ladder, 5–10: the top one is the final form. */
  tiers: number;
  /** Seconds between two balls leaving the chute, 0.3–3. */
  interval: number;
  /** The chute spawns tiers 1 … this, 1–3 (lower tiers more likely). */
  spawnTiers: number;
  /** Gravity multiplier of the drop, 0.5–3. */
  gravity: number;
  /** The rim is a slowly turning rainbow (off: the wall colour). */
  rainbow: boolean;
}

export const DEFAULT_MERGE_RING_SETTINGS: MergeRingSettings = {
  tiers: 7,
  interval: 0.9,
  spawnTiers: 2,
  gravity: 1,
  rainbow: true,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const MERGE_RING_RANGES = {
  mrTiers: { min: 5, max: 10, step: 1 },
  mrInterval: { min: 0.3, max: 3, step: 0.1 },
  mrSpawnTiers: { min: 1, max: 3, step: 1 },
  mrGravity: { min: 0.5, max: 3, step: 0.1 },
} as const;

/** The Merge Ring fields of the SimulatorSettings object (URL keys mrt, mri, mrs, mrg, mrr). */
export interface MergeRingFields {
  mrTiers: number;
  mrInterval: number;
  mrSpawnTiers: number;
  mrGravity: number;
  mrRainbow: boolean;
}

/** Most tiers the emblems, colours and names cover (the slider's end; a value past it is clamped: there is no eleventh emblem). */
export const MAX_TIERS = 10;

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds onto a slider's step, two decimals at most. */
function onStep(value: number, step: number) {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** Fills in the defaults and clamps every value onto its slider (the counts whole, the tiers at most `MAX_TIERS`); bad values fall back to the defaults. */
export function resolveMergeRingSettings(config: Partial<MergeRingSettings> | null | undefined): MergeRingSettings {
  const out = { ...DEFAULT_MERGE_RING_SETTINGS };
  if (!config) return out;
  const R = MERGE_RING_RANGES;
  if (config.tiers !== undefined) out.tiers = Math.min(MAX_TIERS, memoryCeiling("mrTiers", Math.round(clampNumber(config.tiers, R.mrTiers, out.tiers))));
  if (config.interval !== undefined) out.interval = onStep(clampNumber(config.interval, R.mrInterval, out.interval), R.mrInterval.step);
  if (config.spawnTiers !== undefined) out.spawnTiers = Math.round(clampNumber(config.spawnTiers, R.mrSpawnTiers, out.spawnTiers));
  if (config.gravity !== undefined) out.gravity = onStep(clampNumber(config.gravity, R.mrGravity, out.gravity), R.mrGravity.step);
  if (typeof config.rainbow === "boolean") out.rainbow = config.rainbow;
  // The chute can only spawn tiers that exist below the top one.
  out.spawnTiers = Math.max(1, Math.min(out.spawnTiers, out.tiers - 1));
  return out;
}

/** Picks the Merge Ring settings out of a bigger object for `engine.setMergeRingSettings()`. */
export function mergeRingSettingsOf(source: MergeRingFields): MergeRingSettings {
  return { tiers: source.mrTiers, interval: source.mrInterval, spawnTiers: source.mrSpawnTiers, gravity: source.mrGravity, rainbow: source.mrRainbow };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function mergeRingSettingFields(settings: MergeRingSettings): MergeRingFields {
  return { mrTiers: settings.tiers, mrInterval: settings.interval, mrSpawnTiers: settings.spawnTiers, mrGravity: settings.gravity, mrRainbow: settings.rainbow };
}

/** The defaults of the feature's fields. */
export function defaultMergeRingFields(): MergeRingFields {
  return mergeRingSettingFields(DEFAULT_MERGE_RING_SETTINGS);
}

/** The mode's own Ball Size: a tier-1 ball about an eleventh of the ring across and the final form about a third, like the reels. */
export const MERGE_RING_BALL_RADIUS = 24;

/** The core settings Merge Ring overrides when it is the page's mode (its own ball size); nothing for any other mode. */
export function mergeRingModeDefaults(mode: string): { ballRadius?: number } {
  return mode === "mergeRing" ? { ballRadius: MERGE_RING_BALL_RADIUS } : {};
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers on their steps, a real boolean. */
export function resolveMergeRingFields(source: Partial<MergeRingFields>): MergeRingFields {
  return mergeRingSettingFields(
    resolveMergeRingSettings({ tiers: source.mrTiers, interval: source.mrInterval, spawnTiers: source.mrSpawnTiers, gravity: source.mrGravity, rainbow: source.mrRainbow }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { mrt: "mrTiers", mri: "mrInterval", mrs: "mrSpawnTiers", mrg: "mrGravity" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: mrt, mri, mrs, mrg and mrr. */
export function writeMergeRingParams(settings: MergeRingFields, base: MergeRingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.mrRainbow !== base.mrRainbow) params.set("mrr", settings.mrRainbow ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readMergeRingParams(params: URLSearchParams, settings: MergeRingFields) {
  const next: Partial<MergeRingFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const rainbow = params.get("mrr");
  if (rainbow === "1") next.mrRainbow = true;
  else if (rainbow === "0") next.mrRainbow = false;
  Object.assign(settings, resolveMergeRingFields(next));
}

/* ------------------------------------------------------------------ tiers */

/** Every tier's size step: tier k is `1 + RADIUS_STEP · (k − 1)` times the Ball Size. */
export const RADIUS_STEP = 0.42;

/** Radius (px) of a ball of tier `tier` (1-based) for a Ball Size of `base`. */
export function tierRadius(base: number, tier: number): number {
  return base * tierScale(tier);
}

/** The size of tier `tier` relative to the Ball Size (the ball's `radiusScale`, so a live Ball Size change keeps the tiers). */
export function tierScale(tier: number): number {
  return 1 + RADIUS_STEP * (Math.max(1, Math.round(tier)) - 1);
}

/** The emblems of the tiers, 1 … 10: original vector marks drawn by the renderer (no images). */
export const TIER_EMBLEMS = ["dot", "ring", "triangle", "diamond", "star", "hexagon", "crown", "gem", "sun", "infinity"] as const;
export type TierEmblem = (typeof TIER_EMBLEMS)[number];

/** The colour ramp of the tiers, 1 … 10: cyan up through mint, lime, amber, orange, rose, pink and violet to gold and white. */
export const TIER_COLORS = ["#38bdf8", "#34d399", "#a3e635", "#fbbf24", "#fb923c", "#fb7185", "#f472b6", "#a78bfa", "#fde047", "#f8fafc"] as const;

export function tierEmblem(tier: number): TierEmblem {
  return TIER_EMBLEMS[Math.max(0, Math.min(TIER_EMBLEMS.length - 1, Math.round(tier) - 1))];
}

export function tierColor(tier: number): string {
  return TIER_COLORS[Math.max(0, Math.min(TIER_COLORS.length - 1, Math.round(tier) - 1))];
}

/**
 * The tier the chute spawns for a draw `u` in [0, 1) among tiers 1 … `spawnTiers`: tier k weighs 2^(spawnTiers − k), so
 * every tier is twice as likely as the one above it (1: 1, 2: ½, 3: ¼ …).
 */
export function spawnTierFor(u: number, spawnTiers: number): number {
  const n = Math.max(1, Math.round(spawnTiers));
  let total = 0;
  for (let k = 1; k <= n; k++) total += Math.pow(2, n - k);
  let acc = 0;
  for (let k = 1; k <= n; k++) {
    acc += Math.pow(2, n - k) / total;
    if (u < acc) return k;
  }
  return n;
}

/* ------------------------------------------------------------------ layout */

/** The ring's radius as a fraction of the centred square's side, and how far below the square's centre it sits. */
export const RING_AT = 0.42;
export const RING_DROP_AT = 0.04;
/** The chute's width in tier-1 ball diameters. */
export const CHUTE_WIDTHS = 2.2;
/** Restitution of the rim and of the chute walls, and their contact friction. */
export const RIM_RESTITUTION = 0.25;
export const RIM_FRICTION = 0.08;
/** Restitution and friction of two balls against each other, the share of an overlap one pass corrects, and the overlap it lets stand (px). */
export const PAIR_RESTITUTION = 0.15;
export const PAIR_FRICTION = 0.05;
export const PAIR_CORRECTION = 0.8;
export const PAIR_SLOP = 0.05;
/** Passes of the pair solver a sub-step (a jammed pile settles instead of creeping). */
export const PAIR_ITERATIONS = 4;
/** Speed a ball touching the pile or the rim keeps per second (the pile settles instead of jiggling forever). */
export const CONTACT_DAMPING = 0.45;
export const CHUTE_RESTITUTION = 0.3;
export const CHUTE_FRICTION = 0.03;
/** Gravity (px/s²) the drops get at least – without it a ball would hang in the chute. */
export const MIN_GRAVITY = 120;

export interface MergeRingLayout {
  width: number;
  height: number;
  /** The centred square the recorder crops to. */
  side: number;
  left: number;
  top: number;
  /** The ring's centre and radius. */
  cx: number;
  cy: number;
  radius: number;
  /** Half the chute's width, and where its walls meet the ring: the ring's top opening. */
  chuteHalf: number;
  openY: number;
  /** Where a ball leaves the chute (the top edge of the frame). */
  spawnY: number;
  /** The chute walls (capsule segments the engine resolves). */
  obstacles: Obstacle[];
  /** The ball radius the layout was built for. */
  ballRadius: number;
}

/**
 * Lays the arena out for a canvas of `width` × `height`: the ring (radius `RING_AT` × the side of the centred square the
 * recorder crops to, centred `RING_DROP_AT` × the side below the square's centre) and the chute (`CHUTE_WIDTHS` tier-1 ball
 * diameters wide) from far above the top edge down to where its walls meet the ring.
 */
export function buildMergeRingLayout(width: number, height: number, ballRadius: number): MergeRingLayout {
  const side = Math.max(60, Math.min(width, height));
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  const r = Math.max(2, ballRadius);
  const cx = width / 2;
  const cy = height / 2 + RING_DROP_AT * side;
  const radius = RING_AT * side;
  const chuteHalf = Math.min(0.9 * radius, CHUTE_WIDTHS * r);
  const openY = cy - Math.sqrt(Math.max(0, radius * radius - chuteHalf * chuteHalf));
  const wallTop = -height;
  const obstacles: Obstacle[] = [
    segmentBetween(cx - chuteHalf, wallTop, cx - chuteHalf, openY, { restitution: CHUTE_RESTITUTION, friction: CHUTE_FRICTION }),
    segmentBetween(cx + chuteHalf, wallTop, cx + chuteHalf, openY, { restitution: CHUTE_RESTITUTION, friction: CHUTE_FRICTION }),
  ];
  return { width, height, side, left, top, cx, cy, radius, chuteHalf, openY, spawnY: Math.min(openY - 2 * r, r + 1), obstacles, ballRadius: r };
}

/**
 * True when a ball of radius `r` at (x, y) is clear of the rim through the ring's opening: in the chute column above the
 * opening (its walls hold it there), or in the column below the opening and narrow enough to pass through it (the rim is open
 * over it). A ball wider than that under the opening is inside the ring, held by the rim like any other.
 */
export function inChute(L: Pick<MergeRingLayout, "cx" | "cy" | "chuteHalf" | "openY">, x: number, y: number, r = 0): boolean {
  const off = Math.abs(x - L.cx);
  if (y < L.openY) return off < L.chuteHalf;
  return y < L.cy && off + r <= L.chuteHalf;
}

/* ------------------------------------------------------------------ sound */

/** The merge notes climb the pentatonic from C4 with the tier (tier 2 the first merge's note, an octave every five tiers). */
export function mergePitch(tier: number): number {
  const steps = SCALE_INTERVALS.pentatonic;
  const d = Math.max(0, Math.round(tier) - 2);
  return midiToFrequency(60 + 12 * Math.floor(d / steps.length) + steps[d % steps.length]);
}

/** The landing thud of a ball of `tier`: the same pentatonic ladder two octaves down (from C2), so a bigger ball thuds a step higher. */
export function thudPitch(tier: number): number {
  const steps = SCALE_INTERVALS.pentatonic;
  const d = Math.max(0, Math.round(tier) - 1);
  return midiToFrequency(36 + 12 * Math.floor(d / steps.length) + steps[d % steps.length]);
}

/** The final form's chord: the top tier's merge note, its major third, its fifth and the octave. */
export function finalChord(tiers: number): number[] {
  const root = mergePitch(tiers);
  return [root, root * Math.pow(2, 4 / 12), root * Math.pow(2, 7 / 12), 2 * root];
}

/** Most thuds one 60 Hz step queues, and the least ms between two thuds of one ball (a ball rolling along the rim is one landing, not a drum roll). */
export const MAX_THUDS_PER_STEP = 4;
export const THUD_COOLDOWN_MS = 250;
/** A rim contact faster than this (px/s) thuds. */
export const THUD_SPEED = 90;

/* ------------------------------------------------------------------ run length */

/** Simulation ms the final form holds before the run finishes. */
export const FINAL_HOLD_MS = 2000;
/**
 * A ball inside the chute, above the ring's opening, for `OVERFLOW_MS` while it rests (slower than this, px/s) or stands on
 * the ball under it (the ring is full up to the opening) overflows the ring.
 */
export const REST_SPEED = 14;
export const OVERFLOW_MS = 1500;
/** The launch jitter, as a fraction of the Ball Size each way, at most what the chute leaves the ball (a pile that never stacks on one line). */
export const LAUNCH_JITTER = 0.8;
/** Two balls of one tier closer than their radii plus this share of them fuse (the pair pass stands touching balls exactly apart). */
export const MERGE_TOUCH = 0.02;
/** Halos the view keeps (a ring buffer). */
export const HALO_SLOTS = 12;
/**
 * The pair solver's broadphase margin, as a share of the Ball Size (at least `BROADPHASE_MIN_MARGIN` px): a pair farther
 * apart than its radii (plus the merge touch) and this margin is left out of the sub-step's candidate list, and the list is
 * rebuilt as soon as any ball has moved more than `BROADPHASE_REBUILD` of the margin since it was built – so a pair left out
 * can never touch, and the solver sees exactly the pairs the full double loop would, in the same order.
 */
export const BROADPHASE_MARGIN = 0.5;
export const BROADPHASE_MIN_MARGIN = 2;
export const BROADPHASE_REBUILD = 0.45;
/** Balls from which the solver lists its candidate pairs (fewer: the plain double loops are cheaper than building the list). */
export const BROADPHASE_MIN_BALLS = 20;

/** The pair solver's work since the mode was made (for the cost test and tools): distance checks, candidate list builds, pairs listed. */
export interface MergeRingSolverStats {
  pairChecks: number;
  builds: number;
  candidates: number;
  subSteps: number;
}

/* ------------------------------------------------------------------ view */

export interface MergeRingView {
  settings: MergeRingSettings;
  layout: MergeRingLayout | null;
  /** The simulation clock (ms). */
  timeMs: number;
  /** Counters. */
  spawned: number;
  balls: number;
  merges: number;
  /** The highest tier reached so far (0 before the first ball). */
  topTier: number;
  /** The last merge: when, where, which tier came out. */
  lastMergeMs: number;
  lastMergeTier: number;
  /** Notes (merge notes, the chord) and thuds queued. */
  notes: number;
  thuds: number;
  /** The tier of every live ball by id. */
  tierOf: Map<number, number>;
  /** The halos: place, the radius the pair had, the tier that came out and when (ms; −Infinity = empty). */
  haloX: Float64Array;
  haloY: Float64Array;
  haloR: Float64Array;
  haloTier: Uint8Array;
  haloMs: Float64Array;
  /** The final form: when it appeared (−1 before), its ball's id. */
  finalMs: number;
  finalId: number;
  /** The overflow: when (−1 before). */
  overflowMs: number;
  finished: boolean;
  /** Simulation ms the run finished at (−1 while it has not). */
  finishedMs: number;
}

function createView(): MergeRingView {
  return {
    settings: { ...DEFAULT_MERGE_RING_SETTINGS },
    layout: null,
    timeMs: 0,
    spawned: 0,
    balls: 0,
    merges: 0,
    topTier: 0,
    lastMergeMs: -Infinity,
    lastMergeTier: 0,
    notes: 0,
    thuds: 0,
    tierOf: new Map(),
    haloX: new Float64Array(HALO_SLOTS),
    haloY: new Float64Array(HALO_SLOTS),
    haloR: new Float64Array(HALO_SLOTS),
    haloTier: new Uint8Array(HALO_SLOTS),
    haloMs: new Float64Array(HALO_SLOTS).fill(-Infinity),
    finalMs: -1,
    finalId: -1,
    overflowMs: -1,
    finished: false,
    finishedMs: -1,
  };
}

/* ------------------------------------------------------------------ the mode */

export class MergeRingMode implements GameMode {
  readonly name = "mergeRing";
  /** The pile settles: no slow-ball boost. */
  readonly ballsMayRest = true;
  /** The mode resolves the balls against each other itself (soft, by mass): not the engine's elastic pair pass. */
  readonly ballsPassThrough = true;
  private settings: MergeRingSettings = { ...DEFAULT_MERGE_RING_SETTINGS };
  private readonly view: MergeRingView = createView();
  private layout: MergeRingLayout | null = null;
  private clockMs = 0;
  /** When the next ball leaves the chute (ms). */
  private nextSpawnMs = 0;
  private haloAt = 0;
  private thudsThisStep = 0;
  /** Per ball id: ms it has rested inside the chute, and when it last thudded. */
  private readonly restMs = new Map<number, number>();
  private readonly thudAt = new Map<number, number>();
  /** Balls that touched the rim or another ball this sub-step (they get the contact damping), and the sub-step's length (s). */
  private readonly touching = new Set<number>();
  /** Balls that stood on a ball under them during this step (a ball held up in the chute is an overflow). */
  private readonly supported = new Set<number>();
  private subSec = 0;
  /**
   * The broadphase (see `BROADPHASE_MARGIN`): the candidate pairs (i < j) of the sub-step grouped by i, every row's j
   * ascending (`candStart[i]` … `candStart[i + 1]` index `candJ`), each ball's tier and where it was when the list was
   * built. Off (`setBroadphase(false)`), the solver and the merge scan run the plain double loops.
   */
  private broadphase = true;
  private broadphaseFrom = BROADPHASE_MIN_BALLS;
  /** This sub-step's solver works from the list (the broadphase on and enough balls). */
  private listed = false;
  private candStart = new Int32Array(1);
  private candFill = new Int32Array(1);
  private candJ = new Int32Array(64);
  private candTier = new Int32Array(16);
  private candX = new Float64Array(16);
  private candY = new Float64Array(16);
  private candKey = new Float64Array(16);
  private candOrder = new Int32Array(16);
  private candOrderSize = -1;
  private candPairs = new Int32Array(128);
  private candMargin = 0;
  private candDirty = true;
  private readonly stats: MergeRingSolverStats = { pairChecks: 0, builds: 0, candidates: 0, subSteps: 0 };

  getSettings(): MergeRingSettings {
    return this.settings;
  }
  /** The tiers, the interval, the spawn tiers and the gravity apply on the next init; the rainbow at once. */
  setSettings(patch: Partial<MergeRingSettings>) {
    this.settings = resolveMergeRingSettings({ ...this.settings, ...patch });
    this.view.settings.rainbow = this.settings.rainbow;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): MergeRingView {
    return this.view;
  }
  getLayout(): MergeRingLayout | null {
    return this.layout;
  }
  getProgress() {
    const v = this.view;
    return { spawned: v.spawned, balls: v.balls, merges: v.merges, topTier: v.topTier, tiers: v.settings.tiers, final: v.finalMs >= 0, overflow: v.overflowMs >= 0, finished: v.finished };
  }
  /**
   * The pair solver's broadphase on (the default, from `minBalls` balls up) or off (the plain double loops): either way the
   * same pairs in the same order, so a run is the same bit for bit – only the number of distance checks differs.
   */
  setBroadphase(on: boolean, minBalls = BROADPHASE_MIN_BALLS) {
    this.broadphase = on;
    this.broadphaseFrom = minBalls;
    this.candDirty = true;
  }
  /** The solver's work so far (a live object: counters only grow). */
  getSolverStats(): Readonly<MergeRingSolverStats> {
    return this.stats;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const v = this.view;
    v.settings = { ...this.settings };
    this.clockMs = 0;
    this.nextSpawnMs = 0;
    this.haloAt = 0;
    this.thudsThisStep = 0;
    this.restMs.clear();
    this.thudAt.clear();
    this.touching.clear();
    this.supported.clear();
    v.timeMs = 0;
    v.spawned = 0;
    v.balls = 0;
    v.merges = 0;
    v.topTier = 0;
    v.lastMergeMs = -Infinity;
    v.lastMergeTier = 0;
    v.notes = 0;
    v.thuds = 0;
    v.tierOf.clear();
    v.haloMs.fill(-Infinity);
    v.finalMs = -1;
    v.finalId = -1;
    v.overflowMs = -1;
    v.finished = false;
    v.finishedMs = -1;
    this.rebuild(ctx);
    // The first ball leaves at once (the engine then adds no default ball).
    this.spawn(ctx);
  }

  private rebuild(ctx: ModeContext) {
    this.layout = buildMergeRingLayout(ctx.config.width, ctx.config.height, ctx.config.ballRadius || 8);
    this.view.layout = this.layout;
    ctx.setObstacles(this.layout.obstacles);
  }

  /** Gravity on a ball of normal weight (px/s²), as the engine applies it (without the music's boost). */
  private engineGravity(ctx: ModeContext) {
    return (ctx.config.gravity ?? 0) * ((ctx.config.ballSpeed || 400) / 300);
  }

  /** True while a ball sits where the next one would leave the chute. */
  private spawnBlocked(ctx: ModeContext): boolean {
    const L = this.layout!;
    const r = ctx.config.ballRadius || 8;
    for (const b of ctx.getBalls()) {
      if (Math.abs(b.x - L.cx) < L.chuteHalf && b.y < L.spawnY + b.radius + r + 1) return true;
    }
    return false;
  }

  /** A ball leaves the chute: its tier and its sideways jitter are the seed's. */
  private spawn(ctx: ModeContext) {
    const L = this.layout!;
    const v = this.view;
    const tier = spawnTierFor(ctx.random(), this.settings.spawnTiers);
    const jitter = (2 * ctx.random() - 1) * LAUNCH_JITTER;
    const base = ctx.config.ballRadius || 8;
    const radius = tierRadius(base, tier);
    const room = Math.max(0, L.chuteHalf - radius - 1);
    ctx.addBall({
      x: L.cx + Math.max(-room, Math.min(room, jitter * base)),
      y: L.spawnY,
      vx: 0,
      vy: 0,
      radius,
      radiusScale: tierScale(tier),
      color: tierColor(tier),
      gravityScale: this.settings.gravity,
    });
    const id = ctx.getNextId() - 1;
    v.tierOf.set(id, tier);
    this.restMs.set(id, 0);
    v.spawned++;
    v.balls = ctx.getBalls().length;
    if (tier > v.topTier) v.topTier = tier;
    this.nextSpawnMs = this.clockMs + this.settings.interval * 1000;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    this.thudsThisStep = 0;
    this.supported.clear();
    // A live change of the ball size re-spaces the chute.
    if (this.layout && (ctx.config.ballRadius || 8) !== this.layout.ballRadius) this.rebuild(ctx);
    this.clockMs += dtMs;
    v.timeMs = this.clockMs;
    // The next ball leaves when it is due and the top of the chute is free (a full chute waits; the overflow ends the run).
    if (v.finalMs < 0 && v.overflowMs < 0 && this.clockMs + 1e-6 >= this.nextSpawnMs) {
      if (this.spawnBlocked(ctx)) this.nextSpawnMs = this.clockMs + dtMs;
      else this.spawn(ctx);
    }
  }

  /** The rim: a ball that reaches it outside the chute's opening is put back inside and rebounds (like the ring modes' walls). */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const L = this.layout;
    if (!L) return;
    const v = this.view;
    this.subSec = dtSec;
    const tier = v.tierOf.get(ball.id);
    if (tier === undefined) return;
    ball.color = tierColor(tier);
    // Weak (or no) gravity on the page: the mode adds the rest of MIN_GRAVITY, so every ball comes down.
    const missing = MIN_GRAVITY - this.engineGravity(ctx);
    if (missing > 0) ball.vy += missing * this.settings.gravity * dtSec;
    const dx = ball.x - L.cx;
    const dy = ball.y - L.cy;
    const d = Math.hypot(dx, dy);
    const limit = L.radius - ball.radius;
    if (d <= limit || d === 0 || inChute(L, ball.x, ball.y, ball.radius)) return;
    const nx = -dx / d;
    const ny = -dy / d;
    ball.x = L.cx + (dx / d) * limit;
    ball.y = L.cy + (dy / d) * limit;
    const bounciness = ctx.getPhysicsExtras().wallBounciness;
    // --- bounce-math --- the ball's own bounciness on top (after the restitution cap), lifting at most to the ball speed × it
    const ballBounce = ball.restitution ?? 1;
    const lift = ballBounce > 1 ? (ctx.config.ballSpeed || 400) * bounciness * ballBounce : Infinity;
    const wallLift = bounciness > 1 ? (ctx.config.ballSpeed || 400) * bounciness : Infinity; // --- unlimited-sizes --- (a bouncier rim past the restitution cap)
    const impact = rebound(ball, nx, ny, 0, 0, RIM_RESTITUTION * bounciness, RIM_FRICTION, ballBounce, lift, bounciness, wallLift);
    this.touching.add(ball.id);
    if (impact < THUD_SPEED) return;
    ctx.noteBounce?.(ball); // --- bounce-math --- a rim rebound is a bounce
    const angle = Math.atan2(dy, dx);
    ctx.addWallHit(0, angle, L.radius);
    ctx.recordWallContact?.(0, angle, Math.min(1, impact / (ctx.config.ballSpeed || 400)));
    this.thud(ctx, ball, tier, impact);
  }

  /** A landing thud of `ball` (of `tier`) at `impact` px/s – at most `MAX_THUDS_PER_STEP` a step and one a ball per `THUD_COOLDOWN_MS`. */
  private thud(ctx: ModeContext, ball: Ball, tier: number, impact: number) {
    if (this.thudsThisStep >= MAX_THUDS_PER_STEP || this.clockMs - (this.thudAt.get(ball.id) ?? -Infinity) < THUD_COOLDOWN_MS) return;
    this.thudAt.set(ball.id, this.clockMs);
    this.thudsThisStep++;
    this.view.thuds++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: thudPitch(tier), thud: true, level: Math.min(0.7, 0.25 + impact / 800) });
  }

  /**
   * The balls against each other: every overlapping pair is pushed apart by inverse mass (mass by area) and loses its
   * approach speed to a soft restitution, with contact friction along the touch; a hard landing on the pile thuds.
   */
  private resolvePairs(ctx: ModeContext, balls: Ball[]) {
    const bounciness = ctx.getPhysicsExtras().wallBounciness;
    const e = Math.max(0, Math.min(1, PAIR_RESTITUTION * bounciness));
    this.stats.subSteps++;
    this.listed = this.broadphase && balls.length >= this.broadphaseFrom;
    if (this.listed) this.buildCandidates(ctx, balls);
    for (let pass = 0; pass < PAIR_ITERATIONS; pass++) this.pairPass(ctx, balls, e, pass === 0);
  }

  /**
   * One pass of the pair solver (`first`: the pass that hears the landings): every pair (i < j) in the order of the double
   * loop – with the broadphase on, only the listed ones (the others are too far apart to touch), the list rebuilt the
   * moment a push carried a ball past the rebuild distance and the pass picking up at the next pair of the same row.
   */
  private pairPass(ctx: ModeContext, balls: Ball[], e: number, first: boolean) {
    const n = balls.length;
    if (!this.listed) {
      this.plainPass(ctx, balls, e, first);
      return;
    }
    for (let i = 0; i < n; i++) {
      for (let k = this.candStart[i]; k < this.candStart[i + 1]; k++) {
        const j = this.candJ[k];
        if (!this.solvePair(ctx, balls, i, j, e, first)) continue;
        this.buildCandidates(ctx, balls);
        k = this.rowAfter(i, j) - 1;
      }
    }
  }

  /** A pass of the plain double loop (a few balls: cheaper than building the list) – `solvePair()` written out, every pair checked. */
  private plainPass(ctx: ModeContext, balls: Ball[], e: number, first: boolean) {
    const v = this.view;
    const n = balls.length;
    this.stats.pairChecks += (n * (n - 1)) / 2;
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      for (let j = i + 1; j < n; j++) {
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-9 ? dx / d : 0;
        const ny = d > 1e-9 ? dy / d : 1;
        const ia = 1 / (a.radius * a.radius);
        const ib = 1 / (b.radius * b.radius);
        const share = ia + ib;
        const push = (Math.max(0, reach - d - PAIR_SLOP) * PAIR_CORRECTION) / share;
        a.x -= nx * push * ia;
        a.y -= ny * push * ia;
        b.x += nx * push * ib;
        b.y += ny * push * ib;
        this.touching.add(a.id);
        this.touching.add(b.id);
        if (Math.abs(dy) > 0.3 * reach) this.supported.add(dy > 0 ? a.id : b.id);
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const rel = rvx * nx + rvy * ny;
        if (rel >= 0) continue;
        const jn = (-(1 + e) * rel) / share;
        a.vx -= jn * nx * ia;
        a.vy -= jn * ny * ia;
        b.vx += jn * nx * ib;
        b.vy += jn * ny * ib;
        const tx = -ny;
        const ty = nx;
        const slide = rvx * tx + rvy * ty;
        const jt = Math.max(-PAIR_FRICTION * jn, Math.min(PAIR_FRICTION * jn, -slide / share));
        a.vx -= jt * tx * ia;
        a.vy -= jt * ty * ia;
        b.vx += jt * tx * ib;
        b.vy += jt * ty * ib;
        if (first && -rel >= THUD_SPEED) {
          ctx.noteCollide?.(a, b); // --- bounce-math --- a ball hit
          const upper = a.y < b.y ? a : b;
          this.thud(ctx, upper, v.tierOf.get(upper.id) ?? 1, -rel);
        }
      }
    }
  }

  /** The pair (i, j): pushed apart, its approach speed and sliding taken, a landing heard; true when the broadphase must rebuild its list. */
  private solvePair(ctx: ModeContext, balls: Ball[], i: number, j: number, e: number, first: boolean): boolean {
    this.stats.pairChecks++;
    const a = balls[i];
    const b = balls[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const reach = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) return false;
    const d = Math.sqrt(d2);
    const nx = d > 1e-9 ? dx / d : 0;
    const ny = d > 1e-9 ? dy / d : 1;
    const ia = 1 / (a.radius * a.radius);
    const ib = 1 / (b.radius * b.radius);
    const share = ia + ib;
    const push = (Math.max(0, reach - d - PAIR_SLOP) * PAIR_CORRECTION) / share;
    a.x -= nx * push * ia;
    a.y -= ny * push * ia;
    b.x += nx * push * ib;
    b.y += ny * push * ib;
    const rebuild = push > 0 && (this.movedFar(a, i) || this.movedFar(b, j));
    this.touching.add(a.id);
    this.touching.add(b.id);
    // The upper of the two stands on the lower one.
    if (Math.abs(dy) > 0.3 * reach) this.supported.add(dy > 0 ? a.id : b.id);
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const rel = rvx * nx + rvy * ny;
    if (rel >= 0) return rebuild;
    const jn = (-(1 + e) * rel) / share;
    a.vx -= jn * nx * ia;
    a.vy -= jn * ny * ia;
    b.vx += jn * nx * ib;
    b.vy += jn * ny * ib;
    // Friction along the touch, at most what stops the sliding.
    const tx = -ny;
    const ty = nx;
    const slide = rvx * tx + rvy * ty;
    const jt = Math.max(-PAIR_FRICTION * jn, Math.min(PAIR_FRICTION * jn, -slide / share));
    a.vx -= jt * tx * ia;
    a.vy -= jt * ty * ia;
    b.vx += jt * tx * ib;
    b.vy += jt * ty * ib;
    if (first && -rel >= THUD_SPEED) {
      ctx.noteCollide?.(a, b); // --- bounce-math --- a ball hit
      const upper = a.y < b.y ? a : b;
      this.thud(ctx, upper, this.view.tierOf.get(upper.id) ?? 1, -rel);
    }
    return rebuild;
  }

  /**
   * The broadphase's candidate list from where the balls are now: a sort-and-sweep along x, then every pair closer than
   * its radii (with the merge touch) plus the margin, grouped by its lower index with the higher ones ascending – the
   * order of the double loop. A ball off the numbers (NaN) lists every pair, like the double loop would visit them.
   */
  private buildCandidates(ctx: ModeContext, balls: Ball[]) {
    const n = balls.length;
    this.stats.builds++;
    this.candDirty = false;
    if (this.candKey.length < n) {
      this.candKey = new Float64Array(2 * n);
      this.candTier = new Int32Array(2 * n);
      this.candX = new Float64Array(2 * n);
      this.candY = new Float64Array(2 * n);
      this.candOrder = new Int32Array(2 * n);
      this.candOrderSize = -1;
    }
    if (this.candStart.length < n + 1) {
      this.candStart = new Int32Array(2 * n + 1);
      this.candFill = new Int32Array(2 * n + 1);
    }
    const margin = Math.max(BROADPHASE_MIN_MARGIN, BROADPHASE_MARGIN * (ctx.config.ballRadius || 8));
    this.candMargin = margin;
    const half = 0.5 * margin;
    const key = this.candKey;
    const tier = this.candTier;
    let finite = true;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      key[i] = b.x - b.radius * (1 + MERGE_TOUCH) - half;
      if (!Number.isFinite(key[i]) || !Number.isFinite(b.y)) finite = false;
      tier[i] = this.view.tierOf.get(b.id) ?? -1;
      this.candX[i] = b.x;
      this.candY[i] = b.y;
    }
    // The balls by the left end of their reach: last sub-step's order re-sorted (nearly sorted already), anew when the count changed.
    const order = this.candOrder;
    if (this.candOrderSize !== n) {
      for (let i = 0; i < n; i++) order[i] = i;
      this.candOrderSize = n;
    }
    for (let s = 1; s < n; s++) {
      const o = order[s];
      const k = key[o];
      let t = s - 1;
      while (t >= 0 && key[order[t]] > k) {
        order[t + 1] = order[t];
        t--;
      }
      order[t + 1] = o;
    }
    let count = 0;
    let pairs = this.candPairs;
    for (let s = 0; s < n; s++) {
      const i = order[s];
      const a = balls[i];
      const hi = a.x + a.radius * (1 + MERGE_TOUCH) + half;
      for (let t = s + 1; t < n; t++) {
        const j = order[t];
        if (finite && key[j] > hi) break;
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lim = (a.radius + b.radius) * (1 + MERGE_TOUCH) + margin;
        if (finite && dx * dx + dy * dy >= lim * lim) continue;
        if (2 * count + 2 > pairs.length) {
          const grown = new Int32Array(2 * pairs.length + 2);
          grown.set(pairs);
          pairs = this.candPairs = grown;
        }
        pairs[2 * count] = i < j ? i : j;
        pairs[2 * count + 1] = i < j ? j : i;
        count++;
      }
    }
    // Rows by the lower index (a counting sort), each row's higher indices ascending (rows hold a few neighbours).
    const start = this.candStart;
    start.fill(0, 0, n + 1);
    for (let p = 0; p < count; p++) start[pairs[2 * p] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    if (this.candJ.length < count) this.candJ = new Int32Array(2 * count);
    const out = this.candJ;
    const fill = this.candFill;
    for (let i = 0; i < n; i++) fill[i] = start[i];
    for (let p = 0; p < count; p++) out[fill[pairs[2 * p]]++] = pairs[2 * p + 1];
    for (let i = 0; i < n; i++) {
      for (let k = start[i] + 1; k < start[i + 1]; k++) {
        const jv = out[k];
        let m = k - 1;
        while (m >= start[i] && out[m] > jv) {
          out[m + 1] = out[m];
          m--;
        }
        out[m + 1] = jv;
      }
    }
    this.stats.candidates += count;
  }

  /** True when `ball` (at index `i`) has moved past the rebuild distance since the candidate list was built. */
  private movedFar(ball: Ball, i: number): boolean {
    const dx = ball.x - this.candX[i];
    const dy = ball.y - this.candY[i];
    const limit = BROADPHASE_REBUILD * this.candMargin;
    return !(dx * dx + dy * dy <= limit * limit);
  }

  /** The first entry of row `i` of the candidate list whose partner comes after `j`. */
  private rowAfter(i: number, j: number): number {
    let k = this.candStart[i];
    const end = this.candStart[i + 1];
    while (k < end && this.candJ[k] <= j) k++;
    return k;
  }

  /** The chute walls are silent (a glow, no note): the sounds of the mode are the merges and the thuds. */
  onObstacleHit(): ObstacleHitResult {
    return { suppressSound: true };
  }

  /** After the pair pass: a ball the pass shoved across the rim is put back inside, then every touching pair of one tier fuses into the next tier. */
  onPostSubStep(ctx: ModeContext) {
    const L = this.layout;
    if (!L) return;
    const v = this.view;
    const balls = ctx.getBalls();
    const top = this.settings.tiers;
    this.resolvePairs(ctx, balls);
    // A ball resting on the pile or the rim settles: it keeps CONTACT_DAMPING of its speed a second.
    if (this.touching.size > 0) {
      const keep = Math.pow(CONTACT_DAMPING, this.subSec);
      for (const ball of balls) {
        if (!this.touching.has(ball.id)) continue;
        ball.vx *= keep;
        ball.vy *= keep;
      }
      this.touching.clear();
    }
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (inChute(L, ball.x, ball.y, ball.radius)) continue;
      const dx = ball.x - L.cx;
      const dy = ball.y - L.cy;
      const d = Math.hypot(dx, dy);
      const limit = L.radius - ball.radius;
      if (d > limit && d > 0) {
        ball.x = L.cx + (dx / d) * limit;
        ball.y = L.cy + (dy / d) * limit;
        // (the broadphase counts the move: past the rebuild distance the merge scan below gets a fresh list)
        if (this.listed && this.movedFar(ball, i)) this.candDirty = true;
      }
    }
    // Every touching pair of one tier, the lowest pair first (the broadphase's list holds every pair that can touch, in that order).
    if (this.listed && this.candDirty) this.buildCandidates(ctx, balls);
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      const ta = v.tierOf.get(a.id);
      if (ta === undefined || ta >= top || a.y < L.openY) continue;
      if (!this.listed) {
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (v.tierOf.get(b.id) !== ta || b.y < L.openY) continue;
          this.stats.pairChecks++;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const reach = a.radius + b.radius;
          if (dx * dx + dy * dy > reach * reach * (1 + MERGE_TOUCH) * (1 + MERGE_TOUCH)) continue;
          this.fuse(ctx, i, j, ta + 1);
          break; // ball i is the merged one now, at a new size: the next pass judges its new contacts
        }
        continue;
      }
      for (let k = this.candStart[i]; k < this.candStart[i + 1]; k++) {
        const j = this.candJ[k];
        if (this.candTier[j] !== ta) continue;
        const b = balls[j];
        if (b.y < L.openY) continue;
        this.stats.pairChecks++;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.radius + b.radius;
        if (dx * dx + dy * dy > reach * reach * (1 + MERGE_TOUCH) * (1 + MERGE_TOUCH)) continue;
        this.fuse(ctx, i, j, ta + 1);
        this.buildCandidates(ctx, balls); // (a new size, a ball gone and the indices after it shifted)
        break; // ball i is the merged one now, at a new size: the next pass judges its new contacts
      }
    }
  }

  /** The balls at `ia` < `ib` (one tier) fuse into one of `tier`: the first keeps its id and takes the place, the second goes. */
  private fuse(ctx: ModeContext, ia: number, ib: number, tier: number) {
    const L = this.layout!;
    const v = this.view;
    const balls = ctx.getBalls();
    const a = balls[ia];
    const b = balls[ib];
    const merged = mergeBalls(a, b);
    const base = ctx.config.ballRadius || 8;
    const radius = tierRadius(base, tier);
    const haloR = Math.max(a.radius, b.radius);
    let x = merged.x;
    let y = merged.y;
    // A merge that would overlap the rim is pushed inside.
    const dx = x - L.cx;
    const dy = y - L.cy;
    const d = Math.hypot(dx, dy);
    const limit = L.radius - radius;
    if (d > limit && d > 0) {
      x = L.cx + (dx / d) * limit;
      y = L.cy + (dy / d) * limit;
    }
    a.x = x;
    a.y = y;
    a.vx = merged.vx;
    a.vy = merged.vy;
    a.radius = radius;
    a.radiusScale = tierScale(tier);
    a.color = tierColor(tier);
    a.trail.length = 0;
    a.trailIndex = 0;
    v.tierOf.set(a.id, tier);
    v.tierOf.delete(b.id);
    this.restMs.delete(b.id);
    this.thudAt.delete(b.id);
    this.restMs.set(a.id, 0);
    balls.splice(ib, 1);
    this.candDirty = true; // (the broadphase's list: a new size, a ball gone)
    ctx.getLastWallLayer().delete(b.id);
    v.balls = balls.length;
    v.merges++;
    v.lastMergeMs = this.clockMs;
    v.lastMergeTier = tier;
    if (tier > v.topTier) v.topTier = tier;
    // The halo, the burst, the merge sound and the note of the tier.
    const h = this.haloAt;
    this.haloAt = (h + 1) % HALO_SLOTS;
    v.haloX[h] = x;
    v.haloY[h] = y;
    v.haloR[h] = haloR;
    v.haloTier[h] = tier;
    v.haloMs[h] = this.clockMs;
    ctx.spawnMergeBurst?.(x, y, tierColor(tier), radius);
    ctx.addPendingSoundEvent({ type: "merge", wallIndex: 0 });
    v.notes++;
    ctx.noteCollide?.(a, b); // --- bounce-math --- (a merge is a ball hit too)
    if (tier >= this.settings.tiers) {
      // FINAL FORM: the chord, confetti, the rim's flash (drawn from finalMs) and the hold before the end.
      v.finalMs = this.clockMs;
      v.finalId = a.id;
      const chord = finalChord(this.settings.tiers);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true });
      ctx.spawnConfetti(x, y);
      ctx.noteImpact?.();
    } else ctx.addPendingSoundEvent({ type: "hit", wallIndex: tier, frequency: mergePitch(tier) });
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const L = this.layout;
    if (!L) return;
    // The final form pulses in the pile a while, then the run is over.
    if (v.finalMs >= 0) {
      if (!v.finished && this.clockMs >= v.finalMs + FINAL_HOLD_MS - 1e-6) {
        v.finished = true;
        v.finishedMs = this.clockMs;
      }
      return;
    }
    // OVERFLOW: a ball at rest inside the chute, above the ring's opening, for OVERFLOW_MS.
    for (const ball of ctx.getBalls()) {
      if (!v.tierOf.has(ball.id)) continue;
      const resting = ball.y < L.openY && (Math.hypot(ball.vx, ball.vy) < REST_SPEED || this.supported.has(ball.id));
      const rest = resting ? (this.restMs.get(ball.id) ?? 0) + dtMs : 0;
      this.restMs.set(ball.id, rest);
      if (rest >= OVERFLOW_MS - 1e-6 && v.overflowMs < 0) {
        v.overflowMs = this.clockMs;
        v.finished = true;
        v.finishedMs = this.clockMs;
      }
    }
  }

  /**
   * A resize rebuilds the arena for the new canvas and maps every ball from the old ring into the new one (the engine scaled
   * the positions around the canvas centre per axis; that stretch is taken back first).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || !this.layout) return true;
    const old = this.layout;
    this.rebuild(ctx);
    const L = this.layout!;
    const k = L.radius / old.radius;
    for (const ball of ctx.getBalls()) {
      ball.trail.length = 0;
      ball.trailIndex = 0;
      const ox = old.width / 2 + ((ball.x - L.width / 2) * old.width) / L.width;
      const oy = old.height / 2 + ((ball.y - L.height / 2) * old.height) / L.height;
      ball.x = L.cx + (ox - old.cx) * k;
      ball.y = L.cy + (oy - old.cy) * k;
      ball.vx *= k;
      ball.vy *= k;
      // Inside the ring (or the chute) after the move, whatever the rounding.
      if (!inChute(L, ball.x, ball.y, ball.radius)) {
        const dx = ball.x - L.cx;
        const dy = ball.y - L.cy;
        const d = Math.hypot(dx, dy);
        const limit = L.radius - ball.radius;
        if (d > limit && d > 0) {
          ball.x = L.cx + (dx / d) * limit;
          ball.y = L.cy + (dy / d) * limit;
        }
      }
    }
    return true;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** There are no engine rings: the ring is the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { spawned: v.spawned, balls: v.balls, merges: v.merges, topTier: v.topTier, final: v.finalMs >= 0, overflow: v.overflowMs >= 0, finished: v.finished };
  }
}
