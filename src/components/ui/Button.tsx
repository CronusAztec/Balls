import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- Buttons. One primary action per view (the accent fill); secondary on a surface with a hairline;
 * ghost for quiet actions; danger for the destructive / stop states. Two sizes: sm 32 px, md 40 px (44 px on touch).
 * `buttonClass()` styles links (next-intl <Link>, <a>) the same way.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm [@media(pointer:coarse)]:min-h-11",
  md: "h-10 px-4 text-md [@media(pointer:coarse)]:min-h-11",
};
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "bg-danger text-accent-ink hover:brightness-110",
};

export function buttonClass({ variant = "secondary", size = "md", block = false, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}): string {
  return cx(BASE, SIZES[size], VARIANTS[variant], block && "w-full", className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** A leading icon (decorative). */
  icon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass({ variant, size, block, className })} {...rest}>
      {icon}
      {children}
    </button>
  );
});

export default Button;
