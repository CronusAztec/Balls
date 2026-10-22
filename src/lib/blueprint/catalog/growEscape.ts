/*
 * --- blueprint --- Catalog: Grow or Go (escape). One ball, one gap in a turning rim; every bounce makes the ball bigger. It
 * has to find the gap before it no longer fits through.
 */
export const growEscape = {
  v: 1,
  meta: { name: "Grow or Go", description: "Every bounce makes the ball bigger. Can it find the gap before it no longer fits?", family: "escape", author: "builtin" },
  arena: { shape: "circle", size: 0.92, spinDegPerSec: 30, exits: [{ atDeg: 60, widthDeg: 18 }] },
  bodies: [{ id: "ball", radius: 9, color: 3 }],
  vars: [{ id: "bounces" }],
  spawners: [{ body: "ball", at: "top", count: 1, speed: 420, dir: "up" }],
  rules: [
    { when: "wallHit", do: [{ act: "grow", by: 1 }, { act: "speed", scale: 1.015 }, { act: "var", id: "bounces", op: "add", value: 1 }] },
    { when: "beat", do: [{ act: "sound", voice: "gap", pitch: -7 }] },
  ],
  finish: {
    any: [
      { when: "escaped", say: "ESCAPED AFTER {bounces} BOUNCES" },
      { when: "count", what: "bounces", atLeast: 26, say: "TOO BIG TO ESCAPE" },
    ],
    timeoutSec: 60,
  },
  hud: [{ show: "bounces", label: "bounces" }, { show: "time", label: "time" }],
  look: { trail: true, rim: 1 },
  sound: { scale: "major", root: 0, bpm: 100 },
} as const;
