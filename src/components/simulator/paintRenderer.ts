import type { PaintProgressView } from "@/lib/physics/modes/paint";

/**
 * --- paint-full --- Canvas drawing of Paint's progress and its full canvas (lib/physics/modes/paint.ts), on top of the trail
 * Canvas.tsx strokes (renderBudget.ts PaintTrailLayer):
 *  - the progress round the ring: a bright arc just outside the rim from the top, clockwise, as far as the canvas is painted (white:
 *    the ring itself is often a rainbow already),
 *    with a tick at each quarter, glowing for a moment as a milestone passes (the counter itself is a pill above the ring, off
 *    the painting: `drawTopPill()`);
 *  - the full canvas: the last unpainted specks of the coverage grid fill in with paint over FLOOD_MS, so the counter's 100 % is
 *    what the picture shows, under a white flash.
 * From the run's own clock (the engine's elapsed ms and the times the view keeps), so every export draws the same frame.
 */

export interface PaintRenderOptions {
  cx: number;
  cy: number;
  /** The painted circle's radius (the unpulsed arena). */
  radius: number;
  /** The engine's elapsed ms. */
  nowMs: number;
}

/** How long the last specks take to fill in, the full canvas' flash, and a milestone's glow (ms). */
export const FLOOD_MS = 600;
export const FULL_FLASH_MS = 700;
export const MILESTONE_GLOW_MS = 500;
const SPECK_BUCKETS = 12;
const TWO_PI = Math.PI * 2;

/** The share of the canvas the counter shows: the coverage, rising to 1 as the last specks fill in once the canvas is full. */
export function paintShownShare(coverage: number, view: PaintProgressView, nowMs: number): number {
  if (!view.done) return Math.max(0, Math.min(1, coverage));
  const k = Math.max(0, Math.min(1, (nowMs - view.doneMs) / FLOOD_MS));
  return coverage + (1 - coverage) * k;
}

/** The arc of the canvas painted, round the outside of the ring, with its quarter ticks and a milestone's glow. */
export function drawPaintProgressRing(ctx: CanvasRenderingContext2D, share: number, view: PaintProgressView, o: PaintRenderOptions) {
  const r = 1.045 * o.radius;
  const w = Math.max(4, 0.03 * o.radius);
  const glowAge = o.nowMs - view.milestoneMs;
  const glow = glowAge >= 0 && glowAge < MILESTONE_GLOW_MS ? 1 - glowAge / MILESTONE_GLOW_MS : 0;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, r, 0, TWO_PI);
  ctx.stroke();
  const end = Math.max(0, Math.min(1, share));
  if (end > 0) {
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.35 + 0.4 * glow;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = w * (2.2 + 1.2 * glow);
    ctx.beginPath();
    ctx.arc(o.cx, o.cy, r, -Math.PI / 2, -Math.PI / 2 + end * TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  // a tick at each quarter
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let q = 1; q <= 4; q++) {
    const a = -Math.PI / 2 + (q / 4) * TWO_PI;
    ctx.moveTo(o.cx + (r - w) * Math.cos(a), o.cy + (r - w) * Math.sin(a));
    ctx.lineTo(o.cx + (r + w) * Math.cos(a), o.cy + (r + w) * Math.sin(a));
  }
  ctx.stroke();
  ctx.restore();
}

/** The specks of the last full canvas, found once when it filled (bucket, column, row each): no grid walk per frame. */
let specks: Int16Array = new Int16Array(0);
let speckCount = 0;
let specksOf: { grid: Uint8Array | null; doneMs: number } = { grid: null, doneMs: NaN };

function findSpecks(grid: Uint8Array, size: number) {
  const c = size / 2;
  let n = 0;
  for (let i = 0; i < size * size; i++) if (!grid[i]) n++;
  if (specks.length < 3 * n) specks = new Int16Array(3 * n);
  speckCount = 0;
  for (let y = 0; y < size; y++) {
    const dy = y + 0.5 - c;
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x]) continue;
      const dx = x + 0.5 - c;
      if (dx * dx + dy * dy > c * c) continue;
      const turn = (Math.atan2(dy, dx) + Math.PI) / TWO_PI;
      specks[3 * speckCount] = Math.min(SPECK_BUCKETS - 1, Math.floor(turn * SPECK_BUCKETS));
      specks[3 * speckCount + 1] = x;
      specks[3 * speckCount + 2] = y;
      speckCount++;
    }
  }
}

/** The full canvas: the specks the grid still has unpainted fill in (in the colours of the wheel round them) under a flash. */
export function drawPaintFull(ctx: CanvasRenderingContext2D, grid: Uint8Array, size: number, view: PaintProgressView, o: PaintRenderOptions) {
  if (!view.done) return;
  const age = o.nowMs - view.doneMs;
  if (!(age >= 0)) return;
  if (specksOf.grid !== grid || specksOf.doneMs !== view.doneMs) {
    findSpecks(grid, size);
    specksOf = { grid, doneMs: view.doneMs };
  }
  const k = Math.min(1, age / FLOOD_MS);
  const cell = (2 * o.radius) / size;
  ctx.save();
  ctx.globalAlpha = 0.75 * k;
  for (let b = 0; b < SPECK_BUCKETS; b++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < speckCount; i++) {
      if (specks[3 * i] !== b) continue;
      ctx.rect(o.cx - o.radius + specks[3 * i + 1] * cell - 0.5, o.cy - o.radius + specks[3 * i + 2] * cell - 0.5, cell + 1, cell + 1);
      any = true;
    }
    if (!any) continue;
    ctx.fillStyle = `hsl(${Math.round((b / SPECK_BUCKETS) * 360)}, 85%, 55%)`;
    ctx.fill();
  }
  if (age < FULL_FLASH_MS) {
    ctx.globalAlpha = 0.4 * (1 - age / FULL_FLASH_MS);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(o.cx, o.cy, o.radius, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A counter pill above the ring (Paint's painted share, Lines' strings, Portal's teleports): white or `color` text on a dark plate,
 * centred on (`cx`, `y`), swelling by `pop` (0–1) for a moment as it changes. Returns nothing; screen space.
 */
export function drawTopPill(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, fs: number, color: string, pop = 0, glow = false) {
  ctx.save();
  const size = fs * (1 + 0.18 * pop);
  ctx.font = `bold ${size.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 0.9 * size;
  const h = 1.45 * size;
  const x0 = cx - w / 2;
  const y0 = y - h / 2;
  const rad = h / 2;
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(x0 + rad, y0);
  ctx.lineTo(x0 + w - rad, y0);
  ctx.arcTo(x0 + w, y0, x0 + w, y0 + rad, rad);
  ctx.arcTo(x0 + w, y0 + h, x0 + w - rad, y0 + h, rad);
  ctx.lineTo(x0 + rad, y0 + h);
  ctx.arcTo(x0, y0 + h, x0, y0 + h - rad, rad);
  ctx.arcTo(x0, y0, x0 + rad, y0, rad);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  if (glow || pop > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 + 14 * pop;
  }
  ctx.fillText(text, cx, y);
  ctx.restore();
}
