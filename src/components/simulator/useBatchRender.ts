"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ModeId } from "@/lib/physics/types";
import { resolutionToSize, type SimulatorSettings } from "@/lib/settings";
import { downloadExport, fastRenderSupported, pickExportFormat, type FastRenderResult } from "@/lib/recording/fastRender";
import { resolveFastExportFps } from "@/lib/recording/fastRenderPlan";
import {
  batchFileBase,
  batchJobCount,
  batchZipBase,
  defaultBatchDefinition,
  linkJobSettings,
  loadBatchDefinition,
  parseBatchList,
  planBatch,
  resolveLinkSettings,
  sameSettings,
  saveBatchDefinition,
  sweepSettings,
  uniqueFileBase,
  BATCH_LIST_MAX_CHARS,
  type BatchDefinition,
  type BatchListParse,
  type BatchVariant,
  type BatchJobPlan, // --- viral-bot ---
} from "@/lib/recording/batch";
import { zipBlobs } from "@/lib/recording/zip";
import { jdmRhythmPlayedByHand } from "@/lib/physics/modes/jdmRhythmFields"; // --- jdm-rhythm-runner ---
import type { FastExportState } from "./sections/FastExportSection";
import { offerPublishClip } from "@/lib/publish/clips"; // --- social-publish ---

/*
 * --- batch-render --- The page's side of the batch render (lib/recording/batch.ts): runs the fast export job after job.
 *
 * The fast export renders what the page shows – a hidden copy of the page's canvas with the page's props, a fresh engine
 * with the page engine's config and the page's sound set-up – so every job first puts its settings on the page (a share
 * link's settings, a swept value: `loadPresetSettings()`; a mode: `changeMode()`, exactly as clicking the mode card does),
 * waits for the page to commit them and then starts the page's own `startFastExport()` with a `BatchExportRequest` in
 * `exportRef`: the export renders the job's seed and hands the file back instead of downloading `jumpingballslive-export.mp4`.
 * The batch names the file (`mode-seed-duration.mp4`), downloads it (optional) and keeps it for the ZIP. "Stop after this
 * clip" lets the job in progress finish; the fast export's own Cancel aborts it and stops the batch. When the batch is
 * over the page gets its settings back – with its uploads (the preset loader keeps the live ones) and, when Find Simulation
 * had found a run, that run (`keepFound`: the preset loader and the physics effects drop it on the way).
 */

/** A batch job, handed to the page's `startFastExport()` through `exportRef`. */
export interface BatchExportRequest {
  /** The seed the export renders (instead of the page run's). */
  seed: number;
  /** Unique per job: the export's race cup table scores the job's race under it. */
  key: string;
  /** How the export went; not called when the export did not start (another export, a recording or a search was running). */
  settle: (outcome: BatchExportOutcome) => void;
}

export type BatchExportOutcome = { result: FastRenderResult } | { cancelled: true } | { error: string };

export type BatchJobStatus = "queued" | "preparing" | "rendering" | "done" | "failed" | "cancelled" | "skipped";

/**
 * Why a job failed: a link that is not a simulator link, a share code this browser cannot read, the page was busy, no encoder,
 * --- jdm-rhythm-runner --- a run played by hand (a Beat Runner without Auto Jump, a Paddle Keep-Up without Auto Platform:
 * only Record Video captures its player).
 */
export type BatchJobError = "link" | "code" | "busy" | "unsupported" | "handPlay" | { message: string };

export interface BatchJobState {
  id: number;
  seed: number;
  link: string | null;
  variant: BatchVariant;
  /** The mode it was rendered in (known once its settings are on the page). */
  mode: ModeId | null;
  status: BatchJobStatus;
  /** Wall-clock time of the job (settings + export). */
  wallMs: number | null;
  durationSec: number | null;
  bytes: number | null;
  fileName: string | null;
  error: BatchJobError | null;
}

export type BatchRunStatus = "idle" | "running" | "stopping" | "finished" | "stopped";

export interface BatchRunState {
  status: BatchRunStatus;
  jobs: BatchJobState[];
  startedAt: number | null;
  finishedAt: number | null;
}

/** What the Batch block of the Recording section shows and does (sections/BatchSection.tsx). */
export interface BatchPanelProps {
  definition: BatchDefinition;
  onDefinitionChange: (patch: Partial<BatchDefinition>) => void;
  /** The pasted list, read. */
  list: BatchListParse;
  /** Clips the definition gives (capped) and whether the cap cut it. */
  jobCount: number;
  truncated: boolean;
  /** The Recording section's export format the clips get. */
  exportFormat: { resolution: string; fps: number; durationSec: number };
  /** Whether the browser has WebCodecs (null until known). */
  supported: boolean | null;
  /** Record Video, Find Simulation or a single fast export is busy, or a project is being opened. */
  disabled: boolean;
  run: BatchRunState;
  /** Progress (0–1) of the clip being rendered, null between clips. */
  jobProgress: number | null;
  zipping: boolean;
  zipFailed: boolean;
  onStart: () => void;
  onStop: () => void;
  onDownloadJob: (id: number) => void;
  onDownloadAll: () => void;
  onClear: () => void;
}

export interface UseBatchRenderOptions {
  settings: SimulatorSettings;
  /** Read by the page's `startFastExport()`: the job it renders. */
  exportRef: MutableRefObject<BatchExportRequest | null>;
  startFastExport: () => Promise<void>;
  /** Puts a whole settings object on the page (the preset loader; the page's live uploads stay selected). */
  applySettings: (settings: SimulatorSettings) => void;
  /**
   * The page's found simulation (Find Simulation's seed and result), kept over a batch that puts other settings on the page:
   * called as the batch starts, it returns what sets the found run up again once the page has its own settings back (null
   * when nothing was found).
   */
  keepFound: () => (() => void) | null;
  /** The mode card's mode change (the look, sound and recording settings carry over). */
  changeMode: (mode: ModeId) => void;
  /** Changes a few settings on the page (the panel's own update). */
  update: (patch: Partial<SimulatorSettings>) => void;
  /** The page's run is playing (started and not paused). */
  pageRunning: boolean;
  setPaused: (paused: boolean) => void;
  fastExport: FastExportState;
  supported: boolean | null;
  disabled: boolean;
}

// --- viral-bot --- a job handed in whole by another feature (the Bot section): its own settings, seed and file name
/** A clip of `runJobs()`: rendered with these settings and this seed, named `name`, after `prepare()` (e.g. loading its melody). */
export interface CustomBatchJob {
  seed: number;
  settings: SimulatorSettings;
  name: string;
  /** Called once the job's settings are on the page, before its export (awaited; the page settles again afterwards). */
  prepare?: () => Promise<void>;
  /** Download the clip on its own as soon as it is done (the Batch block's switch does not apply). */
  download?: boolean;
}

/** A clip `runJobs()` rendered: its 1-based place in the jobs handed in, its file name and the file. */
export interface CustomBatchFile {
  index: number;
  name: string;
  extension: string;
  blob: Blob;
  durationSec: number;
}
// --- end viral-bot ---

/** After new settings: time for the page's asynchronous set-up (a hit sample or wall-break clip decoding) before the export copies it. */
const SETTLE_MS = 250;

const IDLE: BatchRunState = { status: "idle", jobs: [], startedAt: null, finishedAt: null };

/** A queued job; its mode is known up front unless a link brings its own. */
function initialJob(job: { id: number; seed: number; link: string | null; variant: BatchVariant }, pageMode: ModeId): BatchJobState {
  const mode = job.variant.kind === "mode" ? job.variant.mode : job.link ? null : pageMode;
  return { ...job, mode, status: "queued", wallMs: null, durationSec: null, bytes: null, fileName: null, error: null };
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useBatchRender(options: UseBatchRenderOptions): { panel: BatchPanelProps; running: boolean; runJobs: (jobs: CustomBatchJob[]) => Promise<CustomBatchFile[]> /* --- viral-bot --- */ } {
  // The page's latest callbacks and state: a job waits for a commit, then calls what that render created.
  const latest = useRef(options);
  latest.current = options;

  /* ---------------------------------------------------------- the definition (kept in localStorage) */
  // Loaded after mounting (the static page is pre-rendered without storage); saved on every change the panel makes.
  const [definition, setDefinition] = useState<BatchDefinition>(defaultBatchDefinition);
  useEffect(() => setDefinition(loadBatchDefinition()), []);
  const onDefinitionChange = useCallback((patch: Partial<BatchDefinition>) => {
    setDefinition((d) => {
      const next = { ...d, ...patch, list: (patch.list ?? d.list).slice(0, BATCH_LIST_MAX_CHARS) };
      saveBatchDefinition(next); // idempotent, so a repeated updater call is harmless
      return next;
    });
  }, []);
  const definitionRef = useRef(definition);
  definitionRef.current = definition;
  const list = useMemo(() => parseBatchList(definition.list), [definition.list]);
  const { count: jobCount, truncated } = batchJobCount(definition, list);

  /* ---------------------------------------------------------- waiting for the page to commit */
  const [, setTick] = useState(0);
  const commitWaiters = useRef<(() => void)[]>([]);
  // Runs after every commit of the page (declared after the page's own effects, so they have run by then).
  useEffect(() => {
    if (commitWaiters.current.length === 0) return;
    for (const resolve of commitWaiters.current.splice(0)) resolve();
  });
  const nextCommit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        commitWaiters.current.push(resolve);
        setTick((n) => n + 1);
      }),
    [],
  );
  /** New settings are on the page: its effects have run (and those they set off), and its asynchronous set-up had a moment. */
  const settle = useCallback(async () => {
    await nextCommit();
    await pause(SETTLE_MS);
    await nextCommit();
  }, [nextCommit]);

  /* ---------------------------------------------------------- the run */
  const [run, setRun] = useState<BatchRunState>(IDLE);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const mounted = useRef(true);
  const files = useRef(new Map<number, { name: string; extension: string; blob: Blob; durationSec?: number /* --- viral-bot --- */ }>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRef.current = true;
    };
  }, []);

  const patchJob = useCallback((id: number, patch: Partial<BatchJobState>) => {
    setRun((r) => ({ ...r, jobs: r.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
  }, []);

  const start = useCallback(async (custom?: CustomBatchJob[]): Promise<CustomBatchFile[]> => {
    const o = latest.current;
    if (runningRef.current || o.disabled) return [];
    const def = definitionRef.current;
    // --- viral-bot --- jobs handed in whole render as they are (their settings, seed and name), in order
    const { jobs } = custom ? { jobs: custom.map((c, i): BatchJobPlan => ({ id: i + 1, seed: c.seed, link: null, variant: { kind: "none" } })) } : planBatch(def, parseBatchList(def.list));
    if (jobs.length === 0) return [];
    runningRef.current = true;
    stopRef.current = false;
    files.current.clear();
    const used = new Set<string>();
    const runId = Date.now().toString(36);
    setRun({ status: "running", jobs: jobs.map((job) => initialJob(job, o.settings.mode)), startedAt: Date.now(), finishedAt: null });
    // The page's settings come back when the batch is over (and a found run with them); its run stays paused meanwhile.
    const snapshot = o.settings;
    const restoreFound = o.keepFound();
    const wasRunning = o.pageRunning;
    if (wasRunning) {
      o.setPaused(true);
      await nextCommit(); // so the first export sees the page paused (and leaves it paused)
    }
    let changed = false;
    let abort = false;
    try {
      for (const job of jobs) {
        if (stopRef.current || abort || !mounted.current) {
          patchJob(job.id, { status: "skipped" });
          continue;
        }
        const t0 = performance.now();
        patchJob(job.id, { status: "preparing" });
        // 1. The job's settings: the page's (as the batch started) or its link's, with a swept value; then its mode.
        let target = snapshot;
        const customJob = custom?.[job.id - 1]; // --- viral-bot ---
        if (customJob) target = customJob.settings;
        if (job.link) {
          const r = await resolveLinkSettings(job.link);
          if (!r.ok) {
            patchJob(job.id, { status: "failed", error: r.error === "unsupported" ? "code" : "link" });
            continue;
          }
          target = linkJobSettings(r.settings, snapshot);
        }
        if (job.variant.kind === "sweep") target = sweepSettings(target, job.variant.key, job.variant.value);
        if (!sameSettings(target, latest.current.settings)) {
          latest.current.applySettings(target);
          changed = true;
          await settle();
        }
        if (job.variant.kind === "mode" && job.variant.mode !== latest.current.settings.mode) {
          latest.current.changeMode(job.variant.mode);
          changed = true;
          await settle();
          // A new mode starts from its defaults, the clip length too: every mode gets the batch's clip length.
          if (latest.current.settings.recordingDuration !== target.recordingDuration) {
            latest.current.update({ recordingDuration: target.recordingDuration });
            await settle();
          }
        }
        // --- viral-bot --- the job's own set-up (its melody), once its settings are on the page
        if (customJob?.prepare) {
          await customJob.prepare();
          changed = true;
          await settle();
        }
        if (!mounted.current) break;
        const s = latest.current.settings;
        const mode = s.mode;
        patchJob(job.id, { mode });
        // --- jdm-rhythm-runner --- a run played by hand has no player in an export (it would crash / miss on its own).
        if (jdmRhythmPlayedByHand(s)) {
          patchJob(job.id, { status: "failed", error: "handPlay", wallMs: performance.now() - t0 });
          continue;
        }
        // 2. An encoder for this job's format (the page's export would fall back to Record Video without one).
        const size = resolutionToSize(s.recordingResolution);
        if (!fastRenderSupported() || !(await pickExportFormat(size.width, size.height, resolveFastExportFps(s.fastExportFps)))) {
          patchJob(job.id, { status: "failed", error: "unsupported", wallMs: performance.now() - t0 });
          abort = true;
          continue;
        }
        // 3. The page's fast export, for this job's seed.
        patchJob(job.id, { status: "rendering" });
        const box: { outcome: BatchExportOutcome | null } = { outcome: null };
        latest.current.exportRef.current = { seed: job.seed, key: `${runId}-${job.id}`, settle: (outcome) => (box.outcome = outcome) };
        try {
          await latest.current.startFastExport();
        } finally {
          latest.current.exportRef.current = null;
        }
        const outcome = box.outcome;
        const wallMs = performance.now() - t0;
        if (!outcome) patchJob(job.id, { status: "failed", error: "busy", wallMs });
        else if ("cancelled" in outcome) {
          patchJob(job.id, { status: "cancelled", wallMs });
          abort = true; // the fast export's own Cancel stops the whole batch
        } else if ("error" in outcome) patchJob(job.id, { status: "failed", error: { message: outcome.error }, wallMs });
        else {
          const { result } = outcome;
          const extension = result.format.extension;
          const base = uniqueFileBase(customJob ? customJob.name : batchFileBase({ mode, seed: job.seed, durationSec: result.durationSec, variant: job.variant }), extension, used); // --- viral-bot --- (its own name)
          files.current.set(job.id, { name: `${base}.${extension}`, extension, blob: result.blob, durationSec: result.durationSec });
          offerPublishClip({ blob: result.blob, name: `${base}.${extension}`, source: customJob ? "bot" : "batch", durationSec: result.durationSec, mode, seed: job.seed, botClipId: customJob ? customJob.name : null }); // --- social-publish --- (a bot clip's copy comes from its plan)
          if (customJob ? customJob.download : definitionRef.current.downloadEach) downloadExport(result.blob, extension, base);
          patchJob(job.id, { status: "done", wallMs, durationSec: result.durationSec, bytes: result.blob.size, fileName: `${base}.${extension}` });
        }
      }
    } finally {
      if (mounted.current) {
        if (changed) {
          latest.current.applySettings(snapshot);
          if (restoreFound) {
            // The page's effects run on its own settings first (a physics change drops a found seed), then the found run is back.
            await settle();
            if (mounted.current) restoreFound();
          } else await nextCommit();
        } else if (wasRunning) latest.current.setPaused(false);
      }
      runningRef.current = false;
      const stopped = stopRef.current || abort;
      if (mounted.current) setRun((r) => ({ ...r, status: stopped ? "stopped" : "finished", finishedAt: Date.now() }));
    }
    // --- viral-bot --- the files of the batch, in job order
    return [...files.current.entries()].sort((a, b) => a[0] - b[0]).map(([id, f]) => ({ index: id, name: f.name, extension: f.extension, blob: f.blob, durationSec: f.durationSec ?? 0 }));
  }, [patchJob, settle, nextCommit]);

  const onStart = useCallback(() => void start(), [start]);
  const runJobs = useCallback((jobs: CustomBatchJob[]) => start(jobs), [start]); // --- viral-bot ---
  const onStop = useCallback(() => {
    if (!runningRef.current) return;
    stopRef.current = true;
    setRun((r) => (r.status === "running" ? { ...r, status: "stopping" } : r));
  }, []);

  /* ---------------------------------------------------------- files */
  const onDownloadJob = useCallback((id: number) => {
    const file = files.current.get(id);
    if (file) downloadExport(file.blob, file.extension, file.name.slice(0, -(file.extension.length + 1)));
  }, []);
  const [zipping, setZipping] = useState(false);
  const [zipFailed, setZipFailed] = useState(false);
  const onDownloadAll = useCallback(async () => {
    const all = [...files.current.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => ({ name: f.name, blob: f.blob }));
    if (all.length === 0) return;
    setZipping(true);
    setZipFailed(false);
    try {
      const zip = await zipBlobs(all);
      downloadExport(zip, "zip", batchZipBase(new Date()));
    } catch (err) {
      console.warn("Batch ZIP failed:", err);
      setZipFailed(true);
    } finally {
      setZipping(false);
    }
  }, []);
  const onClear = useCallback(() => {
    if (runningRef.current) return;
    files.current.clear();
    setZipFailed(false);
    setRun(IDLE);
  }, []);

  const busy = run.status === "running" || run.status === "stopping";
  const { settings: s, fastExport, supported, disabled } = options;
  const panel: BatchPanelProps = {
    definition,
    onDefinitionChange,
    list,
    jobCount,
    truncated,
    exportFormat: { resolution: s.recordingResolution, fps: resolveFastExportFps(s.fastExportFps), durationSec: s.recordingDuration },
    supported,
    disabled,
    run,
    jobProgress: busy && fastExport.status === "running" ? fastExport.progress : null,
    zipping,
    zipFailed,
    onStart,
    onStop,
    onDownloadJob,
    onDownloadAll: () => void onDownloadAll(),
    onClear,
  };
  return { panel, running: busy, runJobs /* --- viral-bot --- */ };
}
