import { describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { Crowd } from "@/lib/physics/crowd";
import { BREAK_EFFECTS_PER_STEP, CROWD_POUR_PER_STEP, DENSE_RINGS_FROM, OBJECT_MIN, RING_OBJECT_WORK, STEP_RING_WORK, WALL_HITS_KEPT, fitIntoSortedRings, objectLimitFor, LOD_POINTS_FROM, MAX_SAFE_SPEED, MAX_SOUNDS_PER_FRAME, PAIR_COLLISIONS_UP_TO, STEP_WORK_CAP, UnlimitedRuntime, uncapConfigOf, unlimitedConfigOf, unlimitedExtrasOf } from "@/lib/physics/limits";
import { MAX_EFFECTIVE_BOUNCE, MULTIPLIER_CEILING, effectiveBounce, fitBallToRings, type RingFit, type StepPlan } from "@/lib/physics/multipliers";
import { MULTI_BALL_MODES } from "@/lib/physics/ballStats";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { effectiveBallCount } from "@/lib/teams";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { FRAME_BUDGET_MS, FrameBudget, formatRealTime } from "@/lib/simulation/frameBudget";
import { EFFECT_RENDER_CAP, ateSizeLabel, cappedEffects } from "@/components/simulator/unlimitedRenderer";
import { FINDER_MIN_SEEDS, findSimulationBudgeted, seedsWithinBudget, usesBudgetedSearch } from "@/lib/simulation/unlimitedFinder";
import type { FinderRequest, ModeSettings } from "@/lib/simulation/finder";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams, uncappedEngaged, unlimitedSettingKeys, type SimulatorSettings } from "@/lib/settings";
import { ENTITY_CEILING, MEMORY_CEILINGS, RACER_CEILING } from "@/lib/uncap"; // --- uncap-all ---
import { dropSettingFields } from "@/lib/physics/modes/drop";
import { boxSettingFields } from "@/lib/physics/modes/box";
import { pendulumSettingFields } from "@/lib/physics/modes/pendulum";
import { polyrhythmSettingFields } from "@/lib/physics/modes/polyrhythm";
import { collideSettingFields } from "@/lib/physics/modes/collide";
import { glassSettingFields, stageHp, stageRows } from "@/lib/physics/modes/glass";
import { multipliersSettingFields } from "@/lib/physics/modes/multipliers";
import { doublePendulumSettingFields } from "@/lib/physics/modes/doublePendulum";
import { illusionSettingFields } from "@/lib/physics/modes/illusion";
import { stringBattleSettingFields } from "@/lib/physics/modes/stringBattle";
import { powerLayersSettingFields, powerLayersFixedDurationSec } from "@/lib/physics/modes/powerLayers";
import { runnerSettingFields } from "@/lib/physics/modes/runner";
import { paddleSettingFields } from "@/lib/physics/modes/paddle";
import { vortexSettingFields } from "@/lib/physics/modes/vortex";
import { journeySettingFields } from "@/lib/physics/modes/journey";
import { bullseyeSettingFields, ringScore } from "@/lib/physics/modes/bullseye";
import { territorySettingFields } from "@/lib/physics/modes/territory"; // --- odd-territory ---
import { fixedRunDurationSec } from "@/lib/simulation/finder";
import { MAX_RACERS, RACE_SCREEN_CEILING, resolveRaceTrackSettings } from "@/lib/physics/raceTrack";
import { resolveProjectSettings } from "@/lib/project";
import { decodeShareCode, encodeShareCode, supportsShareCodes } from "@/lib/shareCode";
import {
  BOUNDED_KEYS,
  CROWD_LIMIT,
  SEMANTIC_MAX,
  LIVE_WALL_LIMIT,
  OBJECT_BALL_LIMIT,
  UNLIMITED_SLIDER_CEILING,
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

  it("rejects NaN and Infinity (back to the default) and lifts -5 onto the minimum, with the switch on", () => {
    const d = defaultSettings("classic");
    for (const bad of ["-5", "NaN", "Infinity", "-Infinity", "abc", ""]) {
      const s = settingsFromSearchParams(new URLSearchParams(`mode=classic&inf=1&s=${bad}&r=${bad}&nb=${bad}&wc=${bad}&cpn=${bad}`));
      // --- uncap-all --- the switch no longer gates parsing: a finite number below the minimum is lifted to it, as a link always
      // did (--- review fix (recording-export) --- the core numbers too, through coreNumber()); anything else falls back
      const lifted = bad === "-5";
      expect(s.ballSpeed).toBe(lifted ? ranges.ballSpeed.min : d.ballSpeed);
      expect(s.ballRadius).toBe(lifted ? ranges.ballRadius.min : d.ballRadius);
      expect(s.ballCount).toBe(d.ballCount);
      expect(s.wallCount).toBe(lifted ? ranges.wallCount.min : d.wallCount);
      expect(s.cpCount).toBe(lifted ? ranges.cpCount.min : d.cpCount);
    }
    expect(parseUnlimitedValue("ballSpeed", -5, ranges.ballSpeed)).toBeNull();
    expect(parseUnlimitedValue("ballSpeed", Number.NaN, ranges.ballSpeed)).toBeNull();
    expect(parseUnlimitedValue("ballSpeed", Infinity, ranges.ballSpeed)).toBeNull();
    expect(parseUnlimitedValue("ballRadius", 3, ranges.ballRadius)).toBeNull(); // below the sensible minimum
    expect(parseUnlimitedValue("wallCount", 12.6, ranges.wallCount)).toBe(13); // counts are whole
  });

  // --- review fix (unlimited) x uncap-all --- a big value in a link or preset without `inf=1` keeps the switch off (it is only
  // Wide sliders now): the extreme-values runtime engages by the value itself, so 100,000 rings never hang the tab
  it("runs a link or preset that carries a value past its range with the switch off, and the tab never hangs", () => {
    const link = settingsFromSearchParams(new URLSearchParams("mode=classic&wc=100000"));
    expect([link.unlimited, link.wallCount]).toEqual([false, 100000]);
    expect(settingsToSearchParams(link).get("inf")).toBeNull();
    expect(settingsToSearchParams(link).get("wc")).toBe("100000");
    const engine = createEngineForSettings(physicsConfigOfSettings(link), "classic", modeSettingsOfSettings(link), 3);
    expect(engine.getCircularWalls().length).toBe(LIVE_WALL_LIMIT);
    const start = performance.now();
    engine.update(1000 / 60, 0);
    expect(performance.now() - start).toBeLessThan(1000);
    const preset = presetToSettings({ ...defaultSettings("classic"), unlimited: false, ballSpeed: 1e9 });
    expect([preset.unlimited, preset.ballSpeed]).toEqual([false, 1e9]);
    expect(physicsConfigOfSettings(preset).unlimited).toBe(true); // (engaged by the value, not by the switch)
    expect(resolveProjectSettings({ mode: "classic", wallCount: 5000 })).toMatchObject({ unlimited: false, wallCount: 5000 }); // (a project file keeps it too)
    // Values inside their ranges engage nothing, and a mode setting past its slider reaches its run with the switch off.
    const plain = settingsFromSearchParams(new URLSearchParams("mode=classic&wc=12&s=800"));
    expect(plain.unlimited).toBe(false);
    expect(physicsConfigOfSettings(plain).unlimited).toBeUndefined();
    expect(presetToSettings({ ...defaultSettings("glass"), unlimited: false, glassHp: 1000 })).toMatchObject({ unlimited: false, glassHp: 1000 });
  });

  // --- uncap-all --- the switch no longer gates anything but the slider tracks (Wide sliders)
  it("takes big values whatever the switch (it only widens the sliders now)", () => {
    const off = settingsFromSearchParams(new URLSearchParams("mode=collide&cpn=50000&nb=50000"));
    expect(off.unlimited).toBe(false);
    expect(off.cpCount).toBe(50000);
    expect(off.ballCount).toBe(50000);
    const on = settingsFromSearchParams(new URLSearchParams("mode=collide&inf=1&cpn=50000&nb=50000"));
    expect(on.cpCount).toBe(50000);
    expect(on.ballCount).toBe(50000);
  });

  it("uncaps fractions, volumes and the recording too (--- uncap-all --- no bounded settings left)", () => {
    expect([...BOUNDED_KEYS]).toEqual(["forcedWinner"]); // a team slot past the team colours is invalid, not capped
    expect(unlimitedSettingKeys()).not.toContain("forcedWinner");
    expect(unlimitedSettingKeys()).toContain("rcWinner");
    for (const key of ["gapSize", "musicVolume", "recordingDuration", "fastExportFps", "cameraZoom", "textSize"]) {
      expect(isUnlimitedKey(key, ranges[key])).toBe(true);
      expect(unlimitedSettingKeys()).toContain(key);
    }
    const s = settingsFromSearchParams(new URLSearchParams("mode=classic&mv=50&dur=600&gap=3"));
    expect([s.musicVolume, s.recordingDuration, s.gapSize]).toEqual([50, 600, 3]);
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
    expect(loaded.ballRadius).toBe(ranges.ballRadius.min); // --- review fix (recording-export) --- a negative size is lifted onto the minimum, as in a link
    expect(loaded.gravity).toBe(defaultSettings("classic").gravity);
    // --- uncap-all --- without the switch the preset keeps its values too.
    const off = presetToSettings({ ...preset, unlimited: false });
    expect(off.cpCount).toBe(50_000);
    // A project file: the numbers survive the file's own clamp too.
    const project = resolveProjectSettings({ mode: "classic", unlimited: true, ballSpeed: 1e6, wallCount: 1e5, cpCount: 50_000 });
    expect([project.unlimited, project.ballSpeed, project.wallCount, project.cpCount]).toEqual([true, 1e6, 1e5, 50_000]);
    const plain = resolveProjectSettings({ mode: "classic", cpCount: 50_000 });
    expect(plain.cpCount).toBe(50_000);
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

  it("keeps every value when the switch goes off (--- uncap-all --- it only narrows the slider tracks again)", () => {
    const s = { ...defaultSettings("classic"), unlimited: true, ballSpeed: 1e9, wallCount: 1e5, windX: -1e6 };
    const off = settingsFromSearchParams(settingsToSearchParams({ ...s, unlimited: false }));
    expect([off.unlimited, off.ballSpeed, off.wallCount, off.windX]).toEqual([false, 1e9, 1e5, -1e6]);
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
    // --- uncap-all --- no setting's meaning ends any more: a drag past 1 gets the whole wide track too.
    expect(sliderValue("airDrag", 1000, ranges.airDrag)).toBe(UNLIMITED_SLIDER_CEILING);
  });

  it("formats huge numbers short", () => {
    expect(formatHuge(1e9)).toBe("1B");
    expect(formatHuge(2_500_000)).toBe("2.5M");
    expect(formatHuge(12_345)).toBe("12.3K");
    expect(formatHuge(42)).toBe("42");
    expect(formatHuge(1e21)).toBe("1e21");
    expect(formatRealTime(0.4)).toBe("0.4");
    expect(formatRealTime(0.0123)).toBe("0.01");
  });

  it("knows the memory-safety ceilings the engine builds at (--- uncap-all --- nothing else)", () => {
    expect(softCeiling("wallCount", ranges.wallCount)).toBe(LIVE_WALL_LIMIT);
    expect(softCeiling("ballCount", ranges.ballCount)).toBe(CROWD_LIMIT);
    expect(softCeiling("cpCount", ranges.cpCount)).toBeGreaterThan(RANGES.cpCount.max);
    expect(softCeiling("ballSpeed", ranges.ballSpeed)).toBe(Infinity);
    // A width is drawn as typed – no wider than any canvas, the same picture.
    expect(visualValue(1e3)).toBe(1e3);
    expect(visualValue(1e9)).toBe(1e5);
  });

  it("builds the engine config: the crowd is the ball count past the team balls", () => {
    expect(unlimitedConfigOf({ unlimited: true, ballCount: 50_000 }, 6, true)).toEqual({ unlimited: true, crowdCount: 49_994, memoryFull: false });
    expect(unlimitedConfigOf({ unlimited: true, ballCount: 1e12 }, 6, true).crowdCount).toBe(CROWD_LIMIT);
    expect(unlimitedConfigOf({ unlimited: true, ballCount: 50_000 }, 1, false).crowdCount).toBe(0);
    // --- uncap-all --- a Ball Count past the team balls is a crowd whatever the switch (and engages the runtime)
    expect(unlimitedConfigOf({ unlimited: false, ballCount: 50_000 }, 6, true)).toEqual({ unlimited: true, crowdCount: 49_994, memoryFull: false });
    expect(unlimitedConfigOf({ unlimited: false, ballCount: 3 }, 3, true)).toEqual({ unlimited: false, crowdCount: 0, memoryFull: false });
    expect(unlimitedExtrasOf({ ...config, unlimited: true, wallBounciness: 1e6 })).toEqual({ wallBounciness: 1e6 });
    expect(unlimitedExtrasOf({ ...config, wallBounciness: 1e6 })).toEqual({});
  });
});

describe("No limits: the engine", () => {
  it("runs every value as typed (--- uncap-all --- only the rings stop at their memory-safety ceiling) and lifts the extras past their ranges", () => {
    const engine = engineFor("classic", { wallCount: 1e5, ballSpeed: 1e20, wallBounciness: 1e6, maxBalls: 1e9, windX: -1e6 });
    expect(engine.getCircularWalls().length).toBe(LIVE_WALL_LIMIT);
    expect(engine.config.ballSpeed).toBe(1e20);
    expect(engine.getPhysicsExtras().wallBounciness).toBe(1e6);
    expect(engine.getPhysicsExtras().windX).toBe(-1e6);
    expect(engine.getBallInteraction().maxBalls).toBe(OBJECT_BALL_LIMIT);
    // Switched off the config is taken as it is again (the page clamps the settings first).
    engine.setConfig({ unlimited: false, wallCount: 7 });
    expect(engine.getCircularWalls().length).toBe(7);
  });

  it("a step with 200,000 balls finishes inside the budget through time-slicing, without throwing", () => {
    const engine = engineFor("classic", { crowdCount: 200_000, ballCount: 6 });
    for (let i = 0; i < Math.ceil(200_000 / CROWD_POUR_PER_STEP); i++) engine.update(1000 / 60, 0); // the crowd pours in
    expect(engine.getCrowd().spawned).toBe(200_000);
    expect(engine.getUnlimitedView().crowd).toBeGreaterThan(190_000);
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
    // --- uncap-all --- no restitution cap by default any more
    expect(MAX_EFFECTIVE_BOUNCE).toBe(Infinity);
    expect(effectiveBounce(ball)).toBeCloseTo(1e12, -3);
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
    expect(huge.getUnlimitedView().ateRadius).toBe(1e6); // the banner shows the Ball Size that ate it ("1M px")
    expect(ateSizeLabel(huge.getUnlimitedView().ateRadius)).toBe("1M px");
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
    // A thousand rings: every ball is checked against each of them, so the step gets fewer sub-steps (never below four).
    const ringPlan: StepPlan = { subSteps: 64, dilation: 1 };
    rt.boundPlan(ringPlan, 6, LIVE_WALL_LIMIT);
    expect(ringPlan.subSteps).toBe(Math.max(4, Math.floor(STEP_RING_WORK / (6 * LIVE_WALL_LIMIT))));
    expect(ringPlan.dilation).toBeCloseTo(ringPlan.subSteps / 64, 10);
    const defaultPlan: StepPlan = { subSteps: 64, dilation: 1 };
    rt.boundPlan(defaultPlan, 1, 7);
    expect(defaultPlan).toEqual({ subSteps: 64, dilation: 1 });
    rt.configure({ unlimited: false });
    expect(rt.pairsAllowed(1e6)).toBe(true);
  });

  it("holds fewer full-physics balls the more rings they bounce in (the rest join the crowd)", () => {
    expect(objectLimitFor(0)).toBe(OBJECT_BALL_LIMIT);
    expect(objectLimitFor(7)).toBe(OBJECT_BALL_LIMIT);
    expect(objectLimitFor(100)).toBe(RING_OBJECT_WORK / 100);
    expect(objectLimitFor(LIVE_WALL_LIMIT)).toBe(Math.max(OBJECT_MIN, RING_OBJECT_WORK / LIVE_WALL_LIMIT));
    const engine = engineFor("classic", { wallCount: 1e5 });
    engine.update(1000 / 60, 0);
    const ball = engine.getBalls()[0];
    engine.applyBallMultiplier(ball, "speed", 1.01);
    engine.getMultiplierRuntime().cloneBall(engine.ctx, ball, 500, objectLimitFor(LIVE_WALL_LIMIT));
    expect(engine.getBalls()).toHaveLength(objectLimitFor(LIVE_WALL_LIMIT));
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(engine.getCrowd().spawned).toBe(500 - objectLimitFor(LIVE_WALL_LIMIT));
    expect(allFinite(engine)).toBe(true);
    expect(worst).toBeLessThan(400); // packed rings: one rebound a pass (DENSE_RINGS_FROM), bounded sub-steps
    expect(engine.getCircularWalls().length).toBeGreaterThanOrEqual(DENSE_RINGS_FROM);
    expect(engine.getWallHits().length).toBeLessThanOrEqual(WALL_HITS_KEPT);
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

  // --- review fix (unlimited) --- the gulp is queued after the step's bursts; the cap must never drop it
  it("keeps the ate-the-arena gulp however many rings the ball ate in its step", () => {
    const rt = new UnlimitedRuntime();
    rt.configure({ unlimited: true });
    const events: SoundEvent[] = [];
    for (let i = 0; i < 1000; i++) events.push({ type: "gap", wallIndex: i });
    for (let i = 0; i < 50; i++) events.push({ type: "hit", wallIndex: i % 7 });
    events.push({ type: "gap", wallIndex: 0, ate: true });
    const kept = rt.thinSounds(events);
    expect(kept.length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
    expect(kept.filter((e) => e.ate)).toHaveLength(1);
    expect(kept.filter((e) => e.type === "gap" && !e.ate).length).toBeGreaterThan(0); // the breaks still come before the bounces
    // A ball bigger than the arena eating 7, 50 and LIVE_WALL_LIMIT (100,000 asked) rings in one step: the page and the export hear the gulp.
    for (const wallCount of [7, 50, 1e5]) {
      const engine = engineFor("classic", { wallCount, ballRadius: 1e6 });
      engine.setWallBreakStyle("all");
      engine.update(1000 / 60, 0);
      expect(engine.getUnlimitedView().ate).toBe(true);
      expect([wallCount, engine.consumeSoundEvents().some((e) => e.ate)]).toEqual([wallCount, true]);
    }
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

  it("runs every mode from settings far past every range, through the page's own path (settings → config → engine)", () => {
    // Every unlimited setting at 1e9 (the settings with a meaning that ends at that end): once with a Ball Size bigger than
    // any arena (the ring modes are eaten at once) and once at the default size (a million-ball crowd, a thousand rings…).
    for (const bigBall of [true, false]) {
      for (const mode of MODE_IDS) {
        const preset: Record<string, unknown> = { ...defaultSettings(mode), unlimited: true };
        for (const key of unlimitedSettingKeys()) preset[key] = SEMANTIC_MAX[key] ?? Math.max(ranges[key].max, 1e9);
        if (!bigBall) preset.ballRadius = defaultSettings(mode).ballRadius;
        const s = presetToSettings(preset as Partial<SimulatorSettings>);
        const physics = physicsConfigOfSettings(s); // (the page's config: --- uncap-all --- engaged by the values, the crowd, ARENA FULL)
        expect(physics).toMatchObject(uncapConfigOf(uncappedEngaged(s), s.ballCount, effectiveBallCount(s), MULTI_BALL_MODES.includes(mode), pastAnyMemoryCeiling(s)));
        const engine = createEngineForSettings(physics, mode, modeSettingsOfSettings(s), 3);
        for (let i = 0; i < 8; i++) {
          engine.update(1000 / 60, 0);
          expect(engine.consumeSoundEvents().length).toBeLessThanOrEqual(MAX_SOUNDS_PER_FRAME);
        }
        expect([mode, bigBall, allFinite(engine)]).toEqual([mode, bigBall, true]);
        expect(engine.getCircularWalls().length).toBeLessThanOrEqual(LIVE_WALL_LIMIT);
        expect(engine.getBalls().length).toBeLessThanOrEqual(Math.max(OBJECT_BALL_LIMIT, ENTITY_CEILING)); // --- uncap-all --- (a mode's own entities stop at their memory-safety ceiling)
        expect(engine.getCrowd().count).toBeLessThanOrEqual(CROWD_LIMIT);
      }
    }
  });

  // --- review fix (unlimited) x uncap-all --- every setting reaches the engine past its slider, whatever the switch: min(typed,
  // its memory-safety ceiling)
  it("runs every mode's own settings past their sliders, as typed or at their memory-safety ceilings, through the page's own path", () => {
    /** The engine-side value of every setting a mode's engine (or the run's config) holds, under the settings' names. */
    const engineSide = (engine: ReturnType<typeof createEngineForSettings>): Record<string, number> => {
      const race = engine.getRaceSettings();
      const battle = engine.getBattleSettings();
      const ctf = engine.getCtfSettings();
      const mult = engine.getMultiplierRuntime().getConfig();
      const extras = engine.getPhysicsExtras();
      const editor = (engine as unknown as { editorObstacles: { bumperBoost: number } }).editorObstacles;
      return {
        ...dropSettingFields(engine.getDropSettings()),
        ...boxSettingFields(engine.getBoxSettings()),
        ...pendulumSettingFields(engine.getPendulumSettings()),
        ...polyrhythmSettingFields(engine.getPolyrhythmSettings()),
        ...collideSettingFields(engine.getCollideSettings()),
        ...glassSettingFields(engine.getGlassSettings()),
        ...multipliersSettingFields(engine.getMultipliersSettings()),
        ...doublePendulumSettingFields(engine.getDoublePendulumSettings()),
        ...illusionSettingFields(engine.getIllusionSettings()),
        ...stringBattleSettingFields(engine.getStringBattleSettings()),
        ...powerLayersSettingFields(engine.getPowerLayersSettings()),
        ...runnerSettingFields(engine.getRunnerSettings()),
        ...paddleSettingFields(engine.getPaddleSettings()),
        ...vortexSettingFields(engine.getVortexSettings()),
        ...journeySettingFields(engine.getJourneySettings()),
        ...bullseyeSettingFields(engine.getBullseyeSettings()),
        ...territorySettingFields(engine.getTerritorySettings()), // --- odd-territory ---
        rcRacers: race.racers,
        rcTrackLength: race.trackLength,
        rcLaps: race.laps,
        btCount: battle.count,
        btHp: battle.hp,
        btDamage: battle.damage,
        ctfPerTeam: ctf.perTeam,
        ctfScoreToWin: ctf.scoreToWin,
        mpCap: mult.mpCap,
        wallSmashThreshold: mult.wallSmashThreshold,
        pickupRate: mult.pickupRate,
        pickupLifetime: mult.pickupLifetime,
        bumperBoost: editor.bumperBoost,
        ballSpeed: engine.config.ballSpeed,
        ballRadius: engine.config.ballRadius,
        gravity: engine.config.gravity,
        rotationSpeed: engine.config.rotationSpeed,
        wallCount: engine.config.wallCount,
        windX: extras.windX,
        windY: extras.windY,
        spinStrength: extras.spinStrength,
        wallBounciness: extras.wallBounciness,
        breathingSpeed: extras.breathingSpeed,
        rotatingGravity: extras.rotatingGravity,
        airDrag: extras.airDrag,
        breathingAmplitude: extras.breathingAmplitude,
        splitMinRadius: engine.getBallInteraction().splitMinRadius,
      } as unknown as Record<string, number>;
    };
    // Settings the run takes elsewhere than these, each checked in its own place: the Ball Count (team balls + the crowd,
    // "builds the engine config"), the canvas' thicknesses (`visualValue()`), the counts the page hands the engine's own
    // setters at their ceilings (`ceilValue()`: spikes, Target numbers, Multiply's spawns, Grow, the accumulation timer), the
    // split limit (lowered by the ring count), the paint brush (below).
    const elsewhere = new Set(["ballCount", "wallThickness", "trailThickness", "spikeCount", "targetCount", "multiplySpawnCount", "growRate", "accumulationTime", "maxBalls", "paintBrush"]);
    // (--- uncap-all --- every numeric setting is uncapped now – volumes, the recording, the camera, captions… –; the ones a
    // mode's engine or the run's config holds are walked here, the rest round-trip in tests/uncap.test.ts)
    const fresh = engineSide(new PhysicsEngine({ ...config }));
    const keys = unlimitedSettingKeys().filter((key) => key in fresh);
    expect(keys.length).toBeGreaterThan(90);
    // Settings whose ceiling is shared with another one (the panes of every Glass Smash stage, the bobs of every pendulum chain,
    // the screens of every lap): far past every slider at once they stop where the other one leaves room – checked just past
    // their sliders, and in their own tests.
    const shared = new Set(["glassStages", "dpCount", "rcLaps"]);
    // Two passes: everything typed far past its slider with the Wide sliders switch off (a memory-safety ceiling runs, or the
    // typed value), and just past the slider with it on (the typed value runs) – the switch changes nothing either way.
    for (const far of [true, false]) {
      const seen = new Map<string, number>();
      const typed: Record<string, number> = {};
      for (const key of keys) {
        const r = ranges[key];
        const ceiling = softCeiling(key, r);
        typed[key] = far ? (SEMANTIC_MAX[key] ?? 1e9) : Math.min(ceiling, r.max + 3 * r.step);
      }
      // A mode's own settings reach only its own engine (the others keep their defaults): each key is read from the first
      // engine that holds something other than a fresh engine's default.
      for (const mode of MODE_IDS) {
        const s = presetToSettings({ ...defaultSettings(mode), unlimited: !far, rotationEnabled: true, ...typed } as Partial<SimulatorSettings>);
        expect(s.unlimited).toBe(!far);
        const engine = createEngineForSettings(physicsConfigOfSettings(s), mode, modeSettingsOfSettings(s), 3);
        const values = engineSide(engine);
        for (const key of keys) if (!elsewhere.has(key) && key in values && values[key] !== fresh[key] && !seen.has(key)) seen.set(key, values[key]);
      }
      for (const key of keys) {
        if (elsewhere.has(key) || (far && shared.has(key))) continue;
        const r = ranges[key];
        const want = Math.min(typed[key], softCeiling(key, r));
        expect([key, far, seen.get(key)], `${key} runs ${seen.get(key)}, want ${want}`).toEqual([key, far, expect.closeTo(want, 6)]);
      }
    }
    // Every ceiling lies past its slider – but the race's racers: its per-racer state and its roster are sized for the slider's
    // 16 (RACER_CEILING = MAX_RACERS), so a grid past it builds 16 and says ARENA FULL.
    const atSliderEnd = new Set(["rcRacers"]);
    atSliderEnd.add("tyTeams"); // --- odd-territory --- (Territory's teams: halves or quadrants, the per-team state sized for four)
    for (const key of keys) expect([key, softCeiling(key, ranges[key]) > ranges[key].max]).toEqual([key, !atSliderEnd.has(key)]);
    expect([RACER_CEILING, MEMORY_CEILINGS.rcRacers, RANGES.rcRacers.max]).toEqual([MAX_RACERS, MAX_RACERS, MAX_RACERS]);
    const bigGrid = settingsFromSearchParams(new URLSearchParams("mode=race&rcn=40"));
    expect([bigGrid.rcRacers, pastAnyMemoryCeiling(bigGrid)]).toEqual([40, true]);
    const grid = createEngineForSettings(physicsConfigOfSettings(bigGrid), "race", modeSettingsOfSettings(bigGrid), 3);
    expect([grid.getRaceSettings().racers, grid.getRaceView().racers, grid.getBalls().length]).toEqual([MAX_RACERS, MAX_RACERS, MAX_RACERS]);
    expect(allFinite(grid)).toBe(true);
    expect(softCeiling("glassHp", ranges.glassHp)).toBe(Infinity); // (hit points allocate nothing)
    // The values do what they say: a thousand panes a stage of a billion hit points, power layers by the thousand, long races.
    expect(stageRows(500, 3)).toBe(500);
    expect(stageHp(1e9, 4)).toBe(1e9);
    expect(stageRows(12, 9)).toBe(30); // (the slider's run is unchanged)
    const glassLink = settingsFromSearchParams(new URLSearchParams("mode=glass&glhp=1000&glr=40"));
    const glass = createEngineForSettings(physicsConfigOfSettings(glassLink), "glass", modeSettingsOfSettings(glassLink), 3);
    expect(glass.getGlassView().settings.hp).toBe(1000);
    expect(glass.getGlassView().level!.panes[0].maxHp).toBe(1000);
    expect(glass.getGlassView().level!.stages[0].rows).toBe(40);
    // Power Layers: 4,000 layers run as typed, 100,000 at the layers' memory-safety ceiling (the link keeps the typed value),
    // and the finder plans the run the engine plays: its fixed length from the settings as the engine resolves them.
    for (const [asked, runs] of [[4000, 4000], [100_000, MEMORY_CEILINGS.plLayers]]) {
      const pl = settingsFromSearchParams(new URLSearchParams(`mode=powerLayers&pll=${asked}`));
      expect(pl.plLayers).toBe(asked);
      const plEngine = createEngineForSettings(physicsConfigOfSettings(pl), "powerLayers", modeSettingsOfSettings(pl), 3);
      expect(plEngine.getPowerLayersView().layers).toBe(runs);
      expect(fixedRunDurationSec("powerLayers", modeSettingsOfSettings(pl))).toBe(powerLayersFixedDurationSec({ layers: runs }));
    }
    // The race track follows the settings past their sliders: 30 screens, 7 laps – every lap's rows together at most the
    // track's ceiling of screens.
    const longRace = settingsFromSearchParams(new URLSearchParams("mode=race&rcl=30&rclp=7"));
    const raceEngine = createEngineForSettings(physicsConfigOfSettings(longRace), "race", modeSettingsOfSettings(longRace), 3);
    expect(raceEngine.getRaceSettings()).toMatchObject({ trackLength: 30, laps: 7 });
    expect(raceEngine.getRaceView().track!.laps).toBe(7);
    expect(resolveRaceTrackSettings({ trackLength: 1e9, laps: 1e9 })).toMatchObject({ trackLength: MEMORY_CEILINGS.rcTrackLength, laps: 1 });
    expect(resolveRaceTrackSettings({ trackLength: 50, laps: 1e9 }).laps).toBe(RACE_SCREEN_CEILING / 50);
    // The brush of Picture Paint: past its slider as typed, and the run paints on.
    const paint = engineFor("paint");
    paint.setPaintOptions({ brush: 50 });
    expect(paint.getPaintOptions().brush).toBe(50);
    paint.setPaintOptions({ brush: 1e12 });
    expect(paint.getPaintOptions().brush).toBe(1e12);
    for (let i = 0; i < 10; i++) paint.update(1000 / 60, 0);
    expect(allFinite(paint)).toBe(true);
  });

  // --- unlimited --- String Battle past the slider's MAX_TEAMS: every slot keeps its kill record (a typed array never grows)
  // (--- uncap-all --- with the Wide sliders switch off: the limits are gone either way)
  it("credits every String Battle elimination to its killer with more balls than the slider's six", () => {
    const s = presetToSettings({ ...defaultSettings("stringBattle"), unlimited: false, sbBalls: 20, sbLives: 1 } as Partial<SimulatorSettings>);
    const engine = createEngineForSettings(physicsConfigOfSettings(s), "stringBattle", modeSettingsOfSettings(s), 5);
    const view = engine.getStringBattleView();
    for (let i = 0; i < 60 * 120 && !view.finished; i++) engine.update(1000 / 60, 0);
    expect(view.count).toBe(20);
    expect(view.finished).toBe(true);
    const eliminated = view.fighters.filter((f) => !f.alive).length;
    expect(eliminated).toBe(19);
    // Seed 5's battle: every ball cut down by another one, slots past the sixth included.
    expect(view.fighters.reduce((sum, f) => sum + f.kills, 0)).toBe(eliminated);
    expect(view.fighters.slice(6).some((f) => f.kills > 0)).toBe(true);
  });

  // --- review fix (unlimited) x uncap-all --- Bullseye past the slider's 30 shots and 10 rings: the arrays grow before the
  // seed's draws, so a fresh engine's first run (the finder's) and a restart (the page's) play the same run
  it("grows Bullseye's arrays before the seed's draws: past the slider a fresh engine and a restart play the same run", () => {
    const s = presetToSettings({ ...defaultSettings("bullseye"), unlimited: false, byShots: 40, byRings: 200, byInterval: 0.3 } as Partial<SimulatorSettings>);
    const engine = createEngineForSettings(physicsConfigOfSettings(s), "bullseye", modeSettingsOfSettings(s), 9);
    const play = () => {
      for (let i = 0; i < 60 * 20; i++) engine.update(1000 / 60, 0);
      const v = engine.getBullseyeView();
      return { launched: v.launched, landed: v.landed, total: v.total, x: Array.from(v.shotX), rings: Array.from(v.shotRing), scores: Array.from(v.shotScore) };
    };
    const first = play();
    engine.setSeed(9);
    engine.initMode("bullseye");
    const again = play();
    expect(first.launched).toBe(40);
    expect(first.x).toHaveLength(40);
    expect(again).toEqual(first);
    // Every landing's score is its ring's (no ring index wrapped round a narrow typed array).
    for (let k = 0; k < 40; k++) if (first.rings[k] >= 0) expect(first.scores[k]).toBe(ringScore(first.rings[k], 200));
  });

  it("fits a ball into a thousand rings in one quick pass, exactly as the multipliers' ring fit does", () => {
    // The sorted walk gives the same bursts, in the same order, as fitBallToRings() on rings of distinct radii.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 40);
      const radii = new Set<number>();
      while (radii.size < n) radii.add(Math.round(20 + rand() * 600));
      const walls = [...radii].map((radius) => ({ radius, gaps: [] }));
      const broken = new Set<number>();
      for (let w = 0; w < n; w++) if (rand() < 0.2) broken.add(w);
      const dist = rand() * 650;
      const radius = 31 + rand() * rand() * 700;
      const order = walls.map((_, w) => w).sort((a, b) => walls[a].radius - walls[b].radius);
      const a: RingFit = { burst: [], outgrown: false, dist: 0 };
      const b: RingFit = { burst: [], outgrown: false, dist: 0 };
      fitBallToRings(dist, radius, walls, broken, 30, a);
      fitIntoSortedRings(dist, radius, walls, order, n, broken, 30, b);
      expect(b).toEqual(a);
    }
    // A ball bigger than a thousand rings: every ring but the arena bursts (the first few with their effect) and the arena is eaten.
    const engine = engineFor("classic", { wallCount: 1e5, ballRadius: 1e6 });
    engine.setWallBreakStyle("all");
    const start = performance.now();
    engine.update(1000 / 60, 0);
    const took = performance.now() - start;
    expect(engine.getUnlimitedView().ate).toBe(true);
    expect(engine.getBrokenWalls().size).toBe(LIVE_WALL_LIMIT - 1);
    expect(engine.getShockwaves().length).toBeLessThanOrEqual(BREAK_EFFECTS_PER_STEP);
    expect(took).toBeLessThan(250);
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

  it("draws at most the newest few wall-break effects with the switch on (a render cap, not a simulation cap)", () => {
    const waves = Array.from({ length: 1000 }, (_, i) => i);
    expect(cappedEffects(waves, { on: true })).toEqual(waves.slice(1000 - EFFECT_RENDER_CAP));
    expect(cappedEffects(waves, { on: false })).toBe(waves);
    const few = [1, 2, 3];
    expect(cappedEffects(few, { on: true })).toBe(few);
  });
});

describe("No limits: the crowd pours in and clone storms overflow into it", () => {
  it("pours a big crowd in over whole steps, the same way for a seed", () => {
    const pour = () => {
      const engine = engineFor("classic", { crowdCount: 120_000, rotationSpeed: 0 }, 9);
      const counts: number[] = [];
      for (let i = 0; i < 4; i++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        counts.push(engine.getCrowd().spawned);
      }
      const crowd = engine.getCrowd();
      return { counts, sample: [crowd.x[0], crowd.y[0], crowd.vx[60_000], crowd.vy[119_999], crowd.color[50_001]] };
    };
    const a = pour();
    expect(a.counts).toEqual([CROWD_POUR_PER_STEP, 2 * CROWD_POUR_PER_STEP, 120_000, 120_000]);
    expect(pour()).toEqual(a);
  });

  it("x2 BALLS clones go past the split limit and, past the full-physics balls, join the crowd", () => {
    const engine = engineFor("classic");
    engine.update(1000 / 60, 0); // the run has started (its first step sets the crowd up)
    const ball = engine.getBalls()[0];
    engine.applyBallMultiplier(ball, "speed", 2);
    const runtime = engine.getMultiplierRuntime();
    runtime.cloneBall(engine.ctx, ball, OBJECT_BALL_LIMIT + 500, OBJECT_BALL_LIMIT);
    expect(engine.getBalls()).toHaveLength(OBJECT_BALL_LIMIT);
    engine.update(1000 / 60, 0);
    expect(engine.getCrowd().spawned).toBeGreaterThanOrEqual(500);
    expect(allFinite(engine)).toBe(true);
    // Without the switch a clone past the limit is simply not made.
    const off = new PhysicsEngine({ ...config });
    off.setSeed(7);
    off.initMode("classic");
    const offBall = off.getBalls()[0];
    off.applyBallMultiplier(offBall, "speed", 2);
    off.getMultiplierRuntime().cloneBall(off.ctx, offBall, 50, 16);
    expect(off.getBalls()).toHaveLength(16);
    expect(off.getCrowd().count).toBe(0);
  });

  it("says ARENA FULL when a mode refuses a clone at its limit with the switch on only", () => {
    const rt = new UnlimitedRuntime();
    rt.configure({ unlimited: false });
    rt.noteFull();
    expect(rt.getView(0).full).toBe(false);
    rt.configure({ unlimited: true });
    rt.noteFull();
    expect(rt.getView(0).full).toBe(true);
    rt.reset();
    expect(rt.getView(0).full).toBe(false);
    expect(rt.cloneLimit(16)).toBe(OBJECT_BALL_LIMIT);
    rt.configure({ unlimited: false });
    expect(rt.cloneLimit(16)).toBe(16);
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
