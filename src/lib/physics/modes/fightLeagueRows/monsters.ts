import type { FlFighterRow } from "../fightLeagueRoster";
import { S } from "./kit";

/**
 * Fight League rows – Movie monsters (Godzilla, King Kong, Alien, Predator, Jurassic Park, Jaws). --- fl-overhaul --- (Stage 2:
 * one exported FlFighterRow[] per division, at most 10 rows; the index is fightLeagueRoster.ts.)
 *
 * IP AVOID-LIST for every look in this file: no emblems, no letters, no web lines, no bat or bolt marks, no letter shields, no
 * red-white split balls, no face markings. A body is a ball in a palette with one of our own patterns and crests; the NAME
 * identifies the fighter, the look only adds flavour. Names, sources and move names are plain text labels of an
 * unaffiliated fan simulation.
 */

export const FL_ROWS_MONSTERS: readonly FlFighterRow[] = [
  {
    id: "godzilla",
    name: "Godzilla",
    division: "monsters",
    source: "Godzilla (movies)",
    body: "#3f4b3a",
    accent: "#22d3ee",
    weapons: [{ kind: "tail", reach: 2.4, cooldown: 1.0, damage: 9, knockback: 1.4 }],
    stats: S({ hp: 120, speed: 0.8, damage: 0.87, size: 1.2 }),
    ability: { name: "Atomic Breath", charge: 11, effects: [{ p: "beam", dur: 1.3, width: 1.2, damage: 8, color: "#38bdf8" }] },
    description: "A long tail sweeping behind him; Atomic Breath is a blue beam.",
    role: "tank",
    isNew: false,
    look: { pattern: "dots", crest: "spikes" },
  },
  {
    id: "kingkong",
    name: "King Kong",
    division: "monsters",
    source: "King Kong (movies)",
    body: "#5b3a29",
    accent: "#a8a29e",
    weapons: [{ kind: "fists", cooldown: 0.9, damage: 11, knockback: 2, size: 0.5 }],
    stats: S({ hp: 115, speed: 0.95, damage: 0.66, size: 1.15 }),
    ability: { name: "Chest Beat", charge: 10, effects: [{ p: "damageBurst", mult: 2, dur: 3, knockback: 2 }] },
    description: "Slow, heavy fists; the Chest Beat doubles his damage and knockback for three seconds.",
    role: "bruiser",
    isNew: false,
    look: { pattern: "core", crest: "none" },
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
    stats: S({ hp: 95, speed: 1.3, damage: 1.13, size: 0.9 }),
    ability: { name: "Acid Blood", charge: 9, effects: [{ p: "reflect", dur: 4, frac: 0.6 }] },
    description: "Claws in front and a tail behind; Acid Blood burns every attacker for four seconds.",
    role: "glass",
    isNew: false,
    look: { pattern: "stripes", crest: "points" },
  },
  {
    id: "predator",
    name: "Predator",
    division: "monsters",
    source: "Predator (movies)",
    body: "#8a7f4f",
    accent: "#dc2626",
    weapons: [
      { kind: "gun", shape: "plasma", cooldown: 1.6, damage: 8, homing: 1, speed: 1.2, color: "#60a5fa", look: "cannon" },
      { kind: "claws", damage: 3 },
    ],
    stats: S({ damage: 0.76 }),
    ability: { name: "Cloak", charge: 10, effects: [{ p: "invulnerable", dur: 2.5, untargetable: true }] },
    description: "A shoulder plasma caster and wrist blades; Cloak makes him invulnerable and untargetable.",
    role: "ranged",
    isNew: false,
    look: { pattern: "dots", crest: "tuft" },
  },
  {
    id: "trex",
    name: "T-Rex",
    division: "monsters",
    source: "Jurassic Park (movies)",
    body: "#6b8e23",
    accent: "#78350f",
    weapons: [{ kind: "claws", count: 1, cooldown: 0.6, reach: 0.8, damage: 9, knockback: 0.8, size: 0.5 }],
    stats: S({ hp: 115, speed: 0.85, size: 1.15, damage: 0.77 }),
    ability: { name: "Roar", charge: 11, effects: [{ p: "freezeAll", dur: 1.2 }] },
    description: "Bone-crushing bites; its Roar freezes every foe where it stands.",
    role: "tank",
    isNew: true,
    look: { pattern: "stripes", crest: "spikes" },
  },
  {
    id: "jaws",
    name: "Jaws",
    division: "monsters",
    source: "Jaws (movies)",
    body: "#64748b",
    accent: "#e5e7eb",
    weapons: [{ kind: "claws", count: 1, cooldown: 0.5, reach: 0.7, damage: 7, knockback: 0.5, size: 0.45 }],
    stats: S({ hp: 105, speed: 1.2, damage: 0.86 }),
    ability: {
      name: "Feeding Frenzy",
      charge: 9,
      effects: [
        { p: "drain", frac: 0.6, dur: 4 },
        { p: "attackSpeedBurst", mult: 1.5, dur: 4 },
      ],
    },
    description: "Lunging bites from below; Feeding Frenzy bites faster and heals him with every bite.",
    role: "bruiser",
    isNew: true,
    look: { pattern: "split", crest: "fins" },
  },
];
