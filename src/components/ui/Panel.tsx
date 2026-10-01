import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- A panel: a surface-1 block with a hairline and the 10 px panel radius; an optional header with a
 * mono eyebrow title and actions. Elevation comes from the surface step, not a shadow.
 */
export default function Panel({ title, actions, children, className, bodyClassName, as: Tag = "section", ...rest }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; as?: "section" | "div" | "aside" } & Record<`data-${string}`, string | undefined>) {
  return (
    <Tag className={cx("rounded-xl border border-line bg-surface-1", className)} {...rest}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title && <h3 className="eyebrow text-ink-3">{title}</h3>}
          {actions}
        </div>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </Tag>
  );
}
