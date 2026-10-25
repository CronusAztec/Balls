import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { MODE_IDS } from "@/lib/physics/types";
import { FULL_BALL_LIMIT_DEFAULT, GROWTH_CAP_RANGES, SWARM_LIMIT_DEFAULT, fullBallLimitOf, growthCapConfigOf, growthCapLivePatch, swarmLimitOf } from "@/lib/physics/growthCaps";
import { MULTIPLY_MAX_BALLS } from "@/lib/physics/modes/multiply";
import { RESPAWN_MAX_BALLS } from "@/lib/physics/respawn";
import { OBJECT_BALL_LIMIT } from "@/lib/unlimited";
import { RING_OBJECT_WORK, objectLimitFor } from "@/lib/physics/limits";
import { FULL_BALL_CEILING, MEMORY_CEILINGS } from "@/lib/uncap";
import { MAX_TEMPO, paddleSettingsOf, paddleTempo, resolvePaddleFields } from "@/lib/physics/modes/paddle";
import { RING_MAX_BODIES, collideSettingsOf } from "@/lib/physics/modes/collide";
import { DEFAULT_FIGHT_LEAGUE_SETTINGS, fightLeagueSettingsOf, resolveFightLeagueFields } from "@/lib/physics/modes/fightLeague";
import { FL_BOUT_CAP_SEC } from "@/lib/physics/modes/fightLeagueShow";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, uncappedEngaged, type SimulatorSettings } from "@/lib/settings";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { arenaPhysicsConfig } from "@/lib/simulation/multi";
import { probeEngine, probeRun } from "./flProbes";

/*
 * --- unlimited-sizes --- (plan step 16) The clamps that were live at default values are settings now, each defaulting to
 * the old constant exactly: the swarm's 200 balls (`swarmLimit`, swl), the run's 2,000 full-physics balls (`fullBallLimit`,
 * fbl), Paddle's 2× top tempo (`pdMaxTempo`, pdmt), Fight League's 45 s bout cap (`flBoutCap`, flBc) and Collision
 * Playground's 36 ring bodies (`cpRingCount`, cprc). A default link, config and mode settings object carry none of them,
 * so every default run, found seed and pinned print plays as before; raised, each one lets its run grow past the old number.
 */

const STEP = 1000 / 60;
const run = (engine: PhysicsEngine, frames: number) => {
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
  }
};
const engineOf = (s: SimulatorSettings, seed = 5) => createEngineForSettings(physicsConfigOfSettings(s), s.mode, modeSettingsOfSettings(s), seed);
const stateOf = (engine: PhysicsEngine) => engine.getBalls().map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.radius]);

describe("growth caps: the defaults are the old constants, and a default run carries none of them", () => {
  it("defaults to exactly today's numbers", () => {
    expect([SWARM_LIMIT_DEFAULT, MULTIPLY_MAX_BALLS, RESPAWN_MAX_BALLS]).toEqual([200, 200, 200]);
    expect(FULL_BALL_LIMIT_DEFAULT).toBe(OBJECT_BALL_LIMIT);
    expect(FULL_BALL_CEILING).toBeLessThanOrEqual(RING_OBJECT_WORK); // (the runtime's work ceiling binds no sooner with one ring)
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect([d.swarmLimit, d.fullBallLimit, d.pdMaxTempo, d.flBoutCap, d.cpRingCount]).toEqual([200, OBJECT_BALL_LIMIT, MAX_TEMPO, FL_BOUT_CAP_SEC, RING_MAX_BODIES]);
      // the comfort ranges end at the defaults where a value past them engages the extreme-values runtime
      expect(uncappedEngaged(d)).toBe(false);
    }
    expect([RANGES.swarmLimit.max, RANGES.fullBallLimit.max, RANGES.cpRingCount.max]).toEqual([SWARM_LIMIT_DEFAULT, FULL_BALL_LIMIT_DEFAULT, RING_MAX_BODIES]);
    expect(GROWTH_CAP_RANGES.swarmLimit.max).toBe(SWARM_LIMIT_DEFAULT);
    for (const key of ["swarmLimit", "fullBallLimit", "cpRingCount"]) expect(MEMORY_CEILINGS[key]).toBeGreaterThan((RANGES as unknown as Record<string, { max: number }>)[key].max);
  });

  it("writes nothing new into a default link, physics config or mode settings object", () => {
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      const link = settingsToSearchParams(d);
      for (const key of ["swl", "fbl", "pdmt", "flBc", "cprc"]) expect([mode, key, link.has(key)]).toEqual([mode, key, false]);
      const config = physicsConfigOfSettings(d) as unknown as Record<string, unknown>;
      expect(["swarmLimit" in config, "fullBallLimit" in config]).toEqual([false, false]);
      const ms = modeSettingsOfSettings(d) as unknown as Record<string, Record<string, unknown> | undefined>;
      expect("ringCount" in (ms.collide ?? {})).toBe(false);
      expect("maxTempo" in (ms.paddle ?? {})).toBe(false);
      expect("boutCap" in (ms.fightLeague ?? {})).toBe(false);
    }
    expect(growthCapConfigOf(defaultSettings("multiply"))).toEqual({});
    expect(growthCapLivePatch(defaultSettings("multiply"))).toEqual({ swarmLimit: undefined, fullBallLimit: undefined });
    expect("boutCap" in fightLeagueSettingsOf(resolveFightLeagueFields({}))).toBe(false);
    expect("boutCap" in DEFAULT_FIGHT_LEAGUE_SETTINGS).toBe(false);
    expect(arenaPhysicsConfig(defaultSettings("classic"))).toMatchObject({ swarmLimit: undefined, fullBallLimit: undefined });
  });

  it("plays a default run exactly as with each setting at its default spelled out", () => {
    // (the config carries nothing at the defaults; a value at the default reads as absent: the same run, step for step)
    for (const mode of ["multiply", "classic"] as const) {
      const s = { ...defaultSettings(mode), respawnEvery: 1 };
      const a = engineOf(s);
      const b = createEngineForSettings({ ...physicsConfigOfSettings(s), swarmLimit: SWARM_LIMIT_DEFAULT, fullBallLimit: FULL_BALL_LIMIT_DEFAULT }, mode, modeSettingsOfSettings(s), 5);
      run(a, 600);
      run(b, 600);
      expect(stateOf(b)).toEqual(stateOf(a));
    }
    const paddle = defaultSettings("paddle");
    const p1 = engineOf(paddle, 12345);
    const p2 = createEngineForSettings(physicsConfigOfSettings(paddle), "paddle", { ...modeSettingsOfSettings(paddle), paddle: { ...modeSettingsOfSettings(paddle).paddle, maxTempo: MAX_TEMPO } }, 12345);
    run(p1, 600);
    run(p2, 600);
    expect(p2.getPaddleView().tempo).toBe(p1.getPaddleView().tempo);
    expect(stateOf(p2)).toEqual(stateOf(p1));
  });
});

describe("growth caps: raised past the old numbers", () => {
  it("swl: a swarm limit of 1,000 grows the swarm past 200 into the crowd; 50 stops it at 50", { timeout: 120_000 }, () => {
    const rule = { param: "balls", trigger: "bounce", every: 1, op: "multiply", amount: 2, scope: "ball" };
    const big = presetToSettings({ ...defaultSettings("classic"), swarmLimit: 1000, bounceMath: [rule] } as unknown as SimulatorSettings);
    expect(big.swarmLimit).toBe(1000);
    expect(settingsFromSearchParams(settingsToSearchParams(big)).swarmLimit).toBe(1000);
    expect(uncappedEngaged(big)).toBe(true); // (a value past its slider engages the runtime: the crowd takes the overflow)
    const engine = engineOf(big);
    for (let i = 0; i < 600 && engine.getCrowd().spawned === 0; i++) run(engine, 1);
    expect(engine.getBalls().length).toBeGreaterThan(SWARM_LIMIT_DEFAULT);
    expect(engine.getCrowd().spawned).toBeGreaterThan(0);
    const small = presetToSettings({ ...defaultSettings("classic"), swarmLimit: 50, bounceMath: [rule] } as unknown as SimulatorSettings);
    expect(uncappedEngaged(small)).toBe(false);
    const capped = engineOf(small);
    run(capped, 120);
    expect(capped.getBalls().length).toBe(50);
    expect(capped.getCrowd().spawned).toBe(0);
    expect([swarmLimitOf({}), swarmLimitOf({ swarmLimit: 0 }), swarmLimitOf({ swarmLimit: 12.7 })]).toEqual([200, 200, 12]);
  });

  it("swl: the respawn timer stops at the swarm limit too", () => {
    const s = { ...defaultSettings("multiply"), respawnEvery: 0.1, swarmLimit: 3 };
    const engine = engineOf(s);
    run(engine, 600);
    expect(engine.getBalls().length).toBeLessThanOrEqual(3 + 3 * 3); // (an escape's copies are Multiply's own: they stop at the limit as well)
    expect(engine.getRespawnCount()).toBeGreaterThan(0);
  });

  it("fbl: a full-ball limit of 5,000 keeps 5,000 full-physics balls (one ring), its memory-safety ceiling", () => {
    expect(objectLimitFor(1, 5000)).toBe(5000);
    expect(objectLimitFor(1)).toBe(OBJECT_BALL_LIMIT);
    expect(fullBallLimitOf({ fullBallLimit: 1e9 })).toBe(FULL_BALL_CEILING);
    expect(fullBallLimitOf({})).toBe(OBJECT_BALL_LIMIT);
    const s = presetToSettings({ ...defaultSettings("classic"), wallCount: 1, fullBallLimit: 5000 });
    expect([s.fullBallLimit, uncappedEngaged(s)]).toEqual([5000, true]);
    const engine = engineOf(s);
    run(engine, 1);
    const ball = engine.getBalls()[0];
    engine.getMultiplierRuntime().cloneBall(engine.ctx, ball, 6000, objectLimitFor(1, 5000));
    expect(engine.getBalls()).toHaveLength(5000);
    // the split limit follows it too (a Ball Cap past 2,000 is kept up to the full-ball limit)
    const split = engineOf(presetToSettings({ ...defaultSettings("classic"), wallCount: 1, fullBallLimit: 5000, maxBalls: 4000 }));
    run(split, 1);
    expect(split.getBallInteraction().maxBalls).toBe(4000);
  });

  it("pdmt: a top tempo of 4 lets the Speed-Up pass 2×", { timeout: 60_000 }, () => {
    expect(paddleTempo(1000, 0.1)).toBe(MAX_TEMPO);
    expect(paddleTempo(1000, 0.1, 4)).toBe(4);
    const fields = resolvePaddleFields({ pdMaxTempo: 4 });
    expect(fields.pdMaxTempo).toBe(4);
    expect(paddleSettingsOf(fields).maxTempo).toBe(4);
    const s = presetToSettings({ ...defaultSettings("paddle"), pdSkill: 1, pdSpeedUp: 0.1, pdMaxTempo: 4 });
    expect(settingsFromSearchParams(settingsToSearchParams(s)).pdMaxTempo).toBe(4);
    const engine = engineOf(s, 7);
    let top = 0;
    for (let i = 0; i < 60 * 60 && top <= MAX_TEMPO; i++) {
      run(engine, 1);
      top = Math.max(top, engine.getPaddleView().tempo);
    }
    expect(top).toBeGreaterThan(MAX_TEMPO);
  });

  it("flBc: a bout cap of 0 runs a bracket's bouts to the Time Cap as typed; 30 caps them at 30 s", () => {
    const BRACKET = { match: "bracket" as const, fighters: ["thor", "loki", "random", "random", "random", "random"] };
    const capOf = (fl: Record<string, unknown>) => {
      const engine = probeEngine({ ...BRACKET, ...fl }, 3);
      return probeRun(engine, 100).capSec;
    };
    expect(capOf({})).toBe(Math.min(DEFAULT_FIGHT_LEAGUE_SETTINGS.timeCap, FL_BOUT_CAP_SEC));
    expect(capOf({ boutCap: 0 })).toBe(DEFAULT_FIGHT_LEAGUE_SETTINGS.timeCap);
    expect(capOf({ boutCap: 30 })).toBe(30);
    expect(capOf({ boutCap: 0, timeCap: 200 })).toBe(200);
    const s = settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flM=bracket&flBc=0"));
    expect(s.flBoutCap).toBe(0);
    expect(settingsToSearchParams(s).get("flBc")).toBe("0");
    expect(fightLeagueSettingsOf(s).boutCap).toBe(0);
  });

  it("cprc: a ring of 100 holds 100 bodies (the discs shrink to fit)", () => {
    const s = presetToSettings({ ...defaultSettings("collide"), cpRing: true, cpCount: 300, cpRingCount: 100 });
    expect(s.cpRingCount).toBe(100);
    expect(settingsFromSearchParams(settingsToSearchParams(s)).cpRingCount).toBe(100);
    expect(collideSettingsOf(s).ringCount).toBe(100);
    const engine = engineOf(s, 7);
    expect(engine.getBalls()).toHaveLength(100);
    expect(engine.getCollideView().count).toBe(100);
    const defaults = engineOf(presetToSettings({ ...defaultSettings("collide"), cpRing: true }), 7);
    expect(defaults.getBalls()).toHaveLength(RING_MAX_BODIES);
    run(engine, 60);
    for (const b of engine.getBalls()) expect(Number.isFinite(b.x + b.y + b.radius)).toBe(true);
  });
});
