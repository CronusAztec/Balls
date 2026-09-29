import type { Ball, GameMode, ModeContext } from "../types";
import { arenaRadius } from "../types";

/** Multiply: every ball that escapes the single ring spawns several new balls. */
export class MultiplyMode implements GameMode {
  readonly name = "multiply";
  private spawnCount = 3;
  private escapedBalls = new Set<number>();

  init(ctx: ModeContext) {
    this.escapedBalls.clear();
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  onWallHit() {}
  onGapPass() {
    return true;
  }
  onPostUpdate(ctx: ModeContext) {
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const wall = walls[0];
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const balls = ctx.getBalls();
    let spawned = false;
    for (const ball of balls) {
      if (this.escapedBalls.has(ball.id)) continue;
      if (Math.hypot(ball.x - cx, ball.y - cy) > wall.radius + ball.radius + 10) {
        this.escapedBalls.add(ball.id);
        ball.lifetime = 2000 + 1000 * ctx.random();
        ctx.spawnConfetti(cx, cy);
        ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
        ctx.reportWallBreak(ball, 0);
        for (let i = 0; i < this.spawnCount; i++) {
          const a = ctx.random() * Math.PI * 2;
          const speed = ctx.config.ballSpeed || 400;
          ctx.addBall({
            x: cx,
            y: cy,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: ctx.config.ballRadius || 8,
            // --- teams --- the new balls play for the team of the ball that escaped (the other slots keep their colour)
            color: ball.team ? ball.color : ctx.config.ballColor || "#FFFFFF",
            ...(ball.team !== undefined ? { team: ball.team } : {}),
          });
        }
        spawned = true;
      }
    }
    for (const id of this.escapedBalls) {
      if (!balls.find((b) => b.id === id)) this.escapedBalls.delete(id);
    }
    if (spawned) ctx.getBrokenWalls().clear();
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean, _wallCountChanged: boolean, gapChanged: boolean) {
    if (sizeChanged || gapChanged) {
      const gap = ctx.config.gapSize || 0.3;
      const start = 0.25 * Math.PI;
      ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: [{ startAngle: start, endAngle: start + gap }] }]);
      ctx.setWallRotations([0]);
    }
    return true;
  }
  shouldSkipWallCollision(ball: Ball) {
    return this.escapedBalls.has(ball.id);
  }
  /** The half of an escaped ball is escaped too: it flies out with its parent instead of counting as a new escape. */
  onBallSplit(_ctx: ModeContext, parent: Ball, half: Ball) {
    if (this.escapedBalls.has(parent.id)) this.escapedBalls.add(half.id);
  }
  isFinished() {
    return false;
  }
  getState() {
    return {};
  }
  getSpawnCount() {
    return this.spawnCount;
  }
  setSpawnCount(n: number) {
    this.spawnCount = n;
  }
}
