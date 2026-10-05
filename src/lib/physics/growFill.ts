import { atLeastMin } from "@/lib/uncap";
import { normalizeHexColor } from "@/lib/themes";
import { DEFAULT_GROW_FILL, isGrowLaw, isGrowOnFill, type GrowFillSettings, type GrowLaw, type GrowOnFill } from "./modes/grow";

/*
 * --- loop-foundation --- The settings of Grow's "fill and loop" upgrade (lib/physics/modes/grow.ts runs them): the growth law,
 * what a fill does, the growth per bounce, the start size, the hold and the shrink – physics, so they travel to the engine,
 * the finder and every export – and the look of it: the colour by size along a ramp of colour stops, the contact markers
 * and their lifetime, the pluck pitched by size. Defaults, comfort ranges, URL keys (gLaw, gFill, gStep, gStart, gHold,
 * gShrink, gHue, gRamp, gMark, gMarkT, gPitch) and validation; everything is off by default, so an old link or preset plays
 * the classic Grow.
 */

/** The feature's fields of the SimulatorSettings object. */
export interface GrowFillFields {
  /** approach (the classic) | multiply | add (URL `gLaw`). */
  growLaw: GrowLaw;
  /** stay (the classic) | loop | finish (URL `gFill`). */
  growOnFill: GrowOnFill;
  /** Growth per bounce: percent under multiply, px under add (URL `gStep`). */
  growStep: number;
  /** The new laws' start size, percent of the ring (URL `gStart`). */
  growStart: number;
  /** Seconds the full ball holds, and the shrink back (URL `gHold`, `gShrink`). */
  growHold: number;
  growShrink: number;
  /** Colour by size: the ball's colour follows r / cap along the ramp (URL `gHue`, the stops `gRamp`). */
  growHue: boolean;
  growRamp: string;
  /** Contact markers: a small fading ring where the ball hit, for `growMarkerLife` s (URL `gMark`, `gMarkT`). */
  growMarkers: boolean;
  growMarkerLife: number;
  /** Every bounce a pentatonic pluck pitched by the ball's size, bigger = lower (URL `gPitch`). */
  growPitch: boolean;
}

/** The default ramp: cyan → green → yellow → orange (the colour sweep of a growing ball). */
export const DEFAULT_GROW_RAMP = "#4af0ff,#7af04a,#e8f04a,#f5a54a";
/** A ramp holds 2 to this many colour stops. */
export const MAX_RAMP_STOPS = 6;

export const DEFAULT_GROW_FILL_FIELDS: Readonly<GrowFillFields> = {
  growLaw: DEFAULT_GROW_FILL.law,
  growOnFill: DEFAULT_GROW_FILL.onFill,
  growStep: DEFAULT_GROW_FILL.step,
  growStart: DEFAULT_GROW_FILL.startPct,
  growHold: DEFAULT_GROW_FILL.holdSec,
  growShrink: DEFAULT_GROW_FILL.shrinkSec,
  growHue: false,
  growRamp: DEFAULT_GROW_RAMP,
  growMarkers: false,
  growMarkerLife: 0.3,
  growPitch: DEFAULT_GROW_FILL.pitch,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const GROW_FILL_RANGES = {
  growStep: { min: 0, max: 1000, step: 0.5 },
  growStart: { min: 0.1, max: 100, step: 0.1 },
  growHold: { min: 0, max: 60, step: 0.1 },
  growShrink: { min: 0, max: 60, step: 0.1 },
  growMarkerLife: { min: 0, max: 5, step: 0.05 },
} as const;

/** The feature's numeric fields (each with a comfort range in GROW_FILL_RANGES). */
type NumberKey = keyof typeof GROW_FILL_RANGES;
/** The fields Grow's engine reads (the physics: the growth, the start, the hold and the shrink). */
export const GROW_FILL_ENGINE_KEYS: readonly NumberKey[] = ["growStep", "growStart", "growHold", "growShrink"];

export function defaultGrowFillFields(): GrowFillFields {
  return { ...DEFAULT_GROW_FILL_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum). */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_GROW_FILL_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, GROW_FILL_RANGES[key]) : fallback;
}

/** The colour stops of a ramp ("#4af0ff,#7af04a…"): 2 to MAX_RAMP_STOPS valid colours, else the default ramp's. */
export function parseRamp(value: unknown): string[] {
  const parts = typeof value === "string" ? value.split(/[,;\s]+/) : Array.isArray(value) ? value : [];
  const stops = parts.map((p) => normalizeHexColor(p)).filter((c): c is string => c !== null).slice(0, MAX_RAMP_STOPS);
  return stops.length >= 2 ? stops : DEFAULT_GROW_RAMP.split(",");
}

/** A ramp as stored (comma-separated lowercase hex). */
export function serializeRamp(stops: readonly string[]): string {
  return parseRamp(stops.join(",")).join(",");
}

/** Validates the feature's fields (URL parameters, presets and project files alike). */
export function resolveGrowFillFields(source: Partial<Record<keyof GrowFillFields, unknown>> | null | undefined): GrowFillFields {
  const s = source ?? {};
  const d = DEFAULT_GROW_FILL_FIELDS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    growLaw: isGrowLaw(s.growLaw) ? s.growLaw : d.growLaw,
    growOnFill: isGrowOnFill(s.growOnFill) ? s.growOnFill : d.growOnFill,
    growStep: numberOf("growStep", s.growStep),
    growStart: numberOf("growStart", s.growStart),
    growHold: numberOf("growHold", s.growHold),
    growShrink: numberOf("growShrink", s.growShrink),
    growHue: bool(s.growHue, d.growHue),
    growRamp: serializeRamp(parseRamp(s.growRamp)),
    growMarkers: bool(s.growMarkers, d.growMarkers),
    growMarkerLife: numberOf("growMarkerLife", s.growMarkerLife),
    growPitch: bool(s.growPitch, d.growPitch),
  };
}

/** What Grow's engine runs of the fields (`engine.setGrowFillSettings()`; the page, the finder, the exports). */
export function growFillSettingsOf(s: Pick<GrowFillFields, "growLaw" | "growOnFill" | "growStep" | "growStart" | "growHold" | "growShrink" | "growPitch">): GrowFillSettings {
  return { law: s.growLaw, onFill: s.growOnFill, step: s.growStep, startPct: s.growStart, holdSec: s.growHold, shrinkSec: s.growShrink, pitch: s.growPitch };
}

/**
 * Whether a Grow run with these settings ends by itself (Find Simulation can then search it): "finish" ends the run at the
 * fill, which every law reaches – the classic one geometrically, the new ones while they grow at all (a step above 0).
 */
export function growRunFinishes(settings: Partial<GrowFillSettings> | undefined): boolean {
  const s = { ...DEFAULT_GROW_FILL, ...(settings ?? {}) };
  if (s.onFill !== "finish") return false;
  return s.law === "approach" || (Number.isFinite(s.step) && s.step > 0);
}

/* ------------------------------------------------------------------ the colour ramp */

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour at `t` (0–1) along the ramp's stops, interpolated in RGB between the two stops around it ("rgb(r, g, b)"). */
export function rampColor(stops: readonly string[], t: number): string {
  const list = stops.length >= 2 ? stops : DEFAULT_GROW_RAMP.split(",");
  const x = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const pos = x * (list.length - 1);
  const i = Math.min(list.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexRgb(list[i]);
  const b = hexRgb(list[i + 1]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/* ------------------------------------------------------------------ presets */

export interface GrowFillPreset {
  id: "fillLoop" | "slowBurn" | "instant" | "classic";
  /** Translation key of its name (Controls namespace). */
  labelKey: string;
}

export const GROW_FILL_PRESETS: readonly GrowFillPreset[] = [
  { id: "fillLoop", labelKey: "growPresetFillLoop" },
  { id: "slowBurn", labelKey: "growPresetSlowBurn" },
  { id: "instant", labelKey: "growPresetInstant" },
  { id: "classic", labelKey: "growPresetClassic" },
];

/** The settings a "fill and loop" look sets beside the fields: black page, a thin slate ring, no gravity, no trails or glow, no HUD. */
export const FILL_LOOP_LOOK = {
  backgroundType: "solid",
  backgroundColors: ["#000000", "#000000"],
  themeId: "",
  circleColor: "#3a4a5a",
  rainbowWalls: false,
  wallThickness: 2,
  showTrails: false,
  showGlow: false,
  showWallGlow: false,
  gravity: 0,
  ballSpeed: 560,
  loopHud: false,
} as const;

/** A preset's fields (the look rides along in `look`): Fill and loop (×1.11, start 5 %), Slow burn (4 %), Instant (60 %), Classic. */
export function growFillPresetFields(id: GrowFillPreset["id"]): { fields: GrowFillFields; look: "loop" | "classic" } {
  const loop: GrowFillFields = { ...defaultGrowFillFields(), growLaw: "multiply", growStep: 11, growStart: 5, growOnFill: "loop", growHold: 1.6, growShrink: 1, growHue: true, growMarkers: true, growPitch: true };
  if (id === "slowBurn") return { fields: { ...loop, growStep: 4 }, look: "loop" };
  if (id === "instant") return { fields: { ...loop, growStep: 60 }, look: "loop" };
  if (id === "classic") return { fields: defaultGrowFillFields(), look: "classic" };
  return { fields: loop, look: "loop" };
}

/* ------------------------------------------------------------------ URL */

/** Up to three decimals, trailing zeros dropped (like settings.ts), so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields. */
export const GROW_FILL_URL_KEYS: Readonly<Record<string, NumberKey>> = { gStep: "growStep", gStart: "growStart", gHold: "growHold", gShrink: "growShrink", gMarkT: "growMarkerLife" };
const BOOL_KEYS: Readonly<Record<string, "growHue" | "growMarkers" | "growPitch">> = { gHue: "growHue", gMark: "growMarkers", gPitch: "growPitch" };

/** Writes the fields that differ from `base` (the mode's defaults): gLaw, gFill, gStep, gStart, gHold, gShrink, gHue, gRamp, gMark, gMarkT, gPitch. */
export function writeGrowFillParams(settings: GrowFillFields, base: GrowFillFields, params: URLSearchParams) {
  if (settings.growLaw !== base.growLaw) params.set("gLaw", settings.growLaw);
  if (settings.growOnFill !== base.growOnFill) params.set("gFill", settings.growOnFill);
  for (const [key, field] of Object.entries(GROW_FILL_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  if (settings.growRamp !== base.growRamp) params.set("gRamp", settings.growRamp.replace(/#/g, ""));
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readGrowFillParams(params: URLSearchParams, settings: GrowFillFields) {
  const next: Partial<Record<keyof GrowFillFields, unknown>> = { ...settings };
  const law = params.get("gLaw");
  if (law !== null) next.growLaw = law;
  const fill = params.get("gFill");
  if (fill !== null) next.growOnFill = fill;
  for (const [key, field] of Object.entries(GROW_FILL_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const ramp = params.get("gRamp");
  if (ramp !== null) next.growRamp = ramp.split(/[,;\s]+/).map((c) => (c.startsWith("#") ? c : `#${c}`)).join(",");
  Object.assign(settings, resolveGrowFillFields(next));
}
