import { ClassicMode } from "../modes/classic";
import { segmentBetween } from "../obstacles";
import type { Ball, CircularWall, WallHitResult } from "../types";
import { BaseStage, type StageEnv, type StageMap, type StagePainter } from "./stage";
import type { JourneyStageSize } from "./sequence";

/**
 * "rings" – a compact concentric-rings escape, Classic in a box: 3–9 rings with one rotating gap each. The rings are
 * the engine's own ring walls (`ctx.setCircularWalls()`), live only while this stage is the active one – the journey
 * keeps the active stage centred on the canvas, which is exactly where the engine centres its rings – so the bounces,
 * the gap passes that break a ring, the wall tones, the wall-break effects, the cinematic director's drama, bouncier
 * walls and breathing walls all work as in Classic, whose (tiny) mode logic the stage delegates to. The ball drops in
 * through a chute to the core (`CHUTE_SEC`, scripted), is launched at the Ball Speed in a seeded direction under
 * Classic's gravity, and once it is out of the outermost ring the rings are gone and the journey's gravity takes it
 * down to the next stage. A ring whose gap the ball has not found after `PATIENCE_SEC` slowly widens, so a stage always
 * ends.
 */

/** Seconds the drop through the chute into the core takes. */
export const CHUTE_SEC = 0.45;
/** After this long inside, the gaps start widening (rad/s) up to half a turn, so every rings stage ends. */
export const PATIENCE_SEC = 5;
export const GAP_WIDEN_RATE = 0.3;
/** A stage's gaps are this many times the Gap Size setting: a compact escape, one stage of several, should not drag on. */
export const RING_GAP_SCALE = 1.6;
export const MAX_GAP = Math.PI;
/** Ring count ranges by size: [min, max] (fewer when the canvas leaves no room between them for the ball). */
export const RING_COUNTS: Record<JourneyStageSize, [number, number]> = { s: [3, 4], m: [5, 6], l: [7, 9] };
/** Radius of the outermost ring by size, in view heights: a medium or large stage bulges out of the column into a chamber. */
export const RING_OUTER: Record<JourneyStageSize, number> = { s: 0.28, m: 0.34, l: 0.39 };
/** Room between the outermost ring and the chamber's walls, in view heights. */
export const CHAMBER_MARGIN = 0.02;
/** The chamber's straight walls reach this fraction of the outer radius above and below the centre; slopes join them to the column. */
export const CHAMBER_SPAN = 0.55;
/** Random numbers a rings stage always draws (the count, the launch direction and one start angle per possible ring). */
export const MAX_RINGS = 9;

/** Rings are at least this many ball radii (plus 3 px) apart, so the ball fits between two of them. */
export const MIN_RING_SPACING_RADII = 2.3;

export type RingsPhase = "waiting" | "chute" | "inside" | "escaped";

export class RingsStage extends BaseStage {
  readonly kind = "rings" as const;
  private readonly classic = new ClassicMode();
  /** Centre of the rings (the canvas centre while the stage is live). */
  cx = 0;
  cy = 0;
  radii: number[] = [];
  /** Where each ring's gap starts (radians, before the engine's rotation). */
  startAngles: number[] = [];
  /** The seeded launch direction out of the core. */
  launchAngle = 0;
  phase: RingsPhase = "waiting";
  /** The rings are in the engine right now. */
  live = false;
  /** Rings broken so far (mirrored from the engine every step, so a resize – which clears the engine's set – can put them back). */
  broken: boolean[] = [];
  /** The chute: where the ball came in and how far down it is (0–1). */
  chuteX = 0;
  chuteY = 0;
  chuteT = 0;
  /** Simulation ms the ball got into the core (the patience clock). */
  insideAtMs = 0;
  escapedAtMs = -Infinity;
  bounces = 0;

  constructor(index: number, size: JourneyStageSize) {
    super(index, size);
  }

  protected layout(random: () => number, ballRadius: number) {
    const b = this.bounds;
    const u = random();
    this.launchAngle = random() * 2 * Math.PI;
    const angles: number[] = [];
    for (let i = 0; i < MAX_RINGS; i++) angles.push(random() * 2 * Math.PI);
    const [lo, hi] = RING_COUNTS[this.size];
    let count = lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1)));
    const outer = Math.max(4 * ballRadius, Math.min(RING_OUTER[this.size] * b.viewH, b.height / 2 - 0.05 * b.viewH));
    const inner = Math.min(outer * 0.6, Math.max(3.6 * ballRadius, 0.2 * outer));
    // The ball must fit between two rings: fewer rings on a small canvas.
    const minSpacing = MIN_RING_SPACING_RADII * ballRadius + 3;
    count = Math.max(1, Math.min(count, 1 + Math.floor((outer - inner) / minSpacing)));
    this.radii = [];
    for (let i = 0; i < count; i++) this.radii.push(count === 1 ? outer : inner + ((outer - inner) * i) / (count - 1));
    this.startAngles = angles.slice(0, count);
    this.cx = b.cx;
    this.cy = (b.top + b.bottom) / 2;
    this.buildChamber(outer);
    this.phase = "waiting";
    this.live = false;
    this.broken = this.radii.map(() => false);
    this.chuteT = 0;
    this.bounces = 0;
    this.escapedAtMs = -Infinity;
  }

  /**
   * Rings wider than the column sit in a chamber: its own side walls (obstacles) run straight up and down beside the
   * rings and slope back to the column above and below them, so a ball that escaped sideways is funnelled back down.
   */
  private buildChamber(outer: number) {
    const b = this.bounds;
    const half = b.width / 2;
    const reach = outer + CHAMBER_MARGIN * b.viewH;
    if (reach <= half) return;
    this.ownWalls = true;
    this.reach = reach;
    const span = CHAMBER_SPAN * outer;
    const cy = (b.top + b.bottom) / 2;
    for (const side of [-1, 1]) {
      const col = b.cx + side * half;
      const wall = b.cx + side * reach;
      this.obstacles.push(
        segmentBetween(col, b.top, wall, cy - span, { restitution: 0.6 }),
        segmentBetween(wall, cy - span, wall, cy + span, { restitution: 0.6 }),
        segmentBetween(wall, cy + span, col, b.bottom, { restitution: 0.6 }),
      );
    }
  }

  /** Width of ring i's gap for a ball of `ballRadius`: `RING_GAP_SCALE` × the Gap Size setting, never narrower than the ball needs there. */
  gapWidth(i: number, ballRadius: number, gapSetting: number): number {
    const r = this.radii[i];
    const need = 3.2 * Math.atan2(ballRadius, r);
    return Math.min(MAX_GAP, Math.max((gapSetting > 0 ? gapSetting : 0.3) * RING_GAP_SCALE, need));
  }

  /** The engine's walls for this stage (gaps sized for the ball as it is now). */
  private buildWalls(ballRadius: number, gapSetting: number): CircularWall[] {
    return this.radii.map((radius, i) => {
      const start = this.startAngles[i];
      return { radius, gaps: [{ startAngle: start, endAngle: start + this.gapWidth(i, ballRadius, gapSetting) }] };
    });
  }

  enter(env: StageEnv, ball: Ball) {
    const ctx = env.ctx;
    // The journey centred this stage on the canvas: the engine's rings are centred there.
    this.cx = ctx.config.width / 2;
    this.cy = ctx.config.height / 2;
    ctx.setCircularWalls(this.buildWalls(ball.radius, ctx.config.gapSize));
    ctx.setWallRotations(this.radii.map(() => 0));
    ctx.getBrokenWalls().clear();
    ctx.setBounceSpeedMultiplier(1);
    this.live = true;
    this.phase = "chute";
    this.chuteX = ball.x;
    this.chuteY = ball.y;
    this.chuteT = 0;
  }

  controlsBall() {
    return this.phase === "chute";
  }
  ballMayRest() {
    return this.phase !== "inside";
  }
  skipsWallCollision() {
    return this.phase !== "inside";
  }
  /** Inside the rings the ball flies under Classic's gravity (the Gravity setting × Ball Speed / 300), not the journey's. */
  gravityOverride(env: StageEnv) {
    if (this.phase !== "inside") return -1;
    const cfg = env.ctx.config;
    return (cfg.gravity * (cfg.ballSpeed || 400)) / 300;
  }
  maxBallRadius() {
    if (this.radii.length < 2) return Infinity;
    return (this.radii[1] - this.radii[0]) / 2 - 2;
  }

  onBallStep(env: StageEnv, ball: Ball, dtSec: number) {
    if (this.phase !== "chute") return;
    // Down the chute: straight to the core, accelerating.
    this.chuteT = Math.min(1, this.chuteT + dtSec / CHUTE_SEC);
    const t = this.chuteT;
    const ease = t * t;
    const x = this.chuteX + (this.cx - this.chuteX) * (t * (2 - t));
    const y = this.chuteY + (this.cy - this.chuteY) * ease;
    ball.vx = dtSec > 0 ? (x - ball.x) / dtSec : 0;
    ball.vy = dtSec > 0 ? (y - ball.y) / dtSec : 0;
    ball.x = x;
    ball.y = y;
    if (t >= 1) {
      // Out of the chute: launched like a Classic ball, at the Ball Speed (× the speed multiplier) in the seeded direction.
      const speed = (env.ctx.config.ballSpeed || 400) * (ball.mult ? ball.mult.speed : 1);
      ball.x = this.cx;
      ball.y = this.cy;
      ball.vx = Math.cos(this.launchAngle) * speed;
      ball.vy = Math.sin(this.launchAngle) * speed;
      this.phase = "inside";
      this.insideAtMs = env.timeMs;
    }
  }

  /** Classic's rules for the engine's ring hooks while the rings are live (a bounce is a bounce, a gap pass breaks the ring). */
  onWallHit(): WallHitResult | void {
    this.bounces++;
    return this.classic.onWallHit();
  }
  onGapPass(): boolean {
    return this.classic.onGapPass();
  }

  update(env: StageEnv, ball: Ball | null, dtSec: number, active: boolean) {
    if (!active || !this.live) return;
    const ctx = env.ctx;
    const broken = ctx.getBrokenWalls();
    // A resize cleared the engine's broken rings: put them back.
    for (let i = 0; i < this.broken.length; i++) {
      if (broken.has(i)) this.broken[i] = true;
      else if (this.broken[i]) broken.add(i);
    }
    if (this.phase !== "inside" || !ball) return;
    const walls = ctx.getCircularWalls();
    // Patience: gaps not found for a while widen slowly.
    if (env.timeMs - this.insideAtMs > PATIENCE_SEC * 1000) {
      for (let i = 0; i < walls.length; i++) {
        if (broken.has(i)) continue;
        const gap = walls[i].gaps[0];
        if (gap && gap.endAngle - gap.startAngle < MAX_GAP) gap.endAngle = Math.min(gap.startAngle + MAX_GAP, gap.endAngle + GAP_WIDEN_RATE * dtSec);
      }
    }
    // Out of the outermost ring: the rings are done – the journey's gravity takes the ball down.
    const outer = this.radii[this.radii.length - 1] ?? 0;
    const dist = Math.hypot(ball.x - this.cx, ball.y - this.cy);
    if (dist > outer + ball.radius + 1) this.escape(env);
  }

  private escape(env: StageEnv) {
    const ctx = env.ctx;
    this.phase = "escaped";
    this.escapedAtMs = env.timeMs;
    for (let i = 0; i < this.broken.length; i++) this.broken[i] = true;
    ctx.setCircularWalls([]);
    ctx.setWallRotations([]);
    ctx.getBrokenWalls().clear();
    this.live = false;
  }

  onBallExit(env: StageEnv) {
    // Left the stage while still inside (cannot happen with intact rings, but never leave rings behind in the engine).
    if (this.live) this.escape(env);
  }

  /** The live rings at a new size: the rings scale about the canvas centre (the journey's map keeps them there). */
  rebuildLive(env: StageEnv, ballRadius: number) {
    if (!this.live) return;
    const ctx = env.ctx;
    const walls = ctx.getCircularWalls();
    const next = this.buildWalls(ballRadius, ctx.config.gapSize);
    // Keep any widening the patience clock gave.
    for (let i = 0; i < next.length && i < walls.length; i++) {
      const old = walls[i].gaps[0];
      const gap = next[i].gaps[0];
      if (old && gap) gap.endAngle = gap.startAngle + Math.max(gap.endAngle - gap.startAngle, old.endAngle - old.startAngle);
    }
    ctx.setCircularWalls(next);
    this.cx = ctx.config.width / 2;
    this.cy = ctx.config.height / 2;
  }

  protected shiftOwn(dy: number) {
    this.cy += dy;
    this.chuteY += dy;
  }
  protected rescaleOwn(map: StageMap) {
    this.cx = map.x(this.cx);
    this.cy = map.y(this.cy);
    this.chuteX = map.x(this.chuteX);
    this.chuteY = map.y(this.chuteY);
    this.radii = this.radii.map((r) => r * map.k);
  }

  render(painter: StagePainter) {
    painter.rings(this);
  }
}
