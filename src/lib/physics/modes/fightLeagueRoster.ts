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
 * Units used by the rows: lengths in ball radii (R), times in seconds, projectile speeds in arena sides per second, spreads
 * in degrees, damage in hit points (every fighter starts with the HP setting, 100 by default, × `stats.hp` / 100). The
 * stats are multipliers (1 = the league average); a weapon field left out takes the kind's default (`FL_WEAPON_DEFAULTS`).
 */

/* ------------------------------------------------------------------ divisions */

export const FL_DIVISIONS = ["marvel", "dc", "nintendo", "league", "fighting", "legends", "shonen", "starWars", "fantasy", "monsters", "action", "tv", "wildcard"] as const;
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
  wildcard: "Wildcard",
};

/* ------------------------------------------------------------------ weapons */

export const FL_WEAPON_KINDS = ["sword", "hammer", "fists", "claws", "chain", "bow", "gun", "shotgun", "wand", "staff", "book", "cards", "fire", "beam", "spark", "web", "ice", "shield", "tail"] as const;
export type FlWeaponKind = (typeof FL_WEAPON_KINDS)[number];

/**
 * Mechanical variants of a kind: sword `glow` (a lightsaber), `double` (a blade at both ends); hammer `returning` (thrown at
 * the nearest foe and flying back); chain `pull` (a thrown head that drags the hit foe to its owner); gun `burst` (three per
 * trigger), `bouncing` (bullets bounce off a wall once); cards `blink` (the owner blinks to a thrown blade); staff `return`
 * (orbs fly out and come back); shield `block` (the bracelets: blocks only, never thrown); fists `contact` (hits on body
 * contact).
 */
export const FL_WEAPON_STYLES = ["plain", "glow", "double", "returning", "pull", "burst", "bouncing", "blink", "return", "block", "contact"] as const;
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
] as const;
export type FlShape = (typeof FL_SHAPES)[number];

export interface FlWeaponSpec {
  kind: FlWeaponKind;
  style?: FlWeaponStyle;
  /**
   * Reach in ball radii: a sword's blade, a hammer's handle, a chain's length, a tail's length, a fist's extension, a fire
   * cone's range, a spark's range from the body's surface; a returning orb's range (arena sides).
   */
  reach?: number;
  /**
   * Seconds between two attacks at attack speed 1: a sword's sweep, a hammer's or a chain's orbit, a tail's swing, a
   * punch, a shot, a card throw, a breath, a beam.
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
  /** Projectile / head / fist size in ball radii. */
  size?: number;
  /** Colour of the blade, the projectile or the glow (the fighter's accent when left out). */
  color?: string;
  /** How the projectile is drawn (the kind's own shape when left out). */
  shape?: FlShape;
  /** web: the hit foe's speed factor; ice: seconds the hit foe stays frozen. */
  effect?: number;
  /** web: seconds the slow lasts. */
  effectSec?: number;
}

/** The kinds' defaults: every field a row leaves out. */
export const FL_WEAPON_DEFAULTS: Readonly<Record<FlWeaponKind, Required<Omit<FlWeaponSpec, "kind" | "color" | "shape">> & { shape: FlShape }>> = {
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
 * - volley: `n` projectiles at the nearest foe (homing, returning, bouncing between foes, exploding, unblockable…);
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
 * - summon: `n` small allied balls for `dur`, `damage` on contact;
 * - reflect: attackers take `frac` of their damage back for `dur`;
 * - disarm: the nearest foe's weapon deals no damage for `dur`;
 * - slowTime: every foe and its projectiles at `factor` speed for `dur` while the owner's side keeps full speed.
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
  | { p: "volley"; n: number; damage: number; speed?: number; spread?: number; size?: number; homing?: number; shape?: FlShape; color?: string; returning?: boolean; bounceFoes?: boolean; explode?: number; unblockable?: boolean }
  | { p: "shockwave"; radius: number; damage: number; knockback: number; delay?: number; pin?: boolean; spin?: boolean }
  | { p: "pull"; strength: number; all?: boolean }
  | { p: "decoys"; n: number; dur: number; freezeOnTouch?: number }
  | { p: "heal"; amount: number; dur: number }
  | { p: "fireRing"; radius: number; damage: number; dur: number; shape?: FlShape }
  | { p: "giantHit"; mult: number; count?: number; knockback?: number; freeze?: number; belowHalf?: number; halfMaxHp?: boolean; maxHpFrac?: number; homing?: number }
  | { p: "lightning"; damage: number }
  | { p: "confuse"; dur: number }
  | { p: "blinkStrike"; n: number; damage: number; interval?: number }
  | { p: "summon"; n: number; dur: number; damage: number; size?: number; shape?: FlShape }
  | { p: "reflect"; dur: number; frac: number }
  | { p: "disarm"; dur: number }
  | { p: "slowTime"; dur: number; factor: number };

export interface FlAbility {
  /** The ability's name (an English proper name, shown in its box). */
  name: string;
  /** Seconds the meter takes to fill at cast speed 1 without hits. */
  charge: number;
  /** One or two primitives, fired together when the telegraph ends. */
  effects: readonly FlEffect[];
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
}

const S = (o: Partial<FlStats> = {}): FlStats => ({ hp: 100, speed: 1, attackSpeed: 1, damage: 1, castSpeed: 1, size: 1, ...o });

const MARVEL = "Marvel (comics & movies)";
const DC = "DC (comics & movies)";
const NINTENDO = "Nintendo (video games)";
const SEGA = "Sega (video games)";
const LEAGUE = "League of Legends (video game)";
const CAPCOM = "Street Fighter (video games)";
const MK = "Mortal Kombat (video games)";
const ANIME = (show: string) => `${show} (anime & manga)`;
const SW = "Star Wars (movies)";

/**
 * Every fighter, division by division (the panel's pickers group them the same way). Tuned so that within its division no
 * fighter wins more than 75 % or fewer than 25 % of a round robin (tests/fightLeague.test.ts prints the tables).
 */
export const FL_ROSTER: readonly FlFighterRow[] = [
  /* ---------------------------------------------------------------- MARVEL (comics & movies) */
  {
    id: "thor",
    name: "Thor",
    division: "marvel",
    source: MARVEL,
    body: "#c9ced8",
    accent: "#c1121f",
    weapons: [{ kind: "hammer", style: "returning", damage: 11, throwEvery: 3.2 }],
    stats: S({ speed: 0.95, damage: 1.64 }),
    ability: { name: "Thunder Strike", charge: 10, effects: [{ p: "lightning", damage: 14 }] },
    description: "God of thunder: swings his hammer, throws it at the nearest foe and calls it back, then strikes every foe with lightning.",
  },
  {
    id: "loki",
    name: "Loki",
    division: "marvel",
    source: MARVEL,
    body: "#2d6a4f",
    accent: "#e9c46a",
    weapons: [{ kind: "cards", shape: "dagger", count: 4, damage: 5 }],
    stats: S({ speed: 1.1, damage: 1.51 }),
    ability: { name: "Illusion", charge: 9, effects: [{ p: "decoys", n: 2, dur: 3 }] },
    description: "The trickster: four daggers orbit him and fly one by one; Illusion conjures two decoys that soak up the hits.",
  },
  {
    id: "spiderman",
    name: "Spider-Man",
    division: "marvel",
    source: MARVEL,
    body: "#d62828",
    accent: "#1d4ed8",
    weapons: [{ kind: "web", cooldown: 1.1, damage: 5 }],
    stats: S({ speed: 1.25, damage: 1.45 }),
    ability: { name: "Web Trap", charge: 8, effects: [{ p: "choke", dur: 2, damage: 0 }] },
    description: "Quick and slippery: web shots slow the foe they stick to, and Web Trap holds the nearest foe for two seconds.",
  },
  {
    id: "ironman",
    name: "Iron Man",
    division: "marvel",
    source: MARVEL,
    body: "#b91c1c",
    accent: "#f5c518",
    weapons: [{ kind: "gun", shape: "repulsor", cooldown: 1.0, damage: 6, speed: 1.6 }],
    stats: S({ damage: 1.26 }),
    ability: { name: "Unibeam", charge: 10, effects: [{ p: "beam", dur: 1, width: 0.9, damage: 6, color: "#e0f2fe" }] },
    description: "Repulsor blasts at the nearest foe on a steady cadence; the Unibeam fires a wide ray for a second.",
  },
  {
    id: "captainamerica",
    name: "Captain America",
    division: "marvel",
    source: MARVEL,
    body: "#1e3a8a",
    accent: "#dc2626",
    weapons: [{ kind: "shield", throwEvery: 2.5, damage: 8 }],
    stats: S({ hp: 105, damage: 1.21 }),
    ability: { name: "Shield Ricochet", charge: 9, effects: [{ p: "volley", n: 1, damage: 10, speed: 1.3, size: 0.6, shape: "shield", bounceFoes: true }] },
    description: "His shield blocks hits from the front and flies at the foe every few seconds; Shield Ricochet bounces it between every foe.",
  },
  {
    id: "hulk",
    name: "Hulk",
    division: "marvel",
    source: MARVEL,
    body: "#4caf50",
    accent: "#6b21a8",
    weapons: [{ kind: "fists", cooldown: 1.0, damage: 12, knockback: 1.8, size: 0.5 }],
    stats: S({ hp: 115, speed: 0.85, damage: 1.06, size: 1.15 }),
    ability: { name: "Hulk Smash", charge: 10, effects: [{ p: "shockwave", radius: 4.5, damage: 14, knockback: 2.2 }] },
    description: "Big, slow and heavy: every punch hurts and knocks the foe away, and Hulk Smash sends out a shockwave.",
  },

  /* ---------------------------------------------------------------- DC (comics & movies) */
  {
    id: "superman",
    name: "Superman",
    division: "dc",
    source: DC,
    body: "#1d4ed8",
    accent: "#dc2626",
    weapons: [{ kind: "beam", cooldown: 2.0, damage: 9, color: "#ef4444" }],
    stats: S({ hp: 105, damage: 1.74 }),
    ability: { name: "Solar Flare", charge: 12, effects: [{ p: "shockwave", radius: 5, damage: 22, knockback: 1.5 }] },
    description: "Heat vision: a thin red ray at the nearest foe every two seconds; Solar Flare is a shockwave of heavy damage.",
  },
  {
    id: "batman",
    name: "Batman",
    division: "dc",
    source: DC,
    body: "#374151",
    accent: "#facc15",
    weapons: [{ kind: "cards", shape: "batarang", count: 3, cooldown: 1.0, damage: 6 }],
    stats: S({ damage: 1.21 }),
    ability: {
      name: "Smoke Bomb",
      charge: 10,
      effects: [
        { p: "invulnerable", dur: 2 },
        { p: "giantHit", mult: 3 },
      ],
    },
    description: "Batarangs circle him and fly at the foe; Smoke Bomb makes him untouchable for two seconds and his next hit triple.",
  },
  {
    id: "joker",
    name: "Joker",
    division: "dc",
    source: DC,
    body: "#7e22ce",
    accent: "#22c55e",
    weapons: [{ kind: "cards", shape: "card", count: 4, cooldown: 0.9, damage: 5 }],
    stats: S({ speed: 1.05, damage: 1.76 }),
    ability: { name: "Laughing Gas", charge: 9, effects: [{ p: "confuse", dur: 2.5 }] },
    description: "Razor cards orbit him and fly one by one; Laughing Gas slows every foe and turns its aim backwards.",
  },
  {
    id: "wonderwoman",
    name: "Wonder Woman",
    division: "dc",
    source: DC,
    body: "#b91c1c",
    accent: "#fbbf24",
    weapons: [{ kind: "sword", damage: 8 }, { kind: "shield", style: "block", size: 0.5 }],
    stats: S({ speed: 1.05, damage: 0.75 }),
    ability: {
      name: "Lasso of Truth",
      charge: 9,
      effects: [
        { p: "pull", strength: 2.2 },
        { p: "choke", dur: 1, damage: 4 },
      ],
    },
    description: "A sword, and bracelets that block hits from the front; the Lasso of Truth pulls the nearest foe in and holds it.",
  },

  /* ---------------------------------------------------------------- NINTENDO & SEGA (video games) */
  {
    id: "mario",
    name: "Mario",
    division: "nintendo",
    source: NINTENDO,
    body: "#e11d48",
    accent: "#2563eb",
    weapons: [{ kind: "gun", style: "bouncing", shape: "fireball", cooldown: 1.0, damage: 5, speed: 0.95, size: 0.22, color: "#f97316" }],
    stats: S({ damage: 1.05 }),
    ability: {
      name: "Super Star",
      charge: 11,
      effects: [
        { p: "invulnerable", dur: 3, contact: 8 },
        { p: "speedBurst", mult: 1.5, dur: 3 },
      ],
    },
    description: "Bouncing fireballs that ricochet off a wall once; Super Star makes him invulnerable for three seconds and every touch hurts.",
  },
  {
    id: "link",
    name: "Link",
    division: "nintendo",
    source: NINTENDO,
    body: "#15803d",
    accent: "#d4a373",
    weapons: [{ kind: "sword", damage: 8, color: "#e2e8f0" }],
    stats: S({ damage: 1.16 }),
    ability: { name: "Spin Attack", charge: 8, effects: [{ p: "shockwave", radius: 2.9, damage: 16, knockback: 1, spin: true }] },
    description: "A sword that sweeps a wide arc on every bounce; the Spin Attack whirls it all the way round at double damage.",
  },
  {
    id: "samus",
    name: "Samus",
    division: "nintendo",
    source: NINTENDO,
    body: "#ea580c",
    accent: "#84cc16",
    weapons: [{ kind: "gun", shape: "plasma", cooldown: 1.1, damage: 6, speed: 1.5, color: "#facc15" }],
    stats: S({ damage: 1.39 }),
    ability: { name: "Charge Shot", charge: 10, effects: [{ p: "volley", n: 1, damage: 24, speed: 1.1, size: 0.9, shape: "charge", color: "#fde047" }] },
    description: "Her arm cannon fires a steady stream of shots; the Charge Shot is one huge, slow projectile.",
  },
  {
    id: "captainfalcon",
    name: "Captain Falcon",
    division: "nintendo",
    source: NINTENDO,
    body: "#1e40af",
    accent: "#f59e0b",
    weapons: [{ kind: "fists", cooldown: 0.45, damage: 5 }],
    stats: S({ speed: 1.3, damage: 0.96 }),
    ability: { name: "Falcon Punch", charge: 9, effects: [{ p: "giantHit", mult: 5, knockback: 3 }] },
    description: "Fast fists and a fast car's worth of speed; the Falcon Punch makes his next hit five times as strong.",
  },
  {
    id: "littlemac",
    name: "Little Mac",
    division: "nintendo",
    source: NINTENDO,
    body: "#22c55e",
    accent: "#111827",
    weapons: [{ kind: "fists", cooldown: 0.28, damage: 3.2, reach: 0.8 }],
    stats: S({ speed: 1.25, damage: 1.26, size: 0.92 }),
    ability: { name: "Star Punch", charge: 8, effects: [{ p: "giantHit", mult: 4, freeze: 1 }] },
    description: "A blur of very fast, very light jabs; the Star Punch hits four times as hard and freezes the foe for a second.",
  },
  {
    id: "sonic",
    name: "Sonic",
    division: "nintendo",
    source: SEGA,
    body: "#2563eb",
    accent: "#ef4444",
    weapons: [{ kind: "fists", style: "contact", reach: 0.15, cooldown: 0.3, damage: 4, size: 0.3 }],
    stats: S({ speed: 1.8, damage: 1.24 }),
    ability: {
      name: "Spin Dash",
      charge: 9,
      effects: [
        { p: "speedBurst", mult: 3, dur: 2 },
        { p: "damageBurst", mult: 2, dur: 2 },
      ],
    },
    description: "The fastest fighter in the league hits by running into you; the Spin Dash triples his speed and doubles his damage.",
  },

  /* ---------------------------------------------------------------- LEAGUE OF LEGENDS (video games) */
  {
    id: "yuumi",
    name: "Yuumi",
    division: "league",
    source: LEAGUE,
    body: "#f5f0e6",
    accent: "#6366f1",
    weapons: [{ kind: "book", cooldown: 1.5, damage: 6 }],
    stats: S({ damage: 2.07, size: 0.9 }),
    ability: { name: "Final Chapter", charge: 11, effects: [{ p: "beam", dur: 2, width: 0.8, damage: 5, color: "#c4b5fd" }] },
    description: "Her book fires slow homing bolts; Final Chapter turns its pages into a beam that lasts two seconds.",
  },
  {
    id: "katarina",
    name: "Katarina",
    division: "league",
    source: LEAGUE,
    body: "#9f1239",
    accent: "#f43f5e",
    weapons: [{ kind: "cards", style: "blink", shape: "dagger", count: 3, cooldown: 0.8, damage: 6 }],
    stats: S({ speed: 1.25, damage: 0.96 }),
    ability: { name: "Death Lotus", charge: 9, effects: [{ p: "fireRing", radius: 3, damage: 5, dur: 2.5, shape: "blades" }] },
    description: "Throws daggers and blinks to every third one she throws; Death Lotus spins a ring of blades around her.",
  },
  {
    id: "garen",
    name: "Garen",
    division: "league",
    source: LEAGUE,
    body: "#1e40af",
    accent: "#eab308",
    weapons: [{ kind: "sword", damage: 9, reach: 2.0, color: "#e5e7eb" }],
    stats: S({ hp: 110, damage: 0.77 }),
    ability: { name: "Demacian Justice", charge: 9, effects: [{ p: "giantHit", mult: 2, belowHalf: 4 }] },
    description: "A broad sword and thick armour; Demacian Justice quadruples his next hit on a foe below half its HP.",
  },
  {
    id: "jinx",
    name: "Jinx",
    division: "league",
    source: LEAGUE,
    body: "#3b82f6",
    accent: "#ec4899",
    weapons: [{ kind: "gun", shape: "bullet", cooldown: 0.2, damage: 1.6, spread: 12, speed: 1.6 }],
    stats: S({ damage: 1.22 }),
    ability: { name: "Super Mega Death Rocket", charge: 10, effects: [{ p: "volley", n: 1, damage: 14, speed: 0.9, size: 0.45, shape: "rocket", explode: 4 }] },
    description: "Her minigun sprays fast, weak bullets; the Super Mega Death Rocket explodes in a shockwave where it lands.",
  },
  {
    id: "ahri",
    name: "Ahri",
    division: "league",
    source: LEAGUE,
    body: "#fbcfe8",
    accent: "#be123c",
    weapons: [{ kind: "staff", style: "return", reach: 0.5, cooldown: 1.8, damage: 7, speed: 0.9, homing: 0.6, color: "#f9a8d4" }],
    stats: S({ speed: 1.1, damage: 1.79 }),
    ability: { name: "Spirit Rush", charge: 10, effects: [{ p: "blinkStrike", n: 3, damage: 7 }] },
    description: "Orbs fly out, hit on the way and come back to her; Spirit Rush dashes onto the nearest foe three times.",
  },

  /* ---------------------------------------------------------------- FIGHTING GAMES (video games) */
  {
    id: "ryu",
    name: "Ryu",
    division: "fighting",
    source: CAPCOM,
    body: "#f3f4f6",
    accent: "#dc2626",
    weapons: [
      { kind: "fists", cooldown: 0.5, damage: 6 },
      { kind: "gun", shape: "hadouken", cooldown: 2.6, damage: 8, speed: 0.8, size: 0.55, spread: 0, color: "#60a5fa" },
    ],
    stats: S({ damage: 0.9 }),
    ability: { name: "Shoryuken", charge: 9, effects: [{ p: "giantHit", mult: 3, knockback: 2.5 }] },
    description: "Fists and a slow Hadouken fireball; the Shoryuken triples his next hit and launches the foe.",
  },
  {
    id: "ken",
    name: "Ken",
    division: "fighting",
    source: CAPCOM,
    body: "#dc2626",
    accent: "#f59e0b",
    weapons: [
      { kind: "fists", cooldown: 0.45, damage: 6 },
      { kind: "gun", shape: "flamewave", cooldown: 2.8, damage: 8, speed: 0.85, size: 0.55, spread: 0, color: "#fb923c" },
    ],
    stats: S({ speed: 1.05, damage: 0.79 }),
    ability: { name: "Shoryureppa", charge: 9, effects: [{ p: "giantHit", mult: 2, count: 3, knockback: 1.5 }] },
    description: "Faster fists and a flaming Hadouken; the Shoryureppa makes his next three hits double.",
  },
  {
    id: "chunli",
    name: "Chun-Li",
    division: "fighting",
    source: CAPCOM,
    body: "#2563eb",
    accent: "#fbbf24",
    weapons: [{ kind: "fists", shape: "kicks", cooldown: 0.32, damage: 4, reach: 1.0 }],
    stats: S({ speed: 1.3, damage: 1.25 }),
    ability: { name: "Spinning Bird Kick", charge: 9, effects: [{ p: "fireRing", radius: 2.6, damage: 5, dur: 2, shape: "kicks" }] },
    description: "Lightning-fast kicks; the Spinning Bird Kick turns her into a ring of kicks for two seconds.",
  },
  {
    id: "scorpion",
    name: "Scorpion",
    division: "fighting",
    source: MK,
    body: "#facc15",
    accent: "#111827",
    weapons: [{ kind: "chain", style: "pull", reach: 1.4, cooldown: 1.0, throwEvery: 2.2, damage: 8 }],
    stats: S({ damage: 1.07 }),
    ability: { name: "Hellfire", charge: 10, effects: [{ p: "fireRing", radius: 3.2, damage: 6, dur: 2.5 }] },
    description: "His spear on a chain drags the hit foe to him; Hellfire burns everything around him.",
  },
  {
    id: "subzero",
    name: "Sub-Zero",
    division: "fighting",
    source: MK,
    body: "#2563eb",
    accent: "#bae6fd",
    weapons: [{ kind: "ice", cooldown: 1.8, damage: 5 }],
    stats: S({ damage: 2.22 }),
    ability: { name: "Ice Clone", charge: 9, effects: [{ p: "decoys", n: 1, dur: 4, freezeOnTouch: 1.5 }] },
    description: "Ice shots freeze the foe they hit for a second; the Ice Clone freezes whoever touches it.",
  },

  /* ---------------------------------------------------------------- GAME LEGENDS (video games) */
  {
    id: "masterchief",
    name: "Master Chief",
    division: "legends",
    source: "Halo (video games)",
    body: "#4d7c0f",
    accent: "#f59e0b",
    weapons: [{ kind: "gun", style: "burst", count: 3, cooldown: 1.5, damage: 3, speed: 1.7, spread: 4 }],
    stats: S({ hp: 110, damage: 1.22 }),
    ability: {
      name: "Spartan Charge",
      charge: 9,
      effects: [
        { p: "speedBurst", mult: 2.2, dur: 1.5 },
        { p: "giantHit", mult: 3 },
      ],
    },
    description: "A burst rifle, three shots a trigger; the Spartan Charge rushes in and triples his next hit.",
  },
  {
    id: "doomslayer",
    name: "Doom Slayer",
    division: "legends",
    source: "Doom (video games)",
    body: "#3f6212",
    accent: "#b91c1c",
    weapons: [{ kind: "shotgun", count: 6, spread: 32, damage: 2.6, cooldown: 1.5 }],
    stats: S({ hp: 105, damage: 1.02 }),
    ability: { name: "BFG", charge: 12, effects: [{ p: "beam", dur: 1, width: 1.6, damage: 10, color: "#4ade80" }] },
    description: "A shotgun cone of pellets at close range; the BFG fires a wide green beam.",
  },
  {
    id: "kratos",
    name: "Kratos",
    division: "legends",
    source: "God of War (video games)",
    body: "#e5e7eb",
    accent: "#b91c1c",
    weapons: [{ kind: "chain", shape: "blades", reach: 2.3, cooldown: 1.2, damage: 8 }],
    stats: S({ damage: 2.14 }),
    ability: {
      name: "Spartan Rage",
      charge: 11,
      effects: [
        { p: "damageBurst", mult: 2, dur: 3 },
        { p: "heal", amount: 20, dur: 3 },
      ],
    },
    description: "The Blades of Chaos whirl on their chains; Spartan Rage doubles his damage and heals 20 HP over three seconds.",
  },
  {
    id: "steve",
    name: "Steve",
    division: "legends",
    source: "Minecraft (video game)",
    body: "#22a5c9",
    accent: "#5b3a29",
    weapons: [{ kind: "sword", damage: 8, reach: 1.7, color: "#67e8f9" }],
    stats: S({ damage: 1.36 }),
    ability: { name: "TNT", charge: 10, effects: [{ p: "shockwave", radius: 4.5, damage: 18, knockback: 2, delay: 1 }] },
    description: "A diamond sword; TNT drops a block that explodes in a shockwave after a one-second fuse.",
  },
  {
    id: "pikachu",
    name: "Pikachu",
    division: "legends",
    source: "Pokémon (video games)",
    body: "#facc15",
    accent: "#ef4444",
    weapons: [{ kind: "spark", reach: 2.8, cooldown: 0.75, damage: 5, color: "#fde047" }],
    stats: S({ speed: 1.3, damage: 1.35, size: 0.85 }),
    ability: { name: "Thunderbolt", charge: 9, effects: [{ p: "lightning", damage: 13 }] },
    description: "Short electric arcs at any foe in range; Thunderbolt strikes every foe with lightning.",
  },
  {
    id: "charizard",
    name: "Charizard",
    division: "legends",
    source: "Pokémon (video games)",
    body: "#f97316",
    accent: "#0f766e",
    weapons: [{ kind: "fire", reach: 3.2, damage: 3 }],
    stats: S({ hp: 105, damage: 1.53, size: 1.1 }),
    ability: { name: "Blast Burn", charge: 11, effects: [{ p: "fireRing", radius: 3.6, damage: 6, dur: 2.5 }] },
    description: "Breathes a cone of fire ahead; Blast Burn sets the ground around him ablaze.",
  },

  /* ---------------------------------------------------------------- SHONEN ANIME (TV shows) */
  {
    id: "goku",
    name: "Goku",
    division: "shonen",
    source: ANIME("Dragon Ball"),
    body: "#f97316",
    accent: "#1d4ed8",
    weapons: [
      { kind: "fists", cooldown: 0.45, damage: 5 },
      { kind: "gun", shape: "ki", cooldown: 1.3, damage: 4, speed: 1.4, color: "#93c5fd" },
    ],
    stats: S({ damage: 1.08 }),
    ability: { name: "Kamehameha", charge: 10, effects: [{ p: "beam", dur: 1.2, width: 1, damage: 6, color: "#60a5fa" }] },
    description: "Fists and ki blasts; the Kamehameha is a blue beam that lasts more than a second.",
  },
  {
    id: "vegeta",
    name: "Vegeta",
    division: "shonen",
    source: ANIME("Dragon Ball"),
    body: "#1e3a8a",
    accent: "#facc15",
    weapons: [
      { kind: "fists", cooldown: 0.45, damage: 5.5 },
      { kind: "gun", shape: "ki", cooldown: 1.2, damage: 4, speed: 1.4, color: "#fde68a" },
    ],
    stats: S({ damage: 1.04 }),
    ability: { name: "Final Flash", charge: 13, effects: [{ p: "beam", dur: 1.4, width: 1.5, damage: 7, color: "#fef08a" }] },
    description: "Fists and ki blasts; Final Flash takes longer to charge and fires a wider beam.",
  },
  {
    id: "naruto",
    name: "Naruto",
    division: "shonen",
    source: ANIME("Naruto"),
    body: "#fb923c",
    accent: "#1e3a8a",
    weapons: [{ kind: "cards", shape: "shuriken", count: 4, cooldown: 0.9, damage: 5 }],
    stats: S({ speed: 1.1, damage: 1.34 }),
    ability: { name: "Shadow Clone", charge: 9, effects: [{ p: "summon", n: 2, dur: 4, damage: 4, shape: "clone" }] },
    description: "Shuriken orbit him and fly one by one; Shadow Clone summons two clones that fight for four seconds.",
  },
  {
    id: "sasuke",
    name: "Sasuke",
    division: "shonen",
    source: ANIME("Naruto"),
    body: "#1e1b4b",
    accent: "#60a5fa",
    weapons: [{ kind: "sword", damage: 8, reach: 1.8, color: "#cbd5e1" }],
    stats: S({ speed: 1.15, damage: 1.12 }),
    ability: { name: "Chidori", charge: 11, effects: [{ p: "blinkStrike", n: 4, damage: 6 }] },
    description: "A quick blade; Chidori blinks onto the nearest foe four times in a row.",
  },
  {
    id: "luffy",
    name: "Luffy",
    division: "shonen",
    source: ANIME("One Piece"),
    body: "#dc2626",
    accent: "#facc15",
    weapons: [{ kind: "fists", reach: 2.4, cooldown: 0.7, damage: 6 }],
    stats: S({ damage: 1.24 }),
    ability: { name: "Gum-Gum Gatling", charge: 9, effects: [{ p: "attackSpeedBurst", mult: 4, dur: 2 }] },
    description: "Rubber fists that reach across half the ring; the Gum-Gum Gatling punches four times as fast for two seconds.",
  },
  {
    id: "saitama",
    name: "Saitama",
    division: "shonen",
    source: ANIME("One-Punch Man"),
    body: "#fde047",
    accent: "#ef4444",
    weapons: [{ kind: "fists", count: 1, cooldown: 1.8, damage: 18, knockback: 2 }],
    stats: S({ damage: 1.38 }),
    ability: { name: "Serious Punch", charge: 14, effects: [{ p: "giantHit", mult: 1, maxHpFrac: 0.4, knockback: 3 }] },
    description: "One slow punch at triple damage; the Serious Punch is worth 40 % of the foe's maximum HP.",
  },

  /* ---------------------------------------------------------------- STAR WARS (movies) */
  {
    id: "luke",
    name: "Luke Skywalker",
    division: "starWars",
    source: SW,
    body: "#e7d8b8",
    accent: "#16a34a",
    weapons: [{ kind: "sword", style: "glow", damage: 8, color: "#4ade80" }],
    stats: S({ damage: 1.17 }),
    ability: { name: "Force Push", charge: 9, effects: [{ p: "shockwave", radius: 6, damage: 6, knockback: 3.5 }] },
    description: "A green energy blade; the Force Push throws every foe across the ring.",
  },
  {
    id: "vader",
    name: "Darth Vader",
    division: "starWars",
    source: SW,
    body: "#111827",
    accent: "#dc2626",
    weapons: [{ kind: "sword", style: "glow", damage: 11, cooldown: 0.5, color: "#ef4444" }],
    stats: S({ hp: 110, speed: 0.85, damage: 0.76 }),
    ability: { name: "Force Choke", charge: 11, effects: [{ p: "choke", dur: 2, damage: 15, at: "over" }] },
    description: "A red blade, slower and stronger; the Force Choke holds the nearest foe for two seconds and hurts it.",
  },
  {
    id: "yoda",
    name: "Yoda",
    division: "starWars",
    source: SW,
    body: "#84cc16",
    accent: "#a16207",
    weapons: [{ kind: "sword", style: "glow", damage: 6, reach: 1.6, color: "#86efac" }],
    stats: S({ speed: 1.45, attackSpeed: 1.3, damage: 0.94, size: 0.75 }),
    ability: { name: "Force Lift", charge: 10, effects: [{ p: "choke", dur: 2, damage: 14, at: "end" }] },
    description: "Tiny and fast with a short green blade; Force Lift holds the nearest foe up for two seconds, then slams it.",
  },
  {
    id: "maul",
    name: "Darth Maul",
    division: "starWars",
    source: SW,
    body: "#b91c1c",
    accent: "#0a0a0a",
    weapons: [{ kind: "sword", style: "double", damage: 7, reach: 1.6, color: "#f87171" }],
    stats: S({ speed: 1.1, damage: 1.6 }),
    ability: { name: "Saber Throw", charge: 9, effects: [{ p: "volley", n: 1, damage: 12, speed: 1.1, size: 0.5, shape: "saber", color: "#f87171", returning: true }] },
    description: "A double-bladed saber, a blade at both ends; the Saber Throw flies at the foe and comes back.",
  },

  /* ---------------------------------------------------------------- FANTASY (movies) */
  {
    id: "harrypotter",
    name: "Harry Potter",
    division: "fantasy",
    source: "Harry Potter (movies & books)",
    body: "#991b1b",
    accent: "#fbbf24",
    weapons: [{ kind: "wand", cooldown: 1.0, damage: 5, color: "#fca5a5" }],
    stats: S({ speed: 1.05, damage: 1.07 }),
    ability: { name: "Expelliarmus", charge: 9, effects: [{ p: "disarm", dur: 3 }] },
    description: "Fast bolts from his wand; Expelliarmus disarms the nearest foe for three seconds.",
  },
  {
    id: "voldemort",
    name: "Voldemort",
    division: "fantasy",
    source: "Harry Potter (movies & books)",
    body: "#1f2937",
    accent: "#4ade80",
    weapons: [{ kind: "wand", cooldown: 1.45, damage: 8, color: "#86efac" }],
    stats: S({ damage: 1.15 }),
    ability: { name: "Avada Kedavra", charge: 13, effects: [{ p: "volley", n: 1, damage: 30, speed: 1.6, size: 0.3, shape: "bolt", color: "#22c55e", unblockable: true }] },
    description: "Stronger, slower bolts; Avada Kedavra is one unblockable bolt at nearly four times the damage.",
  },
  {
    id: "gandalf",
    name: "Gandalf",
    division: "fantasy",
    source: "The Lord of the Rings (movies & books)",
    body: "#a8a29e",
    accent: "#f5f5f4",
    weapons: [
      { kind: "staff", cooldown: 2.3, damage: 8, color: "#fef9c3" },
      { kind: "sword", damage: 6, reach: 1.6, color: "#e5e7eb" },
    ],
    stats: S({ damage: 1.22 }),
    ability: {
      name: "You Shall Not Pass",
      charge: 12,
      effects: [
        { p: "invulnerable", dur: 2 },
        { p: "shockwave", radius: 6, damage: 8, knockback: 3.5, pin: true },
      ],
    },
    description: "A staff of homing orbs and a sword; You Shall Not Pass makes him untouchable and pins every foe to the far wall.",
  },
  {
    id: "legolas",
    name: "Legolas",
    division: "fantasy",
    source: "The Lord of the Rings (movies & books)",
    body: "#4d7c0f",
    accent: "#fde68a",
    weapons: [{ kind: "bow", cooldown: 0.55, damage: 4, speed: 1.5 }],
    stats: S({ speed: 1.15, damage: 1.1 }),
    ability: { name: "Arrow Storm", charge: 10, effects: [{ p: "volley", n: 12, damage: 3, spread: 50, speed: 1.4, shape: "arrow" }] },
    description: "The fastest bow in the league; Arrow Storm looses twelve arrows at once.",
  },

  /* ---------------------------------------------------------------- MOVIE MONSTERS (movies) */
  {
    id: "godzilla",
    name: "Godzilla",
    division: "monsters",
    source: "Godzilla (movies)",
    body: "#3f4b3a",
    accent: "#22d3ee",
    weapons: [{ kind: "tail", reach: 2.4, cooldown: 1.0, damage: 9, knockback: 1.4 }],
    stats: S({ hp: 120, speed: 0.8, damage: 1.14, size: 1.2 }),
    ability: { name: "Atomic Breath", charge: 11, effects: [{ p: "beam", dur: 1.3, width: 1.2, damage: 8, color: "#38bdf8" }] },
    description: "A long tail sweeping behind him; Atomic Breath is a blue beam.",
  },
  {
    id: "kingkong",
    name: "King Kong",
    division: "monsters",
    source: "King Kong (movies)",
    body: "#5b3a29",
    accent: "#a8a29e",
    weapons: [{ kind: "fists", cooldown: 0.9, damage: 11, knockback: 2, size: 0.5 }],
    stats: S({ hp: 115, speed: 0.95, damage: 0.9, size: 1.15 }),
    ability: { name: "Chest Beat", charge: 10, effects: [{ p: "damageBurst", mult: 2, dur: 3, knockback: 2 }] },
    description: "Slow, heavy fists; the Chest Beat doubles his damage and knockback for three seconds.",
  },
  {
    id: "alien",
    name: "Alien",
    division: "monsters",
    source: "Alien (movies)",
    body: "#0f172a",
    accent: "#a3e635",
    weapons: [
      { kind: "claws", damage: 3 },
      { kind: "tail", reach: 2.0, cooldown: 0.8, damage: 5 },
    ],
    stats: S({ speed: 1.2, damage: 1.31 }),
    ability: { name: "Acid Blood", charge: 9, effects: [{ p: "reflect", dur: 4, frac: 0.6 }] },
    description: "Claws in front and a tail behind; Acid Blood burns every attacker for four seconds.",
  },
  {
    id: "predator",
    name: "Predator",
    division: "monsters",
    source: "Predator (movies)",
    body: "#8a7f4f",
    accent: "#dc2626",
    weapons: [
      { kind: "gun", shape: "plasma", cooldown: 1.6, damage: 8, homing: 1, speed: 1.2, color: "#60a5fa" },
      { kind: "claws", damage: 3 },
    ],
    stats: S({ damage: 1.1 }),
    ability: { name: "Cloak", charge: 10, effects: [{ p: "invulnerable", dur: 2.5, untargetable: true }] },
    description: "A shoulder plasma caster and wrist blades; Cloak makes him invulnerable and untargetable.",
  },

  /* ---------------------------------------------------------------- ACTION MOVIES (movies) */
  {
    id: "johnwick",
    name: "John Wick",
    division: "action",
    source: "John Wick (movies)",
    body: "#1f2937",
    accent: "#e5e7eb",
    weapons: [{ kind: "gun", shape: "bullet", cooldown: 0.7, damage: 5.5, spread: 0.5 }],
    stats: S({ speed: 1.15, damage: 0.88 }),
    ability: { name: "Baba Yaga", charge: 9, effects: [{ p: "giantHit", mult: 2, count: 5, homing: 4 }] },
    description: "Precise pistols; Baba Yaga makes his next five shots double and homing.",
  },
  {
    id: "neo",
    name: "Neo",
    division: "action",
    source: "The Matrix (movies)",
    body: "#0b0f0b",
    accent: "#22c55e",
    weapons: [{ kind: "fists", cooldown: 0.4, damage: 5.5, reach: 1.0 }],
    stats: S({ speed: 1.25, damage: 1.12 }),
    ability: { name: "Bullet Time", charge: 10, effects: [{ p: "slowTime", dur: 2.5, factor: 0.3 }] },
    description: "Fast martial arts; Bullet Time slows every foe and every shot to a crawl while he moves at full speed.",
  },
  {
    id: "terminator",
    name: "Terminator",
    division: "action",
    source: "The Terminator (movies)",
    body: "#27272a",
    accent: "#dc2626",
    weapons: [{ kind: "shotgun", count: 6, damage: 2.8, cooldown: 1.6 }],
    stats: S({ hp: 120, speed: 0.85, damage: 1.22 }),
    ability: { name: "Minigun", charge: 10, effects: [{ p: "volley", n: 12, damage: 2.5, spread: 40, speed: 1.7, shape: "bullet" }] },
    description: "A shotgun and a lot of armour; the Minigun fires twelve bullets at once.",
  },
  {
    id: "robocop",
    name: "RoboCop",
    division: "action",
    source: "RoboCop (movies)",
    body: "#a5b4c8",
    accent: "#334155",
    weapons: [{ kind: "gun", style: "burst", count: 3, cooldown: 1.5, damage: 3.2, speed: 1.6, spread: 4 }],
    stats: S({ hp: 115, speed: 0.8, damage: 1.42 }),
    ability: { name: "Targeting", charge: 9, effects: [{ p: "giantHit", mult: 1, count: 9, homing: 5 }] },
    description: "The Auto-9 fires three-round bursts; Targeting makes his next nine shots home in.",
  },

  /* ---------------------------------------------------------------- TV (TV shows) */
  {
    id: "homelander",
    name: "Homelander",
    division: "tv",
    source: "The Boys (TV show)",
    body: "#1d4ed8",
    accent: "#dc2626",
    weapons: [
      { kind: "beam", cooldown: 2.2, damage: 8, color: "#ef4444" },
      { kind: "fists", cooldown: 0.55, damage: 6 },
    ],
    stats: S({ damage: 1.08 }),
    ability: { name: "Laser Sweep", charge: 11, effects: [{ p: "beam", dur: 1.5, width: 0.8, damage: 6, color: "#f87171" }] },
    description: "Laser eyes and fists; the Laser Sweep holds a red beam for a second and a half.",
  },
  {
    id: "omniman",
    name: "Omni-Man",
    division: "tv",
    source: "Invincible (TV show)",
    body: "#f8fafc",
    accent: "#dc2626",
    weapons: [{ kind: "fists", cooldown: 0.8, damage: 10, knockback: 1.8, size: 0.45 }],
    stats: S({ hp: 110, damage: 0.88 }),
    ability: {
      name: "Viltrumite Rush",
      charge: 10,
      effects: [
        { p: "speedBurst", mult: 3, dur: 2 },
        { p: "damageBurst", mult: 2, dur: 2 },
      ],
    },
    description: "Heavy fists; the Viltrumite Rush triples his speed and doubles his damage for two seconds.",
  },
  {
    id: "aang",
    name: "Aang",
    division: "tv",
    source: "Avatar: The Last Airbender (TV show)",
    body: "#f59e0b",
    accent: "#38bdf8",
    weapons: [{ kind: "fists", shape: "air", cooldown: 0.5, damage: 1.5, knockback: 2.6, reach: 1.4 }],
    stats: S({ speed: 1.3, damage: 1.39, castSpeed: 1.3 }),
    ability: {
      name: "Avatar State",
      charge: 10,
      effects: [
        { p: "fireRing", radius: 3, damage: 6, dur: 2 },
        { p: "lightning", damage: 10 },
      ],
    },
    description: "Airbending pushes that knock foes away but barely hurt; the Avatar State is a ring of fire and a bolt of lightning.",
  },
  {
    id: "zuko",
    name: "Zuko",
    division: "tv",
    source: "Avatar: The Last Airbender (TV show)",
    body: "#b91c1c",
    accent: "#f59e0b",
    weapons: [{ kind: "fire", reach: 3.0, damage: 3.5 }],
    stats: S({ damage: 1.62 }),
    ability: { name: "Lightning Redirect", charge: 10, effects: [{ p: "beam", dur: 0.8, width: 0.6, damage: 10, color: "#a5f3fc" }] },
    description: "Firebending: a cone of fire ahead; Lightning Redirect fires a crackling beam.",
  },
  {
    id: "jonsnow",
    name: "Jon Snow",
    division: "tv",
    source: "Game of Thrones (TV show)",
    body: "#18181b",
    accent: "#e5e7eb",
    weapons: [{ kind: "sword", damage: 8.5, reach: 1.9, color: "#d4d4d8" }],
    stats: S({ damage: 0.94 }),
    ability: { name: "Ghost", charge: 9, effects: [{ p: "summon", n: 1, dur: 4, damage: 6, size: 0.7, shape: "wolf" }] },
    description: "A longsword; Ghost, his white wolf, joins the fight for four seconds.",
  },
  {
    id: "nightking",
    name: "Night King",
    division: "tv",
    source: "Game of Thrones (TV show)",
    body: "#93c5fd",
    accent: "#e0f2fe",
    weapons: [{ kind: "bow", shape: "icespear", cooldown: 2.0, damage: 12, speed: 0.95, size: 0.2, color: "#bae6fd" }],
    stats: S({ speed: 0.9, damage: 1.39 }),
    ability: { name: "Raise the Dead", charge: 11, effects: [{ p: "summon", n: 3, dur: 4, damage: 4, size: 0.55, shape: "wight" }] },
    description: "Throws slow, heavy ice spears; Raise the Dead summons three wights for four seconds.",
  },

  /* ---------------------------------------------------------------- WILDCARD */
  {
    id: "gerald",
    name: "Gerald",
    division: "wildcard",
    source: "This site's own ball",
    body: "#93d119",
    accent: "#f8fafc",
    weapons: [{ kind: "fists", count: 1, reach: 0.45, cooldown: 0.5, damage: 7, shape: "air" }],
    stats: S(),
    ability: {
      name: "Mega Bounce",
      charge: 9,
      effects: [
        { p: "speedBurst", mult: 2, dur: 3 },
        { p: "damageBurst", mult: 2, dur: 3 },
      ],
    },
    description: "Our own ball headbutts its way through the league; Mega Bounce doubles its speed and damage for three seconds.",
  },
];

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

/** The weapon spec with every default filled in. */
export function weaponOf(spec: FlWeaponSpec): Required<Omit<FlWeaponSpec, "color">> & { color: string | undefined } {
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

/** The matchup presets of the panel (every pair in its genre); `fighters` fill the slots A–D, `match` the match type. */
export interface FlPreset {
  id: string;
  /** English label (fighter names are proper names; the panel shows it as is). */
  label: string;
  fighters: readonly string[];
  match: "1v1" | "2v2" | "ffa3" | "ffa4";
}

export const FL_PRESETS: readonly FlPreset[] = [
  { id: "thor-loki", label: "Thor vs Loki", fighters: ["thor", "loki"], match: "1v1" },
  { id: "falcon-mac", label: "Captain Falcon vs Little Mac", fighters: ["captainfalcon", "littlemac"], match: "1v1" },
  { id: "yuumi-katarina", label: "Yuumi vs Katarina", fighters: ["yuumi", "katarina"], match: "1v1" },
  { id: "batman-joker", label: "Batman vs Joker", fighters: ["batman", "joker"], match: "1v1" },
  { id: "goku-vegeta", label: "Goku vs Vegeta", fighters: ["goku", "vegeta"], match: "1v1" },
  { id: "luke-vader", label: "Luke Skywalker vs Darth Vader", fighters: ["luke", "vader"], match: "1v1" },
  { id: "mario-sonic", label: "Mario vs Sonic", fighters: ["mario", "sonic"], match: "1v1" },
  { id: "harry-voldemort", label: "Harry Potter vs Voldemort", fighters: ["harrypotter", "voldemort"], match: "1v1" },
  { id: "scorpion-subzero", label: "Scorpion vs Sub-Zero", fighters: ["scorpion", "subzero"], match: "1v1" },
  { id: "godzilla-kong", label: "Godzilla vs King Kong", fighters: ["godzilla", "kingkong"], match: "1v1" },
  { id: "alien-predator", label: "Alien vs Predator", fighters: ["alien", "predator"], match: "1v1" },
  { id: "homelander-omniman", label: "Homelander vs Omni-Man", fighters: ["homelander", "omniman"], match: "1v1" },
  { id: "avengers", label: "Avengers free-for-all", fighters: ["thor", "ironman", "captainamerica", "hulk"], match: "ffa4" },
  { id: "naruto-dbz", label: "2v2: Naruto + Sasuke vs Goku + Vegeta", fighters: ["naruto", "sasuke", "goku", "vegeta"], match: "2v2" },
];
