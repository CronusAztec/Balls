/*
 * --- blueprint --- A Blueprint's sliders (`params`): each sets one number of the resolved spec, named by its path. Mode Lab
 * shows one slider per parameter and writes the values into the link (`blv`, comma-separated, an empty place keeping the
 * spec's own value). A value is never clamped to its slider here: the patched spec is sanitized again, so a structural
 * ceiling (tiles, balls, rings…) or a design domain puts it back in range, exactly as it would in a spec written that way.
 */
import { readBlueprintNumbers, sanitizeBlueprint, type BlueprintNumberBound } from "./sanitize";
import { canonicalParamPath, numberAt, paramPathSteps, setNumberAt, type Blueprint } from "./schema";
import { formatExact } from "@/lib/uncap"; // --- unlimited-sizes --- (a link value written exactly)

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

/**
 * --- unlimited-sizes --- Exactly (`formatExact()`, as settings.ts writes a value past its slider: the shortest text that
 * reads back as the same number), so what the number field takes is what plays – a rain every 0.0004 s stays that fast,
 * where three decimals made it 0 and stopped the rain.
 */
function formatValue(n: number): string {
  return formatExact(n);
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
  const held = heldSpec(bp, values);
  if (!held) return { blueprint: bp, notes: [] };
  const { blueprint, notes } = sanitizeBlueprint(held);
  return { blueprint, notes };
}

/**
 * --- unlimited-sizes --- The spec with parameter values written in (as applyBlueprintParams() takes them), before it is
 * sanitized again: the numbers a link's values hold, crossing or past a ceiling as they may be. Null when no value is set.
 */
function heldSpec(bp: Blueprint, values: readonly (number | null | undefined)[]): Blueprint | null {
  if (!values.some((v, i) => i < bp.params.length && typeof v === "number" && Number.isFinite(v))) return null;
  const copy = JSON.parse(JSON.stringify(bp)) as Blueprint;
  bp.params.forEach((p, i) => {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) setNumberAt(copy, p.at, v);
  });
  return copy;
}

// --- unlimited-sizes --- the bound a slider's number field holds to
/**
 * The bound the language holds each parameter's number to, in order: the sanitizer's own rule at its path
 * (`blueprintNumberBounds()`: a gap of at least 5°, a tier from 1 to 99, a radius above 0 up to the radius ceiling), {} for a
 * number it does not bound; a variable a count reads (Colour Conquest's balls a colour) is that count's, a whole number from 0
 * to 8. A slider's `min` and `max` never enter it: they only shape the drag (Mode Lab's number field takes any value inside
 * this bound, past the slider's ends too). A bound that depends on other numbers (rows under the tile ceiling given the
 * columns, a peg grid's rows given the other patterns, the tiles' inner edge below the outer one) is read on the spec with
 * every slider's value written in (`values`, the link's `blv`), before it is sanitized: it holds while the other sliders stay
 * where they are, even where their values cross (both edges reset) or drop a pattern (its room is what the others leave it).
 */
export function paramBounds(bp: Blueprint, values: readonly (number | null | undefined)[] = []): BlueprintNumberBound[] {
  const { bounds } = readBlueprintNumbers(heldSpec(bp, values) ?? bp);
  return bp.params.map((p) => ({ ...bounds.get(canonicalParamPath(p.at) ?? p.at) }));
}

/**
 * The value each parameter plays with the sliders at `values` (the link's `blv`), in order: its path's number in the spec the
 * game plays – the one a link's value past the language's bound was changed to, found at its new place when a pattern before
 * it was dropped –, a counted variable's start as the runtime counts it (rounded into its bound: 0.4 balls a colour play 0),
 * or null when the game no longer has that number (its pattern dropped by the obstacle ceiling).
 */
export function paramsPlayed(bp: Blueprint, values: readonly (number | null | undefined)[]): (number | null)[] {
  const held = heldSpec(bp, values);
  const played = held ? sanitizeBlueprint(held).blueprint : bp;
  const { bounds, counted, obstacleAt } = readBlueprintNumbers(held ?? bp);
  return bp.params.map((p) => {
    const at = canonicalParamPath(p.at) ?? p.at;
    // (a number of an obstacle pattern: at the pattern's index in the spec played; a pattern not read there is not played)
    const pattern = /^obstacles\[(\d+)\]/.exec(at);
    const moved = pattern ? (obstacleAt[Number(pattern[1])] ?? null) : undefined;
    if (moved === null) return null;
    const v = numberAt(played, pattern ? `obstacles[${moved}]${at.slice(pattern[0].length)}` : at);
    if (v === undefined) return null;
    if (!counted.has(at)) return v;
    const b = bounds.get(at) ?? {};
    const whole = Math.round(v);
    return b.min !== undefined && whole < b.min ? b.min : b.max !== undefined && whole > b.max ? b.max : whole;
  });
}

/** The value parameter `i` plays with the sliders at `values` (`paramsPlayed()`), or null when the game leaves it out. */
export function paramPlayed(bp: Blueprint, values: readonly (number | null | undefined)[], i: number): number | null {
  return paramsPlayed(bp, values)[i] ?? null;
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
