"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Toggle, onBtn, offBtn, selectClass, sliderStyle, type Matcher, type Translate } from "../ControlPrimitives";
import type { SimulatorSettings } from "@/lib/settings";
import { bounceParamApplies, type BounceMathView } from "@/lib/physics/bounceMathRuntime";
import { IconClose } from "@/components/ui/icons"; // --- site-redesign ---
import {
  BOUNCE_MATH_PRESET_IDS,
  BOUNCE_OPS,
  BOUNCE_PARAMS,
  BOUNCE_TRIGGERS,
  MAX_BOUNCE_RULES,
  MAX_FORMULA_LENGTH,
  addRule,
  amountComfortRange,
  appendPreset,
  compileFormula,
  formatBounceValue,
  isBounceMathPresetId,
  isBounceOp,
  isBounceParam,
  isBounceTrigger,
  moveRule,
  removeRule,
  updateRule,
  type BounceRule,
  type FormulaError,
} from "@/lib/simulation/bounceMath";

/**
 * --- bounce-math --- The "Bounce math" block of the Ball & Physics section: the rule list (parameter, trigger, every N,
 * operation, amount with a comfort slider or a formula with live validation, optional min / max, this ball or all, move up /
 * down, remove), "+ Add rule", the preset picker that appends a preset's rules, Clear, Show values and – while a run plays –
 * the live readout of the ball that bounced last and every rule's fire count. The maths lives in lib/simulation/bounceMath.ts,
 * the engine side in lib/physics/bounceMathRuntime.ts; this component only edits `settings.bounceMath`.
 */

/** Search keys of the block (added to SECTION_KEYS.ball in Controls.tsx; labels in `Controls`). */
export const BOUNCE_MATH_KEYS = ["bounceMath", "bounceMathRules", "bounceMathPreset", "bounceMathShowValues"];

/** What the page hands the block: the engine's readout (null before the engine exists). */
export interface BounceMathPanelProps {
  getView: () => BounceMathView | null;
}

const smallBtn = "px-1.5 py-0.5 rounded-md text-xs font-medium transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";
const fieldClass = "px-1.5 py-1 bg-surface-1 text-ink text-xs tabular-nums rounded-md border border-line-strong focus:border-accent-dim";
const miniSelect = "min-w-0 flex-1 px-1.5 py-1 bg-surface-1 text-ink text-xs rounded-md border border-line-strong focus:border-accent-dim";

/**
 * A number field that keeps a draft while it has the focus and commits a finite value on Enter or when it loses the focus
 * (Escape drops the draft); `optional` fields commit an emptied field as "none".
 */
function NumberField({ value, ariaLabel, onCommit, optional, placeholder, className, testId }: { value: number | undefined; ariaLabel: string; onCommit: (v: number | undefined) => void; optional?: boolean; placeholder?: string; className: string; testId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const commit = (text: string | null) => {
    setDraft(null);
    if (text === null) return;
    const trimmed = text.trim();
    if (trimmed === "") {
      if (optional && value !== undefined) onCommit(undefined);
      return;
    }
    const v = Number(trimmed.replace(",", "."));
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`${fieldClass} ${className}`}
    />
  );
}

/** The formula of a "formula" rule: a draft that commits whenever it compiles, with the error shown live and an example line. */
function FormulaField({ value, n, onCommit, b }: { value: string; n: number; onCommit: (formula: string) => void; b: Translate }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const result = compileFormula(text.trim());
  const error: FormulaError | null = result.ok ? null : result.error;
  return (
    <div className="space-y-1">
      <input
        type="text"
        value={text}
        maxLength={MAX_FORMULA_LENGTH}
        spellCheck={false}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (compileFormula(next.trim()).ok && next.trim() !== value) onCommit(next.trim());
        }}
        onBlur={() => setDraft(null)}
        aria-label={b("formulaOf", { n })}
        aria-invalid={!!error}
        data-testid="bm-formula"
        className={`${fieldClass} w-full font-mono ${error ? "border-danger/70" : ""}`}
      />
      {error ? (
        <p className="text-xs text-danger" data-testid="bm-formula-error" data-code={error.code}>
          {b(`formulaError.${error.code}`, { at: error.at + 1, name: error.name ?? "" })}
        </p>
      ) : (
        <p className="text-xs text-ink-3 leading-snug">{b("formulaExample")}</p>
      )}
    </div>
  );
}

/** One rule: its parameter, trigger and every N; its operation and amount (or formula); min / max and the scope; up, down, ✕. */
function RuleRow({ rule, index, count, mode, fires, onChange, onMove, onRemove, b }: { rule: BounceRule; index: number; count: number; mode: SimulatorSettings["mode"]; fires: number | null; onChange: (patch: Partial<BounceRule>) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void; b: Translate }) {
  const n = index + 1;
  const comfort = amountComfortRange(rule.param, rule.op);
  const sliderValue = Math.max(comfort.min, Math.min(comfort.max, rule.amount));
  const applies = bounceParamApplies(rule.param, mode);
  return (
    <div className="rounded-lg border border-line-strong/60 bg-surface-2/40 p-2 space-y-1.5" data-testid="bm-rule" data-param={rule.param} data-trigger={rule.trigger} data-op={rule.op}>
      <div className="flex items-center gap-1">
        <span className="shrink-0 w-5 text-xs font-bold text-accent tabular-nums">#{n}</span>
        <select value={rule.param} onChange={(e) => isBounceParam(e.target.value) && onChange({ param: e.target.value })} aria-label={b("paramOf", { n })} data-testid="bm-param" className={miniSelect}>
          {BOUNCE_PARAMS.map((p) => (
            <option key={p} value={p}>
              {b(`param.${p}`)}
            </option>
          ))}
        </select>
        <select value={rule.trigger} onChange={(e) => isBounceTrigger(e.target.value) && onChange({ trigger: e.target.value })} aria-label={b("triggerOf", { n })} data-testid="bm-trigger" className={miniSelect}>
          {BOUNCE_TRIGGERS.map((tr) => (
            <option key={tr} value={tr}>
              {b(`trigger.${tr}`)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={b("moveUp", { n })} data-testid="bm-up" className={`${smallBtn} bg-surface-2 text-ink-2 hover:bg-surface-3`}>
          ↑
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={b("moveDown", { n })} data-testid="bm-down" className={`${smallBtn} bg-surface-2 text-ink-2 hover:bg-surface-3`}>
          ↓
        </button>
        <button type="button" onClick={onRemove} aria-label={b("remove", { n })} data-testid="bm-remove" className="shrink-0 px-1 py-0.5 text-ink-3 hover:text-danger transition-colors text-sm cursor-pointer">
          <IconClose size={14} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-ink-2">
        <span>{b("every")}</span>
        <NumberField value={rule.every} ariaLabel={b("everyOf", { n })} onCommit={(v) => v !== undefined && onChange({ every: v })} className="w-12" testId="bm-every" />
        <span className="flex-1 truncate">{b(`everyUnit.${rule.trigger}`, { count: rule.every })}</span>
        {fires !== null && (
          <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent tabular-nums" data-testid="bm-fires">
            {b("fired", { count: formatBounceValue(fires) })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <select value={rule.op} onChange={(e) => isBounceOp(e.target.value) && onChange({ op: e.target.value })} aria-label={b("opOf", { n })} data-testid="bm-op" className={`${miniSelect} max-w-[46%]`}>
          {BOUNCE_OPS.map((op) => (
            <option key={op} value={op}>
              {b(`op.${op}`)}
            </option>
          ))}
        </select>
        {rule.op !== "formula" && <NumberField value={rule.amount} ariaLabel={b("amountOf", { n })} onCommit={(v) => v !== undefined && onChange({ amount: v })} className="w-20" testId="bm-amount" />}
      </div>
      {rule.op === "formula" ? (
        <FormulaField value={rule.formula ?? ""} n={n} onCommit={(formula) => onChange({ formula })} b={b} />
      ) : (
        <input
          type="range"
          min={comfort.min}
          max={comfort.max}
          step={comfort.step}
          value={sliderValue}
          onChange={(e) => onChange({ amount: Number(e.target.value) })}
          aria-label={b("amountSliderOf", { n })}
          data-testid="bm-amount-slider"
          className="w-full h-1.5 bg-surface-2 rounded-lg appearance-none cursor-pointer"
          style={sliderStyle(sliderValue, comfort.min, comfort.max)}
        />
      )}
      <div className="flex items-center gap-1.5 text-xs text-ink-2">
        <span>{b("min")}</span>
        <NumberField value={rule.min} optional placeholder="–" ariaLabel={b("minOf", { n })} onCommit={(v) => onChange({ min: v })} className="w-14" testId="bm-min" />
        <span>{b("max")}</span>
        <NumberField value={rule.max} optional placeholder="∞" ariaLabel={b("maxOf", { n })} onCommit={(v) => onChange({ max: v })} className="w-14" testId="bm-max" />
        <button
          type="button"
          onClick={() => onChange({ scope: rule.scope === "all" ? "ball" : "all" })}
          aria-pressed={rule.scope === "all"}
          title={b("scopeTip")}
          data-testid="bm-scope"
          className={`ml-auto ${smallBtn} ${rule.scope === "all" ? onBtn : offBtn}`}
        >
          {b(rule.scope === "all" ? "scopeAll" : "scopeBall")}
        </button>
      </div>
      {!applies && <p className="text-xs text-warn/90">{b("notInMode")}</p>}
    </div>
  );
}

/** The live readout of the engine (the ball that bounced last, every rule's fire count), polled ten times a second while rules exist. */
function useReadout(panel: BounceMathPanelProps | undefined, enabled: boolean) {
  const [readout, setReadout] = useState<{ key: string; view: { hasBall: boolean; bounciness: number; speed: number; size: number; gravity: number; balls: number; fires: number[] } } | null>(null);
  useEffect(() => {
    if (!panel || !enabled) {
      setReadout(null);
      return;
    }
    const tick = () => {
      const v = panel.getView();
      if (!v || !v.active) return;
      const key = `${v.hasBall}|${v.bounciness.toFixed(3)}|${Math.round(v.speed)}|${v.size.toFixed(2)}|${v.gravity}|${v.balls}|${v.fires.join(",")}`;
      setReadout((prev) => (prev && prev.key === key ? prev : { key, view: { hasBall: v.hasBall, bounciness: v.bounciness, speed: v.speed, size: v.size, gravity: v.gravity, balls: v.balls, fires: [...v.fires] } }));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [panel, enabled]);
  return readout?.view ?? null;
}

export default function BounceMathSection({ t, search, matches, settings: s, update, panel }: { t: Translate; search: string; matches: Matcher; settings: SimulatorSettings; update: (patch: Partial<SimulatorSettings>) => void; panel?: BounceMathPanelProps }) {
  const b = useTranslations("BounceMath");
  const rules = s.bounceMath;
  const readout = useReadout(panel, rules.length > 0);
  const [preset, setPreset] = useState("");
  if (search && !BOUNCE_MATH_KEYS.some(matches)) return null;
  const setRules = (next: BounceRule[]) => update({ bounceMath: next });
  const full = rules.length >= MAX_BOUNCE_RULES;
  return (
    <div className="space-y-3 rounded-xl border border-accent/25 bg-surface-1/40 p-3" data-testid="bm-section">
      <Searchable search={search} matches={matches} labelKey="bounceMath">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-ink flex items-center gap-1">
            {t("bounceMath")}
            <Tooltip text={t("bounceMathTip")} />
          </label>
          <p className="text-xs text-ink-2 leading-relaxed">{b("desc")}</p>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="bounceMathRules">
        <div className="space-y-2" data-testid="bm-rules" data-count={rules.length}>
          {rules.length === 0 && <p className="text-xs text-ink-3 italic">{b("empty")}</p>}
          {rules.map((rule, i) => (
            <RuleRow
              key={i}
              rule={rule}
              index={i}
              count={rules.length}
              mode={s.mode}
              fires={readout ? (readout.fires[i] ?? 0) : null}
              onChange={(patch) => setRules(updateRule(rules, i, patch))}
              onMove={(direction) => setRules(moveRule(rules, i, direction))}
              onRemove={() => setRules(removeRule(rules, i))}
              b={b}
            />
          ))}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRules(addRule(rules))}
              disabled={full}
              data-testid="bm-add"
              className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-surface-2 text-accent border border-dashed border-accent/40 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {b("add")}
            </button>
            <button type="button" onClick={() => setRules([])} disabled={rules.length === 0} data-testid="bm-clear" className="px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed">
              {b("clear")}
            </button>
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="bounceMathPreset">
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-2" htmlFor="bm-preset">
            {t("bounceMathPreset")}
            <Tooltip text={b("presetTip")} />
          </label>
          <select
            id="bm-preset"
            value={preset}
            disabled={full}
            onChange={(e) => {
              const id = e.target.value;
              setPreset("");
              if (isBounceMathPresetId(id)) setRules(appendPreset(rules, id));
            }}
            data-testid="bm-preset"
            className={selectClass}
          >
            <option value="">{b("presetPick")}</option>
            {BOUNCE_MATH_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {b(`preset.${id}`)}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="bounceMathShowValues">
        <Toggle t={t} labelKey="bounceMathShowValues" tipKey="bounceMathShowValuesTip" value={s.bounceMathHud} onChange={(v) => update({ bounceMathHud: v })} caseStyle="title" />
      </Searchable>
      {readout && !search && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg bg-bg/50 px-2.5 py-2 text-xs tabular-nums" data-testid="bm-readout">
          <span className="col-span-2 text-xs uppercase tracking-wide text-ink-3">{b("readout")}</span>
          <span className="text-ink-2">
            {b("param.bounciness")}: <b className="text-warn" data-testid="bm-readout-bounce">{readout.hasBall ? formatBounceValue(readout.bounciness) : "–"}</b>
          </span>
          <span className="text-ink-2">
            {b("param.speed")}: <b className="text-accent-strong" data-testid="bm-readout-speed">{readout.hasBall ? formatBounceValue(readout.speed) : "–"}</b>
          </span>
          <span className="text-ink-2">
            {b("param.size")}: <b className="text-accent-strong" data-testid="bm-readout-size">{readout.hasBall ? formatBounceValue(readout.size) : "–"}</b>
          </span>
          <span className="text-ink-2">
            {b("param.gravity")}: <b className="text-accent-strong" data-testid="bm-readout-gravity">{formatBounceValue(readout.gravity)}</b>
          </span>
          <span className="col-span-2 text-ink-3">{b("readoutBalls", { count: readout.balls })}</span>
        </div>
      )}
    </div>
  );
}
