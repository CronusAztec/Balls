/**
 * --- custom-content --- Fighters the player makes with the Windows app's AI. The model only ever describes a fighter in the
 * plain terms below (`CustomFighterSpec`: a name, a role, two colours, one weapon kind with a few optional numbers, one or
 * two ability primitives with a few optional numbers); everything the engine runs is built here, from the same data rows
 * the built-in 147 fighters are (fightLeagueRoster.ts), and clamped to the limits those rows follow – stats inside their
 * role's template, a weapon's numbers within a band around its kind's defaults, an ability's numbers within each
 * primitive's bounds (`PRIMITIVE_PARAMS`, inside `FL_PRIMITIVE_LIMITS`) and a charge time of its class. So a wild answer
 * from a small model is a slightly different fighter, never a broken or unbeatable one, and no code is generated or run:
 * a fighter is data.
 *
 * Custom fighters live in the Wildcard division under ids that start with `my-`, are kept on the player's device (the app's
 * data folder) and join the roster at start-up through `setCustomFighters` (fightLeagueRoster.ts).
 */

import {
  FL_ABILITY_PRIMITIVES,
  FL_BY_ID,
  FL_CHARGE_RANGE,
  FL_LOOK_CRESTS,
  FL_LOOK_PATTERNS,
  FL_ROLES,
  FL_SHAPES,
  FL_SUMMON_SHAPES,
  FL_WEAPON_DEFAULTS,
  FL_WEAPON_KINDS,
  FL_WEAPON_LOOKS,
  abilityClass,
  flLimitViolations,
  type FlAbility,
  type FlEffect,
  type FlFighterRow,
  type FlLook,
  type FlPrimitive,
  type FlRole,
  type FlShape,
  type FlStats,
  type FlWeaponKind,
  type FlWeaponLook,
  type FlWeaponSpec,
  type FlWeaponStyle,
} from "./fightLeagueRoster";

export const CUSTOM_ID_PREFIX = "my-";
/** At most this many custom fighters are kept. */
export const MAX_CUSTOM_FIGHTERS = 24;
export const NAME_MAX = 24;
export const DESCRIPTION_MAX = 140;

/* ------------------------------------------------------------------ the spec (what the AI writes and the device keeps) */

export type ParamValue = number | boolean | string;

export interface CustomEffectSpec {
  primitive: FlPrimitive;
  /** The primitive's numbers and flags by name (`PRIMITIVE_PARAMS`); anything missing takes its default, anything else is dropped. */
  params?: Record<string, ParamValue>;
}

export interface CustomWeaponSpec {
  kind: FlWeaponKind;
  style?: string;
  look?: string;
  shape?: string;
  color?: string;
  reach?: number;
  cooldown?: number;
  throwEvery?: number;
  damage?: number;
  knockback?: number;
  speed?: number;
  count?: number;
  spread?: number;
  homing?: number;
  size?: number;
  effect?: number;
  effectSec?: number;
}

export interface CustomFighterSpec {
  /** Kept once made (`my-…`); a new spec gets one from its name. */
  id?: string;
  name: string;
  short?: string;
  role: FlRole;
  body: string;
  accent: string;
  look?: { pattern?: string; crest?: string; glow?: string; trail?: string };
  weapon: CustomWeaponSpec;
  stats?: Partial<FlStats>;
  ability: { name: string; ultimate?: boolean; primitive: FlPrimitive; params?: Record<string, ParamValue>; second?: CustomEffectSpec };
  description: string;
  createdAt?: string;
}

/* ------------------------------------------------------------------ bounds */

interface NumberParam {
  min: number;
  max: number;
  def: number;
  int?: boolean;
  /** Left out of the effect unless the spec gives it. */
  optional?: boolean;
}
type ParamSpec = NumberParam | { flag: true } | { shape: readonly FlShape[]; optional?: true } | { color: true } | { choice: readonly string[]; def: string };

const num = (min: number, max: number, def: number, extra: Partial<NumberParam> = {}): NumberParam => ({ min, max, def, ...extra });
const opt = (min: number, max: number, def = min): NumberParam => ({ min, max, def, optional: true });
const flag = { flag: true } as const;
const projectileShapes: readonly FlShape[] = FL_SHAPES.filter((s) => !FL_SUMMON_SHAPES.includes(s));

/**
 * The numbers each ability primitive takes: bounds and defaults, tighter than the engine's own limits
 * (`FL_PRIMITIVE_LIMITS`) and chosen so that any value inside them is a fair ability for its class.
 */
export const PRIMITIVE_PARAMS: Readonly<Record<FlPrimitive, Readonly<Record<string, ParamSpec>>>> = {
  speedBurst: { mult: num(1.3, 3, 1.8), dur: num(1, 3, 2.5) },
  damageBurst: { mult: num(1.3, 2, 1.8), dur: num(2, 4, 3), knockback: opt(0, 2) },
  attackSpeedBurst: { mult: num(1.5, 3, 2), dur: num(2, 3, 3) },
  invulnerable: { dur: num(0.5, 2.5, 2), contact: opt(0, 8), untargetable: flag },
  freezeAll: { dur: num(0.5, 1.6, 1.3) },
  choke: { dur: num(0.5, 2, 1.5), damage: num(1, 14, 9), at: { choice: ["start", "over", "end"], def: "over" } },
  arenaCuts: { n: num(1, 6, 3, { int: true }), damage: num(2, 8, 5) },
  beam: { dur: num(0.5, 2, 1.2), width: num(0.3, 1.4, 0.8), damage: num(2, 10, 5), color: { color: true } },
  volley: {
    n: num(1, 8, 4, { int: true }),
    damage: num(2, 20, 5),
    speed: opt(0.8, 1.6, 1.3),
    spread: opt(0, 50, 12),
    size: opt(0.15, 0.9, 0.3),
    homing: opt(0, 3, 0),
    explode: opt(0, 3.5, 0),
    shape: { shape: projectileShapes, optional: true },
    color: { color: true },
    returning: flag,
    bounceFoes: flag,
    unblockable: flag,
  },
  shockwave: { radius: num(2.5, 5.5, 4), damage: num(4, 18, 10), knockback: num(0.5, 3.5, 2), delay: opt(0, 1.5, 0), pin: flag, spin: flag },
  pull: { strength: num(1, 2.4, 1.8), all: flag },
  decoys: { n: num(1, 2, 2, { int: true }), dur: num(3, 4, 4), freezeOnTouch: opt(0, 1.5, 0) },
  heal: { amount: num(10, 30, 25), dur: num(2, 4, 3) },
  fireRing: { radius: num(2, 3.5, 3), damage: num(1, 6, 4), dur: num(2, 3, 2.5), shape: { shape: projectileShapes, optional: true } },
  giantHit: { mult: num(1.5, 5, 2.5), count: opt(1, 5, 1), knockback: opt(0, 3, 0), freeze: opt(0, 0.6, 0), homing: opt(0, 4, 0) },
  lightning: { damage: num(6, 15, 10) },
  confuse: { dur: num(0.5, 2.5, 2) },
  blinkStrike: { n: num(1, 5, 3, { int: true }), damage: num(3, 8, 5), interval: opt(0.1, 0.6, 0.25) },
  summon: { n: num(1, 3, 2, { int: true }), dur: num(3, 4, 4), damage: num(2, 6, 3), size: opt(0.4, 0.7, 0.5), shape: { shape: FL_SUMMON_SHAPES, optional: true }, speed: opt(0.8, 1.6, 1.2) },
  reflect: { dur: num(1, 3, 2.5), frac: num(0.2, 0.6, 0.5), deflect: flag },
  disarm: { dur: num(0.5, 2.5, 2) },
  slowTime: { dur: num(1, 2.5, 2), factor: num(0.3, 0.7, 0.5) },
  trap: { n: num(1, 3, 2, { int: true }), damage: num(3, 10, 6), hold: num(0.3, 0.8, 0.7), dur: opt(3, 8, 5), shape: { shape: projectileShapes, optional: true } },
  wall: { dur: num(2, 4, 3), length: opt(3, 6, 5), solid: flag, shape: { shape: projectileShapes, optional: true } },
  transform: { size: num(1.1, 1.5, 1.3), damage: num(1.2, 1.7, 1.5), speed: num(0.8, 1.3, 1.1), attackSpeed: opt(0.8, 1.4, 1.1), dur: num(2, 5, 4) },
  drain: { frac: num(0.2, 0.6, 0.5), dur: num(2, 4, 3) },
};

/**
 * What an effect may deal in all, so that a mix of high values stays as strong as the built-in abilities and no stronger: the
 * primitive's total (`power`: pellets × damage, damage × seconds…) is at most `max` – about the 90th percentile of the
 * built-in roster's own abilities – and `scale` is the number brought down to fit. (Two effects in one ability get 70 % each.)
 */
export const EFFECT_BUDGET: Readonly<Partial<Record<FlPrimitive, { power: (e: Record<string, number>) => number; max: number; scale: string }>>> = {
  volley: { power: (e) => e.n * e.damage * (e.explode ? 1.3 : 1), max: 28, scale: "damage" },
  blinkStrike: { power: (e) => e.n * e.damage, max: 25, scale: "damage" },
  arenaCuts: { power: (e) => e.n * e.damage, max: 32, scale: "damage" },
  trap: { power: (e) => e.n * e.damage, max: 28, scale: "damage" },
  summon: { power: (e) => e.n * e.damage * (e.dur / 4), max: 12, scale: "damage" },
  beam: { power: (e) => e.damage * e.dur, max: 10, scale: "damage" },
  fireRing: { power: (e) => e.damage * e.dur, max: 15, scale: "damage" },
  damageBurst: { power: (e) => e.mult * e.dur, max: 6.5, scale: "mult" },
  attackSpeedBurst: { power: (e) => e.mult * e.dur, max: 7.5, scale: "mult" },
  speedBurst: { power: (e) => e.mult * e.dur, max: 6, scale: "mult" },
  giantHit: { power: (e) => e.mult * (e.count ?? 1), max: 9, scale: "mult" },
  transform: { power: (e) => e.damage * e.dur, max: 10, scale: "damage" },
  reflect: { power: (e) => e.frac * e.dur, max: 2, scale: "frac" },
  drain: { power: (e) => e.frac * e.dur, max: 2.8, scale: "frac" },
};

/** Stats by role: [min, max] per stat (the tank and glass templates the built-in rows follow; the rest a moderate band). */
const STAT_BOUNDS: Readonly<Record<FlRole, Readonly<Record<keyof FlStats, readonly [number, number]>>>> = (() => {
  const common = { attackSpeed: [0.8, 1.3], damage: [0.45, 2.4], castSpeed: [0.7, 1.3] } as const;
  const moderate = { hp: [85, 115], speed: [0.85, 1.3], size: [0.85, 1.15], ...common } as const;
  return {
    tank: { hp: [110, 130], speed: [0.7, 0.85], size: [1.1, 1.3], ...common },
    glass: { hp: [85, 95], speed: [1.3, 1.8], size: [0.7, 0.9], ...common },
    bruiser: moderate,
    duelist: moderate,
    ranged: moderate,
    control: moderate,
    summoner: moderate,
    support: moderate,
  };
})() as Readonly<Record<FlRole, Readonly<Record<keyof FlStats, readonly [number, number]>>>>;

/** The weapon styles each kind takes (the rest of `FL_WEAPON_STYLES` is for other kinds). */
export const STYLES_OF_KIND: Readonly<Partial<Record<FlWeaponKind, readonly FlWeaponStyle[]>>> = {
  sword: ["plain", "glow", "double"],
  hammer: ["plain", "returning"],
  chain: ["plain", "pull"],
  gun: ["plain", "burst", "bouncing"],
  cards: ["plain", "blink"],
  staff: ["plain", "return"],
  shield: ["plain", "block"],
  fists: ["plain", "contact"],
  whip: ["plain", "lasso"],
  bomb: ["plain", "fuse"],
};

/** A weapon's `effect` / `effectSec` where the kind has one: [min, max]. */
const WEAPON_EFFECT: Readonly<Partial<Record<FlWeaponKind, { effect?: readonly [number, number]; effectSec?: readonly [number, number] }>>> = {
  web: { effect: [0.4, 0.8], effectSec: [1, 2.5] },
  ice: { effect: [0.5, 1.5] },
  bomb: { effect: [1, 2] },
};

/* ------------------------------------------------------------------ helpers */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `#rgb` / `#rrggbb` (any case, the `#` optional) as `#rrggbb`, else the fallback. */
export function normaliseColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  let t = value.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : fallback;
}

/** A line of plain text: control characters and angle brackets out, spaces folded, cut to `max`. */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** `my-` + the name as a lower-case slug (letters and digits, `-` between), at most 24 characters; `taken` ids get `-2`, `-3`… */
export function customIdFor(name: string, taken: ReadonlySet<string>): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "fighter";
  let id = `${CUSTOM_ID_PREFIX}${slug}`;
  for (let i = 2; taken.has(id); i++) id = `${CUSTOM_ID_PREFIX}${slug}-${i}`;
  return id;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/* ------------------------------------------------------------------ building the pieces */

/** How much more damage per second a weapon deals than its kind's defaults do (1 = the same): pellets × damage ÷ attack gap. */
export function weaponPower(spec: FlWeaponSpec, kind: FlWeaponKind): number {
  const d = FL_WEAPON_DEFAULTS[kind];
  const gap = (w: { cooldown?: number; throwEvery?: number }, base: { cooldown: number; throwEvery: number }) => (base.cooldown > 0 ? (w.cooldown ?? base.cooldown) : base.throwEvery > 0 ? (w.throwEvery ?? base.throwEvery) : 1);
  const mine = (spec.damage ?? d.damage) * (spec.count ?? d.count) / gap(spec, d);
  const base = d.damage * d.count / gap({}, d);
  return base > 0 ? mine / base : 1;
}

/** A custom weapon deals at most this many times its kind's default damage per second. */
export const MAX_WEAPON_POWER = 1.2;

function buildWeapon(spec: CustomWeaponSpec, accent: string, notes: string[]): FlWeaponSpec {
  const kind = oneOf(spec.kind, FL_WEAPON_KINDS) ?? "fists";
  const d = FL_WEAPON_DEFAULTS[kind];
  const out: FlWeaponSpec = { kind };
  const style = oneOf(spec.style, STYLES_OF_KIND[kind] ?? ["plain"]);
  if (style && style !== "plain") out.style = style;
  const look = oneOf(spec.look, (FL_WEAPON_LOOKS[kind] ?? []) as readonly FlWeaponLook[]);
  if (look) out.look = look;
  const shape = oneOf(spec.shape, projectileShapes);
  if (shape) out.shape = shape;
  out.color = normaliseColor(spec.color, accent);
  const band = (key: "reach" | "cooldown" | "throwEvery" | "damage" | "knockback" | "speed" | "size", lo: number, hi: number) => {
    const base = d[key];
    const v = spec[key];
    if (base <= 0 || !isNum(v)) return;
    out[key] = round2(clamp(v, base * lo, base * hi));
    if (out[key] !== round2(v)) notes.push(`weapon ${key}`);
  };
  band("reach", 0.75, 1.25);
  band("cooldown", 0.7, 1.4);
  band("throwEvery", 0.75, 1.4);
  band("damage", 0.7, 1.3);
  band("knockback", 0.6, 1.4);
  band("speed", 0.8, 1.25);
  band("size", 0.7, 1.3);
  if (isNum(spec.count) && d.count > 0) out.count = clamp(Math.round(spec.count), 1, Math.max(3, Math.round(d.count * 1.5)));
  // The bands above compound (pellets × damage ÷ cooldown), so the weapon's damage is brought down until it deals at most
  // `MAX_WEAPON_POWER` × its kind's default damage per second.
  const power = weaponPower(out, kind);
  if (power > MAX_WEAPON_POWER) {
    out.damage = round2((out.damage ?? d.damage) * (MAX_WEAPON_POWER / power));
    notes.push("weapon damage");
  }
  // a tighter spread or a homing shot hits more often than the kind's own, so both stay near the kind's defaults
  if (isNum(spec.spread) && d.spread > 0) out.spread = round2(clamp(spec.spread, d.spread * 0.6, d.spread * 1.5));
  if (isNum(spec.homing)) out.homing = round2(clamp(spec.homing, 0, d.homing > 0 ? d.homing * 1.3 : 0.4));
  const fx = WEAPON_EFFECT[kind];
  if (fx?.effect && isNum(spec.effect)) out.effect = round2(clamp(spec.effect, fx.effect[0], fx.effect[1]));
  if (fx?.effectSec && isNum(spec.effectSec)) out.effectSec = round2(clamp(spec.effectSec, fx.effectSec[0], fx.effectSec[1]));
  return out;
}

function buildEffect(spec: CustomEffectSpec, accent: string, notes: string[], share = 1): FlEffect {
  const p = oneOf(spec.primitive, FL_ABILITY_PRIMITIVES) ?? "speedBurst";
  const table = PRIMITIVE_PARAMS[p];
  const given = spec.params && typeof spec.params === "object" ? spec.params : {};
  const out: Record<string, ParamValue> = { p };
  for (const [key, def] of Object.entries(table)) {
    const v = (given as Record<string, unknown>)[key];
    if ("min" in def) {
      if (isNum(v)) {
        const c = clamp(def.int ? Math.round(v) : v, def.min, def.max);
        if (c !== v) notes.push(`${p}.${key}`);
        out[key] = round2(c);
      } else if (!def.optional) out[key] = def.def;
    } else if ("flag" in def) {
      if (v === true) out[key] = true;
    } else if ("shape" in def) {
      const s = oneOf(v, def.shape);
      if (s) out[key] = s;
    } else if ("color" in def) {
      if (typeof v === "string") out[key] = normaliseColor(v, accent);
    } else {
      out[key] = oneOf(v, def.choice) ?? def.def;
    }
  }
  const budget = EFFECT_BUDGET[p];
  if (budget) {
    const nums = out as unknown as Record<string, number>;
    const def = table[budget.scale];
    for (let guard = 0; guard < 4; guard++) {
      const power = budget.power(nums);
      const cap = budget.max * share;
      if (power <= cap + 1e-9) break;
      const floor = def && "min" in def ? def.min : 0;
      const next = Math.max(floor, Math.floor(nums[budget.scale] * (cap / power) * 100) / 100); // (rounded down: it never ends above the budget)
      if (next >= nums[budget.scale]) {
        // the scaled number is at its floor: shorten the effect instead
        if (typeof nums.dur === "number" && "dur" in table && "min" in table.dur) nums.dur = Math.max(table.dur.min, round2(nums.dur * (cap / power)));
        break;
      }
      nums[budget.scale] = next;
      notes.push(`${p}.${budget.scale}`);
    }
  }
  return out as unknown as FlEffect;
}

function chargeFor(effects: readonly FlEffect[], ultimate: boolean): { charge: number; ability: Pick<FlAbility, "ultimate" | "effects"> } {
  const ability = { effects, ...(ultimate ? { ultimate: true } : {}) };
  const [lo, hi] = FL_CHARGE_RANGE[abilityClass(ability)];
  return { charge: round2((lo + hi) / 2), ability };
}

/* ------------------------------------------------------------------ the builder */

export type BuiltFighter = { ok: true; row: FlFighterRow; spec: CustomFighterSpec; notes: string[] } | { ok: false; errors: string[] };

/**
 * A spec as a roster row: the pieces built and clamped as above. `taken` are the ids already in use (the roster's and the
 * other custom fighters'); a spec that names its own `my-…` id keeps it when it is free. Errors only for what cannot be
 * repaired: no usable name, or a description/ability name that is empty.
 */
export function buildCustomFighter(spec: CustomFighterSpec, taken?: ReadonlySet<string>): BuiltFighter {
  const errors: string[] = [];
  const notes: string[] = [];
  const name = plainText(spec?.name, NAME_MAX);
  if (name.length < 2) errors.push("name: 2–24 letters or digits");
  const abilityName = plainText(spec?.ability?.name, 28);
  if (abilityName.length < 2) errors.push("ability.name: 2–28 characters");
  const description = plainText(spec?.description, DESCRIPTION_MAX);
  if (description.length < 8) errors.push("description: one short sentence");
  if (!spec?.weapon || typeof spec.weapon !== "object") errors.push("weapon: a weapon kind is needed");
  if (!spec?.ability || typeof spec.ability !== "object") errors.push("ability: an ability primitive is needed");
  if (errors.length) return { ok: false, errors };

  const role = oneOf(spec.role, FL_ROLES) ?? "duelist";
  const body = normaliseColor(spec.body, "#8b5cf6");
  const accent = normaliseColor(spec.accent, "#f8fafc");

  const bounds = STAT_BOUNDS[role];
  const given = spec.stats ?? {};
  const stats = {} as FlStats;
  for (const key of Object.keys(bounds) as (keyof FlStats)[]) {
    const [lo, hi] = bounds[key];
    const v = given[key];
    const mid = key === "hp" ? Math.round((lo + hi) / 2) : round2((lo + hi) / 2);
    stats[key] = isNum(v) ? (key === "hp" ? Math.round(clamp(v, lo, hi)) : round2(clamp(v, lo, hi))) : key === "attackSpeed" || key === "damage" || key === "castSpeed" ? 1 : mid;
    if (isNum(v) && stats[key] !== v) notes.push(`stats.${key}`);
  }

  const weapon = buildWeapon(spec.weapon, accent, notes);
  const two = !!spec.ability.second && spec.ability.second.primitive !== spec.ability.primitive;
  const share = two ? 0.7 : 1;
  const effects: FlEffect[] = [buildEffect({ primitive: spec.ability.primitive, params: spec.ability.params }, accent, notes, share)];
  if (two && spec.ability.second) effects.push(buildEffect(spec.ability.second, accent, notes, share));
  for (const e of effects) {
    const broken = flLimitViolations(e);
    if (broken.length) errors.push(`ability: ${broken.join(", ")}`); // cannot happen while PRIMITIVE_PARAMS stays inside FL_PRIMITIVE_LIMITS (tested)
  }
  if (errors.length) return { ok: false, errors };
  const ultimate = spec.ability.ultimate === true;
  const { charge } = chargeFor(effects, ultimate);
  const ability: FlAbility = { name: abilityName, charge, effects, ...(ultimate ? { ultimate: true } : {}) };

  const used = taken ?? new Set<string>();
  const wanted = typeof spec.id === "string" && /^my-[a-z0-9-]{1,24}$/.test(spec.id) && !used.has(spec.id) ? spec.id : null;
  const id = wanted ?? customIdFor(name, used);

  const look: FlLook = {
    pattern: oneOf(spec.look?.pattern, FL_LOOK_PATTERNS) ?? "ring",
    crest: oneOf(spec.look?.crest, FL_LOOK_CRESTS) ?? "none",
    ...(spec.look?.glow ? { glow: normaliseColor(spec.look.glow, accent) } : {}),
    ...(spec.look?.trail ? { trail: normaliseColor(spec.look.trail, accent) } : {}),
  };
  const short = plainText(spec.short, 10) || undefined;

  const row: FlFighterRow = {
    id,
    name,
    division: "wildcard",
    source: "Made with the app's AI",
    body,
    accent,
    weapons: [weapon],
    stats,
    ability,
    description,
    role,
    isNew: true,
    look,
    custom: true,
    ...(short ? { short } : {}),
  };
  const kept: CustomFighterSpec = {
    id,
    name,
    ...(short ? { short } : {}),
    role,
    body,
    accent,
    look,
    weapon: { ...weapon },
    stats,
    ability: {
      name: abilityName,
      ...(ultimate ? { ultimate: true } : {}),
      primitive: effects[0].p,
      params: paramsOf(effects[0]),
      ...(effects[1] ? { second: { primitive: effects[1].p, params: paramsOf(effects[1]) } } : {}),
    },
    description,
    createdAt: typeof spec.createdAt === "string" ? spec.createdAt.slice(0, 40) : undefined,
  };
  return { ok: true, row, spec: kept, notes: [...new Set(notes)] };
}

function paramsOf(effect: FlEffect): Record<string, ParamValue> {
  const { p: _p, ...rest } = effect as unknown as Record<string, ParamValue>;
  void _p;
  return rest;
}

/* ------------------------------------------------------------------ the roster of the device */

/**
 * Builds a stored list of specs into rows: invalid ones are dropped, duplicates and clashes with the built-in ids renamed,
 * at most `MAX_CUSTOM_FIGHTERS`. Returns the rows and the specs that were kept (what to write back).
 */
export function buildCustomFighters(specs: readonly unknown[]): { rows: FlFighterRow[]; specs: CustomFighterSpec[] } {
  const taken = new Set<string>([...FL_BY_ID.values()].filter((r) => !r.custom).map((r) => r.id));
  const rows: FlFighterRow[] = [];
  const kept: CustomFighterSpec[] = [];
  for (const raw of specs) {
    if (rows.length >= MAX_CUSTOM_FIGHTERS) break;
    if (!raw || typeof raw !== "object") continue;
    const built = buildCustomFighter(raw as CustomFighterSpec, taken);
    if (!built.ok) continue;
    taken.add(built.row.id);
    rows.push(built.row);
    kept.push(built.spec);
  }
  return { rows, specs: kept };
}
