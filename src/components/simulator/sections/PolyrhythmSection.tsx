"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  POLY_ARC_STYLES,
  POLY_LAYOUTS,
  POLY_PITCH_BY,
  POLY_TEMPOS,
  buildTempoSeries,
  parseCustomRatios,
  polyrhythmSettingsOf,
  resolvePolyrhythmSettings,
  sanitizeCustomRatios,
  type PolyArcStyle,
  type PolyLayout,
  type PolyPitchBy,
  type PolyTempos,
} from "@/lib/physics/modes/polyrhythm";

export interface PolyrhythmSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const POLYRHYTHM_KEYS = ["prLayout", "prArcStyle", "prPolygon", "prTempos", "prCount", "prCycleSeconds", "prBaseBpm", "prBpmStep", "prCustom", "prAccentEvery", "prPitchBy", "prNumbers", "prCycles"];

const LAYOUT_OPTIONS: Record<PolyLayout, { icon: string; labelKey: string }> = {
  rings: { icon: "⭕", labelKey: "prLayoutRings" },
  arcs: { icon: "🌈", labelKey: "prLayoutArcs" },
  metronomes: { icon: "⏱️", labelKey: "prLayoutMetronomes" },
  spiral: { icon: "🌀", labelKey: "prLayoutSpiral" },
};
const ARC_STYLE_LABELS: Record<PolyArcStyle, string> = { chords: "prArcChords", semicircles: "prArcSemicircles" };
const TEMPO_LABELS: Record<PolyTempos, string> = { harmonic: "prTemposHarmonic", arithmetic: "prTemposArithmetic", custom: "prTemposCustom" };
const PITCH_LABELS: Record<PolyPitchBy, string> = { index: "prPitchIndex", ratio: "prPitchRatio" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`;

/** Seconds for the readout: whole seconds as they are, otherwise one decimal. */
function formatSeconds(sec: number) {
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

/** `cols: "wrap"` lays the buttons out in a wrapping row (each at least as wide as its label) instead of fixed grid columns. */
function Choice<T extends string>({ t, labelKey, tipKey, options, labels, value, onChange, cols }: { t: Translate; labelKey: string; tipKey: string; options: readonly T[]; labels: Readonly<Record<string, string>>; value: T; onChange: (v: T) => void; cols: string }) {
  const wrap = cols === "wrap"; // --- review fix (ui-i18n) ---
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-300">
        {t(labelKey)}
        <Tooltip text={t(tipKey)} />
      </label>
      <div className={wrap ? "flex flex-wrap gap-1" : `grid ${cols} gap-1`} role="group" aria-label={t(labelKey)}>
        {options.map((option) => (
          <button type="button" key={option} onClick={() => onChange(option)} aria-pressed={value === option} className={`${wrap ? "flex-auto whitespace-nowrap " : ""}${pick(value === option)}`}>
            {t(labels[option])}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * "Metronomes & Polyrhythms" controls, shown in the Mode row while the mode is active (and in the Ball section
 * while the settings search is in use): layout (with the arc style and the polygon option), the tempo series and
 * its parameters (voices and cycle length, base BPM and step, or a custom ratio list), accents, pitch mapping,
 * numbers and cycles, plus a readout of how often every voice lines up. The values live in SimulatorSettings;
 * Simulator.tsx forwards them to the engine (see lib/physics/modes/polyrhythm.ts) and restarts the run when a
 * tempo setting changes.
 */
export default function PolyrhythmSection({ t, search, matches, settings: s, update }: PolyrhythmSectionProps) {
  const all = !!search;
  const series = buildTempoSeries(resolvePolyrhythmSettings(polyrhythmSettingsOf(s), s.unlimited)); // --- unlimited --- (the run the engine plays)
  const customCount = parseCustomRatios(s.prCustom).length;
  return (
    <div className="space-y-3 pt-2">
      {!search && <p className="text-xs text-zinc-500 leading-relaxed">{t("prDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="prLayout">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("prLayout")}
            <Tooltip text={t("prLayoutTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("prLayout")}>
            {POLY_LAYOUTS.map((layout) => (
              <button type="button" key={layout} onClick={() => update({ prLayout: layout })} aria-pressed={s.prLayout === layout} className={pick(s.prLayout === layout)}>
                <span aria-hidden="true">{LAYOUT_OPTIONS[layout].icon}</span> {t(LAYOUT_OPTIONS[layout].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {(s.prLayout === "arcs" || all) && (
        <Searchable search={search} matches={matches} labelKey="prArcStyle">
          <Choice t={t} labelKey="prArcStyle" tipKey="prArcStyleTip" options={POLY_ARC_STYLES} labels={ARC_STYLE_LABELS} value={s.prArcStyle} onChange={(v) => update({ prArcStyle: v })} cols="grid-cols-2" />
        </Searchable>
      )}
      {(s.prLayout === "rings" || all) && (
        <Searchable search={search} matches={matches} labelKey="prPolygon">
          <Toggle t={t} labelKey="prPolygon" tipKey="prPolygonTip" value={s.prPolygon} onChange={(v) => update({ prPolygon: v })} />
        </Searchable>
      )}
      <Searchable search={search} matches={matches} labelKey="prTempos">
        <Choice t={t} labelKey="prTempos" tipKey="prTemposTip" options={POLY_TEMPOS} labels={TEMPO_LABELS} value={s.prTempos} onChange={(v) => update({ prTempos: v })} cols="wrap" /* --- review fix (ui-i18n) --- es "Personalizados" fits */ />
      </Searchable>
      {(s.prTempos !== "custom" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="prCount" tipKey="prCountTip" value={s.prCount} range={RANGES.prCount} onChange={(v) => update({ prCount: v })} display={String(s.prCount)} left="▪" right="▪▪▪" />
      )}
      {(s.prTempos !== "arithmetic" || all) && (
        <Slider t={t} search={search} matches={matches} labelKey="prCycleSeconds" tipKey="prCycleSecondsTip" value={s.prCycleSeconds} range={RANGES.prCycleSeconds} onChange={(v) => update({ prCycleSeconds: v })} display={`${formatSeconds(s.prCycleSeconds)}s`} left="⏱️" right="⏳" />
      )}
      {(s.prTempos === "arithmetic" || all) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="prBaseBpm" tipKey="prBaseBpmTip" value={s.prBaseBpm} range={RANGES.prBaseBpm} onChange={(v) => update({ prBaseBpm: v })} display={`${s.prBaseBpm} BPM`} left="🐢" right="🐇" />
          <Slider t={t} search={search} matches={matches} labelKey="prBpmStep" tipKey="prBpmStepTip" value={s.prBpmStep} range={RANGES.prBpmStep} onChange={(v) => update({ prBpmStep: v })} display={`+${s.prBpmStep.toFixed(1)} BPM`} left="·" right="⋯" />
        </>
      )}
      {(s.prTempos === "custom" || all) && (
        <Searchable search={search} matches={matches} labelKey="prCustom">
          <div className="space-y-2">
            <label htmlFor="poly-custom-ratios" className="text-sm font-medium text-zinc-300 flex items-center justify-between">
              <span>
                {t("prCustom")}
                <Tooltip text={t("prCustomTip")} />
              </span>
              <span className="text-zinc-500">{t("prCustomVoices", { count: customCount })}</span>
            </label>
            <input
              id="poly-custom-ratios"
              type="text"
              inputMode="numeric"
              value={s.prCustom}
              placeholder="3,4,5,7"
              onChange={(e) => update({ prCustom: sanitizeCustomRatios(e.target.value) })}
              className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm tabular-nums"
            />
          </div>
        </Searchable>
      )}
      {!search && <p className="text-xs text-zinc-400 tabular-nums" data-testid="poly-realign">{t("prRealign", { seconds: formatSeconds(Math.round(10 * series.alignSec) / 10) })}</p>}
      <Slider t={t} search={search} matches={matches} labelKey="prAccentEvery" tipKey="prAccentEveryTip" value={s.prAccentEvery} range={RANGES.prAccentEvery} onChange={(v) => update({ prAccentEvery: v })} display={s.prAccentEvery === 0 ? t("prOff") : String(s.prAccentEvery)} left="·" right="!" />
      <Searchable search={search} matches={matches} labelKey="prPitchBy">
        <Choice t={t} labelKey="prPitchBy" tipKey="prPitchByTip" options={POLY_PITCH_BY} labels={PITCH_LABELS} value={s.prPitchBy} onChange={(v) => update({ prPitchBy: v })} cols="grid-cols-2" />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="prNumbers">
        <Toggle t={t} labelKey="prNumbers" tipKey="prNumbersTip" value={s.prNumbers} onChange={(v) => update({ prNumbers: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="prCycles" tipKey="prCyclesTip" value={s.prCycles} range={RANGES.prCycles} onChange={(v) => update({ prCycles: v })} display={s.prCycles === 0 ? t("prCyclesNever") : String(s.prCycles)} left="∞" right="20" />
    </div>
  );
}
