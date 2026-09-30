import { afterEach, describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { LINES_MAX_BOUNCE_POINTS } from "@/lib/physics/modes/lines";
import { TWO_PI, arenaRadius, gapWrap, passableGap, type Gap, type ModeId, type PhysicsConfig } from "@/lib/physics/types";
import { resizeGaps } from "@/lib/simulation/timeline";
import { FINDER_FRAME_BUDGET_MS, createEngineForSettings, findSimulation, simulateSeed, type FinderProgress, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/*
 * Review fixes of the engine core: the finder's Cinematic flag, tunnelling through rings, never escape through a burnt-out
 * portal, gaps a big ball can pass, the portal exits, resizes that keep the run, the finder's frame budget, Lines' points.
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

const settings: ModeSettings = {
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

/** An engine as the page builds it: `new PhysicsEngine`, the seed, the mode. */
function pageEngine(patch: Partial<PhysicsConfig>, mode: ModeId, seed: number) {
  const engine = new PhysicsEngine({ ...config, ...patch });
  engine.setSeed(seed);
  engine.initMode(mode);
  return engine;
}

const distance = (engine: PhysicsEngine, x: number, y: number) => Math.hypot(x - engine.config.width / 2, y - engine.config.height / 2);

describe("Find Simulation follows the Cinematic switch", () => {
  it("a seed found with Cinematic off lasts as long on a page engine with Cinematic off", () => {
    const request = (cinematicEnabled?: boolean): FinderRequest => ({
      targetDurationSec: 30,
      toleranceSec: 0.5,
      maxSeeds: 1,
      maxSimTimeSec: 120,
      physicsConfig: config,
      mode: "portal",
      modeSettings: { ...settings, ...(cinematicEnabled === undefined ? {} : { cinematicEnabled }) },
    });
    // The page: createEngineForSettings' engine with the director switched off, then the found seed started (as the page's
    // initEngineForMode() does), stepped at 60 Hz until the run finishes.
    const page = createEngineForSettings(config, "portal", settings, 4);
    page.setCinematicEnabled(false);
    page.setSeed(4);
    page.initMode("portal");
    let pageMs = 0;
    while (pageMs < 120_000 && !page.isSimulationFinished()) {
      page.update(STEP, 0);
      pageMs += STEP;
    }
    const off = simulateSeed(4, request(false), 120_000);
    const on = simulateSeed(4, request(true), 120_000);
    expect(off).toBeCloseTo(pageMs, 6);
    // The director draws from the seeded RNG and nudges the rebounds: the two runs differ, so a dropped flag shows here.
    expect(on).not.toBeCloseTo(off, 0);
    // Left out, the flag is on – as on the page.
    expect(simulateSeed(4, request(), 120_000)).toBe(on);
  });
});

describe("fast balls do not tunnel through solid rings", () => {
  const fast = { gravity: 2000, ballSpeed: 800, ballRadius: 4 };

  it("Lines: a 4 px ball falling across the ring at ~1,700 px/s stays inside it (seed 2 used to land 12.9 px outside)", () => {
    const engine = pageEngine(fast, "lines", 2);
    const ring = engine.getCircularWalls()[0];
    for (let f = 0; f < 600; f++) {
      engine.update(STEP, 0);
      const b = engine.getBalls()[0];
      expect(distance(engine, b.x, b.y) - ring.radius, `frame ${f}`).toBeLessThan(0);
    }
  });

  it("Classic with one ring: the ball only leaves through the gap, never through the intact ring", () => {
    for (const seed of [2, 18]) {
      const engine = pageEngine({ ...fast, wallCount: 1 }, "classic", seed);
      for (let f = 0; f < 60 * 20 && !engine.isSimulationFinished(); f++) {
        const b = engine.getBalls()[0];
        const before = distance(engine, b.x, b.y);
        engine.update(STEP, 0);
        const ring = engine.getCircularWalls()[0];
        const after = distance(engine, b.x, b.y);
        // Crossing outwards in a step while the ring is still intact means it went through the wall.
        if (before < ring.radius && after > ring.radius) expect(engine.getBrokenWalls().has(0), `seed ${seed}, frame ${f}`).toBe(true);
      }
    }
  });

  it("Accumulation with Ball Size 30: frozen balls never push the ball out through the solid ring (it leaves through the gap)", () => {
    for (const seed of [7, 10]) {
      const engine = createEngineForSettings({ ...config, gapSize: 0.3, ballRadius: 30 }, "accumulation", settings, seed);
      let offGap = -1;
      for (let f = 0; f < 60 * 120 && offGap < 0; f++) {
        engine.update(STEP, 0);
        const ball = engine.getBalls().find((b) => !b.frozen);
        const wall = engine.getCircularWalls()[0];
        if (!ball || distance(engine, ball.x, ball.y) <= wall.radius) continue;
        // The first frame its centre is past the ring: its angle relative to the (turning) gap.
        const angle = Math.atan2(ball.y - engine.config.height / 2, ball.x - engine.config.width / 2);
        const rel = (((angle - engine.getWallRotations()[0] - wall.gaps[0].startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
        const width = wall.gaps[0].endAngle - wall.gaps[0].startAngle;
        offGap = rel <= width ? 0 : Math.min(rel - width, TWO_PI - rel);
      }
      expect(offGap, `seed ${seed}`).toBeGreaterThanOrEqual(0); // it did get out
      expect(offGap, `seed ${seed}`).toBeLessThan(0.05); // through the gap (it used to leave 95° and 147° away from it)
    }
  });
});

describe("never escape holds against a sub-step that jumps the barrier's gap", () => {
  it("refuses the pass and keeps the wall intact when a fast ball's centre is already past a burnt-out portal's exit", () => {
    const engine = createEngineForSettings({ ...config, gravity: 0, neverEscape: true }, "portal", settings, 1);
    const wall = engine.getCircularWalls()[0];
    wall.gaps = [{ startAngle: 0, endAngle: 0.5 }]; // a burnt-out portal's exit
    const ball = engine.getBalls()[0];
    const cx = config.width / 2;
    const cy = config.height / 2;
    const a = 0.25;
    // 20 px inside the ring, heading straight out through the exit at 50 px a sub-step: past the ring's hit band in one move.
    ball.x = cx + Math.cos(a) * (wall.radius - 20);
    ball.y = cy + Math.sin(a) * (wall.radius - 20);
    ball.vx = Math.cos(a) * 12_000;
    ball.vy = Math.sin(a) * 12_000;
    for (let f = 0; f < 30; f++) {
      engine.update(STEP, 0);
      expect(distance(engine, ball.x, ball.y), `frame ${f}`).toBeLessThan(wall.radius);
    }
    expect(engine.getBrokenWalls().size).toBe(0);
    expect(engine.getFirstEscapeMs()).toBe(-1);
    expect(engine.getRigView().seals).toBeGreaterThan(0);
  });

  it("keeps a fast, bouncy Portal run in for two minutes (it used to escape after 3.7 s)", () => {
    const engine = createEngineForSettings({ ...config, gapSize: 0.3, gravity: 1500, ballSpeed: 600, ballRadius: 4, wallBounciness: 1.2, neverEscape: true }, "portal", settings, 9);
    for (let f = 0; f < 60 * 120; f++) engine.update(STEP, 0);
    expect(engine.getFirstEscapeMs()).toBe(-1);
    expect(engine.isSimulationFinished()).toBe(false);
  }, 60_000);
});

describe("ring gaps a big ball can pass", () => {
  it("widens a gap only when the ball could never pass it", () => {
    // 2.5 × the ball's angular radius is what the wall pass needs.
    expect(passableGap(0.3, 124, 8)).toBe(0.3);
    expect(passableGap(0.3, 124, 14)).toBe(0.3);
    expect(passableGap(0.3, 124, 16)).toBeCloseTo(2.5 * Math.atan2(16, 124) + 0.01, 12);
    expect(passableGap(0.3, 124, 0)).toBe(0.3);
    // The default rings keep exactly their gap.
    const engine = pageEngine({ gapSize: 0.3 }, "classic", 1);
    for (const wall of engine.getCircularWalls()) expect(wall.gaps[0].endAngle - wall.gaps[0].startAngle).toBeCloseTo(0.3, 12);
  });

  it("Classic with Ball Size 16 on a 16:9 canvas breaks its first ring (it never did: the inner gaps were too narrow)", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const engine = createEngineForSettings({ ...config, width: 784, height: 441, gapSize: 0.3, ballRadius: 16 }, "classic", settings, seed);
      let broke = false;
      for (let f = 0; f < 60 * 60 && !broke; f++) {
        engine.update(STEP, 0);
        broke = engine.getBrokenWalls().has(0);
      }
      expect(broke, `seed ${seed}`).toBe(true);
    }
  }, 60_000);

  it("sizes the gaps for the merged ball with the merge interaction, and refits them in place when the ball grows mid-run", () => {
    const merged = pageEngine({ gapSize: 0.3, ballInteraction: "merge", ballCount: 6 }, "classic", 1);
    const inner = merged.getCircularWalls()[0];
    expect(inner.gaps[0].endAngle - inner.gaps[0].startAngle).toBeCloseTo(passableGap(0.3, inner.radius, 8 * Math.sqrt(6)), 12);
    const engine = pageEngine({ gapSize: 0.3 }, "classic", 1);
    for (let f = 0; f < 120; f++) engine.update(STEP, 0);
    const rotations = [...engine.getWallRotations()];
    engine.setConfig({ ballRadius: 20 });
    const wall = engine.getCircularWalls()[0];
    expect(wall.gaps[0].endAngle - wall.gaps[0].startAngle).toBeCloseTo(passableGap(0.3, wall.radius, 20), 12);
    expect(engine.getWallRotations()).toEqual(rotations); // in place: the run goes on
    // The timeline's gap keyframes keep the ball's size in mind too.
    const walls = [{ radius: 100, gaps: [{ startAngle: 1, endAngle: 1.3 }] }];
    resizeGaps(walls, 0.2, "classic", 20);
    expect(walls[0].gaps[0].endAngle - 1).toBeCloseTo(passableGap(0.2, 100, 20), 12);
  });
});

/** The arcs the canvas strokes between a ring's gaps (Canvas.tsx: the wall pass and the glow), unrotated. */
function wallArcs(gaps: readonly Gap[]): [number, number][] {
  const arcs: [number, number][] = [];
  const c0 = gapWrap(gaps);
  let cursor = c0;
  for (const gap of gaps) {
    if (gap.startAngle > cursor) arcs.push([cursor, gap.startAngle]);
    cursor = gap.endAngle;
  }
  if (cursor < TWO_PI + c0) arcs.push([cursor, TWO_PI + c0]);
  return arcs;
}

describe("Portal exits", () => {
  it("are drawn open where the burnt-out portals were, and the portal ring does not turn", () => {
    let burnOuts = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const engine = pageEngine({ gapSize: 0.3 }, "portal", seed);
      let gapCount = 0;
      for (let f = 0; f < 60 * 60 && !engine.isSimulationFinished(); f++) {
        engine.update(STEP, 0);
        expect(engine.getWallRotations()[0]).toBe(0);
        const gaps = engine.getCircularWalls()[0].gaps;
        if (gaps.length === gapCount) continue;
        gapCount = gaps.length;
        burnOuts++;
        // Sorted, each starting in [0, 2π).
        for (let i = 0; i < gaps.length; i++) {
          expect(gaps[i].startAngle).toBeGreaterThanOrEqual(0);
          expect(gaps[i].startAngle).toBeLessThan(TWO_PI);
          if (i > 0) expect(gaps[i].startAngle).toBeGreaterThanOrEqual(gaps[i - 1].startAngle);
        }
        // No gap is painted over: its middle lies in none of the stroked arcs (nor 2π further on).
        const arcs = wallArcs(gaps);
        for (const gap of gaps) {
          const mid = (gap.startAngle + gap.endAngle) / 2;
          for (const [a0, a1] of arcs) for (const m of [mid, mid + TWO_PI, mid - TWO_PI]) expect(m > a0 && m < a1, `seed ${seed}: gap at ${mid.toFixed(2)} drawn over`).toBe(false);
        }
        // Every exit sits where its portal was.
        const centres = gaps.map((g) => (g.startAngle + g.endAngle) / 2);
        for (const p of engine.getPortals().filter((q) => q.exhausted)) {
          for (const angle of [p.angleA, p.angleB]) {
            const near = centres.some((c) => Math.abs(((c - angle + 3 * Math.PI) % TWO_PI) - Math.PI) < 1e-9);
            expect(near, `seed ${seed}: exit at portal ${angle.toFixed(2)}`).toBe(true);
          }
        }
      }
    }
    expect(burnOuts).toBeGreaterThan(0);
  }, 60_000);

  it("the canvas' wall walk leaves a gap across 0 open and draws sorted gaps as before", () => {
    const wrap: Gap[] = [
      { startAngle: 1, endAngle: 1.24 },
      { startAngle: TWO_PI - 0.1, endAngle: TWO_PI + 0.14 },
    ];
    expect(wallArcs(wrap)).toEqual([
      [TWO_PI + 0.14 - TWO_PI, 1],
      [1.24, TWO_PI - 0.1],
    ]);
    expect(wallArcs([{ startAngle: 1, endAngle: 1.3 }])).toEqual([
      [0, 1],
      [1.3, TWO_PI],
    ]);
  });
});

describe("a resize or a gap change keeps the run", () => {
  it("Classic: broken rings stay broken and the radii are those of a fresh build for the new size", () => {
    const engine = pageEngine({ gapSize: 0.3 }, "classic", 4);
    for (let f = 0; f < 60 * 120 && engine.getBrokenWalls().size < 3; f++) engine.update(STEP, 0);
    const broken = [...engine.getBrokenWalls()].sort();
    expect(broken.length).toBe(3);
    const radii = engine.getCircularWalls().map((w) => w.radius);
    const ball = engine.getBalls()[0];
    const d = distance(engine, ball.x, ball.y);
    engine.setConfig({ width: 801 });
    expect([...engine.getBrokenWalls()].sort()).toEqual(broken);
    expect(engine.getCircularWalls().map((w) => w.radius)).toEqual(radii);
    expect(distance(engine, ball.x, ball.y)).toBeCloseTo(d, 9);
    // An aspect change scales the rings and the ball alike, and a new gap size resizes the gaps in place.
    engine.setConfig({ width: 700, height: 500 });
    expect([...engine.getBrokenWalls()].sort()).toEqual(broken);
    expect(engine.getCircularWalls().map((w) => w.radius)).toEqual(pageEngine({ gapSize: 0.3, width: 700, height: 500 }, "classic", 4).getCircularWalls().map((w) => w.radius));
    expect(distance(engine, ball.x, ball.y)).toBeCloseTo((d * 500) / 600, 9);
    engine.setConfig({ gapSize: 0.5 });
    expect([...engine.getBrokenWalls()].sort()).toEqual(broken);
    for (const wall of engine.getCircularWalls()) expect(wall.gaps[0].endAngle - wall.gaps[0].startAngle).toBeCloseTo(0.5, 12);
    // A new wall count still builds the rings anew.
    engine.setConfig({ wallCount: 5 });
    expect(engine.getCircularWalls()).toHaveLength(5);
    expect(engine.getBrokenWalls().size).toBe(0);
  });

  it("Shatter: the broken segments survive a resize", () => {
    const engine = pageEngine({}, "shatter", 1);
    for (let f = 0; f < 60 * 8; f++) engine.update(STEP, 0);
    const brokenSegments = () => engine.getShatterSegments().flat().filter((s) => s.hp <= 0).length;
    const before = brokenSegments();
    expect(before).toBeGreaterThan(0);
    engine.setConfig({ width: 900, height: 700 });
    expect(brokenSegments()).toBe(before);
  });

  it("Grow: the sealed ring keeps its size on a gap change and takes a fresh start's size on a resize", () => {
    const engine = pageEngine({}, "grow", 1);
    expect(engine.getCircularWalls()[0].radius).toBe(225);
    engine.setConfig({ gapSize: 0.35 });
    expect(engine.getCircularWalls()[0].radius).toBe(225);
    engine.setConfig({ width: 1000, height: 1000 });
    expect(engine.getCircularWalls()[0].radius).toBe(arenaRadius(engine.config));
    expect(engine.getCircularWalls()[0].radius).toBe(pageEngine({ width: 1000, height: 1000 }, "grow", 1).getCircularWalls()[0].radius);
  });
});

describe("the duration search yields within its frame budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("simulates seeds only until the frame's budget is spent, then yields (and Cancel lands at the next frame)", async () => {
    let frames = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames++;
      return setTimeout(() => cb(0), 0) as unknown as number;
    });
    // Every clock read moves 16 ms on: the budget (30 ms) is spent after two seeds.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 16));
    const progress: FinderProgress[] = [];
    const request: FinderRequest = { targetDurationSec: 1000, toleranceSec: 0.5, maxSeeds: 7, maxSimTimeSec: 1, physicsConfig: config, mode: "classic", modeSettings: settings };
    const result = await findSimulation(request, (p) => progress.push(p));
    expect(FINDER_FRAME_BUDGET_MS).toBe(30);
    expect(result.found).toBe(false);
    expect(result.seedsTested).toBe(7);
    expect(progress.map((p) => p.seedsTested)).toEqual([2, 4, 6, 7]);
    expect(frames).toBe(4);
    // Cancelled after the first slice: the search stops at the next frame.
    const controller = new AbortController();
    const cancelled = await findSimulation({ ...request, maxSeeds: 100 }, () => controller.abort(), controller.signal);
    expect(cancelled.seedsTested).toBe(2);
  });
});

describe("Lines keeps its newest bounce points", () => {
  it("stays at the cap in a long multi-ball run instead of stroking thousands of strings every frame", () => {
    const engine = pageEngine({ ballCount: 6, ballSpeed: 800 }, "lines", 1);
    let peak = 0;
    for (let f = 0; f < 60 * 120; f++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      peak = Math.max(peak, engine.getBouncePoints().length);
    }
    // (1,600 without the cap)
    expect(peak).toBe(LINES_MAX_BOUNCE_POINTS);
    // The newest point is the last bounce: still on the ring.
    const last = engine.getBouncePoints()[engine.getBouncePoints().length - 1];
    expect(distance(engine, last.x, last.y)).toBeCloseTo(engine.getCircularWalls()[0].radius, 6);
  }, 60_000);
});
