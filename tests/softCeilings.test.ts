import { describe, expect, it } from "vitest";
import { LIVE_RING_LIMIT, LIVE_SPIKE_LIMIT, LIVE_TARGET_LIMIT, softCeilingNotes, withLiveRingCount } from "@/lib/physics/softCeilings";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings, simulateSeed } from "@/lib/simulation/finder";
import { RANGES, defaultSettings, settingsFromSearchParams } from "@/lib/settings";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";

/*
 * --- review fix (security-robustness) --- A link's huge count keeps its value in the settings (extreme values are a feature)
 * but the engine builds at most LIVE_RING_LIMIT rings, LIVE_TARGET_LIMIT targets and LIVE_SPIKE_LIMIT spikes: `?wc=1000000` took 1.3 s to build and 220 ms a frame,
 * `?tc=1000000000` ran out of memory. The page says so under the canvas.
 */

const engineFor = (query: string) => {
  const s = settingsFromSearchParams(new URLSearchParams(query));
  const request = finderRequestOfSettings(s);
  return { s, request, engine: createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, 7) };
};

describe("soft memory-safe ceilings", () => {
  it("sit far above every slider", () => {
    expect(LIVE_RING_LIMIT).toBeGreaterThanOrEqual(50 * RANGES.wallCount.max);
    expect(LIVE_TARGET_LIMIT).toBeGreaterThanOrEqual(4 * RANGES.targetCount.max);
    expect(LIVE_SPIKE_LIMIT).toBeGreaterThanOrEqual(18 * RANGES.spikeCount.max);
  });

  it("a link's wc=1000000000 keeps its value but the engine builds LIVE_RING_LIMIT rings, quickly, and runs frames quickly", () => {
    for (const mode of ["classic", "shatter"]) {
      const t0 = performance.now();
      const { s, engine } = engineFor(`mode=${mode}&wc=1000000000`);
      expect(s.wallCount).toBe(1e9);
      expect(engine.getCircularWalls()).toHaveLength(LIVE_RING_LIMIT);
      expect(engine.config.wallCount).toBe(LIVE_RING_LIMIT);
      for (let i = 0; i < 10; i++) engine.update(1000 / 60, 0);
      expect(performance.now() - t0, `${mode}: build + 10 frames`).toBeLessThan(3000);
      // The page re-sends the setting: still the ceiling, no rebuild
      const walls = engine.getCircularWalls();
      engine.setConfig({ wallCount: 5e8 });
      expect(engine.getCircularWalls()).toBe(walls);
      expect(engine.config.wallCount).toBe(LIVE_RING_LIMIT);
    }
  });

  it("counts within the ceiling run exactly as set", () => {
    expect(engineFor("mode=classic&wc=300").engine.getCircularWalls()).toHaveLength(300);
    expect(engineFor("mode=classic").engine.getCircularWalls()).toHaveLength(defaultSettings("classic").wallCount);
    const cfg = { wallCount: 12, gapSize: 0.3 };
    expect(withLiveRingCount(cfg)).toBe(cfg);
    const noCount: { wallCount?: number; gapSize: number } = { gapSize: 0.3 };
    expect(withLiveRingCount(noCount)).toBe(noCount);
    expect(withLiveRingCount({ wallCount: 1e6 })).toEqual({ wallCount: LIVE_RING_LIMIT });
  });

  it("Target mode lays out at most LIVE_TARGET_LIMIT segments (tc=1000000000 ran out of memory)", () => {
    const { s, engine } = engineFor("mode=target&tc=1000000000");
    expect(s.targetCount).toBe(1e9);
    expect(engine.getCountdownTotal()).toBe(LIVE_TARGET_LIMIT);
    expect(engine.getCountdownSegmentMap()).toHaveLength(LIVE_TARGET_LIMIT);
    expect(engineFor("mode=target&tc=40").engine.getCountdownTotal()).toBe(40);
  });

  it("Accumulation puts at most LIVE_SPIKE_LIMIT spikes on its wall", () => {
    const { s, engine } = engineFor("mode=accumulation&spikes=1&sc=1000000000");
    expect(s.spikeCount).toBe(1e9);
    expect(engine.getSpikeAngles()).toHaveLength(LIVE_SPIKE_LIMIT);
    expect(engineFor("mode=accumulation&spikes=1&sc=30").engine.getSpikeAngles()).toHaveLength(30);
  });

  it("the finder replays the page's world: a seed lasts as long with wc=1e9 as with wc=LIVE_RING_LIMIT", () => {
    const big = engineFor("mode=classic&wc=1000000000&gap=1").request;
    const at = engineFor(`mode=classic&wc=${LIVE_RING_LIMIT}&gap=1`).request;
    expect(simulateSeed(11, big, 3000)).toBe(simulateSeed(11, at, 3000));
  });

  it("notes the counts that run below what the settings ask for, only in the modes that use them", () => {
    const base = { ...defaultSettings("classic"), spikesEnabled: false };
    expect(softCeilingNotes(base)).toEqual([]);
    expect(softCeilingNotes({ ...base, wallCount: 1e6 })).toEqual([{ setting: "wallCount", asked: 1e6, running: LIVE_RING_LIMIT }]);
    expect(softCeilingNotes({ ...base, mode: "shatter", wallCount: LIVE_RING_LIMIT })).toEqual([]);
    expect(softCeilingNotes({ ...base, mode: "drop", wallCount: 1e6 })).toEqual([]); // no rings there
    expect(softCeilingNotes({ ...base, mode: "target", targetCount: 5000 })).toEqual([{ setting: "targetCount", asked: 5000, running: LIVE_TARGET_LIMIT }]);
    expect(softCeilingNotes({ ...base, mode: "target", targetCount: LIVE_TARGET_LIMIT })).toEqual([]);
    expect(softCeilingNotes({ ...base, mode: "accumulation", spikeCount: 5000 })).toEqual([]); // spikes off
    expect(softCeilingNotes({ ...base, mode: "accumulation", spikeCount: 5000, spikesEnabled: true })).toEqual([{ setting: "spikeCount", asked: 5000, running: LIVE_SPIKE_LIMIT }]);
  });

  it("the notice and the recording error are translated in every language", () => {
    for (const messages of [en, pl, es]) {
      const sim = messages.Simulator as Record<string, string>;
      expect(sim.softCeiling).toMatch(/\{setting\}.*\{asked\}.*\{running\}/);
      expect(sim.recordingStartError.length).toBeGreaterThan(20);
      const controls = messages.Controls as Record<string, string>;
      for (const key of ["wallCount", "targetCount", "spikeCount"]) expect(controls[key], key).toBeTruthy();
    }
  });
});
