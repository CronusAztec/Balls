"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { GAP_LAYOUTS, RING_ESCAPE_PRESET, RING_SPINS, type GapLayout, type RingSpin } from "@/lib/physics/ringEscape";

/*
 * --- ring-escape --- The Ring Escape controls of Classic (lib/physics/ringEscape.ts), in the Wall section (Classic only): the
 * "Rainbow spiral, 11 rings" preset, the gap layout (even, random, aligned, spiral) with the spiral's step, the rings' spin
 * (alternate, together), the rainbow by ring, the time-in-ring line and the ring sounds. The layout, the step and the spin are
 * physics (Simulator.tsx sends them in the physics config: the rings are laid out anew and a found seed is dropped); the rest
 * follows live. Labels and tips under `Controls`.
 */

export interface RingEscapeSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.wall; panelKeys.ts offers them in Classic only). */
export const RING_ESCAPE_KEYS = ["reSpiralPreset", "gapLayout", "gapSpiralStep", "ringSpin", "ringRainbow", "ringTimer", "ringSound"];

const LAYOUT_LABELS: Record<GapLayout, string> = { even: "gapLayoutEven", random: "gapLayoutRandom", aligned: "gapLayoutAligned", spiral: "gapLayoutSpiral" };
const SPIN_LABELS: Record<RingSpin, string> = { alternate: "ringSpinAlternate", together: "ringSpinTogether" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

export default function RingEscapeSection({ t, search, matches, settings: s, update }: RingEscapeSectionProps) {
  const all = !!search;
  return (
    <div className="space-y-3 pt-2" data-testid="ring-escape-section" data-re-layout={s.gapLayout} data-re-spin={s.ringSpin} data-re-rainbow={s.ringRainbow ? "1" : "0"} data-re-timer={s.ringTimer ? "1" : "0"} data-re-sound={s.ringSound ? "1" : "0"}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("reDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="reSpiralPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("reSpiralPreset")}
            <Tooltip text={t("reSpiralPresetTip")} />
          </span>
          <button type="button" onClick={() => update({ ...RING_ESCAPE_PRESET, backgroundColors: [...RING_ESCAPE_PRESET.backgroundColors] })} className={`w-full ${pick(false)}`} data-re-preset="rainbowSpiral">
            {t("reSpiralPresetButton")}
          </button>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="gapLayout">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("gapLayout")}
            <Tooltip text={t("gapLayoutTip")} />
          </label>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("gapLayout")}>
            {GAP_LAYOUTS.map((layout) => (
              <button type="button" key={layout} onClick={() => update({ gapLayout: layout })} aria-pressed={s.gapLayout === layout} className={pick(s.gapLayout === layout)} data-re-layout-option={layout}>
                {t(LAYOUT_LABELS[layout])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {(s.gapLayout === "spiral" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="gapSpiralStep" tipKey="gapSpiralStepTip" value={s.gapSpiralStep} range={RANGES.gapSpiralStep} onChange={(v) => update({ gapSpiralStep: v })} display={`${s.gapSpiralStep}°`} />
      )}
      <Searchable search={search} matches={matches} labelKey="ringSpin">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("ringSpin")}
            <Tooltip text={t("ringSpinTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("ringSpin")}>
            {RING_SPINS.map((spin) => (
              <button type="button" key={spin} onClick={() => update({ ringSpin: spin })} aria-pressed={s.ringSpin === spin} className={pick(s.ringSpin === spin)} data-re-spin-option={spin}>
                {t(SPIN_LABELS[spin])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ringRainbow">
        <Toggle t={t} labelKey="ringRainbow" tipKey="ringRainbowTip" value={s.ringRainbow} onChange={(v) => update({ ringRainbow: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ringTimer">
        <Toggle t={t} labelKey="ringTimer" tipKey="ringTimerTip" value={s.ringTimer} onChange={(v) => update({ ringTimer: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ringSound">
        <Toggle t={t} labelKey="ringSound" tipKey="ringSoundTip" value={s.ringSound} onChange={(v) => update({ ringSound: v })} />
      </Searchable>
    </div>
  );
}
