import { circleObstacle, segmentBetween, type Obstacle } from "./obstacles";

/**
 * The hidden pictures of the Circle Illusion's "whitespace" type (feature jdm-illusions; project.jdm "GET THE WHITE
 * SPACES"): the arena starts white, the balls paint it black wherever they go, and they bounce off invisible shapes they
 * can never enter – the white spaces left at the end are the picture. Everything here is pure and deterministic.
 *
 * A pattern is designed in arena units (the arena radius is 1, the centre is 0,0 and y points down) out of three kinds
 * of elements, all turned into ordinary obstacles of obstacles.ts (so the capsule / disc collision maths is shared):
 *  - `disc`: a solid disc (a circle obstacle);
 *  - `polygon`: a closed outline of capsules – the balls bounce off its outside and never get in, so its whole
 *    inside stays white (hearts, stars, the moon…);
 *  - `stroke`: an open polyline of thick capsules (the smile, the stem of a note).
 *
 * `CoverageGrid` keeps the painted state on a `COVERAGE_GRID` × `COVERAGE_GRID` grid over the arena's bounding square:
 * the cells a ball can reach at all ("paintable": within the brush of a legal ball position, found once per pattern
 * by a disc dilation of the legal cells) and the cells painted so far (marked with the capsule a ball swept each
 * step), so the coverage is exact to a cell and independent of the canvas size.
 */

export const ILLUSION_PATTERNS = ["heart", "star", "smile", "moon", "note", "diamond", "flower", "cross"] as const;
export type IllusionPatternId = (typeof ILLUSION_PATTERNS)[number];

export function isIllusionPatternId(value: unknown): value is IllusionPatternId {
  return typeof value === "string" && (ILLUSION_PATTERNS as readonly string[]).includes(value);
}

export type PatternElement =
  | { kind: "disc"; x: number; y: number; r: number }
  | { kind: "polygon"; points: readonly number[]; thickness: number }
  | { kind: "stroke"; points: readonly number[]; thickness: number };

/** Outline thickness of the closed shapes (arena radii). */
const OUTLINE = 0.03;

function heartPoints(): number[] {
  const out: number[] = [];
  const n = 28;
  const s = 0.55 / 17;
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    out.push(round(x * s), round(y * s - 0.07));
  }
  return out;
}

function starPoints(): number[] {
  const out: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 5;
    const r = k % 2 === 0 ? 0.56 : 0.23;
    out.push(round(r * Math.cos(a)), round(r * Math.sin(a) + 0.04));
  }
  return out;
}

/** A crescent: the disc of radius 0.5 minus the disc of radius 0.42 around (0.2, −0.1), outlined. */
function moonPoints(): number[] {
  const R1 = 0.5;
  const R2 = 0.42;
  const ox = 0.2;
  const oy = -0.1;
  const inside2 = (x: number, y: number) => (x - ox) ** 2 + (y - oy) ** 2 < R2 * R2;
  const inside1 = (x: number, y: number) => x * x + y * y < R1 * R1;
  const n = 96;
  // Outer arc: the points of circle 1 outside circle 2, starting right after the cut so the arc is contiguous.
  const outer: number[][] = [];
  let start = 0;
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const b = (2 * Math.PI * ((k + n - 1) % n)) / n;
    if (!inside2(R1 * Math.cos(a), R1 * Math.sin(a)) && inside2(R1 * Math.cos(b), R1 * Math.sin(b))) start = k;
  }
  for (let j = 0; j < n; j++) {
    const a = (2 * Math.PI * ((start + j) % n)) / n;
    const x = R1 * Math.cos(a);
    const y = R1 * Math.sin(a);
    if (inside2(x, y)) break;
    outer.push([x, y]);
  }
  // Inner arc back: the points of circle 2 inside circle 1, from the end of the outer arc to its start.
  const inner: number[][] = [];
  const endA = Math.atan2(outer[outer.length - 1][1] - oy, outer[outer.length - 1][0] - ox);
  for (let j = 0; j < n; j++) {
    const a = endA - (2 * Math.PI * j) / n;
    const x = ox + R2 * Math.cos(a);
    const y = oy + R2 * Math.sin(a);
    if (inside1(x, y)) inner.push([x, y]);
    else if (inner.length > 0) break;
  }
  const out: number[] = [];
  for (const [x, y] of [...outer, ...inner]) out.push(round(x - 0.05), round(y + 0.04));
  return out;
}

function arcPoints(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * k) / n) * Math.PI) / 180;
    out.push(round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a)));
  }
  return out;
}

function round(v: number) {
  return Math.round(v * 10000) / 10000;
}

/** The catalogue, in arena units (radius 1, y down); every element stays within 0.62 of the centre. */
export const PATTERN_ELEMENTS: Record<IllusionPatternId, readonly PatternElement[]> = {
  heart: [{ kind: "polygon", points: heartPoints(), thickness: OUTLINE }],
  star: [{ kind: "polygon", points: starPoints(), thickness: OUTLINE }],
  smile: [
    { kind: "disc", x: -0.2, y: -0.17, r: 0.085 },
    { kind: "disc", x: 0.2, y: -0.17, r: 0.085 },
    { kind: "stroke", points: arcPoints(0, -0.02, 0.34, 22, 158, 12), thickness: 0.075 },
  ],
  moon: [{ kind: "polygon", points: moonPoints(), thickness: OUTLINE }],
  note: [
    { kind: "disc", x: -0.12, y: 0.3, r: 0.135 },
    { kind: "stroke", points: [0.0, 0.28, 0.0, -0.44], thickness: 0.07 },
    { kind: "stroke", points: [0.0, -0.44, 0.2, -0.27], thickness: 0.07 },
  ],
  diamond: [{ kind: "polygon", points: [0, -0.56, 0.38, 0, 0, 0.56, -0.38, 0], thickness: OUTLINE }],
  flower: [
    ...[0, 1, 2, 3, 4].map((k): PatternElement => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / 5;
      return { kind: "disc", x: round(0.25 * Math.cos(a)), y: round(0.25 * Math.sin(a)), r: 0.19 };
    }),
    { kind: "disc", x: 0, y: 0, r: 0.17 },
  ],
  cross: [
    { kind: "stroke", points: [-0.38, -0.38, 0.38, 0.38], thickness: 0.15 },
    { kind: "stroke", points: [0.38, -0.38, -0.38, 0.38], thickness: 0.15 },
  ],
};

/** The pattern in canvas pixels: the obstacles the balls bounce off and the shapes the reveal fills. */
export interface IllusionPattern {
  id: IllusionPatternId;
  cx: number;
  cy: number;
  /** Arena radius (px). */
  radius: number;
  /** Offset (arena units) and scale the seed gave the design. */
  offsetX: number;
  offsetY: number;
  scale: number;
  obstacles: Obstacle[];
  discs: { x: number; y: number; r: number }[];
  /** Closed outlines (flat x, y lists in px) with their outline width. */
  polygons: { points: number[]; thickness: number }[];
  strokes: { points: number[]; thickness: number }[];
  /** A point inside the white space (px), for tools and the smoke test. */
  probeX: number;
  probeY: number;
}

/** Collision material of the pattern: elastic and frictionless (the painters keep their speed anyway). */
const PATTERN_MATERIAL = { restitution: 1, friction: 0 };

/** Lays the design of `id` out in an arena of radius `radius` around (cx, cy), moved by (offsetX, offsetY) arena units and scaled by `scale`. */
export function buildIllusionPattern(id: IllusionPatternId, cx: number, cy: number, radius: number, offsetX = 0, offsetY = 0, scale = 1): IllusionPattern {
  const X = (x: number) => cx + (offsetX + x * scale) * radius;
  const Y = (y: number) => cy + (offsetY + y * scale) * radius;
  const pattern: IllusionPattern = { id, cx, cy, radius, offsetX, offsetY, scale, obstacles: [], discs: [], polygons: [], strokes: [], probeX: X(0), probeY: Y(0) };
  let probeSet = false;
  for (const el of PATTERN_ELEMENTS[id]) {
    if (el.kind === "disc") {
      const d = { x: X(el.x), y: Y(el.y), r: el.r * scale * radius };
      pattern.discs.push(d);
      pattern.obstacles.push(circleObstacle(d.x, d.y, d.r, PATTERN_MATERIAL));
      if (!probeSet) {
        pattern.probeX = d.x;
        pattern.probeY = d.y;
        probeSet = true;
      }
      continue;
    }
    const pts: number[] = [];
    for (let i = 0; i < el.points.length; i += 2) pts.push(X(el.points[i]), Y(el.points[i + 1]));
    const thickness = el.thickness * scale * radius;
    const closed = el.kind === "polygon";
    const n = pts.length / 2;
    const edges = closed ? n : n - 1;
    for (let e = 0; e < edges; e++) {
      const a = e;
      const b = (e + 1) % n;
      pattern.obstacles.push(segmentBetween(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1], { ...PATTERN_MATERIAL, thickness }));
    }
    if (closed) {
      pattern.polygons.push({ points: pts, thickness });
      if (!probeSet) {
        const c = polygonInteriorPoint(pts);
        pattern.probeX = c.x;
        pattern.probeY = c.y;
        probeSet = true;
      }
    } else {
      pattern.strokes.push({ points: pts, thickness });
      if (!probeSet) {
        pattern.probeX = (pts[0] + pts[2]) / 2;
        pattern.probeY = (pts[1] + pts[3]) / 2;
        probeSet = true;
      }
    }
  }
  return pattern;
}

/** Even-odd point-in-polygon test (flat x, y list). */
export function pointInPolygon(x: number, y: number, pts: readonly number[]): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i];
    const yi = pts[2 * i + 1];
    const xj = pts[2 * j];
    const yj = pts[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A point well inside a polygon: the vertex centroid when it is inside, else the midpoint of the widest horizontal chord through it. */
function polygonInteriorPoint(pts: readonly number[]): { x: number; y: number } {
  const n = pts.length / 2;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += pts[2 * i];
    sy += pts[2 * i + 1];
  }
  const cx = sx / n;
  const cy = sy / n;
  if (pointInPolygon(cx, cy, pts)) return { x: cx, y: cy };
  const xs: number[] = [];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = pts[2 * i + 1];
    const yj = pts[2 * j + 1];
    if (yi > cy !== yj > cy) xs.push(pts[2 * i] + ((pts[2 * j] - pts[2 * i]) * (cy - yi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let best = { x: cx, y: cy, w: -1 };
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > best.w) best = { x: (xs[k] + xs[k + 1]) / 2, y: cy, w: xs[k + 1] - xs[k] };
  return { x: best.x, y: best.y };
}

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/**
 * True when a ball of radius `r` centred at (x, y) is somewhere it may be: inside the arena (its edge within the rim),
 * clear of every disc and stroke of the pattern and outside every closed outline.
 */
export function isLegalPosition(pattern: IllusionPattern, x: number, y: number, r: number): boolean {
  const dx = x - pattern.cx;
  const dy = y - pattern.cy;
  const lim = pattern.radius - r;
  if (dx * dx + dy * dy > lim * lim) return false;
  for (const d of pattern.discs) {
    const reach = d.r + r;
    if ((x - d.x) ** 2 + (y - d.y) ** 2 < reach * reach) return false;
  }
  for (const list of [pattern.polygons, pattern.strokes]) {
    for (const s of list) {
      const reach = s.thickness / 2 + r;
      const reach2 = reach * reach;
      const pts = s.points;
      const n = pts.length / 2;
      const closed = list === pattern.polygons;
      const edges = closed ? n : n - 1;
      for (let e = 0; e < edges; e++) {
        const b = (e + 1) % n;
        if (segmentDistance2(x, y, pts[2 * e], pts[2 * e + 1], pts[2 * b], pts[2 * b + 1]) < reach2) return false;
      }
    }
  }
  for (const p of pattern.polygons) if (pointInPolygon(x, y, p.points)) return false;
  return true;
}

/* ------------------------------------------------------------------ coverage */

/** Cells across the arena's bounding square. */
export const COVERAGE_GRID = 128;

/**
 * The painted state of the arena on a `size` × `size` grid over its bounding square (a cell's state is taken at its
 * centre). `build()` marks the paintable cells – within the brush, less half a cell of slack, of some legal ball
 * position – and clears the paint; `markSegment()` paints the cells within the brush of a swept segment and returns
 * how many paintable cells it painted for the first time. The masks are in arena units, so a canvas resize only
 * moves the mapping (`place()`).
 */
export class CoverageGrid {
  readonly size: number;
  readonly paintable: Uint8Array;
  readonly painted: Uint8Array;
  paintableCount = 0;
  paintedCount = 0;
  /** Pixel mapping: the grid's top-left corner and its cell size. */
  x0 = 0;
  y0 = 0;
  cell = 1;

  constructor(size = COVERAGE_GRID) {
    this.size = size;
    this.paintable = new Uint8Array(size * size);
    this.painted = new Uint8Array(size * size);
  }

  /** Maps the grid onto an arena of radius `radius` around (cx, cy). */
  place(cx: number, cy: number, radius: number) {
    this.cell = (2 * radius) / this.size;
    this.x0 = cx - radius;
    this.y0 = cy - radius;
  }

  /** Marks the paintable cells for balls of radius `r` (`legal(x, y)`: may a ball be centred there?) and clears the paint. */
  build(cx: number, cy: number, radius: number, r: number, legal: (x: number, y: number) => boolean) {
    this.place(cx, cy, radius);
    const n = this.size;
    const legalCells = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      const y = this.y0 + (j + 0.5) * this.cell;
      for (let i = 0; i < n; i++) legalCells[j * n + i] = legal(this.x0 + (i + 0.5) * this.cell, y) ? 1 : 0;
    }
    const reach = Math.max(0, r / this.cell - 0.5);
    const k = Math.floor(reach);
    const offsets: number[] = [];
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) if (dx * dx + dy * dy <= reach * reach) offsets.push(dx, dy);
    this.paintable.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (!legalCells[j * n + i]) continue;
        for (let o = 0; o < offsets.length; o += 2) {
          const ii = i + offsets[o];
          const jj = j + offsets[o + 1];
          if (ii >= 0 && jj >= 0 && ii < n && jj < n) this.paintable[jj * n + ii] = 1;
        }
      }
    }
    let count = 0;
    for (let c = 0; c < n * n; c++) count += this.paintable[c];
    this.paintableCount = count;
    this.clear();
  }

  clear() {
    this.painted.fill(0);
    this.paintedCount = 0;
  }

  /** Paints every paintable cell whose centre is within `r` px of the segment (x1, y1)–(x2, y2); returns the cells newly painted. */
  markSegment(x1: number, y1: number, x2: number, y2: number, r: number): number {
    const n = this.size;
    const c = this.cell;
    const ax = (x1 - this.x0) / c - 0.5;
    const ay = (y1 - this.y0) / c - 0.5;
    const bx = (x2 - this.x0) / c - 0.5;
    const by = (y2 - this.y0) / c - 0.5;
    const rc = r / c;
    const r2 = rc * rc;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx) - rc));
    const i1 = Math.min(n - 1, Math.floor(Math.max(ax, bx) + rc));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by) - rc));
    const j1 = Math.min(n - 1, Math.floor(Math.max(ay, by) + rc));
    let added = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * n + i;
        if (this.painted[idx] || !this.paintable[idx]) continue;
        if (segmentDistance2(i, j, ax, ay, bx, by) <= r2) {
          this.painted[idx] = 1;
          added++;
        }
      }
    }
    this.paintedCount += added;
    return added;
  }

  /** Painted share of the paintable cells, 0–1. */
  coverage(): number {
    return this.paintableCount > 0 ? this.paintedCount / this.paintableCount : 1;
  }

  /** True when the cell under (x, y) px is paintable and not painted yet. */
  isUnpainted(x: number, y: number): boolean {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return false;
    const idx = j * this.size + i;
    return this.paintable[idx] === 1 && this.painted[idx] === 0;
  }

  /** True when the cell under (x, y) px is paintable (a ball can reach it: not the picture, not outside the arena). */
  isPaintable(x: number, y: number): boolean {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return false;
    return this.paintable[j * this.size + i] === 1;
  }

  /**
   * How much unpainted area a ball starting at (x, y) and heading along the unit vector (ux, uy) would cross within
   * `length` px before it is stopped: unpainted cells sampled every cell along the centre line and two lines `spread` px
   * to either side. Each line ends at its first cell the paint cannot reach (the picture, the rim) and the centre line's
   * end ends all three – white behind the picture or across the rim does not count, as the ball would bounce first.
   * Used to steer a rebound toward what is left to paint.
   */
  rayScore(x: number, y: number, ux: number, uy: number, length: number, spread: number): number {
    const step = this.cell;
    const n = Math.floor(length / step);
    const ox = -uy * spread;
    const oy = ux * spread;
    let left = true;
    let right = true;
    let score = 0;
    for (let k = 1; k <= n; k++) {
      const px = x + ux * k * step;
      const py = y + uy * k * step;
      if (!this.isPaintable(px, py)) break;
      if (this.isUnpainted(px, py)) score++;
      if (left) {
        if (!this.isPaintable(px + ox, py + oy)) left = false;
        else if (this.isUnpainted(px + ox, py + oy)) score++;
      }
      if (right) {
        if (!this.isPaintable(px - ox, py - oy)) right = false;
        else if (this.isUnpainted(px - ox, py - oy)) score++;
      }
    }
    return score;
  }
}
