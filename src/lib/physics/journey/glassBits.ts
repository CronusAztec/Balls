import { DEFAULT_GLASS_SETTINGS, MAX_SHARDS, shardCount, solidSpan, type GlassField, type GlassHome, type GlassLevel, type GlassPane, type GlassView } from "../modes/glass";
import type { StageBounds, StageMap } from "./stage";

/**
 * The Glass Smash pieces the journey's glass, gate and HOME stages share: a `GlassLevel` / `GlassView` of their own, so
 * the Glass Smash renderer (components/simulator/glassRenderer.ts `drawGlassWorld()` / `drawGlassShards()`) draws their
 * panes, cracks, gate rows and doorway exactly as it draws Glass Smash, and the shard pool (a copy of Glass Smash's
 * visual shards: typed arrays, seeded from the engine's generator, flying under gravity and bouncing off the column).
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

/** A Glass Smash view around `level` (camera 0: the canvas scrolls the whole journey). */
export function stageGlassView(level: GlassLevel): GlassView {
  return {
    level,
    settings: { ...DEFAULT_GLASS_SETTINGS },
    timeMs: 0,
    cameraY: 0,
    stage: 0,
    bannerStage: 0,
    bannerAtMs: -Infinity,
    hits: 0,
    shattered: 0,
    cleared: 0,
    panes: level.panes.length,
    homeReached: false,
    homeAtMs: -Infinity,
    finished: false,
    gatesPassed: 0,
    shardCount: 0,
    shardX: new Float64Array(MAX_SHARDS),
    shardY: new Float64Array(MAX_SHARDS),
    shardVx: new Float64Array(MAX_SHARDS),
    shardVy: new Float64Array(MAX_SHARDS),
    shardRot: new Float64Array(MAX_SHARDS),
    shardSpin: new Float64Array(MAX_SHARDS),
    shardSize: new Float64Array(MAX_SHARDS),
    shardLife: new Float64Array(MAX_SHARDS),
    shardMaxLife: new Float64Array(MAX_SHARDS),
    shardHue: new Float64Array(MAX_SHARDS),
    shardShape: new Float32Array(8 * MAX_SHARDS),
  };
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

/** Throws the shards of a shattered pane (8–20, as Glass Smash does), drawn from `random`. */
export function spawnShards(view: GlassView, pane: GlassPane, impactX: number, ballVy: number, random: () => number) {
  const level = view.level!;
  const viewH = level.field.height;
  const [lo, hi] = solidSpan(pane, impactX);
  const n = shardCount((2 * pane.halfWidth) / level.field.width, pane.maxHp, random());
  for (let i = 0; i < n; i++) {
    let slot: number;
    if (view.shardCount < MAX_SHARDS) slot = view.shardCount++;
    else {
      slot = 0;
      for (let k = 1; k < MAX_SHARDS; k++) if (view.shardLife[k] < view.shardLife[slot]) slot = k;
    }
    const spread = (random() - 0.5) * 1.8 * (hi - lo);
    const rx = Math.max(lo, Math.min(hi, impactX + 0.5 * spread));
    view.shardX[slot] = pane.x + rx;
    view.shardY[slot] = pane.y + (random() - 0.5) * pane.thickness;
    view.shardVx[slot] = (rx - impactX) * 1.4 + (random() - 0.5) * 0.5 * viewH;
    view.shardVy[slot] = 0.35 * ballVy + (random() - 0.65) * 0.7 * viewH;
    view.shardRot[slot] = random() * 2 * Math.PI;
    view.shardSpin[slot] = (random() - 0.5) * 16;
    view.shardSize[slot] = pane.thickness * (0.7 + 1.5 * random());
    const life = 1.1 + 0.6 * random();
    view.shardLife[slot] = life;
    view.shardMaxLife[slot] = life;
    view.shardHue[slot] = pane.hue;
    const o = 8 * slot;
    for (let c = 0; c < 4; c++) {
      const a = (c * Math.PI) / 2 + (random() - 0.5) * 1.1;
      const rad = 0.45 + 0.55 * random();
      view.shardShape[o + 2 * c] = Math.cos(a) * rad;
      view.shardShape[o + 2 * c + 1] = Math.sin(a) * rad * 0.7;
    }
  }
}

function removeShard(view: GlassView, i: number) {
  const last = --view.shardCount;
  if (i === last) return;
  view.shardX[i] = view.shardX[last];
  view.shardY[i] = view.shardY[last];
  view.shardVx[i] = view.shardVx[last];
  view.shardVy[i] = view.shardVy[last];
  view.shardRot[i] = view.shardRot[last];
  view.shardSpin[i] = view.shardSpin[last];
  view.shardSize[i] = view.shardSize[last];
  view.shardLife[i] = view.shardLife[last];
  view.shardMaxLife[i] = view.shardMaxLife[last];
  view.shardHue[i] = view.shardHue[last];
  view.shardShape.copyWithin(8 * i, 8 * last, 8 * last + 8);
}

/** One step of the shards: gravity `g` (px/s²), bounces off the column between `left` and `right`, fading out. */
export function stepShards(view: GlassView, dt: number, g: number, left: number, right: number) {
  for (let i = view.shardCount - 1; i >= 0; i--) {
    view.shardLife[i] -= dt;
    if (view.shardLife[i] <= 0) {
      removeShard(view, i);
      continue;
    }
    view.shardVy[i] += g * dt;
    view.shardX[i] += view.shardVx[i] * dt;
    view.shardY[i] += view.shardVy[i] * dt;
    view.shardRot[i] += view.shardSpin[i] * dt;
    const edge = 0.5 * view.shardSize[i];
    if (view.shardX[i] < left + edge) {
      view.shardX[i] = left + edge;
      view.shardVx[i] = 0.4 * Math.abs(view.shardVx[i]);
    } else if (view.shardX[i] > right - edge) {
      view.shardX[i] = right - edge;
      view.shardVx[i] = -0.4 * Math.abs(view.shardVx[i]);
    }
  }
}

export function shiftShards(view: GlassView, dy: number) {
  for (let i = 0; i < view.shardCount; i++) view.shardY[i] += dy;
}

export function rescaleShards(view: GlassView, map: StageMap) {
  for (let i = 0; i < view.shardCount; i++) {
    view.shardX[i] = map.x(view.shardX[i]);
    view.shardY[i] = map.y(view.shardY[i]);
    view.shardVx[i] *= map.k;
    view.shardVy[i] *= map.k;
    view.shardSize[i] *= map.k;
  }
}
