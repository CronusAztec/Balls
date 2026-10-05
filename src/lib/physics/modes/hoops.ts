import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { degreeToMidi, scalarDegree, LOOP_SPAN } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- bead-hoops --- Spinning Hoops (mode `hoops`, the bifurcation reel of the loop-clip account's family "beads on spinning
 * hoops"): `count` concentric hoops of radii R₁ > … > Rₙ (evenly spaced from `radiusMax` to `radiusMin`, shares of the half side
 * of the field square, which is one metre) spin together about their vertical diameter at an angular speed ω(t) that ramps up
 * slowly. Every hoop carries one bead that slides on it without friction (a light damping `c` keeps it calm):
 *
 *     θ″ = ω² sin θ cos θ − (g / R) sin(θ − α) − c θ′            (θ: the bead's angle from the bottom of its hoop)
 *
 * With α = 0 this is the textbook θ″ = sin θ (ω² cos θ − g / R) − c θ′: for ω² < g / R the bottom is stable; past the critical
 * speed ω_c = √(g / R) the bottom stops being the lowest place and the bead climbs to θ* = arccos(g / (R ω²)), higher the faster
 * the spin (a pitchfork bifurcation). A bigger hoop has a lower ω_c, so the beads lift one hoop at a time, outermost first.
 * α is the `jitter`: a tiny tilt of the spin axis (the imperfection every real hoop has), on a seeded side, so the symmetric
 * bottom is not a fixed point – the bead creeps to that side as ω nears ω_c and lifts promptly once past it (an imperfect
 * pitchfork), instead of balancing on the unstable bottom forever. With α = 0 it does balance there: an extreme, not a bug.
 *
 * The spin: ω ramps from `omegaStart` to `omegaEnd` turns a second over `rampSec` (linear, eased in and out, or in as many equal
 * steps as there are hoops, each step's riser eased), holds `holdSec` at the top and – with `returnLoop` – ramps back down the
 * same way over `returnSec` (the ramp mirrored, usually quicker than the climb, so the payoff comes late in the loop), then
 * rests `HOOPS_SETTLE_SEC` at the start speed while the beads settle: a seamless cycle. The top hold (or, spinning
 * faster at the start, the rest) is lengthened by less than a turn so a cycle holds a whole number of turns: the hoops face the
 * camera again at the seam, every tick of the cycle repeats, and the last `HOOPS_BRAKE_SEC` before the seam ease every bead onto
 * its exact rest state (the seam brake), so the clip's last frame flows into its first. Without the return the run ends after
 * the top hold (Find Simulation can then search it).
 *
 * Integration: every 60 Hz step integrates each bead's (θ, θ′) with classic RK4 in at least 8 sub-steps (more when the hoops are
 * stiff: a sub-step never spans more than 0.2 rad of the fastest motion, up to 256), ω evaluated at the sub-steps' own times
 * from the closed-form schedule; a bead too stiff for that rests on its equilibrium (degrades gracefully). The schedule's turns
 * are closed-form too (φ = 2π · turns): the canvas draws each hoop face-on, squashed horizontally by |cos φ|, at the frame's
 * exact time. Random draws (ctx.random(), in this order, at init only): the side the axis tilts to, then one factor in
 * [0.9, 1.1] per hoop (outermost first) scaling its tilt – every cycle of a run replays exactly. (A wider spread lets a smaller,
 * faster-reacting hoop overtake its bigger neighbour; ±10 % keeps the default eight in strict size order on every seed.)
 *
 * Events (all `melody: false` loop voices, lib/audio/loopTones.ts through `ToneGenerator.playLoop()`): `spinTick` – a glock chime
 * once a turn, pitched by the spin (degree ⌊speedNorm · 6⌋ of the G major pentatonic from A5: the glock register, A5–A6);
 * `beadLift` – a tuned-bar strike when a bead passes 5° above its bottom while ω > ω_c, pitched by the hoop's size (bigger is
 * lower: the G pentatonic from G3, one degree a hoop, at most `LOOP_SPAN`); `allUp` – the completion chord on G2 when the last
 * bead is up; `beadSettle` – a soft pluck when a bead is back within 5° on the return (ω < ω_c); and the seam's reset glide (G2
 * up to the outer hoop's bar note) under a hard cut of the ringing voices. With `bed` a groove bed (pad and sub on G) enters with
 * the first lift and stops at the reset (or when its switch goes off, or a run without the return ends).
 */

/* ------------------------------------------------------------------ settings */

export const HOOPS_RAMP_SHAPES = ["linear", "ease", "steps"] as const;
export type HoopsRampShape = (typeof HOOPS_RAMP_SHAPES)[number];

export function isHoopsRampShape(value: unknown): value is HoopsRampShape {
  return typeof value === "string" && (HOOPS_RAMP_SHAPES as readonly string[]).includes(value);
}

export interface HoopsSettings {
  /** Hoops (each with one bead), ≥ 1. */
  count: number;
  /** The outer and the inner hoop's radius, shares of the half side of the field square (the half side is one metre). */
  radiusMax: number;
  radiusMin: number;
  /** Gravity (m/s²). */
  gravity: number;
  /** The spin at the start and at the top (turns a second). */
  omegaStart: number;
  omegaEnd: number;
  /** Seconds the ramp up takes, and the return ramp (the same shape, mirrored). */
  rampSec: number;
  returnSec: number;
  rampShape: HoopsRampShape;
  /** The bead's damping c (1/s). */
  damping: number;
  /** Ramp back down and loop (a seamless cycle); off: the run ends after the top hold. */
  returnLoop: boolean;
  /** The spin axis' tilt (rad, the imperfection): the bottom is not a fixed point, the beads climb to a seeded side. */
  jitter: number;
  /** Seconds at the top speed before the return (or the end). */
  holdSec: number;
  /** A glock chime every turn. */
  tick: boolean;
  /** The groove bed (pad and sub) from the first lift to the reset. */
  bed: boolean;
}

export const DEFAULT_HOOPS_SETTINGS: Readonly<HoopsSettings> = {
  count: 8,
  radiusMax: 0.75,
  radiusMin: 0.25,
  gravity: 9.81,
  omegaStart: 0.13,
  omegaEnd: 1.2,
  rampSec: 12,
  returnSec: 6,
  rampShape: "linear",
  damping: 1,
  returnLoop: true,
  jitter: 0.004,
  holdSec: 2,
  tick: true,
  bed: false,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const HOOPS_RANGES = {
  hpCount: { min: 1, max: 16, step: 1 },
  hpRadiusMax: { min: 0.2, max: 1, step: 0.01 },
  hpRadiusMin: { min: 0.2, max: 1, step: 0.01 },
  hpGravity: { min: 1, max: 20, step: 0.01 },
  hpOmegaStart: { min: 0, max: 1, step: 0.01 },
  hpOmegaEnd: { min: 0.5, max: 3, step: 0.01 },
  hpRamp: { min: 5, max: 60, step: 0.5 },
  hpReturnSec: { min: 1, max: 60, step: 0.5 },
  hpDamping: { min: 0, max: 2, step: 0.05 },
  hpJitter: { min: 0, max: 0.01, step: 0.0005 },
  hpHold: { min: 0, max: 10, step: 0.1 },
} as const;

/** A finite number from its slider's minimum up (--- uncap-all --- never a maximum), else the fallback. */
function numberOf(value: unknown, range: { min: number }, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) : fallback;
}

/** Fills in the defaults and validates every value (counts whole, numbers from their minimum up, known shapes, real booleans). */
export function resolveHoopsSettings(config: Partial<Record<keyof HoopsSettings, unknown>> | null | undefined): HoopsSettings {
  const c = config ?? {};
  const d = DEFAULT_HOOPS_SETTINGS;
  const R = HOOPS_RANGES;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    count: Math.round(numberOf(c.count, R.hpCount, d.count)),
    radiusMax: numberOf(c.radiusMax, R.hpRadiusMax, d.radiusMax),
    radiusMin: numberOf(c.radiusMin, R.hpRadiusMin, d.radiusMin),
    gravity: numberOf(c.gravity, R.hpGravity, d.gravity),
    omegaStart: numberOf(c.omegaStart, R.hpOmegaStart, d.omegaStart),
    omegaEnd: numberOf(c.omegaEnd, R.hpOmegaEnd, d.omegaEnd),
    rampSec: numberOf(c.rampSec, R.hpRamp, d.rampSec),
    returnSec: numberOf(c.returnSec, R.hpReturnSec, d.returnSec),
    rampShape: isHoopsRampShape(c.rampShape) ? c.rampShape : d.rampShape,
    damping: numberOf(c.damping, R.hpDamping, d.damping),
    returnLoop: bool(c.returnLoop, d.returnLoop),
    jitter: numberOf(c.jitter, R.hpJitter, d.jitter),
    holdSec: numberOf(c.holdSec, R.hpHold, d.holdSec),
    tick: bool(c.tick, d.tick),
    bed: bool(c.bed, d.bed),
  };
}

/* ------------------------------------------------------------------ constants */

/** A bead is up past this angle (rad) above its bottom: 5°. */
export const HOOPS_LIFT_RAD = (5 * Math.PI) / 180;
/** Seconds the return rests at the start speed before the seam (the beads come to rest). */
export const HOOPS_SETTLE_SEC = 3;
/** The seam brake: the last seconds of a cycle ease every bead onto its exact rest state. */
export const HOOPS_BRAKE_SEC = 1;
/** The reset glide's longest length (s): it ends at the seam. */
export const HOOPS_GLIDE_MAX_SEC = 3;
/** Sub-steps of a 60 Hz step: at least, and at most (a stiffer bead rests on its equilibrium). */
export const HOOPS_MIN_SUBSTEPS = 8;
export const HOOPS_MAX_SUBSTEPS = 256;
/** The largest angle (rad) of the fastest motion one RK4 sub-step may span. */
export const HOOPS_SUBSTEP_SPAN = 0.2;
/** A step's riser (s) of the "steps" ramp (at most a quarter of a step). */
export const HOOPS_RISER_SEC = 0.35;
/** The bead's radius as a share of the half side at the default 8 px Ball Size. */
export const HOOPS_BEAD_UNIT = 0.024;
/** The tuned bars' key: the G major pentatonic from G3 (MIDI 55); the chimes play it from A5 (degree 1 above G5). */
export const HOOPS_BAR_ROOT_MIDI = 55;
export const HOOPS_CHIME_ROOT_MIDI = 79;
/** The chime's pitches: six degrees of the pentatonic from A5 up to A6 (880–1760 Hz, the glock register), a sixth of the spin's range each. */
export const HOOPS_CHIME_LEVELS = 6;
/** The completion chord's and the reset glide's root: G2. */
export const HOOPS_CHORD_HZ = 97.999;
/** The voices' levels: the tick sits well under the bars, a settle's pluck softer than a lift. */
export const HOOPS_TICK_LEVEL = 0.35;
export const HOOPS_SETTLE_LEVEL = 0.55;
export const HOOPS_BED_LEVEL = 0.8;
/** The per-hoop factor of the seeded tilt: drawn in this range (outermost first). */
export const HOOPS_TILT_SPREAD_MIN = 0.9;
export const HOOPS_TILT_SPREAD_MAX = 1.1;
/** A cycle's or a step's time tolerance (ms) on the simulation clock (floating-point steps). */
const TIME_EPS_MS = 1e-6;

/* ------------------------------------------------------------------ geometry and pitch */

/** The hoops' radii (shares of the half side), outermost first, evenly spaced from `radiusMax` to `radiusMin`. */
export function hoopRadii(count: number, radiusMax: number, radiusMin: number, out?: Float64Array): Float64Array {
  const n = Math.max(0, Math.floor(count));
  const radii = out && out.length >= n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) radii[i] = n === 1 ? radiusMax : radiusMax + ((radiusMin - radiusMax) * i) / (n - 1);
  return radii;
}

/** The critical spin (turns a second) of a hoop of radius `radiusM` metres under gravity `g`: ω_c = √(g / R) / 2π. */
export function criticalTurns(g: number, radiusM: number): number {
  return radiusM > 0 && g >= 0 ? Math.sqrt(g / radiusM) / TWO_PI : Infinity;
}

/** The bead's balance angle (rad) above the critical spin: arccos(g / (R ω²)); 0 at or below it (ω in rad/s). */
export function equilibriumAngle(g: number, radiusM: number, omegaRad: number): number {
  const x = g / (radiusM * omegaRad * omegaRad);
  return Number.isFinite(x) && x < 1 ? Math.acos(x) : 0;
}

/** θ″ of a bead (rad/s²): the spin's lift, gravity about the tilted bottom (k = g / R, α the tilt) and the damping. */
export function beadAccel(theta: number, thetaDot: number, omegaRad: number, k: number, tilt: number, damping: number): number {
  return omegaRad * omegaRad * Math.sin(theta) * Math.cos(theta) - k * Math.sin(theta - tilt) - damping * thetaDot;
}

/**
 * The bead's stable rest angle (rad) at a constant spin `omegaRad` (k = g / R, α the tilt, `side` ±1 where it climbs when the
 * tilt is 0): the root of ω² sin θ cos θ = k sin(θ − α) on the bottom's branch below the critical spin, on the tilt's side
 * above it (Newton's method from the small-angle or the arccos guess).
 */
export function beadRest(k: number, omegaRad: number, tilt: number, side: number): number {
  const w2 = omegaRad * omegaRad;
  if (!(k > 0) || !Number.isFinite(k) || !Number.isFinite(w2)) return 0;
  const sign = tilt > 0 ? 1 : tilt < 0 ? -1 : side >= 0 ? 1 : -1;
  let theta = w2 < k ? tilt / (1 - w2 / k) : sign * Math.acos(Math.min(1, k / w2));
  if (!Number.isFinite(theta)) theta = 0;
  if (w2 >= k && tilt === 0 && theta === 0) return 0;
  for (let i = 0; i < 40; i++) {
    const f = w2 * Math.sin(theta) * Math.cos(theta) - k * Math.sin(theta - tilt);
    const df = w2 * Math.cos(2 * theta) - k * Math.cos(theta - tilt);
    if (!(Math.abs(df) > 1e-14)) break;
    const next = theta - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - theta) < 1e-15) {
      theta = next;
      break;
    }
    theta = next;
  }
  return Number.isFinite(theta) && Math.abs(theta) < Math.PI ? theta : 0;
}

/**
 * The pentatonic degree of hoop `index` of `count` (outermost first, radii `radii`): bigger is lower – the outer hoop degree 0,
 * one degree a hoop, the span squeezed into `LOOP_SPAN` degrees past it.
 */
export function hoopDegree(radius: number, minRadius: number, maxRadius: number, count: number): number {
  const span = Math.min(Math.max(0, count - 1), LOOP_SPAN);
  return scalarDegree(radius, minRadius, maxRadius, span, true);
}

/** The bar's pitch (Hz) of a hoop of radius `radius` among radii `minRadius` … `maxRadius` (`count` hoops). */
export function hoopBarFrequency(radius: number, minRadius: number, maxRadius: number, count: number): number {
  return midiToFrequency(degreeToMidi(hoopDegree(radius, minRadius, maxRadius, count), HOOPS_BAR_ROOT_MIDI));
}

/**
 * The spin tick's chime (Hz) at `speedNorm` (0 at the start speed, 1 at the top): degree 1 + ⌊speedNorm · 6⌋ of the pentatonic
 * from G5 – A5, B5, D6, E6, G6, A6.
 */
export function hoopChimeFrequency(speedNorm: number): number {
  const s = Number.isFinite(speedNorm) ? Math.max(0, Math.min(1, speedNorm)) : 0;
  const level = Math.min(HOOPS_CHIME_LEVELS - 1, Math.floor(s * HOOPS_CHIME_LEVELS + 1e-9));
  return midiToFrequency(degreeToMidi(1 + level, HOOPS_CHIME_ROOT_MIDI));
}

/** The rainbow hue (degrees) of hoop `index` of `count`: red outside, violet inside. */
export function hoopHue(index: number, count: number): number {
  return count > 1 ? (275 * index) / (count - 1) : 0;
}

/* ------------------------------------------------------------------ the spin's schedule */

export type HoopsPhase = "up" | "hold" | "down" | "settle" | "done";

/** The spin of a cycle: speeds (turns/s), the phases' lengths (s) and the turns, all from the settings (closed form). */
export interface HoopsSchedule {
  /** Turns a second at the start and at the top. */
  a: number;
  b: number;
  shape: HoopsRampShape;
  /** The "steps" ramp's step count and its riser as a share of the ramp up and of the ramp down. */
  steps: number;
  riser: number;
  riserDown: number;
  /** The phases' lengths (s): the ramp up, the top hold, the ramp down, the rest; the hold or the rest includes the turn alignment. */
  up: number;
  hold: number;
  down: number;
  settle: number;
  /** A cycle's length (s; the run's length without the return) and its turns (whole with the return). */
  cycle: number;
  turns: number;
  /** Turns of the ramp up and of the ramp down. */
  turnsUp: number;
  turnsDown: number;
  loop: boolean;
}

/** The smoothstep ease of a riser (0–1 → 0–1) and its integral from 0. */
function smoothstep(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}
function smoothstepIntegral(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * c - 0.5 * c * c * c * c + (x > 1 ? x - 1 : 0);
}

/** The cubic ease in-out (0–1) and its integral from 0 (0.5 at 1). */
function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
function easeIntegral(p: number): number {
  if (p <= 0) return 0;
  if (p <= 0.5) return p * p * p * p;
  if (p >= 1) return 0.5 + (p - 1);
  return 0.0625 + (p - 0.5) - (1 - Math.pow(2 - 2 * p, 4)) / 16;
}

/**
 * The share (0–1) of the way from the start speed to the top speed at share `p` of the ramp: linear, eased in and out, or
 * `steps` equal steps – step k's riser (a smoothstep of `riser` of the ramp) ends at k / steps, so the ramp reaches the top
 * exactly at its end.
 */
export function rampShare(shape: HoopsRampShape, p: number, steps: number, riser: number): number {
  const x = p <= 0 ? 0 : p >= 1 ? 1 : p;
  if (shape === "ease") return easeInOut(x);
  if (shape !== "steps" || steps < 1) return x;
  const m = x * steps;
  const done = Math.min(steps, Math.floor(m + 1e-12));
  if (done >= steps) return 1;
  const wn = riser * steps;
  const start = done + 1 - wn;
  const partial = m > start && wn > 0 ? smoothstep((m - start) / wn) : 0;
  return (done + partial) / steps;
}

/** ∫₀ᵖ rampShare(q) dq (closed form; past p = 1 the top speed: + (p − 1)). */
export function rampShareIntegral(shape: HoopsRampShape, p: number, steps: number, riser: number): number {
  if (p <= 0) return 0;
  const x = p >= 1 ? 1 : p;
  const tail = p > 1 ? p - 1 : 0;
  if (shape === "ease") return easeIntegral(x) + tail;
  if (shape !== "steps" || steps < 1) return 0.5 * x * x + tail;
  const n = steps;
  const m = x * n;
  const done = Math.min(n, Math.floor(m + 1e-12));
  // completed risers k = 1 … done: each a riser's area w/2 then the plateau to x
  let area = done * (riser / 2) + done * x - (done * (done + 1)) / (2 * n);
  if (done < n && riser > 0) {
    const s = (done + 1) / n - riser;
    if (x > s) area += riser * smoothstepIntegral((x - s) / riser);
  }
  return area / n + tail;
}

/** A step's riser as a share of a ramp of `rampSec` (HOOPS_RISER_SEC, at most a quarter of a step). */
function riserOf(rampSec: number, steps: number): number {
  return rampSec > 0 ? Math.min(0.25 / Math.max(1, steps), HOOPS_RISER_SEC / rampSec) : 0;
}

/** The schedule of `settings` (a cycle with the return, the run without it). */
export function hoopsSchedule(settings: HoopsSettings): HoopsSchedule {
  const a = Math.max(0, settings.omegaStart);
  const b = Math.max(0, settings.omegaEnd);
  const up = Math.max(0, settings.rampSec);
  const steps = Math.max(1, Math.floor(settings.count));
  const riser = riserOf(up, steps);
  const shape = settings.rampShape;
  const turnsUp = up > 0 ? a * up + (b - a) * up * rampShareIntegral(shape, 1, steps, riser) : 0;
  let hold = Math.max(0, settings.holdSec);
  let settle = HOOPS_SETTLE_SEC;
  const loop = settings.returnLoop;
  const down = loop ? Math.max(0, settings.returnSec) : 0;
  const turnsDown = down > 0 ? a * down + (b - a) * down * rampShareIntegral(shape, 1, steps, riserOf(down, steps)) : 0;
  if (!loop) {
    const turns = turnsUp + b * hold;
    return { a, b, shape, steps, riser, riserDown: 0, up, hold, down: 0, settle: 0, cycle: up + hold, turns, turnsUp, turnsDown: 0, loop };
  }
  // a whole number of turns a cycle: the faster of the top hold and the rest absorbs the shortfall (less than a turn)
  const raw = turnsUp + turnsDown + b * hold + a * settle;
  const whole = Math.ceil(raw - 1e-9);
  const short = whole - raw;
  if (short > 1e-12) {
    if (b >= a && b > 0) hold += short / b;
    else if (a > 0) settle += short / a;
  }
  const turns = turnsUp + turnsDown + b * hold + a * settle;
  return { a, b, shape, steps, riser, riserDown: riserOf(down, steps), up, hold, down, settle, cycle: up + hold + down + settle, turns: b > 0 || a > 0 ? Math.round(turns) : 0, turnsUp, turnsDown, loop };
}

/** The ramp up's speed (turns/s) `s` seconds in. */
function upSpeed(sc: HoopsSchedule, s: number): number {
  if (!(sc.up > 0)) return sc.b;
  return sc.a + (sc.b - sc.a) * rampShare(sc.shape, s / sc.up, sc.steps, sc.riser);
}

/** The ramp up's turns `s` seconds in. */
function upTurns(sc: HoopsSchedule, s: number): number {
  if (!(sc.up > 0) || s <= 0) return 0;
  const x = s >= sc.up ? sc.up : s;
  return sc.a * x + (sc.b - sc.a) * sc.up * rampShareIntegral(sc.shape, x / sc.up, sc.steps, sc.riser);
}

/** The ramp down's speed (turns/s) `s` seconds in: the ramp up's shape mirrored over the return's length. */
function downSpeed(sc: HoopsSchedule, s: number): number {
  if (!(sc.down > 0)) return sc.a;
  return sc.a + (sc.b - sc.a) * rampShare(sc.shape, 1 - s / sc.down, sc.steps, sc.riserDown);
}

/** The ramp down's turns `s` seconds in (∫ of the mirrored ramp: its integral from 1 − s / down to 1). */
function downTurns(sc: HoopsSchedule, s: number): number {
  if (!(sc.down > 0) || s <= 0) return 0;
  const x = s >= sc.down ? sc.down : s;
  const full = rampShareIntegral(sc.shape, 1, sc.steps, sc.riserDown);
  return sc.a * x + (sc.b - sc.a) * sc.down * (full - rampShareIntegral(sc.shape, 1 - x / sc.down, sc.steps, sc.riserDown));
}

/** The phase at cycle time `tau` (s). */
export function schedulePhase(sc: HoopsSchedule, tau: number): HoopsPhase {
  if (tau < sc.up) return "up";
  if (tau < sc.up + sc.hold) return "hold";
  if (!sc.loop) return "done";
  if (tau < sc.up + sc.hold + sc.down) return "down";
  return "settle";
}

/** The spin (turns a second) at cycle time `tau` (s): the ramp up, the top hold, the mirrored ramp down, the rest. */
export function scheduleSpeed(sc: HoopsSchedule, tau: number): number {
  const t = tau > 0 ? tau : 0;
  if (t < sc.up) return upSpeed(sc, t);
  const top = sc.up + sc.hold;
  if (t < top || !sc.loop) return sc.b;
  if (t < top + sc.down) return downSpeed(sc, t - top);
  return sc.a;
}

/** The turns since the cycle's start at cycle time `tau` (s); the cycle's end is a whole number of turns. */
export function scheduleTurns(sc: HoopsSchedule, tau: number): number {
  const t = tau > 0 ? tau : 0;
  if (t <= sc.up) return upTurns(sc, t);
  const top = sc.up + sc.hold;
  if (t <= top || !sc.loop) return sc.turnsUp + sc.b * (t - sc.up);
  const atTop = sc.turnsUp + sc.b * sc.hold;
  if (t <= top + sc.down) return atTop + downTurns(sc, t - top);
  return atTop + sc.turnsDown + sc.a * (Math.min(t, sc.cycle) - top - sc.down) + (t > sc.cycle ? sc.a * (t - sc.cycle) : 0);
}

/** Where `speed` (turns/s) lies between the schedule's slowest and fastest spin (0–1; 0 without a range): the chime's pitch. */
export function speedShare(sc: Pick<HoopsSchedule, "a" | "b">, speed: number): number {
  const lo = Math.min(sc.a, sc.b);
  const hi = Math.max(sc.a, sc.b);
  return hi > lo && Number.isFinite(speed) ? Math.max(0, Math.min(1, (speed - lo) / (hi - lo))) : 0;
}

/** The fastest rate (1/s) of a run's motion: the stiffest hoop's √(g / R), the fastest spin (rad/s) or the damping. */
export function hoopsRate(maxK: number, maxTurns: number, damping: number): number {
  const rate = Math.max(Math.sqrt(Math.max(0, maxK)), TWO_PI * Math.max(0, maxTurns), Math.max(0, damping));
  return Number.isFinite(rate) ? rate : Infinity;
}

/**
 * How many RK4 sub-steps a stretch of `spanSec` of simulation time takes at `rate`: at least HOOPS_MIN_SUBSTEPS a 60 Hz step,
 * enough that a sub-step spans at most HOOPS_SUBSTEP_SPAN rad of the fastest motion, at most HOOPS_MAX_SUBSTEPS a 60 Hz step
 * (a stiffer bead rests on its balance point). It depends on the simulation time alone, never on the frame rate.
 */
export function hoopsSubsteps(spanSec: number, rate: number): number {
  if (!(spanSec > 0)) return 1;
  const steps = spanSec * 60;
  const least = Math.ceil(HOOPS_MIN_SUBSTEPS * steps - 1e-9);
  const most = Math.max(1, Math.ceil(HOOPS_MAX_SUBSTEPS * steps - 1e-9));
  const need = Number.isFinite(rate) ? Math.ceil((spanSec * rate) / HOOPS_SUBSTEP_SPAN - 1e-9) : most;
  return Math.max(1, Math.min(most, Math.max(least, need)));
}

/** One classic RK4 step of a bead over `h` seconds, ω at its start, middle and end (rad/s); writes θ and θ′ into `out`. */
export function beadRk4(theta: number, dot: number, h: number, w0: number, wm: number, w1: number, k: number, tilt: number, damping: number, out: { theta: number; dot: number }) {
  const k1x = dot;
  const k1v = beadAccel(theta, dot, w0, k, tilt, damping);
  const k2x = dot + 0.5 * h * k1v;
  const k2v = beadAccel(theta + 0.5 * h * k1x, dot + 0.5 * h * k1v, wm, k, tilt, damping);
  const k3x = dot + 0.5 * h * k2v;
  const k3v = beadAccel(theta + 0.5 * h * k2x, dot + 0.5 * h * k2v, wm, k, tilt, damping);
  const k4x = dot + h * k3v;
  const k4v = beadAccel(theta + h * k3x, dot + h * k3v, w1, k, tilt, damping);
  out.theta = theta + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
  out.dot = dot + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  return out;
}

/* ------------------------------------------------------------------ the mode */

/** What the canvas, the HUD, the finder and the smoke test read of a run (the same object every call; arrays live with the mode). */
export interface HoopsView {
  /** The running settings (applied by `init()`) and their schedule. */
  settings: HoopsSettings;
  schedule: HoopsSchedule;
  /** Hoops built (the memory ceiling applied). */
  count: number;
  /** The field: the hoops' centre and the half side of the square (world px). */
  cx: number;
  cy: number;
  half: number;
  /** Per hoop (outermost first): radius (px and metres), critical spin (turns/s), tilt (rad), rest angle at the start speed. */
  radiusPx: Float64Array;
  radiusM: Float64Array;
  critical: Float64Array;
  tilt: Float64Array;
  rest: Float64Array;
  /** Per bead: its angle from the bottom at the latest step's end and at the one before (rad), its speed (rad/s), up or not. */
  theta: Float64Array;
  thetaPrev: Float64Array;
  thetaDot: Float64Array;
  up: Uint8Array;
  /** The bead's radius (world px). */
  beadRadius: number;
  /** The side the axis tilts to (±1). */
  side: number;
  /** The latest step's end and length (simulation ms). */
  timeMs: number;
  stepMs: number;
  /** The current cycle's start (simulation ms), its index (0 = the first) and the seams so far. */
  cycleStartMs: number;
  cycleIndex: number;
  seams: number;
  lastSeamMs: number;
  phase: HoopsPhase;
  /** The spin at the latest step's end (turns a second) and its share of the way from the start speed to the top (0–1). */
  omega: number;
  speedNorm: number;
  /** Beads up now; lifts, settles and spin ticks so far (the run); lifts of the current cycle in order (hoop indices). */
  upCount: number;
  lifts: number;
  settles: number;
  ticks: number;
  liftOrder: number[];
  /** The first cycle's lifts: in strict size order so far, how many, and whether that is decided (all up, broken, or its ramp passed). */
  orderOk: boolean;
  firstLifts: number;
  orderDecided: boolean;
  /** Simulation ms all beads were first up (−1 before), and how often all were up (once a cycle at most). */
  firstAllUpMs: number;
  allUps: number;
  /** The run ended (no return: after the top hold). */
  finished: boolean;
  /** Incremented by every init (a new run). */
  generation: number;
}

const RK_OUT = { theta: 0, dot: 0 };

export class HoopsMode implements GameMode {
  readonly name = "hoops";
  /** The beads are placed by the mode: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: HoopsSettings = { ...DEFAULT_HOOPS_SETTINGS };
  private k = new Float64Array(0);
  private hoopFactor = new Float64Array(0);
  private liftedThisCycle = new Uint8Array(0);
  private firstBallId = -1;
  private lastBallRadius = 0;
  private bedOn = false;
  /** The bed was switched off while it played: its stop goes out with the next step's sounds. */
  private bedStopPending = false;
  /** The run's fastest rate (1/s: the sub-steps) and its smallest and biggest hoop (m: the bars' pitches). */
  private rate = 0;
  private minR = 0;
  private maxR = 0;
  private readonly view: HoopsView = {
    settings: { ...DEFAULT_HOOPS_SETTINGS },
    schedule: hoopsSchedule(DEFAULT_HOOPS_SETTINGS),
    count: 0,
    cx: 0,
    cy: 0,
    half: 0,
    radiusPx: new Float64Array(0),
    radiusM: new Float64Array(0),
    critical: new Float64Array(0),
    tilt: new Float64Array(0),
    rest: new Float64Array(0),
    theta: new Float64Array(0),
    thetaPrev: new Float64Array(0),
    thetaDot: new Float64Array(0),
    up: new Uint8Array(0),
    beadRadius: 0,
    side: 1,
    timeMs: 0,
    stepMs: 1000 / 60,
    cycleStartMs: 0,
    cycleIndex: 0,
    seams: 0,
    lastSeamMs: -1,
    phase: "up",
    omega: 0,
    speedNorm: 0,
    upCount: 0,
    lifts: 0,
    settles: 0,
    ticks: 0,
    liftOrder: [],
    orderOk: true,
    firstLifts: 0,
    orderDecided: false,
    firstAllUpMs: -1,
    allUps: 0,
    finished: false,
    generation: 0,
  };

  getSettings(): HoopsSettings {
    return { ...this.settings };
  }
  /** Applied on the next init (the page re-inits the mode when a hoops setting changes); the sound switches follow at once. */
  setSettings(patch: Partial<HoopsSettings>) {
    this.settings = resolveHoopsSettings({ ...this.settings, ...patch });
    this.view.settings.tick = this.settings.tick;
    this.view.settings.bed = this.settings.bed;
    // a bed switched off mid-run stops at once (one switched on enters with the next lift)
    if (!this.settings.bed && this.bedOn) this.bedStopPending = true;
  }
  /** Live state for the canvas, the HUD, the finder and the smoke test; the same object every call. */
  getView(): HoopsView {
    return this.view;
  }

  private ensureArrays(n: number) {
    const v = this.view;
    if (v.theta.length >= n) return;
    v.radiusPx = new Float64Array(n);
    v.radiusM = new Float64Array(n);
    v.critical = new Float64Array(n);
    v.tilt = new Float64Array(n);
    v.rest = new Float64Array(n);
    v.theta = new Float64Array(n);
    v.thetaPrev = new Float64Array(n);
    v.thetaDot = new Float64Array(n);
    v.up = new Uint8Array(n);
    this.k = new Float64Array(n);
    this.hoopFactor = new Float64Array(n);
    this.liftedThisCycle = new Uint8Array(n);
  }

  /** The field square (centred, its half side) and the beads' size from the canvas and the Ball Size. */
  private layout(ctx: ModeContext) {
    const v = this.view;
    const w = ctx.config.width;
    const h = ctx.config.height;
    v.cx = w / 2;
    v.cy = h / 2;
    v.half = Math.max(10, Math.min(w, h) / 2);
    const ball = ctx.config.ballRadius || 8;
    this.lastBallRadius = ball;
    v.beadRadius = Math.max(0.5, HOOPS_BEAD_UNIT * v.half * (ball / 8));
    const radii = hoopRadii(v.count, this.settings.radiusMax, this.settings.radiusMin);
    for (let i = 0; i < v.count; i++) v.radiusPx[i] = radii[i] * v.half;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    v.schedule = hoopsSchedule(s);
    const n = Math.max(1, memoryCeiling("hpCount", s.count));
    this.ensureArrays(n);
    v.count = n;
    this.layout(ctx);
    const radii = hoopRadii(n, s.radiusMax, s.radiusMin);
    let maxK = 0;
    this.minR = Infinity;
    this.maxR = 0;
    for (let i = 0; i < n; i++) {
      v.radiusM[i] = Math.max(1e-9, radii[i]);
      this.k[i] = s.gravity / v.radiusM[i];
      if (this.k[i] > maxK) maxK = this.k[i];
      if (v.radiusM[i] < this.minR) this.minR = v.radiusM[i];
      if (v.radiusM[i] > this.maxR) this.maxR = v.radiusM[i];
      v.critical[i] = criticalTurns(s.gravity, v.radiusM[i]);
    }
    this.rate = hoopsRate(maxK, Math.max(s.omegaStart, s.omegaEnd), s.damping);
    // The only random decisions, in this order: the side the spin axis tilts to, then each hoop's tilt factor (outermost first).
    v.side = ctx.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) this.hoopFactor[i] = HOOPS_TILT_SPREAD_MIN + (HOOPS_TILT_SPREAD_MAX - HOOPS_TILT_SPREAD_MIN) * ctx.random();
    const w0 = TWO_PI * v.schedule.a;
    for (let i = 0; i < n; i++) {
      v.tilt[i] = v.side * s.jitter * this.hoopFactor[i];
      v.rest[i] = beadRest(this.k[i], w0, v.tilt[i], v.side);
    }
    v.timeMs = 0;
    v.stepMs = 1000 / 60;
    v.cycleStartMs = 0;
    v.cycleIndex = 0;
    v.seams = 0;
    v.lastSeamMs = -1;
    v.lifts = 0;
    v.settles = 0;
    v.ticks = 0;
    v.orderOk = true;
    v.firstLifts = 0;
    v.orderDecided = false;
    v.firstAllUpMs = -1;
    v.allUps = 0;
    v.finished = false;
    v.generation++;
    this.resetBeads();
    this.updateSpin(0);
    // one engine ball per bead (rainbow by hoop), where the bead sits
    this.firstBallId = -1;
    const base = ctx.config.ballRadius || 8;
    for (let i = 0; i < n; i++) {
      ctx.addBall({ x: v.cx + v.radiusPx[i] * Math.sin(v.theta[i]), y: v.cy + v.radiusPx[i] * Math.cos(v.theta[i]), vx: 0, vy: 0, radius: v.beadRadius, color: `hsl(${Math.round(hoopHue(i, n))}, 92%, 62%)`, gravityScale: 0, radiusScale: v.beadRadius / base });
      if (i === 0) this.firstBallId = ctx.getNextId() - 1;
    }
  }

  /** Every bead back on its rest state at the start speed (a run's start and every seam): no lift of this cycle yet. */
  private resetBeads() {
    const v = this.view;
    const w0 = TWO_PI * v.schedule.a;
    let upCount = 0;
    for (let i = 0; i < v.count; i++) {
      v.theta[i] = v.rest[i];
      v.thetaPrev[i] = v.rest[i];
      v.thetaDot[i] = 0;
      // a hoop already past its critical spin at the start begins up (its bead on its balance point): no lift event
      const up = w0 * w0 > this.k[i] && Math.abs(v.rest[i]) >= HOOPS_LIFT_RAD ? 1 : 0;
      v.up[i] = up;
      this.liftedThisCycle[i] = up;
      upCount += up;
    }
    v.upCount = upCount;
    v.liftOrder.length = 0;
    this.bedOn = false;
    this.bedStopPending = false;
  }

  /** The view's spin at cycle time `tau` (s). */
  private updateSpin(tau: number) {
    const v = this.view;
    const sc = v.schedule;
    v.omega = scheduleSpeed(sc, tau);
    v.speedNorm = speedShare(sc, v.omega);
    v.phase = v.finished ? "done" : schedulePhase(sc, tau);
  }

  /** A live Ball Size or canvas change re-sizes the beads and the hoops (the physics is in metres: nothing else changes). */
  private refit(ctx: ModeContext) {
    const v = this.view;
    this.layout(ctx);
    const base = ctx.config.ballRadius || 8;
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.firstBallId;
      if (i < 0 || i >= v.count) continue;
      ball.radius = v.beadRadius;
      ball.radiusScale = v.beadRadius / base;
    }
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    if (this.bedStopPending) {
      this.bedStopPending = false;
      if (this.bedOn) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
      this.bedOn = false;
    }
    if ((ctx.config.ballRadius || 8) !== this.lastBallRadius) this.refit(ctx);
    v.stepMs = dtMs > 0 ? dtMs : v.stepMs;
    const end = ctx.getElapsedMs();
    for (let i = 0; i < v.count; i++) v.thetaPrev[i] = v.theta[i];
    if (v.finished) {
      v.timeMs = end;
      return;
    }
    let t = end - dtMs;
    const sc = v.schedule;
    // a step may cross the seam: integrate up to it, start the next cycle there, integrate the rest
    while (t < end - TIME_EPS_MS) {
      const seamMs = v.cycleStartMs + 1000 * sc.cycle;
      const segEnd = sc.loop && seamMs < end ? Math.max(t, seamMs) : end;
      if (segEnd > t) this.integrate(ctx, t, segEnd);
      t = segEnd;
      if (sc.loop && t >= seamMs - TIME_EPS_MS && t < end + TIME_EPS_MS && seamMs <= end + TIME_EPS_MS) {
        this.seam(ctx, seamMs);
        if (!(sc.cycle > 0)) break;
      } else if (segEnd >= end) break;
    }
    const tau = (end - v.cycleStartMs) / 1000;
    if (!sc.loop && tau >= sc.cycle - TIME_EPS_MS / 1000) {
      v.finished = true;
      if (!v.orderDecided) v.orderDecided = true;
      // the bed stops with the run (without the return there is no reset to stop it)
      if (this.bedOn) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
      this.bedOn = false;
    }
    v.timeMs = end;
    this.updateSpin(tau);
  }

  /** Integrates every bead from `t0` to `t1` (simulation ms, inside one cycle), then plays the events the stretch held. */
  private integrate(ctx: ModeContext, t0: number, t1: number) {
    const v = this.view;
    const sc = v.schedule;
    const s = this.settings;
    const span = t1 - t0;
    const subs = hoopsSubsteps(span / 1000, this.rate);
    const hMs = span / subs;
    const c = s.damping;
    const seamMs = v.cycleStartMs + 1000 * sc.cycle;
    const brakeMs = 1000 * Math.min(HOOPS_BRAKE_SEC, sc.settle);
    for (let sub = 0; sub < subs; sub++) {
      const ta = t0 + sub * hMs;
      const tb = sub === subs - 1 ? t1 : ta + hMs;
      const tauA = (ta - v.cycleStartMs) / 1000;
      const tauB = (tb - v.cycleStartMs) / 1000;
      const w0 = TWO_PI * scheduleSpeed(sc, tauA);
      const wm = TWO_PI * scheduleSpeed(sc, 0.5 * (tauA + tauB));
      const w1 = TWO_PI * scheduleSpeed(sc, tauB);
      const step = (tb - ta) / 1000;
      // the seam brake: the last stretch before the seam eases every bead onto its rest state (exactly there at the seam)
      const braking = sc.loop && brakeMs > 0 && tb > seamMs - brakeMs;
      const keep = braking ? Math.max(0, seamMs - tb) / Math.max(1e-9, seamMs - Math.max(ta, seamMs - brakeMs)) : 1;
      for (let i = 0; i < v.count; i++) {
        beadRk4(v.theta[i], v.thetaDot[i], step, w0, wm, w1, this.k[i], v.tilt[i], c, RK_OUT);
        let th = RK_OUT.theta;
        let dot = RK_OUT.dot;
        // a bead too stiff for the sub-steps (or past any number) rests on its balance point at this spin: degrade, never blow up
        if (!Number.isFinite(th) || !Number.isFinite(dot) || Math.abs(th) > 1e6) {
          th = beadRest(this.k[i], w1, v.tilt[i], v.side);
          dot = 0;
        }
        if (braking) {
          th = v.rest[i] + (th - v.rest[i]) * keep;
          dot *= keep;
        }
        v.theta[i] = th;
        v.thetaDot[i] = dot;
      }
    }
    this.events(ctx, t0, t1);
  }

  /** The events of the stretch `t0` … `t1` (simulation ms) of the current cycle: ticks, lifts, settles, all up, the reset's sounds. */
  private events(ctx: ModeContext, t0: number, t1: number) {
    const v = this.view;
    const sc = v.schedule;
    const s = this.settings;
    const tau0 = (t0 - v.cycleStartMs) / 1000;
    const tau1 = (t1 - v.cycleStartMs) / 1000;
    // the spin tick: once a turn, its chime pitched by the spin – on every whole turn the stretch [tau0, tau1) starts, the
    // cycle's start included and its end left to the next cycle's start, so a looped clip ticks every turn across the seam
    const turns = Math.ceil(scheduleTurns(sc, tau1) - 1e-7) - Math.ceil(scheduleTurns(sc, tau0) - 1e-7);
    if (turns > 0) {
      v.ticks += turns;
      if (s.tick) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chime", frequency: hoopChimeFrequency(speedShare(sc, scheduleSpeed(sc, tau1))), level: HOOPS_TICK_LEVEL, melody: false });
    }
    // the reset: a hard cut of the ringing voices and a glide from G2 up to the outer hoop's bar note, ending at the seam
    if (sc.loop) {
      const glide = Math.min(HOOPS_GLIDE_MAX_SEC, sc.settle);
      const at = sc.cycle - glide;
      if (glide > 0 && tau0 < at - 1e-9 && tau1 >= at - 1e-9) {
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "cut", melody: false });
        if (this.bedOn) {
          ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
          this.bedOn = false;
        }
        const first = v.count > 0 ? hoopBarFrequency(v.radiusM[0], this.minR, this.maxR, v.count) : HOOPS_CHORD_HZ * 2;
        // (played at the end of this stretch: it lasts what is left of the cycle, so it fades out exactly at the seam)
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "glide", frequency: HOOPS_CHORD_HZ, loopTo: first, loopSec: Math.max(0.05, sc.cycle - tau1), melody: false });
      }
    }
    // lifts and settles at the stretch's end
    const w = TWO_PI * scheduleSpeed(sc, tau1);
    const w2 = w * w;
    const minR = this.minR;
    const maxR = this.maxR;
    for (let i = 0; i < v.count; i++) {
      const k = this.k[i];
      const th = v.theta[i];
      if (!v.up[i]) {
        if (w2 > k && Math.abs(th) >= HOOPS_LIFT_RAD) this.lift(ctx, i, t1, minR, maxR);
      } else if (w2 < k) {
        const dot = v.thetaDot[i];
        const amp2 = th * th + (dot * dot) / (k - w2);
        if (amp2 < HOOPS_LIFT_RAD * HOOPS_LIFT_RAD) this.settle(ctx, i, minR, maxR);
      }
    }
    // the first cycle's lift order is decided once its ramp has come back down (no new lift can come any more)
    if (v.cycleIndex === 0 && !v.orderDecided && (sc.loop ? tau1 >= sc.up + sc.hold + sc.down : false)) v.orderDecided = true;
  }

  /** The engine ball of bead `i` (null when gone). */
  private ballOf(ctx: ModeContext, i: number): Ball | null {
    const id = this.firstBallId + i;
    for (const ball of ctx.getBalls()) if (ball.id === id) return ball;
    return null;
  }

  /** Bead `i` lifted at `atMs`: the bar strike, the order check, the bed's entry and – the last one up – the completion chord. */
  private lift(ctx: ModeContext, i: number, atMs: number, minR: number, maxR: number) {
    const v = this.view;
    v.up[i] = 1;
    v.upCount++;
    v.lifts++;
    // strict size order: every bigger hoop's bead lifted before this one in this cycle
    if (v.cycleIndex === 0) {
      for (let j = 0; j < v.count; j++) {
        if (j !== i && v.radiusM[j] > v.radiusM[i] + 1e-12 && !this.liftedThisCycle[j]) v.orderOk = false;
      }
      v.firstLifts++;
    }
    this.liftedThisCycle[i] = 1;
    if (v.liftOrder.length < 4096) v.liftOrder.push(i);
    const ball = this.ballOf(ctx, i);
    if (ball) ctx.noteBounce?.(ball); // --- bounce-math --- a bead's lift (its note) counts as its bounce
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: i, loop: "bar", frequency: hoopBarFrequency(v.radiusM[i], minR, maxR, v.count), level: 1, melody: false });
    if (this.settings.bed && !this.bedOn) {
      this.bedOn = true;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bed", frequency: HOOPS_CHORD_HZ, level: HOOPS_BED_LEVEL, melody: false });
    }
    if (v.upCount >= v.count) {
      v.allUps++;
      if (v.firstAllUpMs < 0) v.firstAllUpMs = atMs;
      if (v.cycleIndex === 0) v.orderDecided = true;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: HOOPS_CHORD_HZ, level: 1, melody: false });
    }
    if (v.cycleIndex === 0 && !v.orderOk) v.orderDecided = true;
  }

  /** Bead `i` is back at its bottom on the return: a soft pluck an octave under its bar. */
  private settle(ctx: ModeContext, i: number, minR: number, maxR: number) {
    const v = this.view;
    v.up[i] = 0;
    v.upCount = Math.max(0, v.upCount - 1);
    v.settles++;
    const ball = this.ballOf(ctx, i);
    if (ball) ctx.noteBounce?.(ball); // --- bounce-math --- (the bead's settle note)
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: i, loop: "pluck", frequency: hoopBarFrequency(v.radiusM[i], minR, maxR, v.count) / 2, level: HOOPS_SETTLE_LEVEL, melody: false });
  }

  /** The seam at `atMs`: the beads back on their rest state (the brake already put them there), a new cycle from the start speed. */
  private seam(ctx: ModeContext, atMs: number) {
    const v = this.view;
    if (v.cycleIndex === 0) v.orderDecided = true;
    if (this.bedOn) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
    v.seams++;
    v.lastSeamMs = atMs;
    v.cycleStartMs = atMs;
    v.cycleIndex++;
    this.resetBeads();
    for (let i = 0; i < v.count; i++) v.thetaPrev[i] = v.theta[i];
  }

  /** The engine moved the bead by its velocity (zero): put it where its hoop and angle say, at the latest step's spin. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    const v = this.view;
    const i = ball.id - this.firstBallId;
    ball.vx = 0;
    ball.vy = 0;
    if (i < 0 || i >= v.count) return;
    const phi = TWO_PI * scheduleTurns(v.schedule, (v.timeMs - v.cycleStartMs) / 1000);
    const r = v.radiusPx[i];
    ball.x = v.cx + r * Math.sin(v.theta[i]) * Math.cos(phi);
    ball.y = v.cy + r * Math.cos(v.theta[i]);
  }

  onPostSubStep() {}
  onWallHit() {}
  onGapPass() {
    return true;
  }
  onPostUpdate() {}
  /** A canvas resize re-lays the hoops out (their physics is in metres: the run goes on as it was). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) this.refit(ctx);
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  // --- loop-foundation --- the loop contract: with the return a cycle of fixed length, its seams on the simulation clock
  cycleSeconds(): number | null {
    const sc = this.view.schedule;
    return sc.loop && sc.cycle > 0 ? sc.cycle : null;
  }
  loopSeams(): LoopSeams | null {
    const v = this.view;
    const sc = v.schedule;
    if (!sc.loop || !(sc.cycle > 0)) return null;
    return { count: v.seams, lastMs: v.seams > 0 ? v.lastSeamMs : -1, nextMs: v.cycleStartMs + 1000 * sc.cycle };
  }
  getState() {
    const v = this.view;
    return { count: v.count, upCount: v.upCount, lifts: v.lifts, settles: v.settles, ticks: v.ticks, seams: v.seams, omega: v.omega, finished: v.finished };
  }
}

/** The SoundEvent kinds a run plays (for tools and tests): the loop voices of the family. */
export const HOOPS_SOUND_KINDS: readonly NonNullable<SoundEvent["loop"]>[] = ["chime", "bar", "chord", "pluck", "cut", "glide", "bed", "bedStop"];
