import type { CircularWall, ModeId, PhysicsConfig } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";

/**
 * Timeline keyframes – numeric settings automated over the clip. A keyframe says "at `time` seconds of simulation time,
 * `key` is `value`"; between two keyframes of a setting the value moves in a straight line, before its first keyframe
 * it holds the first value and after its last the last one. Pure data and maths, no DOM, unit-tested in
 * tests/timeline.test.ts; the panel is components/simulator/sections/TimelineSection.tsx and the bar under the canvas
 * components/simulator/TimelineBar.tsx.
 *
 * The keyframes travel inside the physics config (`PhysicsConfig.timeline`), so the engine – and the seed finder, which
 * copies the page engine's config – evaluates them at the start of every fixed 60 Hz step from the simulation clock
 * (`TimelineRuntime`): the automation never depends on the frame rate, the playback speed or the wall clock, and a found
 * seed replays with it exactly. The automated values only live in the engine's config: the settings keep the values the
 * user set (the "base" values a setting returns to once its keyframes are gone).
 */

/**
 * The settings a keyframe can drive: every numeric setting the engine takes live, without restarting the run (the
 * ranges come from `RANGES` in settings.ts). Settings that rebuild the playfield (wall count, the mode blocks) are left
 * out – a keyframe would restart the run on every step.
 */
export const TIMELINE_KEYS = [
  "gravity",
  "ballSpeed",
  "ballRadius",
  "rotationSpeed",
  "gapSize",
  "airDrag",
  "windX",
  "windY",
  "spinStrength",
  "rotatingGravity",
  "wallBounciness",
  "breathingAmplitude",
  "breathingSpeed",
  "bumperBoost",
] as const;
export type TimelineKey = (typeof TIMELINE_KEYS)[number];

export function isTimelineKey(value: unknown): value is TimelineKey {
  return typeof value === "string" && (TIMELINE_KEYS as readonly string[]).includes(value);
}

export interface Keyframe {
  /** Seconds of simulation time (0–120, 0.1 s steps). */
  time: number;
  /** The setting it drives. */
  key: TimelineKey;
  /** The setting's value at `time`, inside its slider range and on its step. */
  value: number;
}

export interface TimelineSettings {
  /** The keyframes, sorted by time (then by setting); empty = no automation (URL `kf`). */
  keyframes: Keyframe[];
}

export function defaultTimelineSettings(): TimelineSettings {
  return { keyframes: [] };
}

/** The most keyframes a clip carries (all settings together). */
export const MAX_KEYFRAMES = 40;

/** Range of a keyframe's time, keyed like `RANGES` in settings.ts (which spreads it). */
export const TIMELINE_RANGES = {
  keyframeTime: { min: 0, max: 120, step: 0.1 },
} as const;

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}
/** Slider ranges of the automatable settings – `RANGES` of settings.ts, passed in so this module stays free of it. */
export type TimelineRanges = Readonly<Record<TimelineKey, NumericRange>>;

/** Short codes of the URL form: the settings' own URL keys (`g`, `s`, `r`, … as in `NUMERIC_URL_KEYS`, `obb`). */
export const TIMELINE_KEY_CODES: Readonly<Record<TimelineKey, string>> = {
  gravity: "g",
  ballSpeed: "s",
  ballRadius: "r",
  rotationSpeed: "rs",
  gapSize: "gap",
  airDrag: "drag",
  windX: "wx",
  windY: "wy",
  spinStrength: "spin",
  rotatingGravity: "rg",
  wallBounciness: "wb",
  breathingAmplitude: "bw",
  breathingSpeed: "bws",
  bumperBoost: "obb",
};

/** Other names a hand-written link or preset may use for a setting. */
const KEY_ALIASES: Readonly<Record<string, TimelineKey>> = {
  ballSize: "ballRadius",
  wallRotationSpeed: "rotationSpeed",
  wallGap: "gapSize",
  breathingWalls: "breathingAmplitude",
};

/** The setting a name stands for: a canonical key, its URL code or an alias (`ballSize`, `wallRotationSpeed`, `wallGap`); null otherwise. */
export function timelineKeyOf(value: unknown): TimelineKey | null {
  if (typeof value !== "string" || !value) return null;
  if (isTimelineKey(value)) return value;
  for (const key of TIMELINE_KEYS) if (TIMELINE_KEY_CODES[key] === value) return key;
  return Object.prototype.hasOwnProperty.call(KEY_ALIASES, value) ? KEY_ALIASES[value] : null;
}

/** Label keys (Controls namespace) of the panel's sliders for each setting – the slider shows the AUTO badge by it. */
export const TIMELINE_SLIDER_LABELS: Readonly<Record<TimelineKey, string>> = {
  gravity: "gravity",
  ballSpeed: "ballSpeed",
  ballRadius: "ballSize",
  rotationSpeed: "rotationSpeed",
  gapSize: "gapSize",
  airDrag: "airDrag",
  windX: "windX",
  windY: "windY",
  spinStrength: "spinStrength",
  rotatingGravity: "rotatingGravity",
  wallBounciness: "wallBounciness",
  breathingAmplitude: "breathingWalls",
  breathingSpeed: "breathingSpeed",
  bumperBoost: "bumperBoost",
};

/** The setting a panel slider (by its label key) shows, or null for a slider the timeline cannot drive. */
export function timelineKeyForLabel(labelKey: string): TimelineKey | null {
  for (const key of TIMELINE_KEYS) if (TIMELINE_SLIDER_LABELS[key] === labelKey) return key;
  return null;
}

/** The setting's name in the Timeline section (Controls namespace): the slider label, spelt out where it is ambiguous on its own. */
export function timelineKeyLabel(key: TimelineKey): string {
  return key === "rotationSpeed" ? "timelineRotationSpeed" : TIMELINE_SLIDER_LABELS[key];
}

/** Modes whose rings are built from the gap size: Classic (a gap in every ring), Accumulation and Multiply (one ring, one gap). */
export const GAP_SIZED_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply"];
/** Modes whose Wall section shows the gap size and the rotation (mirrors `hasGapControls` in Controls.tsx). */
const GAP_CONTROL_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "portal", "grow"];

/**
 * Whether the Timeline section offers `key` in `mode` – the settings the panel shows there: the gap size and the rotation
 * speed with the Wall section's gap controls, the bumper boost with the obstacle editor (`obstacles`). Keyframes of the
 * others are kept (they carry over mode changes) but do nothing here.
 */
export function timelineKeyShown(key: TimelineKey, mode: ModeId, obstacles: boolean): boolean {
  if (key === "gapSize" || key === "rotationSpeed") return GAP_CONTROL_MODES.includes(mode);
  if (key === "bumperBoost") return obstacles;
  return true;
}

/* ------------------------------------------------------------------ numbers */

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Clamps `value` into the range and snaps it to the range's step (without float noise: 0.35, not 0.35000000000000003). */
export function snapToRange(value: number, range: NumericRange): number {
  const clamped = Math.max(range.min, Math.min(range.max, value));
  const snapped = Number((Math.round(clamped / range.step) * range.step).toFixed(decimalsOf(range.step)));
  return Math.max(range.min, Math.min(range.max, snapped));
}

/** A keyframe time as stored: clamped to 0–120 s and rounded to 0.1 s. */
export function snapKeyframeTime(seconds: number): number {
  return snapToRange(Number.isFinite(seconds) ? seconds : 0, TIMELINE_RANGES.keyframeTime);
}

/** Up to three decimals, trailing zeros dropped ("0.25", "1500", "-0.05"). */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** A setting's value the way its slider in the panel shows it ("842", "12.5px", "30%", "+0.25", "×1.30"). */
export function formatTimelineValue(key: TimelineKey, value: number): string {
  const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, "");
  switch (key) {
    case "ballRadius":
      return `${trim(value, 1)}px`;
    case "rotationSpeed":
      return value.toFixed(1);
    case "gapSize":
      return value.toFixed(2);
    case "airDrag":
      return `${(100 * value).toFixed(1)}%`;
    case "windX":
    case "windY":
      return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
    case "spinStrength":
    case "wallBounciness":
    case "breathingAmplitude":
      return `${Math.round(100 * value)}%`;
    case "breathingSpeed":
      return `${value.toFixed(1)} Hz`;
    case "rotatingGravity":
      return `${Math.round(value)}°/s`;
    case "bumperBoost":
      return `×${value.toFixed(2)}`;
    default:
      return String(Math.round(value));
  }
}

/** "12.3 s"-style time of a keyframe or of the playhead (one decimal, "0" not "0.0"). */
export function formatTimelineTime(seconds: number): string {
  const s = Math.max(0, seconds);
  return s.toFixed(1).replace(/\.0$/, "");
}

/* ------------------------------------------------------------------ validation */

/** A valid keyframe from anything (a preset entry, a parsed link), or null: unknown setting, missing time or value. */
export function sanitizeKeyframe(value: unknown, ranges: TimelineRanges): Keyframe | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const key = timelineKeyOf(source.key);
  if (!key) return null;
  const time = toNumber(source.time);
  const v = toNumber(source.value);
  if (!Number.isFinite(time) || !Number.isFinite(v)) return null;
  return { time: snapKeyframeTime(time), key, value: snapToRange(v, ranges[key]) };
}

/** The canonical order of a keyframe list: by time, then by the setting's place in `TIMELINE_KEYS`. */
export function compareKeyframes(a: Keyframe, b: Keyframe): number {
  return a.time - b.time || TIMELINE_KEYS.indexOf(a.key) - TIMELINE_KEYS.indexOf(b.key);
}

/**
 * A valid keyframe list: bad entries dropped, one keyframe per setting and time (a later one replaces an earlier one –
 * that is how "add a keyframe where there is one" updates it), at most `MAX_KEYFRAMES`, in the canonical order.
 * Anything but an array is no keyframes.
 */
export function resolveKeyframes(value: unknown, ranges: TimelineRanges): Keyframe[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, Keyframe>();
  for (const entry of value) {
    const keyframe = sanitizeKeyframe(entry, ranges);
    if (!keyframe) continue;
    const id = `${keyframe.key}@${keyframe.time}`;
    if (!byId.has(id) && byId.size >= MAX_KEYFRAMES) continue;
    byId.set(id, keyframe);
  }
  return [...byId.values()].sort(compareKeyframes);
}

/** Validates the keyframe field of a preset (or any settings-like object). */
export function resolveTimelineSettings(source: Partial<Record<keyof TimelineSettings, unknown>> | null | undefined, ranges: TimelineRanges): TimelineSettings {
  return { keyframes: resolveKeyframes(source?.keyframes, ranges) };
}

/** Picks the keyframe field out of the settings, copying the list. */
export function timelineSettingsOf(settings: TimelineSettings): TimelineSettings {
  return { keyframes: settings.keyframes.map((k) => ({ ...k })) };
}

/** What a mode change keeps: the keyframes (they script the clip, whatever the mode; unused settings simply do nothing). */
export function timelineCarryOver(settings: TimelineSettings): TimelineSettings {
  return timelineSettingsOf(settings);
}

/* ------------------------------------------------------------------ list edits (the panel) */

/** Adds (or, at a setting's existing time, replaces) a keyframe; the result is validated and sorted. */
export function addKeyframe(list: readonly Keyframe[], keyframe: Keyframe, ranges: TimelineRanges): Keyframe[] {
  return resolveKeyframes([...list, keyframe], ranges);
}

/** Changes the keyframe at `index` (its time or value); moved onto another keyframe of its setting, it replaces that one. */
export function updateKeyframe(list: readonly Keyframe[], index: number, patch: Partial<Pick<Keyframe, "time" | "value">>, ranges: TimelineRanges): Keyframe[] {
  if (index < 0 || index >= list.length) return resolveKeyframes(list, ranges);
  const others = list.filter((_, i) => i !== index);
  return resolveKeyframes([...others, { ...list[index], ...patch }], ranges);
}

export function removeKeyframe(list: readonly Keyframe[], index: number): Keyframe[] {
  return list.filter((_, i) => i !== index);
}

/* ------------------------------------------------------------------ URL form */

/**
 * The compact URL form: one group per setting – its code, then time / value pairs, joined by "_" – and groups joined by
 * "*", e.g. `g_0_300_10_1200*r_0_8_4_20` (gravity 300 → 1200 over the first 10 s, ball size 8 → 20 px over 4 s). Only
 * characters a URL keeps as they are, so the link stays short and readable.
 */
export function serializeKeyframes(keyframes: readonly Keyframe[]): string {
  const groups: string[] = [];
  for (const key of TIMELINE_KEYS) {
    const frames = keyframes.filter((k) => k.key === key && Number.isFinite(k.time) && Number.isFinite(k.value)).sort((a, b) => a.time - b.time);
    if (frames.length === 0) continue;
    const parts = [TIMELINE_KEY_CODES[key]];
    for (const frame of frames) parts.push(formatNumber(frame.time), formatNumber(frame.value));
    groups.push(parts.join("_"));
  }
  return groups.join("*");
}

/** Reads the URL form back: unknown settings and incomplete pairs are skipped, every value validated like a preset's. */
export function parseKeyframes(text: string | null | undefined, ranges: TimelineRanges): Keyframe[] {
  if (!text) return [];
  const raw: { key: TimelineKey; time: string; value: string }[] = [];
  for (const group of text.split("*")) {
    const [code = "", ...numbers] = group.split("_");
    const key = timelineKeyOf(code);
    if (!key) continue;
    for (let i = 0; i + 1 < numbers.length; i += 2) raw.push({ key, time: numbers[i], value: numbers[i + 1] });
  }
  return resolveKeyframes(raw, ranges);
}

/** Writes `kf` when there are keyframes (the default – none – keeps links short). */
export function writeTimelineParams(settings: TimelineSettings, params: URLSearchParams): void {
  if (settings.keyframes.length > 0) params.set("kf", serializeKeyframes(settings.keyframes));
}

/** Reads `kf` into `settings` (no parameter = no keyframes). */
export function readTimelineParams(params: URLSearchParams, settings: TimelineSettings, ranges: TimelineRanges): void {
  settings.keyframes = parseKeyframes(params.get("kf"), ranges);
}

/* ------------------------------------------------------------------ interpolation */

/**
 * The value of a track at second `t`: `times` ascending and distinct, `values` alongside. Linear between two keyframes,
 * the first value before the first keyframe (and for a NaN time), the last value from the last keyframe on.
 */
export function interpolateTrack(times: readonly number[], values: readonly number[], t: number): number {
  const n = times.length;
  if (n === 0) return NaN;
  if (!(t > times[0])) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const u = (t - times[lo]) / (times[hi] - times[lo]);
  return values[lo] + (values[hi] - values[lo]) * u;
}

/** `∫ v` from the first keyframe's time to `t` of the track's value `v` (negative before it) – the trapezoids of the piecewise-linear value. */
function trackPrimitive(times: readonly number[], values: readonly number[], t: number): number {
  const n = times.length;
  if (!(t > times[0])) return values[0] * (t - times[0]);
  let area = 0;
  for (let i = 1; i < n; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (t < b) {
      const va = values[i - 1];
      const vt = va + (values[i] - va) * ((t - a) / (b - a));
      return area + 0.5 * (va + vt) * (t - a);
    }
    area += 0.5 * (values[i - 1] + values[i]) * (b - a);
  }
  return area + values[n - 1] * (t - times[n - 1]);
}

/**
 * The integral of a track's value from 0 s to second `t` (value × seconds) – exact for the piecewise-linear value
 * `interpolateTrack()` gives (held before the first keyframe and after the last). A keyframed *rate* turns into a phase
 * this way: gravity turned by `∫ rotatingGravity` degrees, the breathing walls `∫ breathingSpeed` cycles into their
 * pulse. (Rate × t would be wrong while the rate changes: the phase would move at `rate + t · rate′` and jump with every
 * step's new rate.) NaN without keyframes. Allocation-free.
 */
export function integrateTrack(times: readonly number[], values: readonly number[], t: number): number {
  if (times.length === 0 || Number.isNaN(t)) return NaN;
  return trackPrimitive(times, values, t) - trackPrimitive(times, values, 0);
}

/**
 * Rate settings: the engine turns them into a phase (gravity's direction, the breathing pulse). While one is keyframed
 * the engine integrates its keyframes (`TimelineRuntime.integralAt()`) instead of multiplying the rate by the time.
 * (The wall rotation speed needs nothing: the engine adds rate × step to the rotation every step.)
 */
export const TIMELINE_RATE_KEYS: readonly TimelineKey[] = ["rotatingGravity", "breathingSpeed"];

/** One setting's keyframes, ready for `interpolateTrack()`: ascending, distinct times (a later keyframe at a time wins). */
export interface TimelineTrack {
  readonly key: TimelineKey;
  readonly times: readonly number[];
  readonly values: readonly number[];
}

/**
 * Groups keyframes into tracks, one per setting in `TIMELINE_KEYS` order (the order the engine applies them in).
 * Entries with an unknown setting or a non-finite time or value are skipped; nothing is clamped here (settings.ts
 * validates what the page sends).
 */
export function compileTimeline(keyframes: readonly Keyframe[] | null | undefined): TimelineTrack[] {
  if (!keyframes || keyframes.length === 0) return [];
  const tracks: TimelineTrack[] = [];
  for (const key of TIMELINE_KEYS) {
    const byTime = new Map<number, number>();
    for (const k of keyframes) {
      if (k && k.key === key && Number.isFinite(k.time) && Number.isFinite(k.value)) byTime.set(k.time, k.value);
    }
    if (byTime.size === 0) continue;
    const times = [...byTime.keys()].sort((a, b) => a - b);
    tracks.push({ key, times, values: times.map((time) => byTime.get(time) as number) });
  }
  return tracks;
}

/** The value of `key` at simulation second `t`, or null when it has no keyframes (it keeps its slider value). */
export function timelineValueAt(keyframes: readonly Keyframe[], key: TimelineKey, t: number): number | null {
  const track = compileTimeline(keyframes.filter((k) => k.key === key))[0];
  return track ? interpolateTrack(track.times, track.values, t) : null;
}

/** Every automated setting's value at simulation second `t`. */
export function timelineValuesAt(keyframes: readonly Keyframe[], t: number): Partial<Record<TimelineKey, number>> {
  const out: Partial<Record<TimelineKey, number>> = {};
  for (const track of compileTimeline(keyframes)) out[track.key] = interpolateTrack(track.times, track.values, t);
  return out;
}

/**
 * A setting's own value – its slider's, the value a new keyframe gets and the one it returns to without keyframes. (Typed
 * so every `TIMELINE_KEYS` entry has to be a numeric setting.)
 */
export function baseValueOf(settings: Pick<SimulatorSettings, TimelineKey>, key: TimelineKey): number {
  return settings[key];
}

/** The settings with keyframes, in `TIMELINE_KEYS` order. */
export function automatedKeys(keyframes: readonly Keyframe[]): TimelineKey[] {
  return TIMELINE_KEYS.filter((key) => keyframes.some((k) => k.key === key));
}

/**
 * The keyframes the engine plays for these settings: all of them, but the rotation speed's only while the rotation is on
 * (switched off, the rings stand still whatever the keyframes say – the Wall section hides the speed then).
 */
export function engineTimelineOf(settings: { keyframes: readonly Keyframe[]; rotationEnabled: boolean }): Keyframe[] {
  return settings.rotationEnabled ? settings.keyframes.slice() : settings.keyframes.filter((k) => k.key !== "rotationSpeed");
}

/* ------------------------------------------------------------------ the engine side */

/**
 * Resizes the rings' gaps in place to `gap` radians, each gap keeping its start angle – exactly the gap a fresh build with
 * that size gives a ring – while the rotation, the broken rings and the run go on (a gap-size change through
 * `setConfig()` rebuilds the rings instead). Only in the modes whose rings are built from the gap size; the others keep
 * their own gaps (Portal's portals, Shatter's broken segments).
 */
export function resizeGaps(walls: readonly CircularWall[], gap: number, mode: ModeId | undefined): void {
  if (!mode || !GAP_SIZED_MODES.includes(mode)) return;
  for (const wall of walls) {
    if (wall.gaps.length === 1) wall.gaps[0].endAngle = wall.gaps[0].startAngle + gap;
  }
}

function trackSignature(tracks: readonly TimelineTrack[]): string {
  return tracks.map((t) => `${t.key}:${t.times.join(",")}:${t.values.join(",")}`).join("|");
}

const NO_KEYS: ReadonlySet<TimelineKey> = new Set();

/** What `TimelineRuntime.prepare()` makes of a config patch. */
export interface PreparedPatch {
  /** The patch to apply as always: the automated settings taken out, the released ones back at their base values. */
  rest: Partial<PhysicsConfig>;
  /** A gap size to set in place (`resizeGaps()`), or null. */
  gap: number | null;
  /** The keyframes changed: the engine applies them at the current time. */
  retimed: boolean;
}

/**
 * The engine's half of the timeline (PhysicsEngine owns one). It keeps the compiled tracks and, for every automated
 * setting, its base value – the page's own value, which the setting returns to once its keyframes are gone:
 *
 * - `prepare()` sorts a `setConfig()` patch: a new keyframe list is compiled (only when it really changed); a value the
 *   page sends for an automated setting becomes its base instead of overriding the keyframes; a setting whose keyframes
 *   are gone gets its base back (the gap size in place, so its rings are not rebuilt).
 * - `patchAt()` / `gapAt()` give the values at a simulation second that differ from the config – the engine applies them
 *   at the start of every fixed step and when a run starts (at 0 s). Nothing is allocated while no value changes.
 * - `integralAt()` gives a keyframed rate's integral since 0 s – the phase the engine uses for the rate settings
 *   (`TIMELINE_RATE_KEYS`) while they are automated.
 */
export class TimelineRuntime {
  private tracks: TimelineTrack[] = [];
  private gapTrack: TimelineTrack | null = null;
  /** The rate settings' tracks (`TIMELINE_RATE_KEYS`), for `integralAt()`. */
  private rateTracks: Partial<Record<TimelineKey, TimelineTrack>> = {};
  private signature = "";
  private keys: ReadonlySet<TimelineKey> = NO_KEYS;
  private readonly base: Partial<Record<TimelineKey, number>> = {};

  /** True while any setting has keyframes. */
  get active(): boolean {
    return this.tracks.length > 0;
  }

  isAutomated(key: TimelineKey): boolean {
    return this.keys.has(key);
  }

  getTracks(): readonly TimelineTrack[] {
    return this.tracks;
  }

  /** The page's own value of an automated setting (undefined while it has none on record). */
  baseOf(key: TimelineKey): number | undefined {
    return this.base[key];
  }

  prepare(patch: Partial<PhysicsConfig>, config: Readonly<PhysicsConfig>): PreparedPatch {
    const was = this.keys;
    let retimed = false;
    if (patch.timeline !== undefined) {
      const tracks = compileTimeline(patch.timeline);
      const signature = trackSignature(tracks);
      if (signature !== this.signature) {
        retimed = true;
        this.tracks = tracks;
        this.signature = signature;
        this.gapTrack = tracks.find((t) => t.key === "gapSize") ?? null;
        this.rateTracks = {};
        for (const track of tracks) if (TIMELINE_RATE_KEYS.includes(track.key)) this.rateTracks[track.key] = track;
        this.keys = new Set(tracks.map((t) => t.key));
      }
    }
    const now = this.keys;
    const rest: Record<string, unknown> = {};
    let gap: number | null = null;
    for (const field of Object.keys(patch) as (keyof PhysicsConfig)[]) {
      const value = patch[field];
      if (isTimelineKey(field) && typeof value === "number") {
        if (now.has(field)) {
          this.base[field] = value; // the keyframes keep the setting; the page's value waits as its base
          continue;
        }
        if (field === "gapSize" && was.has(field)) {
          gap = value; // released: back to the page's value, in place
          continue;
        }
      }
      rest[field] = value;
    }
    if (retimed) {
      for (const key of was) {
        if (now.has(key) || key in patch) continue;
        const value = this.base[key] ?? (config[key] as number | undefined);
        if (value === undefined) continue;
        if (key === "gapSize") gap = value;
        else rest[key] = value;
      }
      for (const key of now) {
        if (!was.has(key) && !(key in patch) && typeof config[key] === "number") this.base[key] = config[key] as number;
      }
    }
    return { rest: rest as Partial<PhysicsConfig>, gap, retimed };
  }

  /** The automated values at simulation second `t` that differ from `config` (the gap size aside: `gapAt()`), or null. */
  patchAt(t: number, config: Readonly<PhysicsConfig>): Partial<PhysicsConfig> | null {
    let patch: Record<string, number> | null = null;
    for (const track of this.tracks) {
      if (track === this.gapTrack) continue;
      const value = interpolateTrack(track.times, track.values, t);
      if (config[track.key] !== value) (patch ??= {})[track.key] = value;
    }
    return patch as Partial<PhysicsConfig> | null;
  }

  /** The automated gap size at simulation second `t` when it differs from `config`, else null. */
  gapAt(t: number, config: Readonly<PhysicsConfig>): number | null {
    const track = this.gapTrack;
    if (!track) return null;
    const value = interpolateTrack(track.times, track.values, t);
    return config.gapSize !== value ? value : null;
  }

  /**
   * A keyframed rate setting (`TIMELINE_RATE_KEYS`) integrated from 0 s to simulation second `t` (`integrateTrack()`:
   * degrees gravity has turned, cycles the walls have breathed), or NaN while `key` has no keyframes – the engine then
   * keeps its rate × t. Allocation-free.
   */
  integralAt(key: TimelineKey, t: number): number {
    const track = this.rateTracks[key];
    return track ? integrateTrack(track.times, track.values, t) : NaN;
  }
}

/* ------------------------------------------------------------------ the bar under the canvas */

/** Marker colour of each setting on the bar and in the panel's list (the lime accent first). */
export const TIMELINE_KEY_COLORS: Readonly<Record<TimelineKey, string>> = {
  gravity: "#93d119",
  ballSpeed: "#22d3ee",
  ballRadius: "#f472b6",
  rotationSpeed: "#facc15",
  gapSize: "#fb923c",
  airDrag: "#a78bfa",
  windX: "#38bdf8",
  windY: "#2dd4bf",
  spinStrength: "#e879f9",
  rotatingGravity: "#4ade80",
  wallBounciness: "#f87171",
  breathingAmplitude: "#60a5fa",
  breathingSpeed: "#c084fc",
  bumperBoost: "#fbbf24",
};

/** Seconds the timeline bar spans: the clip (the recording duration), or up to the last keyframe when that is later. */
export function timelineSpan(keyframes: readonly Keyframe[], clipSec: number): number {
  let span = Number.isFinite(clipSec) && clipSec > 0 ? clipSec : 30;
  for (const k of keyframes) if (k.time > span) span = k.time;
  return span;
}

/** Where second `t` sits on a bar spanning `span` seconds (0–1, clamped). */
export function timelinePosition(t: number, span: number): number {
  if (!(span > 0) || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, t / span));
}
