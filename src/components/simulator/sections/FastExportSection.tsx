"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, offBtn, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { FAST_EXPORT_FPS, FAST_EXPORT_RANGES, realtimeFactor, resolveFastExportFps, type FastExportPhase } from "@/lib/recording/fastRenderPlan";
import NumberField from "../NumberField"; // --- uncap-all ---
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

/** The "Fast export" button (or, while it runs, the progress bar with Cancel) and the line saying how it went. */
export function FastExportButton({ state, supported, disabled, handPlay = false, onStart, onCancel }: FastExportPanelProps) {
  const t = useTranslations("FastExport");
  const running = state.status === "running";
  let message: string | null = null;
  let tone = "text-zinc-400";
  if (handPlay && !running) {
    // Why the button is off – it outranks how the last export went.
    message = t("handPlayNote");
    tone = "text-amber-300";
  } else if (state.status === "done") {
    message = t("done", { seconds: one(state.durationSec), format: state.extension.toUpperCase(), wall: one(state.wallMs / 1000), speed: one(realtimeFactor(state.durationSec, state.wallMs)) });
    tone = "text-[#93d119]";
  } else if (state.status === "fallback") {
    message = t(state.reason === "webcodecs" ? "fallbackWebCodecs" : "fallbackCodecs");
    tone = "text-amber-300";
  } else if (state.status === "cancelled") message = t("cancelled");
  else if (state.status === "error") {
    message = t("error", { message: state.message });
    tone = "text-red-400";
  } else if (supported === false) {
    message = t("unsupportedNote");
    tone = "text-amber-300";
  }
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
      className="-mt-2 mb-4 space-y-2"
      data-fast-export={state.status}
      data-fast-digest={state.status === "done" ? state.digest : undefined}
      data-fast-bytes={state.status === "done" ? state.bytes : undefined}
      data-fast-hand-play={handPlay ? "1" : undefined}
    >
      {running ? (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>⚡ {label}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-zinc-900 overflow-hidden" role="progressbar" aria-label={t("progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-[#93d119] transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span className="tabular-nums">{speed > 0 ? t("speed", { speed: one(speed) }) : " "}</span>
            <button type="button" onClick={onCancel} className="px-2.5 py-1 rounded-md bg-zinc-700 text-zinc-200 hover:bg-zinc-600 text-xs font-medium cursor-pointer">
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onStart}
            disabled={disabled || handPlay}
            className="flex-1 px-4 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer border border-[#93d119]/60 text-[#93d119] bg-zinc-900/40 hover:bg-[#93d119]/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">⚡</span> {t("button")}
          </button>
          <Tooltip text={t("buttonTip")} />
        </div>
      )}
      {message && (
        <p className={`text-xs leading-snug ${tone}`} role="status">
          {message}
        </p>
      )}
    </div>
  );
}

/** The Recording section's frame-rate picker for the fast export (the real-time recorder always records the screen's rate). */
export function FastExportFpsControl({ t, search, matches, settings: s, update, disabled }: { t: Translate; search: string; matches: Matcher; settings: SimulatorSettings; update: (patch: Partial<SimulatorSettings>) => void; disabled?: boolean }) {
  const fps = resolveFastExportFps(s.fastExportFps);
  return (
    <Searchable search={search} matches={matches} labelKey="fastExportFps">
      <div className="space-y-2">
        <span className="text-sm font-medium text-zinc-300 flex items-center">
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
