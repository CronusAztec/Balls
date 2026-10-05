import type { FlFighterRow } from "../fightLeagueRoster";
import { S } from "./kit";

/**
 * Fight League rows – Fighting games (Street Fighter, Mortal Kombat, Tekken). --- fl-overhaul --- (Stage 2: one exported
 * FlFighterRow[] per division, at most 10 rows; the index is fightLeagueRoster.ts. Everyone stays near HP 100 for a fair
 * fighting-game feel: this division has no tank and no glass cannon.)
 *
 * IP AVOID-LIST for every look in this file: no emblems, no letters, no web lines, no bat or bolt marks, no letter shields, no
 * red-white split balls, no face markings. A body is a ball in a palette with one of our own patterns and crests; the NAME
 * identifies the fighter, the look only adds flavour. Names, sources and move names are plain text labels of an
 * unaffiliated fan simulation.
 */

const CAPCOM = "Street Fighter (video games)";
const MK = "Mortal Kombat (video games)";
const TEKKEN = "Tekken (video games)";

export const FL_ROWS_FIGHTING: readonly FlFighterRow[] = [
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
    stats: S({ damage: 0.68 }),
    ability: { name: "Shoryuken", charge: 9, effects: [{ p: "giantHit", mult: 3, knockback: 2.5 }] },
    description: "Fists and a slow Hadouken fireball; the Shoryuken triples his next hit and launches the foe.",
    role: "duelist",
    isNew: false,
    look: { pattern: "band", crest: "none" },
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
    stats: S({ speed: 1.05, damage: 0.61 }),
    ability: { name: "Shoryureppa", charge: 9, effects: [{ p: "giantHit", mult: 2, count: 3, knockback: 1.5 }] },
    description: "Faster fists and a flaming Hadouken; the Shoryureppa makes his next three hits double.",
    role: "duelist",
    isNew: false,
    look: { pattern: "band", crest: "tuft" },
  },
  {
    id: "chunli",
    name: "Chun-Li",
    division: "fighting",
    source: CAPCOM,
    body: "#2563eb",
    accent: "#fbbf24",
    weapons: [{ kind: "fists", shape: "kicks", cooldown: 0.32, damage: 4, reach: 1.0 }],
    stats: S({ speed: 1.3, damage: 0.93 }),
    ability: { name: "Spinning Bird Kick", charge: 9, effects: [{ p: "fireRing", radius: 2.6, damage: 5, dur: 2, shape: "kicks" }] },
    description: "Lightning-fast kicks; the Spinning Bird Kick turns her into a ring of kicks for two seconds.",
    role: "duelist",
    isNew: false,
    look: { pattern: "dots", crest: "points" },
  },
  {
    id: "scorpion",
    name: "Scorpion",
    division: "fighting",
    source: MK,
    body: "#facc15",
    accent: "#111827",
    weapons: [{ kind: "chain", style: "pull", reach: 1.4, cooldown: 1.0, throwEvery: 2.2, damage: 8 }],
    stats: S({ damage: 0.82 }),
    ability: { name: "Hellfire", charge: 10, effects: [{ p: "fireRing", radius: 3.2, damage: 6, dur: 2.5 }] },
    description: "His spear on a chain drags the hit foe to him; Hellfire burns everything around him.",
    role: "control",
    isNew: false,
    look: { pattern: "hood", crest: "none" },
  },
  {
    id: "subzero",
    name: "Sub-Zero",
    division: "fighting",
    source: MK,
    body: "#2563eb",
    accent: "#bae6fd",
    weapons: [{ kind: "ice", cooldown: 1.8, damage: 5 }],
    stats: S({ damage: 1.62 }),
    ability: { name: "Ice Clone", charge: 9, effects: [{ p: "decoys", n: 1, dur: 4, freezeOnTouch: 1.5 }] },
    description: "Ice shots freeze the foe they hit for a second; the Ice Clone freezes whoever touches it.",
    role: "control",
    isNew: false,
    look: { pattern: "hood", crest: "none", glow: "#bae6fd" },
  },
  {
    id: "akuma",
    name: "Akuma",
    division: "fighting",
    source: CAPCOM,
    body: "#374151",
    accent: "#7e22ce",
    weapons: [
      { kind: "fists", cooldown: 0.45, damage: 6.5 },
      { kind: "gun", shape: "hadouken", cooldown: 2.4, damage: 8, speed: 0.85, size: 0.55, spread: 0, color: "#a855f7" },
    ],
    stats: S({ hp: 95, damage: 0.59 }),
    ability: { name: "Raging Demon", charge: 10, effects: [{ p: "blinkStrike", n: 1, damage: 22 }] },
    description: "Harder fists and a purple fireball; the Raging Demon teleports onto the foe in one devastating flurry.",
    role: "duelist",
    isNew: true,
    look: { pattern: "band", crest: "spikes" },
  },
  {
    id: "liukang",
    name: "Liu Kang",
    division: "fighting",
    source: MK,
    body: "#b91c1c",
    accent: "#111827",
    weapons: [
      { kind: "fists", shape: "kicks", cooldown: 0.4, damage: 5, reach: 1.0 },
      { kind: "gun", shape: "fireball", cooldown: 2.6, damage: 7, speed: 0.9, size: 0.45, spread: 0, color: "#f97316" },
    ],
    stats: S({ damage: 0.67 }),
    ability: {
      name: "Bicycle Kick",
      charge: 9,
      effects: [
        { p: "attackSpeedBurst", mult: 3, dur: 2 },
        { p: "speedBurst", mult: 1.5, dur: 2 },
      ],
    },
    description: "Shaolin kicks and dragon fireballs; the Bicycle Kick is a two-second storm of kicks.",
    role: "duelist",
    isNew: true,
    look: { pattern: "band", crest: "tuft" },
  },
  {
    id: "raiden",
    name: "Raiden",
    division: "fighting",
    source: MK,
    body: "#e5e7eb",
    accent: "#38bdf8",
    weapons: [{ kind: "spark", reach: 2.6, cooldown: 0.8, damage: 5, color: "#38bdf8" }],
    stats: S({ damage: 1.33 }),
    ability: {
      name: "Electric Fly",
      charge: 9,
      effects: [
        { p: "speedBurst", mult: 3, dur: 1 },
        { p: "giantHit", mult: 2.5 },
      ],
    },
    description: "The thunder god arcs lightning at any foe in range; Electric Fly torpedoes him into the foe.",
    role: "duelist",
    isNew: true,
    look: { pattern: "ring", crest: "halo", glow: "#38bdf8" },
  },
  {
    id: "kazuya",
    name: "Kazuya",
    division: "fighting",
    source: TEKKEN,
    body: "#111827",
    accent: "#a855f7",
    weapons: [{ kind: "fists", cooldown: 0.55, damage: 7, knockback: 1.2 }],
    stats: S({ hp: 105, speed: 0.9, damage: 0.74 }),
    ability: { name: "Electric Wind God Fist", charge: 9, effects: [{ p: "giantHit", mult: 3, freeze: 0.6 }] },
    description: "Heavy Tekken punches; the Electric Wind God Fist triples his next hit and stuns the foe.",
    role: "bruiser",
    isNew: true,
    look: { pattern: "band", crest: "spikes" },
  },
];
