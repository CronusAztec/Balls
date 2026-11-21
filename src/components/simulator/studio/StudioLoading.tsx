"use client";

import { useLayoutEffect, useRef } from "react";
import Navbar from "@/components/site/Navbar";
import { skeletonModeOf } from "./StudioSkeleton";

/*
 * --- review fix (studio-first-open) --- The client parts of the studio's loading screen on a client-side navigation into the
 * studio (a mode card, the hero's pictures, Open the studio): the simulator layout's Suspense fallback
 * (app/[locale]/simulator/layout.tsx) is the studio's header and its skeleton, drawn by React in the browser, where an inline
 * script that React inserts never runs.
 * Only the layout imports this module, and that matters: a client module the page imports too (the Navbar itself, anything
 * StudioSkeleton.tsx imports) is listed with the page's scripts, the whole studio, and a fallback that waits for those shows
 * nothing until the studio is there. Through this module the fallback needs the layout's small script alone.
 */

/** The studio's header while the studio loads (the page's own header takes over with the page). */
export function StudioLoadingHeader() {
  return <Navbar variant="studio" />;
}

/**
 * Puts the poster and the name of the mode the address names into the skeleton it is part of (the elements the inline script
 * fills in). A layout effect, so before the first paint, and after the router has put the new address in place (it does
 * that in an insertion effect of the same commit).
 */
export function SkeletonModeFill({ names, base }: { names: Readonly<Record<string, string>>; base: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = ref.current?.closest("[data-studio-skeleton]");
    const img = root?.querySelector<HTMLImageElement>("img[data-skeleton-poster]");
    const name = root?.querySelector("[data-skeleton-name]");
    const id = skeletonModeOf(window.location.search, names);
    if (!id || !img || !name) return;
    img.setAttribute("fetchpriority", "high");
    img.src = `${base}/modes/${id}.webp`;
    name.textContent = names[id];
  }, [names, base]);
  return <span ref={ref} hidden />;
}
