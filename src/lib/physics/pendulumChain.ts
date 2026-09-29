/**
 * A planar chain pendulum – two links (the double pendulum) or three (the triple pendulum) – integrated with a
 * fixed-step, classic fourth-order Runge–Kutta scheme. Pure maths with no allocation after construction, so the
 * Double Pendulum mode (modes/doublePendulum.ts) can step several chains many times per 60 Hz step and stay inside
 * the frame budget, and so the unit tests can check the integrator directly (energy drift, collisions).
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
 */

/** Most rods a chain may have. */
export const MAX_CHAIN_LINKS = 3;

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

  /** Largest |θ̇| of the chain (rad/s): the mode picks its sub-step count from it. */
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
