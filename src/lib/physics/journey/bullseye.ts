import { circleObstacle, segmentObstacle, type SegmentObstacle } from "../obstacles";
import type { Ball, ObstacleHitResult } from "../types";
import { BaseStage, stagePitch, type StageEnv, type StageMap, type StageObstacleHit, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "bullseye" – a landing target that scores: a platform across the column (two obstacle-layer bars meeting at the
 * target's centre, a seeded spot) with a bullseye painted on it and, in the medium and large stages, a row or two of
 * pegs above that scatter the ball. Where the ball first lands scores – 100 in the bull, then 50, 25 and 10 by the
 * distance from the centre (`bullseyeScore()`) – with a note that climbs with the score (a chord and confetti for the
 * bull); a moment later the two halves swing down like a trapdoor and the ball drops on to the next stage.
 */

/** Score bands: the largest distance from the centre (fraction of the column width) and the points. */
export const BULLSEYE_BANDS: readonly [number, number][] = [
  [0.05, 100],
  [0.12, 50],
  [0.22, 25],
];
export const BULLSEYE_MISS = 10;
/** Seconds after the landing before the trapdoor opens, how long it takes to open and how far (radians). */
export const OPEN_DELAY_SEC = 0.55;
export const OPEN_SEC = 0.35;
export const OPEN_ANGLE = 1.35;
export const PLATFORM_RESTITUTION = 0.35;
export const PLATFORM_FRICTION = 0.05;
/** Seconds the ball may rest on the platform without a counted landing before it counts anyway (a soft touch-down). */
export const REST_LAND_SEC = 0.25;

/** Points for landing `dx` px from the centre of a target on a column `width` px wide. */
export function bullseyeScore(dx: number, width: number): number {
  const d = Math.abs(dx) / Math.max(1, width);
  for (const [limit, points] of BULLSEYE_BANDS) if (d <= limit) return points;
  return BULLSEYE_MISS;
}

export class BullseyeStage extends BaseStage {
  readonly kind = "bullseye" as const;
  /** World y of the platform and the target's centre. */
  platformY = 0;
  targetX = 0;
  left: SegmentObstacle | null = null;
  right: SegmentObstacle | null = null;
  landed = false;
  landedAtMs = -Infinity;
  landX = 0;
  score = 0;
  /** 0 closed … 1 wide open. */
  open = 0;
  pegRows = 0;
  pegGap = Infinity;
  private restMs = 0;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
  }

  protected layout(random: () => number, r: number) {
    const b = this.bounds;
    this.platformY = b.top + 0.8 * b.height;
    this.targetX = b.cx + (random() - 0.5) * 0.44 * b.width;
    const pegShift = random();
    this.left = segmentObstacle(0, 0, 0, 0, { restitution: PLATFORM_RESTITUTION, friction: PLATFORM_FRICTION, thickness: Math.max(3, 0.008 * b.viewH) });
    this.right = segmentObstacle(0, 0, 0, 0, { restitution: PLATFORM_RESTITUTION, friction: PLATFORM_FRICTION, thickness: Math.max(3, 0.008 * b.viewH) });
    this.open = 0;
    this.placeDoors();
    this.obstacles.push(this.left, this.right);
    // Pegs that scatter the ball before it lands (medium: one row of 3, large: rows of 3 and 4) – fewer when a big ball
    // would not get between them.
    this.pegRows = this.size === "s" ? 0 : this.size === "m" ? 1 : 2;
    const pr = Math.max(3, Math.min(7, 0.012 * b.viewH));
    this.pegGap = Infinity;
    for (let row = 0; row < this.pegRows; row++) {
      let n = 3 + row;
      while (n > 1 && 0.85 * (b.width / (n + 1)) - 2 * pr < 2.6 * r + 4) n--;
      const y = b.top + (0.3 + 0.18 * row) * b.height;
      const step = b.width / (n + 1);
      const jitter = (pegShift - 0.5) * 0.3 * step;
      for (let i = 0; i < n; i++) this.obstacles.push(circleObstacle(b.left + (i + 1) * step + (row % 2 === 0 ? jitter : -jitter), y, pr, { restitution: 0.6 }));
      this.pegGap = Math.min(this.pegGap, step - 2 * pr - Math.abs(jitter));
    }
    this.landed = false;
    this.landedAtMs = -Infinity;
    this.landX = this.targetX;
    this.score = 0;
    this.restMs = 0;
  }

  /** Puts the two halves of the platform where the opening angle says: hinged at the column walls, meeting at the target. */
  private placeDoors() {
    const b = this.bounds;
    const a = this.open * OPEN_ANGLE;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const l1 = Math.max(1, this.targetX - b.left);
    const l2 = Math.max(1, b.right - this.targetX);
    if (this.left) {
      this.left.halfLength = l1 / 2;
      this.left.angle = a;
      this.left.x = b.left + (c * l1) / 2;
      this.left.y = this.platformY + (s * l1) / 2;
    }
    if (this.right) {
      this.right.halfLength = l2 / 2;
      this.right.angle = Math.PI - a;
      this.right.x = b.right - (c * l2) / 2;
      this.right.y = this.platformY + (s * l2) / 2;
    }
  }

  holdsBall() {
    return this.landed && this.open < 1;
  }

  maxBallRadius() {
    return Number.isFinite(this.pegGap) ? this.pegGap / 2 - 2 : Infinity;
  }

  onObstacleHit(hit: StageObstacleHit): ObstacleHitResult | void {
    const { env, ball, obstacle } = hit;
    if (obstacle === this.left || obstacle === this.right) {
      if (!this.landed && ball.y < this.platformY) {
        this.land(env, ball);
        return { suppressSound: true };
      }
      return { frequency: stagePitch(0 + this.index) };
    }
    return { frequency: stagePitch(5 + this.index) };
  }

  /** The first landing: the score by the distance from the centre, its note (a chord and confetti for the bull). */
  private land(env: StageEnv, ball: Ball) {
    this.landed = true;
    this.landedAtMs = env.timeMs;
    this.landX = ball.x;
    this.score = bullseyeScore(ball.x - this.targetX, this.bounds.width);
    env.addScore(this.score);
    if (this.score >= 100) {
      const chord = [stagePitch(7), stagePitch(9), stagePitch(11), stagePitch(14)];
      env.sound({ type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true }, true);
      env.ctx.spawnConfetti(ball.x, this.platformY - 2 * ball.radius);
    } else {
      const degree = this.score >= 50 ? 7 : this.score >= 25 ? 4 : 2;
      env.sound({ type: "hit", wallIndex: 0, frequency: stagePitch(degree), accent: this.score >= 50 }, true);
    }
  }

  update(env: StageEnv, ball: Ball | null, dtSec: number, active: boolean) {
    if (active && ball && !this.landed) {
      // A soft touch-down the engine did not report as a hit still counts once the ball rests on the platform.
      const onTop = ball.y < this.platformY && ball.y > this.platformY - ball.radius - 6 && Math.abs(ball.vy) < 60;
      this.restMs = onTop ? this.restMs + dtSec * 1000 : 0;
      if (this.restMs >= REST_LAND_SEC * 1000) this.land(env, ball);
    }
    if (this.landed && this.open < 1 && env.timeMs - this.landedAtMs >= OPEN_DELAY_SEC * 1000) {
      this.open = Math.min(1, this.open + dtSec / OPEN_SEC);
      this.placeDoors();
    }
  }

  protected shiftOwn(dy: number) {
    this.platformY += dy;
  }

  protected rescaleOwn(map: StageMap) {
    this.platformY = map.y(this.platformY);
    this.targetX = map.x(this.targetX);
    this.landX = map.x(this.landX);
    this.pegGap *= map.k;
    this.placeDoors();
  }

  render(painter: StagePainter) {
    painter.bullseye(this);
  }
}
