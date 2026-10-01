"use client";

import { useEffect, useRef, useState } from "react";
import Tooltip from "../Tooltip";
import { Searchable, selectClass, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import type { ControlSection } from "../Controls";
import { TimelineSliderValue, timelineLive, useTimelineSlider, useTimelineTime, useTimelineValue } from "../timelineLive";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { supportsObstacles } from "@/lib/physics/obstacleEditor";
import { IconClose } from "@/components/ui/icons"; // --- site-redesign ---
import {
  MAX_KEYFRAMES,
  TIMELINE_KEYS,
  TIMELINE_KEY_COLORS,
  TIMELINE_RANGES,
  addKeyframe,
  baseValueOf,
  formatTimelineTime,
  formatTimelineValue,
  isTimelineKey,
  removeKeyframe,
  snapKeyframeTime,
  timelineKeyLabel,
  timelineKeyShown,
  updateKeyframe,
  type Keyframe,
  type TimelineKey,
} from "@/lib/simulation/timeline";
import UncapNumberField from "../NumberField"; // --- uncap-all --- a number field next to every numeric control (--- review fix (uncap-all) --- the keyframe rows' too)
import { rulesForRange } from "../unlimitedSlider"; // --- uncap-all ---

export interface TimelineSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  onReset: (section: ControlSection) => void;
}

/** Search keys of the Timeline section (SECTION_KEYS.timeline in Controls.tsx). */
export const TIMELINE_SECTION_KEYS = ["timeline", "timelineSetting", "timelineValue", "timelineAdd", "timelineKeyframes"];

/** data-number-field of a keyframe row's time field (the row's focus follows it when a new time moves the row). */
const KEYFRAME_TIME_FIELD = "keyframeTime";

/** "Add keyframe at 12.3 s" – the simulation clock, refreshed ten times a second without re-rendering the section. */
function AddLabel({ t }: { t: Translate }) {
  const time = useTimelineTime();
  return <>{t("timelineAddAt", { time: formatTimelineTime(time) })}</>;
}

/**
 * One keyframe of the list: its setting, time and value (both editable) and ✕. `unused`: why it does nothing right now
 * (struck through), or null. --- review fix (uncap-all) --- both fields are the shared number field: any time from 0 s
 * (past the slider's 120 s too) and any value of the setting (past its slider – ↑/↓ step on from 1,000 instead of
 * snapping back to the slider's end, as the browser's own number input did). Typing only changes the draft; Enter,
 * leaving the field or an arrow key commits, and the list re-sorts then (a moved row keeps its time field's focus).
 */
function KeyframeRow({ t, keyframe, index, unused, onChange, onRemove }: { t: Translate; keyframe: Keyframe; index: number; unused: string | null; onChange: (patch: Partial<Pick<Keyframe, "time" | "value">>) => void; onRemove: () => void }) {
  const n = index + 1;
  const range = RANGES[keyframe.key];
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line-strong/60 bg-surface-2/40 px-2 py-1.5" data-testid="timeline-row" data-key={keyframe.key} data-time={keyframe.time}>
      <span className="w-2 h-2 shrink-0 rotate-45 rounded-[1px]" style={{ background: TIMELINE_KEY_COLORS[keyframe.key] }} aria-hidden="true" />
      <span className={`flex-1 min-w-0 truncate text-xs ${unused ? "text-ink-3 line-through" : "text-ink"}`} title={unused ?? t(timelineKeyLabel(keyframe.key))}>
        {t(timelineKeyLabel(keyframe.key))}
      </span>
      <UncapNumberField value={keyframe.time} onCommit={(time) => onChange({ time })} label={t("timelineTimeOf", { n })} range={TIMELINE_RANGES.keyframeTime} rules={{ min: 0 }} settingKey={KEYFRAME_TIME_FIELD} className="w-16" testId="timeline-time" />
      <span className="text-xs text-ink-3">s</span>
      <UncapNumberField value={keyframe.value} onCommit={(value) => onChange({ value })} label={t("timelineValueOf", { n })} range={range} rules={rulesForRange(range, keyframe.key)} settingKey={`keyframeValue:${keyframe.key}`} className="w-20" testId="timeline-value" />
      <button type="button" onClick={onRemove} aria-label={t("timelineRemove", { n })} className="shrink-0 px-1 py-0.5 text-ink-3 hover:text-danger transition-colors text-sm cursor-pointer">
        <IconClose size={14} />
      </button>
    </div>
  );
}

/** The picked setting's own value (its slider's) – the value the next keyframe gets – and, while automated, its live value. */
function ValueControl({ t, settingKey, value, onChange }: { t: Translate; settingKey: TimelineKey; value: number; onChange: (v: number) => void }) {
  const range = RANGES[settingKey];
  const live = useTimelineValue(settingKey);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-ink-2 flex items-center justify-between" htmlFor="timeline-value-slider">
        <span>
          {t("timelineValue")}
          <Tooltip text={t("timelineValueTip")} />
        </span>
        <span className="text-ink-2 tabular-nums">{formatTimelineValue(settingKey, value)}</span>
      </label>
      <div className="flex items-center gap-2">
        <input
          id="timeline-value-slider"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          data-testid="timeline-value-slider"
          className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer"
          style={sliderStyle(value, range.min, range.max)}
        />
        <UncapNumberField value={value} onCommit={onChange} label={t("timelineValue")} range={range} rules={rulesForRange(range)} settingKey={`keyframe:${settingKey}`} /* --- uncap-all --- */ />
      </div>
      {live !== null && (
        <p className="text-xs text-ink-3 text-right">
          {t("timelineNow")} <TimelineSliderValue t={t} live={{ key: settingKey, value: live }} fallback={null} />
        </p>
      )}
    </div>
  );
}

/**
 * The Timeline section: pick a setting, set the value the keyframe gets (the setting's own value), add a keyframe at the
 * simulation's current time, and edit or remove the keyframes in the list. The engine plays them on the simulation clock
 * (lib/simulation/timeline.ts); the panel's sliders of automated settings show the live value with an AUTO badge and the
 * bar under the canvas (TimelineBar.tsx) shows the keyframes and the playhead.
 */
export default function TimelineSection({ t, search, matches, settings: s, update }: TimelineSectionProps) {
  const obstacles = supportsObstacles(s.mode);
  const offered = TIMELINE_KEYS.filter((key) => timelineKeyShown(key, s.mode, obstacles));
  const [picked, setPicked] = useState<TimelineKey>("gravity");
  // --- review fix (uncap-all) --- a row's React key is its setting and time, so a time committed while its field has the
  // focus (Enter, an arrow key) re-creates the row at its new place: the field there gets the focus back (null: none to restore)
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    refocus.current = null;
    const row = [...document.querySelectorAll<HTMLElement>('[data-testid="timeline-row"]')].find((el) => `${el.dataset.key}@${el.dataset.time}` === target);
    row?.querySelector<HTMLInputElement>(`input[data-number-field="${KEYFRAME_TIME_FIELD}"]`)?.focus();
  });
  const settingKey = offered.includes(picked) ? picked : offered[0];
  const keyframes = s.keyframes;
  const searching = !!search;
  if (searching && !TIMELINE_SECTION_KEYS.some(matches)) return null;
  const setKeyframes = (next: Keyframe[]) => update({ keyframes: next });
  const full = keyframes.length >= MAX_KEYFRAMES;
  const add = () => {
    const keyframe: Keyframe = { time: snapKeyframeTime(timelineLive.now()), key: settingKey, value: baseValueOf(s, settingKey) };
    // A full list still takes a keyframe that replaces one at the same time.
    if (full && !keyframes.some((k) => k.key === keyframe.key && k.time === keyframe.time)) return;
    setKeyframes(addKeyframe(keyframes, keyframe, RANGES));
  };
  return (
    <div className="space-y-4" data-testid="timeline-section">
      <p className="text-xs text-ink-2 leading-relaxed">
        {t("timelineDesc")}
        <Tooltip text={t("timelineTip")} />
      </p>
      <Searchable search={search} matches={matches} labelKey="timelineSetting">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink-2" htmlFor="timeline-setting">
              {t("timelineSetting")}
              <Tooltip text={t("timelineSettingTip")} />
            </label>
            <select id="timeline-setting" value={settingKey} onChange={(e) => isTimelineKey(e.target.value) && setPicked(e.target.value)} className={selectClass} data-testid="timeline-setting">
              {offered.map((key) => (
                <option key={key} value={key}>
                  {t(timelineKeyLabel(key))}
                </option>
              ))}
            </select>
          </div>
          <ValueControl t={t} settingKey={settingKey} value={baseValueOf(s, settingKey)} onChange={(v) => update({ [settingKey]: v } as Partial<SimulatorSettings>)} />
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="timelineAdd">
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={add}
            disabled={full}
            title={t("timelineAddTip")}
            data-testid="timeline-add"
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-surface-2 text-accent border border-dashed border-accent/40 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed tabular-nums"
          >
            <AddLabel t={t} />
          </button>
          {full && <p className="text-xs text-warn/90">{t("timelineLimit", { max: MAX_KEYFRAMES })}</p>}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="timelineKeyframes">
        <div className="space-y-1.5" data-testid="timeline-list">
          <label className="text-sm font-medium text-ink-2">
            {t("timelineKeyframes")} <span className="text-ink-3 text-xs">({keyframes.length})</span>
          </label>
          {keyframes.length === 0 && <p className="text-xs text-ink-3 text-center py-2">{t("timelineEmpty")}</p>}
          {keyframes.map((keyframe, i) => (
            <KeyframeRow
              key={`${keyframe.key}@${keyframe.time}`}
              t={t}
              keyframe={keyframe}
              index={i}
              unused={!timelineKeyShown(keyframe.key, s.mode, obstacles) ? t("timelineUnused") : keyframe.key === "rotationSpeed" && !s.rotationEnabled ? t("timelineRotationOff") : null}
              onChange={(patch) => {
                const focused = document.activeElement;
                if (patch.time !== undefined && focused instanceof HTMLInputElement && focused.dataset.numberField === KEYFRAME_TIME_FIELD) refocus.current = `${keyframe.key}@${snapKeyframeTime(patch.time)}`;
                setKeyframes(updateKeyframe(keyframes, i, patch, RANGES));
              }}
              onRemove={() => setKeyframes(removeKeyframe(keyframes, i))}
            />
          ))}
          {keyframes.length > 0 && <p className="text-xs text-ink-3 leading-relaxed">{t("timelineClipNote", { duration: s.recordingDuration })}</p>}
        </div>
      </Searchable>
    </div>
  );
}

/** The value text of a slider the panel draws by hand (the rotation speed): the live value with the AUTO badge while automated. */
export function TimelineValueText({ t, labelKey, fallback }: { t: Translate; labelKey: string; fallback: string }) {
  const live = useTimelineSlider(labelKey);
  return (
    <span className="text-ink-3">
      <TimelineSliderValue t={t} live={live} fallback={fallback} />
    </span>
  );
}

/** A range input the panel draws by hand (the rotation speed) that follows the keyframes like `Slider` does: the live value, locked while automated. */
export function TimelineRangeInput({ labelKey, value, range, onChange, className, ariaLabel }: { labelKey: string; value: number; range: { min: number; max: number; step: number }; onChange: (v: number) => void; className: string; ariaLabel: string }) {
  const live = useTimelineSlider(labelKey);
  const shown = live ? live.value : value;
  return (
    <span className="flex w-full items-center gap-2">
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        disabled={!!live}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${className} disabled:opacity-50 disabled:cursor-not-allowed`}
        style={sliderStyle(shown, range.min, range.max)}
        aria-label={ariaLabel}
      />
      {/* --- uncap-all --- the number field (any value; the track pins at its end beyond it) */}
      <UncapNumberField value={shown} onCommit={onChange} label={ariaLabel} range={range} rules={rulesForRange(range)} disabled={!!live} settingKey={labelKey} />
    </span>
  );
}
