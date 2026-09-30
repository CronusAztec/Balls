import type { Ball, GameMode, ModeContext, WallHitResult } from "../types";
import { arenaRadius, TWO_PI } from "../types";
import { hitDamage } from "../multipliers"; // --- gerald-multipliers ---

export interface WrongFlash {
  segment: number;
  time: number;
}

/** Target (countdown): numbered segments must be hit in descending order. */
export class TargetMode implements GameMode {
  readonly name = "target";
  private total = 10;
  private target = 10;
  private hit = new Set<number>();
  private wrongFlash: WrongFlash[] = [];
  private complete = false;
  private randomOrder = false;
  private segmentMap: number[] = [];

  init(ctx: ModeContext) {
    this.target = this.total;
    this.hit.clear();
    this.wrongFlash = [];
    this.complete = false;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.segmentMap = Array.from({ length: this.total }, (_, i) => this.total - i);
    if (this.randomOrder) {
      for (let i = this.segmentMap.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        [this.segmentMap[i], this.segmentMap[j]] = [this.segmentMap[j], this.segmentMap[i]];
      }
    }
  }
  onPreUpdate(_ctx: ModeContext, dtMs: number) {
    for (const f of this.wrongFlash) f.time -= dtMs;
    this.wrongFlash = this.wrongFlash.filter((f) => f.time > 0);
  }
  onBallStep() {}
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void {
    if (this.complete) return;
    const idx = Math.floor(((angle + 2.5 * Math.PI) % TWO_PI) / (TWO_PI / this.total));
    const number = this.segmentMap[idx] ?? this.total - idx;
    if (number === this.target) {
      this.hit.add(number);
      this.target--;
      // --- gerald-multipliers --- damage ×n clears n numbers with one correct hit
      for (let extra = Math.floor(hitDamage(ball)) - 1; extra > 0 && this.target > 0; extra--) {
        this.hit.add(this.target);
        this.target--;
      }
      if (this.target <= 0) {
        this.complete = true;
        ctx.getBrokenWalls().add(wallIndex);
      }
      ctx.spawnWallBreakByStyle(wallIndex, ball.x, ball.y);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex });
      if (ctx.isBouncierEnabled()) ctx.setBounceSpeedMultiplier(1);
      return { suppressGlow: true, resetBouncier: true };
    }
    if (!this.hit.has(number)) this.wrongFlash.push({ segment: number, time: 400 });
    return { suppressGlow: true };
  }
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
    return this.complete;
  }
  getState() {
    return {
      countdownTotal: this.total,
      countdownTarget: this.target,
      countdownHit: this.hit,
      countdownWrongFlash: this.wrongFlash,
      countdownComplete: this.complete,
      countdownRandomOrder: this.randomOrder,
      countdownSegmentMap: this.segmentMap,
    };
  }
  getTotal() {
    return this.total;
  }
  getTarget() {
    return this.target;
  }
  getHit() {
    return this.hit;
  }
  getWrongFlashes() {
    return this.wrongFlash;
  }
  isComplete() {
    return this.complete;
  }
  isRandomOrder() {
    return this.randomOrder;
  }
  getSegmentMap() {
    return this.segmentMap;
  }
  setTotal(n: number) {
    this.total = n;
  }
  setRandomOrder(v: boolean) {
    this.randomOrder = v;
  }
}
