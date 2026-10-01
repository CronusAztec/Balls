import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- An on/off switch: a button with aria-pressed (the panel's toggles are pressed / not pressed
 * buttons, and tools and the smoke test know them that way), drawn as a track and a thumb. `children` is its text
 * (ON / OFF) – kept for screen readers and innerText, hidden from sight.
 */
export default function Switch({ pressed, children, className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pressed: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        "[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-3 [@media(pointer:coarse)]:before:content-['']",
        pressed ? "border-accent bg-accent" : "border-line-strong bg-surface-3 hover:border-ink-3",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className={cx("absolute top-[3px] left-[3px] h-3 w-3 rounded-full transition-transform duration-150", pressed ? "translate-x-4 bg-accent-ink" : "bg-ink-2")} />
      {children !== undefined && <span className="sr-only">{children}</span>}
    </button>
  );
}
