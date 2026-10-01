import { midiToFrequency } from "@/lib/audio/scales";
import { advanceRing, contactArc, createRingTrack, renormalizeRing, resolveRingContacts, sortRingOrder, type RingTrack } from "../ringTrack";
import { SpatialHash, createPairBuffer, type PairBuffer } from "../spatialHash";
import type { Ball, GameMode, ModeContext } from "../types";
import { wobbleStrength } from "../wobble";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Collision Playground ("collide" mode, the project.jdm "1247 varied bouncing orbs" formats): no rings. Hundreds
 * (10–2000) of orbs of varied sizes – masses proportional to their area – bounce around a circular or square
 * container and off each other with elastic collisions (`restitution` 0.7–1), optionally under gravity. Every
 * collision plays a soft note pitched by the smaller body's size (bigger = lower, on a pentatonic ladder the tone
 * generator then snaps to the chosen scale), at most `MAX_SOUNDS_PER_FRAME` per rendered frame – the most
 * energetic ones, kept across however many 60 Hz steps the frame runs (several at a faster playback speed) and
 * queued when the frame consumes its sounds (`flushPendingSounds()`) – so a dense run is a shimmering texture
 * instead of a wall of noise at any speed. Variants:
 *  - **squishy**: squash-and-stretch on every impact, a render-only deformation along the contact normal that
 *    decays over `SQUASH_MS` (120 ms);
 *  - **sync start**: all orbs start on a grid at the same instant (from rest under gravity, otherwise with one
 *    shared velocity), so they fall and bounce in sync ("Squishy BALLS bounce in SYNC");
 *  - **anti-collision**: at `antiCollisionAt` seconds the collision system switches off and the orbs pass through
 *    each other, with a colour change and a flash ("Collision System becomes ANTI-Collision");
 *  - **ring**: the bodies are constrained to a circular track and collide in one dimension along it, drawn as
 *    lollipops – a stick from the centre to a disc ("Lollipops collide on a ring"; see ringTrack.ts).
 *
 * The orbs are ordinary engine balls, so the engine integrates them (gravity scaled per ball by `gravity`, the
 * physics extras apply) and the recorder, pause, restart and playback speed work unchanged. The mode opts out of
 * the engine's O(n²) pair loop (`ballsPassThrough`) and resolves the collisions itself in `onPostSubStep()`: a
 * uniform spatial hash grid (spatialHash.ts) rebuilt every sub-step finds the candidate pairs among neighbouring
 * cells, then `COLLISION_ITERATIONS` passes push overlapping orbs apart (split by inverse mass, a small slop left
 * so resting piles do not jitter) and exchange momentum. The container walls are resolved per ball in
 * `onBallStep()`. Everything random – sizes, spawn positions, launch velocities – comes from `ctx.random()`, so a
 * seed replays exactly; the run is endless (the finder says so instead of searching).
 */

export const COLLIDE_CONTAINERS = ["circle", "box"] as const;
export type CollideContainer = (typeof COLLIDE_CONTAINERS)[number];

export function isCollideContainer(value: unknown): value is CollideContainer {
  return typeof value === "string" && (COLLIDE_CONTAINERS as readonly string[]).includes(value);
}

export interface CollideSettings {
  /** Orbs in play, 10–2000 (the ring holds at most `RING_MAX_BODIES`). */
  count: number;
  /** 0–1: spread of the sizes (log-uniform from 1/3× to 3× the base size at 1; 0 = all the same). */
  sizeSpread: number;
  container: CollideContainer;
  /** 0–1: how much of the Gravity setting pulls the orbs (0 = a floating gas). */
  gravity: number;
  /** Coefficient of restitution of every collision, 0.7–1 (1 = perfectly elastic). */
  restitution: number;
  /** Squash-and-stretch on impact (render only). */
  squishy: boolean;
  /** All orbs start on a grid at the same instant, so they bounce in sync. */
  syncStart: boolean;
  /** Seconds after which collisions switch off and the orbs pass through each other; 0 = never. */
  antiCollisionAt: number;
  /** Lollipops on a ring: the bodies are constrained to a circular track (1-D collisions). */
  ring: boolean;
}

export const DEFAULT_COLLIDE_SETTINGS: CollideSettings = {
  count: 300,
  sizeSpread: 0.6,
  container: "circle",
  gravity: 0.3,
  restitution: 1,
  squishy: false,
  syncStart: false,
  antiCollisionAt: 0,
  ring: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const COLLIDE_RANGES = {
  cpCount: { min: 10, max: 2000, step: 10 },
  cpSizeSpread: { min: 0, max: 1, step: 0.05 },
  cpGravity: { min: 0, max: 1, step: 0.05 },
  cpRestitution: { min: 0.7, max: 1, step: 0.01 },
  cpAntiCollisionAt: { min: 0, max: 120, step: 1 },
} as const;

/** The Collision Playground fields of the SimulatorSettings object (URL keys cpn, cpsz, cpc, cpg, cpe, cpsq, cpsy, cpac, cpr). */
export interface CollideSettingFields {
  cpCount: number;
  cpSizeSpread: number;
  cpContainer: CollideContainer;
  cpGravity: number;
  cpRestitution: number;
  cpSquishy: boolean;
  cpSyncStart: boolean;
  cpAntiCollisionAt: number;
  cpRing: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Fills in the defaults and clamps every value to its range (the count and the anti-collision time become whole numbers; an unknown container, non-boolean flags and bad numbers fall back to the defaults). */
export function resolveCollideSettings(config: Partial<CollideSettings> | null | undefined): CollideSettings {
  const out = { ...DEFAULT_COLLIDE_SETTINGS };
  if (!config) return out;
  if (config.count !== undefined) out.count = memoryCeiling("cpCount", Math.round(clampNumber(config.count, COLLIDE_RANGES.cpCount, out.count)));
  if (config.sizeSpread !== undefined) out.sizeSpread = clampNumber(config.sizeSpread, COLLIDE_RANGES.cpSizeSpread, out.sizeSpread);
  if (isCollideContainer(config.container)) out.container = config.container;
  if (config.gravity !== undefined) out.gravity = clampNumber(config.gravity, COLLIDE_RANGES.cpGravity, out.gravity);
  if (config.restitution !== undefined) out.restitution = clampNumber(config.restitution, COLLIDE_RANGES.cpRestitution, out.restitution);
  if (typeof config.squishy === "boolean") out.squishy = config.squishy;
  if (typeof config.syncStart === "boolean") out.syncStart = config.syncStart;
  if (config.antiCollisionAt !== undefined) out.antiCollisionAt = Math.round(clampNumber(config.antiCollisionAt, COLLIDE_RANGES.cpAntiCollisionAt, out.antiCollisionAt));
  if (typeof config.ring === "boolean") out.ring = config.ring;
  return out;
}

/** Picks the Collision Playground settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setCollideSettings()`. */
export function collideSettingsOf(source: CollideSettingFields): CollideSettings {
  return {
    count: source.cpCount,
    sizeSpread: source.cpSizeSpread,
    container: source.cpContainer,
    gravity: source.cpGravity,
    restitution: source.cpRestitution,
    squishy: source.cpSquishy,
    syncStart: source.cpSyncStart,
    antiCollisionAt: source.cpAntiCollisionAt,
    ring: source.cpRing,
  };
}

/** Writes resolved Collision Playground settings back into the SimulatorSettings field names. */
export function collideSettingFields(settings: CollideSettings): CollideSettingFields {
  return {
    cpCount: settings.count,
    cpSizeSpread: settings.sizeSpread,
    cpContainer: settings.container,
    cpGravity: settings.gravity,
    cpRestitution: settings.restitution,
    cpSquishy: settings.squishy,
    cpSyncStart: settings.syncStart,
    cpAntiCollisionAt: settings.antiCollisionAt,
    cpRing: settings.ring,
  };
}

/* ------------------------------------------------------------------ constants */

/** Most bodies on the ring (a track only holds so many lollipops; the rest of the count is ignored there). */
export const RING_MAX_BODIES = 36;
/** Fraction of the container the orbs cover at the default ball size (8 px); the Ball Size setting scales it. */
export const COLLIDE_FILL = 0.3;
/** The orbs never cover more than this fraction of the container, whatever the Ball Size. */
export const COLLIDE_MAX_FILL = 0.6;
/** Fraction of the ring's circumference the discs cover at the default ball size. */
export const RING_FILL = 0.5;
/** Most of the circumference the discs may cover. */
export const RING_MAX_FILL = 0.8;
/** At a size spread of 1 the radii span 1 / SIZE_SPREAD_RATIO … SIZE_SPREAD_RATIO times the base radius. */
export const SIZE_SPREAD_RATIO = 3;
/** Smallest orb radius (px). */
export const MIN_BODY_RADIUS = 1;
/**
 * Most collision sounds one rendered frame may play – however many 60 Hz steps it ran (several per frame at a faster
 * playback speed or on a late frame); the most energetic collisions win (every collision still counts and squashes).
 */
export const MAX_SOUNDS_PER_FRAME = 12;
/** A squash-and-stretch decays over this many (simulation) milliseconds. */
export const SQUASH_MS = 120;
/** Strongest squash (fraction of the radius the orb is flattened by along the contact normal). */
export const MAX_SQUASH = 0.35;
/** Overlap (px) left uncorrected, so a resting pile does not jitter. */
export const POSITION_SLOP = 0.25;
/** Fraction of the remaining overlap removed per pass. */
export const POSITION_CORRECTION = 0.8;
/** Passes over the contact pairs per sub-step. */
export const COLLISION_ITERATIONS = 3;
/**
 * Speed cap (× the Ball Speed; raised under strong gravity to what a fall across the container gives): a safety net
 * against a crowded pile squeezing an orb out at an absurd speed. It sits far above the speeds small orbs reach by
 * equipartition (their share of the energy makes them faster than big ones), so it never cools a normal run.
 */
export const MAX_SPEED_FACTOR = 8;
/** Level of a collision note relative to a normal wall hit at full impact (the notes are soft; weaker impacts are softer still). */
export const COLLIDE_SOFT_LEVEL = 0.35;
/** The pitch ladder: C major pentatonic from C3, `COLLIDE_PITCH_DEGREES` degrees (C3 … A5). */
export const COLLIDE_PITCH_BASE_MIDI = 48;
export const COLLIDE_PITCH_DEGREES = 15;
const PENTATONIC = [0, 2, 4, 7, 9];
/** The chord the anti-collision switch plays (C3 G3 C4 E4, accented). */
export const ANTI_COLLISION_CHORD: readonly number[] = [130.81, 196, 261.63, 329.63];
/** Hue buckets the renderer fills with one path each (the orbs are coloured by size, so a bucket is one colour). */
export const HUE_BUCKETS = 24;

/* ------------------------------------------------------------------ pure helpers */

/**
 * Size factor of an orb from a uniform draw `u` in [0, 1): log-uniform between 1 / SIZE_SPREAD_RATIO^spread and
 * SIZE_SPREAD_RATIO^spread, so at spread 1 the biggest orbs are nine times as wide as the smallest.
 */
export function sizeFactor(u: number, spread: number): number {
  if (!(spread > 0)) return 1;
  return Math.pow(SIZE_SPREAD_RATIO, spread * (2 * u - 1));
}

/**
 * Pitch (Hz) of a collision from the smaller body's radius: the orbs' sizes are placed on a pentatonic ladder
 * of `COLLIDE_PITCH_DEGREES` degrees from C3, the smallest orb of the run on the top degree and the biggest on
 * C3 (bigger = lower, log-scaled so every size step sounds alike). With all orbs the same size every collision
 * plays the middle degree.
 */
export function collidePitch(radius: number, minRadius: number, maxRadius: number): number {
  let degree: number;
  if (!(radius > 0) || !(minRadius > 0) || !(maxRadius > minRadius * 1.0001)) degree = Math.floor((COLLIDE_PITCH_DEGREES - 1) / 2);
  else {
    const t = Math.log(radius / minRadius) / Math.log(maxRadius / minRadius);
    degree = Math.round((1 - Math.max(0, Math.min(1, t))) * (COLLIDE_PITCH_DEGREES - 1));
  }
  const midi = COLLIDE_PITCH_BASE_MIDI + 12 * Math.floor(degree / PENTATONIC.length) + PENTATONIC[degree % PENTATONIC.length];
  return midiToFrequency(midi);
}

/** Level (0–1, relative to a normal hit) of a collision note: soft, and softer still for gentle impacts. */
export function collideLevel(impactSpeed: number, ballSpeed: number): number {
  const x = impactSpeed / (1.5 * Math.max(1, ballSpeed));
  return COLLIDE_SOFT_LEVEL * Math.max(0.2, Math.min(1, 0.2 + 0.8 * x));
}

/** Squash (0 … MAX_SQUASH) an impact at `impactSpeed` px/s gives a squishy orb. */
export function squashAmount(impactSpeed: number, ballSpeed: number): number {
  if (!(impactSpeed > 0)) return 0;
  return Math.min(MAX_SQUASH, (0.45 * impactSpeed) / Math.max(1, ballSpeed));
}

/** What is left of a squash of `amount` `ageMs` after the impact: eased out, gone after `SQUASH_MS`. */
export function squashAt(amount: number, ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= SQUASH_MS || !(amount > 0)) return 0;
  const u = 1 - ageMs / SQUASH_MS;
  return amount * u * u;
}

/** A squashed orb's scale along the contact normal and across it (flattened along, bulging across). */
export function squashScaleAlong(squash: number): number {
  return 1 - squash;
}
export function squashScaleAcross(squash: number): number {
  return 1 + 0.5 * squash;
}

export interface CollideField {
  kind: CollideContainer;
  cx: number;
  cy: number;
  /** Circle: its radius; box: half its side. */
  radius: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Side of the centred square the recorder crops to (the container is laid out in it). */
  side: number;
  /** The canvas the field was laid out for (a resize maps the orbs onto the new field isotropically). */
  canvasWidth: number;
  canvasHeight: number;
}

/** The container for a canvas of `width` × `height`: a circle or a square filling the centred square the recorder crops to, with a small margin. */
export function buildCollideField(width: number, height: number, kind: CollideContainer): CollideField {
  const side = Math.max(40, Math.min(width, height));
  const margin = Math.max(6, 0.03 * side);
  const half = side / 2 - margin;
  const cx = width / 2;
  const cy = height / 2;
  return { kind, cx, cy, radius: half, left: cx - half, top: cy - half, right: cx + half, bottom: cy + half, side, canvasWidth: width, canvasHeight: height };
}

/** Area inside the container (px²). */
export function fieldArea(field: CollideField): number {
  return field.kind === "circle" ? Math.PI * field.radius * field.radius : 4 * field.radius * field.radius;
}

/** Radius track of the lollipop ring inside a field (the discs of at most a fifth of the field radius still fit). */
export function ringTrackRadius(field: CollideField): number {
  return 0.76 * field.radius;
}

/** Base radius so that orbs with the size factors whose squares sum to `sumSq` cover `fill` of `area`. */
export function fillRadius(area: number, sumSq: number, fill: number): number {
  if (!(sumSq > 0) || !(area > 0)) return MIN_BODY_RADIUS;
  return Math.sqrt((fill * area) / (Math.PI * sumSq));
}

/**
 * Cell centres of a square lattice of pitch `pitch` centred in the field, keeping only cells that lie entirely
 * inside the container, row by row from the top. Writes x, y pairs into `out` (reset first) and stops after `max`
 * cells; returns the number of cells.
 */
export function syncGridCells(field: CollideField, pitch: number, max: number, out: number[] | null): number {
  if (out) out.length = 0;
  if (!(pitch > 0)) return 0;
  const span = 2 * field.radius;
  const cols = Math.floor(span / pitch + 1e-9);
  if (cols < 1) return 0;
  const x0 = field.cx - (cols * pitch) / 2 + pitch / 2;
  const y0 = field.cy - (cols * pitch) / 2 + pitch / 2;
  const h = pitch / 2;
  const r2 = field.radius * field.radius;
  let found = 0;
  for (let row = 0; row < cols && found < max; row++) {
    const y = y0 + row * pitch;
    const dy = Math.abs(y - field.cy) + h;
    for (let col = 0; col < cols && found < max; col++) {
      const x = x0 + col * pitch;
      if (field.kind === "circle") {
        const dx = Math.abs(x - field.cx) + h;
        if (dx * dx + dy * dy > r2 + 1e-9) continue;
      }
      if (out) out.push(x, y);
      found++;
    }
  }
  return found;
}

/** The widest lattice pitch that still has room for `count` cells inside the container (bisection, then a safety step down). */
export function syncGridPitch(field: CollideField, count: number): number {
  const n = Math.max(1, count);
  let lo = 0;
  let hi = 2 * field.radius;
  for (let it = 0; it < 48; it++) {
    const mid = (lo + hi) / 2;
    if (mid <= 0) break;
    if (syncGridCells(field, mid, n, null) >= n) lo = mid;
    else hi = mid;
  }
  let pitch = lo;
  for (let guard = 0; guard < 200 && pitch > 1e-6 && syncGridCells(field, pitch, n, null) < n; guard++) pitch *= 0.98;
  return pitch;
}

/* ------------------------------------------------------------------ the mode */

/** What the canvas needs to draw the playground; the same object every call (its arrays are replaced on a restart). */
export interface CollideView {
  /** The settings of the run in play. */
  settings: CollideSettings;
  field: CollideField | null;
  /** Radius of the lollipop track (0 without the ring). */
  ringRadius: number;
  /** Bodies in play; body k is the engine ball with id `firstId + k`, at index k of the ball list. */
  count: number;
  firstId: number;
  /** Colour of each body (hue in degrees): by size – small warm, big cool – or golden-angle steps without a size spread. */
  hue: Float32Array;
  /** Bodies grouped by hue bucket: bucket b holds `bucketOrder[bucketStart[b]] … bucketOrder[bucketStart[b + 1] − 1]`. */
  bucketOrder: Int32Array;
  bucketStart: Int32Array;
  /** Last impact of each body: sub-step tick, unit contact normal and squash amount (see `squashAt()`). */
  impactTick: Float64Array;
  impactNx: Float32Array;
  impactNy: Float32Array;
  impactAmount: Float32Array;
  /** Sub-steps simulated so far in this run, and the length of one (ms; 0 until the first step). */
  tick: number;
  tickMs: number;
  /** Tick of the last container hit (for the wall glow), −Infinity before the first. */
  lastWallHitTick: number;
  /** Body–body collisions, container hits and notes queued so far. */
  collisions: number;
  wallHits: number;
  notes: number;
  /** The anti-collision switch happened (at `antiTick`): the orbs pass through each other. */
  antiActive: boolean;
  antiTick: number;
  /** Bumped on every restart, so renderers can drop per-run caches. */
  generation: number;
}

const EMPTY_F32 = new Float32Array(0);
const EMPTY_F64 = new Float64Array(0);
const EMPTY_I32 = new Int32Array(0);

export class CollideMode implements GameMode {
  readonly name = "collide";
  /** Orbs may come to rest in a pile (no slow-ball boost). */
  readonly ballsMayRest = true;
  /** The engine's O(n²) pair loop is skipped: the mode resolves collisions itself with a spatial hash. */
  readonly ballsPassThrough = true;
  private settings: CollideSettings = { ...DEFAULT_COLLIDE_SETTINGS };
  private readonly view: CollideView = {
    settings: { ...DEFAULT_COLLIDE_SETTINGS },
    field: null,
    ringRadius: 0,
    count: 0,
    firstId: 0,
    hue: EMPTY_F32,
    bucketOrder: EMPTY_I32,
    bucketStart: new Int32Array(HUE_BUCKETS + 1),
    impactTick: EMPTY_F64,
    impactNx: EMPTY_F32,
    impactNy: EMPTY_F32,
    impactAmount: EMPTY_F32,
    tick: 0,
    tickMs: 0,
    lastWallHitTick: -Infinity,
    collisions: 0,
    wallHits: 0,
    notes: 0,
    antiActive: false,
    antiTick: -Infinity,
    generation: 0,
  };
  private n = 0;
  private firstId = 0;
  /** Size factor, radius and inverse mass (mass ∝ area) of every body. */
  private factor = EMPTY_F64;
  private invMass = EMPTY_F64;
  private minRadius = 1;
  private maxRadius = 1;
  // Broad phase scratch (per engine ball index), reused every sub-step.
  private readonly hash = new SpatialHash();
  private readonly pairs: PairBuffer = createPairBuffer(1024);
  private xs = EMPTY_F64;
  private ys = EMPTY_F64;
  private rs = EMPTY_F64;
  private bodyOf = EMPTY_I32;
  // Ring variant.
  private ring: RingTrack | null = null;
  private ringX = EMPTY_F64;
  private ringY = EMPTY_F64;
  // Clock and live-change tracking.
  private steps = 0;
  private subSec = 1 / 240;
  private lastBallSpeed = 400;
  private lastBallRadius = 8;
  private wallRestitution = 1;
  private minSoundSpeed = 25;
  private ballSpeed = 400;
  // Per-frame sound budget: the most energetic collisions since the sounds were last consumed (across steps).
  private readonly sndEnergy = new Float64Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndFreq = new Float64Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndLevel = new Float64Array(MAX_SOUNDS_PER_FRAME);
  private readonly sndOrder = new Int32Array(MAX_SOUNDS_PER_FRAME);
  private sndCount = 0;
  private ctx: ModeContext | null = null;

  getSettings(): CollideSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator re-inits the mode when a Collision Playground setting changes). */
  setSettings(patch: Partial<CollideSettings>) {
    this.settings = resolveCollideSettings({ ...this.settings, ...patch });
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): CollideView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { bodies: v.count, collisions: v.collisions, wallHits: v.wallHits, notes: v.notes, anti: v.antiActive, ring: v.settings.ring };
  }
  /** Radii of the smallest and the biggest body (px) – the ends of the pitch ladder. */
  getRadiusRange(): { min: number; max: number } {
    return { min: this.minRadius, max: this.maxRadius };
  }
  /** The ring variant's track (null without the ring), for tests and diagnostics. */
  getRingTrack(): RingTrack | null {
    return this.ring;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.ctx = ctx;
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    v.generation++;
    v.tick = 0;
    v.tickMs = 0;
    v.lastWallHitTick = -Infinity;
    v.collisions = 0;
    v.wallHits = 0;
    v.notes = 0;
    v.antiActive = false;
    v.antiTick = -Infinity;
    this.steps = 0;
    this.sndCount = 0;
    this.ballSpeed = ctx.config.ballSpeed || 400;
    this.lastBallSpeed = this.ballSpeed;
    this.lastBallRadius = ctx.config.ballRadius || 8;
    const field = buildCollideField(ctx.config.width, ctx.config.height, s.container);
    v.field = field;
    const n = s.ring ? Math.min(s.count, RING_MAX_BODIES) : s.count;
    this.n = n;
    v.count = n;
    this.firstId = ctx.getNextId();
    v.firstId = this.firstId;
    // Sizes: log-uniform around the base; the 2-D orbs are placed biggest first, which packs a crowded start better.
    const factor = new Float64Array(n);
    for (let k = 0; k < n; k++) factor[k] = sizeFactor(ctx.random(), s.sizeSpread);
    if (!s.ring) factor.sort().reverse();
    this.factor = factor;
    this.invMass = new Float64Array(n);
    v.hue = new Float32Array(n);
    v.impactTick = new Float64Array(n).fill(-Infinity);
    v.impactNx = new Float32Array(n);
    v.impactNy = new Float32Array(n);
    v.impactAmount = new Float32Array(n);
    this.ensureScratch(n);
    const radii = new Float64Array(n);
    this.computeRadii(radii, s.syncStart && !s.ring);
    this.assignHues();
    if (s.ring) this.initRing(ctx, field, radii);
    else this.initOrbs(ctx, field, radii);
  }

  /** Scratch arrays of the broad phase, sized for `n` balls. */
  private ensureScratch(n: number) {
    if (this.xs.length >= n) return;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.rs = new Float64Array(n);
    this.bodyOf = new Int32Array(n);
  }

  /**
   * Radius of every body for the current field and Ball Size (8 px = the default fill), capped so the orbs never
   * cover more than `COLLIDE_MAX_FILL` of the container (the discs `RING_MAX_FILL` of the ring) and one orb never
   * spans more than a fifth of the container; `sync` also fits them into the start grid. Updates the masses and
   * the pitch range.
   */
  private computeRadii(out: Float64Array, sync: boolean) {
    const field = this.view.field;
    const ctx = this.ctx;
    if (!field || !ctx) return;
    const s = this.view.settings;
    const n = this.n;
    const f = this.factor;
    const scale = (ctx.config.ballRadius || 8) / 8;
    let fmax = 0;
    for (let k = 0; k < n; k++) if (f[k] > fmax) fmax = f[k];
    let base: number;
    if (s.ring) {
      const R = ringTrackRadius(field);
      this.view.ringRadius = R;
      const L = 2 * Math.PI * R;
      let sum = 0;
      for (let k = 0; k < n; k++) sum += f[k];
      base = ((RING_FILL * L) / (2 * Math.max(1e-9, sum))) * scale;
      base = Math.min(base, (RING_MAX_FILL * L) / (2 * Math.max(1e-9, sum)));
      base = Math.min(base, (0.2 * field.radius) / Math.max(1e-9, fmax));
    } else {
      this.view.ringRadius = 0;
      const area = fieldArea(field);
      let sumSq = 0;
      for (let k = 0; k < n; k++) sumSq += f[k] * f[k];
      base = fillRadius(area, sumSq, COLLIDE_FILL) * scale;
      base = Math.min(base, fillRadius(area, sumSq, COLLIDE_MAX_FILL));
      base = Math.min(base, (0.2 * field.radius) / Math.max(1e-9, fmax));
      if (sync) base = Math.min(base, (0.45 * syncGridPitch(field, n)) / Math.max(1e-9, fmax));
    }
    let min = Infinity;
    let max = 0;
    for (let k = 0; k < n; k++) {
      const r = Math.max(MIN_BODY_RADIUS, base * f[k]);
      out[k] = r;
      this.invMass[k] = 1 / (r * r);
      if (r < min) min = r;
      if (r > max) max = r;
    }
    this.minRadius = n > 0 ? min : 1;
    this.maxRadius = n > 0 ? max : 1;
  }

  /** Colour per body and the hue buckets the renderer fills with one path each. */
  private assignHues() {
    const v = this.view;
    const n = this.n;
    const f = this.factor;
    let fmin = Infinity;
    let fmax = 0;
    for (let k = 0; k < n; k++) {
      if (f[k] < fmin) fmin = f[k];
      if (f[k] > fmax) fmax = f[k];
    }
    const spread = fmax > fmin * 1.0001;
    for (let k = 0; k < n; k++) {
      // Small orbs (high notes) are warm, big ones (low notes) cool; without a spread, golden-angle steps by index.
      const t = spread ? Math.log(f[k] / fmin) / Math.log(fmax / fmin) : 0;
      v.hue[k] = spread ? (10 + 250 * t) % 360 : (k * 137.508) % 360;
    }
    const bucketOf = (k: number) => Math.min(HUE_BUCKETS - 1, Math.floor((v.hue[k] / 360) * HUE_BUCKETS));
    const start = new Int32Array(HUE_BUCKETS + 1);
    for (let k = 0; k < n; k++) start[bucketOf(k) + 1]++;
    for (let b = 0; b < HUE_BUCKETS; b++) start[b + 1] += start[b];
    const fill = start.slice(0, HUE_BUCKETS);
    const order = new Int32Array(n);
    for (let k = 0; k < n; k++) order[fill[bucketOf(k)]++] = k;
    v.bucketStart = start;
    v.bucketOrder = order;
  }

  /** The 2-D orbs: a sync grid or random non-overlapping spots, launched in random directions (or together). */
  private initOrbs(ctx: ModeContext, field: CollideField, radii: Float64Array) {
    const s = this.settings;
    const n = this.n;
    const speed = this.ballSpeed;
    const xs = this.xs;
    const ys = this.ys;
    if (s.syncStart) {
      const cells: number[] = [];
      syncGridCells(field, syncGridPitch(field, n), n, cells);
      for (let k = 0; k < n; k++) {
        xs[k] = cells[2 * k] ?? field.cx;
        ys[k] = cells[2 * k + 1] ?? field.cy;
      }
    } else placeWithoutOverlap(field, radii, n, xs, ys, () => ctx.random());
    // Sync start: every orb released at the same instant – from rest under gravity, otherwise all with one velocity.
    const syncV = s.gravity > 0 ? 0 : 0.6 * speed;
    for (let k = 0; k < n; k++) {
      let vx = 0;
      let vy = syncV;
      if (!s.syncStart) {
        const a = ctx.random() * 2 * Math.PI;
        const sp = speed * (0.4 + 0.6 * ctx.random());
        vx = Math.cos(a) * sp;
        vy = Math.sin(a) * sp;
      }
      ctx.addBall({ x: xs[k], y: ys[k], vx, vy, radius: radii[k], color: orbColor(this.view.hue[k]), gravityScale: s.gravity, radiusScale: radii[k] / this.lastBallRadius });
    }
    this.ring = null;
  }

  /** The lollipops: discs spaced around the track (evenly with sync start), each with its own speed and direction. */
  private initRing(ctx: ModeContext, field: CollideField, radii: Float64Array) {
    const s = this.settings;
    const n = this.n;
    const R = this.view.ringRadius;
    const track = createRingTrack(n, R);
    const L = 2 * Math.PI * R;
    for (let k = 0; k < n; k++) {
      track.r[k] = radii[k];
      track.invMass[k] = this.invMass[k];
    }
    let used = 0;
    for (let k = 0; k < n; k++) used += contactArc(radii[k], radii[(k + 1) % n], R);
    const free = Math.max(0, L - used);
    const gaps = new Float64Array(n);
    let gapSum = 0;
    for (let k = 0; k < n; k++) {
      gaps[k] = s.syncStart ? 1 : 0.25 + ctx.random();
      gapSum += gaps[k];
    }
    let pos = ctx.random() * L;
    for (let k = 0; k < n; k++) {
      track.s[k] = pos;
      pos += contactArc(radii[k], radii[(k + 1) % n], R) + (free * gaps[k]) / gapSum;
    }
    const dir = ctx.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      if (s.syncStart) track.v[k] = dir * 0.6 * this.ballSpeed;
      else track.v[k] = (ctx.random() < 0.5 ? -1 : 1) * this.ballSpeed * (0.35 + 0.65 * ctx.random());
    }
    sortRingOrder(track);
    this.ring = track;
    this.ringX = new Float64Array(n);
    this.ringY = new Float64Array(n);
    this.placeRing(field);
    for (let k = 0; k < n; k++) {
      ctx.addBall({ x: this.ringX[k], y: this.ringY[k], vx: 0, vy: 0, radius: radii[k], color: orbColor(this.view.hue[k]), gravityScale: 0, radiusScale: radii[k] / this.lastBallRadius });
    }
  }

  /** Disc centres from the arc positions. */
  private placeRing(field: CollideField) {
    const track = this.ring;
    if (!track) return;
    const R = track.radius;
    const inv = R > 0 ? 1 / R : 0;
    for (let k = 0; k < track.n; k++) {
      const a = track.s[k] * inv;
      this.ringX[k] = field.cx + R * Math.cos(a);
      this.ringY[k] = field.cy + R * Math.sin(a);
    }
  }

  onPreUpdate(ctx: ModeContext) {
    const speed = ctx.config.ballSpeed || 400;
    this.ballSpeed = speed;
    // A live change of the ball speed scales every velocity (the pattern of the run stays).
    if (speed !== this.lastBallSpeed && this.lastBallSpeed > 0) {
      const f = speed / this.lastBallSpeed;
      if (this.ring) for (let k = 0; k < this.ring.n; k++) this.ring.v[k] *= f;
      else
        for (const ball of ctx.getBalls()) {
          ball.vx *= f;
          ball.vy *= f;
        }
    }
    this.lastBallSpeed = speed;
    // A live change of the ball size re-sizes the bodies (within the fill caps).
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius) {
      this.lastBallRadius = radius;
      this.applyRadii(ctx);
    }
    this.wallRestitution = this.view.settings.restitution * ctx.getPhysicsExtras().wallBounciness;
    // A contact is only heard when clearly faster than the speed one sub-step of gravity gives a resting orb.
    const g = this.gravityAccel(ctx);
    this.minSoundSpeed = Math.max(25, 0.06 * speed, 3 * g * this.subSec);
  }

  /** Acceleration (px/s²) gravity gives an orb: the engine's gravity term scaled by the playground's gravity. */
  private gravityAccel(ctx: ModeContext): number {
    return ctx.config.gravity * ((ctx.config.ballSpeed || 400) / 300) * this.view.settings.gravity;
  }

  /** The engine moved the orb: keep it inside the container (a rebound with the restitution) and under the speed cap. */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    this.subSec = dtSec;
    this.view.tickMs = dtSec * 1000;
    const k = ball.id - this.firstId;
    if (k < 0 || k >= this.n) return;
    if (this.ring) {
      // The lollipops are placed by the ring solver; nothing in the engine may move them.
      ball.x = this.ringX[k];
      ball.y = this.ringY[k];
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    const field = this.view.field;
    if (!field) return;
    this.containerBounce(ball, k, field, true, ctx);
    // Speed cap: a safety net against a pile squeezing an orb out at an absurd speed.
    const cap = Math.max(MAX_SPEED_FACTOR * this.ballSpeed, 1.5 * Math.sqrt(2 * this.gravityAccel(ctx) * 2 * field.radius));
    const v2 = ball.vx * ball.vx + ball.vy * ball.vy;
    if (v2 > cap * cap) {
      const f = cap / Math.sqrt(v2);
      ball.vx *= f;
      ball.vy *= f;
    }
  }

  /**
   * Resolves an orb against the container walls; `report` turns a real impact into a sound / squash and – with `ctx`, on
   * the circle – a contact for the Wobbly Walls (wall 0: the circle bulges out where an orb hits it; render-only).
   */
  private containerBounce(ball: Ball, k: number, field: CollideField, report: boolean, ctx?: ModeContext) {
    const e = this.wallRestitution;
    const r = ball.radius;
    if (field.kind === "circle") {
      const dx = ball.x - field.cx;
      const dy = ball.y - field.cy;
      const lim = field.radius - r;
      if (lim <= 0) {
        ball.x = field.cx;
        ball.y = field.cy;
        return;
      }
      const d2 = dx * dx + dy * dy;
      if (d2 <= lim * lim) return;
      const d = Math.sqrt(d2);
      const nx = d > 0 ? dx / d : 0;
      const ny = d > 0 ? dy / d : 1;
      ball.x = field.cx + nx * lim;
      ball.y = field.cy + ny * lim;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn > 0) {
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        if (report) {
          this.wallImpact(k, r, nx, ny, vn);
          // A real impact (not an orb resting on the wall or pressed against it by the pile) makes the wall wobble.
          if (ctx && vn >= this.minSoundSpeed) ctx.recordWallContact?.(0, Math.atan2(ny, nx), wobbleStrength(vn, this.ballSpeed));
        }
      }
      return;
    }
    if (ball.x - r < field.left) {
      ball.x = field.left + r;
      if (ball.vx < 0) {
        const vn = -ball.vx;
        ball.vx = vn * e;
        if (report) this.wallImpact(k, r, 1, 0, vn);
      }
    } else if (ball.x + r > field.right) {
      ball.x = field.right - r;
      if (ball.vx > 0) {
        const vn = ball.vx;
        ball.vx = -vn * e;
        if (report) this.wallImpact(k, r, 1, 0, vn);
      }
    }
    if (ball.y - r < field.top) {
      ball.y = field.top + r;
      if (ball.vy < 0) {
        const vn = -ball.vy;
        ball.vy = vn * e;
        if (report) this.wallImpact(k, r, 0, 1, vn);
      }
    } else if (ball.y + r > field.bottom) {
      ball.y = field.bottom - r;
      if (ball.vy > 0) {
        const vn = ball.vy;
        ball.vy = -vn * e;
        if (report) this.wallImpact(k, r, 0, 1, vn);
      }
    }
  }

  private wallImpact(k: number, radius: number, nx: number, ny: number, speed: number) {
    if (speed < this.minSoundSpeed) return;
    const v = this.view;
    v.wallHits++;
    v.lastWallHitTick = v.tick;
    this.markImpact(k, nx, ny, speed);
    this.offerSound((0.5 * speed * speed) / this.invMass[k], collidePitch(radius, this.minRadius, this.maxRadius), collideLevel(speed, this.ballSpeed));
  }

  /** Remembers the strongest recent impact of body k (the renderer's squash and flash). */
  private markImpact(k: number, nx: number, ny: number, speed: number) {
    const v = this.view;
    const amount = squashAmount(speed, this.ballSpeed);
    const remaining = squashAt(v.impactAmount[k], (v.tick - v.impactTick[k]) * v.tickMs);
    if (amount < remaining) return;
    v.impactTick[k] = v.tick;
    v.impactNx[k] = nx;
    v.impactNy[k] = ny;
    v.impactAmount[k] = amount;
  }

  /** Offers a note to the frame's budget: kept while there is room, else it replaces the weakest when it is more energetic. */
  private offerSound(energy: number, frequency: number, level: number) {
    let slot = this.sndCount;
    if (slot >= MAX_SOUNDS_PER_FRAME) {
      slot = 0;
      for (let i = 1; i < MAX_SOUNDS_PER_FRAME; i++) if (this.sndEnergy[i] < this.sndEnergy[slot]) slot = i;
      if (!(energy > this.sndEnergy[slot])) return;
    } else this.sndCount++;
    this.sndEnergy[slot] = energy;
    this.sndFreq[slot] = frequency;
    this.sndLevel[slot] = level;
  }

  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    if (this.ring) this.stepRing(ctx);
    else if (!v.antiActive) this.collideOrbs(ctx);
    v.tick++;
  }

  /** Broad phase (spatial hash of the sub-step's positions) and narrow phase (overlap push-out and impulses), then the container again. */
  private collideOrbs(ctx: ModeContext) {
    const field = this.view.field;
    if (!field) return;
    const balls = ctx.getBalls();
    const m = balls.length;
    this.ensureScratch(m);
    const { xs, ys, rs, bodyOf } = this;
    let maxR = 0;
    for (let i = 0; i < m; i++) {
      const b = balls[i];
      xs[i] = b.x;
      ys[i] = b.y;
      rs[i] = b.radius;
      if (b.radius > maxR) maxR = b.radius;
      const k = b.id - this.firstId;
      bodyOf[i] = k >= 0 && k < this.n ? k : -1;
    }
    const margin = Math.max(0.5, 0.2 * maxR);
    this.hash.build(xs, ys, m, 2 * maxR + margin, field.left - maxR, field.top - maxR, field.right + maxR, field.bottom + maxR);
    const count = this.hash.collectContacts(xs, ys, rs, margin, this.pairs);
    const pairs = this.pairs.pairs;
    // Alternate the direction of the passes, so a push travels through a pile both ways.
    for (let it = 0; it < COLLISION_ITERATIONS; it++) {
      const forward = it % 2 === 0;
      for (let q = 0; q < count; q++) {
        const p = forward ? q : count - 1 - q;
        const i = pairs[2 * p];
        const j = pairs[2 * p + 1];
        this.resolvePair(balls[i], balls[j], bodyOf[i], bodyOf[j]);
      }
      // The push-outs may have nudged an orb through the wall: put it back (silently), so the next pass pushes its neighbours instead.
      if (count > 0) for (let i = 0; i < m; i++) this.containerBounce(balls[i], bodyOf[i], field, false);
    }
  }

  /** One contact: push the overlap apart (split by inverse mass, minus the slop) and, while approaching, exchange momentum. */
  private resolvePair(a: Ball, b: Ball, ka: number, kb: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minD = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) return;
    const d = Math.sqrt(d2);
    // Coincident centres (only ever from a crowded start) separate along x, deterministically.
    const nx = d > 1e-9 ? dx / d : 1;
    const ny = d > 1e-9 ? dy / d : 0;
    const ima = ka >= 0 ? this.invMass[ka] : 1 / (a.radius * a.radius);
    const imb = kb >= 0 ? this.invMass[kb] : 1 / (b.radius * b.radius);
    const sum = ima + imb;
    const pen = minD - d;
    if (pen > POSITION_SLOP) {
      const corr = ((pen - POSITION_SLOP) * POSITION_CORRECTION) / sum;
      a.x -= nx * corr * ima;
      a.y -= ny * corr * ima;
      b.x += nx * corr * imb;
      b.y += ny * corr * imb;
    }
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) return;
    const j = (-(1 + this.view.settings.restitution) * rel) / sum;
    a.vx -= j * ima * nx;
    a.vy -= j * ima * ny;
    b.vx += j * imb * nx;
    b.vy += j * imb * ny;
    this.bodyImpact(ka, kb, a.radius, b.radius, nx, ny, -rel, 1 / sum);
  }

  /** A body–body impact: count it, squash both, offer the note of the smaller body. */
  private bodyImpact(ka: number, kb: number, ra: number, rb: number, nx: number, ny: number, speed: number, reducedMass: number) {
    if (speed < this.minSoundSpeed) return;
    this.view.collisions++;
    if (ka >= 0) this.markImpact(ka, nx, ny, speed);
    if (kb >= 0) this.markImpact(kb, nx, ny, speed);
    this.offerSound(0.5 * reducedMass * speed * speed, collidePitch(Math.min(ra, rb), this.minRadius, this.maxRadius), collideLevel(speed, this.ballSpeed));
  }

  /** The lollipops: integrate the arc positions, resolve the 1-D contacts (unless anti-collision is on) and place the discs. */
  private stepRing(ctx: ModeContext) {
    const track = this.ring;
    const field = this.view.field;
    if (!track || !field) return;
    const run = this.view.settings;
    advanceRing(track, this.subSec, run.gravity > 0 ? this.gravityAccel(ctx) : 0);
    if (!this.view.antiActive) resolveRingContacts(track, run.restitution, 4, this.onRingImpact);
    this.placeRing(field);
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const k = balls[i].id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      balls[i].x = this.ringX[k];
      balls[i].y = this.ringY[k];
    }
  }

  /** Impact callback of the ring solver (an arrow property, so no closure is created per call). */
  private readonly onRingImpact = (a: number, b: number, speed: number) => {
    const track = this.ring;
    if (!track) return;
    const angle = track.s[a] / track.radius;
    const im = track.invMass[a] + track.invMass[b];
    this.bodyImpact(a, b, track.r[a], track.r[b], -Math.sin(angle), Math.cos(angle), speed, im > 0 ? 1 / im : 0);
  };

  /**
   * End of a 60 Hz step: the anti-collision switch and the ring bookkeeping. The step's notes stay in the budget,
   * which keeps the strongest of every step the frame runs until `flushPendingSounds()` queues them.
   */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const s = v.settings;
    this.steps++;
    const t = this.steps * (dtMs / 1000);
    if (!v.antiActive && s.antiCollisionAt > 0 && t >= s.antiCollisionAt - 1e-9) this.switchToAntiCollision(ctx);
    if (this.ring) renormalizeRing(this.ring, v.antiActive);
  }

  /** "Collision System becomes ANTI-Collision": collisions off, a new colour for every orb and an accented chord. */
  private switchToAntiCollision(ctx: ModeContext) {
    const v = this.view;
    v.antiActive = true;
    v.antiTick = v.tick;
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const k = balls[i].id - this.firstId;
      if (k >= 0 && k < this.n) balls[i].color = ghostColor(v.hue[k]);
    }
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: ANTI_COLLISION_CHORD[0], accent: true, chord: [...ANTI_COLLISION_CHORD] });
  }

  /**
   * Called by `engine.consumeSoundEvents()` once per rendered frame: queues the frame's budget – at most
   * `MAX_SOUNDS_PER_FRAME` notes, most energetic first – and empties it, so a faster playback speed (more steps per
   * frame) never piles up more simultaneous voices. Sound only: the physics never reads the budget.
   */
  flushPendingSounds(ctx: ModeContext) {
    const count = this.sndCount;
    if (count === 0) return;
    const order = this.sndOrder;
    for (let i = 0; i < count; i++) order[i] = i;
    // Most energetic first (insertion sort of at most 12), so with the beat lock the strongest collision takes the slot.
    for (let i = 1; i < count; i++) {
      const cur = order[i];
      let j = i - 1;
      while (j >= 0 && this.sndEnergy[order[j]] < this.sndEnergy[cur]) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = cur;
    }
    for (let i = 0; i < count; i++) {
      const slot = order[i];
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: this.sndFreq[slot], level: this.sndLevel[slot] });
    }
    this.view.notes += count;
    this.sndCount = 0;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /** A canvas resize lays the container out again and maps every body onto it isotropically (undoing the engine's per-axis stretch). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const old = this.view.field;
    if (!sizeChanged || !old) return true;
    const field = buildCollideField(ctx.config.width, ctx.config.height, old.kind);
    this.view.field = field;
    const k = field.side / old.side;
    const sx = ctx.config.width / old.canvasWidth;
    const sy = ctx.config.height / old.canvasHeight;
    if (this.ring) {
      const scale = ringTrackRadius(field) / Math.max(1e-9, this.ring.radius);
      for (let i = 0; i < this.ring.n; i++) this.ring.s[i] *= scale;
      this.ring.radius = ringTrackRadius(field);
    } else {
      for (const ball of ctx.getBalls()) {
        ball.x = field.cx + ((ball.x - field.cx) * k) / (sx || 1);
        ball.y = field.cy + ((ball.y - field.cy) * k) / (sy || 1);
      }
    }
    this.applyRadii(ctx);
    return true;
  }

  /** Recomputes the radii (Ball Size change, resize) and writes them into the balls and the ring; keeps everything inside. */
  private applyRadii(ctx: ModeContext) {
    const field = this.view.field;
    if (!field || this.n === 0) return;
    const radii = new Float64Array(this.n);
    // A sync start keeps its orbs sized for the grid, so a resize before (or after) the release keeps them apart.
    this.computeRadii(radii, this.view.settings.syncStart && !this.view.settings.ring);
    const ballRadius = ctx.config.ballRadius || 8;
    for (const ball of ctx.getBalls()) {
      const k = ball.id - this.firstId;
      if (k < 0 || k >= this.n) continue;
      ball.radius = radii[k];
      ball.radiusScale = radii[k] / ballRadius;
    }
    if (this.ring) {
      for (let k = 0; k < this.n; k++) {
        this.ring.r[k] = radii[k];
        this.ring.invMass[k] = this.invMass[k];
      }
      // Discs that grew into each other are separated along the track (a pair that was closing in rebounds as usual).
      resolveRingContacts(this.ring, this.view.settings.restitution, 8);
      this.placeRing(field);
      for (const ball of ctx.getBalls()) {
        const k = ball.id - this.firstId;
        if (k < 0 || k >= this.n) continue;
        ball.x = this.ringX[k];
        ball.y = this.ringY[k];
      }
    } else for (const ball of ctx.getBalls()) this.containerBounce(ball, ball.id - this.firstId, field, false);
  }

  /** The container is handled in onBallStep; there are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The playground never finishes (the finder reports an endless run). */
  isFinished() {
    return false;
  }
  getState() {
    const v = this.view;
    return { bodies: v.count, collisions: v.collisions, wallHits: v.wallHits, notes: v.notes, anti: v.antiActive, tick: v.tick };
  }
}

/**
 * Random non-overlapping spots inside the container for discs of the given radii (biggest first works best),
 * written into xs / ys: every disc tries up to 80 uniform spots and takes the first that overlaps nothing placed
 * so far (checked in a bucket grid), else the last one tried – the solver pushes such a rare overlap apart in the
 * first sub-steps. `random` is the engine's seeded generator.
 */
export function placeWithoutOverlap(field: CollideField, radii: ArrayLike<number>, n: number, xs: Float64Array, ys: Float64Array, random: () => number) {
  let maxR = 0;
  for (let k = 0; k < n; k++) if (radii[k] > maxR) maxR = radii[k];
  const cell = Math.max(1e-6, 2 * maxR);
  const cols = Math.max(1, Math.min(2048, Math.ceil((2 * field.radius) / cell)));
  const x0 = field.cx - field.radius;
  const y0 = field.cy - field.radius;
  const head = new Int32Array(cols * cols).fill(-1);
  const next = new Int32Array(Math.max(1, n)).fill(-1);
  const col = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor((x - x0) / cell)));
  const row = (y: number) => Math.max(0, Math.min(cols - 1, Math.floor((y - y0) / cell)));
  const fits = (x: number, y: number, r: number) => {
    const cx = col(x);
    const cy = row(y);
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(cols - 1, cy + 1); gy++) {
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++) {
        for (let j = head[gy * cols + gx]; j >= 0; j = next[j]) {
          const dx = xs[j] - x;
          const dy = ys[j] - y;
          const reach = radii[j] + r;
          if (dx * dx + dy * dy < reach * reach) return false;
        }
      }
    }
    return true;
  };
  for (let k = 0; k < n; k++) {
    const r = radii[k];
    const room = Math.max(0, field.radius - r);
    let x = field.cx;
    let y = field.cy;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (field.kind === "circle") {
        const rho = room * Math.sqrt(random());
        const a = 2 * Math.PI * random();
        x = field.cx + rho * Math.cos(a);
        y = field.cy + rho * Math.sin(a);
      } else {
        x = field.cx + (2 * random() - 1) * room;
        y = field.cy + (2 * random() - 1) * room;
      }
      if (fits(x, y, r)) break;
    }
    xs[k] = x;
    ys[k] = y;
    const c = row(y) * cols + col(x);
    next[k] = head[c];
    head[c] = k;
  }
}

/** Colour of an orb for its hue. */
export function orbColor(hue: number): string {
  return `hsl(${Math.round(hue)}, 85%, 60%)`;
}

/** Colour of an orb after the anti-collision switch: the complementary hue, lighter (the renderer also draws it translucent and additive). */
export function ghostColor(hue: number): string {
  return `hsl(${Math.round((hue + 180) % 360)}, 95%, 70%)`;
}
