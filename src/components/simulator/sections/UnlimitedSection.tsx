"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, offBtn, type Matcher, type Translate } from "../ControlPrimitives";
import type { SimulatorSettings } from "@/lib/settings";

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
 * --- unlimited --- The No limits switch of the Ball & Physics section, --- uncap-all --- now "Wide sliders": nothing is
 * capped whether it is on or off (every slider has a number field for any value, lib/uncap.ts); on, the sliders of the
 * uncapped settings get a logarithmic extension up to 1B. Turning it off changes no value – a value beyond a slider
 * stays as typed, the track pins at its end.
 */
export default function UnlimitedSection({ search, matches, settings: s, update }: UnlimitedSectionProps) {
  const u = useTranslations("Unlimited");
  const on = s.unlimited;
  const toggle = () => update({ unlimited: !on }); // --- uncap-all --- (the track only: no value is touched)
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
