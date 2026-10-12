import type { Ball, GameMode, ModeContext, WallHitResult } from "../types";
import { RING_CHORD_HZ, RingTimer, ringPluckHz, ringPluckLevel, ringStepHz, type RingEscapeView } from "../ringEscape"; // --- ring-escape ---

/** Classic: a ball works its way out through concentric rings, each with one gap. */
export class ClassicMode implements GameMode {
  readonly name = "classic";
  // --- ring-escape --- the time the run spends in each ring (lib/physics/ringEscape.ts), and the ring sounds
  private readonly ringTimer = new RingTimer();

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.ringTimer.reset(ctx.getCircularWalls().length); // --- ring-escape ---
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  /**
   * --- ring-escape --- With the ring sounds on (`config.ringSound`), a bounce off ring `wallIndex` is the loop family's
   * pentatonic pluck at that ring's degree instead of the engine's tone (the inner half bright: the small rings). Without a
   * context (the Journey's rings chamber calls it bare) or with the sounds off: nothing, as always.
   */
  onWallHit(ctx?: ModeContext, ball?: Ball, wallIndex = 0, angle = 0): WallHitResult | void {
    if (!ctx || !ball || !ctx.config.ringSound) return;
    const count = ctx.getCircularWalls().length;
    const radial = ball.vx * Math.cos(angle) + ball.vy * Math.sin(angle);
    ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: ringPluckHz(wallIndex, count), level: ringPluckLevel(radial, ctx.config.ballSpeed || 400), loopBright: 2 * wallIndex < count, melody: false });
    return { suppressSound: true };
  }
  onGapPass() {
    return false;
  }
  /** --- ring-escape --- The rings escaped this step (the broken rings): the timer moves on; with the sounds on, a ladder step each, the chord at the way out. */
  onPostUpdate(ctx?: ModeContext) {
    if (!ctx) return;
    const walls = ctx.getCircularWalls().length;
    const before = this.ringTimer.getView().escaped;
    const fresh = this.ringTimer.step(ctx.getBrokenWalls().size, walls, ctx.getElapsedMs());
    if (fresh <= 0 || !ctx.config.ringSound) return;
    for (let k = before; k < before + fresh; k++) {
      const last = k >= walls - 1;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: Math.min(k, Math.max(0, walls - 1)), loop: "step", frequency: ringStepHz(k), level: 0.7, accent: last, melody: false });
      if (last) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: RING_CHORD_HZ, level: 1, melody: false });
    }
  }
  /**
   * --- ring-escape --- The run's rings so far: the ring it is in, since when, the first escape, the way out. `rings`: the
   * rings standing now (a wall count changed between runs builds them anew before the next step counts them).
   */
  getRingView(rings?: number): Readonly<RingEscapeView> {
    if (rings !== undefined) this.ringTimer.syncRings(rings);
    return this.ringTimer.getView();
  }
  /** --- ring-escape --- Simulation time (ms) of every escape so far. */
  getRingEscapes(): readonly number[] {
    return this.ringTimer.escapes;
  }
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
