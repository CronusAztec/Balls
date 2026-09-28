import type { Ball, GameMode, ModeContext } from "../types";

/** Classic: a ball works its way out through concentric rings, each with one gap. */
export class ClassicMode implements GameMode {
  readonly name = "classic";

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  onWallHit() {}
  onGapPass() {
    return false;
  }
  onPostUpdate() {}
  onConfigChange() {
    return false;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished(ctx: ModeContext) {
    return allBallsFarAway(ctx);
  }
  getState() {
    return {};
  }
}

/** True when every ball has left the visible area (used by several modes). */
export function allBallsFarAway(ctx: ModeContext, factor = 1.5): boolean {
  const balls = ctx.getBalls();
  if (balls.length === 0) return true;
  const cx = ctx.config.width / 2;
  const cy = ctx.config.height / 2;
  const limit = factor * Math.max(ctx.config.width, ctx.config.height);
  return balls.every((b: Ball) => Math.hypot(b.x - cx, b.y - cy) > limit);
}
