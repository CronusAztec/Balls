import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FrameGate } from "@/components/simulator/renderBudget";
import { FrameBudget, formatRealTime } from "@/lib/simulation/frameBudget";
import { DEBT_CAP_MS, EXPORT_CATCH_UP_STEPS, MIN_DRAW_INTERVAL_MS, OfflineRealTime, RealTimeClock, RealTimeLanes, STEP_MS, realWallMs } from "@/lib/simulation/realTime";
import { DEFAULT_MULTIPLIER_LABELS, drawMultiplierHud } from "@/components/simulator/multiplierRenderer";
import { DEFAULT_UNLIMITED_LABELS, RaceRealTimeBadge, SLOW_MOTION_DATA_KEYS, UnlimitedLayer, writeSlowMotionDataset } from "@/components/simulator/unlimitedRenderer";
import type { UnlimitedView } from "@/lib/physics/limits";
import type { MultiplierView } from "@/lib/physics/multipliers";

// --- slow-motion --- The page's live loop (src/components/simulator/Canvas.tsx), run as it is written: its source is cut out of
// Canvas.tsx, transpiled and driven on fake clocks with a fake engine and camera.
//
// - With Slow motion on (the default) – and offline, the fast export's frames – draw() must run exactly the step sequence of the
//   loop before the switch (OLD_LOOP below, verbatim from 6267c7e): the same engine.update() and cam.afterStep() calls on the same
//   callbacks, the same accumulator, the same budget slicing, the same frames handed to the picture. Only the real-time badge's
//   input changed (the uncapped wall time), which the steps never read.
// - With it off, live: the real-time loop (drawRealTime) steps on every callback, drops drawn frames and never simulated time,
//   repays the engine's time dilation with steps, carries the skipped wall time into the next drawn frame, and shows the badge.
// - With it off, offline (drawOffline: the fast export, a race's arenas, the stills): a frame pays its own time with steps, at
//   most EXPORT_CATCH_UP_STEPS, or – for a driver that paces the steps itself – only draws.

const ROOT = path.resolve(__dirname, "..");
const CANVAS = fs.readFileSync(path.join(ROOT, "src/components/simulator/Canvas.tsx"), "utf8");

/** The loop of Canvas.tsx at 6267c7e, the commit this release starts from: the body of draw() up to the camera's frame. */
const OLD_LOOP = `      const now = offline ? offline.now() : (ts ?? performance.now()); // --- fast-render --- (offline: the export's clock) --- review fix (performance) --- (the rAF timestamp: vsync-aligned)
      // --- fast-render --- the page's canvas keeps its last frame while a fast export renders (the run is paused meanwhile)
      if (!offline && fastRenderRef.current?.getJob()) {
        lastTimeRef.current = now;
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      // --- review fix (performance) --- a 60 fps budget phase-locked to the display (75 / 90 / 144 Hz draw 60 fps, not 37–55, and a
      // late 60 Hz callback is not dropped); the fast export draws every frame it asks for
      if (!offline) {
        // (--- orb-rhythm --- a rhythm field that draws cheaply enough takes every refresh: its heights are new at any time)
        if (!frameGate.due(now) && !(orbFrameCost.fast && engine.isOrbGridMode() && engine.getOrbGridView().model === "rhythm")) {
          rafRef.current = requestAnimationFrame(draw);
          return;
        }
        framesDrawnRef.current++;
      }
      const orbDrawStart = performance.now(); // --- orb-rhythm --- (the frame's cost)
      const frameMs = Math.min(now - lastTimeRef.current, 100);
      lastTimeRef.current = now;
      const p = bmLayer.props(propsRef.current, engine.getBounceMathView()); // --- bounce-math --- (a rule's wall thickness; the props themselves otherwise)
      cam.settings = cameraRef.current; // --- camera ---

      const held = holdRunRef.current && !offline; // --- low-findings --- (a whole-loop recording waits for its first frame)
      if (held) accumulator = 0;
      if (!p.isPaused && p.isStarted && !held) {
        accumulator += frameMs * p.simSpeed * cam.timeScale(); // --- camera: slow motion feeds the engine less time; its fixed steps stay the same
        if (accumulator > 250) accumulator = 250;
        // --- unlimited --- with No limits on (live only) a frame stops after the step that used up its budget and drops the rest
        frameBudget.enabled = !offline && engine.getUnlimitedView().on;
        frameBudget.begin(performance.now());
        const simBefore = engine.getElapsedMs();
        while (accumulator >= 16.666) {
          engine.update(16.666, audioRef.current);
          cam.afterStep(engine); // --- camera: the escape replay's ring buffer
          accumulator -= 16.666;
          if (frameBudget.exceeded(performance.now())) accumulator = 0; // --- unlimited ---
        }
        if (engine.isSimulationFinished()) frameBudget.reset(); // --- unlimited --- (a finished run's clock stands still: not slow motion)
        else frameBudget.note(frameMs, frameMs * p.simSpeed * cam.timeScale(), engine.getElapsedMs() - simBefore); // --- unlimited ---
      } else frameBudget.reset(); // --- unlimited --- (paused or not started: no slow-motion badge)
`;

/** Canvas.tsx between two markers (the start one included, the end one excluded unless `withEnd`). */
function cut(start: string, end: string, withEnd = false): string {
  const a = CANVAS.indexOf(start);
  expect(a, start).toBeGreaterThan(0);
  const b = CANVAS.indexOf(end, a + start.length);
  expect(b, end).toBeGreaterThan(a);
  return CANVAS.slice(a, withEnd ? b + end.length : b);
}

const DRAW_START = "    const draw = (ts?: number) => {\n";
const PAINT_CALL = "      paintFrame(now, frameMs, p, held, orbDrawStart); // --- slow-motion ---\n";
const REAL_TIME_START = "    const realTime = new RealTimeClock();\n";
const REAL_TIME_END = "    // --- end slow-motion ---\n";
const OFFLINE_START = "    const offlineRealTime = new OfflineRealTime();\n";
const OFFLINE_END = "    // --- end slow-motion --- (offline)\n";

/** The body of today's draw() up to the call that hands the frame to the picture. */
function currentLoop(): string {
  return cut(DRAW_START, PAINT_CALL, true).slice(DRAW_START.length);
}

/** Everything the loop reads from its closure in Canvas.tsx; the harness passes fakes of them. */
const FREE = [
  "offline",
  "fastRenderRef",
  "lastTimeRef",
  "rafRef",
  "requestAnimationFrame",
  "engine",
  "frameGate",
  "orbFrameCost",
  "framesDrawnRef",
  "performance",
  "bmLayer",
  "propsRef",
  "cam",
  "cameraRef",
  "holdRunRef",
  "frameBudget",
  "audioRef",
  "paintFrame",
  "realWallMs",
  "RealTimeClock",
  "REAL_TIME_STEP_MS",
  "OfflineRealTime",
] as const;
type Env = Record<(typeof FREE)[number], unknown>;
interface Harness {
  draw: (ts: number) => void;
  accumulator: () => number;
  /** The loop's real-time clock (with the real-time block), else null. */
  realTime: RealTimeClock | null;
}

/**
 * Builds draw() from `drawBody` (and the real-time block before it when given, the offline block after that when given) in a
 * closure over `env`, like the canvas' effect.
 */
function harness(drawBody: string, env: Env, realTimeBlock = "", offlineBlock = ""): Harness {
  const source = `function harness(env) {
  const { ${FREE.join(", ")} } = env;
  let accumulator = 0;
${realTimeBlock || "  let realTimeLive = false;\n  const drawRealTime = env.drawRealTime;\n"}
${offlineBlock || "  const drawOffline = env.drawOffline;\n"}
  const draw = (ts?: number) => {
${drawBody}
  };
  return { draw, accumulator: () => accumulator, realTime: typeof realTime === "undefined" ? null : realTime };
}`;
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  return new Function(`${js}\nreturn harness;`)()(env) as Harness;
}

/** A small seeded generator (mulberry32): the same script for both loops. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One callback of a script: what the page and the run look like when it comes. */
interface Callback {
  gapMs: number;
  paused: boolean;
  started: boolean;
  held: boolean;
  simSpeed: number;
  unlimited: boolean;
  finished: boolean;
  exporting: boolean;
  scale: number;
  stepCpuMs: number;
}

/** A random but reproducible script: display jitter, long frames, pauses, gaps, speeds, the budget, a camera slow motion, an export. */
function script(seed: number, n: number, longFrames = true): Callback[] {
  const r = rng(seed);
  const out: Callback[] = [];
  let paused = false;
  let started = false;
  let unlimited = false;
  let finished = false;
  let simSpeed = 1;
  for (let i = 0; i < n; i++) {
    if (r() < 0.01) paused = !paused;
    if (r() < 0.02) started = true;
    if (r() < 0.005) started = false;
    if (r() < 0.01) unlimited = !unlimited;
    if (r() < 0.004) finished = !finished;
    if (r() < 0.01) simSpeed = [1, 2, 4, 8][Math.floor(r() * 4)];
    const roll = r();
    const gapMs = !longFrames ? 4 + r() * 40 : roll < 0.7 ? 16.667 + (r() - 0.5) * 4 : roll < 0.85 ? 6.94 : roll < 0.95 ? 33 + r() * 300 : roll < 0.99 ? 0.5 + r() * 3 : 1200 + r() * 5000;
    out.push({
      gapMs,
      paused,
      started,
      held: r() < 0.01,
      simSpeed,
      unlimited,
      finished,
      exporting: r() < 0.01,
      scale: r() < 0.7 ? 1 : 0.05 + r() * 0.9,
      stepCpuMs: [0.05, 2, 6, 15][Math.floor(r() * 4)],
    });
  }
  return out;
}

/**
 * Fakes of the loop's closure, recording every call the loop makes. `clock.cpu` is `performance.now()`: a step costs the
 * callback's `stepCpuMs` of it and the picture `paintCpuMs`. The paint record holds the accumulator and the CPU clock it saw.
 */
function fakes(opts: { slowMotion: boolean; offline: boolean; dilation?: number; paintCpuMs?: number; pacesSteps?: boolean }) {
  const log: unknown[] = [];
  const clock = { cpu: 0, offlineNow: 0 };
  let cb: Callback = script(1, 1)[0];
  const props = { isPaused: false, isStarted: false, simSpeed: 1 };
  let h: Harness | null = null;
  let elapsed = 0;
  let steps = 0;
  const dilation = opts.dilation ?? 1;
  const budget = new FrameBudget();
  const engine = {
    update: (ms: number, audio: number) => {
      steps++;
      clock.cpu += cb.stepCpuMs;
      elapsed += ms * dilation;
      log.push(["update", ms, audio]);
    },
    slowMotionOn: () => opts.slowMotion,
    getUnlimitedView: () => ({ on: cb.unlimited }),
    getElapsedMs: () => elapsed,
    isSimulationFinished: () => cb.finished,
    isOrbGridMode: () => false,
    getOrbGridView: () => ({ model: "free" }),
    getBounceMathView: () => ({ active: false }),
    getStepTimeScale: () => dilation,
  };
  const cam = {
    settings: null as unknown,
    slowMotion: true,
    timeScale: () => cb.scale,
    afterStep: () => log.push(["afterStep"]),
  };
  const env: Env & { drawRealTime: (now: number) => void; drawOffline: (now: number) => void } = {
    offline: opts.offline ? { now: () => clock.offlineNow, pacesSteps: opts.pacesSteps } : null,
    fastRenderRef: { current: { getJob: () => cb.exporting } },
    lastTimeRef: { current: 0 },
    rafRef: { current: 0 },
    requestAnimationFrame: () => {
      log.push(["raf"]);
      return 1;
    },
    engine,
    frameGate: new FrameGate(),
    orbFrameCost: { fast: false },
    framesDrawnRef: { current: 0 },
    performance: { now: () => clock.cpu },
    bmLayer: { props: <P>(p: P) => p },
    propsRef: { current: props },
    cam,
    cameraRef: { current: { slowMoOnNearMiss: true } },
    holdRunRef: { current: false },
    frameBudget: budget,
    audioRef: { current: 0.5 },
    paintFrame: (now: number, frameMs: number, _p: unknown, held: boolean, orbDrawStart: number) => {
      log.push(["paint", now, frameMs, held, orbDrawStart, h!.accumulator(), clock.cpu]);
      clock.cpu += opts.paintCpuMs ?? 0;
    },
    realWallMs,
    RealTimeClock,
    REAL_TIME_STEP_MS: STEP_MS,
    OfflineRealTime,
    drawRealTime: (now: number) => log.push(["drawRealTime", now]),
    drawOffline: (now: number) => log.push(["drawOffline", now]),
  };
  return {
    env,
    log,
    cam,
    budget,
    steps: () => steps,
    elapsed: () => elapsed,
    clock,
    harness: () => h!,
    bind: (harnessOf: Harness) => (h = harnessOf),
    /** Runs one callback of the script at the rAF timestamp `nowMs`. */
    callback: (next: Callback, nowMs: number) => {
      cb = next;
      props.isPaused = next.paused;
      props.isStarted = next.started;
      props.simSpeed = next.simSpeed;
      (env.holdRunRef as { current: boolean }).current = next.held;
      clock.cpu += 0.01; // (the callback's own overhead)
      h!.draw(nowMs);
      log.push(["after", h!.accumulator(), budget.slicedFrames, (env.framesDrawnRef as { current: number }).current]);
    },
  };
}

type Paint = [string, number, number, boolean, number, number, number];
const paintsOf = (log: unknown[]) => log.filter((e) => (e as unknown[])[0] === "paint") as Paint[];
const OLD_DRAW = `${OLD_LOOP}      paintFrame(now, frameMs, p, held, orbDrawStart);\n`;

/** Plays `callbacks` through a loop built from `drawBody` and returns what it did (the wall and CPU clocks independent). */
function play(drawBody: string, callbacks: Callback[], opts: { slowMotion: boolean; offline: boolean }) {
  const f = fakes(opts);
  f.bind(harness(drawBody, f.env));
  let now = 1000;
  for (const c of callbacks) {
    now += opts.offline ? 1000 / 60 : c.gapMs;
    f.clock.offlineNow = now;
    f.callback(c, now);
  }
  return { log: f.log, ratio: f.budget.ratio, fraction: f.budget.fraction, steps: f.steps(), cam: f.cam };
}

describe("the live loop with Slow motion on (--- slow-motion ---): exactly the old step sequence", () => {
  it("is cut out of Canvas.tsx as written: the old loop's lines are all still there, in order, only the badge's input changed", () => {
    const body = currentLoop();
    const lines = OLD_LOOP.split("\n").filter((l) => l.trim().length > 0);
    let at = 0;
    for (const line of lines) {
      // the one line the switch changed on purpose: the badge is fed the uncapped wall time (the steps never read it)
      const expected = line.includes("frameBudget.note(frameMs") ? line.replace("frameBudget.note(frameMs, frameMs *", "frameBudget.note(wallMs, wallMs *").replace(/ \/\/ --- unlimited ---$/, "") : line;
      const found = body.indexOf(expected, at);
      expect(found, expected).toBeGreaterThanOrEqual(at);
      at = found + expected.length;
    }
    // and what the switch added in between: the dispatcher, the flag, the badge's wall time and the camera's switch
    expect(body).toContain("if (!offline && !engine.slowMotionOn()) {\n        drawRealTime(now);\n        return;\n      }\n      realTimeLive = false;\n");
    expect(body).toContain("if (offline && !engine.slowMotionOn()) {\n        drawOffline(now);\n        return;\n      }\n");
    expect(body).toContain("const wallMs = realWallMs(now - lastTimeRef.current);");
    expect(body).toContain("cam.slowMotion = engine.slowMotionOn();");
  });

  for (const [label, seed, longFrames] of [
    ["a 60 Hz display with jitter, long frames, pause gaps and an export", 7, true],
    ["a fast display, every frame under 100 ms", 11, false],
    ["another script", 2026, true],
  ] as const) {
    it(`runs the same steps, accumulator, budget slicing and frames as the old loop: ${label}`, () => {
      const callbacks = script(seed, 6000, longFrames);
      const old = play(OLD_DRAW, callbacks, { slowMotion: true, offline: false });
      const now = play(currentLoop(), callbacks, { slowMotion: true, offline: false });
      expect(old.steps).toBeGreaterThan(1500);
      expect(paintsOf(old.log).length).toBeGreaterThan(1000);
      expect(old.log.some((e) => (e as unknown[])[0] === "after" && ((e as unknown[])[2] as number) > 0)).toBe(true); // (the budget sliced)
      expect(now.log).toEqual(old.log);
      expect(now.cam.slowMotion).toBe(true);
      // the badge reads the same while no frame is over 100 ms (nor a pause gap); past that it sees the real wall time
      if (!longFrames) expect([now.ratio, now.fraction]).toEqual([old.ratio, old.fraction]);
    });
  }

  it("keeps the old loop offline (the fast export) with the switch on: the same steps, the camera told the switch", () => {
    const callbacks = script(5, 4000);
    const old = play(OLD_DRAW, callbacks, { slowMotion: true, offline: true });
    const now = play(currentLoop(), callbacks, { slowMotion: true, offline: true });
    expect(old.steps).toBeGreaterThan(1000);
    expect(now.log).toEqual(old.log);
    expect(now.log.some((e) => ["drawRealTime", "drawOffline"].includes((e as unknown[])[0] as string))).toBe(false);
    expect(now.cam.slowMotion).toBe(true);
  });

  it("hands an offline frame with the switch off to drawOffline, and runs none of the old loop's steps then", () => {
    const callbacks = script(5, 500);
    const off = play(currentLoop(), callbacks, { slowMotion: false, offline: true });
    expect(off.log.filter((e) => (e as unknown[])[0] === "drawOffline")).toHaveLength(500);
    expect(off.log.some((e) => ["update", "afterStep", "paint", "drawRealTime"].includes((e as unknown[])[0] as string))).toBe(false);
    expect(off.steps).toBe(0);
  });

  it("hands a live callback with the switch off to the real-time loop, and runs none of the old loop's steps then", () => {
    const callbacks = script(9, 500).map((c) => ({ ...c, exporting: false }));
    const off = play(currentLoop(), callbacks, { slowMotion: false, offline: false });
    expect(off.log.filter((e) => (e as unknown[])[0] === "drawRealTime")).toHaveLength(500);
    expect(off.log.some((e) => ["update", "afterStep", "paint"].includes((e as unknown[])[0] as string))).toBe(false);
    expect(off.steps).toBe(0);
  });

  it("counts the badge's wall time uncapped, a pause gap as one step", () => {
    expect(realWallMs(16.7)).toBe(16.7);
    expect(realWallMs(300)).toBe(300);
    expect(realWallMs(1000)).toBe(1000);
    expect(realWallMs(1000.5)).toBe(STEP_MS);
    expect(realWallMs(-5)).toBe(STEP_MS);
    expect(realWallMs(NaN)).toBe(STEP_MS);
    // a 300 ms frame that ran its capped 100 ms of steps is no longer real time to the badge
    const old = new FrameBudget();
    const fixed = new FrameBudget();
    for (let i = 0; i < 10; i++) {
      old.note(100, 100, 100);
      fixed.note(realWallMs(300), realWallMs(300), 100);
    }
    expect(old.slow).toBe(false);
    expect(fixed.slow).toBe(true);
    expect(fixed.ratio).toBeCloseTo(1 / 3, 9);
  });
});

/* ------------------------------------------------------------------ the switch off */

/** The real-time block of Canvas.tsx (the clock, its stepper and drawRealTime) and draw() after it, on fakes. */
function realTimeLoop(opts: { dilation?: number; paintCpuMs?: number } = {}) {
  const f = fakes({ slowMotion: false, offline: false, ...opts });
  f.bind(harness(currentLoop(), f.env, cut(REAL_TIME_START, REAL_TIME_END)));
  const clock = () => f.harness().realTime!;
  return { ...f, clock: f.clock, realTime: clock, paints: () => paintsOf(f.log) };
}

/** The wall time the drawn frames' frameMs cover after the first one (the first covers the time before it). */
const coveredMs = (paints: Paint[]) => paints.slice(1).reduce((sum, e) => sum + e[2], 0);

const steady = (over: Partial<Callback> = {}): Callback => ({ gapMs: 1000 / 60, paused: false, started: true, held: false, simSpeed: 1, unlimited: false, finished: false, exporting: false, scale: 1, stepCpuMs: 0.05, ...over });

/**
 * Plays `seconds` of a display at `hz` the way a browser calls rAF: a callback starts at a vsync, takes the CPU time its steps
 * and its picture cost, and the next one comes at the first vsync after it ends. Returns each callback's physics CPU time.
 */
function playVsync(loop: ReturnType<typeof realTimeLoop>, seconds: number, over: Partial<Callback> = {}, hz = 60) {
  const period = 1000 / hz;
  const c = steady(over);
  let vsync = (Math.floor(loop.clock.cpu / period) + 1) * period;
  const end = vsync + seconds * 1000;
  const physics: number[] = [];
  const gaps: number[] = [];
  let last = vsync;
  while (vsync < end) {
    if (loop.clock.cpu < vsync) loop.clock.cpu = vsync;
    const start = loop.clock.cpu;
    const paints = loop.paints().length;
    loop.callback(c, vsync);
    const painted = loop.paints();
    physics.push((painted.length > paints ? painted[painted.length - 1][6] : loop.clock.cpu) - start);
    gaps.push(vsync - last);
    last = vsync;
    vsync = (Math.floor(loop.clock.cpu / period) + 1) * period;
  }
  return { physics, maxGap: Math.max(...gaps), wallMs: seconds * 1000 };
}

describe("the live loop with Slow motion off (--- slow-motion ---): real time, drawn frames dropped, never simulated time", () => {
  it("keeps up with the wall clock when steps are cheap: a step per 16.666 ms, a frame per callback", () => {
    const loop = realTimeLoop({ paintCpuMs: 2 });
    playVsync(loop, 10);
    expect(loop.steps()).toBeGreaterThanOrEqual(598);
    expect(loop.steps()).toBeLessThanOrEqual(601);
    expect(loop.elapsed()).toBeCloseTo(loop.steps() * STEP_MS, 6);
    expect(loop.paints().length).toBeGreaterThanOrEqual(598);
    expect(loop.budget.slow).toBe(false);
    expect(loop.cam.slowMotion).toBe(false);
    expect(loop.realTime().lostMs).toBe(0);
  });

  it("steps on every callback of a fast display and draws 60 frames a second through the frame gate", () => {
    const loop = realTimeLoop({ paintCpuMs: 2 });
    playVsync(loop, 10, {}, 144);
    expect(loop.steps()).toBeGreaterThanOrEqual(597);
    expect(loop.steps()).toBeLessThanOrEqual(602);
    expect(loop.paints().length).toBeGreaterThanOrEqual(590);
    expect(loop.paints().length).toBeLessThanOrEqual(605);
  });

  it("repays the engine's time dilation with steps: a quarter-step run plays its simulated time in real time", () => {
    const loop = realTimeLoop({ dilation: 0.25, paintCpuMs: 2 });
    const { physics } = playVsync(loop, 10, { stepCpuMs: 0.5 });
    expect(loop.steps()).toBeGreaterThanOrEqual(4 * 597);
    expect(loop.steps()).toBeLessThanOrEqual(4 * 601);
    // the fake engine's clock moves 16.666 × 0.25 a step: 10 s of simulated time in 10 s of wall time
    expect(loop.elapsed()).toBeGreaterThan(9_950);
    expect(loop.elapsed()).toBeLessThan(10_020);
    expect(Math.max(...physics)).toBeLessThan(12);
    expect(loop.budget.slow).toBe(false);
  });

  it("drops drawn frames under load, never simulated time, while the device can simulate in real time", () => {
    // the steps of a frame cost 8 ms, its picture 12: both do not fit a 60 Hz frame, the steps alone do
    const loop = realTimeLoop({ dilation: 0.25, paintCpuMs: 12 });
    const { physics, wallMs } = playVsync(loop, 10, { stepCpuMs: 2 });
    expect(loop.elapsed()).toBeGreaterThan(0.97 * wallMs);
    expect(loop.elapsed()).toBeLessThan(1.01 * wallMs);
    const paints = loop.paints();
    expect(paints.length).toBeLessThan(0.6 * 600); // about 30 frames a second
    expect(paints.length).toBeGreaterThan(100); // at least 10 a second
    expect(coveredMs(paints)).toBeCloseTo(paints[paints.length - 1][1] - paints[0][1], 6);
    // no callback spends more on steps than its budget plus the one step that crossed it (the catch-up budget on a skipped draw)
    expect(Math.max(...physics)).toBeLessThanOrEqual(28 + 2 + 0.5);
    expect(loop.budget.slow).toBe(false);
    expect(loop.realTime().lostMs).toBe(0);
  });

  it("past what the device can simulate, loses only the time over the debt cap and shows it, and still draws every 100 ms", () => {
    // a step costs 40 ms: the device simulates well under half of real time. --- review fix --- With No limits on, where the old
    // loop's frame budget holds too (a run without it: the test after this one)
    const loop = realTimeLoop({ paintCpuMs: 2 });
    const { physics, maxGap } = playVsync(loop, 10, { stepCpuMs: 40, unlimited: true });
    expect(Math.max(...physics)).toBeLessThanOrEqual(28 + 40 + 0.5);
    expect(loop.budget.slow).toBe(true);
    expect(loop.budget.fraction).toBeLessThan(0.9);
    const paints = loop.paints();
    for (let i = 1; i < paints.length; i++) expect(paints[i][1] - paints[i - 1][1]).toBeLessThanOrEqual(MIN_DRAW_INTERVAL_MS + maxGap + 1e-6);
    // the drawn frames' frameMs add up to the wall time between them: the camera, the clocks and the elapsed time miss nothing
    expect(coveredMs(paints)).toBeCloseTo(paints[paints.length - 1][1] - paints[0][1], 6);
    const real = loop.realTime();
    expect(real.debtMs).toBeLessThanOrEqual(DEBT_CAP_MS);
    expect(real.lostMs).toBeGreaterThan(0);
    expect(real.framesSkipped).toBeGreaterThan(0);
    // once the debt sits at its cap, skipping a frame would repay nothing: every due frame is drawn – 20 a second (a 40 ms
    // step and its picture span three vsyncs), not the 10 fps floor – and the time is lost, and shown
    const skipped = real.framesSkipped;
    const drawn = paints.length;
    playVsync(loop, 5, { stepCpuMs: 40, unlimited: true });
    expect(real.framesSkipped).toBe(skipped);
    expect(loop.paints().length - drawn).toBeGreaterThanOrEqual(95);
    expect(loop.budget.slow).toBe(true);
  });

  it("never plays a run slower than the switch on: a frame drawn while it still owes runs at least the old loop's steps", () => {
    // --- review fix --- A draw-heavy default run (Colour Sort at 6x CPU throttle: 15 ms a step, 70 ms a picture): the clock
    // drew every callback with one step in its frame budget and played at 0.41 of real time, the old loop at 0.6. Without
    // No limits the old loop had no frame budget: a drawn frame now runs at least the steps it ran.
    for (const [stepCpuMs, paintCpuMs] of [[15, 70], [10, 47], [40, 2]] as const) {
      const on = fakes({ slowMotion: true, offline: false, paintCpuMs });
      on.bind(harness(currentLoop(), on.env, cut(REAL_TIME_START, REAL_TIME_END)));
      const old = { ...on, clock: on.clock, realTime: () => on.harness().realTime!, paints: () => paintsOf(on.log) };
      const off = realTimeLoop({ paintCpuMs });
      for (const loop of [old, off]) playVsync(loop, 1, { stepCpuMs }); // (the first second: the old loop's first frame counts from 0)
      const [oldFrom, offFrom, oldPaints, offPaints] = [old.steps(), off.steps(), old.paints().length, off.paints().length];
      for (const loop of [old, off]) playVsync(loop, 10, { stepCpuMs });
      const label = `${stepCpuMs} ms steps, ${paintCpuMs} ms pictures: off ${off.steps() - offFrom}, on ${old.steps() - oldFrom}`;
      expect(off.steps() - offFrom, label).toBeGreaterThanOrEqual(old.steps() - oldFrom);
      expect(off.elapsed(), label).toBeCloseTo(off.steps() * STEP_MS, 6);
      expect(off.paints().length - offPaints, label).toBeGreaterThanOrEqual(0.9 * (old.paints().length - oldPaints)); // (the frames come about as often)
      expect(off.budget.slow, label).toBe(true); // what it still cannot keep up with is shown
    }
  });

  it("starts its clock and its badge over with a new run (R, Restart): no debt, lost time or badge of the run before", () => {
    // --- review fix --- R keeps the run playing, so the clock never started over: the new run's first frame owed 450 ms, its
    // lost time counted on from the old run's and the badge stayed on into it
    const f = fakes({ slowMotion: false, offline: false, paintCpuMs: 2 });
    const engine = f.env.engine as { getElapsedMs: () => number };
    let origin = 0;
    f.env.engine = { ...(f.env.engine as object), getElapsedMs: () => engine.getElapsedMs() - origin };
    f.bind(harness(currentLoop(), f.env, cut(REAL_TIME_START, REAL_TIME_END)));
    const loop = { ...f, clock: f.clock, realTime: () => f.harness().realTime!, paints: () => paintsOf(f.log) };
    playVsync(loop, 4, { stepCpuMs: 40, unlimited: true });
    const clock = loop.realTime();
    expect(clock.lostMs).toBeGreaterThan(0);
    expect(clock.debtMs).toBeGreaterThan(DEBT_CAP_MS / 2);
    expect(loop.budget.slow).toBe(true);
    origin = engine.getElapsedMs(); // the engine starts the new run at 0 s
    const steps = loop.steps();
    let now = Math.ceil(loop.clock.cpu / (1000 / 60)) * (1000 / 60);
    loop.callback(steady({ stepCpuMs: 0.05 }), now);
    expect([clock.debtMs, clock.lostMs, clock.framesSkipped, loop.steps() - steps]).toEqual([0, 0, 0, 0]);
    expect(loop.budget.slow).toBe(false);
    for (let i = 0; i < 30; i++) loop.callback(steady({ stepCpuMs: 0.05 }), (now += 1000 / 60));
    expect(loop.steps() - steps).toBeGreaterThanOrEqual(29); // a step a frame of the new run: none of the old debt
    expect(loop.steps() - steps).toBeLessThanOrEqual(30);
    expect(clock.lostMs).toBe(0);
    expect(loop.budget.slow).toBe(false);
  });

  it("owes nothing while the run is paused, not started or held, and draws every due frame then", () => {
    const loop = realTimeLoop();
    playVsync(loop, 2, { paused: true });
    playVsync(loop, 2, { started: false });
    playVsync(loop, 2, { held: true });
    expect(loop.steps()).toBe(0);
    expect(loop.paints().length).toBeGreaterThanOrEqual(358);
    expect(loop.budget.slow).toBe(false);
  });

  it("treats a hidden tab as a pause: no burst of steps when it comes back", () => {
    const loop = realTimeLoop();
    playVsync(loop, 1);
    const before = loop.steps();
    loop.clock.cpu += 30_000;
    playVsync(loop, 0.01);
    expect(loop.steps() - before).toBeLessThanOrEqual(1);
  });

  it("starts its clock over when the switch turns back off, so the time the old loop already ran is not paid twice", () => {
    const f = fakes({ slowMotion: false, offline: false });
    let slowMotion = false;
    f.env.engine = { ...(f.env.engine as object), slowMotionOn: () => slowMotion };
    f.bind(harness(currentLoop(), f.env, cut(REAL_TIME_START, REAL_TIME_END)));
    let now = 1000;
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) f.callback(steady(), (now += 1000 / 60));
    };
    tick(30);
    slowMotion = true; // the old loop runs these 400 ms
    tick(24);
    const before = f.steps();
    slowMotion = false;
    tick(1);
    expect(f.steps() - before).toBe(0);
    tick(60);
    expect(f.steps() - before).toBeGreaterThanOrEqual(59);
    expect(f.steps() - before).toBeLessThanOrEqual(60);
  });
});

/* ------------------------------------------------------------------ the honest badge */

describe("the badges with Slow motion off (--- slow-motion ---): the real-time badge alone, SLOW-MO only for what still runs slow", () => {
  /** A 2D context that records the texts drawn (every other call is a no-op). */
  function textCtx() {
    const texts: string[] = [];
    const target: Record<string, unknown> = {
      fillText: (text: string) => texts.push(String(text)),
      measureText: (text: string) => ({ width: 8 * String(text).length }),
    };
    const ctx = new Proxy(target, {
      get: (t, key) => (typeof key === "string" && !(key in t) ? (t[key] = () => undefined) : t[key as string]),
      set: (t, key, value) => {
        t[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, texts };
  }
  const OFF_VIEW: UnlimitedView = { on: false, crowd: 0, objects: 3, full: false, bounces: 0, ate: false, ateRadius: 0, rescued: 0 };

  it("shows the real-time badge while No limits is off only when asked (forceRealTime), and then alone", () => {
    const layer = new UnlimitedLayer();
    const slow = { slow: true, ratio: 0.4 };
    const draw = (view: UnlimitedView, time: { slow: boolean; ratio: number }, force: boolean) => {
      const { ctx, texts } = textCtx();
      layer.drawHud(ctx, view, time, DEFAULT_UNLIMITED_LABELS, 0, 0, 800, 0, 0, force);
      return texts;
    };
    // on (the default): No limits off draws nothing, as it always did
    expect(draw(OFF_VIEW, slow, false)).toEqual([]);
    // off: the badge, whatever No limits says – and nothing while the run keeps up
    expect(draw(OFF_VIEW, slow, true)).toEqual(["x0.4 REAL TIME"]);
    expect(draw(OFF_VIEW, { slow: false, ratio: 1 }, true)).toEqual([]);
    // a full arena or a crowd belong to No limits: never with it off, all three with it on
    expect(draw({ ...OFF_VIEW, full: true, crowd: 50 }, slow, true)).toEqual(["x0.4 REAL TIME"]);
    expect(draw({ ...OFF_VIEW, on: true, full: true, crowd: 50 }, slow, false)).toEqual(["ARENA FULL", "x0.4 REAL TIME", "53 BALLS"]);
  });

  it("draws a split-screen race's real-time badge once, from the lanes' clock, while the race falls behind", () => {
    // --- review fix --- the arenas draw offline (their frame budget starts over every frame): the stage had no badge at all,
    // the lost time only in a data attribute. Two arenas of 30 ms steps on a 60 Hz clock: about half of real time.
    const lanes = new RealTimeLanes();
    const badge = new RaceRealTimeBadge();
    const cpu = { ms: 0 };
    const fns = [0, 1].map(() => () => ((cpu.ms += 30), 1));
    let now = 0;
    const frame = (running = true, runMs?: number) => {
      now = Math.max(now + 1000 / 60, cpu.ms);
      cpu.ms = now;
      const t = lanes.tick(now, { running, simSpeed: 1, drawDue: true, frameBudget: false, runMs }, fns, () => cpu.ms);
      badge.note(t, running);
      const { ctx, texts } = textCtx();
      return { drawn: badge.draw(ctx, DEFAULT_UNLIMITED_LABELS, 0, 0, 800, now, 52), texts };
    };
    for (let i = 0; i < 120; i++) frame(true, 1000 + i);
    const behind = frame(true, 2000);
    expect(badge.slow).toBe(true);
    expect(badge.time.ratio).toBeLessThan(0.9);
    expect(behind.drawn).toBe(true);
    expect(behind.texts).toEqual([`x${formatRealTime(badge.time.ratio)} REAL TIME`]); // the badge alone: no crowd, no ARENA FULL
    // paused: no badge; a new race (the page engine's clock back): it starts over too
    expect(frame(false).drawn).toBe(false);
    for (let i = 0; i < 120; i++) frame(true, 3000 + i);
    expect(badge.slow).toBe(true);
    expect(frame(true, 0).drawn).toBe(false);
    // a race that keeps up never shows it
    const light = new RealTimeLanes();
    const quiet = new RaceRealTimeBadge();
    const cheap = [0, 1].map(() => () => 1);
    for (let i = 0; i < 120; i++) quiet.note(light.tick(i * (1000 / 60), { running: true, simSpeed: 1, drawDue: true, frameBudget: false }, cheap, () => 0), true);
    expect(quiet.slow).toBe(false);
    expect(quiet.draw(textCtx().ctx, DEFAULT_UNLIMITED_LABELS, 0, 0, 800, 0)).toBe(false);
  });

  it("tags SLOW-MO with the dilation the page does not repay: none for the engine's own, the bounce-math clock's share stays", () => {
    const changedAt = { speed: -Infinity, size: -Infinity, damage: -Infinity, bounce: -Infinity, gravity: -Infinity, balls: -Infinity };
    const mv = (dilation: number) => ({ active: true, speed: 1, size: 1, damage: 1, bounce: 1, gravity: 1, balls: 1, changedAt, dilation }) as unknown as MultiplierView;
    const draw = (dilation: number, repaid?: number) => {
      const { ctx, texts } = textCtx();
      drawMultiplierHud(ctx, mv(dilation), DEFAULT_MULTIPLIER_LABELS, 0, 0, 800, 0, null, null, undefined, repaid);
      return texts;
    };
    // on (the default, repaid 1): the old tag
    expect(draw(0.25)).toEqual(["SLOW-MO x0.25"]);
    expect(draw(0.25, 1)).toEqual(["SLOW-MO x0.25"]);
    expect(draw(1)).toEqual([]);
    // off, live: the engine's dilation of 0.25 is repaid with four steps a frame – no tag; a 2^-20 one the same
    expect(draw(0.25, 0.25)).toEqual([]);
    expect(draw(2 ** -20, 2 ** -20)).toEqual([]);
    // a bounce-math "timeScale" rule of 0.5 on top (the view's 0.125) is the visitor's own slow motion: it stays
    expect(draw(0.125, 0.25)).toEqual(["SLOW-MO x0.5"]);
    // a step scale that is no share (0, negative, NaN) changes nothing
    expect(draw(0.25, 0)).toEqual(["SLOW-MO x0.25"]);
    expect(draw(0.25, NaN)).toEqual(["SLOW-MO x0.25"]);
  });

  it("mirrors the switch in data attributes: none at all while it is on, the clock's numbers while it is off", () => {
    const dataset: Record<string, string> = {};
    const set = (key: string, value: string) => (dataset[key] = value);
    const time = { slow: true, ratio: 0.42 };
    writeSlowMotionDataset(true, null, time, 0, set, dataset);
    expect(dataset).toEqual({});
    writeSlowMotionDataset(false, { debtMs: 120.4, lostMs: 3000.6, framesSkipped: 7 }, time, 3, set, dataset);
    expect(dataset).toEqual({ slowMotion: "0", dipsSkipped: "3", realtimeRatio: "0.420", realtimeSlow: "1", realtimeDebtMs: "120", realtimeLostMs: "3001", framesSkipped: "7" });
    // offline (an export's frames, no live clock): the switch and the dips only
    writeSlowMotionDataset(false, null, time, 4, set, dataset);
    expect(dataset).toEqual({ slowMotion: "0", dipsSkipped: "4" });
    // back on: every key is gone
    writeSlowMotionDataset(false, { debtMs: 0, lostMs: 0, framesSkipped: 0 }, time, 0, set, dataset);
    writeSlowMotionDataset(true, null, time, 0, set, dataset);
    expect(dataset).toEqual({});
    expect(SLOW_MOTION_DATA_KEYS).toEqual(["slowMotion", "dipsSkipped", "realtimeRatio", "realtimeSlow", "realtimeDebtMs", "realtimeLostMs", "framesSkipped"]);
  });
});

/* ------------------------------------------------------------------ the switch off, offline */

/** The real-time and offline blocks of Canvas.tsx and draw() after them, offline on fakes: an export's (or a still's) frames. */
function offlineLoop(opts: { dilation?: number; pacesSteps?: boolean; paintCpuMs?: number } = {}) {
  const f = fakes({ slowMotion: false, offline: true, ...opts });
  f.bind(harness(currentLoop(), f.env, cut(REAL_TIME_START, REAL_TIME_END), cut(OFFLINE_START, OFFLINE_END)));
  let now = 0;
  /** Draws `n` frames on the export's clock (1000 / 60 apart), returning the steps each frame ran. */
  const frames = (n: number, over: Partial<Callback> = {}) => {
    const perFrame: number[] = [];
    for (let i = 0; i < n; i++) {
      const before = f.steps();
      now += 1000 / 60;
      f.clock.offlineNow = now;
      f.callback(steady(over), now);
      perFrame.push(f.steps() - before);
    }
    return perFrame;
  };
  return { ...f, frames, paints: () => paintsOf(f.log) };
}

describe("the offline frames with Slow motion off (--- slow-motion ---): real time on steps, never on a wall clock", () => {
  it("pays a frame's time with one step at real time and draws every frame, the camera told the switch", () => {
    const loop = offlineLoop();
    const perFrame = loop.frames(600);
    expect(perFrame.every((n) => n === 1)).toBe(true);
    expect(loop.paints()).toHaveLength(600);
    expect(loop.paints().every((e) => Math.abs(e[2] - 1000 / 60) < 1e-6)).toBe(true); // each frame's frameMs is the export's frame
    expect(loop.cam.slowMotion).toBe(false);
    expect(loop.log.filter((e) => (e as unknown[])[0] === "afterStep")).toHaveLength(600); // (the replay's ring buffer, step by step)
  });

  it("repays the engine's time dilation with steps: a quarter-step run exports its simulated time in real time", () => {
    const loop = offlineLoop({ dilation: 0.25 });
    const perFrame = loop.frames(600);
    expect(perFrame.slice(1).every((n) => n === 4)).toBe(true);
    expect(loop.elapsed()).toBeGreaterThan(9_980);
    expect(loop.elapsed()).toBeLessThan(10_010);
  });

  it("runs at most EXPORT_CATCH_UP_STEPS a frame: past it the frame plays slower than real time, and the frames still come", () => {
    const loop = offlineLoop({ dilation: 2 ** -20 });
    const perFrame = loop.frames(20);
    expect(perFrame.every((n) => n === EXPORT_CATCH_UP_STEPS)).toBe(true);
    expect(loop.paints()).toHaveLength(20);
  });

  it("only draws for a driver that paces the steps itself (the fast export's payExportFrame(), a race's stage)", () => {
    const loop = offlineLoop({ pacesSteps: true, dilation: 0.25 });
    expect(loop.frames(120).every((n) => n === 0)).toBe(true);
    expect(loop.paints()).toHaveLength(120);
  });

  it("owes nothing while the run is paused or not started, and is the same frames twice (no wall clock)", () => {
    const loop = offlineLoop({ dilation: 0.25 });
    expect(loop.frames(60, { paused: true }).every((n) => n === 0)).toBe(true);
    expect(loop.frames(60, { started: false }).every((n) => n === 0)).toBe(true);
    const a = offlineLoop({ dilation: 1 / 3, paintCpuMs: 5 });
    const b = offlineLoop({ dilation: 1 / 3, paintCpuMs: 0 });
    const fa = a.frames(300, { stepCpuMs: 3 });
    const fb = b.frames(300, { stepCpuMs: 0.01 });
    expect(fb).toEqual(fa); // a slow machine and a fast one: the same steps in the same frames
    expect(b.elapsed()).toBe(a.elapsed());
  });
});
