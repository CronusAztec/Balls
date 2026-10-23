/*
 * --- blueprint --- A Blueprint's sliders (`params`): each sets one number of the resolved spec, named by its path. Mode Lab
 * shows one slider per parameter and writes the values into the link (`blv`, comma-separated, an empty place keeping the
 * spec's own value). A value is never clamped to its slider here: the patched spec is sanitized again, so a structural
 * ceiling (tiles, balls, rings…) or a design domain puts it back in range, exactly as it would in a spec written that way.
 */
import { sanitizeBlueprint } from "./sanitize";
import { numberAt, paramPathSteps, setNumberAt, type Blueprint } from "./schema";

/** The value parameter `i` has in a spec (its path's number), or NaN. */
export function paramValue(bp: Blueprint, i: number): number {
  const p = bp.params[i];
  return p ? (numberAt(bp, p.at) ?? NaN) : NaN;
}

/** Parameter values from a link's `blv` (comma-separated; an empty or unreadable place: null, the spec's own value). */
export function parseParamValues(text: string): (number | null)[] {
  if (typeof text !== "string" || text.trim() === "") return [];
  return text
    .split(",")
    .slice(0, 16)
    .map((t) => {
      const s = t.trim();
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    });
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so a slider value survives the link. */
function formatValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** `blv` of parameter values ("" when none is set; trailing empty places dropped). */
export function formatParamValues(values: readonly (number | null | undefined)[]): string {
  const out = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? formatValue(v) : ""));
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join(",");
}

/**
 * The spec with parameter values applied (in order; null, undefined or a non-finite value keeps the spec's own), sanitized
 * again. With no value set it is the spec itself.
 */
export function applyBlueprintParams(bp: Blueprint, values: readonly (number | null | undefined)[]): { blueprint: Blueprint; notes: string[] } {
  if (!values.some((v, i) => i < bp.params.length && typeof v === "number" && Number.isFinite(v))) return { blueprint: bp, notes: [] };
  const copy = JSON.parse(JSON.stringify(bp)) as Blueprint;
  bp.params.forEach((p, i) => {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) setNumberAt(copy, p.at, v);
  });
  const { blueprint, notes } = sanitizeBlueprint(copy);
  return { blueprint, notes };
}

// --- review fix (blueprint) --- the unit a slider shows its value in
/** The unit a parameter's value is in: seconds, degrees, degrees a second, px, px a second, px a second² – or none (a count). */
export type ParamUnit = "s" | "deg" | "degPerSec" | "px" | "pxPerSec" | "pxPerSec2" | "";

/** The unit of parameter `i` of a spec, read from the field its path names (and, for an action's number, the action). */
export function paramUnit(bp: Blueprint, i: number): ParamUnit {
  const p = bp.params[i];
  const steps = p ? paramPathSteps(p.at) : null;
  if (!steps) return "";
  const key = String(steps[steps.length - 1]);
  if (/DegPerSec$/.test(key)) return "degPerSec";
  if (/Deg$/.test(key)) return "deg";
  if (key === "sec" || /Sec$/.test(key)) return "s";
  if (steps[0] === "arena" && steps[1] === "gravity") return "pxPerSec2";
  if (key === "speed") return "pxPerSec";
  if (key === "radius") return "px";
  // an action's number: a grow's is px and an impulse's px/s; the others are counts or factors
  if (steps[0] === "rules" && steps[2] === "do") {
    const action = bp.rules[steps[1] as number]?.do[steps[3] as number];
    if (action?.act === "grow" && key === "by") return "px";
    if (action?.act === "impulse" && key === "amount") return "pxPerSec";
  }
  return "";
}
