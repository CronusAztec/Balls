"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { inputClass } from "@/components/ui/Field";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { BM_PRESET_IDS, BM_PRESET_LABELS, BM_SOURCES, BM_VARIANTS, BM_NOTES_MAX, beatMachinePresetPatch, beatMachineVariantPatch, type BmPresetId, type BmSource, type BmVariant } from "@/lib/physics/beatMachine";

/*
 * --- beat-machine --- The Beat Machines controls (lib/physics/beatMachine.ts), in the Mode row while the mode is active (and in the
 * Ball section while the settings search is in use): the presets (Eight steps, Scale staircase, Marble xylophone, Load your
 * melody), the machine (marbles or stairs), the tempo and where the notes come from (a seeded original phrase, a scale run, the
 * loaded melody or a typed list); the staircase's steps, their offsets and the return beats; the marble machine's bars, drop
 * height, rebound, marbles per tube (auto: as many as the tune needs), loop beats and phrase bass; and the HUD's note counter.
 * The labels live in the `BeatMachine` namespace (the search and the command palette read them there too: Controls.tsx).
 * Simulator.tsx hands the settings to the engine and re-plans the run when one of them changes (the counter follows live);
 * the bars' and the steps' pitches follow the Sound section's scale and root.
 */

export interface BeatMachineSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BEAT_MACHINE_KEYS = ["bmPreset", "bmVariant", "bmBpm", "bmSource", "bmNotes", "bmSteps", "bmStepDx", "bmStepDy", "bmReturn", "bmBars", "bmDrop", "bmRebound", "bmPerTube", "bmLoopBeats", "bmBass", "bmCounter"];

const VARIANT_LABELS: Record<BmVariant, string> = { marbles: "variantMarbles", stairs: "variantStairs" };
const SOURCE_LABELS: Record<BmSource, string> = { original: "sourceOriginal", scale: "sourceScale", melody: "sourceMelody", custom: "sourceCustom" };
const SOURCE_HINTS: Record<BmSource, string> = { original: "sourceOriginalHint", scale: "sourceScaleHint", melody: "sourceMelodyHint", custom: "sourceCustomHint" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A number as the panel shows it: at most `digits` decimals, trailing zeros dropped. */
function short(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "–";
}

/** The section's translator: a key of the `BeatMachine` namespace, else the Controls namespace's (the primitives' shared words). */
function useBeatMachineTranslator(t: Translate): Translate {
  const bm = useTranslations("BeatMachine");
  return useMemo(() => {
    const own = (key: string) => bm.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? bm(key as never, values as never) : t(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || t.has(key as never),
      raw: (key: string) => (own(key) ? bm.raw(key as never) : t.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? bm.rich(key as never, values) : t.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? bm.markup(key as never, values) : t.markup(key as never, values)),
    });
    return fn;
  }, [bm, t]);
}

export default function BeatMachineSection({ t: controls, search, matches, settings: s, update }: BeatMachineSectionProps) {
  const t = useBeatMachineTranslator(controls);
  const stairs = s.bmVariant === "stairs";
  const beats = stairs ? s.bmSteps + s.bmReturn : s.bmLoopBeats;
  const loopSec = s.bmBpm > 0 ? (beats * 60) / s.bmBpm : NaN;
  const applyPreset = (id: BmPresetId) => update(beatMachinePresetPatch(id));
  return (
    <div className="space-y-3 pt-2" data-testid="beat-machine-section" data-bm-variant={s.bmVariant} data-bm-source={s.bmSource} data-bm-loop={short(loopSec, 3)} data-bm-beats={String(beats)}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("desc")}</p>}
      <Searchable search={search} matches={matches} labelKey="bmPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("bmPreset")}
            <Tooltip text={t("bmPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="bm-presets">
            {BM_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-bm-preset={id}>
                {t(BM_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <ButtonRow t={t} search={search} matches={matches} labelKey="bmVariant" tipKey="bmVariantTip" values={BM_VARIANTS} labels={VARIANT_LABELS} value={s.bmVariant} onChange={(v) => update(beatMachineVariantPatch(s, v))} />
      <Slider t={t} search={search} matches={matches} labelKey="bmBpm" tipKey="bmBpmTip" value={s.bmBpm} range={RANGES.bmBpm} onChange={(v) => update({ bmBpm: v })} display={short(s.bmBpm, 1)} />
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="bm-loop-note">
          {t(stairs ? "loopNoteStairs" : "loopNoteMarbles", { beats, loop: short(loopSec, 2), steps: s.bmSteps, back: s.bmReturn })}
        </p>
      )}
      <ButtonRow t={t} search={search} matches={matches} labelKey="bmSource" tipKey="bmSourceTip" values={BM_SOURCES} labels={SOURCE_LABELS} value={s.bmSource} onChange={(bmSource) => update({ bmSource })} hint={search ? undefined : t(SOURCE_HINTS[s.bmSource])} />
      {(s.bmSource === "custom" || (!!search && matches("bmNotes"))) && (
        <Searchable search={search} matches={matches} labelKey="bmNotes">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink-2 flex items-center">
              {t("bmNotes")}
              <Tooltip text={t("bmNotesTip")} />
            </span>
            <input type="text" value={s.bmNotes} maxLength={BM_NOTES_MAX} onChange={(e) => update({ bmNotes: e.target.value })} placeholder={t("bmNotesPlaceholder")} className={`${inputClass} text-sm`} aria-label={t("bmNotes")} data-testid="bm-notes" spellCheck={false} />
          </label>
        </Searchable>
      )}
      {(stairs || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="bmSteps" tipKey="bmStepsTip" value={s.bmSteps} range={RANGES.bmSteps} onChange={(v) => update({ bmSteps: v })} display={String(s.bmSteps)} />
          <Slider t={t} search={search} matches={matches} labelKey="bmStepDx" tipKey="bmStepDxTip" value={s.bmStepDx} range={RANGES.bmStepDx} onChange={(v) => update({ bmStepDx: v })} display={`${short(s.bmStepDx, 1)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="bmStepDy" tipKey="bmStepDyTip" value={s.bmStepDy} range={RANGES.bmStepDy} onChange={(v) => update({ bmStepDy: v })} display={`${short(s.bmStepDy, 1)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="bmReturn" tipKey="bmReturnTip" value={s.bmReturn} range={RANGES.bmReturn} onChange={(v) => update({ bmReturn: v })} display={String(s.bmReturn)} />
        </>
      )}
      {(!stairs || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="bmBars" tipKey="bmBarsTip" value={s.bmBars} range={RANGES.bmBars} onChange={(v) => update({ bmBars: v })} display={String(s.bmBars)} />
          <Slider t={t} search={search} matches={matches} labelKey="bmDrop" tipKey="bmDropTip" value={s.bmDrop} range={RANGES.bmDrop} onChange={(v) => update({ bmDrop: v })} display={`${short(s.bmDrop, 1)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="bmRebound" tipKey="bmReboundTip" value={s.bmRebound} range={RANGES.bmRebound} onChange={(v) => update({ bmRebound: v })} display={short(s.bmRebound, 2)} />
          <Slider t={t} search={search} matches={matches} labelKey="bmPerTube" tipKey="bmPerTubeTip" value={s.bmPerTube} range={RANGES.bmPerTube} onChange={(v) => update({ bmPerTube: v })} display={s.bmPerTube > 0 ? String(s.bmPerTube) : t("perTubeAuto")} />
          <Slider t={t} search={search} matches={matches} labelKey="bmLoopBeats" tipKey="bmLoopBeatsTip" value={s.bmLoopBeats} range={RANGES.bmLoopBeats} onChange={(v) => update({ bmLoopBeats: v })} display={String(s.bmLoopBeats)} />
          <Searchable search={search} matches={matches} labelKey="bmBass">
            <Toggle t={t} labelKey="bmBass" tipKey="bmBassTip" value={s.bmBass} onChange={(v) => update({ bmBass: v })} />
          </Searchable>
        </>
      )}
      <Searchable search={search} matches={matches} labelKey="bmCounter">
        <Toggle t={t} labelKey="bmCounter" tipKey="bmCounterTip" value={s.bmCounter} onChange={(v) => update({ bmCounter: v, ...(v ? { loopHud: true } : {}) })} />
      </Searchable>
    </div>
  );
}

/** One of the section's option rows (a labelled group of buttons, the active one pressed; an optional hint under it). */
function ButtonRow<V extends string>({ t, search, matches, labelKey, tipKey, values, labels, value, onChange, hint }: { t: Translate; search: string; matches: Matcher; labelKey: string; tipKey: string; values: readonly V[]; labels: Record<V, string>; value: V; onChange: (v: V) => void; hint?: string }) {
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label={t(labelKey)}>
          {values.map((v) => (
            <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={pick(value === v)} data-bm-option={`${labelKey}:${v}`}>
              {t(String(labels[v]))}
            </button>
          ))}
        </div>
        {hint && <p className="text-xs text-ink-3 leading-relaxed">{hint}</p>}
      </div>
    </Searchable>
  );
}
