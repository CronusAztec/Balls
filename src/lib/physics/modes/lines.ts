import type { Ball, GameMode, ModeContext, Point } from "../types";
import { arenaRadius } from "../types";

/** Lines: every bounce point is connected to the ball, drawing string art. */
export class LinesMode implements GameMode {
  readonly name = "lines";
  private bouncePoints: Point[] = [];
  private centerDotEnabled = false;
  private centerDotRadius = 12;

  setCenterDotEnabled(enabled: boolean) {
    this.centerDotEnabled = enabled;
  }
  isCenterDotEnabled() {
    return this.centerDotEnabled;
  }

  init(ctx: ModeContext) {
    this.bouncePoints = [];
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) this.centerDotRadius = Math.max(5, 0.02 * walls[0].radius);
  }
  onPreUpdate() {}
  onBallStep(ctx: ModeContext, ball: Ball) {
    if (!this.centerDotEnabled) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = ball.radius + this.centerDotRadius;
    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = cx + nx * (minDist + 1);
      ball.y = cy + ny * (minDist + 1);
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
      }
      this.bouncePoints.push({ x: cx, y: cy });
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0 });
    }
  }
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number) {
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const wall = ctx.getCircularWalls()[wallIndex];
    if (wall && dist > 0) {
      this.bouncePoints.push({ x: cx + (dx / dist) * wall.radius, y: cy + (dy / dist) * wall.radius });
    }
  }
  onGapPass() {
    return false;
  }
  onPostUpdate() {}
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      const r = arenaRadius(ctx.config);
      ctx.setCircularWalls([{ radius: r, gaps: [] }]);
      ctx.setWallRotations([0]);
      this.centerDotRadius = Math.max(5, 0.02 * r);
    }
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished() {
    return false;
  }
  getState() {
    return {
      bouncePoints: this.bouncePoints,
      centerDotEnabled: this.centerDotEnabled,
      centerDotRadius: this.centerDotRadius,
    };
  }
  getBouncePoints() {
    return this.bouncePoints;
  }
  repositionPoints(sx: number, sy: number, oldCx: number, oldCy: number, newCx: number, newCy: number) {
    for (const p of this.bouncePoints) {
      p.x = newCx + (p.x - oldCx) * sx;
      p.y = newCy + (p.y - oldCy) * sy;
    }
  }
}
