"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
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
 * --- review fix (studio-fit) --- Where its box is too short for it above or below the icon (the phone's sheet, a phone
 * held sideways), the bubble is drawn in a layer of its own over the page, on the side of the icon with more room in the
 * window. The text stays in place for screen readers: that layer is a copy they do not read.
 */
export default function Tooltip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place>({ x: "center", below: false, layer: null });
  const [hover, setHover] = useState(false);
  /** Where the bubble fits: measured before it shows (it is always rendered, see-through while hidden). */
  const measure = () => {
    const icon = ref.current;
    const bubble = bubbleRef.current;
    if (!icon || !bubble) return;
    const r = icon.getBoundingClientRect();
    const box = clipBox(icon);
    const mid = r.left + r.width / 2;
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const half = width / 2 + 8;
    const x = mid - half < box.left ? "start" : mid + half > box.right ? "end" : "center";
    // --- review fix (studio-fit) --- above the icon where it fits in its box, else below, else in the layer over the page
    let next: Place;
    if (height <= r.top - box.top - 8) next = { x, below: false, layer: null };
    else if (height <= box.bottom - r.bottom - 8) next = { x, below: true, layer: null };
    else {
      const top0 = topEdge();
      const top = r.top - 8 - top0 >= window.innerHeight - r.bottom - 8 ? r.top - 8 - height : r.bottom + 8;
      const host = icon.closest("dialog") ?? document.body;
      const origin = fixedOrigin(host);
      next = {
        x,
        below: false,
        layer: {
          left: Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, mid - width / 2)) - origin.left),
          top: Math.round(Math.max(top0 + 8, Math.min(window.innerHeight - height - 8, top)) - origin.top),
          host,
        },
      };
    }
    setPlace((p) => (p.x === next.x && p.below === next.below && p.layer?.left === next.layer?.left && p.layer?.top === next.layer?.top && p.layer?.host === next.layer?.host ? p : next));
  };
  // A tap anywhere else closes an open bubble. --- review fix (studio-fit) --- a bubble in the layer follows a scroll.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  const bubbleClass = "pointer-events-none z-50 w-56 max-w-[calc(100vw-32px)] rounded-md border border-line bg-surface-3 px-2.5 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink whitespace-normal";
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
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        measure();
        setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
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
          bubbleClass,
          "absolute opacity-0 transition-opacity duration-150",
          !place.layer && "group-hover/tip:opacity-100 group-data-[open=true]/tip:opacity-100",
          place.below ? "top-full mt-2" : "bottom-full mb-2",
          place.x === "start" ? "-left-1" : place.x === "end" ? "-right-1" : "left-1/2 -translate-x-1/2",
        )}
      >
        {text}
      </span>
      {place.layer &&
        (open || hover) &&
        createPortal(
          <span aria-hidden="true" data-tip-layer="" className={cx(bubbleClass, "fixed animate-fadeIn")} style={{ left: place.layer.left, top: place.layer.top }}>
            {text}
          </span>,
          place.layer.host,
        )}
    </span>
  );
}

/** Where the bubble shows: beside the icon in its box, or (`layer`) at a place over the page, in `host`. */
interface Place {
  x: "center" | "start" | "end";
  below: boolean;
  layer: { left: number; top: number; host: HTMLElement } | null;
}

/** Where a fixed box at left 0, top 0 inside `host` shows in the window (0, 0 unless the host's transform holds it). */
function fixedOrigin(host: HTMLElement): { left: number; top: number } {
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden";
  host.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { left: r.left, top: r.top };
}

/** The top of the window's free area: under the header and under the studio's tab strip where it sticks below it. */
function topEdge(): number {
  let top = Math.max(0, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
  const rail = document.querySelector<HTMLElement>(".studio-rail");
  if (rail && getComputedStyle(rail).position === "sticky") {
    const r = rail.getBoundingClientRect();
    if (r.width > r.height && Math.abs(r.top - top) <= 1) top = r.bottom;
  }
  return top;
}

/**
 * The box that would cut the bubble off: across, the nearest ancestor that clips across; down, the nearest one that clips
 * down (a page that only clips sideways, `overflow-x: clip`, cuts nothing above or below), and never above the header and
 * the tab strip stuck under it.
 */
function clipBox(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const box = { left: 0, right: window.innerWidth, top: topEdge(), bottom: window.innerHeight };
  let across = false;
  let down = false;
  for (let at = el.parentElement; at && at !== document.body && at !== document.documentElement && !(across && down); at = at.parentElement) {
    const style = getComputedStyle(at);
    const clipsX = !across && style.overflowX !== "visible";
    const clipsY = !down && style.overflowY !== "visible";
    if (!clipsX && !clipsY) continue;
    const r = at.getBoundingClientRect();
    if (clipsX) {
      box.left = Math.max(box.left, r.left);
      box.right = Math.min(box.right, r.right);
      across = true;
    }
    if (clipsY) {
      box.top = Math.max(box.top, r.top);
      box.bottom = Math.min(box.bottom, r.bottom);
      down = true;
    }
  }
  return box;
}

/** Whether the element has keyboard focus (:focus-visible), so a tap does not open and then close it again. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}
