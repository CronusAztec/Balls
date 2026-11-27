import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { clipPacingDefaults } from "@/lib/clipPacing";
import {
  DANGER_SPAN,
  DEFAULT_MERGE_RING_SETTINGS,
  FINAL_BANNER_DELAY_MS,
  HEART_FAST_MS,
  HEART_FROM,
  HEART_HZ,
  HEART_SLOW_MS,
  OVERFLOW_MS,
  OVERFLOW_STING_HZ,
  heartbeatMs,
} from "@/lib/physics/modes/mergeRing";
import { FINAL_DIP_FACTOR, FINAL_DIP_MS, FINAL_FLASH_MS, GLOW_ALPHA_MAX, GLOW_ALPHA_MIN, MergeRingLayer, interiorGlowAlpha, warningLevel } from "@/components/simulator/mergeRingRenderer";
import { defaultSettings, settingsToSearchParams } from "@/lib/settings";
import { startSettings } from "@/lib/studioLooks"; // --- pace-as-look --- (the page's pace: what the page itself starts a mode in)
import { createEngineForSettings } from "@/lib/simulation/finder";
import { slowViewEligible } from "@/lib/simulation/camera";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- merge-ring-staged --- Merge Ring as a clip with a real question (lib/physics/modes/mergeRing.ts, mergeRingRenderer.ts):
 *  - the page's pace (7 tiers, a ball every 0.4 s, three spawn tiers, gravity 3): a verdict inside the clip on nearly every
 *    seed, the final form more often than the overflow but not always (it was the final form on every seed: no question);
 *  - a ball held up in the chute by the ball under it counts as resting, so a ring full to the chute always overflows (seed
 *    47 of the page's pace once jammed there for good);
 *  - the overflow is feared before it comes: the pile's danger and the overflow's clock in the view, a heartbeat that
 *    quickens with them (sound only), a red line across the opening that fills before the run ends (draw only);
 *  - the final form is staged: a slow-motion cue for the camera, a white flash, the banner a beat later.
 */

const WORLD = { width: 450, height: 450 };
const STEP = 1000 / 60;

function pageEngine(seed: number): PhysicsEngine {
  const request = finderRequestOfSettings(startSettings("mergeRing"), WORLD, 60);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

function runOf(engine: PhysicsEngine, maxSec = 60) {
  const events: { t: number; ev: SoundEvent }[] = [];
  for (let i = 1; i <= maxSec * 60 && !engine.isSimulationFinished(); i++) {
    engine.update(STEP, 0);
    for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs(), ev });
  }
  return { events, view: engine.getMergeRingView(), finished: engine.isSimulationFinished(), endMs: engine.getElapsedMs() };
}

describe("the page's pace", () => {
  it("is seven tiers, a ball every 0.4 s, three spawn tiers and gravity 3 – the mode's own defaults unchanged", () => {
    expect(clipPacingDefaults("mergeRing")).toEqual({ mrInterval: 0.4, mrSpawnTiers: 3, mrGravity: 3 });
    const d = defaultSettings("mergeRing");
    expect([d.mrTiers, d.mrInterval, d.mrSpawnTiers, d.mrGravity]).toEqual([7, 0.4, 3, 3]);
    expect(settingsToSearchParams(d).toString()).toBe("mode=mergeRing");
    expect(DEFAULT_MERGE_RING_SETTINGS).toMatchObject({ tiers: 7, interval: 0.9, spawnTiers: 2, gravity: 1 });
  });

  it("reaches a verdict inside the clip on nearly every seed, the final form more often than the overflow, and both happen", { timeout: 120_000 }, () => {
    let finals = 0;
    let overflows = 0;
    let inside = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const { view, finished } = runOf(pageEngine(seed), 45);
      expect(finished, `seed ${seed}`).toBe(true);
      const verdict = view.finalMs >= 0 ? view.finalMs : view.overflowMs;
      if (view.finalMs >= 0) finals++;
      else overflows++;
      if (verdict <= 27_000) inside++;
    }
    // measured when this was written (seeds 1–24, the phone world; the laptop's is the same square): 16 final forms, 8 overflows
    expect([finals, overflows]).toEqual([16, 8]);
    expect(inside).toBeGreaterThanOrEqual(22);
  });
});

describe("a ring full to the chute", () => {
  it("overflows even while the ball in the chute jiggles on the one under it: seed 47 ends, with an OVERFLOW", () => {
    const { view, finished, endMs } = runOf(pageEngine(47), 60);
    expect(finished).toBe(true);
    expect(view.overflowMs).toBeGreaterThan(0);
    expect(endMs).toBeLessThan(40_000);
  });
});

describe("the overflow is feared before it comes", () => {
  it("beats faster as the pressure rises, and not at all below HEART_FROM", () => {
    expect(heartbeatMs(0)).toBe(Infinity);
    expect(heartbeatMs(HEART_FROM - 0.01)).toBe(Infinity);
    expect(heartbeatMs(HEART_FROM)).toBeCloseTo(HEART_SLOW_MS, 6);
    expect(heartbeatMs(1)).toBeCloseTo(HEART_FAST_MS, 6);
    for (let p = HEART_FROM; p < 1; p += 0.05) expect(heartbeatMs(p + 0.05)).toBeLessThanOrEqual(heartbeatMs(p));
    expect(DANGER_SPAN).toBeGreaterThan(0);
  });

  it("an overflow run: the danger and the clock rise before the end, the heartbeat quickens, the line is full at the end", () => {
    let seed = 1;
    let picked: ReturnType<typeof runOf> | null = null;
    for (; seed <= 24 && !picked; seed++) {
      const engine = pageEngine(seed);
      const risks: number[] = [];
      const events: { t: number; ev: SoundEvent }[] = [];
      while (!engine.isSimulationFinished() && engine.getElapsedMs() < 45_000) {
        engine.update(STEP, 0);
        risks.push(engine.getMergeRingView().risk);
        for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs(), ev });
      }
      const view = engine.getMergeRingView();
      if (view.overflowMs < 0) continue;
      picked = { events, view, finished: true, endMs: engine.getElapsedMs() };
      // the clock filled over the overflow's last 1.5 s
      const last = risks.slice(-Math.round(OVERFLOW_MS / STEP) - 1);
      expect(last[last.length - 1]).toBe(1);
      expect(Math.max(...risks.slice(0, -Math.round(OVERFLOW_MS / STEP) - 10))).toBeLessThan(1);
    }
    expect(picked).not.toBeNull();
    const { events, view } = picked!;
    const beats = events.filter(({ ev }) => ev.thud && ev.frequency === HEART_HZ);
    expect(beats.length).toBeGreaterThan(2);
    expect(view.beats).toBe(beats.length);
    // quicker at the end than at the start of the scare
    const gaps = beats.slice(1).map((b, i) => b.t - beats[i].t);
    expect(Math.min(...gaps.slice(-2))).toBeLessThanOrEqual(Math.max(...gaps.slice(0, 2)));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(HEART_FAST_MS - STEP);
    expect(warningLevel(view)).toBe(1);
  });

  it("is silent in a calm ring: no heartbeat while the pile is low, and few in a run that reaches its final form", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const engine = pageEngine(seed);
      for (let i = 0; i < 3 * 60; i++) engine.update(STEP, 0);
      const v = engine.getMergeRingView();
      expect(v.danger, `seed ${seed}`).toBeLessThan(HEART_FROM);
      expect(v.beats, `seed ${seed}`).toBe(0);
      expect(warningLevel(v), `seed ${seed}`).toBeLessThan(HEART_FROM);
      const { view, endMs } = runOf(engine, 45);
      if (view.finalMs >= 0) expect(view.beats / (endMs / 1000), `seed ${seed}`).toBeLessThan(1);
    }
  });

  it("plays no more sounds a second than a calm clip should, and never goes quiet for long", () => {
    for (const seed of [2, 7]) {
      const { events, endMs } = runOf(pageEngine(seed), 45);
      const notes = events.filter(({ ev }) => ev.type !== "merge");
      expect(notes.length / (endMs / 1000), `seed ${seed}`).toBeLessThan(12);
      let last = 0;
      let quiet = 0;
      for (const { t } of notes) {
        quiet = Math.max(quiet, t - last);
        last = t;
      }
      expect(quiet, `seed ${seed}`).toBeLessThan(2000);
    }
  });
});

describe("the staged ending", () => {
  it("cues the camera's slow motion once per final form, never for an overflow", () => {
    const layer = new MergeRingLayer(() => null);
    const view = pageEngine(1).getMergeRingView();
    expect(layer.cameraCue({ ...view, finalMs: -1 })).toBeNull();
    const at = { ...view, finalMs: 12_000, timeMs: 12_000 };
    expect(layer.cameraCue(at)).toEqual({ dipMs: FINAL_DIP_MS, factor: FINAL_DIP_FACTOR });
    expect(layer.cameraCue({ ...at, timeMs: 12_100 })).toBeNull();
    expect(layer.cameraCue({ ...view, finalMs: -1, overflowMs: 9000 })).toBeNull();
    expect(FINAL_DIP_FACTOR).toBeLessThan(0.5);
    expect(FINAL_FLASH_MS).toBeLessThan(FINAL_BANNER_DELAY_MS + 1);
  });

  it("fills the ring with the top tier's colour, a little more with every tier", () => {
    expect(interiorGlowAlpha(0, 7)).toBe(0);
    expect(interiorGlowAlpha(1, 7)).toBeCloseTo(GLOW_ALPHA_MIN, 9);
    expect(interiorGlowAlpha(7, 7)).toBeCloseTo(GLOW_ALPHA_MAX, 9);
    for (let t = 1; t < 7; t++) expect(interiorGlowAlpha(t + 1, 7)).toBeGreaterThan(interiorGlowAlpha(t, 7));
  });

  it("draws the warning line, the glow and the flash from the view alone: the same frame for the same moment", () => {
    const engine = pageEngine(5);
    for (let i = 0; i < 6 * 60; i++) engine.update(STEP, 0);
    const view = { ...engine.getMergeRingView(), danger: 0.8, risk: 0.5, beatMs: engine.getElapsedMs() - 50 };
    const opts = { wallAlpha: () => "#fff", wallThickness: 2, showWallGlow: false, darkBodies: true };
    const draw = () => {
      const canvas = fakeCanvas(450, 450);
      const layer = new MergeRingLayer(() => null);
      layer.drawWorld(canvas.ctx as unknown as CanvasRenderingContext2D, view, opts);
      layer.drawEffects(canvas.ctx as unknown as CanvasRenderingContext2D, view);
      return JSON.stringify(canvas.ctx.calls);
    };
    const a = draw();
    expect(a).toBe(draw());
    // the line across the opening was drawn (a stroke from one chute wall to the other)
    const L = view.layout!;
    expect(a).toContain(`[${L.cx - L.chuteHalf},${L.openY}]`);
  });
});

// --- merge-ring-staged --- (review fix B4)
describe("the ending's picture and sound (review fix B4)", () => {
  it("draws the final merge's balls between steps: Merge Ring is a slow-view mode, and the flash follows the drawn time", () => {
    expect(slowViewEligible("mergeRing")).toBe(true);
    const layer = new MergeRingLayer(() => null);
    expect(layer.timeOffsetMs).toBe(0);
    const engine = pageEngine(5);
    for (let i = 0; i < 6 * 60; i++) engine.update(STEP, 0);
    const base = engine.getMergeRingView();
    const view = { ...base, finalMs: base.timeMs - 100 };
    const opts = { wallAlpha: () => "#fff", wallThickness: 2, showWallGlow: false, darkBodies: true };
    const flashAt = (offset: number) => {
      const canvas = fakeCanvas(450, 450);
      layer.timeOffsetMs = offset;
      layer.drawWorld(canvas.ctx as unknown as CanvasRenderingContext2D, view, opts);
      return JSON.stringify(canvas.ctx.calls);
    };
    // 10 ms earlier in the flash: a brighter white than at the engine's own time
    expect(flashAt(-10)).not.toBe(flashAt(0));
    expect(flashAt(-10)).toBe(flashAt(-10));
  });

  it("ends an overflow on a sting under its banner: the crash and the chord's minor ending, held, at the overflow's step", () => {
    let found = false;
    for (let seed = 1; seed <= 24 && !found; seed++) {
      const { events, view, endMs } = runOf(pageEngine(seed), 45);
      if (view.overflowMs < 0) {
        expect(events.some(({ ev }) => ev.loop === "chord" && ev.loopMinor), `seed ${seed}`).toBe(false);
        continue;
      }
      found = true;
      const last = events.filter(({ t }) => t === endMs).map(({ ev }) => ev);
      expect(last.some((ev) => ev.type === "gap")).toBe(true);
      const chord = last.find((ev) => ev.loop === "chord");
      expect(chord).toMatchObject({ frequency: OVERFLOW_STING_HZ, loopMinor: true, loopTremolo: true, melody: false });
    }
    expect(found).toBe(true);
  });
});
