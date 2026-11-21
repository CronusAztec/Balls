/*
 * --- run-link --- The seed a link to the studio carries. While a run is pinned (a found run, a seed from a link, the clip
 * planner's), the address bar and the copied share link name its seed, so a reload, a bookmark, the language switch or a
 * friend opens the same run. Pure: Simulator.tsx reads the engine's pinned seed and writes the address with these.
 */

/** The address parameter of a run's seed (the page reads it once, on load: parseSeed in lib/recording/batch.ts). */
export const SEED_PARAM = "seed";

/**
 * The seed the page's links carry right now: the pinned seed, or none. A split-screen race keeps its arenas' seeds in its
 * settings, and a daily challenge's link is its date, so neither adds one.
 */
export function linkSeedOf(o: { pinned: number | null; arenaCount: number; daily: boolean }): number | null {
  if (o.pinned === null || !Number.isFinite(o.pinned) || o.arenaCount > 1 || o.daily) return null;
  return Math.trunc(o.pinned);
}

/** A query (with or without its "?") with the seed set to `seed`, or without one for null: every other parameter kept in its place. No "?" in front. */
export function withLinkSeed(search: string, seed: number | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (seed === null) params.delete(SEED_PARAM);
  else params.set(SEED_PARAM, String(Math.trunc(seed)));
  return params.toString();
}

/** A link (absolute, or a path with a query) with its seed set to `seed`, or taken out for null; its hash kept. */
export function linkWithSeed(link: string, seed: number | null): string {
  const hashAt = link.indexOf("#");
  const hash = hashAt >= 0 ? link.slice(hashAt) : "";
  const bare = hashAt >= 0 ? link.slice(0, hashAt) : link;
  const queryAt = bare.indexOf("?");
  const base = queryAt >= 0 ? bare.slice(0, queryAt) : bare;
  const query = withLinkSeed(queryAt >= 0 ? bare.slice(queryAt + 1) : "", seed);
  return `${base}${query ? `?${query}` : ""}${hash}`;
}
