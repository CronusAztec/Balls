import { describe, expect, it } from "vitest";
import { createEngineForSettings, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsConfig } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { CHORD_ANGLE_MAX_DEG, CHORD_ANGLE_MIN_DEG, DEFAULT_GROW_FILL, FILL_EPSILON_PX, GROW_CHORD_HZ, MAX_GROW_MARKERS, GrowMarkers, chordRebound, growPitch, growStepRadius, shrinkEase, type GrowFillSettings } from "@/lib/physics/modes/grow";
import { DEFAULT_GROW_FILL_FIELDS, DEFAULT_GROW_RAMP, FILL_LOOP_LOOK, GROW_FILL_PRESETS, growFillPresetFields, growFillSettingsOf, growRunFinishes, parseRamp, rampColor, resolveGrowFillFields } from "@/lib/physics/growFill";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { inLoopScale } from "@/lib/audio/loopPitch";
import { frequencyToMidi } from "@/lib/audio/scales";
import { availableOutcomes, outcomeMatches, outcomeMiss, barSeconds, type FinderOutcome } from "@/lib/simulation/outcomes";
import { simulateOutcomeRun, type FinderRequest } from "@/lib/simulation/finder";

/*
 * --- loop-foundation --- Grow's fill-and-loop upgrade (lib/physics/modes/grow.ts, lib/physics/growFill.ts): the classic Grow
 * replays exactly, the multiply law grows r_n = r0 (1 + p)^n, the bounces come faster and faster, the fill, the hold, the
 * shrink and the relaunch land on exact times, the pluck falls in the pentatonic scale as the ball grows, and the contact
 * markers never pass their ring buffer's ceiling.
 */

/** The physics config of tests/extras.test.ts (the classic fingerprints were recorded with it). */
const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
/** A Fill and loop world: no gravity, no spin, one ring, the preset's speed. */
const loopConfig: PhysicsConfig = { ...config, gravity: 0, rotationSpeed: 0, wallCount: 1, ballSpeed: FILL_LOOP_LOOK.ballSpeed };
const FILL_LOOP: GrowFillSettings = { law: "multiply", step: 11, startPct: 5, onFill: "loop", holdSec: 1.6, shrinkSec: 1, pitch: true };
const STEP_MS = 1000 / 60;

/** The classic Grow's fingerprint (seed 12345, 600 frames) in tests/extras.test.ts – recorded before the upgrade. */
const CLASSIC_FINGERPRINT = { samples: [[384329, 184131], [334553, 260481], [250197, 392467], [321890, 452798]], broken: [], walls: [225000] };

function fingerprint(engine: PhysicsEngine, frames = 600) {
  const samples: number[][] = [];
  for (let i = 1; i <= frames; i++) {
    engine.update(STEP_MS, 0);
    if (i % 150 === 0) samples.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
  }
  return { samples, broken: [...engine.getBrokenWalls()].sort((a, b) => a - b), walls: engine.getCircularWalls().map((w) => Math.round(w.radius * 1000)) };
}

function loopEngine(grow: Partial<GrowFillSettings> = FILL_LOOP, seed = 7, cfg: PhysicsConfig = loopConfig) {
  return createEngineForSettings(cfg, "grow", { ...modeSettings, cinematicEnabled: false, grow }, seed);
}

describe("Grow: the classic approach law replays exactly", () => {
  it("matches the fingerprint recorded before the upgrade – with the settings left out and with the defaults spelled out", () => {
    expect(fingerprint(createEngineForSettings(config, "grow", modeSettings, 12345))).toEqual(CLASSIC_FINGERPRINT);
    expect(fingerprint(createEngineForSettings(config, "grow", { ...modeSettings, grow: { ...DEFAULT_GROW_FILL } }, 12345))).toEqual(CLASSIC_FINGERPRINT);
    // the defaults are the classic Grow: approach, stay, no pitch – and the settings say so
    expect(DEFAULT_GROW_FILL).toMatchObject({ law: "approach", onFill: "stay", pitch: false });
    expect(growFillSettingsOf(defaultSettings("grow"))).toEqual({ ...DEFAULT_GROW_FILL });
    // "stay" never fills, never loops, never ends
    const engine = createEngineForSettings(config, "grow", modeSettings, 12345);
    for (let i = 0; i < 60 * 20; i++) engine.update(STEP_MS, 0);
    expect([engine.getGrowView().fills, engine.getLoopSeams(), engine.getCycleSeconds(), engine.isSimulationFinished()]).toEqual([0, null, null, false]);
  });
});

describe("Grow: the multiply law", () => {
  it("grows r_n = r0 (1 + p)^n, bounce by bounce, up to the cap", () => {
    for (const step of [4, 11, 60]) {
      const engine = loopEngine({ ...FILL_LOOP, step, onFill: "stay" });
      const view = engine.getGrowView();
      const r0 = engine.getBalls()[0].radius;
      expect(r0).toBeCloseTo(0.05 * view.ring, 9);
      let seen = 0;
      let checked = 0;
      for (let i = 0; i < 60 * 40 && seen < 200; i++) {
        engine.update(STEP_MS, 0);
        const v = engine.getGrowView();
        if (v.totalBounces === seen) continue;
        seen = v.totalBounces;
        const want = Math.min(v.cap, r0 * Math.pow(1 + step / 100, seen));
        expect(engine.getBalls()[0].radius, `step ${step}, bounce ${seen}`).toBeCloseTo(want, 6);
        checked++;
      }
      expect(checked).toBeGreaterThan(step === 60 ? 5 : 20);
    }
    // the pure rule, and the add law: r + step px
    expect(growStepRadius("multiply", 10, 11, 100)).toBeCloseTo(11.1, 12);
    expect(growStepRadius("multiply", 95, 11, 100)).toBe(100);
    expect(growStepRadius("add", 10, 7, 100)).toBe(17);
    expect(growStepRadius("add", 99, 7, 100)).toBe(100);
    expect(growStepRadius("multiply", 10, -5, 100)).toBe(10);
  });

  it("brings the bounces closer and closer together (the intervals shrink monotonically, on the simulation's steps)", () => {
    for (const seed of [1, 7, 42]) {
      const engine = loopEngine({ ...FILL_LOOP, onFill: "finish" }, seed);
      const times: number[] = [];
      for (let i = 0; i < 60 * 60 && !engine.isSimulationFinished(); i++) {
        engine.update(STEP_MS, 0);
        const v = engine.getGrowView();
        while (times.length < v.totalBounces) times.push(engine.getElapsedMs());
      }
      expect(engine.getGrowView().fills).toBe(1);
      const iv = times.slice(1).map((t, k) => t - times[k]);
      expect(iv.length).toBeGreaterThan(20);
      // never longer than the one before, beyond the step the contact is seen in, and strictly shorter four bounces on
      for (let k = 1; k < iv.length; k++) expect(iv[k], `seed ${seed}, interval ${k}`).toBeLessThanOrEqual(iv[k - 1] + STEP_MS + 1e-6);
      for (let k = 4; k < iv.length; k++) expect(iv[k], `seed ${seed}, interval ${k}`).toBeLessThan(iv[k - 4]);
      expect(iv[iv.length - 1]).toBeLessThan(0.2 * iv[0]);
    }
  });

  it("rebounds in clean chords: specular, never closer than the chord angle to the diameter", () => {
    const out = { vx: 0, vy: 0 };
    const alpha = (25 * Math.PI) / 180;
    // a radial hit (outward normal +x) leaves at alpha on the chosen side
    chordRebound(400, 0, 1, 0, alpha, 1, 400, out);
    expect(Math.atan2(Math.abs(out.vy), -out.vx)).toBeCloseTo(alpha, 9);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(400, 9);
    chordRebound(400, 0, 1, 0, alpha, -1, 400, out);
    expect(out.vy).toBeLessThan(0);
    // a glancing hit is reflected as it is
    chordRebound(200, 300, 1, 0, alpha, 1, Math.hypot(200, 300), out);
    expect([out.vx, out.vy].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-200, 300]);
    // the drawn chord angles stay in their range
    for (const seed of [1, 2, 3, 4, 5]) {
      const deg = (loopEngine(FILL_LOOP, seed).getGrowView().chordAngle * 180) / Math.PI;
      expect(deg).toBeGreaterThanOrEqual(CHORD_ANGLE_MIN_DEG);
      expect(deg).toBeLessThanOrEqual(CHORD_ANGLE_MAX_DEG);
    }
  });
});

describe("Grow: fill, hold, shrink and relaunch", () => {
  it("fills within half a pixel of the cap, holds 1.6 s, shrinks for 1 s and relaunches – on exact simulation times", () => {
    const engine = loopEngine();
    let fillMs = -1;
    const phases: { t: number; phase: string }[] = [];
    for (let i = 0; i < 60 * 60 && engine.getGrowView().seams < 2; i++) {
      engine.update(STEP_MS, 0);
      const v = engine.getGrowView();
      if (fillMs < 0 && v.fills > 0) {
        fillMs = v.lastFillMs;
        // full: snapped to the cap, in the centre, still
        const ball = engine.getBalls()[0];
        expect(ball.radius).toBeGreaterThanOrEqual(v.cap - FILL_EPSILON_PX);
        expect(Math.hypot(ball.x - loopConfig.width / 2, ball.y - loopConfig.height / 2)).toBeLessThan(1e-9);
        expect(Math.hypot(ball.vx, ball.vy)).toBe(0);
        // the next seam is known from the fill on: the hold and the shrink later
        expect(engine.getLoopSeams()).toEqual({ count: 0, lastMs: -1, nextMs: fillMs + 2600 });
      }
      if (fillMs >= 0) phases.push({ t: engine.getElapsedMs(), phase: v.phase });
      if (v.seams === 1 && phases.length > 0 && phases[phases.length - 1].phase === "grow" && engine.getLoopSeams()!.lastMs > 0) break;
    }
    expect(fillMs).toBeGreaterThan(0);
    const seams = engine.getLoopSeams()!;
    expect(seams.count).toBe(1);
    // the relaunch lands exactly on fill + hold + shrink (the run's first cycle: from 0)
    expect(seams.lastMs - fillMs).toBeCloseTo(2600, 9);
    expect(engine.getCycleSeconds()).toBeCloseTo(seams.lastMs / 1000, 12);
    // the phases on the simulation clock: hold until fill + 1.6 s, shrink until fill + 2.6 s, then growing again
    for (const { t, phase } of phases) {
      const since = t - fillMs;
      if (since < 1600 - 1e-6) expect([since, phase]).toEqual([since, "hold"]);
      else if (since > 1600 + STEP_MS + 1e-6 && since < 2600 - 1e-6) expect([since, phase]).toEqual([since, "shrink"]);
      else if (since > 2600 + STEP_MS + 1e-6) expect([since, phase]).toEqual([since, "grow"]);
    }
    // relaunched from the centre at the start size and the Ball Speed
    const ball = engine.getBalls()[0];
    const view = engine.getGrowView();
    expect(view.startRadius).toBeCloseTo(0.05 * view.ring, 9);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(loopConfig.ballSpeed, 6);
    // the shrink's easing runs from 0 to 1, in-out
    expect([shrinkEase(0), shrinkEase(0.5), shrinkEase(1)]).toEqual([0, 0.5, 1]);
  });

  it("repeats the cycle to within one frame, whatever the launch direction (and ends the run with Finish)", () => {
    for (const seed of [3, 11]) {
      const engine = loopEngine(FILL_LOOP, seed);
      const seamTimes: number[] = [];
      for (let i = 0; i < 60 * 90 && seamTimes.length < 4; i++) {
        engine.update(STEP_MS, 0);
        const s = engine.getLoopSeams()!;
        if (s.count > seamTimes.length) seamTimes.push(s.lastMs);
      }
      expect(seamTimes.length).toBe(4);
      const cycles = seamTimes.map((t, i) => t - (i > 0 ? seamTimes[i - 1] : 0));
      const spread = Math.max(...cycles) - Math.min(...cycles);
      expect(spread, `seed ${seed}: ${cycles.join(", ")}`).toBeLessThanOrEqual(STEP_MS + 1e-6);
    }
    const finish = loopEngine({ ...FILL_LOOP, onFill: "finish" });
    for (let i = 0; i < 60 * 60 && !finish.isSimulationFinished(); i++) finish.update(STEP_MS, 0);
    expect([finish.isSimulationFinished(), finish.getGrowView().phase, finish.getGrowView().fills, finish.getLoopSeams()]).toEqual([true, "done", 1, null]);
  });
});

describe("Grow: pitch by size", () => {
  it("falls as the ball grows, always on the pentatonic scale, and the run's plucks follow it", () => {
    const r0 = 10;
    const cap = 220;
    let last = Infinity;
    for (let r = r0; r <= cap; r *= 1.03) {
      const hz = growPitch(r, r0, cap);
      expect(hz).toBeLessThanOrEqual(last);
      expect(inLoopScale(Math.round(frequencyToMidi(hz)))).toBe(true);
      last = hz;
    }
    expect(growPitch(r0, r0, cap)).toBeGreaterThan(growPitch(cap, r0, cap));
    // the run: one pluck a bounce, falling through a cycle, the fill's chord on G2, the shrink's glide back up
    const engine = loopEngine();
    const plucks: number[] = [];
    let chord: number | undefined;
    let glide: { from?: number; to?: number; sec?: number } | null = null;
    for (let i = 0; i < 60 * 40 && !glide; i++) {
      engine.update(STEP_MS, 0);
      for (const ev of engine.consumeSoundEvents()) {
        expect(ev.melody).toBe(false);
        if (ev.loop === "pluck" && chord === undefined) plucks.push(ev.frequency ?? 0);
        if (ev.loop === "chord") chord = ev.frequency;
        if (ev.loop === "glide") glide = { from: ev.frequency, to: ev.loopTo, sec: ev.loopSec };
        expect(ev.type === "hit" && !ev.loop).toBe(false); // (no plain bounce under the plucks)
      }
    }
    expect(plucks.length).toBeGreaterThan(20);
    for (let k = 1; k < plucks.length; k++) expect(plucks[k]).toBeLessThanOrEqual(plucks[k - 1]);
    for (const hz of plucks) expect(inLoopScale(Math.round(frequencyToMidi(hz)))).toBe(true);
    expect(chord).toBe(GROW_CHORD_HZ);
    expect(glide).toMatchObject({ from: GROW_CHORD_HZ, sec: 1 });
    expect(glide!.to!).toBeCloseTo(plucks[0] / 2, 6);
  });
});

describe("Grow: contact markers", () => {
  it("keep at most the ring buffer's 64, the newest overwriting the oldest", () => {
    const m = new GrowMarkers();
    for (let i = 0; i < 200; i++) m.add(i, -i, 10 * i);
    expect(m.count).toBe(MAX_GROW_MARKERS);
    expect(m.head).toBe(200 % MAX_GROW_MARKERS);
    expect(Math.min(...m.ts)).toBe(10 * (200 - MAX_GROW_MARKERS));
    m.clear();
    expect([m.count, m.head]).toEqual([0, 0]);
    // a long run: every bounce leaves a marker, never more than the ceiling (the classic law too)
    for (const engine of [loopEngine(), createEngineForSettings(config, "grow", modeSettings, 5)]) {
      for (let i = 0; i < 60 * 45; i++) {
        engine.update(STEP_MS, 0);
        expect(engine.getGrowView().markers.count).toBeLessThanOrEqual(MAX_GROW_MARKERS);
      }
      expect(engine.getGrowView().markers.count).toBe(Math.min(MAX_GROW_MARKERS, engine.getGrowView().totalBounces));
    }
  });
});

describe("Grow: settings, presets, links and the finder", () => {
  it("round-trips every field through links, presets and project-like objects; old links play the classic Grow", () => {
    const s = { ...defaultSettings("grow"), growLaw: "multiply" as const, growOnFill: "loop" as const, growStep: 12.5, growStart: 3.25, growHold: 2, growShrink: 0.75, growHue: true, growRamp: "#ff0000,#00ff00,#0000ff", growMarkers: true, growMarkerLife: 0.45, growPitch: true };
    const params = settingsToSearchParams(s);
    for (const key of ["gLaw", "gFill", "gStep", "gStart", "gHold", "gShrink", "gHue", "gRamp", "gMark", "gMarkT", "gPitch"]) expect(params.has(key), key).toBe(true);
    const back = settingsFromSearchParams(params);
    for (const key of Object.keys(DEFAULT_GROW_FILL_FIELDS) as (keyof typeof DEFAULT_GROW_FILL_FIELDS)[]) expect(back[key], key).toEqual(s[key]);
    expect(presetToSettings(JSON.parse(JSON.stringify(s)))).toMatchObject({ growLaw: "multiply", growRamp: "#ff0000,#00ff00,#0000ff" });
    // the defaults write nothing, and a link without the keys is the classic Grow
    expect([...settingsToSearchParams(defaultSettings("grow")).keys()].filter((k) => k.startsWith("g") && k !== "gr")).toEqual([]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=grow"))).toMatchObject({ growLaw: "approach", growOnFill: "stay", growPitch: false });
    // invalid values fall back; numbers keep no maximum (uncapped) and are lifted onto their minimum
    expect(resolveGrowFillFields({ growLaw: "sideways", growOnFill: 3, growStep: -4, growStart: 1e6, growHold: "x" })).toMatchObject({ growLaw: "approach", growOnFill: "stay", growStep: 0, growStart: 1e6, growHold: DEFAULT_GROW_FILL_FIELDS.growHold });
  });

  it("names its presets and sets the look of Fill and loop (black, no HUD)", () => {
    expect(GROW_FILL_PRESETS.map((p) => p.id)).toEqual(["fillLoop", "slowBurn", "instant", "classic"]);
    expect(growFillPresetFields("fillLoop")).toMatchObject({ look: "loop", fields: { growLaw: "multiply", growStep: 11, growStart: 5, growOnFill: "loop" } });
    expect(growFillPresetFields("slowBurn").fields.growStep).toBe(4);
    expect(growFillPresetFields("instant").fields.growStep).toBe(60);
    expect(growFillPresetFields("classic")).toEqual({ look: "classic", fields: { ...DEFAULT_GROW_FILL_FIELDS } });
    expect(FILL_LOOP_LOOK).toMatchObject({ backgroundColors: ["#000000", "#000000"], loopHud: false });
    // the colour ramp: cyan → orange by default, interpolated between its stops
    expect(parseRamp(DEFAULT_GROW_RAMP)[0]).toBe("#4af0ff");
    expect(parseRamp(DEFAULT_GROW_RAMP).slice(-1)[0]).toBe("#f5a54a");
    expect(rampColor(["#000000", "#ffffff"], 0.5)).toBe("rgb(128, 128, 128)");
    expect(rampColor(parseRamp("nonsense"), 0)).toBe("rgb(74, 240, 255)");
  });

  it("lets Find Simulation search a Finish run: its length, a fill within a limit, a fill on a bar line", async () => {
    const finish: GrowFillSettings = { ...FILL_LOOP, onFill: "finish" };
    expect(runNeverFinishes("grow", { drop: {}, box: {}, grow: finish } as never)).toBe(false);
    expect(runNeverFinishes("grow", { drop: {}, box: {}, grow: FILL_LOOP } as never)).toBe(true);
    expect(runNeverFinishes("grow", { drop: {}, box: {} } as never)).toBe(true);
    expect(growRunFinishes({ ...finish, step: 0 })).toBe(false);
    expect(availableOutcomes("grow", { endless: false, neverEscape: false, ballCount: 1, growFinish: true })).toEqual(["duration", "fills-by", "fill-on-bar"]);
    expect(availableOutcomes("grow", { endless: true, neverEscape: false, ballCount: 1 })).toEqual([]);
    const request: FinderRequest = { targetDurationSec: 10, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: loopConfig, mode: "grow", modeSettings: { ...modeSettings, cinematicEnabled: false, grow: finish } };
    const by: FinderOutcome = { kind: "fills-by", clipSec: 10, atSec: 30 };
    const run = simulateOutcomeRun(9, request, by);
    expect(run.finished).toBe(true);
    expect(run.firstFillMs).toBeGreaterThan(0);
    expect(run.firstFillMs).toBe(run.durationMs);
    expect(outcomeMatches(by, run)).toBe(true);
    const tooSoon: FinderOutcome = { kind: "fills-by", clipSec: 10, atSec: 1 };
    expect(outcomeMatches(tooSoon, simulateOutcomeRun(9, request, tooSoon))).toBe(false);
    // a bar line: the fill's distance to the nearest one is its miss; a bar exactly at the fill matches
    const fillSec = run.firstFillMs! / 1000;
    const onBar: FinderOutcome = { kind: "fill-on-bar", clipSec: 10, atSec: fillSec / 3 };
    expect(outcomeMatches(onBar, run)).toBe(true);
    const offBar: FinderOutcome = { kind: "fill-on-bar", clipSec: 10, atSec: fillSec / 3 + 0.05 };
    expect(outcomeMatches(offBar, run)).toBe(false);
    expect(outcomeMiss(offBar, run)).toBeGreaterThan(0.1);
    expect(barSeconds(120)).toBe(2);
  });
});
