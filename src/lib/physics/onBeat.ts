import type { BeatClockConfig } from "@/lib/simulation/beatClock";
import { clockHasTempo, gridErrorSec, nearestBeatIndex, nextGridPointSec } from "@/lib/simulation/beatSource";
import { beatTimeSec } from "@/lib/simulation/beatSchedule";
import type { Ball, CircularWall, ModeId } from "./types";

/**
 * --- video-beats --- "On beat": the ring modes land their wall hits on the beat grid (the beat source's grid – a video's
 * beats, hand-placed markers, the song's detected beats or the BPM; lib/simulation/beatSource.ts).
 *
 * How: after every rebound (and every gap pass) the controller predicts when the ball will next touch a wall – it replays
 * the engine's own sub-step integration for that ball (gravity with its direction, wind, air drag, the cruise-speed
 * boost) against the intact rings, treating them as solid – and picks the grid point to land on: a whole beat when one is
 * reachable, else the beat lock's subdivision (eighths at "1/8", sixteenths at "1/16"). It then *retimes the flight*: the
 * velocity is scaled by c and the ball's gravity by c², which keeps the path and changes only how fast the ball travels
 * it, by at most the On beat range (×1.5 … ÷1.5 at 0.5). A few iterations of the prediction make the scale exact, and
 * the flight is re-checked every few steps (every step near the target), so ball collisions, the rig's guidance or a
 * breathing wall only cause a small correction. No position is ever changed (no teleporting), no random numbers are
 * drawn, and a rebound resets the ball to its natural speed – so a run is still fully determined by the seed, the
 * settings and the grid, and the finder, the fast export and the page replay it identically (the finder searches with
 * On beat on). Only the timing of the flights changes; the rigged hard constraints (never escape, forced winner) act on
 * the retimed flights exactly as on any other.
 *
 * Contacts are stamped with the simulation time of the 60 Hz step they happen in (that is when their sound plays), and the
 * target is the middle of the step, so a planned hit lands within half a step (8 ms) of its grid point. A flight that no
 * grid point can be reached for within the range (a quick hop between two close rings) flies free, untouched.
 * `getStats()` reports how the hits land (the canvas mirrors it onto data-onbeat-*).
 */

/** The escape-family ring modes On beat applies to (the engine's own wall rebounds). */
export const ON_BEAT_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow"];
/** At most this many balls are timed (the rest of a crowded Multiply run flies free). */
export const ON_BEAT_MAX_BALLS = 8;
/** A hit this close (s) to its grid point counts as on the beat. */
export const ON_BEAT_TOLERANCE_SEC = 0.03;
/** Longest flight (s) that is predicted; a ball that will not touch a wall sooner is left alone. */
export const ON_BEAT_HORIZON_SEC = 3;
/** Steps between two checks of a flight far from its target. */
const CORRECT_EVERY_STEPS = 4;
/** Within this (s) of the target the flight is checked every step. */
const CLOSE_SEC = 0.25;
/** Two contacts of a ball this close (s) are one (a gap pass is seen in several sub-steps). */
const CONTACT_DEBOUNCE_SEC = 0.05;
/** Rolling window of the error statistics. */
const STATS_WINDOW = 16;

export interface OnBeatConfig {
  enabled: boolean;
  /** The grid to land on (beatSource.beatClockConfigOf()); null = none, On beat does nothing. */
  clock: BeatClockConfig | null;
  /** 0.1–0.8: the flight may run up to (1 + range)× faster or slower than it would. */
  range: number;
  /** 1 = beats only, 2 = eighths allowed, 4 = sixteenths allowed (the beat lock's grid). */
  subdivisions: number;
}

export const DEFAULT_ON_BEAT: OnBeatConfig = { enabled: false, clock: null, range: 0.5, subdivisions: 2 };

/** What the engine hands the controller after every 60 Hz step (one object, refreshed in place). */
export interface OnBeatWorld {
  mode: ModeId | undefined;
  /** Simulation time at the end of the step (s). */
  timeSec: number;
  stepSec: number;
  subSteps: number;
  cx: number;
  cy: number;
  walls: readonly CircularWall[];
  broken: ReadonlySet<number>;
  /** Gravity (px/s²) on a ball with gravityScale 1, and its direction. */
  gravity: number;
  gDirX: number;
  gDirY: number;
  /** Wind acceleration (px/s²). */
  windX: number;
  windY: number;
  /** Velocity kept per 60 Hz step by the air drag (1 without drag). */
  dragKeep: number;
  /** The ring modes keep every ball at least at its cruise speed. */
  keepMoving: boolean;
  cruise: (ball: Ball) => number;
  /** Another feature times the balls this step (Picture Paint's beat sync): On beat stands aside. */
  suspended: boolean;
}

export interface OnBeatStats {
  /** On beat is timing balls right now. */
  active: boolean;
  /** Planned contacts so far this run, and those within `ON_BEAT_TOLERANCE_SEC` of their grid point. */
  hits: number;
  onBeat: number;
  /** Error of the latest planned contact and the largest / mean |error| of the last 16 (ms). */
  lastErrMs: number;
  maxErrMs: number;
  meanErrMs: number;
  /** Distinct beats (whole beats, not subdivisions) a contact landed on. */
  beatsCovered: number;
  /** Free flights: contacts no grid point could be reached for within the range (a hop between two close rings), or past the horizon. */
  unplanned: number;
  /** Largest retiming in effect right now (1 = natural speed). */
  warp: number;
}

interface BallPlan {
  id: number;
  /** Gravity scale the ball had before On beat touched it. */
  baseGravity: number;
  /** Speed factor applied since the last rebound (1 = natural). */
  warp: number;
  /** Target stamp (s) of the next contact; NaN = a free flight. */
  target: number;
  needsPlan: boolean;
  stepsSinceCheck: number;
  lastContact: number;
  /** Velocity after the last step: a sudden turn without a wall contact (another ball) means the flight was disturbed. */
  lastVx: number;
  lastVy: number;
  seen: boolean;
}

/** Grid points considered per plan. */
const MAX_CANDIDATES = 12;
/** A retiming is accepted when its predicted contact is this close (s) to the target's step middle. */
const ACCEPT_SEC = 0.01;
/** A velocity change between two steps beyond gravity and wind – this many px/s, or this share of the speed – is a disturbance. */
const DISTURBANCE_MIN_DV = 25;
const DISTURBANCE_REL_DV = 0.12;

export class OnBeatController {
  private config: OnBeatConfig = { ...DEFAULT_ON_BEAT };
  private readonly plans = new Map<number, BallPlan>();
  private readonly radii = new Float64Array(64);
  /** Rings the ball's band overlaps when a prediction starts (it is passing them): ignored until it has left them. */
  private readonly touching = new Uint8Array(64);
  /** Squared inner / outer distances of every ring's contact band for the ball being predicted (−1: no inner bound). */
  private readonly bandLo2 = new Float64Array(64);
  private readonly bandHi2 = new Float64Array(64);
  private radiusCount = 0;
  private active = false;
  private readonly errWindow = new Float64Array(STATS_WINDOW);
  private errCount = 0;
  private lastBeatCovered = -1;
  private readonly candTimes = new Float64Array(MAX_CANDIDATES);
  private readonly candScores = new Float64Array(MAX_CANDIDATES);
  private readonly stats: OnBeatStats = { active: false, hits: 0, onBeat: 0, lastErrMs: 0, maxErrMs: 0, meanErrMs: 0, beatsCovered: 0, unplanned: 0, warp: 1 };

  setConfig(patch: Partial<OnBeatConfig>) {
    this.config = { ...this.config, ...patch };
    // --- review fix (uncap-all) --- from 0.05, no maximum: a range past 1 lets a flight stretch or squeeze by more than 2×
    this.config.range = Math.max(0.05, Number.isFinite(this.config.range) ? this.config.range : DEFAULT_ON_BEAT.range);
    this.config.subdivisions = [1, 2, 4].includes(this.config.subdivisions) ? this.config.subdivisions : 1;
  }

  getConfig(): OnBeatConfig {
    return { ...this.config };
  }

  /** True while there is anything to do: On beat is on, or balls still carry a retiming to undo. */
  wants(): boolean {
    return this.config.enabled || this.plans.size > 0;
  }

  /** A new run: no plans, fresh statistics (the balls are new too). */
  reset() {
    this.plans.clear();
    this.active = false;
    this.errCount = 0;
    this.lastBeatCovered = -1;
    const s = this.stats;
    s.active = false;
    s.hits = s.onBeat = s.beatsCovered = s.unplanned = 0;
    s.lastErrMs = s.maxErrMs = s.meanErrMs = 0;
    s.warp = 1;
  }

  /** Live statistics (the same object every call). */
  getStats(): Readonly<OnBeatStats> {
    return this.stats;
  }

  /** On beat applies to this mode with this grid. */
  appliesTo(mode: ModeId | undefined): boolean {
    return this.config.enabled && !!mode && ON_BEAT_MODES.includes(mode) && clockHasTempo(this.config.clock);
  }

  /**
   * A ball touched a wall at `timeSec` (the step's stamp). `fresh`: the engine gave it a new rebound at its natural speed
   * (the retiming is over); a gap pass or a mode's own bounce keep the current speed. Either way the next flight is planned.
   */
  noteContact(ball: Ball, timeSec: number, fresh: boolean) {
    if (!this.active) return;
    const plan = this.plans.get(ball.id);
    if (!plan) return;
    if (fresh) {
      plan.warp = 1;
      ball.gravityScale = plan.baseGravity === 1 ? undefined : plan.baseGravity;
    }
    const repeat = timeSec - plan.lastContact < CONTACT_DEBOUNCE_SEC;
    plan.lastContact = timeSec;
    plan.needsPlan = true;
    if (repeat) return;
    const clock = this.config.clock;
    if (!clock) return;
    const target = plan.target;
    plan.target = NaN;
    if (!Number.isFinite(target)) {
      this.stats.unplanned++;
      return;
    }
    const err = gridErrorSec(clock, timeSec, this.config.subdivisions);
    if (!Number.isFinite(err)) return;
    const s = this.stats;
    s.hits++;
    if (Math.abs(err) <= ON_BEAT_TOLERANCE_SEC) s.onBeat++;
    s.lastErrMs = 1000 * err;
    this.errWindow[this.errCount % STATS_WINDOW] = Math.abs(1000 * err);
    this.errCount++;
    const n = Math.min(this.errCount, STATS_WINDOW);
    let max = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (this.errWindow[i] > max) max = this.errWindow[i];
      sum += this.errWindow[i];
    }
    s.maxErrMs = max;
    s.meanErrMs = sum / n;
    const beat = nearestBeatIndex(clock, timeSec);
    if (beat > this.lastBeatCovered && Math.abs(beatTimeSec(clock, beat) - timeSec) <= ON_BEAT_TOLERANCE_SEC) {
      this.lastBeatCovered = beat;
      s.beatsCovered++;
    }
  }

  /** Plans and corrects the flights after a 60 Hz step; undoes every retiming once On beat no longer applies. */
  afterStep(balls: Ball[], world: OnBeatWorld) {
    const applies = this.appliesTo(world.mode) && !world.suspended;
    if (!applies) {
      if (this.plans.size > 0) this.releaseAll(balls);
      this.active = false;
      this.stats.active = false;
      return;
    }
    this.active = true;
    this.stats.active = true;
    this.syncRadii(world);
    let tracked = 0;
    let warpMax = 1;
    const stamp = world.timeSec;
    for (let i = 0; i < balls.length && tracked < ON_BEAT_MAX_BALLS; i++) {
      const ball = balls[i];
      if (ball.frozen) continue;
      let plan = this.plans.get(ball.id);
      if (!plan) {
        plan = { id: ball.id, baseGravity: ball.gravityScale ?? 1, warp: 1, target: NaN, needsPlan: true, stepsSinceCheck: 0, lastContact: -Infinity, lastVx: ball.vx, lastVy: ball.vy, seen: true };
        this.plans.set(ball.id, plan);
      }
      plan.seen = true;
      tracked++;
      if (plan.needsPlan) this.plan(ball, plan, world);
      else if (Number.isFinite(plan.target)) {
        plan.stepsSinceCheck++;
        const remaining = plan.target - stamp;
        if (remaining < -world.stepSec || this.disturbed(ball, plan, world)) this.plan(ball, plan, world); // the flight changed: plan it again
        else if (plan.stepsSinceCheck >= CORRECT_EVERY_STEPS || remaining < CLOSE_SEC) this.correct(ball, plan, world);
      }
      plan.lastVx = ball.vx;
      plan.lastVy = ball.vy;
      const w = plan.warp >= 1 ? plan.warp : 1 / plan.warp;
      if (w > warpMax) warpMax = w;
    }
    this.stats.warp = warpMax;
    // Balls that left the run (Multiply's escaped balls, merges) or the tracked set.
    if (this.plans.size > tracked) {
      this.plans.forEach((plan, id) => {
        if (!plan.seen) this.plans.delete(id);
      });
    }
    this.plans.forEach((plan) => {
      plan.seen = false;
    });
  }

  /**
   * The ball's velocity changed since the last step by more than gravity and wind explain, without touching a wall
   * (another ball or an obstacle hit it, the rig steered it): the flight is planned again.
   */
  private disturbed(ball: Ball, plan: BallPlan, world: OnBeatWorld): boolean {
    const g = world.gravity * (ball.gravityScale ?? 1) * world.stepSec;
    const ex = plan.lastVx + g * world.gDirX + world.windX * world.stepSec;
    const ey = plan.lastVy + g * world.gDirY + world.windY * world.stepSec;
    const dx = ball.vx - ex;
    const dy = ball.vy - ey;
    const speed = Math.hypot(ball.vx, ball.vy);
    const limit = Math.max(DISTURBANCE_MIN_DV, DISTURBANCE_REL_DV * speed);
    return dx * dx + dy * dy > limit * limit;
  }

  /** Undoes every retiming (On beat switched off, another mode). */
  private releaseAll(balls: Ball[]) {
    for (const ball of balls) {
      const plan = this.plans.get(ball.id);
      if (!plan) continue;
      if (plan.warp !== 1) {
        ball.vx /= plan.warp;
        ball.vy /= plan.warp;
      }
      ball.gravityScale = plan.baseGravity === 1 ? undefined : plan.baseGravity;
    }
    this.plans.clear();
  }

  private syncRadii(world: OnBeatWorld) {
    let n = 0;
    for (let i = 0; i < world.walls.length && n < this.radii.length; i++) if (!world.broken.has(i)) this.radii[n++] = world.walls[i].radius;
    this.radiusCount = n;
  }

  /**
   * Picks the grid point of the next contact and retimes the flight onto it: whole beats first, then the subdivisions,
   * the point needing the smallest retiming first; the first one the retiming can actually reach wins. None reachable:
   * a free flight at the ball's own speed.
   */
  private plan(ball: Ball, plan: BallPlan, world: OnBeatWorld) {
    plan.needsPlan = false;
    plan.stepsSinceCheck = 0;
    plan.target = NaN;
    const clock = this.config.clock;
    if (!clock) return;
    const tau = this.predict(ball, 1, world);
    if (tau < 0) return;
    const { lo, hi } = this.scaleBounds(plan);
    const now = world.timeSec;
    const half = world.stepSec / 2;
    // The durations the allowed retiming can roughly reach (the cruise boost makes the ends soft): τ / hi … τ / lo.
    const dMin = tau / hi;
    const dMax = tau / lo;
    const times = this.candTimes;
    const scores = this.candScores;
    for (let sub = 1; sub <= this.config.subdivisions; sub *= 2) {
      let count = 0;
      for (let t = nextGridPointSec(clock, now + half + dMin, sub), guard = 0; Number.isFinite(t) && t - half - now <= dMax + 1e-9 && guard < 64 && count < MAX_CANDIDATES; guard++) {
        const d = t - half - now;
        if (d > 0) {
          // Insertion by score (the retiming each point needs, in octaves).
          const score = Math.abs(Math.log(tau / d));
          let k = count++;
          while (k > 0 && scores[k - 1] > score) {
            scores[k] = scores[k - 1];
            times[k] = times[k - 1];
            k--;
          }
          scores[k] = score;
          times[k] = t;
        }
        t = nextGridPointSec(clock, t + 1e-4, sub);
      }
      for (let k = 0; k < count; k++) {
        if (this.retime(ball, plan, world, tau, times[k] - half - now)) {
          plan.target = times[k];
          return;
        }
      }
    }
  }

  /** Re-checks a planned flight and nudges its speed so it still lands on its target (or plans it again). */
  private correct(ball: Ball, plan: BallPlan, world: OnBeatWorld) {
    plan.stepsSinceCheck = 0;
    const d = plan.target - world.stepSec / 2 - world.timeSec;
    if (!(d > 1e-4)) return;
    const tau = this.predict(ball, 1, world);
    if (tau < 0) {
      plan.target = NaN;
      return;
    }
    if (Math.abs(tau - d) < 0.0015) return;
    if (!this.retime(ball, plan, world, tau, d)) this.plan(ball, plan, world);
  }

  /**
   * Finds the scale c (velocity × c, gravity × c²) whose predicted contact comes after `d` seconds and applies it; false
   * (nothing changed) when the range cannot get the contact within `ACCEPT_SEC` of it.
   */
  private retime(ball: Ball, plan: BallPlan, world: OnBeatWorld, tau: number, d: number): boolean {
    const { lo, hi } = this.scaleBounds(plan);
    // Secant iteration on f(c) = predicted(c) − d, starting from c = 1 (τ) and the ballistic guess τ / d.
    let c0 = 1;
    let f0 = tau - d;
    let c = Math.max(lo, Math.min(hi, tau / d));
    let f = NaN;
    for (let iteration = 0; iteration < 6; iteration++) {
      const t = this.predict(ball, c, world);
      if (t < 0) return false;
      f = t - d;
      if (Math.abs(f) < ACCEPT_SEC * 0.25) break;
      const slope = (f - f0) / (c - c0);
      let next = Number.isFinite(slope) && Math.abs(slope) > 1e-9 ? c - f / slope : (c * t) / d;
      next = Math.max(lo, Math.min(hi, next));
      if (Math.abs(next - c) < 1e-5) break;
      c0 = c;
      f0 = f;
      c = next;
    }
    if (!(Math.abs(f) <= ACCEPT_SEC)) return false;
    if (c !== 1) {
      ball.vx *= c;
      ball.vy *= c;
      plan.warp *= c;
      ball.gravityScale = plan.baseGravity * plan.warp * plan.warp;
    }
    return true;
  }

  /** The relative scale that keeps the total retiming within the range. */
  private scaleBounds(plan: BallPlan): { lo: number; hi: number } {
    const max = 1 + this.config.range;
    return { lo: 1 / max / plan.warp, hi: max / plan.warp };
  }

  /**
   * Seconds until the ball (its velocity scaled by `c`, its gravity by c²) first touches an intact ring, replaying the
   * engine's sub-steps; −1 when that takes longer than the horizon.
   */
  private predict(ball: Ball, c: number, world: OnBeatWorld): number {
    const subSteps = Math.max(1, world.subSteps);
    const dt = world.stepSec / subSteps;
    if (!(dt > 0)) return -1;
    const gravityScale = (ball.gravityScale ?? 1) * c * c;
    const g = world.gravity * gravityScale * dt;
    const ax = g * world.gDirX + world.windX * dt;
    const ay = g * world.gDirY + world.windY * dt;
    const boost = 1 + 0.5 * dt;
    const cruise = world.keepMoving ? world.cruise(ball) : 0;
    const cruise2 = cruise * cruise;
    const drag = world.dragKeep;
    const r = ball.radius;
    const cx = world.cx;
    const cy = world.cy;
    const radii = this.radii;
    const lo2 = this.bandLo2;
    const hi2 = this.bandHi2;
    const n = this.radiusCount;
    let x = ball.x - cx;
    let y = ball.y - cy;
    let vx = ball.vx * c;
    let vy = ball.vy * c;
    // A contact is the ball's band (its radius + 2 px, as the engine tests it) reaching a ring – compared on squared
    // distances; a ring the band already overlaps (a gap being passed, a rebound's push-out margin) only counts once the
    // ball has left it.
    const touching = this.touching;
    let anyTouching = false;
    {
      const d2 = x * x + y * y;
      for (let i = 0; i < n; i++) {
        const lo = radii[i] - r - 2;
        const hi = radii[i] + r + 2;
        lo2[i] = lo > 0 ? lo * lo : -1;
        hi2[i] = hi * hi;
        const t = d2 >= lo2[i] && d2 <= hi2[i] ? 1 : 0;
        touching[i] = t;
        if (t) anyTouching = true;
      }
    }
    const maxSteps = Math.ceil(ON_BEAT_HORIZON_SEC / dt);
    for (let k = 1; k <= maxSteps; k++) {
      // The engine applies the air drag once per 60 Hz step, before its sub-steps.
      if (drag !== 1 && (k - 1) % subSteps === 0) {
        vx *= drag;
        vy *= drag;
      }
      vx += ax;
      vy += ay;
      if (cruise2 > 0) {
        const speed2 = vx * vx + vy * vy;
        if (speed2 > 0 && speed2 < cruise2) {
          vx *= boost;
          vy *= boost;
        }
      }
      x += vx * dt;
      y += vy * dt;
      const d2 = x * x + y * y;
      for (let i = 0; i < n; i++) {
        const inBand = d2 >= lo2[i] && d2 <= hi2[i];
        if (anyTouching && touching[i]) {
          if (!inBand) touching[i] = 0;
          continue;
        }
        if (inBand) return k * dt;
      }
    }
    return -1;
  }

}
