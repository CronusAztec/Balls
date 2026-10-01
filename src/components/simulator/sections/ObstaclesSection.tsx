"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { ResetButton, Searchable, Slider, selectClass, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import type { ControlSection } from "../Controls";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  MAX_OBSTACLES,
  OBSTACLE_KINDS,
  OBSTACLE_LIMITS,
  addObstacle,
  isCircleKind,
  removeObstacle,
  supportsObstacles,
  updateObstacle,
  type EditorObstacle,
  type ObstacleKind,
} from "@/lib/physics/obstacleEditor";
import NumberField from "../NumberField"; // --- uncap-all --- a number field next to every numeric control
import { rulesForRange } from "../unlimitedSlider"; // --- uncap-all ---

export interface ObstaclesSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  onReset: (section: ControlSection) => void;
}

/** Search keys of the Obstacles section (SECTION_KEYS.obstacles in Controls.tsx). */
export const OBSTACLE_KEYS = ["obstacles", "obstacleAdd", "obstacleClear", "bumperBoost"];

/** Icon and translation key of each kind. */
export const OBSTACLE_KIND_LABELS: Record<ObstacleKind, { icon: string; labelKey: string }> = {
  peg: { icon: "●", labelKey: "obstacleKindPeg" },
  bumper: { icon: "◎", labelKey: "obstacleKindBumper" },
  blocker: { icon: "▬", labelKey: "obstacleKindBlocker" },
  spinner: { icon: "⟳", labelKey: "obstacleKindSpinner" },
};

/** A signed coordinate with two decimals ("+0.25", "−0.40", "0.00"). */
function coordinate(v: number): string {
  if (Math.abs(v) < 0.005) return "0.00";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
}

/** A compact slider for one number of one obstacle (`ariaLabel` names it when the visible label is a short symbol). */
function RowSlider({ label, ariaLabel, value, range, display, onChange }: { label: string; ariaLabel?: string; value: number; range: { min: number; max: number; step: number }; display: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-400">
      <span className="w-14 shrink-0 truncate">{label}</span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel ?? label}
        className="flex-1 min-w-0 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
        style={sliderStyle(value, range.min, range.max)}
      />
      <span className="w-14 shrink-0 text-right font-mono tabular-nums text-zinc-500">{display}</span>
      <NumberField value={value} onCommit={onChange} label={label} range={range} rules={rulesForRange(range)} settingKey={`obstacle:${label}`} className="w-16" /* --- uncap-all --- */ />
    </label>
  );
}

/** One row of the list: kind, number and position, the size (length, angle, rpm for bars) and a remove button. */
function ObstacleRow({ t, obstacle: o, index, onChange, onRemove }: { t: Translate; obstacle: EditorObstacle; index: number; onChange: (patch: Partial<EditorObstacle>) => void; onRemove: () => void }) {
  const n = index + 1;
  const { icon, labelKey } = OBSTACLE_KIND_LABELS[o.kind];
  const circle = isCircleKind(o.kind);
  return (
    <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 px-2.5 py-2 space-y-1.5" data-testid="obstacle-row" data-kind={o.kind}>
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden="true" className="text-[#93d119] w-3 text-center">
          {icon}
        </span>
        <span className="font-semibold text-zinc-200">
          {t(labelKey)} {n}
        </span>
        <span className="text-zinc-500 font-mono tabular-nums truncate" data-testid="obstacle-position">
          {t("obstaclePosition", { x: coordinate(o.x), y: coordinate(o.y) })}
        </span>
        <button type="button" onClick={onRemove} aria-label={t("obstacleRemove", { n })} className="ml-auto shrink-0 px-1.5 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer">
          ✕
        </button>
      </div>
      {/* --- review fix (ui-i18n) --- the position can be set without dragging on the canvas (keyboard, switch access) */}
      <RowSlider label={`x ${n}`} ariaLabel={t("obstacleXOf", { n })} value={o.x} range={OBSTACLE_LIMITS.position} display={coordinate(o.x)} onChange={(v) => onChange({ x: v })} />
      <RowSlider label={`y ${n}`} ariaLabel={t("obstacleYOf", { n })} value={o.y} range={OBSTACLE_LIMITS.position} display={coordinate(o.y)} onChange={(v) => onChange({ y: v })} />
      <RowSlider
        label={`${t(circle ? "obstacleSize" : "obstacleLength")} ${n}`}
        value={o.size}
        range={circle ? OBSTACLE_LIMITS.circleSize : OBSTACLE_LIMITS.barSize}
        display={`${o.size}%`}
        onChange={(v) => onChange({ size: v })}
      />
      {!circle && <RowSlider label={`${t("obstacleAngle")} ${n}`} value={o.angle} range={OBSTACLE_LIMITS.angle} display={`${o.angle}°`} onChange={(v) => onChange({ angle: v })} />}
      {o.kind === "spinner" && <RowSlider label={`${t("obstacleRpm")} ${n}`} value={o.rpm} range={OBSTACLE_LIMITS.rpm} display={`${o.rpm} rpm`} onChange={(v) => onChange({ rpm: v })} />}
    </div>
  );
}

/**
 * The Obstacles section: pick a kind (peg, bumper, blocker, spinner) and add it on a free spot, edit each one's size
 * (length, angle and spin speed for the bars) or remove it, clear the layout, and set how hard bumpers kick. The layout
 * is the `obstacles` setting (arena-relative, so it scales with the canvas; URL `obs`, saved in presets); positions are
 * set with each row's x / y sliders or on the canvas – before the start or while paused an obstacle can be dragged there,
 * and Backspace deletes the selected one. The obstacles play in the ring modes; in the others the section says so and keeps the layout.
 */
export default function ObstaclesSection({ t, search, matches, settings: s, update, onReset }: ObstaclesSectionProps) {
  const [kind, setKind] = useState<ObstacleKind>("peg");
  const plays = supportsObstacles(s.mode);
  const full = s.obstacles.length >= MAX_OBSTACLES;
  const setList = (obstacles: EditorObstacle[]) => update({ obstacles });
  return (
    <div className="space-y-4" data-testid="obstacles-section">
      <ResetButton search={search} t={t} section="obstacles" onReset={onReset} />
      {!plays && <p className="text-xs text-amber-500/90 leading-relaxed">{t("obstaclesModeNote")}</p>}
      <Searchable search={search} matches={matches} labelKey="obstacleAdd">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="obstacle-kind-select">
            {t("obstacles")}
            <Tooltip text={t("obstaclesTip")} />
          </label>
          <div className="flex gap-2">
            <select id="obstacle-kind-select" value={kind} onChange={(e) => setKind(e.target.value as ObstacleKind)} aria-label={t("obstacleKind")} className={`${selectClass} flex-1 min-w-0 text-sm`}>
              {OBSTACLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {OBSTACLE_KIND_LABELS[k].icon} {t(OBSTACLE_KIND_LABELS[k].labelKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setList(addObstacle(s.obstacles, kind))}
              disabled={full}
              className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-zinc-800 text-[#93d119] border border-dashed border-[#93d119]/40 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ＋ {t("obstacleAdd")}
            </button>
          </div>
          {full && <p className="text-xs text-amber-500/90">{t("obstaclesMax", { max: MAX_OBSTACLES })}</p>}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="obstacles">
        <div className="space-y-2">
          {s.obstacles.length === 0 ? (
            <p className="text-xs text-zinc-500">{t("obstaclesEmpty")}</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar" data-testid="obstacle-list">
              {s.obstacles.map((o, i) => (
                <ObstacleRow key={i} t={t} obstacle={o} index={i} onChange={(patch) => setList(updateObstacle(s.obstacles, i, patch))} onRemove={() => setList(removeObstacle(s.obstacles, i))} />
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-500 leading-relaxed" data-testid="obstacle-hint">
            💡 {t("obstacleHint")}
          </p>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="obstacleClear">
        <button
          type="button"
          onClick={() => setList([])}
          disabled={s.obstacles.length === 0}
          className="w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🗑 {t("obstacleClear")}
        </button>
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="bumperBoost" tipKey="bumperBoostTip" value={s.bumperBoost} range={RANGES.bumperBoost} onChange={(v) => update({ bumperBoost: v })} display={`×${s.bumperBoost.toFixed(2)}`} left="◎" right="💥" />
    </div>
  );
}
