"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { PENDULUM_LAYOUTS, PENDULUM_PITCH_DIRECTIONS, PENDULUM_POLYGONS, PENDULUM_SOUND_ONS, type PendulumLayout, type PendulumPitchDirection, type PendulumSoundOn } from "@/lib/physics/modes/pendulum";

export interface PendulumWaveSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const PENDULUM_WAVE_KEYS = ["pwLayout", "pwPolygon", "pwCount", "pwBaseOscillations", "pwCycleSeconds", "pwAmplitude", "pwPhasing", "pwTrails", "pwSoundOn", "pwPitchDirection", "pwWaveChord", "pwCycles"];

const LAYOUT_OPTIONS: Record<PendulumLayout, { labelKey: string }> = {
  row: { labelKey: "pwLayoutRow" },
  arc: { labelKey: "pwLayoutArc" },
  circle: { labelKey: "pwLayoutCircle" },
  galaxy: { labelKey: "pwLayoutGalaxy" },
  sliding: { labelKey: "pwLayoutSliding" },
  bouncing: { labelKey: "pwLayoutBouncing" },
};

const SOUND_ON_LABELS: Record<PendulumSoundOn, string> = { center: "pwSoundCenter", extremes: "pwSoundExtremes", both: "pwSoundBoth" };
const PITCH_LABELS: Record<PendulumPitchDirection, string> = { up: "pwPitchUp", down: "pwPitchDown" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/**
 * "Pendulum wave" controls of the Pendulum Wave mode, shown in the Mode row while the mode is active (and in the
 * Ball section while the settings search is in use): layout and polygon, count, tuning (base swings, cycle length,
 * amplitude, phasing), trails, where a note plays, pitch direction, wave chord and the number of cycles. The values
 * live in SimulatorSettings like everything else; Simulator.tsx forwards them to the engine (see
 * lib/physics/modes/pendulum.ts) and restarts the rig when they change.
 */
export default function PendulumWaveSection({ t, search, matches, settings: s, update }: PendulumWaveSectionProps) {
  const radial = s.pwLayout === "circle" || s.pwLayout === "galaxy";
  return (
    <div className="space-y-3 pt-2">
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("pwDesc")}</p>}
      <Searchable search={search} matches={matches} labelKey="pwLayout">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("pwLayout")}
            <Tooltip text={t("pwLayoutTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("pwLayout")}>
            {PENDULUM_LAYOUTS.map((layout) => (
              <button type="button" key={layout} onClick={() => update({ pwLayout: layout })} aria-pressed={s.pwLayout === layout} className={pick(s.pwLayout === layout)}>
                {t(LAYOUT_OPTIONS[layout].labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {(radial || !!search) && (
        <Searchable search={search} matches={matches} labelKey="pwPolygon">
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-2">
              {t("pwPolygon")}
              <Tooltip text={t("pwPolygonTip")} />
            </label>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label={t("pwPolygon")}>
              {PENDULUM_POLYGONS.map((sides) => (
                <button type="button" key={sides} onClick={() => update({ pwPolygon: sides })} aria-pressed={s.pwPolygon === sides} className={`${pick(s.pwPolygon === sides)} tabular-nums`}>
                  {sides === 0 ? t("pwPolygonOff") : String(sides)}
                </button>
              ))}
            </div>
          </div>
        </Searchable>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="pwCount" tipKey="pwCountTip" value={s.pwCount} range={RANGES.pwCount} onChange={(v) => update({ pwCount: v })} display={String(s.pwCount)} />
      <Slider t={t} search={search} matches={matches} labelKey="pwBaseOscillations" tipKey="pwBaseOscillationsTip" value={s.pwBaseOscillations} range={RANGES.pwBaseOscillations} onChange={(v) => update({ pwBaseOscillations: v })} display={`${s.pwBaseOscillations} → ${s.pwBaseOscillations + s.pwCount - 1}`} />
      <Slider t={t} search={search} matches={matches} labelKey="pwCycleSeconds" tipKey="pwCycleSecondsTip" value={s.pwCycleSeconds} range={RANGES.pwCycleSeconds} onChange={(v) => update({ pwCycleSeconds: v })} display={`${s.pwCycleSeconds}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="pwAmplitude" tipKey="pwAmplitudeTip" value={s.pwAmplitude} range={RANGES.pwAmplitude} onChange={(v) => update({ pwAmplitude: v })} display={`${s.pwAmplitude}°`} />
      <Searchable search={search} matches={matches} labelKey="pwPhasing">
        <Toggle t={t} labelKey="pwPhasing" tipKey="pwPhasingTip" value={s.pwPhasing} onChange={(v) => update({ pwPhasing: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="pwTrails" tipKey="pwTrailsTip" value={s.pwTrails} range={RANGES.pwTrails} onChange={(v) => update({ pwTrails: v })} display={s.pwTrails === 0 ? t("pwOff") : `${Math.round(100 * s.pwTrails)}%`} />
      <Searchable search={search} matches={matches} labelKey="pwSoundOn">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("pwSoundOn")}
            <Tooltip text={t("pwSoundOnTip")} />
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("pwSoundOn")}>
            {PENDULUM_SOUND_ONS.map((where) => (
              <button type="button" key={where} onClick={() => update({ pwSoundOn: where })} aria-pressed={s.pwSoundOn === where} className={pick(s.pwSoundOn === where)}>
                {t(SOUND_ON_LABELS[where])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="pwPitchDirection">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("pwPitchDirection")}
            <Tooltip text={t("pwPitchDirectionTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("pwPitchDirection")}>
            {PENDULUM_PITCH_DIRECTIONS.map((direction) => (
              <button type="button" key={direction} onClick={() => update({ pwPitchDirection: direction })} aria-pressed={s.pwPitchDirection === direction} className={pick(s.pwPitchDirection === direction)}>
                {t(PITCH_LABELS[direction])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="pwWaveChord">
        <Toggle t={t} labelKey="pwWaveChord" tipKey="pwWaveChordTip" value={s.pwWaveChord} onChange={(v) => update({ pwWaveChord: v })} />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="pwCycles" tipKey="pwCyclesTip" value={s.pwCycles} range={RANGES.pwCycles} onChange={(v) => update({ pwCycles: v })} display={s.pwCycles === 0 ? t("pwCyclesNever") : String(s.pwCycles)} />
    </div>
  );
}
