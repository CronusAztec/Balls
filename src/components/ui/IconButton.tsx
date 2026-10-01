import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- A square icon-only button: the label is its accessible name (aria-label) and shows as a tooltip
 * on hover and keyboard focus. 32 px (sm) or 40 px (md); 44 px on touch screens.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  icon: ReactNode;
  size?: "sm" | "md";
  /** Where the tooltip opens; "none" leaves it out (the label is still the button's name). */
  tooltip?: "top" | "bottom" | "right" | "left" | "none";
  active?: boolean;
}

const TIP: Record<"top" | "bottom" | "right" | "left", string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, size = "md", tooltip = "bottom", active = false, className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(
        "group/ib relative inline-flex shrink-0 items-center justify-center rounded-md cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
        active ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink hover:bg-surface-2",
        className,
      )}
      {...rest}
    >
      {icon}
      {tooltip !== "none" && (
        <span
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line bg-surface-3 px-2 py-1 text-xs font-medium text-ink opacity-0 transition-opacity duration-150 group-hover/ib:opacity-100 group-focus-visible/ib:opacity-100",
            TIP[tooltip],
          )}
        >
          {label}
        </span>
      )}
    </button>
  );
});

export default IconButton;
