"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { cx } from "./cx";

/*
 * --- site-redesign --- The small info tooltip next to a control's label (the API the panel has always used:
 * <Tooltip text="…" />). The text stays in the DOM – it is part of the control's description for screen readers and
 * of the names tools match – and shows on hover in a surface-3 bubble.
 * --- studio-fit --- It also opens without a mouse: a tap toggles it (a tap anywhere else closes it), and the keyboard's
 * Tab stops on it and shows it until the focus leaves or Escape is pressed. On a touch screen its target is 24 px. The
 * bubble stays inside the box that clips it (the panel's scroll box, a dialog, the window): it lines up with the icon's
 * left or right edge near a side, and opens below the icon near the top. A tap on it is its own: the label around it
 * neither checks its switch nor focuses its field. (`data-tip` keeps it out of the "first control" a dialog or the
 * palette focuses.)
 */
export default function Tooltip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ x: "center" | "start" | "end"; below: boolean }>({ x: "center", below: false });
  /** Where the bubble fits: measured before it shows (it is always rendered, see-through while hidden). */
  const measure = () => {
    const icon = ref.current;
    const bubble = bubbleRef.current;
    if (!icon || !bubble) return;
    const r = icon.getBoundingClientRect();
    const box = clipBox(icon);
    const mid = r.left + r.width / 2;
    const half = bubble.offsetWidth / 2 + 8;
    const x = mid - half < box.left ? "start" : mid + half > box.right ? "end" : "center";
    const below = r.top - bubble.offsetHeight - 8 < box.top;
    setPlace((p) => (p.x === x && p.below === below ? p : { x, below }));
  };
  // A tap anywhere else closes an open bubble.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const onClick = (e: MouseEvent<HTMLSpanElement>) => {
    // (inside a <label> a click would check its switch or focus its field: the tap is the tooltip's alone)
    e.preventDefault();
    e.stopPropagation();
    measure();
    setOpen((o) => !o);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "Escape" || !open) return;
    // (the first Escape closes the bubble only: a dialog around it stays open)
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };
  return (
    <span
      ref={ref}
      tabIndex={0}
      data-tip=""
      data-open={open ? "true" : undefined}
      onPointerEnter={(e) => e.pointerType !== "touch" && measure()}
      onFocus={(e) => {
        // (a tap focuses it too: only the keyboard's focus opens it, the tap's click toggles it)
        if (!focusVisible(e.currentTarget)) return;
        measure();
        setOpen(true);
      }}
      onBlur={() => setOpen(false)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="group/tip relative ml-1 inline-flex items-center rounded-full align-middle cursor-help text-ink-3 outline-offset-2 hover:text-ink-2 data-[open=true]:text-ink-2 [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-[5px] [@media(pointer:coarse)]:before:content-['']"
    >
      <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 9.2v4.3M10 6.6v.1" />
      </svg>
      <span
        ref={bubbleRef}
        className={cx(
          "pointer-events-none absolute z-50 w-56 max-w-[calc(100vw-32px)] rounded-md border border-line bg-surface-3 px-2.5 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink whitespace-normal opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100 group-data-[open=true]/tip:opacity-100",
          place.below ? "top-full mt-2" : "bottom-full mb-2",
          place.x === "start" ? "-left-1" : place.x === "end" ? "-right-1" : "left-1/2 -translate-x-1/2",
        )}
      >
        {text}
      </span>
    </span>
  );
}

/** The box that would cut the bubble off: the nearest ancestor that clips its overflow, else the window below the header. */
function clipBox(el: HTMLElement): { left: number; right: number; top: number } {
  for (let at = el.parentElement; at && at !== document.body && at !== document.documentElement; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
      const r = at.getBoundingClientRect();
      return { left: Math.max(0, r.left), right: Math.min(window.innerWidth, r.right), top: Math.max(0, r.top) };
    }
  }
  return { left: 0, right: window.innerWidth, top: document.querySelector("header")?.getBoundingClientRect().bottom ?? 0 };
}

/** Whether the element has keyboard focus (:focus-visible), so a tap does not open and then close it again. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}
