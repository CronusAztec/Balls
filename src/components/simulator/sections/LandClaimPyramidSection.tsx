"use client";

import { useMemo } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { LC_LAYOUTS, LCP_BLOCK_CEILING, lcPyramidBallsAfter, lcPyramidClipSec, lcPyramidHeights, lcPyramidNaturalTotal, lcPyramidTotal, type LcLayout } from "@/lib/physics/landClaimPyramid";

/*
 * --- land-claim-pyramid --- The pyramid layout's block of the Land Claim controls (LandClaimSection.tsx renders it under the
 * presets): the layout (the arena's wall or a pyramid), and for the pyramid its size, its steps, its blocks in all, Rebuild and
 * loop and the rebuild's length – with a line saying what the run holds (the blocks, the balls the summit's fall leaves). Labels
 * under `Controls` (lcLayout…, lcp…) in every messages file; the values live in SimulatorSettings (lcLayout, lcPyramidSize,
 * lcSteps, lcBlocks, lcRebuild, lcRebuildSec) and Simulator.tsx restarts the run when one changes.
 */

/** Search keys of the controls rendered here (LandClaimSection adds them to its own, so the search box and the palette find them). */
export const LAND_CLAIM_PYRAMID_KEYS = ["lcLayout", "lcPyramidSize", "lcSteps", "lcBlocks", "lcRebuild", "lcRebuildSec"];

const LAYOUT_OPTIONS: Record<LcLayout, { icon: string; labelKey: string }> = {
  wall: { icon: "▦", labelKey: "lcLayoutWall" },
  pyramid: { icon: "◭", labelKey: "lcLayoutPyramid" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

export interface LandClaimPyramidSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

export default function LandClaimPyramidSection({ t, search, matches, settings: s, update }: LandClaimPyramidSectionProps) {
  const pyramid = s.lcLayout === "pyramid";
  const natural = lcPyramidNaturalTotal(s.lcPyramidSize, s.lcSteps);
  // The run's numbers: its blocks and its tallest column (a grid past a few hundred columns is counted by its formula, not built).
  const { built, tallest } = useMemo(() => {
    if (!pyramid || s.lcPyramidSize > 400) return { built: s.lcBlocks > 0 ? Math.min(s.lcBlocks, LCP_BLOCK_CEILING) : Math.min(natural, LCP_BLOCK_CEILING), tallest: 0 };
    const heights = lcPyramidHeights(s.lcPyramidSize, s.lcSteps, s.lcBlocks);
    let top = 0;
    for (let k = 0; k < heights.length; k++) if (heights[k] > top) top = heights[k];
    return { built: lcPyramidTotal(heights), tallest: top };
  }, [pyramid, s.lcPyramidSize, s.lcSteps, s.lcBlocks, natural]);
  const balls = lcPyramidBallsAfter(Math.max(1, s.lcTeams) * Math.max(1, s.lcBalls), built, s.lcEvery);
  return (
    <div className="space-y-3" data-testid="land-claim-pyramid-section" data-layout={s.lcLayout}>
      <Searchable search={search} matches={matches} labelKey="lcLayout">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("lcLayout")}
            <Tooltip text={t("lcLayoutTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("lcLayout")} data-testid="lc-layout">
            {LC_LAYOUTS.map((layout) => (
              <button type="button" key={layout} onClick={() => update({ lcLayout: layout })} aria-pressed={s.lcLayout === layout} className={pick(s.lcLayout === layout)} data-layout={layout}>
                <span aria-hidden="true">{LAYOUT_OPTIONS[layout].icon}</span> {t(LAYOUT_OPTIONS[layout].labelKey)}
              </button>
            ))}
          </div>
          {!search && pyramid && <p className="text-xs text-ink-3 leading-relaxed">{t("lcpDesc")}</p>}
        </div>
      </Searchable>
      {pyramid && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="lcPyramidSize" tipKey="lcPyramidSizeTip" value={s.lcPyramidSize} range={RANGES.lcPyramidSize} onChange={(v) => update({ lcPyramidSize: v })} display={t("lcpGrid", { n: s.lcPyramidSize })} />
          <Slider t={t} search={search} matches={matches} labelKey="lcSteps" tipKey="lcStepsTip" value={s.lcSteps} range={RANGES.lcSteps} onChange={(v) => update({ lcSteps: v })} display={String(s.lcSteps)} />
          <Slider
            t={t}
            search={search}
            matches={matches}
            labelKey="lcBlocks"
            tipKey="lcBlocksTip"
            value={s.lcBlocks}
            range={RANGES.lcBlocks}
            onChange={(v) => update({ lcBlocks: v })}
            display={s.lcBlocks > 0 ? t("lcpBlocksN", { count: s.lcBlocks }) : t("lcpBlocksNatural", { count: natural })}
          />
          {!search && (
            <p className="text-xs text-ink-3 leading-relaxed" data-testid="lcp-summary" data-total={built} data-balls={balls} data-tallest={tallest}>
              {t("lcpSummary", { blocks: built, tallest, balls })}
            </p>
          )}
          <Searchable search={search} matches={matches} labelKey="lcRebuild">
            <Toggle
              t={t}
              labelKey="lcRebuild"
              tipKey="lcRebuildTip"
              value={s.lcRebuild}
              // the clip covers a whole cycle when the loop turns on (the knock-down at its longest, the hold, the rebuild)
              onChange={(v) => update(v ? { lcRebuild: true, recordingDuration: lcPyramidClipSec(s.lcDuration, s.lcRebuildSec) } : { lcRebuild: false })}
            />
          </Searchable>
          {s.lcRebuild && <Slider t={t} search={search} matches={matches} labelKey="lcRebuildSec" tipKey="lcRebuildSecTip" value={s.lcRebuildSec} range={RANGES.lcRebuildSec} onChange={(v) => update({ lcRebuildSec: v })} display={`${s.lcRebuildSec.toFixed(1)}s`} />}
          {!search && <p className="text-xs text-ink-3 leading-relaxed" data-testid="lcp-loop-note">{s.lcRebuild ? t("lcpLoopNote") : t("lcpEndNote")}</p>}
        </>
      )}
    </div>
  );
}
