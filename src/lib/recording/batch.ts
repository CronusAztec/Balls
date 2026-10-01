import { MODE_CARD_ORDER } from "@/lib/modes";
import { SITE_SLUG } from "@/lib/site";
import { isModeId, type ModeId } from "@/lib/physics/types";
import { RANGES, settingsFromSearchParams, type SimulatorSettings } from "@/lib/settings";
import { SHARE_CODE_PARAM, decodeShareCode, mergeShareParams } from "@/lib/shareCode";

/*
 * --- batch-render --- The pure side of the batch render (the "Batch" block of the Recording section): what a batch is
 * (`BatchDefinition`, kept in localStorage), the pasted list of seeds and share links, the variants (every mode, or one
 * numeric setting swept from A to B in K steps), the job plan, the file names and the settings of a share link. The page
 * side – applying each job's settings and running the fast export job after job – is components/simulator/useBatchRender.ts.
 */

/** localStorage key of the last batch definition. */
export const BATCH_STORAGE_KEY = "jumpingballslive_batch_render";
/** At most this many clips per batch (they are held in memory for the ZIP). */
export const MAX_BATCH_JOBS = 50;
/** Random seeds per batch. */
export const BATCH_COUNT_RANGE = { min: 1, max: MAX_BATCH_JOBS, step: 1 } as const;
/** Steps of a sweep (both ends included). */
export const SWEEP_STEPS_RANGE = { min: 2, max: 12, step: 1 } as const;
/** The pasted list is cut here. */
export const BATCH_LIST_MAX_CHARS = 20_000;
/** Seeds are positive 31-bit integers, like the engine's own (`engine.setSeed()`). */
export const MAX_SEED = 0x7fffffff;
/** The link parameter a pasted share link may carry its seed in (`…?mode=portal&seed=1234`). */
export const LINK_SEED_PARAM = "seed";

/** Numeric settings a batch can sweep (each has a range in `RANGES`). */
export const SWEEP_KEYS = ["gravity", "ballSpeed", "ballRadius", "wallCount", "gapSize", "rotationSpeed", "wallThickness", "airDrag", "windX", "spinStrength", "wallBounciness", "rotatingGravity", "recordingDuration"] as const satisfies readonly NumericSettingKey[];
export type SweepKey = (typeof SWEEP_KEYS)[number];
type NumericSettingKey = { [K in keyof SimulatorSettings]: SimulatorSettings[K] extends number ? K : never }[keyof SimulatorSettings];
// Every sweep key is a numeric setting (checked above) with a range in RANGES (checked here by the compiler).
const SWEEP_RANGES = Object.fromEntries(SWEEP_KEYS.map((k) => [k, RANGES[k]])) as Record<SweepKey, { min: number; max: number; step: number }>;

export function isSweepKey(value: unknown): value is SweepKey {
  return typeof value === "string" && (SWEEP_KEYS as readonly string[]).includes(value);
}

export function sweepRange(key: SweepKey): { min: number; max: number; step: number } {
  return SWEEP_RANGES[key];
}

export type BatchSource = "random" | "list";
export type BatchVariantKind = "none" | "modes" | "sweep";

/** What the Batch block renders: which seeds, which variants of the settings, whether each clip downloads on its own. */
export interface BatchDefinition {
  /** N random seeds, or the pasted list of seeds and share links. */
  source: BatchSource;
  /** How many random seeds (`BATCH_COUNT_RANGE`). */
  count: number;
  /** One job per line: a seed, a share link, or a link and a seed (`parseBatchList()`). */
  list: string;
  /** Every seed as is, in every picked mode, or with one setting swept. */
  variant: BatchVariantKind;
  /** The modes of the "every mode" variant (card order when planned). */
  modes: ModeId[];
  sweepKey: SweepKey;
  sweepFrom: number;
  sweepTo: number;
  sweepSteps: number;
  /** Download every clip as soon as it is done (the ZIP is offered at the end either way). */
  downloadEach: boolean;
}

/** The sweep's default ends for a setting: its whole range. */
export function sweepDefaults(key: SweepKey): { sweepFrom: number; sweepTo: number } {
  const range = sweepRange(key);
  return { sweepFrom: range.min, sweepTo: range.max };
}

export function defaultBatchDefinition(): BatchDefinition {
  return { source: "random", count: 3, list: "", variant: "none", modes: [...MODE_CARD_ORDER], sweepKey: "gravity", ...sweepDefaults("gravity"), sweepSteps: 3, downloadEach: true };
}

const clampInt = (value: unknown, range: { min: number; max: number }, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
};

/** A stored batch definition, validated: unknown or bad fields fall back to the defaults, numbers are clamped. */
export function parseBatchDefinition(raw: unknown): BatchDefinition {
  const d = defaultBatchDefinition();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const sweepKey = isSweepKey(r.sweepKey) ? r.sweepKey : d.sweepKey;
  const ends = sweepDefaults(sweepKey);
  const range = sweepRange(sweepKey);
  const end = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(range.min, Math.min(range.max, value)) : fallback);
  const modes = Array.isArray(r.modes) ? [...new Set(r.modes.filter(isModeId))] : d.modes;
  return {
    source: r.source === "list" ? "list" : "random",
    count: clampInt(r.count, BATCH_COUNT_RANGE, d.count),
    list: typeof r.list === "string" ? r.list.slice(0, BATCH_LIST_MAX_CHARS) : "",
    variant: r.variant === "modes" || r.variant === "sweep" ? r.variant : "none",
    modes,
    sweepKey,
    sweepFrom: end(r.sweepFrom, ends.sweepFrom),
    sweepTo: end(r.sweepTo, ends.sweepTo),
    sweepSteps: clampInt(r.sweepSteps, SWEEP_STEPS_RANGE, d.sweepSteps),
    downloadEach: typeof r.downloadEach === "boolean" ? r.downloadEach : d.downloadEach,
  };
}

/** The last batch definition of this browser (the defaults without one, or without storage). */
export function loadBatchDefinition(): BatchDefinition {
  if (typeof window === "undefined") return defaultBatchDefinition();
  try {
    const raw = localStorage.getItem(BATCH_STORAGE_KEY);
    return parseBatchDefinition(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultBatchDefinition();
  }
}

export function saveBatchDefinition(definition: BatchDefinition) {
  try {
    localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ v: 1, ...definition }));
  } catch {
    /* storage disabled or full: the definition lives until the page is closed */
  }
}

/* ------------------------------------------------------------------ the pasted list */

/** One job of the pasted list: a seed (null: drawn at random), with the settings of a share link or the page's. */
export interface BatchListEntry {
  /** 1-based line of the list. */
  line: number;
  seed: number | null;
  link: string | null;
}

export interface BatchListParse {
  entries: BatchListEntry[];
  /** Lines that could not be read (1-based): a word that is neither a seed nor a link, two links on one line, a bad link. */
  invalidLines: number[];
}

/** A seed written as a plain number (0 – 2³¹−1), else null. */
export function parseSeed(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n <= MAX_SEED ? n : null;
}

const looksLikeLink = (token: string) => /^(https?:\/\/|\/|\?)/i.test(token) || token.includes("?");

/** The parameters of a share link, or null when it is not one (a simulator link always has `mode` or a `c` share code). */
export function linkParams(link: string): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(link.trim(), "https://localhost/");
  } catch {
    return null;
  }
  const params = url.searchParams;
  return params.has("mode") || params.has(SHARE_CODE_PARAM) ? params : null;
}

/** The seed a share link names in its `seed` parameter, if any. */
export function linkSeed(link: string): number | null {
  return parseSeed(linkParams(link)?.get(LINK_SEED_PARAM));
}

/**
 * Reads the pasted list, one job per line: `123456` (a seed with the page's settings), a share link (long or `?c=` short;
 * its `seed` parameter, else a random seed), or a link and one or more seeds (`https://…?c=… 42 77`: one job per seed).
 * Several seeds may share a line (`1, 2, 3`); empty lines and lines starting with `#` are skipped.
 */
export function parseBatchList(text: string): BatchListParse {
  const entries: BatchListEntry[] = [];
  const invalidLines: number[] = [];
  const lines = text.slice(0, BATCH_LIST_MAX_CHARS).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const seeds: number[] = [];
    const links: string[] = [];
    let bad = false;
    for (const word of trimmed.split(/\s+/)) {
      if (looksLikeLink(word)) {
        if (linkParams(word)) links.push(word);
        else bad = true;
        continue;
      }
      for (const part of word.split(/[,;]+/)) {
        if (!part) continue;
        const seed = parseSeed(part);
        if (seed === null) bad = true;
        else seeds.push(seed);
      }
    }
    if (bad || links.length > 1 || (seeds.length === 0 && links.length === 0)) {
      invalidLines.push(line);
      return;
    }
    const link = links[0] ?? null;
    if (seeds.length === 0) entries.push({ line, seed: link ? linkSeed(link) : null, link });
    else for (const seed of seeds) entries.push({ line, seed, link });
  });
  return { entries, invalidLines };
}

/* ------------------------------------------------------------------ variants and the job plan */

export type BatchVariant = { kind: "none" } | { kind: "mode"; mode: ModeId } | { kind: "sweep"; key: SweepKey; value: number };

/** One clip of the batch: a seed, the settings it starts from (a share link, or the page's) and its variant. */
export interface BatchJobPlan {
  id: number;
  seed: number;
  link: string | null;
  variant: BatchVariant;
}

const decimals = (step: number) => {
  const s = String(step);
  return s.includes(".") ? s.length - s.indexOf(".") - 1 : 0;
};

/** `value` on the setting's slider: clamped to its range, snapped to its step (counted from the minimum, like a range input). */
export function snapToRange(value: number, range: { min: number; max: number; step: number }): number {
  const clamped = Math.max(range.min, Math.min(range.max, Number.isFinite(value) ? value : range.min));
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  return Number(Math.min(range.max, snapped).toFixed(decimals(range.step)));
}

/** The values of a sweep from `from` to `to` in `steps` steps (both ends included), on the setting's slider, without repeats. */
export function sweepValues(key: SweepKey, from: number, to: number, steps: number): number[] {
  const range = sweepRange(key);
  const count = clampInt(steps, SWEEP_STEPS_RANGE, SWEEP_STEPS_RANGE.min);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = snapToRange(from + ((to - from) * i) / (count - 1), range);
    if (!values.includes(v)) values.push(v);
  }
  return values;
}

/** The variants every seed is rendered in (one when there are none). */
export function batchVariants(def: BatchDefinition): BatchVariant[] {
  if (def.variant === "modes") return MODE_CARD_ORDER.filter((m) => def.modes.includes(m)).map((mode) => ({ kind: "mode", mode }));
  if (def.variant === "sweep") return sweepValues(def.sweepKey, def.sweepFrom, def.sweepTo, def.sweepSteps).map((value) => ({ kind: "sweep", key: def.sweepKey, value }));
  return [{ kind: "none" }];
}

/** How many clips the definition asks for (before the `MAX_BATCH_JOBS` cap) and whether the cap cuts it. */
export function batchJobCount(def: BatchDefinition, list: BatchListParse): { count: number; requested: number; truncated: boolean } {
  const seeds = def.source === "random" ? clampInt(def.count, BATCH_COUNT_RANGE, 1) : list.entries.length;
  const requested = seeds * batchVariants(def).length;
  return { count: Math.min(requested, MAX_BATCH_JOBS), requested, truncated: requested > MAX_BATCH_JOBS };
}

/** A random seed (1 – 2³¹−2) from `random` (0 ≤ x < 1). */
export function randomSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * (MAX_SEED - 1));
}

/** `count` different random seeds. */
export function randomSeeds(count: number, random: () => number = Math.random): number[] {
  const seeds: number[] = [];
  for (let guard = 0; seeds.length < count && guard < count * 100; guard++) {
    const seed = randomSeed(random);
    if (!seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

/**
 * The batch's jobs in render order: every seed in every variant (seed by seed), at most `MAX_BATCH_JOBS`. A random source
 * draws its seeds from `random`; a list entry without a seed gets one from it too.
 */
export function planBatch(def: BatchDefinition, list: BatchListParse, random: () => number = Math.random): { jobs: BatchJobPlan[]; truncated: boolean } {
  const sources: { seed: number; link: string | null }[] =
    def.source === "random" ? randomSeeds(clampInt(def.count, BATCH_COUNT_RANGE, 1), random).map((seed) => ({ seed, link: null })) : list.entries.map((e) => ({ seed: e.seed ?? randomSeed(random), link: e.link }));
  const variants = batchVariants(def);
  const jobs: BatchJobPlan[] = [];
  for (const source of sources) {
    for (const variant of variants) {
      if (jobs.length >= MAX_BATCH_JOBS) return { jobs, truncated: true };
      jobs.push({ id: jobs.length + 1, seed: source.seed, link: source.link, variant });
    }
  }
  return { jobs, truncated: false };
}

/* ------------------------------------------------------------------ the settings of a job */

export type LinkSettingsResult = { ok: true; settings: SimulatorSettings } | { ok: false; error: "invalid" | "unsupported" };

/** The settings a share link opens with (a `?c=` code decoded, the link's other parameters on top – as the page loads it). */
export async function resolveLinkSettings(link: string): Promise<LinkSettingsResult> {
  const params = linkParams(link);
  if (!params) return { ok: false, error: "invalid" };
  const code = params.get(SHARE_CODE_PARAM);
  if (code === null) return { ok: true, settings: settingsFromSearchParams(params) };
  const decoded = await decodeShareCode(code);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, settings: settingsFromSearchParams(mergeShareParams(decoded.params, params)) };
}

/** A link's settings with the batch's export format (the Recording section's resolution and frame rate when the batch started). */
export function keepExportFormat(settings: SimulatorSettings, format: Pick<SimulatorSettings, "recordingResolution" | "fastExportFps">): SimulatorSettings {
  return { ...settings, recordingResolution: format.recordingResolution, fastExportFps: format.fastExportFps };
}

/**
 * The settings of a link's job: the link's, with the batch's export format (`keepExportFormat()`) and the page's wall-break
 * sound – a link never carries one (neither a built-in clip nor an upload, which only lives in the page that holds it), so
 * the clip gets the one the page plays, like a mode of the "every mode" variant.
 */
export function linkJobSettings(link: SimulatorSettings, page: SimulatorSettings): SimulatorSettings {
  return { ...keepExportFormat(link, page), wallBreakSound: page.wallBreakSound };
}

/**
 * --- review fix (recording-export) --- The longest clip of a batch (s), for its summary: the page's clip length, the longest
 * swept one in a sweep of the clip length, a long link's own `dur` (a link job keeps its clip length: `keepExportFormat()`
 * keeps only the resolution and the frame rate). Null when it is only known once a job runs: a short `?c=` link, whose
 * code is decoded then.
 */
export function batchLongestClipSec(def: BatchDefinition, list: BatchListParse, pageDurationSec: number): number | null {
  if (def.variant === "sweep" && def.sweepKey === "recordingDuration") {
    const values = sweepValues(def.sweepKey, def.sweepFrom, def.sweepTo, def.sweepSteps);
    return values.length > 0 ? Math.max(...values) : pageDurationSec;
  }
  if (def.source !== "list") return pageDurationSec;
  let longest = 0;
  for (const entry of list.entries) {
    if (!entry.link) {
      longest = Math.max(longest, pageDurationSec);
      continue;
    }
    const params = linkParams(entry.link);
    if (!params || params.has(SHARE_CODE_PARAM)) return null;
    longest = Math.max(longest, settingsFromSearchParams(params).recordingDuration);
  }
  return longest > 0 ? longest : pageDurationSec;
}

/** The settings with one swept value. */
export function sweepSettings(settings: SimulatorSettings, key: SweepKey, value: number): SimulatorSettings {
  return { ...settings, [key]: value };
}

/** True when two settings objects hold the same values (whatever the order of their fields). */
export function sameSettings(a: SimulatorSettings, b: SimulatorSettings): boolean {
  if (a === b) return true;
  const key = (s: SimulatorSettings) => JSON.stringify(Object.keys(s).sort().map((k) => [k, (s as unknown as Record<string, unknown>)[k]]));
  return key(a) === key(b);
}

/* ------------------------------------------------------------------ names and times */

/** A clip length for a file name: `30s`, `12.4s`. */
export function formatClipSeconds(sec: number): string {
  const tenths = Math.round(sec * 10) / 10;
  return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)}s`;
}

const formatValue = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

/** The file name (without extension) of a batch clip: `mode-seed-duration`, plus the swept setting and its value. */
export function batchFileBase(job: { mode: ModeId; seed: number; durationSec: number; variant: BatchVariant }): string {
  const base = `${job.mode}-${job.seed}-${formatClipSeconds(job.durationSec)}`;
  return job.variant.kind === "sweep" ? `${base}-${job.variant.key}-${formatValue(job.variant.value)}` : base;
}

/** `base`, or `base-2`, `base-3`… when `base.extension` is taken already; the name it returns is marked as taken. */
export function uniqueFileBase(base: string, extension: string, used: Set<string>): string {
  let name = base;
  for (let n = 2; used.has(`${name}.${extension}`); n++) name = `${base}-${n}`;
  used.add(`${name}.${extension}`);
  return name;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The ZIP's file name (without extension): `jumpingballslive-batch-20260929-1432`. */
export function batchZipBase(date: Date): string {
  return `${SITE_SLUG}-batch-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/** A wall-clock time for the queue: `0:07`, `2:31`, `1:02:03`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
