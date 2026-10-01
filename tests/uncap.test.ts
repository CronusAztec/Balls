import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { CORE_COMFORT, MAX_SAFE_SPEED, coreBeyondComfort, uncapConfigOf } from "@/lib/physics/limits";
import { MAX_EFFECTIVE_BOUNCE, MULTIPLIER_CEILING } from "@/lib/physics/multipliers";
import { ENGINE_CEILINGS, LIVE_WALL_LIMIT, CROWD_LIMIT } from "@/lib/unlimited";
import {
  BOUNCIER_ON,
  CROWD_BALL_CEILING,
  IDLE_FIELD,
  INDEX_KEYS,
  LIST_CEILING_KEYS,
  MEMORY_CEILINGS,
  RING_CEILING,
  bouncierIncrementOf,
  checkTypedNumber,
  fieldDisplay,
  formatCompact,
  memoryCeiling,
  numberFieldReduce,
  parseTypedNumber,
  stepNumber,
  type NumberFieldState,
} from "@/lib/uncap";
import {
  RANGES,
  defaultSettings,
  engineSettingKeys,
  numericUrlKeyFields,
  pastAnyMemoryCeiling,
  presetToSettings,
  settingsFromSearchParams,
  settingsToSearchParams,
  uncappedEngaged,
  unlimitedSettingKeys,
  type SimulatorSettings,
} from "@/lib/settings";
import { buildProject, resolveProjectSettings, serializeProject } from "@/lib/project";
import { decodeShareCode, encodeShareCode } from "@/lib/shareCode";
import { createEngineForSettings, findSimulation, neverEndsHorizonSec, type FinderRequest } from "@/lib/simulation/finder";
import { findSimulationBudgeted } from "@/lib/simulation/unlimitedFinder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { glassGravity } from "@/lib/physics/modes/glass";
import { journeyGravity } from "@/lib/physics/modes/journey";
import { raceGravityFactor, raceTempo } from "@/lib/physics/modes/race";
import { runnerGravityFactor, runnerPhysics } from "@/lib/physics/modes/runner";
import { paddleBallFits, paddleBallRadius, paddleGravityFactor } from "@/lib/physics/modes/paddle";
import { battleSquareHalf, battleSquaresFit } from "@/lib/physics/modes/battle";
import { ctfSquareHalf, ctfSquaresFit } from "@/lib/physics/modes/ctf";
import { buildArenaField } from "@/lib/physics/modes/arenaGames";
import { COLOR_MATCH_COLORS, colorMatchColor } from "@/lib/physics/modes/colorMatch";
import { shakeAmplitude, slowMoTimeScale } from "@/lib/simulation/camera";
import { OnBeatController } from "@/lib/physics/onBeat";
import { gridStepSeconds } from "@/lib/audio/scales";
import { HitSampler } from "@/lib/audio/sampler";

// Whole runs of the engine at extreme values: generous timeouts, so a busy machine does not fail them.
vi.setConfig({ testTimeout: 120_000 });

const ranges = RANGES as unknown as Record<string, { min: number; max: number; step: number }>;

/* ------------------------------------------------------------------ the number field */

describe("uncap-all: the number field", () => {
  it("reads what people type: exponents, decimal commas, grouping and the HUD's short forms", () => {
    expect(parseTypedNumber("1e6")).toBe(1e6);
    expect(parseTypedNumber("1.5e-3")).toBe(0.0015);
    expect(parseTypedNumber("  -4 ")).toBe(-4);
    expect(parseTypedNumber(".5")).toBe(0.5);
    expect(parseTypedNumber("1,5")).toBe(1.5);
    expect(parseTypedNumber("1 000 000")).toBe(1e6);
    expect(parseTypedNumber("1_000_000")).toBe(1e6);
    expect(parseTypedNumber("1,000,000")).toBe(1e6);
    expect(parseTypedNumber("2.5k")).toBe(2500);
    expect(parseTypedNumber("1.2M")).toBe(1_200_000);
    expect(parseTypedNumber("3B")).toBe(3e9);
    expect(parseTypedNumber("1e308")).toBe(1e308);
    expect(parseTypedNumber("abc")).toBeNull();
    expect(parseTypedNumber("1.2.3")).toBeNull();
    expect(parseTypedNumber("")).toBeNull();
    expect(parseTypedNumber("∞")).toBe(Infinity);
  });

  it("refuses only invalid values – never a big one", () => {
    const rules = { min: 50 };
    expect(checkTypedNumber("1e12", rules)).toEqual({ ok: true, value: 1e12 });
    expect(checkTypedNumber("1e308", rules)).toEqual({ ok: true, value: 1e308 });
    expect(checkTypedNumber("49", rules)).toEqual({ ok: false, reason: "belowMin", min: 50 });
    expect(checkTypedNumber("-5", rules)).toMatchObject({ ok: false, reason: "belowMin" });
    expect(checkTypedNumber("1e309", rules)).toEqual({ ok: false, reason: "notFinite" });
    expect(checkTypedNumber("Infinity", rules)).toEqual({ ok: false, reason: "notFinite" });
    expect(checkTypedNumber("NaN", rules)).toEqual({ ok: false, reason: "notNumber" });
    expect(checkTypedNumber("wat", rules)).toEqual({ ok: false, reason: "notNumber" });
    expect(checkTypedNumber("   ", rules)).toEqual({ ok: false, reason: "empty" });
    expect(checkTypedNumber("12.6", { min: 1, integer: true })).toEqual({ ok: true, value: 13 });
    // A signed setting has no minimum.
    expect(checkTypedNumber("-1e9", {})).toEqual({ ok: true, value: -1e9 });
  });

  it("commits on Enter and on blur, not while typing; invalid text keeps the old value and says why", () => {
    const range = ranges.ballSpeed;
    const rules = { min: range.min };
    let state: NumberFieldState = IDLE_FIELD;
    let step = numberFieldReduce(state, { type: "type", text: "8" }, 400, range, rules);
    expect(step.commit).toBeUndefined();
    state = step.state;
    step = numberFieldReduce(state, { type: "type", text: "80000" }, 400, range, rules);
    expect(step.commit).toBeUndefined();
    step = numberFieldReduce(step.state, { type: "commit" }, 400, range, rules);
    expect(step.commit).toBe(80000);
    expect(step.state).toEqual(IDLE_FIELD);
    // Invalid on Enter: nothing committed, the draft stays with the reason.
    step = numberFieldReduce(numberFieldReduce(IDLE_FIELD, { type: "type", text: "fast" }, 400, range, rules).state, { type: "commit" }, 400, range, rules);
    expect(step.commit).toBeUndefined();
    expect(step.state.draft).toBe("fast");
    expect(step.state.error).toMatchObject({ reason: "notNumber", text: "fast" });
    // Invalid on blur: the field shows the value again, the reason stays until the next edit.
    step = numberFieldReduce(numberFieldReduce(IDLE_FIELD, { type: "type", text: "10" }, 400, range, rules).state, { type: "blur" }, 400, range, rules);
    expect(step.commit).toBeUndefined();
    expect(step.state.draft).toBeNull();
    expect(step.state.error).toMatchObject({ reason: "belowMin", min: 50 });
    expect(numberFieldReduce(step.state, { type: "type", text: "9" }, 400, range, rules).state.error).toBeNull();
    // A valid draft commits on blur; Escape drops a draft.
    expect(numberFieldReduce({ draft: "2.5M", error: null }, { type: "blur" }, 400, range, rules).commit).toBe(2_500_000);
    expect(numberFieldReduce({ draft: "2.5M", error: null }, { type: "cancel" }, 400, range, rules)).toEqual({ state: IDLE_FIELD });
  });

  // --- review fix (uncap-all) --- the optional variant (bounce math's min / max): an emptied field clears the value
  it("clears an optional value left empty, and refuses an empty required one", () => {
    const range = { min: 0, max: 10, step: 0.1 };
    const emptied = { draft: "  ", error: null };
    expect(numberFieldReduce(emptied, { type: "commit" }, 4, range, { optional: true })).toEqual({ state: IDLE_FIELD, clear: true });
    expect(numberFieldReduce(emptied, { type: "blur" }, 4, range, { optional: true })).toEqual({ state: IDLE_FIELD, clear: true });
    const required = numberFieldReduce(emptied, { type: "commit" }, 4, range, {});
    expect(required.clear).toBeUndefined();
    expect(required.commit).toBeUndefined();
    expect(required.state.error).toMatchObject({ reason: "empty" });
    // An optional field still takes any number (no minimum, no maximum), and steps from the range's start without a value.
    expect(numberFieldReduce({ draft: "-1e9", error: null }, { type: "commit" }, Number.NaN, range, { optional: true }).commit).toBe(-1e9);
    expect(numberFieldReduce(IDLE_FIELD, { type: "step", direction: 1 }, Number.NaN, range, { optional: true }).commit).toBe(0.1);
  });

  it("steps with the arrow keys: the slider step in the range, a tenth of the value's size beyond it", () => {
    const range = ranges.ballSpeed; // 50–800 by 10
    const rules = { min: range.min };
    expect(numberFieldReduce(IDLE_FIELD, { type: "step", direction: 1 }, 400, range, rules).commit).toBe(410);
    expect(numberFieldReduce(IDLE_FIELD, { type: "step", direction: -1, modifier: "coarse" }, 400, range, rules).commit).toBe(300);
    expect(numberFieldReduce(IDLE_FIELD, { type: "step", direction: 1 }, 1_000_000, range, rules).commit).toBe(1_100_000);
    expect(numberFieldReduce(IDLE_FIELD, { type: "step", direction: -1 }, 50, range, rules).commit).toBe(50); // never below the minimum
    // A valid draft is stepped from its own value.
    expect(numberFieldReduce({ draft: "5000", error: null }, { type: "step", direction: 1 }, 400, range, rules).commit).toBe(5100);
    expect(stepNumber(0.3, 1, ranges.airDrag, { min: 0 })).toBe(0.31);
    expect(stepNumber(7, 1, ranges.wallCount, { min: 1, integer: true }, "fine")).toBe(8);
  });

  it("shows a value beyond the slider exactly, flagged, with a short form for readouts", () => {
    expect(fieldDisplay(80_000, ranges.ballSpeed)).toEqual({ text: "80000", beyond: true, compact: "80K" });
    expect(fieldDisplay(400, ranges.ballSpeed)).toEqual({ text: "400", beyond: false, compact: "400" });
    expect(fieldDisplay(1e21, ranges.ballSpeed).text).toBe("1e21");
    expect(fieldDisplay(-3, ranges.windX)).toMatchObject({ beyond: true, text: "-3" });
    expect(formatCompact(1_234_567)).toBe("1.23M");
    expect(formatCompact(1_200_000)).toBe("1.2M");
    expect(formatCompact(12_345)).toBe("12.3K");
    expect(formatCompact(1e21)).toBe("1e21");
    expect(formatCompact(0.00005)).toBe("5e-5");
    expect(formatCompact(Infinity)).toBe("∞");
  });
});

/* ------------------------------------------------------------------ settings: no maximum anywhere */

/** A value `factor` times a setting's slider maximum (whole for whole-number settings). */
function beyond(key: string, factor: number): number {
  const r = ranges[key];
  const v = r.max * factor;
  return r.step === 1 && Number.isInteger(r.min) ? Math.round(v) : v;
}

/** Every uncapped setting and every core URL key's setting, at `factor` × its slider maximum. */
function farSettings(factor: number): { settings: SimulatorSettings; want: Record<string, number> } {
  const s = { ...defaultSettings("classic") } as unknown as Record<string, unknown>;
  const want: Record<string, number> = {};
  const keys = new Set([...unlimitedSettingKeys(), ...Object.values(numericUrlKeyFields())]);
  for (const key of keys) {
    if (!ranges[key] || typeof s[key] !== "number" || INDEX_KEYS.has(key)) continue; // a list index past its list is invalid (tested below)
    want[key] = beyond(key, factor);
    s[key] = want[key];
  }
  return { settings: s as unknown as SimulatorSettings, want };
}

function mismatches(got: SimulatorSettings, want: Record<string, number>): string[] {
  const record = got as unknown as Record<string, unknown>;
  return Object.keys(want).filter((key) => record[key] !== want[key]).map((key) => `${key}: ${String(record[key])} ≠ ${want[key]}`);
}

describe("uncap-all: every value past its slider travels exactly", () => {
  it("covers every setting with a range and every core URL key", () => {
    const { want } = farSettings(10);
    for (const field of Object.values(numericUrlKeyFields())) if (!INDEX_KEYS.has(field)) expect(Object.keys(want)).toContain(field);
    expect(Object.keys(want).length).toBeGreaterThan(150);
  });

  it("rejects a list index past its list (the forced winner's team slot) instead of keeping it", () => {
    expect([...INDEX_KEYS]).toEqual(["forcedWinner"]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=shatter&fw=50")).forcedWinner).toBe(-1);
    expect(presetToSettings({ mode: "shatter", forcedWinner: 5000 }).forcedWinner).toBe(-1);
    // The race's staged winner is a racer on a grid without a maximum: any racer may win.
    expect(settingsFromSearchParams(new URLSearchParams("mode=race&rcn=40&rcw=30")).rcWinner).toBe(30);
  });

  it("keeps a valid list index through project files, presets and links (the Rigged forced winner's team slot)", () => {
    // --- review fix (uncap-all) --- a project file lifted every list index onto its minimum (-1, off): a rigged file lost its winner
    const settings: SimulatorSettings = { ...defaultSettings("shatter"), ballCount: 3, forcedWinner: 2 };
    const file = JSON.parse(serializeProject(buildProject({ name: "rigged", settings })));
    expect(file.settings.forcedWinner).toBe(2);
    expect(resolveProjectSettings(file.settings).forcedWinner).toBe(2);
    expect(presetToSettings(JSON.parse(JSON.stringify(settings))).forcedWinner).toBe(2);
    expect(settingsFromSearchParams(settingsToSearchParams(settings)).forcedWinner).toBe(2);
    for (const slot of [0, 1, 2]) expect(resolveProjectSettings({ ...file.settings, forcedWinner: slot }).forcedWinner).toBe(slot);
    // A slot past the team list, below the minimum or not a whole number is still invalid in a file: off.
    for (const bad of [5000, 6, -7, 1.5]) expect([bad, resolveProjectSettings({ ...file.settings, forcedWinner: bad }).forcedWinner]).toEqual([bad, -1]);
  });

  for (const factor of [10, 1000, 1e9]) {
    it(`round-trips ${factor}× the slider maximum through links, presets, project files and share codes`, async () => {
      const { settings, want } = farSettings(factor);
      const params = settingsToSearchParams(settings);
      expect(mismatches(settingsFromSearchParams(params), want)).toEqual([]);
      expect(mismatches(presetToSettings(JSON.parse(JSON.stringify(settings))), want)).toEqual([]);
      const file = JSON.parse(serializeProject(buildProject({ name: "far", settings })));
      expect(mismatches(resolveProjectSettings(file.settings), want)).toEqual([]);
      const code = await encodeShareCode(params);
      expect(code).toBeTruthy();
      const decoded = await decodeShareCode(code!);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(mismatches(settingsFromSearchParams(decoded.params), want)).toEqual([]);
    });
  }

  it("keeps a typed decimal exactly (no three-decimal rounding in the link)", () => {
    const s = { ...defaultSettings("classic"), ballSpeed: 1234.56789, gravity: 0.000123, windX: -7.25 };
    const back = settingsFromSearchParams(settingsToSearchParams(s));
    expect([back.ballSpeed, back.gravity, back.windX]).toEqual([1234.56789, 0.000123, -7.25]);
  });

  it("rejects only invalid values: NaN, ±Infinity, text – back to the default; a number below the minimum is lifted onto it", () => {
    const d = defaultSettings("classic");
    for (const bad of ["NaN", "Infinity", "-Infinity", "abc", "1e999"]) {
      const s = settingsFromSearchParams(new URLSearchParams(`mode=classic&s=${bad}&r=${bad}&wc=${bad}&g=${bad}`));
      expect([s.ballSpeed, s.ballRadius, s.wallCount]).toEqual([d.ballSpeed, d.ballRadius, d.wallCount]);
    }
    // --- uncap-all x review fix (recording-export) --- a finite number below the minimum is lifted onto it by the setting's
    // own reader – the core numbers' coreNumber() as every feature's – never a maximum
    const low = settingsFromSearchParams(new URLSearchParams("mode=classic&s=-5&r=-5&wc=-5&g=-1"));
    expect([low.ballSpeed, low.ballRadius, low.wallCount, low.gravity]).toEqual([RANGES.ballSpeed.min, RANGES.ballRadius.min, RANGES.wallCount.min, RANGES.gravity.min]);
    // Signed settings go past both ends.
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&wx=-1000")).windX).toBe(-1000);
  });

  it("changes nothing at the defaults: the default link stays empty and nothing is engaged", () => {
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect([mode, settingsToSearchParams(d).get("infx"), settingsToSearchParams(d).get("bnc")]).toEqual([mode, null, null]);
      expect([mode, uncappedEngaged(d), pastAnyMemoryCeiling(d)]).toEqual([mode, false, false]);
    }
    expect(uncappedEngaged({ ...defaultSettings("classic"), ballSpeed: 801 })).toBe(true);
    expect(uncappedEngaged({ ...defaultSettings("classic"), windX: -0.6 })).toBe(true);
    expect(pastAnyMemoryCeiling({ ...defaultSettings("classic"), wallCount: 1e9 })).toBe(true);
  });
});

/* ------------------------------------------------------------------ Bounciness */

describe("uncap-all: Bounciness (the uncapped Bouncier)", () => {
  it("reads the old switch as 1.03 and any number from 1 up", () => {
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&bounce=1"))).toMatchObject({ bounciness: BOUNCIER_ON, bouncierEnabled: true });
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&bounce=0"))).toMatchObject({ bounciness: 1, bouncierEnabled: false });
    for (const v of [1.5, 3, 100, 1e6]) {
      const s = settingsFromSearchParams(new URLSearchParams(`mode=classic&bnc=${v}`));
      expect([s.bounciness, s.bouncierEnabled]).toEqual([v, true]);
      expect(settingsFromSearchParams(settingsToSearchParams(s)).bounciness).toBe(v);
      expect(presetToSettings(JSON.parse(JSON.stringify(s))).bounciness).toBe(v);
    }
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&bnc=0.5")).bounciness).toBe(1);
    expect(presetToSettings({ mode: "classic", bouncierEnabled: true } as Partial<SimulatorSettings>).bounciness).toBe(BOUNCIER_ON);
    expect(presetToSettings({ mode: "classic", bouncierEnabled: false } as Partial<SimulatorSettings>).bounciness).toBe(1);
    expect(bouncierIncrementOf(3)).toBe(2);
    expect(bouncierIncrementOf(1)).toBe(0);
  });

  const sealed: PhysicsConfig = { width: 800, height: 600, gravity: 0, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 1, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

  /** A Lines run (one sealed ring, no gap), Bounciness `b`, sampled every second: the rebound multiplier and the ball's speed. */
  function bouncyRun(b: number, seconds: number, seed = 11) {
    const engine = new PhysicsEngine({ ...sealed });
    engine.setCinematicEnabled(false);
    engine.setSeed(seed);
    engine.initMode("lines");
    engine.setBounciness(b);
    const samples: { mult: number; speed: number; inside: boolean }[] = [];
    const ring = engine.getCircularWalls()[0].radius;
    let inside = true;
    for (let step = 1; step <= seconds * 60; step++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      const ball = engine.getBalls()[0];
      if (Math.hypot(ball.x - 400, ball.y - 300) > ring) inside = false;
      if (step % 60 === 0) samples.push({ mult: engine.getBounceSpeedMultiplier(), speed: Math.hypot(ball.vx, ball.vy), inside });
    }
    const ball = engine.getBalls()[0];
    return { samples, end: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, mult: engine.getBounceSpeedMultiplier() } };
  }

  it("a Bounciness-3 ball gets faster on every bounce for 60 s with no ceiling, inside its ring, the same for a seed", () => {
    const run = bouncyRun(3, 60);
    // Every second the rebounds grew (bounces keep coming at any speed: the steps are planned, the run slows instead).
    for (let i = 1; i < run.samples.length; i++) expect([i, run.samples[i].mult > run.samples[i - 1].mult]).toEqual([i, true]);
    // Past the old Bouncier's ×3 within the first seconds, and far past it – with the speed each rebound gives (no clamp).
    expect(run.samples[4].mult).toBeGreaterThan(3);
    const last = run.samples[run.samples.length - 1];
    expect(last.mult).toBeGreaterThan(100);
    expect(last.speed).toBeGreaterThan(400 * 3 * 30);
    expect(last.speed).toBeCloseTo(400 * last.mult, -1);
    expect(run.samples.every((s) => s.inside)).toBe(true);
    // Deterministic replay.
    expect(bouncyRun(3, 60).end).toEqual(run.end);
  });

  it("keeps the old Bouncier's run exactly up to its ×3, and goes on past it", () => {
    const run = bouncyRun(BOUNCIER_ON, 30);
    expect(run.samples[run.samples.length - 1].mult).toBeGreaterThan(1);
    const early = bouncyRun(BOUNCIER_ON, 5);
    // The same seed and value play the same whatever the run length asked for.
    expect(early.samples.map((s) => s.mult)).toEqual(run.samples.slice(0, 5).map((s) => s.mult));
  });
});

/* ------------------------------------------------------------------ the engine: no speed ceiling, no tunnelling */

describe("uncap-all: the engine at extreme speeds", () => {
  const base: PhysicsConfig = { width: 800, height: 600, gravity: 0, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 1, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

  it("never lets a ball leave a sealed ring, at 1e6, 1e12 or 1e100 px/s", () => {
    for (const speed of [1e6, 1e12, 1e100]) {
      const engine = new PhysicsEngine({ ...base, ballSpeed: speed });
      engine.setCinematicEnabled(false);
      engine.setSeed(5);
      engine.initMode("lines");
      expect(engine.getUnlimitedView().on).toBe(true);
      const ring = engine.getCircularWalls()[0].radius;
      let worst = 0;
      let top = 0;
      for (let i = 0; i < 300; i++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        for (const b of engine.getBalls()) {
          worst = Math.max(worst, Math.hypot(b.x - 400, b.y - 300));
          top = Math.max(top, Math.hypot(b.vx, b.vy));
        }
      }
      expect([speed, worst <= ring]).toEqual([speed, true]);
      // No speed ceiling: the ball keeps the speed it was given.
      expect(top).toBeGreaterThanOrEqual(speed * 0.999);
    }
  });

  it("has no speed, size, restitution or multiplier ceiling left – only memory-safety ones", () => {
    expect(MAX_SAFE_SPEED).toBe(Number.MAX_VALUE);
    expect(MAX_EFFECTIVE_BOUNCE).toBe(Infinity);
    expect(MULTIPLIER_CEILING).toBe(Number.MAX_VALUE);
    expect(ENGINE_CEILINGS).toBe(MEMORY_CEILINGS);
    for (const key of ["ballSpeed", "ballRadius", "gravity", "rotationSpeed", "wallThickness", "trailThickness", "growRate", "spinStrength", "wallBounciness", "airDrag", "breathingAmplitude"]) expect(ENGINE_CEILINGS[key]).toBeUndefined();
    expect([LIVE_WALL_LIMIT, CROWD_LIMIT]).toEqual([RING_CEILING, CROWD_BALL_CEILING]);
    expect(memoryCeiling("wallCount", 1e9)).toBe(RING_CEILING);
    expect(memoryCeiling("ballSpeed", 1e300)).toBe(1e300);
  });

  it("runs a ball of radius 1e9, gravity 1e12 and rotation 1e9 as typed (the engine's config keeps them)", () => {
    const engine = new PhysicsEngine({ ...base, gravity: 1e12, rotationSpeed: 1e9, ballSpeed: 1e9 });
    engine.initMode("classic");
    expect([engine.config.gravity, engine.config.rotationSpeed, engine.config.ballSpeed]).toEqual([1e12, 1e9, 1e9]);
    engine.setConfig({ ballRadius: 1e9 });
    expect(engine.config.ballRadius).toBe(1e9);
    for (let i = 0; i < 20; i++) engine.update(1000 / 60, 0);
    for (const b of engine.getBalls()) expect(Number.isFinite(b.x + b.y + b.vx + b.vy)).toBe(true);
  });

  it("engages its extreme-values machinery only past the comfort ranges (the defaults take the old code paths)", () => {
    expect(coreBeyondComfort(base)).toBe(false);
    for (const [key, value] of Object.entries(CORE_COMFORT)) {
      expect([key, value]).toEqual([key, ranges[key].max]);
      expect(coreBeyondComfort({ ...base, [key]: value * 1.01 + 1 })).toBe(true);
    }
    for (const mode of MODE_IDS) {
      const s = defaultSettings(mode);
      const engine = new PhysicsEngine({ ...physicsConfigOfSettings(s), ...uncapConfigOf(uncappedEngaged(s), s.ballCount, 1, false) });
      engine.initMode(mode);
      engine.update(1000 / 60, 0);
      expect([mode, engine.getUnlimitedView().on]).toEqual([mode, false]);
    }
  });

  it("builds at most the memory-safety ceiling of rings and says ARENA FULL; a million balls fill the crowd instead of crashing", () => {
    const engine = new PhysicsEngine({ ...base, wallCount: 1e9, ...uncapConfigOf(true, 1e6, 6, true, true) });
    engine.initMode("classic");
    expect(engine.getCircularWalls().length).toBe(RING_CEILING);
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0);
    const view = engine.getUnlimitedView();
    expect(view.full).toBe(true);
    expect(view.crowd).toBeGreaterThan(900_000);
  });
});

/* ------------------------------------------------------------------ the modes run gravity, speed and size as typed */

describe("uncap-all review fixes: every mode runs Gravity, Ball Speed and Ball Size as typed", () => {
  /** `steps` 60 Hz steps of `mode` with `patch`, through the page's own path; the first ball's state and the fastest speed seen. */
  function runMode(mode: SimulatorSettings["mode"], patch: Partial<SimulatorSettings>, steps = 120, seed = 7) {
    const s = { ...defaultSettings(mode), ...patch } as SimulatorSettings;
    const engine = createEngineForSettings(physicsConfigOfSettings(s), mode, modeSettingsOfSettings(s), seed);
    let top = 0;
    for (let i = 0; i < steps; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      for (const b of engine.getBalls()) top = Math.max(top, Math.hypot(b.vx, b.vy));
    }
    const b = engine.getBalls()[0];
    return { engine, top, state: b ? [b.x, b.y, b.vx, b.vy, b.radius] : [], elapsed: engine.getElapsedMs() };
  }

  it("scales gravity, tempo and sizes with no maximum (the helpers keep their floors only)", () => {
    expect(glassGravity(9e9, 1000)).toBeGreaterThan(glassGravity(900, 1000) * 1e6);
    expect(glassGravity(0, 1000)).toBe(glassGravity(90, 1000)); // (the floor: 0.3×)
    expect(journeyGravity(9e7, 1000)).toBeGreaterThan(journeyGravity(9e5, 1000) * 50);
    expect(raceTempo(80_000)).toBe(200);
    expect(raceGravityFactor(9e7)).toBe(3e5);
    expect(runnerGravityFactor(9e7)).toBe(3e5);
    expect(paddleGravityFactor(9e7)).toBe(3e5);
    expect(paddleBallRadius(800)).toBeCloseTo(100 * paddleBallRadius(8), 9);
    // The squares grow with the Ball Size past the old 2.5× / 2× – as far as their field holds them.
    const field = buildArenaField(800, 800, "box");
    expect(battleSquareHalf(field, 20, 28)).toBeGreaterThan(battleSquareHalf(field, 20, 20));
    expect(ctfSquareHalf(field, 30)).toBeGreaterThan(ctfSquareHalf(field, 16));
    expect([battleSquaresFit(field, 8, 1000), ctfSquaresFit(field, 1000)]).toEqual([false, false]);
  });

  it("Glass Smash, the Journey, the race, the runner and the paddle play differently at g = 9e5 and 9e7", () => {
    // (Glass Smash a few steps in: by 120 both balls have long fallen home – it was 120 identical steps at 9e5, 9e7 and 9e9
    // before; the race just past its countdown)
    for (const [mode, steps] of [["glass", 6], ["race", 120], ["paddle", 6]] as const) {
      const a = runMode(mode, { gravity: 9e5 }, steps);
      const b = runMode(mode, { gravity: 9e7 }, steps);
      expect([mode, a.state.every(Number.isFinite), b.state.every(Number.isFinite)]).toEqual([mode, true, true]);
      expect([mode, a.state]).not.toEqual([mode, b.state]);
      expect([mode, b.top > a.top]).toEqual([mode, true]);
    }
    // The Journey's own gravity (a peg field and glass, no rings – where Classic's gravity pins the ball to the ring).
    const journey = (g: number) => runMode("journey", { gravity: g, journeyStages: "pegs,glass,home" });
    expect(journey(9e5).state).not.toEqual(journey(9e7).state);
    // The runner's jumps: a flight that much shorter.
    expect(runnerPhysics({ speed: 9, jumpHeight: 2.5 }, 9e7).flatFlight).toBeLessThan(runnerPhysics({ speed: 9, jumpHeight: 2.5 }, 9e5).flatFlight / 5);
    // The race at 200 × the Ball Speed runs that much faster than at the old 2×.
    expect(runMode("race", { ballSpeed: 80_000 }).top).toBeGreaterThan(runMode("race", { ballSpeed: 800 }).top * 10);
  });

  it("ends the run with the ate-the-arena finish when the Ball Size gives a body the field cannot hold", () => {
    expect(paddleBallFits(paddleBallRadius(8))).toBe(true);
    expect(paddleBallFits(paddleBallRadius(1000))).toBe(false);
    const paddle = runMode("paddle", { ballRadius: 1000 }, 5);
    expect([paddle.engine.isSimulationFinished(), paddle.engine.getMultiplierRuntime().isOutgrown()]).toEqual([true, true]);
    for (const ilType of ["nested", "whitespace"] as const) {
      const big = runMode("illusion", { ilType, ballRadius: 1000 }, 5);
      expect([ilType, big.engine.getMultiplierRuntime().isOutgrown()]).toEqual([ilType, true]);
      const fine = runMode("illusion", { ilType, ballRadius: 40 }, 5);
      expect([ilType, fine.engine.getMultiplierRuntime().isOutgrown()]).toEqual([ilType, false]);
    }
    // A nested Ball Size past the old 0.2 cap nests a bigger innermost circle.
    const nested = (r: number) => {
      const run = runMode("illusion", { ilType: "nested", ballRadius: r }, 1);
      const v = run.engine.getIllusionView();
      return v.layerR[v.layerCount - 1] / v.layerR[0];
    };
    expect(nested(40)).toBeGreaterThan(nested(16) * 2);
  });

  it("caps no user-driven speed per step: Collision Playground orbs and the Journey's fall keep gaining speed", () => {
    // --- review fix (uncap-all) --- cpe=3 held every orb at exactly 8 × the Ball Speed (3,200 px/s)
    const orbs = runMode("collide", { cpRestitution: 3, cpCount: 10, ballSpeed: 400, cpGravity: 0 }, 300);
    expect(orbs.top).toBeGreaterThan(1e6);
    expect(orbs.state.every(Number.isFinite)).toBe(true);
    const calm = runMode("collide", { cpRestitution: 1, cpCount: 10, ballSpeed: 400, cpGravity: 0 }, 300);
    expect(calm.top).toBeLessThan(8 * 400); // (an elastic run never reaches the old cap: it replays as before)
    // The Journey: past the old terminal speed (4.2 view heights a second) under a strong gravity, differently for 3e5 and 3e7.
    const fall = (g: number) => runMode("journey", { gravity: g, journeyStages: "pegs,glass,home" }, 600);
    const a = fall(3e5);
    const b = fall(3e7);
    const field = a.engine.getJourneyView().field!;
    expect(a.top).toBeGreaterThan(4.2 * field.height);
    expect(b.top).not.toBe(a.top);
  });
});

/* ------------------------------------------------------------------ only what a run reads engages it */

describe("uncap-all review fixes: only the settings a run's engine reads engage it (and its badges)", () => {
  /** The settings no mode's engine reads: the clip's, the text's, the sound's and the picture's. */
  const NOT_ENGINE = new Set(["wallThickness", "trailThickness", "backgroundDim", "textSize", "recordingDuration", "hitSampleVolume", "sliceMs", "sliceFadeMs", "musicVolume", "musicDucking", "musicDuckRelease", "musicStartOffset", "rootNote", "bpm", "ballSquash", "cameraZoom", "screenShake", "slowMoFactor", "slowMoMs", "fastExportFps", "beatDownbeat", "videoBgOpacity"]);

  it("classifies every setting: read by some mode's engine, or the clip's, the text's, the sound's or the picture's", () => {
    const read = new Set<string>();
    for (const mode of MODE_IDS) for (const key of engineSettingKeys(mode)) read.add(key);
    const unclassified = unlimitedSettingKeys().filter((key) => read.has(key) === NOT_ENGINE.has(key));
    expect(unclassified).toEqual([]);
    expect(engineSettingKeys("classic")).toEqual(expect.arrayContaining(["ballSpeed", "gravity", "wallCount", "bounciness", "bumperBoost", "obstacles"]));
    expect(engineSettingKeys("classic")).not.toEqual(expect.arrayContaining(["glassRows"]));
    expect(engineSettingKeys("glass")).toEqual(expect.arrayContaining(["glassRows", "glassHp", "ballSpeed"]));
  });

  it("engages nothing and says no ARENA FULL for a clip length, a text size, a sound, a plain Bouncier or another mode's count", () => {
    const classic = defaultSettings("classic");
    const patches: Partial<SimulatorSettings>[] = [{ recordingDuration: 180 }, { textSize: 4 }, { bounciness: BOUNCIER_ON, bouncierEnabled: true }, { glassRows: 2000 }, { bpm: 400 }, { screenShake: 5 }, { musicVolume: 3 }];
    for (const patch of patches) {
      const s = { ...classic, ...patch };
      expect([patch, uncappedEngaged(s), pastAnyMemoryCeiling(s), physicsConfigOfSettings(s).unlimited]).toEqual([patch, false, false, undefined]);
    }
    expect(uncappedEngaged(settingsFromSearchParams(new URLSearchParams("mode=classic&bounce=1")))).toBe(false);
    // In its own mode the same count does both.
    const glass = { ...defaultSettings("glass"), glassRows: 2000 };
    expect([uncappedEngaged(glass), pastAnyMemoryCeiling(glass)]).toEqual([true, true]);
  });

  it("draws the speed readout only once a run is extreme: never for a plain Bouncier run, past ×3 for a Bounciness of 3", () => {
    const run = (bounciness: number, seconds: number) => {
      const s = { ...defaultSettings("lines"), gravity: 0, bounciness, bouncierEnabled: bounciness > 1 };
      const engine = createEngineForSettings(physicsConfigOfSettings(s), "lines", modeSettingsOfSettings(s), 11);
      let shown = false;
      for (let i = 0; i < seconds * 60; i++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        if (engine.getUnlimitedView().on) shown = true;
      }
      return { shown, bounce: engine.getBounceSpeedMultiplier() };
    };
    const plain = run(BOUNCIER_ON, 20);
    expect(plain.bounce).toBeGreaterThan(1);
    expect(plain.bounce).toBeLessThanOrEqual(3);
    expect(plain.shown).toBe(false);
    expect(run(3, 10).shown).toBe(true);
  });
});

/* ------------------------------------------------------------------ the last clamps of user parameters */

describe("uncap-all review fixes: the camera, the sound and Color Match take values past their sliders", () => {
  it("shakes, slows (or speeds) time and stretches On beat flights past the sliders' ends", () => {
    expect(shakeAmplitude(10, 1000)).toBeCloseTo(10 * shakeAmplitude(1, 1000), 9);
    expect(shakeAmplitude(-1, 1000)).toBe(0);
    // A slow-motion factor past 1 is a burst of fast motion; the floor stays.
    expect(slowMoTimeScale(500, 1000, 3)).toBeCloseTo(3, 9);
    expect(slowMoTimeScale(500, 1000, 0.001)).toBeCloseTo(0.05, 9);
    const onBeat = new OnBeatController();
    onBeat.setConfig({ range: 5 });
    expect(onBeat.getConfig().range).toBe(5);
    onBeat.setConfig({ range: 0.0001 });
    expect(onBeat.getConfig().range).toBe(0.05);
  });

  it("quantizes to the beat of any BPM past the slider's 200", () => {
    expect(gridStepSeconds(600, "1/4")).toBeCloseTo(0.1, 12);
    expect(gridStepSeconds(1e6, "1/16")).toBeCloseTo(60 / 1e6 / 4, 15);
    expect(gridStepSeconds(10, "1/4")).toBe(1); // (the floor: BPM_MIN 60)
  });

  it("amplifies a hit sample past a volume of 1 (the master bus guards the output)", async () => {
    const levels: number[] = [];
    const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: (v: number) => void levels.push(v), cancelScheduledValues: () => undefined });
    const ctx = {
      currentTime: 0,
      createGain: () => ({ gain: param(), connect: () => undefined, disconnect: () => undefined }),
      createBufferSource: () => ({ buffer: null, playbackRate: param(), connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined, onended: null }),
      decodeAudioData: async () => ({ duration: 0.2, numberOfChannels: 1, sampleRate: 48000, length: 9600 }),
    };
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    try {
      const sampler = new HitSampler(ctx as unknown as AudioContext, { connect: () => undefined } as unknown as AudioNode);
      await sampler.load("/hitSounds/click.wav");
      sampler.setVolume(4);
      expect(sampler.play(1, 0, 1.5)).toBe(true);
      expect(Math.max(...levels)).toBeCloseTo(6, 9);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("plays Color Match with any number of colours: the palette's seven, then hues of their own (ARENA FULL past the ceiling)", () => {
    const colors = Array.from({ length: 40 }, (_, i) => colorMatchColor(i));
    expect(colors.slice(0, COLOR_MATCH_COLORS.length)).toEqual(COLOR_MATCH_COLORS);
    expect(new Set(colors.map((c) => c.color)).size).toBe(40);
    for (const c of colors) expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    const s = settingsFromSearchParams(new URLSearchParams("mode=colorMatch&cmc=20"));
    expect(s.colorMatchColorCount).toBe(20);
    const engine = createEngineForSettings(physicsConfigOfSettings(s), "colorMatch", modeSettingsOfSettings(s), 4);
    expect(engine.getColorMatchColorCount()).toBe(20);
    const segments = engine.getColorMatchSegments();
    expect(new Set(segments.map((seg) => seg.color)).size).toBe(Math.min(20, segments.length));
    for (let i = 0; i < 600; i++) engine.update(1000 / 60, 0);
    expect(colorMatchColor(-1).color).toMatch(/^#[0-9a-f]{6}$/);
    const far = settingsFromSearchParams(new URLSearchParams("mode=colorMatch&cmc=1000000"));
    expect([far.colorMatchColorCount, pastAnyMemoryCeiling(far)]).toEqual([1e6, true]);
    const farEngine = createEngineForSettings(physicsConfigOfSettings(far), "colorMatch", modeSettingsOfSettings(far), 4);
    expect(farEngine.getColorMatchColorCount()).toBe(MEMORY_CEILINGS.colorMatchColorCount);
  });
});

/* ------------------------------------------------------------------ Find Simulation on a run that never ends */

describe("uncap-all: Find Simulation says when a run never ends", () => {
  function request(maxSimTimeSec: number, patch: Partial<SimulatorSettings> = {}, mode: SimulatorSettings["mode"] = "classic"): FinderRequest {
    const s = { ...defaultSettings(mode), ...patch };
    return { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 4, maxSimTimeSec, physicsConfig: { ...physicsConfigOfSettings(s), unlimited: uncappedEngaged(s) }, mode: s.mode, modeSettings: modeSettingsOfSettings(s) };
  }

  it("reports neverEnded only for a run that still has not ended far past the horizon (plain and time-sliced searches)", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    try {
      // --- review fix (uncap-all) --- panes of a billion hit points never break: Glass Smash never gets home. Every seed
      // outlives the 0.5 s horizon, and the best one is followed on to 600 s before the search says so.
      expect(neverEndsHorizonSec(30)).toBe(600);
      const endless = request(0.5, { glassHp: 1e9 }, "glass");
      const plain = await findSimulation(endless, () => {});
      expect(plain).toMatchObject({ found: false, neverEnded: true, seedsTested: 4 });
      const sliced = await findSimulationBudgeted(endless, () => {}, undefined, () => performance.now(), (fn) => setTimeout(fn, 0));
      expect(sliced).toMatchObject({ found: false, neverEnded: true });
      // A short horizon alone proves nothing: classic runs outlive half a second, then end – the search names the length
      // the best seed really has instead of claiming the run never ends.
      const short = await findSimulation(request(0.5), () => {});
      expect(short.neverEnded).toBeUndefined();
      expect(short.duration).toBeGreaterThan(0.5);
      const shortSliced = await findSimulationBudgeted(request(0.5, { ballSpeed: 1e6, bounciness: 3, bouncierEnabled: true }), () => {}, undefined, () => performance.now(), (fn) => setTimeout(fn, 0));
      expect(shortSliced.neverEnded).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says nothing of a never-ending run for defaults whose runs end past the page's horizon (Paint, Target)", async () => {
    // --- review fix (uncap-all) --- Paint's defaults last ~100–310 s: the page's 30 s search (a 60 s horizon) said they never end
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    const now = vi.spyOn(Date, "now").mockReturnValue(424_242);
    try {
      for (const mode of ["paint", "target"] as const) {
        const result = await findSimulation({ ...request(60, {}, mode), maxSeeds: 6 }, () => {});
        expect([mode, result.found, result.neverEnded]).toEqual([mode, false, undefined]);
        expect(result.duration).toBeGreaterThan(60);
      }
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("a search that sees runs end never says so – deterministically (fixed seeds, runs that always end inside the horizon)", async () => {
    // --- review fix (uncap-all) --- the seeds came from Date.now(): two Classic seeds both outlived a 120 s horizon 16–20 % of
    // the time and failed the deploy gate; Shatter's default runs last 4–28 s, and the seed base is fixed
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_234_567);
    try {
      const normal = await findSimulation({ ...request(120, {}, "shatter"), maxSeeds: 2 }, () => {});
      expect(normal.neverEnded).toBeUndefined();
      expect(normal.duration).toBeGreaterThan(0);
      expect(normal.duration).toBeLessThan(120);
      expect(await findSimulation({ ...request(120, {}, "shatter"), maxSeeds: 2 }, () => {})).toEqual(normal);
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

/* ------------------------------------------------------------------ the guard: no clamp of a user parameter */

/** Every source file of the app. */
function sources(dir = path.join(__dirname, "..", "src")): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The only places a range's maximum may still bound a value – each a memory-safety ceiling, the slider's own track maths or
 * a design domain that is not a user's number (file → a snippet of the line).
 */
const ALLOWED: readonly [string, string][] = [
  // The Wide sliders track: a position inside the comfort part of the track maps into the comfort range.
  ["lib/unlimited.ts", "return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(6))))"],
  // The team roster: up to six team balls with their own colours and names; the Ball Count past them is the crowd.
  ["components/simulator/sections/TeamsSection.tsx", "max: Math.min(RANGES.ballCount.max, modeBallCap(s.mode))"],
  ["lib/teams.ts", "Math.min(TEAM_RANGES.ballCount.max, Math.round(n))"],
  // The bot's own planning inside a platform's clip lengths (its recipes, not a user's number).
  ["lib/bot/planner.ts", "Math.min(R_DUR.max, range.max)"],
  // A batch holds at most MAX_BATCH_JOBS clips in memory for its ZIP (BATCH_COUNT_RANGE / SWEEP_STEPS_LIMIT end there).
  ["lib/recording/batch.ts", "Math.max(range.min, Math.min(range.max, n))"],
  // --- desktop-exe x uncap-all --- the desktop AI studio snaps the model's own suggestions into the slider's comfort range (the
  // model's plan, not a user's number; a user can still type any value in the number field afterwards).
  ["lib/desktop/ai/settingsPatch.ts", "return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(decimals))))"],
];

describe("uncap-all: the guard", () => {
  const patterns = [
    /Math\.min\(\s*(?:range|r|R|RANGES\.\w+|\w+_RANGES(?:\.\w+)?|\w+_RANGE)\.max\b/,
    /Math\.min\([^;]*,\s*(?:range|RANGES\.\w+|\w+_RANGES\.\w+|\w+_RANGE|R\.\w+)\.max\s*\)/,
    /\bclampToRange\(|\bclampUnlimitedPatch\(|\bbouncierMaxMultiplier\b/,
  ];

  it("finds no clamp of a user parameter against a slider's maximum outside the memory-safety allow-list", () => {
    const hits: string[] = [];
    for (const file of sources()) {
      const rel = path.relative(path.join(__dirname, "..", "src"), file).split(path.sep).join("/");
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!patterns.some((p) => p.test(line))) return;
        if (ALLOWED.some(([f, snippet]) => rel === f && line.includes(snippet))) return;
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("finds no settings helper that applies a range's maximum", () => {
    const hits: string[] = [];
    const helper = /(?:function\s+(clamp\w*|clampTo)\s*\(|const\s+(clamp\w*)\s*=\s*\()[^)]*range[^)]*\)[^{]*\{([\s\S]*?)\n\s*\};?\n/g;
    for (const file of sources()) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(helper)) {
        const body = m[3] ?? "";
        const rel = path.relative(path.join(__dirname, "..", "src"), file).split(path.sep).join("/");
        if (/range\.max/.test(body) && !ALLOWED.some(([f, snippet]) => rel === f && body.includes(snippet))) hits.push(`${rel}: ${m[1] ?? m[2]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps the memory-safety ceilings at memory-safe values, far past every slider", () => {
    // (--- review fix (uncap-all) --- the race's racers too: its per-racer state and roster are sized for the grid at init now.
    // The list settings – the editor's obstacles, the captions – lie far past their old design counts.)
    const oldListCounts: Record<string, number> = { obstacles: 24, captions: 8 };
    // --- odd-territory --- but Territory's teams: halves or quadrants, the per-team state sized for four – a count past them plays four
    const atSliderEnd = new Set(["tyTeams"]);
    for (const [key, ceiling] of Object.entries(MEMORY_CEILINGS)) {
      if (LIST_CEILING_KEYS.has(key)) {
        expect([key, ceiling >= 40 * oldListCounts[key]]).toEqual([key, true]);
        continue;
      }
      const range = ranges[key];
      expect([key, range !== undefined]).toEqual([key, true]);
      expect([key, ceiling > range.max]).toEqual([key, !atSliderEnd.has(key)]);
    }
    expect(MEMORY_CEILINGS.ballCount).toBe(1_000_000);
  });

  /**
   * --- review fix (uncap-all) --- The whole-number settings that size no allocation, each with what it counts instead. Every
   * other whole-number setting sizes one (bodies, rings, typed arrays, entities…) and must have a memory-safety ceiling: a new
   * count fails here until it gets a `MEMORY_CEILINGS` entry or a line below (a nested-circle depth without one built a billion
   * bodies and crashed the tab).
   */
  const SIZES_NOTHING: Readonly<Record<string, string>> = {
    ballRadius: "a size in px",
    splitMinRadius: "a size in px",
    wallThickness: "a width in px",
    accumulationTime: "seconds",
    growRate: "a growth rate",
    boxCountdown: "seconds",
    pwBaseOscillations: "oscillations a cycle (a bob's sound events per step are bounded: EVENTS_PER_WINDOW)",
    pwCycleSeconds: "seconds",
    pwAmplitude: "degrees",
    pwCycles: "cycles of a run",
    prBaseBpm: "a tempo",
    prAccentEvery: "an accent period",
    prCycles: "cycles of a run",
    cpAntiCollisionAt: "seconds",
    glassHp: "hit points",
    recordingDuration: "seconds (an export's frames stop at EXPORT_FRAME_CEILING)",
    sliceFadeMs: "milliseconds",
    rootNote: "a note",
    bpm: "a tempo",
    mpCap: "a multiplier cap",
    wallSmashThreshold: "a multiplier threshold",
    pickupLifetime: "seconds",
    maxBalls: "a split limit (the balls a run holds stop at objectLimitFor(); past it they join the crowd)",
    dpAngle1: "degrees",
    dpAngle2: "degrees",
    dpAngle3: "degrees",
    dpOctaves: "octaves (the harp's notes are read by index)",
    ilCycles: "cycles of a run",
    sbLives: "lives",
    rcLaps: "laps (every lap's rows together stop at RACE_SCREEN_CEILING: raceLapsWithin())",
    rcWinner: "a racer's index",
    btHp: "hit points",
    ctfScoreToWin: "a score",
    pdMisses: "misses allowed (the HUD draws at most ten hearts)",
    byPerfect: "a shot's index",
    beatDownbeat: "a beat's index",
    tyRadius: "a reach in tiles (a blast visits at most the board's tiles, a whirl walks at most its diagonal: whirlReach())", // --- odd-territory ---
  };

  it("gives every whole-number setting that sizes an allocation a memory-safety ceiling", () => {
    const unclassified: string[] = [];
    for (const key of unlimitedSettingKeys()) {
      const r = ranges[key];
      if (!(r.step === 1 && Number.isInteger(r.min))) continue;
      const ceiled = MEMORY_CEILINGS[key] !== undefined;
      if (ceiled === (key in SIZES_NOTHING)) unclassified.push(`${key}${ceiled ? " (both)" : ""}`);
    }
    expect(unclassified).toEqual([]);
    for (const key of Object.keys(SIZES_NOTHING)) expect([key, ranges[key] !== undefined]).toEqual([key, true]);
  });

  it("builds at most the nested circles' ceiling for a billion-deep Circle Illusion link and says ARENA FULL", () => {
    // --- review fix (uncap-all) --- ild=1000000000 built ten typed arrays of a billion entries and got the tab OOM-killed
    const s = settingsFromSearchParams(new URLSearchParams("mode=illusion&ilt=nested&ild=1000000000"));
    expect([s.ilType, s.ilDepth, pastAnyMemoryCeiling(s)]).toEqual(["nested", 1e9, true]);
    const engine = createEngineForSettings(physicsConfigOfSettings(s), "illusion", modeSettingsOfSettings(s), 7);
    expect(engine.getIllusionSettings().depth).toBe(MEMORY_CEILINGS.ilDepth);
    expect(engine.getIllusionView().count).toBe(MEMORY_CEILINGS.ilDepth);
    expect(engine.getBalls().length).toBe(MEMORY_CEILINGS.ilDepth);
    engine.update(1000 / 60, 0);
    expect(engine.getUnlimitedView().full).toBe(true);
    // Inside the ceiling the depth runs as typed, and nothing is full.
    const deep = settingsFromSearchParams(new URLSearchParams("mode=illusion&ilt=nested&ild=40"));
    const deepEngine = createEngineForSettings(physicsConfigOfSettings(deep), "illusion", modeSettingsOfSettings(deep), 7);
    expect([deepEngine.getIllusionView().count, pastAnyMemoryCeiling(deep)]).toEqual([40, false]);
  });
});
