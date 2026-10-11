import { GLOW_SPRITE_SIZE, cacheSprite } from "../renderBudget";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's sprite plumbing (shared by every module of the renderer): rasters of vector
 * drawings in a local frame, cached glow discs (the only soft light the main context ever sees – no shadowBlur there), the
 * analytic hash the effects take their scatter from, and a rounded-rectangle path.
 *
 * A sprite is built once (on its own canvas: a shadow or a gradient there is paid for once) and drawn with one drawImage.
 */

export const TWO_PI = Math.PI * 2;
export const DEG = Math.PI / 180;

/** A raster of a vector drawing in a local frame (+x = forward) and that frame's bounds (CSS px). */
export interface Sprite {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Bounds of a drawing in its local frame (CSS px). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A fresh canvas of `w` × `h` device px (null without a document: a worker, the tests' bare Node). */
export function newCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  const canvas = document.createElement("canvas") as HTMLCanvasElement;
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return canvas;
}

/** A raster of `draw` over `box` at `scale` device px per CSS px. */
export function makeSprite(box: Box, scale: number, draw: (g: CanvasRenderingContext2D) => void): Sprite | null {
  const w = Math.max(1, box.x1 - box.x0);
  const h = Math.max(1, box.y1 - box.y0);
  const canvas = newCanvas(w * scale, h * scale);
  if (!canvas) return null;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.setTransform(scale, 0, 0, scale, -box.x0 * scale, -box.y0 * scale);
  draw(g);
  return { canvas, x0: box.x0, y0: box.y0, w, h };
}

/** Draws `s` with its origin at (x, y), turned by `angle`, scaled by `k`, at `alpha` (× the context's). */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, angle: number, alpha = 1, k = 1) {
  if (angle === 0) {
    if (alpha < 1) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * alpha;
      ctx.drawImage(s.canvas, x + s.x0 * k, y + s.y0 * k, s.w * k, s.h * k);
      ctx.globalAlpha = a;
    } else ctx.drawImage(s.canvas, x + s.x0 * k, y + s.y0 * k, s.w * k, s.h * k);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(s.canvas, s.x0 * k, s.y0 * k, s.w * k, s.h * k);
  ctx.restore();
}

/** A stable pseudo-random number in [0, 1) for index `i` and salt `s` (analytic shards, sparks, confetti, stars). */
export function hash(i: number, s: number): number {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A rounded rectangle path (arcTo: every context has it). */
export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/** A regular polygon path of `n` corners around (x, y) at radius `r`, its first corner at `angle`. */
export function polygonPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, angle: number) {
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = angle + (k * TWO_PI) / n;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** A star path (`n` points, outer radius `r`, inner `ri`) around (x, y). */
export function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ri: number, n: number, angle: number) {
  ctx.beginPath();
  for (let k = 0; k < 2 * n; k++) {
    const a = angle + (k * Math.PI) / n;
    const rr = k % 2 === 0 ? r : ri;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/**
 * Soft round glows, one GLOW_SPRITE_SIZE raster per colour (a radial gradient built once on the sprite's canvas), drawn
 * scaled: the giant hit's aura, the telegraphs' glints, the winner's and the looks' glows, the banners' halos.
 */
export class GlowSprites {
  private readonly cache = new Map<string, HTMLCanvasElement>();

  /** The glow raster of `color` (null without a canvas). */
  get(color: string): HTMLCanvasElement | null {
    let c = this.cache.get(color);
    if (c) return c;
    const canvas = newCanvas(GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
    if (!canvas) return null;
    const g = canvas.getContext("2d");
    if (!g) return null;
    const h = GLOW_SPRITE_SIZE / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.globalAlpha = 1;
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
    c = canvas;
    cacheSprite(this.cache, color, c, 48);
    return c;
  }

  /** A glow of `color` of radius `r` around (x, y) at `alpha`. */
  draw(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, alpha: number) {
    if (!(r > 0) || !(alpha > 0)) return;
    const c = this.get(color);
    if (!c) return;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * Math.min(1, alpha);
    ctx.drawImage(c, x - r, y - r, 2 * r, 2 * r);
    ctx.globalAlpha = a;
  }

  clear() {
    this.cache.clear();
  }
}

/** A small keyed sprite cache (oldest first out) for one module's rasters. */
export class SpriteCache<K> {
  private readonly map = new Map<K, Sprite | null>();
  constructor(private readonly cap: number) {}

  get(key: K, build: () => Sprite | null): Sprite | null {
    if (this.map.has(key)) return this.map.get(key) ?? null;
    while (this.map.size >= this.cap) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
    const s = build();
    this.map.set(key, s);
    return s;
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
