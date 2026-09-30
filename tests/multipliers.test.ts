import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HASHED_PAIRS_FROM, PhysicsEngine } from "@/lib/physics/engine";
import { MULTIPLY_MAX_BALLS, MULTIPLY_MAX_BALLS_WITH_MULTIPLIERS } from "@/lib/physics/modes/multiply";
import {
  DEFAULT_MULTIPLIER_CONFIG,
  MAX_EFFECTIVE_BOUNCE,
  MAX_SUBSTEPS,
  MIN_DILATION,
  MULTIPLIER_CEILING,
  applyMultiplier,
  ballCorridor,
  clampMultiplier,
  cruiseSpeed,
  effectiveBounce,
  effectiveCap,
  fitBallToRings,
  formatDilation,
  formatMultiplier,
  hitDamage,
  maxMovePerSubStep,
  multiplierArpeggio,
  multiplierConfigOf,
  parsePickupTypes,
  pickupInterval,
  planForRatio,
  resolveMultiplierConfig,
  sanitizePickupTypes,
  smashesWalls,
  stackMultiplier,
  unitMultipliers,
} from "@/lib/physics/multipliers";
import { ARPEGGIO_STEP, arpeggioNotes } from "@/lib/audio/multiplierTones";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import type { Ball, CircularWall, GameMode, ModeContext, ModeId, PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

// Whole runs of the engine: generous timeouts, so a busy machine does not fail them.
vi.setConfig({ testTimeout: 30_000 });

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

function ball(patch: Partial<Ball> = {}): Ball {
  return { id: 0, x: 0, y: 0, vx: 300, vy: 400, radius: 8, color: "#fff", trail: [], trailIndex: 0, spin: 0, angle: 0, ...patch };
}

function engineFor(mode: ModeId, seed: number, patch: Partial<PhysicsConfig> = {}) {
  const engine = new PhysicsEngine({ ...config, ...patch });
  engine.setCinematicEnabled(false);
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

/** Positions of every ball ×1000 after `frames` frames. */
function trajectory(engine: PhysicsEngine, frames: number): number[][] {
  const out: number[][] = [];
  for (let f = 1; f <= frames; f++) {
    engine.update(1000 / 60, 0);
    engine.consumeSoundEvents();
    if (f % 30 === 0) out.push(engine.getBalls().flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000), Math.round(b.radius * 1000)]));
  }
  return out;
}

/** The first moment a ball sat outside an intact ring it had not passed (beyond radius + ball radius + 2), or null. */
function outsideIntactRing(engine: PhysicsEngine): string | null {
  const cx = engine.config.width / 2;
  const cy = engine.config.height / 2;
  const walls = engine.getCircularWalls();
  const broken = engine.getBrokenWalls();
  for (const b of engine.getBalls()) {
    const dist = Math.hypot(b.x - cx, b.y - cy);
    for (let w = 0; w < walls.length; w++) {
      if (!broken.has(w) && dist > walls[w].radius + b.radius + 2) return `ball ${b.id} at ${dist.toFixed(1)} outside intact wall ${w} (${walls[w].radius.toFixed(1)})`;
    }
  }
  return null;
}

describe("stat multipliers: the maths", () => {
  it("stacks multiplicatively without any cap by default", () => {
    let v = 1;
    for (let i = 0; i < 40; i++) v = stackMultiplier(v, 2);
    expect(v).toBe(2 ** 40);
    expect(stackMultiplier(3, 1.5)).toBe(4.5);
    // A division goes below ×1, and only a float-safety ceiling far beyond any run stops a pathological stack.
    expect(stackMultiplier(1, 0.5)).toBe(0.5);
    expect(stackMultiplier(2 ** 49, 2 ** 20)).toBe(MULTIPLIER_CEILING);
    expect(clampMultiplier(Number.NaN)).toBe(1);
    expect(effectiveCap(DEFAULT_MULTIPLIER_CONFIG)).toBe(Infinity);
    expect(effectiveCap({ mpUnlimited: true, mpCap: 8 })).toBe(Infinity);
    expect(effectiveCap({ mpUnlimited: false, mpCap: 0 })).toBe(Infinity);
    expect(effectiveCap({ mpUnlimited: false, mpCap: 8 })).toBe(8);
  });

  it("applies each stat where it acts: velocity, radius and radiusScale, gravityScale", () => {
    const b = ball();
    expect(applyMultiplier(b, "speed", 2)).toBe(2);
    expect([b.vx, b.vy]).toEqual([600, 800]);
    expect(applyMultiplier(b, "speed", 2)).toBe(2);
    expect(b.mult!.speed).toBe(4);
    expect(Math.hypot(b.vx, b.vy)).toBe(2000);
    applyMultiplier(b, "size", 1.5);
    expect(b.radius).toBe(12);
    expect(b.radiusScale).toBe(1.5);
    applyMultiplier(b, "gravity", 2);
    expect(b.gravityScale).toBe(2);
    applyMultiplier(b, "damage", 2);
    applyMultiplier(b, "damage", 2);
    applyMultiplier(b, "bounce", 1.25);
    expect(b.mult).toEqual({ speed: 4, size: 1.5, damage: 4, bounce: 1.25, gravity: 2 });
    expect(cruiseSpeed(b, 400)).toBe(1600);
    expect(hitDamage(b)).toBe(4);
    expect(effectiveBounce(b)).toBe(1.25);
    // Plain balls are ×1 without a record.
    const plain = ball();
    expect([cruiseSpeed(plain, 400), hitDamage(plain), effectiveBounce(plain)]).toEqual([400, 1, 1]);
    expect(plain.mult).toBeUndefined();
  });

  it("caps every stat at ×cap (and ÷cap) when a cap is set, applying only what fits", () => {
    const b = ball();
    for (let i = 0; i < 10; i++) applyMultiplier(b, "speed", 2, 16);
    expect(b.mult!.speed).toBe(16);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(500 * 16, 6);
    expect(applyMultiplier(b, "speed", 2, 16)).toBe(1);
    const c = ball();
    for (let i = 0; i < 10; i++) applyMultiplier(c, "size", 0.5, 4);
    expect(c.mult!.size).toBe(0.25);
    expect(c.radius).toBe(2);
  });

  it("caps the effect of a bounce multiplier at ×1.5 while the stat itself keeps stacking", () => {
    const b = ball();
    for (let i = 0; i < 8; i++) applyMultiplier(b, "bounce", 2);
    expect(b.mult!.bounce).toBe(256);
    expect(effectiveBounce(b)).toBe(MAX_EFFECTIVE_BOUNCE);
  });

  it("formats factors for the HUD", () => {
    expect(formatMultiplier(1)).toBe("x1");
    expect(formatMultiplier(1.5)).toBe("x1.5");
    expect(formatMultiplier(16)).toBe("x16");
    expect(formatMultiplier(512)).toBe("x512");
    expect(formatMultiplier(1536)).toBe("x1.5k");
    expect(formatMultiplier(2 ** 20)).toBe("x1M");
    expect(formatMultiplier(0.5)).toBe("÷2");
    expect(formatMultiplier(Infinity)).toBe("x∞");
    expect(formatDilation(0.5)).toBe("x0.5");
    expect(formatDilation(0.125)).toBe("x0.125");
    expect(formatDilation(1 / 32)).toBe("x1/32");
  });

  it("smashes rings from the threshold on, in the escape modes only", () => {
    const b = ball();
    expect(smashesWalls(b, 4, "classic")).toBe(false);
    applyMultiplier(b, "damage", 2);
    expect(smashesWalls(b, 4, "classic")).toBe(false);
    applyMultiplier(b, "damage", 2);
    expect(smashesWalls(b, 4, "classic")).toBe(true);
    expect(smashesWalls(b, 4, "shatter")).toBe(true);
    expect(smashesWalls(b, 4, "lines")).toBe(false);
    expect(smashesWalls(b, 4, "paint")).toBe(false);
    expect(smashesWalls(b, 8, "classic")).toBe(false);
  });

  it("plans sub-steps so no ball moves more than half its radius (at most 4 px), then slows the clock by powers of two", () => {
    expect(maxMovePerSubStep(8)).toBe(4);
    expect(maxMovePerSubStep(30)).toBe(4);
    expect(maxMovePerSubStep(4)).toBe(2);
    expect(planForRatio(0)).toEqual({ subSteps: 0, dilation: 1 });
    expect(planForRatio(3.2)).toEqual({ subSteps: 4, dilation: 1 });
    expect(planForRatio(64)).toEqual({ subSteps: 64, dilation: 1 });
    expect(planForRatio(65)).toEqual({ subSteps: 33, dilation: 0.5 });
    const huge = planForRatio(1667);
    expect(huge.dilation).toBe(1 / 32);
    expect(huge.subSteps).toBeLessThanOrEqual(MAX_SUBSTEPS);
    for (const ratio of [1, 10, 63.9, 64.1, 200, 1e4, 1e7]) {
      const plan = planForRatio(ratio);
      expect(plan.subSteps).toBeLessThanOrEqual(MAX_SUBSTEPS);
      // Per sub-step the ball covers ratio · dilation / subSteps of its allowed move: never more than one.
      expect((ratio * plan.dilation) / plan.subSteps).toBeLessThanOrEqual(1 + 1e-12);
      expect(Number.isInteger(Math.log2(plan.dilation))).toBe(true);
    }
    expect(planForRatio(Infinity).dilation).toBe(MIN_DILATION);
  });

  it("refits a grown ball into its corridor: moved clear, bursting rings it no longer fits, outgrowing the arena", () => {
    const walls: CircularWall[] = [100, 120, 140, 200].map((radius) => ({ radius, gaps: [] }));
    const none = new Set<number>();
    // Inside the innermost ring, fits: only pulled clear of the ring.
    expect(fitBallToRings(95, 10, walls, none)).toEqual({ burst: [], outgrown: false, dist: 89 });
    expect(fitBallToRings(40, 10, walls, none)).toEqual({ burst: [], outgrown: false, dist: 40 });
    // Too big for the innermost ring: it bursts, and the next ring holds it.
    expect(fitBallToRings(20, 110, walls, none)).toEqual({ burst: [0], outgrown: false, dist: 9 });
    // Bigger than the arena: outgrown after bursting every ring inside it.
    expect(fitBallToRings(20, 250, walls, none)).toMatchObject({ burst: [0, 1, 2], outgrown: true });
    // In a corridor (between 100 and 120) a ball of radius 12 does not fit: the ring around it bursts.
    expect(fitBallToRings(110, 12, walls, none, 8)).toMatchObject({ burst: [1], outgrown: false });
    // A corridor too narrow even for the ball's own size is left as the engine handled it.
    expect(fitBallToRings(110, 14, walls, none, 12)).toEqual({ burst: [], outgrown: false, dist: 110 });
    // In the outermost corridor the rings inside it burst (innermost last) instead of the arena.
    expect(fitBallToRings(170, 40, walls, none, 8)).toMatchObject({ burst: [2, 1], outgrown: false, dist: 159 });
    // Broken rings do not count, and a ball outside every intact ring is free.
    expect(fitBallToRings(250, 30, walls, new Set([3]))).toEqual({ burst: [], outgrown: false, dist: 250 });
    expect(ballCorridor(110, walls, none)).toEqual({ inner: 100, outer: 120 });
    expect(ballCorridor(300, walls, none)).toBeNull();
  });

  it("climbs the pickup arpeggio with the total: more notes, a higher root", () => {
    const low = multiplierArpeggio(2);
    const high = multiplierArpeggio(1024);
    expect(low.length).toBe(3);
    expect(high.length).toBeGreaterThan(low.length);
    expect(high[0]).toBeGreaterThan(low[0]);
    for (const arp of [low, high]) for (let i = 1; i < arp.length; i++) expect(arp[i]).toBeGreaterThan(arp[i - 1]);
    const notes = arpeggioNotes(8, 440);
    expect(notes[0].frequency).toBeCloseTo(440, 6);
    expect(notes[1].offset).toBeCloseTo(ARPEGGIO_STEP, 12);
    expect(pickupInterval(1, 0.5)).toBe(10);
    expect(pickupInterval(0, 0.5)).toBe(Infinity);
  });
});

describe("stat multipliers in the engine", () => {
  it("leaves a run without multipliers on its old path (no plan, no HUD)", () => {
    const engine = engineFor("classic", 5);
    for (let f = 0; f < 120; f++) engine.update(1000 / 60, 0);
    const view = engine.getMultiplierView();
    expect(view.active).toBe(false);
    expect(view.subSteps).toBe(0);
    expect(view.dilation).toBe(1);
    expect(engine.getBalls().every((b) => b.mult === undefined)).toBe(true);
  });

  it("keeps a ball at ×1000 speed inside its rings (only gaps and smashes let it out), a step at a time of ≤ 4 px", () => {
    for (const seed of [1, 2, 3]) {
      const engine = engineFor("classic", seed);
      engine.applyBallMultiplier(engine.getBalls()[0], "speed", 1000);
      // Watch every sub-step: the move the engine integrated (speed × sub-step) never exceeds the limit.
      let worst = 0;
      const mode = engine.classicMode as GameMode;
      const step = mode.onBallStep.bind(mode);
      mode.onBallStep = (ctx: ModeContext, b: Ball, dt: number) => {
        worst = Math.max(worst, (Math.hypot(b.vx, b.vy) * dt) / maxMovePerSubStep(b.radius));
        step(ctx, b, dt);
      };
      let dilated = false;
      for (let f = 0; f < 600 && !engine.isSimulationFinished(); f++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        const view = engine.getMultiplierView();
        if (view.dilation < 1) dilated = true;
        expect(view.subSteps).toBeLessThanOrEqual(MAX_SUBSTEPS);
        expect(outsideIntactRing(engine), `seed ${seed} frame ${f}`).toBeNull();
      }
      expect(dilated).toBe(true);
      expect(worst).toBeLessThanOrEqual(1 + 1e-9);
      expect(engine.getMultiplierView().smashes).toBe(0);
    }
  });

  it("keeps two fast, big balls and a heavy one inside their rings too", () => {
    const engine = engineFor("classic", 9, { twoBalls: true });
    const [a, b] = engine.getBalls();
    engine.applyBallMultiplier(a, "speed", 64);
    engine.applyBallMultiplier(b, "speed", 16);
    engine.applyBallMultiplier(b, "size", 2);
    engine.applyBallMultiplier(b, "gravity", 8);
    for (let f = 0; f < 900 && !engine.isSimulationFinished(); f++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      expect(outsideIntactRing(engine), `frame ${f}`).toBeNull();
      for (const ball of engine.getBalls()) expect(Number.isFinite(ball.x) && Number.isFinite(ball.y)).toBe(true);
    }
  });

  it("raises the cruising speed: rebounds and the slow-ball boost follow the speed multiplier", () => {
    const engine = engineFor("classic", 4, { gravity: 0 });
    const b = engine.getBalls()[0];
    engine.applyBallMultiplier(b, "speed", 3);
    for (let f = 0; f < 240; f++) engine.update(1000 / 60, 0);
    // Every rebound is at 3 × 400 px/s (the director is off, no bouncier, no gravity).
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(1200, 3);
  });

  it("smashes the rings on contact once the damage reaches the threshold, with the wall-break sound", () => {
    const smashed = (damage: number, threshold = 4) => {
      const engine = engineFor("classic", 6, { wallSmashThreshold: threshold });
      const b = engine.getBalls()[0];
      engine.applyBallMultiplier(b, "damage", damage);
      let gaps = 0;
      for (let f = 0; f < 240; f++) {
        engine.update(1000 / 60, 0);
        gaps += engine.consumeSoundEvents().filter((e) => e.type === "gap").length;
      }
      return { smashes: engine.getMultiplierView().smashes, broken: engine.getBrokenWalls().size, gaps };
    };
    const below = smashed(2);
    expect(below.smashes).toBe(0);
    const at = smashed(4);
    expect(at.smashes).toBeGreaterThanOrEqual(3);
    expect(at.broken).toBeGreaterThanOrEqual(at.smashes);
    expect(at.gaps).toBeGreaterThanOrEqual(at.smashes);
    expect(smashed(4, 8).smashes).toBe(0);
    // Lines keeps its arena whatever the damage.
    const lines = engineFor("lines", 6);
    lines.applyBallMultiplier(lines.getBalls()[0], "damage", 100);
    for (let f = 0; f < 240; f++) lines.update(1000 / 60, 0);
    expect(lines.getMultiplierView().smashes).toBe(0);
    expect(lines.getBrokenWalls().size).toBe(0);
  });

  it("lets a ball grow up to the arena inside its rings, bursting the rings it outgrows, then ends the run: OUTGREW THE ARENA", () => {
    const engine = engineFor("classic", 2);
    const b = engine.getBalls()[0];
    const walls = engine.getCircularWalls();
    const arena = walls[walls.length - 1].radius;
    let finished = false;
    for (let round = 0; round < 40 && !finished; round++) {
      engine.applyBallMultiplier(b, "size", 1.25);
      for (let f = 0; f < 30; f++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        if (engine.isSimulationFinished()) {
          finished = true;
          break;
        }
        expect(outsideIntactRing(engine), `radius ${b.radius.toFixed(1)}`).toBeNull();
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      }
    }
    const view = engine.getMultiplierView();
    expect(finished).toBe(true);
    expect(view.outgrown).toBe(true);
    expect(view.bursts).toBeGreaterThan(0);
    expect(b.radius).toBeLessThanOrEqual(arena);
    // The run is over: the physics stops.
    const x = b.x;
    const t = engine.getElapsedMs();
    engine.update(1000 / 60, 0);
    expect([b.x, engine.getElapsedMs()]).toEqual([x, t]);
  });

  it("outgrows a single-ring arena (Grow) at once instead of glitching", () => {
    const engine = engineFor("grow", 3);
    const b = engine.getBalls()[0];
    expect(engine.endsWithMultiplierFinish()).toBe(false);
    engine.applyBallMultiplier(b, "size", 40);
    engine.update(1000 / 60, 0);
    expect(engine.getMultiplierView().outgrown).toBe(true);
    expect(engine.isSimulationFinished()).toBe(true);
    // The page holds this celebration on screen (and in a recording) before its end screen covers it.
    expect(engine.endsWithMultiplierFinish()).toBe(true);
    expect(engine.consumeSoundEvents().some((e) => e.type === "multiplier")).toBe(true);
  });

  it("tells an ordinary finish from a multipliers celebration", () => {
    // A Classic escape through one wide gap, with and without pickups on: finished, but nothing for the multipliers to hold.
    for (const pickups of [false, true]) {
      const engine = engineFor("classic", 4, { wallCount: 1, gapSize: 1.4, multiplierPickups: pickups, pickupTypes: "damage" });
      for (let f = 0; f < 60 * 60 && !engine.isSimulationFinished(); f++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        expect(engine.endsWithMultiplierFinish()).toBe(false);
      }
      expect(engine.isSimulationFinished(), `pickups ${pickups}`).toBe(true);
      expect(engine.getMultiplierView().outgrown).toBe(false);
      expect(engine.endsWithMultiplierFinish()).toBe(false);
    }
  });

  it("wears Shatter segments down by the damage multiplier and clears Target numbers with it", () => {
    const shatter = engineFor("shatter", 1);
    shatter.setShatterHpPerSegment(3);
    shatter.initMode("shatter");
    const ctx = shatter.ctx;
    const cx = shatter.config.width / 2;
    const cy = shatter.config.height / 2;
    const r0 = shatter.getCircularWalls()[0].radius;
    const b = shatter.getBalls()[0];
    b.x = cx + r0 - 12;
    b.y = cy;
    shatter.applyBallMultiplier(b, "damage", 3);
    shatter.shatterMode.onWallHit(ctx, b, 0, 0.01);
    const seg = shatter.getShatterSegments()[0][0];
    expect(seg.hp).toBe(0);
    expect(shatter.getShatterProgress().broken).toBe(1);

    const target = engineFor("target", 1);
    const tb = target.getBalls()[0];
    target.applyBallMultiplier(tb, "damage", 3);
    const total = target.getCountdownTotal();
    // The segment of the current target (number 10 at index 0, starting at 12 o'clock).
    const angle = -Math.PI / 2 + Math.PI / total;
    target.targetMode.onWallHit(target.ctx, tb, 0, ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    expect(target.getCountdownTarget()).toBe(total - 3);
  });

  it("spawns seeded pickup orbs in the ring modes; touching one stacks it, plays the arpeggio and pops the HUD", () => {
    const engine = engineFor("classic", 7, { multiplierPickups: true, pickupRate: 3, pickupTypes: "speed,size,damage" });
    let arpeggios = 0;
    let orbsSeen = 0;
    for (let f = 0; f < 60 * 40; f++) {
      engine.update(1000 / 60, 0);
      arpeggios += engine.consumeSoundEvents().filter((e) => e.type === "multiplier" && (e.multiplier ?? 0) > 1).length;
      orbsSeen = Math.max(orbsSeen, engine.getMultiplierView().orbs.length);
      for (const orb of engine.getMultiplierView().orbs) expect(["speed", "size", "damage"]).toContain(orb.kind);
      if (engine.isSimulationFinished()) break;
    }
    const view = engine.getMultiplierView();
    expect(orbsSeen).toBeGreaterThan(0);
    expect(view.pickupsTaken).toBeGreaterThan(0);
    expect(arpeggios).toBe(view.pickupsTaken + (view.outgrown ? 1 : 0));
    expect(view.active).toBe(true);
    const changed = Object.values(view.changedAt).some((t) => t > -Infinity);
    expect(changed).toBe(true);
    expect(view.speed * view.size * view.damage).toBeGreaterThan(1);
  });

  it("clones the ball with x2 BALLS within the ball cap, and never spawns x2 BALLS where one ball is the game", () => {
    const engine = engineFor("classic", 11, { multiplierPickups: true, pickupRate: 3, pickupTypes: "balls", maxBalls: 4 });
    let most = 1;
    for (let f = 0; f < 60 * 60 && !engine.isSimulationFinished(); f++) {
      engine.update(1000 / 60, 0);
      most = Math.max(most, engine.getBalls().length);
    }
    expect(engine.getMultiplierView().pickupsTaken).toBeGreaterThan(0);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
    const portal = engineFor("portal", 11, { multiplierPickups: true, pickupRate: 3, pickupTypes: "balls" });
    for (let f = 0; f < 60 * 20; f++) portal.update(1000 / 60, 0);
    expect(portal.getMultiplierView().orbs.length).toBe(0);
    expect(portal.getBalls().length).toBe(1);
  });

  it("lets orbs fade after their lifetime and spawns none in the rhythm modes", () => {
    const engine = engineFor("lines", 3, { multiplierPickups: true, pickupRate: 3, pickupLifetime: 2 });
    let oldest = 0;
    for (let f = 0; f < 60 * 30; f++) {
      engine.update(1000 / 60, 0);
      const now = engine.getElapsedMs();
      for (const orb of engine.getMultiplierView().orbs) oldest = Math.max(oldest, now - orb.bornMs);
    }
    expect(oldest).toBeGreaterThan(0);
    expect(oldest).toBeLessThanOrEqual(2000 + 1000 / 60);
    const drop = engineFor("drop", 3, { multiplierPickups: true, pickupRate: 3 });
    for (let f = 0; f < 60 * 10; f++) drop.update(1000 / 60, 0);
    expect(drop.getMultiplierView().orbs.length).toBe(0);
    expect(drop.getMultiplierView().active).toBe(false);
  });

  it("is deterministic with multipliers on (pickups, clones, smashes, sizes) and differs between seeds", () => {
    const run = (seed: number) => {
      const engine = engineFor("classic", seed, { multiplierPickups: true, pickupRate: 3, pickupTypes: "speed,size,damage,balls,bounce,gravity" });
      engine.applyBallMultiplier(engine.getBalls()[0], "speed", 3);
      return { path: trajectory(engine, 900), taken: engine.getMultiplierView().pickupsTaken, broken: [...engine.getBrokenWalls()].sort() };
    };
    expect(run(21)).toEqual(run(21));
    expect(run(21).path).not.toEqual(run(22).path);
    const shatter = (seed: number) => {
      const engine = engineFor("shatter", seed, { wallCount: 10, multiplierPickups: true, pickupRate: 2 });
      return trajectory(engine, 900);
    };
    expect(shatter(5)).toEqual(shatter(5));
  });

  it("gives Multiply's new balls the escaped ball's multipliers, and split halves keep theirs", () => {
    const engine = engineFor("multiply", 1);
    const b = engine.getBalls()[0];
    engine.applyBallMultiplier(b, "speed", 2);
    engine.applyBallMultiplier(b, "damage", 2);
    let spawned = false;
    for (let f = 0; f < 60 * 60 && !spawned; f++) {
      engine.update(1000 / 60, 0);
      spawned = engine.getBalls().some((x) => x.id !== b.id);
    }
    expect(spawned).toBe(true);
    const child = engine.getBalls().find((x) => x.id !== b.id)!;
    expect(child.mult).toEqual({ speed: 2, size: 1, damage: 2, bounce: 1, gravity: 1 });
    expect(child.mult).not.toBe(b.mult);
    const split = engineFor("classic", 3, { ballInteraction: "split" });
    const s = split.getBalls()[0];
    split.applyBallMultiplier(s, "damage", 2);
    for (let f = 0; f < 60 * 30 && split.getBalls().length < 2; f++) split.update(1000 / 60, 0);
    expect(split.getBalls().length).toBeGreaterThan(1);
    for (const x of split.getBalls()) expect(x.mult?.damage).toBe(2);
  });
});

describe("Multiply with multipliers in play", () => {
  /**
   * Runs `seconds` of frames and returns the peak ball count and the median and mean wall-clock ms of a frame's physics
   * once past `warmSec` (the median shrugs off the odd garbage collection or a busy machine).
   */
  function crowdRun(engine: PhysicsEngine, seconds: number, warmSec = 0) {
    let peak = 0;
    const times: number[] = [];
    for (let f = 0; f < seconds * 60; f++) {
      const t0 = performance.now();
      engine.update(1000 / 60, 0);
      const ms = performance.now() - t0;
      engine.consumeSoundEvents();
      peak = Math.max(peak, engine.getBalls().length);
      if (f >= warmSec * 60) times.push(ms);
    }
    times.sort((a, b) => a - b);
    const medianMs = times.length > 0 ? times[Math.floor(times.length / 2)] : 0;
    const avgMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    return { peak, medianMs, avgMs };
  }

  it("stops multiplying at the cap: inherited speed would otherwise explode the ball count and the frame cost", () => {
    // Speed pickups (?mpk=1&mpr=3&mpty=speed): every orb doubles the speed, faster balls escape sooner and each escape
    // adds three balls that inherit it – this used to peak at 767–900 balls and 20–36 ms of physics a frame.
    // (This seed passes 64 balls at 14.5 s and reaches the cap at 16.5 s; the frames are timed from 17 s on.)
    const pickups = engineFor("multiply", 1, { width: 800, height: 800, gapSize: 0.3, multiplierPickups: true, pickupRate: 3, pickupTypes: "speed" });
    const a = crowdRun(pickups, 24, 17);
    expect(pickups.getMultiplierView().speed).toBeGreaterThanOrEqual(4);
    expect(a.peak).toBeGreaterThan(HASHED_PAIRS_FROM);
    expect(a.peak).toBeLessThanOrEqual(MULTIPLY_MAX_BALLS_WITH_MULTIPLIERS);
    // A ball at x16 speed from the start (it used to reach 1540 balls in 8 s, at 105 ms a frame).
    const fast = engineFor("multiply", 1, { width: 800, height: 800, gapSize: 0.3 });
    fast.applyBallMultiplier(fast.getBalls()[0], "speed", 16);
    const b = crowdRun(fast, 11, 8.5);
    expect(b.peak).toBeLessThanOrEqual(MULTIPLY_MAX_BALLS_WITH_MULTIPLIERS);
    expect(b.peak).toBeGreaterThan(HASHED_PAIRS_FROM);
    // Well inside the 60 fps frame budget: the physics of a frame measures ~2–4 ms here (it used to be 20–100 ms); the
    // bound is generous for a busy machine.
    for (const run of [a, b]) expect(run.medianMs, `peak ${run.peak}, mean ${run.avgMs.toFixed(2)} ms`).toBeLessThan(1000 / 60);
  }, 120_000);

  it("caps every Multiply run at the swarm's ceiling, with or without multipliers; below it every escape spawns as usual", () => {
    expect(MULTIPLY_MAX_BALLS_WITH_MULTIPLIERS).toBe(MULTIPLY_MAX_BALLS);
    const escapes = (withMultipliers: boolean, outside: number) => {
      const engine = engineFor("multiply", 5);
      if (withMultipliers) engine.applyBallMultiplier(engine.getBalls()[0], "damage", 2);
      // Balls outside the ring: each escapes in the next step and would spawn three more.
      for (let i = 0; i < outside; i++) engine.addBall({ x: 2400 + 3 * i, y: 300, vx: 0, vy: 0, radius: 8, color: "#fff" });
      const sounds = () => engine.consumeSoundEvents().filter((e) => e.type === "gap").length;
      engine.update(1000 / 60, 0);
      return { balls: engine.getBalls().length, gaps: sounds() };
    };
    // Past the ceiling an escape still counts (its "gap" sound) but spawns nothing – an ordinary run too.
    for (const withMultipliers of [false, true]) {
      const past = escapes(withMultipliers, 210);
      expect(past.balls, `multipliers ${withMultipliers}`).toBe(211);
      expect(past.gaps).toBe(210);
      // Below the ceiling it spawns as usual.
      expect(escapes(withMultipliers, 10).balls).toBe(11 + 3 * 10);
    }
  });

  it("keeps an ordinary Multiply run's swarm at the ceiling instead of letting it explode (seed 2 passed 1,000 balls at 60 s)", () => {
    // The finding's run: 800×600 at the page's defaults, the director on, three new balls an escape. It reaches the ceiling
    // at about 50 s (it used to go on to 226 balls at 50 s, 310 at 55 s and 1,079 – 100 ms a step – at 60 s).
    const run = (seconds: number, snapshotAt: number) => {
      const engine = new PhysicsEngine({ ...config, width: 800, height: 600, gapSize: 0.3 });
      engine.setMultiplySpawnCount(3);
      engine.setSeed(2);
      engine.initMode("multiply");
      let peak = 0;
      let snapshot: number[][] = [];
      for (let f = 1; f <= seconds * 60; f++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        peak = Math.max(peak, engine.getBalls().length);
        if (f === snapshotAt * 60) snapshot = engine.getBalls().map((b) => [b.id, Math.round(b.x * 1000), Math.round(b.y * 1000)]);
      }
      return { peak, snapshot };
    };
    const a = run(58, 40);
    expect(a.peak).toBe(MULTIPLY_MAX_BALLS);
    expect(run(40, 40).snapshot).toEqual(a.snapshot); // deterministic for the seed
  }, 120_000);

  it("resolves the ball pairs of a big multiplier run through the spatial hash exactly like the pair loop", () => {
    // 50 isolated pairs, each overlapping and closing in: the order of the pass cannot matter, so the hashed pass (100
    // balls, multipliers in play) must end bit for bit where the plain pair loop (no multipliers) ends.
    const build = (touched: boolean) => {
      const engine = engineFor("multiply", 9, { width: 1080, height: 1080, gravity: 0, rotationSpeed: 0 });
      engine.getBalls().length = 0;
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 5; col++) {
          const x = 540 - 200 + 100 * col;
          const y = 540 - 225 + 50 * row;
          engine.addBall({ x: x - 7, y, vx: 90, vy: 10 * (col - 2), radius: 8, color: "#fff" });
          engine.addBall({ x: x + 7, y: y + 1, vx: -90, vy: -10 * (row - 5), radius: 8, color: "#fff" });
        }
      }
      if (touched) engine.applyBallMultiplier(engine.getBalls()[0], "speed", 1);
      return engine;
    };
    const plain = build(false);
    const hashed = build(true);
    expect(hashed.getBalls().length).toBeGreaterThan(HASHED_PAIRS_FROM);
    for (let f = 0; f < 3; f++) {
      plain.update(1000 / 60, 0);
      hashed.update(1000 / 60, 0);
    }
    expect(hashed.getMultiplierView().active).toBe(true);
    expect(plain.getMultiplierView().active).toBe(false);
    const state = (e: PhysicsEngine) => e.getBalls().map((b) => [b.x, b.y, b.vx, b.vy]);
    expect(state(hashed)).toEqual(state(plain));
    // Every pair bounced apart.
    const balls = hashed.getBalls();
    for (let i = 0; i < balls.length; i += 2) expect(balls[i + 1].x - balls[i].x).toBeGreaterThan(16);
    // Balls flung far off the canvas still meet each other (they are clamped into the grid's border cells).
    const far = build(true);
    far.addBall({ x: -6000, y: 20000, vx: 50, vy: 0, radius: 8, color: "#fff" });
    far.addBall({ x: -5990, y: 20000, vx: -50, vy: 0, radius: 8, color: "#fff" });
    const [p, q] = far.getBalls().slice(-2);
    far.update(1000 / 60, 0);
    expect(far.getBalls()).toContain(p);
    expect(q.x - p.x).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(p.vx).toBeLessThan(0);
    expect(q.vx).toBeGreaterThan(0);
  });
});

describe("the multiplier arpeggio in the ToneGenerator", () => {
  let started: { type: string; frequency: number; at: number }[];
  let ctxTime = 0;
  beforeEach(async () => {
    started = [];
    ctxTime = 0;
    const param = (value = 0) => ({ value, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined });
    const node = () => ({ connect: () => undefined, disconnect: () => undefined });
    const ctx = {
      state: "running",
      get currentTime() {
        return ctxTime;
      },
      sampleRate: 48000,
      destination: {},
      resume: async () => undefined,
      close: async () => undefined,
      decodeAudioData: async () => ({ duration: 0.3 }),
      createGain: () => ({ ...node(), gain: param(1) }),
      createAnalyser: () => ({ ...node(), fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128 }),
      createMediaStreamDestination: () => ({ ...node(), stream: {} }),
      createBiquadFilter: () => ({ ...node(), type: "", frequency: param(0), Q: param(0) }),
      createBufferSource: () => ({ ...node(), buffer: null, playbackRate: param(1), onended: null, start: () => undefined, stop: () => undefined }),
      createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined, getChannelData: () => new Float32Array(length) }),
      createOscillator: () => {
        const osc = { ...node(), type: "sine", frequency: param(0), onended: null, start: (when = 0) => void (osc.frequency.value !== 1 && started.push({ type: osc.type, frequency: osc.frequency.value, at: when })), stop: () => undefined };
        return osc;
      },
    };
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return ctx; } });
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const tone = new ToneGenerator();
    await tone.start();
    (globalThis as unknown as { tone: ToneGenerator }).tone = tone;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("plays a rising run with the bounce instrument, snapped to the scale, and one grid slot under the beat lock", () => {
    const tone = (globalThis as unknown as { tone: ToneGenerator }).tone;
    tone.playMultiplier(4);
    expect(started.length).toBe(multiplierArpeggio(4).length);
    expect(started.every((n) => n.type === "triangle")).toBe(true);
    for (let i = 1; i < started.length; i++) {
      expect(started[i].frequency).toBeGreaterThan(started[i - 1].frequency);
      expect(started[i].at).toBeGreaterThan(started[i - 1].at);
    }
    started.length = 0;
    tone.setMusicSettings({ instrument: "square", melodyInstrument: "sine", scale: "pentatonic", rootNote: 0, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/8" });
    ctxTime = 1.01;
    tone.playMultiplier(64);
    tone.playMultiplier(64); // same grid slot: dropped
    expect(started.length).toBe(multiplierArpeggio(64).length);
    expect(started[0].at).toBeCloseTo(1.25, 6);
    expect(started.every((n) => n.type === "square")).toBe(true);
    for (const n of started) expect([0, 2, 4, 7, 9]).toContain(((Math.round(69 + 12 * Math.log2(n.frequency / 440)) % 12) + 12) % 12);
  });

  it("roots the run on a loaded melody's next note with the melody voice", () => {
    const tone = (globalThis as unknown as { tone: ToneGenerator }).tone;
    tone.setCustomNotes([330, 440]);
    tone.playMultiplier(2);
    expect(started[0]).toMatchObject({ type: "sine" });
    expect(started[0].frequency).toBeCloseTo(330, 6);
  });
});

describe("multiplier settings", () => {
  it("default to off / unlimited for every mode and stay out of default links", () => {
    for (const mode of ["classic", "multipliers", "drop"] as ModeId[]) {
      const s = defaultSettings(mode);
      expect(multiplierConfigOf(s)).toEqual(DEFAULT_MULTIPLIER_CONFIG);
      const params = settingsToSearchParams(s);
      for (const key of ["mpu", "mpc", "wst", "mpk", "mpr", "mpty", "mpl"]) expect(params.has(key)).toBe(false);
    }
    expect(resolveMultiplierConfig(undefined)).toEqual(DEFAULT_MULTIPLIER_CONFIG);
  });

  it("round-trip through the URL keys", () => {
    const s = { ...defaultSettings("classic"), mpUnlimited: false, mpCap: 64, wallSmashThreshold: 8, multiplierPickups: true, pickupRate: 2.5, pickupTypes: "speed,balls", pickupLifetime: 12 };
    const params = settingsToSearchParams(s);
    expect(params.get("mpu")).toBe("0");
    expect(params.get("mpc")).toBe("64");
    expect(params.get("wst")).toBe("8");
    expect(params.get("mpk")).toBe("1");
    expect(params.get("mpr")).toBe("2.5");
    expect(params.get("mpty")).toBe("speed,balls");
    expect(params.get("mpl")).toBe("12");
    expect(settingsFromSearchParams(params)).toEqual(s);
  });

  it("clamp URL parameters and presets, and keep only known pickup kinds", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mpc=99999&wst=0&mpr=9&mpl=-3&mpty=gravity,nope,SPEED,speed&mpu=maybe"));
    expect(s.mpCap).toBe(1000);
    expect(s.wallSmashThreshold).toBe(2);
    expect(s.pickupRate).toBe(3);
    expect(s.pickupLifetime).toBe(2);
    expect(s.pickupTypes).toBe("speed,gravity");
    expect(s.mpUnlimited).toBe(true);
    expect(sanitizePickupTypes(42)).toBe(DEFAULT_MULTIPLIER_CONFIG.pickupTypes);
    expect(parsePickupTypes("damage , size")).toEqual(["size", "damage"]);
    const p = presetToSettings({ mode: "classic", multiplierPickups: "yes" as unknown as boolean, pickupRate: Number.NaN, pickupTypes: "x" });
    expect(p.multiplierPickups).toBe(false);
    expect(p.pickupRate).toBe(DEFAULT_MULTIPLIER_CONFIG.pickupRate);
    expect(p.pickupTypes).toBe("");
  });
});

describe("unit multipliers", () => {
  it("start at ×1", () => {
    expect(unitMultipliers()).toEqual({ speed: 1, size: 1, damage: 1, bounce: 1, gravity: 1 });
  });
});
