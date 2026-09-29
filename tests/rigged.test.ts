import { afterEach, describe, expect, it, vi } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { DEFAULT_PHYSICS_EXTRAS } from "@/lib/physics/extras";
import {
  DEFAULT_RIGGED,
  ESCAPE_FINISH_MODES,
  RIGGED_RANGES,
  RIG_ESCAPE_MODES,
  RigDirector,
  WINNER_MODES,
  emptyFlight,
  forcedWinnerApplies,
  neverEscapeApplies,
  resolveRiggedConfig,
  rigNeverFinishes,
  riggedConfigOf,
} from "@/lib/physics/rigged";
import { MODE_IDS, TWO_PI, normalizeAngle, type Ball, type CircularWall, type ModeId, type PhysicsConfig } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import {
  ESCAPE_AT_TOLERANCE_SEC,
  availableOutcomes,
  effectiveOutcome,
  isFinderOutcome,
  outcomeClipSec,
  outcomeFigure,
  outcomeHorizonMs,
  outcomeMatches,
  outcomeMiss,
  outcomeSettled,
  survivalSec,
  type FinderOutcome,
  type RunSummary,
} from "@/lib/simulation/outcomes";
import { emptyStats, type BallStats } from "@/lib/physics/ballStats";
import { teamResult } from "@/lib/teams";

/**
 * Rigged outcomes: the finder's outcome predicates on synthetic runs, the director's hard constraints in real seeded
 * runs (never escape, the forced winner) – deterministic, and a no-op when off – and the settings round trips.
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

function engineFor(mode: ModeId, seed: number, patch: Partial<PhysicsConfig> = {}, ballCount?: number): PhysicsEngine {
  return createEngineForSettings({ ...config, wallCount: mode === "shatter" ? 10 : 7, ...patch }, mode, { ...modeSettings, ...(ballCount !== undefined ? { ballCount } : {}) }, seed);
}

/** Steps `frames` frames (stopping at the finish with `untilFinished`), draining the sound queue like the page does. */
function step(engine: PhysicsEngine, frames: number, untilFinished = false): number {
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    if (untilFinished && engine.isSimulationFinished()) return i + 1;
  }
  return frames;
}

/** Positions of every ball, rounded to 1/1000 px, every `every` frames – a fingerprint of the trajectory. */
function trajectory(engine: PhysicsEngine, frames: number, every = 30): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
    if (i % every === 0) out.push(engine.getBalls().flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
  }
  return out;
}

/** The largest distance of a ball from the arena centre, relative to the outermost wall's radius (> 1: outside). */
function outermostReach(engine: PhysicsEngine): number {
  const walls = engine.getCircularWalls();
  const outer = walls.reduce((m, w) => Math.max(m, w.radius), 0);
  const cx = config.width / 2;
  const cy = config.height / 2;
  return engine.getBalls().reduce((m, b) => Math.max(m, (Math.hypot(b.x - cx, b.y - cy) + b.radius) / outer), 0);
}

function stats(bounces: number, walls: number, escapes: number, firstEscapeMs = -1): BallStats {
  return { ...emptyStats(), bounces, walls, escapes, firstEscapeMs };
}

function summary(patch: Partial<RunSummary>): RunSummary {
  return { durationMs: 0, finished: false, firstEscapeMs: -1, teams: [], ...patch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ finder outcomes (synthetic runs) */

describe("finder outcome predicates", () => {
  it("never-escapes: the whole clip without an escape and without an end", () => {
    const outcome: FinderOutcome = { kind: "never-escapes", clipSec: 30 };
    expect(outcomeMatches(outcome, summary({ durationMs: 30_000 }))).toBe(true);
    expect(outcomeMatches(outcome, summary({ durationMs: 1800 * (1000 / 60) }))).toBe(true); // 1800 frames, float sum
    expect(outcomeMatches(outcome, summary({ durationMs: 29_000 }))).toBe(false); // stopped short
    expect(outcomeMatches(outcome, summary({ durationMs: 30_000, firstEscapeMs: 29_900 }))).toBe(false); // escaped at the very end
    expect(outcomeMatches(outcome, summary({ durationMs: 30_000, finished: true }))).toBe(false); // ended (Target done…) before the clip did
    expect(outcomeMiss(outcome, summary({ durationMs: 12_000, firstEscapeMs: 12_000 }))).toBeCloseTo(18);
    expect(outcomeMiss(outcome, summary({ durationMs: 30_000 }))).toBe(0);
    expect(survivalSec(summary({ durationMs: 30_000, firstEscapeMs: 7_500 }))).toBe(7.5);
    expect(outcomeFigure(outcome, summary({ durationMs: 9_000, firstEscapeMs: 9_000 }))).toBe(9);
  });

  it("escapes-at: the first escape within ±0.5 s of the target", () => {
    const outcome: FinderOutcome = { kind: "escapes-at", clipSec: 30, atSec: 12 };
    expect(ESCAPE_AT_TOLERANCE_SEC).toBe(0.5);
    expect(RIGGED_RANGES.findEscapeAt.max + 3).toBeLessThanOrEqual(RANGES.recordingDuration.max);
    expect(outcomeMatches(outcome, summary({ firstEscapeMs: 12_000 }))).toBe(true);
    expect(outcomeMatches(outcome, summary({ firstEscapeMs: 11_500 }))).toBe(true);
    expect(outcomeMatches(outcome, summary({ firstEscapeMs: 12_500 }))).toBe(true);
    expect(outcomeMatches(outcome, summary({ firstEscapeMs: 12_600 }))).toBe(false);
    expect(outcomeMatches(outcome, summary({ firstEscapeMs: 11_300 }))).toBe(false);
    expect(outcomeMatches(outcome, summary({ firstEscapeMs: -1, durationMs: 60_000 }))).toBe(false);
    expect(outcomeMatches({ ...outcome, toleranceSec: 2 }, summary({ firstEscapeMs: 13_900 }))).toBe(true);
    expect(outcomeMiss(outcome, summary({ firstEscapeMs: 14_000 }))).toBeCloseTo(2);
    expect(outcomeMiss(outcome, summary({ firstEscapeMs: -1 }))).toBe(Infinity);
    expect(outcomeFigure(outcome, summary({ firstEscapeMs: 14_250 }))).toBeCloseTo(14.25);
  });

  it("winner: the chosen team alone on top of the scoreboard (escapes, walls, bounces, the earlier first escape)", () => {
    const outcome: FinderOutcome = { kind: "winner", clipSec: 60, team: 1 };
    // Team 1 escaped first and broke the most walls.
    expect(outcomeMatches(outcome, summary({ finished: true, teams: [stats(40, 0, 1, 20_000), stats(35, 7, 1, 15_000), stats(38, 0, 1, 21_000)] }))).toBe(true);
    // Level on escapes and walls: the bounces decide – team 0.
    expect(outcomeMatches(outcome, summary({ teams: [stats(50, 2, 0), stats(40, 2, 0)] }))).toBe(false);
    // A dead heat is no win.
    expect(outcomeMatches(outcome, summary({ teams: [stats(40, 2, 0), stats(40, 2, 0)] }))).toBe(false);
    // Out of range, or a single ball: nothing to win.
    expect(outcomeMatches({ ...outcome, team: 5 }, summary({ teams: [stats(1, 0, 0), stats(0, 0, 0)] }))).toBe(false);
    expect(outcomeMatches({ ...outcome, team: 0 }, summary({ teams: [stats(9, 9, 1)] }))).toBe(false);
    expect(outcomeMiss(outcome, summary({ teams: [stats(1, 0, 0), stats(2, 0, 0)] }))).toBe(0);
    expect(outcomeMiss(outcome, summary({ teams: [stats(3, 0, 0), stats(2, 0, 0)] }))).toBe(1);
  });

  it("settle as soon as the outcome is decided, and follow a run no longer than needed", () => {
    const never: FinderOutcome = { kind: "never-escapes", clipSec: 30 };
    expect(outcomeSettled(never, 10_000, -1, false)).toBe(false);
    expect(outcomeSettled(never, 10_000, 9_000, false)).toBe(true); // escaped: failed
    expect(outcomeSettled(never, 10_000, -1, true)).toBe(true); // ended: failed
    expect(outcomeSettled(never, 30_000, -1, false)).toBe(true); // survived
    expect(outcomeHorizonMs(never, 999_000)).toBe(30_000);

    const at: FinderOutcome = { kind: "escapes-at", clipSec: 30, atSec: 12 };
    expect(outcomeSettled(at, 5_000, 4_000, false)).toBe(true); // too early
    expect(outcomeSettled(at, 12_600, -1, false)).toBe(true); // too late already
    expect(outcomeSettled(at, 12_000, -1, false)).toBe(false);
    expect(outcomeSettled(at, 13_000, 12_100, false)).toBe(false); // a match: followed a moment longer
    expect(outcomeSettled(at, 17_200, 12_100, false)).toBe(true);
    expect(outcomeHorizonMs(at, 1_000)).toBe(17_500);

    const win: FinderOutcome = { kind: "winner", clipSec: 45, team: 0 };
    expect(outcomeSettled(win, 44_000, 3_000, false)).toBe(false); // an escape settles nothing
    expect(outcomeSettled(win, 45_000, -1, false)).toBe(true);
    expect(outcomeSettled(win, 20_000, -1, true)).toBe(true);
    expect(outcomeHorizonMs(win, 1_000)).toBe(45_000);
  });

  it("give the clip to record: the clip for never-escapes and a run that goes on, the run itself when it ended", () => {
    expect(outcomeClipSec({ kind: "never-escapes", clipSec: 40 }, summary({ durationMs: 40_000 }))).toBe(40);
    expect(outcomeClipSec({ kind: "escapes-at", clipSec: 30, atSec: 8 }, summary({ durationMs: 10_500, finished: true, firstEscapeMs: 8_100 }))).toBe(10.5);
    expect(outcomeClipSec({ kind: "escapes-at", clipSec: 30, atSec: 8 }, summary({ durationMs: 13_000, firstEscapeMs: 8_100 }))).toBe(30);
    expect(outcomeClipSec({ kind: "winner", clipSec: 60, team: 0 }, summary({ durationMs: 33_000, finished: true }))).toBe(33);
    expect(outcomeClipSec({ kind: "winner", clipSec: 60, team: 0 }, summary({ durationMs: 60_000 }))).toBe(60);
  });

  it("offer the outcomes a mode can have", () => {
    const ctx = { endless: false, neverEscape: false, ballCount: 1 };
    expect(availableOutcomes("classic", ctx)).toEqual(["duration", "never-escapes", "escapes-at"]);
    expect(availableOutcomes("classic", { ...ctx, ballCount: 3 })).toEqual(["duration", "never-escapes", "escapes-at", "winner"]);
    // Never escape rules out a first escape and (the page says: the run never ends) the run length.
    expect(availableOutcomes("classic", { endless: true, neverEscape: true, ballCount: 3 })).toEqual(["never-escapes", "winner"]);
    expect(availableOutcomes("multiply", { ...ctx, endless: true })).toEqual(["never-escapes", "escapes-at"]);
    expect(availableOutcomes("lines", { endless: true, neverEscape: false, ballCount: 2 })).toEqual(["winner"]);
    expect(availableOutcomes("drop", ctx)).toEqual(["duration"]);
    expect(availableOutcomes("box", { ...ctx, endless: true })).toEqual([]);
    expect(availableOutcomes("target", { ...ctx, neverEscape: true })).toEqual(["duration"]);
    expect(effectiveOutcome("winner", ["duration", "never-escapes"])).toBe("duration");
    expect(effectiveOutcome("escapes-at", ["duration", "never-escapes", "escapes-at"])).toBe("escapes-at");
    expect(effectiveOutcome("duration", [])).toBeNull();
    expect(isFinderOutcome("never-escapes")).toBe(true);
    expect(isFinderOutcome("forever")).toBe(false);
  });
});

/* ------------------------------------------------------------------ the rig on its own */

describe("RigDirector", () => {
  const walls: CircularWall[] = [{ radius: 200, gaps: [{ startAngle: -0.2, endAngle: 0.2 }] }];
  const rotations = [0];
  const ball = (patch: Partial<Ball> = {}): Ball => ({ id: 0, x: 400, y: 300, vx: 0, vy: 0, radius: 8, color: "#fff", trail: [], trailIndex: 0, spin: 0, angle: 0, ...patch });
  const still: PhysicsConfig = { ...config, gravity: 0, rotationSpeed: 0, neverEscape: true };

  function rig(cfg: PhysicsConfig = still, mode: ModeId = "classic", broken = new Set<number>()): RigDirector {
    const r = new RigDirector();
    r.beginStep(mode, cfg, DEFAULT_PHYSICS_EXTRAS, walls, rotations, broken, 0, 0, 1, true, 0);
    return r;
  }

  it("predicts a straight flight to the wall and flags a closed gap", () => {
    const r = rig();
    const f = r.fly(ball(), 0, 400, emptyFlight());
    expect(f.wall).toBe(0);
    expect(f.closedGap).toBe(true); // straight into the gap at angle 0, which never escape keeps closed
    expect(f.timeSec).toBeCloseTo((200 - 8 - 2) / 400, 1);
    const g = r.fly(ball(), Math.PI, 400, emptyFlight());
    expect(g.closedGap).toBe(false);
    expect(normalizeAngle(g.angle)).toBeCloseTo(Math.PI, 1);
  });

  it("turns a rebound headed into a closed gap to the nearest angle that misses it – deterministically", () => {
    const r = rig();
    // A ball just off the wall at the far side, rebounding straight across into the gap.
    const b = ball({ x: 400 - 189, y: 300 });
    const steered = r.steer(b, 0, true, 0, 400);
    expect(steered).not.toBe(0);
    expect(r.fly(b, steered, 400, emptyFlight()).closedGap).toBe(false);
    expect(Math.abs(steered)).toBeLessThan((20 * Math.PI) / 180); // just past the gap's edge: a near miss
    expect(rig().steer(b, 0, true, 0, 400)).toBe(steered);
    expect(r.getView().steers).toBe(1);
    // A rebound that misses the gap anyway is left alone.
    expect(r.steer(b, 0, true, 0.6, 400)).toBe(0.6);
  });

  it("bends a flight headed for a closed gap a little every step (mid-flight guidance)", () => {
    const r = rig();
    const b = ball({ x: 500, y: 300, vx: 400, vy: 0 });
    r.guide(b);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(400, 6);
    expect(Math.atan2(b.vy, b.vx)).not.toBe(0);
    expect(r.getView().guides).toBe(1);
    const away = ball({ x: 300, y: 300, vx: -400, vy: 0 }); // heading for the solid far side
    r.guide(away);
    expect(away.vy).toBe(0);
  });

  it("closes the last barrier to every ball with never escape, and only in the escape modes", () => {
    const r = rig();
    expect(r.on).toBe(true);
    expect(r.closes({ team: undefined }, 0)).toBe(true);
    expect(rig({ ...still, neverEscape: false }).on).toBe(false);
    expect(rig(still, "lines").on).toBe(false);
    expect(rig(still, "target").on).toBe(false);
    for (const mode of MODE_IDS) expect(neverEscapeApplies(mode)).toBe(RIG_ESCAPE_MODES.includes(mode));
  });

  it("locks the walls to the other teams until the chosen one passes them, and for good in Multiply", () => {
    const ringWalls: CircularWall[] = [
      { radius: 100, gaps: [{ startAngle: 0, endAngle: 0.4 }] },
      { radius: 200, gaps: [{ startAngle: 1, endAngle: 1.4 }] },
    ];
    const cfg: PhysicsConfig = { ...config, ballCount: 3, forcedWinner: 2 };
    const r = new RigDirector();
    r.beginStep("classic", cfg, DEFAULT_PHYSICS_EXTRAS, ringWalls, [0, 0], new Set(), 400, 0, 1, true, 0);
    expect(r.winnerTeam()).toBe(2);
    expect(r.closes({ team: 2 }, 0)).toBe(false);
    expect(r.closes({ team: 0 }, 0)).toBe(true);
    expect(r.closes({ team: 1 }, 1)).toBe(true);
    r.notePass({ team: 2 }, 0);
    expect(r.closes({ team: 0 }, 0)).toBe(false);
    expect(r.closes({ team: 0 }, 1)).toBe(true);
    r.noteEscape({ team: 2 }, 5_000);
    expect(r.closes({ team: 0 }, 1)).toBe(false);
    expect(r.getFirstEscapeMs()).toBe(5_000);
    r.reset();
    expect(r.closes({ team: 0 }, 0)).toBe(true);
    expect(r.getFirstEscapeMs()).toBe(-1);
    // Shatter: only the way out is locked. Multiply: locked for good, even after the chosen team escaped.
    r.beginStep("shatter", cfg, DEFAULT_PHYSICS_EXTRAS, ringWalls, [0, 0], new Set(), 400, 0, 1, true, 0);
    expect(r.closes({ team: 0 }, 0)).toBe(false);
    expect(r.closes({ team: 0 }, 1)).toBe(true);
    r.beginStep("multiply", cfg, DEFAULT_PHYSICS_EXTRAS, [ringWalls[1]], [0], new Set(), 400, 0, 1, true, 0);
    r.noteEscape({ team: 2 }, 1_000);
    expect(r.closes({ team: 0 }, 0)).toBe(true);
    // Not a race: a single ball, a team that does not play, a mode without escapes.
    expect(forcedWinnerApplies("classic", 1, 0)).toBe(false);
    expect(forcedWinnerApplies("classic", 3, 3)).toBe(false);
    expect(forcedWinnerApplies("lines", 3, 1)).toBe(false);
    expect(forcedWinnerApplies("shatter", 2, 1)).toBe(true);
    expect(WINNER_MODES).toEqual(["classic", "multiply", "shatter", "colorMatch"]);
  });
});

/* ------------------------------------------------------------------ never escape in the engine */

describe("never escape", () => {
  it("keeps every ball inside the outer wall in every escape mode – no escape, no finish", { timeout: 120_000 }, () => {
    for (const mode of RIG_ESCAPE_MODES) {
      for (const seed of [3, 11]) {
        const engine = engineFor(mode, seed, { neverEscape: true });
        let reach = 0;
        for (let s = 0; s < 90; s++) {
          step(engine, 60);
          reach = Math.max(reach, outermostReach(engine));
        }
        expect(engine.getFirstEscapeMs(), `${mode} seed ${seed}`).toBe(-1);
        expect(engine.isSimulationFinished(), `${mode} seed ${seed}`).toBe(false);
        expect(reach, `${mode} seed ${seed}`).toBeLessThan(1.05);
        expect(engine.getRigView().neverEscape).toBe(true);
      }
    }
  });

  it("is deterministic: the same seed replays the same rigged run", { timeout: 60_000 }, () => {
    for (const mode of ["classic", "portal", "shatter", "accumulation"] as ModeId[]) {
      const a = engineFor(mode, 42, { neverEscape: true });
      const b = engineFor(mode, 42, { neverEscape: true });
      expect(trajectory(a, 60 * 60), mode).toEqual(trajectory(b, 60 * 60));
      expect({ ...a.getRigView() }).toEqual({ ...b.getRigView() });
      expect([...a.getBrokenWalls()]).toEqual([...b.getBrokenWalls()]);
    }
  });

  it("steers instead of sealing: the rebounds and bends do the work, a refused gap pass stays rare", { timeout: 60_000 }, () => {
    let steers = 0;
    let seals = 0;
    for (const seed of [1, 2, 3, 4]) {
      const engine = engineFor("classic", seed, { neverEscape: true, wallCount: 3 });
      step(engine, 60 * 90);
      const view = engine.getRigView();
      steers += view.steers + view.guides;
      seals += view.seals;
    }
    expect(steers).toBeGreaterThan(0);
    expect(seals).toBeLessThanOrEqual(Math.max(2, steers / 10));
  });

  it("changes nothing where balls cannot escape, and nothing at all while off", { timeout: 60_000 }, () => {
    for (const mode of ["lines", "target", "drop", "grow"] as ModeId[]) {
      expect(trajectory(engineFor(mode, 9, { neverEscape: true }), 600), mode).toEqual(trajectory(engineFor(mode, 9), 600));
    }
    for (const mode of ["classic", "shatter", "colorMatch"] as ModeId[]) {
      expect(trajectory(engineFor(mode, 9, { neverEscape: false, forcedWinner: -1 }), 1200), mode).toEqual(trajectory(engineFor(mode, 9), 1200));
    }
  });

  it("holds against a ball whose damage smashes rings: the inner rings go, the barrier stays", { timeout: 60_000 }, () => {
    const engine = engineFor("classic", 5, { neverEscape: true, wallSmashThreshold: 4 });
    const ball = engine.getBalls()[0];
    engine.applyBallMultiplier(ball, "damage", 8);
    step(engine, 60 * 30);
    const walls = engine.getCircularWalls();
    expect(engine.getBrokenWalls().has(walls.length - 1)).toBe(false);
    expect(engine.getFirstEscapeMs()).toBe(-1);
    expect(engine.getBrokenWalls().size).toBeGreaterThan(0);
  });

  it("puts back a ball that something pushed across the closed wall (the backstop), and leaves a ball that was already out", () => {
    const engine = engineFor("classic", 12, { neverEscape: true, wallCount: 3 });
    step(engine, 30);
    const walls = engine.getCircularWalls();
    const outer = walls[walls.length - 1].radius;
    const cx = config.width / 2;
    const cy = config.height / 2;
    // A glitch: the ball's centre just across the barrier, flying out.
    const ball = engine.getBalls()[0];
    ball.x = cx + outer + 1;
    ball.y = cy;
    ball.vx = 400;
    ball.vy = 0;
    const seals = engine.getRigView().seals;
    step(engine, 1);
    expect(Math.hypot(ball.x - cx, ball.y - cy)).toBeLessThan(outer);
    expect(ball.vx).toBeLessThan(0);
    expect(engine.getRigView().seals).toBeGreaterThan(seals);
    step(engine, 60 * 5);
    expect(engine.getFirstEscapeMs()).toBe(-1);
    // Switched on after a ball got out: that ball is not dragged back in.
    const late = engineFor("classic", 12, { wallCount: 3 });
    step(late, 30);
    const free = late.getBalls()[0];
    free.x = cx + outer + 60;
    free.y = cy;
    free.vx = 400;
    free.vy = 0;
    late.setConfig({ neverEscape: true });
    step(late, 5);
    expect(Math.hypot(free.x - cx, free.y - cy)).toBeGreaterThan(outer + 60);
  });

  it("keeps Shatter's outer wall and Color Match's last segment whole", { timeout: 60_000 }, () => {
    const shatter = engineFor("shatter", 7, { neverEscape: true });
    step(shatter, 60 * 60);
    const outer = shatter.getShatterSegments()[shatter.getCircularWalls().length - 1];
    expect(outer.every((s) => s.hp > 0)).toBe(true);
    const match = engineFor("colorMatch", 7, { neverEscape: true });
    step(match, 60 * 120);
    const { broken, total } = match.getColorMatchProgress();
    expect(broken).toBeLessThan(total);
    expect(match.hasColorMatchEscaped()).toBe(false);
  });
});

/* ------------------------------------------------------------------ forced winner in the engine */

describe("forced winner", () => {
  function race(mode: ModeId, seed: number, team: number, balls = 3, maxSec = 180) {
    const engine = engineFor(mode, seed, { ballCount: balls, forcedWinner: team }, balls);
    step(engine, 60 * maxSec, true);
    return engine;
  }

  it("makes the chosen team win Classic: it breaks every wall and escapes first", { timeout: 60_000 }, () => {
    for (const seed of [1, 2]) {
      const engine = race("classic", seed, 1);
      expect(engine.isSimulationFinished()).toBe(true);
      const teams = engine.getTeamStats().slice(0, 3);
      const result = teamResult(teams, 3);
      expect(result.tie).toBe(false);
      expect(result.winner).toBe(1);
      expect(teams[1].walls).toBe(engine.getCircularWalls().length);
      const firsts = teams.map((t) => (t.firstEscapeMs < 0 ? Infinity : t.firstEscapeMs));
      expect(Math.min(...firsts)).toBe(firsts[1]);
    }
  });

  it("makes the chosen team win Shatter and Color Match (the first escape ends the run)", { timeout: 60_000 }, () => {
    const shatter = race("shatter", 4, 2);
    expect(shatter.isSimulationFinished()).toBe(true);
    expect(teamResult(shatter.getTeamStats(), 3).winner).toBe(2);
    const match = race("colorMatch", 4, 0, 2, 240);
    expect(match.isSimulationFinished()).toBe(true);
    expect(teamResult(match.getTeamStats(), 2).winner).toBe(0);
  });

  it("keeps the other teams in for good in Multiply", { timeout: 60_000 }, () => {
    const engine = engineFor("multiply", 6, { ballCount: 3, forcedWinner: 2, gapSize: 0.3 }, 3);
    step(engine, 60 * 15);
    const teams = engine.getTeamStats();
    expect(teams[0].escapes).toBe(0);
    expect(teams[1].escapes).toBe(0);
    expect(teams[2].escapes).toBeGreaterThan(0);
  });

  it("is deterministic, and inactive without a race to win", { timeout: 60_000 }, () => {
    const a = engineFor("classic", 8, { ballCount: 3, forcedWinner: 0 }, 3);
    const b = engineFor("classic", 8, { ballCount: 3, forcedWinner: 0 }, 3);
    expect(trajectory(a, 60 * 40)).toEqual(trajectory(b, 60 * 40));
    // One ball, or a team that does not play: the plain run.
    expect(trajectory(engineFor("classic", 8, { forcedWinner: 0 }), 900)).toEqual(trajectory(engineFor("classic", 8), 900));
    expect(trajectory(engineFor("classic", 8, { ballCount: 2, forcedWinner: 4 }, 2), 900)).toEqual(trajectory(engineFor("classic", 8, { ballCount: 2 }, 2), 900));
    expect(engineFor("classic", 8, { ballCount: 2, forcedWinner: 4 }, 2).getRigView().winner).toBe(-1);
  });
});

/* ------------------------------------------------------------------ the finder with outcomes */

describe("Find Simulation outcomes", () => {
  const request = (patch: Partial<FinderRequest>): FinderRequest => ({
    targetDurationSec: 30,
    toleranceSec: 0.5,
    maxSeeds: 40,
    maxSimTimeSec: 60,
    physicsConfig: config,
    mode: "classic",
    modeSettings,
    ...patch,
  });

  function withFrames<T>(fn: () => Promise<T>): Promise<T> {
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    return fn().finally(() => {
      globalThis.requestAnimationFrame = raf;
    });
  }

  it("sums a seeded run up the same way twice, and never escape makes a clip without an escape", { timeout: 60_000 }, () => {
    const outcome: FinderOutcome = { kind: "never-escapes", clipSec: 20 };
    const rigged = request({ physicsConfig: { ...config, neverEscape: true } });
    const a = simulateOutcomeRun(77, rigged, outcome);
    expect(simulateOutcomeRun(77, rigged, outcome)).toEqual(a);
    expect(outcomeMatches(outcome, a)).toBe(true);
    expect(a.durationMs).toBeGreaterThanOrEqual(20_000 - 1);
  });

  it("finds a never-escapes run at once with never escape on, and a won run with the forced winner", { timeout: 60_000 }, async () => {
    const found = await withFrames(() => findSimulation(request({ physicsConfig: { ...config, neverEscape: true }, outcome: { kind: "never-escapes", clipSec: 30 } }), () => undefined));
    expect(found.found).toBe(true);
    expect(found.seedsTested).toBe(1);
    expect(found.outcome).toBe("never-escapes");
    expect(found.duration).toBe(30);
    expect(found.finished).toBe(false);

    const won = await withFrames(() =>
      findSimulation(request({ physicsConfig: { ...config, ballCount: 3, forcedWinner: 2 }, modeSettings: { ...modeSettings, ballCount: 3 }, outcome: { kind: "winner", clipSec: 120, team: 2 } }), () => undefined),
    );
    expect(won.found).toBe(true);
    expect(won.seedsTested).toBe(1);
    expect(won.finished).toBe(true);
    expect(won.duration).toBeGreaterThan(0);
  });

  it("searches for a first escape at a chosen second, seeds in the finder's order", { timeout: 120_000 }, async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234_567);
    let progress = 0;
    const result = await withFrames(() => findSimulation(request({ mode: "multiply", maxSeeds: 300, outcome: { kind: "escapes-at", clipSec: 30, atSec: 3 } }), () => progress++));
    expect(result.outcome).toBe("escapes-at");
    // The seeds come in the finder's order from a (mocked) clock, so the search is repeatable: a few seeds suffice.
    expect(result.found).toBe(true);
    expect(result.seedsTested).toBeLessThan(300);
    expect(Math.abs((result.escapeAt ?? -99) - 3)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(result.duration).toBe(30); // Multiply goes on: the clip is recorded as set
    expect(result.finished).toBe(false);
    // The found seed replays the same first escape.
    const again = simulateOutcomeRun(result.seed, request({ mode: "multiply" }), { kind: "escapes-at", clipSec: 30, atSec: 3 });
    expect(again.firstEscapeMs / 1000).toBeCloseTo(result.escapeAt ?? -1, 9);
    expect(progress).toBeGreaterThanOrEqual(0);
  });

  it("says a rigged escape mode never ends instead of searching for its length", async () => {
    expect(rigNeverFinishes("classic", { neverEscape: true })).toBe(true);
    expect(rigNeverFinishes("multiply", { neverEscape: true })).toBe(false); // endless anyway
    expect(rigNeverFinishes("target", { neverEscape: true })).toBe(false);
    for (const mode of ESCAPE_FINISH_MODES) expect(RIG_ESCAPE_MODES).toContain(mode);
    const result = await findSimulation(request({ physicsConfig: { ...config, neverEscape: true } }), () => undefined);
    expect(result).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
  });
});

/* ------------------------------------------------------------------ settings */

describe("rigged settings", () => {
  it("are off by default in every mode and stay out of default links", () => {
    for (const mode of MODE_IDS) expect(riggedConfigOf(defaultSettings(mode))).toEqual(DEFAULT_RIGGED);
    const params = settingsToSearchParams(defaultSettings("classic"));
    expect(params.has("ne")).toBe(false);
    expect(params.has("fw")).toBe(false);
    expect(RANGES.forcedWinner).toEqual(RIGGED_RANGES.forcedWinner);
    expect(RANGES.findEscapeAt).toEqual(RIGGED_RANGES.findEscapeAt);
  });

  it("round-trip through the URL (ne, fw) and validate what comes back", () => {
    const s = { ...defaultSettings("classic"), neverEscape: true, forcedWinner: 2 };
    const params = settingsToSearchParams(s);
    expect(params.get("ne")).toBe("1");
    expect(params.get("fw")).toBe("2");
    const back = settingsFromSearchParams(params);
    expect(back.neverEscape).toBe(true);
    expect(back.forcedWinner).toBe(2);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&fw=9")).forcedWinner).toBe(-1);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&fw=1.5")).forcedWinner).toBe(-1);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&ne=yes")).neverEscape).toBe(false);
  });

  it("survive presets, bad values falling back to off", () => {
    expect(riggedConfigOf(presetToSettings({ mode: "shatter", neverEscape: true, forcedWinner: 1 }))).toEqual({ neverEscape: true, forcedWinner: 1 });
    expect(riggedConfigOf(presetToSettings({ mode: "classic", neverEscape: "yes" as unknown as boolean, forcedWinner: 42 }))).toEqual(DEFAULT_RIGGED);
    expect(riggedConfigOf(presetToSettings({ mode: "classic" }))).toEqual(DEFAULT_RIGGED);
    expect(resolveRiggedConfig({ neverEscape: true, forcedWinner: -3 })).toEqual({ neverEscape: true, forcedWinner: -1 });
    expect(resolveRiggedConfig(undefined)).toEqual(DEFAULT_RIGGED);
  });

  it("the ghost flight's angles stay normalised", () => {
    expect(normalizeAngle(-0.1)).toBeCloseTo(TWO_PI - 0.1);
  });
});
