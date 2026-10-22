import { TILE_RECT, type TileView } from "@/lib/physics/tiles";

/*
 * --- tiles --- Canvas drawing of a TileField (lib/physics/tiles.ts, the destructible tiles with hit points of the Blueprint
 * interpreter). A mode's renderer calls `TilesLayer.draw()` in its `drawWorld()` phase, under the balls. Three styles:
 *  - glass: frosted, translucent panes in the row's colour with a thin white rim, fading as they crack;
 *  - brick: solid blocks in the row's colour, darker as they crack, with dark mortar lines;
 *  - neon: faint fills with a glowing outline in the row's colour, dimmer as they crack.
 * A tile's damage shows in `TILE_HP_SHADES` steps, so a frame batches its tiles into one path per colour and shade (at most
 * six colours × four shades) instead of one per tile; a tile hit in the last `TILE_FLASH_MS` flashes white and a broken one
 * leaves a fading outline for `TILE_BREAK_MS`. Everything animates on the field's clock (`view.clockMs`, simulated time),
 * so a pause freezes it and a recording replays it; nothing is allocated per frame (the colour strings are cached when the
 * palette or the style changes).
 */

export const TILE_STYLES = ["glass", "brick", "neon"] as const;
export type TileStyle = (typeof TILE_STYLES)[number];

export function isTileStyle(value: unknown): value is TileStyle {
  return typeof value === "string" && (TILE_STYLES as readonly string[]).includes(value);
}

/** Damage steps a tile's colour shows (0 = whole … TILE_HP_SHADES − 1 = nearly broken). */
export const TILE_HP_SHADES = 4;
/** How long a hit tile flashes white, and how long a broken tile's outline fades (ms of simulated time). */
export const TILE_FLASH_MS = 140;
export const TILE_BREAK_MS = 320;
/** The colours by row when a mode gives none: sky, mint, gold, pink, lilac, orange. */
export const DEFAULT_TILE_PALETTE: readonly string[] = ["#5ec8f8", "#7be0a5", "#ffd166", "#ff8fab", "#b39cff", "#ff9f5a"];
/** Flash strengths cached as strings (the flash fades in this many steps). */
const FLASH_STEPS = 10;
const TWO_PI = Math.PI * 2;

export interface TilesRenderOptions {
  style: TileStyle;
  /** Colours ("#rrggbb"), cycled by row (or column); empty or absent: `DEFAULT_TILE_PALETTE`. */
  palette?: readonly string[];
  /** What picks a tile's colour: its row (the default: one colour a layer) or its column. */
  colorBy?: "row" | "col";
  /** The outline's width in px (1.5 by default). */
  lineWidth?: number;
}

/** A tile's damage step: 0 at full hit points, `TILE_HP_SHADES − 1` when nearly broken. */
export function hpShade(hp: number, maxHp: number): number {
  if (!(maxHp > 0) || !(hp < maxHp)) return 0;
  const lost = 1 - (hp > 0 ? hp : 0) / maxHp;
  const s = Math.floor(lost * TILE_HP_SHADES);
  return s < 0 ? 0 : s >= TILE_HP_SHADES ? TILE_HP_SHADES - 1 : s;
}

/** "#rrggbb" (or "#rgb") → its channels; anything else → white. */
export function rgbOf(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typeof color === "string" ? color.trim() : "");
  if (!m) return [255, 255, 255];
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const rgba = (r: number, g: number, b: number, a: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`;

/** The fill of a tile of colour `color` at damage step `shade` in `style`. */
export function tileFill(style: TileStyle, color: string, shade: number): string {
  const [r, g, b] = rgbOf(color);
  const s = shade < 0 ? 0 : shade >= TILE_HP_SHADES ? TILE_HP_SHADES - 1 : shade;
  if (style === "brick") {
    const k = 1 - 0.14 * s;
    return rgba(r * k, g * k, b * k, 1);
  }
  if (style === "neon") return rgba(r, g, b, 0.12 - 0.02 * s);
  // glass: a frost lighter than the colour, thinner as it cracks
  return rgba(r + (255 - r) * 0.35, g + (255 - g) * 0.35, b + (255 - b) * 0.35, 0.46 - 0.08 * s);
}

/** The outline of a tile of colour `color` at damage step `shade` in `style` (neon's bright line; glass and brick share one rim colour). */
export function tileStroke(style: TileStyle, color: string, shade: number): string {
  const s = shade < 0 ? 0 : shade >= TILE_HP_SHADES ? TILE_HP_SHADES - 1 : shade;
  if (style === "brick") return "rgba(20, 12, 8, 0.55)";
  if (style === "glass") return "rgba(255, 255, 255, 0.55)";
  const [r, g, b] = rgbOf(color);
  return rgba(r, g, b, 0.95 - 0.15 * s);
}

/** A hit's flash `ageMs` after it (1 … 0; 0 before and after `TILE_FLASH_MS`). */
export function flashAt(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= TILE_FLASH_MS) return 0;
  return 1 - ageMs / TILE_FLASH_MS;
}

/** A break's fading outline `ageMs` after it: its alpha (0.9 … 0; 0 before and after `TILE_BREAK_MS`). */
export function breakAlpha(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= TILE_BREAK_MS) return 0;
  return 0.9 * (1 - ageMs / TILE_BREAK_MS);
}

/** How much a break's outline has grown `ageMs` after it (× its size: 1 … 1.25, easing out). */
export function breakGrow(ageMs: number): number {
  const u = ageMs >= 0 ? (ageMs < TILE_BREAK_MS ? ageMs / TILE_BREAK_MS : 1) : 0;
  return 1 + 0.25 * (1 - (1 - u) * (1 - u));
}

/** Adds tile `i`'s outline to the current path (a rect, a ring with its hole, or a sector). */
export function traceTile(ctx: CanvasRenderingContext2D, view: TileView, i: number): void {
  if (view.kind[i] === TILE_RECT) {
    ctx.rect(view.x0[i], view.y0[i], view.x1[i] - view.x0[i], view.y1[i] - view.y0[i]);
    return;
  }
  const cx = view.cx[i];
  const cy = view.cy[i];
  const r0 = view.r0[i];
  const r1 = view.r1[i];
  const a0 = view.a0[i];
  const span = view.span[i];
  if (span >= TWO_PI) {
    // a whole ring: the outer circle one way, the hole the other (the non-zero rule leaves it empty)
    ctx.moveTo(cx + r1, cy);
    ctx.arc(cx, cy, r1, 0, TWO_PI);
    if (r0 > 0) {
      ctx.moveTo(cx + r0, cy);
      ctx.arc(cx, cy, r0, TWO_PI, 0, true);
    }
    ctx.closePath();
    return;
  }
  const a1 = a0 + span;
  ctx.moveTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
  ctx.arc(cx, cy, r1, a0, a1);
  if (r0 > 0) ctx.arc(cx, cy, r0, a1, a0, true);
  else ctx.lineTo(cx, cy);
  ctx.closePath();
}

export class TilesLayer {
  private palette: readonly string[] | null = null;
  private style: TileStyle | null = null;
  /** Cached strings, by colour × shade. */
  private fills: string[] = [];
  private strokes: string[] = [];
  private readonly flashes: string[] = [];
  private readonly breaks: string[] = [];
  /** Each tile's batch (colour × shade, −1 broken), reused frame to frame. */
  private group = new Int16Array(0);
  private groupCount = new Int32Array(0);

  constructor() {
    for (let k = 0; k <= FLASH_STEPS; k++) {
      this.flashes.push(rgba(255, 255, 255, (0.7 * k) / FLASH_STEPS));
      this.breaks.push(rgba(255, 255, 255, (0.9 * k) / FLASH_STEPS));
    }
  }

  /** Rebuilds the colour strings when the palette (by reference) or the style changed. */
  private prepare(style: TileStyle, palette: readonly string[]) {
    if (palette === this.palette && style === this.style) return;
    this.palette = palette;
    this.style = style;
    this.fills = [];
    this.strokes = [];
    for (const color of palette) {
      for (let s = 0; s < TILE_HP_SHADES; s++) {
        this.fills.push(tileFill(style, color, s));
        this.strokes.push(tileStroke(style, color, s));
      }
    }
    this.groupCount = new Int32Array(palette.length * TILE_HP_SHADES);
  }

  /** Under the balls: every standing tile (batched), the flashes of the recent hits, the outlines of the recent breaks. */
  draw(ctx: CanvasRenderingContext2D, view: TileView, opts: TilesRenderOptions): void {
    const n = view.count;
    if (n === 0) return;
    const palette = opts.palette && opts.palette.length > 0 ? opts.palette : DEFAULT_TILE_PALETTE;
    const style = opts.style;
    this.prepare(style, palette);
    if (this.group.length < n) this.group = new Int16Array(view.capacity);
    const group = this.group;
    const counts = this.groupCount;
    counts.fill(0);
    const byCol = opts.colorBy === "col";
    const colors = palette.length;
    for (let i = 0; i < n; i++) {
      if (view.alive[i] !== 1) {
        group[i] = -1;
        continue;
      }
      const c = (byCol ? view.col[i] : view.row[i]) % colors;
      const g = c * TILE_HP_SHADES + hpShade(view.hp[i], view.maxHp[i]);
      group[i] = g;
      counts[g]++;
    }
    const width = opts.lineWidth && opts.lineWidth > 0 ? opts.lineWidth : 1.5;
    ctx.save();
    ctx.lineJoin = "round";
    for (let g = 0; g < counts.length; g++) {
      if (counts[g] === 0) continue;
      ctx.beginPath();
      for (let i = 0; i < n; i++) if (group[i] === g) traceTile(ctx, view, i);
      ctx.fillStyle = this.fills[g];
      ctx.fill();
      if (style === "neon") {
        // the glow: a wide faint line under a thin bright one, in the tile's colour
        ctx.strokeStyle = this.strokes[g];
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = width * 4;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
    if (style !== "neon") {
      // glass and brick: one rim (the mortar) round every standing tile
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < n; i++) {
        if (group[i] < 0) continue;
        traceTile(ctx, view, i);
        any = true;
      }
      if (any) {
        ctx.strokeStyle = this.strokes[0];
        ctx.lineWidth = style === "brick" ? width * 1.4 : width * 0.8;
        ctx.stroke();
      }
    }
    // the recent hits flash white; the recent breaks leave a growing, fading outline
    const now = view.clockMs;
    for (let i = 0; i < n; i++) {
      if (view.alive[i] === 1) {
        const f = flashAt(now - view.hitMs[i]);
        if (f <= 0) continue;
        ctx.beginPath();
        traceTile(ctx, view, i);
        ctx.fillStyle = this.flashes[Math.round(f * FLASH_STEPS)];
        ctx.fill();
        continue;
      }
      const age = now - view.brokeMs[i];
      const alpha = breakAlpha(age);
      if (alpha <= 0) continue;
      const grow = breakGrow(age);
      ctx.save();
      ctx.translate(view.px[i], view.py[i]);
      ctx.scale(grow, grow);
      ctx.translate(-view.px[i], -view.py[i]);
      ctx.beginPath();
      traceTile(ctx, view, i);
      ctx.strokeStyle = this.breaks[Math.round((alpha / 0.9) * FLASH_STEPS)];
      ctx.lineWidth = width / grow;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}
