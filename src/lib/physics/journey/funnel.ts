import { circleObstacle, segmentBetween, type Obstacle } from "../obstacles";
import type { ObstacleHitResult } from "../types";
import { BaseStage, stagePitch, type StageMap, type StageObstacleHit, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "funnel" – a converging funnel built from the obstacle layer: two slanted walls (`segmentBetween()`) from the column
 * walls down to a narrow mouth at a seeded spot, so the ball rolls down the slope and drops through; a medium funnel
 * has two deflector pegs above it and a large stage stacks two funnels whose mouths sit on opposite sides. The arms and
 * pegs play notes (higher for the lower funnel); the mouth is always a little wider than the ball may grow (`mouth`).
 */

export const FUNNEL_RESTITUTION = 0.5;
export const FUNNEL_FRICTION = 0.01;
/** The mouth is at least this many ball radii wide (and 16 % of the column). */
export const MOUTH_RADII = 3.6;

export interface FunnelShape {
  /** World y of the top of the arms (at the column walls) and of the mouth. */
  top: number;
  bottom: number;
  /** Centre and width of the mouth. */
  mouthX: number;
  mouth: number;
}

export class FunnelStage extends BaseStage {
  readonly kind = "funnel" as const;
  funnels: FunnelShape[] = [];
  private readonly degreeOf = new Map<Obstacle, number>();
  hits = 0;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
  }

  protected layout(random: () => number, r: number) {
    const b = this.bounds;
    const count = this.size === "l" ? 2 : 1;
    const mouth = Math.max(MOUTH_RADII * r, 0.16 * b.width);
    const side = random() < 0.5 ? -1 : 1;
    const offset = 0.08 + 0.12 * random();
    const pegU = random();
    this.funnels = [];
    this.degreeOf.clear();
    for (let i = 0; i < count; i++) {
      const top = count === 1 ? b.top + (this.size === "m" ? 0.38 : 0.28) * b.height : b.top + (i === 0 ? 0.14 : 0.58) * b.height;
      const bottom = count === 1 ? b.bottom - 0.14 * b.height : b.top + (i === 0 ? 0.4 : 0.86) * b.height;
      // The mouth sits off-centre, the second funnel's on the other side.
      const dir = i === 0 ? side : -side;
      const mouthX = Math.max(b.left + 0.6 * mouth + 4, Math.min(b.right - 0.6 * mouth - 4, b.cx + dir * offset * b.width));
      const shape: FunnelShape = { top, bottom, mouthX, mouth };
      this.funnels.push(shape);
      const left = segmentBetween(b.left, top, mouthX - mouth / 2, bottom, { restitution: FUNNEL_RESTITUTION, friction: FUNNEL_FRICTION });
      const right = segmentBetween(b.right, top, mouthX + mouth / 2, bottom, { restitution: FUNNEL_RESTITUTION, friction: FUNNEL_FRICTION });
      this.obstacles.push(left, right);
      this.degreeOf.set(left, 3 + 2 * i);
      this.degreeOf.set(right, 4 + 2 * i);
    }
    if (this.size === "m") {
      // Two deflector pegs above the funnel, a seeded bit off-centre.
      const y = b.top + 0.2 * b.height;
      const dx = (0.18 + 0.08 * pegU) * b.width;
      const pr = Math.max(3, Math.min(8, 0.014 * b.viewH));
      const a = circleObstacle(b.cx - dx, y, pr, { restitution: 0.65 });
      const c = circleObstacle(b.cx + dx, y + 0.04 * b.viewH, pr, { restitution: 0.65 });
      this.obstacles.push(a, c);
      this.degreeOf.set(a, 1);
      this.degreeOf.set(c, 2);
    }
    this.hits = 0;
  }

  maxBallRadius() {
    return this.funnels.length > 0 ? this.funnels[0].mouth / 2 - 2 : Infinity;
  }

  onObstacleHit(hit: StageObstacleHit): ObstacleHitResult | void {
    const degree = this.degreeOf.get(hit.obstacle);
    if (degree === undefined) return;
    this.hits++;
    return { frequency: stagePitch(degree + this.index) };
  }

  protected shiftOwn(dy: number) {
    for (const f of this.funnels) {
      f.top += dy;
      f.bottom += dy;
    }
  }

  protected rescaleOwn(map: StageMap) {
    for (const f of this.funnels) {
      f.top = map.y(f.top);
      f.bottom = map.y(f.bottom);
      f.mouthX = map.x(f.mouthX);
      f.mouth *= map.k;
    }
  }

  render(painter: StagePainter) {
    painter.funnel(this);
  }
}
