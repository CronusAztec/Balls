import { defaultSettings, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { isAttributionParam } from "@/lib/analytics/attribution";

/*
 * --- panel-basics --- What the studio remembers for a visitor, pure (Controls.tsx holds the React side):
 *  - the undo history: snapshots of the settings, one per pause in the visitor's changes, restored within one mode;
 *  - the last studio address: the query of the studio's last address, kept in this browser only, so a visit to the bare
 *    studio address can offer to continue where the last one left off. It is offered, never applied on its own: a bare
 *    link opens the defaults, as shared links and tests expect.
 * Storage is a convenience: every read and write is in a try/catch, and a missing, blocked or damaged store reads empty.
 */

/** The most snapshots the undo history keeps. */
export const UNDO_LIMIT = 50;

/** How long the settings must rest after a change before it becomes one step of the history (ms). */
export const UNDO_SETTLE_MS = 400;

/**
 * The patch that brings `current` back to `snapshot` through the page's own update path: every field that differs, the
 * mode left out (a mode switch builds its own settings: the history is cleared there). Null when there is nothing to
 * restore or the snapshot belongs to another mode.
 */
export function undoPatch(snapshot: SimulatorSettings, current: SimulatorSettings): Partial<SimulatorSettings> | null {
  if (snapshot.mode !== current.mode) return null;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(snapshot) as (keyof SimulatorSettings)[]) {
    if (key === "mode") continue;
    const before = snapshot[key];
    const now = current[key];
    if (before === now) continue;
    if (typeof before === "object" && before !== null && JSON.stringify(before) === JSON.stringify(now)) continue;
    patch[key] = before;
  }
  return Object.keys(patch).length > 0 ? (patch as Partial<SimulatorSettings>) : null;
}

/** The history with `snapshot` as its newest step, at most UNDO_LIMIT long (the oldest steps go first). */
export function pushUndo(history: readonly SimulatorSettings[], snapshot: SimulatorSettings): SimulatorSettings[] {
  const next = [...history, snapshot];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

/** Whether a keyboard event's target is a field that keeps Ctrl/Cmd+Z for its own text (a range or a button does not). */
export function typesText(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"].includes(type);
}

/**
 * --- studio-play --- Whether Space on a keyboard event's target presses that control itself (a button, a link, a switch,
 * a tab, a summary): the page's Space shortcut (start, pause, resume) leaves it to the browser then.
 */
export function pressesItself(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return !!(target as Element).closest('button, a[href], summary, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"]');
}

/** --- panel-basics --- The storage key of the studio's last address query. */
export const LAST_STUDIO_KEY = "jumpingballslive_last_studio";

/** The longest query kept (a share code can be long; past this the address is not remembered). */
export const LAST_STUDIO_MAX = 8000;

/**
 * A query worth remembering or offering, without the campaign's attribution (utm_*, gclid…: a visit it brought is not
 * brought again): a mode among its keys, short enough. Else null.
 */
export function studioQueryOf(search: string | null | undefined): string | null {
  if (typeof search !== "string" || search.length > LAST_STUDIO_MAX) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  for (const key of [...params.keys()]) if (isAttributionParam(key)) params.delete(key);
  if (!params.get("mode")) return null;
  return `?${params.toString()}`;
}

/** The mode a remembered query opens (null: none). */
export function studioQueryMode(query: string): string | null {
  try {
    return new URLSearchParams(query).get("mode");
  } catch {
    return null;
  }
}

type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/**
 * --- review fix (panel-basics) --- Whether a query is the one the studio writes for a bare arrival (the default mode with
 * its defaults, nothing else): after a reload or Back that address is no longer bare, and it must not replace the last
 * visit, nor be offered as one (it opens what the bare address opens).
 */
export function isBareStudioQuery(query: string): boolean {
  bareQuery ??= `?${settingsToSearchParams(defaultSettings()).toString()}`;
  return query === bareQuery;
}
let bareQuery: string | undefined;

/** Remembers the studio's address query (only one worth offering: a bare address never wipes the last one). */
export function rememberStudioQuery(search: string): void {
  const query = studioQueryOf(search);
  if (!query || isBareStudioQuery(query)) return;
  try {
    store()?.setItem(LAST_STUDIO_KEY, query);
  } catch {
    /* a blocked or full store: nothing is remembered */
  }
}

/** The remembered query, or null (none, unreadable, damaged). */
export function readStudioQuery(): string | null {
  try {
    const query = studioQueryOf(store()?.getItem(LAST_STUDIO_KEY));
    return query && !isBareStudioQuery(query) ? query : null;
  } catch {
    return null;
  }
}
