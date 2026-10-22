import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { BLUEPRINT_RUN_CONFIG, BLUEPRINT_CEILINGS, BLUEPRINT_CODE_MAX_CHARS, HeadlessBlueprint, FINISH_KINDS, WINNERS, blueprintBytes, sanitizeBlueprint, validateBlueprint, type Blueprint } from "@/lib/blueprint";

/*
 * --- blueprint --- The interpreter's contracts on the real runtime (the engine in the blueprint mode): one scenario per
 * finish condition and per winner rule, a condition that holds from the start never ends a run at once, the timeout's line,
 * and the sandbox – hostile specs from a stranger's link (huge numbers, values that are not numbers, deep nesting, a spec
 * past 6 KB, unknown keys and a prototype key, a code too long to read, rule loops that spawn forever, a fault) are
 * sanitized and played, never thrown out of the engine, never past the ceilings, and every run ends.
 */

function spec(raw: Record<string, unknown>): Blueprint {
  const full = { v: 1, meta: { name: "Conformance" }, finish: { timeoutSec: 30 }, ...raw };
  expect(validateBlueprint(full)).toEqual([]);
  return sanitizeBlueprint(full).blueprint;
}

function runToEnd(bp: Blueprint, seed = 1, faultOnRule?: number) {
  const h = new HeadlessBlueprint(bp, { seed, faultOnRule });
  return { h, result: h.runToEnd() };
}

/** A raw link code (any JSON text), as a stranger's link may carry it. */
const rawCode = (json: string) => `b1.${Buffer.from(json, "utf8").toString("base64url")}`;

/** The mode in the engine on a link code, stepped `frames` steps (or to its end); every ball checked finite each step. */
function playLink(code: string, frames = 60 * 200) {
  const engine = new PhysicsEngine({ ...BLUEPRINT_RUN_CONFIG });
  engine.setBlueprintSettings({ spec: code });
  engine.setSeed(3);
  engine.initMode("blueprint");
  let maxBalls = 0;
  let finite = true;
  for (let i = 0; i < frames && !engine.isSimulationFinished(); i++) {
    engine.update(1000 / 60, 0);
    engine.consumeSoundEvents();
    const balls = engine.getBalls();
    maxBalls = Math.max(maxBalls, balls.length);
    for (const b of balls) if (!(Number.isFinite(b.x) && Number.isFinite(b.y))) finite = false;
  }
  return { engine, view: engine.getBlueprintView(), maxBalls, finite };
}

const ball = { id: "ball", radius: 8 };

describe("blueprint conformance: every finish condition ends a run", () => {
  const scenarios: Record<(typeof FINISH_KINDS)[number], Record<string, unknown>> = {
    escaped: { bodies: [ball], spawners: [{ body: "ball", dir: "up", speed: 300 }], arena: { exits: [{ atDeg: 0, widthDeg: 60 }] }, finish: { timeoutSec: 30, any: [{ when: "escaped" }] } },
    tilesCleared: { bodies: [ball], spawners: [{ body: "ball", dir: "up", speed: 300 }], tiles: { rows: 1, cols: 2, hp: 1, area: { x: -0.6, y: -0.7, w: 1.2, h: 0.2 } }, rules: [{ when: "wallHit", do: [{ act: "impulse", dir: "random", amount: 60 }] }], finish: { timeoutSec: 30, any: [{ when: "tilesCleared" }] } },
    ringsCleared: { bodies: [ball], spawners: [{ body: "ball", speed: 400 }], arena: { shape: "rings", rings: { count: 2, gapDeg: 90, spinDegPerSec: 60 } }, finish: { timeoutSec: 30, any: [{ when: "ringsCleared" }] } },
    count: { bodies: [ball], vars: [{ id: "hits" }], spawners: [{ body: "ball", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "var", id: "hits" }] }], finish: { timeoutSec: 30, any: [{ when: "count", what: "hits", atLeast: 3 }] } },
    tier: { bodies: [ball], spawners: [{ body: "ball", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "tier", by: 1 }] }], finish: { timeoutSec: 30, any: [{ when: "tier", atLeast: 3 }] } },
    teamsLeft: { bodies: [{ id: "a", radius: 70, team: 0 }, { id: "b", radius: 70, team: 1 }], spawners: [{ body: "a", at: "left", dir: "right", speed: 200 }, { body: "b", at: "right", dir: "left", speed: 200 }], rules: [{ when: "ballHit", with: "otherTeam", do: [{ act: "team", target: "other", to: "self" }] }], finish: { timeoutSec: 30, winner: "lastBall", any: [{ when: "teamsLeft" }] } },
  };
  for (const kind of FINISH_KINDS)
    it(`${kind}`, () => {
      const { result } = runToEnd(spec(scenarios[kind]));
      expect(result, kind).toMatchObject({ finished: true, reason: "condition", condition: 0 });
      expect(result.timeSec).toBeLessThan(30);
    });

  it("a condition that holds from the start waits until it was once unmet (balls not spawned yet never cleared anything)", () => {
    const bp = spec({ bodies: [ball], spawners: [{ body: "ball", speed: 300 }], finish: { timeoutSec: 6, any: [{ when: "count", what: "balls", atMost: 5 }] } });
    expect(runToEnd(bp).result).toMatchObject({ reason: "timeout", condition: -1 });
  });

  it("a run that meets nothing ends at its timeout with the timeout's line, its placeholders filled", () => {
    const bp = spec({ bodies: [ball], spawners: [{ body: "ball", speed: 300 }], hud: [{ show: "balls" }], finish: { timeoutSec: 5, timeoutSay: "TIME UP WITH {balls} BALL" } });
    const { result } = runToEnd(bp);
    expect(result).toMatchObject({ finished: true, reason: "timeout", result: "TIME UP WITH 1 BALL" });
    expect(result.timeSec).toBeCloseTo(5, 1);
  });
});

describe("blueprint conformance: every winner rule names its team", () => {
  const race = (winner: string) =>
    spec({
      arena: { exits: [{ atDeg: 0, widthDeg: 90 }] },
      bodies: [{ id: "a", radius: 8, team: 0 }, { id: "b", radius: 8, team: 1, tier: 3 }, { id: "c", radius: 8, team: 2 }],
      spawners: [{ body: "a", at: "top", dir: "up", speed: 500 }, { body: "b", at: "bottom", dir: "down", speed: 100 }, { body: "c", at: "bottom", dir: "down", speed: 100 }, { body: "c", at: "bottom", dir: "down", speed: 100, startSec: 0.1 }],
      finish: { timeoutSec: 5, winner, any: [{ when: "escaped", atLeast: 1 }] },
    });
  const expected: Record<(typeof WINNERS)[number], number> = { none: -1, firstOut: 0, lastOut: 0, mostBalls: 2, highestTier: 1, lastBall: -1 };
  for (const winner of WINNERS)
    it(`${winner}`, () => {
      const { result } = runToEnd(race(winner));
      expect(result.reason).toBe("condition");
      expect(result.winner, winner).toBe(expected[winner]);
    });
});

describe("blueprint conformance: the sandbox", () => {
  it("plays huge numbers and values that are not numbers: sanitized, finite, ended", () => {
    const code = rawCode(JSON.stringify({ v: 1, meta: { name: "Huge" }, arena: { gravity: { x: 1e308, y: -1e308 }, restitution: 1e300, spinDegPerSec: "NaN" }, bodies: [{ id: "ball", radius: 1e300, gravityScale: 1e308 }, { id: "tiny", radius: -5 }], spawners: [{ body: "ball", speed: 1e308, count: 1e9 }, { body: "tiny", count: "1/0" }], finish: { timeoutSec: 1e9 } }));
    const { view, finite } = playLink(code);
    expect(view.notes.length).toBeGreaterThan(0);
    expect(view.bp!.finish.timeoutSec).toBe(BLUEPRINT_CEILINGS.timeoutSec);
    expect(finite).toBe(true);
    expect(view.result.finished).toBe(true);
    expect(view.faults).toBe(0);
  });

  it("plays a deeply nested spec, unknown keys and a prototype key without polluting anything", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 1000; i++) deep = [deep];
    const json = `{"v":1,"meta":{"name":"Nested","__proto__":{"polluted":true}},"evil":${JSON.stringify(deep)},"bodies":[{"id":"ball","extra":{"x":${JSON.stringify(deep)}}}],"spawners":[{"body":"ball"}],"finish":{"timeoutSec":5}}`;
    const { view, finite } = playLink(rawCode(json), 60 * 8);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(view.bp!.meta.name).toBe("Nested");
    expect(view.notes.some((n) => n.startsWith("$.evil: unknown field"))).toBe(true);
    expect(finite).toBe(true);
    expect(view.result).toMatchObject({ finished: true, reason: "timeout" });
  });

  it("trims a spec past 6 KB to the byte ceiling and plays it, and refuses a link code too long to hold one", () => {
    const formula = `min(${"1+".repeat(95)}1, 3)`;
    const rules = Array.from({ length: 16 }, () => ({ when: "wallHit", do: [{ act: "grow", by: formula }, { act: "speed", scale: formula }, { act: "impulse", amount: formula }, { act: "tier", by: formula }] }));
    const raw = { v: 1, meta: { name: "Fat", description: "x".repeat(160) }, bodies: [ball], spawners: [{ body: "ball" }], rules, finish: { timeoutSec: 5 } };
    const json = JSON.stringify(raw);
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(6000);
    // a spec from the app's AI or the toolbox: sanitized to the ceiling, then played to its end
    const { blueprint, notes } = sanitizeBlueprint(JSON.parse(json));
    expect(blueprintBytes(blueprint)).toBeLessThanOrEqual(BLUEPRINT_CEILINGS.specBytes);
    expect(blueprint.rules.length).toBeLessThan(16);
    expect(notes.some((n) => /bytes of JSON/.test(n))).toBe(true);
    expect(runToEnd(blueprint).result).toMatchObject({ finished: true, reason: "timeout" });
    // a link: a code too long to hold a legal spec is never decoded, and the catalog game plays instead
    const { view } = playLink(rawCode(json), 2);
    expect(view.catalogId).toBe("hatchery");
    const tooLong = `b1.${"A".repeat(BLUEPRINT_CODE_MAX_CHARS)}`;
    expect(playLink(tooLong, 2).view.catalogId).toBe("hatchery");
  });

  it("stops rule loops that spawn forever at the ball ceiling with ARENA FULL, within the step budgets, and ends", () => {
    const json = JSON.stringify({
      v: 1,
      meta: { name: "Bomb" },
      bodies: [{ id: "ball", radius: 3 }],
      spawners: [{ body: "ball", count: 8, speed: 400 }],
      rules: [
        { when: "wallHit", do: [{ act: "split", into: 8 }, { act: "spawn", body: "ball", count: 8 }] },
        { when: "ballHit", do: [{ act: "spawn", body: "ball", count: 8, at: "random" }] },
        { when: "timer", sec: 0.01, do: [{ act: "spawn", body: "ball", count: 8, at: "random" }] },
      ],
      finish: { timeoutSec: 8 },
    });
    const { view, maxBalls, finite, engine } = playLink(rawCode(json));
    const run = engine.blueprintMode.getRun()!;
    expect(maxBalls).toBeLessThanOrEqual(BLUEPRINT_CEILINGS.balls);
    expect(run.stats.peakBalls).toBe(BLUEPRINT_CEILINGS.balls);
    expect(run.stats.arenaFull).toBeGreaterThan(0);
    expect(run.stats.firings / run.stats.steps).toBeLessThanOrEqual(BLUEPRINT_CEILINGS.ruleFiringsPerStep);
    expect(finite).toBe(true);
    expect(view.result).toMatchObject({ finished: true, reason: "timeout" });
    expect(view.faults).toBe(0);
  });

  it("contains a fault: the rules stop and the run ends 1 s later with reason fault, nothing thrown", () => {
    const bp = spec({ bodies: [ball], spawners: [{ body: "ball", speed: 300 }], rules: [{ when: "wallHit", do: [{ act: "grow", by: 1 }] }] });
    const { h, result } = runToEnd(bp, 1, 0);
    expect(result.reason).toBe("fault");
    expect(h.stats.faults).toBe(1);
    expect(result.result).toBe("STOPPED");
    expect(result.timeSec).toBeLessThan(5);
  });
});
