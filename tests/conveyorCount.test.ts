import { describe, expect, it } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { conveyorEscapePitch, conveyorFinishChord } from "@/lib/physics/modes/conveyor";
import { CONVEYOR_COUNT_POP_MS, DEFAULT_CONVEYOR_LABELS, conveyorBannerAt, conveyorCount, conveyorCountPop, ConveyorLayer } from "@/components/simulator/conveyorRenderer";
import { clipStartSettings } from "@/lib/clipPacing";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import type { SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- conveyor-count --- --- conveyor-climb --- (Lane E, E6) The Conveyor Belt reads in a second and builds: a big "3 / 8" over OUT
 * at the top right of the field (components/simulator/conveyorRenderer.ts), the end banner above the arena, every escape a step
 * higher up the scale than the one before into ALL OUT!'s chord (lib/physics/modes/conveyor.ts), and a start look whose run ends
 * inside the 30 s clip (lib/clipPacing.ts).
 */

const WORLD = { width: 800, height: 450 };

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}): PhysicsEngine {
  const s = { ...defaultSettings("conveyor"), ...patch } as SimulatorSettings;
  const f = finderRequestOfSettings(s, WORLD, 60);
  return createEngineForSettings(f.physicsConfig, f.mode, f.modeSettings, seed) as PhysicsEngine;
}

function runAll(e: PhysicsEngine, maxSec = 60): { ms: number; ev: SoundEvent }[] {
  const out: { ms: number; ev: SoundEvent }[] = [];
  for (let frame = 0; frame < maxSec * 60 && !e.isSimulationFinished(); frame++) {
    e.update(1000 / 60, 0);
    for (const ev of e.consumeSoundEvents()) out.push({ ms: e.getElapsedMs(), ev });
  }
  return out;
}

describe("the Conveyor Belt's climb", () => {
  it("plays every escape a step higher than the one before, the last one accented, then ALL OUT!'s chord", () => {
    for (const seed of [1, 2]) {
      const e = engineOf(seed, clipStartSettings("conveyor"));
      const sounds = runAll(e);
      const v = e.getConveyorView();
      expect(v).toMatchObject({ escaped: 8, allDone: true, finished: true, timedOut: false });
      const climb = sounds.filter((x) => x.ev.ringVoice === "extra" && x.ev.loop !== "chord");
      expect(climb).toHaveLength(8);
      climb.forEach((x, k) => {
        expect(x.ev.frequency).toBeCloseTo(conveyorEscapePitch(k, v.settings.scale, v.settings.rootNote), 9);
        expect(x.ev.melody).toBe(false);
        expect(!!x.ev.accent).toBe(k === 7);
        if (k > 0) expect(x.ev.frequency!).toBeGreaterThan(climb[k - 1].ev.frequency!);
      });
      // each with its escape's wall-break sound, in the same step
      const breaks = sounds.filter((x) => x.ev.type === "gap");
      expect(breaks.map((x) => x.ms)).toEqual(climb.map((x) => x.ms));
      // the octave climbed lands on the chord's root
      const chord = sounds.find((x) => x.ev.chord && x.ev.accent)!;
      expect(chord.ms).toBeGreaterThan(climb[7].ms);
      expect(conveyorEscapePitch(7, v.settings.scale, v.settings.rootNote)).toBeCloseTo(conveyorFinishChord(v.settings.scale, v.settings.rootNote)[0], 6);
      // and the completion chord rings through the banner's hold, in the same step, two octaves under it
      const ring = sounds.filter((x) => x.ev.loop === "chord");
      expect(ring.map((x) => [x.ms, x.ev.ringVoice, x.ev.frequency])).toEqual([[chord.ms, "extra", chord.ev.chord![0] / 4]]);
    }
  }, 60_000);

  it("starts a bare visit at a ball every 2 s, so ALL OUT! lands inside the 30 s clip (the link base keeps 3 s)", () => {
    expect(clipStartSettings("conveyor")).toEqual({ cvInterval: 2 });
    expect(defaultSettings("conveyor").cvInterval).toBe(3);
    for (const seed of [1, 2, 3, 4]) {
      const e = engineOf(seed, clipStartSettings("conveyor"));
      runAll(e, 40);
      const v = e.getConveyorView();
      // the banner with its 2 s (the run's own 1.5 s hold and the recorder's stop) inside 30 s
      expect([seed, v.finished, v.doneAtMs / 1000 + 2 <= 30]).toEqual([seed, true, true]);
    }
  }, 60_000);
});

describe("the Conveyor Belt's counter and banner", () => {
  it("counts the balls out (rings), loaded (the bowl) or landed (pegs) of all, popping as the count goes up", () => {
    const rings = engineOf(1).getConveyorView();
    expect(conveyorCount(rings, DEFAULT_CONVEYOR_LABELS)).toMatchObject({ n: 0, of: 8, word: "OUT" });
    const bowl = engineOf(1, { cvArena: "bowl" }).getConveyorView();
    expect(conveyorCount(bowl, DEFAULT_CONVEYOR_LABELS)).toMatchObject({ word: "LOADED", of: 8 });
    const pegs = engineOf(1, { cvArena: "pegs" }).getConveyorView();
    expect(conveyorCount(pegs, DEFAULT_CONVEYOR_LABELS)).toMatchObject({ word: "LANDED", of: 8 });
    expect(conveyorCountPop(0)).toBeCloseTo(1.35, 9);
    expect(conveyorCountPop(CONVEYOR_COUNT_POP_MS)).toBe(1);
    expect(conveyorCountPop(Infinity)).toBe(1);
    expect(conveyorCountPop(-1)).toBe(1);
    expect(DEFAULT_CONVEYOR_LABELS.spilled(3)).toBe("3 spilled");
  });

  it("draws the count big at the top right of the field while the run goes, and steps aside for the end banner", () => {
    const e = engineOf(1, clipStartSettings("conveyor"));
    for (let i = 0; i < 60 * 8; i++) e.update(1000 / 60, 0);
    const v = e.getConveyorView();
    const canvas = fakeCanvas(WORLD.width, WORLD.height);
    const layer = new ConveyorLayer();
    layer.drawOverlay(canvas.ctx as unknown as CanvasRenderingContext2D, v, DEFAULT_CONVEYOR_LABELS, WORLD.width, WORLD.height);
    const texts = canvas.ctx.calls.filter((c) => c.name === "fillText");
    expect(texts.map((c) => c.args[0])).toEqual([" / 8", String(v.escaped), "OUT"]);
    // inside the field, at its top right, clear of the belt and the rings
    const side = Math.min(WORLD.width, WORLD.height);
    const L = v.layout!;
    // (the count is drawn at the origin of its own translate: the pop scales it about its right end)
    const at = (c: { name: string; args: unknown[] }, i: number) => (c.args[1] === 0 && c.args[2] === 0 ? (canvas.ctx.calls.filter((x) => x.name === "translate").at(-1)!.args[i - 1] as number) : (c.args[i] as number));
    for (const c of texts) {
      expect(at(c, 1)).toBeLessThanOrEqual(L.right);
      expect(at(c, 1)).toBeGreaterThan(L.cx);
      expect(at(c, 2)).toBeLessThan(L.cy - L.ringRadii[L.ringRadii.length - 1]);
    }
    expect(side).toBe(450);
    runAll(e, 40);
    const done = fakeCanvas(WORLD.width, WORLD.height);
    layer.drawOverlay(done.ctx as unknown as CanvasRenderingContext2D, e.getConveyorView(), DEFAULT_CONVEYOR_LABELS, WORLD.width, WORLD.height);
    expect(done.ctx.calls.filter((c) => c.name === "fillText")).toEqual([]);
  }, 60_000);

  it("puts the end banner above the rings and the pegs, and under the bowl", () => {
    const side = Math.min(WORLD.width, WORLD.height);
    const rings = engineOf(1).getConveyorView();
    const L = rings.layout!;
    const ringTop = (L.cy - L.ringRadii[L.ringRadii.length - 1] - (WORLD.height - side) / 2) / side;
    const at = conveyorBannerAt(rings, WORLD.width, WORLD.height)!;
    expect(at).toBeCloseTo((0.02 + ringTop) / 2, 9);
    expect(at).toBeLessThan(ringTop);
    expect(conveyorBannerAt(engineOf(1, { cvArena: "bowl" }).getConveyorView(), WORLD.width, WORLD.height)).toBe(0.78);
    const pegs = engineOf(1, { cvArena: "pegs" }).getConveyorView();
    expect(conveyorBannerAt(pegs, WORLD.width, WORLD.height)!).toBeLessThan(0.25);
  });
});
