import { atLeastMin } from "@/lib/uncap";
import { COLOUR_SORT_RANGES, DEFAULT_COLOUR_SORT, colourSortCounts, isCsRule, type ColourSortSettings, type CsRule } from "./modes/colourSort";

/*
 * --- colour-sort --- The page settings of Colour Sort (lib/physics/modes/colourSort.ts runs them): the colours, the balls of
 * each, the gates of a ring and their width, the innermost ring's spin with its falloff and alternation, the balls' speed and
 * size, the contacts, the remix's length, the gate rule, the sort's time limit and the refusal flashes. Defaults, comfort
 * ranges (the sliders' tracks – every value from the minimum up is valid), URL keys (csc, csn, csg, csw, css, csf, csa, csv,
 * csr, csx, csm, csu, csl, csh) and validation, the presets, and the words of the loop HUD (the `ColourSort` namespace).
 */

/** The feature's fields of the SimulatorSettings object. */
export interface ColourSortFields {
  /** Colours – and rings (URL `csc`). */
  csColours: number;
  /** Balls of every colour (URL `csn`). */
  csPerColour: number;
  /** Gates of every gated ring, and their width in degrees (URL `csg`, `csw`). */
  csGates: number;
  csGateWidth: number;
  /** The innermost ring's spin (degrees a second), its falloff per ring outward and the alternating directions (URL `css`, `csf`, `csa`). */
  csSpin: number;
  csFalloff: number;
  csAlternate: boolean;
  /** The balls' speed (px/s) and size (radius, px), in px of the 720 × 1280 reference clip (URL `csv`, `csr`). */
  csSpeed: number;
  csSize: number;
  /** Elastic contacts between the balls (off: the ghost gas of the reference clip) (URL `csx`). */
  csContacts: boolean;
  /** Seconds the remix lasts (URL `csm`). */
  csRemix: number;
  /** The gate rule (URL `csu`). */
  csRule: CsRule;
  /** The sort's time limit (s) (URL `csl`). */
  csLimit: number;
  /** A short flash where a ring refuses a ball (URL `csh`). */
  csFlash: boolean;
}

export const DEFAULT_COLOUR_SORT_FIELDS: Readonly<ColourSortFields> = {
  csColours: DEFAULT_COLOUR_SORT.colours,
  csPerColour: DEFAULT_COLOUR_SORT.perColour,
  csGates: DEFAULT_COLOUR_SORT.gates,
  csGateWidth: DEFAULT_COLOUR_SORT.gateWidth,
  csSpin: DEFAULT_COLOUR_SORT.spin,
  csFalloff: DEFAULT_COLOUR_SORT.falloff,
  csAlternate: DEFAULT_COLOUR_SORT.alternate,
  csSpeed: DEFAULT_COLOUR_SORT.speed,
  csSize: DEFAULT_COLOUR_SORT.size,
  csContacts: DEFAULT_COLOUR_SORT.collisions,
  csRemix: DEFAULT_COLOUR_SORT.remix,
  csRule: DEFAULT_COLOUR_SORT.rule,
  csLimit: DEFAULT_COLOUR_SORT.limit,
  csFlash: DEFAULT_COLOUR_SORT.flashes,
};

export { COLOUR_SORT_RANGES };

type NumberKey = keyof typeof COLOUR_SORT_RANGES;
/** The fields the engine runs (a change restarts a Colour Sort run): everything but the flashes. */
export const COLOUR_SORT_ENGINE_KEYS: readonly string[] = ["csColours", "csPerColour", "csGates", "csGateWidth", "csSpin", "csFalloff", "csAlternate", "csSpeed", "csSize", "csContacts", "csRemix", "csRule", "csLimit"];

export function defaultColourSortFields(): ColourSortFields {
  return { ...DEFAULT_COLOUR_SORT_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (never a maximum); counts whole. */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_COLOUR_SORT_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const v = atLeastMin(n, COLOUR_SORT_RANGES[key]);
  return key === "csColours" || key === "csPerColour" || key === "csGates" ? Math.round(v) : v;
}

/** Validates the feature's fields (URL parameters, presets and project files alike): valid numbers, a known rule, real booleans. */
export function resolveColourSortFields(source: Partial<Record<keyof ColourSortFields, unknown>> | null | undefined): ColourSortFields {
  const s = source ?? {};
  const d = DEFAULT_COLOUR_SORT_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    csColours: numberOf("csColours", s.csColours),
    csPerColour: numberOf("csPerColour", s.csPerColour),
    csGates: numberOf("csGates", s.csGates),
    csGateWidth: numberOf("csGateWidth", s.csGateWidth),
    csSpin: numberOf("csSpin", s.csSpin),
    csFalloff: numberOf("csFalloff", s.csFalloff),
    csAlternate: bool(s.csAlternate, d.csAlternate),
    csSpeed: numberOf("csSpeed", s.csSpeed),
    csSize: numberOf("csSize", s.csSize),
    csContacts: bool(s.csContacts, d.csContacts),
    csRemix: numberOf("csRemix", s.csRemix),
    csRule: isCsRule(s.csRule) ? s.csRule : d.csRule,
    csLimit: numberOf("csLimit", s.csLimit),
    csFlash: bool(s.csFlash, d.csFlash),
  };
}

/** What the engine runs of the fields (`engine.setColourSortSettings()`; the page, the finder, the exports). */
export function colourSortSettingsOf(s: ColourSortFields): ColourSortSettings {
  return {
    colours: s.csColours,
    perColour: s.csPerColour,
    gates: s.csGates,
    gateWidth: s.csGateWidth,
    spin: s.csSpin,
    falloff: s.csFalloff,
    alternate: s.csAlternate,
    speed: s.csSpeed,
    size: s.csSize,
    collisions: s.csContacts,
    remix: s.csRemix,
    rule: s.csRule,
    limit: s.csLimit,
    flashes: s.csFlash,
  };
}

/** The balls a run of these fields holds in all (the colours × the balls of each, after the memory-safety ceilings). */
export function colourSortTotal(s: Pick<ColourSortFields, "csColours" | "csPerColour">): number {
  return colourSortCounts({ colours: s.csColours, perColour: s.csPerColour }).total;
}

/** True when a run builds fewer colours or balls than typed (a ceiling, or colours × balls past the balls a run holds): ARENA FULL. */
export function colourSortPastCeiling(s: Pick<ColourSortFields, "csColours" | "csPerColour">): boolean {
  const counts = colourSortCounts({ colours: s.csColours, perColour: s.csPerColour });
  return counts.colours < Math.round(s.csColours) || counts.perColour < Math.round(s.csPerColour);
}

/**
 * In Colour Sort only: the loop HUD on (the bold title over the rings and the amber "N / 360 sorted" under them), the balls'
 * glow on (glowing dots: the solid dot is half a ball's size, the glow the rest) and their trails off (hundreds of balls) –
 * and, switched on, in each ball's own colour (a rainbow trail would read as another colour). The drama layer is off: it
 * steers rebounds off gapped walls (there are none here), and its moods – a tension ring around every ball, the glow's
 * swell – run on a 50 s clock of their own that no cycle's seam would match.
 */
export function colourSortModeDefaults(mode: string): { loopHud?: boolean; showGlow?: boolean; showTrails?: boolean; colorTrail?: boolean; cinematicEnabled?: boolean } {
  return mode === "colourSort" ? { loopHud: true, showGlow: true, showTrails: false, colorTrail: false, cinematicEnabled: false } : {};
}

/* ------------------------------------------------------------------ the HUD's words (namespace ColourSort) */

/** The title and the subtitle of each rule (they state the rule in a line). */
export const COLOUR_SORT_HUD_KEYS: Readonly<Record<CsRule, { title: string; subtitle: string }>> = {
  outwardNotOwn: { title: "canvasTitle", subtitle: "canvasSubtitle" },
  outwardOwnOnly: { title: "canvasTitleOwnOnly", subtitle: "canvasSubtitleOwnOnly" },
  bothWaysNotOwn: { title: "canvasTitle", subtitle: "canvasSubtitleBothWays" },
};

/** The counter's template for the HUD: "[count] / [total] sorted" with the run's total filled in and `{count}` left for the frame. */
export function colourSortCounterTemplate(raw: string, total: number): string {
  return raw.replace("[count]", "{count}").replace("[total]", () => String(Math.round(total)));
}

/* ------------------------------------------------------------------ presets */

export const CS_PRESET_IDS = ["bullseye", "rainbow7", "torture", "tenThousand", "reverse"] as const;
export type CsPresetId = (typeof CS_PRESET_IDS)[number];

/** Translation keys of the presets' names (namespace ColourSort). */
export const CS_PRESET_LABELS: Readonly<Record<CsPresetId, string>> = {
  bullseye: "presetBullseye",
  rainbow7: "presetRainbow7",
  torture: "presetTorture",
  tenThousand: "presetTenThousand",
  reverse: "presetReverse",
};

/** The look every preset sets beside its fields: the reference clip's near-black navy page, glowing dots and the loop HUD. */
export const CS_LOOK = {
  backgroundType: "solid",
  backgroundColors: ["#050812", "#050812"],
  themeId: "",
  showGlow: true,
  showTrails: false,
  loopHud: true,
} as const;

/**
 * A preset's fields: Bullseye sort (4 × 90, the reference), Rainbow 7 (7 colours × 50), One-gate torture (one 10° gate a ring),
 * Ten thousand (4 × 2500, the ghost gas) and Reverse rule (a gate lets out only its own colour).
 */
export function colourSortPresetFields(id: CsPresetId): ColourSortFields {
  const base = defaultColourSortFields();
  switch (id) {
    case "rainbow7":
      return { ...base, csColours: 7, csPerColour: 50 };
    case "torture":
      return { ...base, csGates: 1, csGateWidth: 10 };
    case "tenThousand":
      return { ...base, csPerColour: 2500, csContacts: false, csSize: 2 };
    case "reverse":
      return { ...base, csRule: "outwardOwnOnly" };
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ URL */

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields and the switches. */
export const COLOUR_SORT_URL_KEYS: Readonly<Record<string, NumberKey>> = { csc: "csColours", csn: "csPerColour", csg: "csGates", csw: "csGateWidth", css: "csSpin", csf: "csFalloff", csv: "csSpeed", csr: "csSize", csm: "csRemix", csl: "csLimit" };
const BOOL_KEYS: Readonly<Record<string, "csAlternate" | "csContacts" | "csFlash">> = { csa: "csAlternate", csx: "csContacts", csh: "csFlash" };

/** Writes the fields that differ from `base` (the mode's defaults): csc, csn, csg, csw, css, csf, csa, csv, csr, csx, csm, csu, csl, csh. */
export function writeColourSortParams(settings: ColourSortFields, base: ColourSortFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(COLOUR_SORT_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  if (settings.csRule !== base.csRule) params.set("csu", settings.csRule);
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readColourSortParams(params: URLSearchParams, settings: ColourSortFields) {
  const next: Partial<Record<keyof ColourSortFields, unknown>> = { ...settings };
  for (const [key, field] of Object.entries(COLOUR_SORT_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const rule = params.get("csu");
  if (rule !== null) next.csRule = rule;
  Object.assign(settings, resolveColourSortFields(next));
}
