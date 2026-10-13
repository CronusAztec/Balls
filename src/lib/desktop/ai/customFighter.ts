import type { AgentTask } from "./agent";
import type { JsonSchema } from "./jsonSchema";
import { languageName } from "./studio";
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  PRIMITIVE_PARAMS,
  STYLES_OF_KIND,
  buildCustomFighter,
  type CustomFighterSpec,
  type CustomWeaponSpec,
  type ParamValue,
} from "@/lib/physics/modes/fightLeagueCustom";
import { FL_ABILITY_PRIMITIVES, FL_ROLES, FL_WEAPON_KINDS, type FlPrimitive, type FlRole, type FlStats } from "@/lib/physics/modes/fightLeagueRoster";

/*
 * --- custom-content --- What the app's AI is asked for when it makes a fighter: the answer's schema (the local model is held to
 * it by a grammar, a cloud model is told it in the prompt), the catalogs the prompt lists and the step from the model's answer
 * to a spec. The spec becomes a roster row in fightLeagueCustom.ts, which clamps every number.
 */

/* ------------------------------------------------------------------ what the model is asked for */

const color: JsonSchema = { type: "string", maxLength: 9 };

/** The answer's schema: the few things a fighter needs; every number is optional (a missing one takes its default). */
export const CUSTOM_FIGHTER_FINAL: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2, maxLength: NAME_MAX },
    role: { enum: FL_ROLES },
    body: color,
    accent: color,
    description: { type: "string", minLength: 8, maxLength: DESCRIPTION_MAX },
    weapon: {
      type: "object",
      properties: {
        kind: { enum: FL_WEAPON_KINDS },
        style: { type: "string", maxLength: 12 },
        color,
        reach: { type: "number" },
        cooldown: { type: "number" },
        damage: { type: "number" },
        knockback: { type: "number" },
        speed: { type: "number" },
        count: { type: "integer" },
        size: { type: "number" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    stats: {
      type: "object",
      properties: { hp: { type: "number" }, speed: { type: "number" }, attackSpeed: { type: "number" }, damage: { type: "number" }, castSpeed: { type: "number" }, size: { type: "number" } },
      additionalProperties: false,
    },
    ability: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 2, maxLength: 28 },
        primitive: { enum: FL_ABILITY_PRIMITIVES },
        params: { type: "object" },
        ultimate: { type: "boolean" },
      },
      required: ["name", "primitive"],
      additionalProperties: false,
    },
  },
  required: ["name", "role", "body", "accent", "description", "weapon", "ability"],
  additionalProperties: false,
};

/** One line per primitive: its name and its numbers with bounds, for the prompt. */
export function primitiveCatalog(): string {
  return FL_ABILITY_PRIMITIVES.map((p) => {
    const parts = Object.entries(PRIMITIVE_PARAMS[p]).map(([key, def]) => {
      if ("min" in def) return `${key} ${def.min}–${def.max}${def.optional ? "?" : ""}`;
      if ("flag" in def) return `${key} true?`;
      if ("choice" in def) return `${key} ${def.choice.join("|")}`;
      return null;
    });
    return `${p}: ${parts.filter(Boolean).join(", ")}`;
  }).join("\n");
}

/** One line per weapon kind: its styles. */
export function weaponCatalog(): string {
  return FL_WEAPON_KINDS.map((k) => {
    const styles = (STYLES_OF_KIND[k] ?? ["plain"]).filter((s) => s !== "plain");
    return styles.length ? `${k} (style: ${styles.join("|")})` : k;
  }).join(", ");
}

/** Turns the model's answer into a spec (the fields it may have mistyped fixed or dropped); the builder does the rest. */
export function specFromAnswer(raw: unknown): CustomFighterSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const weapon = r.weapon as CustomWeaponSpec | undefined;
  const ability = r.ability as { name?: string; primitive?: FlPrimitive; params?: Record<string, ParamValue>; ultimate?: boolean } | undefined;
  if (!weapon || !ability) return null;
  return {
    name: String(r.name ?? ""),
    role: r.role as FlRole,
    body: String(r.body ?? ""),
    accent: String(r.accent ?? ""),
    description: String(r.description ?? ""),
    weapon,
    stats: r.stats as Partial<FlStats> | undefined,
    ability: { name: String(ability.name ?? ""), primitive: ability.primitive as FlPrimitive, params: ability.params, ultimate: ability.ultimate === true },
    createdAt: new Date().toISOString(),
  };
}

/** The fighter a valid answer becomes, or the reasons it is not one. */
export function fighterFromAnswer(raw: unknown, taken: ReadonlySet<string>): ReturnType<typeof buildCustomFighter> {
  const spec = specFromAnswer(raw);
  return spec ? buildCustomFighter(spec, taken) : { ok: false, errors: ["answer: a fighter with a weapon and an ability is needed"] };
}

export function customFighterTask(request: string, locale: string, taken: ReadonlySet<string>): AgentTask<Record<string, unknown>> {
  const system = [
    "You design a NEW fighter for JumpingBallsLive's Ball Fight League: a ball with one weapon and one special ability. The app draws every weapon and effect itself as simple shapes, so you only choose from the lists below; use original names and looks, never logos or copied artwork.",
    "Answer with the fighter: name, role, two colours (#rrggbb), a one-sentence description, the weapon (kind, and only if you want to change them a few numbers: reach, cooldown, damage, knockback, speed, count, size), optionally stats (hp, speed, attackSpeed, damage, castSpeed, size around 1; hp about 100) and the ability (name, primitive, params).",
    "Roles: tank (tough and slow), glass (fast and fragile), bruiser, duelist, ranged, control, summoner, support. The app keeps every number inside fair bounds, so do not worry about balance.",
    `Weapon kinds: ${weaponCatalog()}.`,
    "Ability primitives and their params (numbers within the range, \"?\" = optional, flags are true):",
    primitiveCatalog(),
    `Write the name, ability name and description in ${languageName(locale)}.`,
  ].join("\n");
  return {
    system,
    user: request,
    tools: [],
    name: "fighter",
    finalHint:
      '{"name":"<name>","role":"duelist","body":"#rrggbb","accent":"#rrggbb","description":"<one sentence>","weapon":{"kind":"<kind>","damage":<number, optional>},"ability":{"name":"<ability name>","primitive":"<primitive>","params":{<its numbers>}}}',
    final: CUSTOM_FIGHTER_FINAL,
    checkFinal: (result) => {
      const built = fighterFromAnswer(result, taken);
      return built.ok ? [] : built.errors;
    },
    maxSteps: 5,
    temperature: 0.5,
    maxTokens: 900,
  };
}
