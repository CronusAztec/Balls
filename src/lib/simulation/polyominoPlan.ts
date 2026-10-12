/*
 * --- perfect-fit --- Perfect Fit's pure planner (lib/physics/modes/perfectFit.ts runs it, perfectFitRenderer.ts draws it):
 * polyomino sets, an exact-cover solver, the drop-order search and the timeline of a run. Nothing here touches the engine,
 * the page or Web Audio, so the tests, the mode and the finder share it.
 *
 * - **Piece sets**: the 12 free pentominoes (63 fixed orientations: rotations and reflections) and the 7 one-sided
 *   tetrominoes of the Tetris guideline (19 fixed orientations: rotations only – S and Z, J and L are different pieces).
 *   `fixedOrientations()` works for any polyomino, so hexominoes can join later.
 * - **Exact cover** (`DancingLinks`, Knuth's Algorithm X with dancing links): one column per box cell and one per piece, one row
 *   per placement of a piece in an orientation. The column chosen at each level is the one with the fewest rows, ties broken
 *   by a seeded column order, and every column's rows are tried in a seeded order – so each seed picks a different tiling.
 * - **Drop order**: a piece can be dropped straight down when every cell above its cells in its columns is still empty and it
 *   rests on the floor or on a placed cell. That holds for a whole tiling exactly when the "is directly below" relation between
 *   its pieces has no cycle, and then every topological order of it is a valid drop order (`dropOrder()`: lowest first, then
 *   leftmost). A tiling with a cycle cannot be built by dropping: the search rejects it and moves on to the next one, so a
 *   3 × 20 box – both of its tilings (eight with their mirror images) have a cycle – yields "no droppable solution".
 * - **Tetris perfect clears** (`planPerfectClear()`): a section of L lines of a W-wide well is filled by tetrominoes dropped
 *   in their final column and rotation, without a hole, so its L rows complete together. A four-line section keeps one column
 *   for a vertical I that drops last (no row is full before it lands: the classic four-line clear); the others are built by a
 *   seeded search over hole-free drops (each piece lands exactly on the stack), which is an exact cover whose every solution is
 *   droppable by construction. Solved chunks are memoised – the "pre-solved library" – and mirrored by the seed.
 *
 * Every plan is memoised per box and seed (`PF_MEMO_SIZE` entries), so the finder, the fast export and a restart reuse them.
 */

/* ------------------------------------------------------------------ randomness */

/** Mulberry32: a small seeded generator in [0, 1) (the plan's own; the mode draws its seed from the engine's `ctx.random()`). */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** A seed mixed with a salt (a box, a section): a fresh 32-bit stream for each part of a plan. */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

/** Fisher–Yates in place with `random`. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/* ------------------------------------------------------------------ pieces */

/** A cell of a polyomino: column x (right) and row y (up from the floor). */
export type Cell = readonly [number, number];

export interface PolyominoDef {
  name: string;
  /** Its cells in one orientation (any position: orientations are normalised). */
  cells: readonly Cell[];
  /** Its colour (each piece always the same). */
  color: string;
}

/** Rows of a shape drawn top to bottom ("#" a cell) as cells with y up. */
function shape(rows: readonly string[]): Cell[] {
  const out: Cell[] = [];
  rows.forEach((row, r) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") out.push([x, rows.length - 1 - r]);
  });
  return out;
}

/** The 12 pentominoes (F I L N P T U V W X Y Z), each in its own vivid colour, 30° of hue apart. */
export const PENTOMINOES: readonly PolyominoDef[] = [
  { name: "F", cells: shape([".##", "##.", ".#."]), color: "#ff4d5e" },
  { name: "I", cells: shape(["#####"]), color: "#ff8c42" },
  { name: "L", cells: shape(["####", "#..."]), color: "#ffd23f" },
  { name: "N", cells: shape(["##..", ".###"]), color: "#b5e550" },
  { name: "P", cells: shape(["##", "##", "#."]), color: "#3ddc84" },
  { name: "T", cells: shape(["###", ".#.", ".#."]), color: "#2ee6b6" },
  { name: "U", cells: shape(["#.#", "###"]), color: "#33c9ff" },
  { name: "V", cells: shape(["#..", "#..", "###"]), color: "#4d7cff" },
  { name: "W", cells: shape(["#..", "##.", ".##"]), color: "#7a6bff" },
  { name: "X", cells: shape([".#.", "###", ".#."]), color: "#b36bff" },
  { name: "Y", cells: shape(["####", ".#.."]), color: "#ef5bd6" },
  { name: "Z", cells: shape(["##.", ".#.", ".##"]), color: "#ff6b9a" },
];

/** The 7 tetrominoes of the Tetris guideline in their guideline colours (I cyan, O yellow, T purple, S green, Z red, J blue, L orange). */
export const TETROMINOES: readonly PolyominoDef[] = [
  { name: "I", cells: shape(["####"]), color: "#31c7ef" },
  { name: "O", cells: shape(["##", "##"]), color: "#f7d308" },
  { name: "T", cells: shape(["###", ".#."]), color: "#ad4d9c" },
  { name: "S", cells: shape([".##", "##."]), color: "#42b642" },
  { name: "Z", cells: shape(["##.", ".##"]), color: "#ef2029" },
  { name: "J", cells: shape(["#..", "###"]), color: "#5a65ad" },
  { name: "L", cells: shape(["..#", "###"]), color: "#ef7921" },
];

/** One fixed orientation: its cells (normalised: the lowest row and the leftmost column at 0, sorted), size and key. */
export interface Orientation {
  cells: readonly Cell[];
  width: number;
  height: number;
  /** The cells as "x,y;x,y…": the same shape always has the same key. */
  key: string;
  /** Per column (0 … width − 1): the lowest and the highest row of the shape there. */
  bottom: readonly number[];
  top: readonly number[];
}

function normalise(cells: readonly Cell[]): Orientation {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const moved = cells.map(([x, y]) => [x - minX, y - minY] as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let width = 0;
  let height = 0;
  for (const [x, y] of moved) {
    if (x + 1 > width) width = x + 1;
    if (y + 1 > height) height = y + 1;
  }
  const bottom = new Array<number>(width).fill(Infinity);
  const top = new Array<number>(width).fill(-Infinity);
  for (const [x, y] of moved) {
    if (y < bottom[x]) bottom[x] = y;
    if (y > top[x]) top[x] = y;
  }
  return { cells: moved, width, height, key: moved.map(([x, y]) => `${x},${y}`).join(";"), bottom, top };
}

/**
 * The distinct fixed orientations of a polyomino: its four rotations and – with `reflect` (free pieces) – their mirror images.
 * The 12 pentominoes have 63 together, the 7 one-sided tetrominoes 19.
 */
export function fixedOrientations(cells: readonly Cell[], reflect: boolean): Orientation[] {
  const out: Orientation[] = [];
  const seen = new Set<string>();
  for (let m = 0; m < (reflect ? 2 : 1); m++) {
    let cur: Cell[] = cells.map(([x, y]) => [m ? -x : x, y] as const);
    for (let r = 0; r < 4; r++) {
      const o = normalise(cur);
      if (!seen.has(o.key)) {
        seen.add(o.key);
        out.push(o);
      }
      cur = cur.map(([x, y]) => [y, -x] as const);
    }
  }
  return out;
}

/** The piece sets: their pieces and every piece's fixed orientations. */
export interface PieceSet {
  id: "pentomino" | "tetromino";
  pieces: readonly PolyominoDef[];
  orientations: readonly (readonly Orientation[])[];
  /** Cells of one piece (5 or 4). */
  size: number;
}

export const PENTOMINO_SET: PieceSet = { id: "pentomino", pieces: PENTOMINOES, orientations: PENTOMINOES.map((p) => fixedOrientations(p.cells, true)), size: 5 };
export const TETROMINO_SET: PieceSet = { id: "tetromino", pieces: TETROMINOES, orientations: TETROMINOES.map((p) => fixedOrientations(p.cells, false)), size: 4 };

/** The fixed orientations of a set together (63 for the pentominoes). */
export function orientationCount(set: PieceSet): number {
  return set.orientations.reduce((n, list) => n + list.length, 0);
}

/** A tetromino's index from the key of one of its orientations (a mirrored S is a Z…). */
const TETROMINO_OF_KEY: ReadonlyMap<string, number> = new Map(TETROMINO_SET.orientations.flatMap((list, piece) => list.map((o) => [o.key, piece] as const)));

/* ------------------------------------------------------------------ exact cover (Algorithm X, dancing links) */

/**
 * A check of every row the search is about to take at `depth` (the rows taken before it are 0 … depth − 1): false skips the
 * row (a partial solution that can never be accepted), `leave()` undoes `enter()` when the search backs out of it.
 */
export interface CoverGuard {
  enter(row: number, depth: number): boolean;
  leave(row: number, depth: number): void;
}

/** The outcome of an exact-cover search: the rows of each solution it reported, and whether it ran out of budget. */
export interface ExactCoverStats {
  solutions: number;
  updates: number;
  exhausted: boolean;
}

/**
 * Knuth's dancing links over typed arrays. Columns 0 … `columns` − 1 must each be covered exactly once; `rows` lists the
 * columns of each row. The column taken at each level has the fewest rows left, ties broken by `columnRank` (lower first);
 * the rows of a column are tried in the order they were given.
 */
export class DancingLinks {
  private readonly L: Int32Array;
  private readonly R: Int32Array;
  private readonly U: Int32Array;
  private readonly D: Int32Array;
  private readonly C: Int32Array;
  private readonly S: Int32Array;
  private readonly rowOf: Int32Array;
  private readonly rank: Float64Array;
  private readonly columns: number;
  updates = 0;

  constructor(columns: number, rows: readonly (readonly number[])[], columnRank?: ArrayLike<number>) {
    this.columns = columns;
    let nodes = columns + 1;
    for (const row of rows) nodes += row.length;
    this.L = new Int32Array(nodes);
    this.R = new Int32Array(nodes);
    this.U = new Int32Array(nodes);
    this.D = new Int32Array(nodes);
    this.C = new Int32Array(nodes);
    this.S = new Int32Array(columns + 1);
    this.rowOf = new Int32Array(nodes).fill(-1);
    this.rank = new Float64Array(columns + 1);
    // the root is node 0, column c's header is node c + 1
    for (let i = 0; i <= columns; i++) {
      this.L[i] = i === 0 ? columns : i - 1;
      this.R[i] = i === columns ? 0 : i + 1;
      this.U[i] = i;
      this.D[i] = i;
      this.C[i] = i;
      if (i > 0) this.rank[i] = columnRank ? columnRank[i - 1] : i;
    }
    let next = columns + 1;
    rows.forEach((row, r) => {
      let first = -1;
      for (const col of row) {
        const h = col + 1;
        const n = next++;
        this.C[n] = h;
        this.rowOf[n] = r;
        this.U[n] = this.U[h];
        this.D[n] = h;
        this.D[this.U[h]] = n;
        this.U[h] = n;
        this.S[h]++;
        if (first < 0) {
          first = n;
          this.L[n] = n;
          this.R[n] = n;
        } else {
          this.L[n] = this.L[first];
          this.R[n] = first;
          this.R[this.L[first]] = n;
          this.L[first] = n;
        }
      }
    });
  }

  private cover(c: number) {
    const { L, R, U, D, C, S } = this;
    R[L[c]] = R[c];
    L[R[c]] = L[c];
    for (let i = D[c]; i !== c; i = D[i]) {
      for (let j = R[i]; j !== i; j = R[j]) {
        U[D[j]] = U[j];
        D[U[j]] = D[j];
        S[C[j]]--;
        this.updates++;
      }
    }
  }

  private uncover(c: number) {
    const { L, R, U, D, C, S } = this;
    for (let i = U[c]; i !== c; i = U[i]) {
      for (let j = L[i]; j !== i; j = L[j]) {
        S[C[j]]++;
        U[D[j]] = j;
        D[U[j]] = j;
      }
    }
    R[L[c]] = c;
    L[R[c]] = c;
  }

  /**
   * Every solution in search order, handed to `onSolution` (the rows chosen; return true to stop), until the search ends or
   * `budget` link updates were spent (`exhausted`).
   */
  search(onSolution: (rows: readonly number[]) => boolean, budget = Infinity, guard?: CoverGuard): ExactCoverStats {
    const stats: ExactCoverStats = { solutions: 0, updates: 0, exhausted: false };
    const chosen: number[] = [];
    const { L, R, D, C, S, rank, rowOf } = this;
    let stop = false;
    const recurse = (): void => {
      if (stop) return;
      if (R[0] === 0) {
        stats.solutions++;
        if (onSolution(chosen.map((n) => rowOf[n]))) stop = true;
        return;
      }
      if (this.updates > budget) {
        stats.exhausted = true;
        stop = true;
        return;
      }
      let c = R[0];
      for (let j = R[c]; j !== 0; j = R[j]) if (S[j] < S[c] || (S[j] === S[c] && rank[j] < rank[c])) c = j;
      if (S[c] === 0) return;
      this.cover(c);
      for (let r = D[c]; r !== c && !stop; r = D[r]) {
        const depth = chosen.length;
        if (guard && !guard.enter(rowOf[r], depth)) continue;
        chosen.push(r);
        for (let j = R[r]; j !== r; j = R[j]) this.cover(C[j]);
        recurse();
        for (let j = L[r]; j !== r; j = L[j]) this.uncover(C[j]);
        chosen.pop();
        guard?.leave(rowOf[r], depth);
      }
      this.uncover(c);
    };
    recurse();
    stats.updates = this.updates;
    return stats;
  }

  /** Columns of the matrix (the box's cells and the pieces). */
  get columnCount() {
    return this.columns;
  }
}

/* ------------------------------------------------------------------ tilings */

/** A piece placed in a box: which piece, its orientation and its cells (box cells, y up from the floor). */
export interface Placement {
  piece: number;
  orientation: Orientation;
  x: number;
  y: number;
  /** Its cells as x0, y0, x1, y1 … in the box. */
  cells: Int16Array;
}

function place(piece: number, orientation: Orientation, x: number, y: number): Placement {
  const cells = new Int16Array(2 * orientation.cells.length);
  orientation.cells.forEach(([cx, cy], i) => {
    cells[2 * i] = x + cx;
    cells[2 * i + 1] = y + cy;
  });
  return { piece, orientation, x, y, cells };
}

/**
 * A valid drop order of a tiling (indices into `pieces`), or null when there is none: the topological order of "is directly
 * below" (lowest first, then leftmost, then by index). `w` × `h` is the box; every cell must belong to exactly one piece.
 */
export function dropOrder(pieces: readonly Placement[], w: number, h: number): number[] | null {
  const owner = new Int32Array(w * h).fill(-1);
  pieces.forEach((p, i) => {
    for (let k = 0; k < p.cells.length; k += 2) owner[p.cells[k + 1] * w + p.cells[k]] = i;
  });
  const n = pieces.length;
  const indegree = new Int32Array(n);
  const edges: number[][] = Array.from({ length: n }, () => []);
  const seen = new Set<number>();
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = owner[(y - 1) * w + x];
      const b = owner[y * w + x];
      if (a < 0 || b < 0 || a === b) continue;
      const key = a * n + b;
      if (seen.has(key)) continue;
      seen.add(key);
      edges[a].push(b);
      indegree[b]++;
    }
  }
  const minY = pieces.map((p) => {
    let m = Infinity;
    for (let k = 1; k < p.cells.length; k += 2) if (p.cells[k] < m) m = p.cells[k];
    return m;
  });
  const minX = pieces.map((p) => {
    let m = Infinity;
    for (let k = 0; k < p.cells.length; k += 2) if (p.cells[k] < m) m = p.cells[k];
    return m;
  });
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) ready.push(i);
  const order: number[] = [];
  while (ready.length > 0) {
    let best = 0;
    for (let k = 1; k < ready.length; k++) {
      const a = ready[k];
      const b = ready[best];
      if (minY[a] < minY[b] || (minY[a] === minY[b] && (minX[a] < minX[b] || (minX[a] === minX[b] && a < b)))) best = k;
    }
    const i = ready[best];
    ready[best] = ready[ready.length - 1];
    ready.pop();
    order.push(i);
    for (const j of edges[i]) if (--indegree[j] === 0) ready.push(j);
  }
  return order.length === n ? order : null;
}

/** Why a box has no plan: its area is not the set's ("size"), no tiling can be dropped ("none") or the search ran out ("budget"). */
export type TilingStatus = "ok" | "size" | "none" | "budget";

export interface BoxTiling {
  status: TilingStatus;
  w: number;
  h: number;
  /** The pieces in drop order (empty without a plan). */
  pieces: Placement[];
  /** Tilings the search met (exact covers) and the ones it rejected for having no drop order. */
  tilings: number;
  rejected: number;
}

/** Link updates an exact-cover search may spend: a 6 × 10 box meets a droppable tiling within a few hundred thousand, the whole
 * 3 × 20 search (its 8 tilings, none droppable) takes about 11 million. */
export const PF_COVER_BUDGET = 16_000_000;
/** Plans kept in the memo (per set, box and seed). */
export const PF_MEMO_SIZE = 96;
const MEMO = new Map<string, BoxTiling>();

function memoGet(key: string): BoxTiling | undefined {
  const hit = MEMO.get(key);
  if (hit) {
    MEMO.delete(key);
    MEMO.set(key, hit);
  }
  return hit;
}

function memoSet(key: string, value: BoxTiling) {
  MEMO.set(key, value);
  while (MEMO.size > PF_MEMO_SIZE) MEMO.delete(MEMO.keys().next().value as string);
}

/** Forgets the memoised plans (tests). */
export function clearPolyominoMemo() {
  MEMO.clear();
}

/**
 * Every exact cover of a `w` × `h` box by each piece of `set` exactly once, in the seed's search order (`onTiling` returns true
 * to stop). The box must hold exactly the set's cells.
 */
export function searchTilings(set: PieceSet, w: number, h: number, seed: number, onTiling: (pieces: Placement[]) => boolean, budget = PF_COVER_BUDGET, droppableOnly = false): ExactCoverStats {
  const random = seededRandom(seed);
  const cells = w * h;
  const placements: Placement[] = [];
  const rows: number[][] = [];
  set.orientations.forEach((list, piece) => {
    for (const o of list) {
      for (let y = 0; y + o.height <= h; y++) {
        for (let x = 0; x + o.width <= w; x++) {
          const p = place(piece, o, x, y);
          const row: number[] = [];
          for (let k = 0; k < p.cells.length; k += 2) row.push(p.cells[k + 1] * w + p.cells[k]);
          row.push(cells + piece);
          placements.push(p);
          rows.push(row);
        }
      }
    }
  });
  // the seeded orders: the rows of every column, and the columns' tie-break
  const order = shuffle(rows.map((_, i) => i), random);
  const rank = shuffle(Array.from({ length: cells + set.pieces.length }, (_, i) => i), random);
  const dlx = new DancingLinks(cells + set.pieces.length, order.map((i) => rows[i]), rank);
  const guard = droppableOnly ? new DropGuard(w, h, set.pieces.length, (r) => placements[order[r]]) : undefined;
  return dlx.search((chosen) => onTiling(chosen.map((r) => placements[order[r]])), budget, guard);
}

/**
 * The drop-order check inside the search: a placement that closes a cycle of "is directly below" with the pieces already
 * placed can never be part of a droppable tiling (the cycle stays whatever is added), so the search rejects it there and
 * moves on. Pieces are numbered by the depth they were placed at; `below[i]` holds a bit per piece directly above piece i.
 */
class DropGuard implements CoverGuard {
  private readonly owner: Int32Array;
  private readonly count: Int32Array;
  private readonly below: Int32Array;

  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly n: number,
    private readonly placementOf: (row: number) => Placement,
  ) {
    this.owner = new Int32Array(w * h).fill(-1);
    this.count = new Int32Array(n * n);
    this.below = new Int32Array(n);
  }

  private link(a: number, b: number, d: number) {
    const k = a * this.n + b;
    this.count[k] += d;
    if (this.count[k] > 0) this.below[a] |= 1 << b;
    else this.below[a] &= ~(1 << b);
  }

  private touch(p: Placement, k: number, d: number) {
    const { owner, w, h } = this;
    for (let i = 0; i < p.cells.length; i += 2) {
      const x = p.cells[i];
      const y = p.cells[i + 1];
      if (y > 0) {
        const a = owner[(y - 1) * w + x];
        if (a >= 0 && a !== k) this.link(a, k, d);
      }
      if (y + 1 < h) {
        const b = owner[(y + 1) * w + x];
        if (b >= 0 && b !== k) this.link(k, b, d);
      }
    }
  }

  enter(row: number, depth: number): boolean {
    const p = this.placementOf(row);
    for (let i = 0; i < p.cells.length; i += 2) this.owner[p.cells[i + 1] * this.w + p.cells[i]] = depth;
    this.touch(p, depth, 1);
    // a cycle through the new piece: it reaches itself
    let reach = this.below[depth];
    let frontier = reach;
    while (frontier !== 0) {
      const i = 31 - Math.clz32(frontier);
      frontier &= ~(1 << i);
      const next = this.below[i] & ~reach;
      reach |= next;
      frontier |= next;
    }
    if ((reach >> depth) & 1) {
      this.leave(row, depth);
      return false;
    }
    return true;
  }

  leave(row: number, depth: number) {
    const p = this.placementOf(row);
    this.touch(p, depth, -1);
    for (let i = 0; i < p.cells.length; i += 2) this.owner[p.cells[i + 1] * this.w + p.cells[i]] = -1;
  }
}

/**
 * The first tiling of a `w` × `h` box by `set` (each piece once) in the seed's order that can be built by dropping, its pieces
 * in drop order (memoised per set, box and seed). The set's area must be the box's ("size" otherwise).
 */
export function tileBox(set: PieceSet, w: number, h: number, seed: number): BoxTiling {
  const key = `${set.id}:${w}x${h}:${seed | 0}`;
  const hit = memoGet(key);
  if (hit) return hit;
  const out: BoxTiling = { status: "none", w, h, pieces: [], tilings: 0, rejected: 0 };
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) || w * h !== set.pieces.length * set.size) {
    out.status = "size";
    memoSet(key, out);
    return out;
  }
  const stats = searchTilings(set, w, h, seed, (pieces) => {
    out.tilings++;
    const order = dropOrder(pieces, w, h);
    if (!order) {
      out.rejected++;
      return false;
    }
    out.pieces = order.map((i) => pieces[i]);
    out.status = "ok";
    return true;
  }, PF_COVER_BUDGET, set.pieces.length <= 31);
  if (out.status !== "ok" && stats.exhausted) out.status = "budget";
  memoSet(key, out);
  return out;
}

/**
 * Drops `pieces` one by one straight down from above a `w`-wide box (in the given order, each in its final column and
 * orientation) and returns, for each, the rows it came to rest above its target – 0 when it lands exactly on its target, more
 * when something above blocked its way down or it would have to slide under an overhang. The tests' proof that a drop order is
 * real.
 */
export function simulateDrops(pieces: readonly Placement[], w: number, h: number): number[] {
  const top = h + 8;
  const filled = new Uint8Array(w * top);
  const out: number[] = [];
  for (const p of pieces) {
    let minY = Infinity;
    for (let k = 1; k < p.cells.length; k += 2) if (p.cells[k] < minY) minY = p.cells[k];
    const free = (o: number) => {
      for (let k = 0; k < p.cells.length; k += 2) {
        const y = p.cells[k + 1] + o;
        if (y < 0) return false;
        if (y < top && filled[y * w + p.cells[k]]) return false;
      }
      return true;
    };
    // from just above the box straight down until the next row down is taken (or the floor)
    let offset = h + 1 - minY;
    while (free(offset - 1)) offset--;
    out.push(offset);
    for (let k = 0; k < p.cells.length; k += 2) {
      const y = p.cells[k + 1] + offset;
      if (y >= 0 && y < top) filled[y * w + p.cells[k]] = 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Tetris perfect clears */

/** Hole-free drops a block's search may try before it falls back to a plain tiling. */
export const PF_CLEAR_BUDGET = 60_000;
/** The largest block a search fills at once (columns × rows); a wider or taller chunk is cut into blocks that stack and sit side by side. */
export const PF_BLOCK_COLS = 10;
export const PF_BLOCK_ROWS = 12;
/** Solved blocks a size keeps in its library: a block's seed picks one of them (and the chunk's seed mirrors the whole). */
export const PF_BLOCK_LIBRARY = 16;

export interface ClearChunk {
  w: number;
  lines: number;
  /** The pieces in drop order (tetromino indices into TETROMINOES). */
  pieces: Placement[];
  /** The column of the last vertical I (−1: none), and whether a block fell back to a plain tiling. */
  iColumn: number;
  fallback: boolean;
}

const CLEAR_MEMO = new Map<string, ClearChunk | null>();
const BLOCK_MEMO = new Map<string, Placement[] | null>();

function memoPut<V>(memo: Map<string, V>, key: string, value: V, size = PF_MEMO_SIZE) {
  memo.set(key, value);
  while (memo.size > size) memo.delete(memo.keys().next().value as string);
}

/** The plain droppable tiling of a `w` × `h` block: vertical Is (h a multiple of 4), horizontal Is (w a multiple of 4) or Os; null when none. */
function plainBlock(w: number, h: number): Placement[] | null {
  const I = TETROMINO_SET.orientations[0];
  const vertical = I.find((o) => o.height === 4)!;
  const flat = I.find((o) => o.width === 4)!;
  const O = TETROMINO_SET.orientations[1][0];
  const out: Placement[] = [];
  if (h % 4 === 0) {
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x++) out.push(place(0, vertical, x, y));
  } else if (w % 4 === 0) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x += 4) out.push(place(0, flat, x, y));
  } else if (w % 2 === 0 && h % 2 === 0) {
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) out.push(place(1, O, x, y));
  } else return w === 0 || h === 0 ? [] : null;
  return out;
}

/**
 * A `w` × `h` block filled by hole-free tetromino drops – every piece lands exactly on the stack, in its final column and
 * rotation – found by a seeded search: the lowest, leftmost empty cell is always the next one covered (Algorithm X on the
 * cells, its rows the drops that fit the stack there). Null when the search runs out of `budget`.
 */
function solveBlock(w: number, h: number, seed: number, budget: number): Placement[] | null {
  const key = `${w}x${h}:${seed}`;
  if (BLOCK_MEMO.has(key)) return BLOCK_MEMO.get(key)!;
  const random = seededRandom(seed);
  const heights = new Int32Array(w);
  const placed: Placement[] = [];
  const orientations: { piece: number; o: Orientation }[] = [];
  TETROMINO_SET.orientations.forEach((list, piece) => list.forEach((o) => orientations.push({ piece, o })));
  let nodes = 0;
  // every run of columns not yet full holds a multiple of 4 empty cells (else it can never be filled)
  const fillable = () => {
    let area = 0;
    for (let x = 0; x <= w; x++) {
      if (x === w || heights[x] >= h) {
        if (area % 4 !== 0) return false;
        area = 0;
      } else area += h - heights[x];
    }
    return true;
  };
  const dfs = (): boolean => {
    if (nodes++ > budget) return false;
    let c = -1;
    for (let x = 0; x < w; x++) if (heights[x] < h && (c < 0 || heights[x] < heights[c])) c = x;
    if (c < 0) return true;
    const candidates: Placement[] = [];
    for (const { piece, o } of orientations) {
      for (let j = 0; j < o.width; j++) {
        const x0 = c - j;
        if (x0 < 0 || x0 + o.width > w) continue;
        const y0 = heights[c] - o.bottom[j];
        let fits = y0 >= 0;
        for (let k = 0; k < o.width && fits; k++) if (y0 + o.bottom[k] !== heights[x0 + k] || y0 + o.top[k] >= h) fits = false;
        if (fits) candidates.push(place(piece, o, x0, y0));
      }
    }
    shuffle(candidates, random);
    for (const p of candidates) {
      const o = p.orientation;
      for (let k = 0; k < o.width; k++) heights[p.x + k] = p.y + o.top[k] + 1;
      placed.push(p);
      if (fillable() && dfs()) return true;
      placed.pop();
      for (let k = 0; k < o.width; k++) heights[p.x + k] = p.y + o.bottom[k];
      if (nodes > budget) return false;
    }
    return false;
  };
  const out = dfs() ? placed.slice() : null;
  memoPut(BLOCK_MEMO, key, out, PF_MEMO_SIZE * 4);
  return out;
}

/** Splits `total` into near-equal parts, each a multiple of `unit` and at most `max` (`total` a multiple of `unit`). */
function splitEven(total: number, unit: number, max: number): number[] {
  if (total <= 0) return [];
  const units = Math.round(total / unit);
  const per = Math.max(1, Math.floor(max / unit));
  const parts = Math.ceil(units / per);
  const base = Math.floor(units / parts);
  const extra = units - base * parts;
  return Array.from({ length: parts }, (_, i) => (base + (i < extra ? 1 : 0)) * unit);
}

/** The bands of a chunk's rows: one up to PF_BLOCK_ROWS, else bands of 8 and a last one of 5–12 (the same rows mod 4). */
function splitBands(lines: number): number[] {
  if (lines <= PF_BLOCK_ROWS) return [lines];
  const out: number[] = [];
  let left = lines;
  while (left > PF_BLOCK_ROWS) {
    out.push(8);
    left -= 8;
  }
  out.push(left);
  return out;
}

/**
 * A perfect-clear chunk: `lines` rows of a `w`-wide well filled by hole-free tetromino drops, in drop order (lowest first).
 * Four lines keep a seeded column for a vertical I that lands last – no row is full before it; any other height fills the
 * whole width and its rows are held until the last piece lands. A chunk wider than PF_BLOCK_COLS or taller than
 * PF_BLOCK_ROWS is made of blocks side by side and bands stacked (each block one of its size's PF_BLOCK_LIBRARY solutions);
 * the seed picks them and mirrors the chunk. Null when `w` × `lines` is not a multiple of 4 (no tetromino tiling). Memoised
 * per size and seed.
 */
export function planPerfectClear(w: number, lines: number, seed: number, budget = PF_CLEAR_BUDGET): ClearChunk | null {
  const key = `${w}x${lines}:${seed | 0}`;
  if (CLEAR_MEMO.has(key)) return CLEAR_MEMO.get(key)!;
  const result = solveClear(w, lines, seed, budget);
  memoPut(CLEAR_MEMO, key, result);
  return result;
}

function solveClear(w: number, lines: number, seed: number, budget: number): ClearChunk | null {
  if (!(Number.isInteger(w) && Number.isInteger(lines) && w > 0 && lines > 0) || (w * lines) % 4 !== 0) return null;
  const random = seededRandom(seed);
  const iColumn = lines === 4 ? Math.floor(random() * w) : -1;
  const segments: [number, number][] = iColumn >= 0 ? [[0, iColumn], [iColumn + 1, w]] : [[0, w]];
  const parts: Placement[] = [];
  let fallback = false;
  let y0 = 0;
  for (const hb of splitBands(lines)) {
    const unit = hb % 4 === 0 ? 1 : hb % 2 === 0 ? 2 : 4;
    for (const [x0, x1] of segments) {
      let bx = x0;
      for (const bw of splitEven(x1 - x0, unit, PF_BLOCK_COLS)) {
        let block = solveBlock(bw, hb, Math.floor(random() * PF_BLOCK_LIBRARY), budget);
        if (!block) {
          block = plainBlock(bw, hb);
          fallback = true;
        }
        if (!block) return null;
        for (const p of block) parts.push(place(p.piece, p.orientation, p.x + bx, p.y + y0));
        bx += bw;
      }
    }
    y0 += hb;
  }
  const order = dropOrder(parts, w, lines);
  if (!order) return null;
  let pieces = order.map((i) => parts[i]);
  if (iColumn >= 0) pieces.push(place(0, TETROMINO_SET.orientations[0].find((o) => o.height === 4)!, iColumn, 0));
  // the seeded mirror: x → w − 1 − x (an S becomes a Z, a J an L)
  if (random() < 0.5) {
    pieces = pieces.map((p) => {
      const cells: Cell[] = [];
      let minX = Infinity;
      let minY = Infinity;
      for (let k = 0; k < p.cells.length; k += 2) {
        const x = w - 1 - p.cells[k];
        const y = p.cells[k + 1];
        cells.push([x, y]);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
      const o = normalise(cells);
      return place(TETROMINO_OF_KEY.get(o.key) ?? p.piece, o, minX, minY);
    });
    // a mirrored row-by-row order reads right to left: lowest first, leftmost first again (the I stays last)
    const body = iColumn >= 0 ? pieces.slice(0, -1) : pieces;
    const again = dropOrder(body, w, lines);
    if (again) pieces = [...again.map((i) => body[i]), ...(iColumn >= 0 ? [pieces[pieces.length - 1]] : [])];
    return { w, lines, pieces, iColumn: iColumn >= 0 ? w - 1 - iColumn : -1, fallback };
  }
  return { w, lines, pieces, iColumn, fallback };
}

/* ------------------------------------------------------------------ the classic counts */

/** Tilings of the classic boxes by the 12 pentominoes, rotations and reflections of the whole not counted. */
export const PENTOMINO_WAYS: Readonly<Record<string, number>> = { "6x10": 2339, "5x12": 1010, "4x15": 368, "3x20": 2 };

/** The classic count of a box (either way round), or null for any other size. */
export function pentominoWays(w: number, h: number): number | null {
  const a = Math.min(w, h);
  const b = Math.max(w, h);
  return PENTOMINO_WAYS[`${a}x${b}`] ?? null;
}

/* ------------------------------------------------------------------ the run's plan */

export const PF_VARIANTS = ["pento", "tetris"] as const;
export type PfVariant = (typeof PF_VARIANTS)[number];

export function isPfVariant(value: unknown): value is PfVariant {
  return typeof value === "string" && (PF_VARIANTS as readonly string[]).includes(value);
}

/** A piece's flight, as fractions of the reference 0.55 s a piece: the lift out of the tray, the travel, the fall and the squash. */
export const PF_REF_SEC = 0.55;
export const PF_LIFT = 0.12;
export const PF_TRAVEL = 0.15;
export const PF_FALL = 0.25;
export const PF_SQUASH = 0.08;
/** A rectangle's completion: the flash, the scatter of its unit squares and the label's crossfade (s). */
export const PF_FLASH_SEC = 0.15;
export const PF_SCATTER_SEC = 0.8;
export const PF_FADE_SEC = 0.5;
/** A box without a plan is shown with its label this long, then fades like a completion (s). */
export const PF_NO_WAY_SEC = 1.5;
/** Tetris: each section's pieces fall this much faster than the last's; a clear's banner, the hard silence after it, the finale's flash and the empty well before the loop (s). */
export const PF_TETRIS_SPEEDUP = 0.82;
export const PF_CLEAR_SEC = 0.55;
export const PF_GAP_SEC = 0.3;
export const PF_FINALE_SEC = 1;
export const PF_EMPTY_SEC = 0.5;
/** The scatter's gravity (cells / s²) and its launch speeds (cells / s). */
export const PF_SCATTER_G = 26;
/** The ladder wraps after this many degrees (2.5 octaves of the pentatonic). */
export const PF_LADDER_WRAP = 13;
/** Pieces a run plans at most (Tetris: well width × lines ÷ 4); past it the sections are cut short. */
export const PF_PIECE_CEILING = 10_000;

/** A piece of the plan: what it is, where it lands and when. */
export interface PfPiece {
  /** Index into its set (PENTOMINOES or TETROMINOES), its name and colour. */
  kind: number;
  name: string;
  color: string;
  /** Its cells in the box (x right, y up from the floor), its orientation and its bounding box. */
  cells: Int16Array;
  orientation: Orientation;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Lift start (Tetris: the spawn just above the well) and landing (s, run time). */
  tLift: number;
  tLand: number;
  /** Resting on the box's floor. */
  floor: boolean;
}

/** A rectangle (pentominoes) or a perfect-clear chunk (Tetris) of the plan, with its timeline. */
export interface PfPuzzle {
  variant: PfVariant;
  /** Box cells (Tetris: the well's width and drawn height). */
  w: number;
  h: number;
  /** Tetris: the rows the chunk fills and clears. */
  lines: number;
  status: TilingStatus;
  /** The classic count of tilings of the box (pentominoes; null for another size). */
  ways: number | null;
  pieces: PfPiece[];
  /** Start, the completion (the last landing; a box without a plan: when its label starts to fade) and the end (s). */
  t0: number;
  tDone: number;
  tEnd: number;
  /** The completion's phases (s): pentominoes flash, scatter, fade; Tetris the banner (clear), the silence (gap). */
  flashSec: number;
  scatterSec: number;
  fadeSec: number;
  clearSec: number;
  gapSec: number;
  /** Tetris: the loop's last chunk (the cream flash, then the empty well) and the lines cleared before it in the loop. */
  final: boolean;
  linesBefore: number;
  /** Pieces resting on the floor. */
  floor: number;
  /** The seconds a piece takes (its slot). */
  slot: number;
  /** Pentominoes: each unit square's scatter – vx, vy (cells / s, up positive) and spin (rad / s) – in the order of the pieces' cells. */
  scatter: Float32Array;
}

/** A sound or a count of the plan, at its run time. */
export interface PfEvent {
  t: number;
  kind: "lift" | "land" | "complete" | "clear" | "cut" | "final";
  puzzle: number;
  piece: number;
  /** The ladder's degree (lift; Tetris: land) and whether it is the last piece of its rectangle or chunk. */
  degree: number;
  last: boolean;
  /** Tetris: the lines a clear clears. */
  lines: number;
}

export interface PerfectFitPlanInput {
  variant: PfVariant;
  /** Pentominoes: the boxes, W × H each. */
  boxes: readonly { w: number; h: number }[];
  /** Seconds a piece takes (Tetris: in the first section). */
  pieceSec: number;
  /** Tetris: lines per section, the well's width and height, and whether the last section holds its rows until its last piece. */
  sections: readonly number[];
  wellW: number;
  wellH: number;
  hold: boolean;
  /** 0: free timing; else every landing on a grid of this beat (s). */
  beatSec: number;
  /** The solution seed. */
  seed: number;
}

export interface PerfectFitPlan {
  variant: PfVariant;
  puzzles: PfPuzzle[];
  events: PfEvent[];
  /** The loop (s): the run repeats from its start, every seam with an empty box. */
  loopSec: number;
  /** Rectangles built in a loop (pentominoes) and the lines cleared in a loop (Tetris); pieces in a loop. */
  rects: number;
  lines: number;
  pieceCount: number;
  /** Pieces resting on the floor in all the rectangles (the finder's "most on the floor"). */
  floor: number;
  /** The largest box or well (cells), for the layout. */
  maxW: number;
  maxH: number;
  /** The beat the timing follows (0: free) and the solution seed. */
  beatSec: number;
  seed: number;
  /** Sections or boxes left out (Tetris: no tetromino tiling; past the piece ceiling). */
  skipped: number;
}

/** A slot on the beat grid: the beat × the power of two nearest `sec` / beat (… ¼, ½, 1, 2 … beats). */
export function beatSlot(sec: number, beatSec: number): number {
  if (!(beatSec > 0)) return sec;
  const k = Math.round(Math.log2(Math.max(1e-6, sec) / beatSec));
  return beatSec * Math.pow(2, Math.max(-6, Math.min(6, k)));
}

/** `sec` rounded up to whole beats (free timing: as it is). */
function onGrid(sec: number, beatSec: number): number {
  return beatSec > 0 ? Math.max(1, Math.ceil(sec / beatSec - 1e-9)) * beatSec : sec;
}

/** `t` moved up to the next whole beat (free timing: as it is). */
function nextBeat(t: number, beatSec: number): number {
  return beatSec > 0 ? Math.ceil(t / beatSec - 1e-9) * beatSec : t;
}

function pieceOf(set: PieceSet, p: Placement): PfPiece {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < p.cells.length; k += 2) {
    const x = p.cells[k];
    const y = p.cells[k + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const def = set.pieces[p.piece];
  return { kind: p.piece, name: def.name, color: def.color, cells: p.cells, orientation: p.orientation, minX, maxX, minY, maxY, tLift: 0, tLand: 0, floor: minY === 0 };
}

function emptyPuzzle(variant: PfVariant, w: number, h: number, status: TilingStatus): PfPuzzle {
  return { variant, w, h, lines: 0, status, ways: variant === "pento" ? pentominoWays(w, h) : null, pieces: [], t0: 0, tDone: 0, tEnd: 0, flashSec: 0, scatterSec: 0, fadeSec: 0, clearSec: 0, gapSec: 0, final: false, linesBefore: 0, floor: 0, slot: 0, scatter: new Float32Array(0) };
}

/** The pentomino rectangles' timeline: 12 slots a box, landing at the end of each slot, then the completion. */
function planPentominoes(input: PerfectFitPlanInput, puzzles: PfPuzzle[], events: PfEvent[]): number {
  const beat = input.beatSec;
  const slot = beatSlot(Math.max(1e-3, input.pieceSec), beat);
  const sc = slot / PF_REF_SEC;
  const flight = (PF_LIFT + PF_TRAVEL + PF_FALL) * sc;
  let t = 0;
  input.boxes.forEach((box, b) => {
    const seed = mixSeed(input.seed, b + 1);
    const tiling = tileBox(PENTOMINO_SET, box.w, box.h, seed);
    const puzzle = emptyPuzzle("pento", box.w, box.h, tiling.status);
    puzzle.t0 = t;
    puzzle.slot = slot;
    const index = puzzles.length;
    if (tiling.status === "ok") {
      puzzle.pieces = tiling.pieces.map((p) => pieceOf(PENTOMINO_SET, p));
      puzzle.pieces.forEach((piece, k) => {
        piece.tLand = t + (k + 1) * slot;
        piece.tLift = piece.tLand - flight;
        events.push({ t: Math.max(0, piece.tLift), kind: "lift", puzzle: index, piece: k, degree: k % PF_LADDER_WRAP, last: k === puzzle.pieces.length - 1, lines: 0 });
        events.push({ t: piece.tLand, kind: "land", puzzle: index, piece: k, degree: k % PF_LADDER_WRAP, last: k === puzzle.pieces.length - 1, lines: 0 });
      });
      puzzle.floor = puzzle.pieces.filter((p) => p.floor).length;
      puzzle.tDone = t + puzzle.pieces.length * slot;
      const total = onGrid(PF_FLASH_SEC + PF_SCATTER_SEC + PF_FADE_SEC, beat);
      const k = total / (PF_FLASH_SEC + PF_SCATTER_SEC + PF_FADE_SEC);
      puzzle.flashSec = PF_FLASH_SEC * k;
      puzzle.scatterSec = PF_SCATTER_SEC * k;
      puzzle.fadeSec = PF_FADE_SEC * k;
      puzzle.tEnd = puzzle.tDone + total;
      events.push({ t: puzzle.tDone, kind: "complete", puzzle: index, piece: -1, degree: 0, last: true, lines: 0 });
      // the scatter: every unit square flies out from the box's middle, seeded per box
      const random = seededRandom(mixSeed(seed, 0x5ca7));
      const n = puzzle.pieces.reduce((s, p) => s + p.cells.length / 2, 0);
      puzzle.scatter = new Float32Array(3 * n);
      let i = 0;
      for (const p of puzzle.pieces) {
        for (let c = 0; c < p.cells.length; c += 2) {
          const dx = p.cells[c] + 0.5 - box.w / 2;
          const dy = p.cells[c + 1] + 0.5 - box.h / 2;
          puzzle.scatter[i++] = 1.6 * dx + (random() - 0.5) * 6;
          puzzle.scatter[i++] = 6 + 1.2 * dy + random() * 7;
          puzzle.scatter[i++] = (random() - 0.5) * 16;
        }
      }
    } else {
      puzzle.tDone = t + onGrid(PF_NO_WAY_SEC, beat);
      puzzle.fadeSec = onGrid(PF_FADE_SEC, beat);
      puzzle.tEnd = puzzle.tDone + puzzle.fadeSec;
    }
    puzzles.push(puzzle);
    t = nextBeat(puzzle.tEnd, beat);
    puzzle.tEnd = t;
  });
  return t;
}

/** The Tetris chunks of the sections: four-line chunks, a held finale, the rest split into fours (hold off). */
export function tetrisChunks(sections: readonly number[], hold: boolean): { lines: number; section: number }[] {
  const out: { lines: number; section: number }[] = [];
  sections.forEach((lines, s) => {
    const L = Math.max(0, Math.floor(lines));
    if (L <= 0) return;
    const last = s === sections.length - 1;
    if (L <= 4 || (last && hold)) {
      out.push({ lines: L, section: s });
      return;
    }
    let left = L;
    while (left > 0) {
      const take = left >= 4 ? 4 : left;
      out.push({ lines: take, section: s });
      left -= take;
    }
  });
  return out;
}

function planTetris(input: PerfectFitPlanInput, puzzles: PfPuzzle[], events: PfEvent[]): { end: number; skipped: number } {
  const beat = input.beatSec;
  const w = Math.max(1, Math.floor(input.wellW));
  const chunks = tetrisChunks(input.sections, input.hold);
  const tallest = chunks.reduce((m, c) => Math.max(m, c.lines), 0);
  const wellH = Math.max(Math.floor(input.wellH), tallest);
  let t = 0;
  let lines = 0;
  let skipped = 0;
  let pieces = 0;
  const kept: { chunk: ClearChunk; section: number }[] = [];
  chunks.forEach((c, i) => {
    const chunk = planPerfectClear(w, c.lines, mixSeed(input.seed, 0x7e7 + i));
    if (!chunk || pieces + chunk.pieces.length > PF_PIECE_CEILING) {
      skipped++;
      return;
    }
    pieces += chunk.pieces.length;
    kept.push({ chunk, section: c.section });
  });
  kept.forEach(({ chunk, section }, i) => {
    const final = i === kept.length - 1;
    const slot = beatSlot(Math.max(1e-3, input.pieceSec) * Math.pow(PF_TETRIS_SPEEDUP, section), beat);
    const puzzle = emptyPuzzle("tetris", w, wellH, "ok");
    const index = puzzles.length;
    puzzle.t0 = t;
    puzzle.slot = slot;
    puzzle.lines = chunk.lines;
    puzzle.final = final;
    puzzle.linesBefore = lines;
    puzzle.pieces = chunk.pieces.map((p) => pieceOf(TETROMINO_SET, p));
    puzzle.pieces.forEach((piece, k) => {
      piece.tLand = t + (k + 1) * slot;
      piece.tLift = piece.tLand - slot;
      events.push({ t: piece.tLand, kind: "land", puzzle: index, piece: k, degree: k % PF_LADDER_WRAP, last: k === puzzle.pieces.length - 1, lines: 0 });
    });
    puzzle.floor = puzzle.pieces.filter((p) => p.floor).length;
    puzzle.tDone = t + puzzle.pieces.length * slot;
    lines += chunk.lines;
    if (final) {
      puzzle.flashSec = onGrid(PF_FINALE_SEC, beat);
      puzzle.gapSec = onGrid(PF_EMPTY_SEC, beat);
      puzzle.tEnd = puzzle.tDone + puzzle.flashSec + puzzle.gapSec;
      events.push({ t: puzzle.tDone, kind: "final", puzzle: index, piece: -1, degree: 0, last: true, lines: chunk.lines });
    } else {
      puzzle.clearSec = onGrid(PF_CLEAR_SEC, beat);
      puzzle.gapSec = beat > 0 ? onGrid(PF_GAP_SEC, beat / 2) : PF_GAP_SEC;
      puzzle.tEnd = puzzle.tDone + puzzle.clearSec + puzzle.gapSec;
      events.push({ t: puzzle.tDone, kind: "clear", puzzle: index, piece: -1, degree: 0, last: true, lines: chunk.lines });
      events.push({ t: puzzle.tDone + puzzle.clearSec, kind: "cut", puzzle: index, piece: -1, degree: 0, last: false, lines: 0 });
    }
    puzzles.push(puzzle);
    t = nextBeat(puzzle.tEnd, beat);
    puzzle.tEnd = t;
  });
  return { end: t, skipped };
}

/**
 * The run's plan: every rectangle or chunk with its pieces in drop order and its timeline, the sound events in time order and
 * the loop. Pentominoes: each piece takes a slot (`pieceSec`; on the beat grid when `beatSec` > 0) and lands at its end, so
 * a box of 12 lands at 1 … 12 slots after its start, then flashes, scatters and fades (1.45 s). Tetris: a piece spawns just
 * above the well and falls at a constant speed through its slot, every section's slot `PF_TETRIS_SPEEDUP` × the last's; each
 * chunk clears under its banner and a hard silence follows, the last one flashes cream-white and leaves the well empty.
 */
export function planPerfectFit(input: PerfectFitPlanInput): PerfectFitPlan {
  const puzzles: PfPuzzle[] = [];
  const events: PfEvent[] = [];
  let end = 0;
  let skipped = 0;
  if (input.variant === "tetris") {
    const r = planTetris(input, puzzles, events);
    end = r.end;
    skipped = r.skipped;
  } else {
    end = planPentominoes(input, puzzles, events);
    skipped = puzzles.filter((p) => p.status !== "ok").length;
  }
  // a loop of whole bars on the beat; the extra time is the last puzzle's (an empty box or well)
  let loopSec = Math.max(end, 1e-3);
  if (input.beatSec > 0) loopSec = Math.max(4 * input.beatSec, Math.ceil(loopSec / (4 * input.beatSec) - 1e-9) * 4 * input.beatSec);
  if (puzzles.length > 0) puzzles[puzzles.length - 1].tEnd = loopSec;
  events.sort((a, b) => a.t - b.t || EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind]);
  let maxW = 1;
  let maxH = 1;
  for (const p of puzzles) {
    if (p.w > maxW) maxW = p.w;
    if (p.h > maxH) maxH = p.h;
  }
  return {
    variant: input.variant,
    puzzles,
    events,
    loopSec,
    rects: input.variant === "pento" ? puzzles.filter((p) => p.status === "ok").length : 0,
    lines: puzzles.reduce((s, p) => s + p.lines, 0),
    pieceCount: puzzles.reduce((s, p) => s + p.pieces.length, 0),
    floor: puzzles.reduce((s, p) => s + p.floor, 0),
    maxW,
    maxH,
    beatSec: input.beatSec > 0 ? input.beatSec : 0,
    seed: input.seed | 0,
    skipped,
  };
}

/** Events at one time: a landing before the completion it ends, the cut last. */
const EVENT_ORDER: Readonly<Record<PfEvent["kind"], number>> = { lift: 0, land: 1, complete: 2, clear: 2, final: 2, cut: 3 };

/* ------------------------------------------------------------------ the plan in time */

/** The puzzle shown at run time `t` (wrapped into the loop): its index (−1 without puzzles) and the time within the loop. */
export function puzzleAt(plan: PerfectFitPlan, t: number): { index: number; local: number } {
  const loop = plan.loopSec;
  const local = loop > 0 ? ((t % loop) + loop) % loop : 0;
  const list = plan.puzzles;
  if (list.length === 0) return { index: -1, local };
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t0 <= local + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return { index: lo, local };
}

/** The cells resting in the box or well at run time `t` (the landed pieces of the puzzle on show, until its rows go). */
export function occupiedCells(plan: PerfectFitPlan, t: number): number {
  const { index, local } = puzzleAt(plan, t);
  if (index < 0) return 0;
  const p = plan.puzzles[index];
  const gone = p.variant === "pento" ? p.tDone + p.flashSec : p.tDone + (p.final ? p.flashSec : p.clearSec);
  if (p.pieces.length > 0 && local >= gone - 1e-9) return 0;
  let n = 0;
  for (const piece of p.pieces) if (piece.tLand <= local + 1e-9) n += piece.cells.length / 2;
  return n;
}

/** The lines cleared so far in the loop at run time `t` (Tetris; back to 0 once the finale's flash is over). */
export function linesClearedAt(plan: PerfectFitPlan, t: number): number {
  const { index, local } = puzzleAt(plan, t);
  if (index < 0 || plan.variant !== "tetris") return 0;
  const p = plan.puzzles[index];
  if (p.final && local >= p.tDone + p.flashSec - 1e-9) return 0;
  return p.linesBefore + (local >= p.tDone - 1e-9 ? p.lines : 0);
}

/** The rectangles completed so far in the loop at run time `t` (pentominoes). */
export function rectsDoneAt(plan: PerfectFitPlan, t: number): number {
  const { index, local } = puzzleAt(plan, t);
  if (index < 0 || plan.variant !== "pento") return 0;
  let n = 0;
  for (let i = 0; i < index; i++) if (plan.puzzles[i].status === "ok") n++;
  const p = plan.puzzles[index];
  if (p.status === "ok" && local >= p.tDone - 1e-9) n++;
  return n;
}
