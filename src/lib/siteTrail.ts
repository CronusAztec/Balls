/*
 * --- site-nav --- Which page of the site the visitor was on before this one, while the pages change without a reload (the
 * header of every page reports its path here). The studio's back arrow reads it: when the visitor came from the landing
 * page, going back in the browser's history returns them to the card they left from; a link could only lead to the top.
 * Kept in memory alone: a reload, a new tab or a link from elsewhere starts with no page before, and the arrow is a link.
 * A language switch also passes through here: it shows the same page again under a new history state, so it hands the
 * old state over, and the modes wall finds its search there and knows the visitor did not just arrive. It also forgets the
 * page before: the history entry behind the switched page is in the old language, so a step back would change the
 * language back, and the arrow is a link to the wall in the new one.
 */

let before: string | null = null;
let now: string | null = null;
let handed: { path: string; state: unknown; at: number } | null = null;
/** How long a handed-over state waits for its page (a switch that never arrived must not mark a later visit). */
const HAND_OVER_MS = 10_000;

/** The header's report: the page shown now (its path without the language, "/" for the landing page). */
export function visitPage(path: string): void {
  if (path === now) return;
  before = now;
  now = path;
}

/** The page shown before this one, or null when this is the first page of the visit. */
export function pageBefore(): string | null {
  return before;
}

/** A language switch forgets the page before this one (the page itself stays the one shown). */
export function forgetBefore(): void {
  before = null;
}

/** A language switch hands this page's history state on to the same page in the new language. */
export function handOverState(path: string, state: unknown, at = Date.now()): void {
  handed = { path, state, at };
}

/** The state handed over to the page at `path` a moment ago, once: null for another page, a second ask or a late one. */
export function takeHandedState(path: string, at = Date.now()): unknown {
  const held = handed;
  handed = null;
  return held && held.path === path && at - held.at >= 0 && at - held.at < HAND_OVER_MS ? held.state : null;
}

/** Forgets the trail (the tests start from a first page). */
export function resetTrail(): void {
  before = null;
  now = null;
  handed = null;
}
