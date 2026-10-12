"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { DM_BODIES, DM_BODY_SPECS, DM_INKS, DM_MACHINES, dmTimeline, type DmBody, type DmInk, type DmMachine } from "@/lib/physics/drawingMachine";
import { DM_BODY_LABELS, DM_PRESET_IDS, DM_PRESET_LABELS, dmShort, drawingMachinePresetPatch, drawingMachineSettingsOf, drawingMachineSwitchPatch, type DmPresetId } from "@/lib/physics/drawingMachineFields";

/*
 * --- drawing-machine --- The Drawing Machines controls (lib/physics/drawingMachine.ts, drawingMachineFields.ts), in the Mode row
 * while the mode is active (and in the Ball section while the settings search is in use): the presets (Three pendulums, one pen;
 * Lissajous 3:2; Decay rose; Earth and Venus; Earth and Mars; Jupiter and Saturn), the machine (harmonograph or orbits); the
 * harmonograph's pendulums (frequency, detune, rotary ratio, friction, amplitudes, phases) and its drawing and scroll times; the
 * orbits' bodies, exact ratio p : q, radius ratio, chords, years, seconds a year, hold, rewind and the pentagram; the ink ramp and
 * the sound. Every number is an uncapped number field from its minimum (the sliders are comfort ranges). The labels live in the
 * `DrawingMachine` namespace (the search and the command palette read them there too: Controls.tsx). Simulator.tsx hands the
 * settings to the engine and restarts the run when a number or the machine changes (the ink, the pentagram and the sound follow
 * live).
 */

export interface DrawingMachineSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const DRAWING_MACHINE_KEYS = [
  "dmPreset",
  "dmMachine",
  "dmFreq",
  "dmDetune",
  "dmRotary",
  "dmDamping",
  "dmAmpX",
  "dmAmpY",
  "dmAmpR",
  "dmPhaseX",
  "dmPhaseY",
  "dmPhaseR",
  "dmDraw",
  "dmScroll",
  "dmInner",
  "dmOuter",
  "dmExact",
  "dmRatioP",
  "dmRatioQ",
  "dmRadius",
  "dmLineDays",
  "dmYears",
  "dmSecPerYear",
  "dmHold",
  "dmRewind",
  "dmPentagram",
  "dmInk",
  "dmSound",
];

const MACHINE_LABELS: Record<DmMachine, string> = { harmonograph: "machineHarmonograph", orbits: "machineOrbits" };
/** The translation key of an ink ramp's name. */
const INK_LABELS: Record<DmInk, string> = { auto: "inkAuto", ink: "inkInk", nebula: "inkNebula", ember: "inkEmber", ocean: "inkOcean", rainbow: "inkRainbow" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** The section's translator: a key of the `DrawingMachine` namespace, else the Controls namespace's (the primitives' shared words). */
function useDrawingMachineTranslator(t: Translate): Translate {
  const dm = useTranslations("DrawingMachine");
  return useMemo(() => {
    const own = (key: string) => dm.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? dm(key as never, values as never) : t(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || t.has(key as never),
      raw: (key: string) => (own(key) ? dm.raw(key as never) : t.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? dm.rich(key as never, values) : t.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? dm.markup(key as never, values) : t.markup(key as never, values)),
    });
    return fn;
  }, [dm, t]);
}

/** The patch of a new body: the body and the real ratio of the two orbits' radii. */
function bodyPatch(s: SimulatorSettings, side: "dmInner" | "dmOuter", body: DmBody): Partial<SimulatorSettings> {
  const inner = side === "dmInner" ? body : s.dmInner;
  const outer = side === "dmOuter" ? body : s.dmOuter;
  const ratio = DM_BODY_SPECS[inner].au / DM_BODY_SPECS[outer].au;
  return { [side]: body, dmRadius: Number(ratio.toFixed(3)) };
}

export default function DrawingMachineSection({ t: controls, search, matches, settings: s, update }: DrawingMachineSectionProps) {
  const t = useDrawingMachineTranslator(controls);
  const harmonograph = s.dmMachine === "harmonograph";
  const timeline = dmTimeline(drawingMachineSettingsOf(s));
  const applyPreset = (id: DmPresetId) => update(drawingMachinePresetPatch(id));
  return (
    <div className="space-y-3 pt-2" data-testid="drawing-machine-section" data-dm-machine={s.dmMachine} data-dm-cycle={dmShort(timeline.cycle, 3)}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("desc")}</p>}
      <Searchable search={search} matches={matches} labelKey="dmPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("dmPreset")}
            <Tooltip text={t("dmPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="dm-presets">
            {DM_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-dm-preset={id}>
                {t(DM_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="dmMachine">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("dmMachine")}
            <Tooltip text={t("dmMachineTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("dmMachine")}>
            {DM_MACHINES.map((m) => (
              <button type="button" key={m} onClick={() => update(drawingMachineSwitchPatch(s, m))} aria-pressed={s.dmMachine === m} className={pick(s.dmMachine === m)} data-dm-option={`dmMachine:${m}`}>
                {t(MACHINE_LABELS[m])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="dm-loop-note">
          {harmonograph ? t("loopNoteHarmonograph", { draw: dmShort(timeline.draw, 2), scroll: dmShort(timeline.scroll, 2), loop: dmShort(timeline.cycle, 2) }) : t("loopNoteOrbits", { draw: dmShort(timeline.draw, 2), hold: dmShort(timeline.hold, 2), rewind: dmShort(timeline.rewind, 2), loop: dmShort(timeline.cycle, 2) })}
        </p>
      )}
      {(harmonograph || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="dmFreq" tipKey="dmFreqTip" value={s.dmFreq} range={RANGES.dmFreq} onChange={(v) => update({ dmFreq: v })} display={`${dmShort(s.dmFreq, 2)} Hz`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmDetune" tipKey="dmDetuneTip" value={s.dmDetune} range={RANGES.dmDetune} onChange={(v) => update({ dmDetune: v })} display={`${dmShort(s.dmDetune, 1)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmRotary" tipKey="dmRotaryTip" value={s.dmRotary} range={RANGES.dmRotary} onChange={(v) => update({ dmRotary: v })} display={`× ${dmShort(s.dmRotary, 2)}`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmDamping" tipKey="dmDampingTip" value={s.dmDamping} range={RANGES.dmDamping} onChange={(v) => update({ dmDamping: v })} display={`${dmShort(s.dmDamping, 1)} s`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmAmpX" tipKey="dmAmpXTip" value={s.dmAmpX} range={RANGES.dmAmpX} onChange={(v) => update({ dmAmpX: v })} display={`${dmShort(s.dmAmpX, 0)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmAmpY" tipKey="dmAmpYTip" value={s.dmAmpY} range={RANGES.dmAmpY} onChange={(v) => update({ dmAmpY: v })} display={`${dmShort(s.dmAmpY, 0)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmAmpR" tipKey="dmAmpRTip" value={s.dmAmpR} range={RANGES.dmAmpR} onChange={(v) => update({ dmAmpR: v })} display={`${dmShort(s.dmAmpR, 0)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmPhaseX" tipKey="dmPhaseTip" value={s.dmPhaseX} range={RANGES.dmPhaseX} onChange={(v) => update({ dmPhaseX: v })} display={`${dmShort(s.dmPhaseX, 0)}°`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmPhaseY" tipKey="dmPhaseTip" value={s.dmPhaseY} range={RANGES.dmPhaseY} onChange={(v) => update({ dmPhaseY: v })} display={`${dmShort(s.dmPhaseY, 0)}°`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmPhaseR" tipKey="dmPhaseTip" value={s.dmPhaseR} range={RANGES.dmPhaseR} onChange={(v) => update({ dmPhaseR: v })} display={`${dmShort(s.dmPhaseR, 0)}°`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmDraw" tipKey="dmDrawTip" value={s.dmDraw} range={RANGES.dmDraw} onChange={(v) => update({ dmDraw: v })} display={`${dmShort(s.dmDraw, 1)} s`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmScroll" tipKey="dmScrollTip" value={s.dmScroll} range={RANGES.dmScroll} onChange={(v) => update({ dmScroll: v })} display={`${dmShort(s.dmScroll, 1)} s`} />
        </>
      )}
      {(!harmonograph || !!search) && (
        <>
          <BodyPicker t={t} search={search} matches={matches} labelKey="dmInner" tipKey="dmInnerTip" value={s.dmInner} onChange={(b) => update(bodyPatch(s, "dmInner", b))} />
          <BodyPicker t={t} search={search} matches={matches} labelKey="dmOuter" tipKey="dmOuterTip" value={s.dmOuter} onChange={(b) => update(bodyPatch(s, "dmOuter", b))} />
          <Searchable search={search} matches={matches} labelKey="dmExact">
            <Toggle t={t} labelKey="dmExact" tipKey="dmExactTip" value={s.dmExact} onChange={(v) => update({ dmExact: v })} />
          </Searchable>
          {(s.dmExact || !!search) && (
            <>
              <Slider t={t} search={search} matches={matches} labelKey="dmRatioP" tipKey="dmRatioPTip" value={s.dmRatioP} range={RANGES.dmRatioP} onChange={(v) => update({ dmRatioP: v })} display={String(s.dmRatioP)} />
              <Slider t={t} search={search} matches={matches} labelKey="dmRatioQ" tipKey="dmRatioQTip" value={s.dmRatioQ} range={RANGES.dmRatioQ} onChange={(v) => update({ dmRatioQ: v })} display={String(s.dmRatioQ)} />
            </>
          )}
          <Slider t={t} search={search} matches={matches} labelKey="dmRadius" tipKey="dmRadiusTip" value={s.dmRadius} range={RANGES.dmRadius} onChange={(v) => update({ dmRadius: v })} display={dmShort(s.dmRadius, 3)} />
          <Slider t={t} search={search} matches={matches} labelKey="dmLineDays" tipKey="dmLineDaysTip" value={s.dmLineDays} range={RANGES.dmLineDays} onChange={(v) => update({ dmLineDays: v })} display={t("daysValue", { value: dmShort(s.dmLineDays, 1) })} />
          <Slider t={t} search={search} matches={matches} labelKey="dmYears" tipKey="dmYearsTip" value={s.dmYears} range={RANGES.dmYears} onChange={(v) => update({ dmYears: v })} display={dmShort(s.dmYears, 1)} />
          <Slider t={t} search={search} matches={matches} labelKey="dmSecPerYear" tipKey="dmSecPerYearTip" value={s.dmSecPerYear} range={RANGES.dmSecPerYear} onChange={(v) => update({ dmSecPerYear: v })} display={`${dmShort(s.dmSecPerYear, 2)} s`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmHold" tipKey="dmHoldTip" value={s.dmHold} range={RANGES.dmHold} onChange={(v) => update({ dmHold: v })} display={`${dmShort(s.dmHold, 1)} s`} />
          <Slider t={t} search={search} matches={matches} labelKey="dmRewind" tipKey="dmRewindTip" value={s.dmRewind} range={RANGES.dmRewind} onChange={(v) => update({ dmRewind: v })} display={`${dmShort(s.dmRewind, 1)} s`} />
          <Searchable search={search} matches={matches} labelKey="dmPentagram">
            <Toggle t={t} labelKey="dmPentagram" tipKey="dmPentagramTip" value={s.dmPentagram} onChange={(v) => update({ dmPentagram: v })} />
          </Searchable>
        </>
      )}
      <Searchable search={search} matches={matches} labelKey="dmInk">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("dmInk")}
            <Tooltip text={t("dmInkTip")} />
          </span>
          <select value={s.dmInk} onChange={(e) => update({ dmInk: e.target.value as DmInk })} className={`${selectClass} text-sm`} aria-label={t("dmInk")} data-testid="dm-ink">
            {DM_INKS.map((ink) => (
              <option key={ink} value={ink}>
                {t(INK_LABELS[ink])}
              </option>
            ))}
          </select>
        </label>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="dmSound">
        <Toggle t={t} labelKey="dmSound" tipKey="dmSoundTip" value={s.dmSound} onChange={(v) => update({ dmSound: v })} />
      </Searchable>
    </div>
  );
}

/** One of the orbits' body pickers (a labelled <select> of the planets). */
function BodyPicker({ t, search, matches, labelKey, tipKey, value, onChange }: { t: Translate; search: string; matches: Matcher; labelKey: string; tipKey: string; value: DmBody; onChange: (b: DmBody) => void }) {
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <select value={value} onChange={(e) => onChange(e.target.value as DmBody)} className={`${selectClass} text-sm`} aria-label={t(labelKey)} data-testid={`dm-body-${labelKey}`}>
          {DM_BODIES.map((b) => (
            <option key={b} value={b}>
              {t(DM_BODY_LABELS[b])}
            </option>
          ))}
        </select>
      </label>
    </Searchable>
  );
}
