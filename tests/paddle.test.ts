import { describe, expect, it } from "vitest";
import {
  APEX_CENTRE,
  APEX_EDGE,
  DEFAULT_PADDLE_SETTINGS,
  GAME_OVER_HOLD_SEC,
  MAX_TEMPO,
  PADDLE_GRAVITY,
  PADDLE_RANGES,
  PD_ASPECT,
  PD_CEILING,
  PD_PLATFORM,
  PLATFORM_VMAX,
  SLOW_PLATFORM,
  buildPaddleField,
  controllerTopSpeed,
  defaultPaddleFields,
  MAX_AIM_OFFSET,
  SEND_VX,
  foldBetween,
  launchOf,
  paddleBallRadius,
  paddleNeverFinishes,
  paddleSettingsOf,
  paddleTempo,
  planCatch,
  platformVelocity,
  predictLanding,
  resolvePaddleFields,
  type PaddleSettings,
} from "@/lib/physics/modes/paddle";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { frequencyToMidi } from "@/lib/audio/scales";
import { rhythmDegreeMidi } from "@/lib/physics/modes/jdmRhythm";

/**
 * Paddle Keep-Up (feature jdm-rhythm-runner): the flight predictor, the catch controller (skill 1 never misses; below it
 * the misses come from the seed), the launch, the settings, whole games in the engine (sounds, lives, game over, speed-up,
 * manual input, determinism) and the finder's fast path.
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

function engineFor(pd: Partial<PaddleSettings> = {}, seed = 12345, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "paddle", { ...modeSettings, paddle: pd }, seed);
}

interface GameLog {
  hitMs: number[];
  missMs: number[];
  sounds: { atMs: number; event: SoundEvent }[];
  finishedMs: number;
  maxY: number;
  minX: number;
  maxX: number;
  minY: number;
}

function play(engine: ReturnType<typeof engineFor>, maxMs = 120_000, beforeStep?: (ms: number) => void): GameLog {
  const log: GameLog = { hitMs: [], missMs: [], sounds: [], finishedMs: -1, maxY: -Infinity, minX: Infinity, maxX: -Infinity, minY: Infinity };
  const view = engine.getPaddleView();
  let hits = 0;
  let misses = 0;
  for (let t = 0; t < maxMs; t += STEP) {
    beforeStep?.(engine.getElapsedMs());
    engine.update(STEP, 0);
    const ms = engine.getElapsedMs();
    if (view.hits !== hits) {
      hits = view.hits;
      log.hitMs.push(ms);
    }
    if (view.misses !== misses) {
      misses = view.misses;
      log.missMs.push(ms);
    }
    if (view.inPlay && view.phase === "flight") {
      log.minX = Math.min(log.minX, view.bx);
      log.maxX = Math.max(log.maxX, view.bx);
      log.minY = Math.min(log.minY, view.by);
      log.maxY = Math.max(log.maxY, view.by);
    }
    for (const event of engine.consumeSoundEvents()) log.sounds.push({ atMs: ms, event });
    if (engine.isSimulationFinished()) {
      log.finishedMs = ms;
      break;
    }
  }
  return log;
}

/* ------------------------------------------------------------------ flight and controller maths */

describe("flight predictor", () => {
  it("folds a straight line between two walls like an elastic bounce", () => {
    expect(foldBetween(0.3, 0, 1)).toBeCloseTo(0.3, 12);
    expect(foldBetween(1.3, 0, 1)).toBeCloseTo(0.7, 12);
    expect(foldBetween(2.3, 0, 1)).toBeCloseTo(0.3, 12);
    expect(foldBetween(-0.3, 0, 1)).toBeCloseTo(0.3, 12);
    expect(foldBetween(-1.3, 0, 1)).toBeCloseTo(0.7, 12);
    expect(foldBetween(5, 2, 2)).toBe(2);
  });

  it("predicts the landing – time, place and sideways direction – of a fine brute-force integration, ceiling bounce and walls included", () => {
    const r = paddleBallRadius(8);
    const g = PADDLE_GRAVITY;
    const cases = [
      { x: 0.3, y: PD_PLATFORM - r, vx: 0.5, vy: -1.6 },
      { x: 0.05, y: PD_PLATFORM - r, vx: -0.8, vy: -2.1 },
      { x: 0.5, y: PD_CEILING + 0.1, vx: 1.7, vy: 0 },
      { x: 0.31, y: PD_PLATFORM - r, vx: 0.2, vy: -2.4 },
    ];
    for (const c of cases) {
      const p = predictLanding(c.x, c.y, c.vx, c.vy, g, r);
      // Brute force: tiny steps, reflect at the walls and the ceiling.
      let { x, y, vx, vy } = c;
      let t = 0;
      let ceiling = false;
      const dt = 1e-5;
      while (t < 10) {
        x += vx * dt;
        y += vy * dt + 0.5 * g * dt * dt;
        vy += g * dt;
        t += dt;
        if (x > PD_ASPECT - r) {
          x = 2 * (PD_ASPECT - r) - x;
          vx = -vx;
        } else if (x < r) {
          x = 2 * r - x;
          vx = -vx;
        }
        if (y < PD_CEILING + r && vy < 0) {
          y = 2 * (PD_CEILING + r) - y;
          vy = -vy;
          ceiling = true;
        }
        if (y >= PD_PLATFORM - r && vy > 0 && t > 1e-3) break;
      }
      expect(p.t).toBeCloseTo(t, 3);
      expect(p.x).toBeCloseTo(x, 3);
      expect(Math.sign(p.vx)).toBe(Math.sign(vx));
      expect(p.ceiling).toBe(ceiling);
    }
  });
});

describe("catch controller", () => {
  const r = paddleBallRadius(8);
  const hw = (DEFAULT_PADDLE_SETTINGS.width * PD_ASPECT) / 2;

  it("skill 1 heads straight for the landing, placed for the off-centre hit that sends the ball off at the sideways speed it drew", () => {
    const landing = predictLanding(0.25, PD_PLATFORM - r, 0.1, -1.8, PADDLE_GRAVITY, r);
    for (const [u1, u2, u3, u4] of [
      [0, 0, 0, 0.5],
      [0.99, 0.99, 0.99, 0.2],
      [0.3, 0.7, 0.5, 0.75],
      [0.5, 0.5, 0.5, 0.999],
    ]) {
      const plan = planCatch(landing, 0.25, 0.1, r, 2, 1, hw, u1, u2, u3, u4, 0.6, 1.1);
      expect(plan.timingError).toBe(0);
      expect(plan.moveAt).toBe(2);
      expect(plan.landX).toBe(landing.x);
      expect(plan.landSec).toBeCloseTo(2 + landing.t, 12);
      expect(plan.sendVx).toBeCloseTo((2 * u4 - 1) * SEND_VX * 1.1, 12);
      // The ball lands `aimOffset` half-widths off the platform's centre, the hit that sends it off at `sendVx` (unless clamped).
      expect((landing.x - plan.targetX) / hw).toBeCloseTo(plan.aimOffset, 9);
      expect(Math.abs(plan.aimOffset)).toBeLessThanOrEqual(MAX_AIM_OFFSET);
      const sent = launchOf(plan.aimOffset, landing.vx, 0, 0.6, PADDLE_GRAVITY, 1.1, r).vx;
      if (Math.abs(plan.aimOffset) < MAX_AIM_OFFSET) expect(sent).toBeCloseTo(plan.sendVx, 9);
      else expect(Math.abs(sent)).toBeLessThan(Math.abs(plan.sendVx) + 1e-9);
    }
    // Without spin the platform cannot steer: it aims for the centre (the highest launch).
    expect(planCatch(landing, 0.25, 0.1, r, 0, 1, hw, 0.5, 0.5, 0.5, 0.9, 0, 1).aimOffset).toBe(0);
  });

  it("below skill 1 it plans late or early and aims off by the draws, scaled by (1 − skill); the same draws give the same plan", () => {
    const landing = predictLanding(0.2, PD_PLATFORM - r, 0.6, -1.9, PADDLE_GRAVITY, r);
    const late = planCatch(landing, 0.2, 0.6, r, 0, 0.5, hw, 0.9, 0.5, 0.2);
    const early = planCatch(landing, 0.2, 0.6, r, 0, 0.5, hw, 0.1, 0.5, 0.2);
    expect(late.timingError).toBeGreaterThan(0);
    expect(early.timingError).toBeLessThan(0);
    expect(late.moveAt).toBeGreaterThan(0);
    expect(planCatch(landing, 0.2, 0.6, r, 0, 0.5, hw, 0.9, 0.5, 0.2)).toEqual(late);
    // Worse skill, bigger errors for the same draws.
    const a = planCatch(landing, 0.2, 0.6, r, 0, 0.8, hw, 0.95, 0.97, 0.9);
    const b = planCatch(landing, 0.2, 0.6, r, 0, 0.4, hw, 0.95, 0.97, 0.9);
    expect(Math.abs(b.timingError)).toBeGreaterThan(Math.abs(a.timingError));
    expect(b.moveAt).toBeGreaterThan(a.moveAt);
    const perfect = planCatch(landing, 0.2, 0.6, r, 0, 1, hw, 0.95, 0.97, 0.9);
    expect(Math.abs(b.targetX - perfect.targetX)).toBeGreaterThan(Math.abs(a.targetX - perfect.targetX));
    // The target always leaves the whole platform inside the field.
    for (let i = 0; i < 50; i++) {
      const p = planCatch(landing, 0.2, 0.6, r, 0, 0, hw, (i * 0.37) % 1, (i * 0.61) % 1, 0.5);
      expect(p.targetX).toBeGreaterThanOrEqual(hw);
      expect(p.targetX).toBeLessThanOrEqual(PD_ASPECT - hw);
    }
  });

  it("drives the platform proportionally, capped at a top speed that falls with the skill and grows with the tempo", () => {
    expect(platformVelocity(0.2, 0.2, 1)).toBe(0);
    expect(platformVelocity(0.2, 0.21, 1)).toBeGreaterThan(0);
    expect(platformVelocity(0.2, 0.6, 1)).toBe(PLATFORM_VMAX);
    expect(platformVelocity(0.6, 0.2, 1.5)).toBe(-1.5 * PLATFORM_VMAX);
    expect(platformVelocity(0.6, 0.2, 1, controllerTopSpeed(0))).toBeCloseTo(-SLOW_PLATFORM * PLATFORM_VMAX, 12);
    expect(controllerTopSpeed(1)).toBe(PLATFORM_VMAX);
  });

  it("launches higher from the centre (to the ceiling) and kicks sideways from the edges; the tempo speeds it up", () => {
    const g = PADDLE_GRAVITY;
    const room = PD_PLATFORM - PD_CEILING - 2 * r;
    const centre = launchOf(0, 0, 0, 0.6, g, 1, r);
    const edge = launchOf(1, 0, 0, 0.6, g, 1, r);
    expect(centre.vy ** 2 / (2 * g)).toBeCloseTo(APEX_CENTRE * room, 9);
    expect(edge.vy ** 2 / (2 * g)).toBeCloseTo(APEX_EDGE * room, 9);
    expect(APEX_CENTRE).toBeGreaterThan(1);
    expect(centre.vx).toBe(0);
    expect(edge.vx).toBeGreaterThan(0);
    expect(launchOf(-1, 0, 0, 0.6, g, 1, r).vx).toBeLessThan(0);
    expect(launchOf(1, 0, 0, 0, g, 1, r).vx).toBe(0);
    expect(Math.sign(edge.spin)).toBe(1);
    expect(paddleTempo(0, 0.02)).toBe(1);
    expect(paddleTempo(10, 0.02)).toBeCloseTo(1.2, 12);
    expect(paddleTempo(1000, 0.1)).toBe(MAX_TEMPO);
  });
});

/* ------------------------------------------------------------------ the engine */

describe("PaddleMode in the engine", () => {
  it("skill 1 never misses – at every gravity, width and speed-up", () => {
    for (const [pd, gravity, seed] of [
      [{ skill: 1 }, 300, 1],
      [{ skill: 1, width: PADDLE_RANGES.pdWidth.min }, 300, 2],
      [{ skill: 1, speedUp: PADDLE_RANGES.pdSpeedUp.max }, 300, 3],
      [{ skill: 1, spin: 1, speedUp: 0.05 }, 2000, 4],
      [{ skill: 1 }, 0, 5],
    ] as [Partial<PaddleSettings>, number, number][]) {
      const engine = engineFor(pd, seed, { gravity });
      const log = play(engine, 90_000);
      expect(log.missMs, JSON.stringify(pd)).toEqual([]);
      expect(log.hitMs.length).toBeGreaterThan(50);
      expect(engine.isSimulationFinished()).toBe(false);
    }
  });

  it("the default controller misses deterministically: the same seed misses at the same moments, ends in GAME OVER after the allowed misses", () => {
    const a = play(engineFor({}, 42));
    const b = play(engineFor({}, 42));
    expect(a.missMs.length).toBe(DEFAULT_PADDLE_SETTINGS.misses + 1);
    expect(a.missMs).toEqual(b.missMs);
    expect(a.hitMs).toEqual(b.hitMs);
    expect(a.finishedMs).toBe(b.finishedMs);
    const view = engineFor({}, 42).getPaddleView();
    expect(view.over).toBe(false);
    // The run ends GAME_OVER_HOLD_SEC after the last miss.
    const last = a.missMs[a.missMs.length - 1];
    expect(a.finishedMs - last).toBeGreaterThanOrEqual(1000 * GAME_OVER_HOLD_SEC - STEP - 1e-6);
    expect(a.finishedMs - last).toBeLessThanOrEqual(1000 * GAME_OVER_HOLD_SEC + STEP + 1e-6);
    const c = play(engineFor({}, 43));
    expect(c.missMs).not.toEqual(a.missMs);
    // More misses allowed, a longer game.
    const long = play(engineFor({ misses: 5 }, 42));
    expect(long.missMs.length).toBe(6);
    expect(long.finishedMs).toBeGreaterThan(a.finishedMs);
  });

  it("worse skill loses sooner on average", () => {
    const mean = (skill: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 8; seed++) sum += play(engineFor({ skill }, seed), 400_000).finishedMs;
      return sum / 8;
    };
    const bad = mean(0.2);
    const mid = mean(0.6);
    const good = mean(0.85);
    expect(bad).toBeLessThan(mid);
    expect(mid).toBeLessThan(good);
  });

  it("every catch plays the next note of the scale (and a chime every ten in a row); a miss a low note, the game over a chord and the break sound", () => {
    const engine = engineFor({ skill: 0.7 }, 42);
    engine.setPaddleSettings({ scale: "major", rootNote: 0 });
    const log = play(engine);
    const view = engine.getPaddleView();
    const catches = log.sounds.filter((s) => s.event.type === "hit" && s.event.level === undefined && !s.event.chord);
    expect(catches.length).toBe(view.hits);
    for (const [i, c] of catches.slice(0, 20).entries()) expect(Math.round(frequencyToMidi(c.event.frequency!))).toBe(rhythmDegreeMidi(i % 15, "major", 0));
    const chimes = log.sounds.filter((s) => s.event.type === "multiplier");
    expect(chimes.length).toBeGreaterThan(0);
    expect(chimes.every((s) => (s.event.multiplier ?? 0) % 10 === 0)).toBe(true);
    const lows = log.sounds.filter((s) => s.event.type === "hit" && s.event.level === 0.9);
    expect(lows.length).toBe(view.misses);
    expect(log.sounds.filter((s) => s.event.chord && s.event.accent).length).toBe(1);
    expect(log.sounds.filter((s) => s.event.type === "gap").length).toBe(1);
    expect(view.bestStreak).toBeGreaterThanOrEqual(10);
  });

  it("keeps the ball between the walls and under the ceiling, speeds up per catch and bounces off the walls and the ceiling", () => {
    const engine = engineFor({ skill: 1, speedUp: 0.05, spin: 1 }, 7);
    const log = play(engine, 60_000);
    const view = engine.getPaddleView();
    expect(log.minX).toBeGreaterThanOrEqual(view.r - 1e-9);
    expect(log.maxX).toBeLessThanOrEqual(PD_ASPECT - view.r + 1e-9);
    expect(log.minY).toBeGreaterThanOrEqual(PD_CEILING + view.r - 1e-9);
    expect(log.maxY).toBeLessThanOrEqual(PD_PLATFORM - view.r + 1e-9);
    expect(view.wallHits).toBeGreaterThan(0);
    expect(view.ceilingHits).toBeGreaterThan(0);
    expect(view.tempo).toBe(MAX_TEMPO);
    // The catches come faster as the tempo grows.
    const gaps = log.hitMs.slice(1).map((t, i) => t - log.hitMs[i]);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(gaps.slice(-10))).toBeLessThan(0.75 * avg(gaps.slice(0, 5)));
  });

  it("replays exactly for a seed on any canvas, and keeps the game across a resize", () => {
    const trace = (engine: ReturnType<typeof engineFor>) => {
      const v = engine.getPaddleView();
      const out: number[] = [];
      for (let i = 0; i < 1200; i++) {
        engine.update(STEP, 0);
        out.push(Math.round(v.bx * 1e9), Math.round(v.by * 1e9), Math.round(v.px * 1e9), v.hits, v.misses);
      }
      return out;
    };
    expect(trace(engineFor({}, 9))).toEqual(trace(engineFor({}, 9, { width: 1080, height: 1920 })));
    const b = engineFor({}, 9);
    const a = engineFor({}, 9);
    for (let i = 0; i < 200; i++) {
      a.update(STEP, 0);
      b.update(STEP, 0);
    }
    b.setConfig({ width: 500, height: 900 });
    for (let i = 0; i < 200; i++) {
      a.update(STEP, 0);
      b.update(STEP, 0);
    }
    expect(b.getPaddleView().bx).toBe(a.getPaddleView().bx);
    const f = buildPaddleField(500, 900);
    const ball = b.getBalls()[0];
    if (ball) expect(ball.x).toBeCloseTo(f.left + b.getPaddleView().bx * f.size, 6);
  });

  it("played by hand: the arrow keys and the pointer move the platform; the controller stays out of it", () => {
    const engine = engineFor({ auto: false }, 3);
    const view = engine.getPaddleView();
    const start = view.px;
    engine.setPaddleInput({ direction: 1 });
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    expect(view.px).toBeGreaterThan(start + 0.2);
    engine.setPaddleInput({ direction: 0, target: 0 });
    for (let i = 0; i < 60; i++) engine.update(STEP, 0);
    expect(view.px).toBeCloseTo(view.halfWidth, 3);
    engine.setPaddleInput({ target: null });
    const still = view.px;
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    expect(view.px).toBe(still);
    // Left alone it misses every ball that does not fall onto it: the game still ends.
    const idle = play(engineFor({ auto: false, misses: 0 }, 3), 30_000);
    expect(idle.finishedMs).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ settings, registration and the finder */

describe("Paddle Keep-Up settings", () => {
  it("are registered as a rhythm-family mode with a card", () => {
    expect(MODE_IDS).toContain("paddle");
    expect(MODE_CATEGORIES.paddle).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("paddle");
    expect(modesInCategory("rhythm")).toContain("paddle");
  });

  it("default in every mode, stay out of the URL and are part of RANGES", () => {
    expect(defaultPaddleFields()).toEqual({ pdAuto: true, pdSkill: 0.7, pdMisses: 2, pdWidth: 0.26, pdSpin: 0.6, pdSpeedUp: 0.02 });
    for (const key of Object.keys(PADDLE_RANGES) as (keyof typeof PADDLE_RANGES)[]) expect(RANGES[key]).toEqual(PADDLE_RANGES[key]);
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolvePaddleFields(d)).toEqual(defaultPaddleFields());
      const params = settingsToSearchParams(d);
      for (const key of ["pda", "pdsk", "pdm", "pdw", "pdsp", "pdu"]) expect(params.has(key)).toBe(false);
    }
  });

  it("round-trip through the URL and presets; bad values fall back or are clamped", () => {
    const s = { ...defaultSettings("paddle"), pdAuto: false, pdSkill: 0.85, pdMisses: 5, pdWidth: 0.2, pdSpin: 0.25, pdSpeedUp: 0.035 };
    const params = settingsToSearchParams(s);
    expect(Object.fromEntries(["pda", "pdsk", "pdm", "pdw", "pdsp", "pdu"].map((k) => [k, params.get(k)]))).toEqual({ pda: "0", pdsk: "0.85", pdm: "5", pdw: "0.2", pdsp: "0.25", pdu: "0.035" });
    expect(resolvePaddleFields(settingsFromSearchParams(params))).toEqual(resolvePaddleFields(s));
    const junk = settingsFromSearchParams(new URLSearchParams("mode=paddle&pda=maybe&pdsk=7&pdm=-3&pdw=x&pdsp=0.61&pdu=1"));
    expect(resolvePaddleFields(junk)).toEqual({ ...defaultPaddleFields(), pdSkill: 1, pdMisses: 0, pdSpin: 0.6, pdSpeedUp: 0.1 });
    expect(resolvePaddleFields(presetToSettings({ mode: "paddle", pdWidth: 0.9, pdAuto: 1 as never }))).toEqual({ ...defaultPaddleFields(), pdWidth: 0.5 });
    expect(paddleSettingsOf({ ...defaultSettings("paddle"), scale: "minor", rootNote: 4 })).toMatchObject({ scale: "minor", rootNote: 4, skill: 0.7 });
  });
});

describe("Paddle Keep-Up and the finder", () => {
  it("times the game over on the mode's fast path exactly as the engine plays it; manual or perfect play never ends", () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 200, physicsConfig: config, mode: "paddle", modeSettings: { ...modeSettings, paddle: {} } };
    for (const seed of [1, 2, 42, 77]) {
      const fast = simulateSeed(seed, request, 200_000);
      const log = play(engineFor({}, seed), 200_000);
      expect(fast).toBeCloseTo(log.finishedMs, 6);
    }
    expect(simulateSeed(3, request, 1000)).toBe(1000);
    expect(paddleNeverFinishes({})).toBe(false);
    expect(paddleNeverFinishes({ skill: 1 })).toBe(true);
    expect(paddleNeverFinishes({ auto: false })).toBe(true);
    expect(runNeverFinishes("paddle", { drop: {}, box: {}, paddle: {} })).toBe(false);
    expect(runNeverFinishes("paddle", { drop: {}, box: {}, paddle: { skill: 1 } })).toBe(true);
    expect(runNeverFinishes("paddle", { drop: {}, box: {}, paddle: { auto: false } })).toBe(true);
  });

  it("finds a seed whose game over comes at the target, and says a perfect controller never finishes", async () => {
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      const base = { toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "paddle" as const };
      const found = await findSimulation({ ...base, targetDurationSec: 30, modeSettings: { ...modeSettings, paddle: {} } }, () => {});
      expect(found.found).toBe(true);
      expect(Math.abs(found.duration - 30)).toBeLessThanOrEqual(0.5);
      const log = play(engineFor({}, found.seed));
      expect(log.finishedMs / 1000).toBeCloseTo(found.duration, 6);
      const perfect = await findSimulation({ ...base, targetDurationSec: 30, modeSettings: { ...modeSettings, paddle: { skill: 1 } } }, () => {});
      expect(perfect).toMatchObject({ found: false, endless: true, seedsTested: 0 });
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
