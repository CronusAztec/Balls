"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/Button";
import WatermarkBadge from "@/components/billing/WatermarkBadge";
import { IconBolt, IconCheck, IconLink, IconRestart } from "@/components/ui/icons";

/*
 * --- run-end --- What to do next once a run is over, under the stage's transport bar: in the page, never on the canvas, so
 * it is never recorded and nothing covers or dims the canvas's own end banner. The run's length, Export this run (the fast
 * export builds this very run again from its start), Copy link to this run (the link carries the run's seed) and, while the
 * run is pinned (a found, shared or planned run), New run, which lets the pin go and plays another. Restart Simulation stays
 * in the transport bar, where Start and Pause were.
 */
export default function RunEndCard({
  seconds,
  pinned,
  exportDisabled,
  onExport,
  onCopyLink,
  onNewRun,
}: {
  /** The run's length (s). */
  seconds: number;
  /** The run's seed is pinned: Restart plays it again, New run plays another. */
  pinned: boolean;
  exportDisabled: boolean;
  onExport: () => void;
  onCopyLink: () => void;
  onNewRun: () => void;
}) {
  const t = useTranslations("Simulator");
  // (on a phone the card may come up under the fold or the tab bar: the page scrolls just enough to show it, once)
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.getBoundingClientRect().bottom <= window.innerHeight - 64) return;
    el.scrollIntoView({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);
  return (
    <div ref={ref} className="flex scroll-mb-[calc(var(--studio-rail-h,0px)+12px)] flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface-1 px-3 py-2.5 sm:px-4" data-testid="run-end">
      <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink" role="status">
        <IconCheck size={16} className="shrink-0 text-ok" />
        <span className="num">{t("runOver", { seconds: seconds.toFixed(1) })}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
        <Button variant="primary" size="sm" onClick={onExport} disabled={exportDisabled} icon={<IconBolt size={16} />}>
          {t("exportThisRun")}
          <WatermarkBadge compact tone="inherit" /* --- free-watermark --- (the clip carries the watermark on Free; the filled button's own ink) */ />
        </Button>
        <Button variant="secondary" size="sm" onClick={onCopyLink} icon={<IconLink size={16} />}>
          {t("copyRunLink")}
        </Button>
        {pinned && (
          <Button variant="ghost" size="sm" onClick={onNewRun} title={t("newRunTip")} icon={<IconRestart size={16} />}>
            {t("newRun")}
          </Button>
        )}
      </div>
    </div>
  );
}
