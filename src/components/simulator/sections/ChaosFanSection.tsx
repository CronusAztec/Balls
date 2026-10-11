"use client";

import { useId } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { CHAOS_FAN_LOOK, CHAOS_FAN_PRESETS, CHAOS_FAN_RIG, DP_COLOUR_BY, chaosFanClipSec, chaosFanCycleSec, chaosFanPresetFields, type ChaosFanPreset, type DpColourBy } from "@/lib/physics/chaosFan";
import { memoryCeiling } from "@/lib/uncap";

/*
 * --- chaos-fan --- The chaos fan block of the Double Pendulum (rendered at the top of DoublePendulumSection, in the Mode row and
 * in the Ball section while the settings search is in use): the switch, the three presets, and – with the fan on – the pendulum
 * count, the total start spread (with quick picks from a millionth to a tenth of a degree), the colours, the palindrome and its
 * forward run, and the split measure. Simulator.tsx hands them to the engine (restarting a Double Pendulum run).
 */

export interface ChaosFanSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (DOUBLE_PENDULUM_KEYS spreads them: SECTION_KEYS.ball and MODE_BLOCK_KEYS). */
export const CHAOS_FAN_KEYS = ["dpFan", "dpFanPresets", "dpFanCount", "dpSpreadDeg", "dpColourBy", "dpPalindrome", "dpForwardSec", "dpDivergePx"];

/** The spread's quick picks (degrees): a millionth, a ten-thousandth, a thousandth, a hundredth and a tenth. */
export const SPREAD_PICKS = [0.000001, 0.0001, 0.001, 0.01, 0.1] as const;

const COLOUR_LABELS: Record<DpColourBy, string> = { index: "dpColourByIndex", single: "dpColourBySingle" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A spread in degrees as the panel shows it: plain decimals down to a millionth ("0.001°"), exponent notation below. */
export function formatSpreadDeg(deg: number): string {
  if (!Number.isFinite(deg)) return "–";
  if (deg === 0) return "0°";
  if (Math.abs(deg) < 1e-6) return `${deg.toExponential(1)}°`;
  const decimals = Math.min(8, Math.max(0, -Math.floor(Math.log10(Math.abs(deg))) + 2));
  const text = Number(deg.toPrecision(3)).toFixed(decimals);
  return `${text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text}°`;
}

export default function ChaosFanSection({ t, search, matches, settings: s, update }: ChaosFanSectionProps) {
  const coloursId = useId();
  const spreadId = useId();
  const on = s.dpFan || !!search;
  // a preset brings the fan, its rig, the clip's look and a clip of one whole loop (Export whole loops cuts it on the seam)
  const applyPreset = (id: ChaosFanPreset["id"]) => {
    const fields = chaosFanPresetFields(id);
    update({ ...fields, ...CHAOS_FAN_RIG, ...CHAOS_FAN_LOOK, backgroundColors: [...CHAOS_FAN_LOOK.backgroundColors], recordingDuration: Math.max(RANGES.recordingDuration.min, chaosFanClipSec(fields)) });
  };
  const built = memoryCeiling("dpFanCount", s.dpFanCount);
  return (
    <div className="space-y-3 pt-1" data-testid="chaos-fan-section" data-dp-fan-on={s.dpFan ? "1" : "0"} data-dp-fan-palindrome={s.dpPalindrome ? "1" : "0"} data-dp-fan-colours={s.dpColourBy}>
      <Searchable search={search} matches={matches} labelKey="dpFan">
        <div className="space-y-1">
          <Toggle t={t} labelKey="dpFan" tipKey="dpFanTip" value={s.dpFan} onChange={(v) => update({ dpFan: v })} />
          {!search && s.dpFan && <p className="text-xs text-ink-3 leading-relaxed">{t("dpFanDesc")}</p>}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="dpFanPresets">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("dpFanPresets")}
            <Tooltip text={t("dpFanPresetsTip")} />
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {CHAOS_FAN_PRESETS.map((preset) => (
              <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)} className={pick(false)} data-dp-fan-preset={preset.id}>
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      {on && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="dpFanCount" tipKey="dpFanCountTip" value={s.dpFanCount} range={RANGES.dpFanCount} onChange={(v) => update({ dpFanCount: v })} display={built < s.dpFanCount ? `${built} / ${s.dpFanCount}` : String(s.dpFanCount)} />
          <Searchable search={search} matches={matches} labelKey="dpSpreadDeg">
            <div className="space-y-1.5">
              <Slider t={t} search="" matches={matches} labelKey="dpSpreadDeg" tipKey="dpSpreadDegTip" value={s.dpSpreadDeg} range={RANGES.dpSpreadDeg} onChange={(v) => update({ dpSpreadDeg: v })} display={formatSpreadDeg(s.dpSpreadDeg)} />
              <div className="grid grid-cols-5 gap-1" role="group" aria-labelledby={spreadId}>
                <span id={spreadId} className="sr-only">
                  {t("dpSpreadPicks")}
                </span>
                {SPREAD_PICKS.map((deg) => (
                  <button key={deg} type="button" onClick={() => update({ dpSpreadDeg: deg })} aria-pressed={s.dpSpreadDeg === deg} className={pick(s.dpSpreadDeg === deg)} data-dp-spread-pick={deg}>
                    {formatSpreadDeg(deg)}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="dpColourBy">
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink-2 flex items-center">
                <span id={coloursId}>{t("dpColourBy")}</span>
                <Tooltip text={t("dpColourByTip")} />
              </span>
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-labelledby={coloursId}>
                {DP_COLOUR_BY.map((c) => (
                  <button key={c} type="button" onClick={() => update({ dpColourBy: c })} aria-pressed={s.dpColourBy === c} className={pick(s.dpColourBy === c)} data-dp-colour-by={c}>
                    {t(COLOUR_LABELS[c])}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="dpPalindrome">
            <div className="space-y-1">
              <Toggle t={t} labelKey="dpPalindrome" tipKey="dpPalindromeTip" value={s.dpPalindrome} onChange={(v) => update({ dpPalindrome: v })} />
              {!search && (
                <p className="text-xs text-ink-3" data-testid="dp-fan-loop">
                  {s.dpPalindrome ? t("dpFanLoopLine", { cycle: Number(chaosFanCycleSec(s.dpForwardSec).toFixed(2)), forward: Number((chaosFanCycleSec(s.dpForwardSec) / 2).toFixed(2)) }) : t("dpFanForwardOnly")}
                </p>
              )}
            </div>
          </Searchable>
          {(s.dpPalindrome || !!search) && <Slider t={t} search={search} matches={matches} labelKey="dpForwardSec" tipKey="dpForwardSecTip" value={s.dpForwardSec} range={RANGES.dpForwardSec} onChange={(v) => update({ dpForwardSec: v })} display={`${s.dpForwardSec}s`} />}
          <Slider t={t} search={search} matches={matches} labelKey="dpDivergePx" tipKey="dpDivergePxTip" value={s.dpDivergePx} range={RANGES.dpDivergePx} onChange={(v) => update({ dpDivergePx: v })} display={`${s.dpDivergePx} px`} />
        </>
      )}
    </div>
  );
}
