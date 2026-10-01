/**
 * --- unlimited --- "No limits": unbounded settings that stay playable (the settings side).
 *
 * The owner's direction: extreme values are a feature – a million bounces, a ball that outgrows the arena, clone storms
 * and absurd gravity are the clips that travel. So with the **Unlimited** switch on (`unlimited`, URL `inf=1`) every
 * numeric setting accepts any finite value from its range's minimum up (the slider ranges in `RANGES` stay the
 * comfortable part of each slider; above their maximum the slider goes logarithmic up to `UNLIMITED_SLIDER_CEILING`
 * and a number input takes any typed value). What the engine does with a huge value is decided on the physics side
 * (lib/physics/limits.ts): it is allowed to melt, never to crash – the simulation slows down, the picture gets cheaper
 * and the run keeps going. Values the engine cannot run in full are run at a soft ceiling (`softCeiling()`), and the
 * panel says so next to the slider.
 *
 * Parsing (URL, share codes, presets, project files) keeps big values unchanged when the switch is on and rejects only
 * invalid ones – NaN, ±Infinity, a value below the setting's minimum (a negative speed, radius, count…) – which fall back
 * to the default. With the switch off everything behaves as before. Fractions, volumes, indices and the recording's own
 * numbers (`BOUNDED_KEYS`) keep their ranges either way: a volume of 1e9 or a gap wider than the ring means nothing.
 *
 * Everything here is pure (no settings.ts import, which would be a cycle): settings.ts passes its `RANGES`, URL keys
 * and serialiser in.
 *
 * --- uncap-all --- The switch no longer gates anything but the slider tracks ("Wide sliders", lib/uncap.ts): every
 * numeric setting is uncapped whether it is on or off – parsing keeps any valid value, links, presets, project files and
 * share codes carry it exactly, and the only ceilings left are the memory-safety ones (`ENGINE_CEILINGS` =
 * `MEMORY_CEILINGS`). `BOUNDED_KEYS` and `SEMANTIC_MAX` are empty: a volume, a fraction or a drag past its slider is the
 * owner's call too.
 */

import { CROWD_BALL_CEILING, INDEX_KEYS, MEMORY_CEILINGS, RING_CEILING, SIGNED_KEYS, formatCompact, formatExact } from "./uncap"; // --- uncap-all ---

/** The URL key of the switch (`inf=1`). */
export const UNLIMITED_URL_KEY = "inf";
/** The URL parameter that carries unlimited values of settings without a URL key of their own (`infx=key:value,…`). */
export const UNLIMITED_EXTRA_PARAM = "infx";
/** Top of the logarithmic part of every unlimited slider (shown as "1B"); the number input goes beyond. */
export const UNLIMITED_SLIDER_CEILING = 1e9;
/** Slider positions: 0 … LINEAR_SPAN is the normal range (linear), LINEAR_SPAN … SLIDER_SPAN the logarithmic extension. */
export const LINEAR_SPAN = 500;
export const SLIDER_SPAN = 1000;

/** The most crowd balls (typed arrays, lib/physics/crowd.ts) a run may hold: ~23 MB of memory, well inside a tab's budget (a memory-safety ceiling). */
export const CROWD_LIMIT = CROWD_BALL_CEILING; // --- uncap-all ---
/** The most full-physics balls (objects with every mode rule) a run keeps; spawns beyond them join the crowd. */
export const OBJECT_BALL_LIMIT = 2_000;
/** The most rings the engine builds: its memory-safety ceiling (--- uncap-all --- was 1,000; 100,000 rings are ~20 MB). */
export const LIVE_WALL_LIMIT = RING_CEILING;

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/**
 * Numeric settings that keep their range with the switch on: fractions and probabilities (0–1 by meaning), volumes (a
 * hearing-safety matter), indices and enumerations stored as numbers, angles, the recording's own numbers (length,
 * frame rate), which size the export's memory, and the size of the overlay text, which has to fit the frame.
 */
export const BOUNDED_KEYS: ReadonlySet<string> = INDEX_KEYS; // --- uncap-all --- only list indices (a slot past the list is invalid): every other numeric setting is uncapped

/** Settings whose meaning ends somewhere even without limits: a drag of 1 stops the ball dead, walls breathing by ±95 % nearly vanish. */
export const SEMANTIC_MAX: Readonly<Record<string, number>> = {}; // --- uncap-all --- none: a drag past 1 or walls breathing past 100 % are allowed to glitch

/** Settings that are signed: they go past both ends of their range (--- uncap-all --- lib/uncap.ts). */
const SYMMETRIC_KEYS: ReadonlySet<string> = SIGNED_KEYS;

/**
 * --- uncap-all --- The ceilings the engine applies: the memory-safety ceilings of lib/uncap.ts only (a count that
 * allocates – rings, crowd balls, a mode's entities). Speeds, sizes, gravity, rotation, thickness and every other value
 * run exactly as typed.
 */
export const ENGINE_CEILINGS: Readonly<Record<string, number>> = MEMORY_CEILINGS;

export function isBoundedKey(key: string): boolean {
  return BOUNDED_KEYS.has(key);
}

/** True when `key` (a numeric setting with `range`) goes past its range with the switch on. */
export function isUnlimitedKey(key: string, range: NumericRange | undefined): range is NumericRange {
  return !!range && Number.isFinite(range.min) && Number.isFinite(range.max) && !BOUNDED_KEYS.has(key);
}

/** The bounds a value of `key` must stay within with the switch on: its range's minimum (−∞ for signed settings) to ∞ (or its semantic end). */
export function unlimitedBounds(key: string, range: NumericRange): { min: number; max: number } {
  const max = SEMANTIC_MAX[key] ?? Infinity;
  return { min: SYMMETRIC_KEYS.has(key) ? -Infinity : range.min, max };
}

/** Whole numbers only: a setting stepping by one (counts, indices, notes, seconds) – --- uncap-all --- a speed stepping by ten keeps its decimals. */
export function isIntegerRange(range: NumericRange): boolean {
  return range.step === 1 && Number.isInteger(range.min);
}

/**
 * A value for `key` with the switch on, or null when it is invalid: not a finite number, below the setting's minimum
 * (a negative count, speed or radius), or – for the few settings with a meaning that ends – above that end. Counts are
 * rounded to whole numbers. No maximum is applied otherwise.
 */
export function parseUnlimitedValue(key: string, raw: unknown, range: NumericRange): number | null {
  if (raw === null || raw === undefined || typeof raw === "boolean") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  const bounds = unlimitedBounds(key, range);
  if (value < bounds.min || value > bounds.max) return null;
  return isIntegerRange(range) ? Math.round(value) : value;
}

/** True when a stored value of `key` is kept unclamped with the switch on: an unlimited setting and a valid value for it (project files). */
export function keepsUnlimitedValue(key: string, value: number, range: { min: number; max: number }): boolean {
  const bounds = { min: range.min, max: range.max, step: 0 };
  return isUnlimitedKey(key, bounds) && parseUnlimitedValue(key, value, bounds) !== null;
}

/** True when a valid unlimited `value` lies outside the normal range of `key` – the part the old parsing would have clamped. */
export function beyondRange(key: string, value: number, range: NumericRange): boolean {
  return value > range.max || (SYMMETRIC_KEYS.has(key) && value < range.min);
}

/**
 * The most the engine builds of `key`: its memory-safety ceiling (--- uncap-all --- every other setting runs as typed:
 * Infinity).
 */
export function softCeiling(key: string, range: NumericRange): number {
  void range;
  return ENGINE_CEILINGS[key] ?? Infinity;
}

/**
 * --- uncap-all --- The widest line the canvas strokes (px): a line wider than this covers any canvas a browser can hold
 * (Chrome's largest is 16,384 px, a diagonal of ~23,000), so drawing it at this width looks exactly the same – and keeps
 * `lineWidth` a finite number (the canvas ignores ±Infinity and would keep the previous width).
 */
export const DRAW_EXTENT_PX = 1e5;

/** What the canvas strokes of a width (`wallThickness`, `trailThickness`): the value itself, drawn no wider than `DRAW_EXTENT_PX` (the same picture). */
export function visualValue(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? DRAW_EXTENT_PX : 0;
  return value > DRAW_EXTENT_PX ? DRAW_EXTENT_PX : value;
}

/* ------------------------------------------------------------------ numbers and the slider */


/** A short label for a big number: 1e9 → "1B", 2_500_000 → "2.5M", 12_345 → "12.3K"; small numbers as they are (--- uncap-all --- lib/uncap.ts). */
export function formatHuge(n: number): string {
  return formatCompact(n);
}

/** Rounds a slider value in the logarithmic part to two significant digits (a readable 3.4M, not 3,417,262). */
function niceNumber(value: number, integer: boolean): number {
  if (value <= 0) return value;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 1);
  const nice = Math.round(value / magnitude) * magnitude;
  return integer ? Math.round(nice) : Number(nice.toPrecision(2));
}

/** The top of the slider of `key`: the slider ceiling, or the semantic end of a setting with one. */
export function sliderCeiling(key: string, range: NumericRange): number {
  const semantic = SEMANTIC_MAX[key];
  return semantic !== undefined ? Math.max(range.max, semantic) : Math.max(range.max * 10, UNLIMITED_SLIDER_CEILING);
}

/** Slider position (0 … SLIDER_SPAN) of `value`: linear across the normal range, logarithmic from its maximum to the ceiling. */
export function sliderPosition(key: string, value: number, range: NumericRange): number {
  if (!Number.isFinite(value)) return value > 0 ? SLIDER_SPAN : 0;
  if (value <= range.max) {
    const span = range.max - range.min;
    return span > 0 ? Math.max(0, (LINEAR_SPAN * (value - range.min)) / span) : 0;
  }
  const top = sliderCeiling(key, range);
  const lo = Math.max(range.max, Number.MIN_VALUE);
  if (SEMANTIC_MAX[key] !== undefined || lo <= 0) {
    return Math.min(SLIDER_SPAN, LINEAR_SPAN + ((SLIDER_SPAN - LINEAR_SPAN) * (value - range.max)) / Math.max(1e-12, top - range.max));
  }
  const t = Math.log(value / lo) / Math.log(top / lo);
  return Math.min(SLIDER_SPAN, LINEAR_SPAN + (SLIDER_SPAN - LINEAR_SPAN) * t);
}

/** The value at slider position `pos` (the inverse of `sliderPosition()`), snapped to the step in the normal range. */
export function sliderValue(key: string, pos: number, range: NumericRange): number {
  const integer = isIntegerRange(range);
  if (pos <= LINEAR_SPAN) {
    const raw = range.min + ((range.max - range.min) * Math.max(0, pos)) / LINEAR_SPAN;
    const snapped = Math.round((raw - range.min) / range.step) * range.step + range.min;
    return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(6))));
  }
  const top = sliderCeiling(key, range);
  const t = Math.min(1, (pos - LINEAR_SPAN) / (SLIDER_SPAN - LINEAR_SPAN));
  if (SEMANTIC_MAX[key] !== undefined || range.max <= 0) {
    const v = range.max + (top - range.max) * t;
    return integer ? Math.round(v) : Number(v.toPrecision(3));
  }
  const v = range.max * Math.pow(top / range.max, t);
  return Math.max(range.max, niceNumber(v, integer));
}

/* ------------------------------------------------------------------ parsing (URL, share codes, presets, project files) */

type Numbers = Record<string, unknown>;
type Ranges = Readonly<Record<string, NumericRange | undefined>>;

/** The unlimited settings of an object: its numeric fields that have a range and are not bounded. */
export function unlimitedKeysOf(defaults: Numbers, ranges: Ranges): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === "number" && isUnlimitedKey(key, ranges[key])) keys.push(key);
  }
  return keys;
}

/**
 * The URL key of every unlimited setting: `explicit` (the core `NUMERIC_URL_KEYS`, inverted, and the ones the feature
 * writers clamp) plus those the settings serialiser reveals when every other unlimited setting is set to a unique probe
 * value (the feature modules' own writers put them under their short keys). Settings without one travel in `infx`.
 */
export function discoverUrlKeys(
  keys: readonly string[],
  explicit: Readonly<Record<string, string>>,
  probeBase: Numbers,
  serialize: (probe: Numbers) => URLSearchParams,
): Map<string, string> {
  const map = new Map<string, string>(Object.entries(explicit).filter(([key]) => keys.includes(key)));
  const probe: Numbers = { ...probeBase };
  const probes = new Map<string, string>();
  let next = 7_000_001;
  for (const key of keys) {
    if (map.has(key)) continue;
    probe[key] = next;
    probes.set(String(next), key);
    next += 2;
  }
  if (probes.size === 0) return map;
  try {
    for (const [param, value] of serialize(probe)) {
      const key = probes.get(value);
      if (key && !map.has(key) && ![...map.values()].includes(param)) map.set(key, param);
    }
  } catch {
    // A writer that cannot take a probe value: those settings travel in `infx`.
  }
  return map;
}

/** A number in a link, exactly (--- uncap-all --- the shortest text `Number()` reads back as the same value: 1e21, 0.1, 1234.5678). */
export function formatUnlimitedNumber(n: number): string {
  return formatExact(n);
}

/**
 * Writes the unlimited values of `settings` (switch on) into `params`: under the setting's own URL key when it has one
 * (replacing a value a feature writer clamped), else in `infx`. Values inside the normal range were written already.
 */
export function writeUnlimitedParams(settings: Numbers, params: URLSearchParams, keys: readonly string[], ranges: Ranges, urlKeys: ReadonlyMap<string, string>) {
  // --- uncap-all --- whatever the switch: every value past its slider travels exactly
  const extra: string[] = [];
  for (const key of keys) {
    const range = ranges[key];
    const value = settings[key];
    if (!range || typeof value !== "number" || !Number.isFinite(value)) continue;
    const param = urlKeys.get(key);
    if (!beyondRange(key, value, range)) {
      // --- uncap-all --- a value the setting's own writer rounded (three decimals) goes back in exactly
      const written = param ? params.get(param) : null;
      if (param && written !== null && Number(written) !== value) params.set(param, formatUnlimitedNumber(value));
      continue;
    }
    if (param) params.set(param, formatUnlimitedNumber(value));
    else extra.push(`${key}:${formatUnlimitedNumber(value)}`);
  }
  if (extra.length > 0) params.set(UNLIMITED_EXTRA_PARAM, extra.join(","));
}

/**
 * Reads the unlimited values of a link into `settings` (after the normal parsing, when the link has `inf=1`): every
 * unlimited setting given in the link takes its value unclamped if it is valid; an invalid one (NaN, ±Infinity, below
 * the minimum) falls back to the default. `infx` carries the settings without a URL key of their own.
 */
export function readUnlimitedParams(params: URLSearchParams, settings: Numbers, defaults: Numbers, keys: readonly string[], ranges: Ranges, urlKeys: ReadonlyMap<string, string>) {
  // --- uncap-all --- whatever the switch (`inf` is only the Wide sliders now): a valid value in the link is taken exactly
  const given = new Map<string, string>();
  for (const key of keys) {
    const param = urlKeys.get(key);
    const raw = param ? params.get(param) : null;
    if (raw !== null) given.set(key, raw);
  }
  const extra = params.get(UNLIMITED_EXTRA_PARAM);
  if (extra) {
    for (const entry of extra.split(",").slice(0, 400)) {
      const at = entry.indexOf(":");
      if (at <= 0) continue;
      const key = entry.slice(0, at);
      if (keys.includes(key) && !given.has(key)) given.set(key, entry.slice(at + 1));
    }
  }
  for (const key of keys) {
    const range = ranges[key];
    if (!range) continue;
    const raw = given.get(key);
    if (raw !== undefined) {
      const value = parseUnlimitedValue(key, raw, range);
      // (--- uncap-all --- a finite number below the minimum was lifted onto it by the setting's own reader, as always;
      // anything else invalid falls back to the default)
      if (value === null) {
        if (!Number.isFinite(Number(raw)) || String(raw).trim() === "") settings[key] = defaults[key];
      } else if (beyondRange(key, value, range)) settings[key] = value; // (inside the range the feature readers keep their own normalisation)
    }
    rejectInvalid(key, settings, defaults, range);
  }
}

/** A value the normal parsing let through although it is invalid (a negative speed from a link): back to the default. */
function rejectInvalid(key: string, settings: Numbers, defaults: Numbers, range: NumericRange) {
  const current = settings[key];
  if (typeof current !== "number") return;
  if (parseUnlimitedValue(key, current, range) === null) settings[key] = defaults[key];
}

/**
 * Restores the unlimited values of a stored preset or project file (`source`, the stored object) into `merged` (its
 * settings after the normal validation clamped them), when the preset has the switch on: valid values beyond the range
 * are kept as stored, invalid ones fall back to the default.
 */
export function restoreUnlimitedValues(source: Numbers, merged: Numbers, defaults: Numbers, keys: readonly string[], ranges: Ranges) {
  merged.unlimited = source.unlimited === true;
  // --- uncap-all --- whatever the switch: stored values are kept exactly, invalid ones fall back to the default
  for (const key of keys) {
    const range = ranges[key];
    if (!range) continue;
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = parseUnlimitedValue(key, source[key], range);
      // (--- uncap-all --- as in readUnlimitedParams(): a finite number below the minimum was lifted onto it by the resolver)
      if (value === null) {
        if (typeof source[key] !== "number" || !Number.isFinite(source[key] as number)) merged[key] = defaults[key];
      } else if (beyondRange(key, value, range)) merged[key] = value; // (inside the range the resolvers keep their own normalisation)
    }
    rejectInvalid(key, merged, defaults, range);
  }
}
