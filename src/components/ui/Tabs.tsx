"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

/*
 * --- site-redesign --- A strip of section switches: the studio's rail (vertical, ≥ 1280 px) and its tab strip
 * (horizontal, below). Every item is a toggle button – aria-pressed and aria-expanded on the open ones, aria-controls on
 * the panel it fills – so it keeps the semantics (and the accessible names) of the panel's old section headers; a press
 * on the open item closes it again. Arrow keys move along the strip (both axes, it turns with the layout), Home / End
 * jump to its ends; one Tab stop for the whole strip (roving tabindex).
 *
 * --- review fix (site-redesign) --- The hover label of an icon-only strip (`tooltipClassName`) is drawn in a fixed layer on
 * <body> beside the button – on mouse hover and keyboard focus – so the strip's own scroll box (the rail scrolls vertically,
 * which clips it sideways too) cannot cut it off; every item also carries its label as a title.
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
  // The hover label: which item, and the button's right edge and middle in the viewport (it hides on any scroll or resize).
  const [tip, setTip] = useState<{ id: string; label: string; x: number; y: number } | null>(null);
  const showTip = (item: TabStripItem, el: HTMLElement) => {
    if (!tooltipClassName) return;
    const r = el.getBoundingClientRect();
    setTip({ id: item.id, label: item.label, x: r.right, y: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [tip]);
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
            onPointerEnter={(e) => e.pointerType !== "touch" && showTip(item, e.currentTarget)}
            onPointerLeave={hideTip}
            onFocus={(e) => focusVisible(e.currentTarget) && showTip(item, e.currentTarget)}
            onBlur={hideTip}
            title={item.label}
            data-section={item.id}
            className={cx("group/tab relative cursor-pointer", itemClassName, item.className)}
          >
            {item.icon}
            <span className={labelClassName}>{item.label}</span>
          </button>
        );
      })}
      {tip &&
        tooltipClassName &&
        createPortal(
          <span
            aria-hidden="true"
            data-tab-tip={tip.id}
            className={cx("pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface-3 px-2 py-1 text-xs font-medium text-ink shadow-[var(--shadow-float)] animate-fadeIn", tooltipClassName)}
            style={{ left: tip.x + 8, top: tip.y }}
          >
            {tip.label}
          </span>,
          document.body,
        )}
    </div>
  );
}

/** Whether the element has keyboard focus (:focus-visible), so a click does not leave a label hanging. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}
