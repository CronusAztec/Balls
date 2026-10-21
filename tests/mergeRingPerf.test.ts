import { describe, expect, it } from "vitest";
import { BROADPHASE_MIN_BALLS, PAIR_ITERATIONS, type MergeRingSettings } from "@/lib/physics/modes/mergeRing";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";

/**
 * Merge Ring's cost (feature merge-ring, the lag fix): the pair solver's broadphase visits exactly the pairs the plain
 * double loop would, in the same order – every run is bit for bit the same with it on or off – while a full pile costs
 * far fewer than n² distance checks a pass.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 450,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 24,
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

/** A Merge Ring engine; `broadphase`: the solver's list from that many balls up (0: always), or off (the plain double loops). */
function engineOf(mergeRing: Partial<MergeRingSettings>, seed: number, cfg: Partial<PhysicsConfig> = {}, broadphase: number | false = BROADPHASE_MIN_BALLS): PhysicsEngine {
  const engine = createEngineForSettings({ ...config, ...cfg }, "mergeRing", { ...modeSettings, mergeRing }, seed);
  if (broadphase === false) engine.mergeRingMode.setBroadphase(false);
  else engine.mergeRingMode.setBroadphase(true, broadphase);
  return engine;
}

/** Every number of every ball, the tiers and the counters: two runs are the same only when all of it is identical. */
function state(engine: PhysicsEngine) {
  const v = engine.getMergeRingView();
  return {
    balls: engine.getBalls().map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.radius, v.tierOf.get(b.id)]),
    counters: [v.spawned, v.merges, v.thuds, v.notes, v.topTier, v.finalMs, v.overflowMs, v.finishedMs],
  };
}

describe("Merge Ring's pair solver cost", () => {
  it("the broadphase changes nothing: every step of every run is bit for bit the plain double loop's", () => {
    // (the list forced on from the first ball, so even the small default piles go through it)
    const cases: { name: string; mr: Partial<MergeRingSettings>; seed: number; cfg?: Partial<PhysicsConfig>; audio?: number; secs: number }[] = [
      { name: "default s1", mr: {}, seed: 1, secs: 50 },
      { name: "default s3", mr: {}, seed: 3, secs: 60 },
      { name: "mrt=10 fast", mr: { tiers: 10, interval: 0.3, spawnTiers: 3 }, seed: 5, secs: 40 },
      { name: "small balls, a full pile", mr: { tiers: 10, interval: 0.3, spawnTiers: 1 }, seed: 2, cfg: { ballRadius: 6 }, secs: 60 },
      { name: "jammed ring, loud mix", mr: { tiers: 6, interval: 0.3, spawnTiers: 3 }, seed: 32, cfg: { width: 906, height: 509 }, audio: 0.3, secs: 40 },
      { name: "heavy drops", mr: { interval: 0.3, gravity: 3, tiers: 10 }, seed: 1, secs: 35 },
    ];
    for (const c of cases) {
      const fast = engineOf(c.mr, c.seed, c.cfg, 0);
      const plain = engineOf(c.mr, c.seed, c.cfg, false);
      for (let i = 1; i <= c.secs * 60; i++) {
        fast.update(STEP, c.audio ?? 0);
        plain.update(STEP, c.audio ?? 0);
        const evFast = fast.consumeSoundEvents();
        const evPlain = plain.consumeSoundEvents();
        expect(evFast, `${c.name}: sounds at step ${i}`).toEqual(evPlain);
        if (i % 30 === 0 || fast.isSimulationFinished()) expect(state(fast), `${c.name}: step ${i}`).toEqual(state(plain));
        if (fast.isSimulationFinished() && plain.isSimulationFinished()) break;
      }
      expect(state(fast), c.name).toEqual(state(plain));
      // the plain loop checked every pair every pass; the broadphase far fewer
      expect(fast.mergeRingMode.getSolverStats().pairChecks, c.name).toBeLessThan(plain.mergeRingMode.getSolverStats().pairChecks);
    }
  }, 60_000);

  it("a full pile costs far fewer than n² distance checks a pass", () => {
    // 160 small balls of the top tier (it never merges) poured into the ring: a pile far fuller than a run ever gets.
    const engine = engineOf({ tiers: 10, interval: 3 }, 2, { ballRadius: 6 });
    expect(BROADPHASE_MIN_BALLS).toBeLessThan(150);
    const v = engine.getMergeRingView();
    const L = v.layout!;
    engine.setBalls([]);
    v.tierOf.clear();
    for (let k = 0; k < 160; k++) {
      const row = Math.floor(k / 16);
      const col = k % 16;
      engine.addBall({ x: L.cx - 105 + 14 * col + (row % 2) * 7, y: L.cy + 150 - 13 * row, vx: 0, vy: 0, radius: 6, color: "#fff", gravityScale: 1 });
      v.tierOf.set(engine.getBalls()[k].id, 10);
    }
    const stats = engine.mergeRingMode.getSolverStats();
    let measured = 0;
    for (let i = 1; i <= 4 * 60; i++) {
      const n = engine.getBalls().length;
      const before = stats.pairChecks;
      const subSteps = stats.subSteps;
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      if (engine.getBalls().length !== n || n < 150) continue;
      // per pass of the solver (the merge scan's checks included), against the n (n − 1) / 2 of the double loop
      const perPass = (stats.pairChecks - before) / ((stats.subSteps - subSteps) * PAIR_ITERATIONS);
      expect(perPass, `${n} balls at step ${i}`).toBeLessThan(0.1 * ((n * (n - 1)) / 2));
      measured++;
    }
    expect(measured).toBeGreaterThan(200);
    // the list stays put through the passes: about one build a sub-step
    expect(stats.builds / stats.subSteps).toBeLessThan(1.5);
    // and the pile it solved is the double loop's, bit for bit
    const plain = engineOf({ tiers: 10, interval: 3 }, 2, { ballRadius: 6 }, false);
    const pv = plain.getMergeRingView();
    plain.setBalls([]);
    pv.tierOf.clear();
    for (let k = 0; k < 160; k++) {
      const row = Math.floor(k / 16);
      const col = k % 16;
      plain.addBall({ x: L.cx - 105 + 14 * col + (row % 2) * 7, y: L.cy + 150 - 13 * row, vx: 0, vy: 0, radius: 6, color: "#fff", gravityScale: 1 });
      pv.tierOf.set(plain.getBalls()[k].id, 10);
    }
    for (let i = 1; i <= 4 * 60; i++) {
      plain.update(STEP, 0);
      plain.consumeSoundEvents();
    }
    expect(state(engine)).toEqual(state(plain));
  }, 30_000);
});
