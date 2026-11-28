import { describe, expect, it } from "vitest";
import { drawPreview } from "@/components/site/livePreviewEngine";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- ring-arc --- (round two, B8) The landing page's live preview (components/site/livePreviewEngine.ts) draws a ring without
 * gaps as the whole circle from 0, as the studio's canvas does (components/simulator/ringArc.ts): Chromium strokes nothing for an
 * arc from a turned start to that start plus 2π at about 1.5 % of the angles, so the landing's ring blinked out for a frame or two.
 * A ring with gaps keeps its arcs as they were.
 */

const TWO_PI = 2 * Math.PI;
const PALETTE = { background: "#0a0a0a", wall: "#ffffff", ball: "#a3e635", ballAlt: "#38bdf8" };

type Calls = { calls: { name: string; args: unknown[] }[] };

/** A headless stand-in for the engine: only what drawPreview() reads. */
function fakeEngine(walls: { radius: number; gaps: { startAngle: number; endAngle: number }[] }[], rotations: number[]): PhysicsEngine {
  return {
    getCircularWalls: () => walls,
    getWallRotations: () => rotations,
    getBrokenWalls: () => new Set<number>(),
    getObstacles: () => [],
    getBalls: () => [],
  } as unknown as PhysicsEngine;
}

describe("ring-arc: the landing's live preview", () => {
  it("strokes a turned ring without gaps as the whole circle from 0 at every one of 4,000 turns", () => {
    const ctx = fakeCanvas(400, 400).getContext("2d") as unknown as CanvasRenderingContext2D & Calls;
    for (let i = 0; i < 4000; i++) {
      const rot = (i / 4000) * TWO_PI * 7 + 0.000123 * i; // turned starts across seven turns of the ring
      ctx.calls.length = 0;
      drawPreview(ctx, fakeEngine([{ radius: 150, gaps: [] }], [rot]), 400, 400, PALETTE);
      const arcs = ctx.calls.filter((c) => c.name === "arc");
      expect(arcs).toEqual([{ name: "arc", args: [200, 200, 150, 0, TWO_PI] }]);
    }
  });

  it("keeps the arcs a ring's gaps leave as they were", () => {
    const ctx = fakeCanvas(400, 400).getContext("2d") as unknown as CanvasRenderingContext2D & Calls;
    drawPreview(ctx, fakeEngine([{ radius: 100, gaps: [{ startAngle: 1, endAngle: 1.5 }] }], [0.25]), 400, 400, PALETTE);
    const arcs = ctx.calls.filter((c) => c.name === "arc");
    expect(arcs).toEqual([
      { name: "arc", args: [200, 200, 100, 0.25, 1.25] },
      { name: "arc", args: [200, 200, 100, 1.75, TWO_PI + 0.25] },
    ]);
  });
});
