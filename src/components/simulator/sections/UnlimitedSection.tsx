"use client";

import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, offBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface UnlimitedSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the block (added to SECTION_KEYS.ball in Controls.tsx). */
export const UNLIMITED_KEYS = ["unlimited", "fullBallLimit" /* --- unlimited-sizes --- */];

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
      <div className={`space-y-2 rounded-xl border p-3 ${on ? "border-warn/60 bg-warn/10" : "border-line-strong/60 bg-surface-1/40"}`} data-testid="unlimited-section">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-ink">
            {u("label")}
            <Tooltip text={u("tip")} />
          </label>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={on}
            data-testid="unlimited-toggle"
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${on ? "bg-warn text-accent-ink" : offBtn}`}
          >
            {on ? u("on") : u("off")}
          </button>
        </div>
        <p className={`text-xs ${on ? "text-warn" : "text-ink-2"}`}>{u("warning")}</p>
      </div>
    </Searchable>
  );
}

/** --- unlimited-sizes --- The full-physics balls a run with extreme values in play holds (the limits runtime's 2,000 by default; spawns past them join the crowd). */
export function FullBallLimitControl({ t, search, matches, settings: s, update }: UnlimitedSectionProps) {
  return (
    <div data-testid="full-ball-limit">
      <Slider t={t} search={search} matches={matches} labelKey="fullBallLimit" tipKey="fullBallLimitTip" value={s.fullBallLimit} range={RANGES.fullBallLimit} onChange={(v) => update({ fullBallLimit: v })} display={String(s.fullBallLimit)} />
    </div>
  );
}
