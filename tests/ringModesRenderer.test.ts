import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_COLORS,
  DETAIL_CAP,
  DIM_ALPHA,
  FLOOR_ALPHA,
  FLOOR_COLORS,
  FROST_BURST_MS,
  PIP_CAP,
  SEGMENT_BURST_MS,
  countdownNumberSize,
  countdownTileThickness,
  drawAccumulationField,
  drawAccumulationTimerRing,
  drawColorMatchHalo,
  drawColorMatchRing,
  drawCountdownRing,
  drawRingFloor,
  drawRingPips,
  flashLeft,
  ringPipLayout,
  timerColor,
  type CountdownRingView,
} from "@/components/simulator/ringModesRenderer";
import type { FrozenBall } from "@/lib/physics/modes/accumulation";
import type { ColorMatchSegment } from "@/lib/physics/modes/colorMatch";
import { COUNTDOWN_FLASH_MS, type WrongFlash } from "@/lib/physics/modes/target";
import { DARK_LUMA } from "@/lib/videoAnalysis/features";
import { fakeCanvas, type FakeContext } from "./fakeCanvas";

/*
 * --- ring-looks --- The picture of Countdown, Color Match, Accumulation and Classic's rings-left pips
 * (components/simulator/ringModesRenderer.ts): what a stranger has to read in a second is drawn – the tile to hit, the
 * segments that match, the timer running out, the rings left – from the modes' state and the simulation clock alone.
 */

const canvasSource = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Canvas.tsx"), "utf8");

interface Drawn {
  name: string;
  args: unknown[];
  stroke: unknown;
  fill: unknown;
  alpha: number;
  width: number;
  font: string;
  blur: number;
}

/** A fake canvas whose drawing calls remember the state they were made with. */
function recorder(side = 1080): { ctx: FakeContext; g: CanvasRenderingContext2D; drawn: Drawn[] } {
  const ctx = fakeCanvas(side, side).ctx;
  const drawn: Drawn[] = [];
  for (const name of ["stroke", "fill", "fillText", "strokeText", "fillRect", "strokeRect"]) {
    const logged = ctx[name] as (...args: unknown[]) => unknown;
    ctx[name] = (...args: unknown[]) => {
      drawn.push({ name, args, stroke: ctx.strokeStyle, fill: ctx.fillStyle, alpha: ctx.globalAlpha, width: ctx.lineWidth, font: ctx.font, blur: ctx.shadowBlur });
      return logged(...args);
    };
  }
  return { ctx, g: ctx as unknown as CanvasRenderingContext2D, drawn };
}

/** A ring that does not wobble: the arc as the canvas' WobbleLayer draws it at rest. */
const arcs = {
  pathArc(ctx: CanvasRenderingContext2D, _wall: number, cx: number, cy: number, radius: number, start: number, end: number) {
    ctx.arc(cx, cy, radius, start, end);
  },
};

const texts = (drawn: Drawn[]) => drawn.filter((d) => d.name === "fillText").map((d) => String(d.args[0]));
const balanced = (ctx: FakeContext) => ctx.calls.filter((c) => c.name === "save").length === ctx.calls.filter((c) => c.name === "restore").length;

describe("Countdown's ring", () => {
  const view = (patch: Partial<CountdownRingView> = {}): CountdownRingView => ({ total: 7, target: 5, hit: new Set([7, 6]), flashes: [], map: [7, 6, 5, 4, 3, 2, 1], complete: false, ...patch });

  it("draws every number on a bright tile, the one to hit next in yellow, thicker and glowing, the hit ones green", () => {
    const { ctx, g, drawn } = recorder();
    drawCountdownRing(g, view(), 540, 540, 400, 1000, arcs);
    const tiles = drawn.filter((d) => d.name === "stroke");
    expect(tiles.length).toBe(7);
    expect(tiles.map((t) => t.stroke)).toEqual([COUNTDOWN_COLORS.hit, COUNTDOWN_COLORS.hit, COUNTDOWN_COLORS.target, COUNTDOWN_COLORS.idle, COUNTDOWN_COLORS.idle, COUNTDOWN_COLORS.idle, COUNTDOWN_COLORS.idle]);
    const thickness = countdownTileThickness(400);
    expect(tiles[3].width).toBe(thickness);
    expect(tiles[2].width).toBeGreaterThan(1.25 * thickness); // the target's tile stands out of the ring
    expect(tiles[2].blur).toBeGreaterThan(0);
    for (const t of tiles) expect(t.alpha).toBeGreaterThan(0.5); // no tile is the old 40 % grey
    // every number once on its tile, the target's bigger; and the number to hit huge and faint behind the ball
    const words = texts(drawn);
    expect(words[0]).toBe("5");
    expect(words.slice(1).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    const sizeOf = (d: Drawn) => Number(/([\d.]+)px/.exec(d.font)![1]);
    const numbers = drawn.filter((d) => d.name === "fillText");
    expect(sizeOf(numbers[0])).toBeGreaterThan(250); // 78 % of the ring's radius: read from across a room
    expect(numbers[0].alpha).toBeLessThan(0.35);
    const onTiles = numbers.slice(1);
    expect(sizeOf(onTiles.find((n) => n.args[0] === "5")!)).toBeGreaterThan(sizeOf(onTiles.find((n) => n.args[0] === "4")!));
    expect(sizeOf(onTiles.find((n) => n.args[0] === "4")!)).toBeGreaterThanOrEqual(0.05 * 1080); // 27 px in a 540 px feed
    // a pointer at the target (the one filled triangle), and the state handed back
    expect(drawn.filter((d) => d.name === "fill" && d.fill === COUNTDOWN_COLORS.target).length).toBe(1);
    // under it all the arena's floor: the first thing drawn, a tinted disc as wide as the ring
    expect([drawn[0].name, drawn[0].fill, drawn[0].alpha]).toEqual(["fill", FLOOR_COLORS.countdown, FLOOR_ALPHA]);
    expect(balanced(ctx)).toBe(true);
  });

  it("pops a hit tile, punches the centre number and shakes a wrong tile red, all on the flashes' own clock", () => {
    const right: WrongFlash = { segment: 6, time: COUNTDOWN_FLASH_MS, right: true };
    const wrong: WrongFlash = { segment: 2, time: COUNTDOWN_FLASH_MS / 2 };
    expect(flashLeft([right, wrong], true)).toBe(1);
    expect(flashLeft([right, wrong], false)).toBe(0.5);
    expect(flashLeft([right, wrong], false, 3)).toBe(0);
    expect(flashLeft([], true)).toBe(0);
    const still = recorder();
    drawCountdownRing(still.g, view(), 540, 540, 400, 1000, arcs);
    const hot = recorder();
    drawCountdownRing(hot.g, view({ flashes: [right, wrong] }), 540, 540, 400, 1000, arcs);
    const tile = (r: { drawn: Drawn[] }, index: number) => r.drawn.filter((d) => d.name === "stroke")[index];
    expect(tile(hot, 1).width).toBeGreaterThan(1.5 * tile(still, 1).width); // tile 6 pops
    expect(tile(hot, 5).stroke).toBe(COUNTDOWN_COLORS.wrong); // tile 2 is red
    expect(tile(still, 5).stroke).toBe(COUNTDOWN_COLORS.idle);
    const centre = (r: { drawn: Drawn[] }) => r.drawn.filter((d) => d.name === "fillText")[0];
    expect(Number(/([\d.]+)px/.exec(centre(hot).font)![1])).toBeGreaterThan(Number(/([\d.]+)px/.exec(centre(still).font)![1]));
    expect(centre(hot).alpha).toBeGreaterThan(centre(still).alpha);
    // the same state and the same clock: the same frame
    const again = recorder();
    drawCountdownRing(again.g, view({ flashes: [right, wrong] }), 540, 540, 400, 1000, arcs);
    expect(again.ctx.calls).toEqual(hot.ctx.calls);
  });

  it("keeps a thousand tiles cheap: the plain ring and the target's number, no number per tile", () => {
    const total = 1000;
    const big = recorder();
    drawCountdownRing(big.g, { total, target: 500, hit: new Set(), flashes: [], map: [], complete: false }, 540, 540, 400, 0, arcs);
    expect(total).toBeGreaterThan(DETAIL_CAP);
    expect(big.drawn.filter((d) => d.name === "stroke").length).toBe(total);
    expect(texts(big.drawn)).toEqual(["500", "500"]); // the centre's and the target tile's
    expect(countdownNumberSize(400, total)).toBe(0);
    expect(countdownNumberSize(400, 7)).toBe(60);
  });

  it("is what the canvas draws, and the old grey ring and centre block are gone", () => {
    expect(canvasSource).toMatch(/drawCountdownRing\(ctx, countdownView, cx, cy, walls\[0\]\.radius, engine\.getElapsedMs\(\), wobble\)/);
    expect(canvasSource).not.toMatch(/\["#333333", 0\.4, "", 0\]/);
    expect(canvasSource).not.toMatch(/ctx\.fillText\(`\$\{hitCount\}\/\$\{total\}`/);
  });
});

describe("Color Match's ring", () => {
  const segment = (index: number, color: string, patch: Partial<ColorMatchSegment> = {}): ColorMatchSegment => ({ index, startAngle: (index * Math.PI) / 4, endAngle: ((index + 1) * Math.PI) / 4, color, hue: 0, colorIndex: 0, broken: false, brokenMs: -1, ...patch });
  const COLOURS = ["#ef4444", "#f97316", "#eab308"];
  /** Eight segments in three colours (the page's default ring), some of them patched. */
  const ring = (patch: Record<number, Partial<ColorMatchSegment>> = {}) => Array.from({ length: 8 }, (_, i) => segment(i, COLOURS[i % 3], patch[i]));

  it("lights the segments of the ball's colour and dims the others: the eye sees where the ball has to land", () => {
    const { ctx, g, drawn } = recorder();
    drawColorMatchRing(g, ring(), "#f97316", false, 540, 540, 400, 0, 2, 5000, arcs);
    const strokes = drawn.filter((d) => d.name === "stroke" && d.width >= 12);
    expect(strokes.length).toBe(8);
    const lit = strokes.filter((s) => s.stroke === "#f97316");
    const dim = strokes.filter((s) => s.stroke !== "#f97316");
    expect(lit.length).toBe(3);
    for (const s of lit) expect([s.alpha, s.blur > 0, s.width]).toEqual([1, true, 1.4 * 12]);
    for (const s of dim) expect([s.alpha, s.blur, s.width]).toEqual([DIM_ALPHA, 0, 12]);
    expect(DIM_ALPHA).toBeLessThanOrEqual(0.5);
    // behind the balls: the segments left, and the rule as a picture in the ball's colour (a dot, an arrow, a cracked tile)
    expect(texts(drawn)).toEqual(["8"]);
    expect(drawn.filter((d) => d.name === "fillRect" && d.fill === "#f97316").length).toBe(2);
    expect(drawn.filter((d) => d.name === "fill" && d.fill === "#f97316").length).toBe(2); // the floor and the rule's dot
    // the floor is the ball's colour of the moment: the arena turns with every bounce
    expect([drawn[0].name, drawn[0].fill, drawn[0].alpha]).toEqual(["fill", "#f97316", FLOOR_ALPHA]);
    expect(balanced(ctx)).toBe(true);
  });

  it("bursts a matched segment outwards for 450 ms of the run, then leaves its place empty", () => {
    const broken = { 2: { broken: true, brokenMs: 4900 } };
    const during = recorder();
    drawColorMatchRing(during.g, ring(broken), "#ef4444", false, 540, 540, 400, 0, 2, 5000, arcs);
    const after = recorder();
    drawColorMatchRing(after.g, ring(broken), "#ef4444", false, 540, 540, 400, 0, 2, 4900 + SEGMENT_BURST_MS, arcs);
    const arcsOf = (r: { ctx: FakeContext }) => r.ctx.calls.filter((c) => c.name === "arc" && Number(c.args[2]) > 400);
    expect(arcsOf(during).length).toBe(1); // one arc past the ring: the burst
    expect(arcsOf(after).length).toBe(0);
    expect(texts(during.drawn)).toEqual(["7"]);
    // the ring open (every segment matched): no ring, no read-out – the banner's moment
    const open = recorder();
    drawColorMatchRing(open.g, ring(), "#ef4444", true, 540, 540, 400, 0, 2, 5000, arcs);
    expect(open.drawn.length).toBe(0);
  });

  it("puts a halo of the ball's colour round the ball, and the canvas no longer writes a grey 'Match colour:' through it", () => {
    const halo = recorder();
    drawColorMatchHalo(halo.g, 100, 100, 8, "#22c55e");
    expect(halo.drawn.map((d) => [d.name, d.stroke])).toEqual([["stroke", "#22c55e"]]);
    expect(Number(halo.ctx.calls.find((c) => c.name === "arc")!.args[2])).toBeGreaterThan(8); // outside the ball
    expect(canvasSource).toMatch(/drawColorMatchRing\(ctx, engine\.getColorMatchSegments\(\), engine\.getColorMatchBallColor\(\), broken\.has\(0\)/);
    expect(canvasSource).not.toMatch(/ctx\.fillText\(L\.matchColour, cx, ly\)/);
  });
});

describe("Accumulation's field", () => {
  const ball = (x: number, y: number, atMs: number): FrozenBall => ({ x, y, radius: 10, color: "#ffffff", atMs });

  it("shows the timer huge and faint in the middle, green to red, with the frozen count under it", () => {
    const { ctx, g, drawn } = recorder();
    drawAccumulationField(g, [ball(300, 300, 0)], 2400, 3000, false, "Frozen: 1", 540, 540, 400, 9000);
    expect(texts(drawn)).toEqual(["2.4", "Frozen: 1"]);
    expect([drawn[0].name, drawn[0].fill, drawn[0].alpha]).toEqual(["fill", FLOOR_COLORS.accumulation, FLOOR_ALPHA]);
    const digits = drawn.find((d) => d.name === "fillText")!;
    expect(digits.fill).toBe(timerColor(0.8));
    expect(digits.alpha).toBeLessThan(0.35);
    expect(timerColor(1)).toBe("rgb(0, 235, 90)");
    expect(timerColor(0.5)).toBe("rgb(255, 235, 90)");
    expect(timerColor(0)).toBe("rgb(255, 0, 90)");
    expect(balanced(ctx)).toBe(true);
    // out: the banner says it, the field keeps only the ice
    const out = recorder();
    drawAccumulationField(out.g, [ball(300, 300, 0)], 0, 3000, true, "Frozen: 1", 540, 540, 400, 9000);
    expect(texts(out.drawn)).toEqual([]);
  });

  it("draws a frozen ball as ice with a frost burst for half a second after it froze", () => {
    const fresh = recorder();
    drawAccumulationField(fresh.g, [ball(300, 300, 8900)], 3000, 3000, false, "", 540, 540, 400, 9000);
    const old = recorder();
    drawAccumulationField(old.g, [ball(300, 300, 8900 - FROST_BURST_MS)], 3000, 3000, false, "", 540, 540, 400, 9000);
    // (after the floor) the body, its white rim and a glint; the burst adds a ring and six spikes
    expect(old.drawn.filter((d) => d.name !== "fillText").map((d) => d.name)).toEqual(["fill", "fill", "stroke", "fill"]);
    expect(old.drawn.filter((d) => d.name === "fill")[1].fill).toBe("#bfe6ff");
    expect(fresh.drawn.filter((d) => d.name !== "fillText").map((d) => d.name)).toEqual(["fill", "fill", "stroke", "fill", "stroke", "stroke"]);
    expect(fresh.ctx.calls.filter((c) => c.name === "lineTo").length).toBe(6);
  });

  it("keeps a thousand frozen balls cheap: the newest with their glint, the rest the plain ball", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ball(100 + (i % 50) * 10, 100 + Math.floor(i / 50) * 10, 0));
    const { ctx } = recorder();
    drawAccumulationField(ctx as unknown as CanvasRenderingContext2D, many, 3000, 3000, false, "", 540, 540, 400, 60000);
    const fills = ctx.calls.filter((c) => c.name === "fill").length;
    expect(fills).toBe(1 + 1000 + DETAIL_CAP); // the floor, every body, the newest ones' glints
  });

  it("runs the timer round the live ball: what is left, clockwise from the top, thicker in the last second", () => {
    const half = recorder();
    drawAccumulationTimerRing(half.g, 200, 200, 8, 1500, 3000, 0);
    const arcsDrawn = half.ctx.calls.filter((c) => c.name === "arc");
    expect(arcsDrawn.length).toBe(2); // the faint track and what is left
    expect([arcsDrawn[1].args[3], arcsDrawn[1].args[4]]).toEqual([-Math.PI / 2, -Math.PI / 2 + Math.PI]);
    expect(Number(arcsDrawn[1].args[2])).toBeGreaterThan(8); // outside the ball
    expect(half.drawn[1].stroke).toBe(timerColor(0.5));
    const last = recorder();
    drawAccumulationTimerRing(last.g, 200, 200, 8, 500, 3000, 52); // (sin(0.03 · 52) ≈ 1: the throb's peak)
    expect(last.drawn[1].width).toBeGreaterThan(half.drawn[1].width);
    const none = recorder();
    drawAccumulationTimerRing(none.g, 200, 200, 8, 0, 3000, 0);
    expect(none.drawn.length).toBe(0);
  });

  it("is what the canvas draws: the old grey discs and the centre timer text are gone", () => {
    expect(canvasSource).toMatch(/drawAccumulationField\(ctx, frozen, engine\.getAccumulationTimer\(\), engine\.getAccumulationTimerMax\(\), engine\.hasAccumulationEscaped\(\)/);
    expect(canvasSource).toMatch(/drawAccumulationTimerRing\(ctx, ball\.x, ball\.y, ball\.radius, engine\.getAccumulationTimer\(\), engine\.getAccumulationTimerMax\(\), engine\.getElapsedMs\(\)\)/);
    expect(canvasSource).not.toMatch(/ctx\.fillText\(seconds\.toFixed\(1\) \+ "s", cx, y \+ 0\.5 \* fs\)/);
  });
});

describe("the arena's floor", () => {
  it("is one tinted disc as wide as the ring, bright enough not to count as a dark pixel over a black page", () => {
    const { ctx, g, drawn } = recorder();
    drawRingFloor(g, 540, 540, 400, "#5a64ff");
    expect(drawn.length).toBe(1);
    expect(ctx.calls.find((c) => c.name === "arc")!.args.slice(0, 3)).toEqual([540, 540, 400]);
    expect(balanced(ctx)).toBe(true);
    // a tint (a theme's background shows through), and over the page's near-black its luma clears the clip analysis' dark line
    expect(FLOOR_ALPHA).toBeLessThan(0.5);
    for (const color of [FLOOR_COLORS.countdown, FLOOR_COLORS.accumulation, "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"]) {
      const [r, g2, b] = [1, 3, 5].map((i) => (parseInt(color.slice(i, i + 2), 16) / 255) * FLOOR_ALPHA + (10 / 255) * (1 - FLOOR_ALPHA));
      expect(0.299 * r + 0.587 * g2 + 0.114 * b, color).toBeGreaterThan(DARK_LUMA + 0.03); // (the analysis' own weights and line)
    }
  });
});

describe("Classic's rings left", () => {
  it("draws the number and a pip per ring in the ring's colour, a broken ring's pip an outline", () => {
    const { ctx, g, drawn } = recorder();
    const bottom = drawRingPips(g, 7, 2, (i) => `ring-${i}`, 0, 0, 1080, 0);
    expect(texts(drawn)).toEqual(["5"]);
    const filled = drawn.filter((d) => d.name === "fillRect");
    expect(filled.map((d) => d.fill)).toEqual(["ring-2", "ring-3", "ring-4", "ring-5", "ring-6"]);
    expect(drawn.filter((d) => d.name === "strokeRect").length).toBe(2);
    for (const d of drawn) if (d.name === "fillText" || d.name === "fillRect") expect(d.alpha).toBe(1); // full opacity, whatever the pass runs at
    // in the square's top-left corner: outside the outermost ring (85 % of the half side) and inside 30 % of the side
    const lay = ringPipLayout(0, 0, 1080, 7, 0);
    const right = Math.max(...filled.map((d) => Number(d.args[0]) + Number(d.args[2])));
    expect(right).toBeLessThan(0.3 * 1080 + lay.fs);
    expect(Math.hypot(540 - right, 540 - bottom)).toBeGreaterThan(0.85 * 540);
    expect(bottom).toBeLessThan(0.1 * 1080);
    expect(lay.fs).toBeGreaterThanOrEqual(0.05 * 1080); // 27 px in a 540 px feed
    expect(balanced(ctx)).toBe(true);
    // out: the number turns green, every pip an outline
    const out = recorder();
    drawRingPips(out.g, 7, 7, (i) => `ring-${i}`, 0, 0, 1080, 0);
    expect(out.drawn.filter((d) => d.name === "fillRect").length).toBe(0);
    expect(out.drawn.find((d) => d.name === "fillText")!.fill).toBe("#a3e635");
  });

  it("keeps a hundred rings to the number alone and moves below the page's own buttons", () => {
    expect(drawRingPips(recorder().g, 0, 0, () => "#fff", 0, 0, 1080, 0)).toBe(0);
    const many = recorder();
    drawRingPips(many.g, 100, 3, () => "#fff", 0, 0, 1080, 0);
    expect(100).toBeGreaterThan(PIP_CAP);
    expect(many.drawn.filter((d) => d.name === "fillRect" || d.name === "strokeRect").length).toBe(0);
    expect(texts(many.drawn)).toEqual(["97"]);
    expect(ringPipLayout(0, 0, 1080, 7, 52).y).toBe(ringPipLayout(0, 0, 1080, 7, 0).y + 52);
  });

  it("shows in the clips that get Classic's end card: not in a loop clip, with a roster or with captions", () => {
    expect(canvasSource).toMatch(/if \(ringView && ringView\.rings > 1 && !replay\) \{/);
    expect(canvasSource).toMatch(/drawRingPips\(ctx, ringView\.rings, ringView\.escaped, /);
    const at = canvasSource.indexOf("drawRingPips(ctx, ringView.rings");
    const gate = canvasSource.lastIndexOf('engine.getCurrentModeName() === "classic" && !loopHudRef.current && !teamLayer.isActive() && !captionsRef.current', at);
    expect(gate).toBeGreaterThan(0);
    expect(at - gate).toBeLessThan(1200);
  });
});
