/**
 * Glows without per-draw blurs (feature merge-ring, the lag fix). Every `shadowBlur` draw makes the canvas blur a mask the
 * size of the shape's bounding box – on a software canvas a full-circle stroke blurs its whole box, on a GPU canvas every
 * shadowed draw is its own blur pass – so Merge Ring's big glows are drawn another way with the same pixels:
 * `fillStrokeGlow()` fills the shadow a stroked circle (or arc) casts as an annulus of a radial gradient whose stops follow
 * the blurred line's profile (`strokeShadowAlpha()`: the line's width convolved with the Gaussian the canvas blurs with,
 * σ = shadowBlur / 2 device px), under the stroke the caller then draws without a shadow. Shadows ignore the transform
 * (their blur is in device px), so the callers read the context's scale (`plainTransform()`); the bitmaps the renderer
 * caches are made through a `CanvasFactory`.
 */

/** Makes an offscreen canvas (null where there is none, e.g. the unit tests' Node: the callers then draw live). */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** A transform that scales evenly (`k` device px per unit) and translates (`e`, `f` device px). */
export interface PlainTransform {
  k: number;
  e: number;
  f: number;
}

/** The context's transform when it only scales evenly and translates; null when it rotates, skews or stretches (or is unknown). */
export function plainTransform(ctx: CanvasRenderingContext2D): PlainTransform | null {
  if (typeof ctx.getTransform !== "function") return null;
  return plainOf(ctx.getTransform());
}

/** A 2D transform as `getTransform()` reads it. */
export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** `plainTransform()` of a transform already read (`getTransform()`). */
export function plainOf(m: Matrix2D | null | undefined): PlainTransform | null {
  if (!m || !(m.a > 0) || Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || Math.abs(m.a - m.d) > 1e-9 * m.a) return null;
  if (!Number.isFinite(m.e) || !Number.isFinite(m.f)) return null;
  return { k: m.a, e: m.e, f: m.f };
}

/** The standard normal CDF (Abramowitz & Stegun 7.1.26 for erf, |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** The alpha of the shadow a line `lw` wide casts with a Gaussian blur of `sigma`, at `d` from its centre line (across it). */
export function strokeShadowAlpha(d: number, lw: number, sigma: number): number {
  if (!(sigma > 0)) return Math.abs(d) <= lw / 2 ? 1 : 0;
  return normalCdf((d + lw / 2) / sigma) - normalCdf((d - lw / 2) / sigma);
}

/** Stops of the glow's radial gradient (the profile is smooth: linear between 25 stops is within a level of the blur). */
export const GLOW_STOPS = 25;
/** How far the glow reaches past the line's edge, in σ (the blur's own reach; the alpha there is under half a level). */
export const GLOW_REACH = 3.2;

/** The profile of a line's blurred shadow: the reach on each side of its centre line (`ext`) and the alphas of `GLOW_STOPS` stops across [−ext, ext]. */
export function glowProfile(lw: number, sigma: number): { ext: number; alphas: number[] } {
  const ext = lw / 2 + GLOW_REACH * sigma;
  const alphas: number[] = [];
  for (let i = 0; i < GLOW_STOPS; i++) {
    const d = -ext + (2 * ext * i) / (GLOW_STOPS - 1);
    alphas.push(strokeShadowAlpha(d, lw, sigma));
  }
  return { ext, alphas };
}

const rgbCache = new Map<string, string | null>();

/** "#rrggbb" (or "#rgb") → "r, g, b"; null for anything else (cached: the callers pass a few palette colours). */
export function rgbOfHex(hex: string): string | null {
  let rgb = rgbCache.get(hex);
  if (rgb !== undefined) return rgb;
  const h = hex.startsWith("#") ? hex.slice(1) : "";
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) rgb = null;
  else {
    const n = parseInt(full, 16);
    rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  if (rgbCache.size > 256) rgbCache.clear();
  rgbCache.set(hex, rgb);
  return rgb;
}

const STOP_CACHE_MAX = 96;
const stopCache = new Map<string, { ext: number; colors: string[] }>();

/** The gradient's stop colours for a glow of `rgb` ("r, g, b") around a line `lwDev` wide blurred by σ `sigmaDev` (device px), cached. */
function glowStops(rgb: string, lwDev: number, sigmaDev: number): { ext: number; colors: string[] } {
  const key = `${rgb}|${lwDev}|${sigmaDev}`;
  let entry = stopCache.get(key);
  if (!entry) {
    const { ext, alphas } = glowProfile(lwDev, sigmaDev);
    entry = { ext, colors: alphas.map((a) => `rgba(${rgb}, ${a.toFixed(4)})`) };
    if (stopCache.size >= STOP_CACHE_MAX) stopCache.clear();
    stopCache.set(key, entry);
  }
  return entry;
}

/**
 * Fills the shadow that stroking the circle (`r` around `x`, `y`; or its arc from `a0` to `a1`) `lw` wide with `shadowBlur`
 * `blur` would cast in colour `rgb` ("r, g, b") – under the current `globalAlpha`, like the shadow – without blurring:
 * an annulus of a radial gradient (it turns the context's shadow off). `k` is the context's scale (device px per unit). False
 * (nothing drawn) when the circle is smaller than `minRadius` device px, or too small for the profile across its line to
 * stand for the blur: the caller then draws the shadow itself (a small circle's blur is cheap: its box is small).
 */
export function fillStrokeGlow(ctx: CanvasRenderingContext2D, k: number, x: number, y: number, r: number, lw: number, blur: number, rgb: string, a0 = 0, a1 = Math.PI * 2, minRadius = 0): boolean {
  const sigmaDev = blur / 2;
  if (!(sigmaDev > 0) || !(k > 0) || !(r * k >= minRadius)) return false;
  const lwDev = lw * k;
  const { ext: extDev, colors } = glowStops(rgb, lwDev, sigmaDev);
  // the line's curvature is negligible across its blur only on a circle several σ across
  if (r * k < extDev + 2 * sigmaDev) return false;
  const ext = extDev / k;
  const r0 = r - ext;
  const r1 = r + ext;
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (let i = 0; i < colors.length; i++) g.addColorStop(i / (colors.length - 1), colors[i]);
  ctx.shadowBlur = 0; // (the glow itself casts none)
  ctx.fillStyle = g;
  ctx.beginPath();
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    ctx.arc(x, y, r1, 0, Math.PI * 2);
    ctx.moveTo(x + r0, y);
    ctx.arc(x, y, r0, Math.PI * 2, 0, true);
  } else {
    ctx.arc(x, y, r1, a0, a1);
    ctx.arc(x, y, r0, a1, a0, true);
    ctx.closePath();
  }
  ctx.fill();
  return true;
}
