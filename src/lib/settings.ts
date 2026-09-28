import type { ModeId, WallBreakStyle } from "@/lib/physics/types";
import { isInstrumentId, type InstrumentId } from "@/lib/audio/instruments";
import { BPM_MAX, BPM_MIN, ROOT_NOTE_MAX, ROOT_NOTE_MIN, isQuantizeGrid, isScaleId, type QuantizeGrid, type ScaleId } from "@/lib/audio/scales";
import { normalizeWallBreakSound } from "@/lib/audio/songs";
import { isModeId, WALL_BREAK_STYLES } from "@/lib/physics/types";
import { SITE_DOMAIN } from "@/lib/site";

/**
 * Every user-facing simulator setting lives in this one object. The controls panel,
 * URL sharing, presets and the seed finder all read from it, so adding a setting means:
 *  1. add a field here (+ default in `defaultSettings`),
 *  2. optionally add a short URL key in URL_KEYS so it is shareable,
 *  3. render a control for it in components/simulator/Controls.tsx,
 *  4. apply it to the engine in components/simulator/Simulator.tsx.
 */
export type RainbowWallMode = "pulse" | "gradient";

export interface SimulatorSettings {
  mode: ModeId;
  // Ball & physics
  gravity: number;
  bounce: number;
  ballSpeed: number;
  ballColor: string;
  ballRadius: number;
  rainbowBall: boolean;
  twoBalls: boolean;
  ballColor2: string;
  bouncierEnabled: boolean;
  // Walls
  wallCount: number;
  wallThickness: number;
  gapSize: number;
  rotationEnabled: boolean;
  rotationSpeed: number;
  circleColor: string;
  rainbowWalls: boolean;
  rainbowWallMode: RainbowWallMode;
  // Visual effects
  showTrails: boolean;
  trailThickness: number;
  showGlow: boolean;
  showWallGlow: boolean;
  colorTrail: boolean;
  reactiveBackground: boolean;
  cameraFollow: boolean;
  wallBreakStyle: WallBreakStyle;
  cinematicEnabled: boolean;
  // Mode specific
  accumulationTime: number;
  spikesEnabled: boolean;
  spikeCount: number;
  multiplySpawnCount: number;
  lineColor: string;
  rainbowLines: boolean;
  linesCenterDot: boolean;
  targetCount: number;
  countdownRandom: boolean;
  colorMatchColorCount: number;
  growRate: number;
  growCenterDot: boolean;
  growLines: boolean;
  // Overlays & recording
  watermarkText: string;
  topText: string;
  bottomText: string;
  textSize: number;
  recordingResolution: string;
  recordingDuration: number;
  wallBreakSound: string | null;
  // Music: instrument voice, scale snapping and beat lock (see lib/audio/instruments.ts, scales.ts)
  instrument: InstrumentId;
  scale: ScaleId;
  /** Root of the scale as semitones above C (0 = C … 11 = B). */
  rootNote: number;
  quantizeToBeat: boolean;
  bpm: number;
  quantizeGrid: QuantizeGrid;
}

export const RESOLUTIONS = ["500x500", "1280x720", "1920x1080", "1080x1920"] as const;

export function defaultGapSize(mode: ModeId) {
  return mode === "classic" ? 0.4 : 0.3;
}

export function defaultSettings(mode: ModeId = "classic"): SimulatorSettings {
  return {
    mode,
    gravity: 300,
    bounce: 1,
    ballSpeed: 400,
    ballColor: "#FFFFFF",
    ballRadius: 8,
    rainbowBall: false,
    twoBalls: false,
    ballColor2: "#FF3366",
    bouncierEnabled: false,
    wallCount: mode === "shatter" ? 10 : 7,
    wallThickness: 2,
    gapSize: defaultGapSize(mode),
    rotationEnabled: true,
    rotationSpeed: 1,
    circleColor: "#06b6d4",
    rainbowWalls: true,
    rainbowWallMode: "gradient",
    showTrails: mode !== "lines",
    trailThickness: 0.8,
    showGlow: false,
    showWallGlow: !["portal", "shatter", "colorMatch"].includes(mode),
    colorTrail: true,
    reactiveBackground: false,
    cameraFollow: false,
    wallBreakStyle: "confetti",
    cinematicEnabled: true,
    accumulationTime: 4,
    spikesEnabled: false,
    spikeCount: 6,
    multiplySpawnCount: 3,
    lineColor: "#ffffff",
    rainbowLines: false,
    linesCenterDot: false,
    targetCount: 10,
    countdownRandom: false,
    colorMatchColorCount: 7,
    growRate: 5,
    growCenterDot: false,
    growLines: false,
    watermarkText: SITE_DOMAIN,
    topText: "",
    bottomText: "",
    textSize: 1,
    recordingResolution: "1080x1920",
    recordingDuration: 30,
    wallBreakSound: null,
    instrument: "triangle",
    scale: "chromatic",
    rootNote: 0,
    quantizeToBeat: false,
    bpm: 120,
    quantizeGrid: "1/8",
  };
}

/** Slider ranges shared by the controls panel and URL validation. */
export const RANGES = {
  ballSpeed: { min: 50, max: 800, step: 10 },
  ballRadius: { min: 4, max: 30, step: 1 },
  gravity: { min: 0, max: 2000, step: 50 },
  wallCount: { min: 1, max: 20, step: 1 },
  wallThickness: { min: 1, max: 10, step: 1 },
  gapSize: { min: 0.1, max: 1.0, step: 0.05 },
  rotationSpeed: { min: 0.1, max: 5, step: 0.1 },
  trailThickness: { min: 0.2, max: 3.0, step: 0.1 },
  recordingDuration: { min: 10, max: 120, step: 1 },
  textSize: { min: 0.5, max: 3, step: 0.1 },
  accumulationTime: { min: 1, max: 15, step: 1 },
  spikeCount: { min: 1, max: 20, step: 1 },
  multiplySpawnCount: { min: 2, max: 10, step: 1 },
  targetCount: { min: 5, max: 25, step: 1 },
  colorMatchColorCount: { min: 2, max: 7, step: 1 },
  growRate: { min: 3, max: 10, step: 1 },
  findDuration: { min: 30, max: 120, step: 1 },
  rootNote: { min: ROOT_NOTE_MIN, max: ROOT_NOTE_MAX, step: 1 },
  bpm: { min: BPM_MIN, max: BPM_MAX, step: 1 },
} as const;

/* ------------------------------------------------------------------ URL sharing */

type NumericKey = {
  [K in keyof SimulatorSettings]: SimulatorSettings[K] extends number ? K : never;
}[keyof SimulatorSettings];
type BooleanKey = {
  [K in keyof SimulatorSettings]: SimulatorSettings[K] extends boolean ? K : never;
}[keyof SimulatorSettings];
type StringKey = {
  [K in keyof SimulatorSettings]: SimulatorSettings[K] extends string ? K : never;
}[keyof SimulatorSettings];

const NUMERIC_URL_KEYS: Record<string, NumericKey> = {
  g: "gravity",
  s: "ballSpeed",
  r: "ballRadius",
  wc: "wallCount",
  wt: "wallThickness",
  gap: "gapSize",
  tt: "trailThickness",
  tc: "targetCount",
  cmc: "colorMatchColorCount",
  gr: "growRate",
  rs: "rotationSpeed",
  at: "accumulationTime",
  sc: "spikeCount",
  msc: "multiplySpawnCount",
  ts: "textSize",
  root: "rootNote",
  bpm: "bpm",
};

/** Boolean keys: `1` enables, `0` disables. */
const BOOLEAN_URL_KEYS: Record<string, BooleanKey> = {
  trails: "showTrails",
  glow: "showGlow",
  wglow: "showWallGlow",
  rwalls: "rainbowWalls",
  rball: "rainbowBall",
  rlines: "rainbowLines",
  bounce: "bouncierEnabled",
  random: "countdownRandom",
  bg: "reactiveBackground",
  ctrail: "colorTrail",
  two: "twoBalls",
  rot: "rotationEnabled",
  spikes: "spikesEnabled",
  cam: "cameraFollow",
  gdot: "growCenterDot",
  glines: "growLines",
  ldot: "linesCenterDot",
  cine: "cinematicEnabled",
  qz: "quantizeToBeat",
};

const STRING_URL_KEYS: Record<string, StringKey> = {
  cc: "circleColor",
  bc: "ballColor",
  bc2: "ballColor2",
  lc: "lineColor",
  top: "topText",
  bottom: "bottomText",
  wm: "watermarkText",
};

/** Serialises only the settings that differ from the defaults for the current mode. */
export function settingsToSearchParams(settings: SimulatorSettings): URLSearchParams {
  const params = new URLSearchParams();
  const base = defaultSettings(settings.mode);
  params.set("mode", settings.mode);
  for (const [key, field] of Object.entries(NUMERIC_URL_KEYS)) {
    if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  }
  for (const [key, field] of Object.entries(BOOLEAN_URL_KEYS)) {
    if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  }
  for (const [key, field] of Object.entries(STRING_URL_KEYS)) {
    if (settings[field] !== base[field]) params.set(key, settings[field]);
  }
  if (settings.rainbowWallMode !== base.rainbowWallMode) params.set("rwmode", settings.rainbowWallMode);
  if (settings.wallBreakStyle !== base.wallBreakStyle) params.set("wbreak", settings.wallBreakStyle);
  if (settings.recordingResolution !== base.recordingResolution) params.set("res", settings.recordingResolution);
  if (settings.recordingDuration !== base.recordingDuration) params.set("dur", String(settings.recordingDuration));
  if (settings.instrument !== base.instrument) params.set("inst", settings.instrument);
  if (settings.scale !== base.scale) params.set("scale", settings.scale);
  if (settings.quantizeGrid !== base.quantizeGrid) params.set("grid", settings.quantizeGrid);
  return params;
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Reads settings from a URL; unknown or invalid values fall back to the defaults. */
export function settingsFromSearchParams(params: URLSearchParams): SimulatorSettings {
  const modeParam = params.get("mode");
  const mode: ModeId = isModeId(modeParam) ? modeParam : "classic";
  const settings = defaultSettings(mode);
  for (const [key, field] of Object.entries(NUMERIC_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) (settings as unknown as Record<string, number>)[field] = value;
  }
  for (const [key, field] of Object.entries(BOOLEAN_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") (settings as unknown as Record<string, boolean>)[field] = true;
    else if (raw === "0") (settings as unknown as Record<string, boolean>)[field] = false;
  }
  for (const [key, field] of Object.entries(STRING_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) (settings as unknown as Record<string, string>)[field] = raw.slice(0, 60);
  }
  const rw = params.get("rwmode");
  if (rw === "pulse" || rw === "gradient") settings.rainbowWallMode = rw;
  const wb = params.get("wbreak");
  if (wb && (WALL_BREAK_STYLES as readonly string[]).includes(wb)) settings.wallBreakStyle = wb as WallBreakStyle;
  const res = params.get("res");
  if (res && (RESOLUTIONS as readonly string[]).includes(res)) settings.recordingResolution = res;
  const dur = Number(params.get("dur"));
  if (Number.isFinite(dur) && dur >= RANGES.recordingDuration.min && dur <= RANGES.recordingDuration.max) settings.recordingDuration = dur;
  const inst = params.get("inst");
  if (isInstrumentId(inst)) settings.instrument = inst;
  const scale = params.get("scale");
  if (isScaleId(scale)) settings.scale = scale;
  const grid = params.get("grid");
  if (isQuantizeGrid(grid)) settings.quantizeGrid = grid;
  if (!inRange(settings.rootNote, RANGES.rootNote) || !Number.isInteger(settings.rootNote)) settings.rootNote = 0;
  if (!inRange(settings.bpm, RANGES.bpm)) settings.bpm = defaultSettings(mode).bpm;
  return settings;
}

function inRange(value: number, range: { min: number; max: number }) {
  return value >= range.min && value <= range.max;
}

/* ------------------------------------------------------------------ presets */

export const PRESETS_STORAGE_KEY = "viralballs_saved_settings";
export const ADVANCED_STORAGE_KEY = "viralballs_advanced_options";

export type PresetStore = Record<string, Partial<SimulatorSettings>>;

export function loadPresets(): PresetStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PresetStore) : {};
  } catch {
    return {};
  }
}

export function savePresets(store: PresetStore) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded or storage disabled: presets simply stay in memory */
  }
}

/** Merges a stored preset over the defaults so presets saved by older versions still load. */
export function presetToSettings(preset: Partial<SimulatorSettings>): SimulatorSettings {
  const mode: ModeId = isModeId(preset.mode) ? preset.mode : "classic";
  return { ...defaultSettings(mode), ...preset, mode, wallBreakSound: normalizeWallBreakSound(preset.wallBreakSound) };
}

export function resolutionToSize(resolution: string): { width: number; height: number } {
  const [w, h] = resolution.split("x").map(Number);
  return { width: w || 1080, height: h || 1920 };
}
