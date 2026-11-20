import { MODE_IDS, type ModeId } from "@/lib/physics/types";

/*
 * --- mode-shelves --- The modes a visitor picked last, newest first: the "Recent" row of the studio's mode picker. A
 * convenience of this browser only: one localStorage entry with a few mode ids, read and written inside try/catch, so a
 * browser without storage simply has no row. Nothing is sent anywhere.
 */

export const RECENT_MODES_KEY = "jbl-recent-modes";
export const RECENT_MODES_MAX = 6;

/** A stored value as a list of known mode ids, each once, at most RECENT_MODES_MAX: anything else in it is dropped. */
export function parseRecentModes(raw: string | null | undefined): ModeId[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const known = list.filter((id): id is ModeId => typeof id === "string" && (MODE_IDS as readonly string[]).includes(id));
    return [...new Set(known)].slice(0, RECENT_MODES_MAX);
  } catch {
    return [];
  }
}

/** `list` with `mode` moved to the front. */
export function withRecentMode(list: readonly ModeId[], mode: ModeId): ModeId[] {
  return [mode, ...list.filter((id) => id !== mode)].slice(0, RECENT_MODES_MAX);
}

/** The stored picks ([] on the server and without storage). */
export function readRecentModes(): ModeId[] {
  try {
    return typeof window === "undefined" ? [] : parseRecentModes(window.localStorage.getItem(RECENT_MODES_KEY));
  } catch {
    return [];
  }
}

/**
 * Remembers a pick, and before it the mode the visitor leaves for it (`leaving`: the studio's current mode), so the row
 * offers the way back to a mode that was never picked from a card (one a link opened). A no-op without storage.
 */
export function rememberRecentMode(mode: ModeId, leaving?: ModeId): void {
  try {
    const list = leaving && leaving !== mode ? withRecentMode(readRecentModes(), leaving) : readRecentModes();
    window.localStorage.setItem(RECENT_MODES_KEY, JSON.stringify(withRecentMode(list, mode)));
  } catch {
    /* no storage: the row stays empty */
  }
}
