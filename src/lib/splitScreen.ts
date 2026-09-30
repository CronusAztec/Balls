import { isModeId, type ModeId } from "@/lib/physics/types";

/*
 * --- split-screen --- Split-screen races: 2 or 4 arenas run at once on one canvas and one recording, each with its own
 * physics engine (lib/simulation/multi.ts) built from the shared settings plus its own overrides – a label, and optionally
 * a seed, gravity, ball speed, ball colour and (from the second arena on) a mode. This module is the pure part: the
 * settings fields with their defaults, validation and URL form (`ac`, `al`, `sa` and the compact `ar`), the override merge,
 * the viewport maths the canvas draws the arenas with (splitScreenCanvas.tsx) and the race standings of the banner.
 */

/** Arenas on the canvas: 1 is the classic single view. */
export const ARENA_COUNTS = [1, 2, 4] as const;
export type ArenaCount = (typeof ARENA_COUNTS)[number];
/** "row": the arenas side by side; "grid": 2 × 2 (four arenas) or stacked (two). */
export const ARENA_LAYOUTS = ["row", "grid"] as const;
export type ArenaLayout = (typeof ARENA_LAYOUTS)[number];
/** Whose bounces are heard: the first arena's only, or every arena's. */
export const SOUND_ARENAS = ["first", "all"] as const;
export type SoundArena = (typeof SOUND_ARENAS)[number];

export const MAX_ARENAS = 4;
/** Longest arena label (characters). */
export const MAX_ARENA_LABEL = 16;
/** The labels of arenas without one of their own (language-neutral). */
export const DEFAULT_ARENA_LABELS: readonly string[] = ["A", "B", "C", "D"];
/** Particles the canvas budgets for one arena (the engine's cap); split-screen arenas share it. */
export const PARTICLE_BUDGET = 200;
/** How loud another arena's bounce plays (0–1) when every arena is heard, next to the first arena's. */
export const EXTRA_ARENA_LEVEL = 0.6;
/** How long (ms) the finished race stays on screen after the last arena finished, before the end screen covers it. */
export const SPLIT_FINISH_HOLD_MS = 1500;

/** One arena's overrides of the shared settings; an absent value means "the shared one". */
export interface ArenaOverride {
  label: string;
  /** A fixed seed (int32): the arena replays the same run on every restart. */
  seed?: number;
  gravity?: number;
  ballSpeed?: number;
  /** #rrggbb */
  ballColor?: string;
  /** Another mode than the page's (the first arena always plays the page's mode). */
  mode?: ModeId;
}

/** The split-screen fields of the SimulatorSettings object. */
export interface SplitScreenFields {
  /** 1, 2 or 4 arenas (URL `ac`). */
  arenaCount: ArenaCount;
  /** row | grid (URL `al`). */
  arenaLayout: ArenaLayout;
  /** Per-arena overrides, index = arena (URL `ar`, compact: see `encodeArenas()`). */
  arenas: ArenaOverride[];
  /** first | all: whose bounces are heard (URL `sa`). */
  soundArena: SoundArena;
}

/** Ranges of the split-screen numbers (the override sliders use the Ball section's gravity and speed ranges). */
export const SPLIT_SCREEN_RANGES = {
  arenaCount: { min: 1, max: 4, step: 1 },
  arenaGravity: { min: 0, max: 2000, step: 50 },
  arenaBallSpeed: { min: 50, max: 800, step: 10 },
  arenaSeed: { min: -2147483648, max: 2147483647, step: 1 },
} as const;

export function defaultSplitScreenFields(): SplitScreenFields {
  return { arenaCount: 1, arenaLayout: "row", arenas: [], soundArena: "first" };
}

export function isArenaCount(value: unknown): value is ArenaCount {
  return typeof value === "number" && (ARENA_COUNTS as readonly number[]).includes(value);
}
export function isArenaLayout(value: unknown): value is ArenaLayout {
  return typeof value === "string" && (ARENA_LAYOUTS as readonly string[]).includes(value);
}
export function isSoundArena(value: unknown): value is SoundArena {
  return typeof value === "string" && (SOUND_ARENAS as readonly string[]).includes(value);
}

/**
 * A label without the URL separators (| and ~) and control characters, cut to `MAX_ARENA_LABEL` characters and trimmed
 * (`trim` false while the label is being typed, so a space before the next word survives).
 */
export function sanitizeArenaLabel(raw: unknown, trim = true): string {
  if (typeof raw !== "string") return "";
  const clean = raw.replace(/[|~\u0000-\u001f\u007f]/g, "");
  return Array.from(trim ? clean.trim() : clean.replace(/^\s+/, "")).slice(0, MAX_ARENA_LABEL).join("");
}

const clampTo = (value: number, range: { min: number; max: number }) => Math.max(range.min, Math.min(range.max, value));
const HEX = /^#[0-9a-f]{6}$/i;

/** Validates one override (from a URL, a preset or a project file); null for something that is not one. */
export function resolveArenaOverride(raw: unknown): ArenaOverride | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: ArenaOverride = { label: sanitizeArenaLabel(src.label) };
  if (typeof src.seed === "number" && Number.isFinite(src.seed)) out.seed = Math.round(clampTo(src.seed, SPLIT_SCREEN_RANGES.arenaSeed)) | 0;
  if (typeof src.gravity === "number" && Number.isFinite(src.gravity)) out.gravity = clampTo(src.gravity, SPLIT_SCREEN_RANGES.arenaGravity);
  if (typeof src.ballSpeed === "number" && Number.isFinite(src.ballSpeed)) out.ballSpeed = clampTo(src.ballSpeed, SPLIT_SCREEN_RANGES.arenaBallSpeed);
  if (typeof src.ballColor === "string" && HEX.test(src.ballColor)) out.ballColor = src.ballColor.toLowerCase();
  if (isModeId(src.mode)) out.mode = src.mode;
  return out;
}

/** The nearest allowed arena count (1, 2 or 4) of a number; 1 for anything else. */
export function snapArenaCount(value: unknown): ArenaCount {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 1;
  if (n >= 4) return 4;
  if (n >= 2) return 2;
  return 1;
}

/** Validates the feature's fields (URL parameters, presets and project files alike): a known count, layout and sound, clean overrides. */
export function resolveSplitScreenFields(source: Partial<Record<keyof SplitScreenFields, unknown>>): SplitScreenFields {
  const arenas = Array.isArray(source.arenas) ? source.arenas.slice(0, MAX_ARENAS).map((a) => resolveArenaOverride(a) ?? { label: "" }) : [];
  return {
    arenaCount: isArenaCount(source.arenaCount) ? source.arenaCount : snapArenaCount(source.arenaCount),
    arenaLayout: isArenaLayout(source.arenaLayout) ? source.arenaLayout : "row",
    arenas,
    soundArena: isSoundArena(source.soundArena) ? source.soundArena : "first",
  };
}

/** The four fields, e.g. for a mode change (the arenas carry over like the captions do). */
export function splitScreenCarryOver(settings: SplitScreenFields): SplitScreenFields {
  return { arenaCount: settings.arenaCount, arenaLayout: settings.arenaLayout, arenas: settings.arenas, soundArena: settings.soundArena };
}

/** True with two or four arenas. */
export function splitScreenActive(settings: Pick<SplitScreenFields, "arenaCount">): boolean {
  return settings.arenaCount > 1;
}

/**
 * The overrides of the arenas in play (`arenaCount` entries): a missing entry is an arena with no overrides, a missing
 * label the default letter. The first arena never changes the mode – it plays the page's (the Mode picker).
 */
export function resolvedArenas(settings: Pick<SplitScreenFields, "arenaCount" | "arenas">): ArenaOverride[] {
  const out: ArenaOverride[] = [];
  for (let i = 0; i < settings.arenaCount; i++) {
    const a = settings.arenas[i];
    const entry: ArenaOverride = { ...(a ?? {}), label: a?.label || DEFAULT_ARENA_LABELS[i] || String(i + 1) };
    if (i === 0) delete entry.mode;
    out.push(entry);
  }
  return out;
}

/** The settings the override merge touches. */
export interface ArenaMergeable {
  mode: ModeId;
  gravity: number;
  ballSpeed: number;
  ballColor: string;
}

/**
 * The settings arena `index` plays with: the shared settings with its overrides on top (gravity, ball speed, ball colour
 * and – not for the first arena – the mode). Without an override that applies the shared object itself comes back.
 */
export function mergeArenaSettings<T extends ArenaMergeable>(shared: T, override: ArenaOverride | undefined, index: number): T {
  if (!override) return shared;
  const mode = index > 0 && override.mode ? override.mode : shared.mode;
  const gravity = override.gravity ?? shared.gravity;
  const ballSpeed = override.ballSpeed ?? shared.ballSpeed;
  const ballColor = override.ballColor ?? shared.ballColor;
  if (mode === shared.mode && gravity === shared.gravity && ballSpeed === shared.ballSpeed && ballColor === shared.ballColor) return shared;
  return { ...shared, mode, gravity, ballSpeed, ballColor };
}

/** An override with `patch` applied (a value of `undefined` removes that override), for the panel's arena editor. */
export function patchArena(arenas: readonly ArenaOverride[], index: number, patch: Partial<ArenaOverride>): ArenaOverride[] {
  const next = arenas.slice(0, MAX_ARENAS);
  while (next.length <= index) next.push({ label: "" });
  const merged: ArenaOverride = { ...next[index], ...patch };
  for (const key of Object.keys(merged) as (keyof ArenaOverride)[]) if (merged[key] === undefined) delete merged[key];
  merged.label = sanitizeArenaLabel(merged.label, false);
  next[index] = merged;
  return next;
}

/** The overrides with the seeds the finder found (index = arena; an undefined seed keeps the arena's own). */
export function withArenaSeeds(arenas: readonly ArenaOverride[], count: number, seeds: readonly (number | undefined)[]): ArenaOverride[] {
  let next = arenas.slice(0, MAX_ARENAS);
  for (let i = 0; i < Math.min(count, MAX_ARENAS); i++) if (seeds[i] !== undefined) next = patchArena(next, i, { seed: seeds[i] });
  return next;
}

/**
 * What restarts every arena when it changes: the count, and each arena's seed and mode (gravity, speed and colour follow
 * live, like the Ball section's sliders; a label is only drawn).
 */
export function splitRestartKey(settings: Pick<SplitScreenFields, "arenaCount" | "arenas">): string {
  if (settings.arenaCount < 2) return "1";
  return `${settings.arenaCount}|${resolvedArenas(settings)
    .map((a) => `${a.seed ?? ""}:${a.mode ?? ""}`)
    .join("|")}`;
}

/** The particle cap of each of `count` arenas: they share the one budget, so four arenas draw what one does. */
export function arenaParticleBudget(count: number): number {
  return Math.max(20, Math.floor(PARTICLE_BUDGET / Math.max(1, count)));
}

/* ------------------------------------------------------------------ URL */

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * The compact URL form of the overrides: arenas separated by "|", each "label~s<seed>~g<gravity>~v<speed>~c<rrggbb>~m<mode>"
 * with only the overrides it has, e.g. `Red~cff3366~g600|Blue~c3366ff~s42`. Trailing arenas without anything are left out.
 */
export function encodeArenas(arenas: readonly ArenaOverride[]): string {
  const parts = arenas.slice(0, MAX_ARENAS).map((a) => {
    const fields = [sanitizeArenaLabel(a.label)];
    if (a.seed !== undefined) fields.push(`s${a.seed | 0}`);
    if (a.gravity !== undefined) fields.push(`g${formatNumber(a.gravity)}`);
    if (a.ballSpeed !== undefined) fields.push(`v${formatNumber(a.ballSpeed)}`);
    if (a.ballColor) fields.push(`c${a.ballColor.replace("#", "").toLowerCase()}`);
    if (a.mode) fields.push(`m${a.mode}`);
    return fields.join("~");
  });
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.join("|");
}

/** Reads `encodeArenas()`'s form back; unknown fields and bad values are dropped (up to four arenas). */
export function decodeArenas(raw: string): ArenaOverride[] {
  if (!raw) return [];
  return raw
    .split("|")
    .slice(0, MAX_ARENAS)
    .map((part) => {
      const [label, ...fields] = part.split("~");
      const src: Record<string, unknown> = { label };
      for (const field of fields) {
        const key = field.charAt(0);
        const value = field.slice(1);
        if (key === "s" || key === "g" || key === "v") {
          const n = Number(value);
          if (value !== "" && Number.isFinite(n)) src[key === "s" ? "seed" : key === "g" ? "gravity" : "ballSpeed"] = n;
        } else if (key === "c") src.ballColor = `#${value}`;
        else if (key === "m") src.mode = value;
      }
      return resolveArenaOverride(src) ?? { label: "" };
    });
}

/** Writes the fields that differ from `base` into the URL: ac, al, sa and ar. */
export function writeSplitScreenParams(settings: SplitScreenFields, base: SplitScreenFields, params: URLSearchParams) {
  if (settings.arenaCount !== base.arenaCount) params.set("ac", String(settings.arenaCount));
  if (settings.arenaLayout !== base.arenaLayout) params.set("al", settings.arenaLayout);
  if (settings.soundArena !== base.soundArena) params.set("sa", settings.soundArena);
  const ar = encodeArenas(settings.arenas);
  if (ar) params.set("ar", ar);
}

/** Reads the feature's URL parameters into `settings`; unknown or invalid values fall back to the defaults. */
export function readSplitScreenParams(params: URLSearchParams, settings: SplitScreenFields) {
  const next: Partial<Record<keyof SplitScreenFields, unknown>> = { ...settings };
  const ac = params.get("ac");
  if (ac !== null) next.arenaCount = Number(ac);
  const al = params.get("al");
  if (al !== null) next.arenaLayout = al;
  const sa = params.get("sa");
  if (sa !== null) next.soundArena = sa;
  const ar = params.get("ar");
  if (ar !== null) next.arenas = decodeArenas(ar);
  Object.assign(settings, resolveSplitScreenFields(next));
}

/* ------------------------------------------------------------------ viewports */

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where arena `index` is drawn (canvas CSS px), the world its engine simulates and the scale between the two. */
export interface ArenaViewport extends Viewport {
  index: number;
  /** The arena engine's world (CSS px): the viewport's shape, sized so its shorter side is the canvas' exported square. */
  world: { width: number; height: number };
  /** Viewport px per world px (≤ 1). */
  scale: number;
}

/** Columns × rows of `count` arenas: a row puts them side by side, a grid 2 × 2 (four) or stacked (two). */
export function arenaGrid(count: number, layout: ArenaLayout): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return { cols: 1, rows: 1 };
  if (layout === "row") return { cols: n, rows: 1 };
  if (n === 2) return { cols: 1, rows: 2 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * The arenas' viewports on a `width` × `height` canvas. They tile the centred square the recorder exports (so a recording
 * holds every arena), in reading order. Each arena's engine simulates a world of its viewport's shape whose shorter side
 * is that square's side – the size a single arena's world has – so an arena's ring, speeds and seeds play exactly as on
 * a canvas of its own, drawn scaled down by `scale`.
 */
export function arenaViewports(width: number, height: number, count: number, layout: ArenaLayout): ArenaViewport[] {
  const side = Math.max(0, Math.min(width, height));
  const ox = (width - side) / 2;
  const oy = (height - side) / 2;
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [{ index: 0, x: 0, y: 0, width, height, world: { width, height }, scale: 1 }];
  const { cols, rows } = arenaGrid(n, layout);
  const cellW = side / cols;
  const cellH = side / rows;
  const k = Math.min(cellW, cellH) > 0 ? side / Math.min(cellW, cellH) : 1;
  const out: ArenaViewport[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ index: i, x: ox + col * cellW, y: oy + row * cellH, width: cellW, height: cellH, world: { width: cellW * k, height: cellH * k }, scale: 1 / k });
  }
  return out;
}

/** Maps a point of arena `vp`'s world to the canvas (CSS px). */
export function worldToCanvas(vp: ArenaViewport, x: number, y: number): { x: number; y: number } {
  return { x: vp.x + x * vp.scale, y: vp.y + y * vp.scale };
}

/** Where the race banner sits in the exported square, as a share of its side from the top: between the rows of a grid, under the rings of a row. */
export function bannerAnchor(layout: ArenaLayout, count: number): number {
  return layout === "grid" && count > 1 ? 0.5 : 0.84;
}

/* ------------------------------------------------------------------ the race */

/** When an arena escaped (the run's first escape) and when its run finished, simulation ms; −1 = not yet. */
export interface ArenaMark {
  escapeMs: number;
  finishMs: number;
}

export function emptyArenaMark(): ArenaMark {
  return { escapeMs: -1, finishMs: -1 };
}

/** The time an arena counts in the race: its first escape, else its finish; −1 while it has neither. */
export function arenaMarkMs(mark: ArenaMark): number {
  return mark.escapeMs >= 0 ? mark.escapeMs : mark.finishMs;
}

export interface RaceStandings {
  /** Arenas with a mark, earliest first (ties keep the arena order). */
  order: number[];
  /** The arenas sharing the earliest mark (more than one: a tie); empty before the first mark. */
  winners: number[];
  /** What the winners did first. */
  kind: "escaped" | "finished" | null;
  /** The winning time (simulation ms), −1 before the first mark. */
  timeMs: number;
}

/**
 * The standings of the split-screen race: every arena is timed on its own simulation clock (the arenas step the same
 * fixed 60 Hz steps, so the clocks are comparable whatever the frame rate), by its first escape or else its finish.
 */
export function raceStandings(marks: readonly ArenaMark[]): RaceStandings {
  const order: number[] = [];
  for (let i = 0; i < marks.length; i++) if (arenaMarkMs(marks[i]) >= 0) order.push(i);
  order.sort((a, b) => arenaMarkMs(marks[a]) - arenaMarkMs(marks[b]) || a - b);
  if (order.length === 0) return { order, winners: [], kind: null, timeMs: -1 };
  const best = arenaMarkMs(marks[order[0]]);
  const winners = order.filter((i) => Math.abs(arenaMarkMs(marks[i]) - best) < 0.5);
  return { order, winners, kind: marks[order[0]].escapeMs >= 0 ? "escaped" : "finished", timeMs: best };
}

/** Seconds with two decimals, as the banner and the arena labels show a time. */
export function formatRaceSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(2);
}
