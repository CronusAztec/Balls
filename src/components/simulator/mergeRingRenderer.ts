import { FINAL_HOLD_MS, TIER_EMBLEMS, inChute, tierColor, tierEmblem, type MergeRingView, type TierEmblem } from "@/lib/physics/modes/mergeRing";
import type { Ball } from "@/lib/physics/types";
import { GLOW_REACH, defaultCanvasFactory, fillStrokeGlow, plainOf, plainTransform, rgbOfHex, type CanvasFactory, type Matrix2D } from "./mergeRingGlow";

/**
 * Canvas drawing of Merge Ring (feature merge-ring, lib/physics/modes/mergeRing.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls (the ring's rim: a thin rainbow stroke whose hues turn slowly, open where the chute meets
 * it, flashing white at the final form; the chute walls are the engine's obstacles, drawn by the generic pass),
 * `drawBodies()` over the balls the canvas drew (a dark body with a thin rim and a bright emblem in the tier's colour –
 * the emblems are original vector marks, `drawEmblem()`; the final form pulses), `drawEffects()` over them (the halos
 * expanding out of every merge) and `drawOverlay()` in screen space (the tier ladder along the right side with the
 * reached tiers lit, the caption under the ring, the merge counter and the top tier). Everything animates on the mode's
 * clock (`view.timeMs`), so a pause freezes it and a recording replays it; nothing is allocated per frame (strings cached).
 *
 * Nothing is blurred per frame (the lag fix: a `shadowBlur` draw blurs its whole bounding box – the rim's 90 glowing arcs, a
 * halo the size of the pile, the ladder's lit tiers): the glowing rim is drawn once into an offscreen bitmap (`RimCache`:
 * its alpha with the glow, recoloured with the segments' own colours a fifth a frame), the ladder too
 * (`LadderCache`, redrawn when a tier lights up), and the halos and the final form's flash draw their glow as a gradient
 * annulus with the blur's profile (`fillStrokeGlow()` of mergeRingGlow.ts) – the same pixels within a few levels. The HUD's
 * lines are bitmaps too (`TextSprite`: no font switch a frame).
 */

export interface MergeRingRenderOptions {
  /** The wall colour with an alpha (the rim without the rainbow). */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  /** Paint the dark bodies over the canvas' balls (off while a face, an emoji or an image wears the ball). */
  darkBodies: boolean;
}

export interface MergeRingLabels {
  /** The HUD's title. */
  title: string;
  /** The caption under the ring. */
  caption: string;
  /** "MERGES 7" */
  merges: (n: number) => string;
  /** The top tier's caption. */
  top: string;
  /** The tier's name (1 … 10). */
  tier: (k: number) => string;
  /** The end banners. */
  finalTitle: string;
  finalSub: (merges: number, seconds: string) => string;
  overflowTitle: string;
  overflowSub: (top: string, merges: number) => string;
}

export const DEFAULT_MERGE_RING_LABELS: MergeRingLabels = {
  title: "MERGE RING",
  caption: "Will it merge into its final form?",
  merges: (n) => `MERGES ${n}`,
  top: "TOP",
  tier: (k) => TIER_NAMES[Math.max(0, Math.min(TIER_NAMES.length - 1, k - 1))],
  finalTitle: "FINAL FORM",
  finalSub: (merges, seconds) => `${merges} merges in ${seconds}s`,
  overflowTitle: "OVERFLOW",
  overflowSub: (top, merges) => `Top tier ${top} after ${merges} merges`,
};

/** The English tier names (the page's labels translate them). */
export const TIER_NAMES = ["Dot", "Ring", "Triangle", "Diamond", "Star", "Hexagon", "Crown", "Gem", "Sun", "Infinity"] as const;

/** Degrees the rainbow turns per second, how long a halo shows and how far it grows (× the pair's radius), the rim's flash and the pulse. */
export const RAINBOW_DEG_PER_SEC = 24;
export const HALO_MS = 700;
export const HALO_GROWTH = 2.4;
export const FLASH_MS = 700;
export const PULSE_MS = 900;
export const RIM_SEGMENTS = 90;
const TWO_PI = Math.PI * 2;

/** The hue (degrees) of the rim at `angle` (radians) at time `timeMs`: the colours run once around and turn slowly. */
export function rimHue(angle: number, timeMs: number): number {
  const deg = (angle / TWO_PI) * 360 + (timeMs / 1000) * RAINBOW_DEG_PER_SEC;
  return ((deg % 360) + 360) % 360;
}

/** A halo `ageMs` after its merge: its radius as a multiple of the pair's radius and its alpha; null once it is gone. */
export function haloAt(ageMs: number): { scale: number; alpha: number } | null {
  if (!(ageMs >= 0) || ageMs >= HALO_MS) return null;
  const u = ageMs / HALO_MS;
  const ease = 1 - (1 - u) * (1 - u);
  return { scale: 1 + (HALO_GROWTH - 1) * ease, alpha: 0.9 * (1 - u) };
}

/** The final form's pulse `ageMs` after it appeared: the body's scale (1 at rest). */
export function pulseScale(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= FINAL_HOLD_MS) return 1;
  return 1 + 0.08 * Math.abs(Math.sin((ageMs / PULSE_MS) * Math.PI));
}

/** The colour of the rim at hue `hue` (degrees), as the rim strokes it – one string per tenth of a degree, cached. */
const rimColorCache: string[] = [];
export function rimColor(hue: number): string {
  const tenth = ((Math.round(hue * 10) % 3600) + 3600) % 3600;
  return (rimColorCache[tenth] ??= `hsl(${(tenth / 10).toFixed(1)}, 100%, 62%)`);
}

/** The colour of the rim's segment `i` (of `RIM_SEGMENTS` from `start`, `step` radians each) at `timeMs`. */
function segmentColor(start: number, step: number, i: number, timeMs: number): string {
  return rimColor(rimHue(start + i * step + step / 2, timeMs));
}

/** The points of a regular polygon (or a star, with `inner` < 1) of `n` points and radius `r`, the first point straight up. */
export function polygonPoints(n: number, r: number, inner = 1): number[] {
  const out: number[] = [];
  const steps = inner < 1 ? 2 * n : n;
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i * TWO_PI) / steps;
    const k = inner < 1 && i % 2 === 1 ? inner : 1;
    out.push(k * r * Math.cos(a), k * r * Math.sin(a));
  }
  return out;
}

function path(ctx: CanvasRenderingContext2D, pts: readonly number[], r = 1) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(r * pts[0], r * pts[1]);
    else ctx.lineTo(r * pts[i], r * pts[i + 1]);
  }
  ctx.closePath();
}

/** The emblems' polygons at radius 1 (scaled as they are drawn: no arrays a frame). */
const UNIT_TRIANGLE = polygonPoints(3, 1);
const UNIT_STAR = polygonPoints(5, 1, 0.45);
const UNIT_HEXAGON = polygonPoints(6, 1);

/** Draws the emblem `kind` centred on (x, y), `size` px across (its half-size is the mark's reach), in `color`. */
export function drawEmblem(ctx: CanvasRenderingContext2D, kind: TierEmblem, x: number, y: number, size: number, color: string) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.18 * r);
  switch (kind) {
    case "dot":
      ctx.beginPath();
      ctx.arc(0, 0, 0.55 * r, 0, TWO_PI);
      ctx.fill();
      break;
    case "ring":
      ctx.lineWidth = Math.max(1.2, 0.3 * r);
      ctx.beginPath();
      ctx.arc(0, 0, 0.7 * r, 0, TWO_PI);
      ctx.stroke();
      break;
    case "triangle":
      path(ctx, UNIT_TRIANGLE, r);
      ctx.fill();
      break;
    case "diamond": {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0.7 * r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-0.7 * r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(1, 0.08 * r);
      ctx.beginPath();
      ctx.moveTo(-0.7 * r, 0);
      ctx.lineTo(0.7 * r, 0);
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
      break;
    }
    case "star":
      path(ctx, UNIT_STAR, r);
      ctx.fill();
      break;
    case "hexagon":
      path(ctx, UNIT_HEXAGON, r);
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      path(ctx, UNIT_HEXAGON, 0.45 * r);
      ctx.fill();
      break;
    case "crown": {
      ctx.beginPath();
      ctx.moveTo(-r, 0.7 * r);
      ctx.lineTo(-r, -0.5 * r);
      ctx.lineTo(-0.5 * r, 0.1 * r);
      ctx.lineTo(0, -r);
      ctx.lineTo(0.5 * r, 0.1 * r);
      ctx.lineTo(r, -0.5 * r);
      ctx.lineTo(r, 0.7 * r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.arc(0, 0.35 * r, 0.14 * r, 0, TWO_PI);
      ctx.fill();
      break;
    }
    case "gem": {
      // A cut stone: a flat top, a wide girdle and a point.
      ctx.beginPath();
      ctx.moveTo(-0.55 * r, -0.8 * r);
      ctx.lineTo(0.55 * r, -0.8 * r);
      ctx.lineTo(r, -0.2 * r);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, -0.2 * r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = Math.max(1, 0.08 * r);
      ctx.beginPath();
      ctx.moveTo(-r, -0.2 * r);
      ctx.lineTo(r, -0.2 * r);
      ctx.moveTo(-0.55 * r, -0.8 * r);
      ctx.lineTo(-0.35 * r, -0.2 * r);
      ctx.lineTo(0, r);
      ctx.moveTo(0.55 * r, -0.8 * r);
      ctx.lineTo(0.35 * r, -0.2 * r);
      ctx.lineTo(0, r);
      ctx.stroke();
      break;
    }
    case "sun": {
      ctx.beginPath();
      ctx.arc(0, 0, 0.42 * r, 0, TWO_PI);
      ctx.fill();
      ctx.lineWidth = Math.max(1, 0.14 * r);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * TWO_PI) / 8;
        ctx.moveTo(0.62 * r * Math.cos(a), 0.62 * r * Math.sin(a));
        ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
      }
      ctx.stroke();
      break;
    }
    case "infinity": {
      // A lemniscate: two loops joined in the middle.
      ctx.lineWidth = Math.max(1.2, 0.22 * r);
      ctx.beginPath();
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * TWO_PI;
        const d = 1 + Math.sin(t) * Math.sin(t);
        const px = (r * Math.cos(t)) / d;
        const py = (0.6 * r * Math.sin(t) * Math.cos(t)) / d;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** The glowing rim as `RimCache` draws it: the ring (world units), its arc, the line, the glow (device px) and the colours. */
export interface RimSpec {
  cx: number;
  cy: number;
  radius: number;
  /** The arc (radians, clockwise): the opening is from `end` round to `start` + 2π. */
  start: number;
  end: number;
  width: number;
  /** The glow's `shadowBlur` (device px, > 0). */
  blur: number;
  /** The turning rainbow (`RIM_SEGMENTS` arcs of `rimHue()`), or one arc in `color`. */
  rainbow: boolean;
  color: string;
  timeMs: number;
}

/** Largest bitmap side the rim cache keeps (a huge zoom draws the rim live). */
export const RIM_CACHE_MAX_SIDE = 4096;

/**
 * The glowing rim from an offscreen bitmap in device px. The bitmap is the live drawing made once – the rainbow's 90
 * shadowed arcs in white (their alpha with the glow, exactly as they overlap), or the one arc in the wall colour – and
 * the rainbow is recoloured with the segments' own colours (`recolour()`: the stalest fifth of them a frame at 50–60 fps,
 * the alpha kept), so a frame costs 18 flat fills and one 1:1 blit instead of 90 blurs. It is rebuilt when the ring, the line, the glow, the
 * colour or the scale change – only once the change has held for a frame (a zoom or a resize in progress draws live) –
 * and when the ring has come to rest more than `RIM_SNAP_PX` off the bitmap's baked sub-pixel position (a camera that
 * slides it gets the bitmap at the nearest pixel meanwhile). `draw()` returns false where it cannot help (a rotated or
 * stretched view, no offscreen canvas, a bitmap too big): the caller draws the rim live.
 */
export class RimCache {
  /** Bitmaps built, rainbow recolourings and blits so far (for the tests). */
  builds = 0;
  recolours = 0;
  blits = 0;
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private unavailable = false;
  /** What the bitmap holds: the geometry, the sub-pixel position of the centre, its half size and the rainbow's clock. */
  private built = false;
  private bR = NaN;
  private bW = NaN;
  private bBlur = NaN;
  private bStart = NaN;
  private bEnd = NaN;
  private bRainbow = false;
  private bColor = "";
  private bFx = NaN;
  private bFy = NaN;
  private bHalf = 0;
  /** The rainbow's clock as last coloured, when each fifth of its segments (of `RIM_PHASES`) was coloured, and the fifths owed. */
  private bTime = NaN;
  private readonly phaseMs: number[] = new Array(RIM_PHASES).fill(NaN);
  private credit = 0;
  /** Last frame's request, the ring's centre in device px (a change is built only once it holds). */
  private lR = NaN;
  private lW = NaN;
  private lBlur = NaN;
  private lStart = NaN;
  private lEnd = NaN;
  private lRainbow = false;
  private lColor = "";
  private lCx = NaN;
  private lCy = NaN;

  constructor(private readonly createCanvas: CanvasFactory = defaultCanvasFactory) {}

  /** Draws the rim from the bitmap; false when it did not (the caller draws it live). */
  draw(ctx: CanvasRenderingContext2D, spec: RimSpec): boolean {
    const m = plainTransform(ctx);
    if (!m || this.unavailable) return false;
    const devR = m.k * spec.radius;
    const devW = m.k * spec.width;
    const devCx = m.k * spec.cx + m.e;
    const devCy = m.k * spec.cy + m.f;
    const ix = Math.floor(devCx);
    const iy = Math.floor(devCy);
    const fx = devCx - ix;
    const fy = devCy - iy;
    const color = spec.rainbow ? "" : spec.color;
    const held =
      devR === this.lR &&
      devW === this.lW &&
      spec.blur === this.lBlur &&
      spec.start === this.lStart &&
      spec.end === this.lEnd &&
      spec.rainbow === this.lRainbow &&
      color === this.lColor &&
      Math.abs(devCx - this.lCx) < RIM_HELD_PX &&
      Math.abs(devCy - this.lCy) < RIM_HELD_PX;
    this.lR = devR;
    this.lW = devW;
    this.lBlur = spec.blur;
    this.lStart = spec.start;
    this.lEnd = spec.end;
    this.lRainbow = spec.rainbow;
    this.lColor = color;
    this.lCx = devCx;
    this.lCy = devCy;
    const sameRing = this.built && devR === this.bR && devW === this.bW && spec.blur === this.bBlur && spec.start === this.bStart && spec.end === this.bEnd && spec.rainbow === this.bRainbow && color === this.bColor;
    // the bitmap's centre sits at a whole pixel + its baked fraction: at the nearest pixel to where the ring is now
    let bx = Math.round(devCx - this.bFx);
    let by = Math.round(devCy - this.bFy);
    const off = Math.max(Math.abs(devCx - this.bFx - bx), Math.abs(devCy - this.bFy - by));
    if (!sameRing || (off > RIM_SNAP_PX && held)) {
      // a new ring once it holds (a zoom or a resize in progress draws live), or a ring that came to rest off the bitmap's
      // fraction (a camera slid it): built where it is; sliding, it is blitted at the nearest pixel
      if (held && this.build(spec, devR, devW, fx, fy, color)) {
        bx = ix;
        by = iy;
      } else if (!sameRing) return false;
    }
    bx -= this.bHalf;
    by -= this.bHalf;
    if (spec.rainbow && !this.coloured(spec.timeMs)) this.recolour(spec);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "rgba(0, 0, 0, 0)";
    ctx.drawImage(this.canvas!, bx, by);
    ctx.restore();
    this.blits++;
    return true;
  }

  /** The bitmap for this ring: the live drawing in device px, the centre at its sub-pixel position (`fx`, `fy`). */
  private build(spec: RimSpec, devR: number, devW: number, fx: number, fy: number, color: string): boolean {
    const pad = Math.ceil(devW / 2 + 2 * spec.blur + 3);
    const half = Math.ceil(devR + pad) + 1;
    const size = 2 * half + 2;
    if (size > RIM_CACHE_MAX_SIDE) return false;
    if (!this.canvas) {
      this.canvas = this.createCanvas(size, size);
      this.g = this.canvas?.getContext("2d") ?? null;
      if (!this.canvas || !this.g) {
        this.unavailable = true;
        return false;
      }
    }
    const canvas = this.canvas;
    const g = this.g!;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    // (cleared in device px: clearRect follows the transform)
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.lineCap = "butt";
    g.lineWidth = devW;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = 0;
    g.shadowBlur = spec.blur;
    const ox = half + fx;
    const oy = half + fy;
    if (spec.rainbow) {
      // the segments as the live rim strokes them, in white: the alpha of their strokes and overlapping glows
      g.strokeStyle = "#ffffff";
      g.shadowColor = "#ffffff";
      const step = (spec.end - spec.start) / RIM_SEGMENTS;
      for (let i = 0; i < RIM_SEGMENTS; i++) {
        const a0 = spec.start + i * step;
        g.beginPath();
        g.arc(ox, oy, devR, a0 - 0.004, a0 + step + 0.004);
        g.stroke();
      }
    } else {
      g.strokeStyle = color;
      g.shadowColor = color;
      g.beginPath();
      g.arc(ox, oy, devR, spec.start, spec.end);
      g.stroke();
    }
    g.shadowBlur = 0;
    g.shadowColor = "rgba(0, 0, 0, 0)";
    this.built = true;
    this.bR = devR;
    this.bW = devW;
    this.bBlur = spec.blur;
    this.bStart = spec.start;
    this.bEnd = spec.end;
    this.bRainbow = spec.rainbow;
    this.bColor = color;
    this.bFx = fx;
    this.bFy = fy;
    this.bHalf = half;
    // the new bitmap is white: every fifth is uncoloured, whatever the clock (a rebuild at a frozen clock – before Start,
    // paused, a finished run – must colour it all the same)
    this.bTime = NaN;
    this.phaseMs.fill(NaN);
    this.credit = 0;
    this.builds++;
    return true;
  }

  /** True when every fifth of the rainbow holds the colours of `timeMs`. */
  private coloured(timeMs: number): boolean {
    for (let q = 0; q < RIM_PHASES; q++) if (this.phaseMs[q] !== timeMs) return false;
    return true;
  }

  /** How far (degrees of hue) the stalest fifth of the rainbow is behind the clock at `timeMs` (Infinity when one is uncoloured; for the tests). */
  hueLagDeg(timeMs: number): number {
    let lag = 0;
    for (let q = 0; q < RIM_PHASES; q++) lag = Math.max(lag, fifthLagDeg(this.phaseMs[q], timeMs));
    return lag;
  }

  /**
   * The rainbow's colours over the bitmap's alpha (`source-atop`: the colour taken, the alpha kept): every segment's sector
   * of the ring filled with its colour, from where its live arc starts (overdrawing the last one's end) to where the next one
   * starts, the first and the last reaching to the middle of the opening (each a pixel wider at its sides: no seams). The
   * colours turn slowly (`RAINBOW_DEG_PER_SEC`), so a frame refreshes only the stalest fifths of the segments (`RIM_PHASES`,
   * the fifths in turn) – as many a frame as keep every fifth within `RIM_HUE_LAG_DEG` of the clock at this frame's pace
   * (a fifth may wait k frames while k steps of the hue stay within the lag: one fifth a frame at 50–60 fps, each at most
   * four frames, 1.6°, behind; 5 / k a frame below, spread evenly) – and every one on a build, a jump back of the clock (a
   * restart) or a clock running fast (a seek, 8x). (A fifth costs a raster of its sectors over the bitmap, `source-atop`
   * along the thin slanted band: about the price of the blit itself on a software canvas, so a lower frame rate must not
   * make a frame refresh everything.)
   */
  private recolour(spec: RimSpec): void {
    const t = spec.timeMs;
    const stale = this.phaseMs;
    let pick = 0; // bit q: fifth q is refreshed
    if (!(t >= this.bTime) || !Number.isFinite(this.bTime)) pick = (1 << RIM_PHASES) - 1;
    else {
      // this frame's step of the hue: a fifth may wait `wait` frames, so 5 / wait fifths are owed a frame (one at a standstill)
      const stepDeg = ((t - this.bTime) * RAINBOW_DEG_PER_SEC) / 1000;
      const wait = stepDeg > 0 ? Math.floor(RIM_HUE_LAG_DEG / stepDeg + LAG_EPS) + 1 : Infinity;
      this.credit = Math.min(RIM_PHASES, this.credit + RIM_PHASES / wait);
      // the stalest first (an uncoloured fifth before all), then any other already past the lag
      for (let n = Math.max(1, Math.floor(this.credit)); n > 0; n--) {
        let oldest = -1;
        for (let q = 0; q < RIM_PHASES; q++) if (!(pick & (1 << q)) && (oldest < 0 || fifthLagDeg(stale[q], t) > fifthLagDeg(stale[oldest], t))) oldest = q;
        if (oldest < 0) break;
        pick |= 1 << oldest;
      }
      for (let q = 0; q < RIM_PHASES; q++) if (!(fifthLagDeg(stale[q], t) <= RIM_HUE_LAG_DEG + LAG_EPS)) pick |= 1 << q;
    }
    const g = this.g!;
    const ox = this.bHalf + this.bFx;
    const oy = this.bHalf + this.bFy;
    const step = (spec.end - spec.start) / RIM_SEGMENTS;
    const mid = (spec.start + spec.end) / 2 + Math.PI; // the middle of the opening
    // (the band the line and its glow cover: the blur reaches GLOW_REACH σ past the line's edge, σ = blur / 2)
    const band = this.bW / 2 + (GLOW_REACH * spec.blur) / 2 + 2;
    const r1 = this.bR + band;
    const r0 = Math.max(0, this.bR - band);
    const seam = 1 / Math.max(1, this.bR);
    g.save();
    g.globalCompositeOperation = "source-atop";
    for (let i = 0; i < RIM_SEGMENTS; i++) {
      if (!(pick & (1 << (i % RIM_PHASES)))) continue;
      const a0 = i === 0 ? mid - TWO_PI : spec.start + i * step - 0.004;
      const a1 = i === RIM_SEGMENTS - 1 ? mid : spec.start + (i + 1) * step - 0.004;
      g.fillStyle = segmentColor(spec.start, step, i, t);
      g.beginPath();
      g.arc(ox, oy, r1, a0 - seam, a1 + seam);
      g.arc(ox, oy, r0, a1 + seam, a0 - seam, true);
      g.closePath();
      g.fill();
    }
    g.restore();
    for (let q = 0; q < RIM_PHASES; q++) {
      if (!(pick & (1 << q))) continue;
      stale[q] = t;
      this.credit = Math.max(0, this.credit - 1);
    }
    this.bTime = t;
    this.recolours++;
  }
}

/** The rim's segments are recoloured by fifths (segment i in fifth i mod 5), the stalest a frame; the most of hue (degrees) a fifth may show behind the clock. */
export const RIM_PHASES = 5;
export const RIM_HUE_LAG_DEG = 2;

/** (A frame's rounding at the lag's edge: frame times are not exact, so neither are k steps of the hue.) */
const LAG_EPS = 1e-6;

/** Degrees of hue a fifth coloured at `colouredMs` is behind the clock at `timeMs` (Infinity when it is uncoloured). */
function fifthLagDeg(colouredMs: number, timeMs: number): number {
  return Number.isFinite(colouredMs) ? ((timeMs - colouredMs) * RAINBOW_DEG_PER_SEC) / 1000 : Infinity;
}

/** Device px a ring may move between two frames and still hold (the bitmap is then built there), and may sit off its bitmap's baked position before it is rebuilt. */
export const RIM_HELD_PX = 0.01;
export const RIM_SNAP_PX = 0.1;

/** The tier ladder as `LadderCache` draws it. */
export interface LadderSpec {
  x: number;
  y0: number;
  y1: number;
  size: number;
  tiers: number;
  topTier: number;
}

/** The ladder's lit tiers glow with this `shadowBlur` (device px). */
export const LADDER_GLOW = 10;

/** Draws the tier ladder: tier 1 at `y1`, the final form at `y0`, the reached ones lit (with a glow). */
export function drawLadder(ctx: CanvasRenderingContext2D, spec: LadderSpec) {
  const { x, y0, y1, size, tiers } = spec;
  for (let k = 1; k <= tiers; k++) {
    const y = tiers > 1 ? y1 + ((y0 - y1) * (k - 1)) / (tiers - 1) : (y0 + y1) / 2;
    const lit = k <= spec.topTier;
    ctx.globalAlpha = lit ? 1 : 0.28;
    const color = lit ? tierColor(k) : "#9ca3af";
    if (lit) {
      ctx.shadowColor = color;
      ctx.shadowBlur = LADDER_GLOW;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 0.95 * size, 0, TWO_PI);
    ctx.stroke();
    drawEmblem(ctx, tierEmblem(k), x, y, 1.1 * size, color);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

/**
 * The tier ladder from a bitmap in device px (its lit tiers' glows blurred once), redrawn when a tier lights up or the
 * ladder moves or scales; false where it cannot help (the caller draws it live).
 */
export class LadderCache {
  builds = 0;
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private unavailable = false;
  private key: number[] = [];
  private sx = 0;
  private sy = 0;

  constructor(private readonly createCanvas: CanvasFactory = defaultCanvasFactory) {}

  draw(ctx: CanvasRenderingContext2D, spec: LadderSpec): boolean {
    const m = plainTransform(ctx);
    if (!m || this.unavailable) return false;
    const lit = Math.max(0, Math.min(spec.tiers, Math.floor(spec.topTier)));
    const key = [m.k, m.e, m.f, spec.x, spec.y0, spec.y1, spec.size, spec.tiers, lit];
    if (!this.canvas || key.some((v, i) => v !== this.key[i])) {
      const reach = 1.1 * spec.size + 1;
      const glow = 2 * LADDER_GLOW + 3;
      const left = Math.floor(m.k * (spec.x - reach) + m.e - glow);
      const top = Math.floor(m.k * (Math.min(spec.y0, spec.y1) - reach) + m.f - glow);
      const right = Math.ceil(m.k * (spec.x + reach) + m.e + glow);
      const bottom = Math.ceil(m.k * (Math.max(spec.y0, spec.y1) + reach) + m.f + glow);
      const w = right - left;
      const h = bottom - top;
      if (!(w > 0 && h > 0) || w > RIM_CACHE_MAX_SIDE || h > RIM_CACHE_MAX_SIDE) return false;
      if (!this.canvas) {
        this.canvas = this.createCanvas(w, h);
        this.g = this.canvas?.getContext("2d") ?? null;
        if (!this.canvas || !this.g) {
          this.unavailable = true;
          return false;
        }
      }
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const g = this.g!;
      // cleared in device px (clearRect follows the transform: under the last build's, the clear would miss the bitmap and
      // the new ladder would be drawn over the old one), then drawn in the page's units
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      g.setTransform(m.k, 0, 0, m.k, m.e - left, m.f - top);
      g.globalCompositeOperation = "source-over";
      g.lineJoin = "round";
      g.shadowOffsetX = 0;
      g.shadowOffsetY = 0;
      drawLadder(g, { ...spec, topTier: lit });
      this.key = key;
      this.sx = left;
      this.sy = top;
      this.builds++;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "rgba(0, 0, 0, 0)";
    ctx.drawImage(this.canvas!, this.sx, this.sy);
    ctx.restore();
    return true;
  }
}

/**
 * One line of the HUD from a bitmap in device px: the line drawn once with `fillText` at the device scale and the sub-pixel
 * position the canvas would draw it at (the same glyphs, grey-scale anti-aliased as on the transparent canvas), blitted 1:1
 * at whole device px; redrawn when the text, its font, colour, alignment, the scale or the position's fraction change.
 * (Every `font` switch makes a canvas resolve the font again – the HUD's five fonts a frame cost the overlay more than all
 * its drawing.) `draw()` returns false where it cannot help (a rotated or stretched view, a shadow, another composite, no
 * offscreen canvas): the caller draws the text live.
 */
export class TextSprite {
  builds = 0;
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private unavailable = false;
  private kText = "";
  private kFont = "";
  private kFill = "";
  private kAlign = "";
  private kBase = "";
  private kK = NaN;
  private kFx = NaN;
  private kFy = NaN;
  /** The anchor's whole device px in the bitmap. */
  private ax = 0;
  private ay = 0;

  constructor(private readonly createCanvas: CanvasFactory = defaultCanvasFactory) {}

  /** Draws `text` as `fillText(text, x, y)` would with `font` and `fill` (the context's alignment); `M` is its transform (`getTransform()`). */
  draw(ctx: CanvasRenderingContext2D, M: Matrix2D | null, text: string, font: string, fill: string, size: number, x: number, y: number): boolean {
    const m = plainOf(M);
    if (!m || this.unavailable || !text) return false;
    const shadow = ctx.shadowColor !== "rgba(0, 0, 0, 0)" && (ctx.shadowBlur > 0 || ctx.shadowOffsetX !== 0 || ctx.shadowOffsetY !== 0);
    if (shadow || ctx.globalCompositeOperation !== "source-over") return false;
    const X = m.k * x + m.e;
    const Y = m.k * y + m.f;
    const ix = Math.floor(X);
    const iy = Math.floor(Y);
    const fx = X - ix;
    const fy = Y - iy;
    const align = ctx.textAlign;
    const base = ctx.textBaseline;
    if (!this.canvas || text !== this.kText || font !== this.kFont || fill !== this.kFill || align !== this.kAlign || base !== this.kBase || m.k !== this.kK || fx !== this.kFx || fy !== this.kFy) {
      if (!this.build(text, font, fill, align, base, size, m.k, fx, fy)) return false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.canvas!, ix - this.ax, iy - this.ay);
    ctx.setTransform(M!.a, M!.b, M!.c, M!.d, M!.e, M!.f);
    return true;
  }

  private build(text: string, font: string, fill: string, align: CanvasTextAlign, base: CanvasTextBaseline, size: number, k: number, fx: number, fy: number): boolean {
    if (!this.canvas) {
      this.canvas = this.createCanvas(8, 8);
      this.g = this.canvas?.getContext("2d") ?? null;
      if (!this.canvas || !this.g) {
        this.unavailable = true;
        return false;
      }
    }
    const canvas = this.canvas;
    const g = this.g!;
    const style = () => {
      g.font = font;
      g.textAlign = align;
      g.textBaseline = base;
    };
    style();
    // the ink's extent round the anchor (font px; generous where the browser does not measure it)
    const mt = g.measureText(text);
    const w = Number.isFinite(mt.width) ? mt.width : text.length * size;
    const fit = (v: number | undefined, guess: number) => (Number.isFinite(v) ? Math.max(0, v!) : guess);
    const left = fit(mt.actualBoundingBoxLeft, align === "right" || align === "end" ? w + size : align === "center" ? w / 2 + size : size);
    const right = fit(mt.actualBoundingBoxRight, align === "right" || align === "end" ? size : align === "center" ? w / 2 + size : w + size);
    const ascent = fit(mt.actualBoundingBoxAscent, 1.5 * size);
    const descent = fit(mt.actualBoundingBoxDescent, 1.5 * size);
    const pad = 3;
    const ax = pad + Math.ceil(k * left);
    const ay = pad + Math.ceil(k * ascent);
    const bw = ax + Math.ceil(k * right) + pad + 1;
    const bh = ay + Math.ceil(k * descent) + pad + 1;
    if (!(bw > 0 && bh > 0) || bw > RIM_CACHE_MAX_SIDE || bh > RIM_CACHE_MAX_SIDE) return false;
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      style(); // (a new size resets the context)
    } else {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, bw, bh);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.shadowBlur = 0;
    g.fillStyle = fill;
    g.setTransform(k, 0, 0, k, ax + fx, ay + fy);
    g.fillText(text, 0, 0);
    this.ax = ax;
    this.ay = ay;
    this.kText = text;
    this.kFont = font;
    this.kFill = fill;
    this.kAlign = align;
    this.kBase = base;
    this.kK = k;
    this.kFx = fx;
    this.kFy = fy;
    this.builds++;
    return true;
  }
}

/** The halos' glow (`shadowBlur`, device px), and the radius (device px) from which it is drawn as a gradient (below it the blur's box is small: cheaper blurred). */
export const HALO_GLOW = 12;
export const HALO_GRADIENT_FROM = 96;

/** Device px a shadow-only draw moves its shape out of the canvas by (its shadow is offset back by as much). */
const SHADOW_ONLY_SHIFT = 32768;

/**
 * The glow round one end of the flashing rim: the real shadow of the arc's last piece (`a0` … `a1`, as far back as the blur
 * reaches), the piece itself drawn far off the canvas (only its shadow lands), inside the wedge from `w0` to `w1` – where
 * the glow along the arc stops and the opening begins. Its blur's box is small: a piece, not the whole ring.
 */
function flashEndGlow(ctx: CanvasRenderingContext2D, k: number, cx: number, cy: number, r: number, reach: number, stroke: string, lw: number, blur: number, a0: number, a1: number, w0: number, w1: number) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, reach, w0, w1);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.lineCap = "butt";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = SHADOW_ONLY_SHIFT;
  ctx.shadowOffsetY = 0;
  ctx.beginPath();
  ctx.arc(cx - SHADOW_ONLY_SHIFT / k, cy, r, a0, a1);
  ctx.stroke();
  ctx.restore();
}

export class MergeRingLayer {
  /** "MERGES 7" by count, so a frame builds none. */
  private mergesKey = -1;
  private mergesText = "";
  private topKey = -1;
  private topText = "";
  private readonly tierText: string[] = [];
  /** The HUD's fonts for a font size, so a frame builds none. */
  private fontFs = -1;
  private fontCfs = -1;
  private readonly fonts = { title: "", merges: "", top: "", tier: "", caption: "" };
  /** The glowing rim's and the ladder's bitmaps, and the HUD's lines (title, merges, "TOP", the top tier, the caption). */
  readonly rim: RimCache;
  readonly ladder: LadderCache;
  readonly texts: TextSprite[];

  constructor(createCanvas: CanvasFactory = defaultCanvasFactory) {
    this.rim = new RimCache(createCanvas);
    this.ladder = new LadderCache(createCanvas);
    this.texts = [0, 1, 2, 3, 4].map(() => new TextSprite(createCanvas));
  }

  /** The rim (under the balls): the rainbow (or the wall colour), open at the chute, flashing white at the final form. */
  drawWorld(ctx: CanvasRenderingContext2D, view: MergeRingView, opts: MergeRingRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    const R = L.radius;
    // The opening: the arc between the chute walls (around straight up).
    const half = Math.asin(Math.min(1, L.chuteHalf / R));
    const start = -Math.PI / 2 + half;
    const end = -Math.PI / 2 - half + TWO_PI;
    const width = Math.max(1.5, opts.wallThickness);
    const rainbow = view.settings.rainbow;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineWidth = width;
    // The glowing rim from its bitmap (the glow is blurred once, not every frame); live without the glow or where the bitmap cannot help.
    const cached = opts.showWallGlow && this.rim.draw(ctx, { cx: L.cx, cy: L.cy, radius: R, start, end, width, blur: 3 * width + 6, rainbow, color: rainbow ? "" : opts.wallAlpha(0.9), timeMs: now });
    if (!cached) {
      if (opts.showWallGlow) {
        ctx.shadowBlur = 3 * width + 6;
      }
      if (rainbow) {
        const step = (end - start) / RIM_SEGMENTS;
        for (let i = 0; i < RIM_SEGMENTS; i++) {
          const a0 = start + i * step;
          const a1 = a0 + step;
          const color = segmentColor(start, step, i, now);
          ctx.strokeStyle = color;
          ctx.shadowColor = color;
          ctx.beginPath();
          ctx.arc(L.cx, L.cy, R, a0 - 0.004, a1 + 0.004);
          ctx.stroke();
        }
      } else {
        const color = opts.wallAlpha(0.9);
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.arc(L.cx, L.cy, R, start, end);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    // The final form: the rim flashes white and fades back – its glow a gradient with the blur's profile along the arc and
    // the blur itself only round the arc's two ends (where it wraps into the opening), under the stroke.
    const fAge = now - view.finalMs;
    if (view.finalMs >= 0 && fAge >= 0 && fAge < FLASH_MS) {
      const f = 1 - fAge / FLASH_MS;
      const lw = width + 6 * f;
      const blur = opts.showWallGlow ? 24 * f : 0;
      const stroke = `rgba(255, 255, 255, ${(0.95 * f).toFixed(3)})`;
      const m = blur > 0 ? plainTransform(ctx) : null;
      let glowDrawn = false;
      if (m) {
        // the ends' share: as far along the arc as the blur reaches
        const cap = Math.min(0.25 * (end - start), (GLOW_REACH * blur) / 2 / m.k / R);
        ctx.globalAlpha = 0.95 * f;
        glowDrawn = fillStrokeGlow(ctx, m.k, L.cx, L.cy, R, lw, blur, "255, 255, 255", start + cap, end - cap);
        ctx.globalAlpha = 1;
        if (glowDrawn) {
          const gap = (start + TWO_PI - end) / 2;
          const reach = R + lw + (2 * blur) / m.k;
          flashEndGlow(ctx, m.k, L.cx, L.cy, R, reach, stroke, lw, blur, end - 2 * cap, end, end - cap, end + gap);
          flashEndGlow(ctx, m.k, L.cx, L.cy, R, reach, stroke, lw, blur, start, start + 2 * cap, start - gap, start + cap);
        }
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = glowDrawn ? 0 : blur;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, R, start, end);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /** Over the balls the canvas drew: the dark bodies, their rims and their emblems (the final form pulsing). */
  drawBodies(ctx: CanvasRenderingContext2D, view: MergeRingView, balls: readonly Ball[], opts: MergeRingRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    ctx.save();
    ctx.globalAlpha = 1;
    for (const ball of balls) {
      const tier = view.tierOf.get(ball.id);
      if (tier === undefined) continue;
      const color = tierColor(tier);
      const pulse = ball.id === view.finalId ? pulseScale(now - view.finalMs) : 1;
      const r = ball.radius * pulse;
      if (opts.darkBodies) {
        ctx.fillStyle = "#0b0b10";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, Math.max(0.5, r - 0.5), 0, TWO_PI);
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, 0.09 * r);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, Math.max(0.5, r - 0.6 * ctx.lineWidth), 0, TWO_PI);
      ctx.stroke();
      if (opts.darkBodies) drawEmblem(ctx, tierEmblem(tier), ball.x, ball.y, 1.1 * r, color);
      else drawEmblem(ctx, tierEmblem(tier), ball.x, ball.y - 0.35 * r, 0.6 * r, "#ffffff");
    }
    ctx.restore();
  }

  /** Over the balls: the halos of the merges (a big one's glow a gradient with the blur's profile, a small one's the shadow itself). */
  drawEffects(ctx: CanvasRenderingContext2D, view: MergeRingView) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    let m: ReturnType<typeof plainTransform> | undefined;
    ctx.save();
    const lw = Math.max(1.5, 0.004 * L.side);
    for (let i = 0; i < view.haloMs.length; i++) {
      const h = haloAt(now - view.haloMs[i]);
      if (!h) continue;
      const color = tierColor(view.haloTier[i]);
      const x = view.haloX[i];
      const y = view.haloY[i];
      const r = view.haloR[i] * h.scale;
      ctx.globalAlpha = h.alpha;
      if (m === undefined) m = plainTransform(ctx);
      const rgb = m ? rgbOfHex(color) : null;
      const glowDrawn = !!m && !!rgb && fillStrokeGlow(ctx, m.k, x, y, r, lw, HALO_GLOW, rgb, 0, TWO_PI, HALO_GRADIENT_FROM);
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = glowDrawn ? 0 : HALO_GLOW;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Screen space: the title and the merge counter in the top-left corner of the square, the top tier in the top-right one,
   * the tier ladder along the right side of the ring and the caption under it; `inset` moves the corners below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: MergeRingView, labels: MergeRingLabels, inset = 0) {
    const L = view.layout;
    if (!L) return;
    const side = L.side;
    const fs = Math.max(11, 0.03 * side);
    const top = L.top + 0.02 * side + inset;
    const pad = 0.04 * side;
    const right = L.left + side;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const cfs = Math.max(11, 0.034 * side);
    const F = this.fontsFor(fs, cfs);
    // (the lines from their bitmaps: no font switch a frame)
    const M = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
    // The corners.
    ctx.textAlign = "left";
    this.text(ctx, M, 0, labels.title, F.title, "rgba(255, 255, 255, 0.8)", fs, L.left + pad, top + 0.5 * fs);
    if (view.merges !== this.mergesKey) {
      this.mergesKey = view.merges;
      this.mergesText = labels.merges(view.merges);
    }
    this.text(ctx, M, 1, this.mergesText, F.merges, "#f472b6", fs, L.left + pad, top + 1.6 * fs);
    ctx.textAlign = "right";
    this.text(ctx, M, 2, labels.top, F.top, "rgba(255, 255, 255, 0.8)", fs, right - pad, top + 0.5 * fs);
    const topTier = Math.max(1, view.topTier);
    if (topTier !== this.topKey) {
      this.topKey = topTier;
      this.topText = labels.tier(topTier);
    }
    this.text(ctx, M, 3, this.topText, F.tier, tierColor(topTier), fs, right - pad, top + 1.7 * fs);
    // The ladder: tier 1 at the bottom, the final form at the top, the reached ones lit (from its bitmap: the glows blurred once).
    const tiers = Math.max(1, Math.min(TIER_EMBLEMS.length, view.settings.tiers));
    const size = Math.max(6, Math.min(0.032 * side, (1.6 * L.radius) / (tiers * 1.5)));
    const x = L.cx + L.radius + 0.5 * (right - (L.cx + L.radius));
    const ladder: LadderSpec = { x, y0: L.cy - 0.8 * L.radius, y1: L.cy + 0.8 * L.radius, size, tiers, topTier: view.topTier };
    if (!this.ladder.draw(ctx, ladder)) drawLadder(ctx, ladder);
    ctx.globalAlpha = 1;
    // The caption under the ring.
    ctx.textAlign = "center";
    this.text(ctx, M, 4, labels.caption, F.caption, "rgba(255, 255, 255, 0.9)", cfs, L.cx, Math.min(L.top + side - 0.6 * cfs, L.cy + L.radius + 0.045 * side + 0.5 * cfs));
    ctx.restore();
  }

  /** One line of the HUD: from its bitmap (`TextSprite`), or live where the bitmap cannot help. */
  private text(ctx: CanvasRenderingContext2D, M: Matrix2D | null, slot: number, text: string, font: string, fill: string, size: number, x: number, y: number) {
    if (this.texts[slot].draw(ctx, M, text, font, fill, size, x, y)) return;
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  /** The HUD's fonts for the corner size `fs` and the caption size `cfs` (rebuilt when the layout changes). */
  private fontsFor(fs: number, cfs: number) {
    if (fs !== this.fontFs || cfs !== this.fontCfs) {
      this.fontFs = fs;
      this.fontCfs = cfs;
      this.fonts.title = `800 ${(0.8 * fs).toFixed(1)}px sans-serif`;
      this.fonts.merges = `700 ${(0.75 * fs).toFixed(1)}px sans-serif`;
      this.fonts.top = `800 ${(0.7 * fs).toFixed(1)}px sans-serif`;
      this.fonts.tier = `900 ${(1.05 * fs).toFixed(1)}px sans-serif`;
      this.fonts.caption = `600 ${cfs.toFixed(1)}px sans-serif`;
    }
    return this.fonts;
  }

  /** The names of the tiers as the labels give them, cached. */
  tierName(labels: MergeRingLabels, k: number): string {
    return (this.tierText[k] ??= labels.tier(k));
  }
}

/**
 * True when the canvas' colour trail of `ball` (strokes up to `trailThickness` × its radius wide, ending at the trail's points)
 * lies wholly under the opaque dark body `drawBodies()` paints over it – every pixel it touches fully covered (`k`: device px
 * per unit) – so drawing it would change nothing: a ball resting in the pile.
 */
export function trailUnderBody(ball: Pick<Ball, "x" | "y" | "radius" | "trail">, trailThickness: number, k: number): boolean {
  if (!(k > 0) || ball.trail.length === 0) return false;
  // the dark body's radius (r − 0.5; the final form's pulse only grows it), less a stroke's reach past its points (a square
  // cap's corner) and a pixel and a half of anti-aliasing
  const reach = ball.radius - 0.5 - Math.SQRT2 * 0.5 * ball.radius * trailThickness - 1.5 / k;
  if (!(reach > 0)) return false;
  const reach2 = reach * reach;
  for (const p of ball.trail) {
    const dx = p.x - ball.x;
    const dy = p.y - ball.y;
    if (!(dx * dx + dy * dy <= reach2)) return false;
  }
  return true;
}

/**
 * True when one stroke of a colour trail – the segment from (`ax`, `ay`) to (`bx`, `by`), `width` wide, any cap – lies
 * wholly under the opaque dark body of `ball` (`k`: device px per unit), so drawing it would change nothing: the newest,
 * thickest strokes of a moving ball's trail, all of a resting one's. (The stroke is within its ends' squares of half-size
 * `width` / 2, so within √2 · `width` / 2 of an end; the body is convex.)
 */
export function trailStrokeUnderBody(ball: Pick<Ball, "x" | "y" | "radius">, ax: number, ay: number, bx: number, by: number, width: number, k: number): boolean {
  if (!(k > 0)) return false;
  const reach = ball.radius - 0.5 - Math.SQRT2 * 0.5 * width - 1.5 / k;
  if (!(reach > 0)) return false;
  const reach2 = reach * reach;
  let dx = ax - ball.x;
  let dy = ay - ball.y;
  if (!(dx * dx + dy * dy <= reach2)) return false;
  dx = bx - ball.x;
  dy = by - ball.y;
  return dx * dx + dy * dy <= reach2;
}

/** True when `ball` sits in the chute column above the ring's opening (the smoke test and the HUD read it from the view). */
export function ballInChute(view: MergeRingView, ball: Pick<Ball, "x" | "y">): boolean {
  return !!view.layout && inChute(view.layout, ball.x, ball.y) && ball.y < view.layout.openY;
}

/** The data-merge-* attributes the canvas mirrors for tools and the smoke test. */
export const MERGE_RING_DATA_KEYS = ["mergeTiers", "mergeSpawned", "mergeBalls", "mergeMerges", "mergeTop", "mergeNotes", "mergeThuds", "mergeFinal", "mergeOverflow", "mergeFinished", "mergeFinishedMs"];

/** Writes the view's state into the data-merge-* attributes (`set` only writes a changed value). */
export class MergeRingDataset {
  write(view: MergeRingView, set: (key: string, value: string) => void) {
    set("mergeTiers", String(view.settings.tiers));
    set("mergeSpawned", String(view.spawned));
    set("mergeBalls", String(view.balls));
    set("mergeMerges", String(view.merges));
    set("mergeTop", String(view.topTier));
    set("mergeNotes", String(view.notes));
    set("mergeThuds", String(view.thuds));
    set("mergeFinal", view.finalMs >= 0 ? "1" : "0");
    set("mergeOverflow", view.overflowMs >= 0 ? "1" : "0");
    set("mergeFinished", view.finished ? "1" : "0");
    set("mergeFinishedMs", String(Math.round(view.finishedMs)));
  }
}
