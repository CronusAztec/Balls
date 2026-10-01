"use client";

/*
 * --- uncap-all --- The number field next to every slider (and every other numeric control of the panel): any finite
 * number can be typed – huge (1e9, 2.5M), tiny (0.0001) or decimal (1,5 or 1.5) – with no maximum. It commits on Enter,
 * when the field is left and on the arrow keys (↑/↓ one step, Shift ten, Alt a tenth; beyond the slider a step of about
 * a tenth of the value); invalid text never reaches the settings: the old value stays and the field says why. A value
 * beyond the slider's comfort range is shown exactly, with a faint tint and a "beyond the slider" tooltip. The behaviour
 * itself is the pure `numberFieldReduce()` of lib/uncap.ts (tested there); this component only renders it.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { IDLE_FIELD, fieldDisplay, formatCompact, numberFieldReduce, type NumberFieldEvent, type NumberFieldState, type NumberRules, type NumericRange } from "@/lib/uncap";

export interface NumberFieldProps {
  /** The current value (what the settings hold). */
  value: number;
  /** A valid typed or stepped value (never an invalid one). */
  onCommit: (value: number) => void;
  /** The control's name, for screen readers ("Ball Speed"). */
  label: string;
  /** The slider's comfort range: its step drives the arrow keys, its ends the "beyond the slider" tint. */
  range: NumericRange;
  /** The setting's rules: the sensible minimum (none for signed settings) and whole numbers. */
  rules?: NumberRules;
  disabled?: boolean;
  /** The setting key (data-number-field, for tools and the smoke test). */
  settingKey?: string;
  /** Extra classes for the input (width). */
  className?: string;
  /** The id of the input (a <label htmlFor>). */
  id?: string;
}

export default function NumberField({ value, onCommit, label, range, rules, disabled, settingKey, className, id }: NumberFieldProps) {
  const t = useTranslations("Uncap");
  const [state, setState] = useState<NumberFieldState>(IDLE_FIELD);
  const errorId = useId();
  const display = fieldDisplay(value, range);
  const dispatch = (event: NumberFieldEvent) => {
    const next = numberFieldReduce(state, event, value, range, rules);
    setState(next.state);
    if (next.commit !== undefined && next.commit !== value) onCommit(next.commit);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dispatch({ type: "commit" });
    } else if (e.key === "Escape") {
      if (state.draft !== null) e.stopPropagation();
      dispatch({ type: "cancel" });
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      dispatch({ type: "step", direction: e.key === "ArrowUp" ? 1 : -1, modifier: e.shiftKey ? "coarse" : e.altKey ? "fine" : null });
    }
  };
  const error = state.error;
  const message = !error
    ? null
    : error.reason === "belowMin"
      ? t("errBelowMin", { min: formatCompact(error.min ?? range.min) })
      : error.reason === "notFinite"
        ? t("errNotFinite")
        : error.reason === "empty"
          ? t("errEmpty")
          : t("errNotNumber", { text: (error.text ?? "").slice(0, 24) });
  const beyondTip = display.beyond ? t("beyondTip", { value: display.compact, min: formatCompact(range.min), max: formatCompact(range.max) }) : undefined;
  return (
    <span className="relative inline-flex shrink-0 flex-col items-end">
      {/* No `type` attribute: a text input all the same (any typed form – 1e6, 1,5, 2.5k – reaches the parser), but the
          panel's own text fields (labels, names, codes) stay the only `input[type="text"]` of their cards. */}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={state.draft ?? display.text}
        disabled={disabled}
        onChange={(e) => dispatch({ type: "type", text: e.target.value })}
        onKeyDown={onKeyDown}
        onBlur={() => dispatch({ type: "blur" })}
        aria-label={t("fieldLabel", { label })}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        title={error ? (message ?? undefined) : beyondTip}
        data-number-field={settingKey ?? ""}
        data-beyond={display.beyond ? "1" : undefined}
        className={`${className ?? "w-20"} px-1.5 py-0.5 text-right font-mono text-xs rounded-md border disabled:opacity-50 ${
          error ? "border-danger bg-danger/8 text-danger" : display.beyond ? "border-warn/60 bg-warn/10 text-warn focus:border-warn" : "border-line-strong bg-surface-2 text-ink focus:border-accent-dim"
        }`}
      />
      {message && (
        <span id={errorId} role="alert" className="absolute right-0 top-full z-20 mt-0.5 w-44 rounded-md border border-danger/36 bg-surface-1 px-1.5 py-0.5 text-right text-xs leading-tight text-danger shadow">
          {message}
        </span>
      )}
    </span>
  );
}
