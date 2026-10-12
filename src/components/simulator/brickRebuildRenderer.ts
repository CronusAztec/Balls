import type { Ball } from "@/lib/physics/types";
import { BR_GHOST_MS, applyImage, rebuildBend, rebuildFlight, rebuildOrigin } from "@/lib/physics/brickRebuild";
import type { BrickRebuildView } from "@/lib/physics/modes/brickRebuild";
import { BR_COLOURS } from "@/lib/physics/brickRebuildSettings";

/*
 * --- brick-rebuild --- Brick Smash's picture (lib/physics/modes/brickRebuild.ts runs it), drawn in world px under the page's
 * camera:
 *
 * - **the box** (or the kaleidoscope's circle): a thin grey border (#b9b6aa);
 * - **the bricks**: a cached layer in device pixels, redrawn only for the cells whose state changed since the last frame (a
 *   break, a landing), each brick its palette colour with a subtle vignette toward the picture's edges and a 1 px grout line,
 *   a damaged brick (hit points left) lighter; the whole layer is repainted only when the run, the picture or the size changes;
 * - **the breaks**: a pool of ghost squares – each broken brick greys to lilac and shrinks away over BR_GHOST_MS;
 * - **the gold capsules and the paddle** (the capsules variant);
 * - **the rebuild**: the bricks in flight on top, along their eased curves from their off-screen points, slightly enlarged;
 * - **the balls**: hollow – white with a 1 px dark rim – with every kaleidoscope image of each, fading out in the rebuild while
 *   the start balls fade in at their places (with the outline off the page's own ball look draws the real balls and this layer
 *   their images);
 * - **the counters** under the box when the loop HUD is off ("N bricks", and "N balls" with the capsules).
 *
 * Nothing is allocated per frame (one scratch point, the layer's typed state).
 */

/** What the canvas hands the layer each frame. */
export interface BrickRebuildRenderOptions {
  /** Device px per world px (the grout and the rims stay a device pixel). */
  dpr: number;
  /** The loop HUD is on: its counter shows the bricks (this layer draws none). */
  hudOn: boolean;
  /** The counters' words (English without them). */
  bricksLabel?: (n: number) => string;
  ballsLabel?: (n: number) => string;
}

/** The brick layer's longest side in device px (a memory-safety bound: past it the layer is drawn coarser). */
export const BR_LAYER_MAX_PX = 4096;
/** How dark the vignette makes a brick at the picture's corner. */
export const BR_VIGNETTE = 0.22;

const POINT = { x: 0, y: 0 };
const FLIGHT = { x: 0, y: 0, scale: 1 };

type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
type LayerContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A canvas for the cached layer: an OffscreenCanvas, else a DOM canvas, else none (a headless test draws the cells directly). */
function createLayerCanvas(w: number, h: number): LayerCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

export class BrickRebuildLayer {
  /** What the last frame drew (data-br-*): cells repainted in the cached layer, ghosts, bricks in flight, balls drawn (images included). */
  redrawn = 0;
  ghosts = 0;
  flying = 0;
  ballsDrawn = 0;
  /** Full repaints of the layer so far (a new run, picture or size). */
  repaints = 0;
  private layer: LayerCanvas | null = null;
  private lctx: LayerContext | null = null;
  private drawn = new Int32Array(0);
  private key = "";
  private pxW = 1;
  private pxH = 1;

  /** Whether this layer draws the balls (the outline look); off, the page's ball pass draws them and `drawStage()` their images. */
  drawsBodies(view: BrickRebuildView): boolean {
    return view.settings.outline;
  }

  /** The box (or circle), the bricks, the ghosts, the paddle and capsules, the bricks in flight and the counters. */
  drawStage(ctx: CanvasRenderingContext2D, view: BrickRebuildView, opts: BrickRebuildRenderOptions) {
    const f = view.field;
    const hair = 1 / Math.max(1e-6, opts.dpr);
    ctx.save();
    // the box's (or the circle's) thin grey border
    ctx.strokeStyle = BR_COLOURS.border;
    ctx.lineWidth = Math.max(hair, 1.5 * hair);
    ctx.beginPath();
    if (f.layout === "mandala") ctx.arc(f.cx, f.cy, f.radius, 0, 2 * Math.PI);
    else ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
    ctx.stroke();
    this.drawBricks(ctx, view, opts);
    this.drawGhosts(ctx, view);
    if (view.paddleOn) this.drawPaddle(ctx, view);
    this.drawFlying(ctx, view);
    if (!opts.hudOn || view.paddleOn) this.drawCounters(ctx, view, opts);
    ctx.restore();
  }

  /* -------------------------------------------------------------- the bricks */

  /** A brick's colour at full health, with the vignette: the palette colour darkened toward the picture's corners. */
  private shade(view: BrickRebuildView, cell: number): number {
    const f = view.field;
    const i = cell % f.cols;
    const j = Math.floor(cell / f.cols);
    const u = f.cols > 1 ? (2 * i) / (f.cols - 1) - 1 : 0;
    const w = f.rows > 1 ? (2 * j) / (f.rows - 1) - 1 : 0;
    return BR_VIGNETTE * Math.min(1, 0.5 * (u * u + w * w));
  }

  private paintCell(c: LayerContext, view: BrickRebuildView, cell: number, sx: number, sy: number) {
    const f = view.field;
    const i = cell % f.cols;
    const j = Math.floor(cell / f.cols);
    const x = i * f.cw * sx;
    const y = j * f.ch * sy;
    const w = f.cw * sx;
    const h = f.ch * sy;
    c.clearRect(x, y, w, h);
    const hp = view.hp[cell] ?? 0;
    if (!view.mask[cell] || hp <= 0) return;
    const g = Math.min(1, Math.max(0.5, 0.06 * Math.min(w, h)));
    c.fillStyle = view.picture.palette[view.picture.colours[cell] ?? 0] ?? "#1b2350";
    c.fillRect(x + g, y + g, Math.max(0, w - 2 * g), Math.max(0, h - 2 * g));
    const dark = this.shade(view, cell);
    if (dark > 0.004) {
      c.fillStyle = `rgba(0, 0, 0, ${dark.toFixed(3)})`;
      c.fillRect(x + g, y + g, Math.max(0, w - 2 * g), Math.max(0, h - 2 * g));
    }
    if (hp < view.hpMax) {
      c.fillStyle = `rgba(255, 255, 255, ${(0.45 * (1 - hp / view.hpMax)).toFixed(3)})`;
      c.fillRect(x + g, y + g, Math.max(0, w - 2 * g), Math.max(0, h - 2 * g));
    }
  }

  /** The cached layer: rebuilt for a new run, picture or size; otherwise only the cells whose hit points changed are repainted. */
  private drawBricks(ctx: CanvasRenderingContext2D, view: BrickRebuildView, opts: BrickRebuildRenderOptions) {
    const f = view.field;
    const n = f.cols * f.rows;
    const wallW = f.cols * f.cw;
    const wallH = f.rows * f.ch;
    this.redrawn = 0;
    if (n === 0 || !(wallW > 0) || !(wallH > 0)) return;
    let pxW = Math.max(1, Math.round(wallW * opts.dpr));
    let pxH = Math.max(1, Math.round(wallH * opts.dpr));
    const big = Math.max(pxW, pxH);
    if (big > BR_LAYER_MAX_PX) {
      pxW = Math.max(1, Math.round((pxW * BR_LAYER_MAX_PX) / big));
      pxH = Math.max(1, Math.round((pxH * BR_LAYER_MAX_PX) / big));
    }
    const key = `${view.generation}|${view.pictureVersion}|${pxW}|${pxH}|${f.cols}|${f.rows}`;
    if (key !== this.key || !this.lctx) {
      this.key = key;
      this.pxW = pxW;
      this.pxH = pxH;
      if (!this.layer || this.layer.width !== pxW || this.layer.height !== pxH) {
        this.layer = createLayerCanvas(pxW, pxH);
        this.lctx = this.layer ? (this.layer.getContext("2d") as LayerContext | null) : null;
      }
      if (this.drawn.length !== n) this.drawn = new Int32Array(n);
      this.drawn.fill(-1);
      this.repaints++;
      this.lctx?.clearRect(0, 0, pxW, pxH);
    }
    const c = this.lctx;
    if (!c || !this.layer) {
      // no offscreen canvas (a headless run): the standing bricks straight onto the canvas
      for (let cell = 0; cell < n; cell++) {
        if (!view.mask[cell] || view.hp[cell] <= 0) continue;
        ctx.fillStyle = view.picture.palette[view.picture.colours[cell] ?? 0] ?? "#1b2350";
        ctx.fillRect(f.gx + (cell % f.cols) * f.cw, f.gy + Math.floor(cell / f.cols) * f.ch, f.cw, f.ch);
      }
      return;
    }
    const sx = this.pxW / wallW;
    const sy = this.pxH / wallH;
    let redrawn = 0;
    const hp = view.hp;
    const drawn = this.drawn;
    for (let cell = 0; cell < n; cell++) {
      const now = view.mask[cell] ? hp[cell] : 0;
      if (drawn[cell] === now) continue;
      drawn[cell] = now;
      this.paintCell(c, view, cell, sx, sy);
      redrawn++;
    }
    this.redrawn = redrawn;
    ctx.drawImage(this.layer as CanvasImageSource, f.gx, f.gy, wallW, wallH);
  }

  /** The breaks of the last BR_GHOST_MS: grey-lilac squares shrinking away. */
  private drawGhosts(ctx: CanvasRenderingContext2D, view: BrickRebuildView) {
    const f = view.field;
    let drawn = 0;
    ctx.fillStyle = BR_COLOURS.ghost;
    for (let k = 0; k < view.ghostCount; k++) {
      const at = (view.ghostHead - 1 - k + view.ghostCell.length) % view.ghostCell.length;
      const age = view.cycleMs - view.ghostMs[at];
      if (age < 0 || age > BR_GHOST_MS) {
        if (age > BR_GHOST_MS) break;
        continue;
      }
      const u = age / BR_GHOST_MS;
      const cell = view.ghostCell[at];
      const cx = f.gx + ((cell % f.cols) + 0.5) * f.cw;
      const cy = f.gy + (Math.floor(cell / f.cols) + 0.5) * f.ch;
      const s = 1 - u;
      ctx.globalAlpha = 0.85 * (1 - u);
      ctx.fillRect(cx - (f.cw * s) / 2, cy - (f.ch * s) / 2, f.cw * s, f.ch * s);
      drawn++;
    }
    ctx.globalAlpha = 1;
    this.ghosts = drawn;
  }

  /** The auto-paddle and the gold capsules falling toward it. */
  private drawPaddle(ctx: CanvasRenderingContext2D, view: BrickRebuildView) {
    ctx.fillStyle = BR_COLOURS.paddle;
    ctx.fillRect(view.paddleX - view.paddleW / 2, view.paddleY, view.paddleW, view.paddleH);
    const w = view.capsuleW;
    const h = view.capsuleH;
    for (let i = 0; i < view.capCount; i++) {
      const x = view.capX[i];
      const y = view.capY[i];
      ctx.fillStyle = BR_COLOURS.capsule;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + h / 2, y - h / 2);
      ctx.lineTo(x + w / 2 - h / 2, y - h / 2);
      ctx.arc(x + w / 2 - h / 2, y, h / 2, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x - w / 2 + h / 2, y + h / 2);
      ctx.arc(x - w / 2 + h / 2, y, h / 2, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = BR_COLOURS.capsuleRim;
      ctx.lineWidth = Math.max(0.5, 0.12 * h);
      ctx.stroke();
    }
  }

  /** The rebuild's bricks in flight (left their off-screen point, not landed yet), on top, slightly enlarged. */
  private drawFlying(ctx: CanvasRenderingContext2D, view: BrickRebuildView) {
    this.flying = 0;
    if (view.phase !== "rebuild" || view.orderCount === 0) return;
    const f = view.field;
    const t = view.phaseMs;
    const flight = view.flightMs;
    let flying = 0;
    for (let k = view.landed; k < view.orderCount; k++) {
      const depart = view.landMs[k] - flight;
      if (depart > t) break;
      const cell = view.order[k];
      const u = flight > 0 ? (t - depart) / flight : 1;
      const tx = f.gx + ((cell % f.cols) + 0.5) * f.cw;
      const ty = f.gy + (Math.floor(cell / f.cols) + 0.5) * f.ch;
      const angle = view.originU[cell] ?? 0;
      rebuildOrigin(2 * f.cx, 2 * f.cy, angle, POINT);
      rebuildFlight(POINT.x, POINT.y, tx, ty, rebuildBend(angle), u, FLIGHT);
      const w = f.cw * FLIGHT.scale;
      const h = f.ch * FLIGHT.scale;
      ctx.fillStyle = view.picture.palette[view.picture.colours[cell] ?? 0] ?? "#1b2350";
      ctx.fillRect(FLIGHT.x - w / 2, FLIGHT.y - h / 2, w, h);
      flying++;
    }
    this.flying = flying;
  }

  /** The counters under the box: the bricks (without the loop HUD) and the balls (the capsules variant). */
  private drawCounters(ctx: CanvasRenderingContext2D, view: BrickRebuildView, opts: BrickRebuildRenderOptions) {
    const f = view.field;
    const size = Math.max(6, 0.045 * (f.y1 - f.y0));
    ctx.font = `600 ${size.toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = BR_COLOURS.counter;
    ctx.textBaseline = "top";
    const y = f.y1 + 0.6 * size;
    if (!opts.hudOn) {
      ctx.textAlign = view.paddleOn ? "left" : "center";
      ctx.fillText(opts.bricksLabel ? opts.bricksLabel(view.bricks) : `${view.bricks} bricks`, view.paddleOn ? f.x0 : f.cx, y);
    }
    if (view.paddleOn) {
      ctx.textAlign = "right";
      ctx.fillText(opts.ballsLabel ? opts.ballsLabel(view.balls) : `${view.balls} balls`, f.x1, y);
    }
  }

  /* -------------------------------------------------------------- the balls */

  /**
   * The balls (hollow, a 1 px dark rim) with every kaleidoscope image of each, at the rebuild's fade; the start balls fading in
   * at their places at the rebuild's end (so the last frame of a loop is its first). `imagesOnly`: the outline is off and the
   * page's ball pass drew the real balls – only their kaleidoscope images, as discs in the balls' colours.
   */
  drawBodies(ctx: CanvasRenderingContext2D, view: BrickRebuildView, balls: readonly Ball[], opts: BrickRebuildRenderOptions, imagesOnly = false) {
    const f = view.field;
    const images = Math.max(1, view.images);
    const mode = view.mirror ? "mirror" : "rotate";
    const hair = 1 / Math.max(1e-6, opts.dpr);
    const outline = view.settings.outline;
    let drawn = 0;
    ctx.save();
    ctx.lineWidth = Math.max(hair, 0.18 * view.ballRadius);
    ctx.strokeStyle = BR_COLOURS.ballRim;
    const pass = (alpha: number, count: number, xAt: (i: number) => number, yAt: (i: number) => number, rAt: (i: number) => number, colourAt: (i: number) => string) => {
      if (alpha <= 0.004 || count === 0) return;
      ctx.globalAlpha = alpha;
      for (let i = 0; i < count; i++) {
        const dx = xAt(i) - f.cx;
        const dy = yAt(i) - f.cy;
        const r = rAt(i);
        ctx.fillStyle = outline ? BR_COLOURS.ballFill : colourAt(i);
        for (let k = imagesOnly ? 1 : 0; k < images; k++) {
          if (k === 0) {
            POINT.x = dx;
            POINT.y = dy;
          } else applyImage(dx, dy, k, images, mode, POINT);
          ctx.beginPath();
          ctx.arc(f.cx + POINT.x, f.cy + POINT.y, r, 0, 2 * Math.PI);
          ctx.fill();
          if (outline) ctx.stroke();
          drawn++;
        }
      }
    };
    pass(imagesOnly ? 1 : view.ballAlpha, balls.length, (i) => balls[i].x, (i) => balls[i].y, (i) => balls[i].radius, (i) => balls[i].color);
    if (view.phase === "rebuild" && !imagesOnly) pass(view.startAlpha, view.startX.length, (i) => view.startX[i], (i) => view.startY[i], () => view.ballRadius, () => BR_COLOURS.ballFill);
    ctx.globalAlpha = 1;
    ctx.restore();
    this.ballsDrawn = drawn;
  }
}

/**
 * How far the playfield reaches above and below its centre (world px): the loop HUD keeps clear of it – the box and its border,
 * and with the paddle the ball counter under the box (the HUD's own counter then goes below it).
 */
export function brickRebuildExtentPx(view: BrickRebuildView): number {
  const f = view.field;
  if (f.layout === "mandala") return f.radius + 2;
  const boxH = f.y1 - f.y0;
  return boxH / 2 + (view.paddleOn ? 0.1 * boxH : 2);
}

/** The canvas' data-br-* keys (cleared when another mode runs). */
export const BRICK_REBUILD_DATA_KEYS = ["brPhase", "brBricks", "brTotal", "brBalls", "brMaxBalls", "brImages", "brSeams", "brCycle", "brNextSeam", "brCleared", "brFirstEnd", "brFirstBalls", "brBroken", "brSpawned", "brRefused", "brLanded", "brFlying", "brGhosts", "brRedrawn", "brRepaints", "brEscaped", "brNan", "brSounds", "brPlucks", "brKicks", "brCaught", "brSplits", "brPicture", "brColours", "brCols", "brRows", "brBallsDrawn", "brBedOn"] as const;

/** Mirrors a Brick Smash run onto the canvas' dataset (data-br-*), for tools and the smoke test. */
export function writeBrickRebuildDataset(view: BrickRebuildView, layer: BrickRebuildLayer, set: (key: string, value: string) => void) {
  set("brPhase", view.phase);
  set("brBricks", String(view.bricks));
  set("brTotal", String(view.total));
  set("brBalls", String(view.balls));
  set("brMaxBalls", String(view.maxBalls));
  set("brImages", String(view.images));
  set("brSeams", String(view.seams));
  set("brCycle", view.cycleSec.toFixed(3));
  set("brNextSeam", String(Math.round(view.nextSeamMs)));
  set("brCleared", view.firstClearSec.toFixed(3));
  set("brFirstEnd", view.firstEnd);
  set("brFirstBalls", String(view.firstBalls));
  set("brBroken", String(view.broken));
  set("brSpawned", String(view.spawned));
  set("brRefused", String(view.refused));
  set("brLanded", String(view.landed));
  set("brFlying", String(layer.flying));
  set("brGhosts", String(layer.ghosts));
  set("brRedrawn", String(layer.redrawn));
  set("brRepaints", String(layer.repaints));
  set("brEscaped", String(view.escaped));
  set("brNan", String(view.nonFinite));
  set("brSounds", String(view.sounds));
  set("brPlucks", String(view.plucks));
  set("brKicks", String(view.kicks));
  set("brCaught", String(view.caught));
  set("brSplits", String(view.splits));
  set("brPicture", view.pictureSource);
  set("brColours", String(view.picture.palette.length));
  set("brCols", String(view.field.cols));
  set("brRows", String(view.field.rows));
  set("brBallsDrawn", String(layer.ballsDrawn));
  set("brBedOn", view.bedOn ? "1" : "0");
}
