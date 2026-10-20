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
 * bouncing off each other in the engine's pair pass and off the chute walls, which are capsule segments of
 * ../obstacles.ts; the mode resolves the rim itself in `onBallStep()` (`rebound()` of obstacles.ts: a restitution like
 * the ring modes', the wall bounciness extra on top) and fuses the pairs in `onPostSubStep()`, after the pair pass has
 * stood every touching pair exactly against each other. Balls may rest (`ballsMayRest`: no slow-ball boost), so the pile
 * settles and keeps merging.
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
/** Restitution of the rim (like the ring modes' rebounds) and of the chute walls, and their contact friction. */
export const RIM_RESTITUTION = 0.5;
export const RIM_FRICTION = 0.04;
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

/** True when a ball at (x, y) is in the chute column above the ring's opening (the rim is open there). */
export function inChute(L: Pick<MergeRingLayout, "cx" | "cy" | "chuteHalf">, x: number, y: number): boolean {
  return y < L.cy && Math.abs(x - L.cx) < L.chuteHalf;
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
/** A ball slower than this (px/s) for `OVERFLOW_MS` inside the chute, above the ring's opening, overflows the ring. */
export const REST_SPEED = 14;
export const OVERFLOW_MS = 1500;
/** The launch jitter, as a fraction of the ball radius each way (a pile that never stacks on one line). */
export const LAUNCH_JITTER = 0.35;
/** Two balls of one tier closer than their radii plus this share of them fuse (the pair pass stands touching balls exactly apart). */
export const MERGE_TOUCH = 0.02;
/** Halos the view keeps (a ring buffer). */
export const HALO_SLOTS = 12;

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
    ctx.addBall({
      x: L.cx + jitter * base,
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
    if (d <= limit || d === 0 || inChute(L, ball.x, ball.y)) return;
    const nx = -dx / d;
    const ny = -dy / d;
    ball.x = L.cx + (dx / d) * limit;
    ball.y = L.cy + (dy / d) * limit;
    const bounciness = ctx.getPhysicsExtras().wallBounciness;
    // --- bounce-math --- the ball's own bounciness on top (after the restitution cap), lifting at most to the ball speed × it
    const ballBounce = ball.restitution ?? 1;
    const lift = ballBounce > 1 ? (ctx.config.ballSpeed || 400) * bounciness * ballBounce : Infinity;
    const impact = rebound(ball, nx, ny, 0, 0, RIM_RESTITUTION * bounciness, RIM_FRICTION, ballBounce, lift);
    if (impact < THUD_SPEED) return;
    ctx.noteBounce?.(ball); // --- bounce-math --- a rim rebound is a bounce
    const angle = Math.atan2(dy, dx);
    ctx.addWallHit(0, angle, L.radius);
    ctx.recordWallContact?.(0, angle, Math.min(1, impact / (ctx.config.ballSpeed || 400)));
    if (this.thudsThisStep >= MAX_THUDS_PER_STEP || this.clockMs - (this.thudAt.get(ball.id) ?? -Infinity) < THUD_COOLDOWN_MS) return;
    this.thudAt.set(ball.id, this.clockMs);
    this.thudsThisStep++;
    v.thuds++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: thudPitch(tier), thud: true, level: Math.min(0.7, 0.25 + impact / 800) });
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
    for (const ball of balls) {
      if (inChute(L, ball.x, ball.y)) continue;
      const dx = ball.x - L.cx;
      const dy = ball.y - L.cy;
      const d = Math.hypot(dx, dy);
      const limit = L.radius - ball.radius;
      if (d > limit && d > 0) {
        ball.x = L.cx + (dx / d) * limit;
        ball.y = L.cy + (dy / d) * limit;
      }
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      const ta = v.tierOf.get(a.id);
      if (ta === undefined || ta >= top || a.y < L.openY) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (v.tierOf.get(b.id) !== ta || b.y < L.openY) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.radius + b.radius;
        if (dx * dx + dy * dy > reach * reach * (1 + MERGE_TOUCH) * (1 + MERGE_TOUCH)) continue;
        this.fuse(ctx, i, j, ta + 1);
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
      const resting = ball.y < L.openY && Math.hypot(ball.vx, ball.vy) < REST_SPEED;
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
      if (!inChute(L, ball.x, ball.y)) {
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
