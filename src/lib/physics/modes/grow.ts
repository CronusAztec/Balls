import type { Ball, GameMode, LoopSeams, ModeContext, Point, SoundEvent, WallHitResult } from "../types";
import { arenaRadius } from "../types";
import { cruiseSpeed } from "../multipliers"; // --- gerald-multipliers ---
import { startBallAngle, startBallColor, startBallCount } from "../ballStats"; // --- loop-foundation ---
import { frequencyFromScalar, LOOP_SPAN } from "@/lib/audio/loopPitch"; // --- loop-foundation ---
import { pluckVelocity } from "@/lib/audio/loopTones"; // --- loop-foundation ---

/*
 * --- loop-foundation --- Grow's "fill and loop" upgrade (after the growing-ball clips of the loop family): two options on top
 * of the classic mode, both off by default so every old run and preset replays exactly.
 *
 * - **Growth law** (`law`): "approach" – the classic rule, each bounce closes a share of the gap to the cap (fast at first,
 *   slow at the end) –, "multiply" – r ← min(cap, r · (1 + step / 100)): slow at first, explosive at the end, the bounces
 *   crowding together as the free chord shortens – or "add" – r ← min(cap, r + step px). The new laws start the ball at
 *   `startPct` % of the ring, in the centre, and bounce it in clean straight chords: a specular rebound at the Ball Speed that
 *   never comes back closer than `chordAngle` to the diameter (drawn from the seed per run), so every cycle of a run plays the
 *   same chord pattern turned by its launch direction.
 * - **On fill** (`onFill`): "stay" (the classic: the full ball keeps buzzing), "loop" – when the ball reaches the cap (within
 *   0.5 px) it snaps to it and holds `holdSec`, shrinks back to the start size in the centre over `shrinkSec` (eased) and
 *   relaunches at the Ball Speed in a seeded direction: a seamless cycle, reported to the recorder (`cycleSeconds()`,
 *   `loopSeams()`) – or "finish": the run ends at the fill (Find Simulation can then search it).
 *
 * Times are exact on the simulation clock: the fill is the end of the step it happened in, the shrink starts `holdSec` later
 * and the relaunch `shrinkSec` after that, whatever the frame rate. Random draws (ctx.random(), in this order): at init with a
 * new law the launch direction, the chord angle and the chord side; at every relaunch the direction and the side. The classic
 * law draws exactly what it always drew.
 *
 * Sound: with "Pitch by size" (`pitch`) every bounce is a pentatonic pluck (lib/audio/loopTones.ts) whose degree falls as the
 * ball grows (`growPitch()`: log size over 14 degrees, about two bounces a degree with ×1.11); the fill plays the completion
 * chord on G2 (an open G – root, fifth, octave, twelfth, soft tenth – with a ding and a sub thump), the shrink cuts the loop
 * voices and glides from the chord's root up to an octave under the next cycle's first note, ending at the relaunch.
 */

export const GROW_LAWS = ["approach", "multiply", "add"] as const;
export type GrowLaw = (typeof GROW_LAWS)[number];
export const GROW_ON_FILL = ["stay", "loop", "finish"] as const;
export type GrowOnFill = (typeof GROW_ON_FILL)[number];
export type GrowPhase = "grow" | "hold" | "shrink" | "done";

export function isGrowLaw(value: unknown): value is GrowLaw {
  return typeof value === "string" && (GROW_LAWS as readonly string[]).includes(value);
}
export function isGrowOnFill(value: unknown): value is GrowOnFill {
  return typeof value === "string" && (GROW_ON_FILL as readonly string[]).includes(value);
}

/** What the engine runs of the upgrade (the page's settings resolved; lib/physics/growFill.ts holds the settings side). */
export interface GrowFillSettings {
  law: GrowLaw;
  onFill: GrowOnFill;
  /** Growth per bounce: percent ("multiply") or px ("add"); ≥ 0. */
  step: number;
  /** The new laws' start size, percent of the ring (> 0). */
  startPct: number;
  /** Seconds the full ball holds before it shrinks, and the shrink's length (≥ 0). */
  holdSec: number;
  shrinkSec: number;
  /** Every bounce a pluck pitched by the ball's size. */
  pitch: boolean;
}

export const DEFAULT_GROW_FILL: Readonly<GrowFillSettings> = { law: "approach", onFill: "stay", step: 11, startPct: 5, holdSec: 1.6, shrinkSec: 1, pitch: false };

/** The ball counts as full within this many px of its cap. */
export const FILL_EPSILON_PX = 0.5;
/** The most contact markers kept (a ring buffer). */
export const MAX_GROW_MARKERS = 64;
/** The chord angle of the new laws (degrees off the diameter), drawn per run in this range. */
export const CHORD_ANGLE_MIN_DEG = 18;
export const CHORD_ANGLE_MAX_DEG = 36;
/** The completion chord's root (G2, the dominant of the C pentatonic the plucks play in). */
export const GROW_CHORD_HZ = 97.999;
/** Time tolerance (ms) of the phase changes on the simulation clock (floating-point steps). */
const PHASE_EPS_MS = 0.5;

/** The radius after one bounce of `law` from `r` (never past `cap`; a step below 0 counts as 0). */
export function growStepRadius(law: GrowLaw, r: number, step: number, cap: number, approachRate = 0.05): number {
  if (!(r < cap)) return r;
  const s = Number.isFinite(step) && step > 0 ? step : 0;
  let next: number;
  if (law === "multiply") next = r * (1 + s / 100);
  else if (law === "add") next = r + s;
  else next = r + (cap - r) * (approachRate * approachRate * 2.1);
  return next < cap ? next : cap;
}

/** The pluck's pitch (Hz) of a ball of radius `r` growing from `r0` to `cap`: log size over 14 pentatonic degrees, bigger = lower. */
export function growPitch(r: number, r0: number, cap: number): number {
  const lo = Math.log(Math.max(1e-3, Math.min(r0, cap)));
  const hi = Math.log(Math.max(1e-3, cap));
  return frequencyFromScalar(Math.log(Math.max(1e-3, r)), lo, hi > lo ? hi : lo + 1e-6, LOOP_SPAN, true);
}

/**
 * A specular rebound off the wall with outward normal (nx, ny) that never leaves within `alpha` (radians) of the inward
 * normal: a ball that came in (nearly) radially leaves at `alpha` to the diameter, on `side` (±1) when it came in exactly
 * radially, else on its own side. Returns the new velocity at `speed` in `out`.
 */
export function chordRebound(vx: number, vy: number, nx: number, ny: number, alpha: number, side: number, speed: number, out: { vx: number; vy: number }): { vx: number; vy: number } {
  const dot = vx * nx + vy * ny;
  let rx = vx - 2 * dot * nx;
  let ry = vy - 2 * dot * ny;
  // components along the inward normal (−n) and the tangent t = (−ny, nx)
  const inward = -(rx * nx + ry * ny);
  const tang = rx * -ny + ry * nx;
  const angle = Math.atan2(Math.abs(tang), Math.max(0, inward));
  if (angle < alpha) {
    const sign = Math.abs(tang) > 1e-9 * Math.max(1, Math.abs(inward)) ? Math.sign(tang) : side >= 0 ? 1 : -1;
    const c = Math.cos(alpha);
    const s = Math.sin(alpha) * sign;
    // the inward normal turned by ±alpha toward the tangent
    rx = -nx * c - ny * s;
    ry = -ny * c + nx * s;
  }
  const len = Math.hypot(rx, ry);
  out.vx = len > 0 ? (rx / len) * speed : 0;
  out.vy = len > 0 ? (ry / len) * speed : 0;
  return out;
}

/** The shrink's easing (ease in-out cubic). */
export function shrinkEase(p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** The contact markers: a fixed ring buffer of (x, y, simulation ms) – the renderer draws them as fading circles. */
export class GrowMarkers {
  readonly xs = new Float64Array(MAX_GROW_MARKERS);
  readonly ys = new Float64Array(MAX_GROW_MARKERS);
  readonly ts = new Float64Array(MAX_GROW_MARKERS);
  /** Markers held (≤ MAX_GROW_MARKERS) and the slot the next one goes to. */
  count = 0;
  head = 0;

  add(x: number, y: number, tMs: number) {
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.ts[this.head] = tMs;
    this.head = (this.head + 1) % MAX_GROW_MARKERS;
    if (this.count < MAX_GROW_MARKERS) this.count++;
  }

  clear() {
    this.count = 0;
    this.head = 0;
  }
}

/** What the canvas, the finder and the smoke test read of a Grow run (the same object every call). */
export interface GrowView {
  law: GrowLaw;
  onFill: GrowOnFill;
  phase: GrowPhase;
  /** 0–1 through the hold or the shrink (0 while growing). */
  phaseProgress: number;
  /** The first ball's cap and start size (px), and the ring's radius. */
  cap: number;
  startRadius: number;
  ring: number;
  /** Fills so far, and the simulation ms of the first and of the last one (−1 before). */
  fills: number;
  firstFillMs: number;
  lastFillMs: number;
  /** Relaunches so far (the loop's seams), the last one's simulation ms (0 = the run's start) and the last whole cycle (s; 0 before). */
  seams: number;
  lastSeamMs: number;
  cycleSec: number;
  /** Bounces in this cycle and in the whole run. */
  bounces: number;
  totalBounces: number;
  /** The chord angle of the new laws (radians; 0 under the classic law). */
  chordAngle: number;
  markers: GrowMarkers;
}

/** Grow: a single sealed ring; the ball grows with every bounce until it fills the space. */
export class GrowMode implements GameMode {
  readonly name = "grow";
  private growRate = 5;
  private centerDotEnabled = false;
  private centerDotRadius = 12;
  private linesEnabled = false;
  private bouncePoints: Point[] = [];
  private readonly MAX_BOUNCE_POINTS = 500;
  private elapsedTime = 0;
  private readonly ORBIT_DELAY = 15;
  // --- loop-foundation ---
  private fill: GrowFillSettings = { ...DEFAULT_GROW_FILL };
  private phase: GrowPhase = "grow";
  /** The chord angle (radians) and the side a radial rebound leaves on, of the new laws. */
  private chordAngle = 0;
  private side = 1;
  /** Start radius of the cycle's balls (the classic law: the Ball Size at init). */
  private startRadius = 8;
  /** The balls' places while held, as offsets from the centre in ring radii (a resize keeps them in place). */
  private pinX = new Float64Array(2);
  private pinY = new Float64Array(2);
  private fillAtMs = -1;
  private holdEndMs = -1;
  private shrinkStartMs = -1;
  private shrinkEndMs = -1;
  private fills = 0;
  private firstFillMs = -1;
  private seams = 0;
  private lastSeamMs = 0;
  private lastCycleMs = 0;
  private bounces = 0;
  private totalBounces = 0;
  private readonly markers = new GrowMarkers();
  private readonly rebound = { vx: 0, vy: 0 };
  private view: GrowView | null = null;
  // --- end loop-foundation ---

  setGrowRate(rate: number) {
    this.growRate = rate;
  }
  getGrowRate() {
    return this.growRate;
  }
  setCenterDotEnabled(enabled: boolean) {
    this.centerDotEnabled = enabled;
  }
  isCenterDotEnabled() {
    return this.centerDotEnabled;
  }
  setLinesEnabled(enabled: boolean) {
    this.linesEnabled = enabled;
    if (!enabled) this.bouncePoints = [];
  }
  isLinesEnabled() {
    return this.linesEnabled;
  }
  getBouncePoints() {
    return this.bouncePoints;
  }
  private pushBouncePoint(x: number, y: number) {
    if (this.bouncePoints.length >= this.MAX_BOUNCE_POINTS) this.bouncePoints.shift();
    this.bouncePoints.push({ x, y });
  }
  // --- loop-foundation ---
  /** The growth law, what a fill does, the start size, the hold, the shrink and the pitch; the law and the start apply at the next init. */
  setFillSettings(patch: Partial<GrowFillSettings>) {
    const next = { ...this.fill, ...patch };
    this.fill = {
      law: isGrowLaw(next.law) ? next.law : DEFAULT_GROW_FILL.law,
      onFill: isGrowOnFill(next.onFill) ? next.onFill : DEFAULT_GROW_FILL.onFill,
      step: Number.isFinite(next.step) && next.step >= 0 ? next.step : DEFAULT_GROW_FILL.step,
      startPct: Number.isFinite(next.startPct) && next.startPct > 0 ? next.startPct : DEFAULT_GROW_FILL.startPct,
      holdSec: Number.isFinite(next.holdSec) && next.holdSec >= 0 ? next.holdSec : DEFAULT_GROW_FILL.holdSec,
      shrinkSec: Number.isFinite(next.shrinkSec) && next.shrinkSec >= 0 ? next.shrinkSec : DEFAULT_GROW_FILL.shrinkSec,
      pitch: typeof next.pitch === "boolean" ? next.pitch : DEFAULT_GROW_FILL.pitch,
    };
  }
  getFillSettings(): GrowFillSettings {
    return { ...this.fill };
  }
  /** True for the laws that start small in the centre and bounce in chords (everything but the classic "approach"). */
  private chordLaw(): boolean {
    return this.fill.law !== "approach";
  }
  /** The ring's radius (its live radius; 0 without one). */
  private ringRadius(ctx: ModeContext): number {
    const wall = ctx.getCircularWalls()[0];
    return wall ? wall.radius : 0;
  }
  /** The new laws' start radius: `startPct` % of the ring, at most the cap. */
  private chordStartRadius(ctx: ModeContext): number {
    const cap = this.maxBallRadius(ctx, 0);
    const r = (this.fill.startPct / 100) * this.ringRadius(ctx);
    return Math.max(0.5, Number.isFinite(cap) && r > cap ? cap : r);
  }
  private ensurePins(n: number) {
    if (this.pinX.length >= n) return;
    this.pinX = new Float64Array(n);
    this.pinY = new Float64Array(n);
  }
  /** Launches the balls from the centre at the start radius, the first at `theta`, the others spread (as the engine starts them). */
  private launch(ctx: ModeContext, theta: number) {
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const speed = ctx.config.ballSpeed || 400;
    const balls = ctx.getBalls();
    const n = balls.length;
    for (let i = 0; i < n; i++) {
      const ball = balls[i];
      const dir = startBallAngle(theta, i, n);
      ball.x = cx;
      ball.y = cy;
      ball.vx = Math.cos(dir) * speed;
      ball.vy = Math.sin(dir) * speed;
      ball.radius = this.startRadius;
      ball.radiusScale = this.startRadius / (ctx.config.ballRadius || 8);
      ball.trail = [];
      ball.trailIndex = 0;
    }
  }
  // --- end loop-foundation ---

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.bouncePoints = [];
    this.elapsedTime = 0;
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) this.centerDotRadius = Math.max(5, 0.02 * walls[0].radius);
    // --- loop-foundation --- a new run: growing, no fills, no seams, no markers; the new laws place their own balls
    this.phase = "grow";
    this.fillAtMs = this.holdEndMs = this.shrinkStartMs = this.shrinkEndMs = -1;
    this.fills = 0;
    this.firstFillMs = -1;
    this.seams = 0;
    this.lastSeamMs = 0;
    this.lastCycleMs = 0;
    this.bounces = 0;
    this.totalBounces = 0;
    this.markers.clear();
    this.chordAngle = 0;
    this.side = 1;
    this.startRadius = ctx.config.ballRadius || 8;
    if (!this.chordLaw() || walls.length === 0) return;
    // The engine would start the balls at the Ball Size: the new laws start them at their own size in the centre, drawing the
    // launch direction first (as the engine does), then the chord angle and the side.
    const theta = ctx.random() * Math.PI * 2;
    this.chordAngle = ((CHORD_ANGLE_MIN_DEG + ctx.random() * (CHORD_ANGLE_MAX_DEG - CHORD_ANGLE_MIN_DEG)) * Math.PI) / 180;
    this.side = ctx.random() < 0.5 ? 1 : -1;
    const count = startBallCount(ctx.config, "grow");
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const speed = ctx.config.ballSpeed || 400;
    this.startRadius = this.chordStartRadius(ctx);
    for (let slot = 0; slot < count; slot++) {
      const dir = startBallAngle(theta, slot, count);
      ctx.addBall({ x: cx, y: cy, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, radius: this.startRadius, color: startBallColor(slot, ctx.config), team: slot, radiusScale: this.startRadius / (ctx.config.ballRadius || 8) });
      ctx.getLastWallLayer().set(ctx.getNextId() - 1, -1);
    }
    // The cap depends on the ball count: with the balls in play, the start radius is held to it once more.
    const capped = this.chordStartRadius(ctx);
    if (capped < this.startRadius) {
      this.startRadius = capped;
      for (const ball of ctx.getBalls()) {
        ball.radius = capped;
        ball.radiusScale = capped / (ctx.config.ballRadius || 8);
      }
    }
    this.ensurePins(count);
  }
  /**
   * The largest radius a ball may have in ring `wallIndex`: the smallest radius the ring reaches, less 2 px. With
   * breathing walls the live radius pulses around its base by ±amplitude, so the cap is the trough of the pulse, not
   * the current (possibly peaking) size – otherwise the ring would shrink under a ball that outgrew it.
   * The balls in play share the ring: with n > 1 each may reach 1/n of it (less the ring's 3 px push margin and 1 px of
   * slack), so two balls side by side still fit inside – grown to the single-ball cap they would stick out half beyond
   * the sealed ring and, under strong gravity, shove each other through it. One ball keeps exactly the old cap.
   */
  private maxBallRadius(ctx: ModeContext, wallIndex: number): number {
    const wall = ctx.getCircularWalls()[wallIndex];
    if (!wall) return Infinity;
    const baseRadii = ctx.getWallBaseRadii();
    const base = wallIndex < baseRadii.length ? baseRadii[wallIndex] : wall.radius;
    const limit = Math.min(wall.radius, base * (1 - ctx.getPhysicsExtras().breathingAmplitude));
    const n = ctx.getBalls().length;
    return n > 1 ? (limit - 3) / n - 1 : limit - 2;
  }
  /**
   * A grown ball keeps its size relative to the Ball Size (`radiusScale`), so a Ball Size keyframe or slider scales it;
   * scaled up (or with a wider keyframed breathing that deepens the trough) it is held to the ring's cap here, before
   * the step moves it. In a run whose Ball Size and breathing stay put no ball is ever above the cap: nothing changes.
   * A ball grown by a size multiplier is left to the multipliers, which refit it (the ring bursts, the run ends).
   */
  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const balls = ctx.getBalls();
    if (balls.length === 0 || ctx.getCircularWalls().length === 0) return;
    const cap = this.maxBallRadius(ctx, 0);
    if (!(cap > 0)) return;
    for (const ball of balls) {
      if (!(ball.radius > cap) || (ball.mult && ball.mult.size !== 1)) continue;
      ball.radius = cap;
      ball.radiusScale = cap / (ctx.config.ballRadius || 8);
    }
    // --- loop-foundation --- the hold, the shrink and the relaunch, on the simulation clock (the step runs from now − dt)
    if (this.phase === "hold" || this.phase === "shrink") this.advancePhases(ctx, ctx.getElapsedMs() - dtMs, ctx.getElapsedMs(), cap);
  }
  // --- loop-foundation ---
  /** Moves the loop from the hold to the shrink and from the shrink to the relaunch when their times come (a step may cross both). */
  private advancePhases(ctx: ModeContext, tStart: number, tEnd: number, cap: number) {
    if (this.phase === "hold" && tStart >= this.holdEndMs - PHASE_EPS_MS) {
      this.phase = "shrink";
      this.shrinkStartMs = this.holdEndMs;
      this.shrinkEndMs = this.holdEndMs + 1000 * this.fill.shrinkSec;
      // the seam's sounds: every loop voice cut, a glide from the chord's root up to an octave under the next cycle's first note
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "cut", melody: false });
      if (this.fill.shrinkSec > 0) {
        const r0 = this.chordLaw() ? this.chordStartRadius(ctx) : this.startRadius;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "glide", frequency: GROW_CHORD_HZ, loopTo: growPitch(r0, r0, cap) / 2, loopSec: this.fill.shrinkSec, melody: false });
      }
    }
    if (this.phase !== "shrink") return;
    if (tStart >= this.shrinkEndMs - PHASE_EPS_MS) {
      this.relaunch(ctx);
      return;
    }
    // the shrink: the radius and the place eased from the full ball back to the start, ending exactly at the relaunch
    const p = this.fill.shrinkSec > 0 ? (tEnd - this.shrinkStartMs) / (1000 * this.fill.shrinkSec) : 1;
    const e = shrinkEase(p);
    const ring = this.ringRadius(ctx);
    const r0 = this.chordLaw() ? this.chordStartRadius(ctx) : this.startRadius;
    const balls = ctx.getBalls();
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      ball.radius = cap + (r0 - cap) * e;
      ball.radiusScale = ball.radius / (ctx.config.ballRadius || 8);
      const px = i < this.pinX.length ? this.pinX[i] : 0;
      const py = i < this.pinY.length ? this.pinY[i] : 0;
      ball.x = cx + px * ring * (1 - e);
      ball.y = cy + py * ring * (1 - e);
    }
  }
  /** The ball(s) full: snap to the cap (one ball in the centre), stop, and hold – or end the run ("finish"). */
  private beginFill(ctx: ModeContext) {
    const balls = ctx.getBalls();
    const cap = this.maxBallRadius(ctx, 0);
    const ring = this.ringRadius(ctx) || 1;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    this.ensurePins(balls.length);
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      ball.radius = cap;
      ball.radiusScale = cap / (ctx.config.ballRadius || 8);
      if (balls.length === 1) {
        ball.x = cx;
        ball.y = cy;
      }
      ball.vx = 0;
      ball.vy = 0;
      this.pinX[i] = (ball.x - cx) / ring;
      this.pinY[i] = (ball.y - cy) / ring;
    }
    this.fillAtMs = ctx.getElapsedMs();
    this.fills++;
    if (this.firstFillMs < 0) this.firstFillMs = this.fillAtMs;
    this.holdEndMs = this.fillAtMs + 1000 * this.fill.holdSec;
    this.phase = this.fill.onFill === "finish" ? "done" : "hold";
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: GROW_CHORD_HZ, level: 1, melody: false });
  }
  /** The end of the shrink: the balls back at the start size in the centre, relaunched in a seeded direction (draws: θ, side). */
  private relaunch(ctx: ModeContext) {
    const at = this.shrinkEndMs;
    this.lastCycleMs = at - this.lastSeamMs;
    this.lastSeamMs = at;
    this.seams++;
    this.bounces = 0;
    this.phase = "grow";
    this.holdEndMs = this.shrinkStartMs = this.shrinkEndMs = -1;
    const theta = ctx.random() * Math.PI * 2;
    this.side = ctx.random() < 0.5 ? 1 : -1;
    if (this.chordLaw()) this.startRadius = this.chordStartRadius(ctx);
    this.launch(ctx, theta);
  }
  /** True while every ball is within FILL_EPSILON_PX of its cap. */
  private allFull(ctx: ModeContext, wallIndex: number): boolean {
    const cap = this.maxBallRadius(ctx, wallIndex);
    for (const ball of ctx.getBalls()) if (ball.radius < cap - FILL_EPSILON_PX) return false;
    return true;
  }
  /** The bounce's pluck: the ball's size as it hit (`radius`, before this bounce's growth) → a pentatonic degree (bigger = lower), its 3f partial while it is small. */
  private pluck(radius: number, wallIndex: number, cap: number): SoundEvent {
    return { type: "hit", wallIndex, loop: "pluck", frequency: growPitch(radius, this.startRadius, cap), level: pluckVelocity(1), loopBright: radius < 0.25 * cap, melody: false };
  }
  // --- end loop-foundation ---
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    this.elapsedTime += dtSec;
    // --- loop-foundation --- held, shrinking or done: the ball stays where the loop puts it (the shrink moves it in onPreUpdate)
    if (this.phase !== "grow") {
      if (this.phase !== "shrink") {
        const i = ctx.getBalls().indexOf(ball);
        if (i >= 0 && i < this.pinX.length) {
          const ring = this.ringRadius(ctx) || 1;
          ball.x = ctx.config.width / 2 + this.pinX[i] * ring;
          ball.y = ctx.config.height / 2 + this.pinY[i] * ring;
        }
      }
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    // --- end loop-foundation ---
    if (!this.centerDotEnabled) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = ball.radius + this.centerDotRadius;
    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = cx + nx * (minDist + 1);
      ball.y = cy + ny * (minDist + 1);
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
      }
      if (this.linesEnabled) this.pushBouncePoint(cx, cy);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0 });
    }
  }
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number): WallHitResult | void {
    if (this.chordLaw()) return this.chordWallHit(ctx, ball, wallIndex); // --- loop-foundation --- (the new laws)
    const wall = ctx.getCircularWalls()[wallIndex];
    let outward = false; // --- loop-foundation --- (a real bounce: the ball was moving out)
    const hitRadius = ball.radius; // --- loop-foundation --- (the size it hit with: the pluck's pitch)
    if (wall) {
      // The ball may only ever grow up to the smallest radius the ring reaches (the trough of a breathing pulse).
      const maxRadius = this.maxBallRadius(ctx, wallIndex);
      if (ball.radius < maxRadius) {
        const rate = this.growRate / 100;
        ball.radius = Math.min(maxRadius, ball.radius + (maxRadius - ball.radius) * (rate * rate * 2.1));
        // The grown size relative to the Ball Size: a keyframed (or dragged) Ball Size then scales the ball instead of
        // resetting it to the plain size (setConfig() sets every ball to ballRadius × radiusScale).
        ball.radiusScale = ball.radius / (ctx.config.ballRadius || 8);
      }
      const cx = ctx.config.width / 2;
      const cy = ctx.config.height / 2;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.hypot(dx, dy);
      if (this.linesEnabled && dist > 0) {
        this.pushBouncePoint(cx + (dx / dist) * wall.radius, cy + (dy / dist) * wall.radius);
      }
      if (dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const dot = ball.vx * nx + ball.vy * ny;
        if (dot > 0) {
          outward = true; // --- loop-foundation ---
          ball.vx -= 1.95 * dot * nx;
          ball.vy -= 1.95 * dot * ny;
          // After a delay, add a slight orbital push so the ball circles the arena.
          const orbit = Math.min(1, (this.elapsedTime - this.ORBIT_DELAY) / 5);
          if (orbit > 0) {
            const tx = -ny;
            const sign = ball.vx * tx + ball.vy * nx >= 0 ? 1 : -1;
            ball.vx += 4 * tx * sign * orbit;
            ball.vy += 4 * nx * sign * orbit;
          }
          const speed = cruiseSpeed(ball, ctx.config.ballSpeed || 400); // --- gerald-multipliers --- the speed multiplier
          const current = Math.hypot(ball.vx, ball.vy);
          if (current > 0) {
            ball.vx = (ball.vx / current) * speed;
            ball.vy = (ball.vy / current) * speed;
          }
          // --- loop-foundation --- a contact marker where it hit (render-only)
          this.markers.add(cx + nx * wall.radius, cy + ny * wall.radius, ctx.getElapsedMs());
          this.bounces++;
          this.totalBounces++;
        }
      }
    }
    // Only every ~10th bounce makes a sound so a large, fast ball doesn't buzz.
    const playSound = ctx.random() < 0.1;
    // --- loop-foundation --- pitch by size: a real bounce plays its pluck instead (the draw above stays: the run is the same)
    if (this.fill.pitch) {
      const cap = this.maxBallRadius(ctx, wallIndex);
      if (outward) ctx.addPendingSoundEvent(this.pluck(hitRadius, wallIndex, cap));
      if (this.fill.onFill !== "stay" && this.allFull(ctx, wallIndex)) this.beginFill(ctx);
      return { suppressBounce: true, suppressGlow: !outward, suppressSound: true };
    }
    if (this.fill.onFill !== "stay" && this.allFull(ctx, wallIndex)) {
      if (playSound) ctx.addPendingSoundEvent({ type: "hit", wallIndex });
      this.beginFill(ctx);
      return { suppressBounce: true, suppressGlow: !playSound };
    }
    // --- end loop-foundation ---
    if (playSound) ctx.addPendingSoundEvent({ type: "hit", wallIndex });
    return { suppressBounce: true, suppressGlow: !playSound };
  }
  // --- loop-foundation ---
  /**
   * A wall contact under the new laws: a real bounce (the ball moving out) grows the ball by the law, rebounds it in a clean
   * chord at the Ball Speed, leaves a marker and plays its pluck (pitch by size) or the plain bounce; an overlap the growth
   * left (the ball already moving in) is only pushed out. The ball(s) full → the fill.
   */
  private chordWallHit(ctx: ModeContext, ball: Ball, wallIndex: number): WallHitResult {
    const wall = ctx.getCircularWalls()[wallIndex];
    if (!wall || this.phase !== "grow") return { suppressBounce: true, suppressGlow: true, suppressSound: true };
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 0)) return { suppressBounce: true, suppressGlow: true, suppressSound: true };
    const nx = dx / dist;
    const ny = dy / dist;
    if (ball.vx * nx + ball.vy * ny <= 0) return { suppressBounce: true, suppressGlow: true, suppressSound: true };
    const cap = this.maxBallRadius(ctx, wallIndex);
    const hitRadius = ball.radius; // (the size it hit with: the pluck's pitch)
    if (!(ball.mult && ball.mult.size !== 1)) {
      ball.radius = growStepRadius(this.fill.law, ball.radius, this.fill.step, cap);
      ball.radiusScale = ball.radius / (ctx.config.ballRadius || 8);
    }
    const speed = cruiseSpeed(ball, ctx.config.ballSpeed || 400);
    chordRebound(ball.vx, ball.vy, nx, ny, this.chordAngle, this.side, speed, this.rebound);
    ball.vx = this.rebound.vx;
    ball.vy = this.rebound.vy;
    if (this.linesEnabled) this.pushBouncePoint(cx + nx * wall.radius, cy + ny * wall.radius);
    this.markers.add(cx + nx * wall.radius, cy + ny * wall.radius, ctx.getElapsedMs());
    this.bounces++;
    this.totalBounces++;
    if (this.fill.pitch) ctx.addPendingSoundEvent(this.pluck(hitRadius, wallIndex, cap));
    if (this.fill.onFill !== "stay" && this.allFull(ctx, wallIndex)) this.beginFill(ctx);
    return { suppressBounce: true, suppressSound: this.fill.pitch };
  }
  // --- end loop-foundation ---
  onGapPass() {
    return true;
  }
  onPostUpdate() {}
  /**
   * A new canvas size resizes the sealed ring to the radius a fresh start gives it (`arenaRadius()`, as the engine's "solid"
   * layout builds it – the engine has put a breathing ring back at its base radius first). The gap size and the wall count
   * do not apply to Grow's gapless ring: nothing changes.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const r = arenaRadius(ctx.config);
    const walls = ctx.getCircularWalls();
    if (walls.length > 0) walls[0].radius = r;
    else {
      ctx.setCircularWalls([{ radius: r, gaps: [] }]);
      ctx.setWallRotations([0]);
    }
    this.centerDotRadius = Math.max(5, 0.02 * r);
    return true;
  }
  shouldSkipWallCollision() {
    return this.phase !== "grow"; // --- loop-foundation --- (held, shrinking or done: the loop places the ball)
  }
  // --- loop-foundation --- held, shrinking or done: no ball pairs and no slow-ball boost (the loop places the balls)
  get ballsPassThrough(): boolean {
    return this.phase !== "grow";
  }
  get ballsMayRest(): boolean {
    return this.phase !== "grow";
  }
  // --- end loop-foundation ---
  isFinished() {
    return this.phase === "done"; // --- loop-foundation --- ("finish": the run ends at the fill)
  }
  // --- loop-foundation --- the loop contract (lib/loop/loopContract.ts)
  cycleSeconds(): number | null {
    return this.fill.onFill === "loop" && this.lastCycleMs > 0 ? this.lastCycleMs / 1000 : null;
  }
  loopSeams(): LoopSeams | null {
    if (this.fill.onFill !== "loop") return null;
    const next = this.phase === "hold" ? this.holdEndMs + 1000 * this.fill.shrinkSec : this.phase === "shrink" ? this.shrinkEndMs : -1;
    return { count: this.seams, lastMs: this.seams > 0 ? this.lastSeamMs : -1, nextMs: next };
  }
  /** The run as the canvas, the finder and the smoke test read it (the same object every call). */
  getView(ctx: ModeContext): GrowView {
    const v = (this.view ??= { law: "approach", onFill: "stay", phase: "grow", phaseProgress: 0, cap: 0, startRadius: 0, ring: 0, fills: 0, firstFillMs: -1, lastFillMs: -1, seams: 0, lastSeamMs: 0, cycleSec: 0, bounces: 0, totalBounces: 0, chordAngle: 0, markers: this.markers });
    const t = ctx.getElapsedMs();
    v.law = this.fill.law;
    v.onFill = this.fill.onFill;
    v.phase = this.phase;
    v.phaseProgress =
      this.phase === "hold"
        ? Math.min(1, Math.max(0, (t - this.fillAtMs) / Math.max(1e-6, this.holdEndMs - this.fillAtMs)))
        : this.phase === "shrink"
          ? Math.min(1, Math.max(0, (t - this.shrinkStartMs) / Math.max(1e-6, this.shrinkEndMs - this.shrinkStartMs)))
          : 0;
    const walls = ctx.getCircularWalls().length > 0;
    v.cap = walls ? Math.max(0, this.maxBallRadius(ctx, 0)) : 0;
    v.startRadius = this.chordLaw() && walls ? this.chordStartRadius(ctx) : this.startRadius;
    v.ring = this.ringRadius(ctx);
    v.fills = this.fills;
    v.firstFillMs = this.firstFillMs;
    v.lastFillMs = this.fills > 0 ? this.fillAtMs : -1;
    v.seams = this.seams;
    v.lastSeamMs = this.lastSeamMs;
    v.cycleSec = this.lastCycleMs / 1000;
    v.bounces = this.bounces;
    v.totalBounces = this.totalBounces;
    v.chordAngle = this.chordAngle;
    return v;
  }
  // --- end loop-foundation ---
  getState() {
    return { centerDotEnabled: this.centerDotEnabled, centerDotRadius: this.centerDotRadius, linesEnabled: this.linesEnabled };
  }
}
