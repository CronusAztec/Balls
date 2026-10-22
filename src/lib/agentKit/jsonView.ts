/*
 * --- agent-cli --- A JSON-safe, bounded and deterministic picture of any value (a mode's getState(), its view object, a
 * progress record) for the agent toolbox (scripts/agent/cli.mjs). The same value always gives byte-identical JSON:
 *  - numbers keep `digits` significant digits; NaN and ±Infinity become the strings "NaN", "Infinity", "-Infinity" and are
 *    counted (`nonFinite`, and `nan` for NaN alone), so a tool can raise its NaN flag;
 *  - a typed array becomes a summary {typedArray, length, min, max, mean, nonZero} – a view's halo slots, not 4,000 numbers;
 *  - arrays longer than `maxArray` become {length, head}; Maps and Sets {map|set: size, head};
 *  - objects deeper than `maxDepth` become "[object]", more than `maxKeys` keys are cut ("…": the rest), cycles "[circular]";
 *  - functions, symbols and undefined object fields are left out (undefined in an array is null).
 * Pure: no clock, no randomness, nothing read but the value.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonViewOptions {
  /** Nesting depth kept (the value itself is depth 0). */
  maxDepth?: number;
  /** Array items kept before an array becomes {length, head}. */
  maxArray?: number;
  /** Object keys kept. */
  maxKeys?: number;
  /** Significant digits of a number. */
  digits?: number;
  /** Characters of a string kept. */
  maxString?: number;
}

export interface JsonViewResult {
  value: JsonValue;
  /** NaN / ±Infinity seen anywhere in the value (typed arrays included). */
  nonFinite: number;
  /** Of those, NaN (±Infinity is a common "never" sentinel in a view; NaN never is). */
  nan: number;
}

const DEFAULTS: Required<JsonViewOptions> = { maxDepth: 4, maxArray: 24, maxKeys: 60, digits: 6, maxString: 200 };

type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

function isTypedArray(value: unknown): value is TypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView) && typeof (value as { length?: unknown }).length === "number";
}

/** A number rounded to `digits` significant digits (integers within the safe range stay exact). */
export function roundNumber(n: number, digits = DEFAULTS.digits): number {
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return n === 0 ? 0 : n;
  const r = Number(n.toPrecision(digits));
  return Object.is(r, -0) ? 0 : r;
}

export function jsonView(value: unknown, options: JsonViewOptions = {}): JsonViewResult {
  const o = { ...DEFAULTS, ...options };
  let nonFinite = 0;
  let nan = 0;
  const seen = new WeakSet<object>();

  const num = (n: number): JsonValue => {
    if (Number.isFinite(n)) return roundNumber(n, o.digits);
    nonFinite++;
    if (Number.isNaN(n)) nan++;
    return Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity";
  };

  const typed = (a: TypedArray): JsonValue => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let finite = 0;
    let nonZero = 0;
    for (let i = 0; i < a.length; i++) {
      const v = Number(a[i]);
      if (!Number.isFinite(v)) {
        nonFinite++;
        if (Number.isNaN(v)) nan++;
        continue;
      }
      finite++;
      if (v < min) min = v;
      if (v > max) max = v;
      if (v !== 0) nonZero++;
      sum += v;
    }
    return {
      typedArray: a.constructor.name,
      length: a.length,
      min: finite ? roundNumber(min, o.digits) : null,
      max: finite ? roundNumber(max, o.digits) : null,
      mean: finite ? roundNumber(sum / finite, o.digits) : null,
      nonZero,
    };
  };

  const walk = (v: unknown, depth: number): JsonValue | undefined => {
    if (v === null) return null;
    switch (typeof v) {
      case "number":
        return num(v);
      case "boolean":
        return v;
      case "string":
        return v.length > o.maxString ? `${v.slice(0, o.maxString)}…` : v;
      case "bigint":
        return v.toString();
      case "undefined":
      case "function":
      case "symbol":
        return undefined;
    }
    if (isTypedArray(v)) return typed(v);
    const obj = v as object;
    if (seen.has(obj)) return "[circular]";
    if (depth >= o.maxDepth) return Array.isArray(obj) ? `[array ${obj.length}]` : "[object]";
    seen.add(obj);
    try {
      const items = (list: unknown[]): JsonValue[] => list.slice(0, o.maxArray).map((x) => walk(x, depth + 1) ?? null);
      if (Array.isArray(obj)) return obj.length <= o.maxArray ? items(obj) : { length: obj.length, head: items(obj) };
      if (obj instanceof Map) return { map: obj.size, head: items([...obj.entries()].slice(0, o.maxArray)) };
      if (obj instanceof Set) return { set: obj.size, head: items([...obj.values()].slice(0, o.maxArray)) };
      const out: { [key: string]: JsonValue } = {};
      const keys = Object.keys(obj);
      for (const key of keys.slice(0, o.maxKeys)) {
        const w = walk((obj as Record<string, unknown>)[key], depth + 1);
        if (w !== undefined) out[key] = w;
      }
      if (keys.length > o.maxKeys) out["…"] = `${keys.length - o.maxKeys} more keys`;
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  const out = walk(value, 0) ?? null;
  return { value: out, nonFinite, nan };
}
