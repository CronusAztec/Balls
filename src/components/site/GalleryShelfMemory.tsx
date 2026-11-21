"use client";

import { useLayoutEffect } from "react";
import { MODE_SHELF_IDS, wallStateFromSearch, wallStateToSearch, type ShelfId } from "@/lib/siteDesign";

/*
 * --- site-nav --- The gallery's shelf chips keep the chosen shelf in the address, as the modes wall does (?family=music,
 * the wall's parameter), so Back from a preset and a reload show the same shelf and the card the visitor left. The chips
 * are radio buttons that filter through CSS and work without scripts: this only writes the address when one is chosen and,
 * after mount, checks the chip the address names. The check runs before the browser paints, so a step back restores its
 * scroll position on the filtered list it was taken on.
 * --- gallery-every-mode --- The mode chips are radios of the same group (value "mode:classic"): a mode goes into the address
 * as ?mode=classic in place of the shelf, and comes back the same way.
 */

/** The address parameter of the chosen mode chip. */
const MODE_PARAM = "mode";
/** A mode chip's radio value: "mode:" and the mode id. */
const MODE_VALUE = "mode:";

export default function GalleryShelfMemory({ name }: { name: string }) {
  useLayoutEffect(() => {
    const radios = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`));
    const mode = new URLSearchParams(window.location.search).get(MODE_PARAM);
    const { shelf } = wallStateFromSearch(window.location.search);
    const named = (mode ? radios().find((radio) => radio.value === `${MODE_VALUE}${mode}`) : undefined) ?? radios().find((radio) => radio.value === shelf);
    if (named && !named.checked) named.checked = true;
    const onChange = (e: Event) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.name !== name || !input.checked) return;
      const pickedMode = input.value.startsWith(MODE_VALUE) ? input.value.slice(MODE_VALUE.length) : "";
      const chosen: ShelfId | "all" = (MODE_SHELF_IDS as readonly string[]).includes(input.value) ? (input.value as ShelfId) : "all";
      try {
        const params = new URLSearchParams(wallStateToSearch({ ...wallStateFromSearch(window.location.search), shelf: chosen }, window.location.search));
        if (pickedMode) params.set(MODE_PARAM, pickedMode);
        else params.delete(MODE_PARAM);
        const search = params.toString() ? `?${params.toString()}` : "";
        // (the entry's own state is kept; the router's keys are left out, so it adds its own and learns the address)
        const kept = Object.fromEntries(Object.entries((window.history.state ?? {}) as Record<string, unknown>).filter(([key]) => key !== "__NA" && key !== "__PRIVATE_NEXTJS_INTERNALS_TREE"));
        window.history.replaceState(kept, "", `${window.location.pathname}${search}${window.location.hash}`);
      } catch {
        /* an address that cannot be written: the chips still filter */
      }
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [name]);
  return null;
}
