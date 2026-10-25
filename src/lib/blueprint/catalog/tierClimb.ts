/*
 * --- blueprint --- Catalog: Tier Climb (merge). Orbs rain into a bowl; two orbs of the same tier that touch merge into one
 * of the next tier, bigger and in the next colour, with a note a step higher. The run ends when an orb reaches tier 8.
 * --- review fix (blueprint) --- The sliders stay where the game can end: a tier-n orb takes 2^(n−1) orbs and the rain
 * stops at 400 (the ball ceiling), so tier 8 (128) is the highest it reaches – tier 9 never did on any seed – and tier 6
 * the lowest that lasts a clip (tier 5 is over in 3 s); a rain slower than an orb every 0.25 s, or gravity under 200, left
 * a seed short of the target at the timeout.
 */
export const tierClimb = {
  v: 1,
  meta: { name: "Tier Climb", description: "Orbs rain down and two of a tier merge into the next. The first to the target tier ends it.", family: "rhythm", author: "builtin" },
  arena: { shape: "circle", size: 0.92, restitution: 0.55, gravity: { x: 0, y: 520 } },
  bodies: [{ id: "orb", radius: 9, color: 0 }],
  spawners: [{ body: "orb", at: "top", count: 1, speed: 80, dir: "down", everySec: 0.08, maxTotal: 400 }],
  rules: [{ when: "ballHit", with: "sameTier", do: [{ act: "merge", scale: 1.24 }, { act: "recolor", color: "tier" }] }],
  finish: { any: [{ when: "tier", atLeast: 8, say: "TIER {tier} REACHED" }], timeoutSec: 120, timeoutSay: "TOP TIER {tier}" },
  hud: [{ show: "tier", label: "top tier" }, { show: "balls", label: "orbs" }],
  look: { palette: ["#ff4d6d", "#ff922b", "#ffd43b", "#51cf66", "#22d3ee", "#b197fc"] },
  sound: { scale: "pentatonic", root: 5, voices: { ballHit: "none", wallHit: "none" } },
  params: [
    { id: "target", label: "target tier", at: "finish.any[0].atLeast", min: 6, max: 8, step: 1 },
    { id: "rain", label: "seconds per orb", at: "spawners[0].everySec", min: 0.04, max: 0.25, step: 0.01 },
    { id: "gravity", label: "gravity", at: "arena.gravity.y", min: 200, max: 1200, step: 20 },
  ],
} as const;
