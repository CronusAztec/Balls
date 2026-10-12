import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { scanBellFrequencies } from "@/lib/audio/loopTones";

/*
 * --- wave-tank --- Wave Tank (a ripple tank of the loop family; lib/physics/modes/waveTank.ts runs it, lib/simulation/
 * waveField.ts is its water): the settings, their URL keys (`wt…`), the sections (the barrier's gap counts and how long each
 * holds), the presets, the clip's look and the bell row's pitches. Nothing here touches the engine.
 */

export const WT_MODELS = ["grid", "huygens"] as const;
export type WtModel = (typeof WT_MODELS)[number];
export const WT_SOURCES = ["line", "points"] as const;
export type WtSource = (typeof WT_SOURCES)[number];

export function isWtModel(value: unknown): value is WtModel {
  return typeof value === "string" && (WT_MODELS as readonly string[]).includes(value);
}
export function isWtSource(value: unknown): value is WtSource {
  return typeof value === "string" && (WT_SOURCES as readonly string[]).includes(value);
}

/** The feature's fields of the SimulatorSettings object. */
export interface WaveTankFields {
  /** grid (the wave equation on a grid) | huygens (a sum of wavelets from every gap) – URL `wtM`. */
  wtModel: WtModel;
  /** line (a wave-maker along the back and a barrier) | points (a source in place of every gap, no barrier) – URL `wtSrc`. */
  wtSource: WtSource;
  /** The sections: gap counts in order, each optionally with its seconds ("1, 2, 7" or "1@11, 2@9, 7@10") – URL `wtG`. */
  wtGaps: string;
  /** Gap width in wavelengths, 0.1–5 on the slider (URL `wtW`). */
  wtWidth: number;
  /** The width the last section's gaps grow to (0: every section's gaps are Gap width) – URL `wtWe`. */
  wtWidthEnd: number;
  /** Gap spacing (centre to centre) in wavelengths, 0.5–20 on the slider (URL `wtD`). */
  wtSpacing: number;
  /** Wavelength, % of the tank's width, 1–30 on the slider (URL `wtL`). */
  wtWavelength: number;
  /** Wave speed, 0.1–5 on the slider (1 = 0.3 tank widths a second) – URL `wtV`. */
  wtSpeed: number;
  /** Damping γ, per radian of the wave (0.002: a slight fade toward the front) – URL `wtY`. */
  wtDamping: number;
  /** Grid columns, 32–1024 on the slider (URL `wtN`; the grid stops at ~4 M cells). */
  wtCols: number;
  /** Seconds a section holds when its entry names none, 1–120 on the slider (URL `wtS`). */
  wtSection: number;
  /** Seconds of the first section that close the loop (it wraps across the loop point) – URL `wtWr`. */
  wtWrap: number;
  /** Bells along the front edge, 1–64 on the slider (URL `wtB`). */
  wtBells: number;
  /** Strikes a second of the scanning cursor, 0.5–32 on the slider (URL `wtSr`). */
  wtScanRate: number;
  /** Ridge lines drawn, 8–256 on the slider (URL `wtR`). */
  wtRidges: number;
  /** Perspective tilt (°) of the view, 0–80 on the slider (URL `wtT`). */
  wtTilt: number;
  /** The section's root bass under the bells (URL `wtBs`). */
  wtBass: boolean;
  /** The loop HUD's section label ("2 gaps") – URL `wtLb`. */
  wtLabel: boolean;
}

export const DEFAULT_WAVE_TANK_FIELDS: Readonly<WaveTankFields> = {
  wtModel: "grid",
  wtSource: "line",
  wtGaps: "1, 2, 7",
  wtWidth: 0.6,
  wtWidthEnd: 0,
  wtSpacing: 2,
  wtWavelength: 6,
  wtSpeed: 1,
  wtDamping: 0.002,
  wtCols: 192,
  wtSection: 10,
  wtWrap: 5,
  wtBells: 11,
  wtScanRate: 8,
  wtRidges: 40,
  wtTilt: 30,
  wtBass: true,
  wtLabel: true,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const WT_RANGES = {
  wtWidth: { min: 0.1, max: 5, step: 0.05 },
  wtWidthEnd: { min: 0, max: 5, step: 0.05 },
  wtSpacing: { min: 0.5, max: 20, step: 0.1 },
  wtWavelength: { min: 1, max: 30, step: 0.5 },
  wtSpeed: { min: 0.1, max: 5, step: 0.05 },
  wtDamping: { min: 0, max: 0.1, step: 0.001 },
  wtCols: { min: 32, max: 1024, step: 1 },
  wtSection: { min: 1, max: 120, step: 0.5 },
  wtWrap: { min: 0, max: 120, step: 0.5 },
  wtBells: { min: 1, max: 64, step: 1 },
  wtScanRate: { min: 0.5, max: 32, step: 0.5 },
  wtRidges: { min: 8, max: 256, step: 1 },
  wtTilt: { min: 0, max: 80, step: 0.5 },
} as const;

type NumberKey = keyof typeof WT_RANGES;
const WHOLE_KEYS: readonly NumberKey[] = ["wtCols", "wtBells", "wtRidges"];
/** The fields the mode's engine reads (every number but the view's tilt: the water, the sections, the bells and the ridges' samples). */
export const WT_ENGINE_KEYS: readonly NumberKey[] = ["wtWidth", "wtWidthEnd", "wtSpacing", "wtWavelength", "wtSpeed", "wtDamping", "wtCols", "wtSection", "wtWrap", "wtBells", "wtScanRate", "wtRidges"];
/** The fields a change of which rebuilds the water and restarts the run (the bells, the scan, the ridges, the tilt, the bass and the label follow live). */
export const WT_RESTART_FIELDS: readonly (keyof WaveTankFields)[] = ["wtModel", "wtSource", "wtGaps", "wtWidth", "wtWidthEnd", "wtSpacing", "wtWavelength", "wtSpeed", "wtDamping", "wtCols", "wtSection", "wtWrap"];
/** The longest gap list kept (characters). */
export const WT_GAPS_MAX = 2000;
/** Sections a list keeps at most, and gaps a section opens at most (memory-safety ceilings: each gap is a barrier opening and a wavelet set). */
export const WT_SECTION_CEILING = 256;
export const WT_GAP_CEILING = 4096;

export function defaultWaveTankFields(): WaveTankFields {
  return { ...DEFAULT_WAVE_TANK_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_WAVE_TANK_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, WT_RANGES[key]);
  return WHOLE_KEYS.includes(key) ? Math.round(v) : v;
}

/** A clean gap list: a string, control characters dropped, at most WT_GAPS_MAX characters. */
function gapsOf(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, WT_GAPS_MAX);
}

/** Validates the feature's fields (URL parameters, presets and project files alike). */
export function resolveWaveTankFields(source: Partial<Record<keyof WaveTankFields, unknown>> | null | undefined): WaveTankFields {
  const s = source ?? {};
  const d = DEFAULT_WAVE_TANK_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    wtModel: isWtModel(s.wtModel) ? s.wtModel : d.wtModel,
    wtSource: isWtSource(s.wtSource) ? s.wtSource : d.wtSource,
    wtGaps: gapsOf(s.wtGaps, d.wtGaps),
    wtWidth: numberOf("wtWidth", s.wtWidth),
    wtWidthEnd: numberOf("wtWidthEnd", s.wtWidthEnd),
    wtSpacing: numberOf("wtSpacing", s.wtSpacing),
    wtWavelength: numberOf("wtWavelength", s.wtWavelength),
    wtSpeed: numberOf("wtSpeed", s.wtSpeed),
    wtDamping: numberOf("wtDamping", s.wtDamping),
    wtCols: numberOf("wtCols", s.wtCols),
    wtSection: numberOf("wtSection", s.wtSection),
    wtWrap: numberOf("wtWrap", s.wtWrap),
    wtBells: numberOf("wtBells", s.wtBells),
    wtScanRate: numberOf("wtScanRate", s.wtScanRate),
    wtRidges: numberOf("wtRidges", s.wtRidges),
    wtTilt: numberOf("wtTilt", s.wtTilt),
    wtBass: bool(s.wtBass, d.wtBass),
    wtLabel: bool(s.wtLabel, d.wtLabel),
  };
}

/* ------------------------------------------------------------------ what the engine runs */

/** What the mode runs (the page's fields under the engine's names). */
export interface WaveTankSettings {
  model: WtModel;
  source: WtSource;
  gaps: string;
  width: number;
  widthEnd: number;
  spacing: number;
  wavelengthPct: number;
  speed: number;
  damping: number;
  cols: number;
  sectionSec: number;
  wrapSec: number;
  bells: number;
  scanRate: number;
  ridges: number;
  tilt: number;
  bass: boolean;
  label: boolean;
}

/** What the mode runs of the fields (`engine.setWaveTankSettings()`). */
export function waveTankSettingsOf(s: WaveTankFields): WaveTankSettings {
  return {
    model: s.wtModel,
    source: s.wtSource,
    gaps: s.wtGaps,
    width: s.wtWidth,
    widthEnd: s.wtWidthEnd,
    spacing: s.wtSpacing,
    wavelengthPct: s.wtWavelength,
    speed: s.wtSpeed,
    damping: s.wtDamping,
    cols: s.wtCols,
    sectionSec: s.wtSection,
    wrapSec: s.wtWrap,
    bells: s.wtBells,
    scanRate: s.wtScanRate,
    ridges: s.wtRidges,
    tilt: s.wtTilt,
    bass: s.wtBass,
    label: s.wtLabel,
  };
}

function waveTankSettingFields(s: WaveTankSettings): WaveTankFields {
  return {
    wtModel: s.model,
    wtSource: s.source,
    wtGaps: s.gaps,
    wtWidth: s.width,
    wtWidthEnd: s.widthEnd,
    wtSpacing: s.spacing,
    wtWavelength: s.wavelengthPct,
    wtSpeed: s.speed,
    wtDamping: s.damping,
    wtCols: s.cols,
    wtSection: s.sectionSec,
    wtWrap: s.wrapSec,
    wtBells: s.bells,
    wtScanRate: s.scanRate,
    wtRidges: s.ridges,
    wtTilt: s.tilt,
    wtBass: s.bass,
    wtLabel: s.label,
  };
}

/** The settings the engine runs: the defaults filled in, every value valid, the counts at their memory-safety ceilings at most. */
export function resolveWaveTankSettings(patch: Partial<WaveTankSettings> | null | undefined): WaveTankSettings {
  const merged = { ...waveTankSettingsOf(DEFAULT_WAVE_TANK_FIELDS), ...(patch ?? {}) };
  const out = waveTankSettingsOf(resolveWaveTankFields(waveTankSettingFields(merged)));
  out.cols = memoryCeiling("wtCols", out.cols);
  out.bells = memoryCeiling("wtBells", out.bells);
  out.ridges = memoryCeiling("wtRidges", out.ridges);
  return out;
}

/* ------------------------------------------------------------------ sections */

/** One section of the loop: its gaps, its length in 60 Hz frames and its gaps' width (wavelengths). */
export interface WaveSection {
  gaps: number;
  frames: number;
  width: number;
}

/**
 * The sections of a gap list ("1, 2, 7"; an entry may name its own seconds: "1@11"): whole gap counts from 1 up (at most
 * WT_GAP_CEILING), seconds from one frame up (whole frames), at most WT_SECTION_CEILING sections; an empty or unreadable list
 * is the default 1, 2, 7. The gaps' width runs from `width` in the first section to `widthEnd` in the last (0: `width` in all).
 */
export function parseWaveSections(list: string, sectionSec: number, width: number, widthEnd = 0): WaveSection[] {
  const fallbackSec = Number.isFinite(sectionSec) && sectionSec > 0 ? sectionSec : DEFAULT_WAVE_TANK_FIELDS.wtSection;
  const entries: { gaps: number; seconds: number }[] = [];
  for (const raw of String(list ?? "").split(/[,;\n]+/)) {
    if (entries.length >= WT_SECTION_CEILING) break;
    const m = /^\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(?:@\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*s?)?\s*$/i.exec(raw);
    if (!m) continue;
    const gaps = Math.min(WT_GAP_CEILING, Math.max(1, Math.round(Number(m[1]))));
    const seconds = m[2] !== undefined && Number.isFinite(Number(m[2])) ? Number(m[2]) : fallbackSec;
    entries.push({ gaps, seconds });
  }
  if (entries.length === 0) for (const gaps of [1, 2, 7]) entries.push({ gaps, seconds: fallbackSec });
  const w0 = Number.isFinite(width) && width > 0 ? width : DEFAULT_WAVE_TANK_FIELDS.wtWidth;
  const w1 = Number.isFinite(widthEnd) && widthEnd > 0 ? widthEnd : w0;
  const n = entries.length;
  return entries.map((e, i) => ({
    gaps: e.gaps,
    frames: Math.max(1, Math.round(Math.min(1e7, Math.max(0, e.seconds)) * 60)),
    width: n > 1 ? w0 + ((w1 - w0) * i) / (n - 1) : w0,
  }));
}

/** The loop's timeline: where each section starts (frames from the first section's start), its length and the wrap. */
export interface WaveSchedule {
  sections: WaveSection[];
  /** starts[i]: frame of the timeline where section i starts; starts[n]: the loop's frames. */
  starts: number[];
  loopFrames: number;
  /** Frames of the first section that close the loop: loop frame 0 is timeline frame `wrapFrames`. */
  wrapFrames: number;
}

export function waveSchedule(sections: readonly WaveSection[], wrapSec: number): WaveSchedule {
  const list = sections.length > 0 ? sections : parseWaveSections("", 10, 0.6);
  const starts = [0];
  for (const s of list) starts.push(starts[starts.length - 1] + s.frames);
  const loopFrames = starts[starts.length - 1];
  const wrap = Number.isFinite(wrapSec) && wrapSec > 0 ? Math.round(wrapSec * 60) : 0;
  return { sections: [...list], starts, loopFrames, wrapFrames: Math.min(list[0].frames, wrap) };
}

/** The section in force at loop time `frame` (60 Hz frames, any real number: the loop repeats). */
export function sectionAtFrame(schedule: WaveSchedule, frame: number): number {
  const L = schedule.loopFrames;
  let tau = (frame + schedule.wrapFrames) % L;
  if (tau < 0) tau += L;
  const starts = schedule.starts;
  let lo = 0;
  let hi = schedule.sections.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= tau) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The loop times (s) at which the section changes, in order (the HUD's label changes then). */
export function sectionChangeTimes(schedule: WaveSchedule): number[] {
  const out: number[] = [];
  for (let i = 1; i <= schedule.sections.length; i++) {
    const at = (((schedule.starts[i] - schedule.wrapFrames) % schedule.loopFrames) + schedule.loopFrames) % schedule.loopFrames;
    if (i < schedule.sections.length || schedule.wrapFrames > 0) {
      if (at > 0) out.push(at / 60);
    }
  }
  return out.sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ sound */

/** The bell row's pitches: `count` bells left to right in A major pentatonic over two octaves from A3 (loopTones' scan row). */
export function waveBellFrequencies(count: number): number[] {
  return scanBellFrequencies(Math.max(1, Math.min(4096, Math.floor(count))), 57, "majorPentatonic");
}

/** Semitones above A1 (55 Hz) of each section's root: A, D, E, B, F# – I, IV, V for the 1, 2, 7 sections. */
export const WT_ROOT_SEMITONES = [0, 5, 7, 2, 9] as const;

/** The root bass (Hz) under section `index`. */
export function sectionRootHz(index: number): number {
  const i = ((Math.floor(index) % WT_ROOT_SEMITONES.length) + WT_ROOT_SEMITONES.length) % WT_ROOT_SEMITONES.length;
  return 55 * Math.pow(2, WT_ROOT_SEMITONES[i] / 12);
}

/* ------------------------------------------------------------------ the look */

/** The clip's navy page, with the loop HUD on (its title, subtitle and the amber section label). */
export const WAVE_TANK_LOOK = { backgroundType: "solid" as const, backgroundColors: ["#070b17", "#070b17"] as [string, string], loopHud: true };

export function waveTankLook() {
  return { backgroundType: WAVE_TANK_LOOK.backgroundType, backgroundColors: [...WAVE_TANK_LOOK.backgroundColors] as [string, string], loopHud: WAVE_TANK_LOOK.loopHud };
}

/** The mode's own defaults beside the feature's fields (in Wave Tank only): the navy page and the loop HUD. */
export function waveTankModeDefaults(mode: string): Partial<ReturnType<typeof waveTankLook>> {
  return mode === "waveTank" ? waveTankLook() : {};
}

/* ------------------------------------------------------------------ presets */

export const WT_PRESET_IDS = ["doubleSlit", "widthSweep", "grating15", "twoSources", "talbot"] as const;
export type WtPresetId = (typeof WT_PRESET_IDS)[number];

/** Translation keys (`WaveTank` namespace) of the presets' names. */
export const WT_PRESET_LABELS: Readonly<Record<WtPresetId, string>> = {
  doubleSlit: "presetDoubleSlit",
  widthSweep: "presetWidthSweep",
  grating15: "presetGrating15",
  twoSources: "presetTwoSources",
  talbot: "presetTalbot",
};

export function isWtPresetId(value: unknown): value is WtPresetId {
  return typeof value === "string" && (WT_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields with the clip's look: Double slit (the reference: 1 gap for 11 s wrapping across the loop point, 2 gaps
 * for 9 s, 7 gaps for 10 s – the label changes at 6, 15 and 25 s of a 30 s loop), Single-slit width sweep (one gap growing
 * from 0.3 λ to 3 λ over six 5 s sections), Grating 15 (fifteen gaps 1.6 wavelengths apart on a finer grid), Two sources (two
 * point sources three wavelengths apart, no barrier) and Talbot carpet (21 narrow gaps seen from higher up, the Huygens sum).
 */
export function waveTankPresetPatch(id: WtPresetId): WaveTankFields & ReturnType<typeof waveTankLook> {
  const base = defaultWaveTankFields();
  const look = waveTankLook();
  if (id === "widthSweep") return { ...base, wtGaps: "1, 1, 1, 1, 1, 1", wtSection: 5, wtWrap: 0, wtWidth: 0.3, wtWidthEnd: 3, ...look };
  if (id === "grating15") return { ...base, wtGaps: "15", wtSection: 10, wtWrap: 0, wtWidth: 0.5, wtSpacing: 1.6, wtWavelength: 4, wtCols: 256, wtRidges: 56, ...look };
  if (id === "twoSources") return { ...base, wtSource: "points", wtGaps: "2", wtSection: 10, wtWrap: 0, wtSpacing: 3, ...look };
  if (id === "talbot") return { ...base, wtModel: "huygens", wtGaps: "21", wtSection: 10, wtWrap: 0, wtWidth: 0.4, wtSpacing: 1.5, wtWavelength: 3, wtRidges: 128, wtTilt: 60, ...look };
  return { ...base, wtGaps: "1@11, 2@9, 7@10", wtSection: 10, wtWrap: 5, ...look };
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields (wt…: no other feature's key starts so). */
export const WT_URL_KEYS: Readonly<Record<string, NumberKey>> = { wtW: "wtWidth", wtWe: "wtWidthEnd", wtD: "wtSpacing", wtL: "wtWavelength", wtV: "wtSpeed", wtY: "wtDamping", wtN: "wtCols", wtS: "wtSection", wtWr: "wtWrap", wtB: "wtBells", wtSr: "wtScanRate", wtR: "wtRidges", wtT: "wtTilt" };
const BOOL_KEYS: Readonly<Record<string, "wtBass" | "wtLabel">> = { wtBs: "wtBass", wtLb: "wtLabel" };

/** Writes the fields that differ from `base` (the mode's defaults): wtM, wtSrc, wtG, wtW, wtWe, wtD, wtL, wtV, wtY, wtN, wtS, wtWr, wtB, wtSr, wtR, wtT, wtBs, wtLb. */
export function writeWaveTankParams(settings: WaveTankFields, base: WaveTankFields, params: URLSearchParams) {
  if (settings.wtModel !== base.wtModel) params.set("wtM", settings.wtModel);
  if (settings.wtSource !== base.wtSource) params.set("wtSrc", settings.wtSource);
  if (settings.wtGaps !== base.wtGaps) params.set("wtG", settings.wtGaps);
  for (const [key, field] of Object.entries(WT_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readWaveTankParams(params: URLSearchParams, settings: WaveTankFields) {
  // (only the feature's own fields: the settings object is large, and a link is parsed often)
  const next: Partial<Record<keyof WaveTankFields, unknown>> = {};
  for (const key of Object.keys(DEFAULT_WAVE_TANK_FIELDS) as (keyof WaveTankFields)[]) next[key] = settings[key];
  const model = params.get("wtM");
  if (model !== null) next.wtModel = model;
  const source = params.get("wtSrc");
  if (source !== null) next.wtSource = source;
  const gaps = params.get("wtG");
  if (gaps !== null) next.wtGaps = gaps;
  for (const [key, field] of Object.entries(WT_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveWaveTankFields(next));
}

/** The loop HUD's words (keys of the `WaveTank` namespace): the title, the grey subtitle and the section label's template. */
export function waveTankHudKeys(source: WtSource): { title: string; subtitle: string; counter: string } {
  return source === "points"
    ? { title: "WaveTank.canvasTitlePoints", subtitle: "WaveTank.canvasSubtitlePoints", counter: "WaveTank.sectionSources" }
    : { title: "WaveTank.canvasTitle", subtitle: "WaveTank.canvasSubtitle", counter: "WaveTank.sectionMany" };
}
