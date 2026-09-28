"use client";

import type { ReactNode } from "react";
import type { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import type { ControlSection } from "./Controls";
import { ACCENT, ACCENT_LIGHT } from "@/lib/site";

/*
 * Building blocks of the controls panel, shared by Controls.tsx and the feature sections in
 * ./sections. They are module-level components (not closures inside Controls) so React keeps
 * their DOM between renders: inputs keep focus while typing.
 */

export type Translate = ReturnType<typeof useTranslations>;
export type Matcher = (key: string) => boolean;

export function sliderStyle(value: number, min: number, max: number) {
  const pct = ((value - min) / (max - min)) * 100;
  return {
    background: `linear-gradient(to right, ${ACCENT_LIGHT} 0%, ${ACCENT} ${pct}%, #27272a ${pct}%, #27272a 100%)`,
    accentColor: ACCENT,
  };
}

export const onBtn = `bg-[#93d119] text-slate-950`;
export const offBtn = "bg-zinc-800 text-zinc-300 hover:bg-zinc-700";
export const rainbowBtn = "bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500 text-white";

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
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
          <span>
            {t(labelKey)}
            {tipKey && <Tooltip text={t(tipKey)} />}
          </span>
          <span className="text-zinc-500">{display ?? value}</span>
        </label>
        <div className="flex items-center gap-2">
          {left && <span className="text-sm">{left}</span>}
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
            style={sliderStyle(value, range.min, range.max)}
            aria-label={t(labelKey)}
          />
          {right && <span className="text-sm">{right}</span>}
        </div>
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
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-zinc-300">
        {t(labelKey)}
        {tipKey && <Tooltip text={t(tipKey)} />}
      </label>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${value ? onClass : offBtn}`}
      >
        {value ? t(caseStyle === "upper" ? "onText" : "onTextCase") : t(caseStyle === "upper" ? "offText" : "offTextCase")}
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
