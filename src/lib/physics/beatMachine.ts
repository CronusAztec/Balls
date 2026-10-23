import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { BM_SOURCES, BM_VARIANTS, isBmSource, isBmVariant, type BmSource, type BmVariant } from "@/lib/simulation/beatMachinePlan";
import type { ScaleId } from "@/lib/audio/scales";

/*
 * --- beat-machine --- Beat Machines (the marble xylophone and the eight-step staircase of the loop family;
 * lib/physics/modes/beatMachine.ts runs them, lib/simulation/beatMachinePlan.ts plans them): the settings, their URL keys
 * (`bm…`), the presets and the clip's look. Nothing here touches the engine.
 */

export { BM_SOURCES, BM_VARIANTS, isBmSource, isBmVariant };
export type { BmSource, BmVariant };

/** What the mode runs (the page's fields, its Sound section's scale and root, and the loaded melody). */
export interface BeatMachineSettings {
  variant: BmVariant;
  bpm: number;
  /** Stairs: the steps and how far each sits from the last (% of the panel). */
  steps: number;
  stepDx: number;
  stepDy: number;
  /** Marbles: the tuned bars, the drop from a tube to its bar (% of the panel), the rebound off a bar, the marbles a tube holds (0 = auto). */
  bars: number;
  dropPct: number;
  rebound: number;
  perTube: number;
  /** Stairs: beats of the return trip (hook, track, climb, tip). */
  returnBeats: number;
  /** Where the notes come from, and the typed list. */
  source: BmSource;
  notes: string;
  /** Marbles: the loop's beats (32 at 100 BPM: 19.2 s). */
  loopBeats: number;
  /** The phrase bass every two bars (marbles). */
  bass: boolean;
  /** The loop HUD's note counter. */
  counter: boolean;
  /** The Sound section's scale and root (the bars' and the steps' pitches). */
  scale: ScaleId | string;
  root: number;
  /** The loaded melody's pitches (Hz), for the "melody" source. */
  melody: readonly number[];
}

/** The feature's fields of the SimulatorSettings object. */
export interface BeatMachineFields {
  /** marbles | stairs (URL `bmV`). */
  bmVariant: BmVariant;
  /** Tempo, 1–1000 on the slider (URL `bmBpm`): 100 for the marbles, 80 for the stairs. */
  bmBpm: number;
  /** Steps, 1–64 on the slider (URL `bmSt`), and their offsets, % of the panel (URL `bmDx`, `bmDy`). */
  bmSteps: number;
  bmStepDx: number;
  bmStepDy: number;
  /** Bars, 2–48 on the slider (URL `bmB`). */
  bmBars: number;
  /** Drop height, % of the panel, 1–90 on the slider (URL `bmDh`). */
  bmDrop: number;
  /** Rebound off a bar, 0–1.5 on the slider (URL `bmRb`). */
  bmRebound: number;
  /** Return beats, 0–64 on the slider (URL `bmRt`). */
  bmReturn: number;
  /** Marbles per tube: 0 = auto, else 1–50 on the slider (URL `bmMt`). */
  bmPerTube: number;
  /** original | scale | melody | custom (URL `bmSrc`), and the typed list (URL `bmN`). */
  bmSource: BmSource;
  bmNotes: string;
  /** Loop beats, 1–1024 on the slider (URL `bmL`). */
  bmLoopBeats: number;
  /** The phrase bass (URL `bmBs`) and the loop HUD's note counter (URL `bmC`). */
  bmBass: boolean;
  bmCounter: boolean;
}

/** The tempo a variant starts with: the marble xylophone's 100 BPM, the staircase's 80. */
export const BM_VARIANT_BPM: Readonly<Record<BmVariant, number>> = { marbles: 100, stairs: 80 };

export const DEFAULT_BEAT_MACHINE_FIELDS: Readonly<BeatMachineFields> = {
  bmVariant: "marbles",
  bmBpm: 100,
  bmSteps: 8,
  bmStepDx: 7.5,
  bmStepDy: 7.9,
  bmBars: 10,
  bmDrop: 28,
  bmRebound: 0.3,
  bmReturn: 4,
  bmPerTube: 0,
  bmSource: "original",
  bmNotes: "",
  bmLoopBeats: 32,
  bmBass: true,
  bmCounter: false,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const BM_RANGES = {
  bmBpm: { min: 1, max: 1000, step: 1 },
  bmSteps: { min: 1, max: 64, step: 1 },
  bmStepDx: { min: 0, max: 20, step: 0.1 },
  bmStepDy: { min: 0, max: 20, step: 0.1 },
  bmBars: { min: 2, max: 48, step: 1 },
  bmDrop: { min: 1, max: 90, step: 1 },
  bmRebound: { min: 0, max: 1.5, step: 0.05 },
  bmReturn: { min: 0, max: 64, step: 1 },
  bmPerTube: { min: 0, max: 50, step: 1 },
  bmLoopBeats: { min: 1, max: 1024, step: 1 },
} as const;

type NumberKey = keyof typeof BM_RANGES;
const WHOLE_KEYS: readonly NumberKey[] = ["bmSteps", "bmBars", "bmReturn", "bmPerTube", "bmLoopBeats"];
/** The fields the mode's engine reads (every number: the plan is physics). */
export const BM_ENGINE_KEYS: readonly NumberKey[] = ["bmBpm", "bmSteps", "bmStepDx", "bmStepDy", "bmBars", "bmDrop", "bmRebound", "bmReturn", "bmPerTube", "bmLoopBeats"];
/** The fields a change of which re-plans and restarts the run (the counter follows live). */
export const BM_RESTART_FIELDS: readonly (keyof BeatMachineFields)[] = ["bmVariant", "bmBpm", "bmSteps", "bmStepDx", "bmStepDy", "bmBars", "bmDrop", "bmRebound", "bmReturn", "bmPerTube", "bmSource", "bmNotes", "bmLoopBeats", "bmBass"];
/** The longest typed list kept (characters). */
export const BM_NOTES_MAX = 4000;

export function defaultBeatMachineFields(): BeatMachineFields {
  return { ...DEFAULT_BEAT_MACHINE_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_BEAT_MACHINE_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, BM_RANGES[key]);
  return WHOLE_KEYS.includes(key) ? Math.round(v) : v;
}

/** A clean typed list: a string, control characters dropped, at most BM_NOTES_MAX characters. */
function notesOf(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, BM_NOTES_MAX);
}

/** Validates the feature's fields (URL parameters, presets and project files alike). */
export function resolveBeatMachineFields(source: Partial<Record<keyof BeatMachineFields, unknown>> | null | undefined): BeatMachineFields {
  const s = source ?? {};
  const d = DEFAULT_BEAT_MACHINE_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    bmVariant: isBmVariant(s.bmVariant) ? s.bmVariant : d.bmVariant,
    bmBpm: numberOf("bmBpm", s.bmBpm),
    bmSteps: numberOf("bmSteps", s.bmSteps),
    bmStepDx: numberOf("bmStepDx", s.bmStepDx),
    bmStepDy: numberOf("bmStepDy", s.bmStepDy),
    bmBars: numberOf("bmBars", s.bmBars),
    bmDrop: numberOf("bmDrop", s.bmDrop),
    bmRebound: numberOf("bmRebound", s.bmRebound),
    bmReturn: numberOf("bmReturn", s.bmReturn),
    bmPerTube: numberOf("bmPerTube", s.bmPerTube),
    bmSource: isBmSource(s.bmSource) ? s.bmSource : d.bmSource,
    bmNotes: notesOf(s.bmNotes, d.bmNotes),
    bmLoopBeats: numberOf("bmLoopBeats", s.bmLoopBeats),
    bmBass: bool(s.bmBass, d.bmBass),
    bmCounter: bool(s.bmCounter, d.bmCounter),
  };
}

/** What the mode runs of the fields, with the page's scale and root and the loaded melody (`engine.setBeatMachineSettings()`). */
export function beatMachineSettingsOf(s: BeatMachineFields & { scale?: ScaleId | string; rootNote?: number }, melody: readonly number[] = []): BeatMachineSettings {
  return {
    variant: s.bmVariant,
    bpm: s.bmBpm,
    steps: s.bmSteps,
    stepDx: s.bmStepDx,
    stepDy: s.bmStepDy,
    bars: s.bmBars,
    dropPct: s.bmDrop,
    rebound: s.bmRebound,
    perTube: s.bmPerTube,
    returnBeats: s.bmReturn,
    source: s.bmSource,
    notes: s.bmNotes,
    loopBeats: s.bmLoopBeats,
    bass: s.bmBass,
    counter: s.bmCounter,
    scale: s.scale ?? "chromatic",
    root: typeof s.rootNote === "number" && Number.isFinite(s.rootNote) ? s.rootNote : 0,
    melody,
  };
}

/** The engine's settings back under the fields' names. */
function beatMachineSettingFields(s: BeatMachineSettings): BeatMachineFields {
  return {
    bmVariant: s.variant,
    bmBpm: s.bpm,
    bmSteps: s.steps,
    bmStepDx: s.stepDx,
    bmStepDy: s.stepDy,
    bmBars: s.bars,
    bmDrop: s.dropPct,
    bmRebound: s.rebound,
    bmReturn: s.returnBeats,
    bmPerTube: s.perTube,
    bmSource: s.source,
    bmNotes: s.notes,
    bmLoopBeats: s.loopBeats,
    bmBass: s.bass,
    bmCounter: s.counter,
  };
}

/** The settings the engine runs: the defaults filled in, every value valid, the counts at their memory-safety ceilings at most. */
export function resolveBeatMachineSettings(patch: Partial<BeatMachineSettings> | null | undefined): BeatMachineSettings {
  const base = beatMachineSettingsOf(DEFAULT_BEAT_MACHINE_FIELDS);
  const merged = { ...base, ...(patch ?? {}) };
  const fields = resolveBeatMachineFields(beatMachineSettingFields(merged));
  const out = beatMachineSettingsOf({ ...fields, scale: typeof merged.scale === "string" ? merged.scale : "chromatic", rootNote: Number.isFinite(merged.root) ? merged.root : 0 }, Array.isArray(merged.melody) ? merged.melody : []);
  out.steps = memoryCeiling("bmSteps", out.steps);
  out.bars = memoryCeiling("bmBars", out.bars);
  out.perTube = memoryCeiling("bmPerTube", out.perTube);
  out.loopBeats = memoryCeiling("bmLoopBeats", out.loopBeats);
  // (--- unlimited-sizes --- the return trip's beats size nothing – SIZES_NOTHING of tests/uncap.test.ts – so they have no ceiling)
  return out;
}

/* ------------------------------------------------------------------ the look */

/** The marble xylophone's page (a warm dark-brown gradient) and the staircase's (navy); the loop HUD on in both. */
export const BEAT_MACHINE_LOOKS: Readonly<Record<BmVariant, { backgroundType: "solid" | "gradient"; backgroundColors: [string, string]; loopHud: boolean }>> = {
  marbles: { backgroundType: "gradient", backgroundColors: ["#18120e", "#241a13"], loopHud: true },
  stairs: { backgroundType: "solid", backgroundColors: ["#07101a", "#07101a"], loopHud: true },
};

/** A variant's look (a fresh copy). */
export function beatMachineLook(variant: BmVariant) {
  const look = BEAT_MACHINE_LOOKS[variant];
  return { backgroundType: look.backgroundType, backgroundColors: [...look.backgroundColors] as [string, string], loopHud: look.loopHud };
}

/** The mode's own defaults beside the feature's fields (in Beat Machines only): the marble xylophone's look. */
export function beatMachineModeDefaults(mode: string): Partial<ReturnType<typeof beatMachineLook>> {
  return mode === "beatMachine" ? beatMachineLook(DEFAULT_BEAT_MACHINE_FIELDS.bmVariant) : {};
}

/**
 * The patch of a variant switch on the panel: the variant, its tempo when the tempo is still the other variant's, and its page
 * when the page is still the other variant's look.
 */
export function beatMachineVariantPatch(current: BeatMachineFields & { backgroundType?: string; backgroundColors?: readonly string[] }, variant: BmVariant): Partial<BeatMachineFields> & Partial<ReturnType<typeof beatMachineLook>> {
  const other: BmVariant = variant === "marbles" ? "stairs" : "marbles";
  const patch: Partial<BeatMachineFields> & Partial<ReturnType<typeof beatMachineLook>> = { bmVariant: variant };
  if (current.bmBpm === BM_VARIANT_BPM[other]) patch.bmBpm = BM_VARIANT_BPM[variant];
  const look = BEAT_MACHINE_LOOKS[other];
  const colors = current.backgroundColors ?? [];
  if (current.backgroundType === look.backgroundType && colors[0] === look.backgroundColors[0] && colors[1] === look.backgroundColors[1]) {
    const next = beatMachineLook(variant);
    patch.backgroundType = next.backgroundType;
    patch.backgroundColors = next.backgroundColors;
  }
  return patch;
}

/** The loop HUD's words of a variant (keys of the `BeatMachine` namespace): the title, the grey subtitle and the counter. */
export function beatMachineHudKeys(variant: BmVariant): { title: string; subtitle: string; counter: string } {
  return variant === "stairs"
    ? { title: "BeatMachine.canvasTitleStairs", subtitle: "BeatMachine.canvasSubtitleStairs", counter: "BeatMachine.canvasCounterStairs" }
    : { title: "BeatMachine.canvasTitleMarbles", subtitle: "BeatMachine.canvasSubtitleMarbles", counter: "BeatMachine.canvasCounterMarbles" };
}

/* ------------------------------------------------------------------ presets */

export const BM_PRESET_IDS = ["eightSteps", "scaleStairs", "xylophone", "yourMelody"] as const;
export type BmPresetId = (typeof BM_PRESET_IDS)[number];

/** Translation keys (`BeatMachine` namespace) of the presets' names. */
export const BM_PRESET_LABELS: Readonly<Record<BmPresetId, string>> = {
  eightSteps: "presetEightSteps",
  scaleStairs: "presetScaleStairs",
  xylophone: "presetXylophone",
  yourMelody: "presetYourMelody",
};

export function isBmPresetId(value: unknown): value is BmPresetId {
  return typeof value === "string" && (BM_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields with its variant's look: Eight steps (the staircase: 8 steps, an original phrase, 80 BPM, 4 return beats –
 * 9 s), Scale staircase (16 steps closer together playing the scale's ladder), Marble xylophone (10 bars, a seeded original
 * tune, 100 BPM, 32 beats – 19.2 s) and Load your melody (the marbles playing the loaded melody).
 */
export function beatMachinePresetPatch(id: BmPresetId): BeatMachineFields & ReturnType<typeof beatMachineLook> {
  const base = defaultBeatMachineFields();
  if (id === "eightSteps") return { ...base, bmVariant: "stairs", bmBpm: 80, bmSteps: 8, bmReturn: 4, bmSource: "original", ...beatMachineLook("stairs") };
  if (id === "scaleStairs") return { ...base, bmVariant: "stairs", bmBpm: 80, bmSteps: 16, bmStepDx: 4.6, bmStepDy: 4.4, bmReturn: 4, bmSource: "scale", ...beatMachineLook("stairs") };
  if (id === "yourMelody") return { ...base, bmVariant: "marbles", bmBpm: 100, bmBars: 10, bmSource: "melody", ...beatMachineLook("marbles") };
  return { ...base, bmVariant: "marbles", bmBpm: 100, bmBars: 10, bmLoopBeats: 32, bmSource: "original", ...beatMachineLook("marbles") };
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields (bounce math owns `bmr` and `bmh`, the beat markers `bm`: these never collide). */
export const BM_URL_KEYS: Readonly<Record<string, NumberKey>> = { bmBpm: "bmBpm", bmSt: "bmSteps", bmDx: "bmStepDx", bmDy: "bmStepDy", bmB: "bmBars", bmDh: "bmDrop", bmRb: "bmRebound", bmRt: "bmReturn", bmMt: "bmPerTube", bmL: "bmLoopBeats" };
const BOOL_KEYS: Readonly<Record<string, "bmBass" | "bmCounter">> = { bmBs: "bmBass", bmC: "bmCounter" };

/** Writes the fields that differ from `base` (the mode's defaults): bmV, bmBpm, bmSt, bmDx, bmDy, bmB, bmDh, bmRb, bmRt, bmMt, bmSrc, bmN, bmL, bmBs, bmC. */
export function writeBeatMachineParams(settings: BeatMachineFields, base: BeatMachineFields, params: URLSearchParams) {
  if (settings.bmVariant !== base.bmVariant) params.set("bmV", settings.bmVariant);
  // --- low-findings-2 --- the tempo against the one a reader assumes: the written variant's own (80 for the stairs), else the base's
  const bpmBase = settings.bmVariant !== base.bmVariant && isBmVariant(settings.bmVariant) ? BM_VARIANT_BPM[settings.bmVariant] : base.bmBpm;
  for (const [key, field] of Object.entries(BM_URL_KEYS)) if (settings[field] !== (field === "bmBpm" ? bpmBase : base[field])) params.set(key, formatNumber(settings[field]));
  if (settings.bmSource !== base.bmSource) params.set("bmSrc", settings.bmSource);
  if (settings.bmNotes !== base.bmNotes) params.set("bmN", settings.bmNotes);
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readBeatMachineParams(params: URLSearchParams, settings: BeatMachineFields) {
  const next: Partial<Record<keyof BeatMachineFields, unknown>> = { ...settings };
  const variant = params.get("bmV");
  if (variant !== null) next.bmVariant = variant;
  // --- low-findings-2 --- a link that names another variant but no tempo plays that variant's own (bmV=stairs: 80 BPM, like
  // its presets and a switch on the panel), never the page's 100
  if (isBmVariant(variant) && variant !== settings.bmVariant && params.get("bmBpm") === null) next.bmBpm = BM_VARIANT_BPM[variant];
  for (const [key, field] of Object.entries(BM_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const source = params.get("bmSrc");
  if (source !== null) next.bmSource = source;
  const notes = params.get("bmN");
  if (notes !== null) next.bmNotes = notes;
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveBeatMachineFields(next));
}
