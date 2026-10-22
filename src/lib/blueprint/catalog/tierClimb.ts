/*
 * --- blueprint --- Catalog: Tier Climb (merge). Orbs rain into a bowl; two orbs of the same tier that touch merge into one
 * of the next tier, bigger and in the next colour. The run ends when an orb reaches tier 8.
 */
export const tierClimb = {
  v: 1,
  meta: { name: "Tier Climb", description: "Orbs rain down and two of a tier merge into the next. First to tier 8 ends it.", family: "rhythm", author: "builtin" },
  arena: { shape: "circle", size: 0.92, restitution: 0.55, gravity: { x: 0, y: 520 } },
  bodies: [{ id: "orb", radius: 9, color: 0 }],
  spawners: [{ body: "orb", at: "top", count: 1, speed: 80, dir: "down", everySec: 0.12, maxTotal: 400 }],
  rules: [{ when: "ballHit", with: "sameTier", do: [{ act: "merge", scale: 1.24 }, { act: "recolor", color: "tier" }] }],
  finish: { any: [{ when: "tier", atLeast: 8, say: "TIER 8 REACHED" }], timeoutSec: 120, timeoutSay: "TOP TIER {tier}" },
  hud: [{ show: "tier", label: "top tier" }, { show: "balls", label: "orbs" }],
  look: { palette: ["#ff4d6d", "#ff922b", "#ffd43b", "#51cf66", "#22d3ee", "#b197fc"] },
  sound: { scale: "pentatonic", root: 5, voices: { ballHit: "none", wallHit: "none" } },
} as const;
