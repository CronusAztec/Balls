import type { ModeId } from "@/lib/physics/types";
import { badgeMetrics, badgeZone, exportSquare } from "@/lib/watermark/layout";

/*
 * --- loop-foundation --- The loop HUD, in the style of the loop clips: a bold lowercase title at about 16 % of the frame's
 * height, an optional grey subtitle under a thin grey rule, and at most one counter – amber (#f2c46a), grey on a light page –
 * at about 85 %. The recording compositor draws it into every export frame (`drawRecordingFrame()` in lib/recording/recorder.ts:
 * the page recorder, the fast export and through it the batch render), at export resolution, so the clips carry it in their
 * pixels; the live canvas previews it around the ring (`loopHudLiveLayout()`). In a portrait export the title and the counter
 * sit in the bars above and below the arena's square, clear of the watermark's badge (which stays inside the square).
 *
 * The words: the settings' own title and subtitle, else the mode's (`LOOP_HUD_MODE_TEXT`, translated under `LoopHud`; any other
 * mode's title is its name). The counter is the mode's (`loopHudCount()`: Grow's bounces in the current cycle).
 */

export const LOOP_HUD_AMBER = "#f2c46a";
/** The subtitle and the rule (on a dark page and on a light one), the counter on a light page, the title on a light page. */
export const LOOP_HUD_GREY = "#9a9a9a";
export const LOOP_HUD_GREY_LIGHT = "#6e6e6e";
export const LOOP_HUD_TITLE_DARK = "#141414";
/** Where the title's and the counter's lines are centred, as a share of the frame's height. */
export const LOOP_HUD_TITLE_Y = 0.16;
export const LOOP_HUD_COUNTER_Y = 0.85;

/** What one frame of the HUD shows (texts already resolved and lowercased; "" leaves a line out). */
export interface LoopHudFrame {
  title: string;
  subtitle: string;
  counter: string;
  /** A light page: a dark title and a grey counter. */
  light: boolean;
}

/** The HUD's static words for a page: the title, the subtitle and the counter's template ("{count} bounces"). */
export interface LoopHudSpec {
  title: string;
  subtitle: string;
  counter: string;
  light: boolean;
}

/** Translation keys (namespace `LoopHud`) of the modes with words of their own; any other mode's title is its name. */
export const LOOP_HUD_MODE_TEXT: Readonly<Partial<Record<ModeId, { title: string; subtitle: string; counter: string }>>> = {
  grow: { title: "growTitle", subtitle: "growSubtitle", counter: "growCounter" },
};

/** The HUD's lines in a `width` × `height` frame (px): centres of the lines, font sizes, the rule and the widest a line may be. */
export interface LoopHudLayout {
  titleY: number;
  titleSize: number;
  ruleY: number;
  ruleWidth: number;
  subtitleY: number;
  subtitleSize: number;
  counterY: number;
  counterSize: number;
  maxWidth: number;
}

/**
 * The export frame's layout: the title centred at 16 % of the height, the counter at 85 %, sizes from the frame's shorter
 * side. Where the counter's line would reach the band of the watermark's badge (a square or landscape frame: the badge sits
 * at the bottom of the arena's square, which fills the height) it moves up just above it; in a portrait frame the counter is
 * in the bar under the square, far from the badge, and stays at 85 %.
 */
export function loopHudLayout(width: number, height: number): LoopHudLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const unit = Math.min(w, h);
  const titleSize = Math.max(12, Math.round(0.07 * unit));
  const subtitleSize = Math.max(9, Math.round(0.032 * unit));
  const counterSize = Math.max(11, Math.round(0.058 * unit));
  const titleY = LOOP_HUD_TITLE_Y * h;
  const ruleY = titleY + 0.66 * titleSize;
  let counterY = LOOP_HUD_COUNTER_Y * h;
  if (w > 0 && h > 0) {
    const square = exportSquare(w, h);
    const zone = badgeZone(w, h, square);
    const badge = badgeMetrics(square.width);
    const badgeBottom = zone.y + zone.height - badge.inset;
    const badgeTop = badgeBottom - badge.height - badge.shadowPad;
    const half = HUD_LINE_HALF * counterSize;
    if (counterY + half > badgeTop && counterY - half < badgeBottom + badge.shadowPad) counterY = badgeTop - half - 0.25 * counterSize;
  }
  return {
    titleY,
    titleSize,
    ruleY,
    ruleWidth: Math.min(0.42 * w, 5 * titleSize),
    subtitleY: ruleY + 0.95 * subtitleSize,
    subtitleSize,
    counterY,
    counterSize,
    maxWidth: 0.86 * w,
  };
}

/** Half a HUD line's height, in font sizes (the band a line covers around its centre). */
export const HUD_LINE_HALF = 0.6;

/**
 * The live canvas' layout: the title in the margin above the ring (below `insetTop`, the page's buttons), the counter in the
 * margin below it; the subtitle only where the margin holds both lines (ruleY / subtitleY are then −1 when it does not).
 */
export function loopHudLiveLayout(width: number, height: number, centerY: number, ring: number, insetTop = 0): LoopHudLayout {
  const base = loopHudLayout(width, height);
  const top = Math.max(0, centerY - ring - insetTop);
  const bottom = Math.max(0, height - (centerY + ring));
  const titleSize = Math.max(10, Math.min(base.titleSize, 0.5 * top));
  const subtitleSize = Math.max(8, Math.min(base.subtitleSize, 0.5 * titleSize));
  const counterSize = Math.max(10, Math.min(base.counterSize, 0.5 * bottom));
  const roomForSubtitle = top >= 2.2 * titleSize + 2 * subtitleSize;
  const titleY = insetTop + (roomForSubtitle ? 0.15 * top + 0.5 * titleSize : top / 2);
  const ruleY = roomForSubtitle ? titleY + 0.66 * titleSize : -1;
  return {
    ...base,
    titleY,
    titleSize,
    ruleY,
    ruleWidth: Math.min(0.42 * width, 5 * titleSize),
    subtitleY: roomForSubtitle ? ruleY + 0.95 * subtitleSize : -1,
    subtitleSize,
    counterY: centerY + ring + bottom / 2,
    counterSize,
  };
}

/** The rectangles (px) the HUD's lines may cover in a frame, for a line `textWidth` px wide at most (the watermark's tests). */
export function loopHudRects(layout: LoopHudLayout, width: number, subtitle: boolean): { x: number; y: number; width: number; height: number }[] {
  const line = (y: number, size: number) => ({ x: (width - layout.maxWidth) / 2, y: y - HUD_LINE_HALF * size, width: layout.maxWidth, height: 2 * HUD_LINE_HALF * size });
  const out = [line(layout.titleY, layout.titleSize), line(layout.counterY, layout.counterSize)];
  if (subtitle && layout.subtitleY >= 0) out.push(line(layout.subtitleY, layout.subtitleSize));
  return out;
}

/** True for a light colour (relative luminance above one half): the HUD's dark-on-light colours. */
export function isLightColor(color: string | undefined | null): boolean {
  const m = typeof color === "string" ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim()) : null;
  if (!m) return false;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return y > 0.5;
}

/** A HUD line as shown: one line, trimmed and lowercased in the page's language. */
export function hudText(text: string | undefined | null, locale?: string): string {
  if (typeof text !== "string") return "";
  const one = text.replace(/\s+/g, " ").trim();
  try {
    return one.toLocaleLowerCase(locale);
  } catch {
    return one.toLowerCase();
  }
}

/** The counter's line: the template with `{count}` replaced ("" without a count or a template). */
export function hudCounterText(template: string, count: number | null, locale?: string): string {
  if (!template || count === null || !Number.isFinite(count)) return "";
  return hudText(template.replace("{count}", String(Math.round(count))), locale);
}

/** The counter of the mode's run (Grow: the bounces of the current cycle), or null when the mode has none. */
export function loopHudCount(engine: { getCurrentModeName(): string; getGrowView(): { bounces: number } }): number | null {
  return engine.getCurrentModeName() === "grow" ? engine.getGrowView().bounces : null;
}

/** One frame of the HUD from the page's words and the run's counter. */
export function loopHudFrame(spec: LoopHudSpec, count: number | null, locale?: string): LoopHudFrame {
  return { title: hudText(spec.title, locale), subtitle: hudText(spec.subtitle, locale), counter: hudCounterText(spec.counter, count, locale), light: spec.light };
}

/** Draws one line centred at (`x`, `y`), shrunk to `maxWidth` when it is wider. */
function fitLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, weight: string, maxWidth: number) {
  ctx.font = `${weight} ${size}px sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxWidth && w > 0) ctx.font = `${weight} ${Math.max(6, Math.floor((size * maxWidth) / w))}px sans-serif`;
  ctx.fillText(text, x, y);
}

/** Paints the HUD into a frame (the compositor, the live canvas). */
export function drawLoopHud(ctx: CanvasRenderingContext2D, width: number, frame: LoopHudFrame, layout: LoopHudLayout) {
  if (!frame.title && !frame.subtitle && !frame.counter) return;
  const cx = width / 2;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  if (frame.title) {
    ctx.fillStyle = frame.light ? LOOP_HUD_TITLE_DARK : "#ffffff";
    fitLine(ctx, frame.title, cx, layout.titleY, layout.titleSize, "800", layout.maxWidth);
  }
  if (frame.subtitle && layout.subtitleY >= 0) {
    const grey = frame.light ? LOOP_HUD_GREY_LIGHT : LOOP_HUD_GREY;
    ctx.strokeStyle = grey;
    ctx.lineWidth = Math.max(1, Math.round(0.08 * layout.subtitleSize));
    ctx.beginPath();
    ctx.moveTo(cx - layout.ruleWidth / 2, layout.ruleY);
    ctx.lineTo(cx + layout.ruleWidth / 2, layout.ruleY);
    ctx.stroke();
    ctx.fillStyle = grey;
    fitLine(ctx, frame.subtitle, cx, layout.subtitleY, layout.subtitleSize, "500", layout.maxWidth);
  }
  if (frame.counter) {
    ctx.fillStyle = frame.light ? LOOP_HUD_GREY_LIGHT : LOOP_HUD_AMBER;
    fitLine(ctx, frame.counter, cx, layout.counterY, layout.counterSize, "700", layout.maxWidth);
  }
  ctx.restore();
}
