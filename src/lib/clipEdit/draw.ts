/*
 * --- clip-editor --- One frame of the cut (spec.ts), for the editor's preview and for the file render.ts encodes: the
 * source's cropped window filling the frame, the hook and the address in a dark pill at the top, the end card fading in
 * over the last moments. --- clip-fit --- Every line is fitted to the frame (spec.ts fitTextLines): a long hook wraps onto
 * two lines and shrinks, an address or a card line shrinks, so nothing runs off its edges. --- legal-audit --- A cut of a
 * Fight League clip carries the permanent fan-made badge again, at the output's size and over the card too: the crop-in
 * and the card would otherwise cut away or cover the one the simulator drew. --- free-watermark --- Last, over everything,
 * the watermark of a run whose seal is not a verified Pro licence's: a cut re-encodes the pixels of an export and crops
 * into them, so the frame is stamped again here, at the output's size – the way every compositor of the site stamps its own
 * frames (lib/recording/recorder.ts).
 */
import { stampFrame } from "@/lib/watermark/seal";
import { BADGE_HEIGHT, BADGE_INSET, exportSquare } from "@/lib/watermark/layout";
import { TEXT_MAX_SHARE, cardAlphaAt, cropRect, fitTextLines, hookLayout, type ClipEditSpec, type ClipTimeline } from "./spec";

export interface EditFrameMark {
  seal: unknown;
  clipMs: number;
  /** --- legal-audit --- The fan-made badge's line (fanMadeLine(): a Fight League source's), or null for none. */
  fanMade: string | null;
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

/** --- legal-audit --- The badge a cut of a `mode` source carries again (`text`: FightLeague.canvasFanMade in the page's language), or null. */
export function fanMadeLine(mode: string | null | undefined, text: string): string | null {
  return mode && FAN_MADE_MODES.has(mode) && text.trim() ? text : null;
}

/**
 * --- cut-reedit --- The badge a cut carries (`cut`: what the editor renders now). A cut file has its own badge burned in: it
 * needs no second one while this cut shows every pixel of the file (no crop-in, no end card). A crop-in can cut the burned one
 * away and an end card covers it, so then the badge is drawn again, like on any other cut.
 */
export function cutFanMadeLine(mode: string | null | undefined, text: string, cut: { cutFile: boolean; zoom: number; cardSec: number }): string | null {
  return cut.cutFile && cut.zoom <= 1 && cut.cardSec <= 0 ? null : fanMadeLine(mode, text);
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
  // exported square, 1.6 % of its side), on a small dark pill so it reads over any stage, after the card so it shows on it too
  if (mark.fanMade) {
    const square = exportSquare(width, height);
    const side = square.width;
    const size = Math.max(4, Math.round(0.016 * side));
    const padY = Math.round(0.35 * size);
    const centre = square.y + side * (1 - BADGE_INSET - BADGE_HEIGHT / 2);
    pill(ctx, mark.fanMade, cx, centre - size / 2 - padY, size, Math.round(0.6 * size), padY, 0.45, "rgba(255, 255, 255, 0.85)", 0.5 * side, 1, "600");
  }
  ctx.restore();
  // --- free-watermark --- the frame's pixels get the mark here, in the compositor's own canvas, after everything else
  stampFrame(ctx, mark.seal, { width, height, clipMs: mark.clipMs });
}
