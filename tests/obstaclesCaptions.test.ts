import { describe, expect, it } from "vitest";
import { CaptionTracker, captionCarryOver, defaultCaption, type Caption } from "@/lib/captions";
import { defaultObstacle, obstacleConfigOf, obstacleSettingsOf, type EditorObstacle } from "@/lib/physics/obstacleEditor";
import type { PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";

/**
 * The obstacle editor and the animated captions together: one link and one preset carry both, a mode change keeps
 * both, and the captions (render-only) read a run with obstacles in play without changing it.
 */

const LAYOUT: EditorObstacle[] = [
  { kind: "peg", x: 0.2, y: -0.3, size: 6, angle: 0, rpm: 0 },
  { kind: "bumper", x: -0.4, y: 0.1, size: 8, angle: 0, rpm: 0 },
  { kind: "blocker", x: 0, y: 0.5, size: 40, angle: 30, rpm: 0 },
  { kind: "spinner", x: 0, y: -0.5, size: 50, angle: -45, rpm: 20 },
];

const CAPTIONS: Caption[] = [
  defaultCaption("countdown"),
  defaultCaption("wallCounter"),
  { ...defaultCaption("question", { text: "Will it escape?", answer: "YES!" }), position: "center" },
];

const settings: SimulatorSettings = { ...defaultSettings("shatter"), obstacles: LAYOUT, bumperBoost: 1.5, captions: CAPTIONS };

describe("obstacles and captions together", () => {
  it("share one link: obs, obb and cap side by side, read back unchanged", () => {
    const params = settingsToSearchParams(settings);
    expect(params.get("obs")).toBe("p:0.2,-0.3,6;b:-0.4,0.1,8;k:0,0.5,40,30;s:0,-0.5,50,-45,20");
    expect(params.get("obb")).toBe("1.5");
    expect(params.get("cap")).toBe("cd*t*0*0*p*1.2*ffffff*000000,wc*t*0*0*s*1*93d119*000000,q*c*0*0*p*1.3*ffffff*000000*Will it escape?*YES!");
    expect(settingsFromSearchParams(new URLSearchParams(params.toString()))).toEqual(settings);
  });

  it("survive a preset save", () => {
    const loaded = presetToSettings(JSON.parse(JSON.stringify(settings)) as Partial<SimulatorSettings>);
    expect(loaded.obstacles).toEqual(LAYOUT);
    expect(loaded.bumperBoost).toBe(1.5);
    expect(loaded.captions).toEqual(CAPTIONS);
  });

  it("both carry over a mode change, as the page merges them into the new mode's defaults", () => {
    const fresh: SimulatorSettings = { ...defaultSettings("portal") };
    Object.assign(fresh, obstacleSettingsOf(settings));
    Object.assign(fresh, captionCarryOver(settings));
    expect(fresh.mode).toBe("portal");
    expect(fresh.obstacles).toEqual(LAYOUT);
    expect(fresh.bumperBoost).toBe(1.5);
    expect(fresh.captions).toEqual(CAPTIONS);
  });

  it("the caption tracker only reads a run with obstacles: the same trajectory, hits and kicks with and without it", () => {
    const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
    const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
    // A ring of pegs and bumpers around the start, so the ball meets them within a second whatever the seed.
    const ring: EditorObstacle[] = Array.from({ length: 8 }, (_, i) => defaultObstacle(i % 2 ? "bumper" : "peg", 0.35 * Math.cos((i * Math.PI) / 4), 0.35 * Math.sin((i * Math.PI) / 4)));
    const withObstacles: PhysicsConfig = { ...config, ...obstacleConfigOf({ obstacles: [...ring, LAYOUT[3]], bumperBoost: 1.6 }) };
    const run = (withTracker: boolean) => {
      const engine = createEngineForSettings(withObstacles, "classic", modeSettings, 4242);
      const tracker = new CaptionTracker();
      const trace: number[] = [];
      for (let i = 0; i < 600; i++) {
        engine.update(1000 / 60, 0);
        if (withTracker) tracker.update(engine);
        for (const b of engine.getBalls()) trace.push(b.x, b.y);
      }
      const field = engine.getEditorObstacles()!;
      return { trace, hits: field.hitCount, kicks: field.bumpCount, state: { ...tracker.state } };
    };
    const tracked = run(true);
    const plain = run(false);
    expect(tracked.hits).toBeGreaterThan(0);
    expect(tracked.kicks).toBeGreaterThan(0);
    expect(tracked.trace).toEqual(plain.trace);
    expect([tracked.hits, tracked.kicks]).toEqual([plain.hits, plain.kicks]);
    expect(tracked.state.wallsTotal).toBe(7);
    expect(tracked.state.timeSec).toBeGreaterThan(0);
  });
});
