/**
 * The expression state machine of a ball character (see ./character.ts). Pure and allocation-free: one small
 * state object per ball, advanced once per rendered frame by `stepExpression()` with what happened to the ball
 * since the last frame. Times are simulation milliseconds, so a paused run freezes the face and a recording of
 * a seed shows the same faces as the run it replays.
 *
 * Priority (highest first):
 *  - grin    – the ball is outside every wall (escaped) or the run is finished; lingers `GRIN_HOLD_MS` after.
 *  - shock   – a wall broke (wide eyes, "O" mouth) for `SHOCK_MS`. A running shock is never re-armed and a new one
 *              waits `SHOCK_COOLDOWN_MS` after it, so a burst of breaks (Shatter breaks a segment every few hundred
 *              ms) gives a startled look now and then, not a face frozen in shock that never blinks.
 *  - ouch    – a hard hit (relative impact ≥ `OUCH_IMPACT`, i.e. a near head-on rebound): squinting eyes for
 *              `OUCH_MS`, then no new ouch for `OUCH_COOLDOWN_MS` after the last one, so a ball rattling between
 *              rings winces once, not on every touch.
 *  - happy   – the ball has been (almost) still for `REST_MS`: closed, happy eyes.
 *  - neutral – everything else (eyes open, looking along the flight, blinking).
 */

export const EXPRESSIONS = ["neutral", "ouch", "shock", "grin", "happy"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/**
 * Relative impact from which a hit makes the ball say "ouch". The tracker measures an impact as the velocity change
 * divided by the ball's own speed before the hit (never less than half the Ball Speed setting), so a mirror-like
 * rebound scores 2·cos(angle to the wall's normal): 1.7 means within about 32° of head-on. Glancing rebounds, which
 * are most of them in the ring modes, do not count.
 */
export const OUCH_IMPACT = 1.7;
export const OUCH_MS = 280;
/** Time (ms) after the start of an ouch in which no hit starts a new one (nor extends the running one). */
export const OUCH_COOLDOWN_MS = 900;
export const SHOCK_MS = 750;
/** Time (ms) after a shock has run out in which a wall break does not start a new one. */
export const SHOCK_COOLDOWN_MS = 1200;
export const GRIN_HOLD_MS = 1500;
/** Speed (px/s) under which a ball counts as still, and how long it has to stay still to look content. */
export const REST_SPEED = 12;
export const REST_MS = 700;

export interface ExpressionState {
  expression: Expression;
  /** Simulation time (ms) at which a timed expression (ouch, shock, grin) ends. */
  until: number;
  /** How long the ball has been still (ms). */
  restMs: number;
  /** Simulation time (ms) at which the last shock started (−Infinity when none did). */
  lastShockAt: number;
  /** Simulation time (ms) at which the last ouch started (−Infinity when none did). */
  lastOuchAt: number;
}

export interface ExpressionInput {
  /** Simulation time (ms). */
  now: number;
  /** Simulation time since the previous step (ms); 0 while paused or before the start. */
  dt: number;
  /** Relative impact since the previous step (0 = none). */
  impact: number;
  /** A wall broke since the previous step. */
  wallBreak: boolean;
  /** The ball is outside every intact wall. */
  escaped: boolean;
  /** The run is finished. */
  finished: boolean;
  /** Current speed of the ball (px/s). */
  speed: number;
}

export function createExpressionState(): ExpressionState {
  return { expression: "neutral", until: 0, restMs: 0, lastShockAt: -Infinity, lastOuchAt: -Infinity };
}

export function resetExpressionState(state: ExpressionState) {
  state.expression = "neutral";
  state.until = 0;
  state.restMs = 0;
  state.lastShockAt = -Infinity;
  state.lastOuchAt = -Infinity;
}

const RANK: Record<Expression, number> = { neutral: 0, happy: 1, ouch: 2, shock: 3, grin: 4 };

/** Whether `ms` have passed since `last` (a restart, where the time goes back, resets the state: see the tracker). */
function elapsedSince(last: number, now: number, ms: number): boolean {
  return now - last >= ms;
}

/** The expression a timed state still shows at `now`, or null once it has run out. */
function activeTimed(state: ExpressionState, now: number): Expression | null {
  const e = state.expression;
  if ((e === "ouch" || e === "shock" || e === "grin") && now < state.until) return e;
  return null;
}

/**
 * Advances the state by one step and returns the expression that was *triggered* in this step (ouch, shock or
 * grin – the moments the cat face chirps), or null when nothing new happened. The state is updated in place.
 */
export function stepExpression(state: ExpressionState, input: ExpressionInput): Expression | null {
  const { now } = input;
  if (input.dt > 0) state.restMs = input.speed < REST_SPEED ? state.restMs + input.dt : 0;
  const current = activeTimed(state, now);

  if (input.escaped || input.finished) {
    const triggered = current === "grin" ? null : "grin";
    state.expression = "grin";
    state.until = now + GRIN_HOLD_MS;
    return triggered;
  }
  // A wall break starts a shock only when none is running and the last one is a cooldown ago: re-arming it on every
  // break would keep the face in shock through a burst of breaks (no blink, no ouch, damped eyes).
  if (input.wallBreak && (current === null || RANK[current] < RANK.shock) && elapsedSince(state.lastShockAt, now, SHOCK_MS + SHOCK_COOLDOWN_MS)) {
    state.expression = "shock";
    state.until = now + SHOCK_MS;
    state.lastShockAt = now;
    return "shock";
  }
  // Likewise a hard hit starts an ouch only a cooldown after the last one, and a hit while wincing does not extend it.
  if (input.impact >= OUCH_IMPACT && current === null && elapsedSince(state.lastOuchAt, now, OUCH_COOLDOWN_MS)) {
    state.expression = "ouch";
    state.until = now + OUCH_MS;
    state.lastOuchAt = now;
    return "ouch";
  }
  if (current !== null) return null;
  state.expression = state.restMs >= REST_MS ? "happy" : "neutral";
  return null;
}
