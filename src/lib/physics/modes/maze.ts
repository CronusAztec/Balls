import { midiToFrequency } from "@/lib/audio/scales";
import { MAX_TEAMS } from "../ballStats";
import { shiftedObstacleFrequency } from "../bounceMathRuntime";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all --- no maximum, the memory-safety ceilings only
import type { Ball, GameMode, ModeContext } from "../types";
import {
  MZ_BIT,
  MZ_DX,
  MZ_DY,
  MZ_E,
  MZ_GAP_ENTRANCE,
  MZ_GAP_EXIT,
  MZ_MICRO_STEP,
  MZ_N,
  MZ_S,
  MZ_W,
  buildMazeField,
  clampIntoMazeCell,
  emptyMazeContact,
  explorerChoice,
  explorerExhausted,
  generateMaze,
  mazeBallRadius,
  mazeDirection,
  mazeExitsOf,
  mazeRowsFor,
  resolveMazeCell,
  shortestChoice,
  wallFollowChoice,
  type MazeField,
  type MazeGrid,
} from "../mazeGrid";

/**
 * Maze escape ("maze" mode, battle family – feature odd-maze): oddplayground's maze reels – a green-walled maze on
 * near-black with a red entrance slot in its top wall and an exit gap in its bottom wall, balls working their way through
 * and leaving a red trail ("who else thought that was blood").
 *
 *  - **The maze** is a seeded perfect maze (mazeGrid.ts: the recursive backtracker on the engine's RNG), `cols` columns
 *    and as many rows as the portrait field holds (`mazeRowsFor()`), fitted into the square the recorder crops to. Its BFS
 *    distance map to the exit is computed once at init.
 *  - **The balls** (1–8; the Teams roster colours and names the first six) queue in a chute above the entrance and drop in
 *    one after another. They move physically – the mode's own downward pull (`gravity`, in field heights per s²), elastic
 *    walls (restitution 1) – in micro-steps against the walls of the cell each one is in (`resolveMazeCell()`), so none
 *    ever tunnels, at any speed. They fly through each other (`ballsPassThrough`): corridors are one ball wide.
 *  - **The brains** steer by nudging the velocity when a ball crosses the centre of a cell (the centre line across the
 *    direction it came in): `bounce` never steers (pure physics, a small seeded scatter at each bounce), `wallFollow`
 *    keeps a hand on the wall (left, right, or alternating per ball) and `explorer` prefers the cells it has not visited
 *    yet, a depth-first search over its own visited set. A nudge points the ball at the chosen passage with a seeded
 *    scatter, so it ricochets off the corridor walls on its way – every bounce is a note.
 *  - **Sound**: every wall hit plays a note whose pitch follows the BFS distance of the ball's cell to the exit
 *    (`mazeNoteFrequency()`: a pentatonic ladder, the lowest note at the entrance), so the melody climbs as a ball closes
 *    in on the way out. Ordinary "hit" events: melodies, instruments, hit samples, the beat lock and the music bed apply.
 *  - **The race**: the first ball through the exit wins (an escape in the team stats, the wall-break sound, a shake);
 *    the others keep going until every ball is out or the clip limit (`duration`) – then the ball closest to the exit
 *    wins if none got out. The run finishes `MZ_FINISH_HOLD_MS` after that, so the banner stays in the clip.
 *  - **The rig**: the forced winner (`config.forcedWinner`) steers along the shortest path whatever the brain, a touch
 *    faster, and the exit stays closed to the others until it is out – the win is certain.
 *
 * Everything random – the maze, the spawn, every nudge's scatter, the explorer's picks – comes from `ctx.random()`, so a
 * seed replays exactly and Find Simulation can search it (by length or by winner).
 */

export const MZ_BRAINS = ["bounce", "wallFollow", "explorer"] as const;
export type MazeBrain = (typeof MZ_BRAINS)[number];
export const MZ_HANDS = ["left", "right", "alternate"] as const;
export type MazeHand = (typeof MZ_HANDS)[number];

export function isMazeBrain(value: unknown): value is MazeBrain {
  return typeof value === "string" && (MZ_BRAINS as readonly string[]).includes(value);
}
export function isMazeHand(value: unknown): value is MazeHand {
  return typeof value === "string" && (MZ_HANDS as readonly string[]).includes(value);
}

export interface MazeSettings {
  /** Columns of the maze, 6–40 on the slider, any number from 6 typed (the rows follow from the portrait field). */
  cols: number;
  /** Balls in the maze, 1–8 on the slider, any number from 1 typed. */
  balls: number;
  brain: MazeBrain;
  /** The wall follower's hand: left, right, or alternating per ball. */
  hand: MazeHand;
  /** 0–1: the downward pull. */
  gravity: number;
  /** 0.25–3: how fast the balls travel. */
  speed: number;
  /** 0–1: opacity of the painted trail (0 = none). */
  trail: number;
  /** The trail's colour ("blood" red by default) … */
  trailColor: string;
  /** … or every ball paints in its own colour. */
  trailOwn: boolean;
  /** 0–1: fog over the cells no ball has visited (a clear circle travels with every ball). */
  fog: number;
  wallColor: string;
  /** Seconds the run lasts at most (then the ball nearest the exit wins if none got out). */
  duration: number;
  /** The "FLASHING LIGHTS – THE END GETS INTENSE" badge. */
  badge: boolean;
  /** The HUD: a distance-to-exit bar per ball. */
  hud: boolean;
}

export const DEFAULT_MAZE_SETTINGS: MazeSettings = {
  cols: 12,
  balls: 3,
  brain: "explorer",
  hand: "alternate",
  gravity: 0.35,
  speed: 1,
  trail: 0.85,
  trailColor: "#e0202e",
  trailOwn: false,
  fog: 0,
  wallColor: "#2ecc71",
  duration: 60,
  badge: true,
  hud: true,
};

/**
 * Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`: comfort ranges
 * (uncap-all, lib/uncap.ts) – a value past a slider is kept as typed; the columns and the balls a run builds stop at their
 * memory-safety ceilings (`MEMORY_CEILINGS`).
 */
export const MAZE_RANGES = {
  mzCols: { min: 6, max: 40, step: 1 },
  mzBalls: { min: 1, max: 8, step: 1 },
  mzGravity: { min: 0, max: 1, step: 0.05 },
  mzSpeed: { min: 0.25, max: 3, step: 0.05 },
  mzTrail: { min: 0, max: 1, step: 0.05 },
  mzFog: { min: 0, max: 1, step: 0.05 },
  mzDuration: { min: 10, max: 180, step: 5 },
} as const;

/** The Maze fields of the SimulatorSettings object (URL keys mzc, mzn, mzb, mzh, mzg, mzs, mzt, mztc, mzto, mzf, mzwc, mzd, mzbg, mzhud). */
export interface MazeSettingFields {
  mzCols: number;
  mzBalls: number;
  mzBrain: MazeBrain;
  mzHand: MazeHand;
  mzGravity: number;
  mzSpeed: number;
  mzTrail: number;
  mzTrailColor: string;
  mzTrailOwn: boolean;
  mzFog: number;
  mzWallColor: string;
  mzDuration: number;
  mzBadge: boolean;
  mzHud: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Snaps onto a slider step (and cleans the float noise). */
function snap(value: number, step: number, min: number) {
  return Math.round(1e6 * (min + Math.round((value - min) / step) * step)) / 1e6;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Fills in the defaults and validates every value (counts whole, the rest on their slider steps; a value below its slider
 * is lifted onto it, a value past it kept – uncap-all, no maximum); the columns and the balls stop at their memory-safety
 * ceilings (`MEMORY_CEILINGS`, lib/uncap.ts: the most a run builds – the cells' arrays, a paint-mask bit per ball). A trail
 * or fog past 1 draws fully opaque. Unknown options, bad colours and non-boolean flags fall back.
 */
export function resolveMazeSettings(config: Partial<MazeSettings> | null | undefined): MazeSettings {
  const out = { ...DEFAULT_MAZE_SETTINGS };
  if (!config) return out;
  const R = MAZE_RANGES;
  if (config.cols !== undefined) out.cols = memoryCeiling("mzCols", Math.round(clampNumber(config.cols, R.mzCols, out.cols)));
  if (config.balls !== undefined) out.balls = memoryCeiling("mzBalls", Math.round(clampNumber(config.balls, R.mzBalls, out.balls)));
  if (isMazeBrain(config.brain)) out.brain = config.brain;
  if (isMazeHand(config.hand)) out.hand = config.hand;
  if (config.gravity !== undefined) out.gravity = snap(clampNumber(config.gravity, R.mzGravity, out.gravity), R.mzGravity.step, R.mzGravity.min);
  if (config.speed !== undefined) out.speed = snap(clampNumber(config.speed, R.mzSpeed, out.speed), R.mzSpeed.step, R.mzSpeed.min);
  if (config.trail !== undefined) out.trail = snap(clampNumber(config.trail, R.mzTrail, out.trail), R.mzTrail.step, R.mzTrail.min);
  if (isHexColor(config.trailColor)) out.trailColor = config.trailColor.toLowerCase();
  if (typeof config.trailOwn === "boolean") out.trailOwn = config.trailOwn;
  if (config.fog !== undefined) out.fog = snap(clampNumber(config.fog, R.mzFog, out.fog), R.mzFog.step, R.mzFog.min);
  if (isHexColor(config.wallColor)) out.wallColor = config.wallColor.toLowerCase();
  if (config.duration !== undefined) out.duration = snap(clampNumber(config.duration, R.mzDuration, out.duration), R.mzDuration.step, R.mzDuration.min);
  if (typeof config.badge === "boolean") out.badge = config.badge;
  if (typeof config.hud === "boolean") out.hud = config.hud;
  return out;
}

/** Picks the Maze settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setMazeSettings()`. */
export function mazeSettingsOf(source: MazeSettingFields): MazeSettings {
  return {
    cols: source.mzCols,
    balls: source.mzBalls,
    brain: source.mzBrain,
    hand: source.mzHand,
    gravity: source.mzGravity,
    speed: source.mzSpeed,
    trail: source.mzTrail,
    trailColor: source.mzTrailColor,
    trailOwn: source.mzTrailOwn,
    fog: source.mzFog,
    wallColor: source.mzWallColor,
    duration: source.mzDuration,
    badge: source.mzBadge,
    hud: source.mzHud,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function mazeSettingFields(settings: MazeSettings): MazeSettingFields {
  return {
    mzCols: settings.cols,
    mzBalls: settings.balls,
    mzBrain: settings.brain,
    mzHand: settings.hand,
    mzGravity: settings.gravity,
    mzSpeed: settings.speed,
    mzTrail: settings.trail,
    mzTrailColor: settings.trailColor,
    mzTrailOwn: settings.trailOwn,
    mzFog: settings.fog,
    mzWallColor: settings.wallColor,
    mzDuration: settings.duration,
    mzBadge: settings.badge,
    mzHud: settings.hud,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

/** The defaults of the feature's fields. */
export function defaultMazeFields(): MazeSettingFields {
  return mazeSettingFields(DEFAULT_MAZE_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike): valid numbers on their steps (no maximum), known options, real colours and booleans. */
export function resolveMazeFields(source: Partial<MazeSettingFields>): MazeSettingFields {
  return mazeSettingFields(
    resolveMazeSettings({
      cols: source.mzCols,
      balls: source.mzBalls,
      brain: source.mzBrain,
      hand: source.mzHand,
      gravity: source.mzGravity,
      speed: source.mzSpeed,
      trail: source.mzTrail,
      trailColor: source.mzTrailColor,
      trailOwn: source.mzTrailOwn,
      fog: source.mzFog,
      wallColor: source.mzWallColor,
      duration: source.mzDuration,
      badge: source.mzBadge,
      hud: source.mzHud,
    }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { mzc: "mzCols", mzn: "mzBalls", mzg: "mzGravity", mzs: "mzSpeed", mzt: "mzTrail", mzf: "mzFog", mzd: "mzDuration" } as const;
const BOOLEAN_KEYS = { mzto: "mzTrailOwn", mzbg: "mzBadge", mzhud: "mzHud" } as const;
const COLOR_KEYS = { mztc: "mzTrailColor", mzwc: "mzWallColor" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL. */
export function writeMazeParams(settings: MazeSettingFields, base: MazeSettingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.mzBrain !== base.mzBrain) params.set("mzb", settings.mzBrain);
  if (settings.mzHand !== base.mzHand) params.set("mzh", settings.mzHand);
  for (const [key, field] of Object.entries(COLOR_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field]);
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readMazeParams(params: URLSearchParams, settings: MazeSettingFields) {
  const next: Partial<MazeSettingFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const brain = params.get("mzb");
  if (isMazeBrain(brain)) next.mzBrain = brain;
  const hand = params.get("mzh");
  if (isMazeHand(hand)) next.mzHand = hand;
  for (const [key, field] of Object.entries(COLOR_KEYS)) {
    const raw = params.get(key);
    if (isHexColor(raw)) next[field] = raw;
  }
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveMazeFields(next));
}

/* ------------------------------------------------------------------ constants */

/** The default palette (colour and name per ball) without a team roster: neon on near-black. */
export const MZ_PALETTE: readonly { name: string; color: string }[] = [
  { name: "SNOW", color: "#f5f7ff" },
  { name: "AQUA", color: "#22e4ff" },
  { name: "HOTPINK", color: "#ff2d95" },
  { name: "SUN", color: "#ffc61a" },
  { name: "VIOLET", color: "#a45bff" },
  { name: "ACID", color: "#b6ff1a" },
  { name: "CORAL", color: "#ff7a45" },
  { name: "ICE", color: "#9fd8ff" },
];
/** Cruising speed at Speed 1, in field widths per second. */
export const MZ_SPEED_BASE = 0.62;
/** The pull at Gravity 1, in field heights per second². */
export const MZ_GRAVITY_BASE = 1.6;
/** No ball flies faster than this many times its cruising speed (a long fall, a climb boost). */
export const MZ_MAX_SPEED = 4;
/** A steered ball slower than this share of its cruising speed picks up speed again (by `MZ_RECOVER` per second). */
export const MZ_MIN_SPEED = 0.5;
export const MZ_RECOVER = 1.5;
/** Largest random turn (radians) of a nudge: the ball ricochets down the corridor it was pointed at. */
export const MZ_STEER_SCATTER = 0.42;
/** Largest random turn (radians) of a pure-physics bounce: keeps a ball out of periodic orbits between square walls. */
export const MZ_BOUNCE_SCATTER = 0.12;
/** A ball steered upward gets the speed to climb this many cells' worth of height (against the pull). */
export const MZ_CLIMB = 1.3;
/** A contact counts as a hit (a note, a glow, a bounce in the stats) from this share of the cruising speed along its normal. */
export const MZ_HIT_MIN = 0.18;
/** Notes of one ball at least this far apart, of all balls this far apart (simulation ms). */
export const MZ_NOTE_GAP_MS = 150;
export const MZ_NOTE_GLOBAL_GAP_MS = 55;
/** The balls drop into the maze this far apart (simulation ms). */
export const MZ_RELEASE_MS = 260;
/** An escaped ball falls out of sight for this long before it leaves the engine (simulation ms). */
export const MZ_EXIT_FALL_MS = 900;
/** The run finishes this long after its end (every ball out, or the clip limit), with the banner on screen (simulation ms). */
export const MZ_FINISH_HOLD_MS = 2500;
/** The rig's forced winner cruises this much faster. */
export const MZ_RIG_SPEED = 1.1;
/** More micro-steps than this per sub-step and the ball is slowed down instead (a safety net: nothing tunnels). */
export const MZ_MAX_MICRO_STEPS = 48;
/** Wall hits kept for the canvas glow. */
export const MZ_HIT_LOG = 48;
/** The pentatonic ladder of the wall notes (C4 at the entrance's distance … A6 at the exit); the ToneGenerator snaps it to the chosen scale. */
export const MZ_NOTE_STEPS = 15;
const PENTATONIC = [0, 2, 4, 7, 9];

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

/** MIDI note of ladder step `k` (0 … MZ_NOTE_STEPS − 1): C major pentatonic up from C4. */
export function mazeNoteMidi(k: number): number {
  const i = Math.max(0, Math.min(MZ_NOTE_STEPS - 1, Math.round(k)));
  return 60 + 12 * Math.floor(i / 5) + PENTATONIC[i % 5];
}

/** The pitch (Hz) of a wall hit `dist` passages from the exit when the entrance is `entranceDist` away: rises toward the exit. */
export function mazeNoteFrequency(dist: number, entranceDist: number): number {
  const span = Math.max(1, entranceDist);
  const t = 1 - Math.max(0, Math.min(1, dist / span));
  return midiToFrequency(mazeNoteMidi(t * (MZ_NOTE_STEPS - 1)));
}

/** How far a ball has come (0 at the entrance's distance or beyond … 1 at the exit): the HUD's bar. */
export function mazeProgress(dist: number, entranceDist: number): number {
  if (dist < 0) return 0;
  return 1 - Math.max(0, Math.min(1, dist / Math.max(1, entranceDist)));
}

/** The palette name of ball `slot` (SNOW, AQUA…): the name it goes by without a team roster. */
export function mazeBallName(slot: number): string {
  const n = MZ_PALETTE.length;
  return MZ_PALETTE[((Math.round(slot) % n) + n) % n].name;
}

/** The effective forced winner of a maze of `balls` balls: the rigged slot when it plays (a team slot, two balls or more), else −1. */
export function mazeForcedWinner(forcedWinner: number | undefined, balls: number): number {
  const w = forcedWinner ?? -1;
  return balls >= 2 && Number.isInteger(w) && w >= 0 && w < Math.min(balls, MAX_TEAMS) ? w : -1;
}

/** The wall follower's hand of ball `slot`. */
export function mazeHandOf(hand: MazeHand, slot: number): "left" | "right" {
  return hand === "alternate" ? (slot % 2 === 0 ? "left" : "right") : hand;
}

/* ------------------------------------------------------------------ state and view */

export interface MazeRunner {
  slot: number;
  /** The engine ball's id. */
  id: number;
  /** Palette colour (the canvas uses the team roster's when one is set). */
  color: string;
  /** Its team slot (the first six balls), −1 beyond. */
  team: number;
  /** The brain it steers with (the rig's forced winner: "shortest"). */
  brain: MazeBrain | "shortest";
  hand: "left" | "right";
  /** The cell its centre is in: column and row (row −1: the entrance chute). */
  col: number;
  row: number;
  /** Direction (0–3) it entered its cell in; the steering decides once it crosses the cell's centre line across it. */
  heading: number;
  decided: boolean;
  /** Fully inside the maze: the entrance is closed behind it. */
  entered: boolean;
  /** Simulation time (ms) it drops into the maze, and whether it has. */
  releaseMs: number;
  released: boolean;
  exited: boolean;
  /** Simulation time (ms) it got out, −1 while it is in; its finishing place (1 = first), 0 while it is in. */
  exitMs: number;
  place: number;
  /** Its ball left the engine (after the fall out of sight). */
  gone: boolean;
  /** Passages from its cell to the exit (the entrance's + 1 in the chute, 0 once out), and the least so far. */
  dist: number;
  best: number;
  /** Position after its last move (px). */
  x: number;
  y: number;
  radius: number;
  /** Wall hits and cells visited. */
  hits: number;
  visited: number;
  lastNoteMs: number;
}

/** A wall hit for the canvas glow: the cell (−1 the chute), the wall (0–3 an edge, 4 a post) and the time (simulation ms). */
export interface MazeHit {
  cell: number;
  col: number;
  row: number;
  dir: number;
  x: number;
  y: number;
  t: number;
}

export interface MazeView {
  /** The settings of the last init, with the display fields and the physics (gravity, speed) applied at once. */
  settings: MazeSettings;
  /** Incremented by every init (a new maze). */
  generation: number;
  grid: MazeGrid;
  field: MazeField;
  /** The canvas size the field was built for. */
  width: number;
  height: number;
  count: number;
  /** Balls that play for a team (the first six). */
  teamCount: number;
  runners: MazeRunner[];
  /** Cells any ball has visited (1 each), and how many. */
  visitedAny: Uint8Array;
  visitedCells: number;
  /**
   * Paint strokes, three ints each – the cell, the cell it came from (−1: the chute) and the ball's slot – in the order
   * they happened; a stroke is added only when a ball paints a cell or a passage it had not painted yet, so the list stays
   * bounded. `paintCount` strokes are valid.
   */
  paint: Int32Array;
  paintCount: number;
  /** Recent wall hits (a ring of `MZ_HIT_LOG`; `hitCount` ever). */
  hits: MazeHit[];
  hitCount: number;
  /** The entrance's distance to the exit (the HUD's full bar, the lowest note). */
  entranceDist: number;
  /** Balls out so far. */
  exited: number;
  /** The winning slot (−1 while nobody won), how (the first through the exit, or the nearest at the clip limit) and when. */
  winner: number;
  verdict: "" | "exit" | "time";
  verdictMs: number;
  /** When every ball was out or the clip limit came (−1 before), and the run's finish after the hold. */
  endMs: number;
  finished: boolean;
  finishedMs: number;
  /** The rig's forced winner (−1 off) and the times its seal turned a rival back at the exit. */
  forcedWinner: number;
  sealed: number;
  /** Notes queued and hits counted. */
  notes: number;
  contacts: number;
  /** Slow-motion requests (the first ball at the exit) and shakes (the winner out). */
  slowMos: number;
  impacts: number;
  /** A ball left the maze other than through the exit (the tests' containment check; always 0). */
  leaks: number;
}

function createView(): MazeView {
  const grid = generateMaze(6, mazeRowsFor(6), () => 0.5);
  return {
    settings: { ...DEFAULT_MAZE_SETTINGS },
    generation: 0,
    grid,
    field: buildMazeField(800, 600, grid.cols, grid.rows),
    width: 800,
    height: 600,
    count: 0,
    teamCount: 0,
    runners: [],
    visitedAny: new Uint8Array(grid.cells),
    visitedCells: 0,
    paint: new Int32Array(768),
    paintCount: 0,
    hits: [],
    hitCount: 0,
    entranceDist: grid.dist[grid.entranceCell],
    exited: 0,
    winner: -1,
    verdict: "",
    verdictMs: -1,
    endMs: -1,
    finished: false,
    finishedMs: -1,
    forcedWinner: -1,
    sealed: 0,
    notes: 0,
    contacts: 0,
    slowMos: 0,
    impacts: 0,
    leaks: 0,
  };
}

/* ------------------------------------------------------------------ the mode */

export class MazeMode implements GameMode {
  readonly name = "maze" as const;
  /** The mode keeps its balls' speeds itself (no engine slow-ball boost). */
  readonly ballsMayRest = true;
  /** Corridors are one ball wide: the balls fly through each other. */
  readonly ballsPassThrough = true;
  private settings: MazeSettings = { ...DEFAULT_MAZE_SETTINGS };
  private readonly view: MazeView = createView();
  /** The engine ball id of the first runner (the runners' ids follow). */
  private firstId = 0;
  /** Per runner: the cells it entered (its `visited` count). */
  private visited: Uint8Array[] = [];
  /**
   * Per runner: the explorer's depth-first search – the cells it explored (decided in: it reached their centre line, so a
   * cell it only bounced into and out of stays unexplored and is tried again) and its path from the root of the search.
   */
  private explored: Uint8Array[] = [];
  private path: Int32Array[] = [];
  private pathLen: number[] = [];
  /** Per cell: the slots that painted it, and the slots that painted its passage east / south (a bit per ball: 32 at most). */
  private paintedCell = new Uint32Array(0);
  private paintedEast = new Uint32Array(0);
  private paintedSouth = new Uint32Array(0);
  private paintedChute = 0;
  private lastNoteMs = -Infinity;
  private readonly contact = emptyMazeContact();
  /** The engine's seeded generator for the explorer's picks (bound once per init: no closure per decision). */
  private random: () => number = () => 0;

  getSettings(): MazeSettings {
    return { ...this.settings };
  }

  /**
   * Columns, balls, brain, hand and the clip limit apply on the next init; the pull, the speed and the drawing at once.
   * (--- uncap-all --- past the sliders as typed; the columns and the balls up to their memory-safety ceilings.)
   */
  setSettings(patch: Partial<MazeSettings>) {
    this.settings = resolveMazeSettings({ ...this.settings, ...patch });
    const live = this.view.settings;
    live.gravity = this.settings.gravity;
    live.speed = this.settings.speed;
    live.trail = this.settings.trail;
    live.trailColor = this.settings.trailColor;
    live.trailOwn = this.settings.trailOwn;
    live.fog = this.settings.fog;
    live.wallColor = this.settings.wallColor;
    live.badge = this.settings.badge;
    live.hud = this.settings.hud;
  }

  /** Live maze state for the canvas and the HUD; the same object every call. */
  getView(): MazeView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return { count: v.count, exited: v.exited, winner: v.winner, verdict: v.verdict, finished: v.finished, cells: v.grid.cells, visited: v.visitedCells, notes: v.notes };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s };
    v.generation++;
    const cfg = ctx.config;
    const rows = mazeRowsFor(s.cols);
    const grid = generateMaze(s.cols, rows, () => ctx.random());
    v.grid = grid;
    v.width = cfg.width;
    v.height = cfg.height;
    buildMazeField(cfg.width, cfg.height, grid.cols, grid.rows, v.field);
    v.count = s.balls;
    v.teamCount = Math.min(s.balls, MAX_TEAMS);
    v.runners.length = 0;
    if (v.visitedAny.length !== grid.cells) v.visitedAny = new Uint8Array(grid.cells);
    else v.visitedAny.fill(0);
    v.visitedCells = 0;
    v.paintCount = 0;
    v.hits.length = 0;
    v.hitCount = 0;
    v.entranceDist = Math.max(1, grid.dist[grid.entranceCell]);
    v.exited = 0;
    v.winner = -1;
    v.verdict = "";
    v.verdictMs = -1;
    v.endMs = -1;
    v.finished = false;
    v.finishedMs = -1;
    v.forcedWinner = mazeForcedWinner(cfg.forcedWinner, s.balls);
    v.sealed = 0;
    v.notes = 0;
    v.contacts = 0;
    v.slowMos = 0;
    v.impacts = 0;
    v.leaks = 0;
    this.paintedCell = new Uint32Array(grid.cells);
    this.paintedEast = new Uint32Array(grid.cells);
    this.paintedSouth = new Uint32Array(grid.cells);
    this.paintedChute = 0;
    this.lastNoteMs = -Infinity;
    this.random = () => ctx.random();
    this.visited = [];
    this.explored = [];
    this.path = [];
    this.pathLen = [];
    const f = v.field;
    const radius = mazeBallRadius(cfg.ballRadius, f.cell);
    this.firstId = ctx.getNextId();
    for (let i = 0; i < s.balls; i++) {
      // Queued in the chute above the entrance, a little apart; each drops in at its release time.
      const x = f.left + (grid.entranceCol + 0.5) * f.cell + (2 * ctx.random() - 1) * 0.12 * f.cell;
      const y = f.top - 0.5 * f.cell;
      const color = MZ_PALETTE[i % MZ_PALETTE.length].color;
      const team = i < MAX_TEAMS ? i : -1;
      ctx.addBall({ x, y, vx: 0, vy: 0, radius, gravityScale: 0, color, ...(team >= 0 ? { team } : {}) });
      v.runners.push({
        slot: i,
        id: this.firstId + i,
        color,
        team,
        brain: i === v.forcedWinner ? "shortest" : s.brain,
        hand: mazeHandOf(s.hand, i),
        col: grid.entranceCol,
        row: -1,
        heading: MZ_S,
        decided: true,
        entered: false,
        releaseMs: i * MZ_RELEASE_MS,
        released: false,
        exited: false,
        exitMs: -1,
        place: 0,
        gone: false,
        dist: v.entranceDist + 1,
        best: v.entranceDist + 1,
        x,
        y,
        radius,
        hits: 0,
        visited: 0,
        lastNoteMs: -Infinity,
      });
      this.visited.push(new Uint8Array(grid.cells));
      this.explored.push(new Uint8Array(grid.cells));
      this.path.push(new Int32Array(grid.cells + 1));
      this.pathLen.push(0);
    }
  }

  private runnerOf(ball: Ball): MazeRunner | null {
    const r = this.view.runners[ball.id - this.firstId];
    return r && r.id === ball.id ? r : null;
  }

  /** Cruising speed (px/s) of a runner: field widths per second × Speed (× the rig's edge, × a speed multiplier). */
  private cruise(r: MazeRunner, ball: Ball): number {
    const v = this.view;
    const base = MZ_SPEED_BASE * v.field.width * v.settings.speed;
    return base * (r.slot === v.forcedWinner ? MZ_RIG_SPEED : 1) * (ball.mult ? ball.mult.speed : 1);
  }

  private gravity(): number {
    return MZ_GRAVITY_BASE * this.view.field.height * this.view.settings.gravity;
  }

  /** Whether the exit is open to `r`: always, but while the rig's forced winner is still in only to it. */
  private exitOpenFor(r: MazeRunner): boolean {
    const w = this.view.forcedWinner;
    return w < 0 || r.slot === w || this.view.runners[w]?.exited === true;
  }

  private gapsOf(r: MazeRunner): number {
    return (r.entered ? 0 : MZ_GAP_ENTRANCE) | (this.exitOpenFor(r) ? MZ_GAP_EXIT : 0);
  }

  onPreUpdate(ctx: ModeContext) {
    const v = this.view;
    // The rig follows the config (the page may pick a forced winner mid-run); the seed finder's engines carry it from the start.
    const rig = mazeForcedWinner(ctx.config.forcedWinner, v.count);
    if (rig !== v.forcedWinner) {
      v.forcedWinner = rig;
      for (const r of v.runners) r.brain = r.slot === rig ? "shortest" : v.settings.brain;
    }
    // The Ball Size follows live, at most the share of a cell that keeps the corridors open.
    const radius = mazeBallRadius(ctx.config.ballRadius, v.field.cell);
    const now = ctx.getElapsedMs();
    for (const b of ctx.getBalls()) {
      const r = this.runnerOf(b);
      if (!r) continue;
      b.radius = radius;
      r.radius = radius;
      if (!r.released && now >= r.releaseMs) {
        r.released = true;
        const a = Math.PI / 2 + (2 * ctx.random() - 1) * 0.5;
        const sp = this.cruise(r, b);
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
      }
    }
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const r = this.runnerOf(ball);
    if (!r) return;
    if (!r.released) {
      // Waiting in the chute: pinned where it spawned.
      ball.x = r.x;
      ball.y = r.y;
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    const g = this.gravity();
    if (r.exited) {
      // Out: it falls away below the maze (the engine moved it), no walls any more.
      ball.vy += g * dtSec;
      r.x = ball.x;
      r.y = ball.y;
      return;
    }
    const v = this.view;
    const f = v.field;
    const cruise = this.cruise(r, ball);
    const steered = r.brain !== "bounce";
    let speed = Math.hypot(ball.vx, ball.vy);
    const maxSpeed = MZ_MAX_SPEED * cruise;
    if (speed > maxSpeed) {
      const k = maxSpeed / speed;
      ball.vx *= k;
      ball.vy *= k;
      speed = maxSpeed;
    }
    // The engine already moved the ball by v·dt: move it again from where it was, in micro-steps short enough that no
    // wall can be skipped (at most MZ_MICRO_STEP of the contact distance each; beyond MZ_MAX_MICRO_STEPS the ball slows).
    const reach = r.radius + f.wall / 2;
    const maxStep = Math.max(0.05, MZ_MICRO_STEP * reach);
    let travel = speed * dtSec + 0.5 * g * dtSec * dtSec;
    if (travel > MZ_MAX_MICRO_STEPS * maxStep && speed > 0) {
      const k = (MZ_MAX_MICRO_STEPS * maxStep - 0.5 * g * dtSec * dtSec) / (speed * dtSec);
      const kk = Math.max(0, Math.min(1, k));
      ball.vx *= kk;
      ball.vy *= kk;
      speed *= kk;
      travel = speed * dtSec + 0.5 * g * dtSec * dtSec;
    }
    const n = Math.max(1, Math.min(MZ_MAX_MICRO_STEPS, Math.ceil(travel / maxStep)));
    const h = dtSec / n;
    ball.x = r.x;
    ball.y = r.y;
    for (let k = 0; k < n; k++) {
      if (steered) {
        const sp = Math.hypot(ball.vx, ball.vy);
        if (sp < MZ_MIN_SPEED * cruise) {
          if (sp > 1e-9) {
            const boost = Math.min(cruise / sp, 1 + MZ_RECOVER * h);
            ball.vx *= boost;
            ball.vy *= boost;
          } else ball.vy = MZ_MIN_SPEED * cruise;
        }
      }
      ball.vy += g * h;
      ball.x += ball.vx * h;
      ball.y += ball.vy * h;
      this.collide(ctx, r, ball, cruise);
      this.track(ctx, r, ball, cruise);
      if (r.exited) {
        ball.x += ball.vx * h * (n - k - 1);
        ball.y += ball.vy * h * (n - k - 1);
        break;
      }
    }
    if (!r.exited) {
      // Containment, checked: a ball in play is always inside the maze or its entrance chute.
      const s = f.cell;
      const inMaze = ball.x >= f.left && ball.x <= f.left + f.width && ball.y >= f.top && ball.y <= f.top + f.height;
      const x0 = f.left + v.grid.entranceCol * s;
      const inChute = ball.x >= x0 && ball.x <= x0 + s && ball.y >= f.top - s && ball.y <= f.top;
      if (!inMaze && !inChute) {
        v.leaks++;
        clampIntoMazeCell(f, r.col, r.row, ball);
      }
    }
    r.x = ball.x;
    r.y = ball.y;
  }

  /** The walls of the ball's cell: rebounds, and a hit (a note, a glow, a bounce in the stats) when it was hard enough. */
  private collide(ctx: ModeContext, r: MazeRunner, ball: Ball, cruise: number) {
    const v = this.view;
    const c = this.contact;
    c.speed = 0;
    c.dir = -1;
    c.sealedExit = false;
    const approach = resolveMazeCell(v.grid, v.field, r.col, r.row, ball, this.gapsOf(r), c);
    if (approach <= 0) return;
    if (r.brain === "bounce") {
      // Pure physics, with a small seeded scatter so a ball cannot settle into a periodic orbit between square walls.
      const a = (2 * ctx.random() - 1) * MZ_BOUNCE_SCATTER;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const vx = ball.vx;
      ball.vx = vx * cs - ball.vy * sn;
      ball.vy = vx * sn + ball.vy * cs;
    }
    if (c.sealedExit) v.sealed++;
    if (approach < MZ_HIT_MIN * cruise) return;
    const now = ctx.getElapsedMs();
    r.hits++;
    v.contacts++;
    ctx.creditBounce?.(ball);
    const cell = r.row >= 0 ? r.row * v.grid.cols + r.col : -1;
    this.logHit(cell, r.col, r.row, c.dir, ball.x, ball.y, now);
    if (now - r.lastNoteMs < MZ_NOTE_GAP_MS || now - this.lastNoteMs < MZ_NOTE_GLOBAL_GAP_MS) return;
    r.lastNoteMs = now;
    this.lastNoteMs = now;
    v.notes++;
    // (a bounce-math pitch rule shifts the ball's notes: `ball.pitchShift` semitones)
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: shiftedObstacleFrequency(mazeNoteFrequency(r.dist, v.entranceDist), ball) });
  }

  private logHit(cell: number, col: number, row: number, dir: number, x: number, y: number, t: number) {
    const v = this.view;
    const i = v.hitCount % MZ_HIT_LOG;
    const h = v.hits[i];
    if (h) {
      h.cell = cell;
      h.col = col;
      h.row = row;
      h.dir = dir;
      h.x = x;
      h.y = y;
      h.t = t;
    } else v.hits[i] = { cell, col, row, dir, x, y, t };
    v.hitCount++;
  }

  /** Follows the ball from cell to cell: the entrance closing behind it, the exit, the paint, the path, the steering. */
  private track(ctx: ModeContext, r: MazeRunner, ball: Ball, cruise: number) {
    const v = this.view;
    const f = v.field;
    const grid = v.grid;
    const s = f.cell;
    const col = Math.floor((ball.x - f.left) / s);
    const row = Math.floor((ball.y - f.top) / s);
    if (col !== r.col || row !== r.row) {
      const dc = col - r.col;
      const dr = row - r.row;
      const d = dc === 1 && dr === 0 ? MZ_E : dc === -1 && dr === 0 ? MZ_W : dr === 1 && dc === 0 ? MZ_S : dr === -1 && dc === 0 ? MZ_N : -1;
      if (d < 0 || !this.passable(r, d)) {
        // Numerically possible only at a corner: back inside its cell (nothing ever leaves through a wall).
        clampIntoMazeCell(f, r.col, r.row, ball);
        return;
      }
      if (d === MZ_S && r.row === grid.rows - 1 && r.col === grid.exitCol) {
        this.escape(ctx, r, ball, cruise);
        return;
      }
      const from = r.row >= 0 ? r.row * grid.cols + r.col : -1;
      r.col = col;
      r.row = row;
      r.heading = d;
      r.decided = false;
      if (row >= 0) this.enterCell(ctx, r, from, row * grid.cols + col);
      else {
        r.dist = v.entranceDist + 1;
        r.decided = true;
      }
      // The new cell's walls at once: the ball may already touch one of them (a hit like any other – a note, a glow).
      this.collide(ctx, r, ball, cruise);
    }
    if (!r.entered && r.row >= 0 && (r.row > 0 || ball.y - f.top >= r.radius + f.wall / 2)) r.entered = true;
    if (!r.decided && r.row >= 0) {
      const cx = f.left + (r.col + 0.5) * s;
      const cy = f.top + (r.row + 0.5) * s;
      if ((ball.x - cx) * MZ_DX[r.heading] + (ball.y - cy) * MZ_DY[r.heading] >= 0) {
        r.decided = true;
        if (r.brain !== "bounce") this.steer(ctx, r, ball, cruise);
      }
    }
  }

  /** Whether `r` may move from its cell toward `d`: an open passage, the chute ↔ entrance while it has not entered, the exit when open to it. */
  private passable(r: MazeRunner, d: number): boolean {
    const grid = this.view.grid;
    if (r.row < 0) return d === MZ_S && r.col === grid.entranceCol;
    if (r.row === 0 && d === MZ_N && r.col === grid.entranceCol) return !r.entered;
    if (r.row === grid.rows - 1 && d === MZ_S && r.col === grid.exitCol) return this.exitOpenFor(r);
    return (grid.open[r.row * grid.cols + r.col] & MZ_BIT[d]) !== 0;
  }

  /** A ball entered `cell` from `from` (−1: the chute): visits, its path, its distance, the paint, the slow motion at the exit. */
  private enterCell(ctx: ModeContext, r: MazeRunner, from: number, cell: number) {
    const v = this.view;
    const grid = v.grid;
    const visited = this.visited[r.slot];
    if (!visited[cell]) {
      visited[cell] = 1;
      r.visited++;
    }
    if (!v.visitedAny[cell]) {
      v.visitedAny[cell] = 1;
      v.visitedCells++;
    }
    // Its path from the entrance (a tree: stepping back to the previous cell shortens it).
    const path = this.path[r.slot];
    let len = this.pathLen[r.slot];
    if (len >= 2 && path[len - 2] === cell) len--;
    else if (len === 0 || path[len - 1] !== cell) {
      if (len < path.length) path[len++] = cell;
    }
    this.pathLen[r.slot] = len;
    r.dist = grid.dist[cell];
    if (r.dist < r.best) r.best = r.dist;
    this.paintStroke(r.slot, from, cell);
    // The first ball to reach the exit cell before anyone is out: the camera's slow motion (when that feature is on).
    if (cell === grid.exitCell && v.verdict === "" && v.slowMos === 0 && this.exitOpenFor(r)) {
      ctx.noteNearMiss?.();
      v.slowMos++;
    }
  }

  private paintStroke(slot: number, from: number, cell: number) {
    const v = this.view;
    const bit = 1 << (slot & 31); // (the masks hold 32 balls: the balls' memory-safety ceiling, MEMORY_CEILINGS.mzBalls)
    let fresh = false;
    if (!(this.paintedCell[cell] & bit)) {
      this.paintedCell[cell] |= bit;
      fresh = true;
    }
    const cols = v.grid.cols;
    if (from < 0) {
      if (!(this.paintedChute & bit)) {
        this.paintedChute |= bit;
        fresh = true;
      }
    } else {
      const d = mazeDirection(cols, from, cell);
      const owner = d === MZ_E || d === MZ_S ? from : cell;
      const store = d === MZ_E || d === MZ_W ? this.paintedEast : this.paintedSouth;
      if (d >= 0 && !(store[owner] & bit)) {
        store[owner] |= bit;
        fresh = true;
      }
    }
    if (!fresh) return;
    if (v.paintCount * 3 + 3 > v.paint.length) {
      const next = new Int32Array(v.paint.length * 2);
      next.set(v.paint);
      v.paint = next;
    }
    const i = v.paintCount * 3;
    v.paint[i] = cell;
    v.paint[i + 1] = from;
    v.paint[i + 2] = slot;
    v.paintCount++;
  }

  /** The brain's decision at the centre of a cell, as a nudge: pointed at the chosen passage with a seeded scatter. */
  private steer(ctx: ModeContext, r: MazeRunner, ball: Ball, cruise: number) {
    const v = this.view;
    const grid = v.grid;
    const cell = r.row * grid.cols + r.col;
    const mask = mazeExitsOf(grid, cell, this.exitOpenFor(r));
    let d: number;
    if (r.brain === "shortest") d = shortestChoice(grid, cell, mask);
    else if (r.brain === "wallFollow") d = wallFollowChoice(mask, r.heading, r.hand);
    else {
      // The explorer: this cell is explored now (it reached its centre line); out of options at the root of its search –
      // everything it can reach explored, the exit sealed by the rig or hidden behind a corridor it never went down – it
      // starts a fresh depth-first search from here instead of shuttling between two cells.
      const explored = this.explored[r.slot];
      explored[cell] = 1;
      const len = this.pathLen[r.slot];
      let parent = len >= 2 ? mazeDirection(grid.cols, cell, this.path[r.slot][len - 2]) : -1;
      if (explorerExhausted(grid, cell, mask, explored, parent)) {
        explored.fill(0);
        explored[cell] = 1;
        this.path[r.slot][0] = cell;
        this.pathLen[r.slot] = 1;
        parent = -1;
      }
      d = explorerChoice(grid, cell, mask, explored, parent, this.random);
    }
    if (d < 0) return;
    const g = this.gravity();
    let sp = Math.max(Math.hypot(ball.vx, ball.vy), cruise);
    if (d === MZ_N && g > 0) sp = Math.max(sp, Math.sqrt(cruise * cruise + 2 * MZ_CLIMB * g * v.field.cell));
    sp = Math.min(sp, MZ_MAX_SPEED * cruise);
    const a = (2 * ctx.random() - 1) * MZ_STEER_SCATTER;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const ux = MZ_DX[d];
    const uy = MZ_DY[d];
    ball.vx = (ux * cs - uy * sn) * sp;
    ball.vy = (ux * sn + uy * cs) * sp;
  }

  /** The ball is through the exit: its place, the winner (an escape in the team stats, the wall-break sound) or a bright note. */
  private escape(ctx: ModeContext, r: MazeRunner, ball: Ball, cruise: number) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    r.exited = true;
    r.exitMs = now;
    r.dist = 0;
    r.best = 0;
    r.row = v.grid.rows;
    r.place = ++v.exited;
    if (ball.vy < 0.6 * cruise) ball.vy = 0.6 * cruise;
    if (v.verdict === "") {
      v.verdict = "exit";
      v.winner = r.slot;
      v.verdictMs = now;
      ctx.creditEscape?.(ball);
      // The wall-break sound and the camera's shake (a "gap" event bumps the engine's break serial).
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
      v.impacts++;
    } else ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: mazeNoteFrequency(0, v.entranceDist), accent: true });
    if (v.exited >= v.count && v.endMs < 0) v.endMs = now;
  }

  onPostSubStep() {}

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    // The clip limit: the run ends; with nobody out yet, the ball nearest the exit wins – the rig's forced winner whatever
    // the distances (its shortest way may not fit into a short clip in a big, slow maze; the outcome is staged either way).
    if (v.endMs < 0 && now >= 1000 * v.settings.duration) {
      if (v.verdict === "") {
        let lead: MazeRunner | null = null;
        for (const r of v.runners) {
          if (r.exited) continue;
          if (r.slot === v.forcedWinner) {
            lead = r;
            break;
          }
          if (!lead || r.dist < lead.dist) lead = r;
        }
        if (lead) {
          v.verdict = "time";
          v.winner = lead.slot;
          v.verdictMs = now;
          ctx.creditEscape?.(lead.team >= 0 ? { id: lead.id, team: lead.team } : { id: lead.id });
        }
      }
      v.endMs = now;
    }
    if (v.endMs >= 0 && !v.finished && now >= v.endMs + MZ_FINISH_HOLD_MS) {
      v.finished = true;
      v.finishedMs = now;
    }
    // Escaped balls leave the engine once they have fallen out of sight.
    let drop = false;
    for (const r of v.runners) if (r.exited && !r.gone && now - r.exitMs >= MZ_EXIT_FALL_MS) drop = r.gone = true;
    if (drop) ctx.setBalls(ctx.getBalls().filter((b) => !this.runnerOf(b)?.gone));
  }

  onWallHit() {
    return undefined;
  }

  onGapPass() {
    return true;
  }

  /**
   * A resize: the field is rebuilt for the new canvas and every ball keeps its place in the maze (and its speed in field
   * units). The engine stretched the balls with the canvas (x and y apart), so that is undone first.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    const v = this.view;
    const old = { ...v.field };
    const oldCx = v.width / 2;
    const oldCy = v.height / 2;
    v.width = ctx.config.width;
    v.height = ctx.config.height;
    buildMazeField(v.width, v.height, v.grid.cols, v.grid.rows, v.field);
    const f = v.field;
    const k = old.cell > 0 ? f.cell / old.cell : 1;
    const cx = v.width / 2;
    const cy = v.height / 2;
    const ux = oldCx > 0 && cx > 0 ? oldCx / cx : 1;
    const uy = oldCy > 0 && cy > 0 ? oldCy / cy : 1;
    const radius = mazeBallRadius(ctx.config.ballRadius, f.cell);
    for (const b of ctx.getBalls()) {
      const r = this.runnerOf(b);
      if (!r) continue;
      // Undo the engine's stretch (x about the canvas centre by width / old width, y likewise), then map old field → new.
      const x = oldCx + (b.x - cx) * ux;
      const y = oldCy + (b.y - cy) * uy;
      b.x = f.left + (x - old.left) * k;
      b.y = f.top + (y - old.top) * k;
      b.vx *= k;
      b.vy *= k;
      b.radius = radius;
      r.radius = radius;
      r.x = b.x;
      r.y = b.y;
    }
    for (const h of v.hits) {
      h.x = f.left + (h.x - old.left) * k;
      h.y = f.top + (h.y - old.top) * k;
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
    return { count: v.count, exited: v.exited, winner: v.winner, verdict: v.verdict, finished: v.finished };
  }
}
