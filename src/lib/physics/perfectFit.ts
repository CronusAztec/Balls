import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { PF_VARIANTS, isPfVariant, type PfVariant } from "@/lib/simulation/polyominoPlan";

/*
 * --- perfect-fit --- Perfect Fit (the loop family's packing puzzles; lib/physics/modes/perfectFit.ts runs it,
 * lib/simulation/polyominoPlan.ts plans it): the settings, their URL keys (`pf…`), the presets and the clip's look. Nothing here
 * touches the engine.
 */

export { PF_VARIANTS, isPfVariant };
export type { PfVariant };

/** A box of the pentomino variant, in cells: `w` wide, `h` tall. */
export interface PfBox {
  w: number;
  h: number;
}

/** What the mode runs (the page's fields parsed, and the Sound section's tempo for the beat). */
export interface PerfectFitSettings {
  variant: PfVariant;
  /** Pentominoes: the boxes in order (any W × H; W · H = 60 is a box the 12 pieces can fill). */
  boxes: PfBox[];
  /** Seconds a piece takes (Tetris: in the first section; every section after is faster). */
  pieceSec: number;
  /** Fall feel: 0 a constant speed, 1 a fall under gravity from rest, more a later, harder landing. */
  fall: number;
  /** The solution seed: 0 draws one from the run's seed, any other number is that tiling for good (the finder sets it). */
  seed: number;
  /** Tetris: lines per section, the well and whether the last section holds its rows until its last piece. */
  sections: number[];
  wellW: number;
  wellH: number;
  hold: boolean;
  /** Every landing on the beat of `bpm` (the Sound section's tempo). */
  beat: boolean;
  bpm: number;
}

/** The feature's fields of the SimulatorSettings object. */
export interface PerfectFitFields {
  /** pento | tetris (URL `pfV`). */
  pfVariant: PfVariant;
  /** The boxes, "10×6, 12×5, 15×4" (URL `pfBx`). */
  pfBoxes: string;
  /** Seconds a piece takes, 0.05–5 on the slider (URL `pfS`). */
  pfPieceSec: number;
  /** Fall feel, 0–10 on the slider (URL `pfF`). */
  pfFall: number;
  /** The solution seed, 0 = from the run's seed (URL `pfSd`). */
  pfSeed: number;
  /** Tetris: lines per section, "4,4,4,4,12" (URL `pfSc`). */
  pfSections: string;
  /** Tetris: the well, 4–100 × 4–200 on the sliders (URL `pfW`, `pfH`). */
  pfWellW: number;
  pfWellH: number;
  /** Tetris: hold the last section's clears until its last piece (URL `pfHd`). */
  pfHold: boolean;
  /** Every landing on the beat of the Sound section's tempo (URL `pfB`). */
  pfBeat: boolean;
}

/** The seconds a piece takes in each variant: the rectangles' 0.55 s, the perfect clears' 0.3 s (then faster every section). */
export const PF_VARIANT_PIECE_SEC: Readonly<Record<PfVariant, number>> = { pento: 0.55, tetris: 0.3 };
/** The classic boxes and sections. */
export const PF_DEFAULT_BOXES = "10×6, 12×5, 15×4";
export const PF_DEFAULT_SECTIONS = "4,4,4,4,12";

export const DEFAULT_PERFECT_FIT_FIELDS: Readonly<PerfectFitFields> = {
  pfVariant: "pento",
  pfBoxes: PF_DEFAULT_BOXES,
  pfPieceSec: 0.55,
  pfFall: 1,
  pfSeed: 0,
  pfSections: PF_DEFAULT_SECTIONS,
  pfWellW: 10,
  pfWellH: 16,
  pfHold: true,
  pfBeat: false,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const PF_RANGES = {
  pfPieceSec: { min: 0.05, max: 5, step: 0.01 },
  pfFall: { min: 0, max: 10, step: 0.1 },
  pfSeed: { min: 0, max: 99999, step: 1 },
  pfWellW: { min: 4, max: 100, step: 1 },
  pfWellH: { min: 4, max: 200, step: 1 },
} as const;

type NumberKey = keyof typeof PF_RANGES;
const WHOLE_KEYS: readonly NumberKey[] = ["pfSeed", "pfWellW", "pfWellH"];
/** The fields the mode's engine reads (every number: the plan is the run). */
export const PF_ENGINE_KEYS: readonly NumberKey[] = ["pfPieceSec", "pfFall", "pfSeed", "pfWellW", "pfWellH"];
/** The fields a change of which re-plans and restarts the run (the Sound section's tempo too, with the beat on). */
export const PF_RESTART_FIELDS: readonly (keyof PerfectFitFields)[] = ["pfVariant", "pfBoxes", "pfPieceSec", "pfFall", "pfSeed", "pfSections", "pfWellW", "pfWellH", "pfHold", "pfBeat"];
/** The longest typed list kept (characters), the boxes and sections a list holds at most, and a box's largest side (cells). */
export const PF_LIST_MAX = 400;
export const PF_BOX_CEILING = 64;
export const PF_SECTION_CEILING = 256;
export const PF_BOX_SIDE_MAX = 500;
/** A section's most lines (the well is drawn at least as tall as its tallest section). */
export const PF_SECTION_LINES_MAX = 2_000;

export function defaultPerfectFitFields(): PerfectFitFields {
  return { ...DEFAULT_PERFECT_FIT_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_PERFECT_FIT_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, PF_RANGES[key]);
  return WHOLE_KEYS.includes(key) ? Math.round(v) : v;
}

/** A clean typed list: a string, control characters dropped, at most PF_LIST_MAX characters. */
function listOf(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, PF_LIST_MAX);
}

/** The boxes of a typed list ("10×6, 12x5 15*4"): whole sides from 1 to PF_BOX_SIDE_MAX, at most PF_BOX_CEILING; others are left out. */
export function parseBoxes(text: string): PfBox[] {
  const out: PfBox[] = [];
  const re = /(\d+)\s*[x×X*]\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < PF_BOX_CEILING) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w >= 1 && h >= 1 && w <= PF_BOX_SIDE_MAX && h <= PF_BOX_SIDE_MAX) out.push({ w, h });
  }
  return out;
}

/** The sections of a typed list ("4,4,4,4,12"): whole line counts from 1 to PF_SECTION_LINES_MAX, at most PF_SECTION_CEILING. */
export function parseSections(text: string): number[] {
  const out: number[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (out.length >= PF_SECTION_CEILING) break;
    if (!/^\d+$/.test(token)) continue;
    const n = Number(token);
    if (n >= 1 && n <= PF_SECTION_LINES_MAX) out.push(n);
  }
  return out;
}

/** Validates the feature's fields (URL parameters, presets and project files alike). */
export function resolvePerfectFitFields(source: Partial<Record<keyof PerfectFitFields, unknown>> | null | undefined): PerfectFitFields {
  const s = source ?? {};
  const d = DEFAULT_PERFECT_FIT_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    pfVariant: isPfVariant(s.pfVariant) ? s.pfVariant : d.pfVariant,
    pfBoxes: listOf(s.pfBoxes, d.pfBoxes),
    pfPieceSec: numberOf("pfPieceSec", s.pfPieceSec),
    pfFall: numberOf("pfFall", s.pfFall),
    pfSeed: numberOf("pfSeed", s.pfSeed),
    pfSections: listOf(s.pfSections, d.pfSections),
    pfWellW: numberOf("pfWellW", s.pfWellW),
    pfWellH: numberOf("pfWellH", s.pfWellH),
    pfHold: bool(s.pfHold, d.pfHold),
    pfBeat: bool(s.pfBeat, d.pfBeat),
  };
}

/** What the mode runs of the fields, with the page's tempo (`engine.setPerfectFitSettings()`). */
export function perfectFitSettingsOf(s: PerfectFitFields & { bpm?: number }): PerfectFitSettings {
  return {
    variant: s.pfVariant,
    boxes: parseBoxes(s.pfBoxes),
    pieceSec: s.pfPieceSec,
    fall: s.pfFall,
    seed: s.pfSeed,
    sections: parseSections(s.pfSections),
    wellW: s.pfWellW,
    wellH: s.pfWellH,
    hold: s.pfHold,
    beat: s.pfBeat,
    bpm: typeof s.bpm === "number" && Number.isFinite(s.bpm) && s.bpm > 0 ? s.bpm : 120,
  };
}

/** The settings the engine runs: the defaults filled in, every value valid, the well at its memory-safety ceilings at most. */
export function resolvePerfectFitSettings(patch: Partial<PerfectFitSettings> | null | undefined): PerfectFitSettings {
  const base = perfectFitSettingsOf(DEFAULT_PERFECT_FIT_FIELDS);
  const merged = { ...base, ...(patch ?? {}) };
  const fields = resolvePerfectFitFields({ pfVariant: merged.variant, pfPieceSec: merged.pieceSec, pfFall: merged.fall, pfSeed: merged.seed, pfWellW: merged.wellW, pfWellH: merged.wellH, pfHold: merged.hold, pfBeat: merged.beat });
  const boxes = Array.isArray(merged.boxes) ? merged.boxes.filter((b) => b && Number.isInteger(b.w) && Number.isInteger(b.h) && b.w >= 1 && b.h >= 1 && b.w <= PF_BOX_SIDE_MAX && b.h <= PF_BOX_SIDE_MAX).slice(0, PF_BOX_CEILING) : base.boxes;
  const sections = Array.isArray(merged.sections) ? merged.sections.filter((n) => Number.isInteger(n) && n >= 1 && n <= PF_SECTION_LINES_MAX).slice(0, PF_SECTION_CEILING) : base.sections;
  return {
    variant: fields.pfVariant,
    boxes: boxes.map((b) => ({ w: b.w, h: b.h })),
    pieceSec: fields.pfPieceSec,
    fall: fields.pfFall,
    seed: fields.pfSeed,
    sections,
    wellW: memoryCeiling("pfWellW", fields.pfWellW),
    wellH: memoryCeiling("pfWellH", fields.pfWellH),
    hold: fields.pfHold,
    beat: fields.pfBeat,
    bpm: Number.isFinite(merged.bpm) && merged.bpm > 0 ? merged.bpm : 120,
  };
}

/** The beat (s) a run's landings follow: 60 / BPM with the beat on, 0 (free timing) with it off. */
export function perfectFitBeatSec(s: Pick<PerfectFitSettings, "beat" | "bpm">): number {
  return s.beat && s.bpm > 0 ? 60 / s.bpm : 0;
}

/* ------------------------------------------------------------------ the look */

/** The rectangles' page (an indigo gradient) and the perfect clears' (near-black); the loop HUD on in both. */
export const PERFECT_FIT_LOOKS: Readonly<Record<PfVariant, { backgroundType: "solid" | "gradient"; backgroundColors: [string, string]; loopHud: boolean }>> = {
  pento: { backgroundType: "gradient", backgroundColors: ["#1c1f4a", "#15173a"], loopHud: true },
  tetris: { backgroundType: "solid", backgroundColors: ["#0a0b14", "#0a0b14"], loopHud: true },
};

/** A variant's look (a fresh copy). */
export function perfectFitLook(variant: PfVariant) {
  const look = PERFECT_FIT_LOOKS[variant];
  return { backgroundType: look.backgroundType, backgroundColors: [...look.backgroundColors] as [string, string], loopHud: look.loopHud };
}

/** The mode's own defaults beside the feature's fields (in Perfect Fit only): the rectangles' look. */
export function perfectFitModeDefaults(mode: string): Partial<ReturnType<typeof perfectFitLook>> {
  return mode === "perfectFit" ? perfectFitLook(DEFAULT_PERFECT_FIT_FIELDS.pfVariant) : {};
}

/**
 * The patch of a variant switch on the panel: the variant, its seconds a piece when they are still the other variant's, and
 * its page when the page is still the other variant's look.
 */
export function perfectFitVariantPatch(current: PerfectFitFields & { backgroundType?: string; backgroundColors?: readonly string[] }, variant: PfVariant): Partial<PerfectFitFields> & Partial<ReturnType<typeof perfectFitLook>> {
  const other: PfVariant = variant === "pento" ? "tetris" : "pento";
  const patch: Partial<PerfectFitFields> & Partial<ReturnType<typeof perfectFitLook>> = { pfVariant: variant };
  if (current.pfPieceSec === PF_VARIANT_PIECE_SEC[other]) patch.pfPieceSec = PF_VARIANT_PIECE_SEC[variant];
  const look = PERFECT_FIT_LOOKS[other];
  const colors = current.backgroundColors ?? [];
  if (current.backgroundType === look.backgroundType && colors[0] === look.backgroundColors[0] && colors[1] === look.backgroundColors[1]) {
    const next = perfectFitLook(variant);
    patch.backgroundType = next.backgroundType;
    patch.backgroundColors = next.backgroundColors;
  }
  return patch;
}

/** The loop HUD's words of a variant (keys of the `PerfectFit` namespace): the title and the grey subtitle (the counter is under the box). */
export function perfectFitHudKeys(variant: PfVariant): { title: string; subtitle: string } {
  return variant === "tetris" ? { title: "PerfectFit.canvasTitleTetris", subtitle: "PerfectFit.canvasSubtitleTetris" } : { title: "PerfectFit.canvasTitlePento", subtitle: "PerfectFit.canvasSubtitlePento" };
}

/** Pieces in a Tetris run of the fields (well width × lines ÷ 4, the sections that tile), for the subtitle's count. */
export function perfectFitTetrisPieces(s: Pick<PerfectFitFields, "pfWellW" | "pfSections">): number {
  const w = Math.max(1, Math.round(s.pfWellW));
  return parseSections(s.pfSections).reduce((n, lines) => n + ((w * lines) % 4 === 0 ? (w * lines) / 4 : 0), 0);
}

/* ------------------------------------------------------------------ presets */

export const PF_PRESET_IDS = ["threeRects", "everyPiece", "speedRun", "bigWell"] as const;
export type PfPresetId = (typeof PF_PRESET_IDS)[number];

/** Translation keys (`PerfectFit` namespace) of the presets' names. */
export const PF_PRESET_LABELS: Readonly<Record<PfPresetId, string>> = {
  threeRects: "presetThreeRects",
  everyPiece: "presetEveryPiece",
  speedRun: "presetSpeedRun",
  bigWell: "presetBigWell",
};

export function isPfPresetId(value: unknown): value is PfPresetId {
  return typeof value === "string" && (PF_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields with its variant's look: Three rectangles (the 12 pentominoes into 10 × 6, 12 × 5 and 15 × 4 at 0.55 s a
 * piece – a 24.2 s loop), Every piece fits (Tetris: four four-line perfect clears and a held twelve-line finale, 70 pieces –
 * 18 s), Speed run (the rectangles at 0.15 s a piece) and Big well (Tetris in a 20 × 40 well, 40 lines).
 */
export function perfectFitPresetPatch(id: PfPresetId): PerfectFitFields & ReturnType<typeof perfectFitLook> {
  const base = defaultPerfectFitFields();
  if (id === "everyPiece") return { ...base, pfVariant: "tetris", pfPieceSec: 0.3, pfSections: PF_DEFAULT_SECTIONS, pfWellW: 10, pfWellH: 16, pfHold: true, ...perfectFitLook("tetris") };
  if (id === "speedRun") return { ...base, pfVariant: "pento", pfBoxes: PF_DEFAULT_BOXES, pfPieceSec: 0.15, ...perfectFitLook("pento") };
  if (id === "bigWell") return { ...base, pfVariant: "tetris", pfPieceSec: 0.3, pfSections: "4,4,4,4,24", pfWellW: 20, pfWellH: 40, pfHold: true, ...perfectFitLook("tetris") };
  return { ...base, pfVariant: "pento", pfBoxes: PF_DEFAULT_BOXES, pfPieceSec: 0.55, ...perfectFitLook("pento") };
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields. */
export const PF_URL_KEYS: Readonly<Record<string, NumberKey>> = { pfS: "pfPieceSec", pfF: "pfFall", pfSd: "pfSeed", pfW: "pfWellW", pfH: "pfWellH" };
const BOOL_KEYS: Readonly<Record<string, "pfHold" | "pfBeat">> = { pfHd: "pfHold", pfB: "pfBeat" };

/** Writes the fields that differ from `base` (the mode's defaults): pfV, pfBx, pfS, pfF, pfSd, pfSc, pfW, pfH, pfHd, pfB. */
export function writePerfectFitParams(settings: PerfectFitFields, base: PerfectFitFields, params: URLSearchParams) {
  if (settings.pfVariant !== base.pfVariant) params.set("pfV", settings.pfVariant);
  if (settings.pfBoxes !== base.pfBoxes) params.set("pfBx", settings.pfBoxes);
  if (settings.pfSections !== base.pfSections) params.set("pfSc", settings.pfSections);
  for (const [key, field] of Object.entries(PF_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readPerfectFitParams(params: URLSearchParams, settings: PerfectFitFields) {
  // (only the feature's own fields: the settings object is large, and a link is parsed often)
  const next: Partial<Record<keyof PerfectFitFields, unknown>> = { pfVariant: settings.pfVariant, pfBoxes: settings.pfBoxes, pfPieceSec: settings.pfPieceSec, pfFall: settings.pfFall, pfSeed: settings.pfSeed, pfSections: settings.pfSections, pfWellW: settings.pfWellW, pfWellH: settings.pfWellH, pfHold: settings.pfHold, pfBeat: settings.pfBeat };
  const variant = params.get("pfV");
  if (variant !== null) next.pfVariant = variant;
  const boxes = params.get("pfBx");
  if (boxes !== null) next.pfBoxes = boxes;
  const sections = params.get("pfSc");
  if (sections !== null) next.pfSections = sections;
  for (const [key, field] of Object.entries(PF_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolvePerfectFitFields(next));
}
