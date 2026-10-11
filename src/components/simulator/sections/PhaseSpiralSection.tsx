"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { PHASE_SPIRAL_PRESET, POLY_PALETTES, effectiveArms, orbitLayout, type PolyPalette } from "@/lib/physics/phaseSpiral";

/*
 * --- phase-spiral --- The Phase Spiral controls of Metronomes & Polyrhythms (lib/physics/phaseSpiral.ts), rendered at the end of
 * PolyrhythmSection: the "20 rings × 3 arms" preset, the arms (rings and spiral layouts), the in-line meter, the comet tails,
 * the loop sounds and the palette. Everything applies live (Simulator.tsx forwards it to the mode; a new arm count builds the
 * dots again and the rhythm carries on).
 */

export interface PhaseSpiralSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (part of POLYRHYTHM_KEYS, so the search box and the command palette find them). */
export const PHASE_SPIRAL_KEYS = ["prSpiralPreset", "prArms", "prAlignMeter", "prTrail", "prLoopSound", "prPalette"];

const PALETTE_LABELS: Record<PolyPalette, string> = { rainbow: "prPaletteRainbow", spiral: "prPaletteSpiral" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

export default function PhaseSpiralSection({ t, search, matches, settings: s, update }: PhaseSpiralSectionProps) {
  const all = !!search;
  const orbit = orbitLayout(s.prLayout);
  const arms = effectiveArms(s.prLayout, s.prArms, s.prTempos === "custom" ? 1 : s.prCount);
  return (
    <div className="space-y-3 border-t border-line pt-3" data-testid="phase-spiral-section" data-ps-arms={arms} data-ps-meter={s.prAlignMeter ? "1" : "0"} data-ps-loop-sound={s.prLoopSound ? "1" : "0"} data-ps-palette={s.prPalette}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("prSpiralDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="prSpiralPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("prSpiralPreset")}
            <Tooltip text={t("prSpiralPresetTip")} />
          </span>
          <button type="button" onClick={() => update({ ...PHASE_SPIRAL_PRESET, backgroundColors: [...PHASE_SPIRAL_PRESET.backgroundColors] })} className={`w-full ${pick(false)}`} data-ps-preset="phaseSpiral">
            {t("prSpiralPresetButton")}
          </button>
        </div>
      </Searchable>
      {(orbit || all) && <Slider t={t} search={search} matches={matches} labelKey="prArms" tipKey="prArmsTip" value={s.prArms} range={RANGES.prArms} onChange={(v) => update({ prArms: v })} display={String(s.prArms)} />}
      <Searchable search={search} matches={matches} labelKey="prAlignMeter">
        <Toggle t={t} labelKey="prAlignMeter" tipKey="prAlignMeterTip" value={s.prAlignMeter} onChange={(v) => update({ prAlignMeter: v })} />
      </Searchable>
      {(orbit || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="prTrail" tipKey="prTrailTip" value={s.prTrail} range={RANGES.prTrail} onChange={(v) => update({ prTrail: v })} display={s.prTrail === 0 ? t("prOff") : `${s.prTrail.toFixed(2)}s`} />
      )}
      <Searchable search={search} matches={matches} labelKey="prLoopSound">
        <Toggle t={t} labelKey="prLoopSound" tipKey="prLoopSoundTip" value={s.prLoopSound} onChange={(v) => update({ prLoopSound: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="prPalette">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("prPalette")}
            <Tooltip text={t("prPaletteTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("prPalette")}>
            {POLY_PALETTES.map((palette) => (
              <button type="button" key={palette} onClick={() => update({ prPalette: palette })} aria-pressed={s.prPalette === palette} className={pick(s.prPalette === palette)}>
                {t(PALETTE_LABELS[palette])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
    </div>
  );
}
