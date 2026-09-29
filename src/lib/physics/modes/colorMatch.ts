import type { Ball, GameMode, ModeContext, WallHitResult } from "../types";
import { arenaRadius, TWO_PI } from "../types";

export interface ColorMatchSegment {
  index: number;
  startAngle: number;
  endAngle: number;
  color: string;
  hue: number;
  broken: boolean;
}

export const COLOR_MATCH_COLORS = [
  { hue: 0, color: "#ef4444" },
  { hue: 30, color: "#f97316" },
  { hue: 60, color: "#eab308" },
  { hue: 120, color: "#22c55e" },
  { hue: 200, color: "#3b82f6" },
  { hue: 270, color: "#a855f7" },
  { hue: 330, color: "#ec4899" },
];

/** Color Match: the ball changes colour on every bounce and only breaks matching segments. */
export class ColorMatchMode implements GameMode {
  readonly name = "colorMatch";
  private segments: ColorMatchSegment[] = [];
  private segmentCount = 12;
  private colorCount = 7;
  private ballColorIndex = 0;
  private escaped = false;
  private matchCount = 0;

  init(ctx: ModeContext) {
    this.escaped = false;
    this.matchCount = 0;
    this.ballColorIndex = Math.floor(ctx.random() * this.colorCount);
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.buildSegments(ctx);
  }
  getSegments() {
    return this.segments;
  }
  getBallColorIndex() {
    return this.ballColorIndex;
  }
  getBallColor() {
    return COLOR_MATCH_COLORS[this.ballColorIndex].color;
  }
  getBallHue() {
    return COLOR_MATCH_COLORS[this.ballColorIndex].hue;
  }
  getMatchCount() {
    return this.matchCount;
  }
  hasEscaped() {
    return this.escaped;
  }
  getSegmentCount() {
    return this.segmentCount;
  }
  setSegmentCount(n: number) {
    this.segmentCount = Math.max(6, Math.min(24, n));
  }
  getColorCount() {
    return this.colorCount;
  }
  setColorCount(n: number) {
    this.colorCount = Math.max(2, Math.min(COLOR_MATCH_COLORS.length, n));
  }
  getTotalSegments() {
    return this.segments.length;
  }
  getBrokenCount() {
    return this.segments.filter((s) => s.broken).length;
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void {
    let local = (angle - (ctx.getWallRotations()[wallIndex] || 0)) % TWO_PI;
    if (local < 0) local += TWO_PI;
    const segment = this.segments[Math.floor(local / (TWO_PI / this.segmentCount))];
    if (!segment || segment.broken) return;
    if (segment.hue === COLOR_MATCH_COLORS[this.ballColorIndex].hue) {
      segment.broken = true;
      this.matchCount++;
      ctx.setBounceSpeedMultiplier(1);
      ctx.spawnWallBreakByStyle(wallIndex, ball.x, ball.y);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex });
      ctx.creditWallBreak?.(ball); // --- teams --- the segment counts for the ball that broke it
      if (this.segments.every((s) => s.broken)) ctx.getBrokenWalls().add(wallIndex);
      return { resetBouncier: true };
    }
    this.ballColorIndex = (this.ballColorIndex + 1) % this.colorCount;
  }
  onGapPass() {
    return true;
  }
  onPostUpdate(ctx: ModeContext) {
    if (this.escaped) return;
    const balls = ctx.getBalls();
    if (balls.length === 0) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    for (const b of balls) {
      if (Math.hypot(b.x - cx, b.y - cy) > walls[0].radius + b.radius + 30) {
        this.escaped = true;
        break;
      }
    }
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      const r = arenaRadius(ctx.config);
      const walls = ctx.getCircularWalls();
      if (walls.length > 0) walls[0].radius = r;
      else {
        ctx.setCircularWalls([{ radius: r, gaps: [] }]);
        ctx.setWallRotations([0]);
      }
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
    return { segments: this.segments, ballColorIndex: this.ballColorIndex, matchCount: this.matchCount };
  }

  private buildSegments(ctx: ModeContext) {
    ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: [] }]);
    ctx.setWallRotations([0]);
    const step = TWO_PI / this.segmentCount;
    this.segments = [];
    for (let i = 0; i < this.segmentCount; i++) {
      const c = COLOR_MATCH_COLORS[i % this.colorCount];
      this.segments.push({ index: i, startAngle: i * step, endAngle: (i + 1) * step, color: c.color, hue: c.hue, broken: false });
    }
  }
}
