import { describe, expect, it } from "vitest";
import { BlueprintRun, TRIGGERS, ACTIONS, sanitizeBlueprint, validateBlueprint, type Blueprint } from "@/lib/blueprint";

/*
 * --- blueprint --- The interpreter (src/lib/blueprint/runtime/): one scenario per trigger and per action, each with a
 * visible effect, plus the run's contracts – the same seed replays exactly, a different seed differs, the ceilings and
 * per-step budgets hold, an action's event waits for the next step, and nothing ever reads a clock.
 */

/** A valid spec from a compact one (the test fails on any validation error: scenarios are real specs). */
function spec(raw: Record<string, unknown>): Blueprint {
  const full = { v: 1, meta: { name: "Scenario" }, finish: { timeoutSec: 30 }, ...raw };
  expect(validateBlueprint(full)).toEqual([]);
  return sanitizeBlueprint(full).blueprint;
}

function run(bp: Blueprint, seconds: number, seed = 1): BlueprintRun {
  const r = new BlueprintRun(bp, { seed });
  for (let i = 0; i < Math.round(seconds * 60) && !r.finished; i++) r.step();
  return r;
}

const ball = { id: "ball", radius: 8 };
const one = (extra: Record<string, unknown> = {}) => ({ bodies: [ball], spawners: [{ body: "ball", speed: 300, ...extra }] });
const count = (when: string, extra: Record<string, unknown> = {}) => ({ vars: [{ id: "hits" }], rules: [{ when, ...extra, do: [{ act: "var", id: "hits", op: "add", value: 1 }] }] });

describe("blueprint runtime: every trigger fires where it should", () => {
  const scenarios: Record<(typeof TRIGGERS)[number], { raw: Record<string, unknown>; seconds: number; expect: (hits: number) => boolean }> = {
    start: { raw: { ...one(), ...count("start") }, seconds: 1, expect: (h) => h === 1 },
    timer: { raw: { ...one(), ...count("timer", { sec: 0.5 }) }, seconds: 2.05, expect: (h) => h === 4 },
    beat: { raw: { ...one(), ...count("beat"), sound: { bpm: 120 } }, seconds: 2.05, expect: (h) => h === 4 },
    bar: { raw: { ...one(), ...count("bar"), sound: { bpm: 120 } }, seconds: 4.05, expect: (h) => h === 2 },
    wallHit: { raw: { ...one({ dir: "right" }), ...count("wallHit") }, seconds: 2, expect: (h) => h >= 2 },
    obstacleHit: { raw: { ...one({ at: "top", dir: "down" }), obstacles: [{ kind: "peg", x: 0, y: 0, r: 0.2 }], ...count("obstacleHit") }, seconds: 1.5, expect: (h) => h >= 1 },
    tileHit: { raw: { ...one({ dir: "up" }), tiles: { layout: "grid", rows: 1, cols: 4, hp: 3, area: { x: -0.6, y: -0.6, w: 1.2, h: 0.2 } }, ...count("tileHit") }, seconds: 2, expect: (h) => h >= 1 },
    tileBroken: { raw: { ...one({ dir: "up" }), tiles: { layout: "grid", rows: 1, cols: 4, hp: 1, area: { x: -0.6, y: -0.6, w: 1.2, h: 0.2 } }, ...count("tileBroken") }, seconds: 2, expect: (h) => h >= 1 },
    // (big balls: a side spawn point lies anywhere along its side, and these must meet)
    ballHit: { raw: { bodies: [{ id: "ball", radius: 75 }], spawners: [{ body: "ball", at: "left", dir: "right", speed: 200 }, { body: "ball", at: "right", dir: "left", speed: 200 }], ...count("ballHit") }, seconds: 2, expect: (h) => h >= 1 },
    escape: { raw: { ...one({ dir: "up" }), arena: { exits: [{ atDeg: 0, widthDeg: 60 }] }, ...count("escape") }, seconds: 2, expect: (h) => h === 1 },
    ringPass: { raw: { ...one({ speed: 400 }), arena: { shape: "rings", rings: { count: 3, gapDeg: 90, spinDegPerSec: 60 } }, ...count("ringPass") }, seconds: 20, expect: (h) => h >= 1 },
    countReached: { raw: { bodies: [ball], spawners: [{ body: "ball", everySec: 0.25, maxTotal: 6 }], vars: [{ id: "hits" }], rules: [{ when: "countReached", what: "balls", atLeast: 4, do: [{ act: "var", id: "hits", op: "add", value: 1 }] }] }, seconds: 3, expect: (h) => h === 1 },
  };
  for (const trigger of TRIGGERS)
    it(`${trigger}`, () => {
      const s = scenarios[trigger];
      const r = run(spec(s.raw), s.seconds);
      const hits = r.vars[0];
      expect(s.expect(hits), `${trigger}: ${hits}`).toBe(true);
    });
});

describe("blueprint runtime: every action does what it says", () => {
  /** The ball after one wall hit fired the action (the ball goes right at 300 px/s: its first wall hit is at about 0.7 s). */
  const onWall = (action: Record<string, unknown>, extra: Record<string, unknown> = {}) => spec({ bodies: [ball], spawners: [{ body: "ball", dir: "right", speed: 300 }], rules: [{ when: "wallHit", maxFires: 1, do: [action] }], ...extra });
  const first = (r: BlueprintRun) => r.world.balls.find((b) => b.alive)!;
  const speedOf = (r: BlueprintRun) => Math.hypot(first(r).vx, first(r).vy);

  const checks: Record<(typeof ACTIONS)[number], () => void> = {
    spawn: () => expect(run(onWall({ act: "spawn", body: "ball", count: 3 }), 1.2).world.aliveCount()).toBe(4),
    split: () => {
      const r = run(onWall({ act: "split", into: 4, scale: 0.5 }), 1.2);
      expect(r.world.aliveCount()).toBe(4);
      expect(r.world.balls.every((b) => b.r === 4)).toBe(true);
    },
    merge: () => {
      const bp = spec({ bodies: [{ id: "ball", radius: 75 }], spawners: [{ body: "ball", at: "left", dir: "right", speed: 200 }, { body: "ball", at: "right", dir: "left", speed: 200 }], rules: [{ when: "ballHit", with: "sameTier", do: [{ act: "merge" }] }] });
      const r = run(bp, 2);
      expect(r.world.aliveCount()).toBe(1);
      expect(first(r).tier).toBe(2);
      expect(first(r).r).toBeCloseTo(Math.SQRT2 * 75, 6);
    },
    remove: () => expect(run(onWall({ act: "remove" }), 1.2).world.aliveCount()).toBe(0),
    grow: () => expect(first(run(onWall({ act: "grow", by: 5 }), 1.2)).r).toBe(13),
    speed: () => expect(speedOf(run(onWall({ act: "speed", scale: 2 }), 1.2))).toBeCloseTo(600, 6),
    recolor: () => expect(first(run(onWall({ act: "recolor", color: 4 }), 1.2)).color).toBe(4),
    tier: () => expect(first(run(onWall({ act: "tier", by: 2 }), 1.2)).tier).toBe(3),
    team: () => expect(first(run(onWall({ act: "team", to: 5 }), 1.2)).team).toBe(5),
    damage: () => {
      const bp = spec({
        bodies: [ball],
        spawners: [{ body: "ball", dir: "up", speed: 300 }],
        tiles: { rows: 1, cols: 1, hp: 50, area: { x: -0.5, y: -0.6, w: 1, h: 0.2 } },
        vars: [{ id: "hits" }],
        rules: [{ when: "tileHit", do: [{ act: "damage", amount: 100 }] }, { when: "tileBroken", do: [{ act: "var", id: "hits", op: "add", value: 1 }] }],
      });
      const r = run(bp, 1.5);
      expect(r.world.tilesAlive).toBe(0);
      expect(r.vars[0]).toBe(1); // (the tileBroken the action caused fired its rule – on the next step)
    },
    var: () => expect(run(onWall({ act: "var", id: "v1", op: "set", value: "7 * 6" }, { vars: [{ id: "v1" }] }), 1.2).vars[0]).toBe(42),
    impulse: () => expect(speedOf(run(onWall({ act: "impulse", dir: "up", amount: 400 }), 1.2))).toBeCloseTo(500, 6),
    fx: () => expect(run(onWall({ act: "fx", kind: "confetti" }), 1.2).stats.effects).toBe(1),
    sound: () => {
      const quiet = { voices: { wallHit: "none" } };
      expect(run(onWall({ act: "sound", voice: "split" }, { sound: quiet }), 1.2).stats.sounds).toBe(1);
    },
  };
  for (const action of ACTIONS) it(`${action}`, checks[action]);

  it("acts on every ball when a trigger has no ball, and on the rule's body only", () => {
    const bp = spec({ bodies: [ball, { id: "big", radius: 12 }], spawners: [{ body: "ball", count: 3 }, { body: "big", count: 2 }], rules: [{ when: "start", of: "big", do: [{ act: "grow", by: 3 }] }] });
    const r = run(bp, 0.1);
    expect(r.world.balls.filter((b) => b.r === 15)).toHaveLength(2);
    expect(r.world.balls.filter((b) => b.r === 8)).toHaveLength(3);
  });

  it("evaluates formulas over the run's names, and refuses a meaningless result", () => {
    const bp = spec({ bodies: [ball], vars: [{ id: "score", start: 2 }], spawners: [{ body: "ball", dir: "right" }], rules: [{ when: "wallHit", maxFires: 1, do: [{ act: "grow", by: "score * 3 + tier" }, { act: "speed", scale: "sqrt(-1)" }] }] });
    const r = run(bp, 1.2);
    expect(r.world.balls[0].r).toBe(8 + 7);
    expect(r.stats.refusedActions).toBe(1);
  });
});

describe("blueprint runtime: its contracts", () => {
  const busy = () => spec({ bodies: [ball, { id: "red", radius: 9, team: 1 }], spawners: [{ body: "ball", at: "random", count: 6 }, { body: "red", at: "random", count: 6 }], rules: [{ when: "ballHit", with: "otherTeam", chance: 0.5, do: [{ act: "team", target: "other", to: "self" }] }], finish: { timeoutSec: 30, any: [{ when: "teamsLeft", atMost: 1 }] } });
  const snapshot = (r: BlueprintRun) => JSON.stringify({ balls: r.world.balls.map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.r, b.team]), stats: r.stats, result: r.result() });

  it("replays a seed exactly, and another seed differs", () => {
    expect(snapshot(run(busy(), 8, 11))).toBe(snapshot(run(busy(), 8, 11)));
    expect(snapshot(run(busy(), 8, 11))).not.toBe(snapshot(run(busy(), 8, 12)));
  });

  it("draws randomness only where the spec asks: a spec with none plays the same for every seed", () => {
    const fixed = spec({ bodies: [ball], spawners: [{ body: "ball", dir: "right" }], rules: [{ when: "wallHit", do: [{ act: "grow", by: 1 }] }] });
    expect(snapshot(run(fixed, 3, 1))).toBe(snapshot(run(fixed, 3, 999)));
  });

  it("stops at the ball ceiling with ARENA FULL, adds at most 8 balls a step, and never throws", () => {
    const bomb = spec({ bodies: [{ id: "ball", radius: 3 }], spawners: [{ body: "ball", count: 8, speed: 400 }], rules: [{ when: "wallHit", do: [{ act: "split", into: 8 }] }, { when: "timer", sec: 0.02, do: [{ act: "spawn", body: "ball", count: 8, at: "random" }] }] });
    const r = new BlueprintRun(bomb, { seed: 3 });
    let last = r.world.aliveCount();
    for (let i = 0; i < 600; i++) {
      r.step();
      const now = r.world.aliveCount();
      expect(now - last).toBeLessThanOrEqual(8);
      expect(now).toBeLessThanOrEqual(400);
      last = now;
    }
    expect(r.stats.peakBalls).toBe(400);
    expect(r.stats.arenaFull).toBeGreaterThan(0);
    expect(r.stats.faults).toBe(0);
  });

  it("keeps a rule ping-pong inside the per-step budgets", () => {
    const pingPong = spec({ bodies: [{ id: "ball", radius: 14 }], spawners: [{ body: "ball", count: 8, at: "random" }, { body: "ball", count: 8, at: "random" }, { body: "ball", count: 8, at: "random" }], rules: [{ when: "ballHit", do: [{ act: "impulse", dir: "away", amount: 50 }, { act: "sound" }] }, { when: "wallHit", do: [{ act: "impulse", dir: "in", amount: 200 }] }] });
    const r = run(pingPong, 10, 5);
    expect(r.stats.firings / r.stats.steps).toBeLessThanOrEqual(64);
    expect(r.stats.events / r.stats.steps).toBeLessThanOrEqual(512);
    expect(r.stats.faults).toBe(0);
  });

  it("contains a fault: the rules stop and the run ends 1 s later with reason fault", () => {
    const r = new BlueprintRun(busy(), { seed: 2, faultOnRule: 0 });
    for (let i = 0; i < 60 * 30 && !r.finished; i++) r.step();
    const result = r.result();
    expect(result.reason).toBe("fault");
    expect(r.stats.faults).toBe(1);
    expect(result.timeSec).toBeLessThan(5);
  });

  it("takes a ball gone non-finite out of play and counts it, instead of spreading NaN", () => {
    const nan = spec({ arena: { gravity: { x: 0, y: 1e308 } }, bodies: [ball], spawners: [{ body: "ball", speed: 1e308 }] });
    const r = run(nan, 2);
    expect(r.stats.nanBalls).toBeGreaterThan(0);
    expect(r.world.balls.every((b) => Number.isFinite(b.x) && Number.isFinite(b.vy))).toBe(true);
  });

  it("starts the balls an escape spawns inside the arena, not where the escaped ball went", () => {
    const bp = spec({ bodies: [ball], spawners: [{ body: "ball", dir: "up", speed: 300 }], arena: { exits: [{ atDeg: 0, widthDeg: 60 }] }, rules: [{ when: "escape", maxFires: 1, do: [{ act: "spawn", body: "ball", count: 2, at: "self", speed: 0 }] }] });
    const r = run(bp, 2);
    expect(r.stats.escaped).toBe(1);
    expect(r.world.aliveCount()).toBe(2);
    for (const b of r.world.balls) expect(r.world.insideArena(b.x, b.y)).toBe(true);
  });

  it("ends by the first condition met, fills the result line, and names the winner", () => {
    const bp = spec({ bodies: [ball], spawners: [{ body: "ball", dir: "up", speed: 300 }], arena: { exits: [{ atDeg: 0, widthDeg: 60 }] }, look: { teamNames: ["ORANGE"] }, finish: { timeoutSec: 30, winner: "firstOut", any: [{ when: "escaped", say: "{winner} OUT IN {time}" }] } });
    const r = run(bp, 3);
    expect(r.result()).toMatchObject({ finished: true, reason: "condition", condition: 0, winner: 0 });
    expect(r.result().result).toMatch(/^ORANGE OUT IN \d+\.\d s$/);
  });
});
