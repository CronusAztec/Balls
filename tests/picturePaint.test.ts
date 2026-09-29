import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  COVERAGE_DONE,
  DEFAULT_PICTURE_PAINT,
  GUIDE_MAX_NUDGE,
  PACE_MAX,
  PACE_MIN,
  PICTURE_PAINT_RANGES,
  SUMMARY_SIZE,
  expectedCoverage,
  largestUnrevealedCluster,
  paceBrushScale,
  paceStatus,
  paintTargetSeconds,
  picturePaintOf,
  resolvePicturePaintSettings,
  signedAngleDelta,
  steerAngle,
  summarizeCoverage,
  type PaintModeOptions,
} from "@/lib/physics/picturePaint";
import { MODE_IDS, type PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import type { BeatClockConfig } from "@/lib/simulation/beatClock";

/* ------------------------------------------------------------------ coverage maths */

/** An n×n grid with the cells inside the circle painted where `paint(x, y)` (0–1 coordinates) says so. */
function gridWhere(n: number, paint: (x: number, y: number) => boolean): Uint8Array {
  const grid = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (paint((x + 0.5) / n, (y + 0.5) / n)) grid[y * n + x] = 1;
  return grid;
}

describe("coverage summary", () => {
  it("reads 0 inside the circle and 1 outside it for an empty grid, and 1 everywhere once painted", () => {
    const m = SUMMARY_SIZE;
    const empty = summarizeCoverage(new Uint8Array(100 * 100), 100, m);
    expect(empty[(m / 2) * m + m / 2]).toBe(0);
    expect(empty[0]).toBe(1); // the corner block lies outside the circle
    expect(empty[m - 1]).toBe(1);
    const full = summarizeCoverage(new Uint8Array(100 * 100).fill(1), 100, m);
    for (const v of full) expect(v).toBe(1);
  });

  it("gives partial fractions for half-painted blocks", () => {
    const grid = gridWhere(96, (x) => x < 0.5); // the left half is painted
    const summary = summarizeCoverage(grid, 96, 24);
    const row = 12 * 24;
    expect(summary[row + 2]).toBe(1);
    expect(summary[row + 20]).toBe(0);
  });
});

describe("largest unrevealed cluster", () => {
  it("is null once everything is revealed", () => {
    expect(largestUnrevealedCluster(new Float32Array(24 * 24).fill(1), 24)).toBeNull();
    expect(largestUnrevealedCluster(new Float32Array(24 * 24).fill(0.6), 24)).toBeNull();
  });

  it("points at the unpainted half of a half-painted circle", () => {
    const summary = summarizeCoverage(gridWhere(96, (x) => x < 0.5), 96, 24);
    const target = largestUnrevealedCluster(summary, 24);
    expect(target).not.toBeNull();
    expect(target!.x).toBeGreaterThan(0.6);
    expect(target!.x).toBeLessThan(0.9);
    expect(target!.y).toBeCloseTo(0.5, 1);
    expect(target!.cells).toBeGreaterThan(100);
  });

  it("prefers the heavier of two separate clusters and weights its centroid by how unrevealed the blocks are", () => {
    const m = 24;
    const summary = new Float32Array(m * m).fill(1);
    // A small fully hidden cluster top-left, a bigger half-hidden cluster bottom-right.
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) summary[y * m + x] = 0;
    for (let y = 12; y < 22; y++) for (let x = 12; x < 22; x++) summary[y * m + x] = 0.4;
    const target = largestUnrevealedCluster(summary, m)!;
    expect(target.cells).toBe(100);
    expect(target.weight).toBeCloseTo(60, 5);
    expect(target.x).toBeCloseTo(17 / m, 5);
    expect(target.y).toBeCloseTo(17 / m, 5);
    // Reveal most of the big one and the small one wins.
    for (let y = 12; y < 22; y++) for (let x = 12; x < 22; x++) summary[y * m + x] = 0.95;
    const small = largestUnrevealedCluster(summary, m)!;
    expect(small.cells).toBe(9);
    expect(small.x).toBeCloseTo(3.5 / m, 5);
  });

  it("treats diagonal neighbours as separate clusters", () => {
    const m = 8;
    const summary = new Float32Array(m * m).fill(1);
    summary[0] = 0;
    summary[m + 1] = 0;
    summary[m + 2] = 0;
    const target = largestUnrevealedCluster(summary, m)!;
    expect(target.cells).toBe(2);
  });
});

describe("steering", () => {
  it("wraps signed angle differences into (−π, π]", () => {
    expect(signedAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(signedAngleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(signedAngleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(signedAngleDelta(-3, 3)).toBeCloseTo(-(2 * Math.PI - 6));
  });

  it("turns toward the target, never by more than the clamp", () => {
    // Target straight to the right (angle 0) of the ball.
    expect(steerAngle(0.1, 0, 0, 10, 0)).toBeCloseTo(0);
    expect(steerAngle(1, 0, 0, 10, 0)).toBeCloseTo(1 - GUIDE_MAX_NUDGE);
    expect(steerAngle(-1, 0, 0, 10, 0)).toBeCloseTo(-1 + GUIDE_MAX_NUDGE);
    // Across the ±π seam: the target is to the left (π), the ball flies at −3 rad.
    expect(steerAngle(-3, 0, 0, -10, 0)).toBeCloseTo(-3 - Math.abs(signedAngleDelta(-3, Math.PI)));
    // A custom clamp and a partial strength.
    expect(steerAngle(1, 0, 0, 10, 0, 0.5)).toBeCloseTo(0.5);
    expect(steerAngle(1, 0, 0, 10, 0, 1, 0.5)).toBeCloseTo(0.5);
  });

  it("leaves the angle alone when the ball sits on the target", () => {
    expect(steerAngle(0.7, 5, 5, 5, 5)).toBe(0.7);
  });
});

describe("pacing", () => {
  it("expects a linear reveal up to the finish threshold", () => {
    expect(expectedCoverage(0, 30)).toBe(0);
    expect(expectedCoverage(15, 30)).toBeCloseTo(COVERAGE_DONE / 2);
    expect(expectedCoverage(45, 30)).toBeCloseTo(COVERAGE_DONE);
    expect(expectedCoverage(10, 0)).toBe(0);
  });

  it("reports the schedule state with a tolerance", () => {
    expect(paceStatus(0.475, 15, 30)).toBe("onSchedule");
    expect(paceStatus(0.3, 15, 30)).toBe("behind");
    expect(paceStatus(0.7, 15, 30)).toBe("ahead");
    expect(paceStatus(0.44, 15, 30)).toBe("onSchedule");
    expect(paceStatus(0.51, 15, 30)).toBe("onSchedule");
  });

  it("grows the brush when behind, shrinks it when ahead, gently and within its limits", () => {
    const behind = paceBrushScale(1, 0.1, 15, 30);
    expect(behind).toBeGreaterThan(1);
    expect(behind).toBeLessThanOrEqual(1.2);
    const ahead = paceBrushScale(1, 0.9, 15, 30);
    expect(ahead).toBeLessThan(1);
    expect(ahead).toBeGreaterThanOrEqual(0.85);
    expect(paceBrushScale(1, 0.475, 15, 30)).toBeCloseTo(1, 5);
    let scale = 1;
    for (let s = 0; s < 20; s++) scale = paceBrushScale(scale, 0, 25, 30);
    expect(scale).toBe(PACE_MAX);
    scale = 1;
    for (let s = 0; s < 20; s++) scale = paceBrushScale(scale, 0.95, 1, 30);
    expect(scale).toBe(PACE_MIN);
    expect(paceBrushScale(2, 0.1, 10, 0)).toBe(1);
    expect(paceBrushScale(Number.NaN, 0.1, 15, 30)).toBeGreaterThan(1);
  });

  it("paces to the song's first pass or the clip, whichever ends first", () => {
    expect(paintTargetSeconds(0, 0, 30)).toBe(30);
    expect(paintTargetSeconds(20, 0, 30)).toBe(20);
    expect(paintTargetSeconds(180, 0, 30)).toBe(30);
    expect(paintTargetSeconds(20, 12, 30)).toBe(8);
    expect(paintTargetSeconds(20, 19, 30)).toBe(5);
    expect(paintTargetSeconds(20, 25, 30)).toBe(30);
    expect(paintTargetSeconds(0, 0, Number.NaN)).toBe(5);
  });
});

/* ------------------------------------------------------------------ settings */

describe("picture paint settings", () => {
  it("have their defaults in every mode and stay out of the URL", () => {
    for (const mode of MODE_IDS) expect(picturePaintOf(defaultSettings(mode))).toEqual(DEFAULT_PICTURE_PAINT);
    const params = settingsToSearchParams(defaultSettings("paint"));
    for (const key of ["pbr", "pgh", "pbeat", "pbs", "pbp", "pgd", "pps"]) expect(params.has(key)).toBe(false);
  });

  it("round-trip through their short URL keys", () => {
    const s: SimulatorSettings = { ...defaultSettings("paint"), paintBrush: 2.5, paintGhost: 0.3, paintBeatSync: false, paintBeatSource: "bpm", paintBeatPulse: 0.75, paintGuided: false, paintPaceToSong: false };
    const params = settingsToSearchParams(s);
    expect(params.get("pbr")).toBe("2.5");
    expect(params.get("pgh")).toBe("0.3");
    expect(params.get("pbeat")).toBe("0");
    expect(params.get("pbs")).toBe("bpm");
    expect(params.get("pbp")).toBe("0.75");
    expect(params.get("pgd")).toBe("0");
    expect(params.get("pps")).toBe("0");
    expect(settingsFromSearchParams(params)).toEqual(s);
  });

  it("clamp numbers and reject unknown sources from URLs and presets", () => {
    const s = settingsFromSearchParams(new URLSearchParams("mode=paint&pbr=9&pgh=-1&pbp=abc&pbs=drums"));
    expect(s.paintBrush).toBe(PICTURE_PAINT_RANGES.paintBrush.max);
    expect(s.paintGhost).toBe(0);
    expect(s.paintBeatPulse).toBe(DEFAULT_PICTURE_PAINT.paintBeatPulse);
    expect(s.paintBeatSource).toBe("song");
    const p = presetToSettings({ mode: "paint", paintBrush: 0.1, paintGhost: 2, paintBeatSource: "bpm", paintGuided: "yes", paintPaceToSong: false } as unknown as Partial<SimulatorSettings>);
    expect(p.paintBrush).toBe(PICTURE_PAINT_RANGES.paintBrush.min);
    expect(p.paintGhost).toBe(PICTURE_PAINT_RANGES.paintGhost.max);
    expect(p.paintBeatSource).toBe("bpm");
    expect(p.paintGuided).toBe(true);
    expect(p.paintPaceToSong).toBe(false);
    expect(resolvePicturePaintSettings(null)).toEqual(DEFAULT_PICTURE_PAINT);
  });
});

/* ------------------------------------------------------------------ engine behaviour */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.3,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const STEP = 1000 / 60;

function paintEngine(seed: number, options?: Partial<PaintModeOptions>, beat?: Partial<BeatClockConfig>) {
  const engine = new PhysicsEngine({ ...config });
  if (options) engine.setPaintOptions(options);
  if (beat) engine.setPaintBeat(beat);
  engine.setSeed(seed);
  engine.initMode("paint");
  return engine;
}

function run(engine: PhysicsEngine, frames: number) {
  for (let i = 0; i < frames; i++) engine.update(STEP, 0);
}

function positions(engine: PhysicsEngine) {
  return engine.getBalls().map((b) => [b.x, b.y, b.vx, b.vy]);
}

function speed(engine: PhysicsEngine) {
  const b = engine.getBalls()[0];
  return Math.hypot(b.vx, b.vy);
}

/** Picture on, everything else off: the plain brush reveal. */
const PICTURE_ONLY: Partial<PaintModeOptions> = { picture: true, brush: 1, beatSync: false, guided: false, paceToSong: false, targetSec: 0 };

describe("Paint mode without a picture", () => {
  it("is untouched by every picture-paint setting", () => {
    const plain = paintEngine(4242);
    const configured = paintEngine(4242, { picture: false, brush: 3, beatSync: true, beatPulse: 1, guided: true, paceToSong: true, targetSec: 5 }, { source: "bpm", manualBpm: 120 });
    run(plain, 600);
    run(configured, 600);
    expect(positions(configured)).toEqual(positions(plain));
    expect(configured.getPaintCoverage()).toBe(plain.getPaintCoverage());
    expect(configured.getPaintPoints().length).toBe(plain.getPaintPoints().length);
    for (const p of configured.getPaintPoints()) expect(p.r).toBe(8);
    const state = configured.getPaintState();
    expect(state).toMatchObject({ picture: false, beatActive: false, envelope: 1, pulse: 0, paceScale: 1, pace: null, guideTarget: null });
    expect(state.coverage).toBe(plain.getPaintCoverage());
  });

  it("counts coverage incrementally exactly like a full recount", () => {
    const engine = paintEngine(7);
    run(engine, 300);
    const { grid, size } = engine.paintMode.getPaintGrid();
    let painted = 0;
    let inside = 0;
    const c = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        if (dx * dx + dy * dy > c * c) continue;
        inside++;
        painted += grid[y * size + x];
      }
    }
    expect(engine.getPaintCoverage()).toBeCloseTo(painted / inside, 12);
    expect(engine.getPaintCoverage()).toBeGreaterThan(0.02);
  });
});

describe("Paint mode with a picture", () => {
  it("sizes the dabs by the brush and covers the circle faster with a bigger brush", () => {
    const thin = paintEngine(99, PICTURE_ONLY);
    const thick = paintEngine(99, { ...PICTURE_ONLY, brush: 2 });
    run(thin, 300);
    run(thick, 300);
    for (const p of thin.getPaintPoints()) expect(p.r).toBeCloseTo(8);
    for (const p of thick.getPaintPoints()) expect(p.r).toBeCloseTo(16);
    expect(thick.getPaintCoverage()).toBeGreaterThan(thin.getPaintCoverage());
    // The dabs alone do not move the ball: both runs follow the same trajectory.
    expect(positions(thick)).toEqual(positions(thin));
    expect(thick.getPaintState()).toMatchObject({ picture: true, beatActive: false, envelope: 1, pace: null });
  });

  it("applies the brush change to the dabs recorded from then on", () => {
    const engine = paintEngine(5, PICTURE_ONLY);
    run(engine, 60);
    const before = engine.getPaintPoints().length;
    engine.setPaintOptions({ brush: 3 });
    run(engine, 60);
    const points = engine.getPaintPoints();
    expect(points[before - 1].r).toBeCloseTo(8);
    expect(points[points.length - 1].r).toBeCloseTo(24);
  });

  it("restarts with a new generation, an empty trail and zero coverage", () => {
    const engine = paintEngine(11, PICTURE_ONLY);
    run(engine, 120);
    const generation = engine.getPaintState().generation;
    expect(engine.getPaintCoverage()).toBeGreaterThan(0);
    engine.initMode("paint");
    expect(engine.getPaintState().generation).toBe(generation + 1);
    expect(engine.getPaintPoints()).toEqual([]);
    expect(engine.getPaintCoverage()).toBe(0);
  });
});

describe("beat sync", () => {
  it("scales the speed by 1 + pulse × strength on the beat and glides back between beats, deterministically", () => {
    const manual: Partial<BeatClockConfig> = { source: "bpm", manualBpm: 120 };
    const plain = paintEngine(31, PICTURE_ONLY);
    const synced = paintEngine(31, { ...PICTURE_ONLY, beatSync: true, beatPulse: 1 }, manual);
    const twin = paintEngine(31, { ...PICTURE_ONLY, beatSync: true, beatPulse: 1 }, manual);
    run(plain, 1);
    run(synced, 1);
    run(twin, 1);
    // One frame in: the pulse of beat 0 has decayed for 1/60 s of a 0.5 s beat.
    const expected = 1 + Math.exp((-3 * STEP) / 1000 / 0.5);
    const state = synced.getPaintState();
    expect(state).toMatchObject({ beatActive: true, bpm: 120, beatIndex: 0 });
    expect(state.envelope).toBeCloseTo(expected, 6);
    expect(speed(synced) / speed(plain)).toBeCloseTo(expected, 1);
    expect(positions(twin)).toEqual(positions(synced));
    // Half a beat later the kick has mostly faded, the ball glides at nearly its natural speed.
    run(synced, 14);
    expect(synced.getPaintState().envelope).toBeLessThan(1.3);
    expect(synced.getPaintState().pulse).toBeCloseTo(Math.exp(-3 * (15 * STEP) / 1000 / 0.5), 6);
    // The next beat kicks again.
    run(synced, 15);
    expect(synced.getPaintState().beatIndex).toBe(1);
    expect(synced.getPaintState().envelope).toBeGreaterThan(1.9);
  });

  it("undoes its scale when switched off and does nothing without a tempo to follow", () => {
    const plain = paintEngine(31, PICTURE_ONLY);
    const synced = paintEngine(31, { ...PICTURE_ONLY, beatSync: true, beatPulse: 1 }, { source: "bpm", manualBpm: 120 });
    run(plain, 1);
    run(synced, 1);
    synced.setPaintOptions({ beatSync: false });
    run(plain, 1);
    run(synced, 1);
    expect(synced.getPaintState()).toMatchObject({ beatActive: false, envelope: 1, pulse: 0 });
    expect(speed(synced) / speed(plain)).toBeCloseTo(1, 1);
    // Song source without a detected grid: no beat, the natural motion.
    const silent = paintEngine(31, { ...PICTURE_ONLY, beatSync: true, beatPulse: 1 }, { source: "song", grid: null });
    const reference = paintEngine(31, PICTURE_ONLY);
    run(silent, 120);
    run(reference, 120);
    expect(positions(silent)).toEqual(positions(reference));
    expect(silent.getPaintState().beatActive).toBe(false);
  });

  it("follows a song grid through the music start offset", () => {
    const beatTimes: number[] = [];
    for (let t = 0.25; t < 20; t += 0.5) beatTimes.push(t);
    const engine = paintEngine(8, { ...PICTURE_ONLY, beatSync: true, beatPulse: 0.5 }, { source: "song", grid: { bpm: 120, beatTimes, duration: 20 }, offset: 0.25, loop: true });
    run(engine, 1);
    const state = engine.getPaintState();
    expect(state.beatActive).toBe(true);
    expect(state.bpm).toBe(120);
    expect(state.beatIndex).toBe(0);
    expect(state.envelope).toBeCloseTo(1 + 0.5 * Math.exp((-3 * STEP) / 1000 / 0.5), 6);
  });
});

describe("guided coverage", () => {
  it("steers rebounds toward the unrevealed region, deterministically, and finishes the reveal", () => {
    const guided = paintEngine(2024, { ...PICTURE_ONLY, brush: 2, guided: true });
    const twin = paintEngine(2024, { ...PICTURE_ONLY, brush: 2, guided: true });
    const free = paintEngine(2024, { ...PICTURE_ONLY, brush: 2, guided: false });
    run(guided, 240);
    run(twin, 240);
    run(free, 240);
    expect(positions(twin)).toEqual(positions(guided));
    expect(positions(guided)).not.toEqual(positions(free));
    const target = guided.getPaintState().guideTarget;
    expect(target).not.toBeNull();
    // The target lies inside the arena circle.
    const dx = target!.x - config.width / 2;
    const dy = target!.y - config.height / 2;
    expect(Math.hypot(dx, dy)).toBeLessThan(225);
    let frames = 240;
    while (!guided.isSimulationFinished() && frames < 60 * 240) {
      run(guided, 60);
      frames += 60;
    }
    expect(guided.isSimulationFinished()).toBe(true);
    expect(guided.getPaintCoverage()).toBeGreaterThanOrEqual(COVERAGE_DONE);
  });

  it("changes a rebound by at most the 18° clamp", () => {
    // Drive the mode's hook directly: whatever the coverage, the steered angle stays within the clamp.
    const engine = paintEngine(3, { ...PICTURE_ONLY, guided: true });
    run(engine, 120);
    const ball = engine.getBalls()[0];
    for (const angle of [0, 1, 2, 3, -1, -2.5]) {
      const steered = engine.paintMode.adjustRebound(engine.ctx, ball, 0, angle);
      expect(Math.abs(signedAngleDelta(angle, steered))).toBeLessThanOrEqual(GUIDE_MAX_NUDGE + 1e-9);
    }
  });
});

describe("pacing", () => {
  it("grows the brush when the reveal runs behind a short schedule and reports it", () => {
    const engine = paintEngine(17, { ...PICTURE_ONLY, paceToSong: true, targetSec: 5 });
    run(engine, 30);
    expect(engine.getPaintState().paceScale).toBe(1); // the first pacing step comes at one second
    run(engine, 150);
    const state = engine.getPaintState();
    expect(state.paceScale).toBeGreaterThan(1.3);
    expect(state.paceScale).toBeLessThanOrEqual(PACE_MAX);
    expect(state.pace).toBe("behind");
    expect(state.targetSec).toBe(5);
    const last = engine.getPaintPoints()[engine.getPaintPoints().length - 1];
    expect(last.r).toBeCloseTo(8 * state.paceScale, 6);
  });

  it("does nothing without a schedule and is reproducible", () => {
    const a = paintEngine(17, { ...PICTURE_ONLY, paceToSong: true, targetSec: 5 });
    const b = paintEngine(17, { ...PICTURE_ONLY, paceToSong: true, targetSec: 5 });
    const off = paintEngine(17, { ...PICTURE_ONLY, paceToSong: true, targetSec: 0 });
    run(a, 240);
    run(b, 240);
    run(off, 240);
    expect(a.getPaintCoverage()).toBe(b.getPaintCoverage());
    expect(off.getPaintState()).toMatchObject({ paceScale: 1, pace: null, targetSec: 0 });
    expect(a.getPaintCoverage()).toBeGreaterThan(off.getPaintCoverage());
  });
});
