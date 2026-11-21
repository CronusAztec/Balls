import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import {
  DEFAULT_TERRITORY_SETTINGS,
  TY_ARM_MAX_MS,
  TY_BLAST_INTO,
  TY_STING_GAP_MS,
  TY_TICK_HZ,
  TY_TICK_SECONDS,
  TY_WHIRL_ARMS,
  TY_WHIRL_INTO,
  type TyBall,
} from "@/lib/physics/modes/territory";
import { DEFAULT_TERRITORY_LABELS, TY_TILE_LIGHT, TY_WAVE_MAX_MS, TY_WAVE_MS_PER_TILE, TerritoryLayer, blastWaveMs } from "@/components/simulator/territoryRenderer";
import { defaultSettings, settingsToSearchParams } from "@/lib/settings";
import { clipPacingDefaults } from "@/lib/clipPacing";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- territory-swing --- Territory keeps its promise, "one bounce can flip the board" (lib/physics/modes/territory.ts,
 * components/simulator/territoryRenderer.ts):
 *  - a bomber and a vortex arm on their timer and fire on their next bounce off an enemy tile (they went off where they
 *    armed after 150 ms, mostly inside their own colour), centred past the border: the blast and the whirl bite into the
 *    other side;
 *  - four whirl arms against the blast, a reach of 4 tiles every 2 s: the board swings both ways and ends with a clear
 *    winner on most seeds, either side winning;
 *  - the verdict names the side as the HUD does (VORTEX WINS), the lead changes are heard, the last five seconds tick;
 *  - the look: brighter tiles, a blast's tiles turning as a wave, a share bar that swings and flashes on a lead change.
 */

const WORLD = { width: 450, height: 450 };
const STEP = 1000 / 60;

function pageEngine(seed: number): PhysicsEngine {
  const request = finderRequestOfSettings(defaultSettings("territory"), WORLD, 40);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

function teamBall(engine: PhysicsEngine, id: number): TyBall {
  return engine.getTerritoryView().balls.find((b) => b.id === id)!;
}

describe("the defaults", () => {
  it("are a reach of 4 tiles every 2 s on the page (the mode's own 3 and 3 stay), four whirl arms and a fuse that waits for the border", () => {
    const d = defaultSettings("territory");
    expect([d.tyRadius, d.tyPowerEvery]).toEqual([4, 2]);
    expect(clipPacingDefaults("territory")).toEqual({ tyRadius: 4, tyPowerEvery: 2 });
    expect([DEFAULT_TERRITORY_SETTINGS.radius, DEFAULT_TERRITORY_SETTINGS.powerEvery]).toEqual([3, 3]);
    expect([defaultSettings("classic").tyRadius, defaultSettings("classic").tyPowerEvery]).toEqual([3, 3]);
    expect(TY_WHIRL_ARMS).toBe(4);
    expect(TY_ARM_MAX_MS).toBe(4000);
    expect(TY_BLAST_INTO).toBeGreaterThan(0.4);
    expect(TY_WHIRL_INTO).toBeGreaterThan(0.3);
    expect(settingsToSearchParams(defaultSettings("territory")).has("tyr")).toBe(false);
  });
});

describe("a power lands in the other colour", () => {
  it("a bomber's blast is centred past the border and takes most of its disc from the enemy", () => {
    const engine = createEngineForSettings(config, "territory", { ...modeSettings, territory: { powers: ["none", "bomber", "none", "none"], ballsPerTeam: 1, radius: 4, powerEvery: 10 } }, 42);
    const v = engine.getTerritoryView();
    const f = v.field;
    engine.setBalls(engine.getBalls().filter((b) => b.team === 1));
    const bomber = engine.getBalls()[0];
    const tb = teamBall(engine, bomber.id);
    // armed in the middle of its own (bottom) half: nothing goes off there
    bomber.x = f.gx + 0.5 * f.gridW;
    bomber.y = f.gy + 0.8 * f.gridH;
    bomber.vx = 300;
    bomber.vy = 0;
    tb.nextPowerMs = 0;
    engine.update(STEP, 0);
    expect(tb.armedMs).toBeGreaterThan(-Infinity);
    for (let i = 0; i < 30; i++) {
      bomber.y = f.gy + 0.8 * f.gridH;
      bomber.vy = 0;
      engine.update(STEP, 0);
    }
    expect(v.blasts).toBe(0);
    // now at the border, heading up into the enemy's half
    const before = v.counts[0];
    bomber.x = f.gx + (Math.floor(v.cols / 2) + 0.5) * f.tile;
    bomber.y = f.gy + (v.rows / 2) * f.tile + bomber.radius + 0.5;
    bomber.vx = 0;
    bomber.vy = -300;
    engine.update(STEP, 0);
    expect(v.blasts).toBe(1);
    const shock = v.shocks[0];
    // the centre sits past the border (row rows/2 is the first enemy row above it)
    expect(shock.v).toBeLessThan(v.rows / 2 - 0.4 * TY_BLAST_INTO * shock.radius);
    // the enemy lost about the blast's area: far more than half of the disc
    const area = Math.PI * shock.radius * shock.radius;
    expect(before - v.counts[0]).toBeGreaterThan(0.6 * area);
  });

  it("a vortex arms, waits for the border and whirls round a point past it, not round the ball", () => {
    const engine = createEngineForSettings(config, "territory", { ...modeSettings, territory: { powers: ["vortex", "none", "none", "none"], ballsPerTeam: 1, radius: 4, powerEvery: 10 } }, 42);
    const v = engine.getTerritoryView();
    const f = v.field;
    engine.setBalls(engine.getBalls().filter((b) => b.team === 0));
    const ball = engine.getBalls()[0];
    const tb = teamBall(engine, ball.id);
    ball.x = f.gx + 0.5 * f.gridW;
    ball.y = f.gy + 0.2 * f.gridH;
    ball.vx = 300;
    ball.vy = 0;
    tb.nextPowerMs = 0;
    engine.update(STEP, 0);
    expect(tb.armedMs).toBeGreaterThan(-Infinity);
    expect(v.whirls).toBe(0);
    // down onto the border: the whirl starts there
    ball.x = f.gx + (Math.floor(v.cols / 2) + 0.5) * f.tile;
    ball.y = f.gy + (v.rows / 2) * f.tile - ball.radius - 0.5;
    ball.vx = 0;
    ball.vy = 300;
    engine.update(STEP, 0);
    expect(v.whirls).toBe(1);
    expect(tb.armedMs).toBe(-Infinity);
    expect(tb.whirlV).toBeGreaterThan(v.rows / 2 + 0.5 * TY_WHIRL_INTO * tb.reach);
    const u0 = tb.whirlU;
    const v0 = tb.whirlV;
    const before = v.counts[1];
    for (let i = 0; i < 70; i++) engine.update(STEP, 0);
    // fixed where it was released, and it ate into the other side
    expect([tb.whirlU, tb.whirlV]).toEqual([u0, v0]);
    expect(before - v.counts[1]).toBeGreaterThan(10);
  });

  it("a power that meets no border in TY_ARM_MAX_MS fires where it is", () => {
    const engine = createEngineForSettings(config, "territory", { ...modeSettings, territory: { powers: ["vortex", "none", "none", "none"], ballsPerTeam: 1, radius: 2 } }, 42);
    const v = engine.getTerritoryView();
    const f = v.field;
    engine.setBalls(engine.getBalls().filter((b) => b.team === 0));
    const ball = engine.getBalls()[0];
    const tb = teamBall(engine, ball.id);
    tb.nextPowerMs = 0;
    engine.update(STEP, 0);
    const armed = tb.armedMs;
    while (engine.getElapsedMs() < armed + TY_ARM_MAX_MS - 1e-6) {
      // kept in its own half, away from the border
      ball.y = f.gy + 0.15 * f.gridH;
      ball.vy = Math.abs(ball.vy) < 1 ? 0 : -Math.abs(ball.vy);
      engine.update(STEP, 0);
      expect(v.whirls).toBe(0);
    }
    engine.update(STEP, 0);
    expect(v.whirls).toBe(1);
  });
});

describe("the page's battle", () => {
  it("swings both ways and ends with a clear winner on most seeds, either side winning", { timeout: 120_000 }, () => {
    let clear = 0;
    let draws = 0;
    let swung = 0;
    const wins = [0, 0];
    let changes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const engine = pageEngine(seed);
      let most = [0, 0];
      while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        const v = engine.getTerritoryView();
        const d = (v.counts[0] - v.counts[1]) / v.total;
        most = [Math.max(most[0], d), Math.max(most[1], -d)];
      }
      const v = engine.getTerritoryView();
      expect(v.finished, `seed ${seed}`).toBe(true);
      if (Math.abs(v.counts[0] - v.counts[1]) / v.total >= 0.05) clear++;
      if (v.tie) draws++;
      if (v.winner >= 0) wins[v.winner]++;
      if (Math.min(...most) >= 0.05) swung++;
      changes += v.leadChanges;
    }
    // measured when this was written (seeds 1–12, the phone world): the old run ended within 5 % on 10 of 12 (239 to 241)
    expect(clear).toBeGreaterThanOrEqual(8);
    expect(draws).toBe(0);
    expect(Math.min(...wins)).toBeGreaterThanOrEqual(3);
    expect(swung).toBeGreaterThanOrEqual(10);
    expect(changes / 12).toBeGreaterThan(6);
  });

  it("is heard: a sting on a lead change (one per TY_STING_GAP_MS) and a tick on each of the last five seconds", () => {
    const engine = pageEngine(7);
    const events: { t: number; ev: SoundEvent }[] = [];
    while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) {
      engine.update(STEP, 0);
      for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs(), ev });
    }
    const v = engine.getTerritoryView();
    const ticks = events.filter(({ ev }) => ev.frequency === TY_TICK_HZ);
    expect(ticks.length).toBe(TY_TICK_SECONDS);
    for (const { t } of ticks) expect(t).toBeGreaterThan(v.durationMs - TY_TICK_SECONDS * 1000 - STEP);
    const stings = events.filter(({ ev }) => ev.accent && ev.melody === false && ev.frequency !== TY_TICK_HZ);
    expect(stings.length).toBeGreaterThan(2);
    expect(stings.length).toBeLessThanOrEqual(v.leadChanges);
    for (let i = 1; i < stings.length; i++) expect(stings[i].t - stings[i - 1].t).toBeGreaterThanOrEqual(TY_STING_GAP_MS - 1e-6);
    // a calm mix: about ten sounds a second at most, never a silence over a second and a half
    expect(events.length / (engine.getElapsedMs() / 1000)).toBeLessThan(14);
    let last = 0;
    let quiet = 0;
    for (const { t } of events) {
      quiet = Math.max(quiet, t - last);
      last = t;
    }
    expect(quiet).toBeLessThan(1500);
  });
});

describe("the look", () => {
  it("turns a blast's tiles as a wave from its centre, any other flip at once", () => {
    const view = { shocks: [{ u: 10, v: 8, radius: 4, team: 1, t0: 5000, seed: 1 }] };
    expect(blastWaveMs(view, 9, 7, 5000)).toBeCloseTo(TY_WAVE_MS_PER_TILE * Math.hypot(0.5, 0.5), 6);
    expect(blastWaveMs(view, 13, 8, 5008)).toBeCloseTo(TY_WAVE_MS_PER_TILE * Math.hypot(3.5, 0.5), 6);
    expect(blastWaveMs(view, 2, 2, 5000)).toBe(0); // outside the blast
    expect(blastWaveMs(view, 9, 7, 6000)).toBe(0); // a later flip
    expect(blastWaveMs({ shocks: [{ ...view.shocks[0], radius: 40 }] }, 40, 8, 5000)).toBe(TY_WAVE_MAX_MS);
    expect(TY_TILE_LIGHT).toBeGreaterThan(0.5);
  });

  it("names the winner as the HUD does, on a plate: VORTEX WINS, not PINK WINS", () => {
    const engine = pageEngine(7);
    while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
    }
    const view = engine.getTerritoryView();
    expect(view.winner).toBeGreaterThanOrEqual(0);
    const canvas = fakeCanvas(450, 450);
    const layer = new TerritoryLayer();
    const o = { dpr: 1, nowMs: view.finishedMs + 2000, wallThickness: 2, labels: DEFAULT_TERRITORY_LABELS, roster: [], showWallGlow: false } as unknown as Parameters<TerritoryLayer["drawOverlay"]>[2];
    layer.drawOverlay(canvas.ctx as unknown as CanvasRenderingContext2D, view, o, { inset: 0, dtMs: 16, teamBanner: false });
    const texts = canvas.ctx.calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    const name = DEFAULT_TERRITORY_LABELS.powers[view.settings.powers[view.winner] as "vortex" | "bomber"];
    expect(texts).toContain(`🏆 ${DEFAULT_TERRITORY_LABELS.wins(name)}`);
    expect(texts.some((t) => /PINK|CYAN/.test(t))).toBe(false);
    expect(canvas.ctx.calls.some((c) => c.name === "roundRect" || c.name === "arcTo")).toBe(true);
  });
});
