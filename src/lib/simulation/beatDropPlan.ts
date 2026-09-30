import { clamp01, easeInCubic, easeInQuad, easeOutBack, easeOutCubic, progress, smoothstep, springDecay } from "@/lib/anim/easing";

/**
 * The Beat Drop planner (feature beat-drop; the mode is src/lib/physics/modes/beatDrop.ts, the drawing
 * components/simulator/beatDropRenderer.ts). Pure and deterministic: given the beat times t₀ < t₁ < … the ball must land
 * on, a gravity scale and a seeded random stream, it lays out every landing point, every bounce and every obstruction's
 * entrance and exit so the ball lands on the k-th obstruction exactly at tₖ.
 *
 * Units: the side of the square the recorder exports (the "view") is 1; x is measured from its centre (right positive),
 * y downward from the first landing (so the plan never depends on the canvas size – a resize keeps every landing on its
 * beat). The ball's centre is planned; an obstruction's top is drawn one ball radius below its landing point.
 *
 * The flight from landing k to landing k+1 takes T = tₖ₊₁ − tₖ under the gravity gₖ. With the height difference
 * D = yₖ₊₁ − yₖ (positive = the next landing is lower) the take-off speed follows from D = v·T + g·T²/2:
 *
 *     v = D / T − g·T / 2      (negative = upward, as a bounce is)
 *
 * and the ball, launched with (x′, y′) = (dx / T, v), is exactly at (xₖ₊₁, yₖ₊₁) at tₖ₊₁ – the landing is on the beat by
 * construction, to floating-point precision, at any tempo and on any irregular grid. The base gravity is chosen from the
 * beat period P so a flight of one period rises the Bounce Height h (g = 8·h / P²); a spring pad (and a little a drum pad)
 * multiplies it for the next flight (a higher, snappier bounce in the same time), and a long gap (a slow or irregular grid)
 * lowers it so the apex stays on screen (g ≤ 8·H_MAX / T²). |D| is clamped to a fraction of g·T²/2 so the ball always
 * leaves upward and always comes down onto the pad (never up through it).
 *
 * Horizontal drift: a seeded walk – the direction keeps with probability 0.65, the step is Drift × DX_MAX × (0.4…1) –
 * reflected into the safe area |x| ≤ X_SAFE and capped at DX_SPEED_MAX·T (no zipping across the view on a tiny hop). A
 * wedge redirects it: the flight off a wedge goes the way the wedge faces (towards the middle near an edge), at least
 * WEDGE_DX_MIN, whatever the Drift. Scrolling "endless" makes every landing a little lower (the world scrolls, the camera
 * follows); "arena" keeps the landings inside a band around the middle of the view.
 *
 * Obstructions: landing k's pad flies in from off-screen – left, right, top or bottom, seeded, never from the side the ball
 * comes from (the horizontal side it drifts in from, or the top when it falls straight down) – over Anticipation × the
 * incoming interval with an ease-out (a back ease for the bouncy kinds), settles `settle` (≤ 50 ms) before the beat, holds
 * while the ball is over it and slides away sideways (away from the ball) with an ease-in and a fade before the ball could
 * come back down through its level (`leaveEnd` ≤ tₖ + the time the ball needs to fall back to yₖ). Every random decision
 * draws a fixed number of numbers per landing (DRAWS_PER_LANDING) whatever it becomes, so one choice never shifts another.
 */

/* ------------------------------------------------------------------ kinds */

export const BEAT_DROP_KINDS = ["plank", "block", "spring", "wedge", "spinner", "drum"] as const;
export type BeatDropPadKind = (typeof BEAT_DROP_KINDS)[number];

export function isBeatDropPadKind(value: unknown): value is BeatDropPadKind {
  return typeof value === "string" && (BEAT_DROP_KINDS as readonly string[]).includes(value);
}

export const BEAT_DROP_SCROLLS = ["endless", "arena"] as const;
export type BeatDropScroll = (typeof BEAT_DROP_SCROLLS)[number];

export function isBeatDropScroll(value: unknown): value is BeatDropScroll {
  return typeof value === "string" && (BEAT_DROP_SCROLLS as readonly string[]).includes(value);
}

/** How each kind of obstruction is built and behaves (units of the view). */
export interface PadGeometry {
  /** Half the width of the top surface. */
  halfWidth: number;
  /** Depth of the body under the top surface. */
  height: number;
  /** How much the pad gives on impact (0–1 of its height, a damped spring). */
  squash: number;
  /** Gravity factor of the flight off it: > 1 is a higher, snappier bounce in the same time (spring, drum). */
  boost: number;
  /** Arrives with an overshoot (back ease) rather than a plain cubic ease-out. */
  bouncy: boolean;
}

export const PAD_GEOMETRY: Record<BeatDropPadKind, PadGeometry> = {
  plank: { halfWidth: 0.085, height: 0.02, squash: 0.35, boost: 1, bouncy: false },
  block: { halfWidth: 0.055, height: 0.05, squash: 0.12, boost: 1, bouncy: true },
  spring: { halfWidth: 0.06, height: 0.045, squash: 0.55, boost: 1.75, bouncy: true },
  wedge: { halfWidth: 0.07, height: 0.05, squash: 0.12, boost: 1, bouncy: false },
  spinner: { halfWidth: 0.1, height: 0.016, squash: 0.25, boost: 1, bouncy: false },
  drum: { halfWidth: 0.075, height: 0.05, squash: 0.3, boost: 1.25, bouncy: true },
};

/* ------------------------------------------------------------------ constants */

/** Landings stay within ±X_SAFE of the middle, so every pad (half-width ≤ 0.1) stays inside the exported square. */
export const X_SAFE = 0.34;
/** The largest sideways move of one flight at Drift 1. */
export const DX_MAX = 0.38;
/** Sideways speed cap (view widths per second), so a very short hop never zips across the view. */
export const DX_SPEED_MAX = 1.6;
/** A wedge always sends the ball at least this far sideways (capped by DX_SPEED_MAX). */
export const WEDGE_DX_MIN = 0.16;
/** Tilt of a wedge's slope (rad). */
export const WEDGE_TILT = 0.32;
/** Endless scrolling: every landing is this much lower than the one before (seeded between the two). */
export const ENDLESS_DROP_MIN = 0.045;
export const ENDLESS_DROP_MAX = 0.11;
/** Arena: landings stay within ±ARENA_BAND of the middle height, moving by up to ARENA_STEP a flight. */
export const ARENA_BAND = 0.12;
export const ARENA_STEP = 0.08;
/** The highest a flight may rise above its take-off (a spring may go SPRING_HEADROOM times higher). */
export const H_MAX = 0.46;
export const SPRING_HEADROOM = 1.3;
/** |D| never exceeds this fraction of g·T²/2 (the ball always leaves upward and lands descending). */
export const DROP_FRACTION = 0.6;
/** Beats closer than this to the previous landing are skipped (a double hit of a tapped grid); no flight is shorter. */
export const MIN_FLIGHT_SEC = 0.08;
/** The first landing is the first beat at or after this time (the ball drops in from above the view meanwhile). */
export const LEAD_IN_SEC = 0.45;
/** The ball starts this far above the first landing (above the top of the view). */
export const START_ABOVE = 1.05;
/** An obstruction settles at most this long (and at most SETTLE_FRACTION of the interval) before its beat. */
export const SETTLE_SEC = 0.05;
export const SETTLE_FRACTION = 0.12;
/** It starts this far (view units) off its resting spot: off-screen on any canvas. */
export const ENTRY_DISTANCE = 1.3;
/** A pad entering from the top comes down on the far side from the ball, this far across. */
export const ENTRY_TOP_ACROSS = 0.35;
/** With less sideways drift than this the ball falls from above: nothing enters from the top. */
export const ENTRY_TOP_MIN_DX = 0.12;
/** A leaving pad slides this far sideways (and fades out). */
export const LEAVE_DISTANCE = 0.8;
/** It holds at least this long after the landing (or 40 % of the time the ball needs to come back down, if less). */
export const HOLD_MIN_SEC = 0.08;
/** The ball counts as clear of a pad this far (view units) past its edge. */
export const BALL_CLEARANCE = 0.035;
/** Off-beat hats only between beats at least this far apart. */
export const MIN_HAT_INTERVAL = 0.18;
/** Beats in a bar: beat 0 of a bar is the downbeat. */
export const BEATS_PER_BAR = 4;
/** The ball rests on a pad this long (at most CONTACT_FRACTION of the interval) before it leaves – the press of the impact. */
export const CONTACT_SEC = 0.03;
export const CONTACT_FRACTION = 0.1;
/** Random numbers drawn per landing, whatever they decide. */
export const DRAWS_PER_LANDING = 9;
/** A kind drawn twice in a row is redrawn (as another kind of the mix) with this probability. */
export const REPEAT_REDRAW = 0.7;

/* ------------------------------------------------------------------ entries and drums */

export const BD_ENTRY_LEFT = 0;
export const BD_ENTRY_RIGHT = 1;
export const BD_ENTRY_TOP = 2;
export const BD_ENTRY_BOTTOM = 3;

export const BD_DRUM_NONE = 0;
export const BD_DRUM_KICK = 1;
export const BD_DRUM_SNARE = 2;
export const BD_DRUM_HAT = 3;
export const BD_DRUM_NAMES = ["none", "kick", "snare", "hat"] as const;
export type BeatDropDrum = (typeof BD_DRUM_NAMES)[number];

/** Position of beat `index` in its bar (0 = the downbeat … 3). */
export function barPosition(index: number, beatsPerBar = BEATS_PER_BAR): number {
  const n = Math.max(1, Math.round(beatsPerBar));
  const i = Math.round(Number.isFinite(index) ? index : 0);
  return ((i % n) + n) % n;
}

/** The drum a landing on beat `index` plays: the kick on beats 1 and 3 of the bar, the snare on the backbeats 2 and 4. */
export function drumForBeat(index: number, beatsPerBar = BEATS_PER_BAR): number {
  const pos = barPosition(index, beatsPerBar);
  return pos % 2 === 0 ? BD_DRUM_KICK : BD_DRUM_SNARE;
}

/** True on the downbeat (the first beat of a bar): the kick is accented and the camera shakes. */
export function isDownbeat(index: number, beatsPerBar = BEATS_PER_BAR): boolean {
  return barPosition(index, beatsPerBar) === 0;
}

/**
 * The directions a pad may enter from when the ball arrives with the sideways move `dx`: never the side the ball comes
 * from (moving right, it comes from the left), and not the top when it falls (nearly) straight down. Written into `out`.
 */
export function allowedEntries(dx: number, out: number[] = []): number[] {
  out.length = 0;
  const eps = 1e-6;
  if (!(dx > eps)) out.push(BD_ENTRY_LEFT);
  if (!(dx < -eps)) out.push(BD_ENTRY_RIGHT);
  if (Math.abs(dx) >= ENTRY_TOP_MIN_DX) out.push(BD_ENTRY_TOP);
  out.push(BD_ENTRY_BOTTOM);
  return out;
}

/* ------------------------------------------------------------------ the plan */

export interface BeatDropPlanInput {
  /** Beat times (s), ascending: every one at or after LEAD_IN_SEC (and MIN_FLIGHT_SEC past the one before) becomes a landing. */
  beats: readonly number[];
  /** Their beat indices (numbered like `BeatClock.sample().index`) for the drum by bar position; their positions in `beats` without. */
  beatIndices?: readonly number[];
  /** The nominal beat period (s): the base gravity lifts a flight of one period the Bounce Height. */
  period: number;
  /** The mix of obstructions (at least one; unknown kinds are ignored, none left = planks). */
  kinds: readonly BeatDropPadKind[];
  /** 0–1: how far the ball drifts sideways between landings. */
  drift: number;
  scroll: BeatDropScroll;
  /** 0.1–0.5 of the view: how high a flight of one beat rises. */
  bounceHeight: number;
  /** 0.3–1 beats: how long before its beat an obstruction starts flying in. */
  anticipation: number;
  /** The seeded stream (the engine's `random()`). */
  random: () => number;
}

/** Every landing of a run and the drop-in before the first; typed arrays of `count` entries (see the file comment). */
export interface BeatDropPlan {
  count: number;
  /** The base gravity (view units / s²) and the nominal period it was chosen for. */
  gravity: number;
  period: number;
  /** The drop-in: the ball's state at t = 0 and the gravity of its flight to landing 0. */
  startX: number;
  startY: number;
  startVx: number;
  startVy: number;
  startG: number;
  /** Landing k: its time (the beat), beat index, landing point (ball centre) and the take-off velocity and gravity of the flight after it. */
  t: Float64Array;
  beatIndex: Int32Array;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  g: Float64Array;
  /** How long the ball rests on pad k (s) before the flight after it starts (the flight takes the interval minus this). */
  contact: Float64Array;
  /** The obstruction of landing k: its kind (index into BEAT_DROP_KINDS), entry direction and its arrival / leaving windows (s). */
  kind: Uint8Array;
  entry: Int8Array;
  /** Where along the top a top entry comes down from (−1 left, +1 right of the spot). */
  entryAcross: Int8Array;
  arriveStart: Float64Array;
  arriveEnd: Float64Array;
  leaveStart: Float64Array;
  leaveEnd: Float64Array;
  /** −1 slides away to the left, +1 to the right. */
  leaveSide: Int8Array;
  /** Wedge: −1 slopes down to the left (sends the ball left), +1 to the right. Spinner: the half turns it spins in with (signed). */
  facing: Int8Array;
  spinTurns: Float64Array;
  /** The drum of the landing (BD_DRUM_KICK / SNARE), whether it is a downbeat, and the off-beat hat after it (s; NaN: none). */
  drum: Uint8Array;
  downbeat: Uint8Array;
  hatAt: Float64Array;
}

export function createBeatDropPlan(capacity: number): BeatDropPlan {
  const n = Math.max(1, Math.floor(capacity));
  return {
    count: 0,
    gravity: 0,
    period: 0.5,
    startX: 0,
    startY: -START_ABOVE,
    startVx: 0,
    startVy: 0,
    startG: 1,
    t: new Float64Array(n),
    beatIndex: new Int32Array(n),
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    g: new Float64Array(n),
    contact: new Float64Array(n),
    kind: new Uint8Array(n),
    entry: new Int8Array(n),
    entryAcross: new Int8Array(n),
    arriveStart: new Float64Array(n),
    arriveEnd: new Float64Array(n),
    leaveStart: new Float64Array(n),
    leaveEnd: new Float64Array(n),
    leaveSide: new Int8Array(n),
    facing: new Int8Array(n),
    spinTurns: new Float64Array(n),
    drum: new Uint8Array(n),
    downbeat: new Uint8Array(n),
    hatAt: new Float64Array(n),
  };
}

/** The base gravity (view units / s²) that lifts a flight of `period` seconds by `bounceHeight`. */
export function baseGravity(bounceHeight: number, period: number): number {
  const p = Math.max(0.05, period);
  return (8 * Math.max(0.02, bounceHeight)) / (p * p);
}

/** The take-off vertical speed that covers the height difference `dy` (positive = lower) in `T` seconds under `g`. */
export function takeOffSpeed(dy: number, T: number, g: number): number {
  return dy / T - (g * T) / 2;
}

/** The gravity of a flight of `T` seconds off a pad with the factor `boost`: the base, boosted, capped so the apex stays on screen. */
export function flightGravity(base: number, T: number, boost: number): number {
  const headroom = boost > 1 ? H_MAX * SPRING_HEADROOM : H_MAX;
  const cap = (8 * headroom) / Math.max(1e-6, T * T);
  return Math.min(base * Math.max(1, boost), cap);
}

/** The largest |D| a flight of `T` seconds under `g` allows (it must leave upward and land descending). */
export function maxHeightDifference(T: number, g: number): number {
  return (DROP_FRACTION * g * T * T) / 2;
}

/** The descending root of y(τ) = y₀ + v·τ + g·τ²/2 = y₀ + dy: when a flight launched with `v` reaches `dy` below its start. */
export function descendingRoot(v: number, g: number, dy: number): number {
  const disc = v * v + 2 * g * dy;
  if (!(g > 0) || disc < 0) return NaN;
  return (-v + Math.sqrt(disc)) / g;
}

/** The landings the plan will have: the beats at or after LEAD_IN_SEC, each at least MIN_FLIGHT_SEC after the previous kept one. */
export function keptBeats(beats: readonly number[]): number[] {
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (!Number.isFinite(b) || b < LEAD_IN_SEC - 1e-9) continue;
    if (b - last < MIN_FLIGHT_SEC - 1e-9) continue;
    out.push(b);
    last = b;
  }
  return out;
}

/**
 * Lays out a run (see the file comment). Writes into `out` (grown when too small) and returns it; `DRAWS_PER_LANDING`
 * numbers of `input.random` are used per landing, a fixed number for the drop-in before.
 */
export function planBeatDrop(input: BeatDropPlanInput, out?: BeatDropPlan): BeatDropPlan {
  const kinds = input.kinds.filter(isBeatDropPadKind);
  const mix: BeatDropPadKind[] = kinds.length > 0 ? kinds : ["plank"];
  const random = input.random;
  // Which beats become landings (with their indices).
  const times: number[] = [];
  const indices: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < input.beats.length; i++) {
    const b = input.beats[i];
    if (!Number.isFinite(b) || b < LEAD_IN_SEC - 1e-9 || b - last < MIN_FLIGHT_SEC - 1e-9) continue;
    times.push(b);
    indices.push(input.beatIndices?.[i] ?? i);
    last = b;
  }
  const n = times.length;
  const plan = out && out.t.length >= n ? out : createBeatDropPlan(Math.max(n, 16));
  plan.count = n;
  const period = Number.isFinite(input.period) && input.period > 0 ? input.period : 0.5;
  plan.period = period;
  const drift = clamp01(input.drift);
  const g0 = baseGravity(input.bounceHeight, period);
  plan.gravity = g0;
  const anticipation = Math.max(0.05, Math.min(1, input.anticipation));
  const endless = input.scroll !== "arena";

  // The drop-in: a fixed number of draws before the landings.
  const rStartX = random();
  const rStartKind = random();
  if (n === 0) {
    plan.startX = 0;
    plan.startY = -START_ABOVE;
    plan.startVx = 0;
    plan.startVy = 0;
    plan.startG = g0;
    return plan;
  }

  const entries: number[] = [];
  let dir = rStartX < 0.5 ? -1 : 1;
  let prevKind = Math.floor(rStartKind * mix.length) % mix.length;
  let x = 0;
  let y = 0;
  for (let k = 0; k < n; k++) {
    // The draws of landing k, always all of them.
    const rKind = random();
    const rRepeat = random();
    const rDir = random();
    const rMag = random();
    const rDrop = random();
    const rEntry = random();
    const rAcross = random();
    const rWedge = random();
    const rSpin = random();

    // Landing k: its point (x, y) was fixed by the flight before it (landing 0: the middle, at height 0).
    plan.t[k] = times[k];
    plan.beatIndex[k] = indices[k];
    plan.x[k] = x;
    plan.y[k] = y;
    // Its obstruction: from the mix, rarely the same kind twice in a row.
    let kindIdx = Math.floor(rKind * mix.length) % mix.length;
    if (mix.length > 1 && kindIdx === prevKind && rRepeat < REPEAT_REDRAW) {
      const offset = 1 + Math.min(mix.length - 2, Math.floor((rRepeat / REPEAT_REDRAW) * (mix.length - 1)));
      kindIdx = (kindIdx + offset) % mix.length;
    }
    prevKind = kindIdx;
    const kind = mix[kindIdx];
    const geo = PAD_GEOMETRY[kind];
    plan.kind[k] = BEAT_DROP_KINDS.indexOf(kind);
    plan.drum[k] = drumForBeat(indices[k]);
    plan.downbeat[k] = isDownbeat(indices[k]) ? 1 : 0;

    // The flight after it (the last landing plans a flight of one period, for the time after the run).
    const T = k + 1 < n ? times[k + 1] - times[k] : period;
    // The ball presses into the pad for `contact`, then flies for the rest of the interval: F.
    const contact = Math.min(CONTACT_SEC, CONTACT_FRACTION * T);
    const F = T - contact;
    const g = flightGravity(g0, F, geo.boost);
    // Sideways: the seeded walk, or the wedge's redirect.
    if (rDir < 0.35) dir = -dir;
    let wedgeDir = 0;
    let dx = drift * DX_MAX * (0.4 + 0.6 * rMag);
    if (kind === "wedge") {
      wedgeDir = Math.abs(x) > 0.15 ? -Math.sign(x) : rWedge < 0.5 ? -1 : 1;
      dir = wedgeDir;
      dx = Math.max(dx, WEDGE_DX_MIN + 0.08 * rMag);
    }
    dx = Math.min(dx, DX_SPEED_MAX * F);
    let nx = x + dir * dx;
    if (nx > X_SAFE) nx = Math.max(-X_SAFE, 2 * X_SAFE - nx);
    else if (nx < -X_SAFE) nx = Math.min(X_SAFE, -2 * X_SAFE - nx);
    if (wedgeDir !== 0 && Math.sign(nx - x) !== wedgeDir) nx = Math.max(-X_SAFE, Math.min(X_SAFE, x + wedgeDir * Math.min(dx, X_SAFE - wedgeDir * x)));
    const moved = nx - x;
    if (Math.abs(moved) > 1e-9) dir = Math.sign(moved);
    // Vertically: a little lower each time (endless) or a step inside the band (arena), within what the flight allows.
    const dmax = maxHeightDifference(F, g);
    let dy: number;
    if (endless) {
      dy = ENDLESS_DROP_MIN + (ENDLESS_DROP_MAX - ENDLESS_DROP_MIN) * rDrop;
      // Straight below: drop past this pad's body so the next one never overlaps it.
      const nextGeoGap = geo.height + 0.012;
      if (Math.abs(moved) < geo.halfWidth + 0.1 && dy < nextGeoGap) dy = nextGeoGap;
    } else {
      dy = (2 * rDrop - 1) * ARENA_STEP;
      if (y + dy > ARENA_BAND || y + dy < -ARENA_BAND) dy = -dy;
      dy = Math.max(-ARENA_BAND - y, Math.min(ARENA_BAND - y, dy));
    }
    dy = Math.max(-dmax, Math.min(dmax, dy));
    plan.g[k] = g;
    plan.contact[k] = contact;
    plan.vx[k] = moved / F;
    plan.vy[k] = takeOffSpeed(dy, F, g);
    plan.facing[k] = kind === "wedge" ? wedgeDir : kind === "spinner" ? (rWedge < 0.5 ? -1 : 1) : 0;
    plan.spinTurns[k] = kind === "spinner" ? 1 + Math.floor(rSpin * 3) : 0;

    // The next landing's obstruction comes in during this flight: its entry (never from the ball's side) and window.
    if (k + 1 < n) {
      allowedEntries(moved, entries);
      plan.entry[k + 1] = entries[Math.floor(rEntry * entries.length) % entries.length];
      plan.entryAcross[k + 1] = moved > 0 ? 1 : moved < 0 ? -1 : rAcross < 0.5 ? -1 : 1;
      const tNext = times[k + 1];
      const settle = Math.min(SETTLE_SEC, SETTLE_FRACTION * T);
      let start = tNext - anticipation * T;
      const end = tNext - settle;
      // Landing higher: the pad comes in only once the ball has risen past its level (never through the ball).
      if (dy < 0) {
        const v = plan.vy[k];
        const disc = v * v + 2 * g * dy;
        const up = disc >= 0 ? (-v - Math.sqrt(disc)) / g : 0;
        if (up > 0) start = Math.max(start, times[k] + contact + up + 0.02 * T);
      }
      start = Math.max(times[k], Math.min(start, end - 0.03));
      plan.arriveStart[k + 1] = start;
      plan.arriveEnd[k + 1] = Math.max(start, end);
      plan.hatAt[k] = T >= MIN_HAT_INTERVAL ? times[k] + T / 2 : NaN;
    } else plan.hatAt[k] = NaN;

    // This pad leaves: it holds while the ball is over it, then slides away from it before the ball could fall back to it;
    // once the ball is clear of it sideways it lingers until the next landing (gone as the ball lands there).
    const v = plan.vy[k];
    const back = contact + (v < 0 ? Math.min(F, (-2 * v) / g) : F);
    const vx = Math.abs(plan.vx[k]);
    const clear = vx > 1e-9 ? contact + (geo.halfWidth + BALL_CLEARANCE) / vx : Infinity;
    const leaveDur = Math.max(0.12, Math.min(0.42, 0.6 * T));
    if (clear < back) {
      plan.leaveStart[k] = times[k] + Math.max(HOLD_MIN_SEC, clear, T - leaveDur);
      plan.leaveEnd[k] = plan.leaveStart[k] + leaveDur;
    } else {
      const latest = times[k] + 0.97 * back;
      const hold = times[k] + Math.min(HOLD_MIN_SEC, 0.4 * back);
      plan.leaveStart[k] = Math.max(hold, latest - leaveDur);
      plan.leaveEnd[k] = Math.max(plan.leaveStart[k] + 1e-3, latest);
    }
    plan.leaveSide[k] = moved > 1e-9 ? -1 : moved < -1e-9 ? 1 : x >= 0 ? 1 : -1;

    x = nx;
    y += dy;
  }

  // The drop-in: from above the top of the view, straight over the first pad (which flies in during it).
  const T0 = times[0];
  plan.startX = plan.x[0];
  plan.startY = plan.y[0] - START_ABOVE;
  plan.startG = flightGravity(g0, T0, 1);
  plan.startVx = 0;
  plan.startVy = takeOffSpeed(START_ABOVE, T0, plan.startG);
  plan.entry[0] = BD_ENTRY_BOTTOM;
  plan.entryAcross[0] = 1;
  plan.arriveEnd[0] = T0 - Math.min(SETTLE_SEC, SETTLE_FRACTION * T0);
  plan.arriveStart[0] = Math.max(0, Math.min(T0 - anticipation * Math.min(T0, period), plan.arriveEnd[0] - 0.03));
  return plan;
}

/* ------------------------------------------------------------------ sampling */

/** Index of the last landing at or before `t` (−1: still dropping in); `hint` (a recent answer) makes a forward scan O(1). */
export function landingIndexAt(plan: BeatDropPlan, t: number, hint = -1): number {
  const n = plan.count;
  if (n === 0 || t < plan.t[0]) return -1;
  let k = hint >= 0 && hint < n && plan.t[hint] <= t ? hint : -1;
  if (k >= 0) {
    while (k + 1 < n && plan.t[k + 1] <= t) k++;
    if (k + 1 >= n || plan.t[k + 1] > t) return k;
  }
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (plan.t[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface BallSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The landing the ball last hit (−1: the drop-in), seconds since that landing (since 0 for the drop-in) and the gravity of the flight. */
  flight: number;
  since: number;
  g: number;
}

export function createBallSample(): BallSample {
  return { x: 0, y: 0, vx: 0, vy: 0, flight: -1, since: 0, g: 0 };
}

/** The ball's centre and velocity at time `t` (view units), exact on the planned arcs. Writes into `out`. */
export function sampleBall(plan: BeatDropPlan, t: number, out: BallSample = createBallSample(), hint = -1): BallSample {
  const k = landingIndexAt(plan, t, hint);
  let x0: number, y0: number, vx: number, vy: number, g: number, t0: number;
  if (k < 0) {
    x0 = plan.startX;
    y0 = plan.startY;
    vx = plan.startVx;
    vy = plan.startVy;
    g = plan.startG;
    t0 = 0;
  } else {
    x0 = plan.x[k];
    y0 = plan.y[k];
    vx = plan.vx[k];
    vy = plan.vy[k];
    g = plan.g[k];
    t0 = plan.t[k] + plan.contact[k];
  }
  out.flight = k;
  out.since = k < 0 ? Math.max(0, t) : t - plan.t[k];
  out.g = g;
  const tau = t - t0;
  if (tau < 0) {
    // Pressed into the pad: resting on the landing point until the flight starts.
    out.x = x0;
    out.y = y0;
    out.vx = 0;
    out.vy = 0;
    return out;
  }
  out.x = x0 + vx * tau;
  out.y = y0 + vy * tau + 0.5 * g * tau * tau;
  out.vx = vx;
  out.vy = vy + g * tau;
  return out;
}

/** The time (s) of the last landing at or before `endSec` (NaN: none). */
export function lastLandingBefore(plan: BeatDropPlan, endSec: number): number {
  const k = landingIndexAt(plan, endSec);
  return k >= 0 ? plan.t[k] : NaN;
}

/* ------------------------------------------------------------------ obstruction poses */

export interface PadPose {
  /** False outside its [arriveStart, leaveEnd] window. */
  visible: boolean;
  /** 0 arriving, 1 resting (waiting for the ball, then holding it), 2 leaving. */
  phase: number;
  /** Offset from the resting spot (view units) and rotation (rad). */
  ox: number;
  oy: number;
  angle: number;
  alpha: number;
  /** Squash on impact (fraction of the pad's height; negative = springing back up). */
  squash: number;
  /** Seconds since its landing (negative before it). */
  age: number;
}

export function createPadPose(): PadPose {
  return { visible: false, phase: 0, ox: 0, oy: 0, angle: 0, alpha: 0, squash: 0, age: 0 };
}

/** The start offset of an entry from its resting spot (view units): off-screen on the entry side. */
export function entryOffset(entry: number, across: number, out: { x: number; y: number }): { x: number; y: number } {
  switch (entry) {
    case BD_ENTRY_LEFT:
      out.x = -ENTRY_DISTANCE;
      out.y = 0;
      break;
    case BD_ENTRY_RIGHT:
      out.x = ENTRY_DISTANCE;
      out.y = 0;
      break;
    case BD_ENTRY_TOP:
      out.x = across * ENTRY_TOP_ACROSS;
      out.y = -ENTRY_DISTANCE;
      break;
    default:
      out.x = 0;
      out.y = ENTRY_DISTANCE;
  }
  return out;
}

const scratchOffset = { x: 0, y: 0 };

/** Where obstruction `k` is at time `t` and how it looks (see PadPose). Writes into `out`; allocation-free. */
export function padPoseAt(plan: BeatDropPlan, k: number, t: number, out: PadPose = createPadPose()): PadPose {
  out.visible = false;
  out.ox = 0;
  out.oy = 0;
  out.angle = 0;
  out.alpha = 0;
  out.squash = 0;
  out.phase = 0;
  if (k < 0 || k >= plan.count) return out;
  const t0 = plan.t[k];
  out.age = t - t0;
  if (t < plan.arriveStart[k] || t > plan.leaveEnd[k]) return out;
  out.visible = true;
  const kind = BEAT_DROP_KINDS[plan.kind[k]] ?? "plank";
  const geo = PAD_GEOMETRY[kind];
  if (t < plan.arriveEnd[k]) {
    // Flying in: an ease-out (with an overshoot for the bouncy kinds), fading in over the first third.
    out.phase = 0;
    const u = progress(plan.arriveStart[k], plan.arriveEnd[k], t);
    const e = geo.bouncy ? easeOutBack(u, 1.2) : easeOutCubic(u);
    entryOffset(plan.entry[k], plan.entryAcross[k], scratchOffset);
    out.ox = scratchOffset.x * (1 - e);
    out.oy = scratchOffset.y * (1 - e);
    out.alpha = Math.min(1, 0.35 + 2 * u);
    if (kind === "spinner") out.angle = (plan.facing[k] || 1) * plan.spinTurns[k] * Math.PI * (1 - easeOutCubic(u));
    else out.angle = (plan.entry[k] === BD_ENTRY_LEFT ? 1 : plan.entry[k] === BD_ENTRY_RIGHT ? -1 : 0) * 0.35 * (1 - easeOutCubic(u));
    return out;
  }
  if (t < plan.leaveStart[k]) {
    out.phase = 1;
    out.alpha = 1;
  } else {
    // Leaving: an ease-in slide away from the ball, tipping over and fading out.
    out.phase = 2;
    const u = progress(plan.leaveStart[k], plan.leaveEnd[k], t);
    const side = plan.leaveSide[k] || 1;
    const e = easeInCubic(u);
    out.ox = side * LEAVE_DISTANCE * e;
    out.oy = 0.12 * easeInQuad(u);
    out.angle = side * 0.4 * e;
    out.alpha = 1 - easeInQuad(u);
  }
  // The give on impact: pressed while the ball is on it, then a damped spring back (a spring pad boings longer).
  if (out.age >= 0) {
    const f = kind === "spring" ? 4.5 : 7;
    const z = kind === "spring" ? 0.16 : 0.32;
    out.squash = geo.squash * impactSquash(out.age, plan.contact[k], f, z);
  }
  return out;
}

/** An impact's squash `age` s after the landing: easing into the press while the ball rests (`contact` s), then a damped spring back. */
export function impactSquash(age: number, contact: number, frequency: number, damping: number): number {
  if (!(age >= 0)) return 0;
  if (contact > 0 && age < contact) return Math.sin((Math.PI / 2) * (age / contact));
  return springDecay(age - Math.max(0, contact), frequency, damping);
}

/**
 * How far (view units) the top of a pad of `kind` dips at its middle for the squash `squash` – the renderer draws the pad
 * with exactly this dip, and the ball resting on it sinks with it (positive = down).
 */
export function padSurfaceDip(kind: BeatDropPadKind, squash: number): number {
  const geo = PAD_GEOMETRY[kind];
  const sq = Math.max(-0.4, Math.min(0.8, squash));
  const h = geo.height;
  switch (kind) {
    case "plank":
      return sq * 0.6 * h + 0.01 * Math.max(0, sq);
    case "block":
      return 0.5 * sq * h;
    case "spring":
      return 0.486 * sq * h;
    case "wedge":
      return 0.15 * sq * h;
    case "spinner":
      return 0.2 * sq * h;
    default:
      return Math.max(0, sq) * 0.6 * 0.018;
  }
}

/* ------------------------------------------------------------------ ball squash and stretch, the camera */

export interface BallDeform {
  /** Impact squash along the vertical: scale y (≤ 1 squashed) and x (≥ 1 spread). */
  squashX: number;
  squashY: number;
  /** Stretch along the flight: the direction (rad) and the factor along it (≥ 1; across it is 1 / √factor). */
  stretchAngle: number;
  stretch: number;
}

export function createBallDeform(): BallDeform {
  return { squashX: 1, squashY: 1, stretchAngle: 0, stretch: 1 };
}

/** Stretch at the reference speed (the landing speed of a flight of one period), and the most it stretches. */
export const STRETCH_PER_SPEED = 0.16;
export const STRETCH_MAX = 1.3;
/** Impact squash of a plain landing (a spring pad squashes more) and its spring. */
export const IMPACT_SQUASH = 0.34;

/**
 * How the ball deforms at time `t`: squashed flat on every impact (a damped spring back to round) and stretched along its
 * flight by its speed – not right after an impact, where the squash wins. Writes into `out`.
 */
export function ballDeformAt(plan: BeatDropPlan, t: number, out: BallDeform = createBallDeform(), ball: BallSample = createBallSample()): BallDeform {
  sampleBall(plan, t, ball);
  const k = ball.flight;
  let squash = 0;
  if (k >= 0) {
    const kind = BEAT_DROP_KINDS[plan.kind[k]] ?? "plank";
    const amount = IMPACT_SQUASH * (kind === "spring" ? 1.3 : kind === "block" || kind === "wedge" ? 0.8 : 1);
    squash = amount * impactSquash(ball.since, plan.contact[k], 6, 0.3);
  }
  out.squashY = 1 - squash;
  out.squashX = 1 + 0.75 * squash;
  const speed = Math.hypot(ball.vx, ball.vy);
  const ref = Math.max(1e-6, (plan.gravity * plan.period) / 2);
  const settle = k >= 0 ? 1 - Math.exp(-Math.max(0, ball.since - plan.contact[k]) / 0.07) : 1;
  out.stretch = Math.min(STRETCH_MAX, 1 + STRETCH_PER_SPEED * (speed / ref) * settle);
  out.stretchAngle = Math.atan2(ball.vy, ball.vx);
  return out;
}

/** Where the camera aims at time `t` (view units, y): gliding from the landing the ball left to the one it is heading for. */
export function cameraTargetAt(plan: BeatDropPlan, t: number, hint = -1): number {
  const n = plan.count;
  if (n === 0) return 0;
  const k = landingIndexAt(plan, t, hint);
  if (k < 0) return plan.y[0];
  if (k + 1 >= n) return plan.y[k];
  const u = progress(plan.t[k], plan.t[k + 1], t);
  return plan.y[k] + (plan.y[k + 1] - plan.y[k]) * smoothstep(u);
}

/** The beat energy at `t`: 1 on a landing, decaying over the interval to the next (for glows). */
export function beatEnergyAt(plan: BeatDropPlan, t: number, hint = -1): number {
  const k = landingIndexAt(plan, t, hint);
  if (k < 0) return 0;
  const T = k + 1 < plan.count ? plan.t[k + 1] - plan.t[k] : plan.period;
  return Math.exp((-3 * (t - plan.t[k])) / Math.max(0.05, T));
}
