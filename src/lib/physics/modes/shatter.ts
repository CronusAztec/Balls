import type { Ball, CircularWall, GameMode, ModeContext } from "../types";
import { TWO_PI } from "../types";
import { allBallsFarAway } from "./classic";
import { hitDamage } from "../multipliers"; // --- gerald-multipliers ---

export interface ShatterSegment {
  wallIndex: number;
  segmentIndex: number;
  startAngle: number;
  endAngle: number;
  hp: number;
  maxHp: number;
  hitAngles: number[];
}

/** Shatter: walls are made of segments with hit points; broken segments become gaps. */
export class ShatterMode implements GameMode {
  readonly name = "shatter";
  private segments: ShatterSegment[][] = [];
  private segmentsPerWall = 18;
  private hpPerSegment = 1;
  private escaped = false;

  init(ctx: ModeContext) {
    this.escaped = false;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.buildSegments(ctx);
  }
  getSegments() {
    return this.segments;
  }
  getSegmentsPerWall() {
    return this.segmentsPerWall;
  }
  setSegmentsPerWall(n: number) {
    this.segmentsPerWall = Math.max(4, Math.min(36, n));
  }
  getHpPerSegment() {
    return this.hpPerSegment;
  }
  setHpPerSegment(n: number) {
    this.hpPerSegment = Math.max(1, Math.min(5, n));
  }
  hasEscaped() {
    return this.escaped;
  }
  getProgress() {
    let broken = 0;
    let total = 0;
    for (const wall of this.segments) {
      for (const s of wall) {
        total++;
        if (s.hp <= 0) broken++;
      }
    }
    return { broken, total };
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number) {
    const wallSegments = this.segments[wallIndex];
    if (!wallSegments) return;
    if (ctx.isWallSealed?.(ball, wallIndex)) return; // --- rigged --- a wall the rig keeps closed to this ball takes no damage from it
    let local = (angle - (ctx.getWallRotations()[wallIndex] || 0)) % TWO_PI;
    if (local < 0) local += TWO_PI;
    const segment = wallSegments[Math.floor(local / (TWO_PI / this.segmentsPerWall))];
    if (!segment || segment.hp <= 0) return;
    const wall = ctx.getCircularWalls()[wallIndex];
    if (!wall) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    // Only hits from inside the ring damage it.
    if (dx * dx + dy * dy >= wall.radius * wall.radius) return;

    // Damage is focused: a segment only takes a hit when it is already the most damaged one,
    // or once the wall's most damaged segment is at least half broken. This makes the ball
    // "dig" through one spot instead of chipping evenly everywhere.
    const damage = (s: ShatterSegment) => s.maxHp - s.hp;
    const mine = damage(segment);
    let maxDamage = 0;
    for (const s of wallSegments) if (s.hp > 0) maxDamage = Math.max(maxDamage, damage(s));
    const isMostDamaged = mine === maxDamage;
    const wallWeakened = maxDamage >= segment.maxHp / 2;
    if (!(isMostDamaged || wallWeakened)) return;

    segment.hp -= hitDamage(ball); // --- gerald-multipliers --- the damage multiplier (1 for a plain ball)
    segment.hitAngles.push(local);
    if (segment.hp > 0) return;

    this.rebuildWallGaps(ctx, wallIndex);
    ctx.addPendingSoundEvent({ type: "gap", wallIndex });
    ctx.reportWallBreak(ball, wallIndex);
    const rotation = ctx.getWallRotations()[wallIndex] || 0;
    const mid = (segment.startAngle + segment.endAngle) / 2 + rotation;
    ctx.spawnWallBreakByStyle(wallIndex, cx + Math.cos(mid) * wall.radius, cy + Math.sin(mid) * wall.radius);
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
    const outer = walls[walls.length - 1].radius;
    for (const b of balls) {
      if (Math.hypot(b.x - cx, b.y - cy) > outer + b.radius + 20) {
        this.escaped = true;
        break;
      }
    }
  }
  /** A new wall count builds the rings and their segments anew; a new canvas size only resizes the rings (the broken segments stay). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean, wallCountChanged: boolean) {
    if (wallCountChanged) this.buildSegments(ctx);
    else if (sizeChanged) this.resizeWalls(ctx);
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished(ctx: ModeContext) {
    if (this.escaped) return true;
    return allBallsFarAway(ctx);
  }
  getState() {
    return { segments: this.segments };
  }

  private rebuildWalls(ctx: ModeContext) {
    const maxR = (Math.min(ctx.config.width, ctx.config.height) / 2) * 0.85;
    const count = ctx.config.wallCount || 5;
    const walls: CircularWall[] = [];
    const rotations: number[] = [];
    for (let i = 0; i < count; i++) {
      walls.push({ radius: maxR * (0.2 + (0.8 / count) * (i + 1)), gaps: [] });
      rotations.push(0);
    }
    ctx.setCircularWalls(walls);
    ctx.setWallRotations(rotations);
  }

  /** The rings' radii for the current canvas, exactly as `rebuildWalls()` gives them; gaps, rotations and segments stay. */
  private resizeWalls(ctx: ModeContext) {
    const maxR = (Math.min(ctx.config.width, ctx.config.height) / 2) * 0.85;
    const walls = ctx.getCircularWalls();
    const count = walls.length;
    for (let i = 0; i < count; i++) walls[i].radius = maxR * (0.2 + (0.8 / count) * (i + 1));
  }

  private rebuildWallGaps(ctx: ModeContext, wallIndex: number) {
    const segs = this.segments[wallIndex];
    if (!segs) return;
    const wall = ctx.getCircularWalls()[wallIndex];
    if (!wall) return;
    const n = segs.length;
    if (segs.every((s) => s.hp <= 0)) {
      ctx.getBrokenWalls().add(wallIndex);
      wall.gaps = [];
      return;
    }
    // Start scanning from an intact segment so runs of broken segments never wrap incorrectly.
    let start = 0;
    for (let i = 0; i < n; i++) {
      if (segs[i].hp > 0) {
        start = i;
        break;
      }
    }
    const gaps: CircularWall["gaps"] = [];
    let i = 0;
    while (i < n) {
      const idx = (start + i) % n;
      if (segs[idx].hp <= 0) {
        const gapStart = segs[idx].startAngle;
        let gapEnd = segs[idx].endAngle;
        let j = i + 1;
        while (j < n) {
          const k = (start + j) % n;
          if (segs[k].hp <= 0) {
            gapEnd = segs[k].endAngle;
            j++;
          } else break;
        }
        gaps.push({ startAngle: gapStart, endAngle: gapEnd });
        i = j;
      } else i++;
    }
    wall.gaps = gaps;
  }

  private buildSegments(ctx: ModeContext) {
    this.rebuildWalls(ctx);
    const walls = ctx.getCircularWalls();
    const step = TWO_PI / this.segmentsPerWall;
    this.segments = [];
    for (let w = 0; w < walls.length; w++) {
      const segs: ShatterSegment[] = [];
      for (let s = 0; s < this.segmentsPerWall; s++) {
        segs.push({
          wallIndex: w,
          segmentIndex: s,
          startAngle: s * step,
          endAngle: (s + 1) * step,
          hp: this.hpPerSegment,
          maxHp: this.hpPerSegment,
          hitAngles: [],
        });
      }
      this.segments.push(segs);
    }
  }
}
