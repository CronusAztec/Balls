import type { ReactNode } from "react";
import { cx } from "./cx";

/** --- site-redesign --- A keyboard key in the mono face: <Kbd>Space</Kbd>, <Kbd>⌘K</Kbd>. */
export default function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("num inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 text-xs leading-none text-ink-2", className)}>{children}</kbd>;
}
