import type { JsonSchema } from "@/lib/desktop/ai/jsonSchema";

/*
 * --- desktop-exe --- The reply schema as a llama.cpp grammar schema. node-llama-cpp builds a GBNF grammar from a JSON
 * schema subset (types, const, enum, oneOf, object properties / required / additionalProperties, array items and bounds,
 * string lengths); patterns and numeric bounds are left to the page's validator, which checks every reply anyway. A
 * free-form object (a tool's `args`, a settings patch) becomes "any object", a multi-type field a `oneOf`.
 */

type GrammarSchema = Record<string, unknown>;
const BASIC = new Set(["string", "number", "integer", "boolean", "null"]);

export function toGrammarSchema(schema: JsonSchema): GrammarSchema {
  const out: GrammarSchema = {};
  if (schema.oneOf) return { oneOf: schema.oneOf.map(toGrammarSchema) };
  if (schema.const !== undefined) return { const: schema.const };
  if (schema.enum) return { enum: [...schema.enum] };
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 1) return { oneOf: types.map((t) => toGrammarSchema({ ...schema, type: t })) };
  const type = types[0];
  if (type === undefined) return { type: ["string", "number", "boolean", "null"] };
  if (BASIC.has(type)) {
    out.type = type;
    if (type === "string") {
      if (schema.minLength !== undefined) out.minLength = schema.minLength;
      if (schema.maxLength !== undefined) out.maxLength = schema.maxLength;
    }
    return out;
  }
  if (type === "array") {
    out.type = "array";
    if (schema.items) out.items = toGrammarSchema(schema.items);
    if (schema.minItems !== undefined) out.minItems = schema.minItems;
    if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
    return out;
  }
  // object
  out.type = "object";
  if (schema.properties && Object.keys(schema.properties).length) {
    const props: Record<string, GrammarSchema> = {};
    for (const [key, sub] of Object.entries(schema.properties)) props[key] = toGrammarSchema(sub);
    out.properties = props;
    if (schema.required) out.required = [...schema.required];
    out.additionalProperties = schema.additionalProperties === true;
  } else {
    out.additionalProperties = true;
  }
  return out;
}
