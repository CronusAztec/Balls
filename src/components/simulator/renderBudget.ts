/**
 * --- review fix (performance) --- What keeps the canvas loop's cost flat over a long run and on any display:
 *
 * - `FrameGate`: at most 60 drawn frames a second on average, phase-locked to the rAF timestamps (a minimum gap of 15 ms
 *   measured at callback start drew 37.5 fps at 75 Hz, 45 at 90 Hz, 48 at 144 Hz and dropped jittery 60 Hz frames).
 * - Sprite caches with a size bucket and a small cap: one glow sprite per colour, body sprites per colour and power-of-two
 *   device-px radius (Grow mode walked through every integer radius and kept 60–290 MB of sprites alive).
 * - `PaintTrailLayer`: classic Paint's trail stamped incrementally into a layer (one stroke per new point) and drawn with one
 *   drawImage, instead of one stroke per point of the whole history every frame.
 * - `drawStringArt()`: the Lines / Grow strings and dots in one path each (a few per hue bucket with Rainbow Lines).
 *
 * Pure canvas helpers, no React; the page's canvas and the fast export's hidden one use them alike.
 */

/* ------------------------------------------------------------ frame gate */

/** The drawing budget: 60 frames a second, the physics' own step rate (a faster display would only repeat its states). */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * Lets a frame through when its rAF timestamp has reached the next 60 fps slot (1 ms early is fine) and books the slot
 * after it. A frame that is late keeps at most one slot of slack, so a display at 60 Hz or faster draws 60 frames a
 * second on average and a 60 Hz display never drops a frame for callback jitter.
 */
export class FrameGate {
  private nextDue = 0;

  /** Starts over (a fresh clock, e.g. a new loop). */
  reset() {
    this.nextDue = 0;
  }

  /** Whether the frame at `now` (the rAF timestamp, ms) is drawn. */
  due(now: number): boolean {
    if (now < this.nextDue - 1) return false;
    this.nextDue = Math.max(this.nextDue + FRAME_BUDGET_MS, now - FRAME_BUDGET_MS);
    return true;
  }
}

/* ------------------------------------------------------------ sprite caches */

/** Entries a sprite cache keeps (the oldest goes first): at most 64 × 256² × 4 B = 16 MB of body sprites. */
export const SPRITE_CACHE_CAP = 64;
/** Side (px) of the one glow sprite per colour: a smooth radial gradient, drawn scaled to the glow's size. */
export const GLOW_SPRITE_SIZE = 128;
/** The largest body sprite radius (device px); a bigger ball is drawn directly (an arc and its highlight). */
export const MAX_BODY_SPRITE_RADIUS = 128;

/**
 * Device-px radius of the body sprite for a ball of `radius` (CSS px) at `dpr`: the next power of two from 8 to 128, so a
 * colour has at most five sprites whatever sizes its balls pass through (Grow). 0 = draw the ball directly (larger, or no
 * usable radius).
 */
export function bodySpriteRadius(radius: number, dpr: number): number {
  const r = radius * dpr;
  if (!(r > 0) || r > MAX_BODY_SPRITE_RADIUS) return 0;
  return Math.min(MAX_BODY_SPRITE_RADIUS, 2 ** Math.ceil(Math.log2(Math.max(8, r))));
}

/** Adds `sprite` under `key`, dropping the oldest entry first when the cache is full. */
export function cacheSprite<T>(cache: Map<string, T>, key: string, sprite: T, cap = SPRITE_CACHE_CAP) {
  while (cache.size >= cap) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(key, sprite);
}

/* ------------------------------------------------------------ classic Paint trail */

/**
 * The largest trail layer (device px a side, 64 MB): a ball so big that its stroke reaches past this is drawn the old way,
 * every point every frame, rather than allocating a giant layer (big values are a feature, they degrade instead).
 */
export const MAX_TRAIL_LAYER_PX = 4096;

/** A point of the Paint trail (PaintMode's dabs). */
export interface TrailPoint {
  x: number;
  y: number;
  color: string;
}

/** The drawing calls the trail uses (a canvas' 2D context; tests pass a recorder). */
export type TrailContext = Pick<
  CanvasRenderingContext2D,
  "beginPath" | "moveTo" | "lineTo" | "stroke" | "setTransform" | "clearRect" | "strokeStyle" | "lineWidth" | "lineCap" | "lineJoin" | "globalAlpha"
>;

/**
 * Strokes the trail's segments ending at points `from`…end (from ≥ 1): consecutive segments of one colour share a path,
 * a jump of more than 3 line widths starts a new one, and each segment is drawn in the colour of its first point – as the
 * whole-history pass drew them. The context's width, caps, joins and alpha are the caller's.
 */
export function strokeTrailSegments(g: TrailContext, points: readonly TrailPoint[], from: number, lineWidth: number) {
  const maxJump = 3 * lineWidth;
  const maxJump2 = maxJump * maxJump;
  let open = false;
  let color = "";
  for (let j = Math.max(1, from); j < points.length; j++) {
    const prev = points[j - 1];
    const cur = points[j];
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    if (dx * dx + dy * dy > maxJump2) {
      if (open) g.stroke();
      open = false;
      continue;
    }
    if (!open || prev.color !== color) {
      if (open) g.stroke();
      color = prev.color;
      g.strokeStyle = color;
      g.beginPath();
      g.moveTo(prev.x, prev.y);
      open = true;
    }
    g.lineTo(cur.x, cur.y);
  }
  if (open) g.stroke();
}

/** A canvas the trail layer can draw into and be drawn from. */
export interface TrailCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): TrailContext | null;
}

const defaultTrailCanvas = (size: number): TrailCanvas => {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c as unknown as TrailCanvas;
};

/**
 * Classic Paint's trail as a layer over the arena's bounding square (device px): every frame strokes only the points
 * recorded since the last one into it, with the trail's own alpha per stroke (source-over is associative, so the layer
 * composited once looks like the strokes drawn one by one), and draws it with one drawImage in world coordinates (the
 * camera still applies). Restamped from the first point when the run restarts (`generation`), the points are fewer than
 * stamped, or the arena, the line width or the pixel ratio changed (a resize repositions the points).
 */
export class PaintTrailLayer {
  private canvas: TrailCanvas | null = null;
  private g: TrailContext | null = null;
  /** Points already stroked into the layer. */
  stamped = 0;
  private generation = NaN;
  private ox = NaN;
  private oy = NaN;
  private px = 0;
  private dpr = NaN;
  private lineWidth = NaN;

  constructor(private readonly makeCanvas: (size: number) => TrailCanvas = defaultTrailCanvas) {}

  /** Brings the layer up to date with `points` (stroking only the new ones) and draws it onto `ctx`. */
  draw(
    ctx: TrailContext & Pick<CanvasRenderingContext2D, "drawImage">,
    points: readonly TrailPoint[],
    generation: number,
    cx: number,
    cy: number,
    R: number,
    lineWidth: number,
    dpr: number,
  ) {
    // The square the trail can reach (the ball's centre stays inside R, its stroke a line width beyond), snapped to device px.
    const margin = R + lineWidth;
    const ox = Math.floor((cx - margin) * dpr) / dpr;
    const oy = Math.floor((cy - margin) * dpr) / dpr;
    const px = Math.max(1, Math.ceil((cx + margin - ox) * dpr), Math.ceil((cy + margin - oy) * dpr));
    if (!(px <= MAX_TRAIL_LAYER_PX)) {
      this.release();
      ctx.globalAlpha = 0.75;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = lineWidth;
      strokeTrailSegments(ctx, points, 1, lineWidth);
      ctx.globalAlpha = 1;
      return;
    }
    if (!this.canvas || this.px !== px) {
      this.canvas = this.makeCanvas(px);
      this.g = this.canvas.getContext("2d");
      this.px = px;
      this.stamped = 0;
      this.generation = NaN;
    }
    const g = this.g;
    if (!g) return;
    if (generation !== this.generation || points.length < this.stamped || ox !== this.ox || oy !== this.oy || dpr !== this.dpr || lineWidth !== this.lineWidth) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, px, px);
      this.stamped = 0;
      this.generation = generation;
      this.ox = ox;
      this.oy = oy;
      this.dpr = dpr;
      this.lineWidth = lineWidth;
    }
    if (this.stamped < points.length) {
      g.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
      g.globalAlpha = 0.75;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = lineWidth;
      strokeTrailSegments(g, points, this.stamped, lineWidth);
      this.stamped = points.length;
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.canvas as unknown as CanvasImageSource, ox, oy, px / dpr, px / dpr);
  }

  /** Lets the layer's pixels go (another mode, a picture, or a trail too big for a layer). */
  release() {
    this.canvas = null;
    this.g = null;
    this.px = 0;
    this.stamped = 0;
    this.generation = NaN;
  }
}

/* ------------------------------------------------------------ string art (Lines, Grow) */

/** Hue buckets of Rainbow Lines: the strings of one bucket (5° of hue) share a path. */
export const STRING_HUE_BUCKETS = 72;
const BUCKET_COLORS: readonly string[] = Array.from({ length: STRING_HUE_BUCKETS }, (_, b) => `hsl(${Math.round(((b + 0.5) * 360) / STRING_HUE_BUCKETS)}, 100%, 60%)`);

/** The drawing calls the string art uses. */
export type StringArtContext = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "arc" | "stroke" | "fill" | "strokeStyle" | "fillStyle" | "lineWidth" | "globalAlpha">;

/**
 * The Lines (and Grow) string art: a string from every bounce point to `ball` (none without a ball) and a dot on every
 * point. One colour: all strings in one path and one stroke, all dots in one path and one fill. Rainbow: the hue runs
 * once round the wheel over the points and turns with `time`; the points of one hue bucket share a path, so a frame
 * strokes and fills at most STRING_HUE_BUCKETS + 1 times however many points there are.
 */
export function drawStringArt(ctx: StringArtContext, points: readonly { x: number; y: number }[], ball: { x: number; y: number } | null, rainbow: boolean, lineColor: string, time: number) {
  const n = points.length;
  if (n === 0) return;
  const base = (0.03 * time) % 360;
  const bucketOf = (i: number) => {
    const hue = (base + (n > 1 ? (i / n) * 360 : 0)) % 360;
    const h = hue < 0 ? hue + 360 : hue;
    return Math.min(STRING_HUE_BUCKETS - 1, Math.floor((h * STRING_HUE_BUCKETS) / 360));
  };
  let i = 0;
  while (i < n) {
    let j = n;
    let color = lineColor;
    if (rainbow) {
      const b = bucketOf(i);
      j = i + 1;
      while (j < n && bucketOf(j) === b) j++;
      color = BUCKET_COLORS[b];
    }
    if (ball) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let k = i; k < j; k++) {
        ctx.moveTo(points[k].x, points[k].y);
        ctx.lineTo(ball.x, ball.y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let k = i; k < j; k++) {
      const pt = points[k];
      ctx.moveTo(pt.x + 2.5, pt.y);
      ctx.arc(pt.x, pt.y, 2.5, 0, 2 * Math.PI);
    }
    ctx.fill();
    i = j;
  }
  ctx.globalAlpha = 1;
}
