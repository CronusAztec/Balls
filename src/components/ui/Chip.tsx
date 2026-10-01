import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** --- site-redesign --- A filter chip: a pressed / not pressed toggle in a row of filters (the mode families). */
export default function Chip({ pressed, children, className, count, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pressed: boolean; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 [@media(pointer:coarse)]:min-h-11",
        pressed ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && <span className={cx("num text-xs", pressed ? "text-accent-ink/70" : "text-ink-3")}>{count}</span>}
    </button>
  );
}
