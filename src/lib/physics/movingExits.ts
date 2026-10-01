import type { Ball, CircularWall, Gap, ModeContext, ModeId, PhysicsConfig } from "./types";
import { TWO_PI } from "./types";
import { resolveExitSplatConfig, supportsMovingExits, type ExitBehavior, type ResolvedExitSplat } from "./exitSplat";

/**
 * --- gerald-exit-splat --- Moving exits for the ring modes (the character-ball account's "solving the case of the moving
 * exit"): instead of turning with its ring, every ring's exit
 *
 * - **jumps** – teleports to a new seeded angle every `exitJumpSeconds`, or `EXIT_REACTION_SEC` after a ball comes within
 *   `exitSense` of its edge (then not again for `JUMP_COOLDOWN_SEC`; a ball that reaches the doorway first gets out), always
 *   at least `MIN_JUMP_RAD` away and clear of the balls it dodged when it can be (`pickExitSpot()`), with a flash at the
 *   old and the new spot;
 * - **flees** – runs away from the nearest ball along its ring at up to `exitFleeSpeed` while that ball is within
 *   `exitSense` (`fleeVelocity()`, easing to a stop on the far side), so the ball has to out-run it;
 * - **shrinks** – narrows over `exitJumpSeconds` until it is shut (slowly at first, faster at the end: `shrinkWidth()`),
 *   then opens again (over `REOPEN_SEC`) somewhere else.
 *
 * The rings hold still meanwhile (the engine's ring rotation is 0: the exit moves by itself). The engine owns one
 * `ExitController`: `beginStep()` at every fixed step tells it whether the exits move (a ring mode with exits and a
 * behaviour other than "rotate"), and `advance()` moves them at the start of every sub-step, before the balls move and the
 * rings resolve them, so a gap pass is judged exactly where the exit is at that moment. Only the balls the rings resolve
 * count (not Multiply's escaped ones), each for the innermost intact ring around it; a ball near the centre says little
 * about where it is heading (`SENSE_MIN_DIST`), and a ball in an exit's doorway makes the exit wait for it.
 *
 * Every random draw goes through the engine's seeded RNG (`ctx.random()`) and the clocks are the simulation's, so a run
 * replays exactly – Find Simulation, recordings and the fast export included. With "rotate" nothing here runs.
 */

/** Seconds after a jump before a ball's approach can make the exit jump again. */
export const JUMP_COOLDOWN_SEC = 1;
/**
 * Seconds a jumping exit takes to react once a ball comes within its sense: it flickers, then jumps – a ball that reaches
 * the doorway in that time gets out (the exit is out-run).
 */
export const EXIT_REACTION_SEC = 0.2;
/** Seconds before a timed jump the exit starts to flicker. */
export const JUMP_WARN_SEC = 0.35;
/** A jump lands at least this far (radians) from where the exit was. */
export const MIN_JUMP_RAD = Math.PI / 3;
/** The least room (radians) a jump leaves between its new exit's edge and the balls it dodged (or the sense, when wider). */
export const MIN_CLEARANCE_RAD = 0.3;
/** Spots a jump or a re-opening draws (seeded) before it settles for the best of them. */
export const JUMP_CANDIDATES = 12;
/** Balls nearer the centre than this fraction of their ring's radius do not alarm an exit (their angle says little). */
export const SENSE_MIN_DIST = 0.35;
/** Seconds a shut exit takes to open again elsewhere. */
export const REOPEN_SEC = 0.3;
/** A re-opened exit lands at least this far (radians) from where it shut. */
export const MIN_REOPEN_RAD = Math.PI / 2;
/** A fleeing exit eases to a stop over this stretch (radians) before the far side of the ring from the ball. */
export const FLEE_EASE_RAD = 0.5;
/** Seconds a fleeing exit's speed takes to follow a new target (a first-order lag: no jerk when the nearest ball changes). */
export const FLEE_RESPONSE_SEC = 0.08;
/** Flashes kept for the canvas (two per move: the old spot and the new one). */
export const EXIT_FLASHES = 16;
/** How long the canvas shows a move's flashes, in simulation ms. */
export const EXIT_FLASH_MS = 450;

/* ------------------------------------------------------------------ pure maths */

/** `a` wrapped into (−π, π]. */
export function wrapPi(a: number): number {
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r <= -Math.PI) r += TWO_PI;
  return r;
}

/** `a` wrapped into [0, 2π). */
export function wrapTwoPi(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r === 0 ? 0 : r;
}

/** The centre of a gap (radians, relative to its ring – add the ring's rotation for the world angle). */
export function gapCentre(gap: Gap): number {
  return (gap.startAngle + gap.endAngle) / 2;
}

/** Half the width of a gap (radians). */
export function gapHalfWidth(gap: Gap): number {
  return (gap.endAngle - gap.startAngle) / 2;
}

/** Writes `gap` as `width` radians centred on `centre`: the start in [0, 2π), the end past it (above 2π for a gap across 0). */
export function placeGap(gap: Gap, centre: number, width: number): void {
  const w = width > 0 ? width : 0;
  const start = wrapTwoPi(centre - w / 2);
  gap.startAngle = start;
  gap.endAngle = start + w;
}

/** True when the ring-relative angle `angle` lies inside one of `gaps` (each starting in [0, 2π), maybe ending past 2π). */
export function inAnyGap(angle: number, gaps: readonly Gap[]): boolean {
  for (const gap of gaps) {
    const rel = wrapTwoPi(angle - gap.startAngle);
    if (rel <= gap.endAngle - gap.startAngle) return true;
  }
  return false;
}

/** How far (radians, ≥ 0) the angle `a` lies outside the exit centred on `centre` with half width `half` (0 inside it). */
export function edgeDistance(a: number, centre: number, half: number): number {
  const d = Math.abs(wrapPi(a - centre)) - half;
  return d > 0 ? d : 0;
}

/**
 * The fleeing exit's angular velocity (rad/s, signed) for a ball at `offset` = wrapPi(exit centre − ball angle): away from
 * the ball at `maxSpeed`, easing to a stop over the last `FLEE_EASE_RAD` before the far side of the ring (where it is as
 * far from the ball as it gets). A ball right at the centre of the exit sends it the positive way.
 */
export function fleeVelocity(offset: number, maxSpeed: number): number {
  const away = offset >= 0 ? 1 : -1;
  const room = Math.PI - Math.abs(offset);
  const ease = room >= FLEE_EASE_RAD ? 1 : room > 0 ? room / FLEE_EASE_RAD : 0;
  return away * maxSpeed * ease;
}

/** The width of a shrinking exit of full width `full` a fraction `phase` (0 … 1) of the way to shut: full × (1 − phase³), a door that closes ever faster. */
export function shrinkWidth(full: number, phase: number): number {
  const p = phase > 0 ? (phase < 1 ? phase : 1) : 0;
  return full * (1 - p * p * p);
}

/**
 * A new spot (world radians) for an exit of half width `half` that was at `from`: up to `candidates` spots drawn from
 * `random`, the first at least `minMove` away from where it was whose edge keeps `clearance` from every angle in `avoid`
 * (its first `avoidCount` entries: the balls it dodges) – else the drawn spot that came closest to that. Deterministic for a
 * seeded `random`.
 */
export function pickExitSpot(random: () => number, from: number, half: number, avoid: ArrayLike<number>, avoidCount: number, clearance: number, minMove: number, candidates = JUMP_CANDIDATES): number {
  let best = from + Math.PI;
  let bestScore = -Infinity;
  for (let k = 0; k < candidates; k++) {
    const spot = random() * TWO_PI;
    const move = Math.abs(wrapPi(spot - from));
    let room = Infinity;
    for (let i = 0; i < avoidCount; i++) {
      const e = Math.abs(wrapPi(spot - avoid[i])) - half;
      if (e < room) room = e;
    }
    if (move >= minMove && room >= clearance) return spot;
    const score = Math.min(room - clearance, move - minMove);
    if (score > bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

/** The innermost intact ring around a point `dist` from the centre (the one a ball there meets first), or −1. */
export function enclosingRing(walls: readonly CircularWall[], broken: ReadonlySet<number>, dist: number): number {
  let ring = -1;
  let radius = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const r = walls[i].radius;
    if (r > dist && r < radius && !broken.has(i)) {
      radius = r;
      ring = i;
    }
  }
  return ring;
}

/** The fractional part of `w × φ⁻¹` (a well-spread, seed-free phase per ring index). */
function spread(w: number, step: number): number {
  const x = w * step;
  return x - Math.floor(x);
}

/* ------------------------------------------------------------------ the engine's controller */

/** One flash of the canvas: an exit vanished from (`appear` false) or appeared at (`appear` true) a spot of its ring. */
export interface ExitFlash {
  wall: number;
  /** World angle (radians) of the spot. */
  angle: number;
  /** Simulation time (ms) of the move; −Infinity marks an unused slot. */
  timeMs: number;
  appear: boolean;
}

/** What the canvas draws of the moving exits (the same object every call). */
export interface ExitView {
  /** The behaviour set (whether or not this mode moves its exits). */
  behavior: ExitBehavior;
  /** The exits move this run: a ring mode with exits and a behaviour other than "rotate". */
  live: boolean;
  /** Jumps (jump) or re-openings (shrink) so far this run. */
  moves: number;
  /** A ring buffer of the latest moves' flashes (`EXIT_FLASHES` slots). */
  flashes: ExitFlash[];
  /** Shrink: how far each ring's exit has closed, 0 (open) … 1 (shut). */
  closing: number[];
  /** Jump: each ring's exit is about to jump, 0 … 1 (it flickers: a ball came near, or its timer runs out). */
  alert: number[];
  /** Flee: each ring's exit's speed as a fraction of the top speed (signed). */
  fleeing: number[];
}

const NO_ANGLES = new Float64Array(0);

/**
 * The moving exits of a run (see the module comment). `configure()` takes the settings from the physics config,
 * `reset()` starts a new run, `beginStep()` / `advance()` drive it from the engine's step.
 */
export class ExitController {
  private cfg: ResolvedExitSplat = resolveExitSplatConfig(null);
  /** The rings the state below belongs to (a new array – a rebuild – starts it over). */
  private walls: CircularWall[] | null = null;
  /** Jump: seconds to the next timed jump; shrink: how far the exit has closed (0 … 1). */
  private timers: number[] = [];
  private cooldowns: number[] = [];
  /** Jump: a ball alarmed the exit (it jumps when `pending` runs out). */
  private armed: boolean[] = [];
  private pending: number[] = [];
  /** Shrink: each exit's full width, and the width last written (a different one means the engine resized it). */
  private fullWidth: number[] = [];
  private written: number[] = [];
  /** Shrink: seconds left of a re-opening. */
  private reopening: number[] = [];
  /** Flee: each exit's angular velocity (rad/s). */
  private omega: number[] = [];
  /** Per sub-step: the nearest alarming ball's |offset| and signed offset from each exit's centre, and a ball in its doorway. */
  private nearAbs: number[] = [];
  private nearSigned: number[] = [];
  private passing: boolean[] = [];
  private avoid = new Float64Array(8);
  private flashHead = 0;
  readonly view: ExitView = { behavior: "rotate", live: false, moves: 0, flashes: [], closing: [], alert: [], fleeing: [] };

  constructor() {
    for (let i = 0; i < EXIT_FLASHES; i++) this.view.flashes.push({ wall: 0, angle: 0, timeMs: -Infinity, appear: false });
  }

  /** The behaviour in effect. */
  get behavior(): ExitBehavior {
    return this.cfg.behavior;
  }

  /**
   * Takes the settings from the config. Leaving "shrink" opens the exits it narrowed back to their full width; a new
   * behaviour starts its timers over.
   */
  configure(config: Partial<PhysicsConfig> | null | undefined) {
    const next = resolveExitSplatConfig(config);
    if (next.behavior !== this.cfg.behavior) {
      if (this.cfg.behavior === "shrink" && this.walls) this.restoreWidths(this.walls);
      this.walls = null;
    }
    this.cfg = next;
    this.view.behavior = next.behavior;
  }

  /** A new run: no moves, no flashes; the state follows the run's rings from its first step. */
  reset() {
    this.walls = null;
    this.view.moves = 0;
    this.view.live = false;
    for (const f of this.view.flashes) f.timeMs = -Infinity;
    this.flashHead = 0;
  }

  /** Whether the exits move this step (then the rings hold still); syncs with the run's rings. */
  beginStep(ctx: ModeContext, mode: ModeId | undefined): boolean {
    const walls = ctx.getCircularWalls();
    const live = this.cfg.behavior !== "rotate" && supportsMovingExits(mode) && walls.length > 0;
    this.view.live = live;
    if (!live) return false;
    if (walls !== this.walls || walls.length !== this.timers.length) this.sync(walls);
    return true;
  }

  /** Moves every intact ring's exit by one sub-step of `dt` seconds; `skip` names the balls the rings do not resolve. */
  advance(ctx: ModeContext, dt: number, skip: (ball: Ball) => boolean) {
    const walls = this.walls;
    if (!walls || !(dt > 0)) return;
    const rot = ctx.getWallRotations();
    const broken = ctx.getBrokenWalls();
    const behavior = this.cfg.behavior;
    if (behavior !== "shrink") this.scanBalls(ctx, walls, rot, broken, skip);
    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w];
      if (wall.gaps.length !== 1 || broken.has(w)) {
        this.view.closing[w] = 0;
        this.view.alert[w] = 0;
        this.view.fleeing[w] = 0;
        continue;
      }
      if (behavior === "jump") this.stepJump(ctx, w, wall, rot[w] ?? 0, broken, skip, dt);
      else if (behavior === "flee") this.stepFlee(w, wall, dt);
      else this.stepShrink(ctx, w, wall, rot[w] ?? 0, dt);
    }
  }

  /** The canvas' view (the same object every call). */
  getView(): ExitView {
    return this.view;
  }

  /** Sizes the per-ring state for `walls` and starts it over: the timers spread over the rings, every exit at its width. */
  private sync(walls: CircularWall[]) {
    const n = walls.length;
    this.walls = walls;
    const resize = <T>(list: T[], value: T) => {
      list.length = n;
      list.fill(value);
    };
    resize(this.timers, 0);
    resize(this.cooldowns, 0);
    resize(this.armed, false);
    resize(this.pending, 0);
    resize(this.fullWidth, 0);
    resize(this.written, NaN);
    resize(this.reopening, 0);
    resize(this.omega, 0);
    resize(this.nearAbs, Infinity);
    resize(this.nearSigned, 0);
    resize(this.passing, false);
    resize(this.view.closing, 0);
    resize(this.view.alert, 0);
    resize(this.view.fleeing, 0);
    for (let w = 0; w < n; w++) {
      const gap = walls[w].gaps.length === 1 ? walls[w].gaps[0] : null;
      this.fullWidth[w] = gap ? gap.endAngle - gap.startAngle : 0;
      // The first jump comes after a full interval (the innermost ring's exactly), the shrinking exits start part-way
      // shut – spread over the rings so they never all move at once.
      this.timers[w] = this.cfg.behavior === "jump" ? this.cfg.jumpSec * (1 + 0.5 * spread(w, 0.6180339887498949)) : 0.5 * spread(w, 0.3819660112501051);
    }
  }

  /** Opens every exit "shrink" narrowed back to its full width (leaving the behaviour). */
  private restoreWidths(walls: CircularWall[]) {
    for (let w = 0; w < walls.length && w < this.fullWidth.length; w++) {
      const gap = walls[w].gaps.length === 1 ? walls[w].gaps[0] : null;
      if (gap && this.fullWidth[w] > 0) placeGap(gap, gapCentre(gap), this.fullWidth[w]);
    }
  }

  /** The nearest alarming ball of every exit (its offset from the exit's centre) and whether a ball stands in a doorway. */
  private scanBalls(ctx: ModeContext, walls: CircularWall[], rot: readonly number[], broken: ReadonlySet<number>, skip: (ball: Ball) => boolean) {
    for (let w = 0; w < walls.length; w++) {
      this.nearAbs[w] = Infinity;
      this.nearSigned[w] = 0;
      this.passing[w] = false;
    }
    const balls = ctx.getBalls();
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (skip(ball)) continue;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const w = enclosingRing(walls, broken, dist);
      if (w < 0) continue;
      const wall = walls[w];
      if (wall.gaps.length !== 1) continue;
      const gap = wall.gaps[0];
      const R = wall.radius;
      const half = gapHalfWidth(gap);
      const offset = wrapPi(gapCentre(gap) + (rot[w] ?? 0) - Math.atan2(dy, dx));
      const abs = Math.abs(offset);
      if (R - dist < ball.radius + 2 && abs <= half + Math.atan2(ball.radius, R)) this.passing[w] = true;
      if (dist < SENSE_MIN_DIST * R) continue;
      if (abs < this.nearAbs[w]) {
        this.nearAbs[w] = abs;
        this.nearSigned[w] = offset;
      }
    }
  }

  /** The world angles of the balls that alarm ring `w`'s exit, into `this.avoid`; returns how many. */
  private collectAvoid(ctx: ModeContext, w: number, broken: ReadonlySet<number>, skip: (ball: Ball) => boolean): number {
    const walls = this.walls!;
    const balls = ctx.getBalls();
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    const R = walls[w].radius;
    let count = 0;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (skip(ball)) continue;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SENSE_MIN_DIST * R || enclosingRing(walls, broken, dist) !== w) continue;
      if (count >= this.avoid.length) {
        const grown = new Float64Array(2 * this.avoid.length);
        grown.set(this.avoid);
        this.avoid = grown;
      }
      this.avoid[count++] = Math.atan2(dy, dx);
    }
    return count;
  }

  private stepJump(ctx: ModeContext, w: number, wall: CircularWall, rotation: number, broken: ReadonlySet<number>, skip: (ball: Ball) => boolean, dt: number) {
    this.timers[w] -= dt;
    this.cooldowns[w] -= dt;
    const gap = wall.gaps[0];
    const half = gapHalfWidth(gap);
    const sense = this.cfg.senseRad;
    // A ball came within the sense: the exit reacts (it flickers, then jumps).
    if (!this.armed[w] && sense > 0 && this.cooldowns[w] <= 0 && this.nearAbs[w] - half < sense) {
      this.armed[w] = true;
      this.pending[w] = EXIT_REACTION_SEC;
    }
    if (this.armed[w]) this.pending[w] -= dt;
    const reacted = this.armed[w] && this.pending[w] <= 0;
    this.view.alert[w] = this.armed[w] ? 1 - Math.max(0, this.pending[w]) / EXIT_REACTION_SEC : this.timers[w] < JUMP_WARN_SEC ? 1 - Math.max(0, this.timers[w]) / JUMP_WARN_SEC : 0;
    if (this.timers[w] > 0 && !reacted) return;
    if (this.passing[w]) {
      // A ball in the doorway: it out-ran the exit's reaction – the exit lets it through (a timed jump waits for it).
      if (reacted) this.armed[w] = false;
      return;
    }
    const from = gapCentre(gap) + rotation;
    const count = this.collectAvoid(ctx, w, broken, skip);
    const clearance = Math.min(Math.max(sense, MIN_CLEARANCE_RAD), Math.PI - half - 0.05);
    const to = pickExitSpot(() => ctx.random(), from, half, this.avoid, count, clearance, MIN_JUMP_RAD);
    placeGap(gap, to - rotation, 2 * half);
    this.moved(w, from, to, ctx.getElapsedMs());
    this.timers[w] = this.cfg.jumpSec;
    this.cooldowns[w] = JUMP_COOLDOWN_SEC;
    this.armed[w] = false;
    this.view.alert[w] = 0;
  }

  private stepFlee(w: number, wall: CircularWall, dt: number) {
    const gap = wall.gaps[0];
    const half = gapHalfWidth(gap);
    const top = this.cfg.fleeRadPerSec;
    const sense = this.cfg.senseRad;
    // A ball in the doorway: the exit stops and lets it through (it was caught).
    let target = 0;
    if (!this.passing[w] && sense > 0 && this.nearAbs[w] - half < sense) target = fleeVelocity(this.nearSigned[w], top);
    let omega = this.passing[w] ? 0 : this.omega[w] + (target - this.omega[w]) * (dt >= FLEE_RESPONSE_SEC ? 1 : dt / FLEE_RESPONSE_SEC);
    if (Math.abs(omega) < 1e-9) omega = 0;
    this.omega[w] = omega;
    this.view.fleeing[w] = top > 0 && Number.isFinite(omega / top) ? omega / top : 0;
    if (omega !== 0 && Number.isFinite(omega)) placeGap(gap, gapCentre(gap) + omega * dt, 2 * half);
  }

  private stepShrink(ctx: ModeContext, w: number, wall: CircularWall, rotation: number, dt: number) {
    const gap = wall.gaps[0];
    const width = gap.endAngle - gap.startAngle;
    // The engine (re)sized this exit since it was last written – a new gap size, a bigger ball: that is its full width now.
    if (!(Math.abs(width - this.written[w]) <= 1e-9)) this.fullWidth[w] = width;
    const full = this.fullWidth[w];
    const centre = gapCentre(gap);
    let next: number;
    if (this.reopening[w] > 0) {
      this.reopening[w] -= dt;
      const left = this.reopening[w] > 0 ? this.reopening[w] : 0;
      next = full * (1 - left / REOPEN_SEC);
      this.view.closing[w] = left / REOPEN_SEC;
    } else {
      this.timers[w] += dt / this.cfg.jumpSec;
      if (this.timers[w] >= 1) {
        // Shut: it opens again somewhere else.
        const from = centre + rotation;
        const to = pickExitSpot(() => ctx.random(), from, 0, NO_ANGLES, 0, 0, MIN_REOPEN_RAD);
        this.moved(w, from, to, ctx.getElapsedMs());
        this.timers[w] = 0;
        this.reopening[w] = REOPEN_SEC;
        placeGap(gap, to - rotation, 0);
        this.written[w] = gap.endAngle - gap.startAngle;
        this.view.closing[w] = 1;
        return;
      }
      next = shrinkWidth(full, this.timers[w]);
      this.view.closing[w] = 1 - next / (full > 0 ? full : 1);
    }
    placeGap(gap, centre, next);
    this.written[w] = gap.endAngle - gap.startAngle;
  }

  /** Counts a move and flashes its two spots. */
  private moved(wall: number, from: number, to: number, timeMs: number) {
    this.view.moves++;
    this.flash(wall, from, false, timeMs);
    this.flash(wall, to, true, timeMs);
  }

  private flash(wall: number, angle: number, appear: boolean, timeMs: number) {
    const f = this.view.flashes[this.flashHead];
    f.wall = wall;
    f.angle = wrapTwoPi(angle);
    f.appear = appear;
    f.timeMs = timeMs;
    this.flashHead = (this.flashHead + 1) % this.view.flashes.length;
  }
}
