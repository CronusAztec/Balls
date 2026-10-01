"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { DesktopApi, VideoCodec } from "@/lib/desktop/contract";
import { VIDEO_CODECS } from "@/lib/desktop/contract";
import { OUTPUT_PRESETS, QUEUE_FPS, QUEUE_RESOLUTIONS, type OutputPreset } from "@/lib/desktop/presets";
import { expandBatch, queueSummary, type BatchClipSource, type QueueJob } from "@/lib/desktop/renderQueue";
import { planSource, seedSource } from "@/lib/desktop/queueSources";
import { linkJobSettings, parseBatchList, randomSeeds, resolveLinkSettings } from "@/lib/recording/batch";
import { loadBotState } from "@/lib/bot/store";
import { SITE_NAME } from "@/lib/site";
import type { RenderQueueApi } from "./useRenderQueue";
import type { DesktopPageHooks } from "./pageHooks";
import { Bar, Card, Chip, dangerBtn, errorText, formatBytes, formatSeconds, ghostBtn, inputClass, primaryBtn } from "./ui";

/*
 * --- desktop-exe --- The Render queue panel: build a batch – the page's setup with a list of seeds (or share links, or N
 * random seeds), or the viral bot's last plan – times the resolutions, frame rates, codecs and output presets picked, and
 * work through it on the GPU into the output folder: per job its progress, Cancel, Retry, order; Start / Pause, Cancel all,
 * Retry failed, Clear finished; after a crash or restart the queue offers to resume.
 */

type SourceKind = "seeds" | "random" | "bot";

export default function QueuePanel({ bridge, queue, page, folder, onFolder }: { bridge: DesktopApi; queue: RenderQueueApi; page: DesktopPageHooks; folder: string; onFolder: (folder: string) => void }) {
  const t = useTranslations("Desktop");
  const [source, setSource] = useState<SourceKind>("seeds");
  const [list, setList] = useState("");
  const [count, setCount] = useState(3);
  const [resolutions, setResolutions] = useState<string[]>([page.settings.recordingResolution]);
  const [fps, setFps] = useState<(30 | 60)[]>([60]);
  const [codecs, setCodecs] = useState<VideoCodec[]>(["h264"]);
  const [presets, setPresets] = useState<OutputPreset[]>(["native"]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const parsed = useMemo(() => parseBatchList(list), [list]);
  const summary = queueSummary(queue.state);
  const toggle = <T,>(values: T[], value: T, set: (v: T[]) => void) => set(values.includes(value) ? (values.length > 1 ? values.filter((v) => v !== value) : values) : [...values, value]);

  const add = async () => {
    setAdding(true);
    setMessage(null);
    try {
      const clips: BatchClipSource[] = [];
      if (source === "bot") {
        const plan = loadBotState().plan;
        if (!plan || plan.clips.length === 0) throw new Error(t("queueNoBotPlan"));
        clips.push(...plan.clips.map(planSource));
      } else if (source === "random") {
        for (const seed of randomSeeds(count)) clips.push(seedSource(page.settings, seed));
      } else {
        if (parsed.entries.length === 0) clips.push(seedSource(page.settings, page.pageSeed()));
        for (const entry of parsed.entries) {
          if (entry.link) {
            const r = await resolveLinkSettings(entry.link);
            if (!r.ok) continue;
            const settings = linkJobSettings(r.settings, page.settings);
            clips.push(seedSource(settings, entry.seed ?? randomSeeds(1)[0], { kind: "link", link: entry.link }));
          } else clips.push(seedSource(page.settings, entry.seed ?? randomSeeds(1)[0]));
        }
      }
      const specs = expandBatch(clips, { resolutions, fps, codecs, presets });
      const added = queue.add(specs);
      setMessage(t("queueAdded", { count: added }));
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setAdding(false);
    }
  };

  const statusText = (job: QueueJob) => t(`status.${job.status}`);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" data-testid="desktop-queue" data-queue-count={queue.state.jobs.length} data-queue-running={queue.state.running ? "true" : "false"}>
      <div className="xl:col-span-2 space-y-4">
        <Card title={t("queueAddTitle")}>
          <div className="flex gap-2 flex-wrap">
            {(["seeds", "random", "bot"] as const).map((k) => (
              <Chip key={k} on={source === k} onClick={() => setSource(k)} testId={`queue-source-${k}`}>
                {t(`queueSource.${k}`)}
              </Chip>
            ))}
          </div>
          {source === "seeds" && (
            <>
              <textarea className={`${inputClass} w-full h-20 font-mono`} value={list} onChange={(e) => setList(e.target.value)} placeholder={t("queueListPlaceholder")} aria-label={t("queueListLabel")} data-testid="queue-list" />
              <p className="text-[11px] text-zinc-500">
                {parsed.entries.length ? t("queueListCount", { count: parsed.entries.length }) : t("queueListEmpty")}
                {parsed.invalidLines.length > 0 && <span className="text-amber-400"> · {t("queueListInvalid", { lines: parsed.invalidLines.join(", ") })}</span>}
              </p>
            </>
          )}
          {source === "random" && (
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              {t("queueRandomCount")}
              <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))))} className={`${inputClass} w-20`} />
            </label>
          )}
          {source === "bot" && <p className="text-[11px] text-zinc-500">{t("queueBotHint")}</p>}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t("queueResolutions")}</p>
            <div className="flex gap-2 flex-wrap">
              {QUEUE_RESOLUTIONS.map((r) => (
                <Chip key={r} on={resolutions.includes(r)} onClick={() => toggle(resolutions, r, setResolutions)}>
                  {r}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t("queueFps")}</p>
            <div className="flex gap-2 flex-wrap">
              {QUEUE_FPS.map((f) => (
                <Chip key={f} on={fps.includes(f)} onClick={() => toggle(fps, f, setFps)}>
                  {f} fps
                </Chip>
              ))}
            </div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t("queueCodecs")}</p>
            <div className="flex gap-2 flex-wrap">
              {VIDEO_CODECS.map((c) => (
                <Chip key={c} on={codecs.includes(c)} onClick={() => toggle(codecs, c, setCodecs)}>
                  {t(`codec.${c}`)}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{t("queuePresets")}</p>
            <div className="flex gap-2 flex-wrap">
              {OUTPUT_PRESETS.map((p) => (
                <Chip key={p} on={presets.includes(p)} onClick={() => toggle(presets, p, setPresets)} testId={`queue-preset-${p}`}>
                  {t(`preset.${p}`)}
                </Chip>
              ))}
            </div>
          </div>
          <button type="button" className={`${primaryBtn} w-full`} disabled={adding} onClick={() => void add()} data-testid="queue-add">
            {adding ? "…" : t("queueAdd")}
          </button>
          {message && <p className="text-xs text-zinc-300" data-testid="queue-message">{message}</p>}
        </Card>
        <Card title={t("queueFolderTitle")}>
          <p className="text-xs text-zinc-400 break-all" data-testid="queue-folder">{folder || t("queueFolderDefault", { siteName: SITE_NAME }) /* --- review fix (docs-consistency) --- */}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={ghostBtn}
              onClick={() =>
                void bridge.dialogs.pickFolder().then((f) => {
                  if (f) onFolder(f);
                })
              }
            >
              {t("queueFolderPick")}
            </button>
            <button type="button" className={ghostBtn} onClick={() => void bridge.library.openFolder()}>
              {t("queueFolderOpen")}
            </button>
          </div>
        </Card>
      </div>
      <div className="xl:col-span-3">
        <Card
          title={t("queueTitle", { done: summary.done, total: summary.total })}
          testId="queue-jobs"
          actions={
            <>
              {queue.state.running ? (
                <button type="button" className={ghostBtn} onClick={queue.pause} data-testid="queue-pause">
                  {t("queuePause")}
                </button>
              ) : (
                <button type="button" className={primaryBtn} disabled={summary.queued === 0} onClick={queue.start} data-testid="queue-start">
                  {t("queueStart")}
                </button>
              )}
              <button type="button" className={ghostBtn} disabled={summary.failed === 0} onClick={queue.retryAllFailed}>
                {t("queueRetryFailed")}
              </button>
              <button type="button" className={ghostBtn} onClick={queue.clearDone}>
                {t("queueClearFinished")}
              </button>
              <button type="button" className={dangerBtn} disabled={summary.queued + summary.active === 0} onClick={queue.cancelAll}>
                {t("queueCancelAll")}
              </button>
            </>
          }
        >
          {queue.resumable !== null && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-cyan-950/40 border border-cyan-800/50 text-xs" data-testid="queue-resume">
              <span className="flex-1 text-cyan-200">{t("queueResume", { count: queue.resumable })}</span>
              <button type="button" className={primaryBtn} onClick={queue.start}>
                {t("queueResumeButton")}
              </button>
              <button type="button" className={ghostBtn} onClick={queue.dismissResume}>
                {t("queueResumeLater")}
              </button>
            </div>
          )}
          {summary.total > 0 && <Bar value={summary.progress} />}
          {queue.state.jobs.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">{t("queueEmpty")}</p>
          ) : (
            <ul className="divide-y divide-zinc-800 max-h-[28rem] overflow-y-auto pr-1">
              {queue.state.jobs.map((job) => (
                <li key={job.id} className="py-2 space-y-1" data-queue-job={job.name} data-queue-status={job.status}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-zinc-200 truncate flex-1" title={job.name}>
                      {job.name}
                    </span>
                    <span className="text-zinc-500 whitespace-nowrap">
                      {job.preset === "native" ? `${job.resolution} · ${job.fps}` : t(`preset.${job.preset}`)} · {job.codec.toUpperCase()}
                    </span>
                    <span className={`whitespace-nowrap ${job.status === "failed" ? "text-red-400" : job.status === "done" ? "text-[#93d119]" : "text-zinc-400"}`}>{statusText(job)}</span>
                  </div>
                  {(job.status === "rendering" || job.status === "encoding") && <Bar value={job.progress} tone={job.status === "encoding" ? "cyan" : "lime"} />}
                  {job.error && <p className="text-[11px] text-red-400 break-words">{job.error}</p>}
                  {job.resumed && job.status === "queued" && <p className="text-[11px] text-cyan-300">{t("queueResumedJob")}</p>}
                  {job.output && (
                    <p className="text-[11px] text-zinc-500 truncate" title={job.output.path}>
                      {formatBytes(job.output.bytes)} · {formatSeconds(job.output.durationSec)}
                      {job.output.encoder ? ` · ${job.output.encoder}` : ""} · {job.output.path}
                    </p>
                  )}
                  <div className="flex gap-1.5">
                    {(job.status === "queued" || job.status === "rendering" || job.status === "encoding") && (
                      <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => queue.cancel(job.id)}>
                        {t("jobCancel")}
                      </button>
                    )}
                    {(job.status === "failed" || job.status === "cancelled") && (
                      <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => queue.retry(job.id)} data-testid="job-retry">
                        {t("jobRetry")}
                      </button>
                    )}
                    {job.status === "queued" && (
                      <>
                        <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => queue.move(job.id, -1)} aria-label={t("jobUp")}>
                          ↑
                        </button>
                        <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => queue.move(job.id, 1)} aria-label={t("jobDown")}>
                          ↓
                        </button>
                      </>
                    )}
                    {job.status !== "rendering" && job.status !== "encoding" && (
                      <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => queue.remove(job.id)}>
                        {t("jobRemove")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {page.busy && queue.state.running && <p className="text-[11px] text-amber-400">{t("queueWaitingForPage")}</p>}
        </Card>
      </div>
    </div>
  );
}
