import type { Ball, GameMode, ModeContext, WallHitResult } from "../types";
import { arenaRadius, TWO_PI } from "../types";
import { hitDamage } from "../multipliers"; // --- gerald-multipliers ---
import { RING_CHORD_HZ } from "../ringEscape";
import { countdownSeekHz, countdownStepHz } from "../ringVoices"; // --- ring-voices ---

export interface WrongFlash {
  segment: number;
  time: number;
  /** --- ring-voices --- A right hit's flash (the tile pops, the centre number punches) instead of a wrong one's. */
  right?: boolean;
}

/** A flash lasts this long (ms of simulation time). */
export const COUNTDOWN_FLASH_MS = 400;

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
      // --- ring-voices --- the hit is a step of the ladder that climbs with every number and lands on the tonic with the
      // last one, with a bell on it – the last one with the chord. A "hit" and a "gap" event, as a right hit always sent (the
      // bounce and the break): the camera's shake, the finder and the teams' counts read them as before.
      this.wrongFlash.push({ segment: number, time: COUNTDOWN_FLASH_MS, right: true });
      const step = countdownStepHz(this.target);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "step", frequency: step, level: 0.8, accent: this.complete, melody: false });
      if (this.complete) ctx.addPendingSoundEvent({ type: "gap", wallIndex, loop: "chord", frequency: RING_CHORD_HZ, level: 1, melody: false });
      else ctx.addPendingSoundEvent({ type: "gap", wallIndex, loop: "ding", frequency: step, level: 0.5, melody: false });
      if (ctx.isBouncierEnabled()) ctx.setBounceSpeedMultiplier(1);
      return { suppressGlow: true, resetBouncier: true, suppressSound: true };
    }
    if (!this.hit.has(number)) this.wrongFlash.push({ segment: number, time: COUNTDOWN_FLASH_MS });
    // --- ring-voices --- any other bounce: a soft pluck an octave under the step the run is waiting for
    ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: countdownSeekHz(this.target), level: 0.45, melody: false });
    return { suppressGlow: true, suppressSound: true };
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
