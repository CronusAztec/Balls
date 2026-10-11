"use client";

import { useId } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { HOOPS_LOOK, HOOPS_PRESETS, hoopsClipSec, hoopsPresetFields, hoopsSettingsOf, type HoopsPreset } from "@/lib/physics/hoopsFields";
import { HOOPS_RAMP_SHAPES, criticalTurns, hoopRadii, type HoopsRampShape } from "@/lib/physics/modes/hoops";
import { memoryCeiling } from "@/lib/uncap";

/*
 * --- bead-hoops --- The Spinning Hoops block of the Mode row (and of the Ball section while the settings search is in use): the
 * presets, the hoops (count, outer and inner radius), gravity, the spin (start and top speed, the ramp and its shape, the top
 * hold, the return and its length), the beads (damping, the axis' tilt) and the two sound switches, with a line naming the
 * spins the beads lift at. Simulator.tsx hands them to the engine (restarting a Spinning Hoops run).
 */

export interface HoopsSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (MODE_BLOCK_KEYS of panelKeys.ts: offered in Spinning Hoops only). */
export const HOOPS_KEYS = ["hpPresets", "hpCount", "hpRadiusMax", "hpRadiusMin", "hpGravity", "hpOmegaStart", "hpOmegaEnd", "hpRamp", "hpRampShape", "hpHold", "hpReturn", "hpReturnSec", "hpDamping", "hpJitter", "hpTick", "hpBed"];

const SHAPE_LABELS: Record<HoopsRampShape, string> = { linear: "hpShapeLinear", ease: "hpShapeEase", steps: "hpShapeSteps" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** The spins (turns a second) the outer and the inner bead lift past, and how many beads the fastest spin never lifts. */
export function hoopsLiftRange(s: SimulatorSettings): { outer: number; inner: number; never: number; count: number } {
  const h = hoopsSettingsOf(s);
  const count = Math.max(1, memoryCeiling("hpCount", h.count));
  const radii = hoopRadii(count, h.radiusMax, h.radiusMin);
  const top = Math.max(h.omegaStart, h.omegaEnd);
  let never = 0;
  for (let i = 0; i < count; i++) if (!(criticalTurns(h.gravity, radii[i]) < top)) never++;
  return { outer: criticalTurns(h.gravity, Math.max(h.radiusMax, h.radiusMin)), inner: criticalTurns(h.gravity, Math.min(h.radiusMax, h.radiusMin)), never, count };
}

export default function HoopsSection({ t, search, matches, settings: s, update }: HoopsSectionProps) {
  const shapeId = useId();
  // a preset brings the clip's look and a clip of one whole cycle (Export whole loops cuts it on the seam)
  const applyPreset = (id: HoopsPreset["id"]) => {
    const fields = hoopsPresetFields(id);
    update({ ...fields, ...HOOPS_LOOK, backgroundColors: [...HOOPS_LOOK.backgroundColors], recordingDuration: Math.max(RANGES.recordingDuration.min, hoopsClipSec(fields)) });
  };
  const turns = (v: number) => `${v.toFixed(2)} ${t("hpTurnsUnit")}`;
  const lift = hoopsLiftRange(s);
  return (
    <div className="space-y-3 pt-2" data-testid="hoops-section" data-hoops-shape={s.hpRampShape} data-hoops-return={s.hpReturn ? "1" : "0"}>
      <Searchable search={search} matches={matches} labelKey="hpPresets">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("hpPresets")}
            <Tooltip text={t("hpPresetsTip")} />
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {HOOPS_PRESETS.map((preset) => (
              <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)} className={pick(false)} data-hoops-preset={preset.id}>
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="hpCount" tipKey="hpCountTip" value={s.hpCount} range={RANGES.hpCount} onChange={(v) => update({ hpCount: v })} />
      <Slider t={t} search={search} matches={matches} labelKey="hpRadiusMax" tipKey="hpRadiusMaxTip" value={s.hpRadiusMax} range={RANGES.hpRadiusMax} onChange={(v) => update({ hpRadiusMax: v })} display={s.hpRadiusMax.toFixed(2)} />
      {(s.hpCount > 1 || !!search) && <Slider t={t} search={search} matches={matches} labelKey="hpRadiusMin" tipKey="hpRadiusMinTip" value={s.hpRadiusMin} range={RANGES.hpRadiusMin} onChange={(v) => update({ hpRadiusMin: v })} display={s.hpRadiusMin.toFixed(2)} />}
      <Slider t={t} search={search} matches={matches} labelKey="hpOmegaStart" tipKey="hpOmegaStartTip" value={s.hpOmegaStart} range={RANGES.hpOmegaStart} onChange={(v) => update({ hpOmegaStart: v })} display={turns(s.hpOmegaStart)} />
      <Slider t={t} search={search} matches={matches} labelKey="hpOmegaEnd" tipKey="hpOmegaEndTip" value={s.hpOmegaEnd} range={RANGES.hpOmegaEnd} onChange={(v) => update({ hpOmegaEnd: v })} display={turns(s.hpOmegaEnd)} />
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="hoops-lift-range" data-hoops-never={lift.never}>
          {lift.count === 1 ? t("hpCriticalOne", { outer: lift.outer.toFixed(2) }) : t("hpCritical", { outer: lift.outer.toFixed(2), inner: lift.inner.toFixed(2) })}
          {lift.never > 0 && <span className="text-warn"> {t("hpNeverLifts", { count: lift.never })}</span>}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="hpRamp" tipKey="hpRampTip" value={s.hpRamp} range={RANGES.hpRamp} onChange={(v) => update({ hpRamp: v })} display={`${s.hpRamp}s`} />
      <Searchable search={search} matches={matches} labelKey="hpRampShape">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            <span id={shapeId}>{t("hpRampShape")}</span>
            <Tooltip text={t("hpRampShapeTip")} />
          </span>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby={shapeId}>
            {HOOPS_RAMP_SHAPES.map((shape) => (
              <button key={shape} type="button" onClick={() => update({ hpRampShape: shape })} aria-pressed={s.hpRampShape === shape} className={pick(s.hpRampShape === shape)} data-hoops-ramp-shape={shape}>
                {t(SHAPE_LABELS[shape])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="hpHold" tipKey="hpHoldTip" value={s.hpHold} range={RANGES.hpHold} onChange={(v) => update({ hpHold: v })} display={`${s.hpHold}s`} />
      <Searchable search={search} matches={matches} labelKey="hpReturn">
        <Toggle t={t} labelKey="hpReturn" tipKey="hpReturnTip" value={s.hpReturn} onChange={(v) => update({ hpReturn: v })} />
      </Searchable>
      {(s.hpReturn || !!search) && <Slider t={t} search={search} matches={matches} labelKey="hpReturnSec" tipKey="hpReturnSecTip" value={s.hpReturnSec} range={RANGES.hpReturnSec} onChange={(v) => update({ hpReturnSec: v })} display={`${s.hpReturnSec}s`} />}
      <Slider t={t} search={search} matches={matches} labelKey="hpGravity" tipKey="hpGravityTip" value={s.hpGravity} range={RANGES.hpGravity} onChange={(v) => update({ hpGravity: v })} display={`${s.hpGravity} m/s²`} />
      <Slider t={t} search={search} matches={matches} labelKey="hpDamping" tipKey="hpDampingTip" value={s.hpDamping} range={RANGES.hpDamping} onChange={(v) => update({ hpDamping: v })} />
      <Slider t={t} search={search} matches={matches} labelKey="hpJitter" tipKey="hpJitterTip" value={s.hpJitter} range={RANGES.hpJitter} onChange={(v) => update({ hpJitter: v })} display={`${s.hpJitter} rad`} />
      <Searchable search={search} matches={matches} labelKey="hpTick">
        <Toggle t={t} labelKey="hpTick" tipKey="hpTickTip" value={s.hpTick} onChange={(v) => update({ hpTick: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="hpBed">
        <Toggle t={t} labelKey="hpBed" tipKey="hpBedTip" value={s.hpBed} onChange={(v) => update({ hpBed: v })} />
      </Searchable>
    </div>
  );
}
