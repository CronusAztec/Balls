import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { BR_ORDERS, BR_PICTURES, BR_SYMMETRY_MODES, isBrOrder, isBrPicture, isBrSymmetryMode, symmetryImages, type BrOrder, type BrPicture, type BrSymmetryMode, type BrickRebuildSettings } from "./brickRebuild";
import { BR_TEXT_MAX, cleanBrickText } from "./brickPicture";

/*
 * --- brick-rebuild --- The page settings of Brick Smash (lib/physics/modes/brickRebuild.ts runs them): the grid, the wall's share
 * of the box, the start balls and the spawn period, the balls' speed and size, the bricks' hit points, the smash's time limit,
 * the settle and the rebuild with its order, the picture (the built-in emblem, an upload kept in the page, or typed text), the
 * groove's drop, the gold capsules and the kaleidoscope. Defaults, comfort ranges (the sliders' tracks – every value from the
 * minimum up is valid), URL keys (br…), validation, the presets, the clip's look and the loop HUD's words (the `BrickRebuild`
 * namespace). Nothing here touches the engine. An uploaded picture never travels in a link or a preset: only its setting does.
 */

export { BR_ORDERS, BR_PICTURES, BR_SYMMETRY_MODES, isBrOrder, isBrPicture, isBrSymmetryMode };
export type { BrOrder, BrPicture, BrSymmetryMode };

/** The feature's fields of the SimulatorSettings object. */
export interface BrickRebuildFields {
  /** The grid: columns and rows (URL `brC`, `brR`). */
  brCols: number;
  brRows: number;
  /** The share of the box the bricks fill from the top, % (URL `brW`). */
  brWall: number;
  /** The balls a cycle starts with (URL `brB`). */
  brBalls: number;
  /** A new ball every this many breaks, 0 = off (URL `brE`). */
  brEvery: number;
  /** The balls' speed (px/s) and radius (px), in px of the 720-wide reference clip (URL `brV`, `brS`). */
  brSpeed: number;
  brSize: number;
  /** Hits a brick takes (URL `brH`). */
  brHp: number;
  /** The smash's time limit, s (URL `brT`). */
  brDuration: number;
  /** The settle (gravity on) and the rebuild, s (URL `brSt`, `brRb`), and the rebuild's order (URL `brO`). */
  brSettle: number;
  brRebuild: number;
  brOrder: BrOrder;
  /** The picture: the built-in emblem, the page's upload or typed text (URL `brP`), and the text (URL `brTx`). */
  brPicture: BrPicture;
  brText: string;
  /** The groove's drop, s (the first bar line at or after it; URL `brD`) and the groove bed itself (URL `brBd`). */
  brDrop: number;
  brBed: boolean;
  /** Gold capsules (URL `brCp`): their chance a break (URL `brCc`) and the split a catch makes (URL `brSp`). */
  brCapsules: boolean;
  brCapsuleChance: number;
  brSplit: number;
  /** The kaleidoscope: images (1 = off; URL `brK`), mirror walls or rotations (URL `brKm`), the hole, % of the radius (URL `brHo`). */
  brSymmetry: number;
  brSymmetryMode: BrSymmetryMode;
  brHole: number;
  /** Hollow outlined balls (off: the page's own ball look; URL `brOl`). */
  brOutline: boolean;
}

export const DEFAULT_BRICK_REBUILD_FIELDS: Readonly<BrickRebuildFields> = {
  brCols: 30,
  brRows: 30,
  brWall: 78,
  brBalls: 3,
  brEvery: 4,
  brSpeed: 450,
  brSize: 5,
  brHp: 1,
  brDuration: 60,
  brSettle: 1,
  brRebuild: 4,
  brOrder: "layers",
  brPicture: "emblem",
  brText: "LOGO",
  brDrop: 4,
  brBed: true,
  brCapsules: false,
  brCapsuleChance: 0.05,
  brSplit: 3,
  brSymmetry: 1,
  brSymmetryMode: "mirror",
  brHole: 22,
  brOutline: true,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const BRICK_REBUILD_RANGES = {
  brCols: { min: 4, max: 200, step: 1 },
  brRows: { min: 2, max: 200, step: 1 },
  brWall: { min: 10, max: 95, step: 1 },
  brBalls: { min: 1, max: 1000, step: 1 },
  brEvery: { min: 0, max: 1000, step: 1 },
  brSpeed: { min: 20, max: 5000, step: 10 },
  brSize: { min: 1, max: 40, step: 0.5 },
  brHp: { min: 1, max: 99, step: 1 },
  brDuration: { min: 5, max: 300, step: 1 },
  brSettle: { min: 0, max: 10, step: 0.1 },
  brRebuild: { min: 0, max: 60, step: 0.1 },
  brDrop: { min: 0, max: 30, step: 0.5 },
  brCapsuleChance: { min: 0, max: 1, step: 0.01 },
  brSplit: { min: 2, max: 5, step: 1 },
  brSymmetry: { min: 1, max: 12, step: 1 },
  brHole: { min: 0, max: 80, step: 1 },
} as const;

type NumberKey = keyof typeof BRICK_REBUILD_RANGES;
const WHOLE_KEYS: readonly NumberKey[] = ["brCols", "brRows", "brBalls", "brEvery", "brHp", "brSplit", "brSymmetry"];
/** The fields the mode's engine reads (the picture, its text, the order and the outline only change the drawing). */
export const BRICK_REBUILD_ENGINE_KEYS: readonly string[] = ["brCols", "brRows", "brWall", "brBalls", "brEvery", "brSpeed", "brSize", "brHp", "brDuration", "brSettle", "brRebuild", "brDrop", "brBed", "brCapsules", "brCapsuleChance", "brSplit", "brSymmetry", "brSymmetryMode", "brHole"];
/** The fields a change of which restarts the run (and drops a found seed); the picture, the text, the order and the outline follow live. */
export const BRICK_REBUILD_RESTART_FIELDS: readonly (keyof BrickRebuildFields)[] = ["brCols", "brRows", "brWall", "brBalls", "brEvery", "brSpeed", "brSize", "brHp", "brDuration", "brSettle", "brRebuild", "brDrop", "brBed", "brCapsules", "brCapsuleChance", "brSplit", "brSymmetry", "brSymmetryMode", "brHole"];

export function defaultBrickRebuildFields(): BrickRebuildFields {
  return { ...DEFAULT_BRICK_REBUILD_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_BRICK_REBUILD_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, BRICK_REBUILD_RANGES[key]);
  return WHOLE_KEYS.includes(key) ? Math.round(v) : v;
}

/** Validates the feature's fields (URL parameters, presets and project files alike): valid numbers from their minimum up, known options, clean text, real booleans. */
export function resolveBrickRebuildFields(source: Partial<Record<keyof BrickRebuildFields, unknown>> | null | undefined): BrickRebuildFields {
  const s = source ?? {};
  const d = DEFAULT_BRICK_REBUILD_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    brCols: numberOf("brCols", s.brCols),
    brRows: numberOf("brRows", s.brRows),
    brWall: numberOf("brWall", s.brWall),
    brBalls: numberOf("brBalls", s.brBalls),
    brEvery: numberOf("brEvery", s.brEvery),
    brSpeed: numberOf("brSpeed", s.brSpeed),
    brSize: numberOf("brSize", s.brSize),
    brHp: numberOf("brHp", s.brHp),
    brDuration: numberOf("brDuration", s.brDuration),
    brSettle: numberOf("brSettle", s.brSettle),
    brRebuild: numberOf("brRebuild", s.brRebuild),
    brOrder: isBrOrder(s.brOrder) ? s.brOrder : d.brOrder,
    brPicture: isBrPicture(s.brPicture) ? s.brPicture : d.brPicture,
    brText: cleanBrickText(s.brText, d.brText),
    brDrop: numberOf("brDrop", s.brDrop),
    brBed: bool(s.brBed, d.brBed),
    brCapsules: bool(s.brCapsules, d.brCapsules),
    brCapsuleChance: numberOf("brCapsuleChance", s.brCapsuleChance),
    brSplit: numberOf("brSplit", s.brSplit),
    brSymmetry: numberOf("brSymmetry", s.brSymmetry),
    brSymmetryMode: isBrSymmetryMode(s.brSymmetryMode) ? s.brSymmetryMode : d.brSymmetryMode,
    brHole: numberOf("brHole", s.brHole),
    brOutline: bool(s.brOutline, d.brOutline),
  };
}

/**
 * What the engine runs of the fields, with the page's tempo (the groove's bar lines and the drop): the counts at their
 * memory-safety ceilings at most (the grid's cells stop at BR_CELL_CEILING in the mode, the images at BR_IMAGE_CEILING).
 */
export function brickRebuildSettingsOf(s: BrickRebuildFields & { bpm?: number }): BrickRebuildSettings {
  return {
    cols: memoryCeiling("brCols", s.brCols),
    rows: memoryCeiling("brRows", s.brRows),
    wallPct: s.brWall,
    balls: memoryCeiling("brBalls", s.brBalls),
    every: s.brEvery,
    speed: s.brSpeed,
    size: s.brSize,
    hp: s.brHp,
    duration: s.brDuration,
    settle: s.brSettle,
    rebuild: s.brRebuild,
    order: s.brOrder,
    picture: s.brPicture,
    text: s.brText,
    drop: s.brDrop,
    bed: s.brBed,
    capsules: s.brCapsules,
    capsuleChance: s.brCapsuleChance,
    split: s.brSplit,
    symmetry: memoryCeiling("brSymmetry", s.brSymmetry),
    symmetryMode: s.brSymmetryMode,
    hole: s.brHole,
    outline: s.brOutline,
    bpm: typeof s.bpm === "number" && Number.isFinite(s.bpm) && s.bpm > 0 ? s.bpm : 120,
  };
}

/** The real balls and the balls drawn of a kaleidoscope (its images of each), for the caption "only N of these balls are real". */
export function brickRebuildBallsShown(s: Pick<BrickRebuildFields, "brBalls" | "brSymmetry" | "brSymmetryMode">): { real: number; shown: number } {
  const images = symmetryImages(memoryCeiling("brSymmetry", s.brSymmetry), s.brSymmetryMode);
  const real = Math.max(1, Math.round(s.brBalls));
  return { real, shown: real * images };
}

/* ------------------------------------------------------------------ the look */

/** The reference clip's page: cream (#ecebe3), the box's thin grey border, navy titles; the loop HUD on, the balls' trails and glow off. */
export const BRICK_REBUILD_LOOK = {
  backgroundType: "solid",
  backgroundColors: ["#ecebe3", "#ecebe3"],
  themeId: "",
  showTrails: false,
  showGlow: false,
  loopHud: true,
} as const;
/** The box's border, the grout between the bricks, a broken brick's grey-lilac, the outlined balls' rim. */
export const BR_COLOURS = { border: "#b9b6aa", grout: "rgba(236, 235, 227, 0.9)", ghost: "#b7b2c6", ballFill: "#ffffff", ballRim: "#1b2350", paddle: "#1b2350", capsule: "#f4c55c", capsuleRim: "#b8892a", counter: "#7d7a70" } as const;

/**
 * In Brick Smash only: the reference clip's cream page, the loop HUD on (the bold title over the box and "N bricks" under it),
 * no trails or glow on the hollow balls, and the drama layer off (its moods run on a clock of their own that no seam matches).
 */
export function brickRebuildModeDefaults(mode: string): { backgroundType?: "solid"; backgroundColors?: string[]; loopHud?: boolean; showTrails?: boolean; showGlow?: boolean; cinematicEnabled?: boolean } {
  return mode === "brickRebuild" ? { backgroundType: "solid", backgroundColors: [...BRICK_REBUILD_LOOK.backgroundColors], loopHud: true, showTrails: false, showGlow: false, cinematicEnabled: false } : {};
}

/* ------------------------------------------------------------------ the HUD's words (namespace BrickRebuild) */

/**
 * The loop HUD's words of a variant (keys of the `BrickRebuild` namespace): the title, the grey subtitle and the counter. The
 * messages take `brickRebuildHudValues()` (the spawn period, the real and the image balls, the split).
 */
export function brickRebuildHudKeys(s: Pick<BrickRebuildFields, "brSymmetry" | "brCapsules" | "brSymmetryMode">): { title: string; subtitle: string; counter: string } {
  if (Math.round(s.brSymmetry) > 1) return { title: "BrickRebuild.canvasTitleKaleidoscope", subtitle: s.brSymmetryMode === "rotate" ? "BrickRebuild.canvasSubtitleRotate" : "BrickRebuild.canvasSubtitleKaleidoscope", counter: "BrickRebuild.canvasCounter" };
  if (s.brCapsules) return { title: "BrickRebuild.canvasTitleCapsules", subtitle: "BrickRebuild.canvasSubtitleCapsules", counter: "BrickRebuild.canvasCounter" };
  return { title: "BrickRebuild.canvasTitle", subtitle: "BrickRebuild.canvasSubtitle", counter: "BrickRebuild.canvasCounter" };
}

/** The values the HUD's words take: the spawn period, the real balls, the images besides them ("the other 14") and the split. */
export function brickRebuildHudValues(s: Pick<BrickRebuildFields, "brBalls" | "brEvery" | "brSplit" | "brSymmetry" | "brSymmetryMode">): { every: number; real: number; others: number; split: number } {
  const shown = brickRebuildBallsShown(s);
  return { every: Math.max(0, Math.round(s.brEvery)), real: shown.real, others: shown.shown - shown.real, split: Math.round(s.brSplit) };
}

/* ------------------------------------------------------------------ presets */

export const BR_PRESET_IDS = ["emblem", "avalanche", "bigPicture", "classic", "capsules", "kaleidoscope"] as const;
export type BrPresetId = (typeof BR_PRESET_IDS)[number];

/** Translation keys (`BrickRebuild` namespace) of the presets' names. */
export const BR_PRESET_LABELS: Readonly<Record<BrPresetId, string>> = {
  emblem: "presetEmblem",
  avalanche: "presetAvalanche",
  bigPicture: "presetBigPicture",
  classic: "presetClassic",
  capsules: "presetCapsules",
  kaleidoscope: "presetKaleidoscope",
};

export function isBrPresetId(value: unknown): value is BrPresetId {
  return typeof value === "string" && (BR_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields: Smash the emblem (30 × 30, 3 balls, a spawn every 4 breaks, at the reference clip's pace – 0 bricks at
 * about 15 s, the loop about 20 s), Avalanche (a spawn every break), Big picture (100 × 100 from an upload), Classic breakout
 * (1 ball, no multiply, the paddle), Gold capsules (no spawns: a caught capsule triples every ball) and Kaleidoscope (8 mirror
 * images of 2 real balls in a mosaic round a hole).
 */
export function brickRebuildPresetFields(id: BrPresetId): BrickRebuildFields {
  const base = defaultBrickRebuildFields();
  switch (id) {
    case "avalanche":
      return { ...base, brSpeed: 600, brEvery: 1 };
    case "bigPicture":
      return { ...base, brCols: 100, brRows: 100, brSpeed: 600, brSize: 2.5, brPicture: "upload" };
    case "classic":
      return { ...base, brBalls: 1, brEvery: 0, brSpeed: 600, brCapsules: true, brCapsuleChance: 0, brDuration: 120 };
    case "capsules":
      return { ...base, brEvery: 0, brSpeed: 600, brCapsules: true, brCapsuleChance: 0.05, brSplit: 3 };
    case "kaleidoscope":
      return { ...base, brBalls: 2, brEvery: 0, brSpeed: 600, brSymmetry: 8, brSymmetryMode: "mirror", brHole: 28, brCols: 30 };
    default:
      return { ...base, brSpeed: 600 };
  }
}

/* ------------------------------------------------------------------ URL */

/** Up to three decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields and the switches (an uploaded picture never travels: only `brP`). */
export const BRICK_REBUILD_URL_KEYS: Readonly<Record<string, NumberKey>> = { brC: "brCols", brR: "brRows", brW: "brWall", brB: "brBalls", brE: "brEvery", brV: "brSpeed", brS: "brSize", brH: "brHp", brT: "brDuration", brSt: "brSettle", brRb: "brRebuild", brD: "brDrop", brCc: "brCapsuleChance", brSp: "brSplit", brK: "brSymmetry", brHo: "brHole" };
const BOOL_KEYS: Readonly<Record<string, "brBed" | "brCapsules" | "brOutline">> = { brBd: "brBed", brCp: "brCapsules", brOl: "brOutline" };

/** Writes the fields that differ from `base` (the mode's defaults): brC, brR, brW, brB, brE, brV, brS, brH, brT, brSt, brRb, brO, brP, brTx, brD, brBd, brCp, brCc, brSp, brK, brKm, brHo, brOl. */
export function writeBrickRebuildParams(settings: BrickRebuildFields, base: BrickRebuildFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(BRICK_REBUILD_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  if (settings.brOrder !== base.brOrder) params.set("brO", settings.brOrder);
  if (settings.brPicture !== base.brPicture) params.set("brP", settings.brPicture);
  if (settings.brText !== base.brText) params.set("brTx", settings.brText);
  if (settings.brSymmetryMode !== base.brSymmetryMode) params.set("brKm", settings.brSymmetryMode);
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readBrickRebuildParams(params: URLSearchParams, settings: BrickRebuildFields) {
  const next: Partial<Record<keyof BrickRebuildFields, unknown>> = { ...settings };
  for (const [key, field] of Object.entries(BRICK_REBUILD_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const order = params.get("brO");
  if (order !== null) next.brOrder = order;
  const picture = params.get("brP");
  if (picture !== null) next.brPicture = picture;
  const text = params.get("brTx");
  if (text !== null) next.brText = text.slice(0, BR_TEXT_MAX);
  const symmetryMode = params.get("brKm");
  if (symmetryMode !== null) next.brSymmetryMode = symmetryMode;
  Object.assign(settings, resolveBrickRebuildFields(next));
}
