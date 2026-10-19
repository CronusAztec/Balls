"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { resolutionToSize } from "@/lib/settings";
import { seedParam } from "@/lib/recording/batch"; // --- low-findings ---
import type { DesktopApi, LibraryMeta, RenderProgressEvent, VideoCodec } from "@/lib/desktop/contract";
import { blobBytes } from "@/lib/desktop/bridge";
import { lastVideoAcceleration, setDesktopExportCodec } from "@/lib/desktop/gpuEncode";
import { renderFormatFor, transcodeSpecFor } from "@/lib/desktop/presets";
import {
  EMPTY_QUEUE,
  cancelAll as cancelAllJobs,
  cancelJob,
  clearFinished,
  enqueue,
  isActive,
  jobProgress,
  journalOf,
  markDone,
  markEncoding,
  markFailed,
  markProgress,
  markRendering,
  moveJob,
  nextJob,
  pauseQueue,
  queueSummary,
  removeJob,
  restoreQueue,
  retryFailed,
  retryJob,
  startQueue,
  type QueueJob,
  type QueueJobSpec,
  type QueueState,
} from "@/lib/desktop/renderQueue";
import { settingsToSearchParams } from "@/lib/settings";
import { SITE_URL } from "@/lib/site";
import type { DesktopPageHooks } from "./pageHooks";
// --- ai-cut --- the job's TikTok cut: the page's own editor (lib/clipEdit) cuts the just-rendered file and the app saves it next to the master
import type { EditCardText } from "@/lib/clipEdit/draw";
import { renderClipEdit } from "@/lib/clipEdit/render";
import { editFileName } from "@/lib/clipEdit/spec";
import { refitClipEdit } from "@/lib/clipEdit/propose";
import { offerPublishClip } from "@/lib/publish/clips";
// --- free-watermark --- (was paywall-gate) the render queue renders for everyone: its jobs are fast exports, watermarked without a Pro licence

/*
 * --- desktop-exe --- The page's side of the render queue: it keeps the queue (lib/desktop/renderQueue.ts), writes the journal
 * through the app after every change (crash-safe on disk), offers to resume a queue a restart interrupted, and works through
 * the jobs one at a time: the job's settings, seed, size and frame rate go through the batch renderer's `runJobs()` – the
 * page's own fast export, on the GPU encoder in the app – and the file goes straight to the output folder through the app,
 * via ffmpeg when the job's preset or codec asks for it. No download dialog, progress per job, cancel and retry.
 *
 * --- ai-cut --- A job that carries a `cut` (the AI's plan, or a re-render of a clip that had one) is cut after it is done:
 * the fast export's file, still in memory, goes through the Clip editor's renderer with the cut refitted to the file's real
 * length, and the app saves the result as a second Library item (`<name>-tiktok`, platform tiktok, the cut in its meta). The
 * master is done before the cut starts and stays done whatever the cut does: a failed cut is logged and reported through
 * `onFailed`, a cancelled one is dropped, and a restart mid-cut re-renders nothing. The cut's progress travels as
 * `cutting` next to the state (a done job has no bar of its own); the loop waits for it like for a render.
 */

const PROGRESS_SAVE_MS = 2000;
let jobCounter = 0;
const newJobId = () => `job-${Date.now().toString(36)}-${(++jobCounter).toString(36)}`;

/** The codec of a string WebCodecs was configured with. */
function codecOfString(codec: string | undefined): VideoCodec | null {
  if (!codec) return null;
  if (codec.startsWith("avc")) return "h264";
  if (codec.startsWith("hvc") || codec.startsWith("hev")) return "hevc";
  if (codec.startsWith("av01")) return "av1";
  return null;
}

/** The simulator link that renders the job again (its settings and seed). */
export function jobLink(job: Pick<QueueJob, "settings" | "seed">, locale: string): string {
  const params = settingsToSearchParams(job.settings);
  params.set("seed", seedParam(job.seed)); // --- low-findings --- (the engine's value: a negative found seed too)
  return `${SITE_URL}/${locale}/simulator/?${params.toString()}`;
}

export interface RenderQueueApi {
  state: QueueState;
  resumable: number | null;
  folder: string;
  add: (specs: QueueJobSpec[]) => number;
  start: () => void;
  pause: () => void;
  cancel: (id: string) => void;
  cancelAll: () => void;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  clearDone: () => void;
  dismissResume: () => void;
  lastError: string | null;
  /** --- ai-cut --- The done job whose TikTok cut is being made, with the cut's progress (0–1); null when none is. */
  cutting: { jobId: string; progress: number } | null;
}

/** --- ai-cut --- What the cut step needs from the page: the end card's words, and where to report a cut that failed. */
export interface RenderQueueCut {
  card: EditCardText;
  onFailed?: (job: QueueJob, message: string) => void;
}

export function useRenderQueue(bridge: DesktopApi | null, pageRef: MutableRefObject<DesktopPageHooks>, folder: string, onSaved: () => void, cut?: RenderQueueCut): RenderQueueApi {
  const [state, setState] = useState<QueueState>(EMPTY_QUEUE);
  const stateRef = useRef(state);
  const [resumable, setResumable] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const loaded = useRef(false);
  const lastSave = useRef(0);
  const runningJob = useRef<string | null>(null);
  const cancelled = useRef(new Set<string>());
  // --- ai-cut --- the cut step's words and callback (a ref: a new object per render must not restart the loop), the cut in progress
  const cutRef = useRef(cut);
  cutRef.current = cut;
  const cutRun = useRef<{ jobId: string; controller: AbortController } | null>(null);
  const [cutting, setCutting] = useState<RenderQueueApi["cutting"]>(null);

  /** Applies a transition; `persist` writes the journal now (status changes), else at most every 2 s (progress). */
  const apply = useCallback(
    (fn: (s: QueueState) => QueueState, persist = true) => {
      const next = fn(stateRef.current);
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
      const now = Date.now();
      if (bridge && loaded.current && (persist || now - lastSave.current > PROGRESS_SAVE_MS)) {
        lastSave.current = now;
        void bridge.journal.save(journalOf(next, now)).catch((err: unknown) => bridge.log("warn", `journal: ${String(err)}`));
      }
    },
    [bridge],
  );

  // The journal of the last session.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge.journal
      .load()
      .then((raw) => {
        if (!alive) return;
        const restored = restoreQueue(raw, Date.now());
        stateRef.current = restored.state;
        setState(restored.state);
        if (restored.resumable) setResumable(restored.state.jobs.filter((j) => j.status === "queued").length);
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
    return () => {
      alive = false;
    };
  }, [bridge]);

  // ffmpeg's progress of the job being saved.
  useEffect(() => {
    if (!bridge) return;
    return bridge.on("renderProgress", (e: RenderProgressEvent) => {
      if (e.phase === "encoding") apply((s) => markProgress(s, e.jobId, jobProgress("encoding", e.progress, true), Date.now()), false);
    });
  }, [bridge, apply]);

  // The fast export's progress of the job being rendered.
  const fastExport = pageRef.current.fastExport;
  useEffect(() => {
    const id = runningJob.current;
    if (!id || fastExport.status !== "running") return;
    const job = stateRef.current.jobs.find((j) => j.id === id);
    if (!job || job.status !== "rendering") return;
    const encodes = job.preset !== "native" || job.codec !== "h264";
    apply((s) => markProgress(s, id, jobProgress("rendering", fastExport.progress, encodes), Date.now()), false);
  }, [fastExport, apply]);

  const runOne = useCallback(
    async (job: QueueJob) => {
      if (!bridge) return;
      const page = pageRef.current;
      runningJob.current = job.id;
      apply((s) => markRendering(s, job.id, Date.now()));
      try {
        const render = renderFormatFor(job.preset, job.resolution, job.fps);
        const size = resolutionToSize(render.resolution);
        // WebCodecs writes the codec itself for a native job (HEVC / AV1 on the GPU when it can); a platform preset renders
        // H.264 and ffmpeg encodes the target.
        setDesktopExportCodec(job.preset === "native" ? job.codec : "h264");
        const melody = job.source.kind === "plan" || job.source.kind === "ai" ? job.source.melodyId : undefined;
        const t0 = Date.now();
        const files = await page.runJobs([
          {
            seed: job.seed,
            name: job.name,
            settings: { ...job.settings, recordingResolution: render.resolution, fastExportFps: render.fps },
            prepare: melody !== undefined ? async () => void (await page.selectMelody(melody)) : undefined,
            download: false,
          },
        ]);
        setDesktopExportCodec("h264");
        if (cancelled.current.has(job.id)) return;
        const file = files[0];
        if (!file) {
          // The batch renderer's own verdict on this job (its run started with this call), else the page refused to render.
          const run = pageRef.current.batchRun;
          const failed = run.startedAt !== null && run.startedAt >= t0 ? run.jobs[0] : undefined;
          const reason = failed?.error ? (typeof failed.error === "string" ? failed.error : failed.error.message) : failed?.status === "cancelled" ? "cancelled" : "the page could not render this clip (busy, or a split-screen race)";
          apply((s) => markFailed(s, job.id, reason, Date.now()));
          return;
        }
        const rendered = { extension: file.extension, codec: file.extension === "mp4" ? codecOfString(lastVideoAcceleration()?.codec) ?? "h264" : null };
        const transcode = transcodeSpecFor(job.preset, job.codec, { width: size.width, height: size.height, fps: render.fps }, rendered);
        if (transcode) apply((s) => markEncoding(s, job.id, Date.now()));
        const meta: LibraryMeta = {
          title: job.meta.title || job.name,
          mode: job.settings.mode,
          seed: job.seed,
          link: job.meta.link ?? jobLink(job, page.locale),
          platform: job.meta.platform,
          hook: job.meta.hook,
          caption: job.meta.caption,
          hashtags: job.meta.hashtags,
          queueJobId: job.id,
          ...(job.cut ? { cut: job.cut } : {}), // --- ai-cut --- the master carries the proposal: "Edit for TikTok" opens pre-filled
        };
        const saved = await bridge.render.save({ jobId: job.id, folder, name: job.name, extension: file.extension, data: await blobBytes(file.blob), durationSec: file.durationSec, transcode, meta });
        if (cancelled.current.has(job.id)) return;
        apply((s) => markDone(s, job.id, { path: saved.path, bytes: saved.bytes, durationSec: saved.durationSec, encoder: saved.encoder }, Date.now()));
        // --- ai-cut --- the master is done; now its cut, from the fast export still in memory, in the page (lib/clipEdit/render.ts).
        // Its own try/catch: whatever the cut does, the master stays done and is not rendered again.
        const cutDeps = cutRef.current;
        if (job.cut && cutDeps) {
          const controller = new AbortController();
          cutRun.current = { jobId: job.id, controller };
          setCutting({ jobId: job.id, progress: 0 });
          try {
            // The plan's cut was made against the planned length (its own end: a cut that ran to the planned end stays end-anchored
            // on a file that came out shorter); refitted to the file as rendered.
            const spec = refitClipEdit(job.cut, job.cut.startSec + job.cut.lengthSec, file.durationSec);
            const result = await renderClipEdit({ source: file.blob, spec, card: cutDeps.card, signal: controller.signal, onProgress: (p) => setCutting({ jobId: job.id, progress: p.progress }) });
            if (result && !controller.signal.aborted) {
              const fileName = editFileName(job.name, result.format.extension);
              const cutMeta: LibraryMeta = { ...meta, platform: "tiktok", hook: result.spec.hook, queueJobId: `${job.id}-cut` /* the cut, not the master: the Library tells them apart */, cut: result.spec };
              await bridge.render.save({ jobId: `${job.id}-cut`, folder, name: fileName.replace(/\.[a-z0-9]+$/i, ""), extension: result.format.extension, data: await blobBytes(result.blob), durationSec: result.durationSec, transcode: null, meta: cutMeta });
              offerPublishClip({ blob: result.blob, name: fileName, source: "edit", durationSec: result.durationSec, mode: job.settings.mode, seed: job.seed });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err);
            setLastError(message);
            bridge.log("warn", `queue cut ${job.name}: ${message}`);
            cutDeps.onFailed?.(job, message);
          } finally {
            cutRun.current = null;
            setCutting(null);
          }
        }
        onSaved();
      } catch (err) {
        setDesktopExportCodec("h264");
        if (cancelled.current.has(job.id)) return;
        const message = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err);
        setLastError(message);
        bridge.log("warn", `queue job ${job.name}: ${message}`);
        apply((s) => markFailed(s, job.id, message, Date.now()));
      } finally {
        runningJob.current = null;
        cancelled.current.delete(job.id);
        // The loop below picks the next job on the next render.
        setState((s) => ({ ...s }));
      }
    },
    [bridge, pageRef, folder, apply, onSaved],
  );

  // The loop: while the queue runs and nothing renders, start the next job (when the page is free).
  const pageBusy = pageRef.current.busy;
  useEffect(() => {
    if (!bridge || runningJob.current) return;
    const job = nextJob(state);
    if (!job) {
      if (state.running && queueSummary(state).queued === 0) apply((s) => pauseQueue(s));
      return;
    }
    if (pageBusy) return;
    void runOne(job);
  }, [bridge, state, runOne, apply, pageBusy]);

  const add = useCallback(
    (specs: QueueJobSpec[]) => {
      const before = stateRef.current.jobs.length;
      apply((s) => enqueue(s, specs, Date.now(), newJobId));
      return stateRef.current.jobs.length - before;
    },
    [apply],
  );
  const cancel = useCallback(
    (id: string) => {
      const job = stateRef.current.jobs.find((j) => j.id === id);
      if (job && isActive(job)) {
        cancelled.current.add(id);
        pageRef.current.cancelExport();
        void bridge?.render.cancel(id);
      }
      if (cutRun.current?.jobId === id) cutRun.current.controller.abort(); // --- ai-cut --- a done job's cut in progress: only the cut stops
      apply((s) => cancelJob(s, id, Date.now()));
    },
    [apply, bridge, pageRef],
  );
  const cancelAll = useCallback(() => {
    const active = stateRef.current.jobs.find(isActive);
    if (active) {
      cancelled.current.add(active.id);
      pageRef.current.cancelExport();
      void bridge?.render.cancel(active.id);
    }
    cutRun.current?.controller.abort(); // --- ai-cut ---
    apply((s) => cancelAllJobs(s, Date.now()));
  }, [apply, bridge, pageRef]);

  return {
    state,
    resumable,
    folder,
    add,
    start: () => {
      setResumable(null);
      apply((s) => startQueue(s));
    },
    pause: () => apply((s) => pauseQueue(s)),
    cancel,
    cancelAll,
    retry: (id) => apply((s) => retryJob(s, id, Date.now())),
    retryAllFailed: () => apply((s) => retryFailed(s, Date.now())),
    remove: (id) => apply((s) => removeJob(s, id)),
    move: (id, delta) => apply((s) => moveJob(s, id, delta)),
    clearDone: () => apply((s) => clearFinished(s)),
    dismissResume: () => setResumable(null),
    lastError,
    cutting, // --- ai-cut ---
  };
}
