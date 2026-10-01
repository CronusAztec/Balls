"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, offBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, unlimitedSettingKeys, type SimulatorSettings } from "@/lib/settings";
import { clampUnlimitedPatch } from "@/lib/unlimited";

export interface UnlimitedSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the block (added to SECTION_KEYS.ball in Controls.tsx). */
export const UNLIMITED_KEYS = ["unlimited"];

/**
 * --- unlimited --- The No limits switch of the Ball & Physics section (lib/unlimited.ts): on, every numeric setting goes
 * past its slider range (logarithmic up to 1B, a number input for anything else) – the run may melt, the tab never
 * crashes. Off again, every value past its range comes back to the range's end, so nothing extreme lingers.
 */
export default function UnlimitedSection({ search, matches, settings: s, update }: UnlimitedSectionProps) {
  const u = useTranslations("Unlimited");
  const on = s.unlimited;
  const toggle = () => {
    if (on) update({ unlimited: false, ...(clampUnlimitedPatch(s as unknown as Record<string, unknown>, unlimitedSettingKeys(), RANGES as unknown as Record<string, { min: number; max: number; step: number }>) as Partial<SimulatorSettings>) });
    else update({ unlimited: true });
  };
  return (
    <Searchable search={search} matches={matches} labelKey="unlimited">
      <div className={`space-y-2 rounded-xl border p-3 ${on ? "border-amber-500/60 bg-amber-500/10" : "border-zinc-700/60 bg-zinc-900/40"}`} data-testid="unlimited-section">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-zinc-200">
            ♾️ {u("label")}
            <Tooltip text={u("tip")} />
          </label>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={on}
            data-testid="unlimited-toggle"
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${on ? "bg-amber-400 text-slate-950" : offBtn}`}
          >
            {on ? u("on") : u("off")}
          </button>
        </div>
        <p className={`text-xs ${on ? "text-amber-300" : "text-zinc-400"}`}>⚠️ {u("warning")}</p>
      </div>
    </Searchable>
  );
}
