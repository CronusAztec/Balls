import type { Ball, Particle } from "@/lib/physics/types";
import type { RecordingCrop } from "@/lib/recording/recorder";
import type { BackgroundType } from "@/lib/themes";

/*
 * Drawing side of "Themes and backgrounds" (lib/themes.ts): the gradient and picture backgrounds
 * (on the canvas and in the letterbox bars of an export), the theme-coloured colour trail and the
 * styled particles (sparks, petals, pixels, bubbles – spawned by lib/physics/particleStyles.ts).
 * Everything is cached so a frame allocates nothing: the gradient per size and colour pair, the
 * dimmed cover-fitted picture per size and dim, the trail colours as a 64-step lookup table.
 */

const TWO_PI = Math.PI * 2;

export interface BackgroundLook {
  type: BackgroundType;
  colors: readonly string[];
  dim: number;
  image: HTMLImageElement | null;
}

function imageSize(image: HTMLImageElement) {
  return { w: image.naturalWidth || image.width, h: image.naturalHeight || image.height };
}

/** Draws `image` cover-fitted (the shorter side fills, centred) into a w × h area of `g`. */
function drawCover(g: CanvasRenderingContext2D, image: HTMLImageElement, w: number, h: number) {
  const { w: iw, h: ih } = imageSize(image);
  const fit = Math.max(w / iw, h / ih);
  g.drawImage(image, (w - iw * fit) / 2, (h - ih * fit) / 2, iw * fit, ih * fit);
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * Paints the background types that are not a plain fill. One painter lives as long as the canvas; the
 * canvas calls `paint()` every frame (right after its solid fill) and the recorder calls `paintExport()`
 * for every exported frame, which lines the background up with the cropped canvas so the letterbox bars
 * of a vertical export continue it without a seam.
 */
export class BackgroundPainter {
  private gradient: CanvasGradient | null = null;
  private gradientKey = "";
  private exportGradient: CanvasGradient | null = null;
  private exportGradientKey = "";
  /** The dimmed, cover-fitted picture at the canvas's device size. */
  private layer: HTMLCanvasElement | null = null;
  private layerKey = "";
  private layerImage: HTMLImageElement | null = null;
  /** A blurred, darker full-frame copy for the letterbox bars of an export. */
  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey = "";
  private backdropImage: HTMLImageElement | null = null;

  /**
   * Gradient (top → bottom) or picture over the canvas, in CSS pixels under the device-pixel transform. The solid
   * colour is the canvas's own fill, so it draws nothing for "solid" – or for "image" until a picture is loaded.
   * Returns whether it painted.
   */
  paint(ctx: CanvasRenderingContext2D, width: number, height: number, look: BackgroundLook, dpr: number): boolean {
    if (look.type === "gradient" && look.colors.length >= 2) {
      const key = `${look.colors[0]}|${look.colors[1]}|${height}`;
      if (!this.gradient || key !== this.gradientKey) {
        const g = ctx.createLinearGradient(0, 0, 0, height);
        g.addColorStop(0, look.colors[0]);
        g.addColorStop(1, look.colors[1]);
        this.gradient = g;
        this.gradientKey = key;
      }
      ctx.fillStyle = this.gradient;
      ctx.fillRect(0, 0, width, height);
      return true;
    }
    if (look.type === "image" && look.image) {
      const layer = this.imageLayer(look.image, Math.round(width * dpr), Math.round(height * dpr), look.dim);
      if (!layer) return false;
      ctx.drawImage(layer, 0, 0, width, height);
      return true;
    }
    return false;
  }

  /** The cover-fitted picture with the dim baked in, rebuilt only when the picture, the size or the dim changes. */
  private imageLayer(image: HTMLImageElement, w: number, h: number, dim: number): HTMLCanvasElement | null {
    const { w: iw, h: ih } = imageSize(image);
    if (!(iw > 0 && ih > 0 && w > 0 && h > 0)) return null;
    const key = `${w}x${h}|${dim.toFixed(3)}`;
    if (this.layer && this.layerImage === image && this.layerKey === key) return this.layer;
    const layer = this.layer && this.layer.width === w && this.layer.height === h ? this.layer : makeCanvas(w, h);
    const g = layer.getContext("2d");
    if (!g) return null;
    g.clearRect(0, 0, w, h);
    drawCover(g, image, w, h);
    if (dim > 0) {
      g.fillStyle = `rgba(0, 0, 0, ${Math.min(1, dim).toFixed(3)})`;
      g.fillRect(0, 0, w, h);
    }
    this.layer = layer;
    this.layerImage = image;
    this.layerKey = key;
    return layer;
  }

  /**
   * The background of one exported frame (width × height, export pixels), before the recorder draws the cropped
   * canvas on top. `crop` says where the canvas lands: the gradient runs over the whole canvas mapped into the
   * frame (so it meets the crop seamlessly and the bars take its end colours); a picture fills the bars with a
   * blurred, darker copy of itself and continues the canvas's own layer wherever the canvas reaches.
   */
  paintExport(ctx: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop, look: BackgroundLook): void {
    ctx.fillStyle = look.colors[0] ?? "#0a0a0a";
    ctx.fillRect(0, 0, width, height);
    const scale = crop.dw / crop.side;
    const top = crop.dy - crop.sy * scale;
    const bottom = crop.dy + (crop.sourceHeight - crop.sy) * scale;
    if (look.type === "gradient" && look.colors.length >= 2) {
      const key = `${look.colors[0]}|${look.colors[1]}|${top.toFixed(1)}|${bottom.toFixed(1)}`;
      if (!this.exportGradient || key !== this.exportGradientKey) {
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, look.colors[0]);
        g.addColorStop(1, look.colors[1]);
        this.exportGradient = g;
        this.exportGradientKey = key;
      }
      ctx.fillStyle = this.exportGradient;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (look.type === "image" && look.image) {
      const backdrop = this.exportBackdrop(look.image, width, height, look.dim);
      if (backdrop) ctx.drawImage(backdrop, 0, 0, width, height);
      if (this.layer && this.layerImage === look.image) {
        const left = crop.dx - crop.sx * scale;
        ctx.drawImage(this.layer, left, top, crop.sourceWidth * scale, crop.sourceHeight * scale);
      }
    }
  }

  private exportBackdrop(image: HTMLImageElement, w: number, h: number, dim: number): HTMLCanvasElement | null {
    const { w: iw, h: ih } = imageSize(image);
    if (!(iw > 0 && ih > 0)) return null;
    const key = `${w}x${h}|${dim.toFixed(3)}`;
    if (this.backdrop && this.backdropImage === image && this.backdropKey === key) return this.backdrop;
    const c = makeCanvas(w, h);
    const g = c.getContext("2d");
    if (!g) return null;
    const blur = Math.round(Math.max(w, h) / 60);
    if (typeof g.filter === "string") g.filter = `blur(${blur}px)`;
    // Drawn a little larger so the blur does not fade out at the edges.
    g.save();
    g.translate(-blur * 2, -blur * 2);
    drawCover(g, image, w + blur * 4, h + blur * 4);
    g.restore();
    if (typeof g.filter === "string") g.filter = "none";
    g.fillStyle = `rgba(0, 0, 0, ${Math.min(1, dim + (1 - dim) * 0.35).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
    this.backdrop = c;
    this.backdropImage = image;
    this.backdropKey = key;
    return c;
  }
}

/* ------------------------------------------------------------------ colour trail */

const TRAIL_STEPS = 64;
let trailKey = "";
let trailTable: string[] | null = null;

function parseHex(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full.slice(0, 6), 16);
  return Number.isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } : { r: 255, g: 255, b: 255 };
}

/**
 * The theme's two trail colours as a 64-step cycle (first → second → first, cosine-eased) of ready-made
 * `rgb()` strings, or null for the rainbow (no trail colours). Cached for the last colour pair.
 */
export function trailColorTable(colors: readonly string[]): string[] | null {
  if (colors.length !== 2) return null;
  const key = `${colors[0]}|${colors[1]}`;
  if (trailTable && key === trailKey) return trailTable;
  const a = parseHex(colors[0]);
  const b = parseHex(colors[1]);
  const table: string[] = [];
  for (let k = 0; k < TRAIL_STEPS; k++) {
    const t = 0.5 - 0.5 * Math.cos((TWO_PI * k) / TRAIL_STEPS);
    table.push(`rgb(${Math.round(a.r + (b.r - a.r) * t)}, ${Math.round(a.g + (b.g - a.g) * t)}, ${Math.round(a.b + (b.b - a.b) * t)})`);
  }
  trailKey = key;
  trailTable = table;
  return table;
}

/**
 * The colour trail in the theme's colours: the same tapering, fading segments as the rainbow trail, with the
 * hue cycle replaced by the two-colour table (so the colours still flow along the trail and over time).
 */
export function drawThemedTrail(ctx: CanvasRenderingContext2D, ball: Ball, table: string[], thickness: number, time: number, index: number, intensity: number) {
  const len = ball.trail.length;
  for (let i = 1; i < len; i++) {
    const t = i / len;
    const phase = (0.1 * time + 15 * i + 60 * index) % 360;
    const from = ball.trail[(ball.trailIndex + i - 1) % len];
    const to = ball.trail[(ball.trailIndex + i) % len];
    ctx.strokeStyle = table[Math.floor((phase / 360) * TRAIL_STEPS) % TRAIL_STEPS];
    ctx.globalAlpha = Math.min(1, (0.1 + 0.5 * t) * intensity);
    ctx.lineWidth = ball.radius * thickness * (0.3 + 0.7 * t);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ styled particles */

/**
 * Draws one styled particle. The canvas has already translated to the particle, rotated it and set the alpha
 * to its remaining life (`life`, 0–1); the caller restores the context afterwards.
 */
export function drawStyledParticle(ctx: CanvasRenderingContext2D, part: Particle, life: number) {
  const s = part.size;
  switch (part.style) {
    case "sparks": {
      // A streak along the flight direction: a soft coloured stroke under a hot white core.
      const k = 0.035;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-part.vx * k, -part.vy * k);
      ctx.strokeStyle = part.color;
      ctx.lineWidth = s * 2.2;
      ctx.globalAlpha = 0.45 * life;
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = s * 0.8;
      ctx.globalAlpha = life;
      ctx.stroke();
      break;
    }
    case "petals": {
      // A leaf-shaped petal that flutters: its width swings with its spin, like a petal turning in the air.
      ctx.scale(0.25 + 0.75 * Math.abs(Math.cos(2 * part.rotation)), 1);
      ctx.fillStyle = part.color;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(0.9 * s, -0.2 * s, 0, s);
      ctx.quadraticCurveTo(-0.9 * s, -0.2 * s, 0, -s);
      ctx.fill();
      break;
    }
    case "pixels": {
      // Squares snapped to their own size grid (a retro look), blinking out over the last third of their life.
      const ox = Math.round(part.x / s) * s - part.x;
      const oy = Math.round(part.y / s) * s - part.y;
      ctx.globalAlpha = life > 0.33 ? 1 : Math.floor(part.life * 16) % 2 === 0 ? 0.9 : 0.2;
      ctx.fillStyle = part.color;
      ctx.fillRect(ox - s / 2, oy - s / 2, s, s);
      break;
    }
    case "bubbles": {
      // A thin ring with a faint tint and a highlight; it wobbles a little as it rises.
      const r = s * (1 + 0.06 * Math.sin(9 * part.life));
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.fillStyle = part.color;
      ctx.globalAlpha = 0.15 * life;
      ctx.fill();
      ctx.strokeStyle = part.color;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.9 * life;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-0.35 * r, -0.35 * r, 0.22 * r, 0, TWO_PI);
      ctx.fill();
      break;
    }
  }
}
