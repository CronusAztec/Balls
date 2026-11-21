import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { clipPacingDefaults, clipStartSettings } from "@/lib/clipPacing";
import { GALLERY } from "@/content/gallery";
import { GROW_BURST_MS, GrowLayer, growBurstAt, growCoverage } from "@/components/simulator/growRenderer";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { Ball, SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- grow-fill-clip --- Fill and Grow as a clip: the fill-and-finish Grow that was built and switched off is the studio's start
 * look and the Fill the Ring card (the link base stays: the bot's fill-grow plans and the crew's corpus run it). The start look
 * fills inside a clip on every seed with a pluck a bounce, never buzzing; every Grow run shows how full the ring is and lands
 * its fill with a flash and a shockwave (draw only).
 */

const STEP = 1000 / 60;
const START = clipStartSettings("grow");

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}, world = { width: 450, height: 450 }): PhysicsEngine {
  const s = { ...defaultSettings("grow"), ...patch } as SimulatorSettings;
  const request = finderRequestOfSettings(s, world, 60);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

describe("the start look", () => {
  it("is the multiply law at 8 %, the run ending at the fill, colour, markers and pitch by size – the link base untouched", () => {
    expect(START).toEqual({ growLaw: "multiply", growStep: 8, growOnFill: "finish", growHue: true, growMarkers: true, growPitch: true });
    const d = defaultSettings("grow");
    expect([d.growLaw, d.growOnFill, d.growHue, d.growMarkers, d.growPitch]).toEqual(["approach", "stay", false, false, false]);
    expect(settingsToSearchParams(d).toString()).toBe("mode=grow");
    expect(clipPacingDefaults("grow")).toEqual({});
    const card = GALLERY.find((p) => p.id === "fill-the-ring")!;
    expect(settingsFromSearchParams(new URLSearchParams(card.query))).toMatchObject({ mode: "grow", ...START });
    // the gallery's Matrix Growth card still plays the classic Grow
    const matrix = settingsFromSearchParams(new URLSearchParams(GALLERY.find((p) => p.id === "matrix-grow")!.query));
    expect([matrix.growLaw, matrix.growOnFill]).toEqual(["approach", "stay"]);
  });

  it("fills the ring inside the clip on every seed, in both worlds, with a pluck a bounce and no buzz", () => {
    for (const world of [{ width: 450, height: 450 }, { width: 800, height: 450 }]) {
      for (let seed = 1; seed <= 8; seed++) {
        const engine = engineOf(seed, START, world);
        const events: { t: number; ev: SoundEvent }[] = [];
        while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) {
          engine.update(STEP, 0);
          for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs(), ev });
        }
        const v = engine.getGrowView();
        // measured when this was written (seeds 1–20, both worlds): full at 16.2–19.5 s
        expect(v.firstFillMs, `seed ${seed}`).toBeGreaterThan(15_000);
        expect(v.firstFillMs, `seed ${seed}`).toBeLessThan(25_000);
        expect(v.phase).toBe("done");
        expect(engine.isSimulationFinished()).toBe(true);
        const perSec = new Map<number, number>();
        let last = 0;
        let quiet = 0;
        for (const { t } of events) {
          perSec.set(Math.floor(t / 1000), (perSec.get(Math.floor(t / 1000)) ?? 0) + 1);
          quiet = Math.max(quiet, t - last);
          last = t;
        }
        expect(Math.max(...perSec.values()), `seed ${seed}`).toBeLessThanOrEqual(10);
        expect(quiet, `seed ${seed}`).toBeLessThan(1500);
        expect(events.filter(({ ev }) => ev.loop === "chord")).toHaveLength(1);
      }
    }
  });
});

describe("how full the ring is, on screen (every Grow run)", () => {
  const ball = (radius: number): Ball => ({ id: 1, radius }) as unknown as Ball;

  it("reads how full the ring is (the ball's width against the most it can grow to) and times the burst on the simulation clock", () => {
    expect(growCoverage([ball(50)], 100)).toBeCloseTo(0.5, 9);
    expect(growCoverage([ball(100)], 100)).toBe(1);
    expect(growCoverage([ball(100), ball(50)], 100)).toBeCloseTo(0.5, 9);
    expect(growCoverage([], 100)).toBe(0);
    expect(growBurstAt(-1)).toBeNull();
    expect(growBurstAt(0)).toBe(0);
    expect(growBurstAt(GROW_BURST_MS)).toBeNull();
  });

  it("draws the wash, the meter with its number and the fill's burst from the view alone: the same frame for the same moment", () => {
    const engine = engineOf(7, START);
    while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) engine.update(STEP, 0);
    const v = engine.getGrowView();
    const layer = new GrowLayer();
    const draw = (now: number) => {
      const canvas = fakeCanvas(450, 450);
      const ctx = canvas.ctx as unknown as CanvasRenderingContext2D;
      layer.drawWorld(ctx, v, engine.getBalls(), now, "#4af0ff", 225, 225);
      layer.drawEffects(ctx, v, now, "#4af0ff", 225, 225);
      return canvas.ctx.calls;
    };
    const atFill = draw(v.lastFillMs + 100);
    expect(JSON.stringify(atFill)).toBe(JSON.stringify(draw(v.lastFillMs + 100)));
    expect(atFill.some((c) => c.name === "fillText" && c.args[0] === "100%")).toBe(true);
    // the burst is over GROW_BURST_MS after the fill: fewer strokes
    const later = draw(v.lastFillMs + GROW_BURST_MS + 50);
    expect(later.filter((c) => c.name === "stroke").length).toBeLessThan(atFill.filter((c) => c.name === "stroke").length);
  });
});
