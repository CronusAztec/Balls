/*
 * --- blueprint --- Formulas in a Blueprint's number slots (a spawner's count and speed, an action's amount…): bounce math's
 * own compiler (lib/simulation/bounceMath.ts compileFormulaWith – a recursive-descent parser into a postfix program, never
 * eval or new Function), with the Blueprint's variables: FORMULA_NAMES (n, t, b, r, balls, tiles, escaped, tier, size,
 * speed) then the spec's own variable ids. At most 200 characters a formula; evaluation allocates nothing.
 */
import { compileFormulaWith, evaluateFormulaSlots, MAX_FORMULA_LENGTH, type FormulaError, type SlotFormula } from "@/lib/simulation/bounceMath";
import { FORMULA_NAMES } from "./schema";

export { MAX_FORMULA_LENGTH };
export type { SlotFormula };

/** The slot names of a spec with these variable ids. */
export function formulaNames(varIds: readonly string[]): string[] {
  return [...FORMULA_NAMES, ...varIds];
}

/** Slot indexes of the fixed variables. */
export const SLOT = { n: 0, t: 1, b: 2, r: 3, balls: 4, tiles: 5, escaped: 6, tier: 7, size: 8, speed: 9, firstVar: 10 } as const;

/** Why a formula error happened, in a sentence an author can act on. */
export function formulaErrorText(error: FormulaError): string {
  switch (error.code) {
    case "empty":
      return "the formula is empty";
    case "tooLong":
      return `the formula is longer than ${MAX_FORMULA_LENGTH} characters`;
    case "unknownName":
      return `unknown name "${error.name}" at ${error.at}`;
    case "arity":
      return `wrong number of arguments for ${error.name}() at ${error.at}`;
    case "unclosed":
      return `a bracket opened at ${error.at} is not closed`;
    case "badNumber":
      return `a bad number at ${error.at}`;
    default:
      return `unexpected text at ${error.at}`;
  }
}

export type BlueprintFormulaResult = { ok: true; formula: SlotFormula } | { ok: false; error: string };

/** Compiles one slot's formula over the spec's names; a sentence when it does not compile. */
export function compileBlueprintFormula(text: string, varIds: readonly string[]): BlueprintFormulaResult {
  const result = compileFormulaWith(text, formulaNames(varIds));
  return result.ok ? result : { ok: false, error: formulaErrorText(result.error) };
}

/** Runs a compiled slot formula over the slot values (see SLOT). NaN / ±Infinity come back as they are. */
export function evaluateBlueprintFormula(formula: SlotFormula, slots: Float64Array): number {
  return evaluateFormulaSlots(formula, slots);
}
