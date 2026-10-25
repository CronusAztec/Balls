import { describe, expect, it } from "vitest";
import { HeadlessBlueprint, TRIGGERS, ACTIONS, sanitizeBlueprint, validateBlueprint, type Blueprint } from "@/lib/blueprint";

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

function run(bp: Blueprint, seconds: number, seed = 1): HeadlessBlueprint {
  const r = new HeadlessBlueprint(bp, { seed });
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
  const first = (r: HeadlessBlueprint) => r.world.balls.find((b) => b.alive)!;
  const speedOf = (r: HeadlessBlueprint) => Math.hypot(first(r).vx, first(r).vy);

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

// --- review fix (blueprint) --- a contact is one event, its self the ball that came in faster; a tile's events are facts
describe("blueprint runtime: contacts and the events of a step", () => {
  it("makes self of a ballHit the ball that was faster before the hit, not the one the bounce left faster", () => {
    // (equal balls swap their speeds in a head-on hit: measured after it, the slow ball would convert the fast one)
    const bp = spec({ arena: { gravity: { x: 0, y: 0 } }, bodies: [{ id: "fast", radius: 10, team: 0 }, { id: "slow", radius: 10, team: 1 }], spawners: [{ body: "fast", at: "left", dir: "right", speed: 300 }, { body: "slow", at: "right", dir: "left", speed: 50 }], vars: [{ id: "hits" }], rules: [{ when: "ballHit", maxFires: 1, do: [{ act: "team", target: "other", to: "self" }, { act: "grow", target: "self", by: 5 }, { act: "var", id: "hits" }] }] });
    for (const seed of [1, 3, 5]) {
      const r = new HeadlessBlueprint(bp, { seed });
      let before: number[] = [];
      for (let i = 0; i < 60 * 5 && r.vars[0] === 0; i++) {
        before = r.world.balls.map((b) => Math.round(Math.hypot(b.vx, b.vy)));
        r.step();
      }
      expect(before, `seed ${seed}`).toEqual([300, 50]);
      const [fast, slow] = r.world.balls;
      expect([r.vars[0], fast.team, slow.team, fast.r, slow.r], `seed ${seed}`).toEqual([1, 0, 0, 15, 10]);
    }
  });

  it("raises one ballHit a contact: a heap at rest stays quiet, and two balls passing through each other raise one", () => {
    const heap = spec({ arena: { gravity: { x: 0, y: 400 }, restitution: 0.3 }, bodies: [{ id: "ball", radius: 10 }], spawners: [{ body: "ball", at: "random", count: 8, everySec: 0.1, maxTotal: 40, speed: 0 }], vars: [{ id: "hits" }], rules: [{ when: "ballHit", do: [{ act: "var", id: "hits" }, { act: "sound", voice: "hit" }] }] });
    const r = run(heap, 8);
    expect(r.world.aliveCount()).toBe(40);
    const [hits, sounds] = [r.vars[0], r.stats.sounds];
    expect(hits).toBeGreaterThan(40);
    for (let i = 0; i < 300; i++) r.step();
    expect([r.vars[0] - hits, r.stats.sounds - sounds]).toEqual([0, 0]);
    const ghosts = spec({ arena: { gravity: { x: 0, y: 0 } }, bodies: [{ id: "ghost", radius: 75, collide: "pass" }], spawners: [{ body: "ghost", at: "left", dir: "right", speed: 200 }, { body: "ghost", at: "right", dir: "left", speed: 200 }], ...count("ballHit") });
    expect(run(ghosts, 1.5).vars[0]).toBe(1);
  });

  it("starts a contact again when a rule changes either ball's tier or team: an orb merged up to its neighbour's tier merges on", () => {
    const bp = spec({ arena: { gravity: { x: 0, y: 600 }, restitution: 0.2 }, bodies: [{ id: "a", radius: 30, tier: 1 }, { id: "b", radius: 30, tier: 2, color: 1 }], spawners: [{ body: "a", at: "left", speed: 0 }, { body: "b", at: "right", speed: 0 }], vars: [{ id: "merges" }], rules: [{ when: "ballHit", with: "sameTier", do: [{ act: "merge" }, { act: "var", id: "merges" }] }, { when: "timer", sec: 3, of: "a", maxFires: 1, do: [{ act: "tier", by: 1 }] }] });
    const r = run(bp, 2.9);
    const [a, b] = r.world.balls;
    // (resting against each other at the bowl's bottom: one contact, no new hit)
    expect(Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r).toBeLessThan(1);
    expect([r.world.aliveCount(), r.vars[0]]).toEqual([2, 0]);
    for (let i = 0; i < 60; i++) r.step();
    expect([r.world.aliveCount(), r.vars[0], r.world.balls.find((x) => x.alive)!.tier]).toEqual([1, 1, 3]);
  });

  it("runs a tile's rules after an earlier rule removed its ball: tileHit → remove, then tileBroken → spawn at the tile", () => {
    const shots = { arena: { gravity: { x: 0, y: 0 } }, vars: [{ id: "broke" }], spawners: [{ body: "shot", at: "bottom", dir: "up", speed: 400, everySec: 0.25, maxTotal: 40 }] };
    const grid = (hp: number) => ({ layout: "grid", rows: 2, cols: 10, hp, area: { x: -0.8, y: -0.8, w: 1.6, h: 0.3 } });
    const bp = spec({ ...shots, bodies: [{ id: "shot", radius: 5 }, { id: "shard", radius: 3, gravityScale: 0, color: 1, collide: "pass" }], tiles: grid(1), rules: [{ when: "tileHit", of: "shot", do: [{ act: "remove" }] }, { when: "tileBroken", do: [{ act: "var", id: "broke" }, { act: "spawn", body: "shard", at: "tile", speed: 0 }] }] });
    const r = run(bp, 12);
    const shards = r.world.balls.filter((b) => b.alive && b.body === 1);
    const f = r.world.tiles;
    const atATile = shards.filter((s) => Array.from({ length: r.world.tileCount }, (_, i) => Math.hypot(f.px[i] - s.x, f.py[i] - s.y)).some((d) => d < 0.5));
    expect(r.stats.tilesBroken).toBeGreaterThan(10);
    expect([r.vars[0], shards.length, atATile.length]).toEqual([r.stats.tilesBroken, r.stats.tilesBroken, r.stats.tilesBroken]);
    // a damage that breaks the tile raises its tileBroken the next step, by when the shot is gone: it still runs
    const damaged = spec({ ...shots, bodies: [{ id: "shot", radius: 5 }], tiles: grid(3), rules: [{ when: "tileHit", do: [{ act: "damage", amount: 5 }, { act: "remove" }] }, { when: "tileBroken", do: [{ act: "var", id: "broke" }] }] });
    const d = run(damaged, 12);
    expect(d.stats.tilesBroken).toBeGreaterThan(10);
    expect(d.vars[0]).toBe(d.stats.tilesBroken);
  });

  it("queues no event a rule does not listen to: a crowd's contacts never crowd out the tiles a rule waits for", () => {
    const bp = spec({ arena: { gravity: { x: 0, y: 400 }, restitution: 0.9 }, bodies: [{ id: "sand", radius: 6 }, { id: "shot", radius: 5, gravityScale: 0, color: 1 }], vars: [{ id: "broke" }], tiles: { rows: 6, cols: 16, hp: 1, area: { x: -0.7, y: -0.75, w: 1.4, h: 0.45 } }, spawners: [{ body: "sand", at: "bottom", count: 8, speed: 0, everySec: 0.05, maxTotal: 260 }, { body: "shot", at: "center", count: 3, speed: 600, dir: "up", startSec: 3 }], rules: [{ when: "tileBroken", of: "shot", do: [{ act: "var", id: "broke" }, { act: "spawn", body: "shot", at: "tile", speed: 600 }] }], finish: { any: [{ when: "tilesCleared" }], timeoutSec: 40 } });
    const r = new HeadlessBlueprint(bp, { seed: 1 });
    expect(r.runToEnd()).toMatchObject({ reason: "condition" });
    expect([r.stats.tilesBroken, r.vars[0], r.stats.droppedEvents]).toEqual([96, 96, 0]);
    // (nothing listens to a wall, a peg or a contact here: only the tiles' events and the start were queued)
    expect(r.stats.events).toBeLessThanOrEqual(2 * 96 + 1);
  });
});

describe("blueprint runtime: its contracts", () => {
  const busy = () => spec({ bodies: [ball, { id: "red", radius: 9, team: 1 }], spawners: [{ body: "ball", at: "random", count: 6 }, { body: "red", at: "random", count: 6 }], rules: [{ when: "ballHit", with: "otherTeam", chance: 0.5, do: [{ act: "team", target: "other", to: "self" }] }], finish: { timeoutSec: 30, any: [{ when: "teamsLeft", atMost: 1 }] } });
  const snapshot = (r: HeadlessBlueprint) => JSON.stringify({ balls: r.world.balls.map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.r, b.team]), stats: r.stats, result: r.result() });

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
    const r = new HeadlessBlueprint(bomb, { seed: 3 });
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
    const r = new HeadlessBlueprint(busy(), { seed: 2, faultOnRule: 0 });
    for (let i = 0; i < 60 * 30 && !r.finished; i++) r.step();
    const result = r.result();
    expect(result.reason).toBe("fault");
    expect(r.stats.faults).toBe(1);
    expect(result.timeSec).toBeLessThan(5);
  });

  it("takes a ball gone non-finite out of play and counts it, instead of spreading NaN", () => {
    // (a spawn speed past BLUEPRINT_SPEED_CEILING is refused by the validator now: gravity × gravityScale overflows instead)
    const nan = spec({ arena: { gravity: { x: 0, y: 1e308 } }, bodies: [{ ...ball, gravityScale: 1e308 }], spawners: [{ body: "ball", speed: 300 }] });
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

  // --- review fix (blueprint) --- a growing ball's loss is the world's: the balls that still fit between an exit's edges
  it("counts the balls that fit through an exit (`fit`): a growing ball stops fitting on the bounce it outgrows the widest exit", () => {
    const exits = [
      { atDeg: 90, widthDeg: 10 },
      { atDeg: 180, widthDeg: 21 },
    ];
    const bp = spec({
      arena: { size: 0.92, exits },
      bodies: [ball, { id: "big", radius: 40 }],
      spawners: [{ body: "ball", at: "top", dir: "up", speed: 200 }, { body: "big", at: "center", speed: 0 }],
      vars: [{ id: "fits" }],
      rules: [{ when: "wallHit", of: "ball", do: [{ act: "grow", by: 1 }, { act: "var", id: "fits", op: "set", value: "size" }] }],
      finish: { timeoutSec: 60, any: [{ when: "count", what: "fit", atMost: 0, say: "TOO BIG {fits}" }] },
      hud: [{ show: "fit", label: "fit" }],
    });
    // the widest exit decides: 21° of the 207 px rim leaves 207 × sin(10.5°) px each side of the centre, less the edges' 2 px
    const room = 207 * Math.sin((10.5 * Math.PI) / 180) - 2;
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    expect(h.world.exitFitRadius()).toBeCloseTo(room, 9);
    // the 40 px ball never fits; the 8 px one does, and `of` counts one body's
    expect([h.run.count("fit"), h.run.count("fit", 0), h.run.count("fit", 1)]).toEqual([1, 1, 0]);
    let fitted = 0;
    for (let i = 0; i < 60 * 60 && !h.finished; i++) {
      const before = h.world.balls[0].r;
      h.step();
      if (!h.finished) fitted = Math.max(fitted, before);
    }
    expect(h.result()).toMatchObject({ finished: true, reason: "condition", condition: 0 });
    const r = h.world.balls[0].r;
    // it ended on the bounce the ball outgrew the exit, and the result line says its size then
    expect([r > room, r - 1 <= room, fitted <= room]).toEqual([true, true, true]);
    expect(h.result().result).toBe(`TOO BIG ${Math.round(r)}`);
    // without an exit no ball fits (and the condition never arms: it was never unmet)
    const closed = new HeadlessBlueprint(spec({ ...one(), finish: { timeoutSec: 5, any: [{ when: "count", what: "fit", atMost: 0 }] } }), { seed: 1 });
    expect([closed.world.exitFitRadius(), closed.run.count("fit")]).toEqual([-Infinity, 0]);
    expect(closed.runToEnd()).toMatchObject({ reason: "timeout" });
  });

  // --- review fix (blueprint) --- a ball a hair too wide met both edges side-on and squeezed out: TOO BIG TO ESCAPE, then gone
  it("holds a ball too big for an exit, however straight and fast it comes, and lets one that fits out", () => {
    const room = 207 * Math.sin((10.5 * Math.PI) / 180) - 2;
    const shot = (radius: number, speed: number) =>
      spec({
        arena: { size: 0.92, exits: [{ atDeg: 0, widthDeg: 21 }] },
        bodies: [{ id: "ball", radius }],
        spawners: [{ body: "ball", at: "center", dir: "up", speed }],
        ...count("escape"),
      });
    for (const speed of [300, 1500, 4000]) {
      const big = run(shot(Math.ceil(room * 10) / 10, speed), 5);
      expect([speed, big.world.exitFitRadius() < big.world.balls[0].r, big.stats.escaped, big.world.aliveCount()]).toEqual([speed, true, 0, 1]);
      const small = run(shot(Math.floor(room) - 1, speed), 5);
      expect([speed, small.stats.escaped]).toEqual([speed, 1]);
    }
  });
});
