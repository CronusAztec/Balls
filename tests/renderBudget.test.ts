import { describe, expect, it } from "vitest";
import {
  FRAME_BUDGET_MS,
  FrameGate,
  GLOW_SPRITE_SIZE,
  MAX_BODY_SPRITE_RADIUS,
  MAX_TRAIL_LAYER_PX,
  PaintTrailLayer,
  SPRITE_CACHE_CAP,
  STRING_HUE_BUCKETS,
  bodySpriteRadius,
  cacheSprite,
  drawStringArt,
  strokeTrailSegments,
  type TrailCanvas,
  type TrailPoint,
} from "@/components/simulator/renderBudget";
import { PhysicsEngine } from "@/lib/physics/engine";
import { COVERAGE_DONE } from "@/lib/physics/picturePaint";
import type { PhysicsConfig } from "@/lib/physics/types";

/*
 * --- review fix (performance) --- The canvas loop's budgets: ≤ 60 drawn frames a second on any display, bounded sprite
 * caches, classic Paint's trail stroked incrementally, the string art batched, and a finished Paint run that stops
 * recording dabs.
 */

/* ------------------------------------------------------------ a recording 2D context */

interface Stroke {
  style: string;
  alpha: number;
  width: number;
  /** The path's points: moveTo starts a sub-path ("M"), lineTo continues it ("L"). */
  path: string[];
}

function recordingContext() {
  const strokes: Stroke[] = [];
  const fills: { style: string; alpha: number; arcs: number }[] = [];
  let path: string[] = [];
  let arcs = 0;
  const ctx = {
    strokeStyle: "" as string,
    fillStyle: "" as string,
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    globalAlpha: 1,
    transforms: [] as number[][],
    clears: 0,
    images: [] as number[][],
    beginPath() {
      path = [];
      arcs = 0;
    },
    moveTo(x: number, y: number) {
      path.push(`M${x},${y}`);
    },
    lineTo(x: number, y: number) {
      path.push(`L${x},${y}`);
    },
    arc() {
      arcs++;
    },
    stroke() {
      strokes.push({ style: String(ctx.strokeStyle), alpha: ctx.globalAlpha, width: ctx.lineWidth, path: [...path] });
    },
    fill() {
      fills.push({ style: String(ctx.fillStyle), alpha: ctx.globalAlpha, arcs });
    },
    setTransform(...m: number[]) {
      ctx.transforms.push(m);
    },
    clearRect() {
      ctx.clears++;
    },
    drawImage(_img: unknown, ...rect: number[]) {
      ctx.images.push(rect);
    },
  };
  return { ctx, strokes, fills };
}

/* ------------------------------------------------------------ frame gate */

describe("frame gate", () => {
  /** Frames drawn in `seconds` of a display at `hz`, the rAF timestamps shifted by `jitter(k)` ms. */
  const drawnAt = (hz: number, seconds: number, jitter: (k: number) => number = () => 0) => {
    const gate = new FrameGate();
    const period = 1000 / hz;
    const frames = Math.round(seconds * hz);
    const times: number[] = [];
    for (let k = 0; k < frames; k++) {
      const now = 5000 + k * period + jitter(k);
      if (gate.due(now)) times.push(now);
    }
    return times;
  };

  it("draws about 60 frames a second on 75, 90, 120, 144, 165 and 240 Hz displays (the 15 ms gap drew 37.5–55)", () => {
    for (const hz of [75, 90, 120, 144, 165, 240]) {
      const drawn = drawnAt(hz, 10).length;
      expect(drawn, `${hz} Hz`).toBeGreaterThanOrEqual(595);
      expect(drawn, `${hz} Hz`).toBeLessThanOrEqual(605);
    }
  });

  it("draws every frame of a 60 Hz display, also with callbacks up to 3 ms late, and of slower ones", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 3;
    expect(drawnAt(60, 10).length).toBe(600);
    expect(drawnAt(60, 10, rand).length).toBe(600);
    expect(drawnAt(59.94, 10).length).toBe(Math.round(59.94 * 10));
    expect(drawnAt(30, 10).length).toBe(300);
  });

  it("keeps an even cadence on a 120 Hz display (every other frame) and starts over after a pause", () => {
    const times = drawnAt(120, 2);
    const gaps = times.slice(10).map((t, i) => t - times[9 + i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(2 * (1000 / 120), 6);
    const gate = new FrameGate();
    expect(gate.due(1000)).toBe(true);
    expect(gate.due(1000 + FRAME_BUDGET_MS / 2)).toBe(true); // one slot of slack right after the start
    // A long pause (a hidden tab): drawn at once, and at most a slot of catch-up after it – not the frames it missed.
    let drawn = 0;
    for (let k = 0; k < 144; k++) if (gate.due(60_000 + (k * 1000) / 144)) drawn++;
    expect(drawn).toBeGreaterThanOrEqual(60);
    expect(drawn).toBeLessThanOrEqual(63);
  });
});

/* ------------------------------------------------------------ sprites */

describe("ball and glow sprites", () => {
  it("bucket the body radius into at most five powers of two up to 128 device px; a bigger ball is drawn directly", () => {
    expect(bodySpriteRadius(8, 1)).toBe(8);
    expect(bodySpriteRadius(3, 1)).toBe(8);
    expect(bodySpriteRadius(8.4, 1)).toBe(16);
    expect(bodySpriteRadius(8, 2)).toBe(16);
    expect(bodySpriteRadius(64, 2)).toBe(MAX_BODY_SPRITE_RADIUS);
    expect(bodySpriteRadius(65, 2)).toBe(0);
    expect(bodySpriteRadius(1e9, 1)).toBe(0);
    for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) expect(bodySpriteRadius(bad, 1)).toBe(0);
    // Grow: a ball growing from 8 px to the ring (300 px) passes through every integer radius – five sprites in all.
    const buckets = new Set<number>();
    for (let r = 8; r <= 300; r += 0.25) buckets.add(bodySpriteRadius(r, 1));
    expect([...buckets].sort((a, b) => a - b)).toEqual([0, 8, 16, 32, 64, 128]);
  });

  it("keep at most SPRITE_CACHE_CAP sprites, dropping the oldest first", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < 1000; i++) cacheSprite(cache, `c${i}`, i);
    expect(cache.size).toBe(SPRITE_CACHE_CAP);
    expect(cache.has("c999")).toBe(true);
    expect(cache.has(`c${1000 - SPRITE_CACHE_CAP}`)).toBe(true);
    expect(cache.has(`c${999 - SPRITE_CACHE_CAP}`)).toBe(false);
    // Worst case of the body cache: every entry the largest sprite (256 × 256 px) – 16 MB; the glow cache 4 MB.
    expect(SPRITE_CACHE_CAP * (2 * MAX_BODY_SPRITE_RADIUS) ** 2 * 4).toBeLessThanOrEqual(16 * 2 ** 20);
    expect(SPRITE_CACHE_CAP * GLOW_SPRITE_SIZE ** 2 * 4).toBeLessThanOrEqual(4 * 2 ** 20);
  });
});

/* ------------------------------------------------------------ classic Paint trail */

/** The whole-history pass the canvas ran every frame before (Canvas.tsx), on a recording context. */
function wholeHistory(ctx: ReturnType<typeof recordingContext>["ctx"], points: TrailPoint[], lineWidth: number) {
  const maxJump2 = (3 * lineWidth) ** 2;
  let i = 0;
  while (i < points.length) {
    const start = points[i];
    ctx.strokeStyle = start.color;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    let j = i + 1;
    while (j < points.length) {
      const prev = points[j - 1];
      const cur = points[j];
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (dx * dx + dy * dy > maxJump2) break;
      if (cur.color !== prev.color) {
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
        ctx.strokeStyle = cur.color;
        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y);
      } else ctx.lineTo(cur.x, cur.y);
      j++;
    }
    ctx.stroke();
    i = j;
  }
}

/** A Paint-like trail: a new hue per point (as PaintMode records them), with a jump every 37 points. */
function trail(n: number, sameColor = false): TrailPoint[] {
  const out: TrailPoint[] = [];
  let x = 400;
  let y = 300;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 37 === 0) x += 200;
    else x += 3 * Math.cos(i / 7);
    y += 3 * Math.sin(i / 5);
    out.push({ x, y, color: sameColor ? "hsl(10, 85%, 55%)" : `hsl(${(0.3 * (i + 1)) % 360}, 85%, 55%)` });
  }
  return out;
}

const drawnSegments = (strokes: Stroke[]) => strokes.filter((s) => s.path.length > 1).map((s) => `${s.style}|${s.path.join(" ")}`);

describe("classic Paint trail layer", () => {
  it("strokes, chunk by chunk, exactly the segments the whole-history pass drew, each once and in its colour", () => {
    const points = trail(400);
    const old = recordingContext();
    wholeHistory(old.ctx, points, 16);
    const inc = recordingContext();
    let stamped = 0;
    for (const end of [1, 2, 50, 51, 120, 250, 399, 400]) {
      strokeTrailSegments(inc.ctx as never, points.slice(0, end), stamped, 16);
      stamped = end;
    }
    expect(drawnSegments(inc.strokes)).toEqual(drawnSegments(old.strokes));
    expect(drawnSegments(inc.strokes).length).toBe(399 - Math.floor(399 / 37));
  });

  it("keeps a run of one colour in one path", () => {
    const points = trail(30, true);
    const { ctx, strokes } = recordingContext();
    strokeTrailSegments(ctx as never, points, 1, 16);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].path).toHaveLength(30);
  });

  /** A trail layer over fake canvases, counting the canvases it makes. */
  const layerUnderTest = () => {
    const made: ReturnType<typeof recordingContext>[] = [];
    const layer = new PaintTrailLayer((size) => {
      const rec = recordingContext();
      made.push(rec);
      const canvas: TrailCanvas = { width: size, height: size, getContext: () => rec.ctx as never };
      return canvas;
    });
    return { layer, made };
  };

  it("strokes only the new points each frame and draws the layer with one drawImage", () => {
    const { layer, made } = layerUnderTest();
    const page = recordingContext();
    const points = trail(200);
    layer.draw(page.ctx as never, points.slice(0, 100), 1, 400, 300, 255, 16, 2);
    expect(made).toHaveLength(1);
    const first = made[0].strokes.length;
    expect(first).toBeGreaterThan(90);
    expect(made[0].strokes.every((s) => s.alpha === 0.75 && s.width === 16)).toBe(true);
    layer.draw(page.ctx as never, points.slice(0, 103), 1, 400, 300, 255, 16, 2);
    expect(made[0].strokes.length - first).toBe(3);
    expect(layer.stamped).toBe(103);
    layer.draw(page.ctx as never, points.slice(0, 103), 1, 400, 300, 255, 16, 2);
    expect(made[0].strokes.length - first).toBe(3); // nothing new, nothing stroked
    expect(page.ctx.images).toHaveLength(3);
    // The layer covers the arena square plus a line width, snapped to device pixels, drawn at its size in world px.
    const [x, y, w, h] = page.ctx.images[0];
    expect(x).toBeLessThanOrEqual(400 - 255 - 16);
    expect(y).toBeLessThanOrEqual(300 - 255 - 16);
    expect(w).toBeGreaterThanOrEqual(2 * (255 + 16));
    expect(h).toBe(w);
    expect(Number.isInteger(x * 2) && Number.isInteger(w * 2)).toBe(true);
    expect(page.ctx.globalAlpha).toBe(1);
  });

  it("restamps from the first point after a restart, a shorter trail, a resize or a new line width", () => {
    const { layer, made } = layerUnderTest();
    const page = recordingContext();
    const points = trail(120);
    layer.draw(page.ctx as never, points, 1, 400, 300, 255, 16, 1);
    const clears = () => made.reduce((n, m) => n + m.ctx.clears, 0);
    const before = clears();
    layer.draw(page.ctx as never, points, 2, 400, 300, 255, 16, 1); // a restart (new generation)
    expect(clears()).toBe(before + 1);
    expect(layer.stamped).toBe(120);
    layer.draw(page.ctx as never, points.slice(0, 10), 2, 400, 300, 255, 16, 1); // fewer points than stamped
    expect(clears()).toBe(before + 2);
    layer.draw(page.ctx as never, points.slice(0, 10), 2, 401.5, 300, 255, 16, 1); // the arena moved (a resize)
    expect(clears()).toBe(before + 3);
    const canvases = made.length;
    layer.draw(page.ctx as never, points.slice(0, 10), 2, 401.5, 300, 255, 20, 1); // the ball (line) grew: a bigger layer
    expect(made.length).toBe(canvases + 1);
    expect(layer.stamped).toBe(10);
  });

  it("draws a trail too big for a layer directly instead of allocating one", () => {
    const { layer, made } = layerUnderTest();
    const page = recordingContext();
    const points = trail(50);
    layer.draw(page.ctx as never, points, 1, 400, 300, 255, MAX_TRAIL_LAYER_PX, 2);
    expect(made).toHaveLength(0);
    expect(page.strokes.length).toBeGreaterThan(40);
    expect(page.ctx.images).toHaveLength(0);
    expect(page.ctx.globalAlpha).toBe(1);
  });
});

/* ------------------------------------------------------------ string art */

describe("Lines string art", () => {
  const points = Array.from({ length: 1000 }, (_, i) => ({ x: 400 + 250 * Math.cos(i), y: 300 + 250 * Math.sin(i) }));
  const ball = { x: 410, y: 320 };

  it("draws every string in one stroke and every dot in one fill with one line colour", () => {
    const { ctx, strokes, fills } = recordingContext();
    drawStringArt(ctx as never, points, ball, false, "#93d119", 1234);
    expect(strokes).toHaveLength(1);
    expect(fills).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ style: "#93d119", alpha: 0.8, width: 1.5 });
    expect(strokes[0].path.filter((c) => c.startsWith("M"))).toHaveLength(1000);
    expect(strokes[0].path.filter((c) => c === `L${ball.x},${ball.y}`)).toHaveLength(1000);
    expect(fills[0]).toMatchObject({ style: "#93d119", alpha: 0.9, arcs: 1000 });
    expect(ctx.globalAlpha).toBe(1);
  });

  it("batches Rainbow Lines per hue bucket: at most a bucket count + 1 strokes and fills, every point drawn", () => {
    for (const time of [0, 777, -1.7e12]) {
      const { ctx, strokes, fills } = recordingContext();
      drawStringArt(ctx as never, points, ball, true, "#fff", time);
      expect(strokes.length).toBeLessThanOrEqual(STRING_HUE_BUCKETS + 1);
      expect(fills.length).toBe(strokes.length);
      expect(fills.reduce((n, f) => n + f.arcs, 0)).toBe(1000);
      expect(new Set(fills.map((f) => f.style)).size).toBeGreaterThan(STRING_HUE_BUCKETS / 2);
      for (const f of fills) expect(f.style).toMatch(/^hsl\(\d+, 100%, 60%\)$/);
    }
  });

  it("draws only the dots without a ball, and nothing without points", () => {
    const { ctx, strokes, fills } = recordingContext();
    drawStringArt(ctx as never, points, null, false, "#fff", 0);
    expect(strokes).toHaveLength(0);
    expect(fills).toHaveLength(1);
    const empty = recordingContext();
    drawStringArt(empty.ctx as never, [], ball, true, "#fff", 0);
    expect(empty.strokes.length + empty.fills.length).toBe(0);
  });
});

/* ------------------------------------------------------------ Paint stops at the finish */

describe("a finished Paint run", () => {
  const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.3, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

  it("records no more dabs once the circle is painted (the ball and the seed's run go on unchanged)", () => {
    const engine = new PhysicsEngine({ ...config });
    engine.setPaintOptions({ picture: true, brush: 3, beatSync: false, guided: true, paceToSong: false, targetSec: 0 }); // finishes in seconds
    engine.setSeed(4242);
    engine.initMode("paint");
    let steps = 0;
    while (engine.getPaintCoverage() < COVERAGE_DONE && steps < 200 * 60) {
      engine.update(1000 / 60, 0);
      steps++;
    }
    expect(engine.getPaintCoverage()).toBeGreaterThanOrEqual(COVERAGE_DONE);
    const count = engine.getPaintPoints().length;
    const coverage = engine.getPaintCoverage();
    const ballBefore = { ...engine.getBalls()[0] };
    for (let i = 0; i < 600; i++) engine.update(1000 / 60, 0);
    expect(engine.getPaintPoints().length).toBe(count);
    expect(engine.getPaintCoverage()).toBe(coverage);
    expect(engine.getBalls()[0].x).not.toBe(ballBefore.x); // the ball keeps moving under the end screen
  });
});
