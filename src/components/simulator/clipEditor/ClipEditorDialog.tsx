"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import { btn, ghostBtn, inputClass, primaryBtn } from "@/components/simulator/desktop/ui";
import type { DesktopApi, LibraryMeta } from "@/lib/desktop/contract";
import { blobBytes } from "@/lib/desktop/bridge";
import { FastRenderUnsupportedError, downloadExport } from "@/lib/recording/fastRender";
import { offerPublishClip } from "@/lib/publish/clips";
import { sealWatermark } from "@/lib/watermark/seal";
import { drawEditFrame } from "@/lib/clipEdit/draw";
import { openSourceVideo, renderClipEdit, seekVideo, type ClipEditProgress, type ClipEditResult } from "@/lib/clipEdit/render";
import { CLIP_EDIT_OUTPUT, CLIP_EDIT_RANGES, CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT, clipTimeline, editFileName, fitClipEdit, loadClipEdit, parseClipEdit, saveClipEdit, sourceTimeAt, type ClipEditSpec } from "@/lib/clipEdit/spec";

/*
 * --- clip-editor --- The Clip editor: a finished video (a fast export, a recording, a file, the Windows app's Library)
 * cut for TikTok – start, length, crop-in, the hook and the address at the top, the end card – previewed frame for frame
 * and rendered in the browser (lib/clipEdit). On the website the file downloads and joins the Publish block's clips. In the
 * Windows app it is saved to the Library through the bridge, as every render is, and joins the Publish clips too.
 *
 * --- ai-cut --- The dialog can open on a cut it did not remember (`initialSpec`: the proposal a Library item carries in its
 * meta) and, in the Windows app, ask the local AI for one (`desktop.suggest`, the "Suggest with AI" button): the answer
 * lands in the same sliders and the same preview, to be judged and rendered like any other cut. Only the user's own edits
 * are remembered (saved as they are made), so a proposal never overwrites the spec the user settled on.
 */

export interface ClipEditorSource {
  blob: Blob;
  name: string;
  mode?: string | null;
  seed?: number | null;
}

export interface ClipEditorDesktop {
  bridge: DesktopApi;
  meta?: Partial<LibraryMeta>;
  onSaved?: () => void;
  /** --- ai-cut --- Asks the app's AI for a cut of the open source (`current`: the spec the preview shows); the signal is the dialog closing. */
  suggest?: (input: { durationSec: number; current: ClipEditSpec; request?: string; signal?: AbortSignal }) => Promise<{ spec: ClipEditSpec; summary: string }>;
}

type RenderState = { status: "idle" } | { status: "rendering"; progress: ClipEditProgress } | { status: "done"; result: ClipEditResult; where: "downloaded" | "saved" } | { status: "error"; message: string };
/** --- ai-cut --- The AI's proposal: asked for, landed (its one-line summary), or failed. */
type SuggestState = { status: "idle" } | { status: "running" } | { status: "done"; summary: string } | { status: "error"; message: string };

const HOOK_IDEAS = ["escape", "winner", "wait", "count"] as const;

/** The preview canvas: a quarter of the output, drawn with the same compositor. */
const PREVIEW_SCALE = 0.25;

export default function ClipEditorDialog({ source, onClose, desktop, initialSpec }: { source: ClipEditorSource; onClose: () => void; desktop?: ClipEditorDesktop | null; initialSpec?: Partial<ClipEditSpec> }) {
  const t = useTranslations("ClipEditor");
  // --- ai-cut --- the remembered spec, under the cut the source came with (a Library item's proposal) when there is one
  const [spec, setSpec] = useState<ClipEditSpec>(() => parseClipEdit({ ...loadClipEdit(), ...initialSpec }));
  const specRef = useRef(spec);
  specRef.current = spec;
  const [suggestion, setSuggestion] = useState<SuggestState>({ status: "idle" });
  const suggestAbortRef = useRef<AbortController | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [scrub, setScrub] = useState(0);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<{ video: HTMLVideoElement; release: () => void } | null>(null);
  const sealRef = useRef<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);
  const drawToken = useRef(0);

  const fitted = durationSec ? fitClipEdit(spec, durationSec) : spec;
  const timeline = clipTimeline(fitted, CLIP_EDIT_OUTPUT.fps);
  const card = useMemo(() => ({ title: t("cardTitle"), note: t("cardNote") }), [t]);
  const rendering = render.status === "rendering";
  const suggesting = suggestion.status === "running";

  // The source, opened once for the preview; the seal of the preview's frames (the file's run seals again).
  useEffect(() => {
    let live = true;
    void sealWatermark().then((seal) => (sealRef.current = seal));
    void openSourceVideo(source.blob)
      .then((opened) => {
        if (!live) return opened.release();
        videoRef.current = { video: opened.video, release: opened.release };
        setDurationSec(opened.durationSec);
      })
      .catch((err: unknown) => live && setOpenError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
      videoRef.current?.release();
      videoRef.current = null;
      abortRef.current?.abort();
      suggestAbortRef.current?.abort(); // --- ai-cut --- a proposal still on its way is dropped with the dialog
    };
  }, [source.blob]);

  // The preview frame at the scrub time (drawn after the seek lands; a newer request wins).
  useEffect(() => {
    const canvas = canvasRef.current;
    const opened = videoRef.current;
    if (!canvas || !opened || durationSec === null || rendering) return;
    const token = ++drawToken.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tSec = Math.min(scrub, timeline.totalSec);
    void seekVideo(opened.video, sourceTimeAt(fitted, tSec))
      .catch(() => undefined)
      .then(() => {
        if (token !== drawToken.current || !sealRef.current) return;
        const { video } = opened;
        drawEditFrame(ctx, { image: video, width: video.videoWidth || canvas.width, height: video.videoHeight || canvas.height }, canvas.width, canvas.height, fitted, timeline, tSec, card, { seal: sealRef.current, clipMs: tSec * 1000 });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, fitted.startSec, fitted.lengthSec, fitted.zoom, fitted.hook, fitted.url, fitted.cardSec, durationSec, rendering, card.title, card.note]);

  // --- ai-cut --- the user's own edits are what is remembered (not the cut the dialog opened on, not the AI's proposal)
  const set = <K extends keyof ClipEditSpec>(key: K, value: ClipEditSpec[K]) => {
    const next = { ...specRef.current, [key]: value };
    specRef.current = next;
    saveClipEdit(next);
    setSpec(next);
  };

  // --- ai-cut --- the app's AI proposes a cut of the open source; it lands in the sliders and the preview, unsaved until edited
  const suggest = useCallback(async () => {
    const ask = desktop?.suggest;
    if (!ask || durationSec === null) return;
    const controller = new AbortController();
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = controller;
    setSuggestion({ status: "running" });
    try {
      const { spec: proposed, summary } = await ask({ durationSec, current: fitted, signal: controller.signal });
      if (controller.signal.aborted) return;
      setSpec(parseClipEdit(proposed));
      setSuggestion({ status: "done", summary });
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err);
      setSuggestion({ status: "error", message: t("suggestFailed", { error }) });
    } finally {
      if (suggestAbortRef.current === controller) suggestAbortRef.current = null;
    }
  }, [desktop, durationSec, fitted, t]);

  const start = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRender({ status: "rendering", progress: { phase: "prepare", progress: 0, frame: 0, frames: 0 } });
    try {
      const result = await renderClipEdit({ source: source.blob, spec: fitted, card, signal: controller.signal, onProgress: (progress) => setRender({ status: "rendering", progress }) });
      if (!result) return setRender({ status: "idle" });
      const name = editFileName(source.name, result.format.extension);
      let where: "downloaded" | "saved" = "downloaded";
      if (desktop) {
        const meta: LibraryMeta = { title: desktop.meta?.title ?? name, mode: desktop.meta?.mode ?? source.mode ?? "", seed: desktop.meta?.seed ?? source.seed ?? 0, link: desktop.meta?.link ?? "", platform: "tiktok", hook: fitted.hook, caption: desktop.meta?.caption ?? null, hashtags: desktop.meta?.hashtags ?? [], queueJobId: null };
        await desktop.bridge.render.save({ jobId: `edit-${Date.now().toString(36)}`, folder: "", name: name.replace(/\.[a-z0-9]+$/i, ""), extension: result.format.extension, data: await blobBytes(result.blob), durationSec: result.durationSec, transcode: null, meta });
        desktop.onSaved?.();
        where = "saved";
      } else downloadExport(result.blob, result.format.extension, name.replace(/\.[a-z0-9]+$/i, ""));
      offerPublishClip({ blob: result.blob, name, source: "edit", durationSec: result.durationSec, mode: source.mode ?? null, seed: source.seed ?? null });
      setRender({ status: "done", result, where });
    } catch (err) {
      const message = err instanceof FastRenderUnsupportedError ? t("unsupported") : err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err);
      setRender({ status: "error", message });
    } finally {
      abortRef.current = null;
    }
  }, [source, fitted, card, desktop, t]);

  const number = (key: "startSec" | "lengthSec" | "zoom" | "cardSec", label: string, format: (v: number) => string, max?: number) => {
    const range = CLIP_EDIT_RANGES[key];
    // the slider's end (the source's length for the start and the length), never a cap on the value (uncap-all)
    const top = max !== undefined && max < range.max ? max : range.max;
    return (
      <label className="block text-xs text-ink-2 space-y-1">
        <span className="flex justify-between">
          <span>{label}</span>
          <span className="tabular-nums text-ink">{format(fitted[key])}</span>
        </span>
        <input type="range" min={range.min} max={top} step={range.step} value={fitted[key]} disabled={rendering} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-accent" data-testid={`clip-edit-${key}`} />
      </label>
    );
  };

  const sec = (v: number) => t("seconds", { sec: v.toFixed(1) });
  const canRender = durationSec !== null && !openError && !rendering && !suggesting;
  // --- ai-cut --- the one error slot: a render that failed, else a proposal that did
  const errorMessage = render.status === "error" ? render.message : suggestion.status === "error" ? suggestion.message : null;

  return (
    <Dialog title={t("title")} closeLabel={t("close")} onClose={onClose} placement="center" id="clip-editor" bodyClassName="p-3 sm:p-4">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]" data-testid="clip-editor" data-clip-editor={render.status}>
        <div className="space-y-2 mx-auto">
          <canvas ref={canvasRef} width={CLIP_EDIT_OUTPUT.width * PREVIEW_SCALE} height={CLIP_EDIT_OUTPUT.height * PREVIEW_SCALE} className="rounded-lg bg-black border border-line-strong w-[200px] sm:w-[270px] h-auto" aria-label={t("previewAlt")} />
          <input type="range" min={0} max={timeline.totalSec} step={1 / CLIP_EDIT_OUTPUT.fps} value={Math.min(scrub, timeline.totalSec)} disabled={rendering || durationSec === null} onChange={(e) => setScrub(Number(e.target.value))} className="w-full accent-accent" aria-label={t("scrub")} data-testid="clip-edit-scrub" />
          <p className="text-xs text-ink-3 text-center tabular-nums">
            {sec(Math.min(scrub, timeline.totalSec))} / {sec(timeline.totalSec)}
            {durationSec !== null && <span> · {t("sourceLength", { sec: durationSec.toFixed(1) })}</span>}
          </p>
        </div>

        <div className="space-y-3 min-w-0">
          <p className="text-xs text-ink-3 leading-snug">{t("intro")}</p>
          {openError && (
            <p className="text-xs text-danger" role="alert">
              {openError}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {number("startSec", t("start"), sec, durationSec ? Math.max(0, durationSec - 1) : undefined)}
            {number("lengthSec", t("length"), sec, durationSec ? Math.max(CLIP_EDIT_RANGES.lengthSec.min, durationSec - fitted.startSec) : undefined)}
            {number("zoom", t("zoom"), (v) => `${Math.round((v - 1) * 100)} %`)}
            {number("cardSec", t("card"), sec)}
          </div>
          <label className="block text-xs text-ink-2 space-y-1">
            <span>{t("hook")}</span>
            <input type="text" value={spec.hook} maxLength={CLIP_EDIT_TEXT_MAX} disabled={rendering} onChange={(e) => set("hook", e.target.value)} placeholder={t("hookPlaceholder")} className={`${inputClass} w-full`} data-testid="clip-edit-hook" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_IDEAS.map((idea) => (
              <button key={idea} type="button" disabled={rendering} onClick={() => set("hook", t(`ideas.${idea}`))} className={`${btn} bg-surface-2 text-ink-2 hover:text-ink border border-line`}>
                {t(`ideas.${idea}`)}
              </button>
            ))}
          </div>
          <label className="block text-xs text-ink-2 space-y-1">
            <span>{t("url")}</span>
            <input type="text" value={spec.url} maxLength={CLIP_EDIT_TEXT_MAX} disabled={rendering} onChange={(e) => set("url", e.target.value)} placeholder={DEFAULT_CLIP_EDIT.url} className={`${inputClass} w-full`} data-testid="clip-edit-url" />
          </label>

          {render.status === "rendering" && (
            <div className="space-y-1" role="status">
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(render.progress.progress * 100)}%` }} />
              </div>
              <p className="text-xs text-ink-3 tabular-nums">{t(`phase.${render.progress.phase}`, { frame: render.progress.frame, frames: render.progress.frames, percent: Math.round(render.progress.progress * 100) })}</p>
            </div>
          )}
          {render.status === "done" && (
            <p className="text-xs text-ink-2" role="status" data-testid="clip-edit-done">
              {t(render.where === "saved" ? "savedLibrary" : "downloaded", { sec: render.result.durationSec.toFixed(1), mb: (render.result.blob.size / 1048576).toFixed(1) })}
              {render.result.watermarked && <span> {t("watermarked")}</span>}
            </p>
          )}
          {suggestion.status === "done" && (
            <p className="text-xs text-ink-2" role="status" data-testid="clip-edit-suggested">
              {t("suggested", { summary: suggestion.summary })}
            </p>
          )}
          {errorMessage && (
            <p className="text-xs text-danger" role="alert" data-testid="clip-edit-error">
              {errorMessage}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {rendering ? (
              <button type="button" className={ghostBtn} onClick={() => abortRef.current?.abort()}>
                {t("cancel")}
              </button>
            ) : (
              <button type="button" className={primaryBtn} disabled={!canRender} onClick={() => void start()} data-testid="clip-edit-render">
                {desktop ? t("renderSave") : t("renderDownload")}
              </button>
            )}
            {/* --- ai-cut --- only in the Windows app, once the source is open: the local AI proposes the cut */}
            {desktop?.suggest && durationSec !== null && (
              <button type="button" className={ghostBtn} disabled={suggesting || rendering} aria-busy={suggesting} onClick={() => void suggest()} data-testid="clip-edit-suggest">
                {suggesting ? t("suggesting") : t("suggest")}
              </button>
            )}
            {render.status === "done" && (
              <button type="button" className={ghostBtn} onClick={() => downloadExport(render.result.blob, render.result.format.extension, editFileName(source.name).replace(/\.[a-z0-9]+$/i, ""))}>
                {t("downloadAgain")}
              </button>
            )}
            <button type="button" className={ghostBtn} onClick={onClose}>
              {t("close")}
            </button>
          </div>
          <p className="text-xs text-ink-3 leading-snug">{t("tip")}</p>
        </div>
      </div>
    </Dialog>
  );
}
