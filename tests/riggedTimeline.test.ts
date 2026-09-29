import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { riggedConfigOf } from "@/lib/physics/rigged";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { outcomeMatches, type FinderOutcome } from "@/lib/simulation/outcomes";
import { timelineCarryOver, timelineValueAt, type Keyframe, type TimelineKey } from "@/lib/simulation/timeline";
import { teamResult } from "@/lib/teams";

/**
 * Rigged outcomes (lib/physics/rigged.ts) with timeline keyframes (lib/simulation/timeline.ts): both travel in the
 * physics config, so the rig must hold while the keyframes change the world it predicts (wider gaps, faster balls,
 * heavier gravity), the page's engine and the finder's must play the same rigged, keyframed run, and the settings must
 * survive links, presets and mode changes together.
 */

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

const modeSettings: ModeSettings = {
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
  drop: {},
  box: {},
};

const STEP = 1000 / 60;
const kf = (key: TimelineKey, time: number, value: number): Keyframe => ({ key, time, value });

/** The gaps open from 0.4 to 1.2 rad, the balls speed up from 400 to 900 and gravity climbs from 300 to 1200 over 10 s. */
const HARDER: Keyframe[] = [kf("gapSize", 0, 0.4), kf("gapSize", 10, 1.2), kf("ballSpeed", 0, 400), kf("ballSpeed", 10, 900), kf("gravity", 0, 300), kf("gravity", 10, 1200)];

function step(engine: PhysicsEngine, frames: number, untilFinished = false) {
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    if (untilFinished && engine.isSimulationFinished()) return;
  }
}

/** Positions and radii of every ball every 30 frames, rounded to 1/1000 px – a fingerprint of the run. */
function trajectory(engine: PhysicsEngine, frames: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    if (i % 30 === 0) out.push(engine.getBalls().flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000), Math.round(b.radius * 1000)]));
  }
  return out;
}

/** The largest distance of a ball from the arena centre, relative to the outermost wall's radius (> 1: outside). */
function outermostReach(engine: PhysicsEngine): number {
  const outer = engine.getCircularWalls().reduce((m, w) => Math.max(m, w.radius), 0);
  const cx = config.width / 2;
  const cy = config.height / 2;
  return engine.getBalls().reduce((m, b) => Math.max(m, (Math.hypot(b.x - cx, b.y - cy) + b.radius) / outer), 0);
}

describe("rigged outcomes with timeline keyframes", () => {
  it("never escape holds while the keyframes open the gaps, speed the balls up and pile on gravity", { timeout: 120_000 }, () => {
    for (const mode of ["classic", "accumulation", "multiply"] as ModeId[]) {
      for (const seed of [3, 11]) {
        const engine = createEngineForSettings({ ...config, neverEscape: true, timeline: HARDER }, mode, modeSettings, seed);
        let reach = 0;
        for (let s = 0; s < 40; s++) {
          step(engine, 60);
          reach = Math.max(reach, outermostReach(engine));
        }
        const label = `${mode} seed ${seed}`;
        // The keyframes did play: the config holds their last values and the rings' gaps were resized in place.
        expect(engine.config.ballSpeed, label).toBe(900);
        expect(engine.config.gravity, label).toBe(1200);
        const gap = engine.getCircularWalls().find((w) => w.gaps.length === 1)?.gaps[0];
        expect(gap, label).toBeDefined();
        expect((gap?.endAngle ?? 0) - (gap?.startAngle ?? 0), label).toBeCloseTo(1.2, 9);
        // … and the rig held: no escape, no finish, every ball inside the outer wall.
        expect(engine.getFirstEscapeMs(), label).toBe(-1);
        expect(engine.isSimulationFinished(), label).toBe(false);
        expect(reach, label).toBeLessThan(1.05);
        expect(engine.getRigView().neverEscape, label).toBe(true);
      }
    }
  });

  it("the forced winner still wins a race whose speed and gaps the keyframes change", { timeout: 120_000 }, () => {
    const script = [kf("ballSpeed", 0, 500), kf("ballSpeed", 6, 800), kf("gapSize", 0, 0.6), kf("gapSize", 8, 1)];
    // Left to physics, these seeds' races go to the third ball.
    for (const seed of [1, 4]) {
      const engine = createEngineForSettings({ ...config, wallCount: 3, ballCount: 3, forcedWinner: 1, timeline: script }, "classic", { ...modeSettings, ballCount: 3 }, seed);
      step(engine, 60 * 180, true);
      expect(engine.isSimulationFinished(), `seed ${seed}`).toBe(true);
      const result = teamResult(engine.getTeamStats().slice(0, 3), 3);
      expect(result.tie, `seed ${seed}`).toBe(false);
      expect(result.winner, `seed ${seed}`).toBe(1);
    }
  });

  it("the page's engine and the finder's play the same rigged, keyframed run – whatever order the settings arrive in", { timeout: 60_000 }, () => {
    const seed = 4242;
    // The page: the engine is built with the keyframes, the rig arrives later (its effect), a few seconds play.
    const page = new PhysicsEngine({ ...config, timeline: HARDER });
    page.setSeed(seed);
    page.initMode("classic");
    page.setConfig(riggedConfigOf({ neverEscape: true, forcedWinner: -1 }));
    step(page, 200);
    // Find Simulation copies the page engine's config mid-run (the automated values of that second included) …
    const request: FinderRequest = { targetDurationSec: 20, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 30, physicsConfig: { ...page.config }, mode: "classic", modeSettings };
    expect(request.physicsConfig.neverEscape).toBe(true);
    expect(request.physicsConfig.timeline).toEqual(HARDER);
    const finder = createEngineForSettings(request.physicsConfig, "classic", modeSettings, seed);
    // … and the page starts the found seed over: both play the same run from the keyframes' values at 0 s.
    page.setSeed(seed);
    page.setConfig({ ballRadius: config.ballRadius });
    page.initMode("classic");
    expect(page.config.gapSize).toBe(timelineValueAt(HARDER, "gapSize", 0));
    expect(trajectory(finder, 60 * 15)).toEqual(trajectory(page, 60 * 15));
    expect({ ...finder.getRigView() }).toEqual({ ...page.getRigView() });
    // The outcome search sums the same run up the same way, and it keeps every ball in for the clip.
    const outcome: FinderOutcome = { kind: "never-escapes", clipSec: 15 };
    const run = simulateOutcomeRun(seed, request, outcome);
    expect(simulateOutcomeRun(seed, request, outcome)).toEqual(run);
    expect(outcomeMatches(outcome, run)).toBe(true);
  });

  it("travel together through links, presets and mode changes", () => {
    const settings = { ...defaultSettings("classic"), ballCount: 3, neverEscape: true, forcedWinner: 2, keyframes: [kf("gravity", 0, 300), kf("ballRadius", 2, 14), kf("gravity", 10, 1200)] }; // in the canonical order (by time)
    const params = settingsToSearchParams(settings);
    expect(params.get("ne")).toBe("1");
    expect(params.get("fw")).toBe("2");
    expect(params.get("kf")).toBe("g_0_300_10_1200*r_2_14");
    const back = settingsFromSearchParams(params);
    expect(back.neverEscape).toBe(true);
    expect(back.forcedWinner).toBe(2);
    expect(back.keyframes).toEqual(settings.keyframes);
    const preset = presetToSettings(JSON.parse(JSON.stringify(settings)));
    expect(preset.neverEscape).toBe(true);
    expect(preset.forcedWinner).toBe(2);
    expect(preset.keyframes).toEqual(settings.keyframes);
    // A mode change keeps both: the story and the script of the clip.
    const next = { ...defaultSettings("shatter"), ...riggedConfigOf(settings), ...timelineCarryOver(settings) };
    expect(riggedConfigOf(next)).toEqual({ neverEscape: true, forcedWinner: 2 });
    expect(next.keyframes).toEqual(settings.keyframes);
  });
});
