import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- ellipse-foci --- Focus Shot (the whispering-gallery shot of the loop family; lib/physics/modes/ellipseFoci.ts runs it):
 * the maths, the settings and their URL keys, the presets and the pure helpers the mode, the renderer, the finder and the tests
 * share. Nothing here touches the engine.
 *
 * The geometry runs on the unit ellipse u²/1 + w²/b² = 1 (the major semi-axis is 1, b = √(1 − e²), the foci at u = ±e): the
 * page's size only scales the picture (`toWorld()`), so a run is the same on every canvas. A ball fired from a focus F at the
 * speed v = 2 / T (major axes a second) meets the wall after `rayToWall()` (the positive root of the ray–ellipse quadratic),
 * leaves it mirrored about the normal (u, w / b²) (`reflectAtWall()`) and – the focal property – passes straight through the
 * other focus; every focus–wall–focus path is 2 long, so every ball of a volley fired at once arrives there together, one
 * transit T later, whichever way it was fired. A ball's direction at a focus is kept as ψ, its angle from the direction AWAY
 * from the other focus: tan(ψ/2) shrinks by (1 − e) / (1 + e) every pass (`nextPsi()`), so the volley collapses onto the long
 * axis – the comet that slides along it after a few passes (a ball fired exactly at the other focus stays on the axis, the
 * far vertex's fixed point; every other ball ends up bouncing off the near vertex).
 */

/* ------------------------------------------------------------------ options */

export const EF_LAUNCHES = ["top", "bottom"] as const;
export type EfLaunch = (typeof EF_LAUNCHES)[number];
export const EF_ORIENTATIONS = ["vertical", "horizontal"] as const;
export type EfOrientation = (typeof EF_ORIENTATIONS)[number];
/** At a convergence: refire a fresh volley at the start focus every `passes` transits, let the swarm collapse forever, or refire every pass. */
export const EF_RESETS = ["refire", "collapse", "every"] as const;
export type EfReset = (typeof EF_RESETS)[number];
/** The look: the pool table (wooden rim, copper rail, felt), a neon outline, or a thin line. */
export const EF_SKINS = ["table", "neon", "minimal"] as const;
export type EfSkin = (typeof EF_SKINS)[number];

export function isEfLaunch(value: unknown): value is EfLaunch {
  return typeof value === "string" && (EF_LAUNCHES as readonly string[]).includes(value);
}
export function isEfOrientation(value: unknown): value is EfOrientation {
  return typeof value === "string" && (EF_ORIENTATIONS as readonly string[]).includes(value);
}
export function isEfReset(value: unknown): value is EfReset {
  return typeof value === "string" && (EF_RESETS as readonly string[]).includes(value);
}
export function isEfSkin(value: unknown): value is EfSkin {
  return typeof value === "string" && (EF_SKINS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ constants */

/** The major semi-axis at Size 100 %: the ring modes' arena radius, 0.85 of the half square the recorder crops (the safe area). */
export const EF_SAFE_RADIUS = 0.425;
/** The flattest ellipse a run builds: an eccentricity of 1 or more has no inside (the link keeps the typed value). */
export const EF_MAX_RUN_ECCENTRICITY = 0.9999;
/** A ball's radius as a share of the page's Ball Size (the clip's small dots: about 1.4 % of the major semi-axis). */
export const EF_BALL_SCALE = 0.35;
/** Simulation seconds an event at a convergence or a beat may come early and still count (floating-point steps). */
export const EF_TIME_EPS = 1e-9;
/** A volley converges when every ball lands within this share of the major semi-axis of the focus (exact arithmetic: 0). */
export const EF_CONVERGE_EPS = 1e-6;
/** Corners (wall hits, the launch) a ball keeps for its trail and its path: past this many the oldest goes. */
export const EF_VERTEX_CAP = 16;
/** The paths overlay's stroke budget: the Lines mode's (LINES_MAX_BOUNCE_POINTS) – a big volley draws its newest corners. */
export const EF_PATH_POINT_BUDGET = 1000;
/** Passes the finder's collapse count follows at most. */
export const EF_COLLAPSE_HORIZON = 64;
/** Beats a transit is long: a convergence every two bars of four, the groove bed at 8 · 60 / T BPM. */
export const EF_BEATS_PER_TRANSIT = 8;

/* ------------------------------------------------------------------ the pitch and the chords (G major pentatonic) */

/** G3: the key's root (the pad's chords, the impact's tonic triad on G3, the completion chord on G2). */
export const EF_KEY_ROOT_MIDI = 55;
/** The wall hits' ladder: 14 degrees of G major pentatonic from D4 (degree 0) to A6 (degree 13), run downwards within a transit. */
export const EF_PITCH_SPAN = 13;
const EF_LADDER_BASE_DEGREE = 3;
/** The impact's chord root (G3: G3, D4, G4) and the completion chord's root at a loop's seam (G2). */
export const EF_IMPACT_HZ = midiToFrequency(EF_KEY_ROOT_MIDI);
export const EF_CHORD_HZ = midiToFrequency(EF_KEY_ROOT_MIDI - 12);

/** The pitch (Hz) of ladder degree `degree` (0 = D4, the bottom; EF_PITCH_SPAN = A6, the top). */
export function ladderHz(degree: number): number {
  const d = Math.max(0, Math.min(EF_PITCH_SPAN, Math.round(degree)));
  return midiToFrequency(degreeToMidi(EF_LADDER_BASE_DEGREE + d, EF_KEY_ROOT_MIDI, "majorPentatonic"));
}

/**
 * The share (0–1) of an even volley that has hit the wall by the time a ball travels `dist` (unit major axis) from the focus:
 * the hit-order rule of the descending run. A ball fired at angle θ from the direction of the other focus meets the wall
 * after b² / (1 − e cos θ) – the near vertex first (θ = π), the far vertex last (θ = 0) – so the share hit by then is
 * 1 − |θ| / π. A circle (e = 0) hits everywhere at once: 0.
 */
export function hitShare(dist: number, e: number): number {
  if (!(e > 1e-9) || !Number.isFinite(dist) || dist <= 0) return 0;
  const b2 = 1 - e * e;
  const cos = (1 - b2 / dist) / e;
  const theta = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
  return 1 - theta / Math.PI;
}

/** The ladder degree of a wall hit `dist` from the focus: the top for the first hits of a volley, the bottom for the last. */
export function hitDegree(dist: number, e: number): number {
  return EF_PITCH_SPAN - Math.round(hitShare(dist, e) * EF_PITCH_SPAN);
}

/* ------------------------------------------------------------------ geometry (unit major semi-axis) */

/** The minor semi-axis of the unit ellipse of eccentricity `e` (the run's flattest, past it). */
export function minorAxis(e: number): number {
  const x = runEccentricity(e);
  return Math.sqrt(1 - x * x);
}

/** The eccentricity a run uses: a finite value in [0, EF_MAX_RUN_ECCENTRICITY]. */
export function runEccentricity(e: number): number {
  if (!Number.isFinite(e) || e <= 0) return 0;
  return e > EF_MAX_RUN_ECCENTRICITY ? EF_MAX_RUN_ECCENTRICITY : e;
}

/**
 * The distance from (pu, pw) along the unit direction (du, dw) to the wall of the ellipse u² + w²/b² = 1 – the positive root
 * of the ray–ellipse quadratic, in its stable form (a point on the wall moving inwards gets the far root, never 0).
 */
export function rayToWall(b: number, pu: number, pw: number, du: number, dw: number): number {
  const ib2 = 1 / (b * b);
  const A = du * du + dw * dw * ib2;
  const B = 2 * (pu * du + pw * dw * ib2);
  const C = pu * pu + pw * pw * ib2 - 1;
  const disc = B * B - 4 * A * C;
  const sq = disc > 0 ? Math.sqrt(disc) : 0;
  if (B < 0) return (sq - B) / (2 * A);
  const q = -0.5 * (B + sq);
  return q !== 0 ? C / q : 0;
}

/** The direction (du, dw) mirrored about the wall's normal at (qu, qw) – the normal of u² + w²/b² = 1 is (u, w / b²) – into `out`. */
export function reflectAtWall(b: number, qu: number, qw: number, du: number, dw: number, out: { du: number; dw: number }) {
  let nu = qu;
  let nw = qw / (b * b);
  const len = Math.hypot(nu, nw) || 1;
  nu /= len;
  nw /= len;
  const dot = du * nu + dw * nw;
  out.du = du - 2 * dot * nu;
  out.dw = dw - 2 * dot * nw;
  return out;
}

/** The closed-form distance from a focus to the wall at angle θ from the direction of the other focus: b² / (1 − e cos θ). */
export function focalDistance(e: number, theta: number): number {
  const x = runEccentricity(e);
  return (1 - x * x) / (1 - x * Math.cos(theta));
}

/** ψ of the next pass: tan(ψ'/2) = (1 − e) / (1 + e) · tan(ψ/2), ψ the angle from the direction away from the other focus. */
export function nextPsi(psi: number, e: number): number {
  const x = runEccentricity(e);
  return 2 * Math.atan(((1 - x) / (1 + x)) * Math.tan(psi / 2));
}

/** A ball's ψ (0–π) from its direction (du, dw) at the focus `fu` (−e or +e): the angle from the direction away from the other focus. */
export function psiOf(fu: number, du: number, dw: number): number {
  const away = fu < 0 ? -1 : 1;
  return Math.atan2(Math.abs(dw), du * away);
}

/** Where the page draws the ellipse (world px): its centre, the major semi-axis `scale` and the axis it lies along. */
export interface EllipseFrame {
  cx: number;
  cy: number;
  /** World px per unit (the major semi-axis). */
  scale: number;
  vertical: boolean;
}

/** The frame of a `width` × `height` world at Size `sizePct` %: centred, a major semi-axis of sizePct % of EF_SAFE_RADIUS × the shorter side. */
export function ellipseFrame(width: number, height: number, sizePct: number, orientation: EfOrientation, out: EllipseFrame = { cx: 0, cy: 0, scale: 1, vertical: true }): EllipseFrame {
  const w = Number.isFinite(width) && width > 0 ? width : 800;
  const h = Number.isFinite(height) && height > 0 ? height : 450;
  out.cx = w / 2;
  out.cy = h / 2;
  out.scale = Math.max(1e-6, (Math.max(0, sizePct) / 100) * EF_SAFE_RADIUS * Math.min(w, h));
  out.vertical = orientation !== "horizontal";
  return out;
}

/** A unit-ellipse point (u along the major axis, w along the minor) in world px. */
export function toWorld(frame: EllipseFrame, u: number, w: number, out: { x: number; y: number }) {
  if (frame.vertical) {
    out.x = frame.cx + w * frame.scale;
    out.y = frame.cy + u * frame.scale;
  } else {
    out.x = frame.cx + u * frame.scale;
    out.y = frame.cy + w * frame.scale;
  }
  return out;
}

/** The launch focus's u: the top (left) one at −e, the bottom (right) one at +e. */
export function launchFocusU(launch: EfLaunch, e: number): number {
  const x = runEccentricity(e);
  return launch === "bottom" ? x : -x;
}

/* ------------------------------------------------------------------ the volley */

/**
 * The launch angles (radians, from the direction of the other focus) of a volley of `count` balls: a full spread (360° and up)
 * shares the turn out evenly from `aimDeg`; a fan of `spreadDeg` < 360 spreads them from −spread/2 to +spread/2 (one ball:
 * straight at the other focus), turned by `aimDeg`. Aim 0 – or half a step – keeps the volley mirror-symmetric about the long
 * axis, so mirrored pairs hit the wall together.
 */
export function launchAngles(count: number, spreadDeg: number, aimDeg: number, out: Float64Array = new Float64Array(Math.max(0, count))): Float64Array {
  const n = out.length;
  const spread = (Math.max(0, Number.isFinite(spreadDeg) ? spreadDeg : 360) * Math.PI) / 180;
  const aim = ((Number.isFinite(aimDeg) ? aimDeg : 0) * Math.PI) / 180;
  const full = spread >= 2 * Math.PI - 1e-9;
  for (let i = 0; i < n; i++) {
    if (full) out[i] = aim + (i * spread) / n;
    else out[i] = aim + (n > 1 ? -spread / 2 + (i * spread) / (n - 1) : 0);
  }
  return out;
}

/** Ball `i`'s hue (degrees) of `count`: the hue wheel by launch order, turned by the run's seeded `offset`. */
export function ballHue(i: number, count: number, offset: number): number {
  const h = offset + (360 * i) / Math.max(1, count);
  return ((h % 360) + 360) % 360;
}

/** A ball's colour from its hue: bright, saturated (the clip's rainbow dots). */
export function ballColorOfHue(hue: number): string {
  return `hsl(${Math.round(hue)}, 95%, 62%)`;
}

/**
 * One ball fired from a focus: where it hits the wall (u, w), how far that is (unit major axis), the direction it leaves the
 * wall with, and where it lands one transit later (it should be the other focus: `arrivalError` is how far off it is).
 */
export interface FocalPass {
  dist: number;
  qu: number;
  qw: number;
  du: number;
  dw: number;
  arrivalU: number;
  arrivalW: number;
}

/** The pass of a ball leaving the focus `fu` with direction (du, dw) on the ellipse of minor semi-axis `b`, into `out`. */
export function focalPass(b: number, fu: number, du: number, dw: number, out: FocalPass): FocalPass {
  const dist = rayToWall(b, fu, 0, du, dw);
  const qu = fu + du * dist;
  const qw = dw * dist;
  const r = reflectAtWall(b, qu, qw, du, dw, SCRATCH_DIR);
  const rest = 2 - dist;
  out.dist = dist;
  out.qu = qu;
  out.qw = qw;
  out.du = r.du;
  out.dw = r.dw;
  out.arrivalU = qu + r.du * rest;
  out.arrivalW = qw + r.dw * rest;
  return out;
}
const SCRATCH_DIR = { du: 0, dw: 0 };

/**
 * The lateral spread of every pass of a volley fired from the launch focus (unit major axis): the farthest any ball's wall
 * hit lies from the long axis in pass 0, 1, … `passes − 1`.
 */
export function passSpreads(e: number, launch: EfLaunch, angles: ArrayLike<number>, passes: number): number[] {
  const x = runEccentricity(e);
  const b = Math.sqrt(1 - x * x);
  const n = angles.length;
  const fu0 = launchFocusU(launch, x);
  const sign = fu0 < 0 ? 1 : -1;
  const du = new Float64Array(n);
  const dw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    du[i] = sign * Math.cos(angles[i]);
    dw[i] = Math.sin(angles[i]);
  }
  const out: number[] = [];
  const pass: FocalPass = { dist: 0, qu: 0, qw: 0, du: 0, dw: 0, arrivalU: 0, arrivalW: 0 };
  let fu = fu0;
  for (let k = 0; k < passes; k++) {
    let spread = 0;
    for (let i = 0; i < n; i++) {
      focalPass(b, fu, du[i], dw[i], pass);
      const lat = Math.abs(pass.qw);
      if (lat > spread) spread = lat;
      du[i] = pass.du;
      dw[i] = pass.dw;
    }
    out.push(spread);
    fu = -fu;
  }
  return out;
}

/**
 * Passes until the swarm has collapsed: one past the last pass (within `horizon`) whose spread is still at least
 * `limit` (unit major axis; the finder's 2 ball radii) – 0 when it never was, −1 when it still is at the horizon (a circle never
 * collapses: every chord through its centre is a diameter).
 */
export function collapsePasses(e: number, launch: EfLaunch, angles: ArrayLike<number>, limit: number, horizon = EF_COLLAPSE_HORIZON): number {
  const spreads = passSpreads(e, launch, angles, horizon);
  let last = -1;
  for (let k = 0; k < spreads.length; k++) if (spreads[k] >= limit) last = k;
  if (last === spreads.length - 1) return -1;
  return last + 1;
}

/* ------------------------------------------------------------------ the loop */

/** The loop's length (s): `passes` transits for "refire", two for "every" (a volley from each focus), none for "collapse". */
export function efLoopSeconds(reset: EfReset, passes: number, transitSec: number): number | null {
  if (!(transitSec > 0)) return null;
  if (reset === "collapse") return null;
  if (reset === "every") return 2 * transitSec;
  return Math.max(1, Math.round(passes)) * transitSec;
}

/** The transits of a loop (refire: the passes; every: 2). */
export function efLoopTransits(reset: EfReset, passes: number): number {
  return reset === "every" ? 2 : Math.max(1, Math.round(passes));
}

/** Whether convergence `k` (k transits in) starts a fresh volley: refire every `passes`, every pass, or only the run's start. */
export function isRefire(reset: EfReset, passes: number, k: number): boolean {
  if (k === 0) return true;
  if (reset === "every") return true;
  if (reset === "collapse") return false;
  return k % Math.max(1, Math.round(passes)) === 0;
}

/** Whether convergence `k` is a loop's seam (the completion chord): refire every `passes`, every second pass, collapse every `passes`. */
export function isSeam(reset: EfReset, passes: number, k: number): boolean {
  if (reset === "every") return k % 2 === 0;
  return k % Math.max(1, Math.round(passes)) === 0;
}

/**
 * The loop HUD's pass counter at transit `k`: the passes done in the current loop – 0 at its start, so the frame at a seam is
 * the clip's first frame again – or, in a swarm left to collapse, every pass of the run.
 */
export function loopPassCount(reset: EfReset, passes: number, k: number): number {
  const kk = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0;
  if (reset === "collapse") return kk;
  return kk % efLoopTransits(reset, passes);
}

/** The groove bed's kicks: a beat of transit `k` – never in a refire loop's first transit (the drop comes at its first convergence). */
export function bedKicks(reset: EfReset, passes: number, k: number): boolean {
  if (reset === "every") return true;
  if (reset === "collapse") return k >= 1;
  return k % Math.max(1, Math.round(passes)) !== 0;
}

/** The chord (index into the bed's 4-chord progression) of transit `k`: the progression spread over the loop. */
export function bedChordIndex(reset: EfReset, passes: number, k: number): number {
  if (reset === "every") return k % 2;
  if (reset === "collapse") return k % 4;
  const p = Math.max(1, Math.round(passes));
  return Math.min(3, Math.floor((4 * (k % p)) / p));
}

/** The groove bed's tempo (BPM) for a transit of `transitSec`: two bars of four per transit. */
export function bedBpm(transitSec: number): number {
  return transitSec > 0 ? (EF_BEATS_PER_TRANSIT * 60) / transitSec : 0;
}

/** The pre-drop: the plucks of the last min(0.4 s, T / 10) before a convergence are 12 dB softer. */
export function thinningSeconds(transitSec: number): number {
  return Math.min(0.4, 0.1 * Math.max(0, transitSec));
}

/**
 * The convergence bloom's level (0–1) at `dt` seconds from a convergence (negative: before it): a 120 ms swell to the peak at
 * the convergence, a 400 ms decay after it.
 */
export function bloomLevel(dt: number): number {
  if (!Number.isFinite(dt) || dt < -0.12 || dt > 0.4) return 0;
  if (dt <= 0) {
    const x = 1 + dt / 0.12;
    return x * x;
  }
  const x = 1 - dt / 0.4;
  return x * x;
}

/** Where convergence `k` happens: the focus (u) the swarm lands on, and the focus a fresh volley leaves from (null: none). */
export interface ConvergenceFoci {
  arrival: number;
  launch: number | null;
}

/**
 * The foci of convergence `k` (k transits in; 0 is the run's start, the first volley) of a run fired from `launchU`: the swarm
 * lands on the start focus after an even number of transits since its volley and on the other one after an odd number; a
 * refire fires the fresh volley from the start focus (so an odd loop lights both), every pass from where the swarm landed.
 */
export function convergenceFoci(reset: EfReset, passes: number, k: number, launchU: number, out: ConvergenceFoci = { arrival: 0, launch: null }): ConvergenceFoci {
  const kk = Math.max(0, Math.round(k));
  if (kk === 0) {
    out.arrival = launchU;
    out.launch = launchU;
    return out;
  }
  if (reset === "refire") {
    const p = Math.max(1, Math.round(passes));
    const since = ((kk - 1) % p) + 1;
    out.arrival = since % 2 === 1 ? -launchU : launchU;
    out.launch = kk % p === 0 ? launchU : null;
    return out;
  }
  // collapse and every: the swarm alternates between the foci; every pass refires from where it landed
  out.arrival = kk % 2 === 1 ? -launchU : launchU;
  out.launch = reset === "every" ? out.arrival : null;
  return out;
}

/* ------------------------------------------------------------------ seeded choices */

/**
 * The run's random choices, in the order the mode draws them from `ctx.random()` at init (the order is part of the replay
 * contract): 1. the hue wheel's offset, 2. the groove bed's chord progression (drawn even with the bed off, so the order never
 * changes). The aim and everything else come from the settings.
 */
export interface EfSeededChoices {
  hueOffset: number;
  progression: number;
}

/* ------------------------------------------------------------------ settings */

/** What the mode runs (lib/physics/modes/ellipseFoci.ts); the look rides along for the canvas. */
export interface EllipseFociSettings {
  /** Balls in a volley (a run builds at most the memory-safety ceiling). */
  count: number;
  /** Eccentricity: 0 a circle (every ball back at the centre), 0.99 a long thin pool (a run builds at most EF_MAX_RUN_ECCENTRICITY). */
  eccentricity: number;
  /** The major semi-axis, % of the safe radius (the ring modes' arena). */
  sizePct: number;
  /** Seconds a transit lasts – focus to wall to focus: the speed is 2a / T. */
  transitSec: number;
  /** Transits in a loop (refire). */
  passes: number;
  /** The spread of the volley (degrees; 360 = every way, less = a fan aimed at the other focus). */
  spreadDeg: number;
  /** Degrees the whole volley is turned (0 = a ball straight at the other focus, the mirror-symmetric volley). */
  aimDeg: number;
  launch: EfLaunch;
  orientation: EfOrientation;
  /** The comet trails' length (s of flight). */
  trailSec: number;
  reset: EfReset;
  skin: EfSkin;
  /** The paths overlay: every chord of the loop drawn faintly. */
  paths: boolean;
  /** The groove bed: pad, sub and a kick on every beat at 8 · 60 / T BPM, under the plucks. */
  bed: boolean;
  /** The loop HUD's pass counter ("3 passes" under the pool; the clip has none). */
  counter: boolean;
}

/** The feature's fields of the SimulatorSettings object. */
export interface EllipseFociFields {
  /** Balls, 1–720 on the slider (URL `efN`). */
  efCount: number;
  /** Eccentricity, 0–0.99 on the slider (URL `efE`). */
  efEccentricity: number;
  /** Size, % of the safe radius, 50–140 on the slider (URL `efS`). */
  efSize: number;
  /** Transit time T (s), 0.5–20 on the slider (URL `efT`). */
  efTransit: number;
  /** Passes per loop, 1–16 on the slider (URL `efP`). */
  efPasses: number;
  /** Spread angle (°), 1–360 on the slider (URL `efA`). */
  efSpread: number;
  /** Start angle (°), 0–360 on the slider (URL `efAim`). */
  efAim: number;
  /** top | bottom (URL `efF`). */
  efLaunch: EfLaunch;
  /** vertical | horizontal (URL `efO`). */
  efOrientation: EfOrientation;
  /** Trail length (s), 0–2 on the slider (URL `efTr`). */
  efTrail: number;
  /** refire | collapse | every (URL `efR`). */
  efReset: EfReset;
  /** table | neon | minimal (URL `efK`). */
  efSkin: EfSkin;
  /** The paths overlay (URL `efPa`). */
  efPaths: boolean;
  /** The groove bed (URL `efB`). */
  efBed: boolean;
  /** The loop HUD's pass counter (URL `efC`). */
  efCounter: boolean;
}

export const DEFAULT_ELLIPSE_FOCI_FIELDS: Readonly<EllipseFociFields> = {
  efCount: 72,
  efEccentricity: 0.65,
  efSize: 100,
  efTransit: 4,
  efPasses: 4,
  efSpread: 360,
  efAim: 0,
  efLaunch: "top",
  efOrientation: "vertical",
  efTrail: 0.2,
  efReset: "refire",
  efSkin: "table",
  efPaths: false,
  efBed: true,
  efCounter: false,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const EF_RANGES = {
  efCount: { min: 1, max: 720, step: 1 },
  efEccentricity: { min: 0, max: 0.99, step: 0.01 },
  efSize: { min: 50, max: 140, step: 1 },
  efTransit: { min: 0.5, max: 20, step: 0.1 },
  efPasses: { min: 1, max: 16, step: 1 },
  efSpread: { min: 1, max: 360, step: 1 },
  efAim: { min: 0, max: 360, step: 0.5 },
  efTrail: { min: 0, max: 2, step: 0.05 },
} as const;

type NumberKey = keyof typeof EF_RANGES;
/** The fields the mode's engine reads (the volley, the geometry, the timing); the trail is the canvas'. */
export const EF_ENGINE_KEYS: readonly NumberKey[] = ["efCount", "efEccentricity", "efSize", "efTransit", "efPasses", "efSpread", "efAim"];
/** The fields a change of which restarts a run (the rest – the trail, the look, the paths, the bed and the counter – follow live). */
export const EF_RESTART_FIELDS: readonly (keyof EllipseFociFields)[] = ["efCount", "efEccentricity", "efSize", "efTransit", "efPasses", "efSpread", "efAim", "efLaunch", "efOrientation", "efReset"];

export function defaultEllipseFociFields(): EllipseFociFields {
  return { ...DEFAULT_ELLIPSE_FOCI_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_ELLIPSE_FOCI_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, EF_RANGES[key]);
  return key === "efCount" || key === "efPasses" ? Math.round(v) : v;
}

/** Validates the feature's fields (URL parameters, presets and project files alike). */
export function resolveEllipseFociFields(source: Partial<Record<keyof EllipseFociFields, unknown>> | null | undefined): EllipseFociFields {
  const s = source ?? {};
  const d = DEFAULT_ELLIPSE_FOCI_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    efCount: numberOf("efCount", s.efCount),
    efEccentricity: numberOf("efEccentricity", s.efEccentricity),
    efSize: numberOf("efSize", s.efSize),
    efTransit: numberOf("efTransit", s.efTransit),
    efPasses: numberOf("efPasses", s.efPasses),
    efSpread: numberOf("efSpread", s.efSpread),
    efAim: numberOf("efAim", s.efAim),
    efLaunch: isEfLaunch(s.efLaunch) ? s.efLaunch : d.efLaunch,
    efOrientation: isEfOrientation(s.efOrientation) ? s.efOrientation : d.efOrientation,
    efTrail: numberOf("efTrail", s.efTrail),
    efReset: isEfReset(s.efReset) ? s.efReset : d.efReset,
    efSkin: isEfSkin(s.efSkin) ? s.efSkin : d.efSkin,
    efPaths: bool(s.efPaths, d.efPaths),
    efBed: bool(s.efBed, d.efBed),
    efCounter: bool(s.efCounter, d.efCounter),
  };
}

/** What the mode runs of the fields (`engine.setEllipseFociSettings()`: the page, the finder, the exports). */
export function ellipseFociSettingsOf(s: EllipseFociFields): EllipseFociSettings {
  return {
    count: s.efCount,
    eccentricity: s.efEccentricity,
    sizePct: s.efSize,
    transitSec: s.efTransit,
    passes: s.efPasses,
    spreadDeg: s.efSpread,
    aimDeg: s.efAim,
    launch: s.efLaunch,
    orientation: s.efOrientation,
    trailSec: s.efTrail,
    reset: s.efReset,
    skin: s.efSkin,
    paths: s.efPaths,
    bed: s.efBed,
    counter: s.efCounter,
  };
}

/** The engine's settings back under the fields' names. */
export function ellipseFociSettingFields(s: EllipseFociSettings): EllipseFociFields {
  return {
    efCount: s.count,
    efEccentricity: s.eccentricity,
    efSize: s.sizePct,
    efTransit: s.transitSec,
    efPasses: s.passes,
    efSpread: s.spreadDeg,
    efAim: s.aimDeg,
    efLaunch: s.launch,
    efOrientation: s.orientation,
    efTrail: s.trailSec,
    efReset: s.reset,
    efSkin: s.skin,
    efPaths: s.paths,
    efBed: s.bed,
    efCounter: s.counter,
  };
}

/** The settings the engine runs, the defaults filled in and every value valid (a ball count past its ceiling runs the ceiling). */
export function resolveEllipseFociSettings(patch: Partial<EllipseFociSettings> | null | undefined): EllipseFociSettings {
  const base = ellipseFociSettingsOf(DEFAULT_ELLIPSE_FOCI_FIELDS);
  const out = ellipseFociSettingsOf(resolveEllipseFociFields(ellipseFociSettingFields({ ...base, ...(patch ?? {}) })));
  out.count = memoryCeiling("efCount", out.count);
  return out;
}

/** The look a fresh Focus Shot page starts with: the clip's near-black navy page and the loop HUD on (its title and subtitle). */
export const ELLIPSE_FOCI_LOOK = {
  backgroundType: "solid" as const,
  backgroundColors: ["#060912", "#060912"] as [string, string],
  loopHud: true,
};

/** The mode's own defaults beside the feature's fields (in Focus Shot only): its look. */
export function ellipseFociModeDefaults(mode: string): Partial<typeof ELLIPSE_FOCI_LOOK> {
  return mode === "ellipseFoci" ? { ...ELLIPSE_FOCI_LOOK, backgroundColors: [...ELLIPSE_FOCI_LOOK.backgroundColors] } : {};
}

/* ------------------------------------------------------------------ presets */

export const EF_PRESET_IDS = ["gallery", "billiard", "thousand", "circle", "fan"] as const;
export type EfPresetId = (typeof EF_PRESET_IDS)[number];

/** Translation keys (Controls namespace) of the presets' names. */
export const EF_PRESET_LABELS: Readonly<Record<EfPresetId, string>> = {
  gallery: "efPresetGallery",
  billiard: "efPresetBilliard",
  thousand: "efPresetThousand",
  circle: "efPresetCircle",
  fan: "efPresetFan",
};

export function isEfPresetId(value: unknown): value is EfPresetId {
  return typeof value === "string" && (EF_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields with the clip's look: Whispering gallery (the clip: 72 balls, e 0.65, T 4 s, 4 passes, the pool table),
 * Billiard focus shot (one ball at 50°, 2 s trail, the paths on), Thousand-ball volley (720 balls, 0.3 s trails), Circle
 * control (e 0: every ball back at the centre) and Fan (a 90° fan aimed at the other focus).
 */
export function ellipseFociPresetPatch(id: EfPresetId): EllipseFociFields & typeof ELLIPSE_FOCI_LOOK {
  const look = { ...ELLIPSE_FOCI_LOOK, backgroundColors: [...ELLIPSE_FOCI_LOOK.backgroundColors] as [string, string] };
  const base = defaultEllipseFociFields();
  if (id === "billiard") return { ...base, efCount: 1, efAim: 50, efTrail: 2, efPaths: true, ...look };
  if (id === "thousand") return { ...base, efCount: 720, efTrail: 0.3, ...look };
  if (id === "circle") return { ...base, efEccentricity: 0, ...look };
  if (id === "fan") return { ...base, efSpread: 90, ...look };
  return { ...base, ...look };
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields. */
export const EF_URL_KEYS: Readonly<Record<string, NumberKey>> = { efN: "efCount", efE: "efEccentricity", efS: "efSize", efT: "efTransit", efP: "efPasses", efA: "efSpread", efAim: "efAim", efTr: "efTrail" };
const BOOL_KEYS: Readonly<Record<string, "efPaths" | "efBed" | "efCounter">> = { efPa: "efPaths", efB: "efBed", efC: "efCounter" };

/** Writes the fields that differ from `base` (the mode's defaults): efN, efE, efS, efT, efP, efA, efAim, efTr, efF, efO, efR, efK, efPa, efB, efC. */
export function writeEllipseFociParams(settings: EllipseFociFields, base: EllipseFociFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(EF_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.efLaunch !== base.efLaunch) params.set("efF", settings.efLaunch);
  if (settings.efOrientation !== base.efOrientation) params.set("efO", settings.efOrientation);
  if (settings.efReset !== base.efReset) params.set("efR", settings.efReset);
  if (settings.efSkin !== base.efSkin) params.set("efK", settings.efSkin);
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readEllipseFociParams(params: URLSearchParams, settings: EllipseFociFields) {
  const next: Partial<Record<keyof EllipseFociFields, unknown>> = { ...settings };
  for (const [key, field] of Object.entries(EF_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const launch = params.get("efF");
  if (launch !== null) next.efLaunch = launch;
  const orientation = params.get("efO");
  if (orientation !== null) next.efOrientation = orientation;
  const reset = params.get("efR");
  if (reset !== null) next.efReset = reset;
  const skin = params.get("efK");
  if (skin !== null) next.efSkin = skin;
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveEllipseFociFields(next));
}
