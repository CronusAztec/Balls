import { midiToFrequency } from "@/lib/audio/scales";
import type { Ball, FightSoundKind, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";
import { atLeastMin } from "@/lib/uncap"; // uncap-all: no maximum
import { MAX_NUDGE, offAxisAngle, steerToward } from "./arenaGames";
import {
  FL_BY_ID,
  FL_DIVISIONS,
  FL_ROSTER,
  isFlFighterId,
  weaponOf,
  type FlDivision,
  type FlEffect,
  type FlFighterRow,
  type FlShape,
  type FlWeaponKind,
  type FlWeaponSpec,
} from "./fightLeagueRoster";

/**
 * Fight League ("fightLeague" mode, the arena games' family – feature fight-league; the "Ball Fight League" duels: "Thor vs
 * Loki | Game link in bio"). Fighters are balls of the engine, each carrying a WEAPON that sticks out of it as a vector
 * sprite, with HP shown inside the ball and a bar under it, in a white square arena (or a circle) inset in the square the
 * recorder exports. The balls drift and bounce at a constant speed; a weapon touching another ball deals damage; every
 * fighter's ability charges from time and hits, telegraphs for 0.4 s and fires by itself; the last ball (or team) with HP
 * wins – or, at the time cap, the side with more HP (a draw is possible).
 *
 * The roster is data (fightLeagueRoster.ts: one row per fighter). This module is the engineering the rows share:
 *
 *  - **Weapon kinds** (`FL_WEAPON_KINDS`), each a simple silhouette with its own hit geometry against the foe's circle:
 *    sword (a blade along the velocity that sweeps 120° on every bounce; a glowing or a double blade), hammer (a slow,
 *    heavy orbit with big knockback; returning: thrown at the nearest foe and flying back, hitting on both passes), fists
 *    and claws (short punches that extend toward a foe in reach), chain (a head orbiting on a chain, damage by its momentum;
 *    pull: a thrown head that drags the hit foe in), bow, gun (burst, bouncing), shotgun (a cone of pellets), wand, staff
 *    and book (fast bolts, slow homing orbs and bolts), cards (blades orbiting the ball and flying one by one), fire (a
 *    breath cone), beam (a thin ray on a cadence), spark (arcs to a foe in range), web (slows), ice (freezes), shield
 *    (blocks hits from the front, thrown every few seconds) and tail (sweeping behind the ball).
 *  - **Ability primitives** (`FL_ABILITY_PRIMITIVES`): speed / damage / attack-speed bursts, invulnerability, freezes,
 *    chokes, arena cuts, beams, volleys, shockwaves, pulls, decoys, heals, fire rings, giant hits, lightning, confusion,
 *    blink strikes, summons, reflection, disarming and slow time – each a case of `castEffect()`.
 *
 * Hits: a melee shape (a segment or a circle) or a projectile against the foe's circle; one touch is one hit (the foe's
 * short invulnerability window, `FL_IFRAME_MS` – the pellets and arrows of one volley land together), with knockback, a
 * hit flash and a floating damage number. Damage taken within a 60 Hz step is applied together and the KOs are decided at
 * its end, so no fighter wins by its slot – and two fighters can go down together: a DOUBLE KO (a projectile still in the
 * air after the last KO gets `FL_KO_GRACE_MS` to land).
 *
 * Determinism: every random number – a "random" fighter slot, the spawn, the launch headings, every shot's spread, the arena
 * cuts – comes from `ctx.random()` in slot order, so a seed replays exactly at any frame rate and Find Simulation can search
 * it ("A wins", "B wins", the run's length, a double KO). The rigged forced winner (`config.forcedWinner`, a fighter in
 * 1v1 and the free-for-alls, a team in 2v2) steers within that replay (`updateRig()`): its hits land a little more (a
 * longer reach, homing shots, rebounds nudged toward a rival – more the further it trails) and the rivals' a little less
 * (it recovers longer from a hit), and as a backstop its side's last fighter never loses its last hit point until the
 * verdict – to a hit or to reflected damage, also when the rivals go down in the same step or a shot lands in the KO grace
 * (`absorbLethal()`, with `guardChosenSide()` before every step's KOs) – and the time cap waits while it trails: the
 * chosen side always wins, never in a double KO.
 *
 * Sound: every weapon hit is an effect of its kind (`SoundEvent.fight` – a metallic ring for blades, a thud for hammers
 * and flails, a twang for arrows, a shot for guns, a whoosh for fire, a chime for magic), an ability a swell, a KO a heavy
 * hit, all through the ToneGenerator (fightTones.ts); wall bounces are soft notes of the scale (melodies, the slicer and
 * the hit samples apply). Per rendered frame the strongest `FL_SOUNDS_PER_FRAME` play.
 */

/* ------------------------------------------------------------------ settings */

export const FL_MATCHES = ["1v1", "2v2", "ffa3", "ffa4"] as const;
export type FlMatch = (typeof FL_MATCHES)[number];
export const FL_ARENAS = ["square", "circle"] as const;
export type FlArena = (typeof FL_ARENAS)[number];
/** A slot that picks its fighter by the seed. */
export const FL_RANDOM = "random";
/** Fighter slots A–D. */
export const FL_SLOTS = 4;

export function isFlMatch(value: unknown): value is FlMatch {
  return typeof value === "string" && (FL_MATCHES as readonly string[]).includes(value);
}
export function isFlArena(value: unknown): value is FlArena {
  return typeof value === "string" && (FL_ARENAS as readonly string[]).includes(value);
}
/** A fighter slot's value: a roster id or "random". */
export function isFlSlotValue(value: unknown): value is string {
  return value === FL_RANDOM || isFlFighterId(value);
}

/** Fighters in play for a match type. */
export function matchFighters(match: FlMatch): number {
  return match === "1v1" ? 2 : match === "ffa3" ? 3 : 4;
}
/** Sides (teams) of a match type: 2v2 has two teams of two, the others one team per fighter. */
export function matchTeams(match: FlMatch): number {
  return match === "2v2" ? 2 : matchFighters(match);
}
/** The team of slot `slot` (2v2: A + B against C + D). */
export function slotTeam(match: FlMatch, slot: number): number {
  return match === "2v2" ? (slot < 2 ? 0 : 1) : slot;
}

export interface FightLeagueSettings {
  /** Slots A–D: a roster id or "random" (picked by the seed). */
  fighters: readonly string[];
  match: FlMatch;
  /** A "random" slot picks from the division of the first fighter chosen (an in-genre matchup); off: anyone. */
  sameDivision: boolean;
  /** Every fighter's HP (× its row's hp %). */
  hp: number;
  /** Per-slot multipliers of the fighter's speed, damage, attack speed and cast speed (handicaps, "reworks"). */
  speed: readonly number[];
  damage: readonly number[];
  attack: readonly number[];
  cast: readonly number[];
  /** Seconds after which the side with more HP wins (a draw is possible); 0 = no cap. */
  timeCap: number;
  arena: FlArena;
  /** The names, the VS card, the ability boxes and the stat lines (visual only). */
  hud: boolean;
}

export const DEFAULT_FIGHT_LEAGUE_SETTINGS: FightLeagueSettings = {
  fighters: ["thor", "loki", FL_RANDOM, FL_RANDOM],
  match: "1v1",
  sameDivision: true,
  hp: 100,
  speed: [1, 1, 1, 1],
  damage: [1, 1, 1, 1],
  attack: [1, 1, 1, 1],
  cast: [1, 1, 1, 1],
  timeCap: 90,
  arena: "square",
  hud: true,
};

const MULT_RANGE = { min: 0.05, max: 3, step: 0.05 } as const;

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const FIGHT_LEAGUE_RANGES = {
  flHp: { min: 1, max: 300, step: 1 },
  flTimeCap: { min: 0, max: 300, step: 5 },
  flSpeedA: { ...MULT_RANGE },
  flSpeedB: { ...MULT_RANGE },
  flSpeedC: { ...MULT_RANGE },
  flSpeedD: { ...MULT_RANGE },
  flDamageA: { ...MULT_RANGE },
  flDamageB: { ...MULT_RANGE },
  flDamageC: { ...MULT_RANGE },
  flDamageD: { ...MULT_RANGE },
  flAttackA: { ...MULT_RANGE },
  flAttackB: { ...MULT_RANGE },
  flAttackC: { ...MULT_RANGE },
  flAttackD: { ...MULT_RANGE },
  flCastA: { ...MULT_RANGE },
  flCastB: { ...MULT_RANGE },
  flCastC: { ...MULT_RANGE },
  flCastD: { ...MULT_RANGE },
} as const;

/** The Fight League fields of the SimulatorSettings object (URL keys fl1–fl4, flM, flDiv, flHp, flT, flA, flH, flS1–4, flD1–4, flX1–4, flC1–4). */
export interface FightLeagueFields {
  flFighterA: string;
  flFighterB: string;
  flFighterC: string;
  flFighterD: string;
  flMatch: FlMatch;
  flSameDivision: boolean;
  flHp: number;
  flTimeCap: number;
  flArena: FlArena;
  flHud: boolean;
  flSpeedA: number;
  flSpeedB: number;
  flSpeedC: number;
  flSpeedD: number;
  flDamageA: number;
  flDamageB: number;
  flDamageC: number;
  flDamageD: number;
  flAttackA: number;
  flAttackB: number;
  flAttackC: number;
  flAttackD: number;
  flCastA: number;
  flCastB: number;
  flCastC: number;
  flCastD: number;
}

const SLOT_LETTERS = ["A", "B", "C", "D"] as const;
type SlotLetter = (typeof SLOT_LETTERS)[number];
const fighterField = (i: number) => `flFighter${SLOT_LETTERS[i]}` as `flFighter${SlotLetter}`;
const multField = (stat: "Speed" | "Damage" | "Attack" | "Cast", i: number) => `fl${stat}${SLOT_LETTERS[i]}` as `fl${"Speed" | "Damage" | "Attack" | "Cast"}${SlotLetter}`;

function finite(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : NaN;
}
/** A multiplier: a finite number from its minimum up, three decimals at most (no maximum). */
function multOf(value: unknown, fallback: number): number {
  const n = finite(value);
  return Number.isFinite(n) ? Math.round(1000 * atLeastMin(n, MULT_RANGE)) / 1000 : fallback;
}

/** Fills in the defaults and validates every value (uncapped numbers from their minimum up; known ids and options). */
export function resolveFightLeagueSettings(config: Partial<FightLeagueSettings> | null | undefined): FightLeagueSettings {
  const d = DEFAULT_FIGHT_LEAGUE_SETTINGS;
  const c = config ?? {};
  const fighters = d.fighters.map((def, i) => (isFlSlotValue(c.fighters?.[i]) ? (c.fighters![i] as string) : def));
  const hp = finite(c.hp);
  const cap = finite(c.timeCap);
  const list = (src: readonly number[] | undefined, def: readonly number[]) => def.map((v, i) => multOf(src?.[i], v));
  return {
    fighters,
    match: isFlMatch(c.match) ? c.match : d.match,
    sameDivision: typeof c.sameDivision === "boolean" ? c.sameDivision : d.sameDivision,
    hp: Number.isFinite(hp) ? Math.round(atLeastMin(hp, FIGHT_LEAGUE_RANGES.flHp)) : d.hp,
    speed: list(c.speed, d.speed),
    damage: list(c.damage, d.damage),
    attack: list(c.attack, d.attack),
    cast: list(c.cast, d.cast),
    timeCap: Number.isFinite(cap) ? Math.round(10 * Math.max(0, cap)) / 10 : d.timeCap,
    arena: isFlArena(c.arena) ? c.arena : d.arena,
    hud: typeof c.hud === "boolean" ? c.hud : d.hud,
  };
}

/** Picks the Fight League settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setFightLeagueSettings()`. */
export function fightLeagueSettingsOf(source: FightLeagueFields): FightLeagueSettings {
  const pick = (stat: "Speed" | "Damage" | "Attack" | "Cast") => [0, 1, 2, 3].map((i) => source[multField(stat, i)]);
  return {
    fighters: [source.flFighterA, source.flFighterB, source.flFighterC, source.flFighterD],
    match: source.flMatch,
    sameDivision: source.flSameDivision,
    hp: source.flHp,
    speed: pick("Speed"),
    damage: pick("Damage"),
    attack: pick("Attack"),
    cast: pick("Cast"),
    timeCap: source.flTimeCap,
    arena: source.flArena,
    hud: source.flHud,
  };
}

/** Writes resolved settings back into the SimulatorSettings field names. */
export function fightLeagueSettingFields(s: FightLeagueSettings): FightLeagueFields {
  const out = {
    flFighterA: s.fighters[0],
    flFighterB: s.fighters[1],
    flFighterC: s.fighters[2],
    flFighterD: s.fighters[3],
    flMatch: s.match,
    flSameDivision: s.sameDivision,
    flHp: s.hp,
    flTimeCap: s.timeCap,
    flArena: s.arena,
    flHud: s.hud,
  } as FightLeagueFields;
  for (let i = 0; i < FL_SLOTS; i++) {
    out[multField("Speed", i)] = s.speed[i];
    out[multField("Damage", i)] = s.damage[i];
    out[multField("Attack", i)] = s.attack[i];
    out[multField("Cast", i)] = s.cast[i];
  }
  return out;
}

/** The defaults of the feature's fields. */
export function defaultFightLeagueFields(): FightLeagueFields {
  return fightLeagueSettingFields(DEFAULT_FIGHT_LEAGUE_SETTINGS);
}

/** Validates the feature's fields (URL parameters and presets alike): known ids and options, uncapped numbers, real booleans. */
export function resolveFightLeagueFields(source: Partial<FightLeagueFields>): FightLeagueFields {
  const base = { ...defaultFightLeagueFields(), ...stripUndefined(source) } as FightLeagueFields;
  return fightLeagueSettingFields(resolveFightLeagueSettings(fightLeagueSettingsOf(base)));
}

/**
 * The mode's own defaults on top of the shared ones: no gravity (the fighters drift at a constant speed; the Gravity slider
 * still applies when set) and a minute of clip (most fights end within it).
 */
export function fightLeagueModeDefaults(mode: string): { gravity?: number; recordingDuration?: number } {
  return mode === "fightLeague" ? { gravity: 0, recordingDuration: 60 } : {};
}

function stripUndefined<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(source) as (keyof T)[]) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Up to three decimals, trailing zeros dropped (like settings.ts), so values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** URL key → numeric field. */
const NUMERIC_KEYS: Record<string, keyof FightLeagueFields> = { flHp: "flHp", flT: "flTimeCap" };
for (let i = 0; i < FL_SLOTS; i++) {
  NUMERIC_KEYS[`flS${i + 1}`] = multField("Speed", i);
  NUMERIC_KEYS[`flD${i + 1}`] = multField("Damage", i);
  NUMERIC_KEYS[`flX${i + 1}`] = multField("Attack", i);
  NUMERIC_KEYS[`flC${i + 1}`] = multField("Cast", i);
}
/** The feature's URL keys (for tools and the tests). */
export const FIGHT_LEAGUE_URL_KEYS: readonly string[] = ["fl1", "fl2", "fl3", "fl4", "flM", "flDiv", "flA", "flH", ...Object.keys(NUMERIC_KEYS)];

/** Writes the fields that differ from `base` (the mode's defaults) into the URL. */
export function writeFightLeagueParams(settings: FightLeagueFields, base: FightLeagueFields, params: URLSearchParams) {
  for (let i = 0; i < FL_SLOTS; i++) {
    const field = fighterField(i);
    if (settings[field] !== base[field]) params.set(`fl${i + 1}`, settings[field]);
  }
  if (settings.flMatch !== base.flMatch) params.set("flM", settings.flMatch);
  if (settings.flSameDivision !== base.flSameDivision) params.set("flDiv", settings.flSameDivision ? "1" : "0");
  if (settings.flArena !== base.flArena) params.set("flA", settings.flArena);
  if (settings.flHud !== base.flHud) params.set("flH", settings.flHud ? "1" : "0");
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field] as number));
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readFightLeagueParams(params: URLSearchParams, settings: FightLeagueFields) {
  const next: Record<string, unknown> = { ...settings };
  for (let i = 0; i < FL_SLOTS; i++) {
    const raw = params.get(`fl${i + 1}`);
    if (raw !== null && isFlSlotValue(raw)) next[fighterField(i)] = raw;
  }
  const match = params.get("flM");
  if (isFlMatch(match)) next.flMatch = match;
  const div = params.get("flDiv");
  if (div === "1" || div === "0") next.flSameDivision = div === "1";
  const arena = params.get("flA");
  if (isFlArena(arena)) next.flArena = arena;
  const hud = params.get("flH");
  if (hud === "1" || hud === "0") next.flHud = hud === "1";
  for (const [key, field] of Object.entries(NUMERIC_KEYS)) {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) next[field] = value;
  }
  Object.assign(settings, resolveFightLeagueFields(next as Partial<FightLeagueFields>));
}

/* ------------------------------------------------------------------ the field */

/** Arena side over the side of the square the recorder exports (the rest is the HUD: names above, ability boxes below). */
export const FL_ARENA_FRAC = 0.7;
/** The arena's top edge below the square's top (the names' band). */
export const FL_ARENA_TOP = 0.12;
/** A fighter's ball radius over the arena side (at Ball Size 8 and size 1). */
export const FL_BALL_FRAC = 0.065;
/** Cruising speed at speed 1 and Ball Speed 400, arena sides per second. */
export const FL_SPEED_FRAC = 0.7;

export interface FlField {
  kind: FlArena;
  /** The arena's centre and half side (the circle: its radius). */
  cx: number;
  cy: number;
  half: number;
  /** The arena's side (the circle: its diameter) – the length unit of every speed. */
  side: number;
  /** The square the recorder exports: left, top and side. */
  sqLeft: number;
  sqTop: number;
  sqSide: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** The playfield for a canvas of `width` × `height`: the arena inset in the centred square under the names' band. */
export function buildFightField(width: number, height: number, kind: FlArena): FlField {
  const sqSide = Math.max(40, Math.min(width, height));
  const sqLeft = width / 2 - sqSide / 2;
  const sqTop = height / 2 - sqSide / 2;
  const side = FL_ARENA_FRAC * sqSide;
  return { kind, cx: width / 2, cy: sqTop + FL_ARENA_TOP * sqSide + side / 2, half: side / 2, side, sqLeft, sqTop, sqSide, canvasWidth: width, canvasHeight: height };
}

/* ------------------------------------------------------------------ timing and rules */

/** The VS card: the fighters hold still this long before they launch. */
export const FL_INTRO_MS = 1500;
/** A hit fighter cannot be hit again for this long (one touch = one hit; the same volley's projectiles excepted). */
export const FL_IFRAME_MS = 300;
/** An ability's telegraph: the name flashes in its box this long before it fires. */
export const FL_TELEGRAPH_MS = 400;
/** After the last KO a projectile still in the air may land this long (a trade: a double KO). */
export const FL_KO_GRACE_MS = 250;
/** Meter an ability gains per hit dealt and per hit taken (× cast speed). */
export const FL_HIT_CHARGE = 0.05;
export const FL_TAKEN_CHARGE = 0.025;
/** Fraction of the gap to its cruising speed a fighter makes up per 60 Hz step (knockback fades in about 0.3 s). */
export const FL_SPEED_RELAX = 0.08;
/** No fighter flies faster than this many times its cruising speed (a safety net under stacked knockbacks). */
export const FL_SPEED_CAP = 4;
/** A sword's sweep on a bounce, degrees. */
export const FL_SWEEP_DEG = 120;
/** The director turns a wall rebound toward the nearest foe by up to this share of MAX_NUDGE (all of it after a stalemate). */
export const FL_NUDGE = 0.7;
/** Without a hit for this long the nudge is at full strength. */
export const FL_STALEMATE_MS = 3000;
/** How fast a weapon turns to its target (radians per second). */
export const FL_AIM_TURN = 7;
/** A held shield blocks hits coming from within this many degrees of its facing. */
export const FL_SHIELD_ARC_DEG = 55;
/** The page holds the winner banner this long before the end screen (recordings keep it). */
export const FL_WIN_HOLD_SEC = 3;
/** Most fight sounds one rendered frame plays (the strongest win; KOs and abilities always sound). */
export const FL_SOUNDS_PER_FRAME = 6;
/** Pools: projectiles, minions (decoys and summons), render events, scheduled effects, beams. */
export const FL_PROJECTILE_CAP = 96;
export const FL_MINION_CAP = 16;
export const FL_EVENT_CAP = 96;
const FL_TASK_CAP = 24;
const FL_BEAM_CAP = 8;

/** A fighter's weapon kinds as a sound family. */
export type FlSoundKind = FightSoundKind;
export const FL_SOUND_OF_KIND: Readonly<Record<FlWeaponKind, FlSoundKind>> = {
  sword: "blade",
  claws: "blade",
  cards: "blade",
  shield: "blade",
  hammer: "blunt",
  chain: "blunt",
  fists: "blunt",
  tail: "blunt",
  bow: "arrow",
  gun: "gun",
  shotgun: "gun",
  fire: "fire",
  wand: "magic",
  staff: "magic",
  book: "magic",
  beam: "magic",
  spark: "magic",
  web: "magic",
  ice: "magic",
};

/**
 * The ability meter after `sec` seconds of charging without hits from `start`, at `castSpeed` for an ability of `charge`
 * seconds (capped at 1 – full). Hits add `FL_HIT_CHARGE` (dealt) / `FL_TAKEN_CHARGE` (taken) × the cast speed.
 */
export function meterAfter(start: number, sec: number, castSpeed: number, charge: number): number {
  return Math.min(1, start + (Math.max(0, sec) * Math.max(0, castSpeed)) / Math.max(0.1, charge));
}

/** Seconds a meter takes to fill from empty without hits. */
export function chargeSeconds(castSpeed: number, charge: number): number {
  return castSpeed > 0 ? Math.max(0.1, charge) / castSpeed : Infinity;
}

/**
 * The verdict at the time cap: the side with the most HP left (summed over its live fighters), or −1 for a draw (two sides
 * level at the top). `hp[i]` is fighter i's HP (≤ 0 when out), `team[i]` its side; `scratch` (at least `teams` long)
 * spares the array a sudden death would allocate on every step.
 */
export function capVerdict(hp: readonly number[], team: readonly number[], teams: number, scratch?: number[]): number {
  const sums = scratch ?? new Array<number>(teams);
  for (let t = 0; t < teams; t++) sums[t] = 0;
  for (let i = 0; i < hp.length; i++) if (hp[i] > 0 && team[i] >= 0 && team[i] < teams) sums[team[i]] += hp[i];
  let best = -1;
  let bestHp = -Infinity;
  let level = false;
  for (let t = 0; t < teams; t++) {
    if (sums[t] > bestHp + 1e-9) {
      best = t;
      bestHp = sums[t];
      level = false;
    } else if (Math.abs(sums[t] - bestHp) <= 1e-9) level = true;
  }
  return level || bestHp <= 0 ? -1 : best;
}

/** Damage of a giant hit: × `mult`, × `belowHalf` instead on a foe under half its HP, or half the foe's maximum HP. */
export function giantDamage(base: number, mult: number, foeHp: number, foeMaxHp: number, belowHalf: number, halfMaxHp: boolean): number {
  if (halfMaxHp) return Math.max(base, 0.5 * foeMaxHp);
  if (belowHalf > 0 && foeHp < 0.5 * foeMaxHp) return base * belowHalf;
  return base * mult;
}

/* ------------------------------------------------------------------ geometry (pure) */

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistanceSq(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Whether a circle (cx, cy, r) touches the segment (ax, ay)–(bx, by) thickened by `half` on each side. */
export function segmentHitsCircle(ax: number, ay: number, bx: number, by: number, half: number, cx: number, cy: number, r: number): boolean {
  const reach = r + half;
  return segmentDistanceSq(ax, ay, bx, by, cx, cy) <= reach * reach;
}

/** Whether a circle (cx, cy, r) overlaps the cone from (ox, oy) along `angle` with `halfAngle` and `range`. */
export function coneHitsCircle(ox: number, oy: number, angle: number, halfAngle: number, range: number, cx: number, cy: number, r: number): boolean {
  const dx = cx - ox;
  const dy = cy - oy;
  const d = Math.hypot(dx, dy);
  if (d > range + r) return false;
  if (d <= r) return true;
  let diff = Math.atan2(dy, dx) - angle;
  while (diff > Math.PI) diff -= TWO_PI;
  while (diff < -Math.PI) diff += TWO_PI;
  return Math.abs(diff) <= halfAngle + Math.asin(Math.min(1, r / d));
}

/** Whether two circles overlap. */
export function circlesTouch(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const reach = ar + br;
  return dx * dx + dy * dy <= reach * reach;
}

/** Length of the ray from (ox, oy) inside the field along the unit direction (dx, dy) to the field's edge. */
export function rayToEdge(field: Pick<FlField, "kind" | "cx" | "cy" | "half">, ox: number, oy: number, dx: number, dy: number): number {
  if (field.kind === "circle") {
    const px = ox - field.cx;
    const py = oy - field.cy;
    const b = px * dx + py * dy;
    const c = px * px + py * py - field.half * field.half;
    const disc = b * b - c;
    return disc > 0 ? Math.max(0, -b + Math.sqrt(disc)) : 0;
  }
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (field.cx + field.half - ox) / dx);
  else if (dx < -1e-9) t = Math.min(t, (field.cx - field.half - ox) / dx);
  if (dy > 1e-9) t = Math.min(t, (field.cy + field.half - oy) / dy);
  else if (dy < -1e-9) t = Math.min(t, (field.cy - field.half - oy) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** The difference of two angles in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TWO_PI;
  while (d <= -Math.PI) d += TWO_PI;
  return d;
}

/** Turns `from` toward `to` by at most `maxTurn` radians. */
export function turnToward(from: number, to: number, maxTurn: number): number {
  const d = angleDiff(to, from);
  return from + Math.max(-maxTurn, Math.min(maxTurn, d));
}

/**
 * The melee shape of a weapon as a thick segment (`out`: a → b, `half` thickness): a sword's blade from the ball's rim
 * along `angle`, a tail behind it, a hammer's or a chain's head (a = b, `half` = the head's radius). Lengths in px.
 */
export interface MeleeShape {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  half: number;
}

/** A blade from just inside the rim (0.85 R) out to `reach` radii past it, `thickness` radii thick. */
export function bladeShape(x: number, y: number, r: number, angle: number, reach: number, thickness: number, out: MeleeShape): MeleeShape {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  out.ax = x + ux * 0.85 * r;
  out.ay = y + uy * 0.85 * r;
  out.bx = x + ux * (r + reach * r);
  out.by = y + uy * (r + reach * r);
  out.half = 0.5 * thickness * r;
  return out;
}

/** A head on a handle or a chain: a circle `size` radii big, `reach` radii past the rim along `angle`. */
export function headShape(x: number, y: number, r: number, angle: number, reach: number, size: number, out: MeleeShape): MeleeShape {
  const d = r + reach * r;
  out.ax = out.bx = x + Math.cos(angle) * d;
  out.ay = out.by = y + Math.sin(angle) * d;
  out.half = size * r;
  return out;
}

/** A fist `size` radii big at extension `ext` (0–1 of `reach` radii) past its rest point along `angle`. */
export function fistShape(x: number, y: number, r: number, angle: number, reach: number, size: number, ext: number, out: MeleeShape): MeleeShape {
  const d = r + 0.6 * size * r + ext * reach * r;
  out.ax = out.bx = x + Math.cos(angle) * d;
  out.ay = out.by = y + Math.sin(angle) * d;
  out.half = size * r;
  return out;
}

/** Whether a melee shape touches a circle. */
export function shapeHitsCircle(s: MeleeShape, cx: number, cy: number, r: number): boolean {
  return segmentHitsCircle(s.ax, s.ay, s.bx, s.by, s.half, cx, cy, r);
}

/**
 * Whether a hit coming from direction `fromAngle` (the angle from the defender toward where the hit comes from) is blocked
 * by a shield facing `facing`: within ±`FL_SHIELD_ARC_DEG`.
 */
export function shieldBlocks(facing: number, fromAngle: number): boolean {
  return Math.abs(angleDiff(fromAngle, facing)) <= (FL_SHIELD_ARC_DEG * Math.PI) / 180;
}

/** A punch's extension at `t` seconds into it (out in `out` s, back in `back` s): 0 → 1 → 0. */
export function punchExtension(t: number, out = 0.07, hold = 0.03, back = 0.11): number {
  if (t < 0) return 0;
  if (t < out) return t / out;
  if (t < out + hold) return 1;
  if (t < out + hold + back) return 1 - (t - out - hold) / back;
  return 0;
}
/** The whole punch (s). */
export const FL_PUNCH_SEC = 0.07 + 0.03 + 0.11;

/* ------------------------------------------------------------------ fighters picked for a run */

/**
 * The fighters of a run: slot by slot the chosen id, or – for "random" – a pick by the seed (`random()`, one draw per random
 * slot, in slot order): from the division of the first chosen fighter with `sameDivision` (the first random pick's when none
 * is chosen), else from the whole roster, avoiding fighters already in the match while the pool allows.
 */
export function pickFighters(settings: Pick<FightLeagueSettings, "fighters" | "match" | "sameDivision">, random: () => number): FlFighterRow[] {
  const n = matchFighters(settings.match);
  const out: (FlFighterRow | null)[] = [];
  let division: FlDivision | null = null;
  for (let i = 0; i < n; i++) {
    const id = settings.fighters[i];
    const row = id && id !== FL_RANDOM ? (FL_BY_ID.get(id) ?? null) : null;
    out.push(row);
    if (row && !division) division = row.division;
  }
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    let pool = settings.sameDivision && division ? FL_ROSTER.filter((r) => r.division === division) : FL_ROSTER.filter((r) => r.division !== "wildcard" || !settings.sameDivision);
    const fresh = pool.filter((r) => !out.some((o) => o && o.id === r.id));
    if (fresh.length > 0) pool = fresh;
    const pick = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? FL_ROSTER[0];
    out[i] = pick;
    if (!division) division = pick.division;
  }
  return out as FlFighterRow[];
}

/**
 * The sides' names for the finder's winner picker and the forced winner (fighter names are proper names, the slots letters):
 * "A · Thor", "B · Loki" ("A · ?" for a random slot); in 2v2 "A+B · Naruto + Sasuke".
 */
export function flSideNames(match: string | undefined, fighters: readonly (string | undefined)[]): string[] {
  const m: FlMatch = isFlMatch(match) ? match : "1v1";
  const nameOf = (i: number) => FL_BY_ID.get(fighters[i] ?? "")?.name ?? "?";
  if (m === "2v2") return [`A+B · ${nameOf(0)} + ${nameOf(1)}`, `C+D · ${nameOf(2)} + ${nameOf(3)}`];
  return Array.from({ length: matchFighters(m) }, (_, i) => `${"ABCD"[i]} · ${nameOf(i)}`);
}

/** The ids of the divisions in roster order (for the panel's grouped pickers). */
export const FL_DIVISION_ORDER: readonly FlDivision[] = FL_DIVISIONS;

/* ------------------------------------------------------------------ runtime state */

/** A weapon of a fighter in play: the resolved spec and its moving parts. */
export class FlWeaponState {
  readonly spec: ReturnType<typeof weaponOf>;
  readonly index: number;
  /** Seconds until the next attack (a shot, a punch, a throw…); swings and orbits run on `angle`. */
  cd = 0;
  /** Seconds until the next throw (returning hammer, pull chain, thrown shield). */
  throwCd = 0;
  /** The weapon's direction (radians): a blade, an orbit, a fist's aim, the shield's facing, a tail's swing. */
  angle = 0;
  /** A sword's sweep: seconds left, its direction and its span's start. */
  sweepT = 0;
  sweepDir = 1;
  sweepFrom = 0;
  /** A punch / swipe: seconds since it started (−1 idle), its direction, which fist, whether it landed. */
  punchT = -1;
  punchAngle = 0;
  punchSide = 0;
  punchHit = false;
  /** The projectile that is this weapon thrown (−1 while held). */
  thrown = -1;
  /** Cards: blades loaded on the orbit, the reload clock, the orbit's angle and throws so far (Katarina blinks every third). */
  loaded = 0;
  reloadT = 0;
  orbit = 0;
  throws = 0;
  /** Fire / beam: simulation ms the breath or the ray lasts until (−1 off) and the beam's slot. */
  onUntil = -1;
  beam = -1;
  /** Spark: ms of the last zap (drawing) and its target. */
  zapMs = -Infinity;
  zapX = 0;
  zapY = 0;
  /** Tail: the swing's phase (radians). */
  phase = 0;
  /** The melee shapes of this sub-step: a blade (two for a double blade), a head, the orbiting cards. */
  readonly shapes: MeleeShape[];
  /** Foes (bit per slot) and minions (bit per pool index) in contact: a hit when the contact starts (one touch = one hit). */
  touchMask = 0;
  minionMask = 0;
  /** Hits this weapon landed (thrown, shot or swung). */
  hits = 0;

  constructor(spec: FlWeaponSpec, index: number) {
    this.spec = weaponOf(spec);
    this.index = index;
    this.shapes = Array.from({ length: Math.max(2, this.spec.count) }, () => ({ ax: 0, ay: 0, bx: 0, by: 0, half: 0 }));
  }
}

/** A fighter in play. */
export class FlFighter {
  readonly slot: number;
  readonly team: number;
  readonly row: FlFighterRow;
  readonly weapons: FlWeaponState[];
  /** The engine ball's id (the ball leaves the list at the KO). */
  ballId = -1;
  alive = true;
  hp = 100;
  maxHp = 100;
  /** Position, velocity and radius (mirrored from the ball every sub-step; frozen at the KO). */
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 10;
  /** The effective stats (the row × the slot's multipliers) – the HUD's stat lines. */
  speed = 1;
  attack = 1;
  damage = 1;
  cast = 1;
  /** Cruising speed (px/s) this step, with every buff and status. */
  cruise = 0;
  /** Where the fighter faces (toward its target) and its target: a fighter slot, an enemy decoy (minion index), or none. */
  aim = 0;
  targetSlot = -1;
  targetMinion = -1;
  /** The ability: the meter (0–1), the telegraph's end (ms, −1 none) and the casts so far. */
  meter = 0;
  telegraphUntil = -1;
  casts = 0;
  // statuses (simulation ms they last until; −Infinity = none)
  iUntil = -Infinity;
  invulnUntil = -Infinity;
  untargetableUntil = -Infinity;
  contactUntil = -Infinity;
  contactDamage = 0;
  frozenUntil = -Infinity;
  /** The velocity kept while frozen or held (restored when it ends). */
  keptVx = 0;
  keptVy = 0;
  kept = false;
  /** Held by a choke: by whom, the damage still to come and how ("over" ticks it, "end" slams). */
  heldBy = -1;
  heldUntil = -Infinity;
  holdDamage = 0;
  holdMode: "start" | "over" | "end" = "start";
  holdTickMs = 0;
  slowUntil = -Infinity;
  slowFactor = 1;
  confusedUntil = -Infinity;
  disarmedUntil = -Infinity;
  reflectUntil = -Infinity;
  reflectFrac = 0;
  speedMulUntil = -Infinity;
  speedMul = 1;
  dmgMulUntil = -Infinity;
  dmgMul = 1;
  kbMul = 1;
  atkMulUntil = -Infinity;
  atkMul = 1;
  healUntil = -Infinity;
  healRate = 0;
  fireRingUntil = -Infinity;
  fireRingRadius = 0;
  fireRingDamage = 0;
  fireRingShape: FlShape = "flames";
  /** Giant hits left and how they hit. */
  giantLeft = 0;
  giantMult = 1;
  giantKb = 0;
  giantFreeze = 0;
  giantBelowHalf = 0;
  giantHalfMax = false;
  giantHoming = 0;
  /** Pulled toward a fighter until (ms), by whom, at what speed (px/s). */
  pullUntil = -Infinity;
  pullBy = -1;
  pullSpeed = 0;
  /** Pinned against a wall (Gandalf) until (ms). */
  pinUntil = -Infinity;
  /** Drawing: the last hit taken (ms), the last attacker, the KO time, a blink's origin. */
  hitMs = -Infinity;
  lastHitBy = -1;
  koMs = -Infinity;
  blinkMs = -Infinity;
  blinkX = 0;
  blinkY = 0;
  /** Counters: hits landed and taken, damage dealt, KOs scored, hits blocked, damage taken in this step. */
  hits = 0;
  taken = 0;
  dealt = 0;
  kills = 0;
  blocks = 0;
  /** The volley of the last hit taken and when (the pellets of one trigger land together). */
  lastVolley = 0;
  lastVolleyMs = -Infinity;

  constructor(slot: number, team: number, row: FlFighterRow) {
    this.slot = slot;
    this.team = team;
    this.row = row;
    this.weapons = row.weapons.map((w, i) => new FlWeaponState(w, i));
  }
}

/** Projectile kinds by behaviour (the shape is the drawing). */
export const PK_SHOT = 0;
export const PK_HAMMER = 1;
export const PK_SPEAR = 2;
export const PK_SHIELD = 3;
export const PK_CARD = 4;
export const PK_ABILITY = 5;

export class FlProjectile {
  active = false;
  kind = PK_SHOT;
  owner = 0;
  team = 0;
  shape: FlShape = "bullet";
  color = "#fff";
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 2;
  damage = 0;
  kb = 0;
  /** Simulation ms it lasts until. */
  until = 0;
  /** Homing turn rate (rad/s) and the fighter it homes in on (−1 none). */
  homing = 0;
  target = -1;
  /** Wall bounces left; foes it still bounces between (bit per slot, `bounceFoes`). */
  bounces = 0;
  foes = 0;
  /** 0: one way; 1: outbound, 2: back to its owner (returning hammer, spear, thrown shield, returning orb or blade). */
  ret = 0;
  /** Outbound distance left (px) before it turns back. */
  range = 0;
  /** The weapon (−1: an ability) and the volley (one trigger: its pellets share the foe's invulnerability window). */
  weapon = -1;
  volley = 0;
  /** Fighters hit on this pass (bit per slot). */
  hitMask = 0;
  unblockable = false;
  /** Explodes (radius, px) where it hits. */
  explode = 0;
  slow = 0;
  slowSec = 0;
  freeze = 0;
  pull = false;
  /** A giant hit carried by the shot (× damage; 0 none) and its knockback / freeze. */
  giant = 0;
  giantKb = 0;
  giantFreeze = 0;
  /** Katarina's blink: the owner teleports where it lands. */
  blink = false;
  /** Drawing: spin angle. */
  spin = 0;
  born = 0;
}

/** A decoy (absorbs hits; may freeze who touches it) or a summon (an allied ball that hits on contact). */
export class FlMinion {
  active = false;
  summon = false;
  owner = 0;
  team = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 4;
  until = 0;
  born = 0;
  hp = 1;
  damage = 0;
  freezeOnTouch = 0;
  shape: FlShape = "clone";
  color = "#fff";
}

/** A ray: an ability beam (ticks on the foe's invulnerability window) or a weapon's thin beam (one hit per foe). */
export class FlBeam {
  active = false;
  owner = 0;
  team = 0;
  until = 0;
  born = 0;
  angle = 0;
  /** Thickness (px) and damage per hit. */
  width = 0;
  damage = 0;
  ability = false;
  /** The weapon that fired it (−1: an ability). */
  weapon = -1;
  hitMask = 0;
  color = "#fff";
  /** The ray's ends this sub-step (drawing). */
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
}

/** A scheduled effect: a fused shockwave (TNT), the next blink of a blink strike, an arena cut landing. */
export class FlTask {
  active = false;
  kind: "shock" | "blink" | "cut" = "shock";
  owner = 0;
  at = 0;
  x = 0;
  y = 0;
  x2 = 0;
  y2 = 0;
  n = 0;
  interval = 0;
  damage = 0;
  radius = 0;
  kb = 0;
  pin = false;
  spin = false;
  born = 0;
}

/** Render events (visual only): what the canvas animates for a moment. */
export const EV_DAMAGE = 1;
export const EV_HIT = 2;
export const EV_BLOCK = 3;
export const EV_KO = 4;
export const EV_LIGHTNING = 5;
export const EV_SHOCK = 6;
export const EV_CUT = 7;
export const EV_BLINK = 8;
export const EV_CAST = 9;
export const EV_HEAL = 10;
export const EV_POP = 11;
export const EV_FREEZE = 12;

export class FlEvent {
  kind = 0;
  t = -Infinity;
  x = 0;
  y = 0;
  x2 = 0;
  y2 = 0;
  value = 0;
  slot = -1;
  color = "#fff";
}

/** What the canvas, the HUD, the data attributes and the tests read; the same object every call (its arrays are replaced on a restart). */
export interface FightLeagueView {
  /** Bumped on every restart, so renderers drop per-run caches. */
  generation: number;
  settings: FightLeagueSettings;
  field: FlField | null;
  match: FlMatch;
  teamCount: number;
  fighters: FlFighter[];
  projectiles: FlProjectile[];
  minions: FlMinion[];
  beams: FlBeam[];
  tasks: FlTask[];
  events: FlEvent[];
  /** Events written so far (the ring's newest is at (eventSerial − 1) % FL_EVENT_CAP). */
  eventSerial: number;
  /** Simulation ms of the latest step, and when the fighters launch. */
  timeMs: number;
  introMs: number;
  /** Bullet time: until (ms), the side that keeps full speed, the factor of the others. */
  slowTimeUntil: number;
  slowTimeTeam: number;
  slowTimeFactor: number;
  finished: boolean;
  finishMs: number;
  /** The winning side (a slot in 1v1 / free-for-all, a team in 2v2), −1 for a draw. */
  winnerTeam: number;
  /** Two sides went down together. */
  doubleKo: boolean;
  /** Decided at the time cap. */
  byTime: boolean;
  /** The forced winner in effect (a side), −1 off; lethal hits it absorbed. */
  forcedWinner: number;
  rigAbsorbed: number;
  /** Counters (the HUD, the data attributes and the tests). */
  hits: number;
  blocks: number;
  casts: number;
  kos: number;
  shots: number;
  /** Body-to-body impacts. */
  clashes: number;
  wallHits: number;
  notes: number;
  sounds: number;
  lastHitMs: number;
}

function createView(): FightLeagueView {
  return {
    generation: 0,
    settings: DEFAULT_FIGHT_LEAGUE_SETTINGS,
    field: null,
    match: "1v1",
    teamCount: 2,
    fighters: [],
    projectiles: Array.from({ length: FL_PROJECTILE_CAP }, () => new FlProjectile()),
    minions: Array.from({ length: FL_MINION_CAP }, () => new FlMinion()),
    beams: Array.from({ length: FL_BEAM_CAP }, () => new FlBeam()),
    tasks: Array.from({ length: FL_TASK_CAP }, () => new FlTask()),
    events: Array.from({ length: FL_EVENT_CAP }, () => new FlEvent()),
    eventSerial: 0,
    timeMs: 0,
    introMs: FL_INTRO_MS,
    slowTimeUntil: -Infinity,
    slowTimeTeam: -1,
    slowTimeFactor: 1,
    finished: false,
    finishMs: -Infinity,
    winnerTeam: -1,
    doubleKo: false,
    byTime: false,
    forcedWinner: -1,
    rigAbsorbed: 0,
    hits: 0,
    blocks: 0,
    casts: 0,
    kos: 0,
    shots: 0,
    clashes: 0,
    wallHits: 0,
    notes: 0,
    sounds: 0,
    lastHitMs: 0,
  };
}

/** The forced winner of a run: the rigged side when it plays, else −1. */
export function fightForcedWinner(forcedWinner: number | undefined, teams: number): number {
  const w = forcedWinner ?? -1;
  return Number.isInteger(w) && w >= 0 && w < teams ? w : -1;
}

/* ------------------------------------------------------------------ notes */

const PENTATONIC = [0, 2, 4, 7, 9];
/** Pitch of fighter `slot`'s hits (its own degree of C major pentatonic from C4; the ToneGenerator snaps it to the scale). */
export function fighterPitch(slot: number): number {
  const d = 3 * slot + 2;
  return midiToFrequency(60 + 12 * Math.floor(d / 5) + PENTATONIC[d % 5]);
}
/** The four walls play C5 E5 G5 C6 (the circle's octants climb the pentatonic scale). */
function wallNote(kind: FlArena, wall: number): number {
  if (kind === "square") return [523.25, 659.25, 783.99, 1046.5][wall & 3];
  const d = wall & 7;
  return midiToFrequency(72 + 12 * Math.floor(d / 5) + PENTATONIC[d % 5]);
}
const WIN_CHORD: readonly number[] = [261.63, 329.63, 392, 523.25];

/** The per-frame sound budget: the strongest `FL_SOUNDS_PER_FRAME` fight sounds and wall notes of a frame. */
class FightSoundBudget {
  private readonly energy = new Float64Array(FL_SOUNDS_PER_FRAME);
  private readonly kind: (FlSoundKind | null)[] = new Array(FL_SOUNDS_PER_FRAME).fill(null);
  private readonly freq = new Float64Array(FL_SOUNDS_PER_FRAME);
  private readonly level = new Float64Array(FL_SOUNDS_PER_FRAME);
  private count = 0;

  clear() {
    this.count = 0;
  }

  /** `kind` null: a wall note (a plain hit, a note of the tune). */
  offer(energy: number, kind: FlSoundKind | null, frequency: number, level: number) {
    let slot = this.count;
    if (slot >= FL_SOUNDS_PER_FRAME) {
      slot = 0;
      for (let i = 1; i < FL_SOUNDS_PER_FRAME; i++) if (this.energy[i] < this.energy[slot]) slot = i;
      if (!(energy > this.energy[slot])) return;
    } else this.count++;
    this.energy[slot] = energy;
    this.kind[slot] = kind;
    this.freq[slot] = frequency;
    this.level[slot] = level;
  }

  flush(push: (kind: FlSoundKind | null, frequency: number, level: number) => void): number {
    const n = this.count;
    for (let i = 0; i < n; i++) push(this.kind[i], this.freq[i], this.level[i]);
    this.count = 0;
    return n;
  }
}

/* ------------------------------------------------------------------ the mode */

const DEG = Math.PI / 180;
const tmpShape: MeleeShape = { ax: 0, ay: 0, bx: 0, by: 0, half: 0 };
const tmpSteer = { vx: 0, vy: 0 };

export class FightLeagueMode implements GameMode {
  readonly name = "fightLeague";
  /** The mode keeps the fighters at their cruising speeds itself (no engine boost). */
  readonly ballsMayRest = true;
  /** The mode resolves the fighters' bodies itself. */
  readonly ballsPassThrough = true;
  private settings: FightLeagueSettings = resolveFightLeagueSettings(null);
  private readonly view: FightLeagueView = createView();
  private byIndex: (Ball | null)[] = [];
  /** px per arena side × the Ball Speed: the speed unit. */
  private unit = 1;
  private ballRadius = 8;
  private stepStartMs = 0;
  private subIndex = 0;
  private subDt = 1 / 240;
  private koThisStep = false;
  private graceUntil = -1;
  private volleySerial = 0;
  private readonly budget = new FightSoundBudget();
  private readonly urgent: SoundEvent[] = [];
  private rigK = 0;
  private rigChosen = -1;
  /** The engine's context (the same object for the engine's life): the run's random numbers. */
  private ctxRef: ModeContext | null = null;
  /** Scratch (no allocation per step): a target's position and motion for the weapons and for the rebounds' nudge, the rig's sums. */
  private readonly tgtW = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
  private readonly tgtN = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
  private readonly rival = new Float64Array(4);
  private readonly rivalMax = new Float64Array(4);
  private readonly capHp: number[] = [];
  private readonly capTeam: number[] = [];
  private readonly capSums: number[] = [0, 0, 0, 0];

  getSettings(): FightLeagueSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator restarts the fight when one changes); the HUD at once. */
  setSettings(patch: Partial<FightLeagueSettings>) {
    this.settings = resolveFightLeagueSettings({ ...this.settings, ...patch });
    this.view.settings = { ...this.view.settings, hud: this.settings.hud };
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): FightLeagueView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    let alive = 0;
    for (const f of v.fighters) if (f.alive) alive++;
    return { fighters: v.fighters.length, alive, hits: v.hits, casts: v.casts, kos: v.kos, finished: v.finished, winner: v.winnerTeam, doubleKo: v.doubleKo, byTime: v.byTime, time: v.timeMs };
  }

  /* ---------------------------------------------------------------- init */

  init(ctx: ModeContext) {
    this.ctxRef = ctx;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.generation++;
    v.settings = s;
    v.match = s.match;
    v.teamCount = matchTeams(s.match);
    const field = buildFightField(ctx.config.width, ctx.config.height, s.arena);
    v.field = field;
    v.timeMs = 0;
    v.introMs = FL_INTRO_MS;
    v.slowTimeUntil = -Infinity;
    v.slowTimeTeam = -1;
    v.slowTimeFactor = 1;
    v.finished = false;
    v.finishMs = -Infinity;
    v.winnerTeam = -1;
    v.doubleKo = false;
    v.byTime = false;
    v.forcedWinner = fightForcedWinner(ctx.config.forcedWinner, v.teamCount);
    v.rigAbsorbed = 0;
    v.hits = v.blocks = v.casts = v.kos = v.shots = v.clashes = v.wallHits = v.notes = v.sounds = 0;
    v.lastHitMs = 0;
    v.eventSerial = 0;
    for (const p of v.projectiles) p.active = false;
    for (const m of v.minions) m.active = false;
    for (const b of v.beams) b.active = false;
    for (const t of v.tasks) t.active = false;
    for (const e of v.events) e.t = -Infinity;
    this.koThisStep = false;
    this.graceUntil = -1;
    this.volleySerial = 0;
    this.budget.clear();
    this.urgent.length = 0;
    this.rigK = 0;
    this.rigChosen = v.forcedWinner;
    this.ballRadius = ctx.config.ballRadius || 8;
    this.unit = this.speedUnit(ctx);

    const rows = pickFighters(s, () => ctx.random());
    const n = rows.length;
    const firstId = ctx.getNextId();
    const r0 = FL_BALL_FRAC * field.side * Math.max(0.25, this.ballRadius / 8);
    const spots = spawnSpots(s.match, n);
    v.fighters = [];
    this.byIndex = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const row = rows[i];
      const f = new FlFighter(i, slotTeam(s.match, i), row);
      f.maxHp = Math.max(1, (s.hp * row.stats.hp) / 100);
      f.hp = f.maxHp;
      f.speed = row.stats.speed * s.speed[i];
      f.attack = row.stats.attackSpeed * s.attack[i];
      f.damage = row.stats.damage * s.damage[i];
      f.cast = row.stats.castSpeed * s.cast[i];
      f.r = r0 * row.stats.size;
      // A spot of the formation, jittered a little by the seed, and a launch heading away from the axes.
      const jx = (ctx.random() - 0.5) * 0.08 * field.side;
      const jy = (ctx.random() - 0.5) * 0.08 * field.side;
      const room = field.half - f.r - 2;
      const sx = spots[2 * i] * 0.62 * field.half + jx;
      const sy = spots[2 * i + 1] * 0.62 * field.half + jy;
      f.x = field.cx + Math.max(-room, Math.min(room, sx));
      f.y = field.cy + Math.max(-room, Math.min(room, sy));
      const heading = offAxisAngle(ctx.random(), ctx.random());
      f.keptVx = Math.cos(heading);
      f.keptVy = Math.sin(heading);
      f.kept = true;
      f.aim = Math.atan2(field.cy - f.y, field.cx - f.x);
      for (const w of f.weapons) {
        w.angle = f.aim;
        w.cd = 0.3 + 0.4 * w.index;
        w.throwCd = w.spec.throwEvery > 0 ? 0.6 * w.spec.throwEvery : 0;
        w.loaded = w.spec.kind === "cards" ? w.spec.count : 0;
        w.orbit = f.aim;
      }
      f.ballId = firstId + i;
      v.fighters.push(f);
      ctx.addBall({ x: f.x, y: f.y, vx: 0, vy: 0, radius: f.r, color: row.body, team: f.team, radiusScale: f.r / this.ballRadius });
    }
    this.indexBalls(ctx);
  }

  /** Cruising speed unit (px/s): the arena side × FL_SPEED_FRAC × Ball Speed / 400. */
  private speedUnit(ctx: ModeContext): number {
    const field = this.view.field;
    return field ? field.side * FL_SPEED_FRAC * ((ctx.config.ballSpeed || 400) / 400) : 1;
  }

  private indexBalls(ctx: ModeContext) {
    const by = this.byIndex;
    by.fill(null);
    const fighters = this.view.fighters;
    for (const ball of ctx.getBalls()) {
      for (let i = 0; i < fighters.length; i++) {
        if (fighters[i].ballId === ball.id) {
          by[i] = ball;
          break;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- helpers */

  private now(): number {
    return this.stepStartMs + this.subIndex * this.subDt * 1000;
  }

  /** The time scale of `team`'s side (bullet time slows everyone but the caster's side). */
  private timeScale(team: number, now: number): number {
    const v = this.view;
    return now < v.slowTimeUntil && team !== v.slowTimeTeam ? v.slowTimeFactor : 1;
  }

  private canAct(f: FlFighter, now: number): boolean {
    return f.alive && now >= this.view.introMs && now >= f.frozenUntil && f.heldBy < 0 && !this.view.finished;
  }

  private targetable(f: FlFighter, now: number): boolean {
    return f.alive && f.hp > 0 && now >= f.untargetableUntil;
  }

  /** The nearest live, targetable foe of `f` (or an enemy decoy): writes f.targetSlot / f.targetMinion. */
  private pickTarget(f: FlFighter, now: number) {
    const v = this.view;
    let best = Infinity;
    f.targetSlot = -1;
    f.targetMinion = -1;
    for (const o of v.fighters) {
      if (o.team === f.team || !this.targetable(o, now)) continue;
      const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2;
      if (d < best) {
        best = d;
        f.targetSlot = o.slot;
      }
    }
    for (let i = 0; i < v.minions.length; i++) {
      const m = v.minions[i];
      if (!m.active || m.summon || m.team === f.team) continue;
      const d = (m.x - f.x) ** 2 + (m.y - f.y) ** 2;
      if (d < best) {
        best = d;
        f.targetSlot = -1;
        f.targetMinion = i;
      }
    }
  }

  /** Position, velocity and radius of `f`'s target into `out`; false without one. */
  private targetOf(f: FlFighter, out: { x: number; y: number; vx: number; vy: number; r: number }): boolean {
    if (f.targetSlot >= 0) {
      const o = this.view.fighters[f.targetSlot];
      out.x = o.x;
      out.y = o.y;
      out.vx = o.vx;
      out.vy = o.vy;
      out.r = o.r;
      return true;
    }
    if (f.targetMinion >= 0) {
      const m = this.view.minions[f.targetMinion];
      if (!m.active) return false;
      out.x = m.x;
      out.y = m.y;
      out.vx = m.vx;
      out.vy = m.vy;
      out.r = m.r;
      return true;
    }
    return false;
  }

  private pushEvent(kind: number, t: number, x: number, y: number, value = 0, slot = -1, color = "#fff", x2 = 0, y2 = 0) {
    const v = this.view;
    const e = v.events[v.eventSerial % FL_EVENT_CAP];
    v.eventSerial++;
    e.kind = kind;
    e.t = t;
    e.x = x;
    e.y = y;
    e.x2 = x2;
    e.y2 = y2;
    e.value = value;
    e.slot = slot;
    e.color = color;
  }

  /** Sounds that always play (abilities, KOs): queued with the frame's budgeted ones. */
  private urgentSound(kind: FlSoundKind, frequency: number, level: number) {
    if (this.urgent.length < 8) this.urgent.push({ type: "hit", wallIndex: 0, frequency, level, melody: false, fight: kind });
  }

  private freeProjectile(): FlProjectile | null {
    for (const p of this.view.projectiles) if (!p.active) return p;
    return null;
  }

  private freeMinion(): FlMinion | null {
    for (const m of this.view.minions) if (!m.active) return m;
    return null;
  }

  private freeTask(): FlTask | null {
    for (const t of this.view.tasks) if (!t.active) return t;
    return null;
  }

  private freeBeam(): FlBeam | null {
    for (const b of this.view.beams) if (!b.active) return b;
    return null;
  }

  /* ---------------------------------------------------------------- the rig */

  /**
   * The rig's steering strength this step (0–1): 0.3, rising to 1 the further the chosen side trails the best rival in HP
   * share – its hits then land more and the rivals' less.
   */
  private updateRig() {
    const chosen = this.rigChosen;
    if (chosen < 0) {
      this.rigK = 0;
      return;
    }
    let mine = 0;
    let mineMax = 0;
    const rival = this.rival;
    const rivalMax = this.rivalMax;
    rival.fill(0);
    rivalMax.fill(0);
    for (const f of this.view.fighters) {
      if (f.team === chosen) {
        mine += Math.max(0, f.hp);
        mineMax += f.maxHp;
      } else {
        rival[f.team] += Math.max(0, f.hp);
        rivalMax[f.team] += f.maxHp;
      }
    }
    let best = 0;
    for (let t = 0; t < 4; t++) if (rivalMax[t] > 0) best = Math.max(best, rival[t] / rivalMax[t]);
    const share = mineMax > 0 ? mine / mineMax : 0;
    const behind = Math.max(0, Math.min(1, (best - share + 0.1) / 0.5));
    this.rigK = 0.3 + 0.7 * behind;
  }

  /** Melee reach factor of `team` under the rig. */
  private reachOf(team: number): number {
    if (this.rigChosen < 0) return 1;
    return team === this.rigChosen ? 1 + 0.16 * this.rigK : 1 - 0.12 * this.rigK;
  }

  /* ---------------------------------------------------------------- step */

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    this.ctxRef = ctx;
    const v = this.view;
    const now = ctx.getElapsedMs();
    this.stepStartMs = now - dtMs;
    this.subIndex = 0;
    v.timeMs = now;
    this.koThisStep = false;
    const field = v.field;
    if (!field) return;
    this.indexBalls(ctx);
    this.unit = this.speedUnit(ctx);
    this.updateRig();
    const dt = dtMs / 1000;
    const started = now >= v.introMs;
    for (const f of v.fighters) {
      const ball = this.byIndex[f.slot];
      if (!f.alive || !ball) continue;
      f.r = ball.radius;
      f.x = ball.x;
      f.y = ball.y;
      if (!v.finished) this.pickTarget(f, now);
      // Statuses that run per step: heals, chokes ticking, the ability meter and its telegraph.
      if (now < f.healUntil && f.healRate > 0) f.hp = Math.min(f.maxHp, f.hp + f.healRate * dt);
      if (f.heldBy >= 0) this.stepHold(ctx, f, now);
      if (started && !v.finished) this.stepAbility(ctx, f, now, dt);
      this.steer(f, ball, now, started);
    }
    this.stepTasks(ctx, now);
  }

  /** The fighter's velocity this step: launch, freeze, holds, pulls, then the speed relaxing toward its cruising speed. */
  private steer(f: FlFighter, ball: Ball, now: number, started: boolean) {
    const ts = this.timeScale(f.team, now);
    let cruise = this.unit * f.speed * ts;
    if (now < f.speedMulUntil) cruise *= f.speedMul;
    if (now < f.slowUntil) cruise *= f.slowFactor;
    if (now < f.confusedUntil) cruise *= 0.6;
    f.cruise = cruise;
    const frozen = !started || now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil;
    if (frozen) {
      if (!f.kept) {
        const s = Math.hypot(ball.vx, ball.vy);
        f.keptVx = s > 1e-6 ? ball.vx / s : 1;
        f.keptVy = s > 1e-6 ? ball.vy / s : 0;
        f.kept = true;
      }
      ball.vx = 0;
      ball.vy = 0;
      f.vx = f.vy = 0;
      return;
    }
    if (f.kept) {
      ball.vx = f.keptVx * cruise;
      ball.vy = f.keptVy * cruise;
      f.kept = false;
    }
    if (now < f.pullUntil && f.pullBy >= 0) {
      const by = this.view.fighters[f.pullBy];
      const dx = by.x - f.x;
      const dy = by.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > f.r + by.r + 2) {
        ball.vx = (dx / d) * f.pullSpeed;
        ball.vy = (dy / d) * f.pullSpeed;
        f.vx = ball.vx;
        f.vy = ball.vy;
        return;
      }
      f.pullUntil = -Infinity;
    }
    const s = Math.hypot(ball.vx, ball.vy);
    if (s < 1e-6) {
      const a = Math.atan2(this.view.field!.cy - f.y, this.view.field!.cx - f.x) + 0.7;
      ball.vx = Math.cos(a) * cruise;
      ball.vy = Math.sin(a) * cruise;
    } else {
      const next = Math.min(FL_SPEED_CAP * Math.max(cruise, 1), s + (cruise - s) * FL_SPEED_RELAX);
      ball.vx *= next / s;
      ball.vy *= next / s;
    }
    f.vx = ball.vx;
    f.vy = ball.vy;
  }

  /** A choke's hold: the held fighter stays put; damage over the hold or at its end (a slam). */
  private stepHold(ctx: ModeContext, f: FlFighter, now: number) {
    const by = this.view.fighters[f.heldBy];
    if (now >= f.heldUntil || !by || !by.alive) {
      if (f.holdMode === "end" && f.holdDamage > 0 && by) {
        // The slam: the damage and a knock toward the nearest wall.
        const field = this.view.field!;
        const dx = f.x - field.cx;
        const dy = f.y - field.cy;
        const d = Math.hypot(dx, dy) || 1;
        this.hit(ctx, by, f, f.holdDamage, dx / d, dy / d, 2.5, "magic", { unblockable: true, ignoreIframes: true });
      }
      f.heldBy = -1;
      f.holdDamage = 0;
      return;
    }
    if (f.holdMode === "over" && f.holdDamage > 0 && now >= f.holdTickMs) {
      const ticks = Math.max(1, Math.round((f.heldUntil - f.holdTickMs) / 400));
      const part = f.holdDamage / ticks;
      f.holdDamage -= part;
      f.holdTickMs = now + 400;
      this.hit(ctx, by, f, part, 0, 0, 0, "magic", { unblockable: true, ignoreIframes: true });
    }
  }

  /** The ability meter: charge, telegraph, cast. */
  private stepAbility(ctx: ModeContext, f: FlFighter, now: number, dt: number) {
    if (now < f.frozenUntil || f.heldBy >= 0) return;
    const ability = f.row.ability;
    if (f.telegraphUntil >= 0) {
      if (now >= f.telegraphUntil) {
        f.telegraphUntil = -1;
        f.meter = 0;
        f.casts++;
        this.view.casts++;
        this.pushEvent(EV_CAST, now, f.x, f.y, 0, f.slot, f.row.accent);
        for (const effect of ability.effects) this.castEffect(ctx, f, effect, now);
      }
      return;
    }
    f.meter = meterAfter(f.meter, dt * this.timeScale(f.team, now), f.cast, ability.charge);
    if (f.meter >= 1 && (f.targetSlot >= 0 || f.targetMinion >= 0)) {
      f.telegraphUntil = now + FL_TELEGRAPH_MS;
      this.urgentSound("ability", fighterPitch(f.slot), 0.8);
    }
  }

  /** The engine moved a fighter: keep it in the arena, mirror its state; a real wall hit is a note, a sweep and a nudge. */
  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    this.subDt = dtSec;
    const v = this.view;
    const field = v.field;
    if (!field) return;
    const i = this.slotOfBall(ball);
    if (i < 0) return;
    const f = v.fighters[i];
    if (!f.alive) return;
    const now = this.now() + dtSec * 1000;
    // Held still: the intro, a freeze, a hold, a pin (gravity or a push must not move it).
    if (now < v.introMs || now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil) {
      ball.x = f.x;
      ball.y = f.y;
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    const wall = this.wallPass(ctx, ball);
    f.x = ball.x;
    f.y = ball.y;
    f.vx = ball.vx;
    f.vy = ball.vy;
    if (wall < 0) return;
    ctx.noteBounce?.(ball); // --- bounce-math --- a wall hit is a bounce
    v.wallHits++;
    this.budget.offer(0.2, null, wallNote(field.kind, wall), 0.22);
    for (const w of f.weapons) if (w.spec.kind === "sword") this.startSweep(f, w);
    if (!v.finished) this.nudge(f, ball, now);
  }

  private slotOfBall(ball: Ball): number {
    const by = this.byIndex;
    for (let i = 0; i < by.length; i++) if (by[i] === ball) return i;
    return -1;
  }

  /** Keeps a ball inside the arena (elastic, × the wall-bounciness extra); returns the wall it moved into (−1 none). */
  private wallPass(ctx: ModeContext, ball: Ball): number {
    const field = this.view.field!;
    const e = ctx.getPhysicsExtras().wallBounciness;
    const r = ball.radius;
    if (field.kind === "circle") {
      const dx = ball.x - field.cx;
      const dy = ball.y - field.cy;
      const lim = Math.max(1, field.half - r);
      const d = Math.hypot(dx, dy);
      if (d <= lim) return -1;
      const nx = dx / d;
      const ny = dy / d;
      ball.x = field.cx + nx * lim;
      ball.y = field.cy + ny * lim;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn <= 0) return -1;
      ball.vx -= (1 + e) * vn * nx;
      ball.vy -= (1 + e) * vn * ny;
      let a = Math.atan2(ny, nx);
      if (a < 0) a += TWO_PI;
      return Math.min(7, Math.floor((a / TWO_PI) * 8));
    }
    let wall = -1;
    const lo = field.cx - field.half + r;
    const hi = field.cx + field.half - r;
    const top = field.cy - field.half + r;
    const bottom = field.cy + field.half - r;
    if (ball.x < lo) {
      ball.x = lo;
      if (ball.vx < 0) {
        ball.vx = -ball.vx * e;
        wall = 3;
      }
    } else if (ball.x > hi) {
      ball.x = hi;
      if (ball.vx > 0) {
        ball.vx = -ball.vx * e;
        wall = 1;
      }
    }
    if (ball.y < top) {
      ball.y = top;
      if (ball.vy < 0) {
        ball.vy = -ball.vy * e;
        wall = 0;
      }
    } else if (ball.y > bottom) {
      ball.y = bottom;
      if (ball.vy > 0) {
        ball.vy = -ball.vy * e;
        wall = 2;
      }
    }
    return wall;
  }

  /** The director turns a rebound toward the nearest foe (full strength after a stalemate; more for the rigged side). */
  private nudge(f: FlFighter, ball: Ball, now: number) {
    if (f.targetSlot < 0 && f.targetMinion < 0) return;
    const t = this.tgtN;
    if (!this.targetOf(f, t)) return;
    let strength = now - this.view.lastHitMs >= FL_STALEMATE_MS ? 1 : FL_NUDGE;
    if (this.rigChosen >= 0 && f.team === this.rigChosen) strength = Math.min(1.4, strength + 0.6 * this.rigK);
    const field = this.view.field!;
    let nx = 0;
    let ny = 0;
    if (field.kind === "circle") {
      const d = Math.hypot(ball.x - field.cx, ball.y - field.cy) || 1;
      nx = (field.cx - ball.x) / d;
      ny = (field.cy - ball.y) / d;
    } else {
      if (ball.x <= field.cx - field.half + ball.radius + 0.5) nx = 1;
      else if (ball.x >= field.cx + field.half - ball.radius - 0.5) nx = -1;
      if (ball.y <= field.cy - field.half + ball.radius + 0.5) ny = 1;
      else if (ball.y >= field.cy + field.half - ball.radius - 0.5) ny = -1;
    }
    steerToward(ball.vx, ball.vy, t.x - ball.x, t.y - ball.y, strength * MAX_NUDGE, nx, ny, tmpSteer);
    ball.vx = tmpSteer.vx;
    ball.vy = tmpSteer.vy;
  }

  /**
   * A bounce starts a sword's sweep: a 120° arc centred on the nearest foe when it is within the blade's reach (the blade
   * swings at it), else on the blade's own direction; every other sweep turns the other way.
   */
  private startSweep(f: FlFighter, w: FlWeaponState) {
    const dur = Math.max(0.08, w.spec.cooldown / Math.max(0.05, this.attackOf(f, this.now())));
    if (w.sweepT > 0.5 * dur) return;
    let centre = w.angle;
    if (f.targetSlot >= 0) {
      const t = this.view.fighters[f.targetSlot];
      const reach = f.r + (w.spec.reach + 0.5) * f.r + t.r;
      if ((t.x - f.x) ** 2 + (t.y - f.y) ** 2 <= reach * reach) centre = Math.atan2(t.y - f.y, t.x - f.x);
    }
    w.sweepT = dur;
    w.sweepDir = -w.sweepDir;
    w.sweepFrom = centre - 0.5 * FL_SWEEP_DEG * DEG * w.sweepDir;
    w.angle = w.sweepFrom;
    w.touchMask = 0;
    w.minionMask = 0;
  }

  private attackOf(f: FlFighter, now: number): number {
    let a = f.attack * this.timeScale(f.team, now);
    if (now < f.atkMulUntil) a *= f.atkMul;
    return Math.max(0.05, a);
  }

  /** Every sub-step: bodies, weapons, projectiles, minions, beams, rings. */
  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    const field = v.field;
    this.subIndex++;
    if (!field) return;
    const now = this.now();
    const dt = this.subDt;
    this.collideBodies(ctx, now);
    if (now >= v.introMs) {
      for (const f of v.fighters) if (f.alive) this.stepWeapons(ctx, f, now, dt);
      this.stepFireRings(ctx, now);
      this.stepContact(ctx, now);
    }
    this.stepProjectiles(ctx, now, dt);
    this.stepMinions(ctx, now, dt);
    this.stepBeams(ctx, now, dt);
  }

  /** Fighter bodies push apart and rebound elastically (masses ∝ radius²); a bounce starts the swords' sweeps. */
  private collideBodies(ctx: ModeContext, now: number) {
    const fs = this.view.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      const ba = this.byIndex[i];
      if (!a.alive || !ba) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        const bb = this.byIndex[j];
        if (!b.alive || !bb) continue;
        const dx = bb.x - ba.x;
        const dy = bb.y - ba.y;
        const reach = ba.radius + bb.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const nx = d2 > 0 ? dx / d : 1;
        const ny = d2 > 0 ? dy / d : 0;
        const ma = ba.radius * ba.radius;
        const mb = bb.radius * bb.radius;
        const pa = this.pinned(a, now);
        const pb = this.pinned(b, now);
        const pen = reach - d;
        const sa = pa ? 0 : pb ? 1 : mb / (ma + mb);
        const sb = pb ? 0 : pa ? 1 : ma / (ma + mb);
        ba.x -= nx * pen * sa;
        ba.y -= ny * pen * sa;
        bb.x += nx * pen * sb;
        bb.y += ny * pen * sb;
        const rel = (bb.vx - ba.vx) * nx + (bb.vy - ba.vy) * ny;
        if (rel < 0) {
          const inv = (pa ? 0 : 1 / ma) + (pb ? 0 : 1 / mb);
          if (inv > 0) {
            const j2 = (-2 * rel) / inv;
            if (!pa) {
              ba.vx -= (j2 / ma) * nx;
              ba.vy -= (j2 / ma) * ny;
            }
            if (!pb) {
              bb.vx += (j2 / mb) * nx;
              bb.vy += (j2 / mb) * ny;
            }
          }
          this.view.clashes++;
          ctx.noteCollide?.(ba, bb); // --- bounce-math --- a clash of bodies is a ball hit
          for (const w of a.weapons) if (w.spec.kind === "sword") this.startSweep(a, w);
          for (const w of b.weapons) if (w.spec.kind === "sword") this.startSweep(b, w);
        }
        this.wallPass(ctx, ba);
        this.wallPass(ctx, bb);
        a.x = ba.x;
        a.y = ba.y;
        b.x = bb.x;
        b.y = bb.y;
      }
    }
  }

  private pinned(f: FlFighter, now: number): boolean {
    return now < this.view.introMs || now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil;
  }

  /** Super Star's contact damage. */
  private stepContact(ctx: ModeContext, now: number) {
    const fs = this.view.fighters;
    for (const f of fs) {
      if (!f.alive || now >= f.contactUntil) continue;
      for (const o of fs) {
        if (o === f || !o.alive || o.team === f.team) continue;
        if (circlesTouch(f.x, f.y, f.r + 1, o.x, o.y, o.r)) {
          const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
          this.hit(ctx, f, o, f.contactDamage, (o.x - f.x) / d, (o.y - f.y) / d, 1.2, "blunt");
        }
      }
    }
  }

  /* ---------------------------------------------------------------- weapons */

  private stepWeapons(ctx: ModeContext, f: FlFighter, now: number, dt: number) {
    const acting = this.canAct(f, now);
    const atk = this.attackOf(f, now);
    const confused = now < f.confusedUntil;
    // The facing: toward the target (backwards while confused).
    const t = this.tgtW;
    const hasTarget = this.targetOf(f, t);
    if (hasTarget) {
      const want = Math.atan2(t.y - f.y, t.x - f.x) + (confused ? Math.PI : 0);
      f.aim = turnToward(f.aim, want, FL_AIM_TURN * dt);
    }
    const velAngle = Math.hypot(f.vx, f.vy) > 1e-3 ? Math.atan2(f.vy, f.vx) : f.aim;
    const disarmed = now < f.disarmedUntil;
    for (const w of f.weapons) {
      const s = w.spec;
      const reach = s.reach * this.reachOf(f.team);
      switch (s.kind) {
        case "sword": {
          // Along the velocity (turning to it), or sweeping its 120° arc after a bounce.
          if (w.sweepT > 0) {
            const dur = Math.max(0.08, s.cooldown / atk);
            w.sweepT = Math.max(0, w.sweepT - dt);
            const prog = 1 - w.sweepT / dur;
            w.angle = w.sweepFrom + w.sweepDir * FL_SWEEP_DEG * DEG * prog;
          } else w.angle = turnToward(w.angle, velAngle, 0.85 * FL_AIM_TURN * dt);
          if (!acting || disarmed) break;
          const blades = s.style === "double" ? 2 : 1;
          for (let k = 0; k < blades; k++) bladeShape(f.x, f.y, f.r, w.angle + k * Math.PI, reach, s.size, w.shapes[k]);
          this.meleeContact(ctx, f, w, blades, w.sweepT > 0 ? 1.25 : 1, now);
          break;
        }
        case "hammer":
        case "chain": {
          const period = Math.max(0.1, s.cooldown / atk);
          w.angle += (TWO_PI / period) * dt;
          if (w.angle > TWO_PI) w.angle -= TWO_PI;
          // A throw: the returning hammer and the pull chain's head fly at the target on their own cadence.
          if ((s.style === "returning" || s.style === "pull") && w.thrown < 0) {
            w.throwCd -= dt * atk;
            if (w.throwCd <= 0 && acting && !disarmed && hasTarget) {
              w.throwCd = s.throwEvery;
              this.throwWeapon(f, w, t, now);
            }
          }
          if (w.thrown >= 0 || !acting || disarmed) break;
          headShape(f.x, f.y, f.r, w.angle, reach, s.size, w.shapes[0]);
          let factor = 1;
          if (s.kind === "chain") {
            // Damage by momentum: the head's speed against the foe's, over the head's own speed at attack speed 1.
            const headSpeed = (TWO_PI / period) * (f.r + reach * f.r);
            const nominal = (TWO_PI / s.cooldown) * (f.r + s.reach * f.r);
            factor = Math.max(0.6, Math.min(1.8, headSpeed / Math.max(1, nominal)));
          }
          this.meleeContact(ctx, f, w, 1, factor, now);
          break;
        }
        case "tail": {
          const period = Math.max(0.1, s.cooldown / atk);
          w.phase += (TWO_PI / period) * dt;
          if (w.phase > TWO_PI) w.phase -= TWO_PI;
          w.angle = velAngle + Math.PI + 0.9 * Math.sin(w.phase);
          if (!acting || disarmed) break;
          bladeShape(f.x, f.y, f.r, w.angle, reach, s.size, w.shapes[0]);
          this.meleeContact(ctx, f, w, 1, 1, now);
          break;
        }
        case "fists":
        case "claws":
          this.stepPunch(ctx, f, w, now, dt, atk, hasTarget, t, reach, acting && !disarmed);
          break;
        case "shield": {
          // Held in front: it faces where the fighter is going (a charge is covered, a hit from behind is not).
          w.angle = turnToward(w.angle, velAngle, 0.85 * FL_AIM_TURN * dt);
          if (s.style === "block" || w.thrown >= 0) break;
          w.throwCd -= dt * atk;
          if (w.throwCd <= 0 && acting && !disarmed && hasTarget) {
            w.throwCd = s.throwEvery;
            this.throwWeapon(f, w, t, now);
          }
          break;
        }
        case "cards": {
          w.orbit += 3 * dt * this.timeScale(f.team, now);
          if (w.loaded < s.count) {
            w.reloadT += dt * atk;
            if (w.reloadT >= 1.25 * s.cooldown) {
              w.reloadT = 0;
              w.loaded++;
            }
          }
          if (!acting || disarmed) break;
          // Orbiting blades cut on contact.
          const blades = Math.min(w.loaded, w.shapes.length);
          for (let k = 0; k < blades; k++) headShape(f.x, f.y, f.r, w.orbit + (TWO_PI * k) / s.count, s.reach - 1, s.size, w.shapes[k]);
          this.meleeContact(ctx, f, w, blades, 0.6, now);
          w.cd -= dt * atk;
          if (w.cd <= 0 && w.loaded > 0 && hasTarget) {
            w.cd = s.cooldown;
            w.loaded--;
            this.fireCard(f, w, t, now);
          }
          break;
        }
        case "fire": {
          if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.cd <= 0 && acting && !disarmed && hasTarget) {
            w.cd = s.cooldown;
            w.onUntil = now + 800;
            this.budget.offer(0.5, "fire", fighterPitch(f.slot), 0.35);
          }
          if (now >= w.onUntil || !acting || disarmed) break;
          this.stepCone(ctx, f, w, now);
          break;
        }
        case "beam": {
          w.cd -= dt * atk;
          if (w.cd <= 0 && acting && !disarmed && hasTarget) {
            w.cd = s.cooldown;
            const b = this.freeBeam();
            if (b) {
              b.active = true;
              b.owner = f.slot;
              b.team = f.team;
              b.born = now;
              b.until = now + 350;
              b.angle = Math.atan2(t.y - f.y, t.x - f.x);
              b.width = Math.max(1.5, s.size * f.r);
              b.damage = s.damage;
              b.ability = false;
              b.weapon = w.index;
              b.hitMask = 0;
              b.color = s.color ?? f.row.accent;
              this.budget.offer(0.4, "magic", fighterPitch(f.slot) * 2, 0.3);
            }
          }
          break;
        }
        case "spark": {
          w.cd -= dt * atk;
          if (w.cd > 0 || !acting || disarmed || !hasTarget) break;
          const d = Math.hypot(t.x - f.x, t.y - f.y) - f.r - t.r;
          if (d > reach * f.r) break;
          w.cd = s.cooldown;
          w.zapMs = now;
          w.zapX = t.x;
          w.zapY = t.y;
          const dd = Math.hypot(t.x - f.x, t.y - f.y) || 1;
          this.hitTarget(ctx, f, s.damage, (t.x - f.x) / dd, (t.y - f.y) / dd, s.knockback, "magic", { weapon: w.index });
          break;
        }
        default: {
          // Shooters: bow, gun, shotgun, wand, staff, book, web, ice.
          if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.cd <= 0 && acting && !disarmed && hasTarget) {
            w.cd = s.cooldown * (s.style === "burst" ? 1 : 1);
            this.shoot(f, w, t, now);
          }
        }
      }
    }
  }

  /** A punch (fists) or a swipe (claws) toward a foe in reach. */
  private stepPunch(ctx: ModeContext, f: FlFighter, w: FlWeaponState, now: number, dt: number, atk: number, hasTarget: boolean, t: { x: number; y: number; r: number }, reach: number, acting: boolean) {
    const s = w.spec;
    w.cd -= dt * atk;
    if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
    const claws = s.kind === "claws";
    const sec = claws ? 0.12 : FL_PUNCH_SEC;
    if (w.punchT >= 0) {
      w.punchT += dt * Math.max(1, atk);
      if (w.punchT >= sec) w.punchT = -1;
    }
    if (w.punchT < 0 && w.cd <= 0 && acting && hasTarget) {
      const gap = Math.hypot(t.x - f.x, t.y - f.y) - f.r - t.r;
      if (gap <= reach * f.r + 0.15 * f.r) {
        w.cd = s.cooldown;
        w.punchT = 0;
        w.punchHit = false;
        w.punchSide = 1 - w.punchSide;
        w.punchAngle = Math.atan2(t.y - f.y, t.x - f.x) + (now < f.confusedUntil ? Math.PI : 0);
      }
    }
    if (w.punchT < 0 || w.punchHit || !acting) return;
    const ext = claws ? Math.min(1, w.punchT / 0.06) : punchExtension(w.punchT);
    fistShape(f.x, f.y, f.r, w.punchAngle, reach, s.size, ext, tmpShape);
    if (this.meleeOnce(ctx, f, w, tmpShape, now)) w.punchHit = true;
  }

  /**
   * The weapon's `n` melee shapes (w.shapes) against every foe and enemy minion: a foe is hit when the contact starts – one
   * touch is one hit (a new sweep may hit again) – on top of the foe's invulnerability window.
   */
  private meleeContact(ctx: ModeContext, f: FlFighter, w: FlWeaponState, n: number, factor: number, now: number) {
    const v = this.view;
    for (const o of v.fighters) {
      const bit = 1 << o.slot;
      if (!o.alive || o.team === f.team || o.hp <= 0) {
        w.touchMask &= ~bit;
        continue;
      }
      let touching = -1;
      for (let k = 0; k < n; k++) {
        if (shapeHitsCircle(w.shapes[k], o.x, o.y, o.r)) {
          touching = k;
          break;
        }
      }
      if (touching < 0) {
        w.touchMask &= ~bit;
        continue;
      }
      if (w.touchMask & bit) continue;
      w.touchMask |= bit;
      const sh = w.shapes[touching];
      const kx = o.x - f.x;
      const ky = o.y - f.y;
      const d = Math.hypot(kx, ky) || 1;
      this.hit(ctx, f, o, w.spec.damage * factor, kx / d, ky / d, w.spec.knockback, FL_SOUND_OF_KIND[w.spec.kind], { weapon: w.index, fromX: sh.bx, fromY: sh.by, melee: true });
    }
    for (let i = 0; i < v.minions.length; i++) {
      const m = v.minions[i];
      const bit = 1 << i;
      if (!m.active || m.team === f.team) {
        w.minionMask &= ~bit;
        continue;
      }
      let touching = false;
      for (let k = 0; k < n && !touching; k++) touching = shapeHitsCircle(w.shapes[k], m.x, m.y, m.r);
      if (!touching) {
        w.minionMask &= ~bit;
        continue;
      }
      if (w.minionMask & bit) continue;
      w.minionMask |= bit;
      this.hitMinion(ctx, f, m, now);
    }
  }

  /** A punch's fist: the first foe it touches takes the hit (true when one did). */
  private meleeOnce(ctx: ModeContext, f: FlFighter, w: FlWeaponState, shape: MeleeShape, now: number): boolean {
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team || o.hp <= 0) continue;
      if (!shapeHitsCircle(shape, o.x, o.y, o.r)) continue;
      const kx = o.x - f.x;
      const ky = o.y - f.y;
      const d = Math.hypot(kx, ky) || 1;
      this.hit(ctx, f, o, w.spec.damage, kx / d, ky / d, w.spec.knockback, FL_SOUND_OF_KIND[w.spec.kind], { weapon: w.index, fromX: shape.bx, fromY: shape.by, melee: true });
      return true;
    }
    return this.meleeMinions(ctx, f, shape, now);
  }

  /** Enemy decoys and summons a melee shape touches pop (true when one did). */
  private meleeMinions(ctx: ModeContext, f: FlFighter, shape: MeleeShape, now: number): boolean {
    let any = false;
    for (const m of this.view.minions) {
      if (!m.active || m.team === f.team) continue;
      if (!shapeHitsCircle(shape, m.x, m.y, m.r)) continue;
      this.hitMinion(ctx, f, m, now);
      any = true;
    }
    return any;
  }

  /** A breath cone: every foe inside burns (a tick per invulnerability window). */
  private stepCone(ctx: ModeContext, f: FlFighter, w: FlWeaponState, now: number) {
    const s = w.spec;
    const range = f.r + s.reach * this.reachOf(f.team) * f.r;
    const half = 0.5 * s.spread * DEG;
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team || o.hp <= 0) continue;
      if (!coneHitsCircle(f.x, f.y, w.angle, half, range, o.x, o.y, o.r)) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
      this.hit(ctx, f, o, s.damage, (o.x - f.x) / d, (o.y - f.y) / d, s.knockback, "fire", { weapon: w.index, quiet: true });
    }
    for (const m of this.view.minions) {
      if (!m.active || m.team === f.team) continue;
      if (coneHitsCircle(f.x, f.y, w.angle, half, range, m.x, m.y, m.r)) this.hitMinion(ctx, f, m, now);
    }
  }

  /** Fires a shooter's projectile(s) at the target (the bow, guns, wands, orbs, bolts, web, ice). */
  private shoot(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const s = w.spec;
    const field = this.view.field!;
    const speed = this.projectileSpeed(s.speed, field);
    // Lead the target a little: aim at where it will be half-way through the flight.
    const dist = Math.hypot(t.x - f.x, t.y - f.y);
    const lead = (0.5 * dist) / speed;
    let aim = Math.atan2(t.y + t.vy * lead - f.y, t.x + t.vx * lead - f.x);
    if (this.view.fighters.length > 0 && now < f.confusedUntil) aim += Math.PI;
    const count = s.kind === "shotgun" ? s.count : s.style === "burst" ? s.count : 1;
    const volley = ++this.volleySerial;
    let spread = s.spread;
    if (this.rigChosen >= 0 && f.team !== this.rigChosen) spread += 6 * this.rigK;
    for (let k = 0; k < count; k++) {
      const p = this.freeProjectile();
      if (!p) return;
      const jitter = (this.randomDraw() - 0.5) * spread * DEG;
      let a = aim + jitter;
      if (s.kind === "shotgun" && count > 1) a = aim + (k / (count - 1) - 0.5) * s.spread * DEG + 0.25 * jitter;
      const delay = s.style === "burst" ? k * 0.08 : 0;
      this.launch(p, f, PK_SHOT, a, speed, now, delay);
      p.weapon = w.index;
      p.volley = volley;
      p.r = Math.max(1.5, s.size * f.r);
      p.damage = s.damage;
      p.kb = s.knockback;
      p.shape = s.shape;
      p.color = s.color ?? f.row.accent;
      p.homing = Math.max(p.homing, s.homing);
      p.target = f.targetSlot;
      p.bounces = s.style === "bouncing" ? 1 : 0;
      if (s.kind === "shotgun") p.until = now + (1000 * s.reach * field.side) / speed;
      if (s.kind === "web") {
        p.slow = s.effect;
        p.slowSec = s.effectSec;
      }
      if (s.kind === "ice") p.freeze = s.effect;
      if (s.kind === "staff" && s.style === "return") {
        p.ret = 1;
        p.range = s.reach * field.side;
        p.until = now + 6000;
      }
      this.giantShot(f, p);
    }
    this.view.shots++;
    this.budget.offer(0.15, FL_SOUND_OF_KIND[s.kind], fighterPitch(f.slot) * 1.5, 0.18);
  }

  /** Cards: the next loaded blade flies at the target. */
  private fireCard(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const s = w.spec;
    const p = this.freeProjectile();
    if (!p) return;
    const field = this.view.field!;
    const speed = this.projectileSpeed(s.speed, field);
    const dist = Math.hypot(t.x - f.x, t.y - f.y);
    const lead = (0.5 * dist) / speed;
    let aim = Math.atan2(t.y + t.vy * lead - f.y, t.x + t.vx * lead - f.x);
    if (now < f.confusedUntil) aim += Math.PI;
    let spread = s.spread;
    if (this.rigChosen >= 0 && f.team !== this.rigChosen) spread += 6 * this.rigK;
    aim += (this.randomDraw() - 0.5) * spread * DEG;
    this.launch(p, f, PK_CARD, aim, speed, now, 0);
    p.weapon = w.index;
    p.volley = ++this.volleySerial;
    p.r = Math.max(1.5, s.size * f.r);
    p.damage = s.damage;
    p.kb = s.knockback;
    p.shape = s.shape;
    p.color = s.color ?? f.row.accent;
    p.target = f.targetSlot;
    w.throws++;
    p.blink = s.style === "blink" && w.throws % 3 === 0;
    this.giantShot(f, p);
    this.view.shots++;
    this.budget.offer(0.12, "blade", fighterPitch(f.slot) * 2, 0.15);
  }

  /** The returning hammer, the pull chain's head or the shield flies at the target. */
  private throwWeapon(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const s = w.spec;
    const p = this.freeProjectile();
    if (!p) return;
    const field = this.view.field!;
    const speed = this.projectileSpeed(s.speed, field);
    const aim = Math.atan2(t.y - f.y, t.x - f.x) + (now < f.confusedUntil ? Math.PI : 0);
    const kind = s.kind === "hammer" ? PK_HAMMER : s.kind === "shield" ? PK_SHIELD : PK_SPEAR;
    this.launch(p, f, kind, aim, speed, now, 0);
    p.weapon = w.index;
    p.volley = ++this.volleySerial;
    p.r = Math.max(2, (kind === PK_SPEAR ? 0.3 : s.size * 0.9) * f.r);
    p.damage = s.damage;
    p.kb = s.knockback;
    p.shape = kind === PK_HAMMER ? "hammer" : kind === PK_SHIELD ? "shield" : "spear";
    p.color = s.color ?? f.row.accent;
    p.ret = 1;
    p.range = (kind === PK_SHIELD ? 0.9 : 0.65) * field.side;
    p.bounces = kind === PK_SHIELD ? 1 : 0;
    p.pull = kind === PK_SPEAR;
    p.until = now + 8000;
    w.thrown = this.view.projectiles.indexOf(p);
    this.giantShot(f, p);
    this.budget.offer(0.2, FL_SOUND_OF_KIND[s.kind], fighterPitch(f.slot), 0.2);
  }

  private projectileSpeed(sidesPerSec: number, field: FlField): number {
    return Math.max(10, sidesPerSec * field.side * (this.unit / Math.max(1e-9, field.side * FL_SPEED_FRAC)));
  }

  /** A giant hit loaded on the owner travels with its next shot (and homes when it says so). */
  private giantShot(f: FlFighter, p: FlProjectile) {
    if (f.giantLeft <= 0) return;
    f.giantLeft--;
    p.giant = f.giantMult;
    p.giantKb = f.giantKb;
    p.giantFreeze = f.giantFreeze;
    if (f.giantHoming > 0) p.homing = Math.max(p.homing, f.giantHoming);
  }

  private launch(p: FlProjectile, f: FlFighter, kind: number, angle: number, speed: number, now: number, delaySec: number) {
    p.active = true;
    p.kind = kind;
    p.owner = f.slot;
    p.team = f.team;
    const start = f.r + 2;
    p.x = f.x + Math.cos(angle) * start - Math.cos(angle) * speed * delaySec;
    p.y = f.y + Math.sin(angle) * start - Math.sin(angle) * speed * delaySec;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.until = now + 6000;
    p.homing = 0;
    p.target = -1;
    p.bounces = 0;
    p.foes = 0;
    p.ret = 0;
    p.range = 0;
    p.hitMask = 0;
    p.unblockable = false;
    p.explode = 0;
    p.slow = 0;
    p.slowSec = 0;
    p.freeze = 0;
    p.pull = false;
    p.giant = 0;
    p.giantKb = 0;
    p.giantFreeze = 0;
    p.blink = false;
    p.spin = 0;
    p.born = now;
    if (this.rigChosen >= 0 && f.team === this.rigChosen) p.homing = 2.2 * this.rigK;
  }

  /** One draw of the run's random numbers (every shot's spread, cuts, minions' headings – in slot order). */
  private randomDraw(): number {
    return this.ctxRef ? this.ctxRef.random() : 0.5;
  }

  /* ---------------------------------------------------------------- projectiles */

  private stepProjectiles(ctx: ModeContext, now: number, dt: number) {
    const v = this.view;
    const field = v.field!;
    for (let i = 0; i < v.projectiles.length; i++) {
      const p = v.projectiles[i];
      if (!p.active) continue;
      const owner = v.fighters[p.owner];
      const ts = this.timeScale(p.team, now);
      const step = dt * ts;
      if (now >= p.until || !owner) {
        this.endProjectile(ctx, p, i, now);
        continue;
      }
      // Homing: toward its target (the nearest foe when it lost it); a returning one flies back to its owner.
      if (p.ret === 2) {
        const dx = owner.x - p.x;
        const dy = owner.y - p.y;
        const d = Math.hypot(dx, dy);
        const sp = Math.hypot(p.vx, p.vy);
        if (d <= owner.r + p.r || !owner.alive) {
          this.endProjectile(ctx, p, i, now);
          continue;
        }
        p.vx = (dx / d) * sp;
        p.vy = (dy / d) * sp;
      } else if (p.homing > 0) {
        let tgt = p.target >= 0 ? v.fighters[p.target] : null;
        if (!tgt || !this.targetable(tgt, now)) {
          tgt = null;
          let best = Infinity;
          for (const o of v.fighters) {
            if (o.team === p.team || !this.targetable(o, now)) continue;
            const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
            if (d < best) {
              best = d;
              tgt = o;
            }
          }
          p.target = tgt ? tgt.slot : -1;
        }
        if (tgt) {
          const sp = Math.hypot(p.vx, p.vy);
          const a = turnToward(Math.atan2(p.vy, p.vx), Math.atan2(tgt.y - p.y, tgt.x - p.x), p.homing * step);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp;
        }
      }
      const mx = p.vx * step;
      const my = p.vy * step;
      p.x += mx;
      p.y += my;
      p.spin += 14 * step;
      if (p.ret === 1) {
        p.range -= Math.hypot(mx, my);
        if (p.range <= 0) this.turnBack(p);
      }
      // Walls: a bouncing shot reflects (once), a returning weapon turns back, the rest end there.
      if (this.outside(field, p.x, p.y, p.r)) {
        if (p.bounces > 0) {
          p.bounces--;
          this.reflectProjectile(field, p);
          if (p.kind === PK_SHIELD) this.turnBack(p);
        } else if (p.ret === 1) {
          this.clampInside(field, p);
          this.turnBack(p);
        } else if (p.ret !== 2) {
          if (p.explode > 0) this.explode(ctx, p, now);
          this.endProjectile(ctx, p, i, now);
          continue;
        }
      }
      // Hits: foes (each once per pass) and enemy minions.
      for (const o of v.fighters) {
        if (!o.alive || o.team === p.team || o.hp <= 0) continue;
        const bit = 1 << o.slot;
        if (p.hitMask & bit) continue;
        if (!circlesTouch(p.x, p.y, p.r, o.x, o.y, o.r)) continue;
        p.hitMask |= bit;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const sound = p.kind === PK_HAMMER ? "blunt" : p.kind === PK_SHIELD || p.kind === PK_CARD ? "blade" : p.kind === PK_SPEAR ? "blunt" : p.weapon >= 0 ? FL_SOUND_OF_KIND[owner.weapons[p.weapon]?.spec.kind ?? "gun"] : "magic";
        const landed = this.hit(ctx, owner, o, p.damage, p.vx / sp, p.vy / sp, p.kb, sound, { weapon: p.weapon, volley: p.volley, fromX: p.x - (p.vx / sp) * 4 * p.r, fromY: p.y - (p.vy / sp) * 4 * p.r, unblockable: p.unblockable, projectile: p });
        if (landed && p.slow > 0) {
          o.slowUntil = now + 1000 * p.slowSec;
          o.slowFactor = p.slow;
        }
        if (landed && p.freeze > 0) {
          o.frozenUntil = Math.max(o.frozenUntil, now + 1000 * p.freeze);
          this.pushEvent(EV_FREEZE, now, o.x, o.y, p.freeze, o.slot, "#bae6fd");
        }
        if (landed && p.pull && owner.alive) {
          o.pullBy = owner.slot;
          o.pullUntil = now + 500;
          o.pullSpeed = 1.8 * this.unit;
        }
        if (p.explode > 0) {
          this.explode(ctx, p, now);
          this.endProjectile(ctx, p, i, now);
          break;
        }
        if (p.foes) {
          // Bounce on to the next foe it has not hit yet.
          p.foes &= ~bit;
          const next = this.nextFoe(p, o);
          if (next) {
            const a = Math.atan2(next.y - p.y, next.x - p.x);
            p.vx = Math.cos(a) * sp;
            p.vy = Math.sin(a) * sp;
            p.target = next.slot;
          } else this.turnBack(p);
          continue;
        }
        if (p.ret === 1) {
          this.turnBack(p);
          continue;
        }
        if (p.ret === 2) continue;
        this.endProjectile(ctx, p, i, now);
        break;
      }
      if (!p.active) continue;
      for (const m of v.minions) {
        if (!m.active || m.team === p.team) continue;
        if (!circlesTouch(p.x, p.y, p.r, m.x, m.y, m.r)) continue;
        this.hitMinion(ctx, owner, m, now);
        if (p.ret === 0 && !p.foes) {
          this.endProjectile(ctx, p, i, now);
          break;
        }
      }
    }
  }

  private nextFoe(p: FlProjectile, from: FlFighter): FlFighter | null {
    let best: FlFighter | null = null;
    let bestD = Infinity;
    for (const o of this.view.fighters) {
      if (!o.alive || o === from || o.team === p.team || !(p.foes & (1 << o.slot))) continue;
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private turnBack(p: FlProjectile) {
    if (p.ret === 0) p.ret = 1;
    p.ret = 2;
    p.hitMask = 0;
    p.foes = 0;
  }

  private outside(field: FlField, x: number, y: number, r: number): boolean {
    if (field.kind === "circle") return Math.hypot(x - field.cx, y - field.cy) > field.half - r;
    return x < field.cx - field.half + r || x > field.cx + field.half - r || y < field.cy - field.half + r || y > field.cy + field.half - r;
  }

  private clampInside(field: FlField, p: FlProjectile) {
    if (field.kind === "circle") {
      const dx = p.x - field.cx;
      const dy = p.y - field.cy;
      const d = Math.hypot(dx, dy) || 1;
      const lim = Math.max(0, field.half - p.r);
      if (d > lim) {
        p.x = field.cx + (dx / d) * lim;
        p.y = field.cy + (dy / d) * lim;
      }
      return;
    }
    p.x = Math.max(field.cx - field.half + p.r, Math.min(field.cx + field.half - p.r, p.x));
    p.y = Math.max(field.cy - field.half + p.r, Math.min(field.cy + field.half - p.r, p.y));
  }

  private reflectProjectile(field: FlField, p: FlProjectile) {
    if (field.kind === "circle") {
      const dx = p.x - field.cx;
      const dy = p.y - field.cy;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      const vn = p.vx * nx + p.vy * ny;
      if (vn > 0) {
        p.vx -= 2 * vn * nx;
        p.vy -= 2 * vn * ny;
      }
      this.clampInside(field, p);
      return;
    }
    if (p.x < field.cx - field.half + p.r || p.x > field.cx + field.half - p.r) p.vx = -p.vx;
    if (p.y < field.cy - field.half + p.r || p.y > field.cy + field.half - p.r) p.vy = -p.vy;
    this.clampInside(field, p);
  }

  /** A projectile ends: a thrown weapon comes back to its owner's hand; Katarina blinks to her dagger. */
  private endProjectile(ctx: ModeContext, p: FlProjectile, index: number, now: number) {
    const v = this.view;
    const owner = v.fighters[p.owner];
    if (p.blink && owner && owner.alive && this.canAct(owner, now)) this.blinkTo(ctx, owner, p.x, p.y, now, owner.weapons[p.weapon]?.spec.damage ?? 5);
    p.active = false;
    if (owner) for (const w of owner.weapons) if (w.thrown === index) w.thrown = -1;
  }

  /** Katarina's blink: to her dagger, a spin of blades around her. */
  private blinkTo(ctx: ModeContext, f: FlFighter, x: number, y: number, now: number, damage: number) {
    const ball = this.byIndex[f.slot];
    const field = this.view.field!;
    if (!ball) return;
    const lim = field.half - f.r - 1;
    let nx = x;
    let ny = y;
    if (field.kind === "circle") {
      const dx = nx - field.cx;
      const dy = ny - field.cy;
      const d = Math.hypot(dx, dy);
      if (d > lim) {
        nx = field.cx + (dx / d) * lim;
        ny = field.cy + (dy / d) * lim;
      }
    } else {
      nx = Math.max(field.cx - lim, Math.min(field.cx + lim, nx));
      ny = Math.max(field.cy - lim, Math.min(field.cy + lim, ny));
    }
    f.blinkMs = now;
    f.blinkX = f.x;
    f.blinkY = f.y;
    this.pushEvent(EV_BLINK, now, f.x, f.y, 0, f.slot, f.row.accent, nx, ny);
    ball.x = f.x = nx;
    ball.y = f.y = ny;
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team) continue;
      if (circlesTouch(f.x, f.y, 1.8 * f.r, o.x, o.y, o.r)) {
        const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
        this.hit(ctx, f, o, damage, (o.x - f.x) / d, (o.y - f.y) / d, 0.5, "blade");
      }
    }
  }

  /** An exploding projectile (the rocket): a shockwave where it lands. */
  private explode(ctx: ModeContext, p: FlProjectile, now: number) {
    const owner = this.view.fighters[p.owner];
    if (!owner) return;
    this.shockwaveAt(ctx, owner, p.x, p.y, p.explode, p.damage, 1.6, false, now);
    p.explode = 0;
  }

  /* ---------------------------------------------------------------- hits */

  /** A hit on a decoy or a summon: it pops (a freeze decoy freezes its attacker). */
  private hitMinion(ctx: ModeContext, attacker: FlFighter, m: FlMinion, now: number) {
    m.hp--;
    if (m.hp > 0) return;
    m.active = false;
    this.pushEvent(EV_POP, now, m.x, m.y, 0, m.owner, m.color);
    if (m.freezeOnTouch > 0 && attacker.alive) {
      attacker.frozenUntil = Math.max(attacker.frozenUntil, now + 1000 * m.freezeOnTouch);
      this.pushEvent(EV_FREEZE, now, attacker.x, attacker.y, m.freezeOnTouch, attacker.slot, "#bae6fd");
    }
    this.budget.offer(0.3, "magic", 1318.5, 0.25);
  }

  /** A hit on `f`'s current target (a fighter or a decoy). */
  private hitTarget(ctx: ModeContext, f: FlFighter, damage: number, dx: number, dy: number, kb: number, sound: FlSoundKind, opts: HitOptions) {
    if (f.targetSlot >= 0) this.hit(ctx, f, this.view.fighters[f.targetSlot], damage, dx, dy, kb, sound, opts);
    else if (f.targetMinion >= 0 && this.view.minions[f.targetMinion].active) this.hitMinion(ctx, f, this.view.minions[f.targetMinion], this.now());
  }

  /**
   * `attacker` hits `target` for `damage` (before its damage stat and buffs) from direction (dx, dy): invulnerability,
   * the target's invulnerability window, a shield block, giant hits, reflection, knockback, the counters, the meters, the
   * events and the sound. Returns true when damage landed.
   */
  private hit(ctx: ModeContext, attacker: FlFighter, target: FlFighter, damage: number, dx: number, dy: number, kb: number, sound: FlSoundKind, opts: HitOptions = {}): boolean {
    const v = this.view;
    const now = this.now();
    if (!target.alive || target.hp <= 0 || v.finished) return false;
    if (now < target.invulnUntil) return false;
    if (now < attacker.disarmedUntil && opts.weapon !== undefined && opts.weapon >= 0) return false;
    const sameVolley = opts.volley !== undefined && opts.volley > 0 && target.lastVolley === opts.volley && now - target.lastVolleyMs < 400;
    if (!opts.ignoreIframes && now < target.iUntil && !sameVolley) return false;
    // A held shield blocks hits from its facing side.
    if (!opts.unblockable) {
      for (const w of target.weapons) {
        if (w.spec.kind !== "shield" || w.thrown >= 0) continue;
        const fx = opts.fromX ?? attacker.x;
        const fy = opts.fromY ?? attacker.y;
        if (!shieldBlocks(w.angle, Math.atan2(fy - target.y, fx - target.x))) continue;
        target.iUntil = now + 0.5 * FL_IFRAME_MS;
        target.blocks++;
        v.blocks++;
        this.pushEvent(EV_BLOCK, now, target.x + Math.cos(w.angle) * target.r * 1.2, target.y + Math.sin(w.angle) * target.r * 1.2, 0, target.slot, "#fef9c3");
        this.budget.offer(0.6, "block", 1567.98, 0.4);
        return false;
      }
    }
    let amount = damage * attacker.damage;
    if (now < attacker.dmgMulUntil) amount *= attacker.dmgMul;
    let knock = kb;
    if (now < attacker.dmgMulUntil) knock *= attacker.kbMul;
    // A giant hit: carried by the projectile, or the next melee hit of the attacker.
    let giant = 0;
    let giantKb = 0;
    let giantFreeze = 0;
    if (opts.projectile && opts.projectile.giant > 0) {
      giant = opts.projectile.giant;
      giantKb = opts.projectile.giantKb;
      giantFreeze = opts.projectile.giantFreeze;
      opts.projectile.giant = 0;
    } else if (opts.melee && attacker.giantLeft > 0) {
      attacker.giantLeft--;
      giant = attacker.giantMult;
      giantKb = attacker.giantKb;
      giantFreeze = attacker.giantFreeze;
    }
    if (giant > 0) {
      amount = giantDamage(amount, giant, target.hp, target.maxHp, attacker.giantBelowHalf, attacker.giantHalfMax);
      knock += giantKb;
      if (giantFreeze > 0) target.frozenUntil = Math.max(target.frozenUntil, now + 1000 * giantFreeze);
      this.pushEvent(EV_SHOCK, now, target.x, target.y, target.r * 2.2, attacker.slot, attacker.row.accent);
    }
    if (!(amount > 0)) return false;
    const before = target.hp;
    target.hp -= amount;
    this.absorbLethal(target, before);
    const iframe = FL_IFRAME_MS * (this.rigChosen >= 0 && target.team === this.rigChosen ? 1 + 0.8 * this.rigK : 1);
    target.iUntil = now + iframe;
    if (opts.volley) {
      target.lastVolley = opts.volley;
      target.lastVolleyMs = now;
    }
    target.hitMs = now;
    target.lastHitBy = attacker.slot;
    target.taken++;
    attacker.hits++;
    if (opts.weapon !== undefined && opts.weapon >= 0 && attacker.weapons[opts.weapon]) attacker.weapons[opts.weapon].hits++;
    attacker.dealt += before - Math.max(0, target.hp);
    v.hits++;
    v.lastHitMs = now;
    attacker.meter = Math.min(1, attacker.meter + FL_HIT_CHARGE * attacker.cast);
    target.meter = Math.min(1, target.meter + FL_TAKEN_CHARGE * target.cast);
    // Knockback (a pinned or held fighter does not budge).
    const ball = this.byIndex[target.slot];
    if (ball && knock > 0 && !this.pinned(target, now)) {
      const push = knock * this.unit;
      ball.vx += dx * push;
      ball.vy += dy * push;
      target.vx = ball.vx;
      target.vy = ball.vy;
    }
    // Reflection: the attacker takes its share back – through the same guards as a hit (none while it is invulnerable, and
    // the rig's backstop holds against it).
    if (now < target.reflectUntil && attacker !== target && attacker.alive && now >= attacker.invulnUntil) {
      const back = amount * target.reflectFrac;
      const had = attacker.hp;
      attacker.hp -= back;
      this.absorbLethal(attacker, had);
      attacker.hitMs = now;
      this.pushEvent(EV_DAMAGE, now, attacker.x, attacker.y - attacker.r, back, attacker.slot, target.row.accent);
    }
    const attackerBall = this.byIndex[attacker.slot];
    if (ball && attackerBall) ctx.noteCollide?.(attackerBall, ball); // --- bounce-math --- a hit is a ball hit
    this.pushEvent(EV_DAMAGE, now, target.x, target.y - target.r, amount, target.slot, attacker.row.accent);
    if (!opts.quiet || giant > 0) this.pushEvent(EV_HIT, now, (target.x + (opts.fromX ?? attacker.x)) / 2, (target.y + (opts.fromY ?? attacker.y)) / 2, amount, attacker.slot, attacker.row.accent);
    this.budget.offer(amount, sound, fighterPitch(attacker.slot), Math.min(1, 0.45 + amount / 20));
    return true;
  }

  /**
   * The rig's backstop, after `f`'s HP dropped from `before` (a hit or reflected damage): the chosen side's last fighter keeps
   * its last hit point until the verdict – also when the rivals are down in the same step or a rival's shot is still in the
   * air after the last KO (`FL_KO_GRACE_MS`), so a rigged fight never ends in a double KO.
   */
  private absorbLethal(f: FlFighter, before: number) {
    if (f.hp > 0 || this.rigChosen < 0 || f.team !== this.rigChosen || this.view.finished || !this.lastOfTeam(f)) return;
    f.hp = Math.min(before, 1);
    this.view.rigAbsorbed++;
  }

  private lastOfTeam(f: FlFighter): boolean {
    for (const o of this.view.fighters) if (o !== f && o.team === f.team && o.alive && o.hp > 0) return false;
    return true;
  }

  /**
   * The rig's guard at the end of a step, before its KOs: should every standing fighter of the chosen side be at 0 HP, the
   * one with the most left keeps 1 HP – the backstop above already holds it, this catches any other way down (the verdict
   * then never wipes the chosen side out: no rival's win, no double KO). Deterministic, so replays stay exact.
   */
  private guardChosenSide() {
    let keep: FlFighter | null = null;
    for (const f of this.view.fighters) {
      if (f.team !== this.rigChosen || !f.alive) continue;
      if (f.hp > 0) return;
      if (!keep || f.hp > keep.hp) keep = f;
    }
    if (!keep) return;
    keep.hp = Math.min(keep.maxHp, 1);
    this.view.rigAbsorbed++;
  }

  /* ---------------------------------------------------------------- abilities */

  /** Fires one primitive of `f`'s ability. */
  private castEffect(ctx: ModeContext, f: FlFighter, e: FlEffect, now: number) {
    const v = this.view;
    const field = v.field!;
    const target = f.targetSlot >= 0 ? v.fighters[f.targetSlot] : null;
    switch (e.p) {
      case "speedBurst":
        f.speedMul = e.mult;
        f.speedMulUntil = now + 1000 * e.dur;
        break;
      case "damageBurst":
        f.dmgMul = e.mult;
        f.kbMul = e.knockback ?? 1;
        f.dmgMulUntil = now + 1000 * e.dur;
        break;
      case "attackSpeedBurst":
        f.atkMul = e.mult;
        f.atkMulUntil = now + 1000 * e.dur;
        break;
      case "invulnerable":
        f.invulnUntil = now + 1000 * e.dur;
        if (e.untargetable) f.untargetableUntil = now + 1000 * e.dur;
        if (e.contact) {
          f.contactUntil = now + 1000 * e.dur;
          f.contactDamage = e.contact;
        }
        break;
      case "freezeAll":
        for (const o of v.fighters) {
          if (!o.alive || o.team === f.team) continue;
          o.frozenUntil = Math.max(o.frozenUntil, now + 1000 * e.dur);
          this.pushEvent(EV_FREEZE, now, o.x, o.y, e.dur, o.slot, "#bae6fd");
        }
        break;
      case "choke": {
        if (!target || !target.alive) break;
        target.heldBy = f.slot;
        target.heldUntil = now + 1000 * e.dur;
        const at = e.at ?? "start";
        target.holdMode = at;
        target.holdDamage = at === "start" ? 0 : e.damage;
        target.holdTickMs = now + 300;
        if (at === "start" && e.damage > 0) this.hit(ctx, f, target, e.damage, 0, 0, 0, "magic", { unblockable: true, ignoreIframes: true });
        break;
      }
      case "arenaCuts": {
        const foes = v.fighters.filter((o) => o.alive && o.team !== f.team);
        for (let k = 0; k < e.n; k++) {
          const task = this.freeTask();
          if (!task || foes.length === 0) break;
          const o = foes[k % foes.length];
          const a = this.randomDraw() * Math.PI;
          const len = 2 * field.half;
          task.active = true;
          task.kind = "cut";
          task.owner = f.slot;
          task.born = now;
          task.at = now + 300 + 150 * k;
          task.x = o.x - Math.cos(a) * len;
          task.y = o.y - Math.sin(a) * len;
          task.x2 = o.x + Math.cos(a) * len;
          task.y2 = o.y + Math.sin(a) * len;
          task.damage = e.damage;
        }
        break;
      }
      case "beam": {
        const b = this.freeBeam();
        if (!b) break;
        b.active = true;
        b.owner = f.slot;
        b.team = f.team;
        b.born = now;
        b.until = now + 1000 * e.dur;
        b.angle = target ? Math.atan2(target.y - f.y, target.x - f.x) : f.aim;
        b.width = Math.max(2, e.width * f.r);
        b.damage = e.damage;
        b.ability = true;
        b.weapon = -1;
        b.hitMask = 0;
        b.color = e.color ?? f.row.accent;
        break;
      }
      case "volley": {
        const speed = this.projectileSpeed(e.speed ?? 1.2, field);
        const base = target ? Math.atan2(target.y - f.y, target.x - f.x) : f.aim;
        const volley = ++this.volleySerial;
        for (let k = 0; k < e.n; k++) {
          const p = this.freeProjectile();
          if (!p) break;
          const spread = (e.spread ?? 0) * DEG;
          const a = e.n > 1 ? base + (k / (e.n - 1) - 0.5) * spread : base;
          this.launch(p, f, PK_ABILITY, a, speed, now, 0);
          p.volley = volley;
          p.r = Math.max(2, (e.size ?? 0.2) * f.r);
          p.damage = e.damage;
          p.kb = e.explode ? 0.5 : 0.8;
          p.shape = e.shape ?? "bolt";
          p.color = e.color ?? f.row.accent;
          p.homing = Math.max(p.homing, e.homing ?? 0);
          p.target = f.targetSlot;
          p.unblockable = !!e.unblockable;
          p.explode = e.explode ? e.explode * f.r : 0;
          if (e.returning) {
            p.ret = 1;
            p.range = 0.8 * field.side;
          }
          if (e.bounceFoes) {
            let mask = 0;
            for (const o of v.fighters) if (o.alive && o.team !== f.team) mask |= 1 << o.slot;
            p.foes = mask;
            p.ret = 1;
            p.range = 3 * field.side;
          }
          this.giantShot(f, p);
        }
        this.view.shots++;
        break;
      }
      case "shockwave": {
        if (e.delay && e.delay > 0) {
          const task = this.freeTask();
          if (!task) break;
          task.active = true;
          task.kind = "shock";
          task.owner = f.slot;
          task.born = now;
          task.at = now + 1000 * e.delay;
          task.x = f.x;
          task.y = f.y;
          task.radius = e.radius * f.r;
          task.damage = e.damage;
          task.kb = e.knockback;
          task.pin = !!e.pin;
          task.spin = !!e.spin;
          break;
        }
        this.shockwaveAt(ctx, f, f.x, f.y, e.radius * f.r, e.damage, e.knockback, !!e.pin, now, !!e.spin);
        break;
      }
      case "pull": {
        for (const o of v.fighters) {
          if (!o.alive || o.team === f.team) continue;
          if (!e.all && o !== target) continue;
          o.pullBy = f.slot;
          o.pullUntil = now + 700;
          o.pullSpeed = e.strength * this.unit;
        }
        break;
      }
      case "decoys": {
        for (let k = 0; k < e.n; k++) {
          const m = this.freeMinion();
          if (!m) break;
          const a = offAxisAngle(this.randomDraw(), this.randomDraw());
          const sp = Math.max(this.unit * f.speed, 1);
          m.active = true;
          m.summon = false;
          m.owner = f.slot;
          m.team = f.team;
          m.x = f.x;
          m.y = f.y;
          m.vx = Math.cos(a) * sp;
          m.vy = Math.sin(a) * sp;
          m.r = f.r;
          m.born = now;
          m.until = now + 1000 * e.dur;
          m.hp = 1;
          m.damage = 0;
          m.freezeOnTouch = e.freezeOnTouch ?? 0;
          m.shape = "clone";
          m.color = f.row.body;
        }
        break;
      }
      case "heal":
        f.healRate = e.amount / Math.max(0.1, e.dur);
        f.healUntil = now + 1000 * e.dur;
        this.pushEvent(EV_HEAL, now, f.x, f.y - f.r, e.amount, f.slot, "#4ade80");
        break;
      case "fireRing":
        f.fireRingUntil = now + 1000 * e.dur;
        f.fireRingRadius = e.radius * f.r;
        f.fireRingDamage = e.damage;
        f.fireRingShape = e.shape ?? "flames";
        break;
      case "giantHit":
        f.giantLeft = e.count ?? 1;
        f.giantMult = e.mult;
        f.giantKb = e.knockback ?? 0;
        f.giantFreeze = e.freeze ?? 0;
        f.giantBelowHalf = e.belowHalf ?? 0;
        f.giantHalfMax = !!e.halfMaxHp;
        f.giantHoming = e.homing ?? 0;
        break;
      case "lightning":
        for (const o of v.fighters) {
          if (!o.alive || o.team === f.team || !this.targetable(o, now)) continue;
          this.pushEvent(EV_LIGHTNING, now, o.x, o.y, 0, f.slot, f.row.accent);
          this.hit(ctx, f, o, e.damage, 0, 1, 0.3, "magic", { ignoreIframes: true, unblockable: true });
        }
        for (const m of v.minions) if (m.active && m.team !== f.team) this.hitMinion(ctx, f, m, now);
        break;
      case "confuse":
        for (const o of v.fighters) if (o.alive && o.team !== f.team) o.confusedUntil = now + 1000 * e.dur;
        break;
      case "blinkStrike": {
        const task = this.freeTask();
        if (!task) break;
        task.active = true;
        task.kind = "blink";
        task.owner = f.slot;
        task.born = now;
        task.at = now;
        task.n = e.n;
        task.interval = 1000 * (e.interval ?? 0.35);
        task.damage = e.damage;
        break;
      }
      case "summon": {
        for (let k = 0; k < e.n; k++) {
          const m = this.freeMinion();
          if (!m) break;
          const a = offAxisAngle(this.randomDraw(), this.randomDraw());
          const sp = Math.max(1.2 * this.unit, 1);
          m.active = true;
          m.summon = true;
          m.owner = f.slot;
          m.team = f.team;
          m.x = f.x + Math.cos(a) * f.r;
          m.y = f.y + Math.sin(a) * f.r;
          m.vx = Math.cos(a) * sp;
          m.vy = Math.sin(a) * sp;
          m.r = Math.max(2, (e.size ?? 0.6) * f.r);
          m.born = now;
          m.until = now + 1000 * e.dur;
          m.hp = 2;
          m.damage = e.damage;
          m.freezeOnTouch = 0;
          m.shape = e.shape ?? "clone";
          m.color = f.row.accent;
        }
        break;
      }
      case "reflect":
        f.reflectUntil = now + 1000 * e.dur;
        f.reflectFrac = e.frac;
        break;
      case "disarm":
        if (target && target.alive) target.disarmedUntil = now + 1000 * e.dur;
        break;
      case "slowTime":
        v.slowTimeUntil = now + 1000 * e.dur;
        v.slowTimeTeam = f.team;
        v.slowTimeFactor = e.factor;
        break;
    }
  }

  /** A shockwave at (x, y): damage and knockback for every foe within `radius` (pinned to the far wall with `pin`). */
  private shockwaveAt(ctx: ModeContext, f: FlFighter, x: number, y: number, radius: number, damage: number, kb: number, pin: boolean, now: number, spin = false) {
    this.pushEvent(EV_SHOCK, now, x, y, radius, f.slot, spin ? "#ffffff" : f.row.accent);
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + o.r) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      this.hit(ctx, f, o, damage, nx, ny, kb, spin ? "blade" : "blunt", { ignoreIframes: true, unblockable: spin ? false : true, fromX: x, fromY: y });
      if (pin && o.alive) {
        // Pinned to the far wall: thrown there and held a moment.
        const ball = this.byIndex[o.slot];
        const field = this.view.field!;
        if (ball) {
          const len = rayToEdge(field, o.x, o.y, nx, ny);
          ball.x = o.x = o.x + nx * Math.max(0, len - o.r - 1);
          ball.y = o.y = o.y + ny * Math.max(0, len - o.r - 1);
          o.pinUntil = now + 1000;
          o.kept = false;
        }
      }
    }
    for (const m of this.view.minions) if (m.active && m.team !== f.team && Math.hypot(m.x - x, m.y - y) <= radius + m.r) this.hitMinion(ctx, f, m, now);
    this.budget.offer(damage + 5, "blunt", 98, 0.9);
  }

  /** Scheduled effects: fused shockwaves, blink strikes, arena cuts. */
  private stepTasks(ctx: ModeContext, now: number) {
    const v = this.view;
    for (const task of v.tasks) {
      if (!task.active || now < task.at) continue;
      const f = v.fighters[task.owner];
      if (!f || !f.alive || v.finished) {
        task.active = false;
        continue;
      }
      if (task.kind === "shock") {
        this.shockwaveAt(ctx, f, task.x, task.y, task.radius, task.damage, task.kb, task.pin, now, task.spin);
        task.active = false;
      } else if (task.kind === "cut") {
        this.pushEvent(EV_CUT, now, task.x, task.y, 0, f.slot, "#ffffff", task.x2, task.y2);
        for (const o of v.fighters) {
          if (!o.alive || o.team === f.team) continue;
          if (segmentHitsCircle(task.x, task.y, task.x2, task.y2, 2, o.x, o.y, o.r)) this.hit(ctx, f, o, task.damage, 0, 0, 0.4, "blade", { ignoreIframes: true, unblockable: true });
        }
        task.active = false;
      } else if (task.kind === "blink") {
        this.pickTarget(f, now);
        const t = f.targetSlot >= 0 ? v.fighters[f.targetSlot] : null;
        if (t && this.canAct(f, now)) {
          const side = this.randomDraw() < 0.5 ? -1 : 1;
          const a = Math.atan2(f.y - t.y, f.x - t.x) + side * 0.6;
          const d = t.r + f.r + 0.2 * f.r;
          this.blinkTo(ctx, f, t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, now, 0);
          const dd = Math.hypot(t.x - f.x, t.y - f.y) || 1;
          this.hit(ctx, f, t, task.damage, (t.x - f.x) / dd, (t.y - f.y) / dd, 0.8, "blade", { ignoreIframes: true });
        }
        task.n--;
        if (task.n <= 0) task.active = false;
        else task.at = now + task.interval;
      }
    }
  }

  /** Fire rings: every foe within the ring burns (a tick per invulnerability window). */
  private stepFireRings(ctx: ModeContext, now: number) {
    const fs = this.view.fighters;
    for (const f of fs) {
      if (!f.alive || now >= f.fireRingUntil) continue;
      for (const o of fs) {
        if (!o.alive || o.team === f.team) continue;
        if (!circlesTouch(f.x, f.y, f.fireRingRadius, o.x, o.y, o.r)) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
        this.hit(ctx, f, o, f.fireRingDamage, (o.x - f.x) / d, (o.y - f.y) / d, 0.4, f.fireRingShape === "flames" ? "fire" : "blade", { quiet: true });
      }
      for (const m of this.view.minions) if (m.active && m.team !== f.team && circlesTouch(f.x, f.y, f.fireRingRadius, m.x, m.y, m.r)) this.hitMinion(ctx, f, m, now);
    }
  }

  /** Decoys and summons move and bounce; summons hit the foes they touch, freeze decoys freeze them. */
  private stepMinions(ctx: ModeContext, now: number, dt: number) {
    const v = this.view;
    const field = v.field!;
    for (const m of v.minions) {
      if (!m.active) continue;
      if (now >= m.until || !v.fighters[m.owner]?.alive) {
        m.active = false;
        this.pushEvent(EV_POP, now, m.x, m.y, 0, m.owner, m.color);
        continue;
      }
      const ts = this.timeScale(m.team, now);
      // Summons chase the nearest foe a little.
      if (m.summon) {
        let best = Infinity;
        let tx = 0;
        let ty = 0;
        for (const o of v.fighters) {
          if (!o.alive || o.team === m.team || !this.targetable(o, now)) continue;
          const d = (o.x - m.x) ** 2 + (o.y - m.y) ** 2;
          if (d < best) {
            best = d;
            tx = o.x;
            ty = o.y;
          }
        }
        if (best < Infinity) {
          const sp = Math.hypot(m.vx, m.vy);
          const a = turnToward(Math.atan2(m.vy, m.vx), Math.atan2(ty - m.y, tx - m.x), 2.5 * dt);
          m.vx = Math.cos(a) * sp;
          m.vy = Math.sin(a) * sp;
        }
      }
      m.x += m.vx * dt * ts;
      m.y += m.vy * dt * ts;
      if (field.kind === "circle") {
        const dx = m.x - field.cx;
        const dy = m.y - field.cy;
        const d = Math.hypot(dx, dy) || 1;
        const lim = field.half - m.r;
        if (d > lim) {
          const nx = dx / d;
          const ny = dy / d;
          m.x = field.cx + nx * lim;
          m.y = field.cy + ny * lim;
          const vn = m.vx * nx + m.vy * ny;
          if (vn > 0) {
            m.vx -= 2 * vn * nx;
            m.vy -= 2 * vn * ny;
          }
        }
      } else {
        const lo = field.cx - field.half + m.r;
        const hi = field.cx + field.half - m.r;
        const top = field.cy - field.half + m.r;
        const bottom = field.cy + field.half - m.r;
        if (m.x < lo || m.x > hi) {
          m.x = Math.max(lo, Math.min(hi, m.x));
          m.vx = -m.vx;
        }
        if (m.y < top || m.y > bottom) {
          m.y = Math.max(top, Math.min(bottom, m.y));
          m.vy = -m.vy;
        }
      }
      if (now < v.introMs) continue;
      for (const o of v.fighters) {
        if (!o.alive || o.team === m.team || o.hp <= 0) continue;
        if (!circlesTouch(m.x, m.y, m.r, o.x, o.y, o.r)) continue;
        const owner = v.fighters[m.owner];
        if (m.summon) {
          const d = Math.hypot(o.x - m.x, o.y - m.y) || 1;
          this.hit(ctx, owner, o, m.damage, (o.x - m.x) / d, (o.y - m.y) / d, 0.5, "blunt", { fromX: m.x, fromY: m.y });
        } else if (m.freezeOnTouch > 0) {
          o.frozenUntil = Math.max(o.frozenUntil, now + 1000 * m.freezeOnTouch);
          this.pushEvent(EV_FREEZE, now, o.x, o.y, m.freezeOnTouch, o.slot, "#bae6fd");
          m.active = false;
          this.pushEvent(EV_POP, now, m.x, m.y, 0, m.owner, m.color);
          break;
        }
      }
    }
  }

  /** Beams: follow their owner, turn slowly toward its target; ability beams tick, weapon beams hit each foe once. */
  private stepBeams(ctx: ModeContext, now: number, dt: number) {
    const v = this.view;
    const field = v.field!;
    for (const b of v.beams) {
      if (!b.active) continue;
      const f = v.fighters[b.owner];
      if (!f || !f.alive || now >= b.until || v.finished) {
        b.active = false;
        continue;
      }
      if (f.targetSlot >= 0) {
        const t = v.fighters[f.targetSlot];
        b.angle = turnToward(b.angle, Math.atan2(t.y - f.y, t.x - f.x), (b.ability ? 1.2 : 2) * dt);
      }
      const ux = Math.cos(b.angle);
      const uy = Math.sin(b.angle);
      b.x0 = f.x + ux * f.r * 0.8;
      b.y0 = f.y + uy * f.r * 0.8;
      const len = rayToEdge(field, b.x0, b.y0, ux, uy);
      b.x1 = b.x0 + ux * len;
      b.y1 = b.y0 + uy * len;
      if (now < v.introMs) continue;
      for (const o of v.fighters) {
        if (!o.alive || o.team === b.team || o.hp <= 0) continue;
        if (!b.ability && b.hitMask & (1 << o.slot)) continue;
        if (!segmentHitsCircle(b.x0, b.y0, b.x1, b.y1, 0.5 * b.width, o.x, o.y, o.r)) continue;
        const landed = this.hit(ctx, f, o, b.damage, ux, uy, b.ability ? 0.35 : 0.4, "magic", { quiet: b.ability, unblockable: b.ability, fromX: b.x0, fromY: b.y0, weapon: b.weapon });
        if (landed || !b.ability) b.hitMask |= 1 << o.slot;
      }
      for (const m of v.minions) if (m.active && m.team !== b.team && segmentHitsCircle(b.x0, b.y0, b.x1, b.y1, 0.5 * b.width, m.x, m.y, m.r)) this.hitMinion(ctx, f, m, now);
    }
  }

  /* ---------------------------------------------------------------- end of a step: KOs and the verdict */

  onPostUpdate(ctx: ModeContext) {
    const v = this.view;
    const now = ctx.getElapsedMs();
    if (v.finished) return;
    if (this.rigChosen >= 0) this.guardChosenSide();
    // KOs of this step (every hit of the step counted first: no fighter wins by its slot).
    for (const f of v.fighters) {
      if (!f.alive || f.hp > 0) continue;
      f.alive = false;
      f.hp = 0;
      f.koMs = now;
      v.kos++;
      this.koThisStep = true;
      const killer = f.lastHitBy >= 0 ? v.fighters[f.lastHitBy] : null;
      if (killer && killer !== f) killer.kills++;
      this.pushEvent(EV_KO, now, f.x, f.y, 0, f.slot, f.row.body);
      this.urgentSound("ko", 82.41, 1);
      ctx.noteImpact?.(); // the camera's shake (no wall-break sound)
      for (const b of v.beams) if (b.active && b.owner === f.slot) b.active = false;
    }
    if (this.koThisStep) {
      ctx.setBalls(ctx.getBalls().filter((b) => {
        for (const f of v.fighters) if (f.ballId === b.id) return f.alive;
        return true;
      }));
      this.indexBalls(ctx);
    }
    // The verdict: one side left (after the grace for projectiles in the air), none (a double KO), or the time cap.
    let teamsAlive = 0;
    let lastTeam = -1;
    let seen = 0;
    for (const f of v.fighters) {
      if (f.alive && !(seen & (1 << f.team))) {
        seen |= 1 << f.team;
        teamsAlive++;
        lastTeam = f.team;
      }
    }
    if (teamsAlive === 0) {
      this.finish(ctx, -1, now, true, false);
      return;
    }
    if (teamsAlive === 1) {
      if (this.graceUntil < 0) this.graceUntil = now + FL_KO_GRACE_MS;
      if (now >= this.graceUntil || !this.projectilesInAir(lastTeam)) this.finish(ctx, lastTeam, now, false, false);
      return;
    }
    const cap = v.settings.timeCap;
    if (cap > 0 && now >= 1000 * cap) {
      const hp = this.capHp;
      const team = this.capTeam;
      hp.length = team.length = v.fighters.length;
      for (let i = 0; i < v.fighters.length; i++) {
        const f = v.fighters[i];
        hp[i] = f.alive ? f.hp : 0;
        team[i] = f.team;
      }
      const winner = capVerdict(hp, team, v.teamCount, this.capSums);
      // The rig waits while its side trails (sudden death); level, the chosen side takes it.
      if (this.rigChosen >= 0 && winner !== this.rigChosen) {
        const sums = this.rival;
        sums.fill(0);
        for (const f of v.fighters) if (f.alive) sums[f.team] += f.hp;
        let best = -Infinity;
        for (let t = 0; t < v.teamCount; t++) if (t !== this.rigChosen) best = Math.max(best, sums[t]);
        if (sums[this.rigChosen] < best - 1e-9) return;
        this.finish(ctx, this.rigChosen, now, false, true);
        return;
      }
      this.finish(ctx, winner, now, false, true);
    }
  }

  /** Whether a projectile of a side other than `team` is still in the air (it may still land on the last side standing). */
  private projectilesInAir(team: number): boolean {
    for (const p of this.view.projectiles) if (p.active && p.team !== team && p.ret !== 2) return true;
    return false;
  }

  private finish(ctx: ModeContext, winnerTeam: number, now: number, doubleKo: boolean, byTime: boolean) {
    const v = this.view;
    v.finished = true;
    v.finishMs = now;
    v.winnerTeam = winnerTeam;
    v.doubleKo = doubleKo;
    v.byTime = byTime;
    for (const p of v.projectiles) p.active = false;
    for (const b of v.beams) b.active = false;
    for (const t of v.tasks) t.active = false;
    // The win in the team stats (an "escape"), so the teams banner and the finder's winner outcome rank the fight the same.
    if (winnerTeam >= 0) {
      for (const f of v.fighters) {
        if (f.team !== winnerTeam) continue;
        const ball = this.byIndex[f.slot];
        ctx.creditEscape?.(ball ?? { id: f.ballId, team: f.team });
      }
      const w = v.fighters.find((f) => f.team === winnerTeam && f.alive) ?? v.fighters.find((f) => f.team === winnerTeam);
      if (w) ctx.spawnConfetti(w.x, w.y);
    }
    this.urgent.push({ type: "hit", wallIndex: 0, frequency: WIN_CHORD[0], accent: true, chord: [...WIN_CHORD], melody: false });
  }

  /** Called once per rendered frame: the frame's strongest fight sounds, the abilities, the KOs. */
  flushPendingSounds(ctx: ModeContext) {
    const v = this.view;
    for (const ev of this.urgent) ctx.addPendingSoundEvent(ev);
    v.sounds += this.urgent.length;
    this.urgent.length = 0;
    this.flushCtx = ctx;
    this.budget.flush(this.pushBudgeted);
    this.flushCtx = null;
  }

  /** The context of the flush in progress, and the budget's sink (one function for the mode's life: no closure per frame). */
  private flushCtx: ModeContext | null = null;
  private readonly pushBudgeted = (kind: FlSoundKind | null, frequency: number, level: number) => {
    const ctx = this.flushCtx;
    if (!ctx) return;
    if (kind === null) {
      this.view.notes++;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency, level });
    } else {
      this.view.sounds++;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, frequency, level, melody: false, fight: kind });
    }
  };

  onWallHit() {}
  onGapPass() {
    return true;
  }

  /** A canvas resize lays the field out again and maps everything onto it (positions, sizes and speeds scale with the arena). */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    const v = this.view;
    const old = v.field;
    if (!sizeChanged || !old) return true;
    const field = buildFightField(ctx.config.width, ctx.config.height, old.kind);
    const k = field.side / old.side;
    const sx = ctx.config.width / old.canvasWidth;
    const sy = ctx.config.height / old.canvasHeight;
    const mapX = (x: number) => field.cx + (x - old.cx) * k;
    const mapY = (y: number) => field.cy + (y - old.cy) * k;
    for (const ball of ctx.getBalls()) {
      // (the engine stretched the balls with the canvas about its centre; undo that, then map the old arena onto the new one)
      const ox = old.canvasWidth / 2 + (ball.x - ctx.config.width / 2) / (sx || 1);
      const oy = old.canvasHeight / 2 + (ball.y - ctx.config.height / 2) / (sy || 1);
      ball.x = mapX(ox);
      ball.y = mapY(oy);
      ball.radius *= k;
      ball.vx *= k;
      ball.vy *= k;
      ball.radiusScale = ball.radius / (ctx.config.ballRadius || 8);
    }
    for (const f of v.fighters) {
      const ball = this.byIndex[f.slot];
      if (ball) {
        f.x = ball.x;
        f.y = ball.y;
        f.r = ball.radius;
      } else {
        f.x = mapX(f.x);
        f.y = mapY(f.y);
        f.r *= k;
      }
      f.fireRingRadius *= k;
    }
    for (const p of v.projectiles) {
      if (!p.active) continue;
      p.x = mapX(p.x);
      p.y = mapY(p.y);
      p.vx *= k;
      p.vy *= k;
      p.r *= k;
      p.range *= k;
      p.explode *= k;
    }
    for (const m of v.minions) {
      if (!m.active) continue;
      m.x = mapX(m.x);
      m.y = mapY(m.y);
      m.vx *= k;
      m.vy *= k;
      m.r *= k;
    }
    for (const t of v.tasks) {
      if (!t.active) continue;
      t.x = mapX(t.x);
      t.y = mapY(t.y);
      t.x2 = mapX(t.x2);
      t.y2 = mapY(t.y2);
      t.radius *= k;
    }
    for (const b of v.beams) b.width *= k;
    for (const e of v.events) {
      e.x = mapX(e.x);
      e.y = mapY(e.y);
      e.x2 = mapX(e.x2);
      e.y2 = mapY(e.y2);
    }
    v.field = field;
    this.unit = this.speedUnit(ctx);
    return true;
  }

  /** The arena is handled in onBallStep; there are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    return this.getProgress();
  }
}

/** Options of a hit. */
interface HitOptions {
  weapon?: number;
  volley?: number;
  fromX?: number;
  fromY?: number;
  melee?: boolean;
  quiet?: boolean;
  unblockable?: boolean;
  ignoreIframes?: boolean;
  projectile?: FlProjectile;
}

/** Spots of the formation, in arena half-sides (x, y per slot): opposite sides for two, a triangle, corners, team sides. */
function spawnSpots(match: FlMatch, n: number): number[] {
  if (match === "2v2") return [-1, -0.55, -1, 0.55, 1, -0.55, 1, 0.55];
  if (n === 3) return [-0.9, 0.6, 0.9, 0.6, 0, -0.95];
  if (n >= 4) return [-0.85, -0.85, 0.85, 0.85, 0.85, -0.85, -0.85, 0.85];
  return [-1, 0, 1, 0];
}

/** Every division with its fighters (the panel's grouped pickers, the README's table). */
export function rosterByDivision(): { division: FlDivision; fighters: FlFighterRow[] }[] {
  return FL_DIVISIONS.map((division) => ({ division, fighters: FL_ROSTER.filter((r) => r.division === division) }));
}
