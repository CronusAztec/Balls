import type { GameMode, ModeContext } from "../types";
import { arenaRadius, passableGap, TWO_PI } from "../types";
import { ringPassRadius } from "../ballStats";
import { cruiseSpeed } from "../multipliers"; // --- gerald-multipliers ---

export interface FrozenBall {
  x: number;
  y: number;
  radius: number;
  color: string;
}

/**
 * Accumulation: the ball has a limited time to escape. When the timer runs out it freezes
 * in place and becomes an obstacle for the next ball. Optional spikes on the outer wall
 * freeze the ball on contact.
 */
export class AccumulationMode implements GameMode {
  readonly name = "accumulation";
  private timer = 0;
  private timerMax = 4000;
  private frozenBalls: FrozenBall[] = [];
  private escaped = false;
  private spikesEnabled = false;
  private spikeCount = 6;
  private spikeAngles: number[] = [];
  private spikeLength = 0;

  init(ctx: ModeContext) {
    this.frozenBalls = [];
    this.escaped = false;
    this.timer = this.timerMax;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.generateSpikeAngles(ctx);
    this.spawnBall(ctx);
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    if (this.escaped) return;
    this.timer -= dtMs;
    if (this.timer <= 0 && !this.escaped) {
      const balls = ctx.getBalls();
      const active = balls.find((b) => !b.frozen);
      if (active) {
        this.frozenBalls.push({ x: active.x, y: active.y, radius: active.radius, color: active.color });
        ctx.setBalls(balls.filter((b) => b.id !== active.id));
      }
      ctx.setBounceSpeedMultiplier(1);
      this.spawnBall(ctx);
      this.timer = this.timerMax;
    }
  }

  onBallStep() {}

  onPostSubStep(ctx: ModeContext) {
    if (this.escaped) return;
    let balls = ctx.getBalls();
    let active = balls.find((b) => !b.frozen);

    // Spike collisions on the outer wall.
    if (active && this.spikesEnabled && this.spikeAngles.length > 0) {
      const walls = ctx.getCircularWalls();
      if (walls.length > 0) {
        const wall = walls[0];
        const rotation = ctx.getWallRotations()[0] || 0;
        const cx = ctx.config.width / 2;
        const cy = ctx.config.height / 2;
        const dx = active.x - cx;
        const dy = active.y - cy;
        const dist = Math.hypot(dx, dy);
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += TWO_PI;
        const innerR = wall.radius - this.spikeLength;
        for (const spike of this.spikeAngles) {
          const sa = (((spike + rotation) % TWO_PI) + TWO_PI) % TWO_PI;
          if (dist + active.radius >= innerR && dist - active.radius <= wall.radius) {
            let d = angle - sa;
            if (d > Math.PI) d -= TWO_PI;
            if (d < -Math.PI) d += TWO_PI;
            const tolerance = 0.06 * (1 - 0.6 * ((wall.radius - dist) / this.spikeLength)) + Math.atan2(active.radius, dist);
            if (Math.abs(d) < tolerance) {
              this.frozenBalls.push({ x: active.x, y: active.y, radius: active.radius, color: active.color });
              ctx.setBalls(balls.filter((b) => b.id !== active!.id));
              ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0 });
              ctx.setBounceSpeedMultiplier(1);
              this.spawnBall(ctx);
              this.timer = this.timerMax;
              balls = ctx.getBalls();
              active = balls.find((b) => !b.frozen);
              break;
            }
          }
        }
      }
    }

    // Collisions with frozen balls.
    for (const ball of balls) {
      for (const frozen of this.frozenBalls) {
        const dx = ball.x - frozen.x;
        const dy = ball.y - frozen.y;
        const dist = Math.hypot(dx, dy);
        const minDist = ball.radius + frozen.radius;
        if (dist < minDist && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          ball.x += nx * overlap;
          ball.y += ny * overlap;
          const dot = ball.vx * nx + ball.vy * ny;
          if (dot < 0) {
            ball.vx -= 2 * dot * nx;
            ball.vy -= 2 * dot * ny;
          }
          const mult = ctx.getBounceSpeedMultiplier();
          const target = cruiseSpeed(ball, ctx.config.ballSpeed || 400) * mult; // --- gerald-multipliers --- the speed multiplier
          const speed = Math.hypot(ball.vx, ball.vy);
          if (speed > 0) {
            ball.vx = (ball.vx / speed) * target;
            ball.vy = (ball.vy / speed) * target;
          }
          if (ctx.isBouncierEnabled()) ctx.setBounceSpeedMultiplier(Math.min(mult + 0.03, 3));
          ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0 });
        }
      }
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }

  onPostUpdate(ctx: ModeContext) {
    if (this.escaped) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const active = ctx.getBalls().find((b) => !b.frozen);
    if (!active) return;
    const wall = walls[0];
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    if (Math.hypot(active.x - cx, active.y - cy) > wall.radius + active.radius + 10) {
      this.escaped = true;
      ctx.getBrokenWalls().add(0);
      ctx.spawnConfetti(active.x, active.y);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    }
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
  shouldSkipWallCollision() {
    return false;
  }
  isFinished() {
    return this.escaped;
  }
  getState() {
    return {
      frozenBalls: this.frozenBalls,
      accumulationTimer: this.timer,
      accumulationTimerMax: this.timerMax,
      accumulationEscaped: this.escaped,
      spikesEnabled: this.spikesEnabled,
      spikeCount: this.spikeCount,
      spikeAngles: this.spikeAngles,
      spikeLength: this.spikeLength,
    };
  }

  getFrozenBalls() {
    return this.frozenBalls;
  }
  getTimer() {
    return this.timer;
  }
  getTimerMax() {
    return this.timerMax;
  }
  hasEscaped() {
    return this.escaped;
  }
  getSpikesEnabled() {
    return this.spikesEnabled;
  }
  getSpikeCount() {
    return this.spikeCount;
  }
  getSpikeAngles() {
    return this.spikeAngles;
  }
  getSpikeLength() {
    return this.spikeLength;
  }
  setTimerMax(ms: number) {
    const previous = this.timerMax;
    this.timerMax = ms;
    if (!this.escaped && previous > 0) this.timer = (this.timer / previous) * ms;
  }
  setSpikesEnabled(enabled: boolean, ctx?: ModeContext) {
    this.spikesEnabled = enabled;
    if (ctx) this.generateSpikeAngles(ctx);
  }
  setSpikeCount(count: number, ctx?: ModeContext) {
    this.spikeCount = count;
    if (ctx) this.generateSpikeAngles(ctx);
  }
  repositionFrozenBalls(sx: number, sy: number, oldCx: number, oldCy: number, newCx: number, newCy: number) {
    for (const f of this.frozenBalls) {
      f.x = newCx + (f.x - oldCx) * sx;
      f.y = newCy + (f.y - oldCy) * sy;
    }
  }

  private spawnBall(ctx: ModeContext) {
    const a = ctx.random() * Math.PI * 2;
    const speed = ctx.config.ballSpeed || 400;
    ctx.addBall({
      x: ctx.config.width / 2,
      y: ctx.config.height / 2,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      radius: ctx.config.ballRadius || 8,
      color: ctx.config.ballColor || "#FFFFFF",
    });
  }

  private generateSpikeAngles(ctx: ModeContext) {
    this.spikeAngles = [];
    if (!this.spikesEnabled || this.spikeCount <= 0) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const wall = walls[0];
    this.spikeLength = 0.15 * wall.radius;
    const gap = wall.gaps[0];
    if (!gap) return;
    let gapWidth = gap.endAngle - gap.startAngle;
    if (gapWidth < 0) gapWidth += TWO_PI;
    const start = gap.endAngle + 0.15;
    const span = TWO_PI - gapWidth - 0.3;
    if (span <= 0) return;
    for (let i = 0; i < this.spikeCount; i++) {
      this.spikeAngles.push((start + (span / (this.spikeCount + 1)) * (i + 1)) % TWO_PI);
    }
  }
}
