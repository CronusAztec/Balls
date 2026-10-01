import { describe, expect, it } from "vitest";
import { RING_LOD_FROM, ringDrawStride, ringDrawn } from "@/components/simulator/ringLod";
import { settingsFromSearchParams } from "@/lib/settings";

/*
 * --- review fix (recording-export) --- A link's wc=3000 keeps its 3000 rings (big values are a feature) and the canvas draws
 * about one ring per pixel of the band they fill, so the page stays responsive instead of freezing.
 */
describe("ring level of detail", () => {
  const drawn = (count: number, arena: number) => {
    const stride = ringDrawStride(count, arena);
    let n = 0;
    for (let i = 0; i < count; i++) if (ringDrawn(i, count, stride)) n++;
    return n;
  };

  it("draws every ring up to RING_LOD_FROM and while they are a pixel apart", () => {
    for (const count of [1, 7, 20, RING_LOD_FROM]) {
      expect(ringDrawStride(count, 255)).toBe(1);
      expect(drawn(count, 255)).toBe(count);
    }
    expect(drawn(500, 1000)).toBe(500); // a 0.6 × 1000 px band holds 600 rings a pixel apart
  });

  it("draws about one ring per pixel of the band for thousands, the outermost always", () => {
    const wc = settingsFromSearchParams(new URLSearchParams("mode=classic&wc=3000")).wallCount;
    expect(wc).toBe(3000);
    const arena = 255; // an 800 × 600 world
    const n = drawn(wc, arena);
    expect(n).toBeGreaterThanOrEqual(Math.floor(0.6 * arena) - 1);
    expect(n).toBeLessThanOrEqual(Math.floor(0.6 * arena) + 1);
    const stride = ringDrawStride(wc, arena);
    expect(ringDrawn(0, wc, stride)).toBe(true);
    expect(ringDrawn(wc - 1, wc, stride)).toBe(true);
    expect(drawn(1_000_000, arena)).toBeLessThanOrEqual(Math.floor(0.6 * arena) + 1);
  });

  it("spreads the drawn rings evenly (no gap wider than two strides)", () => {
    const count = 3000;
    const stride = ringDrawStride(count, 255);
    let last = -1;
    for (let i = 0; i < count; i++) {
      if (!ringDrawn(i, count, stride)) continue;
      if (last >= 0) expect(i - last).toBeLessThanOrEqual(Math.ceil(stride) + 1);
      last = i;
    }
  });
});
