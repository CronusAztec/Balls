import type { ModeId } from "@/lib/physics/types";

/*
 * --- mode-pages --- (Lane E, E3) The address of a mode's page, alone: the modes wall's info button and the studio's About this
 * mode link need only this, and lib/modePages.ts (the page's looks, intros and settings) would bring the gallery's copy into
 * their scripts.
 */

/** The route of the mode pages, without the language. */
export const MODE_PAGES_PATH = "/modes";

/** A mode's address word: the id in kebab case ("doublePendulum" → "double-pendulum"), as a search result shows it. */
export function modeSlug(mode: ModeId): string {
  return mode.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** A mode page's route without the language ("/modes/double-pendulum"), for next-intl's Link and pageMetadata's `path`. */
export function modePagePath(mode: ModeId): string {
  return `${MODE_PAGES_PATH}/${modeSlug(mode)}`;
}
