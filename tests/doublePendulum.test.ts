import { describe, expect, it } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { ChainStepper, MAX_ANGLE_PER_SUBSTEP, MAX_SUBSTEPS, MIN_SUBSTEPS, PendulumChain, STEP_TOLERANCE, collideBobs, createContactScratch, solveSpd, wrapAngle } from "@/lib/physics/pendulumChain";
import {
  BUTTERFLY_OFFSET_DEG,
  DEFAULT_DOUBLE_PENDULUM_SETTINGS,
  DOUBLE_PENDULUM_RANGES,
  DP_GRAVITY,
  DP_URL_KEYS,
  HIT_ACCENT_STRENGTH,
  SPAR_PIVOT_DISTANCE,
  bobModelRadius,
  buildDpField,
  buildHarpGeometry,
  chainLengths,
  closingChordEvent,
  crossedIndices,
  dampingRate,
  finaleStartSec,
  doublePendulumSettingFields,
  doublePendulumSettingsOf,
  harpBaseMidi,
  harpCrossings,
  harpLadder,
  harpStringMidi,
  mirrorOverlaps,
  pluckLevel,
  resolveDoublePendulumSettings,
  sparHitPitch,
  wrapDelta,
  type DoublePendulumSettings,
} from "@/lib/physics/modes/doublePendulum";
import { drawDoublePendulumBodies, drawDoublePendulumStrings, drawDoublePendulumTrails, stringDisplacement, stringEnvelope, trailBands, trailFade, trailHue, type DoublePendulumRenderOptions } from "@/components/simulator/doublePendulumRenderer";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { midiToFrequency } from "@/lib/audio/scales";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Double Pendulum (lib/physics/modes/doublePendulum.ts, lib/physics/pendulumChain.ts): the chain integrator (the
 * equations against the normal modes, the energy drift over two minutes without friction – light bobs over heavy ones
 * included –, the error-controlled Dormand–Prince sub-steps, friction only ever removing energy, elastic bob
 * collisions), the string-crossing detection (exactly once per crossing across sub-steps, vertical and radial), the harp
 * tuning, the mode in the engine (plucks and their pitches, the butterfly start, sparring, the finish, live changes,
 * restarts, determinism, resizes), the finder (fixed run length, endless), the settings (URL, presets, ranges) and the
 * renderer's pure helpers.
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

function dpEngine(dp: Partial<DoublePendulumSettings>, seed = 7, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "doublePendulum", { ...modeSettings, doublePendulum: dp }, seed);
}

/** Runs `frames` 60 Hz steps and collects every sound event. */
function run(engine: PhysicsEngine, frames: number): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

/** Steps a chain the way the mode does: error-controlled Dormand–Prince sub-steps from a `ChainStepper`. */
function advance(chain: PendulumChain, steps: number, stepSec = 1 / 60, each?: () => void) {
  const stepper = new ChainStepper();
  const chains = [chain];
  for (let i = 0; i < steps; i++) {
    stepper.begin(stepSec);
    while (stepper.subStep(chains) > 0);
    each?.();
  }
}

/* ------------------------------------------------------------------ integrator */

describe("chain integrator", () => {
  it("solves the symmetric positive definite systems of the mass matrix", () => {
    const a = new Float64Array([4, 1, 2, 1, 3, 0.5, 2, 0.5, 5]);
    const x = [1, -2, 0.5];
    const b = new Float64Array([4 * 1 + 1 * -2 + 2 * 0.5, 1 * 1 + 3 * -2 + 0.5 * 0.5, 2 * 1 + 0.5 * -2 + 5 * 0.5]);
    solveSpd(a, b, 3);
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(x[i], 12);
    const a2 = new Float64Array([2, 1, 1, 2]);
    const b2 = new Float64Array([3, 3]);
    solveSpd(a2, b2, 2);
    expect(b2[0]).toBeCloseTo(1, 12);
    expect(b2[1]).toBeCloseTo(1, 12);
  });

  it("wraps angles into (−π, π] without changing where the rods point", () => {
    for (const a of [0, 1, Math.PI, -Math.PI, 3 * Math.PI, -7.5, 100.25]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
    }
    expect(wrapDelta(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapDelta(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("swings in the normal modes of the linearised double pendulum: ω² = (g / l)(2 ∓ √2) with θ₂ = ±√2 θ₁", () => {
    const l = 0.5;
    const g = 9.81;
    for (const sign of [1, -1]) {
      const chain = new PendulumChain({ links: 2, lengths: [l, l], masses: [1, 1], gravity: g, damping: 0 });
      const a = 0.004;
      chain.setState([a, sign * Math.SQRT2 * a]);
      const omega = Math.sqrt((g / l) * (2 - sign * Math.SQRT2));
      const period = (2 * Math.PI) / omega;
      // Fine fixed steps: 2400 per period.
      const h = period / 2400;
      const at = (steps: number) => {
        for (let i = 0; i < steps; i++) chain.step(h);
      };
      at(600); // a quarter period: both rods through the vertical
      expect(Math.abs(chain.theta[0])).toBeLessThan(2e-6);
      expect(Math.abs(chain.theta[1])).toBeLessThan(3e-6);
      at(600); // half a period: the mirror image
      expect(chain.theta[0]).toBeCloseTo(-a, 7);
      expect(chain.theta[1]).toBeCloseTo(-sign * Math.SQRT2 * a, 7);
      at(1200); // a full period: back where it started
      expect(chain.theta[0]).toBeCloseTo(a, 7);
      expect(chain.theta[1]).toBeCloseTo(sign * Math.SQRT2 * a, 7);
    }
  });

  it("keeps the energy of a chaotic double and triple pendulum within 1e-5 of Σm·g·L over two minutes without friction", () => {
    // `whips`: a light bob over a heavy one – the stiff rigs whose light joints whip round at hundreds of rad/s for a
    // few milliseconds; sub-steps sized from the rates at the start of a step let those drain 1–10 % of the energy.
    const cases = [
      { links: 2, lengths: [0.5, 0.5], masses: [1, 1], g: 1, start: [2.0, -0.5] },
      { links: 2, lengths: [0.3, 0.7], masses: [3, 0.5], g: 1, start: [2.6, 1.0] },
      { links: 3, lengths: [1 / 3, 1 / 3, 1 / 3], masses: [1, 1, 1], g: 1, start: [2.0, -0.5, 1.0] },
      { links: 3, lengths: [0.4, 0.35, 0.25], masses: [5, 1, 0.2], g: 1, start: [2.8, -2.0, 0.5] },
      { links: 2, lengths: [0.5, 0.5], masses: [0.2, 5], g: 1, start: [2.4, -1.0], whips: true },
      { links: 2, lengths: [1 / 6, 5 / 6], masses: [0.2, 5], g: 3, start: [2.6, -1.5], whips: true },
      { links: 3, lengths: [1 / 7, 1 / 7, 5 / 7], masses: [0.2, 0.2, 5], g: 3, start: [2.4, -1.2, 0.6], whips: true },
      { links: 3, lengths: [1 / 3, 1 / 3, 1 / 3], masses: [0.2, 5, 0.2], g: 3, start: [2.0, -0.5, 1.0], whips: true },
    ];
    for (const c of cases) {
      const chain = new PendulumChain({ links: c.links, lengths: c.lengths, masses: c.masses, gravity: DP_GRAVITY * c.g, damping: 0 });
      chain.setState(c.start);
      const scale = chain.totalMass() * DP_GRAVITY * c.g * chain.reach();
      const e0 = chain.energy();
      let worst = 0;
      let flips = 0;
      let fastest = 0;
      const prev = Array.from(chain.theta);
      advance(chain, 7200, 1 / 60, () => {
        worst = Math.max(worst, Math.abs(chain.energy() - e0) / scale);
        fastest = Math.max(fastest, chain.maxRate());
        for (let k = 0; k < c.links; k++) {
          if (Math.abs(chain.theta[k] - prev[k]) > Math.PI) flips++;
          prev[k] = chain.theta[k];
        }
      });
      expect(worst, JSON.stringify(c)).toBeLessThan(1e-5);
      // It really is the chaotic regime: rods go over the top again and again – and the stiff rigs whip.
      expect(flips, JSON.stringify(c)).toBeGreaterThan(5);
      if (c.whips) expect(fastest, JSON.stringify(c)).toBeGreaterThan(40);
    }
  }, 30_000); // eight rigs for two simulated minutes each: ~2 s alone, over the 5 s default when the whole suite shares a busy machine

  it("holds the energy of light-over-heavy rigs through the engine, like the default rig's", () => {
    // What the mode runs: settings → createEngineForSettings, no friction, endless, two minutes (the drift the canvas
    // mirrors into data-dp-drift). These rigs lost 0.2–47 % of Σm·g·L before the sub-steps were error-controlled.
    for (const [dp, seed] of [
      [{ mass1: 0.2, mass2: 5, length1: 0.2, length2: 1, gravity: 3 }, 4],
      [{ segments: 3, mass1: 0.2, mass2: 0.2, mass3: 5, length1: 0.2, length2: 0.2, length3: 1, gravity: 3 }, 1],
      [{ count: 2, segments: 3, mass1: 0.2, mass2: 5, mass3: 0.2, gravity: 3 }, 2],
    ] as [Partial<DoublePendulumSettings>, number][]) {
      const engine = dpEngine({ ...dp, damping: 0, endless: true, strings: 0 }, seed);
      const view = engine.getDoublePendulumView();
      let worst = 0;
      let most = 0;
      for (let i = 0; i < 7200; i++) {
        engine.update(STEP, 0);
        worst = Math.max(worst, Math.abs(view.energy - view.energy0) / view.energyScale);
        most = Math.max(most, view.subSteps);
      }
      expect(worst, JSON.stringify(dp)).toBeLessThan(1e-5);
      // The whips took far more sub-steps than the rates at the start of a step would have asked for.
      expect(most, JSON.stringify(dp)).toBeGreaterThan(60);
      expect(most, JSON.stringify(dp)).toBeLessThanOrEqual(MAX_SUBSTEPS + 1);
    }
  }, 30_000); // three rigs for two simulated minutes each: ~3 s here, over the 5 s default on the CI runner

  it("only ever removes energy with friction, and a per-step loss d keeps (1 − d) of the speed per 60 Hz step", () => {
    expect(dampingRate(0)).toBe(0);
    expect(Math.exp(-dampingRate(0.01) / 60)).toBeCloseTo(0.99, 12);
    const chain = new PendulumChain({ links: 2, lengths: [0.5, 0.5], masses: [1, 1], gravity: DP_GRAVITY, damping: dampingRate(0.004) });
    chain.setState([2.4, 1.0]);
    let last = chain.energy();
    const e0 = last;
    advance(chain, 1800, 1 / 60, () => {
      const e = chain.energy();
      expect(e).toBeLessThanOrEqual(last + 1e-12);
      last = e;
    });
    // After 30 s it hangs nearly still at the bottom (potential −g Σ μᵢ lᵢ = −1.5 g).
    expect(last).toBeLessThan(e0);
    expect(last).toBeCloseTo(-1.5 * DP_GRAVITY, 1);
  });

  it("resolves a bob contact with an elastic impulse through the angular velocities: kinetic energy kept, approach reversed", () => {
    const scratch = createContactScratch();
    const a = new PendulumChain({ links: 2, lengths: [0.5, 0.5], masses: [1, 2], gravity: DP_GRAVITY, damping: 0 });
    const b = new PendulumChain({ links: 3, lengths: [0.4, 0.3, 0.3], masses: [1, 1, 0.5], gravity: DP_GRAVITY, damping: 0 });
    a.setState([1.1, 0.4], [2.5, -1.0]);
    b.setState([-0.7, 0.2, 1.3], [-1.5, 3.0, 0.5]);
    const n = { x: 0.6, y: -0.8 };
    for (const [ka, kb] of [
      [1, 2],
      [0, 1],
      [1, 0],
    ]) {
      const ta = a.kineticEnergy() + b.kineticEnergy();
      const va = a.bobVelocity(ka, { x: 0, y: 0 });
      const vb = b.bobVelocity(kb, { x: 0, y: 0 });
      const before = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y;
      // Make them approach along n (flip n when they are separating).
      const nx = before < 0 ? n.x : -n.x;
      const ny = before < 0 ? n.y : -n.y;
      const approach = collideBobs(a, ka, b, kb, nx, ny, 1, scratch);
      expect(approach).toBeCloseTo(Math.abs(before), 9);
      const va2 = a.bobVelocity(ka, { x: 0, y: 0 });
      const vb2 = b.bobVelocity(kb, { x: 0, y: 0 });
      const after = (vb2.x - va2.x) * nx + (vb2.y - va2.y) * ny;
      expect(after).toBeCloseTo(approach, 9);
      expect(a.kineticEnergy() + b.kineticEnergy()).toBeCloseTo(ta, 9);
      // Now they separate: a second call does nothing.
      const omega = [...a.omega, ...b.omega];
      expect(collideBobs(a, ka, b, kb, nx, ny, 1, scratch)).toBe(0);
      expect([...a.omega, ...b.omega]).toEqual(omega);
    }
    // A free end bob moves like a particle across the rods (effective inverse mass 1 / m for the one-rod chain),
    // and not at all along its rod.
    const single = new PendulumChain({ links: 1, lengths: [1], masses: [2], gravity: DP_GRAVITY, damping: 0 });
    single.setState([0.3]);
    expect(single.inverseMassAlong(0, Math.cos(0.3), -Math.sin(0.3), scratch.a)).toBeCloseTo(0.5, 12);
    expect(single.inverseMassAlong(0, Math.sin(0.3), Math.cos(0.3), scratch.a)).toBeCloseTo(0, 12);
  });

  it("sub-steps every step in at least eight pieces that end on it exactly, no rod turning more than 0.015 rad in one, shorter where the error estimate asks", () => {
    const stepSec = 1 / 60;
    const plain = new PendulumChain({ links: 2, lengths: [0.5, 0.5], masses: [1, 1], gravity: DP_GRAVITY, damping: 0 });
    plain.setState([2.0, -0.5]);
    const stiff = new PendulumChain({ links: 3, lengths: [1 / 7, 1 / 7, 5 / 7], masses: [0.2, 0.2, 5], gravity: 3 * DP_GRAVITY, damping: 0 });
    stiff.setState([2.4, -1.2, 0.6]);
    const counts: Record<string, { most: number; total: number; shortened: number }> = {};
    for (const [name, chain] of [
      ["plain", plain],
      ["stiff", stiff],
    ] as const) {
      const stepper = new ChainStepper();
      const chains = [chain];
      const tally = { most: 0, total: 0, shortened: 0, tooLong: 0, tooFar: 0, badEnd: 0, tooFew: 0, tooMany: 0 };
      for (let i = 0; i < 1800; i++) {
        stepper.begin(stepSec);
        let sum = 0;
        for (;;) {
          const rate = chain.maxRate();
          const h = stepper.subStep(chains);
          if (h === 0) break;
          sum += h;
          if (h > stepSec / MIN_SUBSTEPS + 1e-15) tally.tooLong++;
          if (rate * h > MAX_ANGLE_PER_SUBSTEP + 1e-12) tally.tooFar++;
          // Shorter than half of what the caps allow: the error control (evenly splitting the rest halves at most).
          if (h < 0.5 * Math.min(stepSec / MIN_SUBSTEPS, rate > 0 ? MAX_ANGLE_PER_SUBSTEP / rate : Infinity)) tally.shortened++;
        }
        if (stepper.done !== stepSec || Math.abs(sum - stepSec) > 1e-12) tally.badEnd++;
        if (stepper.count < MIN_SUBSTEPS) tally.tooFew++;
        if (stepper.count > MAX_SUBSTEPS + 1) tally.tooMany++;
        tally.most = Math.max(tally.most, stepper.count);
        tally.total += stepper.count;
      }
      expect({ tooLong: tally.tooLong, tooFar: tally.tooFar, badEnd: tally.badEnd, tooFew: tally.tooFew, tooMany: tally.tooMany }, name).toEqual({ tooLong: 0, tooFar: 0, badEnd: 0, tooFew: 0, tooMany: 0 });
      counts[name] = tally;
    }
    // The default rig needs about ten a step and never more than the rate cap; the stiff one gets hundreds in its whips.
    expect(counts.plain.total / 1800).toBeLessThan(14);
    expect(counts.plain.shortened).toBe(0);
    expect(counts.stiff.shortened).toBeGreaterThan(100);
    expect(counts.stiff.most).toBeGreaterThan(100);
    // Nothing to do: no sub-step at all.
    const idle = new ChainStepper();
    idle.begin(stepSec);
    expect(idle.subStep([])).toBe(0);
  });

  it("estimates its own error: trying leaves the state alone, accepting moves it, and the steps follow the solution of fine fixed RK4 steps", () => {
    const chain = new PendulumChain({ links: 3, lengths: [0.4, 0.35, 0.25], masses: [1, 2, 0.5], gravity: DP_GRAVITY, damping: 0 });
    chain.setState([2.2, -0.4, 1.1], [1.5, -3.0, 4.0]);
    const theta = Array.from(chain.theta);
    const omega = Array.from(chain.omega);
    // A long step is far outside the tolerance, a short one well inside; neither changes the state.
    expect(chain.tryStep(0.05, STEP_TOLERANCE)).toBeGreaterThan(1);
    const small = chain.tryStep(1e-4, STEP_TOLERANCE);
    expect(small).toBeLessThan(1);
    expect(Array.from(chain.theta)).toEqual(theta);
    expect(Array.from(chain.omega)).toEqual(omega);
    // The error estimate falls like h⁵ (a fifth-order pair: halving the step divides it by about 32).
    const e1 = chain.tryStep(4e-3, STEP_TOLERANCE);
    const e2 = chain.tryStep(2e-3, STEP_TOLERANCE);
    expect(e1 / e2).toBeGreaterThan(20);
    expect(e1 / e2).toBeLessThan(50);
    chain.tryStep(1e-4, STEP_TOLERANCE);
    chain.acceptStep();
    for (let i = 0; i < 3; i++) expect(chain.theta[i]).toBeCloseTo(wrapAngle(chain.nextTheta[i]), 15);
    expect(chain.omega[2]).toBe(chain.nextOmega[2]);
    // One second of the default-sized chain: the adaptive sub-steps and 12 000 fixed RK4 steps agree.
    const a = new PendulumChain({ links: 2, lengths: [0.5, 0.5], masses: [1, 1], gravity: DP_GRAVITY, damping: 0 });
    const b = new PendulumChain({ links: 2, lengths: [0.5, 0.5], masses: [1, 1], gravity: DP_GRAVITY, damping: 0 });
    a.setState([2.0, -0.5]);
    b.setState([2.0, -0.5]);
    advance(a, 60);
    for (let i = 0; i < 12000; i++) b.step(1 / 12000);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(wrapAngle(a.theta[i] - b.theta[i]))).toBeLessThan(1e-7);
      expect(Math.abs(a.omega[i] - b.omega[i])).toBeLessThan(1e-6);
    }
  });
});

/* ------------------------------------------------------------------ crossings */

describe("string-crossing detection", () => {
  it("counts every whole number a point passes, in order, landing on one once and leaving it never", () => {
    const out: number[] = [];
    expect(crossedIndices(0.2, 3.7, out)).toBe(3);
    expect(out).toEqual([1, 2, 3]);
    out.length = 0;
    expect(crossedIndices(3.7, 0.2, out)).toBe(3);
    expect(out).toEqual([3, 2, 1]);
    out.length = 0;
    // Landing exactly on a string plucks it; staying there or moving on does not pluck it again, either way.
    expect(crossedIndices(1.5, 2, out)).toBe(1);
    expect(crossedIndices(2, 2, out)).toBe(0);
    expect(crossedIndices(2, 2.5, out)).toBe(0);
    expect(crossedIndices(2, 1.5, out)).toBe(0);
    expect(crossedIndices(2.5, 2, out)).toBe(1);
    expect(out).toEqual([2, 2]);
    out.length = 0;
    expect(crossedIndices(-0.5, -0.1, out)).toBe(0);
    expect(crossedIndices(-1.2, 0.3, out)).toBe(2);
    expect(out).toEqual([-1, 0]);
  });

  it("finds every crossing exactly once however a sweep is cut into sub-steps", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 50; trial++) {
      const out: number[] = [];
      let u = -0.5;
      // Up to 14.5 and back down to −0.5 in random steps, some of them landing exactly on a string.
      const path: number[] = [];
      while (u < 14.5) {
        u = Math.min(14.5, rand() < 0.2 ? Math.round(u + 1) : u + 0.05 + 0.7 * rand());
        path.push(u);
      }
      while (u > -0.5) {
        u = Math.max(-0.5, rand() < 0.2 ? Math.round(u - 1) : u - 0.05 - 0.7 * rand());
        path.push(u);
      }
      let prev = -0.5;
      for (const next of path) {
        crossedIndices(prev, next, out);
        prev = next;
      }
      const up = Array.from({ length: 15 }, (_, k) => k);
      expect(out).toEqual([...up, ...up.slice().reverse()]);
    }
  });

  it("plucks the vertical strings a bob crosses, only the real ones, in crossing order", () => {
    const g = buildHarpGeometry("vertical", 10, 1, 1.1);
    expect(g.spacing).toBeCloseTo(0.2, 12);
    expect(g.first).toBeCloseTo(-0.9, 12);
    const out: number[] = [];
    expect(harpCrossings(g, -0.95, 0.3, -0.45, 0.5, out)).toBe(3);
    expect(out).toEqual([0, 1, 2]);
    out.length = 0;
    expect(harpCrossings(g, 0.95, 0, 0.75, 0, out)).toBe(1);
    expect(out).toEqual([9]);
    out.length = 0;
    // Past the ends of the harp nothing is plucked, and a vertical move plucks nothing.
    expect(harpCrossings(g, -1.5, 0, -0.95, 0, out)).toBe(0);
    expect(harpCrossings(g, 0.05, -1, 0.05, 1, out)).toBe(0);
    expect(harpCrossings(buildHarpGeometry("vertical", 0, 1, 1), -1, 0, 1, 0, out)).toBe(0);
  });

  it("plucks the radial spokes a bob sweeps past around the centre, across ±π, and nothing inside the hub", () => {
    const g = buildHarpGeometry("radial", 8, 1, 1.1);
    expect(g.angleStep).toBeCloseTo(Math.PI / 4, 12);
    const at = (a: number, r = 0.8): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
    const out: number[] = [];
    // Spoke k sits at −π/2 + π/8 + k·π/4 (screen coordinates: clockwise from the top).
    const spoke = (k: number) => -Math.PI / 2 + Math.PI / 8 + (k * Math.PI) / 4;
    expect(harpCrossings(g, ...at(spoke(2) - 0.1), ...at(spoke(3) + 0.1), out)).toBe(2);
    expect(out).toEqual([2, 3]);
    out.length = 0;
    // Clockwise across ±π (the left, where atan2 wraps): spokes 5 and 6 around 180°.
    expect(harpCrossings(g, ...at(spoke(5) - 0.05), ...at(spoke(6) + 0.05), out)).toBe(2);
    expect(out).toEqual([5, 6]);
    out.length = 0;
    expect(harpCrossings(g, ...at(spoke(6) + 0.05), ...at(spoke(5) - 0.05), out)).toBe(2);
    expect(out).toEqual([6, 5]);
    out.length = 0;
    // Through the hub (the angle is meaningless near the centre): nothing.
    expect(harpCrossings(g, ...at(spoke(1) - 0.2, 0.05), ...at(spoke(1) + 0.2, 0.05), out)).toBe(0);
    expect(harpCrossings(g, ...at(spoke(1) - 0.2, 0.9), ...at(spoke(1) + 0.2, 0.05), out)).toBe(0);
  });
});

/* ------------------------------------------------------------------ tuning */

describe("harp tuning", () => {
  it("tunes the strings to the scale across the octaves, root to root, a major scale while the scale is chromatic", () => {
    expect(harpBaseMidi(1, 0)).toBe(60);
    expect(harpBaseMidi(2, 0)).toBe(60);
    expect(harpBaseMidi(3, 0)).toBe(48);
    expect(harpBaseMidi(4, 7)).toBe(55);
    expect(harpStringMidi(15, 2, "chromatic", 0)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]);
    expect(harpStringMidi(15, 2, "major", 0)).toEqual(harpStringMidi(15, 2, "chromatic", 0));
    expect(harpLadder(1, "pentatonic", 2)).toEqual([62, 64, 66, 69, 71, 74]);
    expect(harpStringMidi(6, 1, "pentatonic", 2)).toEqual([62, 64, 66, 69, 71, 74]);
    expect(harpStringMidi(1, 3, "minor", 0)).toEqual([48]);
    expect(harpStringMidi(0, 2, "major", 0)).toEqual([]);
    for (const [strings, octaves] of [
      [24, 1],
      [7, 4],
      [12, 2],
      [2, 3],
    ]) {
      const midis = harpStringMidi(strings, octaves, "blues", 5);
      expect(midis).toHaveLength(strings);
      expect(midis[0]).toBe(harpBaseMidi(octaves, 5));
      expect(midis.at(-1)).toBe(harpBaseMidi(octaves, 5) + 12 * octaves);
      for (let i = 1; i < midis.length; i++) expect(midis[i]).toBeGreaterThanOrEqual(midis[i - 1]);
      // Every note belongs to the scale.
      for (const m of midis) expect([0, 3, 5, 6, 7, 10]).toContain((((m - 5) % 12) + 12) % 12);
    }
  });

  it("plays the sparring hits low (root an octave down when hard) and closes the run on the scale's triad", () => {
    expect(sparHitPitch(1, 2, 0)).toBeCloseTo(midiToFrequency(48), 9);
    expect(sparHitPitch(HIT_ACCENT_STRENGTH - 0.01, 2, 0)).toBeCloseTo(midiToFrequency(55), 9);
    expect(sparHitPitch(0.9, 3, 2)).toBeCloseTo(midiToFrequency(38), 9);
    const chord = closingChordEvent({ octaves: 2, scale: "chromatic", rootNote: 0 });
    expect(chord.accent).toBe(true);
    expect(chord.chord!.map((f) => Math.round(69 + 12 * Math.log2(f / 440)))).toEqual([60, 64, 67, 72]);
    expect(closingChordEvent({ octaves: 1, scale: "minor", rootNote: 9 }).chord!.map((f) => Math.round(69 + 12 * Math.log2(f / 440)))).toEqual([69, 72, 76, 81]);
    expect(pluckLevel(0)).toBe(0.35);
    expect(pluckLevel(100)).toBe(1);
  });
});

/* ------------------------------------------------------------------ the mode */

describe("DoublePendulumMode in the engine", () => {
  it("is registered as a mode of the rhythm family", () => {
    expect(MODE_IDS).toContain("doublePendulum");
    expect(MODE_CARD_ORDER).toContain("doublePendulum");
    expect(MODE_CATEGORIES.doublePendulum).toBe("rhythm");
    expect(modesInCategory("rhythm")).toContain("doublePendulum");
    expect(modesInCategory("escape").slice(0, 10)).toEqual(["classic", "accumulation", "multiply", "lines", "paint", "target", "grow", "shatter", "colorMatch", "portal"]);
  });

  it("hangs one ball per bob from the centre of the square the recorder crops to, no rings, no obstacles", () => {
    for (const dp of [{}, { segments: 3 }, { count: 4 }, { count: 3, segments: 3 }, { spar: true }, { spar: true, count: 4 }]) {
      const engine = dpEngine(dp);
      const view = engine.getDoublePendulumView();
      const s = resolveDoublePendulumSettings(dp);
      const count = s.spar ? 2 : s.count;
      expect(engine.getCurrentModeName()).toBe("doublePendulum");
      expect(engine.getCircularWalls()).toHaveLength(0);
      expect(engine.getObstacles()).toHaveLength(0);
      expect(engine.getBalls()).toHaveLength(count * s.segments);
      expect(view.count).toBe(count);
      const f = view.field!;
      expect(f.cx).toBe(400);
      expect(f.cy).toBe(300);
      for (let i = 0; i < 180; i++) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        for (const ball of engine.getBalls()) {
          expect(ball.x - ball.radius).toBeGreaterThanOrEqual(f.left - 1e-6);
          expect(ball.x + ball.radius).toBeLessThanOrEqual(f.right + 1e-6);
          expect(ball.y - ball.radius).toBeGreaterThanOrEqual(f.top - 1e-6);
          expect(ball.y + ball.radius).toBeLessThanOrEqual(f.bottom + 1e-6);
        }
      }
      // The balls sit exactly where the chains have their bobs.
      const balls = engine.getBalls();
      view.pendulums.forEach((pen, p) => {
        for (let k = 0; k < s.segments; k++) {
          const ball = balls[p * s.segments + k];
          expect(ball.x).toBeCloseTo(f.cx + pen.bobX[k] * f.scale, 9);
          expect(ball.y).toBeCloseTo(f.cy + pen.bobY[k] * f.scale, 9);
        }
      });
    }
  });

  it("starts from the set angles, every further pendulum a hair further on its last rod – together at first, apart later", () => {
    const engine = dpEngine({ count: 3, randomStart: false, angle1: 150, angle2: -40 });
    const view = engine.getDoublePendulumView();
    const [a, b, c] = view.pendulums;
    const rad = Math.PI / 180;
    expect(a.chain.theta[0]).toBeCloseTo(150 * rad, 12);
    expect(a.chain.theta[1]).toBeCloseTo(-40 * rad, 12);
    expect(b.chain.theta[0]).toBeCloseTo(150 * rad, 12);
    expect(b.chain.theta[1] - a.chain.theta[1]).toBeCloseTo(BUTTERFLY_OFFSET_DEG * rad, 12);
    expect(c.chain.theta[1] - a.chain.theta[1]).toBeCloseTo(2 * BUTTERFLY_OFFSET_DEG * rad, 12);
    run(engine, 60);
    const gap = () => Math.hypot(a.bobX[1] - c.bobX[1], a.bobY[1] - c.bobY[1]);
    expect(gap()).toBeLessThan(0.02);
    run(engine, 1200);
    let far = gap();
    for (let i = 0; i < 20 && far < 0.3; i++) {
      run(engine, 30);
      far = Math.max(far, gap());
    }
    expect(far).toBeGreaterThan(0.3);
  });

  it("draws a seeded start: deterministic for a seed, different between seeds, always high and chaotic", () => {
    const starts = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const a = dpEngine({}, seed);
      const b = dpEngine({}, seed);
      const pa = a.getDoublePendulumView().pendulums[0].chain.theta;
      const pb = b.getDoublePendulumView().pendulums[0].chain.theta;
      expect([...pa]).toEqual([...pb]);
      expect(Math.abs(pa[0])).toBeGreaterThanOrEqual((100 * Math.PI) / 180 - 1e-12);
      expect(Math.abs(pa[0])).toBeLessThanOrEqual((170 * Math.PI) / 180 + 1e-12);
      starts.add(pa.join(","));
    }
    expect(starts.size).toBe(6);
  });

  it("plucks the strings its bobs cross: one note or chord per step, pitched from the harp, as loud as the pluck is fast", () => {
    const engine = dpEngine({ endless: true });
    const view = engine.getDoublePendulumView();
    const pitches = new Set(view.strings.map((s) => s.pitch));
    expect(view.strings).toHaveLength(DEFAULT_DOUBLE_PENDULUM_SETTINGS.strings);
    // Independently: the strings the balls crossed between consecutive steps.
    const f = view.field!;
    const g = view.harp;
    let brute = 0;
    let prev = engine.getBalls().map((b) => (b.x - f.cx) / f.scale);
    let events = 0;
    for (let i = 0; i < 1200; i++) {
      engine.update(STEP, 0);
      const step = engine.consumeSoundEvents();
      expect(step.length).toBeLessThanOrEqual(1);
      for (const ev of step) {
        events++;
        expect(ev.type).toBe("hit");
        for (const p of ev.chord ?? [ev.frequency!]) expect(pitches.has(p)).toBe(true);
        if (ev.chord) expect(ev.frequency).toBe(Math.min(...ev.chord));
        expect(ev.level).toBeGreaterThanOrEqual(0.35);
        expect(ev.level).toBeLessThanOrEqual(1);
      }
      const now = engine.getBalls().map((b) => (b.x - f.cx) / f.scale);
      now.forEach((x, k) => {
        const out: number[] = [];
        brute += crossedIndices((prev[k] - g.first) / g.spacing, (x - g.first) / g.spacing, out) ? out.filter((j) => j >= 0 && j < g.count).length : 0;
      });
      prev = now;
    }
    expect(view.plucks).toBeGreaterThan(100);
    expect(events).toBeGreaterThan(80);
    // The sub-steps catch a few crossings the 60 Hz samples miss; the cooldown drops a few re-plucks.
    expect(Math.abs(view.plucks - brute) / brute).toBeLessThan(0.12);
    expect(view.strings.reduce((n, s) => n + s.plucks, 0)).toBe(view.plucks);
  });

  it("stays silent without strings and plucks radial spokes as well", () => {
    const silent = dpEngine({ strings: 0, endless: true });
    expect(run(silent, 600)).toHaveLength(0);
    expect(silent.getDoublePendulumView().plucks).toBe(0);
    const radial = dpEngine({ stringLayout: "radial", strings: 12, endless: true });
    run(radial, 900);
    expect(radial.getDoublePendulumView().plucks).toBeGreaterThan(40);
  });

  it("spars: two mirrored pendulums side by side, elastic hits that keep the energy, low percussive notes and flashes", () => {
    const engine = dpEngine({ spar: true, randomStart: false, angle1: 45, angle2: 90, strings: 0, endless: true });
    const view = engine.getDoublePendulumView();
    const [a, b] = view.pendulums;
    expect(a.pivotX).toBeCloseTo(-SPAR_PIVOT_DISTANCE / 2, 12);
    expect(b.pivotX).toBeCloseTo(SPAR_PIVOT_DISTANCE / 2, 12);
    expect(a.chain.theta[0]).toBeCloseTo(-b.chain.theta[0], 12);
    expect(b.bobX[0]).toBeCloseTo(-a.bobX[0], 12);
    expect(b.bobY[0]).toBeCloseTo(a.bobY[0], 12);
    const events: SoundEvent[] = [];
    let firstHit = -1;
    let deepest = 0;
    for (let i = 0; i < 3600; i++) {
      engine.update(STEP, 0);
      events.push(...engine.consumeSoundEvents());
      if (firstHit < 0 && view.hitCount > 0) firstHit = view.timeSec;
      for (let ka = 0; ka < 2; ka++)
        for (let kb = 0; kb < 2; kb++) {
          const d = Math.hypot(a.bobX[ka] - b.bobX[kb], a.bobY[ka] - b.bobY[kb]);
          deepest = Math.max(deepest, 1 - d / (a.radius[ka] + b.radius[kb]));
        }
    }
    expect(firstHit).toBeGreaterThan(0);
    expect(firstHit).toBeLessThan(1.5);
    expect(view.hitCount).toBeGreaterThan(5);
    // Elastic contacts: the energy of the pair holds through every hit.
    expect(engine.getDoublePendulumEnergyDrift()).toBeLessThan(1e-5);
    // The bobs never sink far into each other.
    expect(deepest).toBeLessThan(0.35);
    // Every hit sound is low (under the harp), louder when harder, accented from HIT_ACCENT_STRENGTH on.
    expect(events.length).toBeGreaterThan(0);
    const low = new Set([sparHitPitch(1, 2, 0), sparHitPitch(0, 2, 0)]);
    for (const ev of events) {
      expect(low.has(ev.frequency!)).toBe(true);
      expect(!!ev.accent).toBe(ev.frequency === sparHitPitch(1, 2, 0));
    }
    // The hits are kept for the flashes.
    expect(view.hits.some((h) => h.time > 0)).toBe(true);
  });

  it("never starts a seeded sparring run with the mirrored pendulums tangled", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const engine = dpEngine({ spar: true }, seed);
      const view = engine.getDoublePendulumView();
      const [a, b] = view.pendulums;
      const lengths = chainLengths(resolveDoublePendulumSettings({}));
      if (!mirrorOverlaps([...a.chain.theta], lengths, 2 * a.radius[0])) continue;
      // Only after eight draws in a row came out tangled – practically never.
      expect.fail(`seed ${seed} starts tangled: ${[...a.chain.theta]} / ${[...b.chain.theta]}`);
    }
  });

  it("holds still for the finale at the end of the clip – closing chord and banner – and finishes at the clip length; never when endless", () => {
    expect(finaleStartSec(30)).toBe(28.5);
    expect(finaleStartSec(5)).toBe(4);
    const engine = dpEngine({ clipSeconds: 5 });
    const view = engine.getDoublePendulumView();
    const positions = () => engine.getBalls().map((b) => [b.x, b.y]);
    run(engine, 239);
    expect(view.finale).toBe(false);
    engine.update(STEP, 0);
    expect(view.finale).toBe(true);
    expect(engine.getDoublePendulumProgress().finale).toBe(true);
    expect(engine.consumeSoundEvents().at(-1)).toEqual(closingChordEvent(view.settings));
    // The rig holds still and silent while the clock runs on to the end of the clip (strings ring down, the trail fades).
    const held = positions();
    expect(run(engine, 59)).toHaveLength(0);
    expect(positions()).toEqual(held);
    expect(engine.isSimulationFinished()).toBe(false);
    engine.update(STEP, 0);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(view.timeSec).toBeCloseTo(5, 9);
    // Nothing happens after the finish.
    expect(run(engine, 120)).toHaveLength(0);
    expect(positions()).toEqual(held);
    expect(view.timeSec).toBeCloseTo(5, 9);
    // Endless switched on during the finale: the swing goes on, and it never finishes.
    const resumed = dpEngine({ clipSeconds: 5 });
    run(resumed, 250);
    expect(resumed.getDoublePendulumView().finale).toBe(true);
    const frozen = resumed.getBalls().map((b) => [b.x, b.y]);
    resumed.setDoublePendulumSettings({ endless: true });
    run(resumed, 30);
    expect(resumed.getDoublePendulumView().finale).toBe(false);
    expect(resumed.getBalls().map((b) => [b.x, b.y])).not.toEqual(frozen);
    const endless = dpEngine({ clipSeconds: 5, endless: true });
    run(endless, 600);
    expect(endless.isSimulationFinished()).toBe(false);
    expect(endless.getDoublePendulumView().finale).toBe(false);
  });

  it("takes the trail, strings, tuning and the end live, without restarting the swing", () => {
    const engine = dpEngine({ clipSeconds: 5 });
    const view = engine.getDoublePendulumView();
    run(engine, 120);
    const generation = view.generation;
    const theta = [...view.pendulums[0].chain.theta];
    engine.setDoublePendulumSettings({ strings: 5, octaves: 1, scale: "pentatonic", rootNote: 2, trailSeconds: 9, stringLayout: "radial", endless: true });
    expect(view.generation).toBe(generation);
    expect([...view.pendulums[0].chain.theta]).toEqual(theta);
    expect(view.strings.map((s) => s.midi)).toEqual([62, 64, 69, 71, 74]);
    expect(view.harp.layout).toBe("radial");
    expect(view.settings.trailSeconds).toBe(9);
    const pitches = new Set(view.strings.map((s) => s.pitch));
    for (const ev of run(engine, 420)) for (const p of ev.chord ?? [ev.frequency!]) expect(pitches.has(p)).toBe(true);
    // Endless: it went on past the 5 s clip.
    expect(engine.isSimulationFinished()).toBe(false);
    expect(view.timeSec).toBeGreaterThan(8.9);
    // The rig itself only changes with the next init.
    engine.setDoublePendulumSettings({ segments: 3, count: 2 });
    expect(view.segments).toBe(2);
    expect(view.count).toBe(1);
    engine.initDoublePendulum();
    expect(view.segments).toBe(3);
    expect(view.count).toBe(2);
    expect(engine.getBalls()).toHaveLength(6);
  });

  it("follows a canvas resize and a live ball size change, keeping the swing", () => {
    const engine = dpEngine({ endless: true });
    const view = engine.getDoublePendulumView();
    run(engine, 90);
    const x = view.pendulums[0].bobX[1];
    const r = view.pendulums[0].radius[1];
    engine.setConfig({ width: 1080, height: 1920 });
    expect(view.pendulums[0].bobX[1]).toBe(x);
    const f = view.field!;
    expect(f.cx).toBe(540);
    expect(f.side).toBeCloseTo(0.96 * 1080, 9);
    const ball = engine.getBalls()[1];
    expect(ball.x).toBeCloseTo(f.cx + x * f.scale, 9);
    // The model is the same whatever the canvas size: the bob radius in model units did not change.
    expect(view.pendulums[0].radius[1]).toBeCloseTo(r, 12);
    engine.setConfig({ ballRadius: 16 });
    engine.update(STEP, 0);
    expect(view.pendulums[0].radius[1]).toBeGreaterThan(1.9 * r);
    expect(engine.getBalls()[1].radius).toBeCloseTo(view.pendulums[0].radius[1] * view.field!.scale, 9);
    expect(bobModelRadius(8, 1, 1, 1)).toBeCloseTo(r, 12);
  });

  it("is deterministic for a seed, sound events included, and every setting keeps it so", () => {
    for (const dp of [{}, { segments: 3, mass3: 0.3 }, { spar: true }, { count: 3, damping: 0.002 }, { stringLayout: "radial" as const, gravity: 2.5 }]) {
      const a = dpEngine({ ...dp, endless: true }, 99);
      const b = dpEngine({ ...dp, endless: true }, 99);
      const ea = run(a, 900);
      const eb = run(b, 900);
      expect(ea).toEqual(eb);
      expect(a.getBalls().map((x) => [x.x, x.y])).toEqual(b.getBalls().map((x) => [x.x, x.y]));
    }
  });

  it("starts every run with still strings: a restart plays exactly what a fresh engine plays", () => {
    // The page keeps one engine (so one mode instance) for its whole life: Restart, R, the end screen, a rig change, a
    // found seed, a preset and switching back to the mode all re-init it. The previous run's pluck times sit on its own
    // clock, so carried over they would mute every string until the new clock passed them.
    for (const seed of [5, 11]) {
      const clip = dpEngine({ clipSeconds: 5 }, seed);
      run(clip, 5 * 60 + 10);
      expect(clip.isSimulationFinished()).toBe(true);
      clip.setSeed(seed);
      clip.initDoublePendulum();
      const view = clip.getDoublePendulumView();
      expect(view.strings.every((s) => s.pluckTime === -Infinity && s.amp === 0 && s.plucks === 0)).toBe(true);
      const again = run(clip, 600);
      const fresh = run(dpEngine({ clipSeconds: 5 }, seed), 600);
      expect(again.length).toBeGreaterThan(40);
      expect(again).toEqual(fresh);
      expect(view.strings.reduce((n, s) => n + s.plucks, 0)).toBe(view.plucks);
      // A restart in the middle of a longer clip, and a switch back from another mode, start clean too.
      const mid = dpEngine({}, seed);
      run(mid, 720);
      mid.setSeed(seed);
      mid.initDoublePendulum();
      expect(run(mid, 600)).toEqual(run(dpEngine({}, seed), 600));
      mid.initMode("classic");
      run(mid, 60);
      mid.initMode("doublePendulum");
      expect(run(mid, 600)).toEqual(run(dpEngine({}, seed), 600));
    }
  });

  it("loses its swing with friction and keeps it without", () => {
    const damped = dpEngine({ damping: 0.01, endless: true, strings: 0 });
    run(damped, 1200);
    const view = damped.getDoublePendulumView();
    expect(view.energy).toBeLessThan(view.energy0);
    expect(Math.max(...view.pendulums[0].chain.omega.map(Math.abs))).toBeLessThan(0.05);
    const free = dpEngine({ endless: true, strings: 0 });
    run(free, 1200);
    expect(free.getDoublePendulumEnergyDrift()).toBeLessThan(1e-6);
  });

  it("keeps a trail of the last bob's path in model units, newest last, within its capacity", () => {
    const engine = dpEngine({ endless: true });
    const view = engine.getDoublePendulumView();
    run(engine, 300);
    const pen = view.pendulums[0];
    expect(pen.trailCount).toBeGreaterThan(300);
    const last = (pen.trailHead - 1 + pen.trailX.length) % pen.trailX.length;
    expect(pen.trailT[last]).toBeLessThanOrEqual(view.timeSec + 1e-9);
    expect(pen.trailT[last]).toBeGreaterThan(view.timeSec - 0.05);
    // Samples are in time order and close together.
    let prev = -Infinity;
    for (let i = pen.trailCount - 1; i >= 0; i--) {
      const j = (pen.trailHead - 1 - i + 2 * pen.trailX.length) % pen.trailX.length;
      expect(pen.trailT[j]).toBeGreaterThanOrEqual(prev);
      prev = pen.trailT[j];
    }
  });
});

/* ------------------------------------------------------------------ finder */

describe("finder", () => {
  it("knows a Double Pendulum run lasts the clip length whatever the seed, and never when endless", () => {
    expect(fixedRunDurationSec("doublePendulum", { doublePendulum: { clipSeconds: 45 } })).toBe(45);
    expect(fixedRunDurationSec("doublePendulum", {})).toBe(30);
    expect(fixedRunDurationSec("doublePendulum", { doublePendulum: { endless: true } })).toBeNull();
    expect(runNeverFinishes("doublePendulum", { drop: {}, box: {}, doublePendulum: { endless: true } })).toBe(true);
    expect(runNeverFinishes("doublePendulum", { drop: {}, box: {}, doublePendulum: {} })).toBe(false);
    expect(runNeverFinishes("doublePendulum", { drop: {}, box: {} })).toBe(false);
  });

  it("says so instead of searching when the clip length misses the target, and finds the first seed when it matches", async () => {
    let progress = 0;
    const base = { toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "doublePendulum" as const };
    const miss = await findSimulation({ ...base, targetDurationSec: 30, modeSettings: { ...modeSettings, doublePendulum: { clipSeconds: 12 } } }, () => progress++);
    expect(miss).toEqual({ found: false, seed: 0, duration: 12, seedsTested: 0, fixedDuration: true });
    const endless = await findSimulation({ ...base, targetDurationSec: 30, modeSettings: { ...modeSettings, doublePendulum: { endless: true } } }, () => progress++);
    expect(endless).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
    expect(progress).toBe(0);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      const hit = await findSimulation({ ...base, targetDurationSec: 10, maxSimTimeSec: 40, modeSettings: { ...modeSettings, doublePendulum: { clipSeconds: 10, spar: true } } }, () => progress++);
      expect(hit.found).toBe(true);
      expect(hit.seedsTested).toBe(1);
      expect(hit.duration).toBeCloseTo(10, 2);
      // The seed found replays the same run in a fresh engine.
      const a = dpEngine({ clipSeconds: 10, spar: true }, hit.seed);
      const b = dpEngine({ clipSeconds: 10, spar: true }, hit.seed);
      expect(run(a, 300)).toEqual(run(b, 300));
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});

/* ------------------------------------------------------------------ settings */

describe("Double Pendulum settings", () => {
  it("resolve to the defaults, clamp the numbers to their ranges and reject unknown options", () => {
    expect(resolveDoublePendulumSettings(null)).toEqual(DEFAULT_DOUBLE_PENDULUM_SETTINGS);
    const r = resolveDoublePendulumSettings({ count: 9, segments: 7, length1: 0, mass2: 99, gravity: -1, angle1: 999.4, angle2: -12.6, damping: 1, trailSeconds: 30, strings: 99.6, octaves: 0, clipSeconds: 0.2, rootNote: 14 });
    expect(r).toMatchObject({ count: 4, segments: 3, length1: 0.2, mass2: 5, gravity: 0.2, angle1: 180, angle2: -13, damping: 0.01, trailSeconds: 10, strings: 24, octaves: 1, clipSeconds: 1, rootNote: 2 });
    const junk = { stringLayout: "spiral", scale: "dorian", spar: "yes", endless: 1, randomStart: null, count: "x" } as unknown as Partial<DoublePendulumSettings>;
    expect(resolveDoublePendulumSettings(junk)).toEqual(DEFAULT_DOUBLE_PENDULUM_SETTINGS);
    for (const key of Object.keys(DOUBLE_PENDULUM_RANGES) as (keyof typeof DOUBLE_PENDULUM_RANGES)[]) expect(RANGES[key]).toEqual(DOUBLE_PENDULUM_RANGES[key]);
  });

  it("map to and from the SimulatorSettings fields, with the defaults in every mode; the clip length and tuning come from the Recording and Sound settings", () => {
    for (const mode of MODE_IDS) expect(doublePendulumSettingFields(doublePendulumSettingsOf(defaultSettings(mode)))).toEqual(doublePendulumSettingFields(DEFAULT_DOUBLE_PENDULUM_SETTINGS));
    const s = { ...defaultSettings("doublePendulum"), recordingDuration: 45, scale: "minor" as const, rootNote: 3 };
    expect(doublePendulumSettingsOf(s)).toMatchObject({ clipSeconds: 45, scale: "minor", rootNote: 3 });
  });

  it("round-trip through their short URL keys, skipping the defaults (the friction to four decimals)", () => {
    const base = defaultSettings("doublePendulum");
    expect([...settingsToSearchParams(base).keys()].filter((k) => k.startsWith("dp"))).toEqual([]);
    const s = { ...base, dpCount: 3, dpSegments: 3, dpLength1: 0.45, dpLength3: 0.6, dpMass1: 2.5, dpMass3: 0.3, dpGravity: 1.75, dpAngle1: -135, dpAngle2: 20, dpAngle3: 179, dpRandomStart: false, dpDamping: 0.0015, dpTrailSeconds: 7.5, dpStrings: 22, dpStringLayout: "radial" as const, dpOctaves: 4, dpSpar: true, dpEndless: true };
    const params = settingsToSearchParams(s);
    expect(params.get("dpd")).toBe("0.0015");
    expect(params.get("dpsl")).toBe("radial");
    expect(params.get("dprs")).toBe("0");
    expect(params.get("dpsp")).toBe("1");
    for (const key of Object.keys(DP_URL_KEYS)) expect(params.has(key), key).toBe(key !== "dpl2" && key !== "dpm2");
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect(doublePendulumSettingFields(doublePendulumSettingsOf(back))).toEqual(doublePendulumSettingFields(doublePendulumSettingsOf(s)));
    expect(back.mode).toBe("doublePendulum");
    // Other modes' links carry none of them.
    expect([...settingsToSearchParams(defaultSettings("classic")).keys()].filter((k) => k.startsWith("dp"))).toEqual([]);
  });

  it("fall back for bad URL values and presets", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=doublePendulum&dpn=12&dpsg=abc&dpd=-3&dpsl=zigzag&dprs=maybe&dpst=&dpa1=720&dpo=2.6"));
    expect(s).toMatchObject({ dpCount: 4, dpSegments: 2, dpDamping: 0, dpStringLayout: "vertical", dpRandomStart: true, dpStrings: 15, dpAngle1: 180, dpOctaves: 3 });
    const p = presetToSettings({ mode: "doublePendulum", dpMass1: 50, dpTrailSeconds: -2, dpSpar: "on" as unknown as boolean, dpStringLayout: "radial" });
    expect(p).toMatchObject({ dpMass1: 5, dpTrailSeconds: 0, dpSpar: false, dpStringLayout: "radial" });
  });
});

/* ------------------------------------------------------------------ renderer */

function recordingContext() {
  const strokes: { alpha: number; style: string; width: number; points: [number, number][] }[] = [];
  let points: [number, number][] = [];
  const ctx = {
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save() {},
    restore() {},
    beginPath() {
      points = [];
    },
    moveTo(x: number, y: number) {
      points.push([x, y]);
    },
    lineTo(x: number, y: number) {
      points.push([x, y]);
    },
    quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
      points.push([x, y]);
    },
    arc() {},
    fill() {},
    fillRect() {},
    stroke() {
      strokes.push({ alpha: ctx.globalAlpha, style: String(ctx.strokeStyle), width: ctx.lineWidth, points });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

const renderOptions: DoublePendulumRenderOptions = { wallColor: () => "#06b6d4", rainbow: true, wallThickness: 2, showGlow: false, showTrails: true, trailThickness: 1 };

describe("renderer", () => {
  it("fades the trail to nothing at its end, turns the rainbow once per trail and rings the strings down", () => {
    expect(trailFade(0, 4)).toBe(1);
    expect(trailFade(2, 4)).toBeCloseTo(0.5, 12);
    expect(trailFade(4, 4)).toBe(0);
    expect(trailFade(9, 4)).toBe(0);
    expect(trailFade(1, 0)).toBe(0);
    expect(trailHue(0, 0, 4)).toBe(0);
    expect(trailHue(30, 2, 4)).toBeCloseTo(210, 9);
    expect(trailHue(0, 4, 4)).toBeCloseTo(0, 9);
    expect(trailHue(0, 0.5, 0)).toBeCloseTo(90, 9);
    expect(trailBands(1)).toBeGreaterThan(trailBands(4));
    expect(stringDisplacement(-1, 1, 0.5)).toBe(0);
    expect(stringDisplacement(0.01, 0, 0.5)).toBe(0);
    let peak = 0;
    for (let t = 0; t < 3; t += 0.004) {
      const d = Math.abs(stringDisplacement(t, 1, 0.5));
      expect(d).toBeLessThanOrEqual(stringEnvelope(t, 1, 0.5) + 1e-12);
      if (t < 0.1) peak = Math.max(peak, d);
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(stringEnvelope(3, 1, 0.5)).toBe(0);
    // Low strings ring longer than high ones.
    expect(stringEnvelope(0.5, 1, 0)).toBeGreaterThan(stringEnvelope(0.5, 1, 1));
  });

  it("draws the strings, a trail that starts at the last bob and fades out, and the bodies – the same picture every time", () => {
    const engine = dpEngine({ endless: true, trailSeconds: 3 });
    const view = engine.getDoublePendulumView();
    const empty = recordingContext();
    drawDoublePendulumTrails(empty.ctx, view, renderOptions);
    expect(empty.strokes.length).toBeLessThanOrEqual(1);
    run(engine, 600);
    const strings = recordingContext();
    drawDoublePendulumStrings(strings.ctx, view, renderOptions);
    expect(strings.strokes.length).toBeGreaterThanOrEqual(view.strings.length);
    expect(strings.strokes.length).toBeLessThanOrEqual(2 * view.strings.length);
    const { ctx, strokes } = recordingContext();
    drawDoublePendulumTrails(ctx, view, renderOptions);
    expect(strokes.length).toBeGreaterThan(10);
    expect(strokes.length).toBeLessThanOrEqual(trailBands(1) + 2);
    const f = view.field!;
    const bob = engine.getBalls()[1];
    expect(strokes[0].points[0][0]).toBeCloseTo(bob.x, 9);
    expect(strokes[0].points[0][1]).toBeCloseTo(bob.y, 9);
    expect(bob.x).toBeCloseTo(f.cx + view.pendulums[0].bobX[1] * f.scale, 9);
    // Newest first: the opacity falls along the trail, and nothing older than the trail length is drawn.
    for (let i = 1; i < strokes.length; i++) expect(strokes[i].alpha).toBeLessThanOrEqual(strokes[i - 1].alpha + 1e-12);
    const again = recordingContext();
    drawDoublePendulumTrails(again.ctx, view, renderOptions);
    expect(again.strokes).toEqual(strokes);
    // The trail switch of the Visual section hides it, and so does a trail length of 0.
    const off = recordingContext();
    drawDoublePendulumTrails(off.ctx, view, { ...renderOptions, showTrails: false });
    engine.setDoublePendulumSettings({ trailSeconds: 0 });
    drawDoublePendulumTrails(off.ctx, view, renderOptions);
    expect(off.strokes).toHaveLength(0);
    const bodies = recordingContext();
    drawDoublePendulumBodies(bodies.ctx, view, renderOptions);
    // One rod path per pendulum from its pivot, plus a ring per bob.
    expect(bodies.strokes[0].points[0]).toEqual([f.cx, f.cy]);
    expect(bodies.strokes.length).toBe(1 + view.segments);
  });

  it("lays the field out as the centred square with room for the reach and the biggest bob", () => {
    const f = buildDpField(800, 600, 1, 0.025);
    expect(f.side).toBeCloseTo(576, 9);
    expect(f.scale).toBeCloseTo(576 * 0.445, 9);
    expect(f.cx - f.side / 2).toBeCloseTo(f.left, 9);
    const spar = buildDpField(800, 600, 1.5, 0.025);
    expect(spar.scale * 1.5).toBeCloseTo(f.scale, 9);
  });
});
