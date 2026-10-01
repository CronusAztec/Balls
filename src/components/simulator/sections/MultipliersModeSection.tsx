"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { MULTIPLIER_COLORS } from "@/lib/physics/multipliers";
import { GATE_KINDS, sanitizeGateMix, type GateKind } from "@/lib/physics/modes/multipliers";

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
  const mix = sanitizeGateMix(s.mpGateMix);
  const setWeight = (index: number, weight: number) => {
    const next = mix.slice(0, index) + String(Math.max(0, Math.min(9, Math.round(weight)))) + mix.slice(index + 1);
    update({ mpGateMix: sanitizeGateMix(next) });
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
              const weight = Number(mix[i]);
              return (
                <label key={kind} className="flex items-center gap-2 text-xs font-bold" style={{ color: GATE_OPTIONS[kind].color }}>
                  <span className="w-20 shrink-0 truncate">{t(GATE_OPTIONS[kind].labelKey)}</span>
                  <input
                    type="range"
                    min={0}
                    max={9}
                    step={1}
                    value={weight}
                    onChange={(e) => setWeight(i, Number(e.target.value))}
                    aria-label={t(GATE_OPTIONS[kind].labelKey)}
                    className="flex-1 h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer"
                    style={sliderStyle(weight, 0, 9)}
                  />
                  <span className="w-3 shrink-0 text-right text-ink-2 font-mono">{weight}</span>
                </label>
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
