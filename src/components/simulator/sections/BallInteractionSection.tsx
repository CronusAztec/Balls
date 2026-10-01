"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { BALL_INTERACTIONS, type BallInteraction } from "@/lib/physics/types";

export interface BallInteractionSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx). */
export const BALL_INTERACTION_KEYS = ["ballInteraction", "splitMinRadius", "maxBalls"];

const OPTIONS: Record<BallInteraction, { labelKey: string; descKey: string }> = {
  bounce: { labelKey: "interactionBounce", descKey: "interactionBounceDesc" },
  merge: { labelKey: "interactionMerge", descKey: "interactionMergeDesc" },
  split: { labelKey: "interactionSplit", descKey: "interactionSplitDesc" },
  pass: { labelKey: "interactionPass", descKey: "interactionPassDesc" },
};

/**
 * "Ball Interaction" block of the Ball & Physics section: bounce / merge / split / pass plus the split
 * limits (smallest half, ball cap). The values live in SimulatorSettings and reach the engine through its
 * config (see lib/physics/interactions.ts). The split sliders are still rendered while the settings search
 * is in use, so the search box finds them whatever the current interaction is.
 */
export default function BallInteractionSection({ t, search, matches, settings: s, update }: BallInteractionSectionProps) {
  const showSplitLimits = s.ballInteraction === "split" || !!search;
  return (
    <>
      <Searchable search={search} matches={matches} labelKey="ballInteraction">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("ballInteraction")}
            <Tooltip text={t("ballInteractionTip")} />
          </label>
          {/* --- review fix (ui-i18n) --- a wrapping row (not 4 fixed columns): longer labels (pl "Przenikanie") are never clipped */}
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("ballInteraction")}>
            {BALL_INTERACTIONS.map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => update({ ballInteraction: mode })}
                aria-pressed={s.ballInteraction === mode}
                className={`flex-auto whitespace-nowrap px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.ballInteraction === mode ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              >
                {t(OPTIONS[mode].labelKey)}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-3 leading-relaxed">{t(OPTIONS[s.ballInteraction].descKey)}</p>
        </div>
      </Searchable>
      {showSplitLimits && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="splitMinRadius" tipKey="splitMinRadiusTip" value={s.splitMinRadius} range={RANGES.splitMinRadius} onChange={(v) => update({ splitMinRadius: v })} display={`${s.splitMinRadius}px`} />
          <Slider t={t} search={search} matches={matches} labelKey="maxBalls" tipKey="maxBallsTip" value={s.maxBalls} range={RANGES.maxBalls} onChange={(v) => update({ maxBalls: v })} display={String(s.maxBalls)} />
        </>
      )}
    </>
  );
}
