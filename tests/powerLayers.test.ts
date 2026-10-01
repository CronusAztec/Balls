import { describe, expect, it } from "vitest";
import {
  BIG_HIT_LAYERS,
  DEFAULT_POWER_LAYERS_SETTINGS,
  FREEDOM_HOLD_SEC,
  MAX_PLAN_HITS,
  POWER_LAYERS_RANGES,
  PowerSequence,
  arcGravity,
  bouncePeriodSec,
  buildPowerField,
  buildPowerPlan,
  ceilingSpeed,
  defaultPowerLayersFields,
  degreeMidi,
  fallTime,
  fanfareChord,
  finishStepMs,
  goneBefore,
  hitTimeSec,
  isPrime,
  layerHue,
  levelChord,
  levelPitch,
  nextPrime,
  powerLayersFixedDurationSec,
  powerLayersSettingsOf,
  resolvePowerLayersFields,
  resolvePowerLayersSettings,
  runFinishSec,
  sequencePowers,
  stackTopAt,
  type PowerLayersSettings,
} from "@/lib/physics/modes/powerLayers";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { frequencyToMidi } from "@/lib/audio/scales";

/**
 * Power Layers (feature odd-power-layers): the power sequences, the plan's layer accounting, the timing (every bounce
 * one period, the run = hits × period + the celebration), the flight maths, the notes, the settings / URL / presets,
 * and full engine runs – end detection, determinism, sounds, the finder's duration predicate.
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
  ballRadius: 10,
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

/** A seeded generator for the chaos plans (Park–Miller). */
function lcg(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function engineFor(pl: Parameters<typeof resolvePowerLayersSettings>[0] = {}, seed = 12345, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "powerLayers", { ...modeSettings, powerLayers: pl ?? {} }, seed);
}

interface RunLog {
  hitTimes: number[];
  sounds: { atMs: number; event: SoundEvent }[];
  finishedMs: number;
  freedMs: number;
  trace: number[];
}

/** Runs an engine until it finishes (or `maxMs`), logging when hits land, every sound event and the ball's position every step. */
function runToEnd(engine: ReturnType<typeof engineFor>, maxMs = 120_000): RunLog {
  const log: RunLog = { hitTimes: [], sounds: [], finishedMs: -1, freedMs: -1, trace: [] };
  let hits = 0;
  for (let t = 0; t < maxMs; t += STEP) {
    engine.update(STEP, 0);
    const p = engine.getPowerLayersProgress();
    const ms = engine.getElapsedMs();
    if (p.hits !== hits) {
      hits = p.hits;
      log.hitTimes.push(ms);
    }
    for (const event of engine.consumeSoundEvents()) log.sounds.push({ atMs: ms, event });
    if (p.freed && log.freedMs < 0) log.freedMs = ms;
    const ball = engine.getBalls()[0];
    if (ball) log.trace.push(ball.x, ball.y);
    if (engine.isSimulationFinished()) {
      log.finishedMs = ms;
      break;
    }
  }
  return log;
}

/* ------------------------------------------------------------------ the sequences */

describe("power sequences", () => {
  it("double, fibonacci, primes and +1 advance as named", () => {
    expect(sequencePowers("double", 8)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(sequencePowers("fibonacci", 9)).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34]);
    expect(sequencePowers("primes", 10)).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
    expect(sequencePowers("plusOne", 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("primes: the helpers", () => {
    expect([0, 1, 2, 3, 4, 9, 11, 25, 97].map(isPrime)).toEqual([false, false, true, true, false, false, true, false, true]);
    expect(nextPrime(1)).toBe(2);
    expect(nextPrime(2)).toBe(3);
    expect(nextPrime(13)).toBe(17);
    expect(nextPrime(89)).toBe(97);
  });

  it("chaos starts at 1 and draws each power between 0 and twice the record so far, one number per hit", () => {
    const draws: number[] = [];
    const rnd = lcg(42);
    const seq = new PowerSequence("random", () => {
      const u = rnd();
      draws.push(u);
      return u;
    });
    expect(seq.power).toBe(1);
    let record = 1;
    for (let i = 0; i < 400; i++) {
      const p = seq.advance();
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(2 * record);
      record = Math.max(record, p);
    }
    expect(draws).toHaveLength(400);
    // The same numbers give the same powers; the extremes of a draw map to 0 and to twice the record.
    expect(sequencePowers("random", 50, lcg(42))).toEqual(sequencePowers("random", 50, lcg(42)));
    expect(sequencePowers("random", 3, () => 0)).toEqual([1, 0, 0]);
    expect(sequencePowers("random", 4, () => 0.9999999)).toEqual([1, 2, 4, 8]);
  });
});

/* ------------------------------------------------------------------ the plan */

describe("the plan: layer accounting", () => {
  it("every layer goes exactly once and each hit destroys min(power, layers left)", () => {
    for (const sequence of ["double", "fibonacci", "primes", "plusOne", "random"] as const) {
      for (const layers of [20, 37, 120, 333, 800]) {
        const plan = buildPowerPlan(layers, sequence, lcg(layers * 7 + sequence.length));
        let gone = 0;
        for (let k = 0; k < plan.powers.length; k++) {
          const left = layers - gone;
          expect(plan.destroyed[k]).toBe(Math.min(plan.powers[k], left));
          expect(goneBefore(plan, k)).toBe(gone);
          gone += plan.destroyed[k];
          expect(plan.goneAfter[k]).toBe(gone);
        }
        expect(gone).toBe(layers);
        expect(plan.destroyed.reduce((a, b) => a + b, 0)).toBe(layers);
        // Only the last hit empties the stack.
        expect(plan.goneAfter.slice(0, -1).every((g) => g < layers)).toBe(true);
      }
    }
  });

  it("the hit counts of the clips: 120 layers doubling fall in 7 hits, 800 in 10; +1 needs 40 for 800", () => {
    expect(buildPowerPlan(120, "double").powers).toHaveLength(7);
    expect(buildPowerPlan(120, "double").destroyed).toEqual([1, 2, 4, 8, 16, 32, 57]);
    expect(buildPowerPlan(800, "double").powers).toHaveLength(10);
    expect(buildPowerPlan(800, "plusOne").powers).toHaveLength(40);
    expect(buildPowerPlan(120, "fibonacci").powers).toHaveLength(10);
    expect(buildPowerPlan(120, "primes").powers).toHaveLength(10);
    expect(buildPowerPlan(120, "double").finalPower).toBe(128);
  });

  it("chaos: zero-power hits change nothing, some hits destroy dozens, and a stuck sequence is cut at MAX_PLAN_HITS", () => {
    let zeros = 0;
    let dozens = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const plan = buildPowerPlan(120, "random", lcg(seed));
      zeros += plan.destroyed.filter((d) => d === 0).length;
      dozens += plan.destroyed.filter((d) => d >= 12).length;
      expect(plan.goneAfter[plan.goneAfter.length - 1]).toBe(120);
    }
    expect(zeros).toBeGreaterThan(20);
    expect(dozens).toBeGreaterThan(50);
    const stuck = buildPowerPlan(50, "random", () => 0);
    expect(stuck.powers).toHaveLength(MAX_PLAN_HITS);
    expect(stuck.destroyed[0]).toBe(1);
    expect(stuck.destroyed[MAX_PLAN_HITS - 1]).toBe(49);
  });
});

/* ------------------------------------------------------------------ timing and flight */

describe("timing and the flight", () => {
  it("one hit a period after the half-period drop; the run lasts hits × period + the celebration", () => {
    expect(bouncePeriodSec(1)).toBe(1);
    expect(bouncePeriodSec(2)).toBe(0.5);
    expect(bouncePeriodSec(0.1)).toBe(2);
    expect(hitTimeSec(0, 1)).toBe(0.5);
    expect(hitTimeSec(6, 0.5)).toBe(3.25);
    expect(runFinishSec(7, 1)).toBeCloseTo(7 + FREEDOM_HOLD_SEC, 12);
    expect(finishStepMs(8.8)).toBeCloseTo(8800, 6);
    expect(finishStepMs(8.81)).toBeCloseTo(8816.667, 2);
    expect(powerLayersFixedDurationSec({})).toBeCloseTo(8.8, 12);
    expect(powerLayersFixedDurationSec({ layers: 800, speed: 2 })).toBeCloseTo(10 * 0.5 + FREEDOM_HOLD_SEC, 12);
    expect(powerLayersFixedDurationSec({ sequence: "random" })).toBeNull();
  });

  it("fallTime inverts d = u t + g t²/2, and ceilingSpeed times a bounce to the period", () => {
    expect(fallTime(100, 0, 200)).toBeCloseTo(1, 12);
    expect(fallTime(100, 50, 0)).toBeCloseTo(2, 12);
    const g = arcGravity(120, 1, 300);
    for (const [a, b] of [[120, 120], [120, 180], [300, 380], [150, 150]]) {
      const u = ceilingSpeed(a, b, g, 1);
      expect(u).toBeGreaterThan(0);
      expect(fallTime(a, u, g) + fallTime(b, u, g)).toBeCloseTo(1, 9);
    }
    // The arc gravity always leaves the shortest bounce room to take the whole period (every Gravity setting).
    for (const gravity of [0, 50, 300, 900, 2000]) {
      const gg = arcGravity(120, 0.5, gravity);
      expect(2 * Math.sqrt((2 * 120) / gg)).toBeGreaterThan(0.5);
    }
    expect(ceilingSpeed(NaN, 10, 1, 1)).toBe(0);
  });

  it("the field is a portrait column in the recorder's square with the ceiling in the upper third and the stack from mid-screen down", () => {
    const f = buildPowerField(800, 600);
    expect(f.width / f.height).toBeCloseTo(0.62, 6);
    expect(f.cx).toBe(400);
    expect(f.top).toBeGreaterThan(0);
    expect(f.bottom).toBeLessThan(600);
    expect((f.ceiling - f.top) / f.height).toBeLessThan(1 / 3);
    expect((f.stackTop - f.top) / f.height).toBeGreaterThanOrEqual(0.5);
    expect(stackTopAt(f, 0, 120)).toBe(f.stackTop);
    expect(stackTopAt(f, 120, 120)).toBe(f.stackBottom);
    expect(stackTopAt(f, 60, 120)).toBeCloseTo((f.stackTop + f.stackBottom) / 2, 9);
    // The rainbow sweeps down the stack and repeats.
    expect(layerHue(0, 120)).toBe(0);
    expect(layerHue(20, 120)).toBeCloseTo(180, 9);
    expect(layerHue(40, 120)).toBeCloseTo(0, 9);
  });
});

/* ------------------------------------------------------------------ notes */

describe("notes: a new sound every level", () => {
  it("climbs the scale level by level – C major from C4 while the Sound section is chromatic – and folds after three octaves", () => {
    const midis = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => Math.round(frequencyToMidi(levelPitch(k, "chromatic", 0))));
    expect(midis).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(Math.round(frequencyToMidi(levelPitch(21, "major", 0)))).toBe(60);
    expect(Math.round(frequencyToMidi(levelPitch(20, "major", 0)))).toBe(95);
    // Another scale and root: A minor pentatonic from A4.
    const penta = [0, 1, 2, 3, 4, 5].map((k) => Math.round(frequencyToMidi(levelPitch(k, "pentatonic", 9))));
    expect(penta[0]).toBe(69);
    expect(penta[5]).toBe(81);
    expect(new Set(penta).size).toBe(6);
    expect(degreeMidi(7, "major", 2)).toBe(74);
  });

  it("a big hit plays the level's chord, the empty stack a fanfare", () => {
    const chord = levelChord(4, "major", 0).map((f) => Math.round(frequencyToMidi(f)));
    expect(chord).toEqual([67, 71, 74, 79]);
    expect(fanfareChord("chromatic", 0).map((f) => Math.round(frequencyToMidi(f)))).toEqual([72, 76, 79, 84]);
  });
});

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults and ranges", () => {
    expect(defaultPowerLayersFields()).toEqual({ plLayers: 120, plSequence: "double", plDrift: 0.35, plSpeed: 1, plBadge: "sound", plPills: true });
    expect(RANGES.plLayers).toEqual(POWER_LAYERS_RANGES.plLayers);
    expect(RANGES.plLayers).toMatchObject({ min: 20, max: 800 });
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolvePowerLayersFields(d)).toEqual(defaultPowerLayersFields());
      // The mode's own ball size applies to Power Layers only: every other mode keeps its default.
      expect(d.ballRadius).toBe(mode === "powerLayers" ? 10 : mode === "beatDrop" ? 14 : 8); // --- beat-drop --- (Beat Drop has its own 14 px ball too)
    }
    const params = settingsToSearchParams(defaultSettings("powerLayers"));
    for (const key of ["pll", "plq", "pld", "plsp", "plb", "plp", "r"]) expect(params.has(key)).toBe(false);
  });

  it("resolve clamps numbers and drops unknown options", () => {
    expect(resolvePowerLayersSettings({ layers: 5000, drift: -1, speed: 9 })).toMatchObject({ layers: 5000, drift: 0, speed: 9 }); // --- uncap-all --- (no maximum)
    expect(resolvePowerLayersSettings({ layers: 3, speed: 0.51, drift: 0.333 })).toMatchObject({ layers: 20, speed: 0.5, drift: 0.35 });
    const junk = { sequence: "tetration", badge: "loud", pills: "yes", layers: "abc", scale: "klingon" } as unknown as Parameters<typeof resolvePowerLayersSettings>[0];
    expect(resolvePowerLayersSettings(junk)).toEqual(DEFAULT_POWER_LAYERS_SETTINGS);
    expect(powerLayersSettingsOf({ ...defaultPowerLayersFields(), scale: "minor", rootNote: 14 })).toMatchObject({ scale: "minor", rootNote: 14 });
    expect(resolvePowerLayersSettings({ rootNote: 14 }).rootNote).toBe(2);
  });

  it("round-trip through pll / plq / pld / plsp / plb / plp and presets", () => {
    const s = { ...defaultSettings("powerLayers"), plLayers: 800, plSequence: "fibonacci" as const, plDrift: 0.5, plSpeed: 1.5, plBadge: "both" as const, plPills: false };
    const params = settingsToSearchParams(s);
    expect(params.get("pll")).toBe("800");
    expect(params.get("plq")).toBe("fibonacci");
    expect(params.get("pld")).toBe("0.5");
    expect(params.get("plsp")).toBe("1.5");
    expect(params.get("plb")).toBe("both");
    expect(params.get("plp")).toBe("0");
    const back = settingsFromSearchParams(params);
    expect(resolvePowerLayersFields(back)).toEqual({ plLayers: 800, plSequence: "fibonacci", plDrift: 0.5, plSpeed: 1.5, plBadge: "both", plPills: false });
    const bad = settingsFromSearchParams(new URLSearchParams("mode=powerLayers&pll=99999&plq=nope&plsp=0&plb=x&plp=7"));
    expect(resolvePowerLayersFields(bad)).toEqual({ ...defaultPowerLayersFields(), plLayers: 5000, plSpeed: 0.5 }); // --- uncap-all --- (pll=99999 builds at most the memory-safety ceiling)
    const preset = presetToSettings({ mode: "powerLayers", plLayers: 1, plSequence: "primes", plDrift: 2 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolvePowerLayersFields(preset)).toMatchObject({ plLayers: 20, plSequence: "primes", plDrift: 2 });
  });

  it("the mode is registered: an escape card right before the multipliers board, which closes the family", () => {
    expect(MODE_IDS).toContain("powerLayers");
    expect(MODE_CATEGORIES.powerLayers).toBe("escape");
    expect(MODE_CARD_ORDER).toContain("powerLayers");
    expect(modesInCategory("escape").slice(-2)).toEqual(["powerLayers", "multipliers"]);
  });
});

/* ------------------------------------------------------------------ engine runs */

describe("Power Layers on the engine", () => {
  it("lands every hit on the top of the stack at T·(k + ½), touches the ceiling in between, and ends in freedom", () => {
    const engine = engineFor();
    const view = engine.getPowerLayersView();
    const r = config.ballRadius;
    let hits = 0;
    let minY = Infinity;
    const topAtHit: number[] = [];
    for (let i = 0; i < 60 * 12 && !engine.isSimulationFinished(); i++) {
      engine.update(STEP, 0);
      const ball = engine.getBalls()[0];
      if (ball) minY = Math.min(minY, ball.y);
      if (view.hits !== hits) {
        hits = view.hits;
        // At the step of hit k the ball is back at the top it hit (the step ends on the hit's time).
        if (ball && !view.freed) topAtHit.push(ball.y + r - stackTopAt(view.field, goneBefore(engine.powerLayersMode.getPlan(), hits - 1), view.layers));
      }
      if (ball) {
        expect(ball.x - r).toBeGreaterThanOrEqual(view.field.left - 1e-6);
        expect(ball.x + r).toBeLessThanOrEqual(view.field.right + 1e-6);
      }
    }
    expect(topAtHit.length).toBeGreaterThanOrEqual(6);
    for (const d of topAtHit) expect(Math.abs(d)).toBeLessThan(0.5);
    expect(minY).toBeGreaterThanOrEqual(view.field.ceiling + r - 1e-6);
    expect(minY).toBeLessThan(view.field.ceiling + r + 1);
    expect(view.hits).toBe(7);
    expect(view.gone).toBe(120);
    expect(view.freed).toBe(true);
    expect(view.finished).toBe(true);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.getBalls()).toHaveLength(0);
    expect(engine.getElapsedMs()).toBeCloseTo(8800, 6);
  });

  it("the hit times, the freedom and the finish follow the plan (end detection), whatever the extras, the gravity or the canvas", () => {
    const base = runToEnd(engineFor());
    expect(base.hitTimes.map((t) => Math.round(t))).toEqual([500, 1500, 2500, 3500, 4500, 5500, 6500]);
    expect(base.freedMs).toBeGreaterThan(6500);
    expect(base.freedMs).toBeLessThanOrEqual(7000 + 1e-6);
    expect(base.finishedMs).toBeCloseTo(8800, 6);
    for (const cfg of [{ airDrag: 0.03, windX: 0.4, windY: -0.3, spinStrength: 1, rotatingGravity: 90 }, { gravity: 0 }, { gravity: 2000 }, { width: 390, height: 844 }, { ballRadius: 30 }]) {
      const run = runToEnd(engineFor({}, 12345, cfg));
      expect(run.hitTimes.map((t) => Math.round(t)), JSON.stringify(cfg)).toEqual([500, 1500, 2500, 3500, 4500, 5500, 6500]);
      expect(run.finishedMs, JSON.stringify(cfg)).toBeCloseTo(8800, 6);
    }
    const fast = runToEnd(engineFor({ speed: 2, layers: 800 }));
    expect(fast.hitTimes).toHaveLength(10);
    expect(fast.finishedMs).toBeCloseTo(finishStepMs(runFinishSec(10, 0.5)), 6);
  });

  it("is deterministic for a seed; seeds only change the drift, except chaos, whose hit count they decide", () => {
    const a = runToEnd(engineFor({}, 777));
    const b = runToEnd(engineFor({}, 777));
    expect(a.trace).toEqual(b.trace);
    expect(a.sounds).toEqual(b.sounds);
    const c = runToEnd(engineFor({}, 778));
    expect(c.hitTimes).toEqual(a.hitTimes);
    expect(c.trace).not.toEqual(a.trace);
    const straight = runToEnd(engineFor({ drift: 0 }, 5));
    for (let i = 0; i < straight.trace.length; i += 2) expect(straight.trace[i]).toBeCloseTo(straight.trace[0], 9);
    const chaosHits = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const x = runToEnd(engineFor({ sequence: "random" }, seed));
      const y = runToEnd(engineFor({ sequence: "random" }, seed));
      expect(x.trace).toEqual(y.trace);
      expect(x.hitTimes).toEqual(y.hitTimes);
      chaosHits.add(x.hitTimes.length);
    }
    expect(chaosHits.size).toBeGreaterThan(3);
  });

  it("plays a rising note per level, a chord and a whoosh on a big hit, a fanfare when the stack is gone and a whoosh at freedom", () => {
    const run = runToEnd(engineFor());
    const hits = run.sounds.filter((s) => s.event.type === "hit");
    expect(hits).toHaveLength(7);
    const notes = hits.map((s) => Math.round(frequencyToMidi(s.event.frequency!)));
    expect(notes).toEqual([60, 62, 64, 65, 67, 69, 72]);
    const plan = buildPowerPlan(120, "double");
    for (let k = 0; k < 6; k++) {
      const big = plan.destroyed[k] >= BIG_HIT_LAYERS;
      expect(!!hits[k].event.chord, `hit ${k}`).toBe(big);
      expect(run.sounds.some((s) => s.event.type === "gap" && s.atMs === hits[k].atMs)).toBe(big);
    }
    // The last hit: the fanfare chord and the rising arpeggio of the multipliers; then the whoosh when the ball leaves.
    expect(hits[6].event.chord?.map((f) => Math.round(frequencyToMidi(f)))).toEqual([72, 76, 79, 84]);
    expect(run.sounds.some((s) => s.event.type === "multiplier" && s.atMs === hits[6].atMs)).toBe(true);
    const gaps = run.sounds.filter((s) => s.event.type === "gap");
    expect(gaps[gaps.length - 1].atMs).toBeCloseTo(run.freedMs, 6);
    // Chaos: a hit that destroys nothing still plays its note, softly.
    for (let seed = 1; seed <= 40; seed++) {
      const engine = engineFor({ sequence: "random" }, seed);
      const plan = engine.powerLayersMode.getPlan();
      const zero = plan.destroyed.findIndex((d) => d === 0);
      if (zero < 0 || zero === plan.destroyed.length - 1) continue;
      const soft = runToEnd(engine).sounds.filter((s) => s.event.type === "hit");
      expect(soft[zero].event.level).toBe(0.5);
      return;
    }
    throw new Error("no chaos seed with a zero-power hit");
  });

  it("throws particles in the colours of the destroyed layers and a burst at freedom", () => {
    const engine = engineFor();
    const view = engine.getPowerLayersView();
    for (let i = 0; i < 31; i++) engine.update(STEP, 0); // past the first hit (0.5 s)
    expect(view.hits).toBe(1);
    expect(view.partSpawned).toBe(9);
    expect(view.partHue[0]).toBe(layerHue(0, 120));
    const before = view.partSpawned;
    runToEnd(engine);
    expect(view.partSpawned).toBeGreaterThan(before + 100);
  });

  it("the live settings follow at once, the others with the next run", () => {
    const engine = engineFor();
    engine.setPowerLayersSettings({ badge: "warning", pills: false, scale: "minor", layers: 400 });
    const view = engine.getPowerLayersView();
    expect(view.settings).toMatchObject({ badge: "warning", pills: false, scale: "minor", layers: 120 });
    expect(view.layers).toBe(120);
    engine.initPowerLayers();
    expect(engine.getPowerLayersView().layers).toBe(400);
  });

  it("keeps the run through a resize: the ball stays in the new field and the hits keep their times", () => {
    const engine = engineFor();
    const hitTimes: number[] = [];
    let hits = 0;
    for (let i = 0; i < 60 * 10 && !engine.isSimulationFinished(); i++) {
      if (i === 100) engine.setConfig({ width: 500, height: 900 });
      engine.update(STEP, 0);
      const view = engine.getPowerLayersView();
      if (view.hits !== hits) {
        hits = view.hits;
        hitTimes.push(Math.round(engine.getElapsedMs()));
      }
      const ball = engine.getBalls()[0];
      if (ball) {
        expect(ball.x).toBeGreaterThanOrEqual(view.field.left);
        expect(ball.x).toBeLessThanOrEqual(view.field.right);
        expect(ball.y).toBeGreaterThanOrEqual(view.field.ceiling);
      }
    }
    expect(hitTimes).toEqual([500, 1500, 2500, 3500, 4500, 5500, 6500]);
  });
});

/* ------------------------------------------------------------------ the finder */

describe("Find Simulation", () => {
  const request = (pl: object, target = 30): FinderRequest => ({ targetDurationSec: target, toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: target + 30, physicsConfig: config, mode: "powerLayers", modeSettings: { ...modeSettings, powerLayers: pl } });

  it("the run can always finish; every sequence but chaos has a fixed length", () => {
    expect(runNeverFinishes("powerLayers", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("powerLayers", { powerLayers: {} } as Parameters<typeof fixedRunDurationSec>[1])).toBeCloseTo(8.8, 9);
    expect(fixedRunDurationSec("powerLayers", { powerLayers: { sequence: "random" } } as Parameters<typeof fixedRunDurationSec>[1])).toBeNull();
  });

  it("the duration predicate – hits × bounce period + the celebration – is what a full simulation measures", () => {
    const cases: Partial<PowerLayersSettings>[] = [{}, { sequence: "random" }, { sequence: "random", layers: 800, speed: 1.5 }, { sequence: "fibonacci", speed: 0.5 }];
    for (const pl of cases) {
      for (const seed of [3, 99, 2024]) {
        const predicted = simulateSeed(seed, request(pl), 240_000);
        const run = runToEnd(engineFor(pl, seed), 240_000);
        expect(predicted, JSON.stringify({ pl, seed })).toBeCloseTo(run.finishedMs, 6);
        const hits = engineFor(pl, seed).getPowerLayersProgress().totalHits;
        expect(predicted).toBeCloseTo(finishStepMs(runFinishSec(hits, bouncePeriodSec(pl.speed ?? 1))), 6);
      }
    }
  });

  it("a fixed length that misses the target says so at once; chaos seeds are searched", async () => {
    const miss = await findSimulation(request({}), () => {});
    expect(miss).toMatchObject({ found: false, fixedDuration: true, seedsTested: 0 });
    expect(miss.duration).toBeCloseTo(8.8, 9);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      // A target the fixed length meets: the first seed does.
      const hit = await findSimulation(request({}, 8.8), () => {});
      expect(hit).toMatchObject({ found: true, seedsTested: 1 });
      expect(hit.duration).toBeCloseTo(8.8, 6);
      const chaos = await findSimulation(request({ sequence: "random" }, 22), () => {});
      expect(chaos.found).toBe(true);
      expect(Math.abs(chaos.duration - 22)).toBeLessThanOrEqual(0.5);
      const replay = runToEnd(engineFor({ sequence: "random" }, chaos.seed));
      expect(replay.finishedMs / 1000).toBeCloseTo(chaos.duration, 6);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
