"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import type { ControlSection } from "./Controls";
import { TimelineSliderValue, useTimelineSlider } from "./timelineLive"; // --- timeline ---
import { WideTrack, keyOfRange, rulesForRange, useUnlimitedKey } from "./unlimitedSlider"; // --- unlimited --- (--- uncap-all --- the Wide sliders track)
// --- uncap-all --- a number field next to every slider, the track pinned at its end beyond its comfort range
import NumberField from "./NumberField";
import { beyondSlider, formatCompact, memoryCeiling } from "@/lib/uncap";
import { ACCENT, ACCENT_LIGHT } from "@/lib/site";

/*
 * Building blocks of the controls panel, shared by Controls.tsx and the feature sections in
 * ./sections. They are module-level components (not closures inside Controls) so React keeps
 * their DOM between renders: inputs keep focus while typing.
 */

export type Translate = ReturnType<typeof useTranslations>;
export type Matcher = (key: string) => boolean;

export function sliderStyle(value: number, min: number, max: number) {
  const raw = ((value - min) / (max - min)) * 100;
  const pct = raw > 100 ? 100 : raw < 0 || !(raw === raw) ? 0 : raw; // --- uncap-all --- (the fill pins at the track's end for a value beyond it)
  return {
    background: `linear-gradient(to right, ${ACCENT_LIGHT} 0%, ${ACCENT} ${pct}%, #27272a ${pct}%, #27272a 100%)`,
    accentColor: ACCENT,
  };
}

export const onBtn = `bg-[#93d119] text-slate-950`;
export const offBtn = "bg-zinc-800 text-zinc-300 hover:bg-zinc-700";
export const rainbowBtn = "bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500 text-white";
/** Styling of the <select> pickers in the panel. */
export const selectClass = "w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none";

/** Wraps a control so the search box can show it on its own (or hide it) by its label key. */
export function Searchable({ search, matches, labelKey, children }: { search: string; matches: Matcher; labelKey: string; children: ReactNode }) {
  if (!search) return <>{children}</>;
  if (!matches(labelKey)) return null;
  return <div className="p-3 bg-zinc-800/40 rounded-xl border border-zinc-700/50 shadow-sm">{children}</div>;
}

export function ResetButton({ search, t, section, onReset }: { search: string; t: Translate; section: ControlSection; onReset: (section: ControlSection) => void }) {
  if (search) return null;
  return (
    <div className="flex justify-center border-b border-zinc-800/60 pb-2 mb-2">
      <button
        type="button"
        onClick={() => onReset(section)}
        className="text-xs text-[#93d119] hover:text-[#7fb315] transition-colors font-medium flex items-center gap-1 cursor-pointer bg-zinc-800/40 hover:bg-zinc-800/80 px-2 py-1 rounded-md"
      >
        🔄 {t("resetSection")}
      </button>
    </div>
  );
}

export function Slider({
  t,
  search,
  matches,
  labelKey,
  tipKey,
  value,
  range,
  onChange,
  display,
  left,
  right,
  disabled,
}: {
  t: Translate;
  search: string;
  matches: Matcher;
  labelKey: string;
  tipKey?: string;
  value: number;
  range: { min: number; max: number; step: number };
  onChange: (v: number) => void;
  display?: string;
  left?: string;
  right?: string;
  disabled?: boolean;
}) {
  // --- timeline --- while keyframes drive this setting the slider shows its live value, locked, with an AUTO badge
  const live = useTimelineSlider(labelKey);
  const shown = live ? live.value : value;
  // --- unlimited --- with Wide sliders on, an uncapped setting's slider goes logarithmic past its range
  const wideKey = useUnlimitedKey(range);
  // --- uncap-all --- the number field (always), the track pinned at its end beyond the comfort range, the memory ceiling note
  const settingKey = keyOfRange(range);
  const beyond = !live && beyondSlider(value, range);
  const ceiling = settingKey ? memoryCeiling(settingKey, value) : value;
  const label = t(labelKey);
  const u = useTranslations("Uncap");
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-2" data-uncap-slider={settingKey ?? labelKey}>
        <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
          <span>
            {label}
            {tipKey && <Tooltip text={t(tipKey)} />}
          </span>
          <span className={beyond ? "text-amber-400 font-semibold" : "text-zinc-500"}>{live ? <TimelineSliderValue t={t} live={live} fallback={null} /> : beyond ? formatCompact(value) : (display ?? value)}</span>
        </label>
        <div className="flex items-center gap-2">
          {left && <span className="text-sm">{left}</span>}
          {wideKey && !live ? (
            <WideTrack settingKey={wideKey} label={label} value={value} range={range} onChange={onChange} disabled={disabled} />
          ) : (
            <span className={`relative flex w-full items-center ${beyond ? "rounded-lg ring-1 ring-amber-500/40" : ""}`} title={beyond ? u("beyondTip", { value: formatCompact(value), min: formatCompact(range.min), max: formatCompact(range.max) }) : undefined} data-beyond={beyond ? "1" : undefined}>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={shown}
                disabled={disabled || !!live}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
                style={sliderStyle(shown, range.min, range.max)}
                aria-label={label}
              />
            </span>
          )}
          {right && <span className="text-sm">{right}</span>}
          <NumberField value={shown} onCommit={onChange} label={label} range={range} rules={rulesForRange(range, settingKey)} disabled={disabled || !!live} settingKey={settingKey ?? labelKey} />
        </div>
        {ceiling < value && <p className="text-xs text-amber-400/90">{u("memoryCeiling", { value: formatCompact(ceiling) })}</p>}
      </div>
    </Searchable>
  );
}

export function Toggle({
  t,
  labelKey,
  tipKey,
  value,
  onChange,
  onClass = onBtn,
  caseStyle = "upper",
}: {
  t: Translate;
  labelKey: string;
  tipKey?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onClass?: string;
  caseStyle?: "upper" | "title";
}) {
  // --- review fix (ui-i18n) --- a switch named by its label (not "ON"/"OFF"); the tooltip stays outside the name
  const labelId = useId();
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-zinc-300">
        <span id={labelId}>{t(labelKey)}</span>
        {tipKey && <Tooltip text={t(tipKey)} />}
      </span>
      <button
        type="button"
        role="switch"
        onClick={() => onChange(!value)}
        aria-checked={value}
        aria-labelledby={labelId}
        className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${value ? onClass : offBtn}`}
      >
        <span aria-hidden="true">{value ? t(caseStyle === "upper" ? "onText" : "onTextCase") : t(caseStyle === "upper" ? "offText" : "offTextCase")}</span>
      </button>
    </div>
  );
}

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="w-full h-10 bg-zinc-800 rounded-lg cursor-pointer border border-zinc-700"
    />
  );
}
