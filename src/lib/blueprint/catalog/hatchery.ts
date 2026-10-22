/*
 * --- blueprint --- Catalog: Glass Hatchery (break the layers, then multiply). One ball in a shell of glass; every tile it
 * breaks hatches a new ball where the tile was, so the cracking speeds up until the last tile goes.
 */
export const hatchery = {
  v: 1,
  meta: { name: "Glass Hatchery", description: "Every glass tile a ball breaks hatches a new ball. One ball becomes a swarm before the shell is gone.", family: "escape", author: "builtin" },
  arena: { shape: "circle", size: 0.92 },
  bodies: [{ id: "ball", radius: 8, color: 1 }],
  tiles: { layout: "ring", rows: 6, cols: 24, hp: 1, hpStep: 2, style: "glass", pitchBy: "col", inner: 0.3, outer: 0.88 },
  spawners: [{ body: "ball", at: "center", count: 1, speed: 260 }],
  rules: [{ when: "tileBroken", do: [{ act: "spawn", body: "ball", at: "tile", count: 1, speed: 150 }, { act: "recolor", color: "random" }] }],
  finish: { any: [{ when: "tilesCleared", say: "SHELL CLEARED" }], timeoutSec: 60, timeoutSay: "STILL IN THE SHELL" },
  hud: [{ show: "tiles", label: "tiles" }, { show: "balls", label: "balls" }],
  look: { trail: true, rim: 5 },
  sound: { scale: "pentatonic", root: 2 },
} as const;
