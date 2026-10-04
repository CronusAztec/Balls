import { midiToFrequency } from "@/lib/audio/scales";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import { BOARD_BALL_CEILING, atLeastMin, memoryCeiling } from "@/lib/uncap"; // uncap-all: no maximum, the memory-safety ceilings only
import { MAX_TEAMS } from "../ballStats";
import { SpatialHash, createPairBuffer } from "../spatialHash";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";

/**
 * Land Claim ("landClaim" mode, battle family – feature land-claim): the land-claim clips of the arena account ("WHO WILL
 * CLAIM THE MOST?? #territory #landclaim", "1,144 blocks, 146 balls, every ball that hits a column knocks its top block off,
 * and every eighth block knocked off adds another ball"). The arena – a square, a hexagon (the #hexagon clips) or a circle –
 * is lined with columns of blocks standing on its wall and pointing at its centre; competitors' balls bounce around inside,
 * and every hit on a column takes its top block (the one nearest the centre):
 *
 *  - `knock` (the clip's rule): the block flies off in the hitter's colour and counts for the hitter; a column with no
 *    blocks left is bare wall;
 *  - `claim`: the block stays where it is, recoloured in the hitter's colour – the wall becomes a mosaic of claims (a
 *    column hands out its blocks from the top down; a column claimed to the wall is only a wall to bounce off);
 *  - `steal`: like claim, and a hit on a claimed column flips its topmost block that is not the hitter's – land sways back
 *    and forth, and the run ends at the duration.
 *
 * Every `every`-th block a competitor knocks or claims (a steal does not count: the balls stop at blocks ÷ every) adds one
 * more ball of its colour at the knock point. The run ends when every block is knocked / claimed – or at the duration – and
 * the competitor with the most blocks wins: DOMINATION when it holds more than 60 % of the land, SUCH A CLOSE BATTLE when the
 * top two are within 5 %, else "[name] claims the most" (`landClaimVerdict()`).
 *
 * Geometry (`landClaimField()`): the arena sits in the centred square the recorder exports, under the HUD band. A polygon's
 * columns are spread over its sides (`sideColumns()`), the circle's over its circumference, each column the wedge between
 * two rays from the centre through its edges on the wall, `depth` deep – so the columns of a side tile it and the corners
 * need no special case. A block is a slice of its column: on a polygon the side's wall shifted `row × block` inwards (the
 * polygon scaled about the centre), on the circle a ring. The solid part of column i is its wedge beyond its top face
 * (`wedge ∩ { x · n ≥ apothem − height }`, the circle's `|x| ≥ radius − height`): a ball's contact is the deepest overlap
 * with the walls and the columns near its bearing (`contacts()`), resolved by pushing it out and reflecting it.
 *
 * Physics: the engine moves the balls (gravity as the Gravity slider sets it – 0 by default in this mode – and its
 * slow-ball boost off: `ballsMayRest`); the mode keeps every ball at its cruising speed (a share of the square a second, so
 * a run looks the same on any canvas), bounces it elastically off the walls and the columns with a small seeded scatter
 * (no periodic orbit traps a ball) and resolves the ball-to-ball hits itself through a spatial hash (`ballsPassThrough`:
 * O(n) a sub-step for the clip's 146 balls and past it). The knocks of a sub-step wait for its end (every ball judges the
 * columns as they stood when the sub-step began), the spawns too. Everything random – the start positions and headings,
 * the scatter, a spawn's heading – comes from `ctx.random()`, so a seed replays exactly and Find Simulation can search it.
 *
 * The rigged forced winner (`config.forcedWinner`) is honest steering, not a hard constraint: whenever a ball of the chosen
 * competitor bounces off a wall or a column, its rebound is aimed a little better – of the headings within `LC_RIG_TURN` of
 * it, the one whose ray meets the nearest column top that still has land for it (or, when none does, towards the nearest
 * such column round the wall) – so its flights are shorter and end on land it can take. Speed, size and the rules stay the
 * same and nothing is ever taken from the others: it makes the chosen colour the favourite (it wins about six runs in ten
 * where it would win one in four), not a certainty; Find Simulation's winner outcome finds the run it wins. A level top goes
 * to it.
 *
 * Scoring: at the verdict the first `MAX_TEAMS` competitors are credited with their blocks as "walls" and the winner with an
 * "escape", so the teams banner, the finder's winner outcome and the scoreboard rank the battle like the land count.
 */

/* ------------------------------------------------------------------ settings */

export const LC_ARENAS = ["square", "hexagon", "circle"] as const;
export type LcArena = (typeof LC_ARENAS)[number];
export const LC_RULES = ["knock", "claim", "steal"] as const;
export type LcRule = (typeof LC_RULES)[number];

export function isLcArena(value: unknown): value is LcArena {
  return typeof value === "string" && (LC_ARENAS as readonly string[]).includes(value);
}
export function isLcRule(value: unknown): value is LcRule {
  return typeof value === "string" && (LC_RULES as readonly string[]).includes(value);
}

export interface LandClaimSettings {
  /** Columns round the wall, 4–96 on the slider, any number from 4 typed (a run builds at most `LC_COL_CEILING`). */
  cols: number;
  /** Blocks a column holds, 1–40 on the slider, any number from 1 typed (at most `LC_ROW_CEILING`, `LC_BLOCK_CEILING` in all). */
  rows: number;
  arena: LcArena;
  /** Competitors, 2–12 on the slider, any number from 2 typed (at most `LC_TEAM_CEILING`). */
  teams: number;
  /** Balls every competitor starts with, 1–10 on the slider, any number from 1 typed (`LC_BALL_CEILING` balls in all). */
  balls: number;
  rule: LcRule;
  /** Every this many blocks a competitor knocks / claims add one more ball of its colour; 0 = never. */
  every: number;
  /** Seconds: the run ends here at the latest (a steal battle always does), 10–180 on the slider, any number from 10 typed. */
  duration: number;
  /** The title line at the top of the HUD ("" = the translated "LAND CLAIM"); drawn in capitals. */
  title: string;
  /** The HUD: the title, a bar per competitor, the counters (the verdict banner shows either way). */
  hud: boolean;
}

export const DEFAULT_LAND_CLAIM_SETTINGS: LandClaimSettings = {
  cols: 24,
  rows: 12,
  arena: "square",
  teams: 4,
  balls: 3,
  rule: "knock",
  every: 8,
  duration: 60,
  title: "",
  hud: true,
};

/**
 * Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`: comfort ranges
 * (uncap-all) – a value past a slider is kept as typed; what a run builds stops at the memory-safety ceilings below.
 */
export const LAND_CLAIM_RANGES = {
  lcCols: { min: 4, max: 96, step: 1 },
  lcRows: { min: 1, max: 40, step: 1 },
  lcTeams: { min: 2, max: 12, step: 1 },
  lcBalls: { min: 1, max: 10, step: 1 },
  lcEvery: { min: 0, max: 20, step: 1 },
  lcDuration: { min: 10, max: 180, step: 5 },
} as const;

/**
 * Memory-safety ceilings (`MEMORY_CEILINGS` of lib/uncap.ts names the first four; a test keeps them equal). Columns: a
 * column is a dozen numbers and its blocks a slice of the owner array – 5,000 columns are a wall of hairlines on any screen.
 * Blocks: the owner array is two bytes a block, so a million blocks are 2 MB (cols × rows past it builds fewer rows: the
 * columns stay). Competitors: a few counters each and a line of the HUD (past a dozen the HUD lists the leaders). Balls: the
 * full-physics balls of one board (`BOARD_BALL_CEILING`), the starting ones and every spawn together – a spawn past it is
 * refused with ARENA FULL, the knock still counts.
 */
export const LC_COL_CEILING = 5_000;
export const LC_ROW_CEILING = 2_000;
export const LC_BLOCK_CEILING = 1_000_000;
export const LC_TEAM_CEILING = 1_000;
export const LC_BALL_CEILING = BOARD_BALL_CEILING;

/** The Land Claim fields of the SimulatorSettings object (URL keys lcc, lcr, lca, lct, lcb, lcm, lce, lcd, lcti, lch). */
export interface LandClaimSettingFields {
  lcCols: number;
  lcRows: number;
  lcArena: LcArena;
  lcTeams: number;
  lcBalls: number;
  lcRule: LcRule;
  lcEvery: number;
  lcDuration: number;
  lcTitle: string;
  lcHud: boolean;
}

/** Longest title (characters). */
export const LC_TITLE_LENGTH = 40;

/** A typed number: a finite value lifted onto the slider's minimum – never held to its maximum (uncap-all) –, else `fallback`. */
function typedNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) : fallback;
}

// Control characters and the Unicode line / paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A title as stored: control characters and line breaks as spaces, whitespace collapsed, at most `LC_TITLE_LENGTH` characters. */
export function sanitizeLcTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(CONTROL, " ").replace(/\s+/g, " ").trimStart()).slice(0, LC_TITLE_LENGTH).join("");
}

/**
 * Fills in the defaults and validates every value: counts whole, the duration on whole seconds; a value below its slider is
 * lifted onto it, a value past it kept (uncap-all, no maximum) – the columns, the rows, the competitors and the balls stop at
 * their memory-safety ceilings. Unknown arenas and rules and non-boolean flags fall back to the defaults.
 */
export function resolveLandClaimSettings(config: Partial<Record<keyof LandClaimSettings, unknown>> | null | undefined): LandClaimSettings {
  const out: LandClaimSettings = { ...DEFAULT_LAND_CLAIM_SETTINGS };
  if (!config) return out;
  const R = LAND_CLAIM_RANGES;
  if (config.cols !== undefined) out.cols = memoryCeiling("lcCols", Math.round(typedNumber(config.cols, R.lcCols, out.cols)));
  if (config.rows !== undefined) out.rows = memoryCeiling("lcRows", Math.round(typedNumber(config.rows, R.lcRows, out.rows)));
  if (isLcArena(config.arena)) out.arena = config.arena;
  if (config.teams !== undefined) out.teams = memoryCeiling("lcTeams", Math.round(typedNumber(config.teams, R.lcTeams, out.teams)));
  if (config.balls !== undefined) out.balls = memoryCeiling("lcBalls", Math.round(typedNumber(config.balls, R.lcBalls, out.balls)));
  if (isLcRule(config.rule)) out.rule = config.rule;
  if (config.every !== undefined) out.every = Math.round(typedNumber(config.every, R.lcEvery, out.every));
  if (config.duration !== undefined) out.duration = Math.round(typedNumber(config.duration, R.lcDuration, out.duration));
  if (config.title !== undefined) out.title = sanitizeLcTitle(config.title);
  if (typeof config.hud === "boolean") out.hud = config.hud;
  return out;
}

/** Picks the Land Claim settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setLandClaimSettings()`. */
export function landClaimSettingsOf(source: LandClaimSettingFields): LandClaimSettings {
  return resolveLandClaimSettings({
    cols: source.lcCols,
    rows: source.lcRows,
    arena: source.lcArena,
    teams: source.lcTeams,
    balls: source.lcBalls,
    rule: source.lcRule,
    every: source.lcEvery,
    duration: source.lcDuration,
    title: source.lcTitle,
    hud: source.lcHud,
  });
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function landClaimSettingFields(settings: LandClaimSettings): LandClaimSettingFields {
  return {
    lcCols: settings.cols,
    lcRows: settings.rows,
    lcArena: settings.arena,
    lcTeams: settings.teams,
    lcBalls: settings.balls,
    lcRule: settings.rule,
    lcEvery: settings.every,
    lcDuration: settings.duration,
    lcTitle: settings.title,
    lcHud: settings.hud,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** The defaults of the feature's fields. */
export function defaultLandClaimFields(): LandClaimSettingFields {
  return landClaimSettingFields(DEFAULT_LAND_CLAIM_SETTINGS);
}

/** Seconds the default clip runs past the duration: the verdict, the winner banner and its hold. */
export const LC_CLIP_TAIL_SEC = 4;

/** The clip length (s) that covers a run of at most `durationSec` and its verdict (at least the recording's 10 s; no maximum). */
export function landClaimClipSec(durationSec: number): number {
  return Math.max(10, Math.round(durationSec) + LC_CLIP_TAIL_SEC);
}

/**
 * The mode's own defaults of shared settings: in Land Claim the balls fly straight (gravity 0 – the Gravity slider still
 * bends them when it is set) and the clip covers the longest run and its verdict.
 */
export function landClaimModeDefaults(mode: string): { gravity?: number; recordingDuration?: number } {
  return mode === "landClaim" ? { gravity: 0, recordingDuration: landClaimClipSec(DEFAULT_LAND_CLAIM_SETTINGS.duration) } : {};
}

/** Validates the feature's fields (URL parameters and presets alike): valid numbers (no maximum), known options, real booleans. */
export function resolveLandClaimFields(source: Partial<LandClaimSettingFields>): LandClaimSettingFields {
  const merged = { ...defaultLandClaimFields() } as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) if (value !== undefined) merged[key] = value;
  return landClaimSettingFields(landClaimSettingsOf(merged as unknown as LandClaimSettingFields));
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { lcc: "lcCols", lcr: "lcRows", lct: "lcTeams", lcb: "lcBalls", lce: "lcEvery", lcd: "lcDuration" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: lcc, lcr, lca, lct, lcb, lcm, lce, lcd, lcti and lch. */
export function writeLandClaimParams(settings: LandClaimSettingFields, base: LandClaimSettingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.lcArena !== base.lcArena) params.set("lca", settings.lcArena);
  if (settings.lcRule !== base.lcRule) params.set("lcm", settings.lcRule);
  if (settings.lcTitle !== base.lcTitle) params.set("lcti", settings.lcTitle);
  if (settings.lcHud !== base.lcHud) params.set("lch", settings.lcHud ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readLandClaimParams(params: URLSearchParams, settings: LandClaimSettingFields) {
  const next: Partial<LandClaimSettingFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const arena = params.get("lca");
  if (isLcArena(arena)) next.lcArena = arena;
  const rule = params.get("lcm");
  if (isLcRule(rule)) next.lcRule = rule;
  const title = params.get("lcti");
  if (title !== null) next.lcTitle = title;
  const hud = params.get("lch");
  if (hud === "1") next.lcHud = true;
  else if (hud === "0") next.lcHud = false;
  Object.assign(settings, resolveLandClaimFields(next));
}

/* ------------------------------------------------------------------ built-in presets */

export const LC_PRESET_IDS = ["countries4", "domination", "steal", "hexagon6", "claim2v2"] as const;
export type LcPresetId = (typeof LC_PRESET_IDS)[number];

export function isLcPresetId(value: unknown): value is LcPresetId {
  return typeof value === "string" && (LC_PRESET_IDS as readonly string[]).includes(value);
}

/** A built-in preset: the feature's fields, the countries of its roster (codes) and the shared settings it sets. */
interface LcPreset {
  fields: Partial<LandClaimSettingFields>;
  countries: readonly string[];
  shared: { ballRadius?: number };
}

const LC_PRESETS: Readonly<Record<LcPresetId, LcPreset>> = {
  // Four countries knock the default 24 × 12 wall.
  countries4: { fields: { lcRule: "knock", lcArena: "square", lcCols: 24, lcRows: 12, lcTeams: 4, lcBalls: 3, lcEvery: 8, lcDuration: 60 }, countries: ["FR", "BR", "ES", "CO"], shared: {} },
  // The clip: 52 columns × 22 blocks = 1,144 blocks; four countries start with a ball each, and every eighth block adds one –
  // 1,144 ÷ 8 = 143 spawns at most, so the run ends with about 146 balls. Smaller balls make room for them.
  domination: { fields: { lcRule: "knock", lcArena: "square", lcCols: 52, lcRows: 22, lcTeams: 4, lcBalls: 1, lcEvery: 8, lcDuration: 90 }, countries: ["US", "UA", "IN", "BR"], shared: { ballRadius: 5 } },
  // Land sways back and forth until the duration.
  steal: { fields: { lcRule: "steal", lcArena: "square", lcCols: 24, lcRows: 12, lcTeams: 4, lcBalls: 2, lcEvery: 8, lcDuration: 45 }, countries: ["AR", "MX", "PL", "NL"], shared: {} },
  // The #hexagon clips: six sides, six countries, six columns a side.
  hexagon6: { fields: { lcRule: "knock", lcArena: "hexagon", lcCols: 36, lcRows: 12, lcTeams: 6, lcBalls: 2, lcEvery: 8, lcDuration: 60 }, countries: ["FR", "BR", "DE", "CO", "NL", "AR"], shared: {} },
  // Two countries of two balls paint the wall.
  claim2v2: { fields: { lcRule: "claim", lcArena: "square", lcCols: 24, lcRows: 12, lcTeams: 2, lcBalls: 2, lcEvery: 8, lcDuration: 60 }, countries: ["BR", "AR"], shared: {} },
};

/** The settings patch of a built-in preset (its fields, its roster of countries, the clip that covers it); `nameOf` localises a country's name. */
export function landClaimPresetPatch(id: LcPresetId, nameOf: (code: string, english: string) => string = (_, english) => english): Partial<LandClaimSettingFields> & {
  teams: { name: string; color: string; emoji: string }[];
  ballRadius?: number;
  recordingDuration: number;
} {
  const preset = LC_PRESETS[id];
  const fields = resolveLandClaimFields(preset.fields);
  const teams = preset.countries.map((code) => {
    const c = countryByCode(code) ?? COUNTRIES[0];
    return { name: nameOf(c.code, c.name), color: c.colors[0], emoji: c.flag };
  });
  return { ...fields, teams, ...preset.shared, recordingDuration: landClaimClipSec(fields.lcDuration) };
}

/* ------------------------------------------------------------------ constants */

/** The colours and names of the competitors without a roster entry (neon on black); past them golden-angle hues. */
export const LC_PALETTE: readonly { name: string; color: string }[] = [
  { name: "RED", color: "#ff3b3b" },
  { name: "BLUE", color: "#3b82ff" },
  { name: "GREEN", color: "#22d36b" },
  { name: "GOLD", color: "#ffc61a" },
  { name: "PURPLE", color: "#b45cff" },
  { name: "ORANGE", color: "#ff8a1f" },
  { name: "CYAN", color: "#22e4ff" },
  { name: "PINK", color: "#ff4fb8" },
  { name: "LIME", color: "#b6ff1a" },
  { name: "TEAL", color: "#19d3b8" },
  { name: "VIOLET", color: "#8f7bff" },
  { name: "CORAL", color: "#ff7a6b" },
];

/** "#rrggbb" of an HSL colour (h in degrees, s and l 0–1). */
function hslHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** The palette colour of competitor `team` (golden-angle hues past the palette). */
export function lcPaletteColor(team: number): string {
  const t = Math.max(0, Math.floor(team));
  if (t < LC_PALETTE.length) return LC_PALETTE[t].color;
  return hslHex((t * 137.508) % 360, 0.85, 0.6);
}

/** The palette name of competitor `team` ("" past the palette: the canvas names it "Team 13"). */
export function lcPaletteName(team: number): string {
  const t = Math.max(0, Math.floor(team));
  return t < LC_PALETTE.length ? LC_PALETTE[t].name : "";
}

/** The HUD band at the top of the square (fraction of its side) and the margin around the arena. */
export const LC_HUD_BAND = 0.2;
export const LC_MARGIN = 0.025;
/** How deep the columns stand, as a fraction of the wall's distance from the centre (the apothem). */
export const LC_DEPTH = 0.36;
/** Cruising speed: this share of the square's side a second at Ball Speed 400. */
export const LC_SPEED = 0.5;
/** A ball's radius: this share of the square's side at Ball Size 8 (no maximum: the Ball Size applies however big). */
export const LC_BALL_SCALE = 0.022;
/** The largest random turn (radians) of a bounce off a wall or a column: no ball keeps a periodic orbit. */
export const LC_SCATTER = 0.07;
/** The rig: the most a chosen ball's rebound is turned towards land still to take (radians), the headings it weighs within that, and how steeply it must leave the surface (the cosine to its normal: no grazing along a wall). */
export const LC_RIG_TURN = 0.42;
export const LC_RIG_SAMPLES = 9;
export const LC_RIG_MIN_LEAVE = 0.35;
/** The verdict: DOMINATION past this share of the land, SUCH A CLOSE BATTLE when the top two are this close. */
export const LC_DOMINATION = 0.6;
export const LC_CLOSE = 0.05;
/** A spawned ball leaves the knock point within this angle (radians) of the wall's inward normal. */
export const LC_SPAWN_SPREAD = Math.PI / 3;
/** Knock clicks: at most one a step and one per LC_KNOCK_GAP_MS; spawn chimes one per LC_SPAWN_GAP_MS; KOs one a step. */
export const LC_KNOCK_GAP_MS = 45;
export const LC_SPAWN_GAP_MS = 140;
/** Flying blocks kept for the canvas, and how long one flies (simulation ms). */
export const LC_FLY_LOG = 256;
export const LC_FLY_MS = 1100;
/** Recent claims kept for the canvas' pop, and how long a pop lasts (simulation ms). */
export const LC_POP_LOG = 256;
export const LC_POP_MS = 450;
/** The knock click's ladder: C-major pentatonic from C5 round the wall (the first column lowest). */
export const LC_LADDER: readonly number[] = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93];

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

/** How many of `cols` columns side `k` of an `n`-sided polygon holds: as even as can be, the extra ones on the later sides. */
export function sideColumns(cols: number, n: number, k: number): number {
  return Math.floor(((k + 1) * cols) / n) - Math.floor((k * cols) / n);
}

/** Where the arena sits on a canvas of `width` × `height`, and its columns (`landClaimField()`). */
export interface LandClaimField {
  width: number;
  height: number;
  /** The centred square the recorder exports: its side and top-left corner; the HUD band at its top. */
  side: number;
  sqLeft: number;
  sqTop: number;
  hudTop: number;
  hudHeight: number;
  /** The arena's centre. */
  cx: number;
  cy: number;
  arena: LcArena;
  /** Sides of the polygon (4 or 6), 0 for the circle. */
  sides: number;
  /** The wall's distance from the centre: a polygon's apothem, the circle's radius. */
  apothem: number;
  /** The columns' full depth and one block's depth (px). */
  depth: number;
  block: number;
  cols: number;
  rows: number;
  /** The angle (radians) the first column starts at; the columns run round the wall with increasing angle from it. */
  start: number;
  /** Per side (polygons): the outward normal. */
  sideNx: Float64Array;
  sideNy: Float64Array;
  /** Per column: its side (−1 on the circle) and its angular span (a1 > a0, both from `start` on, a1 ≤ start + 2π). */
  colSide: Int32Array;
  colA0: Float64Array;
  colA1: Float64Array;
  /** Per column: the unit vectors of its edges and the wall points they reach (relative to the centre). */
  colU0x: Float64Array;
  colU0y: Float64Array;
  colU1x: Float64Array;
  colU1y: Float64Array;
  colX0: Float64Array;
  colY0: Float64Array;
  colX1: Float64Array;
  colY1: Float64Array;
}

/**
 * The arena on a canvas of `width` × `height` (world px): inside the centred square the recorder crops to, under the HUD
 * band. A square's sides are level, a hexagon's top and bottom sides too; the columns run round the wall from the top-left
 * corner (the circle: from the top), clockwise on screen.
 */
export function landClaimField(width: number, height: number, arena: LcArena, cols: number, rows: number): LandClaimField {
  const side = Math.max(40, Math.min(width, height));
  const sqLeft = width / 2 - side / 2;
  const sqTop = height / 2 - side / 2;
  const hud = LC_HUD_BAND * side;
  const margin = LC_MARGIN * side;
  const boxW = side - 2 * margin;
  const boxH = side - hud - margin;
  const cx = width / 2;
  const cy = sqTop + hud + boxH / 2;
  const n = arena === "square" ? 4 : arena === "hexagon" ? 6 : 0;
  // A flat-topped hexagon is 2a wide over its corners (2a / cos 30° …) and 2a tall: it fits by its width.
  const apothem = n === 6 ? Math.min(boxH / 2, (boxW / 2) * Math.cos(Math.PI / 6)) : Math.min(boxW, boxH) / 2;
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  const depth = LC_DEPTH * apothem;
  const f: LandClaimField = {
    width,
    height,
    side,
    sqLeft,
    sqTop,
    hudTop: sqTop,
    hudHeight: hud,
    cx,
    cy,
    arena,
    sides: n,
    apothem,
    depth,
    block: depth / r,
    cols: c,
    rows: r,
    start: n > 0 ? -Math.PI / 2 - Math.PI / n : -Math.PI / 2,
    sideNx: new Float64Array(n),
    sideNy: new Float64Array(n),
    colSide: new Int32Array(c),
    colA0: new Float64Array(c),
    colA1: new Float64Array(c),
    colU0x: new Float64Array(c),
    colU0y: new Float64Array(c),
    colU1x: new Float64Array(c),
    colU1y: new Float64Array(c),
    colX0: new Float64Array(c),
    colY0: new Float64Array(c),
    colX1: new Float64Array(c),
    colY1: new Float64Array(c),
  };
  if (n > 0) {
    const rc = apothem / Math.cos(Math.PI / n);
    let col = 0;
    for (let k = 0; k < n; k++) {
      const alpha = -Math.PI / 2 + (k * TWO_PI) / n;
      f.sideNx[k] = Math.cos(alpha);
      f.sideNy[k] = Math.sin(alpha);
      const lo = f.start + (k * TWO_PI) / n;
      const vx0 = rc * Math.cos(lo);
      const vy0 = rc * Math.sin(lo);
      const vx1 = rc * Math.cos(lo + TWO_PI / n);
      const vy1 = rc * Math.sin(lo + TWO_PI / n);
      const count = sideColumns(c, n, k);
      for (let j = 0; j < count; j++, col++) {
        const t0 = j / count;
        const t1 = (j + 1) / count;
        const x0 = vx0 + t0 * (vx1 - vx0);
        const y0 = vy0 + t0 * (vy1 - vy0);
        const x1 = vx0 + t1 * (vx1 - vx0);
        const y1 = vy0 + t1 * (vy1 - vy0);
        f.colSide[col] = k;
        f.colX0[col] = x0;
        f.colY0[col] = y0;
        f.colX1[col] = x1;
        f.colY1[col] = y1;
        // The edges' bearings, unwrapped onto the side's own span of angles (a corner sits exactly on its span's end).
        f.colA0[col] = j === 0 ? lo : unwrapAngle(Math.atan2(y0, x0), lo);
        f.colA1[col] = j === count - 1 ? lo + TWO_PI / n : unwrapAngle(Math.atan2(y1, x1), lo);
        const l0 = Math.hypot(x0, y0);
        const l1 = Math.hypot(x1, y1);
        f.colU0x[col] = x0 / l0;
        f.colU0y[col] = y0 / l0;
        f.colU1x[col] = x1 / l1;
        f.colU1y[col] = y1 / l1;
      }
    }
  } else {
    for (let i = 0; i < c; i++) {
      const a0 = f.start + (i * TWO_PI) / c;
      const a1 = f.start + ((i + 1) * TWO_PI) / c;
      f.colSide[i] = -1;
      f.colA0[i] = a0;
      f.colA1[i] = a1;
      f.colU0x[i] = Math.cos(a0);
      f.colU0y[i] = Math.sin(a0);
      f.colU1x[i] = Math.cos(a1);
      f.colU1y[i] = Math.sin(a1);
      f.colX0[i] = apothem * f.colU0x[i];
      f.colY0[i] = apothem * f.colU0y[i];
      f.colX1[i] = apothem * f.colU1x[i];
      f.colY1[i] = apothem * f.colU1y[i];
    }
  }
  return f;
}

/** `angle` moved by whole turns into [lo, lo + 2π). */
function unwrapAngle(angle: number, lo: number): number {
  let a = angle;
  while (a < lo - 1e-12) a += TWO_PI;
  while (a >= lo + TWO_PI - 1e-12) a -= TWO_PI;
  return a;
}

/** The column whose wedge holds bearing `angle` (radians, any turn) – the last one starting at or before it; −1 without columns. */
export function columnAt(field: Pick<LandClaimField, "start" | "colA0" | "cols">, angle: number): number {
  const n = field.cols;
  if (n <= 0) return -1;
  let a = (angle - field.start) % TWO_PI;
  if (a < 0) a += TWO_PI;
  a += field.start;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (field.colA0[mid] <= a) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where block `row` (0 at the wall) of column `col` is: its four corners (relative to the centre), wall side first. Writes into `out` (x0 y0 x1 y1 x2 y2 x3 y3). */
export function blockCorners(field: LandClaimField, col: number, row: number, out: Float64Array | number[]): void {
  const a = field.apothem;
  const inner = (a - (row + 1) * field.block) / a;
  const outer = (a - row * field.block) / a;
  if (field.sides > 0) {
    // A polygon's slice is its side's wall shifted inwards: the wall points scaled about the centre.
    out[0] = field.colX0[col] * outer;
    out[1] = field.colY0[col] * outer;
    out[2] = field.colX1[col] * outer;
    out[3] = field.colY1[col] * outer;
    out[4] = field.colX1[col] * inner;
    out[5] = field.colY1[col] * inner;
    out[6] = field.colX0[col] * inner;
    out[7] = field.colY0[col] * inner;
  } else {
    out[0] = field.colX0[col] * outer;
    out[1] = field.colY0[col] * outer;
    out[2] = field.colX1[col] * outer;
    out[3] = field.colY1[col] * outer;
    out[4] = field.colX1[col] * inner;
    out[5] = field.colY1[col] * inner;
    out[6] = field.colX0[col] * inner;
    out[7] = field.colY0[col] * inner;
  }
}

/** The middle of block `row` of column `col` (relative to the centre), written into `out`. */
export function blockCentre(field: LandClaimField, col: number, row: number, out: { x: number; y: number }) {
  const a = field.apothem;
  const k = (a - (row + 0.5) * field.block) / a;
  out.x = 0.5 * (field.colX0[col] + field.colX1[col]) * k;
  out.y = 0.5 * (field.colY0[col] + field.colY1[col]) * k;
  if (field.sides === 0) {
    // On the circle the middle of the arc, not of the chord.
    const mid = 0.5 * (field.colA0[col] + field.colA1[col]);
    const rr = a - (row + 0.5) * field.block;
    out.x = rr * Math.cos(mid);
    out.y = rr * Math.sin(mid);
  }
  return out;
}

/** A ball's radius (px) at Ball Size `ballSize` on a square of side `side`: `LC_BALL_SCALE` of it per 8 px (no maximum). */
export function landClaimBallRadius(ballSize: number, side: number): number {
  return side * LC_BALL_SCALE * ((ballSize || 8) / 8);
}

/** The pitch (Hz) of a knock on column `col` of `cols`: a step of the pentatonic ladder round the wall. */
export function knockFrequency(col: number, cols: number): number {
  const k = cols > 1 ? Math.max(0, Math.min(LC_LADDER.length - 1, Math.floor((col / cols) * LC_LADDER.length))) : 0;
  return midiToFrequency(LC_LADDER[k]);
}

/** The pitch (Hz) of a spawn chime of competitor `team`: a degree a competitor, an octave above the knocks' first step. */
export function spawnFrequency(team: number): number {
  return midiToFrequency(LC_LADDER[((Math.floor(team) % 5) + 5) % 5] + 12);
}

export type LcVerdictKind = "domination" | "close" | "plain";

/** The verdict of a battle: the winner (−1 when nobody holds land), the kind, the winner's share, the gap to the runner-up and whether the top was level. */
export interface LcVerdict {
  winner: number;
  second: number;
  kind: LcVerdictKind;
  share: number;
  margin: number;
  tie: boolean;
}

/**
 * The verdict of `land` (blocks per competitor, `teams` of them): the most land wins – on a level top the rig's chosen
 * competitor (`forced`), else the one with more balls (`balls`), else the earlier slot. DOMINATION when the winner holds more
 * than `LC_DOMINATION` of the land, SUCH A CLOSE BATTLE when the top two are within `LC_CLOSE` of it, else a plain win.
 * Writes into `out`.
 */
export function landClaimVerdict(land: ArrayLike<number>, teams: number, forced = -1, balls?: ArrayLike<number>, out: LcVerdict = { winner: -1, second: -1, kind: "plain", share: 0, margin: 0, tie: false }): LcVerdict {
  let total = 0;
  let best = -1;
  for (let t = 0; t < teams; t++) {
    const v = Math.max(0, land[t]);
    total += v;
    if (best < 0 || v > land[best]) best = t;
    else if (v === land[best]) {
      // A level top: the chosen one, else more balls, else the earlier slot (`best` already is).
      if (t === forced) best = t;
      else if (best !== forced && balls && balls[t] > balls[best]) best = t;
    }
  }
  let second = -1;
  for (let t = 0; t < teams; t++) if (t !== best && (second < 0 || land[t] > land[second])) second = t;
  out.second = second;
  if (best < 0 || total <= 0) {
    out.winner = -1;
    out.kind = "plain";
    out.share = 0;
    out.margin = 0;
    out.tie = teams > 1;
    return out;
  }
  out.winner = best;
  out.share = land[best] / total;
  out.margin = second >= 0 ? (land[best] - land[second]) / total : 1;
  out.tie = second >= 0 && land[second] === land[best];
  out.kind = out.share > LC_DOMINATION ? "domination" : out.margin <= LC_CLOSE + 1e-12 ? "close" : "plain";
  return out;
}

/** The effective forced winner of a battle of `teams` competitors: the rigged slot when it plays (one of the first `MAX_TEAMS`), else −1. */
export function landClaimForcedWinner(forcedWinner: number | undefined, teams: number): number {
  const w = forcedWinner ?? -1;
  return Number.isInteger(w) && w >= 0 && w < Math.min(teams, MAX_TEAMS) ? w : -1;
}

/* ------------------------------------------------------------------ state and view */

export interface LandClaimView {
  /** The settings of the last init, with the display fields (title, HUD) applied at once. */
  settings: LandClaimSettings;
  /** Incremented by every init. */
  generation: number;
  field: LandClaimField;
  rule: LcRule;
  /** Competitors this run (`LC_TEAM_CEILING` at most). */
  teams: number;
  cols: number;
  rows: number;
  /** Blocks on the wall at the start (cols × rows). */
  total: number;
  /** Knock: the blocks a column still has. Claim / steal: every column keeps all its blocks (the wall's shape never changes). */
  heights: Int32Array;
  /** Claim / steal: the owner of every block (column-major: `col * rows + row`, row 0 at the wall), −1 unclaimed. Empty in knock. */
  owner: Int16Array;
  /** Claim: the unclaimed blocks of a column (they are its rows 0 … n − 1: a column is claimed from the top down). */
  claimTop: Int32Array;
  /** Changes per column (the canvas repaints a column whose count moved). */
  colVersion: Uint32Array;
  /** Per competitor: the land it holds, the blocks it knocked / claimed (its spawn counter), its balls in play and spawned. */
  land: Int32Array;
  gains: Int32Array;
  alive: Int32Array;
  spawned: Int32Array;
  /** Steal: per competitor, the blocks it took from a rival and the blocks rivals took from it. */
  stolen: Int32Array;
  lost: Int32Array;
  /** Blocks not knocked / claimed yet, the tallest column (blocks), the columns knocked bare (or claimed / taken whole). */
  remaining: number;
  maxHeight: number;
  kos: number;
  /** Knocks (knock: blocks gone; claim: claims; steal: claims and steals), steals, spawns and spawns refused at the ball ceiling. */
  knocks: number;
  steals: number;
  spawns: number;
  spawnsRefused: number;
  /** Bounces off the walls and the columns, ball-to-ball hits, notes played. */
  bounces: number;
  collisions: number;
  notes: number;
  /** Knocked blocks in flight (a ring of LC_FLY_LOG): column, row, competitor, time and the launch (apothems a second, rad/s). */
  flyCol: Int32Array;
  flyRow: Int32Array;
  flyTeam: Int32Array;
  flyMs: Float64Array;
  flyVx: Float32Array;
  flyVy: Float32Array;
  flySpin: Float32Array;
  flyHead: number;
  flyCount: number;
  /** Recent claims (a ring of LC_POP_LOG) for the pop: block index, competitor, time. */
  popIdx: Int32Array;
  popTeam: Int32Array;
  popMs: Float64Array;
  popHead: number;
  popCount: number;
  /** The competitor leading right now (−1: a level top), lead changes, whether the top two are within LC_CLOSE right now. */
  leader: number;
  leadChanges: number;
  close: boolean;
  /** The rig's chosen competitor (−1 off) and the rebounds it turned. */
  forcedWinner: number;
  steers: number;
  /** The duration of this run (ms). */
  durationMs: number;
  finished: boolean;
  finishedMs: number;
  /** The verdict (set when the run is over). */
  verdict: LcVerdict;
  /** A ball too big for the arena ate it (the engine's outgrow finish ended the run, no verdict). */
  ate: boolean;
}

function createView(): LandClaimView {
  const field = landClaimField(800, 600, DEFAULT_LAND_CLAIM_SETTINGS.arena, DEFAULT_LAND_CLAIM_SETTINGS.cols, DEFAULT_LAND_CLAIM_SETTINGS.rows);
  return {
    settings: { ...DEFAULT_LAND_CLAIM_SETTINGS },
    generation: 0,
    field,
    rule: "knock",
    teams: 0,
    cols: field.cols,
    rows: field.rows,
    total: 0,
    heights: new Int32Array(0),
    owner: new Int16Array(0),
    claimTop: new Int32Array(0),
    colVersion: new Uint32Array(0),
    land: new Int32Array(0),
    gains: new Int32Array(0),
    alive: new Int32Array(0),
    spawned: new Int32Array(0),
    stolen: new Int32Array(0),
    lost: new Int32Array(0),
    remaining: 0,
    maxHeight: 0,
    kos: 0,
    knocks: 0,
    steals: 0,
    spawns: 0,
    spawnsRefused: 0,
    bounces: 0,
    collisions: 0,
    notes: 0,
    flyCol: new Int32Array(LC_FLY_LOG),
    flyRow: new Int32Array(LC_FLY_LOG),
    flyTeam: new Int32Array(LC_FLY_LOG),
    flyMs: new Float64Array(LC_FLY_LOG),
    flyVx: new Float32Array(LC_FLY_LOG),
    flyVy: new Float32Array(LC_FLY_LOG),
    flySpin: new Float32Array(LC_FLY_LOG),
    flyHead: 0,
    flyCount: 0,
    popIdx: new Int32Array(LC_POP_LOG),
    popTeam: new Int32Array(LC_POP_LOG),
    popMs: new Float64Array(LC_POP_LOG),
    popHead: 0,
    popCount: 0,
    leader: -1,
    leadChanges: 0,
    close: false,
    forcedWinner: -1,
    steers: 0,
    durationMs: 1000 * DEFAULT_LAND_CLAIM_SETTINGS.duration,
    finished: false,
    finishedMs: -1,
    verdict: { winner: -1, second: -1, kind: "plain", share: 0, margin: 0, tie: false },
    ate: false,
  };
}

/** A small hash of two integers to [0, 1) (the flying blocks' spread: visual, so it never touches the seeded RNG). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ the mode */

export class LandClaimMode implements GameMode {
  readonly name = "landClaim" as const;
  /** The mode keeps every ball at its cruising speed itself: no engine slow-ball boost. */
  readonly ballsMayRest = true;
  /** The mode resolves the ball-to-ball hits itself (a spatial hash: O(n) a sub-step however many balls the spawns add). */
  readonly ballsPassThrough = true;
  private settings: LandClaimSettings = { ...DEFAULT_LAND_CLAIM_SETTINGS };
  private readonly view: LandClaimView = createView();
  /** Columns per height (knock), so the tallest column is known in O(1) as columns shrink. */
  private heightCount = new Int32Array(0);
  /** The knocks of a sub-step wait for its end: column, competitor and where (px) the ball touched it, with the wall's inward normal there. */
  private qCol = new Int32Array(64);
  private qTeam = new Int32Array(64);
  private qX = new Float64Array(64);
  private qY = new Float64Array(64);
  private qNx = new Float64Array(64);
  private qNy = new Float64Array(64);
  private qLen = 0;
  /** Spawns waiting for the sub-step's end (after its knocks): competitor, where (px) and the inward normal. */
  private sTeam = new Int32Array(16);
  private sX = new Float64Array(16);
  private sY = new Float64Array(16);
  private sNx = new Float64Array(16);
  private sNy = new Float64Array(16);
  private sLen = 0;
  private notesThisStep = 0;
  private lastKnockNoteMs = -Infinity;
  private lastSpawnNoteMs = -Infinity;
  private koThisStep = false;
  private lastLeader = -1;
  /** The deepest contact of `contacts()`: how deep, the normal (towards the ball), the column (−1: a wall) and the touch point (relative). */
  private hitDepth = 0;
  private hitNx = 0;
  private hitNy = 0;
  private hitCol = -1;
  private hitPx = 0;
  private hitPy = 0;
  /** The ball-to-ball pass: the hash and the balls' positions (grown on demand). */
  private readonly hash = new SpatialHash();
  private readonly pairs = createPairBuffer(256);
  private xs = new Float64Array(64);
  private ys = new Float64Array(64);
  private rs = new Float64Array(64);
  private readonly mid = { x: 0, y: 0 };

  getSettings(): LandClaimSettings {
    return { ...this.settings };
  }

  /** The wall, the competitors, the balls, the rule, the spawn period and the duration apply on the next init; the title and the HUD at once. */
  setSettings(patch: Partial<LandClaimSettings>) {
    this.settings = resolveLandClaimSettings({ ...this.settings, ...patch });
    this.view.settings.title = this.settings.title;
    this.view.settings.hud = this.settings.hud;
  }

  /** Live battle state for the canvas and the HUD; the same object every call. */
  getView(): LandClaimView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return {
      teams: v.teams,
      total: v.total,
      remaining: v.remaining,
      knocks: v.knocks,
      steals: v.steals,
      spawns: v.spawns,
      land: Array.from(v.land),
      alive: Array.from(v.alive),
      finished: v.finished,
      winner: v.verdict.winner,
      verdict: v.finished ? v.verdict.kind : "",
      leader: v.leader,
    };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    const cfg = ctx.config;
    v.settings = { ...s };
    v.generation++;
    v.rule = s.rule;
    v.teams = Math.max(2, s.teams);
    // The memory-safety ceiling of the blocks: a wall past it builds fewer rows (the columns stay).
    const rows = Math.max(1, Math.min(s.rows, Math.floor(LC_BLOCK_CEILING / Math.max(1, s.cols))));
    v.field = landClaimField(cfg.width, cfg.height, s.arena, s.cols, rows);
    v.cols = v.field.cols;
    v.rows = v.field.rows;
    v.total = v.cols * v.rows;
    v.heights = new Int32Array(v.cols).fill(v.rows);
    v.claimTop = s.rule === "claim" ? new Int32Array(v.cols).fill(v.rows) : new Int32Array(0);
    v.owner = s.rule === "knock" ? new Int16Array(0) : new Int16Array(v.total).fill(-1);
    v.colVersion = new Uint32Array(v.cols);
    v.land = new Int32Array(v.teams);
    v.gains = new Int32Array(v.teams);
    v.alive = new Int32Array(v.teams);
    v.spawned = new Int32Array(v.teams);
    v.stolen = new Int32Array(v.teams);
    v.lost = new Int32Array(v.teams);
    v.remaining = v.total;
    v.maxHeight = v.rows;
    this.heightCount = new Int32Array(v.rows + 1);
    this.heightCount[v.rows] = v.cols;
    v.kos = 0;
    v.knocks = 0;
    v.steals = 0;
    v.spawns = 0;
    v.spawnsRefused = 0;
    v.bounces = 0;
    v.collisions = 0;
    v.notes = 0;
    v.flyHead = 0;
    v.flyCount = 0;
    v.popHead = 0;
    v.popCount = 0;
    v.leader = -1;
    v.leadChanges = 0;
    v.close = false;
    v.forcedWinner = landClaimForcedWinner(cfg.forcedWinner, v.teams);
    v.steers = 0;
    v.durationMs = 1000 * s.duration;
    v.finished = false;
    v.finishedMs = -1;
    v.verdict.winner = -1;
    v.verdict.second = -1;
    v.verdict.kind = "plain";
    v.verdict.share = 0;
    v.verdict.margin = 0;
    v.verdict.tie = false;
    v.ate = false;
    this.qLen = 0;
    this.sLen = 0;
    this.notesThisStep = 0;
    this.lastKnockNoteMs = -Infinity;
    this.lastSpawnNoteMs = -Infinity;
    this.koThisStep = false;
    this.lastLeader = -1;
    // The balls: every competitor's, in rounds (one ball of every competitor a round, the first one of a round turning from a
    // seeded start) so no competitor always moves first; spread over the free middle (a few seeded tries to keep them apart).
    const f = v.field;
    const radius = landClaimBallRadius(cfg.ballRadius, f.side);
    const radiusScale = radius / (cfg.ballRadius || 8);
    const speed = this.cruise(cfg.ballSpeed);
    const freeR = Math.max(0, f.apothem - f.depth - radius - 2);
    const perTeam = Math.max(1, Math.min(s.balls, Math.floor(LC_BALL_CEILING / v.teams)));
    const first = Math.floor(ctx.random() * v.teams);
    const balls = ctx.getBalls();
    for (let k = 0; k < perTeam; k++) {
      for (let j = 0; j < v.teams; j++) {
        const team = (first + k + j) % v.teams;
        let x = f.cx;
        let y = f.cy;
        for (let attempt = 0; attempt < 6; attempt++) {
          const rr = freeR * Math.sqrt(ctx.random());
          const th = ctx.random() * TWO_PI;
          x = f.cx + rr * Math.cos(th);
          y = f.cy + rr * Math.sin(th);
          let clear = true;
          // (only the last few balls placed are checked: a crowd of thousands starts in O(n), and overlaps resolve at once)
          for (let b = Math.max(0, balls.length - 24); b < balls.length && clear; b++) {
            const dx = balls[b].x - x;
            const dy = balls[b].y - y;
            if (dx * dx + dy * dy < 4.4 * radius * radius) clear = false;
          }
          if (clear) break;
        }
        const heading = ctx.random() * TWO_PI;
        ctx.addBall({ x, y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, radius, radiusScale, color: lcPaletteColor(team), team });
      }
    }
    this.countAlive(ctx);
  }

  /** The cruising speed (px/s) at Ball Speed `ballSpeed`, before a ball's own speed multiplier. */
  private cruise(ballSpeed: number) {
    return ((ballSpeed || 400) / 400) * LC_SPEED * this.view.field.side;
  }

  /** Balls in play per competitor. */
  private countAlive(ctx: ModeContext) {
    const v = this.view;
    v.alive.fill(0);
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) {
      const t = balls[i].team ?? 0;
      if (t >= 0 && t < v.teams) v.alive[t]++;
    }
  }

  /**
   * --- uncap-all --- The fastest a ball may move within the next step when the engine's four sub-steps would let it move
   * more than half its radius in one (a Ball Speed far past the slider): the engine then plans more sub-steps (time dilation
   * past 64), so no ball skips a thin column top. 0 – nothing to plan – while every ball is slower, so those runs replay exactly.
   */
  stepSpeedBound(ctx: ModeContext, stepSec: number): number {
    if (this.view.ate) return 0;
    const balls = ctx.getBalls();
    let bound = 0;
    let need = false;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > bound) bound = sp;
      if (sp * (stepSec / 4) > 0.5 * b.radius) need = true;
    }
    return need && Number.isFinite(bound) ? bound : 0;
  }

  onPreUpdate(ctx: ModeContext) {
    const v = this.view;
    // The rig follows the config (the page may pick a forced winner mid-battle); the seed finder's engines carry it from the start.
    v.forcedWinner = landClaimForcedWinner(ctx.config.forcedWinner, v.teams);
    this.notesThisStep = 0;
    this.koThisStep = false;
    if (!v.ate) this.eatArena(ctx);
  }

  /**
   * --- uncap-all --- A ball as wide as the free middle (a Ball Size far past the slider, a live change) cannot move between
   * the columns: it has eaten the arena – the engine's outgrow finish (everything stops, THE BALL ATE THE ARENA, the gulp).
   * No verdict.
   */
  private eatArena(ctx: ModeContext) {
    const v = this.view;
    const f = v.field;
    const free = f.apothem - v.maxHeight * f.block;
    const balls = ctx.getBalls();
    let eater: Ball | null = null;
    for (let i = 0; i < balls.length; i++) if (balls[i].radius >= free && (!eater || balls[i].radius > eater.radius)) eater = balls[i];
    if (!eater) return;
    v.ate = true;
    eater.x = f.cx;
    eater.y = f.cy;
    ctx.getMultipliers?.().outgrow(ctx, eater, Math.max(1, free));
    for (const b of balls) {
      b.vx = 0;
      b.vy = 0;
    }
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const v = this.view;
    if (v.ate) return;
    void dtSec;
    const team = ball.team !== undefined && ball.team >= 0 && ball.team < v.teams ? ball.team : 0;
    // The cruising speed (a speed multiplier raises it).
    const cruise = this.cruise(ctx.config.ballSpeed) * (ball.mult ? ball.mult.speed : 1);
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 1e-9) {
      ball.vx *= cruise / sp;
      ball.vy *= cruise / sp;
    } else {
      ball.vx = cruise * Math.cos(0.7);
      ball.vy = cruise * Math.sin(0.7);
    }
    const f = v.field;
    // Up to three contacts a sub-step (a corner: a column's side and its neighbour's top); the deepest first.
    for (let pass = 0; pass < 3; pass++) {
      if (!this.contacts(ball.x - f.cx, ball.y - f.cy, ball.radius)) break;
      const nx = this.hitNx;
      const ny = this.hitNy;
      ball.x += nx * (this.hitDepth + 1e-6);
      ball.y += ny * (this.hitDepth + 1e-6);
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn >= 0) continue; // already moving away (a push from a crowd): no rebound
      ball.vx -= 2 * vn * nx;
      ball.vy -= 2 * vn * ny;
      // A small seeded scatter – never back into the surface it left.
      const turn = (2 * ctx.random() - 1) * LC_SCATTER;
      this.turn(ball, turn, nx, ny);
      if (team === v.forcedWinner && !v.finished) this.steer(ball, team, nx, ny);
      v.bounces++;
      ctx.creditBounce?.(ball); // the team stats and bounce math's "bounce" trigger (the mode's own walls)
      if (this.hitCol >= 0 && !v.finished) this.queueKnock(this.hitCol, team, f.cx + this.hitPx, f.cy + this.hitPy, nx, ny);
    }
  }

  /** Turns `ball`'s velocity by `angle` unless that would point it back into the surface of normal (nx, ny). */
  private turn(ball: Ball, angle: number, nx: number, ny: number) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vx = ball.vx * c - ball.vy * s;
    const vy = ball.vx * s + ball.vy * c;
    const sp = Math.hypot(vx, vy);
    if (sp > 0 && (vx * nx + vy * ny) / sp > 0.08) {
      ball.vx = vx;
      ball.vy = vy;
    }
  }

  /**
   * The rig: aims a chosen ball's rebound better – of the headings within `LC_RIG_TURN` of it (never back into the surface it
   * left, never grazing along it), the one whose ray meets the nearest column top that still has land for its competitor;
   * when none of them does, it turns towards the nearest such column round the wall. Honest: it only aims – the ball keeps
   * its speed, the land is taken by hitting it, nothing is taken from the others.
   */
  private steer(ball: Ball, team: number, nx: number, ny: number) {
    const v = this.view;
    const f = v.field;
    const px = ball.x - f.cx;
    const py = ball.y - f.cy;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (!(sp > 0)) return;
    const have = Math.atan2(ball.vy, ball.vx);
    let bestTurn = 0;
    let bestDist = Infinity;
    for (let k = 0; k < LC_RIG_SAMPLES; k++) {
      const turn = -LC_RIG_TURN + (2 * LC_RIG_TURN * k) / (LC_RIG_SAMPLES - 1);
      const ux = Math.cos(have + turn);
      const uy = Math.sin(have + turn);
      if (ux * nx + uy * ny < LC_RIG_MIN_LEAVE) continue;
      const d = this.landAhead(px, py, ux, uy, team);
      if (d < bestDist - 1e-9 || (Math.abs(d - bestDist) <= 1e-9 && Math.abs(turn) < Math.abs(bestTurn))) {
        bestDist = d;
        bestTurn = turn;
      }
    }
    if (bestDist === Infinity) bestTurn = this.towardsLand(px, py, have, team);
    if (bestTurn === 0) return;
    const before = ball.vx;
    this.turn(ball, bestTurn, nx, ny);
    if (ball.vx !== before) v.steers++;
  }

  /**
   * The distance from (px, py) (relative to the centre) along the unit heading (ux, uy) to the top of the column it meets at
   * the wall, when that column still has land for `team` – Infinity when it has none (or the ray meets no wall).
   */
  private landAhead(px: number, py: number, ux: number, uy: number, team: number): number {
    const v = this.view;
    const f = v.field;
    const hit = this.rayToWall(px, py, ux, uy);
    if (hit < 0) return Infinity;
    const col = columnAt(f, Math.atan2(py + uy * hit, px + ux * hit));
    if (col < 0 || !this.hasLandFor(col, team)) return Infinity;
    const level = f.apothem - v.heights[col] * f.block;
    if (f.sides > 0) {
      const k = f.colSide[col];
      const dn = ux * f.sideNx[k] + uy * f.sideNy[k];
      if (dn <= 1e-9) return hit;
      return Math.max(0, (level - (px * f.sideNx[k] + py * f.sideNy[k])) / dn);
    }
    // The circle: |p + t u| = level.
    const b = px * ux + py * uy;
    const disc = b * b - (px * px + py * py - level * level);
    return disc >= 0 ? Math.max(0, -b + Math.sqrt(disc)) : hit;
  }

  /** The turn (radians, at most `LC_RIG_TURN` either way) from heading `have` towards the middle of the top of the nearest column round the wall with land for `team` (0: none, or it is ahead already). */
  private towardsLand(px: number, py: number, have: number, team: number): number {
    const v = this.view;
    const f = v.field;
    const hit = this.rayToWall(px, py, Math.cos(have), Math.sin(have));
    if (hit < 0) return 0;
    const aim = columnAt(f, Math.atan2(py + Math.sin(have) * hit, px + Math.cos(have) * hit));
    if (aim < 0) return 0;
    // The nearest column round the wall with land for this competitor (looking both ways, alternately).
    let target = -1;
    for (let d = 0; d < f.cols && target < 0; d++) {
      const right = (aim + d) % f.cols;
      if (this.hasLandFor(right, team)) target = right;
      else if (d > 0) {
        const left = (aim - d + f.cols) % f.cols;
        if (this.hasLandFor(left, team)) target = left;
      }
    }
    if (target < 0 || target === aim) return 0;
    const k = (f.apothem - v.heights[target] * f.block) / f.apothem;
    const tx = 0.5 * (f.colX0[target] + f.colX1[target]) * k;
    const ty = 0.5 * (f.colY0[target] + f.colY1[target]) * k;
    let delta = Math.atan2(ty - py, tx - px) - have;
    while (delta > Math.PI) delta -= TWO_PI;
    while (delta < -Math.PI) delta += TWO_PI;
    return Math.max(-LC_RIG_TURN, Math.min(LC_RIG_TURN, delta));
  }

  /** Whether column `col` still has land for competitor `team` to take (a block to knock, a free one to claim, a block not its own). */
  private hasLandFor(col: number, team: number): boolean {
    const v = this.view;
    if (v.rule === "knock") return v.heights[col] > 0;
    if (v.rule === "claim") return v.claimTop[col] > 0;
    const base = col * v.rows;
    for (let r = v.rows - 1; r >= 0; r--) if (v.owner[base + r] !== team) return true;
    return false;
  }

  /** The distance from (px, py) along (dx, dy) to the arena's wall (−1 when there is none ahead). */
  private rayToWall(px: number, py: number, dx: number, dy: number): number {
    const f = this.view.field;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) return -1;
    const ux = dx / len;
    const uy = dy / len;
    if (f.sides > 0) {
      let best = Infinity;
      for (let k = 0; k < f.sides; k++) {
        const dn = ux * f.sideNx[k] + uy * f.sideNy[k];
        if (dn <= 1e-9) continue;
        const t = (f.apothem - (px * f.sideNx[k] + py * f.sideNy[k])) / dn;
        if (t >= 0 && t < best) best = t;
      }
      return Number.isFinite(best) ? best : -1;
    }
    // |p + t u| = R
    const b = px * ux + py * uy;
    const c = px * px + py * py - f.apothem * f.apothem;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b + Math.sqrt(disc);
    return t >= 0 ? t : -1;
  }

  /**
   * The deepest overlap of a ball at (px, py) (relative to the centre) of radius `r` with the solid around it – the walls and
   * the columns with blocks near its bearing –, into `hitDepth` / `hitNx` / `hitNy` (towards the ball) / `hitCol` (−1: a
   * wall) / `hitPx` / `hitPy` (the touch point). False when nothing overlaps.
   */
  private contacts(px: number, py: number, r: number): boolean {
    const v = this.view;
    const f = v.field;
    let best = 0;
    this.hitCol = -1;
    // The walls: a polygon's sides, the circle.
    if (f.sides > 0) {
      for (let k = 0; k < f.sides; k++) {
        const nx = f.sideNx[k];
        const ny = f.sideNy[k];
        const dist = f.apothem - (px * nx + py * ny);
        const depth = r - dist;
        if (depth > best) {
          best = depth;
          this.hitNx = -nx;
          this.hitNy = -ny;
          this.hitCol = -1;
          this.hitPx = px + nx * dist;
          this.hitPy = py + ny * dist;
        }
      }
    } else {
      const rho = Math.hypot(px, py);
      const depth = r - (f.apothem - rho);
      if (depth > best && rho > 1e-9) {
        best = depth;
        this.hitNx = -px / rho;
        this.hitNy = -py / rho;
        this.hitCol = -1;
        this.hitPx = (px / rho) * f.apothem;
        this.hitPy = (py / rho) * f.apothem;
      }
    }
    // The columns: none can be touched while the ball keeps clear of the tallest column's top everywhere.
    const top = v.maxHeight * f.block;
    if (top > 0) {
      const rho = Math.hypot(px, py);
      // (a polygon's columns lie beyond its inner polygon, whose inscribed circle has radius apothem − top)
      if (rho + r > f.apothem - top) {
        const span = rho > r ? Math.asin(Math.min(1, r / rho)) : Math.PI;
        if (span >= Math.PI) {
          for (let c = 0; c < f.cols; c++) best = this.columnContact(c, px, py, r, best);
        } else {
          const phi = Math.atan2(py, px);
          const c0 = columnAt(f, phi - span);
          const c1 = columnAt(f, phi + span);
          let c = c0;
          for (let guard = 0; guard <= f.cols; guard++) {
            best = this.columnContact(c, px, py, r, best);
            if (c === c1) break;
            c = c + 1 === f.cols ? 0 : c + 1;
          }
        }
      }
    }
    this.hitDepth = best;
    return best > 0;
  }

  /** Column `c`'s overlap with the ball (see `contacts()`): updates the deepest contact when this one is deeper; returns the deepest depth. */
  private columnContact(c: number, px: number, py: number, r: number, best: number): number {
    const v = this.view;
    const f = v.field;
    const h = v.heights[c] * f.block;
    if (!(h > 0)) return best; // a bare column is the wall
    const u0x = f.colU0x[c];
    const u0y = f.colU0y[c];
    const u1x = f.colU1x[c];
    const u1y = f.colU1y[c];
    const inWedge = u0x * py - u0y * px >= 0 && px * u1y - py * u1x >= 0;
    let dist: number;
    let qx: number;
    let qy: number;
    let nx: number;
    let ny: number;
    if (f.sides > 0) {
      const k = f.colSide[c];
      const sx = f.sideNx[k];
      const sy = f.sideNy[k];
      const level = f.apothem - h;
      const s = px * sx + py * sy;
      if (inWedge && s >= level) {
        // Inside the column: out through its top face.
        dist = level - s;
        qx = px - sx * (s - level);
        qy = py - sy * (s - level);
        nx = -sx;
        ny = -sy;
      } else {
        // The nearest of its top face and its two sides.
        const t0 = level / (u0x * sx + u0y * sy);
        const t1 = level / (u1x * sx + u1y * sy);
        const ax = u0x * t0;
        const ay = u0y * t0;
        const bx = u1x * t1;
        const by = u1y * t1;
        // the top face AB
        const ex = bx - ax;
        const ey = by - ay;
        const e2 = ex * ex + ey * ey;
        let tt = e2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / e2 : 0;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        qx = ax + tt * ex;
        qy = ay + tt * ey;
        let d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        // the side beyond A (outwards along u0) and the side beyond B
        let sa = (px - ax) * u0x + (py - ay) * u0y;
        if (sa > 0) {
          const rx = ax + sa * u0x;
          const ry = ay + sa * u0y;
          const dd = (px - rx) * (px - rx) + (py - ry) * (py - ry);
          if (dd < d2) {
            d2 = dd;
            qx = rx;
            qy = ry;
          }
        }
        sa = (px - bx) * u1x + (py - by) * u1y;
        if (sa > 0) {
          const rx = bx + sa * u1x;
          const ry = by + sa * u1y;
          const dd = (px - rx) * (px - rx) + (py - ry) * (py - ry);
          if (dd < d2) {
            d2 = dd;
            qx = rx;
            qy = ry;
          }
        }
        dist = Math.sqrt(d2);
        if (dist > 1e-9) {
          nx = (px - qx) / dist;
          ny = (py - qy) / dist;
        } else {
          nx = -sx;
          ny = -sy;
        }
      }
    } else {
      const level = f.apothem - h;
      const rho = Math.hypot(px, py);
      if (inWedge) {
        if (rho > 1e-9) {
          nx = -px / rho;
          ny = -py / rho;
        } else {
          const mid = 0.5 * (f.colA0[c] + f.colA1[c]);
          nx = -Math.cos(mid);
          ny = -Math.sin(mid);
        }
        dist = level - rho;
        qx = -nx * level;
        qy = -ny * level;
      } else {
        // The nearer of its two sides (rays from the arc's ends outwards).
        let sa = px * u0x + py * u0y;
        if (sa < level) sa = level;
        let rx = sa * u0x;
        let ry = sa * u0y;
        let d2 = (px - rx) * (px - rx) + (py - ry) * (py - ry);
        qx = rx;
        qy = ry;
        sa = px * u1x + py * u1y;
        if (sa < level) sa = level;
        rx = sa * u1x;
        ry = sa * u1y;
        const dd = (px - rx) * (px - rx) + (py - ry) * (py - ry);
        if (dd < d2) {
          d2 = dd;
          qx = rx;
          qy = ry;
        }
        dist = Math.sqrt(d2);
        if (dist > 1e-9) {
          nx = (px - qx) / dist;
          ny = (py - qy) / dist;
        } else {
          nx = -px / Math.max(1e-9, rho);
          ny = -py / Math.max(1e-9, rho);
        }
      }
    }
    const depth = r - dist;
    if (depth > best) {
      this.hitNx = nx;
      this.hitNy = ny;
      this.hitCol = c;
      this.hitPx = qx;
      this.hitPy = qy;
      return depth;
    }
    return best;
  }

  /** Queues a knock on column `col` by `team` touched at (x, y) (px) – applied at the sub-step's end (`flush()`). */
  private queueKnock(col: number, team: number, x: number, y: number, nx: number, ny: number) {
    if (this.qLen >= this.qCol.length) {
      const size = 2 * this.qCol.length;
      const grow = <T extends Int32Array | Float64Array>(a: T, b: T) => {
        b.set(a);
        return b;
      };
      this.qCol = grow(this.qCol, new Int32Array(size));
      this.qTeam = grow(this.qTeam, new Int32Array(size));
      this.qX = grow(this.qX, new Float64Array(size));
      this.qY = grow(this.qY, new Float64Array(size));
      this.qNx = grow(this.qNx, new Float64Array(size));
      this.qNy = grow(this.qNy, new Float64Array(size));
    }
    const n = this.qLen++;
    this.qCol[n] = col;
    this.qTeam[n] = team;
    this.qX[n] = x;
    this.qY[n] = y;
    this.qNx[n] = nx;
    this.qNy[n] = ny;
  }

  /** After the sub-step's moves: the balls' hits on each other, then the sub-step's knocks in order, then its spawns. */
  onPostSubStep(ctx: ModeContext) {
    if (this.view.ate) return;
    this.collide(ctx);
    this.flush(ctx);
  }

  /** The ball-to-ball hits of a sub-step: elastic, equal masses, the pairs from a spatial hash (deterministic: grid order). */
  private collide(ctx: ModeContext) {
    const v = this.view;
    const balls = ctx.getBalls();
    const n = balls.length;
    if (n < 2) return;
    if (this.xs.length < n) {
      const size = Math.max(n, 2 * this.xs.length);
      this.xs = new Float64Array(size);
      this.ys = new Float64Array(size);
      this.rs = new Float64Array(size);
    }
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      this.xs[i] = b.x;
      this.ys[i] = b.y;
      this.rs[i] = b.radius;
      if (b.radius > maxR) maxR = b.radius;
    }
    if (!(maxR > 0) || !Number.isFinite(maxR)) return;
    const f = v.field;
    const half = f.apothem / Math.cos(f.sides > 0 ? Math.PI / f.sides : 0) + 2 * maxR;
    this.hash.build(this.xs, this.ys, n, 2 * maxR + 1, f.cx - half, f.cy - half, f.cx + half, f.cy + half);
    const count = this.hash.collectContacts(this.xs, this.ys, this.rs, 0, this.pairs);
    const pairs = this.pairs.pairs;
    for (let k = 0; k < count; k++) {
      const a = balls[pairs[2 * k]];
      const b = balls[pairs[2 * k + 1]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.radius + b.radius;
      if (dist >= minDist || dist === 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      // (a ball pushed against the wall stays inside it: the next sub-step's contacts start from there)
      this.keepInside(a);
      this.keepInside(b);
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel > 0) continue;
      a.vx += nx * rel;
      a.vy += ny * rel;
      b.vx -= nx * rel;
      b.vy -= ny * rel;
      v.collisions++;
      ctx.noteCollide?.(a, b); // bounce math's "ball hit" trigger
    }
  }

  /** Moves `ball` back inside the arena's wall when a push left part of it beyond (the columns are the next sub-step's contacts). */
  private keepInside(ball: Ball) {
    const f = this.view.field;
    let px = ball.x - f.cx;
    let py = ball.y - f.cy;
    if (f.sides > 0) {
      for (let k = 0; k < f.sides; k++) {
        const over = px * f.sideNx[k] + py * f.sideNy[k] + ball.radius - f.apothem;
        if (over > 0) {
          px -= f.sideNx[k] * over;
          py -= f.sideNy[k] * over;
        }
      }
    } else {
      const rho = Math.hypot(px, py);
      const room = f.apothem - ball.radius;
      if (rho > room && rho > 1e-9) {
        const k = Math.max(0, room) / rho;
        px *= k;
        py *= k;
      }
    }
    ball.x = f.cx + px;
    ball.y = f.cy + py;
  }

  /** Applies the sub-step's knocks in order (a block two balls reached together goes to the first), then its spawns. */
  private flush(ctx: ModeContext) {
    const now = ctx.getElapsedMs();
    const n = this.qLen;
    this.qLen = 0;
    for (let k = 0; k < n; k++) this.apply(ctx, this.qCol[k], this.qTeam[k], this.qX[k], this.qY[k], this.qNx[k], this.qNy[k], now);
    const m = this.sLen;
    this.sLen = 0;
    for (let k = 0; k < m; k++) this.spawn(ctx, this.sTeam[k], this.sX[k], this.sY[k], this.sNx[k], this.sNy[k]);
  }

  /** One knock: the rule's block of column `col` goes to `team` (a knock, a claim or a steal), with its counts, effects and sounds. */
  private apply(ctx: ModeContext, col: number, team: number, x: number, y: number, nx: number, ny: number, now: number) {
    const v = this.view;
    if (v.finished) return;
    const rows = v.rows;
    let row = -1;
    let gained = false;
    let ko = false;
    if (v.rule === "knock") {
      if (v.heights[col] <= 0) return;
      row = v.heights[col] - 1;
      this.setHeight(col, row);
      v.remaining--;
      gained = true;
      ko = row === 0;
      // The block flies off in the hitter's colour: inwards, spread and spun by a hash of the knock (visual only).
      const h = v.flyHead;
      const spread = (hash01(v.knocks, col) - 0.5) * 1.6;
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const lift = 0.55 + 0.45 * hash01(col, v.knocks + 7);
      v.flyCol[h] = col;
      v.flyRow[h] = row;
      v.flyTeam[h] = team;
      v.flyMs[h] = now;
      v.flyVx[h] = (nx * c - ny * s) * lift;
      v.flyVy[h] = (nx * s + ny * c) * lift;
      v.flySpin[h] = (hash01(col + 3, v.knocks) - 0.5) * 14;
      v.flyHead = (h + 1) % LC_FLY_LOG;
      if (v.flyCount < LC_FLY_LOG) v.flyCount++;
    } else if (v.rule === "claim") {
      if (v.claimTop[col] <= 0) return;
      row = --v.claimTop[col];
      v.owner[col * rows + row] = team;
      v.remaining--;
      gained = true;
      ko = row === 0;
    } else {
      // Steal: the topmost block of the column that is not the hitter's – a free one is claimed, a rival's flips.
      const base = col * rows;
      for (let r = rows - 1; r >= 0; r--) {
        if (v.owner[base + r] !== team) {
          row = r;
          break;
        }
      }
      if (row < 0) return;
      const prev = v.owner[base + row];
      v.owner[base + row] = team;
      if (prev < 0) {
        v.remaining--;
        gained = true;
      } else {
        v.land[prev]--;
        v.lost[prev]++;
        v.stolen[team]++;
        v.steals++;
      }
      // The column is all the hitter's now: taken whole.
      ko = true;
      for (let r = 0; r < rows && ko; r++) if (v.owner[base + r] !== team) ko = false;
    }
    v.land[team]++;
    v.knocks++;
    v.colVersion[col]++;
    if (v.rule !== "knock") {
      const p = v.popHead;
      v.popIdx[p] = col * rows + row;
      v.popTeam[p] = team;
      v.popMs[p] = now;
      v.popHead = (p + 1) % LC_POP_LOG;
      if (v.popCount < LC_POP_LOG) v.popCount++;
    }
    // Every `every`-th block a competitor gains (a steal does not count) adds one more ball of its colour at the knock point.
    if (gained) {
      v.gains[team]++;
      const every = v.settings.every;
      if (every > 0 && v.gains[team] % every === 0) this.queueSpawn(team, x, y, nx, ny);
    }
    // Sounds: the knock's wooden click (pitched by the column), a column's KO.
    if (ko) {
      v.kos++;
      if (!this.koThisStep) {
        this.koThisStep = true;
        v.notes++;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, lcSound: "ko", frequency: knockFrequency(col, v.cols) / 2, accent: v.remaining === 0, melody: false });
      }
    } else if (this.notesThisStep === 0 && now - this.lastKnockNoteMs >= LC_KNOCK_GAP_MS) {
      this.notesThisStep++;
      this.lastKnockNoteMs = now;
      v.notes++;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, lcSound: "knock", frequency: knockFrequency(col, v.cols), level: 0.85, melody: false });
    }
  }

  /** Column `col` now holds `height` blocks (knock): the histogram of heights and the tallest column follow. */
  private setHeight(col: number, height: number) {
    const v = this.view;
    const old = v.heights[col];
    v.heights[col] = height;
    this.heightCount[old]--;
    this.heightCount[height]++;
    while (v.maxHeight > 0 && this.heightCount[v.maxHeight] === 0) v.maxHeight--;
  }

  private queueSpawn(team: number, x: number, y: number, nx: number, ny: number) {
    if (this.sLen >= this.sTeam.length) {
      const size = 2 * this.sTeam.length;
      const grow = <T extends Int32Array | Float64Array>(a: T, b: T) => {
        b.set(a);
        return b;
      };
      this.sTeam = grow(this.sTeam, new Int32Array(size));
      this.sX = grow(this.sX, new Float64Array(size));
      this.sY = grow(this.sY, new Float64Array(size));
      this.sNx = grow(this.sNx, new Float64Array(size));
      this.sNy = grow(this.sNy, new Float64Array(size));
    }
    const n = this.sLen++;
    this.sTeam[n] = team;
    this.sX[n] = x;
    this.sY[n] = y;
    this.sNx[n] = nx;
    this.sNy[n] = ny;
  }

  /** A new ball of `team` at the knock point (x, y), off the wall within `LC_SPAWN_SPREAD` of its inward normal (nx, ny) – or ARENA FULL at the ball ceiling. */
  private spawn(ctx: ModeContext, team: number, x: number, y: number, nx: number, ny: number) {
    const v = this.view;
    const balls = ctx.getBalls();
    if (balls.length >= LC_BALL_CEILING) {
      v.spawnsRefused++;
      ctx.noteArenaFull?.();
      return;
    }
    const cfg = ctx.config;
    const radius = landClaimBallRadius(cfg.ballRadius, v.field.side);
    const angle = Math.atan2(ny, nx) + (2 * ctx.random() - 1) * LC_SPAWN_SPREAD;
    const speed = this.cruise(cfg.ballSpeed);
    ctx.addBall({
      x: x + nx * (radius + 0.5),
      y: y + ny * (radius + 0.5),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      radiusScale: radius / (cfg.ballRadius || 8),
      color: lcPaletteColor(team),
      team,
    });
    v.spawns++;
    v.spawned[team]++;
    v.alive[team]++;
    const now = ctx.getElapsedMs();
    if (now - this.lastSpawnNoteMs >= LC_SPAWN_GAP_MS) {
      this.lastSpawnNoteMs = now;
      v.notes++;
      const ev: SoundEvent = { type: "hit", wallIndex: 0, lcSound: "spawn", frequency: spawnFrequency(team), melody: false };
      ctx.addPendingSoundEvent(ev);
    }
  }

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    if (v.ate) return;
    const now = ctx.getElapsedMs();
    this.countAlive(ctx);
    if (v.finished) return;
    // The leader (−1 on a level top), its changes, and whether the top two are within LC_CLOSE of the land so far.
    let best = -1;
    let level = false;
    let total = 0;
    for (let t = 0; t < v.teams; t++) {
      total += v.land[t];
      if (best < 0 || v.land[t] > v.land[best]) {
        best = t;
        level = false;
      } else if (v.land[t] === v.land[best]) level = true;
    }
    let second = 0;
    for (let t = 0; t < v.teams; t++) if (t !== best && v.land[t] > second) second = v.land[t];
    const leader = level ? -1 : best;
    if (leader >= 0 && this.lastLeader >= 0 && leader !== this.lastLeader) v.leadChanges++;
    if (leader >= 0) this.lastLeader = leader;
    v.leader = leader;
    v.close = total >= 8 && best >= 0 && (v.land[best] - second) / total <= LC_CLOSE;
    const done = v.rule !== "steal" && v.remaining <= 0;
    if (done || now >= v.durationMs - 1e-6) this.finish(ctx, now);
  }

  /** The run is over: the verdict, the credits the teams banner and the finder rank it by, the final sound. */
  private finish(ctx: ModeContext, now: number) {
    const v = this.view;
    v.finished = true;
    v.finishedMs = now;
    landClaimVerdict(v.land, v.teams, v.forcedWinner, v.alive, v.verdict);
    // The team stats (the first MAX_TEAMS competitors): the land as "walls" (the scoreboard ranks the rest by them), the
    // winner an "escape" (the win).
    const balls = ctx.getBalls();
    const teams = Math.min(v.teams, MAX_TEAMS);
    for (let team = 0; team < teams; team++) {
      let rep: Ball | null = null;
      for (let i = 0; i < balls.length && !rep; i++) if (balls[i].team === team) rep = balls[i];
      if (!rep) continue;
      for (let k = 0; k < v.land[team]; k++) ctx.creditWallBreak?.(rep);
      if (team === v.verdict.winner) ctx.creditEscape?.(rep);
    }
    v.notes++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, lcSound: "ko", frequency: spawnFrequency(Math.max(0, v.verdict.winner)) / 2, accent: true, melody: false });
  }

  onWallHit() {
    return undefined;
  }

  onGapPass() {
    return true;
  }

  /**
   * A resize: the arena follows the centred square. The engine stretched the balls with the canvas (x and y apart), so each
   * ball is put back where it was in the old arena and mapped onto the new one by the apothem – with its speed and size scaled
   * alike (its size stays relative to the Ball Size through `radiusScale`).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const v = this.view;
    const old = v.field;
    const next = landClaimField(ctx.config.width, ctx.config.height, old.arena, old.cols, old.rows);
    const k = old.apothem > 0 ? next.apothem / old.apothem : 1;
    const sx = next.width > 0 ? old.width / next.width : 1;
    const sy = next.height > 0 ? old.height / next.height : 1;
    for (const b of ctx.getBalls()) {
      const ox = old.width / 2 + (b.x - next.width / 2) * sx;
      const oy = old.height / 2 + (b.y - next.height / 2) * sy;
      b.x = next.cx + (ox - old.cx) * k;
      b.y = next.cy + (oy - old.cy) * k;
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
    return { teams: v.teams, land: Array.from(v.land), remaining: v.remaining, knocks: v.knocks, spawns: v.spawns, winner: v.verdict.winner, verdict: v.verdict.kind, finished: v.finished };
  }
}
