import { atLeastMin } from "@/lib/uncap";

/*
 * --- drawing-machine --- Drawing Machines (the loop family's two analytic drawing machines; lib/physics/modes/drawingMachine.ts
 * runs them, components/simulator/drawingMachineRenderer.ts draws them). Pure: the maths, the settings the engine runs and their
 * validation. Nothing here touches the engine, the page or the clock.
 *
 * (a) The harmonograph: damped pendulums drive one pen – a lateral one moves it left and right, a vertical one up and down and a
 *     rotary one round in a circle:
 *
 *         x(t) = Σ_lateral A·e^(−t/τ)·sin(2π f t + φ) + Σ_rotary A·e^(−t/τ)·sin(2π f t + φ)
 *         y(t) = Σ_vertical A·e^(−t/τ)·sin(2π f t + φ) + Σ_rotary A·e^(−t/τ)·cos(2π f t + φ)
 *
 *     in units of the figure's radius (1 = the paper's edge). The vertical pendulum is tuned `detune` % above the lateral one
 *     (2 %: the figure drifts in and out of step and keeps twisting), the rotary one `rotary` × the lateral one's frequency, and
 *     friction (τ) shrinks the drawing toward the middle. The pen is sampled at `traceRateHz()` (240 Hz or more) of simulation
 *     time into a typed-array polyline (`DmTrace`), whose memory-safety ceiling drops the oldest points past it.
 * (b) The orbits: two bodies on circular orbits round a sun. With **Exact ratio** the inner one goes round p times while the
 *     outer one goes round q times in `years` (periods years/p and years/q: the pattern closes on the cycle's last frame);
 *     without it the bodies keep their real periods (365.256 d for the Earth, 224.701 d for Venus…), so the pattern creeps
 *     round a little every cycle. Every `lineDays` days a straight chord joins them and stays; at every conjunction (the
 *     relative angle crossing 0, once every synodic period S = 1 / |1/P_inner − 1/P_outer|) a mark is put at the outer body,
 *     and the marks are joined in order (13 : 8 → five marks 144° apart: a pentagram).
 *
 * Both draw for one cycle and then reset to frame 0: the harmonograph's paper scrolls a fresh sheet in, the orbits hold and then
 * rewind (the counter runs back to 0.0 and the chords un-draw newest first). Nothing is random but the orbits' groove-bed
 * progression (one ctx.random() draw at the mode's init).
 */

/* ------------------------------------------------------------------ machines, inks, bodies */

export const DM_MACHINES = ["harmonograph", "orbits"] as const;
export type DmMachine = (typeof DM_MACHINES)[number];
export function isDmMachine(value: unknown): value is DmMachine {
  return typeof value === "string" && (DM_MACHINES as readonly string[]).includes(value);
}

/** The ink ramps: "auto" is the machine's own (violet → crimson ink on paper, blue → violet → magenta light in space). */
export const DM_INKS = ["auto", "ink", "nebula", "ember", "ocean", "rainbow"] as const;
export type DmInk = (typeof DM_INKS)[number];
export function isDmInk(value: unknown): value is DmInk {
  return typeof value === "string" && (DM_INKS as readonly string[]).includes(value);
}

/** The stops of every ramp (the colour drifts through them over a cycle). */
export const DM_INK_STOPS: Readonly<Record<Exclude<DmInk, "auto">, readonly string[]>> = {
  ink: ["#5b55c9", "#c93a5c"],
  nebula: ["#3d7bff", "#8a5cff", "#ff4fc0"],
  ember: ["#ffb347", "#ff5e3a", "#c2185b"],
  ocean: ["#2ec4b6", "#3a86ff"],
  rainbow: ["#ff4d4d", "#ffd23f", "#4dff88", "#4dd2ff", "#9b5cff", "#ff4fd8"],
};

/** The ramp a machine draws with: its own for "auto". */
export function dmInkStops(ink: DmInk, machine: DmMachine): readonly string[] {
  if (ink === "auto") return machine === "orbits" ? DM_INK_STOPS.nebula : DM_INK_STOPS.ink;
  return DM_INK_STOPS[ink];
}

/** The bodies of the orbits: their real sidereal periods (days), orbit radius (AU), colour and drawn size (px of a 720 px frame). */
export const DM_BODIES = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
export type DmBody = (typeof DM_BODIES)[number];
export function isDmBody(value: unknown): value is DmBody {
  return typeof value === "string" && (DM_BODIES as readonly string[]).includes(value);
}
export interface DmBodySpec {
  periodDays: number;
  au: number;
  color: string;
  sizePx: number;
}
export const DM_BODY_SPECS: Readonly<Record<DmBody, DmBodySpec>> = {
  mercury: { periodDays: 87.969, au: 0.387, color: "#b9b4ad", sizePx: 4.5 },
  venus: { periodDays: 224.701, au: 0.723, color: "#f6dc9a", sizePx: 6 },
  earth: { periodDays: 365.256, au: 1, color: "#4aa8ff", sizePx: 7 },
  mars: { periodDays: 686.98, au: 1.524, color: "#ff7a59", sizePx: 5.5 },
  jupiter: { periodDays: 4332.59, au: 5.203, color: "#e8b27a", sizePx: 9 },
  saturn: { periodDays: 10759.22, au: 9.537, color: "#f1d38a", sizePx: 8 },
  uranus: { periodDays: 30688.5, au: 19.19, color: "#9fe3e6", sizePx: 7 },
  neptune: { periodDays: 60182, au: 30.07, color: "#5b7cff", sizePx: 7 },
};
/** Days in the counter's year (the Earth's sidereal year: the Earth goes round once a "year"). */
export const DM_DAYS_PER_YEAR = 365.256;

/* ------------------------------------------------------------------ settings */

export interface DrawingMachineSettings {
  machine: DmMachine;
  /** Harmonograph: the lateral pendulum's frequency (Hz), the vertical one's detune (%), the rotary one's ratio to the lateral. */
  freq: number;
  detune: number;
  rotary: number;
  /** Friction: the swings' time constant τ (s): every amplitude is × e^(−t/τ). */
  damping: number;
  /** The swings' amplitudes (% of the figure's radius: 100 reaches the paper's edge) and phases (degrees). */
  ampX: number;
  ampY: number;
  ampR: number;
  phaseX: number;
  phaseY: number;
  phaseR: number;
  /** Seconds of drawing, then of the paper's scroll (the loop's reset). */
  drawSec: number;
  scrollSec: number;
  /** Orbits: the inner and the outer body (names, colours, real periods). */
  inner: DmBody;
  outer: DmBody;
  /** p : q – the inner body's orbits while the outer one makes q (Exact ratio); the radius ratio inner / outer. */
  ratioP: number;
  ratioQ: number;
  exact: boolean;
  radiusRatio: number;
  /** A chord every `lineDays` days; the cycle's years, seconds a year, the hold at the end and the rewind (s). */
  lineDays: number;
  years: number;
  secPerYear: number;
  holdSec: number;
  rewindSec: number;
  /** Join the conjunction marks in order (the pentagram of 13 : 8). */
  pentagram: boolean;
  /** The ink ramp, and the machine's sounds (the drone and the ratchet, or the bed, the plucks and the wash). */
  ink: DmInk;
  sound: boolean;
}

export const DEFAULT_DRAWING_MACHINE_SETTINGS: Readonly<DrawingMachineSettings> = {
  machine: "harmonograph",
  freq: 1.5,
  detune: 2,
  rotary: 2,
  damping: 18,
  ampX: 50,
  ampY: 50,
  ampR: 35,
  phaseX: 0,
  phaseY: 90,
  phaseR: 0,
  drawSec: 22.5,
  scrollSec: 1.5,
  inner: "venus",
  outer: "earth",
  ratioP: 13,
  ratioQ: 8,
  exact: true,
  radiusRatio: 0.723,
  lineDays: 8,
  years: 8,
  secPerYear: 1.8,
  holdSec: 1.5,
  rewindSec: 3,
  pentagram: true,
  ink: "auto",
  sound: true,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const DM_RANGES = {
  dmFreq: { min: 0.01, max: 20, step: 0.01 },
  dmDetune: { min: 0, max: 50, step: 0.1 },
  dmRotary: { min: 0, max: 8, step: 0.05 },
  dmDamping: { min: 0.5, max: 600, step: 0.5 },
  dmAmpX: { min: 0, max: 150, step: 1 },
  dmAmpY: { min: 0, max: 150, step: 1 },
  dmAmpR: { min: 0, max: 150, step: 1 },
  dmPhaseX: { min: 0, max: 360, step: 1 },
  dmPhaseY: { min: 0, max: 360, step: 1 },
  dmPhaseR: { min: 0, max: 360, step: 1 },
  dmDraw: { min: 1, max: 600, step: 0.5 },
  dmScroll: { min: 0, max: 10, step: 0.1 },
  dmRatioP: { min: 1, max: 1000, step: 1 },
  dmRatioQ: { min: 1, max: 1000, step: 1 },
  dmRadius: { min: 0.05, max: 1, step: 0.001 },
  dmLineDays: { min: 0.1, max: 365, step: 0.1 },
  dmYears: { min: 0.1, max: 1000, step: 0.1 },
  dmSecPerYear: { min: 0.05, max: 60, step: 0.05 },
  dmHold: { min: 0, max: 10, step: 0.1 },
  dmRewind: { min: 0, max: 30, step: 0.1 },
} as const;
export type DmRangeKey = keyof typeof DM_RANGES;

/** A finite number from its slider's minimum up (--- uncap-all --- never a maximum), else the fallback. */
function numberOf(value: unknown, range: { min: number }, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) : fallback;
}

/** Fills in the defaults and validates every value (numbers from their minimum up, whole ratios, known names, real booleans). */
export function resolveDrawingMachineSettings(config: Partial<Record<keyof DrawingMachineSettings, unknown>> | null | undefined): DrawingMachineSettings {
  const c = config ?? {};
  const d = DEFAULT_DRAWING_MACHINE_SETTINGS;
  const R = DM_RANGES;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    machine: isDmMachine(c.machine) ? c.machine : d.machine,
    freq: numberOf(c.freq, R.dmFreq, d.freq),
    detune: numberOf(c.detune, R.dmDetune, d.detune),
    rotary: numberOf(c.rotary, R.dmRotary, d.rotary),
    damping: numberOf(c.damping, R.dmDamping, d.damping),
    ampX: numberOf(c.ampX, R.dmAmpX, d.ampX),
    ampY: numberOf(c.ampY, R.dmAmpY, d.ampY),
    ampR: numberOf(c.ampR, R.dmAmpR, d.ampR),
    phaseX: numberOf(c.phaseX, R.dmPhaseX, d.phaseX),
    phaseY: numberOf(c.phaseY, R.dmPhaseY, d.phaseY),
    phaseR: numberOf(c.phaseR, R.dmPhaseR, d.phaseR),
    drawSec: numberOf(c.drawSec, R.dmDraw, d.drawSec),
    scrollSec: numberOf(c.scrollSec, R.dmScroll, d.scrollSec),
    inner: isDmBody(c.inner) ? c.inner : d.inner,
    outer: isDmBody(c.outer) ? c.outer : d.outer,
    ratioP: Math.round(numberOf(c.ratioP, R.dmRatioP, d.ratioP)),
    ratioQ: Math.round(numberOf(c.ratioQ, R.dmRatioQ, d.ratioQ)),
    exact: bool(c.exact, d.exact),
    radiusRatio: numberOf(c.radiusRatio, R.dmRadius, d.radiusRatio),
    lineDays: numberOf(c.lineDays, R.dmLineDays, d.lineDays),
    years: numberOf(c.years, R.dmYears, d.years),
    secPerYear: numberOf(c.secPerYear, R.dmSecPerYear, d.secPerYear),
    holdSec: numberOf(c.holdSec, R.dmHold, d.holdSec),
    rewindSec: numberOf(c.rewindSec, R.dmRewind, d.rewindSec),
    pentagram: bool(c.pentagram, d.pentagram),
    ink: isDmInk(c.ink) ? c.ink : d.ink,
    sound: bool(c.sound, d.sound),
  };
}

/* ------------------------------------------------------------------ easing and colour */

/** A raised-cosine ease (0 → 1, flat at both ends): the scroll, the rewind and the drone's swell back. */
export function dmEase(u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/** "#rrggbb" as [r, g, b] (0–255); black for anything else. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The ramp's colour `u` (0–1) of the way through its stops, as [r, g, b] (written into `out`). */
export function rampRgb(stops: readonly string[], u: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (stops.length === 0) {
    out[0] = out[1] = out[2] = 255;
    return out;
  }
  if (stops.length === 1) {
    const c = hexRgb(stops[0]);
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    return out;
  }
  const x = (u <= 0 ? 0 : u >= 1 ? 1 : u) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexRgb(stops[i]);
  const b = hexRgb(stops[i + 1]);
  out[0] = Math.round(a[0] + (b[0] - a[0]) * f);
  out[1] = Math.round(a[1] + (b[1] - a[1]) * f);
  out[2] = Math.round(a[2] + (b[2] - a[2]) * f);
  return out;
}

/* ------------------------------------------------------------------ (a) the harmonograph */

/** Which way a pendulum moves the pen: left and right, up and down, or round in a circle. */
export type DmAxis = "x" | "y" | "rotary";
export interface DmPendulum {
  axis: DmAxis;
  /** Amplitude (figure radii), frequency (Hz), phase (rad), damping time constant τ (s; Infinity: none). */
  amp: number;
  freq: number;
  phase: number;
  tau: number;
}

const DEG = Math.PI / 180;

/** The three pendulums of the settings: lateral (f1), vertical (f1 × (1 + detune %)), rotary (f1 × ratio), one friction. */
export function harmonographPendulums(s: Pick<DrawingMachineSettings, "freq" | "detune" | "rotary" | "damping" | "ampX" | "ampY" | "ampR" | "phaseX" | "phaseY" | "phaseR">): DmPendulum[] {
  const tau = s.damping > 0 ? s.damping : Infinity;
  return [
    { axis: "x", amp: s.ampX / 100, freq: s.freq, phase: s.phaseX * DEG, tau },
    { axis: "y", amp: s.ampY / 100, freq: s.freq * (1 + s.detune / 100), phase: s.phaseY * DEG, tau },
    { axis: "rotary", amp: s.ampR / 100, freq: s.freq * s.rotary, phase: s.phaseR * DEG, tau },
  ];
}

/** The friction's envelope at `t` (s): e^(−t/τ) (1 without friction). */
export function penEnvelope(tau: number, t: number): number {
  return tau > 0 && Number.isFinite(tau) ? Math.exp(-t / tau) : 1;
}

/** Where the pen is at `t` (s) and how fast it moves (figure radii, and radii a second), written into `out`. */
export interface DmPen {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export function penAt(pendulums: readonly DmPendulum[], t: number, out: DmPen = { x: 0, y: 0, vx: 0, vy: 0 }): DmPen {
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  for (const p of pendulums) {
    if (p.amp === 0) continue;
    const env = penEnvelope(p.tau, t);
    const k = p.tau > 0 && Number.isFinite(p.tau) ? -1 / p.tau : 0;
    const w = 2 * Math.PI * p.freq;
    const arg = w * t + p.phase;
    const s = Math.sin(arg);
    const c = Math.cos(arg);
    const a = p.amp * env;
    // d/dt [A e^(kt) sin(wt+φ)] = A e^(kt) (k sin + w cos); d/dt [A e^(kt) cos] = A e^(kt) (k cos − w sin)
    if (p.axis === "x") {
      x += a * s;
      vx += a * (k * s + w * c);
    } else if (p.axis === "y") {
      y += a * s;
      vy += a * (k * s + w * c);
    } else {
      x += a * s;
      y += a * c;
      vx += a * (k * s + w * c);
      vy += a * (k * c - w * s);
    }
  }
  out.x = x;
  out.y = y;
  out.vx = vx;
  out.vy = vy;
  return out;
}

/** The pendulums' energy at `t` over their energy at 0 (Σ A²ω² e^(−2t/τ) / Σ A²ω²; 1 when nothing swings). */
export function penEnergy(pendulums: readonly DmPendulum[], t: number): number {
  let e0 = 0;
  let e = 0;
  for (const p of pendulums) {
    const w = 2 * Math.PI * p.freq;
    const base = p.amp * p.amp * w * w;
    const env = penEnvelope(p.tau, t);
    e0 += base;
    e += base * env * env;
  }
  return e0 > 0 ? e / e0 : 1;
}

/** The pen's top speed (radii a second): Σ |A|·(2π|f| + 1/τ), which |v| never exceeds – the scratch's and the ripple's 1. */
export function penSpeedRef(pendulums: readonly DmPendulum[]): number {
  let v = 0;
  for (const p of pendulums) v += Math.abs(p.amp) * (2 * Math.PI * Math.abs(p.freq) + (p.tau > 0 && Number.isFinite(p.tau) ? 1 / p.tau : 0));
  return v;
}

/** The trace's samples a second of simulation time: 240, or 64 a swing of the fastest pendulum, at most DM_TRACE_MAX_RATE. */
export const DM_TRACE_MIN_RATE = 240;
export const DM_TRACE_PER_SWING = 64;
export const DM_TRACE_MAX_RATE = 1_200_000;
export function traceRateHz(pendulums: readonly DmPendulum[]): number {
  let fmax = 0;
  for (const p of pendulums) if (p.amp !== 0 && Math.abs(p.freq) > fmax) fmax = Math.abs(p.freq);
  const rate = Math.max(DM_TRACE_MIN_RATE, DM_TRACE_PER_SWING * fmax);
  return Number.isFinite(rate) ? Math.min(DM_TRACE_MAX_RATE, rate) : DM_TRACE_MAX_RATE;
}

/** The trace's memory-safety ceiling (points: two Float32 each, 3.2 MB): past it the oldest points are dropped. */
export const DM_TRACE_CEILING = 400_000;

/**
 * The pen's polyline: a ring buffer of points (figure radii) with the simulation time of each – `total` points pushed since the
 * last reset, the newest `count` of them kept (at most `capacity`: the oldest are dropped past it).
 */
export class DmTrace {
  readonly capacity: number;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly ts: Float32Array;
  /** Points pushed since the last reset, and of them the ones still held (the newest). */
  total = 0;
  count = 0;
  constructor(capacity: number = DM_TRACE_CEILING) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.xs = new Float32Array(this.capacity);
    this.ys = new Float32Array(this.capacity);
    this.ts = new Float32Array(this.capacity);
  }
  reset() {
    this.total = 0;
    this.count = 0;
  }
  push(x: number, y: number, t: number) {
    const i = this.total % this.capacity;
    this.xs[i] = x;
    this.ys[i] = y;
    this.ts[i] = t;
    this.total++;
    if (this.count < this.capacity) this.count++;
  }
  /** The first point index still held (points before it were dropped). */
  get first(): number {
    return this.total - this.count;
  }
  /** Whether point `index` (0 = the first pushed since the reset) is still held. */
  has(index: number): boolean {
    return index >= this.first && index < this.total;
  }
  /** The slot of point `index` in the arrays (call `has()` first). */
  slot(index: number): number {
    return index % this.capacity;
  }
}

/* ------------------------------------------------------------------ (b) the orbits */

/** The two periods (years): years / p and years / q with Exact ratio, else the bodies' real ones. */
export function orbitPeriods(s: Pick<DrawingMachineSettings, "exact" | "years" | "ratioP" | "ratioQ" | "inner" | "outer">): { inner: number; outer: number } {
  if (s.exact) return { inner: s.years / Math.max(1, s.ratioP), outer: s.years / Math.max(1, s.ratioQ) };
  return { inner: DM_BODY_SPECS[s.inner].periodDays / DM_DAYS_PER_YEAR, outer: DM_BODY_SPECS[s.outer].periodDays / DM_DAYS_PER_YEAR };
}

/** Where both bodies start (rad, canvas angles): at the top, lined up – the cycle opens on a conjunction. */
export const DM_ORBIT_START = -Math.PI / 2;

/** A body's angle (rad, canvas angles: anticlockwise on screen) `t` years in, with period `period` years. */
export function orbitAngle(period: number, t: number, start: number = DM_ORBIT_START): number {
  return period > 0 && Number.isFinite(period) ? start - (2 * Math.PI * t) / period : start;
}

/** The synodic period (years): one conjunction to the next (Infinity for equal periods: they never meet again). */
export function conjunctionPeriod(inner: number, outer: number): number {
  const rate = Math.abs(1 / inner - 1 / outer);
  return rate > 0 && Number.isFinite(rate) ? 1 / rate : Infinity;
}

const EPS = 1e-9;

/** Conjunctions at years 0 … `t` (the start's included): ⌊t / S⌋ + 1. */
export function conjunctionsUpTo(t: number, synodic: number): number {
  if (!(t >= 0)) return 0;
  if (!Number.isFinite(synodic) || !(synodic > 0)) return 1;
  return Math.floor(t / synodic + EPS) + 1;
}

/** The conjunctions of one cycle, the start's included and the one that may close it at its very end left out: years in [0, years). */
export function conjunctionsPerCycle(years: number, synodic: number): number {
  if (!Number.isFinite(synodic) || !(synodic > 0)) return 1;
  return Math.ceil(years / synodic - EPS);
}

/** The years between two chords. */
export function chordStepYears(lineDays: number): number {
  return lineDays / DM_DAYS_PER_YEAR;
}

/** The chords of a cycle: one every `dt` years after the start, up to `years` (none at year 0). */
export function chordsPerCycle(years: number, dt: number): number {
  return dt > 0 ? Math.floor(years / dt + EPS) : 0;
}

/**
 * What a frame draws at most of a cycle's chords and conjunction marks (the accumulation layer replays them on a rewind or a
 * resize): past it every n-th one is drawn (`dmStride()`), so a chord every hour over a thousand years still draws in a frame –
 * cheaper, never stalled. The chords and the marks are worked out from the clock, so nothing is allocated for them.
 */
export const DM_CHORD_DRAW_CEILING = 20_000;
export const DM_MARK_DRAW_CEILING = 2_000;
/** Every n-th of `count` things a frame draws to stay within `ceiling` (1: all of them). */
export function dmStride(count: number, ceiling: number): number {
  if (!(count > ceiling) || !(ceiling >= 1)) return 1;
  return Number.isFinite(count) ? Math.ceil(count / ceiling) : Number.MAX_SAFE_INTEGER;
}

/** The chords drawn by year `t` of a cycle: those at dt, 2·dt, … ≤ t (at most `total`). */
export function chordsBy(t: number, dt: number, total: number): number {
  if (!(t > 0) || !(dt > 0)) return 0;
  return Math.min(total, Math.floor(t / dt + EPS));
}

/** The year counter's value as shown: ⌊year × 10⌋ / 10 – "year 8.0" only once year 8 is reached, "0.0" at the end of the rewind. */
export function yearShown(year: number): number {
  if (!(year > 0)) return 0;
  return Math.floor(year * 10 + 1e-6) / 10;
}

/* ------------------------------------------------------------------ the cycle */

export type DmPhase = "draw" | "scroll" | "hold" | "rewind";

/** One cycle's phases (s): the drawing, then the harmonograph's scroll – or the orbits' hold and rewind. */
export interface DmTimeline {
  draw: number;
  scroll: number;
  hold: number;
  rewind: number;
  cycle: number;
}

/** The cycle of the settings' machine. */
export function dmTimeline(s: Pick<DrawingMachineSettings, "machine" | "drawSec" | "scrollSec" | "years" | "secPerYear" | "holdSec" | "rewindSec">): DmTimeline {
  if (s.machine === "harmonograph") return { draw: s.drawSec, scroll: s.scrollSec, hold: 0, rewind: 0, cycle: s.drawSec + s.scrollSec };
  const draw = s.years * s.secPerYear;
  return { draw, scroll: 0, hold: s.holdSec, rewind: s.rewindSec, cycle: draw + s.holdSec + s.rewindSec };
}

/** The phase at `tau` seconds into a cycle and how far through it (0–1). */
export function dmPhaseAt(tl: DmTimeline, tau: number): { phase: DmPhase; progress: number } {
  if (tau < tl.draw) return { phase: "draw", progress: tl.draw > 0 ? tau / tl.draw : 1 };
  if (tl.scroll > 0 && tau < tl.draw + tl.scroll) return { phase: "scroll", progress: (tau - tl.draw) / tl.scroll };
  if (tl.hold > 0 && tau < tl.draw + tl.hold) return { phase: "hold", progress: (tau - tl.draw) / tl.hold };
  if (tl.rewind > 0 && tau < tl.draw + tl.hold + tl.rewind) return { phase: "rewind", progress: (tau - tl.draw - tl.hold) / tl.rewind };
  return { phase: tl.scroll > 0 ? "scroll" : tl.rewind > 0 ? "rewind" : tl.hold > 0 ? "hold" : "draw", progress: 1 };
}

/** The orbits' year at `tau` seconds into a cycle: counting up while it draws, `years` through the hold, back to 0 in the rewind. */
export function orbitsYearAt(tl: DmTimeline, years: number, secPerYear: number, tau: number): number {
  if (tau <= 0) return 0;
  if (tau < tl.draw) return secPerYear > 0 ? Math.min(years, tau / secPerYear) : years;
  if (tau < tl.draw + tl.hold) return years;
  if (tl.rewind > 0 && tau < tl.draw + tl.hold + tl.rewind) return years * (1 - dmEase((tau - tl.draw - tl.hold) / tl.rewind));
  return tl.rewind > 0 ? 0 : years;
}

/** The groove bed of the orbits: whole bars of 4 beats per cycle (a multiple of the progression's 4 chords) near 110 BPM. */
export function orbitsBedBars(cycleSec: number): { bars: number; barSec: number; bpm: number } {
  const bars = Math.max(4, 4 * Math.round((cycleSec * 110) / 960));
  const barSec = cycleSec > 0 ? cycleSec / bars : 0;
  return { bars, barSec, bpm: barSec > 0 ? 240 / barSec : 0 };
}
