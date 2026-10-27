"use client";

/*
 * --- uncap-all --- The number field next to every slider (and every other numeric control of the panel): any finite
 * number can be typed – huge (1e9, 2.5M), tiny (0.0001) or decimal (1,5 or 1.5) – with no maximum. It commits on Enter,
 * when the field is left and on the arrow keys (↑/↓ one step, Shift ten, Alt a tenth; beyond the slider a step of about
 * a tenth of the value); invalid text never reaches the settings: the old value stays and the field says why. A value
 * beyond the slider's comfort range is shown exactly, with a faint tint and a "beyond the slider" tooltip. The behaviour
 * itself is the pure `numberFieldReduce()` of lib/uncap.ts (tested there); this component only renders it.
 * --- unlimited-sizes --- The one field with a top is a Mode Lab parameter's (`rules.max`, the bound its Blueprint's language
 * holds that number to): a value past it is refused with that top named, as one below a floor is. A value that came in past
 * it (a link's) is shown as it is, and `changedTip` says what the game plays instead of "the value runs as typed".
 * --- insights --- (review fix) A field with no slider beside it (`sliderless`: the render queue's frame rate) is never
 * tinted or called "beyond the slider": its range drives the arrow keys alone.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { IDLE_FIELD, fieldDisplay, formatCompact, numberFieldMessage, numberFieldReduce, type NumberFieldEvent, type NumberFieldState, type NumberRules, type NumericRange } from "@/lib/uncap";

/** --- insights --- (review fix) How a value was committed: typed (Enter, leaving the field) or stepped with an arrow key. */
export type NumberCommitKind = "typed" | "step";

export interface NumberFieldProps {
  /** The current value (what the settings hold); undefined only for an optional value (`onClear`) that has none. */
  value: number | undefined;
  /**
   * A valid typed or stepped value (never an invalid one). --- insights --- (review fix) `how` says which (the field always
   * passes it): a field that adds what it commits (the render queue's frame rates) edits its own value on an arrow step
   * instead of adding each step.
   */
  onCommit: (value: number, how?: NumberCommitKind) => void;
  /**
   * --- review fix (uncap-all) --- An optional value (bounce math's min / max): an empty field calls this instead of being
   * refused, and the field shows `placeholder` while there is no value.
   */
  onClear?: () => void;
  /** The text an empty optional field shows ("–", "∞"). */
  placeholder?: string;
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
  /** data-testid of the input (the rows of the Timeline and Bounce math lists). */
  testId?: string;
  /** --- slow-motion --- (review fix) The id of a note that describes the control (an overridden slider's "Slow motion is off" note). */
  describedBy?: string;
  /**
   * --- unlimited-sizes --- What the run makes of a value it does not play as shown (a Mode Lab link's number past its game's
   * own bounds, Uncap.playsAs): the tooltip in place of "beyond the slider", with the warn tint.
   */
  changedTip?: string;
  /**
   * --- insights --- (review fix) No slider goes with this field (the render queue's frame rate, which adds the rate typed): a
   * value past `range` is a plain value, with no warn tint and no "beyond the slider" tooltip; `range` drives the arrow keys.
   */
  sliderless?: boolean;
}

export default function NumberField({ value, onCommit, onClear, placeholder, label, range, rules, disabled, settingKey, className, id, testId, describedBy, changedTip, sliderless }: NumberFieldProps) {
  const t = useTranslations("Uncap");
  const locale = useLocale(); // --- unlimited-sizes --- (review fix) (a refusal's bound in the page's number format)
  const [state, setState] = useState<NumberFieldState>(IDLE_FIELD);
  const errorId = useId();
  const optional = !!onClear;
  const shown = value === undefined ? { text: "", beyond: false, compact: "" } : fieldDisplay(value, range);
  const display = sliderless ? { ...shown, beyond: false } : shown; // --- insights --- (review fix) (no slider: nothing lies beyond one)
  const fieldRules = optional ? { ...rules, optional: true } : rules;
  const dispatch = (event: NumberFieldEvent) => {
    // (an optional field without a value steps from the range's start, as a slider would)
    const next = numberFieldReduce(state, event, value ?? Number.NaN, range, fieldRules);
    setState(next.state);
    if (next.clear) {
      if (value !== undefined) onClear?.();
    } else if (next.commit !== undefined && next.commit !== value) onCommit(next.commit, event.type === "step" ? "step" : "typed");
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
  // --- unlimited-sizes --- (review fix) the floor or top a refusal names, exactly and in the page's number format
  const message = numberFieldMessage(error, range, locale, t);
  // (--- unlimited-sizes --- a value the game plays otherwise says what it plays: it does not run as typed)
  const beyondTip = changedTip ?? (display.beyond ? t("beyondTip", { value: display.compact, min: formatCompact(range.min), max: formatCompact(range.max) }) : undefined);
  const warn = display.beyond || changedTip !== undefined;
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
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => dispatch({ type: "type", text: e.target.value })}
        onKeyDown={onKeyDown}
        onBlur={() => dispatch({ type: "blur" })}
        aria-label={t("fieldLabel", { label })}
        aria-invalid={error !== null}
        aria-describedby={[error ? errorId : "", describedBy ?? ""].filter(Boolean).join(" ") || undefined}
        title={error ? (message ?? undefined) : beyondTip}
        data-number-field={settingKey ?? ""}
        data-testid={testId}
        data-beyond={display.beyond ? "1" : undefined}
        data-changed={changedTip !== undefined ? "1" : undefined}
        /* --- review fix (site-redesign) --- a 32 px field (44 px on touch), the kit's control height */
        className={`${className ?? "w-20"} h-8 px-2 text-right font-mono text-xs rounded-md border disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 ${
          error ? "border-danger bg-danger/8 text-danger" : warn ? "border-warn/60 bg-warn/10 text-warn focus:border-warn" : "border-line-strong bg-surface-2 text-ink focus:border-accent-dim"
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
