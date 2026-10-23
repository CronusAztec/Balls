import { describe, expect, it } from "vitest";
import { BLUEPRINT_CATALOG_IDS, catalogBlueprint, playabilityCheck, sanitizeBlueprint, validateBlueprint, type Blueprint } from "@/lib/blueprint";

/*
 * --- blueprint --- The playability check (src/lib/blueprint/check.ts): every catalog entry is 'playable' on the check's
 * four seeds; a spawn bomb, an endless spec and a NaN spec each get their verdict, with feedback an author can act on; and
 * the verdict is the same on every run (deterministic counts, never wall time).
 */

function spec(raw: Record<string, unknown>): Blueprint {
  const full = { v: 1, meta: { name: "Check" }, finish: { timeoutSec: 20 }, ...raw };
  expect(validateBlueprint(full)).toEqual([]);
  return sanitizeBlueprint(full).blueprint;
}

describe("blueprint check: the catalog", () => {
  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id} is playable on four seeds, with the same report every run`, () => {
      const bp = catalogBlueprint(id);
      const report = playabilityCheck(bp);
      expect(report.verdict, report.feedback.join("\n")).toBe("playable");
      expect(report.finishedByCondition).toBeGreaterThanOrEqual(3);
      expect(report.medianFinishSec).toBeGreaterThanOrEqual(6);
      expect(report.feedback[0]).toMatch(/^Playable: it ends by /);
      for (const s of report.seeds) {
        expect(s.faults + s.nanBalls + s.droppedEvents + s.droppedFirings + s.arenaFull, `${id} seed ${s.seed}`).toBe(0);
        expect(s.result.length).toBeGreaterThan(0);
        expect(s.result).not.toMatch(/[{}]/); // (every placeholder filled)
      }
      expect(playabilityCheck(bp)).toEqual(report);
    });
});

describe("blueprint check: the verdicts on broken specs", () => {
  it("a spawn bomb fills the arena and is broken, saying so", () => {
    const bomb = spec({ bodies: [{ id: "ball", radius: 3 }], spawners: [{ body: "ball", count: 8, speed: 400 }], rules: [{ when: "wallHit", do: [{ act: "split", into: 8 }] }], finish: { timeoutSec: 8, any: [{ when: "count", what: "balls", atLeast: 1000 }] } });
    const report = playabilityCheck(bomb);
    expect(report.verdict).toBe("broken");
    expect(report.seeds.every((s) => s.arenaFull > 0 && s.peakBalls === 400)).toBe(true);
    expect(report.feedback.join("\n")).toMatch(/The arena filled up \(400 balls: ARENA FULL\)/);
  });

  it("a spec with no finish it can reach is endless, saying what never happened", () => {
    const none = playabilityCheck(spec({ bodies: [{ id: "ball" }], spawners: [{ body: "ball", speed: 300 }] }));
    expect(none.verdict).toBe("endless");
    expect(none.feedback.join("\n")).toMatch(/there is no finish condition/);
    const unreachable = playabilityCheck(spec({ bodies: [{ id: "ball" }], spawners: [{ body: "ball", speed: 300 }], tiles: { rows: 2, cols: 6, hp: 100000 }, finish: { timeoutSec: 20, any: [{ when: "tilesCleared" }] } }));
    expect(unreachable.verdict).toBe("endless");
    expect(unreachable.feedback.join("\n")).toMatch(/before tilesCleared/);
  });

  it("a NaN spec is broken: its balls went out of range", () => {
    // (a spawn speed past BLUEPRINT_SPEED_CEILING is refused by the validator now: gravity × gravityScale overflows instead)
    const report = playabilityCheck(spec({ arena: { gravity: { x: 0, y: 1e308 } }, bodies: [{ id: "ball", gravityScale: 1e308 }], spawners: [{ body: "ball", speed: 300 }], finish: { timeoutSec: 20, any: [{ when: "count", what: "balls", atMost: 0 }] } }));
    expect(report.verdict).toBe("broken");
    expect(report.seeds.every((s) => s.nanBalls > 0)).toBe(true);
    expect(report.feedback.join("\n")).toMatch(/NaN or infinity/);
  });

  it("a fault is broken, and the run ends with reason fault", () => {
    const report = playabilityCheck(catalogBlueprint("conquer"), { faultOnRule: 0 });
    expect(report.verdict).toBe("broken");
    expect(report.seeds.every((s) => s.reason === "fault" && s.faults === 1)).toBe(true);
    expect(report.feedback.join("\n")).toMatch(/A rule failed while running/);
  });

  it("too quick, too quiet and too still are each broken, with the fix in the sentence", () => {
    const quick = playabilityCheck(spec({ bodies: [{ id: "ball" }], spawners: [{ body: "ball", dir: "up", speed: 600 }], arena: { exits: [{ atDeg: 0, widthDeg: 120 }] }, finish: { timeoutSec: 20, any: [{ when: "escaped" }] } }));
    expect(quick.verdict).toBe("broken");
    expect(quick.feedback.join("\n")).toMatch(/too quick for a clip/);
    const quiet = playabilityCheck(spec({ bodies: [{ id: "ball" }], spawners: [{ body: "ball", speed: 300 }], sound: { voices: { wallHit: "none" } }, vars: [{ id: "ticks" }], rules: [{ when: "timer", sec: 1, do: [{ act: "var", id: "ticks" }] }], finish: { timeoutSec: 20, any: [{ when: "count", what: "ticks", atLeast: 8 }] } }));
    expect(quiet.verdict).toBe("broken");
    expect(quiet.feedback.join("\n")).toMatch(/too quiet/);
    const still = playabilityCheck(spec({ bodies: [{ id: "ball" }], spawners: [{ body: "ball", speed: 0 }], vars: [{ id: "ticks" }], rules: [{ when: "timer", sec: 1, do: [{ act: "var", id: "ticks" }, { act: "sound" }] }], finish: { timeoutSec: 20, any: [{ when: "count", what: "ticks", atLeast: 8 }] } }));
    expect(still.verdict).toBe("broken");
    expect(still.feedback.join("\n")).toMatch(/Nothing moves within the first 1 s/);
  });
});
