import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { validateJson } from "@/lib/desktop/ai/jsonSchema";
import { SHARE_CODE_MAX_LENGTH, encodeShareCode } from "@/lib/shareCode";
import * as uncap from "@/lib/uncap";
import {
  BLUEPRINT_CATALOG,
  BLUEPRINT_CATALOG_IDS,
  BLUEPRINT_CEILINGS,
  BLUEPRINT_CODE_MAX_CHARS,
  BLUEPRINT_LIMITS,
  BLUEPRINT_MAX_SUBSTEPS,
  BLUEPRINT_STEP_BUDGETS,
  blueprintBytes,
  blueprintDigest,
  blueprintJsonSchema,
  blueprintJson,
  blueprintQuery,
  blueprintVocabulary,
  catalogBlueprint,
  compactBlueprint,
  decodeBlueprint,
  describeBlueprint,
  encodeBlueprint,
  estimateTokens,
  sanitizeBlueprint,
  simulatorLink,
  validateBlueprint,
} from "@/lib/blueprint";

/*
 * --- blueprint --- The Blueprint language v1 (src/lib/blueprint/): the validator's precise paths, the sanitizer's fallbacks,
 * the compact form and the link code, the sandbox ceilings (lib/uncap.ts), the sizes a link and a share code reach, the JSON
 * Schema, the prompt vocabulary's budget, and the library's isolation (nothing on a page imports it before Mode Lab).
 */

const ROOT = path.resolve(__dirname, "..");

/** A small valid spec, compact. */
function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, meta: { name: "Test" }, bodies: [{ id: "ball" }], spawners: [{ body: "ball" }], finish: { timeoutSec: 30 }, ...extra };
}

describe("blueprint: the catalog", () => {
  it("has at least four entries, each valid as written, sanitized without a note, and stable through the compact form", () => {
    expect(BLUEPRINT_CATALOG_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const raw = BLUEPRINT_CATALOG[id];
      expect(validateBlueprint(raw), id).toEqual([]);
      const { blueprint, notes, newer } = sanitizeBlueprint(raw);
      expect(notes, id).toEqual([]);
      expect(newer).toEqual([]);
      expect(blueprint.meta.author, id).toBe("builtin");
      // the compact form (defaults left out) and its canonical text carry the whole spec
      expect(sanitizeBlueprint(JSON.parse(blueprintJson(blueprint))).blueprint, id).toEqual(blueprint);
      expect(sanitizeBlueprint(compactBlueprint(blueprint)).blueprint, id).toEqual(blueprint);
      expect(validateBlueprint(blueprint), id).toEqual([]);
      expect(describeBlueprint(blueprint)).toContain(blueprint.meta.name);
    }
  });
});

describe("blueprint: strict validation says where and why", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["an unknown body in an action", base({ rules: [{ when: "wallHit", do: [{ act: "spawn", body: "x" }] }] }), /^rules\[0\]\.do\[0\]\.body: unknown body "x" \(the bodies: ball\)$/],
    ["a formula that does not compile", base({ rules: [{ when: "wallHit", do: [{ act: "grow", by: "size * q" }] }] }), /^rules\[0\]\.do\[0\]\.by: formula: unknown name "q" at 7/],
    ["an unknown field", base({ arena: { shape: "circle", wobble: 3 } }), /^arena\.wobble: unknown field/],
    ["a size out of its domain", base({ arena: { size: 1.4 } }), /^arena\.size: must be a number from 0\.5 to 0\.95, got 1\.4$/],
    ["exits on a box", base({ arena: { shape: "box", exits: [{ atDeg: 0, widthDeg: 30 }] } }), /^arena\.exits: exits need a circle arena/],
    ["a merge outside a ballHit rule", base({ rules: [{ when: "wallHit", do: [{ act: "merge" }] }] }), /^rules\[0\]\.do\[0\]: merge needs a ballHit rule/],
    ["other outside a ballHit rule", base({ rules: [{ when: "timer", sec: 1, do: [{ act: "remove", target: "other" }] }] }), /^rules\[0\]\.do\[0\]\.target: "other" needs a ballHit rule/],
    ["an undeclared variable", base({ rules: [{ when: "wallHit", do: [{ act: "var", id: "score" }] }] }), /^rules\[0\]\.do\[0\]\.id: unknown variable "score" \(the variables: none/],
    ["a feature of a newer version", base({ meta: { name: "T", needs: ["portals"] } }), /^meta\.needs\[0\]: needs a newer version of JumpingBallsLive/],
    ["a newer format", { ...base(), v: 2 }, /^v: version 2 needs a newer version/],
    ["a missing timeout", base({ finish: {} }), /^finish\.timeoutSec: missing/],
    ["a timeout past the ceiling", base({ finish: { timeoutSec: 600 } }), /^finish\.timeoutSec: must be a number from 5 to 180, got 600$/],
    ["a field of another trigger", base({ rules: [{ when: "wallHit", sec: 3, do: [{ act: "fx" }] }] }), /^rules\[0\]\.sec: only a timer rule takes sec$/],
    ["tilesCleared without tiles", base({ finish: { timeoutSec: 30, any: [{ when: "tilesCleared" }] } }), /^finish\.any\[0\]\.when: tilesCleared needs a tiles block$/],
    ["too many tiles", base({ tiles: { rows: 24, cols: 48 } }), /^tiles: 24 rows × 48 columns are 1152 tiles \(at most 600\)$/],
    ["obstacles past their ceiling", base({ obstacles: [{ kind: "pegGrid", rows: 8, cols: 8 }] }), /^obstacles\[0\]: expands to 64 obstacles, 64 in all \(at most 48\)$/],
    ["a non-finite radius", base({ bodies: [{ id: "ball", radius: 0 }] }), /^bodies\[0\]\.radius: must be a number above 0, got 0$/],
    ["text that is not plain", base({ meta: { name: "<b>Hi</b>" } }), /^meta\.name: must be plain text/],
    ["a reserved variable id", base({ vars: [{ id: "balls" }] }), /^vars\[0\]\.id: "balls" is a reserved word/],
    ["a body called like a relation", base({ bodies: [{ id: "same" }] }), /^bodies\[0\]\.id: "same" is a reserved word/],
    ["a colour written loosely", base({ look: { palette: ["#FFF"] } }), /^look\.palette\[0\]: must be written "#ffffff"$/],
    ["not an object", [] as unknown as Record<string, unknown>, /^\$: a Blueprint is a JSON object, got a list$/],
  ];
  for (const [what, raw, expected] of cases)
    it(`reports ${what}`, () => {
      const errors = validateBlueprint(raw);
      expect(errors.some((e) => expected.test(e)), errors.join("\n")).toBe(true);
    });

  it("takes any finite physics number – gravity, bounciness, spin; speeds and radii up to their work ceilings – and refuses only meaningless ones", () => {
    // --- review fix (blueprint) --- a ball's radius and a spawn speed stop at BLUEPRINT_RADIUS_CEILING and BLUEPRINT_SPEED_CEILING
    const huge = base({ arena: { gravity: { x: -1e9, y: 1e12 }, restitution: 50, spinDegPerSec: -1e6 }, bodies: [{ id: "ball", radius: uncap.BLUEPRINT_RADIUS_CEILING, gravityScale: -3 }], spawners: [{ body: "ball", speed: -uncap.BLUEPRINT_SPEED_CEILING }] });
    expect(validateBlueprint(huge)).toEqual([]);
    expect(validateBlueprint(base({ arena: { restitution: -1 } }))[0]).toMatch(/^arena\.restitution: must be a number from 0 up, got -1$/);
    const past = validateBlueprint(base({ bodies: [{ id: "ball", radius: 1e6 }], spawners: [{ body: "ball", speed: 1e15 }] }));
    expect(past).toEqual(["bodies[0].radius: 1000000 is past the ball radius ceiling, px (225)", "spawners[0].speed: 1000000000000000 is past the ball speed ceiling, px/s (100000)"]);
    const fixed = sanitizeBlueprint(base({ bodies: [{ id: "ball", radius: 1e6 }], spawners: [{ body: "ball", speed: -1e15 }] })).blueprint;
    expect([fixed.bodies[0].radius, fixed.spawners[0].speed]).toEqual([uncap.BLUEPRINT_RADIUS_CEILING, -uncap.BLUEPRINT_SPEED_CEILING]);
  });

  it("reports at most a bounded number of problems for any garbage", () => {
    const garbage = { v: "x", meta: 5, arena: [], bodies: Array.from({ length: 1000 }, () => ({ id: 7 })), rules: "no", extra: 1 };
    const errors = validateBlueprint(garbage);
    expect(errors.length).toBeGreaterThan(5);
    expect(errors.length).toBeLessThanOrEqual(61);
  });
});

describe("blueprint: the tolerant sanitizer", () => {
  it("keeps what is valid, drops what is not, and says what it changed", () => {
    const raw = base({
      meta: { name: "  Hi\u0000 <there>  ", description: "x".repeat(400) },
      arena: { size: 3, gravity: { y: NaN }, exits: [{ atDeg: 10, widthDeg: 900 }] },
      bodies: [{ id: "ball", radius: -4, color: 9 }, { id: "ball" }, { id: "Bad" }],
      rules: [{ when: "nope", do: [] }, { when: "wallHit", do: [{ act: "spawn", body: "ghost", count: 99 }, { act: "teleport" }] }],
      finish: { timeoutSec: 1e9 },
    });
    const { blueprint, notes } = sanitizeBlueprint(raw);
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(notes.length).toBeGreaterThan(8);
    expect(blueprint.meta.name).toBe("Hi there");
    expect(blueprint.meta.description.length).toBe(BLUEPRINT_LIMITS.descriptionChars);
    expect(blueprint.arena.size).toBe(0.95);
    expect(blueprint.arena.gravity).toEqual({ x: 0, y: 0 });
    expect(blueprint.arena.exits).toEqual([{ atDeg: 10, widthDeg: 180 }]);
    expect(blueprint.bodies.map((b) => b.id)).toEqual(["ball", "ball2"]);
    expect(blueprint.bodies[0].radius).toBe(10);
    expect(blueprint.bodies[0].color).toBe(5);
    expect(blueprint.rules).toHaveLength(1);
    expect(blueprint.rules[0].do).toEqual([{ act: "spawn", body: "ball", count: 8, at: "self", speed: 250, dir: "random" }]);
    expect(blueprint.finish.timeoutSec).toBe(180);
  });

  it("never throws: not an object, a getter that throws, a proxy, a cycle", () => {
    const trap = new Proxy({}, { get: () => { throw new Error("trap"); }, ownKeys: () => { throw new Error("trap"); } });
    const cyclic: Record<string, unknown> = { v: 1 };
    cyclic.meta = cyclic;
    for (const raw of [null, undefined, 42, "spec", [], trap, cyclic, { get v() { throw new Error("getter"); } }]) {
      const { blueprint } = sanitizeBlueprint(raw);
      expect(validateBlueprint(blueprint)).toEqual([]);
      expect(() => validateBlueprint(raw)).not.toThrow();
    }
  });

  it("keeps its own fields away from the prototype: __proto__, constructor and toString are data", () => {
    const raw = JSON.parse('{"v":1,"meta":{"name":"P","__proto__":{"polluted":true}},"bodies":[{"id":"ball","constructor":1}],"spawners":[{"body":"ball"}],"finish":{"timeoutSec":20,"toString":3}}');
    const { blueprint, notes } = sanitizeBlueprint(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(notes.join("\n")).toMatch(/meta\.__proto__: unknown field/);
    expect(validateBlueprint(blueprint)).toEqual([]);
  });

  it("trims a spec past the byte ceiling from the end, and the result fits", () => {
    const longFormula = `min(${"balls + ".repeat(22)}1, 9)`;
    const rules = Array.from({ length: 16 }, () => ({ when: "wallHit", do: Array.from({ length: 4 }, () => ({ act: "grow", by: longFormula.slice(0, 200) })) }));
    const raw = base({ rules });
    expect(validateBlueprint(raw).some((e) => /bytes of JSON \(at most 6000\)/.test(e))).toBe(true);
    const { blueprint, notes } = sanitizeBlueprint(raw);
    expect(notes.some((n) => /trimmed from the end/.test(n))).toBe(true);
    expect(blueprintBytes(blueprint)).toBeLessThanOrEqual(BLUEPRINT_CEILINGS.specBytes);
    expect(blueprint.rules.length).toBeLessThan(16);
    expect(validateBlueprint(blueprint)).toEqual([]);
  });
});

describe("blueprint: the compact form, the code and the digest", () => {
  it("round-trips every catalog entry through its code and its link", () => {
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      const code = encodeBlueprint(bp);
      expect(code.startsWith("b1.")).toBe(true);
      for (const text of [code, `?${blueprintQuery(bp)}`, `https://example.org${simulatorLink(blueprintQuery(bp))}`]) {
        const decoded = decodeBlueprint(text);
        expect(decoded.ok, text.slice(0, 40)).toBe(true);
        if (decoded.ok) expect(sanitizeBlueprint(decoded.raw).blueprint).toEqual(bp);
      }
    }
  });

  it("is canonical: key order does not matter, and the digest is FNV-1a of the canonical JSON", () => {
    const a = sanitizeBlueprint(base({ arena: { size: 0.8, shape: "box" } })).blueprint;
    const b = sanitizeBlueprint({ finish: { timeoutSec: 30 }, spawners: [{ body: "ball" }], bodies: [{ id: "ball" }], arena: { shape: "box", size: 0.8 }, meta: { name: "Test" }, v: 1 }).blueprint;
    expect(blueprintJson(a)).toBe(blueprintJson(b));
    expect(blueprintJson(a)).toBe('{"arena":{"shape":"box","size":0.8},"bodies":[{"id":"ball"}],"finish":{"timeoutSec":30},"meta":{"name":"Test"},"spawners":[{"body":"ball"}],"v":1}');
    expect(blueprintDigest(a)).toBe(blueprintDigest(b));
    expect(blueprintDigest(a)).toMatch(/^[0-9a-f]{8}$/);
    // FNV-1a (32-bit) of the canonical text, computed independently
    let h = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(blueprintJson(a))) h = Math.imul(h ^ byte, 0x01000193);
    expect(blueprintDigest(a)).toBe((h >>> 0).toString(16).padStart(8, "0"));
  });

  it("refuses codes that are not one, plainly", () => {
    expect(decodeBlueprint("b2.abc")).toMatchObject({ ok: false, error: expect.stringMatching(/starts with "b1\."/) });
    expect(decodeBlueprint("b1.!!!")).toMatchObject({ ok: false, error: "the code is not base64url" });
    expect(decodeBlueprint(`b1.${btoa("{not json").replace(/=+$/, "")}`)).toMatchObject({ ok: false, error: expect.stringMatching(/not JSON/) });
    expect(decodeBlueprint(`b1.${"A".repeat(BLUEPRINT_CODE_MAX_CHARS)}`)).toMatchObject({ ok: false, error: expect.stringMatching(/longer than/) });
    expect(decodeBlueprint("b1.__8")).toMatchObject({ ok: false, error: "the code is not UTF-8 text" });
  });

  it("fits the largest legal spec into a link under 9,000 characters and a share code under SHARE_CODE_MAX_LENGTH", async () => {
    // every list at its longest, every text and formula at its longest: the sanitizer trims it to the byte ceiling
    const text = (n: number) => "Żółw ñandú ".repeat(40).slice(0, n);
    const formula = `min(${"balls + tiles * ".repeat(12)}1, 9)`.slice(0, 199) + ")";
    const raw = {
      v: 1,
      meta: { name: text(28), description: text(160), family: "battle", author: "ai" },
      arena: { shape: "circle", size: 0.9, exits: Array.from({ length: 4 }, (_, i) => ({ atDeg: i * 90.123456, widthDeg: 20.654321 })) },
      bodies: Array.from({ length: 4 }, (_, i) => ({ id: `body${i}`, radius: 7.123456, color: i, gravityScale: 0.987654, hp: 3, tier: 2, team: i, collide: "pass" })),
      tiles: { layout: "grid", rows: 20, cols: 30, hp: 4, hpStep: 1, pierce: true, style: "neon", pitchBy: "col", area: { x: -0.7, y: -0.6, w: 1.4, h: 0.9 } },
      obstacles: Array.from({ length: 8 }, (_, i) => ({ kind: "spinner", x: 0.1 * i - 0.4, y: 0.05 * i, len: 0.3, angleDeg: 12.5 * i, spinDegPerSec: 33.3, thick: 0.02 })),
      vars: Array.from({ length: 4 }, (_, i) => ({ id: `var${i}`, start: i * 1.5 })),
      spawners: Array.from({ length: 6 }, (_, i) => ({ body: `body${i % 4}`, at: "random", count: formula, speed: formula, dir: "out", startSec: i * 0.5, everySec: 1.25, onBeat: false, maxTotal: 50 })),
      rules: Array.from({ length: 16 }, (_, i) => ({ when: "wallHit", of: `body${i % 4}`, every: 2, chance: 0.75, cooldownSec: 0.5, maxFires: 9, do: Array.from({ length: 4 }, () => ({ act: "grow", target: "self", by: formula })) })),
      finish: { any: [{ when: "tilesCleared", say: text(40) }, { when: "count", what: "var1", atLeast: 99, say: text(40) }, { when: "escaped", atLeast: 3, say: text(40) }], timeoutSec: 180, winner: "mostBalls", timeoutSay: text(40) },
      hud: [{ show: "var0", label: text(16) }, { show: "balls", label: text(16) }],
      look: { palette: ["#123456", "#234567", "#345678", "#456789", "#56789a", "#6789ab"], background: "#010203", trail: true, rim: 3, teamNames: Array.from({ length: 6 }, () => text(16)) },
      sound: { scale: "blues", root: 7, bpm: 133.5, voices: { wallHit: "merge", obstacleHit: "split", tileHit: "gap", tileBroken: "merge", ballHit: "none", escape: "split", ringPass: "merge", spawn: "hit" } },
    };
    const { blueprint } = sanitizeBlueprint(raw);
    const bytes = blueprintBytes(blueprint);
    expect(bytes).toBeLessThanOrEqual(BLUEPRINT_CEILINGS.specBytes);
    expect(bytes).toBeGreaterThan(BLUEPRINT_CEILINGS.specBytes - 600); // (it really is the largest kind)
    const code = encodeBlueprint(blueprint);
    expect(code.length).toBeLessThanOrEqual(BLUEPRINT_CODE_MAX_CHARS);
    const link = `https://jumpingballslive.com${simulatorLink(blueprintQuery(blueprint))}&seed=4294967295`;
    expect(link.length).toBeLessThanOrEqual(9000);
    const share = await encodeShareCode(new URLSearchParams(blueprintQuery(blueprint)));
    expect(share).not.toBeNull();
    expect(share!.length).toBeLessThanOrEqual(SHARE_CODE_MAX_LENGTH);
    const back = decodeBlueprint(link);
    expect(back.ok && sanitizeBlueprint(back.raw).blueprint).toEqual(blueprint);
  });
});

describe("blueprint: the sandbox ceilings (lib/uncap.ts)", () => {
  it("are the owner's fixed work and memory ceilings, re-exported unchanged by the library", () => {
    expect(uncap.BLUEPRINT_CEILINGS).toEqual({ balls: 400, tiles: 600, obstacles: 48, rules: 16, timeoutSec: 180, specBytes: 6000, eventsPerStep: 512, ruleFiringsPerStep: 64, spawnsPerStep: 8, soundsPerStep: 6, ballRadius: 225, ballSpeed: 100_000, subStepsPerStep: 16, pairTestsPerStep: 64_000, pairVisitsPerStep: 160_000, actionBallsPerStep: 4_096 });
    // --- review fix (blueprint) --- the work ceilings on one ball and one step, re-exported as the runtime reads them
    expect([uncap.BLUEPRINT_RADIUS_CEILING, uncap.BLUEPRINT_SPEED_CEILING, uncap.BLUEPRINT_SUBSTEP_CEILING, uncap.BLUEPRINT_PAIR_TESTS_PER_STEP, uncap.BLUEPRINT_ACTION_BALLS_PER_STEP]).toEqual([225, 100_000, 16, 64_000, 4_096]);
    expect([BLUEPRINT_MAX_SUBSTEPS, BLUEPRINT_STEP_BUDGETS.pairTests, BLUEPRINT_STEP_BUDGETS.actionBalls]).toEqual([16, 64_000, 4_096]);
    // (the pair-grid entries a step walks have a ceiling of their own, apart from the pairs it tests)
    expect([uncap.BLUEPRINT_PAIR_VISITS_PER_STEP, BLUEPRINT_STEP_BUDGETS.pairVisits]).toEqual([160_000, 160_000]);
    expect(BLUEPRINT_CEILINGS).toBe(uncap.BLUEPRINT_CEILINGS);
    expect([uncap.BLUEPRINT_BALL_CEILING, uncap.BLUEPRINT_TILE_CEILING, uncap.BLUEPRINT_OBSTACLE_CEILING, uncap.BLUEPRINT_RULE_CEILING, uncap.BLUEPRINT_TIMEOUT_CEILING_SEC, uncap.BLUEPRINT_JSON_MAX_BYTES]).toEqual([400, 600, 48, 16, 180, 6000]);
    expect([BLUEPRINT_LIMITS.balls, BLUEPRINT_LIMITS.tiles, BLUEPRINT_LIMITS.obstacles, BLUEPRINT_LIMITS.rules, BLUEPRINT_LIMITS.maxTimeoutSec, BLUEPRINT_LIMITS.specBytes]).toEqual([400, 600, 48, 16, 180, 6000]);
    // (no slider setting: the settings' MEMORY_CEILINGS are untouched until Mode Lab adds its own keys)
    expect(Object.keys(uncap.MEMORY_CEILINGS).some((k) => k.startsWith("bl"))).toBe(false);
  });

  it("are protected: limits.ts and the BLUEPRINT_CEILINGS literal need the owner's review", () => {
    const protectedJson = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "agent", "protected.json"), "utf8")) as { paths: { glob: string }[]; regions: { file: string; const?: string }[] };
    expect(protectedJson.paths.map((p) => p.glob)).toContain("src/lib/blueprint/limits.ts");
    expect(protectedJson.regions).toContainEqual(expect.objectContaining({ file: "src/lib/uncap.ts", const: "BLUEPRINT_CEILINGS" }));
  });
});

describe("blueprint: the JSON Schema and the prompt vocabulary", () => {
  it("the schema accepts every catalog entry, compact and resolved, and refuses a broken one", () => {
    const schema = blueprintJsonSchema();
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      expect(validateJson(schema, compactBlueprint(bp)), id).toEqual([]);
      expect(validateJson(schema, JSON.parse(JSON.stringify(bp))), id).toEqual([]);
    }
    expect(validateJson(schema, base({ arena: { shape: "hexagon" } })).length).toBeGreaterThan(0);
    expect(validateJson(schema, base({ rules: [{ when: "wallHit", do: [{ act: "explode" }] }] })).length).toBeGreaterThan(0);
  });

  it("the vocabulary names every trigger, action and finish in at most 500 tokens", () => {
    const v = blueprintVocabulary();
    expect(estimateTokens(v)).toBeLessThanOrEqual(500);
    for (const word of ["wallHit", "tileBroken", "ballHit", "countReached", "spawn", "merge", "impulse", "tilesCleared", "teamsLeft", "firstOut"]) expect(v).toContain(word);
  });
});

describe("blueprint: isolation and purity", () => {
  /** Every TypeScript file under a folder. */
  function files(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...files(full));
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
    return out;
  }

  /** What a file imports, resolved to a path under the repository ("" for a package). */
  function importsOf(file: string): { spec: string; target: string }[] {
    const source = fs.readFileSync(file, "utf8");
    return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => {
      const spec = m[1];
      const target = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : "";
      return { spec, target: target && path.relative(ROOT, target).split(path.sep).join("/") };
    });
  }

  it("is imported only by Mode Lab's own files: the engine and the mode, the renderer, the panel and the page", () => {
    // --- blueprint --- (P4) until Mode Lab only the agent toolbox read it; now the mode plays it, exactly these files
    const importers = files(path.join(ROOT, "src"))
      .filter((f) => !f.includes(`${path.sep}lib${path.sep}blueprint${path.sep}`) && !f.includes(`${path.sep}lib${path.sep}agentKit${path.sep}`))
      .filter((f) => importsOf(f).some((i) => i.target === "src/lib/blueprint" || i.target.startsWith("src/lib/blueprint/")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .sort();
    expect(importers).toEqual([
      "src/components/simulator/Simulator.tsx",
      "src/components/simulator/blueprintRenderer.ts",
      "src/components/simulator/sections/BlueprintSection.tsx",
      "src/lib/physics/engine.ts",
      "src/lib/physics/modes/blueprint.ts",
    ]);
  });

  it("imports no DOM, React, settings or page module, and only the runtime reaches the engine", () => {
    // --- blueprint --- (P4) the runtime is hosted by the engine (its balls, sub-steps and tiles) and the headless runner
    // builds one; the language itself – the schema, the sanitizer, the codec, the formulas, the catalog – stays pure data
    const ENGINE_SIDE = /^src\/lib\/blueprint\/(runtime\/|headless\.ts$)/;
    for (const f of files(path.join(ROOT, "src", "lib", "blueprint"))) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      const source = fs.readFileSync(f, "utf8");
      for (const { spec } of importsOf(f)) {
        expect(spec, rel).toMatch(/^(\.{1,2}\/|@\/lib\/(uncap|base64|simulation\/bounceMath|simulation\/world|desktop\/ai\/jsonSchema|physics\/(types|tiles|engine))$)/);
        if (/^@\/lib\/physics\//.test(spec)) expect([rel, ENGINE_SIDE.test(rel)]).toEqual([rel, true]);
      }
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // (comments may name what the code never calls)
      expect(code, rel).not.toMatch(/\beval\s*\(|new\s+Function\b|Math\.random|Date\.now|performance\.now/);
    }
  });
});
