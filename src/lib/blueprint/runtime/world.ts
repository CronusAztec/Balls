/*
 * --- blueprint --- The physics of a Blueprint run inside the engine: the arena – a circle with exits, a box, or concentric
 * rings with gaps –, obstacles, a field of destructible tiles (lib/physics/tiles.ts TileField) and full-physics balls that
 * bounce off each other. The balls are the engine's own (they move, trail, draw, record and take bounce math like every
 * mode's); the world keeps each one's Blueprint slots (`WorldBall`: body, tier, team, hit points, palette colour) and
 * resolves everything the engine leaves to a mode that owns its playfield (box.ts, mergeRing.ts do the same):
 *
 *  - `ballStep()` (the mode's onBallStep, right after the engine moved the ball): tiles first – TileField sweeps the move, so
 *    nothing tunnels –, then pegs, bars and spinners, then the arena (rim, exits, box walls, rings, escapes), then the spec's
 *    gravity (the engine's is off for these balls: gravityScale 0);
 *  - `collidePairs()` (onPostSubStep): every touching pair, by mass (area), through a grid rebuilt each sub-step;
 *  - `advance()` (once a step): the rim, the rings' gaps and the spinners turn.
 *
 * It knows nothing of rules: it reports what happened (a wall hit, a tile broken, an escape…) to the interpreter
 * (runtime/run.ts), which decides what it means. Determinism: no clock and no randomness of its own; balls are kept in
 * creation order and every loop walks them in it. Work: a static grid holds the pegs and bars, TileField its own; the pair
 * grid is rebuilt each sub-step; all of it stops at the sandbox's ceilings (lib/uncap.ts BLUEPRINT_CEILINGS).
 *
 * Geometry: the arena is centred in the engine's world with a radius of `size` × half its shorter side (WORLD_SIDE 450 px:
 * 225 px × size, whatever the frame's shape). Spec positions are arena units (−1…1, 1 = the rim); clock degrees (0 = top,
 * clockwise) become screen angles (0 = right, clockwise, y down) here.
 */
import type { Ball, ModeContext, NewBall } from "@/lib/physics/types";
import { TileField } from "@/lib/physics/tiles";
import { BLUEPRINT_TILE_CEILING } from "../limits";
import type { Blueprint } from "../schema";
import type { WorldEvents } from "./events";

export const FIXED_STEP_SEC = 1 / 60;
/** Approach speed (px/s) below which a contact is a touch, not a hit: no event, no damage, no sound (a ball resting on the floor). */
export const MIN_HIT_SPEED = 15;
/**
 * The least share of a ball's speed that must go into a wall for a contact to be a hit: a ball skimming along the rim (it
 * re-touches every few steps at a grazing angle) is not bouncing, so it fires no wallHit, chips no tile and plays no note.
 */
export const GRAZE_RATIO = 0.25;

/** Whether a contact with this approach speed is a hit, for a ball moving at `speed` before it. */
export function isHit(impact: number, speed: number): boolean {
  return impact >= MIN_HIT_SPEED && impact >= GRAZE_RATIO * speed;
}
/** Half the thickness of the rim, the rings and an exit's edges (px). */
export const WALL_HALF = 2;
/** The static grid's and the pair grid's cell (px). */
const CELL = 32;
const TAU = Math.PI * 2;
/** How long an escaped ball keeps flying out of the frame (ms; the canvas fades it), before the engine drops it. */
export const ESCAPE_GHOST_MS = 1000;

/** What a new ball of the world is: where and how it moves, and its Blueprint slots. */
export interface NewWorldBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Gravity scale. */
  gs: number;
  /** Passes through other balls (still touching them for ballHit). */
  pass: boolean;
  body: number;
  tier: number;
  team: number;
  hp: number;
  color: number;
}

/**
 * A ball of the world: the engine's ball (`ball`, which the engine moves and the canvas draws) and the Blueprint's slots.
 * Its position, velocity and radius are the engine ball's (the accessors read and write it), so the interpreter's code
 * reads `b.x`, `b.r` whatever holds them.
 */
export class WorldBall {
  readonly ball: Ball;
  readonly id: number;
  body: number;
  tier: number;
  hp: number;
  pass: boolean;
  gs: number;
  /** False once it escaped, popped or was removed (the step sweeps it out). */
  alive = true;
  /** It left through an exit or past the last ring: it flies on out of the frame as a fading ghost. */
  escaped = false;
  /** Distance from the centre where the sub-step began (ring passes). */
  pd = 0;
  /** The step of its last wall hit (one wall hit a step). */
  lastWall = -1;
  private teamSlot: number;
  private colorSlot: number;
  private readonly palette: readonly string[];

  constructor(ball: Ball, nb: NewWorldBall, palette: readonly string[]) {
    this.ball = ball;
    this.id = ball.id;
    this.body = nb.body;
    this.tier = nb.tier;
    this.hp = nb.hp;
    this.pass = nb.pass;
    this.gs = nb.gs;
    this.palette = palette;
    this.teamSlot = nb.team;
    this.colorSlot = nb.color;
    ball.team = nb.team;
  }

  get x() {
    return this.ball.x;
  }
  set x(v: number) {
    this.ball.x = v;
  }
  get y() {
    return this.ball.y;
  }
  set y(v: number) {
    this.ball.y = v;
  }
  get vx() {
    return this.ball.vx;
  }
  set vx(v: number) {
    this.ball.vx = v;
  }
  get vy() {
    return this.ball.vy;
  }
  set vy(v: number) {
    this.ball.vy = v;
  }
  get r() {
    return this.ball.radius;
  }
  set r(v: number) {
    this.ball.radius = v;
  }
  get team() {
    return this.teamSlot;
  }
  set team(t: number) {
    this.teamSlot = t;
    this.ball.team = t;
  }
  /** The palette index (the engine ball's colour follows it). */
  get color() {
    return this.colorSlot;
  }
  set color(c: number) {
    this.colorSlot = c;
    this.ball.color = this.palette[c] ?? this.palette[0] ?? "#ffffff";
  }
  /** Paints the engine ball back in its palette colour (the page's Ball Color repaints every ball). */
  repaint() {
    this.ball.color = this.palette[this.colorSlot] ?? this.palette[0] ?? "#ffffff";
  }
}

/** Clock degrees (0 = top, clockwise) → a screen angle in radians (0 = right, clockwise with y down). */
export const clockToAngle = (deg: number) => ((deg - 90) * Math.PI) / 180;

/** The signed smallest difference of two angles, in (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

const enum Kind {
  Peg = 0,
  Bar = 1,
}

export class BlueprintWorld {
  readonly bp: Blueprint;
  width = 0;
  height = 0;
  cx = 0;
  cy = 0;
  R = 0;
  readonly shape: Blueprint["arena"]["shape"];
  readonly restitution: number;
  readonly gx: number;
  readonly gy: number;
  /** The wall bounciness extra (the page's physics extras), applied to every rebound off the arena and its obstacles. */
  wallBounciness = 1;

  /* the rim's exits (circle): centre angle at rotation 0 and half width, radians */
  readonly exitAt: number[] = [];
  readonly exitHalf: number[] = [];
  private readonly rimSpin: number;
  rimAngle = 0;

  /* rings: radius factors (of R) and radii, life, gap angle (now) and spin */
  private readonly ringF: number[] = [];
  readonly ringR: number[] = [];
  readonly ringAlive: boolean[] = [];
  readonly ringGapAt: number[] = [];
  readonly ringSpin: number[] = [];
  readonly ringGapHalf: number = 0;
  /** A ring breaks when a ball passes outward through its gap. */
  readonly ringBreak: boolean = false;
  /** When each ring broke (s of the run; −1: standing) – the renderer's shatter. */
  readonly ringBrokeAt: number[] = [];

  /* pegs and bumpers */
  readonly pegX: number[] = [];
  readonly pegY: number[] = [];
  readonly pegR: number[] = [];
  readonly pegKick: number[] = [];
  /** The spec's obstacle pattern each peg came from (obstacleHit reports the pattern's index). */
  readonly pegOf: number[] = [];
  /** When each peg was last hit (s of the run): the renderer's glow. */
  readonly pegHitAt: number[] = [];
  /* bars (static) and spinners (turning) */
  readonly barAx: number[] = [];
  readonly barAy: number[] = [];
  readonly barBx: number[] = [];
  readonly barBy: number[] = [];
  readonly barHalf: number[] = [];
  readonly barOf: number[] = [];
  readonly spinX: number[] = [];
  readonly spinY: number[] = [];
  readonly spinLen: number[] = [];
  readonly spinAngle: number[] = [];
  readonly spinOmega: number[] = [];
  readonly spinHalf: number[] = [];
  readonly spinOf: number[] = [];

  /* tiles: the shared primitive, sized once by the spec (never past the tile ceiling) */
  readonly tiles: TileField;
  readonly tilePierce: boolean;
  /** Tiles laid out (alive or broken). */
  tileCount = 0;

  /* the static grid (pegs and bars) */
  private gridCols = 1;
  private gridRows = 1;
  private cellStart = new Int32Array(2);
  private cellItems = new Int32Array(0);
  private staticStamp = new Int32Array(1);
  private stampSerial = 0;

  /* the balls, in creation order */
  balls: WorldBall[] = [];
  readonly byId = new Map<number, WorldBall>();
  /** The interpreter's step (one wall hit a ball a step). */
  step = 0;
  /** The run's clock (s), for the glows. */
  timeSec = 0;
  /** Balls that went non-finite (NaN / ±Infinity) and were taken out. */
  nanBalls = 0;
  /** Pair checks and contact tests of the run (a work count, deterministic). */
  work = 0;

  /** The ball's speed (relative to the surface) before the last resolved contact: whether it was a hit or a graze. */
  private lastSpeed = 0;

  /* the pair grid (rebuilt each sub-step) */
  private pairCount = new Int32Array(0);
  private pairStart = new Int32Array(0);
  private pairItems = new Int32Array(0);
  private pairSeen = new Int32Array(0);
  private readonly pairKeys = new Set<number>();

  constructor(bp: Blueprint, width: number, height: number) {
    this.bp = bp;
    const a = bp.arena;
    this.shape = a.shape;
    this.restitution = a.restitution;
    this.gx = a.gravity.x;
    this.gy = a.gravity.y;
    this.rimSpin = (a.spinDegPerSec * Math.PI) / 180;
    if (a.shape === "circle")
      for (const e of a.exits) {
        this.exitAt.push(clockToAngle(e.atDeg));
        this.exitHalf.push(((e.widthDeg / 2) * Math.PI) / 180);
      }
    if (a.shape === "rings" && a.rings) {
      const rg = a.rings;
      this.ringGapHalf = ((rg.gapDeg / 2) * Math.PI) / 180;
      this.ringBreak = rg.breakOnPass;
      for (let k = 0; k < rg.count; k++) {
        this.ringF.push(rg.count === 1 ? 1 : rg.inner + ((1 - rg.inner) * k) / (rg.count - 1));
        this.ringR.push(0);
        this.ringAlive.push(true);
        this.ringBrokeAt.push(-1);
        // gaps staggered by the golden angle, so a straight line never runs through them all
        this.ringGapAt.push(clockToAngle(k * 137.508));
        const spin = (rg.spinDegPerSec * Math.PI) / 180;
        this.ringSpin.push(rg.alternate && k % 2 === 1 ? -spin : spin);
      }
    }
    const t = bp.tiles;
    this.tilePierce = t?.pierce ?? false;
    this.tiles = new TileField(Math.max(1, t ? Math.min(t.rows * t.cols, BLUEPRINT_TILE_CEILING) : 1));
    this.layout(width, height);
  }

  /* ------------------------------------------------------------------ geometry */

  /** Lays the arena, its obstacles and its tiles out for a world of `width` × `height` px (a resize keeps every tile's damage). */
  layout(width: number, height: number) {
    const fresh = this.width === 0;
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.R = (this.bp.arena.size * Math.min(width, height)) / 2;
    const R = this.R;
    for (let k = 0; k < this.ringF.length; k++) this.ringR[k] = R * this.ringF[k];
    // obstacles (arena units → px)
    const px = (u: number) => this.cx + u * R;
    const py = (u: number) => this.cy + u * R;
    for (const arr of [this.pegX, this.pegY, this.pegR, this.pegKick, this.pegOf, this.barAx, this.barAy, this.barBx, this.barBy, this.barHalf, this.barOf, this.spinX, this.spinY, this.spinLen, this.spinHalf, this.spinOf]) arr.length = 0;
    const spinAngles = this.spinAngle.slice();
    this.spinAngle.length = 0;
    this.spinOmega.length = 0;
    this.bp.obstacles.forEach((o, oi) => {
      switch (o.kind) {
        case "peg":
        case "bumper":
          this.addPeg(px(o.x), py(o.y), o.r * R, o.kind === "bumper" ? o.kick : 0, oi);
          break;
        case "pegGrid":
          for (let row = 0; row < o.rows; row++)
            for (let col = 0; col < o.cols; col++) {
              const shift = o.stagger && row % 2 === 1 ? 0.5 : 0;
              const fx = o.cols === 1 ? 0.5 : (col + shift) / (o.cols - (o.stagger ? 0.5 : 1));
              const fy = o.rows === 1 ? 0.5 : row / (o.rows - 1);
              this.addPeg(px(o.x - o.w / 2 + fx * o.w), py(o.y - o.h / 2 + fy * o.h), o.r * R, 0, oi);
            }
          break;
        case "pegRing":
          for (let k = 0; k < o.count; k++) {
            const ang = (k / o.count) * TAU;
            this.addPeg(px(o.x + o.radius * Math.cos(ang)), py(o.y + o.radius * Math.sin(ang)), o.r * R, 0, oi);
          }
          break;
        case "bar": {
          const ang = clockToAngle(o.angleDeg + 90); // (0° = a level bar)
          const hx = (Math.cos(ang) * o.len * R) / 2;
          const hy = (Math.sin(ang) * o.len * R) / 2;
          this.barAx.push(px(o.x) - hx);
          this.barAy.push(py(o.y) - hy);
          this.barBx.push(px(o.x) + hx);
          this.barBy.push(py(o.y) + hy);
          this.barHalf.push((o.thick * R) / 2);
          this.barOf.push(oi);
          break;
        }
        case "spinner":
          this.spinX.push(px(o.x));
          this.spinY.push(py(o.y));
          this.spinLen.push((o.len * R) / 2);
          this.spinAngle.push(spinAngles[this.spinAngle.length] ?? clockToAngle(o.angleDeg + 90));
          this.spinOmega.push((o.spinDegPerSec * Math.PI) / 180);
          this.spinHalf.push((o.thick * R) / 2);
          this.spinOf.push(oi);
          break;
      }
    });
    while (this.pegHitAt.length < this.pegX.length) this.pegHitAt.push(-Infinity);
    this.layoutTiles(fresh);
    this.buildStaticGrid();
  }

  private layoutTiles(fresh: boolean) {
    const t = this.bp.tiles;
    const field = this.tiles;
    if (!t) {
      field.clear();
      field.build();
      this.tileCount = 0;
      return;
    }
    // a resize: every tile keeps its hit points and its life (the layout is the same tiles in the same order)
    const n = field.count;
    const keepHp = fresh ? null : field.hp.slice(0, n);
    const keepAlive = fresh ? null : field.alive.slice(0, n);
    const keepHit = fresh ? null : field.hitMs.slice(0, n);
    const keepBroke = fresh ? null : field.brokeMs.slice(0, n);
    field.clear();
    const R = this.R;
    const cap = field.capacity;
    for (let row = 0; row < t.rows && field.count < cap; row++)
      for (let col = 0; col < t.cols && field.count < cap; col++) {
        const hp = t.hp + row * t.hpStep;
        if (t.layout === "grid") {
          const w = (t.area.w * R) / t.cols;
          const h = (t.area.h * R) / t.rows;
          const x0 = this.cx + t.area.x * R + col * w + 1;
          const y0 = this.cy + t.area.y * R + row * h + 1;
          const x1 = x0 + w - 2;
          const y1 = y0 + h - 2;
          if (!(x1 > x0 && y1 > y0)) continue;
          // a tile outside the arena could never be reached: it is not built (tilesCleared stays reachable)
          if (!this.insideArena((x0 + x1) / 2, (y0 + y1) / 2)) continue;
          field.addRect(x0, y0, x1, y1, hp, row, col);
        } else {
          const dr = ((t.outer - t.inner) * R) / t.rows;
          const r0 = t.inner * R + row * dr + 1;
          const r1 = r0 + dr - 2;
          const span = TAU / t.cols;
          const pad = 1 / Math.max(r0, 1);
          const a0 = clockToAngle(0) + col * span + pad / 2;
          if (!(r1 > r0 && span - pad > 0)) continue;
          field.addSector(this.cx, this.cy, r0, r1, a0, span - pad, hp, row, col);
        }
      }
    field.build();
    this.tileCount = field.count;
    if (keepHp && keepAlive && keepHit && keepBroke && field.count === n) {
      let alive = 0;
      let left = 0;
      for (let i = 0; i < n; i++) {
        field.hp[i] = keepHp[i];
        field.alive[i] = keepAlive[i];
        field.hitMs[i] = keepHit[i];
        field.brokeMs[i] = keepBroke[i];
        if (keepAlive[i]) {
          alive++;
          left += keepHp[i];
        }
      }
      field.breaks = n - alive;
      field.aliveTotal = alive;
      field.hpLeft = left;
      field.version++;
    }
  }

  private addPeg(x: number, y: number, r: number, kick: number, of: number) {
    this.pegX.push(x);
    this.pegY.push(y);
    this.pegR.push(r);
    this.pegKick.push(kick);
    this.pegOf.push(of);
  }

  private cellX(x: number) {
    const c = Math.floor(x / CELL);
    return c < 0 ? 0 : c >= this.gridCols ? this.gridCols - 1 : c;
  }

  private cellY(y: number) {
    const c = Math.floor(y / CELL);
    return c < 0 ? 0 : c >= this.gridRows ? this.gridRows - 1 : c;
  }

  /** The static grid: pegs and bars, each in every cell its box touches. */
  private buildStaticGrid() {
    this.gridCols = Math.max(1, Math.ceil(this.width / CELL));
    this.gridRows = Math.max(1, Math.ceil(this.height / CELL));
    const cells = this.gridCols * this.gridRows;
    const boxes: [number, number, number, number, number][] = [];
    for (let i = 0; i < this.pegX.length; i++) boxes.push([this.pegX[i] - this.pegR[i], this.pegY[i] - this.pegR[i], this.pegX[i] + this.pegR[i], this.pegY[i] + this.pegR[i], (Kind.Peg << 24) | i]);
    for (let i = 0; i < this.barAx.length; i++) {
      const h = this.barHalf[i];
      boxes.push([Math.min(this.barAx[i], this.barBx[i]) - h, Math.min(this.barAy[i], this.barBy[i]) - h, Math.max(this.barAx[i], this.barBx[i]) + h, Math.max(this.barAy[i], this.barBy[i]) + h, (Kind.Bar << 24) | i]);
    }
    const counts = new Int32Array(cells + 1);
    const span = (b: [number, number, number, number, number]) => [this.cellX(b[0]), this.cellY(b[1]), this.cellX(b[2]), this.cellY(b[3])];
    for (const b of boxes) {
      const [c0, r0, c1, r1] = span(b);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * this.gridCols + c + 1]++;
    }
    for (let i = 1; i <= cells; i++) counts[i] += counts[i - 1];
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[cells]);
    const fill = Int32Array.from(counts.subarray(0, cells));
    for (const b of boxes) {
      const [c0, r0, c1, r1] = span(b);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cellItems[fill[r * this.gridCols + c]++] = b[4];
    }
    this.staticStamp = new Int32Array(this.pegX.length + this.barAx.length + 1);
  }

  /** Whether a point lies inside the arena (the rim, the box or the outer ring). */
  insideArena(x: number, y: number): boolean {
    if (this.shape === "box") return Math.abs(x - this.cx) < this.R && Math.abs(y - this.cy) < this.R;
    return Math.hypot(x - this.cx, y - this.cy) < this.R;
  }

  /** A point of the arena in arena units → px. */
  point(ux: number, uy: number): [number, number] {
    return [this.cx + ux * this.R, this.cy + uy * this.R];
  }

  /* ------------------------------------------------------------------ the balls */

  /** Adds a ball to the engine (through `ctx`) and to the world. The engine ball's gravity is off: the world applies the spec's. */
  addBall(ctx: ModeContext, nb: NewWorldBall): WorldBall {
    const engineBalls = ctx.getBalls();
    const fresh: NewBall = { x: nb.x, y: nb.y, vx: nb.vx, vy: nb.vy, radius: nb.r, color: this.bp.look.palette[nb.color] ?? "#ffffff", gravityScale: 0, team: nb.team };
    ctx.addBall(fresh);
    const ball = ctx.getBalls()[ctx.getBalls().length - 1] ?? engineBalls[engineBalls.length - 1];
    const wb = new WorldBall(ball, nb, this.bp.look.palette);
    wb.pd = Math.hypot(nb.x - this.cx, nb.y - this.cy);
    this.balls.push(wb);
    this.byId.set(wb.id, wb);
    return wb;
  }

  /** Adopts a ball the engine made itself (a split of the "split" ball interaction) with `parent`'s slots. */
  adopt(ball: Ball, parent: WorldBall): WorldBall {
    ball.gravityScale = 0;
    const wb = new WorldBall(ball, { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, r: ball.radius, gs: parent.gs, pass: parent.pass, body: parent.body, tier: parent.tier, team: parent.team, hp: parent.hp, color: parent.color }, this.bp.look.palette);
    this.balls.push(wb);
    this.byId.set(wb.id, wb);
    return wb;
  }

  aliveCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  get tilesAlive(): number {
    return this.tiles.aliveTotal;
  }

  ringsAlive(): number {
    let n = 0;
    for (const a of this.ringAlive) if (a) n++;
    return n;
  }

  /** Takes `amount` HP off a tile: true when this broke it. */
  damageTile(i: number, amount: number): boolean {
    return this.tiles.damage(i, amount);
  }

  /**
   * Drops the balls that are no longer alive from the world and from the engine (creation order kept). An escaped ball
   * stays in the engine as a ghost: it flies on out of the frame and fades (`lifetime`), touching nothing. Any other ball the
   * engine holds that the world does not know (its default first ball) goes too: the Blueprint places every ball itself.
   */
  sweep(ctx: ModeContext) {
    let dead = false;
    for (const b of this.balls)
      if (!b.alive) {
        dead = true;
        break;
      }
    const engineBalls = ctx.getBalls();
    let foreign = false;
    if (!dead) {
      if (engineBalls.length === this.balls.length) return;
      for (const ball of engineBalls)
        if (!this.byId.has(ball.id) && ball.lifetime === undefined) {
          foreign = true;
          break;
        }
      if (!foreign) return;
    }
    if (dead) {
      for (const b of this.balls)
        if (!b.alive) {
          this.byId.delete(b.id);
          if (b.escaped) b.ball.lifetime = ESCAPE_GHOST_MS;
        }
      this.balls = this.balls.filter((b) => b.alive);
    }
    let w = 0;
    for (let i = 0; i < engineBalls.length; i++) {
      const ball = engineBalls[i];
      if (this.byId.has(ball.id) || ball.lifetime !== undefined) engineBalls[w++] = ball;
    }
    engineBalls.length = w;
  }

  /** The rim, the rings' gaps and the spinners turn by one step (`sec`). */
  advance(sec: number) {
    this.rimAngle += this.rimSpin * sec;
    if (Math.abs(this.rimAngle) > TAU) this.rimAngle %= TAU;
    for (let k = 0; k < this.ringSpin.length; k++) {
      this.ringGapAt[k] += this.ringSpin[k] * sec;
      if (Math.abs(this.ringGapAt[k]) > TAU) this.ringGapAt[k] %= TAU;
    }
    for (let k = 0; k < this.spinAngle.length; k++) {
      this.spinAngle[k] += this.spinOmega[k] * sec;
      if (Math.abs(this.spinAngle[k]) > TAU) this.spinAngle[k] %= TAU;
    }
  }

  /**
   * One ball's sub-step, right after the engine moved it by its velocity × `h`: a non-finite ball is taken out; tiles, pegs,
   * bars and spinners, then the arena; last the spec's gravity.
   */
  ballStep(b: WorldBall, h: number, events: WorldEvents) {
    if (!b.alive) return;
    const ball = b.ball;
    if (!(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.vx) && Number.isFinite(ball.vy) && Number.isFinite(ball.radius))) {
      b.alive = false;
      this.nanBalls++;
      return;
    }
    // where it was when the sub-step began (the engine has just moved it): the ring pass judges by it
    b.pd = Math.hypot(ball.x - ball.vx * h - this.cx, ball.y - ball.vy * h - this.cy);
    if (this.tiles.aliveTotal > 0) this.collideTiles(b, h, events);
    if (!b.alive) return;
    this.collideStatic(b, events);
    if (b.alive) this.collideArena(b, events);
    if (b.alive && b.gs !== 0) {
      ball.vx += this.gx * b.gs * h;
      ball.vy += this.gy * b.gs * h;
    }
  }

  /* ------------------------------------------------------------------ contacts */

  /** The restitution of a rebound off the arena or an obstacle: the spec's, × the wall bounciness extra, × the ball's bounce-math bounciness. */
  private bounceOf(b: WorldBall): number {
    const own = b.ball.restitution;
    return this.restitution * this.wallBounciness * (own !== undefined && own > 0 ? own : own !== undefined ? 0 : 1);
  }

  /**
   * Resolves a contact along the unit normal (nx, ny) – pointing from the surface to the ball – with `pen` px of overlap and
   * the surface moving at (sx, sy): the ball is pushed out and, when it approaches, reflected with `e`. The approach speed.
   */
  private resolve(b: WorldBall, nx: number, ny: number, pen: number, e: number, sx = 0, sy = 0): number {
    const ball = b.ball;
    ball.x += nx * pen;
    ball.y += ny * pen;
    const rvx = ball.vx - sx;
    const rvy = ball.vy - sy;
    this.lastSpeed = Math.hypot(rvx, rvy);
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    ball.vx -= (1 + e) * vn * nx;
    ball.vy -= (1 + e) * vn * ny;
    return -vn;
  }

  /** A contact with a point (an exit's or a gap's edge): a tiny round wall. */
  private hitPoint(b: WorldBall, px: number, py: number, events: WorldEvents): boolean {
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const reach = b.r + WALL_HALF;
    if (d >= reach || d === 0) return false;
    const impact = this.resolve(b, dx / d, dy / d, reach - d, this.bounceOf(b));
    this.reportWall(b, impact, events);
    return true;
  }

  private reportWall(b: WorldBall, impact: number, events: WorldEvents) {
    if (isHit(impact, this.lastSpeed) && b.lastWall !== this.step) {
      b.lastWall = this.step;
      events.wallHit(b, impact);
    }
  }

  /**
   * Tiles: TileField sweeps the ball's move and rebounds it off the first tile it meets (with the arena's restitution: the
   * field's cap is lifted through the bounciness factor, so a glass shell never slows a ball down). Every contact that is a
   * hit chips 1 HP; a piercing ball that breaks the first tile it meets flies on as if the tile had not been there.
   */
  private collideTiles(b: WorldBall, h: number, events: WorldEvents) {
    const ball = b.ball;
    const field = this.tiles;
    const sx = ball.x;
    const sy = ball.y;
    const svx = ball.vx;
    const svy = ball.vy;
    const speed = Math.hypot(svx, svy);
    const e = this.bounceOf(b);
    // rebound() caps a restitution at 0.98 (MAX_OBSTACLE_RESTITUTION); the ball's factor carries the rest, exactly
    const first = field.collide(ball, h, 0.98, 0, e / 0.98);
    this.work++;
    if (first < 0) return;
    const contacts = field.contactCount;
    for (let k = 0; k < contacts; k++) {
      const tile = field.contactTile[k];
      const impact = field.contactImpact[k];
      if (!isHit(impact, speed)) continue;
      const broke = field.damage(tile, 1);
      events.tileHit(b, tile, broke, impact);
      if (!b.alive) return;
      if (k === 0 && broke && this.tilePierce) {
        ball.x = sx;
        ball.y = sy;
        ball.vx = svx;
        ball.vy = svy;
        return;
      }
    }
  }

  private collideArena(b: WorldBall, events: WorldEvents) {
    const R = this.R;
    if (this.shape === "box") {
      const e = this.bounceOf(b);
      let impact = 0;
      if (b.x - b.r < this.cx - R) impact = Math.max(impact, this.resolve(b, 1, 0, this.cx - R - (b.x - b.r), e));
      if (b.x + b.r > this.cx + R) impact = Math.max(impact, this.resolve(b, -1, 0, b.x + b.r - (this.cx + R), e));
      if (b.y - b.r < this.cy - R) impact = Math.max(impact, this.resolve(b, 0, 1, this.cy - R - (b.y - b.r), e));
      if (b.y + b.r > this.cy + R) impact = Math.max(impact, this.resolve(b, 0, -1, b.y + b.r - (this.cy + R), e));
      // (a ball bigger than the box sits in its middle)
      if (b.r >= R) {
        b.x = this.cx;
        b.y = this.cy;
      }
      this.reportWall(b, impact, events);
      return;
    }
    const dx = b.x - this.cx;
    const dy = b.y - this.cy;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    if (this.shape === "rings") {
      for (let k = 0; k < this.ringR.length; k++) {
        if (!this.ringAlive[k]) continue;
        const rk = this.ringR[k];
        // passed outward through the gap this sub-step (a breaking ring is gone for every ball at once)
        if (b.pd < rk && d >= rk) {
          if (this.ringBreak) {
            this.ringAlive[k] = false;
            this.ringBrokeAt[k] = this.timeSec;
          }
          events.ringPass(b, k);
          if (!this.ringAlive[k]) continue;
        }
        if (Math.abs(d - rk) >= b.r + WALL_HALF) continue;
        const half = this.ringGapHalf;
        const off = Math.abs(angleDiff(ang, this.ringGapAt[k]));
        const angular = b.r / Math.max(rk, 1);
        if (off <= half - angular) continue; // inside the gap
        if (off < half + angular) {
          // at the gap's edges
          for (let side = -1; side <= 1; side += 2) {
            const ea = this.ringGapAt[k] + side * half;
            this.hitPoint(b, this.cx + rk * Math.cos(ea), this.cy + rk * Math.sin(ea), events);
          }
          if (off <= half) continue; // (the centre is in the gap: only the edges)
        }
        const inside = d < rk;
        const ux = d > 0 ? dx / d : 1;
        const uy = d > 0 ? dy / d : 0;
        const pen = inside ? d + b.r + WALL_HALF - rk : rk + WALL_HALF + b.r - d;
        const impact = this.resolve(b, inside ? -ux : ux, inside ? -uy : uy, pen, this.bounceOf(b));
        this.reportWall(b, impact, events);
      }
      if (d - b.r > R + WALL_HALF) this.escapeBall(b, events);
      return;
    }
    // circle
    if (d + b.r <= R - WALL_HALF) return;
    const exit = this.exitAround(ang, b.r / Math.max(d, 1));
    if (exit === "through") {
      if (d - b.r > R + WALL_HALF) this.escapeBall(b, events);
      return;
    }
    if (exit >= 0) {
      const a0 = this.exitAt[exit] + this.rimAngle;
      for (let side = -1; side <= 1; side += 2) {
        const ea = a0 + side * this.exitHalf[exit];
        this.hitPoint(b, this.cx + R * Math.cos(ea), this.cy + R * Math.sin(ea), events);
      }
      const nd = Math.hypot(b.x - this.cx, b.y - this.cy);
      if (nd - b.r > R + WALL_HALF) {
        this.escapeBall(b, events);
        return;
      }
      // the centre in the exit's span: only its edges; else the rim beside the exit holds it too
      if (Math.abs(angleDiff(Math.atan2(b.y - this.cy, b.x - this.cx), a0)) <= this.exitHalf[exit] || nd + b.r <= R - WALL_HALF) return;
    }
    this.holdInRim(b, events);
  }

  /** The rim holds a ball: pushed back inside and reflected (a ball bigger than the arena sits in its middle). */
  private holdInRim(b: WorldBall, events: WorldEvents) {
    const R = this.R;
    const dx = b.x - this.cx;
    const dy = b.y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d + b.r <= R - WALL_HALF) return;
    if (b.r >= R) {
      b.x = this.cx;
      b.y = this.cy;
      return;
    }
    const ux = d > 0 ? dx / d : 1;
    const uy = d > 0 ? dy / d : 0;
    const impact = this.resolve(b, -ux, -uy, d + b.r + WALL_HALF - R, this.bounceOf(b));
    this.reportWall(b, impact, events);
  }

  /** "through" when a ball at angle `ang` (angular half-size `angular`) fits through an exit, an exit's index at its edges, −1 at the rim. */
  private exitAround(ang: number, angular: number): "through" | number {
    for (let i = 0; i < this.exitAt.length; i++) {
      const off = Math.abs(angleDiff(ang, this.exitAt[i] + this.rimAngle));
      if (off <= this.exitHalf[i] - angular) return "through";
      if (off < this.exitHalf[i] + angular) return i;
    }
    return -1;
  }

  private escapeBall(b: WorldBall, events: WorldEvents) {
    if (!b.alive) return;
    b.alive = false;
    b.escaped = true;
    events.escape(b);
  }

  private collideStatic(b: WorldBall, events: WorldEvents) {
    // spinners: few, turning – tested directly
    for (let k = 0; k < this.spinX.length; k++) {
      const c = Math.cos(this.spinAngle[k]) * this.spinLen[k];
      const s = Math.sin(this.spinAngle[k]) * this.spinLen[k];
      this.hitSegment(b, this.spinX[k] - c, this.spinY[k] - s, this.spinX[k] + c, this.spinY[k] + s, this.spinHalf[k], this.spinOf[k], events, k);
    }
    if (this.cellItems.length === 0) return;
    const serial = ++this.stampSerial;
    const c0 = this.cellX(b.x - b.r);
    const c1 = this.cellX(b.x + b.r);
    const r0 = this.cellY(b.y - b.r);
    const r1 = this.cellY(b.y + b.r);
    const pegs = this.pegX.length;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.gridCols + c;
        for (let q = this.cellStart[cell]; q < this.cellStart[cell + 1]; q++) {
          const item = this.cellItems[q];
          const kind = item >>> 24;
          const i = item & 0xffffff;
          const slot = kind === Kind.Peg ? i : pegs + i;
          if (this.staticStamp[slot] === serial) continue;
          this.staticStamp[slot] = serial;
          this.work++;
          if (kind === Kind.Peg) this.hitPeg(b, i, events);
          else this.hitSegment(b, this.barAx[i], this.barAy[i], this.barBx[i], this.barBy[i], this.barHalf[i], this.barOf[i], events, -1);
          if (!b.alive) return;
        }
      }
  }

  private hitPeg(b: WorldBall, i: number, events: WorldEvents) {
    const dx = b.x - this.pegX[i];
    const dy = b.y - this.pegY[i];
    const d = Math.hypot(dx, dy);
    const reach = b.r + this.pegR[i];
    if (d >= reach) return;
    const nx = d > 0 ? dx / d : 0;
    const ny = d > 0 ? dy / d : -1;
    const impact = this.resolve(b, nx, ny, reach - d, this.bounceOf(b));
    if (this.pegKick[i] !== 0 && impact > 0) {
      b.vx += nx * this.pegKick[i];
      b.vy += ny * this.pegKick[i];
    }
    if (isHit(impact, this.lastSpeed)) {
      this.pegHitAt[i] = this.timeSec;
      events.obstacleHit(b, this.pegOf[i], impact);
    }
  }

  private hitSegment(b: WorldBall, ax: number, ay: number, bx: number, by: number, half: number, of: number, events: WorldEvents, spinner: number) {
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((b.x - ax) * ex + (b.y - ay) * ey) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t;
    const qy = ay + ey * t;
    const dx = b.x - qx;
    const dy = b.y - qy;
    const d = Math.hypot(dx, dy);
    const reach = b.r + half;
    if (d >= reach) return;
    let nx = d > 0 ? dx / d : -ey;
    let ny = d > 0 ? dy / d : ex;
    if (d === 0) {
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
    }
    let sx = 0;
    let sy = 0;
    if (spinner >= 0) {
      // the surface moves: ω × (contact − pivot)
      const w = this.spinOmega[spinner];
      sx = -w * (qy - this.spinY[spinner]);
      sy = w * (qx - this.spinX[spinner]);
    }
    const impact = this.resolve(b, nx, ny, reach - d, this.bounceOf(b), sx, sy);
    if (isHit(impact, this.lastSpeed)) events.obstacleHit(b, of, impact);
  }

  /** Ball pairs: a grid rebuilt each sub-step; each touching pair bounces (unless one passes) and is reported once a step. */
  collidePairs(events: WorldEvents) {
    const balls = this.balls;
    const n = balls.length;
    if (n < 2) return;
    const cols = this.gridCols;
    const cells = cols * this.gridRows;
    if (this.pairCount.length < cells + 1) {
      this.pairCount = new Int32Array(cells + 1);
      this.pairStart = new Int32Array(cells + 1);
    }
    if (this.pairSeen.length < n) this.pairSeen = new Int32Array(Math.max(n, 64));
    const count = this.pairCount;
    count.fill(0);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      if (!b.alive) continue;
      const c0 = this.cellX(b.x - b.r);
      const c1 = this.cellX(b.x + b.r);
      const r0 = this.cellY(b.y - b.r);
      const r1 = this.cellY(b.y + b.r);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * cols + c]++;
      total += (c1 - c0 + 1) * (r1 - r0 + 1);
    }
    if (this.pairItems.length < total) this.pairItems = new Int32Array(Math.max(total, this.pairItems.length * 2));
    const start = this.pairStart;
    let acc = 0;
    for (let c = 0; c < cells; c++) {
      start[c] = acc;
      acc += count[c];
      count[c] = start[c];
    }
    start[cells] = acc;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      if (!b.alive) continue;
      const c0 = this.cellX(b.x - b.r);
      const c1 = this.cellX(b.x + b.r);
      const r0 = this.cellY(b.y - b.r);
      const r1 = this.cellY(b.y + b.r);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.pairItems[count[r * cols + c]++] = i;
    }
    const seen = this.pairSeen;
    seen.fill(-1, 0, n);
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      if (!a.alive) continue;
      const c0 = this.cellX(a.x - a.r);
      const c1 = this.cellX(a.x + a.r);
      const r0 = this.cellY(a.y - a.r);
      const r1 = this.cellY(a.y + a.r);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const cell = r * cols + c;
          for (let q = start[cell]; q < start[cell + 1]; q++) {
            const j = this.pairItems[q];
            if (j <= i || seen[j] === i) continue;
            seen[j] = i;
            const b = balls[j];
            if (!b.alive) continue;
            this.work++;
            this.touch(a, b, events);
            if (!a.alive) break;
          }
        }
    }
  }

  /** A new step: the pairs reported this step are forgotten. */
  beginStep(step: number, timeSec: number) {
    this.step = step;
    this.timeSec = timeSec;
    this.pairKeys.clear();
  }

  private touch(a: WorldBall, b: WorldBall, events: WorldEvents) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const reach = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) return;
    const d = Math.sqrt(d2);
    // coincident balls part along a fixed direction (the later ball to the right): no randomness, no NaN
    const nx = d > 0 ? dx / d : 1;
    const ny = d > 0 ? dy / d : 0;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (!a.pass && !b.pass) {
      const ma = a.r * a.r;
      const mb = b.r * b.r;
      const pen = reach - d;
      const fa = mb / (ma + mb);
      const fb = ma / (ma + mb);
      a.x -= nx * pen * fa;
      a.y -= ny * pen * fa;
      b.x += nx * pen * fb;
      b.y += ny * pen * fb;
      if (vn < 0) {
        const jn = (-(1 + this.restitution) * vn) / (1 / ma + 1 / mb);
        a.vx -= (jn / ma) * nx;
        a.vy -= (jn / ma) * ny;
        b.vx += (jn / mb) * nx;
        b.vy += (jn / mb) * ny;
      }
    }
    const lo = a.id < b.id ? a.id : b.id;
    const hi = a.id < b.id ? b.id : a.id;
    const key = lo * 1_048_576 + hi;
    if (this.pairKeys.has(key)) return;
    this.pairKeys.add(key);
    events.ballHit(a, b, vn < 0 ? -vn : 0);
  }
}
