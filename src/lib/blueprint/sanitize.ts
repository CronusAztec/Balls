/*
 * --- blueprint --- Reading a Blueprint someone else wrote: one walker, two modes.
 *
 *  - validateBlueprint(raw) is strict: it returns every problem as `path: sentence` (`rules[3].do[0].body: unknown body "x"
 *    (the bodies: ball, big)`), so an author – a person, a coding agent or the app's AI – can fix exactly that. Empty means
 *    valid.
 *  - sanitizeBlueprint(raw) is tolerant and never throws: the same walker keeps what is valid, drops unknown fields and
 *    entries, resolves references, compiles every formula, folds texts to plain text, puts design domains back in range and
 *    enforces the sandbox's ceilings, and it says what it changed (`notes`). Its output always validates, sanitizing it again
 *    changes nothing, and it survives encode → decode unchanged (tests/blueprintFuzz.test.ts).
 *
 * What is never limited: the physics scalars – speeds, radii, gravity, bounciness, spin – take any finite number, as every
 * setting of the simulator does (lib/uncap.ts); only a value that means nothing (NaN, ±Infinity, a radius of 0 or less) is
 * refused. What is limited: the structure (list lengths, the tile, obstacle, ball and rule ceilings, the spec's bytes) and a
 * few design domains (an arena's size, an exit's width, a team index, a probability).
 */
import { blueprintBytes } from "./codec";
import { compileBlueprintFormula } from "./formula";
import { BLUEPRINT_LIMITS as L } from "./limits";
import {
  ACTION_AT,
  ACTION_DEFAULTS,
  ACTION_TARGETS,
  ACTIONS,
  ARENA_SHAPES,
  BLUEPRINT_AUTHORS,
  BLUEPRINT_FAMILIES,
  BLUEPRINT_FEATURES,
  BODY_COLLIDE,
  COUNT_REFS,
  DAMAGE_TARGETS,
  DEFAULT_PALETTE,
  DEFAULT_TEAM_NAMES,
  DEFAULT_VOICES,
  DEFAULTS,
  DIRECTIONS,
  FINISH_KINDS,
  FORMULA_NAMES,
  FX_KINDS,
  IMPULSE_DIRECTIONS,
  OBSTACLE_DEFAULTS,
  OBSTACLE_KINDS,
  RECOLOR_MODES,
  SOUND_SCALES,
  SPAWN_AT,
  TEAM_MODES,
  TILE_LAYOUTS,
  TILE_PITCH,
  TILE_STYLES,
  TRIGGERS,
  VAR_OPS,
  VOICE_TRIGGERS,
  VOICES,
  WINNERS,
  WITH_RELATIONS,
  numberAt,
  obstacleCount,
  paramPathSteps,
  type ActionKind,
  type Blueprint,
  type BlueprintAction,
  type BlueprintArena,
  type BlueprintBody,
  type BlueprintFinish,
  type BlueprintFinishCondition,
  type BlueprintHud,
  type BlueprintLook,
  type BlueprintMeta,
  type BlueprintObstacle,
  type BlueprintParam,
  type BlueprintRule,
  type BlueprintSound,
  type BlueprintSpawner,
  type BlueprintTiles,
  type BlueprintVar,
  type Num,
  type Trigger,
} from "./schema";
import { BLUEPRINT_ID, hexColor, isRecord, own, plainText } from "./text";
import { FORMULA_FUNCTIONS_1, FORMULA_FUNCTIONS_2 } from "@/lib/simulation/bounceMath";

/* ------------------------------------------------------------------ the walker's state */

/** Most problems one read reports (a garbage spec could raise thousands). */
const MAX_ISSUES = 60;

interface Reader {
  strict: boolean;
  issues: string[];
  /** Body and variable ids, once read (references are checked against them). */
  bodies: string[];
  vars: string[];
  shape: Blueprint["arena"]["shape"];
  hasTiles: boolean;
  paletteSize: number;
}

function issue(rd: Reader, path: string, message: string) {
  if (rd.issues.length < MAX_ISSUES) rd.issues.push(`${path}: ${message}`);
  else if (rd.issues.length === MAX_ISSUES) rd.issues.push("…: more problems not listed");
}

const join = (path: string, key: string | number) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);
const list = (values: readonly (string | number)[]) => values.map((v) => (typeof v === "string" ? v : String(v))).join(", ");

/** Reports the fields of `record` the spec does not know. */
function unknownFields(rd: Reader, path: string, record: Record<string, unknown>, known: readonly string[]) {
  let n = 0;
  for (const key in record) {
    if (!Object.hasOwn(record, key) || known.includes(key)) continue;
    issue(rd, join(path, key), `unknown field (the fields here: ${known.join(", ")})`);
    if (++n >= 8) break;
  }
}

/** The object at `path`, or null (missing: silently, when optional). */
function readRecord(rd: Reader, path: string, value: unknown, required = false): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    if (required) issue(rd, path, "missing");
    return null;
  }
  if (!isRecord(value)) {
    issue(rd, path, `must be an object, got ${kindOf(value)}`);
    return null;
  }
  return value;
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "number") return Number.isFinite(value) ? `the number ${value}` : String(value);
  if (typeof value === "string") return value.length > 24 ? "a text" : `"${plainText(value, 24)}"`;
  return typeof value;
}

/* ------------------------------------------------------------------ scalars */

interface NumRule {
  def: number;
  /** Smallest allowed value (inclusive unless `above`). */
  min?: number;
  /** Strictly above `min`. */
  above?: boolean;
  /** Largest allowed (a design domain or a ceiling – never a physics scalar). */
  max?: number;
  int?: boolean;
  required?: boolean;
}

function describeRange(r: NumRule): string {
  const whole = r.int ? "a whole number" : "a number";
  if (r.min !== undefined && r.max !== undefined) return `${whole} from ${r.min} to ${r.max}`;
  if (r.min !== undefined) return r.above ? `${whole} above ${r.min}` : `${whole} from ${r.min} up`;
  return `${r.int ? "a whole" : "a finite"} number`;
}

/** A number in its domain; the default when missing or meaningless; snapped into a design domain (tolerant). */
function num(rd: Reader, path: string, value: unknown, r: NumRule): number {
  if (value === undefined || value === null) {
    if (r.required) issue(rd, path, `missing (${describeRange(r)})`);
    return r.def;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(rd, path, `must be ${describeRange(r)}, got ${kindOf(value)}`);
    return r.def;
  }
  let n = value;
  if (r.int && !Number.isInteger(n)) {
    issue(rd, path, `must be a whole number, got ${n}`);
    n = Math.round(n);
  }
  if (r.min !== undefined && (r.above ? n <= r.min : n < r.min)) {
    issue(rd, path, `must be ${describeRange(r)}, got ${n}`);
    n = r.above ? r.def : r.min;
  }
  if (r.max !== undefined && n > r.max) {
    issue(rd, path, `must be ${describeRange(r)}, got ${n}`);
    n = r.max;
  }
  return n === 0 ? 0 : n; // (−0 → 0: JSON writes them alike)
}

/** A number or a formula text (compiled over the spec's names); the constant's domain is checked as `num`'s. */
function numOrFormula(rd: Reader, path: string, value: unknown, r: NumRule): Num {
  if (typeof value === "string") {
    const text = value.trim();
    const compiled = compileBlueprintFormula(text, rd.vars);
    if (compiled.ok) return text;
    issue(rd, path, `formula: ${compiled.error} (the names: ${[...FORMULA_NAMES, ...rd.vars].join(", ")})`);
    return r.def;
  }
  return num(rd, path, value, r);
}

function oneOf<T extends string>(rd: Reader, path: string, value: unknown, values: readonly T[], def: T, required = false): T {
  if (value === undefined || value === null) {
    if (required) issue(rd, path, `missing (one of ${list(values)})`);
    return def;
  }
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
  issue(rd, path, `must be one of ${list(values)}, got ${kindOf(value)}`);
  return def;
}

function bool(rd: Reader, path: string, value: unknown, def: boolean): boolean {
  if (value === undefined || value === null) return def;
  if (typeof value === "boolean") return value;
  issue(rd, path, `must be true or false, got ${kindOf(value)}`);
  return def;
}

function text(rd: Reader, path: string, value: unknown, max: number, def: string, required = false): string {
  if (value === undefined || value === null) {
    if (required) issue(rd, path, `missing (a text of at most ${max} characters)`);
    return def;
  }
  if (typeof value !== "string") {
    issue(rd, path, `must be a text, got ${kindOf(value)}`);
    return def;
  }
  const clean = plainText(value, max);
  if (clean !== value) {
    if (Array.from(value).length > max) issue(rd, path, `must have at most ${max} characters, got ${Array.from(value).length}`);
    else issue(rd, path, "must be plain text on one line (no control characters, no < >, no doubled or edge spaces)");
  }
  if (required && clean === "") {
    issue(rd, path, "must not be empty");
    return def;
  }
  return clean;
}

function color(rd: Reader, path: string, value: unknown, def: string): string {
  if (value === undefined || value === null) return def;
  const c = hexColor(value);
  if (c === null) {
    issue(rd, path, `must be a colour like "#ff4d6d", got ${kindOf(value)}`);
    return def;
  }
  if (c !== value) issue(rd, path, `must be written "${c}"`);
  return c;
}

/** A list: at most `max` entries kept (tolerant: the first valid ones of the first entries); each read by `item` (null drops it). */
function readList<T>(rd: Reader, path: string, value: unknown, max: number, item: (raw: unknown, path: string) => T | null, min = 0): T[] {
  if (value === undefined || value === null) {
    if (min > 0) issue(rd, path, `missing (a list of ${min} to ${max})`);
    return [];
  }
  if (!Array.isArray(value)) {
    issue(rd, path, `must be a list, got ${kindOf(value)}`);
    return [];
  }
  if (value.length > max) issue(rd, path, `has ${value.length} entries (at most ${max})`);
  const out: T[] = [];
  const scan = Math.min(value.length, Math.max(max, L.scanEntries));
  for (let i = 0; i < scan && out.length < max; i++) {
    const v = item(value[i], join(path, i));
    if (v !== null) out.push(v);
  }
  if (out.length < min) issue(rd, path, `needs at least ${min} valid ${min === 1 ? "entry" : "entries"}`);
  return out;
}

/* ------------------------------------------------------------------ ids and references */

/** Names a variable id may not take: the formula names, the counts, the functions and constants. */
const RESERVED_VAR_IDS: ReadonlySet<string> = new Set<string>([...FORMULA_NAMES, ...COUNT_REFS, ...FORMULA_FUNCTIONS_1, ...FORMULA_FUNCTIONS_2, "clamp", "pi", "e"]);
/** Names a body id may not take: the `with` relations. */
const RESERVED_BODY_IDS: ReadonlySet<string> = new Set<string>(WITH_RELATIONS);

function newId(rd: Reader, path: string, value: unknown, taken: readonly string[], reserved: ReadonlySet<string>, fallback: string): string | null {
  if (typeof value !== "string" || !BLUEPRINT_ID.test(value)) {
    issue(rd, path, `must be an id: a lower-case letter, then up to ${L.idChars - 1} letters or digits, got ${kindOf(value)}`);
    return rd.strict ? null : uniqueId(fallback, taken);
  }
  if (reserved.has(value)) {
    issue(rd, path, `"${value}" is a reserved word (not: ${[...reserved].slice(0, 12).join(", ")}…)`);
    return rd.strict ? null : uniqueId(fallback, taken);
  }
  if (taken.includes(value)) {
    issue(rd, path, `"${value}" is used twice`);
    return null;
  }
  return value;
}

function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`;
}

/** A body id the spec has; tolerant: the first body. */
function bodyRef(rd: Reader, path: string, value: unknown, required = true): string | null {
  if (value === undefined || value === null) {
    if (!required) return null;
    issue(rd, path, `missing (a body id: ${list(rd.bodies)})`);
    return rd.bodies[0] ?? null;
  }
  if (typeof value === "string" && rd.bodies.includes(value)) return value;
  issue(rd, path, `unknown body ${kindOf(value)} (the bodies: ${list(rd.bodies)})`);
  return rd.bodies[0] ?? null;
}

/** A count (`what`): one of COUNT_REFS or a variable id. */
function countRef(rd: Reader, path: string, value: unknown, def: string): string {
  if (value === undefined || value === null) return def;
  if (typeof value === "string" && ((COUNT_REFS as readonly string[]).includes(value) || rd.vars.includes(value))) return value;
  issue(rd, path, `must be one of ${list([...COUNT_REFS, ...rd.vars])}, got ${kindOf(value)}`);
  return def;
}

/* ------------------------------------------------------------------ the sections */

function readMeta(rd: Reader, raw: unknown): BlueprintMeta & { newer: string[] } {
  const m = readRecord(rd, "meta", raw, true) ?? {};
  unknownFields(rd, "meta", m, ["name", "description", "family", "author", "needs"]);
  const name = text(rd, "meta.name", own(m, "name"), L.nameChars, "Untitled", true);
  const description = text(rd, "meta.description", own(m, "description"), L.descriptionChars, DEFAULTS.meta.description);
  const family = oneOf(rd, "meta.family", own(m, "family"), BLUEPRINT_FAMILIES, DEFAULTS.meta.family);
  const author = oneOf(rd, "meta.author", own(m, "author"), BLUEPRINT_AUTHORS, DEFAULTS.meta.author);
  const newer: string[] = [];
  const needs = readList(rd, "meta.needs", own(m, "needs"), 8, (v, p) => {
    if (typeof v !== "string") {
      issue(rd, p, `must be a feature id, got ${kindOf(v)}`);
      return null;
    }
    if (!BLUEPRINT_FEATURES.includes(v)) {
      newer.push(plainText(v, 40));
      issue(rd, p, `needs a newer version of JumpingBallsLive (it does not know the feature "${plainText(v, 40)}")`);
      return null;
    }
    return v;
  });
  return { name, description, family, author, needs, newer };
}

function readArena(rd: Reader, raw: unknown): BlueprintArena {
  const a = readRecord(rd, "arena", raw) ?? {};
  unknownFields(rd, "arena", a, ["shape", "size", "restitution", "gravity", "spinDegPerSec", "exits", "rings"]);
  const shape = oneOf(rd, "arena.shape", own(a, "shape"), ARENA_SHAPES, DEFAULTS.arena.shape);
  rd.shape = shape;
  const size = num(rd, "arena.size", own(a, "size"), { def: DEFAULTS.arena.size, min: L.minArenaSize, max: L.maxArenaSize });
  const restitution = num(rd, "arena.restitution", own(a, "restitution"), { def: DEFAULTS.arena.restitution, min: 0 });
  const g = readRecord(rd, "arena.gravity", own(a, "gravity")) ?? {};
  unknownFields(rd, "arena.gravity", g, ["x", "y"]);
  const gravity = { x: num(rd, "arena.gravity.x", own(g, "x"), { def: 0 }), y: num(rd, "arena.gravity.y", own(g, "y"), { def: 0 }) };
  const spinDegPerSec = num(rd, "arena.spinDegPerSec", own(a, "spinDegPerSec"), { def: DEFAULTS.arena.spinDegPerSec });
  let exits = readList(rd, "arena.exits", own(a, "exits"), L.exits, (v, p) => {
    const e = readRecord(rd, p, v, true);
    if (!e) return null;
    unknownFields(rd, p, e, ["atDeg", "widthDeg"]);
    return { atDeg: num(rd, join(p, "atDeg"), own(e, "atDeg"), { def: 0, required: true }), widthDeg: num(rd, join(p, "widthDeg"), own(e, "widthDeg"), { def: 30, min: 1, max: 180, required: true }) };
  });
  if (exits.length && shape !== "circle") {
    issue(rd, "arena.exits", `exits need a circle arena (a ${shape} arena has ${shape === "rings" ? "the rings' gaps" : "closed walls"})`);
    exits = [];
  }
  let rings: BlueprintArena["rings"] = null;
  const rr = own(a, "rings");
  if (shape === "rings" || (rr !== undefined && rr !== null)) {
    const r = readRecord(rd, "arena.rings", rr) ?? {};
    unknownFields(rd, "arena.rings", r, ["count", "gapDeg", "spinDegPerSec", "alternate", "breakOnPass", "inner"]);
    const D = DEFAULTS.rings;
    rings = {
      count: num(rd, "arena.rings.count", own(r, "count"), { def: D.count, min: 1, max: L.rings, int: true }),
      gapDeg: num(rd, "arena.rings.gapDeg", own(r, "gapDeg"), { def: D.gapDeg, min: 5, max: 180 }),
      spinDegPerSec: num(rd, "arena.rings.spinDegPerSec", own(r, "spinDegPerSec"), { def: D.spinDegPerSec }),
      alternate: bool(rd, "arena.rings.alternate", own(r, "alternate"), D.alternate),
      breakOnPass: bool(rd, "arena.rings.breakOnPass", own(r, "breakOnPass"), D.breakOnPass),
      inner: num(rd, "arena.rings.inner", own(r, "inner"), { def: D.inner, min: 0.1, max: 0.9 }),
    };
    if (shape !== "rings") {
      issue(rd, "arena.rings", 'rings need arena.shape "rings"');
      rings = null;
    }
  }
  return { shape, size, restitution, gravity, spinDegPerSec, exits, rings };
}

function readBodies(rd: Reader, raw: unknown): BlueprintBody[] {
  const bodies = readList(
    rd,
    "bodies",
    raw,
    L.bodies,
    (v, p) => {
      const b = readRecord(rd, p, v, true);
      if (!b) return null;
      unknownFields(rd, p, b, ["id", "radius", "color", "gravityScale", "hp", "tier", "team", "collide"]);
      const id = newId(rd, join(p, "id"), own(b, "id"), rd.bodies, RESERVED_BODY_IDS, `ball${rd.bodies.length + 1}`);
      if (id === null) return null;
      rd.bodies.push(id);
      const D = DEFAULTS.body;
      return {
        id,
        radius: num(rd, join(p, "radius"), own(b, "radius"), { def: D.radius, min: 0, above: true }),
        color: num(rd, join(p, "color"), own(b, "color"), { def: D.color, min: 0, max: L.palette - 1, int: true }),
        gravityScale: num(rd, join(p, "gravityScale"), own(b, "gravityScale"), { def: D.gravityScale }),
        hp: num(rd, join(p, "hp"), own(b, "hp"), { def: D.hp, min: 0, int: true }),
        tier: num(rd, join(p, "tier"), own(b, "tier"), { def: D.tier, min: 1, max: L.maxTier, int: true }),
        team: num(rd, join(p, "team"), own(b, "team"), { def: D.team, min: 0, max: L.teams - 1, int: true }),
        collide: oneOf(rd, join(p, "collide"), own(b, "collide"), BODY_COLLIDE, D.collide),
      };
    },
    1,
  );
  if (!bodies.length) {
    rd.bodies.push("ball");
    bodies.push({ id: "ball", ...DEFAULTS.body });
  }
  return bodies;
}

function readTiles(rd: Reader, raw: unknown): BlueprintTiles | null {
  const t = readRecord(rd, "tiles", raw);
  if (!t) return null;
  unknownFields(rd, "tiles", t, ["layout", "rows", "cols", "hp", "hpStep", "pierce", "style", "pitchBy", "area", "inner", "outer"]);
  const D = DEFAULTS.tiles;
  let rows = num(rd, "tiles.rows", own(t, "rows"), { def: D.rows, min: 1, max: L.tileRows, int: true });
  const cols = num(rd, "tiles.cols", own(t, "cols"), { def: D.cols, min: 1, max: L.tileCols, int: true });
  if (rows * cols > L.tiles) {
    issue(rd, "tiles", `${rows} rows × ${cols} columns are ${rows * cols} tiles (at most ${L.tiles})`);
    rows = Math.max(1, Math.floor(L.tiles / cols));
  }
  const ar = readRecord(rd, "tiles.area", own(t, "area")) ?? {};
  unknownFields(rd, "tiles.area", ar, ["x", "y", "w", "h"]);
  const area = {
    x: num(rd, "tiles.area.x", own(ar, "x"), { def: D.area.x, min: -1, max: 1 }),
    y: num(rd, "tiles.area.y", own(ar, "y"), { def: D.area.y, min: -1, max: 1 }),
    w: num(rd, "tiles.area.w", own(ar, "w"), { def: D.area.w, min: 0, above: true, max: 2 }),
    h: num(rd, "tiles.area.h", own(ar, "h"), { def: D.area.h, min: 0, above: true, max: 2 }),
  };
  let inner = num(rd, "tiles.inner", own(t, "inner"), { def: D.inner, min: 0.05, max: 1 });
  let outer = num(rd, "tiles.outer", own(t, "outer"), { def: D.outer, min: 0.05, max: 1 });
  if (outer <= inner) {
    issue(rd, "tiles.outer", `must be above tiles.inner (${inner})`);
    inner = D.inner;
    outer = D.outer;
  }
  rd.hasTiles = true;
  return {
    layout: oneOf(rd, "tiles.layout", own(t, "layout"), TILE_LAYOUTS, D.layout),
    rows,
    cols,
    hp: num(rd, "tiles.hp", own(t, "hp"), { def: D.hp, min: 1, int: true }),
    hpStep: num(rd, "tiles.hpStep", own(t, "hpStep"), { def: D.hpStep, min: 0, int: true }),
    pierce: bool(rd, "tiles.pierce", own(t, "pierce"), D.pierce),
    style: oneOf(rd, "tiles.style", own(t, "style"), TILE_STYLES, D.style),
    pitchBy: oneOf(rd, "tiles.pitchBy", own(t, "pitchBy"), TILE_PITCH, D.pitchBy),
    area,
    inner,
    outer,
  };
}

/** One obstacle pattern's fields: their rules (positions and lengths in arena units). */
const OBSTACLE_FIELDS: Readonly<Record<string, NumRule>> = {
  x: { def: 0, min: -1, max: 1 },
  y: { def: 0, min: -1, max: 1 },
  r: { def: 0.04, min: 0, above: true, max: 1 },
  kick: { def: 150 },
  w: { def: 1.2, min: 0, above: true, max: 2 },
  h: { def: 0.8, min: 0, above: true, max: 2 },
  rows: { def: 4, min: 1, int: true, max: 48 },
  cols: { def: 5, min: 1, int: true, max: 48 },
  radius: { def: 0.5, min: 0, above: true, max: 1 },
  count: { def: 8, min: 1, int: true, max: 48 },
  len: { def: 0.4, min: 0, above: true, max: 2 },
  angleDeg: { def: 0 },
  thick: { def: 0.03, min: 0, above: true, max: 0.5 },
  spinDegPerSec: { def: 90 },
};

function readObstacles(rd: Reader, raw: unknown): BlueprintObstacle[] {
  let total = 0;
  return readList(rd, "obstacles", raw, L.obstaclePatterns, (v, p) => {
    const o = readRecord(rd, p, v, true);
    if (!o) return null;
    const kind = oneOf(rd, join(p, "kind"), own(o, "kind"), OBSTACLE_KINDS, "peg", true);
    if (rd.strict && !(OBSTACLE_KINDS as readonly string[]).includes(own(o, "kind") as string)) return null;
    const defaults = OBSTACLE_DEFAULTS[kind] as Record<string, unknown>;
    const fields = Object.keys(defaults);
    unknownFields(rd, p, o, ["kind", ...fields]);
    const out: Record<string, unknown> = { kind };
    for (const f of fields) {
      const def = defaults[f];
      out[f] = typeof def === "boolean" ? bool(rd, join(p, f), own(o, f), def) : num(rd, join(p, f), own(o, f), { ...OBSTACLE_FIELDS[f], def: def as number });
    }
    const obstacle = out as unknown as BlueprintObstacle;
    const n = obstacleCount(obstacle);
    if (total + n > L.obstacles) {
      issue(rd, p, `expands to ${n} obstacles, ${total + n} in all (at most ${L.obstacles})`);
      return null;
    }
    total += n;
    return obstacle;
  });
}

function readVars(rd: Reader, raw: unknown): BlueprintVar[] {
  return readList(rd, "vars", raw, L.vars, (v, p) => {
    const r = readRecord(rd, p, v, true);
    if (!r) return null;
    unknownFields(rd, p, r, ["id", "start"]);
    const id = newId(rd, join(p, "id"), own(r, "id"), rd.vars, RESERVED_VAR_IDS, `v${rd.vars.length + 1}`);
    if (id === null) return null;
    rd.vars.push(id);
    return { id, start: num(rd, join(p, "start"), own(r, "start"), { def: 0 }) };
  });
}

function readSpawners(rd: Reader, raw: unknown): BlueprintSpawner[] {
  const D = DEFAULTS.spawner;
  const spawners = readList(
    rd,
    "spawners",
    raw,
    L.spawners,
    (v, p) => {
      const s = readRecord(rd, p, v, true);
      if (!s) return null;
      unknownFields(rd, p, s, ["body", "at", "count", "speed", "dir", "startSec", "everySec", "onBeat", "maxTotal"]);
      const body = bodyRef(rd, join(p, "body"), own(s, "body"));
      if (body === null) return null;
      return {
        body,
        at: oneOf(rd, join(p, "at"), own(s, "at"), SPAWN_AT, D.at),
        count: numOrFormula(rd, join(p, "count"), own(s, "count"), { def: D.count, min: 1, max: L.perSpawn, int: true }),
        speed: numOrFormula(rd, join(p, "speed"), own(s, "speed"), { def: D.speed }),
        dir: oneOf(rd, join(p, "dir"), own(s, "dir"), DIRECTIONS, D.dir),
        startSec: num(rd, join(p, "startSec"), own(s, "startSec"), { def: D.startSec, min: 0 }),
        everySec: num(rd, join(p, "everySec"), own(s, "everySec"), { def: D.everySec, min: 0 }),
        onBeat: bool(rd, join(p, "onBeat"), own(s, "onBeat"), D.onBeat),
        maxTotal: num(rd, join(p, "maxTotal"), own(s, "maxTotal"), { def: D.maxTotal, min: 1, max: L.balls, int: true }),
      };
    },
    1,
  );
  if (!spawners.length) spawners.push({ body: rd.bodies[0], at: D.at, count: D.count, speed: D.speed, dir: D.dir, startSec: D.startSec, everySec: D.everySec, onBeat: D.onBeat, maxTotal: D.maxTotal });
  return spawners;
}

/** The fields each action takes (`act` aside). */
const ACTION_FIELDS: { readonly [K in ActionKind]: readonly string[] } = Object.fromEntries(ACTIONS.map((a) => [a, Object.keys(ACTION_DEFAULTS[a])])) as { [K in ActionKind]: string[] };

function readTarget<T extends string>(rd: Reader, path: string, value: unknown, values: readonly T[], def: T, when: Trigger): T {
  const t = oneOf(rd, path, value, values, def);
  if (t === "other" && when !== "ballHit") {
    issue(rd, path, `"other" needs a ballHit rule (this rule's trigger is ${when})`);
    return def;
  }
  if (t === "tile" && when !== "tileHit") {
    issue(rd, path, `"tile" needs a tileHit rule (this rule's trigger is ${when})`);
    return "self" as T;
  }
  return t;
}

function readAction(rd: Reader, path: string, raw: unknown, when: Trigger): BlueprintAction | null {
  const a = readRecord(rd, path, raw, true);
  if (!a) return null;
  const actRaw = own(a, "act");
  if (typeof actRaw !== "string" || !(ACTIONS as readonly string[]).includes(actRaw)) {
    issue(rd, join(path, "act"), `must be one of ${list(ACTIONS)}, got ${kindOf(actRaw)}`);
    return null;
  }
  const act = actRaw as ActionKind;
  unknownFields(rd, path, a, ["act", ...ACTION_FIELDS[act]]);
  const f = (k: string) => own(a, k);
  const p = (k: string) => join(path, k);
  const target = () => readTarget(rd, p("target"), f("target"), ACTION_TARGETS, "self", when);
  switch (act) {
    case "spawn": {
      const D = ACTION_DEFAULTS.spawn;
      const body = bodyRef(rd, p("body"), f("body"));
      if (body === null) return null;
      let at = oneOf(rd, p("at"), f("at"), ACTION_AT, D.at);
      if (at === "tile" && when !== "tileHit" && when !== "tileBroken") {
        issue(rd, p("at"), `"tile" needs a tileHit or tileBroken rule (this rule's trigger is ${when})`);
        at = "self";
      }
      return {
        act,
        body,
        count: numOrFormula(rd, p("count"), f("count"), { def: 1, min: 0, max: L.perSpawn, int: true }),
        at,
        speed: numOrFormula(rd, p("speed"), f("speed"), { def: 250 }),
        dir: oneOf(rd, p("dir"), f("dir"), DIRECTIONS, D.dir),
      };
    }
    case "split":
      return { act, target: target(), into: numOrFormula(rd, p("into"), f("into"), { def: 2, min: 2, max: L.perSpawn, int: true }), scale: num(rd, p("scale"), f("scale"), { def: 1, min: 0, above: true }) };
    case "merge":
      if (when !== "ballHit") {
        issue(rd, path, `merge needs a ballHit rule (this rule's trigger is ${when})`);
        return null;
      }
      return { act, scale: num(rd, p("scale"), f("scale"), { def: 0, min: 0 }) };
    case "remove":
      return { act, target: target() };
    case "grow":
      return { act, target: target(), by: numOrFormula(rd, p("by"), f("by"), { def: 2 }) };
    case "speed":
      return { act, target: target(), scale: numOrFormula(rd, p("scale"), f("scale"), { def: 1.1 }) };
    case "recolor": {
      const c = f("color");
      let color: number | (typeof RECOLOR_MODES)[number] = "next";
      if (typeof c === "number") color = num(rd, p("color"), c, { def: 0, min: 0, max: L.palette - 1, int: true });
      else color = oneOf(rd, p("color"), c, RECOLOR_MODES, "next");
      return { act, target: target(), color };
    }
    case "tier":
      return { act, target: target(), by: numOrFormula(rd, p("by"), f("by"), { def: 1, int: true }) };
    case "team": {
      const t = f("to");
      let to: number | (typeof TEAM_MODES)[number] = "next";
      if (typeof t === "number") to = num(rd, p("to"), t, { def: 0, min: 0, max: L.teams - 1, int: true });
      else to = oneOf(rd, p("to"), t, TEAM_MODES, "next");
      if (to === "other" && when !== "ballHit") {
        issue(rd, p("to"), `"other" needs a ballHit rule (this rule's trigger is ${when})`);
        to = "next";
      }
      return { act, target: target(), to };
    }
    case "damage":
      return { act, target: readTarget(rd, p("target"), f("target"), DAMAGE_TARGETS, when === "tileHit" ? "tile" : "self", when), amount: numOrFormula(rd, p("amount"), f("amount"), { def: 1 }) };
    case "var": {
      const id = f("id");
      if (typeof id !== "string" || !rd.vars.includes(id)) {
        issue(rd, p("id"), `unknown variable ${kindOf(id)} (the variables: ${rd.vars.length ? list(rd.vars) : "none – declare them in vars"})`);
        return null;
      }
      return { act, id, op: oneOf(rd, p("op"), f("op"), VAR_OPS, "add"), value: numOrFormula(rd, p("value"), f("value"), { def: 1 }) };
    }
    case "impulse":
      return { act, target: target(), dir: oneOf(rd, p("dir"), f("dir"), IMPULSE_DIRECTIONS, "out"), amount: numOrFormula(rd, p("amount"), f("amount"), { def: 200 }) };
    case "fx":
      return { act, kind: oneOf(rd, p("kind"), f("kind"), FX_KINDS, "burst") };
    case "sound":
      return { act, voice: oneOf(rd, p("voice"), f("voice"), VOICES, "hit"), pitch: num(rd, p("pitch"), f("pitch"), { def: 0, int: true, min: -24, max: 24 }) };
  }
}

function readRules(rd: Reader, raw: unknown): BlueprintRule[] {
  const D = DEFAULTS.rule;
  return readList(rd, "rules", raw, L.rules, (v, p) => {
    const r = readRecord(rd, p, v, true);
    if (!r) return null;
    unknownFields(rd, p, r, ["when", "of", "with", "sec", "what", "atLeast", "atMost", "every", "chance", "cooldownSec", "maxFires", "do"]);
    const whenRaw = own(r, "when");
    if (typeof whenRaw !== "string" || !(TRIGGERS as readonly string[]).includes(whenRaw)) {
      issue(rd, join(p, "when"), `must be one of ${list(TRIGGERS)}, got ${kindOf(whenRaw)}`);
      return null;
    }
    const when = whenRaw as Trigger;
    const notHere = (field: string, value: unknown, def: unknown, needs: string) => {
      if (value !== undefined && value !== null && value !== def) issue(rd, join(p, field), `only a ${needs} rule takes ${field}`);
    };
    const ofRaw = own(r, "of");
    let of: string | null = null;
    if (ofRaw !== undefined && ofRaw !== null) {
      if (typeof ofRaw === "string" && rd.bodies.includes(ofRaw)) of = ofRaw;
      else issue(rd, join(p, "of"), `unknown body ${kindOf(ofRaw)} (the bodies: ${list(rd.bodies)}; leave it out for any ball)`);
    }
    let withRel: string = D.with;
    if (when === "ballHit") {
      const w = own(r, "with");
      if (w !== undefined && w !== null) {
        if (typeof w === "string" && ((WITH_RELATIONS as readonly string[]).includes(w) || rd.bodies.includes(w))) withRel = w;
        else issue(rd, join(p, "with"), `must be a body id (${list(rd.bodies)}) or one of ${list(WITH_RELATIONS)}, got ${kindOf(w)}`);
      }
    } else notHere("with", own(r, "with"), D.with, "ballHit");
    const sec = when === "timer" ? num(rd, join(p, "sec"), own(r, "sec"), { def: D.sec, min: 0, above: true }) : (notHere("sec", own(r, "sec"), D.sec, "timer"), D.sec);
    let what: string = D.what;
    let atLeast: number | null = null;
    let atMost: number | null = null;
    if (when === "countReached") {
      what = countRef(rd, join(p, "what"), own(r, "what"), D.what);
      atLeast = own(r, "atLeast") === undefined || own(r, "atLeast") === null ? null : num(rd, join(p, "atLeast"), own(r, "atLeast"), { def: 1 });
      atMost = own(r, "atMost") === undefined || own(r, "atMost") === null ? null : num(rd, join(p, "atMost"), own(r, "atMost"), { def: 0 });
      if (atLeast === null && atMost === null) {
        issue(rd, p, "a countReached rule needs atLeast or atMost");
        atLeast = 1;
      }
    } else {
      notHere("what", own(r, "what"), D.what, "countReached");
      notHere("atLeast", own(r, "atLeast"), null, "countReached");
      notHere("atMost", own(r, "atMost"), null, "countReached");
    }
    const actions = readList(rd, join(p, "do"), own(r, "do"), L.actionsPerRule, (a, ap) => readAction(rd, ap, a, when), 1);
    if (!actions.length) return null;
    return {
      when,
      of,
      with: withRel,
      sec,
      what,
      atLeast,
      atMost,
      every: num(rd, join(p, "every"), own(r, "every"), { def: D.every, min: 1, int: true }),
      chance: num(rd, join(p, "chance"), own(r, "chance"), { def: D.chance, min: 0, max: 1 }),
      cooldownSec: num(rd, join(p, "cooldownSec"), own(r, "cooldownSec"), { def: D.cooldownSec, min: 0 }),
      maxFires: num(rd, join(p, "maxFires"), own(r, "maxFires"), { def: D.maxFires, min: 0, int: true }),
      do: actions,
    };
  });
}

function readFinish(rd: Reader, raw: unknown): BlueprintFinish {
  const f = readRecord(rd, "finish", raw, true) ?? {};
  unknownFields(rd, "finish", f, ["any", "timeoutSec", "winner", "timeoutSay"]);
  const any = readList(rd, "finish.any", own(f, "any"), L.finishConditions, (v, p): BlueprintFinishCondition | null => {
    const c = readRecord(rd, p, v, true);
    if (!c) return null;
    unknownFields(rd, p, c, ["when", "of", "what", "atLeast", "atMost", "say"]);
    const whenRaw = own(c, "when");
    if (typeof whenRaw !== "string" || !(FINISH_KINDS as readonly string[]).includes(whenRaw)) {
      issue(rd, join(p, "when"), `must be one of ${list(FINISH_KINDS)}, got ${kindOf(whenRaw)}`);
      return null;
    }
    const when = whenRaw as BlueprintFinishCondition["when"];
    const say = text(rd, join(p, "say"), own(c, "say"), L.sayChars, "");
    const ofRaw = own(c, "of");
    let of: string | null = null;
    if (ofRaw !== undefined && ofRaw !== null) {
      if (when !== "escaped" && when !== "count") issue(rd, join(p, "of"), "only an escaped or count finish takes of");
      else if (typeof ofRaw === "string" && rd.bodies.includes(ofRaw)) of = ofRaw;
      else issue(rd, join(p, "of"), `unknown body ${kindOf(ofRaw)} (the bodies: ${list(rd.bodies)}; leave it out for any ball)`);
    }
    const opt = (k: "atLeast" | "atMost", r: NumRule) => (own(c, k) === undefined || own(c, k) === null ? null : num(rd, join(p, k), own(c, k), r));
    const base = { when, of, what: "balls", atLeast: null as number | null, atMost: null as number | null, say };
    switch (when) {
      case "escaped":
        return { ...base, atLeast: opt("atLeast", { def: 1, min: 1, int: true }) ?? 1 };
      case "tilesCleared":
        if (!rd.hasTiles) {
          issue(rd, join(p, "when"), "tilesCleared needs a tiles block");
          return null;
        }
        return base;
      case "ringsCleared":
        if (rd.shape !== "rings") {
          issue(rd, join(p, "when"), 'ringsCleared needs arena.shape "rings"');
          return null;
        }
        return base;
      case "count": {
        const what = countRef(rd, join(p, "what"), own(c, "what"), "balls");
        const atLeast = opt("atLeast", { def: 1 });
        const atMost = opt("atMost", { def: 0 });
        if (atLeast === null && atMost === null) {
          issue(rd, p, "a count finish needs atLeast or atMost");
          return { ...base, what, atLeast: 1 };
        }
        return { ...base, what, atLeast, atMost };
      }
      case "tier":
        return { ...base, atLeast: opt("atLeast", { def: 2, min: 1, max: L.maxTier, int: true, required: true }) ?? (issue(rd, join(p, "atLeast"), "missing (the tier to reach)"), 2) };
      case "teamsLeft":
        return { ...base, atMost: opt("atMost", { def: 1, min: 0, max: L.teams - 1, int: true }) ?? 1 };
    }
  });
  return {
    any,
    timeoutSec: num(rd, "finish.timeoutSec", own(f, "timeoutSec"), { def: DEFAULTS.finish.timeoutSec, min: L.minTimeoutSec, max: L.maxTimeoutSec, required: true }),
    winner: oneOf(rd, "finish.winner", own(f, "winner"), WINNERS, DEFAULTS.finish.winner),
    timeoutSay: text(rd, "finish.timeoutSay", own(f, "timeoutSay"), L.sayChars, DEFAULTS.finish.timeoutSay),
  };
}

function readHud(rd: Reader, raw: unknown): BlueprintHud[] {
  return readList(rd, "hud", raw, L.hud, (v, p) => {
    const h = readRecord(rd, p, v, true);
    if (!h) return null;
    unknownFields(rd, p, h, ["show", "label"]);
    const s = own(h, "show");
    if (typeof s !== "string" || !((COUNT_REFS as readonly string[]).includes(s) || rd.vars.includes(s))) {
      issue(rd, join(p, "show"), `must be one of ${list([...COUNT_REFS, ...rd.vars])}, got ${kindOf(s)}`);
      return null;
    }
    return { show: s, label: text(rd, join(p, "label"), own(h, "label"), L.labelChars, "") };
  });
}

function readLook(rd: Reader, raw: unknown): BlueprintLook {
  const l = readRecord(rd, "look", raw) ?? {};
  unknownFields(rd, "look", l, ["palette", "background", "trail", "rim", "teamNames"]);
  let palette = readList(rd, "look.palette", own(l, "palette"), L.palette, (v, p) => {
    const c = hexColor(v);
    if (c === null) {
      issue(rd, p, `must be a colour like "#ff4d6d", got ${kindOf(v)}`);
      return null;
    }
    if (c !== v) issue(rd, p, `must be written "${c}"`);
    return c;
  });
  if (!palette.length) palette = [...DEFAULT_PALETTE];
  rd.paletteSize = palette.length;
  const teamNames = own(l, "teamNames") === undefined ? [...DEFAULT_TEAM_NAMES] : readList(rd, "look.teamNames", own(l, "teamNames"), L.teams, (v, p) => text(rd, p, v, L.labelChars, "Team") || null);
  return {
    palette,
    background: color(rd, "look.background", own(l, "background"), DEFAULTS.look.background),
    trail: bool(rd, "look.trail", own(l, "trail"), DEFAULTS.look.trail),
    rim: num(rd, "look.rim", own(l, "rim"), { def: DEFAULTS.look.rim, min: 0, max: palette.length - 1, int: true }),
    teamNames,
  };
}

function readSound(rd: Reader, raw: unknown): BlueprintSound {
  const s = readRecord(rd, "sound", raw) ?? {};
  unknownFields(rd, "sound", s, ["scale", "root", "bpm", "voices"]);
  const vr = readRecord(rd, "sound.voices", own(s, "voices")) ?? {};
  unknownFields(rd, "sound.voices", vr, VOICE_TRIGGERS);
  const voices = { ...DEFAULT_VOICES };
  for (const k of VOICE_TRIGGERS) voices[k] = oneOf(rd, join("sound.voices", k), own(vr, k), [...VOICES, "none"] as const, DEFAULT_VOICES[k]);
  return {
    scale: oneOf(rd, "sound.scale", own(s, "scale"), SOUND_SCALES, DEFAULTS.sound.scale),
    root: num(rd, "sound.root", own(s, "root"), { def: DEFAULTS.sound.root, min: 0, max: 11, int: true }),
    bpm: num(rd, "sound.bpm", own(s, "bpm"), { def: DEFAULTS.sound.bpm, min: 0, above: true }),
    voices,
  };
}

/**
 * The sliders a spec offers: each names a number of the resolved spec (`at`), read after every other section so the path
 * is checked against what the spec really holds; a path that reaches no number is refused (tolerant: the slider is dropped).
 */
function readParams(rd: Reader, raw: unknown, bp: Omit<Blueprint, "params">): BlueprintParam[] {
  const ids: string[] = [];
  const paths: string[] = [];
  return readList(rd, "params", raw, L.params, (v, p) => {
    const r = readRecord(rd, p, v, true);
    if (!r) return null;
    unknownFields(rd, p, r, ["id", "label", "at", "min", "max", "step"]);
    const id = newId(rd, join(p, "id"), own(r, "id"), ids, new Set<string>(), `p${ids.length + 1}`);
    if (id === null) return null;
    const at = own(r, "at");
    if (typeof at !== "string" || paramPathSteps(at) === null) {
      issue(rd, join(p, "at"), `must be the path of a number of the spec, such as "tiles.rows" or "spawners[0].count", got ${kindOf(at)}`);
      return null;
    }
    if (numberAt(bp, at) === undefined) {
      issue(rd, join(p, "at"), `"${at}" names no number of this spec (a field it has, holding a number – not a formula)`);
      return null;
    }
    if (paths.includes(at)) {
      issue(rd, join(p, "at"), `"${at}" has a slider already`);
      return null;
    }
    let min = num(rd, join(p, "min"), own(r, "min"), { def: 0, required: true });
    let max = num(rd, join(p, "max"), own(r, "max"), { def: 1, required: true });
    if (!(max > min)) {
      issue(rd, join(p, "max"), `must be above min (${min}), got ${max}`);
      if (rd.strict) return null;
      [min, max] = max < min ? [max, min] : [min, min + 1];
    }
    const step = num(rd, join(p, "step"), own(r, "step"), { def: 1, min: 0, above: true });
    ids.push(id);
    paths.push(at);
    return { id, label: text(rd, join(p, "label"), own(r, "label"), L.labelChars, id) || id, at, min, max, step };
  });
}

/** Palette indexes past the palette (a body's colour, a recolor): reported, and folded onto it. */
function checkPaletteRefs(rd: Reader, bp: Blueprint) {
  const n = bp.look.palette.length;
  bp.bodies.forEach((b, i) => {
    if (b.color >= n) {
      issue(rd, `bodies[${i}].color`, `palette index ${b.color} past the palette's ${n} colours`);
      b.color = b.color % n;
    }
  });
  bp.rules.forEach((r, i) =>
    r.do.forEach((a, j) => {
      if (a.act === "recolor" && typeof a.color === "number" && a.color >= n) {
        issue(rd, `rules[${i}].do[${j}].color`, `palette index ${a.color} past the palette's ${n} colours`);
        a.color = a.color % n;
      }
    }),
  );
}

/* ------------------------------------------------------------------ the walk */

const TOP_FIELDS = ["v", "meta", "arena", "bodies", "tiles", "obstacles", "vars", "spawners", "rules", "finish", "hud", "look", "sound", "params"] as const;

function walk(raw: unknown, strict: boolean): { blueprint: Blueprint; issues: string[]; newer: string[] } {
  const rd: Reader = { strict, issues: [], bodies: [], vars: [], shape: "circle", hasTiles: false, paletteSize: DEFAULT_PALETTE.length };
  const root = isRecord(raw) ? raw : (issue(rd, "$", `a Blueprint is a JSON object, got ${kindOf(raw)}`), {});
  unknownFields(rd, "$", root, TOP_FIELDS);
  const v = own(root, "v");
  if (v !== 1) issue(rd, "v", v === undefined ? "missing (1)" : typeof v === "number" && v > 1 ? `version ${v} needs a newer version of JumpingBallsLive` : `must be 1, got ${kindOf(v)}`);
  const meta = readMeta(rd, own(root, "meta"));
  const arena = readArena(rd, own(root, "arena"));
  const bodies = readBodies(rd, own(root, "bodies"));
  const vars = readVars(rd, own(root, "vars"));
  const tiles = readTiles(rd, own(root, "tiles"));
  const obstacles = readObstacles(rd, own(root, "obstacles"));
  const spawners = readSpawners(rd, own(root, "spawners"));
  const rules = readRules(rd, own(root, "rules"));
  const finish = readFinish(rd, own(root, "finish"));
  const hud = readHud(rd, own(root, "hud"));
  const look = readLook(rd, own(root, "look"));
  const sound = readSound(rd, own(root, "sound"));
  const { newer, ...metaOut } = meta;
  const blueprint: Blueprint = { v: 1, meta: metaOut, arena, bodies, tiles, obstacles, vars, spawners, rules, finish, hud, look, sound, params: [] };
  checkPaletteRefs(rd, blueprint);
  blueprint.params = readParams(rd, own(root, "params"), blueprint);
  return { blueprint, issues: rd.issues, newer };
}

/** Shrinks a spec whose canonical JSON is past the byte ceiling: the description, then rules, obstacles, HUD and spawners from the end. */
function fitBytes(bp: Blueprint, notes: string[]): Blueprint {
  let bytes = blueprintBytes(bp);
  if (bytes <= L.specBytes) return bp;
  notes.push(`$: the spec is ${bytes} bytes of JSON (at most ${L.specBytes}): trimmed from the end`);
  const steps: (() => boolean)[] = [
    () => (bp.meta.description ? ((bp.meta.description = ""), true) : false),
    () => (bp.params.length ? (bp.params.pop(), true) : false),
    () => (bp.rules.length ? (bp.rules.pop(), true) : false),
    () => (bp.obstacles.length ? (bp.obstacles.pop(), true) : false),
    () => (bp.hud.length ? (bp.hud.pop(), true) : false),
    () => (bp.spawners.length > 1 ? (bp.spawners.pop(), true) : false),
  ];
  for (const step of steps) {
    while (bytes > L.specBytes && step()) bytes = blueprintBytes(bp);
    if (bytes <= L.specBytes) return bp;
  }
  // (what is left – a few bodies and one spawner of formulas – is far under the ceiling; this is the last resort)
  return walk(DEFAULT_SPEC, false).blueprint;
}

/** The smallest valid spec: one ball in a circle, ending after a minute. */
const DEFAULT_SPEC = { v: 1, meta: { name: "Untitled" }, bodies: [{ id: "ball" }], spawners: [{ body: "ball" }], finish: { timeoutSec: DEFAULTS.finish.timeoutSec } };

/* ------------------------------------------------------------------ the API */

/**
 * Every problem of a spec as `path: sentence` (empty: valid). Strict: an unknown field, a value past its domain, a dangling
 * reference, a formula that does not compile, text that is not plain, a spec past the byte ceiling – each is an error.
 */
export function validateBlueprint(raw: unknown): string[] {
  try {
    const { blueprint, issues } = walk(raw, true);
    if (!issues.length) {
      const bytes = blueprintBytes(blueprint);
      if (bytes > L.specBytes) issues.push(`$: the spec is ${bytes} bytes of JSON (at most ${L.specBytes})`);
    }
    return issues;
  } catch (e) {
    return [`$: unreadable (${e instanceof Error ? e.message : String(e)})`];
  }
}

export interface SanitizeResult {
  /** The resolved spec: every field present, always valid. */
  blueprint: Blueprint;
  /** What was changed or dropped, as `path: sentence`. */
  notes: string[];
  /** Features the spec needs that this version does not know (a newer version wrote it): play it only after saying so. */
  newer: string[];
}

/** The valid spec closest to `raw`, never throwing (see the file's header). */
export function sanitizeBlueprint(raw: unknown): SanitizeResult {
  try {
    const { blueprint, issues, newer } = walk(raw, false);
    const notes = [...issues];
    return { blueprint: fitBytes(blueprint, notes), notes, newer };
  } catch (e) {
    return { blueprint: walk(DEFAULT_SPEC, false).blueprint, notes: [`$: unreadable, replaced by an empty spec (${e instanceof Error ? e.message : String(e)})`], newer: [] };
  }
}
