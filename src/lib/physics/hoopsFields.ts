import { DEFAULT_HOOPS_SETTINGS, hoopsSchedule, isHoopsRampShape, resolveHoopsSettings, type HoopsRampShape, type HoopsSettings } from "./modes/hoops";

/*
 * --- bead-hoops --- The settings of Spinning Hoops (lib/physics/modes/hoops.ts runs them): the hoops (count, outer and inner
 * radius), gravity, the spin (start and top speed, the ramp's length and shape, the top hold, the return and its length), the
 * beads (damping, the axis' tilt) – physics, so they travel to the engine, the finder and every export – and the two sound
 * switches (the spin's chime, the groove bed). Defaults, comfort ranges, URL keys (hpn, hprx, hprn, hpg, hpw0, hpw1, hpr, hps,
 * hph, hprt, hprs, hpd, hpj, hpt, hpb), validation and the presets (8 rainbow hoops, One hoop, slow, Twin hoops).
 */

/** The feature's fields of the SimulatorSettings object. */
export interface HoopsFields {
  /** Hoops, one bead each (URL `hpn`). */
  hpCount: number;
  /** The outer and the inner hoop's radius, shares of the half side (URL `hprx`, `hprn`). */
  hpRadiusMax: number;
  hpRadiusMin: number;
  /** Gravity in m/s² – the half side is one metre (URL `hpg`). */
  hpGravity: number;
  /** The spin at the start and at the top, turns a second (URL `hpw0`, `hpw1`). */
  hpOmegaStart: number;
  hpOmegaEnd: number;
  /** Seconds of the ramp up (URL `hpr`) and its shape: linear | ease | steps (URL `hps`). */
  hpRamp: number;
  hpRampShape: HoopsRampShape;
  /** Seconds at the top speed before the return or the end (URL `hph`). */
  hpHold: number;
  /** Ramp back down and loop (URL `hprt`), the return ramp's seconds (URL `hprs`). */
  hpReturn: boolean;
  hpReturnSec: number;
  /** The beads' damping, 1/s (URL `hpd`). */
  hpDamping: number;
  /** The spin axis' tilt in radians: the bottom is no fixed point, the beads climb to a seeded side (URL `hpj`). */
  hpJitter: number;
  /** A glock chime every turn (URL `hpt`); the groove bed from the first lift to the reset (URL `hpb`). */
  hpTick: boolean;
  hpBed: boolean;
}

export const DEFAULT_HOOPS_FIELDS: Readonly<HoopsFields> = {
  hpCount: DEFAULT_HOOPS_SETTINGS.count,
  hpRadiusMax: DEFAULT_HOOPS_SETTINGS.radiusMax,
  hpRadiusMin: DEFAULT_HOOPS_SETTINGS.radiusMin,
  hpGravity: DEFAULT_HOOPS_SETTINGS.gravity,
  hpOmegaStart: DEFAULT_HOOPS_SETTINGS.omegaStart,
  hpOmegaEnd: DEFAULT_HOOPS_SETTINGS.omegaEnd,
  hpRamp: DEFAULT_HOOPS_SETTINGS.rampSec,
  hpRampShape: DEFAULT_HOOPS_SETTINGS.rampShape,
  hpHold: DEFAULT_HOOPS_SETTINGS.holdSec,
  hpReturn: DEFAULT_HOOPS_SETTINGS.returnLoop,
  hpReturnSec: DEFAULT_HOOPS_SETTINGS.returnSec,
  hpDamping: DEFAULT_HOOPS_SETTINGS.damping,
  hpJitter: DEFAULT_HOOPS_SETTINGS.jitter,
  hpTick: DEFAULT_HOOPS_SETTINGS.tick,
  hpBed: DEFAULT_HOOPS_SETTINGS.bed,
};

export function defaultHoopsFields(): HoopsFields {
  return { ...DEFAULT_HOOPS_FIELDS };
}

/** What the engine runs of the fields (`engine.setHoopsSettings()`; the page, the finder, the exports). */
export function hoopsSettingsOf(s: HoopsFields): HoopsSettings {
  return resolveHoopsSettings({
    count: s.hpCount,
    radiusMax: s.hpRadiusMax,
    radiusMin: s.hpRadiusMin,
    gravity: s.hpGravity,
    omegaStart: s.hpOmegaStart,
    omegaEnd: s.hpOmegaEnd,
    rampSec: s.hpRamp,
    rampShape: s.hpRampShape,
    holdSec: s.hpHold,
    returnLoop: s.hpReturn,
    returnSec: s.hpReturnSec,
    damping: s.hpDamping,
    jitter: s.hpJitter,
    tick: s.hpTick,
    bed: s.hpBed,
  });
}

/** The clip (whole seconds) a run fills: one whole cycle – the climb, the hold, the return and the reset; without the return, the run. */
export function hoopsClipSec(s: HoopsFields): number {
  const cycle = hoopsSchedule(hoopsSettingsOf(s)).cycle;
  return Number.isFinite(cycle) && cycle > 0 ? Math.ceil(cycle - 1e-9) : 30;
}

/** Resolved settings back in the fields' names. */
function fieldsOf(settings: HoopsSettings): HoopsFields {
  return {
    hpCount: settings.count,
    hpRadiusMax: settings.radiusMax,
    hpRadiusMin: settings.radiusMin,
    hpGravity: settings.gravity,
    hpOmegaStart: settings.omegaStart,
    hpOmegaEnd: settings.omegaEnd,
    hpRamp: settings.rampSec,
    hpRampShape: settings.rampShape,
    hpHold: settings.holdSec,
    hpReturn: settings.returnLoop,
    hpReturnSec: settings.returnSec,
    hpDamping: settings.damping,
    hpJitter: settings.jitter,
    hpTick: settings.tick,
    hpBed: settings.bed,
  };
}

/** Validates the feature's fields (URL parameters, presets and project files alike): numbers from their minimum up, a known shape, real booleans. */
export function resolveHoopsFields(source: Partial<Record<keyof HoopsFields, unknown>> | null | undefined): HoopsFields {
  const s = source ?? {};
  const d = DEFAULT_HOOPS_FIELDS;
  return fieldsOf(
    resolveHoopsSettings({
      count: s.hpCount ?? d.hpCount,
      radiusMax: s.hpRadiusMax ?? d.hpRadiusMax,
      radiusMin: s.hpRadiusMin ?? d.hpRadiusMin,
      gravity: s.hpGravity ?? d.hpGravity,
      omegaStart: s.hpOmegaStart ?? d.hpOmegaStart,
      omegaEnd: s.hpOmegaEnd ?? d.hpOmegaEnd,
      rampSec: s.hpRamp ?? d.hpRamp,
      rampShape: s.hpRampShape ?? d.hpRampShape,
      holdSec: s.hpHold ?? d.hpHold,
      returnLoop: s.hpReturn ?? d.hpReturn,
      returnSec: s.hpReturnSec ?? d.hpReturnSec,
      damping: s.hpDamping ?? d.hpDamping,
      jitter: s.hpJitter ?? d.hpJitter,
      tick: s.hpTick ?? d.hpTick,
      bed: s.hpBed ?? d.hpBed,
    }),
  );
}

/* ------------------------------------------------------------------ presets */

export interface HoopsPreset {
  id: "rainbow8" | "oneSlow" | "twin";
  /** Translation key of its name (Controls namespace). */
  labelKey: string;
}

export const HOOPS_PRESETS: readonly HoopsPreset[] = [
  { id: "rainbow8", labelKey: "hpPresetRainbow8" },
  { id: "oneSlow", labelKey: "hpPresetOneSlow" },
  { id: "twin", labelKey: "hpPresetTwin" },
];

/** The look every preset puts on the page with its fields: the clip's dark navy page and the loop HUD (title, subtitle, counter). */
export const HOOPS_LOOK = {
  backgroundType: "solid",
  backgroundColors: ["#0b1020", "#0b1020"],
  themeId: "",
  rainbowWalls: true,
  showWallGlow: true,
  loopHud: true,
} as const;

/**
 * A preset's fields: **8 rainbow hoops** (the defaults: eight hoops from 0.75 to 0.25 of the half side – the rig leaves the
 * loop HUD its margins –, 0.13 → 1.2 turns a second over 12 s, a 6 s return), **One hoop, slow** (one hoop at 0.75, an eased
 * 20 s ramp to 0.9 turns a second) and **Twin hoops** (two hoops at 0.75 and 0.4, the spin in two steps: one bead a step).
 */
export function hoopsPresetFields(id: HoopsPreset["id"]): HoopsFields {
  const base = defaultHoopsFields();
  if (id === "oneSlow") return { ...base, hpCount: 1, hpRadiusMax: 0.75, hpRadiusMin: 0.75, hpRamp: 20, hpRampShape: "ease", hpOmegaEnd: 0.9, hpDamping: 0.8 };
  if (id === "twin") return { ...base, hpCount: 2, hpRadiusMax: 0.75, hpRadiusMin: 0.4, hpRampShape: "steps" };
  return base;
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals (the tilt steps by 0.0005), trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

type NumberField = "hpCount" | "hpRadiusMax" | "hpRadiusMin" | "hpGravity" | "hpOmegaStart" | "hpOmegaEnd" | "hpRamp" | "hpHold" | "hpReturnSec" | "hpDamping" | "hpJitter";
type BoolField = "hpReturn" | "hpTick" | "hpBed";

/** The short URL keys of the numeric fields. */
export const HOOPS_URL_KEYS: Readonly<Record<string, NumberField>> = {
  hpn: "hpCount",
  hprx: "hpRadiusMax",
  hprn: "hpRadiusMin",
  hpg: "hpGravity",
  hpw0: "hpOmegaStart",
  hpw1: "hpOmegaEnd",
  hpr: "hpRamp",
  hph: "hpHold",
  hprs: "hpReturnSec",
  hpd: "hpDamping",
  hpj: "hpJitter",
};
const BOOL_KEYS: Readonly<Record<string, BoolField>> = { hprt: "hpReturn", hpt: "hpTick", hpb: "hpBed" };

/** Writes the fields that differ from `base` (the mode's defaults): hpn, hprx, hprn, hpg, hpw0, hpw1, hpr, hps, hph, hprt, hprs, hpd, hpj, hpt, hpb. */
export function writeHoopsParams(settings: HoopsFields, base: HoopsFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(HOOPS_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.hpRampShape !== base.hpRampShape) params.set("hps", settings.hpRampShape);
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readHoopsParams(params: URLSearchParams, settings: HoopsFields) {
  const next: Partial<Record<keyof HoopsFields, unknown>> = { ...settings };
  for (const [key, field] of Object.entries(HOOPS_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const shape = params.get("hps");
  if (shape !== null) next.hpRampShape = isHoopsRampShape(shape) ? shape : settings.hpRampShape;
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveHoopsFields(next));
}
