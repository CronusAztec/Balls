/**
 * A planar chain pendulum – two links (the double pendulum) or three (the triple pendulum) – integrated in
 * error-controlled sub-steps of the embedded Dormand–Prince 5(4) Runge–Kutta pair (`tryStep()` / `acceptStep()`,
 * driven by `ChainStepper`), with the classic fourth-order Runge–Kutta step (`step()`) kept for fixed-step use. Pure
 * maths with no allocation after construction, so the Double Pendulum mode (modes/doublePendulum.ts) can step several
 * chains many times per 60 Hz step and stay inside the frame budget, and so the unit tests can check the integrator
 * directly (energy drift, collisions).
 *
 * Model: point masses `m[i]` at the ends of massless rods of length `l[i]`, angle `theta[i]` of rod i measured from
 * the downward vertical (screen coordinates, y pointing down: bob k sits at x = Σ l sin θ, y = Σ l cos θ from the
 * pivot). With μᵢⱼ = Σ_{k ≥ max(i, j)} m_k the Lagrangian gives, for every rod i,
 *
 *   Σⱼ μᵢⱼ lᵢ lⱼ cos(θᵢ − θⱼ) θ̈ⱼ = −Σⱼ μᵢⱼ lᵢ lⱼ sin(θᵢ − θⱼ) θ̇ⱼ² − g μᵢᵢ lᵢ sin θᵢ,
 *
 * a symmetric positive definite 2×2 or 3×3 system solved by Gaussian elimination at every stage. Damping is the
 * generalised force −k M θ̇ (θ̈ −= k θ̇ after the solve), which removes energy at the rate 2kT – never adds any.
 * Everything is deterministic: the same parameters and state always give the same numbers.
 *
 * Why the step size is error-controlled: a light bob above a heavy one (masses 0.2 over 5, say) is a stiff rig – the
 * light joint whips round at hundreds of rad/s for a few milliseconds while the heavy bob swings slowly, far faster
 * than the rates at the start of a 60 Hz step suggest. Sub-steps sized from the rates alone let the truncation error
 * drain up to half the energy of such a rig in two minutes; the embedded error estimate shortens exactly the sub-steps
 * that need it (hundreds in a whip, about ten a step for the default rig) and keeps the drift under 1e-6 of Σm·g·L.
 */

/** Most rods a chain may have. */
export const MAX_CHAIN_LINKS = 3;

/** Sub-steps per 60 Hz step: at least this many (the mode samples the harp crossings and the trail once per sub-step)… */
export const MIN_SUBSTEPS = 8;
/** …no rod turns more than this per sub-step (radians), so a bob's path between two sub-steps is nearly straight… */
export const MAX_ANGLE_PER_SUBSTEP = 0.015;
/** …every sub-step's estimated error stays under this (angles in radians, rates relative to 1 + |θ̇|; a rejected try is retried shorter)… */
export const STEP_TOLERANCE = 1e-9;
/** …and no sub-step is shorter than 1 / MAX_SUBSTEPS of the step, which bounds the work of a step (the error control never needs that many). */
export const MAX_SUBSTEPS = 1024;

/*
 * Dormand–Prince 5(4): stage s starts from y + h Σⱼ DP_A[s][j] kⱼ; the fifth-order result is y + h Σ DP_B[j] kⱼ, whose
 * slope is the seventh stage – the first stage of the next step (FSAL) – and h Σ DP_E[j] kⱼ (fifth minus embedded
 * fourth order) estimates the error of the step.
 */
const DP_A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
];
const DP_B: readonly number[] = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84];
const DP_E: readonly number[] = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];
const DP_STAGES = 7;

export interface ChainParams {
  /** 2 (double pendulum) or 3 (triple pendulum). */
  links: number;
  /** Rod lengths (model units). */
  lengths: readonly number[];
  /** Bob masses. */
  masses: readonly number[];
  /** Gravity (model units / s²), pulling towards +y. */
  gravity: number;
  /** Damping rate k (1/s): the angular velocities decay like e^(−k t) on top of the dynamics. */
  damping: number;
}

/** Writes x / y of a point (no allocation). */
export interface Vec2 {
  x: number;
  y: number;
}

const TWO_PI = Math.PI * 2;

/** Wraps an angle into (−π, π] (the dynamics only see sines and cosines, so this changes nothing but the size of the numbers). */
export function wrapAngle(a: number): number {
  if (a > Math.PI || a <= -Math.PI) {
    a -= TWO_PI * Math.round(a / TWO_PI);
    if (a <= -Math.PI) a += TWO_PI;
  }
  return a;
}

/**
 * Solves the n×n system `a · x = b` (n ≤ 3, row-major `a`) in place by Gaussian elimination without pivoting –
 * safe for the symmetric positive definite mass matrix, whose pivots are all positive. The solution is left in `b`.
 */
export function solveSpd(a: Float64Array, b: Float64Array, n: number): void {
  for (let c = 0; c < n; c++) {
    const pivot = a[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / pivot;
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r * n + k] * b[k];
    b[r] = s / a[r * n + r];
  }
}

export class PendulumChain {
  readonly links: number;
  /** Rod angles from the downward vertical (radians) and their rates (rad/s). */
  readonly theta: Float64Array;
  readonly omega: Float64Array;
  readonly lengths: Float64Array;
  readonly masses: Float64Array;
  gravity: number;
  damping: number;
  /** μᵢ = Σ_{k ≥ i} m_k (the mass rod i carries); μᵢⱼ = μ_max(i, j). */
  private readonly mu: Float64Array;
  // RK4 scratch: stage states and slopes, the mass matrix and the right-hand side.
  private readonly t0: Float64Array;
  private readonly w0: Float64Array;
  private readonly ts: Float64Array;
  private readonly ws: Float64Array;
  private readonly k1t: Float64Array;
  private readonly k1w: Float64Array;
  private readonly k2t: Float64Array;
  private readonly k2w: Float64Array;
  private readonly k3t: Float64Array;
  private readonly k3w: Float64Array;
  private readonly k4t: Float64Array;
  private readonly k4w: Float64Array;
  private readonly mat: Float64Array;
  private readonly rhs: Float64Array;
  // Dormand–Prince scratch: the stage slopes of the angles (rates) and of the rates (accelerations), the state the
  // first stage was taken at (reused while the state is unchanged) and the result of the last try.
  private readonly stageT: Float64Array[];
  private readonly stageW: Float64Array[];
  private readonly firstAtT: Float64Array;
  private readonly firstAtW: Float64Array;
  private firstValid = false;
  /** The fifth-order result of the last `tryStep()` (angles not wrapped yet); `acceptStep()` moves the chain there. */
  readonly nextTheta: Float64Array;
  readonly nextOmega: Float64Array;

  constructor(params: ChainParams) {
    const n = Math.max(1, Math.min(MAX_CHAIN_LINKS, Math.round(params.links)));
    this.links = n;
    const f = () => new Float64Array(n);
    this.theta = f();
    this.omega = f();
    this.lengths = f();
    this.masses = f();
    this.mu = f();
    this.t0 = f();
    this.w0 = f();
    this.ts = f();
    this.ws = f();
    this.k1t = f();
    this.k1w = f();
    this.k2t = f();
    this.k2w = f();
    this.k3t = f();
    this.k3w = f();
    this.k4t = f();
    this.k4w = f();
    this.mat = new Float64Array(n * n);
    this.rhs = f();
    this.stageT = Array.from({ length: DP_STAGES }, f);
    this.stageW = Array.from({ length: DP_STAGES }, f);
    this.firstAtT = f();
    this.firstAtW = f();
    this.nextTheta = f();
    this.nextOmega = f();
    for (let i = 0; i < n; i++) {
      this.lengths[i] = params.lengths[i] ?? params.lengths[params.lengths.length - 1] ?? 1;
      this.masses[i] = params.masses[i] ?? params.masses[params.masses.length - 1] ?? 1;
    }
    for (let i = n - 1; i >= 0; i--) this.mu[i] = this.masses[i] + (i + 1 < n ? this.mu[i + 1] : 0);
    this.gravity = params.gravity;
    this.damping = params.damping;
  }

  /** Sets the angles (radians) and the angular velocities (rad/s, zero when left out). */
  setState(theta: readonly number[], omega?: readonly number[]) {
    for (let i = 0; i < this.links; i++) {
      this.theta[i] = theta[i] ?? 0;
      this.omega[i] = omega?.[i] ?? 0;
    }
  }

  /** Total mass of the chain. */
  totalMass(): number {
    return this.mu[0];
  }

  /** Total length of the chain (the reach of its last bob). */
  reach(): number {
    let s = 0;
    for (let i = 0; i < this.links; i++) s += this.lengths[i];
    return s;
  }

  /** The symmetric mass matrix Mᵢⱼ = μᵢⱼ lᵢ lⱼ cos(θᵢ − θⱼ) at the angles `th` (row-major, into `out`). */
  massMatrix(th: ArrayLike<number>, out: Float64Array): Float64Array {
    const n = this.links;
    const l = this.lengths;
    for (let i = 0; i < n; i++) {
      out[i * n + i] = this.mu[i] * l[i] * l[i];
      for (let j = i + 1; j < n; j++) {
        const v = this.mu[j] * l[i] * l[j] * Math.cos(th[i] - th[j]);
        out[i * n + j] = v;
        out[j * n + i] = v;
      }
    }
    return out;
  }

  /** Angular accelerations at state (th, w), written into `out`. */
  accelerations(th: ArrayLike<number>, w: ArrayLike<number>, out: Float64Array): Float64Array {
    const n = this.links;
    const l = this.lengths;
    const mu = this.mu;
    const a = this.massMatrix(th, this.mat);
    const b = this.rhs;
    for (let i = 0; i < n; i++) {
      let s = -this.gravity * mu[i] * l[i] * Math.sin(th[i]);
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        s -= mu[i > j ? i : j] * l[i] * l[j] * Math.sin(th[i] - th[j]) * w[j] * w[j];
      }
      b[i] = s;
    }
    solveSpd(a, b, n);
    const k = this.damping;
    for (let i = 0; i < n; i++) out[i] = k > 0 ? b[i] - k * w[i] : b[i];
    return out;
  }

  /** One classic RK4 step of `h` seconds; the angles are wrapped into (−π, π] afterwards. */
  step(h: number) {
    const n = this.links;
    const { theta, omega, t0, w0, ts, ws, k1t, k1w, k2t, k2w, k3t, k3w, k4t, k4w } = this;
    for (let i = 0; i < n; i++) {
      t0[i] = theta[i];
      w0[i] = omega[i];
      k1t[i] = w0[i];
    }
    this.accelerations(t0, w0, k1w);
    const hh = 0.5 * h;
    for (let i = 0; i < n; i++) {
      ts[i] = t0[i] + hh * k1t[i];
      ws[i] = w0[i] + hh * k1w[i];
      k2t[i] = ws[i];
    }
    this.accelerations(ts, ws, k2w);
    for (let i = 0; i < n; i++) {
      ts[i] = t0[i] + hh * k2t[i];
      ws[i] = w0[i] + hh * k2w[i];
      k3t[i] = ws[i];
    }
    this.accelerations(ts, ws, k3w);
    for (let i = 0; i < n; i++) {
      ts[i] = t0[i] + h * k3t[i];
      ws[i] = w0[i] + h * k3w[i];
      k4t[i] = ws[i];
    }
    this.accelerations(ts, ws, k4w);
    const h6 = h / 6;
    for (let i = 0; i < n; i++) {
      theta[i] = wrapAngle(t0[i] + h6 * (k1t[i] + 2 * k2t[i] + 2 * k3t[i] + k4t[i]));
      omega[i] = w0[i] + h6 * (k1w[i] + 2 * k2w[i] + 2 * k3w[i] + k4w[i]);
    }
  }

  /**
   * Tries one Dormand–Prince 5(4) step of `h` seconds without changing the state: the fifth-order result goes to
   * `nextTheta` / `nextOmega`, and the return value is the embedded error estimate relative to `tol` – the largest of
   * |angle error| / tol and |rate error| / (tol · (1 + |θ̇|)) over the rods; at most 1 means the step is good. The first
   * stage is the slope at the current state, reused from the previous accepted step (or a rejected try) while the
   * state is unchanged, so an accepted step costs six evaluations of the accelerations.
   */
  tryStep(h: number, tol: number): number {
    const n = this.links;
    const { theta, omega, stageT, stageW, ts, ws, nextTheta, nextOmega, firstAtT, firstAtW } = this;
    let fresh = this.firstValid;
    for (let i = 0; i < n && fresh; i++) fresh = firstAtT[i] === theta[i] && firstAtW[i] === omega[i];
    if (!fresh) {
      for (let i = 0; i < n; i++) {
        stageT[0][i] = omega[i];
        firstAtT[i] = theta[i];
        firstAtW[i] = omega[i];
      }
      this.accelerations(theta, omega, stageW[0]);
      this.firstValid = true;
    }
    for (let s = 1; s < DP_STAGES - 1; s++) {
      const a = DP_A[s];
      for (let i = 0; i < n; i++) {
        let dt = 0;
        let dw = 0;
        for (let j = 0; j < s; j++) {
          dt += a[j] * stageT[j][i];
          dw += a[j] * stageW[j][i];
        }
        ts[i] = theta[i] + h * dt;
        ws[i] = omega[i] + h * dw;
        stageT[s][i] = ws[i];
      }
      this.accelerations(ts, ws, stageW[s]);
    }
    const last = DP_STAGES - 1;
    for (let i = 0; i < n; i++) {
      let dt = 0;
      let dw = 0;
      for (let j = 0; j < last; j++) {
        dt += DP_B[j] * stageT[j][i];
        dw += DP_B[j] * stageW[j][i];
      }
      nextTheta[i] = theta[i] + h * dt;
      nextOmega[i] = omega[i] + h * dw;
      stageT[last][i] = nextOmega[i];
    }
    this.accelerations(nextTheta, nextOmega, stageW[last]);
    let err = 0;
    for (let i = 0; i < n; i++) {
      let et = 0;
      let ew = 0;
      for (let j = 0; j < DP_STAGES; j++) {
        et += DP_E[j] * stageT[j][i];
        ew += DP_E[j] * stageW[j][i];
      }
      const e = Math.max(Math.abs(h * et), Math.abs(h * ew) / (1 + Math.max(Math.abs(omega[i]), Math.abs(nextOmega[i]))));
      if (e > err || Number.isNaN(e)) err = e;
    }
    return err / tol;
  }

  /** Moves the chain to the result of the last `tryStep()` (angles wrapped into (−π, π]); that step's last stage becomes the next step's first. */
  acceptStep() {
    const n = this.links;
    const last = DP_STAGES - 1;
    for (let i = 0; i < n; i++) {
      this.theta[i] = wrapAngle(this.nextTheta[i]);
      this.omega[i] = this.nextOmega[i];
      this.firstAtT[i] = this.theta[i];
      this.firstAtW[i] = this.omega[i];
    }
    // The last stage is the slope at the new state (up to the rounding of the wrap): swap it into the first slot.
    const t = this.stageT[0];
    this.stageT[0] = this.stageT[last];
    this.stageT[last] = t;
    const w = this.stageW[0];
    this.stageW[0] = this.stageW[last];
    this.stageW[last] = w;
    this.firstValid = true;
  }

  /** Largest |θ̇| of the chain (rad/s): `ChainStepper` caps the sub-step from it. */
  maxRate(): number {
    let m = 0;
    for (let i = 0; i < this.links; i++) {
      const v = Math.abs(this.omega[i]);
      if (v > m) m = v;
    }
    return m;
  }

  /** Kinetic energy ½ θ̇ᵀ M θ̇. */
  kineticEnergy(): number {
    const n = this.links;
    const m = this.massMatrix(this.theta, this.mat);
    let e = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) e += m[i * n + j] * this.omega[i] * this.omega[j];
    return 0.5 * e;
  }

  /** Potential energy −g Σ μᵢ lᵢ cos θᵢ (zero at the pivot's height, lowest with every rod hanging down). */
  potentialEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.links; i++) e -= this.gravity * this.mu[i] * this.lengths[i] * Math.cos(this.theta[i]);
    return e;
  }

  energy(): number {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  /** Position of bob `k` (0-based) relative to the pivot, model units, y down. */
  bobPosition(k: number, out: Vec2): Vec2 {
    let x = 0;
    let y = 0;
    for (let i = 0; i <= k && i < this.links; i++) {
      x += this.lengths[i] * Math.sin(this.theta[i]);
      y += this.lengths[i] * Math.cos(this.theta[i]);
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** Velocity of bob `k` (model units / s). */
  bobVelocity(k: number, out: Vec2): Vec2 {
    let x = 0;
    let y = 0;
    for (let i = 0; i <= k && i < this.links; i++) {
      const s = this.lengths[i] * this.omega[i];
      x += s * Math.cos(this.theta[i]);
      y -= s * Math.sin(this.theta[i]);
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /**
   * The change of the angular velocities an impulse (px, py) at bob `k` causes, Δθ̇ = M⁻¹ Jₖᵀ P (Jₖ the Jacobian of
   * the bob's position), written into `out`.
   */
  impulseResponse(k: number, px: number, py: number, out: Float64Array): Float64Array {
    const n = this.links;
    const a = this.massMatrix(this.theta, this.mat);
    const b = this.rhs;
    for (let i = 0; i < n; i++) b[i] = i <= k ? this.lengths[i] * (Math.cos(this.theta[i]) * px - Math.sin(this.theta[i]) * py) : 0;
    solveSpd(a, b, n);
    for (let i = 0; i < n; i++) out[i] = b[i];
    return out;
  }

  /**
   * How easily bob `k` moves along the unit direction (nx, ny): nᵀ Jₖ M⁻¹ Jₖᵀ n – the inverse of the bob's effective
   * mass along n (a free particle of mass m would give 1 / m). The collision impulse between two chains uses it.
   */
  inverseMassAlong(k: number, nx: number, ny: number, scratch: Float64Array): number {
    const d = this.impulseResponse(k, nx, ny, scratch);
    let s = 0;
    for (let i = 0; i <= k && i < this.links; i++) s += this.lengths[i] * (Math.cos(this.theta[i]) * nx - Math.sin(this.theta[i]) * ny) * d[i];
    return s;
  }

  /** Applies an impulse (px, py) at bob `k`: the angular velocities change by M⁻¹ Jₖᵀ P. */
  applyImpulse(k: number, px: number, py: number, scratch: Float64Array) {
    const d = this.impulseResponse(k, px, py, scratch);
    for (let i = 0; i < this.links; i++) this.omega[i] += d[i];
  }
}

/** Scratch for `collideBobs()` (one per caller, so nothing is allocated per contact). */
export interface ContactScratch {
  a: Float64Array;
  b: Float64Array;
  va: Vec2;
  vb: Vec2;
}

export function createContactScratch(): ContactScratch {
  return { a: new Float64Array(MAX_CHAIN_LINKS), b: new Float64Array(MAX_CHAIN_LINKS), va: { x: 0, y: 0 }, vb: { x: 0, y: 0 } };
}

/**
 * Resolves a contact between bob `ka` of chain `a` and bob `kb` of chain `b`, whose centres are (nx, ny) · distance
 * apart (n: the unit normal from a's bob to b's bob): if the bobs approach each other along n, an impulse along n
 * with restitution `e` is applied to both chains' angular velocities through their bobs (the generalised impulse
 * M⁻¹ Jᵀ P), so with e = 1 the chains' total kinetic energy is unchanged. Returns the approach speed (model units / s),
 * or 0 when the bobs were not approaching (nothing is applied).
 */
export function collideBobs(a: PendulumChain, ka: number, b: PendulumChain, kb: number, nx: number, ny: number, e: number, scratch: ContactScratch): number {
  a.bobVelocity(ka, scratch.va);
  b.bobVelocity(kb, scratch.vb);
  const vrel = (scratch.vb.x - scratch.va.x) * nx + (scratch.vb.y - scratch.va.y) * ny;
  if (!(vrel < 0)) return 0;
  const wa = a.inverseMassAlong(ka, nx, ny, scratch.a);
  const wb = b.inverseMassAlong(kb, nx, ny, scratch.b);
  const w = wa + wb;
  if (!(w > 0)) return 0;
  const j = (-(1 + e) * vrel) / w;
  a.applyImpulse(ka, -j * nx, -j * ny, scratch.a);
  b.applyImpulse(kb, j * nx, j * ny, scratch.b);
  return -vrel;
}

/**
 * Advances the chains of a rig together (the sparring contacts need them at the same instant) through a step of the
 * mode, in sub-steps of the Dormand–Prince pair:
 *
 *   stepper.begin(stepSec);
 *   for (let h; (h = stepper.subStep(chains)) > 0; ) { …the chains are `stepper.done` seconds into the step… }
 *
 * A sub-step is at most 1 / `MIN_SUBSTEPS` of the step, turns no rod more than `MAX_ANGLE_PER_SUBSTEP` (from the
 * fastest rod at its start), keeps the error estimate of every chain under `STEP_TOLERANCE` – a rejected try is
 * retried shorter, by the usual 0.9 · err^(−1/5) rule – and is never shorter than 1 / `MAX_SUBSTEPS` of the step
 * (then taken whatever the estimate). What is left of the step is split evenly, so the last sub-step ends exactly on it.
 * The length the controller would like next carries over from sub-step to sub-step and step to step (`reset()` for a
 * new run). Only the state decides, so the sub-steps – and the run – are deterministic.
 */
export class ChainStepper {
  /** Seconds of the current step done so far, and the sub-steps taken in it. */
  done = 0;
  count = 0;
  private stepSec = 0;
  private want = Infinity;

  /** A new run: forget the length the controller learnt. */
  reset() {
    this.want = Infinity;
    this.done = 0;
    this.stepSec = 0;
    this.count = 0;
  }

  /** Starts a step of `stepSec` seconds. */
  begin(stepSec: number) {
    this.stepSec = stepSec;
    this.done = 0;
    this.count = 0;
  }

  /** Takes the next sub-step of every chain and returns its length (seconds), or 0 once the step is complete. */
  subStep(chains: readonly PendulumChain[]): number {
    const stepSec = this.stepSec;
    const rest = stepSec - this.done;
    if (!(rest > 0) || chains.length === 0) return 0;
    const minH = stepSec / MAX_SUBSTEPS;
    let rate = 0;
    for (const c of chains) rate = Math.max(rate, c.maxRate());
    let h = Math.min(this.want, stepSec / MIN_SUBSTEPS);
    if (rate * h > MAX_ANGLE_PER_SUBSTEP) h = MAX_ANGLE_PER_SUBSTEP / rate;
    if (!(h > minH)) h = minH;
    h = rest / Math.max(1, Math.ceil(rest / h - 1e-9));
    let err = 0;
    for (;;) {
      err = 0;
      for (const c of chains) {
        const e = c.tryStep(h, STEP_TOLERANCE);
        if (e > err || Number.isNaN(e)) err = e;
      }
      if (!(err > 1) || h <= minH) break;
      h = Math.max(minH, h * Math.max(0.2, 0.9 * Math.pow(err, -0.2)));
    }
    for (const c of chains) c.acceptStep();
    this.done = h >= rest ? stepSec : this.done + h;
    this.count++;
    // Grow after an easy sub-step (at most 5×), shrink after a hard one.
    this.want = err > 0 ? h * Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.2))) : 5 * h;
    return h;
  }
}
