import { circleObstacle, segmentBetween, segmentObstacle, type Obstacle } from "../obstacles";
import type { Ball, GameMode, ModeContext, ObstacleHitResult } from "../types";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * Ball Drop ("symphony" mode): no rings. A tall board of pegs and short bars in a staggered pattern
 * fills the canvas height, closed by a left, a right and (unless looping) a bottom wall – all of them
 * generic obstacles (see ../obstacles.ts). Balls of different sizes and weights are released from the
 * top one after another; every peg, bar or wall hit plays a note whose pitch comes from the ball's size
 * (bigger = lower, snapped to the current scale by the tone generator like every other sound), so the
 * mix of gravities and sizes turns the run into a polyrhythm. The run is finished once every ball has
 * come to rest (or never with "rain" on: the floor opens and balls that fall out re-enter at the top).
 * A board that cannot hold every ball (many big balls) finishes once it is full: when a due release has
 * found no room at the top for a while and the pile is at rest, the run ends with the balls it holds.
 *
 * Everything random (spawn positions, sizes, weights) comes from `ctx.random()`, so a seed replays
 * identically and Find Simulation works for the closed board.
 */

export interface DropSettings {
  /** Balls released from the top, 1–40. */
  ballCount: number;
  /** 0–1: how far the ball radii spread around the configured ball size (±75% at 1). */
  sizeVariation: number;
  /** 0–1: how far each ball's gravity spreads around normal gravity (½×–2× at 1). */
  gravityVariation: number;
  /** Rows of pegs / bars, 3–12. */
  rows: number;
  /** Seconds between two releases, 0–2 (0 drops every ball at once). */
  spawnInterval: number;
  /** "Rain": the floor opens and balls that fall out come back in at the top, so the run never ends. */
  loop: boolean;
}

export const DEFAULT_DROP_SETTINGS: DropSettings = {
  ballCount: 12,
  sizeVariation: 0.5,
  gravityVariation: 0.5,
  rows: 7,
  spawnInterval: 0.4,
  loop: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const DROP_RANGES = {
  dropBallCount: { min: 1, max: 40, step: 1 },
  dropSizeVariation: { min: 0, max: 1, step: 0.05 },
  dropGravityVariation: { min: 0, max: 1, step: 0.05 },
  dropRows: { min: 3, max: 12, step: 1 },
  dropSpawnInterval: { min: 0, max: 2, step: 0.1 },
} as const;

/** The Ball Drop fields of the SimulatorSettings object (URL keys dbc, dsv, dgv, drows, dsi, dloop). */
export interface DropSettingFields {
  dropBallCount: number;
  dropSizeVariation: number;
  dropGravityVariation: number;
  dropRows: number;
  dropSpawnInterval: number;
  dropLoop: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value to its range (counts become whole numbers; bad input falls back to the default). */
export function resolveDropSettings(config: Partial<DropSettings> | null | undefined, unlimited = false): DropSettings {
  const out = { ...DEFAULT_DROP_SETTINGS };
  if (!config) return out;
  const R = rangesFor(DROP_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (config.ballCount !== undefined) out.ballCount = Math.round(clampNumber(config.ballCount, R.dropBallCount, out.ballCount));
  if (config.sizeVariation !== undefined) out.sizeVariation = clampNumber(config.sizeVariation, R.dropSizeVariation, out.sizeVariation);
  if (config.gravityVariation !== undefined) out.gravityVariation = clampNumber(config.gravityVariation, R.dropGravityVariation, out.gravityVariation);
  if (config.rows !== undefined) out.rows = Math.round(clampNumber(config.rows, R.dropRows, out.rows));
  if (config.spawnInterval !== undefined) out.spawnInterval = clampNumber(config.spawnInterval, R.dropSpawnInterval, out.spawnInterval);
  if (typeof config.loop === "boolean") out.loop = config.loop;
  return out;
}

/** Picks the Ball Drop settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setDropSettings()`. */
export function dropSettingsOf(source: DropSettingFields): DropSettings {
  return {
    ballCount: source.dropBallCount,
    sizeVariation: source.dropSizeVariation,
    gravityVariation: source.dropGravityVariation,
    rows: source.dropRows,
    spawnInterval: source.dropSpawnInterval,
    loop: source.dropLoop,
  };
}

/** Writes resolved Ball Drop settings back into the SimulatorSettings field names. */
export function dropSettingFields(settings: DropSettings): DropSettingFields {
  return {
    dropBallCount: settings.ballCount,
    dropSizeVariation: settings.sizeVariation,
    dropGravityVariation: settings.gravityVariation,
    dropRows: settings.rows,
    dropSpawnInterval: settings.spawnInterval,
    dropLoop: settings.loop,
  };
}

/* ------------------------------------------------------------------ sound */

export const DROP_PITCH_MIN_HZ = 110;
export const DROP_PITCH_MAX_HZ = 1760;

/**
 * Pitch of a ball's hits from its size, like a marble on a table: bigger = lower. The default 8 px
 * ball plays E5 (660 Hz), 4 px plays 1320 Hz, 16 px plays 330 Hz, clamped to A2–A6. The tone
 * generator snaps it to the chosen scale afterwards.
 */
export function dropHitFrequency(radius: number): number {
  if (!(radius > 0)) return DROP_PITCH_MAX_HZ;
  return Math.max(DROP_PITCH_MIN_HZ, Math.min(DROP_PITCH_MAX_HZ, 5280 / radius));
}

/* ------------------------------------------------------------------ layout */

export interface DropField {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DropLayout {
  field: DropField;
  /** Walls first (left, right, then the floor unless looping), then the rows from top to bottom. */
  obstacles: Obstacle[];
  pegRadius: number;
  /** Horizontal distance between two pegs of a row. */
  columnSpacing: number;
  /** Half the length of a bar. */
  barHalfLength: number;
  /** The ball radius the board was laid out for. */
  ballRadius: number;
}

/** Fraction of the approach speed a ball keeps on each kind of obstacle. */
export const PEG_RESTITUTION = 0.7;
export const BAR_RESTITUTION = 0.65;
export const WALL_RESTITUTION = 0.55;
export const FLOOR_RESTITUTION = 0.45;
/**
 * Fraction of the relative speed two colliding balls keep. The engine's pair rebound is perfectly elastic,
 * which suits the ring modes but lets a ball cradled between two others rock forever on the floor; this
 * takes the energy out of the pile so the board settles.
 */
export const BALL_TO_BALL_RESTITUTION = 0.6;
/** How far the side walls continue above the top of the board, as a fraction of the canvas height (see `buildDropLayout()`). */
export const WALL_EXTENSION = 1;

/**
 * Lays out the board for a canvas of `width` × `height`: a portrait playfield that uses the full
 * height and fits the centred square the recorder crops to, with `rows` staggered rows between the
 * top and the floor. Every third row is bars instead of pegs. The column spacing follows the ball
 * size so the biggest ball of the size spread still fits between two pegs and past the ends of a bar.
 */
export function buildDropLayout(width: number, height: number, rows: number, ballRadius: number, loop: boolean): DropLayout {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const fieldHeight = Math.max(40, height - 2 * margin);
  const fieldWidth = Math.max(40, Math.min(width - 2 * margin, 0.82 * fieldHeight));
  const left = (width - fieldWidth) / 2;
  const right = left + fieldWidth;
  const top = margin;
  const bottom = height - margin;
  const obstacles: Obstacle[] = [];
  // The side walls continue one canvas height above the top (the canvas clips them at its edge), so a pile
  // that outgrows the board – more or bigger balls than it can hold – stays between them instead of
  // spilling sideways above the canvas, and the release spots at the top are judged against a confined pile.
  const wallTop = top - WALL_EXTENSION * height;
  obstacles.push(segmentBetween(left, wallTop, left, bottom, { restitution: WALL_RESTITUTION }));
  obstacles.push(segmentBetween(right, wallTop, right, bottom, { restitution: WALL_RESTITUTION }));
  if (!loop) obstacles.push(segmentBetween(left, bottom, right, bottom, { restitution: FLOOR_RESTITUTION }));

  const r = Math.max(2, ballRadius);
  const pegRadius = Math.max(3, Math.min(7, 0.012 * fieldHeight));
  // The size spread makes balls up to 1.75× the base radius (see SIZE_SPREAD): keep the openings wider than that.
  const columnGap = Math.max(48, 5.5 * r + 2 * pegRadius + 6);
  const cols = Math.max(2, Math.floor(fieldWidth / columnGap));
  const spacing = fieldWidth / cols;
  const barHalfLength = Math.max(6, Math.min(0.35 * spacing, (spacing - 3.5 * r - 4) / 2));
  const y0 = top + 0.16 * fieldHeight;
  const y1 = bottom - 0.14 * fieldHeight;
  const rowCount = Math.max(1, Math.round(rows));
  const rowGap = rowCount > 1 ? (y1 - y0) / (rowCount - 1) : 0;
  for (let i = 0; i < rowCount; i++) {
    const y = y0 + i * rowGap;
    const offset = i % 2 === 1;
    const bars = i % 3 === 2;
    const count = offset ? cols - 1 : cols;
    for (let j = 0; j < count; j++) {
      const x = left + spacing * (offset ? j + 1 : j + 0.5);
      obstacles.push(bars ? segmentObstacle(x, y, barHalfLength, 0, { restitution: BAR_RESTITUTION }) : circleObstacle(x, y, pegRadius, { restitution: PEG_RESTITUTION }));
    }
  }
  return { field: { left, right, top, bottom }, obstacles, pegRadius, columnSpacing: spacing, barHalfLength, ballRadius: r };
}

/* ------------------------------------------------------------------ the mode */

/** The run is finished once no ball has moved more than this (px) … */
export const REST_DISTANCE = 3;
/**
 * … over a window this long (ms). Positions rather than speeds, because a resting ball still jitters by one
 * sub-step of gravity. The same span decides that a board is full: a due release that has found no free spot
 * at the top for this long, while every released ball is at rest, is the sign that the rest cannot enter.
 */
export const REST_TIME_MS = 1000;
/** Candidate spots tried for a release before it waits for the next step (the top must be clear of other balls). */
const SPAWN_ATTEMPTS = 6;
/** Most hit sounds one 60 Hz step may queue (40 balls raining can touch more obstacles than that; the rest still bounce and glow). */
export const MAX_HIT_SOUNDS_PER_STEP = 8;
/** Radii spread ±75% of the base radius at full size variation. */
export const SIZE_SPREAD = 0.75;
/** Gravity spreads one octave each way (½×–2×) at full gravity variation. */
export const GRAVITY_SPREAD_OCTAVES = 1;
/** Smallest ball the spread may produce, px. */
export const MIN_DROP_RADIUS = 3;
/** Sideways speed range (px/s) a released ball gets, so a ball never sits balanced on the peg straight below it. */
const SPAWN_DRIFT = 40;

export class DropMode implements GameMode {
  readonly name = "drop";
  readonly ballsMayRest = true;
  private settings: DropSettings = { ...DEFAULT_DROP_SETTINGS };
  private layout: DropLayout | null = null;
  private released = 0;
  /** Balls this run will release: the configured count, or the number that fit once the board proved full. */
  private target = DEFAULT_DROP_SETTINGS.ballCount;
  /** Milliseconds a due release has been finding no free spot at the top (back to 0 as soon as one succeeds). */
  private blockedMs = 0;
  /** Milliseconds into the current rest window and where every ball was when it started. */
  private restMs = 0;
  private restAnchors = new Map<number, { x: number; y: number }>();
  private finished = false;
  private soundsThisStep = 0;

  getSettings(): DropSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator re-inits the mode when a Ball Drop setting changes). --- unlimited --- With `unlimited` (No limits on) the unlimited settings run past their sliders, up to their soft ceilings. */
  setSettings(patch: Partial<DropSettings>, unlimited = false) {
    this.settings = resolveDropSettings({ ...this.settings, ...patch }, unlimited);
  }
  getLayout() {
    return this.layout;
  }
  /** `total` is the number of balls this run releases: the setting, or fewer once the board proved full (see onPostUpdate). */
  getProgress() {
    return { released: this.released, total: this.target, finished: this.finished };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.released = 0;
    this.target = this.settings.ballCount;
    this.blockedMs = 0;
    this.restMs = 0;
    this.restAnchors.clear();
    this.finished = false;
    this.soundsThisStep = 0;
    this.rebuild(ctx);
    this.releaseDue(ctx, 0);
  }
  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.soundsThisStep = 0;
    // A live change of the ball size re-spaces the pegs for the new size.
    if (this.layout && (ctx.config.ballRadius || 8) !== this.layout.ballRadius) this.rebuild(ctx);
    if (this.released < this.target) this.blockedMs = this.releaseDue(ctx, ctx.getElapsedMs()) ? this.blockedMs + dtMs : 0;
  }
  onBallStep() {}
  /**
   * Safety net behind the obstacle walls: a ball whose centre was shoved across a wall line (two big balls
   * separating against a thin wall) is put back inside. Normal contacts never get here.
   */
  onPostSubStep(ctx: ModeContext) {
    const field = this.layout?.field;
    if (!field) return;
    for (const ball of ctx.getBalls()) {
      if (ball.x < field.left) {
        ball.x = field.left + ball.radius;
        if (ball.vx < 0) ball.vx = -ball.vx * WALL_RESTITUTION;
      } else if (ball.x > field.right) {
        ball.x = field.right - ball.radius;
        if (ball.vx > 0) ball.vx = -ball.vx * WALL_RESTITUTION;
      }
      if (!this.settings.loop && ball.y > field.bottom) {
        ball.y = field.bottom - ball.radius;
        if (ball.vy > 0) ball.vy = -ball.vy * FLOOR_RESTITUTION;
      }
    }
  }
  onWallHit() {}
  onGapPass() {
    return true;
  }
  /**
   * Called right after the engine's elastic pair rebound: scales the relative speed of the pair along the
   * contact normal down to BALL_TO_BALL_RESTITUTION, keeping their common velocity (equal masses).
   */
  onBallCollision(_ctx: ModeContext, a: Ball, b: Ball) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const an = a.vx * nx + a.vy * ny;
    const bn = b.vx * nx + b.vy * ny;
    const centre = (an + bn) / 2;
    const da = centre + BALL_TO_BALL_RESTITUTION * (an - centre) - an;
    const db = centre + BALL_TO_BALL_RESTITUTION * (bn - centre) - bn;
    a.vx += da * nx;
    a.vy += da * ny;
    b.vx += db * nx;
    b.vy += db * ny;
  }
  onObstacleHit(_ctx: ModeContext, ball: Ball): ObstacleHitResult {
    if (this.soundsThisStep >= MAX_HIT_SOUNDS_PER_STEP) return { suppressSound: true };
    this.soundsThisStep++;
    return { frequency: dropHitFrequency(ball.radius) };
  }
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const field = this.layout?.field;
    if (!field) return;
    const balls = ctx.getBalls();
    if (this.settings.loop) {
      // Rain: a ball that fell out of the open floor comes back in at the top (a closed board's floor and
      // the safety net in onPostSubStep() keep every ball inside, so nothing needs rescuing there).
      const fallenBelow = ctx.config.height + 40;
      for (const ball of balls) if (ball.y - ball.radius > fallenBelow) this.respawn(ctx, ball);
      return;
    }
    if (this.finished) return;
    // A full board: a due release has found no room at the top for REST_TIME_MS. The run then finishes with
    // the balls it holds (once they are at rest) instead of waiting forever for balls that cannot enter.
    const full = this.released < this.target && this.blockedMs >= REST_TIME_MS;
    if (this.released < this.target && !full) return;
    // Rest detection: a window starts with a snapshot of every ball; if none of them has moved more than
    // REST_DISTANCE by the end of it, the board has settled – otherwise a new window starts from here. Where
    // a ball rests does not matter: a pile may reach above the top of the board (the walls continue there).
    if (this.restAnchors.size === 0) this.anchorBalls(balls);
    this.restMs += dtMs;
    if (this.restMs < REST_TIME_MS) return;
    let resting = true;
    for (const ball of balls) {
      const anchor = this.restAnchors.get(ball.id);
      if (!anchor || Math.hypot(ball.x - anchor.x, ball.y - anchor.y) > REST_DISTANCE) {
        resting = false;
        break;
      }
    }
    if (resting) {
      if (full) this.target = this.released;
      this.finished = true;
      ctx.spawnConfetti((field.left + field.right) / 2, field.bottom - 0.15 * (field.bottom - field.top));
    } else {
      this.anchorBalls(balls);
      this.restMs = 0;
    }
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) this.rebuild(ctx);
    return true;
  }
  /** There are no rings: the walls of the board are obstacles. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.finished;
  }
  getState() {
    return { released: this.released, total: this.target, finished: this.finished, restMs: this.restMs, blockedMs: this.blockedMs };
  }

  private anchorBalls(balls: Ball[]) {
    for (const ball of balls) {
      const anchor = this.restAnchors.get(ball.id);
      if (anchor) {
        anchor.x = ball.x;
        anchor.y = ball.y;
      } else this.restAnchors.set(ball.id, { x: ball.x, y: ball.y });
    }
  }

  private rebuild(ctx: ModeContext) {
    this.layout = buildDropLayout(ctx.config.width, ctx.config.height, this.settings.rows, ctx.config.ballRadius || 8, this.settings.loop);
    ctx.setObstacles(this.layout.obstacles);
  }

  /**
   * Releases every ball whose turn has come: ball k leaves the top at k × spawnInterval seconds. A ball
   * whose spot at the top is still taken (a burst of big balls, or a pile that reaches the top) waits for
   * a later step, so balls never spawn inside each other. Returns true when a due release found no spot,
   * so the caller can time how long the top has been blocked (see onPostUpdate: a full board).
   */
  private releaseDue(ctx: ModeContext, elapsedMs: number): boolean {
    const { spawnInterval } = this.settings;
    while (this.released < this.target && elapsedMs + 1e-6 >= this.released * spawnInterval * 1000) {
      if (!this.spawn(ctx)) return true;
      this.released++;
      // A new ball starts the rest detection over (only relevant on a blocked board, where a window may already run).
      this.restMs = 0;
      this.restAnchors.clear();
    }
    return false;
  }

  private spawn(ctx: ModeContext): boolean {
    const field = this.layout!.field;
    const base = ctx.config.ballRadius || 8;
    const s = this.settings;
    const uSize = ctx.random();
    const uGravity = ctx.random();
    const radiusScale = Math.max(MIN_DROP_RADIUS / base, 1 + s.sizeVariation * SIZE_SPREAD * (2 * uSize - 1));
    const radius = base * radiusScale;
    const y = field.top - radius - 4;
    const x = this.freeSpotX(ctx, radius, y);
    if (x === null) return false;
    ctx.addBall({
      x,
      y,
      vx: (ctx.random() - 0.5) * SPAWN_DRIFT,
      vy: 0,
      radius,
      color: ctx.config.ballColor || "#FFFFFF",
      gravityScale: Math.pow(2, s.gravityVariation * GRAVITY_SPREAD_OCTAVES * (2 * uGravity - 1)),
      radiusScale,
    });
    return true;
  }

  /** A random x along the top at which a ball of `radius` at height `y` touches no other ball, or null when every attempt is taken. */
  private freeSpotX(ctx: ModeContext, radius: number, y: number, ignore?: Ball): number | null {
    const field = this.layout!.field;
    const span = Math.max(0, field.right - field.left - 2 * radius - 4);
    const balls = ctx.getBalls();
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const x = field.left + radius + 2 + ctx.random() * span;
      let free = true;
      for (const other of balls) {
        if (other === ignore) continue;
        const reach = radius + other.radius + 2;
        if ((other.x - x) * (other.x - x) + (other.y - y) * (other.y - y) < reach * reach) {
          free = false;
          break;
        }
      }
      if (free) return x;
    }
    return null;
  }

  private respawn(ctx: ModeContext, ball: Ball) {
    const field = this.layout!.field;
    // Re-entries are spread over a band above the top so the rain never lines up; a taken spot moves further up.
    let y = field.top - ball.radius - 4 - ctx.random() * 60;
    let x = this.freeSpotX(ctx, ball.radius, y, ball);
    if (x === null) {
      y -= 80;
      x = this.freeSpotX(ctx, ball.radius, y, ball) ?? (field.left + field.right) / 2;
    }
    ball.x = x;
    ball.y = y;
    ball.vx = (ctx.random() - 0.5) * SPAWN_DRIFT;
    ball.vy = 0;
    ball.spin = 0;
    ball.trail.length = 0; // no streak across the canvas from the bottom to the top
    ball.trailIndex = 0;
  }
}
