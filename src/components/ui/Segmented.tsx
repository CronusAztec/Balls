import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- A segmented control: a labelled group of aria-pressed buttons (one is on). The active segment
 * takes the accent; the rest sit on the surface. Used for small exclusive choices (speeds, layouts, frame rates).
 */
export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is not text. */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

export default function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  size = "sm",
  className,
  disabled,
  mono = false,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  size?: "xs" | "sm";
  className?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-1 p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            type="button"
            key={String(o.value)}
            aria-pressed={on}
            aria-label={o.ariaLabel}
            title={o.title}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center justify-center rounded-[5px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:min-h-11",
              size === "xs" ? "h-6 min-w-7 px-1.5 text-xs" : "h-7 min-w-8 px-2.5 text-sm",
              mono && "num",
              on ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
