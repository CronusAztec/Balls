/*
 * --- blueprint --- Catalog: Ring Breaker (escape and multiply). One ball inside eight spinning rings; every ring a ball gets
 * through shatters and every ball splits in two, so the swarm doubles with each ring until the last one falls. The ball
 * starts up through the first gap (the hook: a ring breaks at once) with a small sideways kick – a path straight out from
 * the centre would bounce back along itself forever – at a speed and a kick the seed picks.
 */
export const ringBreaker = {
  v: 1,
  meta: { name: "Ring Breaker", description: "Every ring a ball gets through shatters and doubles every ball. Break all eight.", family: "escape", author: "builtin" },
  arena: { shape: "rings", size: 0.92, rings: { count: 8, gapDeg: 28, spinDegPerSec: 30, alternate: true, breakOnPass: true, inner: 0.2 } },
  bodies: [{ id: "ball", radius: 7, color: 5 }],
  spawners: [{ body: "ball", at: "center", count: 1, speed: "260 + 80 * r", dir: "up" }],
  rules: [
    { when: "start", do: [{ act: "impulse", target: "all", dir: "right", amount: "15 + 25 * r" }] },
    { when: "ringPass", do: [{ act: "split", target: "all", into: 2 }, { act: "recolor", color: "next" }, { act: "fx", kind: "burst" }] },
  ],
  finish: { any: [{ when: "ringsCleared", say: "ALL RINGS DOWN" }], timeoutSec: 60, timeoutSay: "{rings} RINGS LEFT" },
  hud: [{ show: "rings", label: "rings" }, { show: "balls", label: "balls" }],
  look: { trail: true, rim: 5 },
  sound: { scale: "minor", root: 4 },
  params: [
    { id: "rings", label: "rings", at: "arena.rings.count", min: 3, max: 8, step: 1 },
    { id: "gap", label: "gap", at: "arena.rings.gapDeg", min: 15, max: 60, step: 1 },
    { id: "spin", label: "ring spin", at: "arena.rings.spinDegPerSec", min: 0, max: 120, step: 5 },
  ],
} as const;
