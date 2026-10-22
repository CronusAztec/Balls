/*
 * --- blueprint --- Catalog: Glass Hatchery (break the layers, then multiply). One ball in a shell of glass, six layers deep,
 * each layer tougher than the last; every tile it breaks hatches a new ball where the tile was, so the cracking speeds up
 * until the last tile goes. The breaks are heard (a chime climbing round the shell); the swarm's bounces are not.
 */
export const hatchery = {
  v: 1,
  meta: { name: "Glass Hatchery", description: "Every glass tile a ball breaks hatches a new ball. One ball becomes a swarm before the shell is gone.", family: "escape", author: "builtin" },
  arena: { shape: "circle", size: 0.92 },
  bodies: [{ id: "ball", radius: 8, color: 1 }],
  tiles: { layout: "ring", rows: 6, cols: 20, hp: 2, hpStep: 3, style: "glass", pitchBy: "col", inner: 0.3, outer: 0.88 },
  spawners: [{ body: "ball", at: "center", count: 1, speed: 240 }],
  rules: [{ when: "tileBroken", do: [{ act: "spawn", body: "ball", at: "tile", count: 1, speed: 150 }, { act: "recolor", color: "random" }] }],
  finish: { any: [{ when: "tilesCleared", say: "SHELL CLEARED" }], timeoutSec: 60, timeoutSay: "STILL IN THE SHELL" },
  hud: [{ show: "tiles", label: "tiles" }, { show: "balls", label: "balls" }],
  look: { trail: true, rim: 5 },
  sound: { scale: "pentatonic", root: 2, voices: { wallHit: "none", ballHit: "none" } },
  params: [
    { id: "layers", label: "layers", at: "tiles.rows", min: 2, max: 10, step: 1 },
    { id: "glass", label: "glass strength", at: "tiles.hp", min: 1, max: 6, step: 1 },
    { id: "speed", label: "ball speed", at: "spawners[0].speed", min: 100, max: 600, step: 10 },
  ],
} as const;
