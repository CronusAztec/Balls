import { midiToFrequency } from "@/lib/audio/scales";
import type { Ball, FightSoundKind, GameMode, ModeContext, SoundEvent } from "../types";
import { TWO_PI } from "../types";
import { atLeastMin } from "@/lib/uncap"; // uncap-all: no maximum
import { MAX_NUDGE, MIN_WALL_ANGLE, offAxisAngle, steerToward } from "./arenaGames";
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
  // --- fl-overhaul --- (Stage 2: conferences and random tokens)
  fightersOf,
  fightersOfConference,
  isFlConference,
  isFlDivision,
  type FlConference,
} from "./fightLeagueRoster";

/**
 * Fight League ("fightLeague" mode, the arena games' family – feature fight-league; the "Ball Fight League" duels: "Thor vs
 * Loki | Game link in bio"). Fighters are balls of the engine, each carrying a WEAPON that sticks out of it as a vector
 * sprite, with HP shown inside the ball and a bar under it, in a white square arena (or a circle) inset in the square the
 * recorder exports. The balls fly and bounce at a cruising speed; a weapon touching another ball deals damage; every
 * fighter's ability charges from time and from the damage it deals and takes, telegraphs by its class and fires by itself;
 * the last ball (or team) with HP wins – or, at the time cap, the side with the larger share of its HP (a draw is possible).
 *
 * The roster is data (fightLeagueRoster.ts: one row per fighter). This module is the engineering the rows share:
 *
 *  - **Weapon kinds** (`FL_WEAPON_KINDS`, each with a contract in `FL_KIND_CONTRACT`: the distance it keeps, its trigger,
 *    cadence, hit geometry, invulnerability window, silhouette, animation and sound), each a simple silhouette with its own
 *    hit geometry against the foe's circle: sword (a blade along the velocity that sweeps 120° at a foe in reach on its
 *    cadence, on a bounce and on a clash of bodies; a glowing or a double blade), hammer (a slow, heavy orbit with big
 *    knockback; returning: thrown at the nearest foe and flying back, hitting on both passes), fists and claws (short
 *    punches that extend toward a foe in reach), chain (a head orbiting on a chain, damage by its momentum; pull: a thrown
 *    head that drags the hit foe in), bow, gun (burst: the rounds leave the muzzle one after another; bouncing), shotgun (a
 *    cone of pellets), wand, staff and book (fast bolts, homing orbs and pages that fizzle), cards (blades orbiting the
 *    ball and flying one by one), fire (an inhale, then a breath cone at a foe in reach), beam (a glint that locks the aim,
 *    then a thin ray), spark (arcs to a foe in range, on to a second one in a free-for-all), web (slows), ice (freezes),
 *    shield (held toward the foe, blocking hits from the front – each block spends its guard –, thrown every few seconds)
 *    and tail (trailing behind the ball, swinging at a foe in reach).
 *  - **Ability primitives** (`FL_ABILITY_PRIMITIVES`): speed / damage / attack-speed bursts, invulnerability, freezes,
 *    chokes, arena cuts, beams, volleys, shockwaves, pulls, decoys, heals, fire rings, giant hits, lightning, confusion,
 *    blink strikes, summons, reflection, disarming and slow time – each a case of `castEffect()`. Its telegraph lasts by
 *    its class (`telegraphMs()`: quick, standard, area, ultimate) with the aim locked at its start; a foe inside an area
 *    telegraph is nudged out of it (`EV_DODGE` when it escapes).
 *
 * Engagement (--- fl-overhaul ---): at FIGHT! every fighter launches at the nearest foe (± a seeded 20°); in flight the
 * intent steering (`seekTurn`, URL flSk – 0 is the pure bounce look) turns its velocity, never its speed, toward the
 * distance its first weapon wants (`intentBand()`: close for blades, the orbit for hammers and chains, an arc for fire and
 * sparks, 4–9 radii for shooters), and a melee fighter whose weapon is ready lunges at a foe in reach.
 *
 * Hits: a melee shape (a segment or a circle) or a projectile against the foe's circle; one touch is one hit. Each source
 * (an attacker's weapon, or its abilities, summons and contact together) has its own invulnerability window on the foe
 * (`flSourceWindowMs()`: light weapons by their cadence, 120–300 ms; heavy ones and abilities `FL_IFRAME_MS`; the pellets of
 * one volley land together), so two weapons never block each other; a refused shot grazes (`EV_GRAZE`). Melee hits of a
 * sub-step are queued and traded fairly (`resolveMelee()`: the stronger blow lands at half, even blows CLASH), fighters
 * act in an order that flips every step, knockback goes by weight, and hard crowd control (freezes, holds, pins) leaves a
 * second of immunity and interrupts a telegraph. Damage taken within a 60 Hz step is applied together and the KOs are
 * decided at its end (a fighter whose last HP went strikes no more that step), so no fighter wins by its slot – and two
 * fighters can still go down together: a DOUBLE KO (a projectile still in the air after the last KO gets
 * `FL_KO_GRACE_MS` to land).
 *
 * Verdict: the time cap counts from FIGHT!; at the cap (with two sides standing) SUDDEN DEATH (`suddenDeath`, URL flSD –
 * off restores the plain verdict) shrinks the arena to `FL_SUDDEN_MIN` of its side over `FL_SUDDEN_SHRINK_MS` for at most
 * `FL_SUDDEN_MS`, a KO still ending it; then the larger HP fraction (Σ HP ÷ Σ max per side, a KO counting 0) wins, within
 * `FL_DRAW_MARGIN` a draw (`capVerdict()`). At the verdict every fighter stops where it stands.
 *
 * Determinism: every random number comes from `ctx.random()`, so a seed replays exactly at any frame rate and Find
 * Simulation can search it ("A wins", "B wins", the run's length, a double KO). The draws, in this order – at the init:
 * one per "random" slot (`pickFighters()`), then per fighter in slot order its spawn jitter (x, y), then per fighter its
 * launch heading, then per fighter its cadence jitter and its meter's head start; then every step: the casts in the step's
 * processing order (an arena cut one draw each, a decoy or a summon two), a blink strike's side (one each, `stepTasks()`),
 * then per sub-step a circle rebound's turn (one each, in the engine's ball order), the weapons in the processing order
 * (one spread draw per projectile, a burst's later rounds included, in launch order) and a repeated clash's coin (one).
 * The rigged forced winner (`config.forcedWinner`, a fighter in 1v1 and the free-for-alls, a team in 2v2) steers within
 * that replay (`updateRig()`): its hits land a little more (a longer reach, homing shots, rebounds nudged toward a rival –
 * more the further it trails) and the rivals' a little less (it recovers longer from a hit), and as a backstop its side's
 * last fighter never loses its last hit point until the verdict – to a hit or to reflected damage, also when the rivals go
 * down in the same step or a shot lands in the KO grace (`absorbLethal()`, with `guardChosenSide()` before every step's
 * KOs) – and the time cap waits while it trails: the chosen side always wins, never in a double KO.
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
/** A fighter slot's value: a roster id, "random" or (--- fl-overhaul ---) a random token ("random:<division>", "random:<conference>"). */
export function isFlSlotValue(value: unknown): value is string {
  return value === FL_RANDOM || isFlFighterId(value) || parseFlRandom(value) !== null;
}

/* --- fl-overhaul --- (Stage 2) random tokens: a random slot may stay in a division or a conference */

/** The prefix of a scoped random slot: `random:<division>` or `random:<conference>` (division and conference ids never collide). */
export const FL_RANDOM_PREFIX = "random:";

/** Where a random slot draws from: anyone (today's rule), one division, or one conference's divisions. */
export type FlRandomScope = { kind: "any" } | { kind: "division"; id: FlDivision } | { kind: "conference"; id: FlConference };

/** The scope of a random slot value (null: not a random value). Wildcard is no scope of its own (Gerald is chosen, not drawn). */
export function parseFlRandom(value: unknown): FlRandomScope | null {
  if (value === FL_RANDOM) return { kind: "any" };
  if (typeof value !== "string" || !value.startsWith(FL_RANDOM_PREFIX)) return null;
  const id = value.slice(FL_RANDOM_PREFIX.length);
  if (isFlDivision(id) && id !== "wildcard") return { kind: "division", id };
  if (isFlConference(id)) return { kind: "conference", id };
  return null;
}

/** The slot value of a random scope: "random" (null), "random:<division>" or "random:<conference>". */
export function flRandomToken(scope: FlDivision | FlConference | null): string {
  return scope ? `${FL_RANDOM_PREFIX}${scope}` : FL_RANDOM;
}

/** Whether a slot value is drawn by the seed (plain "random" or a token). */
export function isFlRandom(value: unknown): boolean {
  return parseFlRandom(value) !== null;
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
  /** Slots A–D: a roster id or "random" (picked by the seed; --- fl-overhaul --- "random:<division>" / "random:<conference>" stay in one). */
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
  /**
   * --- fl-overhaul --- How fast a fighter turns its flight toward its weapon's preferred distance from the target (radians a
   * second, `FL_SEEK_TURN` by default; 0 = the pure bounce look of the first release).
   */
  seekTurn: number;
  /** --- fl-overhaul --- At the time cap with two sides or more standing: up to 10 s of sudden death in a shrinking arena first. */
  suddenDeath: boolean;
}

/** --- fl-overhaul --- The intent steering's turn rate at the default (radians a second). */
export const FL_SEEK_TURN = 1.1;

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
  seekTurn: FL_SEEK_TURN,
  suddenDeath: true,
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
  flSeek: { min: 0, max: 3, step: 0.05 }, // --- fl-overhaul --- (uncapped: any turn rate from 0 typed)
} as const;

/** The Fight League fields of the SimulatorSettings object (URL keys fl1–fl4, flM, flDiv, flHp, flT, flA, flH, flS1–4, flD1–4, flX1–4, flC1–4, flSk, flSD). */
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
  /** --- fl-overhaul --- The intent steering's turn rate, rad/s (URL `flSk`; 0 = the bounce look). */
  flSeek: number;
  /** --- fl-overhaul --- Sudden death at the time cap (URL `flSD`). */
  flSuddenDeath: boolean;
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
  const seek = finite(c.seekTurn);
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
    // --- fl-overhaul --- (a turn rate from 0 up, three decimals at most, no maximum)
    seekTurn: Number.isFinite(seek) ? Math.round(1000 * atLeastMin(seek, FIGHT_LEAGUE_RANGES.flSeek)) / 1000 : d.seekTurn,
    suddenDeath: typeof c.suddenDeath === "boolean" ? c.suddenDeath : d.suddenDeath,
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
    seekTurn: source.flSeek, // --- fl-overhaul ---
    suddenDeath: source.flSuddenDeath, // --- fl-overhaul ---
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
    flSeek: s.seekTurn, // --- fl-overhaul ---
    flSuddenDeath: s.suddenDeath, // --- fl-overhaul ---
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
NUMERIC_KEYS.flSk = "flSeek"; // --- fl-overhaul ---
/** The feature's URL keys (for tools and the tests). */
export const FIGHT_LEAGUE_URL_KEYS: readonly string[] = ["fl1", "fl2", "fl3", "fl4", "flM", "flDiv", "flA", "flH", "flSD", ...Object.keys(NUMERIC_KEYS)];

/**
 * --- fl-overhaul --- The value a number field of the panel commits for `field`: the settings' own normalisation (HP and the
 * time cap rounded, the multipliers and the turn rate to three decimals, each from its minimum up – no maximum), so the
 * panel, the link and the engine hold the same value (a link once carried `flHp=2.5` while the fight ran 3).
 */
export function flPanelValue(field: keyof FightLeagueFields, value: number): number {
  const resolved = resolveFightLeagueFields({ [field]: value } as Partial<FightLeagueFields>);
  const out = resolved[field];
  return typeof out === "number" ? out : value;
}

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
  if (settings.flSuddenDeath !== base.flSuddenDeath) params.set("flSD", settings.flSuddenDeath ? "1" : "0"); // --- fl-overhaul ---
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
  const sudden = params.get("flSD"); // --- fl-overhaul ---
  if (sudden === "1" || sudden === "0") next.flSuddenDeath = sudden === "1";
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
  /** The arena's centre and half side (the circle: its radius) – live: sudden death shrinks it. */
  cx: number;
  cy: number;
  half: number;
  /** --- fl-overhaul --- The half side before sudden death shrank it (= `side` / 2). */
  fullHalf: number;
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
  return { kind, cx: width / 2, cy: sqTop + FL_ARENA_TOP * sqSide + side / 2, half: side / 2, fullHalf: side / 2, side, sqLeft, sqTop, sqSide, canvasWidth: width, canvasHeight: height };
}

/* ------------------------------------------------------------------ timing and rules */

/** The VS card: the fighters hold still this long before they launch. */
export const FL_INTRO_MS = 1500;
/**
 * A source (a weapon of a fighter, or its abilities) cannot hit the same fighter again for this long (one touch = one hit;
 * the same volley's projectiles excepted) – the heavy kinds' window; the light kinds' is shorter (`flSourceWindowMs()`).
 */
export const FL_IFRAME_MS = 300;
/** --- fl-overhaul --- The shortest window of a light kind (fists, claws, guns, bows, wands, webs, ice, sparks, cards). */
export const FL_MIN_WINDOW_MS = 120;
/** An ability's telegraph at the standard class (the audio's reference; `telegraphMs()` gives every ability's own). */
export const FL_TELEGRAPH_MS = 450;
/** --- fl-overhaul --- The telegraph classes: quick (buffs), standard (aimed casts), area (shockwaves, rings), ultimate. */
export const FL_TELEGRAPH_CLASS_MS = { quick: 300, standard: 450, area: 650, ultimate: 850 } as const;
/** After the last KO a projectile still in the air may land this long (a trade: a double KO). */
export const FL_KO_GRACE_MS = 250;
/**
 * --- fl-overhaul --- Meter an ability gains per hit point dealt and taken (× cast speed), at most `FL_HIT_CHARGE_MAX` /
 * `FL_TAKEN_CHARGE_MAX` a hit.
 */
export const FL_HIT_CHARGE = 0.006;
export const FL_TAKEN_CHARGE = 0.004;
export const FL_HIT_CHARGE_MAX = 0.06;
export const FL_TAKEN_CHARGE_MAX = 0.05;
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
/** A held shield blocks hits coming from within this many degrees of its facing (it faces the target). */
export const FL_SHIELD_ARC_DEG = 40;
/** --- fl-overhaul --- A block spends the shield's guard: no other block for this long (the bracers' `block` style: `FL_BRACERS_GUARD_MS`). */
export const FL_GUARD_MS = 1800;
export const FL_BRACERS_GUARD_MS = 2400;
/** --- fl-overhaul --- Lunges of a melee fighter: at most one per this long, at this many times its cruise (big fighters: `FL_LUNGE_SPEED_BIG`). */
export const FL_LUNGE_EVERY_MS = 1200;
export const FL_LUNGE_SPEED = 1.6;
export const FL_LUNGE_SPEED_BIG = 1.3;
/** --- fl-overhaul --- A tail's swing (s): from its rest behind the ball to the target's bearing and back. */
export const FL_TAIL_SWING = 0.32;
/** --- fl-overhaul --- A homing projectile homes this long, then flies straight and fizzles at `FL_FIZZLE_SEC`. */
export const FL_HOMING_SEC = 1.8;
export const FL_FIZZLE_SEC = 2.6;
/** --- fl-overhaul --- After a hard crowd control (freeze, hold, pin) ends, the fighter is immune to the next one this long. */
export const FL_CC_IMMUNE_MS = 1000;
/** --- fl-overhaul --- Two melee hits trading in one sub-step: one at least this many times the other lands (at half damage); else a clash. */
export const FL_CLASH_RATIO = 1.25;
/** --- fl-overhaul --- A second clash of the same pair within this long is decided by a seeded coin. */
export const FL_CLASH_REPEAT_MS = 2000;
/** --- fl-overhaul --- Sudden death: at most this long after the cap, the arena shrinking to `FL_SUDDEN_MIN` of its side over `FL_SUDDEN_SHRINK_MS`. */
export const FL_SUDDEN_MS = 10_000;
export const FL_SUDDEN_SHRINK_MS = 8000;
export const FL_SUDDEN_MIN = 0.6;
/** --- fl-overhaul --- At the verdict, sides within this HP fraction of each other draw. */
export const FL_DRAW_MARGIN = 0.005;
/** --- fl-overhaul --- A breath: an inhale (no damage) first, then fire until `FL_BREATH_MS` from its start. */
export const FL_INHALE_MS = 120;
export const FL_BREATH_MS = 800;
/** --- fl-overhaul --- A weapon beam glints (the aim locked) this long before its ray of `FL_BEAM_MS`. */
export const FL_GLINT_MS = 150;
export const FL_BEAM_MS = 350;
/** --- fl-overhaul --- The rounds of a burst leave the muzzle this far apart (s, ÷ attack speed). */
export const FL_BURST_GAP = 0.08;
/** --- fl-overhaul --- A full meter of a ranged-limited ability (an instant shockwave, a fire ring, contact) waits at most this long for a foe in range. */
export const FL_CAST_WAIT_MS = 2500;
/** --- fl-overhaul --- The share of the intercept a shot, a card or a thrown weapon leads its target by (half: a strafing foe still dodges). */
export const FL_LEAD = 0.5;
/**
 * --- fl-overhaul --- A foe's area telegraph (a shockwave, a fire ring, arena cuts) nudges every rival within its radius + 1 R
 * away from the caster as it starts (a turn of up to FL_NUDGE × MAX_NUDGE and this much of its cruise added outward), and the
 * rival keeps that heading for the rest of the telegraph (its intent steering does not bring it back in).
 */
export const FL_EVADE_BOOST = 0.15;
/** The page holds the winner banner this long before the end screen (recordings keep it). */
export const FL_WIN_HOLD_SEC = 3;
/** Most fight sounds one rendered frame plays (the strongest win; KOs and abilities always sound). */
export const FL_SOUNDS_PER_FRAME = 6;
/** Pools: projectiles, minions (decoys, summons and – --- fl-overhaul --- – traps), render events, scheduled effects, beams. */
export const FL_PROJECTILE_CAP = 96;
export const FL_MINION_CAP = 24;
export const FL_EVENT_CAP = 192;
const FL_TASK_CAP = 24;
const FL_BEAM_CAP = 8;
/** --- fl-overhaul --- (Stage 2) The barriers of the wall primitive at most in play at once (the view's `walls`). */
export const FL_WALL_CAP = 8;
/** --- fl-overhaul --- A whip's crack: out in FL_WHIP_OUT s, back in FL_WHIP_BACK s; its tip lands at full extension (≥ FL_WHIP_TIP_EXT). */
export const FL_WHIP_OUT = 0.12;
export const FL_WHIP_BACK = 0.18;
export const FL_WHIP_SEC = FL_WHIP_OUT + FL_WHIP_BACK;
export const FL_WHIP_TIP_EXT = 0.9;
/** --- fl-overhaul --- A lasso's snag drags the foe in this long (ms) at this many cruise units. */
export const FL_LASSO_PULL_MS = 500;
export const FL_LASSO_PULL_SPEED = 1.8;
/** --- fl-overhaul --- A bomb's arc peaks this many of its thrower's radii high (visual; no hit while it flies); a fuse lies this long (ms). */
export const FL_BOMB_LIFT = 1.5;
export const FL_FUSE_MS = 500;
/** --- fl-overhaul --- A bomb lands at least this many of its thrower's radii inside the arena. */
export const FL_BOMB_MARGIN = 1.4;
/** --- fl-overhaul --- Traps: armed after FL_TRAP_ARM_MS, dropped FL_TRAP_GAP radii apart, at most FL_TRAPS_PER_OWNER an owner (the oldest pops), FL_TRAP_R of its radius big. */
export const FL_TRAP_ARM_MS = 500;
export const FL_TRAP_GAP = 1.5;
export const FL_TRAPS_PER_OWNER = 4;
export const FL_TRAP_R = 0.35;
/** --- fl-overhaul --- A wall: 2 R in front of its owner, 4 R long when the effect leaves its length out. */
export const FL_WALL_AHEAD = 2;
export const FL_WALL_LENGTH = 4;

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
  // --- fl-overhaul --- (Stage 2) a whip's crack and a bomb's burst: a sharp noise crack over a thump
  whip: "gun",
  bomb: "gun",
};

/**
 * The ability meter after `sec` seconds of charging without hits from `start`, at `castSpeed` for an ability of `charge`
 * seconds (capped at 1 – full). Hits add by their damage: `FL_HIT_CHARGE` a hit point dealt (at most `FL_HIT_CHARGE_MAX` a
 * hit) and `FL_TAKEN_CHARGE` a hit point taken (at most `FL_TAKEN_CHARGE_MAX`), × the cast speed (`hitCharge()`).
 */
export function meterAfter(start: number, sec: number, castSpeed: number, charge: number): number {
  return Math.min(1, start + (Math.max(0, sec) * Math.max(0, castSpeed)) / Math.max(0.1, charge));
}

/** Seconds a meter takes to fill from empty without hits. */
export function chargeSeconds(castSpeed: number, charge: number): number {
  return castSpeed > 0 ? Math.max(0.1, charge) / castSpeed : Infinity;
}

/** --- fl-overhaul --- Meter a hit of `damage` hit points adds to the one who dealt it (`taken` false) or took it, before the cast speed. */
export function hitCharge(damage: number, taken: boolean): number {
  const d = Math.max(0, damage) || 0;
  return taken ? Math.min(FL_TAKEN_CHARGE_MAX, FL_TAKEN_CHARGE * d) : Math.min(FL_HIT_CHARGE_MAX, FL_HIT_CHARGE * d);
}

/**
 * The verdict at the time cap (after sudden death): the side with the largest share of its HP left – Σ hp / Σ maximum HP
 * over its fighters, a knocked-out fighter counting 0 of its maximum – or −1 for a draw (the top two within
 * `FL_DRAW_MARGIN`, or nobody with HP). `hp[i]` is fighter i's HP (≤ 0 when out), `team[i]` its side, `maxHp[i]` its
 * maximum (100 each when left out); `scratch` (at least 2 × `teams` long) spares the arrays a long sudden death would
 * allocate on every step.
 */
export function capVerdict(hp: readonly number[], team: readonly number[], teams: number, scratch?: number[], maxHp?: readonly number[]): number {
  const sums = scratch ?? new Array<number>(2 * teams);
  for (let t = 0; t < 2 * teams; t++) sums[t] = 0;
  for (let i = 0; i < hp.length; i++) {
    const t = team[i];
    if (!(t >= 0 && t < teams)) continue;
    sums[t] += hp[i] > 0 ? hp[i] : 0;
    sums[teams + t] += maxHp ? Math.max(1e-9, maxHp[i]) : 100;
  }
  let best = -1;
  let bestFrac = -Infinity;
  let second = -Infinity;
  for (let t = 0; t < teams; t++) {
    const frac = sums[teams + t] > 0 ? sums[t] / sums[teams + t] : 0;
    if (frac > bestFrac) {
      second = bestFrac;
      bestFrac = frac;
      best = t;
    } else if (frac > second) second = frac;
  }
  if (!(bestFrac > 0)) return -1;
  return bestFrac - second <= FL_DRAW_MARGIN ? -1 : best;
}

/**
 * Damage of a giant hit: × `mult`, × `belowHalf` instead on a foe under half its HP, or – with `maxHpFrac` (`true`: the old
 * half-of-maximum flag, 0.5) – that share of the foe's maximum HP (at least the plain hit).
 */
export function giantDamage(base: number, mult: number, foeHp: number, foeMaxHp: number, belowHalf: number, maxHpFrac: number | boolean): number {
  const frac = maxHpFrac === true ? 0.5 : typeof maxHpFrac === "number" ? maxHpFrac : 0;
  if (frac > 0) return Math.max(base, frac * foeMaxHp);
  if (belowHalf > 0 && foeHp < 0.5 * foeMaxHp) return base * belowHalf;
  return base * mult;
}

/* ------------------------------------------------------------------ --- fl-overhaul --- the rules of a hit (pure) */

/**
 * The window (ms) during which a source cannot hit the same fighter again: for a light kind min(`FL_IFRAME_MS`,
 * max(`FL_MIN_WINDOW_MS`, 0.85 × cooldown ÷ attack speed)) – so a cadence faster than 0.3 s lands every hit (Jinx's
 * minigun, the claws, Little Mac) –, `FL_IFRAME_MS` for the heavy kinds and for abilities, summons and contact (`kind`
 * null). Where the window still binds (a heavy kind sped up past it), it caps the hits a second at 1000 ÷ the window.
 */
export function flSourceWindowMs(kind: FlWeaponKind | null, cooldown: number, attackSpeed: number): number {
  if (!kind || FL_KIND_CONTRACT[kind].window !== "light") return FL_IFRAME_MS;
  const cadence = (1000 * Math.max(0, cooldown)) / Math.max(0.05, attackSpeed);
  return Math.min(FL_IFRAME_MS, Math.max(FL_MIN_WINDOW_MS, 0.85 * cadence));
}

/** Knockback by weight: × size^−1.5 between 0.55 (a heavyweight) and 1.6 (a lightweight). */
export function knockbackWeight(size: number): number {
  const k = Math.pow(Math.max(1e-3, size), -1.5);
  return Math.max(0.55, Math.min(1.6, k));
}

/** A bound of an intent band, in ball radii of gap: `reach` × the weapon's reach + `size` × its size + `c`. */
export interface FlBandRule {
  reach: number;
  size: number;
  c: number;
}

/**
 * The contract of a weapon kind (data: the tests, the README and the later stages read it): where its fighter keeps the
 * target (the intent band, gap in radii – too far it heads in, inside it strafes, too close it backs off), what starts an
 * attack, what sets its cadence, its hit geometry, its window class (`flSourceWindowMs()`), its silhouette, its attack
 * animation and its sound role (`FL_SOUND_OF_KIND`).
 */
export interface FlKindContract {
  band: { lo: FlBandRule | null; hi: FlBandRule };
  trigger: string;
  cadence: string;
  geometry: string;
  window: "light" | "heavy";
  silhouette: string;
  animation: string;
  sound: FlSoundKind;
}

const band = (reach: number, size = 0, c = 0): FlBandRule => ({ reach, size, c });
const SHOOTER_BAND = { lo: band(0, 0, 4), hi: band(0, 0, 9) };
const ORBIT_BAND = { lo: band(1, 0, -0.7), hi: band(1, 0, 0.5) };
const CLOSE_BAND = { lo: null, hi: band(0.8) };
const FIST_BAND = { lo: null, hi: band(1, 1) };
const ARC_BAND = { lo: band(0, 0, 0.5), hi: band(0.85) };

export const FL_KIND_CONTRACT: Readonly<Record<FlWeaponKind, FlKindContract>> = {
  sword: { band: CLOSE_BAND, trigger: "a bounce, a clash, or the target within reach + 0.4 R once the last sweep ended cooldown ÷ attack speed ago", cadence: "cooldown ÷ attack speed between sweeps", geometry: "a thick segment from 0.85 R to (1 + reach) R; a 120° sweep at 1.25× damage, one hit a foe a sweep", window: "heavy", silhouette: "a blade (glow: a saber; double: both ends)", animation: "the sweep's arc", sound: FL_SOUND_OF_KIND.sword },
  hammer: { band: ORBIT_BAND, trigger: "the orbit (the head passing the target); returning: a throw every throwEvery", cadence: "an orbit of cooldown ÷ attack speed", geometry: "a circle (the head) at (1 + reach) R", window: "heavy", silhouette: "a block head on a handle", animation: "the orbit; the throw spins out and back (an empty hand)", sound: FL_SOUND_OF_KIND.hammer },
  fists: { band: FIST_BAND, trigger: "the target within reach + 0.15 R and the cooldown over (contact: the body touching it)", cadence: "cooldown ÷ attack speed", geometry: "a fist circle along the punch (out, hold, back); one hit a punch", window: "light", silhouette: "two gloves (kicks: boots; air: curls of air)", animation: "the punch's extension", sound: FL_SOUND_OF_KIND.fists },
  claws: { band: FIST_BAND, trigger: "the target within reach + 0.15 R and the cooldown over", cadence: "cooldown ÷ attack speed", geometry: "a claw circle along the swipe; one hit a swipe", window: "light", silhouette: "three talons", animation: "a 0.12 s swipe", sound: FL_SOUND_OF_KIND.claws },
  chain: { band: ORBIT_BAND, trigger: "the orbit; pull: a throw every throwEvery", cadence: "an orbit of cooldown ÷ attack speed", geometry: "a circle (the head) on the chain, damage by its momentum", window: "heavy", silhouette: "a kunai or a blade on a chain", animation: "the orbit; the thrown head drags the foe in", sound: FL_SOUND_OF_KIND.chain },
  bow: { band: SHOOTER_BAND, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a projectile circle (one hit a pass)", window: "light", silhouette: "a bow", animation: "the shot", sound: FL_SOUND_OF_KIND.bow },
  gun: { band: SHOOTER_BAND, trigger: "the cooldown over with a target (burst: the next rounds every 0.08 s from the muzzle)", cadence: "cooldown ÷ attack speed", geometry: "a projectile circle (bouncing: off a wall once)", window: "light", silhouette: "a pistol, a rifle, an arm cannon or an energy hand", animation: "the muzzle flash", sound: FL_SOUND_OF_KIND.gun },
  shotgun: { band: { lo: band(0, 0, 1.5), hi: band(0, 0, 4) }, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a fan of pellets reaching `reach` arena sides; the pellets of one volley land together", window: "heavy", silhouette: "a shotgun", animation: "the muzzle flash", sound: FL_SOUND_OF_KIND.shotgun },
  wand: { band: SHOOTER_BAND, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a fast bolt", window: "light", silhouette: "a wand", animation: "the bolt", sound: FL_SOUND_OF_KIND.wand },
  staff: { band: SHOOTER_BAND, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a homing orb (1.8 s of homing, gone at 2.6 s; return: out and back)", window: "heavy", silhouette: "a staff with an orb", animation: "the orb", sound: FL_SOUND_OF_KIND.staff },
  book: { band: SHOOTER_BAND, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a homing page (1.8 s of homing, gone at 2.6 s)", window: "heavy", silhouette: "an open book", animation: "the page", sound: FL_SOUND_OF_KIND.book },
  cards: { band: SHOOTER_BAND, trigger: "a loaded blade and the cooldown over with a target", cadence: "cooldown ÷ attack speed; a reload every 1.25 cooldowns", geometry: "orbiting blade circles and thrown ones (blink: the owner follows every third)", window: "light", silhouette: "cards, daggers, batarangs or shuriken", animation: "the orbit and the throw", sound: FL_SOUND_OF_KIND.cards },
  fire: { band: ARC_BAND, trigger: "the target within reach + 0.6 R and the cooldown over", cadence: "cooldown ÷ attack speed from the breath's start", geometry: "a cone of `spread` degrees and (1 + reach) R; a 120 ms inhale, then ticks on the window (≤ 3 a breath)", window: "heavy", silhouette: "a flame at the rim", animation: "the cone", sound: FL_SOUND_OF_KIND.fire },
  beam: { band: SHOOTER_BAND, trigger: "the cooldown over with a target: a 150 ms glint (the aim locked), then the ray", cadence: "cooldown ÷ attack speed", geometry: "a ray from the hand to the arena's edge for 350 ms, turning ≤ 2 rad/s; one hit a foe a ray", window: "heavy", silhouette: "an energy hand", animation: "the glint and the ray", sound: FL_SOUND_OF_KIND.beam },
  spark: { band: ARC_BAND, trigger: "the target within reach and the cooldown over", cadence: "cooldown ÷ attack speed", geometry: "an instant arc to the target (in a free-for-all or teams, on to a second foe within 2 R at half damage)", window: "light", silhouette: "an energy hand", animation: "the zap from the hand", sound: FL_SOUND_OF_KIND.spark },
  web: { band: SHOOTER_BAND, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a projectile that slows (the strongest slow applies)", window: "light", silhouette: "a web shooter", animation: "the web", sound: FL_SOUND_OF_KIND.web },
  ice: { band: SHOOTER_BAND, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a projectile that freezes (a hard crowd control)", window: "light", silhouette: "an ice shard", animation: "the shard", sound: FL_SOUND_OF_KIND.ice },
  shield: { band: SHOOTER_BAND, trigger: "a throw every throwEvery (block: never thrown)", cadence: "throwEvery ÷ attack speed; a block spends the guard for 1.8 s (bracers 2.4 s)", geometry: "blocks hits within 40° of the target's bearing; the thrown shield a circle (out, a wall, back)", window: "heavy", silhouette: "a round shield (bracers)", animation: "the throw; the block flash", sound: FL_SOUND_OF_KIND.shield },
  tail: { band: CLOSE_BAND, trigger: "the target within reach + 0.3 R in any direction and the cooldown over", cadence: "cooldown ÷ attack speed after each 0.32 s swing", geometry: "a thick segment swinging from its rest behind the ball to the target and back; one hit a foe a swing", window: "heavy", silhouette: "a tail (plates or a blade tip)", animation: "the swing", sound: FL_SOUND_OF_KIND.tail },
  // --- fl-overhaul --- (Stage 2)
  whip: { band: { lo: band(0.55), hi: band(0.95) }, trigger: "the target within reach and the cooldown over (lasso: the crack snags the foe and drags it in 0.5 s, a hard crowd control)", cadence: "cooldown ÷ attack speed", geometry: "a lash cracking out 0.12 s and back 0.18 s along the target's bearing: the tip (size R, from 90 % extension) deals full damage, the outer 40 % of the lash (0.1 R thick) half; one hit a crack", window: "light", silhouette: "a tapered lash (lasso: a loop)", animation: "the crack's extension", sound: FL_SOUND_OF_KIND.whip },
  bomb: { band: { lo: band(0, 0, 3), hi: band(0, 0, 6.5) }, trigger: "the cooldown over with a target", cadence: "cooldown ÷ attack speed", geometry: "a lob of 0.6–0.9 s at the target's predicted spot (1.4 R inside the arena; no hit in the air, over walls); at the landing (fuse: 0.5 s later) a splash of `effect` R + the foe's radius: damage × (1 − 0.4 × the edge share), knockback from the centre", window: "heavy", silhouette: "a flask, a grenade or a stick of dynamite", animation: "the arc over its shadow; the burst", sound: FL_SOUND_OF_KIND.bomb },
};

/** --- fl-overhaul --- A whip crack's extension at `t` seconds into it: out to 1 in FL_WHIP_OUT, back to 0 in FL_WHIP_BACK. */
export function whipExtension(t: number): number {
  if (t < 0) return 0;
  if (t < FL_WHIP_OUT) return t / FL_WHIP_OUT;
  if (t < FL_WHIP_SEC) return 1 - (t - FL_WHIP_OUT) / FL_WHIP_BACK;
  return 0;
}

/**
 * --- fl-overhaul --- A bomb's height over its ground point at `now` (px; the renderer lifts it): 4 H u (1 − u) with u its flight's
 * share (from `flyFrom` to `flyUntil`) and H its lift – 0 before it leaves and once it lands.
 */
export function flBombHeight(p: { flyFrom: number; flyUntil: number; lift: number }, now: number): number {
  const span = p.flyUntil - p.flyFrom;
  if (!(span > 0)) return 0;
  const u = Math.max(0, Math.min(1, (now - p.flyFrom) / span));
  return 4 * p.lift * u * (1 - u);
}

/** The band (gap in radii) a fighter keeps from its target with this weapon as its first: [lo, hi] (lo −Infinity: no minimum). */
export function intentBand(spec: Pick<FlWeaponSpec, "kind"> & { reach: number; size: number }): { lo: number; hi: number } {
  const b = FL_KIND_CONTRACT[spec.kind].band;
  const at = (r: FlBandRule) => r.reach * spec.reach + r.size * spec.size + r.c;
  return { lo: b.lo ? at(b.lo) : -Infinity, hi: at(b.hi) };
}

/** The telegraph of an ability (ms): the longest class among its primitives, `FL_TELEGRAPH_CLASS_MS.ultimate` for an ultimate. */
export function telegraphMs(ability: { charge: number; ultimate?: boolean; effects: readonly { p: string }[] }): number {
  const C = FL_TELEGRAPH_CLASS_MS;
  if (ability.ultimate || ability.charge >= 13) return C.ultimate;
  let ms: number = C.quick;
  for (const e of ability.effects) {
    switch (e.p) {
      case "shockwave":
      case "fireRing":
      case "arenaCuts":
      case "freezeAll":
      case "slowTime":
        ms = Math.max(ms, C.area);
        break;
      case "beam":
      case "volley":
      case "pull":
      case "choke":
      case "disarm":
      case "confuse":
      case "blinkStrike":
      case "lightning":
      case "trap":
      case "wall":
        ms = Math.max(ms, C.standard);
        break;
      default:
        break;
    }
  }
  return ms;
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

/** --- fl-overhaul --- Squared distance between the segments (ax, ay)–(bx, by) and (cx, cy)–(dx, dy) (0 when they cross). */
export function segmentSegmentDistanceSq(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) > 1e-12) {
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
    const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(segmentDistanceSq(ax, ay, bx, by, cx, cy), segmentDistanceSq(ax, ay, bx, by, dx, dy), segmentDistanceSq(cx, cy, dx, dy, ax, ay), segmentDistanceSq(cx, cy, dx, dy, bx, by));
}

/** --- fl-overhaul --- A barrier of the wall primitive as the geometry sees it: its ends, its side and whether it is up. */
export interface FlWallSegment {
  active: boolean;
  team: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * --- fl-overhaul --- Length of the ray from (ox, oy) along the unit direction (dx, dy) to the arena's edge or to the nearest wall
 * of a side other than `team` it meets first (a beam stops at an enemy wall; `walls` left out: `rayToEdge()`).
 */
export function rayToEdgeOrWall(field: Pick<FlField, "kind" | "cx" | "cy" | "half">, ox: number, oy: number, dx: number, dy: number, walls?: readonly FlWallSegment[], team = -1): number {
  let len = rayToEdge(field, ox, oy, dx, dy);
  if (!walls) return len;
  for (const w of walls) {
    if (!w.active || w.team === team) continue;
    const sx = w.x2 - w.x1;
    const sy = w.y2 - w.y1;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((w.x1 - ox) * sy - (w.y1 - oy) * sx) / den;
    const u = ((w.x1 - ox) * dy - (w.y1 - oy) * dx) / den;
    if (t >= 0 && t < len && u >= 0 && u <= 1) len = t;
  }
  return len;
}

/**
 * --- fl-overhaul --- (Stage 2) Where a point at (x, y) flying at (vx, vy) is after `t` seconds when it bounces off the arena's
 * walls (`lim`: how far from the centre its centre may go – the half side minus its radius): a square folds each axis back, a
 * circle reflects it at the rim (at most four times). Pure: a bomb's aim.
 */
export function foldedFlight(field: Pick<FlField, "kind" | "cx" | "cy">, x: number, y: number, vx: number, vy: number, t: number, lim: number, out: { x: number; y: number }): { x: number; y: number } {
  const L = Math.max(1e-6, lim);
  if (field.kind !== "circle") {
    const fold = (p: number) => {
      const period = 4 * L;
      let q = (((p + L) % period) + period) % period;
      if (q > 2 * L) q = period - q;
      return q - L;
    };
    out.x = field.cx + fold(x - field.cx + vx * t);
    out.y = field.cy + fold(y - field.cy + vy * t);
    return out;
  }
  let px = x - field.cx;
  let py = y - field.cy;
  let dx = vx;
  let dy = vy;
  let left = Math.max(0, t);
  for (let k = 0; k < 4 && left > 0; k++) {
    // The time to the rim along (dx, dy) from inside: |p + s d| = L.
    const a = dx * dx + dy * dy;
    if (!(a > 1e-12)) break;
    const b = px * dx + py * dy;
    const c = px * px + py * py - L * L;
    const disc = b * b - a * c;
    const s = disc > 0 ? (-b + Math.sqrt(disc)) / a : 0;
    if (s >= left) {
      px += dx * left;
      py += dy * left;
      left = 0;
      break;
    }
    px += dx * s;
    py += dy * s;
    left -= s;
    const d = Math.hypot(px, py) || 1;
    const nx = px / d;
    const ny = py / d;
    const vn = dx * nx + dy * ny;
    dx -= 2 * vn * nx;
    dy -= 2 * vn * ny;
  }
  if (left > 0) {
    px += dx * left;
    py += dy * left;
  }
  out.x = field.cx + px;
  out.y = field.cy + py;
  return out;
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

/** --- fl-overhaul --- The divisions a random slot may draw from (every one but Wildcard: Gerald is chosen, never drawn). */
const DRAW_DIVISIONS: readonly FlDivision[] = FL_DIVISIONS.filter((d) => d !== "wildcard");
const NON_WILDCARD: readonly FlFighterRow[] = FL_ROSTER.filter((r) => r.division !== "wildcard");

/** --- fl-overhaul --- The pick of `u` (one draw in [0, 1)) from `pool`'s fighters not yet in the match (all of `pool` when none is left). */
function drawFresh(pool: readonly FlFighterRow[], taken: readonly (FlFighterRow | null)[], u: number): FlFighterRow {
  const fresh = pool.filter((r) => !taken.some((o) => o && o.id === r.id));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.min(from.length - 1, Math.floor(u * from.length))] ?? FL_ROSTER[0];
}

/**
 * The fighters of a run: slot by slot the chosen id, or – for a random slot – a pick by the seed (`random()`: exactly one draw
 * per random slot, in slot order, so old links keep their draw count), avoiding fighters already in the match while the pool
 * allows. --- fl-overhaul --- (Stage 2) A scoped slot draws from its division (`random:<division>`) or its conference
 * (`random:<conference>`). A plain "random" slot follows today's rule: with `sameDivision` off, anyone; on, the division of the
 * first chosen fighter (the first pick's when none is chosen) – and when that division cannot supply a fighter not yet in the
 * match, every other division but Wildcard; with Gerald chosen (the anchor Wildcard) every division but Wildcard (a random slot
 * next to Gerald never draws Gerald); a fully random match first draws a division uniformly (Wildcard left out), then a fighter
 * in it – both from the slot's one draw (its integer and fractional parts).
 */
export function pickFighters(settings: Pick<FightLeagueSettings, "fighters" | "match" | "sameDivision">, random: () => number): FlFighterRow[] {
  const n = matchFighters(settings.match);
  const out: (FlFighterRow | null)[] = [];
  let division: FlDivision | null = null;
  for (let i = 0; i < n; i++) {
    const id = settings.fighters[i];
    const row = id && !isFlRandom(id) ? (FL_BY_ID.get(id) ?? null) : null;
    out.push(row);
    if (row && !division) division = row.division;
  }
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    const scope = parseFlRandom(settings.fighters[i]) ?? { kind: "any" as const };
    const u = random();
    let pick: FlFighterRow;
    if (scope.kind === "division") pick = drawFresh(fightersOf(scope.id), out, u);
    else if (scope.kind === "conference") pick = drawFresh(fightersOfConference(scope.id), out, u);
    else if (!settings.sameDivision) pick = drawFresh(FL_ROSTER, out, u);
    else if (division && division !== "wildcard") {
      const pool = fightersOf(division);
      pick = pool.some((r) => !out.some((o) => o && o.id === r.id)) ? drawFresh(pool, out, u) : drawFresh(NON_WILDCARD, out, u);
    } else if (division === "wildcard") pick = drawFresh(NON_WILDCARD, out, u);
    else {
      const x = Math.min(DRAW_DIVISIONS.length - 1e-9, Math.max(0, u * DRAW_DIVISIONS.length));
      const d = DRAW_DIVISIONS[Math.floor(x)];
      pick = drawFresh(fightersOf(d), out, x - Math.floor(x));
    }
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
  // --- fl-overhaul ---
  /** Damage this weapon dealt (the contract probe's DPS). */
  dealt = 0;
  /** A sword: when its last sweep ended (simulation ms). */
  lastSweepEnd = -Infinity;
  /** A burst gun: rounds still to fire, seconds to the next one (÷ attack speed) and the trigger's volley. */
  burstLeft = 0;
  burstT = 0;
  burstVolley = 0;
  /** Fire: the breath's inhale ends (ms; it burns from then until `onUntil`). */
  inhaleUntil = -1;
  /** A shield: no block before this (ms) – a block spends the guard. */
  guardUntil = -Infinity;
  /** A weapon beam: the glint's end (ms, −1 none) and the bearing of the point it locked (below). */
  glintUntil = -1;
  glintAim = 0;
  /** A weapon beam: the point the glint locked (the target where it stood at the glint's start; the ray fires at it). */
  glintX = 0;
  glintY = 0;
  /** A spark: the zap's angle out of the hand, and a chained second arc (ms, where it struck). */
  zapAngle = 0;
  zap2Ms = -Infinity;
  zap2X = 0;
  zap2Y = 0;
  /** A tail: the swing's clock (s; −1 at rest) and the angle it swung from. */
  swingT = -1;
  swingFrom = 0;
  /** A sword: the sweep's centre (radians; it follows the bearing of the foe the sweep started at) and that foe (−1 none). */
  sweepCentre = 0;
  sweepTarget = -1;
  // --- end fl-overhaul ---

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
  /** --- fl-overhaul --- A giant hit worth this share of the foe's maximum HP (0: none; Saitama's 0.4). */
  giantFrac = 0;
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
  // --- fl-overhaul ---
  /** The projectile of the last volley hit taken: another projectile of that volley still lands, the same one never twice. */
  lastVolleyProj = -1;
  /**
   * Per-source invulnerability windows (simulation ms): index = attacker slot × 8 + weapon index (7: the attacker's abilities,
   * summons, contact and reflected damage) – one touch of one source is one hit, while two sources may land together.
   */
  readonly srcUntil = new Float64Array(64).fill(-Infinity);
  /** Immune to hard crowd control (freezes, holds, pins) until (ms); the telegraph after an interrupt cannot be interrupted. */
  ccImmuneUntil = -Infinity;
  uninterruptible = false;
  /** The telegraph's start (ms, −1 none), the point its aim locked on, the area it threatens (px, 0 none) and the foes inside at its start. */
  telegraphStart = -1;
  castX = 0;
  castY = 0;
  telegraphArea = 0;
  telegraphMask = 0;
  /** When the meter filled (ms, −1 not full): a range-limited ability waits for a foe in range at most `FL_CAST_WAIT_MS` from it. */
  fullMs = -1;
  /** The last cast and the last lunge (ms; the renderer's flash and streak). */
  lastCastMs = -Infinity;
  lungeMs = -Infinity;
  /** A hold queued behind a pull (the Lasso of Truth): by whom (−1 none), how long, its damage and when it bites. */
  pendingHoldBy = -1;
  pendingHoldDur = 0;
  pendingHoldDamage = 0;
  pendingHoldAt: "start" | "over" | "end" = "start";
  /** The intent band of its first weapon (gap in radii) and its knockback weight (`knockbackWeight()` of its size). */
  bandLo = -Infinity;
  bandHi = Infinity;
  weight = 1;
  /** The last IMMUNE callout (ms; at most one every FL_IFRAME_MS). */
  immuneMs = -Infinity;
  /** Counters: its projectiles that grazed (refused by a window), its weapon clashes, the area casts it dodged. */
  grazes = 0;
  clashes = 0;
  dodges = 0;
  // (Stage 2)
  /** The ball's radius without a transform (px), the transform's size factor and its end (ms). */
  baseR = 10;
  sizeMul = 1;
  transformUntil = -Infinity;
  /** Drain: until (ms), and the share of the damage it deals that heals it back. */
  drainUntil = -Infinity;
  drainFrac = 0;
  /** The reflection deflects enemy projectiles back at their shooter (Soresu) while it lasts. */
  deflect = false;
  // --- end fl-overhaul ---

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
/** --- fl-overhaul --- (Stage 2) A lobbed bomb: flies over everything to its landing spot, bursts there (after its fuse). */
export const PK_BOMB = 6;

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
  // --- fl-overhaul ---
  /** A serial id: a volley's other projectiles land together, the same one never twice in a window. */
  id = 0;
  /** Foes hit on the way out: they leave the hit mask only once it has separated from them (no second hit at the turn). */
  sepMask = 0;
  /** It homes until (ms), then flies straight; it fizzles at (ms; Infinity: never). */
  homeUntil = Infinity;
  fizzleAt = Infinity;
  // (Stage 2)
  /** A volley that pierces: it flies on through every foe it hits (each once). */
  pierce = false;
  /** A bomb: where it left and where it lands (px), its flight (ms done, ms long), the flight's span on the clock (the renderer's arc), its lift and splash (px), its fuse (ms; 0 none) and the fuse's end (ms; −1 not lit). */
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  flyT = 0;
  flyDur = 0;
  flyFrom = 0;
  flyUntil = 0;
  lift = 0;
  splash = 0;
  fuseMs = 0;
  fuseUntil = -1;
  // --- end fl-overhaul ---
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
  // --- fl-overhaul --- (Stage 2)
  /** A trap: lies still, armed from `armedAt` (ms); the first foe to touch it takes its damage and is held `hold` seconds. */
  trap = false;
  armedAt = 0;
  hold = 0;
}

/** --- fl-overhaul --- (Stage 2) A barrier of the wall primitive: a segment that stops enemy projectiles and beams (`solid`: foes bounce off it too). */
export class FlWall implements FlWallSegment {
  active = false;
  owner = 0;
  team = 0;
  x1 = 0;
  y1 = 0;
  x2 = 0;
  y2 = 0;
  born = 0;
  until = 0;
  solid = false;
  shape: FlShape = "windwall";
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
// --- fl-overhaul --- the fair hit pipeline's and the new rules' events
/** A projectile refused by a per-source window (it ends there; one carrying a giant hit passes through). */
export const EV_GRAZE = 13;
/** A hit refused by invulnerability, or a hard crowd control refused by the immunity after the last one. */
export const EV_IMMUNE = 14;
/** Two melee hits traded in one sub-step, neither the stronger by FL_CLASH_RATIO: both parried, knocked apart. */
export const EV_CLASH = 15;
/** A hard crowd control interrupted a telegraph (the meter back to half). */
export const EV_INTERRUPT = 16;
/** A foe inside an area telegraph at its start was outside it when it fired. */
export const EV_DODGE = 17;
/** Sudden death began. */
export const EV_SUDDEN = 18;
/** A wall hit above twice the fighter's cruise (`value`: the speed over the cruise). */
export const EV_SLAM = 19;
/** A wall bounce (`value`: the wall's index). */
export const EV_RIM = 20;
/** --- fl-overhaul --- (Stage 2) A transform starts (`value` 1) or ends (0). */
export const EV_TRANSFORM = 21;
/** --- fl-overhaul --- (Stage 2) A trap snapped shut on a foe (at the trap; `slot`: the trap's owner). */
export const EV_TRAP = 22;

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
  /** --- fl-overhaul --- The source of a hit (attacker slot × 8 + weapon index, 7: abilities, summons, contact; −1 none). */
  src = -1;
}

/** --- fl-overhaul --- A melee hit queued in a sub-step until every fighter's weapons ran (`resolveMelee()`). */
class FlMeleeHit {
  attacker = 0;
  target = 0;
  weapon = 0;
  damage = 0;
  kb = 0;
  dx = 0;
  dy = 0;
  fromX = 0;
  fromY = 0;
  sound: FlSoundKind = "blade";
  done = false;
}
/** Melee hits a sub-step queues at most (past it they land at once). */
const FL_MELEE_CAP = 16;

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
  // --- fl-overhaul ---
  /** Counters: grazes (projectiles refused by a window), refusals by invulnerability or crowd-control immunity, weapon clashes, interrupts, dodges. */
  grazes: number;
  immunes: number;
  clashes2: number;
  interrupts: number;
  dodges: number;
  /** Sudden death: when it began (ms, −1 not yet) and the arena's scale now (1 → FL_SUDDEN_MIN). */
  suddenMs: number;
  shrink: number;
  /** The last KO (ms, −Infinity none; the renderer's flash). */
  lastKoMs: number;
  /** (Stage 2) The barriers of the wall primitive (a pool of FL_WALL_CAP). */
  walls: FlWall[];
  // --- end fl-overhaul ---
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
    grazes: 0,
    immunes: 0,
    clashes2: 0,
    interrupts: 0,
    dodges: 0,
    suddenMs: -1,
    shrink: 1,
    lastKoMs: -Infinity,
    walls: Array.from({ length: FL_WALL_CAP }, () => new FlWall()),
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

/** --- fl-overhaul --- What `hit()` did: landed, or why it did not. */
const HIT_NONE = 0;
const HIT_LANDED = 1;
/** Refused by the source's window (`FlFighter.srcUntil`). */
const HIT_WINDOW = 2;
/** A held shield blocked it. */
const HIT_BLOCKED = 3;
/** The target was invulnerable. */
const HIT_IMMUNE = 4;

/** --- fl-overhaul --- A fighter is as big as typed while it fits: at most this share of the arena's half side (a Ball Size of 180 once filled the canvas and ended the run at once). */
export const FL_FIT_RADIUS = 0.42;
/** --- fl-overhaul --- Melee kinds that lunge when ready (orbiting hammers and chains never do). */
const LUNGE_KINDS: ReadonlySet<FlWeaponKind> = new Set(["sword", "fists", "claws", "tail", "whip"]);
/** --- fl-overhaul --- Abilities whose effects all need a fighter (not a decoy) to act on. */
const FIGHTER_ONLY: ReadonlySet<string> = new Set(["choke", "disarm", "pull"]);

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
  // --- fl-overhaul ---
  /** Projectile ids, and the 60 Hz steps so far: their parity orders the weapons and the casts (0 → n, then n → 0). */
  private projSerial = 0;
  private stepIndex = 0;
  private readonly order: FlFighter[] = [];
  /** Melee hits queued in the sub-step (`resolveMelee()`), and when each pair last clashed (index lower slot × 8 + higher). */
  private readonly melee: FlMeleeHit[] = Array.from({ length: FL_MELEE_CAP }, () => new FlMeleeHit());
  private meleeCount = 0;
  private readonly pairClashMs = new Float64Array(64).fill(-Infinity);
  // --- end fl-overhaul ---
  private readonly budget = new FightSoundBudget();
  private readonly urgent: SoundEvent[] = [];
  private rigK = 0;
  private rigChosen = -1;
  /** The engine's context (the same object for the engine's life): the run's random numbers. */
  private ctxRef: ModeContext | null = null;
  /** Scratch (no allocation per step): a target's position and motion for the weapons, the rebounds' nudge and the steering, the rig's sums. */
  private readonly tgtW = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
  private readonly tgtN = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
  private readonly tgtS = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
  private readonly rival = new Float64Array(4);
  private readonly rivalMax = new Float64Array(4);
  private readonly capHp: number[] = [];
  private readonly capTeam: number[] = [];
  private readonly capMax: number[] = [];
  private readonly capSums: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

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
    v.grazes = v.immunes = v.clashes2 = v.interrupts = v.dodges = 0;
    v.suddenMs = -1;
    v.shrink = 1;
    v.lastKoMs = -Infinity;
    v.lastHitMs = 0;
    v.eventSerial = 0;
    for (const p of v.projectiles) {
      p.active = false;
      p.weapon = -1;
      p.volley = 0;
    }
    for (const m of v.minions) {
      m.active = false;
      m.trap = false;
    }
    for (const b of v.beams) b.active = false;
    for (const t of v.tasks) t.active = false;
    for (const w of v.walls) w.active = false; // --- fl-overhaul ---
    for (const e of v.events) {
      e.t = -Infinity;
      e.src = -1;
    }
    this.koThisStep = false;
    this.graceUntil = -1;
    this.volleySerial = 0;
    this.projSerial = 0;
    this.stepIndex = 0;
    this.meleeCount = 0;
    this.pairClashMs.fill(-Infinity);
    this.budget.clear();
    this.urgent.length = 0;
    this.rigK = 0;
    this.rigChosen = v.forcedWinner;
    this.ballRadius = ctx.config.ballRadius || 8;
    this.unit = this.speedUnit(ctx);

    // The run's random numbers, in this order (the header lists every later draw): one per random slot (pickFighters), then
    // per fighter in slot order its spawn jitter (x, y), then per fighter its launch heading, then per fighter its cadence
    // jitter and its meter's head start.
    const rows = pickFighters(s, () => ctx.random());
    const n = rows.length;
    const firstId = ctx.getNextId();
    const r0 = FL_BALL_FRAC * field.side * Math.max(0.25, this.ballRadius / 8);
    const fit = FL_FIT_RADIUS * field.half;
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
      // --- fl-overhaul --- as big as typed while it fits the arena; its weight; its weapon's intent band
      f.r = Math.min(r0 * row.stats.size, fit);
      f.baseR = f.r;
      f.weight = knockbackWeight(row.stats.size);
      const lead = f.weapons[0].spec;
      const band = row.intent ?? intentBand(lead);
      f.bandLo = band.lo;
      f.bandHi = band.hi;
      // A spot of the formation (half way to the walls), jittered a little by the seed.
      const jx = (ctx.random() - 0.5) * 0.08 * field.side;
      const jy = (ctx.random() - 0.5) * 0.08 * field.side;
      const room = field.half - f.r - 2;
      const sx = spots[2 * i] * 0.5 * field.half + jx;
      const sy = spots[2 * i + 1] * 0.5 * field.half + jy;
      f.x = field.cx + Math.max(-room, Math.min(room, sx));
      f.y = field.cy + Math.max(-room, Math.min(room, sy));
      f.ballId = firstId + i;
      v.fighters.push(f);
    }
    // --- fl-overhaul --- The launch: at the nearest foe, ± a seeded 20°.
    for (const f of v.fighters) {
      let best = Infinity;
      let bearing = Math.atan2(field.cy - f.y, field.cx - f.x);
      for (const o of v.fighters) {
        if (o.team === f.team) continue;
        const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2;
        if (d < best) {
          best = d;
          bearing = Math.atan2(o.y - f.y, o.x - f.x);
        }
      }
      const heading = bearing + (ctx.random() - 0.5) * 2 * 20 * DEG;
      f.keptVx = Math.cos(heading);
      f.keptVy = Math.sin(heading);
      f.kept = true;
      f.aim = bearing;
    }
    // --- fl-overhaul --- The cadence jitter: no two fighters (a mirror match above all) start their attacks in step.
    for (const f of v.fighters) {
      const r = ctx.random();
      const r2 = ctx.random();
      for (const w of f.weapons) {
        w.angle = f.aim;
        // (--- fl-overhaul --- Stage 2: a bomb's flight and fuse already delay its first burst, so its first lob comes sooner)
        w.cd = 0.15 + 0.4 * w.index + r * (w.spec.kind === "bomb" ? 0.25 : 0.6) * w.spec.cooldown;
        w.throwCd = w.spec.throwEvery > 0 ? 0.3 * w.spec.throwEvery + r * 0.4 * w.spec.throwEvery : 0;
        w.phase = r * TWO_PI;
        w.loaded = w.spec.kind === "cards" ? w.spec.count : 0;
        w.orbit = f.aim;
      }
      f.meter = 0.08 * r2;
    }
    for (const f of v.fighters) ctx.addBall({ x: f.x, y: f.y, vx: 0, vy: 0, radius: f.r, color: f.row.body, team: f.team, radiusScale: f.r / this.ballRadius });
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

  /** Whether `f` acts (moves its weapons, casts) – --- fl-overhaul --- not once a hit of this step took its last HP. */
  private canAct(f: FlFighter, now: number): boolean {
    return f.alive && f.hp > 0 && now >= this.view.introMs && now >= f.frozenUntil && f.heldBy < 0 && !this.view.finished;
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
      if (!m.active || m.summon || m.trap || m.team === f.team) continue; // (--- fl-overhaul --- a trap is never a target)
      const d = (m.x - f.x) ** 2 + (m.y - f.y) ** 2;
      if (d < best) {
        best = d;
        f.targetSlot = -1;
        f.targetMinion = i;
      }
    }
  }

  /** --- fl-overhaul --- The nearest live, targetable foe FIGHTER of `f` (decoys ignored: a choke, a disarm or a pull acts on a fighter). */
  private nearestFoeFighter(f: FlFighter, now: number): FlFighter | null {
    let best: FlFighter | null = null;
    let bestD = Infinity;
    for (const o of this.view.fighters) {
      if (o.team === f.team || !this.targetable(o, now)) continue;
      const d = (o.x - f.x) ** 2 + (o.y - f.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
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

  private pushEvent(kind: number, t: number, x: number, y: number, value = 0, slot = -1, color = "#fff", x2 = 0, y2 = 0, src = -1) {
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
    e.src = src;
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

  /** --- fl-overhaul --- A free barrier of the wall pool (the oldest one when every one is up). */
  private freeWall(): FlWall {
    let oldest: FlWall | null = null;
    for (const w of this.view.walls) {
      if (!w.active) return w;
      if (!oldest || w.born < oldest.born) oldest = w;
    }
    return oldest!;
  }

  /** --- fl-overhaul --- The fighters in this step's processing order: slot order on even steps, reversed on odd ones (no slot strikes first every time). */
  private processingOrder(): FlFighter[] {
    const out = this.order;
    const fs = this.view.fighters;
    out.length = fs.length;
    const odd = (this.stepIndex & 1) === 1;
    for (let i = 0; i < fs.length; i++) out[i] = fs[odd ? fs.length - 1 - i : i];
    return out;
  }

  /** --- fl-overhaul --- Gap between `f`'s body and a target circle, in `f`'s radii. */
  private gapR(f: FlFighter, x: number, y: number, r: number): number {
    return (Math.hypot(x - f.x, y - f.y) - f.r - r) / Math.max(1e-6, f.r);
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
    this.stepIndex++;
    const field = v.field;
    if (!field) return;
    this.indexBalls(ctx);
    this.unit = this.speedUnit(ctx);
    this.updateRig();
    this.updateSudden(now);
    const dt = dtMs / 1000;
    const started = now >= v.introMs;
    const live = !v.finished;
    // Positions and targets first, the statuses that run per step (heals, chokes ticking) …
    for (const f of v.fighters) {
      const ball = this.byIndex[f.slot];
      if (!f.alive || !ball) continue;
      f.r = ball.radius;
      f.x = ball.x;
      f.y = ball.y;
      if (!live) continue;
      if (f.sizeMul !== 1 && now >= f.transformUntil) this.endTransform(f, now); // --- fl-overhaul --- (Stage 2)
      this.pickTarget(f, now);
      if (now < f.healUntil && f.healRate > 0) f.hp = Math.min(f.maxHp, f.hp + f.healRate * dt);
      if (f.heldBy >= 0) this.stepHold(ctx, f, now);
    }
    // … then the meters, telegraphs and casts in the step's processing order, then every fighter's steering.
    if (started && live) for (const f of this.processingOrder()) if (f.alive && this.byIndex[f.slot]) this.stepAbility(ctx, f, now, dt);
    for (const f of v.fighters) {
      const ball = this.byIndex[f.slot];
      if (f.alive && ball) this.steer(f, ball, now, started, dt);
    }
    this.stepTasks(ctx, now);
    // --- fl-overhaul --- (Stage 2) a wall stands its time, or until its owner falls
    for (const w of v.walls) if (w.active && (now >= w.until || !v.fighters[w.owner]?.alive)) w.active = false;
  }

  /** --- fl-overhaul --- (Stage 2) The fighter's ball at its base size × its transform's, at most FL_FIT_RADIUS of the arena's half side. */
  private applySize(f: FlFighter) {
    const field = this.view.field;
    if (!field) return;
    const r = Math.min(f.baseR * f.sizeMul, FL_FIT_RADIUS * field.fullHalf);
    f.r = r;
    const ball = this.byIndex[f.slot];
    if (ball) {
      ball.radius = r;
      ball.radiusScale = r / Math.max(1e-6, this.ballRadius);
    }
  }

  /** --- fl-overhaul --- (Stage 2) A transform ends: the base size and weight back (its bursts end on their own clocks), EV_TRANSFORM 0. */
  private endTransform(f: FlFighter, now: number) {
    f.sizeMul = 1;
    f.transformUntil = -Infinity;
    f.weight = knockbackWeight(f.row.stats.size);
    this.applySize(f);
    this.pushEvent(EV_TRANSFORM, now, f.x, f.y, 0, f.slot, f.row.accent);
  }

  /** --- fl-overhaul --- Sudden death: the arena shrinks linearly to FL_SUDDEN_MIN of its side over FL_SUDDEN_SHRINK_MS (the walls push the fighters in). */
  private updateSudden(now: number) {
    const v = this.view;
    const field = v.field;
    if (!field || v.suddenMs < 0 || v.finished) return;
    const k = Math.max(0, Math.min(1, (now - v.suddenMs) / FL_SUDDEN_SHRINK_MS));
    v.shrink = 1 - (1 - FL_SUDDEN_MIN) * k;
    field.half = field.fullHalf * v.shrink;
  }

  /**
   * The fighter's velocity this step: launch, freeze, holds, pulls (a lasso closes its hold on arrival), the speed relaxing
   * toward the cruising speed, then – --- fl-overhaul --- – a lunge at a foe in reach, the evade from a foe's area telegraph,
   * or the intent steering toward the weapon's preferred distance.
   */
  private steer(f: FlFighter, ball: Ball, now: number, started: boolean, dt: number) {
    const v = this.view;
    const ts = this.timeScale(f.team, now);
    let cruise = this.unit * f.speed * ts;
    if (now < f.speedMulUntil) cruise *= f.speedMul;
    if (now < f.slowUntil) cruise *= f.slowFactor;
    if (now < f.confusedUntil) cruise *= 0.6;
    f.cruise = cruise;
    const frozen = !started || now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil || v.finished;
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
      const by = v.fighters[f.pullBy];
      const dx = by.x - f.x;
      const dy = by.y - f.y;
      const d = Math.hypot(dx, dy);
      if (by.alive && d > f.r + by.r + 2) {
        ball.vx = (dx / d) * f.pullSpeed;
        ball.vy = (dy / d) * f.pullSpeed;
        f.vx = ball.vx;
        f.vy = ball.vy;
        return;
      }
      f.pullUntil = -Infinity;
    }
    // --- fl-overhaul --- a hold queued behind the pull closes now: on arrival, or where the pull ran out
    if (f.pendingHoldBy >= 0) {
      this.landPendingHold(f, now);
      if (f.heldBy >= 0) {
        ball.vx = ball.vy = 0;
        f.vx = f.vy = 0;
        return;
      }
    }
    const s = Math.hypot(ball.vx, ball.vy);
    if (s < 1e-6) {
      const a = Math.atan2(v.field!.cy - f.y, v.field!.cx - f.x) + 0.7;
      ball.vx = Math.cos(a) * cruise;
      ball.vy = Math.sin(a) * cruise;
    } else {
      const next = Math.min(FL_SPEED_CAP * Math.max(cruise, 1), s + (cruise - s) * FL_SPEED_RELAX);
      ball.vx *= next / s;
      ball.vy *= next / s;
    }
    if (!v.finished && started && !this.lunge(f, ball, now)) this.intentSteer(f, ball, now, dt);
    f.vx = ball.vx;
    f.vy = ball.vy;
  }

  /** --- fl-overhaul --- A foe's area telegraph (a shockwave, a fire ring, arena cuts) `f` stands in, or null. */
  private areaThreat(f: FlFighter): FlFighter | null {
    for (const o of this.view.fighters) {
      if (o.team === f.team || !o.alive || o.telegraphUntil < 0 || !(o.telegraphArea > 0)) continue;
      if (Math.hypot(f.x - o.x, f.y - o.y) <= o.telegraphArea + f.r + o.r) return o;
    }
    return null;
  }

  /**
   * --- fl-overhaul --- The evade nudge of a rival `o` as `f`'s area telegraph starts: its flight turned away from the caster
   * by up to FL_NUDGE × MAX_NUDGE and FL_EVADE_BOOST of its cruise added outward (deterministic).
   */
  private evadeNudge(o: FlFighter, f: FlFighter) {
    const ball = this.byIndex[o.slot];
    if (!ball || this.pinned(o, this.now())) return;
    const dx = o.x - f.x;
    const dy = o.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    steerToward(ball.vx, ball.vy, dx, dy, FL_NUDGE * MAX_NUDGE, 0, 0, tmpSteer);
    ball.vx = tmpSteer.vx + (dx / d) * FL_EVADE_BOOST * o.cruise;
    ball.vy = tmpSteer.vy + (dy / d) * FL_EVADE_BOOST * o.cruise;
    o.vx = ball.vx;
    o.vy = ball.vy;
  }

  /** --- fl-overhaul --- Whether `f`'s melee weapon `w` is ready to strike (the lunge waits for it). */
  private weaponReady(f: FlFighter, w: FlWeaponState, now: number): boolean {
    switch (w.spec.kind) {
      case "sword":
        return w.sweepT <= 0 && now - w.lastSweepEnd >= (1000 * w.spec.cooldown) / this.attackOf(f, now);
      case "fists":
      case "claws":
        return w.cd <= 0 && w.punchT < 0;
      case "tail":
        return w.cd <= 0 && w.swingT < 0;
      case "whip": // --- fl-overhaul --- (Stage 2)
        return w.cd <= 0 && w.punchT < 0;
      default:
        return false;
    }
  }

  /**
   * --- fl-overhaul --- A melee fighter whose weapon is ready lunges at a foe within (reach + 3) R: toward where it will be
   * (lead = gap ÷ 1.6 cruise) at FL_LUNGE_SPEED × the cruise (big fighters FL_LUNGE_SPEED_BIG); the speed relax brings it back.
   * At most one every FL_LUNGE_EVERY_MS. True when it lunged.
   */
  private lunge(f: FlFighter, ball: Ball, now: number): boolean {
    const w = f.weapons[0];
    const s = w.spec;
    if (!LUNGE_KINDS.has(s.kind) || now - f.lungeMs < FL_LUNGE_EVERY_MS) return false;
    if (!this.canAct(f, now) || now < f.disarmedUntil || now < f.confusedUntil || now < f.pullUntil) return false;
    if (!this.weaponReady(f, w, now)) return false;
    const t = this.tgtS;
    if (!this.targetOf(f, t)) return false;
    const gap = Math.hypot(t.x - f.x, t.y - f.y) - f.r - t.r;
    if (gap < 0.2 * f.r || gap > (s.reach + 3) * f.r) return false;
    if (Math.hypot(ball.vx, ball.vy) > 1.5 * f.cruise) return false;
    const speed = (f.row.stats.size >= 1.1 ? FL_LUNGE_SPEED_BIG : FL_LUNGE_SPEED) * f.cruise;
    const lead = gap / Math.max(1, 1.6 * f.cruise);
    const a = Math.atan2(t.y + t.vy * lead - f.y, t.x + t.vx * lead - f.x);
    ball.vx = Math.cos(a) * speed;
    ball.vy = Math.sin(a) * speed;
    f.lungeMs = now;
    return true;
  }

  /** --- fl-overhaul --- Whether `f` wants to close in whatever its weapon: a range-limited cast waiting, its own area telegraph or ring, Super Star's touch. */
  private wantsClose(f: FlFighter, now: number): boolean {
    return (f.fullMs >= 0 && f.telegraphUntil < 0) || (f.telegraphUntil >= 0 && f.telegraphArea > 0) || now < f.contactUntil || now < f.fireRingUntil;
  }

  /**
   * --- fl-overhaul --- The intent steering: the velocity turns (its length kept) toward a heading by the gap to the target in
   * radii against the weapon's band – too far: the bearing; inside: a strafe at the bearing ± 1.4 rad (the side the flight
   * already leans to); too close: ± 2.2 rad – at most `seekTurn` rad/s (× 1.6 after FL_STALEMATE_MS without a hit). Skipped
   * above 1.5× the cruise, while confused and without a target; no random draws.
   */
  private intentSteer(f: FlFighter, ball: Ball, now: number, dt: number) {
    const turn = this.view.settings.seekTurn;
    if (!(turn > 0) || now < f.confusedUntil || now < f.pullUntil) return;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (!(sp > 1e-6) || sp > 1.5 * f.cruise) return;
    const rate = turn * dt * (now - this.view.lastHitMs >= FL_STALEMATE_MS ? 1.6 : 1);
    const cur = Math.atan2(ball.vy, ball.vx);
    // Inside a foe's area telegraph it keeps the heading its evade nudge gave it (it does not steer back in).
    if (this.areaThreat(f)) return;
    const t = this.tgtS;
    if (!this.targetOf(f, t)) return;
    const gap = this.gapR(f, t.x, t.y, t.r);
    let lo = f.bandLo;
    let hi = f.bandHi;
    if (this.wantsClose(f, now)) {
      lo = -Infinity;
      hi = 0.5;
    }
    const bearing = Math.atan2(t.y - f.y, t.x - f.x);
    let want = bearing;
    if (gap <= hi) {
      const side = angleDiff(cur, bearing) >= 0 ? 1 : -1;
      want = bearing + side * (gap < lo ? 2.2 : 1.4);
    }
    const a = turnToward(cur, want, rate);
    ball.vx = Math.cos(a) * sp;
    ball.vy = Math.sin(a) * sp;
  }

  /** A choke's hold: the held fighter stays put; damage over the hold or at its end (a slam). */
  private stepHold(ctx: ModeContext, f: FlFighter, now: number) {
    const by = this.view.fighters[f.heldBy];
    if (now >= f.heldUntil || !by || !by.alive) {
      const slam = f.holdMode === "end" && f.holdDamage > 0 && !!by;
      const damage = f.holdDamage;
      // --- fl-overhaul --- released first: the slam's knockback throws it (a held fighter does not budge)
      f.heldBy = -1;
      f.holdDamage = 0;
      if (slam) {
        // The slam: the damage and a knock toward the nearest wall.
        const field = this.view.field!;
        const dx = f.x - field.cx;
        const dy = f.y - field.cy;
        const d = Math.hypot(dx, dy) || 1;
        f.kept = false;
        this.hit(ctx, by, f, damage, dx / d, dy / d, 2.5, "magic", { unblockable: true, ignoreIframes: true });
      }
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

  /**
   * --- fl-overhaul --- A hard crowd control (a freeze, a hold, a pin) on `target` until `untilMs`: refused while it is immune
   * after the last one (EV_IMMUNE); applied, it makes it immune until FL_CC_IMMUNE_MS after this one ends – and interrupts a
   * telegraph (the meter back to half, EV_INTERRUPT; the next telegraph cannot be interrupted). True when it applies.
   */
  private applyHardCc(target: FlFighter, untilMs: number, now: number): boolean {
    if (!target.alive) return false;
    if (now < target.ccImmuneUntil) {
      this.immune(target, now);
      return false;
    }
    target.ccImmuneUntil = untilMs + FL_CC_IMMUNE_MS;
    if (target.telegraphUntil >= 0 && !target.uninterruptible) {
      target.telegraphUntil = -1;
      target.telegraphStart = -1;
      target.telegraphArea = 0;
      target.telegraphMask = 0;
      target.meter = 0.5;
      target.fullMs = -1;
      target.uninterruptible = true;
      this.view.interrupts++;
      this.pushEvent(EV_INTERRUPT, now, target.x, target.y - target.r, 0, target.slot, target.row.accent);
    }
    return true;
  }

  /** --- fl-overhaul --- The IMMUNE callout over `target` (at most one every FL_IFRAME_MS). */
  private immune(target: FlFighter, now: number) {
    if (now - target.immuneMs < FL_IFRAME_MS) return;
    target.immuneMs = now;
    this.view.immunes++;
    this.pushEvent(EV_IMMUNE, now, target.x, target.y - target.r, 0, target.slot, "#fde047");
  }

  /** --- fl-overhaul --- A choke's hold of `target` by `by` for `dur` s (through applyHardCc): damage at its start, over it or at its end. */
  private applyHold(ctx: ModeContext, by: FlFighter, target: FlFighter, dur: number, damage: number, at: "start" | "over" | "end", now: number) {
    if (!target.alive || !by.alive || !this.applyHardCc(target, now + 1000 * dur, now)) return;
    target.heldBy = by.slot;
    target.heldUntil = now + 1000 * dur;
    target.holdMode = at;
    target.holdDamage = at === "start" ? 0 : damage;
    target.holdTickMs = now + 300;
    target.pullUntil = -Infinity;
    if (at === "start" && damage > 0) this.hit(ctx, by, target, damage, 0, 0, 0, "magic", { unblockable: true, ignoreIframes: true });
  }

  /** --- fl-overhaul --- The hold queued behind a pull (the Lasso of Truth) closes. */
  private landPendingHold(f: FlFighter, now: number) {
    const by = f.pendingHoldBy >= 0 ? this.view.fighters[f.pendingHoldBy] : null;
    f.pendingHoldBy = -1;
    if (!by || !by.alive || !f.alive || this.view.finished || !this.ctxRef) return;
    this.applyHold(this.ctxRef, by, f, f.pendingHoldDur, f.pendingHoldDamage, f.pendingHoldAt, now);
  }

  /**
   * The ability meter: charge, telegraph, cast. --- fl-overhaul --- A full meter starts the telegraph of its class
   * (`telegraphMs()`) once a foe fighter is there for a fighter-only ability and – for a range-limited one (an instant
   * shockwave, a fire ring, Super Star's touch) – once the nearest foe is in range, or FL_CAST_WAIT_MS after it filled; the
   * aim locks at the telegraph's start, and a foe inside an area telegraph at its start that is out at the cast dodged it.
   */
  private stepAbility(ctx: ModeContext, f: FlFighter, now: number, dt: number) {
    if (now < f.frozenUntil || f.heldBy >= 0) return;
    const v = this.view;
    const ability = f.row.ability;
    if (f.telegraphUntil >= 0) {
      if (now >= f.telegraphUntil) {
        f.telegraphUntil = -1;
        f.meter = 0;
        f.fullMs = -1;
        f.casts++;
        f.lastCastMs = now;
        f.uninterruptible = false;
        v.casts++;
        this.pushEvent(EV_CAST, now, f.x, f.y, 0, f.slot, f.row.accent);
        this.noteDodges(f, now);
        for (const effect of ability.effects) this.castEffect(ctx, f, effect, now);
        f.telegraphStart = -1;
        f.telegraphArea = 0;
        f.telegraphMask = 0;
      }
      return;
    }
    f.meter = meterAfter(f.meter, dt * this.timeScale(f.team, now), f.cast, ability.charge);
    if (f.meter < 1) {
      f.fullMs = -1;
      return;
    }
    if (f.fullMs < 0) f.fullMs = now;
    const foe = this.nearestFoeFighter(f, now);
    if (!foe && f.targetMinion < 0) return;
    if (!foe && ability.effects.every((e) => FIGHTER_ONLY.has(e.p))) return;
    const range = this.castRange(f);
    if (range > 0 && foe && now - f.fullMs < FL_CAST_WAIT_MS && Math.hypot(foe.x - f.x, foe.y - f.y) > range + foe.r) return;
    this.startTelegraph(f, foe, now);
  }

  /** --- fl-overhaul --- How close (px, centre to the foe's edge) a range-limited ability wants its foe before it telegraphs (0: anywhere). */
  private castRange(f: FlFighter): number {
    let range = Infinity;
    for (const e of f.row.ability.effects) {
      if (e.p === "shockwave" && !(e.delay && e.delay > 0)) range = Math.min(range, 0.85 * e.radius * f.r);
      else if (e.p === "fireRing") range = Math.min(range, 0.9 * e.radius * f.r);
      else if (e.p === "invulnerable" && e.contact) range = Math.min(range, 5 * f.r);
    }
    return Number.isFinite(range) ? range : 0;
  }

  /** --- fl-overhaul --- The area (px from the caster) an ability threatens during its telegraph: its instant shockwave or fire ring, arena cuts (0: none). */
  private areaOf(f: FlFighter): number {
    let area = 0;
    for (const e of f.row.ability.effects) {
      if (e.p === "shockwave" && !(e.delay && e.delay > 0)) area = Math.max(area, e.radius * f.r);
      else if (e.p === "fireRing") area = Math.max(area, e.radius * f.r);
      else if (e.p === "arenaCuts") area = Math.max(area, 3 * f.r);
      else if (e.p === "trap") area = Math.max(area, (FL_TRAP_GAP * Math.max(1, e.n - 1) + FL_TRAP_R) * f.r); // --- fl-overhaul --- (a trap drop)
    }
    return area;
  }

  /** --- fl-overhaul --- The telegraph starts: its class's length, the aim locked on the target (a volley's lead), the area and the foes inside it. */
  private startTelegraph(f: FlFighter, foe: FlFighter | null, now: number) {
    const ability = f.row.ability;
    const tele = telegraphMs(ability);
    f.telegraphStart = now;
    f.telegraphUntil = now + tele;
    const t = this.tgtS;
    let has = false;
    if (foe) {
      t.x = foe.x;
      t.y = foe.y;
      t.vx = foe.vx;
      t.vy = foe.vy;
      t.r = foe.r;
      has = true;
    } else has = this.targetOf(f, t);
    if (has) {
      let lead = 0;
      const volley = ability.effects.find((e) => e.p === "volley");
      if (volley && volley.p === "volley") {
        const speed = this.projectileSpeed(volley.speed ?? 1.2, this.view.field!);
        lead = tele / 1000 + (0.5 * Math.hypot(t.x - f.x, t.y - f.y)) / speed;
      }
      f.castX = t.x + t.vx * lead;
      f.castY = t.y + t.vy * lead;
    } else {
      f.castX = f.x + Math.cos(f.aim) * 4 * f.r;
      f.castY = f.y + Math.sin(f.aim) * 4 * f.r;
    }
    f.telegraphArea = this.areaOf(f);
    f.telegraphMask = 0;
    if (f.telegraphArea > 0) {
      for (const o of this.view.fighters) {
        if (o.team === f.team || !o.alive) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d <= f.telegraphArea + o.r) f.telegraphMask |= 1 << o.slot;
        if (d <= f.telegraphArea + o.r + f.r) this.evadeNudge(o, f);
      }
      // The caster goes for its foe: a lunge at where the foe will be when it fires.
      const ball = this.byIndex[f.slot];
      if (foe && ball && this.canAct(f, now) && !(now < f.pullUntil)) {
        const px = foe.x + (foe.vx * tele) / 1000;
        const py = foe.y + (foe.vy * tele) / 1000;
        const a = Math.atan2(py - f.y, px - f.x);
        const speed = (f.row.stats.size >= 1.1 ? FL_LUNGE_SPEED_BIG : FL_LUNGE_SPEED) * f.cruise;
        ball.vx = Math.cos(a) * speed;
        ball.vy = Math.sin(a) * speed;
        f.vx = ball.vx;
        f.vy = ball.vy;
        f.lungeMs = now;
      }
    }
    this.urgentSound("ability", fighterPitch(f.slot), 0.8);
  }

  /** --- fl-overhaul --- At the cast: every foe inside the area at the telegraph's start and out of it now dodged it (EV_DODGE). */
  private noteDodges(f: FlFighter, now: number) {
    if (!f.telegraphMask || !(f.telegraphArea > 0)) return;
    for (const o of this.view.fighters) {
      if (!(f.telegraphMask & (1 << o.slot)) || !o.alive) continue;
      if (Math.hypot(o.x - f.x, o.y - f.y) <= f.telegraphArea + o.r) continue;
      o.dodges++;
      this.view.dodges++;
      this.pushEvent(EV_DODGE, now, o.x, o.y - o.r, 0, o.slot, o.row.accent);
    }
  }

  /**
   * The engine moved a fighter: keep it in the arena, mirror its state; a real wall hit is a note, a sweep and a nudge
   * (--- fl-overhaul --- an EV_RIM, an EV_SLAM above twice the cruise, and in the circle a seeded turn of 5–12°).
   */
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
    // Held still: the intro, a freeze, a hold, a pin, the end (gravity or a push must not move it).
    if (now < v.introMs || now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil || v.finished) {
      ball.x = f.x;
      ball.y = f.y;
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    const pre = Math.hypot(ball.vx, ball.vy);
    const wall = this.wallPass(ctx, ball);
    // --- fl-overhaul --- (Stage 2) a solid enemy wall stops a fighter like the arena's own: a bounce (sweeps, the nudge)
    const barrier = this.barrierPass(ctx, f, ball);
    f.x = ball.x;
    f.y = ball.y;
    f.vx = ball.vx;
    f.vy = ball.vy;
    if (barrier) {
      ctx.noteBounce?.(ball);
      for (const w of f.weapons) if (w.spec.kind === "sword") this.startSweep(f, w, now);
      if (!v.finished) this.nudge(f, ball, now, this.barrierN.x, this.barrierN.y);
      f.vx = ball.vx;
      f.vy = ball.vy;
    }
    if (wall < 0) return;
    ctx.noteBounce?.(ball); // --- bounce-math --- a wall hit is a bounce
    v.wallHits++;
    this.budget.offer(0.2, null, wallNote(field.kind, wall), 0.22);
    this.pushEvent(EV_RIM, now, ball.x, ball.y, wall, f.slot, f.row.accent);
    if (pre > 2 * Math.max(1, f.cruise)) this.pushEvent(EV_SLAM, now, ball.x, ball.y, pre / Math.max(1, f.cruise), f.slot, f.row.accent);
    if (field.kind === "circle" && !v.finished) this.rimTurn(ball);
    for (const w of f.weapons) if (w.spec.kind === "sword") this.startSweep(f, w, now);
    if (!v.finished) this.nudge(f, ball, now);
    f.vx = ball.vx;
    f.vy = ball.vy;
  }

  /**
   * --- fl-overhaul --- A circle rebound turns by a seeded 5–12° either way (one draw: its sign and size), never back into
   * the rim: two fighters on a diameter no longer ping-pong along it forever.
   */
  private rimTurn(ball: Ball) {
    const field = this.view.field!;
    const u = this.randomDraw();
    const sign = u < 0.5 ? -1 : 1;
    const turn = sign * (5 + 7 * ((2 * u) % 1)) * DEG;
    const d = Math.hypot(ball.x - field.cx, ball.y - field.cy) || 1;
    const nx = (field.cx - ball.x) / d;
    const ny = (field.cy - ball.y) / d;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (!(sp > 1e-6)) return;
    const cur = Math.atan2(ball.vy, ball.vx);
    const minOut = Math.sin(MIN_WALL_ANGLE);
    for (const t of [turn, -turn]) {
      const a = cur + t;
      if (Math.cos(a) * nx + Math.sin(a) * ny >= minOut) {
        ball.vx = Math.cos(a) * sp;
        ball.vy = Math.sin(a) * sp;
        return;
      }
    }
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

  /** --- fl-overhaul --- (Stage 2) The normal of the last barrier a fighter bounced off (toward the fighter); a bomb's predicted landing (scratch). */
  private readonly barrierN = { x: 0, y: 0 };
  private readonly tgtB = { x: 0, y: 0 };

  /**
   * --- fl-overhaul --- (Stage 2) Solid enemy walls push a fighter's ball out of them and reflect its flight (× the wall-bounciness
   * extra) like the arena's walls; its own side's walls let it through. True when it bounced off one (`barrierN` its normal).
   */
  private barrierPass(ctx: ModeContext, f: FlFighter, ball: Ball): boolean {
    let bounced = false;
    for (const w of this.view.walls) {
      if (!w.active || !w.solid || w.team === f.team) continue;
      const sx = w.x2 - w.x1;
      const sy = w.y2 - w.y1;
      const len2 = sx * sx + sy * sy;
      let t = len2 > 0 ? ((ball.x - w.x1) * sx + (ball.y - w.y1) * sy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = w.x1 + t * sx;
      const qy = w.y1 + t * sy;
      let nx = ball.x - qx;
      let ny = ball.y - qy;
      const d = Math.hypot(nx, ny);
      if (d >= ball.radius) continue;
      if (d > 1e-6) {
        nx /= d;
        ny /= d;
      } else {
        // On the line: back to the side it came from.
        const l = Math.sqrt(len2) || 1;
        nx = -sy / l;
        ny = sx / l;
        if (ball.vx * nx + ball.vy * ny > 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      ball.x = qx + nx * ball.radius;
      ball.y = qy + ny * ball.radius;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        const e = ctx.getPhysicsExtras().wallBounciness;
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        this.barrierN.x = nx;
        this.barrierN.y = ny;
        bounced = true;
      }
    }
    return bounced;
  }

  /** --- fl-overhaul --- Puts a fighter's ball back inside the arena (no bounce): after a teleport (a pin, a blink). */
  private clampInsideArena(f: FlFighter, ball: Ball) {
    const field = this.view.field!;
    const lim = Math.max(1, field.half - ball.radius - 1);
    if (field.kind === "circle") {
      const dx = ball.x - field.cx;
      const dy = ball.y - field.cy;
      const d = Math.hypot(dx, dy);
      if (d > lim) {
        ball.x = field.cx + (dx / d) * lim;
        ball.y = field.cy + (dy / d) * lim;
      }
    } else {
      ball.x = Math.max(field.cx - lim, Math.min(field.cx + lim, ball.x));
      ball.y = Math.max(field.cy - lim, Math.min(field.cy + lim, ball.y));
    }
    f.x = ball.x;
    f.y = ball.y;
  }

  /**
   * The director turns a rebound toward the nearest foe (full strength after a stalemate; more for the rigged side).
   * --- fl-overhaul --- In the circle it aims beside the foe (1.5 of its radii, on the side the rebound passes) and leaves a
   * rebound that already points within 10° of it alone.
   */
  private nudge(f: FlFighter, ball: Ball, now: number, wallNx = 0, wallNy = 0) {
    if (f.targetSlot < 0 && f.targetMinion < 0) return;
    const t = this.tgtN;
    if (!this.targetOf(f, t)) return;
    let strength = now - this.view.lastHitMs >= FL_STALEMATE_MS ? 1 : FL_NUDGE;
    if (this.rigChosen >= 0 && f.team === this.rigChosen) strength = Math.min(1.4, strength + 0.6 * this.rigK);
    const field = this.view.field!;
    let nx = 0;
    let ny = 0;
    let tx = t.x - ball.x;
    let ty = t.y - ball.y;
    if (wallNx !== 0 || wallNy !== 0) {
      // --- fl-overhaul --- (Stage 2) off a barrier: its own normal
      nx = wallNx;
      ny = wallNy;
    } else if (field.kind === "circle") {
      const d = Math.hypot(ball.x - field.cx, ball.y - field.cy) || 1;
      nx = (field.cx - ball.x) / d;
      ny = (field.cy - ball.y) / d;
      const cur = Math.atan2(ball.vy, ball.vx);
      const bearing = Math.atan2(ty, tx);
      if (Math.abs(angleDiff(cur, bearing)) <= 10 * DEG) return;
      const dd = Math.hypot(tx, ty) || 1;
      const side = angleDiff(cur, bearing) >= 0 ? 1 : -1;
      const off = 1.5 * t.r * side;
      const px = -ty / dd;
      const py = tx / dd;
      tx += px * off;
      ty += py * off;
    } else {
      if (ball.x <= field.cx - field.half + ball.radius + 0.5) nx = 1;
      else if (ball.x >= field.cx + field.half - ball.radius - 0.5) nx = -1;
      if (ball.y <= field.cy - field.half + ball.radius + 0.5) ny = 1;
      else if (ball.y >= field.cy + field.half - ball.radius - 0.5) ny = -1;
    }
    steerToward(ball.vx, ball.vy, tx, ty, strength * MAX_NUDGE, nx, ny, tmpSteer);
    ball.vx = tmpSteer.vx;
    ball.vy = tmpSteer.vy;
  }

  /**
   * A sweep of a sword: a 120° arc centred on the nearest foe when it is within the blade's reach (the blade swings at it),
   * else on the blade's own direction; every other sweep turns the other way. A bounce, a clash or – --- fl-overhaul --- – a
   * foe in reach once the last sweep ended cooldown ÷ attack speed ago starts one (the attack speed sets their cadence).
   */
  private startSweep(f: FlFighter, w: FlWeaponState, now: number) {
    const dur = Math.max(0.08, w.spec.cooldown / this.attackOf(f, now));
    if (w.sweepT > 0.5 * dur) return;
    let centre = w.angle;
    w.sweepTarget = -1;
    if (f.targetSlot >= 0) {
      const t = this.view.fighters[f.targetSlot];
      const reach = f.r + (w.spec.reach + 0.5) * f.r + t.r;
      if ((t.x - f.x) ** 2 + (t.y - f.y) ** 2 <= reach * reach) {
        centre = Math.atan2(t.y - f.y, t.x - f.x);
        w.sweepTarget = t.slot;
      }
    }
    w.sweepT = dur;
    w.sweepDir = -w.sweepDir;
    w.sweepCentre = centre;
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

  /**
   * Every sub-step: bodies, weapons (--- fl-overhaul --- in the step's processing order, the melee hits queued and resolved
   * together), rings, contact, projectiles, minions, beams.
   */
  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    const field = v.field;
    this.subIndex++;
    if (!field) return;
    const now = this.now();
    const dt = this.subDt;
    this.collideBodies(ctx, now);
    if (now >= v.introMs) {
      this.meleeCount = 0;
      const order = this.processingOrder();
      for (const f of order) if (f.alive) this.stepWeapons(ctx, f, now, dt);
      for (const f of order) if (f.alive) this.stepContactFor(ctx, f, now);
      this.resolveMelee(ctx, now);
      this.stepFireRings(ctx, now, order);
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
          for (const w of a.weapons) if (w.spec.kind === "sword") this.startSweep(a, w, now);
          for (const w of b.weapons) if (w.spec.kind === "sword") this.startSweep(b, w, now);
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
    return now < this.view.introMs || now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil || this.view.finished;
  }

  /** Super Star's contact damage of `f` (the abilities' source). */
  private stepContactFor(ctx: ModeContext, f: FlFighter, now: number) {
    if (now >= f.contactUntil) return;
    for (const o of this.view.fighters) {
      if (o === f || !o.alive || o.team === f.team) continue;
      if (circlesTouch(f.x, f.y, f.r + 1, o.x, o.y, o.r)) {
        const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
        this.hit(ctx, f, o, f.contactDamage, (o.x - f.x) / d, (o.y - f.y) / d, 1.2, "blunt");
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
    const armed = acting && now >= f.disarmedUntil;
    const gap = hasTarget ? this.gapR(f, t.x, t.y, t.r) : Infinity;
    for (const w of f.weapons) {
      const s = w.spec;
      const reach = s.reach * this.reachOf(f.team);
      switch (s.kind) {
        case "sword": {
          // Along the velocity (turning to it), or sweeping its 120° arc; a foe in reach starts a sweep on the weapon's cadence.
          if (w.sweepT > 0) {
            const dur = Math.max(0.08, s.cooldown / atk);
            if (acting) w.sweepT = Math.max(0, w.sweepT - dt);
            const prog = Math.min(1, 1 - w.sweepT / dur);
            // --- fl-overhaul --- the arc's centre follows its foe's bearing (a sweep started on the approach still crosses it)
            const so = w.sweepTarget >= 0 ? this.view.fighters[w.sweepTarget] : null;
            if (acting && so && so.alive) w.sweepCentre = turnToward(w.sweepCentre, Math.atan2(so.y - f.y, so.x - f.x), 2 * FL_AIM_TURN * dt);
            w.sweepFrom = w.sweepCentre - 0.5 * FL_SWEEP_DEG * DEG * w.sweepDir;
            w.angle = w.sweepFrom + w.sweepDir * FL_SWEEP_DEG * DEG * prog;
            if (w.sweepT <= 0) w.lastSweepEnd = now;
          } else if (acting) w.angle = turnToward(w.angle, velAngle, 0.85 * FL_AIM_TURN * dt);
          const ready = now - w.lastSweepEnd >= (1000 * s.cooldown) / atk;
          if (armed && w.sweepT <= 0 && hasTarget && gap <= reach + 0.4 && ready) this.startSweep(f, w, now);
          if (!armed) break;
          const blades = s.style === "double" ? 2 : 1;
          for (let k = 0; k < blades; k++) bladeShape(f.x, f.y, f.r, w.angle + k * Math.PI, reach, s.size, w.shapes[k]);
          // --- fl-overhaul --- a sweep hits each foe once; the resting blade stabs only on the weapon's cadence (a stab spends it)
          if (w.sweepT > 0) this.meleeContact(ctx, f, w, blades, 1.25, now, true);
          else if (ready && this.meleeContact(ctx, f, w, blades, 1, now, false)) w.lastSweepEnd = now;
          break;
        }
        case "hammer":
        case "chain": {
          const period = Math.max(0.1, s.cooldown / atk);
          if (acting) {
            w.angle += (TWO_PI / period) * dt;
            if (w.angle > TWO_PI) w.angle -= TWO_PI;
          }
          // A throw: the returning hammer and the pull chain's head fly at the target on their own cadence.
          if ((s.style === "returning" || s.style === "pull") && w.thrown < 0) {
            w.throwCd -= dt * atk;
            if (w.throwCd <= 0 && armed && hasTarget) {
              w.throwCd = s.throwEvery;
              this.throwWeapon(f, w, t, now);
            }
          }
          if (w.thrown >= 0 || !armed) break;
          headShape(f.x, f.y, f.r, w.angle, reach, s.size, w.shapes[0]);
          let factor = 1;
          if (s.kind === "chain") {
            // Damage by momentum: the head's speed against the foe's, over the head's own speed at attack speed 1.
            const headSpeed = (TWO_PI / period) * (f.r + reach * f.r);
            const nominal = (TWO_PI / s.cooldown) * (f.r + s.reach * f.r);
            factor = Math.max(0.6, Math.min(1.8, headSpeed / Math.max(1, nominal)));
          }
          this.meleeContact(ctx, f, w, 1, factor, now, false);
          break;
        }
        case "tail":
          this.stepTail(ctx, f, w, now, dt, atk, hasTarget, t, gap, reach, acting, armed, velAngle);
          break;
        case "whip": // --- fl-overhaul --- (Stage 2)
          this.stepWhip(ctx, f, w, now, dt, atk, hasTarget, t, gap, reach, armed);
          break;
        case "bomb": {
          // --- fl-overhaul --- (Stage 2) a lob at the target's predicted spot on the weapon's cadence
          if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.cd <= 0 && armed && hasTarget) {
            w.cd = s.cooldown;
            this.lobBomb(f, w, t, now);
          }
          break;
        }
        case "fists":
        case "claws":
          if (s.style === "contact") this.stepContactFists(ctx, f, w, now, dt, atk, reach, armed);
          else this.stepPunch(ctx, f, w, now, dt, atk, hasTarget, t, reach, armed);
          break;
        case "shield": {
          // Held toward the target (a hit from the side or behind gets through); a block spends its guard.
          w.angle = turnToward(w.angle, f.aim, 0.85 * FL_AIM_TURN * dt);
          if (s.style === "block" || w.thrown >= 0) break;
          w.throwCd -= dt * atk;
          if (w.throwCd <= 0 && armed && hasTarget) {
            w.throwCd = s.throwEvery;
            this.throwWeapon(f, w, t, now);
          }
          break;
        }
        case "cards": {
          if (acting) {
            w.orbit += 3 * dt * this.timeScale(f.team, now);
            if (w.loaded < s.count) {
              w.reloadT += dt * atk;
              if (w.reloadT >= 1.25 * s.cooldown) {
                w.reloadT = 0;
                w.loaded++;
              }
            }
          }
          if (!armed) break;
          // Orbiting blades cut on contact.
          const blades = Math.min(w.loaded, w.shapes.length);
          for (let k = 0; k < blades; k++) headShape(f.x, f.y, f.r, w.orbit + (TWO_PI * k) / s.count, s.reach - 1, s.size, w.shapes[k]);
          this.meleeContact(ctx, f, w, blades, 0.6, now, false);
          w.cd -= dt * atk;
          if (w.cd <= 0 && w.loaded > 0 && hasTarget) {
            w.cd = s.cooldown;
            w.loaded--;
            this.fireCard(f, w, t, now);
          }
          break;
        }
        case "fire": {
          // A breath only at a foe within reach + 0.6 R: an inhale first, then the cone burns until FL_BREATH_MS.
          if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.cd <= 0 && armed && hasTarget && now >= w.onUntil && gap <= reach + 0.6) {
            w.cd = s.cooldown;
            w.inhaleUntil = now + FL_INHALE_MS;
            w.onUntil = now + FL_BREATH_MS;
            this.budget.offer(0.5, "fire", fighterPitch(f.slot), 0.35);
          }
          if (now < w.inhaleUntil || now >= w.onUntil || !armed) break;
          this.stepCone(ctx, f, w, now);
          break;
        }
        case "beam": {
          // The hand follows its ray, else turns to the target; a glint (the aim locked) before every ray.
          const b = w.beam >= 0 ? this.view.beams[w.beam] : null;
          const firing = !!b && b.active && b.owner === f.slot && b.weapon === w.index;
          if (!firing) w.beam = -1;
          if (firing) w.angle = b.angle;
          else if (w.glintUntil >= 0) w.angle = w.glintAim = Math.atan2(w.glintY - f.y, w.glintX - f.x);
          else if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.glintUntil >= 0) {
            if (now >= w.glintUntil) {
              w.glintUntil = -1;
              if (armed) this.fireBeam(f, w, now);
            }
          } else if (w.cd <= 0 && armed && hasTarget && !firing) {
            w.cd = s.cooldown;
            w.glintUntil = now + FL_GLINT_MS;
            w.glintX = t.x;
            w.glintY = t.y;
            w.glintAim = Math.atan2(t.y - f.y, t.x - f.x);
            w.angle = w.glintAim;
          }
          break;
        }
        case "spark": {
          if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.cd > 0 || !armed || !hasTarget || gap > reach) break;
          w.cd = s.cooldown;
          const bearing = Math.atan2(t.y - f.y, t.x - f.x);
          w.zapMs = now;
          w.zapAngle = bearing;
          w.angle = bearing;
          w.zapX = t.x;
          w.zapY = t.y;
          const dd = Math.hypot(t.x - f.x, t.y - f.y) || 1;
          const hx = f.x + Math.cos(bearing) * 1.1 * f.r;
          const hy = f.y + Math.sin(bearing) * 1.1 * f.r;
          this.hitTarget(ctx, f, s.damage, (t.x - f.x) / dd, (t.y - f.y) / dd, s.knockback, "magic", { weapon: w.index, fromX: hx, fromY: hy });
          if (this.view.match !== "1v1") this.chainSpark(ctx, f, w, t.r, now);
          break;
        }
        default: {
          // Shooters: bow, gun, shotgun, wand, staff, book, web, ice (a burst's next rounds leave the muzzle on their gap).
          if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
          w.cd -= dt * atk;
          if (w.burstLeft > 0) {
            w.burstT -= dt * atk;
            if (w.burstT <= 0) {
              if (armed) {
                this.fireRound(f, w, hasTarget ? t : null, now, w.burstVolley, 0, 1);
                w.burstLeft--;
                w.burstT += FL_BURST_GAP;
                this.budget.offer(0.12, FL_SOUND_OF_KIND[s.kind], fighterPitch(f.slot) * 1.5, 0.15);
              } else w.burstLeft = 0;
            }
          }
          if (w.cd <= 0 && armed && hasTarget && w.burstLeft <= 0) {
            w.cd = s.cooldown;
            this.shoot(f, w, t, now);
          }
        }
      }
    }
  }

  /**
   * --- fl-overhaul --- A tail: at rest it trails behind the flight with a wobble; with the cooldown over and a foe within
   * reach + 0.3 R in any direction it swings for FL_TAIL_SWING s from its rest to the foe's bearing and back – one hit a foe a
   * swing – then waits a cooldown.
   */
  private stepTail(ctx: ModeContext, f: FlFighter, w: FlWeaponState, now: number, dt: number, atk: number, hasTarget: boolean, t: { x: number; y: number }, gap: number, reach: number, acting: boolean, armed: boolean, velAngle: number) {
    const s = w.spec;
    if (acting) {
      w.phase += (TWO_PI / Math.max(0.1, s.cooldown / atk)) * dt;
      if (w.phase > TWO_PI) w.phase -= TWO_PI;
    }
    const rest = velAngle + Math.PI + 0.5 * Math.sin(w.phase);
    w.cd -= dt * atk;
    if (w.swingT >= 0) {
      if (acting) w.swingT += dt * Math.max(1, atk);
      const k = Math.min(1, w.swingT / FL_TAIL_SWING);
      const to = hasTarget ? Math.atan2(t.y - f.y, t.x - f.x) : w.swingFrom;
      w.angle = w.swingFrom + angleDiff(to, w.swingFrom) * Math.sin(Math.PI * k);
      if (k >= 1) {
        w.swingT = -1;
        w.cd = s.cooldown;
      }
      if (!armed) return;
      bladeShape(f.x, f.y, f.r, w.angle, reach, s.size, w.shapes[0]);
      this.meleeContact(ctx, f, w, 1, 1, now, true);
      return;
    }
    w.angle = rest;
    if (armed && w.cd <= 0 && hasTarget && gap <= reach + 0.3) {
      w.swingT = 0;
      w.swingFrom = rest;
      w.touchMask = 0;
      w.minionMask = 0;
    }
  }

  /**
   * --- fl-overhaul --- (Stage 2) A whip: with the cooldown over and the target within reach it cracks along the target's bearing
   * (out FL_WHIP_OUT s, back FL_WHIP_BACK s – `whipExtension()`); its tip (`size` R across, at full extension) deals the full
   * damage, the outer 40 % of the lash half of it – one hit a crack. A lasso's crack snags the foe instead: its damage without
   * knockback, then a drag to the owner (FL_LASSO_PULL_MS at FL_LASSO_PULL_SPEED, a hard crowd control).
   */
  private stepWhip(ctx: ModeContext, f: FlFighter, w: FlWeaponState, now: number, dt: number, atk: number, hasTarget: boolean, t: { x: number; y: number; r: number }, gap: number, reach: number, armed: boolean) {
    const s = w.spec;
    w.cd -= dt * atk;
    if (hasTarget && w.punchT < 0) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
    if (w.punchT >= 0) {
      w.punchT += dt * Math.max(1, atk);
      if (w.punchT >= FL_WHIP_SEC) w.punchT = -1;
    }
    if (w.punchT < 0 && w.cd <= 0 && armed && hasTarget && gap <= reach) {
      w.cd = s.cooldown;
      w.punchT = 0;
      w.punchHit = false;
      w.punchAngle = Math.atan2(t.y - f.y, t.x - f.x) + (now < f.confusedUntil ? Math.PI : 0);
      w.angle = w.punchAngle;
    }
    if (w.punchT < 0 || w.punchHit || !armed) return;
    const e = whipExtension(w.punchT);
    const ux = Math.cos(w.punchAngle);
    const uy = Math.sin(w.punchAngle);
    const tipD = f.r + e * reach * f.r;
    const tx = f.x + ux * tipD;
    const ty = f.y + uy * tipD;
    const lx = f.x + ux * (f.r + 0.6 * e * reach * f.r);
    const ly = f.y + uy * (f.r + 0.6 * e * reach * f.r);
    const tipR = s.size * f.r;
    const lashHalf = 0.1 * f.r;
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team || o.hp <= 0) continue;
      let factor = 0;
      if (e >= FL_WHIP_TIP_EXT && circlesTouch(tx, ty, tipR, o.x, o.y, o.r)) factor = 1;
      else if (segmentHitsCircle(lx, ly, tx, ty, lashHalf, o.x, o.y, o.r)) factor = 0.5;
      if (factor === 0) continue;
      w.punchHit = true;
      const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
      if (s.style === "lasso") this.lassoSnag(ctx, f, o, w, factor, tx, ty, now);
      else this.queueMelee(ctx, f, o, w, s.damage * factor, s.knockback, (o.x - f.x) / d, (o.y - f.y) / d, tx, ty);
      return;
    }
    for (const m of this.view.minions) {
      if (!m.active || m.team === f.team) continue;
      if (!(e >= FL_WHIP_TIP_EXT && circlesTouch(tx, ty, tipR, m.x, m.y, m.r)) && !segmentHitsCircle(lx, ly, tx, ty, lashHalf, m.x, m.y, m.r)) continue;
      w.punchHit = true;
      this.hitMinion(ctx, f, m, now);
      return;
    }
  }

  /** --- fl-overhaul --- (Stage 2) A lasso snags `o`: the crack's damage (no knockback), then the drag to its owner when the hit landed (a hard crowd control). */
  private lassoSnag(ctx: ModeContext, f: FlFighter, o: FlFighter, w: FlWeaponState, factor: number, fromX: number, fromY: number, now: number) {
    const res = this.hit(ctx, f, o, w.spec.damage * factor, 0, 0, 0, FL_SOUND_OF_KIND.whip, { weapon: w.index, fromX, fromY, melee: true });
    if (res !== HIT_LANDED || !f.alive || !o.alive || !this.applyHardCc(o, now + FL_LASSO_PULL_MS, now)) return;
    o.pullBy = f.slot;
    o.pullUntil = now + FL_LASSO_PULL_MS;
    o.pullSpeed = FL_LASSO_PULL_SPEED * this.unit;
  }

  /** A punch (fists) or a swipe (claws) toward a foe in reach: one hit a punch. */
  private stepPunch(ctx: ModeContext, f: FlFighter, w: FlWeaponState, now: number, dt: number, atk: number, hasTarget: boolean, t: { x: number; y: number; r: number }, reach: number, armed: boolean) {
    const s = w.spec;
    w.cd -= dt * atk;
    if (hasTarget) w.angle = turnToward(w.angle, f.aim, FL_AIM_TURN * dt);
    const claws = s.kind === "claws";
    const sec = claws ? 0.12 : FL_PUNCH_SEC;
    if (w.punchT >= 0) {
      w.punchT += dt * Math.max(1, atk);
      if (w.punchT >= sec) w.punchT = -1;
    }
    if (w.punchT < 0 && w.cd <= 0 && armed && hasTarget) {
      const gap = Math.hypot(t.x - f.x, t.y - f.y) - f.r - t.r;
      if (gap <= reach * f.r + 0.15 * f.r) {
        w.cd = s.cooldown;
        w.punchT = 0;
        w.punchHit = false;
        w.punchSide = 1 - w.punchSide;
        w.punchAngle = Math.atan2(t.y - f.y, t.x - f.x) + (now < f.confusedUntil ? Math.PI : 0);
      }
    }
    if (w.punchT < 0 || w.punchHit || !armed) return;
    const ext = claws ? Math.min(1, w.punchT / 0.06) : punchExtension(w.punchT);
    fistShape(f.x, f.y, f.r, w.punchAngle, reach, s.size, ext, tmpShape);
    if (this.meleeOnce(ctx, f, w, tmpShape, now)) w.punchHit = true;
  }

  /** --- fl-overhaul --- Contact fists (Sonic): the body (+ reach) running into a foe is the hit, once a cooldown. */
  private stepContactFists(ctx: ModeContext, f: FlFighter, w: FlWeaponState, now: number, dt: number, atk: number, reach: number, armed: boolean) {
    const s = w.spec;
    w.cd -= dt * atk;
    if (w.punchT >= 0) {
      w.punchT += dt * Math.max(1, atk);
      if (w.punchT >= FL_PUNCH_SEC) w.punchT = -1;
    }
    if (!armed || w.cd > 0) return;
    const touch = f.r + reach * f.r;
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team || o.hp <= 0) continue;
      if (!circlesTouch(f.x, f.y, touch, o.x, o.y, o.r)) continue;
      const dx = o.x - f.x;
      const dy = o.y - f.y;
      const d = Math.hypot(dx, dy) || 1;
      this.queueMelee(ctx, f, o, w, s.damage, s.knockback, dx / d, dy / d, f.x + (dx / d) * f.r, f.y + (dy / d) * f.r);
      w.cd = s.cooldown;
      w.punchT = 0;
      w.punchAngle = Math.atan2(dy, dx);
      w.punchHit = true;
      return;
    }
    for (const m of this.view.minions) {
      if (!m.active || m.team === f.team || !circlesTouch(f.x, f.y, touch, m.x, m.y, m.r)) continue;
      this.hitMinion(ctx, f, m, now);
      w.cd = s.cooldown;
      return;
    }
  }

  /**
   * The weapon's `n` melee shapes (w.shapes) against every foe and enemy minion: a foe is hit when the contact starts – one
   * touch is one hit; `sticky` (a sweep, a swing): one hit a foe until the next one starts, however the contact comes and
   * goes. --- fl-overhaul --- The hits on fighters are queued for `resolveMelee()`; true when a hit was queued or a minion hit.
   */
  private meleeContact(ctx: ModeContext, f: FlFighter, w: FlWeaponState, n: number, factor: number, now: number, sticky: boolean): boolean {
    const v = this.view;
    let queued = false;
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
        if (!sticky) w.touchMask &= ~bit;
        continue;
      }
      if (w.touchMask & bit) continue;
      w.touchMask |= bit;
      const sh = w.shapes[touching];
      const kx = o.x - f.x;
      const ky = o.y - f.y;
      const d = Math.hypot(kx, ky) || 1;
      this.queueMelee(ctx, f, o, w, w.spec.damage * factor, w.spec.knockback, kx / d, ky / d, sh.bx, sh.by);
      queued = true;
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
        if (!sticky) w.minionMask &= ~bit;
        continue;
      }
      if (w.minionMask & bit) continue;
      w.minionMask |= bit;
      this.hitMinion(ctx, f, m, now);
      queued = true;
    }
    return queued;
  }

  /** A punch's fist: the first foe it touches takes the hit (queued; true when one did). */
  private meleeOnce(ctx: ModeContext, f: FlFighter, w: FlWeaponState, shape: MeleeShape, now: number): boolean {
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === f.team || o.hp <= 0) continue;
      if (!shapeHitsCircle(shape, o.x, o.y, o.r)) continue;
      const kx = o.x - f.x;
      const ky = o.y - f.y;
      const d = Math.hypot(kx, ky) || 1;
      this.queueMelee(ctx, f, o, w, w.spec.damage, w.spec.knockback, kx / d, ky / d, shape.bx, shape.by);
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

  /** --- fl-overhaul --- A melee hit queued until every fighter's weapons ran this sub-step (past FL_MELEE_CAP it lands at once). */
  private queueMelee(ctx: ModeContext, f: FlFighter, o: FlFighter, w: FlWeaponState, damage: number, kb: number, dx: number, dy: number, fromX: number, fromY: number) {
    const sound = FL_SOUND_OF_KIND[w.spec.kind];
    if (this.meleeCount >= FL_MELEE_CAP) {
      this.hit(ctx, f, o, damage, dx, dy, kb, sound, { weapon: w.index, fromX, fromY, melee: true });
      return;
    }
    const q = this.melee[this.meleeCount++];
    q.attacker = f.slot;
    q.target = o.slot;
    q.weapon = w.index;
    q.damage = damage;
    q.kb = kb;
    q.dx = dx;
    q.dy = dy;
    q.fromX = fromX;
    q.fromY = fromY;
    q.sound = sound;
    q.done = false;
  }

  /** --- fl-overhaul --- Whether a queued melee hit would land now (both alive, no invulnerability, no disarm, its source's window over). */
  private meleeLive(q: FlMeleeHit, now: number): boolean {
    const fs = this.view.fighters;
    const a = fs[q.attacker];
    const b = fs[q.target];
    if (!a.alive || !b.alive || a.hp <= 0 || b.hp <= 0 || this.view.finished) return false;
    if (now < b.invulnUntil || now < a.disarmedUntil) return false;
    return !(now < b.srcUntil[(a.slot & 7) * 8 + Math.min(6, q.weapon)]);
  }

  /** --- fl-overhaul --- A queued melee hit's impact: its damage × the attacker's damage stat, buffs and a pending giant hit. */
  private impactOf(q: FlMeleeHit, now: number): number {
    const a = this.view.fighters[q.attacker];
    let x = q.damage * a.damage;
    if (now < a.dmgMulUntil) x *= a.dmgMul;
    if (a.giantLeft > 0) x *= Math.max(1, a.giantMult);
    return x;
  }

  /**
   * --- fl-overhaul --- The sub-step's melee hits: a hit A → B traded with a hit B → A in the same sub-step lands at half damage
   * when its impact is FL_CLASH_RATIO × the other's (the other is parried); else both are parried – a CLASH (no damage, both
   * knocked apart) – and the pair's next clash within FL_CLASH_REPEAT_MS is decided by a seeded coin (the winner lands at half
   * damage). Unpaired hits land in queue order.
   */
  private resolveMelee(ctx: ModeContext, now: number) {
    const n = this.meleeCount;
    for (let i = 0; i < n; i++) {
      const a = this.melee[i];
      if (a.done) continue;
      a.done = true;
      let b: FlMeleeHit | null = null;
      for (let j = i + 1; j < n; j++) {
        const c = this.melee[j];
        if (!c.done && c.attacker === a.target && c.target === a.attacker) {
          b = c;
          break;
        }
      }
      if (b && this.meleeLive(a, now) && this.meleeLive(b, now)) {
        b.done = true;
        const ia = this.impactOf(a, now);
        const ib = this.impactOf(b, now);
        if (ia >= FL_CLASH_RATIO * ib) this.landMelee(ctx, a, 0.5);
        else if (ib >= FL_CLASH_RATIO * ia) this.landMelee(ctx, b, 0.5);
        else {
          const lo = Math.min(a.attacker, b.attacker);
          const hi = Math.max(a.attacker, b.attacker);
          const key = (lo & 7) * 8 + (hi & 7);
          if (now - this.pairClashMs[key] < FL_CLASH_REPEAT_MS) {
            const lower = a.attacker === lo ? a : b;
            this.landMelee(ctx, this.randomDraw() < 0.5 ? lower : lower === a ? b : a, 0.5);
          } else this.clash(a, now);
          this.pairClashMs[key] = now;
        }
        continue;
      }
      this.landMelee(ctx, a, 1);
    }
    this.meleeCount = 0;
  }

  private landMelee(ctx: ModeContext, q: FlMeleeHit, scale: number) {
    const fs = this.view.fighters;
    this.hit(ctx, fs[q.attacker], fs[q.target], q.damage, q.dx, q.dy, q.kb, q.sound, { weapon: q.weapon, fromX: q.fromX, fromY: q.fromY, melee: true, scale });
  }

  /** --- fl-overhaul --- Two weapons met: no damage, both fighters knocked apart (1 unit, by weight), CLASH!. */
  private clash(q: FlMeleeHit, now: number) {
    const v = this.view;
    const a = v.fighters[q.attacker];
    const b = v.fighters[q.target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    this.applyKnock(a, -dx / d, -dy / d, 1, now);
    this.applyKnock(b, dx / d, dy / d, 1, now);
    a.clashes++;
    b.clashes++;
    v.clashes2++;
    this.pushEvent(EV_CLASH, now, 0.5 * (a.x + b.x), 0.5 * (a.y + b.y), 0, a.slot, "#ffffff", b.x, b.y, (a.slot & 7) * 8 + Math.min(6, q.weapon));
    this.budget.offer(0.6, "block", 1318.51, 0.4);
  }

  /** A breath cone: every foe inside burns (a tick per window: at most three a breath). */
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

  /** --- fl-overhaul --- A weapon beam after its glint: a ray along the locked aim for FL_BEAM_MS. */
  private fireBeam(f: FlFighter, w: FlWeaponState, now: number) {
    const b = this.freeBeam();
    if (!b) return;
    const s = w.spec;
    b.active = true;
    b.owner = f.slot;
    b.team = f.team;
    b.born = now;
    b.until = now + FL_BEAM_MS;
    b.angle = Math.atan2(w.glintY - f.y, w.glintX - f.x);
    b.width = Math.max(1.5, s.size * f.r);
    b.damage = s.damage;
    b.ability = false;
    b.weapon = w.index;
    b.hitMask = 0;
    b.color = s.color ?? f.row.accent;
    w.beam = this.view.beams.indexOf(b);
    w.angle = b.angle;
    this.budget.offer(0.4, "magic", fighterPitch(f.slot) * 2, 0.3);
  }

  /** --- fl-overhaul --- A spark's arc jumps on to a second foe within 2 R of the first (free-for-alls and teams), at half damage. */
  private chainSpark(ctx: ModeContext, f: FlFighter, w: FlWeaponState, firstR: number, now: number) {
    let best: FlFighter | null = null;
    let bestD = Infinity;
    for (const o of this.view.fighters) {
      if (o.team === f.team || !this.targetable(o, now) || o.slot === f.targetSlot) continue;
      const gap = Math.hypot(o.x - w.zapX, o.y - w.zapY) - o.r - firstR;
      if (gap > 2 * f.r || gap >= bestD) continue;
      bestD = gap;
      best = o;
    }
    if (!best) return;
    const d = Math.hypot(best.x - w.zapX, best.y - w.zapY) || 1;
    w.zap2Ms = now;
    w.zap2X = best.x;
    w.zap2Y = best.y;
    this.hit(ctx, f, best, 0.5 * w.spec.damage, (best.x - w.zapX) / d, (best.y - w.zapY) / d, w.spec.knockback, "magic", { weapon: w.index, fromX: w.zapX, fromY: w.zapY });
  }

  /**
   * --- fl-overhaul --- Where to aim a projectile of `speed` (px/s) at `t`: FL_LEAD of the way to the intercept – where the
   * target flying on would meet it (the direct bearing when it cannot be caught).
   */
  private leadAim(f: FlFighter, t: { x: number; y: number; vx: number; vy: number }, speed: number): number {
    const px = t.x - f.x;
    const py = t.y - f.y;
    const u = Math.max(1, speed);
    const a = t.vx * t.vx + t.vy * t.vy - u * u;
    const b = 2 * (px * t.vx + py * t.vy);
    const c = px * px + py * py;
    let time = 0;
    if (Math.abs(a) < 1e-9) time = b < 0 ? -c / b : 0;
    else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a);
        const t2 = (-b + sq) / (2 * a);
        time = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2, 0);
      }
    }
    const lead = FL_LEAD * time;
    return Math.atan2(py + t.vy * lead, px + t.vx * lead);
  }

  /** Fires a shooter's projectile(s) at the target (the bow, guns, wands, orbs, bolts, web, ice): a shotgun's fan; a burst's first round. */
  private shoot(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const s = w.spec;
    const count = s.kind === "shotgun" ? s.count : 1;
    const volley = ++this.volleySerial;
    for (let k = 0; k < count; k++) if (!this.fireRound(f, w, t, now, volley, k, count)) break;
    // --- fl-overhaul --- a burst's other rounds leave the muzzle FL_BURST_GAP apart (never behind the shooter)
    if (s.style === "burst" && s.count > 1) {
      w.burstLeft = s.count - 1;
      w.burstT = FL_BURST_GAP;
      w.burstVolley = volley;
    }
    this.view.shots++;
    this.budget.offer(0.15, FL_SOUND_OF_KIND[s.kind], fighterPitch(f.slot) * 1.5, 0.18);
  }

  /** --- fl-overhaul --- One projectile of a shooter from the muzzle (its own spread draw): pellet `k` of `count`, or a round. */
  private fireRound(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number } | null, now: number, volley: number, k: number, count: number): boolean {
    const p = this.freeProjectile();
    if (!p) return false;
    const s = w.spec;
    const field = this.view.field!;
    const speed = this.projectileSpeed(s.speed, field);
    // Lead the target a little: aim at where it will be half-way through the flight.
    let aim = t ? this.leadAim(f, t, speed) : w.angle;
    if (t && now < f.confusedUntil) aim += Math.PI;
    let spread = s.spread;
    if (this.rigChosen >= 0 && f.team !== this.rigChosen) spread += 6 * this.rigK;
    const jitter = (this.randomDraw() - 0.5) * spread * DEG;
    let a = aim + jitter;
    if (s.kind === "shotgun" && count > 1) a = aim + (k / (count - 1) - 0.5) * s.spread * DEG + 0.25 * jitter;
    this.launch(p, f, PK_SHOT, a, speed, now);
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
    const homedByGiant = this.giantShot(f, p);
    if ((s.homing > 0 || homedByGiant) && p.ret === 0) this.limitHoming(p, now);
    return true;
  }

  /** --- fl-overhaul --- A homing projectile homes FL_HOMING_SEC, then flies straight and fizzles at FL_FIZZLE_SEC. */
  private limitHoming(p: FlProjectile, now: number) {
    p.homeUntil = now + 1000 * FL_HOMING_SEC;
    p.fizzleAt = now + 1000 * FL_FIZZLE_SEC;
  }

  /** Cards: the next loaded blade flies at the target. */
  private fireCard(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const s = w.spec;
    const p = this.freeProjectile();
    if (!p) return;
    const field = this.view.field!;
    const speed = this.projectileSpeed(s.speed, field);
    let aim = this.leadAim(f, t, speed);
    if (now < f.confusedUntil) aim += Math.PI;
    let spread = s.spread;
    if (this.rigChosen >= 0 && f.team !== this.rigChosen) spread += 6 * this.rigK;
    aim += (this.randomDraw() - 0.5) * spread * DEG;
    this.launch(p, f, PK_CARD, aim, speed, now);
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
    if (this.giantShot(f, p)) this.limitHoming(p, now);
    this.view.shots++;
    this.budget.offer(0.12, "blade", fighterPitch(f.slot) * 2, 0.15);
  }

  /**
   * The returning hammer, the pull chain's head or the shield flies at the target – --- fl-overhaul --- led like a shot,
   * homing 1.2 rad/s on its way out (straight back) – and the hand is empty until it is back (`w.thrown`).
   */
  private throwWeapon(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const s = w.spec;
    const p = this.freeProjectile();
    if (!p) return;
    const field = this.view.field!;
    const speed = this.projectileSpeed(s.speed, field);
    const aim = this.leadAim(f, t, speed) + (now < f.confusedUntil ? Math.PI : 0);
    const kind = s.kind === "hammer" ? PK_HAMMER : s.kind === "shield" ? PK_SHIELD : PK_SPEAR;
    this.launch(p, f, kind, aim, speed, now);
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
    p.homing = Math.max(p.homing, 1.2);
    p.target = f.targetSlot;
    w.thrown = this.view.projectiles.indexOf(p);
    this.giantShot(f, p);
    this.budget.offer(0.2, FL_SOUND_OF_KIND[s.kind], fighterPitch(f.slot), 0.2);
  }

  /**
   * --- fl-overhaul --- (Stage 2) A bomb lobbed at the target's predicted spot: a flight of T = 0.6 + 0.3 × min(1, distance ÷ 0.6
   * side) s, landing where the target will be after T (FL_BOMB_MARGIN radii inside the arena; mirrored about the thrower while
   * confused), its ground point moving straight there, no hit in the air; it bursts on landing (a fuse: FL_FUSE_MS later).
   */
  private lobBomb(f: FlFighter, w: FlWeaponState, t: { x: number; y: number; vx: number; vy: number; r: number }, now: number) {
    const p = this.freeProjectile();
    if (!p) return;
    const s = w.spec;
    const field = this.view.field!;
    const dist = Math.hypot(t.x - f.x, t.y - f.y);
    const T = 0.6 + 0.3 * Math.min(1, dist / Math.max(1e-6, 0.6 * field.side));
    // Where the target will be when it bursts (a fuse lies a moment longer), its flight folded off the arena's walls.
    const ahead = T + (s.style === "fuse" ? FL_FUSE_MS / 1000 : 0);
    const lim = Math.max(1, field.half - FL_BOMB_MARGIN * f.r);
    const landing = foldedFlight(field, t.x, t.y, t.vx, t.vy, ahead, Math.max(1, field.half - t.r), this.tgtB);
    let lx = landing.x;
    let ly = landing.y;
    if (now < f.confusedUntil) {
      lx = 2 * f.x - lx;
      ly = 2 * f.y - ly;
    }
    if (field.kind === "circle") {
      const dx = lx - field.cx;
      const dy = ly - field.cy;
      const d = Math.hypot(dx, dy);
      if (d > lim) {
        lx = field.cx + (dx / d) * lim;
        ly = field.cy + (dy / d) * lim;
      }
    } else {
      lx = Math.max(field.cx - lim, Math.min(field.cx + lim, lx));
      ly = Math.max(field.cy - lim, Math.min(field.cy + lim, ly));
    }
    this.launch(p, f, PK_BOMB, Math.atan2(ly - f.y, lx - f.x), 0, now);
    p.weapon = w.index;
    p.volley = ++this.volleySerial;
    p.r = Math.max(1.5, s.size * f.r);
    p.damage = s.damage;
    p.kb = s.knockback;
    p.shape = s.shape;
    p.color = s.color ?? f.row.accent;
    p.target = f.targetSlot;
    p.homing = 0;
    p.x0 = p.x;
    p.y0 = p.y;
    p.x1 = lx;
    p.y1 = ly;
    p.flyT = 0;
    p.flyDur = 1000 * T;
    p.flyFrom = now;
    p.flyUntil = now + p.flyDur;
    p.lift = FL_BOMB_LIFT * f.r;
    p.splash = Math.max(1, s.effect * f.r);
    p.fuseMs = s.style === "fuse" ? FL_FUSE_MS : 0;
    p.fuseUntil = -1;
    p.until = now + 2 * p.flyDur + p.fuseMs + 1000;
    this.giantShot(f, p);
    this.view.shots++;
    this.budget.offer(0.12, FL_SOUND_OF_KIND.bomb, fighterPitch(f.slot) * 0.75, 0.14);
  }

  private projectileSpeed(sidesPerSec: number, field: FlField): number {
    return Math.max(10, sidesPerSec * field.side * (this.unit / Math.max(1e-9, field.side * FL_SPEED_FRAC)));
  }

  /** A giant hit loaded on the owner travels with its next shot (and homes when it says so: true then); a miss brings it back. */
  private giantShot(f: FlFighter, p: FlProjectile): boolean {
    if (f.giantLeft <= 0) return false;
    f.giantLeft--;
    p.giant = f.giantMult;
    p.giantKb = f.giantKb;
    p.giantFreeze = f.giantFreeze;
    if (f.giantHoming > 0) {
      p.homing = Math.max(p.homing, f.giantHoming);
      return true;
    }
    return false;
  }

  /** A projectile leaves `f`'s rim along `angle` (--- fl-overhaul --- every field reset: a pooled projectile carries nothing of its last use). */
  private launch(p: FlProjectile, f: FlFighter, kind: number, angle: number, speed: number, now: number) {
    p.active = true;
    p.kind = kind;
    p.owner = f.slot;
    p.team = f.team;
    const start = f.r + 2;
    p.x = f.x + Math.cos(angle) * start;
    p.y = f.y + Math.sin(angle) * start;
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
    p.sepMask = 0;
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
    p.weapon = -1;
    p.volley = 0;
    p.id = ++this.projSerial;
    p.homeUntil = Infinity;
    p.fizzleAt = Infinity;
    // (Stage 2)
    p.pierce = false;
    p.flyDur = 0;
    p.flyT = 0;
    p.fuseMs = 0;
    p.fuseUntil = -1;
    p.lift = 0;
    p.splash = 0;
    if (this.rigChosen >= 0 && f.team === this.rigChosen) p.homing = 2.2 * this.rigK;
  }

  /** One draw of the run's random numbers (every shot's spread, cuts, minions' headings, rim turns, clash coins – in step order). */
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
      // --- fl-overhaul --- (Stage 2) a bomb flies its arc over everything, then bursts
      if (p.kind === PK_BOMB) {
        if (this.stepBomb(ctx, p, now, step)) this.endProjectile(ctx, p, i, now);
        continue;
      }
      // --- fl-overhaul --- a homing shot fizzles out
      if (now >= p.fizzleAt) {
        this.pushEvent(EV_POP, now, p.x, p.y, 0, p.owner, p.color);
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
      } else if (p.homing > 0 && now < p.homeUntil) {
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
      // --- fl-overhaul --- (Stage 2) an enemy wall stops it where its path crosses it
      if (this.wallStops(p, p.x - mx, p.y - my)) {
        this.pushEvent(EV_POP, now, p.x, p.y, 0, p.owner, p.color);
        this.endProjectile(ctx, p, i, now);
        continue;
      }
      if (p.ret === 1) {
        p.range -= Math.hypot(mx, my);
        if (p.range <= 0) this.turnBack(p);
      }
      // --- fl-overhaul --- a foe it hit on the way out leaves its mask once it has separated from it (no second hit at the turn)
      if (p.sepMask) {
        for (const o of v.fighters) {
          const bit = 1 << o.slot;
          if (!(p.sepMask & bit)) continue;
          if (!o.alive || !circlesTouch(p.x, p.y, p.r, o.x, o.y, o.r)) {
            p.sepMask &= ~bit;
            p.hitMask &= ~bit;
          }
        }
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
        // --- fl-overhaul --- (Stage 2) a deflecting reflection (Soresu) sends a shot, a card or an ability's projectile back at its shooter
        if (o.deflect && now < o.reflectUntil && !p.unblockable && (p.kind === PK_SHOT || p.kind === PK_CARD || p.kind === PK_ABILITY)) {
          this.deflect(p, o, owner, now);
          break;
        }
        p.hitMask |= bit;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const sound = p.kind === PK_HAMMER ? "blunt" : p.kind === PK_SHIELD || p.kind === PK_CARD ? "blade" : p.kind === PK_SPEAR ? "blunt" : p.weapon >= 0 ? FL_SOUND_OF_KIND[owner.weapons[p.weapon]?.spec.kind ?? "gun"] : "magic";
        const res = this.hit(ctx, owner, o, p.damage, p.vx / sp, p.vy / sp, p.kb, sound, { weapon: p.weapon, volley: p.volley, fromX: p.x - (p.vx / sp) * 4 * p.r, fromY: p.y - (p.vy / sp) * 4 * p.r, unblockable: p.unblockable, projectile: p });
        if (res === HIT_WINDOW) {
          // --- fl-overhaul --- refused by its source's window: a graze – it ends there (a giant hit passes through and keeps
          // its charge; a returning weapon turns back or flies on)
          if (p.giant > 0) continue;
          this.graze(p, owner, now);
          if (p.ret === 1) {
            this.turnBack(p);
            continue;
          }
          if (p.ret === 2 || p.foes) continue;
          this.endProjectile(ctx, p, i, now);
          break;
        }
        const landed = res === HIT_LANDED;
        if (landed && p.slow > 0) {
          // (the strongest slow applies: another web extends it, never stacks)
          if (now < o.slowUntil) o.slowFactor = Math.min(o.slowFactor, p.slow);
          else o.slowFactor = p.slow;
          o.slowUntil = Math.max(o.slowUntil, now + 1000 * p.slowSec);
        }
        if (landed && p.freeze > 0 && this.applyHardCc(o, now + 1000 * p.freeze, now)) {
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
        if (p.ret === 2 || p.pierce) continue; // (--- fl-overhaul --- a piercing volley flies on)
        this.endProjectile(ctx, p, i, now);
        break;
      }
      if (!p.active) continue;
      for (const m of v.minions) {
        if (!m.active || m.team === p.team) continue;
        if (!circlesTouch(p.x, p.y, p.r, m.x, m.y, m.r)) continue;
        this.hitMinion(ctx, owner, m, now);
        if (p.ret === 0 && !p.foes && !p.pierce) {
          this.endProjectile(ctx, p, i, now);
          break;
        }
      }
    }
  }

  /**
   * --- fl-overhaul --- (Stage 2) A bomb's step: its ground point on toward the landing spot (× the side's time scale; the
   * renderer's arc follows `flyFrom`/`flyUntil`), then its fuse, then the burst. True once it burst (the caller ends it).
   */
  private stepBomb(ctx: ModeContext, p: FlProjectile, now: number, step: number): boolean {
    if (p.flyT < p.flyDur) {
      p.flyT = Math.min(p.flyDur, p.flyT + 1000 * step);
      const u = p.flyDur > 0 ? p.flyT / p.flyDur : 1;
      p.x = p.x0 + (p.x1 - p.x0) * u;
      p.y = p.y0 + (p.y1 - p.y0) * u;
      p.spin += 9 * step;
      p.flyFrom = now - p.flyT;
      p.flyUntil = p.flyFrom + p.flyDur;
      if (p.flyT < p.flyDur) return false;
      if (p.fuseMs > 0) {
        p.fuseUntil = now + p.fuseMs;
        return false;
      }
    }
    if (p.fuseUntil >= 0 && now < p.fuseUntil) return false;
    this.burstBomb(ctx, p, now);
    return true;
  }

  /**
   * --- fl-overhaul --- (Stage 2) A bomb bursts: every foe overlapping its splash (+ its own radius) takes its damage × (1 − 0.4 ×
   * how far out it stands, 0 at the centre and 1 at the edge), knocked away from the centre; enemy minions in it (traps above all)
   * pop. A foe that got away takes nothing.
   */
  private burstBomb(ctx: ModeContext, p: FlProjectile, now: number) {
    const owner = this.view.fighters[p.owner];
    if (!owner) return;
    this.pushEvent(EV_SHOCK, now, p.x, p.y, p.splash, owner.slot, p.color);
    for (const o of this.view.fighters) {
      if (!o.alive || o.team === p.team || o.hp <= 0) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      const reach = p.splash + o.r;
      if (d > reach) continue;
      const edge = Math.min(1, d / Math.max(1e-6, reach));
      const nx = d > 1e-6 ? (o.x - p.x) / d : 1;
      const ny = d > 1e-6 ? (o.y - p.y) / d : 0;
      this.hit(ctx, owner, o, p.damage * (1 - 0.4 * edge), nx, ny, p.kb, FL_SOUND_OF_KIND.bomb, { weapon: p.weapon, volley: p.volley, fromX: p.x, fromY: p.y, projectile: p });
    }
    for (const m of this.view.minions) if (m.active && m.team !== p.team && Math.hypot(m.x - p.x, m.y - p.y) <= p.splash + m.r) this.hitMinion(ctx, owner, m, now);
    this.budget.offer(p.damage + 3, FL_SOUND_OF_KIND.bomb, 110, 0.7);
  }

  /** --- fl-overhaul --- (Stage 2) Whether an enemy wall stops projectile `p` on its way from (x0, y0) to where it is (its path within its radius of the wall). */
  private wallStops(p: FlProjectile, x0: number, y0: number): boolean {
    for (const w of this.view.walls) {
      if (!w.active || w.team === p.team) continue;
      if (segmentSegmentDistanceSq(x0, y0, p.x, p.y, w.x1, w.y1, w.x2, w.y2) <= p.r * p.r) return true;
    }
    return false;
  }

  /**
   * --- fl-overhaul --- (Stage 2) A deflection (a reflection with `deflect`): the projectile changes sides and flies back at its
   * shooter with the reflection's share of its damage, homing 2 rad/s (FL_HOMING_SEC, then it fizzles); a giant hit it carried goes
   * back to the shooter; sparks where it turned (EV_BLOCK).
   */
  private deflect(p: FlProjectile, by: FlFighter, shooter: FlFighter, now: number) {
    if (p.giant > 0 && shooter.alive && !this.view.finished) shooter.giantLeft++;
    p.giant = 0;
    p.owner = by.slot;
    p.team = by.team;
    p.damage *= by.reflectFrac;
    p.weapon = -1;
    p.volley = ++this.volleySerial;
    p.blink = false;
    p.pull = false;
    p.ret = 0;
    p.foes = 0;
    p.range = 0;
    p.bounces = 0;
    p.hitMask = 0;
    p.sepMask = 0;
    const sp = Math.max(1, Math.hypot(p.vx, p.vy));
    const a = Math.atan2(shooter.y - p.y, shooter.x - p.x);
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    // (out of the deflector's body first: it must not touch it on its way back)
    const d = Math.hypot(p.x - by.x, p.y - by.y) || 1;
    const out = by.r + p.r + 1;
    if (d < out) {
      p.x = by.x + ((p.x - by.x) / d) * out;
      p.y = by.y + ((p.y - by.y) / d) * out;
    }
    p.homing = 2;
    p.target = shooter.slot;
    this.limitHoming(p, now);
    by.blocks++;
    this.view.blocks++;
    this.pushEvent(EV_BLOCK, now, p.x, p.y, 0, by.slot, "#fef9c3", 0, 0, (by.slot & 7) * 8 + 7);
    this.budget.offer(0.6, "block", 1567.98, 0.4);
  }

  /** --- fl-overhaul --- A projectile refused by a window: EV_GRAZE where it touched (its owner's colour, its source). */
  private graze(p: FlProjectile, owner: FlFighter, now: number) {
    this.view.grazes++;
    owner.grazes++;
    this.pushEvent(EV_GRAZE, now, p.x, p.y, 0, owner.slot, p.color, 0, 0, (owner.slot & 7) * 8 + (p.weapon >= 0 ? Math.min(6, p.weapon) : 7));
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

  /** A returning projectile turns back to its owner; --- fl-overhaul --- the foes it hit stay masked until it has left them. */
  private turnBack(p: FlProjectile) {
    p.ret = 2;
    p.sepMask = p.hitMask;
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

  /**
   * A projectile ends: a thrown weapon comes back to its owner's hand; Katarina blinks to her dagger; --- fl-overhaul --- an
   * unspent giant hit goes back to its owner (a miss loses nothing).
   */
  private endProjectile(ctx: ModeContext, p: FlProjectile, index: number, now: number) {
    const v = this.view;
    const owner = v.fighters[p.owner];
    if (p.blink && owner && owner.alive && this.canAct(owner, now)) this.blinkTo(ctx, owner, p.x, p.y, now, owner.weapons[p.weapon]?.spec.damage ?? 5);
    if (p.giant > 0 && owner && owner.alive && !v.finished) owner.giantLeft++;
    p.giant = 0;
    p.active = false;
    if (owner) for (const w of owner.weapons) if (w.thrown === index) w.thrown = -1;
  }

  /**
   * A blink: to (x, y), a spin of blades around the fighter (Katarina; `damage` 0: none). --- fl-overhaul --- The spin is an
   * ability-like source with its own window: the dagger that just hit no longer cancels it.
   */
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
    if (!(damage > 0)) return;
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

  /** A hit on a decoy or a summon: it pops (a freeze decoy freezes its attacker – a hard crowd control). */
  private hitMinion(ctx: ModeContext, attacker: FlFighter, m: FlMinion, now: number) {
    m.hp--;
    if (m.hp > 0) return;
    m.active = false;
    this.pushEvent(EV_POP, now, m.x, m.y, 0, m.owner, m.color);
    if (m.freezeOnTouch > 0 && attacker.alive && this.applyHardCc(attacker, now + 1000 * m.freezeOnTouch, now)) {
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

  /** --- fl-overhaul --- The window (ms) a hit of `attacker`'s weapon `weapon` (−1: its abilities, summons, contact) opens on its target. */
  private windowOf(attacker: FlFighter, weapon: number, now: number): number {
    const w = weapon >= 0 ? attacker.weapons[weapon] : undefined;
    return w ? flSourceWindowMs(w.spec.kind, w.spec.cooldown, this.attackOf(attacker, now)) : FL_IFRAME_MS;
  }

  /**
   * `attacker` hits `target` for `damage` (before its damage stat and buffs) from direction (dx, dy): invulnerability, the
   * window of the hit's source on the target (--- fl-overhaul --- per source: attacker × 8 + weapon, 7 its abilities – two
   * sources may land together, one never faster than its window; a volley's other projectiles exempt), a shield block (a
   * block spends the guard), giant hits, reflection, knockback by weight, the counters, the meters by damage, the events and
   * the sound. Returns what happened (HIT_LANDED when damage landed).
   */
  private hit(ctx: ModeContext, attacker: FlFighter, target: FlFighter, damage: number, dx: number, dy: number, kb: number, sound: FlSoundKind, opts: HitOptions = {}): number {
    const v = this.view;
    const now = this.now();
    if (!target.alive || target.hp <= 0 || v.finished) return HIT_NONE;
    // --- fl-overhaul --- a fighter whose last HP went earlier this step strikes no more (its shots in the air still fly)
    if (attacker.hp <= 0 && !opts.projectile && attacker !== target) return HIT_NONE;
    const weapon = opts.weapon !== undefined && opts.weapon >= 0 ? opts.weapon : -1;
    if (weapon >= 0 && now < attacker.disarmedUntil) return HIT_NONE;
    if (now < target.invulnUntil) {
      this.immune(target, now);
      return HIT_IMMUNE;
    }
    const src = (attacker.slot & 7) * 8 + (weapon >= 0 ? Math.min(6, weapon) : 7);
    const proj = opts.projectile;
    const sameVolley = opts.volley !== undefined && opts.volley > 0 && target.lastVolley === opts.volley && now - target.lastVolleyMs < 400 && (!proj || proj.id !== target.lastVolleyProj);
    if (!opts.ignoreIframes && !sameVolley && now < target.srcUntil[src]) return HIT_WINDOW;
    // A held shield blocks hits from the side it faces (the target) while its guard is up.
    if (!opts.unblockable) {
      for (const w of target.weapons) {
        if (w.spec.kind !== "shield" || w.thrown >= 0 || now < w.guardUntil) continue;
        const fx = opts.fromX ?? attacker.x;
        const fy = opts.fromY ?? attacker.y;
        if (!shieldBlocks(w.angle, Math.atan2(fy - target.y, fx - target.x))) continue;
        w.guardUntil = now + (w.spec.style === "block" ? FL_BRACERS_GUARD_MS : FL_GUARD_MS);
        target.srcUntil[src] = now + 0.5 * FL_IFRAME_MS;
        target.blocks++;
        v.blocks++;
        this.pushEvent(EV_BLOCK, now, target.x + Math.cos(w.angle) * target.r * 1.2, target.y + Math.sin(w.angle) * target.r * 1.2, 0, target.slot, "#fef9c3", 0, 0, src);
        this.budget.offer(0.6, "block", 1567.98, 0.4);
        return HIT_BLOCKED;
      }
    }
    let amount = damage * attacker.damage * (opts.scale ?? 1);
    if (now < attacker.dmgMulUntil) amount *= attacker.dmgMul;
    let knock = kb;
    if (now < attacker.dmgMulUntil) knock *= attacker.kbMul;
    // A giant hit: carried by the projectile, or the next melee hit of the attacker.
    let giant = 0;
    let giantKb = 0;
    let giantFreeze = 0;
    if (proj && proj.giant > 0) {
      giant = proj.giant;
      giantKb = proj.giantKb;
      giantFreeze = proj.giantFreeze;
      proj.giant = 0;
    } else if (opts.melee && attacker.giantLeft > 0) {
      attacker.giantLeft--;
      giant = attacker.giantMult;
      giantKb = attacker.giantKb;
      giantFreeze = attacker.giantFreeze;
    }
    if (giant > 0) {
      amount = giantDamage(amount, giant, target.hp, target.maxHp, attacker.giantBelowHalf, attacker.giantFrac);
      knock += giantKb;
      if (giantFreeze > 0 && this.applyHardCc(target, now + 1000 * giantFreeze, now)) target.frozenUntil = Math.max(target.frozenUntil, now + 1000 * giantFreeze);
      this.pushEvent(EV_SHOCK, now, target.x, target.y, target.r * 2.2, attacker.slot, attacker.row.accent);
    }
    if (!(amount > 0)) return HIT_NONE;
    const before = target.hp;
    target.hp -= amount;
    this.absorbLethal(target, before);
    const rig = this.rigChosen >= 0 && target.team === this.rigChosen ? 1 + 0.8 * this.rigK : 1;
    target.srcUntil[src] = now + this.windowOf(attacker, weapon, now) * rig;
    if (opts.volley) {
      target.lastVolley = opts.volley;
      target.lastVolleyMs = now;
      target.lastVolleyProj = proj ? proj.id : -1;
    }
    const dealt = before - Math.max(0, target.hp);
    // --- fl-overhaul --- (Stage 2) a drain heals its attacker a share of the damage it dealt (up to its maximum)
    if (now < attacker.drainUntil && attacker !== target && attacker.alive && attacker.hp > 0) {
      const heal = Math.min(attacker.maxHp - attacker.hp, attacker.drainFrac * dealt);
      if (heal > 0) {
        attacker.hp += heal;
        this.pushEvent(EV_HEAL, now, attacker.x, attacker.y - attacker.r, heal, attacker.slot, "#4ade80");
      }
    }
    target.hitMs = now;
    target.lastHitBy = attacker.slot;
    target.taken++;
    attacker.hits++;
    if (weapon >= 0 && attacker.weapons[weapon]) {
      attacker.weapons[weapon].hits++;
      attacker.weapons[weapon].dealt += dealt;
    }
    attacker.dealt += dealt;
    v.hits++;
    v.lastHitMs = now;
    // --- fl-overhaul --- the meters fill by the damage (a chip barely moves them, a big hit does)
    attacker.meter = Math.min(1, attacker.meter + hitCharge(amount, false) * attacker.cast);
    target.meter = Math.min(1, target.meter + hitCharge(amount, true) * target.cast);
    this.applyKnock(target, dx, dy, knock, now);
    // Reflection: the attacker takes its share back – through the same guards as a hit (none while it is invulnerable, and
    // the rig's backstop holds against it).
    if (now < target.reflectUntil && attacker !== target && attacker.alive && now >= attacker.invulnUntil) {
      const back = amount * target.reflectFrac;
      const had = attacker.hp;
      attacker.hp -= back;
      this.absorbLethal(attacker, had);
      attacker.hitMs = now;
      this.pushEvent(EV_DAMAGE, now, attacker.x, attacker.y - attacker.r, back, attacker.slot, target.row.accent, 0, 0, (target.slot & 7) * 8 + 7);
    }
    const ball = this.byIndex[target.slot];
    const attackerBall = this.byIndex[attacker.slot];
    if (ball && attackerBall) ctx.noteCollide?.(attackerBall, ball); // --- bounce-math --- a hit is a ball hit
    this.pushEvent(EV_DAMAGE, now, target.x, target.y - target.r, amount, target.slot, attacker.row.accent, 0, 0, src);
    if (!opts.quiet || giant > 0) this.pushEvent(EV_HIT, now, (target.x + (opts.fromX ?? attacker.x)) / 2, (target.y + (opts.fromY ?? attacker.y)) / 2, amount, attacker.slot, attacker.row.accent, 0, 0, src);
    this.budget.offer(amount, sound, fighterPitch(attacker.slot), Math.min(1, 0.45 + amount / 20));
    return HIT_LANDED;
  }

  /** --- fl-overhaul --- Knockback of `f` along (dx, dy): `kb` cruise units × its weight (a pinned or held fighter does not budge). */
  private applyKnock(f: FlFighter, dx: number, dy: number, kb: number, now: number) {
    const ball = this.byIndex[f.slot];
    if (!ball || !(kb > 0) || this.pinned(f, now)) return;
    const push = kb * this.unit * f.weight;
    ball.vx += dx * push;
    ball.vy += dy * push;
    f.vx = ball.vx;
    f.vy = ball.vy;
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

  /**
   * Fires one primitive of `f`'s ability. --- fl-overhaul --- A choke, a disarm or a pull acts on the nearest foe FIGHTER
   * (never a decoy); beams and volleys go where the aim locked at the telegraph's start; holds, freezes and pins are hard
   * crowd control (`applyHardCc()`); a choke cast with a pull (the Lasso of Truth) closes when the pull arrives.
   */
  private castEffect(ctx: ModeContext, f: FlFighter, e: FlEffect, now: number) {
    const v = this.view;
    const field = v.field!;
    const foe = this.nearestFoeFighter(f, now);
    const aimAt = Math.atan2(f.castY - f.y, f.castX - f.x);
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
          if (!o.alive || o.team === f.team || !this.applyHardCc(o, now + 1000 * e.dur, now)) continue;
          o.frozenUntil = Math.max(o.frozenUntil, now + 1000 * e.dur);
          this.pushEvent(EV_FREEZE, now, o.x, o.y, e.dur, o.slot, "#bae6fd");
        }
        break;
      case "choke": {
        if (!foe) break;
        const at = e.at ?? "start";
        if (f.row.ability.effects.some((x) => x.p === "pull") && now < foe.pullUntil && foe.pullBy === f.slot) {
          // The lasso: the hold waits for the pull to bring the foe in.
          foe.pendingHoldBy = f.slot;
          foe.pendingHoldDur = e.dur;
          foe.pendingHoldDamage = e.damage;
          foe.pendingHoldAt = at;
          break;
        }
        this.applyHold(ctx, f, foe, e.dur, e.damage, at, now);
        break;
      }
      case "arenaCuts": {
        // Each cut through where its foe will be when it lands, along its flight ± 30° (a timing error along the line does not
        // matter), 0.35 of the caster's radius on either side.
        const foes = v.fighters.filter((o) => o.alive && o.team !== f.team);
        for (let k = 0; k < e.n; k++) {
          const task = this.freeTask();
          if (!task || foes.length === 0) break;
          const o = foes[k % foes.length];
          const heading = Math.hypot(o.vx, o.vy) > 1e-3 ? Math.atan2(o.vy, o.vx) : Math.atan2(o.y - f.y, o.x - f.x);
          const a = heading + (this.randomDraw() - 0.5) * (Math.PI / 3);
          const len = 2 * field.half;
          const delay = 300 + 150 * k;
          const px = o.x + (o.vx * delay) / 1000;
          const py = o.y + (o.vy * delay) / 1000;
          task.active = true;
          task.kind = "cut";
          task.owner = f.slot;
          task.born = now;
          task.at = now + delay;
          task.x = px - Math.cos(a) * len;
          task.y = py - Math.sin(a) * len;
          task.x2 = px + Math.cos(a) * len;
          task.y2 = py + Math.sin(a) * len;
          task.radius = Math.max(2, 0.35 * f.r);
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
        b.angle = aimAt;
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
        const volley = ++this.volleySerial;
        for (let k = 0; k < e.n; k++) {
          const p = this.freeProjectile();
          if (!p) break;
          const spread = (e.spread ?? 0) * DEG;
          const a = e.n > 1 ? aimAt + (k / (e.n - 1) - 0.5) * spread : aimAt;
          this.launch(p, f, PK_ABILITY, a, speed, now);
          p.volley = volley;
          p.r = Math.max(2, (e.size ?? 0.2) * f.r);
          p.damage = e.damage;
          p.kb = e.knockback ?? (e.explode ? 0.5 : 0.8); // (--- fl-overhaul --- a volley's own knockback)
          p.pierce = !!e.pierce;
          p.shape = e.shape ?? "bolt";
          p.color = e.color ?? f.row.accent;
          p.homing = Math.max(p.homing, e.homing ?? 0);
          p.target = foe ? foe.slot : f.targetSlot;
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
          const homedByGiant = this.giantShot(f, p);
          if (((e.homing ?? 0) > 0 || homedByGiant) && p.ret === 0) this.limitHoming(p, now);
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
          if (!e.all && o !== foe) continue;
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
          m.trap = false;
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
        f.giantFrac = e.maxHpFrac ?? (e.halfMaxHp ? 0.5 : 0);
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
          const sp = Math.max((e.speed ?? 1.2) * this.unit, 1); // (--- fl-overhaul --- a fast summon: its own speed)
          m.active = true;
          m.summon = true;
          m.trap = false;
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
        f.deflect = !!e.deflect; // --- fl-overhaul --- (Stage 2)
        break;
      case "disarm":
        if (foe && foe.alive) foe.disarmedUntil = now + 1000 * e.dur;
        break;
      case "slowTime":
        v.slowTimeUntil = now + 1000 * e.dur;
        v.slowTimeTeam = f.team;
        v.slowTimeFactor = e.factor;
        break;
      // --- fl-overhaul --- (Stage 2)
      case "trap":
        this.dropTraps(f, e, now);
        break;
      case "wall": {
        // A barrier 2 R ahead, across the line to the nearest foe (its facing without one).
        const wall = this.freeWall();
        const a = foe ? Math.atan2(foe.y - f.y, foe.x - f.x) : f.aim;
        const cx = f.x + Math.cos(a) * FL_WALL_AHEAD * f.r;
        const cy = f.y + Math.sin(a) * FL_WALL_AHEAD * f.r;
        const half = 0.5 * (e.length ?? FL_WALL_LENGTH) * f.r;
        const px = -Math.sin(a);
        const py = Math.cos(a);
        wall.active = true;
        wall.owner = f.slot;
        wall.team = f.team;
        wall.x1 = cx + px * half;
        wall.y1 = cy + py * half;
        wall.x2 = cx - px * half;
        wall.y2 = cy - py * half;
        wall.born = now;
        wall.until = now + 1000 * e.dur;
        wall.solid = !!e.solid;
        wall.shape = e.shape ?? (e.solid ? "brickwall" : "windwall");
        wall.color = f.row.accent;
        break;
      }
      case "transform":
        // Bigger or smaller (the hitbox follows), the bursts through the stats' own fields, the HP unchanged.
        f.sizeMul = e.size;
        f.transformUntil = now + 1000 * e.dur;
        f.speedMul = e.speed;
        f.speedMulUntil = f.transformUntil;
        f.dmgMul = e.damage;
        f.kbMul = 1;
        f.dmgMulUntil = f.transformUntil;
        if (e.attackSpeed) {
          f.atkMul = e.attackSpeed;
          f.atkMulUntil = f.transformUntil;
        }
        f.weight = knockbackWeight(f.row.stats.size * e.size);
        this.applySize(f);
        this.pushEvent(EV_TRANSFORM, now, f.x, f.y, 1, f.slot, f.row.accent);
        break;
      case "drain":
        f.drainFrac = e.frac;
        f.drainUntil = now + 1000 * e.dur;
        break;
    }
  }

  /**
   * --- fl-overhaul --- (Stage 2) Traps dropped at the owner and every FL_TRAP_GAP radii along its heading (inside the arena),
   * armed after FL_TRAP_ARM_MS for `dur` seconds; an owner keeps at most FL_TRAPS_PER_OWNER (the oldest pops).
   */
  private dropTraps(f: FlFighter, e: Extract<FlEffect, { p: "trap" }>, now: number) {
    const v = this.view;
    const field = v.field!;
    const moving = Math.hypot(f.vx, f.vy) > 1e-3;
    const heading = moving ? Math.atan2(f.vy, f.vx) : f.aim;
    const r = Math.max(2, FL_TRAP_R * f.r);
    for (let k = 0; k < e.n; k++) {
      let count = 0;
      let oldest: FlMinion | null = null;
      for (const m of v.minions) {
        if (!m.active || !m.trap || m.owner !== f.slot) continue;
        count++;
        if (!oldest || m.born < oldest.born) oldest = m;
      }
      if (count >= FL_TRAPS_PER_OWNER && oldest) {
        oldest.active = false;
        this.pushEvent(EV_POP, now, oldest.x, oldest.y, 0, oldest.owner, oldest.color);
      }
      const m = this.freeMinion();
      if (!m) break;
      let x = f.x + Math.cos(heading) * FL_TRAP_GAP * f.r * k;
      let y = f.y + Math.sin(heading) * FL_TRAP_GAP * f.r * k;
      const lim = Math.max(1, field.half - r - 1);
      if (field.kind === "circle") {
        const dx = x - field.cx;
        const dy = y - field.cy;
        const d = Math.hypot(dx, dy);
        if (d > lim) {
          x = field.cx + (dx / d) * lim;
          y = field.cy + (dy / d) * lim;
        }
      } else {
        x = Math.max(field.cx - lim, Math.min(field.cx + lim, x));
        y = Math.max(field.cy - lim, Math.min(field.cy + lim, y));
      }
      m.active = true;
      m.summon = false;
      m.trap = true;
      m.owner = f.slot;
      m.team = f.team;
      m.x = x;
      m.y = y;
      m.vx = 0;
      m.vy = 0;
      m.r = r;
      m.born = now + 1e-3 * k;
      m.until = now + 1000 * (e.dur ?? 8);
      m.armedAt = now + FL_TRAP_ARM_MS;
      m.hp = 1;
      m.damage = e.damage;
      m.hold = e.hold;
      m.freezeOnTouch = 0;
      m.shape = e.shape ?? "jaws";
      m.color = f.row.accent;
    }
  }

  /**
   * A shockwave at (x, y): damage and knockback for every foe within `radius` (with `pin` thrown to the far wall and held
   * there a second – a hard crowd control – --- fl-overhaul --- fully inside the arena).
   */
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
      const res = this.hit(ctx, f, o, damage, nx, ny, kb, spin ? "blade" : "blunt", { ignoreIframes: true, unblockable: spin ? false : true, fromX: x, fromY: y });
      if (pin && o.alive && res !== HIT_IMMUNE && res !== HIT_NONE && this.applyHardCc(o, now + 1000, now)) {
        // Pinned to the far wall: thrown there and held a moment.
        const ball = this.byIndex[o.slot];
        const field = this.view.field!;
        if (ball) {
          const len = rayToEdge(field, o.x, o.y, nx, ny);
          ball.x = o.x + nx * Math.max(0, len - o.r - 1);
          ball.y = o.y + ny * Math.max(0, len - o.r - 1);
          this.clampInsideArena(o, ball);
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
          if (segmentHitsCircle(task.x, task.y, task.x2, task.y2, Math.max(2, task.radius), o.x, o.y, o.r)) this.hit(ctx, f, o, task.damage, 0, 0, 0.4, "blade", { ignoreIframes: true, unblockable: true });
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

  /** Fire rings: every foe within the ring burns (a tick per window; the kicks of a spinning kick thud, blades ring). */
  private stepFireRings(ctx: ModeContext, now: number, order: readonly FlFighter[]) {
    const fs = this.view.fighters;
    for (const f of order) {
      if (!f.alive || now >= f.fireRingUntil) continue;
      const sound: FlSoundKind = f.fireRingShape === "flames" ? "fire" : f.fireRingShape === "kicks" ? "blunt" : "blade";
      for (const o of fs) {
        if (!o.alive || o.team === f.team) continue;
        if (!circlesTouch(f.x, f.y, f.fireRingRadius, o.x, o.y, o.r)) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y) || 1;
        this.hit(ctx, f, o, f.fireRingDamage, (o.x - f.x) / d, (o.y - f.y) / d, 0.4, sound, { quiet: true });
      }
      for (const m of this.view.minions) if (m.active && m.team !== f.team && circlesTouch(f.x, f.y, f.fireRingRadius, m.x, m.y, m.r)) this.hitMinion(ctx, f, m, now);
    }
  }

  /** Decoys and summons move and bounce; summons hit the foes they touch, freeze decoys freeze them (a hard crowd control). */
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
      // --- fl-overhaul --- (Stage 2) a trap lies still; armed, the first foe to touch it takes its damage (unblockable) and its hold
      if (m.trap) {
        if (now < m.armedAt || now < v.introMs || v.finished) continue;
        const owner = v.fighters[m.owner];
        for (const o of v.fighters) {
          if (!o.alive || o.team === m.team || o.hp <= 0 || !circlesTouch(m.x, m.y, m.r, o.x, o.y, o.r)) continue;
          m.active = false;
          this.pushEvent(EV_TRAP, now, m.x, m.y, m.hold, m.owner, m.color);
          this.hit(ctx, owner, o, m.damage, 0, 0, 0, "blunt", { unblockable: true, ignoreIframes: true, fromX: m.x, fromY: m.y });
          if (m.hold > 0 && o.alive && o.hp > 0) this.applyHold(ctx, owner, o, m.hold, 0, "start", now);
          break;
        }
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
          if (this.applyHardCc(o, now + 1000 * m.freezeOnTouch, now)) {
            o.frozenUntil = Math.max(o.frozenUntil, now + 1000 * m.freezeOnTouch);
            this.pushEvent(EV_FREEZE, now, o.x, o.y, m.freezeOnTouch, o.slot, "#bae6fd");
          }
          m.active = false;
          this.pushEvent(EV_POP, now, m.x, m.y, 0, m.owner, m.color);
          break;
        }
      }
    }
  }

  /**
   * Beams: follow their owner (from its hand, 1.1 radii out), turn slowly toward its target – an ability beam ≤ 1.2 rad/s
   * from where its aim locked, a weapon's ≤ 2 rad/s; ability beams tick on the window, a weapon beam hits each foe once a
   * ray (--- fl-overhaul --- a hit refused by a window leaves it free to land later in the ray).
   */
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
      b.x0 = f.x + ux * f.r * 1.1;
      b.y0 = f.y + uy * f.r * 1.1;
      const len = rayToEdgeOrWall(field, b.x0, b.y0, ux, uy, v.walls, b.team); // --- fl-overhaul --- (an enemy wall stops it)
      b.x1 = b.x0 + ux * len;
      b.y1 = b.y0 + uy * len;
      if (now < v.introMs) continue;
      for (const o of v.fighters) {
        if (!o.alive || o.team === b.team || o.hp <= 0) continue;
        if (!b.ability && b.hitMask & (1 << o.slot)) continue;
        if (!segmentHitsCircle(b.x0, b.y0, b.x1, b.y1, 0.5 * b.width, o.x, o.y, o.r)) continue;
        const res = this.hit(ctx, f, o, b.damage, ux, uy, b.ability ? 0.35 : 0.4, "magic", { quiet: b.ability, unblockable: b.ability, fromX: b.x0, fromY: b.y0, weapon: b.weapon });
        if (!b.ability && res !== HIT_WINDOW) b.hitMask |= 1 << o.slot;
      }
      for (const m of v.minions) if (m.active && m.team !== b.team && segmentHitsCircle(b.x0, b.y0, b.x1, b.y1, 0.5 * b.width, m.x, m.y, m.r)) this.hitMinion(ctx, f, m, now);
    }
  }

  /* ---------------------------------------------------------------- end of a step: KOs and the verdict */

  /**
   * The end of a step: its KOs (every hit of the step counted first), then the verdict – one side left (after the grace for
   * projectiles in the air), none (a double KO) or the time cap: --- fl-overhaul --- measured from FIGHT!; with sudden death on,
   * up to FL_SUDDEN_MS of it in the shrinking arena first; then the side with the largest share of its HP wins (`capVerdict()`).
   */
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
      v.lastKoMs = now;
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
    if (!(cap > 0) || now - v.introMs < 1000 * cap) return;
    // --- fl-overhaul --- sudden death first (the arena shrinks; a KO still ends it), then the HP-fraction verdict
    if (v.settings.suddenDeath) {
      if (v.suddenMs < 0) {
        v.suddenMs = now;
        const field = v.field!;
        this.pushEvent(EV_SUDDEN, now, field.cx, field.cy, 0, -1, "#ef4444");
        this.urgentSound("ability", 130.81, 0.9);
        return;
      }
      if (now - v.suddenMs < FL_SUDDEN_MS) return;
    }
    const hp = this.capHp;
    const team = this.capTeam;
    const max = this.capMax;
    hp.length = team.length = max.length = v.fighters.length;
    for (let i = 0; i < v.fighters.length; i++) {
      const f = v.fighters[i];
      hp[i] = f.alive ? f.hp : 0;
      team[i] = f.team;
      max[i] = f.maxHp;
    }
    const winner = capVerdict(hp, team, v.teamCount, this.capSums, max);
    // The rig waits while its side trails (sudden death goes on); level, the chosen side takes it.
    if (this.rigChosen >= 0 && winner !== this.rigChosen) {
      const fr = this.rival;
      const mx = this.rivalMax;
      fr.fill(0);
      mx.fill(0);
      for (const f of v.fighters) {
        if (f.alive) fr[f.team] += f.hp;
        mx[f.team] += f.maxHp;
      }
      let best = -Infinity;
      for (let t = 0; t < v.teamCount; t++) if (t !== this.rigChosen && mx[t] > 0) best = Math.max(best, fr[t] / mx[t]);
      const mine = mx[this.rigChosen] > 0 ? fr[this.rigChosen] / mx[this.rigChosen] : 0;
      if (mine < best - 1e-9) return;
      this.finish(ctx, this.rigChosen, now, false, true);
      return;
    }
    this.finish(ctx, winner, now, false, true);
  }

  /** Whether a projectile of a side other than `team` is still in the air (it may still land on the last side standing). */
  private projectilesInAir(team: number): boolean {
    for (const p of this.view.projectiles) if (p.active && p.team !== team && p.ret !== 2) return true;
    return false;
  }

  /** The verdict: --- fl-overhaul --- every fighter stops where it is (the renderer animates the winner), so a frame's extra step changes nothing. */
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
    for (const f of v.fighters) {
      const ball = this.byIndex[f.slot];
      if (ball) {
        ball.vx = 0;
        ball.vy = 0;
      }
      f.vx = f.vy = 0;
      f.kept = true;
      f.telegraphUntil = -1;
    }
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
    field.half = field.fullHalf * v.shrink; // --- fl-overhaul --- (sudden death's shrink kept)
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
      f.castX = mapX(f.castX);
      f.castY = mapY(f.castY);
      f.telegraphArea *= k;
      f.baseR *= k; // --- fl-overhaul --- (Stage 2: a transform keeps its factor of the base radius)
      for (const w of f.weapons) {
        w.zapX = mapX(w.zapX);
        w.zapY = mapY(w.zapY);
        w.zap2X = mapX(w.zap2X);
        w.zap2Y = mapY(w.zap2Y);
      }
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
      // --- fl-overhaul --- (Stage 2) a bomb's arc and splash
      p.x0 = mapX(p.x0);
      p.y0 = mapY(p.y0);
      p.x1 = mapX(p.x1);
      p.y1 = mapY(p.y1);
      p.lift *= k;
      p.splash *= k;
    }
    // --- fl-overhaul --- (Stage 2) the walls, like the tasks (traps are minions: mapped below)
    for (const w of v.walls) {
      if (!w.active) continue;
      w.x1 = mapX(w.x1);
      w.y1 = mapY(w.y1);
      w.x2 = mapX(w.x2);
      w.y2 = mapY(w.y2);
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
  /** --- fl-overhaul --- A share of the damage (a clash won lands at half). */
  scale?: number;
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
