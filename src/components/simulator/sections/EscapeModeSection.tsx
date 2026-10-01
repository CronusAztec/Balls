"use client";

import { ColorPicker, Searchable, Slider, Toggle, offBtn, rainbowBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import type { ModeId } from "@/lib/physics/types";

export interface EscapeModeSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/**
 * Search keys of the controls rendered here, per mode. Controls.tsx matches the Ball section on the current mode's
 * keys only (so a search for "Spikes" in Classic still says "no results").
 */
export const ESCAPE_MODE_KEYS_BY_MODE: Partial<Record<ModeId, string[]>> = {
  accumulation: ["accumulationEscape", "spikes", "spikeCount"],
  multiply: ["spawnCount"],
  lines: ["lineColor", "centerDot"],
  target: ["targetCount", "randomOrder"],
  colorMatch: ["colorCount"],
  grow: ["growthRate", "centerDot", "growLines", "lineColor"],
};

/** Every search key of the escape-mode blocks. */
export const ESCAPE_MODE_KEYS = [...new Set(Object.values(ESCAPE_MODE_KEYS_BY_MODE).flat())];

/**
 * The Mode-row controls of the six escape modes (Accumulation, Multiply, Lines, Target, Color Match, Grow). They
 * show in the Mode row while the mode is active, and in the Ball section while the settings search is in use.
 */
export default function EscapeModeSection({ t, search, matches, settings: s, update }: EscapeModeSectionProps) {
  const lineColor = (
    <Searchable search={search} matches={matches} labelKey="lineColor">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-300">{t("lineColor")}</span>
          <button type="button" onClick={() => update({ rainbowLines: !s.rainbowLines })} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowLines ? rainbowBtn : offBtn}`}>
            {t("rainbowSettings")}
          </button>
        </div>
        {!s.rainbowLines && <ColorPicker value={s.lineColor} onChange={(v) => update({ lineColor: v })} label={t("lineColor")} />}
      </div>
    </Searchable>
  );
  switch (s.mode) {
    case "accumulation":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="accumulationEscape" tipKey="accumulationEscapeTip" value={s.accumulationTime} range={RANGES.accumulationTime} onChange={(v) => update({ accumulationTime: v })} display={`${s.accumulationTime}s`} />
          <Searchable search={search} matches={matches} labelKey="spikes">
            <Toggle t={t} labelKey="spikes" tipKey="spikesTip" value={s.spikesEnabled} onChange={(v) => update({ spikesEnabled: v })} onClass="bg-red-600 text-white" />
          </Searchable>
          {(s.spikesEnabled || !!search) && (
            <Slider t={t} search={search} matches={matches} labelKey="spikeCount" tipKey="spikeCountTip" value={s.spikeCount} range={RANGES.spikeCount} onChange={(v) => update({ spikeCount: v })} />
          )}
        </div>
      );
    case "multiply":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="spawnCount" tipKey="spawnCountTip" value={s.multiplySpawnCount} range={RANGES.multiplySpawnCount} onChange={(v) => update({ multiplySpawnCount: v })} />
        </div>
      );
    case "lines":
      return (
        <div className="space-y-3 pt-2">
          {lineColor}
          <Searchable search={search} matches={matches} labelKey="centerDot">
            <div className={search ? "" : "pt-2 border-t border-zinc-800/60"}>
              <Toggle t={t} labelKey="centerDot" tipKey="centerDotTip" value={s.linesCenterDot} onChange={(v) => update({ linesCenterDot: v })} />
            </div>
          </Searchable>
        </div>
      );
    case "target":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="targetCount" tipKey="targetCountTip" value={s.targetCount} range={RANGES.targetCount} onChange={(v) => update({ targetCount: v })} />
          <Searchable search={search} matches={matches} labelKey="randomOrder">
            <Toggle t={t} labelKey="randomOrder" tipKey="randomOrderTip" value={s.countdownRandom} onChange={(v) => update({ countdownRandom: v })} onClass="bg-yellow-600 text-white" />
          </Searchable>
        </div>
      );
    case "colorMatch":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="colorCount" tipKey="colorCountTip" value={s.colorMatchColorCount} range={RANGES.colorMatchColorCount} onChange={(v) => update({ colorMatchColorCount: v })} />
        </div>
      );
    case "grow":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="growthRate" tipKey="growthRateTip" value={s.growRate} range={RANGES.growRate} onChange={(v) => update({ growRate: v })} display={`${s.growRate}%`} />
          <Searchable search={search} matches={matches} labelKey="centerDot">
            <Toggle t={t} labelKey="centerDot" tipKey="centerDotTip" value={s.growCenterDot} onChange={(v) => update({ growCenterDot: v })} />
          </Searchable>
          <Searchable search={search} matches={matches} labelKey="growLines">
            <Toggle t={t} labelKey="growLines" tipKey="growLinesTip" value={s.growLines} onChange={(v) => update({ growLines: v })} />
          </Searchable>
          {(s.growLines || !!search) && lineColor}
        </div>
      );
    default:
      return null;
  }
}
