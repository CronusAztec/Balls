/*
 * --- clip-editor --- One frame of the cut (spec.ts), for the editor's preview and for the file render.ts encodes: the
 * source's cropped window filling the frame, the hook and the address in a dark pill at the top, the end card fading in
 * over the last moments. --- free-watermark --- Last, over everything, the watermark of a run whose seal is not a verified
 * Pro licence's: a cut re-encodes the pixels of an export and crops into them, so the frame is stamped again here, at the
 * output's size – the way every compositor of the site stamps its own frames (lib/recording/recorder.ts).
 */
import { stampFrame } from "@/lib/watermark/seal";
import { cardAlphaAt, cropRect, hookLayout, type ClipEditSpec, type ClipTimeline } from "./spec";

export interface EditFrameMark {
  seal: unknown;
  clipMs: number;
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

function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** A centred line of text in a dark pill. Returns the pill's lower edge. */
function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, font: number, padX: number, padY: number, alpha: number, ink: string): number {
  ctx.font = `bold ${font}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width;
  const h = font + 2 * padY;
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  roundedBox(ctx, cx - width / 2 - padX, top, width + 2 * padX, h, Math.round(0.3 * font));
  ctx.fillStyle = ink;
  ctx.fillText(text, cx, top + h / 2);
  return top + h;
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
  const hook = spec.hook.trim();
  const url = spec.url.trim();
  if (hook || url) {
    let y = layout.hookY;
    if (hook) y = pill(ctx, hook, cx, y, layout.hookFont, layout.padX, layout.padY, 0.55, "#ffffff") + Math.round(0.25 * layout.urlFont);
    if (url) pill(ctx, url, cx, y, layout.urlFont, Math.round(0.6 * layout.padX), Math.round(0.45 * layout.padY), 0.45, "rgba(255, 255, 255, 0.88)");
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
    ctx.font = `bold ${big}px Inter, system-ui, sans-serif`;
    ctx.fillText(card.title, cx, height / 2 - 1.3 * big);
    if (url) {
      ctx.fillStyle = URL_INK;
      ctx.font = `bold ${mid}px Inter, system-ui, sans-serif`;
      ctx.fillText(url, cx, height / 2);
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = `${small}px Inter, system-ui, sans-serif`;
    ctx.fillText(card.note, cx, height / 2 + 1.6 * mid);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // --- free-watermark --- the frame's pixels get the mark here, in the compositor's own canvas, after everything else
  stampFrame(ctx, mark.seal, { width, height, clipMs: mark.clipMs });
}
