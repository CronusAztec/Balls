"use client";

import Tooltip from "../Tooltip";
import NumberField from "../NumberField"; // --- review fix (uncap-all) ---
import { Searchable, Slider, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { MULTIPLIER_COLORS } from "@/lib/physics/multipliers";
import { GATE_KINDS, GATE_WEIGHT_RANGE, DEFAULT_GATE_MIX, formatGateMix, gateMixWeights, sanitizeGateMix, type GateKind } from "@/lib/physics/modes/multipliers";
import { formatCompact } from "@/lib/uncap";

export interface MultipliersModeSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const MULTIPLIERS_MODE_KEYS = ["mpRows", "mpStartBalls", "mpMaxBalls", "mpGateMix", "mpTarget"];

const GATE_OPTIONS: Record<GateKind, { labelKey: string; color: string }> = {
  count: { labelKey: "gateCount", color: MULTIPLIER_COLORS.balls },
  speed: { labelKey: "gateSpeed", color: MULTIPLIER_COLORS.speed },
  size: { labelKey: "gateSize", color: MULTIPLIER_COLORS.size },
  damage: { labelKey: "gateDamage", color: MULTIPLIER_COLORS.damage },
  reverse: { labelKey: "gateReverse", color: MULTIPLIER_COLORS.reverse },
  release: { labelKey: "gateRelease", color: MULTIPLIER_COLORS.release },
};

/**
 * "Multipliers board" controls of the multipliers mode, shown in the Mode row while the mode is active (and in the Ball
 * section while the settings search is in use): rows of gates, balls at the start, the ball cap, the weight of every gate
 * kind and the count target the seed finder rigs a run for. Simulator.tsx forwards them to the engine (see
 * lib/physics/modes/multipliers.ts) and restarts the board when one of them changes (the target only matters to the finder).
 */
export default function MultipliersModeSection({ t, search, matches, settings: s, update }: MultipliersModeSectionProps) {
  // --- review fix (uncap-all) --- every weight is a number ≥ 0 with no maximum: the slider covers 0–9 (its comfort range,
  // pinned at its end beyond it), the number field next to it takes any weight (0.5, 40, 1e6). The mix is stored
  // comma-separated (URL mpgm=5,3,2,1,0,1); a mix without any weight falls back to the default, as before.
  const weights = gateMixWeights(s.mpGateMix) ?? (gateMixWeights(DEFAULT_GATE_MIX) as number[]);
  const setWeight = (index: number, weight: number) => {
    const next = weights.map((w, i) => (i === index ? Math.max(0, weight) : w));
    update({ mpGateMix: sanitizeGateMix(formatGateMix(next)) });
  };
  return (
    <div className="space-y-3 pt-2" data-testid="multipliers-board">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("mpBoardTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("mpBoardDesc")}</p>
        </div>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="mpRows" tipKey="mpRowsTip" value={s.mpRows} range={RANGES.mpRows} onChange={(v) => update({ mpRows: v })} />
      <Slider t={t} search={search} matches={matches} labelKey="mpStartBalls" tipKey="mpStartBallsTip" value={s.mpStartBalls} range={RANGES.mpStartBalls} onChange={(v) => update({ mpStartBalls: v })} />
      <Slider t={t} search={search} matches={matches} labelKey="mpMaxBalls" tipKey="mpMaxBallsTip" value={s.mpMaxBalls} range={RANGES.mpMaxBalls} onChange={(v) => update({ mpMaxBalls: v })} />
      <Searchable search={search} matches={matches} labelKey="mpGateMix">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("mpGateMix")}
            <Tooltip text={t("mpGateMixTip")} />
          </label>
          <div className="grid grid-cols-1 gap-y-1.5">
            {GATE_KINDS.map((kind, i) => {
              const weight = weights[i];
              const label = t(GATE_OPTIONS[kind].labelKey);
              const beyond = weight > GATE_WEIGHT_RANGE.max;
              return (
                <div key={kind} className="flex items-center gap-2 text-xs font-bold" style={{ color: GATE_OPTIONS[kind].color }} data-gate-weight={kind}>
                  <span className="w-20 shrink-0 truncate" title={beyond ? formatCompact(weight) : undefined}>
                    {label}
                  </span>
                  <input
                    type="range"
                    min={GATE_WEIGHT_RANGE.min}
                    max={GATE_WEIGHT_RANGE.max}
                    step={GATE_WEIGHT_RANGE.step}
                    value={weight /* (past 9 the track pins at its end, like every slider's; the field shows the weight) */}
                    onChange={(e) => setWeight(i, Number(e.target.value))}
                    aria-label={label}
                    className={`flex-1 h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer ${beyond ? "ring-1 ring-warn/40" : ""}`}
                    style={sliderStyle(weight, GATE_WEIGHT_RANGE.min, GATE_WEIGHT_RANGE.max)}
                  />
                  <NumberField value={weight} onCommit={(v) => setWeight(i, v)} label={label} range={GATE_WEIGHT_RANGE} rules={{ min: 0 }} settingKey={`mpGateMix:${kind}`} className="w-16 font-normal" />
                </div>
              );
            })}
          </div>
        </div>
      </Searchable>
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="mpTarget"
        tipKey="mpTargetTip"
        value={s.mpTarget}
        range={RANGES.mpTarget}
        onChange={(v) => update({ mpTarget: v })}
        display={s.mpTarget === 0 ? t("mpTargetOff") : t("mpTargetValue", { count: s.mpTarget })}
      />
    </div>
  );
}
