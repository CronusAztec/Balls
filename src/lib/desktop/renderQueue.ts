import { resolveProjectSettings } from "@/lib/project";
import { RESOLUTIONS, type SimulatorSettings } from "@/lib/settings";
import { MAX_SEED } from "@/lib/recording/batch";
import { VIDEO_CODECS, type LibraryMeta, type VideoCodec } from "./contract";
import { OUTPUT_PRESETS, type OutputPreset } from "./presets";
import { safeFileBase } from "./fileNames";

export { safeFileBase };

/*
 * --- desktop-exe --- The desktop render queue as a pure state machine (no React, no Electron), covered by
 * tests/desktopQueue.test.ts and exercised again by the app's own tests.
 *
 * A job is one clip: settings (a snapshot of the page, a planned clip's or a link's), a physics seed, the render size and
 * frame rate of the fast export, a codec and an output preset (ffmpeg's pass: platform preset, 4K upscale, HEVC / AV1). Jobs
 * move queued → rendering → encoding → done, or → failed / cancelled; failed and cancelled jobs can be retried. Every
 * transition returns a new state; the page (components/simulator/desktop/useRenderQueue.ts) drives it and writes the
 * journal (`journalOf()`) through the app after every change, crash-safe (the app writes a temporary file and renames it).
 * After a restart `restoreQueue()` reads the journal back: a job that was rendering or encoding when the app stopped goes
 * back to the queue (a render cannot resume half-way – it starts over) unless it already had `MAX_ATTEMPTS` tries, and a
 * queue that was running offers to resume.
 */

export const QUEUE_JOURNAL_FORMAT = "jumpingballslive-render-journal";
export const QUEUE_JOURNAL_VERSION = 1;
export const MAX_QUEUE_JOBS = 500;
/** Tries of a job interrupted by restarts before the queue gives up on it. */
export const MAX_ATTEMPTS = 3;
/** Share of a job's progress bar the render takes when ffmpeg runs after it. */
export const RENDER_SHARE = 0.8;

export type QueueJobStatus = "queued" | "rendering" | "encoding" | "done" | "failed" | "cancelled";

export type QueueSource = { kind: "seed" } | { kind: "plan"; planId: string; recipe: string; melodyId: string | null } | { kind: "link"; link: string } | { kind: "ai"; melodyId: string | null };

export interface QueueJobSpec {
  /** File name without extension (made unique within the queue). */
  name: string;
  source: QueueSource;
  settings: SimulatorSettings;
  seed: number;
  /** Fast export size ("1080x1920"…) and frame rate. */
  resolution: string;
  fps: 30 | 60;
  codec: VideoCodec;
  preset: OutputPreset;
  meta: Omit<LibraryMeta, "queueJobId" | "seed" | "mode" | "link"> & { link?: string };
}

export interface QueueJobOutput {
  path: string;
  bytes: number;
  durationSec: number | null;
  encoder: string | null;
}

export interface QueueJob extends QueueJobSpec {
  id: string;
  status: QueueJobStatus;
  /** 0–1 over the whole job (render, then ffmpeg). */
  progress: number;
  attempts: number;
  error: string | null;
  output: QueueJobOutput | null;
  /** The job was put back in the queue by a restart. */
  resumed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface QueueState {
  jobs: QueueJob[];
  /** The queue works through its jobs (false: paused or finished). */
  running: boolean;
}

export const EMPTY_QUEUE: QueueState = { jobs: [], running: false };

const ACTIVE: readonly QueueJobStatus[] = ["rendering", "encoding"];
const FINISHED: readonly QueueJobStatus[] = ["done", "failed", "cancelled"];

export const isActive = (job: Pick<QueueJob, "status">) => ACTIVE.includes(job.status);
export const isFinished = (job: Pick<QueueJob, "status">) => FINISHED.includes(job.status);

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}`;
  taken.add(name.toLowerCase());
  return name;
}

function patchJob(state: QueueState, id: string, patch: (job: QueueJob) => Partial<QueueJob> | null, now: number): QueueState {
  let changed = false;
  const jobs = state.jobs.map((job) => {
    if (job.id !== id) return job;
    const p = patch(job);
    if (!p) return job;
    changed = true;
    return { ...job, ...p, updatedAt: now };
  });
  return changed ? { ...state, jobs } : state;
}

/** Adds jobs (unique names, at most `MAX_QUEUE_JOBS` in the queue); `makeId` gives each an id. */
export function enqueue(state: QueueState, specs: readonly QueueJobSpec[], now: number, makeId: () => string): QueueState {
  const taken = new Set(state.jobs.map((j) => j.name.toLowerCase()));
  const room = Math.max(0, MAX_QUEUE_JOBS - state.jobs.length);
  const added = specs.slice(0, room).map(
    (spec): QueueJob => ({
      ...spec,
      name: uniqueName(safeFileBase(spec.name), taken),
      id: makeId(),
      status: "queued",
      progress: 0,
      attempts: 0,
      error: null,
      output: null,
      resumed: false,
      createdAt: now,
      updatedAt: now,
    }),
  );
  return added.length ? { ...state, jobs: [...state.jobs, ...added] } : state;
}

/** The job to render next while the queue runs: the first queued one (none while one is active). */
export function nextJob(state: QueueState): QueueJob | null {
  if (!state.running || state.jobs.some(isActive)) return null;
  return state.jobs.find((j) => j.status === "queued") ?? null;
}

export function startQueue(state: QueueState): QueueState {
  return state.running ? state : { ...state, running: true };
}

/** Pauses after the job in progress (it finishes; nothing new starts). */
export function pauseQueue(state: QueueState): QueueState {
  return state.running ? { ...state, running: false } : state;
}

export function markRendering(state: QueueState, id: string, now: number): QueueState {
  return patchJob(state, id, (j) => (j.status === "queued" ? { status: "rendering", progress: 0, attempts: j.attempts + 1, error: null } : null), now);
}

/** The whole job's progress from its phase: the render fills `RENDER_SHARE` of the bar when ffmpeg follows, else all of it. */
export function jobProgress(phase: "rendering" | "encoding", fraction: number, encodes: boolean): number {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  if (phase === "rendering") return encodes ? f * RENDER_SHARE : f;
  return RENDER_SHARE + f * (1 - RENDER_SHARE);
}

export function markProgress(state: QueueState, id: string, progress: number, now: number): QueueState {
  const p = Math.max(0, Math.min(1, progress));
  return patchJob(state, id, (j) => (isActive(j) && p >= j.progress ? { progress: p } : null), now);
}

export function markEncoding(state: QueueState, id: string, now: number): QueueState {
  return patchJob(state, id, (j) => (j.status === "rendering" ? { status: "encoding", progress: Math.max(j.progress, RENDER_SHARE) } : null), now);
}

export function markDone(state: QueueState, id: string, output: QueueJobOutput, now: number): QueueState {
  return patchJob(state, id, (j) => (isActive(j) ? { status: "done", progress: 1, output, error: null } : null), now);
}

export function markFailed(state: QueueState, id: string, error: string, now: number): QueueState {
  return patchJob(state, id, (j) => (isActive(j) || j.status === "queued" ? { status: "failed", error: error.slice(0, 500) } : null), now);
}

/** Cancels a queued or active job (the page also aborts an active job's export / ffmpeg pass). */
export function cancelJob(state: QueueState, id: string, now: number): QueueState {
  return patchJob(state, id, (j) => (j.status === "queued" || isActive(j) ? { status: "cancelled", progress: 0 } : null), now);
}

/** Cancels everything not finished and stops the queue. */
export function cancelAll(state: QueueState, now: number): QueueState {
  const jobs = state.jobs.map((j) => (j.status === "queued" || isActive(j) ? { ...j, status: "cancelled" as const, progress: 0, updatedAt: now } : j));
  return { jobs, running: false };
}

/** Puts a failed or cancelled job back in the queue (a new try). */
export function retryJob(state: QueueState, id: string, now: number): QueueState {
  return patchJob(state, id, (j) => (j.status === "failed" || j.status === "cancelled" ? { status: "queued", progress: 0, error: null, output: null, attempts: 0, resumed: false } : null), now);
}

/** Retries every failed job. */
export function retryFailed(state: QueueState, now: number): QueueState {
  let next = state;
  for (const j of state.jobs) if (j.status === "failed") next = retryJob(next, j.id, now);
  return next;
}

export function removeJob(state: QueueState, id: string): QueueState {
  const job = state.jobs.find((j) => j.id === id);
  if (!job || isActive(job)) return state;
  return { ...state, jobs: state.jobs.filter((j) => j.id !== id) };
}

/** Removes the finished jobs (done, failed, cancelled). */
export function clearFinished(state: QueueState): QueueState {
  const jobs = state.jobs.filter((j) => !isFinished(j));
  return jobs.length === state.jobs.length ? state : { ...state, jobs };
}

/** Moves a queued job one place up (-1) or down (+1) among the jobs. */
export function moveJob(state: QueueState, id: string, delta: -1 | 1): QueueState {
  const i = state.jobs.findIndex((j) => j.id === id);
  const k = i + delta;
  if (i < 0 || k < 0 || k >= state.jobs.length || state.jobs[i].status !== "queued") return state;
  const jobs = [...state.jobs];
  [jobs[i], jobs[k]] = [jobs[k], jobs[i]];
  return { ...state, jobs };
}

export interface QueueSummary {
  total: number;
  queued: number;
  active: number;
  done: number;
  failed: number;
  cancelled: number;
  /** 0–1 over the jobs that are not cancelled. */
  progress: number;
  /** The queue has nothing left to do. */
  idle: boolean;
}

export function queueSummary(state: QueueState): QueueSummary {
  const count = (s: QueueJobStatus) => state.jobs.filter((j) => j.status === s).length;
  const counted = state.jobs.filter((j) => j.status !== "cancelled");
  const progress = counted.length ? counted.reduce((sum, j) => sum + (j.status === "done" || j.status === "failed" ? 1 : j.progress), 0) / counted.length : 0;
  const active = state.jobs.filter(isActive).length;
  const queued = count("queued");
  return { total: state.jobs.length, queued, active, done: count("done"), failed: count("failed"), cancelled: count("cancelled"), progress, idle: active === 0 && (queued === 0 || !state.running) };
}

/* ------------------------------------------------------------------ batch expansion */

export interface BatchClipSource {
  name: string;
  source: QueueSource;
  settings: SimulatorSettings;
  seed: number;
  meta?: QueueJobSpec["meta"];
}

export interface QueueBatchOptions {
  resolutions: readonly string[];
  fps: readonly (30 | 60)[];
  codecs: readonly VideoCodec[];
  presets: readonly OutputPreset[];
}

const EMPTY_META: QueueJobSpec["meta"] = { title: "", platform: null, hook: null, caption: null, hashtags: [] };

/**
 * Every clip × resolution × frame rate × codec × preset (in that order), named `<clip>[-<res>][-<fps>fps][-<codec>][-<preset>]`
 * with a suffix only for the choices that vary. A platform preset renders at its own size and frame rate, so its
 * resolution / frame-rate variants collapse into one job.
 */
export function expandBatch(clips: readonly BatchClipSource[], options: QueueBatchOptions): QueueJobSpec[] {
  const resolutions = options.resolutions.filter((r) => (RESOLUTIONS as readonly string[]).includes(r));
  const fpsList = options.fps.filter((f) => f === 30 || f === 60);
  const codecs = options.codecs.filter((c) => (VIDEO_CODECS as readonly string[]).includes(c));
  const presets = options.presets.filter((p) => (OUTPUT_PRESETS as readonly string[]).includes(p));
  if (!resolutions.length || !fpsList.length || !codecs.length || !presets.length) return [];
  const specs: QueueJobSpec[] = [];
  const seen = new Set<string>();
  for (const clip of clips) {
    for (const resolution of resolutions) {
      for (const fps of fpsList) {
        for (const codec of codecs) {
          for (const preset of presets) {
            const platform = preset !== "native";
            const key = `${clip.name}|${platform ? "-" : resolution}|${platform ? "-" : fps}|${codec}|${preset}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const parts = [clip.name];
            if (resolutions.length > 1 && !platform) parts.push(resolution);
            if (fpsList.length > 1 && !platform) parts.push(`${fps}fps`);
            if (codecs.length > 1) parts.push(codec);
            if (presets.length > 1 || platform) parts.push(preset);
            specs.push({ name: parts.join("-"), source: clip.source, settings: clip.settings, seed: clip.seed, resolution, fps, codec, preset, meta: clip.meta ?? { ...EMPTY_META, title: clip.name } });
          }
        }
      }
    }
  }
  return specs;
}

/* ------------------------------------------------------------------ the journal */

export interface QueueJournal {
  format: typeof QUEUE_JOURNAL_FORMAT;
  version: number;
  savedAt: number;
  running: boolean;
  jobs: QueueJob[];
}

export function journalOf(state: QueueState, now: number): QueueJournal {
  return { format: QUEUE_JOURNAL_FORMAT, version: QUEUE_JOURNAL_VERSION, savedAt: now, running: state.running, jobs: state.jobs };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback: string, max = 2000) => (typeof v === "string" ? v.slice(0, max) : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function restoreSource(raw: unknown): QueueSource {
  if (!isObject(raw)) return { kind: "seed" };
  if (raw.kind === "plan") return { kind: "plan", planId: str(raw.planId, ""), recipe: str(raw.recipe, ""), melodyId: typeof raw.melodyId === "string" ? raw.melodyId : null };
  if (raw.kind === "link" && typeof raw.link === "string") return { kind: "link", link: raw.link.slice(0, 20_000) };
  if (raw.kind === "ai") return { kind: "ai", melodyId: typeof raw.melodyId === "string" ? raw.melodyId : null };
  return { kind: "seed" };
}

function restoreMeta(raw: unknown, name: string): QueueJobSpec["meta"] {
  const m = isObject(raw) ? raw : {};
  const hashtags = Array.isArray(m.hashtags) ? m.hashtags.filter((h): h is string => typeof h === "string").slice(0, 30).map((h) => h.slice(0, 100)) : [];
  return {
    title: str(m.title, name, 200),
    platform: typeof m.platform === "string" ? m.platform.slice(0, 40) : null,
    hook: typeof m.hook === "string" ? m.hook.slice(0, 500) : null,
    caption: typeof m.caption === "string" ? m.caption.slice(0, 5000) : null,
    hashtags,
    ...(typeof m.link === "string" ? { link: m.link.slice(0, 20_000) } : {}),
  };
}

function restoreJob(raw: unknown, now: number): QueueJob | null {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const statuses: QueueJobStatus[] = ["queued", "rendering", "encoding", "done", "failed", "cancelled"];
  let status = statuses.includes(raw.status as QueueJobStatus) ? (raw.status as QueueJobStatus) : "queued";
  const attempts = Math.max(0, Math.floor(num(raw.attempts, 0)));
  let error = typeof raw.error === "string" ? raw.error.slice(0, 500) : null;
  let resumed = raw.resumed === true;
  if (ACTIVE.includes(status)) {
    // The app stopped mid-job: the render starts over, unless the job already had its tries.
    if (attempts >= MAX_ATTEMPTS) {
      status = "failed";
      error = "interrupted";
    } else {
      status = "queued";
      resumed = true;
    }
  }
  const out = isObject(raw.output) && typeof raw.output.path === "string" ? { path: raw.output.path, bytes: num(raw.output.bytes, 0), durationSec: typeof raw.output.durationSec === "number" ? raw.output.durationSec : null, encoder: typeof raw.output.encoder === "string" ? raw.output.encoder : null } : null;
  if (status === "done" && !out) status = "queued";
  const seed = Math.floor(num(raw.seed, 1));
  const name = safeFileBase(str(raw.name, "clip", 200));
  return {
    id: raw.id.slice(0, 100),
    name,
    source: restoreSource(raw.source),
    settings: resolveProjectSettings(raw.settings),
    seed: seed >= 0 && seed <= MAX_SEED ? seed : 1,
    resolution: (RESOLUTIONS as readonly string[]).includes(raw.resolution as string) ? (raw.resolution as string) : "1080x1920",
    fps: raw.fps === 30 ? 30 : 60,
    codec: (VIDEO_CODECS as readonly string[]).includes(raw.codec as string) ? (raw.codec as VideoCodec) : "h264",
    preset: (OUTPUT_PRESETS as readonly string[]).includes(raw.preset as string) ? (raw.preset as OutputPreset) : "native",
    meta: restoreMeta(raw.meta, name),
    status,
    progress: status === "done" ? 1 : 0,
    attempts: status === "queued" && !resumed ? 0 : attempts,
    error: status === "failed" ? (error ?? "failed") : null,
    output: status === "done" ? out : null,
    resumed,
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
  };
}

/**
 * The queue a journal describes (validated field by field; settings through the project loader, which keeps only known
 * settings and clamps them), with interrupted jobs back in the queue. `resumable`: jobs are waiting and the queue was
 * running when the app stopped – the page offers to resume it (it does not start by itself).
 */
export function restoreQueue(raw: unknown, now: number): { state: QueueState; resumable: boolean; resumed: number } {
  if (!isObject(raw) || raw.format !== QUEUE_JOURNAL_FORMAT || typeof raw.version !== "number" || raw.version > QUEUE_JOURNAL_VERSION || !Array.isArray(raw.jobs)) {
    return { state: EMPTY_QUEUE, resumable: false, resumed: 0 };
  }
  const seen = new Set<string>();
  const jobs: QueueJob[] = [];
  for (const entry of raw.jobs.slice(0, MAX_QUEUE_JOBS)) {
    const job = restoreJob(entry, now);
    if (!job || seen.has(job.id)) continue;
    seen.add(job.id);
    jobs.push(job);
  }
  const resumed = jobs.filter((j) => j.resumed && j.status === "queued").length;
  const waiting = jobs.some((j) => j.status === "queued");
  return { state: { jobs, running: false }, resumable: waiting && (raw.running === true || resumed > 0), resumed };
}
