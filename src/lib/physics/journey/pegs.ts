import { buildDropLayout } from "../modes/drop";
import type { CircleObstacle, Obstacle, SegmentObstacle } from "../obstacles";
import type { ObstacleHitResult } from "../types";
import { BaseStage, stagePitch, type StageMap, type StageObstacleHit, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "pegs" – a Ball Drop peg field: `buildDropLayout()` lays out the staggered rows of pegs (every third row bars) for a
 * board as wide as the column – the column spacing it picks keeps the openings wide enough for the ball – and the stage
 * fits those rows into its band (the side walls are the journey's). Every peg or bar the ball hits plays the note of its
 * row – a C-major degree climbing from C4 as the ball falls, like a glissando on a piano – and the bars are tilted a
 * little toward the middle of the column, so the ball never comes to rest on one (or in a corner with a wall). The
 * outermost peg or bar of a full row sits half a column from a wall, a corner narrower than the openings inside the
 * board where a ball too big to pass would wedge: such a peg moves onto the wall (a half-peg, as on a Plinko board) and
 * such a bar reaches out to it (its high end on the wall), so the ball rolls off either back into the column.
 */

export const PEG_ROWS: Record<JourneyStageSize, number> = { s: 4, m: 6, l: 9 };
/** How far the bars tilt (radians), so the ball rolls off. */
export const BAR_TILT = 0.24;

export class PegsStage extends BaseStage {
  readonly kind = "pegs" as const;
  /** Row of every peg / bar (the note it plays). */
  private readonly rowOf = new Map<Obstacle, number>();
  rows = 0;
  pegRadius = 0;
  /** Horizontal distance between two pegs of a row. */
  columnSpacing = 0;
  /** Half the length of a bar inside the board (Ball Drop's; an edge bar reaching out to the wall is longer). */
  barHalfLength = 0;
  /** The narrowest opening of the board (px): between two neighbouring pegs or bars, or a peg or bar and a wall. */
  narrowestGap = Infinity;
  hits = 0;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
  }

  protected layout(random: () => number, r: number) {
    const b = this.bounds;
    const rows = PEG_ROWS[this.size];
    // A board exactly as wide as the column: Ball Drop's margin is 2 % of the smaller side (at least 6 px), and its board
    // is at most 0.82 × as wide as it is tall, so lay it out tall enough and map its rows into the band afterwards.
    const margin = Math.max(6, (0.02 * b.width) / 0.96);
    const width = b.width + 2 * margin;
    const height = Math.max(b.height, 1.3 * b.width) + 2 * margin;
    const board = buildDropLayout(width, height, rows, r, true);
    const f = board.field;
    const y0 = f.top + 0.16 * (f.bottom - f.top);
    const y1 = f.bottom - 0.14 * (f.bottom - f.top);
    const top = b.top + 0.2 * b.height;
    const bottom = b.bottom - 0.1 * b.height;
    // A bar right in the middle tilts a seeded way; every other bar sheds the ball toward the middle of the column (a bar
    // tilted toward a wall would wedge the ball in the corner it makes with the wall).
    const middleSign = random() < 0.5 ? -1 : 1;
    this.rowOf.clear();
    for (const o of board.obstacles) {
      // Ball Drop's side walls (a raining board has no floor): the journey's column walls stand in for them.
      if (o.kind === "segment" && Math.abs(Math.abs(o.angle) - Math.PI / 2) < 1e-6) continue;
      const row = rows > 1 ? Math.round(((o.y - y0) / (y1 - y0)) * (rows - 1)) : 0;
      o.x = b.left + (o.x - f.left);
      o.y = rows > 1 ? top + ((o.y - y0) / (y1 - y0)) * (bottom - top) : (top + bottom) / 2;
      if (o.kind === "segment") {
        const off = o.x - b.cx;
        // y grows downward: a positive angle lowers the right end.
        o.angle = (Math.abs(off) < 0.05 * b.width ? middleSign : off < 0 ? 1 : -1) * BAR_TILT;
      }
      // The outermost peg or bar of a full row (half a column from the wall): onto the wall / out to it.
      const nearLeft = o.x - b.left <= b.right - o.x;
      if ((nearLeft ? o.x - b.left : b.right - o.x) < 0.75 * board.columnSpacing) {
        const wall = nearLeft ? b.left : b.right;
        if (o.kind === "circle") o.x = wall;
        else reachWall(o, wall);
      }
      this.rowOf.set(o, row);
      this.obstacles.push(o);
    }
    this.rows = rows;
    this.pegRadius = board.pegRadius;
    this.columnSpacing = board.columnSpacing;
    this.barHalfLength = board.barHalfLength;
    this.narrowestGap = narrowestGap(this.obstacles, b.left, b.right);
    this.hits = 0;
  }

  maxBallRadius() {
    // The ball may grow to fill most of the narrowest opening (two pixels to spare on either side): a bigger one could
    // come to rest in it – on two bars whose tips are closer than the pegs, say – and wedge there.
    return this.narrowestGap / 2 - 2;
  }

  onObstacleHit(hit: StageObstacleHit): ObstacleHitResult | void {
    const row = this.rowOf.get(hit.obstacle);
    if (row === undefined) return;
    this.hits++;
    return { frequency: stagePitch(row + this.index) };
  }

  protected rescaleOwn(map: StageMap) {
    this.pegRadius *= map.k;
    this.columnSpacing *= map.k;
    this.barHalfLength *= map.k;
    this.narrowestGap *= map.k;
  }

  render(painter: StagePainter) {
    painter.pegs(this);
  }
}

/** Lengthens a bar at its end toward `wall` (x) so that end sits on the wall; the other end and the angle stay. */
function reachWall(bar: SegmentObstacle, wall: number) {
  const ux = Math.cos(bar.angle);
  const uy = Math.sin(bar.angle);
  const s = wall < bar.x ? 1 : -1;
  const ix = bar.x + s * ux * bar.halfLength;
  const iy = bar.y + s * uy * bar.halfLength;
  bar.halfLength = Math.abs(ix - wall) / Math.abs(ux) / 2;
  bar.x = ix - s * ux * bar.halfLength;
  bar.y = iy - s * uy * bar.halfLength;
}

/** Distance from (px, py) to a bar's centre line. */
function pointToBar(px: number, py: number, bar: SegmentObstacle): number {
  const ux = Math.cos(bar.angle);
  const uy = Math.sin(bar.angle);
  const t = Math.max(-bar.halfLength, Math.min(bar.halfLength, (px - bar.x) * ux + (py - bar.y) * uy));
  return Math.hypot(bar.x + t * ux - px, bar.y + t * uy - py);
}

/** Surface-to-surface distance between two pegs / bars (bars that do not cross: the nearest end of one to the other). */
function obstacleGap(a: Obstacle, b: Obstacle): number {
  if (a.kind === "circle" && b.kind === "circle") return Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
  if (a.kind === "circle" || b.kind === "circle") {
    const peg = (a.kind === "circle" ? a : b) as CircleObstacle;
    const bar = (a.kind === "circle" ? b : a) as SegmentObstacle;
    return pointToBar(peg.x, peg.y, bar) - peg.radius - bar.thickness / 2;
  }
  const ends = (bar: SegmentObstacle, other: SegmentObstacle) => {
    const dx = Math.cos(bar.angle) * bar.halfLength;
    const dy = Math.sin(bar.angle) * bar.halfLength;
    return Math.min(pointToBar(bar.x - dx, bar.y - dy, other), pointToBar(bar.x + dx, bar.y + dy, other));
  };
  return Math.min(ends(a, b), ends(b, a)) - a.thickness / 2 - b.thickness / 2;
}

/** How far a peg or bar stays from the wall at x = `wall` (0 for one that reaches it). */
function wallGap(o: Obstacle, wall: number): number {
  if (o.kind === "circle") return Math.max(0, Math.abs(o.x - wall) - o.radius);
  const dx = Math.abs(Math.cos(o.angle)) * o.halfLength + o.thickness / 2;
  return Math.max(0, Math.abs(o.x - wall) - dx);
}

/**
 * The narrowest opening a ball meets on the board: the smallest surface-to-surface gap between any two pegs or bars (in
 * a row – two bar tips are closer than two pegs – or between rows), or between one and a column wall. A peg or bar that
 * reaches the wall closes that side instead (no opening, nothing to wedge in).
 */
export function narrowestGap(obstacles: readonly Obstacle[], left: number, right: number): number {
  let min = Infinity;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    for (const wall of [left, right]) {
      const gap = wallGap(o, wall);
      if (gap > 1) min = Math.min(min, gap);
    }
    for (let j = i + 1; j < obstacles.length; j++) min = Math.min(min, Math.max(0, obstacleGap(o, obstacles[j])));
  }
  return min;
}
