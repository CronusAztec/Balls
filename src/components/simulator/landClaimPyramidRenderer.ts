import type { Ball } from "@/lib/physics/types";
import { LC_FLY_LOG, LC_FLY_MS, LC_HUD_BAND, type LandClaimView } from "@/lib/physics/modes/landClaim";
import { lcPyramidLayerColor, lcPyramidShownHeight, lcPyramidStepOf, type LcPyramidView } from "@/lib/physics/landClaimPyramid";

/*
 * --- land-claim-pyramid --- Canvas drawing of Land Claim's pyramid layout (lib/physics/landClaimPyramid.ts), called by the
 * Land Claim layer (landClaimRenderer.ts) at the same points of the frame as its wall:
 *
 *  - `drawStage()` (world space, under everything): the floor as an isometric diamond on a dark slab, a faint grid where the
 *    pyramid stands;
 *  - `drawBodies()` (world space, the ball pass): the columns and the balls back to front – a column a box of its blocks, the
 *    top face light, the two front faces darker, coloured by layer (teal at the base through green and yellow to the summit's
 *    orange), the seams of the blocks where they are a few pixels tall; a ball a glossy disc sitting on the floor over its
 *    shadow, hidden by the columns in front of it –, then the knocked blocks flying off in the hitter's colour and the summit's
 *    flash.
 *
 * The physics is top down (the floor's x and y); the picture projects it: screen x = (x − y)·cos 30°, screen y = (x + y)·sin 30°
 * − height. The scale fits the slab and the full pyramid to 90 % of the exported square's width and, with Land Claim's HUD band
 * on, under it (else within ±40 % of its middle, clear of the loop HUD's title and counter). Visual only: it reads the view and
 * never writes to the engine; the rebuild's rising columns come from the view's level, the flights and the flash from the
 * simulation clock. A frame allocates nothing in steady state (the colours, the sprites and the depth order are kept).
 */

/** Colours of the floor and the slab. */
const FLOOR_TOP = "#18213a";
const FLOOR_GRID = "rgba(140, 170, 220, 0.09)";
const SLAB_LEFT = "#0d1324";
const SLAB_RIGHT = "#090e1b";
const SEAM = "rgba(8, 12, 24, 0.35)";
const EDGE = "rgba(8, 12, 24, 0.55)";
/** A step rises this share of a column's side (the ziggurat's proportions: the summit a cube of its own). */
const STEP_RISE = 0.9;
/** The slab's thickness, a share of the floor's half side. */
const SLAB = 0.07;
/** The drawing's width (share of the square) and its half height without the HUD band (share of the square's side). */
const FIT_WIDTH = 0.9;
const FIT_HALF = 0.4;
/** The summit's flash (ms) and the knocked blocks' throw (floor half sides a second, block sides of lift). */
const FLASH_MS = 900;
const THROW = 0.55;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const TWO_PI = Math.PI * 2;

/** How the pyramid is laid out on the canvas this frame (world px). */
export interface LcPyramidLayout {
  /** Screen position of the floor's centre, the scale (screen px per floor px) and a block's height (floor px). */
  ox: number;
  oy: number;
  k: number;
  block: number;
  /** The drawing's top and bottom (screen y). */
  top: number;
  bottom: number;
}

/**
 * The layout of `p` on a canvas of the run's size: the slab and the full pyramid fitted to `FIT_WIDTH` of the square's width
 * and to its height – under Land Claim's HUD band when `hud`, else within ±`FIT_HALF` of the square's middle – and centred.
 * --- low-findings-2 --- With the loop HUD on as well its title block stacks under the band (`stack`: its share of the side), and
 * the pyramid starts under that.
 */
export function lcPyramidLayout(p: LcPyramidView, hud: boolean, out: LcPyramidLayout = { ox: 0, oy: 0, k: 1, block: 0, top: 0, bottom: 0 }, stack = 0 /* --- low-findings-2 --- (the loop HUD's title block under the band: a share of the side) */): LcPyramidLayout {
  const f = p.field;
  const side = f.side;
  const summit = p.steps * f.cell * STEP_RISE;
  out.block = p.maxRows > 0 ? summit / p.maxRows : 0;
  // extents at scale 1, relative to the floor's centre: up to the back corner or the summit's top, down to the slab's front edge
  const up = Math.max(f.half, summit + 0.5 * f.cell);
  const down = f.half + SLAB * f.half;
  const wide = 2 * COS30 * f.floor;
  const sqTop = f.cy - side / 2;
  const bandTop = hud ? sqTop + (LC_HUD_BAND + Math.max(0, stack)) * side + 0.02 * side : f.cy - FIT_HALF * side;
  const bandBottom = hud ? sqTop + side - 0.03 * side : f.cy + FIT_HALF * side;
  const k = Math.min((FIT_WIDTH * side) / Math.max(1e-9, wide), (bandBottom - bandTop) / Math.max(1e-9, up + down));
  out.k = k > 0 ? k : 1;
  out.ox = f.cx;
  // centred in the band
  out.oy = (bandTop + bandBottom) / 2 + ((up - down) * out.k) / 2;
  out.top = out.oy - up * out.k;
  out.bottom = out.oy + down * out.k;
  return out;
}

function hexRgb(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(color: string, f: number): string {
  const [r, g, b] = hexRgb(color);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

export class LandClaimPyramidLayer {
  private readonly layout: LcPyramidLayout = { ox: 0, oy: 0, k: 1, block: 0, top: 0, bottom: 0 };
  /** Per step: the top face's, the left front face's and the right front face's colours (kept while the steps stay). */
  private topColors: string[] = [];
  private leftColors: string[] = [];
  private rightColors: string[] = [];
  private colorSteps = -1;
  /** The balls' depth order (kept between frames: an insertion sort of a nearly sorted list) and their depths. */
  private order = new Int32Array(64);
  private depth = new Float64Array(64);
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  /** For tools and the smoke test: columns, balls, flying blocks and faces drawn last frame, the drawing's extent, the flash. */
  columns = 0;
  balls = 0;
  flying = 0;
  faces = 0;
  flash = false;
  top = 0;
  bottom = 0;
  scale = 0;

  /** The layout of the last frame (the dataset and the tests read it). */
  getLayout(): LcPyramidLayout {
    return this.layout;
  }

  private colors(steps: number) {
    if (steps === this.colorSteps) return;
    this.colorSteps = steps;
    this.topColors = [];
    this.leftColors = [];
    this.rightColors = [];
    for (let s = 0; s < steps; s++) {
      const c = lcPyramidLayerColor(s, steps);
      this.topColors.push(shade(c, 1.18));
      this.leftColors.push(shade(c, 0.82));
      this.rightColors.push(shade(c, 0.62));
    }
  }

  /** A glossy ball of `color` on a 64 px canvas (cached per colour). */
  private sprite(color: string): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    let c = this.sprites.get(color);
    if (!c) {
      if (this.sprites.size > 64) this.sprites.clear();
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      if (!g) return null;
      const grad = g.createRadialGradient(24, 22, 2, 32, 32, 31);
      grad.addColorStop(0, shade(color, 1.55));
      grad.addColorStop(0.45, color);
      grad.addColorStop(1, shade(color, 0.55));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(32, 32, 31, 0, TWO_PI);
      g.fill();
      this.sprites.set(color, c);
    }
    return c;
  }

  /** World space, under everything: the slab, the floor and the grid the pyramid stands on. */
  drawStage(ctx: CanvasRenderingContext2D, view: LandClaimView, p: LcPyramidView, stack = 0 /* --- low-findings-2 --- (the loop HUD stacked under the band) */) {
    const L = lcPyramidLayout(p, view.settings.hud, this.layout, stack);
    this.top = L.top;
    this.bottom = L.bottom;
    this.scale = L.k;
    const f = p.field;
    const h = f.half;
    const slab = SLAB * h;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    // the slab's two front faces
    const X = (u: number, v: number) => L.ox + (u - v) * COS30 * L.k;
    const Y = (u: number, v: number, z: number) => L.oy + ((u + v) * SIN30 - z) * L.k;
    ctx.fillStyle = SLAB_LEFT;
    ctx.beginPath();
    ctx.moveTo(X(-h, h), Y(-h, h, 0));
    ctx.lineTo(X(h, h), Y(h, h, 0));
    ctx.lineTo(X(h, h), Y(h, h, -slab));
    ctx.lineTo(X(-h, h), Y(-h, h, -slab));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = SLAB_RIGHT;
    ctx.beginPath();
    ctx.moveTo(X(h, h), Y(h, h, 0));
    ctx.lineTo(X(h, -h), Y(h, -h, 0));
    ctx.lineTo(X(h, -h), Y(h, -h, -slab));
    ctx.lineTo(X(h, h), Y(h, h, -slab));
    ctx.closePath();
    ctx.fill();
    // the floor
    ctx.fillStyle = FLOOR_TOP;
    ctx.beginPath();
    ctx.moveTo(X(-h, -h), Y(-h, -h, 0));
    ctx.lineTo(X(h, -h), Y(h, -h, 0));
    ctx.lineTo(X(h, h), Y(h, h, 0));
    ctx.lineTo(X(-h, h), Y(-h, h, 0));
    ctx.closePath();
    ctx.fill();
    // the pyramid's footprint: a faint grid (the columns knocked bare are floor again)
    const g = f.grid;
    if (g <= 200) {
      const a = f.gx0;
      const b = f.gx0 + g * f.cell;
      ctx.strokeStyle = FLOOR_GRID;
      ctx.lineWidth = Math.max(0.5, 0.04 * f.cell * L.k);
      ctx.beginPath();
      for (let i = 0; i <= g; i++) {
        const c = a + i * f.cell;
        ctx.moveTo(X(c, a), Y(c, a, 0));
        ctx.lineTo(X(c, b), Y(c, b, 0));
        ctx.moveTo(X(a, c), Y(a, c, 0));
        ctx.lineTo(X(b, c), Y(b, c, 0));
      }
      ctx.stroke();
    }
    // the cleared floor glows a moment (the hold of a looping run)
    if (p.phase === "hold" && p.clearMs >= 0) {
      ctx.fillStyle = "rgba(242, 196, 106, 0.06)";
      ctx.beginPath();
      ctx.moveTo(X(-h, -h), Y(-h, -h, 0));
      ctx.lineTo(X(h, -h), Y(h, -h, 0));
      ctx.lineTo(X(h, h), Y(h, h, 0));
      ctx.lineTo(X(-h, h), Y(-h, h, 0));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** The height (blocks, maybe fractional in the rebuild) column `k` shows this frame. */
  private shown(view: LandClaimView, p: LcPyramidView, k: number): number {
    return p.phase === "rebuild" ? lcPyramidShownHeight(p.full[k], p.kept[k], p.level) : view.heights[k];
  }

  /**
   * World space, the ball pass: the columns and the balls back to front (a ball between two diagonals of columns is drawn
   * after the ones behind it), the flying blocks and the summit's flash on top. `colorOf` gives a competitor's colour.
   */
  drawBodies(ctx: CanvasRenderingContext2D, view: LandClaimView, p: LcPyramidView, balls: readonly Ball[], nowMs: number, colorOf: (team: number) => string) {
    const f = p.field;
    const g = f.grid;
    const c = f.cell;
    this.colors(Math.max(1, p.steps));
    const n = balls.length;
    if (this.order.length < n) {
      const size = Math.max(n, 2 * this.order.length);
      const order = new Int32Array(size);
      order.set(this.order.subarray(0, Math.min(this.order.length, size)));
      this.order = order;
      this.depth = new Float64Array(size);
    }
    // the balls' depths in diagonals of columns (a column (i, j) is diagonal i + j), insertion-sorted (nearly sorted already)
    const order = this.order;
    const depth = this.depth;
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      depth[i] = (b.x - f.cx - f.gx0) / c + (b.y - f.cy - f.gx0) / c - 1;
    }
    for (let i = 1; i < n; i++) {
      const o = order[i];
      const d = depth[o];
      let j = i - 1;
      while (j >= 0 && depth[order[j]] > d) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = o;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineJoin = "round";
    this.columns = 0;
    this.balls = 0;
    this.faces = 0;
    let next = 0;
    const diagonals = 2 * g - 1;
    for (let d = 0; d < diagonals; d++) {
      while (next < n && depth[order[next]] < d) this.drawBall(ctx, balls[order[next++]], f.cx, f.cy, colorOf);
      const i0 = Math.max(0, d - (g - 1));
      const i1 = Math.min(g - 1, d);
      for (let i = i0; i <= i1; i++) {
        const j = d - i;
        const k = j * g + i;
        const h = this.shown(view, p, k);
        if (h > 0) this.drawColumn(ctx, view, p, i, j, h);
      }
    }
    while (next < n) this.drawBall(ctx, balls[order[next++]], f.cx, f.cy, colorOf);
    this.drawFlying(ctx, view, p, nowMs, colorOf);
    this.drawFlash(ctx, p, nowMs);
    ctx.restore();
  }

  /** Column (i, j) standing `h` blocks: its two front faces (only above the neighbours in front), its top, its seams. */
  private drawColumn(ctx: CanvasRenderingContext2D, view: LandClaimView, p: LcPyramidView, i: number, j: number, h: number) {
    const L = this.layout;
    const f = p.field;
    const g = f.grid;
    const c = f.cell;
    const k = L.k;
    const u0 = f.gx0 + i * c;
    const u1 = u0 + c;
    const v0 = f.gx0 + j * c;
    const v1 = v0 + c;
    const bh = L.block;
    const z = h * bh;
    const steps = Math.max(1, p.steps);
    const rows = Math.max(1, p.maxRows);
    const X = (u: number, v: number) => L.ox + (u - v) * COS30 * k;
    const Y = (u: number, v: number, zz: number) => L.oy + ((u + v) * SIN30 - zz) * k;
    // the faces in front: the right one (towards +x) above the column in front of it, the left one (towards +y) likewise
    const right = i + 1 < g ? this.shown(view, p, j * g + i + 1) : 0;
    const left = j + 1 < g ? this.shown(view, p, (j + 1) * g + i) : 0;
    this.face(ctx, X(u1, v0), Y(u1, v0, 0), X(u1, v1), Y(u1, v1, 0), Math.min(h, right), h, bh * k, rows, steps, this.rightColors);
    this.face(ctx, X(u0, v1), Y(u0, v1, 0), X(u1, v1), Y(u1, v1, 0), Math.min(h, left), h, bh * k, rows, steps, this.leftColors);
    // the top face, in the colour of the step of its top block
    const topRow = Math.max(0, Math.ceil(h) - 1);
    ctx.fillStyle = this.topColors[lcPyramidStepOf(topRow, rows, steps)];
    ctx.beginPath();
    ctx.moveTo(X(u0, v0), Y(u0, v0, z));
    ctx.lineTo(X(u1, v0), Y(u1, v0, z));
    ctx.lineTo(X(u1, v1), Y(u1, v1, z));
    ctx.lineTo(X(u0, v1), Y(u0, v1, z));
    ctx.closePath();
    ctx.fill();
    if (c * k > 4) {
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = Math.max(0.5, 0.035 * c * k);
      ctx.stroke();
    }
    this.columns++;
    this.faces++;
  }

  /**
   * A front face from the floor points (ax, ay)–(bx, by), shown from block `from` to `to` (blocks; each `blockPx` screen px
   * tall): a band per step in its colour, the blocks' seams where a block is at least 3 px tall.
   */
  private face(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, from: number, to: number, blockPx: number, rows: number, steps: number, colors: string[]) {
    if (!(to > from)) return;
    let z = from;
    while (z < to - 1e-9) {
      const step = lcPyramidStepOf(Math.floor(z + 1e-9), rows, steps);
      // the step's last row + 1 (its bands end where the next step's colour begins)
      let end = Math.ceil(((step + 1) * rows) / steps - 1e-9);
      while (end <= z + 1e-9) end++;
      const z1 = Math.min(to, end);
      ctx.fillStyle = colors[step];
      ctx.beginPath();
      ctx.moveTo(ax, ay - z * blockPx);
      ctx.lineTo(bx, by - z * blockPx);
      ctx.lineTo(bx, by - z1 * blockPx);
      ctx.lineTo(ax, ay - z1 * blockPx);
      ctx.closePath();
      ctx.fill();
      this.faces++;
      z = z1;
    }
    if (blockPx >= 3) {
      ctx.strokeStyle = SEAM;
      ctx.lineWidth = Math.max(0.5, 0.06 * blockPx);
      ctx.beginPath();
      for (let r = Math.ceil(from + 1e-9); r < to - 1e-9; r++) {
        ctx.moveTo(ax, ay - r * blockPx);
        ctx.lineTo(bx, by - r * blockPx);
      }
      ctx.moveTo(bx, by - from * blockPx);
      ctx.lineTo(bx, by - to * blockPx);
      ctx.stroke();
    }
  }

  /** A ball sitting on the floor: its shadow, then the glossy disc (a ball melting into the rebuild shrinks away). */
  private drawBall(ctx: CanvasRenderingContext2D, b: Ball, cx: number, cy: number, colorOf: (team: number) => string) {
    const L = this.layout;
    const r = b.radius * L.k;
    if (!(r >= 0.35)) return;
    const u = b.x - cx;
    const v = b.y - cy;
    const x = L.ox + (u - v) * COS30 * L.k;
    const y = L.oy + (u + v) * SIN30 * L.k;
    ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
    ctx.beginPath();
    ctx.ellipse(x, y, 1.05 * r, 0.55 * r, 0, 0, TWO_PI);
    ctx.fill();
    const color = colorOf(b.team ?? 0);
    const s = this.sprite(color);
    if (s) ctx.drawImage(s, x - r, y - 2 * r, 2 * r, 2 * r);
    else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y - r, r, 0, TWO_PI);
      ctx.fill();
    }
    this.balls++;
  }

  /** The knocked blocks: thrown off the column towards the hitter's side in its colour, arcing up and down, shrinking and fading. */
  private drawFlying(ctx: CanvasRenderingContext2D, view: LandClaimView, p: LcPyramidView, now: number, colorOf: (team: number) => string) {
    this.flying = 0;
    if (view.flyCount === 0) return;
    const L = this.layout;
    const f = p.field;
    const g = f.grid;
    const c = f.cell;
    const k = L.k;
    for (let n = 1; n <= view.flyCount; n++) {
      const e = (view.flyHead - n + LC_FLY_LOG) % LC_FLY_LOG;
      const age = now - view.flyMs[e];
      if (age >= LC_FLY_MS) break;
      if (age < 0) continue;
      const cell = view.flyCol[e];
      if (cell < 0 || cell >= g * g) continue;
      const i = cell % g;
      const j = (cell - i) / g;
      const t = age / 1000;
      const life = age / LC_FLY_MS;
      const lift = 0.6 + 0.5 * Math.abs(view.flySpin[e]) / 7;
      const u = f.gx0 + (i + 0.5) * c + view.flyVx[e] * THROW * f.half * t;
      const v = f.gx0 + (j + 0.5) * c + view.flyVy[e] * THROW * f.half * t;
      const z = Math.max(0, (view.flyRow[e] + 0.5) * L.block + c * (4 * lift * t - 7 * t * t));
      const x = L.ox + (u - v) * COS30 * k;
      const y = L.oy + ((u + v) * SIN30 - z) * k;
      const s = 0.42 * c * k * (1 - 0.45 * life);
      if (s < 0.4) continue;
      const color = colorOf(view.flyTeam[e]);
      ctx.globalAlpha = Math.pow(1 - life, 1.3);
      // a small cube: its top and its two front faces
      ctx.fillStyle = shade(color, 1.2);
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + COS30 * s, y - 0.5 * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x - COS30 * s, y - 0.5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - COS30 * s, y - 0.5 * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - COS30 * s, y + 0.5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(color, 0.7);
      ctx.beginPath();
      ctx.moveTo(x + COS30 * s, y - 0.5 * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x + COS30 * s, y + 0.5 * s);
      ctx.closePath();
      ctx.fill();
      this.flying++;
    }
    ctx.globalAlpha = 1;
  }

  /** The summit's fall: a ring of light spreading on the floor round the summit and a glow where its last block stood. */
  private drawFlash(ctx: CanvasRenderingContext2D, p: LcPyramidView, now: number) {
    this.flash = false;
    if (p.summitMs < 0) return;
    const age = now - p.summitMs;
    if (age < 0 || age >= FLASH_MS) return;
    const L = this.layout;
    const f = p.field;
    const u = age / FLASH_MS;
    const x = L.ox;
    const y = L.oy;
    const R = (0.3 + 1.6 * u) * f.cell * L.k * Math.max(1, f.grid / 6);
    ctx.globalAlpha = 0.85 * (1 - u);
    ctx.strokeStyle = "#f2c46a";
    ctx.lineWidth = Math.max(1, 0.25 * f.cell * L.k * (1 - u));
    ctx.beginPath();
    ctx.ellipse(x, y, R * COS30 * 2, R, 0, 0, TWO_PI);
    ctx.stroke();
    const glow = ctx.createRadialGradient(x, y - 0.6 * f.cell * L.k, 0, x, y - 0.6 * f.cell * L.k, 2.4 * f.cell * L.k);
    glow.addColorStop(0, "rgba(255, 236, 190, 0.9)");
    glow.addColorStop(1, "rgba(255, 200, 120, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y - 0.6 * f.cell * L.k, 2.4 * f.cell * L.k, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.flash = true;
  }
}

/** The data-lc-* keys the pyramid adds (cleared with Land Claim's own when the mode changes). */
export const LAND_CLAIM_PYRAMID_DATA_KEYS = [
  "lcLayout",
  "lcpGrid",
  "lcpSteps",
  "lcpTotal",
  "lcpMaxRows",
  "lcpShown",
  "lcpPhase",
  "lcpProgress",
  "lcpSeams",
  "lcpCycleSec",
  "lcpStartBalls",
  "lcpSummitSec",
  "lcpSummitLeft",
  "lcpSummitLast",
  "lcpClearSec",
  "lcpEndBalls",
  "lcpEnd",
  "lcpPlucks",
  "lcpChimes",
  "lcpSummits",
  "lcpClears",
  "lcpColumns",
  "lcpBallsDrawn",
  "lcpFlying",
  "lcpFaces",
  "lcpFlash",
  "lcpTop",
  "lcpBottom",
  "lcpScale",
  "lcpOnFloor",
] as const;

/** Whether every ball stands on the floor and in no column with a block (±0.5 px). */
export function lcPyramidBallsOnFloor(view: LandClaimView, p: LcPyramidView, balls: readonly Ball[]): boolean {
  const f = p.field;
  const g = f.grid;
  for (const b of balls) {
    const x = b.x - f.cx;
    const y = b.y - f.cy;
    if (Math.abs(x) + b.radius > f.half + 0.5 || Math.abs(y) + b.radius > f.half + 0.5) return false;
    if (p.phase === "rebuild") continue;
    const i = Math.floor((x - f.gx0) / f.cell);
    const j = Math.floor((y - f.gx0) / f.cell);
    if (i >= 0 && j >= 0 && i < g && j < g && view.heights[j * g + i] > 0) {
      // the centre inside a standing column: only a ball pushed in by a crowd this very step (never more than its radius)
      const ax = f.gx0 + i * f.cell;
      const ay = f.gx0 + j * f.cell;
      const inside = Math.min(x - ax, ax + f.cell - x, y - ay, ay + f.cell - y);
      if (inside > b.radius + 0.5) return false;
    }
  }
  return true;
}

/** Mirrors the pyramid onto the canvas element (data-lc-layout, data-lcp-*): the grid, the blocks, the loop, the summit, what was drawn. */
export function writeLandClaimPyramidDataset(view: LandClaimView, layer: LandClaimPyramidLayer, balls: readonly Ball[], set: (key: string, value: string) => void) {
  const p = view.pyramid;
  set("lcLayout", p ? "pyramid" : "wall");
  if (!p) {
    for (const key of LAND_CLAIM_PYRAMID_DATA_KEYS) if (key !== "lcLayout") set(key, "");
    return;
  }
  set("lcpGrid", String(p.grid));
  set("lcpSteps", String(p.steps));
  set("lcpTotal", String(p.total));
  set("lcpMaxRows", String(p.maxRows));
  set("lcpShown", String(p.shown));
  set("lcpPhase", p.phase);
  set("lcpProgress", p.progress.toFixed(3));
  set("lcpSeams", String(p.seams));
  set("lcpCycleSec", p.cycleSec > 0 ? p.cycleSec.toFixed(3) : "");
  set("lcpStartBalls", String(p.startBalls));
  set("lcpSummitSec", p.firstSummitSec >= 0 ? p.firstSummitSec.toFixed(3) : "");
  set("lcpSummitLeft", String(p.firstSummitLeft));
  set("lcpSummitLast", p.firstSummitSec >= 0 ? (p.firstSummitLeft === 0 ? "1" : "0") : "");
  set("lcpClearSec", p.firstClearSec >= 0 ? p.firstClearSec.toFixed(3) : "");
  set("lcpEndBalls", String(p.firstEndBalls));
  set("lcpEnd", p.end);
  set("lcpPlucks", String(p.plucks));
  set("lcpChimes", String(p.chimes));
  set("lcpSummits", String(p.summits));
  set("lcpClears", String(p.clears));
  set("lcpColumns", String(layer.columns));
  set("lcpBallsDrawn", String(layer.balls));
  set("lcpFlying", String(layer.flying));
  set("lcpFaces", String(layer.faces));
  set("lcpFlash", layer.flash ? "1" : "0");
  set("lcpTop", layer.top.toFixed(1));
  set("lcpBottom", layer.bottom.toFixed(1));
  set("lcpScale", layer.scale.toFixed(4));
  set("lcpOnFloor", lcPyramidBallsOnFloor(view, p, balls) ? "1" : "0");
}
