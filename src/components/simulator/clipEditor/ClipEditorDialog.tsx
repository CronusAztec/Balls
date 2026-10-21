"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import { btn, ghostBtn, inputClass, primaryBtn } from "@/components/simulator/desktop/ui";
import type { DesktopApi, LibraryMeta } from "@/lib/desktop/contract";
import { blobBytes } from "@/lib/desktop/bridge";
import { downloadExport } from "@/lib/recording/fastRender";
import { offerPublishClip } from "@/lib/publish/clips";
import type { LoopCaptionContext } from "@/lib/publish/loopCaption"; // --- low-findings ---
import { sealWatermark, type WatermarkSeal } from "@/lib/watermark/seal";
import { drawEditFrame, fanMadeLine } from "@/lib/clipEdit/draw";
import { clipEditErrorKey, liveProgress, openSourceVideo, renderClipEdit, seekVideo, type ClipEditProgress, type ClipEditResult } from "@/lib/clipEdit/render";
import { CLIP_EDIT_OUTPUT, CLIP_EDIT_RANGES, CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT, clipTimeline, editFileName, fitClipEdit, loadClipEdit, localClipEdit, parseClipEdit, saveClipEdit, sourceTimeAt, type ClipEditSpec } from "@/lib/clipEdit/spec";

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
 *
 * --- cut-reedit --- A cut file opened as it is (`source.cutFile`: the Library has no master for it) already shows its look:
 * the dialog draws no fan-made badge on it again and remembers none of the edits made on it (its spec is the neutral one,
 * no address included, which must not become the look of the user's next cut).
 */

export interface ClipEditorSource {
  blob: Blob;
  name: string;
  mode?: string | null;
  seed?: number | null;
  /** --- low-findings --- A Publish clip's viral bot clip id and "Loop style" words: the cut keeps the source's copy and run. */
  botClipId?: string | null;
  loopCaption?: LoopCaptionContext | null;
  /** --- cut-reedit --- The file is a cut with its look burned in (lib/clipEdit/propose.ts `libraryEditOpen`). */
  cutFile?: boolean;
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

/** --- clip-locale --- A failure the editor expects (the browser, the file) in the page's language; any other as it came. */
function failureText(err: unknown, t: (key: "unsupported" | "cannotOpen" | "cannotSeek") => string): string {
  const key = clipEditErrorKey(err);
  if (key) return t(key);
  return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err);
}

/** The preview canvas: a quarter of the output, drawn with the same compositor. */
const PREVIEW_SCALE = 0.25;

export default function ClipEditorDialog({ source, onClose, desktop, initialSpec }: { source: ClipEditorSource; onClose: () => void; desktop?: ClipEditorDesktop | null; initialSpec?: Partial<ClipEditSpec> }) {
  const t = useTranslations("ClipEditor");
  const fl = useTranslations("FightLeague"); // --- legal-audit --- the fan-made badge's line
  // --- ai-cut --- the remembered spec, under the cut the source came with (a Library item's proposal) when there is one;
  // --- clip-locale --- nothing remembered yet: the default with the hook in the page's language
  const [spec, setSpec] = useState<ClipEditSpec>(() => {
    const defaults = localClipEdit(t("ideas.escape"));
    return parseClipEdit({ ...loadClipEdit(undefined, defaults), ...initialSpec }, defaults);
  });
  const specRef = useRef(spec);
  specRef.current = spec;
  const [suggestion, setSuggestion] = useState<SuggestState>({ status: "idle" });
  // --- clip-a11y --- which of the two answers came last (the render's or the AI's): the one the live region says
  const [latest, setLatest] = useState<"render" | "suggest">("render");
  const suggestAbortRef = useRef<AbortController | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [openError, setOpenError] = useState<{ error: unknown } | null>(null); // --- clip-locale --- (worded at render, in the page's language)
  const [scrub, setScrub] = useState(0);
  const [render, setRender] = useState<RenderState>({ status: "idle" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<{ video: HTMLVideoElement; release: () => void } | null>(null);
  // the preview's seal: state, so a seal that comes after the video (a licence renewal still in flight) draws the frame then
  const [seal, setSeal] = useState<WatermarkSeal | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const drawToken = useRef(0);

  const fitted = durationSec ? fitClipEdit(spec, durationSec) : spec;
  const timeline = clipTimeline(fitted, CLIP_EDIT_OUTPUT.fps);
  const card = useMemo(() => ({ title: t("cardTitle"), note: t("cardNote") }), [t]);
  // --- legal-audit --- a Fight League source's cut carries the fan-made badge again, in the preview and in the file
  // (--- cut-reedit --- a cut file has it in its frames already)
  const fanMade = source.cutFile ? null : fanMadeLine(source.mode, fl("canvasFanMade"));
  const rendering = render.status === "rendering";
  const suggesting = suggestion.status === "running";
  // the spec is the user's or the AI's, never both at once: no edits while a suggestion is on its way
  const busy = rendering || suggesting;

  // The source, opened once for the preview; the seal of the preview's frames (the file's run seals again).
  useEffect(() => {
    let live = true;
    void sealWatermark().then((sealed) => live && setSeal(sealed));
    void openSourceVideo(source.blob)
      .then((opened) => {
        if (!live) return opened.release();
        videoRef.current = { video: opened.video, release: opened.release };
        setDurationSec(opened.durationSec);
      })
      .catch((err: unknown) => live && setOpenError({ error: err }));
    return () => {
      live = false;
      videoRef.current?.release();
      videoRef.current = null;
      abortRef.current?.abort();
      suggestAbortRef.current?.abort(); // --- ai-cut --- a proposal still on its way is dropped with the dialog
    };
  }, [source.blob]);

  // The preview frame at the scrub time (drawn after the seek lands; a newer request wins), once the seal is there.
  useEffect(() => {
    const canvas = canvasRef.current;
    const opened = videoRef.current;
    if (!canvas || !opened || durationSec === null || rendering || !seal) return;
    const token = ++drawToken.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tSec = Math.min(scrub, timeline.totalSec);
    void seekVideo(opened.video, sourceTimeAt(fitted, tSec))
      .catch(() => undefined)
      .then(() => {
        if (token !== drawToken.current) return;
        const { video } = opened;
        drawEditFrame(ctx, { image: video, width: video.videoWidth || canvas.width, height: video.videoHeight || canvas.height }, canvas.width, canvas.height, fitted, timeline, tSec, card, { seal, clipMs: tSec * 1000, fanMade });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, fitted.startSec, fitted.lengthSec, fitted.zoom, fitted.hook, fitted.url, fitted.cardSec, durationSec, rendering, card.title, card.note, fanMade, seal]);

  // --- ai-cut --- the user's own edits are what is remembered (not the cut the dialog opened on, not the AI's proposal;
  // --- cut-reedit --- nor a trim of a cut file, made on its neutral spec)
  const set = <K extends keyof ClipEditSpec>(key: K, value: ClipEditSpec[K]) => {
    const next = { ...specRef.current, [key]: value };
    specRef.current = next;
    if (!source.cutFile) saveClipEdit(next);
    setSpec(next);
  };

  // --- ai-cut --- the app's AI proposes a cut of the open source; it lands in the sliders and the preview, unsaved until edited
  const suggest = useCallback(async () => {
    const ask = desktop?.suggest;
    if (!ask || durationSec === null) return;
    const controller = new AbortController();
    suggestAbortRef.current?.abort();
    suggestAbortRef.current = controller;
    setRender((r) => (r.status === "error" ? { status: "idle" } : r)); // the one error slot shows the newest failure
    setSuggestion({ status: "running" });
    setLatest("suggest"); // --- clip-a11y --- the live region says this answer next
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
    setSuggestion((s) => (s.status === "error" ? { status: "idle" } : s)); // the one error slot shows the newest failure
    setLatest("render"); // --- clip-a11y --- the live region says this outcome next
    setRender({ status: "rendering", progress: { phase: "prepare", progress: 0, frame: 0, frames: 0 } });
    try {
      const result = await renderClipEdit({ source: source.blob, spec: fitted, card, fanMade, signal: controller.signal, onProgress: (progress) => setRender({ status: "rendering", progress }) });
      if (!result) return setRender({ status: "idle" });
      const name = editFileName(source.name, result.format.extension);
      let where: "downloaded" | "saved" = "downloaded";
      if (desktop) {
        // a cut file, as the queue names them (`<job>-cut`): the Library opens it as it is (no master of it there), and keeps what it was cut with
        const jobId = `edit-${Date.now().toString(36)}-cut`;
        const meta: LibraryMeta = { title: desktop.meta?.title ?? name, mode: desktop.meta?.mode ?? source.mode ?? "", seed: desktop.meta?.seed ?? source.seed ?? 0, link: desktop.meta?.link ?? "", platform: "tiktok", hook: fitted.hook, caption: desktop.meta?.caption ?? null, hashtags: desktop.meta?.hashtags ?? [], queueJobId: jobId, cut: result.spec };
        await desktop.bridge.render.save({ jobId, folder: "", name: name.replace(/\.[a-z0-9]+$/i, ""), extension: result.format.extension, data: await blobBytes(result.blob), durationSec: result.durationSec, transcode: null, meta });
        desktop.onSaved?.();
        where = "saved";
      } else downloadExport(result.blob, result.format.extension, name.replace(/\.[a-z0-9]+$/i, ""));
      offerPublishClip({ blob: result.blob, name, source: "edit", durationSec: result.durationSec, mode: source.mode ?? null, seed: source.seed ?? null, botClipId: source.botClipId ?? null, loopCaption: source.loopCaption ?? null });
      setRender({ status: "done", result, where });
    } catch (err) {
      setRender({ status: "error", message: failureText(err, t) });
    } finally {
      abortRef.current = null;
    }
  }, [source, fitted, card, fanMade, desktop, t]);

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
        <input type="range" min={range.min} max={top} step={range.step} value={fitted[key]} disabled={busy} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-accent" data-testid={`clip-edit-${key}`} />
      </label>
    );
  };

  const sec = (v: number) => t("seconds", { sec: v.toFixed(1) });
  const canRender = durationSec !== null && !openError && !rendering && !suggesting;
  // --- ai-cut --- the one error slot: a render that failed, else a proposal that did
  const errorMessage = render.status === "error" ? render.message : suggestion.status === "error" ? suggestion.message : null;
  // --- clip-a11y --- the live region's words while it renders: the phase and the progress in quarters, never every frame
  const live = render.status === "rendering" ? liveProgress(render.progress) : null;
  const progressText = !live ? "" : live.phase === "frames" ? t("framesLive", { percent: live.percent }) : t(`phase.${live.phase}`, { frame: 0, frames: 0, percent: live.percent });
  // the render's outcome and the AI's answer, shown in their lines below and said through the one live region
  const doneText = render.status === "done" ? `${t(render.where === "saved" ? "savedLibrary" : "downloaded", { sec: render.result.durationSec.toFixed(1), mb: (render.result.blob.size / 1048576).toFixed(1) })}${render.result.watermarked ? ` ${t("watermarked")}` : ""}` : "";
  // --- ai-cut --- a model may leave its summary out: the line then says the cut is set, never a bare "AI: "
  const suggestedText = suggestion.status !== "done" ? "" : suggestion.summary.trim() ? t("suggested", { summary: suggestion.summary.trim() }) : t("suggestedPlain");
  // --- clip-a11y --- the region stays mounted and only its words change (one inserted already filled is often not read): the
  // render's progress, the AI being asked, then the newest answer. The lines below carry no role, so nothing is read twice.
  const liveText = rendering ? progressText : suggesting ? t("suggesting") : latest === "suggest" ? suggestedText : doneText;
  const percent = render.status === "rendering" ? Math.round(render.progress.progress * 100) : 0;

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
              {failureText(openError.error, t)}
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
            <input type="text" value={spec.hook} maxLength={CLIP_EDIT_TEXT_MAX} disabled={busy} onChange={(e) => set("hook", e.target.value)} placeholder={t("hookPlaceholder")} className={`${inputClass} w-full`} data-testid="clip-edit-hook" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_IDEAS.map((idea) => (
              <button key={idea} type="button" disabled={busy} onClick={() => set("hook", t(`ideas.${idea}`))} className={`${btn} bg-surface-2 text-ink-2 hover:text-ink border border-line`}>
                {t(`ideas.${idea}`)}
              </button>
            ))}
          </div>
          <label className="block text-xs text-ink-2 space-y-1">
            <span>{t("url")}</span>
            <input type="text" value={spec.url} maxLength={CLIP_EDIT_TEXT_MAX} disabled={busy} onChange={(e) => set("url", e.target.value)} placeholder={DEFAULT_CLIP_EDIT.url} className={`${inputClass} w-full`} data-testid="clip-edit-url" />
          </label>

          {/* --- clip-a11y --- the bar is a progressbar and its line changes every few frames, so neither is live: the region
              below stays mounted and changes only with the phase or a quarter of the render */}
          {render.status === "rendering" && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-label={t("progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-testid="clip-edit-progress">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs text-ink-3 tabular-nums">{t(`phase.${render.progress.phase}`, { frame: render.progress.frame, frames: render.progress.frames, percent })}</p>
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite" data-testid="clip-edit-live">
            {liveText}
          </p>
          {render.status === "done" && (
            <p className="text-xs text-ink-2" data-testid="clip-edit-done">
              {doneText}
            </p>
          )}
          {suggestion.status === "done" && (
            <p className="text-xs text-ink-2" data-testid="clip-edit-suggested">
              {suggestedText}
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
            {/* --- ai-cut --- only in the Windows app, once the source is open: the local AI proposes the cut. --- clip-a11y --- While
                it is asked (or a render runs) the button is aria-disabled with no click, never natively disabled, which would drop
                a keyboard user's focus to the dialog */}
            {desktop?.suggest && durationSec !== null && (
              <button type="button" className={ghostBtn} aria-disabled={busy || undefined} aria-busy={suggesting} onClick={busy ? undefined : () => void suggest()} data-testid="clip-edit-suggest">
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
