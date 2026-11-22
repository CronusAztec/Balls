import type { PaintPoint, PaintProgressView } from "@/lib/physics/modes/paint";

/**
 * --- paint-full --- Canvas drawing of Paint's progress and its full canvas (lib/physics/modes/paint.ts), on top of the trail
 * Canvas.tsx strokes (renderBudget.ts PaintTrailLayer):
 *  - the progress round the ring: a bright arc just outside the rim from the top, clockwise, as far as the canvas is painted (white:
 *    the ring itself is often a rainbow already),
 *    with a tick at each quarter, glowing for a moment as a milestone passes (the counter itself is a pill above the ring, off
 *    the painting: `drawTopPill()`);
 *  - the full canvas: the last unpainted specks of the coverage grid fill in with paint on the frame the canvas is full, so the
 *    counter's 100 % is what the picture shows, under a white flash. (D3 review: they filled in over 600 ms while the card already
 *    said 100 % over a counter still at 95–99 %, and as hard square cells, a stair-step mosaic along the rim among round strokes.
 *    Now the counter reads 100 % with the card, and each speck is a round dab in the colour of the stroke nearest it.)
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

/** The full canvas' flash, and a milestone's glow (ms). */
export const FULL_FLASH_MS = 700;
export const MILESTONE_GLOW_MS = 500;
const SPECK_BUCKETS = 12;
const TWO_PI = Math.PI * 2;
/**
 * A last speck's dab: its radius in grid cells (round, as the brush's strokes are, and reaching a little into the cells round it:
 * at 0.8 a cell the dabs left hairline gaps of the dark page between them and the strokes) and its opacity (the strokes' own).
 */
export const SPECK_DAB_CELLS = 1.15;
const SPECK_ALPHA = 1;
/** The most specks given a stroke's colour (the nearest stroke point each, once): past it the rest keep the wheel's colour. */
const SPECK_COLOUR_BUDGET = 4_000_000;

/** The share of the canvas the counter shows: the coverage, and 1 from the frame the canvas is full (its last specks filled in). */
export function paintShownShare(coverage: number, view: PaintProgressView): number {
  if (view.done) return 1;
  return Math.max(0, Math.min(1, coverage));
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

/**
 * The specks of the last full canvas, found once when it filled (bucket, column, row each) with each one's colour (an index into
 * `speckColours`): no grid walk per frame.
 */
let specks: Int16Array = new Int16Array(0);
let speckColourOf: Int32Array = new Int32Array(0);
let speckColours: string[] = [];
let speckCount = 0;
let specksOf: { grid: Uint8Array | null; doneMs: number; points: number } = { grid: null, doneMs: NaN, points: -1 };

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

/**
 * Each speck's colour: the colour of the stroke point nearest its cell (world px, the circle's box from `x0`, `y0` in cells of
 * `cell`), or the wheel's colour round it when there are no points (or more specks × points than SPECK_COLOUR_BUDGET).
 */
function colourSpecks(points: readonly PaintPoint[] | undefined, x0: number, y0: number, cell: number) {
  if (speckColourOf.length < speckCount) speckColourOf = new Int32Array(speckCount);
  speckColours = [];
  const index = new Map<string, number>();
  const colourIndex = (c: string) => {
    let i = index.get(c);
    if (i === undefined) {
      i = speckColours.length;
      speckColours.push(c);
      index.set(c, i);
    }
    return i;
  };
  const n = points ? points.length : 0;
  const nearest = n > 0 && speckCount * n <= SPECK_COLOUR_BUDGET;
  for (let i = 0; i < speckCount; i++) {
    if (nearest) {
      const x = x0 + (specks[3 * i + 1] + 0.5) * cell;
      const y = y0 + (specks[3 * i + 2] + 0.5) * cell;
      let best = Infinity;
      let colour = "";
      for (let k = 0; k < n; k++) {
        const pt = points![k];
        const d = (pt.x - x) * (pt.x - x) + (pt.y - y) * (pt.y - y);
        if (d < best) {
          best = d;
          colour = pt.color;
        }
      }
      speckColourOf[i] = colourIndex(colour);
    } else speckColourOf[i] = colourIndex(`hsl(${Math.round((specks[3 * i] / SPECK_BUCKETS) * 360)}, 85%, 55%)`);
  }
}

/**
 * The full canvas: the specks the grid still has unpainted filled in at once, each a round dab in the colour of the stroke nearest
 * it (`points`, the run's stroke points; without them the wheel's colour round it), inside the circle, under a flash.
 */
export function drawPaintFull(ctx: CanvasRenderingContext2D, grid: Uint8Array, size: number, view: PaintProgressView, o: PaintRenderOptions, points?: readonly PaintPoint[]) {
  if (!view.done) return;
  const age = o.nowMs - view.doneMs;
  if (!(age >= 0)) return;
  const cell = (2 * o.radius) / size;
  const pointCount = points ? points.length : 0;
  if (specksOf.grid !== grid || specksOf.doneMs !== view.doneMs || specksOf.points !== pointCount) {
    findSpecks(grid, size);
    colourSpecks(points, o.cx - o.radius, o.cy - o.radius, cell);
    specksOf = { grid, doneMs: view.doneMs, points: pointCount };
  }
  const dab = SPECK_DAB_CELLS * cell;
  ctx.save();
  // inside the circle only: a dab on the rim does not spill over the ring
  ctx.beginPath();
  ctx.arc(o.cx, o.cy, o.radius, 0, TWO_PI);
  ctx.clip();
  ctx.globalAlpha = SPECK_ALPHA;
  for (let c = 0; c < speckColours.length; c++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < speckCount; i++) {
      if (speckColourOf[i] !== c) continue;
      const x = o.cx - o.radius + (specks[3 * i + 1] + 0.5) * cell;
      const y = o.cy - o.radius + (specks[3 * i + 2] + 0.5) * cell;
      ctx.moveTo(x + dab, y);
      ctx.arc(x, y, dab, 0, TWO_PI);
      any = true;
    }
    if (!any) continue;
    ctx.fillStyle = speckColours[c];
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
