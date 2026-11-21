"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/*
 * --- home-looks --- (E2 review) The landing page's row of looks keeps how far it was scrolled sideways: Back from a card
 * shows the card the visitor opened, not the row's first two again. The position lives in the page's own history entry
 * (history.state, which the router keeps on Back and leaves out of a new visit), written a moment after the row stops
 * moving and read before the first paint. A browser that refuses either simply starts the row at its first card.
 */

/** The key of the row's position in the history entry's state. */
const STATE_KEY = "jblHomeRow";

export default function HomeGalleryRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    try {
      const saved = (window.history.state as Record<string, unknown> | null)?.[STATE_KEY];
      if (typeof saved === "number" && Number.isFinite(saved) && saved > 0) row.scrollLeft = saved;
    } catch {
      /* no history state: the row starts at its first card */
    }
    let timer: number | undefined;
    const save = () => {
      try {
        window.history.replaceState({ ...((window.history.state as Record<string, unknown> | null) ?? {}), [STATE_KEY]: Math.round(row.scrollLeft) }, "");
      } catch {
        /* the position is a convenience only */
      }
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 150);
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      row.removeEventListener("scroll", onScroll);
    };
  }, []);
  return (
    <ul ref={ref} className={className} data-testid="home-gallery-row">
      {children}
    </ul>
  );
}
