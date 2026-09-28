import type { Ball, GameMode, Gap, ModeContext, WallHitResult } from "../types";
import { arenaRadius, TWO_PI } from "../types";

export interface Portal {
  id: number;
  color: string;
  angleA: number;
  angleB: number;
  halfWidth: number;
  uses: number;
  maxUses: number;
  exhausted: boolean;
}

export const PORTAL_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#00b894"];

/** Portal: colour-matched portal pairs teleport the ball; used-up portals become gaps. */
export class PortalMode implements GameMode {
  readonly name = "portal";
  private portals: Portal[] = [];
  private portalCount = 3;
  private teleportCount = 0;
  private escaped = false;
  private lastTeleportSimTime = 0;
  private readonly teleportCooldown = 150;

  init(ctx: ModeContext) {
    this.teleportCount = 0;
    this.escaped = false;
    this.lastTeleportSimTime = 0;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.generatePortals(ctx);
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, _wallIndex: number, angle: number): WallHitResult | void {
    if (this.escaped) return;
    const now = ctx.getElapsedMs();
    if (now - this.lastTeleportSimTime < this.teleportCooldown) return;
    for (const portal of this.portals) {
      if (portal.exhausted) continue;
      const side = this.isAngleInPortal(angle, portal.angleA, portal.halfWidth)
        ? "A"
        : this.isAngleInPortal(angle, portal.angleB, portal.halfWidth)
          ? "B"
          : null;
      if (!side) continue;
      const exitAngle = side === "A" ? portal.angleB : portal.angleA;
      const wall = ctx.getCircularWalls()[0];
      if (!wall) return;
      const cx = ctx.config.width / 2;
      const cy = ctx.config.height / 2;
      const r = wall.radius - ball.radius - 5;
      ball.x = cx + Math.cos(exitAngle) * r;
      ball.y = cy + Math.sin(exitAngle) * r;
      const speed = Math.max(Math.hypot(ball.vx, ball.vy), ctx.config.ballSpeed || 400);
      const spread = 0.4 * Math.PI;
      const dir = exitAngle + Math.PI + (ctx.random() - 0.5) * spread;
      ball.vx = Math.cos(dir) * speed;
      ball.vy = Math.sin(dir) * speed;
      portal.uses++;
      this.teleportCount++;
      this.lastTeleportSimTime = now;
      ctx.spawnConfetti(ball.x, ball.y);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
      if (portal.uses >= portal.maxUses) {
        portal.exhausted = true;
        this.rebuildWallGaps(ctx);
      }
      return { suppressBounce: true, suppressGlow: true };
    }
  }
  onGapPass() {
    return false;
  }
  onPostUpdate(ctx: ModeContext) {
    if (this.escaped) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const ball = ctx.getBalls()[0];
    if (!ball) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    if (Math.hypot(ball.x - cx, ball.y - cy) > walls[0].radius + ball.radius + 10) {
      this.escaped = true;
      ctx.getBrokenWalls().add(0);
      ctx.spawnConfetti(ball.x, ball.y);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    }
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: this.buildGaps() }]);
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
    return { portals: this.portals, portalTeleportCount: this.teleportCount, portalEscaped: this.escaped };
  }
  getPortals() {
    return this.portals;
  }
  getTeleportCount() {
    return this.teleportCount;
  }
  hasEscaped() {
    return this.escaped;
  }
  getPortalCount() {
    return this.portalCount;
  }
  setPortalCount(n: number) {
    this.portalCount = n;
  }

  private generatePortals(ctx: ModeContext) {
    this.portals = [];
    const slots = 2 * this.portalCount;
    const step = TWO_PI / slots;
    const angles: number[] = [];
    const offset = ctx.random() * TWO_PI;
    for (let i = 0; i < slots; i++) angles.push((offset + i * step) % TWO_PI);
    for (let i = angles.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [angles[i], angles[j]] = [angles[j], angles[i]];
    }
    for (let i = 0; i < this.portalCount; i++) {
      this.portals.push({
        id: i,
        color: PORTAL_COLORS[i % PORTAL_COLORS.length],
        angleA: angles[2 * i],
        angleB: angles[2 * i + 1],
        halfWidth: 0.12,
        uses: 0,
        maxUses: 4,
        exhausted: false,
      });
    }
  }

  private isAngleInPortal(angle: number, center: number, halfWidth: number) {
    let d = angle - center;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    return Math.abs(d) <= halfWidth;
  }

  private rebuildWallGaps(ctx: ModeContext) {
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    ctx.setCircularWalls([{ radius: walls[0].radius, gaps: this.buildGaps() }]);
    ctx.setWallRotations([0]);
  }

  private buildGaps(): Gap[] {
    const gaps: Gap[] = [];
    for (const p of this.portals) {
      if (!p.exhausted) continue;
      gaps.push({ startAngle: p.angleA - p.halfWidth, endAngle: p.angleA + p.halfWidth });
      gaps.push({ startAngle: p.angleB - p.halfWidth, endAngle: p.angleB + p.halfWidth });
    }
    return gaps;
  }
}
