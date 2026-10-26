import type { Ball } from "./types";
import { rebound } from "./obstacles";
import { SCALE_INTERVALS, midiToFrequency, type ScaleId } from "@/lib/audio/scales";

/*
 * --- tiles --- Destructible tiles with hit points: the shared primitive of the Blueprint interpreter (Mode Lab, the
 * 'blueprint' mode), so a new "break the glass", "smash the bricks" or "break the layers" mechanic is data, never a
 * new collision routine. Spiral Glass, Shatter, Glass Smash, Land Claim and Brick Smash each wrote their own; they may
 * move onto this one later, but only behind unchanged fingerprints (tests/extras.test.ts) – no mode imports it today.
 *
 * A `TileField` holds up to `capacity` tiles in typed arrays (sized once, at construction):
 *  - a tile is a **rect** (an axis-aligned box) or an **annular sector** (the part of a ring between two radii and two
 *    angles around a centre; a span of 2π is a whole ring, an inner radius of 0 a pie slice);
 *  - each has hit points (`hp` of `maxHp`, fractional, so a grind by contact time chips it), a `row` and a `col` (its
 *    place in its layout: the pitch it plays and its colour), and an `alive` flag;
 *  - `layoutGrid()` and `layoutRing()` lay out a block of them, capped at the capacity (the Blueprint interpreter sizes its
 *    field with BLUEPRINT_TILE_CEILING of lib/uncap.ts, so a stranger's link cannot freeze a tab).
 *
 * `collide(ball, dtSec, restitution)` resolves a ball that has just moved by `velocity × dtSec` (call it from the mode's
 * `onBallStep()`, where the engine has integrated the ball and nothing else has moved it yet): it sweeps the ball's
 * circle from where the sub-step started to where it ended, finds the first tile it touches (time of impact against the
 * tile grown by the ball's radius – exact for both kinds, so nothing tunnels, at any speed), puts the ball there, reflects
 * its velocity through obstacles.ts `rebound()` and carries on with what is left of the sub-step along the new velocity,
 * up to `TILE_MAX_CONTACTS` contacts. A ball that starts inside a tile (a spawn, a push) is pushed out first. It returns
 * the first tile touched, or −1; every contact of the call is listed in `contactTile` / `contactImpact` (the approach
 * speed, 0 for a resting contact) / `contactNx`, `contactNy`. Damage is the caller's: `damage(i, amount)` says whether the
 * tile broke. The field never damages anything by itself, so a "hit" chip and a "contact" chip are both one line. It never
 * writes a position that is not a finite number (a rebound past any speed leaves the ball where it was: the caller sees its
 * velocity). The work of every call is counted in `stats`, so a caller can bound it (the Blueprint world's tile budget).
 *
 * Broadphase: a uniform grid over the tiles, built once by `build()` (the layouts call it) in compressed rows of typed
 * arrays; a query visits the cells the ball's sweep covers and tests each alive tile once (a stamp per tile). The answer
 * is the same tile, bit for bit, as testing every tile in index order (ties go to the lower index, so the order the grid
 * hands tiles over never matters – tests/tiles.test.ts checks it against brute force). Tiles never move: the grid is
 * built once per layout, so a ring of tiles that turns with a spinning arena needs a polar broadphase first (a later
 * addition, with its own equivalence test), not a rebuild every step.
 *
 * Pure and deterministic: no randomness, no clock (physicsPurity scans this file), and nothing is allocated per step –
 * the narrow phase writes its answers into scratch fields, and the contacts into preallocated arrays. The field is also
 * its own view (`TileView`): the renderer (components/simulator/tilesRenderer.ts) reads the same arrays every frame, with
 * `version` changing whenever a tile's hit points or life change and `clockMs` (set by the mode each step) stamping hits.
 */

/* ------------------------------------------------------------------ constants */

/** A tile's kind: an axis-aligned box. */
export const TILE_RECT = 0;
/** A tile's kind: an annular sector around a centre. */
export const TILE_SECTOR = 1;
export type TileKind = typeof TILE_RECT | typeof TILE_SECTOR;

/** Gap left between a ball and a tile after a contact (px), like obstacles.ts: the next sub-step does not find the same contact again. */
export const TILE_SEPARATION = 0.01;
/** Contacts one `collide()` call resolves at most (a ball in a pocket); the rest of that sub-step's motion is dropped. */
export const TILE_MAX_CONTACTS = 4;
/** Hit points at or below this count as none (fractional chips add up to 1e-16, not 0). */
export const TILE_HP_EPSILON = 1e-9;
/** The broadphase grid's cells along a side, at most (a wider field gets wider cells). */
export const TILE_GRID_MAX_SIDE = 128;
/** A scale's degrees wrap after this many octaves, so a tall field's pitches stay in register. */
export const TILE_PITCH_OCTAVES = 2;
/** The default root of the tiles' pitches: C4. */
export const TILE_ROOT_MIDI = 60;

/** What a tile's pitch follows: its row (a layer, a band), its column, or nothing (every tile the root). */
export const TILE_PITCH_BY = ["row", "col", "none"] as const;
export type TilePitchBy = (typeof TILE_PITCH_BY)[number];

const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ the view */

/**
 * What the canvas reads (the field itself, so it is the same object every frame). Geometry, per tile `i`:
 *  - `x0[i]`, `y0[i]`, `x1[i]`, `y1[i]`: the bounding box – for a rect, the rect itself;
 *  - a sector's centre `cx`, `cy`, radii `r0` (inner) and `r1` (outer), start angle `a0` (radians, clockwise on screen from
 *    3 o'clock, in [0, 2π)) and angular `span` (0 … 2π; 2π = a whole ring); a rect's `cx`, `cy` is its centre, the rest 0;
 *  - `px`, `py`: a point in the middle of the tile (a rect's centre, a sector's mid-radius at its mid-angle) – where a
 *    hatched ball or a shard starts.
 */
export interface TileView {
  readonly capacity: number;
  /** Tiles laid out (alive or broken); indices 0 … count − 1. */
  readonly count: number;
  /** Tiles still standing. */
  readonly aliveTotal: number;
  /** Rows and columns of the layout (the largest row and column + 1). */
  readonly rows: number;
  readonly cols: number;
  /** Sum of every tile's `maxHp`, and of the hit points still standing (a progress bar). */
  readonly hpTotal: number;
  readonly hpLeft: number;
  /** Tiles broken since the layout (or `restoreAll()`). */
  readonly breaks: number;
  /** Changes whenever a tile's hit points or life change, or the layout does (a renderer's cache key). */
  readonly version: number;
  /** The mode's clock (ms of simulated time), which stamps `hitMs` and `brokeMs`. */
  readonly clockMs: number;
  readonly kind: Uint8Array;
  readonly x0: Float64Array;
  readonly y0: Float64Array;
  readonly x1: Float64Array;
  readonly y1: Float64Array;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly r0: Float64Array;
  readonly r1: Float64Array;
  readonly a0: Float64Array;
  readonly span: Float64Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly row: Int32Array;
  readonly col: Int32Array;
  /** 1 while the tile stands, 0 once broken. */
  readonly alive: Uint8Array;
  /** `clockMs` of the tile's last damage, and of its break (−Infinity: never). */
  readonly hitMs: Float64Array;
  readonly brokeMs: Float64Array;
}

/* ------------------------------------------------------------------ layouts */

/** A block of rect tiles: `rows` × `cols` boxes filling a rectangle, row 0 at the top, column 0 on the left. */
export interface GridLayout {
  /** The block's top-left corner and size (px). */
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  /** Space between neighbouring tiles (px; 0 = touching). */
  gap?: number;
  /** Hit points of a tile in row 0. */
  hp: number;
  /** Hit points added per row (row r has `hp + r × hpStep`; below `TILE_HP_EPSILON` the tile is left out). */
  hpStep?: number;
}

/**
 * Rings of sector tiles around a centre: `rows` rings between `innerRadius` and `outerRadius` (row 0 the innermost, the
 * first layer a ball inside meets), each cut into `cols` sectors (1 = the whole ring), column 0 starting at `startDeg`.
 */
export interface RingLayout {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  rows: number;
  cols: number;
  /** Space between neighbouring rings, and between neighbouring sectors along a ring's middle (px). */
  gap?: number;
  /** Where column 0 starts: degrees clockwise from 3 o'clock. */
  startDeg?: number;
  /** Every other ring turned by half a sector, like courses of bricks. */
  stagger?: boolean;
  hp: number;
  /** Hit points added per ring outward. */
  hpStep?: number;
}

/** Work counters (deterministic, never wall time): what a performance test measures. */
export interface TileStats {
  /** `collide()` and `overlapping()` calls. */
  calls: number;
  /** Broadphase queries (one per sweep). */
  queries: number;
  /** Grid cells visited. */
  cellVisits: number;
  /** Tiles looked at (each once a query): what the grid saves against testing all of them. */
  candidates: number;
  /** Tiles tested exactly (the standing ones whose bounding box meets the sweep's). */
  narrowTests: number;
  /** Contacts resolved. */
  contacts: number;
  /** Broadphase builds. */
  builds: number;
}

/* ------------------------------------------------------------------ pitch */

/**
 * The MIDI note of scale degree `degree` of `scale` (scales.ts) on `rootMidi`: degree 0 is the root, each degree the next
 * note of the scale upward, wrapping after `TILE_PITCH_OCTAVES` octaves; a negative or fractional degree is folded in.
 */
export function tileMidi(degree: number, scale: ScaleId = "pentatonic", rootMidi: number = TILE_ROOT_MIDI): number {
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.pentatonic;
  const n = intervals.length;
  const wrap = n * TILE_PITCH_OCTAVES;
  const d0 = Number.isFinite(degree) ? Math.round(degree) : 0;
  const d = ((d0 % wrap) + wrap) % wrap;
  const octave = Math.floor(d / n);
  return (Number.isFinite(rootMidi) ? rootMidi : TILE_ROOT_MIDI) + 12 * octave + intervals[d - octave * n];
}

/** `tileMidi()` in Hz (equal temperament, A4 = 440 Hz). */
export function tileFrequency(degree: number, scale: ScaleId = "pentatonic", rootMidi: number = TILE_ROOT_MIDI): number {
  return midiToFrequency(tileMidi(degree, scale, rootMidi));
}

/* ------------------------------------------------------------------ the field */

export class TileField implements TileView {
  readonly capacity: number;
  count = 0;
  aliveTotal = 0;
  rows = 0;
  cols = 0;
  hpTotal = 0;
  hpLeft = 0;
  breaks = 0;
  version = 0;
  /** Set by the mode every step (ms of simulated time): `damage()` stamps it into `hitMs` and `brokeMs`. */
  clockMs = 0;
  /** Gap left after a contact (px); a scale-free caller may set its own. */
  separation = TILE_SEPARATION;

  readonly kind: Uint8Array;
  readonly x0: Float64Array;
  readonly y0: Float64Array;
  readonly x1: Float64Array;
  readonly y1: Float64Array;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly r0: Float64Array;
  readonly r1: Float64Array;
  readonly a0: Float64Array;
  readonly span: Float64Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly row: Int32Array;
  readonly col: Int32Array;
  readonly alive: Uint8Array;
  readonly hitMs: Float64Array;
  readonly brokeMs: Float64Array;
  /** A sector's edge directions: (ux0, uy0) at its start angle, (ux1, uy1) at its end angle. */
  private readonly ux0: Float64Array;
  private readonly uy0: Float64Array;
  private readonly ux1: Float64Array;
  private readonly uy1: Float64Array;

  // --- the last collide() call's contacts (preallocated, overwritten by every call) ---
  /** Contacts the last `collide()` resolved (0 … TILE_MAX_CONTACTS). */
  contactCount = 0;
  readonly contactTile = new Int32Array(TILE_MAX_CONTACTS);
  /** The approach speed of each contact (px/s along the normal; 0 for a resting or separating one). */
  readonly contactImpact = new Float64Array(TILE_MAX_CONTACTS);
  /** Each contact's unit normal, from the tile to the ball. */
  readonly contactNx = new Float64Array(TILE_MAX_CONTACTS);
  readonly contactNy = new Float64Array(TILE_MAX_CONTACTS);

  readonly stats: TileStats = { calls: 0, queries: 0, cellVisits: 0, candidates: 0, narrowTests: 0, contacts: 0, builds: 0 };

  // --- the broadphase grid (compressed rows: the tiles of cell c are cellTiles[cellStart[c] … cellStart[c + 1] − 1]) ---
  private gridOn = true;
  private dirty = true;
  private gx0 = 0;
  private gy0 = 0;
  private inv = 1;
  private gnx = 0;
  private gny = 0;
  private cellStart = new Int32Array(1);
  private cellTiles = new Int32Array(0);
  private readonly stamp: Int32Array;
  private queryId = 0;

  // --- scratch of the narrow phase (no allocation per test) ---
  /** The probed tile's contact normal and, for an overlap, its signed distance. */
  private pnx = 0;
  private pny = 0;
  private psd = 0;
  private pOverlap = false;
  /** The best contact of a query. */
  private bestT = Infinity;
  private bestDepth = Infinity;
  private bestNx = 0;
  private bestNy = 0;
  private bestSd = 0;
  private bestOverlap = false;
  /** A ray test's normal. */
  private rnx = 0;
  private rny = 0;

  /** `capacity`: the most tiles the field holds (a whole number ≥ 1; the arrays are sized for it once). */
  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity < 1) throw new RangeError(`TileField capacity must be a number ≥ 1, got ${capacity}`);
    const n = Math.floor(capacity);
    this.capacity = n;
    this.kind = new Uint8Array(n);
    this.x0 = new Float64Array(n);
    this.y0 = new Float64Array(n);
    this.x1 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.cx = new Float64Array(n);
    this.cy = new Float64Array(n);
    this.r0 = new Float64Array(n);
    this.r1 = new Float64Array(n);
    this.a0 = new Float64Array(n);
    this.span = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.hp = new Float64Array(n);
    this.maxHp = new Float64Array(n);
    this.row = new Int32Array(n);
    this.col = new Int32Array(n);
    this.alive = new Uint8Array(n);
    this.hitMs = new Float64Array(n);
    this.brokeMs = new Float64Array(n);
    this.ux0 = new Float64Array(n);
    this.uy0 = new Float64Array(n);
    this.ux1 = new Float64Array(n);
    this.uy1 = new Float64Array(n);
    this.stamp = new Int32Array(n);
  }

  /** The field as the canvas reads it (the same object every call). */
  get view(): TileView {
    return this;
  }

  /* ---------------------------------------------------------------- building */

  /** Removes every tile (a mode's `init()` calls it before laying out, so a restart replays exactly). */
  clear(): void {
    this.count = 0;
    this.aliveTotal = 0;
    this.rows = 0;
    this.cols = 0;
    this.hpTotal = 0;
    this.hpLeft = 0;
    this.breaks = 0;
    this.clockMs = 0;
    this.contactCount = 0;
    this.gnx = 0;
    this.gny = 0;
    this.dirty = true;
    this.version++;
  }

  /** Adds one tile's common fields; returns its index (the caller checked the capacity). */
  private push(kind: TileKind, hp: number, row: number, col: number): number {
    const i = this.count++;
    this.kind[i] = kind;
    this.hp[i] = hp;
    this.maxHp[i] = hp;
    this.row[i] = row;
    this.col[i] = col;
    this.alive[i] = 1;
    this.hitMs[i] = -Infinity;
    this.brokeMs[i] = -Infinity;
    this.aliveTotal++;
    this.hpTotal += hp;
    this.hpLeft += hp;
    if (row + 1 > this.rows) this.rows = row + 1;
    if (col + 1 > this.cols) this.cols = col + 1;
    this.dirty = true;
    this.version++;
    return i;
  }

  /**
   * Adds a rect tile (`x0` < `x1`, `y0` < `y1`, `hp` > 0). Returns its index, or −1 when the field is full or the tile
   * means nothing (an empty box, no hit points, a value that is not a finite number). Call `build()` after the last add.
   */
  addRect(x0: number, y0: number, x1: number, y1: number, hp: number, row = 0, col = 0): number {
    if (this.count >= this.capacity) return -1;
    if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) && x1 > x0 && y1 > y0)) return -1;
    if (!(Number.isFinite(hp) && hp > TILE_HP_EPSILON)) return -1;
    const i = this.push(TILE_RECT, hp, wholeOrZero(row), wholeOrZero(col));
    this.x0[i] = x0;
    this.y0[i] = y0;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.cx[i] = (x0 + x1) / 2;
    this.cy[i] = (y0 + y1) / 2;
    this.r0[i] = 0;
    this.r1[i] = 0;
    this.a0[i] = 0;
    this.span[i] = 0;
    this.px[i] = this.cx[i];
    this.py[i] = this.cy[i];
    return i;
  }

  /**
   * Adds an annular sector tile around (`cx`, `cy`): between `innerRadius` (≥ 0; 0 = a pie slice) and `outerRadius`, from
   * `startAngle` (radians, clockwise on screen from 3 o'clock) over `span` radians (2π or more = the whole ring). Returns
   * its index, or −1 (full, or meaningless). Call `build()` after the last add.
   */
  addSector(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, span: number, hp: number, row = 0, col = 0): number {
    if (this.count >= this.capacity) return -1;
    if (!(Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(innerRadius) && Number.isFinite(outerRadius) && Number.isFinite(startAngle) && Number.isFinite(span))) return -1;
    if (!(innerRadius >= 0 && outerRadius > innerRadius && span > 0)) return -1;
    if (!(Number.isFinite(hp) && hp > TILE_HP_EPSILON)) return -1;
    const i = this.push(TILE_SECTOR, hp, wholeOrZero(row), wholeOrZero(col));
    const full = span >= TWO_PI;
    const s = full ? TWO_PI : span;
    let a = startAngle % TWO_PI;
    if (a < 0) a += TWO_PI;
    this.cx[i] = cx;
    this.cy[i] = cy;
    this.r0[i] = innerRadius;
    this.r1[i] = outerRadius;
    this.a0[i] = a;
    this.span[i] = s;
    this.ux0[i] = Math.cos(a);
    this.uy0[i] = Math.sin(a);
    this.ux1[i] = Math.cos(a + s);
    this.uy1[i] = Math.sin(a + s);
    const mid = a + s / 2;
    const rm = (innerRadius + outerRadius) / 2;
    this.px[i] = cx + rm * Math.cos(mid);
    this.py[i] = cy + rm * Math.sin(mid);
    // The bounding box: the four corners, plus the outer arc's extreme points (at 0, π/2, π, 3π/2) inside the span.
    if (full) {
      this.x0[i] = cx - outerRadius;
      this.y0[i] = cy - outerRadius;
      this.x1[i] = cx + outerRadius;
      this.y1[i] = cy + outerRadius;
    } else {
      let bx0 = Infinity;
      let by0 = Infinity;
      let bx1 = -Infinity;
      let by1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const r = k < 2 ? innerRadius : outerRadius;
        const ux = (k & 1) === 0 ? this.ux0[i] : this.ux1[i];
        const uy = (k & 1) === 0 ? this.uy0[i] : this.uy1[i];
        const x = cx + r * ux;
        const y = cy + r * uy;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
      for (let q = 0; q < 4; q++) {
        let off = (q * Math.PI) / 2 - a;
        if (off < 0) off += TWO_PI;
        if (off > s) continue;
        const x = cx + outerRadius * (q === 0 ? 1 : q === 2 ? -1 : 0);
        const y = cy + outerRadius * (q === 1 ? 1 : q === 3 ? -1 : 0);
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
      this.x0[i] = bx0;
      this.y0[i] = by0;
      this.x1[i] = bx1;
      this.y1[i] = by1;
    }
    return i;
  }

  /**
   * Lays out a grid block (appended to what the field holds; `clear()` first for a fresh layout) and rebuilds the
   * broadphase. Row by row, at most up to the capacity. Returns the tiles placed.
   */
  layoutGrid(layout: GridLayout): number {
    const rows = wholeOrZero(layout.rows);
    const cols = wholeOrZero(layout.cols);
    const gap = Number.isFinite(layout.gap) && (layout.gap as number) > 0 ? (layout.gap as number) : 0;
    const hpStep = Number.isFinite(layout.hpStep) ? (layout.hpStep as number) : 0;
    let placed = 0;
    if (rows > 0 && cols > 0 && Number.isFinite(layout.width) && Number.isFinite(layout.height)) {
      const w = (layout.width - gap * (cols - 1)) / cols;
      const h = (layout.height - gap * (rows - 1)) / rows;
      if (w > 0 && h > 0) {
        for (let r = 0; r < rows && this.count < this.capacity; r++) {
          const y = layout.y + r * (h + gap);
          for (let c = 0; c < cols && this.count < this.capacity; c++) {
            const x = layout.x + c * (w + gap);
            if (this.addRect(x, y, x + w, y + h, layout.hp + r * hpStep, r, c) >= 0) placed++;
          }
        }
      }
    }
    this.build();
    return placed;
  }

  /**
   * Lays out rings of sectors (appended; `clear()` first for a fresh layout) and rebuilds the broadphase. Ring by ring
   * from the inside, at most up to the capacity; a ring too small for its sectors and their gaps is left out. Returns the
   * tiles placed.
   */
  layoutRing(layout: RingLayout): number {
    const rows = wholeOrZero(layout.rows);
    const cols = wholeOrZero(layout.cols);
    const gap = Number.isFinite(layout.gap) && (layout.gap as number) > 0 ? (layout.gap as number) : 0;
    const hpStep = Number.isFinite(layout.hpStep) ? (layout.hpStep as number) : 0;
    const start = Number.isFinite(layout.startDeg) ? ((layout.startDeg as number) * Math.PI) / 180 : 0;
    let placed = 0;
    const inner = layout.innerRadius > 0 ? layout.innerRadius : 0;
    if (rows > 0 && cols > 0 && Number.isFinite(inner) && Number.isFinite(layout.outerRadius)) {
      const band = (layout.outerRadius - inner - gap * (rows - 1)) / rows;
      if (band > 0) {
        for (let r = 0; r < rows && this.count < this.capacity; r++) {
          const ri = inner + r * (band + gap);
          const ro = ri + band;
          if (cols === 1) {
            if (this.addSector(layout.cx, layout.cy, ri, ro, start, TWO_PI, layout.hp + r * hpStep, r, 0) >= 0) placed++;
            continue;
          }
          const gapAngle = gap / ((ri + ro) / 2);
          const s = (TWO_PI - cols * gapAngle) / cols;
          if (!(s > 0)) continue;
          const pitch = s + gapAngle;
          const offset = start + gapAngle / 2 + (layout.stagger && r % 2 === 1 ? pitch / 2 : 0);
          for (let c = 0; c < cols && this.count < this.capacity; c++) {
            if (this.addSector(layout.cx, layout.cy, ri, ro, offset + c * pitch, s, layout.hp + r * hpStep, r, c) >= 0) placed++;
          }
        }
      }
    }
    this.build();
    return placed;
  }

  /**
   * Builds the broadphase grid over every tile laid out (alive or not: a broken tile is skipped by its flag). The cell is
   * as wide as the tiles' average bounding box (at most `TILE_GRID_MAX_SIDE` cells a side); a tile sits in every cell its
   * box covers. Allocates only when the arrays are too small – call it at init, never per step.
   */
  build(): void {
    this.stats.builds++;
    this.dirty = false;
    const n = this.count;
    if (n === 0) {
      this.gnx = 0;
      this.gny = 0;
      return;
    }
    let gx0 = Infinity;
    let gy0 = Infinity;
    let gx1 = -Infinity;
    let gy1 = -Infinity;
    let sumW = 0;
    let sumH = 0;
    for (let i = 0; i < n; i++) {
      if (this.x0[i] < gx0) gx0 = this.x0[i];
      if (this.y0[i] < gy0) gy0 = this.y0[i];
      if (this.x1[i] > gx1) gx1 = this.x1[i];
      if (this.y1[i] > gy1) gy1 = this.y1[i];
      sumW += this.x1[i] - this.x0[i];
      sumH += this.y1[i] - this.y0[i];
    }
    let cell = Math.max(sumW / n, sumH / n);
    const spanX = gx1 - gx0;
    const spanY = gy1 - gy0;
    if (spanX / cell > TILE_GRID_MAX_SIDE - 1) cell = spanX / (TILE_GRID_MAX_SIDE - 1);
    if (spanY / cell > TILE_GRID_MAX_SIDE - 1) cell = spanY / (TILE_GRID_MAX_SIDE - 1);
    if (!(cell > 0)) cell = 1;
    const inv = 1 / cell;
    const gnx = Math.floor(spanX * inv) + 1;
    const gny = Math.floor(spanY * inv) + 1;
    this.gx0 = gx0;
    this.gy0 = gy0;
    this.inv = inv;
    this.gnx = gnx;
    this.gny = gny;
    const cells = gnx * gny;
    if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);
    // Pass 1: count each cell's tiles (into start[c + 1]); pass 2: prefix sums; pass 3: fill.
    let refs = 0;
    for (let i = 0; i < n; i++) {
      const ix0 = Math.floor((this.x0[i] - gx0) * inv);
      const ix1 = Math.floor((this.x1[i] - gx0) * inv);
      const iy0 = Math.floor((this.y0[i] - gy0) * inv);
      const iy1 = Math.floor((this.y1[i] - gy0) * inv);
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) start[iy * gnx + ix + 1]++;
      refs += (ix1 - ix0 + 1) * (iy1 - iy0 + 1);
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    if (this.cellTiles.length < refs) this.cellTiles = new Int32Array(refs);
    const fill = this.cellTiles;
    // (start[c] is moved forward as cell c fills, then put back from its neighbour's end)
    for (let i = 0; i < n; i++) {
      const ix0 = Math.floor((this.x0[i] - gx0) * inv);
      const ix1 = Math.floor((this.x1[i] - gx0) * inv);
      const iy0 = Math.floor((this.y0[i] - gy0) * inv);
      const iy1 = Math.floor((this.y1[i] - gy0) * inv);
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) fill[start[iy * gnx + ix]++] = i;
    }
    for (let c = cells; c > 0; c--) start[c] = start[c - 1];
    start[0] = 0;
  }

  /** Off: every query tests every tile in index order (the brute force the grid must equal; a test switch). */
  setBroadphase(on: boolean): void {
    this.gridOn = on;
  }

  /** The broadphase grid's cells along x and y (0 before the first build). */
  gridSize(): { cols: number; rows: number } {
    return { cols: this.gnx, rows: this.gny };
  }

  resetStats(): void {
    this.stats.calls = 0;
    this.stats.queries = 0;
    this.stats.cellVisits = 0;
    this.stats.candidates = 0;
    this.stats.narrowTests = 0;
    this.stats.contacts = 0;
    this.stats.builds = 0;
  }

  /* ---------------------------------------------------------------- hit points */

  aliveCount(): number {
    return this.aliveTotal;
  }

  isAlive(i: number): boolean {
    return i >= 0 && i < this.count && this.alive[i] === 1;
  }

  /**
   * Takes `amount` hit points from tile `i` (stamping `hitMs` with `clockMs`). Returns true when this broke it – the tile
   * is then gone (`alive` 0, `brokeMs` stamped); false for a tile that still stands, is already broken, or an amount that
   * is not a positive number.
   */
  damage(i: number, amount: number): boolean {
    if (!(i >= 0 && i < this.count) || this.alive[i] !== 1 || !(amount > 0)) return false;
    const before = this.hp[i];
    this.hitMs[i] = this.clockMs;
    this.version++;
    if (before - amount > TILE_HP_EPSILON) {
      this.hp[i] = before - amount;
      this.hpLeft -= amount;
      return false;
    }
    this.hpLeft -= before;
    this.hp[i] = 0;
    this.kill(i);
    return true;
  }

  /** Breaks tile `i` whatever its hit points. Returns true when it was standing. */
  destroy(i: number): boolean {
    if (!(i >= 0 && i < this.count) || this.alive[i] !== 1) return false;
    this.hpLeft -= this.hp[i];
    this.hp[i] = 0;
    this.hitMs[i] = this.clockMs;
    this.version++;
    this.kill(i);
    return true;
  }

  private kill(i: number) {
    this.alive[i] = 0;
    this.brokeMs[i] = this.clockMs;
    this.aliveTotal--;
    this.breaks++;
    if (this.aliveTotal === 0 || this.hpLeft < 0) this.hpLeft = 0;
  }

  /** Every tile laid out stands again at full hit points (a rebuild; the layout and the broadphase are kept). */
  restoreAll(): void {
    let total = 0;
    for (let i = 0; i < this.count; i++) {
      this.hp[i] = this.maxHp[i];
      this.alive[i] = 1;
      this.hitMs[i] = -Infinity;
      this.brokeMs[i] = -Infinity;
      total += this.maxHp[i];
    }
    this.aliveTotal = this.count;
    this.hpTotal = total;
    this.hpLeft = total;
    this.breaks = 0;
    this.version++;
  }

  /** The scale degree tile `i` plays (`tileMidi()`): its row, its column, or 0. */
  degreeOf(i: number, by: TilePitchBy): number {
    if (!(i >= 0 && i < this.count)) return 0;
    return by === "row" ? this.row[i] : by === "col" ? this.col[i] : 0;
  }

  /* ---------------------------------------------------------------- queries */

  /**
   * Resolves `ball` against the alive tiles after it moved by `velocity × dtSec` (see the header): returns the first tile
   * it touched, or −1 (then the ball is left exactly as it was). `restitution` and `friction` are the tiles' (rebound()
   * caps the restitution at MAX_OBSTACLE_RESTITUTION); `bounciness` and `liftSpeed` are the ball's own bounce-math values,
   * passed through to rebound() like the engine's obstacles do (1 and no lift: nothing changes).
   */
  collide(ball: Ball, dtSec: number, restitution: number, friction = 0, bounciness = 1, liftSpeed = Infinity): number {
    this.contactCount = 0;
    this.stats.calls++;
    if (this.aliveTotal === 0) return -1;
    const r = ball.radius;
    const dt = dtSec > 0 ? dtSec : 0;
    let x = ball.x - ball.vx * dt;
    let y = ball.y - ball.vy * dt;
    if (!(Number.isFinite(x) && Number.isFinite(y) && r >= 0)) return -1;
    let left = 1;
    const sep = this.separation;
    for (let k = 0; k < TILE_MAX_CONTACTS; k++) {
      const dx = ball.vx * dt * left;
      const dy = ball.vy * dt * left;
      const j = this.firstContact(x, y, dx, dy, r);
      if (j < 0) {
        x += dx;
        y += dy;
        left = 0;
        break;
      }
      const nx = this.bestNx;
      const ny = this.bestNy;
      if (this.bestOverlap) {
        // started inside (a spawn, a push): out along the shortest way, the motion still to come
        const push = r - this.bestSd + sep;
        x += nx * push;
        y += ny * push;
      } else {
        const t = this.bestT;
        x += dx * t + nx * sep;
        y += dy * t + ny * sep;
        left *= 1 - t;
      }
      const impact = rebound(ball, nx, ny, 0, 0, restitution, friction, bounciness, liftSpeed);
      this.contactTile[k] = j;
      this.contactImpact[k] = impact;
      this.contactNx[k] = nx;
      this.contactNy[k] = ny;
      this.contactCount = k + 1;
      this.stats.contacts++;
      if (!(left > 0)) break;
    }
    if (this.contactCount === 0) return -1;
    // --- review fix (tiles) --- a rebound that sent the ball out of range (a bounciness of 1e300 makes its velocity
    // infinite) never writes ±Infinity or NaN into its position: it stays where the engine moved it, and the caller, who
    // sees the velocity, takes it out
    if (Number.isFinite(x) && Number.isFinite(y)) {
      ball.x = x;
      ball.y = y;
    }
    return this.contactTile[0];
  }

  /**
   * The alive tile a disc of `radius` at (`x`, `y`) overlaps (the deepest; ties to the lower index), or −1 – for placing a
   * spawn. Touching (exactly `radius` away) is not overlapping. With radius 0: the tile the point is inside.
   */
  overlapping(x: number, y: number, radius: number): number {
    this.stats.calls++;
    if (this.aliveTotal === 0 || !(Number.isFinite(x) && Number.isFinite(y) && radius >= 0)) return -1;
    const j = this.firstContact(x, y, 0, 0, radius);
    return j >= 0 && this.bestOverlap ? j : -1;
  }

  /** The alive tile point (`x`, `y`) is strictly inside, or −1. */
  tileAt(x: number, y: number): number {
    return this.overlapping(x, y, 0);
  }

  /**
   * The signed distance from point (`x`, `y`) to tile `i` (negative inside), whatever the tile's life – a test and
   * debugging helper; `collide()` uses the same routine.
   */
  distanceTo(i: number, x: number, y: number): number {
    if (!(i >= 0 && i < this.count)) return Infinity;
    return this.kind[i] === TILE_RECT ? this.sdRect(i, x, y) : this.sdSector(i, x, y);
  }

  /**
   * The first alive tile a disc of radius `r` touches moving from (`ox`, `oy`) by (`dx`, `dy`): an overlap at the start
   * first (the deepest), else the earliest time of impact; ties to the lower index. Writes the best* scratch fields.
   */
  private firstContact(ox: number, oy: number, dx: number, dy: number, r: number): number {
    this.stats.queries++;
    this.bestT = Infinity;
    this.bestDepth = Infinity;
    this.bestOverlap = false;
    let best = -1;
    // the sweep's bounding box (plus the separation, so a contact found by the ray is never cut off by the box)
    const pad = r + this.separation;
    const qx0 = (dx < 0 ? ox + dx : ox) - pad;
    const qx1 = (dx < 0 ? ox : ox + dx) + pad;
    const qy0 = (dy < 0 ? oy + dy : oy) - pad;
    const qy1 = (dy < 0 ? oy : oy + dy) + pad;
    if (!(Number.isFinite(qx0) && Number.isFinite(qx1) && Number.isFinite(qy0) && Number.isFinite(qy1))) return -1;
    if (this.dirty || !this.gridOn || this.gnx === 0) {
      for (let j = 0; j < this.count; j++) best = this.consider(j, best, ox, oy, dx, dy, r, qx0, qy0, qx1, qy1);
      return best;
    }
    const inv = this.inv;
    let ix0 = Math.floor((qx0 - this.gx0) * inv);
    let ix1 = Math.floor((qx1 - this.gx0) * inv);
    let iy0 = Math.floor((qy0 - this.gy0) * inv);
    let iy1 = Math.floor((qy1 - this.gy0) * inv);
    if (ix1 < 0 || iy1 < 0 || ix0 >= this.gnx || iy0 >= this.gny) return -1;
    if (ix0 < 0) ix0 = 0;
    if (iy0 < 0) iy0 = 0;
    if (ix1 >= this.gnx) ix1 = this.gnx - 1;
    if (iy1 >= this.gny) iy1 = this.gny - 1;
    // a sweep across most of the grid: testing every tile once is cheaper than visiting its cells (the same answer)
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > this.count) {
      for (let j = 0; j < this.count; j++) best = this.consider(j, best, ox, oy, dx, dy, r, qx0, qy0, qx1, qy1);
      return best;
    }
    if (++this.queryId > 0x3fffffff) {
      this.stamp.fill(0);
      this.queryId = 1;
    }
    const id = this.queryId;
    const start = this.cellStart;
    const tiles = this.cellTiles;
    const stamp = this.stamp;
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = iy * this.gnx + ix;
        this.stats.cellVisits++;
        for (let k = start[c], end = start[c + 1]; k < end; k++) {
          const j = tiles[k];
          if (stamp[j] === id) continue;
          stamp[j] = id;
          best = this.consider(j, best, ox, oy, dx, dy, r, qx0, qy0, qx1, qy1);
        }
      }
    }
    return best;
  }

  /** Tests tile `j` against the sweep and keeps it when it beats `best` (earlier, then deeper, then the lower index). */
  private consider(j: number, best: number, ox: number, oy: number, dx: number, dy: number, r: number, qx0: number, qy0: number, qx1: number, qy1: number): number {
    this.stats.candidates++;
    if (this.alive[j] !== 1) return best;
    if (this.x0[j] > qx1 || this.x1[j] < qx0 || this.y0[j] > qy1 || this.y1[j] < qy0) return best;
    this.stats.narrowTests++;
    const t = this.probe(j, ox, oy, dx, dy, r);
    if (t === Infinity) return best;
    const depth = this.pOverlap ? this.psd : r;
    if (t < this.bestT || (t === this.bestT && (depth < this.bestDepth || (depth === this.bestDepth && j < best)))) {
      this.bestT = t;
      this.bestDepth = depth;
      this.bestNx = this.pnx;
      this.bestNy = this.pny;
      this.bestSd = this.psd;
      this.bestOverlap = this.pOverlap;
      return j;
    }
    return best;
  }

  /**
   * Tile `i` against a disc of radius `r` moving from (`ox`, `oy`) by (`dx`, `dy`): 0 when the disc already overlaps it
   * (`pOverlap`, with `psd` its signed distance), else the time of impact in [0, 1] (Infinity: no contact this sweep).
   * The contact normal goes to `pnx`, `pny`.
   */
  private probe(i: number, ox: number, oy: number, dx: number, dy: number, r: number): number {
    const rect = this.kind[i] === TILE_RECT;
    const sd = rect ? this.sdRect(i, ox, oy) : this.sdSector(i, ox, oy);
    if (sd < r) {
      this.pOverlap = true;
      this.psd = sd;
      return 0;
    }
    this.pOverlap = false;
    this.psd = sd;
    if (dx === 0 && dy === 0) return Infinity;
    return rect ? this.sweepRect(i, ox, oy, dx, dy, r) : this.sweepSector(i, ox, oy, dx, dy, r);
  }

  /* ---------------------------------------------------------------- geometry: rects */

  /** Signed distance from (`x`, `y`) to rect `i` (negative inside); the outward normal of the nearest feature to `pnx`, `pny`. */
  private sdRect(i: number, x: number, y: number): number {
    const x0 = this.x0[i];
    const y0 = this.y0[i];
    const x1 = this.x1[i];
    const y1 = this.y1[i];
    const qx = x < x0 ? x0 : x > x1 ? x1 : x;
    const qy = y < y0 ? y0 : y > y1 ? y1 : y;
    const ex = x - qx;
    const ey = y - qy;
    if (ex !== 0 || ey !== 0) {
      const d = Math.sqrt(ex * ex + ey * ey);
      this.pnx = ex / d;
      this.pny = ey / d;
      return d;
    }
    // inside (or on the edge): the nearest face, ties in the order left, right, top, bottom
    let m = x - x0;
    this.pnx = -1;
    this.pny = 0;
    if (x1 - x < m) {
      m = x1 - x;
      this.pnx = 1;
      this.pny = 0;
    }
    if (y - y0 < m) {
      m = y - y0;
      this.pnx = 0;
      this.pny = -1;
    }
    if (y1 - y < m) {
      m = y1 - y;
      this.pnx = 0;
      this.pny = 1;
    }
    return -m;
  }

  /**
   * The time of impact of a disc of radius `r` moving from outside rect `i`: the first contact with the rect grown by `r`
   * (a rounded box) – the box grown sideways, the box grown up and down and the four corner circles, the earliest wins.
   */
  private sweepRect(i: number, ox: number, oy: number, dx: number, dy: number, r: number): number {
    const x0 = this.x0[i];
    const y0 = this.y0[i];
    const x1 = this.x1[i];
    const y1 = this.y1[i];
    let best = Infinity;
    let nx = 0;
    let ny = 0;
    let t = this.slab(ox, oy, dx, dy, x0 - r, y0, x1 + r, y1);
    if (t < best) {
      best = t;
      nx = this.rnx;
      ny = this.rny;
    }
    t = this.slab(ox, oy, dx, dy, x0, y0 - r, x1, y1 + r);
    if (t < best) {
      best = t;
      nx = this.rnx;
      ny = this.rny;
    }
    for (let k = 0; k < 4; k++) {
      const kx = (k & 1) === 0 ? x0 : x1;
      const ky = k < 2 ? y0 : y1;
      t = this.enterCircle(ox - kx, oy - ky, dx, dy, r);
      if (t < best) {
        best = t;
        nx = this.rnx;
        ny = this.rny;
      }
    }
    this.pnx = nx;
    this.pny = ny;
    return best;
  }

  /* ---------------------------------------------------------------- geometry: annular sectors */

  /** True when direction (`vx`, `vy`) from sector `i`'s centre lies within its angular span (edges included). */
  private inSpan(i: number, vx: number, vy: number): boolean {
    const s = this.span[i];
    if (s >= TWO_PI) return true;
    const c0 = this.ux0[i] * vy - this.uy0[i] * vx; // ≥ 0: at or past the start edge (clockwise on screen)
    const c1 = vx * this.uy1[i] - vy * this.ux1[i]; // ≥ 0: at or before the end edge
    return s <= Math.PI ? c0 >= 0 && c1 >= 0 : c0 >= 0 || c1 >= 0;
  }

  /** Signed distance from (`x`, `y`) to sector `i` (negative inside); the outward normal of the nearest feature to `pnx`, `pny`. */
  private sdSector(i: number, x: number, y: number): number {
    const vx = x - this.cx[i];
    const vy = y - this.cy[i];
    const rho = Math.sqrt(vx * vx + vy * vy);
    const r0 = this.r0[i];
    const r1 = this.r1[i];
    const full = this.span[i] >= TWO_PI;
    // the radial direction (or, at the very centre, the mid-angle's)
    let ux: number;
    let uy: number;
    if (rho > 0) {
      ux = vx / rho;
      uy = vy / rho;
    } else {
      const mid = this.a0[i] + this.span[i] / 2;
      ux = Math.cos(mid);
      uy = Math.sin(mid);
    }
    if (this.inSpan(i, vx, vy)) {
      if (rho > r1) {
        this.pnx = ux;
        this.pny = uy;
        return rho - r1;
      }
      if (rho < r0) {
        this.pnx = -ux;
        this.pny = -uy;
        return r0 - rho;
      }
      // inside: the nearest of the inner arc, the outer arc and the two edges (ties in that order)
      let m = r1 - rho;
      let nx = ux;
      let ny = uy;
      if (r0 > 0 && rho - r0 < m) {
        m = rho - r0;
        nx = -ux;
        ny = -uy;
      }
      if (!full) {
        const e0 = edgeDistance(vx, vy, this.ux0[i], this.uy0[i], r0, r1);
        if (e0 < m) {
          m = e0;
          nx = this.uy0[i];
          ny = -this.ux0[i];
        }
        const e1 = edgeDistance(vx, vy, this.ux1[i], this.uy1[i], r0, r1);
        if (e1 < m) {
          m = e1;
          nx = -this.uy1[i];
          ny = this.ux1[i];
        }
      }
      this.pnx = nx;
      this.pny = ny;
      return -m;
    }
    // outside the span: the nearest point is on one of the two edges (a corner included)
    let best = Infinity;
    for (let k = 0; k < 2; k++) {
      const eux = k === 0 ? this.ux0[i] : this.ux1[i];
      const euy = k === 0 ? this.uy0[i] : this.uy1[i];
      let along = vx * eux + vy * euy;
      if (along < r0) along = r0;
      else if (along > r1) along = r1;
      const ex = vx - along * eux;
      const ey = vy - along * euy;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) {
        best = d;
        if (d > 0) {
          this.pnx = ex / d;
          this.pny = ey / d;
        } else if (k === 0) {
          this.pnx = this.uy0[i];
          this.pny = -this.ux0[i];
        } else {
          this.pnx = -this.uy1[i];
          this.pny = this.ux1[i];
        }
      }
    }
    return best;
  }

  /**
   * The time of impact of a disc of radius `r` moving from outside sector `i`. The sector grown by `r` is the band
   * between radii r0 − r and r1 + r within the span, plus a capsule of radius `r` around each radial edge: so the first
   * contact is the outer circle entered within the span, the inner circle left within the span, or an edge capsule's side
   * or end circle – the earliest wins.
   */
  private sweepSector(i: number, ox: number, oy: number, dx: number, dy: number, r: number): number {
    const mx = ox - this.cx[i];
    const my = oy - this.cy[i];
    const r0 = this.r0[i];
    const r1 = this.r1[i];
    const a = dx * dx + dy * dy;
    const b = mx * dx + my * dy;
    const c2 = mx * mx + my * my;
    let best = Infinity;
    let nx = 0;
    let ny = 0;
    // the outer face: entering the circle r1 + r (from outside it, moving in)
    const ro = r1 + r;
    const co = c2 - ro * ro;
    if (co >= 0 && b < 0) {
      const disc = b * b - a * co;
      if (disc >= 0) {
        let t = (-b - Math.sqrt(disc)) / a;
        if (t < 0) t = 0;
        if (t <= 1) {
          const hx = mx + dx * t;
          const hy = my + dy * t;
          if (this.inSpan(i, hx, hy)) {
            best = t;
            nx = hx / ro;
            ny = hy / ro;
          }
        }
      }
    }
    // the inner face: leaving the circle r0 − r (from the hole, moving out)
    const ri = r0 - r;
    if (ri > 0) {
      const ci = c2 - ri * ri;
      const disc = b * b - a * ci;
      if (disc >= 0) {
        const t = (-b + Math.sqrt(disc)) / a;
        if (t >= 0 && t <= 1 && t < best) {
          const hx = mx + dx * t;
          const hy = my + dy * t;
          if (this.inSpan(i, hx, hy)) {
            best = t;
            nx = -hx / ri;
            ny = -hy / ri;
          }
        }
      }
    }
    // the two radial edges: a capsule each (its two sides, then its two end circles – the sector's corners)
    if (this.span[i] < TWO_PI) {
      for (let k = 0; k < 2; k++) {
        const ux = k === 0 ? this.ux0[i] : this.ux1[i];
        const uy = k === 0 ? this.uy0[i] : this.uy1[i];
        // w: the edge's normal (u turned a quarter clockwise on screen)
        const wx = -uy;
        const wy = ux;
        const across = mx * wx + my * wy;
        const dAcross = dx * wx + dy * wy;
        let side = 0;
        if (across >= r && dAcross < 0) side = 1;
        else if (across <= -r && dAcross > 0) side = -1;
        if (side !== 0) {
          let t = (side * r - across) / dAcross;
          if (t < 0) t = 0;
          if (t <= 1 && t < best) {
            const along = (mx + dx * t) * ux + (my + dy * t) * uy;
            if (along >= r0 && along <= r1) {
              best = t;
              nx = side * wx;
              ny = side * wy;
            }
          }
        }
        for (let e = 0; e < 2; e++) {
          const rr = e === 0 ? r0 : r1;
          const t = this.enterCircle(mx - rr * ux, my - rr * uy, dx, dy, r);
          if (t < best) {
            best = t;
            nx = this.rnx;
            ny = this.rny;
          }
        }
      }
    }
    this.pnx = nx;
    this.pny = ny;
    return best;
  }

  /* ---------------------------------------------------------------- ray helpers (no allocation: the normal goes to rnx, rny) */

  /**
   * The time a point moving from (`ox`, `oy`) by (`dx`, `dy`) enters the box [`bx0`, `bx1`] × [`by0`, `by1`] (0 … 1, Infinity:
   * not within the move), with the entered face's outward normal. A start on the boundary moving in is a contact at 0.
   */
  private slab(ox: number, oy: number, dx: number, dy: number, bx0: number, by0: number, bx1: number, by1: number): number {
    let tEnter = -Infinity;
    let tExit = Infinity;
    let nx = 0;
    let ny = 0;
    if (dx !== 0) {
      let t1 = (bx0 - ox) / dx;
      let t2 = (bx1 - ox) / dx;
      let n = -1;
      if (t1 > t2) {
        const s = t1;
        t1 = t2;
        t2 = s;
        n = 1;
      }
      if (t1 > tEnter) {
        tEnter = t1;
        nx = n;
        ny = 0;
      }
      if (t2 < tExit) tExit = t2;
    } else if (ox < bx0 || ox > bx1) return Infinity;
    if (dy !== 0) {
      let t1 = (by0 - oy) / dy;
      let t2 = (by1 - oy) / dy;
      let n = -1;
      if (t1 > t2) {
        const s = t1;
        t1 = t2;
        t2 = s;
        n = 1;
      }
      if (t1 > tEnter) {
        tEnter = t1;
        nx = 0;
        ny = n;
      }
      if (t2 < tExit) tExit = t2;
    } else if (oy < by0 || oy > by1) return Infinity;
    if (tEnter > tExit || tExit < 0 || tEnter > 1 || tEnter === -Infinity) return Infinity;
    this.rnx = nx;
    this.rny = ny;
    return tEnter < 0 ? 0 : tEnter;
  }

  /**
   * The time a point at (`mx`, `my`) from a circle's centre, moving by (`dx`, `dy`), enters the circle of radius `R` (0 … 1,
   * Infinity: not within the move, or moving away), with the outward normal at the contact.
   */
  private enterCircle(mx: number, my: number, dx: number, dy: number, R: number): number {
    const b = mx * dx + my * dy;
    if (b >= 0) return Infinity;
    const a = dx * dx + dy * dy;
    const c = mx * mx + my * my - R * R;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    let t = (-b - Math.sqrt(disc)) / a;
    if (t > 1) return Infinity;
    if (t < 0) t = 0;
    const hx = mx + dx * t;
    const hy = my + dy * t;
    const len = Math.sqrt(hx * hx + hy * hy);
    if (len > 0) {
      this.rnx = hx / len;
      this.rny = hy / len;
    } else {
      const s = Math.sqrt(a);
      this.rnx = -dx / s;
      this.rny = -dy / s;
    }
    return t;
  }
}

/* ------------------------------------------------------------------ helpers */

/** A whole number ≥ 0 (anything else 0). */
function wholeOrZero(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Distance from point (`vx`, `vy`) to the segment from `r0`·u to `r1`·u (u a unit direction). */
function edgeDistance(vx: number, vy: number, ux: number, uy: number, r0: number, r1: number): number {
  let along = vx * ux + vy * uy;
  if (along < r0) along = r0;
  else if (along > r1) along = r1;
  const ex = vx - along * ux;
  const ey = vy - along * uy;
  return Math.sqrt(ex * ex + ey * ey);
}
