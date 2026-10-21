/*
 * --- clip-editor --- One frame of the cut (spec.ts), for the editor's preview and for the file render.ts encodes: the
 * source's cropped window filling the frame, the hook and the address in a dark pill at the top, the end card fading in
 * over the last moments. --- clip-fit --- Every line is fitted to the frame (spec.ts fitTextLines): a long hook wraps onto
 * two lines and shrinks, an address or a card line shrinks, so nothing runs off its edges. --- legal-audit --- A cut of a
 * Fight League clip carries the permanent fan-made badge again, at the output's size and over the card too: the crop-in
 * and the card would otherwise cut away or cover the one the simulator drew. --- badge-once --- Only then: while the
 * source's own badge is still whole inside the platforms' safe zone it stays the one badge, and the drawn one fades in as
 * the card covers it. --- badge-safe --- A crop-in that pushes it down into the bottom strip TikTok, Reels and Shorts cover
 * with their caption gets the badge at its fixed spot, and the burned one, still in the frame there, is covered by a dark
 * pill: one badge, where it is read. --- cut-reedit --- So is a cut file's own badge once a crop-in moves it (the editor only
 * trims a cut file, so this is a guard). A file not known to carry the badge (`fanMadeBurned` false: a clip made before the
 * simulator burned it, a picked file) gets it on every frame.
 * --- free-watermark --- Last, over everything, the watermark of a run whose seal is not a verified Pro licence's: a cut
 * re-encodes the pixels of an export and crops into them, so the frame is stamped again here, at the output's size – the way
 * every compositor of the site stamps its own frames (lib/recording/recorder.ts).
 */
import { stampFrame } from "@/lib/watermark/seal";
import { BADGE_HEIGHT, BADGE_INSET, exportSquare, safeZone } from "@/lib/watermark/layout";
import { TEXT_MAX_SHARE, cardAlphaAt, cropRect, fitTextLines, hookLayout, type ClipEditSpec, type ClipTimeline } from "./spec";

export interface EditFrameMark {
  seal: unknown;
  clipMs: number;
  /** --- legal-audit --- The fan-made badge's line (fanMadeLine(): a Fight League source's), or null for none. */
  fanMade: string | null;
  /** --- cut-reedit --- The source is a cut file: its own badge sits where its cut put it (burnedBadgeShows, cutFileBadgeBottom). */
  cutFile?: boolean;
  /**
   * --- badge-safe --- The source's frames are known to carry the fan-made badge (a clip this build made, a Library item that
   * says so: LibraryMeta.fanMadeBurned). Absent or false, the badge is drawn on every frame.
   */
  fanMadeBurned?: boolean;
}

/** The end card's words (the page hands them in its language). */
export interface EditCardText {
  title: string;
  note: string;
}

export interface EditSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

const CARD_BG = "#0b0b10";
const URL_INK = "#4ade80";
/** --- clip-fit --- The hook keeps to two lines, one line apart by this many of its sizes. */
const HOOK_LINES = 2;
const LINE_GAP = 1.15;

// --- legal-audit --- the modes whose every frame carries the fan-made badge (Fight League's fighters parody third-party characters)
const FAN_MADE_MODES: ReadonlySet<string> = new Set(["fightLeague"]);

/** --- badge-safe --- Whether every frame of a `mode` clip carries the fan-made badge (the simulator burns it in). */
export function fanMadeMode(mode: string | null | undefined): boolean {
  return !!mode && FAN_MADE_MODES.has(mode);
}

/** --- legal-audit --- The badge a cut of a `mode` source carries again (`text`: FightLeague.canvasFanMade in the page's language), or null. */
export function fanMadeLine(mode: string | null | undefined, text: string): string | null {
  return fanMadeMode(mode) && text.trim() ? text : null;
}

/** --- badge-once --- The fan-made line's size, a share of the export square's side (the simulator burns it at this size too). */
const FAN_MADE_SIZE = 0.016;

/** --- badge-safe --- Where a line burned into the source lands in the cut's frame: its centre, its size and its widest, in frame px. */
export interface BurnedBadgeBox {
  cx: number;
  cy: number;
  size: number;
  maxWidth: number;
}

/**
 * --- badge-safe --- Where the fan-made line burned into the `source` frames lands in a cut's `width` × `height` frame at
 * crop-in `zoom`, or null for a source of no size. The simulator burns it centred in the strip at the bottom of the export's
 * square (fightLeagueRenderer), 1.6 % of its side, at most half the side wide; the centred crop-in moves it down and makes it
 * larger.
 */
export function burnedBadgeBox(source: { width: number; height: number }, zoom: number, width: number, height: number): BurnedBadgeBox | null {
  if (!(source.width > 0 && source.height > 0 && width > 0 && height > 0)) return null;
  const square = exportSquare(source.width, source.height);
  const crop = cropRect(source.width, source.height, zoom, width, height);
  const scale = height / crop.sh;
  return {
    cx: (square.x + square.width / 2 - crop.sx) * scale,
    cy: (square.y + square.width * (1 - BADGE_INSET - BADGE_HEIGHT / 2) - crop.sy) * scale,
    size: FAN_MADE_SIZE * square.width * scale,
    maxWidth: 0.5 * square.width * scale,
  };
}

/**
 * --- badge-once --- Whether the fan-made badge burned into the `source` frames stays the cut's one badge at crop-in `zoom`:
 * --- badge-safe --- whole inside the frame's safe zone (lib/watermark/layout.ts safeZone), not under the caption and buttons
 * TikTok, Reels and Shorts lay over the bottom fifth. A 1080 × 1920 export keeps it there up to a crop-in of about 16 %; a
 * 1920 × 1080 one never does (it lands near the bottom edge). A cut file's own badge sits wherever its own cut put it (inside
 * the safe zone when this build made it), so it is sure to stay put only while every pixel of the file shows (`cutFile`: no
 * crop-in).
 */
export function burnedBadgeShows(source: { width: number; height: number }, zoom: number, width: number, height: number, cutFile = false): boolean {
  if (cutFile) return zoom <= 1;
  const box = burnedBadgeBox(source, zoom, width, height);
  if (!box) return false;
  const safe = safeZone(width, height);
  return box.cy - box.size / 2 >= safe.y && box.cy + box.size / 2 <= safe.y + safe.height && box.cx - box.maxWidth / 2 >= safe.x && box.cx + box.maxWidth / 2 <= safe.x + safe.width;
}

/** --- badge-safe --- How much wider than the line in this page's language the cover is (the source may have burned another). */
const COVER_SLACK = 1.25;

/**
 * --- cut-reedit --- How far down a cut file's own badge may reach in the cut's frame at crop-in `zoom` (frame px). This build
 * puts a cut's badge at the fixed spot of its frame (where burnedBadgeBox(the file, zoom) lands, the file taken as the source),
 * or keeps its source's one, which lies a little lower but always inside the file's safe zone: so never below that zone's
 * bottom edge, moved by the crop-in.
 */
export function cutFileBadgeBottom(source: { width: number; height: number }, zoom: number, width: number, height: number): number {
  const crop = cropRect(source.width, source.height, zoom, width, height);
  const safe = safeZone(source.width, source.height);
  return ((safe.y + safe.height - crop.sy) * height) / crop.sh;
}

const fontOf = (size: number, weight = "bold") => `${weight} ${size}px Inter, system-ui, sans-serif`;

function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** --- clip-fit --- `text` fitted to `maxWidth` at `size` and below (the context's font is left at the fitted size). */
function fitted(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number, maxLines: number, weight = "bold") {
  const fit = fitTextLines(text, size, maxWidth, maxLines, (line, s) => {
    ctx.font = fontOf(s, weight);
    return ctx.measureText(line).width;
  });
  ctx.font = fontOf(fit.size, weight);
  return fit;
}

/**
 * Centred lines of text in a dark pill, the text fitted to the frame (`maxWidth`: the pill's widest, padding included).
 * Returns the pill's lower edge.
 */
function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, font: number, padX: number, padY: number, alpha: number, ink: string, maxWidth: number, maxLines: number, weight = "bold"): number {
  const textMax = Math.max(1, maxWidth - 2 * padX);
  const fit = fitted(ctx, text, font, textMax, maxLines, weight);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.min(textMax, Math.max(0, ...fit.lines.map((line) => ctx.measureText(line).width)));
  const step = LINE_GAP * fit.size;
  const h = fit.size + (fit.lines.length - 1) * step + 2 * padY;
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  roundedBox(ctx, cx - width / 2 - padX, top, width + 2 * padX, h, Math.round(0.3 * font));
  ctx.fillStyle = ink;
  fit.lines.forEach((line, i) => ctx.fillText(line, cx, top + padY + fit.size / 2 + i * step, textMax));
  return top + h;
}

/** --- clip-fit --- One centred line of the end card, shrunk to fit the frame. */
function cardLine(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, maxWidth: number, weight = "bold") {
  const fit = fitted(ctx, text, size, maxWidth, 1, weight);
  ctx.fillText(fit.lines[0] ?? "", cx, y, maxWidth);
}

/**
 * Draws the frame at `tSec` of the cut into a `width` × `height` context. `source.image` already shows the source time of
 * `tSec` (render.ts seeks the video there; the preview too). The card's alpha comes from the timeline, so the preview and
 * the file agree frame for frame.
 */
export function drawEditFrame(ctx: CanvasRenderingContext2D, source: EditSource, width: number, height: number, spec: ClipEditSpec, timeline: ClipTimeline, tSec: number, card: EditCardText, mark: EditFrameMark) {
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  const crop = cropRect(source.width, source.height, spec.zoom, width, height);
  ctx.drawImage(source.image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);

  // --- badge-safe --- the source's own badge is the one badge only while the platforms leave it in sight; pushed down under
  // their caption it is covered here (a dark pill, under the hook and the card) and drawn again at its fixed spot below.
  // --- cut-reedit --- A cut file's own badge (the file is the source) sits at its frame's fixed spot or a little lower: a crop-in
  // moves it, so the cover reaches from that spot down to the lowest the badge can be (cutFileBadgeBottom).
  const burned = !!mark.fanMade && mark.fanMadeBurned === true;
  const cutFile = mark.cutFile === true;
  const burnedShows = burned && burnedBadgeShows(source, spec.zoom, width, height, cutFile);
  if (burned && !burnedShows && mark.fanMade) {
    const box = burnedBadgeBox(source, spec.zoom, width, height);
    const bottom = box ? Math.max(box.cy + box.size / 2, cutFile ? cutFileBadgeBottom(source, spec.zoom, width, height) : 0) : 0;
    if (box && box.cy - box.size / 2 < height && bottom > 0) {
      const size = Math.max(1, Math.round(box.size));
      ctx.font = fontOf(size, "600");
      const line = Math.min(box.maxWidth, COVER_SLACK * ctx.measureText(mark.fanMade).width);
      const padX = Math.round(0.6 * size);
      const padY = Math.round(0.35 * size);
      const top = box.cy - size / 2 - padY;
      const reach = cutFile ? bottom + padY : top + size + 2 * padY;
      ctx.fillStyle = CARD_BG;
      roundedBox(ctx, box.cx - line / 2 - padX, top, line + 2 * padX, reach - top, Math.round(0.3 * size));
    }
  }

  const layout = hookLayout(width, height);
  const cx = width / 2;
  const maxWidth = TEXT_MAX_SHARE * width;
  const hook = spec.hook.trim();
  const url = spec.url.trim();
  if (hook || url) {
    let y = layout.hookY;
    if (hook) y = pill(ctx, hook, cx, y, layout.hookFont, layout.padX, layout.padY, 0.55, "#ffffff", maxWidth, HOOK_LINES) + Math.round(0.25 * layout.urlFont);
    if (url) pill(ctx, url, cx, y, layout.urlFont, Math.round(0.6 * layout.padX), Math.round(0.45 * layout.padY), 0.45, "rgba(255, 255, 255, 0.88)", maxWidth, 1);
  }

  const alpha = cardAlphaAt(timeline, tSec);
  if (alpha > 0) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = CARD_BG;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const big = Math.round(0.078 * width);
    const mid = Math.round(0.065 * width);
    const small = Math.round(0.037 * width);
    ctx.fillStyle = "#ffffff";
    cardLine(ctx, card.title, cx, height / 2 - 1.3 * big, big, maxWidth);
    if (url) {
      ctx.fillStyle = URL_INK;
      cardLine(ctx, url, cx, height / 2, mid, maxWidth);
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    cardLine(ctx, card.note, cx, height / 2 + 1.6 * mid, small, maxWidth, "normal");
    ctx.globalAlpha = 1;
  }

  // --- legal-audit --- the fan-made badge where the simulator puts it (centred in the watermark strip at the bottom of the
  // exported square, 1.6 % of its side), on a small dark pill so it reads over any stage, after the card so it shows on it too.
  // --- badge-once --- Only where the source's own one is gone: cut away by the crop-in or pushed under the platforms' caption
  // (--- badge-safe --- always drawn, the burned one covered above), not known to be there (always drawn), or covered by the
  // card (drawn as strongly as the card covers it, so one takes over from the other). No second badge on the action.
  const badgeAlpha = mark.fanMade ? (burnedShows ? alpha : 1) : 0;
  if (mark.fanMade && badgeAlpha > 0) {
    const square = exportSquare(width, height);
    const side = square.width;
    const size = Math.max(4, Math.round(FAN_MADE_SIZE * side));
    const padY = Math.round(0.35 * size);
    const centre = square.y + side * (1 - BADGE_INSET - BADGE_HEIGHT / 2);
    ctx.globalAlpha = badgeAlpha;
    pill(ctx, mark.fanMade, cx, centre - size / 2 - padY, size, Math.round(0.6 * size), padY, 0.45, "rgba(255, 255, 255, 0.85)", 0.5 * side, 1, "600");
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // --- free-watermark --- the frame's pixels get the mark here, in the compositor's own canvas, after everything else
  stampFrame(ctx, mark.seal, { width, height, clipMs: mark.clipMs });
}
