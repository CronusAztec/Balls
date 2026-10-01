"use client";

/*
 * --- unlimited --- The panel side of No limits: while the switch is on, every slider of an unlimited setting (found by
 * its range object – the panel passes `RANGES.<key>` – so no call site changes) becomes a two-part slider: linear across
 * its normal range, logarithmic above it up to 1B, plus a number input that takes any typed value. A value past what the
 * engine runs of that setting says so under the slider ("runs at 1K").
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { RANGES, unlimitedSettingKeys } from "@/lib/settings";
import { LINEAR_SPAN, SLIDER_SPAN, formatHuge, parseUnlimitedValue, sliderPosition, sliderValue, softCeiling, type NumericRange } from "@/lib/unlimited";
import { ACCENT, ACCENT_LIGHT } from "@/lib/site";

/** Whether No limits is on for the panel (Controls.tsx provides it). */
export const UnlimitedContext = createContext(false);

export function UnlimitedProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <UnlimitedContext.Provider value={on}>{children}</UnlimitedContext.Provider>;
}

/** Range object → the unlimited setting it belongs to (computed once). */
let rangeKeys: Map<object, string> | null = null;
function keyOfRange(range: object): string | undefined {
  if (!rangeKeys) {
    rangeKeys = new Map();
    const ranges = RANGES as unknown as Record<string, object>;
    for (const key of unlimitedSettingKeys()) if (ranges[key]) rangeKeys.set(ranges[key], key);
  }
  return rangeKeys.get(range);
}

/** The unlimited setting behind a slider's range while the switch is on, else null (the slider stays as it is). */
export function useUnlimitedKey(range: object): string | null {
  const on = useContext(UnlimitedContext);
  return on ? (keyOfRange(range) ?? null) : null;
}

/** The track: lime up to the thumb, a warmer tint over the part above the normal range. */
function trackStyle(pos: number) {
  const pct = (pos / SLIDER_SPAN) * 100;
  const normal = (LINEAR_SPAN / SLIDER_SPAN) * 100;
  const fill = pos > LINEAR_SPAN ? `${ACCENT_LIGHT} 0%, ${ACCENT} ${normal}%, #f59e0b ${pct}%` : `${ACCENT_LIGHT} 0%, ${ACCENT} ${pct}%`;
  return {
    background: `linear-gradient(to right, ${fill}, #27272a ${pct}%, #27272a ${normal}%, #3f2a12 ${normal}%, #3f2a12 100%)`,
    accentColor: ACCENT,
  };
}

export interface UnlimitedSliderProps {
  settingKey: string;
  label: string;
  tip?: string;
  value: number;
  range: NumericRange;
  onChange: (v: number) => void;
  display?: string;
  left?: string;
  right?: string;
  disabled?: boolean;
}

/** The No limits slider: the normal range, a logarithmic extension up to 1B and a number input for any value. */
export function UnlimitedSlider({ settingKey, label, tip, value, range, onChange, display, left, right, disabled }: UnlimitedSliderProps) {
  const t = useTranslations("Unlimited");
  const [typed, setTyped] = useState<string | null>(null);
  const pos = useMemo(() => sliderPosition(settingKey, value, range), [settingKey, value, range]);
  const ceiling = softCeiling(settingKey, range);
  const invalid = typed !== null && parseUnlimitedValue(settingKey, typed, range) === null;
  const beyond = value > range.max || value < range.min;
  return (
    <div className="space-y-2" data-unlimited-slider={settingKey}>
      <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
        <span>
          {label}
          {tip && <Tooltip text={tip} />}
        </span>
        <span className={beyond ? "text-amber-400 font-semibold" : "text-zinc-500"}>{beyond ? formatHuge(value) : (display ?? value)}</span>
      </label>
      <div className="flex items-center gap-2">
        {left && <span className="text-sm">{left}</span>}
        <input
          type="range"
          min={0}
          max={SLIDER_SPAN}
          step={1}
          value={pos}
          disabled={disabled}
          onChange={(e) => {
            setTyped(null);
            onChange(sliderValue(settingKey, Number(e.target.value), range));
          }}
          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
          style={trackStyle(pos)}
          aria-label={label}
        />
        {right && <span className="text-sm">{right}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={typed ?? String(value)}
          disabled={disabled}
          onChange={(e) => {
            setTyped(e.target.value);
            const v = parseUnlimitedValue(settingKey, e.target.value, range);
            if (v !== null) onChange(v);
          }}
          onBlur={() => setTyped(null)}
          aria-label={t("typeValue", { label })}
          aria-invalid={invalid}
          className={`w-24 shrink-0 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md border ${invalid ? "border-rose-500" : "border-zinc-700"} focus:border-cyan-600 focus:outline-none`}
          data-unlimited-input={settingKey}
        />
      </div>
      {invalid && <p className="text-xs text-rose-400">{t("invalidValue", { min: formatHuge(range.min) })}</p>}
      {!invalid && value > ceiling && <p className="text-xs text-amber-400/90">{t("softCeiling", { value: formatHuge(ceiling) })}</p>}
    </div>
  );
}
