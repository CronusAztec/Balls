import { describe, expect, it } from "vitest";
import { MergeRingMode, buildMergeRingLayout, type MergeRingView } from "@/lib/physics/modes/mergeRing";
import {
  DEFAULT_MERGE_RING_LABELS,
  HALO_GLOW,
  HALO_GRADIENT_FROM,
  LadderCache,
  MergeRingLayer,
  RIM_HUE_LAG_DEG,
  RIM_PHASES,
  RIM_SEGMENTS,
  RimCache,
  RAINBOW_DEG_PER_SEC,
  rimColor,
  rimHue,
  trailUnderBody,
  type LadderSpec,
  type MergeRingRenderOptions,
  type RimSpec,
} from "@/components/simulator/mergeRingRenderer";
import { GLOW_REACH, GLOW_STOPS, fillStrokeGlow, glowProfile, normalCdf, plainTransform, rgbOfHex, strokeShadowAlpha, type CanvasFactory } from "@/components/simulator/mergeRingGlow";

/**
 * Merge Ring's drawing without per-frame blurs (feature merge-ring, the lag fix): the glow's profile, the cached rim (built
 * once its ring holds, rebuilt on a resize, a new scale, thickness, glow, rainbow or colour, recoloured as the hue turns), the
 * cached ladder, the gradient glows of the halos and the flash, and the trails hidden under the dark bodies.
 */

/* ------------------------------------------------------------------ a recording 2D context */

interface Call {
  name: string;
  args: unknown[];
  /** The state when the call was made. */
  shadowBlur: number;
  shadowOffsetX: number;
  globalAlpha: number;
  composite: string;
  fillStyle: unknown;
  transform: number[];
}

/** A 2D context that keeps its state (transform stack included) and records every call (enough for the renderer). */
function fakeContext() {
  const calls: Call[] = [];
  const state = { shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, shadowColor: "", globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1, lineCap: "butt", lineJoin: "miter", font: "", textAlign: "start", textBaseline: "alphabetic" };
  let m = [1, 0, 0, 1, 0, 0];
  const stack: { s: typeof state; m: number[] }[] = [];
  const record = (name: string, args: unknown[]) => calls.push({ name, args, shadowBlur: state.shadowBlur, shadowOffsetX: state.shadowOffsetX, globalAlpha: state.globalAlpha, composite: state.globalCompositeOperation, fillStyle: state.fillStyle, transform: [...m] });
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => stack.push({ s: { ...state }, m: [...m] }),
    restore: () => {
      const top = stack.pop();
      if (top) {
        Object.assign(state, top.s);
        m = top.m;
      }
    },
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = [a, b, c, d, e, f];
    },
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    translate: (x: number, y: number) => {
      m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y];
    },
    rotate: (a: number) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, -m[0] * s + m[2] * c, -m[1] * s + m[3] * c, m[4], m[5]];
    },
    createRadialGradient: (...args: never[]) => {
      const stops: [number, string][] = [];
      const g = { kind: "radial", args, stops, addColorStop: (o: number, c: string) => stops.push([o, c]) };
      record("createRadialGradient", args);
      return g;
    },
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(state as unknown as CanvasRenderingContext2D, {
    get: (_t, prop: string) => {
      if (prop in methods) return methods[prop];
      if (prop in state) return (state as Record<string, unknown>)[prop];
      return (...args: unknown[]) => record(prop, args);
    },
    set: (_t, prop: string, value) => {
      (state as Record<string, unknown>)[prop] = value;
      return true;
    },
  });
  return { ctx, calls, state };
}

/** A canvas factory of recording canvases (each with its own context). */
function fakeCanvases() {
  const made: { canvas: { width: number; height: number; getContext: () => CanvasRenderingContext2D }; calls: Call[] }[] = [];
  const create: CanvasFactory = (width, height) => {
    const f = fakeContext();
    const canvas = { width, height, getContext: () => f.ctx };
    made.push({ canvas, calls: f.calls });
    return canvas as unknown as HTMLCanvasElement;
  };
  return { create, made };
}

const count = (calls: Call[], name: string, pred: (c: Call) => boolean = () => true) => calls.filter((c) => c.name === name && pred(c)).length;

function rimSpec(over: Partial<RimSpec> = {}): RimSpec {
  return { cx: 400, cy: 243, radius: 189, start: -Math.PI / 2 + 0.28, end: (3 * Math.PI) / 2 - 0.28, width: 2, blur: 12, rainbow: true, color: "", timeMs: 1000, ...over };
}

/* ------------------------------------------------------------------ the glow's profile */

describe("the glow without a blur", () => {
  it("follows the blurred line's profile: a Gaussian CDF, symmetric, holding the line's whole width", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4);
    // the profile across a line 2 wide blurred by σ 6: symmetric, peaking on the line, its integral the width
    const lw = 2;
    const sigma = 6;
    expect(strokeShadowAlpha(3, lw, sigma)).toBeCloseTo(strokeShadowAlpha(-3, lw, sigma), 12);
    expect(strokeShadowAlpha(0, lw, sigma)).toBeGreaterThan(strokeShadowAlpha(5, lw, sigma));
    let area = 0;
    for (let d = -60; d <= 60; d += 0.01) area += strokeShadowAlpha(d, lw, sigma) * 0.01;
    expect(area).toBeCloseTo(lw, 3);
    // no blur: the line itself
    expect(strokeShadowAlpha(0.5, 2, 0)).toBe(1);
    expect(strokeShadowAlpha(1.5, 2, 0)).toBe(0);
    const { ext, alphas } = glowProfile(lw, sigma);
    expect(ext).toBeCloseTo(lw / 2 + GLOW_REACH * sigma, 12);
    expect(alphas.length).toBe(GLOW_STOPS);
    expect(alphas[0]).toBeLessThan(0.003); // the reach's edge: under a level
    expect(alphas[(GLOW_STOPS - 1) / 2]).toBeCloseTo(strokeShadowAlpha(0, lw, sigma), 12);
    expect(rgbOfHex("#fb7185")).toBe("251, 113, 133");
    expect(rgbOfHex("#fff")).toBe("255, 255, 255");
    expect(rgbOfHex("hsl(1, 2%, 3%)")).toBeNull();
  });

  it("fills a big circle's glow as a gradient annulus in device px, and leaves a small one to the blur", () => {
    const { ctx, calls } = fakeContext();
    ctx.shadowBlur = 12;
    // scale 2: σ 6 device px = 3 units; a line 1.5 wide
    expect(fillStrokeGlow(ctx, 2, 100, 100, 80, 1.5, 12, "1, 2, 3")).toBe(true);
    expect(ctx.shadowBlur).toBe(0); // the glow casts none
    const grad = calls.find((c) => c.name === "createRadialGradient")!;
    const ext = (1.5 / 2) * 2 + GLOW_REACH * 6; // device px
    expect(grad.args).toEqual([100, 100, 80 - ext / 2, 100, 100, 80 + ext / 2]);
    expect(count(calls, "fill")).toBe(1);
    // too small for the profile, or under the caller's least radius: nothing drawn
    calls.length = 0;
    expect(fillStrokeGlow(ctx, 2, 100, 100, 8, 1.5, 12, "1, 2, 3")).toBe(false);
    expect(fillStrokeGlow(ctx, 2, 100, 100, 40, 1.5, 12, "1, 2, 3", 0, Math.PI * 2, HALO_GRADIENT_FROM)).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("reads only a transform that scales evenly and translates", () => {
    const { ctx } = fakeContext();
    ctx.setTransform(2, 0, 0, 2, 5, 7);
    expect(plainTransform(ctx)).toEqual({ k: 2, e: 5, f: 7 });
    ctx.rotate(0.3);
    expect(plainTransform(ctx)).toBeNull();
    ctx.setTransform(2, 0, 0, 3, 0, 0);
    expect(plainTransform(ctx)).toBeNull();
  });
});

/* ------------------------------------------------------------------ the rim's bitmap */

describe("the rim's bitmap", () => {
  it("is built once the ring holds, blitted 1:1 at whole device px, and colours its segments as the live rim does", () => {
    const { create, made } = fakeCanvases();
    const cache = new RimCache(create);
    const { ctx, calls } = fakeContext();
    ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
    // the first frame of a ring draws live (it may be a resize in progress), the second builds it
    expect(cache.draw(ctx, rimSpec())).toBe(false);
    expect(cache.draw(ctx, rimSpec())).toBe(true);
    expect(cache.builds).toBe(1);
    const bitmap = made[0];
    // the bitmap: the 90 arcs blurred once, in white, at the device scale
    expect(count(bitmap.calls, "stroke", (c) => c.shadowBlur === 12)).toBe(RIM_SEGMENTS);
    // ... then every segment's sector in its colour, the alpha kept
    const fills = bitmap.calls.filter((c) => c.name === "fill");
    expect(fills.length).toBe(RIM_SEGMENTS);
    expect(fills.every((c) => c.composite === "source-atop" && c.shadowBlur === 0)).toBe(true);
    const step = (rimSpec().end - rimSpec().start) / RIM_SEGMENTS;
    expect(fills[0].fillStyle).toBe(`hsl(${rimHue(rimSpec().start + step / 2, 1000).toFixed(1)}, 100%, 62%)`);
    expect(fills[45].fillStyle).toBe(`hsl(${rimHue(rimSpec().start + 45.5 * step, 1000).toFixed(1)}, 100%, 62%)`);
    // the blit: identity transform, whole px, no shadow
    const blit = calls.filter((c) => c.name === "drawImage");
    expect(blit.length).toBe(1);
    expect(blit[0].transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(blit[0].shadowBlur).toBe(0);
    expect(Number.isInteger(blit[0].args[1]) && Number.isInteger(blit[0].args[2])).toBe(true);
    // the ring's centre lands on its device position: blit origin + the bitmap's half size + the baked fraction
    const size = bitmap.canvas.width;
    const arc = bitmap.calls.find((c) => c.name === "arc")!;
    expect((blit[0].args[1] as number) + (arc.args[0] as number)).toBeCloseTo(1.5 * 400, 9);
    expect((blit[0].args[2] as number) + (arc.args[1] as number)).toBeCloseTo(1.5 * 243, 9);
    expect(size).toBeGreaterThan(2 * 1.5 * 189);
    // the same frame again: a blit and nothing else
    const before = bitmap.calls.length;
    expect(cache.draw(ctx, rimSpec())).toBe(true);
    expect(bitmap.calls.length).toBe(before);
    expect(cache.blits).toBe(2);
  });

  it("recolours a fifth of the segments a frame as the hue turns, all of them after a jump", () => {
    const { create, made } = fakeCanvases();
    const cache = new RimCache(create);
    const { ctx } = fakeContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cache.draw(ctx, rimSpec({ timeMs: 0 }));
    cache.draw(ctx, rimSpec({ timeMs: 0 }));
    const bitmap = made[0];
    const fills = () => count(bitmap.calls, "fill");
    let last = fills();
    const frame = 1000 / 60;
    for (let i = 1; i <= 6; i++) {
      cache.draw(ctx, rimSpec({ timeMs: i * frame }));
      expect(fills() - last, `frame ${i}`).toBe(RIM_SEGMENTS / RIM_PHASES);
      last = fills();
    }
    // a fifth is never more than RIM_HUE_LAG_DEG behind: four frames at the default speed
    expect(((RIM_PHASES - 1) * frame * RAINBOW_DEG_PER_SEC) / 1000).toBeLessThanOrEqual(RIM_HUE_LAG_DEG);
    // paused: the stale fifths catch up, then nothing
    for (let i = 0; i < RIM_PHASES - 1; i++) cache.draw(ctx, rimSpec({ timeMs: 6 * frame }));
    expect(fills() - last).toBe(((RIM_PHASES - 1) * RIM_SEGMENTS) / RIM_PHASES);
    last = fills();
    cache.draw(ctx, rimSpec({ timeMs: 6 * frame }));
    expect(fills()).toBe(last);
    // fast playback (a fifth would lag more than RIM_HUE_LAG_DEG) or a jump back (a restart): every segment
    cache.draw(ctx, rimSpec({ timeMs: 6 * frame + 200 }));
    expect(fills() - last).toBe(RIM_SEGMENTS);
    last = fills();
    cache.draw(ctx, rimSpec({ timeMs: 0 }));
    expect(fills() - last).toBe(RIM_SEGMENTS);
    expect(cache.builds).toBe(1);
  });

  it("is rebuilt on a resize, a new scale, thickness, glow, rainbow or wall colour – once the change holds", () => {
    const { create } = fakeCanvases();
    const cache = new RimCache(create);
    const { ctx } = fakeContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cache.draw(ctx, rimSpec());
    cache.draw(ctx, rimSpec());
    expect(cache.builds).toBe(1);
    const changes: [string, () => void, Partial<RimSpec>][] = [
      ["a resize (a bigger ring)", () => {}, { radius: 220, cx: 500 }],
      ["the device scale (a new DPR or zoom)", () => ctx.setTransform(2, 0, 0, 2, 0, 0), { radius: 220, cx: 500 }],
      ["the wall thickness", () => {}, { radius: 220, cx: 500, width: 4 }],
      ["the glow", () => {}, { radius: 220, cx: 500, width: 4, blur: 18 }],
      ["the rainbow off", () => {}, { radius: 220, cx: 500, width: 4, blur: 18, rainbow: false, color: "rgba(255, 255, 255, 0.9)" }],
      ["the wall colour", () => {}, { radius: 220, cx: 500, width: 4, blur: 18, rainbow: false, color: "rgba(6, 182, 212, 0.9)" }],
    ];
    let builds = 1;
    for (const [what, apply, spec] of changes) {
      apply();
      // a change draws live on its first frame (a zoom or a resize may still be going on), then builds
      expect(cache.draw(ctx, rimSpec(spec)), what).toBe(false);
      expect(cache.draw(ctx, rimSpec(spec)), what).toBe(true);
      expect(cache.builds, what).toBe(++builds);
      expect(cache.draw(ctx, rimSpec(spec)), what).toBe(true);
      expect(cache.builds, what).toBe(builds);
    }
  });

  it("follows a camera sliding by a fraction of a pixel without rebuilding, and rebuilds where it rests", () => {
    const { create } = fakeCanvases();
    const cache = new RimCache(create);
    const { ctx, calls } = fakeContext();
    ctx.setTransform(1, 0, 0, 1, 0.25, 0);
    cache.draw(ctx, rimSpec());
    cache.draw(ctx, rimSpec());
    expect(cache.builds).toBe(1);
    const blitX = () => calls.filter((c) => c.name === "drawImage").at(-1)!.args[1] as number;
    const x0 = blitX();
    // sliding: every frame a new fraction, the bitmap at the nearest pixel
    for (const e of [0.6, 1.1, 1.7, 2.6]) {
      ctx.setTransform(1, 0, 0, 1, e, 0);
      expect(cache.draw(ctx, rimSpec())).toBe(true);
      expect(blitX()).toBe(x0 + Math.round(e - 0.25));
    }
    expect(cache.builds).toBe(1);
    // at rest 0.35 px off the bitmap's fraction: rebuilt where it is
    cache.draw(ctx, rimSpec());
    expect(cache.builds).toBe(2);
    expect(blitX()).toBe(x0 + 2);
    // creeping by less than a hundredth of a px a frame (a camera settling): blitted, rebuilt only once it is a tenth off
    for (let i = 1; i <= 9; i++) {
      ctx.setTransform(1, 0, 0, 1, 2.6 + 0.009 * i, 0);
      cache.draw(ctx, rimSpec());
    }
    expect(cache.builds).toBe(2);
    for (let i = 10; i <= 13; i++) {
      ctx.setTransform(1, 0, 0, 1, 2.6 + 0.009 * i, 0);
      cache.draw(ctx, rimSpec());
    }
    expect(cache.builds).toBe(3);
  });

  it("leaves the rim to the live drawing where it cannot help", () => {
    const { create } = fakeCanvases();
    const { ctx } = fakeContext();
    // a rotated view
    const cache = new RimCache(create);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.rotate(0.2);
    expect(cache.draw(ctx, rimSpec())).toBe(false);
    expect(cache.draw(ctx, rimSpec())).toBe(false);
    // no offscreen canvas (no document): never, and it does not keep asking
    let asked = 0;
    const none = new RimCache(() => {
      asked++;
      return null;
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 4; i++) expect(none.draw(ctx, rimSpec())).toBe(false);
    expect(asked).toBe(1);
    // a bitmap past RIM_CACHE_MAX_SIDE (a huge zoom)
    const big = new RimCache(create);
    ctx.setTransform(20, 0, 0, 20, 0, 0);
    big.draw(ctx, rimSpec());
    expect(big.draw(ctx, rimSpec())).toBe(false);
  });
});

/* ------------------------------------------------------------------ the ladder's bitmap */

describe("the ladder's bitmap", () => {
  const ladder = (over: Partial<LadderSpec> = {}): LadderSpec => ({ x: 700, y0: 100, y1: 380, size: 14, tiers: 7, topTier: 3, ...over });

  it("is drawn once with its glows and redrawn when a tier lights up, the ladder moves or the scale changes", () => {
    const { create, made } = fakeCanvases();
    const cache = new LadderCache(create);
    const { ctx, calls } = fakeContext();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    expect(cache.draw(ctx, ladder())).toBe(true);
    expect(cache.builds).toBe(1);
    // the lit tiers glow in the bitmap (3 rings and 3 emblems), not on the page
    expect(count(made[0].calls, "stroke", (c) => c.shadowBlur > 0) + count(made[0].calls, "fill", (c) => c.shadowBlur > 0)).toBeGreaterThanOrEqual(6);
    expect(calls.some((c) => (c.name === "stroke" || c.name === "fill") && c.shadowBlur > 0)).toBe(false);
    expect(calls.filter((c) => c.name === "drawImage").every((c) => c.transform.join() === "1,0,0,1,0,0")).toBe(true);
    for (let i = 0; i < 3; i++) cache.draw(ctx, ladder());
    expect(cache.builds).toBe(1);
    cache.draw(ctx, ladder({ topTier: 4 }));
    expect(cache.builds).toBe(2);
    cache.draw(ctx, ladder({ topTier: 4, x: 650 }));
    expect(cache.builds).toBe(3);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cache.draw(ctx, ladder({ topTier: 4, x: 650 }));
    expect(cache.builds).toBe(4);
    cache.draw(ctx, ladder({ topTier: 4, x: 650, tiers: 10 }));
    expect(cache.builds).toBe(5);
  });
});

/* ------------------------------------------------------------------ the layer */

describe("the layer draws nothing blurred per frame", () => {
  const opts: MergeRingRenderOptions = { wallAlpha: (a) => `rgba(255, 255, 255, ${a})`, wallThickness: 2, showWallGlow: true, darkBodies: true };

  function viewOf(over: Partial<MergeRingView> = {}): MergeRingView {
    const mode = new MergeRingMode();
    const v = mode.getView();
    v.layout = buildMergeRingLayout(800, 450, 24);
    v.timeMs = 1000;
    v.topTier = 4;
    return Object.assign(v, over);
  }

  it("the rim, the halos and the ladder: blits and gradients, the shadows only where cheap (small halos)", () => {
    const { create } = fakeCanvases();
    const layer = new MergeRingLayer(create);
    const { ctx, calls } = fakeContext();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const v = viewOf();
    // a big halo (gradient) and a small one (its blur's box is small)
    v.haloMs[0] = 900;
    v.haloX[0] = 400;
    v.haloY[0] = 300;
    v.haloR[0] = 90;
    v.haloTier[0] = 5;
    v.haloMs[1] = 990;
    v.haloX[1] = 380;
    v.haloY[1] = 320;
    v.haloR[1] = 10;
    v.haloTier[1] = 2;
    for (let i = 0; i < 3; i++) {
      calls.length = 0;
      layer.drawWorld(ctx, v, opts);
      layer.drawEffects(ctx, v);
      layer.drawOverlay(ctx, v, DEFAULT_MERGE_RING_LABELS);
      v.timeMs += 1000 / 60;
    }
    const shadowed = calls.filter((c) => (c.name === "stroke" || c.name === "fill" || c.name === "fillText") && c.shadowBlur > 0);
    // only the small halo's stroke keeps its blur
    expect(shadowed.length).toBe(1);
    expect(shadowed[0].shadowBlur).toBe(HALO_GLOW);
    expect(count(calls, "drawImage")).toBe(2); // the rim and the ladder
    expect(count(calls, "createRadialGradient")).toBe(1); // the big halo's glow
    // without the wall glow the rim is drawn live (no blur to save)
    calls.length = 0;
    layer.drawWorld(ctx, v, { ...opts, showWallGlow: false });
    expect(count(calls, "drawImage")).toBe(0);
    expect(count(calls, "stroke")).toBe(RIM_SEGMENTS);
  });

  it("the final form's flash: a gradient along the rim, the blur only round its two ends (shadow only), the stroke on top", () => {
    const { create } = fakeCanvases();
    const layer = new MergeRingLayer(create);
    const { ctx, calls } = fakeContext();
    ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
    const v = viewOf({ finalMs: 900 });
    layer.drawWorld(ctx, v, opts);
    calls.length = 0;
    layer.drawWorld(ctx, v, opts);
    expect(count(calls, "createRadialGradient")).toBe(1);
    const strokes = calls.filter((c) => c.name === "stroke");
    // two end glows (their arcs far off the canvas, only the shadow lands, clipped to the ends) and the flash's stroke
    expect(strokes.length).toBe(3);
    expect(strokes.slice(0, 2).every((c) => c.shadowBlur > 0 && c.shadowOffsetX === 32768)).toBe(true);
    expect(count(calls, "clip")).toBe(2);
    expect(strokes[2].shadowBlur).toBe(0);
  });
});

/* ------------------------------------------------------------------ the generic ball pass */

describe("the trails under the dark bodies", () => {
  it("skip a trail only when every stroke of it lies under the opaque body", () => {
    const resting = { x: 100, y: 100, radius: 24, trail: Array.from({ length: 20 }, (_, i) => ({ x: 100 + 0.3 * Math.sin(i), y: 100 + 0.2 * Math.cos(i) })) };
    expect(trailUnderBody(resting, 0.8, 2)).toBe(true);
    // falling: its trail reaches out of the body
    const falling = { ...resting, trail: Array.from({ length: 20 }, (_, i) => ({ x: 100, y: 100 - 4 * (19 - i) })) };
    expect(trailUnderBody(falling, 0.8, 2)).toBe(false);
    // a thick trail sticks out past the body even at rest; a tiny ball's anti-aliasing leaves no room
    expect(trailUnderBody(resting, 2, 2)).toBe(false);
    expect(trailUnderBody({ ...resting, radius: 3 }, 0.8, 1)).toBe(false);
    // no scale known, or no trail: drawn as before
    expect(trailUnderBody(resting, 0.8, 0)).toBe(false);
    expect(trailUnderBody({ ...resting, trail: [] }, 0.8, 2)).toBe(false);
    // a point just inside the bound passes, one just past it does not (the body's r − 0.5, a square cap's reach, 1.5 px)
    const reach = 24 - 0.5 - Math.SQRT2 * 0.5 * 24 * 0.8 - 1.5 / 2;
    expect(trailUnderBody({ ...resting, trail: [{ x: 100 + reach - 1e-6, y: 100 }] }, 0.8, 2)).toBe(true);
    expect(trailUnderBody({ ...resting, trail: [{ x: 100 + reach + 1e-6, y: 100 }] }, 0.8, 2)).toBe(false);
  });

  it("the rim's colour strings are the live rim's", () => {
    for (const h of [0, 12.34, 99.95, 180, 359.94, 359.96]) expect(rimColor(h)).toBe(`hsl(${(Math.round(h * 10) % 3600 / 10).toFixed(1)}, 100%, 62%)`);
    expect(rimColor(42.3)).toBe(`hsl(${(42.3).toFixed(1)}, 100%, 62%)`);
  });
});
