import { createExpressionState, stepExpression, type Expression, type ExpressionState } from "./expression";
import { BlinkClock, SQUASH_MIN_IMPACT, blinkSeed, lookTarget, smoothToward, type Vec } from "./eyes";

/**
 * Per-ball bookkeeping of the ball characters (see ./character.ts): once per rendered frame the canvas hands the
 * balls and what happened in the run to `update()`, which derives for every ball its impacts (the change of
 * velocity since the last frame beyond what gravity and wind explain), whether it rests or escaped, advances its
 * expression state machine (./expression.ts), its eased look and its seeded blink (./eyes.ts). No DOM and no
 * allocation after a ball was first seen, so it is unit-tested directly and costs next to nothing per frame.
 *
 * Times are simulation milliseconds (`engine.getElapsedMs()`): a paused run freezes every face, and a time that
 * goes back (a restart) or a new seed starts every ball over.
 */

/** What the tracker reads of a ball (an engine `Ball` fits). */
export interface TrackedBall {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface CharacterFrameInput {
  /** Simulation time (ms). */
  now: number;
  /** The run's seed (the blink schedule of each ball derives from it and the ball id). */
  seed: number;
  /**
   * The Ball Speed setting (px/s): the squash strength of an impact is measured against it, and the "ouch" of a hit
   * against the ball's own speed before it, but never against less than `OUCH_SPEED_FLOOR` of this.
   */
  refSpeed: number;
  /** Smooth acceleration (px/s², gravity + wind) that is never counted as an impact. */
  accelAllowance: number;
  /** A wall broke since the last frame (a "gap" sound event). */
  wallBreak: boolean;
  /** The run is finished. */
  finished: boolean;
  /** Centre of the rings and the radius a ball must pass (plus its own radius) to count as escaped; Infinity when there is nothing to escape from. */
  centerX: number;
  centerY: number;
  escapeRadius: number;
}

export interface CharacterBallState {
  id: number;
  /** Frame counter value of the last update. */
  seen: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Eased look direction as a fraction of the eye's reach (each axis −1…1). */
  lookX: number;
  lookY: number;
  expression: ExpressionState;
  blink: BlinkClock;
  /** Lid closure (0–1) of the blink at the last update. */
  closure: number;
  /** Simulation time of the last impact that wobbles the ball, its relative strength and its normal (unit vector). */
  impactAt: number;
  impactStrength: number;
  impactNx: number;
  impactNy: number;
}

/** Most balls that get a character (Multiply can spawn hundreds; the rest stay plain). */
export const MAX_CHARACTER_BALLS = 80;
/** A velocity change counts only beyond this many px/s plus the smooth acceleration of the frame (×1.5 margin). */
const IMPACT_NOISE = 1;
/** Fraction of the reference speed a hit's "ouch" is measured against at least (see `CharacterFrameInput.refSpeed`). */
export const OUCH_SPEED_FLOOR = 0.5;
/** Frames a ball may go unseen before its state is dropped. */
const STALE_FRAMES = 120;

const EXPRESSION_RANK: Record<Expression, number> = { neutral: 0, happy: 1, ouch: 2, shock: 3, grin: 4 };

export class CharacterTracker {
  private states = new Map<number, CharacterBallState>();
  private frame = 0;
  private lastNow = -1;
  private seed: number | null = null;
  private readonly look: Vec = { x: 0, y: 0 };
  /** The strongest expression triggered in the last update (grin > shock > ouch), or null. */
  triggered: Expression | null = null;
  /** Expression of the first ball of the last update ("" when there was none). */
  primaryExpression: Expression | "" = "";
  /** Balls updated in the last update. */
  count = 0;

  reset() {
    this.states.clear();
    this.lastNow = -1;
    this.seed = null;
    this.triggered = null;
    this.primaryExpression = "";
    this.count = 0;
  }

  get(id: number): CharacterBallState | undefined {
    return this.states.get(id);
  }

  update(balls: readonly TrackedBall[], input: CharacterFrameInput) {
    const now = input.now;
    if (this.seed !== input.seed || now < this.lastNow) {
      this.states.clear();
      this.lastNow = -1;
      this.seed = input.seed;
    }
    const dt = this.lastNow < 0 ? 0 : now - this.lastNow;
    this.lastNow = now;
    this.frame++;
    this.triggered = null;
    this.primaryExpression = "";
    const dtSec = dt / 1000;
    const refSpeed = input.refSpeed > 1 ? input.refSpeed : 1;
    const allowance = IMPACT_NOISE + 1.5 * Math.max(0, input.accelAllowance) * dtSec;
    const n = balls.length < MAX_CHARACTER_BALLS ? balls.length : MAX_CHARACTER_BALLS;
    for (let i = 0; i < n; i++) {
      const ball = balls[i];
      let st = this.states.get(ball.id);
      const fresh = !st;
      if (!st) {
        st = {
          id: ball.id,
          seen: this.frame,
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          lookX: 0,
          lookY: 0,
          expression: createExpressionState(),
          blink: new BlinkClock(blinkSeed(input.seed, ball.id)),
          closure: 0,
          impactAt: -Infinity,
          impactStrength: 0,
          impactNx: 1,
          impactNy: 0,
        };
        this.states.set(ball.id, st);
      }
      // Where the ball is heading: its own velocity, or – for balls a mode moves by hand (Pendulum Wave) – its move since the last frame.
      let mvx = ball.vx;
      let mvy = ball.vy;
      const ownSpeed = Math.hypot(mvx, mvy);
      let moveSpeed = 0;
      if (dtSec > 0) {
        const px = (ball.x - st.x) / dtSec;
        const py = (ball.y - st.y) / dtSec;
        moveSpeed = Math.hypot(px, py);
        if (ownSpeed < 1) {
          mvx = px;
          mvy = py;
        }
      }
      let impact = 0;
      if (dtSec > 0 && !fresh) {
        const dvx = ball.vx - st.vx;
        const dvy = ball.vy - st.vy;
        const dv = Math.hypot(dvx, dvy);
        const excess = dv - allowance;
        if (excess > 0) {
          // The squash follows the absolute strength (against the Ball Speed setting)...
          const strength = excess / refSpeed;
          if (strength >= SQUASH_MIN_IMPACT) {
            st.impactAt = now;
            st.impactStrength = strength;
            st.impactNx = dvx / dv;
            st.impactNy = dvy / dv;
          }
          // ...the "ouch" how hard the hit was for this ball: against its own speed before it (a mirror rebound scores
          // 2·cos(angle to the normal), so only near head-on ones reach OUCH_IMPACT), and never against less than a
          // fraction of the Ball Speed, so a slow ball nudging a wall does not count as hurt.
          const before = Math.hypot(st.vx, st.vy);
          const floor = OUCH_SPEED_FLOOR * refSpeed;
          impact = excess / (before > floor ? before : floor > 1 ? floor : 1);
        }
      }
      const dx = ball.x - input.centerX;
      const dy = ball.y - input.centerY;
      const escaped = Number.isFinite(input.escapeRadius) && Math.hypot(dx, dy) > input.escapeRadius + ball.radius;
      const speed = ownSpeed > moveSpeed ? ownSpeed : moveSpeed;
      const triggered = stepExpression(st.expression, { now, dt, impact, wallBreak: input.wallBreak, escaped, finished: input.finished, speed });
      if (triggered && (this.triggered === null || EXPRESSION_RANK[triggered] > EXPRESSION_RANK[this.triggered])) this.triggered = triggered;
      lookTarget(mvx, mvy, 1, this.look);
      if (fresh) {
        st.lookX = this.look.x;
        st.lookY = this.look.y;
      } else {
        st.lookX = smoothToward(st.lookX, this.look.x, dt);
        st.lookY = smoothToward(st.lookY, this.look.y, dt);
      }
      st.closure = st.blink.closure(now);
      st.x = ball.x;
      st.y = ball.y;
      st.vx = ball.vx;
      st.vy = ball.vy;
      st.seen = this.frame;
      if (i === 0) this.primaryExpression = st.expression.expression;
    }
    this.count = n;
    if (this.frame % 60 === 0) {
      for (const [id, st] of this.states) if (this.frame - st.seen > STALE_FRAMES) this.states.delete(id);
    }
  }
}
