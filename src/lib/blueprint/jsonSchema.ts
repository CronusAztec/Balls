/*
 * --- blueprint --- The full Blueprint form as a JSON Schema (the subset of lib/desktop/ai/jsonSchema.ts, also valid JSON
 * Schema): what a cloud model or a coding agent is shown (the bp-schema tool, docs/agents/BLUEPRINTS.md). It states the
 * structure, the words and the design domains; validateBlueprint (sanitize.ts) is the final word – it also checks
 * references (a body id a rule names), formulas and the spec's byte size, which a schema cannot.
 */
import type { JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { BLUEPRINT_LIMITS as L, BLUEPRINT_RADIUS_CEILING, BLUEPRINT_SPEED_CEILING } from "./limits";
import {
  ACTION_AT,
  ACTION_DOCS,
  ACTION_TARGETS,
  ACTIONS,
  ARENA_SHAPES,
  BLUEPRINT_AUTHORS,
  BLUEPRINT_FAMILIES,
  BODY_COLLIDE,
  COUNT_REFS,
  DAMAGE_TARGETS,
  DIRECTIONS,
  FINISH_DOCS,
  FINISH_KINDS,
  FX_KINDS,
  IMPULSE_DIRECTIONS,
  OBSTACLE_KINDS,
  PARAM_PATH,
  RECOLOR_MODES,
  SOUND_SCALES,
  SPAWN_AT,
  TEAM_MODES,
  TILE_LAYOUTS,
  TILE_PITCH,
  TILE_STYLES,
  TRIGGER_DOCS,
  TRIGGERS,
  VAR_OPS,
  VOICE_TRIGGERS,
  VOICES,
  WINNERS,
} from "./schema";

const num = (description?: string, minimum?: number, maximum?: number): JsonSchema => ({ type: "number", ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}), ...(description ? { description } : {}) });
/** --- review fix (blueprint) --- A number strictly above `above` (the validator refuses the bound itself: a radius of 0). */
const over = (description: string | undefined, above: number, maximum?: number): JsonSchema => ({ type: "number", exclusiveMinimum: above, ...(maximum !== undefined ? { maximum } : {}), ...(description ? { description } : {}) });
/** A colour as the validator wants it written: "#" and six lower-case hex digits. */
const hex: JsonSchema = { type: "string", pattern: "^#[0-9a-f]{6}$", description: 'a colour, lower case: "#ff4d6d"' };
const int = (description?: string, minimum?: number, maximum?: number): JsonSchema => ({ ...num(description, minimum, maximum), type: "integer" });
const formula = (description: string, minimum?: number, maximum?: number): JsonSchema => ({ oneOf: [num(undefined, minimum, maximum), { type: "string", minLength: 1, maxLength: 200 }], description: `${description} (a number or a formula)` });
const words = (values: readonly string[], description?: string): JsonSchema => ({ type: "string", enum: values, ...(description ? { description } : {}) });
const id: JsonSchema = { type: "string", pattern: "^[a-z][a-z0-9]{0,7}$" };
const text = (max: number, description?: string): JsonSchema => ({ type: "string", maxLength: max, ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema => ({ type: "object", additionalProperties: false, properties, required, ...(description ? { description } : {}) });
const list = (items: JsonSchema, maxItems: number, minItems = 0, description?: string): JsonSchema => ({ type: "array", items, minItems, maxItems, ...(description ? { description } : {}) });
const nullable = (s: JsonSchema): JsonSchema => ({ ...s, type: [s.type as "object", "null"] });

function obstacleSchema(): JsonSchema {
  const xy = { x: num("arena units", -1, 1), y: num("arena units", -1, 1) };
  const r = over("radius, arena units", 0, 1);
  const variants: Record<(typeof OBSTACLE_KINDS)[number], Record<string, JsonSchema>> = {
    peg: { ...xy, r },
    bumper: { ...xy, r, kick: num("px/s added on a hit") },
    pegGrid: { ...xy, w: over(undefined, 0, 2), h: over(undefined, 0, 2), rows: int(undefined, 1, 48), cols: int(undefined, 1, 48), r, stagger: { type: "boolean" } },
    pegRing: { ...xy, radius: over(undefined, 0, 1), count: int(undefined, 1, 48), r },
    bar: { ...xy, len: over(undefined, 0, 2), angleDeg: num(), thick: over(undefined, 0, 0.5) },
    spinner: { ...xy, len: over(undefined, 0, 2), angleDeg: num(), spinDegPerSec: num(), thick: over(undefined, 0, 0.5) },
  };
  return { oneOf: OBSTACLE_KINDS.map((k) => obj({ kind: { const: k }, ...variants[k] }, ["kind"])) };
}

function actionSchema(): JsonSchema {
  const target = words(ACTION_TARGETS);
  const variants: Record<(typeof ACTIONS)[number], Record<string, JsonSchema>> = {
    spawn: { body: id, count: formula("balls", 0, L.perSpawn), at: words(ACTION_AT), speed: formula("px/s", -BLUEPRINT_SPEED_CEILING, BLUEPRINT_SPEED_CEILING), dir: words(DIRECTIONS) },
    split: { target, into: formula("balls", 2, L.perSpawn), scale: over("radius factor", 0) },
    merge: { scale: num("radius factor; 0 = areas add up", 0) },
    remove: { target },
    grow: { target, by: formula("px") },
    speed: { target, scale: formula("factor") },
    recolor: { target, color: { oneOf: [int(undefined, 0, L.palette - 1), words(RECOLOR_MODES)] } },
    tier: { target, by: formula("tiers") },
    team: { target, to: { oneOf: [int(undefined, 0, L.teams - 1), words(TEAM_MODES)] } },
    damage: { target: words(DAMAGE_TARGETS), amount: formula("HP") },
    var: { id, op: words(VAR_OPS), value: formula("value") },
    impulse: { target, dir: words(IMPULSE_DIRECTIONS), amount: formula("px/s") },
    fx: { kind: words(FX_KINDS) },
    sound: { voice: words(VOICES), pitch: int("scale steps", -24, 24) },
  };
  const required: Partial<Record<(typeof ACTIONS)[number], string[]>> = { spawn: ["body"], var: ["id"] };
  return { oneOf: ACTIONS.map((a) => obj({ act: { const: a }, ...variants[a] }, ["act", ...(required[a] ?? [])], ACTION_DOCS[a])) };
}

/** The JSON Schema of a Blueprint v1 (the compact form an author writes; the resolved form's nulls are allowed too). */
export function blueprintJsonSchema(): JsonSchema {
  return obj(
    {
      v: { const: 1 },
      meta: obj({ name: text(L.nameChars), description: text(L.descriptionChars), family: words(BLUEPRINT_FAMILIES), author: words(BLUEPRINT_AUTHORS), needs: list({ type: "string" }, 8) }, ["name"]),
      arena: obj({
        shape: words(ARENA_SHAPES),
        size: num("share of the recorder's square", L.minArenaSize, L.maxArenaSize),
        restitution: num("bounciness", 0),
        gravity: obj({ x: num("px/s²"), y: num("px/s²") }),
        spinDegPerSec: num("the rim and its exits turn"),
        exits: list(obj({ atDeg: num("clock degrees"), widthDeg: num(undefined, 1, 180) }, ["atDeg", "widthDeg"]), L.exits, 0, "gaps in a circle's rim"),
        rings: nullable(obj({ count: int(undefined, 1, L.rings), gapDeg: num(undefined, 5, 180), spinDegPerSec: num(), alternate: { type: "boolean" }, breakOnPass: { type: "boolean" }, inner: num(undefined, 0.1, 0.9), rim: { type: "boolean", description: "a solid rim round the rings: no ball escapes" } })),
      }),
      bodies: list(obj({ id, radius: over("px", 0, BLUEPRINT_RADIUS_CEILING), color: int("palette index", 0, L.palette - 1), gravityScale: num(), hp: int(undefined, 0), tier: int(undefined, 1, L.maxTier), team: int(undefined, 0, L.teams - 1), collide: words(BODY_COLLIDE) }, ["id"]), L.bodies, 1),
      tiles: nullable(
        obj({
          layout: words(TILE_LAYOUTS),
          rows: int(undefined, 1, L.tileRows),
          cols: int(undefined, 1, L.tileCols),
          hp: int(undefined, 1),
          hpStep: int(undefined, 0),
          pierce: { type: "boolean" },
          style: words(TILE_STYLES),
          pitchBy: words(TILE_PITCH),
          area: obj({ x: num(undefined, -1, 1), y: num(undefined, -1, 1), w: over(undefined, 0, 2), h: over(undefined, 0, 2) }),
          inner: num(undefined, 0.05, 1),
          outer: num(undefined, 0.05, 1),
        }),
      ),
      obstacles: list(obstacleSchema(), L.obstaclePatterns),
      vars: list(obj({ id, start: num() }, ["id"]), L.vars),
      spawners: list(
        obj({ body: id, at: words(SPAWN_AT), count: formula("balls", 1, L.perSpawn), speed: formula("px/s", -BLUEPRINT_SPEED_CEILING, BLUEPRINT_SPEED_CEILING), dir: words(DIRECTIONS), startSec: num(undefined, 0), everySec: num("0: once", 0), onBeat: { type: "boolean" }, maxTotal: int(undefined, 1, L.balls) }, ["body"]),
        L.spawners,
        1,
      ),
      rules: list(
        obj(
          {
            when: words(TRIGGERS, TRIGGERS.map((t) => `${t}: ${TRIGGER_DOCS[t]}`).join("; ")),
            of: { type: ["string", "null"], description: "self's body id" },
            with: { type: "string", description: "ballHit: a body id, or any|same|sameTier|sameTeam|otherTeam" },
            sec: over("timer: seconds", 0),
            what: { type: "string", description: `countReached: ${COUNT_REFS.join("|")} or a variable id` },
            atLeast: { type: ["number", "null"] },
            atMost: { type: ["number", "null"] },
            every: int(undefined, 1),
            chance: num(undefined, 0, 1),
            cooldownSec: num(undefined, 0),
            maxFires: int("0: no limit", 0),
            do: list(actionSchema(), L.actionsPerRule, 1),
          },
          ["when", "do"],
        ),
        L.rules,
      ),
      finish: obj(
        {
          any: list(
            obj({ when: words(FINISH_KINDS, FINISH_KINDS.map((k) => `${k}: ${FINISH_DOCS[k]}`).join("; ")), of: { type: ["string", "null"] }, what: { type: "string" }, atLeast: { type: ["number", "null"] }, atMost: { type: ["number", "null"] }, say: text(L.sayChars) }, ["when"]),
            L.finishConditions,
          ),
          timeoutSec: num(undefined, L.minTimeoutSec, L.maxTimeoutSec),
          winner: words(WINNERS),
          timeoutSay: text(L.sayChars),
        },
        ["timeoutSec"],
      ),
      hud: list(obj({ show: { type: "string" }, label: text(L.labelChars) }, ["show"]), L.hud),
      look: obj({ palette: list(hex, L.palette, 1), background: hex, trail: { type: "boolean" }, rim: int(undefined, 0, L.palette - 1), teamNames: list(text(L.labelChars), L.teams) }),
      sound: obj({ scale: words(SOUND_SCALES), root: int("0 = C … 11 = B", 0, 11), bpm: over(undefined, 0), voices: obj(Object.fromEntries(VOICE_TRIGGERS.map((t) => [t, words([...VOICES, "none"])]))) }),
      params: list(
        obj({ id, label: text(L.labelChars), at: { type: "string", pattern: PARAM_PATH.source, description: "the path of a number of this spec: tiles.rows, spawners[0].count, finish.any[0].atLeast…" }, min: num(), max: num(), step: over(undefined, 0) }, ["id", "at", "min", "max"]),
        L.params,
        0,
        "sliders Mode Lab offers: each sets one number of the spec (sanitized again after)",
      ),
    },
    ["v", "meta", "bodies", "spawners", "finish"],
    "A JumpingBallsLive Blueprint v1: a game mode as data.",
  );
}
