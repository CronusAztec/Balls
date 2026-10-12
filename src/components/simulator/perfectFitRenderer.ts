import type { PerfectFitView } from "@/lib/physics/modes/perfectFit";
import { PF_FALL, PF_LIFT, PF_REF_SEC, PF_SCATTER_G, PF_SQUASH, PF_TRAVEL, puzzleAt, type PfPiece, type PfPuzzle } from "@/lib/simulation/polyominoPlan";

/*
 * --- perfect-fit --- Perfect Fit's picture (lib/physics/modes/perfectFit.ts runs it), drawn in world px inside the page's centred
 * square from the plan itself at the frame's own simulation time – the plan is a pure function of time, so the pieces move
 * smoothly at any playback speed and every frame of a clip is exact:
 *
 * - **rectangles**: the tray (the 12 pieces in their final orientations, two rows of six, at up to 45 % of a box cell) along the
 *   top; the box (dark fill, a lighter 1 px border, a faint cell grid) about 90 % of the square wide, so its cells shrink from
 *   puzzle to puzzle; each piece lifts out of the tray, glides above its columns, falls straight down (the fall feel's curve)
 *   and lands with a small squash; then the box flashes, its unit squares burst out under gravity and fade, and the next box's
 *   size, tray and label cross-fade in. Under the box: the white bold "6 × 10" and the grey "one of 2,339 ways".
 * - **perfect clears**: the 10 × 16 well (a 2 px slate border, a faint grid), tetrominoes in the guideline colours with a darker
 *   bevel falling at a constant speed from just above it, a landed piece glowing for a moment; a clear's translucent khaki band
 *   with its gold "four lines", the finale's rows flashing cream-white under "twelve lines"; the grey "N lines cleared" under the
 *   well.
 *
 * The pieces are glossy rounded cells (about 20 % of a cell), a lighter top bevel and a soft offset shadow – one cached Path2D per
 * orientation and nothing allocated per frame once they are built.
 */

/** What the canvas hands the layer each frame. */
export interface PerfectFitRenderOptions {
  /** Device px per world px (hairlines stay a device pixel). */
  dpr: number;
  /** Ball Glow: a stronger landing glow. */
  showGlow: boolean;
}

/** The words drawn under the box and in the banners (the page's language; English when the canvas has none). */
export interface PerfectFitLabels {
  /** A box as the account writes it, rows × columns: "6 × 10". */
  box: (rows: number, cols: number) => string;
  /** "one of 2,339 ways" (the classic count, formatted). */
  ways: (count: number) => string;
  /** A box the 12 pieces fill, but never by dropping (3 × 20), and one they cannot fill at all. */
  noDrop: string;
  noTiling: string;
  /** Tetris: "28 lines cleared" and a clear's banner, "four lines". */
  lines: (count: number) => string;
  banner: (count: number) => string;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** The English words (the tests, a canvas without labels). */
export const PERFECT_FIT_ENGLISH: PerfectFitLabels = {
  box: (rows, cols) => `${rows} × ${cols}`,
  ways: (count) => `one of ${count.toLocaleString("en-US")} ways`,
  noDrop: "no way to build it by dropping",
  noTiling: "the 12 pieces cannot fill it",
  lines: (count) => `${count} ${count === 1 ? "line" : "lines"} cleared`,
  banner: (count) => `${NUMBER_WORDS[count] ?? count} ${count === 1 ? "line" : "lines"}`,
};

/** The page's look: the box's fill and border, the grid, the label colours, the Tetris well's border, the banners. */
export const PF_LOOK = {
  box: "#14163a",
  boxBorder: "rgba(160, 168, 255, 0.35)",
  grid: "rgba(255, 255, 255, 0.05)",
  label: "#ffffff",
  ways: "#9aa0c0",
  well: "#07080f",
  wellBorder: "#5a5f8a",
  wellGrid: "rgba(255, 255, 255, 0.045)",
  counter: "#8d90a6",
  banner: "rgba(214, 196, 140, 0.32)",
  bannerText: "#e5b04a",
  cream: "#fff4d6",
  shadow: "rgba(0, 0, 0, 0.35)",
  bevel: "rgba(255, 255, 255, 0.3)",
  dark: "rgba(0, 0, 0, 0.2)",
} as const;

/** Layout shares of the square: the box's widest (0.9) and tallest, its bottom, the label lines, the tray. */
export const PF_BOX_WIDTH = 0.9;
export const PF_BOX_HEIGHT = 0.54;
export const PF_BOX_BOTTOM = 0.84;
export const PF_LABEL_Y = 0.895;
export const PF_WAYS_Y = 0.945;
export const PF_TRAY_TOP = 0.03;
export const PF_TRAY_ROW = 0.1;
export const PF_TRAY_SCALE = 0.45;
/** Tetris: the well's tallest share, its bottom and the counter's line. */
export const PF_WELL_HEIGHT = 0.72;
export const PF_WELL_BOTTOM = 0.86;
export const PF_COUNTER_Y = 0.93;
/** Seconds a landed Tetris piece glows. */
export const PF_GLOW_SEC = 0.25;

/** One piece's cached paths in cell units (x right, y down from the piece's top-left cell): the body and the top bevel. */
interface PiecePaths {
  body: Path2D | null;
  bevel: Path2D | null;
}

/** The geometry of one puzzle in the square (world px). */
interface Layout {
  cell: number;
  left: number;
  bottom: number;
  width: number;
  height: number;
}

const L1: Layout = { cell: 0, left: 0, bottom: 0, width: 0, height: 0 };
const L2: Layout = { cell: 0, left: 0, bottom: 0, width: 0, height: 0 };
const LM: Layout = { cell: 0, left: 0, bottom: 0, width: 0, height: 0 };

function smooth(u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}

function clamp01(u: number): number {
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

function roundRect(ctx: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export class PerfectFitLayer {
  /** What the last frame drew (data-pf-*): pieces, scatter squares, the banner and the label lines. */
  piecesDrawn = 0;
  scatterDrawn = 0;
  banner = "";
  label = "";
  /** The top edge of the words under the box or well (world px; Infinity: none) – the live watermark's bottom band. */
  labelTop = Infinity;
  private readonly paths = new Map<string, PiecePaths>();

  /** The cached paths of a piece's orientation (rounded cells inset 4 %, corners 20 %; the bevel the cells' top quarter). */
  private pathsOf(piece: PfPiece, tetris: boolean): PiecePaths {
    const key = `${tetris ? "t" : "p"}:${piece.orientation.key}`;
    let hit = this.paths.get(key);
    if (hit) return hit;
    hit = { body: null, bevel: null };
    if (typeof Path2D !== "undefined") {
      const body = new Path2D();
      const bevel = new Path2D();
      const inset = tetris ? 0.03 : 0.045;
      const radius = tetris ? 0.1 : 0.2;
      const o = piece.orientation;
      for (const [x, y] of o.cells) {
        const top = o.height - 1 - y;
        roundRect(body, x + inset, top + inset, 1 - 2 * inset, 1 - 2 * inset, radius);
        roundRect(bevel, x + inset + 0.08, top + inset + 0.06, 1 - 2 * inset - 0.16, 0.2, 0.1);
      }
      hit.body = body;
      hit.bevel = bevel;
    }
    this.paths.set(key, hit);
    return hit;
  }

  /** The box (or well) of `p` in the square of `view` (world px), into `out`. */
  private layout(view: PerfectFitView, p: PfPuzzle | null, out: Layout): Layout {
    const f = view.frame;
    const S = f.side;
    const top = f.cy - S / 2;
    const w = Math.max(1, p ? p.w : 10);
    const h = Math.max(1, p ? p.h : 6);
    const tetris = p ? p.variant === "tetris" : view.plan.variant === "tetris";
    const cell = Math.min((PF_BOX_WIDTH * S) / w, ((tetris ? PF_WELL_HEIGHT : PF_BOX_HEIGHT) * S) / h);
    out.cell = cell;
    out.width = cell * w;
    out.height = cell * h;
    out.left = f.cx - out.width / 2;
    out.bottom = top + (tetris ? PF_WELL_BOTTOM : PF_BOX_BOTTOM) * S;
    return out;
  }

  /** The box or well, its grid and the words under it (the stage, under the pieces). */
  drawStage(ctx: CanvasRenderingContext2D, view: PerfectFitView, t: number, opts: PerfectFitRenderOptions, labels: PerfectFitLabels = PERFECT_FIT_ENGLISH) {
    const plan = view.plan;
    this.label = "";
    this.labelTop = Infinity;
    const { index, local } = puzzleAt(plan, t);
    if (index < 0) return;
    const p = plan.puzzles[index];
    const next = plan.puzzles[(index + 1) % plan.puzzles.length];
    const S = view.frame.side;
    const top = view.frame.cy - S / 2;
    const px = 1 / Math.max(1e-6, opts.dpr);
    if (p.variant === "tetris") {
      const g = this.layout(view, p, L1);
      this.drawWell(ctx, g, p, px);
      // the counter under the well
      const lines = linesShown(p, local);
      const size = Math.max(9, 0.036 * S);
      ctx.save();
      ctx.font = `600 ${size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PF_LOOK.counter;
      this.label = labels.lines(lines);
      ctx.fillText(this.label, view.frame.cx, top + PF_COUNTER_Y * S, 0.9 * S);
      ctx.restore();
      this.labelTop = top + PF_COUNTER_Y * S - 0.6 * size;
      return;
    }
    // the rectangles: during the label's crossfade the box morphs into the next one's
    const fadeStart = p.tEnd - p.fadeSec;
    const k = p.fadeSec > 0 && local >= fadeStart ? smooth((local - fadeStart) / p.fadeSec) : 0;
    this.layout(view, p, L1);
    this.layout(view, next, L2);
    LM.cell = L1.cell + (L2.cell - L1.cell) * k;
    LM.width = L1.width + (L2.width - L1.width) * k;
    LM.height = L1.height + (L2.height - L1.height) * k;
    LM.left = view.frame.cx - LM.width / 2;
    LM.bottom = L1.bottom;
    ctx.save();
    ctx.fillStyle = PF_LOOK.box;
    ctx.fillRect(LM.left, LM.bottom - LM.height, LM.width, LM.height);
    // the grid of the box on show (the next one's fading in)
    if (k < 1) this.drawGrid(ctx, L1, p.w, p.h, 1 - k, PF_LOOK.grid);
    if (k > 0) this.drawGrid(ctx, L2, next.w, next.h, k, PF_LOOK.grid);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PF_LOOK.boxBorder;
    ctx.lineWidth = px;
    ctx.strokeRect(LM.left - px / 2, LM.bottom - LM.height - px / 2, LM.width + px, LM.height + px);
    ctx.restore();
    // the words under the box: this one's, then the next one's
    const titleSize = Math.max(10, 0.052 * S);
    const waysSize = Math.max(8, 0.032 * S);
    this.labelTop = top + PF_LABEL_Y * S - 0.6 * titleSize;
    this.drawWords(ctx, view, p, 1 - k, titleSize, waysSize, labels);
    if (k > 0) this.drawWords(ctx, view, next, k, titleSize, waysSize, labels);
    this.label = boxWords(k >= 0.5 ? next : p, labels);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, g: Layout, w: number, h: number, alpha: number, color: string) {
    if (!(g.cell >= 4) || alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const topY = g.bottom - g.height;
    for (let x = 1; x < w; x++) {
      const X = g.left + x * g.cell;
      ctx.moveTo(X, topY);
      ctx.lineTo(X, g.bottom);
    }
    for (let y = 1; y < h; y++) {
      const Y = g.bottom - y * g.cell;
      ctx.moveTo(g.left, Y);
      ctx.lineTo(g.left + g.width, Y);
    }
    ctx.stroke();
  }

  private drawWords(ctx: CanvasRenderingContext2D, view: PerfectFitView, p: PfPuzzle, alpha: number, titleSize: number, waysSize: number, labels: PerfectFitLabels) {
    if (alpha <= 0.001) return;
    const S = view.frame.side;
    const top = view.frame.cy - S / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PF_LOOK.label;
    ctx.font = `800 ${titleSize}px sans-serif`;
    ctx.fillText(labels.box(p.h, p.w), view.frame.cx, top + PF_LABEL_Y * S, 0.9 * S);
    const second = p.status === "ok" ? (p.ways !== null ? labels.ways(p.ways) : "") : p.status === "size" || p.w * p.h !== 60 || Math.min(p.w, p.h) <= 2 ? labels.noTiling : labels.noDrop;
    if (second) {
      ctx.fillStyle = PF_LOOK.ways;
      ctx.font = `500 ${waysSize}px sans-serif`;
      ctx.fillText(second, view.frame.cx, top + PF_WAYS_Y * S, 0.9 * S);
    }
    ctx.restore();
  }

  private drawWell(ctx: CanvasRenderingContext2D, g: Layout, p: PfPuzzle, px: number) {
    ctx.save();
    ctx.fillStyle = PF_LOOK.well;
    ctx.fillRect(g.left, g.bottom - g.height, g.width, g.height);
    this.drawGrid(ctx, g, p.w, p.h, 1, PF_LOOK.wellGrid);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PF_LOOK.wellBorder;
    ctx.lineWidth = 2 * Math.max(px, 1);
    ctx.strokeRect(g.left - ctx.lineWidth / 2, g.bottom - g.height - ctx.lineWidth / 2, g.width + ctx.lineWidth, g.height + ctx.lineWidth);
    ctx.restore();
  }

  /** The pieces (the tray, the flights, the landed ones), the completion's flash and scatter, the clears' banners. */
  drawBodies(ctx: CanvasRenderingContext2D, view: PerfectFitView, t: number, opts: PerfectFitRenderOptions, labels: PerfectFitLabels = PERFECT_FIT_ENGLISH) {
    const plan = view.plan;
    this.piecesDrawn = 0;
    this.scatterDrawn = 0;
    this.banner = "";
    const { index, local } = puzzleAt(plan, t);
    if (index < 0) return;
    const p = plan.puzzles[index];
    if (p.variant === "tetris") this.drawTetris(ctx, view, p, local, opts, labels);
    else this.drawPento(ctx, view, p, plan.puzzles[(index + 1) % plan.puzzles.length], local);
  }

  private drawPento(ctx: CanvasRenderingContext2D, view: PerfectFitView, p: PfPuzzle, next: PfPuzzle, local: number) {
    const g = this.layout(view, p, L1);
    const S = view.frame.side;
    const sc = p.slot / PF_REF_SEC;
    const flight = (PF_LIFT + PF_TRAVEL + PF_FALL) * sc;
    const fall = PF_FALL * sc;
    const feel = 1 + Math.max(0, view.fall);
    const scatterAt = p.tDone + p.flashSec;
    const fadeStart = p.tEnd - p.fadeSec;
    // the tray: the pieces still in it, then (during the fade) the next box's pieces coming in
    const trayAlpha = local >= fadeStart && p.fadeSec > 0 ? 0 : 1;
    if (trayAlpha > 0) this.drawTray(ctx, view, p, g.cell, local, 1, false);
    if (local >= fadeStart && p.fadeSec > 0) this.drawTray(ctx, view, next, this.layout(view, next, L2).cell, -Infinity, smooth((local - fadeStart) / p.fadeSec), true);
    if (local >= scatterAt) {
      this.drawScatter(ctx, p, g, local - scatterAt);
      return;
    }
    const trayCell = this.trayCell(view, p, g.cell);
    for (let k = 0; k < p.pieces.length; k++) {
      const piece = p.pieces[k];
      if (local < piece.tLift) continue;
      const paths = this.pathsOf(piece, false);
      const w = piece.orientation.width;
      const h = piece.orientation.height;
      // the target (its top-left corner) and the hover above the box
      const targetX = g.left + piece.minX * g.cell;
      const targetY = g.bottom - (piece.maxY + 1) * g.cell;
      const hoverY = g.bottom - g.height - (h + 0.35) * g.cell;
      let x = targetX;
      let y = targetY;
      let scale = 1;
      let sx = 1;
      let sy = 1;
      if (local < piece.tLand) {
        const u = (local - piece.tLift) / flight;
        const lift = PF_LIFT / (PF_LIFT + PF_TRAVEL + PF_FALL);
        const travel = PF_TRAVEL / (PF_LIFT + PF_TRAVEL + PF_FALL);
        const slot = this.traySlot(view, k);
        const trayScale = trayCell / g.cell;
        if (u < lift) {
          const a = smooth(u / lift);
          scale = trayScale + (0.7 - trayScale) * a;
          const cxp = slot.x;
          const cyp = slot.y - 0.03 * S * a;
          x = cxp - (w * g.cell * scale) / 2;
          y = cyp - (h * g.cell * scale) / 2;
        } else if (u < lift + travel) {
          const a = smooth((u - lift) / travel);
          scale = 0.7 + 0.3 * a;
          const fromX = slot.x;
          const fromY = slot.y - 0.03 * S;
          const toX = targetX + (w * g.cell) / 2;
          const toY = hoverY + (h * g.cell) / 2;
          const cxp = fromX + (toX - fromX) * a;
          const cyp = fromY + (toY - fromY) * a;
          x = cxp - (w * g.cell * scale) / 2;
          y = cyp - (h * g.cell * scale) / 2;
        } else {
          const a = clamp01((local - (piece.tLand - fall)) / Math.max(1e-6, fall));
          y = hoverY + (targetY - hoverY) * Math.pow(a, feel);
        }
      } else if (local < piece.tLand + PF_SQUASH * sc) {
        const v = (local - piece.tLand) / (PF_SQUASH * sc);
        const s = Math.sin(Math.PI * v);
        sy = 1 - 0.12 * s;
        sx = 1 + 0.06 * s;
      }
      this.drawPiece(ctx, paths, piece, x, y, g.cell * scale, sx, sy, 1);
    }
    // the completion's flash over the full box
    if (local >= p.tDone && local < scatterAt && p.flashSec > 0) {
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - (local - p.tDone) / p.flashSec);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(g.left, g.bottom - g.height, g.width, g.height);
      ctx.restore();
    }
  }

  /** The tray's cell: 45 % of the box's, smaller when two rows of six of this puzzle's pieces would not fit. */
  private trayCell(view: PerfectFitView, p: PfPuzzle, boxCell: number): number {
    const S = view.frame.side;
    const slotW = (PF_BOX_WIDTH * S) / 6;
    const slotH = PF_TRAY_ROW * S;
    let fit = PF_TRAY_SCALE * boxCell;
    for (const piece of p.pieces) fit = Math.min(fit, (0.82 * slotW) / piece.orientation.width, (0.82 * slotH) / piece.orientation.height);
    return Math.max(1, fit);
  }

  /** The centre of tray slot `k` (two rows of six, by drop order). */
  private traySlot(view: PerfectFitView, k: number): { x: number; y: number } {
    const S = view.frame.side;
    const top = view.frame.cy - S / 2;
    const slotW = (PF_BOX_WIDTH * S) / 6;
    const col = k % 6;
    const row = Math.floor(k / 6) % 2;
    TRAY_SLOT.x = view.frame.cx - (PF_BOX_WIDTH * S) / 2 + (col + 0.5) * slotW;
    TRAY_SLOT.y = top + PF_TRAY_TOP * S + (row + 0.5) * PF_TRAY_ROW * S;
    return TRAY_SLOT;
  }

  private drawTray(ctx: CanvasRenderingContext2D, view: PerfectFitView, p: PfPuzzle, boxCell: number, local: number, alpha: number, all: boolean) {
    if (alpha <= 0.001 || p.pieces.length === 0) return;
    const cell = this.trayCell(view, p, boxCell);
    for (let k = 0; k < p.pieces.length; k++) {
      const piece = p.pieces[k];
      if (!all && local >= piece.tLift) continue;
      const slot = this.traySlot(view, k);
      const w = piece.orientation.width * cell;
      const h = piece.orientation.height * cell;
      this.drawPiece(ctx, this.pathsOf(piece, false), piece, slot.x - w / 2, slot.y - h / 2, cell, 1, 1, alpha);
    }
  }

  /** The completed box's unit squares flying out under gravity and fading. */
  private drawScatter(ctx: CanvasRenderingContext2D, p: PfPuzzle, g: Layout, tau: number) {
    if (tau >= p.scatterSec || p.scatter.length === 0) return;
    const alpha = 1 - tau / p.scatterSec;
    const size = 0.86 * g.cell;
    ctx.save();
    let i = 0;
    for (const piece of p.pieces) {
      ctx.fillStyle = piece.color;
      for (let c = 0; c < piece.cells.length; c += 2, i += 3) {
        const vx = p.scatter[i];
        const vy = p.scatter[i + 1];
        const spin = p.scatter[i + 2];
        const x = g.left + (piece.cells[c] + 0.5 + vx * tau) * g.cell;
        const y = g.bottom - (piece.cells[c + 1] + 0.5 + vy * tau - 0.5 * PF_SCATTER_G * tau * tau) * g.cell;
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(spin * tau);
        ctx.beginPath();
        roundRect(ctx, -size / 2, -size / 2, size, size, 0.2 * size);
        ctx.fill();
        ctx.restore();
        this.scatterDrawn++;
      }
    }
    ctx.restore();
  }

  private drawTetris(ctx: CanvasRenderingContext2D, view: PerfectFitView, p: PfPuzzle, local: number, opts: PerfectFitRenderOptions, labels: PerfectFitLabels) {
    const g = this.layout(view, p, L1);
    const cleared = p.final ? p.tDone + p.flashSec : p.tDone + p.clearSec;
    if (local >= cleared) return;
    const spawnTop = g.bottom - g.height;
    for (let k = 0; k < p.pieces.length; k++) {
      const piece = p.pieces[k];
      if (local < piece.tLift) break;
      const paths = this.pathsOf(piece, true);
      const targetX = g.left + piece.minX * g.cell;
      const targetY = g.bottom - (piece.maxY + 1) * g.cell;
      let y = targetY;
      if (local < piece.tLand) {
        // spawned just above the well, falling at a constant speed through its slot
        const spawnY = spawnTop - (piece.maxY - piece.minY + 1) * g.cell - 0.2 * g.cell;
        const u = clamp01((local - piece.tLift) / Math.max(1e-6, piece.tLand - piece.tLift));
        y = spawnY + (targetY - spawnY) * u;
      }
      this.drawPiece(ctx, paths, piece, targetX, y, g.cell, 1, 1, 1, true);
      // a landed piece glows for a moment
      if (local >= piece.tLand && local < piece.tLand + PF_GLOW_SEC && paths.body) {
        const v = 1 - (local - piece.tLand) / PF_GLOW_SEC;
        ctx.save();
        ctx.translate(targetX, y);
        ctx.scale(g.cell, g.cell);
        ctx.globalAlpha = (opts.showGlow ? 0.55 : 0.4) * v;
        ctx.fillStyle = "#ffffff";
        ctx.fill(paths.body);
        ctx.restore();
      }
    }
    if (local < p.tDone) return;
    // the clear: the rows flash under the banner (the finale cream-white)
    const span = p.final ? p.flashSec : p.clearSec;
    const v = clamp01((local - p.tDone) / Math.max(1e-6, span));
    const rowsTop = g.bottom - p.lines * g.cell;
    ctx.save();
    ctx.globalAlpha = p.final ? 0.55 + 0.35 * Math.abs(Math.sin(Math.PI * 3 * v)) : 0.45 * (1 - v);
    ctx.fillStyle = p.final ? PF_LOOK.cream : "#ffffff";
    ctx.fillRect(g.left, rowsTop, g.width, p.lines * g.cell);
    ctx.globalAlpha = 1;
    const bandH = Math.min(p.lines * g.cell, Math.max(2.2 * g.cell, 0.09 * view.frame.side));
    const bandY = rowsTop + (p.lines * g.cell - bandH) / 2;
    ctx.fillStyle = p.final ? "rgba(255, 244, 214, 0.5)" : PF_LOOK.banner;
    ctx.fillRect(g.left - 0.04 * view.frame.side, bandY, g.width + 0.08 * view.frame.side, bandH);
    this.banner = labels.banner(p.lines);
    const size = Math.max(10, Math.min(0.62 * bandH, 0.075 * view.frame.side));
    ctx.font = `900 ${size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PF_LOOK.bannerText;
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 0.15 * size;
    ctx.fillText(this.banner, view.frame.cx, bandY + bandH / 2, g.width + 0.06 * view.frame.side);
    ctx.restore();
  }

  /** One piece at (x, y) – its top-left corner – with cells `cell` px, squashed by (sx, sy) about its bottom centre. */
  private drawPiece(ctx: CanvasRenderingContext2D, paths: PiecePaths, piece: PfPiece, x: number, y: number, cell: number, sx: number, sy: number, alpha: number, tetris = false) {
    const w = piece.orientation.width;
    const h = piece.orientation.height;
    ctx.save();
    ctx.globalAlpha = alpha;
    // squash about the bottom centre
    ctx.translate(x + (w * cell) / 2, y + h * cell);
    ctx.scale(sx * cell, sy * cell);
    ctx.translate(-w / 2, -h);
    if (paths.body && paths.bevel) {
      ctx.translate(0.05, 0.08);
      ctx.fillStyle = PF_LOOK.shadow;
      ctx.fill(paths.body);
      ctx.translate(-0.05, -0.08);
      ctx.fillStyle = piece.color;
      ctx.fill(paths.body);
      ctx.fillStyle = tetris ? PF_LOOK.dark : PF_LOOK.bevel;
      if (tetris) {
        // the darker bevel along each cell's foot, a faint light along its head
        ctx.save();
        ctx.translate(0, 0.62);
        ctx.fill(paths.bevel);
        ctx.restore();
        ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
      }
      ctx.fill(paths.bevel);
    } else {
      ctx.fillStyle = piece.color;
      for (const [cx, cy] of piece.orientation.cells) ctx.fillRect(cx + 0.04, h - 1 - cy + 0.04, 0.92, 0.92);
    }
    ctx.restore();
    this.piecesDrawn++;
  }
}

const TRAY_SLOT = { x: 0, y: 0 };

/** The lines the Tetris counter shows at `local` in chunk `p` (back to 0 once the finale's flash is over). */
function linesShown(p: PfPuzzle, local: number): number {
  if (p.final && local >= p.tDone + p.flashSec) return 0;
  return p.linesBefore + (local >= p.tDone ? p.lines : 0);
}

/** The words of a box under it ("6 × 10 · one of 2,339 ways"), for the data attribute. */
function boxWords(p: PfPuzzle, labels: PerfectFitLabels): string {
  const second = p.status === "ok" ? (p.ways !== null ? labels.ways(p.ways) : "") : p.w * p.h !== 60 || Math.min(p.w, p.h) <= 2 ? labels.noTiling : labels.noDrop;
  return second ? `${labels.box(p.h, p.w)} · ${second}` : labels.box(p.h, p.w);
}

/** The half-height (world px) the live loop HUD keeps clear of: the whole square (the tray above the box, the words under it). */
export function perfectFitExtentPx(view: PerfectFitView): number {
  return view.frame.side / 2;
}

/** The canvas' data-pf-* keys (dataset names), removed when the mode is left. */
export const PERFECT_FIT_DATA_KEYS = ["pfVariant", "pfTime", "pfLoop", "pfLoopIndex", "pfSeams", "pfSeamsEmpty", "pfSeamCells", "pfPuzzle", "pfPuzzles", "pfPlaced", "pfLanded", "pfLifts", "pfRects", "pfRectsLoop", "pfRectsMax", "pfLines", "pfLinesMax", "pfLinesTotal", "pfClears", "pfSounds", "pfOccupied", "pfPieces", "pfFloor", "pfSeed", "pfStatus", "pfBeat", "pfBeatError", "pfDrawn", "pfScatter", "pfBanner", "pfLabel", "pfBalls"] as const;

/** Writes the run's state as data-pf-* attributes (tools, the smoke test). */
export function writePerfectFitDataset(view: PerfectFitView, layer: PerfectFitLayer, set: (key: string, value: string) => void) {
  const plan = view.plan;
  set("pfVariant", plan.variant);
  set("pfTime", view.timeSec.toFixed(3));
  set("pfLoop", plan.loopSec.toFixed(4));
  set("pfLoopIndex", String(view.loop));
  set("pfSeams", String(view.seams));
  set("pfSeamsEmpty", String(view.seamsEmpty));
  set("pfSeamCells", view.seamCells.join(","));
  set("pfPuzzle", String(view.puzzle));
  set("pfPuzzles", String(plan.puzzles.length));
  set("pfPlaced", String(view.placed));
  set("pfLanded", String(view.landed));
  set("pfLifts", String(view.lifts));
  set("pfRects", String(view.rects));
  set("pfRectsLoop", String(view.rectsLoop));
  set("pfRectsMax", String(view.rectsMax));
  set("pfLines", String(view.lines));
  set("pfLinesMax", String(view.linesMax));
  set("pfLinesTotal", String(view.linesTotal));
  set("pfClears", String(view.clears));
  set("pfSounds", String(view.sounds));
  set("pfOccupied", String(view.occupied));
  set("pfPieces", String(plan.pieceCount));
  set("pfFloor", String(plan.floor));
  set("pfSeed", String(plan.seed));
  set("pfStatus", plan.puzzles.map((p) => p.status).join(","));
  set("pfBeat", plan.beatSec > 0 ? plan.beatSec.toFixed(4) : "0");
  set("pfBeatError", view.beatErrorMs.toFixed(3));
  set("pfDrawn", String(layer.piecesDrawn));
  set("pfScatter", String(layer.scatterDrawn));
  set("pfBanner", layer.banner);
  set("pfLabel", layer.label);
  set("pfBalls", String(view.balls));
}
