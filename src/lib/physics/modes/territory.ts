import { midiToFrequency } from "@/lib/audio/scales";
import { circleObstacle, resolveBallCircle } from "../obstacles";
import { rangesFor } from "@/lib/unlimited"; // --- unlimited --- (No limits: the settings past their sliders)
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";

/**
 * Territory ("territory" mode, battle family – feature odd-territory): the oddplayground "Pong-wars style physics
 * simulation" (#territory – "Vortex VS Bomber | One bounce can flip the board"). A tile map fills the centred square the
 * recorder crops to, under a HUD band; it starts split into 2 or 4 team regions (top / bottom, or four quadrants) and
 * every team owns `ballsPerTeam` balls that start inside its region. The pong-wars rule: a ball passes through tiles of
 * its own colour and bounces off a tile of any other colour, converting the tile it hit to its own colour – so every
 * bounce paints the board, and the live percentage bar tracks who is winning. When the countdown (`duration`) runs out
 * the team with the most tiles wins; a level top is a DRAW.
 *
 * Every team may have a power (`powers`, one per team slot):
 *
 *  - `vortex`: its balls curve their own path, and every `powerEvery` seconds a ball drags a whirl – two spiral arms that
 *    sweep out to `radius` tiles around it over `TY_WHIRL_MS`, converting the enemy tiles they cross;
 *  - `bomber`: every `powerEvery` seconds a ball arms, and it explodes on its next bounce off an enemy tile (or where it
 *    is, `TY_ARM_MAX_MS` later) – every tile within `radius` becomes its team's (a shock ring, debris, the wall-break sound
 *    and a jolt of the board; nearby balls are blown away): one bounce can flip the board;
 *  - `painter`: every `powerEvery` seconds a ball dashes (`TY_DASH_TILES` tiles, a little faster) straight through enemy
 *    territory without bouncing, painting a one-tile trail;
 *  - `ghost`: its balls pass through enemy tiles without bouncing (and without converting them) and convert a 3×3 block
 *    (the one around the tile they are in, moved inside the board) on every bounce off the arena's frame;
 *  - `none`: classic pong wars.
 *
 * Physics: the engine moves the balls (no gravity: `gravityScale` 0, its slow-ball boost off: `ballsMayRest`), resolves
 * ball-to-ball collisions (elastic, equal masses) in its pair loop, and calls `onBallStep()`, where the mode keeps every
 * ball at its cruising speed (a fraction of the square per second – the same run on any canvas size, up to rounding), bounces
 * it off the frame with a seeded scatter, off the optional pegs (`pegs`: the reels' faint dotted grid, a dot every
 * `TY_PEG_STEP` tiles, resolved with the obstacle layer's `resolveBallCircle()`), and runs the tile probe: eight points on
 * the ball's rim; every point moving into an enemy tile converts it, and the ball reflects once about the sum of their
 * directions. No side and no ball order is favoured: the reflection is the same for every heading, the conversions of a
 * sub-step apply at its end (every ball judges the board as it stood when the sub-step began), and the teams' balls join
 * the engine's ball list in turns. Everything random – the spawn, the headings, the curve of a vortex, the power phases,
 * every frame bounce's scatter – comes from `ctx.random()`, so a seed replays exactly and Find Simulation can search it.
 *
 * The tiles live in a `Uint8Array` (row-major, the owner per tile) with running counts per team; the canvas keeps an
 * offscreen copy and repaints only the tiles that changed. Recent flips go into a fixed ring (`flipTile` …) for the
 * canvas' pop animation, bomber explosions into `shocks`.
 *
 * Scoring: at the verdict every team is credited with its tile count as "walls" (`ctx.creditWallBreak`) and the leaders
 * with an "escape" (`ctx.creditEscape`), so the teams winner banner, the finder's "winner" outcome and the scoreboard rank
 * the battle like the tile count (a DRAW stays a tie there). The rigged forced winner (`config.forcedWinner`) is a hard
 * constraint here: a conversion that would put a rival ahead of the chosen team is absorbed (the ball still bounces, the
 * tile keeps its colour – `rigBlocksConversion()`), and a level verdict goes to the chosen team.
 */

export const TY_POWERS = ["none", "vortex", "bomber", "painter", "ghost"] as const;
export type TyPower = (typeof TY_POWERS)[number];

export function isTyPower(value: unknown): value is TyPower {
  return typeof value === "string" && (TY_POWERS as readonly string[]).includes(value);
}

/** Team slots the mode knows (the 4-team split). */
export const TY_MAX_TEAMS = 4;

export interface TerritorySettings {
  /** Tile columns, 12–48 (the rows follow from the field's aspect: `territoryRows()`). */
  cols: number;
  /** 2 (top / bottom) or 4 (quadrants). */
  teams: 2 | 4;
  /** Balls per team, 1–8. */
  ballsPerTeam: number;
  /** The power of every team slot (always `TY_MAX_TEAMS` entries; the slots beyond `teams` are ignored). */
  powers: TyPower[];
  /** Seconds between two triggers of a timed power (vortex, bomber, painter), 1–10. */
  powerEvery: number;
  /** Reach of the vortex's whirl and the bomber's blast, in tiles, 1–8. */
  radius: number;
  /** The countdown, seconds, 10–120: the team with the most tiles when it runs out wins. */
  duration: number;
  /** The faint dotted grid of the reels: dots every `TY_PEG_STEP` tiles that deflect the balls. */
  pegs: boolean;
  /** The "FLASHING LIGHTS – THE END GETS INTENSE" warning badge. */
  badge: boolean;
  /** The HUD: "VORTEX 52% VS BOMBER 48%", the percentage bar, PICK A SIDE and the countdown. */
  hud: boolean;
}

export const DEFAULT_TY_POWERS: readonly TyPower[] = ["vortex", "bomber", "painter", "ghost"];

export const DEFAULT_TERRITORY_SETTINGS: TerritorySettings = {
  cols: 24,
  teams: 2,
  ballsPerTeam: 2,
  powers: [...DEFAULT_TY_POWERS],
  powerEvery: 3,
  radius: 3,
  duration: 30,
  pegs: false,
  badge: true,
  hud: true,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const TERRITORY_RANGES = {
  tyCols: { min: 12, max: 48, step: 1 },
  tyTeams: { min: 2, max: 4, step: 2 },
  tyBallsPerTeam: { min: 1, max: 8, step: 1 },
  tyPowerEvery: { min: 1, max: 10, step: 0.5 },
  tyRadius: { min: 1, max: 8, step: 1 },
  tyDuration: { min: 10, max: 120, step: 5 },
} as const;

/** The Territory fields of the SimulatorSettings object (URL keys tyc, tyt, tyb, typ, tye, tyr, tyd, typg, tybg, tyh). */
export interface TerritorySettingFields {
  tyCols: number;
  tyTeams: number;
  tyBallsPerTeam: number;
  /** The powers of the four team slots, comma-separated ("vortex,bomber,painter,ghost"). */
  tyPowers: string;
  tyPowerEvery: number;
  tyRadius: number;
  tyDuration: number;
  tyPegs: boolean;
  tyBadge: boolean;
  tyHud: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** The four slots' powers from a comma list (or an array); unknown entries and missing slots take the defaults. */
export function parseTyPowers(value: unknown): TyPower[] {
  const parts: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",").map((p) => p.trim()) : [];
  const out: TyPower[] = [];
  for (let i = 0; i < TY_MAX_TEAMS; i++) out.push(isTyPower(parts[i]) ? (parts[i] as TyPower) : DEFAULT_TY_POWERS[i]);
  return out;
}

/** The comma list of the four slots' powers. */
export function serializeTyPowers(powers: readonly TyPower[]): string {
  return parseTyPowers(powers).join(",");
}

/**
 * Fills in the defaults and clamps every value (counts and the duration whole, the interval on its 0.5 s steps); unknown
 * powers and non-boolean flags fall back to the defaults. With `unlimited` (No limits on) the numbers go past their sliders,
 * up to their soft ceilings (`rangesFor()`, lib/unlimited.ts); the teams stay 2 or 4.
 */
export function resolveTerritorySettings(config: Partial<Omit<TerritorySettings, "teams" | "powers">> & { teams?: unknown; powers?: unknown } | null | undefined, unlimited = false): TerritorySettings {
  const out: TerritorySettings = { ...DEFAULT_TERRITORY_SETTINGS, powers: [...DEFAULT_TY_POWERS] };
  if (!config) return out;
  const R = rangesFor(TERRITORY_RANGES, unlimited);
  if (config.cols !== undefined) out.cols = Math.round(clampNumber(config.cols, R.tyCols, out.cols));
  if (config.teams !== undefined) {
    const n = Number(config.teams);
    if (Number.isFinite(n)) out.teams = n >= 3 ? 4 : 2;
  }
  if (config.ballsPerTeam !== undefined) out.ballsPerTeam = Math.round(clampNumber(config.ballsPerTeam, R.tyBallsPerTeam, out.ballsPerTeam));
  if (config.powers !== undefined) out.powers = parseTyPowers(config.powers);
  if (config.powerEvery !== undefined) out.powerEvery = Math.round(2 * clampNumber(config.powerEvery, R.tyPowerEvery, out.powerEvery)) / 2;
  if (config.radius !== undefined) out.radius = Math.round(clampNumber(config.radius, R.tyRadius, out.radius));
  if (config.duration !== undefined) out.duration = Math.round(clampNumber(config.duration, R.tyDuration, out.duration));
  if (typeof config.pegs === "boolean") out.pegs = config.pegs;
  if (typeof config.badge === "boolean") out.badge = config.badge;
  if (typeof config.hud === "boolean") out.hud = config.hud;
  return out;
}

/** Picks the Territory settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setTerritorySettings()` – past the sliders when it has No limits on. */
export function territorySettingsOf(source: TerritorySettingFields & { unlimited?: boolean }): TerritorySettings {
  return resolveTerritorySettings({
    cols: source.tyCols,
    teams: source.tyTeams,
    ballsPerTeam: source.tyBallsPerTeam,
    powers: source.tyPowers,
    powerEvery: source.tyPowerEvery,
    radius: source.tyRadius,
    duration: source.tyDuration,
    pegs: source.tyPegs,
    badge: source.tyBadge,
    hud: source.tyHud,
  }, source.unlimited === true);
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function territorySettingFields(settings: TerritorySettings): TerritorySettingFields {
  return {
    tyCols: settings.cols,
    tyTeams: settings.teams,
    tyBallsPerTeam: settings.ballsPerTeam,
    tyPowers: serializeTyPowers(settings.powers),
    tyPowerEvery: settings.powerEvery,
    tyRadius: settings.radius,
    tyDuration: settings.duration,
    tyPegs: settings.pegs,
    tyBadge: settings.badge,
    tyHud: settings.hud,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** The defaults of the feature's fields. */
export function defaultTerritoryFields(): TerritorySettingFields {
  return territorySettingFields(DEFAULT_TERRITORY_SETTINGS);
}

/** Seconds the default clip runs past the countdown: the verdict, the winner banner and its hold. */
export const TY_CLIP_TAIL_SEC = 4;

/** The clip length (s) that covers a countdown of `durationSec` and its verdict (clamped to the recording range 10–120). */
export function territoryClipSec(durationSec: number): number {
  return Math.max(10, Math.min(120, Math.round(durationSec) + TY_CLIP_TAIL_SEC));
}

/** The mode's own defaults of shared settings: in Territory the clip covers the default countdown and its verdict. */
export function territoryModeDefaults(mode: string): { recordingDuration?: number } {
  return mode === "territory" ? { recordingDuration: territoryClipSec(DEFAULT_TERRITORY_SETTINGS.duration) } : {};
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers, known powers, real booleans. */
export function resolveTerritoryFields(source: Partial<TerritorySettingFields>): TerritorySettingFields {
  return territorySettingFields(territorySettingsOf({ ...defaultTerritoryFields(), ...stripUndefined(source) }));
}

function stripUndefined<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(source) as (keyof T)[]) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { tyc: "tyCols", tyt: "tyTeams", tyb: "tyBallsPerTeam", tye: "tyPowerEvery", tyr: "tyRadius", tyd: "tyDuration" } as const;
const BOOLEAN_KEYS = { typg: "tyPegs", tybg: "tyBadge", tyh: "tyHud" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: tyc, tyt, tyb, typ, tye, tyr, tyd, typg, tybg and tyh. */
export function writeTerritoryParams(settings: TerritorySettingFields, base: TerritorySettingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (serializeTyPowers(parseTyPowers(settings.tyPowers)) !== serializeTyPowers(parseTyPowers(base.tyPowers))) params.set("typ", serializeTyPowers(parseTyPowers(settings.tyPowers)));
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readTerritoryParams(params: URLSearchParams, settings: TerritorySettingFields) {
  const next: Partial<TerritorySettingFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const powers = params.get("typ");
  if (powers !== null) next.tyPowers = powers;
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveTerritoryFields(next));
}

/* ------------------------------------------------------------------ constants */

/** The default names and colours of the four teams when no team roster is set: oddplayground's neon on black. */
export const TY_PALETTE: readonly { name: string; color: string }[] = [
  { name: "PINK", color: "#ff2d95" },
  { name: "CYAN", color: "#22e4ff" },
  { name: "LIME", color: "#b6ff1a" },
  { name: "GOLD", color: "#ffc61a" },
];
/** The HUD band at the top of the square (fraction of its side) and the margin around the field. */
export const TY_HUD_BAND = 0.16;
export const TY_MARGIN = 0.03;
/** Cruising speed: this fraction of the square's side per second at Ball Speed 400 (a ball crosses the field in about three seconds). */
export const TY_SPEED = 0.8;
/** A ball's radius is this fraction of a tile at Ball Size 8 (pong wars: a ball about a tile wide), kept within [TY_MIN_RADIUS, TY_MAX_RADIUS] tiles. */
export const TY_BALL_SCALE = 0.42;
export const TY_MIN_RADIUS = 0.2;
export const TY_MAX_RADIUS = 0.9;
/** Largest random turn (radians) added to a bounce off the frame. */
export const TY_SCATTER = 0.14;
/** A heading is kept at least this far (radians) from both axes, so no ball runs a straight line forever. */
export const TY_MIN_AXIS = 0.35;
/** The pegs: a dot every TY_PEG_STEP tiles (the frame lines excluded), TY_PEG_RADIUS tiles in radius. */
export const TY_PEG_STEP = 3;
export const TY_PEG_RADIUS = 0.1;
/** Vortex: its path curves at this rate (rad/s), and a whirl sweeps its two arms out over TY_WHIRL_MS, TY_WHIRL_TURNS turns each. */
export const TY_VORTEX_CURVE = 0.9;
export const TY_WHIRL_MS = 900;
export const TY_WHIRL_TURNS = 1.25;
export const TY_WHIRL_ARMS = 2;
/** Samples per whirl arm and tile of radius (every tile the arm crosses is hit). */
export const TY_WHIRL_SAMPLES_PER_TILE = 16;
/** Painter: a dash runs this many tiles (the same trail on any board), this much faster. */
export const TY_DASH_TILES = 5.5;
export const TY_DASH_SPEED = 1.1;
/** Ghost: weightless, it drifts this much faster than the other balls. */
export const TY_GHOST_SPEED = 1.5;
/** Bomber: balls within this many blast radii are blown away. */
export const TY_BLAST_PUSH = 1.5;
/** Bomber: an armed ball that has not bounced off an enemy tile this long (simulation ms) after arming explodes where it is. */
export const TY_ARM_MAX_MS = 150;
/** A timed power first fires between this fraction of its interval and the whole interval (seeded per ball). */
export const TY_POWER_PHASE_MIN = 0.35;
/** The last TY_FINALE_MS of the countdown: the balls speed up to TY_FINALE_SPEED× ("the end gets intense"). */
export const TY_FINALE_MS = 5000;
export const TY_FINALE_SPEED = 1.3;
/** Tile-flip notes: at most one per 60 Hz step and one per TY_NOTE_GAP_MS of simulation time; blasts sound at most every TY_BOOM_GAP_MS. */
export const TY_NOTE_GAP_MS = 70;
export const TY_BOOM_GAP_MS = 180;
/** Recent flips kept for the canvas' pop animation, and how long a pop lasts (simulation ms). */
export const TY_FLIP_LOG = 512;
export const TY_POP_MS = 480;
/** Blast shock rings kept, and how long one lasts (simulation ms). */
export const TY_MAX_SHOCKS = 16;
export const TY_SHOCK_MS = 700;
/** Flip notes: C-major pentatonic from C4, the row picks the degree (the top rows high) and every team starts a degree apart. */
export const TY_LADDER: readonly number[] = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86];
export const TY_TEAM_DEGREE: readonly number[] = [0, 2, 1, 3];

/** The eight rim probes of the tile test: the axes and the diagonals (unit vectors). */
const PROBE_X = new Float64Array(8);
const PROBE_Y = new Float64Array(8);
for (let k = 0; k < 8; k++) {
  PROBE_X[k] = k % 4 === 2 ? 0 : Math.round(Math.cos((k * Math.PI) / 4) * 1e12) / 1e12;
  PROBE_Y[k] = k % 4 === 0 ? 0 : Math.round(Math.sin((k * Math.PI) / 4) * 1e12) / 1e12;
}

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

/** Tile rows for `cols` columns: the field's aspect (the square under the HUD band), rounded down to an even count (fair halves). */
export function territoryRows(cols: number): number {
  const c = Math.max(1, Math.round(cols));
  const r = Math.floor((c * (1 - TY_HUD_BAND - TY_MARGIN)) / (1 - 2 * TY_MARGIN) + 1e-9);
  return Math.max(4, r - (r % 2));
}

/** Where the tile map sits on a canvas of `width` × `height` (CSS px): inside the centred square the recorder crops to, under the HUD band. */
export interface TerritoryField {
  width: number;
  height: number;
  /** The centred square: its side and top-left corner. */
  side: number;
  sqLeft: number;
  sqTop: number;
  /** The HUD band at the top of the square. */
  hudTop: number;
  hudHeight: number;
  /** The grid's top-left corner, the tile size and the grid's size (px). */
  gx: number;
  gy: number;
  tile: number;
  cols: number;
  rows: number;
  gridW: number;
  gridH: number;
}

export function territoryField(width: number, height: number, cols: number): TerritoryField {
  const side = Math.max(40, Math.min(width, height));
  const sqLeft = width / 2 - side / 2;
  const sqTop = height / 2 - side / 2;
  const margin = TY_MARGIN * side;
  const hud = TY_HUD_BAND * side;
  const c = Math.max(1, Math.round(cols));
  const rows = territoryRows(c);
  const tile = (side - 2 * margin) / c;
  const gridW = c * tile;
  const gridH = rows * tile;
  const availH = side - hud - margin;
  return { width, height, side, sqLeft, sqTop, hudTop: sqTop, hudHeight: hud, gx: sqLeft + margin, gy: sqTop + hud + (availH - gridH) / 2, tile, cols: c, rows, gridW, gridH };
}

/**
 * The team whose region tile (col, row) starts in: 2 teams – the top half (0) and the bottom half (1); 4 teams – the
 * quadrants top-left (0), top-right (1), bottom-left (2), bottom-right (3), an odd middle column shared row by row.
 */
export function regionOwner(col: number, row: number, cols: number, rows: number, teams: number): number {
  const top = row < rows / 2;
  if (teams < 4) return top ? 0 : 1;
  let left: boolean;
  if (cols % 2 === 0) left = col < cols / 2;
  else {
    const mid = (cols - 1) / 2;
    left = col < mid || (col === mid && row % 2 === 0);
  }
  return (top ? 0 : 2) + (left ? 0 : 1);
}

/** Fills `tiles` (cols × rows, row-major) with the start regions and writes the tile counts per team into `counts`. */
export function fillRegions(tiles: Uint8Array, cols: number, rows: number, teams: number, counts: Int32Array) {
  counts.fill(0);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = regionOwner(col, row, cols, rows, teams);
      tiles[row * cols + col] = t;
      counts[t]++;
    }
  }
}

/** Whole percentages of the tiles per team that add up to exactly 100 (largest remainder); all 0 without tiles. Writes into `out`. */
const pctRemainders = new Float64Array(TY_MAX_TEAMS);
export function tilePercentages(counts: ArrayLike<number>, teams: number, out: number[] = []): number[] {
  const n = Math.max(0, Math.min(TY_MAX_TEAMS, teams));
  out.length = n;
  let total = 0;
  for (let t = 0; t < n; t++) total += Math.max(0, counts[t]);
  if (total <= 0) {
    for (let t = 0; t < n; t++) out[t] = 0;
    return out;
  }
  let sum = 0;
  for (let t = 0; t < n; t++) {
    const exact = (100 * Math.max(0, counts[t])) / total;
    out[t] = Math.floor(exact);
    pctRemainders[t] = exact - out[t];
    sum += out[t];
  }
  for (let left = 100 - sum; left > 0; left--) {
    let best = -1;
    for (let t = 0; t < n; t++) if (pctRemainders[t] >= 0 && (best < 0 || pctRemainders[t] > pctRemainders[best])) best = t;
    if (best < 0) break;
    out[best]++;
    pctRemainders[best] = -1;
  }
  return out;
}

/** The team with the most tiles, or −1 while two or more share the top. */
export function tileLeader(counts: ArrayLike<number>, teams: number): number {
  let best = -1;
  let bestCount = -1;
  let level = false;
  for (let t = 0; t < teams; t++) {
    if (counts[t] > bestCount) {
      bestCount = counts[t];
      best = t;
      level = false;
    } else if (counts[t] === bestCount) level = true;
  }
  return level ? -1 : best;
}

/** The effective forced winner of a battle of `teams` teams: the rigged slot when it plays, else −1. */
export function territoryForcedWinner(forcedWinner: number | undefined, teams: number): number {
  const w = forcedWinner ?? -1;
  return Number.isInteger(w) && w >= 0 && w < teams ? w : -1;
}

/**
 * The rig's hard constraint: whether converting a tile of team `from` to team `to` is absorbed – it would put a rival
 * of the chosen team (`forced`) ahead of it (ties allowed): the converting team, or – when the tile is the chosen
 * team's – any other of the `teams` teams. So the chosen team never falls behind.
 */
export function rigBlocksConversion(counts: ArrayLike<number>, from: number, to: number, forced: number, teams = counts.length): boolean {
  if (forced < 0 || to === forced || from === to) return false;
  const chosen = counts[forced] - (from === forced ? 1 : 0);
  if (counts[to] + 1 > chosen) return true;
  if (from !== forced) return false;
  for (let t = 0; t < teams; t++) if (t !== forced && t !== to && counts[t] > chosen) return true;
  return false;
}

/** The teams that take the verdict: the most tiles – just the rig's chosen team when it is one of them. Writes into `out`. */
export function territoryLeaders(counts: ArrayLike<number>, teams: number, forced: number, out: number[] = []): number[] {
  out.length = 0;
  let best = -1;
  for (let t = 0; t < teams; t++) if (counts[t] > best) best = counts[t];
  for (let t = 0; t < teams; t++) if (counts[t] === best) out.push(t);
  if (forced >= 0 && out.includes(forced)) {
    out.length = 0;
    out.push(forced);
  }
  return out;
}

/** The pitch (Hz) of a tile flipping to `team` in row `row` of `rows`: a pentatonic degree by row (top rows high), each team a degree apart. */
export function flipFrequency(team: number, row: number, rows: number): number {
  const y = rows > 1 ? Math.max(0, Math.min(1, row / (rows - 1))) : 0.5;
  const degree = Math.round((1 - y) * 8) + TY_TEAM_DEGREE[((Math.round(team) % 4) + 4) % 4];
  return midiToFrequency(TY_LADDER[Math.max(0, Math.min(TY_LADDER.length - 1, degree))]);
}

/** The finale's speed factor `sinceMs` into it: a smooth ramp from 1 to TY_FINALE_SPEED over the finale. */
export function territoryFinaleFactor(sinceMs: number): number {
  if (!(sinceMs > 0)) return 1;
  const x = Math.min(1, sinceMs / TY_FINALE_MS);
  return 1 + (TY_FINALE_SPEED - 1) * x * x * (3 - 2 * x);
}

/** Turns a heading (radians) at least `TY_MIN_AXIS` away from both axes, keeping its quadrant. */
export function awayFromAxes(angle: number): number {
  let a = angle % TWO_PI;
  if (a < 0) a += TWO_PI;
  const quarter = Math.PI / 2;
  const q = Math.floor(a / quarter);
  const inQ = a - q * quarter;
  const clamped = Math.max(TY_MIN_AXIS, Math.min(quarter - TY_MIN_AXIS, inQ));
  return q * quarter + clamped;
}

/**
 * Point `k` of `samples` along arm `arm` of a whirl (`TY_WHIRL_ARMS` arms from `angle0`, turning in direction `dir`,
 * out to `radiusPx`), relative to the whirl's centre. Written into `out`.
 */
export function whirlPoint(k: number, samples: number, arm: number, angle0: number, dir: number, radiusPx: number, out: { x: number; y: number }) {
  const p = samples > 0 ? Math.max(0, Math.min(1, k / samples)) : 1;
  const theta = angle0 + (TWO_PI * arm) / TY_WHIRL_ARMS + dir * p * TY_WHIRL_TURNS * TWO_PI;
  out.x = Math.cos(theta) * p * radiusPx;
  out.y = Math.sin(theta) * p * radiusPx;
  return out;
}

/** The last peg column / row index (pegs sit at multiples of `TY_PEG_STEP`, 1 … last; the frame lines carry none). */
export function pegLast(tiles: number): number {
  return Math.floor((tiles - 1) / TY_PEG_STEP);
}

/* ------------------------------------------------------------------ state and view */

/** A team ball: its engine id, team and power, and the power's state. */
export interface TyBall {
  id: number;
  team: number;
  power: TyPower;
  /** Simulation time (ms) of its next power trigger (Infinity: no timed power, an armed bomber, or the battle is over). */
  nextPowerMs: number;
  /** Bomber: when it armed (simulation ms; −Infinity while it is not armed) – it explodes on its next bounce off an enemy tile. */
  armedMs: number;
  /** Simulation time (ms) of its last trigger (−Infinity before the first): the canvas' charge ring. */
  lastPowerMs: number;
  /** Power triggers so far. */
  triggers: number;
  /** Vortex: ±1, the way its path curves (it turns the other way after every whirl). */
  curve: number;
  /** Vortex: the running whirl – its start (ms; −Infinity when none runs), the heading it started at, the samples done. */
  whirlMs: number;
  whirlAngle: number;
  whirlDone: number;
  /** Painter: the dash runs until this simulation time (ms). */
  dashUntilMs: number;
  /** Where it is (tile units from the grid's corner), for the canvas' effects. */
  u: number;
  v: number;
}

/** A bomber's blast: where (tile units), how far (tiles), whose, when (ms) and the seed its debris flies from. */
export interface TyShock {
  u: number;
  v: number;
  radius: number;
  team: number;
  t0: number;
  seed: number;
}

export interface TerritoryView {
  /** The settings of the last init, with the display fields (badge, HUD) applied at once. */
  settings: TerritorySettings;
  /** Incremented by every init. */
  generation: number;
  field: TerritoryField;
  cols: number;
  rows: number;
  teams: number;
  /** Tiles on the board (cols × rows). */
  total: number;
  /** The owner of every tile, row-major (only the first `total` entries are the board). */
  tiles: Uint8Array;
  /** Tiles per team (TY_MAX_TEAMS entries; the ones beyond `teams` stay 0). */
  counts: Int32Array;
  balls: TyBall[];
  /** Recent flips (a ring of TY_FLIP_LOG): tile, new owner and simulation time; `flipHead` is the next slot, `flipCount` the filled ones. */
  flipTile: Int32Array;
  flipTeam: Uint8Array;
  flipMs: Float64Array;
  flipHead: number;
  flipCount: number;
  /** Bomber blasts still ringing, oldest first. */
  shocks: TyShock[];
  /** Tiles converted, bounces off tiles / the frame / the pegs, power triggers of each kind, notes played. */
  conversions: number;
  tileBounces: number;
  wallBounces: number;
  pegHits: number;
  whirls: number;
  blasts: number;
  dashes: number;
  ghostBlocks: number;
  notes: number;
  /** The rig's chosen team (−1 off) and the conversions it absorbed. */
  forcedWinner: number;
  shields: number;
  /** The team leading right now (−1: a level top), the lead changes so far and the slow-motion requests made in the finale. */
  leader: number;
  leadChanges: number;
  slowMos: number;
  /** The last TY_FINALE_MS of the countdown, and the speed factor it has reached. */
  finale: boolean;
  speedFactor: number;
  /** The countdown of this run (ms). */
  durationMs: number;
  finished: boolean;
  finishedMs: number;
  /** The winning team (−1 while the battle goes on, or for a DRAW), and the teams that share the top. */
  winner: number;
  tie: boolean;
  leaders: number[];
}

function createView(): TerritoryView {
  const field = territoryField(800, 600, DEFAULT_TERRITORY_SETTINGS.cols);
  return {
    settings: { ...DEFAULT_TERRITORY_SETTINGS, powers: [...DEFAULT_TY_POWERS] },
    generation: 0,
    field,
    cols: field.cols,
    rows: field.rows,
    teams: 2,
    total: 0,
    tiles: new Uint8Array(0),
    counts: new Int32Array(TY_MAX_TEAMS),
    balls: [],
    flipTile: new Int32Array(TY_FLIP_LOG),
    flipTeam: new Uint8Array(TY_FLIP_LOG),
    flipMs: new Float64Array(TY_FLIP_LOG),
    flipHead: 0,
    flipCount: 0,
    shocks: [],
    conversions: 0,
    tileBounces: 0,
    wallBounces: 0,
    pegHits: 0,
    whirls: 0,
    blasts: 0,
    dashes: 0,
    ghostBlocks: 0,
    notes: 0,
    forcedWinner: -1,
    shields: 0,
    leader: -1,
    leadChanges: 0,
    slowMos: 0,
    finale: false,
    speedFactor: 1,
    durationMs: 1000 * DEFAULT_TERRITORY_SETTINGS.duration,
    finished: false,
    finishedMs: -1,
    winner: -1,
    tie: false,
    leaders: [],
  };
}

/* ------------------------------------------------------------------ the mode */

export class TerritoryMode implements GameMode {
  readonly name = "territory" as const;
  /** The mode keeps every ball at its cruising speed itself: no engine slow-ball boost. */
  readonly ballsMayRest = true;
  private settings: TerritorySettings = { ...DEFAULT_TERRITORY_SETTINGS, powers: [...DEFAULT_TY_POWERS] };
  private readonly view: TerritoryView = createView();
  /** The engine id of the first team ball (the team balls are consecutive from it). */
  private firstId = 0;
  /** The engine ball of every team ball this step (null once it is gone). */
  private engineBalls: (Ball | null)[] = [];
  private notesThisStep = 0;
  private lastNoteMs = -Infinity;
  private lastBoomMs = -Infinity;
  private lastLeader = -1;
  private readonly peg = circleObstacle(0, 0, 1, { restitution: 1, friction: 0 });
  private readonly scratch = { x: 0, y: 0 };
  /**
   * The conversions of the balls' moves wait for the end of the sub-step (`flush()`): every ball of a sub-step judges the
   * board as it stood when the sub-step began, so the order the engine moves the balls in favours no team.
   */
  private deferring = false;
  private qIdx = new Int32Array(256);
  private qTeam = new Uint8Array(256);
  private qRow = new Int32Array(256);
  private qSound = new Uint8Array(256);
  private qLen = 0;

  getSettings(): TerritorySettings {
    return { ...this.settings, powers: [...this.settings.powers] };
  }

  /**
   * The board, the teams, the balls, the powers, the interval, the reach, the countdown and the pegs apply on the next init;
   * the badge and the HUD at once. With `unlimited` (No limits on) the numbers run past their sliders, up to their soft ceilings.
   */
  setSettings(patch: Partial<TerritorySettings>, unlimited = false) {
    this.settings = resolveTerritorySettings({ ...this.settings, ...patch }, unlimited);
    this.view.settings.badge = this.settings.badge;
    this.view.settings.hud = this.settings.hud;
  }

  /** Live battle state for the canvas and the HUD; the same object every call. */
  getView(): TerritoryView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return { teams: v.teams, total: v.total, counts: Array.from(v.counts.subarray(0, v.teams)), conversions: v.conversions, finished: v.finished, winner: v.winner, tie: v.tie, leader: v.leader, shields: v.shields };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    const cfg = ctx.config;
    v.settings = { ...s, powers: [...s.powers] };
    v.generation++;
    v.field = territoryField(cfg.width, cfg.height, s.cols);
    v.cols = v.field.cols;
    v.rows = v.field.rows;
    v.teams = s.teams;
    v.total = v.cols * v.rows;
    if (v.tiles.length < v.total) v.tiles = new Uint8Array(v.total);
    fillRegions(v.tiles, v.cols, v.rows, v.teams, v.counts);
    v.flipHead = 0;
    v.flipCount = 0;
    v.shocks.length = 0;
    v.conversions = 0;
    v.tileBounces = 0;
    v.wallBounces = 0;
    v.pegHits = 0;
    v.whirls = 0;
    v.blasts = 0;
    v.dashes = 0;
    v.ghostBlocks = 0;
    v.notes = 0;
    v.forcedWinner = territoryForcedWinner(cfg.forcedWinner, v.teams);
    v.shields = 0;
    v.leader = -1;
    v.leadChanges = 0;
    v.slowMos = 0;
    v.finale = false;
    v.speedFactor = 1;
    v.durationMs = 1000 * s.duration;
    v.finished = false;
    v.finishedMs = -1;
    v.winner = -1;
    v.tie = false;
    v.leaders.length = 0;
    v.balls.length = 0;
    this.notesThisStep = 0;
    this.lastNoteMs = -Infinity;
    this.lastBoomMs = -Infinity;
    this.lastLeader = -1;
    this.deferring = false;
    this.qLen = 0;
    this.firstId = ctx.getNextId();
    const f = v.field;
    const radius = f.tile * Math.max(TY_MIN_RADIUS, Math.min(TY_MAX_RADIUS, TY_BALL_SCALE * ((cfg.ballRadius || 8) / 8)));
    const radiusScale = radius / (cfg.ballRadius || 8);
    const speed = this.cruise(cfg.ballSpeed);
    // The balls join in rounds – one ball of every team a round, the first team of a round turning (from a seeded start) –
    // so no team's balls always move first in the engine's ball loop (a tile two teams reach in the same sub-step goes to
    // the ball that moves first).
    const first = Math.floor(ctx.random() * v.teams);
    for (let k = 0; k < s.ballsPerTeam; k++) {
      for (let j = 0; j < v.teams; j++) {
        const team = (first + k + j) % v.teams;
        // The team's region, in tiles: its rows and columns (the balls start a tile clear of its edges).
        const rowSplit = v.rows / 2;
        const topHalf = v.teams < 4 ? team === 0 : team < 2;
        const r0 = topHalf ? 0 : rowSplit;
        const r1 = topHalf ? rowSplit : v.rows;
        let c0 = 0;
        let c1 = v.cols;
        if (v.teams === 4) {
          const leftHalf = team % 2 === 0;
          c0 = leftHalf ? 0 : Math.ceil(v.cols / 2);
          c1 = leftHalf ? Math.floor(v.cols / 2) : v.cols;
        }
        const power = s.powers[team] ?? "none";
        // A few seeded tries for a spot clear of the team's other balls (the last try is taken anyway).
        let x = 0;
        let y = 0;
        for (let attempt = 0; attempt < 8; attempt++) {
          const cu = c0 + 1 + ctx.random() * Math.max(0, c1 - c0 - 2);
          const cv = r0 + 1 + ctx.random() * Math.max(0, r1 - r0 - 2);
          x = f.gx + cu * f.tile;
          y = f.gy + cv * f.tile;
          let clear = true;
          for (const other of v.balls) {
            const dx = f.gx + other.u * f.tile - x;
            const dy = f.gy + other.v * f.tile - y;
            if (dx * dx + dy * dy < 4.4 * radius * radius) clear = false;
          }
          if (clear) break;
        }
        const heading = awayFromAxes(ctx.random() * TWO_PI);
        const curve = ctx.random() < 0.5 ? -1 : 1;
        const phase = TY_POWER_PHASE_MIN + (1 - TY_POWER_PHASE_MIN) * ctx.random();
        const timed = power === "vortex" || power === "bomber" || power === "painter";
        const id = ctx.getNextId();
        ctx.addBall({ x, y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, radius, radiusScale, gravityScale: 0, color: TY_PALETTE[team].color, team });
        v.balls.push({
          id,
          team,
          power,
          nextPowerMs: timed ? phase * 1000 * s.powerEvery : Infinity,
          armedMs: -Infinity,
          lastPowerMs: -Infinity,
          triggers: 0,
          curve,
          whirlMs: -Infinity,
          whirlAngle: 0,
          whirlDone: 0,
          dashUntilMs: -Infinity,
          u: (x - f.gx) / f.tile,
          v: (y - f.gy) / f.tile,
        });
      }
    }
    this.engineBalls = new Array<Ball | null>(v.balls.length).fill(null);
  }

  /** The cruising speed (px/s) at Ball Speed `ballSpeed`, before the finale and a ball's own factors. */
  private cruise(ballSpeed: number) {
    return ((ballSpeed || 400) / 400) * TY_SPEED * this.view.field.side;
  }

  private ballOf(ball: Ball): TyBall | null {
    const k = ball.id - this.firstId;
    const balls = this.view.balls;
    if (k < 0 || k >= balls.length) return null;
    const tb = balls[k];
    return tb.id === ball.id ? tb : null;
  }

  onPreUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    this.flush(ctx, now);
    // The rig follows the config (the page may pick a forced winner mid-battle); the seed finder's engines carry it from the start.
    v.forcedWinner = territoryForcedWinner(ctx.config.forcedWinner, v.teams);
    this.notesThisStep = 0;
    const left = v.durationMs - now;
    v.finale = !v.finished && left <= TY_FINALE_MS;
    v.speedFactor = v.finale ? territoryFinaleFactor(TY_FINALE_MS - left) : 1;
    // The engine ball of every team ball this step (a ball fused away by the "merge" interaction is gone).
    const balls = ctx.getBalls();
    const eb = this.engineBalls;
    eb.fill(null);
    for (let i = 0; i < balls.length; i++) {
      const k = balls[i].id - this.firstId;
      if (k >= 0 && k < eb.length && v.balls[k].id === balls[i].id) eb[k] = balls[i];
    }
    if (v.finished) return;
    const every = 1000 * v.settings.powerEvery;
    for (let k = 0; k < v.balls.length; k++) {
      const tb = v.balls[k];
      const B = eb[k];
      if (!B) continue;
      // An armed bomber that found no enemy tile to bounce off in time explodes where it is.
      if (tb.armedMs > -Infinity && now - tb.armedMs >= TY_ARM_MAX_MS) this.blast(ctx, B, tb, now);
      if (tb.nextPowerMs > now) continue;
      this.trigger(ctx, B, tb, now);
      while (tb.nextPowerMs <= now) tb.nextPowerMs += every;
    }
  }

  /** A timed power fires: the vortex's whirl, the painter's dash – the bomber arms (its blast waits for its next bounce off an enemy tile). */
  private trigger(ctx: ModeContext, ball: Ball, tb: TyBall, now: number) {
    const v = this.view;
    if (tb.power === "bomber") {
      tb.armedMs = now;
      tb.nextPowerMs = Infinity; // the next charge starts at the blast
      return;
    }
    tb.triggers++;
    tb.lastPowerMs = now;
    if (tb.power === "vortex") {
      tb.whirlMs = now;
      tb.whirlAngle = Math.atan2(ball.vy, ball.vx);
      tb.whirlDone = 0;
      tb.curve = -tb.curve;
      v.whirls++;
      ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: 3 });
    } else if (tb.power === "painter") {
      tb.dashUntilMs = now + (1000 * TY_DASH_TILES * v.field.tile) / (this.cruise(ctx.config.ballSpeed) * v.speedFactor * TY_DASH_SPEED);
      v.dashes++;
      const row = Math.floor((ball.y - v.field.gy) / v.field.tile);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: flipFrequency(tb.team, row, v.rows), accent: true });
    }
  }

  /** The bomber's blast: every tile within the reach turns its team's, nearby balls are blown away, a shock ring, the wall-break sound and a shake; the next charge starts. */
  private blast(ctx: ModeContext, ball: Ball, tb: TyBall, now: number) {
    const v = this.view;
    const f = v.field;
    tb.triggers++;
    tb.lastPowerMs = now;
    tb.armedMs = -Infinity;
    tb.nextPowerMs = now + 1000 * v.settings.powerEvery;
    const R = v.settings.radius;
    const cu = (ball.x - f.gx) / f.tile;
    const cv = (ball.y - f.gy) / f.tile;
    const c0 = Math.max(0, Math.floor(cu - R));
    const c1 = Math.min(v.cols - 1, Math.floor(cu + R));
    const r0 = Math.max(0, Math.floor(cv - R));
    const r1 = Math.min(v.rows - 1, Math.floor(cv + R));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const du = col + 0.5 - cu;
        const dv = row + 0.5 - cv;
        if (du * du + dv * dv <= R * R) this.convert(ctx, row * v.cols + col, tb.team, now, row, false);
      }
    }
    // The shock blows the other balls away from the blast (a turn of their heading; their speed stays the cruise).
    const reach = TY_BLAST_PUSH * R * f.tile;
    for (const other of ctx.getBalls()) {
      if (other === ball) continue;
      const dx = other.x - ball.x;
      const dy = other.y - ball.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const sp = Math.hypot(other.vx, other.vy);
      const push = 1.5 * sp * (1 - d / reach);
      other.vx += (dx / d) * push;
      other.vy += (dy / d) * push;
    }
    if (v.shocks.length >= TY_MAX_SHOCKS) v.shocks.shift();
    v.shocks.push({ u: cu, v: cv, radius: R, team: tb.team, t0: now, seed: (v.generation * 7919 + tb.id * 104729 + Math.round(now)) | 0 });
    v.blasts++;
    if (now - this.lastBoomMs >= TY_BOOM_GAP_MS) {
      this.lastBoomMs = now;
      // A "gap" plays the wall-break sound (or the uploaded clip) and counts as a wall break for the camera's screen shake.
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    } else ctx.noteImpact?.();
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const v = this.view;
    this.deferring = true;
    const tb = this.ballOf(ball);
    const team = tb ? tb.team : Math.max(0, Math.min(v.teams - 1, ball.team ?? 0));
    const now = ctx.getElapsedMs();
    const f = v.field;
    const dashing = !!tb && tb.power === "painter" && now < tb.dashUntilMs && !v.finished;
    // The cruising speed: the finale's ramp, a dash, a speed multiplier.
    const cruise = this.cruise(ctx.config.ballSpeed) * v.speedFactor * (dashing ? TY_DASH_SPEED : tb && tb.power === "ghost" ? TY_GHOST_SPEED : 1) * (ball.mult ? ball.mult.speed : 1);
    if (tb && tb.power === "vortex" && !v.finished) {
      // The vortex curves its own path.
      const a = tb.curve * TY_VORTEX_CURVE * dtSec;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const vx = ball.vx * c - ball.vy * s;
      ball.vy = ball.vx * s + ball.vy * c;
      ball.vx = vx;
    }
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 1e-9) {
      ball.vx *= cruise / sp;
      ball.vy *= cruise / sp;
    } else {
      ball.vx = cruise * Math.cos(TY_MIN_AXIS);
      ball.vy = cruise * Math.sin(TY_MIN_AXIS);
    }
    // The frame: a mirror bounce with a seeded scatter, never too close to an axis.
    const r = ball.radius;
    const left = f.gx + r;
    const right = f.gx + f.gridW - r;
    const top = f.gy + r;
    const bottom = f.gy + f.gridH - r;
    let hitX = false;
    let hitY = false;
    if (ball.x < left) {
      ball.x = left;
      if (ball.vx < 0) hitX = true;
    } else if (ball.x > right) {
      ball.x = right;
      if (ball.vx > 0) hitX = true;
    }
    if (ball.y < top) {
      ball.y = top;
      if (ball.vy < 0) hitY = true;
    } else if (ball.y > bottom) {
      ball.y = bottom;
      if (ball.vy > 0) hitY = true;
    }
    if (hitX || hitY) {
      if (hitX) ball.vx = -ball.vx;
      if (hitY) ball.vy = -ball.vy;
      const sx = ball.vx < 0 ? -1 : 1;
      const sy = ball.vy < 0 ? -1 : 1;
      const heading = awayFromAxes(Math.atan2(ball.vy, ball.vx) + (2 * ctx.random() - 1) * TY_SCATTER);
      const out = cruise * ctx.getPhysicsExtras().wallBounciness;
      // The scatter never turns the ball back into the frame it just left (a heading that grazed an axis may cross it).
      ball.vx = Math.cos(heading) * out;
      ball.vy = Math.sin(heading) * out;
      if (hitX && (ball.vx < 0 ? -1 : 1) !== sx) ball.vx = -ball.vx;
      if (hitY && (ball.vy < 0 ? -1 : 1) !== sy) ball.vy = -ball.vy;
      v.wallBounces++;
      ctx.noteBounce?.(ball); // a bounce-math trigger (the frame is the mode's own wall)
      if (tb && tb.power === "ghost" && !v.finished) this.ghostBlock(ctx, ball, team, now);
    }
    if (v.settings.pegs) this.pegs(ctx, ball, dtSec);
    if (dashing) this.paintTrail(ctx, ball, team, now);
    else if (!(tb && tb.power === "ghost")) this.probeTiles(ctx, ball, tb, team, now);
    if (tb) {
      if (tb.whirlMs > -Infinity) this.stepWhirl(ctx, ball, tb, now);
      tb.u = (ball.x - f.gx) / f.tile;
      tb.v = (ball.y - f.gy) / f.tile;
    }
  }

  /**
   * The pong-wars tile test: eight probes on the rim. Every probe moving into a tile of another team converts it (unless
   * the battle is over or the rig absorbs it), and the ball reflects once about the sum of those probes' directions – a
   * flat border sends it straight back, a corner back the way it came – the same whichever way the ball moves, so no side
   * of the board is favoured. A ball whose centre sits on an enemy tile (a blast engulfed it) converts that tile too, so it
   * eats its way out. An armed bomber explodes on the bounce.
   */
  private probeTiles(ctx: ModeContext, ball: Ball, tb: TyBall | null, team: number, now: number) {
    const v = this.view;
    const f = v.field;
    const tiles = v.tiles;
    const inv = 1 / f.tile;
    const cols = v.cols;
    const rows = v.rows;
    const live = !v.finished;
    if (live) {
      const col = Math.floor((ball.x - f.gx) * inv);
      const row = Math.floor((ball.y - f.gy) * inv);
      if (col >= 0 && row >= 0 && col < cols && row < rows && tiles[row * cols + col] !== team) this.convert(ctx, row * cols + col, team, now, row, true);
    }
    const r = ball.radius;
    const vx = ball.vx;
    const vy = ball.vy;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 8; k++) {
      const nx = PROBE_X[k];
      const ny = PROBE_Y[k];
      if (vx * nx + vy * ny <= 0) continue;
      const col = Math.floor((ball.x + nx * r - f.gx) * inv);
      const row = Math.floor((ball.y + ny * r - f.gy) * inv);
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      const idx = row * cols + col;
      if (tiles[idx] === team) continue;
      if (live) this.convert(ctx, idx, team, now, row, true);
      sx += nx;
      sy += ny;
    }
    // Every probe that hit moves into its tile (v · n > 0), so the sum does too: one reflection about its direction.
    const len = Math.hypot(sx, sy);
    if (len <= 1e-9) return;
    const nx = sx / len;
    const ny = sy / len;
    const vn = vx * nx + vy * ny;
    ball.vx = vx - 2 * vn * nx;
    ball.vy = vy - 2 * vn * ny;
    v.tileBounces++;
    ctx.noteBounce?.(ball); // a bounce-math trigger
    if (live && tb && tb.armedMs > -Infinity) this.blast(ctx, ball, tb, now); // one bounce can flip the board
  }

  /** The painter's dash: no bounces off enemy tiles, the tile under the ball turns its team's – a one-tile trail. */
  private paintTrail(ctx: ModeContext, ball: Ball, team: number, now: number) {
    const v = this.view;
    const f = v.field;
    const col = Math.floor((ball.x - f.gx) / f.tile);
    const row = Math.floor((ball.y - f.gy) / f.tile);
    if (col < 0 || row < 0 || col >= v.cols || row >= v.rows) return;
    const idx = row * v.cols + col;
    if (v.tiles[idx] !== team) this.convert(ctx, idx, team, now, row, true);
  }

  /** The ghost's frame bounce: the 3×3 block around the tile it is in – moved inside the board, so it is a whole block at the frame – turns its team's. */
  private ghostBlock(ctx: ModeContext, ball: Ball, team: number, now: number) {
    const v = this.view;
    const f = v.field;
    const col = Math.max(1, Math.min(v.cols - 2, Math.floor((ball.x - f.gx) / f.tile)));
    const row = Math.max(1, Math.min(v.rows - 2, Math.floor((ball.y - f.gy) / f.tile)));
    let converted = 0;
    for (let rr = Math.max(0, row - 1); rr <= Math.min(v.rows - 1, row + 1); rr++) {
      for (let cc = Math.max(0, col - 1); cc <= Math.min(v.cols - 1, col + 1); cc++) if (this.convert(ctx, rr * v.cols + cc, team, now, rr, false)) converted++;
    }
    if (converted > 0) {
      v.ghostBlocks++;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: flipFrequency(team, row, v.rows), accent: true });
    }
  }

  /** The vortex's whirl: the samples of both arms up to where the sweep has got, each converting the enemy tile it lands on. */
  private stepWhirl(ctx: ModeContext, ball: Ball, tb: TyBall, now: number) {
    const v = this.view;
    const f = v.field;
    const samples = Math.max(8, Math.round(TY_WHIRL_SAMPLES_PER_TILE * v.settings.radius));
    const p = Math.min(1, (now - tb.whirlMs) / TY_WHIRL_MS);
    const upTo = v.finished ? tb.whirlDone : Math.round(p * samples);
    const R = v.settings.radius * f.tile;
    const q = this.scratch;
    for (let k = tb.whirlDone + 1; k <= upTo; k++) {
      for (let arm = 0; arm < TY_WHIRL_ARMS; arm++) {
        whirlPoint(k, samples, arm, tb.whirlAngle, tb.curve, R, q);
        const col = Math.floor((ball.x + q.x - f.gx) / f.tile);
        const row = Math.floor((ball.y + q.y - f.gy) / f.tile);
        if (col < 0 || row < 0 || col >= v.cols || row >= v.rows) continue;
        const idx = row * v.cols + col;
        if (v.tiles[idx] !== tb.team) this.convert(ctx, idx, tb.team, now, row, true);
      }
    }
    tb.whirlDone = upTo;
    if (p >= 1 || v.finished) tb.whirlMs = -Infinity;
  }

  /** The pegs of the dotted grid next to the ball (the four corners of its lattice cell), through the obstacle layer's peg resolver. */
  private pegs(ctx: ModeContext, ball: Ball, dtSec: number) {
    const v = this.view;
    const f = v.field;
    const L = TY_PEG_STEP * f.tile;
    const i0 = Math.floor((ball.x - f.gx) / L);
    const j0 = Math.floor((ball.y - f.gy) / L);
    const iMax = pegLast(v.cols);
    const jMax = pegLast(v.rows);
    const peg = this.peg;
    peg.radius = TY_PEG_RADIUS * f.tile;
    for (let dj = 0; dj <= 1; dj++) {
      const j = j0 + dj;
      if (j < 1 || j > jMax) continue;
      for (let di = 0; di <= 1; di++) {
        const i = i0 + di;
        if (i < 1 || i > iMax) continue;
        peg.x = f.gx + i * L;
        peg.y = f.gy + j * L;
        if (resolveBallCircle(ball, peg, dtSec, 1) > 0) {
          v.pegHits++;
          ctx.noteBounce?.(ball);
        }
      }
    }
  }

  /**
   * Tile `idx` (in row `row`) turns `team`'s – at once, or (during the balls' moves) at the end of the sub-step. False when
   * it already is `team`'s, or the battle is over.
   */
  private convert(ctx: ModeContext, idx: number, team: number, now: number, row: number, sound: boolean): boolean {
    const v = this.view;
    if (v.tiles[idx] === team || v.finished) return false;
    if (!this.deferring) return this.apply(ctx, idx, team, now, row, sound);
    if (this.qLen >= this.qIdx.length) this.growQueue();
    const n = this.qLen++;
    this.qIdx[n] = idx;
    this.qTeam[n] = team;
    this.qRow[n] = row;
    this.qSound[n] = sound ? 1 : 0;
    return true;
  }

  private growQueue() {
    const size = 2 * this.qIdx.length;
    const grow = <T extends Int32Array | Uint8Array>(a: T, b: T) => {
      b.set(a);
      return b;
    };
    this.qIdx = grow(this.qIdx, new Int32Array(size));
    this.qTeam = grow(this.qTeam, new Uint8Array(size));
    this.qRow = grow(this.qRow, new Int32Array(size));
    this.qSound = grow(this.qSound, new Uint8Array(size));
  }

  /** Applies the conversions the sub-step queued, in order (a tile two teams took in the same sub-step goes to the first). */
  private flush(ctx: ModeContext, now: number) {
    this.deferring = false;
    const n = this.qLen;
    this.qLen = 0;
    for (let k = 0; k < n; k++) this.apply(ctx, this.qIdx[k], this.qTeam[k], now, this.qRow[k], this.qSound[k] === 1);
  }

  /**
   * Tile `idx` (in row `row`) turns `team`'s: the counts, the flip log and – with `sound` – a flip note (at most one per
   * step and TY_NOTE_GAP_MS). False when it already was, the battle is over or the rig absorbed the conversion.
   */
  private apply(ctx: ModeContext, idx: number, team: number, now: number, row: number, sound: boolean): boolean {
    const v = this.view;
    const from = v.tiles[idx];
    if (from === team || v.finished) return false;
    if (rigBlocksConversion(v.counts, from, team, v.forcedWinner, v.teams)) {
      v.shields++;
      return false;
    }
    v.tiles[idx] = team;
    v.counts[from]--;
    v.counts[team]++;
    v.conversions++;
    const h = v.flipHead;
    v.flipTile[h] = idx;
    v.flipTeam[h] = team;
    v.flipMs[h] = now;
    v.flipHead = (h + 1) % TY_FLIP_LOG;
    if (v.flipCount < TY_FLIP_LOG) v.flipCount++;
    if (sound && this.notesThisStep === 0 && now - this.lastNoteMs >= TY_NOTE_GAP_MS) {
      this.notesThisStep++;
      this.lastNoteMs = now;
      v.notes++;
      const ev: SoundEvent = { type: "hit", wallIndex: 0, frequency: flipFrequency(team, row, v.rows) };
      ctx.addPendingSoundEvent(ev);
    }
    return true;
  }

  /**
   * After the engine's ball-to-ball pass: the sub-step's conversions apply, and a ball a collision pushed over the frame
   * goes back onto the board (the next sub-step's frame test turns it).
   */
  onPostSubStep(ctx: ModeContext) {
    this.flush(ctx, ctx.getElapsedMs());
    const f = this.view.field;
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const r = b.radius;
      if (b.x < f.gx + r) b.x = f.gx + r;
      else if (b.x > f.gx + f.gridW - r) b.x = f.gx + f.gridW - r;
      if (b.y < f.gy + r) b.y = f.gy + r;
      else if (b.y > f.gy + f.gridH - r) b.y = f.gy + f.gridH - r;
    }
  }

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    this.flush(ctx, now);
    if (!v.finished) {
      const leader = tileLeader(v.counts, v.teams);
      if (leader >= 0 && this.lastLeader >= 0 && leader !== this.lastLeader) {
        v.leadChanges++;
        // The lead flips in the finale: slow motion (the camera's near-miss hook).
        if (v.finale) {
          ctx.noteNearMiss?.();
          v.slowMos++;
        }
      }
      if (leader >= 0) this.lastLeader = leader;
      v.leader = leader;
      if (now >= v.durationMs - 1e-6) this.finish(ctx, now);
    }
    while (v.shocks.length > 0 && now - v.shocks[0].t0 >= TY_SHOCK_MS) v.shocks.shift();
  }

  /** The countdown ran out: the most tiles win (the rig's chosen team a level top), credited like the scoreboard ranks it. */
  private finish(ctx: ModeContext, now: number) {
    const v = this.view;
    territoryLeaders(v.counts, v.teams, v.forcedWinner, v.leaders);
    v.finished = true;
    v.finishedMs = now;
    v.finale = false;
    v.speedFactor = 1;
    v.tie = v.leaders.length > 1;
    v.winner = v.leaders.length === 1 ? v.leaders[0] : -1;
    for (const tb of v.balls) {
      tb.nextPowerMs = Infinity;
      tb.armedMs = -Infinity;
      tb.dashUntilMs = -Infinity;
    }
    // The team stats: the tiles as "walls" (the scoreboard ranks the rest by them), the leaders an "escape" (the win).
    const balls = ctx.getBalls();
    for (let team = 0; team < v.teams; team++) {
      let rep: Ball | null = null;
      for (let i = 0; i < balls.length && !rep; i++) if (balls[i].team === team) rep = balls[i];
      if (!rep) continue;
      for (let k = 0; k < v.counts[team]; k++) ctx.creditWallBreak?.(rep);
      if (v.leaders.includes(team)) ctx.creditEscape?.(rep);
    }
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: flipFrequency(Math.max(0, v.winner), 0, v.rows), accent: true });
  }

  onWallHit() {
    return undefined;
  }

  onGapPass() {
    return true;
  }

  /**
   * A resize: the board follows the centred square. The engine stretched the balls with the canvas (x and y apart), so
   * each ball is put back where it was on the old board and mapped onto the new one in tile units – with its speed and
   * size scaled like the tiles (its size stays relative to the Ball Size through `radiusScale`).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const v = this.view;
    const old = v.field;
    const next = territoryField(ctx.config.width, ctx.config.height, v.cols);
    const k = old.tile > 0 ? next.tile / old.tile : 1;
    const sx = next.width > 0 ? old.width / next.width : 1;
    const sy = next.height > 0 ? old.height / next.height : 1;
    for (const b of ctx.getBalls()) {
      const ox = old.width / 2 + (b.x - next.width / 2) * sx;
      const oy = old.height / 2 + (b.y - next.height / 2) * sy;
      b.x = next.gx + ((ox - old.gx) / old.tile) * next.tile;
      b.y = next.gy + ((oy - old.gy) / old.tile) * next.tile;
      b.vx *= k;
      b.vy *= k;
      b.radius *= k;
      b.radiusScale = b.radius / (ctx.config.ballRadius || 8);
    }
    v.field = next;
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
    return { teams: v.teams, counts: Array.from(v.counts.subarray(0, v.teams)), conversions: v.conversions, winner: v.winner, tie: v.tie, finished: v.finished };
  }
}
