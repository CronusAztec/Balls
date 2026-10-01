import { resolveBallObstacle } from "../obstacles";
import {
  MAX_RACERS,
  MIN_RACERS,
  buildRaceField,
  buildRaceTrack,
  firstRowFrom,
  isRaceFeature,
  raceLapsWithin,
  setSpinnerAngles,
  type RaceFeature,
  type RacePad,
  type RaceSwapZone,
  type RaceTrack,
} from "../raceTrack";
import { LeaderClock, rankRacers } from "../raceStandings";
import type { Ball, GameMode, ModeContext, SoundEvent } from "../types";
import { atLeastMin, memoryCeiling } from "@/lib/uncap"; // --- uncap-all ---

/**
 * Square Racing Grand Prix ("race" mode, the project.jdm marble-race format with cups): 2–16 racers – squares or
 * circles, named and coloured from the Teams roster – race down a long vertical track generated from the seed
 * (raceTrack.ts: pegs, funnels, spinners, swap zones, turbo pads, pinball bumpers, narrow gates, a final sector with a
 * swap zone and a turbo strip), under the mode's own gravity with a terminal speed. The camera scrolls with the leader
 * (or the pack), the standings follow every overtake with a hysteresis and interval gaps (raceStandings.ts), a pass
 * calls itself out with a rising chime, the winner gets a fanfare, and after the podium (and, with the cup on, the cup
 * table) the run is finished.
 *
 * The mode owns its playfield like Ball Drop and Glass Smash: it activates with the "none" ring layout, the racers are
 * ordinary engine balls (the engine integrates them, so wind, drag, pause, speed and recording work unchanged) with
 * `gravityScale` 0 – the mode integrates its gravity and drag itself in `onBallStep()` on the simulation clock, and
 * resolves the racers against the rows near them (obstacles.ts maths), the walls, the sensors (pads, swap zones, the
 * finish line) and each other (`onPostSubStep()`; `ballsPassThrough` keeps the engine's own pair pass – and its ball
 * interactions – out of it). Everything random comes from `ctx.random()`: the track, the grid, the start jitter and the
 * kicks that free a stuck racer, so a seed replays exactly and Find Simulation can time a race.
 *
 * Rigging (`winner`, the director's favourite): the favoured racer never arms a swap zone (so it is never pulled back),
 * a zone it has not reached yet waits for it (only it can trigger the swap), the final swap zone of the last lap hands
 * it the place of the first racer to reach it (the leader) – a swap with the favourite leaves it the faster of the two
 * speeds –, turbo pads boost it harder and the final turbo strip of the last lap drags everybody else – all deterministic,
 * so a rigged seed replays the same staged win.
 */

/* ------------------------------------------------------------------ settings */

export const RACE_SHAPES = ["square", "circle"] as const;
export type RaceShape = (typeof RACE_SHAPES)[number];
export const RACE_CAMERAS = ["leader", "pack"] as const;
export type RaceCamera = (typeof RACE_CAMERAS)[number];

export function isRaceShape(value: unknown): value is RaceShape {
  return typeof value === "string" && (RACE_SHAPES as readonly string[]).includes(value);
}
export function isRaceCamera(value: unknown): value is RaceCamera {
  return typeof value === "string" && (RACE_CAMERAS as readonly string[]).includes(value);
}

export interface RaceSettings {
  /** Racers on the grid, 2–16. */
  racers: number;
  /** How the racers look (the collision is a circle either way). */
  shape: RaceShape;
  /** Screens (field heights) per lap, 3–20. */
  trackLength: number;
  /** Laps, 1–5 (the lap's rows come round again). */
  laps: number;
  /** The obstacle mix: everything, or one kind featured. */
  feature: RaceFeature;
  /** The camera follows the leader or frames the pack. */
  camera: RaceCamera;
  /** Show the cup table after the podium (the run lasts that much longer). */
  cup: boolean;
  /** Racer the director favours (0-based), −1 = a fair race. */
  winner: number;
}

export const DEFAULT_RACE_SETTINGS: RaceSettings = {
  racers: 8,
  shape: "square",
  trackLength: 8,
  laps: 1,
  feature: "mixed",
  camera: "leader",
  cup: false,
  winner: -1,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const RACE_RANGES = {
  rcRacers: { min: MIN_RACERS, max: MAX_RACERS, step: 1 },
  rcTrackLength: { min: 3, max: 20, step: 1 },
  rcLaps: { min: 1, max: 5, step: 1 },
  rcWinner: { min: -1, max: MAX_RACERS - 1, step: 1 },
} as const;

/** Longest cup title (characters). */
export const MAX_CUP_TITLE_LENGTH = 32;

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(Math.round(n), range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Fills in the defaults and clamps every value (whole numbers in range, known options, real booleans). */
export function resolveRaceSettings(config: Partial<RaceSettings> | null | undefined): RaceSettings {
  const out = { ...DEFAULT_RACE_SETTINGS };
  if (!config) return out;
  const R = RACE_RANGES;
  if (config.racers !== undefined) out.racers = memoryCeiling("rcRacers", clampInt(config.racers, R.rcRacers, out.racers));
  if (isRaceShape(config.shape)) out.shape = config.shape;
  if (config.trackLength !== undefined) out.trackLength = memoryCeiling("rcTrackLength", clampInt(config.trackLength, R.rcTrackLength, out.trackLength));
  if (config.laps !== undefined) out.laps = clampInt(config.laps, R.rcLaps, out.laps);
  out.laps = raceLapsWithin(out.trackLength, out.laps); // --- uncap-all --- (every lap's rows together: at most RACE_SCREEN_CEILING screens, as the track builds them)
  if (isRaceFeature(config.feature)) out.feature = config.feature;
  if (isRaceCamera(config.camera)) out.camera = config.camera;
  if (typeof config.cup === "boolean") out.cup = config.cup;
  if (config.winner !== undefined) out.winner = clampInt(config.winner, R.rcWinner, out.winner);
  return out;
}

/** The racer the director favours: `winner` when it names a racer on the grid, else −1. */
export function favouredRacer(settings: Pick<RaceSettings, "winner" | "racers">): number {
  return Number.isInteger(settings.winner) && settings.winner >= 0 && settings.winner < settings.racers ? settings.winner : -1;
}

/** The race fields of the SimulatorSettings object (URL keys rcn, rcs, rcl, rclp, rcf, rccam, rccup, rcct, rcw, rcst, rcmm). */
export interface RaceSettingFields {
  rcRacers: number;
  rcShape: RaceShape;
  rcTrackLength: number;
  rcLaps: number;
  rcFeature: RaceFeature;
  rcCamera: RaceCamera;
  rcCup: boolean;
  /** The cup's name on the table ("" = named after the track's featured obstacle). */
  rcCupTitle: string;
  rcWinner: number;
  /** The live standings in the top-left corner. */
  rcStandings: boolean;
  /** The mini-map on the right. */
  rcMiniMap: boolean;
}

/** Picks the race settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setRaceSettings()`. */
export function raceSettingsOf(source: RaceSettingFields): RaceSettings {
  return { racers: source.rcRacers, shape: source.rcShape, trackLength: source.rcTrackLength, laps: source.rcLaps, feature: source.rcFeature, camera: source.rcCamera, cup: source.rcCup, winner: source.rcWinner };
}

export function defaultRaceFields(): RaceSettingFields {
  const d = DEFAULT_RACE_SETTINGS;
  return { rcRacers: d.racers, rcShape: d.shape, rcTrackLength: d.trackLength, rcLaps: d.laps, rcFeature: d.feature, rcCamera: d.camera, rcCup: d.cup, rcCupTitle: "", rcWinner: d.winner, rcStandings: true, rcMiniMap: true };
}

// Control characters and the Unicode line / paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A cup title as stored: no control characters, whitespace collapsed, trimmed, at most MAX_CUP_TITLE_LENGTH characters. */
export function sanitizeCupTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(CONTROL, "").replace(/\s+/g, " ").trim()).slice(0, MAX_CUP_TITLE_LENGTH).join("").trim();
}

/** Validates the race fields (URL parameters and presets alike): clamped numbers, known options, real booleans, a clean title. */
export function resolveRaceFields(source: Partial<RaceSettingFields>): RaceSettingFields {
  const s = resolveRaceSettings({ racers: source.rcRacers, shape: source.rcShape, trackLength: source.rcTrackLength, laps: source.rcLaps, feature: source.rcFeature, camera: source.rcCamera, cup: source.rcCup, winner: source.rcWinner });
  const d = defaultRaceFields();
  return {
    rcRacers: s.racers,
    rcShape: s.shape,
    rcTrackLength: s.trackLength,
    rcLaps: s.laps,
    rcFeature: s.feature,
    rcCamera: s.camera,
    rcCup: s.cup,
    rcCupTitle: sanitizeCupTitle(source.rcCupTitle),
    rcWinner: s.winner,
    rcStandings: typeof source.rcStandings === "boolean" ? source.rcStandings : d.rcStandings,
    rcMiniMap: typeof source.rcMiniMap === "boolean" ? source.rcMiniMap : d.rcMiniMap,
  };
}

const NUMERIC_KEYS = { rcn: "rcRacers", rcl: "rcTrackLength", rclp: "rcLaps", rcw: "rcWinner" } as const;
const BOOLEAN_KEYS = { rccup: "rcCup", rcst: "rcStandings", rcmm: "rcMiniMap" } as const;

/** Writes the race fields that differ from `base` (the mode's defaults) into the URL. */
export function writeRaceParams(settings: RaceSettingFields, base: RaceSettingFields, params: URLSearchParams) {
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, String(settings[field]));
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  if (settings.rcShape !== base.rcShape) params.set("rcs", settings.rcShape);
  if (settings.rcFeature !== base.rcFeature) params.set("rcf", settings.rcFeature);
  if (settings.rcCamera !== base.rcCamera) params.set("rccam", settings.rcCamera);
  if (settings.rcCupTitle !== base.rcCupTitle) params.set("rcct", settings.rcCupTitle);
}

/** Reads the race URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readRaceParams(params: URLSearchParams, settings: RaceSettingFields) {
  const next: Partial<RaceSettingFields> = { ...settings };
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  for (const [key, field] of Object.entries(BOOLEAN_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") next[field] = true;
    else if (raw === "0") next[field] = false;
  }
  const shape = params.get("rcs");
  if (isRaceShape(shape)) next.rcShape = shape;
  const feature = params.get("rcf");
  if (isRaceFeature(feature)) next.rcFeature = feature;
  const camera = params.get("rccam");
  if (isRaceCamera(camera)) next.rcCamera = camera;
  const title = params.get("rcct");
  if (title !== null) next.rcCupTitle = title;
  Object.assign(settings, resolveRaceFields(next));
}

/* ------------------------------------------------------------------ physics and timing */

/** Gravity in field sizes per s² at the default Gravity (300) and Ball Speed (400). */
export const RACE_GRAVITY = 1.2;
/** Terminal speed in field sizes per second (the linear drag that caps the fall). */
export const RACE_VMAX = 0.78;
/** Downward speed a turbo pad adds (field sizes per second), and how much harder it boosts the favoured racer. */
export const TURBO_BOOST = 0.75;
export const RIG_TURBO_FACTOR = 1.8;
/** When rigged, the last lap's final turbo strip keeps this much of everybody else's speed. */
export const RIG_STRIP_DRAG = 0.55;
/** A pinball bumper sends a racer off at least this fast (field sizes per second). */
export const BUMPER_KICK = 0.9;
/** Fraction of the approach speed kept by the walls, the run-off floor and two racers hitting each other. */
export const WALL_RESTITUTION = 0.45;
export const FLOOR_RESTITUTION = 0.3;
export const RACER_RESTITUTION = 0.55;
/** The countdown before the gate opens: "3", "2", "1", then GO at COUNTDOWN_MS. */
export const COUNT_BEAT_MS = 600;
export const COUNTDOWN_MS = 3 * COUNT_BEAT_MS;
/** A racer that has not gained STUCK_PROGRESS field sizes for STUCK_MS gets a kick. */
export const STUCK_MS = 2000;
export const STUCK_PROGRESS = 0.02;
/**
 * After the winner, the others have DNF_AFTER_MS – or DNF_AFTER_SHARE of the winner's time on a long track – to finish
 * (then they are DNF); no race lasts longer than its time limit, `raceTimeLimitMs()`: RACE_MS_PER_SCREEN per screen of
 * track at the default Ball Speed and Gravity (a racer needs about 2–2.5 s a screen), proportionally more at a slower
 * tempo or a weaker gravity, and never less than MAX_RACE_MS.
 */
export const DNF_AFTER_MS = 12000;
export const DNF_AFTER_SHARE = 0.5;
export const MAX_RACE_MS = 240000;
export const RACE_MS_PER_SCREEN = 8000;
/** The podium screen, then (with the cup) the cup table, before the run is finished. */
export const PODIUM_MS = 3500;
export const CUP_MS = 4000;
/** Pass callouts (and their chime) come at most this often; a lead change always does. A callout shows this long. */
export const CALLOUT_GAP_MS = 700;
export const CALLOUT_MS = 1500;
/** Contacts at least this fast (field sizes per second) are hits: a note, a flash. */
export const HIT_SPEED = 0.08;
/** Gap left between a racer and an obstacle after a push-out (field sizes: 0.01 px on a 400 px field), so the push-out scales with the field. */
export const RACE_SEPARATION_REL = 2.5e-5;
/** A racer plays at most one note per this many ms; a step queues at most this many notes (events always pass). */
export const SOUND_COOLDOWN_MS = 110;
export const MAX_RACE_SOUNDS_PER_STEP = 3;
/** Camera: time constant (s) and where the leader sits in the view (fraction of the field from the top). */
export const CAMERA_TAU = 0.22;
export const LEADER_VIEW = 0.62;
/** Callout slots kept (the renderer shows the newest). */
export const CALLOUT_SLOTS = 6;

const MIDI_NOTES = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];

/** How long (ms) the others may take after a winner who needed `winnerMs` (race time). */
export function dnfGraceMs(winnerMs: number): number {
  return Math.max(DNF_AFTER_MS, Number.isFinite(winnerMs) ? DNF_AFTER_SHARE * winnerMs : 0);
}

/** The note of racer i (a C-major pentatonic ladder from C4, one note per racer); the tone generator snaps it to the scale. */
export function racerNote(i: number): number {
  const midi = MIDI_NOTES[((Math.round(i) % MIDI_NOTES.length) + MIDI_NOTES.length) % MIDI_NOTES.length];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** The race tempo: the Ball Speed relative to its default (0.25×–2×); the whole race runs that much faster. */
export function raceTempo(ballSpeed: number): number {
  const k = Number.isFinite(ballSpeed) && ballSpeed > 0 ? ballSpeed / 400 : 1;
  return Math.max(0.25, Math.min(2, k));
}

/** The Gravity setting relative to its default (0.3×–3×). */
export function raceGravityFactor(gravity: number): number {
  return Number.isFinite(gravity) ? Math.max(0.3, Math.min(3, gravity / 300)) : 1;
}

/**
 * The time limit (ms after the gun) of a race over `screens` screens of track (the track length × the laps) at this Ball
 * Speed and Gravity: the racers' speeds scale with `raceTempo() × raceGravityFactor()`, so the limit scales with its
 * inverse – a long or slow race is never cut off before anybody finishes.
 */
export function raceTimeLimitMs(screens: number, ballSpeed: number, gravity: number): number {
  const n = Number.isFinite(screens) && screens > 0 ? screens : 1;
  return Math.max(MAX_RACE_MS, (RACE_MS_PER_SCREEN * n) / (raceTempo(ballSpeed) * raceGravityFactor(gravity)));
}

/** Gravity (px/s²) and terminal speed (px/s) for a field `size` px wide. */
export function raceMotion(gravity: number, ballSpeed: number, size: number): { g: number; vmax: number; drag: number } {
  const k = raceTempo(ballSpeed);
  const gf = raceGravityFactor(gravity);
  const g = RACE_GRAVITY * size * gf * k * k;
  const vmax = RACE_VMAX * size * gf * k;
  return { g, vmax, drag: g / vmax };
}

/* ------------------------------------------------------------------ the view */

export type RacePhase = "countdown" | "racing" | "podium" | "cup" | "done";
export type RaceCalloutKind = "pass" | "lead" | "swap" | "finalLap" | "winner";

export interface RaceCallout {
  kind: RaceCalloutKind;
  /** The racer it is about (the passer, the one that jumped ahead, the winner, the leader on the final lap). */
  a: number;
  /** The other racer (the one passed / swapped back), −1 when none. */
  b: number;
  /** The place `a` is in now (1-based). */
  place: number;
  atMs: number;
}

/** What the canvas needs to draw the race; the same object every call. */
export interface RaceView {
  track: RaceTrack | null;
  settings: RaceSettings;
  /** Counts the runs of this mode (every init), so the page can score each finished race once. */
  runSerial: number;
  timeMs: number;
  phase: RacePhase;
  /** Simulation ms the gate opens. */
  goAtMs: number;
  /**
   * The race's time limit (ms after the gun): `raceTimeLimitMs()` for the track at the slowest Ball Speed and Gravity seen
   * this run. The stragglers are DNF by then; with nobody home the racers are placed where they are (a backstop).
   */
  timeLimitMs: number;
  /** World offset the renderer scrolls by: screen y = world y − cameraY. */
  cameraY: number;
  racers: number;
  /** The favoured racer (−1 in a fair race). */
  favoured: number;
  /** Per racer (MAX_RACERS slots): its engine ball id, progress down the track (px), lap (1-based), place (1-based; 0 racing, −1 DNF), finish time (ms after the gun, NaN before), gap to the leader (ms). */
  ballIds: Int32Array;
  progress: Float64Array;
  lap: Int32Array;
  place: Int32Array;
  finishMs: Float64Array;
  gapMs: Float64Array;
  /** Simulation ms of the racer's last obstacle hit, turbo boost and swap (flashes). */
  hitAtMs: Float64Array;
  boostAtMs: Float64Array;
  swapAtMs: Float64Array;
  /** Rolling angle of a square (visual). */
  roll: Float64Array;
  /** The standings (racer indices, first place first) and the finishers in order. */
  order: number[];
  finishOrder: number[];
  /** The racer leading (first in `order`). */
  leader: number;
  callouts: RaceCallout[];
  /** Callouts made so far (the newest is `callouts[(calloutCount - 1) % CALLOUT_SLOTS]`). */
  calloutCount: number;
  winner: number;
  winnerAtMs: number;
  /** Everybody finished (or is DNF): the podium started; then the cup; the end of the run. */
  completeAtMs: number;
  cupAtMs: number;
  finished: boolean;
  /** The leader started the last lap (−Infinity before). */
  finalLapAtMs: number;
  hits: number;
  passes: number;
  swaps: number;
  boosts: number;
  leadChanges: number;
  kicks: number;
}

function createView(): RaceView {
  const f64 = () => new Float64Array(MAX_RACERS);
  return {
    track: null,
    settings: { ...DEFAULT_RACE_SETTINGS },
    runSerial: 0,
    timeMs: 0,
    phase: "countdown",
    goAtMs: COUNTDOWN_MS,
    timeLimitMs: MAX_RACE_MS,
    cameraY: 0,
    racers: 0,
    favoured: -1,
    ballIds: new Int32Array(MAX_RACERS).fill(-1),
    progress: f64(),
    lap: new Int32Array(MAX_RACERS),
    place: new Int32Array(MAX_RACERS),
    finishMs: f64().fill(NaN),
    gapMs: f64(),
    hitAtMs: f64().fill(-Infinity),
    boostAtMs: f64().fill(-Infinity),
    swapAtMs: f64().fill(-Infinity),
    roll: f64(),
    order: [],
    finishOrder: [],
    leader: 0,
    callouts: Array.from({ length: CALLOUT_SLOTS }, () => ({ kind: "pass" as RaceCalloutKind, a: -1, b: -1, place: 0, atMs: -Infinity })),
    calloutCount: 0,
    winner: -1,
    winnerAtMs: -Infinity,
    completeAtMs: -Infinity,
    cupAtMs: -Infinity,
    finished: false,
    finalLapAtMs: -Infinity,
    hits: 0,
    passes: 0,
    swaps: 0,
    boosts: 0,
    leadChanges: 0,
    kicks: 0,
  };
}

/** The newest callout still on screen at `nowMs` (null when none). */
export function currentCallout(view: RaceView, nowMs: number): RaceCallout | null {
  if (view.calloutCount === 0) return null;
  const c = view.callouts[(view.calloutCount - 1) % CALLOUT_SLOTS];
  return nowMs - c.atMs < CALLOUT_MS && nowMs >= c.atMs ? c : null;
}

/* ------------------------------------------------------------------ the mode */

export class RaceMode implements GameMode {
  readonly name = "race";
  /** The racers keep the speed the mode gives them (no slow-ball boost) and pile up on the run-off floor at the end. */
  readonly ballsMayRest = true;
  /** Racer contacts are the mode's own (onPostSubStep), whatever the ball interaction says. */
  readonly ballsPassThrough = true;
  private settings: RaceSettings = { ...DEFAULT_RACE_SETTINGS };
  private readonly view: RaceView = createView();
  private readonly clock = new LeaderClock(1024);
  /** The racers' balls by racer index (refreshed every step). */
  private readonly racerBall: (Ball | null)[] = new Array(MAX_RACERS).fill(null);
  private readonly prevY = new Float64Array(MAX_RACERS);
  private readonly bestU = new Float64Array(MAX_RACERS);
  private readonly bestAtMs = new Float64Array(MAX_RACERS);
  private readonly soundAtMs = new Float64Array(MAX_RACERS);
  /** Finishers of the current sub-step (racer, exact crossing time), placed at its end in time order. */
  private readonly pendingRacer = new Int32Array(MAX_RACERS);
  private readonly pendingMs = new Float64Array(MAX_RACERS);
  private pendingCount = 0;
  private idBase = 0;
  private soundsThisStep = 0;
  private stepStartMs = 0;
  private subIndex = 0;
  private beatsPlayed = 0;
  private lastCalloutMs = -Infinity;
  private confettiDone = 0;
  private swappedThisStep = false;
  private motion = { g: 0, vmax: 1, drag: 0 };
  /** px/s per "field size per second" at this tempo and gravity (the unit the speed constants are given in). */
  private unit = 1;
  private hitSpeed = 0;
  private hysteresis = 1;
  /** Canvas size the track is laid out for, and the random numbers it was built from (a resize before the first step lays it out afresh). */
  private layoutW = 0;
  private layoutH = 0;
  private tape: number[] = [];
  private started = false;
  private runs = 0;

  getSettings(): RaceSettings {
    return this.settings;
  }
  /** The track settings (racers, length, laps, mix, favourite, cup) apply on the next init; the camera and the shape at once. */
  setSettings(patch: Partial<RaceSettings>) {
    this.settings = resolveRaceSettings({ ...this.settings, ...patch });
    this.view.settings.camera = this.settings.camera;
    this.view.settings.shape = this.settings.shape;
  }
  getView(): RaceView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    let finished = 0;
    for (let i = 0; i < v.racers; i++) if (v.place[i] > 0) finished++;
    return { racers: v.racers, finished, phase: v.phase, leader: v.leader, winner: v.winner, lap: v.racers > 0 ? v.lap[v.leader] : 1, laps: this.settings.laps, done: v.finished };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const cfg = ctx.config;
    const tape: number[] = [];
    const track = buildRaceTrack(cfg.width, cfg.height, this.settings, cfg.ballRadius || 8, () => {
      const u = ctx.random();
      tape.push(u);
      return u;
    });
    this.tape = tape;
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    this.started = false;
    this.runs++;
    this.resetView(track);
    this.idBase = ctx.getNextId();
    const n = this.settings.racers;
    for (let i = 0; i < n; i++) {
      // radiusScale: the racer's size relative to the Ball Size (it scales with the field), kept by a live Ball Size change.
      ctx.addBall({ x: track.startX[i], y: track.startY[i], vx: 0, vy: 0, radius: track.racerRadius, radiusScale: track.racerRadius / (cfg.ballRadius || 8), color: cfg.ballColor || "#FFFFFF", gravityScale: 0 });
      this.view.ballIds[i] = this.idBase + i;
      this.prevY[i] = track.startY[i];
    }
    this.refreshBalls(ctx);
    this.updateMotion(ctx);
  }

  private resetView(track: RaceTrack) {
    const v = this.view;
    const n = this.settings.racers;
    v.track = track;
    v.settings = { ...this.settings };
    v.runSerial = this.runs;
    v.timeMs = 0;
    v.phase = "countdown";
    v.goAtMs = COUNTDOWN_MS;
    // updateMotion() sets the limit for this track and tempo (it only ever grows during the run).
    v.timeLimitMs = 0;
    v.racers = n;
    v.favoured = favouredRacer(this.settings);
    v.ballIds.fill(-1);
    v.progress.fill(0);
    v.lap.fill(1);
    v.place.fill(0);
    v.finishMs.fill(NaN);
    v.gapMs.fill(0);
    v.hitAtMs.fill(-Infinity);
    v.boostAtMs.fill(-Infinity);
    v.swapAtMs.fill(-Infinity);
    v.roll.fill(0);
    // The grid order is the first standings: the front row first.
    v.order.length = 0;
    for (const racer of track.gridOrder) v.order.push(racer);
    v.finishOrder.length = 0;
    v.leader = v.order[0] ?? 0;
    for (const c of v.callouts) c.atMs = -Infinity;
    v.calloutCount = 0;
    v.winner = -1;
    v.winnerAtMs = -Infinity;
    v.completeAtMs = -Infinity;
    v.cupAtMs = -Infinity;
    v.finished = false;
    v.finalLapAtMs = -Infinity;
    v.hits = 0;
    v.passes = 0;
    v.swaps = 0;
    v.boosts = 0;
    v.leadChanges = 0;
    v.kicks = 0;
    v.cameraY = this.startCamera(track);
    this.bestU.fill(0);
    this.bestAtMs.fill(0);
    this.soundAtMs.fill(-Infinity);
    this.pendingCount = 0;
    this.beatsPlayed = 0;
    this.lastCalloutMs = -Infinity;
    this.confettiDone = 0;
    this.racerBall.fill(null);
    this.clock.reset(track.finishY - track.yStart, COUNTDOWN_MS);
  }

  private startCamera(track: RaceTrack): number {
    return track.ceilingY - 0.02 * track.field.size - track.field.top;
  }

  private refreshBalls(ctx: ModeContext) {
    this.racerBall.fill(null);
    for (const ball of ctx.getBalls()) {
      const i = ball.id - this.idBase;
      if (i >= 0 && i < this.view.racers) this.racerBall[i] = ball;
    }
  }

  private updateMotion(ctx: ModeContext) {
    const track = this.view.track;
    if (!track) return;
    const S = track.field.size;
    this.motion = raceMotion(ctx.config.gravity, ctx.config.ballSpeed || 400, S);
    this.unit = this.motion.vmax / RACE_VMAX;
    this.hitSpeed = HIT_SPEED * this.unit;
    this.hysteresis = Math.max(1, track.racerRadius);
    // The time limit for this track at this tempo: a live (or keyframed) slow-down lengthens it, a speed-up never shortens it.
    const v = this.view;
    const limit = raceTimeLimitMs(v.settings.trackLength * v.settings.laps, ctx.config.ballSpeed || 400, ctx.config.gravity);
    if (limit > v.timeLimitMs) v.timeLimitMs = limit;
  }

  private queueNote(ctx: ModeContext, event: SoundEvent, always: boolean) {
    if (!always && this.soundsThisStep >= MAX_RACE_SOUNDS_PER_STEP) return;
    this.soundsThisStep++;
    ctx.addPendingSoundEvent(event);
  }

  private callout(kind: RaceCalloutKind, a: number, b: number, place: number) {
    const v = this.view;
    const c = v.callouts[v.calloutCount % CALLOUT_SLOTS];
    c.kind = kind;
    c.a = a;
    c.b = b;
    c.place = place;
    c.atMs = v.timeMs;
    v.calloutCount++;
    this.lastCalloutMs = v.timeMs;
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const track = v.track;
    if (!track) return;
    this.started = true;
    this.soundsThisStep = 0;
    this.swappedThisStep = false;
    v.timeMs = ctx.getElapsedMs();
    this.stepStartMs = v.timeMs - dtMs;
    this.subIndex = 0;
    this.refreshBalls(ctx);
    this.updateMotion(ctx);
    setSpinnerAngles(track, v.timeMs / 1000);
    // A live Ball Size change never grows a racer beyond what the track's narrowest openings let through.
    for (let i = 0; i < v.racers; i++) {
      const ball = this.racerBall[i];
      if (ball && ball.radius > track.racerRadius) ball.radius = track.racerRadius;
    }
    if (v.phase === "countdown") {
      // "3", "2", "1" on the beats, then GO.
      while (this.beatsPlayed < 3 && v.timeMs >= this.beatsPlayed * COUNT_BEAT_MS) {
        this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: 440, level: 0.8 }, true);
        this.beatsPlayed++;
      }
      if (v.timeMs >= v.goAtMs) this.release(ctx);
    }
  }

  /** GO: the gate opens and every racer drops with a small seeded sideways nudge. */
  private release(ctx: ModeContext) {
    const v = this.view;
    const track = v.track!;
    v.phase = "racing";
    this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: 880, accent: true }, true);
    const S = track.field.size;
    for (let i = 0; i < v.racers; i++) {
      const ball = this.racerBall[i];
      const u = ctx.random();
      if (!ball) continue;
      ball.vx = (u - 0.5) * 0.12 * S;
      ball.vy = 0;
      this.bestU[i] = 0;
      this.bestAtMs[i] = v.timeMs;
    }
  }

  private racerOf(ball: Ball): number {
    const i = ball.id - this.idBase;
    return i >= 0 && i < this.view.racers && this.racerBall[i] === ball ? i : -1;
  }

  /** Simulation ms at the end of the current sub-step. */
  private subEndMs(dtSec: number) {
    return this.stepStartMs + (this.subIndex + 1) * dtSec * 1000;
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const v = this.view;
    const track = v.track;
    if (!track) return;
    const i = this.racerOf(ball);
    if (i < 0) return;
    if (v.phase === "countdown") {
      ball.x = track.startX[i];
      ball.y = track.startY[i];
      ball.vx = 0;
      ball.vy = 0;
      this.prevY[i] = ball.y;
      return;
    }
    const nowMs = this.subEndMs(dtSec);
    const r = ball.radius;
    // Obstacles of the rows around the racer (resolved before gravity changes the velocity the resolvers look back along).
    const reach = r + 2;
    const rows = track.rows;
    const bounciness = ctx.getPhysicsExtras().wallBounciness;
    const separation = RACE_SEPARATION_REL * track.field.size; // --- review fix (modes-rhythm) --- (scale-free, not a fixed 0.01 px)
    for (let k = firstRowFrom(rows, ball.y - reach); k < rows.length && rows[k].top <= ball.y + reach; k++) {
      const row = rows[k];
      for (const o of row.obstacles) {
        const impact = resolveBallObstacle(ball, o.shape, dtSec, bounciness, separation);
        if (impact < 0) continue;
        if (o.role === "bumper" && impact > 0) this.kick(ball, o.shape.x, o.shape.y);
        if (impact < this.hitSpeed) continue;
        ctx.noteBounce?.(ball); // --- bounce-math --- an obstacle hit is a bounce
        o.lastHitMs = nowMs;
        o.lastRacer = i;
        v.hitAtMs[i] = nowMs;
        v.hits++;
        if (nowMs - this.soundAtMs[i] >= SOUND_COOLDOWN_MS) {
          this.soundAtMs[i] = nowMs;
          if (o.role === "bumper") this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: 2 * racerNote(i), bumper: true }, false);
          else this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: racerNote(i), level: Math.max(0.35, Math.min(1, 0.35 + impact / (0.6 * this.motion.vmax))) }, false);
        }
      }
      for (const pad of row.pads) if (ball.x >= pad.x0 && ball.x <= pad.x1 && ball.y >= pad.y0 - 0.5 * r && ball.y <= pad.y1 && !(pad.used & (1 << i))) this.boost(ctx, i, ball, pad);
      const zone = row.zone;
      // A swap teleports the racer: the rows it jumped over are not its business this sub-step.
      if (zone && !zone.used && this.prevY[i] < zone.y && ball.y >= zone.y && this.enterZone(ctx, i, zone)) break;
    }
    // Walls, the ceiling over the grid and the run-off floor.
    if (ball.x < track.left + r) {
      ball.x = track.left + r;
      if (ball.vx < 0) ball.vx = -ball.vx * WALL_RESTITUTION;
    } else if (ball.x > track.right - r) {
      ball.x = track.right - r;
      if (ball.vx > 0) ball.vx = -ball.vx * WALL_RESTITUTION;
    }
    if (ball.y < track.ceilingY + r) {
      ball.y = track.ceilingY + r;
      if (ball.vy < 0) ball.vy = -ball.vy * WALL_RESTITUTION;
    } else if (ball.y > track.floorY - r) {
      ball.y = track.floorY - r;
      if (ball.vy > 0) ball.vy = -ball.vy * FLOOR_RESTITUTION;
      ball.vx *= 0.97;
    }
    // Gravity and the drag that caps the fall at the terminal speed.
    ball.vy += this.motion.g * dtSec;
    const keep = Math.exp(-this.motion.drag * dtSec);
    ball.vx *= keep;
    ball.vy *= keep;
    // The finish line (placed at the end of the sub-step, in crossing order).
    if (v.place[i] === 0 && this.prevY[i] < track.finishY && ball.y >= track.finishY && this.pendingCount < MAX_RACERS) {
      const dy = ball.y - this.prevY[i];
      const f = dy > 0 ? (track.finishY - this.prevY[i]) / dy : 1;
      this.pendingRacer[this.pendingCount] = i;
      this.pendingMs[this.pendingCount] = nowMs - (1 - Math.max(0, Math.min(1, f))) * dtSec * 1000;
      this.pendingCount++;
    }
    // A square rolls along as it slides (visual only).
    let roll = v.roll[i] + (ball.vx * dtSec) / Math.max(1, r);
    if (roll > Math.PI || roll < -Math.PI) roll -= Math.round(roll / (2 * Math.PI)) * 2 * Math.PI;
    v.roll[i] = roll;
    this.prevY[i] = ball.y;
  }

  /** A pinball bumper: the racer leaves along the contact normal at least at BUMPER_KICK. */
  private kick(ball: Ball, bx: number, by: number) {
    const dx = ball.x - bx;
    const dy = ball.y - by;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return;
    const nx = dx / d;
    const ny = dy / d;
    const vn = ball.vx * nx + ball.vy * ny;
    const kick = BUMPER_KICK * this.unit;
    if (vn < kick) {
      ball.vx += (kick - vn) * nx;
      ball.vy += (kick - vn) * ny;
    }
  }

  /** A turbo pad: a burst of downward speed (harder for the favoured racer; the last lap's final strip only boosts it when rigged). */
  private boost(ctx: ModeContext, i: number, ball: Ball, pad: RacePad) {
    const v = this.view;
    const track = v.track!;
    pad.used |= 1 << i;
    const favoured = v.favoured;
    let factor = 1;
    if (favoured >= 0) {
      if (i === favoured) factor = RIG_TURBO_FACTOR;
      else if (pad.final && track.rows[pad.row].lap === track.laps - 1) {
        // The last lap's final strip is kept for the favourite: it drags everybody else.
        ball.vx *= RIG_STRIP_DRAG;
        ball.vy *= RIG_STRIP_DRAG;
        return;
      }
    }
    ball.vy = Math.max(ball.vy, 0) + TURBO_BOOST * factor * this.unit;
    ball.vx *= 0.6;
    const t = v.timeMs;
    pad.lastAtMs = t;
    pad.lastRacer = i;
    v.boostAtMs[i] = t;
    v.boosts++;
    this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: 2 * racerNote(i), level: 0.75 }, false);
  }

  /** Whether racer `i` has got below a zone's trigger line (or is done racing). */
  private beyond(i: number, zone: RaceSwapZone) {
    const ball = this.racerBall[i];
    return this.view.place[i] !== 0 || !ball || ball.y >= zone.y;
  }

  /**
   * Racer `i` crossed a swap zone's line: arm it, trigger the swap – or, when rigged, whatever favours the favourite.
   * Returns true when racer `i` was swapped (it now is somewhere else).
   */
  private enterZone(ctx: ModeContext, i: number, zone: RaceSwapZone): boolean {
    const v = this.view;
    const track = v.track!;
    const fav = v.favoured;
    if (fav >= 0 && zone.final && zone.lap === track.laps - 1) {
      // The last lap's final zone makes one move: the first racer to reach it hands its place to the favourite.
      zone.used = true;
      return i !== fav && !this.beyond(fav, zone) && this.swap(ctx, i, fav, zone);
    }
    if (fav >= 0 && i === fav) {
      // The favourite never arms a zone (it would be pulled back).
      return zone.first >= 0 && zone.first !== fav && v.place[zone.first] === 0 && this.swap(ctx, fav, zone.first, zone);
    }
    if (zone.first < 0 || v.place[zone.first] !== 0) {
      zone.first = i;
      return false;
    }
    if (fav >= 0 && !this.beyond(fav, zone)) return false; // a zone the favourite has not reached waits for it
    return this.swap(ctx, i, zone.first, zone);
  }

  /**
   * Swaps the positions (and velocities) of racers a and b; false when there was nothing to swap. In a staged race a swap
   * with the favourite leaves it the faster of the two downward speeds (a turbo-boosted favourite arriving from behind would
   * otherwise hand its speed to the rival it just passed, and lose).
   */
  private swap(ctx: ModeContext, a: number, b: number, zone: RaceSwapZone): boolean {
    const v = this.view;
    const A = this.racerBall[a];
    const B = this.racerBall[b];
    zone.used = true;
    if (!A || !B || a === b) return false;
    const t = v.timeMs;
    let x = A.x;
    A.x = B.x;
    B.x = x;
    x = A.y;
    A.y = B.y;
    B.y = x;
    x = A.vx;
    A.vx = B.vx;
    B.vx = x;
    x = A.vy;
    A.vy = B.vy;
    B.vy = x;
    // --- review fix (modes-rhythm) --- the favourite keeps the faster of the two speeds
    const fav = v.favoured;
    if (fav >= 0 && (a === fav || b === fav)) {
      const F = a === fav ? A : B;
      const R = a === fav ? B : A;
      if (R.vy > F.vy) {
        x = R.vx;
        R.vx = F.vx;
        F.vx = x;
        x = R.vy;
        R.vy = F.vy;
        F.vy = x;
      }
    }
    A.trail.length = 0;
    A.trailIndex = 0;
    B.trail.length = 0;
    B.trailIndex = 0;
    this.prevY[a] = A.y;
    this.prevY[b] = B.y;
    this.bestU[a] = this.bestU[b] = Math.min(this.bestU[a], this.bestU[b]);
    this.bestAtMs[a] = this.bestAtMs[b] = t;
    zone.a = a;
    zone.b = b;
    zone.atMs = t;
    v.swapAtMs[a] = t;
    v.swapAtMs[b] = t;
    v.swaps++;
    this.swappedThisStep = true;
    const gainer = A.y > B.y ? a : b;
    const loser = gainer === a ? b : a;
    this.callout("swap", gainer, loser, 0);
    const fa = racerNote(a);
    const fb = racerNote(b);
    this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: Math.min(fa, fb), chord: [fa, fb], accent: true }, true);
    return true;
  }

  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    const track = v.track;
    if (!track) return;
    if (v.phase !== "countdown") {
      // Racers bump into each other: equal masses, a damped rebound along the line of centres.
      const n = v.racers;
      for (let a = 0; a < n; a++) {
        const A = this.racerBall[a];
        if (!A) continue;
        for (let b = a + 1; b < n; b++) {
          const B = this.racerBall[b];
          if (!B) continue;
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const min = A.radius + B.radius;
          if (dx > min || dx < -min || dy > min || dy < -min) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          let nx: number;
          let ny: number;
          if (d > 1e-9) {
            nx = dx / d;
            ny = dy / d;
          } else {
            nx = a < b ? 1 : -1;
            ny = 0;
          }
          const push = (min - d) / 2;
          A.x -= nx * push;
          A.y -= ny * push;
          B.x += nx * push;
          B.y += ny * push;
          const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
          if (rel < 0) {
            const j = (-(1 + RACER_RESTITUTION) * rel) / 2;
            A.vx -= j * nx;
            A.vy -= j * ny;
            B.vx += j * nx;
            B.vy += j * ny;
          }
        }
      }
    }
    // Finishers of this sub-step, in the order they crossed.
    if (this.pendingCount > 0) {
      for (let p = 1; p < this.pendingCount; p++) {
        const r = this.pendingRacer[p];
        const t = this.pendingMs[p];
        let q = p;
        while (q > 0 && (this.pendingMs[q - 1] > t || (this.pendingMs[q - 1] === t && this.pendingRacer[q - 1] > r))) {
          this.pendingRacer[q] = this.pendingRacer[q - 1];
          this.pendingMs[q] = this.pendingMs[q - 1];
          q--;
        }
        this.pendingRacer[q] = r;
        this.pendingMs[q] = t;
      }
      for (let p = 0; p < this.pendingCount; p++) this.finish(ctx, this.pendingRacer[p], this.pendingMs[p]);
      this.pendingCount = 0;
    }
    this.subIndex++;
  }

  /** Racer i crossed the finish line at simulation time `atMs`. */
  private finish(ctx: ModeContext, i: number, atMs: number) {
    const v = this.view;
    if (v.place[i] !== 0) return;
    v.finishOrder.push(i);
    const place = v.finishOrder.length;
    v.place[i] = place;
    v.finishMs[i] = atMs - v.goAtMs;
    if (place === 1) {
      v.winner = i;
      v.winnerAtMs = atMs;
      this.callout("winner", i, -1, 1);
      this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: 523.25, race: "fanfare" }, true);
    } else if (place <= 3) this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: racerNote(i), race: "chime" }, true);
    else this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: racerNote(i), accent: true }, false);
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const track = v.track;
    if (!track) return;
    const t = v.timeMs;
    const S = track.field.size;
    const n = v.racers;
    // Progress, laps and the kicks that free a stuck racer.
    let front = 0;
    for (let i = 0; i < n; i++) {
      const ball = this.racerBall[i];
      if (!ball) continue;
      const u = v.place[i] > 0 ? Math.max(track.finishY - track.yStart, ball.y - track.yStart) : Math.max(0, ball.y - track.yStart);
      v.progress[i] = u;
      v.lap[i] = Math.max(1, Math.min(track.laps, 1 + Math.floor(Math.min(u, track.finishY - track.yStart - 1e-6) / track.lapLength)));
      if (v.phase !== "racing" || v.place[i] !== 0) continue;
      if (u > front) front = u;
      if (u > this.bestU[i] + STUCK_PROGRESS * S) {
        this.bestU[i] = u;
        this.bestAtMs[i] = t;
      } else if (t - this.bestAtMs[i] > STUCK_MS) {
        const side = ctx.random() < 0.5 ? -1 : 1;
        ball.vx = side * 0.45 * this.motion.vmax;
        ball.vy = -0.25 * this.motion.vmax;
        this.bestAtMs[i] = t;
        v.kicks++;
      }
    }
    if (v.phase === "racing") {
      // The standings: finishers in order, then the pack with a hysteresis; overtakes are called out.
      const leaderBefore = v.order[0];
      let bestPass = -1;
      let bestPassed = -1;
      let bestIndex = n;
      rankRacers(v.order, n, v.progress, v.place, this.hysteresis, (passer, passed, index) => {
        v.passes++;
        if (index < bestIndex) {
          bestIndex = index;
          bestPass = passer;
          bestPassed = passed;
        }
      });
      v.leader = v.order[0];
      const leadChange = v.order[0] !== leaderBefore && v.place[v.order[0]] === 0;
      if (leadChange) v.leadChanges++;
      if (bestPass >= 0 && !this.swappedThisStep) {
        const lead = bestIndex === 0 && leadChange;
        if (lead || t - this.lastCalloutMs >= CALLOUT_GAP_MS) {
          this.callout(lead ? "lead" : "pass", bestPass, bestPassed, bestIndex + 1);
          this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: racerNote(bestPass), race: "chime" }, true);
        }
      }
      // Interval timing: when the front reached each stretch, and every racer's gap to it.
      this.clock.advance(Math.max(front, this.clock.getFront()), t);
      for (let i = 0; i < n; i++) v.gapMs[i] = v.place[i] > 0 ? v.finishMs[i] - (v.winner >= 0 ? v.finishMs[v.winner] : 0) : this.clock.gapMs(v.progress[i], t);
      // The final lap.
      if (track.laps > 1 && v.finalLapAtMs === -Infinity && v.lap[v.leader] === track.laps && v.place[v.leader] === 0) {
        v.finalLapAtMs = t;
        this.callout("finalLap", v.leader, -1, 1);
        this.queueNote(ctx, { type: "hit", wallIndex: 0, frequency: 659.25, race: "chime" }, true);
      }
      // The end of the race: everybody home, the stragglers DNF after the winner's grace period, or the time limit.
      let racing = 0;
      for (let i = 0; i < n; i++) if (v.place[i] === 0) racing++;
      const timeUp = (v.winner >= 0 && t - v.winnerAtMs >= dnfGraceMs(v.finishMs[v.winner])) || t - v.goAtMs >= v.timeLimitMs;
      if (racing === 0 || timeUp) {
        if (racing > 0) {
          // A backstop (the limit grows with the track and the tempo): with nobody home at the time limit the racers are
          // placed where they are – the favourite first – so there is always a winner, a podium and a fanfare.
          if (v.winner < 0) {
            if (v.favoured >= 0 && v.favoured < n && v.place[v.favoured] === 0) this.finish(ctx, v.favoured, t);
            for (const i of v.order) if (v.place[i] === 0) this.finish(ctx, i, t);
          }
          for (const i of v.order) if (v.place[i] === 0) v.place[i] = -1;
          rankRacers(v.order, n, v.progress, v.place, this.hysteresis);
        }
        v.leader = v.order[0];
        v.phase = "podium";
        v.completeAtMs = t;
      }
    } else if (v.phase === "podium" || v.phase === "cup") {
      // Confetti over the podium, then the cup table (with the cup on), then the end of the run.
      const since = t - v.completeAtMs;
      while (this.confettiDone < 3 && since >= this.confettiDone * 350) {
        const x = track.left + track.width * (0.25 + 0.25 * this.confettiDone);
        ctx.spawnConfetti(x, v.cameraY + track.field.top + 0.28 * S);
        this.confettiDone++;
      }
      if (v.phase === "podium" && since >= PODIUM_MS) {
        if (this.settings.cup) {
          v.phase = "cup";
          v.cupAtMs = t;
        } else {
          v.phase = "done";
          v.finished = true;
        }
      } else if (v.phase === "cup" && t - v.cupAtMs >= CUP_MS) {
        v.phase = "done";
        v.finished = true;
      }
    }
    this.updateCamera(dtMs / 1000);
  }

  /** The camera eases toward the leader (or the middle of the pack) and, once the race is over, the finish. */
  private updateCamera(dt: number) {
    const v = this.view;
    const track = v.track!;
    const f = track.field;
    const S = f.size;
    const minCam = this.startCamera(track);
    const maxCam = track.floorY + 0.04 * S - f.bottom;
    let target = minCam;
    if (v.phase === "racing") {
      let focus = -1;
      for (const i of v.order) {
        if (v.place[i] === 0) {
          focus = i;
          break;
        }
      }
      const focusBall = focus >= 0 ? this.racerBall[focus] : null;
      if (focusBall) {
        const lead = focusBall.y;
        target = lead - f.top - LEADER_VIEW * S;
        if (v.settings.camera === "pack") {
          let back = lead;
          for (let i = 0; i < v.racers; i++) {
            const b = this.racerBall[i];
            if (b && v.place[i] === 0 && b.y < back) back = b.y;
          }
          const mid = (lead + back) / 2 - f.top - 0.5 * S;
          target = Math.max(lead - f.top - 0.85 * S, Math.min(lead - f.top - 0.15 * S, mid));
        }
      } else target = track.finishY - f.top - 0.45 * S;
    } else if (v.phase !== "countdown") target = track.finishY - f.top - 0.45 * S;
    target = Math.max(minCam, Math.min(maxCam, target));
    v.cameraY += (target - v.cameraY) * (1 - Math.exp(-dt / CAMERA_TAU));
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** No rings: the walls, the obstacles and the sensors are the mode's own. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { phase: v.phase, leader: v.leader, winner: v.winner, finished: v.finished, passes: v.passes, swaps: v.swaps, boosts: v.boosts, hits: v.hits, cameraY: v.cameraY };
  }

  /**
   * A canvas resize before the first step lays the track out afresh for the new size from the same random numbers
   * (exactly what an init at that size gives); later it rescales the whole track, the racers and the camera onto the new
   * field. The layout and the physics scale with the field, but float rounding can still play a race out differently at
   * another canvas size, so the page drops a found seed when the canvas is resized (Canvas `onSizeChange`).
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const track = this.view.track;
    if (!sizeChanged || !track || this.layoutW <= 0 || this.layoutH <= 0) return true;
    if (this.started) this.rescale(ctx);
    else this.relayout(ctx);
    return true;
  }

  private relayout(ctx: ModeContext) {
    const cfg = ctx.config;
    let k = 0;
    const track = buildRaceTrack(cfg.width, cfg.height, this.settings, cfg.ballRadius || 8, () => (k < this.tape.length ? this.tape[k++] : 0.5));
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    const v = this.view;
    v.track = track;
    v.cameraY = this.startCamera(track);
    this.refreshBalls(ctx);
    for (let i = 0; i < v.racers; i++) {
      const ball = this.racerBall[i];
      if (!ball) continue;
      ball.x = track.startX[i];
      ball.y = track.startY[i];
      ball.vx = 0;
      ball.vy = 0;
      ball.radius = track.racerRadius;
      ball.trail.length = 0;
      ball.trailIndex = 0;
      this.prevY[i] = ball.y;
    }
    this.clock.reset(track.finishY - track.yStart, COUNTDOWN_MS);
    this.updateMotion(ctx);
  }

  /**
   * Maps the track onto the field of the new canvas size: every world position p → n + (p − o) · k, with o / n the top
   * left of the old / new field and k the ratio of their sizes; lengths scale by k. The engine has already moved the
   * racers around the canvas centre, so that move is undone first.
   */
  private rescale(ctx: ModeContext) {
    const v = this.view;
    const track = v.track!;
    const cfg = ctx.config;
    const oldW = this.layoutW;
    const oldH = this.layoutH;
    const next = buildRaceField(cfg.width, cfg.height);
    const old = track.field;
    const k = next.size / old.size;
    const mx = (x: number) => next.left + (x - old.left) * k;
    const my = (y: number) => next.top + (y - old.top) * k;
    this.refreshBalls(ctx);
    for (let i = 0; i < v.racers; i++) {
      const ball = this.racerBall[i];
      if (!ball) continue;
      const x = oldW / 2 + (ball.x - cfg.width / 2) * (oldW / cfg.width);
      const y = oldH / 2 + (ball.y - cfg.height / 2) * (oldH / cfg.height);
      ball.x = mx(x);
      ball.y = my(y);
      ball.vx *= k;
      ball.vy *= k;
      ball.radius *= k;
      this.prevY[i] = my(this.prevY[i]);
      this.bestU[i] *= k;
    }
    for (const o of track.obstacles) {
      const s = o.shape;
      s.x = mx(s.x);
      s.y = my(s.y);
      if (s.kind === "circle") s.radius *= k;
      else {
        s.halfLength *= k;
        s.thickness *= k;
      }
    }
    for (const p of track.pads) {
      p.x0 = mx(p.x0);
      p.x1 = mx(p.x1);
      p.y0 = my(p.y0);
      p.y1 = my(p.y1);
    }
    for (const z of track.zones) {
      z.y0 = my(z.y0);
      z.y1 = my(z.y1);
      z.y = my(z.y);
    }
    for (const row of track.rows) {
      row.top = my(row.top);
      row.bottom = my(row.bottom);
    }
    for (let i = 0; i < track.grid.length; i++) {
      track.grid[i].x = mx(track.grid[i].x);
      track.grid[i].y = my(track.grid[i].y);
    }
    for (let i = 0; i < track.startX.length; i++) {
      track.startX[i] = mx(track.startX[i]);
      track.startY[i] = my(track.startY[i]);
    }
    track.left = mx(track.left);
    track.right = mx(track.right);
    track.width *= k;
    track.racerRadius *= k;
    v.cameraY = my(v.cameraY + old.top) - next.top;
    track.yStart = my(track.yStart);
    track.finishY = my(track.finishY);
    track.floorY = my(track.floorY);
    track.ceilingY = my(track.ceilingY);
    track.lapLength *= k;
    track.field = next;
    for (let i = 0; i < v.racers; i++) v.progress[i] *= k;
    this.clock.reset(track.finishY - track.yStart, v.timeMs);
    this.clock.advance(Math.max(0, ...Array.from(v.progress.subarray(0, v.racers))), v.timeMs);
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    this.updateMotion(ctx);
  }
}
