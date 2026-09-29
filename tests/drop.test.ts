import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_DROP_SETTINGS,
  DROP_PITCH_MAX_HZ,
  DROP_PITCH_MIN_HZ,
  DROP_RANGES,
  MAX_HIT_SOUNDS_PER_STEP,
  MIN_DROP_RADIUS,
  REST_DISTANCE,
  REST_TIME_MS,
  SIZE_SPREAD,
  WALL_EXTENSION,
  buildDropLayout,
  dropHitFrequency,
  dropSettingFields,
  dropSettingsOf,
  resolveDropSettings,
} from "@/lib/physics/modes/drop";
import { segmentEndpoints, type SegmentObstacle } from "@/lib/physics/obstacles";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Ball Drop (lib/physics/modes/drop.ts): the board layout, the release schedule, the per-ball sizes and
 * weights, the size-to-pitch mapping of the hit sounds, the rest detection that finishes the run, the rain
 * loop, the settings (URL, presets, ranges) and determinism.
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

function dropEngine(drop: ModeSettings["drop"], seed = 42, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "drop", { ...modeSettings, drop }, seed);
}

function run(engine: PhysicsEngine, frames: number) {
  for (let i = 0; i < frames; i++) engine.update(STEP, 0);
}

const snapshot = (engine: PhysicsEngine) => engine.getBalls().map((b) => [b.id, Math.round(1000 * b.x), Math.round(1000 * b.y), Math.round(1000 * b.radius)]);

describe("Ball Drop settings", () => {
  it("resolve to the defaults, clamp to the slider ranges and round the counts", () => {
    expect(resolveDropSettings(undefined)).toEqual(DEFAULT_DROP_SETTINGS);
    expect(resolveDropSettings({})).toEqual(DEFAULT_DROP_SETTINGS);
    expect(resolveDropSettings({ ballCount: 999, sizeVariation: 3, gravityVariation: -1, rows: 2.6, spawnInterval: 9, loop: true })).toEqual({
      ballCount: DROP_RANGES.dropBallCount.max,
      sizeVariation: 1,
      gravityVariation: 0,
      rows: 3,
      spawnInterval: DROP_RANGES.dropSpawnInterval.max,
      loop: true,
    });
    expect(resolveDropSettings({ ballCount: Number.NaN, rows: "many" as unknown as number, loop: "yes" as unknown as boolean })).toEqual(DEFAULT_DROP_SETTINGS);
    expect(resolveDropSettings({ ballCount: 0 }).ballCount).toBe(1);
  });

  it("map between the mode settings and the SimulatorSettings fields, which default to the mode defaults in every mode", () => {
    const fields = dropSettingFields(DEFAULT_DROP_SETTINGS);
    expect(fields).toEqual({ dropBallCount: 12, dropSizeVariation: 0.5, dropGravityVariation: 0.5, dropRows: 7, dropSpawnInterval: 0.4, dropLoop: false });
    expect(dropSettingsOf(fields)).toEqual(DEFAULT_DROP_SETTINGS);
    for (const mode of MODE_IDS) expect(dropSettingsOf(defaultSettings(mode))).toEqual(DEFAULT_DROP_SETTINGS);
    expect(RANGES.dropBallCount).toEqual(DROP_RANGES.dropBallCount);
    expect(RANGES.dropRows).toEqual({ min: 3, max: 12, step: 1 });
  });

  it("round-trip through the URL keys dbc / dsv / dgv / drows / dsi / dloop and stay out of default links", () => {
    const s = { ...defaultSettings("drop"), dropBallCount: 30, dropSizeVariation: 0.75, dropGravityVariation: 1, dropRows: 10, dropSpawnInterval: 0.3, dropLoop: true };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("drop");
    expect(params.get("dbc")).toBe("30");
    expect(params.get("dsv")).toBe("0.75");
    expect(params.get("dgv")).toBe("1");
    expect(params.get("drows")).toBe("10");
    expect(params.get("dsi")).toBe("0.3");
    expect(params.get("dloop")).toBe("1");
    expect(settingsFromSearchParams(params)).toEqual(s);
    expect(settingsToSearchParams(defaultSettings("drop")).toString()).toBe("mode=drop");
  });

  it("clamp bad URL values and presets to the ranges, falling back to the defaults", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=drop&dbc=999&dsv=abc&dgv=-2&drows=2.4&dsi=7&dloop=1"));
    expect(s).toMatchObject({ dropBallCount: 40, dropSizeVariation: 0.5, dropGravityVariation: 0, dropRows: 3, dropSpawnInterval: 2, dropLoop: true });
    const p = presetToSettings({ mode: "drop", dropBallCount: -5, dropRows: 50, dropLoop: "yes" } as unknown as Partial<SimulatorSettings>);
    expect(p).toMatchObject({ dropBallCount: 1, dropRows: 12, dropLoop: false });
    expect(presetToSettings({ mode: "classic" })).toMatchObject(dropSettingFields(DEFAULT_DROP_SETTINGS));
  });
});

describe("Ball Drop pitch and layout", () => {
  it("maps bigger balls to lower notes, clamped to A2–A6", () => {
    expect(dropHitFrequency(8)).toBeCloseTo(660, 10);
    expect(dropHitFrequency(4)).toBeCloseTo(1320, 10);
    expect(dropHitFrequency(16)).toBeCloseTo(330, 10);
    expect(dropHitFrequency(1)).toBe(DROP_PITCH_MAX_HZ);
    expect(dropHitFrequency(200)).toBe(DROP_PITCH_MIN_HZ);
    expect(dropHitFrequency(0)).toBe(DROP_PITCH_MAX_HZ);
    let previous = Infinity;
    for (let r = 3; r <= 60; r++) {
      const f = dropHitFrequency(r);
      expect(f).toBeLessThanOrEqual(previous);
      previous = f;
    }
  });

  it("builds walls plus staggered rows of pegs and bars that use the full height and fit the recorder's square", () => {
    for (const [width, height, rows] of [
      [800, 600, 7],
      [800, 450, 12],
      [360, 360, 3],
      [1600, 500, 5],
    ]) {
      const layout = buildDropLayout(width, height, rows, 8, false);
      const { field, obstacles } = layout;
      const margin = Math.max(6, 0.02 * Math.min(width, height));
      expect(field.top).toBe(margin);
      expect(field.bottom).toBe(height - margin);
      expect(field.right - field.left).toBeLessThanOrEqual(Math.min(width, height));
      expect(Math.abs((field.left + field.right) / 2 - width / 2)).toBeLessThan(1e-9);
      // Walls first: left, right, floor. The side walls continue one canvas height above the top, so an
      // overflowing pile stays between them; the floor closes the board at the bottom.
      expect(obstacles.slice(0, 3).map((o) => o.kind)).toEqual(["segment", "segment", "segment"]);
      const [leftWall, rightWall, floor] = obstacles as SegmentObstacle[];
      for (const [wall, x] of [
        [leftWall, field.left],
        [rightWall, field.right],
      ] as const) {
        const ends = segmentEndpoints(wall);
        expect(Math.min(ends.x1, ends.x2)).toBeCloseTo(x, 9);
        expect(Math.max(ends.x1, ends.x2)).toBeCloseTo(x, 9);
        expect(Math.min(ends.y1, ends.y2)).toBeCloseTo(field.top - WALL_EXTENSION * height, 9);
        expect(Math.max(ends.y1, ends.y2)).toBeCloseTo(field.bottom, 9);
      }
      const floorEnds = segmentEndpoints(floor);
      expect(floorEnds.y1).toBeCloseTo(field.bottom, 9);
      expect(floorEnds.y2).toBeCloseTo(field.bottom, 9);
      const cols = Math.round((field.right - field.left) / layout.columnSpacing);
      let pegs = 0;
      let bars = 0;
      for (let i = 0; i < rows; i++) {
        const count = i % 2 === 1 ? cols - 1 : cols;
        if (i % 3 === 2) bars += count;
        else pegs += count;
      }
      expect(obstacles.filter((o) => o.kind === "circle")).toHaveLength(pegs);
      expect(obstacles.filter((o) => o.kind === "segment")).toHaveLength(3 + bars);
      expect(obstacles).toHaveLength(3 + pegs + bars);
      for (const o of obstacles.slice(3)) {
        expect(o.x).toBeGreaterThan(field.left);
        expect(o.x).toBeLessThan(field.right);
        expect(o.y).toBeGreaterThan(field.top);
        expect(o.y).toBeLessThan(field.bottom);
        if (o.kind === "circle") expect(o.radius).toBe(layout.pegRadius);
        else expect(o.halfLength).toBe(layout.barHalfLength);
      }
      // The biggest ball of the size spread fits between two pegs and past the ends of a bar.
      const biggest = 8 * (1 + SIZE_SPREAD);
      expect(layout.columnSpacing - 2 * layout.pegRadius).toBeGreaterThan(2 * biggest);
      expect(layout.columnSpacing - 2 * layout.barHalfLength).toBeGreaterThanOrEqual(2 * biggest);
    }
    expect(buildDropLayout(800, 600, 12, 8, false).obstacles.length).toBeGreaterThan(buildDropLayout(800, 600, 6, 8, false).obstacles.length);
    // Rain opens the floor.
    const rain = buildDropLayout(800, 600, 7, 8, true);
    expect(rain.obstacles.slice(0, 2).map((o) => o.kind)).toEqual(["segment", "segment"]);
    expect(rain.obstacles).toHaveLength(buildDropLayout(800, 600, 7, 8, false).obstacles.length - 1);
    // Bigger balls get wider columns.
    expect(buildDropLayout(800, 600, 7, 30, false).columnSpacing).toBeGreaterThan(buildDropLayout(800, 600, 7, 8, false).columnSpacing);
  });
});

describe("Ball Drop mode", () => {
  it("boots without rings, with the board as obstacles, and releases the balls on schedule", () => {
    const engine = dropEngine({ ballCount: 10, spawnInterval: 0.5 });
    expect(engine.getCurrentModeName()).toBe("drop");
    expect(engine.isDropMode()).toBe(true);
    expect(engine.getCircularWalls()).toHaveLength(0);
    expect(engine.getObstacles()).toHaveLength(buildDropLayout(800, 600, 7, 8, false).obstacles.length);
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.getDropProgress()).toEqual({ released: 1, total: 10, finished: false });
    run(engine, 29); // 0.483 s
    expect(engine.getBalls()).toHaveLength(1);
    run(engine, 1); // 0.5 s
    expect(engine.getBalls()).toHaveLength(2);
    run(engine, 4 * 60 + 5);
    expect(engine.getBalls()).toHaveLength(10);
    expect(engine.getDropProgress().released).toBe(10);
    // Every ball starts at the top, inside the board, and its "hit" sounds are pitched by its size.
    const field = engine.getDropLayout()!.field;
    for (const ball of engine.getBalls()) {
      expect(ball.x).toBeGreaterThan(field.left);
      expect(ball.x).toBeLessThan(field.right);
    }
  });

  it("gives every ball its own size and weight, deterministically, and none when the spreads are zero", () => {
    const spread = dropEngine({ ballCount: 20, spawnInterval: 0, sizeVariation: 1, gravityVariation: 1 });
    run(spread, 60);
    const balls = spread.getBalls();
    expect(balls.length).toBe(20);
    const radii = new Set(balls.map((b) => Math.round(1000 * b.radius)));
    expect(radii.size).toBeGreaterThan(10);
    for (const b of balls) {
      expect(b.radius).toBeGreaterThanOrEqual(MIN_DROP_RADIUS);
      expect(b.radius).toBeLessThanOrEqual(8 * (1 + SIZE_SPREAD) + 1e-9);
      expect(b.radiusScale).toBeCloseTo(b.radius / 8, 10);
      expect(b.gravityScale).toBeGreaterThanOrEqual(0.5);
      expect(b.gravityScale).toBeLessThanOrEqual(2);
    }
    const uniform = dropEngine({ ballCount: 5, spawnInterval: 0, sizeVariation: 0, gravityVariation: 0 });
    for (const b of uniform.getBalls()) {
      expect(b.radius).toBe(8);
      expect(b.gravityScale).toBe(1);
    }
  });

  it("applies a ball's own gravity multiplier in the engine", () => {
    const engine = dropEngine({ ballCount: 2, spawnInterval: 0, sizeVariation: 0, gravityVariation: 0 });
    const [light, heavy] = engine.getBalls();
    heavy.gravityScale = 2;
    run(engine, 3); // still in free fall above the first row
    expect(light.vy).toBeGreaterThan(0);
    expect(heavy.vy).toBeCloseTo(2 * light.vy, 6);
  });

  it("queues pitched hit sounds for obstacle contacts, at most MAX_HIT_SOUNDS_PER_STEP per step, and never a gap pass", () => {
    const engine = dropEngine({ ballCount: 40, spawnInterval: 0, sizeVariation: 1 });
    let hits = 0;
    const radiiByPitch = new Set<number>();
    for (let i = 0; i < 600; i++) {
      engine.update(STEP, 0);
      const events = engine.consumeSoundEvents();
      expect(events.length).toBeLessThanOrEqual(MAX_HIT_SOUNDS_PER_STEP);
      for (const e of events) {
        expect(e.type).toBe("hit");
        expect(e.frequency).toBeGreaterThanOrEqual(DROP_PITCH_MIN_HZ);
        expect(e.frequency).toBeLessThanOrEqual(DROP_PITCH_MAX_HZ);
        radiiByPitch.add(Math.round(e.frequency!));
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(50);
    expect(radiiByPitch.size).toBeGreaterThan(5); // different sizes, different notes
    expect(engine.getObstacleHits().length).toBeGreaterThan(0); // and the canvas gets its glow
    const pitches = new Set(engine.getBalls().map((b) => Math.round(dropHitFrequency(b.radius))));
    for (const f of radiiByPitch) expect(pitches.has(f)).toBe(true);
  });

  it("finishes once every ball has come to rest on the floor, and the finder can time it", () => {
    const engine = dropEngine({});
    let finishedAt = -1;
    for (let i = 1; i <= 60 * 60 && finishedAt < 0; i++) {
      engine.update(STEP, 0);
      if (engine.isSimulationFinished()) finishedAt = i / 60;
    }
    expect(finishedAt).toBeGreaterThan(5);
    expect(finishedAt).toBeLessThan(60);
    const field = engine.getDropLayout()!.field;
    expect(engine.getBalls()).toHaveLength(12);
    for (const b of engine.getBalls()) {
      expect(Math.hypot(b.vx, b.vy)).toBeLessThan(10);
      expect(b.y + b.radius).toBeLessThanOrEqual(field.bottom + 0.5);
      expect(b.y).toBeGreaterThan(field.top);
    }
    run(engine, 60);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.getDropProgress().finished).toBe(true);
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: config, mode: "drop", modeSettings };
    const ms = simulateSeed(42, request, 60_000);
    expect(ms).toBeCloseTo(finishedAt * 1000, 0);
    expect(simulateSeed(42, request, 60_000)).toBe(ms);
  });

  it("settles under heavy gravity, fast balls and big balls too", () => {
    const heavy = dropEngine({ ballCount: 30, spawnInterval: 0.05, sizeVariation: 1, gravityVariation: 1, rows: 12 }, 7, { gravity: 2000, ballSpeed: 800, ballRadius: 4 });
    run(heavy, 60 * 40);
    expect(heavy.isSimulationFinished()).toBe(true);
    const big = dropEngine({ ballCount: 16, spawnInterval: 0.2, sizeVariation: 1, rows: 12 }, 7, { ballRadius: 30 });
    run(big, 60 * 40);
    expect(big.isSimulationFinished()).toBe(true);
    const field = big.getDropLayout()!.field;
    for (const b of big.getBalls()) {
      expect(b.x - b.radius).toBeGreaterThanOrEqual(field.left - 0.5);
      expect(b.x + b.radius).toBeLessThanOrEqual(field.right + 0.5);
      expect(b.y + b.radius).toBeLessThanOrEqual(field.bottom + 0.5);
    }
  });

  it("finishes an overfull board – 40 balls of size 30 at full size spread – with the balls it could hold, confined between the walls", () => {
    // Such a board cannot hold every ball: the pile grows above the top of the board and the release spots
    // fill up. The run must still finish (SETTLED!, auto-stop of a recording, a finite finder time): a ball at
    // rest above the top counts as resting, and a release that finds no room for REST_TIME_MS while the
    // pile is at rest ends the run with the balls that fit, which getProgress().total then reports.
    const drop = { ballCount: 40, sizeVariation: 1, rows: 7 } as const;
    const cfg = { ballRadius: 30 } as const;
    let someBoardWasFull = false;
    let somePileReachedAboveTheTop = false;
    for (const seed of [1, 2, 3]) {
      const engine = dropEngine(drop, seed, cfg);
      let finishedAt = -1;
      for (let i = 1; i <= 60 * 60 && finishedAt < 0; i++) {
        engine.update(STEP, 0);
        if (engine.isSimulationFinished()) finishedAt = i / 60;
      }
      expect(finishedAt).toBeGreaterThan(0);
      expect(finishedAt).toBeLessThan(60);
      const progress = engine.getDropProgress();
      const balls = engine.getBalls();
      expect(progress.finished).toBe(true);
      expect(progress.released).toBe(balls.length);
      expect(progress.total).toBe(balls.length);
      expect(progress.total).toBeLessThanOrEqual(40);
      expect(progress.total).toBeGreaterThan(10);
      if (progress.total < 40) someBoardWasFull = true;
      const field = engine.getDropLayout()!.field;
      const positions = balls.map((b) => [b.x, b.y] as const);
      for (const b of balls) {
        // The extended side walls keep even the part of the pile above the top between the walls (a ball wedged
        // against a wall by the pile may overlap it by a couple of px: the pair pass runs after the obstacle pass).
        expect(b.x - b.radius).toBeGreaterThanOrEqual(field.left - REST_DISTANCE);
        expect(b.x + b.radius).toBeLessThanOrEqual(field.right + REST_DISTANCE);
        expect(b.y + b.radius).toBeLessThanOrEqual(field.bottom + 0.5);
        if (b.y < field.top) somePileReachedAboveTheTop = true;
      }
      // Finished means finished: the pile stays put (a wedged ball may still jitter within REST_DISTANCE), the
      // silence holds and the progress does not change any more.
      engine.consumeSoundEvents();
      run(engine, 60);
      expect(engine.isSimulationFinished()).toBe(true);
      expect(engine.getDropProgress()).toEqual(progress);
      expect(engine.getBalls()).toHaveLength(balls.length);
      expect(engine.consumeSoundEvents()).toHaveLength(0);
      engine.getBalls().forEach((b, i) => expect(Math.hypot(b.x - positions[i][0], b.y - positions[i][1])).toBeLessThanOrEqual(REST_DISTANCE));
    }
    expect(someBoardWasFull).toBe(true);
    expect(somePileReachedAboveTheTop).toBe(true);
    // The finder gets a real duration instead of burning its whole budget, and the same one on every replay.
    const request: FinderRequest = { targetDurationSec: 20, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: { ...config, ...cfg }, mode: "drop", modeSettings: { ...modeSettings, drop } };
    const ms = simulateSeed(2, request, 60_000);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(60_000);
    expect(simulateSeed(2, request, 60_000)).toBe(ms);
  });

  it("does not call a board full while balls are still due or moving", () => {
    // A slow release schedule: the top is free between releases, so `blockedMs` never grows, and the run only
    // finishes once the last ball has been released and the pile has been still for REST_TIME_MS.
    const engine = dropEngine({ ballCount: 6, spawnInterval: 2, sizeVariation: 0, gravityVariation: 0 });
    for (let i = 1; i <= 60 * 9; i++) {
      engine.update(STEP, 0);
      expect(engine.isSimulationFinished()).toBe(false);
      expect(engine.getDropProgress().total).toBe(6);
    }
    expect(engine.getDropProgress().released).toBe(5);
    run(engine, 60 * 15);
    expect(engine.getDropProgress()).toEqual({ released: 6, total: 6, finished: true });
    // A burst of big balls released at once: the first ones block the top for a moment, the rest follow as
    // soon as they have fallen clear – far sooner than REST_TIME_MS – so the count is never cut short.
    const burst = dropEngine({ ballCount: 20, spawnInterval: 0, sizeVariation: 0, gravityVariation: 0 }, 3, { ballRadius: 20 });
    expect(burst.getDropProgress().released).toBeLessThan(20);
    run(burst, Math.round(REST_TIME_MS / STEP));
    expect(burst.getDropProgress().released).toBe(20);
    expect(burst.getDropProgress().total).toBe(20);
  });

  it("rain: the floor is open, balls that fall out come back in at the top and the run never ends", () => {
    const engine = dropEngine({ ballCount: 15, spawnInterval: 0.1, loop: true });
    expect(engine.getObstacles()).toHaveLength(buildDropLayout(800, 600, 7, 8, true).obstacles.length);
    let fellOut = false;
    let cameBack = false;
    const field = engine.getDropLayout()!.field;
    for (let i = 0; i < 60 * 40; i++) {
      engine.update(STEP, 0);
      expect(engine.isSimulationFinished()).toBe(false);
      const balls = engine.getBalls();
      expect(balls.length).toBeLessThanOrEqual(15);
      for (const b of balls) {
        if (b.y > config.height) fellOut = true;
        else if (fellOut && b.y < field.top) cameBack = true;
        expect(b.x).toBeGreaterThanOrEqual(field.left);
        expect(b.x).toBeLessThanOrEqual(field.right);
        expect(b.y).toBeLessThan(config.height + 200);
      }
    }
    expect(fellOut).toBe(true);
    expect(cameBack).toBe(true);
    expect(engine.getBalls()).toHaveLength(15);
  });

  it("puts a ball that somehow left a closed board back inside so the run can still finish", () => {
    const engine = dropEngine({ ballCount: 3, spawnInterval: 0 });
    run(engine, 30);
    const field = engine.getDropLayout()!.field;
    const [below, left, right] = engine.getBalls();
    below.y = config.height + 500;
    below.vy = 300;
    left.x = field.left - 40;
    left.vx = -100;
    right.x = field.right + 40;
    right.vx = 100;
    run(engine, 1);
    expect(below.y + below.radius).toBeLessThanOrEqual(field.bottom + 1e-6);
    expect(below.vy).toBeLessThanOrEqual(0);
    expect(left.x - left.radius).toBeGreaterThanOrEqual(field.left - 1e-6);
    expect(left.vx).toBeGreaterThanOrEqual(0);
    expect(right.x + right.radius).toBeLessThanOrEqual(field.right + 1e-6);
    expect(right.vx).toBeLessThanOrEqual(0);
    run(engine, 60 * 30);
    expect(engine.isSimulationFinished()).toBe(true);
  });

  it("damps ball-to-ball collisions so a pile settles instead of rocking forever", () => {
    const engine = dropEngine({ ballCount: 2, spawnInterval: 0, sizeVariation: 0, gravityVariation: 0 });
    const [a, b] = engine.getBalls();
    // Two balls on a head-on course, far from the board.
    Object.assign(a, { x: 380, y: 300, vx: 200, vy: 0 });
    Object.assign(b, { x: 420, y: 300, vx: -200, vy: 0 });
    run(engine, 6);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    // The pair keeps its (zero) common velocity but only 60% of its relative speed.
    expect(a.vx + b.vx).toBeCloseTo(0, 6);
    expect(b.vx - a.vx).toBeCloseTo(0.6 * 400, 6);
  });

  it("keeps the size spread when the ball size changes live and rebuilds the board for a new size or canvas", () => {
    const engine = dropEngine({ ballCount: 6, spawnInterval: 0, sizeVariation: 1 });
    const before = engine.getBalls().map((b) => b.radius);
    engine.setConfig({ ballRadius: 16 });
    engine.getBalls().forEach((b, i) => expect(b.radius).toBeCloseTo(2 * before[i], 10));
    run(engine, 1);
    expect(engine.getDropLayout()!.ballRadius).toBe(16);
    expect(engine.getObstacles()).toBe(engine.getDropLayout()!.obstacles);
    engine.setConfig({ width: 1000, height: 700 });
    const field = engine.getDropLayout()!.field;
    expect(field.bottom).toBe(700 - Math.max(6, 0.02 * 700));
    expect(engine.getCircularWalls()).toHaveLength(0); // the engine did not rebuild classic rings
    expect(engine.getObstacles()).toHaveLength(buildDropLayout(1000, 700, 7, 16, false).obstacles.length);
  });

  it("leaves the ring modes without obstacles and lets them keep their slow-ball boost", () => {
    const classic = createEngineForSettings(config, "classic", modeSettings, 5);
    expect(classic.getObstacles()).toHaveLength(0);
    expect(classic.getObstacleHits()).toHaveLength(0);
    expect(classic.getCurrentMode()?.ballsMayRest).toBeUndefined();
    expect(classic.dropMode.ballsMayRest).toBe(true);
  });

  it("is deterministic for a seed and different for another, rain included", () => {
    for (const drop of [{}, { ballCount: 30, spawnInterval: 0.1, loop: true }] as const) {
      const a = dropEngine(drop, 2024);
      const b = dropEngine(drop, 2024);
      const eventsA: number[] = [];
      const eventsB: number[] = [];
      for (let i = 0; i < 1200; i++) {
        a.update(STEP, 0);
        b.update(STEP, 0);
        for (const e of a.consumeSoundEvents()) eventsA.push(e.frequency ?? -1);
        for (const e of b.consumeSoundEvents()) eventsB.push(e.frequency ?? -1);
      }
      expect(snapshot(a)).toEqual(snapshot(b));
      expect(eventsA).toEqual(eventsB);
    }
    const other = dropEngine({}, 2025);
    const same = dropEngine({}, 2024);
    run(other, 300);
    run(same, 300);
    expect(snapshot(other)).not.toEqual(snapshot(same));
  });
});
