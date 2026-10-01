import type { ModeId } from "@/lib/physics/types";
import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Cinematic camera: the settings and the pure maths behind the camera zoom, the screen shake on wall
 * breaks, the slow motion on near misses and the escape replay. Everything here is free of DOM and
 * canvas so it is unit-tested on its own (tests/camera.test.ts); the canvas side lives in
 * components/simulator/cameraRenderer.ts and the replay's ring buffer in ./replay.ts.
 *
 * None of it touches the physics: the camera only transforms what is drawn, the slow motion only scales
 * how much wall-clock time the canvas feeds to the fixed-step engine (a seed still runs exactly the same
 * 60 Hz steps, just more slowly) and the replay draws positions recorded from finished steps. Recordings
 * capture the canvas in real time, so an export shows the slow motion and the replay too.
 */

/** The cinematic-camera fields of `SimulatorSettings` (all off by default: the view is the classic one). */
export interface CameraSettings {
  /** 0–1: how far the view zooms toward the ball (the camera follows it); 0 = the classic camera follow (URL `cz`). */
  cameraZoom: number;
  /** 0–1: strength of the shake on every wall break, decaying over `SHAKE_DECAY_MS` (URL `shake`). */
  screenShake: number;
  /** The simulation clock slows down for a moment when the ball squeezes past a gap edge (URL `slow`). */
  slowMoOnNearMiss: boolean;
  /** Speed of the slow motion, 0.2–0.8 of real time (URL `slowf`). */
  slowMoFactor: number;
  /** Length of the slow-motion window in milliseconds of real time, 200–1500 (URL `slowms`). */
  slowMoMs: number;
  /** When a ball escapes the outer wall, the last 2 s play again at half speed before the end screen (URL `replay`). */
  replayOnEscape: boolean;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  cameraZoom: 0,
  screenShake: 0,
  slowMoOnNearMiss: false,
  slowMoFactor: 0.4,
  slowMoMs: 700,
  replayOnEscape: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const CAMERA_RANGES = {
  cameraZoom: { min: 0, max: 1, step: 0.05 },
  screenShake: { min: 0, max: 1, step: 0.05 },
  slowMoFactor: { min: 0.2, max: 0.8, step: 0.05 },
  slowMoMs: { min: 200, max: 1500, step: 50 },
} as const;

export const CAMERA_SETTING_KEYS = Object.keys(DEFAULT_CAMERA_SETTINGS) as (keyof CameraSettings)[];

/**
 * --- review fix (modes-gerald-odd) --- The slow motion stretches the real time a run takes (the recorder films real time): a
 * recording of `clipMs` is extended by the lag the slow motion adds while it records, at most this much – the whole clip played
 * at the slowest factor. A paused run adds no lag, so a recording never waits past it.
 */
export function maxSlowLagMs(clipMs: number): number {
  return Math.max(0, clipMs) * (1 / CAMERA_RANGES.slowMoFactor.min - 1);
}

/** Lag (ms) below which a recording is not extended any further (a few frames). */
export const SLOW_LAG_MIN_MS = 30;

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Fills in the defaults and clamps every number to its range; a non-number falls back to the default, a non-boolean flag to "off". */
export function resolveCameraSettings(source: Partial<CameraSettings> | null | undefined): CameraSettings {
  const out = { ...DEFAULT_CAMERA_SETTINGS };
  if (!source) return out;
  out.cameraZoom = clampNumber(source.cameraZoom, CAMERA_RANGES.cameraZoom, out.cameraZoom);
  out.screenShake = clampNumber(source.screenShake, CAMERA_RANGES.screenShake, out.screenShake);
  out.slowMoFactor = clampNumber(source.slowMoFactor, CAMERA_RANGES.slowMoFactor, out.slowMoFactor);
  out.slowMoMs = Math.round(clampNumber(source.slowMoMs, CAMERA_RANGES.slowMoMs, out.slowMoMs));
  out.slowMoOnNearMiss = source.slowMoOnNearMiss === true;
  out.replayOnEscape = source.replayOnEscape === true;
  return out;
}

/** Picks the camera fields out of a bigger object (the SimulatorSettings, a preset…). */
export function cameraSettingsOf(source: CameraSettings): CameraSettings {
  return {
    cameraZoom: source.cameraZoom,
    screenShake: source.screenShake,
    slowMoOnNearMiss: source.slowMoOnNearMiss,
    slowMoFactor: source.slowMoFactor,
    slowMoMs: source.slowMoMs,
    replayOnEscape: source.replayOnEscape,
  };
}

/** True when any camera feature is on (the renderer then takes over the view transform or the clock). */
export function cameraFeaturesOn(s: CameraSettings): boolean {
  return s.cameraZoom > 0 || s.screenShake > 0 || s.slowMoOnNearMiss || s.replayOnEscape;
}

/* ------------------------------------------------------------------ zoom and follow */

/** View scale at the strongest zoom (`cameraZoom` = 1). */
export const MAX_CAMERA_SCALE = 2.2;
/** Per-frame easing of the follow offset – the value the classic camera follow has always used. */
export const FOLLOW_EASE = 0.08;
/** Per-frame easing of the zoom level (a little slower than the follow, so zooming never snaps). */
export const ZOOM_EASE = 0.05;

/** View scale for a zoom setting: 1 at 0 (no zoom), `MAX_CAMERA_SCALE` at 1. */
export function zoomScale(cameraZoom: number): number {
  const z = Number.isFinite(cameraZoom) ? Math.max(0, cameraZoom) : 0; // --- uncap-all --- past 1 zooms further in
  return 1 + z * (MAX_CAMERA_SCALE - 1);
}

/**
 * How far (world px) the camera focus may move from the arena centre at view scale `scale`: half the
 * arena at 1× – exactly the classic follow – and more when zoomed in, so a ball against the outer wall
 * stays in frame (at 2.2× the focus may go 77 % of the way out).
 */
export function followLimit(arena: number, scale: number): number {
  return arena * (1 - 0.5 / Math.max(1, scale));
}

/**
 * Largest view scale ≤ `scale` that keeps a point `spread` world px away from the focus inside
 * `halfView` screen px (with a 10 % margin); never below 1. Used so a zoom on the first ball does not
 * crop the second one in the two-ball modes.
 */
export function fitScale(scale: number, spread: number, halfView: number): number {
  if (!(spread > 0) || !(halfView > 0)) return scale;
  return Math.max(1, Math.min(scale, (0.9 * halfView) / spread));
}

/** Where the camera looks: the focus point relative to the arena centre (world px) and the view scale. */
export interface CameraView {
  /** Focus offset from the arena centre; the classic follow translates the canvas by −offset. */
  offsetX: number;
  offsetY: number;
  /** View scale, 1 = no zoom. */
  scale: number;
}

export function createCameraView(): CameraView {
  return { offsetX: 0, offsetY: 0, scale: 1 };
}

export function resetCameraView(view: CameraView): CameraView {
  view.offsetX = 0;
  view.offsetY = 0;
  view.scale = 1;
  return view;
}

/** Inputs of one camera frame (a reusable object in the renderer, so a frame allocates nothing). */
export interface CameraFrame {
  centerX: number;
  centerY: number;
  /** Radius of the outer wall ring (the renderer's `arena`). */
  arena: number;
  /** Half the shorter canvas side, in screen px. */
  halfView: number;
  /** `cameraZoom` (0–1). */
  zoom: number;
  /** The camera follows the ball (camera follow on, or any zoom). */
  follow: boolean;
  /** A ball to look at. */
  hasTarget: boolean;
  targetX: number;
  targetY: number;
  /** Largest distance (world px) of another ball in play from the target; 0 with one ball. */
  spread: number;
}

export function createCameraFrame(): CameraFrame {
  return { centerX: 0, centerY: 0, arena: 0, halfView: 0, zoom: 0, follow: false, hasTarget: false, targetX: 0, targetY: 0, spread: 0 };
}

/**
 * Eases the view one frame toward its target: the focus toward the ball (clamped to `followLimit`) and
 * the scale toward the zoom level (reduced by `fitScale` to keep the other balls in frame). Without
 * follow the view snaps back to the plain one, as the classic follow did when switched off. With zoom 0
 * the result is the classic follow exactly: scale 1, focus eased by `FOLLOW_EASE` within half the arena.
 * Without a ball the focus stays where it is (the classic follow did not move either).
 */
export function stepCameraView(view: CameraView, f: CameraFrame): CameraView {
  if (!f.follow) return resetCameraView(view);
  let scaleTarget = zoomScale(f.zoom);
  if (f.hasTarget && f.spread > 0) scaleTarget = fitScale(scaleTarget, f.spread, f.halfView);
  view.scale += (scaleTarget - view.scale) * ZOOM_EASE;
  if (Math.abs(scaleTarget - view.scale) < 1e-4) view.scale = scaleTarget;
  if (!f.hasTarget) return view;
  const limit = followLimit(f.arena, view.scale);
  const tx = Math.max(-limit, Math.min(limit, f.targetX - f.centerX));
  const ty = Math.max(-limit, Math.min(limit, f.targetY - f.centerY));
  view.offsetX += (tx - view.offsetX) * FOLLOW_EASE;
  view.offsetY += (ty - view.offsetY) * FOLLOW_EASE;
  return view;
}

/** A canvas transform: screen = world × scale + (tx, ty). */
export interface CameraTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * The canvas transform of a view (plus a screen-space shake): the focus point lands on the arena centre
 * and the world is scaled around it. At scale 1 it is the classic follow's translate(−offset).
 */
export function cameraTransform(view: CameraView, centerX: number, centerY: number, shakeX: number, shakeY: number, out: CameraTransform): CameraTransform {
  const s = view.scale;
  out.scale = s;
  out.tx = centerX * (1 - s) - view.offsetX * s + shakeX;
  out.ty = centerY * (1 - s) - view.offsetY * s + shakeY;
  return out;
}

/** Maps a world point through a camera transform (for tests and hit-testing). */
export function worldToScreen(t: CameraTransform, x: number, y: number, out: { x: number; y: number }) {
  out.x = x * t.scale + t.tx;
  out.y = y * t.scale + t.ty;
  return out;
}

/* ------------------------------------------------------------------ screen shake */

/** A wall-break shake dies out over this many milliseconds. */
export const SHAKE_DECAY_MS = 300;
/** Peak shake at `screenShake` = 1, as a fraction of the shorter canvas side. */
export const MAX_SHAKE_FRACTION = 0.03;

/** 1 at the break, easing quadratically to 0 at `SHAKE_DECAY_MS` (0 before the break and after). */
export function shakeEnvelope(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= SHAKE_DECAY_MS) return 0;
  const k = 1 - ageMs / SHAKE_DECAY_MS;
  return k * k;
}

/** Peak shake offset in screen px for a `screenShake` setting on a canvas whose shorter side is `minDim`. */
export function shakeAmplitude(screenShake: number, minDim: number): number {
  const s = Number.isFinite(screenShake) ? Math.max(0, Math.min(1, screenShake)) : 0;
  return s * MAX_SHAKE_FRACTION * Math.max(0, minDim);
}

/**
 * Shake offset `ageMs` after a wall break: a fast wobble (~13 Hz) inside the decaying envelope, never
 * longer than `amplitude`. `seed` (the break count) turns the direction from one break to the next; it
 * is deterministic (no Math.random), so the same run always shakes the same way.
 */
export function shakeOffset(ageMs: number, amplitude: number, seed: number, out: { x: number; y: number }) {
  const e = shakeEnvelope(ageMs) * amplitude * Math.SQRT1_2;
  if (e === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const phase = seed * 2.399963; // golden angle: consecutive breaks shake in well-spread directions
  out.x = e * Math.sin(ageMs * 0.083 + phase);
  out.y = e * Math.cos(ageMs * 0.071 + 1.7 * phase);
  return out;
}

/* ------------------------------------------------------------------ slow motion */

/** The clock eases into the slow motion over this long (or a fifth of a shorter window) – quick, like a hit-stop. */
export const SLOW_MO_RAMP_IN_MS = 60;
/** …and back to real time over this long (or a third of a shorter window). */
export const SLOW_MO_RAMP_OUT_MS = 250;
/** Real time after a slow-motion window before the next near miss may start another one. */
export const SLOW_MO_COOLDOWN_MS = 800;

function smoothstep(x: number) {
  return x * x * (3 - 2 * x);
}

function rampIn(windowMs: number) {
  return Math.min(SLOW_MO_RAMP_IN_MS, 0.2 * windowMs);
}

/**
 * Simulation-time factor `elapsedMs` into a slow-motion window of `windowMs` (real time): eases from 1
 * down to `factor`, holds it, and eases back to 1 at the end of the window; 1 outside the window.
 */
export function slowMoTimeScale(elapsedMs: number, windowMs: number, factor: number): number {
  if (!(elapsedMs >= 0) || !(windowMs > 0) || elapsedMs >= windowMs) return 1;
  const f = Number.isFinite(factor) ? Math.max(0.05, Math.min(1, factor)) : 1;
  const inMs = rampIn(windowMs);
  const outMs = Math.min(SLOW_MO_RAMP_OUT_MS, windowMs / 3);
  let env = 1;
  if (elapsedMs < inMs) env = elapsedMs / inMs;
  else if (elapsedMs > windowMs - outMs) env = (windowMs - elapsedMs) / outMs;
  return 1 - (1 - f) * smoothstep(Math.max(0, Math.min(1, env)));
}

/**
 * The slow-motion window: a near miss starts it, another near miss inside it keeps it going (from the
 * end of the ease-in, so it never re-ramps), and after it ends a short cooldown keeps back-to-back near
 * misses from turning the whole run into slow motion. Time is real (wall-clock) time while the run plays.
 */
export class SlowMotion {
  private elapsed = Infinity;
  private cooldown = 0;
  /** Windows started so far (for the canvas' data attributes and tests). */
  started = 0;

  reset() {
    this.elapsed = Infinity;
    this.cooldown = 0;
  }

  isActive(windowMs: number) {
    return this.elapsed < windowMs;
  }

  /** A near miss: starts a window (true), extends the running one (true) or is ignored during the cooldown (false). */
  trigger(windowMs: number): boolean {
    if (this.isActive(windowMs)) {
      const hold = rampIn(windowMs);
      if (this.elapsed > hold) this.elapsed = hold;
      return true;
    }
    if (this.cooldown > 0) return false;
    this.elapsed = 0;
    this.started++;
    return true;
  }

  /** Advances the window by `realMs` of real time; the cooldown starts when the window ends. */
  advance(realMs: number, windowMs: number) {
    if (!(realMs > 0)) return;
    if (this.isActive(windowMs)) {
      this.elapsed += realMs;
      if (this.elapsed >= windowMs) {
        this.elapsed = Infinity;
        this.cooldown = SLOW_MO_COOLDOWN_MS;
      }
    } else if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - realMs);
  }

  timeScale(windowMs: number, factor: number): number {
    return this.elapsed === Infinity ? 1 : slowMoTimeScale(this.elapsed, windowMs, factor);
  }
}

/**
 * The ring modes, whose balls the canvas draws between the last two physics steps while the slow motion is on (see
 * stepInterpolation.ts). The rhythm modes, Glass Smash and the Multipliers board draw their own bodies and cameras
 * from their own state – and have no ring gaps to squeeze past, so no near misses and no slow motion either – so
 * they keep the engine's positions.
 */
export const SLOW_VIEW_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow"];
// --- odd-string-battle --- the String Battle slows down on its final cut (the near-miss hook): its balls glide between steps too
(SLOW_VIEW_MODES as ModeId[]).push("stringBattle");
// --- odd-territory --- Territory slows down when the lead flips in its finale (the near-miss hook): its balls glide between steps too
(SLOW_VIEW_MODES as ModeId[]).push("territory");

export function slowViewEligible(mode: ModeId | null | undefined): boolean {
  return !!mode && SLOW_VIEW_MODES.includes(mode);
}

/* ------------------------------------------------------------------ escape replay */

/** Simulation time kept for the replay. */
export const REPLAY_WINDOW_MS = 2000;
/** The replay plays at this fraction of real time (half speed). */
export const REPLAY_SPEED = 0.5;
/** Simulation time kept after the last ball got outside the outer wall, so the replay shows it flying out. */
export const REPLAY_POST_ROLL_MS = 500;
/** A replay shorter than this (in simulation time) is skipped: there is nothing worth replaying. */
export const REPLAY_MIN_MS = 250;

/** The modes whose run ends when a ball escapes the outer wall – the ones that get the escape replay. */
export const REPLAY_MODES: readonly ModeId[] = ["classic", "accumulation", "portal", "shatter", "colorMatch"];

export function replayEligible(mode: ModeId | null | undefined): boolean {
  return !!mode && REPLAY_MODES.includes(mode);
}

/** Real-time length of a replay of `windowMs` of simulation time. */
export function replayDurationMs(windowMs: number): number {
  return Math.max(0, windowMs) / REPLAY_SPEED;
}

/** Simulation time shown `realMs` into a replay of the window [startMs, endMs]. */
export function replayTimeAt(realMs: number, startMs: number, endMs: number): number {
  return Math.max(startMs, Math.min(endMs, startMs + Math.max(0, realMs) * REPLAY_SPEED));
}

/** True when every ball lies wholly outside the circle of radius `radius` around (cx, cy) – "escaped". */
export function allBallsOutside(balls: readonly { x: number; y: number; radius: number }[], cx: number, cy: number, radius: number): boolean {
  if (balls.length === 0 || !(radius > 0)) return false;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (Math.hypot(b.x - cx, b.y - cy) <= radius + b.radius) return false;
  }
  return true;
}
