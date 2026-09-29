/**
 * A uniform spatial hash grid for broad-phase collision detection between many discs (the Collision
 * Playground mode, modes/collide.ts, rebuilds one every sub-step for up to 2000 orbs).
 *
 * The grid is a counting sort of the points by cell: `build()` bins every point into the cell that
 * contains it (points outside the bounds are clamped into the border cells, which keeps neighbours
 * neighbours), and the pair queries then only look at a cell and four of its eight neighbours – the
 * "forward" half (right, down-left, down, down-right) – so every unordered pair of points in the same or
 * adjacent cells is visited exactly once. With a cell at least as wide as the largest contact distance
 * (two of the biggest radii plus a margin), every pair of discs that can touch lies in the same or
 * adjacent cells, so the query finds all of them while checking only O(n) candidates for evenly spread
 * points instead of n²/2.
 *
 * Everything is kept in typed arrays that grow on demand and are reused across builds, so a rebuild per
 * sub-step allocates nothing once the arrays are big enough. The result is deterministic: the pairs come
 * out in grid order, which only depends on the positions.
 */

/** Flat list of index pairs [i0, j0, i1, j1, …]; `count` pairs are valid. Grows by doubling (never per frame once warm). */
export interface PairBuffer {
  pairs: Int32Array;
  count: number;
}

export function createPairBuffer(capacity = 256): PairBuffer {
  return { pairs: new Int32Array(2 * Math.max(1, capacity)), count: 0 };
}

function pushPair(out: PairBuffer, i: number, j: number) {
  const at = 2 * out.count;
  if (at + 2 > out.pairs.length) {
    const grown = new Int32Array(2 * out.pairs.length);
    grown.set(out.pairs);
    out.pairs = grown;
  }
  out.pairs[at] = i;
  out.pairs[at + 1] = j;
  out.count++;
}

/** Most cells along one axis; a finer grid only costs memory without saving checks. */
export const MAX_GRID_DIM = 1024;

/** The four "forward" neighbours of a cell (dx, dy): together with the cell itself they cover every adjacent pair once. */
const FORWARD: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export class SpatialHash {
  private cellSize = 1;
  private invCell = 1;
  private cols = 1;
  private rows = 1;
  private minX = 0;
  private minY = 0;
  private n = 0;
  /** Prefix sums: the points of cell c are `sorted[cellStart[c] … cellStart[c + 1] − 1]`. */
  private cellStart = new Int32Array(2);
  private cellFill = new Int32Array(1);
  private sorted = new Int32Array(0);
  private cellOfPoint = new Int32Array(0);

  /** Columns × rows of the last build (for tests and tuning). */
  getGridSize(): { cols: number; rows: number; cellSize: number } {
    return { cols: this.cols, rows: this.rows, cellSize: this.cellSize };
  }

  /** Cell index of a point (clamped into the grid). */
  cellIndex(x: number, y: number): number {
    let cx = Math.floor((x - this.minX) * this.invCell);
    let cy = Math.floor((y - this.minY) * this.invCell);
    if (!(cx >= 0)) cx = 0; // also catches NaN
    else if (cx >= this.cols) cx = this.cols - 1;
    if (!(cy >= 0)) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * Bins points 0 … n − 1 (coordinates in `xs` / `ys`) into a grid of square cells of `cellSize` covering the
   * bounds. A cell size too small for the bounds is enlarged so neither axis has more than `MAX_GRID_DIM` cells.
   */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, cellSize: number, minX: number, minY: number, maxX: number, maxY: number) {
    const w = Math.max(1e-9, maxX - minX);
    const h = Math.max(1e-9, maxY - minY);
    let size = cellSize > 1e-9 ? cellSize : 1e-9;
    if (w / size > MAX_GRID_DIM) size = w / MAX_GRID_DIM;
    if (h / size > MAX_GRID_DIM) size = h / MAX_GRID_DIM;
    this.cellSize = size;
    this.invCell = 1 / size;
    this.cols = Math.max(1, Math.ceil(w / size));
    this.rows = Math.max(1, Math.ceil(h / size));
    this.minX = minX;
    this.minY = minY;
    this.n = n;
    const cells = this.cols * this.rows;
    if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
    if (this.cellFill.length < cells) this.cellFill = new Int32Array(cells);
    if (this.sorted.length < n) {
      this.sorted = new Int32Array(n);
      this.cellOfPoint = new Int32Array(n);
    }
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(xs[i], ys[i]);
      this.cellOfPoint[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = this.cellFill;
    for (let c = 0; c < cells; c++) fill[c] = start[c];
    for (let i = 0; i < n; i++) this.sorted[fill[this.cellOfPoint[i]]++] = i;
  }

  /** Number of points in cell (cx, cy) of the last build. */
  cellCount(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return 0;
    const c = cy * this.cols + cx;
    return this.cellStart[c + 1] - this.cellStart[c];
  }

  /**
   * Calls `visit(i, j)` once for every unordered pair of points that share a cell or sit in adjacent cells
   * (including diagonals). The order is deterministic for given positions.
   */
  forEachNearbyPair(visit: (i: number, j: number) => void) {
    const { cols, rows, cellStart: start, sorted } = this;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx;
        const a0 = start[c];
        const a1 = start[c + 1];
        if (a0 === a1) continue;
        for (let p = a0; p < a1; p++) for (let q = p + 1; q < a1; q++) visit(sorted[p], sorted[q]);
        for (let k = 0; k < FORWARD.length; k++) {
          const nx = cx + FORWARD[k][0];
          const ny = cy + FORWARD[k][1];
          if (nx < 0 || nx >= cols || ny >= rows) continue;
          const d = ny * cols + nx;
          const b0 = start[d];
          const b1 = start[d + 1];
          for (let p = a0; p < a1; p++) for (let q = b0; q < b1; q++) visit(sorted[p], sorted[q]);
        }
      }
    }
  }

  /**
   * Collects into `out` (reset first) every pair of discs whose centres are closer than the sum of their radii
   * plus `margin` – the candidates a solver then resolves – and returns how many there are. Discs further apart
   * than one cell can only be found when the cell is at least as wide as the largest contact distance.
   */
  collectContacts(xs: ArrayLike<number>, ys: ArrayLike<number>, rs: ArrayLike<number>, margin: number, out: PairBuffer): number {
    out.count = 0;
    const { cols, rows, cellStart: start, sorted } = this;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx;
        const a0 = start[c];
        const a1 = start[c + 1];
        if (a0 === a1) continue;
        for (let p = a0; p < a1; p++) {
          const i = sorted[p];
          const xi = xs[i];
          const yi = ys[i];
          const ri = rs[i] + margin;
          for (let q = p + 1; q < a1; q++) {
            const j = sorted[q];
            const dx = xs[j] - xi;
            const dy = ys[j] - yi;
            const reach = ri + rs[j];
            if (dx * dx + dy * dy < reach * reach) pushPair(out, i, j);
          }
          for (let k = 0; k < FORWARD.length; k++) {
            const nx = cx + FORWARD[k][0];
            const ny = cy + FORWARD[k][1];
            if (nx < 0 || nx >= cols || ny >= rows) continue;
            const d = ny * cols + nx;
            const b1 = start[d + 1];
            for (let q = start[d]; q < b1; q++) {
              const j = sorted[q];
              const dx = xs[j] - xi;
              const dy = ys[j] - yi;
              const reach = ri + rs[j];
              if (dx * dx + dy * dy < reach * reach) pushPair(out, i, j);
            }
          }
        }
      }
    }
    return out.count;
  }

  /** Points in the last build. */
  get size() {
    return this.n;
  }
}
