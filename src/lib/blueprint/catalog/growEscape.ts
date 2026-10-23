/*
 * --- blueprint --- Catalog: Grow or Go (escape). One ball, one gap in a turning rim; every bounce makes the ball bigger and
 * faster. It has to find the gap before it no longer fits through: two endings, and the seed decides which (24 of seeds
 * 1-40 escape). --- review fix (blueprint) --- It starts slow at the top with the exit at the bottom, so it is never out in
 * its first 6 s (seeds 1-40: the earliest at 6.25 s, the longest run 23 s), and it loses on the bounce it stops fitting: a
 * 21° exit of the 207 px rim lets a ball of up to 35 px through, and an 8 px ball growing 1 px a bounce outgrows it on
 * bounce 28.
 */
export const growEscape = {
  v: 1,
  meta: { name: "Grow or Go", description: "Every bounce makes the ball bigger and faster. Can it find the gap before it no longer fits?", family: "escape", author: "builtin" },
  arena: { shape: "circle", size: 0.92, spinDegPerSec: 40, exits: [{ atDeg: 180, widthDeg: 21 }] },
  bodies: [{ id: "ball", radius: 8, color: 3 }],
  vars: [{ id: "bounces" }],
  spawners: [{ body: "ball", at: "top", count: 1, speed: 110, dir: "up" }],
  rules: [
    { when: "wallHit", do: [{ act: "grow", by: 1 }, { act: "speed", scale: 1.15 }, { act: "var", id: "bounces", op: "add", value: 1 }] },
    { when: "beat", do: [{ act: "sound", voice: "gap", pitch: -7 }] },
  ],
  finish: {
    any: [
      { when: "escaped", say: "ESCAPED AFTER BOUNCE {bounces}" },
      { when: "count", what: "bounces", atLeast: 28, say: "TOO BIG TO ESCAPE" },
    ],
    timeoutSec: 60,
  },
  hud: [{ show: "bounces", label: "bounces" }, { show: "time", label: "time" }],
  look: { trail: true, rim: 1 },
  sound: { scale: "major", root: 0, bpm: 100 },
  params: [
    { id: "grow", label: "grow per bounce", at: "rules[0].do[0].by", min: 0.2, max: 3, step: 0.1 },
    { id: "exit", label: "exit width", at: "arena.exits[0].widthDeg", min: 8, max: 40, step: 1 },
    { id: "limit", label: "bounces to lose", at: "finish.any[1].atLeast", min: 10, max: 60, step: 1 },
  ],
} as const;
