import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { settingsFromSearchParams } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import {
  BLUEPRINT_ACTION_BALLS_PER_STEP,
  BLUEPRINT_MAX_SUBSTEPS,
  BLUEPRINT_PAIR_TESTS_PER_STEP,
  BLUEPRINT_PAIR_VISITS_PER_STEP,
  BLUEPRINT_RADIUS_CEILING,
  BLUEPRINT_RUN_CONFIG,
  CHECK_CROWDED_STEPS,
  CHECK_HEAVY_STEP_COST,
  HeadlessBlueprint,
  PlayabilityRun,
  SeedCheck,
  checkSeed,
  describeBlueprint,
  encodeBlueprint,
  judgeSeeds,
  liteToBlueprint,
  playabilityCheck,
  sanitizeBlueprint,
  validateBlueprint,
  type Blueprint,
} from "@/lib/blueprint";

/*
 * --- review fix (blueprint) --- The sandbox against the review's hostile specs: every ball the canvas sees is finite and no
 * bigger than the world; a step's work is bounded, not only its ball count (big balls, formulas on every ball, split storms,
 * tiny fast balls); every rule of an event runs; the check plays a seed to its decided end in slices and stops, on counts
 * alone, a seed a tab could not play; and the summary an AI reads quotes a spec's texts as data.
 */

function spec(raw: Record<string, unknown>): Blueprint {
  const full = { v: 1, meta: { name: "Hostile" }, finish: { timeoutSec: 30 }, ...raw };
  expect(validateBlueprint(full)).toEqual([]);
  return sanitizeBlueprint(full).blueprint;
}

/** Every engine ball and every ball of the world is a number the canvas can draw. */
function allFinite(engine: PhysicsEngine): boolean {
  for (const b of engine.getBalls()) if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy) && Number.isFinite(b.radius) && b.radius > 0 && b.radius <= BLUEPRINT_RADIUS_CEILING)) return false;
  return true;
}

/** A link code played in the engine, every ball checked after every step. */
function playCode(code: string, steps: number) {
  const engine = new PhysicsEngine({ ...BLUEPRINT_RUN_CONFIG });
  engine.setBlueprintSettings({ spec: code });
  engine.setSeed(1);
  engine.initMode("blueprint");
  let finite = true;
  for (let i = 0; i < steps; i++) {
    engine.update(1000 / 60, 0);
    engine.consumeSoundEvents();
    if (!allFinite(engine)) finite = false;
  }
  return { engine, finite };
}

describe("blueprint sandbox: every ball is finite and fits the world", () => {
  it("clamps a radius of 1e308 to the radius ceiling, says so, and plays eight such balls with every ball finite", () => {
    const raw = { v: 1, meta: { name: "Eight big" }, bodies: [{ id: "b", radius: 1e308 }], spawners: [{ body: "b", count: 8 }], finish: { timeoutSec: 30 } };
    expect(validateBlueprint(raw).join("\n")).toMatch(/bodies\[0\]\.radius/);
    const { blueprint, notes } = sanitizeBlueprint(raw);
    expect(blueprint.bodies[0].radius).toBe(BLUEPRINT_RADIUS_CEILING);
    expect(notes.length).toBeGreaterThan(0);
    const { engine, finite } = playCode(encodeBlueprint(blueprint), 120);
    expect(finite).toBe(true);
    expect(engine.getBalls().length).toBe(8);
  });

  it("keeps a split by 1e308 inside the radius ceiling (no ball goes infinite, the loop keeps running)", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], spawners: [{ body: "ball", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "split", scale: 1e308 }] }] });
    const { engine, finite } = playCode(encodeBlueprint(bp), 300);
    expect(finite).toBe(true);
    expect(engine.getBlueprintView().steps).toBe(300);
  });

  it("plays Grow or Go with its grow slider at 1e308 from a link, every ball finite and no bigger than the world", () => {
    const settings = settingsFromSearchParams(new URLSearchParams("mode=blueprint&blp=growEscape&blv=1e308"));
    const engine = createEngineForSettings(physicsConfigOfSettings(settings), "blueprint", modeSettingsOfSettings(settings), 1);
    for (let i = 0; i < 600; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      expect(allFinite(engine), `step ${i}`).toBe(true);
    }
  });

  it("refuses a spawn speed past the speed ceiling and takes out a ball a rule makes faster than it", () => {
    expect(validateBlueprint({ v: 1, meta: { name: "x" }, bodies: [{ id: "b" }], spawners: [{ body: "b", speed: 1e9 }], finish: { timeoutSec: 30 } }).join("\n")).toMatch(/spawners\[0\]\.speed/);
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], spawners: [{ body: "ball", speed: 300, dir: "right" }], rules: [{ when: "wallHit", maxFires: 1, do: [{ act: "speed", scale: 1e6 }] }] });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    for (let i = 0; i < 120; i++) h.step();
    expect(h.stats.fastBalls).toBe(1);
    expect(h.world.aliveCount()).toBe(0);
    expect(allFinite(h.engine)).toBe(true);
  });
});

describe("blueprint sandbox: a step's work is bounded, not only its ball count", () => {
  it("400 balls of the largest legal radius stay under the pair budget every step, the skipped pairs counted", () => {
    const bp = spec({ bodies: [{ id: "big", radius: BLUEPRINT_RADIUS_CEILING }], spawners: [{ body: "big", count: 8, everySec: 0.0001, maxTotal: 400 }], finish: { timeoutSec: 180 } });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    let visits = 0;
    for (let i = 0; i < 120; i++) {
      h.step();
      const step = h.world.pairVisits - visits;
      visits = h.world.pairVisits;
      // (each sub-step's share is rounded up, at most one ball's worth over)
      expect(step, `step ${i}`).toBeLessThanOrEqual(BLUEPRINT_PAIR_TESTS_PER_STEP + 4 * 400);
    }
    expect(h.world.aliveCount()).toBe(400);
    expect(h.stats.droppedPairs).toBeGreaterThan(0);
    expect(h.stats.cost / h.stats.steps).toBeLessThan(CHECK_HEAVY_STEP_COST * 2);
  });

  it("leaves a crowd of 400 balls heaped in a bowl every pair: both pair budgets keep their headroom", () => {
    // 400 balls of 12 px – more than the arena holds – heaped under gravity: on seeds 2 to 4 one budget of grid entries walked
    // ran out within 3 s and the heap's later balls skipped their contacts. (No tiles or obstacles: `work` is pair tests.)
    const bp = spec({ bodies: [{ id: "b", radius: 12 }], arena: { gravity: { x: 0, y: 300 } }, spawners: [{ body: "b", count: 8, everySec: 0.05, maxTotal: 400, at: "random" }], finish: { timeoutSec: 180 } });
    for (const seed of [2, 3, 4]) {
      const h = new HeadlessBlueprint(bp, { seed });
      let tests = 0;
      let visits = 0;
      for (let i = 0; i < 240; i++) {
        h.step();
        expect(h.world.work - tests, `seed ${seed}, step ${i}: pairs tested`).toBeLessThanOrEqual(BLUEPRINT_PAIR_TESTS_PER_STEP / 2);
        expect(h.world.pairVisits - visits, `seed ${seed}, step ${i}: grid entries walked`).toBeLessThanOrEqual(BLUEPRINT_PAIR_VISITS_PER_STEP / 2);
        tests = h.world.work;
        visits = h.world.pairVisits;
      }
      expect([seed, h.world.aliveCount(), h.stats.droppedPairs]).toEqual([seed, 400, 0]);
    }
  });

  it("bounds a heap of medium balls in the same cells by the grid entries it walks and the pairs it tests", () => {
    const bp = spec({ bodies: [{ id: "b", radius: 40 }], arena: { gravity: { x: 0, y: 600 } }, spawners: [{ body: "b", count: 8, everySec: 0.0001, maxTotal: 400, at: "center" }], finish: { timeoutSec: 180 } });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    let tests = 0;
    let visits = 0;
    for (let i = 0; i < 120; i++) {
      h.step();
      // (each sub-step's shares are rounded up: at most one a sub-step over)
      expect(h.world.work - tests, `step ${i}: pairs tested`).toBeLessThanOrEqual(BLUEPRINT_PAIR_TESTS_PER_STEP + BLUEPRINT_MAX_SUBSTEPS);
      expect(h.world.pairVisits - visits, `step ${i}: grid entries walked`).toBeLessThanOrEqual(BLUEPRINT_PAIR_VISITS_PER_STEP + BLUEPRINT_MAX_SUBSTEPS);
      tests = h.world.work;
      visits = h.world.pairVisits;
    }
    expect(h.world.aliveCount()).toBe(400);
    expect(h.stats.droppedPairs).toBeGreaterThan(0);
    expect(h.stats.cost / h.stats.steps).toBeLessThan(CHECK_HEAVY_STEP_COST * 2);
  });

  it("a big ball is tested once against each other ball, not through every cell it covers", () => {
    const bp = spec({ bodies: [{ id: "big", radius: 120 }, { id: "small", radius: 6 }], spawners: [{ body: "big", count: 1, speed: 0 }, { body: "small", count: 8, at: "random", speed: 200 }], finish: { timeoutSec: 30 } });
    const h = new HeadlessBlueprint(bp, { seed: 2 });
    for (let i = 0; i < 60; i++) h.step();
    expect(h.stats.droppedPairs).toBe(0);
    // nine balls, four sub-steps: the big one walks the other eight once a sub-step (plus the small balls' own cells)
    expect(h.world.pairVisits / 60).toBeLessThan(4 * 9 * 20);
  });

  it("formulas on every ball run once a ball, their step-level slots filled once an action, within the action budget", () => {
    const all = (when: string) => ({ when, do: [{ act: "grow", target: "all", by: "0*balls" }, { act: "speed", target: "all", scale: "1+0*balls" }, { act: "tier", target: "all", by: "0*balls" }, { act: "impulse", target: "all", amount: "0*balls" }] });
    const bp = spec({ bodies: [{ id: "b", radius: 4 }], arena: { gravity: { x: 0, y: 0 } }, spawners: [{ body: "b", count: 8, everySec: 0.0001, maxTotal: 400, speed: 400, at: "random" }], rules: [all("wallHit"), all("ballHit")], finish: { timeoutSec: 180 } });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    let changed = 0;
    for (let i = 0; i < 240; i++) {
      h.step();
      expect(h.stats.actionBalls - changed, `step ${i}`).toBeLessThanOrEqual(BLUEPRINT_ACTION_BALLS_PER_STEP);
      changed = h.stats.actionBalls;
    }
    expect(h.stats.droppedActions).toBeGreaterThan(0);
    expect(h.stats.cost / h.stats.steps).toBeLessThan(CHECK_HEAVY_STEP_COST * 2);
  });

  it("fills a formula's step-level slots once an action: every ball of an action on all reads the count at its start", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], spawners: [{ body: "ball", count: 3, speed: 300 }], rules: [{ when: "start", do: [{ act: "grow", target: "all", by: "balls" }] }] });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    h.step();
    expect(h.world.balls.map((b) => b.r)).toEqual([11, 11, 11]);
  });

  it("a split storm at the ball ceiling says ARENA FULL once an action, not once a child", () => {
    const bp = spec({ bodies: [{ id: "b", radius: 6 }], spawners: [{ body: "b", count: 4, speed: 300 }], rules: [{ when: "wallHit", do: [1, 2, 3, 4].map(() => ({ act: "split", target: "all", into: 8 })) }], finish: { timeoutSec: 60 } });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    for (let i = 0; i < 360; i++) h.step();
    expect(h.stats.peakBalls).toBeLessThanOrEqual(400);
    expect(h.stats.arenaFull).toBeGreaterThan(0);
    // at most one note an action and one a refused queued ball: 64 firings × 4 actions + 400 a step
    expect(h.stats.arenaFull / h.stats.steps).toBeLessThan(64 * 4 + 400);
  });

  it(`plans at most ${BLUEPRINT_MAX_SUBSTEPS} sub-steps a step and plays slow motion beyond`, () => {
    const bp = spec({ bodies: [{ id: "b", radius: 2 }], spawners: [{ body: "b", speed: 10_000 }], finish: { timeoutSec: 30 } });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    for (let i = 0; i < 120; i++) h.step();
    expect(h.stats.ballSteps / h.stats.steps).toBeLessThanOrEqual(BLUEPRINT_MAX_SUBSTEPS);
    expect(h.run.timeSec).toBeLessThan(120 / 60 / 2);
  });

  it("never leaves a ball sped up every bounce frozen on the rim, firing a wall hit every step", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], vars: [{ id: "hits" }], spawners: [{ body: "ball", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "speed", scale: 1.05 }, { act: "var", id: "hits" }] }], finish: { timeoutSec: 60, any: [{ when: "count", what: "hits", atLeast: 400, say: "{hits} HITS" }] } });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    let px = NaN;
    let py = NaN;
    let frozenHits = 0;
    let hitsWas = 0;
    for (let i = 0; i < 60 * 120 && !h.finished; i++) {
      h.step();
      const b = h.world.balls[0];
      if (b && b.x === px && b.y === py && h.vars[0] > hitsWas) frozenHits++;
      if (b) [px, py] = [b.x, b.y];
      hitsWas = h.vars[0];
    }
    expect(frozenHits).toBeLessThan(3);
    const report = playabilityCheck(bp, { seeds: [1] });
    expect(report.verdict).toBe("broken");
    expect(report.problems.some((p) => p === "fast" || p === "slow")).toBe(true);
  });
});

describe("blueprint sandbox: rules and counts mean what the guide says", () => {
  const twoBig = { bodies: [{ id: "ball", radius: 75 }], spawners: [{ body: "ball", at: "left", dir: "right", speed: 200 }, { body: "ball", at: "right", dir: "left", speed: 200 }] };

  it("a merge rule followed by a counter rule counts every merge", () => {
    const bp = spec({ ...twoBig, vars: [{ id: "merges" }], rules: [{ when: "ballHit", with: "sameTier", do: [{ act: "merge" }] }, { when: "ballHit", do: [{ act: "var", id: "merges" }] }] });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    for (let i = 0; i < 120; i++) h.step();
    expect(h.world.aliveCount()).toBe(1);
    expect(h.vars[0]).toBe(1);
  });

  it("a remove rule followed by a counter rule on the same wall hit counts it", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], vars: [{ id: "pops" }], spawners: [{ body: "ball", dir: "right", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "remove" }] }, { when: "wallHit", do: [{ act: "var", id: "pops" }] }] });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    for (let i = 0; i < 120; i++) h.step();
    expect([h.world.aliveCount(), h.vars[0]]).toEqual([0, 1]);
  });

  it("the Lite form's 'merge, then score' (two one-action rules) scores", () => {
    const { blueprint } = liteToBlueprint({
      name: "Merge score",
      description: "Merge to score",
      arena: "circle",
      gravity: "normal",
      bounce: "normal",
      spin: "none",
      exit: "none",
      bodies: [{ id: "a", size: "small", color: "gold" }],
      start: [{ body: "a", amount: "many", at: "top", speed: "slow" }],
      rules: [
        { when: "ballHit", with: "sameTier", do: "merge" },
        { when: "ballHit", with: "sameTier", do: "score" },
      ],
      finish: { when: "score", amount: "one", timeout: "medium" },
      hud: ["score", "balls"],
    });
    const h = new HeadlessBlueprint(blueprint, { seed: 1 });
    for (let i = 0; i < 60 * 20 && !h.finished; i++) h.step();
    const merges = h.stats.spawned - h.world.aliveCount();
    const score = h.vars[blueprint.vars.findIndex((v) => v.id === "score")];
    expect(merges).toBeGreaterThan(0);
    // every merge scored: the score rule's step (one point a merge for "one")
    expect(score / merges).toBe(blueprint.rules[1].do[0].act === "var" ? Number(blueprint.rules[1].do[0].value) : NaN);
  });

  it("a countReached bound met from the start fires only once the count went back and crossed it", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], vars: [{ id: "c" }], spawners: [{ body: "ball", speed: 300 }, { body: "ball", startSec: 1, everySec: 0.25, maxTotal: 4, speed: 300 }], rules: [{ when: "countReached", what: "balls", atMost: 3, do: [{ act: "var", id: "c" }] }, { when: "timer", sec: 3, maxFires: 1, do: [{ act: "remove", target: "all" }] }] });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    h.step();
    expect(h.vars[0]).toBe(0);
    for (let i = 0; i < 60 * 4; i++) h.step();
    // 1 ball (baseline: met, no fire) → 5 balls (unmet) → 0 balls at 3 s (met again: fires once)
    expect(h.vars[0]).toBe(1);
  });

  it("refuses a split into a meaningless count and a spawner count that means nothing (counted, never applied)", () => {
    const split = spec({ bodies: [{ id: "ball", radius: 8 }], spawners: [{ body: "ball", dir: "right", speed: 300 }], rules: [{ when: "wallHit", maxFires: 1, do: [{ act: "split", into: "0/0" }] }] });
    const a = new HeadlessBlueprint(split, { seed: 1 });
    for (let i = 0; i < 90; i++) a.step();
    expect([a.world.aliveCount(), a.stats.refusedActions]).toEqual([1, 1]);
    const spawner = spec({ bodies: [{ id: "ball", radius: 8 }], spawners: [{ body: "ball", speed: 300 }, { body: "ball", count: "0/0", startSec: 0.5, speed: 300 }] });
    const b = new HeadlessBlueprint(spawner, { seed: 1 });
    for (let i = 0; i < 60; i++) b.step();
    expect([b.world.aliveCount(), b.stats.refusedActions]).toEqual([1, 1]);
  });

  it("gives a spawner's formulas n = how many times it fired (1 the first time), whatever its period", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 3, collide: "pass" }], arena: { gravity: { x: 0, y: 0 } }, spawners: [{ body: "ball", everySec: 0.005, maxTotal: 6, speed: "n * 10" }] });
    const h = new HeadlessBlueprint(bp, { seed: 1 });
    for (let i = 0; i < 8; i++) h.step();
    expect(h.world.balls.map((b) => Math.round(Math.hypot(b.vx, b.vy)))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("passes a ring only through its gap: a ball too wide for the gap never breaks a ring", () => {
    const bp = spec({ arena: { shape: "rings", rings: { count: 8, gapDeg: 6, inner: 0.2, spinDegPerSec: 0, breakOnPass: true } }, bodies: [{ id: "big", radius: 18 }], vars: [{ id: "passes" }], spawners: [{ body: "big", count: 6, at: "random", speed: 300 }], rules: [{ when: "ringPass", do: [{ act: "var", id: "passes" }] }], finish: { timeoutSec: 60 } });
    for (const seed of [1, 2, 3, 4]) {
      const h = new HeadlessBlueprint(bp, { seed });
      for (let i = 0; i < 60 * 30; i++) h.step();
      expect([seed, h.vars[0], h.world.ringsAlive()]).toEqual([seed, 0, 8]);
    }
  });
});

describe("blueprint check: a seed a tab could not play stops early, and a slowed run is never a timeout", () => {
  it("never reports a run the engine slowed down as a timeout at 0 s with an empty result", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 3 }], spawners: [{ body: "ball", speed: 30_000 }], finish: { timeoutSec: 30, any: [{ when: "count", what: "time", atLeast: 20 }] } });
    const r = checkSeed(bp, 1);
    expect(r.reason).not.toBe("timeout");
    if (r.reason === "condition") expect(r.timeSec).toBeGreaterThanOrEqual(20);
    else expect(r.reason).toBe("slow");
  });

  // --- slow-motion --- the page's Slow motion switch off: the same verdict, worded as too heavy for real time
  it("words a slowed seed as too heavy for real time with the Slow motion switch off, the verdict unchanged", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 3 }], spawners: [{ body: "ball", speed: 30_000 }], finish: { timeoutSec: 30, any: [{ when: "count", what: "time", atLeast: 20 }] } });
    const slowSeed = { ...checkSeed(bp, 1), reason: "slow" as const };
    const on = judgeSeeds(bp, [slowSeed]);
    const off = judgeSeeds(bp, [slowSeed], false);
    expect(off.verdict).toBe(on.verdict);
    expect(off.problems).toEqual(on.problems);
    expect(on.feedback.join(" ")).toContain("It plays in slow motion on seed 1");
    expect(off.feedback.join(" ")).toContain("It is too heavy to play in real time on seed 1");
    expect(playabilityCheck(bp, { seeds: [1], slowMotion: false }).problems).toEqual(playabilityCheck(bp, { seeds: [1] }).problems);
  });

  it("stops a spec of 400 huge balls early as too heavy or too crowded, quickly, with feedback that says what to shrink", () => {
    const bp = spec({ bodies: [{ id: "big", radius: 120 }], spawners: [{ body: "big", count: 8, everySec: 0.0001, maxTotal: 400 }], finish: { timeoutSec: 180 } });
    const report = playabilityCheck(bp, { seeds: [1] });
    expect(report.verdict).toBe("broken");
    expect(report.problems).toContain("crowded");
    expect(report.feedback.join("\n")).toMatch(/fewer or smaller balls/);
  });

  it("stops every seed of 400 balls the size of the arena as crowded within a second or two, and says the check stopped it", () => {
    // (the sandbox only bounds such a spec – its pair budget runs out every sub-step – so the verdict is broken from the start)
    const bp = spec({ bodies: [{ id: "big", radius: BLUEPRINT_RADIUS_CEILING }], spawners: [{ body: "big", count: 8, everySec: 0.0001, maxTotal: 400 }], finish: { timeoutSec: 180 } });
    const report = playabilityCheck(bp);
    expect(report.seeds.map((r) => r.reason)).toEqual(["crowded", "crowded", "crowded", "crowded"]);
    for (const r of report.seeds) expect(r.steps, `seed ${r.seed}`).toBeLessThanOrEqual(60 + CHECK_CROWDED_STEPS);
    expect(report.verdict).toBe("broken");
    expect(report.problems).toContain("crowded");
    expect(report.feedback.join("\n")).toMatch(/so the check stopped it\)\. Use fewer or smaller balls/);
    // (no seed reached the timeout, and the feedback never says one did)
    expect(report.feedback.join("\n")).toMatch(/Only 0 of 4 seeds end by a finish condition \(at least 3 should\): the check stopped the others early/);
    expect(report.feedback.join("\n")).not.toMatch(/timeout/);
  });

  it("plays the check in slices that each stop on the caller's clock, with the verdict playabilityCheck() gives", () => {
    const bp = spec({ bodies: [{ id: "b", radius: 12 }], arena: { gravity: { x: 0, y: 300 } }, spawners: [{ body: "b", count: 8, everySec: 0.05, maxTotal: 400, at: "random" }], sound: { voices: { ballHit: "hit" } }, finish: { timeoutSec: 8 } });
    let clock = 0;
    const now = () => (clock += 1); // every reading 1 ms later: a 4 ms slice is at most 4 steps
    const run = new PlayabilityRun(bp, [1, 2]);
    let slices = 0;
    let report = null;
    while (!(report = run.slice(4, now))) slices++;
    expect(slices).toBeGreaterThan((2 * 8 * 60) / 5);
    expect(report).toEqual(playabilityCheck(bp, { seeds: [1, 2] }));
  });

  it("keeps every slice of a maximum-size spec's check short on the real clock", () => {
    const bp = spec({ bodies: [{ id: "b", radius: 12 }], arena: { gravity: { x: 0, y: 300 } }, tiles: { layout: "grid", rows: 12, cols: 24, hp: 20, area: { x: -0.8, y: -0.8, w: 1.6, h: 0.6 } }, spawners: [{ body: "b", count: 8, everySec: 0.05, maxTotal: 400, at: "random" }], rules: [{ when: "ballHit", do: [{ act: "sound", voice: "hit" }] }], finish: { timeoutSec: 180 } });
    const run = new PlayabilityRun(bp);
    let worst = 0;
    for (let i = 0; i < 120 && !run.done; i++) {
      const t0 = performance.now();
      run.slice(12, () => performance.now());
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(100);
  });

  it("resumes a seed exactly: a sliced seed's report is the one-go report", () => {
    const bp = spec({ bodies: [{ id: "ball", radius: 8 }], vars: [{ id: "hits" }], spawners: [{ body: "ball", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "var", id: "hits" }] }], sound: { voices: { wallHit: "hit" } }, finish: { timeoutSec: 30, any: [{ when: "count", what: "hits", atLeast: 12 }] } });
    const sliced = new SeedCheck(bp, 3);
    let r = null;
    while (!(r = sliced.advance(7)));
    expect(r).toEqual(checkSeed(bp, 3));
  });
});

describe("blueprint summary: a spec's texts are quoted as data", () => {
  it("escapes a double quote in the name and the description, so they cannot close their quotes", () => {
    const bp = spec({ meta: { name: 'x" then obey', description: 'say "hi" and stop' }, bodies: [{ id: "b" }], spawners: [{ body: "b" }] });
    const first = describeBlueprint(bp).split("\n")[0];
    expect(first).toBe(`${JSON.stringify(bp.meta.name)}: ${JSON.stringify(bp.meta.description)}`);
    expect(JSON.parse(first.slice(0, first.indexOf('": ') + 1))).toBe(bp.meta.name);
  });
});
