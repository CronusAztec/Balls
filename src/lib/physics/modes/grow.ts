import type { Ball, GameMode, ModeContext, Point, WallHitResult } from "../types";
import { arenaRadius } from "../types";
import { cruiseSpeed } from "../multipliers"; // --- boris-multipliers ---

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
  /**
   * The largest radius a ball may have in ring `wallIndex`: the smallest radius the ring reaches, less 2 px. With
   * breathing walls the live radius pulses around its base by ±amplitude, so the cap is the trough of the pulse, not
   * the current (possibly peaking) size – otherwise the ring would shrink under a ball that outgrew it.
   * The balls in play share the ring: with n > 1 each may reach 1/n of it (less the ring's 3 px push margin and 1 px of
   * slack), so two balls side by side still fit inside – grown to the single-ball cap they would stick out half beyond
   * the sealed ring and, under strong gravity, shove each other through it. One ball keeps exactly the old cap.
   */
  private maxBallRadius(ctx: ModeContext, wallIndex: number): number {
    const wall = ctx.getCircularWalls()[wallIndex];
    if (!wall) return Infinity;
    const baseRadii = ctx.getWallBaseRadii();
    const base = wallIndex < baseRadii.length ? baseRadii[wallIndex] : wall.radius;
    const limit = Math.min(wall.radius, base * (1 - ctx.getPhysicsExtras().breathingAmplitude));
    const n = ctx.getBalls().length;
    return n > 1 ? (limit - 3) / n - 1 : limit - 2;
  }
  /**
   * A grown ball keeps its size relative to the Ball Size (`radiusScale`), so a Ball Size keyframe or slider scales it;
   * scaled up (or with a wider keyframed breathing that deepens the trough) it is held to the ring's cap here, before
   * the step moves it. In a run whose Ball Size and breathing stay put no ball is ever above the cap: nothing changes.
   * A ball grown by a size multiplier is left to the multipliers, which refit it (the ring bursts, the run ends).
   */
  onPreUpdate(ctx: ModeContext) {
    const balls = ctx.getBalls();
    if (balls.length === 0 || ctx.getCircularWalls().length === 0) return;
    const cap = this.maxBallRadius(ctx, 0);
    if (!(cap > 0)) return;
    for (const ball of balls) {
      if (!(ball.radius > cap) || (ball.mult && ball.mult.size !== 1)) continue;
      ball.radius = cap;
      ball.radiusScale = cap / (ctx.config.ballRadius || 8);
    }
  }
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
      // The ball may only ever grow up to the smallest radius the ring reaches (the trough of a breathing pulse).
      const maxRadius = this.maxBallRadius(ctx, wallIndex);
      if (ball.radius < maxRadius) {
        const rate = this.growRate / 100;
        ball.radius = Math.min(maxRadius, ball.radius + (maxRadius - ball.radius) * (rate * rate * 2.1));
        // The grown size relative to the Ball Size: a keyframed (or dragged) Ball Size then scales the ball instead of
        // resetting it to the plain size (setConfig() sets every ball to ballRadius × radiusScale).
        ball.radiusScale = ball.radius / (ctx.config.ballRadius || 8);
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
          const speed = cruiseSpeed(ball, ctx.config.ballSpeed || 400); // --- boris-multipliers --- the speed multiplier
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
  /**
   * A new canvas size resizes the sealed ring to the radius a fresh start gives it (`arenaRadius()`, as the engine's "solid"
   * layout builds it – the engine has put a breathing ring back at its base radius first). The gap size and the wall count
   * do not apply to Grow's gapless ring: nothing changes.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const r = arenaRadius(ctx.config);
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) walls[0].radius = r;
    else {
      ctx.setCircularWalls([{ radius: r, gaps: [] }]);
      ctx.setWallRotations([0]);
    }
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
