import { midiToFrequency } from "@/lib/audio/scales";
import type { ModeId } from "../types";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * Arena games (feature jdm-arena-games; the project.jdm "Bouncing Square BATTLE Royale" and "capture the flag 2-2"
 * formats): the shared part of the two team-game modes built out of bouncing squares – `battle` (battle.ts) and `ctf`
 * (ctf.ts). Pure data and maths, no engine state:
 *
 *  - the settings of both modes, their ranges, validation and short URL keys (settings.ts spreads them into the
 *    SimulatorSettings object and calls `readArenaGameParams()` / `writeArenaGameParams()`),
 *  - the playfield: a box or a circle in the centred square the recorder crops to, under a band for the scoreboard
 *    (`buildArenaField()`), and the shrinking safe zone of the battle,
 *  - the collision maths of axis-aligned squares: square against square (`resolveSquarePair()` – the axis of least
 *    penetration, an elastic impulse with masses ∝ area), square against the box walls and against the circle (the
 *    corner that sticks out is pushed back along the radius),
 *  - the director's nudge (`steerToward()`): a rebound turned a few degrees toward a target, never into the wall,
 *  - the notes of hits and walls (C major pentatonic, snapped to the scale by the ToneGenerator like every hit).
 *
 * Everything here is deterministic; the modes draw their random numbers from `ctx.random()`.
 */

export const ARENA_GAME_MODES = ["battle", "ctf"] as const;
export type ArenaGameMode = (typeof ARENA_GAME_MODES)[number];

export function isArenaGameMode(mode: unknown): mode is ArenaGameMode {
  return typeof mode === "string" && (ARENA_GAME_MODES as readonly string[]).includes(mode);
}

export const BATTLE_ARENAS = ["box", "circle"] as const;
export type BattleArena = (typeof BATTLE_ARENAS)[number];

export function isBattleArena(value: unknown): value is BattleArena {
  return typeof value === "string" && (BATTLE_ARENAS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ settings */

export interface BattleSettings {
  /** Squares in the fight, 2–20 (every square is its own team). */
  count: number;
  /** Hit points every square starts with, 3–20. */
  hp: number;
  /** Damage multiplier: a hit deals `damage × relative speed / Ball Speed`, 0.25–3. */
  damage: number;
  /** The arena: a box or a circle. */
  arena: BattleArena;
  /** The safe zone shrinks over time and pushes the squares together. */
  shrink: boolean;
  /** Heal, shield and speed power-ups spawn at seeded times and places. */
  powerUps: boolean;
  /** 0–1: how far the director turns a wall rebound toward the action (0 = pure physics). */
  nudge: number;
}

export interface CtfSettings {
  /** Squares per team, 1–4 ("2-2" = two a side). */
  perTeam: number;
  /** Captures that win the game, 1–10. */
  scoreToWin: number;
  /** 0–1: how far the director turns a wall rebound toward the square's objective. */
  nudge: number;
  /** The clip length (the recording duration, 10–120 s): the game ends `CTF_FINALE_SEC` before it with the best score. */
  clipSeconds: number;
}

export const DEFAULT_BATTLE_SETTINGS: BattleSettings = { count: 8, hp: 10, damage: 1, arena: "box", shrink: true, powerUps: true, nudge: 0.5 };
export const DEFAULT_CTF_SETTINGS: CtfSettings = { perTeam: 2, scoreToWin: 3, nudge: 0.5, clipSeconds: 30 };

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const ARENA_GAME_RANGES = {
  btCount: { min: 2, max: 20, step: 1 },
  btHp: { min: 3, max: 20, step: 1 },
  btDamage: { min: 0.25, max: 3, step: 0.25 },
  ctfPerTeam: { min: 1, max: 4, step: 1 },
  ctfScoreToWin: { min: 1, max: 10, step: 1 },
  arenaNudge: { min: 0, max: 1, step: 0.05 },
} as const;

/** Range of the clip length the capture-the-flag game follows (the recording duration's). */
export const CTF_CLIP_RANGE = { min: 10, max: 120 } as const;

/** The arena-game fields of the SimulatorSettings object (URL keys btn, bthp, btd, bta, bts, btp, ctfn, ctfw, arn). */
export interface ArenaGameFields {
  btCount: number;
  btHp: number;
  btDamage: number;
  btArena: BattleArena;
  btShrink: boolean;
  btPowerUps: boolean;
  ctfPerTeam: number;
  ctfScoreToWin: number;
  arenaNudge: number;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Rounds onto a slider's step (so 0.37 becomes 0.35 on a 0.05 grid). */
function onStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

/** Fills in the defaults and clamps every battle value (counts whole, the damage and the nudge on their steps); unknown options fall back. */
export function resolveBattleSettings(config: Partial<BattleSettings> | null | undefined, unlimited = false): BattleSettings {
  const out = { ...DEFAULT_BATTLE_SETTINGS };
  if (!config) return out;
  const R = rangesFor(ARENA_GAME_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (config.count !== undefined) out.count = Math.round(clampNumber(config.count, R.btCount, out.count));
  if (config.hp !== undefined) out.hp = Math.round(clampNumber(config.hp, R.btHp, out.hp));
  if (config.damage !== undefined) out.damage = onStep(clampNumber(config.damage, R.btDamage, out.damage), R.btDamage.step);
  if (isBattleArena(config.arena)) out.arena = config.arena;
  if (typeof config.shrink === "boolean") out.shrink = config.shrink;
  if (typeof config.powerUps === "boolean") out.powerUps = config.powerUps;
  if (config.nudge !== undefined) out.nudge = Math.round(100 * onStep(clampNumber(config.nudge, R.arenaNudge, out.nudge), R.arenaNudge.step)) / 100;
  return out;
}

/** Fills in the defaults and clamps every capture-the-flag value; the clip length to the recording duration's range. */
export function resolveCtfSettings(config: Partial<CtfSettings> | null | undefined, unlimited = false): CtfSettings {
  const out = { ...DEFAULT_CTF_SETTINGS };
  if (!config) return out;
  const R = rangesFor(ARENA_GAME_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (config.perTeam !== undefined) out.perTeam = Math.round(clampNumber(config.perTeam, R.ctfPerTeam, out.perTeam));
  if (config.scoreToWin !== undefined) out.scoreToWin = Math.round(clampNumber(config.scoreToWin, R.ctfScoreToWin, out.scoreToWin));
  if (config.nudge !== undefined) out.nudge = Math.round(100 * onStep(clampNumber(config.nudge, R.arenaNudge, out.nudge), R.arenaNudge.step)) / 100;
  if (config.clipSeconds !== undefined) out.clipSeconds = clampNumber(config.clipSeconds, CTF_CLIP_RANGE, out.clipSeconds);
  return out;
}

/** The battle settings of a bigger object (the SimulatorSettings, a preset…) for `engine.setBattleSettings()`. */
export function battleSettingsOf(source: ArenaGameFields): BattleSettings {
  return { count: source.btCount, hp: source.btHp, damage: source.btDamage, arena: source.btArena, shrink: source.btShrink, powerUps: source.btPowerUps, nudge: source.arenaNudge };
}

/** The capture-the-flag settings of a bigger object (the clip is the recording duration) for `engine.setCtfSettings()`. */
export function ctfSettingsOf(source: ArenaGameFields & { recordingDuration?: number }): CtfSettings {
  return { perTeam: source.ctfPerTeam, scoreToWin: source.ctfScoreToWin, nudge: source.arenaNudge, clipSeconds: source.recordingDuration ?? DEFAULT_CTF_SETTINGS.clipSeconds };
}

/** The defaults of the feature's SimulatorSettings fields. */
export function defaultArenaGameFields(): ArenaGameFields {
  const b = DEFAULT_BATTLE_SETTINGS;
  const c = DEFAULT_CTF_SETTINGS;
  return { btCount: b.count, btHp: b.hp, btDamage: b.damage, btArena: b.arena, btShrink: b.shrink, btPowerUps: b.powerUps, ctfPerTeam: c.perTeam, ctfScoreToWin: c.scoreToWin, arenaNudge: b.nudge };
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers, known options, real booleans. */
export function resolveArenaGameFields(source: Partial<ArenaGameFields>): ArenaGameFields {
  const b = resolveBattleSettings({ count: source.btCount, hp: source.btHp, damage: source.btDamage, arena: source.btArena, shrink: source.btShrink, powerUps: source.btPowerUps, nudge: source.arenaNudge });
  const c = resolveCtfSettings({ perTeam: source.ctfPerTeam, scoreToWin: source.ctfScoreToWin });
  return { btCount: b.count, btHp: b.hp, btDamage: b.damage, btArena: b.arena, btShrink: b.shrink, btPowerUps: b.powerUps, ctfPerTeam: c.perTeam, ctfScoreToWin: c.scoreToWin, arenaNudge: b.nudge };
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { btn: "btCount", bthp: "btHp", btd: "btDamage", ctfn: "ctfPerTeam", ctfw: "ctfScoreToWin", arn: "arenaNudge" } as const;
const BOOLEAN_KEYS = { bts: "btShrink", btp: "btPowerUps" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: btn, bthp, btd, bta, bts, btp, ctfn, ctfw and arn. */
export function writeArenaGameParams(settings: ArenaGameFields, base: ArenaGameFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  if (settings.btArena !== base.btArena) params.set("bta", settings.btArena);
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readArenaGameParams(params: URLSearchParams, settings: ArenaGameFields) {
  const next: Partial<ArenaGameFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const arena = params.get("bta");
  if (isBattleArena(arena)) next.btArena = arena;
  Object.assign(settings, resolveArenaGameFields(next));
}

/* ------------------------------------------------------------------ timing, the page and the finder */

/** Seconds the winner banner (and its confetti) is held before the end screen – the page's hold, part of every clip. */
export const ARENA_WIN_HOLD_SEC = 3;
/** Capture the flag: the game ends this long before the clip end ("TIME!"), so the banner fills the clip's last seconds. */
export const CTF_FINALE_SEC = ARENA_WIN_HOLD_SEC;

/** Capture the flag: the second at which the game ends on time (the clip minus the finale, 5 s at least). */
export function ctfTimeLimitSec(clipSeconds: number): number {
  return Math.max(5, clipSeconds - CTF_FINALE_SEC);
}

/**
 * The capture-the-flag settings Find Simulation searches with: the clip (and so the time limit) raised past the target and
 * its tolerance – never lowered, at most the longest recording – so a game won on the score at the target length can be
 * found; the run it finds ends before either time limit, so it replays the same in the page.
 */
export function ctfFinderSettings(settings: CtfSettings, targetSec: number, toleranceSec: number): CtfSettings {
  const wanted = Math.ceil(targetSec + Math.max(0, toleranceSec) + CTF_FINALE_SEC + 1);
  return { ...settings, clipSeconds: Math.min(CTF_CLIP_RANGE.max, Math.max(settings.clipSeconds, wanted)) };
}

/**
 * The recording length for a run the finder found in an arena game: the run plus the winner banner's hold – except a
 * capture-the-flag game that ended on time, whose clip stays as it was (a longer clip would move its time limit and
 * let the game go on).
 */
export function arenaFoundClipSec(mode: ModeId, durationSec: number, clipSeconds: number): number {
  if (mode === "ctf" && durationSec >= ctfTimeLimitSec(clipSeconds) - 1e-3) return clipSeconds;
  return Math.max(CTF_CLIP_RANGE.min, Math.min(CTF_CLIP_RANGE.max, Math.ceil(durationSec + ARENA_WIN_HOLD_SEC - 1e-9)));
}

/* ------------------------------------------------------------------ the playfield */

export interface ArenaField {
  kind: BattleArena;
  /** Centre of the playfield (below the centre of the canvas by half the scoreboard band). */
  cx: number;
  cy: number;
  /** Half extents of the box (the circle: its radius both ways). */
  halfW: number;
  halfH: number;
  /** The circle's radius (the box: the smaller half extent). */
  radius: number;
  /** The centred square the recorder crops to: its side and top-left corner. */
  side: number;
  sqLeft: number;
  sqTop: number;
  /** The scoreboard band at the top of the square (above the field). */
  hudTop: number;
  hudHeight: number;
  /** The canvas the field was laid out for (a resize maps the squares onto the new field). */
  canvasWidth: number;
  canvasHeight: number;
}

/** Fraction of the square's side the scoreboard band takes. */
export const HUD_BAND = 0.1;

/** The playfield for a canvas of `width` × `height`: a box or a circle filling the centred square under the scoreboard band. */
export function buildArenaField(width: number, height: number, kind: BattleArena): ArenaField {
  const side = Math.max(40, Math.min(width, height));
  const margin = Math.max(6, 0.035 * side);
  const hud = HUD_BAND * side;
  const sqLeft = width / 2 - side / 2;
  const sqTop = height / 2 - side / 2;
  const halfW = (side - 2 * margin) / 2;
  const halfH = (side - hud - margin) / 2;
  const cx = width / 2;
  const cy = sqTop + hud + halfH;
  if (kind === "circle") {
    const r = Math.min(halfW, halfH);
    return { kind, cx, cy, halfW: r, halfH: r, radius: r, side, sqLeft, sqTop, hudTop: sqTop, hudHeight: hud, canvasWidth: width, canvasHeight: height };
  }
  return { kind, cx, cy, halfW, halfH, radius: Math.min(halfW, halfH), side, sqLeft, sqTop, hudTop: sqTop, hudHeight: hud, canvasWidth: width, canvasHeight: height };
}

/**
 * The squares' speeds scale with the arena: the Ball Speed is px/s on a square of `ARENA_REFERENCE_SIDE` px, so a game
 * plays the same – the same seed, the same run – whatever the size of the canvas (every length scales with it too).
 */
export const ARENA_REFERENCE_SIDE = 800;

/** The Ball Speed (px/s) the squares of a field cruise at: `ballSpeed × side / ARENA_REFERENCE_SIDE`. */
export function arenaSpeed(field: ArenaField, ballSpeed: number): number {
  return (ballSpeed || 400) * Math.max(0.05, field.side / ARENA_REFERENCE_SIDE);
}

/** Area (px²) of the field scaled by `zone` (the safe zone; 1 = the whole field). */
export function zoneArea(field: ArenaField, zone = 1): number {
  return field.kind === "circle" ? Math.PI * (field.radius * zone) ** 2 : 4 * field.halfW * field.halfH * zone * zone;
}

/** The biggest square half-size (px) that still fits in a zone of scale `zone` with room to move. */
export function maxSquareHalf(field: ArenaField, zone = 1): number {
  const room = field.kind === "circle" ? (field.radius * zone) / Math.SQRT2 : Math.min(field.halfW, field.halfH) * zone;
  return Math.max(2, 0.3 * room);
}

/* ------------------------------------------------------------------ collision maths */

/** A square as the collision maths sees it: centre, velocity and half-size (an engine ball with `radius` = half the side). */
export interface SquareBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/** What `resolveSquarePair()` found (written into a caller-owned object, so the pair loop never allocates). */
export interface PairContact {
  /** Normal from a to b along the axis of least penetration (one of (±1, 0), (0, ±1)). */
  nx: number;
  ny: number;
  /** Approach speed along the normal before the impulse (px/s, > 0 for an impact). */
  approach: number;
  /** Speeds of a and b before the impulse. */
  speedA: number;
  speedB: number;
}

/**
 * Resolves two axis-aligned squares: when they overlap, they are pushed apart along the axis of least penetration
 * (split by inverse mass, mass ∝ side²) and, while approaching, exchange an impulse with restitution `e`. Returns true
 * for a contact (`out` then holds the normal and the approach speed – 0 when they were not closing in).
 */
export function resolveSquarePair(a: SquareBody, b: SquareBody, e: number, out: PairContact): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = a.radius + b.radius;
  const px = reach - Math.abs(dx);
  const py = reach - Math.abs(dy);
  if (px <= 0 || py <= 0) return false;
  const ima = 1 / Math.max(1e-9, a.radius * a.radius);
  const imb = 1 / Math.max(1e-9, b.radius * b.radius);
  const sum = ima + imb;
  let nx = 0;
  let ny = 0;
  let pen: number;
  if (px < py) {
    nx = dx < 0 ? -1 : 1;
    pen = px;
  } else {
    ny = dy < 0 ? -1 : 1;
    pen = py;
  }
  a.x -= (nx * pen * ima) / sum;
  a.y -= (ny * pen * ima) / sum;
  b.x += (nx * pen * imb) / sum;
  b.y += (ny * pen * imb) / sum;
  out.nx = nx;
  out.ny = ny;
  out.speedA = Math.hypot(a.vx, a.vy);
  out.speedB = Math.hypot(b.vx, b.vy);
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) {
    out.approach = 0;
    return true;
  }
  const j = (-(1 + e) * rel) / sum;
  a.vx -= j * ima * nx;
  a.vy -= j * ima * ny;
  b.vx += j * imb * nx;
  b.vy += j * imb * ny;
  out.approach = -rel;
  return true;
}

/** The box walls, in the order of their notes: top, right, bottom, left. */
export const WALL_TOP = 0;
export const WALL_RIGHT = 1;
export const WALL_BOTTOM = 2;
export const WALL_LEFT = 3;

/** What a wall pass hit (written into a caller-owned object). */
export interface WallContact {
  /** The wall that was hit (WALL_* for the box; the octant of the contact for the circle), −1 for none. */
  wall: number;
  /** Speed into the wall before the rebound (0 when the square only rested on it). */
  approach: number;
  /** Inward normal of the contact (the rebound direction). */
  nx: number;
  ny: number;
}

/**
 * Keeps a square inside a box of half extents `hw` × `hh` around (`cx`, `cy`): a square poking through a wall is put
 * back and, when it was moving outward, reflected with restitution `e`. A corner reports the wall it moved into
 * fastest. Returns true when a wall was touched.
 */
export function boxWallPass(s: SquareBody, cx: number, cy: number, hw: number, hh: number, e: number, out: WallContact): boolean {
  out.wall = -1;
  out.approach = 0;
  const r = s.radius;
  const left = cx - hw + r;
  const right = cx + hw - r;
  const top = cy - hh + r;
  const bottom = cy + hh - r;
  let best = -1;
  if (left > right) s.x = cx;
  else if (s.x < left) {
    s.x = left;
    if (s.vx < 0) {
      const vn = -s.vx;
      s.vx = vn * e;
      if (vn > best) {
        best = vn;
        setWall(out, WALL_LEFT, vn, 1, 0);
      }
    } else if (best < 0) setWall(out, WALL_LEFT, 0, 1, 0);
  } else if (s.x > right) {
    s.x = right;
    if (s.vx > 0) {
      const vn = s.vx;
      s.vx = -vn * e;
      if (vn > best) {
        best = vn;
        setWall(out, WALL_RIGHT, vn, -1, 0);
      }
    } else if (best < 0) setWall(out, WALL_RIGHT, 0, -1, 0);
  }
  if (top > bottom) s.y = cy;
  else if (s.y < top) {
    s.y = top;
    if (s.vy < 0) {
      const vn = -s.vy;
      s.vy = vn * e;
      if (vn > best) {
        best = vn;
        setWall(out, WALL_TOP, vn, 0, 1);
      }
    } else if (out.wall < 0) setWall(out, WALL_TOP, 0, 0, 1);
  } else if (s.y > bottom) {
    s.y = bottom;
    if (s.vy > 0) {
      const vn = s.vy;
      s.vy = -vn * e;
      if (vn > best) {
        best = vn;
        setWall(out, WALL_BOTTOM, vn, 0, -1);
      }
    } else if (out.wall < 0) setWall(out, WALL_BOTTOM, 0, 0, -1);
  }
  return out.wall >= 0;
}

function setWall(out: WallContact, wall: number, approach: number, nx: number, ny: number) {
  out.wall = wall;
  out.approach = approach;
  out.nx = nx;
  out.ny = ny;
}

/**
 * Keeps a square inside a circle of radius `R` around (`cx`, `cy`): the corner farthest out (the square never turns)
 * is pushed back along its radius and the velocity reflected about that radius with restitution `e`. `out.wall` is
 * the octant (0–7, clockwise from the right) the corner touched.
 */
export function circleWallPass(s: SquareBody, cx: number, cy: number, R: number, e: number, out: WallContact): boolean {
  out.wall = -1;
  out.approach = 0;
  const r = s.radius;
  const sx = s.x >= cx ? 1 : -1;
  const sy = s.y >= cy ? 1 : -1;
  const kx = s.x + sx * r - cx;
  const ky = s.y + sy * r - cy;
  const d = Math.hypot(kx, ky);
  if (d <= R) return false;
  const ux = kx / d;
  const uy = ky / d;
  const push = d - R;
  s.x -= ux * push;
  s.y -= uy * push;
  // A square too big for the circle (a live size change) is simply centred.
  if (r * Math.SQRT2 >= R) {
    s.x = cx;
    s.y = cy;
  }
  const vn = s.vx * ux + s.vy * uy;
  let angle = Math.atan2(uy, ux);
  if (angle < 0) angle += 2 * Math.PI;
  out.wall = Math.min(7, Math.floor((angle / (2 * Math.PI)) * 8));
  out.nx = -ux;
  out.ny = -uy;
  if (vn > 0) {
    s.vx -= (1 + e) * vn * ux;
    s.vy -= (1 + e) * vn * uy;
    out.approach = vn;
  }
  return true;
}

/* ------------------------------------------------------------------ the director's nudge */

/** Largest turn (radians) of a rebound at nudge 1. */
export const MAX_NUDGE = (32 * Math.PI) / 180;
/** A nudged rebound leaves the wall at this angle at least (so it never slides along or back into it). */
export const MIN_WALL_ANGLE = (14 * Math.PI) / 180;

/**
 * Turns the velocity (`vx`, `vy`) toward the direction (`tx`, `ty`) by at most `maxTurn` radians, keeping its length.
 * With an inward wall normal (`nx`, `ny`) (0, 0 for none) the new direction must still leave the wall at
 * `MIN_WALL_ANGLE` or more: the turn is halved until it does (and dropped when even an eighth does not). Writes the
 * velocity into `out` and returns the signed turn applied.
 */
export function steerToward(vx: number, vy: number, tx: number, ty: number, maxTurn: number, nx: number, ny: number, out: { vx: number; vy: number }): number {
  out.vx = vx;
  out.vy = vy;
  const speed = Math.hypot(vx, vy);
  if (!(speed > 0) || !(maxTurn > 0) || (tx === 0 && ty === 0)) return 0;
  const cur = Math.atan2(vy, vx);
  let diff = Math.atan2(ty, tx) - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  let turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const hasWall = nx !== 0 || ny !== 0;
  const minOut = Math.sin(MIN_WALL_ANGLE);
  for (let attempt = 0; attempt < 4; attempt++) {
    const a = cur + turn;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    if (!hasWall || ux * nx + uy * ny >= minOut) {
      out.vx = ux * speed;
      out.vy = uy * speed;
      return turn;
    }
    turn /= 2;
  }
  return 0;
}

/** A launch angle away from the axes (so no square slides along a wall): 12°–78° into a quadrant, from two uniform draws. */
export function offAxisAngle(u: number, w: number): number {
  const margin = (12 * Math.PI) / 180;
  const quadrant = Math.min(3, Math.floor(4 * u));
  return quadrant * (Math.PI / 2) + margin + w * (Math.PI / 2 - 2 * margin);
}

/* ------------------------------------------------------------------ notes */

const PENTATONIC = [0, 2, 4, 7, 9];

/** Frequency of degree `degree` of C major pentatonic counted from MIDI note `baseMidi` (C3 = 48, C5 = 72). */
export function pentatonicNote(degree: number, baseMidi: number): number {
  const d = Math.max(0, Math.floor(degree));
  return midiToFrequency(baseMidi + 12 * Math.floor(d / PENTATONIC.length) + PENTATONIC[d % PENTATONIC.length]);
}

/** Note of a wall hit: the four box walls play C5 E5 G5 C6 (like Bouncing Shapes), the circle's octants climb the pentatonic scale from C5. */
export function arenaWallNote(kind: BattleArena, wall: number): number {
  if (kind === "box") return [659.25, 783.99, 1046.5, 523.25][Math.max(0, Math.min(3, wall))];
  return pentatonicNote(Math.max(0, wall), 72);
}

/** Note of a clash: square `index` has its own degree of C major pentatonic from C3 (the 20 squares span four octaves). */
export function clashNote(index: number): number {
  return pentatonicNote(index % 20, 48);
}

/** A big chord (C major from C4) for a KO shake-up, the winner and the capture fanfare's last step. */
export const WIN_CHORD: readonly number[] = [261.63, 329.63, 392, 523.25];
/** The KO: a low, dark accent (C3 G3 C4). */
export const KO_CHORD: readonly number[] = [130.81, 196, 261.63];
/** The capture fanfare: three rising chords a short step apart (C–E–G, F–A–C, G–B–D–G). */
export const FANFARE: readonly (readonly number[])[] = [
  [261.63, 329.63, 392],
  [349.23, 440, 523.25],
  [392, 493.88, 587.33, 783.99],
];
/** Seconds between the fanfare's chords. */
export const FANFARE_STEP_SEC = 0.16;

/* ------------------------------------------------------------------ names and colours */

/** Built-in colours of the squares (the first six are the Teams roster presets' colours). */
export const ARENA_COLORS: readonly string[] = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#14b8a6",
  "#fb7185",
  "#6366f1",
  "#34d399",
  "#c084fc",
  "#f59e0b",
  "#38bdf8",
  "#f43f5e",
  "#a3a635",
  "#1e40af",
  "#e5e7eb",
];

/** Colour of square / team `index` without a roster. */
export function arenaColor(index: number): string {
  return ARENA_COLORS[((index % ARENA_COLORS.length) + ARENA_COLORS.length) % ARENA_COLORS.length];
}

/* ------------------------------------------------------------------ the view the canvas draws */

/** A square knocked out: where it blew up (for the renderer's shards and the "KO" callout). */
export interface ArenaKo {
  /** Index of the square. */
  index: number;
  x: number;
  y: number;
  /** Half-size of the square when it blew up. */
  half: number;
  /** Simulation time (ms) of the KO. */
  timeMs: number;
}

export const POWER_UP_KINDS = ["heal", "shield", "speed"] as const;
export type PowerUpKind = (typeof POWER_UP_KINDS)[number];

/** A power-up on the field (battle). */
export interface ArenaPowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  r: number;
  spawnMs: number;
  /** Simulation time at which it disappears if nobody takes it. */
  expireMs: number;
}

export type FlagState = "base" | "carried" | "dropped";

/** A team's flag (capture the flag). */
export interface ArenaFlag {
  state: FlagState;
  x: number;
  y: number;
  /** Index of the square carrying it (−1 unless carried). */
  carrier: number;
  /** Simulation time (ms) of the last change of state. */
  sinceMs: number;
}

/** A team's base: the rectangle a carrier scores in, the flag's home at its centre. */
export interface ArenaBase {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/**
 * What the canvas needs to draw an arena game; the same object every call (its arrays are replaced on a restart). Square
 * k is the engine ball with id `firstId + k` while it is alive.
 */
export interface ArenaView {
  game: ArenaGameMode;
  /** Bumped on every restart, so renderers drop per-run caches. */
  generation: number;
  field: ArenaField | null;
  /** Battle: the safe zone's scale (1 = the whole field). */
  zone: number;
  /** Battle: the zone is closing in (for the warning pulse). */
  zoneShrinking: boolean;
  count: number;
  firstId: number;
  /** Team (colour / name index) of each square: battle – its own index; capture the flag – 0 or 1. */
  team: Int8Array;
  alive: Uint8Array;
  hp: Float32Array;
  maxHp: number;
  /** Simulation times (ms) of each square's last hit taken, last clash dealt, shield end and speed-boost end (−Infinity = none). */
  hitMs: Float64Array;
  clashMs: Float64Array;
  shieldUntilMs: Float64Array;
  speedUntilMs: Float64Array;
  kills: Int16Array;
  kos: ArenaKo[];
  powerUps: ArenaPowerUp[];
  /** Simulation time of the last hit per wall (box: WALL_*; circle: octants). */
  wallHitMs: Float64Array;
  /** Capture the flag: the two flags, bases and scores, and the flag each square carries (−1 = none). */
  flags: ArenaFlag[];
  bases: ArenaBase[];
  scores: number[];
  carrying: Int8Array;
  lastCaptureMs: number;
  lastCaptureTeam: number;
  /** Capture the flag: the second the game ends on time. */
  timeLimitSec: number;
  /** Simulation time (ms) of the latest step. */
  timeMs: number;
  finished: boolean;
  finishMs: number;
  /** Battle: the last square standing; capture the flag: the winning team; −1 = a draw. */
  winner: number;
  /** Capture the flag: the game ended on time (not on the score to win). */
  byTime: boolean;
  /** Counters (for the HUD, the canvas' data attributes and the tests). */
  hits: number;
  wallHits: number;
  notes: number;
  pickups: number;
  captures: number;
  drops: number;
  returns: number;
}

export function createArenaView(game: ArenaGameMode): ArenaView {
  return {
    game,
    generation: 0,
    field: null,
    zone: 1,
    zoneShrinking: false,
    count: 0,
    firstId: 0,
    team: new Int8Array(0),
    alive: new Uint8Array(0),
    hp: new Float32Array(0),
    maxHp: 1,
    hitMs: new Float64Array(0),
    clashMs: new Float64Array(0),
    shieldUntilMs: new Float64Array(0),
    speedUntilMs: new Float64Array(0),
    kills: new Int16Array(0),
    kos: [],
    powerUps: [],
    wallHitMs: new Float64Array(8).fill(-Infinity),
    flags: [],
    bases: [],
    scores: [0, 0],
    carrying: new Int8Array(0),
    lastCaptureMs: -Infinity,
    lastCaptureTeam: -1,
    timeLimitSec: 0,
    timeMs: 0,
    finished: false,
    finishMs: -Infinity,
    winner: -1,
    byTime: false,
    hits: 0,
    wallHits: 0,
    notes: 0,
    pickups: 0,
    captures: 0,
    drops: 0,
    returns: 0,
  };
}

/** Resets `view` for a new run of `count` squares (fresh arrays; the counters, KOs, power-ups and flags cleared). */
export function resetArenaView(view: ArenaView, count: number, firstId: number, field: ArenaField, maxHp: number) {
  view.generation++;
  view.field = field;
  view.zone = 1;
  view.zoneShrinking = false;
  view.count = count;
  view.firstId = firstId;
  view.team = new Int8Array(count);
  view.alive = new Uint8Array(count).fill(1);
  view.hp = new Float32Array(count).fill(maxHp);
  view.maxHp = maxHp;
  view.hitMs = new Float64Array(count).fill(-Infinity);
  view.clashMs = new Float64Array(count).fill(-Infinity);
  view.shieldUntilMs = new Float64Array(count).fill(-Infinity);
  view.speedUntilMs = new Float64Array(count).fill(-Infinity);
  view.kills = new Int16Array(count);
  view.kos = [];
  view.powerUps = [];
  view.wallHitMs.fill(-Infinity);
  view.flags = [];
  view.bases = [];
  view.scores = [0, 0];
  view.carrying = new Int8Array(count).fill(-1);
  view.lastCaptureMs = -Infinity;
  view.lastCaptureTeam = -1;
  view.timeLimitSec = 0;
  view.timeMs = 0;
  view.finished = false;
  view.finishMs = -Infinity;
  view.winner = -1;
  view.byTime = false;
  view.hits = 0;
  view.wallHits = 0;
  view.notes = 0;
  view.pickups = 0;
  view.captures = 0;
  view.drops = 0;
  view.returns = 0;
}

/* ------------------------------------------------------------------ the per-frame sound budget */

/** Most wall and clash notes one rendered frame plays (the strongest win); KOs, pickups and fanfares always sound. */
export const ARENA_SOUNDS_PER_FRAME = 8;

/**
 * The strongest `ARENA_SOUNDS_PER_FRAME` notes offered since the sounds were last consumed (across however many 60 Hz
 * steps the frame ran – several at a faster playback speed), queued strongest first by `flush()`. Sound only: the
 * physics never reads it (determinism).
 */
export class ArenaSoundBudget {
  private readonly energy = new Float64Array(ARENA_SOUNDS_PER_FRAME);
  private readonly freq = new Float64Array(ARENA_SOUNDS_PER_FRAME);
  private readonly level = new Float64Array(ARENA_SOUNDS_PER_FRAME);
  private readonly accent = new Uint8Array(ARENA_SOUNDS_PER_FRAME);
  private readonly order = new Int32Array(ARENA_SOUNDS_PER_FRAME);
  private count = 0;

  clear() {
    this.count = 0;
  }

  offer(energy: number, frequency: number, level: number, accent = false) {
    let slot = this.count;
    if (slot >= ARENA_SOUNDS_PER_FRAME) {
      slot = 0;
      for (let i = 1; i < ARENA_SOUNDS_PER_FRAME; i++) if (this.energy[i] < this.energy[slot]) slot = i;
      if (!(energy > this.energy[slot])) return;
    } else this.count++;
    this.energy[slot] = energy;
    this.freq[slot] = frequency;
    this.level[slot] = level;
    this.accent[slot] = accent ? 1 : 0;
  }

  /** Queues the kept notes strongest first through `push` and empties the budget; returns how many. */
  flush(push: (frequency: number, level: number, accent: boolean) => void): number {
    const n = this.count;
    const order = this.order;
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = 1; i < n; i++) {
      const cur = order[i];
      let j = i - 1;
      while (j >= 0 && this.energy[order[j]] < this.energy[cur]) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = cur;
    }
    for (let i = 0; i < n; i++) push(this.freq[order[i]], this.level[order[i]], this.accent[order[i]] === 1);
    this.count = 0;
    return n;
  }
}
