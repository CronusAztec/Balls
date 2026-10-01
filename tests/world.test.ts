import { describe, expect, it } from "vitest";
import { WORLD_SIDE, liveWorldOf, snapRatio } from "@/lib/simulation/world";

describe("the simulation world (lib/simulation/world)", () => {
  it("runs 800 × 450 in a 16:9 frame of any size – the stage's frames included, a px or two off the exact ratio – drawn at the frame's scale", () => {
    for (const [w, h] of [
      [790, 444.4],
      [906, 509.6],
      [906, 509],
      [786, 441],
      [1250, 702],
      [1250, 703.1],
      [640, 360],
      [1920, 1080],
    ]) {
      const world = liveWorldOf({ width: w, height: h });
      expect([world.width, world.height]).toEqual([800, 450]);
      expect(world.scale).toBeCloseTo(h / WORLD_SIDE, 6);
    }
  });

  it("runs a 450 × 450 world in a square frame – a 340 px phone canvas draws it at 0.76", () => {
    const phone = liveWorldOf({ width: 340, height: 340 });
    expect(phone).toEqual({ width: 450, height: 450, scale: 340 / 450 });
    expect(liveWorldOf({ width: 364, height: 363 })).toEqual({ width: 450, height: 450, scale: 363 / 450 });
    const tablet = liveWorldOf({ width: 600, height: 600 });
    expect([tablet.width, tablet.height, tablet.scale]).toEqual([450, 450, 600 / 450]);
  });

  it("keeps the shorter side at WORLD_SIDE for any shape, portrait included, and rounds to whole world px", () => {
    const portrait = liveWorldOf({ width: 450, height: 800 });
    expect(portrait).toEqual({ width: 450, height: 800, scale: 1 });
    const odd = liveWorldOf({ width: 1000.4, height: 333.3 });
    expect(odd.height).toBe(WORLD_SIDE);
    expect(odd.width).toBe(Math.round((1000.4 / 333.3) * WORLD_SIDE));
    expect(Number.isInteger(odd.width)).toBe(true);
  });

  it("snaps a frame within 2 % of a known shape to it and leaves the others alone", () => {
    expect(snapRatio(906 / 509)).toBe(16 / 9);
    expect(snapRatio(509 / 906)).toBe(9 / 16);
    expect(snapRatio(364 / 363)).toBe(1);
    expect(snapRatio(3)).toBe(3);
    expect(snapRatio(1.3)).toBe(1.3);
  });

  it("gives an unmeasured or broken frame the square world and no scale", () => {
    for (const rect of [
      { width: 0, height: 0 },
      { width: 0, height: 300 },
      { width: NaN, height: 300 },
      { width: -5, height: 300 },
    ]) {
      expect(liveWorldOf(rect)).toEqual({ width: WORLD_SIDE, height: WORLD_SIDE, scale: 0 });
    }
  });
});
