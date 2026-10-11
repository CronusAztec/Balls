"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { CS_LOOK, CS_PRESET_IDS, CS_PRESET_LABELS, colourSortPastCeiling, colourSortPresetFields, colourSortTotal, type CsPresetId } from "@/lib/physics/colourSortSettings";
import { CS_BALL_CEILING, CS_RULES, colourSortCounts, type CsRule } from "@/lib/physics/modes/colourSort";

export interface ColourSortSectionProps {
  /** The Controls namespace (the shared words: ON / OFF, the timeline's badge…). */
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them; labels under `ColourSort`). */
export const COLOUR_SORT_KEYS = ["csPreset", "csRule", "csColours", "csPerColour", "csGates", "csGateWidth", "csSpin", "csFalloff", "csAlternate", "csSpeed", "csSize", "csContacts", "csRemix", "csLimit", "csFlash"];

const RULE_OPTIONS: Record<CsRule, { labelKey: string; hintKey: string }> = {
  outwardNotOwn: { labelKey: "csRuleOutwardNotOwn", hintKey: "csHintOutwardNotOwn" },
  outwardOwnOnly: { labelKey: "csRuleOutwardOwnOnly", hintKey: "csHintOutwardOwnOnly" },
  bothWaysNotOwn: { labelKey: "csRuleBothWaysNotOwn", hintKey: "csHintBothWaysNotOwn" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * The section's translator: a key of the `ColourSort` namespace (this block's labels, tips and presets), else the Controls
 * namespace's (the primitives' shared words). The search and the command palette read the labels there too (Controls.tsx).
 */
function useColourSortTranslator(t: Translate): Translate {
  const cs = useTranslations("ColourSort");
  return useMemo(() => {
    const own = (key: string) => cs.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? cs(key as never, values as never) : t(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || t.has(key as never),
      raw: (key: string) => (own(key) ? cs.raw(key as never) : t.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? cs.rich(key as never, values) : t.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? cs.markup(key as never, values) : t.markup(key as never, values)),
    });
    return fn;
  }, [cs, t]);
}

/**
 * "Colour Sort" controls (feature colour-sort), shown in the Mode row while the mode is active (and in the Ball section while
 * the settings search is in use): the presets (Bullseye sort, Rainbow 7, One-gate torture, Ten thousand, Reverse rule), the
 * gate rule, the colours and the balls of each, the gates and their width, the inner ring's spin with its falloff and the
 * alternation, the balls' speed and size (px of the 720-wide reference clip), the contacts, the remix, the time limit and the
 * refusal flashes. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine (lib/physics/modes/
 * colourSort.ts) and restarts the sort when one of them changes (the flashes follow live).
 */
export default function ColourSortSection({ t: controls, search, matches, settings: s, update }: ColourSortSectionProps) {
  const t = useColourSortTranslator(controls);
  const applyPreset = (id: CsPresetId) => update({ ...colourSortPresetFields(id), ...CS_LOOK, backgroundColors: [...CS_LOOK.backgroundColors] });
  const total = colourSortTotal(s);
  const counts = colourSortCounts({ colours: s.csColours, perColour: s.csPerColour });
  return (
    <div className="space-y-3 pt-2" data-testid="colour-sort-section">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("csDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="csPreset">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("csPreset")}
            <Tooltip text={t("csPresetTip")} />
          </label>
          <select
            value=""
            onChange={(e) => {
              const id = CS_PRESET_IDS.find((p) => p === e.target.value);
              if (id) applyPreset(id);
            }}
            aria-label={t("csPreset")}
            className={`${selectClass} text-sm py-1.5`}
            data-testid="cs-preset"
          >
            <option value="">{t("csPresetChoose")}</option>
            {CS_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {t(CS_PRESET_LABELS[id])}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="csRule">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("csRule")}
            <Tooltip text={t("csRuleTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("csRule")} data-testid="cs-rule">
            {CS_RULES.map((rule) => (
              <button type="button" key={rule} onClick={() => update({ csRule: rule })} aria-pressed={s.csRule === rule} className={pick(s.csRule === rule)} data-rule={rule}>
                {t(RULE_OPTIONS[rule].labelKey)}
              </button>
            ))}
          </div>
          {!search && <p className="text-xs text-ink-3 leading-relaxed">{t(RULE_OPTIONS[s.csRule].hintKey)}</p>}
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="csColours" tipKey="csColoursTip" value={s.csColours} range={RANGES.csColours} onChange={(v) => update({ csColours: v })} display={String(s.csColours)} />
      <Slider t={t} search={search} matches={matches} labelKey="csPerColour" tipKey="csPerColourTip" value={s.csPerColour} range={RANGES.csPerColour} onChange={(v) => update({ csPerColour: v })} display={t("csPerColourTotal", { total: total.toLocaleString() })} />
      {!search && colourSortPastCeiling(s) && (
        <p className="text-xs text-warn" data-testid="cs-ball-ceiling">
          {t("csBallCeiling", { max: CS_BALL_CEILING.toLocaleString(), perColour: counts.perColour.toLocaleString() })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="csGates" tipKey="csGatesTip" value={s.csGates} range={RANGES.csGates} onChange={(v) => update({ csGates: v })} display={String(s.csGates)} />
      <Slider t={t} search={search} matches={matches} labelKey="csGateWidth" tipKey="csGateWidthTip" value={s.csGateWidth} range={RANGES.csGateWidth} onChange={(v) => update({ csGateWidth: v })} display={`${s.csGateWidth}°`} />
      <Slider t={t} search={search} matches={matches} labelKey="csSpin" tipKey="csSpinTip" value={s.csSpin} range={RANGES.csSpin} onChange={(v) => update({ csSpin: v })} display={t("csSpinValue", { value: s.csSpin })} />
      <Slider t={t} search={search} matches={matches} labelKey="csFalloff" tipKey="csFalloffTip" value={s.csFalloff} range={RANGES.csFalloff} onChange={(v) => update({ csFalloff: v })} display={`×${s.csFalloff}`} />
      <Searchable search={search} matches={matches} labelKey="csAlternate">
        <Toggle t={t} labelKey="csAlternate" tipKey="csAlternateTip" value={s.csAlternate} onChange={(v) => update({ csAlternate: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="csSpeed" tipKey="csSpeedTip" value={s.csSpeed} range={RANGES.csSpeed} onChange={(v) => update({ csSpeed: v })} display={t("csSpeedValue", { value: s.csSpeed })} />
      <Slider t={t} search={search} matches={matches} labelKey="csSize" tipKey="csSizeTip" value={s.csSize} range={RANGES.csSize} onChange={(v) => update({ csSize: v })} display={t("csSizeValue", { value: s.csSize })} />
      <Searchable search={search} matches={matches} labelKey="csContacts">
        <Toggle t={t} labelKey="csContacts" tipKey="csContactsTip" value={s.csContacts} onChange={(v) => update({ csContacts: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="csRemix" tipKey="csRemixTip" value={s.csRemix} range={RANGES.csRemix} onChange={(v) => update({ csRemix: v })} display={`${s.csRemix}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="csLimit" tipKey="csLimitTip" value={s.csLimit} range={RANGES.csLimit} onChange={(v) => update({ csLimit: v })} display={`${s.csLimit}s`} />
      <Searchable search={search} matches={matches} labelKey="csFlash">
        <Toggle t={t} labelKey="csFlash" tipKey="csFlashTip" value={s.csFlash} onChange={(v) => update({ csFlash: v })} />
      </Searchable>
      {!search && <p className="text-xs text-ink-3 leading-relaxed" data-testid="cs-loop-note">{t("csLoopNote")}</p>}
    </div>
  );
}
