import { BPM_MAX, BPM_MIN, isScaleId, normalizeRootNote, type ScaleId } from "@/lib/audio/scales";
import { BeatClock, DEFAULT_BEAT_CLOCK, freshBeatSample, isUsableGrid, type BeatClockConfig, type BeatGrid } from "@/lib/simulation/beatClock";
import { beatTimeSec, firstBeatAtOrAfter, followsSongGrid, scheduleBpm, schedulePeriod } from "@/lib/simulation/beatSchedule";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { clampNumber, formatNumber, mulberry32, rhythmChord, rhythmPitch, toStep } from "./jdmRhythm";

/**
 * Beat Runner ("runner" mode, feature jdm-rhythm-runner – the project.jdm "Added realistic gravity to Geometry Dash"
 * rhythm runner). No rings: a square runs along a floor at a constant horizontal speed under a scrolling camera, and the
 * obstacles – rows of spikes, pits and blocks to jump onto and drop off – are placed ON THE BEAT of the loaded song (the
 * beat grid Picture Paint detects, lib/audio/beats.ts) or of the manual BPM: the course is planned so that a physically
 * correct jump – real, constant gravity, one fixed take-off speed – clears each obstacle and lands exactly on a beat.
 *
 * The jump solver: a jump that lands `rise` above its take-off (0 on flat ground, +1 / +2 onto a block, a drop off a
 * block falls −level from rest) flies `jumpFlightTime(v0, g, rise)` = (v0 + √(v0² − 2·g·rise)) / g seconds, so the
 * take-off time is the landing beat minus that (`takeOffSec()`); a drop leaves the edge `dropTime(g, depth)` = √(2·depth/g)
 * before its beat, which places the edge. The course builder (`buildRunnerCourse()`, pure) walks the beats: for every
 * obstacle it picks a kind (the mix), the earliest beat the jump fits (the previous landing + a short run + the flight
 * time; `density` < 1 skips a beat or two now and then, from the seed) and lays the geometry out from the times (x = speed
 * × time): spikes centred under the apex (as many as the arc clears – `runnerMaxSpikes()`), a pit between the take-off
 * and the landing, a block face the rising square clears, an edge the square runs off.
 *
 * Auto jump (the default) takes off at the planned times, so the square never fails and every landing is on a beat;
 * without it the square jumps on the Space key (`requestJump()`): a mini game. Either way the motion is real physics,
 * integrated event by event inside every engine sub-step (take-offs, edges and landings are solved analytically at their
 * exact times, so a landing on the beat is on the beat to the microsecond whatever the frame rate), and a crash – into a
 * block face, onto spikes, into a pit – restarts the section (checkpoints every `SECTION_EVENTS` obstacles) after
 * `RESPAWN_SEC`, re-timed by whole beats so the obstacles stay on the music's beat.
 *
 * Every landing plays the next note (a scale degree of the Sound section's scale – or the next melody note while a
 * melody is loaded, the ToneGenerator decides), with dust particles; the finish plays a chord and the rising arpeggio.
 * Deterministic: the course is drawn at init from `ctx.random()`; the particles use their own generator.
 */

/* ------------------------------------------------------------------ settings */

export const RUNNER_MIXES = ["mixed", "spikes", "blocks", "gaps"] as const;
export type RunnerMix = (typeof RUNNER_MIXES)[number];
export const RUNNER_BEAT_SOURCES = ["song", "bpm"] as const;
export type RunnerBeatSource = (typeof RUNNER_BEAT_SOURCES)[number];

export function isRunnerMix(value: unknown): value is RunnerMix {
  return typeof value === "string" && (RUNNER_MIXES as readonly string[]).includes(value);
}
export function isRunnerBeatSource(value: unknown): value is RunnerBeatSource {
  return typeof value === "string" && (RUNNER_BEAT_SOURCES as readonly string[]).includes(value);
}

export interface RunnerSettings {
  /** The square jumps by itself at the planned times (never fails); off = Space jumps. */
  autoJump: boolean;
  /** Obstacles on the course, 4–120. */
  obstacles: number;
  /** Horizontal speed in cube lengths per second, 6–16. */
  speed: number;
  /** Jump height in cube lengths, 1.8–4 (the take-off speed follows from it and the gravity). */
  jumpHeight: number;
  /** 0–1: how often an obstacle takes the earliest beat it fits (1 = always; lower leaves a beat or two free now and then). */
  density: number;
  /** Which obstacles: mixed, spikes only, blocks (step up and drop off) or gaps (pits). */
  mix: RunnerMix;
  /** Follow the loaded song's detected beat ("song", the manual BPM while there is none) or the manual BPM ("bpm"). */
  beatSource: RunnerBeatSource;
  /** The Sound section's BPM (the manual tempo). */
  bpm: number;
  /** The detected beat grid of the loaded song (music bed or song slicer), its start offset and loop – null without one. */
  grid: BeatGrid | null;
  offset: number;
  loop: boolean;
  /** The Sound section's scale and root: the landing notes climb its degrees. */
  scale: ScaleId;
  rootNote: number;
}

export const DEFAULT_RUNNER_SETTINGS: RunnerSettings = {
  autoJump: true,
  obstacles: 24,
  speed: 9,
  jumpHeight: 2.6,
  density: 0.6,
  mix: "mixed",
  beatSource: "song",
  bpm: 120,
  grid: null,
  offset: 0,
  loop: true,
  scale: "chromatic",
  rootNote: 0,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const RUNNER_RANGES = {
  runnerObstacles: { min: 4, max: 120, step: 1 },
  runnerSpeed: { min: 6, max: 16, step: 0.5 },
  runnerJump: { min: 1.8, max: 4, step: 0.1 },
  runnerDensity: { min: 0, max: 1, step: 0.05 },
} as const;

/** The Beat Runner fields of the SimulatorSettings object (URL keys rra, rrn, rrsp, rrj, rrd, rrm, rrbs). */
export interface RunnerFields {
  runnerAutoJump: boolean;
  runnerObstacles: number;
  runnerSpeed: number;
  runnerJump: number;
  runnerDensity: number;
  runnerMix: RunnerMix;
  runnerBeatSource: RunnerBeatSource;
}

/** Fills in the defaults and clamps every value to its range and step; unknown options fall back to the defaults. */
export function resolveRunnerSettings(config: Partial<RunnerSettings> | null | undefined): RunnerSettings {
  const out: RunnerSettings = { ...DEFAULT_RUNNER_SETTINGS };
  if (!config) return out;
  const R = RUNNER_RANGES;
  if (typeof config.autoJump === "boolean") out.autoJump = config.autoJump;
  if (config.obstacles !== undefined) out.obstacles = Math.round(clampNumber(config.obstacles, R.runnerObstacles, out.obstacles));
  if (config.speed !== undefined) out.speed = toStep(clampNumber(config.speed, R.runnerSpeed, out.speed), R.runnerSpeed.step);
  if (config.jumpHeight !== undefined) out.jumpHeight = toStep(clampNumber(config.jumpHeight, R.runnerJump, out.jumpHeight), R.runnerJump.step);
  if (config.density !== undefined) out.density = toStep(clampNumber(config.density, R.runnerDensity, out.density), R.runnerDensity.step);
  if (isRunnerMix(config.mix)) out.mix = config.mix;
  if (isRunnerBeatSource(config.beatSource)) out.beatSource = config.beatSource;
  if (config.bpm !== undefined) out.bpm = clampNumber(config.bpm, { min: BPM_MIN, max: BPM_MAX }, out.bpm);
  if (config.grid !== undefined) out.grid = isUsableGrid(config.grid) ? config.grid : null;
  if (config.offset !== undefined) out.offset = Math.max(0, clampNumber(config.offset, { min: 0, max: 1e6 }, 0));
  if (typeof config.loop === "boolean") out.loop = config.loop;
  if (isScaleId(config.scale)) out.scale = config.scale;
  if (config.rootNote !== undefined) out.rootNote = normalizeRootNote(config.rootNote);
  return out;
}

/** The loaded song's beat grid as the runner follows it (Simulator.tsx hands the music bed's or the slicer's in). */
export interface RunnerBeatInput {
  grid: BeatGrid | null;
  offset: number;
  loop: boolean;
}

/** Picks the Beat Runner settings (and the Sound section's BPM, scale and root, and the song's beat grid) out of the page's settings. */
export function runnerSettingsOf(source: RunnerFields & { bpm?: number; scale?: ScaleId; rootNote?: number }, beat?: RunnerBeatInput | null): RunnerSettings {
  return {
    autoJump: source.runnerAutoJump,
    obstacles: source.runnerObstacles,
    speed: source.runnerSpeed,
    jumpHeight: source.runnerJump,
    density: source.runnerDensity,
    mix: source.runnerMix,
    beatSource: source.runnerBeatSource,
    bpm: source.bpm ?? DEFAULT_RUNNER_SETTINGS.bpm,
    grid: beat?.grid ?? null,
    offset: beat?.offset ?? 0,
    loop: beat?.loop ?? true,
    scale: source.scale ?? DEFAULT_RUNNER_SETTINGS.scale,
    rootNote: source.rootNote ?? DEFAULT_RUNNER_SETTINGS.rootNote,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function runnerSettingFields(settings: RunnerSettings): RunnerFields {
  return {
    runnerAutoJump: settings.autoJump,
    runnerObstacles: settings.obstacles,
    runnerSpeed: settings.speed,
    runnerJump: settings.jumpHeight,
    runnerDensity: settings.density,
    runnerMix: settings.mix,
    runnerBeatSource: settings.beatSource,
  };
}

export function defaultRunnerFields(): RunnerFields {
  return runnerSettingFields(DEFAULT_RUNNER_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike): clamped numbers, known options, real booleans. */
export function resolveRunnerFields(source: Partial<RunnerFields>): RunnerFields {
  return runnerSettingFields(
    resolveRunnerSettings({
      autoJump: source.runnerAutoJump,
      obstacles: source.runnerObstacles,
      speed: source.runnerSpeed,
      jumpHeight: source.runnerJump,
      density: source.runnerDensity,
      mix: source.runnerMix,
      beatSource: source.runnerBeatSource,
    }),
  );
}

const RUNNER_NUMERIC_KEYS = { rrn: "runnerObstacles", rrsp: "runnerSpeed", rrj: "runnerJump", rrd: "runnerDensity" } as const;

/** Writes the fields that differ from `base` into the URL: rra, rrn, rrsp, rrj, rrd, rrm and rrbs. */
export function writeRunnerParams(settings: RunnerFields, base: RunnerFields, params: URLSearchParams) {
  if (settings.runnerAutoJump !== base.runnerAutoJump) params.set("rra", settings.runnerAutoJump ? "1" : "0");
  for (const [key, field] of Object.entries(RUNNER_NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.runnerMix !== base.runnerMix) params.set("rrm", settings.runnerMix);
  if (settings.runnerBeatSource !== base.runnerBeatSource) params.set("rrbs", settings.runnerBeatSource);
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readRunnerParams(params: URLSearchParams, settings: RunnerFields) {
  const next: Partial<RunnerFields> = { ...settings };
  const auto = params.get("rra");
  if (auto === "1") next.runnerAutoJump = true;
  else if (auto === "0") next.runnerAutoJump = false;
  for (const [key, field] of Object.entries(RUNNER_NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  const mix = params.get("rrm");
  if (isRunnerMix(mix)) next.runnerMix = mix;
  const source = params.get("rrbs");
  if (isRunnerBeatSource(source)) next.runnerBeatSource = source;
  Object.assign(settings, resolveRunnerFields(next));
}

/** The beat clock configuration the course follows: the song grid while the source is "song" and one is loaded, else the BPM. */
export function runnerBeatConfig(settings: Pick<RunnerSettings, "beatSource" | "bpm" | "grid" | "offset" | "loop">): BeatClockConfig {
  const song = settings.beatSource === "song" && isUsableGrid(settings.grid);
  return {
    ...DEFAULT_BEAT_CLOCK,
    source: song ? "song" : "bpm",
    grid: song ? settings.grid : null,
    manualBpm: clampNumber(settings.bpm, { min: BPM_MIN, max: BPM_MAX }, DEFAULT_RUNNER_SETTINGS.bpm),
    offset: song ? Math.max(0, settings.offset) : 0,
    loop: song ? settings.loop : true,
  };
}

/* ------------------------------------------------------------------ physics and the jump solver */

/** Gravity in cube lengths per s² at the default Gravity setting (300); the setting scales it 0.5×–2×. */
export const RUNNER_GRAVITY = 72;
/** The highest block level (in cube lengths above the floor). */
export const MAX_LEVEL = 2;

export interface RunnerPhysics {
  /** Gravity (cubes/s²). */
  gravity: number;
  /** Take-off speed (cubes/s), from the jump height: √(2·g·H). */
  jumpSpeed: number;
  jumpHeight: number;
  /** Horizontal speed (cubes/s). */
  speed: number;
  /** Flight time of a jump on flat ground: 2·v0 / g. */
  flatFlight: number;
}

/** The gravity factor of the Gravity setting (300 → 1), clamped to 0.5–2 (0 still falls). */
export function runnerGravityFactor(gravitySetting: number): number {
  return Number.isFinite(gravitySetting) ? Math.max(0.5, Math.min(2, gravitySetting / 300)) : 1;
}

export function runnerPhysics(settings: Pick<RunnerSettings, "speed" | "jumpHeight">, gravitySetting: number): RunnerPhysics {
  const g = RUNNER_GRAVITY * runnerGravityFactor(gravitySetting);
  const H = Math.max(0.5, settings.jumpHeight);
  const v0 = Math.sqrt(2 * g * H);
  return { gravity: g, jumpSpeed: v0, jumpHeight: H, speed: Math.max(0.5, settings.speed), flatFlight: (2 * v0) / g };
}

/**
 * Flight time (s) of a jump at take-off speed `jumpSpeed` under `gravity` that lands `rise` cube lengths above its
 * take-off (0 on flat ground, negative below it): the descending root of v0·t − g·t²/2 = rise. NaN when it cannot reach.
 */
export function jumpFlightTime(jumpSpeed: number, gravity: number, rise: number): number {
  const disc = jumpSpeed * jumpSpeed - 2 * gravity * rise;
  if (!(gravity > 0) || disc < 0) return NaN;
  return (jumpSpeed + Math.sqrt(disc)) / gravity;
}

/** When to take off so that the jump lands exactly at `landSec` (the jump-timing solver). */
export function takeOffSec(landSec: number, jumpSpeed: number, gravity: number, rise = 0): number {
  return landSec - jumpFlightTime(jumpSpeed, gravity, rise);
}

/** When the rising jump passes `height` above its take-off (the ascending root); NaN when it never gets there. */
export function ascendTime(jumpSpeed: number, gravity: number, height: number): number {
  const disc = jumpSpeed * jumpSpeed - 2 * gravity * height;
  if (!(gravity > 0) || disc < 0) return NaN;
  return (jumpSpeed - Math.sqrt(disc)) / gravity;
}

/** Height above the take-off `s` seconds into a jump. */
export function jumpHeightAt(jumpSpeed: number, gravity: number, s: number): number {
  return jumpSpeed * s - 0.5 * gravity * s * s;
}

/** Time (s) to fall `depth` cube lengths from rest (running off an edge). */
export function dropTime(gravity: number, depth: number): number {
  return gravity > 0 ? Math.sqrt((2 * Math.max(0, depth)) / gravity) : NaN;
}

/* ------------------------------------------------------------------ the course */

/** Seconds of running before the first take-off. */
export const LEAD_IN_SEC = 1;
/** Seconds of running at least between a landing and the next take-off (or the next edge). */
export const MIN_RUN_SEC = 0.14;
/** Clearance (cube lengths) between the square and a pit's edges at the take-off and the landing. */
export const GAP_MARGIN = 0.15;
/** A pit narrower than this is not worth a pit: the event becomes spikes. */
export const MIN_GAP = 1.2;
/** Clearance between the rising square and a block's top corner. */
export const FACE_MARGIN = 0.1;
/** The square's hitbox is inset by this much on every side (Geometry Dash-style forgiving edges). */
export const CUBE_PAD = 0.08;
/** A spike's hitbox: half its width and its height (the triangle drawn is 1 × 1). */
export const SPIKE_HALF_W = 0.18;
export const SPIKE_HIT_H = 0.62;
/** The arc must clear a spike's hitbox by at least this much. */
export const SPIKE_CLEARANCE = 0.08;
/** Obstacles per section: a crash restarts the section at its checkpoint. */
export const SECTION_EVENTS = 5;
/** Seconds after a crash before the square is back at the checkpoint (rounded up to a whole beat). */
export const RESPAWN_SEC = 1;
/** A Space press counts this long before a landing (jump buffering). */
export const JUMP_BUFFER_SEC = 0.12;
/** Seconds of running from the last landing to the finish line, and of celebration after it. */
export const FINISH_RUN_SEC = 1;
export const FINISH_HOLD_SEC = 1.6;
/** Below this height the square has fallen into a pit for good. */
export const PIT_DEATH_Y = -1.4;
/** Floor laid behind the start (cube lengths), so the first frames have ground under the camera. */
const FLOOR_BEHIND = 40;
/** Floor laid past the finish line (the square runs on after it until the end screen). */
const FLOOR_AFTER = 400;

export type RunnerEventKind = "spikes" | "gap" | "up" | "drop" | "hop";

export interface RunnerEvent {
  kind: RunnerEventKind;
  /** Beat index of the landing (numbered like `BeatClock.sample().index`). */
  beat: number;
  /** Track time (s) of the landing – a beat – and of the take-off (the square leaving the edge, for a drop). */
  landSec: number;
  startSec: number;
  fromLevel: number;
  toLevel: number;
  /** Spikes in the row (spikes events). */
  count: number;
  /** The obstacle's span along the track (the spike row, the pit, the block face at x0 / the edge at x1). */
  x0: number;
  x1: number;
  /** Where the landing is (the square's centre, cube lengths). */
  landX: number;
  /** Scale degree of the landing note. */
  degree: number;
  section: number;
}

export interface RunnerSpan {
  x0: number;
  x1: number;
}
export interface RunnerBlock extends RunnerSpan {
  /** Height of the block's top above the floor (1 or 2). */
  top: number;
}
export interface RunnerSpike {
  /** Centre of the spike and the level its base stands on. */
  x: number;
  base: number;
}
export interface RunnerCheckpoint {
  /** Track time and place of the checkpoint, its level and the first obstacle of its section. */
  sec: number;
  x: number;
  level: number;
  event: number;
}

export interface RunnerCourse {
  events: RunnerEvent[];
  /** Floor pieces (pits between them), sorted and disjoint. */
  floors: RunnerSpan[];
  /** Blocks (pillars from the floor up to their top), sorted and disjoint. */
  blocks: RunnerBlock[];
  /** Spikes, sorted by x. */
  spikes: RunnerSpike[];
  checkpoints: RunnerCheckpoint[];
  finishX: number;
  /** Track time the square crosses the finish line, and when the run is over (after the celebration). */
  finishSec: number;
  endSec: number;
  physics: RunnerPhysics;
  /** The tempo followed, its period and whether it is a song's grid. */
  bpm: number;
  period: number;
  song: boolean;
}

/** The melody contour of the landings: scale degrees for landing k (the level lifts it). */
const DEGREE_CONTOUR = [0, 2, 4, 7, 4, 2, 5, 9, 7, 4, 2, 4, 7, 11, 9, 7];

/** Scale degree of landing `k` at block `level`. */
export function runnerDegree(k: number, level: number): number {
  const i = ((Math.round(k) % DEGREE_CONTOUR.length) + DEGREE_CONTOUR.length) % DEGREE_CONTOUR.length;
  return DEGREE_CONTOUR[i] + 2 * Math.max(0, Math.round(level));
}

/** Most spikes (0–3) one jump on flat ground clears with the hitbox margins, centred under the apex. */
export function runnerMaxSpikes(phys: RunnerPhysics): number {
  const L = phys.speed * phys.flatFlight;
  for (let n = 3; n >= 1; n--) {
    const w = (n - 1) / 2 + SPIKE_HALF_W + 0.5 - CUBE_PAD;
    const rel = 2 * w >= L ? -Infinity : phys.jumpHeight * (1 - ((2 * w) / L) ** 2);
    if (rel + CUBE_PAD - SPIKE_HIT_H >= SPIKE_CLEARANCE) return n;
  }
  return 0;
}

/** True when a jump can rise `rise` onto a block and clear its corner with the margins. */
export function runnerCanStepUp(phys: RunnerPhysics, rise: number): boolean {
  if (phys.jumpHeight < rise + 0.3) return false;
  const T = jumpFlightTime(phys.jumpSpeed, phys.gravity, rise);
  const up = ascendTime(phys.jumpSpeed, phys.gravity, rise);
  if (!Number.isFinite(T) || !Number.isFinite(up)) return false;
  return phys.speed * (T - up) >= 1 + FACE_MARGIN + 0.1;
}

function pickKind(mix: RunnerMix, level: number, u: number, up1: boolean): RunnerEventKind {
  const canUp = level < MAX_LEVEL && up1;
  if (mix === "spikes") return level > 0 ? "drop" : "spikes";
  if (mix === "gaps") return "gap";
  if (mix === "blocks") {
    if (level === 0) return canUp ? "up" : "spikes";
    if (u < 0.4) return "drop";
    if (u < 0.7) return canUp ? "up" : "drop";
    return "spikes";
  }
  if (level === 0) {
    if (u < 0.42) return "spikes";
    if (u < 0.7) return "gap";
    return canUp ? "up" : "spikes";
  }
  if (u < 0.4) return "drop";
  if (u < 0.68) return "spikes";
  if (u < 0.82) return "gap";
  return canUp ? "up" : "drop";
}

/**
 * Plans the whole course (pure; `random` is the engine's generator – four draws per obstacle whatever it becomes, so one
 * obstacle never shifts the next one's). Times are track seconds from the start, positions cube lengths from the start
 * (x = speed × time); every landing is a beat of the schedule.
 */
export function buildRunnerCourse(input: Partial<RunnerSettings>, gravitySetting: number, random: () => number): RunnerCourse {
  const settings = resolveRunnerSettings(input);
  const phys = runnerPhysics(settings, gravitySetting);
  const beat = runnerBeatConfig(settings);
  const { speed: v, jumpSpeed: v0, gravity: g, flatFlight: Tf } = phys;
  const maxSpikes = runnerMaxSpikes(phys);
  const up1 = runnerCanStepUp(phys, 1);
  const up2 = runnerCanStepUp(phys, 2);
  const events: RunnerEvent[] = [];
  const floors: RunnerSpan[] = [];
  const blocks: RunnerBlock[] = [];
  const spikes: RunnerSpike[] = [];
  const checkpoints: RunnerCheckpoint[] = [{ sec: 0, x: 0, level: 0, event: 0 }];
  let level = 0;
  let floorStart = -FLOOR_BEHIND;
  let blockStart = 0;
  let prevLand = 0;
  const period = schedulePeriod(beat) || 0.5;
  for (let k = 0; k < settings.obstacles || level > 0; k++) {
    const uKind = random();
    const uBeat = random();
    const uCount = random();
    const uHeight = random();
    let kind: RunnerEventKind = k >= settings.obstacles ? "drop" : pickKind(settings.mix, level, uKind, up1);
    let rise = 0;
    if (kind === "up") {
      rise = level === 0 && uHeight < 0.3 && up2 ? 2 : 1;
      if (level + rise > MAX_LEVEL) kind = level > 0 ? "drop" : "spikes";
    }
    let count = 0;
    if (kind === "spikes") {
      count = maxSpikes > 0 ? Math.min(maxSpikes, 1 + Math.floor(uCount * maxSpikes)) : 0;
      if (count === 0) kind = "hop";
    }
    const air = kind === "up" ? jumpFlightTime(v0, g, rise) : kind === "drop" ? dropTime(g, level) : Tf;
    const earliest = (k === 0 ? LEAD_IN_SEC : prevLand + MIN_RUN_SEC) + air;
    let j = firstBeatAtOrAfter(beat, earliest);
    if (j < 0) j = Math.ceil(earliest / period);
    const extra = uBeat < settings.density ? 0 : uBeat < settings.density + 0.65 * (1 - settings.density) ? 1 : 2;
    j += extra;
    let land = beatTimeSec(beat, j);
    if (!Number.isFinite(land)) land = j * period;
    const start = land - air;
    const xs = v * start;
    const xl = v * land;
    let x0 = xs;
    let x1 = xl;
    const fromLevel = level;
    if (kind === "gap") {
      const a = xs + 0.5 + GAP_MARGIN;
      const b = xl - 0.5 - GAP_MARGIN;
      if (b - a < MIN_GAP) {
        kind = maxSpikes > 0 ? "spikes" : "hop";
        count = maxSpikes > 0 ? 1 : 0;
      } else {
        if (level === 0) {
          floors.push({ x0: floorStart, x1: a });
          floorStart = b;
        } else {
          blocks.push({ x0: blockStart, x1: a, top: level });
          blockStart = b;
        }
        x0 = a;
        x1 = b;
      }
    }
    if (kind === "spikes") {
      const apex = 0.5 * (xs + xl);
      for (let i = 0; i < count; i++) spikes.push({ x: apex + (i - (count - 1) / 2), base: level });
      x0 = apex - count / 2;
      x1 = apex + count / 2;
    } else if (kind === "up") {
      const xUp = v * (start + ascendTime(v0, g, rise));
      const face = Math.max(xUp + 0.5 + FACE_MARGIN, Math.min(xl - 0.5, xl - 1.1));
      if (level > 0) blocks.push({ x0: blockStart, x1: face, top: level });
      blockStart = face;
      level += rise;
      x0 = face;
      x1 = xl;
    } else if (kind === "drop") {
      const edge = xs - 0.5;
      blocks.push({ x0: blockStart, x1: edge, top: level });
      level = 0;
      x0 = edge;
      x1 = xl;
    }
    const index = events.length;
    events.push({ kind, beat: j, landSec: land, startSec: start, fromLevel, toLevel: level, count, x0, x1, landX: xl, degree: runnerDegree(index, level), section: Math.floor(index / SECTION_EVENTS) });
    prevLand = land;
    if ((index + 1) % SECTION_EVENTS === 0) {
      const sec = land + 0.5 * MIN_RUN_SEC;
      checkpoints.push({ sec, x: v * sec, level, event: index + 1 });
    }
  }
  // A checkpoint right after the last obstacle is pointless (nothing left to restart).
  if (checkpoints.length > 1 && checkpoints[checkpoints.length - 1].event >= events.length) checkpoints.pop();
  const finishSec = prevLand + FINISH_RUN_SEC;
  const finishX = v * finishSec;
  floors.push({ x0: floorStart, x1: finishX + FLOOR_AFTER });
  return {
    events,
    floors,
    blocks,
    spikes,
    checkpoints,
    finishX,
    finishSec,
    endSec: finishSec + FINISH_HOLD_SEC,
    physics: phys,
    bpm: scheduleBpm(beat),
    period: schedulePeriod(beat),
    song: followsSongGrid(beat),
  };
}

/** The fixed 60 Hz step at which a run of this length finishes, as the engine's clock reads it (ms). */
export function runnerFinishStepMs(endSec: number, stepMs = 1000 / 60): number {
  return Math.ceil((1000 * endSec - 1e-6) / stepMs) * stepMs;
}

/* ------------------------------------------------------------------ course queries (pure) */

function overlaps(s: RunnerSpan, a: number, b: number): boolean {
  return s.x0 < b && s.x1 > a;
}

/** True when a square spanning [a, b] stands on something at `level` (a floor piece at 0, a block whose top is `level`). */
export function runnerSupported(course: RunnerCourse, level: number, a: number, b: number): boolean {
  if (level === 0) {
    for (const f of course.floors) if (overlaps(f, a, b)) return true;
    return false;
  }
  for (const bl of course.blocks) if (bl.top === level && overlaps(bl, a, b)) return true;
  return false;
}

/** The end of the surface at `level` under a square centred at `x`: the square falls once its back edge passes it. */
export function runnerSupportEnd(course: RunnerCourse, level: number, x: number): number {
  let end = -Infinity;
  const a = x - 0.5;
  const b = x + 0.5;
  if (level === 0) {
    for (const f of course.floors) if (overlaps(f, a, b) && f.x1 > end) end = f.x1;
  } else {
    for (const bl of course.blocks) if (bl.top === level && overlaps(bl, a, b) && bl.x1 > end) end = bl.x1;
  }
  return end;
}

/** True when the square's hitbox (bottom at `y`) is inside a block, a pit wall or a spike. */
export function runnerCollides(course: RunnerCourse, x: number, y: number): boolean {
  const a = x - 0.5 + CUBE_PAD;
  const b = x + 0.5 - CUBE_PAD;
  const bottom = y + CUBE_PAD;
  const top = y + 1 - CUBE_PAD;
  for (const bl of course.blocks) if (bl.x0 < b && bl.x1 > a && bottom < bl.top) return true;
  // A pit's far wall: floor ahead while the square is below the floor.
  if (bottom < 0) for (const f of course.floors) if (f.x0 < b && f.x1 > a) return true;
  for (const s of course.spikes) {
    if (s.x + SPIKE_HALF_W <= a) continue;
    if (s.x - SPIKE_HALF_W >= b) break;
    if (bottom < s.base + SPIKE_HIT_H && top > s.base) return true;
  }
  return false;
}

/**
 * The first moment (track seconds, ≥ `tau0`) at which a square running on `level` from `tau0` hits a block face or spikes
 * ahead of it (Infinity when nothing is in the way before `tau1`).
 */
export function runnerFrontHitSec(course: RunnerCourse, level: number, tau0: number, tau1: number): number {
  const v = course.physics.speed;
  const front0 = v * tau0 + 0.5 - CUBE_PAD;
  const front1 = v * tau1 + 0.5 - CUBE_PAD;
  let hit = Infinity;
  for (const bl of course.blocks) {
    if (bl.top <= level + 1e-9) continue;
    if (bl.x0 < front0 - 1e-9 || bl.x0 > front1) continue;
    hit = Math.min(hit, (bl.x0 - 0.5 + CUBE_PAD) / v);
  }
  for (const s of course.spikes) {
    if (s.base !== level) continue;
    const left = s.x - SPIKE_HALF_W;
    if (left > front1) break;
    if (left < front0 - 1e-9 || s.x + SPIKE_HALF_W <= v * tau0 - 0.5 + CUBE_PAD) continue;
    hit = Math.min(hit, (left - 0.5 + CUBE_PAD) / v);
  }
  return hit;
}

/* ------------------------------------------------------------------ layout */

/** The recorder's square is this many cube lengths wide. */
export const VIEW_UNITS = 16;
/** Where the square runs on screen: this fraction of the view from its left edge. */
export const CAMERA_AT = 0.3;
/** The floor line: this fraction of the view from its top. */
export const FLOOR_AT = 0.68;

export interface RunnerField {
  /** The centred square the recorder crops to (px). */
  left: number;
  top: number;
  size: number;
  /** Pixels per cube length. */
  unit: number;
  /** Screen y of the floor line (px). */
  floorY: number;
  width: number;
  height: number;
}

export function buildRunnerField(width: number, height: number, out?: RunnerField): RunnerField {
  const size = Math.max(60, Math.min(width, height));
  const f = out ?? ({} as RunnerField);
  f.left = (width - size) / 2;
  f.top = (height - size) / 2;
  f.size = size;
  f.unit = size / VIEW_UNITS;
  f.floorY = f.top + FLOOR_AT * size;
  f.width = width;
  f.height = height;
  return f;
}

/* ------------------------------------------------------------------ the view */

/** Particles alive at once (the oldest make room). */
export const MAX_RR_PARTICLES = 240;
/** Particle gravity (cubes/s²). */
export const RR_PARTICLE_GRAVITY = 30;
/** Trail samples of the square (one per step). */
export const RR_TRAIL = 14;

/** What the canvas needs to draw the course; the same object every call. */
export interface RunnerView {
  settings: RunnerSettings;
  course: RunnerCourse;
  field: RunnerField;
  /** Simulation and track time (s) at the end of the last step. */
  timeSec: number;
  trackSec: number;
  /** The square: centre x and bottom y (cube lengths), rotation (rad), state. */
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  grounded: boolean;
  level: number;
  /** Left edge of the view (cube lengths). */
  camX: number;
  auto: boolean;
  /** The beat followed: tempo, the latest beat's index and the pulse (1 on a beat, decaying). */
  bpm: number;
  beatIndex: number;
  beatPulse: number;
  landings: number;
  /** Landings that fell on a beat of the schedule (within 3 ms). */
  onBeat: number;
  jumps: number;
  /** Obstacles passed in the current attempt (the progress). */
  cleared: number;
  deaths: number;
  attempt: number;
  lastLandSec: number;
  lastLandX: number;
  lastLandLevel: number;
  /** The event each landing lit (the beat markers light up), −1 when the landing was off the plan. */
  lastLandEvent: number;
  deathSec: number;
  deathX: number;
  deathY: number;
  respawnSec: number;
  /** The checkpoint of the current attempt (index into course.checkpoints). */
  checkpoint: number;
  crossed: boolean;
  crossSec: number;
  finished: boolean;
  /** The last trail samples (x, y, angle), newest at `trailHead − 1`. */
  trailX: Float32Array;
  trailY: Float32Array;
  trailA: Float32Array;
  trailCount: number;
  trailHead: number;
  /** Analytic particles (course coordinates; cube lengths and seconds of simulation time). */
  partX: Float32Array;
  partY: Float32Array;
  partVx: Float32Array;
  partVy: Float32Array;
  partT0: Float64Array;
  partLife: Float32Array;
  partSize: Float32Array;
  /** 0 = landing dust, 1 = crash debris, 2 = finish spark. */
  partKind: Uint8Array;
  partNext: number;
  partSpawned: number;
}

function createView(): RunnerView {
  const settings = { ...DEFAULT_RUNNER_SETTINGS };
  return {
    settings,
    course: buildRunnerCourse(settings, 300, () => 0.5),
    field: buildRunnerField(800, 600),
    timeSec: 0,
    trackSec: 0,
    x: 0,
    y: 0,
    angle: 0,
    alive: true,
    grounded: true,
    level: 0,
    camX: -CAMERA_AT * VIEW_UNITS,
    auto: true,
    bpm: 120,
    beatIndex: -1,
    beatPulse: 0,
    landings: 0,
    onBeat: 0,
    jumps: 0,
    cleared: 0,
    deaths: 0,
    attempt: 1,
    lastLandSec: -Infinity,
    lastLandX: 0,
    lastLandLevel: 0,
    lastLandEvent: -1,
    deathSec: -Infinity,
    deathX: 0,
    deathY: 0,
    respawnSec: Infinity,
    checkpoint: 0,
    crossed: false,
    crossSec: -Infinity,
    finished: false,
    trailX: new Float32Array(RR_TRAIL),
    trailY: new Float32Array(RR_TRAIL),
    trailA: new Float32Array(RR_TRAIL),
    trailCount: 0,
    trailHead: 0,
    partX: new Float32Array(MAX_RR_PARTICLES),
    partY: new Float32Array(MAX_RR_PARTICLES),
    partVx: new Float32Array(MAX_RR_PARTICLES),
    partVy: new Float32Array(MAX_RR_PARTICLES),
    partT0: new Float64Array(MAX_RR_PARTICLES).fill(-Infinity),
    partLife: new Float32Array(MAX_RR_PARTICLES),
    partSize: new Float32Array(MAX_RR_PARTICLES),
    partKind: new Uint8Array(MAX_RR_PARTICLES),
    partNext: 0,
    partSpawned: 0,
  };
}

/** Landings within this of a beat count as on the beat. */
export const ON_BEAT_TOLERANCE_SEC = 0.003;

/* ------------------------------------------------------------------ the mode */

export class RunnerMode implements GameMode {
  readonly name = "runner";
  /** The mode moves the square itself: no slow-ball boost. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: RunnerSettings = { ...DEFAULT_RUNNER_SETTINGS };
  private readonly view: RunnerView = createView();
  private readonly clock = new BeatClock();
  private readonly beatSample = freshBeatSample();
  private ballId = -1;
  private clockMs = 0;
  private stepStartSec = 0;
  private sub = 0;
  /** Simulation seconds minus track seconds (0 in auto; whole beats after a restarted section). */
  private shift = 0;
  /** Airborne motion: y(τ) = airY0 + airVy0·s − g·s²/2 with s = τ − airStart; the rotation rate of the flight. */
  private airStart = 0;
  private airY0 = 0;
  private airVy0 = 0;
  private spinRate = 0;
  private baseAngle = 0;
  /** The next event whose take-off auto jump still has to do. */
  private nextJump = 0;
  /** Landings since the attempt started (the note counter). */
  private noteIndex = 0;
  /** Simulation time of the last Space press (manual). */
  private jumpQueuedAt = -Infinity;
  private fx: () => number = mulberry32(1);
  private gravity = 300;
  private sizeW = 0;
  private sizeH = 0;
  private deathCamX = 0;

  getSettings(): RunnerSettings {
    return this.settings;
  }
  /** Everything applies on the next init (the course is planned for it) except the scale and the root (live). */
  setSettings(patch: Partial<RunnerSettings>) {
    this.settings = resolveRunnerSettings({ ...this.settings, ...patch });
    this.view.settings.scale = this.settings.scale;
    this.view.settings.rootNote = this.settings.rootNote;
  }
  getView(): RunnerView {
    return this.view;
  }
  getCourse(): RunnerCourse {
    return this.view.course;
  }
  getProgress() {
    const v = this.view;
    return {
      events: v.course.events.length,
      cleared: v.cleared,
      landings: v.landings,
      onBeat: v.onBeat,
      jumps: v.jumps,
      deaths: v.deaths,
      attempt: v.attempt,
      auto: v.auto,
      crossed: v.crossed,
      finished: v.finished,
      bpm: v.bpm,
      /** When an auto run finishes on the engine's 60 Hz clock (the finder's duration); manual runs have no plan. */
      plannedMs: runnerFinishStepMs(v.course.endSec),
    };
  }

  /** Space (manual mode): the square jumps at the next sub-step if it stands on something, or on landing within `JUMP_BUFFER_SEC`. */
  requestJump(atMs: number) {
    if (this.settings.autoJump) return;
    this.jumpQueuedAt = atMs / 1000;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    this.gravity = ctx.config.gravity;
    const course = buildRunnerCourse(s, this.gravity, () => ctx.random());
    this.fx = mulberry32(Math.floor(ctx.random() * 0x7fffffff) + 1);
    this.clock.setConfig(runnerBeatConfig(s));
    this.clockMs = 0;
    this.stepStartSec = 0;
    this.sub = 0;
    this.shift = 0;
    this.airStart = 0;
    this.airY0 = 0;
    this.airVy0 = 0;
    this.spinRate = 0;
    this.baseAngle = 0;
    this.nextJump = 0;
    this.noteIndex = 0;
    this.jumpQueuedAt = -Infinity;
    const v = this.view;
    v.settings = { ...s };
    v.course = course;
    v.timeSec = 0;
    v.trackSec = 0;
    v.x = 0;
    v.y = 0;
    v.angle = 0;
    v.alive = true;
    v.grounded = true;
    v.level = 0;
    v.camX = -CAMERA_AT * VIEW_UNITS;
    v.auto = s.autoJump;
    v.bpm = course.bpm;
    v.beatIndex = -1;
    v.beatPulse = 0;
    v.landings = 0;
    v.onBeat = 0;
    v.jumps = 0;
    v.cleared = 0;
    v.deaths = 0;
    v.attempt = 1;
    v.lastLandSec = -Infinity;
    v.lastLandX = 0;
    v.lastLandLevel = 0;
    v.lastLandEvent = -1;
    v.deathSec = -Infinity;
    v.deathX = 0;
    v.deathY = 0;
    v.respawnSec = Infinity;
    v.checkpoint = 0;
    v.crossed = false;
    v.crossSec = -Infinity;
    v.finished = false;
    v.trailCount = 0;
    v.trailHead = 0;
    v.partT0.fill(-Infinity);
    v.partNext = 0;
    v.partSpawned = 0;
    this.sizeW = 0;
    this.refreshField(ctx.config.width, ctx.config.height);
    const f = v.field;
    ctx.addBall({ x: f.left + (v.x - v.camX) * f.unit, y: f.floorY - 0.5 * f.unit, vx: 0, vy: 0, radius: 0.5 * f.unit, color: ctx.config.ballColor || "#FFFFFF", gravityScale: 0 });
    this.ballId = ctx.getNextId() - 1;
    this.skipDropsFrom(0);
    const ball = this.findBall(ctx);
    if (ball) this.place(ball);
  }

  private refreshField(width: number, height: number) {
    if (width === this.sizeW && height === this.sizeH) return;
    this.sizeW = width;
    this.sizeH = height;
    buildRunnerField(width, height, this.view.field);
  }

  private findBall(ctx: ModeContext): Ball | null {
    for (const b of ctx.getBalls()) if (b.id === this.ballId) return b;
    return null;
  }

  /** Puts the engine ball on the square (world pixels: the camera scrolls the canvas). */
  private place(ball: Ball) {
    const v = this.view;
    const f = v.field;
    ball.radius = 0.5 * f.unit;
    ball.x = f.left + v.x * f.unit;
    ball.y = f.floorY - (v.y + 0.5) * f.unit;
    ball.vx = v.alive ? v.course.physics.speed * f.unit : 0;
    ball.vy = v.grounded || !v.alive ? 0 : -(this.airVy0 - v.course.physics.gravity * (v.trackSec - this.airStart)) * f.unit;
    ball.angle = v.angle;
    ball.spin = 0;
  }

  private skipDropsFrom(i: number) {
    const events = this.view.course.events;
    let k = i;
    while (k < events.length && events[k].kind === "drop") k++;
    this.nextJump = k;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.refreshField(ctx.config.width, ctx.config.height);
    this.stepStartSec = this.clockMs / 1000;
    this.clockMs += dtMs;
    this.sub = 0;
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    if (ball.id !== this.ballId) return;
    const t0 = this.stepStartSec + this.sub * dtSec;
    const t1 = Math.min(this.stepStartSec + (this.sub + 1) * dtSec, this.clockMs / 1000);
    if (t1 > t0) this.advance(ctx, t0, t1);
    this.place(ball);
  }

  onPostSubStep() {
    this.sub++;
  }

  /** Moves the square from simulation time t0 to t1, handling take-offs, edges, landings and crashes at their exact times. */
  private advance(ctx: ModeContext, t0: number, t1: number) {
    const v = this.view;
    const c = v.course;
    const { speed, gravity: g, jumpSpeed: v0 } = c.physics;
    let t = t0;
    if (v.crossed && v.alive && v.grounded) {
      // Past the finish line: the square just runs on (nothing left to jump or crash into).
      v.trackSec = t1 - this.shift;
      v.x = speed * v.trackSec;
      return;
    }
    for (let guard = 0; guard < 16 && t < t1 - 1e-12; guard++) {
      if (!v.alive) {
        if (v.respawnSec <= t1 + 1e-12) {
          const at = Math.max(t, v.respawnSec);
          this.respawn(at);
          t = at;
          continue;
        }
        break;
      }
      const tau0 = t - this.shift;
      const tau1 = t1 - this.shift;
      if (v.grounded) {
        let jumpTau = Infinity;
        if (v.auto) {
          const ev = c.events[this.nextJump];
          if (ev && ev.startSec <= tau1 + 1e-12) jumpTau = Math.max(tau0, ev.startSec);
        } else if (this.jumpQueuedAt >= t - JUMP_BUFFER_SEC && this.jumpQueuedAt <= t1) jumpTau = Math.max(tau0, this.jumpQueuedAt - this.shift);
        const end = runnerSupportEnd(c, v.level, speed * tau0);
        const leaveTau = Number.isFinite(end) ? (end + 0.5) / speed : tau0;
        const hitTau = runnerFrontHitSec(c, v.level, tau0, tau1);
        const next = Math.min(jumpTau, leaveTau, hitTau, tau1);
        const at = Math.max(tau0, next);
        v.trackSec = at;
        v.x = speed * at;
        v.y = v.level;
        if (hitTau <= at + 1e-12 && hitTau <= tau1) {
          this.die(ctx, at + this.shift);
          t = at + this.shift;
          continue;
        }
        if (jumpTau <= at + 1e-12 && jumpTau <= tau1) {
          this.takeOff(at, v0, v.auto ? this.nextJump : -1);
          t = at + this.shift;
          continue;
        }
        if (leaveTau <= at + 1e-12 && leaveTau <= tau1) {
          // Off the edge – unless the square still overlaps another piece of the same surface.
          if (!runnerSupported(c, v.level, v.x - 0.5 + 1e-7, v.x + 0.5)) this.fall(at);
          else if (leaveTau <= tau0 + 1e-12) {
            // Stuck on an edge case (a piece starting exactly where the last one ended): step on.
            t = Math.min(t1, t + 1e-6);
            continue;
          }
          t = at + this.shift;
          continue;
        }
        t = t1;
        continue;
      }
      // Airborne: the first landing within the interval, else the end of it.
      const land = this.landingTau(tau0, tau1);
      const at = land ? land.tau : tau1;
      const s = at - this.airStart;
      v.trackSec = at;
      v.x = speed * at;
      v.y = this.airY0 + this.airVy0 * s - 0.5 * g * s * s;
      v.angle = this.baseAngle + this.spinRate * s;
      if (land) {
        v.y = land.top;
        this.land(ctx, at, land.top);
        // Landed beside a block face or on spikes (a free jump gone wrong): a crash.
        if (runnerCollides(c, v.x, v.y)) this.die(ctx, at + this.shift);
        t = at + this.shift;
        continue;
      }
      if (v.y < PIT_DEATH_Y || runnerCollides(c, v.x, v.y)) {
        this.die(ctx, t1);
        t = t1;
        continue;
      }
      t = t1;
    }
    // Obstacles passed, and the finish line.
    if (v.alive) {
      const events = c.events;
      while (v.cleared < events.length && v.x >= events[v.cleared].landX - 1e-6) v.cleared++;
      if (!v.crossed && v.x >= c.finishX - 1e-9) this.cross(ctx, (c.finishX / speed) + this.shift);
    }
  }

  /** The first landing (a descending crossing of a surface top with ground under it) in (tau0, tau1], or null. */
  private landingTau(tau0: number, tau1: number): { tau: number; top: number } | null {
    const c = this.view.course;
    const { speed, gravity: g } = c.physics;
    const y = (tau: number) => {
      const s = tau - this.airStart;
      return this.airY0 + this.airVy0 * s - 0.5 * g * s * s;
    };
    const yStart = y(tau0);
    const yEnd = y(tau1);
    let best: { tau: number; top: number } | null = null;
    for (let top = MAX_LEVEL; top >= 0; top--) {
      if (top > yStart + 1e-9 || top < yEnd - 1e-9) continue;
      const disc = this.airVy0 * this.airVy0 + 2 * g * (this.airY0 - top);
      if (disc < 0) continue;
      const tau = this.airStart + (this.airVy0 + Math.sqrt(disc)) / g;
      if (tau < tau0 - 1e-9 || tau > tau1 + 1e-12) continue;
      const x = speed * tau;
      if (!runnerSupported(c, top, x - 0.5, x + 0.5)) continue;
      if (!best || tau < best.tau) best = { tau, top };
    }
    return best;
  }

  private takeOff(tau: number, v0: number, event: number) {
    const v = this.view;
    const c = v.course;
    v.grounded = false;
    v.jumps++;
    this.airStart = tau;
    this.airY0 = v.level;
    this.airVy0 = v0;
    this.jumpQueuedAt = -Infinity;
    // The planned flight turns the square a whole number of quarter turns (it lands flat); a free jump half a turn per flat flight.
    const planned = event >= 0 ? c.events[event] : null;
    this.startSpin(planned ? planned.landSec - tau : c.physics.flatFlight);
    if (planned) this.skipDropsFrom(event + 1);
  }

  private fall(tau: number) {
    const v = this.view;
    const c = v.course;
    v.grounded = false;
    this.airStart = tau;
    this.airY0 = v.level;
    this.airVy0 = 0;
    const ev = v.auto ? c.events[v.cleared] : null;
    this.startSpin(ev && ev.kind === "drop" ? ev.landSec - tau : dropTime(c.physics.gravity, Math.max(1, v.level)));
  }

  private startSpin(flight: number) {
    const Tf = this.view.course.physics.flatFlight;
    const quarters = Math.max(1, Math.round((2 * flight) / Tf));
    this.baseAngle = Math.round(this.view.angle / (Math.PI / 2)) * (Math.PI / 2);
    this.spinRate = flight > 1e-6 ? (quarters * Math.PI) / 2 / flight : 0;
  }

  private land(ctx: ModeContext, tau: number, top: number) {
    const v = this.view;
    const c = v.course;
    v.grounded = true;
    v.level = top;
    v.y = top;
    v.angle = Math.round(v.angle / (Math.PI / 2)) * (Math.PI / 2);
    this.baseAngle = v.angle;
    this.spinRate = 0;
    const sim = tau + this.shift;
    v.landings++;
    v.lastLandSec = sim;
    v.lastLandX = v.x;
    v.lastLandLevel = top;
    // The event this landing completes (its landing spot), if it is the one planned.
    let event = -1;
    for (let i = Math.max(0, v.cleared - 1); i < Math.min(c.events.length, v.cleared + 2); i++) {
      if (Math.abs(c.events[i].landX - v.x) < 0.75 && c.events[i].toLevel === top) {
        event = i;
        break;
      }
    }
    v.lastLandEvent = event;
    // On the beat of the simulation clock?
    const period = c.period;
    if (period > 0) {
      const j = firstBeatAtOrAfter(this.clock.getConfig(), sim - 0.5 * period);
      const near = beatTimeSec(this.clock.getConfig(), j);
      if (Math.abs(near - sim) <= ON_BEAT_TOLERANCE_SEC) v.onBeat++;
    }
    const degree = event >= 0 ? c.events[event].degree : runnerDegree(this.noteIndex, top);
    this.noteIndex++;
    const { scale, rootNote } = v.settings;
    const last = event === c.events.length - 1;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: rhythmPitch(degree, scale, rootNote), ...(last ? { accent: true } : {}) });
    ctx.addWallHit(0, (((degree % 12) + 12) % 12) * (Math.PI / 6), 0);
    this.spawnDust(v.x, top, sim);
    if (this.jumpQueuedAt >= sim - JUMP_BUFFER_SEC) {
      // A buffered Space press: jump again right away.
      this.takeOff(tau, c.physics.jumpSpeed, -1);
    }
  }

  private die(ctx: ModeContext, sim: number) {
    const v = this.view;
    const c = v.course;
    v.alive = false;
    v.deaths++;
    v.deathSec = sim;
    v.deathX = v.x;
    v.deathY = v.y;
    this.deathCamX = v.camX;
    // Back to the checkpoint of the section the square was in, a whole number of beats later (the course stays on the beat).
    let cp = 0;
    for (let i = 0; i < c.checkpoints.length; i++) if (c.checkpoints[i].event <= v.cleared) cp = i;
    v.checkpoint = cp;
    const P = c.period > 0 ? c.period : 0.5;
    const target = c.checkpoints[cp].sec;
    const beats = Math.ceil((sim + RESPAWN_SEC - target - this.shift) / P - 1e-9);
    v.respawnSec = target + this.shift + Math.max(1, beats) * P;
    this.spawnDebris(v.x, v.y, sim);
    const { scale, rootNote } = v.settings;
    ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency: rhythmPitch(-7, scale, rootNote), level: 0.8 });
  }

  private respawn(sim: number) {
    const v = this.view;
    const c = v.course;
    const cp = c.checkpoints[v.checkpoint] ?? c.checkpoints[0];
    this.shift = sim - cp.sec;
    v.alive = true;
    v.grounded = true;
    v.level = cp.level;
    v.trackSec = cp.sec;
    v.x = cp.x;
    v.y = cp.level;
    v.angle = 0;
    this.baseAngle = 0;
    this.spinRate = 0;
    v.cleared = cp.event;
    v.attempt++;
    v.respawnSec = Infinity;
    v.trailCount = 0;
    this.noteIndex = cp.event;
    this.jumpQueuedAt = -Infinity;
    this.skipDropsFrom(cp.event);
  }

  private cross(ctx: ModeContext, sim: number) {
    const v = this.view;
    v.crossed = true;
    v.crossSec = sim;
    const { scale, rootNote } = v.settings;
    const chord = rhythmChord(7, scale, rootNote);
    const event: SoundEvent = { type: "hit", wallIndex: 0, frequency: chord[0], chord, accent: true };
    ctx.addPendingSoundEvent(event);
    ctx.addPendingSoundEvent({ type: "multiplier", wallIndex: 0, multiplier: 16 });
    const f = v.field;
    ctx.spawnConfetti(f.left + v.course.finishX * f.unit, f.floorY - 2 * f.unit);
    this.spawnSparks(v.course.finishX, sim);
  }

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = this.clockMs / 1000;
    v.timeSec = now;
    if (v.alive) v.trackSec = now - this.shift;
    // The camera: locked on the square; while it waits to respawn it glides back to the checkpoint.
    const lead = CAMERA_AT * VIEW_UNITS;
    if (v.alive) v.camX = v.x - lead;
    else {
      const cp = v.course.checkpoints[v.checkpoint] ?? v.course.checkpoints[0];
      const span = Math.max(1e-6, v.respawnSec - v.deathSec);
      const k = Math.max(0, Math.min(1, (now - v.deathSec - 0.35 * span) / (0.65 * span)));
      const e = k * k * (3 - 2 * k);
      v.camX = this.deathCamX + (cp.x - lead - this.deathCamX) * e;
    }
    // The beat the course follows (visual pulse).
    this.clock.sample(now, this.beatSample);
    v.beatIndex = this.beatSample.index;
    v.beatPulse = this.beatSample.pulse;
    // The square's trail (one sample per step).
    if (v.alive) {
      v.trailX[v.trailHead] = v.x;
      v.trailY[v.trailHead] = v.y;
      v.trailA[v.trailHead] = v.angle;
      v.trailHead = (v.trailHead + 1) % RR_TRAIL;
      v.trailCount = Math.min(RR_TRAIL, v.trailCount + 1);
    }
    if (v.crossed && !v.finished && now >= v.crossSec + FINISH_HOLD_SEC - 1e-9) v.finished = true;
    const ball = this.findBall(ctx);
    if (ball) this.place(ball);
  }

  private nextParticleSlot(): number {
    const v = this.view;
    const slot = v.partNext;
    v.partNext = (v.partNext + 1) % MAX_RR_PARTICLES;
    v.partSpawned++;
    return slot;
  }

  private spawnDust(x: number, y: number, at: number) {
    const v = this.view;
    const rnd = this.fx;
    for (let i = 0; i < 8; i++) {
      const s = this.nextParticleSlot();
      const side = i % 2 === 0 ? -1 : 1;
      v.partX[s] = x + side * (0.3 + 0.2 * rnd());
      v.partY[s] = y + 0.05;
      v.partVx[s] = side * (1.2 + 2.4 * rnd()) - 1.5;
      v.partVy[s] = 1.5 + 3 * rnd();
      v.partT0[s] = at;
      v.partLife[s] = 0.3 + 0.3 * rnd();
      v.partSize[s] = 0.1 + 0.12 * rnd();
      v.partKind[s] = 0;
    }
  }

  private spawnDebris(x: number, y: number, at: number) {
    const v = this.view;
    const rnd = this.fx;
    for (let i = 0; i < 36; i++) {
      const s = this.nextParticleSlot();
      const a = rnd() * 2 * Math.PI;
      const sp = 3 + 9 * rnd();
      v.partX[s] = x + (rnd() - 0.5) * 0.8;
      v.partY[s] = y + 0.5 + (rnd() - 0.5) * 0.8;
      v.partVx[s] = Math.cos(a) * sp;
      v.partVy[s] = Math.sin(a) * sp + 4;
      v.partT0[s] = at;
      v.partLife[s] = 0.6 + 0.6 * rnd();
      v.partSize[s] = 0.12 + 0.2 * rnd();
      v.partKind[s] = 1;
    }
  }

  private spawnSparks(x: number, at: number) {
    const v = this.view;
    const rnd = this.fx;
    for (let i = 0; i < 60; i++) {
      const s = this.nextParticleSlot();
      const a = Math.PI * (0.1 + 0.8 * rnd());
      const sp = 6 + 10 * rnd();
      v.partX[s] = x;
      v.partY[s] = 0.5 + 4 * rnd();
      v.partVx[s] = Math.cos(a) * sp;
      v.partVy[s] = Math.sin(a) * sp;
      v.partT0[s] = at;
      v.partLife[s] = 0.8 + 0.8 * rnd();
      v.partSize[s] = 0.1 + 0.14 * rnd();
      v.partKind[s] = 2;
    }
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A resize keeps the run: the field follows the canvas (everything else is in cube lengths). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged) return true;
    this.refreshField(ctx.config.width, ctx.config.height);
    const ball = this.findBall(ctx);
    if (ball) {
      this.place(ball);
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
    return true;
  }
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { events: v.course.events.length, cleared: v.cleared, landings: v.landings, onBeat: v.onBeat, deaths: v.deaths, attempt: v.attempt, finished: v.finished };
  }
}
