import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  BOUNCE_MATH_PRESETS,
  BOUNCE_MATH_PRESET_IDS,
  FORMULA_VARIABLES,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_SLOTS,
  compileFormula,
  compileFormulaWith,
  evaluateFormula,
  evaluateFormulaSlots,
  formulaSlotNamesProblem,
} from "@/lib/simulation/bounceMath";

/*
 * --- blueprint-formula --- compileFormulaWith / evaluateFormulaSlots (lib/simulation/bounceMath.ts): the formula compiler with
 * a caller's own variable names, for the Blueprint language. Additive: with bounce math's own names it compiles exactly the
 * program compileFormula does (so the bounce-math runtime runs the very instructions it ran before), and evaluating by slots
 * gives exactly evaluateFormula's numbers.
 */

/** Formulas the bounce-math presets, tests and panel use, and the edges of the grammar. */
const CORPUS = [
  ...BOUNCE_MATH_PRESET_IDS.flatMap((id) => BOUNCE_MATH_PRESETS[id].map((r) => r.formula).filter((f): f is string => typeof f === "string")),
  "v * n + t + b",
  "v * 2",
  "v + r",
  "sqrt(-v)",
  "v / 0",
  "clamp(v * 1.5, 0.5, 20.25) - -1e3",
  "v * (1 + 0.1 * r)",
  "b",
  "-2^2",
  "2^3^2",
  "min(v, n, t, b)",
  "max(1, 2, 3, 4, 5)",
  "pow(v, 0.5) + abs(-n) + floor(t) + ceil(b) + round(r)",
  "log(v) * exp(n) / tan(t) - cos(b) + sin(r)",
  "pi * e",
  ".5e3 + 1.e2",
  "((((v))))",
  "V * N",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("blueprint-formula: compileFormulaWith is compileFormula with a caller's names", () => {
  it("compiles every bounce-math preset formula (and the corpus) to the identical program with FORMULA_VARIABLES", () => {
    expect(CORPUS.some((f) => f.includes("sin(n / 3)"))).toBe(true); // (the chaos preset is in)
    for (const text of CORPUS) {
      const a = compileFormula(text);
      const b = compileFormulaWith(text, FORMULA_VARIABLES);
      expect(a.ok, text).toBe(true);
      expect(b.ok, text).toBe(true);
      if (!a.ok || !b.ok) continue;
      expect(Array.from(b.formula.code), text).toEqual(Array.from(a.formula.code));
      expect(Array.from(b.formula.consts), text).toEqual(Array.from(a.formula.consts));
      expect(b.formula.stack.length, text).toBe(a.formula.stack.length);
      expect(b.formula.usesR, text).toBe(a.formula.usesR);
      expect(b.formula.source).toBe(a.formula.source);
    }
  });

  it("refuses the same texts with the same errors", () => {
    for (const text of ["", "v +", "q * 2", "sin(v, n)", "(v", "1e999", "x".repeat(MAX_FORMULA_LENGTH + 1), "v $ 2", "clamp(1, 2)"]) {
      expect(compileFormulaWith(text, FORMULA_VARIABLES), text).toEqual(compileFormula(text));
    }
    expect(MAX_FORMULA_LENGTH).toBe(200);
  });

  it("evaluates by slots exactly as evaluateFormula does", () => {
    const random = mulberry32(7);
    for (const text of CORPUS) {
      const a = compileFormula(text);
      const b = compileFormulaWith(text, FORMULA_VARIABLES);
      if (!a.ok || !b.ok) throw new Error(text);
      for (let i = 0; i < 20; i++) {
        const vars = { v: random() * 20 - 10, n: Math.floor(random() * 9), t: random() * 60, b: random() * 100, r: random() };
        const slots = Float64Array.from([vars.v, vars.n, vars.t, vars.b, vars.r]);
        expect(Object.is(evaluateFormulaSlots(b.formula, slots), evaluateFormula(a.formula, vars)), `${text} at ${JSON.stringify(vars)}`).toBe(true);
      }
    }
  });
});

describe("blueprint-formula: a caller's own variable names", () => {
  const NAMES = ["n", "t", "b", "r", "balls", "tiles", "escaped", "tier", "size", "speed", "score"];

  it("reads each name from its slot and records which slots a formula reads", () => {
    const c = compileFormulaWith("balls * 2 + score - tier", NAMES);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.formula.names).toEqual(NAMES);
    expect(c.formula.slotMask).toBe((1 << 4) | (1 << 10) | (1 << 7));
    expect(c.formula.usesR).toBe(false);
    const slots = new Float64Array(NAMES.length);
    slots[4] = 30;
    slots[10] = 5;
    slots[7] = 3;
    expect(evaluateFormulaSlots(c.formula, slots)).toBe(62);
    const r = compileFormulaWith("r * 10", NAMES);
    expect(r.ok && r.formula.usesR && r.formula.slotMask === 1 << 3).toBe(true);
  });

  it("reads a slot past the array as NaN (the caller refuses the result)", () => {
    const c = compileFormulaWith("score + 1", NAMES);
    if (!c.ok) throw new Error("compile");
    expect(evaluateFormulaSlots(c.formula, new Float64Array(3))).toBeNaN();
  });

  it("knows only its own names: bounce math's v is unknown to a Blueprint", () => {
    expect(compileFormulaWith("v * 2", NAMES)).toEqual({ ok: false, error: { code: "unknownName", at: 0, name: "v" } });
    expect(compileFormulaWith("balls(2)", NAMES)).toMatchObject({ ok: false, error: { code: "unknownName", name: "balls" } });
  });

  it("refuses a bad list of names: a function or constant, a repeat, a malformed name, more than 16", () => {
    for (const bad of [["sin"], ["clamp"], ["pi"], ["e"], ["max"], ["a", "a"], ["Balls"], ["9lives"], ["toolongname"], ["has-dash"], [""], Array.from({ length: MAX_FORMULA_SLOTS + 1 }, (_, i) => `s${i}`)]) {
      expect(formulaSlotNamesProblem(bad), bad.join(",")).not.toBeNull();
      expect(() => compileFormulaWith("1", bad), bad.join(",")).toThrow(RangeError);
    }
    expect(formulaSlotNamesProblem(NAMES)).toBeNull();
    expect(formulaSlotNamesProblem(FORMULA_VARIABLES)).toBeNull();
    expect(MAX_FORMULA_SLOTS).toBe(16);
  });

  it("stays a parser: no eval, no Function constructor in the compiler", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "simulation", "bounceMath.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/);
  });

  it("evaluates a formula bomb in bounded work: a 200-character tower is one pass over its program", () => {
    const tower = "2^".repeat(99) + "2";
    const c = compileFormulaWith(tower, NAMES);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.formula.code.length).toBeLessThanOrEqual(2 * MAX_FORMULA_LENGTH);
    expect(evaluateFormulaSlots(c.formula, new Float64Array(NAMES.length))).toBe(Infinity);
    const nested = compileFormulaWith(`${"(".repeat(99)}1${")".repeat(99)}`, NAMES);
    expect(nested.ok).toBe(true);
  });
});
