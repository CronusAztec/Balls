/**
 * The expression state machine of a ball character (see ./character.ts). Pure and allocation-free: one small
 * state object per ball, advanced once per rendered frame by `stepExpression()` with what happened to the ball
 * since the last frame. Times are simulation milliseconds, so a paused run freezes the face and a recording of
 * a seed shows the same faces as the run it replays.
 *
 * Priority (highest first):
 *  - grin    – the ball is outside every wall (escaped) or the run is finished; lingers `GRIN_HOLD_MS` after.
 *  - shock   – a wall broke (wide eyes, "O" mouth) for `SHOCK_MS`.
 *  - ouch    – a hard hit (relative impact ≥ `OUCH_IMPACT`): squinting eyes for `OUCH_MS`.
 *  - happy   – the ball has been (almost) still for `REST_MS`: closed, happy eyes.
 *  - neutral – everything else (eyes open, looking along the flight, blinking).
 */

export const EXPRESSIONS = ["neutral", "ouch", "shock", "grin", "happy"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** Relative impact (velocity change ÷ reference speed) from which a hit makes the ball say "ouch". */
export const OUCH_IMPACT = 0.9;
export const OUCH_MS = 280;
export const SHOCK_MS = 750;
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
  return { expression: "neutral", until: 0, restMs: 0 };
}

export function resetExpressionState(state: ExpressionState) {
  state.expression = "neutral";
  state.until = 0;
  state.restMs = 0;
}

const RANK: Record<Expression, number> = { neutral: 0, happy: 1, ouch: 2, shock: 3, grin: 4 };

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
  if (input.wallBreak && (current === null || RANK[current] <= RANK.shock)) {
    const triggered = current === "shock" ? null : "shock";
    state.expression = "shock";
    state.until = now + SHOCK_MS;
    return triggered;
  }
  if (input.impact >= OUCH_IMPACT && (current === null || RANK[current] <= RANK.ouch)) {
    const triggered = current === "ouch" ? null : "ouch";
    state.expression = "ouch";
    state.until = now + OUCH_MS;
    return triggered;
  }
  if (current !== null) return null;
  state.expression = state.restMs >= REST_MS ? "happy" : "neutral";
  return null;
}
