"use client";

import { ColorPicker, Searchable, Slider, Toggle, offBtn, onBtn, rainbowBtn, type Matcher, type Translate } from "../ControlPrimitives";
import Tooltip from "../Tooltip";
import { COLOR_MATCH_SEGMENT_CHOICES } from "@/lib/physics/modes/colorMatch"; // --- colour-match-segments ---
import { SHATTER_HIT_CHOICES, SHATTER_SEGMENT_CHOICES } from "@/lib/physics/modes/shatter"; // --- shatter-demolition ---
import { PORTAL_COUNT_CHOICES, PORTAL_USES_CHOICES } from "@/lib/physics/modes/portal"; // --- portal-options ---
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import type { ModeId } from "@/lib/physics/types";
import GrowFillSection, { GROW_FILL_KEYS } from "./GrowFillSection"; // --- loop-foundation ---

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
  multiply: ["spawnCount", "swarmRace" /* --- multiply-race --- */],
  lines: ["lineColor", "centerDot", "lnStrings" /* --- string-art --- */],
  target: ["targetCount", "randomOrder"],
  colorMatch: ["colorCount", "segmentCount"],
  shatter: ["shatterHits", "shatterSegments"], // --- shatter-demolition ---
  portal: ["ptCount", "ptUses"], // --- portal-options ---
  grow: ["growthRate", "centerDot", "growLines", "lineColor"],
};
ESCAPE_MODE_KEYS_BY_MODE.grow?.push(...GROW_FILL_KEYS); // --- loop-foundation --- (Grow's fill and loop)

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
          <span className="text-sm font-medium text-ink-2">{t("lineColor")}</span>
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
            <Toggle t={t} labelKey="spikes" tipKey="spikesTip" value={s.spikesEnabled} onChange={(v) => update({ spikesEnabled: v })} onClass="bg-danger text-ink" />
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
          {/* --- multiply-race --- the aimed start ball, the swarm's voice and the end at the Swarm Limit */}
          <Searchable search={search} matches={matches} labelKey="swarmRace">
            <Toggle t={t} labelKey="swarmRace" tipKey="swarmRaceTip" value={s.multiplyRace} onChange={(v) => update({ multiplyRace: v })} />
          </Searchable>
        </div>
      );
    case "lines":
      return (
        <div className="space-y-3 pt-2">
          {lineColor}
          <Searchable search={search} matches={matches} labelKey="centerDot">
            <div className={search ? "" : "pt-2 border-t border-line/60"}>
              <Toggle t={t} labelKey="centerDot" tipKey="centerDotTip" value={s.linesCenterDot} onChange={(v) => update({ linesCenterDot: v })} />
            </div>
          </Searchable>
          {/* --- string-art --- the run ends after this many strings with a flash of the finished picture and a chord (0: never) */}
          <Slider t={t} search={search} matches={matches} labelKey="lnStrings" tipKey="lnStringsTip" value={s.lnStrings} range={RANGES.lnStrings} onChange={(v) => update({ lnStrings: v })} display={s.lnStrings === 0 ? t("ilCyclesNever") : String(s.lnStrings)} />
        </div>
      );
    // --- portal-options --- (D3 review) the pairs round the ring and the jumps each holds before it burns out into an exit: picks,
    // as Shatter's are
    case "portal":
      return (
        <div className="space-y-3 pt-2">
          {(
            [
              ["ptCount", PORTAL_COUNT_CHOICES, s.ptCount, (v: number) => update({ ptCount: v })],
              ["ptUses", PORTAL_USES_CHOICES, s.ptUses, (v: number) => update({ ptUses: v })],
            ] as const
          ).map(([key, choices, value, pick]) => (
            <Searchable key={key} search={search} matches={matches} labelKey={key}>
              <div className="space-y-2" data-testid={`portal-${key === "ptCount" ? "count" : "uses"}`} data-portal-value={value}>
                <label className="text-sm font-medium text-ink-2">
                  {t(key)}
                  <Tooltip text={t(`${key}Tip`)} />
                </label>
                <div className="grid grid-cols-6 gap-1" role="group" aria-label={t(key)}>
                  {choices.map((count) => (
                    <button type="button" key={count} onClick={() => pick(count)} aria-pressed={value === count} className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${value === count ? onBtn : offBtn}`} data-portal-option={count}>
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            </Searchable>
          ))}
        </div>
      );
    case "target":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="targetCount" tipKey="targetCountTip" value={s.targetCount} range={RANGES.targetCount} onChange={(v) => update({ targetCount: v })} />
          <Searchable search={search} matches={matches} labelKey="randomOrder">
            <Toggle t={t} labelKey="randomOrder" tipKey="randomOrderTip" value={s.countdownRandom} onChange={(v) => update({ countdownRandom: v })} onClass="bg-warn text-ink" />
          </Searchable>
        </div>
      );
    case "colorMatch":
      return (
        <div className="space-y-3 pt-2">
          <Slider t={t} search={search} matches={matches} labelKey="colorCount" tipKey="colorCountTip" value={s.colorMatchColorCount} range={RANGES.colorMatchColorCount} onChange={(v) => update({ colorMatchColorCount: v })} />
          {/* --- colour-match-segments --- the ring's segments: a pick of five counts (the mode holds 6 to 24) */}
          <Searchable search={search} matches={matches} labelKey="segmentCount">
            <div className="space-y-2" data-testid="color-match-segments" data-cm-segments={s.colorMatchSegments}>
              <label className="text-sm font-medium text-ink-2">
                {t("segmentCount")}
                <Tooltip text={t("segmentCountTip")} />
              </label>
              <div className="grid grid-cols-5 gap-1" role="group" aria-label={t("segmentCount")}>
                {COLOR_MATCH_SEGMENT_CHOICES.map((count) => (
                  <button
                    type="button"
                    key={count}
                    onClick={() => update({ colorMatchSegments: count })}
                    aria-pressed={s.colorMatchSegments === count}
                    className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.colorMatchSegments === count ? onBtn : offBtn}`}
                    data-cm-segments-option={count}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
        </div>
      );
    // --- shatter-demolition --- the hits a segment takes and the segments a ring has: two picks (the mode holds 1–5 and 4–36)
    case "shatter":
      return (
        <div className="space-y-3 pt-2">
          {(
            [
              ["shatterHits", SHATTER_HIT_CHOICES, s.shatterHits, (v: number) => update({ shatterHits: v })],
              ["shatterSegments", SHATTER_SEGMENT_CHOICES, s.shatterSegments, (v: number) => update({ shatterSegments: v })],
            ] as const
          ).map(([key, choices, value, pick]) => (
            <Searchable key={key} search={search} matches={matches} labelKey={key}>
              <div className="space-y-2" data-testid={`shatter-${key === "shatterHits" ? "hits" : "segments"}`} data-shatter-value={value}>
                <label className="text-sm font-medium text-ink-2">
                  {t(key)}
                  <Tooltip text={t(`${key}Tip`)} />
                </label>
                <div className="grid grid-cols-5 gap-1" role="group" aria-label={t(key)}>
                  {choices.map((count) => (
                    <button type="button" key={count} onClick={() => pick(count)} aria-pressed={value === count} className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${value === count ? onBtn : offBtn}`} data-shatter-option={count}>
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            </Searchable>
          ))}
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
          <GrowFillSection t={t} search={search} matches={matches} settings={s} update={update} /> {/* --- loop-foundation --- */}
        </div>
      );
    default:
      return null;
  }
}
