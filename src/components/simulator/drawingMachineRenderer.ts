import type { DrawingMachineView } from "@/lib/physics/modes/drawingMachine";
import { orbitAngle, rampRgb } from "@/lib/physics/drawingMachine";

/*
 * --- drawing-machine --- Drawing Machines' picture (lib/physics/modes/drawingMachine.ts runs it), drawn in world px under the
 * page's camera from the mode's view:
 *
 * - **harmonograph**: dark wood with a faint grain, a cream sheet of paper between two grey metal rollers, the pen's trace (1 px of
 *   a 720 px frame, alpha 0.7, its ink drifting through the ramp – blue-violet to crimson – over the cycle), the brass rod from
 *   its pivot in the bottom-right corner to the pen and the dark ink dot. While the paper scrolls the drawing slides up and off
 *   the rollers, a perforation line follows it and a fresh sheet comes up behind it.
 * - **orbits**: faint star specks on the near-black sky, the 1 px orbit circles, the chords with "lighter" compositing in a ramp
 *   colour by their year (blue → violet → magenta), the amber sun with its glow, the conjunction marks (white) joined in order
 *   by the cream pentagram, the string between the planets and the planets themselves.
 *
 * The trace and the chords accumulate in an offscreen layer (device px, like the Picture Paint mask): a frame strokes only the
 * new segments or chords; the layer starts over with a new sheet or a new run, and on a rewind (the chords un-drawing newest
 * first) or a resize it replays what is visible – the trace from the points still held, the chords from the clock. No colour
 * string, gradient or array is made per frame: the ramp is a palette of 64 strings made when the ink changes.
 */

/** What the canvas hands the layer each frame. */
export interface DrawingMachineRenderOptions {
  /** Device px per world px (the layer is rasterised at it; hairlines stay a device pixel). */
  dpr: number;
  /** Ball Glow: halos round the pen and the planets. */
  showGlow: boolean;
}

/** The harmonograph's colours (the clip's): wood, grain, paper, rollers, brass, ink, the perforation. */
export const DM_HARMONOGRAPH_LOOK = {
  wood: "#2a1c15",
  grainDark: "rgba(0, 0, 0, 0.22)",
  grainLight: "rgba(255, 214, 170, 0.045)",
  paper: "#f3ecdc",
  paperEdge: "rgba(80, 56, 30, 0.18)",
  rollerDark: "#4f5258",
  roller: "#8b8f97",
  rollerLight: "#d3d6dc",
  brassDark: "#6e4f1e",
  brass: "#b8893a",
  brassLight: "#ecc77a",
  ink: "#1d1a2b",
  holder: "#3b3328",
  perforation: "rgba(110, 86, 60, 0.6)",
} as const;
/** The orbits' colours: the sky, the stars, the orbits, the sun, the marks and the pentagram. */
export const DM_ORBITS_LOOK = {
  sky: "#05060c",
  orbit: "#26304a",
  sun: "#f2b44a",
  sunCore: "#ffe29a",
  sunGlow: "rgba(242, 170, 60, 0.09)",
  mark: "#ffffff",
  pentagram: "#fff2c0",
} as const;
/** The trace's and the chords' alpha, the ramp's steps (palette strings) and the stars of the sky. */
export const DM_TRACE_ALPHA = 0.7;
export const DM_CHORD_ALPHA = 0.5;
export const DM_RAMP_STEPS = 64;
export const DM_STAR_COUNT = 140;
/** A replay with more chords than this strokes one path per ramp step instead of one per chord (a rewind of a dense flower). */
export const DM_REPLAY_PER_CHORD = 4_000;
/** The rollers' height and overhang, the rod's width, the pivot's radius (shares of the field's side). */
export const DM_ROLLER_H = 0.034;
export const DM_ROLLER_OVERHANG = 0.025;
export const DM_ROD_W = 0.008;
export const DM_PIVOT_R = 0.016;
/** The perforation's dashes (px of a 720 px frame) and the sun's glow rings (sun radii). */
export const DM_PERFORATION_DASH = [6, 5] as const;
const NO_DASH: number[] = [];
const SUN_GLOW_RINGS = [3.4, 2.5, 1.8] as const;

type Layer = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
/** Makes the offscreen layer's canvas (null where there is no DOM: the layer then draws straight onto the frame). */
export type DmCanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

function domCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** The ramp as `steps` rgba strings (made when the ink or the alpha changes, never per frame). */
export function rampPalette(stops: readonly string[], alpha: number, steps = DM_RAMP_STEPS): string[] {
  const out: string[] = [];
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    rampRgb(stops, steps > 1 ? i / (steps - 1) : 0, rgb);
    out.push(`rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`);
  }
  return out;
}

/** The palette step of a share `u` (0–1) of the way through the ramp. */
export function rampStep(u: number, steps = DM_RAMP_STEPS): number {
  const x = u <= 0 || !(u === u) ? 0 : u >= 1 ? 1 : u;
  return Math.min(steps - 1, Math.floor(x * steps));
}

export class DrawingMachineLayer {
  /** What the layer holds and did (data-dm-*): trace points on the sheet, chords on the layer, marks drawn, full rebuilds, segments stroked by the last frame. */
  pointsOnLayer = 0;
  chordsOnLayer = 0;
  marksDrawn = 0;
  redraws = 0;
  segmentsLastFrame = 0;
  private readonly makeCanvas: DmCanvasFactory;
  private trace: Layer | null = null;
  private traceKey = "";
  private traceGen = -1;
  private traceCycle = -1;
  /** The next trace point (its index since the sheet's start) the layer has not stroked to yet. */
  private traceDrawn = 0;
  private chords: Layer | null = null;
  private chordKey = "";
  private chordGen = -1;
  private chordCycle = -1;
  private chordDrawn = 0;
  private traceInk: readonly string[] = [];
  private tracePalette: string[] = [];
  private chordInk: readonly string[] = [];
  private chordPalette: string[] = [];
  private stars: Float32Array | null = null;
  /** The perforation's dash pattern at the frame's scale (one array, rewritten). */
  private readonly dash = [0, 0];

  constructor(makeCanvas: DmCanvasFactory = domCanvas) {
    this.makeCanvas = makeCanvas;
  }

  /** The machine's backdrop and drawing: the wood, the paper and its trace, the rollers – or the sky, the orbits, the chords and the sun. */
  drawStage(ctx: CanvasRenderingContext2D, view: DrawingMachineView, opts: DrawingMachineRenderOptions) {
    this.segmentsLastFrame = 0;
    if (view.machine === "harmonograph") this.drawHarmonographStage(ctx, view, opts);
    else this.drawOrbitsStage(ctx, view, opts);
  }

  /** What moves on top: the rod and the pen – or the marks, the pentagram, the string and the planets. */
  drawBodies(ctx: CanvasRenderingContext2D, view: DrawingMachineView, opts: DrawingMachineRenderOptions) {
    if (view.machine === "harmonograph") this.drawPen(ctx, view, opts);
    else this.drawPlanets(ctx, view, opts);
  }

  /* ---------------------------------------------------------------- the harmonograph */

  private drawHarmonographStage(ctx: CanvasRenderingContext2D, view: DrawingMachineView, opts: DrawingMachineRenderOptions) {
    const L = DM_HARMONOGRAPH_LOOK;
    const unit = view.side / 720;
    const w = 2 * view.cx;
    const h = 2 * view.cy;
    ctx.save();
    // the wood and its grain (long gentle waves, the same every frame)
    ctx.fillStyle = L.wood;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = Math.max(0.5, 1.4 * unit);
    for (let i = 0; i < 18; i++) {
      const y0 = ((i + 0.5) / 18) * h;
      const amp = (4 + 3 * Math.sin(i * 1.7)) * unit;
      ctx.strokeStyle = i % 3 === 0 ? L.grainLight : L.grainDark;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(w * 0.3, y0 + amp, w * 0.6, y0 - amp, w, y0 + 0.5 * amp);
      ctx.stroke();
    }
    // the paper, and on it the sheet's drawing (sliding up and off while the paper scrolls)
    const px = view.paperX;
    const py = view.paperY;
    const pw = view.paperW;
    const ph = view.paperH;
    ctx.fillStyle = L.paper;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = L.paperEdge;
    ctx.lineWidth = Math.max(0.5, unit);
    ctx.strokeRect(px, py, pw, ph);
    const shift = view.scroll * ph;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    const layer = this.updateTrace(view, opts);
    if (layer) ctx.drawImage(layer.canvas, px, py - shift, pw, ph);
    else this.strokeTrace(ctx, view, view.trace.first, view.trace.total, 1, -shift);
    if (view.scroll > 0 && view.scroll < 1) {
      // the perforation between the old sheet and the fresh one coming up behind it
      const y = py + ph - shift;
      ctx.strokeStyle = L.perforation;
      ctx.lineWidth = Math.max(0.6, 1.2 * unit);
      this.dash[0] = DM_PERFORATION_DASH[0] * unit;
      this.dash[1] = DM_PERFORATION_DASH[1] * unit;
      ctx.setLineDash(this.dash);
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px + pw, y);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    ctx.restore();
    // the rollers across the top and the bottom of the sheet
    this.drawRoller(ctx, view, py);
    this.drawRoller(ctx, view, py + ph);
    ctx.restore();
  }

  private drawRoller(ctx: CanvasRenderingContext2D, view: DrawingMachineView, y: number) {
    const L = DM_HARMONOGRAPH_LOOK;
    const rh = DM_ROLLER_H * view.side;
    const over = DM_ROLLER_OVERHANG * view.side;
    const x0 = view.paperX - over;
    const rw = view.paperW + 2 * over;
    ctx.fillStyle = L.rollerDark;
    ctx.fillRect(x0, y - rh / 2, rw, rh);
    ctx.fillStyle = L.roller;
    ctx.fillRect(x0, y - rh / 2 + 0.15 * rh, rw, 0.55 * rh);
    ctx.fillStyle = L.rollerLight;
    ctx.fillRect(x0, y - rh / 2 + 0.28 * rh, rw, 0.12 * rh);
    // the end caps
    ctx.fillStyle = L.rollerDark;
    const cap = 0.012 * view.side;
    ctx.fillRect(x0 - cap, y - 0.36 * rh, cap, 0.72 * rh);
    ctx.fillRect(x0 + rw, y - 0.36 * rh, cap, 0.72 * rh);
  }

  /** The sheet's layer brought up to date: started over for a new run, sheet, size or ink; the new trace points stroked. */
  private updateTrace(view: DrawingMachineView, opts: DrawingMachineRenderOptions): Layer | null {
    const dpr = opts.dpr > 0 && Number.isFinite(opts.dpr) ? opts.dpr : 1;
    const lw = Math.max(1, Math.min(8192, Math.ceil(view.paperW * dpr)));
    const lh = Math.max(1, Math.min(8192, Math.ceil(view.paperH * dpr)));
    this.ensurePalette(view);
    const key = `${lw}x${lh}|${view.paperX}|${view.paperY}|${view.figureRadius}|${this.tracePalette[0]}|${this.tracePalette[DM_RAMP_STEPS - 1]}`;
    const trace = view.trace;
    let fresh = false;
    if (!this.trace || this.traceKey !== key) {
      const canvas = this.trace?.canvas ?? this.makeCanvas(lw, lh);
      const g = canvas?.getContext("2d") ?? null;
      if (!canvas || !g) {
        this.trace = null;
        this.pointsOnLayer = trace.count;
        return null;
      }
      canvas.width = lw;
      canvas.height = lh;
      this.trace = { canvas, ctx: g };
      this.traceKey = key;
      fresh = true;
    }
    if (fresh || this.traceGen !== view.generation || this.traceCycle !== view.cycleIndex || this.traceDrawn > trace.total) {
      this.trace.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.trace.ctx.clearRect(0, 0, lw, lh);
      this.traceGen = view.generation;
      this.traceCycle = view.cycleIndex;
      this.traceDrawn = trace.first;
      this.pointsOnLayer = 0;
      this.redraws++;
    }
    const from = Math.max(this.traceDrawn - 1, trace.first);
    if (trace.total - from >= 2) {
      const g = this.trace.ctx;
      g.setTransform(dpr, 0, 0, dpr, -view.paperX * dpr, -view.paperY * dpr);
      this.strokeTrace(g, view, from, trace.total, dpr, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      this.pointsOnLayer += trace.total - Math.max(this.traceDrawn, trace.first);
    }
    this.traceDrawn = trace.total;
    return this.trace;
  }

  /**
   * Strokes the trace's points `from` … `to − 1` (indices since the sheet's start) in world px, `dy` lower (the scroll's shift
   * when drawing straight onto the frame), one path per run of the same ramp step.
   */
  private strokeTrace(g: CanvasRenderingContext2D, view: DrawingMachineView, from: number, to: number, dpr: number, dy: number) {
    const trace = view.trace;
    const start = Math.max(from, trace.first);
    if (to - start < 2) return;
    const draw = view.timeline.draw > 0 ? view.timeline.draw : 1;
    const R = view.figureRadius;
    const ox = view.cx;
    const oy = view.cy + dy;
    g.lineWidth = Math.max(0.75 / dpr, view.side / 720);
    g.lineJoin = "round";
    g.lineCap = "round";
    let slot = trace.slot(start);
    let step = rampStep(trace.ts[slot] / draw);
    g.strokeStyle = this.tracePalette[step];
    g.beginPath();
    g.moveTo(ox + R * trace.xs[slot], oy + R * trace.ys[slot]);
    let segments = 0;
    for (let i = start + 1; i < to; i++) {
      slot = trace.slot(i);
      const x = ox + R * trace.xs[slot];
      const y = oy + R * trace.ys[slot];
      g.lineTo(x, y);
      segments++;
      const next = rampStep(trace.ts[slot] / draw);
      if (next !== step) {
        g.stroke();
        step = next;
        g.strokeStyle = this.tracePalette[step];
        g.beginPath();
        g.moveTo(x, y);
      }
    }
    g.stroke();
    this.segmentsLastFrame += segments;
  }

  private drawPen(ctx: CanvasRenderingContext2D, view: DrawingMachineView, opts: DrawingMachineRenderOptions) {
    const L = DM_HARMONOGRAPH_LOOK;
    const x = view.penX;
    const y = view.penY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ctx.save();
    ctx.lineCap = "round";
    // the brass rod from its pivot to the pen: a dark edge, the brass, a highlight
    const rod = Math.max(1.5, DM_ROD_W * view.side);
    ctx.strokeStyle = L.brassDark;
    ctx.lineWidth = rod * 1.35;
    ctx.beginPath();
    ctx.moveTo(view.pivotX, view.pivotY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeStyle = L.brass;
    ctx.lineWidth = rod;
    ctx.stroke();
    ctx.strokeStyle = L.brassLight;
    ctx.lineWidth = rod * 0.3;
    ctx.stroke();
    // the pivot
    const pr = DM_PIVOT_R * view.side;
    ctx.fillStyle = L.brassDark;
    ctx.beginPath();
    ctx.arc(view.pivotX, view.pivotY, pr * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.brass;
    ctx.beginPath();
    ctx.arc(view.pivotX, view.pivotY, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.ink;
    ctx.beginPath();
    ctx.arc(view.pivotX, view.pivotY, pr * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // the pen's holder and its ink dot
    const r = view.penRadius;
    if (opts.showGlow) {
      ctx.fillStyle = "rgba(91, 85, 201, 0.18)";
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = L.holder;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.ink;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.arc(x - 0.35 * r, y - 0.35 * r, Math.max(0.5, 0.3 * r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------------------------------------------------------- the orbits */

  private drawOrbitsStage(ctx: CanvasRenderingContext2D, view: DrawingMachineView, opts: DrawingMachineRenderOptions) {
    const L = DM_ORBITS_LOOK;
    const unit = view.side / 720;
    const w = 2 * view.cx;
    const h = 2 * view.cy;
    ctx.save();
    ctx.fillStyle = L.sky;
    ctx.fillRect(0, 0, w, h);
    // the stars: fixed specks (a fixed sequence, never the run's random numbers)
    const stars = this.starField();
    for (let i = 0; i < DM_STAR_COUNT; i++) {
      const a = stars[4 * i + 3];
      ctx.fillStyle = a > 0.66 ? "rgba(255, 255, 255, 0.55)" : a > 0.33 ? "rgba(200, 215, 255, 0.35)" : "rgba(255, 255, 255, 0.2)";
      const s = (0.6 + stars[4 * i + 2]) * unit;
      ctx.fillRect(stars[4 * i] * w, stars[4 * i + 1] * h, s, s);
    }
    // the orbits
    ctx.strokeStyle = L.orbit;
    ctx.lineWidth = Math.max(0.5, unit);
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.innerOrbit, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.outerOrbit, 0, Math.PI * 2);
    ctx.stroke();
    // the chords so far (accumulated; replayed on a rewind)
    const layer = this.updateChords(view, opts);
    const half = view.side / 2;
    if (layer) ctx.drawImage(layer.canvas, view.cx - half, view.cy - half, view.side, view.side);
    else {
      ctx.globalCompositeOperation = "lighter";
      this.strokeChords(ctx, view, 0, view.chordsVisible, 1);
      ctx.globalCompositeOperation = "source-over";
    }
    // the sun and its glow
    const sr = view.sunSize;
    ctx.fillStyle = L.sunGlow;
    for (const k of SUN_GLOW_RINGS) {
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, sr * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = L.sun;
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.sunCore;
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, sr * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** The chords' layer brought up to date: started over for a new run, cycle, size or ink, or when fewer are visible (the rewind). */
  private updateChords(view: DrawingMachineView, opts: DrawingMachineRenderOptions): Layer | null {
    const dpr = opts.dpr > 0 && Number.isFinite(opts.dpr) ? opts.dpr : 1;
    const size = Math.max(1, Math.min(8192, Math.ceil(view.side * dpr)));
    this.ensurePalette(view);
    const key = `${size}|${view.cx}|${view.cy}|${view.innerOrbit}|${view.outerOrbit}|${this.chordPalette[0]}|${this.chordPalette[DM_RAMP_STEPS - 1]}`;
    let fresh = false;
    if (!this.chords || this.chordKey !== key) {
      const canvas = this.chords?.canvas ?? this.makeCanvas(size, size);
      const g = canvas?.getContext("2d") ?? null;
      if (!canvas || !g) {
        this.chords = null;
        this.chordsOnLayer = view.chordsVisible;
        return null;
      }
      canvas.width = size;
      canvas.height = size;
      this.chords = { canvas, ctx: g };
      this.chordKey = key;
      fresh = true;
    }
    const target = view.chordsVisible;
    if (fresh || this.chordGen !== view.generation || this.chordCycle !== view.cycleIndex || target < this.chordDrawn) {
      this.chords.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.chords.ctx.clearRect(0, 0, size, size);
      this.chordGen = view.generation;
      this.chordCycle = view.cycleIndex;
      this.chordDrawn = 0;
      this.redraws++;
    }
    if (target > this.chordDrawn) {
      const g = this.chords.ctx;
      const half = view.side / 2;
      g.setTransform(dpr, 0, 0, dpr, -(view.cx - half) * dpr, -(view.cy - half) * dpr);
      g.globalCompositeOperation = "lighter";
      this.strokeChords(g, view, this.chordDrawn, target, dpr);
      g.globalCompositeOperation = "source-over";
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    this.chordDrawn = target;
    this.chordsOnLayer = target;
    return this.chords;
  }

  /** Strokes the chords after the `from`-th up to the `to`-th (chord k at year k · dt; every `chordStride`-th), in world px. */
  private strokeChords(g: CanvasRenderingContext2D, view: DrawingMachineView, from: number, to: number, dpr: number) {
    const stride = Math.max(1, view.chordStride);
    const first = Math.max(stride, Math.ceil((from + 1) / stride) * stride);
    if (first > to) return;
    const count = Math.floor((to - first) / stride) + 1;
    const total = Math.max(1, view.chordsPerCycle);
    g.lineWidth = Math.max(0.75 / dpr, view.side / 720);
    g.lineCap = "round";
    const perChord = count <= DM_REPLAY_PER_CHORD;
    let step = -1;
    if (!perChord) g.beginPath();
    for (let k = first; k <= to; k += stride) {
      const year = k * view.chordDt;
      const ai = orbitAngle(view.periods.inner, year);
      const ao = orbitAngle(view.periods.outer, year);
      const next = rampStep(k / total);
      if (perChord) {
        if (next !== step) {
          step = next;
          g.strokeStyle = this.chordPalette[step];
        }
        g.beginPath();
      } else if (next !== step) {
        if (step >= 0) g.stroke();
        step = next;
        g.strokeStyle = this.chordPalette[step];
        g.beginPath();
      }
      g.moveTo(view.cx + view.innerOrbit * Math.cos(ai), view.cy + view.innerOrbit * Math.sin(ai));
      g.lineTo(view.cx + view.outerOrbit * Math.cos(ao), view.cy + view.outerOrbit * Math.sin(ao));
      if (perChord) g.stroke();
    }
    if (!perChord) g.stroke();
    this.segmentsLastFrame += count;
  }

  private drawPlanets(ctx: CanvasRenderingContext2D, view: DrawingMachineView, opts: DrawingMachineRenderOptions) {
    const L = DM_ORBITS_LOOK;
    const unit = view.side / 720;
    ctx.save();
    // the conjunction marks, joined in order (the pentagram of 13 : 8)
    const stride = Math.max(1, view.markStride);
    const marks = view.marksVisible;
    this.marksDrawn = 0;
    if (view.settings.pentagram && marks >= 2) {
      ctx.strokeStyle = L.pentagram;
      ctx.lineWidth = Math.max(1, 2 * unit);
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let j = 0; j < marks; j += stride) {
        const a = orbitAngle(view.periods.outer, j * view.synodic);
        const x = view.cx + view.outerOrbit * Math.cos(a);
        const y = view.cy + view.outerOrbit * Math.sin(a);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = L.mark;
    const mr = Math.max(1, 5 * unit);
    for (let j = 0; j < marks; j += stride) {
      const a = orbitAngle(view.periods.outer, j * view.synodic);
      ctx.beginPath();
      ctx.arc(view.cx + view.outerOrbit * Math.cos(a), view.cy + view.outerOrbit * Math.sin(a), mr, 0, Math.PI * 2);
      ctx.fill();
      this.marksDrawn++;
    }
    // the string between the planets while the year counts up
    if (view.phase === "draw" && Number.isFinite(view.innerX) && Number.isFinite(view.outerX)) {
      ctx.strokeStyle = this.chordPalette[rampStep(view.chordsVisible / Math.max(1, view.chordsPerCycle))] ?? "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = Math.max(0.75, 1.2 * unit);
      ctx.beginPath();
      ctx.moveTo(view.innerX, view.innerY);
      ctx.lineTo(view.outerX, view.outerY);
      ctx.stroke();
    }
    // the planets
    this.drawPlanet(ctx, view.innerX, view.innerY, view.innerSize, view.innerColor, opts.showGlow);
    this.drawPlanet(ctx, view.outerX, view.outerY, view.outerSize, view.outerColor, opts.showGlow);
    ctx.restore();
  }

  private drawPlanet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, glow: boolean) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ctx.fillStyle = color;
    ctx.globalAlpha = glow ? 0.28 : 0.16;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------------------------------------------------------------- shared */

  /** The two palettes (the trace's at 0.7, the chords' at 0.5) for the view's ink, made only when it changes. */
  private ensurePalette(view: DrawingMachineView) {
    if (this.traceInk !== view.ink || this.tracePalette.length === 0) {
      this.traceInk = view.ink;
      this.tracePalette = rampPalette(view.ink, DM_TRACE_ALPHA);
    }
    if (this.chordInk !== view.ink || this.chordPalette.length === 0) {
      this.chordInk = view.ink;
      this.chordPalette = rampPalette(view.ink, DM_CHORD_ALPHA);
    }
  }

  /** The sky's stars: x, y (0–1 of the world), size and brightness, from a fixed sequence (made once). */
  private starField(): Float32Array {
    if (this.stars) return this.stars;
    const out = new Float32Array(4 * DM_STAR_COUNT);
    let s = 0x2f6b9d1;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < out.length; i++) out[i] = next();
    this.stars = out;
    return out;
  }
}

/** How far the machine reaches above and below its centre (world px: the paper and its rollers, or the outer orbit and its planet): the loop HUD keeps clear of it. */
export function drawingMachineExtentPx(view: DrawingMachineView): number {
  if (view.machine === "harmonograph") return view.paperH / 2 + (DM_ROLLER_H * view.side) / 2;
  return Math.max(view.innerOrbit + view.innerSize, view.outerOrbit + view.outerSize);
}

/** The canvas' data-dm-* keys (cleared when another mode runs). */
export const DRAWING_MACHINE_DATA_KEYS = [
  "dmMachine",
  "dmTime",
  "dmCycle",
  "dmCycleIndex",
  "dmPhase",
  "dmYear",
  "dmPeakYear",
  "dmLastPeakYear",
  "dmRewoundTo",
  "dmRewinds",
  "dmScrolls",
  "dmSheets",
  "dmScroll",
  "dmTrace",
  "dmTraceHeld",
  "dmRate",
  "dmChords",
  "dmChordsCycle",
  "dmMarks",
  "dmConjCycle",
  "dmConjunctions",
  "dmEnergy",
  "dmPenSpeed",
  "dmDrones",
  "dmRatchets",
  "dmPlucks",
  "dmBeds",
  "dmWashes",
  "dmTurns",
  "dmLayerPoints",
  "dmLayerChords",
  "dmMarksDrawn",
  "dmRedraws",
  "dmNan",
] as const;

/** Mirrors a Drawing Machines run onto the canvas' dataset (data-dm-*), for tools and the smoke test. */
export function writeDrawingMachineDataset(view: DrawingMachineView, layer: DrawingMachineLayer, set: (key: string, value: string) => void) {
  set("dmMachine", view.machine);
  set("dmTime", view.timeSec.toFixed(3));
  set("dmCycle", view.timeline.cycle.toFixed(4));
  set("dmCycleIndex", String(view.cycleIndex));
  set("dmPhase", view.phase);
  set("dmYear", view.yearShown.toFixed(1));
  set("dmPeakYear", view.peakYear.toFixed(1));
  set("dmLastPeakYear", view.lastPeakYear.toFixed(1));
  set("dmRewoundTo", view.rewoundTo.toFixed(1));
  set("dmRewinds", String(view.rewinds));
  set("dmScrolls", String(view.scrolls));
  set("dmSheets", String(view.sheets));
  set("dmScroll", view.scroll.toFixed(3));
  set("dmTrace", String(view.trace.total));
  set("dmTraceHeld", String(view.trace.count));
  set("dmRate", String(view.rate));
  set("dmChords", String(view.chordsVisible));
  set("dmChordsCycle", String(view.chordsPerCycle));
  set("dmMarks", String(view.marksVisible));
  set("dmConjCycle", String(view.conjPerCycle));
  set("dmConjunctions", String(view.conjunctions));
  set("dmEnergy", view.energy.toFixed(3));
  set("dmPenSpeed", view.penSpeed.toFixed(3));
  set("dmDrones", String(view.drones));
  set("dmRatchets", String(view.ratchets));
  set("dmPlucks", String(view.plucks));
  set("dmBeds", String(view.beds));
  set("dmWashes", String(view.washes));
  set("dmTurns", String(view.turns));
  set("dmLayerPoints", String(layer.pointsOnLayer));
  set("dmLayerChords", String(layer.chordsOnLayer));
  set("dmMarksDrawn", String(layer.marksDrawn));
  set("dmRedraws", String(layer.redraws));
  const bad = view.machine === "harmonograph" ? !Number.isFinite(view.penX) || !Number.isFinite(view.penY) : !Number.isFinite(view.innerX) || !Number.isFinite(view.outerY);
  set("dmNan", bad ? "1" : "0");
}
