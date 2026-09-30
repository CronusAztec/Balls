import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { ON_BEAT_MODES, ON_BEAT_TOLERANCE_SEC, type OnBeatConfig } from "@/lib/physics/onBeat";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";
import { analysisBeatSource, beatClockConfigOf, bpmBeatSource, gridErrorSec, manualBeatSource } from "@/lib/simulation/beatSource";
import { beatCoverage, createEngineForSettings, type FinderRequest } from "@/lib/simulation/finder";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { fakeGraph } from "./fakeAudio";

const config: PhysicsConfig = { width: 900, height: 506, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const STEP = 1000 / 60;

function onBeat(clockBpm = 120, patch: Partial<OnBeatConfig> = {}): OnBeatConfig {
  return { enabled: true, clock: beatClockConfigOf(bpmBeatSource(clockBpm, 120), clockBpm), range: 0.5, subdivisions: 2, ...patch };
}

function engineFor(mode: ModeId, seed: number, beat?: Partial<OnBeatConfig>, extra: Partial<PhysicsConfig> = {}) {
  const engine = new PhysicsEngine({ ...config, ...extra });
  if (beat) engine.setOnBeat(beat);
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

function run(engine: PhysicsEngine, frames: number, onHit?: (t: number) => void) {
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    for (const ev of engine.consumeSoundEvents()) if (ev.type === "hit" && onHit) onHit(engine.getElapsedMs() / 1000);
  }
}

const state = (engine: PhysicsEngine) => engine.getBalls().map((b) => [b.x, b.y, b.vx, b.vy, b.gravityScale ?? 1]);

describe("On beat in the ring modes", () => {
  it("lands every timed wall hit on the beat grid (within the tolerance, well inside 30 ms)", () => {
    const engine = engineFor("classic", 1234, onBeat(120));
    const clock = engine.getOnBeatConfig().clock!;
    const hitTimes: number[] = [];
    run(engine, 60 * 30, (t) => hitTimes.push(t));
    const stats = engine.getOnBeatStats();
    expect(stats.active).toBe(true);
    expect(stats.hits).toBeGreaterThan(30);
    expect(stats.onBeat).toBe(stats.hits);
    expect(stats.maxErrMs).toBeLessThanOrEqual(1000 * ON_BEAT_TOLERANCE_SEC);
    expect(stats.beatsCovered).toBeGreaterThan(20);
    // Most wall hits are timed (the rest are short hops between two close rings).
    expect(stats.hits / (stats.hits + stats.unplanned)).toBeGreaterThan(0.8);
    const onGrid = hitTimes.filter((t) => Math.abs(gridErrorSec(clock, t, 2)) <= ON_BEAT_TOLERANCE_SEC).length;
    expect(onGrid / hitTimes.length).toBeGreaterThan(0.8);
  });

  it("follows an irregular hand-placed grid (a song that drifts) as well as a steady one", () => {
    let seed = 99;
    const jitter = () => (((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1) * 0.02;
    const markers = Array.from({ length: 70 }, (_, i) => 1000 * (0.2 + i * 0.47 + jitter()));
    const clock = beatClockConfigOf(manualBeatSource(markers, { duration: 0, offset: 0, loop: false }), 120);
    const engine = engineFor("classic", 77, { enabled: true, clock, range: 0.5, subdivisions: 2 });
    run(engine, 60 * 25);
    const stats = engine.getOnBeatStats();
    expect(stats.hits).toBeGreaterThan(20);
    expect(stats.onBeat).toBe(stats.hits);
  });

  it("is deterministic: the same seed and grid replay the same flights and the same hits", () => {
    for (const mode of ["classic", "shatter", "portal"] as ModeId[]) {
      const a = engineFor(mode, 4242, onBeat(128));
      const b = engineFor(mode, 4242, onBeat(128));
      run(a, 60 * 12);
      run(b, 60 * 12);
      expect(state(b)).toEqual(state(a));
      expect({ ...b.getOnBeatStats() }).toEqual({ ...a.getOnBeatStats() });
    }
  });

  it("leaves a run without On beat exactly as it was (switched off, or never configured)", () => {
    const plain = engineFor("classic", 31337);
    const off = engineFor("classic", 31337, onBeat(120, { enabled: false }));
    run(plain, 60 * 10);
    run(off, 60 * 10);
    expect(state(off)).toEqual(state(plain));
    expect(off.getOnBeatStats().active).toBe(false);
  });

  it("only retimes flights: the path of a timed flight is the natural one, and switching off restores the natural speed", () => {
    const timed = engineFor("classic", 5150, onBeat(100));
    // One step: the first flight is planned (and retimed) at the end of it.
    run(timed, 1);
    const ball = timed.getBalls()[0];
    const natural = engineFor("classic", 5150);
    run(natural, 1);
    const free = natural.getBalls()[0];
    // Same position, velocity pointing the same way (only its length may differ), gravity scaled by the square of it.
    expect(ball.x).toBeCloseTo(free.x, 9);
    expect(ball.y).toBeCloseTo(free.y, 9);
    const c = Math.hypot(ball.vx, ball.vy) / Math.hypot(free.vx, free.vy);
    expect(Math.abs(ball.vx * free.vy - ball.vy * free.vx)).toBeLessThan(1e-6 * Math.hypot(free.vx, free.vy) ** 2);
    expect(ball.gravityScale ?? 1).toBeCloseTo(c * c, 9);
    expect(c).toBeGreaterThanOrEqual(1 / 1.5 - 1e-9);
    expect(c).toBeLessThanOrEqual(1.5 + 1e-9);
    // Off mid-flight: the ball flies on at its natural speed.
    timed.setOnBeat({ enabled: false });
    run(timed, 1);
    expect(timed.getBalls()[0].gravityScale).toBeUndefined();
    expect(timed.getOnBeatStats().active).toBe(false);
  });

  it("applies to the ten ring modes only", () => {
    expect(ON_BEAT_MODES).toHaveLength(10);
    const drop = engineFor("drop", 9, onBeat(120));
    run(drop, 120);
    expect(drop.getOnBeatStats().active).toBe(false);
    const multiply = engineFor("multiply", 9, onBeat(120));
    run(multiply, 60 * 8);
    expect(multiply.getOnBeatStats().active).toBe(true);
    expect(multiply.getOnBeatStats().hits).toBeGreaterThan(5);
  });

  it("does nothing without a tempo", () => {
    const engine = engineFor("classic", 1, { enabled: true, clock: null });
    run(engine, 120);
    expect(engine.getOnBeatStats().active).toBe(false);
  });
});

describe("On beat in the finder", () => {
  it("builds the same run as the page and reports the beats a found seed covers", () => {
    const beat = onBeat(120);
    const request: FinderRequest = {
      targetDurationSec: 30,
      toleranceSec: 0.5,
      maxSeeds: 1,
      maxSimTimeSec: 60,
      physicsConfig: { ...config },
      mode: "classic",
      modeSettings: {
        bouncierEnabled: false,
        countdownTotal: 10,
        countdownRandom: false,
        colorMatchColorCount: 3,
        accumulationTimerMax: 5000,
        spikesEnabled: false,
        spikeCount: 3,
        multiplySpawnCount: 2,
        shatterSegmentsPerWall: 8,
        shatterHpPerSegment: 1,
        growRate: 5,
        portalCount: 2,
        twoBalls: false,
        drop: {},
        box: {},
        onBeat: beat,
      },
    };
    const finderEngine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, 2024);
    const page = engineFor("classic", 2024, beat);
    run(finderEngine, 600);
    run(page, 600);
    expect(state(finderEngine)).toEqual(state(page));
    const coverage = beatCoverage(2024, request, 15000);
    expect(coverage.beatsCovered).toBeGreaterThan(5);
    expect(coverage.beatHits).toBeGreaterThanOrEqual(coverage.beatsCovered!);
    expect(beatCoverage(2024, { ...request, modeSettings: { ...request.modeSettings, onBeat: undefined } }, 15000)).toEqual({});
  });
});

describe("the beat lock on a media or manual grid", () => {
  let graph: ReturnType<typeof fakeGraph>;
  let tone: ToneGenerator;
  beforeEach(async () => {
    graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    tone = new ToneGenerator();
    await tone.start();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("delays a hit to the grid's next point on the simulation clock (and the BPM grid returns without it)", () => {
    const grid = analysisBeatSource("media", { bpm: 100, beatTimes: [0.3, 0.9, 1.5, 2.1, 2.7], duration: 3 }, { offset: 0, loop: true });
    let sim = 0.62;
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" });
    tone.setBeatSourceClock(beatClockConfigOf(grid, 120), () => sim);
    graph.ctx.currentTime = 10;
    tone.playWallHit(0);
    expect(graph.oscillators.at(-1)?.startAt).toBeCloseTo(10 + (0.9 - 0.62), 9);
    // Eighths: the point between 0.9 and 1.5.
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/8" });
    sim = 1.0;
    graph.ctx.currentTime = 20;
    tone.playWallHit(0);
    expect(graph.oscillators.at(-1)?.startAt).toBeCloseTo(20 + 0.2, 9);
    // Without the source the BPM grid from the run's start applies again (0.25 s eighths at 120 BPM).
    tone.setBeatSourceClock(null, null);
    graph.ctx.currentTime = 30.1;
    tone.playWallHit(0);
    expect(graph.oscillators.at(-1)?.startAt).toBeCloseTo(30.25, 9);
  });
});
