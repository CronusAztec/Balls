import type { LoopSeams, ModeContext, SoundEvent } from "./types";
import { midiToFrequency } from "@/lib/audio/scales";
import { degreeToMidi, scalarDegree } from "@/lib/audio/loopPitch";
import { atLeastMin } from "@/lib/uncap";

/*
 * --- chaos-fan --- The Double Pendulum's chaos fan (the loop-clip account's "200 pendulums, a hair apart" reel, rebuilt from
 * the poster and the caption): hundreds of double pendulums share one pivot and start a hair apart – their last rods spread
 * over a total of `spreadDeg` degrees (a thousandth by default) – so they swing as one thin line for a few seconds, then the
 * differences, doubling every fraction of a second, burst them into a rainbow fan. With the palindrome on, the first
 * `forwardSec` seconds are recorded (`FanTape`) and played back backwards for as long, so every pendulum retraces its path home
 * and the clip loops on a seam: the run's start, restored exactly. Reversing works only because the way out was recorded –
 * integrating backwards from the end would amplify the rounding errors just as the way out amplified the hair.
 *
 * The pendulums are stepped together in a struct-of-arrays batch (`FanBatch`: one Float64Array per variable, classic RK4 on the
 * closed-form double pendulum equations, the sub-steps planned for the whole batch from its fastest rod and bounded by the step
 * budget `FAN_STEP_BUDGET`), so 500 of them cost about a millisecond a step and 5,000 – the memory-safety ceiling the budget
 * sets – stay inside a frame. Everything is deterministic: the start comes from the mode's seeded draw, every pendulum runs the
 * same arithmetic (with a spread of 0 they stay identical to the last bit) and the sub-steps depend on the state alone.
 *
 * This module is pure (no settings.ts, no doublePendulum.ts import – that file imports this one): the settings fields, their
 * ranges and URL keys, the presets, the physics, the tape, the measures, the pitch rule and the run (`ChaosFanRun`) that
 * DoublePendulumMode delegates to while the fan is on.
 */

/* ------------------------------------------------------------------ settings */

export const DP_COLOUR_BY = ["index", "single"] as const;
export type DpColourBy = (typeof DP_COLOUR_BY)[number];

export function isDpColourBy(value: unknown): value is DpColourBy {
  return typeof value === "string" && (DP_COLOUR_BY as readonly string[]).includes(value);
}

/** The fan's part of the Double Pendulum settings (engine side). */
export interface ChaosFanSettings {
  /** The chaos fan instead of the harp rig: `fanCount` double pendulums on one pivot, a hair apart. */
  fan: boolean;
  /** Pendulums in the fan (1–500 on the slider; any count from 1 typed, at most `ENTITY_CEILING` built). */
  fanCount: number;
  /** Total start spread across the fan (degrees, on the last rod): pendulum i of n starts i/(n−1) of it further. */
  spreadDeg: number;
  /** A rainbow by index once the pendulums separate, or the Ball Color for all of them. */
  colourBy: DpColourBy;
  /** Record the forward run, then play it backwards: a seamless loop of twice `forwardSec`. */
  palindrome: boolean;
  /** Seconds of the forward run (the palindrome's half). */
  forwardSec: number;
  /** The fan counts as split once a bob is this far from the leader's (px of a 1080-px-wide frame). */
  divergePx: number;
}

export const DEFAULT_CHAOS_FAN_SETTINGS: Readonly<ChaosFanSettings> = {
  fan: false,
  fanCount: 200,
  spreadDeg: 0.001,
  colourBy: "index",
  palindrome: true,
  forwardSec: 10,
  divergePx: 30,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names; every value is uncapped from its minimum. */
export const CHAOS_FAN_RANGES = {
  dpFanCount: { min: 1, max: 500, step: 1 },
  dpSpreadDeg: { min: 0, max: 1, step: 0.000001 },
  dpForwardSec: { min: 1, max: 30, step: 0.5 },
  dpDivergePx: { min: 1, max: 200, step: 0.5 },
} as const;

/** The fan's fields of the SimulatorSettings object (URL keys in `DP_FAN_URL_KEYS`, `dpfc` for the colours). */
export interface ChaosFanFields {
  dpFan: boolean;
  dpFanCount: number;
  dpSpreadDeg: number;
  dpColourBy: DpColourBy;
  dpPalindrome: boolean;
  dpForwardSec: number;
  dpDivergePx: number;
}

/** Validates the fan's part of a settings patch into `out` (numbers from their minimum up – never a maximum –, known options, real booleans). */
export function resolveChaosFanInto(config: Partial<ChaosFanSettings>, out: ChaosFanSettings, ceiling: (key: string, value: number) => number) {
  const R = CHAOS_FAN_RANGES;
  const num = (value: unknown, range: { min: number }, fallback: number) => {
    const n = Number(value);
    return value !== null && value !== "" && Number.isFinite(n) ? atLeastMin(n, range) : fallback;
  };
  if (typeof config.fan === "boolean") out.fan = config.fan;
  // (the fan's pendulums stop at their memory-safety ceiling where a run builds them: ARENA FULL past it)
  if (config.fanCount !== undefined) out.fanCount = ceiling("dpFanCount", Math.round(num(config.fanCount, R.dpFanCount, out.fanCount)));
  if (config.spreadDeg !== undefined) out.spreadDeg = num(config.spreadDeg, R.dpSpreadDeg, out.spreadDeg);
  if (isDpColourBy(config.colourBy)) out.colourBy = config.colourBy;
  if (typeof config.palindrome === "boolean") out.palindrome = config.palindrome;
  if (config.forwardSec !== undefined) out.forwardSec = num(config.forwardSec, R.dpForwardSec, out.forwardSec);
  if (config.divergePx !== undefined) out.divergePx = num(config.divergePx, R.dpDivergePx, out.divergePx);
}

/* ------------------------------------------------------------------ URL */

/** Short URL keys of the fan's numeric and boolean fields (the colours travel as `dpfc`). */
export const DP_FAN_URL_KEYS = {
  dpf: "dpFan",
  dpfn: "dpFanCount",
  dpfs: "dpSpreadDeg",
  dpfp: "dpPalindrome",
  dpff: "dpForwardSec",
  dpfd: "dpDivergePx",
} as const satisfies Record<string, keyof ChaosFanFields>;

/** Writes the fan's fields that differ from `base` (exact numbers: a millionth of a degree survives the link). */
export function writeChaosFanParams(settings: ChaosFanFields, base: ChaosFanFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(DP_FAN_URL_KEYS) as [string, keyof ChaosFanFields][]) {
    const value = settings[field];
    if (value === base[field]) continue;
    if (typeof value === "boolean") params.set(key, value ? "1" : "0");
    else if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(value));
  }
  if (settings.dpColourBy !== base.dpColourBy) params.set("dpfc", settings.dpColourBy);
}

/** Reads the fan's URL parameters into `settings` (raw: the Double Pendulum reader validates everything afterwards). */
export function readChaosFanParams(params: URLSearchParams, settings: ChaosFanFields) {
  const target = settings as unknown as Record<string, number | boolean | string>;
  for (const [key, field] of Object.entries(DP_FAN_URL_KEYS) as [string, keyof ChaosFanFields][]) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (typeof settings[field] === "boolean") {
      if (raw === "1") target[field] = true;
      else if (raw === "0") target[field] = false;
    } else {
      const value = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(value)) target[field] = value;
    }
  }
  const colours = params.get("dpfc");
  if (isDpColourBy(colours)) settings.dpColourBy = colours;
}

/* ------------------------------------------------------------------ presets */

export interface ChaosFanPreset {
  id: "hairApart" | "threads" | "twoApart";
  /** Translation key of its name (Controls namespace). */
  labelKey: string;
}

export const CHAOS_FAN_PRESETS: readonly ChaosFanPreset[] = [
  { id: "hairApart", labelKey: "dpFanPresetHairApart" },
  { id: "threads", labelKey: "dpFanPresetThreads" },
  { id: "twoApart", labelKey: "dpFanPresetTwoApart" },
];

/** The look every preset brings: the clip's dark navy page and the loop HUD (title, subtitle, the grey state label). */
export const CHAOS_FAN_LOOK = {
  backgroundType: "solid",
  backgroundColors: ["#0b1020", "#0b1020"],
  themeId: "",
  loopHud: true,
} as const;

/** The rig every preset swings: two equal rods and bobs, Earth's gravity, no friction, a seeded high start. */
export const CHAOS_FAN_RIG = {
  dpLength1: 1,
  dpLength2: 1,
  dpMass1: 1,
  dpMass2: 1,
  dpGravity: 1,
  dpDamping: 0,
  dpRandomStart: true,
  dpEndless: false,
} as const;

/**
 * A preset's fan fields: **200 pendulums, a hair apart** (the reel: 200 pendulums a thousandth of a degree apart, 10 s forwards
 * and 10 s back), **1,000 threads** (a thousand pendulums a ten-thousandth of a degree apart, 12 s each way) and **Two that drift
 * apart** (two pendulums a hundredth of a degree apart – the classic demonstration –, 12 s each way).
 */
export function chaosFanPresetFields(id: ChaosFanPreset["id"]): ChaosFanFields {
  const base: ChaosFanFields = { dpFan: true, dpFanCount: 200, dpSpreadDeg: 0.001, dpColourBy: "index", dpPalindrome: true, dpForwardSec: 10, dpDivergePx: 30 };
  if (id === "threads") return { ...base, dpFanCount: 1000, dpSpreadDeg: 0.0001, dpForwardSec: 12 };
  if (id === "twoApart") return { ...base, dpFanCount: 2, dpSpreadDeg: 0.01, dpForwardSec: 12 };
  return base;
}

/* ------------------------------------------------------------------ timing */

/** The fan's simulation steps a second (the engine's fixed step). */
export const FAN_STEPS_PER_SEC = 60;

/** Steps of the forward run (at least one). */
export function fanForwardSteps(forwardSec: number): number {
  return Number.isFinite(forwardSec) && forwardSec > 0 ? Math.max(1, Math.round(forwardSec * FAN_STEPS_PER_SEC)) : 1;
}

/** The palindrome's cycle (s): the forward run and the same run backwards. */
export function chaosFanCycleSec(forwardSec: number): number {
  return (2 * fanForwardSteps(forwardSec)) / FAN_STEPS_PER_SEC;
}

/** The clip (whole seconds) a palindrome fills: one whole cycle (Export whole loops then cuts it on the seam). */
export function chaosFanClipSec(fields: Pick<ChaosFanFields, "dpForwardSec">): number {
  return Math.ceil(chaosFanCycleSec(fields.dpForwardSec) - 1e-9);
}

/**
 * --- low-findings-2 --- The latest target second Find Simulation's "Splits at" can meet: run backwards, the fan only splits on
 * its forward run (it closes up again on the way back), so a split's window [target − `toleranceSec`, target + `toleranceSec`]
 * must start by the forward run's end; null when the fan runs on forwards (any second is reachable).
 */
export function fanSplitLatestSec(fields: Pick<ChaosFanFields, "dpPalindrome" | "dpForwardSec">, toleranceSec: number): number | null {
  if (!fields.dpPalindrome) return null;
  return fanForwardSteps(fields.dpForwardSec) / FAN_STEPS_PER_SEC + toleranceSec;
}

/* ------------------------------------------------------------------ physics */

/** Pendulums whose start offsets are spread over the total (radians): pendulum i of n starts i/(n − 1) of it further on its last rod. */
export function fanOffset(i: number, n: number, spreadRad: number): number {
  return n > 1 ? (spreadRad * i) / (n - 1) : 0;
}

/** The fewest RK4 sub-steps of a 60 Hz step. */
export const FAN_MIN_SUBSTEPS = 8;
/** The most RK4 sub-steps of a step (a light bob over a heavy one may whip round faster: the step budget bounds it first). */
export const FAN_MAX_SUBSTEPS = 128;
/** A sub-step turns no rod more than this (rad) – the fastest rod of the batch decides. */
export const FAN_MAX_ANGLE_PER_SUBSTEP = 0.02;
/**
 * The runtime step budget: derivative evaluations of the whole batch in one 60 Hz step (four per RK4 sub-step and pendulum).
 * At the fewest sub-steps it holds `FAN_STEP_BUDGET / (4 · FAN_MIN_SUBSTEPS)` = 5,000 pendulums – the fan's memory-safety
 * ceiling (`ENTITY_CEILING`) –; a smaller fan may take more sub-steps for a fast rod, never more evaluations.
 */
export const FAN_STEP_BUDGET = 160_000;

/** The sub-steps of a step for the fastest rod `maxOmega` (rad/s), the step `dt` (s) and `count` pendulums. */
export function fanSubsteps(maxOmega: number, dt: number, count: number): number {
  const want = Number.isFinite(maxOmega) ? Math.ceil((Math.abs(maxOmega) * dt) / FAN_MAX_ANGLE_PER_SUBSTEP - 1e-9) : FAN_MAX_SUBSTEPS;
  const room = Math.max(FAN_MIN_SUBSTEPS, Math.floor(FAN_STEP_BUDGET / (4 * Math.max(1, count))));
  return Math.max(FAN_MIN_SUBSTEPS, Math.min(want, room, FAN_MAX_SUBSTEPS));
}

/** The rig of a fan: rod lengths (their sum is the model's unit), bob masses, gravity and the friction rate. */
export interface FanParams {
  l1: number;
  l2: number;
  m1: number;
  m2: number;
  g: number;
  /** Friction rate k (1/s): the generalised force −kMθ̇, an angular deceleration of −kθ̇. */
  k: number;
}

/**
 * The double pendulum's angular accelerations (angles from hanging straight down, the closed-form solution of the Lagrangian):
 * θ₁″ = [−g(2m₁+m₂) sin θ₁ − m₂ g sin(θ₁−2θ₂) − 2 sin δ m₂ (ω₂² l₂ + ω₁² l₁ cos δ)] / (l₁ D) − kω₁ and
 * θ₂″ = [2 sin δ (ω₁² l₁ (m₁+m₂) + g (m₁+m₂) cos θ₁ + ω₂² l₂ m₂ cos δ)] / (l₂ D) − kω₂ with δ = θ₁ − θ₂ and
 * D = 2m₁ + m₂ − m₂ cos 2δ = 2 (m₁ + m₂ sin² δ). Writes them into `out` (allocation-free).
 */
export function fanAccel(p: FanParams, t1: number, t2: number, w1: number, w2: number, out: Float64Array) {
  const s1 = Math.sin(t1);
  const c1 = Math.cos(t1);
  const s2 = Math.sin(t2);
  const c2 = Math.cos(t2);
  const sd = s1 * c2 - c1 * s2;
  const cd = c1 * c2 + s1 * s2;
  const m1 = p.m1;
  const m2 = p.m2;
  const M = m1 + m2;
  const den = 2 * (m1 + m2 * sd * sd);
  const sin1m2 = sd * c2 - cd * s2; // sin(θ₁ − 2θ₂) = sin(δ − θ₂)
  out[0] = (-p.g * (2 * m1 + m2) * s1 - m2 * p.g * sin1m2 - 2 * sd * m2 * (w2 * w2 * p.l2 + w1 * w1 * p.l1 * cd)) / (p.l1 * den) - p.k * w1;
  out[1] = (2 * sd * (w1 * w1 * p.l1 * M + p.g * M * c1 + w2 * w2 * p.l2 * m2 * cd)) / (p.l2 * den) - p.k * w2;
}

/** Total energy of one double pendulum (kinetic + potential, the pivot at height 0, y down). */
export function fanEnergy(p: FanParams, t1: number, t2: number, w1: number, w2: number): number {
  const M = p.m1 + p.m2;
  const kin = 0.5 * M * p.l1 * p.l1 * w1 * w1 + 0.5 * p.m2 * p.l2 * p.l2 * w2 * w2 + p.m2 * p.l1 * p.l2 * w1 * w2 * Math.cos(t1 - t2);
  const pot = -M * p.g * p.l1 * Math.cos(t1) - p.m2 * p.g * p.l2 * Math.cos(t2);
  return kin + pot;
}

/**
 * The batch: every pendulum's state in its own Float64Array (θ₁, θ₂, ω₁, ω₂), advanced together by `step()` in classic RK4
 * sub-steps – one count for the whole batch, planned from its fastest rod (`fanSubsteps()`) – with the pendulum's own state
 * in locals, so a step allocates nothing and touches each array once. A pendulum whose numbers overflow (an absurd gravity) is
 * put back where it was at the start of the step, at rest.
 */
export class FanBatch {
  readonly n: number;
  readonly th1: Float64Array;
  readonly th2: Float64Array;
  readonly w1: Float64Array;
  readonly w2: Float64Array;
  params: FanParams;
  /** Sub-steps and derivative evaluations of the last step (the step budget's measure). */
  subSteps = 0;
  evals = 0;
  private readonly acc = new Float64Array(2);

  constructor(n: number, params: FanParams) {
    this.n = Math.max(0, Math.floor(n));
    this.th1 = new Float64Array(this.n);
    this.th2 = new Float64Array(this.n);
    this.w1 = new Float64Array(this.n);
    this.w2 = new Float64Array(this.n);
    this.params = params;
  }

  /** The fastest rod of the batch (rad/s). */
  maxOmega(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      const a = Math.abs(this.w1[i]);
      const b = Math.abs(this.w2[i]);
      if (a > m) m = a;
      if (b > m) m = b;
    }
    return m;
  }

  /** Advances every pendulum by `dt` seconds in `sub` RK4 sub-steps (planned from the batch when left out). */
  step(dt: number, sub = fanSubsteps(this.maxOmega(), dt, this.n)) {
    const p = this.params;
    const acc = this.acc;
    const h = dt / sub;
    const hh = 0.5 * h;
    const h6 = h / 6;
    for (let i = 0; i < this.n; i++) {
      let a = this.th1[i];
      let b = this.th2[i];
      let c = this.w1[i];
      let d = this.w2[i];
      for (let s = 0; s < sub; s++) {
        fanAccel(p, a, b, c, d, acc);
        const k1c = acc[0];
        const k1d = acc[1];
        fanAccel(p, a + hh * c, b + hh * d, c + hh * k1c, d + hh * k1d, acc);
        const k2a = c + hh * k1c;
        const k2b = d + hh * k1d;
        const k2c = acc[0];
        const k2d = acc[1];
        fanAccel(p, a + hh * k2a, b + hh * k2b, c + hh * k2c, d + hh * k2d, acc);
        const k3a = c + hh * k2c;
        const k3b = d + hh * k2d;
        const k3c = acc[0];
        const k3d = acc[1];
        fanAccel(p, a + h * k3a, b + h * k3b, c + h * k3c, d + h * k3d, acc);
        const k4a = c + h * k3c;
        const k4b = d + h * k3d;
        const k4c = acc[0];
        const k4d = acc[1];
        a += h6 * (c + 2 * k2a + 2 * k3a + k4a);
        b += h6 * (d + 2 * k2b + 2 * k3b + k4b);
        c += h6 * (k1c + 2 * k2c + 2 * k3c + k4c);
        d += h6 * (k1d + 2 * k2d + 2 * k3d + k4d);
      }
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
        this.th1[i] = a;
        this.th2[i] = b;
        this.w1[i] = c;
        this.w2[i] = d;
      } else {
        // the numbers overflowed (gravity past the float range): back where it was, at rest
        this.w1[i] = 0;
        this.w2[i] = 0;
      }
    }
    this.subSteps = sub;
    this.evals = 4 * sub * this.n;
  }

  /** The batch's total energy. */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += fanEnergy(this.params, this.th1[i], this.th2[i], this.w1[i], this.w2[i]);
    return e;
  }
}

/* ------------------------------------------------------------------ the tape (the palindrome) */

/** Floats the palindrome's tape may hold (Float32: 32 MB). Past it the tape keeps every k-th step and interpolates between them. */
export const FAN_TAPE_BUDGET = 8_000_000;

/** The tape's stride and frame count for `count` pendulums and a forward run of `forwardSteps` steps. */
export function fanTapePlan(count: number, forwardSteps: number, budget = FAN_TAPE_BUDGET): { stride: number; frames: number } {
  const n = Math.max(1, count);
  const F = Math.max(1, forwardSteps);
  const stride = Math.max(1, Math.ceil(((F + 1) * 2 * n) / Math.max(2 * n, budget)));
  return { stride, frames: Math.ceil(F / stride) + 1 };
}

/**
 * The recording of the forward run: both angles of every pendulum at steps 0, s, 2s, … and the last step F (frame m holds step
 * min(m·s, F)). `read()` gives any step back, interpolated between its two frames (exact with a stride of 1).
 */
export class FanTape {
  readonly n: number;
  readonly forwardSteps: number;
  readonly stride: number;
  readonly frames: number;
  readonly data: Float32Array;

  constructor(n: number, forwardSteps: number, budget = FAN_TAPE_BUDGET) {
    this.n = Math.max(1, n);
    this.forwardSteps = Math.max(1, forwardSteps);
    const plan = fanTapePlan(this.n, this.forwardSteps, budget);
    this.stride = plan.stride;
    this.frames = plan.frames;
    this.data = new Float32Array(this.frames * 2 * this.n);
  }

  /** The step frame m holds. */
  stepOf(m: number): number {
    return Math.min(m * this.stride, this.forwardSteps);
  }

  /** Records step k of the forward run when a frame holds it. */
  write(k: number, th1: Float64Array, th2: Float64Array) {
    let m: number;
    if (k === this.forwardSteps) m = this.frames - 1;
    else if (k % this.stride === 0) m = k / this.stride;
    else return;
    const base = m * 2 * this.n;
    for (let i = 0; i < this.n; i++) {
      this.data[base + 2 * i] = th1[i];
      this.data[base + 2 * i + 1] = th2[i];
    }
  }

  /** Writes the angles of step k (0 … F) into `th1` / `th2`. */
  read(k: number, th1: Float64Array, th2: Float64Array) {
    const kk = Math.max(0, Math.min(this.forwardSteps, k));
    const m0 = Math.min(Math.floor(kk / this.stride), this.frames - 1);
    const m1 = Math.min(m0 + 1, this.frames - 1);
    const k0 = this.stepOf(m0);
    const k1 = this.stepOf(m1);
    const u = k1 > k0 ? (kk - k0) / (k1 - k0) : 0;
    const b0 = m0 * 2 * this.n;
    const b1 = m1 * 2 * this.n;
    for (let i = 0; i < this.n; i++) {
      const a0 = this.data[b0 + 2 * i];
      const c0 = this.data[b0 + 2 * i + 1];
      th1[i] = u > 0 ? a0 + u * (this.data[b1 + 2 * i] - a0) : a0;
      th2[i] = u > 0 ? c0 + u * (this.data[b1 + 2 * i + 1] - c0) : c0;
    }
  }
}

/* ------------------------------------------------------------------ measures, colours, pitch */

/** The fan's reach (one chain is 1 model unit) as a share of the field's side: about 80 % of a portrait clip's width across. */
export const FAN_REACH_SHARE = 0.42;
/** Pixels per model unit on a 1080-px-wide frame (the field is 96 % of it): the unit of `divergePx`, whatever the canvas size. */
export const FAN_REF_PX_PER_UNIT = 0.96 * 1080 * FAN_REACH_SHARE;
/** The bob's radius as a share of the field's side per px of the Ball Size (the default 8 px ball: about 6 px on a 1080 clip). */
export const FAN_BOB_PER_BALL_PX = 1 / 1280;

/** Hue (degrees) of pendulum i of n: the wheel by index, from the leader's pink. */
export function fanHue(i: number, n: number): number {
  return (330 + (n > 0 ? (360 * i) / n : 0)) % 360;
}

/** How far a pendulum has separated (0 together … 1 apart) at `devPx` from the leader with the split at `divergePx`. */
export function fanSeparation(devPx: number, divergePx: number): number {
  if (!(devPx > 0)) return 0;
  const x = devPx / Math.max(1e-9, divergePx);
  return x >= 1 ? 1 : x;
}

/** The swing notes' root: A2; the single voice sits five degrees up (A3) and the fan climbs nine more as it spreads (to F♯5). */
export const FAN_ROOT_MIDI = 45;
export const FAN_SWING_BASE_DEGREE = 5;
export const FAN_SWING_SPAN = 9;
/** The deviation (px) at which a swing reaches the top of the span; below a quarter of the split a pendulum still plays the single voice. */
export const FAN_PITCH_TOP_PX = 400;
/** The most distinct swing notes one step plays (the loop voices' per-tick budget). */
export const FAN_MAX_SWINGS_PER_STEP = 6;
/** A swing at this bob speed (model units / s) or faster is full strength (narrow velocity: 0.8–1). */
export const FAN_SWING_FULL_SPEED = 6;
/** The split cue (a soft ding, A5), the homecoming chord's root (A2), the reverse wash and the reset glide (s). */
export const FAN_DING_HZ = midiToFrequency(FAN_ROOT_MIDI + 36);
export const FAN_CHORD_HZ = midiToFrequency(FAN_ROOT_MIDI);
export const FAN_WASH_SEC = 1.2;
export const FAN_GLIDE_SEC = 2.5;
/** No new swing note in the palindrome's last seconds (the glide carries the seam; a ringing note would end abruptly there). */
export const FAN_TAIL_SEC = 1.5;

/** The swing's scale degree for a bob `devPx` from the leader's: the single voice while together, rising (logarithmically) as it spreads. */
export function fanSwingDegree(devPx: number, divergePx: number): number {
  const low = Math.max(1e-9, divergePx / 4);
  if (!(devPx > low)) return FAN_SWING_BASE_DEGREE;
  return FAN_SWING_BASE_DEGREE + scalarDegree(Math.log(devPx), Math.log(low), Math.log(Math.max(low, FAN_PITCH_TOP_PX)), FAN_SWING_SPAN);
}

/** The swing note (Hz) of a degree: the A major pentatonic from A2. */
export function fanSwingFrequency(degree: number): number {
  return midiToFrequency(degreeToMidi(degree, FAN_ROOT_MIDI));
}

/** The swing's loudness: 0.8 + 0.2 × its speed (narrow), shared 1/√n by the n notes of one step. */
export function fanSwingLevel(speed: number, notes: number): number {
  const v = 0.8 + 0.2 * Math.min(1, Math.max(0, speed) / FAN_SWING_FULL_SPEED);
  return v / Math.sqrt(Math.max(1, notes));
}

/** The SoundEvent kinds a fan plays (the loop voices of the family). */
export const CHAOS_FAN_SOUND_KINDS: readonly NonNullable<SoundEvent["loop"]>[] = ["pluck", "ding", "wash", "chord", "glide"];

/* ------------------------------------------------------------------ the run */

export type FanRunning = "forwards" | "backwards";

/** What the canvas, the HUD, the finder and the tests read of a fan; the same object every call. */
export interface ChaosFanView {
  count: number;
  /** Joint (x1, y1) and bob (x2, y2) of every pendulum, model units from the pivot (y down). */
  x1: Float64Array;
  y1: Float64Array;
  x2: Float64Array;
  y2: Float64Array;
  /** Every bob's distance from the leader's, px of a 1080-px-wide frame, and the largest (the fan's spread). */
  devPx: Float64Array;
  spreadPx: number;
  /** The state label: the forward run, or the tape played backwards. */
  running: FanRunning;
  palindrome: boolean;
  /** Steps of the forward run, and the step of the cycle the picture shows (forwards 0 → F, backwards F → 2F). */
  forwardSteps: number;
  cycleStep: number;
  /** Whole cycles played (each closed on a seam: the run's start again), the last seam and this cycle's start (simulation ms). */
  cycles: number;
  lastSeamMs: number;
  cycleStartMs: number;
  stepMs: number;
  /** The first cycle's split (simulation ms, −1 before it) – the finder's divergence time –, and this cycle's (s into it, −1). */
  divergeMs: number;
  splitSec: number;
  /** When this cycle's fan came home – back under the split on the way back (s into the cycle, −1). */
  homeSec: number;
  /** Counters: splits, homecomings, reversals, swing notes played. */
  splits: number;
  homes: number;
  reverses: number;
  swings: number;
  /** Sub-steps and derivative evaluations of the last integrated step (the step budget's measure; 0 while playing the tape). */
  subSteps: number;
  evals: number;
  colourBy: DpColourBy;
  divergePx: number;
  /** The Ball Color (the single-colour fan). */
  singleColor: string;
  /** A bob's radius on the canvas (px; the mode sets it from the field and the Ball Size). */
  bobPx: number;
  /** The tape: its stride (1 = every step) and frames (0 without the palindrome). */
  tapeStride: number;
  tapeFrames: number;
}

function emptyView(): ChaosFanView {
  const z = new Float64Array(0);
  return {
    count: 0,
    x1: z,
    y1: z,
    x2: z,
    y2: z,
    devPx: z,
    spreadPx: 0,
    running: "forwards",
    palindrome: false,
    forwardSteps: 1,
    cycleStep: 0,
    cycles: 0,
    lastSeamMs: -1,
    cycleStartMs: 0,
    stepMs: 1000 / FAN_STEPS_PER_SEC,
    divergeMs: -1,
    splitSec: -1,
    homeSec: -1,
    splits: 0,
    homes: 0,
    reverses: 0,
    swings: 0,
    subSteps: 0,
    evals: 0,
    colourBy: "index",
    divergePx: DEFAULT_CHAOS_FAN_SETTINGS.divergePx,
    singleColor: "#ffffff",
    bobPx: 3,
    tapeStride: 0,
    tapeFrames: 0,
  };
}

/** How a fan starts: the batch's rig, the leader's angles (radians), the spread, the loop and the measure. */
export interface ChaosFanStart {
  count: number;
  params: FanParams;
  theta1: number;
  theta2: number;
  spreadRad: number;
  palindrome: boolean;
  forwardSec: number;
  divergePx: number;
  colourBy: DpColourBy;
  singleColor: string;
}

/**
 * The fan's run (DoublePendulumMode delegates to it while the fan is on): it starts the batch, steps it – or plays the tape
 * backwards –, measures the spread, closes the palindrome on its seam with the exact start, and queues the family's sounds:
 * a pentatonic pluck for every bob crossing the bottom (the swing; the deviation from the leader picks the degree, so the fan
 * plays one voice while together and a widening cloud as it spreads, mirrored on the way back), a soft ding when the fan first
 * splits, a noise wash as it starts running backwards, the completion chord when it comes home under the split, and the reset
 * glide that lands on the seam.
 */
export class ChaosFanRun {
  active = false;
  private readonly view: ChaosFanView = emptyView();
  private batch: FanBatch | null = null;
  private tape: FanTape | null = null;
  /** The exact start (the seam restores it). */
  private start0: Float64Array = new Float64Array(0);
  /** The bob's x of the previous frame (the swing's crossing test). */
  private prevX2: Float64Array = new Float64Array(0);
  private splitThisCycle = false;
  private homeThisCycle = false;
  /** Scratch of the step's swing notes: the loudest speed per degree (−1: none). */
  private readonly degreeSpeed = new Float64Array(FAN_SWING_BASE_DEGREE + FAN_SWING_SPAN + 1);

  getView(): ChaosFanView {
    return this.view;
  }

  /** The palindrome's cycle (s), or null (no fan, or a fan that runs forwards only). */
  cycleSeconds(): number | null {
    const v = this.view;
    return this.active && v.palindrome ? (2 * v.forwardSteps * v.stepMs) / 1000 : null;
  }

  loopSeams(): LoopSeams | null {
    const v = this.view;
    if (!this.active || !v.palindrome) return null;
    return { count: v.cycles, lastMs: v.cycles > 0 ? v.lastSeamMs : -1, nextMs: v.cycleStartMs + 2 * v.forwardSteps * v.stepMs };
  }

  /** The colours and the split measure follow a change live; everything else restarts the run. */
  setLive(colourBy: DpColourBy, divergePx: number) {
    this.view.colourBy = colourBy;
    this.view.divergePx = divergePx;
  }

  setSingleColor(color: string) {
    this.view.singleColor = color;
  }

  /** Builds the batch (and the tape) and places every pendulum at its start: the leader's angles, the others a hair further on the last rod. */
  init(start: ChaosFanStart) {
    const v = this.view;
    const n = Math.max(1, Math.floor(start.count));
    this.active = true;
    const batch = new FanBatch(n, start.params);
    for (let i = 0; i < n; i++) {
      batch.th1[i] = start.theta1;
      batch.th2[i] = start.theta2 + fanOffset(i, n, start.spreadRad);
    }
    this.batch = batch;
    this.start0 = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      this.start0[2 * i] = batch.th1[i];
      this.start0[2 * i + 1] = batch.th2[i];
    }
    v.count = n;
    if (v.x1.length !== n) {
      v.x1 = new Float64Array(n);
      v.y1 = new Float64Array(n);
      v.x2 = new Float64Array(n);
      v.y2 = new Float64Array(n);
      v.devPx = new Float64Array(n);
      this.prevX2 = new Float64Array(n);
    }
    v.palindrome = start.palindrome;
    v.forwardSteps = fanForwardSteps(start.forwardSec);
    v.cycleStep = 0;
    v.cycles = 0;
    v.lastSeamMs = -1;
    v.cycleStartMs = 0;
    v.stepMs = 1000 / FAN_STEPS_PER_SEC;
    v.divergeMs = -1;
    v.splitSec = -1;
    v.homeSec = -1;
    v.splits = 0;
    v.homes = 0;
    v.reverses = 0;
    v.swings = 0;
    v.subSteps = 0;
    v.evals = 0;
    v.running = "forwards";
    v.colourBy = start.colourBy;
    v.divergePx = start.divergePx;
    v.singleColor = start.singleColor;
    this.splitThisCycle = false;
    this.homeThisCycle = false;
    this.tape = start.palindrome ? new FanTape(n, v.forwardSteps) : null;
    v.tapeStride = this.tape?.stride ?? 0;
    v.tapeFrames = this.tape?.frames ?? 0;
    this.tape?.write(0, batch.th1, batch.th2);
    this.place(batch.th1, batch.th2);
    this.prevX2.set(v.x2);
  }

  /** Stops the fan (the harp rig is back); frees the batch and the tape. */
  clear() {
    this.active = false;
    this.batch = null;
    this.tape = null;
  }

  /** The batch's total energy (0 without a fan). */
  energy(): number {
    return this.batch?.energy() ?? 0;
  }

  /** The exact angles of the start (θ₁, θ₂ per pendulum), for the tests. */
  startAngles(): Float64Array {
    return this.start0;
  }

  /** The batch (for the tests and tools), or null. */
  getBatch(): FanBatch | null {
    return this.batch;
  }

  /**
   * One 60 Hz step: forwards the batch integrates (and the first forward run is recorded); backwards the tape plays back; at
   * the end of the way back the seam restores the exact start. Then the spread is measured and the step's sounds queued.
   * Returns true when the leader swung through the bottom (bounce math's "bounce").
   */
  step(ctx: ModeContext, stepMs: number): boolean {
    const v = this.view;
    const batch = this.batch;
    if (!this.active || !batch) return false;
    const dt = stepMs / 1000;
    v.stepMs = stepMs > 0 ? stepMs : v.stepMs;
    const F = v.forwardSteps;
    let seam = false;
    let reversed = false;
    if (!v.palindrome || v.cycleStep < F) {
      batch.step(dt);
      v.subSteps = batch.subSteps;
      v.evals = batch.evals;
      v.cycleStep++;
      if (v.palindrome && this.tape && v.cycles === 0) this.tape.write(v.cycleStep, batch.th1, batch.th2);
      this.place(batch.th1, batch.th2);
      if (v.palindrome && v.cycleStep === F) reversed = true;
    } else {
      v.subSteps = 0;
      v.evals = 0;
      v.cycleStep++;
      if (v.cycleStep >= 2 * F) {
        // the seam: the exact start again (not the tape's Float32 copy), the next cycle runs forwards from it
        for (let i = 0; i < batch.n; i++) {
          batch.th1[i] = this.start0[2 * i];
          batch.th2[i] = this.start0[2 * i + 1];
          batch.w1[i] = 0;
          batch.w2[i] = 0;
        }
        this.place(batch.th1, batch.th2);
        seam = true;
      } else {
        // the tape backwards: step 2F − c of the cycle shows step F − (c − F) of the forward run
        this.tape?.read(2 * F - v.cycleStep, batch.th1, batch.th2);
        this.place(batch.th1, batch.th2);
      }
    }
    const nowMs = ctx.getElapsedMs();
    if (seam) {
      v.cycles++;
      v.cycleStep = 0;
      v.lastSeamMs = nowMs;
      v.cycleStartMs = nowMs;
      this.splitThisCycle = false;
      this.homeThisCycle = false;
      v.splitSec = -1;
      v.homeSec = -1;
    }
    v.running = v.palindrome && v.cycleStep >= F ? "backwards" : "forwards";
    const leaderSwung = this.sounds(ctx, dt, reversed, seam, nowMs);
    this.prevX2.set(v.x2);
    return leaderSwung;
  }

  /** Positions of every joint and bob from the angles, and every bob's distance from the leader's (the spread). */
  private place(th1: Float64Array, th2: Float64Array) {
    const v = this.view;
    const p = this.batch!.params;
    let spread = 0;
    for (let i = 0; i < v.count; i++) {
      const x1 = p.l1 * Math.sin(th1[i]);
      const y1 = p.l1 * Math.cos(th1[i]);
      v.x1[i] = x1;
      v.y1[i] = y1;
      v.x2[i] = x1 + p.l2 * Math.sin(th2[i]);
      v.y2[i] = y1 + p.l2 * Math.cos(th2[i]);
    }
    const lx = v.x2[0];
    const ly = v.y2[0];
    for (let i = 0; i < v.count; i++) {
      const dx = v.x2[i] - lx;
      const dy = v.y2[i] - ly;
      const d = Math.sqrt(dx * dx + dy * dy) * FAN_REF_PX_PER_UNIT;
      v.devPx[i] = d;
      if (d > spread) spread = d;
    }
    v.spreadPx = spread;
  }

  /** The step's sounds (see the class); returns whether the leader swung through the bottom. */
  private sounds(ctx: ModeContext, dt: number, reversed: boolean, seam: boolean, nowMs: number): boolean {
    const v = this.view;
    const F = v.forwardSteps;
    const cycleSec = (v.cycleStep * v.stepMs) / 1000;
    // the split: the first time this cycle that a bob is `divergePx` from the leader's (on the way out)
    if (!seam && !this.splitThisCycle && v.running === "forwards" && v.spreadPx >= v.divergePx) {
      this.splitThisCycle = true;
      v.splits++;
      v.splitSec = cycleSec;
      if (v.divergeMs < 0) v.divergeMs = nowMs;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "ding", frequency: FAN_DING_HZ, level: 0.7, melody: false });
    }
    if (reversed) {
      v.reverses++;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "wash", loopSec: FAN_WASH_SEC, level: 0.8, melody: false });
    }
    // home: on the way back, the fan closes under the split again – the payoff chord
    if (!seam && this.splitThisCycle && !this.homeThisCycle && v.running === "backwards" && v.spreadPx < v.divergePx) {
      this.homeThisCycle = true;
      v.homes++;
      v.homeSec = cycleSec;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: FAN_CHORD_HZ, level: 0.85, melody: false });
    }
    // the reset glide: from the chord's root an octave down up to an octave under the first swing note, silent on the seam
    const glideSteps = Math.min(Math.round((FAN_GLIDE_SEC * 1000) / v.stepMs), Math.floor(F / 2));
    if (v.palindrome && glideSteps > 0 && v.cycleStep === 2 * F - glideSteps) {
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "glide", frequency: FAN_CHORD_HZ / 2, loopTo: fanSwingFrequency(FAN_SWING_BASE_DEGREE) / 2, loopSec: (glideSteps * v.stepMs) / 1000, level: 1, melody: false });
    }
    // the swings: every bob crossing the bottom (below the pivot), one note per degree, the loudest speed of each
    const tailSteps = Math.min(Math.round((FAN_TAIL_SEC * 1000) / v.stepMs), Math.floor(F / 2));
    const muted = seam || (v.palindrome && v.cycleStep > 2 * F - tailSteps);
    const speeds = this.degreeSpeed;
    speeds.fill(-1);
    let leaderSwung = false;
    let notes = 0;
    for (let i = 0; i < v.count; i++) {
      const x0 = this.prevX2[i];
      const x = v.x2[i];
      if (v.y2[i] <= 0 || (x0 < 0) === (x < 0)) continue;
      if (i === 0) leaderSwung = true;
      if (muted) continue;
      const degree = fanSwingDegree(v.devPx[i], v.divergePx);
      const speed = Math.abs(x - x0) / Math.max(1e-9, dt);
      if (speeds[degree] < 0) notes++;
      if (speed > speeds[degree]) speeds[degree] = speed;
    }
    if (notes > 0) {
      const sounding = Math.min(notes, FAN_MAX_SWINGS_PER_STEP);
      let played = 0;
      for (let degree = 0; degree < speeds.length && played < sounding; degree++) {
        if (speeds[degree] < 0) continue;
        played++;
        v.swings++;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "pluck", frequency: fanSwingFrequency(degree), level: fanSwingLevel(speeds[degree], sounding), loopBright: speeds[degree] > 0.6 * FAN_SWING_FULL_SPEED, melody: false });
      }
    }
    return leaderSwung;
  }
}
