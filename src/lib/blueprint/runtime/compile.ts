/*
 * --- blueprint --- A resolved Blueprint compiled for a run: ids become indexes, formulas become programs (compiled once,
 * evaluated without allocating), and the rules are grouped by trigger in their list order. Pure; the input is a sanitized
 * spec (sanitizeBlueprint), so every reference resolves and every formula compiles.
 */
import { compileBlueprintFormula, type SlotFormula } from "../formula";
import { TRIGGERS, type Blueprint, type BlueprintAction, type BlueprintRule, type BlueprintSpawner, type Num, type Trigger } from "../schema";

/** A number slot: a constant or a compiled formula. */
export type CompiledNum = number | SlotFormula;

export interface CompiledSpawner {
  spec: BlueprintSpawner;
  body: number;
  count: CompiledNum;
  speed: CompiledNum;
}

export interface CompiledAction {
  spec: BlueprintAction;
  /** The body (spawn), else −1. */
  body: number;
  /** The variable (var), else −1. */
  varIndex: number;
  /** The action's number slots, by field name. */
  nums: Record<string, CompiledNum>;
}

export interface CompiledRule {
  index: number;
  spec: BlueprintRule;
  trigger: Trigger;
  /** Self's body (−1: any). */
  of: number;
  /** ballHit: the other's body (≥ 0), or −1 with `relation`. */
  withBody: number;
  relation: "any" | "same" | "sameTier" | "sameTeam" | "otherTeam";
  /** countReached: the variable counted (≥ 0), or −1 with spec.what. */
  whatVar: number;
  actions: CompiledAction[];
}

export interface CompiledBlueprint {
  bp: Blueprint;
  bodyIndex: Map<string, number>;
  varIndex: Map<string, number>;
  spawners: CompiledSpawner[];
  rules: CompiledRule[];
  /** Rule indexes per trigger, in list order. */
  byTrigger: Record<Trigger, number[]>;
  /** The finish conditions' bodies (−1: any) and variables (−1: none). */
  finishOf: number[];
  finishVar: number[];
}

function compileNum(value: Num, varIds: readonly string[], fallback: number): CompiledNum {
  if (typeof value === "number") return value;
  const r = compileBlueprintFormula(value, varIds);
  return r.ok ? r.formula : fallback;
}

export function compileBlueprint(bp: Blueprint): CompiledBlueprint {
  const bodyIndex = new Map(bp.bodies.map((b, i) => [b.id, i]));
  const varIndex = new Map(bp.vars.map((v, i) => [v.id, i]));
  const varIds = bp.vars.map((v) => v.id);
  const body = (id: string | null) => (id === null ? -1 : (bodyIndex.get(id) ?? -1));
  const spawners = bp.spawners.map((s) => ({ spec: s, body: Math.max(0, body(s.body)), count: compileNum(s.count, varIds, 1), speed: compileNum(s.speed, varIds, 300) }));
  const byTrigger = Object.fromEntries(TRIGGERS.map((t) => [t, [] as number[]])) as Record<Trigger, number[]>;
  const rules = bp.rules.map((r, index): CompiledRule => {
    byTrigger[r.when].push(index);
    const isRelation = r.with === "any" || r.with === "same" || r.with === "sameTier" || r.with === "sameTeam" || r.with === "otherTeam";
    return {
      index,
      spec: r,
      trigger: r.when,
      of: body(r.of),
      withBody: isRelation ? -1 : body(r.with),
      relation: isRelation ? (r.with as CompiledRule["relation"]) : "any",
      whatVar: varIndex.get(r.what) ?? -1,
      actions: r.do.map((a) => {
        const nums: Record<string, CompiledNum> = {};
        for (const [k, v] of Object.entries(a)) if (k !== "act" && (typeof v === "number" || (typeof v === "string" && isNumSlot(a, k)))) nums[k] = compileNum(v as Num, varIds, 0);
        return { spec: a, body: a.act === "spawn" ? Math.max(0, body(a.body)) : -1, varIndex: a.act === "var" ? (varIndex.get(a.id) ?? -1) : -1, nums };
      }),
    };
  });
  return {
    bp,
    bodyIndex,
    varIndex,
    spawners,
    rules,
    byTrigger,
    finishOf: bp.finish.any.map((c) => body(c.of)),
    finishVar: bp.finish.any.map((c) => varIndex.get(c.what) ?? -1),
  };
}

/** The action fields that are number slots (a text there is a formula, not a word). */
const NUM_SLOTS: Readonly<Record<string, readonly string[]>> = {
  spawn: ["count", "speed"],
  split: ["into"],
  grow: ["by"],
  speed: ["scale"],
  tier: ["by"],
  damage: ["amount"],
  var: ["value"],
  impulse: ["amount"],
};

function isNumSlot(a: BlueprintAction, key: string): boolean {
  return (NUM_SLOTS[a.act] ?? []).includes(key);
}
