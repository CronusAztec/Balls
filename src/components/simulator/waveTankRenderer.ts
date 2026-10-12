import type { WaveTankView } from "@/lib/physics/modes/waveTank";

/*
 * --- wave-tank --- Wave Tank's picture (lib/physics/modes/waveTank.ts runs it), drawn in world px under the page's camera:
 *
 * - the water as `ridges` horizontal ridge lines (40 by default), each a row of the height field lifted up in a simple
 *   perspective – a camera above the front edge looking down at the tank at Perspective tilt (30°), the depth setting each
 *   line's height on the page and its width – drawn back to front; under every line its outline is filled with the page's
 *   colour down past the front edge, so the lines behind a crest are hidden (Joy Division style). A line is 1 px of the clip,
 *   pale blue-white (#c8d6ff), brighter where the water is higher and a little dimmer far away;
 * - the wave-maker as a thin golden line (#f2c879) – the farthest ridge – or, with point sources, golden dots;
 * - the barrier as a slate wall (#5a6488) standing on the water with dark notches at the gaps, between the ridges behind it
 *   and those in front of it;
 * - the bells: dim brass dots on a thin rail under the front edge, each with an amber halo (#f2c46a) whose alpha follows the
 *   smoothed amplitude under it, flashing when the scanning cursor strikes it.
 *
 * Nothing is allocated per frame: no gradients, the projected points in one reused buffer, four paths a ridge (the brightness
 * steps). The pure projection (`waveTankProjection()`) is shared with the HUD's extent and the tests.
 */

export interface WaveTankRenderOptions {
  /** Device px per world px (hairlines stay a device pixel at least). */
  dpr: number;
  /** Ball Glow: larger halos. */
  showGlow: boolean;
  /** The page's colour (the hidden-line fill). */
  background: string;
}

/** The clip's colours: the ridges, the wave-maker, the barrier (top, face, notches), the bells and their halo, the rail. */
export const WT_LOOK = { ridge: "#c8d6ff", source: "#f2c879", slate: "#5a6488", slateFace: "#3c4463", notch: "#0d1222", brass: "#8a6d3b", brassLit: "#ffd98a", halo: "#f2c46a", rail: "#3a3020", edge: "#232b48" } as const;
/** Height of a ridge per unit of amplitude (tank widths), and the most |u| a ridge shows (spikes past it are cut). */
export const WT_HEIGHT = 0.035;
export const WT_HEIGHT_CLIP = 6;
/** The camera's distance from the tank's centre (tank widths): the back edge comes out about 0.7 × the front's width at 30°. */
export const WT_CAMERA = 3;
/** The tank's front edge spans this share of the square; the picture (water, wall and bells) at most this share of its height. */
export const WT_FIT_WIDTH = 0.94;
export const WT_FIT_HEIGHT = 0.8;
/** The wall's height (tank widths), the bells' drop under the front edge and their radius (shares of the square). */
export const WT_WALL_HEIGHT = 0.022;
export const WT_BELL_DROP = 0.045;
export const WT_BELL_RADIUS = 0.0085;
/** Seconds a struck bell flashes. */
export const WT_FLASH_SEC = 0.18;
/** The ridge strokes' brightness steps (alpha). */
export const WT_STEP_ALPHA = [0.3, 0.5, 0.74, 1] as const;

/** The projection of a frame: tank (x, h, z) → world px. */
export interface WaveTankProjection {
  /** sin and cos of the tilt, the camera distance, the tank's half depth. */
  sin: number;
  cos: number;
  cam: number;
  halfDepth: number;
  /** World px per projected unit, the screen centre and the projected y drawn at it. */
  scale: number;
  cx: number;
  cy: number;
  yMid: number;
  /** World px: the front edge's y, the bells' y, the picture's top and bottom. */
  frontY: number;
  bellY: number;
  top: number;
  bottom: number;
}

/** Projected (X, Y up) of tank point (x, h, z) into `out` (the camera looks at the tank's centre from the front, tilted down). */
function projectRaw(p: { sin: number; cos: number; cam: number; halfDepth: number }, x: number, h: number, z: number, out: { x: number; y: number }) {
  const zz = z - p.halfDepth;
  const depth = Math.max(0.05, p.cam - h * p.sin - zz * p.cos);
  out.x = (p.cam * x) / depth;
  out.y = (p.cam * (h * p.cos - zz * p.sin)) / depth;
  return out;
}

const RAW = { x: 0, y: 0 };

/** The frame's projection: the tank's front edge WT_FIT_WIDTH of the square wide, the picture inside WT_FIT_HEIGHT of it, centred. */
export function waveTankProjection(view: WaveTankView, out?: WaveTankProjection): WaveTankProjection {
  const tilt = (Math.max(0, Math.min(89.5, Number.isFinite(view.settings.tilt) ? view.settings.tilt : 30)) * Math.PI) / 180;
  const p = out ?? ({} as WaveTankProjection);
  p.sin = Math.sin(tilt);
  p.cos = Math.cos(tilt);
  p.cam = WT_CAMERA;
  p.halfDepth = view.depth / 2;
  const side = view.frame.side;
  const lift = 2 * WT_HEIGHT;
  // the picture's extent in projected units: the back edge raised by a crest, the front edge dipped by a trough, the wall
  projectRaw(p, 0.5, 0, view.depth, RAW);
  const frontHalf = RAW.x;
  const frontBase = RAW.y;
  projectRaw(p, 0, lift, view.sourceZ, RAW);
  const backTop = RAW.y;
  projectRaw(p, 0, WT_WALL_HEIGHT, view.barrierZ0, RAW);
  const wallTop = RAW.y;
  projectRaw(p, 0, -lift, view.depth, RAW);
  const frontLow = RAW.y;
  const yHigh = Math.max(backTop, wallTop, frontBase);
  const yLowTank = Math.min(frontLow, frontBase);
  const byWidth = (WT_FIT_WIDTH * side) / Math.max(1e-6, 2 * frontHalf);
  // the bells hang WT_BELL_DROP of the square under the front edge, plus their halo
  const bellsPx = (WT_BELL_DROP + 3 * WT_BELL_RADIUS) * side;
  const byHeight = (WT_FIT_HEIGHT * side - bellsPx) / Math.max(1e-6, yHigh - yLowTank);
  p.scale = Math.max(1e-6, Math.min(byWidth, byHeight));
  p.cx = view.frame.cx;
  const heightPx = (yHigh - yLowTank) * p.scale + bellsPx;
  const topPx = view.frame.cy - heightPx / 2;
  p.yMid = yHigh;
  p.cy = topPx;
  p.top = topPx;
  p.frontY = topPx + (yHigh - frontBase) * p.scale;
  p.bellY = p.frontY + WT_BELL_DROP * side;
  p.bottom = topPx + heightPx;
  return p;
}

/** World px of tank point (x, h, z) under projection `p`, into `out`. */
export function projectTank(p: WaveTankProjection, x: number, h: number, z: number, out: { x: number; y: number }) {
  projectRaw(p, x, h, z, out);
  out.x = p.cx + out.x * p.scale;
  out.y = p.cy + (p.yMid - out.y) * p.scale;
  return out;
}

/** How far the picture reaches above and below the frame's centre (world px): the loop HUD keeps clear of it. */
export function waveTankExtentPx(view: WaveTankView): number {
  const p = waveTankProjection(view);
  return Math.max(view.frame.cy - p.top, p.bottom - view.frame.cy);
}

const PT = { x: 0, y: 0 };
const PT2 = { x: 0, y: 0 };
/** The tank's two side edges (x), and a halo's three rings: radius (bell radii) and alpha. */
const SIDES = [-0.5, 0.5] as const;
const HALO_RINGS = [3.4, 2.3, 1.55] as const;
const HALO_ALPHAS = [0.14, 0.24, 0.42] as const;

export class WaveTankLayer {
  /** Ridges and strokes drawn last frame, bells lit (level ≥ 0.25) and flashing (for tools and the smoke test). */
  ridgesDrawn = 0;
  strokes = 0;
  litBells = 0;
  flashing = 0;
  private pts = new Float32Array(0);
  private buckets = new Uint8Array(0);
  private readonly edges: number[] = [];
  private readonly proj = {} as WaveTankProjection;

  /** The whole tank at simulation time `t` (s): the ridges back to front with the wall among them, then the bells. */
  drawStage(ctx: CanvasRenderingContext2D, view: WaveTankView, t: number, opts: WaveTankRenderOptions) {
    const p = waveTankProjection(view, this.proj);
    const R = view.ridges;
    const S = view.samples;
    if (this.pts.length < 2 * S) {
      this.pts = new Float32Array(2 * S);
      this.buckets = new Uint8Array(S);
    }
    const side = view.frame.side;
    const line = Math.max(1 / Math.max(1, opts.dpr), (1.05 * side) / 720);
    const fillBottom = p.bottom + 4;
    const lines = view.source === "line";
    let wallDrawn = !lines;
    this.ridgesDrawn = 0;
    this.strokes = 0;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // the tank's side edges, faint, under everything
    ctx.strokeStyle = WT_LOOK.edge;
    ctx.lineWidth = line;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const x of SIDES) {
      projectTank(p, x, 0, view.sourceZ, PT);
      projectTank(p, x, 0, view.depth, PT2);
      ctx.moveTo(PT.x, PT.y);
      ctx.lineTo(PT2.x, PT2.y);
    }
    ctx.stroke();
    // (the level of detail: a ridge whose baseline lies within a device pixel of the last one drawn would only repeat it –
    // thousands of ridge lines draw as many as the tank's height in pixels holds, the first and the last always)
    const minGap = 1 / Math.max(1, opts.dpr);
    let lastBase = -Infinity;
    for (let r = 0; r < R; r++) {
      const z = view.ridgeZ[r];
      if (lines && z >= view.barrierZ0 && z <= view.barrierZ1) continue; // inside the wall
      const baseY = projectTank(p, 0, 0, z, PT).y;
      if (r > 0 && r < R - 1 && baseY - lastBase < minGap) continue;
      lastBase = baseY;
      if (!wallDrawn && z > view.barrierZ1) {
        this.drawWall(ctx, view, p, line);
        wallDrawn = true;
      }
      this.drawRidge(ctx, view, p, r, line, fillBottom, opts.background, r === 0 && lines);
    }
    if (!wallDrawn) this.drawWall(ctx, view, p, line);
    if (!lines) this.drawPointSources(ctx, view, p, side);
    this.drawBells(ctx, view, p, t, side, opts);
    ctx.restore();
  }

  /** One ridge: its outline filled with the page's colour down past the front (hiding what lies behind), then its strokes by brightness. */
  private drawRidge(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, r: number, line: number, fillBottom: number, background: string, golden: boolean) {
    const S = view.samples;
    const z = view.ridgeZ[r];
    const base = r * S;
    const pts = this.pts;
    const buckets = this.buckets;
    const far = view.ridges > 1 ? r / (view.ridges - 1) : 1;
    for (let s = 0; s < S; s++) {
      let u = view.heights[base + s];
      if (!Number.isFinite(u)) u = 0;
      if (u > WT_HEIGHT_CLIP) u = WT_HEIGHT_CLIP;
      else if (u < -WT_HEIGHT_CLIP) u = -WT_HEIGHT_CLIP;
      projectTank(p, view.sampleX[s], u * WT_HEIGHT, z, PT);
      pts[2 * s] = PT.x;
      pts[2 * s + 1] = PT.y;
      const q = Math.min(1, Math.max(0, 0.38 + 0.28 * u));
      buckets[s] = Math.min(3, Math.floor(q * 4));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = background;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let s = 1; s < S; s++) ctx.lineTo(pts[2 * s], pts[2 * s + 1]);
    ctx.lineTo(pts[2 * (S - 1)], fillBottom);
    ctx.lineTo(pts[0], fillBottom);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = golden ? 1.6 * line : line;
    ctx.strokeStyle = golden ? WT_LOOK.source : WT_LOOK.ridge;
    const fade = golden ? 1 : 0.6 + 0.4 * far;
    for (let b = 0; b < 4; b++) {
      let open = false;
      let any = false;
      ctx.beginPath();
      for (let s = 0; s < S - 1; s++) {
        const seg = Math.max(buckets[s], buckets[s + 1]);
        if (seg !== b && !golden) {
          open = false;
          continue;
        }
        if (golden && b !== 3) break;
        if (!open) ctx.moveTo(pts[2 * s], pts[2 * s + 1]);
        ctx.lineTo(pts[2 * s + 2], pts[2 * s + 3]);
        open = true;
        any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = (golden ? 1 : WT_STEP_ALPHA[b]) * fade;
      ctx.stroke();
      this.strokes++;
    }
    this.ridgesDrawn++;
  }

  /** The barrier: a slate wall on the water across the tank, its top face and front face, with dark notches at the gaps. */
  private drawWall(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, line: number) {
    const z0 = view.barrierZ0;
    const z1 = view.barrierZ1;
    const hTop = WT_WALL_HEIGHT;
    const half = view.gapWidth / 2;
    // the solid spans between the gaps (x from −½ to ½)
    const edges = this.edges;
    edges.length = 0;
    edges.push(-0.5);
    for (const g of view.gapX) {
      edges.push(Math.max(-0.5, Math.min(0.5, g - half)), Math.max(-0.5, Math.min(0.5, g + half)));
    }
    edges.push(0.5);
    ctx.globalAlpha = 1;
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const a = edges[i];
      const b = edges[i + 1];
      if (!(b > a)) continue;
      // front face
      ctx.fillStyle = WT_LOOK.slateFace;
      ctx.beginPath();
      projectTank(p, a, hTop, z1, PT);
      ctx.moveTo(PT.x, PT.y);
      projectTank(p, b, hTop, z1, PT);
      ctx.lineTo(PT.x, PT.y);
      projectTank(p, b, 0, z1, PT);
      ctx.lineTo(PT.x, PT.y);
      projectTank(p, a, 0, z1, PT);
      ctx.lineTo(PT.x, PT.y);
      ctx.closePath();
      ctx.fill();
      // top face
      ctx.fillStyle = WT_LOOK.slate;
      ctx.beginPath();
      projectTank(p, a, hTop, z0, PT);
      ctx.moveTo(PT.x, PT.y);
      projectTank(p, b, hTop, z0, PT);
      ctx.lineTo(PT.x, PT.y);
      projectTank(p, b, hTop, z1, PT);
      ctx.lineTo(PT.x, PT.y);
      projectTank(p, a, hTop, z1, PT);
      ctx.lineTo(PT.x, PT.y);
      ctx.closePath();
      ctx.fill();
    }
    // the notches: the gaps' openings, dark, at the water line
    ctx.fillStyle = WT_LOOK.notch;
    for (let i = 1; i + 1 < edges.length; i += 2) {
      const a = edges[i];
      const b = edges[i + 1];
      if (!(b > a)) continue;
      ctx.beginPath();
      projectTank(p, a, 0, z0, PT);
      ctx.moveTo(PT.x, PT.y);
      projectTank(p, b, 0, z0, PT);
      ctx.lineTo(PT.x, PT.y);
      projectTank(p, b, 0, z1, PT);
      ctx.lineTo(PT.x, PT.y + line);
      projectTank(p, a, 0, z1, PT);
      ctx.lineTo(PT.x, PT.y + line);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Point sources (no barrier): golden dots where the gaps would be. */
  private drawPointSources(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, side: number) {
    const r = 0.007 * side;
    ctx.fillStyle = WT_LOOK.source;
    for (const g of view.gapX) {
      projectTank(p, g, 0, view.barrierZ0, PT);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(PT.x, PT.y, 2.2 * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(PT.x, PT.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The bells on their rail: amber halos by the smoothed amplitude, dim brass dots, a flash on a strike. */
  private drawBells(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, t: number, side: number, opts: WaveTankRenderOptions) {
    const n = view.bells;
    const r = WT_BELL_RADIUS * side * Math.min(1, 11 / Math.max(1, n)) ** 0.5;
    const y = p.bellY;
    // the rail
    projectTank(p, -0.5, 0, view.depth, PT);
    projectTank(p, 0.5, 0, view.depth, PT2);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = WT_LOOK.rail;
    ctx.lineWidth = Math.max(1 / Math.max(1, opts.dpr), r * 0.35);
    ctx.beginPath();
    ctx.moveTo(PT.x, y);
    ctx.lineTo(PT2.x, y);
    ctx.stroke();
    this.litBells = 0;
    this.flashing = 0;
    const grow = opts.showGlow ? 1.35 : 1;
    ctx.fillStyle = WT_LOOK.halo;
    for (let b = 0; b < n; b++) {
      const level = Math.max(0, Math.min(1, view.bellLevel[b] ?? 0));
      if (level >= 0.25) this.litBells++;
      if (level < 0.02) continue;
      projectTank(p, view.bellX[b], 0, view.depth, PT);
      const x = PT.x;
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = HALO_ALPHAS[k] * level;
        ctx.beginPath();
        ctx.arc(x, y, r * HALO_RINGS[k] * grow * (0.7 + 0.5 * level), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let b = 0; b < n; b++) {
      projectTank(p, view.bellX[b], 0, view.depth, PT);
      const x = PT.x;
      const since = t - (view.bellStrikeSec[b] ?? -1);
      const flash = view.bellStrikeSec[b] >= 0 && since >= 0 && since < WT_FLASH_SEC ? 1 - since / WT_FLASH_SEC : 0;
      if (flash > 0) this.flashing++;
      ctx.globalAlpha = 1;
      ctx.fillStyle = flash > 0 ? WT_LOOK.brassLit : WT_LOOK.brass;
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + 0.25 * flash), 0, Math.PI * 2);
      ctx.fill();
      if (flash > 0) {
        ctx.globalAlpha = 0.6 * flash;
        ctx.strokeStyle = WT_LOOK.brassLit;
        ctx.lineWidth = Math.max(1 / Math.max(1, opts.dpr), 0.3 * r);
        ctx.beginPath();
        ctx.arc(x, y, r * (1.6 + 1.2 * (1 - flash)), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

/** The canvas' data-wt-* keys (cleared when another mode runs). */
export const WAVE_TANK_DATA_KEYS = ["wtModel", "wtSource", "wtTime", "wtLoop", "wtLoopIndex", "wtSection", "wtGaps", "wtChanges", "wtSectionChanges", "wtSeams", "wtSeamError", "wtNan", "wtMax", "wtGrid", "wtSubsteps", "wtClamped", "wtPreroll", "wtFreq", "wtLambda", "wtCycles", "wtBells", "wtLevels", "wtReference", "wtStrikes", "wtSkipped", "wtCursor", "wtSounds", "wtRoots", "wtRootHz", "wtRidges", "wtSamples", "wtDrawn", "wtStrokes", "wtLit", "wtFlashing", "wtLag", "wtTilt"] as const;

/** Mirrors a Wave Tank run onto the canvas' dataset (data-wt-*), for tools and the smoke test. */
export function writeWaveTankDataset(view: WaveTankView, layer: WaveTankLayer, set: (key: string, value: string) => void) {
  set("wtModel", view.model);
  set("wtSource", view.source);
  set("wtTime", view.timeSec.toFixed(3));
  set("wtLoop", view.loopSec.toFixed(4));
  set("wtLoopIndex", String(view.loopIndex));
  set("wtSection", String(view.section));
  set("wtGaps", String(view.gaps));
  set("wtChanges", view.changeFrames.join(","));
  set("wtSectionChanges", String(view.sectionChanges));
  set("wtSeams", String(view.seams));
  set("wtSeamError", view.seamError < 0 ? "-1" : view.seamError.toExponential(2));
  set("wtNan", String(view.nonFinite));
  set("wtMax", view.maxAbs.toFixed(3));
  set("wtGrid", view.grid ? `${view.grid.cols}x${view.grid.rows}` : "huygens");
  set("wtSubsteps", String(view.grid ? view.grid.substeps : 0));
  set("wtClamped", view.grid?.clamped ? "1" : "0");
  set("wtPreroll", view.prerollSec.toFixed(3));
  set("wtFreq", view.frequency.toFixed(4));
  set("wtLambda", view.wavelength.toFixed(5));
  set("wtCycles", String(view.cycles));
  set("wtBells", String(view.bells));
  let levels = "";
  for (let b = 0; b < view.bells && b < 64; b++) levels += (b ? "," : "") + view.bellLevel[b].toFixed(2);
  set("wtLevels", levels);
  set("wtReference", view.reference.toFixed(3));
  set("wtStrikes", String(view.strikes));
  set("wtSkipped", String(view.skipped));
  set("wtCursor", String(view.cursor));
  set("wtSounds", String(view.sounds));
  set("wtRoots", String(view.roots));
  set("wtRootHz", view.rootHz.toFixed(2));
  set("wtRidges", String(view.ridges));
  set("wtSamples", String(view.samples));
  set("wtDrawn", String(layer.ridgesDrawn));
  set("wtStrokes", String(layer.strokes));
  set("wtLit", String(layer.litBells));
  set("wtFlashing", String(layer.flashing));
  set("wtLag", String(view.lag));
  set("wtTilt", String(view.settings.tilt));
}
