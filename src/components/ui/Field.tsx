import type { LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- Form fields: Label (13 px, ink-2), Hint (12 px, ink-3), and the shared input / select / textarea
 * styling – a surface-1 well with a hairline that turns accent while focused. Field lays a label, a control and a hint
 * out on the 4 px grid.
 */

export const inputClass =
  "w-full h-9 rounded-md border border-line bg-surface-1 px-3 text-md text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-line-strong focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11";
export const textareaClass =
  "w-full rounded-md border border-line bg-surface-1 px-3 py-2 text-md leading-relaxed text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-line-strong focus:border-accent-dim resize-y";
export const selectClass =
  "w-full h-9 rounded-md border border-line bg-surface-1 pl-3 pr-8 text-md text-ink cursor-pointer appearance-none bg-[length:16px_16px] bg-[position:right_8px_center] bg-no-repeat transition-colors duration-150 hover:border-line-strong focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 bg-[image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23a8a8b0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5.5 8 4.5 4.5L14.5 8'/%3E%3C/svg%3E\")]";

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label className={cx("text-sm font-medium text-ink-2", className)} {...rest}>
      {children}
    </label>
  );
}

export function Hint({ id, children, className, tone = "default" }: { id?: string; children: ReactNode; className?: string; tone?: "default" | "warn" | "danger" | "ok" }) {
  const color = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-ink-3";
  return (
    <p id={id} className={cx("text-xs leading-relaxed", color, className)}>
      {children}
    </p>
  );
}

export default function Field({ label, htmlFor, hint, aside, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside}
      </div>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}
