import { describe, expect, it } from "vitest";
import { FULL_TURN_EPS, isFullTurn, ringArc } from "@/components/simulator/ringArc";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- ring-arc --- (D3 review) A ring without gaps is stroked as the whole circle from 0 (components/simulator/ringArc.ts): Chromium
 * strokes nothing for an arc from a turned start to that start plus 2π at about 1.5 % of the angles, so the ring of every ring clip
 * blinked out for a frame or two at the same moments of its turn. Every shorter arc is drawn as it was.
 */

const TWO_PI = 2 * Math.PI;

describe("ring-arc: a whole ring stroked from 0", () => {
  it("draws a turned full turn as the circle from 0 to 2π, and every arc a gap leaves as it is", () => {
    const ctx = fakeCanvas(200, 200).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    for (const rot of [0, 1.9869677451620453, 9.013613362583248, 1234.5678]) {
      expect(isFullTurn(rot, TWO_PI + rot)).toBe(true);
      ctx.calls.length = 0;
      ringArc(ctx, 100, 100, 80, rot, TWO_PI + rot);
      expect(ctx.calls).toEqual([{ name: "arc", args: [100, 100, 80, 0, TWO_PI] }]);
    }
    // an arc a gap leaves (the shortest a ring can lose is far more than the margin) keeps its own ends
    expect(isFullTurn(1, 1 + TWO_PI - 10 * FULL_TURN_EPS)).toBe(false);
    ctx.calls.length = 0;
    ringArc(ctx, 100, 100, 80, 1, 1 + TWO_PI - 0.2);
    expect(ctx.calls).toEqual([{ name: "arc", args: [100, 100, 80, 1, 1 + TWO_PI - 0.2] }]);
  });

  it("starts a batched ring's subpath where its arc starts: at 0 for a whole ring, at its turned start otherwise", () => {
    const ctx = fakeCanvas(200, 200).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    ringArc(ctx, 100, 100, 80, 3, 3 + TWO_PI, true);
    expect(ctx.calls).toEqual([
      { name: "moveTo", args: [180, 100] },
      { name: "arc", args: [100, 100, 80, 0, TWO_PI] },
    ]);
    ctx.calls.length = 0;
    ringArc(ctx, 100, 100, 80, 0.5, 2, true);
    expect(ctx.calls[0]).toEqual({ name: "moveTo", args: [100 + Math.cos(0.5) * 80, 100 + Math.sin(0.5) * 80] });
    expect(ctx.calls[1]).toEqual({ name: "arc", args: [100, 100, 80, 0.5, 2] });
  });
});
