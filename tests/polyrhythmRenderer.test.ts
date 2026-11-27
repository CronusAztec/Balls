import fs from "fs";
import path from "path";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import {
  ALIGN_FLASH_MS,
  PolyrhythmHoldClock,
  TICK_FLASH_MS,
  drawPolyrhythmAlignFlash,
  drawPolyrhythmVoices,
  polyrhythmBannerAt,
  polyrhythmBannerWidth,
  stepsAgoMs,
  tickFlash,
} from "@/components/simulator/polyrhythmRenderer";
import { endBannerPlateHeight, layoutEndBanner, placeEndBanner } from "@/components/simulator/endBanner";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PolyrhythmView } from "@/lib/physics/modes/polyrhythm";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { fakeCanvas, type FakeCall } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- poly-hold --- --- poly-banner --- (round two, B1) Metronomes & Polyrhythms' ending, drawn:
 *  - the steps stop at the finish, so an age counted in steps stands still there: the last alignment's flash kept the frame
 *    38 % white and its ticks kept every dot lit through the end hold and every later redraw (the first visit's clip: the
 *    square's luma 10.6 until 24.0 s, 65.2 on every frame from 24.1 to 26.0 s). The hold clock ages them on the frames' time;
 *  - IN PHASE! on the arcs keeps clear of the voices it is about: under the semicircles' baseline, or inside the chords'
 *    circle, narrowed to the room between the dots on its rim (the card's plate hid the middle voices on both sides).
 */

const STEP = 1000 / 60;
const canvasSource = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Canvas.tsx"), "utf8");

/** A Polyrhythm run of `patch` in a `width` × `height` world, stepped at 60 Hz until it finishes. */
function finishedRun(patch: Partial<SimulatorSettings>, width = 1080, height = 1920, seed = 7): PhysicsEngine {
  const settings = { ...defaultSettings("polyrhythm"), prCycleSeconds: 4, ...patch } as SimulatorSettings;
  const request = finderRequestOfSettings(settings, { width, height }, 60);
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  for (let frame = 0; frame < 60 * 60 && !engine.getPolyrhythmView().finished; frame++) engine.update(STEP, 0);
  expect(engine.getPolyrhythmView().finished).toBe(true);
  return engine;
}

/** The alpha of the frame's white flash (0: none drawn). */
function flashAlpha(view: PolyrhythmView, heldMs: number): number {
  const canvas = fakeCanvas(1080, 1920);
  const ctx = canvas.ctx as unknown as CanvasRenderingContext2D;
  drawPolyrhythmAlignFlash(ctx, 1080, 1920, view, heldMs);
  if (!canvas.ctx.calls.some((c) => c.name === "fillRect")) return 0;
  return Number(/rgba\(255, 255, 255, ([\d.]+)\)/.exec(String(canvas.ctx.fillStyle))?.[1] ?? NaN);
}

const fills = (calls: FakeCall[]) => calls.filter((c) => c.name === "fill").length;

describe("Polyrhythm: a finished run's flashes fade on the frames' own time", () => {
  it("washes the frame on the finishing step, then fades it out within ALIGN_FLASH_MS of held frames, for good", () => {
    const engine = finishedRun({});
    const view = engine.getPolyrhythmView();
    // the run ends on an alignment, and its steps stop there: by steps alone the flash never ages
    expect(view.lastAlignStep).toBe(view.step);
    const step = view.step;
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    expect(view.step).toBe(step);
    expect(stepsAgoMs(view, view.lastAlignStep)).toBe(0);
    // the hold clock: nothing held on the frame of the finishing step, then the frames' own time
    const clock = new PolyrhythmHoldClock();
    expect(clock.frame(view, STEP)).toBe(0);
    expect(flashAlpha(view, 0)).toBeCloseTo(0.38, 3);
    const alphas: number[] = [];
    for (let frame = 1; frame <= 120; frame++) alphas.push(flashAlpha(view, clock.frame(view, STEP)));
    expect(clock.ms).toBeCloseTo(120 * STEP, 6);
    const lastLit = Math.ceil(ALIGN_FLASH_MS / STEP) - 1;
    for (let k = 1; k < lastLit; k++) expect(alphas[k]).toBeLessThan(alphas[k - 1]);
    // gone by 0.48 s of held frames, and still gone 2 s past the finish (the still camera's frames past the end)
    for (let k = lastLit; k < alphas.length; k++) expect(alphas[k]).toBe(0);
  });

  it("lets every dot's tick flash go out too: the hold draws the dots in their own colours, as a run whose steps went on", () => {
    const engine = finishedRun({ prLayout: "arcs" });
    const view = engine.getPolyrhythmView();
    // every voice ticked on the last step: lit by steps alone, for ever
    for (let i = 0; i < view.count; i++) expect(tickFlash(view, i)).toBe(1);
    for (let i = 0; i < view.count; i++) expect(tickFlash(view, i, TICK_FLASH_MS)).toBe(0);
    const draw = (heldMs: number) => {
      const canvas = fakeCanvas(1080, 1920);
      drawPolyrhythmVoices(canvas.ctx as unknown as CanvasRenderingContext2D, view, { wallColor: () => "#ffffff", wallThickness: 2, showGlow: false, heldMs });
      return fills(canvas.ctx.calls);
    };
    // lit: a glow, a body and a white core per dot; held past the tick flash: the bodies alone
    expect(draw(0)).toBe(3 * view.dotCount);
    expect(draw(TICK_FLASH_MS)).toBe(view.dotCount);
  });

  it("holds still while paused, starts over for a new run and reads 0 while a run plays", () => {
    const engine = finishedRun({});
    const view = engine.getPolyrhythmView();
    const clock = new PolyrhythmHoldClock();
    clock.frame(view, STEP);
    clock.frame(view, STEP);
    expect(clock.frame(view, 0)).toBeCloseTo(STEP, 9); // paused: the frames' time stands
    expect(clock.frame(view, STEP)).toBeCloseTo(2 * STEP, 9);
    // a new run: nothing held while it plays, whatever the frames take
    engine.initPolyrhythm();
    expect(view.finished).toBe(false);
    for (let frame = 0; frame < 90; frame++) {
      engine.update(STEP, 0);
      if (!view.finished) expect(clock.frame(view, STEP)).toBe(0);
    }
  });

  it("is wired into the canvas: one clock, the frames' own time, the flash and every draw of the voices", () => {
    expect(canvasSource).toMatch(/const polyHold = new PolyrhythmHoldClock\(\)/);
    expect(canvasSource).toMatch(/polyRender\.heldMs = polyHold\.frame\(engine\.getPolyrhythmView\(\), !p\.isPaused && p\.isStarted \? frameMs : 0\)/);
    expect(canvasSource).toMatch(/drawPolyrhythmAlignFlash\(ctx, size\.width, size\.height, engine\.getPolyrhythmView\(\), polyRender\.heldMs\)/);
  });
});

/* ------------------------------------------------------------------ IN PHASE! on the arcs */

const CATALOGS: Record<string, Record<string, Record<string, unknown>>> = { en, pl, es } as never;

function words(locale: string, count: number) {
  const sim = CATALOGS[locale].Simulator;
  return { title: String(sim.canvasPolyrhythmDone), sub: String(new IntlMessageFormat(String(sim.canvasPolyrhythmAligned), locale).format({ count, cycles: 1 })) };
}

/** A measurer `em` wide a character per px of font size: 0.4 keeps every line whole at 84 %, 0.62 splits them. */
function measurer(em: number) {
  const ctx = { font: "10px sans-serif" } as { font: string; measureText: (t: string) => { width: number } };
  ctx.measureText = (t: string) => ({ width: em * t.length * Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10) });
  return ctx as unknown as CanvasRenderingContext2D;
}

/** The plate the canvas draws for the finished `view` in a `width` × `height` canvas (Canvas.tsx's bigBanner and its anchored place). */
function plateOf(view: PolyrhythmView, width: number, height: number, text: { title: string; sub: string }, em: number, place = true) {
  const side = Math.min(width, height);
  const lay = layoutEndBanner(measurer(em), { ...text, color: "#a3e635", maxWidth: place ? polyrhythmBannerWidth(view, side) : undefined }, side);
  const cx = width / 2;
  const cy = height / 2;
  const squareTop = cy - side / 2;
  const at = place ? polyrhythmBannerAt(view, side, lay.height) : undefined;
  const top = at === undefined ? cy - lay.height / 2 : placeEndBanner(squareTop + at * side - lay.height / 2, lay.height, squareTop + 0.02 * side, squareTop + 0.98 * side, cy - lay.height / 2);
  return { x: cx - lay.width / 2, y: top, w: lay.width, h: lay.height, lines: lay.subLines.length };
}

type Plate = { x: number; y: number; w: number; h: number };

/** Whether the plate meets a disc of radius `r` around (x, y). */
function meets(plate: Plate, x: number, y: number, r: number): boolean {
  const nx = Math.max(plate.x, Math.min(plate.x + plate.w, x));
  const ny = Math.max(plate.y, Math.min(plate.y + plate.h, y));
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
}

/** The dots the plate covers: their bodies, or with `glow` their glow too (1.7 r + 2 around the centre, drawPolyrhythmVoices()). */
function covered(view: PolyrhythmView, plate: Plate, glow = false): number {
  const r = view.geometry!.dotRadius;
  let n = 0;
  for (let d = 0; d < view.dotCount; d++) if (meets(plate, view.dotX[d], view.dotY[d], glow ? 1.7 * r + 2 : r)) n++;
  return n;
}

const WORLDS: [number, number][] = [
  [1080, 1920], // the 9:16 export
  [1080, 1080],
  [800, 450], // a laptop's stage
  [390, 640], // a phone's
];

describe("Polyrhythm: IN PHASE! on the arcs keeps clear of the voices", () => {
  it("narrows the chords' plate to the room inside the dots on the rim, in every language, world, voice count and ball size", () => {
    let narrowed = 0;
    for (const [width, height] of WORLDS) {
      for (const [count, ball] of [
        [16, 8],
        [4, 8],
        [40, 8],
        [16, 16],
      ]) {
        const view = finishedRun({ prLayout: "arcs", prCount: count, ballRadius: ball } as Partial<SimulatorSettings>, width, height).getPolyrhythmView();
        expect(view.geometry!.arcStyle).toBe("chords");
        const side = Math.min(width, height);
        const maxWidth = polyrhythmBannerWidth(view, side)!;
        expect(maxWidth, `${width}x${height} ${count} voices`).toBeGreaterThan(0);
        expect(polyrhythmBannerAt(view, side, 200)).toBeCloseTo(0.5, 9); // the circle's centre
        for (const locale of ["en", "pl", "es"]) {
          for (const em of [0.4, 0.5, 0.62]) {
            const plate = plateOf(view, width, height, words(locale, count), em);
            expect(plate.w).toBeLessThanOrEqual(maxWidth + 1e-6);
            expect(plate.h).toBeLessThanOrEqual(endBannerPlateHeight(side, 2) + 1e-6);
            // not a dot's body, nor its glow, under the plate
            expect(covered(view, plate, true), `${locale} ${width}x${height} ${count} voices ball ${ball} em ${em}`).toBe(0);
            if (plate.lines === 2 && plateOf(view, width, height, words(locale, count), em, false).lines === 1) narrowed++;
          }
        }
      }
    }
    // the narrowing is what clears them: the line under the title went to two lines for it
    expect(narrowed).toBeGreaterThan(0);
  });

  it("would hide the middle voices on both sides at the full width in the middle (the card's ending before)", () => {
    const view = finishedRun({ prLayout: "arcs", prCycleSeconds: 24, showGlow: true }, 1080, 1920, 1).getPolyrhythmView(); // (the card's run: its 24 s cycle, seed 1)
    // (0.43 em: about as wide as the page's sans-serif set the line in the card's picture, sheets/polyrhythm-card.png)
    const before = plateOf(view, 1080, 1920, words("en", 16), 0.43, false);
    expect(before.lines).toBe(1);
    expect(covered(view, before)).toBeGreaterThanOrEqual(4);
    // on both sides of the circle
    let left = 0;
    let right = 0;
    for (let d = 0; d < view.dotCount; d++) {
      if (!meets(before, view.dotX[d], view.dotY[d], view.geometry!.dotRadius)) continue;
      if (view.dotX[d] < 540) left++;
      else right++;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(covered(view, plateOf(view, 1080, 1920, words("en", 16), 0.43), true)).toBe(0);
  });

  it("puts the semicircles' plate under the baseline the dots end on, or over the arcs when there is no room below", () => {
    let under = 0;
    let over = 0;
    for (const [width, height] of WORLDS) {
      for (const [count, ball] of [
        [16, 8],
        [3, 24],
      ]) {
        const view = finishedRun({ prLayout: "arcs", prArcStyle: "semicircles", prCount: count, ballRadius: ball } as Partial<SimulatorSettings>, width, height).getPolyrhythmView();
        const g = view.geometry!;
        expect(polyrhythmBannerWidth(view, Math.min(width, height))).toBeUndefined();
        for (const locale of ["en", "pl", "es"]) {
          for (const em of [0.4, 0.62]) {
            const plate = plateOf(view, width, height, words(locale, count), em);
            expect(covered(view, plate, true), `${locale} ${width}x${height} ${count} voices ball ${ball} em ${em}`).toBe(0);
            if (plate.y > g.baselineY) under++;
            else {
              expect(plate.y + plate.h).toBeLessThan(g.baselineY - g.dotRadius);
              over++;
            }
          }
        }
      }
    }
    expect(under).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(0);
  });

  it("leaves the rings, the metronomes and the spiral where they were (the rings' lower half, the middle)", () => {
    for (const layout of ["rings", "metronomes", "spiral"] as const) {
      const view = finishedRun({ prLayout: layout }).getPolyrhythmView();
      expect(polyrhythmBannerAt(view, 1080, 200)).toBeUndefined();
      expect(polyrhythmBannerWidth(view, 1080)).toBeUndefined();
    }
    // the canvas: the arcs' own place, else the rings' lower half, else the middle; the chords' width
    expect(canvasSource).toMatch(/const arcsAt = pv\.settings\.layout === "arcs" \? \(height: number\) => polyrhythmBannerAt\(pv, minDim, height\) : undefined;/);
    expect(canvasSource).toMatch(/bigBanner\(L\.polyrhythmDone, L\.polyrhythmAligned\(prog\.count, prog\.total\), "#a3e635", arcsAt \?\? \(pv\.settings\.layout === "rings" \? 0\.73 : undefined\), polyrhythmBannerWidth\(pv, minDim\)\)/);
    expect(canvasSource).toMatch(/blocks\.push\(\{ height: lay\.height, at: typeof at === "function" \? at\(lay\.height\) : at,/);
  });
});
