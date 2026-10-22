import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_CATALOG, BLUEPRINT_CATALOG_IDS, HeadlessBlueprint, applyBlueprintParams, blueprintDigest, catalogBlueprint, numberAt, paramValue, sanitizeBlueprint, validateBlueprint, type BlueprintCatalogId } from "@/lib/blueprint";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- blueprint --- Mode Lab's catalog (src/lib/blueprint/catalog/): every built-in Blueprint is valid as written, plays to
 * a clear ending on the real runtime and replays to the fingerprint in tests/fixtures/blueprint-fingerprints.json (a moved
 * fingerprint means the game now plays differently: find out why, never re-record it to pass), its sliders point at numbers
 * of the spec and change the game, and its name, lines and slider labels exist in en, pl and es. The BASELINE of
 * tests/extras.test.ts holds the mode's default (the first entry) as the engine plays it on the page.
 */

interface CatalogFingerprint {
  digest: string;
  samples: number[][];
  reason: string | null;
  condition: number;
  steps: number;
  result: string;
  winner: number;
  spawned: number;
  escaped: number;
  tilesBroken: number;
  sounds: number;
  peakBalls: number;
}

const fixture = JSON.parse(readFileSync("tests/fixtures/blueprint-fingerprints.json", "utf8")) as { recipe: string; catalog: Record<string, CatalogFingerprint> };

/** The fixture's recipe: seed 1 headless, the first two balls every 150 steps of the first 600, then the run to its end. */
function catalogFingerprint(id: BlueprintCatalogId): CatalogFingerprint {
  const bp = catalogBlueprint(id);
  const h = new HeadlessBlueprint(bp, { seed: 1 });
  const samples: number[][] = [];
  for (let i = 1; i <= 600 && !h.finished; i++) {
    h.step();
    if (i % 150 === 0) samples.push(...h.engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
  }
  const r = h.runToEnd();
  const s = h.stats;
  return { digest: blueprintDigest(bp), samples, reason: r.reason, condition: r.condition, steps: s.steps, result: r.result, winner: r.winner, spawned: s.spawned, escaped: s.escaped, tilesBroken: s.tilesBroken, sounds: s.sounds, peakBalls: s.peakBalls };
}

type Messages = { Blueprints: Record<string, { name: string; description: string; timeoutSay?: string; params?: Record<string, string> } & Record<string, unknown>> };
const LOCALES: [string, Messages][] = [
  ["en", en as unknown as Messages],
  ["pl", pl as unknown as Messages],
  ["es", es as unknown as Messages],
];

describe("blueprint catalog: the games", () => {
  it("has at least four games, each valid as written and needing no repair", () => {
    expect(BLUEPRINT_CATALOG_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of BLUEPRINT_CATALOG_IDS) {
      expect(validateBlueprint(BLUEPRINT_CATALOG[id]), id).toEqual([]);
      expect(sanitizeBlueprint(BLUEPRINT_CATALOG[id]).notes, id).toEqual([]);
    }
  });

  it("has a fingerprint for every game, and none for a game that is gone", () => {
    expect(fixture.recipe).toMatch(/seed: 1/);
    expect(Object.keys(fixture.catalog).sort()).toEqual([...BLUEPRINT_CATALOG_IDS].sort());
  });

  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id} replays to its fingerprint and ends by its own condition, the same on a second run`, () => {
      const first = catalogFingerprint(id);
      expect(first).toEqual(fixture.catalog[id]);
      expect(first.reason).toBe("condition");
      expect(first.result.length).toBeGreaterThan(0);
      expect(catalogFingerprint(id)).toEqual(first);
    });
});

describe("blueprint catalog: the sliders", () => {
  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id}: every slider points at a number inside its range, and moving it changes the game`, () => {
      const bp = catalogBlueprint(id);
      expect(bp.params.length).toBeGreaterThan(0);
      bp.params.forEach((p, i) => {
        const own = paramValue(bp, i);
        expect(Number.isFinite(own), `${id}.${p.id}`).toBe(true);
        expect(own, `${id}.${p.id}`).toBeGreaterThanOrEqual(p.min);
        expect(own, `${id}.${p.id}`).toBeLessThanOrEqual(p.max);
        const other = own === p.min ? p.max : p.min;
        const values = bp.params.map((_, k) => (k === i ? other : null));
        const { blueprint, notes } = applyBlueprintParams(bp, values);
        expect(notes, `${id}.${p.id}`).toEqual([]);
        expect(numberAt(blueprint, p.at), `${id}.${p.id}`).toBe(other);
        expect(blueprintDigest(blueprint), `${id}.${p.id}`).not.toBe(blueprintDigest(bp));
      });
    });

  it("plays a slider's value in the run (Ring Breaker with three rings breaks three)", () => {
    const h = new HeadlessBlueprint(catalogBlueprint("ringBreaker"), { seed: 2, params: "3" });
    expect(h.world.ringsAlive()).toBe(3);
    expect(h.runToEnd()).toMatchObject({ reason: "condition", result: "ALL RINGS DOWN" });
  });
});

describe("blueprint catalog: three locales", () => {
  for (const id of BLUEPRINT_CATALOG_IDS)
    it(`${id}: its name, description, HUD labels, ending lines and slider labels exist in en, pl and es`, () => {
      const bp = catalogBlueprint(id);
      for (const [locale, messages] of LOCALES) {
        const m = messages.Blueprints[id];
        expect(m, `${locale}.${id}`).toBeDefined();
        expect(m.name.length, `${locale}.${id}.name`).toBeGreaterThan(0);
        expect(m.description.length, `${locale}.${id}.description`).toBeGreaterThan(0);
        bp.hud.forEach((_, i) => expect(typeof m[`hud${i}`], `${locale}.${id}.hud${i}`).toBe("string"));
        expect(m[`hud${bp.hud.length}`], `${locale}.${id}.hud${bp.hud.length}`).toBeUndefined();
        bp.finish.any.forEach((c, i) => expect(typeof m[`say${i}`], `${locale}.${id}.say${i}`).toBe(c.say ? "string" : "undefined"));
        expect(typeof m.timeoutSay === "string", `${locale}.${id}.timeoutSay`).toBe(Boolean(bp.finish.timeoutSay));
        for (const p of bp.params) expect(typeof m.params?.[p.id], `${locale}.${id}.params.${p.id}`).toBe("string");
      }
    });
});
