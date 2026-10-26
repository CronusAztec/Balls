import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { createEngineForSettings, simulateOutcomeRun } from "@/lib/simulation/finder";
import { MODE_IDS } from "@/lib/physics/types";
import { FULL_BALL_LIMIT_DEFAULT, GROWTH_CAP_RANGES, SWARM_LIMIT_DEFAULT, engagedSwarmCeiling, fullBallLimitOf, growthCapConfigOf, growthCapLivePatch, swarmLimitOf } from "@/lib/physics/growthCaps";
import { MULTIPLY_MAX_BALLS } from "@/lib/physics/modes/multiply";
import { RESPAWN_MAX_BALLS } from "@/lib/physics/respawn";
import { OBJECT_BALL_LIMIT } from "@/lib/unlimited";
import { RING_OBJECT_WORK, objectLimitFor } from "@/lib/physics/limits";
import { FULL_BALL_CEILING, LIMIT_CEILING_KEYS, MEMORY_CEILINGS } from "@/lib/uncap";
import { MAX_TEMPO, paddleSettingsOf, paddleTempo, resolvePaddleFields } from "@/lib/physics/modes/paddle";
import { RING_MAX_BODIES, collideSettingsOf } from "@/lib/physics/modes/collide";
import { DEFAULT_FIGHT_LEAGUE_SETTINGS, fightLeagueSettingsOf, flShowHorizonMs, resolveFightLeagueFields } from "@/lib/physics/modes/fightLeague";
import { FL_BOUT_CAP_SEC, FL_SHOW_BOUT_SEC, FL_SHOW_UNCAPPED_BOUT_SEC } from "@/lib/physics/modes/fightLeagueShow";
import { RANGES, defaultSettings, inactiveEngineKeys, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams, uncappedEngaged, type SimulatorSettings } from "@/lib/settings";
import { finderRequestOfSettings, modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
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
  it("swl: a swarm limit of 1,000 grows the swarm past 200 and stops it at 1,000; 3,000 into the crowd; 50 stops it at 50", { timeout: 120_000 }, () => {
    const rule = { param: "balls", trigger: "bounce", every: 1, op: "multiply", amount: 2, scope: "ball" };
    const big = presetToSettings({ ...defaultSettings("classic"), swarmLimit: 1000, bounceMath: [rule] } as unknown as SimulatorSettings);
    expect(big.swarmLimit).toBe(1000);
    expect(settingsFromSearchParams(settingsToSearchParams(big)).swarmLimit).toBe(1000);
    expect(uncappedEngaged(big)).toBe(true); // (a value past its slider engages the runtime: the crowd takes the overflow)
    // --- review fix (unlimited-sizes) --- engaged, the typed number is still the swarm's ceiling: full and crowd balls together
    // (300 and 1,000 both used to reach 2,000 full balls plus the 1,000,000-ball crowd)
    const swarmOf = (engine: PhysicsEngine) => engine.getBalls().length + engine.getCrowd().count;
    const grow = (engine: PhysicsEngine, frames: number) => {
      let most = 0;
      for (let i = 0; i < frames; i++) {
        run(engine, 1);
        most = Math.max(most, swarmOf(engine));
      }
      return most;
    };
    const engine = engineOf(big);
    expect(grow(engine, 600)).toBe(1000);
    expect(engine.getBalls().length).toBeGreaterThan(SWARM_LIMIT_DEFAULT);
    expect(engine.getCrowd().spawned).toBe(0); // (1,000 full-physics balls fit the run's 2,000)
    for (const limit of [300, 3000]) {
      const s = presetToSettings({ ...defaultSettings("classic"), swarmLimit: limit, bounceMath: [rule] } as unknown as SimulatorSettings);
      const e = engineOf(s);
      expect(grow(e, 900), String(limit)).toBe(limit);
      if (limit > FULL_BALL_LIMIT_DEFAULT) {
        expect(e.getBalls().length).toBe(FULL_BALL_LIMIT_DEFAULT); // full-physics balls up to the run's limit, the rest in the crowd
        expect(e.getCrowd().spawned).toBeGreaterThan(0);
      }
    }
    // At its default the swarm keeps growing past 200 into the crowd once something else engages the runtime, as it always did.
    const engaged = presetToSettings({ ...defaultSettings("classic"), ballSpeed: 1e6, bounceMath: [rule] } as unknown as SimulatorSettings);
    expect([uncappedEngaged(engaged), engaged.swarmLimit]).toEqual([true, SWARM_LIMIT_DEFAULT]);
    const open = engineOf(engaged);
    for (let i = 0; i < 600 && open.getCrowd().spawned === 0; i++) run(open, 1);
    expect(open.getCrowd().spawned).toBeGreaterThan(0);
    expect([engagedSwarmCeiling({}), engagedSwarmCeiling({ swarmLimit: SWARM_LIMIT_DEFAULT }), engagedSwarmCeiling({ swarmLimit: 300.6 })]).toEqual([null, null, 300]);
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

  it("swl: past its slider, Multiply's escapes and the respawn timer stop at the typed limit as well, crowd balls counted", { timeout: 60_000 }, () => {
    const swarmOf = (engine: PhysicsEngine) => engine.getBalls().length + engine.getCrowd().count;
    // ten new balls an escape through a wide gap: the swarm passes 300 within seconds, and used to grow on into the crowd
    const multiply = presetToSettings({ ...defaultSettings("multiply"), swarmLimit: 300, multiplySpawnCount: 10, gapSize: 0.8 } as unknown as SimulatorSettings);
    expect(uncappedEngaged(multiply)).toBe(true);
    const m = engineOf(multiply);
    let most = 0;
    for (let i = 0; i < 60 * 30; i++) {
      run(m, 1);
      most = Math.max(most, swarmOf(m));
    }
    expect(most).toBe(300);
    // the respawn timer, engaged by the same limit: at most 300 balls in play
    const respawn = presetToSettings({ ...defaultSettings("multiply"), respawnEvery: 0.1, swarmLimit: 300, gapSize: 0.1 } as unknown as SimulatorSettings);
    const r = engineOf(respawn);
    most = 0;
    for (let i = 0; i < 60 * 40; i++) {
      run(r, 1);
      most = Math.max(most, swarmOf(r));
    }
    expect(most).toBeLessThanOrEqual(300);
    expect(r.getRespawnCount()).toBeGreaterThan(200);
  });

  it("fbl: a full-ball limit of 5,000 keeps 5,000 full-physics balls (one ring), its memory-safety ceiling", () => {
    expect(objectLimitFor(1, 5000)).toBe(5000);
    expect(objectLimitFor(1)).toBe(OBJECT_BALL_LIMIT);
    expect(fullBallLimitOf({ fullBallLimit: 1e9 })).toBe(FULL_BALL_CEILING);
    expect(fullBallLimitOf({})).toBe(OBJECT_BALL_LIMIT);
    const s = presetToSettings({ ...defaultSettings("classic"), wallCount: 1, fullBallLimit: 5000 });
    expect([s.fullBallLimit, uncappedEngaged(s)]).toEqual([5000, false]); // (--- review fix --- a limit engages nothing by itself: it applies once something else does)
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

  it("flBc: the finder follows a show as long as its bouts may last, so a raised bout cap's champion is still found", { timeout: 120_000 }, () => {
    // (review fix) the show horizon was FL_SHOW_BOUT_SEC (90 s) a bout, sized for the old fixed 45 s cap: a 120 s bout cap
    // and a high HP outlasted it, and the champion search stopped before the bracket ended
    const link = (extra: string, flT = 300) => settingsFromSearchParams(new URLSearchParams(`mode=fightLeague&flM=bracket&flBr=4&flHp=3000&flT=${flT}${extra}`));
    const fl = (s: SimulatorSettings) => fightLeagueSettingsOf(s);
    expect(flShowHorizonMs(fl(link("")))).toBe(1000 * FL_SHOW_BOUT_SEC * 3); // the defaults' horizon: a 45 s cap, 90 s a bout
    expect(flShowHorizonMs(fl(defaultSettings("fightLeague")))).toBe(1000 * FL_SHOW_BOUT_SEC);
    expect(flShowHorizonMs(fl(link("&flBc=120")))).toBe(1000 * (FL_SHOW_BOUT_SEC + 120 - FL_BOUT_CAP_SEC) * 3);
    expect(flShowHorizonMs(fl(link("&flBc=0")))).toBe(1000 * (FL_SHOW_BOUT_SEC + 300 - FL_BOUT_CAP_SEC) * 3); // (0: the Time Cap as typed)
    expect(flShowHorizonMs(fl(link("&flBc=0", 0)))).toBe(1000 * FL_SHOW_UNCAPPED_BOUT_SEC * 3); // (no cap at all: the long ceiling)
    expect(flShowHorizonMs(fl(link("&flBc=30")))).toBe(1000 * FL_SHOW_BOUT_SEC * 3); // (a lower cap keeps the 90 s)
    // a series' games are capped by the Time Cap: the 90 s a game assumed its default
    const series = (t: number) => fl(presetToSettings({ ...defaultSettings("fightLeague"), flBestOf: 3, flTimeCap: t }));
    expect(flShowHorizonMs(series(DEFAULT_FIGHT_LEAGUE_SETTINGS.timeCap))).toBe(1000 * FL_SHOW_BOUT_SEC * 5);
    expect(flShowHorizonMs(series(300))).toBe(1000 * (FL_SHOW_BOUT_SEC + 300 - DEFAULT_FIGHT_LEAGUE_SETTINGS.timeCap) * 5);
    // the bracket of the report: seed 11 with a 120 s bout cap really ends past 270 s; its champion search follows it there
    const s = link("&flBc=120");
    const request = finderRequestOfSettings(s);
    expect(request.maxSimTimeSec).toBeGreaterThanOrEqual(flShowHorizonMs(fl(s)) / 1000);
    const run = simulateOutcomeRun(11, request, { kind: "champion", team: 0, clipSec: 60 });
    expect(run.finished).toBe(true);
    expect(run.durationMs).toBeGreaterThan(1000 * FL_SHOW_BOUT_SEC * 3);
    expect(run.fl?.championSide).toBeGreaterThanOrEqual(0);
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

// --- review fix (unlimited-sizes) --- the limits: a value past the slider engages nothing where nothing grows to it, and one
// past its memory-safety ceiling says no ARENA FULL in a run that builds nothing less
describe("growth caps: a limit engages nothing and fills nothing by itself", () => {
  /** Every ball's position, every frame, hashed (FNV-1a over the doubles' bits), the balls at the end and whether the extreme-values runtime ran. */
  const runPrint = (s: SimulatorSettings, frames = 600) => {
    const engine = engineOf(s, 7);
    const bits = new Float64Array(1);
    const words = new Uint32Array(bits.buffer);
    let hash = 0x811c9dc5;
    for (let i = 0; i < frames; i++) {
      run(engine, 1);
      for (const b of engine.getBalls()) {
        for (const v of [b.x, b.y]) {
          bits[0] = v;
          hash = Math.imul(hash ^ words[0], 0x01000193);
          hash = Math.imul(hash ^ words[1], 0x01000193);
        }
      }
    }
    const view = engine.getUnlimitedView();
    return { hash: hash >>> 0, balls: engine.getBalls().length, runtime: view.on, full: view.full };
  };
  const BALLS_RULE = { param: "balls", trigger: "bounce", every: 1, op: "multiply", amount: 2, scope: "ball" };

  it("plays every mode's default run unchanged with fbl=3000, and with cprc=100 and the Ring off", { timeout: 240_000 }, () => {
    // (fbl=2001 ran Glass Smash's one ball, Drop, Race, Maze and Colour Sort with the extreme-values runtime, its speed badge
    // in the clip; cprc=100 the free orbs of Collision Playground)
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      const base = runPrint(d);
      expect([mode, base.runtime]).toEqual([mode, false]);
      for (const patch of [{ fullBallLimit: 3000 }, { cpRingCount: 100, cpRing: false }] as Partial<SimulatorSettings>[]) {
        const s = presetToSettings({ ...d, ...patch });
        expect([mode, patch, uncappedEngaged(s), pastAnyMemoryCeiling(s)]).toEqual([mode, patch, false, false]);
        expect([mode, patch, runPrint(s)]).toEqual([mode, patch, base]);
      }
    }
    expect([...inactiveEngineKeys({ ...defaultSettings("collide"), cpRing: false })]).toEqual(["cpRingCount"]);
    expect(inactiveEngineKeys({ ...defaultSettings("collide"), cpRing: true }).size).toBe(0);
  });

  it("fbl: applies once something else engages the runtime", () => {
    const engaged = presetToSettings({ ...defaultSettings("classic"), ballSpeed: 1e6, fullBallLimit: 3000 });
    expect(uncappedEngaged(engaged)).toBe(true);
    expect(physicsConfigOfSettings(engaged)).toMatchObject({ unlimited: true, fullBallLimit: 3000 });
  });

  it("swl: counts only where a swarm grows – Multiply, a respawn timer that is on, a bounce math balls rule", () => {
    const classic = presetToSettings({ ...defaultSettings("classic"), swarmLimit: 300 });
    expect([uncappedEngaged(classic), pastAnyMemoryCeiling(classic)]).toEqual([false, false]);
    expect(runPrint(classic)).toEqual(runPrint(defaultSettings("classic")));
    expect(uncappedEngaged({ ...classic, bounceMath: [{ ...BALLS_RULE, param: "speed" }] } as unknown as SimulatorSettings)).toBe(false); // (a rule on another number grows no swarm)
    expect(uncappedEngaged({ ...classic, respawnEvery: 1 })).toBe(true);
    expect(uncappedEngaged({ ...classic, bounceMath: [BALLS_RULE] } as unknown as SimulatorSettings)).toBe(true);
    expect(uncappedEngaged(presetToSettings({ ...defaultSettings("multiply"), swarmLimit: 300 }))).toBe(true);
    // a respawn timer on in a mode without one (Shatter), and a balls rule where it copies nothing (Glass Smash): no swarm
    expect(uncappedEngaged(presetToSettings({ ...defaultSettings("shatter"), swarmLimit: 300, respawnEvery: 1 }))).toBe(false);
    expect(uncappedEngaged(presetToSettings({ ...defaultSettings("glass"), swarmLimit: 300, bounceMath: [BALLS_RULE] } as unknown as SimulatorSettings))).toBe(false);
  });

  it("cprc: on the Ring, only as far as there are orbs to put there", () => {
    const ring = presetToSettings({ ...defaultSettings("collide"), cpRing: true, cpCount: 20, cpRingCount: 100 });
    expect(uncappedEngaged(ring)).toBe(false); // (20 orbs: the ring holds 20 at 36 and at 100)
    expect(runPrint(ring, 300)).toEqual(runPrint(presetToSettings({ ...ring, cpRingCount: RING_MAX_BODIES }), 300));
    expect(uncappedEngaged({ ...ring, cpCount: 300 })).toBe(true); // (300 orbs: the ring holds 100)
    expect(uncappedEngaged({ ...ring, cpCount: 50 })).toBe(true); // (50 orbs: 50 on the ring, 36 at the default)
  });

  it("past their memory-safety ceilings the limits say no ARENA FULL in runs that build nothing less", () => {
    expect([...LIMIT_CEILING_KEYS].sort()).toEqual(["cpRingCount", "fullBallLimit", "swarmLimit"]);
    for (const key of LIMIT_CEILING_KEYS) expect(MEMORY_CEILINGS[key]).toBeGreaterThan(0); // (each keeps its ceiling: a value past it builds what one at it builds)
    const cases: Partial<SimulatorSettings>[] = [
      { mode: "classic", fullBallLimit: 10_000 },
      { mode: "classic", fullBallLimit: 10_000, ballSpeed: 1e6 },
      { mode: "multiply", swarmLimit: 2_000_000 },
      { mode: "collide", cpRing: false, cpRingCount: 6000 },
      { mode: "collide", cpRing: true, cpRingCount: 6000 },
    ];
    for (const patch of cases) {
      const s = presetToSettings({ ...defaultSettings(patch.mode!), ...patch });
      expect([patch, pastAnyMemoryCeiling(s)]).toEqual([patch, false]);
      expect([patch, runPrint(s, 60).full]).toEqual([patch, false]);
    }
    // a limit past its ceiling says exactly what one at the ceiling says: ARENA FULL only where the orbs themselves pass theirs
    for (const cpCount of [300, MEMORY_CEILINGS.cpCount, MEMORY_CEILINGS.cpCount + 1]) {
      const at = presetToSettings({ ...defaultSettings("collide"), cpRing: true, cpCount, cpRingCount: MEMORY_CEILINGS.cpRingCount });
      expect([cpCount, pastAnyMemoryCeiling({ ...at, cpRingCount: MEMORY_CEILINGS.cpRingCount + 1000 })]).toEqual([cpCount, pastAnyMemoryCeiling(at)]);
    }
    expect(pastAnyMemoryCeiling(presetToSettings({ ...defaultSettings("collide"), cpRing: true, cpCount: MEMORY_CEILINGS.cpCount + 1 }))).toBe(true);
    // engaged, the swarm past the crowd's ceiling stops where one at the ceiling does
    expect(engagedSwarmCeiling({ swarmLimit: 2_000_000 })).toBe(MEMORY_CEILINGS.swarmLimit);
  });
});
