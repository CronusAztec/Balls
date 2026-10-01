import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_ILLUSION_SETTINGS,
  ILLUSION_RANGES,
  ILLUSION_TYPES,
  LINE_CYCLE_SEC,
  RING_CYCLE_SEC,
  RING_TRAVERSALS,
  WHITESPACE_DONE,
  WHITESPACE_STALL_COVERAGE,
  WHITESPACE_STALL_SEC,
  illusionCycleSeconds,
  illusionFixedDurationSec,
  illusionRunNeverFinishes,
  illusionSettingFields,
  illusionSettingsOf,
  linePhase,
  linePosition,
  lineOffset,
  lineTouch,
  resolveIllusionSettings,
  ringFraction,
  rollingCircleCentre,
  whitespacePitch,
  whitespaceRevealDue,
  whitespaceStallSteps,
  type IllusionSettings,
} from "@/lib/physics/modes/illusion";
import { COVERAGE_GRID, CoverageGrid, ILLUSION_PATTERNS, PATTERN_ELEMENTS, buildIllusionPattern, isLegalPosition, pointInPolygon } from "@/lib/physics/illusionPatterns";
import { pendulumPitch } from "@/lib/physics/modes/pendulum";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Circle Illusion (lib/physics/modes/illusion.ts, feature jdm-illusions): the rolling-circle maths of the lines type
 * (phase_i = i·π/N on the diameter at i·π/N puts every ball on one smaller rolling circle), the rim touches, the rings'
 * triangle wave, touches and alignments, the nested circles (containment, energy, determinism), the white-spaces
 * pictures, coverage and reveal, the finder (endless, fixed length, seed search) and the settings (URL, presets).
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

function engineFor(illusion: Partial<IllusionSettings>, seed = 42, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "illusion", { ...modeSettings, illusion }, seed);
}

/** Runs `steps` steps and collects the sound events. */
function run(engine: PhysicsEngine, steps: number): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < steps; i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

/* ------------------------------------------------------------------ settings */

describe("illusion settings", () => {
  it("resolve: defaults, clamping and fallbacks", () => {
    expect(resolveIllusionSettings(null)).toEqual(DEFAULT_ILLUSION_SETTINGS);
    expect(DEFAULT_ILLUSION_SETTINGS.type).toBe("lines");
    const r = resolveIllusionSettings({ balls: 99, rings: 1, depth: 7.6, painters: -3, speed: 9, cycles: 2.4 });
    expect(r).toMatchObject({ balls: 99, rings: 2, depth: 8, painters: 1, speed: 9, cycles: 2 }); // --- uncap-all --- (no maximum)
    expect(resolveIllusionSettings({ speed: 1.337 }).speed).toBeCloseTo(1.35, 12);
    const junk = { type: "spiral", pattern: "cat", tracks: "yes", reveal: 1, balls: "x" } as unknown as Partial<IllusionSettings>;
    expect(resolveIllusionSettings(junk)).toEqual(DEFAULT_ILLUSION_SETTINGS);
    for (const key of Object.keys(ILLUSION_RANGES) as (keyof typeof ILLUSION_RANGES)[]) expect(RANGES[key]).toEqual(ILLUSION_RANGES[key]);
    expect(RANGES.wallWobble).toMatchObject({ min: 0, max: 1 });
  });

  it("are the defaults in every mode and stay out of the URL", () => {
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(illusionSettingsOf(d)).toEqual(DEFAULT_ILLUSION_SETTINGS);
      expect(d.wallWobble).toBe(0);
      const params = new URLSearchParams(settingsToSearchParams(d).toString());
      for (const key of ["ilt", "ilb", "ilr", "ild", "ilp", "ilpt", "ils", "iltr", "ilrv", "ilc", "wob"]) expect(params.has(key)).toBe(false);
    }
  });

  it("round-trip through the URL", () => {
    const s = { ...defaultSettings("illusion"), ...illusionSettingFields({ type: "whitespace", balls: 12, rings: 5, depth: 4, painters: 7, pattern: "star", speed: 1.5, tracks: false, reveal: true, cycles: 3 }), wallWobble: 0.65 };
    const params = settingsToSearchParams(s);
    expect(params.get("ilt")).toBe("whitespace");
    expect(params.get("ilb")).toBe("12");
    expect(params.get("ilpt")).toBe("star");
    expect(params.get("ils")).toBe("1.5");
    expect(params.get("iltr")).toBe("0");
    expect(params.get("ilrv")).toBe("1");
    expect(params.get("wob")).toBe("0.65");
    const back = settingsFromSearchParams(params);
    expect(illusionSettingsOf(back)).toEqual(illusionSettingsOf(s));
    expect(back.wallWobble).toBe(0.65);
    // Out-of-range and unknown values are clamped or ignored.
    const bad = settingsFromSearchParams(new URLSearchParams("mode=illusion&ilt=blob&ilb=500&ild=1&ils=0&ilpt=cat&wob=7&iltr=maybe"));
    expect(illusionSettingsOf(bad)).toMatchObject({ type: "lines", balls: 500, depth: 2, speed: 0.25, pattern: "auto", tracks: true }); // --- uncap-all --- (ilb=500 and wob=7 kept)
    expect(bad.wallWobble).toBe(7);
  });

  it("validate presets", () => {
    const loaded = presetToSettings({ mode: "illusion", ilType: "nested", ilDepth: 9, ilSpeed: -1, ilPattern: "heart", wallWobble: -2 } as Parameters<typeof presetToSettings>[0]);
    expect(illusionSettingsOf(loaded)).toMatchObject({ type: "nested", depth: 9, speed: 0.25, pattern: "heart" }); // --- uncap-all --- (ilDepth 9 kept)
    expect(loaded.wallWobble).toBe(0);
    const old = presetToSettings({ mode: "classic" });
    expect(illusionSettingsOf(old)).toEqual(DEFAULT_ILLUSION_SETTINGS);
  });

  it("register the mode in the rhythm family", () => {
    expect(MODE_IDS).toContain("illusion");
    expect(MODE_CARD_ORDER).toContain("illusion");
    expect(MODE_CATEGORIES.illusion).toBe("rhythm");
  });
});

/* ------------------------------------------------------------------ lines: the rolling-circle illusion */

describe("illusion lines maths", () => {
  it("puts ball i on the diameter at i·π/N with the phase offset i·π/N", () => {
    expect(linePhase(0, 8)).toBe(0);
    expect(linePhase(3, 8)).toBeCloseTo((3 * Math.PI) / 8, 12);
    // At θ = its own phase the ball is at the + end of its diameter; π later at the − end.
    for (let i = 0; i < 8; i++) {
      expect(lineOffset(linePhase(i, 8), i, 8)).toBeCloseTo(1, 12);
      expect(lineOffset(linePhase(i, 8) + Math.PI, i, 8)).toBeCloseTo(-1, 12);
    }
  });

  it("keeps every ball on one smaller circle of radius A/2 rolling inside the big one, evenly spaced", () => {
    const A = 250;
    const p = { x: 0, y: 0 };
    const c = { x: 0, y: 0 };
    for (const n of [2, 3, 5, 8, 13, 32]) {
      for (const rotation of [0, -Math.PI / 2, 0.7]) {
        for (let k = 0; k < 40; k++) {
          const theta = (k / 40) * 2 * Math.PI * 3 - 4;
          rollingCircleCentre(theta, A, rotation, c);
          // The rolling circle touches the big circle from inside: its centre is A/2 from the middle.
          expect(Math.hypot(c.x, c.y)).toBeCloseTo(A / 2, 9);
          const angles: number[] = [];
          for (let i = 0; i < n; i++) {
            linePosition(theta, i, n, A, rotation, p);
            // On its diameter…
            const a = linePhase(i, n) + rotation;
            expect(Math.abs(p.x * Math.sin(a) - p.y * Math.cos(a))).toBeLessThan(1e-9);
            // …and on the rolling circle.
            expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(A / 2, 9);
            angles.push(Math.atan2(p.y - c.y, p.x - c.x));
          }
          // Ball i sits at the angle 2·i·π/N − θ (+ rotation) on the small circle: evenly spaced.
          for (let i = 0; i < n; i++) {
            const expected = (2 * i * Math.PI) / n - theta + rotation;
            const diff = Math.atan2(Math.sin(angles[i] - expected), Math.cos(angles[i] - expected));
            expect(Math.abs(diff)).toBeLessThan(1e-7);
          }
        }
      }
    }
  });

  it("names the ball and the end of every rim touch", () => {
    for (const n of [3, 8]) {
      for (const dir of [1, -1]) {
        for (let m = 0; m < 4 * n; m++) {
          const touch = lineTouch(m, n, dir);
          const theta = (dir * Math.PI * m) / n;
          // Exactly this ball is at an end of its diameter at the slot's phase…
          expect(Math.abs(lineOffset(theta, touch.ball, n))).toBeCloseTo(1, 9);
          for (let i = 0; i < n; i++) if (i !== touch.ball) expect(Math.abs(lineOffset(theta, i, n))).toBeLessThan(1 - 1e-6);
          // …and the touch angle is the end it is at.
          const end = lineOffset(theta, touch.ball, n) > 0 ? 0 : Math.PI;
          expect(Math.cos(touch.angle - (linePhase(touch.ball, n) + end))).toBeCloseTo(1, 9);
        }
      }
    }
    // Forward: the touches go round the balls in order, each ball twice per cycle (once at each end).
    expect([0, 1, 2, 3, 4, 5].map((m) => lineTouch(m, 3, 1).ball)).toEqual([0, 1, 2, 0, 1, 2]);
    expect([0, 1, 2, 3].map((m) => lineTouch(m, 3, -1).ball)).toEqual([0, 2, 1, 0]);
  });

  it("runs in the engine: 2N notes per cycle, every ball exactly on the hidden circle, one pitch per ball", () => {
    const e = engineFor({ type: "lines", balls: 8 }, 7);
    const v = e.getIllusionView();
    expect(e.getCurrentModeName()).toBe("illusion");
    expect(v.count).toBe(8);
    expect(e.getBalls()).toHaveLength(8);
    const pitches = new Set<number>();
    let notes = 0;
    for (let i = 0; i < 60 * LINE_CYCLE_SEC; i++) {
      e.update(STEP, 0);
      for (const ev of e.consumeSoundEvents()) {
        expect(ev.type).toBe("hit");
        pitches.add(Math.round(ev.frequency!));
        notes += ev.chord ? ev.chord.length : 1;
      }
      expect(v.circleError).toBeLessThan(1e-6);
      // The engine balls are pinned where the mode puts them.
      e.getBalls().forEach((b, j) => {
        expect(b.x).toBe(v.x[j]);
        expect(b.y).toBe(v.y[j]);
      });
    }
    // One cycle (4 s at speed 1): 2N touches – the touch at t = 0 counts, the one at t = T starts the next cycle.
    expect(notes).toBe(16);
    expect(v.noteCount).toBe(16);
    expect([...pitches].sort((a, b) => a - b)).toEqual(Array.from({ length: 8 }, (_, i) => Math.round(pendulumPitch(i, 8, "up"))).sort((a, b) => a - b));
    // Every touch logged a rim contact for the wobbly wall, on wall 0.
    const log = e.getWallContacts();
    expect(log.serial - log.runStart).toBe(16);
    for (let s = log.runStart; s < log.serial; s++) expect(log.wall[log.indexOf(s)]).toBe(0);
  });

  it("touches the rim where the ball is at that moment", () => {
    const e = engineFor({ type: "lines", balls: 5, speed: 0.5 }, 3);
    const v = e.getIllusionView();
    const log = e.getWallContacts();
    let seen = log.serial;
    for (let i = 0; i < 600; i++) {
      e.update(STEP, 0);
      e.consumeSoundEvents();
      for (; seen < log.serial; seen++) {
        const k = log.indexOf(seen);
        // The contact time lies within the step just run, and some ball is at the rim near that angle.
        expect(log.timeMs[k]).toBeLessThanOrEqual(e.getElapsedMs() + 1e-6);
        expect(log.timeMs[k]).toBeGreaterThan(e.getElapsedMs() - STEP - 1e-6);
        const a = log.angle[k];
        let best = Infinity;
        for (let j = 0; j < v.count; j++) {
          const rim = { x: v.cx + v.amplitude * Math.cos(a), y: v.cy + v.amplitude * Math.sin(a) };
          best = Math.min(best, Math.hypot(v.x[j] - rim.x, v.y[j] - rim.y));
        }
        expect(best).toBeLessThan(0.02 * v.radius);
      }
    }
  });

  it("finishes after the cycles, back in the start position, in silence", () => {
    const e = engineFor({ type: "lines", balls: 6, cycles: 2 }, 11);
    const v = e.getIllusionView();
    const x0 = Array.from(v.x);
    const y0 = Array.from(v.y);
    let steps = 0;
    let notes = 0;
    while (!e.isSimulationFinished() && steps < 2000) {
      e.update(STEP, 0);
      notes += e.consumeSoundEvents().reduce((n, ev) => n + (ev.chord ? ev.chord.length : 1), 0);
      steps++;
    }
    expect(steps / 60).toBeCloseTo(2 * LINE_CYCLE_SEC, 1);
    // 2N per cycle plus the closing touch at t = 2T.
    expect(notes).toBe(2 * 2 * 6 + 1);
    expect(v.cyclesDone).toBe(2);
    for (let j = 0; j < v.count; j++) {
      expect(v.x[j]).toBeCloseTo(x0[j], 6);
      expect(v.y[j]).toBeCloseTo(y0[j], 6);
    }
    expect(run(e, 120)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ rings */

describe("illusion rings", () => {
  it("ringFraction is the triangle wave between the walls", () => {
    expect(ringFraction(0)).toBe(0);
    expect(ringFraction(0.25)).toBeCloseTo(0.25, 12);
    expect(ringFraction(1)).toBe(1);
    expect(ringFraction(1.5)).toBeCloseTo(0.5, 12);
    expect(ringFraction(2)).toBe(0);
    expect(ringFraction(-0.25)).toBeCloseTo(0.25, 12);
    expect(ringFraction(7.75)).toBeCloseTo(0.25, 12);
  });

  it("bounces every ball between its ring's walls, ripples the notes outward and aligns once per cycle", () => {
    const K = 6;
    const e = engineFor({ type: "rings", rings: K, speed: 2 }, 5);
    const v = e.getIllusionView();
    const cycleSteps = Math.round((60 * RING_CYCLE_SEC) / 2);
    const order: number[] = [];
    const pitchOf = (k: number) => pendulumPitch(k, K, "down");
    let notes = 0;
    for (let i = 0; i < cycleSteps; i++) {
      e.update(STEP, 0);
      for (const ev of e.consumeSoundEvents()) {
        notes += ev.chord ? ev.chord.length : 1;
        if (!ev.chord && order.length < 2 * K) order.push([...Array(K).keys()].find((k) => Math.abs(pitchOf(k) - ev.frequency!) < 1e-6)!);
      }
      for (let k = 0; k < K; k++) {
        const rho = Math.hypot(v.x[k] - v.cx, v.y[k] - v.cy);
        expect(rho).toBeGreaterThanOrEqual(v.boundaries[k] + v.r[k] - 1e-6);
        expect(rho).toBeLessThanOrEqual(v.boundaries[k + 1] - v.r[k] + 1e-6);
      }
    }
    // Every ball touches a wall RING_TRAVERSALS times per cycle.
    expect(notes).toBe(K * RING_TRAVERSALS);
    // The touches ripple outward: ring 0, 1, 2 … K − 1, then again from the middle.
    expect(order).toEqual([...Array(2 * K).keys()].map((n) => n % K));
    // A cycle later every rail points the same way again (12 o'clock) …
    for (let k = 0; k < K; k++) expect(Math.cos(v.ringAngle[k] + Math.PI / 2)).toBeCloseTo(1, 9);
    expect(v.alignCount).toBe(0);
    // … and the next step holds the alignment: ring 0 touches its inner wall with an accent.
    const next = run(e, 1);
    expect(v.alignCount).toBe(1);
    expect(next).toHaveLength(1);
    expect(next[0].accent).toBe(true);
    expect(next[0].frequency).toBeCloseTo(pitchOf(0), 9);
  });

  it("logs contacts on the ring walls, outward on the outer wall and inward on the inner one", () => {
    const e = engineFor({ type: "rings", rings: 4 }, 9);
    run(e, 180);
    const log = e.getWallContacts();
    expect(log.serial - log.runStart).toBeGreaterThan(8);
    for (let s = log.oldestSerial(); s < log.serial; s++) {
      const k = log.indexOf(s);
      expect(log.wall[k]).toBeGreaterThanOrEqual(0);
      expect(log.wall[k]).toBeLessThanOrEqual(4);
      expect(Math.abs(log.strength[k])).toBeGreaterThan(0);
    }
  });

  it("finishes at the last alignment with an accent", () => {
    const e = engineFor({ type: "rings", rings: 3, cycles: 1, speed: 3 }, 2);
    let accented = 0;
    let steps = 0;
    while (!e.isSimulationFinished() && steps < 3000) {
      e.update(STEP, 0);
      accented += e.consumeSoundEvents().filter((ev) => ev.accent).length;
      steps++;
    }
    expect(steps / 60).toBeCloseTo(RING_CYCLE_SEC / 3, 1);
    expect(accented).toBe(1);
    expect(e.getIllusionView().cyclesDone).toBe(1);
  });
});

/* ------------------------------------------------------------------ nested */

describe("illusion nested circles", () => {
  it("keeps every circle inside its container, conserves the energy and wobbles the walls it hits", () => {
    for (const depth of [2, 3, 5]) {
      const e = engineFor({ type: "nested", depth }, 17 + depth);
      const v = e.getIllusionView();
      expect(v.count).toBe(depth);
      expect(v.layerCount).toBe(depth + 1);
      expect(v.intrinsicWobble).toBeGreaterThan(0);
      const e0 = e.illusionMode.getNestedEnergy();
      expect(e0).toBeGreaterThan(0);
      for (let i = 0; i < 60 * 20; i++) {
        e.update(STEP, 0);
        e.consumeSoundEvents();
        for (let l = 1; l < v.layerCount; l++) {
          const d = Math.hypot(v.layerX[l] - v.layerX[l - 1], v.layerY[l] - v.layerY[l - 1]);
          expect(d).toBeLessThanOrEqual(v.layerR[l - 1] - v.layerR[l] + 1e-6);
        }
      }
      // Elastic collisions: the kinetic energy is the same after 20 s (the position correction never adds or removes any).
      expect(e.illusionMode.getNestedEnergy()).toBeCloseTo(e0, 9);
      expect(v.collisions).toBeGreaterThan(10);
      expect(v.noteCount).toBeGreaterThan(10);
      const log = e.getWallContacts();
      let outward = 0;
      let inward = 0;
      for (let s = log.oldestSerial(); s < log.serial; s++) {
        const k = log.indexOf(s);
        expect(log.wall[k]).toBeLessThanOrEqual(depth);
        if (log.strength[k] > 0) outward++;
        else inward++;
      }
      // Every hit wobbles the container outward and the circle inside it inward, on the same side.
      expect(outward).toBe(inward);
      expect(e.isSimulationFinished()).toBe(false);
    }
  });

  it("is deterministic for a seed and different for another", () => {
    const trace = (seed: number) => {
      const e = engineFor({ type: "nested", depth: 4 }, seed);
      run(e, 900);
      const v = e.getIllusionView();
      return Array.from(v.layerX).concat(Array.from(v.layerY));
    };
    expect(trace(123)).toEqual(trace(123));
    expect(trace(123)).not.toEqual(trace(124));
  });
});

/* ------------------------------------------------------------------ whitespace */

describe("illusion white spaces", () => {
  it("lays every picture out inside the arena, with a probe point inside its white space", () => {
    for (const id of ILLUSION_PATTERNS) {
      const p = buildIllusionPattern(id, 400, 300, 250);
      expect(p.obstacles.length).toBeGreaterThan(0);
      expect(PATTERN_ELEMENTS[id].length).toBeGreaterThan(0);
      for (const d of p.discs) expect(Math.hypot(d.x - 400, d.y - 300) + d.r).toBeLessThan(0.7 * 250);
      for (const list of [p.polygons, p.strokes]) for (const s of list) for (let i = 0; i < s.points.length; i += 2) expect(Math.hypot(s.points[i] - 400, s.points[i + 1] - 300) + s.thickness / 2).toBeLessThan(0.7 * 250);
      // The probe lies in the white space: no ball may be centred there.
      expect(isLegalPosition(p, p.probeX, p.probeY, 1)).toBe(false);
      // The rim region is free.
      expect(isLegalPosition(p, 400, 300 + 0.85 * 250, 10)).toBe(true);
    }
    expect(pointInPolygon(0.5, 0.5, [0, 0, 1, 0, 1, 1, 0, 1])).toBe(true);
    expect(pointInPolygon(1.5, 0.5, [0, 0, 1, 0, 1, 1, 0, 1])).toBe(false);
  });

  it("the coverage grid counts the paintable cells and paints a swept segment once", () => {
    const grid = new CoverageGrid(64);
    grid.build(0, 0, 100, 5, (x, y) => Math.hypot(x, y) <= 95);
    expect(grid.paintableCount).toBeGreaterThan(0.6 * 64 * 64);
    expect(grid.coverage()).toBe(0);
    const first = grid.markSegment(-50, 0, 50, 0, 5);
    expect(first).toBeGreaterThan(0);
    expect(grid.markSegment(-50, 0, 50, 0, 5)).toBe(0);
    expect(grid.coverage()).toBeCloseTo(first / grid.paintableCount, 12);
    expect(grid.isUnpainted(0, 0)).toBe(false);
    expect(grid.isUnpainted(0, 60)).toBe(true);
    expect(COVERAGE_GRID).toBe(128);
  });

  it("scores a painter's ray only up to the first cell the paint cannot reach – white behind the picture does not count", () => {
    // A wall of the picture across the middle of the arena (a band no ball may be centred in), everything else white.
    const grid = new CoverageGrid(64);
    grid.build(0, 0, 100, 4, (x, y) => Math.hypot(x, y) <= 96 && Math.abs(y) > 12);
    expect(grid.isPaintable(0, 60)).toBe(true);
    expect(grid.isPaintable(0, 0)).toBe(false);
    expect(grid.isPaintable(0, 150)).toBe(false);
    // Paint the upper half: the only white left lies behind the wall.
    for (let y = -95; y <= -8; y += 2) grid.markSegment(-100, y, 100, y, 4);
    expect(grid.isUnpainted(0, 60)).toBe(true);
    expect(grid.isUnpainted(0, -60)).toBe(false);
    // Straight down from the top: the ray ends at the wall, however much white lies beyond it.
    expect(grid.rayScore(0, -90, 0, 1, 200, 2)).toBe(0);
    // From below the wall the same white is reachable and counts, up to the rim.
    const below = grid.rayScore(0, 20, 0, 1, 200, 2);
    expect(below).toBeGreaterThan(30);
    expect(grid.rayScore(0, 20, 0, 1, 1000, 2)).toBe(below);
  });

  it("reveals from 90 % once no painter has found a new cell for six seconds, counted in steps", () => {
    expect(whitespaceStallSteps(60, 1)).toBe(WHITESPACE_STALL_SEC * 60);
    expect(whitespaceStallSteps(60, 2)).toBe(WHITESPACE_STALL_SEC * 30);
    expect(whitespaceRevealDue(WHITESPACE_DONE, 0, 60, 1)).toBe(true);
    expect(whitespaceRevealDue(WHITESPACE_DONE - 0.001, 0, 60, 1)).toBe(false);
    expect(whitespaceRevealDue(WHITESPACE_STALL_COVERAGE, 359, 60, 1)).toBe(false);
    expect(whitespaceRevealDue(WHITESPACE_STALL_COVERAGE, 360, 60, 1)).toBe(true);
    expect(whitespaceRevealDue(WHITESPACE_STALL_COVERAGE - 0.001, 10_000, 60, 1)).toBe(false);
    // In the engine: painters that stop finding white (frozen here) reveal the picture exactly six seconds after
    // their last new cell once 90 % is painted – and never below it.
    for (const [threshold, reveals] of [
      [WHITESPACE_STALL_COVERAGE + 0.01, true],
      [0.5, false],
    ] as const) {
      const e = engineFor({ type: "whitespace", painters: 3 }, 8);
      const v = e.getIllusionView();
      while (v.coverage < threshold && !v.finished) run(e, 1);
      expect(v.finished).toBe(false);
      const mode = e.illusionMode as unknown as { pvx: Float64Array; pvy: Float64Array };
      mode.pvx.fill(0);
      mode.pvy.fill(0);
      const frozenAt = v.step;
      const coverage = v.coverage;
      const events = run(e, whitespaceStallSteps(60, 1) - 1);
      expect(v.finished).toBe(false);
      expect(v.coverage).toBe(coverage);
      expect(events.some((ev) => ev.accent)).toBe(false);
      const last = run(e, 1);
      expect(v.finished).toBe(reveals);
      if (reveals) {
        // The same reveal as at 98 %: the step, the accented chord, at the coverage reached.
        expect(v.revealStep).toBe(frozenAt + whitespaceStallSteps(60, 1));
        const chord = last.filter((ev) => ev.accent);
        expect(chord).toHaveLength(1);
        expect(chord[0].chord).toHaveLength(4);
        expect(v.coverage).toBeLessThan(WHITESPACE_DONE);
        expect(e.isSimulationFinished()).toBe(true);
      }
    }
  });

  it("reaches every pocket it can: big painters and a smile, one or two painters and a cross", () => {
    // Once stuck at 97.7 % (big painters, pockets under the eyes) and at 84–97 % (the cross with few painters): steering
    // off the picture too, at white a painter can reach, finds the last pockets.
    const cases: [Partial<IllusionSettings>, number, PhysicsConfig, number][] = [
      [{ type: "whitespace", pattern: "smile", painters: 5 }, 4, { ...config, ballRadius: 16 }, 40],
      ...[1, 3, 5, 9, 11, 12].map((seed): [Partial<IllusionSettings>, number, PhysicsConfig, number] => [{ type: "whitespace", pattern: "cross", painters: 2 }, seed, config, 90]),
      [{ type: "whitespace", pattern: "cross", painters: 1 }, 2, config, 150],
    ];
    for (const [settings, seed, cfg, boundSec] of cases) {
      const e = engineFor(settings, seed, cfg);
      const v = e.getIllusionView();
      const pattern = v.pattern!;
      let steps = 0;
      let outside = 0;
      while (!e.isSimulationFinished() && steps < 60 * boundSec) {
        e.update(STEP, 0);
        e.consumeSoundEvents();
        for (let j = 0; j < v.count; j++) if (!isLegalPosition(pattern, v.x[j], v.y[j], v.painterRadius - 0.5)) outside++;
        steps++;
      }
      const label = `${JSON.stringify(settings)} seed ${seed} ball ${cfg.ballRadius}`;
      expect(v.finished, label).toBe(true);
      expect(v.coverage, label).toBeGreaterThanOrEqual(WHITESPACE_DONE);
      expect(outside, label).toBe(0);
    }
  });

  it("paints until the picture is revealed, never entering it, with notes climbing the scale", () => {
    const e = engineFor({ type: "whitespace", painters: 6 }, 21);
    const v = e.getIllusionView();
    const pattern = v.pattern!;
    expect(ILLUSION_PATTERNS).toContain(pattern.id);
    let last = v.coverage;
    const pitches: number[] = [];
    let steps = 0;
    while (!e.isSimulationFinished() && steps < 60 * 90) {
      e.update(STEP, 0);
      for (const ev of e.consumeSoundEvents()) if (!ev.accent) pitches.push(ev.frequency!);
      expect(v.coverage).toBeGreaterThanOrEqual(last);
      last = v.coverage;
      if (!v.finished) expect(v.coverage).toBeLessThan(WHITESPACE_DONE);
      for (let j = 0; j < v.count; j++) expect(isLegalPosition(pattern, v.x[j], v.y[j], v.painterRadius - 0.5)).toBe(true);
      steps++;
    }
    expect(v.finished).toBe(true);
    expect(v.coverage).toBeGreaterThanOrEqual(WHITESPACE_DONE);
    expect(v.revealStep).toBe(v.step);
    expect(v.revealAtMs).toBeCloseTo(e.getElapsedMs(), 6);
    expect(steps / 60).toBeGreaterThan(8);
    // The notes climb with the coverage (the scale degree only ever goes up).
    for (let i = 1; i < pitches.length; i++) expect(pitches[i]).toBeGreaterThanOrEqual(pitches[i - 1]);
    expect(pitches[0]).toBeCloseTo(whitespacePitch(0), 6);
    // Every painter's path was recorded for the canvas.
    for (let j = 0; j < v.count; j++) expect(v.pathLen[j]).toBeGreaterThan(100);
    // After the reveal: still, silent.
    const x = Array.from(v.x);
    expect(run(e, 60)).toHaveLength(0);
    expect(Array.from(v.x)).toEqual(x);
  });

  it("the seed picks the picture unless one is chosen, and replays exactly", () => {
    const ids = new Set<string>();
    for (let seed = 1; seed <= 16; seed++) ids.add(engineFor({ type: "whitespace" }, seed).getIllusionView().pattern!.id);
    expect(ids.size).toBeGreaterThan(3);
    expect(engineFor({ type: "whitespace", pattern: "moon" }, 5).getIllusionView().pattern!.id).toBe("moon");
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 90, physicsConfig: config, mode: "illusion", modeSettings: { ...modeSettings, illusion: { type: "whitespace", painters: 8 } } };
    const a = simulateSeed(77, request, 90_000);
    const b = simulateSeed(77, request, 90_000);
    expect(a).toBe(b);
    expect(a).toBeLessThan(90_000);
  });

  it("rescales the painters, their paths and the picture with a canvas resize", () => {
    const e = engineFor({ type: "whitespace" }, 4);
    run(e, 120);
    const v = e.getIllusionView();
    const before = { r: v.radius, x: v.x[0] - v.cx, y: v.y[0] - v.cy, version: v.pathVersion, coverage: v.coverage };
    e.setConfig({ width: 1600, height: 1200 });
    const k = v.radius / before.r;
    expect(k).toBeCloseTo(2, 6);
    expect(v.x[0] - v.cx).toBeCloseTo(before.x * k, 6);
    expect(v.y[0] - v.cy).toBeCloseTo(before.y * k, 6);
    expect(v.pathVersion).toBe(before.version + 1);
    expect(v.coverage).toBe(before.coverage);
    run(e, 60);
    expect(v.coverage).toBeGreaterThanOrEqual(before.coverage);
  });
});

/* ------------------------------------------------------------------ the finder */

describe("illusion and the finder", () => {
  it("knows which runs never finish and which have a fixed length", () => {
    expect(illusionRunNeverFinishes({ type: "nested" })).toBe(true);
    expect(illusionRunNeverFinishes({ type: "lines" })).toBe(true);
    expect(illusionRunNeverFinishes({ type: "rings", cycles: 2 })).toBe(false);
    expect(illusionRunNeverFinishes({ type: "whitespace" })).toBe(false);
    expect(runNeverFinishes("illusion", { drop: {}, box: {}, illusion: { type: "nested" } })).toBe(true);
    expect(runNeverFinishes("illusion", { drop: {}, box: {}, illusion: { type: "whitespace" } })).toBe(false);
    expect(illusionCycleSeconds({ type: "lines", speed: 2 })).toBe(LINE_CYCLE_SEC / 2);
    expect(illusionCycleSeconds({ type: "rings" })).toBe(RING_CYCLE_SEC);
    expect(illusionCycleSeconds({ type: "nested" })).toBe(0);
    expect(illusionFixedDurationSec({ type: "lines", cycles: 3 })).toBe(12);
    expect(fixedRunDurationSec("illusion", { illusion: { type: "rings", cycles: 1, speed: 0.5 } })).toBe(48);
    expect(fixedRunDurationSec("illusion", { illusion: { type: "whitespace" } })).toBeNull();
    for (const type of ILLUSION_TYPES) expect(() => createEngineForSettings(config, "illusion", { ...modeSettings, illusion: { type } }, 1)).not.toThrow();
  });

  it("resolves at once for endless and fixed-length runs, and searches the white spaces", async () => {
    const endless = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 100, maxSimTimeSec: 60, physicsConfig: config, mode: "illusion", modeSettings: { ...modeSettings, illusion: { type: "nested" } } }, () => undefined);
    expect(endless).toMatchObject({ found: false, endless: true, seedsTested: 0 });
    const fixed = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 100, maxSimTimeSec: 60, physicsConfig: config, mode: "illusion", modeSettings: { ...modeSettings, illusion: { type: "lines", cycles: 2 } } }, () => undefined);
    expect(fixed).toMatchObject({ found: false, fixedDuration: true, seedsTested: 0 });
    expect(fixed.duration).toBe(8);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      // A wide tolerance: the white spaces' run length depends on the seed, so the search finds one quickly.
      const found = await findSimulation({ targetDurationSec: 30, toleranceSec: 20, maxSeeds: 8, maxSimTimeSec: 60, physicsConfig: config, mode: "illusion", modeSettings: { ...modeSettings, illusion: { type: "whitespace", painters: 6 } } }, () => undefined);
      expect(found.found).toBe(true);
      const replay = simulateSeed(found.seed, { targetDurationSec: 30, toleranceSec: 20, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: config, mode: "illusion", modeSettings: { ...modeSettings, illusion: { type: "whitespace", painters: 6 } } }, 60_000);
      expect(replay / 1000).toBeCloseTo(found.duration, 6);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
