import { MAX_SPLASHES, SLOT_FLYING, type VortexView } from "@/lib/physics/modes/vortex";
import { funnelDepthKey, funnelDrawOrder, funnelZ, projectFunnel, type FunnelFrame } from "@/lib/physics/funnelSpin";

/*
 * --- funnel-spin --- The Sound Vortex in perspective (components/simulator/vortexRenderer.ts hands its layer's calls here while
 * the view is "perspective"): the funnel the loop clip shows, seen from the camera elevation – a translucent navy surface of
 * revolution z(r) = −depth · 0.2 · R · (R / r − 1) (#1a2a55 at 40 %), a faint mesh of rings (the sound rings, flashing as a ring
 * of marbles sinks past) and spokes, the spout narrowing to a dark elliptical hole, the pale 1.5 px rim (#9fb3e0) – and the
 * marbles as glossy spheres in their colours, depth-sorted far to near (`funnelDrawOrder()`), every one behind the front lip,
 * which is stroked last. Everything is projected at draw time from the marbles' (r, θ), so a live change of the camera moves
 * them while the run is paused; the outline and the spokes are cached while the layout stays put (no allocation per frame
 * besides the sort's comparator call).
 *
 * The ring release's overlay (both views): with the loop HUD off, its title and the optional lap readout in the corner of the
 * square (with the HUD on, the HUD carries them).
 */

/** The funnel's look. */
export const FUNNEL_FILL = "rgba(26, 42, 85, 0.4)";
export const FUNNEL_MESH = "rgba(159, 179, 224, 0.13)";
export const FUNNEL_RIM = "#9fb3e0";
export const FUNNEL_HOLE = "#03050c";
/** Spokes of the mesh and the points along each (and along the outline). */
const SPOKES = 24;
const SPOKE_POINTS = 28;
const OUTLINE_POINTS = 96;
const TWO_PI = Math.PI * 2;
/** How long (ms) a mesh ring glows after a ring of marbles sank past it. */
const RING_FLASH_MS = 380;
const SPLASH_MS = 900;

export interface FunnelRenderOptions {
  /** The Ball Size (px): a marble's radius is this times the fit. */
  ballRadius: number;
  wallThickness: number;
}

export interface FunnelLabels {
  /** The ring release's title ("why marbles speed up in a funnel"). */
  title: string;
  /** "lap 1.23 s" */
  lapTime: (seconds: string) => string;
}

export class FunnelLayer {
  private key = "";
  /** The outline: the rim's far arc (top) and the lower envelope, as x, y pairs; the spokes' points. */
  private readonly top = new Float64Array(2 * (OUTLINE_POINTS + 1));
  private readonly bottom = new Float64Array(2 * (OUTLINE_POINTS + 1));
  private readonly spokes = new Float64Array(2 * SPOKES * (SPOKE_POINTS + 1));
  private keys = new Float64Array(64);
  private order = new Int32Array(64);
  private slots = new Int32Array(64);
  private readonly p = { x: 0, y: 0 };

  /** The cached outline and spokes for the frame (recomputed when it changes). */
  private layout(frame: FunnelFrame) {
    const key = `${frame.cx}|${frame.cy0}|${frame.scale}|${frame.sinE}|${frame.cosE}|${frame.rim}|${frame.hole}|${frame.depth}`;
    if (key === this.key) return;
    this.key = key;
    const { rim, hole } = frame;
    const s = frame.scale;
    const sinE = Math.abs(frame.sinE);
    // the rim's far arc along the top, and the lower envelope of every level's ellipse (sampled down to the hole)
    for (let i = 0; i <= OUTLINE_POINTS; i++) {
      const u = -1 + (2 * i) / OUTLINE_POINTS;
      const dx = u * rim;
      this.top[2 * i] = frame.cx + s * dx;
      this.top[2 * i + 1] = frame.cy0 - s * Math.sqrt(Math.max(0, rim * rim - dx * dx)) * sinE;
      let low = -Infinity;
      for (let j = 0; j <= SPOKE_POINTS; j++) {
        const r = rim * Math.pow(hole / rim, j / SPOKE_POINTS);
        if (r < Math.abs(dx)) break;
        const y = Math.sqrt(Math.max(0, r * r - dx * dx)) * sinE - funnelZ(frame, r) * frame.cosE;
        if (y > low) low = y;
      }
      this.bottom[2 * i] = frame.cx + s * dx;
      this.bottom[2 * i + 1] = frame.cy0 + s * (Number.isFinite(low) ? low : 0);
    }
    // the spokes: from the rim down to the hole, geometric in r (denser by the spout)
    for (let k = 0; k < SPOKES; k++) {
      const th = (k * TWO_PI) / SPOKES;
      for (let j = 0; j <= SPOKE_POINTS; j++) {
        const r = rim * Math.pow(hole / rim, j / SPOKE_POINTS);
        projectFunnel(frame, r, th, this.p);
        const at = 2 * (k * (SPOKE_POINTS + 1) + j);
        this.spokes[at] = this.p.x;
        this.spokes[at + 1] = this.p.y;
      }
    }
  }

  /** The level ellipse of radius `r`: its centre's y, its radii (screen px). */
  private ellipseAt(ctx: CanvasRenderingContext2D, frame: FunnelFrame, r: number, start = 0, end = TWO_PI) {
    const cy = frame.cy0 - frame.scale * funnelZ(frame, r) * frame.cosE;
    const rx = Math.max(0.01, frame.scale * r);
    const ry = Math.max(0.01, frame.scale * r * Math.abs(frame.sinE));
    ctx.ellipse(frame.cx, cy, rx, ry, 0, start, end);
  }

  /** Under the marbles: the surface, the mesh, the hole and the rim's far half. */
  drawWorld(ctx: CanvasRenderingContext2D, view: VortexView, opts: FunnelRenderOptions) {
    const frame = view.funnel.frame;
    if (!(frame.rim > 0)) return;
    this.layout(frame);
    ctx.save();
    ctx.globalAlpha = 1;
    // the translucent surface
    ctx.fillStyle = FUNNEL_FILL;
    ctx.beginPath();
    for (let i = 0; i <= OUTLINE_POINTS; i++) {
      if (i === 0) ctx.moveTo(this.top[0], this.top[1]);
      else ctx.lineTo(this.top[2 * i], this.top[2 * i + 1]);
    }
    for (let i = OUTLINE_POINTS; i >= 0; i--) ctx.lineTo(this.bottom[2 * i], this.bottom[2 * i + 1]);
    ctx.closePath();
    ctx.fill();
    // the mesh: the spokes, then the sound rings (a ring glows a moment after a ring of marbles sank past it)
    ctx.lineWidth = 1;
    ctx.strokeStyle = FUNNEL_MESH;
    ctx.beginPath();
    for (let k = 0; k < SPOKES; k++) {
      for (let j = 0; j <= SPOKE_POINTS; j++) {
        const at = 2 * (k * (SPOKE_POINTS + 1) + j);
        if (j === 0) ctx.moveTo(this.spokes[at], this.spokes[at + 1]);
        else ctx.lineTo(this.spokes[at], this.spokes[at + 1]);
      }
    }
    ctx.stroke();
    const f = view.field;
    for (let i = 0; i < f.ringCount; i++) {
      const age = view.timeMs - view.ringHitMs[i];
      const flash = age >= 0 && age < RING_FLASH_MS ? 1 - age / RING_FLASH_MS : 0;
      ctx.lineWidth = 1 + 1.5 * flash;
      ctx.strokeStyle = flash > 0 ? `rgba(159, 179, 224, ${(0.13 + 0.5 * flash).toFixed(2)})` : FUNNEL_MESH;
      ctx.beginPath();
      this.ellipseAt(ctx, frame, f.rings[i]);
      ctx.stroke();
    }
    // the hole: dark, its lip lime for a moment when it swallows a marble
    ctx.fillStyle = FUNNEL_HOLE;
    ctx.beginPath();
    this.ellipseAt(ctx, frame, frame.hole);
    ctx.fill();
    const since = view.timeMs - view.lastSwallowMs;
    const pulse = since >= 0 && since < 500 ? 1 - since / 500 : 0;
    ctx.lineWidth = 1.5 + 1.5 * pulse;
    ctx.strokeStyle = pulse > 0 ? `rgba(147, 209, 25, ${(0.4 + 0.6 * pulse).toFixed(2)})` : "rgba(159, 179, 224, 0.35)";
    ctx.beginPath();
    this.ellipseAt(ctx, frame, frame.hole);
    ctx.stroke();
    // the rim's far half (the near half – the front lip – is stroked over the marbles)
    ctx.lineWidth = Math.max(1.5, 0.75 * opts.wallThickness);
    ctx.strokeStyle = FUNNEL_RIM;
    ctx.beginPath();
    this.ellipseAt(ctx, frame, frame.rim, frame.sinE >= 0 ? Math.PI : 0, frame.sinE >= 0 ? TWO_PI : Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  /** The marbles in the funnel as glossy spheres, far to near, then the front lip over them. */
  drawBodies(ctx: CanvasRenderingContext2D, view: VortexView, opts: FunnelRenderOptions) {
    const frame = view.funnel.frame;
    if (!(frame.rim > 0)) return;
    const n = view.slotCount;
    if (this.keys.length < n) {
      const size = Math.max(n, 2 * this.keys.length);
      this.keys = new Float64Array(size);
      this.order = new Int32Array(size);
      this.slots = new Int32Array(size);
    }
    let count = 0;
    for (let s = 0; s < n; s++) {
      if (view.slotState[s] !== SLOT_FLYING) continue;
      this.slots[count] = s;
      this.keys[count] = funnelDepthKey(frame, view.slotR[s], view.slotTheta[s]);
      count++;
    }
    const drawn = funnelDrawOrder(this.keys, count, this.order);
    const radius = Math.max(1, opts.ballRadius * frame.scale);
    ctx.save();
    ctx.globalAlpha = 1;
    for (let i = 0; i < drawn; i++) {
      const s = this.slots[this.order[i]];
      projectFunnel(frame, view.slotR[s], view.slotTheta[s], this.p);
      const { x, y } = this.p;
      ctx.fillStyle = view.slotColor[s];
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TWO_PI);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(x - 0.3 * radius, y - 0.3 * radius, 0.5 * radius, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(x - 0.38 * radius, y - 0.4 * radius, 0.18 * radius, 0, TWO_PI);
      ctx.fill();
    }
    // the front lip: every marble is inside the funnel, behind it
    ctx.lineWidth = Math.max(1.5, 0.75 * opts.wallThickness);
    ctx.strokeStyle = FUNNEL_RIM;
    ctx.beginPath();
    this.ellipseAt(ctx, frame, frame.rim, frame.sinE >= 0 ? 0 : Math.PI, frame.sinE >= 0 ? Math.PI : TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  /** Over the marbles: the splashes of the stagger release, as ripples spreading round the hole's level. */
  drawEffects(ctx: CanvasRenderingContext2D, view: VortexView) {
    const frame = view.funnel.frame;
    if (!(frame.rim > 0) || view.splashCount === 0) return;
    ctx.save();
    const first = Math.max(0, view.splashCount - MAX_SPLASHES);
    for (let n = first; n < view.splashCount; n++) {
      const k = n % MAX_SPLASHES;
      const age = view.timeMs - view.splashMs[k];
      if (!(age >= 0 && age < SPLASH_MS)) continue;
      const u = age / SPLASH_MS;
      ctx.globalAlpha = 0.7 * (1 - u);
      ctx.strokeStyle = view.splashColor[k];
      ctx.lineWidth = 2 * (1 - 0.7 * u);
      ctx.beginPath();
      this.ellipseAt(ctx, frame, frame.hole * (1 + 1.5 * u));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The ring release's corner title and lap readout (only without the loop HUD, which carries them otherwise). */
  drawOverlay(ctx: CanvasRenderingContext2D, view: VortexView, labels: FunnelLabels, inset = 0, hud = false) {
    const f = view.field;
    if (hud || !(f.size > 0)) return;
    const left = f.cx - f.size / 2 + 0.035 * f.size;
    const top = f.cy - f.size / 2 + 0.03 * f.size + inset;
    const fs = Math.max(11, 0.03 * f.size);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillText(labels.title, left, top + 0.6 * fs);
    const fv = view.funnel;
    if (fv.lapReadout && fv.newestWave >= 0 && Number.isFinite(fv.lapSec)) {
      ctx.font = `700 ${(0.8 * fs).toFixed(1)}px sans-serif`;
      ctx.fillStyle = "#f2c46a";
      ctx.fillText(labels.lapTime(fv.lapSec.toFixed(2)), left, top + 1.85 * fs);
    }
    ctx.restore();
  }
}

/** How far (px) the funnel reaches above or below its rim's centre on the screen: the live loop HUD keeps its lines outside it. */
export function funnelExtentPx(view: VortexView): number {
  const frame = view.funnel.frame;
  const f = view.field;
  if (view.funnel.view !== "perspective" || !(frame.rim > 0)) return f.rim;
  const s = frame.scale;
  const sinE = Math.abs(frame.sinE);
  const zh = funnelZ(frame, frame.hole);
  const top = frame.cy0 + s * Math.min(-frame.rim * sinE, -zh * frame.cosE - frame.hole * sinE);
  const bottom = frame.cy0 + s * Math.max(frame.rim * sinE, -zh * frame.cosE + frame.hole * sinE);
  return Math.max(f.cy - top, bottom - f.cy, 1);
}
