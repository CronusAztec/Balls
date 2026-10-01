import { createGlassView, mapGlassShards, type GlassField, type GlassHome, type GlassLevel, type GlassView } from "../modes/glass";
import type { StageBounds, StageMap } from "./stage";

/**
 * The Glass Smash pieces the journey's glass, gate and HOME stages share: a `GlassLevel` / `GlassView` of their own, so
 * Glass Smash's rules (modes/glass.ts `hitGlassPane()`, `spawnGlassShards()`, `stepGlassShards()`, `walkToDoor()`…)
 * play on them and the Glass Smash renderer (components/simulator/glassRenderer.ts `drawGlassWorld()` /
 * `drawGlassShards()`) draws their panes, cracks, shards, gate rows and doorway exactly as it draws Glass Smash; and
 * what only the journey does to them – follow the floating origin and the stage's bounds.
 */

/** The glass field of a stage: its column band, with the view height as the layout unit (what the renderer sizes by). */
export function fieldOfBounds(b: StageBounds): GlassField {
  return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.viewH, cx: b.cx };
}

/** A doorway far above everything: the renderer skips it (for the stages without HOME). */
export function noHome(): GlassHome {
  return { top: -1e9, groundY: -1e9, doorX: 0, doorWidth: 1, doorHeight: 1 };
}

/** A level holding only what a stage gives it (panes, gate rows or the doorway). */
export function stageGlassLevel(b: StageBounds, ballRadius: number): GlassLevel {
  return { field: fieldOfBounds(b), stages: [], panes: [], gates: [], home: noHome(), worldBottom: -1e9, tempo: 1, startX: b.cx, startY: b.top, startVx: 0, ballRadius };
}

/** A Glass Smash view around `level` (camera 0: the canvas scrolls the whole journey; no Glass Smash stage banner). */
export function stageGlassView(level: GlassLevel): GlassView {
  const view = createGlassView(level);
  view.bannerAtMs = -Infinity;
  return view;
}

/** Keeps a level's field in step with its stage's bounds (after a shift or a rescale). */
export function syncField(level: GlassLevel, b: StageBounds) {
  const f = level.field;
  f.left = b.left;
  f.right = b.right;
  f.top = b.top;
  f.bottom = b.bottom;
  f.width = b.width;
  f.height = b.viewH;
  f.cx = b.cx;
}

/** Moves a stage's shards by `dy` (the floating origin). */
export function shiftShards(view: GlassView, dy: number) {
  for (let i = 0; i < view.shardCount; i++) view.shardY[i] += dy;
}

/** Maps a stage's shards onto a resized canvas (Glass Smash's `mapGlassShards()`). */
export function rescaleShards(view: GlassView, map: StageMap) {
  mapGlassShards(view, map.x, map.y, map.k);
}
