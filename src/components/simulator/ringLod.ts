/**
 * --- review fix (recording-export) --- Level of detail for the ring walls. A link may carry far more rings than the slider
 * offers (`wc=3000`: big values are kept on purpose). The physics runs up to its soft ceiling of them (`LIVE_RING_LIMIT` in
 * lib/physics/softCeilings.ts – review fix (security-robustness)), but drawing a thousand arcs a frame
 * froze the page, and rings closer together than a pixel only paint over each other: past `RING_LOD_FROM` rings, about
 * one ring per world pixel of the band they fill (0.4–1 × the arena radius) is drawn, evenly spread, the outermost – the
 * arena's edge – always. Pure (the canvas and the fast export draw the same rings), allocation-free.
 */

/** Up to this many rings every ring is drawn (the slider's whole range and far beyond). */
export const RING_LOD_FROM = 100;

/** Every how many rings one is drawn (a fraction; 1 = all of them) for `count` rings in an arena of radius `arenaRadius` (world px). */
export function ringDrawStride(count: number, arenaRadius: number): number {
  if (!(count > RING_LOD_FROM)) return 1;
  const budget = Math.max(RING_LOD_FROM, Math.floor(0.6 * arenaRadius));
  return count > budget ? count / budget : 1;
}

/** Whether ring `index` of `count` is drawn at `stride` (ringDrawStride()): evenly spread, the outermost always. */
export function ringDrawn(index: number, count: number, stride: number): boolean {
  if (stride <= 1 || index >= count - 1) return true;
  return Math.floor(index / stride) !== Math.floor((index - 1) / stride);
}
