"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { OPEN_SETTING_EVENT, aspectRatioLabel, modeNeighbours } from "@/lib/siteDesign";
import { rememberRecentMode } from "@/lib/modeRecent";
import type { ModeId } from "@/lib/physics/types";
import { IconChevronDown, IconChevronLeft, IconChevronRight } from "@/components/ui/icons";

/*
 * --- site-redesign --- The stage's top strip: the mode (a button that opens the mode picker), then mono readouts like a
 * hardware display – the run's seed, the elapsed time against the clip length, the export format and the frame rate. The
 * elapsed-time span is the page's own timer (Simulator.tsx writes into it every 100 ms), the first `.tabular-nums` of the
 * page as it always was.
 * --- studio-fit --- Two small arrows after the mode button step to the previous and the next mode in the wall's order
 * (the event a mode card sends; each arrow is named after the mode it leads to). The time and the format are buttons too:
 * each opens its setting in Recording (OPEN_SETTING_EVENT, answered by the panel with the palette's jump). The panel hands
 * the current mode in through StageModeContext, so the page needs no new prop.
 * --- frame-guide --- A toggle after the format shows what the clip records on the stage: the centred square the recorder
 * and the fast export keep (lib/recording/recorder.ts drawRecordingFrame), the rest of the stage dimmed. It marks the studio
 * (data-frame-guide) and globals.css draws the guide over the stage frame: a page overlay, never on the canvas, so never
 * recorded. The choice is a per-visitor convenience kept in this browser (read after mounting, never needed).
 */

const FRAME_GUIDE_KEY = "jumpingballslive_frame_guide";

/** The studio's current mode, provided by the panel (Controls.tsx) around the stage; null leaves the arrows out. */
export const StageModeContext = createContext<ModeId | null>(null);
export default function StageStrip({
  modeName,
  onOpenModePicker,
  getSeed,
  timeLabelRef,
  clipSec,
  resolution,
  fpsReadout,
}: {
  modeName: string;
  onOpenModePicker: () => void;
  /** The current run's seed and whether it is pinned (a found, shared or daily run). */
  getSeed: () => { seed: number; pinned: boolean } | null;
  timeLabelRef: RefObject<HTMLSpanElement | null>;
  clipSec: number;
  resolution: string;
  /** The FPS number (Simulator's FpsReadout: it re-renders only itself, twice a second). */
  fpsReadout: ReactNode;
}) {
  const t = useTranslations("SiteRedesign");
  const sim = useTranslations("Simulator");
  const modes = useTranslations("Modes"); // --- studio-fit ---
  const controls = useTranslations("Controls"); // --- studio-fit --- (the settings' names: Duration, Resolution)
  const mode = useContext(StageModeContext);
  const near = mode ? modeNeighbours(mode) : null;
  const [seed, setSeed] = useState<{ seed: number; pinned: boolean } | null>(null);
  useEffect(() => {
    const read = () =>
      setSeed((prev) => {
        const next = getSeed();
        return prev && next && prev.seed === next.seed && prev.pinned === next.pinned ? prev : next;
      });
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [getSeed]);
  // --- frame-guide ---
  const stripRef = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(FRAME_GUIDE_KEY) === "on") setGuide(true);
    } catch {
      /* no storage: the guide starts off */
    }
  }, []);
  useEffect(() => {
    const studio = stripRef.current?.closest(".studio");
    if (!studio) return;
    studio.toggleAttribute("data-frame-guide", guide);
    return () => studio.removeAttribute("data-frame-guide");
  }, [guide]);
  const toggleGuide = () => {
    const next = !guide;
    setGuide(next);
    try {
      localStorage.setItem(FRAME_GUIDE_KEY, next ? "on" : "off");
    } catch {
      /* not kept: it still applies on this page */
    }
  };
  const ratio = aspectRatioLabel(resolution);
  const readout = "flex shrink-0 items-baseline gap-2 whitespace-nowrap";
  // --- studio-fit --- a readout that opens its setting: the same line, in a button with a hover plate
  const readoutButton = "-mx-1.5 h-8 shrink-0 items-center rounded-md px-1.5 hover:bg-surface-2 cursor-pointer [@media(pointer:coarse)]:h-11";
  const arrow = "inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink cursor-pointer [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-9";
  const step = (to: ModeId) => {
    if (mode) rememberRecentMode(to, mode);
    window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: to }));
  };
  const openSetting = (key: "videoDuration" | "videoResolution") => window.dispatchEvent(new CustomEvent(OPEN_SETTING_EVENT, { detail: key }));
  return (
    <div ref={stripRef} className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-b border-line px-3 sm:gap-5 sm:px-4 [@media(pointer:coarse)]:h-12" data-testid="stage-strip">
      {/* --- studio-fit --- the mode button stays the strip's first button (the picker's way in), the arrows follow it */}
      {/* --- review fix (studio-fit) --- a long mode name gives way (it ends in an ellipsis, its title the whole name): the
          readouts after it keep their width, the clip length and the format are never pushed off the strip */}
      <div className="-ml-1.5 flex min-w-0 shrink items-center gap-0.5">
        <button type="button" onClick={onOpenModePicker} aria-haspopup="dialog" className="group flex h-8 min-w-0 shrink items-center gap-2 rounded-md px-1.5 text-left hover:bg-surface-2 cursor-pointer [@media(pointer:coarse)]:h-11" title={t("studio.changeMode")}>
          <span className="eyebrow shrink-0 text-ink-3 max-sm:hidden">{t("studio.mode")}</span>
          <span className="min-w-0 max-w-[9rem] truncate text-sm font-medium text-ink sm:max-w-[12rem]" title={modeName}>{modeName}</span>
          <IconChevronDown size={16} className="shrink-0 text-ink-3 group-hover:text-ink-2" />
        </button>
        {near && (
          <>
            <button type="button" onClick={() => step(near.prev)} aria-label={modes(`${near.prev}.name`)} title={modes(`${near.prev}.name`)} className={arrow} data-testid="stage-mode-prev">
              <IconChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => step(near.next)} aria-label={modes(`${near.next}.name`)} title={modes(`${near.next}.name`)} className={arrow} data-testid="stage-mode-next">
              <IconChevronRight size={16} />
            </button>
          </>
        )}
      </div>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      {/* --- studio-fit --- the seed, the format and the frame rate show where the stage column has room for them (container
          queries: the stage is narrower beside the desk column and the labelled rail), so the time is never cut */}
      <span className={`${readout} hidden @[46rem]:flex`} title={seed?.pinned ? t("studio.seedPinned") : undefined}>
        <span className="eyebrow text-ink-3">{t("studio.seed")}</span>
        <span className="num text-sm text-ink-2">{seed ? seed.seed : "—"}</span>
        {seed?.pinned && <span role="img" className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={t("studio.seedPinned")} />}
      </span>
      <button type="button" onClick={() => openSetting("videoDuration")} title={controls("videoDuration")} className={`${readoutButton} flex`} data-testid="stage-time">
        <span className={readout}>
          <span className="eyebrow text-ink-3">{t("studio.time")}</span>
          <span className="num text-sm text-ink">
            <span ref={timeLabelRef} className="tabular-nums">
              0.0s
            </span>
            <span className="text-ink-3"> / {clipSec}s</span>
          </span>
        </span>
      </button>
      <button type="button" onClick={() => openSetting("videoResolution")} title={controls("videoResolution")} className={`${readoutButton} hidden @[38rem]:flex`} data-testid="stage-format">
        <span className={readout}>
          <span className="eyebrow text-ink-3">{t("studio.format")}</span>
          <span className="num text-sm text-ink-2">
            {resolution.replace("x", "×")}
            {ratio && <span className="text-ink-3"> · {ratio}</span>}
          </span>
        </span>
      </button>
      {/* --- frame-guide --- the guide's toggle, right after the format it shows */}
      <button type="button" onClick={toggleGuide} aria-pressed={guide} aria-label={t("studio.frameGuide")} title={t("studio.frameGuide")} className={`-ml-2 hidden h-8 w-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink cursor-pointer sm:-ml-4 @[38rem]:inline-flex [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-9 ${guide ? "bg-surface-2 text-accent" : "text-ink-3"}`} data-testid="stage-frame-guide">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
          <rect x="7" y="7" width="6" height="6" rx="1" />
        </svg>
      </button>
      <span className={`${readout} ml-auto hidden @[50rem]:flex`}>
        {fpsReadout}
        <span className="eyebrow text-ink-3">{sim("fps")}</span>
      </span>
    </div>
  );
}
