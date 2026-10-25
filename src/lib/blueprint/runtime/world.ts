/*
 * --- blueprint --- The physics of a Blueprint run inside the engine: the arena – a circle with exits, a box, or concentric
 * rings with gaps –, obstacles, a field of destructible tiles (lib/physics/tiles.ts TileField) and full-physics balls that
 * bounce off each other. The balls are the engine's own (they move, trail, draw, record and take bounce math like every
 * mode's); the world keeps each one's Blueprint slots (`WorldBall`: body, tier, team, hit points, palette colour) and
 * resolves everything the engine leaves to a mode that owns its playfield (box.ts, mergeRing.ts do the same):
 *
 *  - `ballStep()` (the mode's onBallStep, right after the engine moved the ball): tiles first – TileField sweeps the move, so
 *    nothing tunnels, within the step's share of BLUEPRINT_TILE_TESTS_PER_STEP (past it the sweep is skipped and counted:
 *    `droppedTiles`) –, then pegs, bars and spinners, then the arena (rim, exits, box walls, rings, escapes), then the spec's
 *    gravity (the engine's is off for these balls: gravityScale 0). A ball whose numbers are not ones the world can move –
 *    not finite, or past BLUEPRINT_SPEED_CEILING – is taken out (counted) before its contacts and again after them, so a
 *    restitution of 1e300 never carries an infinite ball into the pair pass or out through an exit;
 *  - `collidePairs()` (onPostSubStep): every touching pair, by mass (area), through a grid rebuilt each sub-step – a ball
 *    that covers more than BIG_CELLS cells is tested directly against the others instead, and a sub-step tests at most its
 *    share of BLUEPRINT_PAIR_TESTS_PER_STEP pairs and walks at most its share of BLUEPRINT_PAIR_VISITS_PER_STEP grid
 *    entries (the rest are skipped and counted: `droppedPairs`); a contact is reported once, the step it starts, with the
 *    ball that was faster before it first;
 *  - `cull()` (end of each step): a ball gone non-finite or past BLUEPRINT_SPEED_CEILING is taken out (counted), so the
 *    canvas never draws one and no sub-step plan has to follow one; a radius past BLUEPRINT_RADIUS_CEILING stops at it,
 *    whatever set it; `sweep()` drops an escaped ball's ghost whose numbers went non-finite;
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
import { BLUEPRINT_PAIR_TESTS_PER_STEP, BLUEPRINT_PAIR_VISITS_PER_STEP, BLUEPRINT_RADIUS_CEILING, BLUEPRINT_SPEED_CEILING, BLUEPRINT_TILE_CEILING, BLUEPRINT_TILE_TESTS_PER_STEP } from "../limits";
import { RINGS_RIM_OUTER, type Blueprint } from "../schema";
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
/**
 * --- review fix (blueprint) --- How far apart (px) two balls in contact may drift and still be the same contact: a ball
 * resting in a heap parts from its neighbour by a hair and settles back, and that is no new hit.
 */
export const CONTACT_SLACK = 1;
/** Half the thickness of the rim, the rings and an exit's edges (px). */
export const WALL_HALF = 2;
/** The static grid's and the pair grid's cell (px). */
const CELL = 32;
/**
 * --- review fix (blueprint) --- A ball whose box covers more cells than this is "big": it stays out of the pair grid and is
 * tested directly against every other ball (a ball the size of the arena in every cell made each pair test every other).
 * A tier-10 orb of Tier Climb (62 px) covers at most 25.
 */
export const BIG_CELLS = 25;
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
  /** Passes through other balls (still touching them for ballHit: once as it enters one). */
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
  /** --- review fix (blueprint) --- The world's count of live balls, kept as balls die (aliveCount() reads it, no loop). */
  private readonly live: { n: number };
  private isAlive = true;
  /** It left through an exit or past the last ring: it flies on out of the frame as a fading ghost. */
  escaped = false;
  /** Distance from the centre where the sub-step began (ring passes). */
  pd = 0;
  /** The step of its last wall hit (one wall hit a step). */
  lastWall = -1;
  /**
   * --- review fix (blueprint) --- The step a rule last changed its tier or team (−1: never): its contacts start afresh
   * the next step, so a `with` is judged on the new facts – an orb merged up to the tier of the orb it rests on merges on.
   */
  factsStep = -1;
  private teamSlot: number;
  private colorSlot: number;
  private readonly palette: readonly string[];

  constructor(ball: Ball, nb: NewWorldBall, palette: readonly string[], live: { n: number } = { n: 1 }) {
    this.ball = ball;
    this.id = ball.id;
    this.live = live;
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

  /** False once it escaped, popped or was removed (the step sweeps it out); a ball never comes back to life. */
  get alive() {
    return this.isAlive;
  }
  set alive(v: boolean) {
    if (v || !this.isAlive) return;
    this.isAlive = false;
    this.live.n--;
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

/** A pair of balls as one number, the same whichever comes first. */
const pairKey = (a: WorldBall, b: WorldBall) => (a.id < b.id ? a.id * 1_048_576 + b.id : b.id * 1_048_576 + a.id);

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

/** --- review fix (blueprint) --- Whether an escaped ball's ghost is still a ball the canvas can draw (finite, a radius within the ceiling). */
function ghostInRange(ball: Ball): boolean {
  return Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.vx) && Number.isFinite(ball.vy) && ball.radius > 0 && ball.radius <= BLUEPRINT_RADIUS_CEILING;
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
  /** --- review fix (blueprint) --- A solid rim round the rings (rings.rim): it holds every ball in, so none escapes. */
  readonly ringRim: boolean = false;
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
  /** Balls alive (each WorldBall keeps it as it dies). */
  private readonly live = { n: 0 };
  /** Pair checks and contact tests of the run (a work count, deterministic). */
  work = 0;
  /** --- review fix (blueprint) --- Balls past BLUEPRINT_SPEED_CEILING that were taken out. */
  fastBalls = 0;
  /** --- review fix (blueprint) --- Sub-steps whose pair tests ran past their share of BLUEPRINT_PAIR_TESTS_PER_STEP (the rest skipped). */
  droppedPairs = 0;
  /** --- review fix (blueprint) --- Pair-grid items the pair pass walked (its real cost; `work` counts the pairs it tested). */
  pairVisits = 0;
  /** --- review fix (blueprint) --- Pair tests that found the two balls overlapping (each resolves and reports: the costly kind). */
  overlaps = 0;
  /** --- review fix (blueprint) --- Ball sub-steps that skipped their tile sweep: the step's share of BLUEPRINT_TILE_TESTS_PER_STEP was spent. */
  droppedTiles = 0;
  /** --- review fix (blueprint) --- The tile work (tileTests()) when the step began, and the length of its sub-steps done so far (s). */
  private tileStepStart = 0;
  private subDone = 0;
  /** The step's length (s) and the last sub-step's (the pair budget's share). */
  private stepSec = FIXED_STEP_SEC;
  private subSec = FIXED_STEP_SEC / 4;

  /** The ball's speed (relative to the surface) before the last resolved contact: whether it was a hit or a graze. */
  private lastSpeed = 0;

  /* the pair grid (rebuilt each sub-step) */
  private pairCount = new Int32Array(0);
  private pairStart = new Int32Array(0);
  private pairItems = new Int32Array(0);
  private pairSeen = new Int32Array(0);
  private pairBig = new Uint8Array(0);
  private readonly bigList: number[] = [];
  /**
   * --- review fix (blueprint) --- The pairs in contact this step and last step: a contact raises ballHit once, the step
   * it starts – a ball resting on another, or one passing through it, touches it every step and is still one contact.
   */
  private pairKeys = new Set<number>();
  private lastPairKeys = new Set<number>();

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
      this.ringRim = rg.rim;
      // (inside a solid rim the rings end at RINGS_RIM_OUTER; without one the outermost ring is the rim)
      const outer = rg.rim ? Math.max(RINGS_RIM_OUTER, rg.inner) : 1;
      for (let k = 0; k < rg.count; k++) {
        this.ringF.push(rg.count === 1 ? outer : rg.inner + ((outer - rg.inner) * k) / (rg.count - 1));
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
    this.live.n++;
    const wb = new WorldBall(ball, nb, this.bp.look.palette, this.live);
    wb.pd = Math.hypot(nb.x - this.cx, nb.y - this.cy);
    this.balls.push(wb);
    this.byId.set(wb.id, wb);
    return wb;
  }

  /** Adopts a ball the engine made itself (a split of the "split" ball interaction) with `parent`'s slots. */
  adopt(ball: Ball, parent: WorldBall): WorldBall {
    ball.gravityScale = 0;
    this.live.n++;
    const wb = new WorldBall(ball, { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, r: ball.radius, gs: parent.gs, pass: parent.pass, body: parent.body, tier: parent.tier, team: parent.team, hp: parent.hp, color: parent.color }, this.bp.look.palette, this.live);
    this.balls.push(wb);
    this.byId.set(wb.id, wb);
    return wb;
  }

  aliveCount(): number {
    return this.live.n;
  }

  get tilesAlive(): number {
    return this.tiles.aliveTotal;
  }

  ringsAlive(): number {
    let n = 0;
    for (const a of this.ringAlive) if (a) n++;
    return n;
  }

  /**
   * --- review fix (blueprint) --- The largest radius (px) a ball may have and still pass through one of the rim's exits:
   * between the exit's two edges (round walls of WALL_HALF at the rim) its centre has R × sin(half width) of room each side;
   * an exit of a half circle or more lets any ball out. −∞ without an exit (a box, rings, a closed rim).
   */
  exitFitRadius(): number {
    let fit = -Infinity;
    for (const half of this.exitHalf) fit = Math.max(fit, this.R * Math.sin(Math.min(half, Math.PI / 2)) - WALL_HALF);
    return fit;
  }

  /** Takes `amount` HP off a tile: true when this broke it. */
  damageTile(i: number, amount: number): boolean {
    return this.tiles.damage(i, amount);
  }

  /**
   * Drops the balls that are no longer alive from the world and from the engine (creation order kept). An escaped ball
   * stays in the engine as a ghost: it flies on out of the frame and fades (`lifetime`), touching nothing – --- review fix
   * (blueprint) --- unless its numbers went out of range (the canvas never draws one). Any other ball the engine holds that
   * the world does not know (its default first ball) goes too: the Blueprint places every ball itself.
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
        if (!this.byId.has(ball.id) && (ball.lifetime === undefined || !ghostInRange(ball))) {
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
      if (this.byId.has(ball.id) || (ball.lifetime !== undefined && ghostInRange(ball))) engineBalls[w++] = ball;
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
    this.subSec = h;
    if (!b.alive || !this.keep(b)) return;
    const ball = b.ball;
    // where it was when the sub-step began (the engine has just moved it): the ring pass judges by it
    b.pd = Math.hypot(ball.x - ball.vx * h - this.cx, ball.y - ball.vy * h - this.cy);
    if (this.tiles.aliveTotal > 0) {
      // --- review fix (blueprint) --- within the step's tile budget (the sub-steps so far and this one's share)
      if (this.tileTests() - this.tileStepStart < BLUEPRINT_TILE_TESTS_PER_STEP * Math.min(1, (this.subDone + h) / Math.max(this.stepSec, 1e-9))) this.collideTiles(b, h, events);
      else this.droppedTiles++;
    }
    if (!b.alive) return;
    this.collideStatic(b, events);
    if (b.alive) this.collideArena(b, events);
    // --- review fix (blueprint) --- a contact may have sent it out of range (a restitution of 1e300): out before it moves on
    if (!b.alive || !this.keep(b)) return;
    if (b.gs !== 0) {
      ball.vx += this.gx * b.gs * h;
      ball.vy += this.gy * b.gs * h;
    }
  }

  /**
   * --- review fix (blueprint) --- Whether a ball's numbers are ones the world can move: its position, velocity and radius
   * finite, a radius above 0, a speed within BLUEPRINT_SPEED_CEILING. One that is not is taken out and counted (nanBalls,
   * fastBalls) – never left for the pair pass, an exit or the canvas; a radius past BLUEPRINT_RADIUS_CEILING stops at it,
   * whatever set it (an action, the page's Ball Size).
   */
  private keep(b: WorldBall): boolean {
    const ball = b.ball;
    if (!(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.vx) && Number.isFinite(ball.vy) && Number.isFinite(ball.radius) && ball.radius > 0)) {
      b.alive = false;
      this.nanBalls++;
      return false;
    }
    if (ball.vx * ball.vx + ball.vy * ball.vy > BLUEPRINT_SPEED_CEILING * BLUEPRINT_SPEED_CEILING) {
      b.alive = false;
      this.fastBalls++;
      return false;
    }
    if (ball.radius > BLUEPRINT_RADIUS_CEILING) ball.radius = BLUEPRINT_RADIUS_CEILING;
    return true;
  }

  /** --- review fix (blueprint) --- The tile work of the run so far: tiles looked at and tested, tile-grid cells visited (TileField.stats). */
  tileTests(): number {
    const st = this.tiles.stats;
    return st.candidates + st.narrowTests + st.cellVisits;
  }

  /** --- review fix (blueprint) --- The end of a sub-step (onPostSubStep): its length counts toward the step's tile budget. */
  endSubStep() {
    this.subDone += this.subSec;
  }

  /**
   * --- review fix (blueprint) --- The end of a step (after the rules): a ball whose position, velocity or radius is not a
   * finite number, or that moves faster than BLUEPRINT_SPEED_CEILING, is taken out (counted: nanBalls, fastBalls) before the
   * canvas draws it – an action may have made one this step, and the engine's next move would carry it on.
   */
  cull() {
    for (const b of this.balls) if (b.alive) this.keep(b);
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
        const half = this.ringGapHalf;
        const off = Math.abs(angleDiff(ang, this.ringGapAt[k]));
        const angular = b.r / Math.max(rk, 1);
        // passed outward through the gap this sub-step (a breaking ring is gone for every ball at once) – --- review fix
        // (blueprint) --- only through the gap: a ball that crossed the ring anywhere else (one wider than its band, squeezed
        // across by the rings beside it) passed nothing – it is a wall contact on the side it came from
        const inGap = off <= half + angular;
        const crossed = (b.pd < rk) !== (d < rk);
        if (crossed && inGap && d >= rk) {
          if (this.ringBreak) {
            this.ringAlive[k] = false;
            this.ringBrokeAt[k] = this.timeSec;
          }
          events.ringPass(b, k);
          if (!this.ringAlive[k]) continue;
        }
        const squeezed = crossed && !inGap;
        if (!squeezed && Math.abs(d - rk) >= b.r + WALL_HALF) continue;
        if (off <= half - angular) continue; // inside the gap
        if (off < half + angular) {
          // at the gap's edges
          for (let side = -1; side <= 1; side += 2) {
            const ea = this.ringGapAt[k] + side * half;
            this.hitPoint(b, this.cx + rk * Math.cos(ea), this.cy + rk * Math.sin(ea), events);
          }
          if (off <= half) continue; // (the centre is in the gap: only the edges)
        }
        const inside = squeezed ? b.pd < rk : d < rk;
        const ux = d > 0 ? dx / d : 1;
        const uy = d > 0 ? dy / d : 0;
        const pen = inside ? d + b.r + WALL_HALF - rk : rk + WALL_HALF + b.r - d;
        const impact = this.resolve(b, inside ? -ux : ux, inside ? -uy : uy, pen, this.bounceOf(b));
        this.reportWall(b, impact, events);
      }
      // a solid rim round the rings holds every ball; else one past the last ring is out (where the rings left it: a ball
      // squeezed past the outer ring was pushed back inside)
      if (this.ringRim) this.holdInRim(b, events);
      else if (Math.hypot(b.x - this.cx, b.y - this.cy) - b.r > R + WALL_HALF) this.escapeBall(b, events);
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
    // --- review fix (blueprint) --- a ball out of range is taken out and counted, never an escape (nor a ghost flying on)
    if (!b.alive || !this.keep(b)) return;
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

  /**
   * Ball pairs: a grid rebuilt each sub-step; each touching pair bounces (unless one passes) and is reported once, the step
   * its contact starts (touch()).
   * --- review fix (blueprint) --- Work is bounded, not only the count: a big ball (more than BIG_CELLS cells) is tested
   * directly against every other ball, never through every cell it covers, and a sub-step makes at most its share of
   * BLUEPRINT_PAIR_TESTS_PER_STEP pair tests (`work`: the pairs looked at for a contact) and walks at most its share of
   * BLUEPRINT_PAIR_VISITS_PER_STEP grid entries (`pairVisits`: a ball's cells list the pairs it meets in each, and every
   * shared cell again) – past either the rest of its pairs are skipped and the sub-step is counted (`droppedPairs`). The two
   * are apart so a full arena of 400 small balls, which walks about three entries a pair it tests, keeps its headroom.
   * Small balls are tested in exactly the order they always were.
   */
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
    if (this.pairSeen.length < n) {
      this.pairSeen = new Int32Array(Math.max(n, 64));
      this.pairBig = new Uint8Array(Math.max(n, 64));
    }
    const count = this.pairCount;
    const isBig = this.pairBig;
    const big = this.bigList;
    big.length = 0;
    count.fill(0);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      isBig[i] = 0;
      // --- review fix (blueprint) --- (a ball out of range is taken out here: a NaN cell would never be counted, and the grid
      // filled past its length)
      if (!b.alive || !this.keep(b)) continue;
      const c0 = this.cellX(b.x - b.r);
      const c1 = this.cellX(b.x + b.r);
      const r0 = this.cellY(b.y - b.r);
      const r1 = this.cellY(b.y + b.r);
      const covered = (c1 - c0 + 1) * (r1 - r0 + 1);
      if (covered > BIG_CELLS) {
        isBig[i] = 1;
        big.push(i);
        continue;
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * cols + c]++;
      total += covered;
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
      if (!b.alive || isBig[i]) continue;
      const c0 = this.cellX(b.x - b.r);
      const c1 = this.cellX(b.x + b.r);
      const r0 = this.cellY(b.y - b.r);
      const r1 = this.cellY(b.y + b.r);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.pairItems[count[r * cols + c]++] = i;
    }
    // this sub-step's share of the step's pair tests and grid entries walked
    const share = Math.min(1, this.subSec / Math.max(this.stepSec, 1e-9));
    const testBudget = Math.ceil(BLUEPRINT_PAIR_TESTS_PER_STEP * share);
    const visitBudget = Math.ceil(BLUEPRINT_PAIR_VISITS_PER_STEP * share);
    let tests = 0;
    let visits = 0;
    const seen = this.pairSeen;
    seen.fill(-1, 0, n);
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      if (!a.alive || isBig[i]) continue;
      const c0 = this.cellX(a.x - a.r);
      const c1 = this.cellX(a.x + a.r);
      const r0 = this.cellY(a.y - a.r);
      const r1 = this.cellY(a.y + a.r);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const cell = r * cols + c;
          const end = start[cell + 1];
          if (visits + (end - start[cell]) > visitBudget) {
            this.droppedPairs++;
            return;
          }
          visits += end - start[cell];
          this.pairVisits += end - start[cell];
          for (let q = start[cell]; q < end; q++) {
            const j = this.pairItems[q];
            if (j <= i || seen[j] === i) continue;
            seen[j] = i;
            const b = balls[j];
            if (!b.alive) continue;
            if (tests >= testBudget) {
              this.droppedPairs++;
              return;
            }
            tests++;
            this.work++;
            this.touch(a, b, events);
            if (!a.alive) break;
          }
        }
    }
    // the big balls: each against every other ball (a pair of big ones once)
    for (const i of big) {
      const a = balls[i];
      if (tests + n > testBudget || visits + n > visitBudget) {
        this.droppedPairs++;
        return;
      }
      tests += n;
      visits += n;
      this.pairVisits += n;
      for (let j = 0; j < n; j++) {
        if (j === i || (isBig[j] && j < i)) continue;
        const b = balls[j];
        if (!b.alive) continue;
        this.work++;
        if (j < i) this.touch(b, a, events);
        else this.touch(a, b, events);
      }
    }
  }

  /**
   * A new step: last step's contacts are kept to tell a new contact from one that goes on, this step's start empty;
   * `stepSec` is its length (the pair and tile budgets are shared over its sub-steps).
   */
  beginStep(step: number, timeSec: number, stepSec = FIXED_STEP_SEC) {
    this.step = step;
    this.timeSec = timeSec;
    this.stepSec = stepSec;
    const last = this.lastPairKeys;
    this.lastPairKeys = this.pairKeys;
    this.pairKeys = last;
    this.pairKeys.clear();
    this.tileStepStart = this.tileTests();
    this.subDone = 0;
  }

  /**
   * Two balls that may touch: an overlapping pair parts and bounces (unless one passes through), and a contact that starts
   * this step raises ballHit once. --- review fix (blueprint) --- Self is the ball that was faster BEFORE the bounce (ties:
   * the older one): with equal masses a head-on bounce swaps the speeds, so measured after it the slower ball would be
   * self. A pair still in contact from last step raises nothing (a heap at rest, a ball passing through another), unless
   * a rule changed either ball's tier or team last step (`factsStep`): its `with` is then judged again.
   */
  private touch(a: WorldBall, b: WorldBall, events: WorldEvents) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const reach = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) {
      // a pair a hair apart is still the same contact (a heap's balls part and settle again): it is kept, never re-raised
      const near = reach + CONTACT_SLACK;
      if (d2 < near * near) {
        const key = pairKey(a, b);
        if (this.continues(key, a, b)) this.pairKeys.add(key);
      }
      return;
    }
    this.overlaps++;
    const d = Math.sqrt(d2);
    // coincident balls part along a fixed direction (the later ball to the right): no randomness, no NaN
    const nx = d > 0 ? dx / d : 1;
    const ny = d > 0 ? dy / d : 0;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    const sa = a.vx * a.vx + a.vy * a.vy;
    const sb = b.vx * b.vx + b.vy * b.vy;
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
    const key = pairKey(a, b);
    if (this.pairKeys.has(key)) return;
    this.pairKeys.add(key);
    if (this.continues(key, a, b)) return;
    const aFirst = sa > sb || (sa === sb && a.id < b.id);
    events.ballHit(aFirst ? a : b, aFirst ? b : a, vn < 0 ? -vn : 0);
  }

  /** Whether a pair's contact goes on from last step: it touched then, and no rule changed either ball's tier or team since. */
  private continues(key: number, a: WorldBall, b: WorldBall): boolean {
    return this.lastPairKeys.has(key) && a.factsStep < this.step - 1 && b.factsStep < this.step - 1;
  }
}
