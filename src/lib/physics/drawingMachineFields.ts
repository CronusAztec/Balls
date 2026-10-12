import {
  DEFAULT_DRAWING_MACHINE_SETTINGS,
  DM_RANGES,
  dmTimeline,
  isDmBody,
  isDmInk,
  isDmMachine,
  resolveDrawingMachineSettings,
  type DmBody,
  type DmInk,
  type DmMachine,
  type DmRangeKey,
  type DrawingMachineSettings,
} from "./drawingMachine";

/*
 * --- drawing-machine --- The settings of Drawing Machines (lib/physics/modes/drawingMachine.ts runs them): the machine; the
 * harmonograph's pendulums (frequency, detune, rotary ratio, friction, amplitudes, phases) and its draw and scroll; the orbits'
 * bodies, ratio, radius ratio, chords, years, seconds a year, hold and rewind; the ink, the marks' joins and the sound. Defaults,
 * comfort ranges (`DM_RANGES`), URL keys (dm…), validation, the presets and each machine's page. Nothing here touches the engine.
 */

/** The feature's fields of the SimulatorSettings object. */
export interface DrawingMachineFields {
  /** harmonograph | orbits (URL `dmm`). */
  dmMachine: DmMachine;
  /** Harmonograph: the lateral swing's frequency in Hz (`dmf`), the vertical one's detune in % (`dmdt`), the rotary ratio (`dmrr`). */
  dmFreq: number;
  dmDetune: number;
  dmRotary: number;
  /** Friction: the swings' time constant τ in seconds (`dmtau`). */
  dmDamping: number;
  /** The swings' amplitudes, % of the figure's radius (`dmax`, `dmay`, `dmar`), and phases in degrees (`dmpx`, `dmpy`, `dmpr`). */
  dmAmpX: number;
  dmAmpY: number;
  dmAmpR: number;
  dmPhaseX: number;
  dmPhaseY: number;
  dmPhaseR: number;
  /** Seconds of drawing (`dmds`) and of the paper's scroll (`dmss`). */
  dmDraw: number;
  dmScroll: number;
  /** Orbits: the inner and outer body (`dmbi`, `dmbo`), the ratio p : q (`dmp`, `dmq`), Exact ratio (`dmx`), the radius ratio (`dmrad`). */
  dmInner: DmBody;
  dmOuter: DmBody;
  dmRatioP: number;
  dmRatioQ: number;
  dmExact: boolean;
  dmRadius: number;
  /** A chord every n days (`dmld`); years a cycle (`dmy`), seconds a year (`dmspy`), the hold (`dmh`) and the rewind (`dmrw`). */
  dmLineDays: number;
  dmYears: number;
  dmSecPerYear: number;
  dmHold: number;
  dmRewind: number;
  /** Join the conjunction marks (`dmpg`), the ink ramp (`dmi`) and the machine's sounds (`dms`). */
  dmPentagram: boolean;
  dmInk: DmInk;
  dmSound: boolean;
}

/** The fields' names of the engine's settings (every number of `DM_RANGES`, the names and the switches). */
const FIELD_OF: Readonly<Record<keyof DrawingMachineSettings, keyof DrawingMachineFields>> = {
  machine: "dmMachine",
  freq: "dmFreq",
  detune: "dmDetune",
  rotary: "dmRotary",
  damping: "dmDamping",
  ampX: "dmAmpX",
  ampY: "dmAmpY",
  ampR: "dmAmpR",
  phaseX: "dmPhaseX",
  phaseY: "dmPhaseY",
  phaseR: "dmPhaseR",
  drawSec: "dmDraw",
  scrollSec: "dmScroll",
  inner: "dmInner",
  outer: "dmOuter",
  ratioP: "dmRatioP",
  ratioQ: "dmRatioQ",
  exact: "dmExact",
  radiusRatio: "dmRadius",
  lineDays: "dmLineDays",
  years: "dmYears",
  secPerYear: "dmSecPerYear",
  holdSec: "dmHold",
  rewindSec: "dmRewind",
  pentagram: "dmPentagram",
  ink: "dmInk",
  sound: "dmSound",
};
const SETTING_KEYS = Object.keys(FIELD_OF) as (keyof DrawingMachineSettings)[];

function fieldsOf(s: DrawingMachineSettings): DrawingMachineFields {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) out[FIELD_OF[key]] = s[key];
  return out as unknown as DrawingMachineFields;
}

export const DEFAULT_DRAWING_MACHINE_FIELDS: Readonly<DrawingMachineFields> = fieldsOf(DEFAULT_DRAWING_MACHINE_SETTINGS);

export function defaultDrawingMachineFields(): DrawingMachineFields {
  return { ...DEFAULT_DRAWING_MACHINE_FIELDS };
}

/** What the engine runs of the fields (`engine.setDrawingMachineSettings()`; the page, the finder's engines, the exports). */
export function drawingMachineSettingsOf(f: DrawingMachineFields): DrawingMachineSettings {
  const raw: Partial<Record<keyof DrawingMachineSettings, unknown>> = {};
  for (const key of SETTING_KEYS) raw[key] = f[FIELD_OF[key]];
  return resolveDrawingMachineSettings(raw);
}

/** Validates the feature's fields (URL parameters, presets and project files alike); anything invalid falls back to its default. */
export function resolveDrawingMachineFields(source: Partial<Record<keyof DrawingMachineFields, unknown>> | null | undefined): DrawingMachineFields {
  const s = source ?? {};
  const raw: Partial<Record<keyof DrawingMachineSettings, unknown>> = {};
  for (const key of SETTING_KEYS) raw[key] = s[FIELD_OF[key]];
  return fieldsOf(resolveDrawingMachineSettings(raw));
}

/** The fields the engine reads (every number of the machine: the drawing and its timing). */
export const DM_ENGINE_KEYS: readonly DmRangeKey[] = Object.keys(DM_RANGES) as DmRangeKey[];
/** The fields a change of which restarts the run (the ink, the marks' joins and the sound follow live). */
export const DM_RESTART_FIELDS: readonly (keyof DrawingMachineFields)[] = (Object.values(FIELD_OF) as (keyof DrawingMachineFields)[]).filter((key) => key !== "dmInk" && key !== "dmPentagram" && key !== "dmSound");

/** The clip (whole seconds) one cycle fills. */
export function drawingMachineClipSec(f: DrawingMachineFields): number {
  const cycle = dmTimeline(drawingMachineSettingsOf(f)).cycle;
  return Number.isFinite(cycle) && cycle > 0 ? Math.ceil(cycle - 1e-9) : 30;
}

/* ------------------------------------------------------------------ the look */

export interface DrawingMachineLook {
  backgroundType: "solid";
  backgroundColors: [string, string];
  loopHud: boolean;
}

/** Each machine's page: the harmonograph's dark wood, the orbits' near-black sky; the loop HUD on in both. */
export const DRAWING_MACHINE_LOOKS: Readonly<Record<DmMachine, DrawingMachineLook>> = {
  harmonograph: { backgroundType: "solid", backgroundColors: ["#2a1c15", "#2a1c15"], loopHud: true },
  orbits: { backgroundType: "solid", backgroundColors: ["#05060c", "#05060c"], loopHud: true },
};

/** A machine's look (a fresh copy). */
export function drawingMachineLook(machine: DmMachine): DrawingMachineLook {
  const look = DRAWING_MACHINE_LOOKS[machine];
  return { backgroundType: look.backgroundType, backgroundColors: [look.backgroundColors[0], look.backgroundColors[1]], loopHud: look.loopHud };
}

/** The mode's own defaults beside the feature's fields (in Drawing Machines only): the harmonograph's page and the loop HUD. */
export function drawingMachineModeDefaults(mode: string): Partial<DrawingMachineLook> {
  return mode === "drawingMachine" ? drawingMachineLook(DEFAULT_DRAWING_MACHINE_FIELDS.dmMachine) : {};
}

/** The patch of a machine switch on the panel: the machine, and its page when the page is still the other machine's. */
export function drawingMachineSwitchPatch(current: { backgroundType?: string; backgroundColors?: readonly string[] }, machine: DmMachine): Partial<DrawingMachineFields> & Partial<DrawingMachineLook> {
  const other: DmMachine = machine === "harmonograph" ? "orbits" : "harmonograph";
  const patch: Partial<DrawingMachineFields> & Partial<DrawingMachineLook> = { dmMachine: machine };
  const look = DRAWING_MACHINE_LOOKS[other];
  const colors = current.backgroundColors ?? [];
  if (current.backgroundType === look.backgroundType && colors[0] === look.backgroundColors[0] && colors[1] === look.backgroundColors[1]) {
    const next = drawingMachineLook(machine);
    patch.backgroundType = next.backgroundType;
    patch.backgroundColors = next.backgroundColors;
  }
  return patch;
}

/* ------------------------------------------------------------------ presets */

export const DM_PRESET_IDS = ["threePendulums", "lissajous", "decayRose", "earthVenus", "earthMars", "jupiterSaturn"] as const;
export type DmPresetId = (typeof DM_PRESET_IDS)[number];

/** Translation keys (`DrawingMachine` namespace) of the presets' names. */
export const DM_PRESET_LABELS: Readonly<Record<DmPresetId, string>> = {
  threePendulums: "presetThreePendulums",
  lissajous: "presetLissajous",
  decayRose: "presetDecayRose",
  earthVenus: "presetEarthVenus",
  earthMars: "presetEarthMars",
  jupiterSaturn: "presetJupiterSaturn",
};

export function isDmPresetId(value: unknown): value is DmPresetId {
  return typeof value === "string" && (DM_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * A preset's fields: **Three pendulums, one pen** (the defaults: 1.5 Hz, 2 % apart, a rotary swing at twice the rate, τ 18 s,
 * 22.5 s of drawing and a 1.5 s scroll), **Lissajous 3:2** (no rotary swing: a 2 : 3 figure, 1 % off so it turns, little
 * friction), **Decay rose** (a strong rotary swing at three times the rate and quick friction: a rose winding into the middle),
 * **Earth and Venus** (13 : 8 exact, 8 years, a chord every 8 days, the pentagram), **Earth and Mars** (their real periods –
 * the pattern creeps round – 15 years, the marks joined) and **Jupiter and Saturn** (5 : 2 exact, 59.6 years at a quarter of a
 * second a year: three conjunctions, a triangle).
 */
export function drawingMachinePresetFields(id: DmPresetId): DrawingMachineFields {
  const base = defaultDrawingMachineFields();
  switch (id) {
    case "lissajous":
      return { ...base, dmFreq: 1, dmDetune: 50.5, dmAmpX: 80, dmAmpY: 80, dmAmpR: 0, dmPhaseX: 0, dmPhaseY: 90, dmPhaseR: 0, dmDamping: 60 };
    case "decayRose":
      return { ...base, dmFreq: 1.2, dmDetune: 0.5, dmRotary: 3, dmDamping: 10, dmAmpX: 40, dmAmpY: 40, dmAmpR: 50, dmPhaseX: 0, dmPhaseY: 90, dmPhaseR: 45, dmInk: "ember" };
    case "earthVenus":
      return { ...base, dmMachine: "orbits" };
    case "earthMars":
      return { ...base, dmMachine: "orbits", dmInner: "earth", dmOuter: "mars", dmExact: false, dmRatioP: 15, dmRatioQ: 8, dmRadius: 0.656, dmYears: 15, dmSecPerYear: 1, dmLineDays: 12 };
    case "jupiterSaturn":
      return { ...base, dmMachine: "orbits", dmInner: "jupiter", dmOuter: "saturn", dmExact: true, dmRatioP: 5, dmRatioQ: 2, dmRadius: 0.546, dmYears: 59.6, dmSecPerYear: 0.25, dmLineDays: 60 };
    default:
      return base;
  }
}

/** A preset's whole patch: its fields, its machine's page and a clip of one whole cycle. */
export function drawingMachinePresetPatch(id: DmPresetId, minClipSec = 1): DrawingMachineFields & DrawingMachineLook & { recordingDuration: number } {
  const fields = drawingMachinePresetFields(id);
  return { ...fields, ...drawingMachineLook(fields.dmMachine), recordingDuration: Math.max(minClipSec, drawingMachineClipSec(fields)) };
}

/* ------------------------------------------------------------------ the loop HUD's words */

/** The loop HUD's words of a machine (keys of the `DrawingMachine` namespace): the title, the subtitle and the counter (none for the harmonograph). */
export function drawingMachineHudKeys(machine: DmMachine): { title: string; subtitle: string; counter: string } {
  return machine === "orbits"
    ? { title: "DrawingMachine.canvasTitleOrbits", subtitle: "DrawingMachine.canvasSubtitleOrbits", counter: "DrawingMachine.canvasYear" }
    : { title: "DrawingMachine.canvasTitleHarmonograph", subtitle: "DrawingMachine.canvasSubtitleHarmonograph", counter: "" };
}

/** A whole number as it is, any other number with at most `digits` decimals (trailing zeros dropped): the HUD's and the panel's words. */
export function dmShort(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "–";
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

type NumberField = DmRangeKey;
type BoolField = "dmExact" | "dmPentagram" | "dmSound";

/** The short URL keys of the numeric fields (dm…: no other feature's key starts so). */
export const DM_URL_KEYS: Readonly<Record<string, NumberField>> = {
  dmf: "dmFreq",
  dmdt: "dmDetune",
  dmrr: "dmRotary",
  dmtau: "dmDamping",
  dmax: "dmAmpX",
  dmay: "dmAmpY",
  dmar: "dmAmpR",
  dmpx: "dmPhaseX",
  dmpy: "dmPhaseY",
  dmpr: "dmPhaseR",
  dmds: "dmDraw",
  dmss: "dmScroll",
  dmp: "dmRatioP",
  dmq: "dmRatioQ",
  dmrad: "dmRadius",
  dmld: "dmLineDays",
  dmy: "dmYears",
  dmspy: "dmSecPerYear",
  dmh: "dmHold",
  dmrw: "dmRewind",
};
const BOOL_KEYS: Readonly<Record<string, BoolField>> = { dmx: "dmExact", dmpg: "dmPentagram", dms: "dmSound" };

/** Writes the fields that differ from `base` (the mode's defaults): dmm, dmf … dmrw, dmbi, dmbo, dmx, dmpg, dmi, dms. */
export function writeDrawingMachineParams(settings: DrawingMachineFields, base: DrawingMachineFields, params: URLSearchParams) {
  if (settings.dmMachine !== base.dmMachine) params.set("dmm", settings.dmMachine);
  for (const [key, field] of Object.entries(DM_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.dmInner !== base.dmInner) params.set("dmbi", settings.dmInner);
  if (settings.dmOuter !== base.dmOuter) params.set("dmbo", settings.dmOuter);
  if (settings.dmInk !== base.dmInk) params.set("dmi", settings.dmInk);
  for (const [key, field] of Object.entries(BOOL_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back. */
export function readDrawingMachineParams(params: URLSearchParams, settings: DrawingMachineFields) {
  const next: Partial<Record<keyof DrawingMachineFields, unknown>> = { ...settings };
  const machine = params.get("dmm");
  if (machine !== null) next.dmMachine = isDmMachine(machine) ? machine : settings.dmMachine;
  for (const [key, field] of Object.entries(DM_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const inner = params.get("dmbi");
  if (inner !== null) next.dmInner = isDmBody(inner) ? inner : settings.dmInner;
  const outer = params.get("dmbo");
  if (outer !== null) next.dmOuter = isDmBody(outer) ? outer : settings.dmOuter;
  const ink = params.get("dmi");
  if (ink !== null) next.dmInk = isDmInk(ink) ? ink : settings.dmInk;
  for (const [key, field] of Object.entries(BOOL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  Object.assign(settings, resolveDrawingMachineFields(next));
}
