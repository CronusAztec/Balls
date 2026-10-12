import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { grooveProgression } from "@/lib/audio/loopTones";
import { midiToFrequency } from "@/lib/audio/scales";
import {
  BR_BALL_CEILING,
  BR_BED_ROOT_MIDI,
  BR_CAPSULE_CEILING,
  BR_CAPSULE_SPEED,
  BR_LAUNCH_SPREAD,
  BR_PADDLE_H,
  BR_PADDLE_LIFT,
  BR_PADDLE_SHARE,
  BR_PADDLE_SPEED,
  BR_PLUCK_SPAN,
  BR_SETTLE_FRICTION,
  BR_SETTLE_GRAVITY,
  BR_SETTLE_RESTITUTION,
  BR_SPLIT_FAN,
  DEFAULT_BRICK_REBUILD,
  brickDegree,
  brickDropBeat,
  brickField,
  brickMask,
  brickPluckFrequency,
  cellAt,
  clampInside,
  rebuildFlightMs,
  rebuildLandMs,
  rebuildOrder,
  spawnDue,
  sweepBody,
  symmetryImages,
  applyImage,
  foldIntoWedge,
  wedgeAngle,
  isBrOrder,
  isBrPicture,
  isBrSymmetryMode,
  type BrickField,
  type BrickRebuildSettings,
  type SweepBody,
} from "../brickRebuild";
import { emblemPicture, layerRanks, mandalaPicture, textPicture, cleanBrickText, type BrickPicture } from "../brickPicture";

/*
 * --- brick-rebuild --- Brick Smash (the loop family's Breakout picture smash and rebuild, with the gold-capsule and kaleidoscope
 * variants): a W × H picture of one-hit bricks fills the top of a box; a few balls start at the bottom, every brick they touch
 * breaks (greys and shrinks away) and every `every`-th break adds a ball at that brick – the count falls slowly, then
 * exponentially, then slowly again for the last corner bricks. At 0 bricks gravity drops the balls to the floor (the settle),
 * the bricks fly back from off-screen colour layer by colour layer (the rebuild, the counter counting back up), the balls fade
 * and the start balls reappear: the seam, where the state equals the run's start – so the run loops forever, every cycle the
 * first one exactly (`cycleSeconds()`, `loopSeams()`).
 *
 * The balls are plain engine balls (no engine gravity – `gravityScale` 0 –, no ring walls, `ballsPassThrough`): the engine moves
 * them, and `onBallStep()` takes the move back and sweeps it through the playfield itself (lib/physics/brickRebuild.ts
 * `sweepBody()`: a DDA over the grid's cells, the first face met bounces the ball – no tunnelling at any speed or size).
 *
 * Variants: **gold capsules** (`capsules`): a broken brick drops a capsule with `capsuleChance`, an auto-paddle above the floor
 * catches it and every ball in play splits into `split` (up to the board's ball ceiling); **kaleidoscope** (`symmetry` > 1): a
 * circle with a hole, the real balls simulated in one wedge of 360° / images (mirror walls or rotations) and drawn with all their
 * images, every brick hit applied to the brick's images too, so the mosaic breaks symmetrically.
 *
 * Seeded choices, in this order (`ctx.random()`, at init): 1. the cycle's own seed (a Mulberry32 stream re-seeded at every
 * cycle's start: the spawn directions and the capsule draws, so every cycle replays the first), 2. the groove bed's chord
 * progression, 3. every cell's fly-in angle, 4. every cell's rank of the "random" rebuild order (a shuffle), 5. the start balls'
 * launch angles (and, in the kaleidoscope, their place in the wedge).
 */

export type BrPhase = "smash" | "settle" | "rebuild";

/** The ring of recent breaks the renderer draws as ghost squares (greying and shrinking away over BR_GHOST_MS). */
export const BR_GHOST_CAP = 4096;
/** The most capsules falling at once (the oldest is dropped past it). */
export const BR_CAPSULE_MAX = BR_CAPSULE_CEILING;
/** A brick's hit points are a 32-bit count (a billion hits: never reached by any run). */
export const BR_HP_CEILING = 1_000_000_000;
/** Plucks a 60 Hz tick may start (the loop sounds' voice budget). */
export const BR_NOTES_PER_TICK = 6;
/** Bounce-math triggers reported per step at most (hundreds of balls bounce every step). */
export const BR_BOUNCE_TRIGGERS_PER_STEP = 24;
/** Levels of the groove's kick, the drop's impact, the clear's impact, the rebuild's wash, the last brick's ding, the reset glide. */
export const BR_KICK_LEVEL = 0.85;
export const BR_IMPACT_LEVEL = 0.9;
export const BR_WASH_LEVEL = 0.8;
export const BR_DING_LEVEL = 0.8;
export const BR_GLIDE_LEVEL = 0.7;
/** The reset glide's longest length (s; it ends exactly at the seam). */
export const BR_GLIDE_SEC = 1.5;
/** The capsule catch's chime and the split's riser (Hz). */
export const BR_CHIME_HZ = 1760;
export const BR_RISER_HZ = 220;
/** The balls fade over this share of the rebuild; the start balls fade in over its last `BR_START_FADE_SEC`. */
export const BR_FADE_SHARE = 0.6;
export const BR_START_FADE_SEC = 0.5;

const TWO_PI = 2 * Math.PI;
const EMPTY_I32 = new Int32Array(0);
const EMPTY_F64 = new Float64Array(0);
const EMPTY_U8 = new Uint8Array(0);

/** Mulberry32: the cycle's own random stream (re-seeded at every cycle's start). */
function nextMulberry(state: { s: number }): number {
  let t = (state.s = (state.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}

function smoothStep(u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}

/** Validates the engine's settings (the page resolves its fields first; a direct caller – a test, the finder – may pass anything). */
export function resolveBrickRebuildSettings(patch: Partial<BrickRebuildSettings> | null | undefined): BrickRebuildSettings {
  const d = DEFAULT_BRICK_REBUILD;
  const p = patch ?? {};
  const num = (v: unknown, fallback: number, min: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, v) : fallback);
  const whole = (v: unknown, fallback: number, min: number) => Math.round(num(v, fallback, min));
  return {
    cols: whole(p.cols, d.cols, 1),
    rows: whole(p.rows, d.rows, 1),
    wallPct: num(p.wallPct, d.wallPct, 1),
    balls: Math.min(BR_BALL_CEILING, whole(p.balls, d.balls, 1)),
    every: whole(p.every, d.every, 0),
    speed: num(p.speed, d.speed, 0),
    size: num(p.size, d.size, 0.1),
    hp: Math.min(BR_HP_CEILING, whole(p.hp, d.hp, 1)),
    duration: num(p.duration, d.duration, 0.1),
    settle: num(p.settle, d.settle, 0),
    rebuild: num(p.rebuild, d.rebuild, 0),
    order: isBrOrder(p.order) ? p.order : d.order,
    picture: isBrPicture(p.picture) ? p.picture : d.picture,
    text: cleanBrickText(p.text, d.text),
    drop: num(p.drop, d.drop, 0),
    bed: typeof p.bed === "boolean" ? p.bed : d.bed,
    capsules: typeof p.capsules === "boolean" ? p.capsules : d.capsules,
    capsuleChance: num(p.capsuleChance, d.capsuleChance, 0),
    split: whole(p.split, d.split, 1),
    symmetry: whole(p.symmetry, d.symmetry, 1),
    symmetryMode: isBrSymmetryMode(p.symmetryMode) ? p.symmetryMode : d.symmetryMode,
    hole: num(p.hole, d.hole, 0),
    outline: typeof p.outline === "boolean" ? p.outline : d.outline,
    bpm: num(p.bpm, d.bpm, 1e-3),
  };
}

/** The settings a change of which restarts a run (the rest – the picture, the text, the outline – only changes the drawing). */
export const BR_RENDER_ONLY_KEYS: readonly (keyof BrickRebuildSettings)[] = ["picture", "text", "outline", "order"];

/** Live Brick Smash state for the canvas, the HUD, the finder and the smoke test (the same object every call). */
export interface BrickRebuildView {
  settings: BrickRebuildSettings;
  /** Incremented by every init (the renderer redraws its brick layer). */
  generation: number;
  /** Incremented by every picture change (the renderer repaints its brick layer). */
  pictureVersion: number;
  field: BrickField;
  /** The cells that hold a brick (1), the hit points left of every cell (0: broken, or no brick). */
  mask: Uint8Array;
  hp: Int32Array;
  hpMax: number;
  /** The bricks' colours (a palette index a cell) and the palette; the rebuild's layer of every palette colour (0 flies first). */
  picture: BrickPicture;
  pictureSource: "emblem" | "mandala" | "text" | "upload";
  layerRank: Int32Array;
  /** Bricks of the whole picture, and standing now (the HUD's "N bricks"). */
  total: number;
  bricks: number;
  phase: BrPhase;
  /** ms into the cycle (its own clock) and into the phase; the rebuild's length (ms, whole steps). */
  cycleMs: number;
  phaseMs: number;
  rebuildMs: number;
  /** The rebuild's flight order (cells, `orderCount` of them), every landing's time (ms into the rebuild) and the flight (ms). */
  order: Int32Array;
  orderCount: number;
  landMs: Float64Array;
  flightMs: number;
  landed: number;
  /** Every cell's fly-in angle (0–1 of a turn) and bend. */
  originU: Float32Array;
  /** The recent breaks (ring): the cell and its cycle ms. */
  ghostCell: Int32Array;
  ghostMs: Float64Array;
  ghostHead: number;
  ghostCount: number;
  /** Balls in play (the real ones), the images each is drawn with, mirror walls or rotations, the balls' radius (world px). */
  balls: number;
  images: number;
  mirror: boolean;
  ballRadius: number;
  /** Render: the balls' alpha (they fade in the rebuild) and the start balls' (they fade in at its end), and where they start. */
  ballAlpha: number;
  startAlpha: number;
  startX: Float64Array;
  startY: Float64Array;
  /** Gold capsules: the paddle (centre x, top y, width, height), the capsules falling (x, y; `capCount` of them). */
  paddleOn: boolean;
  paddleX: number;
  paddleY: number;
  paddleW: number;
  paddleH: number;
  capX: Float64Array;
  capY: Float64Array;
  capCount: number;
  capsuleW: number;
  capsuleH: number;
  caught: number;
  splits: number;
  /** This cycle: bricks broken (with their images), breaks by the real balls, balls spawned, spawns refused at the ceiling. */
  broken: number;
  realBroken: number;
  spawned: number;
  refused: number;
  /** The cycle's 0 bricks (ms into it; −1 before, or a smash that ran out of time) and the balls then; the most balls of the cycle. */
  clearedMs: number;
  clearBalls: number;
  maxBalls: number;
  /** The first cycle's clear (s; −1 when it timed out or has not come), its balls then, how it ended ("" while it runs). */
  firstClearSec: number;
  firstBalls: number;
  firstEnd: "" | "cleared" | "timeout";
  /** Seams so far, the last one's simulation time (ms), the last whole cycle (s), the next seam once known (ms, −1 before). */
  seams: number;
  lastSeamMs: number;
  cycleSec: number;
  nextSeamMs: number;
  /** The groove: on (after the drop), its chord now. */
  bedOn: boolean;
  chord: number;
  /** Sound events queued so far (all kinds), plucks among them, kicks among them. */
  sounds: number;
  plucks: number;
  kicks: number;
  /** Balls with a non-finite position (0: the sweep never lost one) and the most bounces one sub-step needed. */
  nonFinite: number;
  /** Balls found outside the playfield at a step's end (0: nothing escaped the box or the circle). */
  escaped: number;
}

export class BrickRebuildMode implements GameMode {
  readonly name = "brickRebuild";
  /** The mode keeps the balls' speed itself (no slow-ball boost) and lets them fly through each other (no pair pass). */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: BrickRebuildSettings = { ...DEFAULT_BRICK_REBUILD };
  /** The page's uploaded picture (cover-fitted into the grid, quantised) – never in a link; null: none loaded. */
  private upload: BrickPicture | null = null;
  private readonly view: BrickRebuildView = {
    settings: { ...DEFAULT_BRICK_REBUILD },
    generation: 0,
    pictureVersion: 0,
    field: brickField(800, 450, DEFAULT_BRICK_REBUILD),
    mask: EMPTY_U8,
    hp: EMPTY_I32,
    hpMax: 1,
    picture: { cols: 0, rows: 0, palette: ["#1b2350"], colours: EMPTY_U8 },
    pictureSource: "emblem",
    layerRank: EMPTY_I32,
    total: 0,
    bricks: 0,
    phase: "smash",
    cycleMs: 0,
    phaseMs: 0,
    rebuildMs: 0,
    order: EMPTY_I32,
    orderCount: 0,
    landMs: EMPTY_F64,
    flightMs: 0,
    landed: 0,
    originU: new Float32Array(0),
    ghostCell: new Int32Array(BR_GHOST_CAP),
    ghostMs: new Float64Array(BR_GHOST_CAP),
    ghostHead: 0,
    ghostCount: 0,
    balls: 0,
    images: 1,
    mirror: true,
    ballRadius: 1,
    ballAlpha: 1,
    startAlpha: 0,
    startX: EMPTY_F64,
    startY: EMPTY_F64,
    paddleOn: false,
    paddleX: 0,
    paddleY: 0,
    paddleW: 0,
    paddleH: 0,
    capX: new Float64Array(BR_CAPSULE_MAX),
    capY: new Float64Array(BR_CAPSULE_MAX),
    capCount: 0,
    capsuleW: 0,
    capsuleH: 0,
    caught: 0,
    splits: 0,
    broken: 0,
    realBroken: 0,
    spawned: 0,
    refused: 0,
    clearedMs: -1,
    clearBalls: 0,
    maxBalls: 0,
    firstClearSec: -1,
    firstBalls: 0,
    firstEnd: "",
    seams: 0,
    lastSeamMs: -1,
    cycleSec: 0,
    nextSeamMs: -1,
    bedOn: false,
    chord: 0,
    sounds: 0,
    plucks: 0,
    kicks: 0,
    nonFinite: 0,
    escaped: 0,
  };
  // the world the field was laid out for
  private canvasW = 0;
  private canvasH = 0;
  /** World px per reference px, the balls' speed (world px/s) and radius. */
  private vT = 100;
  private rho = 5;
  private lastConfigRadius = 8;
  /** The cycle's random stream and its seed; the groove's progression; every cell's shuffle rank. */
  private cycleSeed = 1;
  private readonly rng = { s: 1 };
  private progression: { root: number; minor: boolean }[] = [];
  private shuffleRank = EMPTY_I32;
  /** The start balls' launch velocities (world px/s). */
  private startVx = EMPTY_F64;
  private startVy = EMPTY_F64;
  // the clock: the cycle's own (summed step by step from 0 in every cycle, so every cycle replays the first bit for bit)
  private cycleClockMs = 0;
  private prevCycleMs = 0;
  private stepMs = 1000 / 60;
  private cycleStartAbs = 0;
  /** The cycle's steps so far, and its whole length in steps once the smash ended (the cycle's length is exact: steps × the step). */
  private cycleSteps = 0;
  private cycleLenSteps = 0;
  private phaseSteps = 0;
  private settleSteps = 0;
  private rebuildSteps = 0;
  private smashEndCycleMs = -1;
  private dropBeat = 0;
  private beatMs = 500;
  private bedPlaying = false;
  private glided = false;
  private dinged = false;
  // the per-step sound and bounce budget
  private readonly pluckCount = new Int32Array(BR_PLUCK_SPAN + 1);
  private bounceTriggers = 0;
  /** The current ball (its brick and wall callbacks note bounces for it) and the sweep's body. */
  private cur: Ball | null = null;
  private readonly body: SweepBody = { x: 0, y: 0, vx: 0, vy: 0, r: 1 };
  private readonly image = { x: 0, y: 0 };
  private readonly fold = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Damage stamps: a brick hit once per contact, its images once each (a cell on a symmetry axis is its own image). */
  private stamp = EMPTY_I32;
  private stampNow = 0;
  // the spawn queue (spawns wait for the sub-step's end: the engine is walking its ball list)
  private spawnX = new Float64Array(64);
  private spawnY = new Float64Array(64);
  private spawnA = new Float64Array(64);
  private spawnCount = 0;
  private solidNow = true;
  private damageNow = true;

  private readonly onBrick = (cell: number) => this.hitBrick(cell);
  private readonly onWall = (nx: number, ny: number) => this.hitWall(nx, ny);

  getSettings(): BrickRebuildSettings {
    return this.settings;
  }
  /** Applied on the next init (the page restarts the run when a physics setting changes); the picture, the text, the order and the outline follow live. */
  setSettings(patch: Partial<BrickRebuildSettings>) {
    const next = resolveBrickRebuildSettings({ ...this.settings, ...patch });
    const repaint = next.picture !== this.settings.picture || next.text !== this.settings.text;
    this.settings = next;
    this.view.settings.outline = next.outline;
    this.view.settings.order = next.order;
    if (repaint && this.view.mask.length > 0) {
      this.view.settings.picture = next.picture;
      this.view.settings.text = next.text;
      this.paint();
    }
  }
  /** The page's uploaded picture (null: none). Used when the picture setting is "upload" and its grid matches the run's. */
  setUploadPicture(picture: BrickPicture | null) {
    this.upload = picture;
    if (this.view.mask.length > 0 && this.settings.picture === "upload") this.paint();
  }
  getUploadPicture(): BrickPicture | null {
    return this.upload;
  }
  getView(): BrickRebuildView {
    return this.view;
  }

  /* -------------------------------------------------------------- the picture */

  /** The bricks' colours from the picture setting: the upload (when its grid matches), the typed text, the emblem or the mandala. */
  private paint() {
    const v = this.view;
    const f = v.field;
    const s = v.settings;
    let pic: BrickPicture;
    let source: BrickRebuildView["pictureSource"];
    if (s.picture === "upload" && this.upload && this.upload.cols === f.cols && this.upload.rows === f.rows) {
      pic = this.upload;
      source = "upload";
    } else if (s.picture === "text" && cleanBrickText(s.text).trim()) {
      pic = textPicture(s.text, f.cols, f.rows);
      source = "text";
    } else if (f.layout === "mandala") {
      pic = mandalaPicture(f.cols, v.images, v.mirror, s.hole / 100);
      source = "mandala";
    } else {
      pic = emblemPicture(f.cols, f.rows, f.cw / f.ch);
      source = "emblem";
    }
    v.picture = pic;
    v.pictureSource = source;
    v.layerRank = layerRanks(pic.colours, pic.palette.length, v.mask);
    v.pictureVersion++;
  }

  /* -------------------------------------------------------------- layout */

  private layout(ctx: ModeContext) {
    const v = this.view;
    const s = v.settings;
    this.canvasW = ctx.config.width;
    this.canvasH = ctx.config.height;
    v.field = brickField(this.canvasW, this.canvasH, s);
    const f = v.field;
    this.vT = Math.max(0, s.speed * f.scale);
    this.rho = Math.max(0.25, s.size * f.scale);
    v.ballRadius = this.rho;
    v.paddleOn = s.capsules && f.layout === "box";
    v.paddleW = BR_PADDLE_SHARE * (f.x1 - f.x0);
    v.paddleH = Math.max(1, BR_PADDLE_H * f.scale);
    v.paddleY = f.y1 - BR_PADDLE_LIFT * f.scale - v.paddleH;
    v.capsuleW = Math.max(2, 0.6 * f.cw);
    v.capsuleH = Math.max(1.5, 0.35 * f.cw);
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const v = this.view;
    const s = this.settings;
    v.settings = { ...s };
    v.generation++;
    v.images = symmetryImages(s.symmetry, s.symmetryMode);
    v.mirror = s.symmetryMode !== "rotate";
    this.layout(ctx);
    const f = v.field;
    const n = f.cols * f.rows;
    v.mask = brickMask(f);
    v.hpMax = Math.max(1, Math.min(BR_HP_CEILING, Math.round(s.hp)));
    v.hp = new Int32Array(n);
    let total = 0;
    for (let c = 0; c < n; c++) if (v.mask[c]) total++;
    v.total = total;
    this.stamp = new Int32Array(n);
    this.stampNow = 0;
    this.paint();
    // (1) the cycle's own seed, (2) the groove's progression
    this.cycleSeed = Math.floor(ctx.random() * 0x100000000) | 0;
    this.progression = grooveProgression(() => ctx.random(), BR_BED_ROOT_MIDI);
    // (3) every cell's fly-in angle, (4) the shuffle of the "random" order
    v.originU = new Float32Array(n);
    for (let c = 0; c < n; c++) v.originU[c] = ctx.random();
    const perm = new Int32Array(n);
    for (let c = 0; c < n; c++) perm[c] = c;
    for (let c = n - 1; c > 0; c--) {
      const j = Math.floor(ctx.random() * (c + 1));
      const t = perm[c];
      perm[c] = perm[j];
      perm[j] = t;
    }
    this.shuffleRank = new Int32Array(n);
    for (let k = 0; k < n; k++) this.shuffleRank[perm[k]] = k;
    // (5) the start balls: near the bottom centre, launched within BR_LAUNCH_SPREAD of straight up (the kaleidoscope: in the wedge)
    const count = Math.max(1, Math.min(BR_BALL_CEILING, Math.round(s.balls)));
    v.startX = new Float64Array(count);
    v.startY = new Float64Array(count);
    this.startVx = new Float64Array(count);
    this.startVy = new Float64Array(count);
    if (f.layout === "mandala") {
      const a = wedgeAngle(v.images);
      const r0 = Math.max(this.rho, Math.min(f.holeRadius - this.rho, 0.5 * f.radius));
      for (let i = 0; i < count; i++) {
        const angle = a * (0.2 + 0.6 * ctx.random());
        const rr = r0 * (0.35 + 0.6 * ctx.random());
        const dir = ctx.random() * TWO_PI;
        v.startX[i] = f.cx + rr * Math.cos(angle);
        v.startY[i] = f.cy + rr * Math.sin(angle);
        this.startVx[i] = this.vT * Math.cos(dir);
        this.startVy[i] = this.vT * Math.sin(dir);
      }
    } else {
      const boxW = f.x1 - f.x0;
      const spread = Math.min(0.6 * boxW, count * 3 * this.rho);
      const y = Math.max(f.y0 + this.rho, f.y1 - 3 * this.rho);
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (2 * ctx.random() - 1) * BR_LAUNCH_SPREAD;
        v.startX[i] = f.cx + (count > 1 ? ((i + 0.5) / count - 0.5) * spread : 0);
        v.startY[i] = y;
        this.startVx[i] = this.vT * Math.cos(angle);
        this.startVy[i] = this.vT * Math.sin(angle);
      }
    }
    this.lastConfigRadius = ctx.config.ballRadius || 8;
    // the run's counters
    v.firstClearSec = -1;
    v.firstBalls = 0;
    v.firstEnd = "";
    v.seams = 0;
    v.lastSeamMs = -1;
    v.cycleSec = 0;
    v.sounds = 0;
    v.plucks = 0;
    v.kicks = 0;
    v.caught = 0;
    v.splits = 0;
    v.nonFinite = 0;
    v.escaped = 0;
    this.cycleStartAbs = 0;
    this.cycleLenSteps = 0;
    this.startCycle(ctx);
  }

  /** The cycle's start: every brick standing, the start balls at their places and launch velocities, the clocks at 0. */
  private startCycle(ctx: ModeContext) {
    const v = this.view;
    const s = v.settings;
    v.hp.fill(0);
    for (let c = 0; c < v.hp.length; c++) if (v.mask[c]) v.hp[c] = v.hpMax;
    v.bricks = v.total;
    v.phase = "smash";
    v.cycleMs = 0;
    v.phaseMs = 0;
    v.rebuildMs = 0;
    v.orderCount = 0;
    v.landed = 0;
    v.ghostHead = 0;
    v.ghostCount = 0;
    v.capCount = 0;
    v.broken = 0;
    v.realBroken = 0;
    v.spawned = 0;
    v.refused = 0;
    v.clearedMs = -1;
    v.clearBalls = 0;
    v.ballAlpha = 1;
    v.startAlpha = 0;
    v.nextSeamMs = -1;
    v.bedOn = false;
    v.chord = 0;
    v.paddleX = v.field.cx;
    this.rng.s = this.cycleSeed;
    this.cycleClockMs = 0;
    this.prevCycleMs = 0;
    this.cycleSteps = 0;
    this.phaseSteps = 0;
    this.smashEndCycleMs = -1;
    this.spawnCount = 0;
    this.pluckCount.fill(0);
    this.bedPlaying = false;
    this.glided = false;
    this.dinged = false;
    this.beatMs = 60000 / (s.bpm > 0 ? s.bpm : 120);
    this.dropBeat = brickDropBeat(s.drop, s.bpm);
    // the start balls (fresh engine balls, in the same order every cycle)
    ctx.setBalls([]);
    const color = ctx.config.ballColor || "#FFFFFF";
    const configRadius = ctx.config.ballRadius || 8;
    for (let i = 0; i < v.startX.length; i++) {
      ctx.addBall({ x: v.startX[i], y: v.startY[i], vx: this.startVx[i], vy: this.startVy[i], radius: this.rho, color, gravityScale: 0, radiusScale: this.rho / configRadius });
    }
    v.balls = v.startX.length;
    v.maxBalls = v.balls;
  }

  /* -------------------------------------------------------------- the clock and the phases */

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.stepMs = dtMs > 0 ? dtMs : 1000 / 60;
    this.bounceTriggers = 0;
    const v = this.view;
    // a live change of the page's Ball Size never resizes the mode's balls (their size is the mode's own)
    const configRadius = ctx.config.ballRadius || 8;
    if (configRadius !== this.lastConfigRadius) {
      this.lastConfigRadius = configRadius;
      for (const ball of ctx.getBalls()) {
        ball.radius = this.rho;
        ball.radiusScale = this.rho / configRadius;
      }
    }
    // the phase changes due at this step's start (a settle or a rebuild of 0 steps passes at once)
    for (let guard = 0; guard < 3; guard++) {
      if (v.phase === "settle" && this.phaseSteps >= this.settleSteps) {
        this.beginRebuild(ctx);
        continue;
      }
      if (v.phase === "rebuild" && this.phaseSteps >= this.rebuildSteps) {
        this.seam(ctx, ctx.getElapsedMs() - dtMs);
        continue;
      }
      break;
    }
    this.prevCycleMs = this.cycleClockMs;
    this.cycleClockMs += dtMs;
    this.cycleSteps++;
    v.cycleMs = this.cycleClockMs;
    const smash = v.phase === "smash";
    this.solidNow = true;
    this.damageNow = smash;
  }

  /** The engine moved `ball`: the move is taken back and swept through the playfield (bricks, walls, the paddle). */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const v = this.view;
    const f = v.field;
    // the engine's move (x += v·dt) undone: the sweep moves the ball itself
    ball.x -= ball.vx * dtSec;
    ball.y -= ball.vy * dtSec;
    const b = this.body;
    b.x = ball.x;
    b.y = ball.y;
    b.vx = ball.vx;
    b.vy = ball.vy;
    b.r = ball.radius;
    let restitution = 1;
    if (v.phase === "smash") {
      // the smash keeps every ball at its speed (wind, drag or a rule never slow it down)
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0 && Number.isFinite(sp)) {
        const k = this.vT / sp;
        b.vx *= k;
        b.vy *= k;
      } else {
        b.vx = 0;
        b.vy = -this.vT;
      }
    } else {
      // the settle and the rebuild: gravity (down in the box, out toward the rim in the kaleidoscope), a soft floor
      const g = BR_SETTLE_GRAVITY * f.scale * dtSec;
      if (f.layout === "mandala") {
        const dx = b.x - f.cx;
        const dy = b.y - f.cy;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          b.vx += (g * dx) / d;
          b.vy += (g * dy) / d;
        }
      } else b.vy += g;
      restitution = BR_SETTLE_RESTITUTION;
    }
    const y0 = b.y;
    this.cur = ball;
    sweepBody(f, this.solidNow ? v.hp : null, b, dtSec, this.onBrick, this.onWall, restitution);
    this.cur = null;
    // the kaleidoscope: the real ball folded back into its wedge (mirror walls, or a turn round)
    if (v.images > 1) {
      const fd = this.fold;
      fd.x = b.x - f.cx;
      fd.y = b.y - f.cy;
      fd.vx = b.vx;
      fd.vy = b.vy;
      if (foldIntoWedge(fd, v.images, v.mirror ? "mirror" : "rotate")) {
        b.x = f.cx + fd.x;
        b.y = f.cy + fd.y;
        b.vx = fd.vx;
        b.vy = fd.vy;
        clampInside(f, b);
      }
    }
    // the gold capsules' paddle: a ball coming down onto its top bounces off it, aimed by where it hits (the smash only)
    if (v.paddleOn && v.phase === "smash" && b.vy > 0) {
      const top = v.paddleY;
      const half = v.paddleW / 2;
      if (y0 + b.r <= top + 1e-9 && b.y + b.r > top && Math.abs(b.x - v.paddleX) <= half + b.r) {
        const u = Math.max(-1, Math.min(1, (b.x - v.paddleX) / Math.max(1e-9, half)));
        const angle = -Math.PI / 2 + (u * Math.PI) / 3;
        const sp = Math.hypot(b.vx, b.vy);
        b.y = top - b.r;
        b.vx = sp * Math.cos(angle);
        b.vy = sp * Math.sin(angle);
        if (this.bounceTriggers < BR_BOUNCE_TRIGGERS_PER_STEP) this.pendingBounce(ball);
      }
    }
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      // never lose a ball: back at the field's centre, launched up
      b.x = f.cx;
      b.y = f.layout === "box" ? f.y1 - 2 * b.r : f.cy;
      b.vx = 0;
      b.vy = -this.vT;
      v.nonFinite++;
    }
    ball.x = b.x;
    ball.y = b.y;
    ball.vx = b.vx;
    ball.vy = b.vy;
  }

  /** A brick face met by the current ball: a hit (the smash breaks it), its images too in the kaleidoscope. */
  private hitBrick(cell: number) {
    const ball = this.cur;
    if (ball && this.bounceTriggers < BR_BOUNCE_TRIGGERS_PER_STEP && this.damageNow) this.pendingBounce(ball);
    if (!this.damageNow) return;
    const v = this.view;
    this.stampNow++;
    this.damage(cell, true);
    if (v.images > 1) {
      const f = v.field;
      const cx = f.gx + ((cell % f.cols) + 0.5) * f.cw - f.cx;
      const cy = f.gy + (Math.floor(cell / f.cols) + 0.5) * f.ch - f.cy;
      for (let i = 1; i < v.images; i++) {
        applyImage(cx, cy, i, v.images, v.mirror ? "mirror" : "rotate", this.image);
        const other = cellAt(f, f.cx + this.image.x, f.cy + this.image.y);
        if (other >= 0 && other !== cell) this.damage(other, false);
      }
    }
  }

  /** One hit point off `cell` (once per contact: the stamp); at 0 it breaks – the ghost, the pluck, the spawn, the capsule. */
  private damage(cell: number, real: boolean) {
    const v = this.view;
    if (!v.mask[cell] || v.hp[cell] === 0 || this.stamp[cell] === this.stampNow) return;
    this.stamp[cell] = this.stampNow;
    v.hp[cell]--;
    if (v.hp[cell] > 0) return;
    v.bricks--;
    v.broken++;
    const g = v.ghostHead;
    v.ghostCell[g] = cell;
    v.ghostMs[g] = this.cycleClockMs;
    v.ghostHead = (g + 1) % BR_GHOST_CAP;
    if (v.ghostCount < BR_GHOST_CAP) v.ghostCount++;
    const f = v.field;
    const row = Math.floor(cell / f.cols);
    this.pluckCount[brickDegree(row, f.rows)]++;
    if (!real) return;
    v.realBroken++;
    const x = f.gx + ((cell % f.cols) + 0.5) * f.cw;
    const y = f.gy + (row + 0.5) * f.ch;
    if (spawnDue(v.realBroken, v.settings.every)) this.queueSpawn(x, y, nextMulberry(this.rng) * TWO_PI);
    if (v.paddleOn && nextMulberry(this.rng) < v.settings.capsuleChance) this.dropCapsule(x, y);
  }

  private queueSpawn(x: number, y: number, angle: number) {
    if (this.spawnCount >= this.spawnX.length) {
      const grow = (a: Float64Array) => {
        const out = new Float64Array(a.length * 2);
        out.set(a);
        return out;
      };
      this.spawnX = grow(this.spawnX);
      this.spawnY = grow(this.spawnY);
      this.spawnA = grow(this.spawnA);
    }
    this.spawnX[this.spawnCount] = x;
    this.spawnY[this.spawnCount] = y;
    this.spawnA[this.spawnCount] = angle;
    this.spawnCount++;
  }

  private dropCapsule(x: number, y: number) {
    const v = this.view;
    if (v.capCount >= BR_CAPSULE_MAX) {
      // the oldest capsule gives way
      v.capX.copyWithin(0, 1, v.capCount);
      v.capY.copyWithin(0, 1, v.capCount);
      v.capCount--;
    }
    v.capX[v.capCount] = x;
    v.capY[v.capCount] = y;
    v.capCount++;
  }

  /** A wall bounce of the current ball (the floor's friction in the settle). */
  private hitWall(_nx: number, ny: number) {
    const ball = this.cur;
    if (!this.damageNow) {
      if (ny > 0.5) this.body.vx *= BR_SETTLE_FRICTION;
      return;
    }
    if (ball && this.bounceTriggers < BR_BOUNCE_TRIGGERS_PER_STEP) this.pendingBounce(ball);
  }

  /** Bounce math's trigger of a smash bounce (at most BR_BOUNCE_TRIGGERS_PER_STEP a step; reported at the sub-step's end). */
  private readonly bounceQueue: Ball[] = [];
  private pendingBounce(ball: Ball) {
    this.bounceTriggers++;
    this.bounceQueue.push(ball);
  }

  /** The sub-step's end: the bounce triggers and the queued spawns (in their order; past the ball ceiling a spawn is refused). */
  onPostSubStep(ctx: ModeContext) {
    if (this.bounceQueue.length > 0) {
      if (ctx.noteBounce) for (const ball of this.bounceQueue) ctx.noteBounce(ball);
      this.bounceQueue.length = 0;
    }
    if (this.spawnCount === 0) return;
    const v = this.view;
    const f = v.field;
    let balls = ctx.getBalls().length;
    const color = ctx.config.ballColor || "#FFFFFF";
    const configRadius = ctx.config.ballRadius || 8;
    for (let i = 0; i < this.spawnCount; i++) {
      if (balls >= BR_BALL_CEILING) {
        v.refused++;
        continue;
      }
      let x = this.spawnX[i];
      let y = this.spawnY[i];
      let vx = this.vT * Math.cos(this.spawnA[i]);
      let vy = this.vT * Math.sin(this.spawnA[i]);
      if (v.images > 1) {
        const fd = this.fold;
        fd.x = x - f.cx;
        fd.y = y - f.cy;
        fd.vx = vx;
        fd.vy = vy;
        foldIntoWedge(fd, v.images, v.mirror ? "mirror" : "rotate");
        x = f.cx + fd.x;
        y = f.cy + fd.y;
        vx = fd.vx;
        vy = fd.vy;
      }
      ctx.addBall({ x, y, vx, vy, radius: this.rho, color, gravityScale: 0, radiusScale: this.rho / configRadius });
      balls++;
      v.spawned++;
    }
    this.spawnCount = 0;
    v.balls = balls;
    if (balls > v.maxBalls) v.maxBalls = balls;
  }

  /** The step's end: the capsules and the paddle, the smash's end, the rebuild's landings, the fades and the step's sounds. */
  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const balls = ctx.getBalls();
    v.balls = balls.length;
    if (v.balls > v.maxBalls) v.maxBalls = v.balls;
    const stepSec = this.stepMs / 1000;
    if (v.paddleOn) this.stepCapsules(ctx, balls, stepSec);
    // nothing escapes the playfield (counted for the tests and the smoke test: always 0)
    const f = v.field;
    let escaped = 0;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (f.layout === "mandala") {
        if (Math.hypot(b.x - f.cx, b.y - f.cy) > f.radius + 0.5) escaped++;
      } else if (b.x < f.x0 - 0.5 || b.x > f.x1 + 0.5 || b.y < f.y0 - 0.5 || b.y > f.y1 + 0.5) escaped++;
    }
    if (escaped > v.escaped) v.escaped = escaped;
    if (v.phase === "smash") {
      this.flushPlucks(ctx);
      this.groove(ctx);
      const cleared = v.bricks <= 0;
      if (cleared || this.cycleClockMs >= 1000 * v.settings.duration - 1e-6) this.endSmash(ctx, cleared);
    } else {
      this.phaseSteps++;
      v.phaseMs = this.phaseSteps * this.stepMs;
      if (v.phase === "rebuild") this.stepRebuild(ctx);
    }
  }

  /** The capsules fall; the paddle runs for the lowest one (else the lowest ball coming down); a catch splits every ball. */
  private stepCapsules(ctx: ModeContext, balls: Ball[], stepSec: number) {
    const v = this.view;
    const f = v.field;
    const fall = BR_CAPSULE_SPEED * f.scale * stepSec;
    let target = f.cx;
    let lowest = -Infinity;
    let caught = 0;
    let keep = 0;
    for (let i = 0; i < v.capCount; i++) {
      const y = v.capY[i] + fall;
      const x = v.capX[i];
      if (y + v.capsuleH / 2 >= v.paddleY && y - v.capsuleH / 2 <= v.paddleY + v.paddleH && Math.abs(x - v.paddleX) <= (v.paddleW + v.capsuleW) / 2) {
        caught++;
        continue;
      }
      if (y - v.capsuleH / 2 > f.y1) continue;
      v.capX[keep] = x;
      v.capY[keep] = y;
      keep++;
      if (y < v.paddleY && y > lowest) {
        lowest = y;
        target = x;
      }
    }
    v.capCount = keep;
    if (lowest === -Infinity && v.phase === "smash") {
      let low = -Infinity;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (b.vy > 0 && b.y < v.paddleY && b.y > low) {
          low = b.y;
          target = b.x;
        }
      }
    }
    const reach = BR_PADDLE_SPEED * f.scale * stepSec;
    const half = v.paddleW / 2;
    const want = Math.max(f.x0 + half, Math.min(f.x1 - half, target));
    const dx = want - v.paddleX;
    v.paddleX += Math.abs(dx) <= reach ? dx : Math.sign(dx) * reach;
    if (caught > 0 && v.phase === "smash") {
      v.caught += caught;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "chime", frequency: BR_CHIME_HZ, level: 0.7, melody: false });
      for (let k = 0; k < caught; k++) this.splitAll(ctx);
    }
  }

  /** Every ball in play splits into `split`: the copies fan out from its heading (the board's ball ceiling holds). */
  private splitAll(ctx: ModeContext) {
    const v = this.view;
    const balls = ctx.getBalls();
    const n = balls.length;
    const copies = Math.max(0, Math.round(v.settings.split) - 1);
    if (copies === 0 || n === 0) return;
    const color = ctx.config.ballColor || "#FFFFFF";
    const configRadius = ctx.config.ballRadius || 8;
    let count = n;
    for (let i = 0; i < n && count < BR_BALL_CEILING; i++) {
      const b = balls[i];
      const heading = Math.atan2(b.vy, b.vx);
      const sp = Math.hypot(b.vx, b.vy) || this.vT;
      for (let k = 1; k <= copies && count < BR_BALL_CEILING; k++) {
        const rank = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1);
        const a = heading + rank * BR_SPLIT_FAN;
        ctx.addBall({ x: b.x, y: b.y, vx: sp * Math.cos(a), vy: sp * Math.sin(a), radius: this.rho, color, gravityScale: 0, radiusScale: this.rho / configRadius });
        count++;
      }
    }
    v.splits++;
    v.balls = count;
    if (count > v.maxBalls) v.maxBalls = count;
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "riser", frequency: BR_RISER_HZ, loopSec: 0.35, level: 0.8, melody: false });
  }

  /** The smash is over (0 bricks, or its time ran out): the settle starts with the next step, the groove's kicks stop. */
  private endSmash(ctx: ModeContext, cleared: boolean) {
    const v = this.view;
    v.phase = "settle";
    this.phaseSteps = 0;
    v.phaseMs = 0;
    this.smashEndCycleMs = this.cycleClockMs;
    v.clearedMs = cleared ? this.cycleClockMs : -1;
    v.clearBalls = v.balls;
    v.capCount = 0;
    const s = v.settings;
    this.settleSteps = Math.max(0, Math.ceil((1000 * s.settle) / this.stepMs - 1e-9));
    this.rebuildSteps = Math.max(0, Math.ceil((1000 * s.rebuild) / this.stepMs - 1e-9));
    v.rebuildMs = this.rebuildSteps * this.stepMs;
    v.nextSeamMs = this.cycleStartAbs + this.cycleClockMs + (this.settleSteps + this.rebuildSteps) * this.stepMs;
    this.cycleLenSteps = this.cycleSteps + this.settleSteps + this.rebuildSteps;
    if (v.seams === 0 && v.firstEnd === "") {
      v.firstEnd = cleared ? "cleared" : "timeout";
      v.firstClearSec = cleared ? this.cycleClockMs / 1000 : -1;
      v.firstBalls = v.balls;
    }
    // the payoff: the last brick's impact (on a bar line when the finder found it so)
    if (cleared) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", frequency: midiToFrequency(this.chordRoot(0)), level: BR_IMPACT_LEVEL, melody: false });
  }

  /** The rebuild starts: the broken bricks' flight order and timetable, the wash (and the pad, when the groove never dropped). */
  private beginRebuild(ctx: ModeContext) {
    const v = this.view;
    const f = v.field;
    v.phase = "rebuild";
    this.phaseSteps = 0;
    v.phaseMs = 0;
    const n = v.hp.length;
    let count = 0;
    for (let c = 0; c < n; c++) if (v.mask[c] && v.hp[c] === 0) count++;
    const cells = new Int32Array(count);
    count = 0;
    for (let c = 0; c < n; c++) if (v.mask[c] && v.hp[c] === 0) cells[count++] = c;
    v.order = rebuildOrder(cells, f, v.settings.order, v.picture.colours, v.layerRank, this.shuffleRank);
    v.orderCount = count;
    const sec = v.rebuildMs / 1000;
    v.landMs = new Float64Array(count);
    for (let k = 0; k < count; k++) v.landMs[k] = rebuildLandMs(k, count, sec);
    v.flightMs = rebuildFlightMs(sec);
    v.landed = 0;
    if (v.rebuildMs > 0) {
      if (v.settings.bed && !this.bedPlaying) this.sendBed(ctx, 0);
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "wash", loopSec: sec, level: BR_WASH_LEVEL, melody: false });
    }
    if (this.rebuildSteps === 0) this.landAll(ctx);
  }

  /** The rebuild's step: the bricks due land (each adds one to the counter), the fades, the reset glide toward the seam. */
  private stepRebuild(ctx: ModeContext) {
    const v = this.view;
    const t = v.phaseMs;
    while (v.landed < v.orderCount && v.landMs[v.landed] <= t + 1e-6) {
      const cell = v.order[v.landed];
      v.hp[cell] = v.hpMax;
      v.bricks++;
      v.landed++;
    }
    if (this.phaseSteps >= this.rebuildSteps) this.landAll(ctx);
    const total = v.rebuildMs;
    v.ballAlpha = total > 0 ? 1 - smoothStep(t / (BR_FADE_SHARE * total)) : 0;
    const fadeIn = Math.min(1000 * BR_START_FADE_SEC, total);
    v.startAlpha = total > 0 ? smoothStep((t - (total - fadeIn)) / Math.max(1e-9, fadeIn)) : 1;
    const glideMs = Math.min(1000 * BR_GLIDE_SEC, total);
    if (!this.glided && total > 0 && t >= total - glideMs - 1e-6) {
      this.glided = true;
      const left = Math.max(this.stepMs, total - t) / 1000;
      const first = brickPluckFrequency(BR_PLUCK_SPAN);
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "glide", frequency: midiToFrequency(this.chordRoot(0)) / 2, loopTo: first / 2, loopSec: left, level: BR_GLIDE_LEVEL, melody: false });
    }
  }

  /** Every brick back (the rebuild's end): the last one's ding. */
  private landAll(ctx: ModeContext) {
    const v = this.view;
    while (v.landed < v.orderCount) {
      v.hp[v.order[v.landed]] = v.hpMax;
      v.landed++;
    }
    let bricks = 0;
    for (let c = 0; c < v.hp.length; c++) if (v.hp[c] > 0) bricks++;
    v.bricks = bricks;
    v.ballAlpha = 0;
    v.startAlpha = 1;
    if (!this.dinged && v.orderCount > 0) {
      this.dinged = true;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "ding", level: BR_DING_LEVEL, melody: false });
    }
  }

  /** The seam (at `atMs`, a step's start): the run's start again – the bricks, the start balls, the clocks – and the loop voices cut. */
  private seam(ctx: ModeContext, atMs: number) {
    const v = this.view;
    v.cycleSec = (this.cycleLenSteps * this.stepMs) / 1000;
    v.lastSeamMs = atMs;
    v.seams++;
    this.cycleStartAbs = atMs;
    if (this.bedPlaying) this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "cut", melody: false });
    this.startCycle(ctx);
  }

  /* -------------------------------------------------------------- the sound */

  private emit(ctx: ModeContext, ev: SoundEvent) {
    this.view.sounds++;
    ctx.addPendingSoundEvent(ev);
  }

  /** The chord root (MIDI) of the progression's chord `k`. */
  private chordRoot(k: number): number {
    const c = this.progression[k % Math.max(1, this.progression.length)];
    return c ? c.root : BR_BED_ROOT_MIDI;
  }

  private sendBed(ctx: ModeContext, chord: number) {
    const c = this.progression[chord % Math.max(1, this.progression.length)] ?? { root: BR_BED_ROOT_MIDI, minor: false };
    this.view.chord = chord;
    this.emit(ctx, { type: "hit", wallIndex: 0, loop: "bed", frequency: midiToFrequency(c.root), loopMinor: c.minor, melody: false });
    this.bedPlaying = true;
    this.view.bedOn = true;
  }

  /**
   * The groove of the smash on the cycle's beats: at the drop (the first bar line at or after `drop` s) the impact and the bed's
   * first chord, then a kick every beat and a new chord every bar – until 0 bricks.
   */
  private groove(ctx: ModeContext) {
    const v = this.view;
    if (!v.settings.bed) return;
    const beat = this.beatMs;
    const b0 = Math.floor((this.prevCycleMs + 1e-6) / beat);
    const b1 = Math.floor((this.cycleClockMs + 1e-6) / beat);
    // (the cycle's first step holds its beat 0: a drop at 0 s comes with the first frame)
    for (let j = this.prevCycleMs <= 0 ? 0 : b0 + 1; j <= b1; j++) {
      if (j < this.dropBeat) continue;
      const since = j - this.dropBeat;
      if (since === 0) {
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "impact", frequency: midiToFrequency(this.chordRoot(0)), level: BR_IMPACT_LEVEL, melody: false });
        this.sendBed(ctx, 0);
        continue;
      }
      if (since % 4 === 0) this.sendBed(ctx, since / 4);
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "kick", level: BR_KICK_LEVEL, melody: false });
      v.kicks++;
    }
  }

  /** The step's breaks as plucks: one note per row degree (√n for n breaks), the busiest BR_NOTES_PER_TICK degrees. */
  private flushPlucks(ctx: ModeContext) {
    const counts = this.pluckCount;
    let emitted = 0;
    while (emitted < BR_NOTES_PER_TICK) {
      let best = -1;
      for (let d = counts.length - 1; d >= 0; d--) if (counts[d] > 0 && (best < 0 || counts[d] > counts[best])) best = d;
      if (best < 0) break;
      const n = counts[best];
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "pluck", frequency: brickPluckFrequency(best), level: Math.min(2, Math.sqrt(n)), loopBright: this.view.ballRadius < 0.6 * this.view.field.cw, melody: false });
      this.view.plucks++;
      counts[best] = 0;
      emitted++;
    }
    counts.fill(0);
  }

  /* -------------------------------------------------------------- the rest of the GameMode contract */

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A new world size lays the playfield out again and maps every ball (and the start places) into it. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || this.view.mask.length === 0) return true;
    const v = this.view;
    const old = v.field;
    const oldW = this.canvasW;
    const oldH = this.canvasH;
    const oldVT = this.vT;
    const sx = oldW > 0 ? ctx.config.width / oldW : 1;
    const sy = oldH > 0 ? ctx.config.height / oldH : 1;
    this.layout(ctx);
    const f = v.field;
    if (f.cols * f.rows !== old.cols * old.rows) return true;
    const k = old.scale > 0 ? f.scale / old.scale : 1;
    const map = (x: number, y: number, out: { x: number; y: number }) => {
      out.x = f.cx + (x - old.cx) * k;
      out.y = f.cy + (y - old.cy) * k;
    };
    const p = this.image;
    for (const ball of ctx.getBalls()) {
      // the engine stretched the balls per axis about the centre: undo it and scale them with the field instead
      const ux = old.cx + (ball.x - ctx.config.width / 2) / (sx || 1);
      const uy = old.cy + (ball.y - ctx.config.height / 2) / (sy || 1);
      map(ux, uy, p);
      ball.x = p.x;
      ball.y = p.y;
      ball.vx *= k;
      ball.vy *= k;
      ball.radius = this.rho;
    }
    for (let i = 0; i < v.startX.length; i++) {
      map(v.startX[i], v.startY[i], p);
      v.startX[i] = p.x;
      v.startY[i] = p.y;
    }
    const kv = oldVT > 0 ? this.vT / oldVT : k;
    for (let i = 0; i < this.startVx.length; i++) {
      this.startVx[i] *= kv;
      this.startVy[i] *= kv;
    }
    for (let i = 0; i < v.capCount; i++) {
      map(v.capX[i], v.capY[i], p);
      v.capX[i] = p.x;
      v.capY[i] = p.y;
    }
    v.paddleX = f.cx + (v.paddleX - old.cx) * k;
    return true;
  }
  /** The playfield is the mode's own (no engine rings). */
  shouldSkipWallCollision() {
    return true;
  }
  /** The sweep is exact at any speed: the engine's plain sub-steps do. */
  stepSpeedBound(): number {
    return 0;
  }
  /** A Brick Smash run loops forever (the finder searches its first smash's outcomes instead of a length). */
  isFinished() {
    return false;
  }
  /** The loop contract: the cycle's length (s) once it is known (the smash ended: the settle and the rebuild are whole steps). */
  cycleSeconds(): number | null {
    const v = this.view;
    if (v.seams > 0 && v.cycleSec > 0) return v.cycleSec;
    return v.nextSeamMs >= 0 ? (this.cycleLenSteps * this.stepMs) / 1000 : null;
  }
  loopSeams(): LoopSeams {
    const v = this.view;
    return { count: v.seams, lastMs: v.seams > 0 ? v.lastSeamMs : -1, nextMs: v.nextSeamMs };
  }
  /** The loop HUD's counter: the bricks standing. */
  hudCount(): number {
    return this.view.bricks;
  }
  getState() {
    const v = this.view;
    return { phase: v.phase, bricks: v.bricks, total: v.total, balls: v.balls, broken: v.broken, spawned: v.spawned, seams: v.seams };
  }
}
