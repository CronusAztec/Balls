"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { aspectRatioLabel } from "@/lib/siteDesign";
import { IconChevronDown } from "@/components/ui/icons";

/*
 * --- site-redesign --- The stage's top strip: the mode (a button that opens the mode picker), then mono readouts like a
 * hardware display – the run's seed, the elapsed time against the clip length, the export format and the frame rate. The
 * elapsed-time span is the page's own timer (Simulator.tsx writes into it every 100 ms), the first `.tabular-nums` of the
 * page as it always was.
 */
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
  const ratio = aspectRatioLabel(resolution);
  const readout = "flex shrink-0 items-baseline gap-2 whitespace-nowrap";
  return (
    <div className="flex h-11 shrink-0 items-center gap-5 overflow-x-auto border-b border-line px-3 sm:px-4 [@media(pointer:coarse)]:h-12" data-testid="stage-strip">
      <button type="button" onClick={onOpenModePicker} aria-haspopup="dialog" className="group -ml-1.5 flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-1.5 text-left hover:bg-surface-2 cursor-pointer [@media(pointer:coarse)]:h-11" title={t("studio.changeMode")}>
        <span className="eyebrow text-ink-3">{t("studio.mode")}</span>
        <span className="max-w-[12rem] truncate text-sm font-medium text-ink">{modeName}</span>
        <IconChevronDown size={16} className="text-ink-3 group-hover:text-ink-2" />
      </button>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      <span className={`${readout} hidden sm:flex`} title={seed?.pinned ? t("studio.seedPinned") : undefined}>
        <span className="eyebrow text-ink-3">{t("studio.seed")}</span>
        <span className="num text-sm text-ink-2">{seed ? seed.seed : "—"}</span>
        {seed?.pinned && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={t("studio.seedPinned")} />}
      </span>
      <span className={readout}>
        <span className="eyebrow text-ink-3">{t("studio.time")}</span>
        <span className="num text-sm text-ink">
          <span ref={timeLabelRef} className="tabular-nums">
            0.0s
          </span>
          <span className="text-ink-3"> / {clipSec}s</span>
        </span>
      </span>
      <span className={`${readout} hidden sm:flex`}>
        <span className="eyebrow text-ink-3">{t("studio.format")}</span>
        <span className="num text-sm text-ink-2">
          {resolution.replace("x", "×")}
          {ratio && <span className="text-ink-3"> · {ratio}</span>}
        </span>
      </span>
      <span className={`${readout} ml-auto hidden md:flex`}>
        {fpsReadout}
        <span className="eyebrow text-ink-3">{sim("fps")}</span>
      </span>
    </div>
  );
}
