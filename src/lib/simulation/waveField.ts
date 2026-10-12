/*
 * --- wave-tank --- The Wave Tank's water (lib/physics/modes/waveTank.ts runs it): a pure, deterministic 2D wave field – no
 * randomness, no clock, no DOM – in two models.
 *
 * 1. The grid ("grid", the default): u_tt = c²∇²u − (γ + σ)·u_t on a Float32 grid of `cols` × round(cols × depthRatio) cells
 *    (192 × 256 by default), solved by leapfrog steps (second order in time and space):
 *
 *      u⁺ = a · (2u + ν²·L(u) + dt²·g) − b · u⁻,   a = 1 / (1 + (γ + σ)·dt/2),   b = (1 − (γ + σ)·dt/2) · a,
 *
 *    with ν = c·dt/h the Courant number and L the 5-point Laplacian ((left + right) + (up + down) − 4·centre, summed in that
 *    order so a mirror-symmetric barrier keeps the field mirror-symmetric to the last bit). **Stability**: the explicit scheme
 *    is stable for ν ≤ 1/√2 in 2D; every outer step (1/60 s) is cut into the fewest equal sub-steps that keep ν ≤ 0.5
 *    (`WT_COURANT`), so any wave speed and any grid stay stable – a faster wave or a finer grid only costs more sub-steps.
 *    The damping terms are centred in time, which keeps the scheme stable for any γ and any sponge strength.
 *    - **Absorbing walls**: a sponge of at least 12 cells (`WT_SPONGE_MIN`; ¾ of a wavelength on a fine grid) outside the
 *      visible tank on the sides, the front and behind the source, its σ rising quadratically to σ_max = 10.4·c/(s·h)
 *      (a reflection of about 10⁻³ in theory); the outermost ring of cells is held at 0.
 *    - **The source**: a soft line source (it adds to the field and lets reflections through, so the gap between the source
 *      and the barrier never becomes a resonator) forced with g = (2cA/h)·ω·cos(ωt), which sends a plane wave A·sin(ω(t − z/c))
 *      each way; or soft point sources (the "two sources without a barrier" look), A·√(2λ/r) at a distance r.
 *    - **The barrier**: cells clamped to u = 0, every column but the gaps' (a gap opens the cells whose centre lies within half
 *      its width of its centre – at least one cell, two when its centre sits on a cell edge).
 * 2. The Huygens sum ("huygens"): the far field of every gap as a sum of cylindrical wavelets – M = ⌈4w/λ⌉ points across a gap
 *    of width w, each A·Δx·(1 + cos χ)/2 / √(λr) – plus the incident plane wave between the source and the barrier. Exact in
 *    the far field, cheap (a phasor per sample point and section) and periodic by construction.
 *
 * Units: the tank is 1 wide (x from −½ to ½) and `depthRatio` deep (z from 0 at the back to depthRatio at the front); speeds
 * are tank widths per second.
 */

/** The most cells a grid may hold (the memory-safety ceiling: ~4 M cells, five Float32/Uint8 arrays ≈ 70 MB at worst). */
export const WT_CELL_CEILING = 4_000_000;
/** The thinnest sponge (cells); a finer grid's sponge is ¾ of a wavelength. */
export const WT_SPONGE_MIN = 12;
/** The Courant number every sub-step keeps under (the 2D limit is 1/√2). */
export const WT_COURANT = 0.5;
/** The tank's depth over its width (the default 192 × 256 grid). */
export const WT_DEPTH_RATIO = 4 / 3;
/** The fewest columns a grid has. */
export const WT_MIN_COLS = 8;
/** The sponge's strength: σ_max = WT_SPONGE_STRENGTH · c / (sponge · h) (≈ 1.5 · ln 1000). */
export const WT_SPONGE_STRENGTH = 10.4;
/** The smallest distance (wavelengths) a Huygens wavelet is evaluated at (inside its gap the 1/√r sum would blow up). */
export const WT_HUYGENS_MIN_R = 0.25;
/** The point sources' strength: A·√(2λ/r) – amplitude A two wavelengths away. */
export const WT_POINT_REACH = 2;

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A grid's size: the visible columns and rows, the sponge, the full grid (nx × ny) and the cell size h (tank widths). */
export interface WaveGridSize {
  cols: number;
  rows: number;
  sponge: number;
  nx: number;
  ny: number;
  cells: number;
  h: number;
  /** True when the requested columns were lowered to keep the grid under the ceiling. */
  clamped: boolean;
}

/** The sponge (cells) for a wavelength of `wavelengthCells` cells: ¾ of it, at least WT_SPONGE_MIN, at most the tank's own width. */
export function spongeCells(wavelengthCells: number, cols = Infinity): number {
  const w = finite(wavelengthCells, 0);
  return Math.max(WT_SPONGE_MIN, Math.min(Math.max(WT_SPONGE_MIN, cols), Math.ceil(0.75 * Math.max(0, w))));
}

function sizeOf(cols: number, depthRatio: number, wavelength: number): WaveGridSize {
  const rows = Math.max(4, Math.round(cols * depthRatio));
  const sponge = spongeCells(wavelength * cols, cols);
  const nx = cols + 2 * sponge;
  const ny = rows + 2 * sponge;
  return { cols, rows, sponge, nx, ny, cells: nx * ny, h: 1 / cols, clamped: false };
}

/**
 * The grid for `cols` columns (any number: a value that would need more than `ceiling` cells is lowered until it fits, and the
 * result says so – the run keeps going on the biggest grid that fits instead of refusing).
 */
export function waveGridSize(cols: number, depthRatio = WT_DEPTH_RATIO, wavelength = 0.06, ceiling = WT_CELL_CEILING): WaveGridSize {
  const ratio = finite(depthRatio, WT_DEPTH_RATIO) > 0 ? finite(depthRatio, WT_DEPTH_RATIO) : WT_DEPTH_RATIO;
  const lambda = finite(wavelength, 0.06) > 0 ? finite(wavelength, 0.06) : 0.06;
  let c = Math.max(WT_MIN_COLS, Math.round(Math.min(1e9, finite(cols, 192))));
  let g = sizeOf(c, ratio, lambda);
  if (g.cells <= ceiling) return g;
  c = Math.max(WT_MIN_COLS, Math.floor(c * Math.sqrt(ceiling / g.cells)));
  g = sizeOf(c, ratio, lambda);
  while (g.cells > ceiling && c > WT_MIN_COLS) {
    c = Math.max(WT_MIN_COLS, Math.min(c - 1, Math.floor(c * 0.995)));
    g = sizeOf(c, ratio, lambda);
  }
  return { ...g, clamped: true };
}

/** Sub-steps an outer step of `stepSec` needs so a wave of speed `speed` keeps the Courant number under WT_COURANT on cells of `h`. */
export function substepsFor(stepSec: number, speed: number, h: number, courant = WT_COURANT): number {
  const need = (Math.abs(finite(speed, 0)) * finite(stepSec, 1 / 60)) / (courant * Math.max(1e-12, finite(h, 1)));
  return Math.max(1, Math.ceil(need - 1e-9));
}

export interface WaveFieldConfig {
  /** Visible columns across the tank (clamped under `ceiling`). */
  cols: number;
  depthRatio?: number;
  /** Wavelength and speed, in tank widths (per second). */
  wavelength: number;
  speed: number;
  /** γ (1/s): the whole water's damping. */
  damping?: number;
  /** The outer step the field is advanced by (1/60 s); it is cut into `substeps` equal sub-steps. */
  stepSec?: number;
  /** Absorbing sponge on the sides, the front and behind the source (off: hard walls – the energy test's closed box). */
  sponge?: boolean;
  courant?: number;
  ceiling?: number;
}

/** The grid model (see the header). */
export class WaveField {
  readonly size: WaveGridSize;
  readonly speed: number;
  readonly damping: number;
  /** The sub-step (s), the sub-steps an outer step takes and ν² = (c·dt/h)². */
  readonly dt: number;
  readonly substeps: number;
  readonly nu2: number;
  /** The field now and one sub-step ago (swapped every sub-step). */
  u: Float32Array;
  prev: Float32Array;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  /** The coefficients of the cells clear of the sponge (all equal: the inner loop keeps them in registers). */
  private readonly aIn: number;
  private readonly bIn: number;
  /** Blocked columns of the barrier (1 = clamped to 0) and its grid rows [j0, j1]; −1: no barrier. */
  private readonly blocked: Uint8Array;
  private barrierJ0 = -1;
  private barrierJ1 = -1;
  /** The line source's grid row (−1: none), and the point sources' cells with their weights. */
  private sourceRow = -1;
  private pointCells = new Int32Array(0);
  private pointWeights = new Float32Array(0);
  /** Sub-steps taken. */
  steps = 0;

  constructor(cfg: WaveFieldConfig) {
    const ratio = finite(cfg.depthRatio, WT_DEPTH_RATIO);
    const lambda = Math.max(1e-6, finite(cfg.wavelength, 0.06));
    this.size = waveGridSize(cfg.cols, ratio, lambda, finite(cfg.ceiling, WT_CELL_CEILING));
    this.speed = Math.max(1e-6, Math.abs(finite(cfg.speed, 0.3)));
    this.damping = Math.max(0, finite(cfg.damping, 0));
    const stepSec = Math.max(1e-6, finite(cfg.stepSec, 1 / 60));
    const h = this.size.h;
    this.substeps = substepsFor(stepSec, this.speed, h, finite(cfg.courant, WT_COURANT));
    this.dt = stepSec / this.substeps;
    const nu = (this.speed * this.dt) / h;
    this.nu2 = nu * nu;
    const { nx, ny, sponge } = this.size;
    this.u = new Float32Array(nx * ny);
    this.prev = new Float32Array(nx * ny);
    this.a = new Float32Array(nx * ny);
    this.b = new Float32Array(nx * ny);
    this.blocked = new Uint8Array(nx);
    const useSponge = cfg.sponge !== false;
    const sigmaMax = useSponge ? (WT_SPONGE_STRENGTH * this.speed) / (sponge * h) : 0;
    const sx = new Float64Array(nx);
    const sy = new Float64Array(ny);
    for (let i = 0; i < nx; i++) {
      const d = Math.max(sponge - i, i - (nx - 1 - sponge), 0) / sponge;
      sx[i] = sigmaMax * d * d;
    }
    for (let j = 0; j < ny; j++) {
      const d = Math.max(sponge - j, j - (ny - 1 - sponge), 0) / sponge;
      sy[j] = sigmaMax * d * d;
    }
    const half = this.dt / 2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s = (this.damping + sx[i] + sy[j]) * half;
        const a = 1 / (1 + s);
        this.a[j * nx + i] = a;
        this.b[j * nx + i] = (1 - s) * a;
      }
    }
    // (the same Float32 values the arrays hold, so a cell gives the same result in either loop)
    const inner = sponge * nx + sponge;
    this.aIn = this.a[inner];
    this.bIn = this.b[inner];
  }

  /** The grid column (fractional, cell centres on whole numbers) of tank position x (−½ … ½). */
  colAt(x: number): number {
    return (x + 0.5) / this.size.h - 0.5 + this.size.sponge;
  }
  /** The grid row (fractional) of tank depth z (0 at the back). */
  rowAt(z: number): number {
    return z / this.size.h - 0.5 + this.size.sponge;
  }
  /** The tank x of grid column i's centre (mirror-exact: column nx−1−i gives exactly −x). */
  xOfCol(i: number): number {
    return (2 * i + 1 - this.size.nx) / (2 * this.size.cols);
  }

  /** A soft line source along depth z (the wave-maker), or none. */
  setLineSource(z: number | null) {
    this.sourceRow = z === null ? -1 : Math.max(1, Math.min(this.size.ny - 2, Math.round(this.rowAt(z))));
  }
  /** Soft point sources at (x, z) each – one cell, or the two cells either side when x sits on a cell edge – or none. */
  setPointSources(xs: readonly number[], z: number) {
    const { nx, ny } = this.size;
    const j = Math.max(1, Math.min(ny - 2, Math.round(this.rowAt(z))));
    const cells: number[] = [];
    const weights: number[] = [];
    for (const x of xs) {
      const g = this.colAt(x);
      const lo = Math.floor(g);
      const f = g - lo;
      if (Math.abs(f - 0.5) < 1e-9) {
        for (const i of [lo, lo + 1]) if (i >= 1 && i <= nx - 2) {
          cells.push(j * nx + i);
          weights.push(0.5);
        }
      } else {
        const i = Math.round(g);
        if (i >= 1 && i <= nx - 2) {
          cells.push(j * nx + i);
          weights.push(1);
        }
      }
    }
    this.pointCells = Int32Array.from(cells);
    this.pointWeights = Float32Array.from(weights);
  }

  /**
   * The barrier: rows covering depths [z0, z1] (at least one), every visible-or-sponge column blocked but those whose centre
   * lies within half a gap's width of a gap centre (`gaps`: centres, tank x; `width`: tank widths). Null: no barrier.
   */
  setBarrier(z0: number, z1: number, gaps: readonly number[] | null, width = 0) {
    if (gaps === null) {
      this.barrierJ0 = -1;
      this.barrierJ1 = -1;
      this.blocked.fill(0);
      return;
    }
    const { nx, ny, h } = this.size;
    const j0 = Math.max(1, Math.min(ny - 2, Math.round(this.rowAt(z0))));
    const j1 = Math.max(j0, Math.min(ny - 2, Math.round(this.rowAt(z1))));
    this.barrierJ0 = j0;
    this.barrierJ1 = j1;
    const half = Math.max(width, h) / 2;
    for (let i = 0; i < nx; i++) {
      const x = this.xOfCol(i);
      let open = false;
      for (let g = 0; g < gaps.length && !open; g++) if (Math.abs(x - gaps[g]) <= half) open = true;
      this.blocked[i] = open ? 0 : 1;
    }
    // the clamp holds from now on (a newly blocked cell is 0 from the next sub-step)
    this.clampBarrier(this.u);
    this.clampBarrier(this.prev);
  }

  /** Columns of the barrier left open (the gaps' cells). */
  openColumns(): number {
    if (this.barrierJ0 < 0) return this.size.nx;
    let n = 0;
    for (let i = 0; i < this.blocked.length; i++) if (!this.blocked[i]) n++;
    return n;
  }

  private clampBarrier(f: Float32Array) {
    if (this.barrierJ0 < 0) return;
    const nx = this.size.nx;
    for (let j = this.barrierJ0; j <= this.barrierJ1; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) if (this.blocked[i]) f[row + i] = 0;
    }
  }

  /**
   * One sub-step: the leapfrog update of every inner cell, then the sources' forcing `lineForce` / `pointForce` (the value of
   * g for this sub-step; the caller's clock decides it) and the barrier's clamp. Allocates nothing.
   */
  step(lineForce = 0, pointForce = 0) {
    const { nx, ny, sponge } = this.size;
    const u = this.u;
    const p = this.prev;
    const a = this.a;
    const b = this.b;
    const nu2 = this.nu2;
    const aIn = this.aIn;
    const bIn = this.bIn;
    const s0 = Math.max(1, sponge);
    const s1 = Math.min(nx - 1, nx - sponge);
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx;
      const band = j < sponge || j >= ny - sponge;
      // the sponge cells (and every cell of a sponge row) read their own coefficients; the inner cells share aIn / bIn
      const lo = band ? nx - 1 : s0;
      const hi = band ? nx - 1 : s1;
      for (let i = 1; i < lo; i++) {
        const k = row + i;
        const c = u[k];
        const lap = u[k - 1] + u[k + 1] + (u[k - nx] + u[k + nx]) - 4 * c;
        p[k] = a[k] * (2 * c + nu2 * lap) - b[k] * p[k];
      }
      for (let i = lo; i < hi; i++) {
        const k = row + i;
        const c = u[k];
        const lap = u[k - 1] + u[k + 1] + (u[k - nx] + u[k + nx]) - 4 * c;
        p[k] = aIn * (2 * c + nu2 * lap) - bIn * p[k];
      }
      for (let i = Math.max(lo, hi); i < nx - 1; i++) {
        const k = row + i;
        const c = u[k];
        const lap = u[k - 1] + u[k + 1] + (u[k - nx] + u[k + nx]) - 4 * c;
        p[k] = a[k] * (2 * c + nu2 * lap) - b[k] * p[k];
      }
    }
    const dt2 = this.dt * this.dt;
    if (this.sourceRow >= 0 && lineForce !== 0) {
      const row = this.sourceRow * nx;
      const f = dt2 * lineForce;
      for (let i = 1; i < nx - 1; i++) p[row + i] += a[row + i] * f;
    }
    if (pointForce !== 0) {
      const f = dt2 * pointForce;
      for (let s = 0; s < this.pointCells.length; s++) {
        const k = this.pointCells[s];
        p[k] += a[k] * f * this.pointWeights[s];
      }
    }
    this.clampBarrier(p);
    this.prev = u;
    this.u = p;
    this.steps++;
  }

  /** The field at tank position (x, z), bilinear between the cell centres (0 outside the grid). */
  sample(x: number, z: number): number {
    const { nx, ny } = this.size;
    const gi = this.colAt(x);
    const gj = this.rowAt(z);
    if (!(gi >= 0 && gj >= 0 && gi <= nx - 1 && gj <= ny - 1)) return 0;
    const i0 = Math.min(nx - 2, Math.floor(gi));
    const j0 = Math.min(ny - 2, Math.floor(gj));
    const fx = gi - i0;
    const fz = gj - j0;
    const k = j0 * nx + i0;
    const u = this.u;
    const top = u[k] + (u[k + 1] - u[k]) * fx;
    const bottom = u[k + nx] + (u[k + nx + 1] - u[k + nx]) * fx;
    return top + (bottom - top) * fz;
  }

  /**
   * The discrete energy: ½Σ((u − u⁻)/dt)² + ½c²Σ|∇u|² (forward differences), times the cell area – conserved up to a
   * bounded wobble by the leapfrog scheme without damping, sponge or source.
   */
  energy(): number {
    const { nx, ny, h } = this.size;
    const u = this.u;
    const p = this.prev;
    const inv = 1 / this.dt;
    const c2 = (this.speed * this.speed) / (h * h);
    let kinetic = 0;
    let potential = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const v = (u[k] - p[k]) * inv;
        kinetic += v * v;
        if (i + 1 < nx) {
          const d = u[k + 1] - u[k];
          potential += d * d;
        }
        if (j + 1 < ny) {
          const d = u[k + nx] - u[k];
          potential += d * d;
        }
      }
    }
    return 0.5 * (kinetic + c2 * potential) * h * h;
  }

  /** The largest |u| of the visible tank, and how many cells are not finite (always 0 for a stable run). */
  stats(out: { maxAbs: number; nonFinite: number } = { maxAbs: 0, nonFinite: 0 }) {
    const { nx, sponge, cols, rows } = this.size;
    let m = 0;
    let bad = 0;
    for (let j = sponge; j < sponge + rows; j++) {
      const row = j * nx;
      for (let i = sponge; i < sponge + cols; i++) {
        const v = this.u[row + i];
        if (!Number.isFinite(v)) bad++;
        else if (Math.abs(v) > m) m = Math.abs(v);
      }
    }
    out.maxAbs = m;
    out.nonFinite = bad;
    return out;
  }

  /** Back to still water (the sources and the barrier stay). */
  reset() {
    this.u.fill(0);
    this.prev.fill(0);
    this.steps = 0;
  }
}

/** g's gain for the line source: (2cA/h) – the forcing is that × ω·cos(ωt) (a plane wave A·sin(ω(t − z/c)) each way). */
export function lineSourceGain(amplitude: number, speed: number, h: number): number {
  return (2 * speed * amplitude) / h;
}

/** g's gain for a point source on one cell: A·c²·√(8π·k·r₀)/h² with r₀ = WT_POINT_REACH wavelengths (amplitude A there). */
export function pointSourceGain(amplitude: number, speed: number, h: number): number {
  const kr = 2 * Math.PI * WT_POINT_REACH;
  return (amplitude * speed * speed * Math.sqrt(8 * Math.PI * kr)) / (h * h);
}

/* ------------------------------------------------------------------ gaps */

/** The centres (tank x) of `count` gaps `spacing` apart, centred on the tank (mirror-exact: gap g and count−1−g are ±). */
export function gapCenters(count: number, spacing: number): number[] {
  const n = Math.max(0, Math.floor(finite(count, 0)));
  const d = finite(spacing, 0);
  const out: number[] = [];
  const mid = (n - 1) / 2;
  for (let g = 0; g < n; g++) out.push((g - mid) * d);
  return out;
}

/** The gaps whose opening reaches into the tank (|centre| − width/2 < ½): those beyond its walls are left out. */
export function gapsInTank(centers: readonly number[], width: number): number[] {
  return centers.filter((c) => Math.abs(c) - width / 2 < 0.5);
}

/* ------------------------------------------------------------------ the Huygens model */

/** One Huygens wavelet: its place and weight. */
export interface HuygensSource {
  x: number;
  z: number;
  weight: number;
}

/** Wavelets a section is summed from at most (a wide gap of many wavelengths, or very many gaps, share them out). */
export const WT_HUYGENS_POINTS = 512;

/**
 * The wavelets of a section: gaps of `width` at `centers` on the barrier's front face `z` (M = ⌈4w/λ⌉ points a gap – at most
 * WT_HUYGENS_POINTS in all, at least one a gap – each A·Δx/√λ; a gap wider than the tank is the tank's width), or – `points` –
 * one point source a centre (A·√(WT_POINT_REACH·λ)).
 */
export function huygensSources(centers: readonly number[], width: number, z: number, wavelength: number, amplitude: number, points: boolean): HuygensSource[] {
  const out: HuygensSource[] = [];
  const lambda = Math.max(1e-9, wavelength);
  if (points) {
    for (const c of centers) out.push({ x: c, z, weight: amplitude * Math.sqrt(WT_POINT_REACH * lambda) });
    return out;
  }
  const w = Math.max(1e-9, Math.min(1, width));
  const share = Math.max(1, Math.floor(WT_HUYGENS_POINTS / Math.max(1, centers.length)));
  const m = Math.max(1, Math.min(share, Math.ceil((4 * w) / lambda)));
  const dx = w / m;
  const weight = (amplitude * dx) / Math.sqrt(lambda);
  for (const c of centers) for (let i = 0; i < m; i++) out.push({ x: c - w / 2 + (i + 0.5) * dx, z, weight });
  return out;
}

/** A phasor: the field is c·cos(ωt) + s·sin(ωt). */
export interface Phasor {
  c: number;
  s: number;
}

/**
 * The Huygens field's phasor at (x, z): the wavelets of `sources` (with the obliquity (1 + cos χ)/2 unless `points`), each
 * lagging the incident wave at the barrier by `phase0` (k times the source-to-barrier distance) – into `out`.
 */
export function huygensPhasor(x: number, z: number, sources: readonly HuygensSource[], wavelength: number, phase0: number, points: boolean, out: Phasor): Phasor {
  const k = (2 * Math.PI) / wavelength;
  const rMin = WT_HUYGENS_MIN_R * wavelength;
  let c = 0;
  let s = 0;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const dx = x - src.x;
    const dz = z - src.z;
    const r = Math.max(rMin, Math.sqrt(dx * dx + dz * dz));
    const tilt = points ? 1 : (1 + Math.max(-1, Math.min(1, dz / r))) / 2;
    const amp = (src.weight * tilt) / Math.sqrt(r);
    const theta = phase0 + k * r + Math.PI / 4;
    // amp · sin(ωt − θ) = amp·(sin ωt · cos θ − cos ωt · sin θ)
    c -= amp * Math.sin(theta);
    s += amp * Math.cos(theta);
  }
  out.c = c;
  out.s = s;
  return out;
}

/** The incident plane wave's phasor at depth z (the source at zs): A·sin(ωt − k(z − zs)). */
export function planePhasor(z: number, zs: number, wavelength: number, amplitude: number, out: Phasor): Phasor {
  const theta = ((2 * Math.PI) / wavelength) * (z - zs);
  out.c = -amplitude * Math.sin(theta);
  out.s = amplitude * Math.cos(theta);
  return out;
}

/* ------------------------------------------------------------------ the bells */

/** The bell row's ping-pong: strike k of a row of n bells (0, 1, …, n−1, n−2, …, 1, 0, 1, …). */
export function pingPong(k: number, n: number): number {
  const bells = Math.max(1, Math.floor(n));
  if (bells === 1) return 0;
  const period = 2 * (bells - 1);
  const pos = ((Math.floor(k) % period) + period) % period;
  return pos < bells ? pos : period - pos;
}

/** A bell's loudness for the amplitude under it over the row's reference: (|a| / max)^1.5, 0–1 (rises with |a|). */
export function bellGain(amplitude: number, maxAmplitude: number): number {
  if (!(maxAmplitude > 0) || !Number.isFinite(amplitude)) return 0;
  const x = Math.min(1, Math.abs(amplitude) / maxAmplitude);
  return Math.pow(x, 1.5);
}
