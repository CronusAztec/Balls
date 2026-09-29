import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  BALL_INTERACTION_RANGES,
  DEFAULT_BALL_INTERACTION,
  ballInteractionOf,
  blendColors,
  canSplit,
  mergeBalls,
  mergedRadius,
  resolveBallInteraction,
  splitBall,
  splitRadius,
} from "@/lib/physics/interactions";
import type { Ball, BallInteraction, BallInteractionConfig, ModeId, PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";

/**
 * The "merge and split balls" feature (lib/physics/interactions.ts): the pure maths (radius, momentum,
 * colour, caps), the engine behaviour in the modes that report wall breaks, and determinism.
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
};

const STEP = 1000 / 60;

function engineFor(mode: ModeId, interaction: Partial<BallInteractionConfig>, seed: number, twoBalls = false): PhysicsEngine {
  return createEngineForSettings({ ...config, ...interaction }, mode, { ...modeSettings, twoBalls }, seed);
}

/** Runs `frames` fixed steps and returns the sound event types in order; `each` runs after every step. */
function run(engine: PhysicsEngine, frames: number, each?: (engine: PhysicsEngine) => void): string[] {
  const events: string[] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    for (const e of engine.consumeSoundEvents()) events.push(e.type);
    each?.(engine);
  }
  return events;
}

const count = (events: string[], type: string) => events.filter((e) => e === type).length;
const totalArea = (engine: PhysicsEngine) => engine.getBalls().reduce((sum, b) => sum + b.radius * b.radius, 0);
const snapshot = (engine: PhysicsEngine) => engine.getBalls().map((b) => [b.id, Math.round(1000 * b.x), Math.round(1000 * b.y), Math.round(1000 * b.radius)]);

function ball(id: number, x: number, y: number, vx: number, vy: number, radius: number, color: string): Ball {
  return { id, x, y, vx, vy, radius, color, trail: [], trailIndex: 0, spin: 0, angle: 0 };
}

/** A classic engine whose balls are replaced by a red (8 px) and a blue (6 px) ball on a head-on course near the centre, far from the walls. */
function collisionCourse(interaction: BallInteraction) {
  const engine = engineFor("classic", { ballInteraction: interaction }, 7);
  engine.setBalls([ball(0, 380, 300, 200, 0, 8, "#ff0000"), ball(1, 420, 300, -200, 0, 6, "#0000ff")]);
  return engine;
}

describe("ball interaction maths", () => {
  it("merges two areas into one radius", () => {
    expect(mergedRadius(3, 4)).toBe(5);
    expect(mergedRadius(8, 8)).toBeCloseTo(8 * Math.SQRT2, 10);
  });

  it("mergeBalls conserves momentum (mass ∝ area), meets at the mass-weighted centre and blends the colours", () => {
    const a = { x: 0, y: 0, vx: 100, vy: 0, radius: 8, color: "#ff0000" };
    const b = { x: 16, y: 0, vx: -50, vy: 20, radius: 8, color: "#0000ff" };
    const m = mergeBalls(a, b);
    expect(m.radius).toBeCloseTo(8 * Math.SQRT2, 10);
    expect(m.x).toBeCloseTo(8, 10);
    expect(m.vx).toBeCloseTo(25, 10);
    expect(m.vy).toBeCloseTo(10, 10);
    expect(m.color).toBe("#800080");
    const big = { x: 0, y: 0, vx: 300, vy: 0, radius: 8, color: "#ffffff" }; // mass 64
    const small = { x: 10, y: 0, vx: -300, vy: 0, radius: 6, color: "#000000" }; // mass 36
    const n = mergeBalls(big, small);
    expect(n.radius ** 2 * n.vx).toBeCloseTo(64 * 300 + 36 * -300, 8);
    expect(n.x).toBeCloseTo(3.6, 10);
    expect(n.color).toBe("#a3a3a3");
  });

  it("blendColors takes short hex, clamps the weight and lets a non-hex colour win by weight", () => {
    expect(blendColors("#fff", "#000", 0.5)).toBe("#808080");
    expect(blendColors("#102030", "#405060", 0)).toBe("#102030");
    expect(blendColors("#102030", "#405060", 1)).toBe("#405060");
    expect(blendColors("#ff0000", "hsl(120, 50%, 50%)", 0.3)).toBe("#ff0000");
    expect(blendColors("#ff0000", "hsl(120, 50%, 50%)", 0.7)).toBe("hsl(120, 50%, 50%)");
  });

  it("splits a ball into halves of half the area and stops at the smallest half or the ball cap", () => {
    expect(splitRadius(8) ** 2).toBeCloseTo(32, 10);
    expect(canSplit(8, 4, 1, 16)).toBe(true);
    expect(canSplit(splitRadius(8), 4, 2, 16)).toBe(true); // 5.66 px halves into two 4 px balls exactly
    expect(canSplit(4, 4, 4, 16)).toBe(false); // 2.83 px halves would be too small
    expect(canSplit(30, 4, 16, 16)).toBe(false); // the cap is reached
    expect(canSplit(30, 4, 15, 16)).toBe(true);
  });

  it("splitBall conserves momentum and area, diverges by 40°–72° and keeps the halves apart", () => {
    const parent = { x: 100, y: 50, vx: 300, vy: -100, radius: 8 };
    for (const r of [0, 0.5, 1]) {
      const [h1, h2] = splitBall(parent, () => r);
      expect(h1.radius ** 2 + h2.radius ** 2).toBeCloseTo(64, 10);
      // Each half carries half the mass, so the sum of their velocities is twice the parent's.
      expect(h1.vx + h2.vx).toBeCloseTo(2 * parent.vx, 8);
      expect(h1.vy + h2.vy).toBeCloseTo(2 * parent.vy, 8);
      const dot = h1.vx * h2.vx + h1.vy * h2.vy;
      const angle = Math.acos(dot / (Math.hypot(h1.vx, h1.vy) * Math.hypot(h2.vx, h2.vy)));
      expect(angle).toBeCloseTo(2 * (Math.PI / 9 + r * (Math.PI / 5 - Math.PI / 9)), 8);
      const gap = Math.hypot(h1.x - h2.x, h1.y - h2.y) - (h1.radius + h2.radius);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(1);
      // Both halves keep going forwards
      expect(h1.vx * parent.vx + h1.vy * parent.vy).toBeGreaterThan(0);
      expect(h2.vx * parent.vx + h2.vy * parent.vy).toBeGreaterThan(0);
    }
    // Deterministic for a given random sequence, different for another
    expect(splitBall(parent, () => 0.25)).toEqual(splitBall(parent, () => 0.25));
    expect(splitBall(parent, () => 0.25)).not.toEqual(splitBall(parent, () => 0.75));
    // A resting ball's halves fly apart in opposite directions
    const [r1, r2] = splitBall({ x: 0, y: 0, vx: 0, vy: 0, radius: 10 }, () => 0.5);
    expect(r1.vx + r2.vx).toBeCloseTo(0, 8);
    expect(r1.vy + r2.vy).toBeCloseTo(0, 8);
    expect(Math.hypot(r1.vx, r1.vy)).toBeGreaterThan(50);
  });

  it("resolves the defaults and clamps bad values", () => {
    expect(resolveBallInteraction(undefined)).toEqual(DEFAULT_BALL_INTERACTION);
    expect(resolveBallInteraction({ ballInteraction: "explode" as BallInteraction, splitMinRadius: 99, maxBalls: 0 })).toEqual({
      ballInteraction: "bounce",
      splitMinRadius: BALL_INTERACTION_RANGES.splitMinRadius.max,
      maxBalls: BALL_INTERACTION_RANGES.maxBalls.min,
    });
    expect(resolveBallInteraction({ ballInteraction: "merge", splitMinRadius: 6.4, maxBalls: Number.NaN })).toEqual({ ballInteraction: "merge", splitMinRadius: 6, maxBalls: 16 });
    expect(ballInteractionOf(defaultSettings("classic"))).toEqual(DEFAULT_BALL_INTERACTION);
  });
});

describe("PhysicsEngine ball interactions", () => {
  it("bounce (the default) rebounds two balls, pass lets them fly through each other", () => {
    const bounce = collisionCourse("bounce");
    run(bounce, 20);
    expect(bounce.getBalls()).toHaveLength(2);
    const [a, b] = bounce.getBalls();
    expect(a.vx).toBeLessThan(0); // the red ball came back
    expect(a.x).toBeLessThan(b.x);
    expect(bounce.getBallInteraction()).toEqual(DEFAULT_BALL_INTERACTION);

    const pass = collisionCourse("pass");
    run(pass, 20);
    expect(pass.getBalls()).toHaveLength(2);
    const [p, q] = pass.getBalls();
    expect(p.vx).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(q.x); // they crossed
  });

  it("merge fuses colliding balls into one with the summed area, the total momentum and a blended colour", () => {
    const engine = collisionCourse("merge");
    const events = run(engine, 10);
    expect(engine.getBalls()).toHaveLength(1);
    const [m] = engine.getBalls();
    expect(m.id).toBe(0);
    expect(m.radius).toBeCloseTo(10, 10);
    expect(m.color).toBe(blendColors("#ff0000", "#0000ff", 0.36));
    expect(m.vx).toBeGreaterThan(0); // the heavier red ball's momentum wins…
    expect(m.vx).toBeLessThan(200); // …but the blue one slowed it down
    expect(count(events, "merge")).toBe(1);
    expect(engine.getParticles().some((p) => p.type === "burst")).toBe(true);
  });

  it("merge leaves overlapping balls alone while they drift apart (as a bounce would)", () => {
    const engine = engineFor("classic", { ballInteraction: "merge" }, 7);
    engine.setBalls([ball(0, 396, 300, -200, 0, 8, "#ff0000"), ball(1, 404, 300, 200, 0, 8, "#0000ff")]);
    expect(count(run(engine, 10), "merge")).toBe(0);
    expect(engine.getBalls()).toHaveLength(2);
  });

  it("split halves a classic ball at every wall break, keeps the total area, respects the caps and stays deterministic", () => {
    const limits: Partial<BallInteractionConfig> = { ballInteraction: "split", splitMinRadius: 4, maxBalls: 16 };
    const engine = engineFor("classic", limits, 12345);
    let maxCount = 0;
    const events = run(engine, 1800, (e) => {
      const balls = e.getBalls();
      maxCount = Math.max(maxCount, balls.length);
      expect(balls.length).toBeLessThanOrEqual(16);
      expect(totalArea(e)).toBeCloseTo(64, 6);
      for (const b of balls) expect(b.radius).toBeGreaterThanOrEqual(4 - 1e-6);
    });
    const splits = count(events, "split");
    expect(splits).toBeGreaterThanOrEqual(1);
    expect(maxCount).toBe(splits + 1); // no ball ever disappears in Classic
    expect(maxCount).toBeLessThanOrEqual(4); // 8 px → 5.66 px → 4 px halves, then no smaller
    const twin = engineFor("classic", limits, 12345);
    expect(run(twin, 1800)).toEqual(events);
    expect(snapshot(twin)).toEqual(snapshot(engine));

    // The ball cap and the smallest half both stop the splitting
    const capped = engineFor("classic", { ...limits, maxBalls: 2 }, 12345);
    const cappedEvents = run(capped, 1800, (e) => expect(e.getBalls().length).toBeLessThanOrEqual(2));
    expect(count(cappedEvents, "split")).toBe(1);
    const whole = engineFor("classic", { ...limits, splitMinRadius: 6 }, 12345);
    expect(count(run(whole, 1800), "split")).toBe(0);
    expect(whole.getBalls()).toHaveLength(1);
  });

  it("split works with two balls and in Shatter, where a broken segment splits the ball that broke it", () => {
    const two = engineFor("classic", { ballInteraction: "split" }, 99, true);
    expect(count(run(two, 1800), "split")).toBeGreaterThanOrEqual(1);
    expect(two.getBalls().length).toBeGreaterThanOrEqual(3);
    expect(totalArea(two)).toBeCloseTo(128, 6);
    const shatter = engineFor("shatter", { ballInteraction: "split" }, 4);
    expect(count(run(shatter, 1200), "split")).toBeGreaterThanOrEqual(1);
    expect(shatter.getBalls().length).toBeGreaterThanOrEqual(2);
  });

  it("Multiply: the half of an escaped ball is escaped too, so a split never counts as a second escape", () => {
    // Deterministic, but the seed itself does not matter: the first few are tried until an escape splits within 30 s.
    let engine: PhysicsEngine | null = null;
    for (let seed = 1; seed <= 12 && !engine; seed++) {
      const candidate = engineFor("multiply", { ballInteraction: "split" }, seed);
      for (let frame = 0; frame < 1800 && !engine; frame++) {
        candidate.update(STEP, 0);
        if (candidate.consumeSoundEvents().some((e) => e.type === "split")) engine = candidate;
      }
    }
    expect(engine).not.toBeNull();
    const mode = engine!.getCurrentMode()!;
    // An escaped ball (it has a lifetime) skips the wall, and only escaped balls do – the new half included.
    const invariant = (e: PhysicsEngine) => {
      for (const b of e.getBalls()) expect(mode.shouldSkipWallCollision(b)).toBe(b.lifetime !== undefined);
    };
    expect(engine!.getBalls().filter((b) => b.lifetime !== undefined).length).toBeGreaterThanOrEqual(2);
    invariant(engine!);
    run(engine!, 600, invariant);
  });

  it("stays deterministic for a seed with merging and splitting on", () => {
    const cases: [ModeId, BallInteraction][] = [
      ["multiply", "split"],
      ["multiply", "merge"],
      ["classic", "merge"],
      ["grow", "merge"],
      ["shatter", "pass"],
    ];
    for (const [mode, interaction] of cases) {
      const a = engineFor(mode, { ballInteraction: interaction, splitMinRadius: 4, maxBalls: 32 }, 2024, true);
      const b = engineFor(mode, { ballInteraction: interaction, splitMinRadius: 4, maxBalls: 32 }, 2024, true);
      expect(run(a, 900)).toEqual(run(b, 900));
      expect(snapshot(a)).toEqual(snapshot(b));
    }
  });
});
