import { describe, expect, it } from "vitest";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { RunnerSettings } from "@/lib/physics/modes/runner";
import type { BeatGrid } from "@/lib/simulation/beatClock";
import { RUNNER_SECTION_BEATS, RUNNER_SECTION_HUES, runnerSectionHue } from "@/components/simulator/jdmRhythmRenderer";

/*
 * --- runner-drums --- (Lane E, E4) Beat Runner's drum kit on the course's own beat (lib/physics/modes/runner.ts): with no song's
 * beat to follow, a kick on every beat, a snare on 2 and 4 and a hat between, sounds of their own until the finish line, never
 * a ball's move; and --- runner-look --- the sky's colour section of a beat (components/simulator/jdmRhythmRenderer.ts).
 */

const config: PhysicsConfig = { width: 800, height: 450, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

function runnerEngine(runner: Partial<RunnerSettings>, seed = 5) {
  return createEngineForSettings(config, "runner", { ...modeSettings, runner }, seed);
}

function runToEnd(engine: ReturnType<typeof runnerEngine>): { atMs: number; event: SoundEvent }[] {
  const out: { atMs: number; event: SoundEvent }[] = [];
  for (let t = 0; t < 90_000 && !engine.isSimulationFinished(); t += 1000 / 60) {
    engine.update(1000 / 60, 0);
    for (const event of engine.consumeSoundEvents()) out.push({ atMs: engine.getElapsedMs(), event });
  }
  return out;
}

describe("runner drums", () => {
  it("plays a kick on every beat, a snare on 2 and 4 and a hat between, as sounds of their own, up to the finish line", () => {
    const engine = runnerEngine({ bpm: 120 });
    const log = runToEnd(engine);
    expect(engine.isSimulationFinished()).toBe(true);
    const view = engine.getRunnerView();
    const drums = log.filter((s) => s.event.bdDrum);
    expect(drums.every((s) => s.event.ringVoice === "extra" && s.event.melody === false)).toBe(true);
    const kicks = drums.filter((s) => s.event.bdDrum === "kick");
    const snares = drums.filter((s) => s.event.bdDrum === "snare");
    const hats = drums.filter((s) => s.event.bdDrum === "hat");
    // 120 BPM: a beat every 500 ms, each kick within a frame of its beat
    for (let i = 1; i < kicks.length; i++) expect(Math.abs(kicks[i].atMs - kicks[i - 1].atMs - 500)).toBeLessThanOrEqual(1000 / 60 + 1e-6);
    expect(kicks.filter((k) => k.event.accent).length).toBe(Math.ceil(kicks.length / 4));
    expect(snares.length).toBe(Math.floor((kicks.length + 2) / 4) + Math.floor(kicks.length / 4));
    expect(Math.abs(hats.length - kicks.length)).toBeLessThanOrEqual(1);
    for (const h of hats) expect(kicks.some((k) => Math.abs(h.atMs - k.atMs - 250) <= 1000 / 60 + 1e-6)).toBe(true);
    // the beat goes on to the finish line and stops there
    const crossMs = view.crossSec * 1000;
    expect(kicks[kicks.length - 1].atMs).toBeLessThanOrEqual(crossMs + 1000 / 60);
    expect(kicks[kicks.length - 1].atMs).toBeGreaterThan(crossMs - 600);
    // never more than half a beat without a sound
    const times = log.filter((s) => s.atMs <= crossMs).map((s) => s.atMs);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(260 + 1000 / 60);
  });

  it("stays silent while the course follows a song's own beat", () => {
    const beatTimes: number[] = [];
    for (let t = 0.4; t < 40; t += 60 / 128) beatTimes.push(t);
    const grid: BeatGrid = { bpm: 128, beatTimes, duration: 40 };
    const engine = runnerEngine({ beatSource: "song", grid, offset: 0, loop: true });
    const log = runToEnd(engine);
    expect(engine.getRunnerView().course.song).toBe(true);
    expect(log.filter((s) => s.event.bdDrum)).toEqual([]);
  });
});

describe("runner look", () => {
  it("changes the sky's colour every eight beats, round the palette", () => {
    expect(runnerSectionHue(-1)).toBe(RUNNER_SECTION_HUES[0]);
    for (let b = 0; b < RUNNER_SECTION_BEATS; b++) expect(runnerSectionHue(b)).toBe(RUNNER_SECTION_HUES[0]);
    expect(runnerSectionHue(RUNNER_SECTION_BEATS)).toBe(RUNNER_SECTION_HUES[1]);
    expect(runnerSectionHue(RUNNER_SECTION_BEATS * RUNNER_SECTION_HUES.length)).toBe(RUNNER_SECTION_HUES[0]);
    expect(new Set(RUNNER_SECTION_HUES).size).toBe(RUNNER_SECTION_HUES.length);
  });
});
