import type { FlFighterRow } from "../fightLeagueRoster";
import { S } from "./kit";

/**
 * Fight League rows – Pokémon (video games & anime). --- fl-overhaul --- (Stage 2: a new division; Pikachu and Charizard moved
 * here from Game legends, their ids unchanged. One exported FlFighterRow[] per division, at most 10 rows; the index is
 * fightLeagueRoster.ts.)
 *
 * IP AVOID-LIST for every look in this file: no emblems, no letters, no web lines, no bat or bolt marks, no letter shields, no
 * red-white split balls (no capture-ball look on any body), no face markings (no cheeks, eyes or grins). A body is a ball in
 * a palette with one of our own patterns and crests; the NAME identifies the fighter, the look only adds flavour. Names,
 * sources and move names are plain text labels of an unaffiliated fan simulation.
 */

const POKEMON = "Pokémon (video games)";

export const FL_ROWS_POKEMON: readonly FlFighterRow[] = [
  {
    id: "pikachu",
    name: "Pikachu",
    division: "pokemon",
    source: POKEMON,
    body: "#facc15",
    accent: "#ef4444",
    weapons: [{ kind: "spark", reach: 2.8, cooldown: 0.75, damage: 5, color: "#fde047" }],
    stats: S({ hp: 95, speed: 1.3, damage: 1.19, size: 0.85 }),
    ability: { name: "Thunderbolt", charge: 11, effects: [{ p: "lightning", damage: 13 }] },
    description: "Short electric arcs at any foe in range; Thunderbolt strikes every foe with lightning.",
    role: "glass",
    isNew: false,
    look: { pattern: "stripes", crest: "ears" },
  },
  {
    id: "charizard",
    name: "Charizard",
    division: "pokemon",
    source: POKEMON,
    body: "#f97316",
    accent: "#0f766e",
    weapons: [{ kind: "fire", reach: 3.2, damage: 3 }],
    stats: S({ hp: 105, damage: 1.19, size: 1.1 }),
    ability: { name: "Blast Burn", charge: 11, effects: [{ p: "fireRing", radius: 3.6, damage: 6, dur: 2.5 }] },
    description: "Breathes a cone of fire ahead; Blast Burn sets the ground around him ablaze.",
    role: "bruiser",
    isNew: false,
    look: { pattern: "core", crest: "horns", trail: "#f97316" },
  },
  {
    id: "mewtwo",
    name: "Mewtwo",
    division: "pokemon",
    source: POKEMON,
    body: "#e9d5ff",
    accent: "#7e22ce",
    weapons: [{ kind: "staff", cooldown: 2.0, damage: 8, color: "#7e22ce" }],
    stats: S({ speed: 0.95, damage: 1.36 }),
    ability: { name: "Psystrike", charge: 11, effects: [{ p: "beam", dur: 1.2, width: 1.2, damage: 7, color: "#c084fc" }] },
    description: "Shadow Balls drift after the foe; Psystrike unleashes a wave of psychic power.",
    role: "ranged",
    isNew: true,
    look: { pattern: "core", crest: "horns", glow: "#c084fc" },
  },
  {
    id: "lucario",
    name: "Lucario",
    division: "pokemon",
    source: POKEMON,
    body: "#2563eb",
    accent: "#111827",
    weapons: [{ kind: "fists", cooldown: 0.45, damage: 5 }],
    stats: S({ speed: 1.1, damage: 1.06 }),
    ability: { name: "Aura Sphere", charge: 9, effects: [{ p: "volley", n: 1, damage: 18, speed: 1.0, size: 0.5, homing: 6, shape: "aura", color: "#60a5fa" }] },
    description: "Fast palm strikes; Aura Sphere is a homing blast that never misses.",
    role: "duelist",
    isNew: true,
    look: { pattern: "band", crest: "ears" },
  },
  {
    id: "greninja",
    name: "Greninja",
    division: "pokemon",
    source: POKEMON,
    body: "#1e3a8a",
    accent: "#93c5fd",
    weapons: [{ kind: "cards", shape: "shuriken", count: 4, cooldown: 0.8, damage: 5, color: "#93c5fd" }],
    stats: S({ hp: 95, speed: 1.3, damage: 1.01 }),
    ability: { name: "Hydro Pump", charge: 10, effects: [{ p: "beam", dur: 1, width: 1.1, damage: 7, color: "#60a5fa" }] },
    description: "Water shuriken orbit him and fly one by one; Hydro Pump blasts a jet of water.",
    role: "ranged",
    isNew: true,
    look: { pattern: "dots", crest: "points" },
  },
  {
    id: "gengar",
    name: "Gengar",
    division: "pokemon",
    source: POKEMON,
    body: "#6d28d9",
    accent: "#dc2626",
    weapons: [{ kind: "claws", cooldown: 0.3, damage: 3, reach: 0.5 }],
    stats: S({ damage: 1.71 }),
    ability: {
      name: "Dream Eater",
      charge: 9,
      effects: [
        { p: "drain", frac: 0.7, dur: 5 },
        { p: "confuse", dur: 1.5 },
      ],
    },
    description: "Shadow Claws at close range; Dream Eater lulls every foe and feeds on every hit it lands.",
    role: "control",
    isNew: true,
    look: { pattern: "ring", crest: "spikes" },
  },
  {
    id: "snorlax",
    name: "Snorlax",
    division: "pokemon",
    source: POKEMON,
    body: "#1e3a5f",
    accent: "#f5e6c8",
    weapons: [{ kind: "fists", style: "contact", reach: 0.15, cooldown: 0.7, damage: 9, knockback: 1.8, size: 0.4 }],
    stats: S({ hp: 130, speed: 0.7, size: 1.3, damage: 0.66 }),
    ability: { name: "Rest", charge: 10, effects: [{ p: "heal", amount: 40, dur: 3 }] },
    description: "The biggest ball in the league hits by body-slamming; Rest heals 40 HP over three seconds.",
    role: "tank",
    isNew: true,
    look: { pattern: "core", crest: "ears" },
  },
];
