"use client";

/*
 * --- unlimited --- The panel side of No limits, --- uncap-all --- now the "Wide sliders" switch: every value is uncapped
 * whatever the switch (lib/uncap.ts) and every slider has a number field next to it (NumberField.tsx, rendered by the
 * shared `Slider`). With the switch on, a slider of an uncapped setting (found by its range object – the panel passes
 * `RANGES.<key>` – so no call site changes) gets a wide track: linear across its comfort range, logarithmic above it up
 * to 1B. Off, the track keeps its comfort range and pins at its end for a value beyond it.
 */
import { createContext, useContext, type ReactNode } from "react";
import { RANGES, unlimitedSettingKeys } from "@/lib/settings";
import { LINEAR_SPAN, SLIDER_SPAN, isIntegerRange, sliderPosition, sliderValue, type NumericRange } from "@/lib/unlimited";
import { SIGNED_KEYS, type NumberRules } from "@/lib/uncap";
import { ACCENT, ACCENT_LIGHT } from "@/lib/site";

/** Whether the Wide sliders switch is on for the panel (Controls.tsx provides it). */
export const UnlimitedContext = createContext(false);

export function UnlimitedProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <UnlimitedContext.Provider value={on}>{children}</UnlimitedContext.Provider>;
}

/** Range object → the uncapped setting it belongs to (computed once). */
let rangeKeys: Map<object, string> | null = null;
export function keyOfRange(range: object): string | undefined {
  if (!rangeKeys) {
    rangeKeys = new Map();
    const ranges = RANGES as unknown as Record<string, object>;
    for (const key of unlimitedSettingKeys()) if (ranges[key]) rangeKeys.set(ranges[key], key);
  }
  return rangeKeys.get(range);
}

/** The uncapped setting behind a slider's range while Wide sliders is on, else null (the slider keeps its comfort track). */
export function useUnlimitedKey(range: object): string | null {
  const on = useContext(UnlimitedContext);
  return on ? (keyOfRange(range) ?? null) : null;
}

/** --- uncap-all --- The number field's rules for a slider: the sensible minimum (none for a signed setting) and whole numbers. */
export function rulesForRange(range: NumericRange, key: string | undefined = keyOfRange(range)): NumberRules {
  return { min: key && SIGNED_KEYS.has(key) ? undefined : range.min, integer: isIntegerRange(range) };
}

/** The wide track: lime up to the thumb, a warmer tint over the part above the comfort range. */
function trackStyle(pos: number) {
  const pct = (pos / SLIDER_SPAN) * 100;
  const normal = (LINEAR_SPAN / SLIDER_SPAN) * 100;
  const fill = pos > LINEAR_SPAN ? `${ACCENT_LIGHT} 0%, ${ACCENT} ${normal}%, #f59e0b ${pct}%` : `${ACCENT_LIGHT} 0%, ${ACCENT} ${pct}%`;
  return {
    background: `linear-gradient(to right, ${fill}, #27272a ${pct}%, #27272a ${normal}%, #3f2a12 ${normal}%, #3f2a12 100%)`,
    accentColor: ACCENT,
  };
}

export interface WideTrackProps {
  settingKey: string;
  label: string;
  value: number;
  range: NumericRange;
  onChange: (v: number) => void;
  disabled?: boolean;
}

/** The Wide sliders track: the comfort range linear, a logarithmic extension up to 1B (the number field takes anything else). */
export function WideTrack({ settingKey, label, value, range, onChange, disabled }: WideTrackProps) {
  const pos = sliderPosition(settingKey, value, range);
  return (
    <input
      type="range"
      min={0}
      max={SLIDER_SPAN}
      step={1}
      value={pos}
      disabled={disabled}
      onChange={(e) => onChange(sliderValue(settingKey, Number(e.target.value), range))}
      className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
      style={trackStyle(pos)}
      aria-label={label}
      data-unlimited-slider={settingKey}
    />
  );
}
