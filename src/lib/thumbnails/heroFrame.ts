/*
 * --- mode-thumbnails --- The frame every mode card's picture shares (public/modes/<mode>.webp).
 *
 * One shape for all of them: a square, like the cards (PosterCard's aspect-square, the daily card's tile and the hero's
 * still all show the picture 1:1). The subject a mode's hero camera frames (`heroSubjectRect()`) is drawn with the same
 * inset of its surroundings on every side (`heroSourceRect()`), then the same vignette and a subtle glow along the edges in
 * the mode's colour go over it (`drawHeroThumbnail()`). The picture is rendered at 2× the card's ~240 CSS px for retina
 * screens and encoded as WebP under THUMB_MAX_BYTES, stepping the quality down until it fits (`encodeUnderBudget()`).
 *
 * Pure geometry plus canvas helpers that take the context or canvas they draw on (nothing global), shared by the page's
 * still capture (components/simulator/useHeroStill.ts), the generator (scripts/generate-mode-previews.mjs, through the
 * page), the viral bot's covers and the tests.
 */

/** The cards' picture size in CSS px (the modes wall's cards are about 214–272 px wide on a desktop). */
export const THUMB_CSS_SIZE = 240;
/** The picture's side in px: 2× the card for retina screens. */
export const THUMB_SIZE = 2 * THUMB_CSS_SIZE;
/** Every card picture is a WebP under this many bytes (60 KB). */
export const THUMB_MAX_BYTES = 60_000;
export const THUMB_TYPE = "image/webp";
/** The margin of surroundings kept around the subject on every side, as a fraction of the picture's side. */
export const THUMB_INSET = 0.04;
/** The WebP qualities tried, best first: the first encoding under the byte budget is kept. */
export const THUMB_QUALITIES: readonly number[] = [0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62, 0.58, 0.54, 0.5, 0.45, 0.4, 0.35, 0.3];
/** How dark the vignette makes the corners (0–1). */
export const THUMB_VIGNETTE = 0.62;
/** How strong the mode-coloured edge glow is (its alpha at the edge, 0–1): a hint of the mode's colour, not a border. */
export const THUMB_EDGE_GLOW = 0.36;
/**
 * The world every hero moment is tuned for: the 16:9 stage of a desktop window (lib/simulation/world.ts – a 1400 × 900
 * viewport's stage). Seeds and seconds play out differently in another world, so the generator refuses any other.
 */
export const HERO_WORLD = { width: 800, height: 450 } as const;

/** Where a hero picture looks: the subject square of the world. */
export interface HeroCamera {
  /** The subject's centre as a fraction of the world's width (0.5, the middle, by default). */
  x?: number;
  /** The subject's centre as a fraction of the world's height (0.5 by default). */
  y?: number;
  /** 1 (default): the subject is the centred square of the world – what a clip records; 2: half its side, closer. */
  zoom?: number;
}

/** A square of the world, in world px. */
export interface WorldRect {
  x: number;
  y: number;
  side: number;
}

const finiteOr = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The square (world px) a camera frames: the world's shorter side ÷ zoom, centred where the camera says. */
export function heroSubjectRect(world: { width: number; height: number }, camera: HeroCamera = {}): WorldRect {
  const shorter = Math.max(1, Math.min(world.width, world.height));
  const zoom = Math.max(1, finiteOr(camera.zoom, 1));
  const side = shorter / zoom;
  const cx = finiteOr(camera.x, 0.5) * world.width;
  const cy = finiteOr(camera.y, 0.5) * world.height;
  return { x: cx - side / 2, y: cy - side / 2, side };
}

/**
 * The square (world px) drawn into the picture: the subject grown by the inset on every side and centred on it, so every
 * picture keeps the same margin around its subject and a camera frames exactly where it points. Where the square reaches
 * past the world (the centred square of a 16:9 world is the world's whole height; a camera that lifts a mode's HUD out of
 * the picture) the stage's backdrop shows – `drawHeroThumbnail()` fills it with the stage's own darkest colour.
 */
export function heroSourceRect(world: { width: number; height: number }, camera: HeroCamera = {}, inset = THUMB_INSET): WorldRect {
  const subject = heroSubjectRect(world, camera);
  const side = subject.side / Math.max(0.2, 1 - 2 * Math.max(0, inset));
  const margin = (side - subject.side) / 2;
  return { x: subject.x - margin, y: subject.y - margin, side };
}

/**
 * The scale (device px per world px) to draw the world at so the source square is at least twice the picture's side
 * (supersampled, then filtered down: crisp at any zoom), within 2–6.
 */
export function heroRenderScale(sourceSide: number, size = THUMB_SIZE): number {
  const wanted = (2 * size) / Math.max(1, sourceSide);
  return Math.min(6, Math.max(2, Math.ceil(wanted * 4) / 4));
}

/** "#rrggbb" or "#rgb" as "rgba(r, g, b, alpha)" (an unreadable colour is the site's lime). */
export function tintRgba(hex: string, alpha: number): string {
  let h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim())?.[1] ?? "93d119";
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** The look of the frame over a picture. */
export interface HeroFrameStyle {
  /** The mode's colour ("#rrggbb"): the edge glow. */
  tint: string;
  /** The stage's backdrop ("#rrggbb" or any CSS colour), shown where the inset reaches past the world (black by default). */
  backdrop?: string;
  /** Overrides of the shared vignette and glow strengths (the cards keep the defaults). */
  vignette?: number;
  glow?: number;
}

/**
 * Draws a card picture into `ctx` (`size` × `size`): `rect` (world px) of `source` – a canvas of the world drawn at
 * `sourceScale` device px per world px –, filtered down, then the vignette and the mode-coloured edge glow.
 */
export function drawHeroThumbnail(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceScale: number, rect: WorldRect, size: number, style: HeroFrameStyle): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = style.backdrop ?? "#000000";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.x * sourceScale, rect.y * sourceScale, rect.side * sourceScale, rect.side * sourceScale, 0, 0, size, size);
  // The vignette: clear in the middle, the corners darker, so the eye lands on the subject.
  const vignette = Math.max(0, Math.min(1, style.vignette ?? THUMB_VIGNETTE));
  if (vignette > 0) {
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.74);
    g.addColorStop(0, "rgba(0, 0, 0, 0)");
    g.addColorStop(0.55, `rgba(0, 0, 0, ${(0.35 * vignette).toFixed(3)})`);
    g.addColorStop(1, `rgba(0, 0, 0, ${vignette.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // The edge glow: a frame just outside the picture whose blurred shadow – in the mode's colour – lights the edges.
  const glow = Math.max(0, Math.min(1, style.glow ?? THUMB_EDGE_GLOW));
  if (glow > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = tintRgba(style.tint, glow);
    ctx.shadowBlur = size * 0.07;
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(-size * 0.03, -size * 0.03, size * 1.06, size * 1.06);
    ctx.shadowColor = tintRgba(style.tint, glow * 0.45);
    ctx.shadowBlur = size * 0.012;
    ctx.strokeRect(-size * 0.03, -size * 0.03, size * 1.06, size * 1.06);
  }
  ctx.restore();
}

/**
 * The stage's backdrop in an RGBA pixel buffer of its four corners (`corners`: 4 × [r, g, b, a]): the darkest one – a corner
 * can carry a HUD badge, the backdrop is what is left – as "rgb(r, g, b)".
 */
export function backdropOf(corners: readonly (readonly number[])[]): string {
  let best: readonly number[] | null = null;
  for (const c of corners) {
    if (c.length < 3) continue;
    if (!best || c[0] + c[1] + c[2] < best[0] + best[1] + best[2]) best = c;
  }
  return best ? `rgb(${Math.round(best[0])}, ${Math.round(best[1])}, ${Math.round(best[2])})` : "#000000";
}

/** The bytes a base64 data URL decodes to. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** An encoded picture: the data URL, its size and the quality it took (null: lossless). */
export interface EncodedThumb {
  dataUrl: string;
  bytes: number;
  quality: number | null;
}

/**
 * Encodes `canvas` as `type`, stepping down `qualities` until it is under `maxBytes`; null when even the last one is not (or
 * the browser cannot write the type – it would hand back a PNG).
 */
export function encodeUnderBudget(canvas: { toDataURL(type?: string, quality?: number): string }, maxBytes = THUMB_MAX_BYTES, qualities: readonly number[] = THUMB_QUALITIES, type = THUMB_TYPE): EncodedThumb | null {
  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL(type, quality);
    if (!dataUrl.startsWith(`data:${type}`)) return null;
    const bytes = dataUrlBytes(dataUrl);
    if (bytes < maxBytes) return { dataUrl, bytes, quality };
  }
  return null;
}
