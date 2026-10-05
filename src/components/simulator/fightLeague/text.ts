import { newCanvas, type Sprite } from "./sprites";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's type: the site's own self-hosted families (src/app/fonts.ts, read once from the
 * CSS variables on <html>) – Hanken Grotesk 900 for names (`ui`), Space Grotesk 700 upper case for banners (`display`),
 * JetBrains Mono 800 for HP, the timer, damage and stat values (`mono`) – with the system stacks as the fallback (the
 * tests, a split-screen worker), and the two text caches the renderer draws every letter from:
 *
 *  - `FlTextCache`: an LRU of 160 text sprites keyed by string, size bucket, colour, stroke, glow and device scale, the ink
 *    stroke and the glow baked in (drawn scaled: a pop or a squeeze never builds a new sprite);
 *  - the digit atlas (`FlTextCache.number()`): 0–9 - + × / : . per size bucket and colour, so a damage number, an HP count or
 *    the timer is a few drawImage calls of glyphs that already exist.
 *
 * Nothing is drawn with fillText on the page's canvas: the letters live on the sprites' own canvases.
 */

export type FlFontRole = "ui" | "display" | "mono";

export interface FlFontFamilies {
  ui: string;
  display: string;
  mono: string;
}

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FALLBACK: FlFontFamilies = { ui: SANS, display: SANS, mono: MONO };
/** Each role's weight (the variable fonts hold them all). */
export const FL_FONT_WEIGHT: Readonly<Record<FlFontRole, number>> = { ui: 900, display: 700, mono: 800 };

let families: FlFontFamilies | null = null;
let epoch = 0;
let loaded = false;
let loading: Promise<void> | null = null;

function cssFamilies(): FlFontFamilies {
  try {
    if (typeof document === "undefined" || typeof getComputedStyle !== "function" || !document.documentElement) return FALLBACK;
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    const stack = (ext: string, latin: string, fallback: string) => {
      const own = [v(ext), v(latin)].filter((s) => s.length > 0);
      return own.length > 0 ? `${own.join(", ")}, ${fallback}` : fallback;
    };
    return {
      ui: stack("--font-ui-ext", "--font-ui-latin", SANS),
      display: stack("--font-display-ext", "--font-display-latin", SANS),
      mono: stack("--font-mono-ext", "--font-mono-latin", MONO),
    };
  } catch {
    return FALLBACK;
  }
}

/** The three families (resolved once; again after the fonts have loaded). */
export function flFontFamilies(): FlFontFamilies {
  if (!families) families = cssFamilies();
  return families;
}

/** A canvas font string for `role` at `px`. */
export function flFont(role: FlFontRole, px: number, weight = FL_FONT_WEIGHT[role]): string {
  return `${weight} ${Math.max(1, Math.round(px * 10) / 10)}px ${flFontFamilies()[role]}`;
}

/**
 * Loads the three weights (document.fonts.load) – before the first frame that needs them and before the fast export starts
 * – and bumps the font epoch when they are in, so the text sprites drawn with a fallback are rebuilt. Resolves at once
 * without the Font Loading API (Node).
 */
export function flFontsReady(): Promise<void> {
  if (loading) return loading;
  const fonts = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") {
    loaded = true;
    loading = Promise.resolve();
    return loading;
  }
  const f = flFontFamilies();
  loading = Promise.all([fonts.load(`900 40px ${f.ui}`), fonts.load(`700 40px ${f.display}`), fonts.load(`800 40px ${f.mono}`)])
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      families = null;
      loaded = true;
      epoch++;
    });
  return loading;
}

/** Whether the fonts are in (or there is nothing to wait for). */
export function flFontsLoaded(): boolean {
  return loaded;
}

/** Bumped when the fonts change (the text sprites are rebuilt). */
export function flFontEpoch(): number {
  return epoch;
}

/** How a text is drawn: its family, colour, the ink stroke (a share of the size) and a baked halo. */
export interface FlTextStyle {
  role: FlFontRole;
  color: string;
  stroke: string | null;
  /** The stroke's width outside the letters as a share of the size (0.12 by default). */
  strokeK?: number;
  glow?: string | null;
  weight?: number;
}

/** A text sprite: the raster, its frame (CSS px at its bucket) and the text's own width there. */
interface TextSprite extends Sprite {
  textW: number;
  /** The size (local px) the raster was built for. */
  size: number;
}

/** A glyph strip of the digit atlas. */
interface Atlas {
  canvas: HTMLCanvasElement;
  /** Per glyph: its x on the strip (device px), its advance (local px at `size`). */
  sx: Float64Array;
  adv: Float64Array;
  /** The cell's device width and height, the pad around a glyph (device px). */
  cellW: Float64Array;
  h: number;
  pad: number;
  size: number;
  scale: number;
}

const GLYPHS = "0123456789-+×/:.% ";
const GLYPH_INDEX: Readonly<Record<string, number>> = Object.fromEntries([...GLYPHS].map((c, i) => [c, i]));

/** Device-px size buckets: every px to 24, every 2 to 64, every 4 above. */
function bucketOf(dev: number): number {
  const d = Math.max(6, dev);
  if (d < 24) return Math.round(d);
  if (d < 64) return 2 * Math.round(d / 2);
  return 4 * Math.round(d / 4);
}

export type FlAlign = "left" | "center" | "right";

/**
 * The text sprites and the digit atlases of one layer (per layer, so a test's fresh layer draws its letters fresh). `scale`
 * is the device px per local px of the phase that draws (the world's – dpr × the display scale – or the screen's).
 */
export class FlTextCache {
  /** Device px per local px of the drawing phase (set by the layer before each phase). */
  scale = 1;
  private readonly lru = new Map<string, TextSprite | null>();
  private readonly atlases = new Map<string, Atlas | null>();
  private readonly upper = new Map<string, string>();
  private epoch = -1;
  /** Sprites built so far (the tests and the debug overlay). */
  built = 0;
  /** The context the widths are measured on (one 1 × 1 canvas, kept). */
  private probe: CanvasRenderingContext2D | null = null;

  constructor(private readonly cap = 160) {}

  /** Once per frame: a font change drops every raster. */
  begin() {
    const e = flFontEpoch();
    if (e !== this.epoch) {
      this.epoch = e;
      this.lru.clear();
      this.atlases.clear();
    }
  }

  /** `text` in upper case (memoised: the banners' strings are the same every frame). */
  upperOf(text: string): string {
    let u = this.upper.get(text);
    if (u === undefined) {
      u = text.toLocaleUpperCase();
      if (this.upper.size > 256) this.upper.clear();
      this.upper.set(text, u);
    }
    return u;
  }

  private measure(): CanvasRenderingContext2D | null {
    if (!this.probe) this.probe = newCanvas(1, 1)?.getContext("2d") ?? null;
    return this.probe;
  }

  private sprite(text: string, size: number, style: FlTextStyle): TextSprite | null {
    const dev = size * this.scale;
    const b = bucketOf(dev);
    const strokeK = style.strokeK ?? 0.12;
    const key = `${style.role}|${style.weight ?? 0}|${style.color}|${style.stroke ?? ""}|${strokeK}|${style.glow ?? ""}|${b}|${this.scale}|${text}`;
    const hit = this.lru.get(key);
    if (hit !== undefined) {
      this.lru.delete(key);
      this.lru.set(key, hit);
      return hit;
    }
    while (this.lru.size >= this.cap) {
      const oldest = this.lru.keys().next();
      if (oldest.done) break;
      this.lru.delete(oldest.value);
    }
    const built = this.build(text, b, style, strokeK);
    this.lru.set(key, built);
    return built;
  }

  private build(text: string, b: number, style: FlTextStyle, strokeK: number): TextSprite | null {
    const pg = this.measure();
    if (!pg) return null;
    const font = flFont(style.role, b, style.weight ?? FL_FONT_WEIGHT[style.role]);
    pg.font = font;
    const tw = Math.max(1, pg.measureText(text).width);
    const sw = style.stroke ? Math.max(1.5, 2 * strokeK * b) : 0;
    const glowR = style.glow ? 0.35 * b : 0;
    const pad = Math.ceil(sw / 2 + glowR + 2);
    const w = Math.ceil(tw + 2 * pad);
    const h = Math.ceil(1.3 * b + 2 * pad);
    const canvas = newCanvas(w, h);
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return null;
    g.font = font;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    const y = h / 2 + 0.04 * b;
    if (style.glow) {
      // the halo: the letters' own shadow, blurred once here (never on the page's canvas)
      g.shadowColor = style.glow;
      g.shadowBlur = glowR;
      g.fillStyle = style.glow;
      g.fillText(text, pad, y);
      g.shadowBlur = 0;
      g.shadowColor = "rgba(0, 0, 0, 0)";
    }
    if (style.stroke) {
      g.strokeStyle = style.stroke;
      g.lineWidth = sw;
      g.strokeText(text, pad, y);
    }
    g.fillStyle = style.color;
    g.fillText(text, pad, y);
    this.built++;
    const k = 1 / this.scale;
    return { canvas, x0: -pad * k, y0: -(h / 2) * k, w: w * k, h: h * k, textW: tw * k, size: b * k };
  }

  /** The width `text` takes at `size` (local px). */
  width(text: string, size: number, style: FlTextStyle): number {
    const s = this.sprite(text, size, style);
    return s ? s.textW * (size / s.size) : 0.6 * size * text.length;
  }

  /**
   * Draws `text` with its middle at `y` – left-aligned at, centred on or right-aligned to `x` – at `size` (× `pop`),
   * squeezed to `maxWidth` when wider, at `alpha`. Returns the width drawn.
   */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, style: FlTextStyle, align: FlAlign = "center", maxWidth = 0, alpha = 1, pop = 1): number {
    if (!text || !(size > 0) || !(alpha > 0)) return 0;
    const s = this.sprite(text, size, style);
    if (!s) return 0;
    let k = (size * pop) / s.size;
    let tw = s.textW * k;
    if (maxWidth > 0 && tw > maxWidth) {
      k *= maxWidth / tw;
      tw = maxWidth;
    }
    const ax = align === "left" ? x : align === "right" ? x - tw : x - tw / 2;
    if (alpha < 1) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * alpha;
      ctx.drawImage(s.canvas, ax + s.x0 * k, y + s.y0 * k, s.w * k, s.h * k);
      ctx.globalAlpha = a;
    } else ctx.drawImage(s.canvas, ax + s.x0 * k, y + s.y0 * k, s.w * k, s.h * k);
    return tw;
  }

  private atlas(size: number, color: string, stroke: string | null): Atlas | null {
    const b = bucketOf(size * this.scale);
    const key = `${b}|${color}|${stroke ?? ""}|${this.scale}`;
    const hit = this.atlases.get(key);
    if (hit !== undefined) return hit;
    if (this.atlases.size >= 40) {
      const oldest = this.atlases.keys().next();
      if (!oldest.done) this.atlases.delete(oldest.value);
    }
    const built = this.buildAtlas(b, color, stroke);
    this.atlases.set(key, built);
    return built;
  }

  private buildAtlas(b: number, color: string, stroke: string | null): Atlas | null {
    const pg = this.measure();
    if (!pg) return null;
    const font = flFont("mono", b);
    pg.font = font;
    const n = GLYPHS.length;
    const adv = new Float64Array(n);
    const cellW = new Float64Array(n);
    const sx = new Float64Array(n);
    const sw = stroke ? Math.max(1.5, 0.24 * b) : 0;
    const pad = Math.ceil(sw / 2 + 2);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.max(1, pg.measureText(GLYPHS[i]).width);
      adv[i] = w;
      cellW[i] = Math.ceil(w + 2 * pad);
      sx[i] = x;
      x += cellW[i];
    }
    const h = Math.ceil(1.3 * b + 2 * pad);
    const canvas = newCanvas(x, h);
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return null;
    g.font = font;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (let i = 0; i < n; i++) {
      const ch = GLYPHS[i];
      if (ch === " ") continue;
      const gx = sx[i] + pad;
      if (stroke) {
        g.strokeStyle = stroke;
        g.lineWidth = sw;
        g.strokeText(ch, gx, h / 2 + 0.04 * b);
      }
      g.fillStyle = color;
      g.fillText(ch, gx, h / 2 + 0.04 * b);
    }
    this.built++;
    const k = 1 / this.scale;
    for (let i = 0; i < n; i++) adv[i] *= k;
    return { canvas, sx, adv, cellW, h, pad, size: b * k, scale: this.scale };
  }

  /** The width of a number string drawn from the atlas at `size`. */
  numberWidth(text: string, size: number, color: string, stroke: string | null): number {
    const a = this.atlas(size, color, stroke);
    if (!a) return 0.6 * size * text.length;
    const k = size / a.size;
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const gi = GLYPH_INDEX[text[i]];
      w += (gi === undefined ? a.adv[0] : a.adv[gi]) * k;
    }
    return w;
  }

  /**
   * Draws a number string (digits and - + × / : . %) from the digit atlas with its middle at `y`, aligned to `x`, at `size`
   * (× `pop`) and `alpha`: one drawImage a glyph. Returns the width drawn.
   */
  number(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, stroke: string | null, align: FlAlign = "center", alpha = 1, pop = 1): number {
    if (!text || !(size > 0) || !(alpha > 0)) return 0;
    const a = this.atlas(size, color, stroke);
    if (!a) return 0;
    const k = (size * pop) / a.size;
    let tw = 0;
    for (let i = 0; i < text.length; i++) {
      const gi = GLYPH_INDEX[text[i]];
      tw += (gi === undefined ? a.adv[0] : a.adv[gi]) * k;
    }
    let cx = align === "left" ? x : align === "right" ? x - tw : x - tw / 2;
    const dk = k / a.scale;
    const prev = ctx.globalAlpha;
    if (alpha < 1) ctx.globalAlpha = prev * alpha;
    for (let i = 0; i < text.length; i++) {
      const gi = GLYPH_INDEX[text[i]] ?? 0;
      const advance = a.adv[gi] * k;
      if (text[i] !== " ") ctx.drawImage(a.canvas, a.sx[gi], 0, a.cellW[gi], a.h, cx - a.pad * dk, y - (a.h / 2) * dk, a.cellW[gi] * dk, a.h * dk);
      cx += advance;
    }
    if (alpha < 1) ctx.globalAlpha = prev;
    return tw;
  }

  clear() {
    this.lru.clear();
    this.atlases.clear();
  }
}

/** The numbers as strings, built once ("0"…"999"), and damage, heal and multiplier texts ("-0"…"-999", "+0"…, "×2"…). */
export const NUM_TEXT: readonly string[] = Array.from({ length: 1000 }, (_, i) => String(i));
export const DMG_TEXT: readonly string[] = Array.from({ length: 1000 }, (_, i) => `-${i}`);
export const HEAL_TEXT: readonly string[] = Array.from({ length: 1000 }, (_, i) => `+${i}`);
export const MULT_TEXT: readonly string[] = Array.from({ length: 100 }, (_, i) => `×${i}`);

/** "-n" for a damage value (one decimal under 1). */
export function damageText(value: number): string {
  if (value >= 1) return DMG_TEXT[Math.min(DMG_TEXT.length - 1, Math.round(value))] ?? `-${Math.round(value)}`;
  return `-${value.toFixed(1)}`;
}
