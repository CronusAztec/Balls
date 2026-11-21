import { FINALE_DAMP_SEC, SHAKE_SEC, plateWave, type SandFigure, type SandPlateFrame, type SandPlateView } from "@/lib/physics/modes/sandPlate";
import type { LiveHud } from "@/lib/watermark/liveLayout";

/**
 * Canvas drawing of Sand Plate (feature sand-plate, lib/physics/modes/sandPlate.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls (the plate – a dark square of metal tinted by the ringing note, with a bolt in its middle and a rim that glows in the
 * ringing note's colour as hard as the sand moves; the parts of the plate that shake glow in the note's colour, the lobes that
 * rise and the ones that fall taking turns about once a second and all of them flashing at every strike, so the plate is seen
 * to vibrate and the sand visibly runs from the glow to the dark still lines – and the grains: little
 * squares, white while they fly, warm while they slide, and in the note's own colour once they rest on its lines; a flying
 * grain pale and faint), `drawEffects()` over the balls (the chord's flash on the
 * plate) and `drawOverlay()` in screen space (the note dots under the plate: a staircase rising with the scale, lit in each
 * note's colour as it rings). From the full chord on, colour floods out from the plate's middle: every grain it reaches takes
 * the hue of where it lies, every note's colour at once, so the last figure tops the run, and the plate rises and shrinks a
 * little (`drawnFrame()`) so the end banner under it covers none of the last figure. The placeholder ball is not drawn.
 * Everything comes from the view (the grains, their heat, the run's clock), so a pause freezes it, a recording replays it and
 * the fast export draws the same frame; nothing is allocated per frame (the colours are kept, the grains batched into one
 * path per colour, the glow painted once a note into a small cached image and scaled) and nothing is blurred. The end's words
 * are the canvas' shared end banner's (endBanner.ts), shown from `BANNER_AFTER_SEC` after the chord (`sandPlateBannerShows()`).
 */

export interface SandPlateLabels {
  /** The end banner's title. */
  doneTitle: string;
  /** The end banner's second line. */
  doneSub: (notes: number) => string;
}

export const DEFAULT_SAND_PLATE_LABELS: SandPlateLabels = {
  doneTitle: "THE FINAL SHAPE",
  doneSub: (notes) => `${notes} notes, ${notes} shapes`,
};

/** The notes' hues (degrees), low to high: a run of N notes spreads its notes over them. */
export const NOTE_HUES = [32, 12, 345, 320, 290, 262, 228, 200, 182, 160, 128, 52] as const;
/** The grain's side (px at the tuned 450 px square): 2.5 px, about 6 px on a 1080 frame. */
export const GRAIN_PX = 2.5;
/** A flying grain is drawn this faint: the lines the sand rests on lead the picture, the spray around them follows. */
export const FLYING_ALPHA = 0.55;
/** The chord's flash on the plate (s), and how long the colour takes to flood from the middle to the corners (s). */
export const FLASH_SEC = 0.55;
export const FLOOD_SEC = 0.9;
/** Rainbow bands of the flood (one colour batch each). */
const FLOOD_BANDS = 12;

// --- review fix (C3) --- the ringing plate's glow, and the room the end banner takes
/** The glow's cached image (px a side, twice: the rising lobes, then the falling ones): a note's w painted once, scaled up smooth over the plate. */
export const GLOW_RES = 48;
/** The glow's opacity: its steady hum, a strike's flash and its decay (s), the most. */
export const GLOW_HUM = 0.34;
export const GLOW_FLASH = 0.2;
export const GLOW_FLASH_SEC = 0.25;
export const GLOW_MAX = 0.55;
/** After the chord: the plate rises and shrinks over LIFT_SEC to LIFT_SIDE of the square, its top LIFT_TOP under the square's. */
export const LIFT_SEC = 0.6;
export const LIFT_SIDE = 0.72;
export const LIFT_TOP = 0.03;
/** The end banner comes in this long after the chord, as the plate has nearly risen out of its way. */
export const BANNER_AFTER_SEC = 0.45;

/** 0 → 1 with a soft start and end. */
function smooth(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}

/**
 * Where the plate is drawn this frame, written into `out`: the mode's frame, except from the chord on, when it rises and
 * shrinks over LIFT_SEC so the end banner at the foot of the square covers none of the last figure (and, with Loop on, eases
 * back over the shake, so the seam's frame is the start's).
 */
export function drawnFrame(view: SandPlateView, out: SandPlateFrame): SandPlateFrame {
  const f = view.frame;
  out.cx = f.cx;
  out.cy = f.cy;
  out.square = f.square;
  out.left = f.left;
  out.top = f.top;
  out.side = f.side;
  if (view.chordSec < 0) return out;
  let k = smooth((view.localSec - view.chordSec) / LIFT_SEC);
  if (view.shaking) k *= smooth((view.cycleSec - view.localSec) / SHAKE_SEC);
  if (k <= 0) return out;
  const side = f.side + (LIFT_SIDE * f.square - f.side) * k;
  out.side = side;
  out.top = f.top + (f.cy - f.square / 2 + LIFT_TOP * f.square - f.top) * k;
  out.left = f.cx - side / 2;
  return out;
}

/** The end banner shows: from BANNER_AFTER_SEC after the chord, not while a loop shakes the sand loose. */
export function sandPlateBannerShows(view: SandPlateView): boolean {
  return view.chordSec >= 0 && !view.shaking && view.localSec - view.chordSec >= BANNER_AFTER_SEC;
}

/**
 * How strongly the shaking parts of the plate glow now (0 … GLOW_MAX), from the simulation clock: a steady hum, a flash at
 * every strike (a note's bar, a pluck), dying out with the plate's ring after the chord, and none while a loop shakes the
 * sand loose.
 */
export function plateGlow(view: SandPlateView): number {
  if (view.shaking) return 0;
  let g = GLOW_HUM;
  const since = view.strikeSec >= 0 ? view.localSec - view.strikeSec : -1;
  if (since >= 0) g += GLOW_FLASH * Math.exp(-since / GLOW_FLASH_SEC);
  if (view.chordSec >= 0) g *= Math.max(0, 1 - (view.localSec - view.chordSec) / FINALE_DAMP_SEC);
  return Math.max(0, Math.min(GLOW_MAX, g));
}

/**
 * Which lobes glow now, from the simulation clock: +1 the ones where w > 0, −1 the ones where w < 0, between them both at
 * half. The plate swings a whole number of times a note, about once a second, starting on the rising lobes at each note.
 */
export function plateSwing(view: SandPlateView): number {
  const S = view.settings.noteSec;
  const swings = Math.max(1, Math.round(S));
  return Math.cos((2 * Math.PI * swings * (view.localSec - view.noteStartSec)) / S);
}

/** An RGB triple (0–255) of an HSL colour (hue in degrees, saturation and lightness 0–1). */
function hslRgb(h: number, sat: number, l: number): [number, number, number] {
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

type GlowCanvas = HTMLCanvasElement | OffscreenCanvas;

/** A canvas for the glow: an OffscreenCanvas, else a DOM canvas, else none (a headless test draws no glow). */
function createGlowCanvas(width: number, height: number): GlowCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  return null;
}

/** The hue of note `k` of `n` (degrees). */
export function noteHue(k: number, n: number): number {
  if (n <= 1) return NOTE_HUES[0];
  const at = (k / (n - 1)) * (NOTE_HUES.length - 1);
  return NOTE_HUES[Math.max(0, Math.min(NOTE_HUES.length - 1, Math.round(at)))];
}

/** The plate's outline: a square with rounded corners (arcTo, which every canvas has). */
function platePath(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + side, y, x + side, y + side, r);
  ctx.arcTo(x + side, y + side, x, y + side, r);
  ctx.arcTo(x, y + side, x, y, r);
  ctx.arcTo(x, y, x + side, y, r);
  ctx.closePath();
}

/** 1 at `age` 0 falling to 0 at `length` (0 before and after). */
function fade(age: number, length: number): number {
  if (!(age >= 0) || age >= length) return 0;
  return 1 - age / length;
}

export class SandPlateLayer {
  /** The note dots' box (screen px) as drawn this frame, for the live watermark's placement. */
  readonly hudBox = { x: 0, y: 0, w: 0, h: 0 };
  /** Kept colour strings: per hue its resting, sliding and flying grain, and its dot. */
  private readonly colours = new Map<number, { rest: string; warm: string; hot: string; dot: string; glow: string; plate: string }>();
  private readonly floodColours: string[] = [];
  private bucket = new Uint8Array(0);
  /** --- review fix (C3) --- The plate as drawn this frame (drawnFrame()), and the glow's cached image with the figure and hue it shows. */
  private readonly at: SandPlateFrame = { cx: 0, cy: 0, square: 0, left: 0, top: 0, side: 0 };
  private glow: GlowCanvas | null | undefined;
  private glowKey = "";

  /** Paints a figure's glow into the cached image (once a note): the note's colour, as opaque as the plate shakes there, the rising lobes on the left half and the falling ones on the right. */
  private glowImage(fig: SandFigure, hue: number): GlowCanvas | null {
    if (this.glow === undefined) this.glow = createGlowCanvas(2 * GLOW_RES, GLOW_RES);
    const canvas = this.glow;
    if (!canvas) return null;
    const key = `${fig.m},${fig.n},${fig.sign},${fig.mirror ? 1 : 0},${hue}`;
    if (key === this.glowKey) return canvas;
    const g = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!g) return null;
    const W = 2 * GLOW_RES;
    const img = g.createImageData(W, GLOW_RES);
    const [r, gr, b] = hslRgb(hue, 0.85, 0.55);
    for (let j = 0; j < GLOW_RES; j++)
      for (let i = 0; i < GLOW_RES; i++) {
        const w = 0.5 * plateWave(fig, (i + 0.5) / GLOW_RES, (j + 0.5) / GLOW_RES);
        const a = Math.min(1, Math.abs(w));
        const p = 4 * (j * W + (w >= 0 ? i : GLOW_RES + i));
        img.data[p] = r;
        img.data[p + 1] = gr;
        img.data[p + 2] = b;
        img.data[p + 3] = Math.round(255 * a * Math.sqrt(a));
      }
    g.putImageData(img, 0, 0);
    this.glowKey = key;
    return canvas;
  }

  private coloursOf(hue: number) {
    let c = this.colours.get(hue);
    if (!c) {
      c = {
        rest: `hsl(${hue}, 78%, 66%)`,
        warm: `hsl(${hue}, 60%, 82%)`,
        hot: `hsl(${hue}, 45%, 90%)`,
        dot: `hsl(${hue}, 85%, 62%)`,
        glow: `hsla(${hue}, 90%, 62%, 0.55)`,
        plate: `hsl(${hue}, 32%, 10%)`,
      };
      this.colours.set(hue, c);
    }
    return c;
  }

  private flood(i: number): string {
    if (!this.floodColours.length) for (let b = 0; b < FLOOD_BANDS; b++) this.floodColours.push(`hsl(${Math.round((b * 360) / FLOOD_BANDS + 20)}, 88%, 66%)`);
    return this.floodColours[i];
  }

  /** The plate, its glowing rim and the sand. */
  drawWorld(ctx: CanvasRenderingContext2D, view: SandPlateView) {
    const f = drawnFrame(view, this.at);
    if (!(f.side > 0) || view.count === 0) return;
    const scale = f.square / 450;
    const N = view.settings.notes;
    const hue = noteHue(view.note, N);
    const c = this.coloursOf(hue);
    const local = view.localSec;
    const chordAge = view.chordSec >= 0 ? local - view.chordSec : -1;
    ctx.save();
    // the plate: dark metal, a lighter rim, the bolt in its middle
    const r = 0.02 * f.side;
    platePath(ctx, f.left, f.top, f.side, r);
    ctx.fillStyle = c.plate;
    ctx.fill();
    // (--- review fix (C3) --- the shaking parts of the plate glow in the note's colour: the sand runs from the glow to the dark lines)
    const glow = plateGlow(view);
    const fig = view.figures[view.note];
    const glowImage = glow > 0 && fig ? this.glowImage(fig, hue) : null;
    if (glowImage) {
      const swing = plateSwing(view);
      ctx.save();
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = (glow * (1 + swing)) / 2;
      ctx.drawImage(glowImage, 0, 0, GLOW_RES, GLOW_RES, f.left, f.top, f.side, f.side);
      ctx.globalAlpha = (glow * (1 - swing)) / 2;
      ctx.drawImage(glowImage, GLOW_RES, 0, GLOW_RES, GLOW_RES, f.left, f.top, f.side, f.side);
      ctx.restore();
    }
    // the ringing rim: the note's colour, as bright as the plate drives the sand (dark again once the chord has rung)
    const ring = Math.min(1, 0.25 + 0.9 * view.moving * Math.min(1.2, view.drive));
    ctx.lineWidth = Math.max(1.5, 3 * scale);
    ctx.strokeStyle = c.glow;
    ctx.globalAlpha = chordAge >= 0 ? 0.5 + 0.5 * fade(chordAge, FINALE_DAMP_SEC * 2) : ring;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, 1.2 * scale);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.left + f.side / 2, f.top + f.side / 2, 0.014 * f.side, 0, Math.PI * 2);
    ctx.fillStyle = "#3b4352";
    ctx.fill();
    // the sand: one path per colour
    const g = Math.max(1.2, GRAIN_PX * scale);
    const half = g / 2;
    const n = view.count;
    if (this.bucket.length < n) this.bucket = new Uint8Array(n);
    const b = this.bucket;
    const flooding = chordAge >= 0;
    const reach = flooding ? Math.min(1, chordAge / FLOOD_SEC) * 0.75 : 0;
    for (let i = 0; i < n; i++) {
      const x = view.gx[i];
      const y = view.gy[i];
      if (flooding) {
        const dx = x - 0.5;
        const dy = y - 0.5;
        const d = Math.hypot(dx, dy);
        if (d <= reach) {
          // every note's colour at once: the hue of where the grain lies (round the middle), 3 + band
          const a = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5 + 0.6 * d;
          b[i] = 3 + (Math.floor(a * FLOOD_BANDS) % FLOOD_BANDS);
          continue;
        }
      }
      b[i] = view.heat[i];
    }
    const passes = flooding ? 3 + FLOOD_BANDS : 3;
    for (let k = 0; k < passes; k++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (b[i] !== k) continue;
        ctx.rect(f.left + view.gx[i] * f.side - half, f.top + view.gy[i] * f.side - half, g, g);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = k === 0 ? c.rest : k === 1 ? c.warm : k === 2 ? c.hot : this.flood(k - 3);
      ctx.globalAlpha = k === 2 ? FLYING_ALPHA : 1;
      ctx.fill();
    }
    ctx.restore();
  }

  /** The chord's flash over the plate. */
  drawEffects(ctx: CanvasRenderingContext2D, view: SandPlateView) {
    const f = drawnFrame(view, this.at);
    if (!(f.side > 0) || view.chordSec < 0) return;
    const a = fade(view.localSec - view.chordSec, FLASH_SEC);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = 0.42 * a * a;
    ctx.fillStyle = "#fff6dc";
    platePath(ctx, f.left, f.top, f.side, 0.02 * f.side);
    ctx.fill();
    ctx.restore();
  }

  /** Screen space: the note dots under the plate, a staircase rising with the scale. */
  drawOverlay(ctx: CanvasRenderingContext2D, view: SandPlateView) {
    const f = drawnFrame(view, this.at);
    this.hudBox.w = 0;
    if (!(f.side > 0)) return;
    const N = view.settings.notes;
    if (N < 1) return;
    const sq = f.square;
    const width = 0.62 * f.side;
    const gap = N > 1 ? width / (N - 1) : 0;
    const r = Math.max(1, Math.min(0.016 * sq, 0.38 * (gap || 0.04 * sq)));
    const rise = Math.min(0.04 * sq, 0.6 * (gap || 0));
    const x0 = f.left + f.side / 2 - width / 2;
    const yLow = f.top + f.side + 0.075 * sq;
    const tau = view.localSec - view.noteStartSec;
    const pulse = view.chordSec >= 0 ? 0 : fade(tau, 0.6);
    ctx.save();
    for (let k = 0; k < N; k++) {
      const x = N > 1 ? x0 + k * gap : f.left + f.side / 2;
      const y = yLow - (N > 1 ? (k / (N - 1)) * rise : 0);
      ctx.beginPath();
      ctx.arc(x, y, k === view.note ? r * (1 + 0.45 * pulse) : r, 0, Math.PI * 2);
      if (k <= view.note || view.chordSec >= 0) {
        ctx.fillStyle = this.coloursOf(noteHue(k, N)).dot;
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(226, 232, 240, 0.16)";
        ctx.fill();
      }
      if (k === view.note && view.chordSec < 0) {
        ctx.lineWidth = Math.max(1, 0.25 * r);
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.5 + 0.5 * pulse).toFixed(3)})`;
        ctx.stroke();
      }
    }
    ctx.restore();
    this.hudBox.x = x0 - 2 * r;
    this.hudBox.y = yLow - rise - 2 * r;
    this.hudBox.w = width + 4 * r;
    this.hudBox.h = rise + 4 * r;
  }

  /** Reports the note dots to the live watermark's placement (the badge keeps off them; the end banner reports its own plate). */
  noteHud(hud: LiveHud) {
    const box = this.hudBox;
    if (box.w > 0) hud.block(box.x, box.y, box.w, box.h);
  }
}

/** The data-sand-* attributes the canvas mirrors for tools and the smoke test. */
export const SAND_PLATE_DATA_KEYS = ["sandNote", "sandNotes", "sandGrains", "sandMoving", "sandChord", "sandFinished", "sandSeams", "sandSeamError", "sandSounds", "sandFigure"];

/** Writes the view's state into the data-sand-* attributes (`set` only writes a changed value). */
export class SandPlateDataset {
  write(view: SandPlateView, set: (key: string, value: string) => void) {
    const fig = view.figures[view.note];
    set("sandNote", String(view.note));
    set("sandNotes", String(view.settings.notes));
    set("sandGrains", String(view.count));
    set("sandMoving", view.moving.toFixed(2));
    set("sandChord", view.chordSec >= 0 ? "1" : "0");
    set("sandFinished", view.finished ? "1" : "0");
    set("sandSeams", String(view.seams));
    set("sandSeamError", view.seamError.toFixed(6));
    set("sandSounds", String(view.sounds));
    set("sandFigure", fig ? `${fig.m},${fig.n}` : "");
  }
}
