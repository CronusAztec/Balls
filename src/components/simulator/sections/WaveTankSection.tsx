"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { inputClass } from "@/components/ui/Field";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { WT_GAPS_MAX, WT_MODELS, WT_PRESET_IDS, WT_PRESET_LABELS, WT_SOURCES, parseWaveSections, sectionChangeTimes, waveSchedule, waveTankPresetPatch, type WtModel, type WtPresetId, type WtSource } from "@/lib/physics/waveTank";

/*
 * --- wave-tank --- The Wave Tank controls (lib/physics/waveTank.ts), in the Mode row while the mode is active (and in the Ball
 * section while the settings search is in use): the presets (Double slit, Single-slit width sweep, Grating 15, Two sources,
 * Talbot carpet), the model (the grid or the Huygens sum) and the source (a wave-maker and a barrier, or point sources), the
 * sections (gap counts, each optionally with its seconds) with the loop they make, the gaps' width (and the width the last
 * section grows to) and spacing in wavelengths, the wavelength, the speed and the damping, the grid's columns, the sections'
 * seconds and the wrap, the bells and the scan, the ridge lines and the tilt, the root bass and the HUD's section label.
 * The labels live in the `WaveTank` namespace (the search and the command palette read them there too: Controls.tsx).
 * Simulator.tsx hands the settings to the engine and rebuilds the water when one of WT_RESTART_FIELDS changes.
 */

export interface WaveTankSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const WAVE_TANK_KEYS = ["wtPreset", "wtModel", "wtSource", "wtGaps", "wtWidth", "wtWidthEnd", "wtSpacing", "wtWavelength", "wtSpeed", "wtDamping", "wtCols", "wtSection", "wtWrap", "wtBells", "wtScanRate", "wtRidges", "wtTilt", "wtBass", "wtLabel"];

const MODEL_LABELS: Record<WtModel, string> = { grid: "modelGrid", huygens: "modelHuygens" };
const SOURCE_LABELS: Record<WtSource, string> = { line: "sourceLine", points: "sourcePoints" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A number as the panel shows it: at most `digits` decimals, trailing zeros dropped. */
function short(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "–";
}

/** The section's translator: a key of the `WaveTank` namespace, else the Controls namespace's (the primitives' shared words). */
function useWaveTankTranslator(t: Translate): Translate {
  const wt = useTranslations("WaveTank");
  return useMemo(() => {
    const own = (key: string) => wt.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? wt(key as never, values as never) : t(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || t.has(key as never),
      raw: (key: string) => (own(key) ? wt.raw(key as never) : t.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? wt.rich(key as never, values) : t.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? wt.markup(key as never, values) : t.markup(key as never, values)),
    });
    return fn;
  }, [wt, t]);
}

export default function WaveTankSection({ t: controls, search, matches, settings: s, update }: WaveTankSectionProps) {
  const t = useWaveTankTranslator(controls);
  const schedule = useMemo(() => waveSchedule(parseWaveSections(s.wtGaps, s.wtSection, s.wtWidth, s.wtWidthEnd), s.wtWrap), [s.wtGaps, s.wtSection, s.wtWidth, s.wtWidthEnd, s.wtWrap]);
  const loopSec = schedule.loopFrames / 60;
  const changes = sectionChangeTimes(schedule);
  const gapList = schedule.sections.map((sec) => sec.gaps).join(", ");
  const applyPreset = (id: WtPresetId) => update(waveTankPresetPatch(id));
  const grid = s.wtModel === "grid";
  return (
    <div className="space-y-3 pt-2" data-testid="wave-tank-section" data-wt-model={s.wtModel} data-wt-source={s.wtSource} data-wt-loop={short(loopSec, 3)} data-wt-sections={gapList} data-wt-changes={changes.map((c) => short(c, 3)).join(",")}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("desc")}</p>}
      <Searchable search={search} matches={matches} labelKey="wtPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("wtPreset")}
            <Tooltip text={t("wtPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="wt-presets">
            {WT_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-wt-preset={id}>
                {t(WT_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <ButtonRow t={t} search={search} matches={matches} labelKey="wtModel" tipKey="wtModelTip" values={WT_MODELS} labels={MODEL_LABELS} value={s.wtModel} onChange={(wtModel) => update({ wtModel })} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="wtSource" tipKey="wtSourceTip" values={WT_SOURCES} labels={SOURCE_LABELS} value={s.wtSource} onChange={(wtSource) => update({ wtSource })} />
      <Searchable search={search} matches={matches} labelKey="wtGaps">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("wtGaps")}
            <Tooltip text={t("wtGapsTip")} />
          </span>
          <input type="text" value={s.wtGaps} maxLength={WT_GAPS_MAX} onChange={(e) => update({ wtGaps: e.target.value })} placeholder="1, 2, 7" className={`${inputClass} text-sm`} aria-label={t("wtGaps")} data-testid="wt-gaps" spellCheck={false} />
        </label>
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="wt-loop-note">
          {t("loopNote", { loop: short(loopSec, 2), sections: gapList, changes: changes.length > 0 ? changes.map((c) => short(c, 2)).join(", ") : "–" })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="wtSection" tipKey="wtSectionTip" value={s.wtSection} range={RANGES.wtSection} onChange={(v) => update({ wtSection: v })} display={`${short(s.wtSection, 1)} s`} />
      <Slider t={t} search={search} matches={matches} labelKey="wtWrap" tipKey="wtWrapTip" value={s.wtWrap} range={RANGES.wtWrap} onChange={(v) => update({ wtWrap: v })} display={`${short(s.wtWrap, 1)} s`} />
      <Slider t={t} search={search} matches={matches} labelKey="wtWidth" tipKey="wtWidthTip" value={s.wtWidth} range={RANGES.wtWidth} onChange={(v) => update({ wtWidth: v })} display={`${short(s.wtWidth, 2)} λ`} />
      <Slider t={t} search={search} matches={matches} labelKey="wtWidthEnd" tipKey="wtWidthEndTip" value={s.wtWidthEnd} range={RANGES.wtWidthEnd} onChange={(v) => update({ wtWidthEnd: v })} display={s.wtWidthEnd > 0 ? `${short(s.wtWidthEnd, 2)} λ` : t("widthEndOff")} />
      <Slider t={t} search={search} matches={matches} labelKey="wtSpacing" tipKey="wtSpacingTip" value={s.wtSpacing} range={RANGES.wtSpacing} onChange={(v) => update({ wtSpacing: v })} display={`${short(s.wtSpacing, 1)} λ`} />
      <Slider t={t} search={search} matches={matches} labelKey="wtWavelength" tipKey="wtWavelengthTip" value={s.wtWavelength} range={RANGES.wtWavelength} onChange={(v) => update({ wtWavelength: v })} display={`${short(s.wtWavelength, 1)}%`} />
      <Slider t={t} search={search} matches={matches} labelKey="wtSpeed" tipKey="wtSpeedTip" value={s.wtSpeed} range={RANGES.wtSpeed} onChange={(v) => update({ wtSpeed: v })} display={short(s.wtSpeed, 2)} />
      <Slider t={t} search={search} matches={matches} labelKey="wtDamping" tipKey="wtDampingTip" value={s.wtDamping} range={RANGES.wtDamping} onChange={(v) => update({ wtDamping: v })} display={short(s.wtDamping, 3)} />
      {(grid || !!search) && <Slider t={t} search={search} matches={matches} labelKey="wtCols" tipKey="wtColsTip" value={s.wtCols} range={RANGES.wtCols} onChange={(v) => update({ wtCols: v })} display={`${s.wtCols} × ${Math.round(s.wtCols * (4 / 3))}`} />}
      <Slider t={t} search={search} matches={matches} labelKey="wtBells" tipKey="wtBellsTip" value={s.wtBells} range={RANGES.wtBells} onChange={(v) => update({ wtBells: v })} display={String(s.wtBells)} />
      <Slider t={t} search={search} matches={matches} labelKey="wtScanRate" tipKey="wtScanRateTip" value={s.wtScanRate} range={RANGES.wtScanRate} onChange={(v) => update({ wtScanRate: v })} display={`${short(s.wtScanRate, 1)}/s`} />
      <Slider t={t} search={search} matches={matches} labelKey="wtRidges" tipKey="wtRidgesTip" value={s.wtRidges} range={RANGES.wtRidges} onChange={(v) => update({ wtRidges: v })} display={String(s.wtRidges)} />
      <Slider t={t} search={search} matches={matches} labelKey="wtTilt" tipKey="wtTiltTip" value={s.wtTilt} range={RANGES.wtTilt} onChange={(v) => update({ wtTilt: v })} display={`${short(s.wtTilt, 1)}°`} />
      <Searchable search={search} matches={matches} labelKey="wtBass">
        <Toggle t={t} labelKey="wtBass" tipKey="wtBassTip" value={s.wtBass} onChange={(v) => update({ wtBass: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="wtLabel">
        <Toggle t={t} labelKey="wtLabel" tipKey="wtLabelTip" value={s.wtLabel} onChange={(v) => update({ wtLabel: v, ...(v ? { loopHud: true } : {}) })} />
      </Searchable>
    </div>
  );
}

/** One of the section's option rows (a labelled group of buttons, the active one pressed). */
function ButtonRow<V extends string>({ t, search, matches, labelKey, tipKey, values, labels, value, onChange }: { t: Translate; search: string; matches: Matcher; labelKey: string; tipKey: string; values: readonly V[]; labels: Record<V, string>; value: V; onChange: (v: V) => void }) {
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label={t(labelKey)}>
          {values.map((v) => (
            <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={pick(value === v)} data-wt-option={`${labelKey}:${v}`}>
              {t(String(labels[v]))}
            </button>
          ))}
        </div>
      </div>
    </Searchable>
  );
}
