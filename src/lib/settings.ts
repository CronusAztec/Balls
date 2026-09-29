import type { BallInteraction, ModeId, WallBreakStyle } from "@/lib/physics/types";
import { DEFAULT_HIT_SAMPLE_ID, isHitSoundMode, normalizeHitSampleId, type HitSoundMode } from "@/lib/audio/sampler";
import { isInstrumentId, type InstrumentId } from "@/lib/audio/instruments";
import { BPM_MAX, BPM_MIN, ROOT_NOTE_MAX, ROOT_NOTE_MIN, isQuantizeGrid, isScaleId, type QuantizeGrid, type ScaleId } from "@/lib/audio/scales";
import { normalizeWallBreakSound } from "@/lib/audio/songs";
import { DEFAULT_PHYSICS_EXTRAS, PHYSICS_EXTRA_KEYS, PHYSICS_EXTRA_RANGES } from "@/lib/physics/extras";
import { BALL_INTERACTION_RANGES, DEFAULT_BALL_INTERACTION } from "@/lib/physics/interactions";
import { BOX_RANGES, DEFAULT_BOX_SETTINGS, boxSettingFields, boxSettingsOf, isBoxShape, isBoxSpeedRatio, resolveBoxSettings, type BoxShape, type BoxSpeedRatio } from "@/lib/physics/modes/box";
import { DEFAULT_DROP_SETTINGS, DROP_RANGES, dropSettingFields, dropSettingsOf, resolveDropSettings } from "@/lib/physics/modes/drop";
import { DEFAULT_PICTURE_PAINT, PICTURE_PAINT_RANGES, isPaintBeatSource, picturePaintOf, resolvePicturePaintSettings, type PaintBeatSource } from "@/lib/physics/picturePaint";
import { isBallInteraction, isModeId, WALL_BREAK_STYLES } from "@/lib/physics/types";
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
  // Physics extras (lib/physics/extras.ts): all off by default so existing seeds replay identically
  /** Fraction of the velocity lost per 60 Hz step (URL `drag`). */
  airDrag: number;
  /** Constant sideways / vertical push as a fraction of the ball speed per second (URL `wx`, `wy`). */
  windX: number;
  windY: number;
  /** 0–1: wall contact spins the ball and the spin curves its flight, Magnus-style (URL `spin`). */
  spinStrength: number;
  /** Restitution at wall hits, 0.5–1.2 (URL `wb`). */
  wallBounciness: number;
  /** Walls pulse by ±this fraction of their radius (URL `bw`) at `breathingSpeed` pulses per second (URL `bws`). */
  breathingAmplitude: number;
  breathingSpeed: number;
  /** Degrees per second the gravity vector turns (URL `rg`). */
  rotatingGravity: number;
  // Ball interactions (lib/physics/interactions.ts): bounce by default, so existing seeds replay identically
  /** What balls do to each other: bounce, merge into one, split at every wall break or pass through (URL `bi`). */
  ballInteraction: BallInteraction;
  /** Smallest ball a split may produce, in px (URL `smr`). */
  splitMinRadius: number;
  /** Splitting stops once this many balls are in play (URL `mb`). */
  maxBalls: number;
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
  // Ball Drop (lib/physics/modes/drop.ts): balls released from the top through a board of pegs and bars
  /** Balls released, 1–40 (URL `dbc`). */
  dropBallCount: number;
  /** 0–1: spread of the ball sizes around the ball size (URL `dsv`); bigger balls play lower notes. */
  dropSizeVariation: number;
  /** 0–1: spread of each ball's own gravity, ½×–2× at 1 (URL `dgv`). */
  dropGravityVariation: number;
  /** Rows of pegs and bars, 3–12 (URL `drows`). */
  dropRows: number;
  /** Seconds between two releases, 0–2 (URL `dsi`). */
  dropSpawnInterval: number;
  /** "Rain": the floor opens and balls that fall out come back in at the top (URL `dloop`). */
  dropLoop: boolean;
  // Bouncing Shapes (lib/physics/modes/box.ts): squares, circles or DVD-style logos bouncing in a rectangular box
  /** Shapes in the box, 1–12 (URL `bxn`). */
  boxShapeCount: number;
  /** square | circle | dvd (URL `bxs`). */
  boxShape: BoxShape;
  /** Width of the box relative to its height, 0.5–2 (URL `bxa`). */
  boxAspect: number;
  /** 0–1: how much of the gravity setting acts on the shapes (URL `bxg`). */
  boxGravity: number;
  /** Starting countdown on every shape, 0–99; 0 = off (URL `bxc`). */
  boxCountdown: number;
  /** Percent a shape grows per wall hit, 0–3 (URL `bxgr`). */
  boxGrowPerHit: number;
  /** Speeds of the shapes in whole-number ratios: 1:1, 2:3, 3:4:5 or 4:5:6 (URL `bxr`). */
  boxSpeedRatio: BoxSpeedRatio;
  // Picture Paint (lib/physics/picturePaint.ts): reveal an uploaded picture in Paint mode, on the beat of a song
  /** Brush dab radius as a multiple of the ball radius, 0.5–3 (URL `pbr`). */
  paintBrush: number;
  /** Opacity of the greyscale ghost of the unrevealed picture, 0–0.4 (URL `pgh`). */
  paintGhost: number;
  /** The ball speeds up on every beat and glides in between (URL `pbeat`). */
  paintBeatSync: boolean;
  /** Beat from the loaded song's detected grid or from the manual `bpm` setting (URL `pbs`). */
  paintBeatSource: PaintBeatSource;
  /** How hard a beat kicks the ball, 0–1 (URL `pbp`). */
  paintBeatPulse: number;
  /** Rebounds steer toward the least-revealed region (URL `pgd`). */
  paintGuided: boolean;
  /** The brush is re-paced every second to finish with the song or the clip (URL `pps`). */
  paintPaceToSong: boolean;
  // Overlays & recording
  watermarkText: string;
  topText: string;
  bottomText: string;
  textSize: number;
  recordingResolution: string;
  recordingDuration: number;
  wallBreakSound: string | null;
  // Hit sound: synthesised tones or an audio clip on every wall bounce
  hitSoundMode: HitSoundMode;
  /** Built-in sample id, or "custom" for the clip uploaded in this session. */
  hitSampleId: string;
  hitSamplePitchByWall: boolean;
  hitSampleVolume: number;
  // Song slicer: every bounce plays the next slice of an uploaded song
  sliceSong: boolean;
  sliceMs: number;
  sliceLoop: boolean;
  sliceFadeMs: number;
  // Background music bed under the bounce sounds (the track itself stays in memory; see lib/audio/musicBed.ts)
  musicVolume: number;
  /** 0–1: how far the bed dips on every bounce / wall-break sound. */
  musicDucking: number;
  /** Milliseconds the bed takes to swell back after a duck. */
  musicDuckRelease: number;
  musicLoop: boolean;
  /** Seconds into the track at which the bed starts (and restarts). */
  musicStartOffset: number;
  // Music: instrument voices, scale snapping and beat lock (see lib/audio/instruments.ts, scales.ts)
  /** Voice of the wall tones. */
  instrument: InstrumentId;
  /** Voice of the melody notes (a loaded song); sine is the classic melody sound. */
  melodyInstrument: InstrumentId;
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
    ...DEFAULT_PHYSICS_EXTRAS,
    ...DEFAULT_BALL_INTERACTION,
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
    ...dropSettingFields(DEFAULT_DROP_SETTINGS),
    ...boxSettingFields(DEFAULT_BOX_SETTINGS),
    ...DEFAULT_PICTURE_PAINT,
    watermarkText: SITE_DOMAIN,
    topText: "",
    bottomText: "",
    textSize: 1,
    recordingResolution: "1080x1920",
    recordingDuration: 30,
    wallBreakSound: null,
    hitSoundMode: "tones",
    hitSampleId: DEFAULT_HIT_SAMPLE_ID,
    hitSamplePitchByWall: true,
    hitSampleVolume: 0.8,
    sliceSong: false,
    sliceMs: 250,
    sliceLoop: true,
    sliceFadeMs: 8,
    musicVolume: 0.5,
    musicDucking: 0.6,
    musicDuckRelease: 250,
    musicLoop: true,
    musicStartOffset: 0,
    instrument: "triangle",
    melodyInstrument: "sine",
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
  hitSampleVolume: { min: 0, max: 1, step: 0.05 },
  sliceMs: { min: 80, max: 1000, step: 10 },
  sliceFadeMs: { min: 0, max: 50, step: 1 },
  musicVolume: { min: 0, max: 1, step: 0.05 },
  musicDucking: { min: 0, max: 1, step: 0.05 },
  musicDuckRelease: { min: 50, max: 1000, step: 10 },
  musicStartOffset: { min: 0, max: 600, step: 0.5 },
  rootNote: { min: ROOT_NOTE_MIN, max: ROOT_NOTE_MAX, step: 1 },
  bpm: { min: BPM_MIN, max: BPM_MAX, step: 1 },
  ...PHYSICS_EXTRA_RANGES,
  ...BALL_INTERACTION_RANGES,
  ...DROP_RANGES,
  ...BOX_RANGES,
  ...PICTURE_PAINT_RANGES,
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
  hsv: "hitSampleVolume",
  slms: "sliceMs",
  slfade: "sliceFadeMs",
  mv: "musicVolume",
  md: "musicDucking",
  mdr: "musicDuckRelease",
  mso: "musicStartOffset",
  root: "rootNote",
  bpm: "bpm",
  // Physics extras
  drag: "airDrag",
  wx: "windX",
  wy: "windY",
  spin: "spinStrength",
  wb: "wallBounciness",
  bw: "breathingAmplitude",
  bws: "breathingSpeed",
  rg: "rotatingGravity",
  // Ball interactions
  smr: "splitMinRadius",
  mb: "maxBalls",
  // Ball Drop
  dbc: "dropBallCount",
  dsv: "dropSizeVariation",
  dgv: "dropGravityVariation",
  drows: "dropRows",
  dsi: "dropSpawnInterval",
  // Bouncing Shapes
  bxn: "boxShapeCount",
  bxa: "boxAspect",
  bxg: "boxGravity",
  bxc: "boxCountdown",
  bxgr: "boxGrowPerHit",
  // Picture Paint
  pbr: "paintBrush",
  pgh: "paintGhost",
  pbp: "paintBeatPulse",
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
  hspw: "hitSamplePitchByWall",
  slice: "sliceSong",
  sloop: "sliceLoop",
  mloop: "musicLoop",
  qz: "quantizeToBeat",
  dloop: "dropLoop",
  pbeat: "paintBeatSync",
  pgd: "paintGuided",
  pps: "paintPaceToSong",
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
  if (settings.ballInteraction !== base.ballInteraction) params.set("bi", settings.ballInteraction);
  if (settings.paintBeatSource !== base.paintBeatSource) params.set("pbs", settings.paintBeatSource);
  if (settings.boxShape !== base.boxShape) params.set("bxs", settings.boxShape);
  if (settings.boxSpeedRatio !== base.boxSpeedRatio) params.set("bxr", settings.boxSpeedRatio);
  if (settings.recordingResolution !== base.recordingResolution) params.set("res", settings.recordingResolution);
  if (settings.recordingDuration !== base.recordingDuration) params.set("dur", String(settings.recordingDuration));
  if (settings.hitSoundMode !== base.hitSoundMode) params.set("hsm", settings.hitSoundMode);
  // An uploaded clip cannot travel in a link, so "custom" is left out (the reader falls back to the default sample).
  if (settings.hitSampleId !== base.hitSampleId && settings.hitSampleId !== "custom") params.set("hs", settings.hitSampleId);
  if (settings.instrument !== base.instrument) params.set("inst", settings.instrument);
  if (settings.melodyInstrument !== base.melodyInstrument) params.set("minst", settings.melodyInstrument);
  if (settings.scale !== base.scale) params.set("scale", settings.scale);
  if (settings.quantizeGrid !== base.quantizeGrid) params.set("grid", settings.quantizeGrid);
  return params;
}

/** Up to three decimals (air drag steps by 0.001), trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
  const hsm = params.get("hsm");
  if (isHitSoundMode(hsm)) settings.hitSoundMode = hsm;
  const hs = params.get("hs");
  if (hs !== null) settings.hitSampleId = normalizeHitSampleId(hs);
  settings.hitSampleVolume = clampRange(settings.hitSampleVolume, RANGES.hitSampleVolume, defaultSettings(mode).hitSampleVolume);
  clampMusicBed(settings, defaultSettings(mode));
  clampPhysicsExtras(settings, defaultSettings(mode));
  const bi = params.get("bi");
  if (isBallInteraction(bi)) settings.ballInteraction = bi;
  clampBallInteraction(settings, defaultSettings(mode));
  clampDropSettings(settings);
  const bxs = params.get("bxs");
  if (isBoxShape(bxs)) settings.boxShape = bxs;
  const bxr = params.get("bxr");
  if (isBoxSpeedRatio(bxr)) settings.boxSpeedRatio = bxr;
  clampBoxSettings(settings);
  const pbs = params.get("pbs");
  if (isPaintBeatSource(pbs)) settings.paintBeatSource = pbs;
  clampPicturePaint(settings);
  const inst = params.get("inst");
  if (isInstrumentId(inst)) settings.instrument = inst;
  const minst = params.get("minst");
  if (isInstrumentId(minst)) settings.melodyInstrument = minst;
  const scale = params.get("scale");
  if (isScaleId(scale)) settings.scale = scale;
  const grid = params.get("grid");
  if (isQuantizeGrid(grid)) settings.quantizeGrid = grid;
  if (!inRange(settings.rootNote, RANGES.rootNote) || !Number.isInteger(settings.rootNote)) settings.rootNote = 0;
  if (!inRange(settings.bpm, RANGES.bpm)) settings.bpm = defaultSettings(mode).bpm;
  return settings;
}

function clampRange(value: number, range: { min: number; max: number }, fallback: number) {
  return Number.isFinite(value) ? Math.max(range.min, Math.min(range.max, value)) : fallback;
}

function inRange(value: number, range: { min: number; max: number }) {
  return value >= range.min && value <= range.max;
}

/** Keeps the music-bed numbers inside their slider ranges (URL parameters and presets alike). */
function clampMusicBed(settings: SimulatorSettings, defaults: SimulatorSettings) {
  settings.musicVolume = clampRange(Number(settings.musicVolume), RANGES.musicVolume, defaults.musicVolume);
  settings.musicDucking = clampRange(Number(settings.musicDucking), RANGES.musicDucking, defaults.musicDucking);
  settings.musicDuckRelease = clampRange(Number(settings.musicDuckRelease), RANGES.musicDuckRelease, defaults.musicDuckRelease);
  settings.musicStartOffset = clampRange(Number(settings.musicStartOffset), RANGES.musicStartOffset, defaults.musicStartOffset);
}

/** Keeps the physics extras inside their slider ranges (URL parameters and presets alike); bad values fall back to "off". */
function clampPhysicsExtras(settings: SimulatorSettings, defaults: SimulatorSettings) {
  for (const key of PHYSICS_EXTRA_KEYS) settings[key] = clampRange(Number(settings[key]), PHYSICS_EXTRA_RANGES[key], defaults[key]);
}

/** Keeps the split limits of the ball interaction inside their slider ranges, as whole numbers (URL parameters and presets alike). */
function clampBallInteraction(settings: SimulatorSettings, defaults: SimulatorSettings) {
  settings.splitMinRadius = Math.round(clampRange(Number(settings.splitMinRadius), RANGES.splitMinRadius, defaults.splitMinRadius));
  settings.maxBalls = Math.round(clampRange(Number(settings.maxBalls), RANGES.maxBalls, defaults.maxBalls));
}

/** Keeps the Ball Drop settings inside their slider ranges, counts as whole numbers (URL parameters and presets alike; bad values fall back to the defaults). */
function clampDropSettings(settings: SimulatorSettings) {
  Object.assign(settings, dropSettingFields(resolveDropSettings(dropSettingsOf(settings))));
}

/** Keeps the Bouncing Shapes settings inside their ranges, counts as whole numbers; an unknown shape or speed ratio falls back to the default (URL parameters and presets alike). */
function clampBoxSettings(settings: SimulatorSettings) {
  Object.assign(settings, boxSettingFields(resolveBoxSettings(boxSettingsOf(settings))));
}

/** Keeps the Picture Paint settings inside their ranges; an unknown beat source or a non-boolean flag falls back to the default (URL parameters and presets alike). */
function clampPicturePaint(settings: SimulatorSettings) {
  Object.assign(settings, resolvePicturePaintSettings(picturePaintOf(settings)));
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

/**
 * Merges a stored preset over the defaults so presets saved by older versions still load.
 * Uploaded media does not survive a reload, so a preset's "custom" hit sample falls back
 * to the default built-in clip (like dead blob: wall-break URLs). Enumerated fields (hit
 * sound mode, instruments, scale, grid, ball interaction) fall back to their defaults when the
 * stored value is unknown, and numeric ones (including the Ball Drop and Bouncing Shapes settings)
 * are clamped to their ranges, like URL parameters.
 */
export function presetToSettings(preset: Partial<SimulatorSettings>): SimulatorSettings {
  const mode: ModeId = isModeId(preset.mode) ? preset.mode : "classic";
  const defaults = defaultSettings(mode);
  const merged = { ...defaults, ...preset, mode, wallBreakSound: normalizeWallBreakSound(preset.wallBreakSound) };
  merged.hitSoundMode = isHitSoundMode(preset.hitSoundMode) ? preset.hitSoundMode : defaults.hitSoundMode;
  merged.hitSampleId = normalizeHitSampleId(preset.hitSampleId);
  merged.hitSampleVolume = clampRange(Number(merged.hitSampleVolume), RANGES.hitSampleVolume, defaults.hitSampleVolume);
  merged.instrument = isInstrumentId(preset.instrument) ? preset.instrument : defaults.instrument;
  merged.melodyInstrument = isInstrumentId(preset.melodyInstrument) ? preset.melodyInstrument : defaults.melodyInstrument;
  merged.scale = isScaleId(preset.scale) ? preset.scale : defaults.scale;
  merged.quantizeGrid = isQuantizeGrid(preset.quantizeGrid) ? preset.quantizeGrid : defaults.quantizeGrid;
  merged.quantizeToBeat = preset.quantizeToBeat === true;
  const root = Number(merged.rootNote);
  merged.rootNote = Number.isInteger(root) && inRange(root, RANGES.rootNote) ? root : defaults.rootNote;
  merged.bpm = clampRange(Number(merged.bpm), RANGES.bpm, defaults.bpm);
  merged.sliceMs = clampRange(Number(merged.sliceMs), RANGES.sliceMs, defaults.sliceMs);
  merged.sliceFadeMs = clampRange(Number(merged.sliceFadeMs), RANGES.sliceFadeMs, defaults.sliceFadeMs);
  merged.musicLoop = typeof preset.musicLoop === "boolean" ? preset.musicLoop : defaults.musicLoop;
  clampMusicBed(merged, defaults);
  clampPhysicsExtras(merged, defaults);
  merged.ballInteraction = isBallInteraction(preset.ballInteraction) ? preset.ballInteraction : defaults.ballInteraction;
  clampBallInteraction(merged, defaults);
  clampDropSettings(merged);
  clampBoxSettings(merged);
  clampPicturePaint(merged);
  return merged;
}

export function resolutionToSize(resolution: string): { width: number; height: number } {
  const [w, h] = resolution.split("x").map(Number);
  return { width: w || 1080, height: h || 1920 };
}
