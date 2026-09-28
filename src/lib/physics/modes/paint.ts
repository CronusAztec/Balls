import type { Ball, GameMode, ModeContext } from "../types";
import { arenaRadius } from "../types";

export interface PaintPoint {
  x: number;
  y: number;
  color: string;
}

/** Paint: the ball leaves a rainbow trail; coverage of the circle is tracked on a grid. */
export class PaintMode implements GameMode {
  readonly name = "paint";
  private paintPoints: PaintPoint[] = [];
  private paintGrid = new Uint8Array(0);
  private readonly gridSize = 100;
  private cellsInCircle = 0;
  private coverage = 0;
  private hue = 0;

  init(ctx: ModeContext) {
    this.paintPoints = [];
    this.coverage = 0;
    this.hue = 0;
    this.initGrid();
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
  }
  onPreUpdate() {}
  onBallStep(ctx: ModeContext, ball: Ball) {
    this.addPaintPoint(ctx, ball);
  }
  onPostSubStep() {}
  onWallHit() {}
  onGapPass() {
    return false;
  }
  onPostUpdate() {}
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: [] }]);
      ctx.setWallRotations([0]);
    }
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished() {
    return this.coverage >= 0.95;
  }
  getState() {
    return { paintPoints: this.paintPoints, paintCoverage: this.coverage };
  }
  getPaintPoints() {
    return this.paintPoints;
  }
  getPaintCoverage() {
    return this.coverage;
  }

  private initGrid() {
    const n = this.gridSize;
    this.paintGrid = new Uint8Array(n * n);
    const c = n / 2;
    let count = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        if (dx * dx + dy * dy <= c * c) count++;
      }
    }
    this.cellsInCircle = count;
  }

  private addPaintPoint(ctx: ModeContext, ball: Ball) {
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const wall = walls[0];
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const R = wall.radius;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    if (dx * dx + dy * dy > R * R) return;
    const minStep = 0.4 * ball.radius;
    if (this.paintPoints.length > 0) {
      const last = this.paintPoints[this.paintPoints.length - 1];
      const ex = ball.x - last.x;
      const ey = ball.y - last.y;
      if (ex * ex + ey * ey < minStep * minStep) return;
    }
    this.hue = (this.hue + 0.3) % 360;
    this.paintPoints.push({ x: ball.x, y: ball.y, color: `hsl(${this.hue}, 85%, 55%)` });

    const n = this.gridSize;
    const gx = ((ball.x - cx) / R + 1) * 0.5 * n;
    const gy = ((ball.y - cy) / R + 1) * 0.5 * n;
    const gr = (ball.radius / R) * 0.5 * n;
    const x0 = Math.max(0, Math.floor(gx - gr));
    const x1 = Math.min(n - 1, Math.ceil(gx + gr));
    const y0 = Math.max(0, Math.floor(gy - gr));
    const y1 = Math.min(n - 1, Math.ceil(gy + gr));
    const c = n / 2;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x + 0.5 - gx;
        const ddy = y + 0.5 - gy;
        if (ddx * ddx + ddy * ddy > gr * gr) continue;
        const cdx = x + 0.5 - c;
        const cdy = y + 0.5 - c;
        if (cdx * cdx + cdy * cdy > c * c) continue;
        this.paintGrid[y * n + x] = 1;
      }
    }
    let painted = 0;
    for (let i = 0; i < this.paintGrid.length; i++) painted += this.paintGrid[i];
    this.coverage = this.cellsInCircle > 0 ? painted / this.cellsInCircle : 0;
  }
}
