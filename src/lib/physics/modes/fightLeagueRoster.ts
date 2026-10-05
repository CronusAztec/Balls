/**
 * Fight League's roster (feature fight-league; the "Ball Fight League" family of clips – see the README's "Fight League"
 * section). A fighter is ONE DATA ROW: its id, name, division, source, palette, weapon(s), base stats, one ability and a
 * one-line description. The engineering lives in the mode (fightLeague.ts): the shared WEAPON KINDS (a simple vector
 * silhouette each, with its own hit geometry) and the ABILITY PRIMITIVES (each fighter's ability is one or two of them with
 * its own parameters). Adding a fighter is adding a row; adding a kind or a primitive is a case in the mode.
 *
 * The fighters are the most popular characters of video games, comics, TV shows and movies, grouped into DIVISIONS so a
 * matchup stays in its genre (Thor vs Loki, Captain Falcon vs Little Mac, Yuumi vs Katarina). Character, source and move
 * names are plain text labels in a fan-made simulation: no logos, costumes, faces, sprites, artwork or audio are copied –
 * every weapon is our own simple silhouette drawn in canvas paths and every colour is just a palette. Character names
 * belong to their respective owners; this is an unaffiliated fan simulation.
 *
 * --- fl-overhaul --- (Stage 2) The rows live in one file per division (`fightLeagueRows/<division>.ts`, at most 10 rows each,
 * every file headed by the avoid-list of what a look may never show); this module is the index: the types, the divisions and
 * their CONFERENCES, the kinds' defaults, the primitives' limits, the charge classes, the helpers, `FL_ROSTER` (the rows in
 * division order) and `FL_BY_ID`. 147 fighters in 19 divisions: the 61 of the first release (their ids unchanged; Pikachu and
 * Charizard moved to Pokémon, Steve to Sandbox & online games) and 86 new ones (`isNew`). Every row has a ROLE (tank,
 * bruiser, duelist, glass, ranged, control, summoner, support – tanks and glass cannons follow the role templates the tests
 * check), a SHORT name for tight labels (≤ 10 characters), and a LOOK (a body pattern and a crest – data only, drawn by the
 * renderer; the name identifies, the look only adds flavour).
 *
 * Units used by the rows: lengths in ball radii (R), times in seconds, projectile speeds in arena sides per second, spreads
 * in degrees, damage in hit points (every fighter starts with the HP setting, 100 by default, × `stats.hp` / 100). The
 * stats are multipliers (1 = the league average); a weapon field left out takes the kind's default (`FL_WEAPON_DEFAULTS`).
 */

import { FL_ROWS_MARVEL } from "./fightLeagueRows/marvel";
import { FL_ROWS_DC } from "./fightLeagueRows/dc";
import { FL_ROWS_NINTENDO } from "./fightLeagueRows/nintendo";
import { FL_ROWS_LEAGUE } from "./fightLeagueRows/league";
import { FL_ROWS_FIGHTING } from "./fightLeagueRows/fighting";
import { FL_ROWS_LEGENDS } from "./fightLeagueRows/legends";
import { FL_ROWS_SHONEN } from "./fightLeagueRows/shonen";
import { FL_ROWS_STAR_WARS } from "./fightLeagueRows/starWars";
import { FL_ROWS_FANTASY } from "./fightLeagueRows/fantasy";
import { FL_ROWS_MONSTERS } from "./fightLeagueRows/monsters";
import { FL_ROWS_ACTION } from "./fightLeagueRows/action";
import { FL_ROWS_TV } from "./fightLeagueRows/tv";
import { FL_ROWS_POKEMON } from "./fightLeagueRows/pokemon";
import { FL_ROWS_MODERN_ANIME } from "./fightLeagueRows/modernAnime";
import { FL_ROWS_SANDBOX } from "./fightLeagueRows/sandbox";
import { FL_ROWS_HORROR } from "./fightLeagueRows/horror";
import { FL_ROWS_ANIMATED } from "./fightLeagueRows/animated";
import { FL_ROWS_CARTOONS } from "./fightLeagueRows/cartoons";
import { FL_ROWS_WILDCARD } from "./fightLeagueRows/wildcard";

/* ------------------------------------------------------------------ divisions */

/** The divisions in roster order: the 13 of the first release (Wildcard last), the six of the overhaul before Wildcard. */
export const FL_DIVISIONS = ["marvel", "dc", "nintendo", "league", "fighting", "legends", "shonen", "starWars", "fantasy", "monsters", "action", "tv", "pokemon", "modernAnime", "sandbox", "horror", "animated", "cartoons", "wildcard"] as const;
export type FlDivision = (typeof FL_DIVISIONS)[number];

export function isFlDivision(value: unknown): value is FlDivision {
  return typeof value === "string" && (FL_DIVISIONS as readonly string[]).includes(value);
}

/** English division labels (the README, tests and tools; the panel translates them: `FightLeague.division_<id>`). */
export const FL_DIVISION_LABELS: Readonly<Record<FlDivision, string>> = {
  marvel: "Marvel",
  dc: "DC",
  nintendo: "Nintendo & Sega",
  league: "League of Legends",
  fighting: "Fighting games",
  legends: "Game legends",
  shonen: "Shonen anime",
  starWars: "Star Wars",
  fantasy: "Fantasy",
  monsters: "Movie monsters",
  action: "Action movies",
  tv: "TV",
  pokemon: "Pokémon",
  modernAnime: "Modern anime",
  sandbox: "Sandbox & online games",
  horror: "Horror movies",
  animated: "Animated movies",
  cartoons: "Cartoons",
  wildcard: "Wildcard",
};

/* ------------------------------------------------------------------ --- fl-overhaul --- conferences */

/**
 * The CONFERENCES: genres of divisions (a random slot may stay in one; brackets draw from one). Wildcard is in none. The TV
 * shows' conference is `shows` (TV shows and cartoons): its id must differ from the TV division's, so a random token
 * (`random:<division>` / `random:<conference>`) always names one pool.
 */
export const FL_CONFERENCES = {
  comics: ["marvel", "dc"],
  games: ["nintendo", "league", "fighting", "legends", "pokemon", "sandbox"],
  anime: ["shonen", "modernAnime"],
  movies: ["starWars", "fantasy", "monsters", "action", "horror", "animated"],
  shows: ["tv", "cartoons"],
} as const satisfies Record<string, readonly FlDivision[]>;
export type FlConference = keyof typeof FL_CONFERENCES;
export const FL_CONFERENCE_IDS = Object.keys(FL_CONFERENCES) as FlConference[];

export function isFlConference(value: unknown): value is FlConference {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FL_CONFERENCES, value);
}

/** English conference labels (the panel translates them: `FightLeague.conference_<id>`). */
export const FL_CONFERENCE_LABELS: Readonly<Record<FlConference, string>> = {
  comics: "Comics",
  games: "Video games",
  anime: "Anime",
  movies: "Movies",
  shows: "TV & cartoons",
};

/** The conference of `division` (null: Wildcard). */
export function conferenceOf(division: FlDivision): FlConference | null {
  for (const c of FL_CONFERENCE_IDS) if ((FL_CONFERENCES[c] as readonly FlDivision[]).includes(division)) return c;
  return null;
}

/* ------------------------------------------------------------------ weapons */

export const FL_WEAPON_KINDS = ["sword", "hammer", "fists", "claws", "chain", "bow", "gun", "shotgun", "wand", "staff", "book", "cards", "fire", "beam", "spark", "web", "ice", "shield", "tail", "whip", "bomb"] as const;
export type FlWeaponKind = (typeof FL_WEAPON_KINDS)[number];

/**
 * Mechanical variants of a kind: sword `glow` (a lightsaber), `double` (a blade at both ends); hammer `returning` (thrown at
 * the nearest foe and flying back); chain `pull` (a thrown head that drags the hit foe to its owner); gun `burst` (three per
 * trigger), `bouncing` (bullets bounce off a wall once); cards `blink` (the owner blinks to a thrown blade); staff `return`
 * (orbs fly out and come back); shield `block` (the bracelets: blocks only, never thrown); fists `contact` (hits on body
 * contact); --- fl-overhaul --- whip `lasso` (the crack snags the foe and drags it in); bomb `fuse` (the bomb lies 0.5 s on a
 * sparking fuse before it bursts).
 */
export const FL_WEAPON_STYLES = ["plain", "glow", "double", "returning", "pull", "burst", "bouncing", "blink", "return", "block", "contact", "lasso", "fuse"] as const;
export type FlWeaponStyle = (typeof FL_WEAPON_STYLES)[number];

/** How a projectile, an orbiting blade or a thrown weapon is drawn (visual only). */
export const FL_SHAPES = [
  "arrow",
  "bullet",
  "repulsor",
  "fireball",
  "plasma",
  "charge",
  "ki",
  "hadouken",
  "flamewave",
  "rocket",
  "bolt",
  "orb",
  "page",
  "dagger",
  "batarang",
  "card",
  "shuriken",
  "web",
  "ice",
  "icespear",
  "hammer",
  "shield",
  "spear",
  "saber",
  "pellet",
  "blades",
  "kicks",
  "flames",
  "air",
  "wolf",
  "wight",
  "clone",
  // --- fl-overhaul --- (Stage 2: the new kinds' and primitives' shapes, generic names; the renderer draws a fallback until its own silhouettes land)
  "lash",
  "lasso",
  "flask",
  "grenade",
  "dynamite",
  "pan",
  "mallet",
  "balloon",
  "bubble",
  "boulder",
  "cannonball",
  "car",
  "spearbolt",
  "megaorb",
  "aura",
  "portal",
  "jaws",
  "windwall",
  "brickwall",
  "shark",
  "hyena",
  "jellyfish",
  "ghost",
  "horse",
] as const;
export type FlShape = (typeof FL_SHAPES)[number];

/** --- fl-overhaul --- Summon silhouettes (a minion that fights: the renderer draws a body, not a projectile). */
export const FL_SUMMON_SHAPES: readonly FlShape[] = ["wolf", "wight", "clone", "shark", "hyena", "jellyfish", "ghost", "horse"];

/**
 * --- fl-overhaul --- The look of a weapon within its kind (visual only, drawn by the renderer): a sword's blade, a hammer's
 * head, a gun's body.
 */
export const FL_SWORD_LOOKS = ["blade", "saber", "double", "katana", "greatsword", "chainsaw", "trident", "rapier"] as const;
export const FL_HAMMER_LOOKS = ["block", "pan", "mallet"] as const;
export const FL_GUN_LOOKS = ["pistol", "rifle", "minigun", "cannon", "launcher", "blaster", "portal"] as const;
export type FlWeaponLook = (typeof FL_SWORD_LOOKS)[number] | (typeof FL_HAMMER_LOOKS)[number] | (typeof FL_GUN_LOOKS)[number];
/** The looks a kind may take (none: the kind has one look). */
export const FL_WEAPON_LOOKS: Readonly<Partial<Record<FlWeaponKind, readonly FlWeaponLook[]>>> = { sword: FL_SWORD_LOOKS, hammer: FL_HAMMER_LOOKS, gun: FL_GUN_LOOKS };

export interface FlWeaponSpec {
  kind: FlWeaponKind;
  style?: FlWeaponStyle;
  /**
   * Reach in ball radii: a sword's blade, a hammer's handle, a chain's length, a tail's length, a fist's extension, a fire
   * cone's range, a spark's range from the body's surface, a whip's lash; a returning orb's range (arena sides).
   */
  reach?: number;
  /**
   * Seconds between two attacks at attack speed 1: a sword's sweep, a hammer's or a chain's orbit, a tail's swing, a
   * punch, a shot, a card throw, a breath, a beam, a whip's crack, a bomb's lob.
   */
  cooldown?: number;
  /** Seconds between two throws (a returning hammer, a pull chain's head, a thrown shield). */
  throwEvery?: number;
  /** Hit points a hit takes (before the fighter's damage stat). */
  damage?: number;
  /** Knockback of a hit, in cruising speeds. */
  knockback?: number;
  /** Projectile speed, arena sides per second. */
  speed?: number;
  /** Projectiles per trigger (pellets, a burst) or blades orbiting (cards). */
  count?: number;
  /** Spread of the shots (degrees): a cone's full angle for fire and shotguns. */
  spread?: number;
  /** Homing turn rate of the projectiles (radians per second). */
  homing?: number;
  /** Projectile / head / fist size in ball radii (a whip's tip). */
  size?: number;
  /** Colour of the blade, the projectile or the glow (the fighter's accent when left out). */
  color?: string;
  /** How the projectile is drawn (the kind's own shape when left out). */
  shape?: FlShape;
  /** web: the hit foe's speed factor; ice: seconds the hit foe stays frozen; --- fl-overhaul --- bomb: the splash radius (R). */
  effect?: number;
  /** web: seconds the slow lasts. */
  effectSec?: number;
  /** --- fl-overhaul --- The weapon's look within its kind (`FL_WEAPON_LOOKS`; visual only). */
  look?: FlWeaponLook;
}

/** The kinds' defaults: every field a row leaves out. */
export const FL_WEAPON_DEFAULTS: Readonly<Record<FlWeaponKind, Required<Omit<FlWeaponSpec, "kind" | "color" | "shape" | "look">> & { shape: FlShape }>> = {
  sword: { style: "plain", reach: 1.9, cooldown: 0.36, throwEvery: 0, damage: 7, knockback: 0.7, speed: 0, count: 1, spread: 0, homing: 0, size: 0.2, shape: "saber", effect: 0, effectSec: 0 },
  hammer: { style: "plain", reach: 1.4, cooldown: 1.7, throwEvery: 3.2, damage: 12, knockback: 1.7, speed: 0.95, count: 1, spread: 0, homing: 0, size: 0.55, shape: "hammer", effect: 0, effectSec: 0 },
  fists: { style: "plain", reach: 0.9, cooldown: 0.55, throwEvery: 0, damage: 6, knockback: 0.8, speed: 0, count: 2, spread: 0, homing: 0, size: 0.36, shape: "air", effect: 0, effectSec: 0 },
  claws: { style: "plain", reach: 0.55, cooldown: 0.24, throwEvery: 0, damage: 2.6, knockback: 0.25, speed: 0, count: 3, spread: 0, homing: 0, size: 0.42, shape: "blades", effect: 0, effectSec: 0 },
  chain: { style: "plain", reach: 2.2, cooldown: 1.25, throwEvery: 2.4, damage: 8, knockback: 0.9, speed: 1.1, count: 1, spread: 0, homing: 0, size: 0.42, shape: "spear", effect: 0, effectSec: 0 },
  bow: { style: "plain", reach: 0, cooldown: 1.1, throwEvery: 0, damage: 7, knockback: 0.4, speed: 1.3, count: 1, spread: 3, homing: 0, size: 0.16, shape: "arrow", effect: 0, effectSec: 0 },
  gun: { style: "plain", reach: 0, cooldown: 0.9, throwEvery: 0, damage: 5, knockback: 0.3, speed: 1.55, count: 1, spread: 5, homing: 0, size: 0.14, shape: "bullet", effect: 0, effectSec: 0 },
  shotgun: { style: "plain", reach: 0.55, cooldown: 1.6, throwEvery: 0, damage: 2.6, knockback: 0.25, speed: 1.4, count: 6, spread: 34, homing: 0, size: 0.12, shape: "pellet", effect: 0, effectSec: 0 },
  wand: { style: "plain", reach: 0, cooldown: 1.0, throwEvery: 0, damage: 5, knockback: 0.3, speed: 1.9, count: 1, spread: 2, homing: 0, size: 0.15, shape: "bolt", effect: 0, effectSec: 0 },
  staff: { style: "plain", reach: 0.5, cooldown: 2.2, throwEvery: 0, damage: 8, knockback: 0.5, speed: 0.85, count: 1, spread: 0, homing: 2.2, size: 0.42, shape: "orb", effect: 0, effectSec: 0 },
  book: { style: "plain", reach: 0, cooldown: 1.6, throwEvery: 0, damage: 6, knockback: 0.35, speed: 0.9, count: 1, spread: 0, homing: 2.4, size: 0.3, shape: "page", effect: 0, effectSec: 0 },
  cards: { style: "plain", reach: 1.9, cooldown: 0.9, throwEvery: 0, damage: 5, knockback: 0.3, speed: 1.35, count: 4, spread: 2, homing: 0, size: 0.22, shape: "card", effect: 0, effectSec: 0 },
  fire: { style: "plain", reach: 3.1, cooldown: 1.6, throwEvery: 0, damage: 3, knockback: 0.15, speed: 0, count: 1, spread: 50, homing: 0, size: 0, shape: "flames", effect: 0, effectSec: 0 },
  beam: { style: "plain", reach: 0, cooldown: 2.2, throwEvery: 0, damage: 9, knockback: 0.4, speed: 0, count: 1, spread: 0, homing: 0, size: 0.14, shape: "bolt", effect: 0, effectSec: 0 },
  spark: { style: "plain", reach: 2.6, cooldown: 0.8, throwEvery: 0, damage: 5, knockback: 0.2, speed: 0, count: 1, spread: 0, homing: 0, size: 0, shape: "bolt", effect: 0, effectSec: 0 },
  web: { style: "plain", reach: 0, cooldown: 1.3, throwEvery: 0, damage: 4, knockback: 0.1, speed: 1.15, count: 1, spread: 2, homing: 0, size: 0.24, shape: "web", effect: 0.6, effectSec: 1.5 },
  ice: { style: "plain", reach: 0, cooldown: 1.8, throwEvery: 0, damage: 6, knockback: 0.1, speed: 1.0, count: 1, spread: 2, homing: 0, size: 0.24, shape: "ice", effect: 1, effectSec: 0 },
  shield: { style: "plain", reach: 0, cooldown: 0, throwEvery: 2.2, damage: 8, knockback: 0.9, speed: 1.2, count: 1, spread: 0, homing: 0, size: 0.7, shape: "shield", effect: 0, effectSec: 0 },
  tail: { style: "plain", reach: 2.3, cooldown: 0.85, throwEvery: 0, damage: 7, knockback: 1.0, speed: 0, count: 1, spread: 0, homing: 0, size: 0.22, shape: "blades", effect: 0, effectSec: 0 },
  // --- fl-overhaul --- a lash cracking at a foe in reach (its tip `size` R); a lobbed bomb bursting where it lands (`effect`: the splash, R)
  whip: { style: "plain", reach: 2.7, cooldown: 0.9, throwEvery: 0, damage: 7, knockback: 0.6, speed: 0, count: 1, spread: 0, homing: 0, size: 0.3, shape: "lash", effect: 0, effectSec: 0 },
  bomb: { style: "plain", reach: 0, cooldown: 2.2, throwEvery: 0, damage: 10, knockback: 1.0, speed: 0, count: 1, spread: 0, homing: 0, size: 0.3, shape: "flask", effect: 1.3, effectSec: 0 },
};

/* ------------------------------------------------------------------ abilities */

/**
 * The ability primitives (`p`), each with its own parameters – lengths in ball radii, times in seconds, damage in hit
 * points, speeds in arena sides per second:
 *
 * - speedBurst / damageBurst / attackSpeedBurst: the owner's stat × `mult` for `dur` (a damage burst may add knockback);
 * - invulnerable: no damage for `dur` (`contact`: touching a foe deals that much; `untargetable`: foes cannot aim at it);
 * - freezeAll: every foe frozen for `dur`;
 * - choke: the nearest foe held for `dur`, `damage` at the start, over the hold or at its end (a slam);
 * - arenaCuts: `n` cuts across the arena through the foes, `damage` each;
 * - beam: a wide ray (`width`) along the owner's facing for `dur`, `damage` a tick;
 * - volley: `n` projectiles at the nearest foe (homing, returning, bouncing between foes, exploding, unblockable; --- fl-overhaul
 *   --- with its own knockback, or piercing every foe on its way);
 * - shockwave: radial damage and knockback within `radius` (after a fuse: `delay`; `pin`: foes pinned to the far wall);
 * - pull: the nearest foe (or every foe) dragged to the owner;
 * - decoys: `n` copies that absorb hits for `dur` (`freezeOnTouch`: a foe touching one is frozen that long);
 * - heal: `amount` hit points back over `dur`;
 * - fireRing: damage over time (`damage` a tick) within `radius` for `dur`;
 * - giantHit: the next hit (or the next `count`) × `mult` (`belowHalf`: that multiplier on a foe under half its HP;
 *   `halfMaxHp`: worth half of the foe's maximum HP; `homing`: the shots home in; `freeze`: the hit foe frozen that long);
 * - lightning: a bolt on every foe;
 * - confuse: foes slowed with reversed aim for `dur`;
 * - blinkStrike: `n` teleports to the nearest foe, each a hit;
 * - summon: `n` small allied balls for `dur`, `damage` on contact (--- fl-overhaul --- `speed`: × the summons' speed);
 * - reflect: attackers take `frac` of their damage back for `dur` (--- fl-overhaul --- `deflect`: enemy projectiles touching
 *   the owner fly back at their shooter, `frac` of their damage);
 * - disarm: the nearest foe's weapon deals no damage for `dur`;
 * - slowTime: every foe and its projectiles at `factor` speed for `dur` while the owner's side keeps full speed;
 * - --- fl-overhaul --- trap: `n` traps dropped along the owner's way (armed after 0.5 s, at most 4 an owner, `dur` each):
 *   the first foe to touch one takes `damage` and is held `hold`; any enemy hit pops one;
 * - wall: a barrier `length` R long, 2 R in front of the owner across the line to the nearest foe, for `dur`: enemy
 *   projectiles and beams stop at it (`solid`: foes bounce off it too);
 * - transform: for `dur` the owner's size, damage, speed (and attack speed) × the factors – its HP unchanged;
 * - drain: for `dur` the owner heals `frac` of the damage it deals.
 */
export const FL_ABILITY_PRIMITIVES = [
  "speedBurst",
  "damageBurst",
  "attackSpeedBurst",
  "invulnerable",
  "freezeAll",
  "choke",
  "arenaCuts",
  "beam",
  "volley",
  "shockwave",
  "pull",
  "decoys",
  "heal",
  "fireRing",
  "giantHit",
  "lightning",
  "confuse",
  "blinkStrike",
  "summon",
  "reflect",
  "disarm",
  "slowTime",
  // --- fl-overhaul ---
  "trap",
  "wall",
  "transform",
  "drain",
] as const;
export type FlPrimitive = (typeof FL_ABILITY_PRIMITIVES)[number];

export type FlEffect =
  | { p: "speedBurst"; mult: number; dur: number }
  | { p: "damageBurst"; mult: number; dur: number; knockback?: number }
  | { p: "attackSpeedBurst"; mult: number; dur: number }
  | { p: "invulnerable"; dur: number; contact?: number; untargetable?: boolean }
  | { p: "freezeAll"; dur: number }
  | { p: "choke"; dur: number; damage: number; at?: "start" | "over" | "end" }
  | { p: "arenaCuts"; n: number; damage: number }
  | { p: "beam"; dur: number; width: number; damage: number; color?: string }
  | { p: "volley"; n: number; damage: number; speed?: number; spread?: number; size?: number; homing?: number; shape?: FlShape; color?: string; returning?: boolean; bounceFoes?: boolean; explode?: number; unblockable?: boolean; knockback?: number; pierce?: boolean }
  | { p: "shockwave"; radius: number; damage: number; knockback: number; delay?: number; pin?: boolean; spin?: boolean }
  | { p: "pull"; strength: number; all?: boolean }
  | { p: "decoys"; n: number; dur: number; freezeOnTouch?: number }
  | { p: "heal"; amount: number; dur: number }
  | { p: "fireRing"; radius: number; damage: number; dur: number; shape?: FlShape }
  | { p: "giantHit"; mult: number; count?: number; knockback?: number; freeze?: number; belowHalf?: number; halfMaxHp?: boolean; maxHpFrac?: number; homing?: number }
  | { p: "lightning"; damage: number }
  | { p: "confuse"; dur: number }
  | { p: "blinkStrike"; n: number; damage: number; interval?: number }
  | { p: "summon"; n: number; dur: number; damage: number; size?: number; shape?: FlShape; speed?: number }
  | { p: "reflect"; dur: number; frac: number; deflect?: boolean }
  | { p: "disarm"; dur: number }
  | { p: "slowTime"; dur: number; factor: number }
  // --- fl-overhaul ---
  | { p: "trap"; n: number; damage: number; hold: number; dur?: number; shape?: FlShape }
  | { p: "wall"; dur: number; length?: number; solid?: boolean; shape?: FlShape }
  | { p: "transform"; size: number; damage: number; speed: number; attackSpeed?: number; dur: number }
  | { p: "drain"; frac: number; dur: number };

export interface FlAbility {
  /** The ability's name (an English proper name, shown in its box). */
  name: string;
  /** Seconds the meter takes to fill at cast speed 1 without hits (its class's range: `FL_CHARGE_RANGE`). */
  charge: number;
  /** One or two primitives, fired together when the telegraph ends. */
  effects: readonly FlEffect[];
  /** --- fl-overhaul --- A fight-ender: the ultimate charge class (13–14 s) and telegraph (0.85 s). */
  ultimate?: boolean;
}

/**
 * --- fl-overhaul --- The primitives' limits (data; tested on every row's every effect): `max` / `min` of a field. A freeze of
 * every foe at most 2 s, a transform at most 6 s, a drain at most 70 %, a reflection at most 60 % for at most 4 s, a heal at
 * most 40, a hold at most 2.5 s, slow time at most 3 s and never under 0.25, a confusion and a disarm at most 3 s, at most 4
 * traps holding at most 1.2 s, invulnerability at most 3 s, at most 3 decoys, at most 3 summons for at most 5 s.
 */
export const FL_PRIMITIVE_LIMITS: Readonly<Partial<Record<FlPrimitive, Readonly<Record<string, { max?: number; min?: number }>>>>> = {
  freezeAll: { dur: { max: 2 } },
  transform: { dur: { max: 6 } },
  drain: { frac: { max: 0.7 } },
  reflect: { frac: { max: 0.6 }, dur: { max: 4 } },
  heal: { amount: { max: 40 } },
  choke: { dur: { max: 2.5 } },
  slowTime: { dur: { max: 3 }, factor: { min: 0.25 } },
  confuse: { dur: { max: 3 } },
  disarm: { dur: { max: 3 } },
  trap: { hold: { max: 1.2 }, n: { max: 4 } },
  invulnerable: { dur: { max: 3 } },
  decoys: { n: { max: 3 } },
  summon: { n: { max: 3 }, dur: { max: 5 } },
};

/** --- fl-overhaul --- The limits `effect` breaks (`["freezeAll.dur > 2"]`; empty: within every one). */
export function flLimitViolations(effect: FlEffect): string[] {
  const limits = FL_PRIMITIVE_LIMITS[effect.p];
  const out: string[] = [];
  if (!limits) return out;
  const values = effect as unknown as Record<string, unknown>;
  for (const [field, bound] of Object.entries(limits)) {
    const v = values[field];
    if (typeof v !== "number") continue;
    if (bound.max !== undefined && v > bound.max + 1e-9) out.push(`${effect.p}.${field} > ${bound.max}`);
    if (bound.min !== undefined && v < bound.min - 1e-9) out.push(`${effect.p}.${field} < ${bound.min}`);
  }
  return out;
}

/** --- fl-overhaul --- The charge classes: an ultimate (its own flag), an area or freeze ability, every other one. */
export type FlAbilityClass = "ultimate" | "area" | "standard";
/** The charge (s at cast speed 1) a class allows: [min, max]. */
export const FL_CHARGE_RANGE: Readonly<Record<FlAbilityClass, readonly [number, number]>> = { ultimate: [13, 14], area: [11, 12], standard: [8, 10] };

/**
 * --- fl-overhaul --- The charge class of an ability: `ultimate` by its flag; `area` with a freeze of every foe, slow time,
 * arena cuts, lightning, a shockwave of 4.5 R or more, a fire ring of 3.5 R or more, a volley of 8 or more or a beam 1.2 R
 * wide or more; else `standard`.
 */
export function abilityClass(ability: Pick<FlAbility, "ultimate" | "effects">): FlAbilityClass {
  if (ability.ultimate) return "ultimate";
  for (const e of ability.effects) {
    switch (e.p) {
      case "freezeAll":
      case "slowTime":
      case "arenaCuts":
      case "lightning":
        return "area";
      case "shockwave":
        if (e.radius >= 4.5) return "area";
        break;
      case "fireRing":
        if (e.radius >= 3.5) return "area";
        break;
      case "volley":
        if (e.n >= 8) return "area";
        break;
      case "beam":
        if (e.width >= 1.2) return "area";
        break;
      default:
        break;
    }
  }
  return "standard";
}

/* ------------------------------------------------------------------ rows */

export interface FlStats {
  /** Maximum HP in percent of the HP setting (100 = the league's HP). */
  hp: number;
  /** Cruising speed (× the league's). */
  speed: number;
  /** Attack speed: every weapon cooldown ÷ it. */
  attackSpeed: number;
  /** Damage of every hit (× it). */
  damage: number;
  /** Cast speed: the ability meter fills × it faster. */
  castSpeed: number;
  /** Ball size (× the league's ball radius). */
  size: number;
}

/**
 * --- fl-overhaul --- A fighter's role: what it does in a fight (the picker's chip). Tanks (HP 115–130, speed 0.7–0.85, size
 * 1.1–1.3) and glass cannons (HP 90–95, speed 1.3–1.8, size 0.7–0.9) follow their templates; at most two of each a division.
 */
export const FL_ROLES = ["tank", "bruiser", "duelist", "glass", "ranged", "control", "summoner", "support"] as const;
export type FlRole = (typeof FL_ROLES)[number];

/** --- fl-overhaul --- A body's look (visual only): its pattern and its crest (our own shapes – no emblem, letter or face). */
export const FL_LOOK_PATTERNS = ["ring", "band", "split", "visor", "hood", "core", "dots", "stripes"] as const;
export const FL_LOOK_CRESTS = ["none", "ears", "horns", "spikes", "fins", "halo", "points", "tuft"] as const;
export interface FlLook {
  pattern: (typeof FL_LOOK_PATTERNS)[number];
  crest: (typeof FL_LOOK_CRESTS)[number];
  /** A glow around the body (a colour). */
  glow?: string;
  /** The knockback trail's colour. */
  trail?: string;
}

export interface FlFighterRow {
  id: string;
  name: string;
  division: FlDivision;
  /** Where the character comes from (an English label, kept as a proper name). */
  source: string;
  /** Body colour of the ball and its accent (the weapon trim, the HUD box). */
  body: string;
  accent: string;
  /** One weapon, or two kinds combined (fists + gun). */
  weapons: readonly FlWeaponSpec[];
  stats: FlStats;
  ability: FlAbility;
  /** One line about the fighter (English; the panel shows `FightLeague.fighter_<id>` in every language). */
  description: string;
  /** --- fl-overhaul --- The gap to its target (in its radii) it keeps instead of its first weapon's band (`intentBand()`). */
  intent?: { lo: number; hi: number };
  // --- fl-overhaul --- (Stage 2)
  /** A short name for tight labels (≤ 10 characters; the name itself when it fits – `flShortName()`). */
  short?: string;
  role: FlRole;
  /** New in the overhaul's roster (false: one of the first release's 61). */
  isNew: boolean;
  /** The body's look (visual only). */
  look?: FlLook;
}

/** The roster: every division's rows (fightLeagueRows/<division>.ts), in `FL_DIVISIONS` order. */
const ROWS_BY_DIVISION: Readonly<Record<FlDivision, readonly FlFighterRow[]>> = {
  marvel: FL_ROWS_MARVEL,
  dc: FL_ROWS_DC,
  nintendo: FL_ROWS_NINTENDO,
  league: FL_ROWS_LEAGUE,
  fighting: FL_ROWS_FIGHTING,
  legends: FL_ROWS_LEGENDS,
  shonen: FL_ROWS_SHONEN,
  starWars: FL_ROWS_STAR_WARS,
  fantasy: FL_ROWS_FANTASY,
  monsters: FL_ROWS_MONSTERS,
  action: FL_ROWS_ACTION,
  tv: FL_ROWS_TV,
  pokemon: FL_ROWS_POKEMON,
  modernAnime: FL_ROWS_MODERN_ANIME,
  sandbox: FL_ROWS_SANDBOX,
  horror: FL_ROWS_HORROR,
  animated: FL_ROWS_ANIMATED,
  cartoons: FL_ROWS_CARTOONS,
  wildcard: FL_ROWS_WILDCARD,
};

/**
 * Every fighter, division by division (the panel's pickers group them the same way). Tuned so that within its division no
 * fighter wins more than 75 % or fewer than 25 % of a round robin (tests/fightLeague.test.ts prints the tables; the damage
 * stat is the tuner's – scripts/fl-balance.mjs).
 */
export const FL_ROSTER: readonly FlFighterRow[] = FL_DIVISIONS.flatMap((division) => ROWS_BY_DIVISION[division]);

/** The roster by id. */
export const FL_BY_ID: ReadonlyMap<string, FlFighterRow> = new Map(FL_ROSTER.map((row) => [row.id, row]));

/** Whether `id` names a fighter of the roster. */
export function isFlFighterId(value: unknown): value is string {
  return typeof value === "string" && FL_BY_ID.has(value);
}

/** The fighters of `division`, in roster order. */
export function fightersOf(division: FlDivision): FlFighterRow[] {
  return FL_ROSTER.filter((row) => row.division === division);
}

/** --- fl-overhaul --- The fighters of a conference's divisions, in roster order. */
export function fightersOfConference(conference: FlConference): FlFighterRow[] {
  const divisions = FL_CONFERENCES[conference] as readonly FlDivision[];
  return FL_ROSTER.filter((row) => divisions.includes(row.division));
}

/** --- fl-overhaul --- The short name of a fighter for tight labels (upper case, ≤ 10 characters): its `short`, else its name. */
export function flShortName(row: Pick<FlFighterRow, "name" | "short">): string {
  return (row.short ?? row.name).toUpperCase();
}

/** The weapon spec with every default filled in. */
export function weaponOf(spec: FlWeaponSpec): Required<Omit<FlWeaponSpec, "color" | "look">> & { color: string | undefined; look: FlWeaponLook | undefined } {
  const d = FL_WEAPON_DEFAULTS[spec.kind];
  return {
    kind: spec.kind,
    style: spec.style ?? d.style,
    reach: spec.reach ?? d.reach,
    cooldown: spec.cooldown ?? d.cooldown,
    throwEvery: spec.throwEvery ?? d.throwEvery,
    damage: spec.damage ?? d.damage,
    knockback: spec.knockback ?? d.knockback,
    speed: spec.speed ?? d.speed,
    count: spec.count ?? d.count,
    spread: spec.spread ?? d.spread,
    homing: spec.homing ?? d.homing,
    size: spec.size ?? d.size,
    color: spec.color,
    shape: spec.shape ?? d.shape,
    effect: spec.effect ?? d.effect,
    effectSec: spec.effectSec ?? d.effectSec,
    look: spec.look,
  };
}

/** A short English label of a fighter's weapon(s), for the README table, tools and tests ("returning hammer", "fists + gun"). */
export function weaponLabel(row: FlFighterRow): string {
  return row.weapons
    .map((w) => {
      const style = w.style && w.style !== "plain" ? `${w.style} ` : "";
      return `${style}${w.kind}`;
    })
    .join(" + ");
}

/** --- fl-overhaul --- The presets' formats: a duel (1v1), a team fight (2v2), a free-for-all (more come with the match types). */
export type FlPresetFormat = "duel" | "team" | "ffa";

/** The matchup presets of the panel (every pair in its genre); `fighters` fill the slots A–D, `match` the match type. */
export interface FlPreset {
  id: string;
  /** English label (fighter names are proper names; the panel shows it as is). */
  label: string;
  fighters: readonly string[];
  match: "1v1" | "2v2" | "ffa3" | "ffa4";
  /** --- fl-overhaul --- The format (the gallery's grouping). */
  format: FlPresetFormat;
  /** --- fl-overhaul --- An optional hook line for a clip (English; the creator tools read it). */
  hook?: string;
}

const duel = (id: string, label: string, a: string, b: string): FlPreset => ({ id, label, fighters: [a, b], match: "1v1", format: "duel" });
const team = (id: string, label: string, fighters: readonly string[]): FlPreset => ({ id, label, fighters, match: "2v2", format: "team" });
const ffa = (id: string, label: string, fighters: readonly string[]): FlPreset => ({ id, label, fighters, match: fighters.length === 3 ? "ffa3" : "ffa4", format: "ffa" });

/** The 50 in-division presets (the first 14 of the first release, ids unchanged; Thor vs Loki the default). */
export const FL_PRESETS: readonly FlPreset[] = [
  duel("thor-loki", "Thor vs Loki", "thor", "loki"),
  duel("falcon-mac", "Captain Falcon vs Little Mac", "captainfalcon", "littlemac"),
  duel("yuumi-katarina", "Yuumi vs Katarina", "yuumi", "katarina"),
  duel("batman-joker", "Batman vs Joker", "batman", "joker"),
  duel("goku-vegeta", "Goku vs Vegeta", "goku", "vegeta"),
  duel("luke-vader", "Luke Skywalker vs Darth Vader", "luke", "vader"),
  duel("mario-sonic", "Mario vs Sonic", "mario", "sonic"),
  duel("harry-voldemort", "Harry Potter vs Voldemort", "harrypotter", "voldemort"),
  duel("scorpion-subzero", "Scorpion vs Sub-Zero", "scorpion", "subzero"),
  duel("godzilla-kong", "Godzilla vs King Kong", "godzilla", "kingkong"),
  duel("alien-predator", "Alien vs Predator", "alien", "predator"),
  duel("homelander-omniman", "Homelander vs Omni-Man", "homelander", "omniman"),
  ffa("avengers", "Avengers free-for-all", ["thor", "ironman", "captainamerica", "hulk"]),
  team("naruto-dbz", "2v2: Naruto + Sasuke vs Goku + Vegeta", ["naruto", "sasuke", "goku", "vegeta"]),
  // --- fl-overhaul --- (Stage 2: the research's 36 more, every one inside one division)
  duel("ryu-ken", "Ryu vs Ken", "ryu", "ken"),
  duel("naruto-sasuke", "Naruto vs Sasuke", "naruto", "sasuke"),
  duel("goku-frieza", "Goku vs Frieza", "goku", "frieza"),
  duel("pikachu-charizard", "Pikachu vs Charizard", "pikachu", "charizard"),
  duel("chief-slayer", "Master Chief vs Doom Slayer", "masterchief", "doomslayer"),
  duel("thor-hulk", "Thor vs Hulk", "thor", "hulk"),
  duel("spiderman-venom", "Spider-Man vs Venom", "spiderman", "venom"),
  duel("deadpool-wolverine", "Deadpool vs Wolverine", "deadpool", "wolverine"),
  duel("kratos-zeus", "Kratos vs Zeus", "kratos", "zeus"),
  ffa("justice-league", "Justice League free-for-all", ["superman", "batman", "wonderwoman", "flash"]),
  duel("batman-superman", "Batman vs Superman", "batman", "superman"),
  team("strawhats-team7", "Straw Hats vs Team 7: Luffy + Zoro vs Naruto + Sasuke", ["luffy", "zoro", "naruto", "sasuke"]),
  duel("gojo-sukuna", "Gojo vs Sukuna", "gojo", "sukuna"),
  duel("deku-bakugo", "Deku vs Bakugo", "deku", "bakugo"),
  duel("eren-levi", "Eren vs Levi", "eren", "levi"),
  duel("mario-bowser", "Mario vs Bowser", "mario", "bowser"),
  duel("sonic-shadow", "Sonic vs Shadow", "sonic", "shadow"),
  duel("cloud-sephiroth", "Cloud Strife vs Sephiroth", "cloud", "sephiroth"),
  duel("kazuya-akuma", "Kazuya vs Akuma", "kazuya", "akuma"),
  duel("obiwan-vader", "Obi-Wan Kenobi vs Darth Vader", "obiwan", "vader"),
  duel("yoda-palpatine", "Yoda vs Palpatine", "yoda", "palpatine"),
  duel("gandalf-sauron", "Gandalf vs Sauron", "gandalf", "sauron"),
  team("fellowship-darklords", "Fellowship vs Dark Lords: Gandalf + Aragorn vs Sauron + Voldemort", ["gandalf", "aragorn", "sauron", "voldemort"]),
  duel("wick-neo", "John Wick vs Neo", "johnwick", "neo"),
  duel("kong-trex", "King Kong vs T-Rex", "kingkong", "trex"),
  duel("jonsnow-nightking", "Jon Snow vs Night King", "jonsnow", "nightking"),
  duel("aang-zuko", "Aang vs Zuko", "aang", "zuko"),
  ffa("pokemon-ffa", "Pokémon free-for-all", ["pikachu", "charizard", "greninja", "lucario"]),
  duel("steve-creeper", "Steve vs Creeper", "steve", "creeper"),
  ffa("sandbox-ffa", "Sandbox free-for-all", ["steve", "jonesy", "noob", "crewmate"]),
  duel("freddy-jason", "Freddy Krueger vs Jason Voorhees", "freddy", "jason"),
  ffa("slasher-ffa", "Slasher free-for-all", ["michaelmyers", "ghostface", "chucky", "leatherface"]),
  duel("buzz-woody", "Buzz Lightyear vs Woody", "buzz", "woody"),
  team("toys-vs-swamp", "Buzz Lightyear + Woody vs Shrek + Puss in Boots", ["buzz", "woody", "shrek", "pussinboots"]),
  duel("tom-jerry", "Tom vs Jerry", "tom", "jerry"),
  ffa("cartoons-ffa", "Cartoons free-for-all", ["homer", "spongebob", "rick", "bugsbunny"]),
];

/* ------------------------------------------------------------------ --- fl-overhaul --- the roster's fingerprint and table */

/** FNV-1a (32 bit) of a string, as 8 hex digits (the tuner's scripts/fl-balance.mjs computes the same). */
export function flHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** The fingerprint of a division's fighting data (stats, weapons, abilities, intents – not the names or looks): the ratings' staleness check. */
export function flDivisionHash(division: FlDivision): string {
  return flHash(JSON.stringify(fightersOf(division).map((r) => [r.id, r.stats, r.weapons, r.ability, r.intent ?? null])));
}

/** The fingerprint of the whole roster's fighting data: the hash of the division hashes joined in `FL_DIVISIONS` order. */
export function flRosterHash(): string {
  return flHash(FL_DIVISIONS.map(flDivisionHash).join(","));
}

/**
 * A Markdown table of the roster (the README's, between its `<!-- fl-roster -->` markers): division, fighter, source, weapon,
 * the stats (HP % · speed · attack speed · damage · cast speed · size), the ability with its primitives, the role and whether it
 * is new.
 */
export function rosterTableMarkdown(): string {
  const lines = ["| Division | Fighter | Source | Weapon | HP · speed · attack · damage · cast · size | Ability (primitives) | Role | New |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of FL_ROSTER) {
    const s = r.stats;
    const stats = [s.hp, s.speed, s.attackSpeed, s.damage, s.castSpeed, s.size].join(" · ");
    const prims = r.ability.effects.map((e) => e.p.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)).join(" + ");
    lines.push(`| ${FL_DIVISION_LABELS[r.division]} | ${r.name} | ${r.source} | ${weaponLabel(r)} | ${stats} | ${r.ability.name} (${prims}${r.ability.ultimate ? ", ultimate" : ""}) | ${r.role} | ${r.isNew ? "new" : ""} |`);
  }
  return lines.join("\n");
}
