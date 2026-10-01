/**
 * --- unlimited --- Drawing a No limits run cheaply: levels of detail, the crowd and the two badges.
 *
 *  - **Plain balls**: from `LOD_PLAIN_FROM` balls (full-physics + crowd), or a ball too big for the sprite caches, the
 *    full-physics balls are drawn as plain discs, one path per colour – no glow, no trails, no faces.
 *  - **The crowd** (lib/physics/crowd.ts): up to `LOD_POINTS_FROM` balls as discs (tiny ones as squares), one path per
 *    palette colour; beyond that as points written straight into one image the size of the arena (a million balls cost a
 *    few milliseconds), drawn under the canvas' transform like everything else.
 *  - **The HUD**, in the bottom-right corner of the square the recorder crops to (so exports have it): the ball count,
 *    "x0.4 real time" while the frame budget makes the run play slower than asked, and ARENA FULL once spawning stopped.
 *  - `data-unlimited-*` attributes mirror the state for tools and the smoke test.
 */
import { LOD_PLAIN_FROM, LOD_POINTS_FROM, type UnlimitedView } from "@/lib/physics/limits";
import type { Crowd } from "@/lib/physics/crowd";
import type { Ball } from "@/lib/physics/types";
import { formatRealTime } from "@/lib/simulation/frameBudget";
import { formatHuge } from "@/lib/unlimited";

export interface UnlimitedLabels {
  /** "x{ratio} real time" – the run plays slower than asked. */
  realTime: (ratio: string) => string;
  /** Spawning stopped: the crowd is at its limit. */
  arenaFull: string;
  /** The ball count badge: "{count} balls". */
  balls: (count: string) => string;
  /** The banner when a ball ate the arena (the run is over). */
  ateArena: string;
}

export const DEFAULT_UNLIMITED_LABELS: UnlimitedLabels = {
  realTime: (ratio) => `x${ratio} REAL TIME`,
  arenaFull: "ARENA FULL",
  balls: (count) => `${count} BALLS`,
  ateArena: "THE BALL ATE THE ARENA",
};

/** A ball bigger than this (px) skips the sprite caches (they would allocate a canvas 4 × its radius wide). */
export const SPRITE_MAX_RADIUS = 256;
/**
 * The most wall-break flashes and shockwaves drawn per frame with No limits on (the newest ones): a ball that bursts a
 * thousand rings in one step leaves a thousand glowing circles in the engine's (visual-only) lists. A render cap, not a
 * simulation cap – the engine's state is untouched.
 */
export const EFFECT_RENDER_CAP = 48;

/** The size in the ate-the-arena banner when the Ball Size itself (not a size multiplier) outgrew the arena: "100K px". */
export function ateSizeLabel(radius: number): string {
  return `${formatHuge(Math.round(radius))} px`;
}

/** The effects of a list the canvas draws this frame: all of them, or the newest `EFFECT_RENDER_CAP` with No limits on. */
export function cappedEffects<T>(effects: readonly T[], view: Pick<UnlimitedView, "on">): readonly T[] {
  return view.on && effects.length > EFFECT_RENDER_CAP ? effects.slice(effects.length - EFFECT_RENDER_CAP) : effects;
}

/** What the frame budget tells the HUD. */
export interface RealTimeState {
  slow: boolean;
  ratio: number;
}

const TWO_PI = Math.PI * 2;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, h / 2, w / 2);
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

/** "#rrggbb" (or "#rgb") → the 32-bit pixel of an RGBA image on a little-endian machine (0xAABBGGRR). */
export function colorToPixel(color: string): number {
  let hex = color.startsWith("#") ? color.slice(1) : "ffffff";
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = Number.parseInt(hex.slice(0, 6), 16);
  if (!Number.isFinite(n)) return 0xffffffff;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export class UnlimitedLayer {
  private points: HTMLCanvasElement | null = null;
  private pointsCtx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private pixels: Uint32Array | null = null;
  private pixelColors: number[] = [];
  private pixelKey = "";
  /** True when the full-physics balls should be drawn plain this frame (many balls, or one too big for the sprites). */
  wantsPlain(balls: readonly Ball[], view: UnlimitedView): boolean {
    if (!view.on) return false;
    if (balls.length + view.crowd >= LOD_PLAIN_FROM) return true;
    for (let i = 0; i < balls.length; i++) if (!(balls[i].radius <= SPRITE_MAX_RADIUS)) return true;
    return false;
  }

  /** The full-physics balls as plain discs, one path per colour. */
  drawPlainBalls(ctx: CanvasRenderingContext2D, balls: readonly Ball[], colorOf: (ball: Ball, index: number) => string) {
    const paths = new Map<string, Path2D>();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && b.radius > 0 && Number.isFinite(b.radius))) continue;
      const color = colorOf(b, i);
      let path = paths.get(color);
      if (!path) {
        path = new Path2D();
        paths.set(color, path);
      }
      path.moveTo(b.x + b.radius, b.y);
      path.arc(b.x, b.y, b.radius, 0, TWO_PI);
    }
    ctx.save();
    ctx.globalAlpha = 1;
    for (const [color, path] of paths) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.restore();
  }

  /** The crowd: discs or squares batched per palette colour, or – past `LOD_POINTS_FROM` balls – points in one image. */
  drawCrowd(ctx: CanvasRenderingContext2D, crowd: Readonly<Crowd>, palette: readonly string[], width: number, height: number) {
    const n = crowd.count;
    if (n === 0) return;
    if (n > LOD_POINTS_FROM) {
      this.drawPoints(ctx, crowd, palette, width, height);
      return;
    }
    const colors = Math.max(1, palette.length);
    const paths: Path2D[] = [];
    for (let c = 0; c < colors; c++) paths.push(new Path2D());
    const xs = crowd.x;
    const ys = crowd.y;
    const rs = crowd.r;
    const cs = crowd.color;
    const discs = n <= 4000;
    for (let i = 0; i < n; i++) {
      const r = rs[i];
      const path = paths[cs[i] % colors];
      if (discs) {
        path.moveTo(xs[i] + r, ys[i]);
        path.arc(xs[i], ys[i], r, 0, TWO_PI);
      } else path.rect(xs[i] - r, ys[i] - r, 2 * r, 2 * r);
    }
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (let c = 0; c < colors; c++) {
      ctx.fillStyle = palette[c] ?? "#ffffff";
      ctx.fill(paths[c]);
    }
    ctx.restore();
  }

  private drawPoints(ctx: CanvasRenderingContext2D, crowd: Readonly<Crowd>, palette: readonly string[], width: number, height: number) {
    const w = Math.max(1, Math.min(4096, Math.round(width)));
    const h = Math.max(1, Math.min(4096, Math.round(height)));
    if (typeof document === "undefined") return;
    if (!this.points || this.points.width !== w || this.points.height !== h) {
      this.points = document.createElement("canvas");
      this.points.width = w;
      this.points.height = h;
      this.pointsCtx = this.points.getContext("2d");
      this.image = this.pointsCtx ? this.pointsCtx.createImageData(w, h) : null;
      this.pixels = this.image ? new Uint32Array(this.image.data.buffer) : null;
    }
    const pctx = this.pointsCtx;
    const image = this.image;
    const pixels = this.pixels;
    if (!pctx || !image || !pixels) return;
    const key = palette.join(",");
    if (key !== this.pixelKey) {
      this.pixelKey = key;
      this.pixelColors = palette.map(colorToPixel);
    }
    const colors = this.pixelColors;
    const k = Math.max(1, colors.length);
    pixels.fill(0);
    const n = crowd.count;
    const xs = crowd.x;
    const ys = crowd.y;
    const rs = crowd.r;
    const cs = crowd.color;
    for (let i = 0; i < n; i++) {
      const px = xs[i] | 0;
      const py = ys[i] | 0;
      if (px < 0 || py < 0 || px >= w - 1 || py >= h - 1) continue;
      const color = colors[cs[i] % k] ?? 0xffffffff;
      const at = py * w + px;
      pixels[at] = color;
      if (rs[i] >= 1.5) {
        pixels[at + 1] = color;
        pixels[at + w] = color;
        pixels[at + w + 1] = color;
      }
    }
    pctx.putImageData(image, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.points, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * The badges, bottom right of the square (`x0`, `y0`, `side`) the recorder crops to: the ball count while there is a
   * crowd, "x0.4 real time" while the run plays slower than asked, and ARENA FULL (pulsing on `nowMs`). `bottomInset`
   * lifts them above the page's playback-speed buttons, which sit over a nearly square canvas live (never in exports).
   */
  drawHud(ctx: CanvasRenderingContext2D, view: UnlimitedView, time: RealTimeState, labels: UnlimitedLabels, x0: number, y0: number, side: number, nowMs: number, bottomInset = 0) {
    if (!view.on) return;
    const badges: { text: string; color: string; pulse: boolean }[] = [];
    if (view.full) badges.push({ text: labels.arenaFull, color: "#f43f5e", pulse: true });
    if (time.slow) badges.push({ text: labels.realTime(formatRealTime(time.ratio)), color: "#fbbf24", pulse: false });
    if (view.crowd > 0) badges.push({ text: labels.balls(formatHuge(view.crowd + view.objects)), color: "#93d119", pulse: false });
    if (badges.length === 0) return;
    ctx.save();
    const fs = Math.max(11, 0.032 * side);
    const pad = 0.025 * side;
    const h = 1.6 * fs;
    const gap = 0.4 * fs;
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let y = y0 + side - pad - h - bottomInset;
    for (const badge of badges) {
      const w = ctx.measureText(badge.text).width + 1.2 * fs;
      const x = x0 + side - pad - w;
      ctx.globalAlpha = badge.pulse ? 0.75 + 0.25 * Math.sin(nowMs * 0.012) : 0.9;
      ctx.fillStyle = "rgba(8, 8, 10, 0.72)";
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.fill();
      ctx.strokeStyle = badge.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = badge.color;
      ctx.fillText(badge.text, x + 0.6 * fs, y + h / 2);
      y -= h + gap;
    }
    ctx.restore();
  }
}

/** The level of detail of a frame: "points" (the crowd as an image), "plain" (batched discs) or "full". */
export function lodOf(view: UnlimitedView): "full" | "plain" | "points" {
  if (!view.on) return "full";
  if (view.crowd > LOD_POINTS_FROM) return "points";
  return view.crowd + view.objects >= LOD_PLAIN_FROM ? "plain" : "full";
}

/** Mirrors the No limits state into `data-unlimited-*` attributes (removed with the switch off). */
export function writeUnlimitedDataset(view: UnlimitedView, time: RealTimeState, lod: string, set: (key: string, value: string) => void, dataset: DOMStringMap) {
  if (!view.on) {
    for (const key of UNLIMITED_DATA_KEYS) if (dataset[key] !== undefined) delete dataset[key];
    return;
  }
  set("unlimited", "1");
  set("unlimitedRealtime", time.ratio.toFixed(3));
  set("unlimitedSlow", time.slow ? "1" : "0");
  set("unlimitedFull", view.full ? "1" : "0");
  set("unlimitedCrowd", String(view.crowd));
  set("unlimitedBalls", String(view.crowd + view.objects));
  set("unlimitedBounces", String(view.bounces));
  set("unlimitedAte", view.ate ? "1" : "0");
  set("unlimitedLod", lod);
}

export const UNLIMITED_DATA_KEYS = ["unlimited", "unlimitedRealtime", "unlimitedSlow", "unlimitedFull", "unlimitedCrowd", "unlimitedBalls", "unlimitedBounces", "unlimitedAte", "unlimitedLod"];
