import { describe, expect, it } from "vitest";
import { validateJson, type JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { toGrammarSchema } from "../desktop/src/ai/gbnf";
import { liteSchema, liteToBlueprint, liteToRaw, mulberry32, playabilityCheck, validateBlueprint } from "@/lib/blueprint";

/*
 * --- blueprint --- The Lite form (src/lib/blueprint/lite.ts): what the app's smallest local model writes. Its schema holds
 * only what the local grammar keeps (desktop/src/ai/gbnf.ts drops minimum, maximum and pattern), so a grammar-bound reply is
 * valid by construction; every reply – random, broken or a real example – becomes a spec the one validator accepts.
 */

/** The keys a JSON Schema node may use in the Lite form. */
const ALLOWED_KEYS = new Set(["type", "enum", "const", "oneOf", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "description"]);

function walk(schema: JsonSchema, visit: (node: JsonSchema, path: string) => void, path = "$") {
  visit(schema, path);
  for (const [k, sub] of Object.entries(schema.properties ?? {})) walk(sub, visit, `${path}.${k}`);
  if (schema.items) walk(schema.items, visit, `${path}[]`);
  (schema.oneOf ?? []).forEach((s, i) => walk(s, visit, `${path}|${i}`));
}

/** A random reply the grammar allows: an enum value for every word, lists within their bounds, optional blocks sometimes. */
function randomReply(schema: JsonSchema, rand: () => number): unknown {
  if (schema.enum) return schema.enum[Math.floor(rand() * schema.enum.length)];
  if (schema.const !== undefined) return schema.const;
  if (schema.type === "string") return "Random Mode ".repeat(4).slice(0, Math.max(schema.minLength ?? 0, Math.min(schema.maxLength ?? 20, 2 + Math.floor(rand() * 30))));
  if (schema.type === "array") {
    const n = (schema.minItems ?? 0) + Math.floor(rand() * ((schema.maxItems ?? 3) - (schema.minItems ?? 0) + 1));
    return Array.from({ length: n }, () => randomReply(schema.items!, rand));
  }
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(schema.properties ?? {})) if ((schema.required ?? []).includes(k) || rand() < 0.6) out[k] = randomReply(sub, rand);
  return out;
}

const EXAMPLE = {
  name: "Glass Nest",
  description: "Every broken tile hatches a new ball.",
  arena: "circle",
  gravity: "none",
  bounce: "bouncy",
  spin: "none",
  exit: "none",
  bodies: [{ id: "a", size: "small", color: "blue" }],
  start: [{ body: "a", amount: "one", at: "center", speed: "normal" }],
  tiles: { layout: "ring", amount: "many", hp: "medium", style: "glass" },
  rules: [{ when: "tileBroken", do: "spawn" }],
  finish: { when: "tilesCleared", timeout: "medium" },
  hud: ["tiles", "balls"],
};

describe("blueprint Lite form: a schema the local grammar keeps whole", () => {
  it("uses only enum, const, oneOf, string lengths and list bounds – no minimum, maximum or pattern", () => {
    walk(liteSchema(), (node, path) => {
      for (const key of Object.keys(node)) expect(ALLOWED_KEYS.has(key), `${path}: ${key}`).toBe(true);
      expect(node.minimum, path).toBeUndefined();
      expect(node.maximum, path).toBeUndefined();
      expect(node.pattern, path).toBeUndefined();
      if (node.type === "number" || node.type === "integer") throw new Error(`${path}: a free number`);
      if (node.type === "string" && !node.enum) expect(["$.name", "$.description"], `${path}: free text`).toContain(path);
    });
  });

  it("compiles through the app's grammar converter without losing a word", () => {
    const schema = liteSchema();
    const grammar = toGrammarSchema(schema) as { properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean };
    expect(grammar.additionalProperties).toBe(false);
    expect(grammar.required).toEqual(schema.required);
    expect(Object.keys(grammar.properties)).toEqual(Object.keys(schema.properties!));
    expect(grammar.properties.gravity).toEqual({ enum: ["none", "low", "normal", "high", "reverse"] });
    expect((grammar.properties.rules as { maxItems: number }).maxItems).toBe(6);
    expect((grammar.properties.bodies as { maxItems: number }).maxItems).toBe(3);
    expect(JSON.stringify(grammar)).not.toMatch(/"(minimum|maximum|pattern)"/);
  });
});

describe("blueprint Lite form → a full spec", () => {
  it("turns a real reply into a valid, playable Blueprint", () => {
    expect(validateJson(liteSchema(), EXAMPLE)).toEqual([]);
    const { blueprint, notes } = liteToBlueprint(EXAMPLE);
    expect(notes).toEqual([]);
    expect(validateBlueprint(blueprint)).toEqual([]);
    expect(blueprint.meta).toMatchObject({ name: "Glass Nest", author: "ai" });
    expect(blueprint.tiles).toMatchObject({ layout: "ring", rows: 5, cols: 24, hp: 3 });
    expect(blueprint.rules[0].do[0]).toMatchObject({ act: "spawn", at: "tile" });
    expect(playabilityCheck(blueprint).verdict).toBe("playable");
  });

  it("maps every grammar-valid reply (300 seeded random ones) to a spec that validates", () => {
    const rand = mulberry32(1505);
    const schema = liteSchema();
    for (let i = 0; i < 300; i++) {
      const reply = randomReply(schema, rand);
      expect(validateJson(schema, reply), `reply ${i}`).toEqual([]);
      const { blueprint } = liteToBlueprint(reply);
      const errors = validateBlueprint(blueprint);
      if (errors.length) expect(errors, `reply ${i}: ${JSON.stringify(reply)}`).toEqual([]);
    }
  });

  it("never throws on a broken reply, and still gives a valid spec", () => {
    const hostile = [null, 42, "x", [], { bodies: "a", rules: [{ when: "nope", do: "explode" }], finish: 7 }, { arena: "rings", rings: "lots", start: Array(1000).fill({ body: "z" }) }, { name: "<script>", description: "\u0000".repeat(300) }];
    for (const reply of hostile) {
      expect(() => liteToRaw(reply)).not.toThrow();
      expect(validateBlueprint(liteToBlueprint(reply).blueprint)).toEqual([]);
    }
  });
});
