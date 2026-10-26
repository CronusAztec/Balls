"use client";

/*
 * --- unlimited --- The panel side of No limits, --- uncap-all --- now the "Wide sliders" switch: every value is uncapped
 * whatever the switch (lib/uncap.ts) and every slider has a number field next to it (NumberField.tsx, rendered by the
 * shared `Slider`). With the switch on, a slider of an uncapped setting gets a wide track: linear across its comfort range,
 * logarithmic above it up to its top (`sliderCeiling()`). Off, the track keeps its comfort range and pins at its end for a
 * value beyond it.
 * --- unlimited-sizes --- The switch is on by default (`inf=0` gives the comfort tracks back). A slider names its setting
 * (`settingKey`), so an inline range – the Teams ball count, a hand-written track – widens too; a slider that names none is
 * still found by its range object (the panel passes `RANGES.<key>`). The wide track's input holds the setting's own value
 * across the comfort range (a tool or a test reads and sets "4", as on a plain track) and an encoded position past it.
 */
import { createContext, useContext, type ReactNode } from "react";
import { RANGES, unlimitedSettingKeys } from "@/lib/settings";
import { LINEAR_SPAN, SLIDER_SPAN, hasWideTrack, isBoundedKey, isIntegerRange, sliderPosition, sliderValue, type NumericRange } from "@/lib/unlimited";
import { floorOf, formatCompact, type NumberRules } from "@/lib/uncap";
import { ACCENT, ACCENT_LIGHT } from "@/lib/site";

/** Whether the Wide sliders switch is on for the panel (Controls.tsx provides it; --- unlimited-sizes --- on by default). */
export const UnlimitedContext = createContext(true);

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

/**
 * The key a slider's wide track is drawn for while Wide sliders is on, else null (the slider keeps its comfort track):
 * --- unlimited-sizes --- the setting it names (`settingKey`) or the one its range object belongs to, when the track has
 * room past the comfort range (`hasWideTrack()`: a count whose ceiling is the slider's end has none). `top` is the track's
 * own end for a value that is not a setting (the clips of a batch).
 */
export function useUnlimitedKey(range: NumericRange, settingKey?: string, top?: number): string | null {
  const on = useContext(UnlimitedContext);
  if (!on) return null;
  const key = settingKey ?? keyOfRange(range);
  return key && !isBoundedKey(key) && hasWideTrack(key, range, top) ? key : null;
}

/**
 * --- uncap-all --- The number field's rules for a slider: the sensible minimum (none for a signed setting) and whole
 * numbers. --- unlimited-sizes --- The minimum is the setting's meaningful floor (`MEANINGFUL_FLOORS`): a Spin of 0 or a
 * 3 s clip is typed, not refused.
 */
export function rulesForRange(range: NumericRange, key: string | undefined = keyOfRange(range)): NumberRules {
  const floor = floorOf(key, range);
  return { min: Number.isFinite(floor.min) ? floor.min : undefined, ...(floor.above ? { above: true } : {}), integer: isIntegerRange(range) };
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

// --- unlimited-sizes --- the wide track's input value: the setting's own value across the comfort range, a position past it
/**
 * The value the wide track's `<input type="range">` holds for `value`: the value itself inside the comfort range (pinned
 * at its start below it), and past the range's end its logarithmic position mapped onto a second span as long as the range
 * (`min` … `max + (max − min)`), so the thumb sits where `sliderPosition()` puts it.
 */
export function wideInputValue(key: string, value: number, range: NumericRange, top?: number): number {
  if (!(value > range.max)) return Number.isFinite(value) && value > range.min ? value : range.min;
  const pos = sliderPosition(key, value, range, top);
  return range.max + ((range.max - range.min) * (pos - LINEAR_SPAN)) / (SLIDER_SPAN - LINEAR_SPAN);
}

/** The setting's value for the wide track's input value (the inverse of `wideInputValue()`): snapped to the step inside the comfort range. */
export function wideTrackValue(key: string, input: number, range: NumericRange, top?: number): number {
  const span = range.max - range.min;
  if (!(span > 0) || !Number.isFinite(input)) return range.min;
  // (inside the comfort range the position is linear – sliderValue() snaps it to the step – and past it the second span's)
  if (!(input > range.max)) return sliderValue(key, (LINEAR_SPAN * (input - range.min)) / span, range, top);
  return sliderValue(key, LINEAR_SPAN + ((SLIDER_SPAN - LINEAR_SPAN) * (input - range.max)) / span, range, top);
}
// --- end unlimited-sizes ---

export interface WideTrackProps {
  settingKey: string;
  /** The track's aria-label (--- unlimited-sizes --- none when a `<label htmlFor>` names it). */
  label?: string;
  value: number;
  range: NumericRange;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** --- unlimited-sizes --- The track's own end (a count that is not a setting); the setting's ceiling otherwise. */
  top?: number;
  /** --- unlimited-sizes --- Extra classes (a hand-written track's own look) and the input's id (a <label htmlFor>). */
  className?: string;
  id?: string;
  /** --- unlimited-sizes --- data-testid of the input (a hand-written track's own, for the smoke test). */
  testId?: string;
}

/** The Wide sliders track: the comfort range linear, a logarithmic extension up to its top (the number field takes anything else). */
export function WideTrack({ settingKey, label, value, range, onChange, disabled, top, className, id, testId }: WideTrackProps) {
  const pos = sliderPosition(settingKey, value, range, top);
  return (
    <input
      id={id}
      type="range"
      min={range.min}
      max={range.max + (range.max - range.min)}
      step="any"
      value={wideInputValue(settingKey, value, range, top)}
      disabled={disabled}
      onChange={(e) => onChange(wideTrackValue(settingKey, Number(e.target.value), range, top))}
      className={className ?? "w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"}
      style={trackStyle(pos)}
      aria-label={label}
      aria-valuetext={formatCompact(value)}
      data-unlimited-slider={settingKey}
      data-testid={testId}
    />
  );
}
