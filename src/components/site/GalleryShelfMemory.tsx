"use client";

import { useLayoutEffect } from "react";
import { MODE_SHELF_IDS, wallStateFromSearch, wallStateToSearch, type ShelfId } from "@/lib/siteDesign";

/*
 * --- site-nav --- The gallery's shelf chips keep the chosen shelf in the address, as the modes wall does (?family=music,
 * the wall's parameter), so Back from a preset and a reload show the same shelf and the card the visitor left. The chips
 * are radio buttons that filter through CSS and work without scripts: this only writes the address when one is chosen and,
 * after mount, checks the chip the address names. The check runs before the browser paints, so a step back restores its
 * scroll position on the filtered list it was taken on.
 * --- gallery-every-mode --- (E2 review) The mode chips are a radio group of their own (`modeName`, value "all" or the mode
 * id): a mode goes into the address next to its shelf (?family=music&mode=songRing) and comes back the same way. Choosing
 * another shelf puts the mode row back on its All chip, so a mode of the last shelf is not left on. An older address that
 * names a mode alone (?mode=sandPlate) opens that mode's shelf with it (the chip's data-shelf).
 */

/** The address parameter of the chosen mode chip. */
const MODE_PARAM = "mode";
/** The mode row's chip that shows the whole shelf. */
const ALL_MODES = "all";

export default function GalleryShelfMemory({ name, modeName }: { name: string; modeName: string }) {
  useLayoutEffect(() => {
    const radios = (group: string) => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${group}"]`));
    const mode = new URLSearchParams(window.location.search).get(MODE_PARAM);
    const modeRadio = mode && mode !== ALL_MODES ? radios(modeName).find((radio) => radio.value === mode) : undefined;
    const { shelf } = wallStateFromSearch(window.location.search);
    // (a mode's own shelf wins over the address's: the mode filters only together with it)
    const modeShelf = modeRadio?.closest<HTMLElement>("[data-shelf]")?.dataset.shelf;
    const shelfRadio = radios(name).find((radio) => radio.value === (modeShelf ?? shelf));
    if (shelfRadio && !shelfRadio.checked) shelfRadio.checked = true;
    if (modeRadio && !modeRadio.checked) modeRadio.checked = true;
    const write = () => {
      try {
        const chosenShelf = radios(name).find((radio) => radio.checked)?.value ?? "all";
        const chosenMode = radios(modeName).find((radio) => radio.checked)?.value ?? ALL_MODES;
        const shelfId: ShelfId | "all" = (MODE_SHELF_IDS as readonly string[]).includes(chosenShelf) ? (chosenShelf as ShelfId) : "all";
        const params = new URLSearchParams(wallStateToSearch({ ...wallStateFromSearch(window.location.search), shelf: shelfId }, window.location.search));
        if (shelfId !== "all" && chosenMode !== ALL_MODES) params.set(MODE_PARAM, chosenMode);
        else params.delete(MODE_PARAM);
        const search = params.toString() ? `?${params.toString()}` : "";
        // (the entry's own state is kept; the router's keys are left out, so it adds its own and learns the address)
        const kept = Object.fromEntries(Object.entries((window.history.state ?? {}) as Record<string, unknown>).filter(([key]) => key !== "__NA" && key !== "__PRIVATE_NEXTJS_INTERNALS_TREE"));
        window.history.replaceState(kept, "", `${window.location.pathname}${search}${window.location.hash}`);
      } catch {
        /* an address that cannot be written: the chips still filter */
      }
    };
    const onChange = (e: Event) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || !input.checked || (input.name !== name && input.name !== modeName)) return;
      if (input.name === name) {
        // another shelf: its mode row starts on All
        const all = radios(modeName).find((radio) => radio.value === ALL_MODES);
        if (all) all.checked = true;
      }
      write();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [name, modeName]);
  return null;
}
