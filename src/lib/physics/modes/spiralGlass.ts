import { SCALE_INTERVALS, midiToFrequency } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Spiral Glass ("spiralGlass" mode, feature spiral-glass – the "will the ball multiply?" reels). A single-arm Archimedean
 * spiral of `turns` turns drawn as a thin glowing line whose hue cycles slowly: the line is a wall, and the channel it winds
 * – from the mouth at its outer end round and round to the centre – is filled with frosted glass cut into
 * `TILES_PER_TURN` tiles a turn of `glassHp` hit points each. The spiral's outer end curls `TAIL_TURNS` of a turn past the
 * glass (the ramp) and opens at the mouth, where the balls come in. Small coloured balls run clockwise along the channel at
 * a constant speed (`speed` field sides per second) until they meet the glass or the ball ahead: the front ball grinds the
 * first tile still standing – one hit point per `chipEvery` seconds of contact, shards flying, a note rising with the turn
 * inward – and every ball queued up against it pushes too (`PUSH_CAP` at most), so the more balls there are the faster the
 * glass goes. A tile at 0 hit points is gone (black) and the queue moves up into it: the glass is eaten along the spiral from
 * the outside in, tile by tile. The entrance line is the ray from the centre through the badge at the bottom: every lap a
 * ball completes past it counts one up (the badge's "x n") and spawns a new ball at the mouth, up to `maxBalls`. GLASS
 * CLEARED when every tile is gone (the line flashes white, confetti, a chord, `CLEAR_HOLD_MS`, then the run finishes);
 * TIMEOUT at `TIMEOUT_MS` of simulated time, so the finder never loops forever.
 *
 * Physics: the balls are ordinary engine balls with `gravityScale` 0 and `ballsPassThrough` (no pair pass), but where they
 * are is the mode's: every ball has a place along the channel (the channel coordinate q, `channelPhi()` /
 * `channelRadius()`: one less a turn inward, a whole number on the entrance ray), runs down it in `onBallStep()` – never
 * into the glass front (`glassFront()`) nor past the deepest point a ball fits (`channelEnd()`) – and `onPostSubStep()` lines
 * the balls up front to back so none runs into the one ahead (`queueGap()`), writes every ball's place and velocity back and
 * lets the front of the queue grind. The spiral line is never crossed and no ball ever overlaps another or the glass.
 *
 * Randomness: every ball's own speed (±`SPEED_JITTER`), the grind's phase and the shards come from `ctx.random()`, so a
 * seed replays identically and Find Simulation can search a clip length (the seed moves when the queue catches up with the
 * glass and how the laps, and so the spawns, line up).
 */

/* ------------------------------------------------------------------ settings */

export interface SpiralGlassSettings {
  /** Turns of the spiral, 3–10 (each a glass band of `TILES_PER_TURN` tiles). */
  turns: number;
  /** Hit points of every tile, 1–5. */
  glassHp: number;
  /** Speed of the balls along the channel, field sides per second, 0.3–2. */
  speed: number;
  /** Most balls at once, 1–100 (the badge keeps counting past it). */
  maxBalls: number;
  /** The line's hue cycles slowly (off: the wall colour). */
  rainbow: boolean;
  /** Seconds of contact per hit point chipped (per ball pushing), 0.05–1. */
  chipEvery: number;
}

export const DEFAULT_SPIRAL_GLASS_SETTINGS: SpiralGlassSettings = {
  turns: 6,
  glassHp: 2,
  speed: 0.8,
  maxBalls: 40,
  rainbow: true,
  chipEvery: 0.1,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const SPIRAL_GLASS_RANGES = {
  sgTurns: { min: 3, max: 10, step: 1 },
  sgGlassHp: { min: 1, max: 5, step: 1 },
  sgSpeed: { min: 0.3, max: 2, step: 0.1 },
  sgMaxBalls: { min: 1, max: 100, step: 1 },
  sgChipEvery: { min: 0.05, max: 1, step: 0.05 },
} as const;

/** The Spiral Glass fields of the SimulatorSettings object (URL keys sgt, sgh, sgv, sgm, sgr, sgc). */
export interface SpiralGlassFields {
  sgTurns: number;
  sgGlassHp: number;
  sgSpeed: number;
  sgMaxBalls: number;
  sgRainbow: boolean;
  sgChipEvery: number;
}

/** Most turns the spiral takes (past the slider's end a channel is thinner than any ball on any canvas). */
export const MAX_TURNS = 24;
/** Most balls the channel holds (its memory-safety ceiling: the per-ball state and the queue pass are sized for it). */
export const MAX_SPIRAL_BALLS = 500;

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds onto a slider's step, two decimals at most. */
function onStep(value: number, step: number) {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** Fills in the defaults and clamps every value onto its slider (the counts whole, the turns at most `MAX_TURNS`, the balls at most `MAX_SPIRAL_BALLS`); bad values fall back to the defaults. */
export function resolveSpiralGlassSettings(config: Partial<SpiralGlassSettings> | null | undefined): SpiralGlassSettings {
  const out = { ...DEFAULT_SPIRAL_GLASS_SETTINGS };
  if (!config) return out;
  const R = SPIRAL_GLASS_RANGES;
  if (config.turns !== undefined) out.turns = memoryCeiling("sgTurns", Math.round(clampNumber(config.turns, R.sgTurns, out.turns))); // --- uncap-all --- MEMORY_CEILINGS.sgTurns = MAX_TURNS
  if (config.glassHp !== undefined) out.glassHp = Math.round(clampNumber(config.glassHp, R.sgGlassHp, out.glassHp));
  if (config.speed !== undefined) out.speed = onStep(clampNumber(config.speed, R.sgSpeed, out.speed), R.sgSpeed.step);
  if (config.maxBalls !== undefined) out.maxBalls = memoryCeiling("sgMaxBalls", Math.round(clampNumber(config.maxBalls, R.sgMaxBalls, out.maxBalls))); // --- uncap-all --- MEMORY_CEILINGS.sgMaxBalls = MAX_SPIRAL_BALLS
  if (config.chipEvery !== undefined) out.chipEvery = onStep(clampNumber(config.chipEvery, R.sgChipEvery, out.chipEvery), R.sgChipEvery.step);
  if (typeof config.rainbow === "boolean") out.rainbow = config.rainbow;
  return out;
}

/** Picks the Spiral Glass settings out of a bigger object for `engine.setSpiralGlassSettings()`. */
export function spiralGlassSettingsOf(source: SpiralGlassFields): SpiralGlassSettings {
  return { turns: source.sgTurns, glassHp: source.sgGlassHp, speed: source.sgSpeed, maxBalls: source.sgMaxBalls, rainbow: source.sgRainbow, chipEvery: source.sgChipEvery };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function spiralGlassSettingFields(settings: SpiralGlassSettings): SpiralGlassFields {
  return { sgTurns: settings.turns, sgGlassHp: settings.glassHp, sgSpeed: settings.speed, sgMaxBalls: settings.maxBalls, sgRainbow: settings.rainbow, sgChipEvery: settings.chipEvery };
}

/** The defaults of the feature's fields. */
export function defaultSpiralGlassFields(): SpiralGlassFields {
  return spiralGlassSettingFields(DEFAULT_SPIRAL_GLASS_SETTINGS);
}

/** The mode's own Ball Size: a ball about a third of the channel across (the channel of six turns is about a fifteenth of the field). */
export const SPIRAL_GLASS_BALL_RADIUS = 11;

/** The core settings Spiral Glass overrides when it is the page's mode (its own ball size); nothing for any other mode. */
export function spiralGlassModeDefaults(mode: string): { ballRadius?: number } {
  return mode === "spiralGlass" ? { ballRadius: SPIRAL_GLASS_BALL_RADIUS } : {};
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers on their steps, a real boolean. */
export function resolveSpiralGlassFields(source: Partial<SpiralGlassFields>): SpiralGlassFields {
  return spiralGlassSettingFields(
    resolveSpiralGlassSettings({ turns: source.sgTurns, glassHp: source.sgGlassHp, speed: source.sgSpeed, maxBalls: source.sgMaxBalls, rainbow: source.sgRainbow, chipEvery: source.sgChipEvery }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { sgt: "sgTurns", sgh: "sgGlassHp", sgv: "sgSpeed", sgm: "sgMaxBalls", sgc: "sgChipEvery" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: sgt, sgh, sgv, sgm, sgc and sgr. */
export function writeSpiralGlassParams(settings: SpiralGlassFields, base: SpiralGlassFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.sgRainbow !== base.sgRainbow) params.set("sgr", settings.sgRainbow ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readSpiralGlassParams(params: URLSearchParams, settings: SpiralGlassFields) {
  const next: Partial<SpiralGlassFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const rainbow = params.get("sgr");
  if (rainbow === "1") next.sgRainbow = true;
  else if (rainbow === "0") next.sgRainbow = false;
  Object.assign(settings, resolveSpiralGlassFields(next));
}

/* ------------------------------------------------------------------ geometry */

/** Angular tiles per turn of glass. */
export const TILES_PER_TURN = 36;
/** How far the spiral's outer end curls past the glass (turns): the ramp from the mouth to the entrance. */
export const TAIL_TURNS = 0.4;
/** The spiral's outermost radius as a fraction of the centred square's side, and how far below its centre the spiral sits. */
export const OUTER_AT = 0.42;
export const DROP_AT = 0.02;
/** The ball's radius is at most this share of the pitch (a huge Ball Size still fits the channel). */
export const BALL_FIT = 0.38;
/** How far past the mouth (radians) a ball is spawned, into the ramp. */
export const SPAWN_IN = 0.12;
const TWO_PI = Math.PI * 2;

export interface SpiralGlassLayout {
  width: number;
  height: number;
  /** The centred square the recorder crops to. */
  side: number;
  left: number;
  top: number;
  /** The spiral's centre. */
  cx: number;
  cy: number;
  turns: number;
  tail: number;
  /** Distance between consecutive turns: the channel's width. */
  pitch: number;
  /** The outermost radius (the ramp's outer wall at the mouth). */
  outerRadius: number;
  /** The ball radius the layout fits (the Ball Size, at most `BALL_FIT` × the pitch). */
  ballRadius: number;
  /** The angle (radians clockwise from straight down) of the mouth, where the ramp begins, and where a ball is spawned. */
  mouthPhi: number;
  spawnPhi: number;
  /** The Ball Size the layout was built for. */
  requestedRadius: number;
}

/**
 * Lays the spiral out for a canvas of `width` × `height`: the centred square the recorder crops to, the spiral centred
 * `DROP_AT` × the side below its centre, its outermost radius `OUTER_AT` × the side, the pitch dividing that over
 * `turns` + `TAIL_TURNS` turns. The ball's radius is the Ball Size, at most `BALL_FIT` × the pitch.
 */
export function buildSpiralGlassLayout(width: number, height: number, turns: number, ballRadius: number): SpiralGlassLayout {
  const side = Math.max(60, Math.min(width, height));
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  const n = Math.max(1, Math.round(turns));
  const outerRadius = OUTER_AT * side;
  const pitch = outerRadius / (n + TAIL_TURNS);
  const r = Math.min(Math.max(2, ballRadius), BALL_FIT * pitch);
  const mouthPhi = TWO_PI * (1 - TAIL_TURNS);
  return { width, height, side, left, top, cx: width / 2, cy: height / 2 + DROP_AT * side, turns: n, tail: TAIL_TURNS, pitch, outerRadius, ballRadius: r, mouthPhi, spawnPhi: mouthPhi + SPAWN_IN, requestedRadius: ballRadius };
}

/** Wraps an angle into [0, 2π). */
export function wrapPhi(phi: number): number {
  const p = phi % TWO_PI;
  return p < 0 ? p + TWO_PI : p;
}

/** The polar place of (x, y): the radius and the angle clockwise from straight down, in [0, 2π). */
export function polarOf(L: Pick<SpiralGlassLayout, "cx" | "cy">, x: number, y: number): { rho: number; phi: number } {
  const dx = x - L.cx;
  const dy = y - L.cy;
  return { rho: Math.hypot(dx, dy), phi: wrapPhi(Math.atan2(dy, dx) - Math.PI / 2) };
}

/** The canvas point at polar (rho, phi). */
export function pointOf(L: Pick<SpiralGlassLayout, "cx" | "cy">, rho: number, phi: number): { x: number; y: number } {
  const a = phi + Math.PI / 2;
  return { x: L.cx + rho * Math.cos(a), y: L.cy + rho * Math.sin(a) };
}

/** The point of the spiral line at `t` turns from the centre (rho = pitch · t, turning counter-clockwise outward). */
export function linePoint(L: Pick<SpiralGlassLayout, "cx" | "cy" | "pitch">, t: number): { x: number; y: number } {
  return pointOf(L, L.pitch * t, -TWO_PI * t);
}

/**
 * The band (channel) of the point at polar (rho, phi): the number of spiral walls inside it along its ray. Band c lies between
 * wall c and wall c + 1; bands 0 … turns − 1 hold glass, band `turns` is the ramp (only in the tail sector).
 */
export function bandOf(L: Pick<SpiralGlassLayout, "pitch">, rho: number, phi: number): number {
  return Math.floor(rho / L.pitch + phi / TWO_PI);
}

/** The radii of band `c`'s inner and outer walls at angle `phi` (the inner wall of band 0 is the centre). */
export function bandInner(L: Pick<SpiralGlassLayout, "pitch">, c: number, phi: number): number {
  return Math.max(0, L.pitch * (c - phi / TWO_PI));
}
export function bandOuter(L: Pick<SpiralGlassLayout, "pitch">, c: number, phi: number): number {
  return L.pitch * (c + 1 - phi / TWO_PI);
}

/** The tile (0 … TILES_PER_TURN − 1) of angle `phi` within a band. */
export function tileOf(phi: number): number {
  return Math.max(0, Math.min(TILES_PER_TURN - 1, Math.floor((wrapPhi(phi) / TWO_PI) * TILES_PER_TURN)));
}

/** The index of tile `i` of band `c` in the hit-point array. */
export function tileIndex(c: number, i: number): number {
  return c * TILES_PER_TURN + i;
}

/** True when `phi` lies in the tail sector (where the ramp runs outside the glass). */
export function inTail(L: Pick<SpiralGlassLayout, "mouthPhi">, phi: number): boolean {
  return wrapPhi(phi) >= L.mouthPhi - 1e-9;
}

/** The radius of the outermost wall at angle `phi`: the ramp's outer wall in the tail sector, the outer band's outer wall elsewhere. */
export function outerBoundary(L: Pick<SpiralGlassLayout, "pitch" | "turns" | "mouthPhi">, phi: number): number {
  const p = wrapPhi(phi);
  const k = inTail(L, p) ? L.turns + 1 : L.turns;
  return L.pitch * (k - p / TWO_PI);
}

/* ------------------------------------------------------------------ the channel */

/**
 * The channel coordinate q runs along the spiral channel: band c at angle phi is q = c − phi / 2π, so q falls by one every
 * turn a ball runs clockwise and is a whole number on the entrance ray (straight down). The ramp is q ∈ (turns − 1,
 * turns − 1 + tail], the glass bands turns − 1 … 0 lie below it, and the innermost band narrows to the centre at q = −1.
 */
export function channelPhi(q: number): number {
  return wrapPhi(-TWO_PI * q);
}

/** The band (channel turn) of channel coordinate `q`. */
export function channelBand(q: number): number {
  return Math.round(q + channelPhi(q) / TWO_PI);
}

/** Where a ball comes in: just past the mouth, on the ramp. */
export function spawnQ(L: Pick<SpiralGlassLayout, "turns" | "spawnPhi">): number {
  return L.turns - L.spawnPhi / TWO_PI;
}

/** The deepest a ball of radius `r` fits (the innermost band narrows to nothing at the centre). */
export function channelEnd(L: Pick<SpiralGlassLayout, "pitch">, r: number): number {
  return Math.min(0, (2 * r) / Math.max(1e-9, L.pitch) - 1);
}

/** The radius of a ball's centre at `q`: the middle of the channel (in the innermost band, never closer to the centre than `r`). */
export function channelRadius(L: Pick<SpiralGlassLayout, "pitch">, q: number, r: number): number {
  if (q >= 0) return L.pitch * (q + 0.5);
  return Math.max(r, 0.5 * L.pitch * (q + 1));
}

/** The canvas point of a ball of radius `r` at channel coordinate `q`. */
export function channelPoint(L: Pick<SpiralGlassLayout, "cx" | "cy" | "pitch">, q: number, r: number): { x: number; y: number } {
  return pointOf(L, channelRadius(L, q, r), channelPhi(q));
}

/** Px of channel per unit of q at `q` (the length of a turn there). */
export function channelSpeedScale(L: Pick<SpiralGlassLayout, "pitch">, q: number, r: number): number {
  const rho = channelRadius(L, q, r);
  const dRho = q >= 0 ? L.pitch : rho > r ? 0.5 * L.pitch : 0;
  return Math.max(1e-6, Math.hypot(TWO_PI * rho, dRho));
}

/** The tile of the glass at position `j` along the channel (0: the first tile past the entrance, then inward). */
export function tileAlong(turns: number, j: number): number {
  const c = turns - 1 - Math.floor(j / TILES_PER_TURN);
  return tileIndex(c, j % TILES_PER_TURN);
}

/** The q of the outer face of the tile at position `j` along the channel (where a ball coming down the channel meets it). */
export function tileFaceQ(turns: number, j: number): number {
  const c = turns - 1 - Math.floor(j / TILES_PER_TURN);
  return c - (j % TILES_PER_TURN) / TILES_PER_TURN;
}

/** How far ahead of its centre (in q) a ball of radius `r` at `q` reaches: it touches a radial face that far along. */
export function frontReach(L: Pick<SpiralGlassLayout, "pitch">, q: number, r: number): number {
  const rho = channelRadius(L, q, r);
  return Math.asin(Math.min(1, r / Math.max(r, rho))) / TWO_PI;
}

/**
 * How far behind a ball at `qAhead` (in q) the next one sits when the two touch: the spacing along the channel, widened
 * until the straight distance between their centres is a whole diameter (the channel curves: an arc is longer than its chord).
 */
export function queueGap(L: Pick<SpiralGlassLayout, "cx" | "cy" | "pitch">, qAhead: number, r: number): number {
  let gap = (2 * r) / channelSpeedScale(L, qAhead + r / channelSpeedScale(L, qAhead, r), r);
  const a = channelPoint(L, qAhead, r);
  for (let k = 0; k < 6; k++) {
    const b = channelPoint(L, qAhead + gap, r);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= 2 * r - 1e-3 || d <= 0) break;
    gap *= Math.min(2, (2 * r) / d);
  }
  return gap;
}

/** Laps a ball run from `q0` to `q` has crossed the entrance ray (the first crossing is the ramp's end, not a lap). */
export function crossingsBetween(q0: number, q: number): number {
  return Math.max(0, Math.floor(q0 + 1e-9) - Math.ceil(q - 1e-9) + 1);
}

/* ------------------------------------------------------------------ colours and sound */

/** The hues (degrees) of the balls, a pleasant ring: every spawn takes the next one. */
export const BALL_HUES = [330, 20, 45, 95, 160, 195, 225, 265, 300, 10, 70, 180, 245] as const;

export function ballColorAt(index: number): string {
  const hue = BALL_HUES[((index % BALL_HUES.length) + BALL_HUES.length) % BALL_HUES.length];
  return `hsl(${hue}, 85%, 60%)`;
}

export function ballHueAt(index: number): number {
  return BALL_HUES[((index % BALL_HUES.length) + BALL_HUES.length) % BALL_HUES.length];
}

/** Where the line's hue starts (magenta) and how fast it cycles (degrees per second: a cycle every 30 s). */
export const HUE_START = 300;
export const HUE_DEG_PER_SEC = 12;

/** The line's hue (degrees) at `timeMs`. */
export function lineHue(timeMs: number): number {
  return (((HUE_START + (timeMs / 1000) * HUE_DEG_PER_SEC) % 360) + 360) % 360;
}

/** The chip note of band `c` of `turns`: the pentatonic from C4, a step a band inward (the outer band the lowest). */
export function chipPitch(c: number, turns: number): number {
  const steps = SCALE_INTERVALS.pentatonic;
  const d = Math.max(0, Math.round(turns) - 1 - Math.round(c));
  return midiToFrequency(60 + 12 * Math.floor(d / steps.length) + steps[d % steps.length]);
}

/** The chord of GLASS CLEARED: the innermost band's note, its major third, its fifth and the octave. */
export function clearChord(turns: number): number[] {
  const root = chipPitch(0, turns);
  return [root, root * Math.pow(2, 4 / 12), root * Math.pow(2, 7 / 12), 2 * root];
}

/* ------------------------------------------------------------------ pacing */

/** Simulation ms the celebration holds before the run finishes, and the simulated time after which a run is a TIMEOUT. */
export const CLEAR_HOLD_MS = 2000;
export const TIMEOUT_MS = 600_000;
/** Every ball's own speed differs from the setting by up to this share (the seed's). */
export const SPEED_JITTER = 0.1;
/** Most balls of the queue that push on the glass at once (the grind's speed-up). */
export const PUSH_CAP = 12;
/** A ball this close (q) to the glass front or to the ball ahead touches it (rounding never breaks a queue). */
export const TOUCH_Q = 1e-4;
/** The least ms between two chip notes and between two shatters' wall-break sounds (a crowd grinds far faster than a note a hit could play). */
export const NOTE_COOLDOWN_MS = 70;
export const SHATTER_COOLDOWN_MS = 120;
/** The least ms between two counts of the badge: a crowd lapping together is one multiply, not a dozen. */
export const MULTIPLY_COOLDOWN_MS = 1200;
/** Shards a chip and a shatter throw, the pool, and how long a tile flashes after a hit. */
export const SHARDS_PER_CHIP = 3;
export const SHARDS_PER_SHATTER = 9;
export const MAX_SHARDS = 240;
export const TILE_FLASH_MS = 260;
/** Pops the view keeps (a ring buffer), and how long one shows. */
export const POP_SLOTS = 16;
export const POP_MS = 600;

/* ------------------------------------------------------------------ view */

export interface SpiralGlassView {
  settings: SpiralGlassSettings;
  layout: SpiralGlassLayout | null;
  /** The simulation clock (ms). */
  timeMs: number;
  /** The badge: 1 plus the laps completed past the entrance. */
  count: number;
  /** Counters. */
  balls: number;
  spawned: number;
  chips: number;
  shatters: number;
  notes: number;
  /**
   * The tiles: hit points per tile (band × TILES_PER_TURN + tile), and when each was last hit (ms, −Infinity never).
   * --- unlimited-sizes --- (bug fix) doubles, whole numbers exactly up to 2⁵³: a byte wrapped 256 hit points to 0 and 300 to 44.
   */
  hp: Float64Array;
  hitMs: Float64Array;
  tilesTotal: number;
  tilesLeft: number;
  hpTotal: number;
  hpLeft: number;
  /** Per live ball id: the hue index it wears. */
  hueOf: Map<number, number>;
  /** The shards: place, velocity, rotation, spin, size, life (s, counting down), max life and hue (−1 = white). */
  shardCount: number;
  shardX: Float64Array;
  shardY: Float64Array;
  shardVx: Float64Array;
  shardVy: Float64Array;
  shardRot: Float64Array;
  shardSpin: Float64Array;
  shardSize: Float64Array;
  shardLife: Float64Array;
  shardMaxLife: Float64Array;
  shardHue: Float64Array;
  /** The multiply pops: place, the count shown and when (ms; −Infinity = empty). */
  popX: Float64Array;
  popY: Float64Array;
  popCount: Uint32Array;
  popMs: Float64Array;
  /** GLASS CLEARED: when (−1 before); TIMEOUT: when (−1 before). */
  clearedMs: number;
  timeoutMs: number;
  finished: boolean;
  /** Simulation ms the run finished at (−1 while it has not). */
  finishedMs: number;
}

function createView(): SpiralGlassView {
  return {
    settings: { ...DEFAULT_SPIRAL_GLASS_SETTINGS },
    layout: null,
    timeMs: 0,
    count: 1,
    balls: 0,
    spawned: 0,
    chips: 0,
    shatters: 0,
    notes: 0,
    hp: new Float64Array(0),
    hitMs: new Float64Array(0),
    tilesTotal: 0,
    tilesLeft: 0,
    hpTotal: 0,
    hpLeft: 0,
    hueOf: new Map(),
    shardCount: 0,
    shardX: new Float64Array(MAX_SHARDS),
    shardY: new Float64Array(MAX_SHARDS),
    shardVx: new Float64Array(MAX_SHARDS),
    shardVy: new Float64Array(MAX_SHARDS),
    shardRot: new Float64Array(MAX_SHARDS),
    shardSpin: new Float64Array(MAX_SHARDS),
    shardSize: new Float64Array(MAX_SHARDS),
    shardLife: new Float64Array(MAX_SHARDS),
    shardMaxLife: new Float64Array(MAX_SHARDS),
    shardHue: new Float64Array(MAX_SHARDS),
    popX: new Float64Array(POP_SLOTS),
    popY: new Float64Array(POP_SLOTS),
    popCount: new Uint32Array(POP_SLOTS),
    popMs: new Float64Array(POP_SLOTS).fill(-Infinity),
    clearedMs: -1,
    timeoutMs: -1,
    finished: false,
    finishedMs: -1,
  };
}

/** The per-ball state the mode keeps (by ball id). */
interface BallState {
  /** The ball's place along the channel (channel coordinate), and where it came in. */
  q: number;
  q0: number;
  /** Entrance crossings credited so far (the first one is the ramp's end, not a lap). */
  crossed: number;
  /** The ball's own speed (px/s). */
  speed: number;
  /** The tile the ball grinds this step (−1: none), and whether glass, the ball ahead or the channel's end held it back. */
  contact: number;
  blocked: boolean;
  /** Where it was drawn last sub-step (its velocity is the move). */
  px: number;
  py: number;
}

/* ------------------------------------------------------------------ the mode */

export class SpiralGlassMode implements GameMode {
  readonly name = "spiralGlass";
  /** The balls run at the mode's speed: no slow-ball boost, and no pair pass (the queue is the mode's own). */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: SpiralGlassSettings = { ...DEFAULT_SPIRAL_GLASS_SETTINGS };
  private readonly view: SpiralGlassView = createView();
  private layout: SpiralGlassLayout | null = null;
  private clockMs = 0;
  private readonly state = new Map<number, BallState>();
  /** Balls waiting for the mouth to be free. */
  private pending = 0;
  private lastNoteMs = -Infinity;
  private lastShatterMs = -Infinity;
  private lastMultiplyMs = -Infinity;
  private popAt = 0;
  /** The first tile still standing along the channel (`tilesTotal` once the glass is gone), and the grind's seconds toward its next chip. */
  private frontier = 0;
  private grind = 0;
  /** The balls front to back (reused every sub-step), and the length of the sub-step in flight (s), as `onBallStep()` got it. */
  private order: Ball[] = [];
  private subSec = 0;

  getSettings(): SpiralGlassSettings {
    return this.settings;
  }
  /** The turns, the hit points, the speed, the ball cap and the chip time apply on the next init; the rainbow at once. */
  setSettings(patch: Partial<SpiralGlassSettings>) {
    this.settings = resolveSpiralGlassSettings({ ...this.settings, ...patch });
    this.view.settings.rainbow = this.settings.rainbow;
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): SpiralGlassView {
    return this.view;
  }
  getLayout(): SpiralGlassLayout | null {
    return this.layout;
  }
  getProgress() {
    const v = this.view;
    return { count: v.count, balls: v.balls, tilesLeft: v.tilesLeft, tilesTotal: v.tilesTotal, hpLeft: v.hpLeft, hpTotal: v.hpTotal, cleared: v.clearedMs >= 0, timeout: v.timeoutMs >= 0, finished: v.finished };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const v = this.view;
    v.settings = { ...this.settings };
    this.clockMs = 0;
    this.state.clear();
    this.pending = 0;
    this.lastNoteMs = -Infinity;
    this.lastShatterMs = -Infinity;
    this.lastMultiplyMs = -Infinity;
    this.popAt = 0;
    this.frontier = 0;
    v.timeMs = 0;
    v.count = 1;
    v.balls = 0;
    v.spawned = 0;
    v.chips = 0;
    v.shatters = 0;
    v.notes = 0;
    v.hueOf.clear();
    v.shardCount = 0;
    v.popMs.fill(-Infinity);
    v.clearedMs = -1;
    v.timeoutMs = -1;
    v.finished = false;
    v.finishedMs = -1;
    const tiles = this.settings.turns * TILES_PER_TURN;
    v.hp = new Float64Array(tiles).fill(this.settings.glassHp); // --- unlimited-sizes --- (any hit points, never wrapped)
    v.hitMs = new Float64Array(tiles).fill(-Infinity);
    v.tilesTotal = tiles;
    v.tilesLeft = tiles;
    v.hpTotal = tiles * this.settings.glassHp;
    v.hpLeft = v.hpTotal;
    this.rebuild(ctx);
    ctx.setObstacles([]);
    // The grind's phase is the seed's.
    this.grind = ctx.random() * 0.5 * this.settings.chipEvery;
    // The first ball comes in at once (the engine then adds no default ball).
    this.spawn(ctx);
  }

  private rebuild(ctx: ModeContext) {
    this.layout = buildSpiralGlassLayout(ctx.config.width, ctx.config.height, this.settings.turns, ctx.config.ballRadius || 8);
    this.view.layout = this.layout;
  }

  /** The speed setting in px/s for this layout. */
  private speedPx(): number {
    return this.settings.speed * (this.layout?.side ?? 600);
  }

  /** True while a ball sits where the next one would come in. */
  private mouthBlocked(): boolean {
    const L = this.layout!;
    const q0 = spawnQ(L);
    const gap = queueGap(L, q0 - 2 * queueGap(L, q0, L.ballRadius), L.ballRadius);
    for (const st of this.state.values()) if (st.q > q0 - gap - TOUCH_Q) return true;
    return false;
  }

  /** A ball comes in at the mouth: its own speed is the seed's, its colour the next of the ring. */
  private spawn(ctx: ModeContext) {
    const L = this.layout!;
    const v = this.view;
    const q = spawnQ(L);
    const speed = this.speedPx() * (1 + SPEED_JITTER * (2 * ctx.random() - 1));
    const hue = v.spawned % BALL_HUES.length;
    const p = channelPoint(L, q, L.ballRadius);
    ctx.addBall({ x: p.x, y: p.y, vx: 0, vy: 0, radius: L.ballRadius, color: ballColorAt(hue), gravityScale: 0 });
    const id = ctx.getNextId() - 1;
    v.hueOf.set(id, hue);
    this.state.set(id, { q, q0: q, crossed: 0, speed, contact: -1, blocked: false, px: p.x, py: p.y });
    v.spawned++;
    v.balls = ctx.getBalls().length;
  }

  /** A ball the mode did not spawn (a split, a bounce-math clone) is adopted at the channel place nearest to where it is. */
  private adopt(ctx: ModeContext, ball: Ball): BallState {
    const L = this.layout!;
    const v = this.view;
    const { rho, phi } = polarOf(L, ball.x, ball.y);
    const band = Math.max(0, Math.min(L.turns, bandOf(L, rho, phi)));
    const q = Math.max(channelEnd(L, L.ballRadius), Math.min(spawnQ(L), band - phi / TWO_PI));
    const hue = v.spawned % BALL_HUES.length;
    v.hueOf.set(ball.id, hue);
    ball.color = ballColorAt(hue);
    ball.gravityScale = 0;
    const st: BallState = { q, q0: q, crossed: 0, speed: this.speedPx() * (1 + SPEED_JITTER * (2 * ctx.random() - 1)), contact: -1, blocked: false, px: ball.x, py: ball.y };
    this.state.set(ball.id, st);
    v.spawned++;
    return st;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    // A live change of the Ball Size refits the balls.
    if (this.layout && (ctx.config.ballRadius || 8) !== this.layout.requestedRadius) this.rebuild(ctx);
    this.clockMs += dtMs;
    v.timeMs = this.clockMs;
    // The queued balls come in one per step while the mouth is free, up to the cap.
    if (this.pending > 0 && v.clearedMs < 0 && v.timeoutMs < 0 && ctx.getBalls().length < this.settings.maxBalls && !this.mouthBlocked()) {
      this.pending--;
      this.spawn(ctx);
    }
    v.balls = ctx.getBalls().length;
  }

  /**
   * The deepest q a ball may reach: touching the first standing tile's face, or the channel's end. A ball's reach grows as it
   * sinks toward the centre (a quarter turn once it touches the centre), so the touching place – the least q whose distance
   * to the face covers the reach from there – is found by bisection (the distance less the reach only grows with q).
   */
  glassFront(): number {
    const L = this.layout!;
    const r = L.ballRadius;
    const end = channelEnd(L, r);
    if (this.frontier >= this.view.tilesTotal) return end;
    const face = tileFaceQ(L.turns, this.frontier);
    const clear = (q: number) => q - face - frontReach(L, q, r) >= 0;
    let lo = Math.max(end, face);
    if (clear(lo)) return lo;
    let hi = Math.max(lo, face + 0.25 + 1e-6);
    for (let k = 0; k < 40; k++) {
      const mid = 0.5 * (lo + hi);
      if (clear(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** The ball runs down the channel at its speed, never into the glass front nor past the channel's end. */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const L = this.layout;
    if (!L) return;
    const st = this.state.get(ball.id) ?? this.adopt(ctx, ball);
    this.subSec = dtSec;
    ball.radius = L.ballRadius;
    ball.gravityScale = 0;
    const want = st.q - (st.speed * dtSec) / channelSpeedScale(L, st.q, L.ballRadius);
    const front = this.glassFront();
    st.blocked = want < front;
    st.q = Math.min(st.q, Math.max(want, front));
    st.contact = -1;
  }

  /**
   * After the sub-step: the balls line up front to back (each at least a diameter behind the one ahead), every ball's place
   * and velocity are written back, the laps past the entrance count, and the front of the queue grinds the glass.
   */
  onPostSubStep(ctx: ModeContext) {
    const L = this.layout;
    if (!L) return;
    const v = this.view;
    const r = L.ballRadius;
    const order = this.order;
    order.length = 0;
    for (const b of ctx.getBalls()) if (this.state.has(b.id)) order.push(b);
    order.sort((a, b) => this.state.get(a.id)!.q - this.state.get(b.id)!.q || a.id - b.id);
    // The queue: a ball that caught up waits a diameter behind the one ahead; the touching run behind the front pushes.
    let pushers = order.length > 0 ? 1 : 0;
    let chain = true;
    for (let i = 0; i < order.length; i++) {
      const st = this.state.get(order[i].id)!;
      if (i > 0) {
        const ahead = this.state.get(order[i - 1].id)!;
        const least = ahead.q + queueGap(L, ahead.q, r);
        if (st.q < least + TOUCH_Q) {
          if (st.q < least) st.blocked = true;
          st.q = Math.max(st.q, least);
          if (chain) pushers++;
        } else chain = false;
      }
      const ball = order[i];
      const p = channelPoint(L, st.q, r);
      ball.x = p.x;
      ball.y = p.y;
      // The laps past the entrance ray.
      const crossed = crossingsBetween(st.q0, st.q);
      while (crossed > st.crossed) {
        st.crossed++;
        if (st.crossed >= 2) this.multiply(ctx, ball, channelRadius(L, st.q, r), channelPhi(st.q));
      }
    }
    // Velocities from the moves (the trails and the HUD read them), at the sub-step's length.
    const sub = this.subSec;
    for (const ball of order) {
      const st = this.state.get(ball.id)!;
      ball.vx = sub > 0 ? (ball.x - st.px) / sub : 0;
      ball.vy = sub > 0 ? (ball.y - st.py) / sub : 0;
      st.px = ball.x;
      st.py = ball.y;
    }
    // The grind: the front ball pressing on the glass (or stuck at the channel's end with glass left) chips the first
    // standing tile, one hit point per chipEvery seconds per ball pushing.
    if (order.length === 0 || v.clearedMs >= 0 || this.frontier >= v.tilesTotal) return;
    const lead = this.state.get(order[0].id)!;
    if (lead.q > this.glassFront() + TOUCH_Q) return;
    lead.contact = tileAlong(L.turns, this.frontier);
    this.grind += sub * Math.min(PUSH_CAP, pushers);
    for (let k = 0; k < PUSH_CAP && this.grind >= this.settings.chipEvery - 1e-9 && this.frontier < v.tilesTotal; k++) {
      this.grind -= this.settings.chipEvery;
      this.chip(ctx, order[0], lead);
    }
  }

  /** A lap past the entrance (at most one per MULTIPLY_COOLDOWN_MS): the badge counts one up, a pop, the multiplier's arpeggio, and a new ball queues for the mouth. */
  private multiply(ctx: ModeContext, ball: Ball, rho: number, phi: number) {
    const v = this.view;
    const L = this.layout!;
    if (this.clockMs - this.lastMultiplyMs < MULTIPLY_COOLDOWN_MS || v.clearedMs >= 0) return;
    this.lastMultiplyMs = this.clockMs;
    v.count++;
    const p = pointOf(L, rho, phi);
    const h = this.popAt;
    this.popAt = (h + 1) % POP_SLOTS;
    v.popX[h] = p.x;
    v.popY[h] = p.y;
    v.popCount[h] = v.count;
    v.popMs[h] = this.clockMs;
    ctx.spawnMergeBurst?.(p.x, p.y, ball.color, L.ballRadius);
    ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: v.count });
    v.notes++;
    if (ctx.getBalls().length + this.pending < this.settings.maxBalls) this.pending++;
  }

  /** A chip: the first standing tile loses a hit point, shards fly, a note (and, on its last point, the shatter and the wall-break sound). */
  private chip(ctx: ModeContext, ball: Ball, st: BallState) {
    const v = this.view;
    const L = this.layout!;
    const tile = tileAlong(L.turns, this.frontier);
    v.hp[tile]--;
    v.hpLeft--;
    v.chips++;
    v.hitMs[tile] = this.clockMs;
    const c = Math.floor(tile / TILES_PER_TURN);
    const gone = v.hp[tile] === 0;
    // The shards leave the tile's face, where the ball presses on it.
    const faceQ = tileFaceQ(L.turns, this.frontier);
    const phiC = channelPhi(faceQ);
    const face = pointOf(L, 0.5 * (bandInner(L, c, phiC) + bandOuter(L, c, phiC)), phiC);
    this.throwShards(ctx, face.x, face.y, phiC, gone ? SHARDS_PER_SHATTER : SHARDS_PER_CHIP, v.hueOf.get(ball.id) ?? 0);
    ctx.noteBounce?.(ball); // --- bounce-math --- a grind on the glass is the ball's bounce
    st.contact = tile;
    if (this.clockMs - this.lastNoteMs >= NOTE_COOLDOWN_MS || gone) {
      this.lastNoteMs = this.clockMs;
      v.notes++;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: c + 1, frequency: chipPitch(c, L.turns), level: gone ? 0.75 : 0.45, accent: gone });
    }
    if (!gone) return;
    v.shatters++;
    v.tilesLeft--;
    while (this.frontier < v.tilesTotal && v.hp[tileAlong(L.turns, this.frontier)] <= 0) this.frontier++;
    if (this.clockMs - this.lastShatterMs >= SHATTER_COOLDOWN_MS) {
      this.lastShatterMs = this.clockMs;
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    }
    if (v.tilesLeft === 0) {
      // GLASS CLEARED: the line's flash (drawn from clearedMs), confetti, the chord, the hold before the end.
      v.clearedMs = this.clockMs;
      const chord = clearChord(L.turns);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true });
      ctx.spawnConfetti(L.cx, L.cy);
      ctx.spawnConfetti(L.cx, L.cy - 0.5 * L.outerRadius);
      ctx.spawnConfetti(L.cx, L.cy + 0.5 * L.outerRadius);
      ctx.noteImpact?.();
    }
  }

  /** Throws `n` shards from (x, y) at angle `phi` on the spiral, outward and along the channel, half in the ball's hue and half white. */
  private throwShards(ctx: ModeContext, x: number, y: number, phi: number, n: number, hue: number) {
    const v = this.view;
    const L = this.layout!;
    const a = phi + Math.PI / 2;
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    const s = 0.3 * L.side;
    for (let i = 0; i < n; i++) {
      let slot: number;
      if (v.shardCount < MAX_SHARDS) slot = v.shardCount++;
      else {
        slot = 0;
        for (let k = 1; k < MAX_SHARDS; k++) if (v.shardLife[k] < v.shardLife[slot]) slot = k;
      }
      const out = (0.4 + 1.2 * ctx.random()) * s;
      const along = (ctx.random() - 0.5) * 1.2 * s;
      v.shardX[slot] = x + (ctx.random() - 0.5) * L.ballRadius;
      v.shardY[slot] = y + (ctx.random() - 0.5) * L.ballRadius;
      v.shardVx[slot] = ox * out + -oy * along;
      v.shardVy[slot] = oy * out + ox * along;
      v.shardRot[slot] = ctx.random() * TWO_PI;
      v.shardSpin[slot] = (ctx.random() - 0.5) * 14;
      v.shardSize[slot] = L.ballRadius * (0.25 + 0.45 * ctx.random());
      const life = 0.6 + 0.6 * ctx.random();
      v.shardLife[slot] = life;
      v.shardMaxLife[slot] = life;
      v.shardHue[slot] = i % 2 === 0 ? hue : -1;
    }
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const L = this.layout;
    if (!L) return;
    // The shards fly on, slow down and fade.
    const dt = dtMs / 1000;
    const keep = Math.pow(0.4, dt);
    for (let i = v.shardCount - 1; i >= 0; i--) {
      v.shardLife[i] -= dt;
      if (v.shardLife[i] <= 0) {
        const last = --v.shardCount;
        if (i !== last) {
          v.shardX[i] = v.shardX[last];
          v.shardY[i] = v.shardY[last];
          v.shardVx[i] = v.shardVx[last];
          v.shardVy[i] = v.shardVy[last];
          v.shardRot[i] = v.shardRot[last];
          v.shardSpin[i] = v.shardSpin[last];
          v.shardSize[i] = v.shardSize[last];
          v.shardLife[i] = v.shardLife[last];
          v.shardMaxLife[i] = v.shardMaxLife[last];
          v.shardHue[i] = v.shardHue[last];
        }
        continue;
      }
      v.shardX[i] += v.shardVx[i] * dt;
      v.shardY[i] += v.shardVy[i] * dt;
      v.shardVx[i] *= keep;
      v.shardVy[i] *= keep;
      v.shardRot[i] += v.shardSpin[i] * dt;
    }
    // Balls that left (a lifetime, a merge elsewhere): their state goes with them.
    if (this.state.size !== ctx.getBalls().length) {
      const live = new Set<number>();
      for (const b of ctx.getBalls()) live.add(b.id);
      for (const id of [...this.state.keys()]) {
        if (live.has(id)) continue;
        this.state.delete(id);
        v.hueOf.delete(id);
      }
    }
    v.balls = ctx.getBalls().length;
    if (v.finished) return;
    if (v.clearedMs >= 0) {
      if (this.clockMs >= v.clearedMs + CLEAR_HOLD_MS - 1e-6) {
        v.finished = true;
        v.finishedMs = this.clockMs;
      }
      return;
    }
    if (this.clockMs >= TIMEOUT_MS - 1e-6) {
      v.timeoutMs = this.clockMs;
      v.finished = true;
      v.finishedMs = this.clockMs;
    }
  }

  /** A resize rebuilds the spiral for the new canvas: every ball keeps its place along the channel (the speeds scale with the field). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || !this.layout) return true;
    const old = this.layout;
    this.rebuild(ctx);
    const L = this.layout!;
    const k = L.side / old.side;
    this.view.shardCount = 0;
    for (const ball of ctx.getBalls()) {
      const st = this.state.get(ball.id);
      if (!st) continue;
      st.speed *= k;
      ball.trail.length = 0;
      ball.trailIndex = 0;
      ball.radius = L.ballRadius;
      const p = channelPoint(L, st.q, L.ballRadius);
      ball.x = p.x;
      ball.y = p.y;
      st.px = p.x;
      st.py = p.y;
      ball.vx *= k;
      ball.vy *= k;
    }
    return true;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** There are no engine rings: the spiral is the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { count: v.count, balls: v.balls, tilesLeft: v.tilesLeft, cleared: v.clearedMs >= 0, timeout: v.timeoutMs >= 0, finished: v.finished };
  }
  /** The channel state of a ball (tests and tools). */
  stateOf(id: number): { q: number; q0: number; rho: number; phi: number; crossed: number; speed: number; contact: number; blocked: boolean } | null {
    const st = this.state.get(id);
    const L = this.layout;
    if (!st || !L) return null;
    return { q: st.q, q0: st.q0, rho: channelRadius(L, st.q, L.ballRadius), phi: channelPhi(st.q), crossed: st.crossed, speed: st.speed, contact: st.contact, blocked: st.blocked };
  }
  /** Where the glass starts along the channel (tests and tools): the first standing tile's position, `tilesTotal` once it is all gone. */
  getFrontier(): number {
    return this.frontier;
  }
}
