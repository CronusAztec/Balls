/*
 * --- blueprint-catalog-c2 --- Catalog: Thin Ice (battle). Three colours, two balls each, bounce on one sheet of ice over
 * open water: every landing cracks the pane under it, and a pane that takes its last hit is gone. A ball that comes down on
 * a hole drops through it onto the water line just under the ice and is out at once (an obstacle hit removes it, with a
 * gap note and a burst). The last colour still on the ice wins. Only the landings on the ice are heard (a note each), the
 * breaks and the falls; the wall bounces and the balls' clashes are not.
 * --- review fix (C2) --- The ice runs from wall to wall (the panes whose middle falls outside the rim are not built, and
 * the gap left at either wall is narrower than a ball), so every ball out went through a hole: the old sheet stopped short
 * of the right wall, and 60 % of the outs slid off that fixed edge. A ball is out the moment it drops through, not when it
 * leaves the arena a second later, and a decided run breaks no more tiles (world.ts `holdTiles`), so the colour the banner
 * names keeps its balls on the ice under it. The colours start apart: one ball each on the left, at the top and on the
 * right, and the second of each (the `per` slider: 0 to 2 more) drops in at the middle 0.4 s after the one before it (never
 * two balls on one spot in the first frame).
 * The ice melts: every 10 s (the `melt` slider) each landing takes one more hit point, so two balls hopping on a patch that
 * holds can never stall the run. Seeds 1-100 headless (the portrait clip's world; the same within 0.4 s at 800 × 450): the
 * last colour stands 13.7-22.4 s in (median 17.6 s, 94 of 100 between 15 and 25 s), the first ball drops through 13.3 s in
 * at the median, every ball out went through a hole, the winner still has a ball on the ice 2 s after the banner in 98 of
 * 100, 3.1 sounds a second, and each colour wins 25 to 41 of the 100.
 */
export const thinIce = {
  v: 1,
  meta: { name: "Thin Ice", description: "Every bounce cracks the ice. Fall through and you are out. The last colour still dry wins.", family: "battle", author: "builtin" },
  arena: { shape: "circle", size: 0.95, gravity: { x: 0, y: 200 }, exits: [{ atDeg: 180, widthDeg: 110 }] },
  bodies: [
    { id: "green", radius: 15, color: 2, team: 2 },
    { id: "gold", radius: 15, color: 3, team: 3 },
    { id: "purple", radius: 15, color: 4, team: 4 },
  ],
  tiles: { layout: "grid", rows: 1, cols: 11, hp: 8, style: "glass", pitchBy: "none", area: { x: -1, y: 0.4, w: 2, h: 0.1 } },
  // the water line, just under the ice: a ball that touches it has dropped through a hole
  obstacles: [{ kind: "bar", x: 0, y: 0.515, len: 1.8, angleDeg: 0, thick: 0.02 }],
  vars: [
    { id: "per", start: 1 },
    { id: "melt", start: 0 },
  ],
  spawners: [
    { body: "green", at: "left", count: 1, speed: 100 },
    { body: "gold", at: "top", count: 1, speed: 100 },
    { body: "purple", at: "right", count: 1, speed: 100 },
    { body: "green", at: "center", count: "per", speed: 200, startSec: 0.4 },
    { body: "gold", at: "center", count: "per", speed: 200, startSec: 0.8 },
    { body: "purple", at: "center", count: "per", speed: 200, startSec: 1.2 },
  ],
  rules: [
    // the melt: every landing takes `melt` more hit points, one more every 10 s
    { when: "tileHit", do: [{ act: "damage", target: "tile", amount: "melt" }] },
    { when: "timer", sec: 10, do: [{ act: "var", id: "melt", op: "add", value: 1 }] },
    // through a hole: out at the water line
    { when: "obstacleHit", do: [{ act: "remove", target: "self" }, { act: "sound", voice: "gap", pitch: 0 }, { act: "fx", kind: "burst" }] },
  ],
  finish: { any: [{ when: "teamsLeft", atMost: 1, say: "{winner} STAYS DRY" }], winner: "mostBalls", timeoutSec: 90, timeoutSay: "THE ICE HELD" },
  hud: [{ show: "balls", label: "dry" }, { show: "tiles", label: "ice" }],
  look: { palette: ["#7fd8ff", "#4dabf7", "#51cf66", "#ffd43b", "#b197fc", "#22d3ee"], background: "#07111f", rim: 0, teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"] },
  sound: { scale: "pentatonic", root: 2, voices: { wallHit: "none", ballHit: "none", obstacleHit: "none", spawn: "none" } },
  params: [
    { id: "per", label: "extra balls", at: "vars[0].start", min: 0, max: 2, step: 1 },
    { id: "hp", label: "ice strength", at: "tiles.hp", min: 3, max: 15, step: 1 },
    { id: "cols", label: "panes of ice", at: "tiles.cols", min: 6, max: 14, step: 1 },
    { id: "melt", label: "melt every", at: "rules[1].sec", min: 6, max: 40, step: 1 },
  ],
} as const;
