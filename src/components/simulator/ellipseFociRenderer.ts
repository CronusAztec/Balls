import type { EllipseFociView } from "@/lib/physics/modes/ellipseFoci";
import { EF_PATH_POINT_BUDGET, bloomLevel, convergenceFoci, toWorld } from "@/lib/physics/ellipseFoci";

/*
 * --- ellipse-foci --- Focus Shot's picture (lib/physics/modes/ellipseFoci.ts runs it), drawn in world px under the page's camera:
 *
 * - the pool, by skin: the **table** (a wide dark wooden rim, a thin copper rail and green felt, the clip's look), **neon** (the
 *   ellipse as a glowing line in the Wall Color) or **minimal** (a thin grey line);
 * - the two focus markers (small hollow circles);
 * - the **paths** overlay (optional): every chord of the loop so far, faint, within the Lines mode's stroke budget;
 * - the **comet trails**: each ball's path over the last Trail Length seconds of flight, cut out of the ball's ring of corners
 *   (the launch and the wall hits since – the path between two corners is straight at a constant speed, so the trail is
 *   exactly the flight, at any frame rate) and stroked in TRAIL_BANDS bands that taper and fade to nothing toward the tail;
 * - the balls (the hue wheel by launch angle, a soft halo, batched by hue);
 * - the **bloom**: a white radial flash on the focus at every convergence (a 120 ms swell to the convergence, 400 ms decay) – at
 *   a refire that fires from the other focus, on both.
 *
 * Nothing per ball allocates per frame once a run's buffers exist: the hue buckets and the trail points reuse typed arrays sized
 * for the volley, the felt's gradient is kept while the pool stays put, and only a bloom makes a gradient of its own.
 */

/** What the canvas hands the layer each frame. */
export interface EllipseFociRenderOptions {
  /** Device px per world px (hairlines stay a device pixel or two). */
  dpr: number;
  /** The page's Wall Color (the neon and minimal outlines) and Wall Thickness (their width). */
  wallColor: string;
  wallThickness: number;
  /** Ball Glow: a stronger halo on the balls. */
  showGlow: boolean;
}

/** The table skin's colours: the clip's near-black page, the dark wooden rim, the copper rail, the green felt. */
export const EF_TABLE = { rim: "#2b1d16", rimEdge: "#1a110c", rimSheen: "rgba(255, 214, 170, 0.07)", rail: "#b07a4a", felt: "#15452f", feltCentre: "#1b5a3d", feltEdge: "#103426" } as const;
/** The rim's width and the rail's, as shares of the major semi-axis (the clip: 18 px and 2–3 px for 371). */
export const EF_RIM_SHARE = 0.0485;
export const EF_RAIL_SHARE = 0.0075;
/** The focus markers' radius (share of the major semi-axis) and the bloom's. */
export const EF_MARKER_SHARE = 0.011;
export const EF_BLOOM_SHARE = 0.1;
/** Bands a comet trail is drawn in (each a little thinner and fainter toward the tail). */
export const TRAIL_BANDS = 6;
/** Hue buckets the balls, trails and paths are batched by (5° each). */
export const HUE_BUCKETS = 72;

const BUCKET_COLORS: string[] = Array.from({ length: HUE_BUCKETS }, (_, b) => `hsl(${b * 5 + 2.5}, 95%, 62%)`);
const POINT = { x: 0, y: 0 };

export class EllipseFociLayer {
  private generation = -1;
  private count = 0;
  /** Ball indexes sorted by hue bucket, and where each bucket starts in it. */
  private order = new Int32Array(0);
  private bucketStart = new Int32Array(HUE_BUCKETS + 1);
  /** Every ball's trail this frame: up to `cap + 2` points (time, x, y) from the head back to the tail's cut. */
  private trailT = new Float64Array(0);
  private trailX = new Float64Array(0);
  private trailY = new Float64Array(0);
  private trailLen = new Int32Array(0);
  private cap = 0;
  /** The felt's gradient and what it was made for (the context, the centre, the radius). */
  private felt: CanvasGradient | null = null;
  private feltCtx: CanvasRenderingContext2D | null = null;
  private readonly feltAt = [Number.NaN, Number.NaN, Number.NaN];
  /** What the last frame drew (data-ef-*): trail points, path points, the bloom. */
  trailPoints = 0;
  pathPoints = 0;
  bloom = 0;

  /** Sorts the balls into hue buckets and sizes the trail buffers (once per run). */
  private prepare(view: EllipseFociView) {
    if (view.generation === this.generation && view.count === this.count) return;
    this.generation = view.generation;
    this.count = view.count;
    const n = view.count;
    if (this.order.length !== n) this.order = new Int32Array(n);
    const counts = new Int32Array(HUE_BUCKETS);
    for (let i = 0; i < n; i++) counts[bucketOf(view.hues[i])]++;
    this.bucketStart[0] = 0;
    for (let b = 0; b < HUE_BUCKETS; b++) this.bucketStart[b + 1] = this.bucketStart[b] + counts[b];
    const fill = this.bucketStart.slice(0, HUE_BUCKETS);
    for (let i = 0; i < n; i++) this.order[fill[bucketOf(view.hues[i])]++] = i;
    this.cap = view.vertexCap + 2;
    if (this.trailLen.length !== n || this.trailT.length !== n * this.cap) {
      this.trailT = new Float64Array(n * this.cap);
      this.trailX = new Float64Array(n * this.cap);
      this.trailY = new Float64Array(n * this.cap);
      this.trailLen = new Int32Array(n);
    }
  }

  /** The pool (by skin), the focus markers, the paths overlay and the comet trails – everything under the balls. */
  drawStage(ctx: CanvasRenderingContext2D, view: EllipseFociView, opts: EllipseFociRenderOptions) {
    this.prepare(view);
    const f = view.frame;
    const a = f.scale;
    const b = view.b * f.scale;
    const rx = f.vertical ? b : a;
    const ry = f.vertical ? a : b;
    const skin = view.settings.skin;
    ctx.save();
    if (skin === "table") {
      const rim = Math.max(2, EF_RIM_SHARE * a);
      // the wooden rim: a darker outer edge, a faint sheen along it
      ctx.fillStyle = EF_TABLE.rimEdge;
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, rx + rim, ry + rim, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = EF_TABLE.rim;
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, rx + rim * 0.82, ry + rim * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = EF_TABLE.rimSheen;
      ctx.lineWidth = Math.max(0.6, rim * 0.18);
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, rx + rim * 0.55, ry + rim * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      // the felt, a little lighter in the middle
      ctx.fillStyle = this.feltOf(ctx, f.cx, f.cy, Math.max(rx, ry));
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // the copper rail (the cushion the balls bounce off), with a shadow inside it
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(1, EF_RAIL_SHARE * a * 1.6);
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, Math.max(0, rx - EF_RAIL_SHARE * a), Math.max(0, ry - EF_RAIL_SHARE * a), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = EF_TABLE.rail;
      ctx.lineWidth = Math.max(1.2 / Math.max(0.5, opts.dpr), EF_RAIL_SHARE * a);
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (skin === "neon") {
      const width = Math.max(1.5, opts.wallThickness);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = opts.wallColor;
      for (const [w, alpha] of [
        [width * 5, 0.08],
        [width * 2.6, 0.18],
        [width, 0.95],
      ] as const) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.ellipse(f.cx, f.cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.strokeStyle = "rgba(170, 180, 196, 0.75)";
      ctx.lineWidth = Math.max(1, opts.wallThickness * 0.6);
      ctx.beginPath();
      ctx.ellipse(f.cx, f.cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the focus markers: small hollow circles
    const marker = Math.max(1.5, EF_MARKER_SHARE * a);
    ctx.strokeStyle = skin === "neon" ? opts.wallColor : "rgba(222, 226, 232, 0.85)";
    ctx.lineWidth = Math.max(0.6, 1.1 / Math.max(0.5, opts.dpr));
    for (const u of [-view.e, view.e]) {
      toWorld(f, u, 0, POINT);
      ctx.beginPath();
      ctx.arc(POINT.x, POINT.y, marker, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (view.settings.paths) this.drawPaths(ctx, view, opts);
    else this.pathPoints = 0;
    this.drawTrails(ctx, view);
  }

  /** The felt's radial gradient, made again only when the context or the pool's place or size changed. */
  private feltOf(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): CanvasGradient {
    const at = this.feltAt;
    if (this.felt && this.feltCtx === ctx && at[0] === cx && at[1] === cy && at[2] === radius) return this.felt;
    const felt = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    felt.addColorStop(0, EF_TABLE.feltCentre);
    felt.addColorStop(0.7, EF_TABLE.felt);
    felt.addColorStop(1, EF_TABLE.feltEdge);
    this.felt = felt;
    this.feltCtx = ctx;
    at[0] = cx;
    at[1] = cy;
    at[2] = radius;
    return felt;
  }

  /**
   * Every ball's corners since its volley (and on to where it is), faint, at most EF_PATH_POINT_BUDGET points in all: a big
   * volley draws its newest corners, and past half the budget in balls every `stride`-th ball's path.
   */
  private drawPaths(ctx: CanvasRenderingContext2D, view: EllipseFociView, opts: EllipseFociRenderOptions) {
    const n = view.count;
    const stride = Math.max(1, Math.ceil((2 * n) / EF_PATH_POINT_BUDGET));
    const shown = Math.max(1, Math.ceil(n / stride));
    // points a drawn ball may use, its position now included (at least a corner and the position)
    const perBall = Math.max(2, Math.floor(EF_PATH_POINT_BUDGET / shown));
    const cap = view.vertexCap;
    let points = 0;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = Math.max(0.5, 0.9 / Math.max(0.5, opts.dpr));
    ctx.lineJoin = "round";
    for (let bucket = 0; bucket < HUE_BUCKETS; bucket++) {
      const from = this.bucketStart[bucket];
      const to = this.bucketStart[bucket + 1];
      if (to <= from) continue;
      ctx.strokeStyle = BUCKET_COLORS[bucket];
      ctx.beginPath();
      for (let o = from; o < to; o++) {
        const i = this.order[o];
        const len = view.vtLen[i];
        if (len === 0 || i % stride !== 0) continue;
        const keep = Math.min(len, perBall - 1);
        // oldest kept corner first
        let first = true;
        for (let j = keep - 1; j >= 0; j--) {
          const at = i * cap + ((view.vtHead[i] - j + cap) % cap);
          toWorld(view.frame, view.vtU[at], view.vtW[at], POINT);
          if (first) ctx.moveTo(POINT.x, POINT.y);
          else ctx.lineTo(POINT.x, POINT.y);
          first = false;
          points++;
        }
        ctx.lineTo(view.x[i], view.y[i]);
        points++;
      }
      ctx.stroke();
    }
    ctx.restore();
    this.pathPoints = points;
  }

  /** Builds every ball's trail (head, corners, the cut at the tail) and strokes it in tapering, fading bands. */
  private drawTrails(ctx: CanvasRenderingContext2D, view: EllipseFociView) {
    const trail = view.settings.trailSec;
    const n = view.count;
    this.trailPoints = 0;
    if (!(trail > 0) || n === 0) return;
    const now = view.timeSec;
    const tail = now - trail;
    const cap = this.cap;
    const vcap = view.vertexCap;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const base = i * cap;
      let len = 0;
      this.trailT[base] = now;
      this.trailX[base] = view.x[i];
      this.trailY[base] = view.y[i];
      len = 1;
      const count = view.vtLen[i];
      for (let j = 0; j < count && len < cap; j++) {
        const at = i * vcap + ((view.vtHead[i] - j + vcap) % vcap);
        const t = view.vtT[at];
        toWorld(view.frame, view.vtU[at], view.vtW[at], POINT);
        if (t <= tail) {
          // the cut: between this corner and the point after it (constant speed along the straight piece)
          const tn = this.trailT[base + len - 1];
          const k = tn > t ? (tail - t) / (tn - t) : 0;
          this.trailT[base + len] = tail;
          this.trailX[base + len] = POINT.x + (this.trailX[base + len - 1] - POINT.x) * k;
          this.trailY[base + len] = POINT.y + (this.trailY[base + len - 1] - POINT.y) * k;
          len++;
          break;
        }
        if (t >= now) continue;
        this.trailT[base + len] = t;
        this.trailX[base + len] = POINT.x;
        this.trailY[base + len] = POINT.y;
        len++;
      }
      this.trailLen[i] = len;
      total += len;
    }
    this.trailPoints = total;
    const r = view.ballRadius;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let band = 0; band < TRAIL_BANDS; band++) {
      // band 0 at the head: the thickest and brightest
      const tA = now - (trail * band) / TRAIL_BANDS;
      const tB = now - (trail * (band + 1)) / TRAIL_BANDS;
      const fade = 1 - band / TRAIL_BANDS;
      ctx.globalAlpha = 0.85 * fade * fade;
      ctx.lineWidth = Math.max(0.3, 1.7 * r * fade);
      for (let bucket = 0; bucket < HUE_BUCKETS; bucket++) {
        const from = this.bucketStart[bucket];
        const to = this.bucketStart[bucket + 1];
        if (to <= from) continue;
        ctx.strokeStyle = BUCKET_COLORS[bucket];
        ctx.beginPath();
        let drawn = false;
        for (let o = from; o < to; o++) {
          if (this.subPath(ctx, this.order[o], tA, tB)) drawn = true;
        }
        if (drawn) ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Adds the piece of ball `i`'s trail between times tA (nearer the head) and tB (older) to the current path. */
  private subPath(ctx: CanvasRenderingContext2D, i: number, tA: number, tB: number): boolean {
    const base = i * this.cap;
    const len = this.trailLen[i];
    if (len < 2) return false;
    const T = this.trailT;
    const X = this.trailX;
    const Y = this.trailY;
    // the oldest point the trail reaches
    if (T[base + len - 1] > tA) return false;
    let started = false;
    for (let j = 0; j < len - 1; j++) {
      const t0 = T[base + j];
      const t1 = T[base + j + 1];
      if (t1 >= tA) continue; // this piece is newer than the band
      if (t0 <= tB) break; // older than the band
      // the piece [t1, t0] overlaps the band [tB, tA]
      const s0 = Math.min(t0, tA);
      const s1 = Math.max(t1, tB);
      const span = t0 - t1;
      const k0 = span > 0 ? (t0 - s0) / span : 0;
      const k1 = span > 0 ? (t0 - s1) / span : 1;
      const x0 = X[base + j] + (X[base + j + 1] - X[base + j]) * k0;
      const y0 = Y[base + j] + (Y[base + j + 1] - Y[base + j]) * k0;
      const x1 = X[base + j] + (X[base + j + 1] - X[base + j]) * k1;
      const y1 = Y[base + j] + (Y[base + j + 1] - Y[base + j]) * k1;
      if (!started) {
        ctx.moveTo(x0, y0);
        started = true;
      }
      ctx.lineTo(x1, y1);
    }
    return started;
  }

  /** The balls, batched by hue (a soft halo, then the bright dot), and the convergence bloom over them. */
  drawBodies(ctx: CanvasRenderingContext2D, view: EllipseFociView, opts: EllipseFociRenderOptions) {
    this.prepare(view);
    const r = view.ballRadius;
    ctx.save();
    for (const [scaleR, alpha] of [
      [opts.showGlow ? 3.2 : 2.2, opts.showGlow ? 0.22 : 0.14],
      [1, 1],
    ] as const) {
      ctx.globalAlpha = alpha;
      for (let bucket = 0; bucket < HUE_BUCKETS; bucket++) {
        const from = this.bucketStart[bucket];
        const to = this.bucketStart[bucket + 1];
        if (to <= from) continue;
        ctx.fillStyle = BUCKET_COLORS[bucket];
        ctx.beginPath();
        for (let o = from; o < to; o++) {
          const i = this.order[o];
          const x = view.x[i];
          const y = view.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          ctx.moveTo(x + r * scaleR, y);
          ctx.arc(x, y, r * scaleR, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    ctx.restore();
    this.drawBloom(ctx, view);
  }

  /** The white bloom on the focus of the nearest convergence (both foci at a refire from the other one). */
  private drawBloom(ctx: CanvasRenderingContext2D, view: EllipseFociView) {
    const T = view.settings.transitSec;
    this.bloom = 0;
    if (!(T > 0)) return;
    const now = view.timeSec;
    const k = Math.max(0, Math.round(now / T));
    const level = bloomLevel(now - k * T);
    if (level <= 0.002) return;
    this.bloom = level;
    const foci = convergenceFoci(view.settings.reset, view.settings.passes, k, view.focusU);
    const radius = Math.max(4, EF_BLOOM_SHARE * view.frame.scale);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const u of foci.launch !== null && foci.launch !== foci.arrival ? [foci.arrival, foci.launch] : [foci.arrival]) {
      toWorld(view.frame, u, 0, POINT);
      const g = ctx.createRadialGradient(POINT.x, POINT.y, 0, POINT.x, POINT.y, radius);
      g.addColorStop(0, `rgba(255, 255, 255, ${0.95 * level})`);
      g.addColorStop(0.25, `rgba(255, 255, 255, ${0.55 * level})`);
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(POINT.x, POINT.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** How far the pool reaches above and below its centre (world px, the table's rim included): the loop HUD keeps clear of it. */
export function ellipseFociExtentPx(view: EllipseFociView): number {
  const a = view.frame.scale;
  const half = view.frame.vertical ? a : view.b * a;
  return half + (view.settings.skin === "table" ? Math.max(2, EF_RIM_SHARE * a) : 0);
}

/** The hue bucket (0–71) of a hue in degrees. */
function bucketOf(hue: number): number {
  const b = Math.floor((((hue % 360) + 360) % 360) / 5);
  return b < 0 ? 0 : b >= HUE_BUCKETS ? HUE_BUCKETS - 1 : b;
}

/** The canvas' data-ef-* keys (cleared when another mode runs). */
export const ELLIPSE_FOCI_DATA_KEYS = ["efBalls", "efTime", "efTransit", "efConvergences", "efVolleys", "efSeams", "efHits", "efSounds", "efConvSounds", "efSpread", "efSpreads", "efConvError", "efNan", "efBed", "efChord", "efBpm", "efSkin", "efTrail", "efTrailPoints", "efPathPoints", "efBloom", "efLoop", "efFocus", "efHue"] as const;

/** Mirrors a Focus Shot run onto the canvas' dataset (data-ef-*), for tools and the smoke test. */
export function writeEllipseFociDataset(view: EllipseFociView, layer: EllipseFociLayer, set: (key: string, value: string) => void) {
  set("efBalls", String(view.count));
  set("efTime", view.timeSec.toFixed(3));
  set("efTransit", String(view.transit));
  set("efConvergences", String(view.convergences));
  set("efVolleys", String(view.volleys));
  set("efSeams", String(view.seams));
  set("efHits", String(view.hits));
  set("efSounds", String(view.sounds));
  set("efConvSounds", view.convSounds.join(","));
  set("efSpread", view.lastSpread.toFixed(1));
  set("efSpreads", view.spreads.slice(0, 12).map((s) => s.toFixed(1)).join(","));
  set("efConvError", view.maxConvError.toExponential(2));
  set("efNan", String(view.nonFinite));
  set("efBed", view.bedOn ? "1" : "0");
  set("efChord", String(view.chord));
  set("efBpm", view.bpm.toFixed(2));
  set("efSkin", view.settings.skin);
  set("efTrail", String(view.settings.trailSec));
  set("efTrailPoints", String(layer.trailPoints));
  set("efPathPoints", String(layer.pathPoints));
  set("efBloom", layer.bloom.toFixed(2));
  set("efLoop", view.loopSec === null ? "" : view.loopSec.toFixed(3));
  set("efFocus", view.focusU < 0 ? "top" : view.focusU > 0 ? "bottom" : "centre");
  set("efHue", view.hueOffset.toFixed(1));
}
