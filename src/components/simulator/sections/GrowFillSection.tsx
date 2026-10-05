"use client";

import { useId } from "react";
import Tooltip from "../Tooltip";
import { ColorPicker, Searchable, Slider, Toggle, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { FILL_LOOP_LOOK, GROW_FILL_PRESETS, MAX_RAMP_STOPS, growFillPresetFields, parseRamp, serializeRamp, type GrowFillPreset } from "@/lib/physics/growFill";
import { GROW_LAWS, GROW_ON_FILL, type GrowLaw, type GrowOnFill } from "@/lib/physics/modes/grow";

/*
 * --- loop-foundation --- Grow's "fill and loop" controls, under the classic Grow controls in the Mode row (and in the Ball
 * section while the settings search is in use): the presets, the growth law, what a fill does, the growth per bounce, the
 * start size, the hold and the shrink, colour by size with its ramp of colour stops, the contact markers and their lifetime,
 * and the pluck pitched by size. Simulator.tsx hands the physics to the engine (restarting a Grow run) and the look to the canvas.
 */

export interface GrowFillSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (the Grow block's, with the classic controls' – EscapeModeSection.tsx). */
export const GROW_FILL_KEYS = ["growPresets", "growLaw", "growOnFill", "growStep", "growStart", "growHold", "growShrink", "growHue", "growRamp", "growMarkers", "growMarkerLife", "growPitch"];

const LAW_LABELS: Record<GrowLaw, string> = { approach: "growLawApproach", multiply: "growLawMultiply", add: "growLawAdd" };
const FILL_LABELS: Record<GrowOnFill, string> = { stay: "growFillStay", loop: "growFillLoop", finish: "growFillFinish" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

export default function GrowFillSection({ t, search, matches, settings: s, update }: GrowFillSectionProps) {
  const lawId = useId();
  const fillId = useId();
  const applyPreset = (id: GrowFillPreset["id"]) => {
    const { fields, look } = growFillPresetFields(id);
    update(look === "loop" ? { ...fields, ...FILL_LOOP_LOOK, backgroundColors: [...FILL_LOOP_LOOK.backgroundColors] } : fields);
  };
  const newLaw = s.growLaw !== "approach";
  const loops = s.growOnFill === "loop";
  const ramp = parseRamp(s.growRamp);
  const setRamp = (stops: string[]) => update({ growRamp: serializeRamp(stops) });
  return (
    <div className="space-y-3 pt-2 border-t border-line/60" data-testid="grow-fill-section" data-grow-law={s.growLaw} data-grow-fill={s.growOnFill}>
      <Searchable search={search} matches={matches} labelKey="growPresets">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("growPresets")}
            <Tooltip text={t("growPresetsTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {GROW_FILL_PRESETS.map((preset) => (
              <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)} className={pick(false)} data-grow-preset={preset.id}>
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="growLaw">
        <div className="space-y-1.5">
          <label htmlFor={lawId} className="text-sm font-medium text-ink-2 flex items-center">
            {t("growLaw")}
            <Tooltip text={t("growLawTip")} />
          </label>
          <select id={lawId} value={s.growLaw} onChange={(e) => update({ growLaw: e.target.value as GrowLaw })} className={`${selectClass} text-sm`} data-testid="grow-law">
            {GROW_LAWS.map((law) => (
              <option key={law} value={law}>
                {t(LAW_LABELS[law])}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="growOnFill">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            <span id={fillId}>{t("growOnFill")}</span>
            <Tooltip text={t("growOnFillTip")} />
          </span>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby={fillId}>
            {GROW_ON_FILL.map((fill) => (
              <button key={fill} type="button" onClick={() => update({ growOnFill: fill })} aria-pressed={s.growOnFill === fill} className={pick(s.growOnFill === fill)} data-grow-on-fill={fill}>
                {t(FILL_LABELS[fill])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {(newLaw || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="growStep" tipKey="growStepTip" value={s.growStep} range={RANGES.growStep} onChange={(v) => update({ growStep: v })} display={s.growLaw === "add" ? `${s.growStep} px` : `${s.growStep}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="growStart" tipKey="growStartTip" value={s.growStart} range={RANGES.growStart} onChange={(v) => update({ growStart: v })} display={`${s.growStart}%`} />
        </>
      )}
      {(loops || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="growHold" tipKey="growHoldTip" value={s.growHold} range={RANGES.growHold} onChange={(v) => update({ growHold: v })} display={`${s.growHold}s`} />
          <Slider t={t} search={search} matches={matches} labelKey="growShrink" tipKey="growShrinkTip" value={s.growShrink} range={RANGES.growShrink} onChange={(v) => update({ growShrink: v })} display={`${s.growShrink}s`} />
        </>
      )}
      <Searchable search={search} matches={matches} labelKey="growHue">
        <Toggle t={t} labelKey="growHue" tipKey="growHueTip" value={s.growHue} onChange={(v) => update({ growHue: v })} />
      </Searchable>
      {(s.growHue || !!search) && (
        <Searchable search={search} matches={matches} labelKey="growRamp">
          <div className="space-y-1.5" data-testid="grow-ramp">
            <span className="text-sm font-medium text-ink-2 flex items-center">
              {t("growRamp")}
              <Tooltip text={t("growRampTip")} />
            </span>
            <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${ramp.join(", ")})` }} aria-hidden="true" />
            <div className="grid grid-cols-3 gap-1.5">
              {ramp.map((stop, i) => (
                <div key={i} className="flex items-center gap-1">
                  <ColorPicker value={stop} onChange={(v) => setRamp(ramp.map((c, j) => (j === i ? v : c)))} label={t("growRampStop", { n: i + 1 })} />
                  {ramp.length > 2 && (
                    <button type="button" onClick={() => setRamp(ramp.filter((_, j) => j !== i))} className="text-xs text-ink-3 hover:text-ink cursor-pointer px-1" aria-label={t("growRampRemove", { n: i + 1 })}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {ramp.length < MAX_RAMP_STOPS && (
              <button type="button" onClick={() => setRamp([...ramp, ramp[ramp.length - 1]])} className={pick(false)}>
                {t("growRampAdd")}
              </button>
            )}
          </div>
        </Searchable>
      )}
      <Searchable search={search} matches={matches} labelKey="growMarkers">
        <Toggle t={t} labelKey="growMarkers" tipKey="growMarkersTip" value={s.growMarkers} onChange={(v) => update({ growMarkers: v })} />
      </Searchable>
      {(s.growMarkers || !!search) && <Slider t={t} search={search} matches={matches} labelKey="growMarkerLife" tipKey="growMarkerLifeTip" value={s.growMarkerLife} range={RANGES.growMarkerLife} onChange={(v) => update({ growMarkerLife: v })} display={`${s.growMarkerLife}s`} />}
      <Searchable search={search} matches={matches} labelKey="growPitch">
        <Toggle t={t} labelKey="growPitch" tipKey="growPitchTip" value={s.growPitch} onChange={(v) => update({ growPitch: v })} />
      </Searchable>
    </div>
  );
}
