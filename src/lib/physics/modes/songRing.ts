import { midiToFrequency } from "@/lib/audio/scales";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Song Ring ("songRing" mode, feature song-ring – "can you name the tune before it is whole?"). One solid ring lined with
 * the notes of one phrase of a tune: a tile per note, its arc as long as the note, its height (a band outside the wall) and
 * its colour set by its pitch, so the ring is a circular piano roll. Every tile starts dark. A playhead – a bright spoke –
 * sweeps the ring once a lap, clockwise from the top. A ball flies inside the ring; the tile it hits lights up, and from
 * then on the playhead plays that tile's note every time it reaches it. Each lap plays the tune with holes in it, and the
 * holes close as the ball finds them: a known tune assembles out of order. The last tile completes it (`completeMs`): the
 * playhead winds on to the top (`REWIND_MS`), plays the whole phrase once over a bass and a pad, lands on the final chord
 * (`chordMs`, when the canvas shows the tune's name) and the run finishes `END_HOLD_MS` later. A run that has not
 * completed by `TIMEOUT_MS` of simulated time ends there, so the finder never loops forever.
 *
 * The tunes are public-domain melodies written as note data below (`SONG_RING_TUNES`); nothing is loaded. Their names are
 * never part of the view before the chord: the guess is the point.
 *
 * Physics: the mode owns its ring (no engine walls). The balls are ordinary engine balls with `gravityScale` 0 that fly
 * straight at the mode's speed (`speed` ring widths a second, so a run plays the same in every world size: the ring, the
 * ball and the speed all scale with the square's side). A ball that reaches the wall is put back on its exact hit point
 * and leaves within `SCATTER` of the inward normal, drawn from the seed – the ring modes' rebound. The rest of the
 * sub-step is flown on the new course, so a hit's time does not depend on the sub-step it fell in.
 *
 * Help (`help`, 0 … 1): pure chance leaves the last note hanging for half a minute on a bad seed and finishes in six
 * seconds on a lucky one. The mode keeps a plan in hits: note j of N is due between `earliestHit(j, N)` and
 * `latestHit(j, N)`. A rebound that would light a note early is moved onto the lit tile beside it (a near miss), and one
 * that comes late is aimed at the dark tile nearest to where it was going. Each such nudge happens with probability
 * `help`, so 0 is pure chance and 1 keeps every run on the plan. A nudged rebound still leaves within `SCATTER`.
 *
 * Sound (all `melody: false`, every pitched one `loopExact`: a fixed tune is never snapped to the Sound section's scale, which
 * would turn it into another tune): a hit is a soft woodblock tick (`orb: "click"`), brighter on the hit that lights a tile,
 * which also rings a ding on the tune's root (the same for every tile: a reward, not a note of the phrase) – or, with Live
 * notes on, plays the tile's own note at once. The playhead sings: a pluck at the tile's pitch
 * (`loop: "pluck"`). The finale adds an impact and a riser at the last tile, then the phrase with a chime an octave up on
 * every note, a kick every other slot, the tune's bass and the pad of the groove bed, and the completion chord.
 *
 * Randomness: only `ctx.random()` – the tune of "surprise", the launch direction, every rebound, the help's gates and
 * aims, the sparks – so a seed replays identically and Find Simulation can search a clip length.
 */

/* ------------------------------------------------------------------ the tunes */

export const SONG_RING_SONGS = ["twinkle", "ode", "elise", "jacques", "mountain", "surprise"] as const;
export type SongRingSong = (typeof SONG_RING_SONGS)[number];
export type SongRingTuneId = Exclude<SongRingSong, "surprise">;

export function isSongRingSong(value: unknown): value is SongRingSong {
  return typeof value === "string" && (SONG_RING_SONGS as readonly string[]).includes(value);
}

/** One phrase of a tune as data. */
export interface SongRingTune {
  id: SongRingTuneId;
  /** The notes in playing order: MIDI pitch and length in slots (the phrase's smallest note is one slot). */
  notes: readonly (readonly [midi: number, slots: number])[];
  /** The finale's bass: the slot it starts on and its MIDI pitch. */
  bass: readonly (readonly [slot: number, midi: number])[];
  /** The final chord's root (MIDI) and its colour. */
  root: number;
  minor: boolean;
}

/**
 * The built-in phrases: two bars each, seven to nine notes. Every melody is in the public domain – a traditional tune or a
 * composer dead for well over a century:
 *  - twinkle: "Ah! vous dirai-je, maman" (France, published 1761), sung as Twinkle, Twinkle, Little Star;
 *  - ode: the Ode to Joy theme of Beethoven's Symphony No. 9 (1824);
 *  - elise: the opening of Beethoven's Für Elise (about 1810);
 *  - jacques: Frère Jacques (France, traditional, 18th century);
 *  - mountain: In the Hall of the Mountain King from Grieg's Peer Gynt (1875).
 */
export const SONG_RING_TUNES: Readonly<Record<SongRingTuneId, SongRingTune>> = {
  twinkle: { id: "twinkle", notes: [[72, 1], [72, 1], [79, 1], [79, 1], [81, 1], [81, 1], [79, 2]], bass: [[0, 48], [4, 53], [6, 48]], root: 48, minor: false },
  ode: { id: "ode", notes: [[76, 1], [76, 1], [77, 1], [79, 1], [79, 1], [77, 1], [76, 1], [74, 1]], bass: [[0, 48], [4, 48], [7, 43]], root: 48, minor: false },
  elise: { id: "elise", notes: [[76, 1], [75, 1], [76, 1], [75, 1], [76, 1], [71, 1], [74, 1], [72, 1], [69, 4]], bass: [[8, 45], [9, 52], [10, 57]], root: 45, minor: true },
  jacques: { id: "jacques", notes: [[72, 1], [74, 1], [76, 1], [72, 1], [72, 1], [74, 1], [76, 1], [72, 1]], bass: [[0, 48], [4, 48]], root: 48, minor: false },
  mountain: { id: "mountain", notes: [[71, 1], [73, 1], [74, 1], [76, 1], [78, 1], [74, 1], [78, 2]], bass: [[0, 47], [4, 47]], root: 47, minor: true },
};

/** The tunes "surprise" picks from, in the order the seed's draw reads them. */
export const SURPRISE_TUNES: readonly SongRingTuneId[] = ["twinkle", "ode", "elise", "jacques", "mountain"];

/** The tune of a Song setting: its own, or for "surprise" the one `draw` (0 … 1, the seed's) picks. */
export function songRingTuneOf(song: SongRingSong, draw: number): SongRingTune {
  if (song !== "surprise") return SONG_RING_TUNES[song];
  const i = Math.min(SURPRISE_TUNES.length - 1, Math.max(0, Math.floor(draw * SURPRISE_TUNES.length)));
  return SONG_RING_TUNES[SURPRISE_TUNES[i]];
}

/* ------------------------------------------------------------------ settings */

export interface SongRingSettings {
  /** The tune; "surprise": the seed picks one. */
  song: SongRingSong;
  /** Seconds one lap of the playhead takes, 2–8: the phrase's tempo. */
  lapSec: number;
  /** Speed of the balls, ring widths a second, 0.4–4. */
  speed: number;
  /** Balls in the ring, 1–6. */
  balls: number;
  /** 0–1: how often a rebound is nudged when a note comes early or late (0: pure chance). */
  help: number;
  /** The hit that lights a tile plays its note at once (off: only the playhead sings). */
  live: boolean;
}

export const DEFAULT_SONG_RING_SETTINGS: SongRingSettings = {
  song: "twinkle",
  lapSec: 4,
  speed: 1.2,
  balls: 1,
  help: 0.8,
  live: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const SONG_RING_RANGES = {
  srLapSec: { min: 2, max: 8, step: 0.5 },
  srSpeed: { min: 0.4, max: 4, step: 0.1 },
  srBalls: { min: 1, max: 6, step: 1 },
  srHelp: { min: 0, max: 1, step: 0.05 },
} as const;

/** The Song Ring fields of the SimulatorSettings object (URL keys srt, srl, srv, srb, srh, srn). */
export interface SongRingFields {
  srSong: SongRingSong;
  srLapSec: number;
  srSpeed: number;
  srBalls: number;
  srHelp: number;
  srLive: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Rounds onto a slider's step, two decimals at most. */
function onStep(value: number, step: number) {
  return Math.round(Math.round(value / step) * step * 100) / 100;
}

/** Fills in the defaults and clamps every value onto its slider's step (the ball count whole, at most its memory ceiling); bad values fall back to the defaults. */
export function resolveSongRingSettings(config: Partial<SongRingSettings> | null | undefined): SongRingSettings {
  const out = { ...DEFAULT_SONG_RING_SETTINGS };
  if (!config) return out;
  const R = SONG_RING_RANGES;
  if (isSongRingSong(config.song)) out.song = config.song;
  if (config.lapSec !== undefined) out.lapSec = onStep(clampNumber(config.lapSec, R.srLapSec, out.lapSec), R.srLapSec.step);
  if (config.speed !== undefined) out.speed = onStep(clampNumber(config.speed, R.srSpeed, out.speed), R.srSpeed.step);
  if (config.balls !== undefined) out.balls = memoryCeiling("srBalls", Math.round(clampNumber(config.balls, R.srBalls, out.balls))); // --- uncap-all --- MEMORY_CEILINGS.srBalls
  if (config.help !== undefined) out.help = onStep(clampNumber(config.help, R.srHelp, out.help), R.srHelp.step);
  if (typeof config.live === "boolean") out.live = config.live;
  return out;
}

/** Picks the Song Ring settings out of a bigger object for `engine.setSongRingSettings()`. */
export function songRingSettingsOf(source: SongRingFields): SongRingSettings {
  return { song: source.srSong, lapSec: source.srLapSec, speed: source.srSpeed, balls: source.srBalls, help: source.srHelp, live: source.srLive };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function songRingSettingFields(settings: SongRingSettings): SongRingFields {
  return { srSong: settings.song, srLapSec: settings.lapSec, srSpeed: settings.speed, srBalls: settings.balls, srHelp: settings.help, srLive: settings.live };
}

/** The defaults of the feature's fields. */
export function defaultSongRingFields(): SongRingFields {
  return songRingSettingFields(DEFAULT_SONG_RING_SETTINGS);
}

/** The core settings Song Ring overrides when it is the page's mode: none (its ball is the page's own, sized to its ring). */
export function songRingModeDefaults(mode: string): Record<never, never> {
  void mode;
  return {};
}

/** Validates the feature's fields (URL parameters and presets alike): a known tune, clamped numbers on their steps, a real boolean. */
export function resolveSongRingFields(source: Partial<SongRingFields>): SongRingFields {
  return songRingSettingFields(resolveSongRingSettings({ song: source.srSong, lapSec: source.srLapSec, speed: source.srSpeed, balls: source.srBalls, help: source.srHelp, live: source.srLive }));
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const NUMERIC_KEYS = { srl: "srLapSec", srv: "srSpeed", srb: "srBalls", srh: "srHelp" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: srt, srl, srv, srb, srh and srn. */
export function writeSongRingParams(settings: SongRingFields, base: SongRingFields, params: URLSearchParams) {
  if (settings.srSong !== base.srSong) params.set("srt", settings.srSong);
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.srLive !== base.srLive) params.set("srn", settings.srLive ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readSongRingParams(params: URLSearchParams, settings: SongRingFields) {
  const next: Partial<SongRingFields> = { ...settings };
  const song = params.get("srt");
  if (isSongRingSong(song)) next.srSong = song;
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const live = params.get("srn");
  if (live === "1") next.srLive = true;
  else if (live === "0") next.srLive = false;
  Object.assign(settings, resolveSongRingFields(next));
}

/* ------------------------------------------------------------------ geometry */

const TWO_PI = Math.PI * 2;

/** The side of the world the mode was tuned in (a phone's square): the ball's size and every length scale from it. */
export const TUNED_SIDE = 450;
/** The wall's radius, the lowest and the highest tile's height and the hub's radius, as shares of the square's side. */
export const RING_AT = 0.35;
export const BAND_MIN = 0.026;
export const BAND_MAX = 0.086;
export const HUB_AT = 0.045;
/** A rebound leaves within this of the inward normal (radians): the ring modes' scatter. */
export const SCATTER = Math.PI / 3;
/** The hub is drawn this many times the layout's `hub` wide (the count fits inside it). */
export const HUB_DRAWN = 3;
/** A ball starts on the hub's edge along its launch, this share of the drawn hub's radius out: the count in the hub stays clear. */
export const SPAWN_AT_HUB = 1.15;
/**
 * The first ball is launched at a tile the playhead reaches this soon after the ball lights it (s, the least and the most), so
 * the tune sings within the first second or so instead of waiting most of a lap; `LAUNCH_MARGIN` keeps the aim off the tile's
 * edges (a share of its arc on each side).
 */
export const FIRST_NOTE_MIN_SEC = 0.2;
export const FIRST_NOTE_MAX_SEC = 1;
export const LAUNCH_MARGIN = 0.2;

export interface SongRingLayout {
  /** The world the layout was built for. */
  width: number;
  height: number;
  /** The centred square the ring lives in. */
  side: number;
  left: number;
  top: number;
  cx: number;
  cy: number;
  /** The wall's radius, and the radius a ball's centre is stopped at. */
  radius: number;
  reach: number;
  /** A ball's radius here (the page's Ball Size at this world's scale), and the Ball Size it was built from. */
  ballRadius: number;
  requestedRadius: number;
  /** The tiles' lowest and highest band, and the hub. */
  bandMin: number;
  bandMax: number;
  hub: number;
}

/** The ring for a world of `width` × `height` and the page's Ball Size (world px at the tuned side). */
export function buildSongRingLayout(width: number, height: number, ballRadius: number): SongRingLayout {
  const side = Math.max(1, Math.min(width, height));
  const k = side / TUNED_SIDE;
  const radius = RING_AT * side;
  // A ball never fills more than a third of the ring: a huge Ball Size still flies.
  const r = Math.min(Math.max(0.5, ballRadius) * k, radius / 3);
  return { width, height, side, left: (width - side) / 2, top: (height - side) / 2, cx: width / 2, cy: height / 2, radius, reach: radius - r, ballRadius: r, requestedRadius: ballRadius, bandMin: BAND_MIN * side, bandMax: BAND_MAX * side, hub: HUB_AT * side };
}

/** An angle in 0 … 2π. */
export function wrapAngle(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/** An angle in −π … π. */
export function wrapPi(a: number): number {
  const m = wrapAngle(a);
  return m > Math.PI ? m - TWO_PI : m;
}

/** The share of a lap (0 … 1, clockwise from the top) of a canvas angle (radians, 0 = right, y down). */
export function turnOf(angle: number): number {
  return wrapAngle(angle + Math.PI / 2) / TWO_PI;
}

/** The canvas angle (radians) of a share of a lap. */
export function angleOf(turn: number): number {
  return turn * TWO_PI - Math.PI / 2;
}

/** The tiles of a tune: where each starts and ends (shares of a lap), its pitch, and its height and colour level (0 lowest … 1 highest pitch). */
export interface SongRingTiles {
  count: number;
  slots: number;
  start: Float64Array;
  end: Float64Array;
  midi: Float64Array;
  level: Float64Array;
}

export function buildSongRingTiles(tune: SongRingTune): SongRingTiles {
  const n = tune.notes.length;
  let slots = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [midi, len] of tune.notes) {
    slots += len;
    if (midi < lo) lo = midi;
    if (midi > hi) hi = midi;
  }
  const tiles: SongRingTiles = { count: n, slots, start: new Float64Array(n), end: new Float64Array(n), midi: new Float64Array(n), level: new Float64Array(n) };
  let at = 0;
  for (let i = 0; i < n; i++) {
    const [midi, len] = tune.notes[i];
    tiles.start[i] = at / slots;
    at += len;
    tiles.end[i] = at / slots;
    tiles.midi[i] = midi;
    tiles.level[i] = hi > lo ? (midi - lo) / (hi - lo) : 0.5;
  }
  return tiles;
}

/** The tile a share of a lap falls on. */
export function tileAt(tiles: Pick<SongRingTiles, "count" | "start" | "end">, turn: number): number {
  const u = turn - Math.floor(turn);
  for (let i = 0; i < tiles.count; i++) if (u >= tiles.start[i] && u < tiles.end[i]) return i;
  return tiles.count - 1;
}

/**
 * The share of a lap the first ball is launched toward, from the seed's one draw (0 … 1): inside a tile whose start the
 * playhead crosses `FIRST_NOTE_MIN_SEC` to `FIRST_NOTE_MAX_SEC` after the ball reaches the wall `hitSec` in (each such tile
 * as likely as its arc is long); when no tile starts in that window, the first one to start after it.
 */
export function launchTurn(tiles: Pick<SongRingTiles, "count" | "start" | "end">, hitSec: number, lapSec: number, draw: number): number {
  const lap = Math.max(1e-6, lapSec);
  const lo = (hitSec + FIRST_NOTE_MIN_SEC) / lap;
  const hi = (hitSec + FIRST_NOTE_MAX_SEC) / lap;
  // (where the playhead first crosses each tile's start at or after `lo`, in laps since the start)
  const due = (i: number) => tiles.start[i] + Math.ceil(lo - tiles.start[i] - 1e-12);
  let total = 0;
  let first = 0;
  for (let i = 0; i < tiles.count; i++) {
    if (due(i) <= hi) total += tiles.end[i] - tiles.start[i];
    if (due(i) < due(first)) first = i;
  }
  const inWindow = (i: number) => (total > 0 ? due(i) <= hi : i === first);
  if (total <= 0) total = tiles.end[first] - tiles.start[first];
  let at = Math.max(0, Math.min(1, draw)) * total;
  let last = first;
  for (let i = 0; i < tiles.count; i++) {
    if (!inWindow(i)) continue;
    last = i;
    const w = tiles.end[i] - tiles.start[i];
    if (at <= w) return tiles.start[i] + w * (LAUNCH_MARGIN + (1 - 2 * LAUNCH_MARGIN) * (at / w));
    at -= w;
  }
  return tiles.start[last] + (tiles.end[last] - tiles.start[last]) * (1 - LAUNCH_MARGIN);
}

/** The final chord's four notes (Hz): the tune's root, its third (minor or major), its fifth and its octave. */
export function finalChordOf(tune: Pick<SongRingTune, "root" | "minor">): number[] {
  return [0, tune.minor ? 3 : 4, 7, 12].map((step) => midiToFrequency(tune.root + step));
}

/** A tile's hue (degrees): the lowest note violet, through blue, green and gold to the highest in pink. */
export function tileHue(level: number): number {
  const h = 265 - 285 * Math.max(0, Math.min(1, level));
  return h < 0 ? h + 360 : h;
}

/** The rebound's turn off the inward normal that lands a ball leaving the wall at canvas angle `theta` on canvas angle `target`. */
export function aimDelta(theta: number, target: number): number {
  return wrapPi(target - theta - Math.PI) / 2;
}

/* ------------------------------------------------------------------ pacing */

/** Wall hits a run of `n` notes is planned over: the last note is due about here. */
export function hitBudget(n: number): number {
  return 12 + 1.35 * Math.max(1, n);
}

/** The plan's shape: the share of the budget the last note may come at, how the notes before it crowd toward the start, and how long (share of the budget) a note may be awaited. */
export const PLAN_LAST_AT = 0.88;
export const PLAN_CURVE = 1.75;
export const PLAN_WAIT = 0.15;

/** The first hit (1-based, of all balls) that may light note `j` of `n` (1-based): before it a rebound steers clear of the dark tiles. */
export function earliestHit(j: number, n: number): number {
  return PLAN_LAST_AT * hitBudget(n) * Math.pow(Math.max(0, Math.min(1, j / Math.max(1, n))), PLAN_CURVE);
}

/** The hit after which note `j` of `n` is late: a rebound then aims for a dark tile. */
export function latestHit(j: number, n: number): number {
  return earliestHit(j, n) + PLAN_WAIT * hitBudget(n);
}

/** Simulation ms the playhead takes to wind on to the top after the last tile, the hold after the final chord, and the timeout. */
export const REWIND_MS = 700;
export const END_HOLD_MS = 1500;
export const TIMEOUT_MS = 300_000;
/** How long a tile shows a ball's hit, the playhead's note and its lighting. */
export const HIT_FLASH_MS = 240;
export const NOTE_PULSE_MS = 420;
export const LIGHT_POP_MS = 520;
/** The sparks' pool, and how many a lighting, a finale note and the chord throw. */
export const MAX_SPARKS = 240;
export const SPARKS_PER_LIGHT = 14;
export const SPARKS_PER_NOTE = 8;
export const SPARKS_PER_CHORD = 96;
/** The ticks: a hit's pitch (Hz) and level, and the brighter one of the hit that lights a tile. */
export const TICK_HZ = 1050;
export const TICK_LEVEL = 0.34;
export const LIGHT_TICK_HZ = 1900;
export const LIGHT_TICK_LEVEL = 0.85;
/**
 * The ding of a tile lighting: always the same pitch, the tune's root this many octaves up (a bell on the tonic, so it rings
 * with any note of the phrase and is never taken for one), and its level.
 */
export const LIGHT_DING_OCTAVES = 3;
export const LIGHT_DING_LEVEL = 0.5;
/** The least ms between two soft ticks: a crowd of balls, or a very fast one, ticks at most nine times a second (the tick that lights a tile always plays). */
export const TICK_COOLDOWN_MS = 110;
/** The playhead's note, the finale's note and its chime an octave up, and the finale's kick. */
export const NOTE_LEVEL = 0.9;
export const FINALE_NOTE_LEVEL = 1;
export const FINALE_CHIME_LEVEL = 0.4;
export const FINALE_KICK_LEVEL = 0.7;
export const KICK_EVERY_SLOTS = 2;
/** Past this share of its radius a sub-step a ball asks the engine for more sub-steps. */
const STEP_REACH = 1;

export type SongRingPhase = "collect" | "rewind" | "finale" | "chord" | "timeout";

/* ------------------------------------------------------------------ view */

export interface SongRingView {
  settings: SongRingSettings;
  layout: SongRingLayout | null;
  /** The simulation clock (ms). */
  timeMs: number;
  /** The tune played (never "surprise"): the canvas names it only from the chord on. */
  song: SongRingTuneId;
  tiles: SongRingTiles;
  /** Per tile: when it was lit (ms; −1 dark), when the playhead last played it and when a ball last hit it (−Infinity never). */
  litMs: Float64Array;
  playMs: Float64Array;
  hitMs: Float64Array;
  /** Counters: tiles lit and their total, wall hits, notes the playhead played, rebounds the help moved. */
  lit: number;
  total: number;
  hits: number;
  notes: number;
  nudges: number;
  balls: number;
  /** Where the playhead is (share of a lap, clockwise from the top). */
  head: number;
  phase: SongRingPhase;
  /** When the last tile lit, when the whole phrase began, when the chord fell, when the run timed out (ms; −1 before). */
  completeMs: number;
  finaleMs: number;
  chordMs: number;
  timeoutMs: number;
  finished: boolean;
  /** Simulation ms the run finished at (−1 while it has not). */
  finishedMs: number;
  /** The sparks: place, velocity, size, life (s, counting down), max life and hue (−1 = white). */
  sparkCount: number;
  sparkX: Float64Array;
  sparkY: Float64Array;
  sparkVx: Float64Array;
  sparkVy: Float64Array;
  sparkSize: Float64Array;
  sparkLife: Float64Array;
  sparkMaxLife: Float64Array;
  sparkHue: Float64Array;
}

function createView(): SongRingView {
  const tiles = buildSongRingTiles(SONG_RING_TUNES[DEFAULT_SONG_RING_SETTINGS.song === "surprise" ? "twinkle" : DEFAULT_SONG_RING_SETTINGS.song]);
  return {
    settings: { ...DEFAULT_SONG_RING_SETTINGS },
    layout: null,
    timeMs: 0,
    song: "twinkle",
    tiles,
    litMs: new Float64Array(tiles.count).fill(-1),
    playMs: new Float64Array(tiles.count).fill(-Infinity),
    hitMs: new Float64Array(tiles.count).fill(-Infinity),
    lit: 0,
    total: tiles.count,
    hits: 0,
    notes: 0,
    nudges: 0,
    balls: 0,
    head: 0,
    phase: "collect",
    completeMs: -1,
    finaleMs: -1,
    chordMs: -1,
    timeoutMs: -1,
    finished: false,
    finishedMs: -1,
    sparkCount: 0,
    sparkX: new Float64Array(MAX_SPARKS),
    sparkY: new Float64Array(MAX_SPARKS),
    sparkVx: new Float64Array(MAX_SPARKS),
    sparkVy: new Float64Array(MAX_SPARKS),
    sparkSize: new Float64Array(MAX_SPARKS),
    sparkLife: new Float64Array(MAX_SPARKS),
    sparkMaxLife: new Float64Array(MAX_SPARKS),
    sparkHue: new Float64Array(MAX_SPARKS),
  };
}

/** The colours of the second to the sixth ball (the first wears the page's Ball Color). */
export const EXTRA_BALL_COLORS = ["#fde047", "#67e8f9", "#f9a8d4", "#86efac", "#fdba74"] as const;

/* ------------------------------------------------------------------ the mode */

export class SongRingMode implements GameMode {
  readonly name = "songRing";
  /** The balls fly at the mode's speed (no slow-ball boost) and through each other (no pair pass: only the wall plays). */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: SongRingSettings = { ...DEFAULT_SONG_RING_SETTINGS };
  private readonly view: SongRingView = createView();
  private layout: SongRingLayout | null = null;
  private tune: SongRingTune = SONG_RING_TUNES.twinkle;
  private clockMs = 0;
  /** Where the playhead was when the last tile lit, and how far it winds on to the top. */
  private rewindFrom = 0;
  private rewindSpan = 1;
  /** A bass note held back a step (it shares the kick's slot in the sound budget). */
  private heldBass = -1;
  private lastTickMs = -Infinity;
  /** How far the playhead's notes have been played: laps since the start while collecting, the share of the finale's lap after. */
  private lapPos = 0;
  private finalePos = 0;

  getSettings(): SongRingSettings {
    return this.settings;
  }
  /** Every setting applies on the next init (the tune, the lap, the speed, the balls and the help are the run's; Live notes its sound). */
  setSettings(patch: Partial<SongRingSettings>) {
    this.settings = resolveSongRingSettings({ ...this.settings, ...patch });
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): SongRingView {
    return this.view;
  }
  getLayout(): SongRingLayout | null {
    return this.layout;
  }
  getProgress() {
    const v = this.view;
    return { lit: v.lit, total: v.total, hits: v.hits, notes: v.notes, nudges: v.nudges, phase: v.phase, complete: v.completeMs >= 0, chord: v.chordMs >= 0, timeout: v.timeoutMs >= 0, finished: v.finished };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    ctx.setObstacles([]);
    const v = this.view;
    const s = this.settings;
    v.settings = { ...s };
    this.clockMs = 0;
    this.rewindFrom = 0;
    this.rewindSpan = 1;
    this.heldBass = -1;
    this.lastTickMs = -Infinity;
    this.lapPos = 0;
    this.finalePos = 0;
    // "Surprise": the seed's first draw picks the tune (a named tune draws nothing here).
    this.tune = songRingTuneOf(s.song, s.song === "surprise" ? ctx.random() : 0);
    v.song = this.tune.id;
    v.tiles = buildSongRingTiles(this.tune);
    const n = v.tiles.count;
    v.litMs = new Float64Array(n).fill(-1);
    v.playMs = new Float64Array(n).fill(-Infinity);
    v.hitMs = new Float64Array(n).fill(-Infinity);
    v.timeMs = 0;
    v.lit = 0;
    v.total = n;
    v.hits = 0;
    v.notes = 0;
    v.nudges = 0;
    v.head = 0;
    v.phase = "collect";
    v.completeMs = -1;
    v.finaleMs = -1;
    v.chordMs = -1;
    v.timeoutMs = -1;
    v.finished = false;
    v.finishedMs = -1;
    v.sparkCount = 0;
    this.rebuild(ctx);
    // The balls leave the hub's edge evenly spread (the count in the hub stays clear), the first toward a tile the playhead
    // reaches soon after the ball lights it, the seed's draw picking where (the engine then adds no default ball).
    const L = this.layout!;
    const speed = this.speedPx();
    const from = Math.min(SPAWN_AT_HUB * HUB_DRAWN * L.hub, 0.5 * L.reach);
    const a = angleOf(launchTurn(v.tiles, (L.reach - from) / speed, s.lapSec, ctx.random()));
    for (let i = 0; i < s.balls; i++) {
      const dir = a + (i * TWO_PI) / s.balls;
      const x = L.cx + Math.cos(dir) * from;
      const y = L.cy + Math.sin(dir) * from;
      ctx.addBall({ x, y, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, radius: L.ballRadius, radiusScale: L.side / TUNED_SIDE, color: i === 0 ? ctx.config.ballColor || "#FFFFFF" : EXTRA_BALL_COLORS[(i - 1) % EXTRA_BALL_COLORS.length], gravityScale: 0 });
    }
    v.balls = ctx.getBalls().length;
  }

  private rebuild(ctx: ModeContext) {
    this.layout = buildSongRingLayout(ctx.config.width, ctx.config.height, ctx.config.ballRadius || 8);
    this.view.layout = this.layout;
  }

  /** The speed setting in px/s for this layout. */
  private speedPx(): number {
    return this.settings.speed * 2 * (this.layout?.radius ?? RING_AT * TUNED_SIDE);
  }

  /** The engine plans its sub-steps for a ball that would cross more than its own radius in one of the usual four. */
  stepSpeedBound(_ctx: ModeContext, stepSec: number): number {
    const L = this.layout;
    if (!L) return 0;
    const speed = this.speedPx();
    return (speed * stepSec) / 4 > STEP_REACH * L.ballRadius ? speed : 0;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    // A live change of the Ball Size refits the balls.
    if (this.layout && (ctx.config.ballRadius || 8) !== this.layout.requestedRadius) {
      this.rebuild(ctx);
      for (const ball of ctx.getBalls()) ball.radius = this.layout.ballRadius;
    }
    this.clockMs += dtMs;
    v.timeMs = this.clockMs;
    v.balls = ctx.getBalls().length;
  }

  /** The ball flew its sub-step: keep it at the mode's speed and weightless, and bounce it off the wall where it crossed it. */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const L = this.layout;
    if (!L) return;
    ball.gravityScale = 0;
    const speed = this.speedPx();
    let vx = ball.vx;
    let vy = ball.vy;
    const now = Math.hypot(vx, vy);
    if (!(now > 0) || !Number.isFinite(now)) {
      // A ball brought to a stop (a clone, a drag) is sent off again in the seed's direction.
      const a = ctx.random() * TWO_PI;
      vx = Math.cos(a) * speed;
      vy = Math.sin(a) * speed;
    } else if (Math.abs(now - speed) > 1e-9 * speed) {
      // (a drag, a wind or a clone's own speed: the course stays, the speed is the mode's)
      vx *= speed / now;
      vy *= speed / now;
    }
    ball.vx = vx;
    ball.vy = vy;
    const dx = ball.x - L.cx;
    const dy = ball.y - L.cy;
    const reach = Math.max(1e-6, L.radius - ball.radius);
    const d2 = dx * dx + dy * dy;
    if (!(d2 > reach * reach)) return;
    // Where the sub-step's flight crossed the wall: back along it from where the ball is now.
    const px = dx - ball.vx * dtSec;
    const py = dy - ball.vy * dtSec;
    let hx: number;
    let hy: number;
    let left = 0;
    const a = ball.vx * ball.vx + ball.vy * ball.vy;
    const b = 2 * (px * ball.vx + py * ball.vy);
    const c = px * px + py * py - reach * reach;
    const disc = b * b - 4 * a * c;
    const t = a > 0 && disc >= 0 ? (-b + Math.sqrt(disc)) / (2 * a) : -1;
    if (c <= 0 && t >= 0 && t <= dtSec) {
      hx = px + ball.vx * t;
      hy = py + ball.vy * t;
      left = dtSec - t;
    } else {
      // It started the sub-step outside (a resize, a push from elsewhere): straight back onto the wall.
      const d = Math.sqrt(d2);
      hx = (dx / d) * reach;
      hy = (dy / d) * reach;
    }
    const theta = Math.atan2(hy, hx);
    const delta = this.hit(ctx, ball, theta, L, reach);
    const out = theta + Math.PI + delta;
    ball.vx = Math.cos(out) * speed;
    ball.vy = Math.sin(out) * speed;
    ball.x = L.cx + hx + ball.vx * left;
    ball.y = L.cy + hy + ball.vy * left;
    ctx.noteBounce?.(ball);
    ctx.creditBounce?.(ball);
  }

  /** A ball met the wall at canvas angle `theta`: the tile there lights, the hit ticks, and the rebound's turn off the inward normal comes back. */
  private hit(ctx: ModeContext, ball: Ball, theta: number, L: SongRingLayout, reach: number): number {
    const v = this.view;
    const T = v.tiles;
    v.hits++;
    const i = tileAt(T, turnOf(theta));
    v.hitMs[i] = this.clockMs;
    const collecting = v.phase === "collect";
    let lights = false;
    if (collecting && v.litMs[i] < 0) {
      lights = true;
      v.litMs[i] = this.clockMs;
      v.lit++;
      this.burst(ctx, L.cx + Math.cos(theta) * L.radius, L.cy + Math.sin(theta) * L.radius, theta + Math.PI, SPARKS_PER_LIGHT, tileHue(T.level[i]), 0.5 * L.side);
      if (v.lit >= v.total) this.complete(ctx);
    }
    // The chord rings alone: no ticks after it.
    if (v.phase !== "chord" && v.phase !== "timeout" && (lights || this.clockMs - this.lastTickMs >= TICK_COOLDOWN_MS)) {
      this.lastTickMs = this.clockMs;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, orb: "click", frequency: lights ? LIGHT_TICK_HZ : TICK_HZ, level: lights ? LIGHT_TICK_LEVEL : TICK_LEVEL, melody: false });
      // (the tile's own note with Live notes on; else the ding on the tune's root, the same for every tile)
      if (lights && this.settings.live && collecting) this.emitNote(ctx, i, NOTE_LEVEL, false);
      else if (lights) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "ding", frequency: midiToFrequency(this.tune.root + 12 * LIGHT_DING_OCTAVES), level: LIGHT_DING_LEVEL, loopExact: true, melody: false });
    }
    // The rebound: the seed's scatter, then the help's nudge while the notes are still being found.
    let delta = (2 * ctx.random() - 1) * SCATTER;
    const help = this.settings.help;
    if (v.phase !== "collect" || !(help > 0)) return delta;
    const next = v.lit + 1;
    const upcoming = v.hits + 1;
    const late = upcoming > latestHit(next, v.total);
    const early = !late && upcoming < earliestHit(next, v.total);
    if (!late && !early) return delta;
    if (!(ctx.random() < help)) return delta;
    const u = ctx.random();
    const moved = late ? this.seek(theta, delta, u) : this.hold(theta, delta, u, Math.asin(Math.min(1, ball.radius / reach)));
    if (moved !== delta) {
      v.nudges++;
      delta = moved;
    }
    return delta;
  }

  /** Late: the turn that lands on the dark tile nearest to where the rebound was going; when none can be reached from here, across from one, so the next rebound can. */
  private seek(theta: number, delta: number, u: number): number {
    const v = this.view;
    const T = v.tiles;
    let best = NaN;
    for (let pass = 0; pass < 2 && Number.isNaN(best); pass++) {
      for (let j = 0; j < T.count; j++) {
        if (v.litMs[j] >= 0) continue;
        const width = T.end[j] - T.start[j];
        const target = angleOf(T.start[j] + width * (0.5 + 0.5 * (u - 0.5))) + (pass === 1 ? Math.PI : 0);
        const d = aimDelta(theta, target);
        if (Math.abs(d) > SCATTER) continue;
        if (Number.isNaN(best) || Math.abs(d - delta) < Math.abs(best - delta)) best = d;
      }
    }
    return Number.isNaN(best) ? delta : best;
  }

  /** Early: a rebound that would land on a dark tile lands beside it instead, on a lit one (a near miss of `pad` radians and more). */
  private hold(theta: number, delta: number, u: number, pad: number): number {
    const v = this.view;
    const T = v.tiles;
    const landing = turnOf(theta + Math.PI + 2 * delta);
    const j = tileAt(T, landing);
    if (v.litMs[j] >= 0) return delta;
    const miss = (pad * (1.25 + 1.5 * u)) / TWO_PI;
    const before = T.start[j] - miss;
    const after = T.end[j] + miss;
    const nearFirst = landing - T.start[j] <= T.end[j] - landing;
    for (const turn of nearFirst ? [before, after] : [after, before]) {
      if (v.litMs[tileAt(T, turn)] < 0) continue;
      const d = aimDelta(theta, angleOf(turn));
      if (Math.abs(d) <= SCATTER) return d;
    }
    // Dark on both sides: the middle of the lit tile nearest to the rebound's own course.
    let best = NaN;
    for (let k = 0; k < T.count; k++) {
      if (v.litMs[k] < 0) continue;
      const d = aimDelta(theta, angleOf(0.5 * (T.start[k] + T.end[k])));
      if (Math.abs(d) > SCATTER) continue;
      if (Number.isNaN(best) || Math.abs(d - delta) < Math.abs(best - delta)) best = d;
    }
    return Number.isNaN(best) ? delta : best;
  }

  /** The last tile lit: the impact, the riser, and the playhead winds on to the top. */
  private complete(ctx: ModeContext) {
    const v = this.view;
    const L = this.layout!;
    v.phase = "rewind";
    v.completeMs = this.clockMs;
    this.rewindFrom = v.head;
    const rest = 1 - v.head;
    this.rewindSpan = rest < 0.4 ? rest + 1 : rest;
    const root = midiToFrequency(this.tune.root + 12);
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "impact", frequency: root, level: 1, melody: false });
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "riser", frequency: root, loopSec: REWIND_MS / 1000, level: 0.8, melody: false });
    ctx.noteImpact?.();
    for (let i = 0; i < v.total; i++) {
      v.playMs[i] = this.clockMs;
      const mid = angleOf(0.5 * (v.tiles.start[i] + v.tiles.end[i]));
      this.burst(ctx, L.cx + Math.cos(mid) * L.radius, L.cy + Math.sin(mid) * L.radius, mid + Math.PI, 5, tileHue(v.tiles.level[i]), 0.4 * L.side);
    }
  }

  private emitNote(ctx: ModeContext, tile: number, level: number, finale: boolean) {
    const f = midiToFrequency(this.view.tiles.midi[tile]);
    // (`loopExact`: the tune's own pitches, whatever scale the Sound section snaps the other modes' notes to)
    const note: SoundEvent = { type: "hit", wallIndex: 0, loop: "pluck", frequency: f, level, loopExact: true, melody: false };
    if (finale) note.loopBright = true;
    ctx.addPendingSoundEvent(note);
    if (finale) ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chime", frequency: 2 * f, level: FINALE_CHIME_LEVEL, loopExact: true, melody: false });
  }

  /** `n` sparks from (x, y), fanned around `dir` (radians), in `hue` (every third one white). */
  private burst(ctx: ModeContext, x: number, y: number, dir: number, n: number, hue: number, speed: number, fan = 1.9) {
    const v = this.view;
    const k = (this.layout?.side ?? TUNED_SIDE) / TUNED_SIDE;
    for (let i = 0; i < n; i++) {
      // (the draws happen whether or not the pool has room, so a full pool never moves the seed's later draws)
      const a = dir + (ctx.random() - 0.5) * fan;
      const sp = speed * (0.35 + 0.65 * ctx.random());
      const life = 0.45 + 0.5 * ctx.random();
      if (v.sparkCount >= MAX_SPARKS) continue;
      const slot = v.sparkCount++;
      v.sparkX[slot] = x;
      v.sparkY[slot] = y;
      v.sparkVx[slot] = Math.cos(a) * sp;
      v.sparkVy[slot] = Math.sin(a) * sp;
      v.sparkSize[slot] = (1.4 + 1.8 * (i % 3) * 0.5) * k;
      v.sparkLife[slot] = life;
      v.sparkMaxLife[slot] = life;
      v.sparkHue[slot] = i % 3 === 2 ? -1 : hue;
    }
  }

  onPostSubStep() {}

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const L = this.layout;
    if (!L) return;
    // The sparks fly on, slow down and fade.
    const dt = dtMs / 1000;
    const keep = Math.pow(0.12, dt);
    for (let i = v.sparkCount - 1; i >= 0; i--) {
      v.sparkLife[i] -= dt;
      if (v.sparkLife[i] <= 0) {
        const last = --v.sparkCount;
        if (i !== last) {
          v.sparkX[i] = v.sparkX[last];
          v.sparkY[i] = v.sparkY[last];
          v.sparkVx[i] = v.sparkVx[last];
          v.sparkVy[i] = v.sparkVy[last];
          v.sparkSize[i] = v.sparkSize[last];
          v.sparkLife[i] = v.sparkLife[last];
          v.sparkMaxLife[i] = v.sparkMaxLife[last];
          v.sparkHue[i] = v.sparkHue[last];
        }
        continue;
      }
      v.sparkX[i] += v.sparkVx[i] * dt;
      v.sparkY[i] += v.sparkVy[i] * dt;
      v.sparkVx[i] *= keep;
      v.sparkVy[i] *= keep;
    }
    v.balls = ctx.getBalls().length;
    if (v.finished) return;
    const now = this.clockMs;
    const lapMs = this.settings.lapSec * 1000;
    if (this.heldBass >= 0) {
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bass", frequency: midiToFrequency(this.heldBass), level: 1, melody: false });
      this.heldBass = -1;
    }
    if (v.phase === "collect") {
      v.head = (now / lapMs) % 1;
      // (from where the last step played to, so no note is played twice or missed on a lap's seam)
      const from = this.lapPos;
      this.lapPos = now / lapMs;
      this.playCrossed(ctx, from, this.lapPos, false);
      if (now >= TIMEOUT_MS - 1e-6) {
        v.phase = "timeout";
        v.timeoutMs = now;
        v.finished = true;
        v.finishedMs = now;
      }
      return;
    }
    if (v.phase === "rewind") {
      const p = Math.min(1, (now - v.completeMs) / REWIND_MS);
      // (eased in and out: the spoke swings round to the top)
      v.head = (this.rewindFrom + this.rewindSpan * (p * p * (3 - 2 * p))) % 1;
      if (now >= v.completeMs + REWIND_MS - 1e-6) {
        v.phase = "finale";
        v.finaleMs = v.completeMs + REWIND_MS;
        v.head = 0;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bed", frequency: midiToFrequency(this.tune.root), loopMinor: this.tune.minor, level: 0.8, loopExact: true, melody: false });
        // The phrase starts on its first note, in the step the playhead reaches the top.
        this.finalePos = Math.max(0, (now - v.finaleMs) / lapMs);
        this.playCrossed(ctx, -1e-9, this.finalePos, true);
      }
      return;
    }
    if (v.phase === "finale") {
      // (from where the last step played to, so no note of the phrase is played twice or missed)
      const a = this.finalePos;
      const b = Math.max(a, (now - v.finaleMs) / lapMs);
      this.finalePos = b;
      if (b >= 1 - 1e-9) {
        this.playCrossed(ctx, a, 1 - 1e-9, true);
        v.phase = "chord";
        v.chordMs = now;
        v.head = 0;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
        // (accented, with its four notes: the run's one chord, the largest moment of the clip; the tone generator voices "chord"
        // from its root and colour alone, so the notes only say what it plays)
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "chord", frequency: midiToFrequency(this.tune.root), level: 1, loopMinor: this.tune.minor, loopExact: true, melody: false, accent: true, chord: finalChordOf(this.tune) });
        ctx.noteImpact?.();
        ctx.spawnConfetti(L.cx, L.cy);
        for (let i = 0; i < v.total; i++) v.playMs[i] = now;
        const each = Math.max(1, Math.floor(SPARKS_PER_CHORD / 12));
        for (let k = 0; k < 12; k++) {
          const dir = (k * TWO_PI) / 12;
          this.burst(ctx, L.cx + Math.cos(dir) * L.radius, L.cy + Math.sin(dir) * L.radius, dir + Math.PI, each, tileHue(k / 11), 0.7 * L.side, 2.6);
        }
        return;
      }
      v.head = b % 1;
      this.playCrossed(ctx, a, b, true);
      return;
    }
    if (v.phase === "chord" && now >= v.chordMs + END_HOLD_MS - 1e-6) {
      v.finished = true;
      v.finishedMs = now;
    }
  }

  /**
   * The playhead went from lap position `from` to `to` (laps, unwrapped): every lit tile whose start it crossed plays. In
   * the finale every tile plays with its chime and sparks, the kick falls every other slot and the bass on its own slots.
   */
  private playCrossed(ctx: ModeContext, from: number, to: number, finale: boolean) {
    const v = this.view;
    const T = v.tiles;
    const L = this.layout!;
    for (let i = 0; i < T.count; i++) {
      if (!finale && v.litMs[i] < 0) continue;
      if (Math.floor(to - T.start[i]) <= Math.floor(from - T.start[i])) continue;
      // (a tile lit in the very step the playhead reaches it waits for the next lap: the hit comes first)
      if (!finale && v.litMs[i] >= this.clockMs) continue;
      v.playMs[i] = this.clockMs;
      v.notes++;
      this.emitNote(ctx, i, finale ? FINALE_NOTE_LEVEL : NOTE_LEVEL, finale);
      if (finale) {
        const mid = angleOf(0.5 * (T.start[i] + T.end[i]));
        this.burst(ctx, L.cx + Math.cos(mid) * L.radius, L.cy + Math.sin(mid) * L.radius, mid + Math.PI, SPARKS_PER_NOTE, tileHue(T.level[i]), 0.45 * L.side);
      }
    }
    if (!finale) return;
    let kicked = false;
    for (let s = 0; s < T.slots; s += KICK_EVERY_SLOTS) {
      const at = s / T.slots;
      if (Math.floor(to - at) <= Math.floor(from - at)) continue;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "kick", level: FINALE_KICK_LEVEL, melody: false });
      kicked = true;
    }
    for (const [slot, midi] of this.tune.bass) {
      const at = slot / T.slots;
      if (Math.floor(to - at) <= Math.floor(from - at)) continue;
      // (the kick and the bass share one slot of the sound budget a step: the bass follows a step later)
      if (kicked) this.heldBass = midi;
      else ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bass", frequency: midiToFrequency(midi), level: 1, melody: false });
    }
  }

  /**
   * A resize rebuilds the ring for the new canvas: every ball keeps its place and its course in the ring. (The engine has
   * already moved the balls along the canvas's own axes; the ring scales with the square's side, so that stretch is undone.)
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || !this.layout) return true;
    const old = this.layout;
    this.rebuild(ctx);
    const L = this.layout!;
    const k = L.side / old.side;
    const sx = old.width > 0 ? L.width / old.width : 1;
    const sy = old.height > 0 ? L.height / old.height : 1;
    this.view.sparkCount = 0;
    for (const ball of ctx.getBalls()) {
      ball.trail.length = 0;
      ball.trailIndex = 0;
      ball.x = L.cx + ((ball.x - L.cx) / (sx || 1)) * k;
      ball.y = L.cy + ((ball.y - L.cy) / (sy || 1)) * k;
      ball.vx *= k;
      ball.vy *= k;
      ball.radius = L.ballRadius;
      ball.radiusScale = L.side / TUNED_SIDE;
    }
    return true;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** There are no engine rings: the ring is the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { song: v.song, lit: v.lit, total: v.total, hits: v.hits, notes: v.notes, phase: v.phase, complete: v.completeMs >= 0, chord: v.chordMs >= 0, timeout: v.timeoutMs >= 0, finished: v.finished };
  }
}
