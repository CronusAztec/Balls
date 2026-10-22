/*
 * --- blueprint --- Catalog: Ring Breaker (escape and multiply). One ball inside seven spinning rings; every ring a ball passes
 * through shatters and every ball splits in two, so the swarm doubles with each ring until the last one falls.
 */
export const ringBreaker = {
  v: 1,
  meta: { name: "Ring Breaker", description: "Every ring a ball gets through shatters and doubles every ball. Break all seven.", family: "escape", author: "builtin" },
  arena: { shape: "rings", size: 0.92, rings: { count: 7, gapDeg: 32, spinDegPerSec: 45, alternate: true, breakOnPass: true, inner: 0.24 } },
  bodies: [{ id: "ball", radius: 7, color: 5 }],
  spawners: [{ body: "ball", at: "center", count: 1, speed: 300 }],
  rules: [{ when: "ringPass", do: [{ act: "split", target: "all", into: 2 }, { act: "recolor", color: "next" }, { act: "fx", kind: "burst" }] }],
  finish: { any: [{ when: "ringsCleared", say: "ALL RINGS DOWN" }], timeoutSec: 60, timeoutSay: "{rings} RINGS LEFT" },
  hud: [{ show: "rings", label: "rings" }, { show: "balls", label: "balls" }],
  look: { trail: true, rim: 5 },
  sound: { scale: "minor", root: 4 },
} as const;
