/*
 * --- desktop-exe --- A small JSON-schema subset for the AI studio: what the model is asked to produce (the local model is
 * constrained to it by a grammar in the app, a cloud model is asked for it in the prompt) and what every reply is checked
 * against before anything is applied. Supports type (one or several), properties / required / additionalProperties,
 * items / minItems / maxItems, enum / const, minimum / maximum, minLength / maxLength / pattern and oneOf.
 */

export type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface JsonSchema {
  type?: JsonType | JsonType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  enum?: readonly (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
}

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value as JsonType;
}

function typeMatches(actual: JsonType, wanted: JsonType): boolean {
  return actual === wanted || (wanted === "number" && actual === "integer");
}

/** Errors of `value` against `schema` ("$.clips[0].seed: must be ≤ 2147483647"), empty when it conforms. At most `limit`. */
export function validateJson(schema: JsonSchema, value: unknown, path = "$", limit = 20): string[] {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < limit) errors.push(`${path}: ${message}`);
  };
  if (schema.oneOf) {
    const branches = schema.oneOf.map((s) => validateJson(s, value, path, limit));
    const ok = branches.filter((b) => b.length === 0).length;
    if (ok === 1) return [];
    if (ok > 1) return [`${path}: matches more than one alternative`];
    // Report the branch that came closest (fewest errors).
    return branches.sort((a, b) => a.length - b.length)[0].slice(0, limit);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!types.some((t) => typeMatches(actual, t))) {
      add(`must be ${types.join(" or ")}, got ${actual}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) add(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) add(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) add("must be a finite number");
    if (schema.minimum !== undefined && value < schema.minimum) add(`must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`must be ≤ ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(`must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`must have at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) add(`must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateJson(schema.items as JsonSchema, item, `${path}[${i}]`, limit - errors.length)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) add(`missing "${key}"`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validateJson(sub, v, `${path}.${key}`, limit - errors.length));
      else if (schema.additionalProperties === false) add(`unknown field "${key}"`);
    }
  }
  return errors.slice(0, limit);
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * The JSON object in a model's reply: the whole reply, else the first balanced `{…}` in it (models like to add a code fence
 * or a sentence around it).
 */
export function extractJson(text: string): ParsedJson {
  const trimmed = text.trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    /* look for an object inside */
  }
  const start = trimmed.indexOf("{");
  if (start < 0) return { ok: false, error: "no JSON object in the reply" };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, i + 1)) };
      } catch (err) {
        return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  }
  return { ok: false, error: "the JSON object is not closed" };
}
