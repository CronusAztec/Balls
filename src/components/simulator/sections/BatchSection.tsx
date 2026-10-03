"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Toggle, offBtn, onBtn, selectClass, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import { BATCH_COUNT_RANGE, MAX_BATCH_JOBS, SWEEP_KEYS, SWEEP_STEPS_LIMIT, SWEEP_STEPS_RANGE, formatElapsed, isSweepKey, sweepDefaults, sweepRange, sweepValues, type BatchSource, type BatchVariantKind } from "@/lib/recording/batch";
import { MODE_CARD_ORDER } from "@/lib/modes";
import type { ModeId } from "@/lib/physics/types";
import type { BatchJobState, BatchPanelProps } from "../useBatchRender";
import { IconDownload } from "@/components/ui/icons"; // --- site-redesign ---
import UncapNumberField, { type NumberFieldProps } from "../NumberField"; // --- uncap-all --- (--- review fix (uncap-all) --- the sweep's fields too)
import { rulesForRange } from "../unlimitedSlider";
import LockBadge from "@/components/billing/LockBadge"; // --- paywall-gate ---

export type { BatchPanelProps } from "../useBatchRender";

/*
 * --- batch-render --- The "Batch" block of the Recording section: N random seeds or a pasted list of seeds and share
 * links, optional variants (every mode, or a setting swept from A to B in K steps), "Render batch", the queue with each
 * clip's status, progress and time, "Stop after this clip" and, at the end, "Download all as ZIP". The run itself is
 * components/simulator/useBatchRender.ts; the pure parts lib/recording/batch.ts and lib/recording/zip.ts.
 */

/** Search keys of the block (added to SECTION_KEYS.recording in Controls.tsx; labels in the Controls namespace). */
export const BATCH_KEYS = ["batchRender"];

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** The mode's name from the Controls namespace (`modeClassic`, `modeColorMatch`…), its id when there is none. */
function modeLabel(t: Translate, mode: ModeId): string {
  const key = `mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  return t.has(key) ? t(key) : mode;
}

/**
 * --- review fix (uncap-all) --- A labelled number field of the sweep: the shared field (any value past the slider; ↑/↓ step
 * on beyond it instead of stopping at the slider's end, as the browser's own number input did).
 */
function SweepField({ label, ...field }: { label: string } & Omit<NumberFieldProps, "label" | "className">) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-2">
      {label}
      <UncapNumberField {...field} label={label} className="w-full" />
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={`grid gap-2 ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={value === o.id} className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${value === o.id ? onBtn : offBtn}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function JobRow({ job, index, current, progress, t, b, onDownload }: { job: BatchJobState; index: number; current: boolean; progress: number | null; t: Translate; b: Translate; onDownload: (id: number) => void }) {
  const mode = job.mode ?? (job.variant.kind === "mode" ? job.variant.mode : null);
  const parts = [mode ? modeLabel(t, mode) : null, b("jobSeed", { seed: job.seed }), job.variant.kind === "sweep" ? `${b(`sweep.${job.variant.key}`)} ${job.variant.value}` : null, job.link ? `${b("jobLink")}` : null].filter(Boolean);
  const pct = current && progress !== null ? Math.round(100 * progress) : null;
  let status: string;
  let tone = "text-ink-3";
  if (job.status === "done") {
    status = `${b("done", { seconds: one(job.durationSec ?? 0), time: formatElapsed(job.wallMs ?? 0) })}`;
    tone = "text-accent";
  } else if (job.status === "rendering") {
    status = pct !== null ? `${pct}%` : b("preparing");
    tone = "text-ink";
  } else if (job.status === "failed") {
    const e = job.error;
    const reason = e === "link" ? b("errorLink") : e === "code" ? b("errorCode") : e === "busy" ? b("errorBusy") : e === "unsupported" ? b("errorUnsupported") : e === "handPlay" ? b("errorHandPlay") /* --- jdm-rhythm-runner --- */ : e ? b("errorOther", { message: e.message }) : "";
    status = `${b("failed")}${reason ? ` – ${reason}` : ""}`;
    tone = "text-danger";
  } else status = b(job.status);
  return (
    <li className={`rounded-lg px-2.5 py-2 text-xs ${current ? "bg-surface-2 border border-accent/40" : "bg-surface-2/50 border border-transparent"}`} data-batch-job={job.status} data-batch-file={job.fileName ?? undefined} data-batch-seed={job.seed}>
      <div className="flex items-center gap-2">
        <span className="text-ink-3 tabular-nums w-5 shrink-0">{index + 1}.</span>
        <span className="flex-1 min-w-0 truncate text-ink" title={job.link ?? undefined}>
          {parts.join(" · ")}
        </span>
        {job.status === "done" && (
          <button type="button" onClick={() => onDownload(job.id)} aria-label={b("downloadJob", { name: job.fileName ?? "" })} title={job.fileName ?? undefined} className="shrink-0 px-1.5 py-0.5 rounded-md text-ink-2 hover:text-ink hover:bg-surface-3 cursor-pointer">
            <IconDownload size={14} />
          </button>
        )}
      </div>
      <div className={`mt-1 pl-7 tabular-nums ${tone}`}>{status}</div>
      {pct !== null && (
        <div className="mt-1.5 ml-7 h-1.5 rounded-full bg-surface-1 overflow-hidden" role="progressbar" aria-label={b("progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}

export default function BatchSection({ t, search, matches, batch }: { t: Translate; search: string; matches: Matcher; batch: BatchPanelProps }) {
  const b = useTranslations("BatchRender");
  const { definition: d, onDefinitionChange: set, list, run } = batch;
  const busy = run.status === "running" || run.status === "stopping";
  const done = run.jobs.filter((j) => j.status === "done").length;
  const currentIndex = run.jobs.findIndex((j) => j.status === "preparing" || j.status === "rendering");
  const sweep = sweepRange(d.sweepKey);
  const values = d.variant === "sweep" ? sweepValues(d.sweepKey, d.sweepFrom, d.sweepTo, d.sweepSteps) : [];
  const picked = MODE_CARD_ORDER.filter((m) => d.modes.includes(m));
  const elapsed = run.startedAt !== null && run.finishedAt !== null ? formatElapsed(run.finishedAt - run.startedAt) : "";
  const canStart = !busy && !batch.disabled && batch.jobCount > 0 && batch.supported !== false;

  return (
    <Searchable search={search} matches={matches} labelKey="batchRender">
      <div className="space-y-3 border-t border-line pt-3" data-batch={run.status} data-batch-done={done} data-batch-total={run.jobs.length}>
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t("batchRender")}
          <Tooltip text={t("batchRenderTip")} />
        </span>

        {!busy && (
          <div className="space-y-3">
            <Choice<BatchSource>
              label={b("seeds")}
              value={d.source}
              onChange={(source) => set({ source })}
              options={[
                { id: "random", label: b("sourceRandom") },
                { id: "list", label: b("sourceList") },
              ]}
            />
            {d.source === "random" ? (
              <div className="space-y-1.5">
                <label className="text-xs text-ink-2 flex items-center justify-between" htmlFor="batch-count">
                  <span>{b("count")}</span>
                  <span className="text-ink-3 tabular-nums">{b("countValue", { count: d.count })}</span>
                </label>
                <input
                  id="batch-count"
                  type="range"
                  min={BATCH_COUNT_RANGE.min}
                  max={BATCH_COUNT_RANGE.max}
                  step={BATCH_COUNT_RANGE.step}
                  value={d.count}
                  onChange={(e) => set({ count: Number(e.target.value) })}
                  className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer"
                  style={sliderStyle(d.count, BATCH_COUNT_RANGE.min, BATCH_COUNT_RANGE.max)}
                  aria-label={b("count")}
                />
                <UncapNumberField value={d.count} onCommit={(v) => set({ count: v })} label={b("count")} range={BATCH_COUNT_RANGE} rules={{ min: BATCH_COUNT_RANGE.min, integer: true }} settingKey="batchCount" /* --- uncap-all --- */ />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs text-ink-2 flex items-center" htmlFor="batch-list">
                  {b("listLabel")}
                  <Tooltip text={b("listHint")} />
                </label>
                <textarea
                  id="batch-list"
                  value={d.list}
                  onChange={(e) => set({ list: e.target.value })}
                  placeholder={b("listPlaceholder")}
                  rows={4}
                  spellCheck={false}
                  className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-xs font-mono leading-relaxed resize-y"
                />
                <p className="text-xs text-ink-3 leading-snug" data-batch-list={list.entries.length}>
                  {b("listRead", { count: list.entries.length })}
                  {list.invalidLines.length > 0 && <span className="text-warn"> · {b("listSkipped", { count: list.invalidLines.length, lines: list.invalidLines.slice(0, 8).join(", ") + (list.invalidLines.length > 8 ? "…" : "") })}</span>}
                </p>
              </div>
            )}

            <Choice<BatchVariantKind>
              label={b("variants")}
              value={d.variant}
              onChange={(variant) => set({ variant })}
              options={[
                { id: "none", label: b("variantNone") },
                { id: "modes", label: b("variantModes") },
                { id: "sweep", label: b("variantSweep") },
              ]}
            />
            {d.variant === "modes" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-ink-3">
                  <span>{b("modesPicked", { count: picked.length, total: MODE_CARD_ORDER.length })}</span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => set({ modes: [...MODE_CARD_ORDER] })} className="px-2 py-0.5 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer">
                      {b("modesAll")}
                    </button>
                    <button type="button" onClick={() => set({ modes: [] })} className="px-2 py-0.5 rounded-md bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer">
                      {b("modesClear")}
                    </button>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={b("variantModes")}>
                  {MODE_CARD_ORDER.map((mode) => {
                    const on = d.modes.includes(mode);
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set({ modes: on ? d.modes.filter((m) => m !== mode) : [...d.modes, mode] })}
                        className={`px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${on ? onBtn : offBtn}`}
                      >
                        {modeLabel(t, mode)}
                      </button>
                    );
                  })}
                </div>
                {picked.length === 0 && <p className="text-xs text-warn">{b("modesEmpty")}</p>}
              </div>
            )}
            {d.variant === "sweep" && (
              <div className="space-y-2">
                <label className="text-xs text-ink-2 flex flex-col gap-1" htmlFor="batch-sweep-key">
                  {b("sweepSetting")}
                  <select id="batch-sweep-key" value={d.sweepKey} onChange={(e) => isSweepKey(e.target.value) && set({ sweepKey: e.target.value, ...sweepDefaults(e.target.value) })} className={`${selectClass} text-sm`}>
                    {SWEEP_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {b(`sweep.${key}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {/* --- uncap-all --- the sweep's ends past the slider (no max; a signed setting below its slider too), its steps up to the batch's clip ceiling */}
                  <SweepField key={`from-${d.sweepKey}`} label={b("sweepFrom")} value={d.sweepFrom} range={sweep} rules={rulesForRange(sweep, d.sweepKey)} settingKey="batchSweepFrom" onCommit={(v) => set({ sweepFrom: v })} />
                  <SweepField key={`to-${d.sweepKey}`} label={b("sweepTo")} value={d.sweepTo} range={sweep} rules={rulesForRange(sweep, d.sweepKey)} settingKey="batchSweepTo" onCommit={(v) => set({ sweepTo: v })} />
                  <SweepField label={b("sweepSteps")} value={d.sweepSteps} range={SWEEP_STEPS_RANGE} rules={{ min: SWEEP_STEPS_LIMIT.min, integer: true }} settingKey="batchSweepSteps" onCommit={(v) => set({ sweepSteps: Math.min(SWEEP_STEPS_LIMIT.max, v) })} />
                </div>
                <p className="text-xs text-ink-3 tabular-nums" data-batch-sweep={values.join(",")}>
                  {b("sweepValues", { values: values.join(" · ") })}
                </p>
              </div>
            )}

            <Toggle t={t} labelKey="batchDownloadEach" tipKey="batchDownloadEachTip" value={d.downloadEach} onChange={(downloadEach) => set({ downloadEach })} caseStyle="title" />

            <p className="text-xs text-ink-2 leading-snug">
              {batch.exportFormat.durationSec === null /* --- review fix (recording-export) --- (a short link's clip length is known once its job runs) */
                ? b("summaryPerJob", { count: batch.jobCount, resolution: batch.exportFormat.resolution.replace("x", "×"), fps: batch.exportFormat.fps })
                : b("summary", { count: batch.jobCount, resolution: batch.exportFormat.resolution.replace("x", "×"), fps: batch.exportFormat.fps, seconds: batch.exportFormat.durationSec })}
            </p>
            {batch.truncated && <p className="text-xs text-warn leading-snug">{b("truncated", { max: MAX_BATCH_JOBS })}</p>}
            <button
              type="button"
              onClick={batch.onStart}
              disabled={!canStart}
              className="w-full px-4 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer border border-accent/60 text-accent bg-surface-1/40 hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {b("start")}
              <LockBadge /* --- paywall-gate --- */ />
            </button>
            {batch.supported === false && <p className="text-xs text-warn leading-snug">{b("unsupported")}</p>}
          </div>
        )}

        {run.jobs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs" role="status">
              <span className={run.status === "finished" ? "text-accent" : run.status === "stopped" ? "text-warn" : "text-ink-2"}>
                {run.status === "running"
                  ? b("statusRunning", { current: Math.max(1, currentIndex + 1), total: run.jobs.length })
                  : run.status === "stopping"
                    ? b("statusStopping")
                    : run.status === "finished"
                      ? b("statusFinished", { done, total: run.jobs.length, time: elapsed })
                      : b("statusStopped", { done, total: run.jobs.length, time: elapsed })}
              </span>
              {run.status === "running" && (
                <span className="flex items-center shrink-0">
                  <button type="button" onClick={batch.onStop} className="px-2.5 py-1 rounded-md bg-surface-3 text-ink hover:bg-surface-3 text-xs font-medium cursor-pointer">
                    {b("stop")}
                  </button>
                  <Tooltip text={b("stopTip")} />
                </span>
              )}
            </div>
            <ol className="space-y-1 max-h-72 overflow-y-auto pr-1 custom-scrollbar" aria-label={b("queueLabel")}>
              {run.jobs.map((job, i) => (
                <JobRow key={job.id} job={job} index={i} current={i === currentIndex} progress={batch.jobProgress} t={t} b={b} onDownload={batch.onDownloadJob} />
              ))}
            </ol>
            {!busy && (
              <div className="flex items-center gap-2">
                {done > 0 && (
                  <button
                    type="button"
                    onClick={batch.onDownloadAll}
                    disabled={batch.zipping}
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-50 disabled:cursor-wait"
                  >
                    {batch.zipping ? b("zipping") : `${b("downloadAll")}`}
                  </button>
                )}
                <button type="button" onClick={batch.onClear} className="px-3 py-2 rounded-lg text-xs font-medium cursor-pointer bg-surface-2 text-ink-2 hover:bg-surface-3">
                  {b("clear")}
                </button>
              </div>
            )}
            {batch.zipFailed && <p className="text-xs text-danger leading-snug">{b("zipFailed")}</p>}
            {run.interrupted && !busy && (
              <p className="text-xs text-warn leading-snug" data-batch-interrupted="true">
                {b("settingsChanged")}
              </p>
            ) /* --- review fix (recording-export) --- */}
          </div>
        )}
      </div>
    </Searchable>
  );
}
