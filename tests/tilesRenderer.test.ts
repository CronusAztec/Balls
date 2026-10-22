import { describe, expect, it } from "vitest";
import { TileField } from "@/lib/physics/tiles";
import {
  DEFAULT_TILE_PALETTE,
  TILE_BREAK_MS,
  TILE_FLASH_MS,
  TILE_HP_SHADES,
  TILE_STYLES,
  TilesLayer,
  breakAlpha,
  breakGrow,
  flashAt,
  hpShade,
  isTileStyle,
  rgbOf,
  tileFill,
  tileStroke,
  traceTile,
} from "@/components/simulator/tilesRenderer";

/*
 * --- tiles --- The canvas drawing of a TileField (components/simulator/tilesRenderer.ts): the damage shades, the cached
 * colours of the three styles, batched paths (one fill per colour and shade, never one per tile), broken tiles left out,
 * the flash of a hit and the fading outline of a break on the field's own clock, and a frame drawn twice the same way.
 */

interface Call {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
}

/** A 2D context that records every call with the fill and stroke styles in force. */
function fakeContext() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, lineJoin: "miter" };
  const ctx = new Proxy(state as unknown as CanvasRenderingContext2D, {
    get: (_t, prop: string) => {
      if (prop in state) return state[prop];
      return (...args: unknown[]) => calls.push({ name: prop, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle });
    },
    set: (_t, prop: string, value) => {
      state[prop] = value;
      return true;
    },
  });
  return { ctx, calls };
}

const count = (calls: Call[], name: string) => calls.filter((c) => c.name === name).length;

/** A field of 3 × 4 rects and a ring of 6 sectors plus one whole ring, every tile standing. */
function field() {
  const f = new TileField(64);
  f.layoutGrid({ x: 0, y: 0, width: 400, height: 90, rows: 3, cols: 4, gap: 2, hp: 4 });
  f.layoutRing({ cx: 200, cy: 300, innerRadius: 40, outerRadius: 100, rows: 1, cols: 6, gap: 4, hp: 4 });
  f.addSector(200, 300, 110, 120, 0, Math.PI * 2, 4, 1, 0);
  f.build();
  return f;
}

describe("tiles renderer: colours", () => {
  it("shades a tile by the hit points it lost, in TILE_HP_SHADES steps", () => {
    expect(hpShade(4, 4)).toBe(0);
    expect(hpShade(3.01, 4)).toBe(0);
    expect(hpShade(3, 4)).toBe(1);
    expect(hpShade(1, 4)).toBe(3);
    expect(hpShade(0.0001, 4)).toBe(TILE_HP_SHADES - 1);
    expect(hpShade(0, 4)).toBe(TILE_HP_SHADES - 1);
    expect(hpShade(5, 4)).toBe(0);
    expect(hpShade(1, 0)).toBe(0);
  });

  it("parses colours and falls back to white", () => {
    expect(rgbOf("#ff8000")).toEqual([255, 128, 0]);
    expect(rgbOf("#0f0")).toEqual([0, 255, 0]);
    expect(rgbOf("red")).toEqual([255, 255, 255]);
    expect(rgbOf("#12345")).toEqual([255, 255, 255]);
    expect(isTileStyle("glass")).toBe(true);
    expect(isTileStyle("lava")).toBe(false);
  });

  it("gives every style and shade a valid rgba, fading or darkening as the tile cracks", () => {
    const alpha = (s: string) => Number(/, ([\d.]+)\)$/.exec(s)![1]);
    const channel = (s: string) => Number(/^rgba\((\d+),/.exec(s)![1]);
    for (const style of TILE_STYLES) {
      for (let s = 0; s < TILE_HP_SHADES; s++) {
        expect(tileFill(style, "#5ec8f8", s)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
        expect(tileStroke(style, "#5ec8f8", s)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
      }
    }
    expect(alpha(tileFill("glass", "#5ec8f8", 3))).toBeLessThan(alpha(tileFill("glass", "#5ec8f8", 0)));
    expect(channel(tileFill("brick", "#c86040", 3))).toBeLessThan(channel(tileFill("brick", "#c86040", 0)));
    expect(alpha(tileStroke("neon", "#5ec8f8", 3))).toBeLessThan(alpha(tileStroke("neon", "#5ec8f8", 0)));
  });

  it("flashes a hit and fades a break on the clock, then stops", () => {
    expect(flashAt(0)).toBe(1);
    expect(flashAt(TILE_FLASH_MS / 2)).toBeCloseTo(0.5, 9);
    expect(flashAt(TILE_FLASH_MS)).toBe(0);
    expect(flashAt(-1)).toBe(0);
    expect(flashAt(Number.POSITIVE_INFINITY)).toBe(0);
    expect(breakAlpha(0)).toBeCloseTo(0.9, 9);
    expect(breakAlpha(TILE_BREAK_MS)).toBe(0);
    expect(breakAlpha(Number.NaN)).toBe(0);
    expect(breakGrow(0)).toBe(1);
    expect(breakGrow(TILE_BREAK_MS / 2)).toBeGreaterThan(1);
    expect(breakGrow(TILE_BREAK_MS)).toBeCloseTo(1.25, 9);
  });
});

describe("tiles renderer: drawing", () => {
  it("traces a rect as a rect, a sector with two arcs and a whole ring with its hole the other way round", () => {
    const f = field();
    const { ctx, calls } = fakeContext();
    traceTile(ctx, f, 0);
    expect(calls.map((c) => c.name)).toEqual(["rect"]);
    calls.length = 0;
    traceTile(ctx, f, 12);
    expect(calls.map((c) => c.name)).toEqual(["moveTo", "arc", "arc", "closePath"]);
    expect(calls[1].args[5] ?? false).toBe(false);
    expect(calls[2].args[5]).toBe(true);
    calls.length = 0;
    traceTile(ctx, f, 18);
    expect(calls.map((c) => c.name)).toEqual(["moveTo", "arc", "moveTo", "arc", "closePath"]);
    expect(calls[3].args[5]).toBe(true);
  });

  it("batches the standing tiles into one fill per colour and shade, and leaves the broken ones out", () => {
    const f = field();
    const layer = new TilesLayer();
    const { ctx, calls } = fakeContext();
    layer.draw(ctx, f, { style: "glass" });
    // rows 0, 1, 2 of the grid (row 0 also holds the ring of 6 sectors, row 1 the whole ring): three colours, one shade
    expect(count(calls, "fill")).toBe(3);
    expect(count(calls, "rect")).toBe(2 * 12); // filled once, outlined once
    expect(count(calls, "stroke")).toBe(1);
    const fills = calls.filter((c) => c.name === "fill").map((c) => c.fillStyle);
    expect(fills).toEqual([tileFill("glass", DEFAULT_TILE_PALETTE[0], 0), tileFill("glass", DEFAULT_TILE_PALETTE[1], 0), tileFill("glass", DEFAULT_TILE_PALETTE[2], 0)]);

    // crack one tile, break two (one long ago): one more batch, two fewer rects, no break outline past its fade
    f.clockMs = 5000;
    f.damage(1, 3);
    f.clockMs = 6000;
    f.destroy(2);
    f.destroy(5);
    f.clockMs = 6000 + TILE_BREAK_MS + TILE_FLASH_MS;
    const second = fakeContext();
    layer.draw(second.ctx, f, { style: "glass" });
    expect(count(second.calls, "fill")).toBe(4);
    expect(count(second.calls, "rect")).toBe(2 * 10);
  });

  it("flashes a tile hit just now and outlines a tile broken just now, on the field's clock", () => {
    const f = field();
    const layer = new TilesLayer();
    f.clockMs = 1000;
    f.damage(0, 1);
    f.damage(13, 9);
    const now = fakeContext();
    layer.draw(now.ctx, f, { style: "brick" });
    // the batches (one per colour and shade), the flash of tile 0, the break of tile 13 (stroked under a scale)
    const flashFills = now.calls.filter((c) => c.name === "fill" && String(c.fillStyle).startsWith("rgba(255, 255, 255"));
    expect(flashFills.length).toBe(1);
    expect(count(now.calls, "scale")).toBe(1);
    // a little later both have faded
    f.clockMs = 1000 + TILE_BREAK_MS;
    const later = fakeContext();
    layer.draw(later.ctx, f, { style: "brick" });
    expect(later.calls.filter((c) => c.name === "fill" && String(c.fillStyle).startsWith("rgba(255, 255, 255")).length).toBe(0);
    expect(count(later.calls, "scale")).toBe(0);
  });

  it("strokes neon per batch (a wide glow under a thin line) and colours by column on request", () => {
    const f = field();
    const layer = new TilesLayer();
    const { ctx, calls } = fakeContext();
    const palette = ["#ff0000", "#00ff00"];
    layer.draw(ctx, f, { style: "neon", palette, colorBy: "col" });
    const fills = calls.filter((c) => c.name === "fill");
    expect(fills.length).toBe(2);
    expect(count(calls, "stroke")).toBe(2 * fills.length);
    expect(fills.map((c) => c.fillStyle)).toEqual([tileFill("neon", "#ff0000", 0), tileFill("neon", "#00ff00", 0)]);
  });

  it("draws the same frame the same way twice (no clock of its own, nothing random), and nothing for an empty field", () => {
    const f = field();
    f.clockMs = 200;
    f.damage(3, 2);
    const layer = new TilesLayer();
    const a = fakeContext();
    const b = fakeContext();
    layer.draw(a.ctx, f, { style: "neon" });
    layer.draw(b.ctx, f, { style: "neon" });
    expect(b.calls).toEqual(a.calls);
    const empty = fakeContext();
    layer.draw(empty.ctx, new TileField(4), { style: "glass" });
    expect(empty.calls).toEqual([]);
  });
});
