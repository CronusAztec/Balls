import { isScaleId, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import { MAX_CHORD_NOTES, MAX_NOTES_PER_STEP, MAX_ORB_EVENTS_PER_FRAME, METAL_MIN_GAP_SEC, MUSIC_MIN_GAP_SEC, SLEEP_MIN_GAP_SEC, createOrbGroupScratch, groupOrbLandings, orbLevel, orbMusicNext, orbPitchHz, type OrbLandings, type OrbVoice } from "@/lib/audio/orbTones";
import { ORB_CEILING, atLeastMin } from "@/lib/uncap";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";

/**
 * Bouncing Orbs ("orbGrid" mode, feature orb-grid – after the Instagram clips "Satisfying physics simulation – N varied
 * bouncing orbs"; see the README's Bouncing Orbs section). A field of orbs – a square grid, a hex grid, a disc or octagons of concentric rings, `columns × rows` of
 * them (the count is the hook) – stands over a slab, each orb on its own floor spot. Every orb is an independent 1-D vertical
 * bounce: height h, launch speed v, gravity g, restitution e, solved in closed form between landings (h(τ) = v·τ − ½·g·τ²,
 * the next landing at 2v/g, then v ← e·v) and evaluated at every fixed 60 Hz step of the simulation clock, so a seed replays
 * exactly at any frame rate. An orb whose next apex would be below `REST_FRACTION` of its drop height settles; the run
 * finishes `SETTLE_HOLD_MS` after the last orb has settled (or at `maxSec`, the clip, at the latest).
 *
 * The orbs differ by one **varied property** – bounciness, drop height, release delay, size, gravity or bounce period – that
 * follows a **distribution** over the field (seeded random, corner to corner, centre outwards, rows, columns, spiral, ripple
 * bands, checker) with a **spread** (0 = all identical). Their different periods drift apart and the heights form a wave
 * surface. The **resolve moment** (the clip's payoff): with `resolve` on, each orb's time scale is fine-tuned (by at most
 * `TUNE_TIME_RANGE`, through its gravity – its restitution, drop and heights stay its own) so one of its landings falls exactly
 * on the field's pattern clock (`resolveTargetSec()`): at that instant every orb still bouncing slams the slab at once, then
 * the field dissolves again as their different restitutions drift apart. The "period" property bounces perfectly elastic
 * orbs whose periods are tuned to the clock, so the field resolves every cycle (landing, apex, landing…) – the pendulum-wave
 * trick. The resolve detector measures it whatever the tuning: the share of moving orbs whose phase passed through one small
 * phase window this step (`resolveCoverage()`), with hysteresis for the "in phase" moments.
 *
 * Sound: the landings of a step are grouped per row / ring (`groupOrbLandings()` in lib/audio/orbTones.ts) into at most
 * `MAX_NOTES_PER_STEP` voices, the loudest and nearest first, each a chord of the row's columns (or the ring's note) on the
 * Sound section's scale – notes, a rate-limited sleep sound, a melody the landings compose, a metal clink, or silence.
 *
 * Determinism: every random draw goes through `ctx.random()` at init (the tempo, the varied values, the random release
 * order), everything after it is arithmetic on the simulation clock. The engine holds one placeholder ball pinned at the
 * centre (the engine adds one to every mode; it is never drawn here); the orbs live in typed arrays.
 */

/* ------------------------------------------------------------------ options */

export const OG_PROPERTIES = ["bounciness", "height", "delay", "size", "gravity", "period"] as const;
export type OgProperty = (typeof OG_PROPERTIES)[number];
export const OG_DISTRIBUTIONS = ["varied", "corner", "centre", "rows", "columns", "spiral", "ripple", "checker"] as const;
export type OgDistribution = (typeof OG_DISTRIBUTIONS)[number];
export const OG_RELEASES = ["together", "outside-in", "inside-out", "row-by-row", "random"] as const;
export type OgRelease = (typeof OG_RELEASES)[number];
export const OG_ARRANGEMENTS = ["grid", "disc", "octagons", "hex"] as const;
export type OgArrangement = (typeof OG_ARRANGEMENTS)[number];
export const OG_FLOORS = ["slab", "plate", "grid", "none"] as const;
export type OgFloor = (typeof OG_FLOORS)[number];
export const OG_MATERIALS = ["glossy", "metallic", "matte", "glass"] as const;
export type OgMaterial = (typeof OG_MATERIALS)[number];
export const OG_PALETTES = ["height", "rings", "rows", "ball", "rainbow-field"] as const;
export type OgPalette = (typeof OG_PALETTES)[number];
export const OG_SOUNDS = ["notes", "sleep", "music", "metal", "silent"] as const;
export type OgSound = (typeof OG_SOUNDS)[number];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
export const isOgProperty = (v: unknown): v is OgProperty => isOneOf(OG_PROPERTIES, v);
export const isOgDistribution = (v: unknown): v is OgDistribution => isOneOf(OG_DISTRIBUTIONS, v);
export const isOgRelease = (v: unknown): v is OgRelease => isOneOf(OG_RELEASES, v);
export const isOgArrangement = (v: unknown): v is OgArrangement => isOneOf(OG_ARRANGEMENTS, v);
export const isOgFloor = (v: unknown): v is OgFloor => isOneOf(OG_FLOORS, v);
export const isOgMaterial = (v: unknown): v is OgMaterial => isOneOf(OG_MATERIALS, v);
export const isOgPalette = (v: unknown): v is OgPalette => isOneOf(OG_PALETTES, v);
export const isOgSound = (v: unknown): v is OgSound => isOneOf(OG_SOUNDS, v);

/* ------------------------------------------------------------------ constants */

/**
 * The memory-safety ceiling of the orbs one run builds is `ORB_CEILING` of lib/uncap.ts (250,000 – fifty times the account's
 * 70 × 70 clip; the justification is there): columns × rows past it keep the field's aspect at that many orbs, the settings
 * keep the typed values and the canvas says ARENA FULL.
 */
export { ORB_CEILING };
/** Gravity (field widths / s²) at the default Gravity setting (300): a drop from 0.3 field widths lands after 0.5 s. */
export const G_ORB = 2.4;
/** The Gravity setting the orbs' gravity is relative to. */
export const GRAVITY_REFERENCE = 300;
/** An orb settles at the landing after which its next apex would be below this share of its drop height. */
export const REST_FRACTION = 0.003;
/** The run finishes this long after the last orb settled (the end banner holds). */
export const SETTLE_HOLD_MS = 1500;
/** Bounciness spread: a spread of 1 ranges ±0.1 around the base restitution. */
export const E_SPAN = 0.2;
/** Delay spread: a spread of 1 delays the last orb by this many base fall times. */
export const DELAY_SPAN_FALLS = 4;
/** Period spread: a spread of 1 makes the fastest orb bounce this much faster than the base one. */
export const PERIOD_SPAN = 0.5;
/**
 * The seed's tempo: every time scale of the run moves by up to ± this share – Find Simulation lands a run length with it (the
 * default field's ~27 s run spans 23.8–30.3 s over the seeds: a 30 s run is there to find, and most seeds settle in a 30 s clip).
 */
export const TEMPO_JITTER = 0.12;
/** The resolve tuning changes an orb's time scale by at most this share (its gravity by its square; an orb it cannot tune stays as it is). */
export const TUNE_TIME_RANGE = 0.2;
/** The pattern clock of a decaying field: half the base orb's Zeno time (`t₁ (1 + e) / (1 − e)`), at most `DECAY_MAX_FALLS` fall times. */
export const RESOLVE_ZENO_SHARE = 0.5;
export const DECAY_MAX_FALLS = 16;
/**
 * The pattern clock of an elastic field (the period property, a bounciness of 1 or more): thirty base bounce periods, the
 * classic pendulum wave's cycle – long enough for many distinct periods (harmonics of the clock) across the spread, so the
 * field dissolves into travelling waves, groups and back.
 */
export const CYCLE_FALLS = 60;
/** Size: a bigger orb (centres level at the start) falls a shorter way and, heavier against the air, this power of its size faster. */
export const SIZE_GRAVITY_POWER = 1;
/** Spiral distribution: turns of the arms from the centre to the rim. */
export const SPIRAL_TWIST = 1.25;
/** Ripple distribution: bands from the centre to the rim. */
export const RIPPLE_BANDS = 2.5;
/** Resolve detector: phase bins, the window (bins either side), hysteresis thresholds and the moving orbs it needs. */
export const RESOLVE_BINS = 64;
export const RESOLVE_WINDOW_BINS = 2;
export const RESOLVE_LOW = 0.45;
export const RESOLVE_HIGH = 0.8;
export const RESOLVE_MIN_MOVING = 4;
/** An orb's launch speed never grows past this (a bounciness above 1 for a very long run stays a finite number). */
export const V_SAFE = 1e150;
/** Landings one orb may make within one step before the rest of its bounces are summed up (Zeno: it settles). */
const LANDINGS_PER_STEP = 256;
/** Bounce-math bounce reports per step (every landing is a bounce; the runtime keeps 512 events a step at most). */
const BOUNCE_NOTES_PER_STEP = 64;

export const OG_WAITING = 0;
export const OG_FLYING = 1;
export const OG_SETTLED = 2;

/* ------------------------------------------------------------------ settings */

export interface OrbGridSettings {
  /** Orbs across and along the field (the grid; the ring arrangements place columns × rows orbs), 1–80 on the sliders, any whole number typed. */
  columns: number;
  rows: number;
  arrangement: OgArrangement;
  /** The property that varies over the field, its distribution and spread (0 = every orb alike). */
  property: OgProperty;
  distribution: OgDistribution;
  spread: number;
  /** When the orbs are let go, and the seconds between two release steps (rings, rows, random slots). */
  release: OgRelease;
  stagger: number;
  /** Drop height (field widths, from the slab to the orb's bottom), orb diameter (share of the spacing), base restitution. */
  dropHeight: number;
  orbSize: number;
  bounciness: number;
  /** Tune the field so the pattern resolves – every moving orb lands at once on the pattern clock. */
  resolve: boolean;
  // The look and the sound (they follow live; the physics above waits for the next init).
  /** Camera elevation (degrees above the slab), rotation around the field's centre (degrees), a slow auto-orbit. */
  elevation: number;
  rotation: number;
  orbit: boolean;
  floor: OgFloor;
  material: OgMaterial;
  palette: OgPalette;
  /** The "1089 bouncing orbs" line in the exported square. */
  hud: boolean;
  sound: OgSound;
  /** The Sound section's scale and root, Gerald's Ball Colour (the "ball" palette) and the clip (the run ends there at the latest; 0 = no end). */
  scale: ScaleId;
  rootNote: number;
  ballColor: string;
  maxSec: number;
}

export const DEFAULT_ORB_GRID_SETTINGS: OrbGridSettings = {
  columns: 33,
  rows: 33,
  arrangement: "grid",
  property: "bounciness",
  distribution: "varied",
  spread: 0.6,
  release: "together",
  stagger: 0.06,
  dropHeight: 0.3,
  orbSize: 0.78,
  bounciness: 0.904,
  resolve: true,
  elevation: 30,
  rotation: 35,
  orbit: false,
  floor: "slab",
  material: "glossy",
  palette: "height",
  hud: true,
  sound: "notes",
  scale: "chromatic",
  rootNote: 0,
  ballColor: "#FFFFFF",
  maxSec: 0,
};

/** Slider comfort ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const ORB_GRID_RANGES = {
  ogColumns: { min: 1, max: 80, step: 1 },
  ogRows: { min: 1, max: 80, step: 1 },
  ogSpread: { min: 0, max: 1, step: 0.05 },
  ogStagger: { min: 0, max: 0.5, step: 0.01 },
  ogDropHeight: { min: 0.05, max: 1, step: 0.01 },
  ogOrbSize: { min: 0.1, max: 1, step: 0.02 },
  ogBounciness: { min: 0, max: 1, step: 0.001 },
  ogElevation: { min: 5, max: 90, step: 1 },
  ogRotation: { min: 0, max: 360, step: 1 },
} as const;

/** The Bouncing Orbs fields of the SimulatorSettings object. */
export interface OrbGridFields {
  ogColumns: number;
  ogRows: number;
  ogArrangement: OgArrangement;
  ogVaried: OgProperty;
  ogDistribution: OgDistribution;
  ogSpread: number;
  ogRelease: OgRelease;
  ogStagger: number;
  ogDropHeight: number;
  ogOrbSize: number;
  ogBounciness: number;
  ogResolve: boolean;
  ogElevation: number;
  ogRotation: number;
  ogOrbit: boolean;
  ogFloor: OgFloor;
  ogMaterial: OgMaterial;
  ogPalette: OgPalette;
  ogHud: boolean;
  ogSound: OgSound;
}

/** The fields that change the physics: a change restarts the run and drops a found seed (the rest follows live). */
export const ORB_GRID_PHYSICS_FIELDS = ["ogColumns", "ogRows", "ogArrangement", "ogVaried", "ogDistribution", "ogSpread", "ogRelease", "ogStagger", "ogDropHeight", "ogOrbSize", "ogBounciness", "ogResolve"] as const satisfies readonly (keyof OrbGridFields)[];

function num(value: unknown, range: { min: number }, fallback: number): number {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && (typeof value !== "string" || value.trim() !== "") ? atLeastMin(n, range) /* never a maximum */ : fallback;
}

/** A whole number from its minimum up (the counts), the fallback for anything invalid. */
function count(value: unknown, range: { min: number }, fallback: number): number {
  return Math.round(num(value, range, fallback));
}

/** Fills in the defaults and validates every value (counts whole, numbers from their minimum up and never capped, known options). */
export function resolveOrbGridSettings(config: Partial<OrbGridSettings> | null | undefined): OrbGridSettings {
  const out = { ...DEFAULT_ORB_GRID_SETTINGS };
  if (!config) return out;
  const R = ORB_GRID_RANGES;
  if (config.columns !== undefined) out.columns = count(config.columns, R.ogColumns, out.columns);
  if (config.rows !== undefined) out.rows = count(config.rows, R.ogRows, out.rows);
  if (isOgArrangement(config.arrangement)) out.arrangement = config.arrangement;
  if (isOgProperty(config.property)) out.property = config.property;
  if (isOgDistribution(config.distribution)) out.distribution = config.distribution;
  if (config.spread !== undefined) out.spread = num(config.spread, R.ogSpread, out.spread);
  if (isOgRelease(config.release)) out.release = config.release;
  if (config.stagger !== undefined) out.stagger = num(config.stagger, R.ogStagger, out.stagger);
  if (config.dropHeight !== undefined) out.dropHeight = num(config.dropHeight, R.ogDropHeight, out.dropHeight);
  if (config.orbSize !== undefined) out.orbSize = num(config.orbSize, R.ogOrbSize, out.orbSize);
  if (config.bounciness !== undefined) out.bounciness = num(config.bounciness, R.ogBounciness, out.bounciness);
  if (typeof config.resolve === "boolean") out.resolve = config.resolve;
  if (config.elevation !== undefined) out.elevation = num(config.elevation, R.ogElevation, out.elevation);
  if (config.rotation !== undefined) out.rotation = num(config.rotation, R.ogRotation, out.rotation);
  if (typeof config.orbit === "boolean") out.orbit = config.orbit;
  if (isOgFloor(config.floor)) out.floor = config.floor;
  if (isOgMaterial(config.material)) out.material = config.material;
  if (isOgPalette(config.palette)) out.palette = config.palette;
  if (typeof config.hud === "boolean") out.hud = config.hud;
  if (isOgSound(config.sound)) out.sound = config.sound;
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  if (typeof config.ballColor === "string" && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(config.ballColor)) out.ballColor = config.ballColor;
  if (config.maxSec !== undefined) {
    const m = Number(config.maxSec);
    out.maxSec = Number.isFinite(m) && m > 0 ? m : 0;
  }
  return out;
}

/** The fields → the mode's settings (with the Sound section's scale and root, the Ball Colour and the clip length when given). */
export function orbGridSettingsOf(source: Pick<OrbGridFields, keyof OrbGridFields> & { scale?: ScaleId; rootNote?: number; ballColor?: string; recordingDuration?: number }): OrbGridSettings {
  return {
    columns: source.ogColumns,
    rows: source.ogRows,
    arrangement: source.ogArrangement,
    property: source.ogVaried,
    distribution: source.ogDistribution,
    spread: source.ogSpread,
    release: source.ogRelease,
    stagger: source.ogStagger,
    dropHeight: source.ogDropHeight,
    orbSize: source.ogOrbSize,
    bounciness: source.ogBounciness,
    resolve: source.ogResolve,
    elevation: source.ogElevation,
    rotation: source.ogRotation,
    orbit: source.ogOrbit,
    floor: source.ogFloor,
    material: source.ogMaterial,
    palette: source.ogPalette,
    hud: source.ogHud,
    sound: source.ogSound,
    scale: source.scale ?? DEFAULT_ORB_GRID_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_ORB_GRID_SETTINGS.rootNote,
    ballColor: source.ballColor ?? DEFAULT_ORB_GRID_SETTINGS.ballColor,
    maxSec: source.recordingDuration ?? 0,
  };
}

/** The settings → the SimulatorSettings fields. */
export function orbGridSettingFields(s: OrbGridSettings): OrbGridFields {
  return {
    ogColumns: s.columns,
    ogRows: s.rows,
    ogArrangement: s.arrangement,
    ogVaried: s.property,
    ogDistribution: s.distribution,
    ogSpread: s.spread,
    ogRelease: s.release,
    ogStagger: s.stagger,
    ogDropHeight: s.dropHeight,
    ogOrbSize: s.orbSize,
    ogBounciness: s.bounciness,
    ogResolve: s.resolve,
    ogElevation: s.elevation,
    ogRotation: s.rotation,
    ogOrbit: s.orbit,
    ogFloor: s.floor,
    ogMaterial: s.material,
    ogPalette: s.palette,
    ogHud: s.hud,
    ogSound: s.sound,
  };
}

export function defaultOrbGridFields(): OrbGridFields {
  return orbGridSettingFields(DEFAULT_ORB_GRID_SETTINGS);
}

/** Validates the feature's fields (URL parameters, presets and project files alike): numbers from their minimum up (never a maximum), known options, real booleans. */
export function resolveOrbGridFields(source: Partial<OrbGridFields>): OrbGridFields {
  return orbGridSettingFields(
    resolveOrbGridSettings({
      columns: source.ogColumns,
      rows: source.ogRows,
      arrangement: source.ogArrangement,
      property: source.ogVaried,
      distribution: source.ogDistribution,
      spread: source.ogSpread,
      release: source.ogRelease,
      stagger: source.ogStagger,
      dropHeight: source.ogDropHeight,
      orbSize: source.ogOrbSize,
      bounciness: source.ogBounciness,
      resolve: source.ogResolve,
      elevation: source.ogElevation,
      rotation: source.ogRotation,
      orbit: source.ogOrbit,
      floor: source.ogFloor,
      material: source.ogMaterial,
      palette: source.ogPalette,
      hud: source.ogHud,
      sound: source.ogSound,
    }),
  );
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL (values past the slider travel exactly through the uncapped writer). */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** The URL keys (as the feature's brief names them): numbers, options and switches. */
const NUMERIC_KEYS = { ogC: "ogColumns", ogR: "ogRows", ogS: "ogSpread", ogT: "ogStagger", ogH: "ogDropHeight", ogZ: "ogOrbSize", ogB: "ogBounciness", ogE: "ogElevation", ogRot: "ogRotation" } as const;
const OPTION_KEYS = { ogA: "ogArrangement", ogV: "ogVaried", ogD: "ogDistribution", ogL: "ogRelease", ogF: "ogFloor", ogM: "ogMaterial", ogP: "ogPalette", ogSnd: "ogSound" } as const;
const SWITCH_KEYS = { ogRes: "ogResolve", ogO: "ogOrbit", ogHud: "ogHud" } as const;

/** Writes the fields that differ from `base` into the URL: ogC, ogR, ogA, ogV, ogD, ogS, ogL, ogT, ogH, ogZ, ogB, ogRes, ogE, ogRot, ogO, ogF, ogM, ogP, ogHud, ogSnd. */
export function writeOrbGridParams(settings: OrbGridFields, base: OrbGridFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(OPTION_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field]);
  for (const [key, field] of Object.entries(SWITCH_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** A URL parameter by its key, or by the same key in lower case (a hand-typed link). */
function param(params: URLSearchParams, key: string): string | null {
  return params.get(key) ?? params.get(key.toLowerCase());
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readOrbGridParams(params: URLSearchParams, settings: OrbGridFields) {
  const next: Partial<OrbGridFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = param(params, key);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  for (const [key, field] of Object.entries(OPTION_KEYS)) {
    const raw = param(params, key);
    if (raw !== null) (next as Record<string, unknown>)[field] = raw;
  }
  for (const [key, field] of Object.entries(SWITCH_KEYS)) {
    const raw = param(params, key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const resolved = resolveOrbGridFields(next);
  // An unknown option keeps the value the settings had (the defaults of the mode).
  for (const field of Object.values(OPTION_KEYS)) if (next[field] !== resolved[field]) (resolved as unknown as Record<string, unknown>)[field] = settings[field];
  Object.assign(settings, resolved);
}

/** The orbs a field of `columns × rows` builds: the product, at most `ORB_CEILING` (its aspect kept); and whether it is past it. */
export function orbFieldSize(columns: number, rows: number): { columns: number; rows: number; count: number; full: boolean } {
  const c = Math.max(1, Math.round(Number.isFinite(columns) ? columns : 1));
  const r = Math.max(1, Math.round(Number.isFinite(rows) ? rows : 1));
  if (c * r <= ORB_CEILING) return { columns: c, rows: r, count: c * r, full: false };
  const f = Math.sqrt(ORB_CEILING / (c * r));
  let cc = Math.max(1, Math.floor(c * f));
  let rr = Math.max(1, Math.floor(r * f));
  // A very thin field (a line of millions): one side at the ceiling.
  if (cc * rr > ORB_CEILING) {
    if (cc > rr) cc = Math.max(1, Math.floor(ORB_CEILING / rr));
    else rr = Math.max(1, Math.floor(ORB_CEILING / cc));
  }
  return { columns: cc, rows: rr, count: cc * rr, full: true };
}

/** True when the fields ask for more orbs than a run builds (ARENA FULL). */
export function orbGridPastCeiling(source: Pick<OrbGridFields, "ogColumns" | "ogRows">): boolean {
  return orbFieldSize(source.ogColumns, source.ogRows).full;
}

/* ------------------------------------------------------------------ presets (the account's clips) */

export interface OrbGridPreset {
  id: "varied" | "corner" | "centre" | "octagons" | "metallic" | "sleep" | "music" | "grid70";
  /** Translation key of its name (Controls namespace). */
  labelKey: string;
  fields: Partial<OrbGridFields>;
}

/**
 * The Presets section's Bouncing Orbs presets, after the account's most-liked clips: each is the mode's defaults plus these
 * fields (`orbGridPresetFields()`), so a preset always gives the same field.
 */
export const ORB_GRID_PRESETS: readonly OrbGridPreset[] = [
  { id: "varied", labelKey: "ogPresetVaried", fields: { ogColumns: 33, ogRows: 33, ogVaried: "bounciness", ogDistribution: "varied", ogMaterial: "glossy", ogPalette: "height", ogSound: "notes" } },
  { id: "corner", labelKey: "ogPresetCorner", fields: { ogColumns: 44, ogRows: 43, ogVaried: "bounciness", ogDistribution: "corner", ogRelease: "together", ogSpread: 0.8, ogBounciness: 0.882, ogPalette: "height" } },
  { id: "centre", labelKey: "ogPresetCentre", fields: { ogColumns: 22, ogRows: 20, ogVaried: "height", ogDistribution: "centre", ogSpread: 0.7, ogBounciness: 0.94, ogPalette: "height" } },
  { id: "octagons", labelKey: "ogPresetOctagons", fields: { ogColumns: 52, ogRows: 26, ogArrangement: "octagons", ogRelease: "outside-in", ogStagger: 0.12, ogDistribution: "centre", ogBounciness: 0.9, ogPalette: "rings", ogFloor: "plate", ogElevation: 38 } },
  { id: "metallic", labelKey: "ogPresetMetallic", fields: { ogColumns: 25, ogRows: 21, ogMaterial: "metallic", ogSound: "metal", ogFloor: "plate", ogPalette: "ball", ogDistribution: "ripple" } },
  { id: "sleep", labelKey: "ogPresetSleep", fields: { ogColumns: 22, ogRows: 22, ogSound: "sleep", ogMaterial: "matte", ogDistribution: "spiral", ogDropHeight: 0.36, ogBounciness: 0.91, ogSpread: 0.5 } },
  { id: "music", labelKey: "ogPresetMusic", fields: { ogColumns: 22, ogRows: 22, ogSound: "music", ogDistribution: "rows", ogPalette: "rainbow-field" } },
  { id: "grid70", labelKey: "ogPresetGrid70", fields: { ogColumns: 70, ogRows: 70, ogDistribution: "corner" } },
];

/** A preset's whole field: the mode's defaults with its overrides. */
export function orbGridPresetFields(preset: OrbGridPreset): OrbGridFields {
  return resolveOrbGridFields({ ...defaultOrbGridFields(), ...preset.fields });
}

/* ------------------------------------------------------------------ layout */

/** Where the orbs stand: floor spots (field widths, centred on 0), rings, rows, columns and normalised positions. */
export interface OrbLayout {
  arrangement: OgArrangement;
  count: number;
  /** The grid's columns and rows (the ring arrangements: their quantised position rows and columns). */
  columns: number;
  rows: number;
  /** Rings from the centre (0) out; the last one's index + 1. */
  ringCount: number;
  /** Centre distance of two neighbours (field widths). */
  spacing: number;
  /** The field's bounding radius around its centre (field widths). */
  radius: number;
  x: Float32Array;
  y: Float32Array;
  /** 0–1 across (u) and along (v) the field's bounding box. */
  u: Float32Array;
  v: Float32Array;
  ring: Int32Array;
  row: Int32Array;
  col: Int32Array;
}

function emptyLayout(arrangement: OgArrangement, n: number): OrbLayout {
  return { arrangement, count: n, columns: 1, rows: 1, ringCount: 1, spacing: 1, radius: 0, x: new Float32Array(n), y: new Float32Array(n), u: new Float32Array(n), v: new Float32Array(n), ring: new Int32Array(n), row: new Int32Array(n), col: new Int32Array(n) };
}

/** Ring-arrangement orbs per ring: the disc's `round(2πk)`, the octagons' 8k (k orbs on each edge); one orb in the centre. */
export function orbsOnRing(arrangement: "disc" | "octagons", k: number): number {
  if (k <= 0) return 1;
  return arrangement === "octagons" ? 8 * k : Math.max(1, Math.round(2 * Math.PI * k));
}

/** Rings needed for `n` orbs (the last one may be partly filled). */
export function ringsFor(arrangement: "disc" | "octagons", n: number): number {
  let total = 0;
  let k = 0;
  while (total < n) {
    total += orbsOnRing(arrangement, k);
    k++;
    if (k > 1e7) break;
  }
  return k;
}

const OCT_COS = Math.cos(Math.PI / 8);

/** Lays `n` orbs out (`columns × rows` of them, at most the ceiling): grid, hex, disc or octagons, inside a unit field. */
export function buildOrbLayout(arrangement: OgArrangement, columns: number, rows: number): OrbLayout {
  const size = orbFieldSize(columns, rows);
  const n = size.count;
  const L = emptyLayout(arrangement, n);
  if (arrangement === "grid" || arrangement === "hex") {
    const C = size.columns;
    const R = size.rows;
    const hex = arrangement === "hex";
    const rowStep = hex ? Math.sqrt(3) / 2 : 1;
    const width = hex && R > 1 ? C - 0.5 : C;
    const s = 1 / Math.max(width, R * rowStep, 1);
    // (a hex field's odd rows sit half a spacing to the right: the field is centred on both kinds of row)
    const cx = hex && R > 1 ? (C - 0.5) / 2 : (C - 1) / 2;
    const cy = (R - 1) / 2;
    let maxR = 0;
    for (let r = 0; r < R; r++) {
      const shift = hex && R > 1 && r % 2 === 1 ? 0.5 : 0;
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        const x = (c + shift - cx) * s;
        const y = (r - cy) * s * rowStep;
        L.x[i] = x;
        L.y[i] = y;
        L.u[i] = C > 1 ? c / (C - 1) : 0.5;
        L.v[i] = R > 1 ? r / (R - 1) : 0.5;
        L.ring[i] = Math.floor(Math.max(Math.abs(c - (C - 1) / 2), Math.abs(r - (R - 1) / 2)) + 1e-9);
        L.row[i] = r;
        L.col[i] = c;
        const d = Math.hypot(x, y);
        if (d > maxR) maxR = d;
      }
    }
    let ringMax = 0;
    for (let i = 0; i < n; i++) if (L.ring[i] > ringMax) ringMax = L.ring[i];
    L.columns = C;
    L.rows = R;
    L.ringCount = ringMax + 1;
    L.spacing = s;
    L.radius = maxR + s / 2;
    return L;
  }
  // Concentric rings: the disc (circles of round(2πk) orbs) and the octagons (8k orbs, k on each edge).
  const K = ringsFor(arrangement, n);
  const outer = Math.max(1, K - 1);
  const s = arrangement === "octagons" ? (0.5 * OCT_COS) / outer : 0.5 / outer;
  let placed = 0;
  for (let k = 0; k < K && placed < n; k++) {
    const full = orbsOnRing(arrangement, k);
    const m = Math.min(full, n - placed);
    for (let j = 0; j < m; j++) {
      const i = placed + j;
      let x = 0;
      let y = 0;
      if (k > 0) {
        const t = (j + 0.5 * (k % 2)) / m;
        if (arrangement === "octagons") {
          // The octagon's perimeter, its edges axis-aligned: vertex q at angle π/8 + q·π/4 on the circumradius.
          const Rk = (k * s) / OCT_COS;
          const pos = t * 8;
          const q = Math.floor(pos) % 8;
          const f = pos - Math.floor(pos);
          const a0 = Math.PI / 8 + (q * Math.PI) / 4;
          const a1 = a0 + Math.PI / 4;
          x = Rk * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * f);
          y = Rk * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * f);
        } else {
          const a = t * 2 * Math.PI;
          x = k * s * Math.cos(a);
          y = k * s * Math.sin(a);
        }
      }
      L.x[i] = x;
      L.y[i] = y;
      L.ring[i] = k;
    }
    placed += m;
  }
  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, Math.hypot(L.x[i], L.y[i]));
  const span = Math.max(1e-9, 2 * maxR);
  const lines = Math.max(1, Math.round(span / s) + 1);
  for (let i = 0; i < n; i++) {
    L.u[i] = maxR > 0 ? (L.x[i] + maxR) / span : 0.5;
    L.v[i] = maxR > 0 ? (L.y[i] + maxR) / span : 0.5;
    L.row[i] = Math.round(L.v[i] * (lines - 1));
    L.col[i] = Math.round(L.u[i] * (lines - 1));
  }
  L.columns = lines;
  L.rows = lines;
  L.ringCount = K;
  L.spacing = s;
  L.radius = maxR + s / 2;
  return L;
}

/* ------------------------------------------------------------------ distributions */

/**
 * The distribution's value (0–1) of orb `i` of `layout`: seeded random (`rnd`), corner to corner, centre outwards, by row or
 * column, a spiral, ripple bands or a checker board. `rhoMax`: the largest centre distance of the layout's orbs.
 */
export function distributionValue(kind: OgDistribution, layout: OrbLayout, i: number, rhoMax: number, rnd: number): number {
  const x = layout.x[i];
  const y = layout.y[i];
  const rho = rhoMax > 0 ? Math.min(1, Math.hypot(x, y) / rhoMax) : 0;
  switch (kind) {
    case "varied":
      return rnd;
    case "corner":
      return (layout.u[i] + layout.v[i]) / 2;
    case "centre":
      return rho;
    case "rows":
      return layout.v[i];
    case "columns":
      return layout.u[i];
    case "spiral": {
      const a = Math.atan2(y, x) / (2 * Math.PI) + 0.5 + SPIRAL_TWIST * rho;
      return a - Math.floor(a);
    }
    case "ripple":
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * RIPPLE_BANDS * rho);
    case "checker":
      return (layout.row[i] + layout.col[i]) % 2 === 0 ? 0 : 1;
  }
}

/** The largest centre distance of a layout's orbs. */
export function layoutRhoMax(layout: OrbLayout): number {
  let m = 0;
  for (let i = 0; i < layout.count; i++) m = Math.max(m, Math.hypot(layout.x[i], layout.y[i]));
  return m;
}

/**
 * The release step of orb `i` (its delay is step × stagger): 0 together; the ring count from the outside (outside-in) or the
 * centre (inside-out); its row; or a seeded slot among the rows (random).
 */
export function releaseStep(release: OgRelease, layout: OrbLayout, i: number, rnd: number): number {
  switch (release) {
    case "together":
      return 0;
    case "outside-in":
      return layout.ringCount - 1 - layout.ring[i];
    case "inside-out":
      return layout.ring[i];
    case "row-by-row":
      return layout.row[i];
    case "random":
      return Math.floor(rnd * layout.rows);
  }
}

/* ------------------------------------------------------------------ bounce maths */

/** Σ_{j=1..m} e^j (0 for m ≤ 0), stable near e = 1. */
export function bounceSum(e: number, m: number): number {
  if (m <= 0) return 0;
  if (Math.abs(1 - e) < 1e-9) return m;
  return (e * (1 - Math.pow(e, m))) / (1 - e);
}

/** Seconds after its release at which an orb dropped from rest (fall time `t1`) lands for the k-th time (k ≥ 1). */
export function landingTime(t1: number, e: number, k: number): number {
  return t1 * (1 + 2 * bounceSum(e, k - 1));
}

/** Whether an orb of restitution e still bounces into its k-th landing (it settles at the first landing whose next apex is under REST_FRACTION of its drop). */
export function landsAgain(e: number, k: number): boolean {
  if (k <= 1) return true;
  if (e >= 1) return true;
  return Math.pow(e, 2 * (k - 1)) >= REST_FRACTION;
}

/**
 * The time scale (a factor on the fall time `t1`; its gravity is divided by its square) that makes an orb dropped from rest,
 * restitution `e`, land exactly `target` seconds after its release: the landing just before or after the target – whichever
 * needs the smaller change, as long as the orb still bounces into it – within ±`TUNE_TIME_RANGE`; NaN when none can be
 * reached. The orb keeps its own restitution, so the field's variety is untouched: only its whole bounce runs a few percent
 * faster or slower (the drop and the heights stay the same).
 */
export function tuneTimeScale(t1: number, e: number, target: number): number {
  if (!(t1 > 0) || !(target > 0) || !(e >= 0)) return NaN;
  // The first landing at or after the target (k ≥ 1), untuned.
  let k = 1;
  while (k < 1e6 && landsAgain(e, k + 1) && landingTime(t1, e, k) < target) k++;
  let best = NaN;
  for (let c = Math.max(1, k - 1); c <= k; c++) {
    if (!landsAgain(e, c)) continue;
    const scale = target / landingTime(t1, e, c);
    if (!(Math.abs(scale - 1) <= TUNE_TIME_RANGE)) continue;
    if (!Number.isFinite(best) || Math.abs(scale - 1) < Math.abs(best - 1)) best = scale;
  }
  return best;
}

/**
 * The field's pattern clock (seconds of the run): when the tuned orbs land together. Half the base orb's Zeno time after
 * half the release span (a decaying field, at most `DECAY_MAX_FALLS` fall times), `CYCLE_FALLS` fall times for an elastic one
 * (the period property, a bounciness of 1 or more); `t1` is the base orb's fall time.
 */
export function resolveTargetSec(property: OgProperty, bounciness: number, t1: number, releaseSpan: number): number {
  if (!(t1 > 0) || !Number.isFinite(t1)) return 0;
  const elastic = property === "period" || bounciness >= 1;
  const falls = elastic ? CYCLE_FALLS : Math.min(DECAY_MAX_FALLS, (RESOLVE_ZENO_SHARE * (1 + bounciness)) / Math.max(1e-9, 1 - bounciness));
  return releaseSpan / 2 + t1 * falls;
}

/* ------------------------------------------------------------------ resolve detector */

/**
 * Adds one orb to the resolve detector's circular coverage (a difference array of `RESOLVE_BINS + 1`): the phases it swept this
 * step (`phase` − `sweep` … `phase`) widened by the window either side. `phase` and `sweep` are shares of its bounce (0 =
 * landing, 0.5 = apex).
 */
export function addPhaseCoverage(diff: Float64Array, phase: number, sweep: number) {
  const B = RESOLVE_BINS;
  const end = Math.floor(phase * B) + RESOLVE_WINDOW_BINS;
  let start = Math.floor((phase - sweep) * B) - RESOLVE_WINDOW_BINS;
  if (end - start + 1 >= B) {
    diff[0] += 1;
    diff[B] -= 1;
    return;
  }
  start = ((start % B) + B) % B;
  const e = ((end % B) + B) % B;
  if (start <= e) {
    diff[start] += 1;
    diff[e + 1] -= 1;
  } else {
    diff[0] += 1;
    diff[e + 1] -= 1;
    diff[start] += 1;
    diff[B] -= 1;
  }
}

/** The best-covered phase window's share of `counted` orbs (0–1), from the difference array (cleared afterwards). */
export function coverageShare(diff: Float64Array, counted: number): number {
  let run = 0;
  let best = 0;
  for (let b = 0; b < RESOLVE_BINS; b++) {
    run += diff[b];
    if (run > best) best = run;
  }
  diff.fill(0);
  return counted > 0 ? Math.min(1, best / counted) : 0;
}

/**
 * The resolve detector on given phases (pure, for tests and tools): the share of the orbs whose phase – swept by `sweeps[i]`
 * this step – falls in one window of `±RESOLVE_WINDOW_BINS` bins.
 */
export function resolveCoverage(phases: ArrayLike<number>, sweeps: ArrayLike<number> | null, n: number): number {
  const diff = new Float64Array(RESOLVE_BINS + 1);
  for (let i = 0; i < n; i++) addPhaseCoverage(diff, phases[i] - Math.floor(phases[i]), sweeps ? sweeps[i] : 0);
  return coverageShare(diff, n);
}

/* ------------------------------------------------------------------ the view */

export interface OrbGridView {
  settings: OrbGridSettings;
  layout: OrbLayout | null;
  /** Orbs in the run (at most the ceiling), the count the settings ask for, and whether that is past the ceiling (ARENA FULL). */
  count: number;
  requested: number;
  full: boolean;
  /** Per orb: radius (field widths), current height of its bottom above the slab, distribution value, state, drop height. */
  radius: Float32Array;
  height: Float32Array;
  dval: Float32Array;
  state: Uint8Array;
  drop: Float32Array;
  /** The largest drop height (the height palette's top) and the base orb radius. */
  maxDrop: number;
  baseRadius: number;
  /** The seed's tempo, the pattern clock (ms of the run; 0 = none) and the run's clock (ms). */
  tempo: number;
  resolvePlanMs: number;
  timeMs: number;
  // Counters.
  released: number;
  releasedRings: number;
  bounces: number;
  landedStep: number;
  settled: number;
  moving: number;
  /** The resolve detector: this step's in-phase share of the moving orbs, the first "in phase" moment (ms, −1 = none yet), how many so far, the last one. */
  resolve: number;
  resolveAtMs: number;
  resolves: number;
  lastResolveMs: number;
  /** Orbs the tuning put on the pattern clock. */
  tuned: number;
  allSettled: boolean;
  /** Ms the last orb settled (−1 = not yet). */
  settledAtMs: number;
  finished: boolean;
  finishedMs: number;
  /** "settled" (every orb at rest) or "time" (the clip ended first). */
  finishReason: "" | "settled" | "time";
  /** Sound: voices queued so far, notes (pitches) in them, the last frequencies queued. */
  voices: number;
  notes: number;
  lastPitches: number[];
  /** Bumped by every init: the renderer drops its caches of the old field. */
  generation: number;
}

/** The nominal length of a run of these settings (s, the seed's tempo aside): the last orb settled plus the hold; Infinity when it never settles. */
export function orbGridNominalRunSec(settings: OrbGridSettings, gravity = GRAVITY_REFERENCE): number {
  const plan = planOrbGrid(settings, gravity, 1, null);
  return plan.neverSettles ? Infinity : plan.settleSec + SETTLE_HOLD_MS / 1000;
}

/**
 * The panel's summary of a field (the seed's tempo aside): the orbs a run builds and the count asked for, when it settles –
 * the last orb at rest plus the hold (s; Infinity: never) – and the planned resolve moment (s; 0: none).
 */
export function orbGridSummary(settings: OrbGridSettings, gravity = GRAVITY_REFERENCE): { count: number; requested: number; full: boolean; settleSec: number; resolveSec: number } {
  const plan = planOrbGrid(settings, gravity, 1, null);
  return { count: plan.count, requested: plan.requested, full: plan.full, settleSec: plan.neverSettles ? Infinity : plan.settleSec + SETTLE_HOLD_MS / 1000, resolveSec: plan.resolveSec };
}

/** Whether a field of these settings never settles (the period property, an orb bouncing elastically or harder, no gravity, no drop): the run ends with the clip. */
export function orbGridNeverSettles(settings: Partial<OrbGridSettings> | null | undefined, gravity = GRAVITY_REFERENCE): boolean {
  const s = resolveOrbGridSettings(settings);
  if (s.property === "period") return true;
  if (!(gravity > 0)) return true;
  // The bounciest orb (the resolve tuning keeps every orb's restitution: `tuneTimeScale()`).
  return topRestitution(s) >= 1;
}

/** The largest untuned restitution of a field: the base, plus half the spread's range when the bounciness is what varies. */
export function topRestitution(s: Pick<OrbGridSettings, "property" | "bounciness" | "spread">): number {
  const e0 = Math.max(0, s.bounciness);
  return s.property === "bounciness" ? e0 + 0.5 * Math.max(0, s.spread) * E_SPAN : s.property === "period" ? 1 : e0;
}

/* ------------------------------------------------------------------ the plan (init) */

/** Everything init derives from the settings and the seed (pure: the tests and the panel's summary use it too). */
export interface OrbGridPlan {
  layout: OrbLayout;
  count: number;
  requested: number;
  full: boolean;
  delay: Float32Array;
  drop: Float32Array;
  gravity: Float32Array;
  restitution: Float32Array;
  radius: Float32Array;
  dval: Float32Array;
  tempo: number;
  baseFall: number;
  resolveSec: number;
  tuned: number;
  maxDrop: number;
  baseRadius: number;
  /** The last orb's settle time (s; NaN when it never settles) and whether some orb never settles. */
  settleSec: number;
  neverSettles: boolean;
}

/**
 * Builds the run: the layout, every orb's release delay, drop height, gravity, restitution and radius from the distribution
 * of the varied property, the pattern clock and the resolve tuning. `random` is the seed's generator (null: tempo 1, the
 * "varied" distribution and the random release from a fixed sequence – the panel's summary); `gravity` the Gravity setting.
 */
export function planOrbGrid(settings: OrbGridSettings, gravity: number, tempoOverride: number | null, random: (() => number) | null): OrbGridPlan {
  const s = settings;
  const size = orbFieldSize(s.columns, s.rows);
  const layout = buildOrbLayout(s.arrangement, s.columns, s.rows);
  const n = layout.count;
  // The seed's draws: the tempo first, then one value per orb for the varied distribution and one for the random release.
  let fixed = 0.5;
  const rnd = random ?? (() => (fixed = (fixed * 9301 + 0.49297) % 1));
  const tempo = tempoOverride ?? 1 + TEMPO_JITTER * (2 * rnd() - 1);
  const g0 = (G_ORB * (gravity > 0 ? gravity : 0)) / GRAVITY_REFERENCE / (tempo * tempo);
  const h0 = Math.max(0, s.dropHeight);
  const e0 = Math.max(0, s.bounciness);
  const r0 = (s.orbSize * layout.spacing) / 2;
  const t10 = g0 > 0 && h0 > 0 ? Math.sqrt((2 * h0) / g0) : 0;
  const rhoMax = layoutRhoMax(layout);
  const delay = new Float32Array(n);
  const drop = new Float32Array(n);
  const grav = new Float32Array(n);
  const rest = new Float32Array(n);
  const radius = new Float32Array(n);
  const dval = new Float32Array(n);
  const spread = Math.max(0, s.spread);
  let maxDelay = 0;
  let maxDrop = 0;
  for (let i = 0; i < n; i++) {
    const rv = rnd();
    const rr = rnd();
    const d = distributionValue(s.distribution, layout, i, rhoMax, rv);
    dval[i] = d;
    let dl = releaseStep(s.release, layout, i, rr) * Math.max(0, s.stagger);
    let h = h0;
    let g = g0;
    let e = e0;
    let r = r0;
    switch (s.property) {
      case "bounciness":
        e = Math.max(0, e0 + spread * (d - 0.5) * E_SPAN);
        break;
      case "height":
        h = h0 * Math.pow(2, spread * (d - 0.5) * 2);
        break;
      case "delay":
        dl += spread * d * DELAY_SPAN_FALLS * t10;
        break;
      case "size":
        // Centres level at the start: a bigger orb falls a shorter way, and – heavier against the air – faster.
        r = r0 * Math.max(0, 1 + spread * (d - 0.5));
        h = Math.max(0, h0 + r0 - r);
        g = r0 > 0 ? g0 * Math.pow(r / r0, SIZE_GRAVITY_POWER) : g0;
        break;
      case "gravity":
        g = g0 * Math.pow(2, spread * (d - 0.5) * 2);
        break;
      case "period": {
        // Perfectly elastic, the apex at the drop height: the period sets the gravity (T = 2√(2h/g) → g = 8h/T²).
        e = 1;
        const f = t10 > 0 ? (1 + spread * d * PERIOD_SPAN) / (2 * t10) : 0;
        g = f > 0 ? 8 * h0 * f * f : 0;
        break;
      }
    }
    delay[i] = dl;
    drop[i] = h;
    grav[i] = g;
    rest[i] = e;
    radius[i] = r;
    if (dl > maxDelay) maxDelay = dl;
    if (h > maxDrop) maxDrop = h;
  }
  const resolveSec = s.resolve ? resolveTargetSec(s.property, e0, t10, maxDelay) : 0;
  let tuned = 0;
  if (resolveSec > 0) {
    for (let i = 0; i < n; i++) {
      const target = resolveSec - delay[i];
      if (!(target > 0) || !(grav[i] > 0) || !(drop[i] > 0)) continue;
      if (s.property === "period") {
        // Elastic orbs: the period that puts a landing on the clock (the apex is the release, a landing half a period later).
        const T = 1 / Math.sqrt(grav[i] / (8 * drop[i]));
        const m = Math.max(0, Math.round(target / T - 0.5));
        const tunedT = target / (m + 0.5);
        grav[i] = (8 * drop[i]) / (tunedT * tunedT);
        tuned++;
        continue;
      }
      const t1 = Math.sqrt((2 * drop[i]) / grav[i]);
      const scale = tuneTimeScale(t1, rest[i], target);
      if (Number.isFinite(scale)) {
        grav[i] = grav[i] / (scale * scale);
        tuned++;
      }
    }
  }
  // When the field settles: the last orb's final landing.
  let settleSec = 0;
  let neverSettles = false;
  for (let i = 0; i < n; i++) {
    const e = rest[i];
    if (!(grav[i] > 0) || !(drop[i] > 0)) {
      if (drop[i] > 0) neverSettles = true;
      continue;
    }
    if (e >= 1) {
      neverSettles = true;
      continue;
    }
    const t1 = Math.sqrt((2 * drop[i]) / grav[i]);
    // The settle landing: the first k with e^(2k) < REST_FRACTION.
    const k = e <= 0 ? 1 : Math.max(1, Math.ceil(Math.log(REST_FRACTION) / (2 * Math.log(e)) - 1e-12));
    const at = delay[i] + landingTime(t1, e, k);
    if (at > settleSec) settleSec = at;
  }
  return { layout, count: n, requested: size.full ? Math.round(s.columns) * Math.round(s.rows) : n, full: size.full, delay, drop, gravity: grav, restitution: rest, radius, dval, tempo, baseFall: t10, resolveSec, tuned, maxDrop, baseRadius: r0, settleSec: neverSettles ? NaN : settleSec, neverSettles };
}

/* ------------------------------------------------------------------ the mode */

export class OrbGridMode implements GameMode {
  readonly name = "orbGrid";
  /** The orbs are not engine balls; the placeholder ball is pinned and never collides. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: OrbGridSettings = { ...DEFAULT_ORB_GRID_SETTINGS };
  private readonly view: OrbGridView = {
    settings: { ...DEFAULT_ORB_GRID_SETTINGS },
    layout: null,
    count: 0,
    requested: 0,
    full: false,
    radius: new Float32Array(0),
    height: new Float32Array(0),
    dval: new Float32Array(0),
    state: new Uint8Array(0),
    drop: new Float32Array(0),
    maxDrop: 0,
    baseRadius: 0,
    tempo: 1,
    resolvePlanMs: 0,
    timeMs: 0,
    released: 0,
    releasedRings: 0,
    bounces: 0,
    landedStep: 0,
    settled: 0,
    moving: 0,
    resolve: 0,
    resolveAtMs: -1,
    resolves: 0,
    lastResolveMs: -1,
    tuned: 0,
    allSettled: false,
    settledAtMs: -1,
    finished: false,
    finishedMs: -1,
    finishReason: "",
    voices: 0,
    notes: 0,
    lastPitches: [],
    generation: 0,
  };
  // Per-orb state (the plan's constants and the bounce in flight).
  private delay: Float32Array = new Float32Array(0);
  private grav: Float32Array = new Float32Array(0);
  private rest: Float32Array = new Float32Array(0);
  private launchT = new Float64Array(0);
  private launchV = new Float64Array(0);
  private nextT = new Float64Array(0);
  private groupKey = new Int32Array(0);
  private pitchKey = new Int32Array(0);
  private nearness = new Float32Array(0);
  private ringReleased = new Int32Array(0);
  private ringSize = new Int32Array(0);
  private maxPitchKey = 0;
  private refSpeed = 1;
  // Resolve detector state.
  private readonly diff = new Float64Array(RESOLVE_BINS + 1);
  private armed = false;
  // Sound: this step's landings (one per orb), the grouping scratch, the frame's queued voices.
  private landings: OrbLandings = { count: 0, group: new Int32Array(0), pitchKey: new Int32Array(0), loud: new Float32Array(0), time: new Float64Array(0) };
  private groupScratch = createOrbGroupScratch(0);
  private readonly voices: OrbVoice[] = [];
  private readonly pending: SoundEvent[] = [];
  private lastSleepSec = -Infinity;
  private lastMusicSec = -Infinity;
  private lastMetalSec = -Infinity;
  private musicDegree = 7;
  private musicCount = 0;
  private anchorId = -1;
  private cx = 400;
  private cy = 300;
  private initialized = false;

  getSettings(): OrbGridSettings {
    return this.settings;
  }

  /** The physics fields apply on the next init (the page restarts the run); the look, the sound, the scale and the clip at once. */
  setSettings(patch: Partial<OrbGridSettings>) {
    this.settings = resolveOrbGridSettings({ ...this.settings, ...patch });
    const s = this.settings;
    const v = this.view;
    v.settings = { ...v.settings, elevation: s.elevation, rotation: s.rotation, orbit: s.orbit, floor: s.floor, material: s.material, palette: s.palette, hud: s.hud, sound: s.sound, scale: s.scale, rootNote: s.rootNote, ballColor: s.ballColor, maxSec: s.maxSec };
    if (this.initialized) this.updateNearness();
  }

  /** Live state for the canvas, the HUD and the data attributes; the same object every call. */
  getView(): OrbGridView {
    return this.view;
  }

  getProgress() {
    const v = this.view;
    return { orbs: v.count, released: v.released, bounces: v.bounces, settled: v.settled, moving: v.moving, resolve: v.resolve, resolveAtMs: v.resolveAtMs, resolves: v.resolves, finished: v.finished, finishedMs: v.finishedMs };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    const plan = planOrbGrid(s, ctx.config.gravity, null, () => ctx.random());
    const n = plan.count;
    const L = plan.layout;
    v.settings = { ...s };
    v.layout = L;
    v.count = n;
    v.requested = plan.requested;
    v.full = plan.full;
    if (plan.full) ctx.noteArenaFull?.();
    v.radius = plan.radius;
    v.dval = plan.dval;
    v.drop = plan.drop;
    if (v.height.length !== n) v.height = new Float32Array(n);
    if (v.state.length !== n) v.state = new Uint8Array(n);
    v.state.fill(OG_WAITING);
    v.height.set(plan.drop);
    v.maxDrop = plan.maxDrop;
    v.baseRadius = plan.baseRadius;
    v.tempo = plan.tempo;
    v.resolvePlanMs = plan.resolveSec * 1000;
    v.timeMs = 0;
    v.released = 0;
    v.releasedRings = 0;
    v.bounces = 0;
    v.landedStep = 0;
    v.settled = 0;
    v.moving = 0;
    v.resolve = 0;
    v.resolveAtMs = -1;
    v.resolves = 0;
    v.lastResolveMs = -1;
    v.tuned = plan.tuned;
    v.allSettled = false;
    v.settledAtMs = -1;
    v.finished = false;
    v.finishedMs = -1;
    v.finishReason = "";
    v.voices = 0;
    v.notes = 0;
    v.lastPitches = [];
    v.generation++;
    this.delay = plan.delay;
    this.grav = plan.gravity;
    this.rest = plan.restitution;
    if (this.launchT.length !== n) {
      this.launchT = new Float64Array(n);
      this.launchV = new Float64Array(n);
      this.nextT = new Float64Array(n);
      this.groupKey = new Int32Array(n);
      this.pitchKey = new Int32Array(n);
      this.nearness = new Float32Array(n);
      this.landings = { count: 0, group: new Int32Array(n), pitchKey: new Int32Array(n), loud: new Float32Array(n), time: new Float64Array(n) };
      this.groupScratch = createOrbGroupScratch(n);
    }
    this.launchT.fill(0);
    this.launchV.fill(0);
    this.nextT.fill(Infinity);
    // Sound keys: a grid's rows are its chords (pitch by column); a ring arrangement's rings are its notes.
    const rings = L.arrangement === "disc" || L.arrangement === "octagons";
    this.maxPitchKey = Math.max(1, rings ? L.ringCount - 1 : L.columns - 1);
    for (let i = 0; i < n; i++) {
      this.groupKey[i] = rings ? L.ring[i] : L.row[i];
      this.pitchKey[i] = rings ? L.ringCount - 1 - L.ring[i] : L.col[i];
    }
    this.ringSize = new Int32Array(L.ringCount);
    this.ringReleased = new Int32Array(L.ringCount);
    for (let i = 0; i < n; i++) this.ringSize[L.ring[i]]++;
    this.refSpeed = Math.max(1e-9, Math.sqrt(2 * Math.max(1e-9, plan.maxDrop) * Math.max(1e-9, (G_ORB * Math.max(0, ctx.config.gravity)) / GRAVITY_REFERENCE)));
    this.armed = false;
    this.diff.fill(0);
    this.pending.length = 0;
    this.lastSleepSec = -Infinity;
    this.lastMusicSec = -Infinity;
    this.lastMetalSec = -Infinity;
    this.musicDegree = 7;
    this.musicCount = 0;
    this.initialized = true;
    this.updateNearness();
    // The engine's placeholder ball, pinned at the centre (the engine adds one to every mode); the orbs are drawn instead.
    this.cx = ctx.config.width / 2;
    this.cy = ctx.config.height / 2;
    this.anchorId = ctx.getNextId();
    ctx.addBall({ x: this.cx, y: this.cy, vx: 0, vy: 0, radius: ctx.config.ballRadius || 8, color: ctx.config.ballColor || "#FFFFFF", gravityScale: 0 });
  }

  /** How near the camera each orb's spot is (0.75–1; the sound's "nearest first" and its loudness), for the live rotation. */
  private updateNearness() {
    const L = this.view.layout;
    if (!L) return;
    const a = (this.view.settings.rotation * Math.PI) / 180;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const r = Math.max(1e-9, L.radius);
    for (let i = 0; i < L.count; i++) {
      // The camera looks along +y after the field's rotation: a spot with a small rotated y is near.
      const yr = L.x[i] * sa + L.y[i] * ca;
      this.nearness[i] = 0.875 - 0.125 * Math.max(-1, Math.min(1, yr / r));
    }
  }

  onPreUpdate() {}

  /** The placeholder ball stays where it is (wind and drag would move it). */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    ball.x = this.cx;
    ball.y = this.cy;
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /** One 60 Hz step: every orb's landings up to the step's end time, its height, the counters, the detector, the sound. */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    if (!v.layout || v.finished) return;
    const n = v.count;
    const t = ctx.getElapsedMs() / 1000;
    const dt = dtMs / 1000;
    const delay = this.delay;
    const grav = this.grav;
    const rest = this.rest;
    const drop = v.drop;
    const height = v.height;
    const state = v.state;
    const launchT = this.launchT;
    const launchV = this.launchV;
    const nextT = this.nextT;
    const L = v.layout;
    const landings = this.landings;
    landings.count = 0;
    const diff = this.diff;
    let landed = 0;
    let moving = 0;
    let counted = 0;
    let settledNow = 0;
    let bounceNotes = 0;
    const anchor = this.anchorBall(ctx);
    for (let i = 0; i < n; i++) {
      const st = state[i];
      if (st === OG_SETTLED) continue;
      const g = grav[i];
      if (st === OG_WAITING) {
        if (t < delay[i]) continue;
        // Let go from rest at its drop height: a virtual launch whose apex is the release.
        state[i] = OG_FLYING;
        v.released++;
        const ring = L.ring[i];
        this.ringReleased[ring]++;
        if (this.ringReleased[ring] === this.ringSize[ring]) v.releasedRings++;
        if (!(g > 0) || !(drop[i] > 0)) {
          // No gravity: it hovers where it was let go; no drop: it already rests on the slab.
          launchV[i] = 0;
          nextT[i] = Infinity;
          if (!(drop[i] > 0)) {
            state[i] = OG_SETTLED;
            height[i] = 0;
            settledNow++;
          } else moving++;
          continue;
        }
        const v0 = Math.sqrt(2 * g * drop[i]);
        launchV[i] = v0;
        launchT[i] = delay[i] - v0 / g;
        nextT[i] = delay[i] + v0 / g;
      }
      if (!(g > 0)) {
        moving++;
        continue;
      }
      let first = true;
      let guard = 0;
      while (t >= nextT[i]) {
        const at = nextT[i];
        const speed = launchV[i];
        v.bounces++;
        if (first) {
          first = false;
          landed++;
          const k = landings.count++;
          landings.group[k] = this.groupKey[i];
          landings.pitchKey[k] = this.pitchKey[i];
          landings.loud[k] = (speed / this.refSpeed) * this.nearness[i];
          landings.time[k] = at;
          if (bounceNotes < BOUNCE_NOTES_PER_STEP && anchor) {
            bounceNotes++;
            ctx.noteBounce?.(anchor); // --- bounce-math --- a landing is the orb's bounce
          }
        }
        const e = rest[i];
        let next = speed * e;
        if (next > V_SAFE) next = V_SAFE;
        launchT[i] = at;
        if (e < 1 && next * next < 2 * g * drop[i] * REST_FRACTION) {
          state[i] = OG_SETTLED;
          height[i] = 0;
          settledNow++;
          break;
        }
        launchV[i] = next;
        nextT[i] = at + (2 * next) / g;
        if (++guard >= LANDINGS_PER_STEP) {
          // A Zeno run of landings within one step: the rest of the bounces add up to less than a step – it is at rest.
          state[i] = OG_SETTLED;
          height[i] = 0;
          settledNow++;
          break;
        }
      }
      if (state[i] === OG_SETTLED) continue;
      const tau = t - launchT[i];
      const vl = launchV[i];
      const h = vl * tau - 0.5 * g * tau * tau;
      height[i] = h > 0 ? h : 0;
      moving++;
      // The resolve detector: the phase swept this step, for orbs whose bounce lasts two steps or more.
      const flight = (2 * vl) / g;
      if (flight >= 2 * dt) {
        addPhaseCoverage(diff, tau / flight, dt / flight);
        counted++;
      }
    }
    v.timeMs = t * 1000;
    v.landedStep = landed;
    v.moving = moving;
    v.settled += settledNow;
    if (settledNow > 0 && v.settled >= n) {
      v.allSettled = true;
      v.settledAtMs = t * 1000;
    }
    // The resolve detector with its hysteresis: armed once the field has dissolved, an "in phase" moment when it resolves.
    const enough = counted >= Math.max(RESOLVE_MIN_MOVING, Math.ceil(0.02 * n));
    const share = coverageShare(diff, enough ? counted : 0);
    v.resolve = share;
    if (enough) {
      if (!this.armed && share < RESOLVE_LOW) this.armed = true;
      else if (this.armed && share >= RESOLVE_HIGH) {
        this.armed = false;
        v.resolves++;
        v.lastResolveMs = t * 1000;
        if (v.resolveAtMs < 0) v.resolveAtMs = t * 1000;
      }
    }
    if (landed > 0) this.queueSound(t);
    // The end: every orb at rest (after the hold), or the clip.
    const maxSec = v.settings.maxSec;
    if (v.allSettled && t * 1000 - v.settledAtMs >= SETTLE_HOLD_MS) this.finish(t, "settled");
    else if (maxSec > 0 && t >= maxSec - 1e-9) this.finish(t, "time");
  }

  private finish(t: number, reason: "settled" | "time") {
    const v = this.view;
    v.finished = true;
    v.finishedMs = t * 1000;
    v.finishReason = reason;
  }

  private anchorBall(ctx: ModeContext): Ball | null {
    const balls = ctx.getBalls();
    for (let i = 0; i < balls.length; i++) if (balls[i].id === this.anchorId) return balls[i];
    return balls[0] ?? null;
  }

  /** The step's landings → at most MAX_NOTES_PER_STEP voices of the chosen sound (queued for the frame's flush). */
  private queueSound(t: number) {
    const v = this.view;
    const s = v.settings;
    if (s.sound === "silent") return;
    const voices = this.voices;
    const max = s.sound === "sleep" || s.sound === "music" ? 1 : MAX_NOTES_PER_STEP;
    if (s.sound === "sleep" && t - this.lastSleepSec < SLEEP_MIN_GAP_SEC) return;
    if (s.sound === "music" && t - this.lastMusicSec < MUSIC_MIN_GAP_SEC) return;
    if (s.sound === "metal" && t - this.lastMetalSec < METAL_MIN_GAP_SEC) return;
    const made = groupOrbLandings(this.landings, max, s.sound === "sleep" ? 2 : MAX_CHORD_NOTES, this.groupScratch, voices);
    for (let k = 0; k < made; k++) {
      const voice = voices[k];
      const level = orbLevel(voice.loud, s.sound);
      let event: SoundEvent;
      if (s.sound === "music") {
        // The earliest landing of the step picks the melody's next step through the scale.
        this.musicDegree = orbMusicNext(this.musicDegree, voice.firstKey);
        this.musicCount++;
        const f = orbPitchHz(this.musicDegree, -1, s.scale, s.rootNote, 0);
        event = { type: "hit", wallIndex: 0, frequency: f, level: Math.min(1, level * (this.musicCount % 8 === 1 ? 1.25 : 1)) };
        if (this.musicCount % 8 === 1) event.accent = true;
        this.lastMusicSec = t;
      } else {
        const octave = s.sound === "metal" ? 1 : s.sound === "sleep" ? -1 : 0;
        const freqs: number[] = [];
        for (const key of voice.keys) freqs.push(orbPitchHz(key, this.maxPitchKey, s.scale, s.rootNote, octave));
        event = { type: "hit", wallIndex: 0, frequency: freqs[0], level };
        if (freqs.length > 1) event.chord = freqs;
        if (s.sound === "metal" || s.sound === "sleep") {
          event.orb = s.sound;
          event.melody = false;
        }
        if (s.sound === "sleep") this.lastSleepSec = t;
        if (s.sound === "metal") this.lastMetalSec = t;
      }
      this.pending.push(event);
    }
  }

  /** Once per rendered frame: the frame's loudest voices (at most MAX_ORB_EVENTS_PER_FRAME) go to the page. */
  flushPendingSounds(ctx: ModeContext) {
    const pending = this.pending;
    if (pending.length === 0) return;
    if (pending.length > MAX_ORB_EVENTS_PER_FRAME) {
      pending.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
      pending.length = MAX_ORB_EVENTS_PER_FRAME;
    }
    const v = this.view;
    v.lastPitches = [];
    for (const ev of pending) {
      ctx.addPendingSoundEvent(ev);
      v.voices++;
      const pitches = ev.chord ?? (ev.frequency !== undefined ? [ev.frequency] : []);
      v.notes += pitches.length;
      for (const f of pitches) v.lastPitches.push(f);
    }
    pending.length = 0;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize keeps the field (it is drawn to fit); the placeholder moves to the new centre. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.cx = ctx.config.width / 2;
      this.cy = ctx.config.height / 2;
      for (const ball of ctx.getBalls()) {
        ball.x = this.cx;
        ball.y = this.cy;
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { orbs: v.count, released: v.released, bounces: v.bounces, settled: v.settled, resolve: v.resolve, resolveAtMs: v.resolveAtMs, finished: v.finished };
  }
}
