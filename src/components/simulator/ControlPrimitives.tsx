"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { TimelineSliderValue, useTimelineSlider } from "./timelineLive"; // --- timeline ---
import { WideTrack, keyOfRange, rulesForRange, useUnlimitedKey } from "./unlimitedSlider"; // --- unlimited --- (--- uncap-all --- the Wide sliders track)
// --- uncap-all --- a number field next to every slider, the track pinned at its end beyond its comfort range
import NumberField from "./NumberField";
import { beyondSlider, formatCompact, memoryCeiling } from "@/lib/uncap";

/*
 * Building blocks of the controls panel, shared by Controls.tsx and the feature sections in
 * ./sections. They are module-level components (not closures inside Controls) so React keeps
 * their DOM between renders: inputs keep focus while typing.
 */

export type Translate = ReturnType<typeof useTranslations>;
export type Matcher = (key: string) => boolean;

/** The track of a range input: the accent fill up to the value, then the empty track (globals.css sizes it to 4 px). */
export function sliderStyle(value: number, min: number, max: number) {
  const raw = ((value - min) / (max - min)) * 100;
  const pct = raw > 100 ? 100 : raw < 0 || !(raw === raw) ? 0 : raw; // --- uncap-all --- (the fill pins at the track's end for a value beyond it)
  return {
    background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${pct}%, var(--color-surface-3) ${pct}%, var(--color-surface-3) 100%)`,
    accentColor: "var(--color-accent)",
  };
}

/*
 * --- site-redesign --- the panel's choice buttons on the tokens: the chosen one in the accent, the others quiet surfaces;
 * the rainbow choice is the one place a spectrum shows in the chrome, as a thin underline rather than a fill.
 */
export const onBtn = "bg-accent text-accent-ink";
export const offBtn = "bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink";
export const rainbowBtn = "bg-surface-3 text-ink bg-[linear-gradient(90deg,var(--color-danger),var(--color-warn),var(--color-accent),#5ac8f0,#a78bfa)] bg-[length:100%_2px] bg-bottom bg-no-repeat";
/** Styling of the <select> pickers in the panel. */
export { selectClass } from "@/components/ui/Field";

/** Wraps a control so the search box can show it on its own (or hide it) by its label key. */
export function Searchable({ search, matches, labelKey, children }: { search: string; matches: Matcher; labelKey: string; children: ReactNode }) {
  if (!search) return <>{children}</>;
  if (!matches(labelKey)) return null;
  // --- review fix (site-redesign) --- the card names its key: the command palette finds the control it jumped to by it
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-3" data-search-key={labelKey}>
      {children}
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
        <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink-2">
          <span className="flex min-w-0 items-center">
            {label}
            {tipKey && <Tooltip text={t(tipKey)} />}
          </span>
          <span className={`num shrink-0 text-xs ${beyond ? "font-medium text-warn" : "text-ink-3"}`}>{live ? <TimelineSliderValue t={t} live={live} fallback={null} /> : beyond ? formatCompact(value) : (display ?? value)}</span>
        </label>
        <div className="flex items-center gap-3">
          {wideKey && !live ? (
            <WideTrack settingKey={wideKey} label={label} value={value} range={range} onChange={onChange} disabled={disabled} />
          ) : (
            <span className={`relative flex w-full items-center ${beyond ? "rounded-md ring-1 ring-warn/40" : ""}`} title={beyond ? u("beyondTip", { value: formatCompact(value), min: formatCompact(range.min), max: formatCompact(range.max) }) : undefined} data-beyond={beyond ? "1" : undefined}>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={shown}
                disabled={disabled || !!live}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={sliderStyle(shown, range.min, range.max)}
                aria-label={label}
              />
            </span>
          )}
          <NumberField value={shown} onCommit={onChange} label={label} range={range} rules={rulesForRange(range, settingKey)} disabled={disabled || !!live} settingKey={settingKey ?? labelKey} />
        </div>
        {ceiling < value && <p className="text-xs text-warn">{u("memoryCeiling", { value: formatCompact(ceiling) })}</p>}
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
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center text-sm font-medium text-ink-2">
        <span id={labelId}>{t(labelKey)}</span>
        {tipKey && <Tooltip text={t(tipKey)} />}
      </span>
      {/* --- site-redesign --- a track-and-knob switch; the ON / OFF word stays beside it for the eye (hidden from the name) */}
      <button
        type="button"
        role="switch"
        onClick={() => onChange(!value)}
        aria-checked={value}
        aria-labelledby={labelId}
        data-on={value ? "" : undefined}
        className="group/sw inline-flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-0.5 cursor-pointer [@media(pointer:coarse)]:min-h-11"
      >
        <span className={`num text-xs tracking-[0.08em] ${value ? "text-ink" : "text-ink-3"}`}>
          <span aria-hidden="true">{value ? t(caseStyle === "upper" ? "onText" : "onTextCase") : t(caseStyle === "upper" ? "offText" : "offTextCase")}</span>
        </span>
        <span aria-hidden="true" className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-150 ${value ? onClass : "bg-surface-3 group-hover/sw:bg-[rgb(242_242_237/0.16)]"}`}>
          <span className={`absolute left-0.5 h-4 w-4 rounded-full shadow-sm transition-transform duration-150 ${value ? "translate-x-4 bg-accent-ink" : "bg-ink-2"}`} />
        </span>
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
      className="h-9 w-full cursor-pointer rounded-md border border-line bg-surface-2 p-1 transition-colors duration-150 hover:border-line-strong"
    />
  );
}
