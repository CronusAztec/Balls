/*
 * --- end-banner --- The end banner of every mode that says its verdict in the middle of the frame: Canvas.tsx's bigBanner()
 * and fitBanner() (ESCAPED!, IN LINE!, FINAL FORM, GLASS CLEARED, "56 Gerald made it home" …) and the maze's verdict. One
 * look for all of them, so the verdict is the clearest thing in a clip's last seconds:
 *  - a dark plate over the balls and everything else, drawn at full opacity whatever the pass around it uses (the canvas' HUD
 *    pass runs at the camera's 0.6), a hair of the mode's colour mixed in and a border in that colour;
 *  - the title in the mode's own colour, lightened only as far as it takes to read on the plate over any page (a contrast of
 *    END_BANNER_MIN_CONTRAST even with a white page showing through), fitted to the square;
 *  - the line under it in near white at 4.2 % of the square (22 px in a 540 px wide feed), on two lines when one is too long;
 *  - an entrance over END_BANNER_IN_MS: the plate scales up past its size and settles while it fades in, so the verdict
 *    reads as an event. It is short and starts well visible. Its clock is the frames' own time (the caller's `dtMs`: the
 *    frame time live, the export's frame time offline), never the wall clock or a random number, so the same frames of a
 *    run draw the same banner everywhere;
 *  - a hold: a verdict that comes with the run's last step (Ball Drop, Pendulum Wave, an escape) stays up for
 *    END_BANNER_HOLD_MS before the page shows its end screen and a recording stops (`fresh()`, which the canvas reports as
 *    its hold of the end screen): a title and a line of five words cannot be read in the recorder's last 0.5 s. A mode
 *    that holds its own ending (Merge Ring, Spiral Glass) has had its banner up that long already and gets nothing more.
 * The layout is cached per text and size (a few measureText calls when the words change, none per frame) and the layer
 * reports the plate's box, which the canvas hands to the watermark so its badge keeps clear of it.
 */

/** How long the entrance takes (ms of frame time): 14 frames at 60 fps. */
export const END_BANNER_IN_MS = 240;
/** The least contrast the title and the lines keep against the plate (WCAG's ratio for body text). */
export const END_BANNER_MIN_CONTRAST = 4.5;
/**
 * How long a verdict is on screen before the end screen may cover it and a recording may stop (ms of frame time): with the
 * recorder's own 0.5 s a clip shows it for 2 s.
 */
export const END_BANNER_HOLD_MS = 1500;
/**
 * The plate: nearly black, 97 % opaque. The border and the tint keep the mode's colour; nothing under it can be read (at
 * 92 % a gate label of the multipliers' board still could).
 */
export const END_BANNER_PLATE = { r: 9, g: 11, b: 16, alpha: 0.97 } as const;
/** The share of the mode's colour mixed into the plate. */
const PLATE_TINT = 0.1;
/** The line under the title and the note under that. */
export const END_BANNER_SUB_COLOR = "#f1f5f9";
const NOTE_COLOR = "#cbd5e1";
/** The widest the words run, as a share of the square's side. */
const TEXT_SHARE = 0.84;

export interface EndBannerText {
  title: string;
  /** The line under the title ("" for none). */
  sub: string;
  /** A third, smaller line in italics ("" or missing: none): the maze's deadpan caption. */
  note?: string;
  /** The mode's colour ("#rgb" or "#rrggbb"; anything else is used as it is). */
  color: string;
}

export interface EndBannerLayout {
  titleFs: number;
  subFs: number;
  noteFs: number;
  /** The line under the title, on one or two lines. */
  subLines: string[];
  /** The plate's size. */
  width: number;
  height: number;
  /** The centre lines of the title, each sub line and the note, from the plate's top. */
  titleY: number;
  subY: number[];
  noteY: number;
  /** The colours: the title's (readable on the plate), the plate's fill and its border. */
  titleColor: string;
  plateFill: string;
  border: string;
}

/* ------------------------------------------------------------------ colour */

/** "#rgb" or "#rrggbb" as [r, g, b] (0–255), or null for anything else. */
export function hexRgb(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance of an sRGB colour (0–255 a channel). */
export function luminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = Math.max(0, Math.min(255, v)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two luminances. */
export function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The plate's colour for a mode colour: the dark base with a hair of that colour mixed in. */
function plateRgb(color: string): [number, number, number] {
  const c = hexRgb(color);
  const p = END_BANNER_PLATE;
  if (!c) return [p.r, p.g, p.b];
  return [p.r + (c[0] - p.r) * PLATE_TINT, p.g + (c[1] - p.g) * PLATE_TINT, p.b + (c[2] - p.b) * PLATE_TINT];
}

/** The brightest the plate can look for a mode colour: over a white page showing through its 3 %. */
export function endBannerPlateLuminance(color: string): number {
  const [r, g, b] = plateRgb(color);
  const a = END_BANNER_PLATE.alpha;
  return luminance(r * a + 255 * (1 - a), g * a + 255 * (1 - a), b * a + 255 * (1 - a));
}

/**
 * The title's colour: the mode's own, mixed towards white in steps of 4 % only until it reads on the plate (a contrast of
 * END_BANNER_MIN_CONTRAST against the plate at its brightest). Lime, white, teal and pink stay as they are; the purple and
 * the red get a little lighter. A colour that is no hex colour is used as it is.
 */
export function endBannerTitleColor(color: string): string {
  const c = hexRgb(color);
  if (!c) return color;
  const plate = endBannerPlateLuminance(color);
  for (let step = 0; step <= 25; step++) {
    const t = step / 25;
    const r = c[0] + (255 - c[0]) * t;
    const g = c[1] + (255 - c[1]) * t;
    const b = c[2] + (255 - c[2]) * t;
    if (contrast(luminance(r, g, b), plate) >= END_BANNER_MIN_CONTRAST) return step === 0 ? color : `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  return "#ffffff";
}

/* ------------------------------------------------------------------ layout */

const titleFont = (fs: number) => `800 ${fs}px sans-serif`;
const subFont = (fs: number) => `600 ${fs}px sans-serif`;
const noteFont = (fs: number) => `italic 600 ${fs}px sans-serif`;

type Measurer = Pick<CanvasRenderingContext2D, "font" | "measureText">;

function widthOf(ctx: Measurer, text: string, font: string): number {
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * `sub` on one line when it fits `maxWidth`, else on the two most even lines its words allow: split at a " · " when it has
 * one (a status line's parts stay whole), at a space otherwise. A single word stays on one line.
 */
export function endBannerSubLines(ctx: Measurer, sub: string, font: string, maxWidth: number): string[] {
  if (!sub) return [];
  if (widthOf(ctx, sub, font) <= maxWidth) return [sub];
  const dot = " · ";
  const cuts: [string, string][] = [];
  if (sub.includes(dot)) {
    const parts = sub.split(dot);
    for (let k = 1; k < parts.length; k++) cuts.push([parts.slice(0, k).join(dot), parts.slice(k).join(dot)]);
  } else {
    const words = sub.split(" ").filter((w) => w.length > 0);
    for (let k = 1; k < words.length; k++) cuts.push([words.slice(0, k).join(" "), words.slice(k).join(" ")]);
  }
  let best: [string, string] | null = null;
  let bestWidth = Infinity;
  for (const cut of cuts) {
    const w = Math.max(widthOf(ctx, cut[0], font), widthOf(ctx, cut[1], font));
    if (w < bestWidth) {
      bestWidth = w;
      best = cut;
    }
  }
  return best ?? [sub];
}

/**
 * The banner's layout in a square of `side` px: the title at 8 % of the side (at least 24 px) and the line under it at 4.2 %
 * (at least 13 px), each smaller when it would run wider than 84 % of the side; a long line under the title takes two lines
 * first. Writes into `out`.
 */
export function layoutEndBanner(ctx: Measurer, text: EndBannerText, side: number, out: EndBannerLayout = emptyLayout()): EndBannerLayout {
  const S = Math.max(1, side);
  const maxText = TEXT_SHARE * S;
  const base = Math.max(24, 0.08 * S);
  let titleFs = base;
  let titleW = widthOf(ctx, text.title, titleFont(titleFs));
  if (titleW > maxText) {
    titleFs *= maxText / titleW;
    titleW = maxText;
  }
  let subFs = Math.max(13, 0.042 * S);
  const subLines = endBannerSubLines(ctx, text.sub, subFont(subFs), maxText);
  let subW = 0;
  for (const line of subLines) subW = Math.max(subW, widthOf(ctx, line, subFont(subFs)));
  if (subW > maxText) {
    subFs *= maxText / subW;
    subW = maxText;
  }
  const note = text.note ?? "";
  let noteFs = Math.max(11, 0.03 * S);
  let noteW = note ? widthOf(ctx, note, noteFont(noteFs)) : 0;
  if (noteW > maxText) {
    noteFs *= maxText / noteW;
    noteW = maxText;
  }
  const padX = 0.55 * base;
  const padY = 0.42 * base;
  const gap = 0.24 * base;
  const lineH = 1.22 * subFs;
  let y = padY;
  out.titleY = y + titleFs / 2;
  y += titleFs;
  out.subY.length = 0;
  if (subLines.length > 0) {
    y += gap;
    for (let i = 0; i < subLines.length; i++) out.subY.push(y + i * lineH + subFs / 2);
    y += (subLines.length - 1) * lineH + subFs;
  }
  out.noteY = 0;
  if (note) {
    y += 0.8 * gap;
    out.noteY = y + noteFs / 2;
    y += noteFs;
  }
  out.titleFs = titleFs;
  out.subFs = subFs;
  out.noteFs = noteFs;
  out.subLines = subLines;
  out.width = Math.max(titleW, subW, noteW) + 2 * padX;
  out.height = y + padY;
  const [pr, pg, pb] = plateRgb(text.color);
  out.plateFill = `rgba(${Math.round(pr)}, ${Math.round(pg)}, ${Math.round(pb)}, ${END_BANNER_PLATE.alpha})`;
  out.titleColor = endBannerTitleColor(text.color);
  out.border = text.color;
  return out;
}

function emptyLayout(): EndBannerLayout {
  return { titleFs: 0, subFs: 0, noteFs: 0, subLines: [], width: 0, height: 0, titleY: 0, subY: [], noteY: 0, titleColor: "#ffffff", plateFill: "#000000", border: "#ffffff" };
}

/* ------------------------------------------------------------------ a place of its own */

/**
 * The top edge of a banner `height` tall that a mode wants with its top at `wanted` (a banner beside the mode's payoff: under
 * Pendulum Wave's row of bobs, above the Journey's door), kept between `top` and `bottom` – the square's edges, or the
 * captions' stacks where a clip has them. Without room for it there, it goes where every banner went before: `fallback`
 * (the middle of the frame).
 */
export function placeEndBanner(wanted: number, height: number, top: number, bottom: number, fallback: number): number {
  if (!(bottom - top >= height)) return fallback;
  return Math.max(top, Math.min(bottom - height, wanted));
}

/** The share of the square a banner over the top of a ring, or over its bottom, has its centre at. */
export const END_BANNER_TOP = 0.18;
export const END_BANNER_BOTTOM = 0.82;
/** Half the height of a title and one line under it, as a share of the square (the band a banner covers around its centre). */
const BAND_HALF = 0.11;

/**
 * Where Accumulation's card goes in a square of `side` px centred on `cy`: over the top of the ring (END_BANNER_TOP) or over
 * its bottom (END_BANNER_BOTTOM), wherever it covers fewer of the frozen balls it counts; the top when it is even. Pure:
 * the same balls give the same place in every frame.
 */
export function accumulationBannerAt(balls: readonly { y: number; radius: number }[], cy: number, side: number): number {
  const S = Math.max(1, side);
  const top = cy - S / 2;
  let over = 0;
  let under = 0;
  for (const b of balls) {
    const from = (b.y - b.radius - top) / S;
    const to = (b.y + b.radius - top) / S;
    if (to > END_BANNER_TOP - BAND_HALF && from < END_BANNER_TOP + BAND_HALF) over++;
    if (to > END_BANNER_BOTTOM - BAND_HALF && from < END_BANNER_BOTTOM + BAND_HALF) under++;
  }
  return under < over ? END_BANNER_BOTTOM : END_BANNER_TOP;
}

/* ------------------------------------------------------------------ the entrance */

/**
 * The entrance `ageMs` after the banner first showed: its scale (from 0.8, past 1 by about 2 % and back to 1 at
 * END_BANNER_IN_MS) and its opacity (from 0.45 to 1 over the first 40 % of it). Writes into `out`.
 */
export function endBannerEntrance(ageMs: number, out: { scale: number; alpha: number } = { scale: 1, alpha: 1 }): { scale: number; alpha: number } {
  const k = Math.max(0, Math.min(1, ageMs / END_BANNER_IN_MS));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const back = 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
  out.scale = k >= 1 ? 1 : 0.8 + 0.2 * back;
  out.alpha = Math.min(1, 0.45 + (0.55 * k) / 0.4);
  return out;
}

/* ------------------------------------------------------------------ drawing */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
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

/**
 * One banner: its cached layout, its entrance clock and the plate's box of the frame drawn last. A canvas keeps one per
 * banner it may show in a frame; a frame that does not draw it starts its entrance over (`endFrame()`).
 */
export class EndBannerLayer {
  private key = "";
  private readonly lay = emptyLayout();
  private animKey: string | null = null;
  private drawn = false;
  private readonly pose = { scale: 1, alpha: 1 };
  /** Frame time since the banner showed (ms). */
  ageMs = 0;
  /** The words of the frame, for the caller to fill (kept, so a frame allocates none). */
  readonly text: EndBannerText = { title: "", sub: "", note: "", color: "#ffffff" };
  /** Whether the last finished frame showed the banner, and its plate's box then (canvas units, at its full size). */
  shown = false;
  readonly rect = { x: 0, y: 0, w: 0, h: 0 };

  /** The layout of `text` in a square of `side` px (measured again only when the words, the colour or the size change). */
  layout(ctx: CanvasRenderingContext2D, text: EndBannerText, side: number): EndBannerLayout {
    const key = `${side}|${text.color}|${text.title}|${text.sub}|${text.note ?? ""}`;
    if (key !== this.key) {
      this.key = key;
      const font = ctx.font;
      layoutEndBanner(ctx, text, side, this.lay);
      ctx.font = font;
    }
    return this.lay;
  }

  /**
   * Draws the banner with its plate's centre at (cx, cy) in a square of `side` px, `dtMs` of frame time after the frame
   * before (0 while paused: the entrance waits). A new title starts the entrance over.
   */
  draw(ctx: CanvasRenderingContext2D, text: EndBannerText, cx: number, cy: number, side: number, dtMs: number): void {
    const lay = this.layout(ctx, text, side);
    if (this.animKey !== text.title) {
      this.animKey = text.title;
      this.ageMs = 0;
    } else if (dtMs > 0) this.ageMs += dtMs;
    this.drawn = true;
    const w = lay.width;
    const h = lay.height;
    this.rect.x = cx - w / 2;
    this.rect.y = cy - h / 2;
    this.rect.w = w;
    this.rect.h = h;
    const pose = endBannerEntrance(this.ageMs, this.pose);
    const base = Math.max(24, 0.08 * Math.max(1, side));
    ctx.save();
    ctx.globalAlpha = pose.alpha;
    ctx.shadowBlur = 0;
    ctx.translate(cx, cy);
    if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
    // The plate, then a soft wide border under a crisp one (a glow without a shadow blur: cheap at 1080 px).
    roundRect(ctx, -w / 2, -h / 2, w, h, 0.28 * base);
    ctx.fillStyle = lay.plateFill;
    ctx.fill();
    ctx.strokeStyle = lay.border;
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.22 * pose.alpha;
    ctx.lineWidth = Math.max(5, 0.1 * base);
    ctx.stroke();
    ctx.globalAlpha = pose.alpha;
    ctx.lineWidth = Math.max(1.5, 0.03 * base);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = titleFont(lay.titleFs);
    ctx.fillStyle = lay.titleColor;
    ctx.fillText(text.title, 0, -h / 2 + lay.titleY);
    if (lay.subLines.length > 0) {
      ctx.font = subFont(lay.subFs);
      ctx.fillStyle = END_BANNER_SUB_COLOR;
      for (let i = 0; i < lay.subLines.length; i++) ctx.fillText(lay.subLines[i], 0, -h / 2 + lay.subY[i]);
    }
    if (text.note) {
      ctx.font = noteFont(lay.noteFs);
      ctx.fillStyle = NOTE_COLOR;
      ctx.fillText(text.note, 0, -h / 2 + lay.noteY);
    }
    ctx.restore();
  }

  /**
   * True while the banner is on screen and has been for less than END_BANNER_HOLD_MS: the verdict has not been read yet, so
   * the end screen waits (after `endFrame()`: the frame drawn last).
   */
  fresh(): boolean {
    return this.shown && this.ageMs < END_BANNER_HOLD_MS;
  }

  /** The end of a frame: one that did not draw the banner forgets its entrance, so the next showing plays it again. */
  endFrame(): void {
    this.shown = this.drawn;
    if (!this.drawn) this.animKey = null;
    this.drawn = false;
  }

  /** A new run: no banner, no entrance. */
  reset(): void {
    this.animKey = null;
    this.ageMs = 0;
    this.drawn = false;
    this.shown = false;
  }
}

/**
 * The banner shrunk to a strip: `text` on one line in the mode's colour on the same plate, its centre at (cx, cy), at most
 * `maxWidth` wide (the font shrinks to fit). For a verdict that has been read while the run goes on (the maze's winner,
 * once the others keep running). Writes the strip's box into `box` when given.
 */
export function drawEndBannerStrip(ctx: CanvasRenderingContext2D, text: string, color: string, cx: number, cy: number, side: number, maxWidth: number, box?: { x: number; y: number; w: number; h: number }): void {
  const S = Math.max(1, side);
  let fs = Math.max(12, 0.034 * S);
  const padX = 0.7 * fs;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.font = `800 ${fs}px sans-serif`;
  let tw = ctx.measureText(text).width;
  const room = Math.max(1, maxWidth - 2 * padX);
  if (tw > room) {
    fs *= room / tw;
    tw = room;
    ctx.font = `800 ${fs}px sans-serif`;
  }
  const w = tw + 2 * padX;
  const h = 1.7 * Math.max(12, 0.034 * S);
  const [pr, pg, pb] = plateRgb(color);
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = `rgba(${Math.round(pr)}, ${Math.round(pg)}, ${Math.round(pb)}, ${END_BANNER_PLATE.alpha})`;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 0.0025 * S);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = endBannerTitleColor(color);
  ctx.fillText(text, cx, cy);
  ctx.restore();
  if (box) {
    box.x = cx - w / 2;
    box.y = cy - h / 2;
    box.w = w;
    box.h = h;
  }
}
