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
 */

/** The URL key of the switch (`inf=1`). */
export const UNLIMITED_URL_KEY = "inf";
/** The URL parameter that carries unlimited values of settings without a URL key of their own (`infx=key:value,…`). */
export const UNLIMITED_EXTRA_PARAM = "infx";
/** Top of the logarithmic part of every unlimited slider (shown as "1B"); the number input goes beyond. */
export const UNLIMITED_SLIDER_CEILING = 1e9;
/** Slider positions: 0 … LINEAR_SPAN is the normal range (linear), LINEAR_SPAN … SLIDER_SPAN the logarithmic extension. */
export const LINEAR_SPAN = 500;
export const SLIDER_SPAN = 1000;

/** The most crowd balls (typed arrays, lib/physics/crowd.ts) a run may hold: ~23 MB of memory, well inside a tab's budget. */
export const CROWD_LIMIT = 1_000_000;
/** The most full-physics balls (objects with every mode rule) a run keeps; spawns beyond them join the crowd. */
export const OBJECT_BALL_LIMIT = 2_000;
/** The most rings the engine builds (a thousand rings are already a solid disc on a phone screen). */
export const LIVE_WALL_LIMIT = 1_000;

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
export const BOUNDED_KEYS: ReadonlySet<string> = new Set([
  "gapSize",
  "recordingDuration",
  "findDuration",
  "hitSampleVolume",
  "sliceMs",
  "sliceFadeMs",
  "musicVolume",
  "musicDucking",
  "musicDuckRelease",
  "musicStartOffset",
  "rootNote",
  "bpm",
  "colorMatchColorCount",
  "dropSizeVariation",
  "dropGravityVariation",
  "boxAspect",
  "pwAmplitude",
  "pwPolygon",
  "pwTrails",
  "paintGhost",
  "paintBeatPulse",
  "ballSquash",
  "backgroundDim",
  "cpSizeSpread",
  "cameraZoom",
  "screenShake",
  "slowMoFactor",
  "slowMoMs",
  "forcedWinner",
  "dpSegments",
  "dpLength1",
  "dpLength2",
  "dpLength3",
  "dpAngle1",
  "dpAngle2",
  "dpAngle3",
  "dpDamping",
  "dpOctaves",
  "ilDepth",
  "wallWobble",
  "sbWobble",
  "plDrift",
  "fastExportFps",
  "rcWinner",
  "arenaNudge",
  "runnerDensity",
  "pdSkill",
  "pdWidth",
  "pdSpin",
  "arenaCount",
  "vxDepthScale",
  "byChaos",
  "bdDrift",
  "bdBounceHeight",
  "bdAnticipation",
  "beatDownbeat",
  "onBeatRange",
  "videoBgOpacity",
  "textSize",
  // --- odd-maze --- the Maze's trail and fog opacities (0–1 by meaning)
  "mzTrail",
  "mzFog",
]);

/** Settings whose meaning ends somewhere even without limits: a drag of 1 stops the ball dead, walls breathing by ±95 % nearly vanish. */
export const SEMANTIC_MAX: Readonly<Record<string, number>> = { airDrag: 1, breathingAmplitude: 0.95 };

/** Settings that are signed: with the switch on they go past both ends of their range. */
const SYMMETRIC_KEYS: ReadonlySet<string> = new Set(["windX", "windY"]);

/**
 * The settings the engine runs unbounded (up to a float-safety or memory ceiling given here). Every other unlimited
 * setting is kept in the link, the presets and the panel as typed, and its mode runs it at its own slider maximum.
 */
export const ENGINE_CEILINGS: Readonly<Record<string, number>> = {
  ballSpeed: 1e12,
  ballRadius: 1e9,
  gravity: 1e12,
  rotationSpeed: 1e9,
  wallCount: LIVE_WALL_LIMIT,
  wallThickness: 400,
  trailThickness: 40,
  accumulationTime: 1e9,
  spikeCount: 360,
  multiplySpawnCount: CROWD_LIMIT,
  targetCount: 100,
  growRate: 1e9,
  windX: 1e9,
  windY: 1e9,
  spinStrength: 1e6,
  wallBounciness: 1e9,
  breathingSpeed: 1e6,
  rotatingGravity: 1e9,
  airDrag: 1,
  breathingAmplitude: 0.95,
  splitMinRadius: 1e9,
  maxBalls: OBJECT_BALL_LIMIT,
  ballCount: CROWD_LIMIT,
};

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

function isIntegerRange(range: NumericRange): boolean {
  return Number.isInteger(range.step) && range.step >= 1 && Number.isInteger(range.min);
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

/** The most the engine runs of `key`: its engine ceiling, or its slider maximum for a setting only its mode reads. */
export function softCeiling(key: string, range: NumericRange): number {
  return ENGINE_CEILINGS[key] ?? range.max;
}

/** What the canvas draws of a visual setting (`wallThickness`, `trailThickness`): its engine ceiling with the switch on. */
export function visualValue(unlimited: boolean, key: string, value: number): number {
  const ceiling = ENGINE_CEILINGS[key];
  return unlimited && ceiling !== undefined && !(value <= ceiling) ? ceiling : value;
}

/** A value brought back into `range` (the switch was turned off). */
export function clampToRange(value: number, range: NumericRange): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.max(range.min, Math.min(range.max, value));
}

/* ------------------------------------------------------------------ numbers and the slider */

const SUFFIXES: readonly [number, string][] = [
  [1e15, "Q"],
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** A short label for a big number: 1e9 → "1B", 2_500_000 → "2.5M", 12_345 → "12.3K"; small numbers as they are. */
export function formatHuge(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "NaN";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e18) return `${sign}${a.toExponential(1).replace("e+", "e")}`;
  for (const [unit, suffix] of SUFFIXES) {
    if (a >= unit) {
      const v = a / unit;
      const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
      return `${sign}${Number(v.toFixed(digits))}${suffix}`;
    }
  }
  if (a >= 100 || Number.isInteger(a)) return `${sign}${Math.round(a)}`;
  return `${sign}${Number(a.toPrecision(3))}`;
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

/** A number in a link: plain digits up to 1e21, exponent notation beyond (both read back exactly by `Number()`). */
export function formatUnlimitedNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const fixed = n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return Number(fixed) === 0 && n !== 0 ? String(n) : fixed;
}

/**
 * Writes the unlimited values of `settings` (switch on) into `params`: under the setting's own URL key when it has one
 * (replacing a value a feature writer clamped), else in `infx`. Values inside the normal range were written already.
 */
export function writeUnlimitedParams(settings: Numbers, params: URLSearchParams, keys: readonly string[], ranges: Ranges, urlKeys: ReadonlyMap<string, string>) {
  if (settings.unlimited !== true) return;
  const extra: string[] = [];
  for (const key of keys) {
    const range = ranges[key];
    const value = settings[key];
    if (!range || typeof value !== "number" || !Number.isFinite(value) || !beyondRange(key, value, range)) continue;
    const param = urlKeys.get(key);
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
  if (settings.unlimited !== true) return;
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
      if (value === null) settings[key] = defaults[key];
      else if (beyondRange(key, value, range)) settings[key] = value;
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
  if (!merged.unlimited) return;
  for (const key of keys) {
    const range = ranges[key];
    if (!range) continue;
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = parseUnlimitedValue(key, source[key], range);
      if (value === null) merged[key] = defaults[key];
      else if (beyondRange(key, value, range)) merged[key] = value;
    }
    rejectInvalid(key, merged, defaults, range);
  }
}

/** The settings patch that brings every out-of-range unlimited value back into its range (the switch is turned off). */
export function clampUnlimitedPatch(settings: Numbers, keys: readonly string[], ranges: Ranges): Numbers {
  const patch: Numbers = {};
  for (const key of keys) {
    const range = ranges[key];
    const value = settings[key];
    if (!range || typeof value !== "number") continue;
    if (value > range.max || value < range.min || !Number.isFinite(value)) patch[key] = clampToRange(value, range);
  }
  return patch;
}
