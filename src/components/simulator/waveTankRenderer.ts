import type { WaveTankView } from "@/lib/physics/modes/waveTank";

/*
 * --- wave-tank --- Wave Tank's picture (lib/physics/modes/waveTank.ts runs it), drawn in world px under the page's camera:
 *
 * - the water as `ridges` horizontal ridge lines (40 by default), each a row of the height field lifted up in a simple
 *   perspective – a camera above the front edge looking down at the tank at Perspective tilt (30°), the depth setting each
 *   line's height on the page and its width – drawn back to front, each one's face filled down to where the next one's line
 *   can reach, so the lines behind a crest are hidden;
 * - --- wave-glow --- the water lit by its own interference: a face's colour is the time-averaged amplitude under it (the
 *   view's `glow`), from deep navy where crests meet troughs to bright sky blue where crests meet crests, in WT_WATER's six
 *   steps, so the pattern itself is the picture – one gap a single bright fan, two gaps bright and dark stripes, a grating its
 *   sharp beams. The ridge lines are shaded by height on top: the crests near white and wider, the slopes cyan, the troughs
 *   dim. The water between the wave-maker and the wall is the incoming wave, drawn at a steady middle light;
 * - the wave-maker as a golden bar along the back that pulses with the wave it makes (at the source's own frequency) – or,
 *   with point sources, pulsing golden dots;
 * - the barrier as a light slate wall standing on the water, its gaps glowing where the water squeezes through; at a section
 *   change the wall flashes and the new gaps burst open (the moment you also hear: the mode's "impact");
 * - --- wave-glow --- the screen: in front of the water a row of WT_FRONT_COLUMNS light pillars, each as tall and as bright as
 *   the water's amplitude at the front edge above it – the double slit's photographic plate, its stripes standing up;
 * - the bells on a rail under the pillars: brass dots with amber halos as loud as the water over them, flashing when the
 *   scanning cursor (or, in the climax, the bells' chord) strikes them.
 * - --- pillar-flash --- (round two, B8) in the climax the pillars flash white: fully as it comes in with its chord, softer on
 *   each of the bells' chords after it, so the grating's beams land on the music.
 *
 * Nothing is allocated per frame: no gradients, the projected points and the steps in reused buffers, a few paths a ridge
 * (the glow's six steps, the height's three). Everything reads the view at simulation time `t`, so the live canvas, the fast
 * export and the render queue draw the same frame. The pure projection (`waveTankProjection()`) is shared with the HUD's
 * extent and the tests.
 */

export interface WaveTankRenderOptions {
  /** Device px per world px (hairlines stay a device pixel at least). */
  dpr: number;
  /** Ball Glow: larger halos. */
  showGlow: boolean;
  /** The page's colour (under the screen). */
  background: string;
}

/** The clip's colours: the wave-maker, the wall (top, face, flash), the gaps' light, the bells and their halo, the rail, the tank's glass edges, the screen's panel. */
export const WT_LOOK = { source: "#ffd36b", sourceGlow: "#ffb020", slate: "#9aa6cf", slateFace: "#6d7aa8", wallFlash: "#ffffff", gapLight: "#bdf4ff", brass: "#b88a3e", brassLit: "#ffe3a3", halo: "#ffc65a", rail: "#5a4524", edge: "#4b6cb7", screen: "#060c1c" } as const;
/** --- wave-glow --- The water's six light steps (dark to bright) and the ridge lines' three (trough, slope, crest). */
export const WT_WATER = ["#081633", "#0c2c66", "#11469a", "#1767cc", "#1e93ee", "#5cccff"] as const;
export const WT_LINES = ["#2f5fb3", "#7fd8ff", "#f2fdff"] as const;
/** The incoming wave's light step (between the wave-maker and the wall). */
export const WT_INCOMING_STEP = 3;
/** The pillars' reference at least (× the incoming wave's amplitude). */
export const WT_PILLAR_FLOOR = 0.45;
/** The pillars' four light steps (dim to white). */
export const WT_PILLARS = ["#1d6fd1", "#36b4f5", "#9be7ff", "#ffffff"] as const;
// --- pillar-flash ---
/** The climax's flash of the pillars: as it comes in (s, strength) and on each bell chord in it (s, strength). */
export const WT_PILLAR_FLASH_SEC = 0.5;
export const WT_PILLAR_FLASH = 0.85;
export const WT_CHORD_FLASH_SEC = 0.3;
export const WT_CHORD_FLASH = 0.4;
/** How white the pillars are at `t` (s): 0 outside the climax, up to WT_PILLAR_FLASH as it comes in, WT_CHORD_FLASH on a chord. */
export function pillarFlash(view: Pick<WaveTankView, "climax" | "changeSec" | "chordSec">, t: number): number {
  if (!view.climax) return 0;
  const sinceIn = view.changeSec >= 0 ? t - view.changeSec : Infinity;
  const sinceChord = view.chordSec >= 0 ? t - view.chordSec : Infinity;
  const fadeIn = sinceIn >= 0 && sinceIn < WT_PILLAR_FLASH_SEC ? WT_PILLAR_FLASH * (1 - sinceIn / WT_PILLAR_FLASH_SEC) : 0;
  const fadeChord = sinceChord >= 0 && sinceChord < WT_CHORD_FLASH_SEC ? WT_CHORD_FLASH * (1 - sinceChord / WT_CHORD_FLASH_SEC) : 0;
  return Math.max(fadeIn, fadeChord);
}
// --- end pillar-flash ---
/** Height of a ridge per unit of amplitude (tank widths), and the most |u| a ridge shows (spikes past it are cut). */
export const WT_HEIGHT = 0.045;
export const WT_HEIGHT_CLIP = 6;
/** The camera's distance from the tank's centre (tank widths): the back edge comes out about 0.7 × the front's width at 30°. */
export const WT_CAMERA = 3;
/** The tank's front edge spans this share of the square; the picture (water, wall, screen and bells) at most this share of its height. */
export const WT_FIT_WIDTH = 0.94;
export const WT_FIT_HEIGHT = 0.86;
/** The wall's height (tank widths), the bells' drop under the front edge (the screen's height) and their radius (shares of the square). */
export const WT_WALL_HEIGHT = 0.026;
export const WT_BELL_DROP = 0.12;
export const WT_BELL_RADIUS = 0.011;
/** Seconds a struck bell flashes, the wall's flash at a section change, and the wave-maker's pulse depth (0–1). */
export const WT_FLASH_SEC = 0.18;
export const WT_WALL_FLASH_SEC = 0.6;
export const WT_SOURCE_PULSE = 0.45;
/** --- review fix (D1) --- The wave-maker's bar stands this many WT_HEIGHT above the water (the projection's back lift). */
export const WT_SOURCE_LIFT = 2;
/** The glow's gamma (under 1 lifts the half-lit stripes) and the share of a crest's local amplitude a line must pass to count as a crest. */
export const WT_GLOW_GAMMA = 0.75;
export const WT_CREST_SHARE = 0.45;
/** The ridge strokes' brightness (alpha) per line step. */
export const WT_STEP_ALPHA = [0.4, 0.7, 0.95] as const;

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
  // the screen and the bells hang WT_BELL_DROP of the square under the front edge, plus their halo
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

/** --- wave-glow --- The light step (0 … steps − 1) of an amplitude against the picture's reference. */
export function glowStep(amplitude: number, reference: number, steps: number): number {
  const q = reference > 0 && amplitude > 0 ? Math.min(1, amplitude / reference) ** WT_GLOW_GAMMA : 0;
  return Math.min(steps - 1, Math.floor(q * steps));
}

const PT = { x: 0, y: 0 };
const PT2 = { x: 0, y: 0 };
/** The tank's two side edges (x), and a halo's three rings: radius (bell radii) and alpha. */
const SIDES = [-0.5, 0.5] as const;
const HALO_RINGS = [3.4, 2.3, 1.55] as const;
const HALO_ALPHAS = [0.16, 0.28, 0.5] as const;

export class WaveTankLayer {
  /** Ridges and strokes drawn last frame, bells lit (level ≥ 0.25) and flashing, pillars lit (step ≥ 2) (for tools and the smoke test). */
  ridgesDrawn = 0;
  strokes = 0;
  litBells = 0;
  flashing = 0;
  litPillars = 0;
  /** --- pillar-flash --- How white the pillars were drawn last frame (0–1). */
  pillarFlash = 0;
  /** --- wave-glow --- The light step of each sample of the ridge being drawn, its line step, and the frame's water light (mean step, 0–5). */
  waterLight = 0;
  /** Where the front ridge's face ends (world px): the screen's top, which covers what the faces behind it spilled past it. */
  private frontBottom = 0;
  private pts = new Float32Array(0);
  private glowSteps = new Uint8Array(0);
  private lineSteps = new Uint8Array(0);
  private readonly edges: number[] = [];
  private readonly proj = {} as WaveTankProjection;

  /** The whole tank at simulation time `t` (s): the ridges back to front with the wall among them, then the screen and the bells. */
  drawStage(ctx: CanvasRenderingContext2D, view: WaveTankView, t: number, opts: WaveTankRenderOptions) {
    const p = waveTankProjection(view, this.proj);
    const R = view.ridges;
    const S = view.samples;
    if (this.pts.length < 2 * S) {
      this.pts = new Float32Array(2 * S);
      this.glowSteps = new Uint8Array(S);
      this.lineSteps = new Uint8Array(S);
    }
    const side = view.frame.side;
    const line = Math.max(1 / Math.max(1, opts.dpr), (1.6 * side) / 720);
    const lines = view.source === "line";
    let wallDrawn = !lines;
    this.ridgesDrawn = 0;
    this.strokes = 0;
    let lightSum = 0;
    let lightCount = 0;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // the tank's glass side edges, under everything
    ctx.strokeStyle = WT_LOOK.edge;
    ctx.lineWidth = 1.5 * line;
    ctx.globalAlpha = 0.7;
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
        // --- review fix (D1) --- the wave-maker after the last ridge behind the wall: their crests no longer cover it
        this.drawSource(ctx, view, p, line, t);
        this.drawWall(ctx, view, p, line, t);
        wallDrawn = true;
      }
      // the face reaches down to where the next ridge's deepest trough can be; the front one's down to the front edge (or its
      // own trough, when it dips under it): under it is the screen
      const bottom = r < R - 1 ? projectTank(p, 0, -WT_HEIGHT * this.dipOf(view, r + 1), view.ridgeZ[r + 1], PT).y + 2 * line : -1;
      const light = this.drawRidge(ctx, view, p, r, line, bottom, lines && z < view.barrierZ0);
      lightSum += light;
      lightCount++;
    }
    this.waterLight = lightCount > 0 ? lightSum / lightCount : 0;
    if (!wallDrawn) {
      this.drawSource(ctx, view, p, line, t);
      this.drawWall(ctx, view, p, line, t);
    }
    if (!lines) this.drawPointSources(ctx, view, p, side, t);
    this.drawScreen(ctx, view, p, side, line, t);
    this.drawBells(ctx, view, p, t, side, opts);
    ctx.restore();
  }

  /** How deep ridge `r`'s lowest trough is (amplitude units, 0 … WT_HEIGHT_CLIP): the face behind it need reach no lower. */
  private dipOf(view: WaveTankView, r: number): number {
    const S = view.samples;
    let low = 0;
    for (let s = r * S, end = s + S; s < end; s++) {
      const u = view.heights[s];
      if (u < low) low = u;
    }
    return Math.min(WT_HEIGHT_CLIP, Number.isFinite(low) ? -low : WT_HEIGHT_CLIP);
  }

  /**
   * One ridge: its face filled by the water's light step under each sample (one path a step) down to `bottom` (−1: the front
   * ridge, down to the front edge or its own lowest point), then its line by height (one path a step). Returns the ridge's mean
   * light step.
   */
  private drawRidge(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, r: number, line: number, bottomAt: number, incoming: boolean): number {
    const S = view.samples;
    const z = view.ridgeZ[r];
    const base = r * S;
    const pts = this.pts;
    const gs = this.glowSteps;
    const ls = this.lineSteps;
    const ref = Math.max(1e-6, view.glowReference);
    const glow = view.glow;
    let light = 0;
    for (let s = 0; s < S; s++) {
      let u = view.heights[base + s];
      if (!Number.isFinite(u)) u = 0;
      if (u > WT_HEIGHT_CLIP) u = WT_HEIGHT_CLIP;
      else if (u < -WT_HEIGHT_CLIP) u = -WT_HEIGHT_CLIP;
      projectTank(p, view.sampleX[s], u * WT_HEIGHT, z, PT);
      pts[2 * s] = PT.x;
      pts[2 * s + 1] = PT.y;
      const g = glow.length > base + s ? glow[base + s] : 0;
      const step = incoming ? WT_INCOMING_STEP : glowStep(Number.isFinite(g) ? g : 0, ref, WT_WATER.length);
      gs[s] = step;
      light += step;
      // the line: a crest (the upper part of a lit swing), a slope, or a trough
      ls[s] = u > WT_CREST_SHARE * Math.max(g, 1e-6) && (incoming || g > 0.2 * ref) ? 2 : u > 0 ? 1 : 0;
    }
    let bottom = bottomAt;
    if (bottom < 0) {
      bottom = p.frontY;
      for (let s = 0; s < S; s++) if (pts[2 * s + 1] > bottom) bottom = pts[2 * s + 1];
      bottom += 0.5 * line;
      this.frontBottom = bottom;
    }
    ctx.globalAlpha = 1;
    // the face, step by step: each run of samples on one step is a band from the line down to `bottom`
    for (let k = 0; k < WT_WATER.length; k++) {
      let any = false;
      ctx.beginPath();
      let s = 0;
      while (s < S) {
        if (gs[s] !== k) {
          s++;
          continue;
        }
        const s0 = s;
        while (s + 1 < S && gs[s + 1] === k) s++;
        // half a sample past each end, so neighbouring runs meet without a seam
        const a = s0 > 0 ? s0 - 0.5 : 0;
        const b = s < S - 1 ? s + 0.5 : S - 1;
        const ax = lerpAt(pts, a, 0);
        const ay = lerpAt(pts, a, 1);
        ctx.moveTo(ax, bottom);
        ctx.lineTo(ax, ay);
        for (let q = s0; q <= s; q++) ctx.lineTo(pts[2 * q], pts[2 * q + 1]);
        ctx.lineTo(lerpAt(pts, b, 0), lerpAt(pts, b, 1));
        ctx.lineTo(lerpAt(pts, b, 0), bottom);
        ctx.closePath();
        any = true;
        s++;
      }
      if (!any) continue;
      ctx.fillStyle = WT_WATER[k];
      ctx.fill();
    }
    // the line by height: troughs dim, slopes cyan, crests near white and wider
    for (let k = 0; k < WT_LINES.length; k++) {
      let open = false;
      let any = false;
      ctx.beginPath();
      for (let s = 0; s < S - 1; s++) {
        const seg = Math.max(ls[s], ls[s + 1]);
        if (seg !== k) {
          open = false;
          continue;
        }
        if (!open) ctx.moveTo(pts[2 * s], pts[2 * s + 1]);
        ctx.lineTo(pts[2 * s + 2], pts[2 * s + 3]);
        open = true;
        any = true;
      }
      if (!any) continue;
      ctx.strokeStyle = WT_LINES[k];
      // (the crests a little wider: a second, soft glow stroke under them cost a fifth of the frame in a software canvas)
      ctx.globalAlpha = WT_STEP_ALPHA[k];
      ctx.lineWidth = k === 2 ? 1.8 * line : line;
      ctx.stroke();
      this.strokes++;
    }
    ctx.globalAlpha = 1;
    this.ridgesDrawn++;
    return light / Math.max(1, S);
  }

  /**
   * The wave-maker: a golden paddle along the back, standing a crest's height (WT_SOURCE_LIFT) above the water, brighter and
   * thicker as it pushes (the source's own cycle). --- review fix (D1) --- drawn after the ridges behind the wall and lifted
   * over their crests, whose faces hid the bar at the water line.
   */
  private drawSource(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, line: number, t: number) {
    const pulse = 0.5 + 0.5 * Math.cos(2 * Math.PI * view.frequency * t);
    const lift = WT_SOURCE_LIFT * WT_HEIGHT;
    // the paddle's face, from the water line up to the bar
    const w0 = projectTank(p, -0.5, 0, view.sourceZ, PT);
    const w0x = w0.x;
    const w0y = w0.y;
    const w1 = projectTank(p, 0.5, 0, view.sourceZ, PT2);
    const w1x = w1.x;
    const w1y = w1.y;
    const a = projectTank(p, -0.5, lift, view.sourceZ, PT);
    const ax = a.x;
    const ay = a.y;
    const b = projectTank(p, 0.5, lift, view.sourceZ, PT2);
    ctx.globalAlpha = 0.35 + 0.2 * pulse;
    ctx.fillStyle = WT_LOOK.sourceGlow;
    ctx.beginPath();
    ctx.moveTo(w0x, w0y);
    ctx.lineTo(w1x, w1y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(ax, ay);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.25 + 0.3 * pulse;
    ctx.strokeStyle = WT_LOOK.sourceGlow;
    ctx.lineWidth = (5 + 4 * pulse) * line;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1 - WT_SOURCE_PULSE * (1 - pulse);
    ctx.strokeStyle = WT_LOOK.source;
    ctx.lineWidth = 2.4 * line;
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.strokes++;
  }

  /** The barrier: a light slate wall on the water across the tank, its gaps lit; at a section change it flashes and the gaps burst. */
  private drawWall(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, line: number, t: number) {
    const z0 = view.barrierZ0;
    const z1 = view.barrierZ1;
    const hTop = WT_WALL_HEIGHT;
    const half = view.gapWidth / 2;
    const since = view.changeSec >= 0 ? t - view.changeSec : Infinity;
    const flash = since >= 0 && since < WT_WALL_FLASH_SEC ? 1 - since / WT_WALL_FLASH_SEC : 0;
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
      if (flash > 0) {
        ctx.globalAlpha = 0.85 * flash;
        ctx.fillStyle = WT_LOOK.wallFlash;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
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
    // the gaps: light where the water squeezes through (a halo, then the opening), bursting open after a change
    const burst = 1 + 1.6 * flash;
    for (let i = 1; i + 1 < edges.length; i += 2) {
      const a = edges[i];
      const b = edges[i + 1];
      if (!(b > a)) continue;
      const mid = projectTank(p, (a + b) / 2, hTop * 0.5, (z0 + z1) / 2, PT);
      const mx = mid.x;
      const my = mid.y;
      const w = Math.max(2 * line, Math.abs(projectTank(p, b, 0, z1, PT2).x - projectTank(p, a, 0, z1, PT).x));
      ctx.fillStyle = WT_LOOK.gapLight;
      ctx.globalAlpha = 0.28 * burst;
      ctx.beginPath();
      ctx.ellipse(mx, my, 1.4 * w * burst, 0.9 * w * burst, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, 0.85 + 0.15 * flash);
      ctx.beginPath();
      ctx.ellipse(mx, my, 0.55 * w, 0.35 * w, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Point sources (no barrier): golden dots where the gaps would be, pulsing with the wave they make. */
  private drawPointSources(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, side: number, t: number) {
    const pulse = 0.5 + 0.5 * Math.cos(2 * Math.PI * view.frequency * t);
    const r = 0.008 * side;
    ctx.fillStyle = WT_LOOK.source;
    for (const g of view.gapX) {
      projectTank(p, g, 0, view.barrierZ0, PT);
      ctx.globalAlpha = 0.2 + 0.25 * pulse;
      ctx.beginPath();
      ctx.arc(PT.x, PT.y, (2 + 1.2 * pulse) * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(PT.x, PT.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * --- wave-glow --- The screen in front of the water: WT_FRONT_COLUMNS pillars standing on the bells' rail, each as tall and
   * as bright as the water's amplitude at the front edge above it (against the row's brightest), one path a light step.
   */
  private drawScreen(ctx: CanvasRenderingContext2D, view: WaveTankView, p: WaveTankProjection, side: number, line: number, t: number) {
    const n = view.front.length;
    this.litPillars = 0;
    this.pillarFlash = 0;
    if (n === 0) return;
    // against the row's brightest, but never under WT_PILLAR_FLOOR of the incoming wave: a row that is even everywhere (one narrow
    // gap) stands half tall, a grating's beams full height
    let ref = WT_PILLAR_FLOOR;
    for (let i = 0; i < n; i++) if (view.front[i] > ref && Number.isFinite(view.front[i])) ref = view.front[i];
    const left = projectTank(p, -0.5, 0, view.depth, PT).x;
    const right = projectTank(p, 0.5, 0, view.depth, PT2).x;
    const w = (right - left) / n;
    const floor = p.bellY - WT_BELL_RADIUS * side * 1.6;
    // the screen's panel: the page's colour from under the water to under the bells (the faces behind the front one reach past it)
    ctx.globalAlpha = 1;
    ctx.fillStyle = WT_LOOK.screen;
    ctx.fillRect(left - 2 * line, Math.max(p.frontY, this.frontBottom), right - left + 4 * line, p.bellY + 3 * WT_BELL_RADIUS * side - Math.max(p.frontY, this.frontBottom));
    const tall = Math.max(2, floor - p.frontY - 3 * line);
    for (let k = 0; k < WT_PILLARS.length; k++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = Number.isFinite(view.front[i]) ? Math.max(0, view.front[i]) : 0;
        const q = a / ref;
        const step = glowStep(a, ref, WT_PILLARS.length);
        if (step !== k) continue;
        if (k === 0 && q < 0.04) continue;
        const h = tall * Math.max(0.04, q);
        ctx.rect(left + i * w + 0.12 * w, floor - h, 0.76 * w, h);
        any = true;
        if (k >= 2) this.litPillars++;
      }
      if (!any) continue;
      ctx.fillStyle = WT_PILLARS[k];
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 0.55 + 0.15 * k;
      ctx.fill();
    }
    // --- pillar-flash --- (round two, B8) the climax's flash: every pillar drawn above, again in white (one path)
    const flash = pillarFlash(view, t);
    if (flash > 0) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = Number.isFinite(view.front[i]) ? Math.max(0, view.front[i]) : 0;
        const q = a / ref;
        if (glowStep(a, ref, WT_PILLARS.length) === 0 && q < 0.04) continue;
        const h = tall * Math.max(0.04, q);
        ctx.rect(left + i * w + 0.12 * w, floor - h, 0.76 * w, h);
      }
      ctx.fillStyle = WT_LOOK.wallFlash;
      ctx.globalAlpha = flash;
      ctx.fill();
      this.pillarFlash = flash;
    }
    // the screen's base line
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = WT_LOOK.edge;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(left, floor + 0.5 * line);
    ctx.lineTo(right, floor + 0.5 * line);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** The bells on their rail: amber halos by the smoothed amplitude, brass dots, a flash on a strike. */
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
      ctx.arc(x, y, r * (1 + 0.3 * flash), 0, Math.PI * 2);
      ctx.fill();
      if (flash > 0) {
        ctx.globalAlpha = 0.7 * flash;
        ctx.strokeStyle = WT_LOOK.brassLit;
        ctx.lineWidth = Math.max(1 / Math.max(1, opts.dpr), 0.3 * r);
        ctx.beginPath();
        ctx.arc(x, y, r * (1.6 + 1.4 * (1 - flash)), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** The point `i` (a fractional sample index) of an interleaved x, y buffer, coordinate `c` (0: x, 1: y), linearly between samples. */
function lerpAt(pts: Float32Array, i: number, c: 0 | 1): number {
  const a = Math.floor(i);
  const f = i - a;
  if (f <= 0) return pts[2 * a + c];
  return pts[2 * a + c] * (1 - f) + pts[2 * (a + 1) + c] * f;
}

/** The canvas' data-wt-* keys (cleared when another mode runs). */
export const WAVE_TANK_DATA_KEYS = ["wtModel", "wtSource", "wtTime", "wtLoop", "wtLoopIndex", "wtSection", "wtGaps", "wtChanges", "wtSectionChanges", "wtSeams", "wtSeamError", "wtNan", "wtMax", "wtGrid", "wtSubsteps", "wtClamped", "wtPreroll", "wtFreq", "wtLambda", "wtCycles", "wtBells", "wtLevels", "wtReference", "wtStrikes", "wtSkipped", "wtCursor", "wtSounds", "wtRoots", "wtRootHz", "wtRidges", "wtSamples", "wtDrawn", "wtStrokes", "wtLit", "wtFlashing", "wtLag", "wtTilt", "wtGlowRef", "wtWaterLight", "wtPillars", "wtImpacts", "wtChords", "wtClimax"] as const;

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
  // --- wave-glow --- --- wave-chapters ---
  set("wtGlowRef", view.glowReference.toFixed(3));
  set("wtWaterLight", layer.waterLight.toFixed(2));
  set("wtPillars", String(layer.litPillars));
  set("wtImpacts", String(view.impacts));
  set("wtChords", String(view.chords));
  set("wtClimax", view.climax ? "1" : "0");
}
