"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import { btn, ghostBtn, inputClass, primaryBtn } from "@/components/simulator/desktop/ui";
import type { DesktopApi, LibraryMeta } from "@/lib/desktop/contract";
import { blobBytes } from "@/lib/desktop/bridge";
import { downloadExport } from "@/lib/recording/fastRender";
import { offerPublishClip, type PublishClipLibrary } from "@/lib/publish/clips";
import type { LoopCaptionContext } from "@/lib/publish/loopCaption"; // --- low-findings ---
import { sealWatermark, type WatermarkSeal } from "@/lib/watermark/seal";
import { drawEditFrame, fanMadeLine } from "@/lib/clipEdit/draw";
import { composeCutSpec, cutFileTrim, editCutJobId } from "@/lib/clipEdit/propose"; // --- cut-reedit ---
import { clipEditErrorKey, liveProgress, openSourceVideo, renderClipEdit, seekVideo, type ClipEditProgress, type ClipEditResult } from "@/lib/clipEdit/render";
import { editorGenes, genesOfCut } from "@/lib/insights/genes"; // --- insights ---
import { CLIP_EDIT_OUTPUT, CLIP_EDIT_RANGES, CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT, clipEditTrack, clipTimeline, editFileName, fitClipEdit, loadClipEdit, localClipEdit, parseClipEdit, saveClipEdit, sourceTimeAt, type ClipEditNumberKey, type ClipEditSpec } from "@/lib/clipEdit/spec";
import { SliderTrack } from "@/components/simulator/ControlPrimitives"; // --- review fix (unlimited-sizes) --- (the wide tracks)
import NumberField from "@/components/simulator/NumberField"; // --- review fix (unlimited-sizes) --- (any start, length, crop-in or card)

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
 * --- cut-reedit --- A cut file opened as it is (`source.cutFile`: a Library cut with no master there, a Publish clip that is a
 * cut) already shows its look: the dialog only trims it (start and length, cutFileTrim; the crop-in, hook, address and card
 * controls are left out and a line says why), so its save as a cut of its master (composeCutSpec) is the video it shows, and
 * its own fan-made badge stays the one badge. The dialog remembers none of the edits made on it (its spec is the neutral one,
 * no address included, which must not become the look of the user's next cut). A cut of a Library item is saved under that
 * item's job (`<job>-cut`), so the Library and the autopilot know it for the same video.
 *
 * --- cut-cancel --- Cancel stops the render. Once the file is made it is being saved, so the button says so and does nothing.
 */

export interface ClipEditorSource {
  blob: Blob;
  name: string;
  mode?: string | null;
  seed?: number | null;
  /** --- low-findings --- A Publish clip's viral bot clip id and "Loop style" words: the cut keeps the source's copy and run. */
  botClipId?: string | null;
  loopCaption?: LoopCaptionContext | null;
  /** --- cut-reedit --- The file is a cut with its look burned in (lib/clipEdit/propose.ts `libraryEditOpen`, a Publish clip's `cutFile`). */
  cutFile?: boolean;
  /**
   * --- badge-safe --- The file's frames are known to carry the fan-made badge (a clip the page made, a Library item's
   * `fanMadeBurned`). Absent, a Fight League cut draws the badge on every frame.
   */
  fanMadeBurned?: boolean;
}

export interface ClipEditorDesktop {
  bridge: DesktopApi;
  /** The Library item the source is: its job and copy, and for a cut file the `cut` it was cut from its master with. */
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
  const [saving, setSaving] = useState(false); // --- cut-cancel --- the file is made and being saved: Cancel can no longer stop it
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<{ video: HTMLVideoElement; release: () => void } | null>(null);
  // the preview's seal: state, so a seal that comes after the video (a licence renewal still in flight) draws the frame then
  const [seal, setSeal] = useState<WatermarkSeal | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const drawToken = useRef(0);

  const cutFile = source.cutFile === true;
  // --- cut-reedit --- a cut file is only trimmed, whatever the spec holds: its look is in its frames already
  const own = cutFile ? cutFileTrim(spec) : spec;
  const fitted = durationSec ? fitClipEdit(own, durationSec) : own;
  const timeline = clipTimeline(fitted, CLIP_EDIT_OUTPUT.fps);
  const card = useMemo(() => ({ title: t("cardTitle"), note: t("cardNote") }), [t]);
  // --- legal-audit --- a Fight League source's cut carries the fan-made badge again, in the preview and in the file, where the
  // source's own is cut away or covered (--- badge-once --- draw.ts decides frame by frame; a cut file's own counts only uncropped;
  // --- badge-safe --- a file not known to carry one gets it on every frame)
  const fanMade = fanMadeLine(source.mode, fl("canvasFanMade"));
  const fanMadeBurned = source.fanMadeBurned === true; // --- badge-safe ---
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
        drawEditFrame(ctx, { image: video, width: video.videoWidth || canvas.width, height: video.videoHeight || canvas.height }, canvas.width, canvas.height, fitted, timeline, tSec, card, { seal, clipMs: tSec * 1000, fanMade, cutFile, fanMadeBurned });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, fitted.startSec, fitted.lengthSec, fitted.zoom, fitted.hook, fitted.url, fitted.cardSec, durationSec, rendering, card.title, card.note, fanMade, cutFile, fanMadeBurned, seal]);

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
      const result = await renderClipEdit({ source: source.blob, spec: fitted, card, fanMade, cutFile, fanMadeBurned, signal: controller.signal, onProgress: (progress) => setRender({ status: "rendering", progress }) });
      // --- cut-cancel --- a Cancel that came while the file was finished: nothing is saved, downloaded or offered
      if (!result || controller.signal.aborted) return setRender({ status: "idle" });
      setSaving(true);
      const name = editFileName(source.name, result.format.extension);
      let where: "downloaded" | "saved" = "downloaded";
      let library: PublishClipLibrary | null = null;
      if (desktop) {
        // a cut file, as the queue names them (`<job>-cut`): a Library item's cut under its job, so the Library opens that
        // master again and the autopilot takes them for one video; any other source's as its own (opened as it is)
        const jobId = `edit-${Date.now().toString(36)}-cut`;
        // --- cut-reedit --- a trim of a cut file is measured on that file: saved as a cut of the master (the cut file's own
        // spec moved by the trim, its look kept), or with no spec when that is not known, so the Library opens the master's own
        const parentCut = cutFile ? desktop.meta?.cut : undefined;
        const cut = !cutFile ? result.spec : parentCut ? composeCutSpec(parentCut, result.spec) : undefined;
        const hook = cut ? cut.hook : fitted.hook;
        const caption = desktop.meta?.caption ?? null;
        const hashtags = desktop.meta?.hashtags ?? [];
        // --- insights --- a cut of a clip with genes keeps them as a cut (its length, its hook); any other cut is the editor's
        const genes = desktop.meta?.genes ? genesOfCut(desktop.meta.genes, { durationSec: result.durationSec, hook, sameHook: hook.trim() === (desktop.meta.hook ?? "").trim() }) : editorGenes({ mode: desktop.meta?.mode ?? source.mode ?? null, durationSec: result.durationSec, copy: { hook, caption, hashtags } });
        const meta: LibraryMeta = { title: desktop.meta?.title ?? name, mode: desktop.meta?.mode ?? source.mode ?? "", seed: desktop.meta?.seed ?? source.seed ?? 0, link: desktop.meta?.link ?? "", platform: "tiktok", hook, caption, hashtags, queueJobId: editCutJobId(desktop.meta?.queueJobId), ...(cut ? { cut } : {}), ...(fanMade ? { fanMadeBurned: true } : {}) /* --- badge-safe --- a Fight League cut carries the badge, drawn or kept */, genes };
        await desktop.bridge.render.save({ jobId, folder: "", name: name.replace(/\.[a-z0-9]+$/i, ""), extension: result.format.extension, data: await blobBytes(result.blob), durationSec: result.durationSec, transcode: null, meta });
        desktop.onSaved?.();
        where = "saved";
        // --- cut-reedit --- the Publish clip is that Library item: a cut of it in the block stays under the same job
        library = { title: meta.title, link: meta.link, caption: meta.caption, hashtags: meta.hashtags, queueJobId: meta.queueJobId, cut: meta.cut };
      } else downloadExport(result.blob, result.format.extension, name.replace(/\.[a-z0-9]+$/i, ""));
      offerPublishClip({ blob: result.blob, name, source: "edit", durationSec: result.durationSec, mode: source.mode ?? null, seed: source.seed ?? null, botClipId: source.botClipId ?? null, loopCaption: source.loopCaption ?? null, library });
      setRender({ status: "done", result, where });
    } catch (err) {
      setRender({ status: "error", message: failureText(err, t) });
    } finally {
      abortRef.current = null;
      setSaving(false);
    }
  }, [source, fitted, card, fanMade, cutFile, fanMadeBurned, desktop, t]);

  const number = (key: ClipEditNumberKey, label: string, format: (v: number) => string, sourceTop?: number) => {
    // --- review fix (unlimited-sizes) --- the comfort range, then the wide track: to the source's own end for the start and the
    // length (the track only: a typed length past the file is cut at its end), to a cut's longest file for the card, on for the
    // crop-in; the number field takes any value from the spec's floor up (parseClipEdit())
    const { range, top } = clipEditTrack(key, sourceTop);
    return (
      <div className="block text-xs text-ink-2 space-y-1">
        <span className="flex justify-between">
          <span>{label}</span>
          <span className="tabular-nums text-ink">{format(fitted[key])}</span>
        </span>
        <div className="flex items-center gap-2">
          {/* --- clip-a11y --- the name is the label alone (it does not change on every step) and the value is said as it is shown */}
          <SliderTrack settingKey={`clipEdit:${key}`} label={label} value={fitted[key]} range={range} top={top} onChange={(v) => set(key, v)} disabled={busy} valueText={format(fitted[key])} className="flex-1 min-w-0 accent-accent" testId={`clip-edit-${key}`} />
          <NumberField value={fitted[key]} onCommit={(v) => set(key, v)} label={label} range={range} rules={{ min: CLIP_EDIT_RANGES[key].min }} disabled={busy} settingKey={`clipEdit:${key}`} className="w-16" testId={`clip-edit-${key}-value`} />
        </div>
      </div>
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
          <input type="range" min={0} max={timeline.totalSec} step={1 / CLIP_EDIT_OUTPUT.fps} value={Math.min(scrub, timeline.totalSec)} disabled={rendering || durationSec === null} onChange={(e) => setScrub(Number(e.target.value))} className="w-full accent-accent" aria-label={t("scrub")} aria-valuetext={sec(Math.min(scrub, timeline.totalSec))} data-testid="clip-edit-scrub" />
          <p className="text-xs text-ink-3 text-center tabular-nums">
            {sec(Math.min(scrub, timeline.totalSec))} / {sec(timeline.totalSec)}
            {durationSec !== null && <span> · {t("sourceLength", { sec: durationSec.toFixed(1) })}</span>}
          </p>
        </div>

        <div className="space-y-3 min-w-0">
          <p className="text-xs text-ink-3 leading-snug" data-testid="clip-edit-intro">
            {cutFile ? t("cutFileNote") : t("intro")}
          </p>
          {openError && (
            <p className="text-xs text-danger" role="alert">
              {failureText(openError.error, t)}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* (the source's own end is the start's and the length's track top, never a cap on the value) */}
            {number("startSec", t("start"), sec, durationSec ? Math.max(0, durationSec - 1) : undefined)}
            {number("lengthSec", t("length"), sec, durationSec ? Math.max(CLIP_EDIT_RANGES.lengthSec.min, durationSec - fitted.startSec) : undefined)}
            {/* --- cut-reedit --- a cut file shows its crop-in and card already: only its start and length are set here */}
            {!cutFile && number("zoom", t("zoom"), (v) => `${Math.round((v - 1) * 100)} %`)}
            {!cutFile && number("cardSec", t("card"), sec)}
          </div>
          {!cutFile && (
            <>
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
            </>
          )}

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
            {/* --- cut-cancel --- the same button while the file is saved (a keyboard user keeps the focus), aria-disabled, no click */}
            {rendering ? (
              <button type="button" className={ghostBtn} aria-disabled={saving || undefined} onClick={saving ? undefined : () => abortRef.current?.abort()} data-testid="clip-edit-cancel">
                {saving ? t("saving") : t("cancel")}
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
