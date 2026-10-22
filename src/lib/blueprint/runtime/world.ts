/*
 * --- blueprint --- The physics of a Blueprint run: one deterministic world (fixed 60 Hz steps of at least 4 sub-steps, like
 * the engine's) with the arena – a circle with exits, a box, or concentric rings with gaps –, obstacles, a field of
 * destructible tiles and full-physics balls that bounce off each other. It knows nothing of rules: it moves the balls,
 * resolves every contact and reports what happened (a wall hit, a tile broken, an escape…) to the interpreter
 * (runtime/run.ts), which decides what it means.
 *
 * Determinism: no clock and no randomness of its own (the interpreter hands it nothing random either – positions come
 * from the spec and the seeded draws the interpreter makes); balls are kept in creation order and every loop walks them in
 * it. Work: a static grid holds the tiles, pegs and bars; a grid rebuilt each sub-step finds the ball pairs; both stop at
 * the sandbox's ceilings (lib/uncap.ts BLUEPRINT_CEILINGS), so a step's work is bounded whatever the spec says.
 *
 * Geometry: the world is WORLD_SIDE (450 px) square, the arena centred in it with a radius of `size` × 225 px. Spec
 * positions are arena units (−1…1, 1 = the rim); clock degrees (0 = top, clockwise) become screen angles (0 = right,
 * clockwise, y down) here.
 */
import { WORLD_SIDE } from "@/lib/simulation/world";
import { BLUEPRINT_MAX_SUBSTEPS } from "../limits";
import type { Blueprint } from "../schema";

export const FIXED_STEP_SEC = 1 / 60;
const MIN_SUBSTEPS = 4;
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
const WALL_HALF = 2;
/** The static grid's and the pair grid's cell (px). */
const CELL = 32;
const TAU = Math.PI * 2;

/** A ball of the world: its physics and the Blueprint's slots (body index, tier, team, HP, palette colour). */
export interface WorldBall {
  id: number;
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
  /** False once it escaped, popped or was removed (the step sweeps it out). */
  alive: boolean;
  /** Distance from the centre at the start of the sub-step (ring passes). */
  pd: number;
  /** The step of its last wall hit (one wall hit a step). */
  lastWall: number;
}

/** What the world reports while it steps (the interpreter queues these as events). */
export interface WorldEvents {
  wallHit(ball: WorldBall, impact: number): void;
  obstacleHit(ball: WorldBall, obstacle: number, impact: number): void;
  tileHit(ball: WorldBall, tile: number, broke: boolean, impact: number): void;
  ballHit(a: WorldBall, b: WorldBall, impact: number): void;
  ringPass(ball: WorldBall, ring: number): void;
  escape(ball: WorldBall): void;
}

export interface NewWorldBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  gs: number;
  pass: boolean;
  body: number;
  tier: number;
  team: number;
  hp: number;
  color: number;
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
  Tile = 2,
}

export class BlueprintWorld {
  readonly width = WORLD_SIDE;
  readonly height = WORLD_SIDE;
  readonly cx = WORLD_SIDE / 2;
  readonly cy = WORLD_SIDE / 2;
  readonly R: number;
  readonly shape: Blueprint["arena"]["shape"];
  readonly restitution: number;
  readonly gx: number;
  readonly gy: number;

  /* the rim's exits (circle): centre angle at rotation 0 and half width, radians */
  private readonly exitAt: number[] = [];
  private readonly exitHalf: number[] = [];
  private readonly rimSpin: number;
  rimAngle = 0;

  /* rings */
  readonly ringR: number[] = [];
  readonly ringAlive: boolean[] = [];
  readonly ringGapAt: number[] = [];
  readonly ringSpin: number[] = [];
  readonly ringGapHalf: number = 0;
  /** A ring breaks when a ball passes outward through its gap. */
  readonly ringBreak: boolean = false;

  /* pegs and bumpers */
  readonly pegX: number[] = [];
  readonly pegY: number[] = [];
  readonly pegR: number[] = [];
  readonly pegKick: number[] = [];
  /** The spec's obstacle pattern each peg came from (obstacleHit reports the pattern's index). */
  readonly pegOf: number[] = [];
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

  /* tiles: rect (x0,y0,x1,y1) or annular sector (r0,r1,a0,a1) */
  readonly tileSector: boolean;
  readonly tileA: Float64Array;
  readonly tileB: Float64Array;
  readonly tileC: Float64Array;
  readonly tileD: Float64Array;
  readonly tileHp: Int32Array;
  readonly tileMaxHp: Int32Array;
  readonly tileRow: Int32Array;
  readonly tileCol: Int32Array;
  readonly tileX: Float64Array;
  readonly tileY: Float64Array;
  readonly tilePierce: boolean;
  tilesAlive = 0;
  readonly tileCount: number;

  /* the static grid */
  private readonly gridCols: number;
  private readonly gridRows: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly staticStamp: Int32Array;
  private stampSerial = 0;

  /* the balls */
  balls: WorldBall[] = [];
  private nextId = 1;
  step = 0;
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

  constructor(bp: Blueprint) {
    const a = bp.arena;
    this.R = (a.size * Math.min(this.width, this.height)) / 2;
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
        const f = rg.count === 1 ? 1 : rg.inner + ((1 - rg.inner) * k) / (rg.count - 1);
        this.ringR.push(this.R * f);
        this.ringAlive.push(true);
        // gaps staggered by the golden angle, so a straight line never runs through them all
        this.ringGapAt.push(clockToAngle(k * 137.508));
        const spin = (rg.spinDegPerSec * Math.PI) / 180;
        this.ringSpin.push(rg.alternate && k % 2 === 1 ? -spin : spin);
      }
    }
    // obstacles (arena units → px)
    const R = this.R;
    const px = (u: number) => this.cx + u * R;
    const py = (u: number) => this.cy + u * R;
    bp.obstacles.forEach((o, oi) => {
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
          this.spinAngle.push(clockToAngle(o.angleDeg + 90));
          this.spinOmega.push((o.spinDegPerSec * Math.PI) / 180);
          this.spinHalf.push((o.thick * R) / 2);
          this.spinOf.push(oi);
          break;
      }
    });
    // tiles
    const t = bp.tiles;
    const rects: number[][] = [];
    this.tileSector = t?.layout === "ring";
    this.tilePierce = t?.pierce ?? false;
    if (t) {
      for (let row = 0; row < t.rows; row++)
        for (let col = 0; col < t.cols; col++) {
          const hp = t.hp + row * t.hpStep;
          if (t.layout === "grid") {
            const w = (t.area.w * R) / t.cols;
            const h = (t.area.h * R) / t.rows;
            const x0 = px(t.area.x) + col * w + 1;
            const y0 = py(t.area.y) + row * h + 1;
            const x1 = x0 + w - 2;
            const y1 = y0 + h - 2;
            if (x1 <= x0 || y1 <= y0) continue;
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            // a tile outside the arena could never be reached: it is not built (tilesCleared stays reachable)
            if (!this.insideArena(mx, my)) continue;
            rects.push([x0, y0, x1, y1, hp, row, col, mx, my]);
          } else {
            const dr = ((t.outer - t.inner) * R) / t.rows;
            const r0 = t.inner * R + row * dr + 1;
            const r1 = r0 + dr - 2;
            const span = TAU / t.cols;
            const a0 = clockToAngle(0) + col * span + 0.5 / Math.max(r0, 1);
            const a1 = a0 + span - 1 / Math.max(r0, 1);
            if (r1 <= r0 || a1 <= a0) continue;
            const am = (a0 + a1) / 2;
            const rm = (r0 + r1) / 2;
            rects.push([r0, r1, a0, a1, hp, row, col, this.cx + rm * Math.cos(am), this.cy + rm * Math.sin(am)]);
          }
        }
    }
    const n = rects.length;
    this.tileCount = n;
    this.tileA = new Float64Array(n);
    this.tileB = new Float64Array(n);
    this.tileC = new Float64Array(n);
    this.tileD = new Float64Array(n);
    this.tileHp = new Int32Array(n);
    this.tileMaxHp = new Int32Array(n);
    this.tileRow = new Int32Array(n);
    this.tileCol = new Int32Array(n);
    this.tileX = new Float64Array(n);
    this.tileY = new Float64Array(n);
    rects.forEach((q, i) => {
      [this.tileA[i], this.tileB[i], this.tileC[i], this.tileD[i]] = q;
      this.tileHp[i] = this.tileMaxHp[i] = Math.min(q[4], 0x7fffffff);
      this.tileRow[i] = q[5];
      this.tileCol[i] = q[6];
      this.tileX[i] = q[7];
      this.tileY[i] = q[8];
    });
    this.tilesAlive = n;
    // the static grid: pegs, bars and tiles, each in every cell its box touches
    this.gridCols = Math.ceil(this.width / CELL);
    this.gridRows = Math.ceil(this.height / CELL);
    const cells = this.gridCols * this.gridRows;
    const boxes: [number, number, number, number, number][] = [];
    for (let i = 0; i < this.pegX.length; i++) boxes.push([this.pegX[i] - this.pegR[i], this.pegY[i] - this.pegR[i], this.pegX[i] + this.pegR[i], this.pegY[i] + this.pegR[i], (Kind.Peg << 24) | i]);
    for (let i = 0; i < this.barAx.length; i++) {
      const h = this.barHalf[i];
      boxes.push([Math.min(this.barAx[i], this.barBx[i]) - h, Math.min(this.barAy[i], this.barBy[i]) - h, Math.max(this.barAx[i], this.barBx[i]) + h, Math.max(this.barAy[i], this.barBy[i]) + h, (Kind.Bar << 24) | i]);
    }
    for (let i = 0; i < n; i++) boxes.push([...this.tileBox(i), (Kind.Tile << 24) | i]);
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
    this.staticStamp = new Int32Array(this.pegX.length + this.barAx.length + n + 1);
  }

  private addPeg(x: number, y: number, r: number, kick: number, of: number) {
    this.pegX.push(x);
    this.pegY.push(y);
    this.pegR.push(r);
    this.pegKick.push(kick);
    this.pegOf.push(of);
  }

  private cellX(x: number) {
    return Math.max(0, Math.min(this.gridCols - 1, Math.floor(x / CELL)));
  }

  private cellY(y: number) {
    return Math.max(0, Math.min(this.gridRows - 1, Math.floor(y / CELL)));
  }

  private tileBox(i: number): [number, number, number, number] {
    if (!this.tileSector) return [this.tileA[i], this.tileB[i], this.tileC[i], this.tileD[i]];
    const r0 = this.tileA[i];
    const r1 = this.tileB[i];
    const a0 = this.tileC[i];
    const a1 = this.tileD[i];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k <= 32; k++) {
      const a = a0 + ((a1 - a0) * k) / 32;
      for (const rr of [r0, r1]) {
        const x = this.cx + rr * Math.cos(a);
        const y = this.cy + rr * Math.sin(a);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return [x0 - 2, y0 - 2, x1 + 2, y1 + 2];
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

  addBall(b: NewWorldBall): WorldBall {
    const ball: WorldBall = { id: this.nextId++, ...b, alive: true, pd: Math.hypot(b.x - this.cx, b.y - this.cy), lastWall: -1 };
    this.balls.push(ball);
    return ball;
  }

  aliveCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  ringsAlive(): number {
    let n = 0;
    for (const a of this.ringAlive) if (a) n++;
    return n;
  }

  /** Takes `amount` HP off a tile: true when this broke it. */
  damageTile(i: number, amount: number): boolean {
    if (i < 0 || i >= this.tileCount || this.tileHp[i] <= 0 || !(amount > 0)) return false;
    const left = this.tileHp[i] - amount;
    this.tileHp[i] = left > 0 ? Math.ceil(left) : 0;
    if (this.tileHp[i] > 0) return false;
    this.tilesAlive--;
    return true;
  }

  /** Drops the balls that are no longer alive (creation order kept). */
  sweep() {
    if (this.balls.every((b) => b.alive)) return;
    this.balls = this.balls.filter((b) => b.alive);
  }

  /** The sub-steps a step needs: one sub-step moves no ball more than half the smallest radius (4 to BLUEPRINT_MAX_SUBSTEPS). */
  private substeps(dt: number): number {
    let vmax = 0;
    let rmin = Infinity;
    for (const b of this.balls) {
      if (!b.alive) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v > vmax || !Number.isFinite(v)) vmax = v;
      if (b.r < rmin) rmin = b.r;
    }
    if (!Number.isFinite(vmax)) return BLUEPRINT_MAX_SUBSTEPS;
    const need = Math.ceil((vmax * dt) / Math.max(0.5, 0.5 * Math.min(rmin, 1e9)));
    return Math.max(MIN_SUBSTEPS, Math.min(BLUEPRINT_MAX_SUBSTEPS, need));
  }

  /** One fixed step: every sub-step moves, collides and reports. */
  advance(dt: number, events: WorldEvents) {
    this.step++;
    this.pairKeys.clear();
    const n = this.substeps(dt);
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      this.rimAngle += this.rimSpin * h;
      for (let k = 0; k < this.ringSpin.length; k++) this.ringGapAt[k] += this.ringSpin[k] * h;
      for (let k = 0; k < this.spinAngle.length; k++) this.spinAngle[k] += this.spinOmega[k] * h;
      for (const b of this.balls) {
        if (!b.alive) continue;
        b.pd = Math.hypot(b.x - this.cx, b.y - this.cy);
        b.vx += this.gx * b.gs * h;
        b.vy += this.gy * b.gs * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy) && Number.isFinite(b.r))) {
          b.alive = false;
          this.nanBalls++;
          continue;
        }
        this.collideStatic(b, events);
        if (b.alive) this.collideArena(b, events);
      }
      this.collidePairs(events);
    }
  }

  /* ------------------------------------------------------------------ contacts */

  /**
   * Resolves a contact along the unit normal (nx, ny) – pointing from the surface to the ball – with `pen` px of overlap and
   * the surface moving at (sx, sy): the ball is pushed out and, when it approaches, reflected with `e`. The approach speed.
   */
  private resolve(b: WorldBall, nx: number, ny: number, pen: number, e: number, sx = 0, sy = 0): number {
    b.x += nx * pen;
    b.y += ny * pen;
    const rvx = b.vx - sx;
    const rvy = b.vy - sy;
    this.lastSpeed = Math.hypot(rvx, rvy);
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    return -vn;
  }

  /** A contact with a point (an exit's or a gap's edge): a tiny round wall. */
  private hitPoint(b: WorldBall, px: number, py: number, events: WorldEvents): boolean {
    const dx = b.x - px;
    const dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const reach = b.r + WALL_HALF;
    if (d >= reach || d === 0) return false;
    const impact = this.resolve(b, dx / d, dy / d, reach - d, this.restitution);
    this.reportWall(b, impact, events);
    return true;
  }

  private reportWall(b: WorldBall, impact: number, events: WorldEvents) {
    if (isHit(impact, this.lastSpeed) && b.lastWall !== this.step) {
      b.lastWall = this.step;
      events.wallHit(b, impact);
    }
  }

  private collideArena(b: WorldBall, events: WorldEvents) {
    const R = this.R;
    if (this.shape === "box") {
      const e = this.restitution;
      let impact = 0;
      if (b.x - b.r < this.cx - R) impact = Math.max(impact, this.resolve(b, 1, 0, this.cx - R - (b.x - b.r), e));
      if (b.x + b.r > this.cx + R) impact = Math.max(impact, this.resolve(b, -1, 0, b.x + b.r - (this.cx + R), e));
      if (b.y - b.r < this.cy - R) impact = Math.max(impact, this.resolve(b, 0, 1, this.cy - R - (b.y - b.r), e));
      if (b.y + b.r > this.cy + R) impact = Math.max(impact, this.resolve(b, 0, -1, b.y + b.r - (this.cy + R), e));
      // (a ball bigger than the box sits in its middle)
      if (2 * b.r >= 2 * R) {
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
          if (this.ringBreak) this.ringAlive[k] = false;
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
          for (const side of [-1, 1]) {
            const ea = this.ringGapAt[k] + side * half;
            this.hitPoint(b, this.cx + rk * Math.cos(ea), this.cy + rk * Math.sin(ea), events);
          }
          if (off <= half) continue; // (the centre is in the gap: only the edges)
        }
        const inside = d < rk;
        const ux = d > 0 ? dx / d : 1;
        const uy = d > 0 ? dy / d : 0;
        const pen = inside ? d + b.r + WALL_HALF - rk : rk + WALL_HALF + b.r - d;
        const impact = this.resolve(b, inside ? -ux : ux, inside ? -uy : uy, pen, this.restitution);
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
      for (const side of [-1, 1]) {
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
    const impact = this.resolve(b, -ux, -uy, d + b.r + WALL_HALF - R, this.restitution);
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
    const bars = this.barAx.length;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.gridCols + c;
        for (let q = this.cellStart[cell]; q < this.cellStart[cell + 1]; q++) {
          const item = this.cellItems[q];
          const kind = item >>> 24;
          const i = item & 0xffffff;
          const slot = kind === Kind.Peg ? i : kind === Kind.Bar ? pegs + i : pegs + bars + i;
          if (this.staticStamp[slot] === serial) continue;
          this.staticStamp[slot] = serial;
          this.work++;
          if (kind === Kind.Peg) this.hitPeg(b, i, events);
          else if (kind === Kind.Bar) this.hitSegment(b, this.barAx[i], this.barAy[i], this.barBx[i], this.barBy[i], this.barHalf[i], this.barOf[i], events, -1);
          else if (this.tileHp[i] > 0) this.hitTile(b, i, events);
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
    const impact = this.resolve(b, nx, ny, reach - d, this.restitution);
    if (this.pegKick[i] !== 0 && impact > 0) {
      b.vx += nx * this.pegKick[i];
      b.vy += ny * this.pegKick[i];
    }
    if (isHit(impact, this.lastSpeed)) events.obstacleHit(b, this.pegOf[i], impact);
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
    const impact = this.resolve(b, nx, ny, reach - d, this.restitution, sx, sy);
    if (isHit(impact, this.lastSpeed)) events.obstacleHit(b, of, impact);
  }

  /** The closest point of tile i's outline to (x, y) and whether (x, y) is inside the tile. */
  private tileClosest(i: number, x: number, y: number): [number, number, boolean] {
    if (!this.tileSector) {
      const x0 = this.tileA[i];
      const y0 = this.tileB[i];
      const x1 = this.tileC[i];
      const y1 = this.tileD[i];
      const inside = x > x0 && x < x1 && y > y0 && y < y1;
      if (!inside) return [x < x0 ? x0 : x > x1 ? x1 : x, y < y0 ? y0 : y > y1 ? y1 : y, false];
      // inside: the nearest face
      const dl = x - x0;
      const dr = x1 - x;
      const dt = y - y0;
      const db = y1 - y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) return [x0, y, true];
      if (m === dr) return [x1, y, true];
      if (m === dt) return [x, y0, true];
      return [x, y1, true];
    }
    const r0 = this.tileA[i];
    const r1 = this.tileB[i];
    const a0 = this.tileC[i];
    const a1 = this.tileD[i];
    const dx = x - this.cx;
    const dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const span = a1 - a0;
    let rel = (ang - a0) % TAU;
    if (rel < 0) rel += TAU;
    const within = rel <= span;
    const inside = within && d > r0 && d < r1;
    const candidates: [number, number][] = [];
    const arcPoint = (rr: number): [number, number] => {
      const a = within ? ang : rel - span < TAU - rel ? a1 : a0;
      return [this.cx + rr * Math.cos(a), this.cy + rr * Math.sin(a)];
    };
    candidates.push(arcPoint(r0), arcPoint(r1));
    for (const a of [a0, a1]) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      let s = dx * ux + dy * uy;
      s = s < r0 ? r0 : s > r1 ? r1 : s;
      candidates.push([this.cx + s * ux, this.cy + s * uy]);
    }
    let best = candidates[0];
    let bestD = Infinity;
    for (const c of candidates) {
      const dd = (c[0] - x) * (c[0] - x) + (c[1] - y) * (c[1] - y);
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    return [best[0], best[1], inside];
  }

  private hitTile(b: WorldBall, i: number, events: WorldEvents) {
    const [qx, qy, inside] = this.tileClosest(i, b.x, b.y);
    let dx = b.x - qx;
    let dy = b.y - qy;
    let d = Math.hypot(dx, dy);
    if (!inside && d >= b.r) return;
    if (inside) {
      // the centre is inside: out through the nearest face
      dx = -dx;
      dy = -dy;
    }
    if (d === 0) {
      dx = b.x - this.tileX[i];
      dy = b.y - this.tileY[i];
      d = Math.hypot(dx, dy) || 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const pen = inside ? b.r + d : b.r - d;
    // approach speed first: a touch or a graze chips nothing
    const vn = b.vx * nx + b.vy * ny;
    if (!isHit(-vn, Math.hypot(b.vx, b.vy))) {
      b.x += nx * pen;
      b.y += ny * pen;
      if (vn < 0) {
        b.vx -= (1 + this.restitution) * vn * nx;
        b.vy -= (1 + this.restitution) * vn * ny;
      }
      return;
    }
    const broke = this.damageTile(i, 1);
    if (!(broke && this.tilePierce)) this.resolve(b, nx, ny, pen, this.restitution);
    events.tileHit(b, i, broke, -vn);
  }

  /** Ball pairs: a grid rebuilt each sub-step; each touching pair bounces (unless one passes) and is reported once a step. */
  private collidePairs(events: WorldEvents) {
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
          }
        }
    }
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
