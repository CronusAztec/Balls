import { isScaleId, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext } from "../types";
import { clampNumber, formatNumber, mulberry32, rhythmChord, rhythmPitch, toStep } from "./jdmRhythm";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * Paddle Keep-Up ("paddle" mode, feature jdm-rhythm-runner – the project.jdm "Ball Bounce Game with Moving Platform").
 * No rings: a portrait playfield (walls left and right, a ceiling) with a platform that slides left and right near the
 * bottom. A ball falls onto it under real gravity; every catch launches it back up (a centre hit higher – up to the
 * ceiling –, an edge hit lower) and the platform imparts sideways velocity and spin depending on where it was hit (and a
 * little of its own motion), so the ball wanders over the whole field, off the walls and the ceiling. Every platform hit
 * plays the next note (the next melody note while a melody is loaded – the ToneGenerator decides); the walls, the ceiling,
 * the streak chime, a miss and the game over only accompany the tune (`SoundEvent.melody` false), so the song advances on
 * the catches alone. A ball that gets past the platform is a miss; after `misses` allowed misses the next one is GAME OVER
 * and the run ends.
 *
 * pdAuto drives the platform with a deterministic controller (`planCatch()`): at every launch it predicts where the ball
 * will come down (`predictLanding()`: the exact ballistic flight with the ceiling bounce and the wall reflections folded
 * in) and heads there, placed for the off-centre hit that sends the ball off at a sideways speed it picked (from the
 * seed), so it plays the ball all over the field. `skill` (0–1) tunes it: below 1 the controller misjudges the timing –
 * it plans for the ball a little early or a little late (up to `TIMING_ERROR_SEC`), aims a little off (a heavy-tailed
 * error) and reacts with a delay, on a slower platform, each drawn from the game's generator – so misses happen
 * deterministically for a seed. At 1 it never misses. Without pdAuto the platform follows the pointer (or the
 * arrow keys) – a mini game.
 *
 * The motion is exact: the flight is integrated event by event (walls, ceiling, the platform line solved analytically)
 * in fixed internal sub-steps of the engine's 60 Hz steps, in the mode's own units (field heights), so a seed replays
 * the same on any canvas. The serves and the controller draw from the game's own generator, seeded from the engine's at
 * init (the engine's stream is shared with the cinematic director). `speedUp` makes every catch a little faster than the last (the whole flight runs k× faster:
 * gravity × k², speeds × k, up to 2×), which is what eventually beats a good controller.
 */

/* ------------------------------------------------------------------ settings */

export interface PaddleSettings {
  /** A deterministic controller drives the platform; off = the pointer / arrow keys. */
  auto: boolean;
  /** 0–1: how well the controller plays (1 never misses). */
  skill: number;
  /** Misses allowed before the next one is game over, 0–9. */
  misses: number;
  /** Platform width as a fraction of the field width, 0.12–0.5. */
  width: number;
  /** 0–1: how much an off-centre hit kicks the ball sideways (and spins it). */
  spin: number;
  /** 0–0.1: every catch runs the flight this much faster (up to 2×). */
  speedUp: number;
  /** The Sound section's scale and root: the notes of the catches climb its degrees. */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_PADDLE_SETTINGS: PaddleSettings = {
  auto: true,
  skill: 0.7,
  misses: 2,
  width: 0.26,
  spin: 0.6,
  speedUp: 0.02,
  scale: "chromatic",
  rootNote: 0,
};

export const PADDLE_RANGES = {
  pdSkill: { min: 0, max: 1, step: 0.05 },
  pdMisses: { min: 0, max: 9, step: 1 },
  pdWidth: { min: 0.12, max: 0.5, step: 0.01 },
  pdSpin: { min: 0, max: 1, step: 0.05 },
  pdSpeedUp: { min: 0, max: 0.1, step: 0.005 },
} as const;

/** The Paddle Keep-Up fields of the SimulatorSettings object (URL keys pda, pdsk, pdm, pdw, pdsp, pdu). */
export interface PaddleFields {
  pdAuto: boolean;
  pdSkill: number;
  pdMisses: number;
  pdWidth: number;
  pdSpin: number;
  pdSpeedUp: number;
}

export function resolvePaddleSettings(config: Partial<PaddleSettings> | null | undefined, unlimited = false): PaddleSettings {
  const out: PaddleSettings = { ...DEFAULT_PADDLE_SETTINGS };
  if (!config) return out;
  const R = rangesFor(PADDLE_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (typeof config.auto === "boolean") out.auto = config.auto;
  if (config.skill !== undefined) out.skill = toStep(clampNumber(config.skill, R.pdSkill, out.skill), R.pdSkill.step);
  if (config.misses !== undefined) out.misses = Math.round(clampNumber(config.misses, R.pdMisses, out.misses));
  if (config.width !== undefined) out.width = toStep(clampNumber(config.width, R.pdWidth, out.width), R.pdWidth.step);
  if (config.spin !== undefined) out.spin = toStep(clampNumber(config.spin, R.pdSpin, out.spin), R.pdSpin.step);
  if (config.speedUp !== undefined) out.speedUp = toStep(clampNumber(config.speedUp, R.pdSpeedUp, out.speedUp), R.pdSpeedUp.step);
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

export function paddleSettingsOf(source: PaddleFields & { scale?: ScaleId; rootNote?: number }): PaddleSettings {
  return {
    auto: source.pdAuto,
    skill: source.pdSkill,
    misses: source.pdMisses,
    width: source.pdWidth,
    spin: source.pdSpin,
    speedUp: source.pdSpeedUp,
    scale: source.scale ?? DEFAULT_PADDLE_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_PADDLE_SETTINGS.rootNote,
  };
}

export function paddleSettingFields(settings: PaddleSettings): PaddleFields {
  return { pdAuto: settings.auto, pdSkill: settings.skill, pdMisses: settings.misses, pdWidth: settings.width, pdSpin: settings.spin, pdSpeedUp: settings.speedUp };
}

export function defaultPaddleFields(): PaddleFields {
  return paddleSettingFields(DEFAULT_PADDLE_SETTINGS);
}

export function resolvePaddleFields(source: Partial<PaddleFields>): PaddleFields {
  return paddleSettingFields(resolvePaddleSettings({ auto: source.pdAuto, skill: source.pdSkill, misses: source.pdMisses, width: source.pdWidth, spin: source.pdSpin, speedUp: source.pdSpeedUp }));
}

const PADDLE_NUMERIC_KEYS = { pdsk: "pdSkill", pdm: "pdMisses", pdw: "pdWidth", pdsp: "pdSpin", pdu: "pdSpeedUp" } as const;

export function writePaddleParams(settings: PaddleFields, base: PaddleFields, params: URLSearchParams) {
  if (settings.pdAuto !== base.pdAuto) params.set("pda", settings.pdAuto ? "1" : "0");
  for (const [key, field] of Object.entries(PADDLE_NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
}

export function readPaddleParams(params: URLSearchParams, settings: PaddleFields) {
  const next: Partial<PaddleFields> = { ...settings };
  const auto = params.get("pda");
  if (auto === "1") next.pdAuto = true;
  else if (auto === "0") next.pdAuto = false;
  for (const [key, field] of Object.entries(PADDLE_NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  Object.assign(settings, resolvePaddleFields(next));
}

/** True when a run can never end: the platform is played by hand, or a perfect controller never misses. */
export function paddleNeverFinishes(settings: Partial<PaddleSettings> | null | undefined): boolean {
  const s = resolvePaddleSettings(settings);
  return !s.auto || s.skill >= 1;
}

/* ------------------------------------------------------------------ the field (units: field heights) */

/** Field width relative to its height (a portrait column inside the recorder's square). */
export const PD_ASPECT = 0.62;
/** The ceiling's underside, and the platform's top surface (fractions of the height from the top). */
export const PD_CEILING = 0.12;
export const PD_PLATFORM = 0.86;
/** Platform thickness. */
export const PD_THICKNESS = 0.022;
/** Ball radius at the default Ball Size (8). */
export const PD_BALL_R = 0.024;
/** Gravity (field heights/s²) at the default Gravity setting (300); the setting scales it 0.3×–3×. */
export const PADDLE_GRAVITY = 2.4;
/** Launch height above the platform as a fraction of the room below the ceiling: edge hit … centre hit (above 1 reaches the ceiling). */
export const APEX_EDGE = 0.72;
export const APEX_CENTRE = 1.1;
/** Sideways kick of a full off-centre hit at spin 1 (field heights/s), the most sideways speed, the platform's own share. */
export const KICK = 0.6;
export const VX_MAX = 0.85;
export const PLATFORM_CARRY = 0.3;
/** How much of the incoming sideways speed a catch keeps. */
export const VX_KEEP = 0.4;
/** Platform top speed (field heights/s) and the controller's gain (1/s). */
export const PLATFORM_VMAX = 2;
export const PLATFORM_GAIN = 14;
/**
 * The controller's worst timing error (s) at skill 0, its worst reaction delay (fraction of the flight), its mean aim
 * error (platform half-widths, exponentially distributed – mostly small, now and then far off) and its top speed at skill 0
 * (a fraction of `PLATFORM_VMAX`), all scaled by (1 − skill).
 */
export const TIMING_ERROR_SEC = 0.35;
export const REACTION_DELAY = 0.5;
export const AIM_JITTER = 1;
export const SLOW_PLATFORM = 0.45;
/** Most tempo the speed-up reaches. */
export const MAX_TEMPO = 2;
/** Seconds from a miss to the next ball, and from the game over to the end of the run. */
export const RESPAWN_SEC = 1.1;
export const GAME_OVER_HOLD_SEC = 2.2;
/** Internal sub-steps per 60 Hz step. */
export const PADDLE_SUBSTEPS = 4;
/** Every this many catches in a row plays the rising arpeggio. */
export const STREAK_CHIME = 10;

/** The ball radius (field heights) for a Ball Size (px at the default 8). */
export function paddleBallRadius(ballSize: number): number {
  const s = Number.isFinite(ballSize) && ballSize > 0 ? ballSize : 8;
  return Math.max(0.012, Math.min(0.06, (PD_BALL_R * s) / 8));
}

/** The gravity factor of the Gravity setting (300 → 1), clamped to 0.3–3. */
export function paddleGravityFactor(gravitySetting: number): number {
  return Number.isFinite(gravitySetting) ? Math.max(0.3, Math.min(3, gravitySetting / 300)) : 1;
}

/** Tempo after `hits` catches (1 at the start, `speedUp` more per catch, at most `MAX_TEMPO`). */
export function paddleTempo(hits: number, speedUp: number): number {
  return Math.min(MAX_TEMPO, 1 + Math.max(0, speedUp) * Math.max(0, hits));
}

/** Folds a straight-line position into [lo, hi] as a ball bouncing elastically between two walls would be (a triangle wave). */
export function foldBetween(p: number, lo: number, hi: number): number {
  const L = hi - lo;
  if (!(L > 0)) return lo;
  const q = (((p - lo) % (2 * L)) + 2 * L) % (2 * L);
  return lo + (q <= L ? q : 2 * L - q);
}

export interface Landing {
  /** Seconds until the ball's bottom reaches the platform line, where its centre is then and its sideways speed. */
  t: number;
  x: number;
  vx: number;
  /** True when the flight bounces off the ceiling first. */
  ceiling: boolean;
}

/**
 * Where and when a ball at (x, y) moving at (vx, vy) (field heights and per second, y down) comes down to the platform
 * line under gravity `g`: the vertical motion with the ceiling bounce solved analytically, the walls folded in.
 */
export function predictLanding(x: number, y: number, vx: number, vy: number, g: number, r: number): Landing {
  const ceil = PD_CEILING + r;
  const plat = PD_PLATFORM - r;
  let t = 0;
  let py = y;
  let pvy = vy;
  let ceiling = false;
  if (pvy < 0) {
    const disc = pvy * pvy - 2 * g * (py - ceil);
    if (disc >= 0 && py > ceil) {
      const tc = (-pvy - Math.sqrt(disc)) / g;
      if (tc >= 0) {
        t = tc;
        pvy = -(pvy + g * tc);
        py = ceil;
        ceiling = true;
      }
    }
  }
  const d = plat - py;
  const td = g > 0 ? (-pvy + Math.sqrt(Math.max(0, pvy * pvy + 2 * g * d))) / g : d / Math.max(1e-6, pvy);
  t += Math.max(0, td);
  const lo = r;
  const hi = PD_ASPECT - r;
  const xl = foldBetween(x + vx * t, lo, hi);
  // The sideways direction at the landing: the fold's slope (+1 on an even pass, −1 on an odd one).
  const L = hi - lo;
  const q = (((x + vx * t - lo) % (2 * L)) + 2 * L) % (2 * L);
  const dir = q <= L ? 1 : -1;
  return { t, x: xl, vx: vx * dir, ceiling };
}

export interface CatchPlan {
  /** Where the platform's centre heads, when it starts moving (s of the mode's clock) and where the ball really lands. */
  targetX: number;
  moveAt: number;
  landX: number;
  landSec: number;
  /** The controller's timing error (s): > 0 it plans late, < 0 early. */
  timingError: number;
  /** The off-centre hit it aims for (−1…1 of the half-width, at most ±`MAX_AIM_OFFSET`): the next flight's sideways speed. */
  aimOffset: number;
  /** The sideways speed it wants to send the ball off with (field heights/s). */
  sendVx: number;
}

/** The most off-centre hit the controller aims for (half-widths), and the fastest sideways send it plays (field heights/s). */
export const MAX_AIM_OFFSET = 0.6;
export const SEND_VX = 0.7;

/**
 * The controller's plan for one flight (pure). It plays the ball around the field: the draw `u4` picks the sideways speed
 * to send it off with next (up to `SEND_VX` × tempo, either way – so the ball visits the walls), which sets the
 * off-centre hit to aim for (`launchOf()` in reverse, from the ball's sideways speed at the landing, the spin setting and
 * the tempo after the catch). With skill 1 it heads exactly for the landing, placed for that hit; below 1 the draws
 * `u1`–`u3` (from the game's generator) give it a timing error (it expects the ball where it would be `e` seconds later
 * or earlier), an aim error and a reaction delay, all scaled by (1 − skill).
 */
export function planCatch(
  landing: Landing,
  x: number,
  vx: number,
  r: number,
  nowSec: number,
  skill: number,
  halfWidth: number,
  u1: number,
  u2: number,
  u3: number,
  u4 = 0.5,
  spin: number = DEFAULT_PADDLE_SETTINGS.spin,
  tempo = 1,
): CatchPlan {
  const miss = 1 - Math.max(0, Math.min(1, skill));
  const e = miss > 0 ? miss * (2 * u1 - 1) * TIMING_ERROR_SEC : 0;
  const lo = r;
  const hi = PD_ASPECT - r;
  const aimX = foldBetween(x + vx * (landing.t + e), lo, hi);
  // The aim error: a heavy-tailed magnitude – mostly small, now and then far off: P(error > d) = 1 / (1 + (d / scale)²) with
  // scale = (1 − skill) × `AIM_JITTER` half-widths, so the chance of a miss grows with the square of (1 − skill) – with
  // u2's half picking the side.
  const frac = u2 < 0.5 ? 2 * u2 : 2 * u2 - 1;
  const jitter = (u2 < 0.5 ? -1 : 1) * Math.sqrt(1 / Math.max(1e-12, 1 - frac) - 1) * miss * AIM_JITTER * halfWidth;
  const sendVx = (2 * u4 - 1) * SEND_VX * tempo;
  const kick = KICK * tempo * Math.max(0, spin);
  const wanted = kick > 1e-9 ? (sendVx - VX_KEEP * landing.vx) / kick : 0;
  const aimOffset = Math.max(-MAX_AIM_OFFSET, Math.min(MAX_AIM_OFFSET, wanted));
  const target = Math.max(halfWidth, Math.min(PD_ASPECT - halfWidth, aimX + jitter - aimOffset * halfWidth));
  return { targetX: target, moveAt: nowSec + miss * u3 * REACTION_DELAY * landing.t, landX: landing.x, landSec: nowSec + landing.t, timingError: e, aimOffset, sendVx };
}

/** The auto controller's top speed at a skill: slower the worse it plays (so a late start can arrive late). */
export function controllerTopSpeed(skill: number): number {
  const s = Math.max(0, Math.min(1, skill));
  return PLATFORM_VMAX * (SLOW_PLATFORM + (1 - SLOW_PLATFORM) * s);
}

/** The platform's speed toward `target` (field heights/s): proportional, capped at the top speed × tempo. */
export function platformVelocity(position: number, target: number, tempo: number, topSpeed = PLATFORM_VMAX): number {
  const vmax = topSpeed * tempo;
  return Math.max(-vmax, Math.min(vmax, (target - position) * PLATFORM_GAIN * tempo));
}

/** The launch after a catch: vertical speed (upward, negative), sideways speed and spin (rad/s) for a hit `offset` (−1…1) off-centre. */
export function launchOf(offset: number, vxIn: number, platformVx: number, spin: number, g: number, tempo: number, r: number) {
  const off = Math.max(-1, Math.min(1, offset));
  const room = PD_PLATFORM - PD_CEILING - 2 * r;
  const apex = room * (APEX_EDGE + (APEX_CENTRE - APEX_EDGE) * (1 - Math.abs(off)));
  const vy = -Math.sqrt(2 * g * apex);
  const vmax = VX_MAX * tempo;
  const vx = Math.max(-vmax, Math.min(vmax, VX_KEEP * vxIn + KICK * tempo * spin * off + PLATFORM_CARRY * platformVx));
  return { vx, vy, spin: 16 * spin * off + 3 * platformVx };
}

/* ------------------------------------------------------------------ the view */

export interface PaddleField {
  /** The playfield in px: its left and top, height (the unit) and width. */
  left: number;
  top: number;
  size: number;
  width: number;
}

export function buildPaddleField(width: number, height: number, out?: PaddleField): PaddleField {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const size = Math.max(60, Math.min(width, height) - 2 * margin);
  const f = out ?? ({} as PaddleField);
  f.size = size;
  f.width = size * PD_ASPECT;
  f.left = (width - f.width) / 2;
  f.top = (height - size) / 2;
  return f;
}

export const MAX_PD_PARTICLES = 160;

export type PaddlePhase = "flight" | "missed" | "waiting" | "over";

export interface PaddleView {
  settings: PaddleSettings;
  field: PaddleField;
  timeSec: number;
  /** Ball (field units) and its radius; `inPlay` false while it is gone (between a miss and the next ball). */
  bx: number;
  by: number;
  bvx: number;
  bvy: number;
  r: number;
  inPlay: boolean;
  phase: PaddlePhase;
  /** Platform centre, speed and half width (field units). */
  px: number;
  pvx: number;
  halfWidth: number;
  tempo: number;
  hits: number;
  misses: number;
  streak: number;
  bestStreak: number;
  wallHits: number;
  ceilingHits: number;
  lastHitSec: number;
  lastHitX: number;
  lastHitOffset: number;
  lastMissSec: number;
  lastMissX: number;
  lastWallSec: number;
  lastWallSide: number;
  lastCeilingSec: number;
  lastCeilingX: number;
  over: boolean;
  overSec: number;
  finished: boolean;
  /** The controller's current plan (auto) – where it heads and whether it plans late (> 0) or early (< 0). */
  targetX: number;
  timingError: number;
  /** Analytic sparks (field units). */
  partX: Float32Array;
  partY: Float32Array;
  partVx: Float32Array;
  partVy: Float32Array;
  partT0: Float64Array;
  partLife: Float32Array;
  partNext: number;
  partSpawned: number;
}

function createView(): PaddleView {
  return {
    settings: { ...DEFAULT_PADDLE_SETTINGS },
    field: buildPaddleField(800, 600),
    timeSec: 0,
    bx: PD_ASPECT / 2,
    by: PD_CEILING + 0.05,
    bvx: 0,
    bvy: 0,
    r: PD_BALL_R,
    inPlay: true,
    phase: "flight",
    px: PD_ASPECT / 2,
    pvx: 0,
    halfWidth: (DEFAULT_PADDLE_SETTINGS.width * PD_ASPECT) / 2,
    tempo: 1,
    hits: 0,
    misses: 0,
    streak: 0,
    bestStreak: 0,
    wallHits: 0,
    ceilingHits: 0,
    lastHitSec: -Infinity,
    lastHitX: 0,
    lastHitOffset: 0,
    lastMissSec: -Infinity,
    lastMissX: 0,
    lastWallSec: -Infinity,
    lastWallSide: 0,
    lastCeilingSec: -Infinity,
    lastCeilingX: 0,
    over: false,
    overSec: -Infinity,
    finished: false,
    targetX: PD_ASPECT / 2,
    timingError: 0,
    partX: new Float32Array(MAX_PD_PARTICLES),
    partY: new Float32Array(MAX_PD_PARTICLES),
    partVx: new Float32Array(MAX_PD_PARTICLES),
    partVy: new Float32Array(MAX_PD_PARTICLES),
    partT0: new Float64Array(MAX_PD_PARTICLES).fill(-Infinity),
    partLife: new Float32Array(MAX_PD_PARTICLES),
    partNext: 0,
    partSpawned: 0,
  };
}

/** Manual input: a target for the platform's centre (fraction 0–1 of the field width; null = none) and an arrow-key direction. */
export interface PaddleInput {
  target: number | null;
  direction: number;
}

/* ------------------------------------------------------------------ the mode */

export class PaddleMode implements GameMode {
  readonly name = "paddle";
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: PaddleSettings = { ...DEFAULT_PADDLE_SETTINGS };
  private readonly view: PaddleView = createView();
  private ballId = -1;
  private clockMs = 0;
  /** Gravity of the current flight (field heights/s², the tempo included) and the base one. */
  private g = PADDLE_GRAVITY;
  private baseG = PADDLE_GRAVITY;
  private spin = 0;
  private angle = 0;
  private respawnAt = Infinity;
  private moveAt = 0;
  private fx: () => number = mulberry32(1);
  /**
   * The game's own generator (serves and the controller's draws), seeded from the engine's at init: the engine's stream
   * is shared with the cinematic director, whose draws would otherwise shift the game's – so the Drama Director switch
   * never changes a game, and the finder's fast path (`runLengthMs()`) replays it exactly.
   */
  private rng: () => number = mulberry32(1);
  private input: PaddleInput = { target: null, direction: 0 };
  /** No sounds (the finder's fast-forward). */
  private silent = false;
  private sizeW = 0;
  private sizeH = 0;

  getSettings(): PaddleSettings {
    return this.settings;
  }
  /** The game applies on the next init; the scale and the root at once. --- unlimited --- With `unlimited` (No limits on) the unlimited settings run past their sliders, up to their soft ceilings. */
  setSettings(patch: Partial<PaddleSettings>, unlimited = false) {
    this.settings = resolvePaddleSettings({ ...this.settings, ...patch }, unlimited);
    this.view.settings.scale = this.settings.scale;
    this.view.settings.rootNote = this.settings.rootNote;
  }
  getView(): PaddleView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { hits: v.hits, misses: v.misses, allowed: v.settings.misses, streak: v.streak, bestStreak: v.bestStreak, over: v.over, finished: v.finished, tempo: v.tempo, auto: v.settings.auto };
  }
  /** Manual play: where the pointer is over the field (0–1, null when it left) and the arrow keys (−1, 0, 1). */
  setInput(input: Partial<PaddleInput>) {
    if (input.target !== undefined) this.input.target = input.target === null || !Number.isFinite(input.target) ? null : Math.max(0, Math.min(1, input.target));
    if (input.direction !== undefined) this.input.direction = Math.sign(input.direction || 0);
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    this.baseG = PADDLE_GRAVITY * paddleGravityFactor(ctx.config.gravity);
    this.g = this.baseG;
    this.fx = mulberry32(Math.floor(ctx.random() * 0x7fffffff) + 1);
    this.rng = mulberry32(Math.floor(ctx.random() * 0x7fffffff) + 1);
    this.clockMs = 0;
    this.spin = 0;
    this.angle = 0;
    this.respawnAt = Infinity;
    this.input = { target: null, direction: 0 };
    this.silent = false;
    v.r = paddleBallRadius(ctx.config.ballRadius);
    v.halfWidth = (s.width * PD_ASPECT) / 2;
    v.timeSec = 0;
    v.px = PD_ASPECT / 2;
    v.pvx = 0;
    v.tempo = 1;
    v.hits = 0;
    v.misses = 0;
    v.streak = 0;
    v.bestStreak = 0;
    v.wallHits = 0;
    v.ceilingHits = 0;
    v.lastHitSec = -Infinity;
    v.lastHitX = 0;
    v.lastHitOffset = 0;
    v.lastMissSec = -Infinity;
    v.lastMissX = 0;
    v.lastWallSec = -Infinity;
    v.lastWallSide = 0;
    v.lastCeilingSec = -Infinity;
    v.lastCeilingX = 0;
    v.over = false;
    v.overSec = -Infinity;
    v.finished = false;
    v.partT0.fill(-Infinity);
    v.partNext = 0;
    v.partSpawned = 0;
    this.sizeW = 0;
    this.refreshField(ctx.config.width, ctx.config.height);
    this.serve(ctx, 0);
  }

  private refreshField(width: number, height: number) {
    if (width === this.sizeW && height === this.sizeH) return;
    this.sizeW = width;
    this.sizeH = height;
    buildPaddleField(width, height, this.view.field);
  }

  private findBall(ctx: ModeContext): Ball | null {
    for (const b of ctx.getBalls()) if (b.id === this.ballId) return b;
    return null;
  }

  /** A new ball from under the ceiling, a little off the middle with a small sideways drift (from the seed). */
  private serve(ctx: ModeContext, now: number) {
    const v = this.view;
    const u1 = this.rng();
    const u2 = this.rng();
    v.bx = PD_ASPECT / 2 + (u1 - 0.5) * 0.3 * PD_ASPECT;
    v.by = PD_CEILING + v.r + 0.03;
    v.bvx = (u2 - 0.5) * 0.4 * v.tempo;
    v.bvy = 0;
    v.inPlay = true;
    v.phase = "flight";
    this.g = this.baseG * v.tempo * v.tempo;
    this.spin = 0;
    this.respawnAt = Infinity;
    const f = v.field;
    const cfg = ctx.config;
    if (!this.findBall(ctx)) {
      ctx.addBall({ x: f.left + v.bx * f.size, y: f.top + v.by * f.size, vx: 0, vy: 0, radius: v.r * f.size, color: cfg.ballColor || "#FFFFFF", gravityScale: 0 });
      this.ballId = ctx.getNextId() - 1;
    }
    this.plan(now);
  }

  /** The controller's plan for the flight that just started (four draws, whatever the skill – so the stream never shifts). */
  private plan(now: number) {
    const v = this.view;
    const u1 = this.rng();
    const u2 = this.rng();
    const u3 = this.rng();
    const u4 = this.rng();
    const landing = predictLanding(v.bx, v.by, v.bvx, v.bvy, this.g, v.r);
    const p = planCatch(landing, v.bx, v.bvx, v.r, now, v.settings.skill, v.halfWidth, u1, u2, u3, u4, v.settings.spin, paddleTempo(v.hits + 1, v.settings.speedUp));
    v.targetX = p.targetX;
    v.timingError = p.timingError;
    this.moveAt = p.moveAt;
  }

  private place(ball: Ball) {
    const v = this.view;
    const f = v.field;
    ball.radius = v.r * f.size;
    ball.x = f.left + v.bx * f.size;
    ball.y = f.top + v.by * f.size;
    ball.vx = v.bvx * f.size;
    ball.vy = v.bvy * f.size;
    ball.angle = this.angle;
    ball.spin = 0;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.refreshField(ctx.config.width, ctx.config.height);
    this.step(ctx, dtMs);
  }

  /** One 60 Hz step of the game in `PADDLE_SUBSTEPS` fixed sub-steps: the platform moves, then the ball flies to the end of the sub-step. */
  private step(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const dt = dtMs / 1000 / PADDLE_SUBSTEPS;
    for (let k = 0; k < PADDLE_SUBSTEPS; k++) {
      const t0 = this.clockMs / 1000 + k * dt;
      const t1 = t0 + dt;
      // The platform.
      let vel = 0;
      if (v.settings.auto) vel = t0 >= this.moveAt ? platformVelocity(v.px, v.targetX, v.tempo, controllerTopSpeed(v.settings.skill)) : 0;
      else if (this.input.direction !== 0) vel = this.input.direction * PLATFORM_VMAX * v.tempo;
      else if (this.input.target !== null) vel = platformVelocity(v.px, this.input.target * PD_ASPECT, v.tempo);
      v.px = Math.max(v.halfWidth, Math.min(PD_ASPECT - v.halfWidth, v.px + vel * dt));
      v.pvx = vel;
      // The ball.
      if (v.inPlay) this.fly(ctx, t0, t1);
      else if (!v.over && t1 >= this.respawnAt) this.serve(ctx, t1);
      this.angle += this.spin * dt;
      if (this.angle > Math.PI * 2 || this.angle < -Math.PI * 2) this.angle %= Math.PI * 2;
    }
    this.clockMs += dtMs;
    v.timeSec = this.clockMs / 1000;
    if (v.over && !v.finished && v.timeSec >= v.overSec + GAME_OVER_HOLD_SEC - 1e-9) v.finished = true;
  }

  /** The ball's flight from t0 to t1: walls, ceiling and the platform line are met at their exact times. */
  private fly(ctx: ModeContext, t0: number, t1: number) {
    const v = this.view;
    const r = v.r;
    const g = this.g;
    const lo = r;
    const hi = PD_ASPECT - r;
    const ceil = PD_CEILING + r;
    const plat = PD_PLATFORM - r;
    let t = t0;
    for (let guard = 0; guard < 12 && t < t1 - 1e-12; guard++) {
      const rem = t1 - t;
      let tw = Infinity;
      if (v.bvx > 1e-12) tw = Math.max(0, (hi - v.bx) / v.bvx);
      else if (v.bvx < -1e-12) tw = Math.max(0, (lo - v.bx) / v.bvx);
      let tc = Infinity;
      if (v.bvy < 0) {
        const disc = v.bvy * v.bvy - 2 * g * (v.by - ceil);
        if (disc >= 0) tc = Math.max(0, (-v.bvy - Math.sqrt(disc)) / g);
      }
      let tp = Infinity;
      if (v.phase === "flight" && v.by <= plat + 1e-9) {
        const disc = v.bvy * v.bvy + 2 * g * (plat - v.by);
        if (disc >= 0) {
          const root = (-v.bvy + Math.sqrt(disc)) / g;
          if (root >= -1e-12) tp = Math.max(0, root);
        }
      }
      const dt = Math.max(0, Math.min(rem, tw, tc, tp));
      v.bx += v.bvx * dt;
      v.by += v.bvy * dt + 0.5 * g * dt * dt;
      v.bvy += g * dt;
      t += dt;
      if (dt === tw && tw <= rem) {
        v.bx = v.bvx > 0 ? hi : lo;
        v.lastWallSide = v.bvx > 0 ? 1 : -1;
        v.bvx = -v.bvx;
        v.wallHits++;
        v.lastWallSec = t;
        this.spin *= 0.7;
        this.noteBounce(ctx); // --- bounce-math ---
        this.sound(ctx, { type: "hit", wallIndex: 0, frequency: rhythmPitch(12 + (v.wallHits % 3), v.settings.scale, v.settings.rootNote), level: 0.3, melody: false });
        continue;
      }
      if (dt === tc && tc <= rem) {
        v.by = ceil;
        v.bvy = -v.bvy;
        v.ceilingHits++;
        v.lastCeilingSec = t;
        v.lastCeilingX = v.bx;
        this.noteBounce(ctx); // --- bounce-math ---
        this.sound(ctx, { type: "hit", wallIndex: 0, frequency: rhythmPitch(16, v.settings.scale, v.settings.rootNote), level: 0.45, melody: false });
        continue;
      }
      if (dt === tp && tp <= rem) {
        v.by = plat;
        this.platformLine(ctx, t);
        continue;
      }
    }
    // Out of the bottom of the field after a miss: the ball is gone until the next serve (or for good).
    if (v.phase === "missed" && v.by > 1 + 2 * r) {
      v.inPlay = false;
      v.phase = v.over ? "over" : "waiting";
      const ball = this.findBall(ctx);
      if (ball) ctx.setBalls(ctx.getBalls().filter((b) => b !== ball));
    }
  }

  /** The ball's bottom reached the platform line: a catch – or a miss. */
  private platformLine(ctx: ModeContext, t: number) {
    const v = this.view;
    const dx = v.bx - v.px;
    const { scale, rootNote } = v.settings;
    if (Math.abs(dx) <= v.halfWidth + 0.35 * v.r) {
      const off = Math.max(-1, Math.min(1, dx / v.halfWidth));
      v.hits++;
      v.streak++;
      v.bestStreak = Math.max(v.bestStreak, v.streak);
      v.tempo = paddleTempo(v.hits, v.settings.speedUp);
      this.g = this.baseG * v.tempo * v.tempo;
      const launch = launchOf(off, v.bvx, v.pvx, v.settings.spin, this.g, v.tempo, v.r);
      v.bvx = launch.vx;
      v.bvy = launch.vy;
      this.spin = launch.spin;
      v.lastHitSec = t;
      v.lastHitX = v.bx;
      v.lastHitOffset = off;
      this.spawnSparks(v.bx, PD_PLATFORM, t, off);
      this.noteBounce(ctx); // --- bounce-math --- a catch on the paddle is a bounce
      ctx.addWallHit(0, (((v.hits % 12) + 12) % 12) * (Math.PI / 6), 0); // the reactive background flashes on a catch
      // The catch is the next note of the tune (a loaded melody's next note); everything else the game sounds – the walls,
      // the ceiling, the streak chime, a miss, the game over – accompanies it (`melody: false`) and never uses one up.
      this.sound(ctx, { type: "hit", wallIndex: 0, frequency: rhythmPitch((v.hits - 1) % 15, scale, rootNote), ...(Math.abs(off) < 0.12 ? { accent: true } : {}) });
      if (v.streak % STREAK_CHIME === 0) this.sound(ctx, { type: "multiplier", wallIndex: 0, multiplier: v.streak, melody: false });
      this.plan(t);
      return;
    }
    // A miss: the ball falls past the platform.
    v.phase = "missed";
    v.misses++;
    v.streak = 0;
    v.lastMissSec = t;
    v.lastMissX = v.bx;
    ctx.noteImpact?.();
    this.sound(ctx, { type: "hit", wallIndex: 0, frequency: rhythmPitch(-7, scale, rootNote), level: 0.9, melody: false });
    if (v.misses > v.settings.misses) {
      v.over = true;
      v.overSec = t;
      const chord = rhythmChord(-7, scale, rootNote);
      this.sound(ctx, { type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true, melody: false });
      this.sound(ctx, { type: "gap", wallIndex: 0 });
    } else this.respawnAt = t + RESPAWN_SEC;
  }

  /** --- bounce-math --- A wall, ceiling or paddle bounce of the ball (not in the finder's silent run, which has no engine around it). */
  private noteBounce(ctx: ModeContext) {
    if (this.silent || !ctx.noteBounce) return;
    const ball = this.findBall(ctx);
    if (ball) ctx.noteBounce(ball);
  }

  private sound(ctx: ModeContext, event: Parameters<ModeContext["addPendingSoundEvent"]>[0]) {
    if (!this.silent) ctx.addPendingSoundEvent(event);
  }

  private spawnSparks(x: number, y: number, at: number, off: number) {
    const v = this.view;
    const rnd = this.fx;
    const n = 10 + Math.round(8 * (1 - Math.abs(off)));
    for (let i = 0; i < n; i++) {
      const s = v.partNext;
      v.partNext = (v.partNext + 1) % MAX_PD_PARTICLES;
      v.partSpawned++;
      const a = -Math.PI * (0.1 + 0.8 * rnd());
      const sp = 0.3 + 0.7 * rnd();
      v.partX[s] = x + (rnd() - 0.5) * 0.03;
      v.partY[s] = y;
      v.partVx[s] = Math.cos(a) * sp + 0.4 * off;
      v.partVy[s] = Math.sin(a) * sp;
      v.partT0[s] = at;
      v.partLife[s] = 0.3 + 0.35 * rnd();
    }
  }

  onBallStep(ctx: ModeContext, ball: Ball) {
    if (ball.id === this.ballId) this.place(ball);
  }
  onPostSubStep() {}
  onPostUpdate(ctx: ModeContext) {
    const ball = this.findBall(ctx);
    if (ball) this.place(ball);
  }

  /**
   * The finder's fast path: runs a freshly initialised game in the engine's 60 Hz steps without the engine around it (the
   * engine adds nothing to this mode's run – no rings, no collisions, no random draws) and returns when it finishes (ms),
   * at most `maxMs`. The same steps as `engine.update()`, so the length is exactly the page's.
   */
  runLengthMs(ctx: ModeContext, maxMs: number, stepMs = 1000 / 60): number {
    this.silent = true;
    let elapsed = 0;
    try {
      while (elapsed < maxMs && !this.view.finished) {
        this.onPreUpdate(ctx, stepMs);
        elapsed += stepMs;
      }
    } finally {
      this.silent = false;
    }
    return this.view.finished ? elapsed : maxMs;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    this.refreshField(ctx.config.width, ctx.config.height);
    const ball = this.findBall(ctx);
    if (ball) {
      this.place(ball);
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
    return true;
  }
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { hits: v.hits, misses: v.misses, streak: v.streak, over: v.over, finished: v.finished };
  }
}
