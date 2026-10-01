import type { Ball, GameMode, ModeContext } from "../types";
import { arenaRadius, passableGap } from "../types";
import { ringPassRadius } from "../ballStats";
import { copyMultipliers, cruiseSpeed } from "../multipliers"; // --- gerald-multipliers ---

/**
 * Most balls a Multiply run grows to – a soft, memory-safe ceiling on the swarm, not a setting's limit (the spawn count
 * keeps its full range). Every escape adds `spawnCount` balls, so the count grows exponentially: at the defaults (three
 * new balls an escape) a run passes 1,000 balls within about a minute, and the ball pass (n² pairs, 4+ sub-steps a step)
 * then costs 60–100 ms a step – the page freezes. With multipliers in play it comes sooner (--- gerald-multipliers --- the
 * new balls inherit the escaped ball's speed, so every escape comes earlier; up to 64 sub-steps a step). Past it an
 * escape still counts (sound, confetti, scoreboard, the broken wall) but spawns nothing. Runs that never reach it replay
 * exactly as before.
 */
export const MULTIPLY_MAX_BALLS = 200;
/** @deprecated The ceiling applies to every Multiply run now; see `MULTIPLY_MAX_BALLS`. */
export const MULTIPLY_MAX_BALLS_WITH_MULTIPLIERS = MULTIPLY_MAX_BALLS;

/** Multiply: every ball that escapes the single ring spawns several new balls. */
export class MultiplyMode implements GameMode {
  readonly name = "multiply";
  private spawnCount = 3;
  private escapedBalls = new Set<number>();
  /** The ids of the balls in play, refilled every step to prune `escapedBalls` in O(n) (reused: no allocation per step). */
  private readonly liveIds = new Set<number>();

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
    // --- unlimited --- with No limits on the swarm has no MULTIPLY_MAX_BALLS: past the full-physics balls the new balls join the crowd
    const unlimited = (ctx.unlimitedRoom?.() ?? null) !== null;
    for (const ball of balls) {
      if (this.escapedBalls.has(ball.id)) continue;
      if (Math.hypot(ball.x - cx, ball.y - cy) > wall.radius + ball.radius + 10) {
        this.escapedBalls.add(ball.id);
        ball.lifetime = 2000 + 1000 * ctx.random();
        ctx.spawnConfetti(cx, cy);
        ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
        ctx.reportWallBreak(ball, 0);
        for (let i = 0; i < this.spawnCount; i++) {
          if (!unlimited && balls.length >= MULTIPLY_MAX_BALLS) break; // the swarm's soft ceiling (see MULTIPLY_MAX_BALLS) (--- unlimited --- lifted with No limits on)
          const a = ctx.random() * Math.PI * 2;
          // --- gerald-multipliers --- the new balls inherit the escaped ball's multipliers (speed, size, damage…)
          const speed = cruiseSpeed(ball, ctx.config.ballSpeed || 400);
          const size = ball.mult ? ball.mult.size : 1;
          // --- unlimited --- no room left for full-physics balls: the rest of this escape's balls fan out as crowd balls
          if (unlimited && (ctx.unlimitedRoom?.() ?? 1) <= 0) {
            ctx.spawnCrowd?.(this.spawnCount - i, cx, cy, speed, (ctx.config.ballRadius || 8) * size, a, ball.team ?? 0);
            break;
          }
          ctx.addBall({
            x: cx,
            y: cy,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: (ctx.config.ballRadius || 8) * size,
            // --- teams --- the new balls play for the team of the ball that escaped (the other slots keep their colour)
            color: ball.team ? ball.color : ctx.config.ballColor || "#FFFFFF",
            ...(ball.team !== undefined ? { team: ball.team } : {}),
            ...(ball.mult ? { mult: copyMultipliers(ball.mult), radiusScale: size, gravityScale: ball.mult.gravity } : {}),
          });
        }
        spawned = true;
      }
    }
    const live = this.liveIds;
    live.clear();
    for (const b of balls) live.add(b.id);
    for (const id of this.escapedBalls) if (!live.has(id)) this.escapedBalls.delete(id);
    if (spawned) ctx.getBrokenWalls().clear();
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean, _wallCountChanged: boolean, gapChanged: boolean) {
    if (sizeChanged || gapChanged) {
      const radius = arenaRadius(ctx.config);
      const gap = passableGap(ctx.config.gapSize || 0.3, radius, ringPassRadius(ctx.config, this.name)); // (wide enough for the ball)
      const start = 0.25 * Math.PI;
      ctx.setCircularWalls([{ radius, gaps: [{ startAngle: start, endAngle: start + gap }] }]);
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
