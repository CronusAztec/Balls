import type { Ball, GameMode, ModeContext } from "../types";

/**
 * Bouncing Shapes ("box" mode, the project.jdm DVD / countdown formats): no rings. A rectangular box
 * (portrait by default) holds 1–12 axis-aligned squares, circles or rounded DVD-style logos that
 * travel in straight lines at constant speed and reflect perfectly off the four walls. Every wall
 * hit plays the next note of the loaded melody or, without a melody, one of four notes – one per
 * wall (left C5, top E5, right G5, bottom C6, snapped to the chosen scale by the tone generator like
 * every other sound). Each shape carries a countdown that drops by one per hit, flashes, grows a
 * little and cycles its colour; the run is finished once every countdown reached zero (never with the
 * countdown off). Several shapes at speeds in small whole-number ratios (2:3, 3:4:5, 4:5:6) hit the
 * walls in those ratios, which is the polyrhythm; a DVD logo that reaches a corner plays an accent
 * (a louder note plus a full-screen flash).
 *
 * The motion is the engine's fixed-step integration (constant velocity, optionally the gravity of the
 * settings scaled by `gravity`) with a mirror reflection at the walls (`reflectAxis()`): the overshoot
 * is folded back, so the bounce period of a shape stays exactly (box − size) / speed and the rhythm
 * never drifts. The launch angle is picked so a shape's vertical and horizontal bounce periods are in
 * a small whole-number ratio too (`launchAngle()`), which gives every shape its own top/bottom vs
 * left/right rhythm. A DVD logo always gets an odd/odd ratio (`DVD_AXIS_PERIOD_RATIOS`), the only kind
 * that brings a centre-launched shape exactly into a corner, and the corner lock (`lockCorner()`)
 * re-aims it by a hair at every bounce so the next scheduled corner stays exact while the logo grows.
 * Everything random comes from `ctx.random()`: the axis ratio, the launch directions and the run's
 * tempo (`TEMPO_SPREAD`: ±15 % on every shape's speed – the ratios between the shapes stay exact, the
 * run length varies continuously with the seed, which is what lets Find Simulation hit a clip length
 * while the countdown is on). The shapes pass through each other, so their rhythms never disturb one
 * another (`ballsPassThrough`).
 */

export const BOX_SHAPES = ["square", "circle", "dvd"] as const;
export type BoxShape = (typeof BOX_SHAPES)[number];

export function isBoxShape(value: unknown): value is BoxShape {
  return typeof value === "string" && (BOX_SHAPES as readonly string[]).includes(value);
}

export const BOX_SPEED_RATIOS = ["1:1", "2:3", "3:4:5", "4:5:6"] as const;
export type BoxSpeedRatio = (typeof BOX_SPEED_RATIOS)[number];

export function isBoxSpeedRatio(value: unknown): value is BoxSpeedRatio {
  return typeof value === "string" && (BOX_SPEED_RATIOS as readonly string[]).includes(value);
}

export interface BoxSettings {
  /** Shapes in the box, 1–12. */
  shapeCount: number;
  shape: BoxShape;
  /** Width of the box relative to its height, 0.5–2 (0.56 ≈ 9:16 portrait). */
  aspect: number;
  /** 0–1: how much of the gravity setting acts on the shapes (0 = straight-line DVD motion). */
  gravity: number;
  /** Starting number on every shape, 0–99; 0 switches the countdown off (the run never ends). */
  countdown: number;
  /** Percent a shape grows per wall hit, 0–3. */
  growPerHit: number;
  /** Speeds of the shapes in small whole-number ratios; "1:1" gives every shape its own launch angle instead. */
  speedRatio: BoxSpeedRatio;
}

export const DEFAULT_BOX_SETTINGS: BoxSettings = {
  shapeCount: 3,
  shape: "square",
  aspect: 0.56,
  gravity: 0,
  countdown: 30,
  growPerHit: 1,
  speedRatio: "3:4:5",
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const BOX_RANGES = {
  boxShapeCount: { min: 1, max: 12, step: 1 },
  boxAspect: { min: 0.5, max: 2, step: 0.01 },
  boxGravity: { min: 0, max: 1, step: 0.05 },
  boxCountdown: { min: 0, max: 99, step: 1 },
  boxGrowPerHit: { min: 0, max: 3, step: 0.1 },
} as const;

/** The Bouncing Shapes fields of the SimulatorSettings object (URL keys bxn, bxs, bxa, bxg, bxc, bxgr, bxr). */
export interface BoxSettingFields {
  boxShapeCount: number;
  boxShape: BoxShape;
  boxAspect: number;
  boxGravity: number;
  boxCountdown: number;
  boxGrowPerHit: number;
  boxSpeedRatio: BoxSpeedRatio;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value to its range (counts become whole numbers; unknown shapes / ratios and bad numbers fall back to the defaults). */
export function resolveBoxSettings(config: Partial<BoxSettings> | null | undefined): BoxSettings {
  const out = { ...DEFAULT_BOX_SETTINGS };
  if (!config) return out;
  if (config.shapeCount !== undefined) out.shapeCount = Math.round(clampNumber(config.shapeCount, BOX_RANGES.boxShapeCount, out.shapeCount));
  if (isBoxShape(config.shape)) out.shape = config.shape;
  if (config.aspect !== undefined) out.aspect = clampNumber(config.aspect, BOX_RANGES.boxAspect, out.aspect);
  if (config.gravity !== undefined) out.gravity = clampNumber(config.gravity, BOX_RANGES.boxGravity, out.gravity);
  if (config.countdown !== undefined) out.countdown = Math.round(clampNumber(config.countdown, BOX_RANGES.boxCountdown, out.countdown));
  if (config.growPerHit !== undefined) out.growPerHit = clampNumber(config.growPerHit, BOX_RANGES.boxGrowPerHit, out.growPerHit);
  if (isBoxSpeedRatio(config.speedRatio)) out.speedRatio = config.speedRatio;
  return out;
}

/** Picks the Bouncing Shapes settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setBoxSettings()`. */
export function boxSettingsOf(source: BoxSettingFields): BoxSettings {
  return {
    shapeCount: source.boxShapeCount,
    shape: source.boxShape,
    aspect: source.boxAspect,
    gravity: source.boxGravity,
    countdown: source.boxCountdown,
    growPerHit: source.boxGrowPerHit,
    speedRatio: source.boxSpeedRatio,
  };
}

/** Writes resolved Bouncing Shapes settings back into the SimulatorSettings field names. */
export function boxSettingFields(settings: BoxSettings): BoxSettingFields {
  return {
    boxShapeCount: settings.shapeCount,
    boxShape: settings.shape,
    boxAspect: settings.aspect,
    boxGravity: settings.gravity,
    boxCountdown: settings.countdown,
    boxGrowPerHit: settings.growPerHit,
    boxSpeedRatio: settings.speedRatio,
  };
}

/* ------------------------------------------------------------------ sound */

/** Wall indices of the box, clockwise from the top. */
export const BOX_WALL_TOP = 0;
export const BOX_WALL_RIGHT = 1;
export const BOX_WALL_BOTTOM = 2;
export const BOX_WALL_LEFT = 3;

/**
 * The note each wall plays without a melody, indexed by wall: top E5, right G5, bottom C6, left C5 – a
 * major triad plus the octave, so the four walls stay consonant and land on a degree of every built-in
 * scale once the tone generator snaps them. Left/right alternate the root and the fifth, top/bottom the
 * third and the octave, so each axis has its own two-note figure.
 */
export const BOX_WALL_NOTES: readonly number[] = [659.25, 783.99, 1046.5, 523.25];

/* ------------------------------------------------------------------ speed ratios */

/** The whole numbers of a ratio id: "3:4:5" → [3, 4, 5]. */
export function parseSpeedRatio(ratio: BoxSpeedRatio): number[] {
  return ratio.split(":").map(Number);
}

/**
 * Speed of every shape as a fraction of the ball speed: the ratio's numbers, cycled over the shapes and
 * normalised so the fastest shape moves at the ball speed ("3:4:5" → 0.6, 0.8, 1, 0.6, …). Shapes whose
 * speeds are in the ratio a:b hit the walls a:b times over the same span – that is the polyrhythm.
 */
export function speedFactors(ratio: BoxSpeedRatio, count: number): number[] {
  const parts = parseSpeedRatio(ratio);
  const max = Math.max(...parts);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(parts[i % parts.length] / max);
  return out;
}

/** A ratio `p : q` of the vertical to the horizontal bounce period: `p` side-wall hits take as long as `q` top/bottom hits. */
export type AxisPeriodRatio = readonly [p: number, q: number];

/**
 * Ratios of the vertical to the horizontal bounce period a run may pick for squares and circles
 * (`launchAngle()`). A shape launched from the centre reaches a corner only when the ratio is odd/odd,
 * so these mostly even ones (2, 3/2, 4/3, 5/2) keep two notes from landing on one hit; 5/3 lets a
 * square kiss a corner now and then for variety.
 */
export const AXIS_PERIOD_RATIOS: readonly AxisPeriodRatio[] = [
  [2, 1],
  [3, 2],
  [4, 3],
  [5, 3],
  [5, 2],
];

/**
 * Ratios for DVD logos: odd/odd only, so the corner accent – the payoff of the format – is on the schedule
 * of every seed. With `p : q` the logo, launched from the centre, is in a corner at its ((p + 1) / 2)-th
 * side-wall hit and then every p side-wall / q top-bottom hits, i.e. one corner every p + q − 1 hits:
 * 5:3 every 7, 7:5 every 11, 3:1 every 3, 7:3 every 9, 9:5 every 13.
 */
export const DVD_AXIS_PERIOD_RATIOS: readonly AxisPeriodRatio[] = [
  [5, 3],
  [7, 5],
  [3, 1],
  [7, 3],
  [9, 5],
];

/** Hits between two corners of a DVD logo with the axis ratio `p : q` (the corner itself counts as one hit). */
export function hitsPerCornerCycle([p, q]: AxisPeriodRatio): number {
  return p + q - 1;
}

/**
 * Width of the seeded tempo band: every shape's speed is the Ball Speed × its speed factor × a tempo drawn
 * per run from 1 ± TEMPO_SPREAD / 2 (0.85–1.15). The ratios between the shapes stay exact; the run length
 * becomes a continuous function of the seed, so Find Simulation can land within its tolerance.
 */
export const TEMPO_SPREAD = 0.3;

/**
 * Launch angle (radians, first quadrant) at which a shape's bounce periods are in the ratio
 * `periodRatio` = (vertical period) / (horizontal period): tan a = innerH / (periodRatio × innerW),
 * where `innerW` × `innerH` is the room the shape's centre has inside the box.
 */
export function launchAngle(innerW: number, innerH: number, periodRatio: number): number {
  return Math.atan2(Math.max(1e-6, innerH) / periodRatio, Math.max(1e-6, innerW));
}

/**
 * Direction (radians from the horizontal, first quadrant) that puts a shape in a corner exactly on
 * schedule: its `hitsX`-th side-wall hit from now and its `hitsY`-th top/bottom hit from now happen at
 * the same instant. `dx` / `dy` are the distances from the shape's centre to the wall ahead in each axis
 * and `innerW` × `innerH` the room its centre has, so the unfolded paths are dx + (hitsX − 1) × innerW
 * and dy + (hitsY − 1) × innerH. From the centre with hitsX = (p + 1) / 2, hitsY = (q + 1) / 2 this is
 * exactly `launchAngle(innerW, innerH, p / q)`.
 */
export function cornerAimAngle(dx: number, dy: number, innerW: number, innerH: number, hitsX: number, hitsY: number): number {
  return Math.atan2(Math.max(0, dy) + (hitsY - 1) * innerH, Math.max(0, dx) + (hitsX - 1) * innerW);
}

/** The corner lock never aims closer than this (radians) to a wall; a schedule that would is out of sync and restarts instead. */
export const MIN_AIM_ANGLE = (3 * Math.PI) / 180;

/* ------------------------------------------------------------------ geometry */

export interface BoxField {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Lays out the box for a canvas of `width` × `height`: a rectangle of the given aspect (width / height)
 * fitted into the centred square the recorder crops to, with a small margin, so a portrait box fills the
 * height of a vertical export and a landscape one its width.
 */
export function buildBoxField(width: number, height: number, aspect: number): BoxField {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const side = Math.max(40, Math.min(width, height) - 2 * margin);
  const a = Math.max(0.05, aspect);
  let w = side;
  let h = side / a;
  if (h > side) {
    h = side;
    w = side * a;
  }
  const left = (width - w) / 2;
  const top = (height - h) / 2;
  return { left, right: left + w, top, bottom: top + h, width: w, height: h };
}

/** The shape size unit: `ballRadius` × this is the half side / radius of a shape, so the default 8 px ball gives a shape a tenth of the box wide. */
export function boxSizeUnit(field: BoxField): number {
  return Math.min(field.width, field.height) / 160;
}

/** Half width / height of the DVD-style logo as multiples of the shape radius (a 2.2 : 1 rounded plate). */
export const DVD_HALF_WIDTH = 1.5;
export const DVD_HALF_HEIGHT = 1.5 / 2.2;

export function shapeHalfWidth(shape: BoxShape, radius: number): number {
  return shape === "dvd" ? radius * DVD_HALF_WIDTH : radius;
}

export function shapeHalfHeight(shape: BoxShape, radius: number): number {
  return shape === "dvd" ? radius * DVD_HALF_HEIGHT : radius;
}

/** A shape never grows past this fraction of the box in either direction. */
export const MAX_SHAPE_FRACTION = 0.45;

export interface AxisReflection {
  pos: number;
  vel: number;
  /** −1: the low wall (left / top) was hit, 1: the high wall (right / bottom), 0: no hit. */
  hit: -1 | 0 | 1;
}

/**
 * Mirror reflection of a shape's centre `pos` (moving at `vel`) whose extent is `half` on each side, off
 * the walls at `lo` and `hi`: the overshoot beyond a wall is folded back inside and the velocity points
 * away from it, so the motion is exactly the straight line a perfect reflection would give – the bounce
 * period is (hi − lo − 2 half) / |vel| to the sub-step, whatever the step size. A shape wider than the
 * box is centred and never hits. The result is written into `out` (no allocation in the hot loop).
 */
export function reflectAxis(pos: number, vel: number, half: number, lo: number, hi: number, out: AxisReflection): AxisReflection {
  const min = lo + half;
  const max = hi - half;
  if (max <= min) {
    out.pos = (lo + hi) / 2;
    out.vel = vel;
    out.hit = 0;
    return out;
  }
  if (pos < min) {
    const folded = 2 * min - pos;
    out.pos = folded > max ? max : folded;
    out.vel = Math.abs(vel);
    out.hit = -1;
    return out;
  }
  if (pos > max) {
    const folded = 2 * max - pos;
    out.pos = folded < min ? min : folded;
    out.vel = -Math.abs(vel);
    out.hit = 1;
    return out;
  }
  out.pos = pos;
  out.vel = vel;
  out.hit = 0;
  return out;
}

/* ------------------------------------------------------------------ the mode */

/** Per-shape state the renderer reads (the mode keeps one per ball, looked up by ball id). */
export interface BoxShapeState {
  id: number;
  /** Hue of the shape's colour (degrees); advances by `HUE_STEP` per hit. */
  hue: number;
  /** Remaining countdown (0 while the countdown is off). */
  count: number;
  /** The countdown reached zero: the shape is frozen and drawn dimmed. */
  done: boolean;
  /** Wall hits so far. */
  hits: number;
  /** Sub-step tick of the last hit (see `BoxView.tick`), −Infinity before the first. */
  lastHitTick: number;
  /** Wall of the last hit (BOX_WALL_*). */
  lastWall: number;
  /** Size relative to the initial size (growth per hit). */
  scale: number;
  /** Speed of the shape as a fraction of the ball speed (its place in the speed ratio). */
  speedFactor: number;
  /** A corner was predicted on the last hit: the other wall's hit within `CORNER_REACH_SUBSTEPS` is part of it (silent). */
  cornerUntilTick: number;
  /** The shape's axis period ratio `p : q` (see `AXIS_PERIOD_RATIOS` / `DVD_AXIS_PERIOD_RATIOS`). */
  axisRatio: AxisPeriodRatio;
  /** Side-wall hits into the current corner cycle of a DVD logo (0 … p − 1; the corner is hit number p). */
  cycleX: number;
  /** Top/bottom hits into the current corner cycle of a DVD logo (0 … q − 1). */
  cycleY: number;
}

/** What the canvas needs to draw the box: the field, the shapes and the recent hits (sub-step ticks, `tickMs` each). */
export interface BoxView {
  field: BoxField | null;
  shape: BoxShape;
  shapes: Map<number, BoxShapeState>;
  /** Sub-steps simulated so far in this run. */
  tick: number;
  /** Length of one sub-step in ms (0 until the first step). */
  tickMs: number;
  /** Tick of the last hit on each wall (BOX_WALL_*), −Infinity before the first. */
  wallLastHitTick: number[];
  /** Tick of the last corner accent, −Infinity before the first. */
  lastCornerTick: number;
  /** The run's seeded tempo (1 ± TEMPO_SPREAD / 2): every shape's speed is the Ball Speed × its speed factor × this. */
  tempo: number;
  countdown: number;
  totalHits: number;
  cornerHits: number;
  /** Shapes whose countdown reached zero. */
  doneCount: number;
  finished: boolean;
}

/** Degrees the hue advances per hit (a golden-angle-ish step, so consecutive colours differ clearly). */
export const HUE_STEP = 47;
/** A wall hit within this many sub-steps of the other axis' hit is one corner hit (≈ 8 ms at 60 Hz × 4 sub-steps). */
export const CORNER_REACH_SUBSTEPS = 2;
/** Most hit sounds one 60 Hz step may queue (12 shapes can touch more walls than that; the rest still count and flash). */
export const MAX_BOX_SOUNDS_PER_STEP = 16;
/** Speed (px/s) along the wall normal below which a contact is not a hit (a shape resting on the floor under gravity). */
export const MIN_HIT_SPEED = 2;

const SCRATCH: AxisReflection = { pos: 0, vel: 0, hit: 0 };

export class BoxMode implements GameMode {
  readonly name = "box";
  /** The shapes keep their speed (no slow-ball boost) and a finished shape stays still. */
  readonly ballsMayRest = true;
  /** The shapes pass through each other, so a collision can never disturb the rhythm. */
  readonly ballsPassThrough = true;
  private settings: BoxSettings = { ...DEFAULT_BOX_SETTINGS };
  private field: BoxField | null = null;
  private readonly shapes = new Map<number, BoxShapeState>();
  private readonly view: BoxView = {
    field: null,
    shape: DEFAULT_BOX_SETTINGS.shape,
    shapes: this.shapes,
    tick: 0,
    tickMs: 0,
    wallLastHitTick: [-Infinity, -Infinity, -Infinity, -Infinity],
    lastCornerTick: -Infinity,
    tempo: 1,
    countdown: DEFAULT_BOX_SETTINGS.countdown,
    totalHits: 0,
    cornerHits: 0,
    doneCount: 0,
    finished: false,
  };
  private soundsThisStep = 0;
  private lastBallSpeed = 0;
  private lastBallRadius = 0;

  getSettings(): BoxSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator re-inits the mode when a Bouncing Shapes setting changes). */
  setSettings(patch: Partial<BoxSettings>) {
    this.settings = resolveBoxSettings({ ...this.settings, ...patch });
  }
  getField() {
    return this.field;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): BoxView {
    return this.view;
  }
  getProgress() {
    return { hits: this.view.totalHits, corners: this.view.cornerHits, done: this.view.doneCount, total: this.settings.shapeCount, finished: this.view.finished };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    this.shapes.clear();
    v.shape = s.shape;
    v.tick = 0;
    v.tickMs = 0;
    v.wallLastHitTick.fill(-Infinity);
    v.lastCornerTick = -Infinity;
    v.countdown = s.countdown;
    v.totalHits = 0;
    v.cornerHits = 0;
    v.doneCount = 0;
    v.finished = false;
    this.soundsThisStep = 0;
    this.lastBallSpeed = ctx.config.ballSpeed || 400;
    const field = this.rebuildField(ctx);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    const radius = this.shapeRadius(ctx, field, 1);
    const factors = speedFactors(s.speedRatio, s.shapeCount);
    const shared = !factors.every((f) => f === factors[0]);
    // The axis ratio, the run's tempo and the first shape's direction come from the seed; a shared angle
    // keeps the polyrhythm exact between shapes, while equal speeds ("1:1") give every shape its own rhythm.
    // DVD logos draw from the odd/odd ratios only, so every seed has corners on its schedule.
    const innerW = field.width - 2 * shapeHalfWidth(s.shape, radius);
    const innerH = field.height - 2 * shapeHalfHeight(s.shape, radius);
    const ratios = s.shape === "dvd" ? DVD_AXIS_PERIOD_RATIOS : AXIS_PERIOD_RATIOS;
    const drawRatio = () => ratios[Math.floor(ctx.random() * ratios.length)];
    const sharedRatio = drawRatio();
    const tempo = 1 + (ctx.random() - 0.5) * TEMPO_SPREAD;
    v.tempo = tempo;
    const sx0 = ctx.random() < 0.5 ? -1 : 1;
    const sy0 = ctx.random() < 0.5 ? -1 : 1;
    const cx = (field.left + field.right) / 2;
    const cy = (field.top + field.bottom) / 2;
    const speed = this.lastBallSpeed * tempo;
    for (let k = 0; k < s.shapeCount; k++) {
      const axisRatio = shared ? sharedRatio : drawRatio();
      const angle = launchAngle(innerW, innerH, axisRatio[0] / axisRatio[1]);
      const sx = sx0 * (k % 2 === 1 ? -1 : 1);
      const sy = sy0 * ((k >> 1) % 2 === 1 ? -1 : 1);
      const hue = (200 + (k * 360) / s.shapeCount) % 360;
      ctx.addBall({
        x: cx,
        y: cy,
        vx: sx * Math.cos(angle) * speed * factors[k],
        vy: sy * Math.sin(angle) * speed * factors[k],
        radius,
        color: shapeColor(hue),
        gravityScale: s.gravity,
        radiusScale: radius / this.lastBallRadius,
      });
      const id = ctx.getNextId() - 1;
      // From the centre the first corner of a p : q logo is its ((p + 1) / 2)-th side-wall hit and ((q + 1) / 2)-th
      // top/bottom hit, i.e. the launch is already (p − 1) / 2 and (q − 1) / 2 hits into the first cycle.
      const dvd = s.shape === "dvd";
      this.shapes.set(id, {
        id,
        hue,
        count: s.countdown,
        done: false,
        hits: 0,
        lastHitTick: -Infinity,
        lastWall: BOX_WALL_TOP,
        scale: 1,
        speedFactor: factors[k],
        cornerUntilTick: -Infinity,
        axisRatio,
        cycleX: dvd ? (axisRatio[0] - 1) / 2 : 0,
        cycleY: dvd ? (axisRatio[1] - 1) / 2 : 0,
      });
    }
  }

  onPreUpdate(ctx: ModeContext) {
    this.soundsThisStep = 0;
    // A live change of the ball speed scales every moving shape's velocity (the ratios between them stay).
    const speed = ctx.config.ballSpeed || 400;
    if (speed !== this.lastBallSpeed && this.lastBallSpeed > 0) {
      const f = speed / this.lastBallSpeed;
      for (const ball of ctx.getBalls()) {
        if (this.shapes.get(ball.id)?.done) continue;
        ball.vx *= f;
        ball.vy *= f;
      }
    }
    this.lastBallSpeed = speed;
    // A live change of the ball size re-sizes every shape (keeping its growth) within the box's cap.
    const radius = ctx.config.ballRadius || 8;
    if (radius !== this.lastBallRadius && this.field) {
      this.lastBallRadius = radius;
      for (const ball of ctx.getBalls()) {
        const st = this.shapes.get(ball.id);
        if (st) this.applySize(ctx, ball, st, this.field);
      }
    }
  }

  /** The engine moved the shape: fold it back off any wall it crossed and turn the crossing into a hit. */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const field = this.field;
    const st = this.shapes.get(ball.id);
    if (!field || !st || st.done) return;
    const v = this.view;
    v.tickMs = dtSec * 1000;
    const shape = v.shape;
    const halfW = shapeHalfWidth(shape, ball.radius);
    const halfH = shapeHalfHeight(shape, ball.radius);
    const rx = reflectAxis(ball.x, ball.vx, halfW, field.left, field.right, SCRATCH);
    const hitX = rx.hit;
    const speedX = Math.abs(ball.vx);
    ball.x = rx.pos;
    ball.vx = rx.vel;
    const ry = reflectAxis(ball.y, ball.vy, halfH, field.top, field.bottom, SCRATCH);
    const hitY = ry.hit;
    const speedY = Math.abs(ball.vy);
    ball.y = ry.pos;
    ball.vy = ry.vel;
    const xHit = hitX !== 0 && speedX >= MIN_HIT_SPEED;
    const yHit = hitY !== 0 && speedY >= MIN_HIT_SPEED;
    if (!xHit && !yHit) return;
    const wallX = hitX < 0 ? BOX_WALL_LEFT : BOX_WALL_RIGHT;
    const wallY = hitY < 0 ? BOX_WALL_TOP : BOX_WALL_BOTTOM;
    if (shape !== "dvd") {
      // Squares and circles: a corner is simply two hits, one per wall.
      if (xHit) this.hit(ctx, ball, st, wallX, false);
      if (yHit && !st.done) this.hit(ctx, ball, st, wallY, false);
      return;
    }
    // A DVD logo: every crossing advances its corner cycle (the silent half of a corner too), a corner is one
    // accented hit, and afterwards the corner lock re-aims the logo at the next corner of its schedule.
    if (xHit) st.cycleX = (st.cycleX + 1) % st.axisRatio[0];
    if (yHit) st.cycleY = (st.cycleY + 1) % st.axisRatio[1];
    if (xHit && yHit) {
      this.hit(ctx, ball, st, wallX, true);
    } else if (v.tick <= st.cornerUntilTick) {
      // The second half of a corner already accented a moment ago is silent.
      st.cornerUntilTick = -Infinity;
    } else {
      // One wall now: a corner is predicted when the other wall is within reach of the next couple of sub-steps
      // and the accent plays now (the other wall's hit will then be the silent half).
      const reach = CORNER_REACH_SUBSTEPS * dtSec;
      const otherNear = xHit ? (ball.vy > 0 ? field.bottom - halfH - ball.y : ball.y - (field.top + halfH)) <= reach * speedY : (ball.vx > 0 ? field.right - halfW - ball.x : ball.x - (field.left + halfW)) <= reach * speedX;
      if (otherNear && (xHit ? speedY : speedX) >= MIN_HIT_SPEED) {
        st.cornerUntilTick = v.tick + CORNER_REACH_SUBSTEPS + 1;
        this.hit(ctx, ball, st, xHit ? wallX : wallY, true);
      } else this.hit(ctx, ball, st, xHit ? wallX : wallY, false);
    }
    // Straight-line motion only (under gravity there is no schedule); while a corner is pending its second
    // half is a sub-step away and the lock waits for it.
    if (!st.done && this.settings.gravity === 0 && v.tick > st.cornerUntilTick) this.lockCorner(ball, st, field);
  }

  /**
   * The corner lock of a DVD logo: after a hit, re-aims the logo (its speed unchanged) so that the next corner
   * of its p : q schedule is exact – `cycleX` / `cycleY` say how many side-wall and top/bottom hits away it
   * is, `cornerAimAngle()` turns the two unfolded paths into the one direction that covers both in the same
   * time. Without it the growth at every hit, which takes a little more room across than down, detunes the
   * ratio and turns the exact corners into near misses within a cycle or two; with it the correction is a
   * fraction of a degree per hit, invisible in the flight. A schedule that would need a grazing angle (after
   * a live change or a hit that did not register) is out of sync and a fresh cycle starts from here instead.
   */
  private lockCorner(ball: Ball, st: BoxShapeState, field: BoxField) {
    const halfW = shapeHalfWidth("dvd", ball.radius);
    const halfH = shapeHalfHeight("dvd", ball.radius);
    const innerW = field.width - 2 * halfW;
    const innerH = field.height - 2 * halfH;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (innerW <= 0 || innerH <= 0 || speed < MIN_HIT_SPEED) return;
    const sx = ball.vx < 0 ? -1 : 1;
    const sy = ball.vy < 0 ? -1 : 1;
    const dx = sx > 0 ? field.right - halfW - ball.x : ball.x - (field.left + halfW);
    const dy = sy > 0 ? field.bottom - halfH - ball.y : ball.y - (field.top + halfH);
    const [p, q] = st.axisRatio;
    const maxAngle = Math.PI / 2 - MIN_AIM_ANGLE;
    let angle = cornerAimAngle(dx, dy, innerW, innerH, p - st.cycleX, q - st.cycleY);
    if (angle < MIN_AIM_ANGLE || angle > maxAngle) {
      st.cycleX = 0;
      st.cycleY = 0;
      angle = Math.min(maxAngle, Math.max(MIN_AIM_ANGLE, cornerAimAngle(dx, dy, innerW, innerH, p, q)));
    }
    ball.vx = sx * Math.cos(angle) * speed;
    ball.vy = sy * Math.sin(angle) * speed;
  }

  onPostSubStep() {
    this.view.tick++;
  }
  onWallHit() {}
  onGapPass() {
    return true;
  }
  onPostUpdate() {}
  /** A canvas resize re-lays the box out; the engine already moved the shapes with the centre, their sizes follow here. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      const field = this.rebuildField(ctx);
      for (const ball of ctx.getBalls()) {
        const st = this.shapes.get(ball.id);
        if (st) this.applySize(ctx, ball, st, field);
      }
    }
    return true;
  }
  /** There are no rings: the walls of the box are handled in onBallStep. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { totalHits: v.totalHits, cornerHits: v.cornerHits, doneCount: v.doneCount, finished: v.finished, tick: v.tick };
  }

  private rebuildField(ctx: ModeContext): BoxField {
    this.field = buildBoxField(ctx.config.width, ctx.config.height, this.settings.aspect);
    this.view.field = this.field;
    return this.field;
  }

  /** Radius of a shape at growth `scale`: the ball size × the box's size unit, capped so the shape never fills the box. */
  private shapeRadius(ctx: ModeContext, field: BoxField, scale: number): number {
    const shape = this.view.shape;
    const cap = Math.min((MAX_SHAPE_FRACTION * field.width) / shapeHalfWidth(shape, 1), (MAX_SHAPE_FRACTION * field.height) / shapeHalfHeight(shape, 1));
    return Math.min((ctx.config.ballRadius || 8) * boxSizeUnit(field) * scale, cap);
  }

  /** Writes the shape's current size into the ball (`radiusScale` keeps it right across `setConfig({ ballRadius })`) and keeps it inside the box. */
  private applySize(ctx: ModeContext, ball: Ball, st: BoxShapeState, field: BoxField) {
    const radius = this.shapeRadius(ctx, field, st.scale);
    ball.radius = radius;
    ball.radiusScale = radius / (ctx.config.ballRadius || 8);
    this.keepInside(ball, field);
  }

  private keepInside(ball: Ball, field: BoxField) {
    const halfW = shapeHalfWidth(this.view.shape, ball.radius);
    const halfH = shapeHalfHeight(this.view.shape, ball.radius);
    if (field.right - field.left > 2 * halfW) ball.x = Math.max(field.left + halfW, Math.min(field.right - halfW, ball.x));
    if (field.bottom - field.top > 2 * halfH) ball.y = Math.max(field.top + halfH, Math.min(field.bottom - halfH, ball.y));
  }

  /** One wall hit: the sound event, the countdown, the flash / colour / growth bookkeeping and the finish. */
  private hit(ctx: ModeContext, ball: Ball, st: BoxShapeState, wall: number, accent: boolean) {
    const v = this.view;
    ctx.noteBounce?.(ball); // --- bounce-math --- a wall of the box is a bounce
    const s = this.settings;
    if (this.soundsThisStep < MAX_BOX_SOUNDS_PER_STEP) {
      this.soundsThisStep++;
      ctx.addPendingSoundEvent(accent ? { type: "hit", wallIndex: wall, frequency: BOX_WALL_NOTES[wall], accent: true } : { type: "hit", wallIndex: wall, frequency: BOX_WALL_NOTES[wall] });
    }
    st.hits++;
    v.totalHits++;
    st.lastHitTick = v.tick;
    st.lastWall = wall;
    v.wallLastHitTick[wall] = v.tick;
    if (accent) {
      v.cornerHits++;
      v.lastCornerTick = v.tick;
    }
    st.hue = (st.hue + HUE_STEP) % 360;
    ball.color = shapeColor(st.hue);
    if (s.growPerHit > 0 && this.field) {
      // Growth stops at the cap (the scale itself is clamped there, so it stays meaningful for a later resize).
      const field = this.field;
      const unitRadius = (ctx.config.ballRadius || 8) * boxSizeUnit(field);
      const maxScale = Math.max(1, this.shapeRadius(ctx, field, Infinity) / unitRadius);
      st.scale = Math.min(maxScale, st.scale * (1 + s.growPerHit / 100));
      this.applySize(ctx, ball, st, field);
    }
    if (s.countdown > 0 && !st.done) {
      st.count--;
      if (st.count <= 0) {
        st.count = 0;
        st.done = true;
        ball.vx = 0;
        ball.vy = 0;
        ball.gravityScale = 0;
        ball.frozen = true;
        v.doneCount++;
        if (v.doneCount >= this.shapes.size) {
          v.finished = true;
          if (this.field) ctx.spawnConfetti((this.field.left + this.field.right) / 2, (this.field.top + this.field.bottom) / 2);
        }
      }
    }
  }
}

/** Colour of a shape for a hue (the renderer brightens it while the hit flash lasts). */
export function shapeColor(hue: number): string {
  return `hsl(${Math.round(hue)}, 88%, 60%)`;
}
