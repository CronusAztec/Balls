import type { FlFighterRow } from "../fightLeagueRoster";
import { S } from "./kit";

/**
 * Fight League rows – Nintendo & Sega (video games). --- fl-overhaul --- (Stage 2: one exported FlFighterRow[] per division,
 * at most 10 rows; the index is fightLeagueRoster.ts.)
 *
 * IP AVOID-LIST for every look in this file: no emblems, no letters, no web lines, no bat or bolt marks, no letter shields, no
 * red-white split balls, no face markings. A body is a ball in a palette with one of our own patterns and crests; the NAME
 * identifies the fighter, the look only adds flavour. Names, sources and move names are plain text labels of an
 * unaffiliated fan simulation.
 */

const NINTENDO = "Nintendo (video games)";
const SEGA = "Sega (video games)";

export const FL_ROWS_NINTENDO: readonly FlFighterRow[] = [
  {
    id: "mario",
    name: "Mario",
    division: "nintendo",
    source: NINTENDO,
    body: "#e11d48",
    accent: "#2563eb",
    weapons: [{ kind: "gun", style: "bouncing", shape: "fireball", cooldown: 1.0, damage: 5, speed: 0.95, size: 0.22, color: "#f97316" }],
    stats: S({ damage: 0.71 }),
    ability: {
      name: "Super Star",
      charge: 10,
      effects: [
        { p: "invulnerable", dur: 3, contact: 8 },
        { p: "speedBurst", mult: 1.5, dur: 3 },
      ],
    },
    description: "Bouncing fireballs that ricochet off a wall once; Super Star makes him invulnerable for three seconds and every touch hurts.",
    role: "ranged",
    isNew: false,
    look: { pattern: "band", crest: "none" },
  },
  {
    id: "link",
    name: "Link",
    division: "nintendo",
    source: NINTENDO,
    body: "#15803d",
    accent: "#d4a373",
    weapons: [{ kind: "sword", damage: 8, color: "#e2e8f0", look: "blade" }],
    stats: S({ damage: 0.88 }), // --- fl-heavy --- (the tuner's 0.83 left most Spin Attacks missing in QA 9: 0.88 by hand, inside the gate)
    ability: { name: "Spin Attack", charge: 8, effects: [{ p: "shockwave", radius: 2.9, damage: 22.7, knockback: 1, spin: true }] }, // --- fl-heavy --- (20 per foe at the 0.88 stat; charge 8 kept: at 9 most Spin Attacks miss, QA 9)
    description: "A sword that sweeps a wide arc on every bounce. The Spin Attack whirls it all the way round and hits every foe in reach hard.",
    role: "duelist",
    isNew: false,
    look: { pattern: "hood", crest: "none" },
  },
  {
    id: "samus",
    name: "Samus",
    division: "nintendo",
    source: NINTENDO,
    body: "#ea580c",
    accent: "#84cc16",
    weapons: [{ kind: "gun", shape: "plasma", cooldown: 1.1, damage: 6, speed: 1.5, color: "#facc15", look: "cannon" }],
    stats: S({ damage: 1.04 }),
    ability: { name: "Charge Shot", charge: 10, effects: [{ p: "volley", n: 1, damage: 24, speed: 1.1, size: 0.9, shape: "charge", color: "#fde047" }] },
    description: "Her arm cannon fires a steady stream of shots; the Charge Shot is one huge, slow projectile.",
    role: "ranged",
    isNew: false,
    look: { pattern: "visor", crest: "none" },
  },
  {
    id: "captainfalcon",
    name: "Captain Falcon",
    short: "FALCON",
    division: "nintendo",
    source: NINTENDO,
    body: "#1e40af",
    accent: "#f59e0b",
    weapons: [{ kind: "fists", cooldown: 0.45, damage: 5 }],
    stats: S({ speed: 1.3, damage: 0.62 }),
    ability: { name: "Falcon Punch", charge: 13, ultimate: true, effects: [{ p: "giantHit", mult: 1, maxHpFrac: 0.5, knockback: 4 }] }, // --- fl-heavy --- (half the foe's maximum HP: exactly 50 at HP 100)
    description: "Fast fists and a fast car's worth of speed. The Falcon Punch takes half the foe's maximum HP in one blow.",
    role: "bruiser",
    isNew: false,
    look: { pattern: "visor", crest: "none" },
  },
  {
    id: "littlemac",
    name: "Little Mac",
    division: "nintendo",
    source: NINTENDO,
    body: "#22c55e",
    accent: "#111827",
    weapons: [{ kind: "fists", cooldown: 0.28, damage: 3.2, reach: 0.8 }],
    stats: S({ speed: 1.25, damage: 0.83, size: 0.92 }),
    ability: { name: "Star Punch", charge: 10, effects: [{ p: "giantHit", mult: 1, maxHpFrac: 0.25, freeze: 1 }] }, // --- fl-heavy --- (a quarter of the foe's maximum HP)
    description: "A blur of very fast, very light jabs. The Star Punch takes a quarter of the foe's maximum HP and freezes the foe for a second.",
    role: "duelist",
    isNew: false,
    look: { pattern: "ring", crest: "none" },
  },
  {
    id: "sonic",
    name: "Sonic",
    division: "nintendo",
    source: SEGA,
    body: "#2563eb",
    accent: "#ef4444",
    weapons: [{ kind: "fists", style: "contact", reach: 0.15, cooldown: 0.3, damage: 4, size: 0.3 }],
    stats: S({ speed: 1.8, damage: 0.98 }),
    ability: {
      name: "Spin Dash",
      charge: 9,
      effects: [
        { p: "speedBurst", mult: 3, dur: 2 },
        { p: "damageBurst", mult: 2, dur: 2 },
      ],
    },
    description: "The fastest fighter in the league hits by running into you; the Spin Dash triples his speed and doubles his damage.",
    role: "duelist",
    isNew: false,
    look: { pattern: "core", crest: "spikes", trail: "#60a5fa" },
  },
  {
    id: "kirby",
    name: "Kirby",
    division: "nintendo",
    source: NINTENDO,
    body: "#f9a8d4",
    accent: "#dc2626",
    weapons: [{ kind: "hammer", cooldown: 1.4, damage: 9, knockback: 1.4, look: "mallet" }],
    stats: S({ hp: 95, speed: 1.3, size: 0.8, damage: 1.36 }),
    ability: {
      name: "Inhale",
      charge: 9,
      effects: [
        { p: "pull", strength: 2.4 },
        { p: "choke", dur: 1.2, damage: 10, at: "end" },
      ],
    },
    description: "A round little hammer-swinger; Inhale sucks the nearest foe in, holds it and spits it back out.",
    role: "glass",
    isNew: true,
    look: { pattern: "ring", crest: "none" },
  },
  {
    id: "donkeykong",
    name: "Donkey Kong",
    short: "DK",
    division: "nintendo",
    source: NINTENDO,
    body: "#7c4a2d",
    accent: "#dc2626",
    weapons: [{ kind: "fists", cooldown: 0.9, damage: 10, knockback: 1.8, size: 0.5 }],
    stats: S({ hp: 115, speed: 0.85, size: 1.15, damage: 0.65 }),
    ability: { name: "Hand Slap", charge: 10, effects: [{ p: "shockwave", radius: 4, damage: 30.8, knockback: 2 }] }, // --- fl-heavy --- (20 per foe at the 0.65 stat)
    description: "Huge, heavy punches; the Hand Slap pounds the ground and throws back every foe nearby.",
    role: "tank",
    isNew: true,
    look: { pattern: "band", crest: "tuft" },
  },
  {
    id: "bowser",
    name: "Bowser",
    division: "nintendo",
    source: NINTENDO,
    body: "#65a30d",
    accent: "#f97316",
    weapons: [{ kind: "fire", cooldown: 1.6, reach: 3, damage: 3.5 }],
    stats: S({ hp: 125, speed: 0.8, size: 1.2, damage: 1.07 }),
    ability: { name: "Giga Bowser", charge: 13, ultimate: true, effects: [{ p: "transform", size: 1.4, damage: 1.6, speed: 0.85, dur: 5 }] },
    description: "The Koopa King breathes fire; Giga Bowser makes him huge and hits half again as hard for five seconds.",
    role: "tank",
    isNew: true,
    look: { pattern: "dots", crest: "horns" },
  },
  {
    id: "shadow",
    name: "Shadow",
    division: "nintendo",
    source: SEGA,
    body: "#111827",
    accent: "#dc2626",
    weapons: [{ kind: "gun", shape: "spearbolt", cooldown: 0.8, damage: 5, speed: 1.8, spread: 2, color: "#fde047" }],
    stats: S({ speed: 1.5, damage: 0.83 }),
    ability: { name: "Chaos Control", charge: 12, effects: [{ p: "freezeAll", dur: 1.5 }] },
    description: "Sonic's rival hurls Chaos Spears; Chaos Control stops every foe in time.",
    role: "ranged",
    isNew: true,
    look: { pattern: "stripes", crest: "spikes", trail: "#ef4444" },
  },
];
