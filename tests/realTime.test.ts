import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  CATCH_UP_BUDGET_MS,
  DEBT_CAP_MS,
  DRAW_BUDGET_MS,
  EXPORT_CATCH_UP_CHUNK,
  EXPORT_CATCH_UP_STEPS,
  MAX_STEPS_PER_CALLBACK,
  MIN_DRAW_INTERVAL_MS,
  OfflineRealTime,
  PAUSE_GAP_MS,
  RealTimeClock,
  RealTimeLanes,
  STEP_MS,
  playbackStepMs,
  stepCostMs,
  type RealTimeInput,
  type RealTimeStepper,
} from "@/lib/simulation/realTime";
import { FRAME_BUDGET_MS } from "@/lib/simulation/frameBudget";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MIN_DILATION } from "@/lib/physics/multipliers";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { bounceMathBeatConfig, type BounceRule } from "@/lib/simulation/bounceMath";
import { BASELINE_FILE, FINGERPRINT_CONFIG, FINGERPRINT_FRAMES, FINGERPRINT_MODE_SETTINGS, FINGERPRINT_SAMPLE_EVERY, FINGERPRINT_SEED, diffFingerprint, parseBaselineLiteral, type Fingerprint } from "@/lib/agentKit/fingerprint";

// --- slow-motion --- The real-time scheduler of the Slow motion switch (src/lib/simulation/realTime.ts) on a fake clock, and the
// engine's dilation accessor it pays steps by (`PhysicsEngine.getStepTimeScale()`): 1 on every default step of every mode.

const ROOT = path.resolve(__dirname, "..");

/** A fake stepper: every step returns `scale()` and costs `stepCpuMs` of the fake clock. */
function fakeStepper(scale: () => number = () => 1, stepCpuMs = 0) {
  let clock = 0;
  let steps = 0;
  const stepper: RealTimeStepper & { steps: () => number; advance: (ms: number) => void } = {
    step: () => {
      steps++;
      clock += stepCpuMs;
      return scale();
    },
    now: () => clock,
    steps: () => steps,
    advance: (ms) => {
      clock += ms;
    },
  };
  return stepper;
}

const run = (simSpeed = 1, drawDue = true): RealTimeInput => ({ running: true, simSpeed, drawDue });

/**
 * A 60 Hz display the way a browser calls rAF, with vsync jitter (16.67 ms ± 0.4, never exact multiples): a callback starts
 * at a vsync, its steps cost `stepCpuMs` each of the CPU clock and a drawn frame `paintCpuMs`, and the next callback comes at
 * the first vsync after it ends. `tick(nowMs, now)` is one callback of the scheduler under test; it returns whether it drew.
 * Returns the vsync times of the drawn frames and the steps of each callback.
 */
function playDisplay(seconds: number, paintCpuMs: number, tick: (nowMs: number, cpu: { ms: number }) => { draw: boolean; steps: number }) {
  const period = 1000 / 60;
  const cpu = { ms: 0 };
  const vsyncAt = (k: number) => 1000 + k * period + (((k * 7919) % 17) / 17) * 0.8 - 0.4;
  let k = 0;
  const draws: number[] = [];
  const steps: number[] = [];
  let last = vsyncAt(0);
  while (vsyncAt(k) < 1000 + seconds * 1000) {
    const nowMs = vsyncAt(k);
    last = nowMs;
    if (cpu.ms < nowMs) cpu.ms = nowMs;
    const t = tick(nowMs, cpu);
    steps.push(t.steps);
    if (t.draw) {
      draws.push(nowMs);
      cpu.ms += paintCpuMs;
    }
    while (vsyncAt(k) <= cpu.ms) k++;
  }
  const gaps = draws.slice(1).map((d, i) => d - draws[i]);
  return { draws, steps, gaps, maxGap: Math.max(...gaps), firstMs: vsyncAt(0), lastMs: last };
}

/** A stepper on `playDisplay`'s CPU clock: every step returns `scale` and costs `stepCpuMs`. */
function cpuStepper(cpu: { ms: number }, scale: number, stepCpuMs: number): RealTimeStepper {
  return {
    step: () => {
      cpu.ms += stepCpuMs;
      return scale;
    },
    now: () => cpu.ms,
  };
}

describe("the real-time scheduler (--- slow-motion ---)", () => {
  it("names its bounds: the frame budget for a drawing callback, and finite caps everywhere", () => {
    expect(DRAW_BUDGET_MS).toBe(FRAME_BUDGET_MS);
    expect([STEP_MS, DEBT_CAP_MS, PAUSE_GAP_MS, CATCH_UP_BUDGET_MS, MIN_DRAW_INTERVAL_MS, MAX_STEPS_PER_CALLBACK, EXPORT_CATCH_UP_STEPS]).toEqual([16.666, 500, 1000, 28, 100, 4096, 256]);
    expect(CATCH_UP_BUDGET_MS).toBeGreaterThan(DRAW_BUDGET_MS);
    // A step pays its time scale; a run that is over or a clock that stands still pays a whole step.
    expect(stepCostMs(1)).toBe(STEP_MS);
    expect(stepCostMs(0.25)).toBeCloseTo(STEP_MS / 4, 12);
    for (const frozen of [0, -1, NaN, Infinity]) expect(stepCostMs(frozen), String(frozen)).toBe(STEP_MS);
  });

  it("runs one whole step per 16.666 ms at real time, and pays it exactly", () => {
    const clock = new RealTimeClock();
    const stepper = fakeStepper();
    expect(clock.tick(0, run(), stepper).steps).toBe(0); // (the first callback starts the clock)
    for (let i = 1; i <= 600; i++) {
      const t = clock.tick(i * STEP_MS, run(), stepper);
      expect(t.steps, `callback ${i}`).toBe(1);
      expect(t.draw).toBe(true);
      expect(t.frameMs).toBeCloseTo(STEP_MS, 9);
    }
    expect(clock.steps).toBe(600);
    expect(Math.abs(clock.debtMs)).toBeLessThan(1e-6);
    expect([clock.lostMs, clock.framesSkipped]).toEqual([0, 0]);
  });

  it("repays the engine's time dilation with steps: 0.25 gives 4 steps per 16.666 ms, 2^-4 gives 16", () => {
    for (const [dilation, perFrame] of [
      [0.25, 4],
      [0.5, 2],
      [1 / 16, 16],
    ] as const) {
      const clock = new RealTimeClock();
      const stepper = fakeStepper(() => dilation);
      clock.tick(0, run(), stepper);
      const counts: number[] = [];
      for (let i = 1; i <= 120; i++) counts.push(clock.tick(i * STEP_MS, run(), stepper).steps);
      // The first callback pays a whole step's debt with steps it learns are shorter; from then on, exactly `perFrame`.
      expect(counts.slice(1).every((n) => n === perFrame), `${dilation}: ${counts.slice(0, 8).join(",")}`).toBe(true);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(120 * perFrame);
      expect(clock.lostMs).toBe(0);
    }
  });

  it("scales the debt and its cap with the playback speed", () => {
    const clock = new RealTimeClock();
    const stepper = fakeStepper();
    clock.tick(0, run(4), stepper);
    expect(clock.tick(STEP_MS, run(4), stepper).steps).toBe(4);
    expect(clock.tick(2 * STEP_MS, run(8), stepper).steps).toBe(8);
    // 900 ms of wall at 4x owes 3,600 ms: capped at 500 × 4, the rest lost
    const slow = new RealTimeClock();
    const stuck = fakeStepper(() => 1, 1); // 1 ms a step: the budget stops it
    slow.tick(0, run(4), stuck);
    const t = slow.tick(900, run(4), stuck);
    expect(t.wantedMs).toBeCloseTo(3600, 9);
    expect(slow.lostMs).toBeCloseTo(3600 - DEBT_CAP_MS * 4, 9);
    expect(slow.debtMs).toBeCloseTo(DEBT_CAP_MS * 4 - t.paidMs, 9);
  });

  it("caps the debt at 500 ms and counts the excess as lost time, so a slow device never spirals", () => {
    const clock = new RealTimeClock();
    const heavy = fakeStepper(() => 1, 40); // a step costs 40 ms of CPU: one a callback
    clock.tick(0, run(), heavy);
    let lostBefore = 0;
    for (let i = 1; i <= 50; i++) {
      const t = clock.tick(i * 40, run(), heavy);
      expect(t.steps, `callback ${i}`).toBe(1); // never more than its budget plus one step
      expect(clock.debtMs).toBeLessThanOrEqual(DEBT_CAP_MS);
      expect(clock.lostMs).toBeGreaterThanOrEqual(lostBefore);
      lostBefore = clock.lostMs;
    }
    // 50 callbacks of 40 ms owed 2,000 ms; 50 steps paid 833.3 ms; the cap holds 500 at most: the rest is lost, and counted
    expect(clock.lostMs).toBeGreaterThan(0);
    expect(clock.lostMs + clock.debtMs + 50 * STEP_MS).toBeCloseTo(50 * 40, 6);
  });

  it("treats a gap over a second as a pause: the debt starts over and the callback counts as one frame", () => {
    const clock = new RealTimeClock();
    const stepper = fakeStepper();
    clock.tick(0, run(), stepper);
    clock.tick(STEP_MS, run(), stepper);
    const t = clock.tick(STEP_MS + 5000, run(), stepper); // a hidden tab for five seconds
    expect(t.paused).toBe(true);
    expect(t.wallMs).toBe(STEP_MS);
    expect(t.steps).toBe(1);
    expect(t.frameMs).toBe(STEP_MS);
    expect(clock.lostMs).toBe(0);
    // exactly a second is still time owed (the gap must pass it); a clock that went back is a pause too
    const edge = clock.tick(STEP_MS + 5000 + PAUSE_GAP_MS, run(), stepper);
    expect([edge.paused, clock.lostMs > 0]).toEqual([false, true]);
    expect(clock.tick(0, run(), stepper).paused).toBe(true);
  });

  it("always runs at least one whole step when one is owed, and respects the budget after it", () => {
    // A step that costs 50 ms of CPU: one runs, then the budget stops the callback (12 ms drawing, 28 catching up).
    const slow = new RealTimeClock();
    const fifty = fakeStepper(() => 1, 50);
    slow.tick(0, run(), fifty);
    const t = slow.tick(200, run(), fifty);
    expect(t.steps).toBe(1);
    // 5 ms steps: the step that crosses the 12 ms budget is the last one (15 ms: the budget plus at most one step).
    const five = new RealTimeClock();
    const fives = fakeStepper(() => 1, 5);
    five.tick(0, run(), fives);
    expect(five.tick(400, run(), fives).steps).toBe(3);
    // 1 ms steps at 8x (a debt far past one frame): a drawing callback spends its 12 ms budget.
    const quick = new RealTimeClock();
    const one = fakeStepper(() => 1, 1);
    quick.tick(0, run(8), one);
    const drawn = quick.tick(400, run(8), one); // the first frame is overdue: it draws whatever is owed
    expect(drawn.draw).toBe(true);
    expect(drawn.catchUp).toBe(false);
    expect(drawn.steps).toBe(DRAW_BUDGET_MS);
    // The next callback still owes and its frame is not overdue: it skips the draw and catches up to 28 ms.
    const caught = quick.tick(400 + STEP_MS, run(8), one);
    expect(caught.catchUp).toBe(true);
    expect(caught.draw).toBe(false);
    expect(caught.steps).toBe(CATCH_UP_BUDGET_MS);
    expect(quick.framesSkipped).toBe(1);
    // Nothing owed: no step at all.
    const idle = new RealTimeClock();
    const none = fakeStepper();
    idle.tick(0, run(), none);
    expect(idle.tick(STEP_MS / 2, run(), none).steps).toBe(0);
  });

  it("draws at least every 100 ms while it catches up, and the drawn frame covers the skipped callbacks' time", () => {
    const clock = new RealTimeClock();
    const heavy = fakeStepper(() => 1, 30); // 30 ms a step: the device cannot keep up
    clock.tick(0, run(), heavy);
    let now = 0;
    let lastDraw = 0;
    let covered = 0;
    let wall = 0;
    for (let i = 0; i < 40; i++) {
      now += 33;
      const t = clock.tick(now, run(), heavy);
      wall += t.wallMs;
      if (t.draw) {
        expect(now - lastDraw, `callback ${i}`).toBeLessThanOrEqual(MIN_DRAW_INTERVAL_MS + 33);
        lastDraw = now;
        covered += t.frameMs;
      }
    }
    expect(clock.framesSkipped).toBeGreaterThan(0);
    expect(covered).toBeCloseTo(wall - (now - lastDraw), 9);
  });

  it("keeps its 10 fps floor on a jittered 60 Hz display while it catches up a debt it can repay, and loses nothing", () => {
    // 1/16 steps that cost 0.7 ms and a 10 ms picture: a frame drawn every callback cannot keep real time beside its picture,
    // so the clock skips frames to keep up – and never leaves the canvas without one for more than 100 ms (the floor used to
    // draw on the 7th vsync: 117 ms gaps, 8.6 fps, for a run that played in real time).
    const clock = new RealTimeClock();
    let stepper: RealTimeStepper | null = null;
    const played = playDisplay(10, 10, (nowMs, cpu) => {
      stepper ??= cpuStepper(cpu, 1 / 16, 0.7);
      return clock.tick(nowMs, run(), stepper);
    });
    expect(played.maxGap).toBeLessThanOrEqual(MIN_DRAW_INTERVAL_MS + 1); // (the display's jitter: ±0.4 ms a vsync)
    expect(played.draws.length).toBeGreaterThanOrEqual(10 * 10);
    expect(clock.framesSkipped).toBeGreaterThan(0);
    expect(clock.lostMs).toBe(0);
    // the 10 s were all played: what the steps paid plus what is still owed is the wall time since the first callback
    expect((clock.steps * STEP_MS) / 16 + clock.debtMs).toBeCloseTo(played.lastMs - played.firstMs, 6);
  });

  it("skips no frame for a debt at its cap it cannot repay: every due frame drawn, its steps within the frame budget", () => {
    // Steps that cost 3 ms and pay 1/64 of a step: the device simulates about 1 ms a frame, and skipping frames cannot repay
    // a debt that grows by 16 ms a frame. Once it hits the cap the canvas draws 60 frames a second, not its 10 fps floor.
    const clock = new RealTimeClock();
    let stepper: RealTimeStepper | null = null;
    let skippedAtCap = -1;
    let most = 0;
    const played = playDisplay(6, 2, (nowMs, cpu) => {
      stepper ??= cpuStepper(cpu, 1 / 64, 3);
      const before = cpu.ms;
      const t = clock.tick(nowMs, run(), stepper);
      if (skippedAtCap >= 0) most = Math.max(most, cpu.ms - before);
      if (skippedAtCap < 0 && clock.lostMs > 0) skippedAtCap = clock.framesSkipped;
      return t;
    });
    expect(skippedAtCap).toBeGreaterThanOrEqual(0);
    expect(clock.framesSkipped).toBe(skippedAtCap); // not one frame skipped once the debt hit its cap
    expect(most).toBeLessThanOrEqual(DRAW_BUDGET_MS + 3); // (the budget plus the step that crossed it: no catch-up)
    expect(played.draws.filter((d) => d >= played.firstMs + 2000).length).toBeGreaterThanOrEqual(0.95 * 4 * 60);
    expect(played.maxGap).toBeLessThanOrEqual(MIN_DRAW_INTERVAL_MS + 1);
    expect(clock.lostMs).toBeGreaterThan(4000); // what the steps could not pay is lost, and shown
    expect(clock.debtMs).toBeLessThanOrEqual(DEBT_CAP_MS);
  });

  it("catches up again once the debt can be repaid: a stretch it cannot keep up with, then cheap steps", () => {
    const clock = new RealTimeClock();
    let cost = 3;
    const cpu = { ms: 0 };
    const stepper: RealTimeStepper = {
      step: () => {
        cpu.ms += cost;
        return cost === 3 ? 1 / 64 : 1;
      },
      now: () => cpu.ms,
    };
    let now = 0;
    const next = () => (now = Math.max(now + 1000 / 60 + 0.3, cpu.ms));
    clock.tick(now, run(), stepper);
    for (let i = 0; i < 120; i++) clock.tick(next(), run(), stepper);
    expect(clock.lostMs).toBeGreaterThan(0);
    expect(clock.debtMs).toBeGreaterThan(DEBT_CAP_MS / 2);
    cost = 0.5; // the load is gone: 24 whole steps fit a drawing callback's budget
    for (let i = 0; i < 3; i++) clock.tick(next(), run(), stepper);
    const lost = clock.lostMs;
    for (let i = 0; i < 120; i++) clock.tick(next(), run(), stepper);
    expect(clock.lostMs).toBe(lost);
    expect(clock.owesStep).toBe(false);
  });

  it("repays a debt one long frame pushed to its cap and keeps skipping frames for it, the floor held", () => {
    // 1/16 steps of 0.5 ms and a 10 ms picture (frames must be skipped to keep real time), and one 900 ms frame after 2 s (a
    // long garbage collection, not a pause): the debt hits its cap once, and catching up repays it
    const clock = new RealTimeClock();
    let stepper: RealTimeStepper | null = null;
    let hitch = false;
    let after = 0;
    let lostAfter = -1;
    const played = playDisplay(8, 10, (nowMs, cpu) => {
      stepper ??= cpuStepper(cpu, 1 / 16, 0.5);
      if (!hitch && nowMs > 3000) {
        hitch = true;
        cpu.ms += 900;
        return { draw: false, steps: 0 };
      }
      const t = clock.tick(nowMs, run(), stepper);
      if (hitch && ++after === 3) lostAfter = clock.lostMs; // (the callbacks right after it still meet a debt at its cap)
      return t;
    });
    expect(lostAfter).toBeGreaterThan(0); // the long frame pushed the debt past its cap
    expect(clock.lostMs).toBe(lostAfter); // and then nothing more was lost: the clock caught up, skipping frames
    expect(clock.owesStep).toBe(false);
    expect(clock.framesSkipped).toBeGreaterThan(0);
    const gaps = played.gaps.filter((g) => g < 800);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(MIN_DRAW_INTERVAL_MS + 1);
  });

  it("owes nothing while the run does not play, and draws every due frame then", () => {
    const clock = new RealTimeClock();
    const stepper = fakeStepper();
    clock.tick(0, run(), stepper);
    for (let i = 1; i <= 10; i++) {
      const t = clock.tick(i * 100, { running: false, simSpeed: 1, drawDue: i % 2 === 0 }, stepper);
      expect(t.steps).toBe(0);
      expect(t.draw).toBe(i % 2 === 0);
    }
    expect([clock.debtMs, clock.lostMs, stepper.steps()]).toEqual([0, 0, 0]);
    expect(clock.tick(1000 + STEP_MS, run(), stepper).steps).toBe(1); // resumes on whole steps, with no burst
  });

  it("ends every callback: a run that is over, a clock that stands still, a dilation of 2^-20", () => {
    for (const [name, scale] of [
      ["over", () => 1],
      ["frozen", () => 0],
      ["NaN", () => NaN],
      ["2^-20", () => MIN_DILATION],
    ] as const) {
      const clock = new RealTimeClock();
      const free = fakeStepper(scale); // steps that cost nothing: only the debt and the step guard end the loop
      clock.tick(0, run(), free);
      const t = clock.tick(400, run(), free);
      expect(t.steps, name).toBeLessThanOrEqual(MAX_STEPS_PER_CALLBACK);
      expect(t.steps, name).toBeGreaterThan(0);
      if (name === "2^-20") {
        expect(MIN_DILATION).toBe(2 ** -20);
        expect(t.steps).toBe(MAX_STEPS_PER_CALLBACK);
        expect(t.draw).toBe(true); // (the first frame is overdue: drawn whatever is owed)
      } else expect(t.steps, name).toBe(Math.floor(400 / STEP_MS + 1e-9));
    }
  });

  it("starts over on reset", () => {
    const clock = new RealTimeClock();
    const stepper = fakeStepper(() => 0.5, 40);
    clock.tick(0, run(), stepper);
    clock.tick(900, run(), stepper);
    clock.tick(950, run(), stepper);
    expect(clock.lostMs + clock.debtMs).toBeGreaterThan(0);
    clock.reset();
    expect([clock.debtMs, clock.lostMs, clock.framesSkipped, clock.steps, clock.owesStep]).toEqual([0, 0, 0, 0, false]);
    expect(clock.tick(5000, run(), stepper).steps).toBe(0); // (a new clock: the first callback owes nothing)
  });
});

describe("the fast export's real-time scheduler (--- slow-motion ---)", () => {
  /** Renders `frames` video frames of a run whose dilation follows `scaleAt(step)`, in chunks of 8; returns the steps per frame. */
  function exportRun(frames: number, scaleAt: (step: number) => number, cap = EXPORT_CATCH_UP_STEPS) {
    const offline = new OfflineRealTime(cap);
    let step = 0;
    const perFrame: number[] = [];
    const lagged: boolean[] = [];
    for (let f = 0; f < frames; f++) {
      offline.beginFrame();
      let ran = 0;
      while (offline.pending) ran += offline.advance(() => scaleAt(step++), 8);
      perFrame.push(ran);
      lagged.push(offline.endFrame());
    }
    return { offline, perFrame, lagged };
  }

  it("pays one step a frame at real time, and repays dilation with steps (0.25: four a frame)", () => {
    expect(exportRun(60, () => 1).perFrame.every((n) => n === 1)).toBe(true);
    const quarter = exportRun(60, () => 0.25);
    expect(quarter.perFrame.slice(1).every((n) => n === 4)).toBe(true);
    expect(quarter.offline.laggedFrames).toBe(0);
  });

  it("stops a frame at its step cap, counts it as slower than real time, and keeps the debt within its cap", () => {
    const tiny = exportRun(40, () => MIN_DILATION);
    expect(tiny.perFrame.every((n) => n === EXPORT_CATCH_UP_STEPS)).toBe(true);
    expect(tiny.lagged.every(Boolean)).toBe(true);
    expect(tiny.offline.laggedFrames).toBe(40);
    expect(tiny.offline.debtMs).toBeLessThanOrEqual(DEBT_CAP_MS);
    expect(tiny.offline.lostMs).toBeGreaterThan(0);
    // A short heavy stretch, then real time again: the debt is repaid, and only the capped frames count.
    const dip = exportRun(60, (s) => (s >= 10 && s < 10 + 3 * 256 ? 1 / 1024 : 1));
    expect(dip.offline.laggedFrames).toBeGreaterThan(0);
    expect(dip.offline.laggedFrames).toBeLessThan(10);
    expect(dip.perFrame.slice(-5).every((n) => n === 1)).toBe(true);
  });

  it("is deterministic: the same steps give the same frames, chunked or not, with no wall clock", () => {
    const scale = (s: number) => (s % 97 < 40 ? 1 / 8 : s % 13 === 0 ? 1 / 512 : 1);
    const a = exportRun(120, scale);
    const b = exportRun(120, scale);
    expect(b.perFrame).toEqual(a.perFrame);
    expect(b.lagged).toEqual(a.lagged);
    expect([b.offline.steps, b.offline.debtMs, b.offline.lostMs]).toEqual([a.offline.steps, a.offline.debtMs, a.offline.lostMs]);
    // one chunk per frame instead of chunks of 8: the same steps
    const whole = new OfflineRealTime();
    let step = 0;
    const perFrame: number[] = [];
    for (let f = 0; f < 120; f++) {
      whole.beginFrame();
      perFrame.push(whole.advance(() => scale(step++)));
      whole.endFrame();
    }
    expect(perFrame).toEqual(a.perFrame);
  });
});

describe("the engine's step time scale (--- slow-motion ---)", () => {
  const baseline = parseBaselineLiteral(fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"));

  it("is 1 on every default step of all 48 modes, whose fingerprints stay their BASELINE entries", { timeout: 60_000 }, () => {
    expect(MODE_IDS.length).toBe(48);
    for (const mode of MODE_IDS) {
      const engine = createEngineForSettings(FINGERPRINT_CONFIG, mode, FINGERPRINT_MODE_SETTINGS, FINGERPRINT_SEED);
      expect(engine.getStepTimeScale(), mode).toBe(1);
      const samples: number[][] = [];
      let off = 0;
      for (let i = 1; i <= FINGERPRINT_FRAMES; i++) {
        engine.update(1000 / 60, 0);
        if (engine.getStepTimeScale() !== 1) off++;
        if (i % FINGERPRINT_SAMPLE_EVERY === 0) samples.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
      }
      expect(off, mode).toBe(0);
      const print: Fingerprint = { samples, broken: [...engine.getBrokenWalls()].sort((a, b) => a - b), walls: engine.getCircularWalls().map((w) => Math.round(w.radius * 1000)) };
      expect(diffFingerprint(print, baseline[mode]), mode).toEqual({ equal: true, differences: [] });
    }
  });

  const config: PhysicsConfig = { ...FINGERPRINT_CONFIG };
  const STEP = 1000 / 60;
  const timeScaleRule: BounceRule = { param: "timeScale", trigger: "start", every: 1, op: "set", amount: 0.5, scope: "ball" };

  it("equals the plan's dilation on a dilated multipliers run, without the bounce-math clock of 0.5", () => {
    const engine = new PhysicsEngine({ ...config, bounceMath: { rules: [timeScaleRule], beat: bounceMathBeatConfig(120), wallThickness: 2, wallWobble: 0, showValues: true } });
    engine.setCinematicEnabled(false);
    engine.setSeed(1);
    engine.initMode("classic");
    engine.applyBallMultiplier(engine.getBalls()[0], "speed", 1000);
    let dilated = 0;
    let planned = 0;
    for (let f = 0; f < 600 && !engine.isSimulationFinished(); f++) {
      const before = engine.getElapsedMs();
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      const scale = engine.getStepTimeScale();
      // The step covered 1000/60 × dilation × clock; the accessor holds the dilation alone.
      expect((engine.getElapsedMs() - before) / (STEP * 0.5), `frame ${f}`).toBeCloseTo(scale, 9);
      const view = engine.getMultiplierView();
      if (view.subSteps > 0) {
        planned++;
        expect(view.dilation, `frame ${f}`).toBeCloseTo(scale * 0.5, 12);
      }
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThanOrEqual(1);
      if (scale < 1) dilated++;
    }
    expect(planned).toBeGreaterThan(0);
    expect(dilated).toBeGreaterThan(0);
    // A new run starts on whole steps.
    engine.initMode("classic");
    expect(engine.getStepTimeScale()).toBe(1);
  });

  it("is 1 for a run that is over (a ball that outgrew the arena), so a page paying it always ends its loop", () => {
    const engine = new PhysicsEngine({ ...config });
    engine.setCinematicEnabled(false);
    engine.setSeed(2);
    engine.initMode("classic");
    const b = engine.getBalls()[0];
    engine.applyBallMultiplier(b, "speed", 1000);
    let sawDilation = false;
    for (let round = 0; round < 60 && !engine.isSimulationFinished(); round++) {
      engine.applyBallMultiplier(b, "size", 1.25);
      for (let f = 0; f < 30 && !engine.isSimulationFinished(); f++) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        if (engine.getStepTimeScale() < 1) sawDilation = true;
      }
    }
    expect(engine.getMultiplierView().outgrown).toBe(true);
    expect(sawDilation).toBe(true);
    engine.update(STEP, 0);
    expect(engine.getStepTimeScale()).toBe(1);
  });

  it("is 1 on every step of a run whose balls escaped, its plan dilated or not: the end plays a step a callback, nothing lost", () => {
    // Classic with ten balls at 100,000 px/s (the link nb=10&s=100000&smo=0): every step until the escape is dilated, and the
    // page used to repay that dilation with 16 steps a callback for as long as it stayed open after the run was over.
    const engine = new PhysicsEngine({ ...config, ballCount: 10, ballSpeed: 100_000, slowMotion: false });
    engine.setCinematicEnabled(false);
    engine.setSeed(1);
    engine.initMode("classic");
    let dilated = 0;
    for (let f = 0; f < 3000 && !engine.isSimulationFinished(); f++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      if (engine.getStepTimeScale() < 1) dilated++;
    }
    expect(engine.isSimulationFinished()).toBe(true);
    expect(dilated).toBeGreaterThan(10);
    // The live loop on the real engine, at a 60 Hz display's jittered timestamps.
    const clock = new RealTimeClock();
    let steps = 0;
    const stepper: RealTimeStepper = {
      step: () => {
        steps++;
        engine.update(STEP_MS, 0);
        engine.consumeSoundEvents();
        return engine.getStepTimeScale();
      },
      now: () => 0,
    };
    let now = 1000;
    let most = 0;
    for (let i = 0; i < 300; i++) {
      now += 1000 / 60 + ((i * 7919) % 13) / 13 - 0.5;
      const tick = clock.tick(now, run(), stepper);
      most = Math.max(most, tick.steps);
      if (tick.steps > 0) expect(engine.getStepTimeScale(), `callback ${i}`).toBe(1); // (the step that ended the run paid its own dilation)
      expect(tick.draw, `callback ${i}`).toBe(true);
    }
    expect(most).toBeLessThanOrEqual(2);
    expect(Math.abs(steps - 300)).toBeLessThanOrEqual(2);
    expect(clock.lostMs).toBe(0);
    // The fast export's frames of the end hold: one step each.
    const pacer = new OfflineRealTime();
    for (let f = 0; f < 30; f++) {
      pacer.beginFrame(1000 / 60);
      expect(pacer.advance(stepper.step), `frame ${f}`).toBeLessThanOrEqual(2);
      expect(pacer.endFrame()).toBe(false);
    }
    expect(pacer.steps).toBeLessThanOrEqual(31);
  });

  it("never touches the run: a seed's steps are the same whether or not anyone reads it", () => {
    const a = createEngineForSettings(FINGERPRINT_CONFIG, "multipliers", FINGERPRINT_MODE_SETTINGS, 99);
    const b = createEngineForSettings(FINGERPRINT_CONFIG, "multipliers", FINGERPRINT_MODE_SETTINGS, 99);
    for (let i = 0; i < 300; i++) {
      a.update(STEP, 0);
      b.update(STEP, 0);
      b.getStepTimeScale();
    }
    expect(b.getBalls().map((x) => [x.x, x.y])).toEqual(a.getBalls().map((x) => [x.x, x.y]));
    expect(b.getElapsedMs()).toBe(a.getElapsedMs());
  });
});

/* ------------------------------------------------------------------ a split-screen race */

describe("a split-screen race's real-time scheduler (--- slow-motion ---)", () => {
  /** One fake arena: its steps return `scale()` and cost `cpuMs` of the shared fake clock. */
  function arenas(scales: (() => number)[], cpuMs: number[]) {
    const clock = { cpu: 0 };
    const steps = scales.map(() => 0);
    const order: number[] = [];
    const fns = scales.map((scale, i) => () => {
      steps[i]++;
      order.push(i);
      clock.cpu += cpuMs[i] ?? 0;
      return scale();
    });
    return { clock, steps, order, fns, now: () => clock.cpu };
  }

  it("plays every arena in real time: a whole-step arena one step a frame, a quarter-step arena four", () => {
    const lanes = new RealTimeLanes();
    const a = arenas([() => 1, () => 0.25], [0.05, 0.05]);
    lanes.tick(0, run(), a.fns, a.now);
    for (let i = 1; i <= 600; i++) {
      const t = lanes.tick(i * STEP_MS, run(), a.fns, a.now);
      expect(t.draw, `callback ${i}`).toBe(true);
      expect(t.frameMs).toBeCloseTo(STEP_MS, 9);
    }
    expect(a.steps[0]).toBe(600);
    expect(a.steps[1]).toBeGreaterThanOrEqual(4 * 599);
    expect(a.steps[1]).toBeLessThanOrEqual(4 * 600);
    expect(lanes.lostMs).toBe(0);
    expect(lanes.lanes.map((l) => l.steps)).toEqual(a.steps);
  });

  it("steps round-robin under load: every arena that owes a step runs one before any runs a second, and none starves", () => {
    // four arenas whose steps cost 6 ms each: a callback's 12 ms budget fits about two of them, the catch-up 28 about five
    const lanes = new RealTimeLanes();
    const a = arenas([() => 1, () => 1, () => 1, () => 1], [6, 6, 6, 6]);
    let now = 0;
    lanes.tick(now, run(), a.fns, a.now);
    for (let i = 0; i < 300; i++) {
      now = Math.max(now + STEP_MS, a.clock.cpu);
      a.clock.cpu = now;
      lanes.tick(now, run(), a.fns, a.now);
    }
    // the arenas' clocks stay level: at most one step apart, whatever the order the budget cut the rounds in
    expect(Math.max(...a.steps) - Math.min(...a.steps)).toBeLessThanOrEqual(1);
    expect(Math.min(...a.steps)).toBeGreaterThan(100);
    // the device cannot keep up with four 6 ms arenas at 60 Hz: the time past the debt cap is lost, and counted
    expect(lanes.lostMs).toBeGreaterThan(0);
    for (const lane of lanes.lanes) expect(lane.debtMs).toBeLessThanOrEqual(DEBT_CAP_MS);
    // within a round no arena runs twice
    for (let k = 0; k + 4 <= 40; k += 4) expect(new Set(a.order.slice(k, k + 4)).size).toBeGreaterThanOrEqual(3);
  });

  it("shares the clock's draw decision: the 10 fps floor while it catches up, every due frame once the debt is beyond repair", () => {
    // two arenas of 1/16 steps at 0.35 ms (0.7 ms a round) beside a 10 ms picture: frames skipped, never a gap over 100 ms
    const lanes = new RealTimeLanes();
    let fns: (() => number)[] = [];
    const light = playDisplay(10, 10, (nowMs, cpu) => {
      if (fns.length === 0) fns = [cpuStepper(cpu, 1 / 16, 0.35).step, cpuStepper(cpu, 1 / 16, 0.35).step];
      return lanes.tick(nowMs, run(), fns, () => cpu.ms);
    });
    expect(light.maxGap).toBeLessThanOrEqual(MIN_DRAW_INTERVAL_MS + 1);
    expect(lanes.framesSkipped).toBeGreaterThan(0);
    expect(lanes.lostMs).toBe(0);
    // an arena whose steps cost 3 ms and pay 1/64: once its debt hits the cap, no frame is skipped
    const heavy = new RealTimeLanes();
    fns = [];
    let skippedAtCap = -1;
    const played = playDisplay(6, 2, (nowMs, cpu) => {
      if (fns.length === 0) fns = [cpuStepper(cpu, 1, 0.05).step, cpuStepper(cpu, 1 / 64, 3).step];
      const t = heavy.tick(nowMs, run(), fns, () => cpu.ms);
      if (skippedAtCap < 0 && heavy.lostMs > 0) skippedAtCap = heavy.framesSkipped;
      return t;
    });
    expect(skippedAtCap).toBeGreaterThanOrEqual(0);
    expect(heavy.framesSkipped).toBe(skippedAtCap);
    expect(played.draws.filter((d) => d >= played.firstMs + 2000).length).toBeGreaterThanOrEqual(0.95 * 4 * 60);
  });

  it("runs at least one step a callback, ends on a frozen arena and a dilation of 2^-20, and owes nothing paused", () => {
    const lanes = new RealTimeLanes();
    const a = arenas([() => 0, () => MIN_DILATION], [40, 0]);
    lanes.tick(0, run(), a.fns, a.now);
    const t = lanes.tick(STEP_MS, run(), a.fns, a.now);
    expect(t.steps).toBeGreaterThanOrEqual(1);
    expect(t.steps).toBeLessThanOrEqual(2 * MAX_STEPS_PER_CALLBACK);
    const paused = new RealTimeLanes();
    const b = arenas([() => 1, () => 1], [0, 0]);
    paused.tick(0, { running: false, simSpeed: 1, drawDue: true }, b.fns, b.now);
    for (let i = 1; i < 60; i++) expect(paused.tick(i * STEP_MS, { running: false, simSpeed: 1, drawDue: true }, b.fns, b.now).draw).toBe(true);
    expect(b.steps).toEqual([0, 0]);
    // a hidden tab is a pause: no burst when it comes back
    const back = paused.tick(60 * STEP_MS + 30_000, run(), b.fns, b.now);
    expect(back.paused).toBe(true);
    expect(back.steps).toBeLessThanOrEqual(2);
  });

  it("follows the playback speed and starts over on reset", () => {
    const lanes = new RealTimeLanes();
    const a = arenas([() => 1, () => 1], [0, 0]);
    lanes.tick(0, run(4), a.fns, a.now);
    for (let i = 1; i <= 60; i++) lanes.tick(i * STEP_MS, run(4), a.fns, a.now);
    expect(a.steps).toEqual([240, 240]);
    lanes.reset();
    expect([lanes.lanes.length, lanes.debtMs, lanes.lostMs, lanes.framesSkipped]).toEqual([0, 0, 0, 0]);
    expect(lanes.tick(10_000, run(), a.fns, a.now).steps).toBe(0); // (a new clock: the first callback owes nothing)
  });
});

/* ------------------------------------------------------------------ the finder's playback time */

describe("a step's playback time, as the finder counts a run's length (--- slow-motion ---)", () => {
  const step = 1000 / 60;
  it("is a whole step with the switch on, and for a whole step either way, bit for bit", () => {
    for (const scale of [1, 0.5, 0.25, MIN_DILATION, 0, NaN]) expect(playbackStepMs(step, true, scale), String(scale)).toBe(step);
    expect(playbackStepMs(step, false, 1)).toBe(step);
  });

  it("is the step's share with the switch off, never less than a frame's share of the export's step cap", () => {
    expect(playbackStepMs(step, false, 0.25)).toBe(step * 0.25);
    expect(playbackStepMs(step, false, MIN_DILATION)).toBe(step / EXPORT_CATCH_UP_STEPS);
    for (const frozen of [0, -1, NaN, Infinity]) expect(playbackStepMs(step, false, frozen), String(frozen)).toBe(step);
    expect(EXPORT_CATCH_UP_CHUNK).toBe(8);
  });
});
