import type { Ball, GameMode, ModeContext, Point, WallHitResult } from "../types";

/** Grow: a single sealed ring; the ball grows with every bounce until it fills the space. */
export class GrowMode implements GameMode {
  readonly name = "grow";
  private growRate = 5;
  private centerDotEnabled = false;
  private centerDotRadius = 12;
  private linesEnabled = false;
  private bouncePoints: Point[] = [];
  private readonly MAX_BOUNCE_POINTS = 500;
  private elapsedTime = 0;
  private readonly ORBIT_DELAY = 15;

  setGrowRate(rate: number) {
    this.growRate = rate;
  }
  getGrowRate() {
    return this.growRate;
  }
  setCenterDotEnabled(enabled: boolean) {
    this.centerDotEnabled = enabled;
  }
  isCenterDotEnabled() {
    return this.centerDotEnabled;
  }
  setLinesEnabled(enabled: boolean) {
    this.linesEnabled = enabled;
    if (!enabled) this.bouncePoints = [];
  }
  isLinesEnabled() {
    return this.linesEnabled;
  }
  getBouncePoints() {
    return this.bouncePoints;
  }
  private pushBouncePoint(x: number, y: number) {
    if (this.bouncePoints.length >= this.MAX_BOUNCE_POINTS) this.bouncePoints.shift();
    this.bouncePoints.push({ x, y });
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.bouncePoints = [];
    this.elapsedTime = 0;
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) this.centerDotRadius = Math.max(5, 0.02 * walls[0].radius);
  }
  onPreUpdate() {}
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    this.elapsedTime += dtSec;
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
      if (this.linesEnabled) this.pushBouncePoint(cx, cy);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0 });
    }
  }
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number): WallHitResult | void {
    const wall = ctx.getCircularWalls()[wallIndex];
    if (wall) {
      const maxRadius = wall.radius - 2;
      if (ball.radius < maxRadius) {
        const rate = this.growRate / 100;
        ball.radius = Math.min(maxRadius, ball.radius + (maxRadius - ball.radius) * (rate * rate * 2.1));
      }
      const cx = ctx.config.width / 2;
      const cy = ctx.config.height / 2;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy);
      if (this.linesEnabled && dist > 0) {
        this.pushBouncePoint(cx + (dx / dist) * wall.radius, cy + (dy / dist) * wall.radius);
      }
      if (dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot > 0) {
          ball.vx -= 1.95 * dot * nx;
          ball.vy -= 1.95 * dot * ny;
          // After a delay, add a slight orbital push so the ball circles the arena.
          const orbit = Math.min(1, (this.elapsedTime - this.ORBIT_DELAY) / 5);
          if (orbit > 0) {
            const tx = -ny;
            const sign = ball.vx * tx + ball.vy * nx >= 0 ? 1 : -1;
            ball.vx += 4 * tx * sign * orbit;
            ball.vy += 4 * nx * sign * orbit;
          }
          const speed = ctx.config.ballSpeed || 400;
          const current = Math.hypot(ball.vx, ball.vy);
          if (current > 0) {
            ball.vx = (ball.vx / current) * speed;
            ball.vy = (ball.vy / current) * speed;
          }
        }
      }
    }
    // Only every ~10th bounce makes a sound so a large, fast ball doesn't buzz.
    const playSound = ctx.random() < 0.1;
    if (playSound) ctx.addPendingSoundEvent({ type: "hit", wallIndex });
    return { suppressBounce: true, suppressGlow: !playSound };
  }
  onGapPass() {
    return true;
  }
  onPostUpdate() {}
  onConfigChange(ctx: ModeContext) {
    const r = (Math.min(ctx.config.width, ctx.config.height) / 2) * 0.85;
    ctx.setCircularWalls([{ radius: r, gaps: [] }]);
    ctx.setWallRotations([0]);
    this.centerDotRadius = Math.max(5, 0.02 * r);
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished() {
    return false;
  }
  getState() {
    return { centerDotEnabled: this.centerDotEnabled, centerDotRadius: this.centerDotRadius, linesEnabled: this.linesEnabled };
  }
}
