/*
 * --- blueprint --- The Lite form: a Blueprint in words a 1.5B local model can pick (Qwen2.5 1.5B is in the app's catalog).
 * Every field is an enum of level words or a small fixed set – no free number, no id to invent – so the app's grammar
 * (desktop/src/ai/gbnf.ts toGrammarSchema keeps enum, const, oneOf, string lengths and array bounds, and drops minimum,
 * maximum and pattern) holds the model to valid values by construction. At most 3 bodies (a, b, c), 3 starts, 6 flat
 * rules of one action each, one tiles block, one pegs block and 2 HUD counters.
 *
 * liteSchema() is the JSON Schema for both the grammar and the reply envelope; liteToBlueprint() maps the words onto a full
 * spec, which then goes through the same sanitizer as every other spec (sanitize.ts) – so a Lite reply can never do what a
 * full spec cannot.
 */
import type { JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { BLUEPRINT_LIMITS as L } from "./limits";
import { sanitizeBlueprint, type SanitizeResult } from "./sanitize";
import { isRecord, own } from "./text";

export const LITE_SIZES = { tiny: 5, small: 8, medium: 12, large: 18, huge: 26 } as const;
export const LITE_SPEEDS = { still: 0, slow: 150, normal: 300, fast: 500, wild: 800 } as const;
export const LITE_GRAVITY = { none: 0, low: 150, normal: 350, high: 700, reverse: -350 } as const;
export const LITE_BOUNCE = { soft: 0.6, normal: 0.9, bouncy: 1 } as const;
export const LITE_SPIN = { none: 0, slow: 25, fast: 70 } as const;
export const LITE_AMOUNTS = { one: 1, few: 3, some: 6, many: 12 } as const;
export const LITE_HP = { low: 1, medium: 3, high: 6 } as const;
export const LITE_TIMEOUTS = { short: 30, medium: 60, long: 90 } as const;
export const LITE_COLORS = ["red", "blue", "green", "gold", "purple", "cyan"] as const;
export const LITE_BODY_IDS = ["a", "b", "c"] as const;
export const LITE_EXITS = ["none", "top", "bottom", "left", "right", "spinning"] as const;
export const LITE_TRIGGERS = ["start", "timer", "beat", "wallHit", "obstacleHit", "tileHit", "tileBroken", "ballHit", "escape", "ringPass"] as const;
export const LITE_ACTIONS = ["split", "merge", "grow", "shrink", "spawn", "remove", "speedUp", "slowDown", "recolor", "tierUp", "convert", "score", "burst", "sound"] as const;
export const LITE_WITH = ["any", "same", "sameTier", "otherTeam", "a", "b", "c"] as const;
export const LITE_FINISH = ["escaped", "tilesCleared", "ringsCleared", "tier", "teamsLeft", "balls", "score"] as const;
export const LITE_HUD = ["balls", "tiles", "rings", "escaped", "teams", "tier", "time", "score"] as const;

type Level<T> = keyof T;

export interface LiteBlueprint {
  name: string;
  description: string;
  arena: "circle" | "box" | "rings";
  gravity: Level<typeof LITE_GRAVITY>;
  bounce: Level<typeof LITE_BOUNCE>;
  spin: Level<typeof LITE_SPIN>;
  exit: (typeof LITE_EXITS)[number];
  rings?: "few" | "some" | "many";
  bodies: { id: (typeof LITE_BODY_IDS)[number]; size: Level<typeof LITE_SIZES>; color: (typeof LITE_COLORS)[number] }[];
  start: { body: (typeof LITE_BODY_IDS)[number]; amount: Level<typeof LITE_AMOUNTS>; at: "center" | "top" | "random" | "rim"; speed: Level<typeof LITE_SPEEDS> }[];
  tiles?: { layout: "grid" | "ring"; amount: "few" | "some" | "many"; hp: Level<typeof LITE_HP>; style: "glass" | "brick" | "neon" };
  pegs?: { layout: "grid" | "ring"; amount: "few" | "some" | "many" };
  rules: { when: (typeof LITE_TRIGGERS)[number]; of?: (typeof LITE_BODY_IDS)[number] | "any"; with?: (typeof LITE_WITH)[number]; do: (typeof LITE_ACTIONS)[number]; amount?: Level<typeof LITE_AMOUNTS> }[];
  finish: { when: (typeof LITE_FINISH)[number]; amount?: Level<typeof LITE_AMOUNTS>; timeout: Level<typeof LITE_TIMEOUTS> };
  hud?: (typeof LITE_HUD)[number][];
}

const keys = <T extends object>(o: T) => Object.keys(o) as (keyof T & string)[];
const e = (values: readonly string[], description?: string): JsonSchema => ({ type: "string", enum: values, ...(description ? { description } : {}) });

/**
 * The Lite form's JSON Schema: only type, enum, const, oneOf, string lengths, array bounds, properties and required – what the
 * local model's grammar keeps (tests/blueprintLite.test.ts proves it compiles through toGrammarSchema and holds no minimum,
 * maximum or pattern).
 */
export function liteSchema(): JsonSchema {
  const body = e(LITE_BODY_IDS);
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "description", "arena", "gravity", "bounce", "spin", "exit", "bodies", "start", "rules", "finish"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: L.nameChars },
      description: { type: "string", minLength: 8, maxLength: L.descriptionChars },
      arena: e(["circle", "box", "rings"], "rings: spinning rings with gaps; box: four walls, no exit"),
      gravity: e(keys(LITE_GRAVITY)),
      bounce: e(keys(LITE_BOUNCE)),
      spin: e(keys(LITE_SPIN), "how fast the exit or the rings turn"),
      exit: e(LITE_EXITS, "a gap in a circle's rim"),
      rings: e(["few", "some", "many"]),
      bodies: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { type: "object", additionalProperties: false, required: ["id", "size", "color"], properties: { id: body, size: e(keys(LITE_SIZES)), color: e(LITE_COLORS, "also the team") } },
      },
      start: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { type: "object", additionalProperties: false, required: ["body", "amount", "at", "speed"], properties: { body, amount: e(keys(LITE_AMOUNTS)), at: e(["center", "top", "random", "rim"]), speed: e(keys(LITE_SPEEDS)) } },
      },
      tiles: { type: "object", additionalProperties: false, required: ["layout", "amount", "hp", "style"], properties: { layout: e(["grid", "ring"]), amount: e(["few", "some", "many"]), hp: e(keys(LITE_HP)), style: e(["glass", "brick", "neon"]) } },
      pegs: { type: "object", additionalProperties: false, required: ["layout", "amount"], properties: { layout: e(["grid", "ring"]), amount: e(["few", "some", "many"]) } },
      rules: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["when", "do"],
          properties: { when: e(LITE_TRIGGERS), of: e([...LITE_BODY_IDS, "any"]), with: e(LITE_WITH, "ballHit only"), do: e(LITE_ACTIONS), amount: e(keys(LITE_AMOUNTS)) },
        },
      },
      finish: { type: "object", additionalProperties: false, required: ["when", "timeout"], properties: { when: e(LITE_FINISH), amount: e(keys(LITE_AMOUNTS)), timeout: e(keys(LITE_TIMEOUTS)) } },
      hud: { type: "array", minItems: 0, maxItems: 2, items: e(LITE_HUD) },
    },
  };
}

/* ------------------------------------------------------------------ Lite → full */

function word<T extends Record<string, number>>(table: T, value: unknown, fallback: keyof T): number {
  return typeof value === "string" && Object.hasOwn(table, value) ? table[value as keyof T] : table[fallback];
}

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The first `max` entries of a list (read by index: a list carrying its own `constructor` cannot make it throw). */
function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v)) return [];
  const out: unknown[] = [];
  for (let i = 0; i < Math.min(max, v.length); i++) out.push(v[i]);
  return out;
}
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

/** The full spec (raw, compact) a Lite reply stands for. Never throws; the words it does not know fall back to defaults. */
export function liteToRaw(input: unknown): Record<string, unknown> {
  const lite = rec(input);
  const shape = pick(["circle", "box", "rings"], own(lite, "arena"), "circle");
  const spin = word(LITE_SPIN, own(lite, "spin"), "none");
  const exit = pick(LITE_EXITS, own(lite, "exit"), "none");
  const arena: Record<string, unknown> = { shape, restitution: word(LITE_BOUNCE, own(lite, "bounce"), "bouncy"), gravity: { x: 0, y: word(LITE_GRAVITY, own(lite, "gravity"), "none") } };
  if (shape === "circle" && exit !== "none") {
    arena.exits = [{ atDeg: exit === "top" || exit === "spinning" ? 0 : exit === "bottom" ? 180 : exit === "left" ? 270 : 90, widthDeg: exit === "spinning" ? 24 : 30 }];
    arena.spinDegPerSec = exit === "spinning" && spin === 0 ? LITE_SPIN.slow : spin;
  }
  if (shape === "rings") arena.rings = { count: { few: 3, some: 5, many: 8 }[pick(["few", "some", "many"], own(lite, "rings"), "some")], spinDegPerSec: spin || LITE_SPIN.slow };

  const bodies = arr(own(lite, "bodies"), 3)
    .map(rec)
    .map((b) => {
      const color = LITE_COLORS.indexOf(pick(LITE_COLORS, own(b, "color"), "red"));
      return { id: pick(LITE_BODY_IDS, own(b, "id"), "a"), radius: word(LITE_SIZES, own(b, "size"), "small"), color, team: color };
    })
    .filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
  if (!bodies.length) bodies.push({ id: "a", radius: LITE_SIZES.small, color: 0, team: 0 });
  const ids = bodies.map((b) => b.id);
  const bodyOf = (v: unknown) => (typeof v === "string" && ids.includes(v as "a") ? v : ids[0]);

  const spawners = arr(own(lite, "start"), 3).map(rec).map((s) => {
    const amount = word(LITE_AMOUNTS, own(s, "amount"), "one");
    const out: Record<string, unknown> = { body: bodyOf(own(s, "body")), at: pick(["center", "top", "random", "rim"], own(s, "at"), "center"), count: Math.min(amount, L.perSpawn), speed: word(LITE_SPEEDS, own(s, "speed"), "normal") };
    if (amount > L.perSpawn) Object.assign(out, { everySec: 0.25, maxTotal: amount });
    return out;
  });

  const raw: Record<string, unknown> = { v: 1, meta: { name: own(lite, "name"), description: own(lite, "description"), author: "ai" }, arena, bodies, spawners };

  const tiles = own(lite, "tiles");
  if (isRecord(tiles)) {
    const layout = pick(["grid", "ring"], own(tiles, "layout"), "grid");
    const amount = pick(["few", "some", "many"], own(tiles, "amount"), "some");
    const [rows, cols] = layout === "grid" ? { few: [2, 8], some: [3, 12], many: [5, 16] }[amount] : { few: [2, 12], some: [3, 18], many: [5, 24] }[amount];
    raw.tiles = { layout, rows, cols, hp: word(LITE_HP, own(tiles, "hp"), "low"), style: pick(["glass", "brick", "neon"], own(tiles, "style"), "glass") };
  }
  const pegs = own(lite, "pegs");
  if (isRecord(pegs)) {
    const amount = pick(["few", "some", "many"], own(pegs, "amount"), "some");
    raw.obstacles =
      pick(["grid", "ring"], own(pegs, "layout"), "grid") === "grid"
        ? [{ kind: "pegGrid", y: 0.1, w: 1.3, h: 0.9, ...{ few: { rows: 3, cols: 4 }, some: { rows: 4, cols: 6 }, many: { rows: 6, cols: 8 } }[amount] }]
        : [{ kind: "pegRing", radius: 0.55, count: { few: 6, some: 12, many: 24 }[amount] }];
  }

  let needsScore = false;
  const rules = arr(own(lite, "rules"), 6).map(rec).map((r) => {
    const when = pick(LITE_TRIGGERS, own(r, "when"), "wallHit");
    const amount = word(LITE_AMOUNTS, own(r, "amount"), "one");
    const ofRaw = own(r, "of");
    const rule: Record<string, unknown> = { when };
    if (typeof ofRaw === "string" && ofRaw !== "any" && ids.includes(ofRaw as "a")) rule.of = ofRaw;
    if (when === "ballHit") rule.with = pick(LITE_WITH, own(r, "with"), "any");
    if (when === "timer") rule.sec = { 1: 1, 3: 2, 6: 5, 12: 10 }[amount] ?? 2;
    const act = pick(LITE_ACTIONS, own(r, "do"), "sound");
    const step = when === "timer" ? 1 : amount;
    switch (act) {
      case "split":
        rule.do = [{ act: "split", into: Math.min(L.perSpawn, 1 + step) }];
        break;
      case "merge":
        rule.do = [{ act: "merge" }];
        break;
      case "grow":
      case "shrink":
        rule.do = [{ act: "grow", by: act === "grow" ? step : -step }];
        break;
      case "spawn":
        rule.do = [{ act: "spawn", body: typeof rule.of === "string" ? rule.of : ids[0], count: Math.min(L.perSpawn, step), at: when === "tileBroken" ? "tile" : "self" }];
        break;
      case "remove":
        rule.do = [{ act: "remove" }];
        break;
      case "speedUp":
      case "slowDown":
        rule.do = [{ act: "speed", scale: act === "speedUp" ? 1.1 : 0.9 }];
        break;
      case "recolor":
        rule.do = [{ act: "recolor", color: "next" }];
        break;
      case "tierUp":
        rule.do = [{ act: "tier", by: 1 }];
        break;
      case "convert":
        rule.do = when === "ballHit" ? [{ act: "team", target: "other", to: "self" }, { act: "recolor", target: "other", color: "team" }] : [{ act: "team", to: "next" }, { act: "recolor", color: "team" }];
        break;
      case "score":
        needsScore = true;
        rule.do = [{ act: "var", id: "score", op: "add", value: step }];
        break;
      case "burst":
        rule.do = [{ act: "fx", kind: "burst" }];
        break;
      default:
        rule.do = [{ act: "sound", voice: "hit" }];
    }
    return rule;
  });
  if (rules.length) raw.rules = rules;

  const f = rec(own(lite, "finish"));
  const fWhen = pick(LITE_FINISH, own(f, "when"), "escaped");
  const fAmount = pick(keys(LITE_AMOUNTS), own(f, "amount"), "one");
  const cond: Record<string, unknown> =
    fWhen === "tier"
      ? { when: "tier", atLeast: { one: 3, few: 5, some: 7, many: 9 }[fAmount] }
      : fWhen === "teamsLeft"
        ? { when: "teamsLeft", atMost: 1, say: "{winner} WINS" }
        : fWhen === "balls"
          ? { when: "count", what: "balls", atLeast: { one: 20, few: 50, some: 100, many: 200 }[fAmount], say: "{balls} BALLS" }
          : fWhen === "score"
            ? { when: "count", what: "score", atLeast: { one: 10, few: 25, some: 50, many: 100 }[fAmount], say: "SCORE {score}" }
            : fWhen === "escaped"
              ? { when: "escaped", atLeast: LITE_AMOUNTS[fAmount] }
              : { when: fWhen };
  if (fWhen === "score") needsScore = true;
  raw.finish = { any: [cond], timeoutSec: word(LITE_TIMEOUTS, own(f, "timeout"), "medium"), winner: fWhen === "teamsLeft" ? "mostBalls" : fWhen === "escaped" && bodies.length > 1 ? "firstOut" : "none" };
  if (needsScore) raw.vars = [{ id: "score" }];

  const hud = arr(own(lite, "hud"), 2).filter((h): h is string => typeof h === "string" && (LITE_HUD as readonly string[]).includes(h) && (h !== "score" || needsScore));
  if (hud.length) raw.hud = hud.map((show) => ({ show }));
  raw.look = { teamNames: LITE_COLORS.map((c) => c.toUpperCase()) };
  return raw;
}

/** A Lite reply as a resolved spec: liteToRaw, then the one sanitizer every spec goes through. */
export function liteToBlueprint(input: unknown): SanitizeResult {
  return sanitizeBlueprint(liteToRaw(input));
}
