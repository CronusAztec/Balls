import { buildDropLayout } from "../modes/drop";
import type { Obstacle } from "../obstacles";
import type { ObstacleHitResult } from "../types";
import { BaseStage, stagePitch, type StageMap, type StageObstacleHit, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "pegs" – a Ball Drop peg field: `buildDropLayout()` lays out the staggered rows of pegs (every third row bars) for a
 * board as wide as the column – the column spacing it picks keeps the openings wide enough for the ball – and the stage
 * fits those rows into its band (the side walls are the journey's). Every peg or bar the ball hits plays the note of its
 * row – a C-major degree climbing from C4 as the ball falls, like a glissando on a piano – and the bars are tilted a
 * little toward the middle of the column, so the ball never comes to rest on one (or in a corner with a wall).
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
      this.rowOf.set(o, row);
      this.obstacles.push(o);
    }
    this.rows = rows;
    this.pegRadius = board.pegRadius;
    this.columnSpacing = board.columnSpacing;
    this.hits = 0;
  }

  maxBallRadius() {
    // Ball Drop keeps an opening of 5.5 radii between two pegs; a ball may grow to fill most of it.
    return (this.columnSpacing - 2 * this.pegRadius) / 2 - 2;
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
  }

  render(painter: StagePainter) {
    painter.pegs(this);
  }
}
