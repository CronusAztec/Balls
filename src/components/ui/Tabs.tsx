"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- A strip of section switches: the studio's rail (vertical, ≥ 1280 px) and its tab strip
 * (horizontal, below). Every item is a toggle button – aria-pressed and aria-expanded on the open ones, aria-controls on
 * the panel it fills – so it keeps the semantics (and the accessible names) of the panel's old section headers; a press
 * on the open item closes it again. Arrow keys move along the strip (both axes, it turns with the layout), Home / End
 * jump to its ends; one Tab stop for the whole strip (roving tabindex).
 */
export interface TabStripItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Extra classes for this item (e.g. a separator before it). */
  className?: string;
}

export default function TabStrip({
  items,
  active,
  onSelect,
  label,
  controls,
  className,
  itemClassName,
  labelClassName,
  tooltipClassName,
}: {
  items: readonly TabStripItem[];
  /** The open item – or items, where several can be open at once (the studio's rail). */
  active: string | readonly string[] | null;
  onSelect: (id: string) => void;
  label: string;
  /** The id of the panel the items fill. */
  controls?: string;
  className?: string;
  /** Classes of every item (layout per breakpoint); the pressed state is styled through aria-pressed. */
  itemClassName?: string;
  /** Classes of the text label (e.g. sr-only where the strip shows icons only). */
  labelClassName?: string;
  /** Classes of the hover label (shown where the text label is hidden); leave out for none. */
  tooltipClassName?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isOn = (id: string) => (Array.isArray(active) ? active.includes(id) : id === active);
  const activeIndex = Math.max(0, items.findIndex((i) => isOn(i.id)));
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };
  return (
    <div role="toolbar" aria-label={label} className={className}>
      {items.map((item, index) => {
        const on = isOn(item.id);
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            aria-pressed={on}
            aria-expanded={on}
            aria-controls={controls}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            data-section={item.id}
            className={cx("group/tab relative cursor-pointer", itemClassName, item.className)}
          >
            {item.icon}
            <span className={labelClassName}>{item.label}</span>
            {tooltipClassName && (
              <span aria-hidden="true" className={cx("pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line bg-surface-3 px-2 py-1 text-xs font-medium text-ink opacity-0 transition-opacity duration-150 group-hover/tab:opacity-100 group-focus-visible/tab:opacity-100", tooltipClassName)}>
                {item.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
