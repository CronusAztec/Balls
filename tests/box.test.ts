import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  AXIS_PERIOD_RATIOS,
  BOX_RANGES,
  BOX_SHAPES,
  BOX_SPEED_RATIOS,
  BOX_WALL_BOTTOM,
  BOX_WALL_LEFT,
  BOX_WALL_NOTES,
  BOX_WALL_RIGHT,
  BOX_WALL_TOP,
  DEFAULT_BOX_SETTINGS,
  DVD_AXIS_PERIOD_RATIOS,
  MAX_SHAPE_FRACTION,
  MIN_AIM_ANGLE,
  TEMPO_SPREAD,
  boxSettingFields,
  boxSettingsOf,
  boxSizeUnit,
  buildBoxField,
  cornerAimAngle,
  hitsPerCornerCycle,
  launchAngle,
  parseSpeedRatio,
  reflectAxis,
  resolveBoxSettings,
  shapeHalfHeight,
  shapeHalfWidth,
  speedFactors,
  type AxisReflection,
  type BoxSettings,
} from "@/lib/physics/modes/box";
import { MODE_CARD_ORDER, MODE_CATEGORIES, MODE_CATEGORY_IDS, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Bouncing Shapes (lib/physics/modes/box.ts): the mirror reflection, the speed ratios and launch angles,
 * the box layout, the per-wall notes and corner accents, the countdown that finishes the run, the settings
 * (URL, presets, ranges), the mode categories and determinism.
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

function boxEngine(box: Partial<BoxSettings>, seed = 7, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "box", { ...modeSettings, box }, seed);
}

/** Runs `frames` 60 Hz steps and collects every sound event. */
function run(engine: PhysicsEngine, frames: number): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(1000 / 60, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

const scratch: AxisReflection = { pos: 0, vel: 0, hit: 0 };

describe("reflection maths", () => {
  it("leaves a shape inside the walls alone", () => {
    const r = reflectAxis(50, 120, 10, 0, 100, scratch);
    expect(r).toEqual({ pos: 50, vel: 120, hit: 0 });
  });

  it("folds the overshoot back and points the velocity away from the wall it crossed", () => {
    const right = reflectAxis(96, 120, 10, 0, 100, scratch); // the far edge would be at 106: 6 px past the wall
    expect(right).toEqual({ pos: 84, vel: -120, hit: 1 });
    const left = reflectAxis(7, -30, 10, 0, 100, scratch);
    expect(left).toEqual({ pos: 13, vel: 30, hit: -1 });
  });

  it("keeps the bounce period exact whatever the step size (the phase survives every reflection)", () => {
    // A 10 px half-size shape in a 100 px box: its centre bounces between 10 and 90, i.e. an unfolded straight
    // line folded into that range with period 160 px. At 120 px/s a wall is hit every 2/3 s.
    const fold = (u: number) => {
      let p = (u - 10) % 160;
      if (p < 0) p += 160;
      return 10 + (p <= 80 ? p : 160 - p);
    };
    const simulate = (steps: number, dt: number) => {
      let pos = 50;
      let vel = 120;
      const hits: number[] = [];
      for (let i = 1; i <= steps; i++) {
        pos += vel * dt;
        const r = reflectAxis(pos, vel, 10, 0, 100, scratch);
        pos = r.pos;
        vel = r.vel;
        if (r.hit !== 0) hits.push(i * dt);
      }
      return { pos, hits };
    };
    const fine = simulate(11760, 1 / 2400); // 4.9 s
    const coarse = simulate(1176, 1 / 240); // 4.9 s
    const analytic = fold(50 + 120 * 4.9);
    expect(fine.pos).toBeCloseTo(analytic, 6);
    expect(coarse.pos).toBeCloseTo(analytic, 6);
    // Hits are noticed once per half period; the coarse steps only quantise *when*, never the motion itself.
    expect(coarse.hits).toHaveLength(7);
    const gaps = coarse.hits.slice(1).map((t, i) => t - coarse.hits[i]);
    for (const gap of gaps) expect(Math.abs(gap - 2 / 3)).toBeLessThan(1 / 240 + 1e-9);
  });

  it("centres a shape that is wider than the box instead of bouncing it", () => {
    expect(reflectAxis(30, 100, 60, 0, 100, scratch)).toEqual({ pos: 50, vel: 100, hit: 0 });
  });
});

describe("speed ratios and launch angles", () => {
  it("parses the ratio ids and normalises the fastest shape to the ball speed, cycling over the shapes", () => {
    expect(parseSpeedRatio("3:4:5")).toEqual([3, 4, 5]);
    expect(speedFactors("2:3", 4)).toEqual([2 / 3, 1, 2 / 3, 1]);
    expect(speedFactors("4:5:6", 2)).toEqual([4 / 6, 5 / 6]);
    expect(speedFactors("1:1", 3)).toEqual([1, 1, 1]);
    for (const ratio of BOX_SPEED_RATIOS) expect(Math.max(...speedFactors(ratio, 12))).toBe(1);
  });

  it("gives an angle whose vertical / horizontal bounce periods are in the requested ratio", () => {
    for (const [p, q] of [...AXIS_PERIOD_RATIOS, ...DVD_AXIS_PERIOD_RATIOS]) {
      const innerW = 300;
      const innerH = 560;
      const a = launchAngle(innerW, innerH, p / q);
      const px = innerW / Math.cos(a);
      const py = innerH / Math.sin(a);
      expect(py / px).toBeCloseTo(p / q, 9);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(Math.PI / 2);
    }
  });

  it("keeps the DVD ratios odd/odd in lowest terms (the only ratios with a corner on the schedule) and the square ones mostly even", () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    for (const [p, q] of DVD_AXIS_PERIOD_RATIOS) {
      expect(p % 2).toBe(1);
      expect(q % 2).toBe(1);
      expect(gcd(p, q)).toBe(1);
      expect(hitsPerCornerCycle([p, q])).toBe(p + q - 1);
    }
    expect(AXIS_PERIOD_RATIOS.filter(([p, q]) => p % 2 === 1 && q % 2 === 1)).toHaveLength(1);
  });

  it("aims a shape at a corner: from the centre the corner aim is the launch angle, and the unfolded paths cover both axes in the same time", () => {
    const innerW = 300;
    const innerH = 560;
    for (const [p, q] of DVD_AXIS_PERIOD_RATIOS) {
      expect(cornerAimAngle(innerW / 2, innerH / 2, innerW, innerH, (p + 1) / 2, (q + 1) / 2)).toBeCloseTo(launchAngle(innerW, innerH, p / q), 12);
    }
    // 40 px from the wall ahead across, 100 px from the one ahead down, the corner two side hits and one floor hit
    // away: the unfolded paths are 40 + 300 across and 100 down, so tan a = 100 / 340.
    expect(Math.tan(cornerAimAngle(40, 100, innerW, innerH, 2, 1))).toBeCloseTo(100 / 340, 12);
    expect(MIN_AIM_ANGLE).toBeGreaterThan(0);
    expect(MIN_AIM_ANGLE).toBeLessThan(Math.PI / 4);
  });
});

describe("box layout", () => {
  it("fits the aspect into the centred square the recorder crops to", () => {
    const portrait = buildBoxField(1000, 562, 0.56);
    const side = 562 - 2 * Math.max(6, 0.02 * 562);
    expect(portrait.height).toBeCloseTo(side, 6);
    expect(portrait.width).toBeCloseTo(side * 0.56, 6);
    expect((portrait.left + portrait.right) / 2).toBeCloseTo(500, 6);
    expect((portrait.top + portrait.bottom) / 2).toBeCloseTo(281, 6);
    const landscape = buildBoxField(1000, 562, 2);
    expect(landscape.width).toBeCloseTo(side, 6);
    expect(landscape.height).toBeCloseTo(side / 2, 6);
    const square = buildBoxField(400, 400, 1);
    expect(square.width).toBeCloseTo(square.height, 6);
  });

  it("sizes a default shape at a tenth of the box and a DVD logo wider than tall", () => {
    const field = buildBoxField(1000, 562, 0.56);
    const r = 8 * boxSizeUnit(field);
    expect((2 * r) / field.width).toBeCloseTo(0.1, 6);
    expect(shapeHalfWidth("dvd", r)).toBeGreaterThan(shapeHalfHeight("dvd", r));
    expect(shapeHalfWidth("square", r)).toBe(r);
    expect(shapeHalfHeight("circle", r)).toBe(r);
  });
});

describe("BoxMode in the engine", () => {
  it("is registered as a mode of the rhythm family", () => {
    expect(MODE_IDS).toContain("box");
    expect(MODE_CARD_ORDER).toContain("box");
    expect(MODE_CATEGORIES.box).toBe("rhythm");
    expect(MODE_CATEGORIES.drop).toBe("rhythm");
    expect(MODE_CATEGORIES.classic).toBe("escape");
    expect(MODE_CATEGORY_IDS.flatMap((c) => modesInCategory(c)).sort()).toEqual([...MODE_CARD_ORDER].sort());
    // The escape family starts with the ten ring modes in card order (later escape modes – the multipliers board – are appended).
    expect(modesInCategory("escape").slice(0, 10)).toEqual(["classic", "accumulation", "multiply", "lines", "paint", "target", "grow", "shatter", "colorMatch", "portal"]);
  });

  it("starts the shapes in the centre with speeds in the chosen ratio, no rings and pass-through", () => {
    const engine = boxEngine({ shapeCount: 3, speedRatio: "3:4:5", countdown: 0 });
    expect(engine.isBoxMode()).toBe(true);
    expect(engine.getCircularWalls()).toEqual([]);
    expect(engine.getObstacles()).toEqual([]);
    const balls = engine.getBalls();
    expect(balls).toHaveLength(3);
    const view = engine.getBoxView();
    const field = view.field!;
    for (const b of balls) {
      expect(b.x).toBeCloseTo((field.left + field.right) / 2, 6);
      expect(b.y).toBeCloseTo((field.top + field.bottom) / 2, 6);
    }
    const speeds = balls.map((b) => Math.hypot(b.vx, b.vy));
    expect(view.tempo).toBeGreaterThanOrEqual(1 - TEMPO_SPREAD / 2);
    expect(view.tempo).toBeLessThanOrEqual(1 + TEMPO_SPREAD / 2);
    expect(speeds[0]).toBeCloseTo(400 * view.tempo * 0.6, 6);
    expect(speeds[1]).toBeCloseTo(400 * view.tempo * 0.8, 6);
    expect(speeds[2]).toBeCloseTo(400 * view.tempo, 6);
    // All three share the launch angle (mirrored), so the polyrhythm between them is exact.
    const angles = balls.map((b) => Math.atan2(Math.abs(b.vy), Math.abs(b.vx)));
    expect(angles[1]).toBeCloseTo(angles[0], 9);
    expect(angles[2]).toBeCloseTo(angles[0], 9);
    expect(engine.getCurrentMode()?.ballsPassThrough).toBe(true);
  });

  it("keeps every shape inside the box at constant speed for half a minute, for every shape kind and the extreme sizes", () => {
    for (const shape of BOX_SHAPES) {
      for (const ballRadius of [4, 30]) {
        const engine = boxEngine({ shape, shapeCount: 5, countdown: 0, growPerHit: 3, speedRatio: "4:5:6" }, 3, { ballRadius, ballSpeed: 800 });
        const view = engine.getBoxView();
        const field = view.field!;
        const start = engine.getBalls().map((b) => Math.hypot(b.vx, b.vy));
        for (let f = 0; f < 1800; f++) {
          engine.update(1000 / 60, 0);
          if (f % 3 !== 0) continue;
          engine.getBalls().forEach((b, i) => {
            const hw = shapeHalfWidth(shape, b.radius);
            const hh = shapeHalfHeight(shape, b.radius);
            expect(b.x - hw).toBeGreaterThanOrEqual(field.left - 1e-6);
            expect(b.x + hw).toBeLessThanOrEqual(field.right + 1e-6);
            expect(b.y - hh).toBeGreaterThanOrEqual(field.top - 1e-6);
            expect(b.y + hh).toBeLessThanOrEqual(field.bottom + 1e-6);
            expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(start[i], 6);
            expect(hw).toBeLessThanOrEqual(MAX_SHAPE_FRACTION * field.width + 1e-6);
            expect(hh).toBeLessThanOrEqual(MAX_SHAPE_FRACTION * field.height + 1e-6);
          });
        }
        expect(view.totalHits).toBeGreaterThan(50);
        engine.consumeSoundEvents();
      }
    }
  }, 20_000);

  it("plays one of the four wall notes per hit, the wall picks the note and a melody-free run uses all four", () => {
    const engine = boxEngine({ shapeCount: 2, countdown: 0, speedRatio: "1:1" });
    const events = run(engine, 1200);
    expect(events.length).toBeGreaterThan(10);
    const walls = new Set<number>();
    for (const ev of events) {
      expect(ev.type).toBe("hit");
      expect(ev.frequency).toBe(BOX_WALL_NOTES[ev.wallIndex]);
      walls.add(ev.wallIndex);
    }
    expect([...walls].sort()).toEqual([BOX_WALL_TOP, BOX_WALL_RIGHT, BOX_WALL_BOTTOM, BOX_WALL_LEFT]);
    // Sounds match the counted hits (well under the per-step cap with two shapes).
    expect(events.length).toBe(engine.getBoxView().totalHits);
  });

  it("hits the walls in the speed ratio: a 2:3 pair produces hit counts in 2:3", () => {
    const engine = boxEngine({ shapeCount: 2, countdown: 0, speedRatio: "2:3", growPerHit: 0 });
    run(engine, 60 * 90);
    const [slow, fast] = engine.getBalls().map((b) => engine.getBoxView().shapes.get(b.id)!.hits);
    expect(slow).toBeGreaterThan(40);
    expect(fast / slow).toBeGreaterThan(1.5 - 0.06);
    expect(fast / slow).toBeLessThan(1.5 + 0.06);
  });

  it("counts down one per hit, freezes a finished shape and finishes once every shape reached zero", () => {
    const engine = boxEngine({ shapeCount: 2, countdown: 5, speedRatio: "2:3", growPerHit: 0 });
    const view = engine.getBoxView();
    const states = () => engine.getBalls().map((b) => view.shapes.get(b.id)!);
    expect(states().map((s) => s.count)).toEqual([5, 5]);
    let frames = 0;
    while (!engine.isSimulationFinished() && frames < 60 * 60) {
      engine.update(1000 / 60, 0);
      frames++;
      for (const s of states()) expect(s.count).toBe(Math.max(0, 5 - s.hits));
    }
    expect(engine.isSimulationFinished()).toBe(true);
    expect(view.doneCount).toBe(2);
    for (const b of engine.getBalls()) {
      expect(b.vx).toBe(0);
      expect(b.vy).toBe(0);
      expect(b.frozen).toBe(true);
    }
    // The faster shape finished first; the total of hits is exactly the countdowns.
    expect(view.totalHits).toBe(10);
    // Frozen shapes stay put and silent afterwards.
    const before = engine.getBalls().map((b) => [b.x, b.y]);
    engine.consumeSoundEvents();
    expect(run(engine, 120)).toEqual([]);
    expect(engine.getBalls().map((b) => [b.x, b.y])).toEqual(before);
  });

  it("grows a shape per hit, cycles its colour and flashes it, and never grows past the cap", () => {
    const engine = boxEngine({ shapeCount: 1, countdown: 0, growPerHit: 3 });
    const view = engine.getBoxView();
    const ball = engine.getBalls()[0];
    const st = view.shapes.get(ball.id)!;
    const r0 = ball.radius;
    const hue0 = st.hue;
    const color0 = ball.color;
    while (st.hits < 1) engine.update(1000 / 60, 0);
    expect(ball.radius).toBeCloseTo(r0 * 1.03, 6);
    expect(ball.radiusScale).toBeCloseTo(ball.radius / 8, 9);
    expect(st.hue).not.toBe(hue0);
    expect(ball.color).not.toBe(color0);
    expect(view.tick - st.lastHitTick).toBeLessThanOrEqual(4);
    run(engine, 60 * 120);
    const field = view.field!;
    expect(ball.radius).toBeLessThanOrEqual(MAX_SHAPE_FRACTION * Math.min(field.width, field.height) + 1e-6);
    expect(ball.radius).toBeGreaterThan(r0 * 2);
  });

  it("accents a DVD logo that reaches a corner (one hit, one louder note, a flash) and never accents squares", () => {
    // A square box, the logo launched from the centre straight at a corner: the first contact is a corner hit.
    const cornerRun = (shape: BoxSettings["shape"]) => {
      const engine = boxEngine({ shape, shapeCount: 1, countdown: 0, aspect: 1, growPerHit: 0 }, 1);
      const view = engine.getBoxView();
      const field = view.field!;
      const ball = engine.getBalls()[0];
      const hw = shapeHalfWidth(shape, ball.radius);
      const hh = shapeHalfHeight(shape, ball.radius);
      const dx = field.width / 2 - hw;
      const dy = field.height / 2 - hh;
      const len = Math.hypot(dx, dy);
      ball.vx = (400 * dx) / len;
      ball.vy = (400 * dy) / len;
      const events: SoundEvent[] = [];
      while (view.totalHits === 0) {
        engine.update(1000 / 60, 0);
        events.push(...engine.consumeSoundEvents());
      }
      engine.update(1000 / 60, 0);
      events.push(...engine.consumeSoundEvents());
      return { events, view, st: view.shapes.get(ball.id)! };
    };
    const dvd = cornerRun("dvd");
    expect(dvd.events).toHaveLength(1);
    expect(dvd.events[0].accent).toBe(true);
    expect(dvd.view.cornerHits).toBe(1);
    expect(dvd.view.lastCornerTick).toBe(dvd.st.lastHitTick);
    expect(dvd.st.hits).toBe(1);
    const square = cornerRun("square");
    expect(square.events).toHaveLength(2);
    expect(square.events.every((e) => !e.accent)).toBe(true);
    expect(square.view.cornerHits).toBe(0);
    expect(square.st.hits).toBe(2);
  });

  it("applies the gravity setting through the shapes' own gravity scale and keeps them inside", () => {
    const still = boxEngine({ shapeCount: 1, countdown: 0, gravity: 0, speedRatio: "1:1" });
    const falling = boxEngine({ shapeCount: 1, countdown: 0, gravity: 1, speedRatio: "1:1" });
    expect(still.getBalls()[0].gravityScale).toBe(0);
    expect(falling.getBalls()[0].gravityScale).toBe(1);
    run(still, 30);
    run(falling, 30);
    const speedStill = Math.hypot(still.getBalls()[0].vx, still.getBalls()[0].vy);
    const speedFalling = Math.hypot(falling.getBalls()[0].vx, falling.getBalls()[0].vy);
    expect(speedStill).toBeCloseTo(400 * still.getBoxView().tempo, 6);
    expect(speedFalling).not.toBeCloseTo(400 * falling.getBoxView().tempo, 1);
    const view = falling.getBoxView();
    const field = view.field!;
    for (let f = 0; f < 1800; f++) {
      falling.update(1000 / 60, 0);
      const b = falling.getBalls()[0];
      expect(b.y + b.radius).toBeLessThanOrEqual(field.bottom + 1e-6);
      expect(b.y - b.radius).toBeGreaterThanOrEqual(field.top - 1e-6);
    }
    expect(view.totalHits).toBeGreaterThan(10);
  });

  it("follows a live ball speed change, a ball size change and a canvas resize", () => {
    const engine = boxEngine({ shapeCount: 2, countdown: 0, speedRatio: "2:3" });
    engine.setConfig({ ballSpeed: 200 });
    engine.update(1000 / 60, 0);
    const tempo = engine.getBoxView().tempo;
    const speeds = engine.getBalls().map((b) => Math.hypot(b.vx, b.vy));
    expect(speeds[0]).toBeCloseTo(200 * tempo * (2 / 3), 6);
    expect(speeds[1]).toBeCloseTo(200 * tempo, 6);
    const r0 = engine.getBalls()[0].radius;
    engine.setConfig({ ballRadius: 16 });
    engine.update(1000 / 60, 0);
    expect(engine.getBalls()[0].radius).toBeCloseTo(2 * r0, 6);
    engine.setConfig({ width: 400, height: 700 });
    const field = engine.getBoxView().field!;
    expect(field.width).toBeLessThan(400);
    for (const b of engine.getBalls()) {
      expect(b.x - b.radius).toBeGreaterThanOrEqual(field.left - 1e-6);
      expect(b.x + b.radius).toBeLessThanOrEqual(field.right + 1e-6);
    }
    expect(engine.getBalls()[0].radius).toBeCloseTo(16 * boxSizeUnit(field), 6);
  });

  it("is deterministic for a seed and different across seeds", () => {
    const trace = (seed: number) => {
      const engine = boxEngine({ shapeCount: 4, countdown: 20, shape: "dvd", speedRatio: "3:4:5" }, seed);
      const events = run(engine, 600);
      return { events, balls: engine.getBalls().map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]) };
    };
    expect(trace(42)).toEqual(trace(42));
    expect(trace(42).balls).not.toEqual(trace(43).balls);
  });

  it("draws the run's tempo from the seed (±15 %), the same for every shape, so the ratios stay exact while the tempo differs across seeds", () => {
    const tempos = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const engine = boxEngine({ shapeCount: 3, speedRatio: "2:3", countdown: 0 }, seed);
      const tempo = engine.getBoxView().tempo;
      expect(tempo).toBeGreaterThanOrEqual(1 - TEMPO_SPREAD / 2);
      expect(tempo).toBeLessThanOrEqual(1 + TEMPO_SPREAD / 2);
      const speeds = engine.getBalls().map((b) => Math.hypot(b.vx, b.vy));
      expect(speeds[0] / speeds[1]).toBeCloseTo(2 / 3, 9);
      expect(speeds[1]).toBeCloseTo(400 * tempo, 9);
      expect(speeds[2]).toBeCloseTo(speeds[0], 9);
      tempos.add(Math.round(tempo * 1e6));
    }
    expect(tempos.size).toBeGreaterThan(25);
  });

  it("brings a DVD logo to a corner in every seed, on the schedule of its odd ratio, even while it grows and whatever the box", () => {
    for (const box of [{ growPerHit: 1 }, { growPerHit: 3 }, { aspect: 1.78 }, { aspect: 0.5, growPerHit: 2 }]) {
      for (let seed = 1; seed <= 12; seed++) {
        const engine = boxEngine({ shape: "dvd", shapeCount: 1, countdown: 0, ...box }, seed, { width: 1000, height: 562 });
        for (let f = 0; f < 60 * 60; f++) {
          engine.update(1000 / 60, 0);
          engine.consumeSoundEvents();
        }
        const view = engine.getBoxView();
        const st = view.shapes.get(engine.getBalls()[0].id)!;
        expect(DVD_AXIS_PERIOD_RATIOS).toContainEqual(st.axisRatio);
        expect(view.cornerHits).toBeGreaterThanOrEqual(3);
        // One corner every p + q − 1 hits from the first cycle on (the launch from the centre is half a cycle in).
        expect(Math.abs(view.cornerHits - view.totalHits / hitsPerCornerCycle(st.axisRatio))).toBeLessThanOrEqual(1);
      }
    }
  }, 20_000);

  it("keeps the corners coming with three growing logos at 3:4:5 counting down from 60 (the preview settings)", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const engine = boxEngine({ shape: "dvd", shapeCount: 3, countdown: 60, speedRatio: "3:4:5" }, seed, { width: 1000, height: 562 });
      for (let f = 0; f < 60 * 120 && !engine.isSimulationFinished(); f++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
      }
      const view = engine.getBoxView();
      expect(view.finished).toBe(true);
      expect(view.totalHits).toBe(180);
      expect(view.cornerHits).toBeGreaterThanOrEqual(12);
    }
  }, 20_000);

  it("turns a DVD logo by a fraction of a degree per hit at most (the corner lock is invisible) and never re-aims squares", () => {
    const heading = (b: { vx: number; vy: number }) => Math.atan2(Math.abs(b.vy), Math.abs(b.vx));
    const dvd = boxEngine({ shape: "dvd", shapeCount: 1, countdown: 0, growPerHit: 1 }, 3);
    const ball = dvd.getBalls()[0];
    const st = dvd.getBoxView().shapes.get(ball.id)!;
    let last = heading(ball);
    let hits = 0;
    let maxTurn = 0;
    for (let f = 0; f < 60 * 60; f++) {
      dvd.update(1000 / 60, 0);
      dvd.consumeSoundEvents();
      if (st.hits !== hits) {
        hits = st.hits;
        maxTurn = Math.max(maxTurn, Math.abs(heading(ball) - last));
        last = heading(ball);
      }
    }
    expect(hits).toBeGreaterThan(30);
    expect(maxTurn).toBeGreaterThan(0);
    expect(maxTurn).toBeLessThan(Math.PI / 180);
    const square = boxEngine({ shape: "square", shapeCount: 2, countdown: 0, growPerHit: 3, speedRatio: "1:1" }, 3);
    const headings = square.getBalls().map(heading);
    run(square, 60 * 30);
    square.getBalls().forEach((b, i) => expect(heading(b)).toBeCloseTo(headings[i], 9));
  });

  it("gives the finder a run length that varies continuously with the seed, so a 30 s target is within reach of the default box", () => {
    const page = defaultSettings("box");
    const request: FinderRequest = {
      targetDurationSec: 30,
      toleranceSec: 0.5,
      maxSeeds: 100,
      maxSimTimeSec: 60,
      physicsConfig: { ...config, width: 1000, height: 562, ballSpeed: page.ballSpeed, ballRadius: page.ballRadius },
      mode: "box",
      modeSettings: { ...modeSettings, box: boxSettingsOf(page) },
    };
    const durations: number[] = [];
    for (let seed = 1; seed <= 100; seed++) durations.push(simulateSeed(seed, request, 60_000) / 1000);
    // Before the seeded tempo a seed could only give one of five run lengths (the five axis ratios).
    expect(new Set(durations.map((d) => Math.round(d * 1000))).size).toBeGreaterThan(80);
    expect(Math.min(...durations)).toBeLessThan(29.5);
    expect(Math.max(...durations)).toBeGreaterThan(30.5);
    expect(Math.max(...durations) / Math.min(...durations)).toBeLessThan(1.6);
    expect(durations.filter((d) => Math.abs(d - 30) <= 0.5).length).toBeGreaterThanOrEqual(3);
  });

  it("finishes for the finder while the countdown is on and says so when it is off", () => {
    const request: FinderRequest = { targetDurationSec: 10, toleranceSec: 100, maxSeeds: 5, maxSimTimeSec: 120, physicsConfig: config, mode: "box", modeSettings: { ...modeSettings, box: { shapeCount: 2, countdown: 6 } } };
    const duration = simulateSeed(5, request, 120_000);
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThan(120_000);
    expect(runNeverFinishes("box", { drop: {}, box: { countdown: 6 } })).toBe(false);
    expect(runNeverFinishes("box", { drop: {}, box: { countdown: 0 } })).toBe(true);
    expect(runNeverFinishes("drop", { drop: { loop: true }, box: {} })).toBe(true);
    expect(runNeverFinishes("drop", { drop: {}, box: {} })).toBe(false);
    // --- review fix (modes-rhythm) --- classic Paint ends at 95 % coverage and is searched; Picture Paint is not
    expect(runNeverFinishes("paint", { drop: {}, box: {} })).toBe(false);
    expect(runNeverFinishes("paint", { drop: {}, box: {}, paintPicture: true })).toBe(true);
    expect(runNeverFinishes("classic", { drop: {}, box: {} })).toBe(false);
  });

  // --- review fix (modes-rhythm) ---
  it("times classic Paint: every seed finishes at 95 % coverage, as the page's engine does", () => {
    const paintConfig = { ...config, width: 450, height: 800, ballRadius: 20 };
    const request: FinderRequest = { targetDurationSec: 90, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 150, physicsConfig: paintConfig, mode: "paint", modeSettings };
    const lengths = new Set<number>();
    for (const seed of [1, 2, 3]) {
      const ms = simulateSeed(seed, request, 150_000);
      expect(ms, `seed ${seed}`).toBeLessThan(150_000);
      const page = createEngineForSettings(paintConfig, "paint", modeSettings, seed);
      let t = 0;
      while (t < 150_000 && !page.isSimulationFinished()) {
        page.update(1000 / 60, 0);
        page.consumeSoundEvents();
        t += 1000 / 60;
      }
      expect(t).toBe(ms);
      expect(page.getPaintCoverage()).toBeGreaterThanOrEqual(0.95);
      lengths.add(Math.round(ms / 100));
    }
    expect(lengths.size).toBeGreaterThan(1);
  });

  it("the finder resolves at once with `endless` instead of simulating an endless box", async () => {
    let progress = 0;
    const result = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "box", modeSettings: { ...modeSettings, box: { countdown: 0 } } }, () => progress++);
    expect(result).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
    expect(progress).toBe(0);
  });
});

describe("Bouncing Shapes settings", () => {
  it("resolve to the defaults, clamp the numbers and reject unknown shapes and ratios", () => {
    expect(resolveBoxSettings(undefined)).toEqual(DEFAULT_BOX_SETTINGS);
    const r = resolveBoxSettings({ shapeCount: 99, shape: "triangle" as BoxSettings["shape"], aspect: 9, gravity: -1, countdown: 12.4, growPerHit: 7, speedRatio: "7:11" as BoxSettings["speedRatio"] });
    expect(r).toEqual({ shapeCount: 12, shape: "square", aspect: 2, gravity: 0, countdown: 12, growPerHit: 3, speedRatio: "3:4:5" });
    expect(resolveBoxSettings({ shapeCount: Number.NaN }).shapeCount).toBe(DEFAULT_BOX_SETTINGS.shapeCount);
    for (const key of Object.keys(BOX_RANGES) as (keyof typeof BOX_RANGES)[]) expect(RANGES[key]).toEqual(BOX_RANGES[key]);
  });

  it("map to and from the SimulatorSettings fields", () => {
    const d = defaultSettings("box");
    expect(boxSettingsOf(d)).toEqual(DEFAULT_BOX_SETTINGS);
    expect(boxSettingFields(DEFAULT_BOX_SETTINGS)).toEqual({ boxShapeCount: 3, boxShape: "square", boxAspect: 0.56, boxGravity: 0, boxCountdown: 30, boxGrowPerHit: 1, boxSpeedRatio: "3:4:5" });
  });

  it("round-trip through the URL keys, skipping the defaults", () => {
    const s: SimulatorSettings = { ...defaultSettings("box"), boxShapeCount: 5, boxShape: "dvd", boxAspect: 1, boxGravity: 0.5, boxCountdown: 60, boxGrowPerHit: 2.5, boxSpeedRatio: "2:3" };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("box");
    expect(params.get("bxn")).toBe("5");
    expect(params.get("bxs")).toBe("dvd");
    expect(params.get("bxa")).toBe("1");
    expect(params.get("bxg")).toBe("0.5");
    expect(params.get("bxc")).toBe("60");
    expect(params.get("bxgr")).toBe("2.5");
    expect(params.get("bxr")).toBe("2:3");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const defaults = settingsToSearchParams(defaultSettings("box"));
    for (const key of ["bxn", "bxs", "bxa", "bxg", "bxc", "bxgr", "bxr"]) expect(defaults.has(key)).toBe(false);
  });

  it("fall back for bad URL values and presets", () => {
    const fromUrl = settingsFromSearchParams(new URLSearchParams("mode=box&bxn=40&bxs=hexagon&bxa=0.1&bxg=5&bxc=-3&bxgr=abc&bxr=9:8"));
    expect(boxSettingsOf(fromUrl)).toEqual({ shapeCount: 12, shape: "square", aspect: 0.5, gravity: 1, countdown: 0, growPerHit: 1, speedRatio: "3:4:5" });
    const preset = presetToSettings({ mode: "box", boxShapeCount: 0, boxShape: "circle", boxSpeedRatio: "4:5:6", boxCountdown: 999 } as Partial<SimulatorSettings>);
    expect(boxSettingsOf(preset)).toEqual({ shapeCount: 1, shape: "circle", aspect: 0.56, gravity: 0, countdown: 99, growPerHit: 1, speedRatio: "4:5:6" });
  });
});
