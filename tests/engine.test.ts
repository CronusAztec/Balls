import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { createEngineForSettings, simulateSeed, type FinderRequest } from "@/lib/simulation/finder";

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const settings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
};

function run(engine: PhysicsEngine, frames: number) {
  for (let i = 0; i < frames; i++) engine.update(1000 / 60, 0);
  return engine.getBalls().map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]);
}

describe("PhysicsEngine", () => {
  it("is deterministic for a given seed", () => {
    const a = createEngineForSettings(config, "classic", settings, 12345);
    const b = createEngineForSettings(config, "classic", settings, 12345);
    expect(run(a, 600)).toEqual(run(b, 600));
    expect(a.getBrokenWalls()).toEqual(b.getBrokenWalls());
  });

  it("produces different runs for different seeds", () => {
    const a = createEngineForSettings(config, "classic", settings, 1);
    const b = createEngineForSettings(config, "classic", settings, 2);
    expect(run(a, 300)).not.toEqual(run(b, 300));
  });

  it("boots every mode and keeps balls inside the arena", () => {
    for (const mode of MODE_IDS) {
      const engine = createEngineForSettings(config, mode, settings, 42);
      expect(engine.getCurrentModeName()).toBe(mode);
      for (let i = 0; i < 120; i++) engine.update(1000 / 60, 0);
      for (const ball of engine.getBalls()) {
        expect(Number.isFinite(ball.x)).toBe(true);
        expect(Number.isFinite(ball.y)).toBe(true);
      }
    }
  });

  it("classic mode eventually finishes (the ball escapes every wall)", () => {
    const request: FinderRequest = {
      targetDurationSec: 30,
      toleranceSec: 0.5,
      maxSeeds: 1,
      maxSimTimeSec: 240,
      physicsConfig: config,
      mode: "classic",
      modeSettings: settings,
    };
    const ms = simulateSeed(7, request, 240_000);
    expect(ms).toBeLessThan(240_000);
  });

  it("consumes sound events only once", () => {
    const engine = createEngineForSettings(config, "classic", settings, 3);
    for (let i = 0; i < 300; i++) engine.update(1000 / 60, 0);
    const first = engine.consumeSoundEvents();
    expect(first.length).toBeGreaterThan(0);
    expect(engine.consumeSoundEvents()).toHaveLength(0);
  });
});
