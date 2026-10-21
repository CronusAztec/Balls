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
  TextSprite,
  rimColor,
  rimHue,
  trailStrokeUnderBody,
  trailUnderBody,
  type LadderSpec,
  type MergeRingLabels,
  type MergeRingRenderOptions,
  type RimSpec,
} from "@/components/simulator/mergeRingRenderer";
import { GLOW_REACH, GLOW_STOPS, fillStrokeGlow, glowProfile, normalCdf, plainTransform, rgbOfHex, strokeShadowAlpha, type CanvasFactory } from "@/components/simulator/mergeRingGlow";
import { noteTitleBlock } from "@/components/simulator/liveMarkHud";
import { badgeMetrics, exportSquare } from "@/lib/watermark/layout";
import { LiveHud, liveBadgeBox, mapLiveHud, placeLiveBadge, placeVideoBadge } from "@/lib/watermark/liveLayout";

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

/** True when the clearRect `c` (made under its transform, which only scales and translates) clears the whole `w` × `h` bitmap. */
const clearsAll = (c: Call, w: number, h: number) => {
  const [a, b, cc, d, e, f] = c.transform;
  const [x, y, cw, ch] = c.args as number[];
  if (b !== 0 || cc !== 0) return false;
  const x0 = Math.min(e + a * x, e + a * (x + cw));
  const x1 = Math.max(e + a * x, e + a * (x + cw));
  const y0 = Math.min(f + d * y, f + d * (y + ch));
  const y1 = Math.max(f + d * y, f + d * (y + ch));
  return x0 <= 0 && y0 <= 0 && x1 >= w && y1 >= h;
};

/** The calls a bitmap's context got since its last full clear (what the bitmap now shows), without the clear itself. */
const sinceClear = (calls: Call[], w: number, h: number) => {
  let i = calls.length - 1;
  while (i >= 0 && !(calls[i].name === "clearRect" && clearsAll(calls[i], w, h))) i--;
  return calls.slice(i + 1);
};

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

  it("keeps within the hue lag at a low frame rate by refreshing the fifths it must, spread evenly, never all of them a frame", () => {
    for (const fps of [50, 43, 30, 24, 15]) {
      const { create, made } = fakeCanvases();
      const cache = new RimCache(create);
      const { ctx } = fakeContext();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const frame = 1000 / fps;
      cache.draw(ctx, rimSpec({ timeMs: 0 }));
      cache.draw(ctx, rimSpec({ timeMs: 0 }));
      const bitmap = made[0];
      const fills = () => count(bitmap.calls, "fill");
      let last = fills();
      const perFrame: number[] = [];
      for (let i = 1; i <= 120; i++) {
        const t = i * frame;
        cache.draw(ctx, rimSpec({ timeMs: t }));
        perFrame.push((fills() - last) / (RIM_SEGMENTS / RIM_PHASES));
        last = fills();
        expect(cache.hueLagDeg(t), `${fps} fps, frame ${i}`).toBeLessThanOrEqual(RIM_HUE_LAG_DEG + 1e-6);
      }
      // a fifth refreshed every k frames, k the most frames a fifth may fall behind: 5 / k fifths a frame on average
      const k = Math.floor((RIM_HUE_LAG_DEG * 1000) / (frame * RAINBOW_DEG_PER_SEC) + 1e-6) + 1;
      const mean = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
      expect(Math.max(...perFrame), `${fps} fps`).toBeLessThanOrEqual(Math.ceil(RIM_PHASES / k));
      expect(Math.max(...perFrame), `${fps} fps`).toBeLessThan(RIM_PHASES);
      expect(Math.min(...perFrame), `${fps} fps`).toBeGreaterThanOrEqual(1);
      expect(mean, `${fps} fps`).toBeLessThanOrEqual(RIM_PHASES / k + 0.05);
      expect(cache.builds).toBe(1);
    }
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

  it("colours a bitmap rebuilt while the clock stands still (before Start, paused, a finished run)", () => {
    const { create, made } = fakeCanvases();
    const cache = new RimCache(create);
    const { ctx } = fakeContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const T = 4321;
    // settled: every fifth coloured at T, nothing more to do
    for (let i = 0; i < 2 + RIM_PHASES; i++) cache.draw(ctx, rimSpec({ timeMs: T }));
    expect(cache.builds).toBe(1);
    const bitmap = made[0];
    const settled = cache.recolours;
    cache.draw(ctx, rimSpec({ timeMs: T }));
    expect(cache.recolours).toBe(settled);
    // what the bitmap shows now: the white arcs of its last build, then every segment's colour over them
    const shows = () => sinceClear(bitmap.calls, bitmap.canvas.width, bitmap.canvas.height);
    const colouredAll = (what: string) => {
      const since = shows();
      const lastStroke = since.map((c) => c.name).lastIndexOf("stroke");
      const fills = since.slice(lastStroke + 1).filter((c) => c.name === "fill" && c.composite === "source-atop");
      expect(new Set(fills.map((c) => c.fillStyle)).size, what).toBeGreaterThan(RIM_SEGMENTS / 2);
      expect(fills.length, what).toBeGreaterThanOrEqual(RIM_SEGMENTS);
    };
    colouredAll("settled");
    const changes: [string, Partial<RimSpec>][] = [
      ["a resize", { radius: 220, cx: 500 }],
      ["the rainbow off", { radius: 220, cx: 500, rainbow: false, color: "rgba(255, 255, 255, 0.9)" }],
      ["the rainbow back on", { radius: 220, cx: 500 }],
      ["the wall thickness", { radius: 220, cx: 500, width: 4 }],
    ];
    let builds = 1;
    for (const [what, spec] of changes) {
      const before = cache.recolours;
      cache.draw(ctx, rimSpec({ ...spec, timeMs: T })); // live (the change may still be going on)
      cache.draw(ctx, rimSpec({ ...spec, timeMs: T })); // built
      expect(cache.builds, what).toBe(++builds);
      if (spec.rainbow === false) {
        expect(cache.recolours, what).toBe(before);
        continue;
      }
      expect(cache.recolours, what).toBe(before + 1);
      colouredAll(what);
      // and settled again: nothing more to colour
      cache.draw(ctx, rimSpec({ ...spec, timeMs: T }));
      expect(cache.recolours, what).toBe(before + 1);
    }
    // every clear of the bitmap is made in device px
    const clears = bitmap.calls.filter((c) => c.name === "clearRect");
    expect(clears.length).toBe(builds);
    expect(clears.every((c) => c.transform.join() === "1,0,0,1,0,0")).toBe(true);
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

  it("clears the whole bitmap before it is redrawn: a restart shows only the tiers reached, the glows never pile up", () => {
    const { create, made } = fakeCanvases();
    const cache = new LadderCache(create);
    const { ctx } = fakeContext();
    // a translated, scaled view (the ladder hundreds of px to the right): the clear must not follow the ladder's transform
    ctx.setTransform(2, 0, 0, 2, 37, 11);
    for (let top = 1; top <= 6; top++) cache.draw(ctx, ladder({ topTier: top }));
    cache.draw(ctx, ladder({ topTier: 1 })); // a restart
    expect(cache.builds).toBe(7);
    const bitmap = made[0];
    const { width: w, height: h } = bitmap.canvas;
    // the bitmap's size held (only the lit tiers changed), so each redraw cleared it – all of it, in device px
    const clears = bitmap.calls.filter((c) => c.name === "clearRect");
    expect(clears.length).toBeGreaterThanOrEqual(6);
    expect(clears.every((c) => clearsAll(c, w, h))).toBe(true);
    // what it shows is a fresh build's ladder at tier 1: the same calls, nothing of tier 6 left under it
    const fresh = fakeCanvases();
    new LadderCache(fresh.create).draw(ctx, ladder({ topTier: 1 }));
    const strip = (calls: Call[]) => calls.filter((c) => c.name !== "clearRect").map((c) => JSON.stringify([c.name, c.args, c.shadowBlur, c.globalAlpha, c.transform]));
    expect(strip(sinceClear(bitmap.calls, w, h))).toEqual(strip(fresh.made[0].calls));
    expect(sinceClear(bitmap.calls, w, h).filter((c) => (c.name === "stroke" || c.name === "fill") && c.shadowBlur > 0).length).toBeLessThanOrEqual(2);
    // a ladder that moves with the camera (same size, a new translation): cleared all the same
    ctx.setTransform(2, 0, 0, 2, 37.5, 11);
    cache.draw(ctx, ladder({ topTier: 1 }));
    expect(cache.builds).toBe(8);
    expect(clearsAll(bitmap.calls.filter((c) => c.name === "clearRect").at(-1)!, w, h)).toBe(true);
  });
});

/* ------------------------------------------------------------------ the HUD's lines */

describe("the HUD's lines from bitmaps", () => {
  it("draws a line once at the canvas' scale and sub-pixel position, then blits it 1:1 at whole device px", () => {
    const { create, made } = fakeCanvases();
    const sprite = new TextSprite(create);
    const { ctx, calls } = fakeContext();
    ctx.setTransform(1.5, 0, 0, 1.5, 3.3, 7.25);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const M = ctx.getTransform();
    expect(sprite.draw(ctx, M, "MERGES 7", "700 10.1px sans-serif", "#f472b6", 13, 401.7, 52.9)).toBe(true);
    expect(sprite.builds).toBe(1);
    const bitmap = made[0];
    const text = bitmap.calls.filter((c) => c.name === "fillText");
    expect(text.length).toBe(1);
    expect(text[0].args).toEqual(["MERGES 7", 0, 0]);
    expect(text[0].fillStyle).toBe("#f472b6");
    expect(text[0].shadowBlur).toBe(0);
    // the same scale, the anchor at the same fraction of a device px
    const [a, , , d, e, f] = text[0].transform;
    expect(a).toBe(1.5);
    expect(d).toBe(1.5);
    const X = 1.5 * 401.7 + 3.3;
    const Y = 1.5 * 52.9 + 7.25;
    expect(e - Math.floor(e)).toBeCloseTo(X - Math.floor(X), 12);
    expect(f - Math.floor(f)).toBeCloseTo(Y - Math.floor(Y), 12);
    // the blit: identity, whole px, the anchor landing on the canvas' own device position; the transform restored after it
    const blit = calls.filter((c) => c.name === "drawImage");
    expect(blit.length).toBe(1);
    expect(blit[0].transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Number.isInteger(blit[0].args[1]) && Number.isInteger(blit[0].args[2])).toBe(true);
    expect((blit[0].args[1] as number) + e).toBeCloseTo(X, 9);
    expect((blit[0].args[2] as number) + f).toBeCloseTo(Y, 9);
    expect(ctx.getTransform()).toEqual({ a: 1.5, b: 0, c: 0, d: 1.5, e: 3.3, f: 7.25 });
    // the bitmap holds the ink round the anchor: the right-aligned line reaches left of it
    expect(e).toBeGreaterThan(1.5 * 10);
    expect(bitmap.canvas.width).toBeGreaterThan(e);
    // the same line again: a blit, nothing drawn
    sprite.draw(ctx, M, "MERGES 7", "700 10.1px sans-serif", "#f472b6", 13, 401.7, 52.9);
    expect(sprite.builds).toBe(1);
    // a new text, colour, font, alignment, scale or fraction: drawn again
    const redraws: [string, () => boolean][] = [
      ["text", () => sprite.draw(ctx, M, "MERGES 8", "700 10.1px sans-serif", "#f472b6", 13, 401.7, 52.9)],
      ["colour", () => sprite.draw(ctx, M, "MERGES 8", "700 10.1px sans-serif", "#fb7185", 13, 401.7, 52.9)],
      ["font", () => sprite.draw(ctx, M, "MERGES 8", "700 11px sans-serif", "#fb7185", 13, 401.7, 52.9)],
      ["fraction", () => sprite.draw(ctx, M, "MERGES 8", "700 11px sans-serif", "#fb7185", 13, 401.9, 52.9)],
      ["align", () => ((ctx.textAlign = "left"), sprite.draw(ctx, M, "MERGES 8", "700 11px sans-serif", "#fb7185", 13, 401.9, 52.9))],
    ];
    let builds = 1;
    for (const [what, redraw] of redraws) {
      expect(redraw(), what).toBe(true);
      expect(sprite.builds, what).toBe(++builds);
    }
    // a whole device px further: the same bitmap, blitted a px over
    const before = calls.filter((c) => c.name === "drawImage").at(-1)!.args[1] as number;
    expect(sprite.draw(ctx, M, "MERGES 8", "700 11px sans-serif", "#fb7185", 13, 401.9 + 2 / 1.5, 52.9)).toBe(true);
    expect(sprite.builds).toBe(builds);
    expect(calls.filter((c) => c.name === "drawImage").at(-1)!.args[1]).toBe(before + 2);
  });

  it("leaves the line to the live text where it cannot help", () => {
    const { create } = fakeCanvases();
    const sprite = new TextSprite(create);
    const { ctx } = fakeContext();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.shadowBlur = 4;
    ctx.shadowColor = "#fff";
    expect(sprite.draw(ctx, ctx.getTransform(), "TOP", "800 9px sans-serif", "#fff", 11, 10, 10)).toBe(false);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 2;
    expect(sprite.draw(ctx, ctx.getTransform(), "TOP", "800 9px sans-serif", "#fff", 11, 10, 10)).toBe(false);
    ctx.shadowOffsetY = 0;
    ctx.globalCompositeOperation = "lighter";
    expect(sprite.draw(ctx, ctx.getTransform(), "TOP", "800 9px sans-serif", "#fff", 11, 10, 10)).toBe(false);
    ctx.globalCompositeOperation = "source-over";
    ctx.rotate(0.1);
    expect(sprite.draw(ctx, ctx.getTransform(), "TOP", "800 9px sans-serif", "#fff", 11, 10, 10)).toBe(false);
    expect(sprite.builds).toBe(0);
    const none = new TextSprite(() => null);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    expect(none.draw(ctx, ctx.getTransform(), "TOP", "800 9px sans-serif", "#fff", 11, 10, 10)).toBe(false);
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
    expect(count(calls, "drawImage")).toBe(2 + 5); // the rim, the ladder and the HUD's five lines
    expect(count(calls, "fillText")).toBe(0); // (no font switch a frame)
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

  it("skip a stroke of a moving ball's trail only when it lies under the opaque body", () => {
    const ball = { x: 100, y: 100, radius: 24 };
    const k = 2;
    // the body's r − 0.5, less a square cap's reach (√2 · width / 2) and 1.5 device px
    const reach = (w: number) => 24 - 0.5 - Math.SQRT2 * 0.5 * w - 1.5 / k;
    // the newest, thickest stroke at the ball: hidden; an older one up the trail: drawn
    expect(trailStrokeUnderBody(ball, 100, 96, 100, 100, 19.2, k)).toBe(true);
    expect(trailStrokeUnderBody(ball, 100, 60, 100, 64, 8, k)).toBe(false);
    // one end out: drawn
    expect(trailStrokeUnderBody(ball, 100, 100, 100, 100 - reach(8) - 1e-6, 8, k)).toBe(false);
    expect(trailStrokeUnderBody(ball, 100, 100, 100, 100 - reach(8) + 1e-6, 8, k)).toBe(true);
    // a thinner stroke may reach further
    expect(trailStrokeUnderBody(ball, 100, 100 - reach(4) + 1e-6, 100, 100, 4, k)).toBe(true);
    expect(reach(4)).toBeGreaterThan(reach(8));
    // no scale known, or a stroke too wide for the body: drawn
    expect(trailStrokeUnderBody(ball, 100, 100, 100, 100, 8, 0)).toBe(false);
    expect(trailStrokeUnderBody(ball, 100, 100, 100, 100, 40, k)).toBe(false);
    // a trail wholly under the body (trailUnderBody) has every stroke under it
    const resting = { ...ball, trail: Array.from({ length: 20 }, (_, i) => ({ x: 100 + 0.3 * Math.sin(i), y: 100 + 0.2 * Math.cos(i) })) };
    expect(trailUnderBody(resting, 0.8, k)).toBe(true);
    for (let i = 1; i < 20; i++) {
      const w = 24 * 0.8 * (0.3 + (0.7 * i) / 20);
      expect(trailStrokeUnderBody(ball, resting.trail[i - 1].x, resting.trail[i - 1].y, resting.trail[i].x, resting.trail[i].y, w, k)).toBe(true);
    }
  });

  it("the rim's colour strings are the live rim's", () => {
    for (const h of [0, 12.34, 99.95, 180, 359.94, 359.96]) expect(rimColor(h)).toBe(`hsl(${(Math.round(h * 10) % 3600 / 10).toFixed(1)}, 100%, 62%)`);
    expect(rimColor(42.3)).toBe(`hsl(${(42.3).toFixed(1)}, 100%, 62%)`);
  });
});

/* ------------------------------------------------------------------ the HUD clear of itself and of the live watermark */

describe("the HUD: the tier name clear of the ladder, the caption clear of the watermark badge", () => {
  // Polish (messages/pl.json MergeRing): the longest tier name and caption the page shows
  const PL: MergeRingLabels = { ...DEFAULT_MERGE_RING_LABELS, top: "SZCZYT", tier: () => "Nieskończoność", caption: "Czy połączy się w ostateczną formę?" };

  /** The overlay drawn live (no offscreen canvas: the lines' fillText and the ladder's arcs land on the context). */
  function drawn(width: number, height: number, inset: number, tiers: number, labels: MergeRingLabels = PL) {
    const layer = new MergeRingLayer(() => null);
    const { ctx, calls } = fakeContext();
    const v = new MergeRingMode().getView();
    v.layout = buildMergeRingLayout(width, height, 8);
    v.settings = { ...v.settings, tiers };
    v.topTier = 5;
    layer.drawOverlay(ctx, v, labels, inset);
    const L = v.layout;
    const fs = Math.max(11, 0.03 * L.side);
    const cfs = Math.max(11, 0.034 * L.side);
    const line = (text: string) => calls.find((c) => c.name === "fillText" && c.args[0] === text)!.args as [string, number, number];
    // the ladder's rings: the arcs drawn round the tiers at the context's own transform (the emblems' are translated)
    const rings = calls.filter((c) => c.name === "arc" && c.transform.join() === "1,0,0,1,0,0").map((c) => c.args as number[]);
    return { layer, L, fs, cfs, tier: line("Nieskończoność"), caption: line(labels.caption), rings };
  }

  it("the top emblem starts below the tier name live under the page's buttons, and the ladder is the old one while recording", () => {
    for (const [w, h] of [[320, 560], [390, 640], [500, 760], [640, 900]]) {
      for (const tiers of [4, 7, 10]) {
        const { L, fs, tier, rings } = drawn(w, h, 52, tiers);
        expect(rings.length).toBe(tiers);
        const ys = rings.map((r) => r[1]).sort((a, b) => a - b);
        const r = rings[0][2];
        // the name (right-aligned on the ladder's column) ends above the top ring
        expect(tier[2] + 0.6 * 1.05 * fs, `${w}×${h} ${tiers} tiers`).toBeLessThanOrEqual(ys[0] - r - 1);
        // the rings keep apart, and the ladder still runs down to its old bottom
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(2 * r - 1e-9);
        expect(ys[ys.length - 1]).toBeCloseTo(L.cy + 0.8 * L.radius, 9);
      }
    }
    // recording (no inset) and a wide stage: the ladder as it always was
    for (const [w, h] of [[390, 640], [1280, 900]]) {
      const { L, rings } = drawn(w, h, 0, 7);
      const ys = rings.map((r) => r[1]).sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(L.cy - 0.8 * L.radius, 9);
      expect(rings[0][2]).toBeCloseTo(0.95 * Math.max(6, Math.min(0.032 * L.side, (1.6 * L.radius) / (7 * 1.5))), 9);
    }
  });

  it("reports the caption and the ladder: the live badge goes above the caption, off the ladder, in a corner the HUD leaves free", () => {
    for (const [w, h] of [[390, 640], [1280, 900]]) {
      for (const inset of [52, 0]) {
        const { layer, L, cfs, caption, rings } = drawn(w, h, inset, 10);
        const sq = { x0: L.left, y0: L.top, side: L.side };
        const hud = new LiveHud().reset(1);
        noteTitleBlock(hud, sq, inset, 2, "both");
        layer.noteHud(hud);
        const box = liveBadgeBox({ area: { x: L.left, y: L.top, width: L.side, height: L.side } });
        for (const t of [1000, 7000, 13000, 19000]) {
          const p = placeLiveBadge(box, Math.round(4.2 * box.height), box.height, t, hud, { x: 0, y: 0, width: 0, height: 0, corner: "bottom-left", free: true });
          expect(p.free, `${w}×${h} inset ${inset} at ${t}`).toBe(true); // (clear of the corners' lines too)
          // above the caption's glyphs, whatever its width
          expect(p.y + p.height).toBeLessThanOrEqual(caption[2] - 0.5 * cfs);
          // off every tier of the ladder
          for (const [x, y, r] of rings) expect(p.x > x + r || p.x + p.width < x - r || p.y > y + r || p.y + p.height < y - r).toBe(true);
        }
      }
    }
    // nothing drawn (no layout yet): nothing reported
    const layer = new MergeRingLayer(() => null);
    const v = new MergeRingMode().getView();
    layer.drawOverlay(fakeContext().ctx, v, PL);
    const hud = new LiveHud().reset(1);
    layer.noteHud(hud);
    expect([hud.count, hud.bottom]).toEqual([0, Number.POSITIVE_INFINITY]);
  });

  it("a portrait export keeps its badge above the caption and still changes side", () => {
    const { layer, L, cfs, caption } = drawn(1080, 1920, 0, 10);
    const src = new LiveHud().reset(1);
    noteTitleBlock(src, { x0: L.left, y0: L.top, side: L.side }, 0, 2, "both");
    layer.noteHud(src);
    const square = exportSquare(1080, 1920);
    const hud = mapLiveHud(src, { x: L.left, y: L.top, side: L.side }, square, new LiveHud());
    const m = badgeMetrics(square.width);
    const corners = [1000, 7000].map((t) => {
      const p = placeVideoBadge(1080, 1920, square, { width: Math.round(4.2 * m.height), height: m.height, inset: m.inset }, t, hud, { x: 0, y: 0, width: 0, height: 0, corner: "bottom-left", free: true });
      expect(p.free).toBe(true);
      expect(p.y + p.height).toBeLessThanOrEqual(square.y + (caption[2] - 0.5 * cfs - L.top) * (square.width / L.side));
      return p.corner;
    });
    expect(corners).toEqual(["bottom-left", "bottom-right"]);
  });
});
