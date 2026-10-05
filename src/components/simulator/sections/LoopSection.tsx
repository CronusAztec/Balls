"use client";

import { useId } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import type { SimulatorSettings } from "@/lib/settings";
import { LOOP_HUD_TEXT_MAX } from "@/lib/loop/loopSettings";

/*
 * --- loop-foundation --- The Recording section's loop controls: "Export whole loops" (a looping run – Grow's fill and loop – is
 * recorded, fast-exported and batch-rendered as a whole number of its cycles, so the clip loops without a seam) and the loop HUD
 * (a bold lowercase title, a grey subtitle and one amber counter drawn into the frame; empty fields use the mode's own words).
 */

export interface LoopSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.recording in Controls.tsx). */
export const LOOP_KEYS = ["exportWholeLoops", "loopHud", "loopHudTitle", "loopHudSubtitle"];

export default function LoopSection({ t, search, matches, settings: s, update }: LoopSectionProps) {
  const titleId = useId();
  const subtitleId = useId();
  return (
    <div className="space-y-3" data-testid="loop-section" data-whole-loops={s.exportWholeLoops ? "1" : "0"} data-loop-hud={s.loopHud ? "1" : "0"}>
      <Searchable search={search} matches={matches} labelKey="exportWholeLoops">
        <Toggle t={t} labelKey="exportWholeLoops" tipKey="exportWholeLoopsTip" value={s.exportWholeLoops} onChange={(v) => update({ exportWholeLoops: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="loopHud">
        <Toggle t={t} labelKey="loopHud" tipKey="loopHudTip" value={s.loopHud} onChange={(v) => update({ loopHud: v })} />
      </Searchable>
      {(s.loopHud || !!search) &&
        ([
          ["loopHudTitle", titleId, s.loopHudTitle, (v: string) => update({ loopHudTitle: v })],
          ["loopHudSubtitle", subtitleId, s.loopHudSubtitle, (v: string) => update({ loopHudSubtitle: v })],
        ] as const).map(([key, id, value, set]) => (
          <Searchable key={key} search={search} matches={matches} labelKey={key}>
            <div className="space-y-1.5">
              <label htmlFor={id} className="text-sm font-medium text-ink-2 flex items-center">
                {t(key)}
                <Tooltip text={t(`${key}Tip`)} />
              </label>
              <input
                id={id}
                type="text"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={t("loopHudPlaceholder")}
                maxLength={LOOP_HUD_TEXT_MAX}
                className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
                data-testid={key}
              />
            </div>
          </Searchable>
        ))}
    </div>
  );
}
