import { isScaleId, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import { criticallyDampedStep } from "@/lib/anim/easing";
import { DEFAULT_BEAT_CLOCK, isUsableGrid, type BeatClockConfig, type BeatGrid } from "@/lib/simulation/beatClock";
import { beatTimeSec, firstBeatAtOrAfter, followsSongGrid, sameBeatSchedule, scheduleBpm, schedulePeriod } from "@/lib/simulation/beatSchedule";
import {
  BEAT_DROP_KINDS,
  BD_DRUM_KICK,
  BD_DRUM_SNARE,
  cameraTargetAt,
  createBallSample,
  createBeatDropPlan,
  descendingRoot,
  isBeatDropPadKind,
  isBeatDropScroll,
  keptBeats,
  planBeatDrop,
  sampleBall,
  type BeatDropPadKind,
  type BeatDropPlan,
  type BeatDropScroll,
} from "@/lib/simulation/beatDropPlan";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { clampNumber, formatNumber, rhythmPitch, toStep } from "./jdmRhythm";

/**
 * Beat Drop ("beatDrop" mode, feature beat-drop). A portrait scene on a dark gradient: one ball falls under gravity and
 * bounces, and for every beat of the beat it follows an obstruction flies in from off-screen and settles a hair before the
 * beat, so the ball lands on it exactly on the beat – a plank, a block, a spring pad (a higher bounce with a boing), a
 * wedge (it redirects the drift), a spinning bar (flat at the beat) or a big drum pad. It squashes on impact, glows with
 * the beat, holds while the ball is over it and slides away with a fade; the ball squashes and stretches and leaves a
 * trail; every landing plays a drum (the kick on 1 and 3, the snare on 2 and 4, hats on the off-beats, synthesised) with
 * the pad's own accent, the next note of the melody, or both.
 *
 * The run is planned at init by the pure planner (lib/simulation/beatDropPlan.ts – landing points, take-off speeds solved
 * so every flight lasts exactly its beat interval, the obstructions' entrances and exits) from the beats of the beat
 * source (`beatDropBeatConfig()` – the adapter below) and the seed (`ctx.random()`); the ball is an ordinary engine ball
 * (`gravityScale` 0, `ballsMayRest`, `ballsPassThrough`) whose position the mode sets from the planned arcs at every
 * sub-step, like Pendulum Wave, so pause, playback speed, restart, faces, the recorder and the fast export work unchanged,
 * a landing is on its beat to floating-point precision at any tempo and frame rate, and the renderer can draw the ball and
 * the pads at any time between two steps (sub-frame smooth at any speed). The run covers the beats of the clip (the
 * Recording length): it ends `END_HOLD_SEC` after the last landing that fits in it, and it can never fail – every seed
 * lands every beat, so Find Simulation only picks a seed and says how many beats the clip covers.
 */

/* ------------------------------------------------------------------ settings */

export const BEAT_DROP_SOUNDS = ["drums", "melody", "both"] as const;
export type BeatDropSound = (typeof BEAT_DROP_SOUNDS)[number];
export const BEAT_DROP_COLOR_MODES = ["pad", "rainbow", "team"] as const;
export type BeatDropColorMode = (typeof BEAT_DROP_COLOR_MODES)[number];

export function isBeatDropSound(value: unknown): value is BeatDropSound {
  return typeof value === "string" && (BEAT_DROP_SOUNDS as readonly string[]).includes(value);
}
export function isBeatDropColorMode(value: unknown): value is BeatDropColorMode {
  return typeof value === "string" && (BEAT_DROP_COLOR_MODES as readonly string[]).includes(value);
}

export interface BeatDropSettings {
  /** The obstructions in the mix (at least one). */
  kinds: BeatDropPadKind[];
  /** 0–1: how far the ball drifts sideways from landing to landing. */
  drift: number;
  /** "endless": every landing a little lower, the camera follows down; "arena": the ball bounces around inside the view. */
  scroll: BeatDropScroll;
  /** 0.1–0.5 of the view: how high a flight of one beat rises. */
  bounceHeight: number;
  /** 0.3–1 beats: how long before its beat an obstruction starts flying in. */
  anticipation: number;
  /** What a landing plays: drums (+ the pad's accent), the melody's next note, or both. Live. */
  sound: BeatDropSound;
  /** Pad colours: per kind, a rainbow by beat, or the team colours. Live. */
  colorMode: BeatDropColorMode;
  /** The ball's motion trail. Live. */
  trail: boolean;
  /** Seconds of the clip (the Recording length): the run ends on the last landing that fits in it. Live. */
  clipSec: number;
  /** The beat source: the Sound section's BPM, and the loaded song's detected grid (music bed or slicer) with its offset and loop. */
  bpm: number;
  grid: BeatGrid | null;
  offset: number;
  loop: boolean;
  /** The Sound section's scale and root: the accents and the built-in melody follow them. Live. */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_BEAT_DROP_SETTINGS: BeatDropSettings = {
  kinds: [...BEAT_DROP_KINDS],
  drift: 0.5,
  scroll: "endless",
  bounceHeight: 0.24,
  anticipation: 0.6,
  sound: "both",
  colorMode: "pad",
  trail: true,
  clipSec: 30,
  bpm: 120,
  grid: null,
  offset: 0,
  loop: true,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const BEAT_DROP_RANGES = {
  bdDrift: { min: 0, max: 1, step: 0.05 },
  bdBounceHeight: { min: 0.1, max: 0.5, step: 0.01 },
  bdAnticipation: { min: 0.3, max: 1, step: 0.05 },
} as const;

/** The Ball Size of the mode (a bigger ball than the ring modes' 8 px suits the scene). */
export const BEAT_DROP_BALL_RADIUS = 14;
/** The run ends this long after its last landing (the bounce off the last pad plays out). */
export const END_HOLD_SEC = 0.6;
/** The run is planned this far ahead (the longest clip, 120 s, and a little more). */
export const PLAN_HORIZON_SEC = 125;
/** The widest tempo the adapter accepts (the BPM slider is narrower; a detected or marked grid may not be). */
const ADAPTER_BPM = { min: 20, max: 400 };

/** The Beat Drop fields of the SimulatorSettings object (URL keys bdk, bdd, bds, bdh, bda, bdsn, bdc, bdt). */
export interface BeatDropFields {
  /** The mix as a comma list of kinds in the canonical order ("plank,block,spring,wedge,spinner,drum"). */
  bdKinds: string;
  bdDrift: number;
  bdScroll: BeatDropScroll;
  bdBounceHeight: number;
  bdAnticipation: number;
  bdSound: BeatDropSound;
  bdColorMode: BeatDropColorMode;
  bdTrail: boolean;
}

/** The kinds of a comma list, known ones only, each once, in the canonical order; none left = every kind. */
export function parseBeatDropKinds(value: unknown): BeatDropPadKind[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const wanted = new Set(list.map((k) => String(k).trim()).filter(isBeatDropPadKind));
  const out = BEAT_DROP_KINDS.filter((k) => wanted.has(k));
  return out.length > 0 ? out : [...BEAT_DROP_KINDS];
}

/** The canonical comma list of a mix. */
export function serializeBeatDropKinds(kinds: readonly BeatDropPadKind[]): string {
  return parseBeatDropKinds(kinds as unknown as string[]).join(",");
}

/** Toggles `kind` in a mix (the last kind cannot be switched off). */
export function toggleBeatDropKind(list: string, kind: BeatDropPadKind): string {
  const kinds = parseBeatDropKinds(list);
  const has = kinds.includes(kind);
  if (has && kinds.length === 1) return serializeBeatDropKinds(kinds);
  return serializeBeatDropKinds(has ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
}

/** Fills in the defaults and clamps every value onto its slider; unknown options fall back to the defaults. */
export function resolveBeatDropSettings(config: Partial<BeatDropSettings> | null | undefined): BeatDropSettings {
  const out: BeatDropSettings = { ...DEFAULT_BEAT_DROP_SETTINGS, kinds: [...DEFAULT_BEAT_DROP_SETTINGS.kinds] };
  if (!config) return out;
  const R = BEAT_DROP_RANGES;
  if (config.kinds !== undefined) out.kinds = parseBeatDropKinds(config.kinds);
  if (config.drift !== undefined) out.drift = toStep(clampNumber(config.drift, R.bdDrift, out.drift), R.bdDrift.step);
  if (isBeatDropScroll(config.scroll)) out.scroll = config.scroll;
  if (config.bounceHeight !== undefined) out.bounceHeight = toStep(clampNumber(config.bounceHeight, R.bdBounceHeight, out.bounceHeight), R.bdBounceHeight.step);
  if (config.anticipation !== undefined) out.anticipation = toStep(clampNumber(config.anticipation, R.bdAnticipation, out.anticipation), R.bdAnticipation.step);
  if (isBeatDropSound(config.sound)) out.sound = config.sound;
  if (isBeatDropColorMode(config.colorMode)) out.colorMode = config.colorMode;
  if (typeof config.trail === "boolean") out.trail = config.trail;
  if (config.clipSec !== undefined) out.clipSec = clampNumber(config.clipSec, { min: 1, max: PLAN_HORIZON_SEC - 1 }, out.clipSec);
  if (config.bpm !== undefined) out.bpm = clampNumber(config.bpm, ADAPTER_BPM, out.bpm);
  if (config.grid !== undefined) out.grid = isUsableGrid(config.grid) ? config.grid : null;
  if (config.offset !== undefined) out.offset = clampNumber(config.offset, { min: 0, max: 1e6 }, 0);
  if (typeof config.loop === "boolean") out.loop = config.loop;
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** The loaded song's beat grid as Beat Drop follows it (Simulator.tsx hands in the same grid the Beat Runner follows). */
export interface BeatDropBeatInput {
  grid: BeatGrid | null;
  offset: number;
  loop: boolean;
}

/** Picks the Beat Drop settings (and the Sound section's BPM, scale and root, the clip length, the song's grid) out of the page's settings. */
export function beatDropSettingsOf(source: BeatDropFields & { bpm?: number; scale?: ScaleId; rootNote?: number; recordingDuration?: number }, beat?: BeatDropBeatInput | null): BeatDropSettings {
  return {
    kinds: parseBeatDropKinds(source.bdKinds),
    drift: source.bdDrift,
    scroll: source.bdScroll,
    bounceHeight: source.bdBounceHeight,
    anticipation: source.bdAnticipation,
    sound: source.bdSound,
    colorMode: source.bdColorMode,
    trail: source.bdTrail,
    clipSec: source.recordingDuration ?? DEFAULT_BEAT_DROP_SETTINGS.clipSec,
    bpm: source.bpm ?? DEFAULT_BEAT_DROP_SETTINGS.bpm,
    grid: beat?.grid ?? null,
    offset: beat?.offset ?? 0,
    loop: beat?.loop ?? true,
    scale: source.scale ?? DEFAULT_BEAT_DROP_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_BEAT_DROP_SETTINGS.rootNote,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function beatDropSettingFields(settings: BeatDropSettings): BeatDropFields {
  return {
    bdKinds: serializeBeatDropKinds(settings.kinds),
    bdDrift: settings.drift,
    bdScroll: settings.scroll,
    bdBounceHeight: settings.bounceHeight,
    bdAnticipation: settings.anticipation,
    bdSound: settings.sound,
    bdColorMode: settings.colorMode,
    bdTrail: settings.trail,
  };
}

/* ------------------------------------------------------------------ settings, URL and presets (settings.ts calls these) */

export function defaultBeatDropFields(): BeatDropFields {
  return beatDropSettingFields(DEFAULT_BEAT_DROP_SETTINGS);
}

/** The mode's own defaults of shared settings: a bigger ball in Beat Drop only. */
export function beatDropModeDefaults(mode: string): { ballRadius?: number } {
  return mode === "beatDrop" ? { ballRadius: BEAT_DROP_BALL_RADIUS } : {};
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers on their steps, known options, real booleans. */
export function resolveBeatDropFields(source: Partial<BeatDropFields>): BeatDropFields {
  return beatDropSettingFields(
    resolveBeatDropSettings({
      kinds: source.bdKinds === undefined ? undefined : parseBeatDropKinds(source.bdKinds),
      drift: source.bdDrift,
      scroll: source.bdScroll,
      bounceHeight: source.bdBounceHeight,
      anticipation: source.bdAnticipation,
      sound: source.bdSound,
      colorMode: source.bdColorMode,
      trail: source.bdTrail,
    }),
  );
}

const NUMERIC_KEYS = { bdd: "bdDrift", bdh: "bdBounceHeight", bda: "bdAnticipation" } as const;

/** Writes the fields that differ from `base` (the mode's defaults) into the URL: bdk, bdd, bds, bdh, bda, bdsn, bdc and bdt. */
export function writeBeatDropParams(settings: BeatDropFields, base: BeatDropFields, params: URLSearchParams) {
  if (settings.bdKinds !== base.bdKinds) params.set("bdk", settings.bdKinds);
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.bdScroll !== base.bdScroll) params.set("bds", settings.bdScroll);
  if (settings.bdSound !== base.bdSound) params.set("bdsn", settings.bdSound);
  if (settings.bdColorMode !== base.bdColorMode) params.set("bdc", settings.bdColorMode);
  if (settings.bdTrail !== base.bdTrail) params.set("bdt", settings.bdTrail ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readBeatDropParams(params: URLSearchParams, settings: BeatDropFields) {
  const next: Partial<BeatDropFields> = { ...settings };
  const kinds = params.get("bdk");
  if (kinds !== null) next.bdKinds = serializeBeatDropKinds(parseBeatDropKinds(kinds.slice(0, 120)));
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const scroll = params.get("bds");
  if (isBeatDropScroll(scroll)) next.bdScroll = scroll;
  const sound = params.get("bdsn");
  if (isBeatDropSound(sound)) next.bdSound = sound;
  const color = params.get("bdc");
  if (isBeatDropColorMode(color)) next.bdColorMode = color;
  const trail = params.get("bdt");
  if (trail === "1") next.bdTrail = true;
  else if (trail === "0") next.bdTrail = false;
  Object.assign(settings, resolveBeatDropFields(next));
}

/* ------------------------------------------------------------------ the beat source (adapter) */

/**
 * THE ONE PLACE Beat Drop reads its beat grid. The beat is the beat clock's (lib/simulation/beatClock.ts): the grid it is
 * handed while there is one, else the Sound section's BPM; the rest of the mode only sees the BeatClockConfig returned here.
 * --- video-beats --- The grid is the beat source in effect (lib/simulation/beatSource.ts, the Sound section's "Beats from a
 * video" picker): the page resolves it (components/simulator/useVideoBeats.ts) into the same `rhythmBeat` the Beat Runner
 * follows – the loaded song's detected grid (music bed or song slicer, with the bed's start offset and loop), an imported
 * video's or audio file's beats, or the hand-placed markers – and none for the BPM source; the headless finder requests take
 * the markers (`markerBeatInputOf()`). So this adapter needs no change for a new source.
 */
export function beatDropBeatConfig(settings: Pick<BeatDropSettings, "bpm" | "grid" | "offset" | "loop">): BeatClockConfig {
  // --- beat source adapter ---
  const song = isUsableGrid(settings.grid);
  return {
    ...DEFAULT_BEAT_CLOCK,
    source: song ? "song" : "bpm",
    grid: song ? settings.grid : null,
    manualBpm: clampNumber(settings.bpm, ADAPTER_BPM, DEFAULT_BEAT_DROP_SETTINGS.bpm),
    offset: song ? Math.max(0, settings.offset) : 0,
    loop: song ? settings.loop : true,
  };
  // --- end beat source adapter ---
}

/** The beats of `config` from `fromSec` up to `toSec` (s): their times and indices (numbered like `BeatClock.sample().index`). */
export function beatDropBeats(config: BeatClockConfig, fromSec: number, toSec: number, maxCount = 6000): { times: number[]; indices: number[] } {
  const times: number[] = [];
  const indices: number[] = [];
  let i = firstBeatAtOrAfter(config, Math.max(0, fromSec));
  if (i < 0) return { times, indices };
  let last = -Infinity;
  while (times.length < maxCount) {
    const t = beatTimeSec(config, i);
    if (!Number.isFinite(t) || t > toSec) break;
    if (t > last) {
      times.push(t);
      indices.push(i);
      last = t;
    }
    i++;
  }
  return { times, indices };
}

/** What a run is planned from besides the seed: the mix, drift, scroll, bounce height, anticipation and the beat it follows. */
export interface BeatDropPlanKey {
  kinds: string;
  drift: number;
  scroll: BeatDropScroll;
  bounceHeight: number;
  anticipation: number;
  beat: BeatClockConfig;
}

export function beatDropPlanKeyOf(settings: Partial<BeatDropSettings>): BeatDropPlanKey {
  const s = resolveBeatDropSettings(settings);
  return { kinds: serializeBeatDropKinds(s.kinds), drift: s.drift, scroll: s.scroll, bounceHeight: s.bounceHeight, anticipation: s.anticipation, beat: beatDropBeatConfig(s) };
}

/** True when two keys plan the same run (the page re-plans – restarts – a run only when this changes). */
export function sameBeatDropPlan(a: BeatDropPlanKey, b: BeatDropPlanKey): boolean {
  return a.kinds === b.kinds && a.drift === b.drift && a.scroll === b.scroll && a.bounceHeight === b.bounceHeight && a.anticipation === b.anticipation && sameBeatSchedule(a.beat, b.beat);
}

/* ------------------------------------------------------------------ the run in numbers */

/** The run of a clip: the landings it covers, when it ends (s), and the tempo it follows (for the panel and the finder). */
export interface BeatDropRunInfo {
  beats: number;
  seconds: number;
  bpm: number;
  song: boolean;
}

/** The landing times of the settings' beat up to the planning horizon (the ones the planner keeps). */
export function beatDropLandingTimes(settings: Partial<BeatDropSettings>): number[] {
  const s = resolveBeatDropSettings(settings);
  const beat = beatDropBeatConfig(s);
  return keptBeats(beatDropBeats(beat, 0, PLAN_HORIZON_SEC).times);
}

/** When a run ending with the clip `clipSec` finishes (s), given its landing times: `END_HOLD_SEC` after the last landing that fits. */
export function beatDropFinishSec(landings: ArrayLike<number>, count: number, clipSec: number): { finishSec: number; beats: number } {
  const limit = clipSec - END_HOLD_SEC + 1e-9;
  let beats = 0;
  let last = NaN;
  for (let i = 0; i < count; i++) {
    if (landings[i] > limit) break;
    beats++;
    last = landings[i];
  }
  return { finishSec: beats > 0 ? last + END_HOLD_SEC : Math.max(0, clipSec), beats };
}

export function beatDropRunInfo(settings: Partial<BeatDropSettings>): BeatDropRunInfo {
  const s = resolveBeatDropSettings(settings);
  const beat = beatDropBeatConfig(s);
  const times = beatDropLandingTimes(s);
  const { finishSec, beats } = beatDropFinishSec(times, times.length, s.clipSec);
  return { beats, seconds: finishSec, bpm: scheduleBpm(beat), song: followsSongGrid(beat) };
}

/* ------------------------------------------------------------------ sounds */

/** The scale degree each kind's accent plays (the ToneGenerator snaps it to the scale). */
export const PAD_ACCENT_DEGREE: Record<BeatDropPadKind, number> = { plank: 4, block: -3, spring: 7, wedge: 9, spinner: 11, drum: -7 };

/** Pitch (Hz) of the accent of a pad of `kind`. */
export function padAccentPitch(kind: BeatDropPadKind, scale: ScaleId, rootNote: number): number {
  return rhythmPitch(PAD_ACCENT_DEGREE[kind], scale, rootNote);
}

/** The built-in melody (scale degrees) the landings play while no melody is loaded – a loaded melody plays its own notes. */
export const BUILT_IN_MELODY = [0, 2, 4, 7, 4, 2, 5, 3, 1, 4, 6, 9, 7, 4, 2, -1] as const;

/** Pitch (Hz) of the `n`-th landing's note of the built-in melody. */
export function melodyPitch(n: number, scale: ScaleId, rootNote: number): number {
  const i = ((Math.round(n) % BUILT_IN_MELODY.length) + BUILT_IN_MELODY.length) % BUILT_IN_MELODY.length;
  return rhythmPitch(BUILT_IN_MELODY[i], scale, rootNote);
}

/**
 * The sound events of a landing on pad `kind` with the drum `drum` (a BD_DRUM_* value), `n`-th of the run: drums (the drum
 * and the pad's accent, an accompaniment – `melody` false), the melody's next note (an ordinary hit: melody, slicer, hit
 * sample, instrument), or both. Pushed into `out`.
 */
export function landingSounds(sound: BeatDropSound, kind: BeatDropPadKind, drum: number, downbeat: boolean, n: number, scale: ScaleId, rootNote: number, out: SoundEvent[]): SoundEvent[] {
  if (sound !== "melody") {
    out.push({ type: "hit", wallIndex: 0, frequency: padAccentPitch(kind, scale, rootNote), bdDrum: drum === BD_DRUM_KICK ? "kick" : drum === BD_DRUM_SNARE ? "snare" : "none", bdPad: kind, accent: downbeat, melody: false });
  }
  if (sound !== "drums") out.push({ type: "hit", wallIndex: 0, frequency: melodyPitch(n, scale, rootNote), ...(downbeat ? { accent: true } : {}) });
  return out;
}

/** The off-beat hat (drums and both). */
export function hatSound(): SoundEvent {
  return { type: "hit", wallIndex: 0, bdDrum: "hat", melody: false, level: 0.7 };
}

/* ------------------------------------------------------------------ view */

/** Where in the exported square the landing the camera aims at sits (fraction of its height from the top). */
export const FOCUS_AT = 0.62;
/** The camera's critically damped follow (rad/s) and the dip a downbeat kicks it with (view units / s). */
export const CAMERA_OMEGA = 7;
export const DOWNBEAT_KICK = 0.22;
/** Landing times the view keeps (a ring buffer) for the canvas' data attributes. */
export const LANDING_LOG = 32;

export interface BeatDropField {
  width: number;
  height: number;
  /** Side of the exported square (the view unit in px), its centre x and top. */
  size: number;
  cx: number;
  top: number;
  /** World y (px) of the planned height 0 with the camera at 0. */
  originY: number;
}

export interface BeatDropView {
  /** The run's settings (sound, colours, trail, clip, scale and root follow live). */
  settings: BeatDropSettings;
  plan: BeatDropPlan;
  field: BeatDropField;
  /** Simulation time (ms). */
  timeMs: number;
  /** The camera (view units): where it looks, its velocity (the renderer extrapolates between steps). */
  camY: number;
  camV: number;
  /** The tempo followed and whether it is a song's grid. */
  bpm: number;
  song: boolean;
  /** Landings so far, the index of the latest (−1: none) and the landings the clip covers. */
  landed: number;
  lastLanding: number;
  plannedLandings: number;
  /** When the clip's last landing is (ms; −Infinity: none fits), when the run ends (ms) and whether it has. */
  lastLandingMs: number;
  finishMs: number;
  finished: boolean;
  finishedMs: number;
  /** The largest measured |landing − beat| (ms): the incoming arc's descent onto the pad, solved from the ball's state one sub-step before. */
  maxErrorMs: number;
  /** The latest landings (ring buffer): when the ball landed and the beat it was planned for (ms). */
  landingMs: Float64Array;
  beatMs: Float64Array;
  logCount: number;
  /** Drum and note counters. */
  kicks: number;
  snares: number;
  hats: number;
  notes: number;
  downbeats: number;
  /** The seed's particle salt (visual only). */
  salt: number;
}

function createField(): BeatDropField {
  return { width: 0, height: 0, size: 0, cx: 0, top: 0, originY: 0 };
}

/** Lays the view out for a `width` × `height` canvas (into `out`). */
export function layoutBeatDropField(width: number, height: number, out: BeatDropField = createField()): BeatDropField {
  const size = Math.max(1, Math.min(width, height));
  out.width = width;
  out.height = height;
  out.size = size;
  out.cx = width / 2;
  out.top = (height - size) / 2;
  out.originY = out.top + FOCUS_AT * size;
  return out;
}

function createView(): BeatDropView {
  return {
    settings: resolveBeatDropSettings(null),
    plan: createBeatDropPlan(16),
    field: createField(),
    timeMs: 0,
    camY: 0,
    camV: 0,
    bpm: 120,
    song: false,
    landed: 0,
    lastLanding: -1,
    plannedLandings: 0,
    lastLandingMs: -Infinity,
    finishMs: 0,
    finished: false,
    finishedMs: -1,
    maxErrorMs: 0,
    landingMs: new Float64Array(LANDING_LOG),
    beatMs: new Float64Array(LANDING_LOG),
    logCount: 0,
    kicks: 0,
    snares: 0,
    hats: 0,
    notes: 0,
    downbeats: 0,
    salt: 0,
  };
}

/* ------------------------------------------------------------------ the mode */

export class BeatDropMode implements GameMode {
  readonly name = "beatDrop";
  /** The mode moves the ball itself: no slow-ball boost. */
  readonly ballsMayRest = true;
  /** One ball, nothing to collide with. */
  readonly ballsPassThrough = true;
  private settings: BeatDropSettings = resolveBeatDropSettings(null);
  private readonly view: BeatDropView = createView();
  private clockMs = 0;
  private stepStartMs = 0;
  private sub = 0;
  private hint = -1;
  private nextLanding = 0;
  private nextHat = 0;
  private ballId = -1;
  private readonly sample = createBallSample();
  private readonly camera = { x: 0, v: 0 };
  /** The ball's state at the previous sub-step (for the landing measurement). */
  private prevT = 0;
  private prevY = 0;
  private prevVy = 0;
  private prevG = 0;
  /** The next landing the sub-steps have not measured yet, and the measured landing times (ms) by landing. */
  private nextMeasured = 0;
  private measuredMs = new Float64Array(16);
  private readonly events: SoundEvent[] = [];

  getSettings(): BeatDropSettings {
    return this.settings;
  }
  /** The mix, drift, scroll, bounce height, anticipation and beat apply on the next init; sound, colours, trail, clip, scale and root at once. */
  setSettings(patch: Partial<BeatDropSettings>) {
    this.settings = resolveBeatDropSettings({ ...this.settings, ...patch });
    const live = this.view.settings;
    live.sound = this.settings.sound;
    live.colorMode = this.settings.colorMode;
    live.trail = this.settings.trail;
    live.scale = this.settings.scale;
    live.rootNote = this.settings.rootNote;
    if (live.clipSec !== this.settings.clipSec) {
      live.clipSec = this.settings.clipSec;
      this.updateFinish();
    }
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): BeatDropView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { landings: v.plannedLandings, landed: v.landed, plannedMs: v.finishMs, finished: v.finished, maxErrorMs: v.maxErrorMs, bpm: v.bpm };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.settings = { ...s, kinds: [...s.kinds] };
    const beat = beatDropBeatConfig(s);
    const { times, indices } = beatDropBeats(beat, 0, PLAN_HORIZON_SEC);
    v.salt = Math.floor(ctx.random() * 0x7fffffff);
    v.plan = planBeatDrop(
      { beats: times, beatIndices: indices, period: schedulePeriod(beat) || 0.5, kinds: s.kinds, drift: s.drift, scroll: s.scroll, bounceHeight: s.bounceHeight, anticipation: s.anticipation, random: () => ctx.random() },
      v.plan,
    );
    v.bpm = scheduleBpm(beat);
    v.song = followsSongGrid(beat);
    this.clockMs = 0;
    this.stepStartMs = 0;
    this.sub = 0;
    this.hint = -1;
    this.nextLanding = 0;
    this.nextHat = 0;
    this.nextMeasured = 0;
    if (this.measuredMs.length < v.plan.count) this.measuredMs = new Float64Array(v.plan.count);
    this.measuredMs.fill(NaN);
    v.timeMs = 0;
    v.landed = 0;
    v.lastLanding = -1;
    v.finished = false;
    v.finishedMs = -1;
    v.maxErrorMs = 0;
    v.logCount = 0;
    v.kicks = 0;
    v.snares = 0;
    v.hats = 0;
    v.notes = 0;
    v.downbeats = 0;
    this.updateFinish();
    layoutBeatDropField(ctx.config.width, ctx.config.height, v.field);
    this.camera.x = v.settings.scroll === "arena" ? 0 : cameraTargetAt(v.plan, 0);
    this.camera.v = 0;
    v.camY = this.camera.x;
    v.camV = 0;
    // The ball: an ordinary engine ball the mode places on the planned arc.
    sampleBall(v.plan, 0, this.sample);
    const cfg = ctx.config;
    ctx.addBall({ x: this.px(this.sample.x), y: this.py(this.sample.y), vx: 0, vy: 0, radius: cfg.ballRadius || BEAT_DROP_BALL_RADIUS, radiusScale: 1, color: cfg.ballColor || "#ffffff", gravityScale: 0 });
    this.ballId = ctx.getNextId() - 1;
    const balls = ctx.getBalls();
    const ball = balls[balls.length - 1];
    if (ball && ball.id === this.ballId) this.place(ball, 0);
    this.prevT = 0;
    this.prevY = this.sample.y;
    this.prevVy = this.sample.vy;
    this.prevG = this.sample.g;
  }

  /** The run's end: `END_HOLD_SEC` after the last landing that fits in the clip. */
  private updateFinish() {
    const v = this.view;
    const { finishSec, beats } = beatDropFinishSec(v.plan.t, v.plan.count, v.settings.clipSec);
    v.finishMs = 1000 * finishSec;
    v.plannedLandings = beats;
    v.lastLandingMs = beats > 0 ? v.finishMs - 1000 * END_HOLD_SEC : -Infinity;
  }

  private px(x: number) {
    const f = this.view.field;
    return f.cx + x * f.size;
  }
  private py(y: number) {
    const f = this.view.field;
    return f.originY + y * f.size;
  }

  /** Puts the ball on the planned arc at `t` (s): position and velocity in world px. */
  private place(ball: Ball, t: number) {
    const v = this.view;
    sampleBall(v.plan, t, this.sample, this.hint);
    if (this.sample.flight >= 0) this.hint = this.sample.flight;
    const size = v.field.size;
    ball.x = this.px(this.sample.x);
    ball.y = this.py(this.sample.y);
    ball.vx = this.sample.vx * size;
    ball.vy = this.sample.vy * size;
  }

  onPreUpdate(_ctx: ModeContext, dtMs: number) {
    this.stepStartMs = this.clockMs;
    this.clockMs += dtMs;
    this.sub = 0;
    this.view.timeMs = this.clockMs;
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    if (ball.id !== this.ballId) return;
    this.sub++;
    const t = Math.min(this.clockMs / 1000, this.stepStartMs / 1000 + this.sub * dtSec);
    // Measure the landings this sub-step crosses: the incoming arc's descent onto the pad, from the state one sub-step before.
    const plan = this.view.plan;
    let k = this.nextMeasured;
    while (k < plan.count && plan.t[k] <= t) {
      if (plan.t[k] > this.prevT) {
        const tau = descendingRoot(this.prevVy, this.prevG, plan.y[k] - this.prevY);
        if (Number.isFinite(tau)) {
          const landed = this.prevT + tau;
          this.measuredMs[k] = 1000 * landed;
          const err = Math.abs(landed - plan.t[k]) * 1000;
          if (err > this.view.maxErrorMs) this.view.maxErrorMs = err;
        }
      }
      k++;
    }
    this.nextMeasured = k;
    this.place(ball, t);
    ball.radius = ctx.config.ballRadius || BEAT_DROP_BALL_RADIUS;
    ball.radiusScale = 1;
    ball.color = ctx.config.ballColor || "#ffffff";
    this.prevT = t;
    this.prevY = this.sample.y;
    this.prevVy = this.sample.vy;
    this.prevG = this.sample.g;
  }

  onPostSubStep() {}

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const plan = v.plan;
    const s = v.settings;
    const now = this.clockMs;
    // The landings of this step (the clip's: none after its last one): counters, the log, the drum and the note, the downbeat's thump.
    while (this.nextLanding < plan.count && 1000 * plan.t[this.nextLanding] <= now + 1e-6) {
      const k = this.nextLanding++;
      if (v.finished || 1000 * plan.t[k] > v.lastLandingMs + 1e-6) continue;
      v.landed++;
      v.lastLanding = k;
      const slot = v.logCount % LANDING_LOG;
      const measured = k < this.measuredMs.length ? this.measuredMs[k] : NaN;
      v.landingMs[slot] = Number.isFinite(measured) ? measured : 1000 * plan.t[k];
      v.beatMs[slot] = 1000 * plan.t[k];
      v.logCount++;
      const kind = BEAT_DROP_KINDS[plan.kind[k]] ?? "plank";
      const downbeat = plan.downbeat[k] === 1;
      this.events.length = 0;
      landingSounds(s.sound, kind, plan.drum[k], downbeat, v.landed - 1, s.scale, s.rootNote, this.events);
      for (const ev of this.events) {
        ctx.addPendingSoundEvent(ev);
        if (ev.bdDrum === "kick") v.kicks++;
        else if (ev.bdDrum === "snare") v.snares++;
        else if (ev.bdDrum === undefined) v.notes++;
      }
      if (downbeat) {
        v.downbeats++;
        this.camera.v += DOWNBEAT_KICK;
        ctx.noteImpact?.(); // the cinematic camera's screen shake, when that feature is on
      }
    }
    // The off-beat hats (drums and both).
    while (this.nextHat < plan.count) {
      const h = plan.hatAt[this.nextHat];
      if (!Number.isNaN(h) && 1000 * h > now + 1e-6) break;
      if (!Number.isNaN(h) && !v.finished && 1000 * h < v.finishMs && s.sound !== "melody") {
        ctx.addPendingSoundEvent(hatSound());
        v.hats++;
      }
      this.nextHat++;
    }
    // The camera: critically damped toward where the ball is heading (endless), or the middle of the band (arena).
    const target = s.scroll === "arena" ? 0 : cameraTargetAt(plan, now / 1000, this.hint);
    criticallyDampedStep(this.camera, target, CAMERA_OMEGA, dtMs / 1000);
    v.camY = this.camera.x;
    v.camV = this.camera.v;
    if (!v.finished && now >= v.finishMs - 1e-6) {
      v.finished = true;
      v.finishedMs = now;
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A resize relays the view out; the plan (in view units and seconds) is untouched, so every landing stays on its beat. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    layoutBeatDropField(ctx.config.width, ctx.config.height, this.view.field);
    for (const ball of ctx.getBalls()) {
      if (ball.id !== this.ballId) continue;
      this.place(ball, this.clockMs / 1000);
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
    return true;
  }
  /** There are no rings: the obstructions are the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { landings: v.plannedLandings, landed: v.landed, finished: v.finished, maxErrorMs: v.maxErrorMs, bpm: v.bpm };
  }
}
