import { BOARD_BALL_CEILING } from "@/lib/uncap";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- brick-rebuild --- Brick Smash (the loop family's Breakout picture smash and rebuild, with its gold-capsule and
 * kaleidoscope variants): the pure maths of the mode (lib/physics/modes/brickRebuild.ts runs it). Nothing here touches the
 * engine, the page or a canvas, so the tests can check every rule on its own:
 *
 *  - the playfield (`brickField()`): a box of the reference clip's 645 × 817 aspect whose top `wallPct` % is a W × H grid of
 *    bricks (the "box" layout), or – with a symmetry above 1 – a circle with a hole in the middle, its bricks the grid's cells
 *    inside the ring between them (the "mandala" layout of the kaleidoscope variant);
 *  - the swept collision (`sweepBody()`): a ball's centre moves along a ray, the bricks are the grid's cells grown by the ball's
 *    radius, and a DDA walks the cells the ray crosses, testing each cell's neighbourhood – the first face the ball meets is
 *    the one it bounces off, however fast it flies (no tunnelling at any speed), the box's walls (or the circle) reflect it;
 *  - the spawn rule (`spawnDue()`, Land Claim's "every eighth block adds a ball": a break whose number is a multiple of the
 *    period adds one), the symmetry group of the kaleidoscope (`symmetryImages()`, `applyImage()`, `foldIntoWedge()`), the
 *    rebuild's order and timetable (`rebuildOrder()`, `rebuildLandMs()`, `rebuildFlight()`) and the plucks' pitch rule
 *    (`brickPluckFrequency()`: the brick's row on a major pentatonic ladder, top rows high).
 *
 * Units: sizes and speeds are given in px of the 720-wide reference clip, whose box is 645 px wide (`BR_REF_BOX_W`); the box
 * is drawn at `BR_BOX_SHARE` of the world's shorter side, so the look is the same at every size (`field.scale`).
 */

export const BR_ORDERS = ["layers", "random", "rows"] as const;
export type BrOrder = (typeof BR_ORDERS)[number];
export const BR_PICTURES = ["emblem", "upload", "text"] as const;
export type BrPicture = (typeof BR_PICTURES)[number];
export const BR_SYMMETRY_MODES = ["mirror", "rotate"] as const;
export type BrSymmetryMode = (typeof BR_SYMMETRY_MODES)[number];

export function isBrOrder(value: unknown): value is BrOrder {
  return typeof value === "string" && (BR_ORDERS as readonly string[]).includes(value);
}
export function isBrPicture(value: unknown): value is BrPicture {
  return typeof value === "string" && (BR_PICTURES as readonly string[]).includes(value);
}
export function isBrSymmetryMode(value: unknown): value is BrSymmetryMode {
  return typeof value === "string" && (BR_SYMMETRY_MODES as readonly string[]).includes(value);
}

/** What the engine runs (the page's fields resolved; lib/physics/brickRebuildSettings.ts holds the page side). */
export interface BrickRebuildSettings {
  /** The grid: columns and rows (the mandala layout is square: its rows are its columns). */
  cols: number;
  rows: number;
  /** The share of the box the bricks fill from the top (%). */
  wallPct: number;
  /** The balls a cycle starts with (the "real" balls of the kaleidoscope). */
  balls: number;
  /** A new ball every this many breaks (0 = off). */
  every: number;
  /** The balls' speed (px/s) and radius (px) in px of the reference clip. */
  speed: number;
  size: number;
  /** Hits a brick takes. */
  hp: number;
  /** The smash's time limit (s): the settle starts at 0 bricks or at this. */
  duration: number;
  /** Seconds the balls fall under gravity after the smash, and seconds the rebuild lasts. */
  settle: number;
  rebuild: number;
  /** The rebuild's order: colour layers (the field, then the ring, then the accent), a seeded shuffle, or row by row from the bottom. */
  order: BrOrder;
  /** Where the bricks' colours come from (render-only: the physics never reads a colour). */
  picture: BrPicture;
  text: string;
  /** The groove's drop: the first bar line at or after this second of a cycle (the kick starts there). */
  drop: number;
  /** The groove bed (pad, sub, kicks) under the plinks. */
  bed: boolean;
  /** Gold capsules: a broken brick drops one with this chance; the paddle catching one splits every ball into `split`. */
  capsules: boolean;
  capsuleChance: number;
  split: number;
  /** The kaleidoscope: images of every real ball (1 = off: the box), mirror walls or rotations, the hole (% of the radius). */
  symmetry: number;
  symmetryMode: BrSymmetryMode;
  hole: number;
  /** Render-only: hollow outlined balls (off: the page's own ball skin). */
  outline: boolean;
  /** The page's tempo (BPM): the groove, its bar lines and the drop. */
  bpm: number;
}

export const DEFAULT_BRICK_REBUILD: Readonly<BrickRebuildSettings> = {
  cols: 30,
  rows: 30,
  wallPct: 78,
  balls: 3,
  every: 4,
  speed: 450,
  size: 5,
  hp: 1,
  duration: 60,
  settle: 1,
  rebuild: 4,
  order: "layers",
  picture: "emblem",
  text: "LOGO",
  drop: 4,
  bed: true,
  capsules: false,
  capsuleChance: 0.15,
  split: 3,
  symmetry: 1,
  symmetryMode: "mirror",
  hole: 22,
  outline: true,
  bpm: 120,
};

/** The reference clip's box (px of a 720-wide frame): the unit of the size and speed settings, and the box's aspect. */
export const BR_REF_BOX_W = 645;
export const BR_REF_BOX_H = 817;
/**
 * The box's height (or the circle's diameter) as a share of the world's height (of its shorter side for the circle): the rest
 * is the margin the loop HUD's title (above) and counter (below) take on a square or landscape canvas.
 */
export const BR_BOX_SHARE = 0.74;
/** The most of the world's width the box takes (a portrait world: the reference clip's 645 of 720 px). */
export const BR_BOX_WIDTH_SHARE = 0.9;
/**
 * Memory-safety ceilings: the cells a grid holds (each a few numbers of typed state and a rect of the brick layer: 40,000 –
 * a 200 × 200 picture – is ~1 MB), the balls a board holds (full engine balls), the kaleidoscope's images of a ball (each is
 * drawn every frame and every brick hit is applied to every image) and the capsules falling at once.
 */
export const BR_CELL_CEILING = 40_000;
export const BR_BALL_CEILING = BOARD_BALL_CEILING;
export const BR_IMAGE_CEILING = 256;
export const BR_CAPSULE_CEILING = 256;
/** Bounces a ball may make in one sub-step (past them the rest of its sub-step is dropped: a crawl, never a tunnel). */
export const BR_MAX_BOUNCES = 32;
/** Gravity of the settle (reference px/s²), the floor's restitution and the friction a floor contact keeps. */
export const BR_SETTLE_GRAVITY = 2600;
export const BR_SETTLE_RESTITUTION = 0.35;
export const BR_SETTLE_FRICTION = 0.92;
/** A brick's break: it greys and shrinks away over this long (ms; the renderer's ghost squares). */
export const BR_GHOST_MS = 200;
/** The longest flight of a rebuilt brick (s; at most half the rebuild) and how much it grows in flight. */
export const BR_FLIGHT_MAX_SEC = 0.7;
export const BR_FLIGHT_GROW = 0.35;
/** The start balls' launch fan: within this angle (radians) of straight up. */
export const BR_LAUNCH_SPREAD = (40 * Math.PI) / 180;
/** The capsules' fall (reference px/s), the paddle's top speed (reference px/s), width (share of the box) and height (reference px). */
export const BR_CAPSULE_SPEED = 260;
export const BR_PADDLE_SPEED = 1100;
export const BR_PADDLE_SHARE = 0.2;
export const BR_PADDLE_H = 10;
/** The paddle's top above the box's floor (reference px). */
export const BR_PADDLE_LIFT = 26;
/** A split's fan: the copies of a ball leave at ± this many radians (× their rank) from its heading. */
export const BR_SPLIT_FAN = (22 * Math.PI) / 180;
/** The plucks: A3 root, major pentatonic, the top row this many degrees above the bottom row (C3–C6 territory). */
export const BR_PLUCK_ROOT_MIDI = 57;
export const BR_PLUCK_SPAN = 11;
/** The groove's key: the bed's chords on A (the plucks' root an octave down). */
export const BR_BED_ROOT_MIDI = 45;

/* ------------------------------------------------------------------ the playfield */

export type BrickLayout = "box" | "mandala";

/** Where the bricks sit in the world (px): the box (or the circle), the grid and the reference scale. */
export interface BrickField {
  layout: BrickLayout;
  /** The playfield's centre. */
  cx: number;
  cy: number;
  /** The box (the mandala: the circle's bounding square). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The mandala's circle and hole radii (0 in the box). */
  radius: number;
  holeRadius: number;
  /** The grid: origin, cell size, columns and rows. */
  gx: number;
  gy: number;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  /** World px per reference px. */
  scale: number;
}

/** The grid a run builds: whole columns and rows from 1 up, their product at most `BR_CELL_CEILING` (the aspect kept). */
export function brickGridSize(cols: number, rows: number, layout: BrickLayout = "box"): { cols: number; rows: number } {
  let c = Math.max(1, Math.round(Number.isFinite(cols) ? cols : 1));
  let r = layout === "mandala" ? c : Math.max(1, Math.round(Number.isFinite(rows) ? rows : 1));
  if (c * r > BR_CELL_CEILING) {
    const f = Math.sqrt(BR_CELL_CEILING / (c * r));
    c = Math.max(1, Math.floor(c * f));
    r = layout === "mandala" ? c : Math.max(1, Math.floor(r * f));
    while (c * r > BR_CELL_CEILING) {
      if (c >= r) c--;
      else r--;
    }
  }
  return { cols: c, rows: r };
}

/** The layout of a symmetry: the box without one, the mandala's circle with one. */
export function brickLayoutOf(symmetry: number): BrickLayout {
  return Math.round(symmetry) > 1 ? "mandala" : "box";
}

/** The playfield of a `width` × `height` world for these settings (`brickGridSize()` decides the grid). */
export function brickField(width: number, height: number, s: Pick<BrickRebuildSettings, "cols" | "rows" | "wallPct" | "symmetry" | "hole">): BrickField {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const cx = w / 2;
  const cy = h / 2;
  const side = Math.min(w, h);
  const layout = brickLayoutOf(s.symmetry);
  const grid = brickGridSize(s.cols, s.rows, layout);
  if (layout === "mandala") {
    const radius = Math.max(4, (BR_BOX_SHARE * side) / 2);
    const holeShare = Math.max(0, Math.min(0.95, (Number.isFinite(s.hole) ? s.hole : 0) / 100));
    const cell = (2 * radius) / grid.cols;
    return { layout, cx, cy, x0: cx - radius, y0: cy - radius, x1: cx + radius, y1: cy + radius, radius, holeRadius: holeShare * radius, gx: cx - radius, gy: cy - radius, cw: cell, ch: cell, cols: grid.cols, rows: grid.cols, scale: (2 * radius) / BR_REF_BOX_H };
  }
  // the box's height a share of the world's height (the shorter side in a square or landscape world), narrowed to fit its width
  let boxH = BR_BOX_SHARE * h;
  let boxW = (boxH * BR_REF_BOX_W) / BR_REF_BOX_H;
  if (boxW > BR_BOX_WIDTH_SHARE * w) {
    const k = (BR_BOX_WIDTH_SHARE * w) / boxW;
    boxW *= k;
    boxH *= k;
  }
  const x0 = cx - boxW / 2;
  const y0 = cy - boxH / 2;
  const frac = Math.max(0.01, Math.min(1, (Number.isFinite(s.wallPct) ? s.wallPct : 78) / 100));
  const wallH = frac * boxH;
  return { layout, cx, cy, x0, y0, x1: x0 + boxW, y1: y0 + boxH, radius: 0, holeRadius: 0, gx: x0, gy: y0, cw: boxW / grid.cols, ch: wallH / grid.rows, cols: grid.cols, rows: grid.rows, scale: boxW / BR_REF_BOX_W };
}

/** The cells that hold a brick: every cell of the box's grid; the mandala's cells whose centre lies in its ring, clear of the rim. */
export function brickMask(field: BrickField): Uint8Array {
  const n = field.cols * field.rows;
  const mask = new Uint8Array(n);
  if (field.layout === "box") return mask.fill(1);
  const outer = field.radius - 0.75 * Math.max(field.cw, field.ch);
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const x = field.gx + (i + 0.5) * field.cw - field.cx;
      const y = field.gy + (j + 0.5) * field.ch - field.cy;
      const d = Math.hypot(x, y);
      if (d >= field.holeRadius && d <= outer) mask[j * field.cols + i] = 1;
    }
  }
  return mask;
}

/** The cell (−1 outside the grid) whose square holds the world point (x, y). */
export function cellAt(field: BrickField, x: number, y: number): number {
  const i = Math.floor((x - field.gx) / field.cw);
  const j = Math.floor((y - field.gy) / field.ch);
  if (i < 0 || j < 0 || i >= field.cols || j >= field.rows || !Number.isFinite(i) || !Number.isFinite(j)) return -1;
  return j * field.cols + i;
}

/* ------------------------------------------------------------------ the swept collision */

/** A moving ball as the sweep sees it (the mode copies an engine ball in and out). */
export interface SweepBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** The first brick face a ray meets (`firstBrickHit()`'s answer): the time, the cell and the axis (0: a side face, 1: top or bottom). */
interface BrickHit {
  t: number;
  cell: number;
  axis: 0 | 1;
}

const NO_HIT = Infinity;

/**
 * The first brick (a cell with `hp > 0`) whose cell grown by `r` the ray (px, py) + t·(vx, vy) enters within [0, tMax]: a DDA
 * walks the cells the centre crosses and tests each one's neighbourhood (the bricks within `r` of it) – every brick the ball
 * can touch at a time t is in the neighbourhood of the cell holding the centre at t, so the walk stops once the next cell is
 * entered after the best hit so far. A ball already overlapping a brick hits it at t = 0 only when it moves into it (along
 * the axis it overlaps least); one moving out passes. Writes `out` and returns its time (Infinity: none).
 */
function firstBrickHit(f: BrickField, hp: ArrayLike<number>, px: number, py: number, vx: number, vy: number, r: number, tMax: number, out: BrickHit): number {
  out.t = NO_HIT;
  const kx = Math.max(1, Math.ceil(r / f.cw));
  const ky = Math.max(1, Math.ceil(r / f.ch));
  // the grid grown by its neighbourhoods: the centre's walk starts where the ray enters it
  const ex0 = f.gx - kx * f.cw;
  const ex1 = f.gx + (f.cols + kx) * f.cw;
  const ey0 = f.gy - ky * f.ch;
  const ey1 = f.gy + (f.rows + ky) * f.ch;
  let tIn = 0;
  let tOut = tMax;
  if (vx !== 0) {
    let a = (ex0 - px) / vx;
    let b = (ex1 - px) / vx;
    if (a > b) [a, b] = [b, a];
    if (a > tIn) tIn = a;
    if (b < tOut) tOut = b;
  } else if (px < ex0 || px > ex1) return NO_HIT;
  if (vy !== 0) {
    let a = (ey0 - py) / vy;
    let b = (ey1 - py) / vy;
    if (a > b) [a, b] = [b, a];
    if (a > tIn) tIn = a;
    if (b < tOut) tOut = b;
  } else if (py < ey0 || py > ey1) return NO_HIT;
  if (tIn > tOut) return NO_HIT;
  const sx = px + vx * tIn;
  const sy = py + vy * tIn;
  let i = Math.floor((sx - f.gx) / f.cw);
  let j = Math.floor((sy - f.gy) / f.ch);
  if (i < -kx) i = -kx;
  if (i > f.cols + kx - 1) i = f.cols + kx - 1;
  if (j < -ky) j = -ky;
  if (j > f.rows + ky - 1) j = f.rows + ky - 1;
  const stepI = vx > 0 ? 1 : vx < 0 ? -1 : 0;
  const stepJ = vy > 0 ? 1 : vy < 0 ? -1 : 0;
  const nextX = (n: number) => (stepI > 0 ? (f.gx + (n + 1) * f.cw - px) / vx : stepI < 0 ? (f.gx + n * f.cw - px) / vx : Infinity);
  const nextY = (n: number) => (stepJ > 0 ? (f.gy + (n + 1) * f.ch - py) / vy : stepJ < 0 ? (f.gy + n * f.ch - py) / vy : Infinity);
  let tNextX = nextX(i);
  let tNextY = nextY(j);
  let best = NO_HIT;
  // a walk visits at most the cells between its ends (+ a few for the grown border): a guard against a stray float
  for (let guard = f.cols + f.rows + 4 * (kx + ky) + 8; guard > 0; guard--) {
    const i0 = Math.max(0, i - kx);
    const i1 = Math.min(f.cols - 1, i + kx);
    const j0 = Math.max(0, j - ky);
    const j1 = Math.min(f.rows - 1, j + ky);
    for (let jj = j0; jj <= j1; jj++) {
      for (let ii = i0; ii <= i1; ii++) {
        const cell = jj * f.cols + ii;
        if (!(hp[cell] > 0)) continue;
        const bx0 = f.gx + ii * f.cw - r;
        const bx1 = bx0 + f.cw + 2 * r;
        const by0 = f.gy + jj * f.ch - r;
        const by1 = by0 + f.ch + 2 * r;
        let tx0: number;
        let tx1: number;
        if (vx !== 0) {
          tx0 = (bx0 - px) / vx;
          tx1 = (bx1 - px) / vx;
          if (tx0 > tx1) [tx0, tx1] = [tx1, tx0];
        } else if (px > bx0 && px < bx1) {
          tx0 = -Infinity;
          tx1 = Infinity;
        } else continue;
        let ty0: number;
        let ty1: number;
        if (vy !== 0) {
          ty0 = (by0 - py) / vy;
          ty1 = (by1 - py) / vy;
          if (ty0 > ty1) [ty0, ty1] = [ty1, ty0];
        } else if (py > by0 && py < by1) {
          ty0 = -Infinity;
          ty1 = Infinity;
        } else continue;
        const tEnter = tx0 > ty0 ? tx0 : ty0;
        const tExit = tx1 < ty1 ? tx1 : ty1;
        if (tEnter > tExit || tExit <= 0) continue;
        if (tEnter >= 0) {
          if (tEnter <= tMax && tEnter < best) {
            best = tEnter;
            out.t = tEnter;
            out.cell = cell;
            out.axis = tx0 > ty0 ? 0 : 1;
          }
          continue;
        }
        // already overlapping: a hit now only when moving into the brick across the face it overlaps least
        const dLeft = px - bx0;
        const dRight = bx1 - px;
        const dTop = py - by0;
        const dBottom = by1 - py;
        const penX = dLeft < dRight ? dLeft : dRight;
        const penY = dTop < dBottom ? dTop : dBottom;
        const axis: 0 | 1 = penX < penY ? 0 : 1;
        const inward = axis === 0 ? (dLeft < dRight ? vx > 0 : vx < 0) : dTop < dBottom ? vy > 0 : vy < 0;
        if (inward && 0 < best) {
          best = 0;
          out.t = 0;
          out.cell = cell;
          out.axis = axis;
        }
      }
    }
    const tNext = tNextX < tNextY ? tNextX : tNextY;
    if (tNext > best || tNext > tOut || !Number.isFinite(tNext)) break;
    if (tNextX < tNextY) {
      i += stepI;
      tNextX = nextX(i);
    } else {
      j += stepJ;
      tNextY = nextY(j);
    }
    if (i < -kx || i > f.cols + kx - 1 || j < -ky || j > f.rows + ky - 1) break;
  }
  return best;
}

/** The time (≥ 0) the centre meets the playfield's wall within the step: the box's sides (shrunk by r) or the circle (radius − r). */
function wallHit(f: BrickField, b: SweepBody, out: { t: number; nx: number; ny: number }): number {
  out.t = NO_HIT;
  if (f.layout === "mandala") {
    const R = Math.max(0, f.radius - b.r);
    const px = b.x - f.cx;
    const py = b.y - f.cy;
    const a = b.vx * b.vx + b.vy * b.vy;
    const c = px * px + py * py - R * R;
    const bb = 2 * (px * b.vx + py * b.vy);
    if (c >= 0) {
      if (bb > 0) {
        const d = Math.sqrt(px * px + py * py) || 1;
        out.t = 0;
        out.nx = px / d;
        out.ny = py / d;
      }
      return out.t;
    }
    if (a <= 0) return NO_HIT;
    const disc = bb * bb - 4 * a * c;
    const t = (-bb + Math.sqrt(Math.max(0, disc))) / (2 * a);
    const hx = px + b.vx * t;
    const hy = py + b.vy * t;
    const d = Math.hypot(hx, hy) || 1;
    out.t = Math.max(0, t);
    out.nx = hx / d;
    out.ny = hy / d;
    return out.t;
  }
  const lo = f.x0 + b.r;
  const hi = f.x1 - b.r;
  const top = f.y0 + b.r;
  const bottom = f.y1 - b.r;
  let best = NO_HIT;
  if (lo <= hi) {
    if (b.vx > 0) {
      const t = b.x >= hi ? 0 : (hi - b.x) / b.vx;
      if (t < best) {
        best = t;
        out.nx = 1;
        out.ny = 0;
      }
    } else if (b.vx < 0) {
      const t = b.x <= lo ? 0 : (lo - b.x) / b.vx;
      if (t < best) {
        best = t;
        out.nx = -1;
        out.ny = 0;
      }
    }
  }
  if (top <= bottom) {
    if (b.vy > 0) {
      const t = b.y >= bottom ? 0 : (bottom - b.y) / b.vy;
      if (t < best) {
        best = t;
        out.nx = 0;
        out.ny = 1;
      }
    } else if (b.vy < 0) {
      const t = b.y <= top ? 0 : (top - b.y) / b.vy;
      if (t < best) {
        best = t;
        out.nx = 0;
        out.ny = -1;
      }
    }
  }
  out.t = best;
  return best;
}

const sweepHit: BrickHit = { t: NO_HIT, cell: -1, axis: 0 };
const sweepWall = { t: NO_HIT, nx: 0, ny: 0 };

/**
 * Moves `b` for `seconds` through the playfield: bounces off the walls (the box's sides or the circle; × `restitution` on the
 * normal part) and off the bricks of `hp` (null: the bricks are not solid – the settle and the rebuild), calling `onBrick(cell)`
 * for every brick face it meets (the mode takes the hit point there) and `onWall()` for every wall bounce. A brick bounce
 * reflects the axis of the face; the speed is kept. At most `BR_MAX_BOUNCES` bounces: past them the rest of the time is
 * dropped (a crawl, never a tunnel). Returns the bounces made. Allocation-free.
 */
export function sweepBody(f: BrickField, hp: ArrayLike<number> | null, b: SweepBody, seconds: number, onBrick: (cell: number, axis: 0 | 1) => void, onWall: (nx: number, ny: number) => void, restitution = 1): number {
  let left = seconds;
  let bounces = 0;
  while (left > 0 && bounces < BR_MAX_BOUNCES) {
    const tw = wallHit(f, b, sweepWall);
    const limit = tw < left ? tw : left;
    const tb = hp ? firstBrickHit(f, hp, b.x, b.y, b.vx, b.vy, b.r, limit, sweepHit) : NO_HIT;
    if (tb <= limit && tb < NO_HIT) {
      b.x += b.vx * tb;
      b.y += b.vy * tb;
      left -= tb;
      if (sweepHit.axis === 0) b.vx = -b.vx;
      else b.vy = -b.vy;
      bounces++;
      onBrick(sweepHit.cell, sweepHit.axis);
      continue;
    }
    if (tw <= left) {
      b.x += b.vx * tw;
      b.y += b.vy * tw;
      left -= tw;
      const nx = sweepWall.nx;
      const ny = sweepWall.ny;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= (1 + restitution) * vn * nx;
        b.vy -= (1 + restitution) * vn * ny;
      }
      // a ball pushed outside (a resize, a wall moving in) is put back on the wall
      clampInside(f, b);
      bounces++;
      onWall(nx, ny);
      continue;
    }
    b.x += b.vx * left;
    b.y += b.vy * left;
    left = 0;
  }
  return bounces;
}

/** Puts `b` back inside the playfield's wall (the box shrunk by r, or the circle). */
export function clampInside(f: BrickField, b: SweepBody) {
  if (f.layout === "mandala") {
    const R = Math.max(0, f.radius - b.r);
    const dx = b.x - f.cx;
    const dy = b.y - f.cy;
    const d = Math.hypot(dx, dy);
    if (d > R && d > 0) {
      b.x = f.cx + (dx / d) * R;
      b.y = f.cy + (dy / d) * R;
    }
    return;
  }
  const lo = f.x0 + b.r;
  const hi = f.x1 - b.r;
  const top = f.y0 + b.r;
  const bottom = f.y1 - b.r;
  b.x = lo <= hi ? Math.min(hi, Math.max(lo, b.x)) : (f.x0 + f.x1) / 2;
  b.y = top <= bottom ? Math.min(bottom, Math.max(top, b.y)) : (f.y0 + f.y1) / 2;
}

/* ------------------------------------------------------------------ the spawn rule (Land Claim's) */

/** Whether break number `broken` (1-based) adds a ball: every `every`-th one (0 or less: never) – Land Claim's rule. */
export function spawnDue(broken: number, every: number): boolean {
  const e = Math.round(every);
  return e > 0 && broken > 0 && broken % e === 0;
}

/** The balls of a run after `broken` breaks: the start balls and a spawn every `every` breaks, at most the ball ceiling. */
export function expectedBalls(start: number, broken: number, every: number, ceiling: number = BR_BALL_CEILING): number {
  const e = Math.round(every);
  const spawns = e > 0 ? Math.floor(broken / e) : 0;
  return Math.min(ceiling, Math.max(0, start) + spawns);
}

/* ------------------------------------------------------------------ the kaleidoscope */

/** The images of every real ball: `n` rotations, or – mirror walls – an even count (an odd `n` doubles: a wedge of π / n). */
export function symmetryImages(n: number, mode: BrSymmetryMode): number {
  const k = Math.max(1, Math.min(BR_IMAGE_CEILING, Math.round(Number.isFinite(n) ? n : 1)));
  if (k <= 1) return 1;
  if (mode === "rotate") return k;
  return Math.min(BR_IMAGE_CEILING, k % 2 === 0 ? k : 2 * k);
}

/** The wedge (radians) the real balls live in: a full turn over the images. */
export function wedgeAngle(images: number): number {
  return (2 * Math.PI) / Math.max(1, images);
}

/**
 * Image `index` (0 = the real ball itself) of the point (x, y) about the origin, into `out`: rotation by `index` wedges, or –
 * mirror – the dihedral group of the wedge: even images are rotations by 2·(index / 2) wedges, odd ones the real ball's
 * reflection in the x axis turned the same way (`index` < images).
 */
export function applyImage(x: number, y: number, index: number, images: number, mode: BrSymmetryMode, out: { x: number; y: number }) {
  const a = wedgeAngle(images);
  const mirrored = mode !== "rotate" && index % 2 === 1;
  const py = mirrored ? -y : y;
  const turn = mode === "rotate" ? index * a : 2 * Math.floor(index / 2) * a;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  out.x = x * c - py * s;
  out.y = x * s + py * c;
}

/**
 * Folds a real ball back into its wedge [0, a) about the origin after a move (position and velocity, relative to the centre):
 * across the wedge's edge it crossed (mirror walls) or round by a wedge (rotations). Returns whether it was folded.
 */
export function foldIntoWedge(b: { x: number; y: number; vx: number; vy: number }, images: number, mode: BrSymmetryMode): boolean {
  if (images <= 1) return false;
  const a = wedgeAngle(images);
  let folded = false;
  for (let k = 0; k < 6; k++) {
    const theta = Math.atan2(b.y, b.x);
    if (theta >= 0 && (theta < a || (mode === "mirror" && theta <= a + 1e-12))) return folded;
    if (mode === "rotate") {
      // a turn back by the whole wedges it is past (the wedge is periodic)
      const t = theta < 0 ? theta + 2 * Math.PI : theta;
      rotate(b, -Math.floor(t / a) * a);
    } else {
      // a mirror: reflect across the edge it crossed (0 below the wedge, a past it)
      reflectAcross(b, theta < 0 ? 0 : a);
    }
    folded = true;
  }
  return folded;
}

function rotate(b: { x: number; y: number; vx: number; vy: number }, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = b.x * c - b.y * s;
  const y = b.x * s + b.y * c;
  const vx = b.vx * c - b.vy * s;
  const vy = b.vx * s + b.vy * c;
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
}

/** Reflects position and velocity across the line through the origin at `angle`. */
function reflectAcross(b: { x: number; y: number; vx: number; vy: number }, angle: number) {
  const c = Math.cos(2 * angle);
  const s = Math.sin(2 * angle);
  const x = b.x * c + b.y * s;
  const y = b.x * s - b.y * c;
  const vx = b.vx * c + b.vy * s;
  const vy = b.vx * s - b.vy * c;
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
}

/* ------------------------------------------------------------------ the rebuild */

/**
 * The order the broken bricks fly back in (cells, first first): by colour layer – `layerRank` of the cell's colour, the field
 * first – then by distance from the grid's centre, nearest first ("layers"); by the seeded `shuffleRank` of every cell
 * ("random"); or row by row from the bottom, left to right ("rows"). Ties go by cell index.
 */
export function rebuildOrder(cells: readonly number[] | Int32Array, field: Pick<BrickField, "cols" | "rows">, order: BrOrder, colours: ArrayLike<number>, layerRank: ArrayLike<number>, shuffleRank: ArrayLike<number>): Int32Array {
  const out = Int32Array.from(cells);
  const cc = (field.cols - 1) / 2;
  const rc = (field.rows - 1) / 2;
  const dist = (cell: number) => {
    const i = cell % field.cols;
    const j = Math.floor(cell / field.cols);
    return (i - cc) * (i - cc) + (j - rc) * (j - rc);
  };
  const key = (cell: number): number => {
    if (order === "random") return shuffleRank[cell] ?? cell;
    if (order === "rows") {
      const j = Math.floor(cell / field.cols);
      return (field.rows - 1 - j) * field.cols + (cell % field.cols);
    }
    return 0;
  };
  out.sort((a, b) => {
    if (order === "layers") {
      const la = layerRank[colours[a] ?? 0] ?? 0;
      const lb = layerRank[colours[b] ?? 0] ?? 0;
      if (la !== lb) return la - lb;
      const da = dist(a);
      const db = dist(b);
      if (da !== db) return da - db;
      return a - b;
    }
    const ka = key(a);
    const kb = key(b);
    return ka !== kb ? ka - kb : a - b;
  });
  return out;
}

/**
 * The landing time (ms from the rebuild's start) of the k-th of n bricks over a rebuild of `seconds`: the first lands one flight
 * in (it leaves at the rebuild's start), the last at the rebuild's end, the others evenly between.
 */
export function rebuildLandMs(k: number, n: number, seconds: number): number {
  if (n <= 0 || !(seconds > 0)) return 0;
  const flight = rebuildFlightMs(seconds);
  const span = 1000 * seconds - flight;
  return n <= 1 ? 1000 * seconds : flight + (span * k) / (n - 1);
}

/** How long a rebuilt brick flies (ms): at most `BR_FLIGHT_MAX_SEC`, at most half the rebuild. */
export function rebuildFlightMs(seconds: number): number {
  if (!(seconds > 0)) return 0;
  return 1000 * Math.min(BR_FLIGHT_MAX_SEC, 0.5 * seconds);
}

/** The ease of a flight: fast out of the edge, settling into its cell. */
export function easeOutCubic(u: number): number {
  const x = Math.max(0, Math.min(1, u));
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

/**
 * Where a rebuilt brick is at `u` (0–1) of its flight from the off-screen point (ox, oy) to its cell's centre (tx, ty): an
 * eased quadratic curve bent by `bend` (−0.5–0.5) of its length to one side, and its scale (slightly enlarged in flight).
 */
export function rebuildFlight(ox: number, oy: number, tx: number, ty: number, bend: number, u: number, out: { x: number; y: number; scale: number }) {
  const e = easeOutCubic(u);
  const mx = (ox + tx) / 2;
  const my = (oy + ty) / 2;
  const dx = tx - ox;
  const dy = ty - oy;
  const qx = mx - dy * bend;
  const qy = my + dx * bend;
  const a = (1 - e) * (1 - e);
  const b = 2 * (1 - e) * e;
  const c = e * e;
  out.x = a * ox + b * qx + c * tx;
  out.y = a * oy + b * qy + c * ty;
  out.scale = 1 + BR_FLIGHT_GROW * Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
}

/** The off-screen point a cell's brick flies in from: its seeded angle `u` (0–1) at 0.75 of the world's diagonal from its centre. */
export function rebuildOrigin(width: number, height: number, u: number, out: { x: number; y: number }) {
  const a = 2 * Math.PI * u;
  const d = 0.75 * Math.hypot(width, height);
  out.x = width / 2 + d * Math.cos(a);
  out.y = height / 2 + d * Math.sin(a);
}

/** A flight's bend from its seeded `u`: a second, decorrelated draw of the same number (−0.3–0.3). */
export function rebuildBend(u: number): number {
  const v = (u * 977.31) % 1;
  return 0.6 * (v - 0.5);
}

/* ------------------------------------------------------------------ the sound */

/** The pentatonic degree of a brick in `row` of `rows` (the top row highest). */
export function brickDegree(row: number, rows: number): number {
  if (rows <= 1) return BR_PLUCK_SPAN;
  const u = 1 - Math.max(0, Math.min(rows - 1, row)) / (rows - 1);
  return Math.round(u * BR_PLUCK_SPAN);
}

/** The pluck's pitch (Hz) of a degree: A3 major pentatonic. */
export function brickPluckFrequency(degree: number): number {
  return midiToFrequency(degreeToMidi(degree, BR_PLUCK_ROOT_MIDI, "majorPentatonic"));
}

/** The bar's length (ms) at `bpm` (four beats; a bad tempo counts as 120). */
export function brickBarMs(bpm: number): number {
  return (4 * 60000) / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120);
}

/** The beat (from the cycle's start) the groove drops on: the first bar line at or after `drop` seconds. */
export function brickDropBeat(drop: number, bpm: number): number {
  const barMs = brickBarMs(bpm);
  const bars = Math.ceil((1000 * Math.max(0, Number.isFinite(drop) ? drop : 0)) / barMs - 1e-9);
  return 4 * Math.max(0, bars);
}
