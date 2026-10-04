import { ACCENT, ACCENT_LIGHT, SITE_DOMAIN, SITE_NAME } from "@/lib/site";
import { BADGE_OPACITY, TILE_OPACITY, badgeCorner, badgeMetrics, badgeRect, badgeWidth, exportSquare, tileFontSize, tileLayout, type BadgeMetrics, type FrameRect, type TileLayout } from "./layout";

/*
 * --- free-watermark --- Draws the watermark (layout.ts places it) into an export frame. Called by the gate (seal.ts) for a
 * video that has no verified Pro licence – never directly by a compositor, which goes through `stampFrame()`.
 *
 * Cheap on purpose (the recording keeps its frame-rate floors): the badge is drawn once into a small sprite and the diagonal
 * domain tiles once – from one tile pattern – into a layer of the frame's size; both carry their opacity in their pixels, so
 * a frame costs two `drawImage()` calls. The caches hold the last size only (one export at a time). Both are built on
 * canvases of their own that never enter the document.
 *
 * Fail-closed: when a layer comes out blank – a browser that cannot draw text, a canvas API patched before the page loaded
 * to skip it – `WatermarkUnavailableError` is thrown and the recording or export stops instead of producing a clean video.
 */

/** What a compositor tells the painter about the frame it is composing. */
export interface WatermarkFrame {
  /** The export frame (px). */
  width: number;
  height: number;
  /** Time into the clip (ms): which corner the badge is in. */
  clipMs: number;
  /** The exported square inside the frame (default: the centred square of the shorter side). */
  square?: FrameRect;
}

/** The watermark could not be drawn: the export must not go on without it. */
export class WatermarkUnavailableError extends Error {
  constructor(what: string) {
    super(`The watermark could not be drawn (${what}): a video without a Pro licence is never exported without it`);
    this.name = "WatermarkUnavailableError";
  }
}

type Canvas2D = CanvasRenderingContext2D;

function newCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Canvas2D } {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) throw new WatermarkUnavailableError("no document");
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new WatermarkUnavailableError("no 2D context");
  return { canvas, ctx };
}

/** True when some pixel of the region is not fully transparent (the layer really holds the mark). */
function holdsInk(ctx: Canvas2D, x: number, y: number, width: number, height: number): boolean {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = ctx.getImageData(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), w, h)?.data;
  if (!data) return false;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
}

/** The pill's outline: a rounded rectangle with fully rounded ends. */
function pillPath(ctx: Canvas2D, x: number, y: number, width: number, height: number) {
  const r = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + height);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

/** The site's logo mark (public/icon.svg): an open ring – the gap a ball escapes through – around a lime-to-blue ball. */
function drawLogo(ctx: Canvas2D, cx: number, cy: number, size: number) {
  const r = size / 2;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.085 * size);
  ctx.strokeStyle = "rgba(242, 242, 237, 0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, -0.15 * Math.PI, 1.43 * Math.PI); // the ring, open at the top right
  ctx.stroke();
  const ball = r * 0.6;
  const g = ctx.createLinearGradient(cx - ball, cy - ball, cx + ball, cy + ball);
  g.addColorStop(0, ACCENT_LIGHT);
  g.addColorStop(1, "#3b82f6");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, ball, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  ctx.arc(cx - 0.33 * ball, cy - 0.33 * ball, 0.24 * ball, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

const nameFont = (m: BadgeMetrics) => `700 ${m.nameSize}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const domainFont = (m: BadgeMetrics) => `600 ${m.domainSize}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const tileFont = (size: number) => `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
/** The text's width in the context's current font (an estimate from the font size where the canvas cannot measure). */
const measured = (ctx: Canvas2D, text: string, fontSize: number) => {
  const w = ctx.measureText(text)?.width;
  return Number.isFinite(w) && (w as number) > 0 ? (w as number) : 0.58 * text.length * fontSize;
};

/** The badge, drawn once per size: the pill with its soft shadow, its accent rim, the logo mark, the name and the domain. */
export interface BadgeSprite {
  canvas: HTMLCanvasElement;
  metrics: BadgeMetrics;
  /** The pill's size (the sprite adds `metrics.shadowPad` px on every side for the shadow). */
  width: number;
  height: number;
}

export function buildBadgeSprite(squareSide: number, name = SITE_NAME, domain = SITE_DOMAIN): BadgeSprite {
  const m = badgeMetrics(squareSide);
  const probe = newCanvas(1, 1).ctx;
  probe.font = nameFont(m);
  const nameWidth = measured(probe, name, m.nameSize);
  probe.font = domainFont(m);
  const domainWidth = measured(probe, domain, m.domainSize);
  const width = badgeWidth(m, nameWidth, domainWidth);
  const height = m.height;
  const pad = m.shadowPad;
  // The badge at full strength first, then into the sprite at 70 % as one layer (the text does not show the pill through it).
  const full = newCanvas(width + 2 * pad, height + 2 * pad);
  const c = full.ctx;
  c.save();
  c.shadowColor = "rgba(0, 0, 0, 0.6)";
  c.shadowBlur = m.shadowBlur;
  c.shadowOffsetY = m.shadowY;
  c.fillStyle = "rgba(12, 12, 14, 0.9)";
  pillPath(c, pad, pad, width, height);
  c.fill();
  c.restore();
  const rim = Math.max(1, 0.035 * height);
  c.lineWidth = rim;
  c.strokeStyle = ACCENT;
  pillPath(c, pad + rim / 2, pad + rim / 2, width - rim, height - rim);
  c.stroke();
  drawLogo(c, pad + m.padX + m.logo / 2, pad + height / 2, m.logo);
  const textX = pad + m.padX + m.logo + m.gap;
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.font = nameFont(m);
  c.fillStyle = "#f2f2ed";
  c.fillText(name, textX, pad + 0.37 * height);
  c.font = domainFont(m);
  c.fillStyle = ACCENT_LIGHT;
  c.fillText(domain, textX, pad + 0.71 * height);
  const sprite = newCanvas(width + 2 * pad, height + 2 * pad);
  sprite.ctx.globalAlpha = BADGE_OPACITY;
  sprite.ctx.drawImage(full.canvas, 0, 0);
  if (!holdsInk(sprite.ctx, pad, pad + height / 2, width, 1)) throw new WatermarkUnavailableError("blank badge");
  return { canvas: sprite.canvas, metrics: m, width, height };
}

/** The diagonal domain tiles of a frame, drawn once per frame size into a layer of that size (4 % opacity in its pixels). */
export interface TileLayer {
  canvas: HTMLCanvasElement;
  layout: TileLayout;
  width: number;
  height: number;
}

export function buildTileLayer(width: number, height: number, domain = SITE_DOMAIN): TileLayer {
  const fontSize = tileFontSize(width, height);
  const probe = newCanvas(1, 1).ctx;
  probe.font = tileFont(fontSize);
  const layout = tileLayout(width, height, measured(probe, domain, fontSize), fontSize);
  // One tile: the domain twice, the second half a step along the next row (drawn twice so it wraps across the tile's edge).
  const tile = newCanvas(layout.tileWidth, layout.tileHeight);
  const t = tile.ctx;
  t.font = tileFont(fontSize);
  t.textAlign = "left";
  t.textBaseline = "middle";
  t.lineJoin = "round";
  t.lineWidth = Math.max(1, 0.14 * fontSize);
  t.strokeStyle = "#000000";
  t.fillStyle = "#ffffff";
  const write = (x: number, y: number) => {
    // a dark rim under a light fill: the tiles show on dark and on light backgrounds alike
    t.strokeText(domain, x, y);
    t.fillText(domain, x, y);
  };
  write(0, 0.5 * layout.stepY);
  write(layout.stepX / 2, 1.5 * layout.stepY);
  write(layout.stepX / 2 - layout.tileWidth, 1.5 * layout.stepY);
  const pattern = tile.ctx.createPattern(tile.canvas, "repeat");
  if (!pattern) throw new WatermarkUnavailableError("no tile pattern");
  const layer = newCanvas(width, height);
  const l = layer.ctx;
  l.globalAlpha = TILE_OPACITY;
  l.translate(width / 2, height / 2);
  l.rotate(layout.angle);
  l.fillStyle = pattern;
  l.fillRect(-layout.cover, -layout.cover, 2 * layout.cover, 2 * layout.cover);
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalAlpha = 1;
  const probeSide = Math.min(width, height, 4 * layout.stepY);
  if (!holdsInk(l, (width - probeSide) / 2, (height - probeSide) / 2, probeSide, probeSide)) throw new WatermarkUnavailableError("blank tiles");
  return { canvas: layer.canvas, layout, width, height };
}

/** The cached sprite (per exported square side) and tile layer (per frame size): one export runs at a time. */
let badgeCache: { side: number; sprite: BadgeSprite } | null = null;
let tileCache: { width: number; height: number; layer: TileLayer } | null = null;
/** Where the badge goes in the cached frame, for both corners (recomputed only when the frame or its square changes). */
let placement: { width: number; height: number; x: number; y: number; side: number; sprite: BadgeSprite; left: FrameRect; right: FrameRect } | null = null;

function badgeFor(squareSide: number): BadgeSprite {
  const side = Math.round(squareSide);
  if (badgeCache?.side !== side) badgeCache = { side, sprite: buildBadgeSprite(side) };
  return badgeCache.sprite;
}

function tilesFor(width: number, height: number): TileLayer {
  const w = Math.round(width);
  const h = Math.round(height);
  if (tileCache?.width !== w || tileCache.height !== h) tileCache = { width: w, height: h, layer: buildTileLayer(w, h) };
  return tileCache.layer;
}

function placementFor(width: number, height: number, square: FrameRect, sprite: BadgeSprite) {
  const p = placement;
  if (p && p.width === width && p.height === height && p.x === square.x && p.y === square.y && p.side === square.width && p.sprite === sprite) return p;
  const badge = { width: sprite.width, height: sprite.height, inset: sprite.metrics.inset };
  placement = { width, height, x: square.x, y: square.y, side: square.width, sprite, left: badgeRect(width, height, badge, "bottom-left", square), right: badgeRect(width, height, badge, "bottom-right", square) };
  return placement;
}

/** Builds the sprite and the layer of a frame size ahead of the first frame (a compositor calls it when it starts). */
export function prepareWatermark(frame: Pick<WatermarkFrame, "width" | "height" | "square">): void {
  const square = frame.square ?? exportSquare(frame.width, frame.height);
  tilesFor(frame.width, frame.height);
  badgeFor(square.width);
}

/**
 * Draws the watermark into `ctx`: the tiles over the whole frame, then the badge in its corner of the moment – on top of
 * everything the compositor drew, whatever transform or opacity it left behind.
 */
export function paintWatermark(ctx: Canvas2D, frame: WatermarkFrame): void {
  const square = frame.square ?? exportSquare(frame.width, frame.height);
  const tiles = tilesFor(frame.width, frame.height);
  const badge = badgeFor(square.width);
  const spot = placementFor(frame.width, frame.height, square, badge);
  const rect = badgeCorner(frame.clipMs) === "bottom-left" ? spot.left : spot.right;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.drawImage(tiles.canvas, 0, 0);
  ctx.drawImage(badge.canvas, rect.x - badge.metrics.shadowPad, rect.y - badge.metrics.shadowPad);
  ctx.restore();
}
