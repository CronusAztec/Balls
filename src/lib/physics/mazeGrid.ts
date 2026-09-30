/**
 * The Maze escape mode's grid (feature odd-maze; modes/maze.ts): a seeded perfect maze, its BFS distance map, the
 * playfield geometry and the collision of a ball against the walls of the cell its centre is in. Everything here is
 * pure and deterministic – the maze is carved with the caller's seeded `random()` (the engine's), nothing reads the
 * wall clock – so a seed replays exactly and the seed finder can search it; the resolvers mutate the ball in place and
 * never allocate, so they run in the hot loop.
 *
 * Cells are numbered row-major (`index = row * cols + col`), row 0 at the top. Directions are 0 = north (up, −y),
 * 1 = east, 2 = south (down, +y), 3 = west; `open[cell]` has bit `1 << d` set when the passage toward d is open. The
 * outer boundary is closed except for two gaps that are not passages of the grid: the entrance, in the top wall of the
 * entrance cell (a chute above it holds the balls before they drop in), and the exit, in the bottom wall of the exit cell.
 *
 * Walls are capsules of thickness `field.wall` on the lattice lines between cells; a lattice point where any wall ends
 * or meets another is a round post of the same thickness. A ball whose centre is in a cell can only touch that cell's
 * four edges and the posts at its four corners (a wall of a neighbouring cell reaches into the cell only through its end
 * cap, which is the post), so the collision looks at nothing else: a cell-indexed grid instead of a list of segments.
 * The edge tests are one-sided – a ball is pushed back into its cell whichever side of a closed edge its centre reached –
 * and the caller moves the ball in micro-steps no longer than half the contact distance (`MZ_MICRO_STEP`), so no ball
 * ever tunnels through a wall at any speed.
 */

export const MZ_N = 0;
export const MZ_E = 1;
export const MZ_S = 2;
export const MZ_W = 3;
/** Unit steps of the four directions (screen coordinates: +y is down). */
export const MZ_DX: readonly number[] = [0, 1, 0, -1];
export const MZ_DY: readonly number[] = [-1, 0, 1, 0];
export const MZ_OPPOSITE: readonly number[] = [2, 3, 0, 1];
export const MZ_BIT: readonly number[] = [1, 2, 4, 8];

/** Width and height of the box the maze is fitted into, as fractions of the square the recorder crops to (a portrait column). */
export const MZ_FIELD_WIDTH = 0.56;
export const MZ_FIELD_HEIGHT = 0.8;
/** A ball's radius is at most this fraction of a cell (the corridors stay a little wider than the balls). */
export const MZ_BALL_FRACTION = 0.27;
/** The walls are this fraction of a cell thick (at least `MZ_MIN_WALL` px). */
export const MZ_WALL_FRACTION = 0.1;
export const MZ_MIN_WALL = 1;
/** A micro-step moves a ball at most this fraction of its contact distance (radius + half the wall). */
export const MZ_MICRO_STEP = 0.45;

/** Rows of a maze of `cols` columns: the portrait aspect of the field, cells square. */
export function mazeRowsFor(cols: number): number {
  const c = Math.max(1, Math.round(cols));
  return Math.max(2, Math.round((c * MZ_FIELD_HEIGHT) / MZ_FIELD_WIDTH));
}

/* ------------------------------------------------------------------ the grid */

export interface MazeGrid {
  cols: number;
  rows: number;
  cells: number;
  /** Open passages per cell: bit `1 << d` toward direction d (the entrance and exit gaps are not in here). */
  open: Uint8Array;
  /** Column of the entrance gap in the top wall, and its cell (row 0). */
  entranceCol: number;
  entranceCell: number;
  /** Column of the exit gap in the bottom wall, and its cell (the last row). */
  exitCol: number;
  exitCell: number;
  /** Passages from every cell to the exit cell (BFS over the open passages); −1 where the exit cannot be reached. */
  dist: Int32Array;
  /** The largest distance in the maze. */
  maxDist: number;
  /** Lattice points ((cols + 1) × (rows + 1), row-major) where a wall ends or meets another: the round posts. */
  posts: Uint8Array;
}

/** The cell one step from `cell` toward `d`, or −1 beyond the outer wall. */
export function mazeNeighbour(cols: number, rows: number, cell: number, d: number): number {
  const col = cell % cols;
  const row = (cell - col) / cols;
  const c = col + MZ_DX[d];
  const r = row + MZ_DY[d];
  return c >= 0 && c < cols && r >= 0 && r < rows ? r * cols + c : -1;
}

/**
 * Carves a perfect maze (a spanning tree of the grid: every cell reachable from every other by exactly one path) with the
 * recursive backtracker, iteratively: from a random cell, step to a random unvisited neighbour and knock the wall down,
 * backtrack when there is none. `random()` draws, in order: the entrance column, the exit column, the start cell, then one
 * draw per step with more than one unvisited neighbour – the engine's seeded generator makes it replay exactly.
 */
export function generateMaze(cols: number, rows: number, random: () => number): MazeGrid {
  const C = Math.max(1, Math.round(cols));
  const R = Math.max(1, Math.round(rows));
  const n = C * R;
  const pick = (k: number) => Math.min(k - 1, Math.floor(random() * k));
  const entranceCol = pick(C);
  const exitCol = pick(C);
  const open = new Uint8Array(n);
  carveMaze(open, C, R, pick(n), random);
  const exitCell = (R - 1) * C + exitCol;
  const dist = mazeDistances(open, C, R, exitCell);
  let maxDist = 0;
  for (let i = 0; i < n; i++) if (dist[i] > maxDist) maxDist = dist[i];
  const grid: MazeGrid = { cols: C, rows: R, cells: n, open, entranceCol, entranceCell: entranceCol, exitCol, exitCell, dist, maxDist, posts: new Uint8Array((C + 1) * (R + 1)) };
  buildPosts(grid);
  return grid;
}

/** The recursive backtracker (an explicit stack, so a 40 × 57 maze never overflows the call stack). */
export function carveMaze(open: Uint8Array, cols: number, rows: number, start: number, random: () => number) {
  const n = cols * rows;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const choices = [0, 0, 0, 0];
  let top = 0;
  stack[top++] = start;
  visited[start] = 1;
  while (top > 0) {
    const c = stack[top - 1];
    let k = 0;
    for (let d = 0; d < 4; d++) {
      const nc = mazeNeighbour(cols, rows, c, d);
      if (nc >= 0 && !visited[nc]) choices[k++] = d;
    }
    if (k === 0) {
      top--;
      continue;
    }
    const d = k === 1 ? choices[0] : choices[Math.min(k - 1, Math.floor(random() * k))];
    const nc = mazeNeighbour(cols, rows, c, d);
    open[c] |= MZ_BIT[d];
    open[nc] |= MZ_BIT[MZ_OPPOSITE[d]];
    visited[nc] = 1;
    stack[top++] = nc;
  }
}

/** Breadth-first distances (in passages) from `target` over the open passages; −1 for a cell it cannot reach. */
export function mazeDistances(open: Uint8Array, cols: number, rows: number, target: number, out?: Int32Array): Int32Array {
  const n = cols * rows;
  const dist = out && out.length === n ? out : new Int32Array(n);
  dist.fill(-1);
  if (target < 0 || target >= n) return dist;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = target;
  dist[target] = 0;
  while (head < tail) {
    const c = queue[head++];
    for (let d = 0; d < 4; d++) {
      if (!(open[c] & MZ_BIT[d])) continue;
      const nc = mazeNeighbour(cols, rows, c, d);
      if (nc < 0 || dist[nc] >= 0) continue;
      dist[nc] = dist[c] + 1;
      queue[tail++] = nc;
    }
  }
  return dist;
}

/** Open passages of the grid (each counted once). A perfect maze of n cells has n − 1. */
export function mazePassageCount(grid: Pick<MazeGrid, "open" | "cells">): number {
  let bits = 0;
  for (let i = 0; i < grid.cells; i++) {
    const o = grid.open[i];
    bits += (o & 1) + ((o >> 1) & 1) + ((o >> 2) & 1) + ((o >> 3) & 1);
  }
  return bits / 2;
}

/** True when every cell can be reached from every other (BFS from cell 0 reaches them all). */
export function mazeConnected(grid: Pick<MazeGrid, "open" | "cols" | "rows" | "cells">): boolean {
  const dist = mazeDistances(grid.open, grid.cols, grid.rows, 0);
  for (let i = 0; i < grid.cells; i++) if (dist[i] < 0) return false;
  return true;
}

/** Whether the horizontal wall on lattice line `line` (0 = the top of the maze) over column `col` stands. */
export function mazeWallH(grid: MazeGrid, col: number, line: number): boolean {
  if (col < 0 || col >= grid.cols) return false;
  if (line === 0) return col !== grid.entranceCol;
  if (line === grid.rows) return col !== grid.exitCol;
  if (line < 0 || line > grid.rows) return false;
  return !(grid.open[(line - 1) * grid.cols + col] & MZ_BIT[MZ_S]);
}

/** Whether the vertical wall on lattice line `line` (0 = the left of the maze) beside row `row` stands. */
export function mazeWallV(grid: MazeGrid, line: number, row: number): boolean {
  if (row < 0 || row >= grid.rows || line < 0 || line > grid.cols) return false;
  if (line === 0 || line === grid.cols) return true;
  return !(grid.open[row * grid.cols + line - 1] & MZ_BIT[MZ_E]);
}

/** Marks the lattice points where a wall ends or meets another (the chute's side walls end at the entrance's two corners). */
function buildPosts(grid: MazeGrid) {
  const W = grid.cols + 1;
  for (let j = 0; j <= grid.rows; j++) {
    for (let i = 0; i <= grid.cols; i++) {
      const post = mazeWallH(grid, i - 1, j) || mazeWallH(grid, i, j) || mazeWallV(grid, i, j - 1) || mazeWallV(grid, i, j) || (j === 0 && (i === grid.entranceCol || i === grid.entranceCol + 1));
      grid.posts[j * W + i] = post ? 1 : 0;
    }
  }
}

/* ------------------------------------------------------------------ the field */

export interface MazeField {
  /** The maze's rectangle (px): its top-left corner and size. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Side of a cell and the wall thickness (px). */
  cell: number;
  wall: number;
  /** The centred square the recorder crops to (its corner and side, px). */
  sx: number;
  sy: number;
  side: number;
}

/** The maze's place on a canvas of `width` × `height`: cells as big as fit the portrait column of the centred square. */
export function buildMazeField(width: number, height: number, cols: number, rows: number, out?: MazeField): MazeField {
  const f = out ?? ({} as MazeField);
  const side = Math.max(60, Math.min(width, height));
  const cell = Math.min((side * MZ_FIELD_WIDTH) / Math.max(1, cols), (side * MZ_FIELD_HEIGHT) / Math.max(1, rows));
  f.cell = cell;
  f.width = cell * cols;
  f.height = cell * rows;
  f.left = (width - f.width) / 2;
  f.top = (height - f.height) / 2;
  f.wall = Math.max(MZ_MIN_WALL, MZ_WALL_FRACTION * cell);
  f.side = side;
  f.sx = (width - side) / 2;
  f.sy = (height - side) / 2;
  return f;
}

/** A ball's radius in a maze with cells of `cell` px: the Ball Size, at most `MZ_BALL_FRACTION` of a cell. */
export function mazeBallRadius(ballRadius: number, cell: number): number {
  const r = Number.isFinite(ballRadius) && ballRadius > 0 ? ballRadius : 8;
  return Math.max(0.5, Math.min(r, MZ_BALL_FRACTION * cell));
}

/* ------------------------------------------------------------------ collision */

/** What the collision needs of a ball (the engine's `Ball` fits). */
export interface MazeBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/** The hardest contact of a `resolveMazeCell()` call: its approach speed (0 = none) and its wall (0–3 an edge, 4 a post). */
export interface MazeContact {
  speed: number;
  dir: number;
  /** The contact was the exit gap closed to this ball (the rig's seal). */
  sealedExit: boolean;
}

export function emptyMazeContact(): MazeContact {
  return { speed: 0, dir: -1, sealedExit: false };
}

/** Gap bits of `resolveMazeCell()`: the entrance (top of the entrance cell) and the exit (bottom of the exit cell) are open for this ball. */
export const MZ_GAP_ENTRANCE = 1;
export const MZ_GAP_EXIT = 2;

/**
 * Whether the edge of cell (col, row) toward `d` is closed for a ball with the open `gaps`. Row −1 is the entrance chute
 * above the entrance cell: closed all round but toward the entrance.
 */
export function mazeEdgeClosed(grid: MazeGrid, col: number, row: number, d: number, gaps: number): boolean {
  if (row < 0) return !(col === grid.entranceCol && d === MZ_S);
  if (row === 0 && d === MZ_N && col === grid.entranceCol) return !(gaps & MZ_GAP_ENTRANCE);
  if (row === grid.rows - 1 && d === MZ_S && col === grid.exitCol) return !(gaps & MZ_GAP_EXIT);
  return !(grid.open[row * grid.cols + col] & MZ_BIT[d]);
}

function hasPost(grid: MazeGrid, i: number, j: number): boolean {
  if (j < 0) return false; // the chute's top corners: both edges there are closed, the edge tests hold the ball
  return grid.posts[j * (grid.cols + 1) + i] === 1;
}

function note(contact: MazeContact | undefined, speed: number, dir: number, sealed: boolean) {
  if (!contact || speed <= contact.speed) return;
  contact.speed = speed;
  contact.dir = dir;
  contact.sealedExit = sealed;
}

/**
 * Resolves `b`, whose centre is in cell (col, row) – row −1 is the entrance chute – against that cell's closed edges and
 * the posts at its corners. An edge test is one-sided: a ball whose centre came within the contact distance of a closed
 * edge, or crossed it, is put back at the contact distance inside the cell (only while it is level with the edge – past
 * its ends the corner posts take over). A post pushes the ball out radially. Rebounds are elastic (restitution 1): the
 * velocity's component into the wall is mirrored. The hardest contact goes into `contact` (reset it first); returns its
 * approach speed (0 when the ball touched nothing).
 */
export function resolveMazeCell(grid: MazeGrid, field: MazeField, col: number, row: number, b: MazeBody, gaps: number, contact?: MazeContact): number {
  const s = field.cell;
  const R = b.radius + field.wall / 2;
  const x0 = field.left + col * s;
  const y0 = field.top + row * s;
  const x1 = x0 + s;
  const y1 = y0 + s;
  let best = 0;
  // The edges, twice: a push off one edge can bring the ball level with the next one (a ball that crossed a corner).
  for (let pass = 0; pass < 2; pass++) {
    const levelX = b.x >= x0 && b.x <= x1;
    let moved = false;
    if (levelX && b.y - y0 < R && mazeEdgeClosed(grid, col, row, MZ_N, gaps)) {
      b.y = y0 + R;
      moved = true;
      if (b.vy < 0) {
        if (-b.vy > best) best = -b.vy;
        note(contact, -b.vy, MZ_N, false);
        b.vy = -b.vy;
      }
    }
    if (levelX && y1 - b.y < R && mazeEdgeClosed(grid, col, row, MZ_S, gaps)) {
      b.y = y1 - R;
      moved = true;
      if (b.vy > 0) {
        if (b.vy > best) best = b.vy;
        note(contact, b.vy, MZ_S, row === grid.rows - 1 && col === grid.exitCol);
        b.vy = -b.vy;
      }
    }
    const levelY = b.y >= y0 && b.y <= y1;
    if (levelY && b.x - x0 < R && mazeEdgeClosed(grid, col, row, MZ_W, gaps)) {
      b.x = x0 + R;
      moved = true;
      if (b.vx < 0) {
        if (-b.vx > best) best = -b.vx;
        note(contact, -b.vx, MZ_W, false);
        b.vx = -b.vx;
      }
    }
    if (levelY && x1 - b.x < R && mazeEdgeClosed(grid, col, row, MZ_E, gaps)) {
      b.x = x1 - R;
      moved = true;
      if (b.vx > 0) {
        if (b.vx > best) best = b.vx;
        note(contact, b.vx, MZ_E, false);
        b.vx = -b.vx;
      }
    }
    if (!moved) break;
  }
  // The four corner posts (the lattice points of this cell).
  for (let k = 0; k < 4; k++) {
    const i = col + (k & 1);
    const j = row + (k >> 1);
    if (!hasPost(grid, i, j)) continue;
    const px = field.left + i * s;
    const py = field.top + j * s;
    let dx = b.x - px;
    let dy = b.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R * R) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-9) {
      // Exactly on the post: out toward the cell's centre.
      dx = x0 + s / 2 - px;
      dy = y0 + s / 2 - py;
      d = Math.hypot(dx, dy) || 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    b.x = px + nx * R;
    b.y = py + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= 2 * vn * nx;
      b.vy -= 2 * vn * ny;
      if (-vn > best) best = -vn;
      note(contact, -vn, 4, false);
    }
  }
  return best;
}

/** Puts a ball that left its cell through a closed edge (a numerical corner case) back inside cell (col, row), at the contact distance. */
export function clampIntoMazeCell(field: MazeField, col: number, row: number, b: MazeBody) {
  const s = field.cell;
  const R = Math.min(b.radius + field.wall / 2, s / 2);
  const x0 = field.left + col * s;
  const y0 = field.top + row * s;
  b.x = Math.max(x0 + R, Math.min(x0 + s - R, b.x));
  b.y = Math.max(y0 + R, Math.min(y0 + s - R, b.y));
}

/* ------------------------------------------------------------------ steering (the brains) */

/**
 * The directions a brain may take out of `cell` as a bit mask: its open passages, plus the exit gap (south of the exit
 * cell) while `exitOpen`. The entrance never counts – a ball does not go back out the way it came in.
 */
export function mazeExitsOf(grid: MazeGrid, cell: number, exitOpen: boolean): number {
  let mask = grid.open[cell];
  if (cell === grid.exitCell && exitOpen) mask |= MZ_BIT[MZ_S];
  return mask;
}

/**
 * The wall follower's move at a junction: with the left hand on the wall it tries left, straight on, right, then back (the
 * right hand: right, straight, left, back) relative to `heading`, the direction it entered the cell in. In a perfect maze
 * whose entrance and exit are on the outer wall this walks every corridor at most twice and always finds the exit.
 */
export function wallFollowChoice(mask: number, heading: number, hand: "left" | "right"): number {
  const turns = hand === "left" ? LEFT_HAND : RIGHT_HAND;
  for (let k = 0; k < 4; k++) {
    const d = (heading + turns[k]) % 4;
    if (mask & MZ_BIT[d]) return d;
  }
  return (heading + 2) % 4;
}
const LEFT_HAND = [3, 0, 1, 2];
const RIGHT_HAND = [1, 0, 3, 2];

/**
 * The explorer's move: the exit when it is in sight (`mask` has it), else an open passage to a cell it has not visited
 * (a seeded pick among them), else back toward `parentDir` (the previous cell of its path – a depth-first search), else
 * any open passage. Draws `random()` only to break a tie between unvisited passages.
 */
export function explorerChoice(grid: MazeGrid, cell: number, mask: number, visited: Uint8Array, parentDir: number, random: () => number): number {
  if (cell === grid.exitCell && mask & MZ_BIT[MZ_S]) return MZ_S;
  let k = 0;
  let first = -1;
  for (let d = 0; d < 4; d++) {
    if (!(mask & MZ_BIT[d])) continue;
    const nc = mazeNeighbour(grid.cols, grid.rows, cell, d);
    if (nc < 0 || visited[nc]) continue;
    if (first < 0) first = d;
    k++;
  }
  if (k === 1) return first;
  if (k > 1) {
    let pick = Math.min(k - 1, Math.floor(random() * k));
    for (let d = 0; d < 4; d++) {
      if (!(mask & MZ_BIT[d])) continue;
      const nc = mazeNeighbour(grid.cols, grid.rows, cell, d);
      if (nc < 0 || visited[nc]) continue;
      if (pick-- === 0) return d;
    }
  }
  if (parentDir >= 0 && mask & MZ_BIT[parentDir]) return parentDir;
  for (let d = 0; d < 4; d++) if (mask & MZ_BIT[d]) return d;
  return -1;
}

/** The shortest way out (the rig's forced winner): the passage to a neighbour one step closer to the exit, or the exit itself. */
export function shortestChoice(grid: MazeGrid, cell: number, mask: number): number {
  if (cell === grid.exitCell && mask & MZ_BIT[MZ_S]) return MZ_S;
  const here = grid.dist[cell];
  for (let d = 0; d < 4; d++) {
    if (!(mask & MZ_BIT[d])) continue;
    const nc = mazeNeighbour(grid.cols, grid.rows, cell, d);
    if (nc >= 0 && grid.dist[nc] >= 0 && grid.dist[nc] < here) return d;
  }
  for (let d = 0; d < 4; d++) if (mask & MZ_BIT[d]) return d;
  return -1;
}

/** The direction from cell `from` to the adjacent cell `to` (−1 when they are not neighbours). */
export function mazeDirection(cols: number, from: number, to: number): number {
  const diff = to - from;
  if (diff === -cols) return MZ_N;
  if (diff === cols) return MZ_S;
  if (diff === 1 && to % cols !== 0) return MZ_E;
  if (diff === -1 && from % cols !== 0) return MZ_W;
  return -1;
}
