/*
 * --- free-watermark --- Where the watermark of a video made without a Pro licence goes. Pure (no DOM): the painter
 * (paint.ts) draws what these functions place, tests/freeWatermark.test.ts checks them.
 *
 * Two layers, both drawn INTO THE FRAME'S PIXELS by the compositor of every output path (`drawRecordingFrame()` in
 * lib/recording/recorder.ts – the page recorder and the fast export, and through the fast export the batch render, the viral
 * bot and the desktop app's render queue):
 *
 *  - the BADGE – the site's logo mark, its name and its domain on a dark pill, at 70 % opacity with a soft shadow. It sits in
 *    a bottom corner of the exported square (the centred square every export frame shows the arena in), inside the safe zone
 *    the platforms leave free of their own buttons and captions, and it changes corner every 6 s of the clip – bottom-left
 *    for the first 6 s, bottom-right for the next 6 and so on – so cropping one corner away leaves the other;
 *  - the TILES – the domain written diagonally across the whole frame at 4 % opacity: a faint repeating pattern that
 *    survives any crop and hardly shows over the clip.
 *
 * Everything scales with the exported square's side, so a 500×500, a 1280×720, a 1920×1080 and a 1080×1920 export (and the
 * desktop app's 4K upscale of one) carry the same mark at the same place.
 */

/** Opacity of the badge (its pill, logo and text). */
export const BADGE_OPACITY = 0.7;
/** Opacity of the diagonal domain tiles. */
export const TILE_OPACITY = 0.04;
/** The badge changes corner after this many ms of the clip. */
export const BADGE_SWITCH_MS = 6000;
/** The tiles' rows rise to the right at this angle (degrees). */
export const TILE_ANGLE_DEG = -30;

/** A rectangle in frame pixels. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The parts of a vertical (portrait) frame that TikTok, Instagram Reels and YouTube Shorts keep for their own interface, as
 * fractions of the frame: the tabs on top, the action buttons down the right edge, the caption, music line and navigation
 * at the bottom. On a 1080×1920 frame: 65 px left, 135 px right, 154 px top and 384 px bottom.
 */
export const PORTRAIT_SAFE_MARGINS = { left: 0.06, right: 0.125, top: 0.08, bottom: 0.2 } as const;
/** Any other frame (square, landscape): the classic action-safe margin on every side. */
export const ACTION_SAFE_MARGIN = 0.05;
/** The badge keeps this far (a share of the exported square's side) from the edges of its zone. */
export const BADGE_INSET = 0.025;
/** The badge's height as a share of the exported square's side (56 px on 1080), never below `BADGE_MIN_HEIGHT`. */
export const BADGE_HEIGHT = 0.052;
export const BADGE_MIN_HEIGHT = 18;

/** The frame's safe zone: inside the platform interface of a portrait frame, inside the action-safe margin otherwise. */
export function safeZone(width: number, height: number): FrameRect {
  if (height > width) {
    const m = PORTRAIT_SAFE_MARGINS;
    return { x: width * m.left, y: height * m.top, width: width * (1 - m.left - m.right), height: height * (1 - m.top - m.bottom) };
  }
  return { x: width * ACTION_SAFE_MARGIN, y: height * ACTION_SAFE_MARGIN, width: width * (1 - 2 * ACTION_SAFE_MARGIN), height: height * (1 - 2 * ACTION_SAFE_MARGIN) };
}

/** The exported square: the centred square of the frame's shorter side that every export fills with the arena. */
export function exportSquare(width: number, height: number): FrameRect {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side };
}

/** The overlap of two rectangles (empty – zero size – when they do not overlap). */
export function intersect(a: FrameRect, b: FrameRect): FrameRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** Where the badge may go: the exported square inside the frame's safe zone. */
export function badgeZone(width: number, height: number, square: FrameRect = exportSquare(width, height)): FrameRect {
  const zone = intersect(safeZone(width, height), square);
  // A square that lies outside the safe zone (never for the export sizes) still keeps the badge on the arena.
  return zone.width > 0 && zone.height > 0 ? zone : square;
}

export type BadgeCorner = "bottom-left" | "bottom-right";

/** The corner of the badge at `clipMs` of the clip: bottom-left for 0–6 s, bottom-right for 6–12 s, and so on. */
export function badgeCorner(clipMs: number): BadgeCorner {
  const t = Number.isFinite(clipMs) && clipMs > 0 ? clipMs : 0;
  return Math.floor(t / BADGE_SWITCH_MS) % 2 === 0 ? "bottom-left" : "bottom-right";
}

/** The badge's proportions for an exported square of `side` px (all in px). */
export interface BadgeMetrics {
  /** The pill's height. */
  height: number;
  /** Horizontal padding inside the pill. */
  padX: number;
  /** Diameter of the logo mark. */
  logo: number;
  /** Space between the logo and the text. */
  gap: number;
  /** Font sizes of the site name and of the domain. */
  nameSize: number;
  domainSize: number;
  /** Blur and drop of the soft shadow (the sprite keeps `shadowPad` px free around the pill for it). */
  shadowBlur: number;
  shadowY: number;
  shadowPad: number;
  /** Distance from the edges of the badge zone. */
  inset: number;
}

export function badgeMetrics(squareSide: number): BadgeMetrics {
  const side = Number.isFinite(squareSide) && squareSide > 0 ? squareSide : 0;
  const height = Math.max(BADGE_MIN_HEIGHT, Math.round(BADGE_HEIGHT * side));
  const shadowBlur = Math.max(2, Math.round(0.28 * height));
  const shadowY = Math.max(1, Math.round(0.07 * height));
  return {
    height,
    padX: Math.round(0.3 * height),
    logo: Math.round(0.68 * height),
    gap: Math.round(0.22 * height),
    nameSize: Math.max(7, Math.round(0.34 * height)),
    domainSize: Math.max(6, Math.round(0.25 * height)),
    shadowBlur,
    shadowY,
    shadowPad: shadowBlur + shadowY + 2,
    inset: Math.round(BADGE_INSET * side),
  };
}

/** The pill's width for the measured text widths (name and domain stacked, the wider one counts). */
export function badgeWidth(metrics: BadgeMetrics, nameWidth: number, domainWidth: number): number {
  return Math.ceil(metrics.padX + metrics.logo + metrics.gap + Math.max(nameWidth, domainWidth, 0) + metrics.padX);
}

/**
 * The badge's rectangle (the pill, without its shadow) in a `width` × `height` frame: in `corner` of the badge zone, `inset`
 * px from its bottom and side edges. A badge wider than its zone (a tiny frame) stays inside the frame, anchored to its side.
 */
export function badgeRect(width: number, height: number, badge: { width: number; height: number; inset: number }, corner: BadgeCorner, square: FrameRect = exportSquare(width, height)): FrameRect {
  const zone = badgeZone(width, height, square);
  const bottom = zone.y + zone.height - badge.inset;
  const y = Math.max(0, Math.min(height - badge.height, bottom - badge.height));
  const left = zone.x + badge.inset;
  const right = zone.x + zone.width - badge.inset - badge.width;
  const raw = corner === "bottom-left" ? left : right;
  const x = Math.max(0, Math.min(Math.max(0, width - badge.width), raw));
  return { x: Math.round(x), y: Math.round(y), width: badge.width, height: badge.height };
}

/**
 * The diagonal tiles of a `width` × `height` frame whose domain text is `textWidth` px wide at `fontSize`: one tile holds
 * the text twice – at the start of an even row and half a step along an odd one – so the rows are staggered like bricks;
 * the tile repeats over a square of `cover` px around the frame's centre, turned by `angle`, which covers every corner.
 */
export interface TileLayout {
  /** Rotation of the rows (radians; negative: rising to the right). */
  angle: number;
  fontSize: number;
  /** Distance between two repeats of the text along a row. */
  stepX: number;
  /** Distance between two rows. */
  stepY: number;
  /** The tile: `stepX` wide, two rows high. */
  tileWidth: number;
  tileHeight: number;
  /** Half the side of the turned square the pattern fills (centred on the frame). */
  cover: number;
}

/** The tiles' font size for a frame (32 px on a 1080 px square), never below 10 px. */
export function tileFontSize(width: number, height: number): number {
  return Math.max(10, Math.round(0.03 * Math.min(width, height)));
}

export function tileLayout(width: number, height: number, textWidth: number, fontSize = tileFontSize(width, height)): TileLayout {
  const stepX = Math.ceil(Math.max(textWidth, fontSize) + 2.4 * fontSize);
  const stepY = Math.ceil(3.4 * fontSize);
  return {
    angle: (TILE_ANGLE_DEG * Math.PI) / 180,
    fontSize,
    stepX,
    stepY,
    tileWidth: stepX,
    tileHeight: 2 * stepY,
    cover: Math.ceil(Math.hypot(width, height) / 2 + Math.max(stepX, 2 * stepY)),
  };
}

/** Where a point of the turned pattern (pattern coordinates, origin at the frame's centre) lands in the frame. */
export function tilePointInFrame(layout: Pick<TileLayout, "angle">, width: number, height: number, px: number, py: number): { x: number; y: number } {
  const c = Math.cos(layout.angle);
  const s = Math.sin(layout.angle);
  return { x: width / 2 + px * c - py * s, y: height / 2 + px * s + py * c };
}

/**
 * The anchors (text baselines' left ends, frame px) of every tile text that touches the frame – what the turned pattern
 * draws. The painter fills a pattern instead of placing these one by one; the tests use them to check the coverage.
 */
export function tileAnchors(width: number, height: number, layout: TileLayout): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const reach = layout.cover;
  const rows = Math.ceil(reach / layout.stepY);
  const cols = Math.ceil(reach / layout.stepX) + 1;
  for (let r = -rows; r <= rows; r++) {
    const offset = (((r % 2) + 2) % 2) * (layout.stepX / 2);
    for (let c = -cols; c <= cols; c++) {
      const p = tilePointInFrame(layout, width, height, c * layout.stepX + offset, r * layout.stepY + 0.5 * layout.stepY);
      if (p.x > -layout.stepX && p.x < width + layout.stepX && p.y > -layout.stepY && p.y < height + layout.stepY) out.push(p);
    }
  }
  return out;
}
