"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { buttonClass } from "@/components/ui/Button"; // --- site-redesign ---
import { IconBolt } from "@/components/ui/icons"; // --- site-redesign ---
import { Searchable, offBtn, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { FAST_EXPORT_FPS, FAST_EXPORT_RANGES, realtimeFactor, resolveFastExportFps, type FastExportPhase } from "@/lib/recording/fastRenderPlan";
import NumberField from "../NumberField"; // --- uncap-all ---
import LockBadge from "@/components/billing/LockBadge"; // --- paywall-gate ---
import type { SimulatorSettings } from "@/lib/settings";

/*
 * --- fast-render --- The panel side of the fast export (lib/recording/fastRender.ts): the "Fast export" button under
 * Record Video with its progress bar, Cancel and the outcome line, and the frame-rate picker of the Recording section.
 */

/** Search keys of the Recording section's fast-export control (added to SECTION_KEYS.recording in Controls.tsx). */
export const FAST_EXPORT_KEYS = ["fastExportFps"];

/** Where a fast export stands, as the page tracks it (Simulator.tsx). */
export type FastExportState =
  | { status: "idle" }
  | { status: "running"; phase: FastExportPhase; progress: number; frame: number; frames: number; clipSec: number; elapsedMs: number }
  | { status: "done"; durationSec: number; wallMs: number; extension: string; bytes: number; digest: string }
  /** WebCodecs is missing ("webcodecs") or has no encoder the export can write ("codecs"): the real-time recorder took over. */
  | { status: "fallback"; reason: "webcodecs" | "codecs" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export interface FastExportPanelProps {
  state: FastExportState;
  /** Whether the browser has WebCodecs (null until known after mounting): without it the button records in real time. */
  supported: boolean | null;
  /** Record Video or Find Simulation is busy, or a project file is being opened. */
  disabled: boolean;
  /**
   * --- jdm-rhythm-runner --- The run is played by hand (a Beat Runner without Auto Jump, a Paddle Keep-Up without Auto
   * Platform): the export would render it without the player's input, so the button is off and says to use Record Video.
   */
  handPlay?: boolean;
  onStart: () => void;
  onCancel: () => void;
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** How the fast export went, or why its button is off – the line under the studio's transport bar (null: nothing to say). */
function fastExportMessage(t: ReturnType<typeof useTranslations>, { state, supported, handPlay = false }: Pick<FastExportPanelProps, "state" | "supported" | "handPlay">): { message: string; tone: string } | null {
  const running = state.status === "running";
  if (handPlay && !running) return { message: t("handPlayNote"), tone: "text-warn" }; // why the button is off – it outranks how the last export went
  if (state.status === "done")
    return { message: t("done", { seconds: one(state.durationSec), format: state.extension.toUpperCase(), wall: one(state.wallMs / 1000), speed: one(realtimeFactor(state.durationSec, state.wallMs)) }), tone: "text-accent" };
  if (state.status === "fallback") return { message: t(state.reason === "webcodecs" ? "fallbackWebCodecs" : "fallbackCodecs"), tone: "text-warn" };
  if (state.status === "cancelled") return { message: t("cancelled"), tone: "text-ink-2" };
  if (state.status === "error") return { message: t("error", { message: state.message }), tone: "text-danger" };
  if (supported === false) return { message: t("unsupportedNote"), tone: "text-warn" };
  return null;
}

/**
 * The "Fast export" button of the studio's transport bar – while it runs, a compact progress readout with Cancel in its
 * place. --- site-redesign --- the line saying how it went is FastExportStatus, under the transport bar.
 */
export function FastExportButton({ state, disabled, handPlay = false, onStart, onCancel, labelClassName }: FastExportPanelProps & { labelClassName?: string }) {
  const t = useTranslations("FastExport");
  const running = state.status === "running";
  const pct = running ? Math.round(100 * state.progress) : 0;
  const label = !running
    ? ""
    : state.phase === "frames"
      ? t("rendering", { frame: state.frame, frames: Math.max(state.frame, state.frames) })
      : state.phase === "audio"
        ? t("mixing")
        : state.phase === "finish"
          ? t("finishing")
          : t("preparing");
  const speed = running ? realtimeFactor(state.clipSec, state.elapsedMs) : 0;
  return (
    <div
      className="flex items-center"
      data-fast-export={state.status}
      data-fast-digest={state.status === "done" ? state.digest : undefined}
      data-fast-bytes={state.status === "done" ? state.bytes : undefined}
      data-fast-hand-play={handPlay ? "1" : undefined}
    >
      {running ? (
        <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-2 pl-2.5 pr-1" title={speed > 0 ? t("speed", { speed: one(speed) }) : undefined}>
          <IconBolt size={16} className="shrink-0 text-accent" />
          <span className="num max-w-[11rem] truncate text-xs text-ink-2">{label}</span>
          <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={t("progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <span className="num w-9 text-right text-xs text-ink">{pct}%</span>
          <button type="button" onClick={onCancel} className="h-6 rounded-[5px] px-2 text-xs font-medium text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer">
            {t("cancel")}
          </button>
        </div>
      ) : (
        <button type="button" onClick={onStart} disabled={disabled || handPlay} title={t("buttonTip")} className={buttonClass({ variant: "secondary", size: "sm" })}>
          <IconBolt size={16} />
          <span className={labelClassName}>{t("button")}</span>
          <LockBadge /* --- paywall-gate --- */ />
        </button>
      )}
    </div>
  );
}

/** --- site-redesign --- The fast export's outcome line (done, fallback, cancelled, error) or why it is off, under the transport bar. */
export function FastExportStatus(props: Pick<FastExportPanelProps, "state" | "supported" | "handPlay">) {
  const t = useTranslations("FastExport");
  const line = fastExportMessage(t, props);
  if (!line) return null;
  return (
    <p className={`text-xs leading-snug ${line.tone}`} role="status">
      {line.message}
    </p>
  );
}

/** The Recording section's frame-rate picker for the fast export (the real-time recorder always records the screen's rate). */
export function FastExportFpsControl({ t, search, matches, settings: s, update, disabled }: { t: Translate; search: string; matches: Matcher; settings: SimulatorSettings; update: (patch: Partial<SimulatorSettings>) => void; disabled?: boolean }) {
  const fps = resolveFastExportFps(s.fastExportFps);
  return (
    <Searchable search={search} matches={matches} labelKey="fastExportFps">
      <div className="space-y-2">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t("fastExportFps")}
          <Tooltip text={t("fastExportFpsTip")} />
        </span>
        <div className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-2 gap-2" role="group" aria-label={t("fastExportFps")}>
            {FAST_EXPORT_FPS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => update({ fastExportFps: value })}
                aria-pressed={fps === value}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${fps === value ? onBtn : offBtn}`}
              >
                {t(value === 30 ? "fastExportFps30" : "fastExportFps60")}
              </button>
            ))}
          </div>
          {/* --- uncap-all --- any other frame rate (from 30 up, 240, 1000…): typed */}
          <NumberField value={fps} onCommit={(v) => update({ fastExportFps: v })} label={t("fastExportFps")} range={FAST_EXPORT_RANGES.fastExportFps} rules={{ min: FAST_EXPORT_RANGES.fastExportFps.min }} disabled={disabled} settingKey="fastExportFps" />
        </div>
      </div>
    </Searchable>
  );
}
