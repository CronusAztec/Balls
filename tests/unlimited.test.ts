import { describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { Crowd } from "@/lib/physics/crowd";
import { LOD_POINTS_FROM, MAX_SAFE_SPEED, MAX_SOUNDS_PER_FRAME, PAIR_COLLISIONS_UP_TO, STEP_WORK_CAP, UnlimitedRuntime, unlimitedConfigOf, unlimitedExtrasOf } from "@/lib/physics/limits";
import { MAX_EFFECTIVE_BOUNCE, MULTIPLIER_CEILING, effectiveBounce, type StepPlan } from "@/lib/physics/multipliers";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { FRAME_BUDGET_MS, FrameBudget, formatRealTime } from "@/lib/simulation/frameBudget";
import { FINDER_MIN_SEEDS, findSimulationBudgeted, seedsWithinBudget, usesBudgetedSearch } from "@/lib/simulation/unlimitedFinder";
import type { FinderRequest, ModeSettings } from "@/lib/simulation/finder";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, unlimitedSettingKeys, type SimulatorSettings } from "@/lib/settings";
import { resolveProjectSettings } from "@/lib/project";
import { decodeShareCode, encodeShareCode, supportsShareCodes } from "@/lib/shareCode";
import {
  BOUNDED_KEYS,
  CROWD_LIMIT,
  LIVE_WALL_LIMIT,
  OBJECT_BALL_LIMIT,
  UNLIMITED_SLIDER_CEILING,
  clampUnlimitedPatch,
  formatHuge,
  isUnlimitedKey,
  parseUnlimitedValue,
  sliderPosition,
  sliderValue,
  softCeiling,
  visualValue,
} from "@/lib/unlimited";

// Whole runs of the engine with extreme values: generous timeouts, so a busy machine does not fail them.
vi.setConfig({ testTimeout: 120_000 });

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

function engineFor(mode: SimulatorSettings["mode"], patch: Partial<PhysicsConfig> = {}, seed = 7) {
  const engine = new PhysicsEngine({ ...config, unlimited: true, ...patch });
  engine.setCinematicEnabled(false);
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

function allFinite(engine: PhysicsEngine): boolean {
  for (const b of engine.getBalls()) if (!Number.isFinite(b.x + b.y + b.vx + b.vy + b.radius)) return false;
  const crowd = engine.getCrowd();
  for (let i = 0; i < crowd.count; i++) if (!Number.isFinite(crowd.x[i] + crowd.y[i] + crowd.vx[i] + crowd.vy[i])) return false;
  return true;
}

const ranges = RANGES as unknown as Record<string, { min: number; max: number; step: number }>;

describe("No limits: parsing", () => {
  it("accepts 1e7 balls, 1e6 speed and 1e5 walls with the switch on", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&inf=1&nb=10000000&s=1000000&wc=100000"));
    expect(s.unlimited).toBe(true);
    expect(s.ballCount).toBe(1e7);
    expect(s.ballSpeed).toBe(1e6);
    expect(s.wallCount).toBe(1e5);
    expect(s.twoBalls).toBe(true);
  });

  it("rejects -5, NaN and Infinity (back to the default), with the switch on", () => {
    const d = defaultSettings("classic");
    for (const bad of ["-5", "NaN", "Infinity", "-Infinity", "abc", ""]) {
      const s = settingsFromSearchParams(new URLSearchParams(`mode=classic&inf=1&s=${bad}&r=${bad}&nb=${bad}&wc=${bad}&cpn=${bad}`));
      expect(s.ballSpeed).toBe(d.ballSpeed);
      expect(s.ballRadius).toBe(d.ballRadius);
      expect(s.ballCount).toBe(d.ballCount);
      expect(s.wallCount).toBe(d.wallCount);
      expect(s.cpCount).toBe(d.cpCount);
    }
    expect(parseUnlimitedValue("ballSpeed", -5, ranges.ballSpeed)).toBeNull();
    expect(parseUnlimitedValue("ballSpeed", Number.NaN, ranges.ballSpeed)).toBeNull();
    expect(parseUnlimitedValue("ballSpeed", Infinity, ranges.ballSpeed)).toBeNull();
    expect(parseUnlimitedValue("ballRadius", 3, ranges.ballRadius)).toBeNull(); // below the sensible minimum
    expect(parseUnlimitedValue("wallCount", 12.6, ranges.wallCount)).toBe(13); // counts are whole
  });

  it("keeps the old clamping with the switch off", () => {
    const off = settingsFromSearchParams(new URLSearchParams("mode=collide&cpn=50000&nb=50000"));
    expect(off.unlimited).toBe(false);
    expect(off.cpCount).toBe(RANGES.cpCount.max);
    expect(off.ballCount).toBe(RANGES.ballCount.max);
    const on = settingsFromSearchParams(new URLSearchParams("mode=collide&inf=1&cpn=50000&nb=50000"));
    expect(on.cpCount).toBe(50000);
    expect(on.ballCount).toBe(50000);
  });

  it("leaves bounded settings (fractions, volumes, the recording) on their ranges", () => {
    for (const key of ["gapSize", "musicVolume", "recordingDuration", "fastExportFps", "cameraZoom", "textSize"]) expect(BOUNDED_KEYS.has(key)).toBe(true);
    expect(isUnlimitedKey("musicVolume", ranges.musicVolume)).toBe(false);
    expect(unlimitedSettingKeys()).not.toContain("musicVolume");
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&inf=1&mv=50"));
    expect(s.musicVolume).toBe(RANGES.musicVolume.max);
  });

  it("round-trips every unlimited setting through the link, far past its range", () => {
    const keys = unlimitedSettingKeys();
    expect(keys.length).toBeGreaterThan(60);
    const s = { ...defaultSettings("classic"), unlimited: true } as unknown as Record<string, unknown>;
    const want: Record<string, number> = {};
    for (const key of keys) {
      const r = ranges[key];
      const v = key === "airDrag" ? 0.5 : key === "breathingAmplitude" ? 0.9 : Number.isInteger(r.step) && r.step >= 1 ? Math.round(r.max * 1000 + 3) : r.max * 1000 + 0.5;
      s[key] = v;
      want[key] = v;
    }
    const params = settingsToSearchParams(s as unknown as SimulatorSettings);
    expect(params.get("inf")).toBe("1");
    const back = settingsFromSearchParams(params) as unknown as Record<string, unknown>;
    for (const key of keys) expect([key, back[key]]).toEqual([key, want[key]]);
  });

  it("carries big values in presets and project files", () => {
    const preset = { ...defaultSettings("classic"), unlimited: true, ballSpeed: 1e6, wallCount: 1e5, ballCount: 1e7, cpCount: 50_000, ballRadius: -5, gravity: Number.NaN } as unknown as Partial<SimulatorSettings>;
    const loaded = presetToSettings(preset);
    expect(loaded.unlimited).toBe(true);
    expect([loaded.ballSpeed, loaded.wallCount, loaded.ballCount, loaded.cpCount]).toEqual([1e6, 1e5, 1e7, 50_000]);
    expect(loaded.ballRadius).toBe(defaultSettings("classic").ballRadius);
    expect(loaded.gravity).toBe(defaultSettings("classic").gravity);
    // Without the switch the preset is clamped as before.
    const off = presetToSettings({ ...preset, unlimited: false });
    expect(off.cpCount).toBe(RANGES.cpCount.max);
    // A project file: the numbers survive the file's own clamp too.
    const project = resolveProjectSettings({ mode: "classic", unlimited: true, ballSpeed: 1e6, wallCount: 1e5, cpCount: 50_000 });
    expect([project.unlimited, project.ballSpeed, project.wallCount, project.cpCount]).toEqual([true, 1e6, 1e5, 50_000]);
    const plain = resolveProjectSettings({ mode: "classic", cpCount: 50_000 });
    expect(plain.cpCount).toBe(RANGES.cpCount.max);
  });

  it.runIf(supportsShareCodes())("keeps big values in short share codes", async () => {
    const s = { ...defaultSettings("classic"), unlimited: true, ballSpeed: 1e21, ballCount: 50_000, plLayers: 1e6 };
    const code = await encodeShareCode(settingsToSearchParams(s));
    expect(code).toBeTruthy();
    const decoded = await decodeShareCode(code!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const back = settingsFromSearchParams(decoded.params);
    expect([back.unlimited, back.ballSpeed, back.ballCount, back.plLayers]).toEqual([true, 1e21, 50_000, 1e6]);
  });

  it("clamps every value back into its range when the switch goes off", () => {
    const s = { ...defaultSettings("classic"), unlimited: true, ballSpeed: 1e9, wallCount: 1e5, windX: -1e6 } as unknown as Record<string, unknown>;
    const patch = clampUnlimitedPatch(s, unlimitedSettingKeys(), ranges);
    expect(patch).toEqual({ ballSpeed: RANGES.ballSpeed.max, wallCount: RANGES.wallCount.max, windX: RANGES.windX.min });
  });
});

describe("No limits: the slider and the numbers", () => {
  it("is linear across the range and logarithmic up to 1B above it", () => {
    const r = ranges.ballSpeed;
    expect(sliderPosition("ballSpeed", r.min, r)).toBe(0);
    expect(sliderPosition("ballSpeed", r.max, r)).toBe(500);
    expect(sliderValue("ballSpeed", 1000, r)).toBe(UNLIMITED_SLIDER_CEILING);
    for (const v of [400, 800, 1600, 50_000, 3_000_000, 250_000_000]) {
      const back = sliderValue("ballSpeed", sliderPosition("ballSpeed", v, r), r);
      expect(Math.abs(back - v) / v).toBeLessThan(0.06);
    }
    // A setting with a meaning that ends (a drag of 1 stops the ball) ends its slider there.
    expect(sliderValue("airDrag", 1000, ranges.airDrag)).toBe(1);
  });

  it("formats huge numbers short", () => {
    expect(formatHuge(1e9)).toBe("1B");
    expect(formatHuge(2_500_000)).toBe("2.5M");
    expect(formatHuge(12_345)).toBe("12.3K");
    expect(formatHuge(42)).toBe("42");
    expect(formatHuge(1e21)).toBe("1.0e21");
    expect(formatRealTime(0.4)).toBe("0.4");
    expect(formatRealTime(0.0123)).toBe("0.01");
  });

  it("knows the soft ceilings the engine runs", () => {
    expect(softCeiling("wallCount", ranges.wallCount)).toBe(LIVE_WALL_LIMIT);
    expect(softCeiling("ballCount", ranges.ballCount)).toBe(CROWD_LIMIT);
    expect(softCeiling("cpCount", ranges.cpCount)).toBe(RANGES.cpCount.max); // its mode runs it at its own maximum
    expect(visualValue(true, "wallThickness", 1e9)).toBe(400);
    expect(visualValue(false, "wallThickness", 1e9)).toBe(1e9);
  });

  it("builds the engine config: the crowd is the ball count past the team balls", () => {
    expect(unlimitedConfigOf({ unlimited: true, ballCount: 50_000 }, 6, true)).toEqual({ unlimited: true, crowdCount: 49_994 });
    expect(unlimitedConfigOf({ unlimited: true, ballCount: 1e12 }, 6, true).crowdCount).toBe(CROWD_LIMIT);
    expect(unlimitedConfigOf({ unlimited: true, ballCount: 50_000 }, 1, false).crowdCount).toBe(0);
    expect(unlimitedConfigOf({ unlimited: false, ballCount: 50_000 }, 6, true)).toEqual({ unlimited: false, crowdCount: 0 });
    expect(unlimitedExtrasOf({ ...config, unlimited: true, wallBounciness: 1e6 })).toEqual({ wallBounciness: 1e6 });
    expect(unlimitedExtrasOf({ ...config, wallBounciness: 1e6 })).toEqual({});
  });
});

describe("No limits: the engine", () => {
  it("runs at its soft ceilings and lifts the extras past their ranges", () => {
    const engine = engineFor("classic", { wallCount: 1e5, ballSpeed: 1e20, wallBounciness: 1e6, maxBalls: 1e9, windX: -1e6 });
    expect(engine.getCircularWalls().length).toBe(LIVE_WALL_LIMIT);
    expect(engine.config.ballSpeed).toBe(1e12);
    expect(engine.getPhysicsExtras().wallBounciness).toBe(1e6);
    expect(engine.getPhysicsExtras().windX).toBe(-1e6);
    expect(engine.getBallInteraction().maxBalls).toBe(OBJECT_BALL_LIMIT);
    // Switched off the config is taken as it is again (the page clamps the settings first).
    engine.setConfig({ unlimited: false, wallCount: 7 });
    expect(engine.getCircularWalls().length).toBe(7);
  });

  it("a step with 200,000 balls finishes inside the budget through time-slicing, without throwing", () => {
    const engine = engineFor("classic", { crowdCount: 200_000, ballCount: 6 });
    engine.update(1000 / 60, 0); // the crowd appears
    expect(engine.getUnlimitedView().crowd).toBe(200_000);
    // The canvas loop: 100 ms of wall time asks for six steps; the budget stops after the step that used it up.
    const budget = new FrameBudget();
    budget.enabled = true;
    let worstStep = 0;
    let frames = 0;
    let slowestFrame = 0;
    let simulated = 0;
    const before = engine.getElapsedMs();
    for (let frame = 0; frame < 5; frame++) {
      let accumulator = 100;
      const start = performance.now();
      budget.begin(start);
      while (accumulator >= 16.666) {
        const t0 = performance.now();
        engine.update(16.666, 0);
        engine.consumeSoundEvents();
        worstStep = Math.max(worstStep, performance.now() - t0);
        accumulator -= 16.666;
        simulated += 16.666;
        if (budget.exceeded(performance.now())) accumulator = 0;
      }
      slowestFrame = Math.max(slowestFrame, performance.now() - start);
      frames++;
    }
    // Never more than the budget plus the one step that crossed it; the clock ran slower than the wall clock asked for.
    expect(slowestFrame).toBeLessThanOrEqual(FRAME_BUDGET_MS + worstStep + 5);
    expect(simulated).toBeLessThan(frames * 100);
    expect(engine.getElapsedMs() - before).toBeGreaterThan(0);
    expect(engine.getElapsedMs() - before).toBeLessThanOrEqual(simulated + 1);
    expect(budget.slicedFrames).toBeGreaterThan(0);
    expect(allFinite(engine)).toBe(true);
    // A step of the crowd stays far from a frozen tab even on a slow machine.
    expect(worstStep).toBeLessThan(400);
  });

  it("gives the same run for a seed at any budget (slicing happens between whole steps)", () => {
    const run = (stepsPerFrame: (frame: number) => number) => {
      const engine = engineFor("multiply", { crowdCount: 5_000, ballCount: 3, ballSpeed: 2_000 }, 42);
      engine.setMultiplySpawnCount(50);
      let steps = 0;
      for (let frame = 0; steps < 240; frame++) {
        const n = Math.min(stepsPerFrame(frame), 240 - steps);
        for (let i = 0; i < n; i++) {
          engine.update(1000 / 60, 0);
          engine.consumeSoundEvents();
        }
        steps += n;
      }
      const crowd = engine.getCrowd();
      return {
        balls: engine.getBalls().map((b) => [b.x, b.y, b.vx, b.vy, b.radius]),
        crowd: [crowd.count, crowd.x[0], crowd.y[crowd.count - 1], crowd.bounces, crowd.escaped],
        elapsed: engine.getElapsedMs(),
      };
    };
    const everyFrame = run(() => 1);
    const bursts = run((f) => [0, 3, 1, 0, 5, 2][f % 6]);
    const frameBudgets = run((f) => 1 + (f % 4));
    expect(bursts).toEqual(everyFrame);
    expect(frameBudgets).toEqual(everyFrame);
  });

  it("stacks multipliers to 1e12 (and a bounce without the 1.5 cap) with finite state", () => {
    const engine = engineFor("classic");
    const ball = engine.getBalls()[0];
    for (let i = 0; i < 12; i++) {
      engine.applyBallMultiplier(ball, "speed", 10);
      engine.applyBallMultiplier(ball, "damage", 10);
      engine.applyBallMultiplier(ball, "bounce", 10);
      engine.applyBallMultiplier(ball, "gravity", 10);
    }
    expect(ball.mult!.speed).toBeCloseTo(1e12, -3);
    expect(ball.mult!.damage).toBeCloseTo(1e12, -3);
    expect(effectiveBounce(ball, Infinity)).toBeCloseTo(1e12, -3);
    expect(effectiveBounce(ball)).toBe(MAX_EFFECTIVE_BOUNCE);
    for (let i = 0; i < 90; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
    }
    expect(allFinite(engine)).toBe(true);
    for (const b of engine.getBalls()) expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(MAX_SAFE_SPEED * 1.0001);
    expect(ball.mult!.speed).toBeLessThanOrEqual(MULTIPLIER_CEILING);
  });

  it("ends the run with THE BALL ATE THE ARENA and the gulp when a ball outgrows its arena", () => {
    // A Ball Size bigger than the arena: eaten before the first step.
    const huge = engineFor("classic", { ballRadius: 1e6 });
    huge.update(1000 / 60, 0);
    const events = huge.consumeSoundEvents();
    expect(huge.getUnlimitedView().ate).toBe(true);
    expect(huge.isSimulationFinished()).toBe(true);
    expect(events.filter((e) => e.ate)).toHaveLength(1);
    expect(huge.endsWithMultiplierFinish()).toBe(true);
    // A size multiplier that grows past every ring: the rings burst on the way, then the arena is eaten.
    const growing = engineFor("classic");
    const ball = growing.getBalls()[0];
    let wallBreaks = 0;
    for (let i = 0; i < 40 && !growing.isSimulationFinished(); i++) {
      growing.applyBallMultiplier(ball, "size", 1.6);
      growing.update(1000 / 60, 0);
      wallBreaks += growing.consumeSoundEvents().filter((e) => e.type === "gap" && !e.ate).length;
    }
    expect(growing.getUnlimitedView().ate).toBe(true);
    expect(wallBreaks).toBeGreaterThan(0);
    // Without rings (Ball Drop's board) a ball bigger than the canvas eats it.
    const board = engineFor("drop", { ballRadius: 5e3 });
    board.update(1000 / 60, 0);
    expect(board.getUnlimitedView().ate).toBe(true);
  });

  it("puts a ball with non-finite numbers back at the centre", () => {
    const engine = engineFor("classic", { crowdCount: 10 });
    engine.update(1000 / 60, 0);
    const ball = engine.getBalls()[0];
    ball.x = Number.NaN;
    ball.vy = Infinity;
    const crowd = engine.getCrowd() as Crowd;
    crowd.x[3] = Number.NaN;
    engine.update(1000 / 60, 0);
    expect(allFinite(engine)).toBe(true);
    expect(engine.getUnlimitedView().rescued).toBeGreaterThanOrEqual(2);
  });

  it("clone storms: past the full-physics limit Multiply's balls join the crowd, and a full crowd says ARENA FULL", () => {
    const engine = engineFor("multiply", { ballSpeed: 900 });
    engine.setMultiplySpawnCount(5_000);
    for (let i = 0; i < 600 && engine.getUnlimitedView().crowd === 0; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
    }
    const view = engine.getUnlimitedView();
    expect(view.crowd).toBeGreaterThan(0);
    expect(view.objects).toBeLessThanOrEqual(OBJECT_BALL_LIMIT);
    expect(allFinite(engine)).toBe(true);
    // The crowd itself at its limit refuses the rest.
    const crowd = new Crowd();
    crowd.reset(100);
    expect(crowd.spawnBurst(150, 0, 0, 100, 2, 0, 0, 1)).toBe(100);
    expect(crowd.full).toBe(true);
    expect(crowd.add(0, 0, 1, 1, 2, 0)).toBe(false);
  });

  it("keeps crowd balls between their rings (no tunnelling at any speed)", () => {
    const engine = engineFor("classic", { crowdCount: 2_000, rotationSpeed: 0, gapSize: 0.1, ballSpeed: 5e5 });
    for (let i = 0; i < 120; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
    }
    const crowd = engine.getCrowd();
    const outer = Math.max(...engine.getCircularWalls().map((w) => w.radius));
    const cx = engine.config.width / 2;
    const cy = engine.config.height / 2;
    let inside = 0;
    for (let i = 0; i < crowd.count; i++) if (Math.hypot(crowd.x[i] - cx, crowd.y[i] - cy) <= outer + 1) inside++;
    // Everyone still in play is inside the arena or has left through a gap (counted as escaped).
    expect(inside + crowd.escaped).toBeGreaterThanOrEqual(crowd.count);
    expect(crowd.bounces).toBeGreaterThan(1_000);
    expect(allFinite(engine)).toBe(true);
  });

  it("bounds a step: many fast balls get fewer sub-steps and more dilation, and huge crowds skip pair checks", () => {
    const rt = new UnlimitedRuntime();
    rt.configure({ unlimited: true });
    const plan: StepPlan = { subSteps: 64, dilation: 0.5 };
    rt.boundPlan(plan, 2_000);
    expect(plan.subSteps * 2_000).toBeLessThanOrEqual(Math.max(4 * 2_000, STEP_WORK_CAP));
    expect(plan.dilation).toBeCloseTo((0.5 * plan.subSteps) / 64, 10);
    expect(rt.pairsAllowed(PAIR_COLLISIONS_UP_TO)).toBe(true);
    expect(rt.pairsAllowed(PAIR_COLLISIONS_UP_TO + 1)).toBe(false);
    rt.configure({ unlimited: false });
    expect(rt.pairsAllowed(1e6)).toBe(true);
  });

  it("hands at most a handful of sounds to the synth per frame, breaks first", () => {
    const rt = new UnlimitedRuntime();
    rt.configure({ unlimited: true });
    const events: SoundEvent[] = [];
    for (let i = 0; i < 500; i++) events.push({ type: "hit", wallIndex: i % 7 });
    events.push({ type: "gap", wallIndex: 0, ate: true });
    const kept = rt.thinSounds(events);
    expect(kept.length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
    expect(kept.some((e) => e.ate)).toBe(true);
    rt.configure({ unlimited: false });
    expect(rt.thinSounds(events)).toBe(events);
  });

  it("survives every mode with absurd values: no throw, finite state, bounded steps", () => {
    const extremes: Partial<PhysicsConfig>[] = [
      { ballSpeed: 1e9, gravity: 1e9, rotationSpeed: 1e9 },
      { wallCount: 1e5, wallBounciness: 1e9, windX: 1e9, spinStrength: 1e6 },
      { ballRadius: 400, breathingAmplitude: 0.95, breathingSpeed: 1e6, rotatingGravity: 1e9, airDrag: 1 },
    ];
    for (const mode of MODE_IDS) {
      for (const patch of extremes) {
        const engine = engineFor(mode, patch);
        engine.setSpikeCount(1e9);
        engine.setCountdownTotal(1e9);
        engine.setGrowRate(1e9);
        for (let i = 0; i < 30; i++) {
          engine.update(1000 / 60, 0);
          engine.consumeSoundEvents();
        }
        expect([mode, allFinite(engine)]).toEqual([mode, true]);
        expect(engine.getCircularWalls().length).toBeLessThanOrEqual(LIVE_WALL_LIMIT);
      }
    }
  });

  it("changes nothing with the switch off", () => {
    const trace = (patch: Partial<PhysicsConfig>) => {
      const engine = new PhysicsEngine({ ...config, ...patch });
      engine.setSeed(5);
      engine.initMode("classic");
      const out: number[] = [];
      for (let i = 0; i < 180; i++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        if (i % 30 === 0) for (const b of engine.getBalls()) out.push(b.x, b.y);
      }
      return out;
    };
    expect(trace({ unlimited: false, crowdCount: 5_000 })).toEqual(trace({}));
  });
});

describe("No limits: the crowd renderer's level of detail", () => {
  it("draws points past the points threshold", () => {
    expect(LOD_POINTS_FROM).toBeGreaterThan(OBJECT_BALL_LIMIT);
  });
});

describe("No limits: Find Simulation respects the budget", () => {
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
    cinematicEnabled: false,
    drop: {},
    box: {},
  };
  const request = (patch: Partial<PhysicsConfig>, maxSeeds = 20): FinderRequest => ({
    targetDurationSec: 1000,
    toleranceSec: 0.1,
    maxSeeds,
    maxSimTimeSec: 60,
    physicsConfig: { ...config, unlimited: true, ...patch },
    mode: "classic",
    modeSettings,
  });

  it("takes plain run-length searches with the switch on only", () => {
    expect(usesBudgetedSearch(request({}))).toBe(true);
    expect(usesBudgetedSearch({ ...request({}), physicsConfig: { ...config } })).toBe(false);
    expect(usesBudgetedSearch({ ...request({}), outcome: { kind: "never-escapes", clipSec: 30, atSec: 10, team: 0 } })).toBe(false);
    expect(seedsWithinBudget(50, 40, 3600)).toBe(FINDER_MIN_SEEDS);
    expect(seedsWithinBudget(50, 0.01, 3600)).toBe(50);
  });

  it("tests fewer seeds on a heavy run, a slice of each frame at a time, and says so", async () => {
    // A fake clock: every step "costs" 10 ms (a minute of simulation 36 s), so the frame budget allows one step a frame
    // and the time budget only the fewest seeds.
    let clock = 0;
    const now = () => (clock += 10);
    const queue: (() => void)[] = [];
    const schedule = (fn: () => void) => void queue.push(fn);
    let frames = 0;
    const done = findSimulationBudgeted(request({ crowdCount: 200 }), () => {}, undefined, now, schedule);
    while (queue.length > 0 && frames < 200_000) {
      queue.shift()!();
      frames++;
    }
    const result = await done;
    expect(result.found).toBe(false);
    expect(result.limitedSeeds).toBe(FINDER_MIN_SEEDS);
    expect(result.seedsTested).toBe(FINDER_MIN_SEEDS);
    // One step a frame: at least as many frames as seconds of all the seeds tested × 60.
    expect(frames).toBeGreaterThanOrEqual(result.seedsTested * 60);
  });
});
