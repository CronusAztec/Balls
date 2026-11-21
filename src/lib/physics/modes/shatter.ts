import type { Ball, CircularWall, GameMode, ModeContext, WallHitResult } from "../types";
import { TWO_PI } from "../types";
import { allBallsFarAway } from "./classic";
import { hitDamage } from "../multipliers"; // --- gerald-multipliers ---
import { RING_CHORD_HZ } from "../ringEscape";
import { shatterBreakHz, shatterChipHz, shatterFallHz } from "../ringVoices"; // --- shatter-demolition ---

export interface ShatterSegment {
  wallIndex: number;
  segmentIndex: number;
  startAngle: number;
  endAngle: number;
  hp: number;
  maxHp: number;
  hitAngles: number[];
  /** --- shatter-demolition --- Simulation time (ms) of its last chip (−1: none): the canvas flashes it from then. */
  hitMs: number;
  /** --- shatter-demolition --- Simulation time (ms) it broke (−1: it stands): the canvas bursts it into shards from then. */
  brokenMs: number;
}

// --- shatter-demolition ---
/**
 * How far clear of a ring a bounce leaves the ball (px past its radius). The engine's hit band is the radius + 2 and its own
 * push-out for Shatter the radius + 0.5, so the ball stayed in the band: it hit the ring again in every pass of every sub-step
 * – up to 20 hits a frame, each chipping a segment – and drilled a narrow tunnel out in a few seconds, buzzing at hundreds of
 * hits a second. Pushed clear, a bounce is one hit and chips at most one segment.
 */
export const SHATTER_CLEARANCE = 3;
/** The collapse after the escape: a ring starts to fall this long after the one inside it (ms), the whole stagger at most COLLAPSE_STAGGER_TOTAL_MS. */
export const COLLAPSE_STAGGER_MS = 160;
export const COLLAPSE_STAGGER_TOTAL_MS = 900;
/** How long a ring takes to fall apart (ms). */
export const COLLAPSE_FALL_MS = 700;
/** The settings' picks (the Hits per segment and Segments per ring controls): the mode holds 1–5 hits and 4–36 segments. */
export const SHATTER_HIT_CHOICES = [1, 2, 3, 4, 5] as const;
export const SHATTER_SEGMENT_CHOICES = [8, 12, 18, 24, 36] as const;
/** What the mode runs without a setting (every old link's engine, and the fingerprint's recipe). */
export const DEFAULT_SHATTER_HITS = 1;
export const DEFAULT_SHATTER_SEGMENTS = 18;
// --- shatter-even-bricks --- (review fix B3)
/**
 * Even bricks: every ring cut into segments of about the same length, the outer ring into the Segments per ring pick and a ring
 * inside it into as many as its radius allows (at least EVEN_BRICKS_MIN, or the pick when it is smaller). Off (the mode's own,
 * every old link's engine and the fingerprint's recipe), every ring has the pick: the innermost ring's 36 segments were 10°
 * wide, and a broken one left a 16 px ball a door of 2.8° to pass – the ball rattled in the smallest ring for over half the run.
 */
export const EVEN_BRICKS_MIN = 8;
export const DEFAULT_SHATTER_EVEN_BRICKS = false;

/** The segments of each of `radii` (inside out) for a pick of `perRing` a ring: all the same, or even bricks. */
export function shatterSegmentCounts(radii: readonly number[], perRing: number, evenBricks: boolean): number[] {
  const outer = radii.length > 0 ? radii[radii.length - 1] : 0;
  if (!evenBricks || !(outer > 0)) return radii.map(() => perRing);
  const least = Math.min(EVEN_BRICKS_MIN, perRing);
  return radii.map((r) => Math.max(least, Math.min(perRing, Math.round((perRing * r) / outer))));
}
// --- end shatter-even-bricks ---

export function isShatterHits(value: unknown): value is number {
  return typeof value === "number" && (SHATTER_HIT_CHOICES as readonly number[]).includes(value);
}
export function isShatterSegments(value: unknown): value is number {
  return typeof value === "number" && (SHATTER_SEGMENT_CHOICES as readonly number[]).includes(value);
}

/** The collapse as the canvas reads it: when the ball got out (−1: not yet), and each ring's start and fall. */
export interface ShatterView {
  escapedMs: number;
  staggerMs: number;
  fallMs: number;
  /** Rings that fell (their sound played): the canvas holds the end banner until every one has. */
  fallen: number;
  rings: number;
  /** Rings the ball furthest out has left behind (all of them once it is out): the canvas' rings-to-go pips. */
  ringsOut: number;
  /** The last ring is down and the chord played: the run is over, and the banner comes with this very step. */
  collapsed: boolean;
}

/** The stagger between two rings' collapse for a run of `rings`: COLLAPSE_STAGGER_MS, shorter with many rings. */
export function collapseStaggerMs(rings: number): number {
  return rings > 1 ? Math.min(COLLAPSE_STAGGER_MS, COLLAPSE_STAGGER_TOTAL_MS / (rings - 1)) : 0;
}

/** How long the whole collapse takes for a run of `rings`: the last ring starts falling after the stagger and falls. */
export function collapseDurationMs(rings: number): number {
  return Math.max(0, rings - 1) * collapseStaggerMs(rings) + COLLAPSE_FALL_MS;
}
// --- end shatter-demolition ---

/**
 * Shatter: walls are made of segments with hit points; broken segments become gaps. --- shatter-demolition --- A bounce chips
 * one segment (the ball is pushed clear of the ring: SHATTER_CLEARANCE) with a crack that climbs ring by ring, a segment that
 * falls breaks deeper, and once the ball is out every segment still standing collapses, ring by ring from the inside out, to a
 * falling run of glass – the run ends when the last ring has fallen, and the banner comes with it.
 */
export class ShatterMode implements GameMode {
  readonly name = "shatter";
  private segments: ShatterSegment[][] = [];
  private segmentsPerWall = DEFAULT_SHATTER_SEGMENTS;
  private hpPerSegment = DEFAULT_SHATTER_HITS;
  private evenBricks = DEFAULT_SHATTER_EVEN_BRICKS; // --- shatter-even-bricks ---
  private escaped = false;
  // --- shatter-demolition --- the collapse: when the ball got out, and the rings whose fall has sounded
  private escapedMs = -1;
  private fallen = 0;
  private chordPlayed = false;
  /** --- shatter-demolition --- Each ball's last contact (simulation ms, the step's clock): one chip and one sound a ball a step. */
  private readonly contactMs = new Map<number, number>();
  private readonly view: ShatterView = { escapedMs: -1, staggerMs: 0, fallMs: COLLAPSE_FALL_MS, fallen: 0, rings: 0, ringsOut: 0, collapsed: false };
  private ringsOut = 0;

  init(ctx: ModeContext) {
    this.escaped = false;
    this.escapedMs = -1;
    this.fallen = 0;
    this.chordPlayed = false;
    this.ringsOut = 0;
    this.contactMs.clear();
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
  // --- shatter-even-bricks --- (the rings are built with the next init or wall count, like the segments and hits)
  getEvenBricks() {
    return this.evenBricks;
  }
  setEvenBricks(on: boolean) {
    this.evenBricks = on === true;
  }
  hasEscaped() {
    return this.escaped;
  }
  /** --- shatter-demolition --- The collapse for the canvas (one object, refreshed in place). */
  getView(): Readonly<ShatterView> {
    const rings = this.segments.length;
    this.view.escapedMs = this.escapedMs;
    this.view.staggerMs = collapseStaggerMs(rings);
    this.view.fallMs = COLLAPSE_FALL_MS;
    this.view.fallen = this.fallen;
    this.view.rings = rings;
    this.view.ringsOut = this.escaped ? rings : this.ringsOut;
    this.view.collapsed = this.chordPlayed;
    return this.view;
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
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void {
    const wall = ctx.getCircularWalls()[wallIndex];
    if (!wall) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    // --- shatter-demolition --- clear of the ring's hit band, on the side the ball is on: the next pass leaves the ring alone
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const d = Math.hypot(dx, dy);
    const inside = d < wall.radius;
    if (d > 0) {
      const to = inside ? wall.radius - (ball.radius + SHATTER_CLEARANCE) : wall.radius + ball.radius + SHATTER_CLEARANCE;
      ball.x = cx + (dx / d) * to;
      ball.y = cy + (dy / d) * to;
    }
    const outcome = this.damage(ctx, ball, wallIndex, angle, wall, inside);
    // --- shatter-demolition --- a ball wedged between two rings closer than its size touches both in every pass: it sounds once
    // a step, as a bounce does, not up to twenty times (a break always: the camera and the face read it)
    const now = ctx.getElapsedMs();
    const first = this.contactMs.get(ball.id) !== now;
    this.contactMs.set(ball.id, now);
    if (!first && outcome !== "break") return { suppressSound: true };
    // --- shatter-demolition --- glass instead of the engine's blip: one "hit" a bounce (and a "gap" a break), as before
    if (outcome === "break") {
      ctx.addPendingSoundEvent({ type: "hit", wallIndex, plCrack: true, frequency: shatterBreakHz(wallIndex), level: 0.75, melody: false, ringVoice: "contact" });
      ctx.addPendingSoundEvent({ type: "gap", wallIndex, loop: "land", frequency: shatterBreakHz(wallIndex) / 4, level: 0.7, melody: false, ringVoice: "contact" });
    } else if (outcome === "chip") ctx.addPendingSoundEvent({ type: "hit", wallIndex, plCrack: true, frequency: shatterChipHz(wallIndex), level: 0.5, melody: false, ringVoice: "contact" });
    else ctx.addPendingSoundEvent({ type: "hit", wallIndex, plCrack: true, frequency: shatterChipHz(wallIndex) / 4, level: 0.25, melody: false, ringVoice: "contact" });
    return { suppressSound: true };
  }

  /** The damage a bounce does: none, a chip, or the break of a segment (which becomes a gap). */
  private damage(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number, wall: CircularWall, inside: boolean): "none" | "chip" | "break" {
    const wallSegments = this.segments[wallIndex];
    if (!wallSegments) return "none";
    if (ctx.isWallSealed?.(ball, wallIndex)) return "none"; // --- rigged --- a wall the rig keeps closed to this ball takes no damage from it
    let local = (angle - (ctx.getWallRotations()[wallIndex] || 0)) % TWO_PI;
    if (local < 0) local += TWO_PI;
    const segment = wallSegments[Math.floor(local / (TWO_PI / wallSegments.length))]; // --- shatter-even-bricks --- (this ring's own count)
    if (!segment || segment.hp <= 0) return "none";
    // Only hits from inside the ring damage it.
    if (!inside) return "none";

    // Damage is focused: a segment only takes a hit when it is already the most damaged one,
    // or once the wall's most damaged segment is at least half broken. This makes the ball
    // "dig" through one spot instead of chipping evenly everywhere.
    const damage = (s: ShatterSegment) => s.maxHp - s.hp;
    const mine = damage(segment);
    let maxDamage = 0;
    for (const s of wallSegments) if (s.hp > 0) maxDamage = Math.max(maxDamage, damage(s));
    const isMostDamaged = mine === maxDamage;
    const wallWeakened = maxDamage >= segment.maxHp / 2;
    if (!(isMostDamaged || wallWeakened)) return "none";

    segment.hp -= hitDamage(ball); // --- gerald-multipliers --- the damage multiplier (1 for a plain ball)
    segment.hitAngles.push(local);
    segment.hitMs = ctx.getElapsedMs(); // --- shatter-demolition ---
    if (segment.hp > 0) return "chip";

    segment.brokenMs = ctx.getElapsedMs(); // --- shatter-demolition ---
    this.rebuildWallGaps(ctx, wallIndex);
    ctx.reportWallBreak(ball, wallIndex);
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const rotation = ctx.getWallRotations()[wallIndex] || 0;
    const mid = (segment.startAngle + segment.endAngle) / 2 + rotation;
    ctx.spawnWallBreakByStyle(wallIndex, cx + Math.cos(mid) * wall.radius, cy + Math.sin(mid) * wall.radius);
    return "break";
  }
  onGapPass() {
    return true;
  }
  onPostUpdate(ctx: ModeContext) {
    if (!this.escaped) {
      const balls = ctx.getBalls();
      if (balls.length === 0) return;
      const walls = ctx.getCircularWalls();
      if (walls.length === 0) return;
      const cx = ctx.config.width / 2;
      const cy = ctx.config.height / 2;
      const outer = walls[walls.length - 1].radius;
      let far = 0;
      for (const b of balls) far = Math.max(far, Math.hypot(b.x - cx, b.y - cy) - b.radius);
      let out = 0;
      while (out < walls.length && walls[out].radius < far) out++;
      // --- shatter-demolition --- (draw only) --- review fix B3 --- only ever up: a ball rattling in a corridor, or touching a ring
      // from outside, dips its inner edge a px or two back inside, and the pips and the lit floor flickered 5-4-5-4
      this.ringsOut = Math.max(this.ringsOut, out);
      for (const b of balls) {
        if (Math.hypot(b.x - cx, b.y - cy) > outer + b.radius + 20) {
          this.escaped = true;
          this.escapedMs = ctx.getElapsedMs(); // --- shatter-demolition ---
          break;
        }
      }
      if (!this.escaped) return;
    }
    // --- shatter-demolition --- the collapse's falling run: a crack a degree lower for every ring that falls, inside out, and
    // the chord when the last one is down (sounds with no bounce behind them: "extra")
    const rings = this.segments.length;
    const stagger = collapseStaggerMs(rings);
    const now = ctx.getElapsedMs();
    while (this.fallen < rings && now >= this.escapedMs + this.fallen * stagger - 1e-6) {
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: this.fallen, plCrack: true, frequency: shatterFallHz(this.fallen), level: 0.7, melody: false, ringVoice: "extra" });
      this.fallen++;
    }
    if (!this.chordPlayed && now >= this.escapedMs + collapseDurationMs(rings) - 1e-6) {
      this.chordPlayed = true;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: RING_CHORD_HZ, level: 1, melody: false, ringVoice: "extra" });
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
  /** --- shatter-demolition --- Over once the ball is out and the last ring has fallen (the banner comes with it). */
  isFinished(ctx: ModeContext) {
    if (this.escaped) return this.chordPlayed;
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
    this.ringsOut = 0; // --- review fix B3 --- (new rings: none passed yet; the count only goes up from here)
    const walls = ctx.getCircularWalls();
    const counts = shatterSegmentCounts(walls.map((w) => w.radius), this.segmentsPerWall, this.evenBricks); // --- shatter-even-bricks ---
    this.segments = [];
    for (let w = 0; w < walls.length; w++) {
      const segs: ShatterSegment[] = [];
      const step = TWO_PI / counts[w];
      for (let s = 0; s < counts[w]; s++) {
        segs.push({
          wallIndex: w,
          segmentIndex: s,
          startAngle: s * step,
          endAngle: (s + 1) * step,
          hp: this.hpPerSegment,
          maxHp: this.hpPerSegment,
          hitAngles: [],
          hitMs: -1,
          brokenMs: -1,
        });
      }
      this.segments.push(segs);
    }
  }
}
