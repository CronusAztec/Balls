import type { FlFighterRow } from "../fightLeagueRoster";
import { S } from "./kit";

/**
 * Fight League rows – Wildcard: the site's own ball, Gerald, alone in its division (the owner's rule: a random slot next to
 * Gerald draws from every other division). --- fl-overhaul --- (Stage 2: one exported FlFighterRow[] per division; the index is
 * fightLeagueRoster.ts.)
 *
 * IP AVOID-LIST for every look in this file: no emblems, no letters, no web lines, no bat or bolt marks, no letter shields, no
 * red-white split balls, no face markings. A body is a ball in a palette with one of our own patterns and crests; the NAME
 * identifies the fighter, the look only adds flavour.
 */

export const FL_ROWS_WILDCARD: readonly FlFighterRow[] = [
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
    role: "duelist",
    isNew: false,
    look: { pattern: "ring", crest: "none" },
  },
];
