/*
 * --- blueprint-catalog-c2 --- Catalog: Thin Ice (battle). Three colours, a ball of each on either side, bounce on one sheet of ice
 * over open water: every landing cracks the pane under it, and a pane that takes its last hit is gone. A ball that comes down
 * on a hole, or slides off the broken edge on the right, falls through the opening at the bottom and is out. The last colour
 * still on the ice wins. Only the landings on the ice are heard (a note each), the breaks and the falls (a gap note, higher
 * with every ball out); the wall bounces and the balls' clashes are not.
 * The ice melts: every 12 s (the `melt` slider) each landing takes one more hit point, so two balls hopping on a patch that
 * holds can never stall the run. The balls start at random heights above the ice (left and right), so they hop at
 * different speeds and their panes give way at different times. Seeds 1-100 headless (the portrait clip's world; the same
 * within 0.1 s at 800 × 450): the first ball falls 0.7-14.1 s in (median 1.8 s), the last colour stands 7.0-27.9 s in (median
 * 17.3 s, 72 of 100 between 15 and 25 s), 3.1 sounds a second at the median, and each colour wins 30 to 38 of the 100.
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
  tiles: { layout: "grid", rows: 1, cols: 11, hp: 8, style: "glass", pitchBy: "none", area: { x: -0.98, y: 0.4, w: 1.6, h: 0.1 } },
  vars: [
    { id: "per", start: 1 },
    { id: "melt", start: 0 },
  ],
  spawners: [
    { body: "green", at: "left", count: "per", speed: 100 },
    { body: "green", at: "right", count: "per", speed: 100 },
    { body: "gold", at: "left", count: "per", speed: 100 },
    { body: "gold", at: "right", count: "per", speed: 100 },
    { body: "purple", at: "left", count: "per", speed: 100 },
    { body: "purple", at: "right", count: "per", speed: 100 },
  ],
  rules: [
    // the melt: every landing takes `melt` more hit points, one more every 12 s
    { when: "tileHit", do: [{ act: "damage", target: "tile", amount: "melt" }] },
    { when: "timer", sec: 12, do: [{ act: "var", id: "melt", op: "add", value: 1 }] },
  ],
  finish: { any: [{ when: "teamsLeft", atMost: 1, say: "{winner} STAYS DRY" }], winner: "mostBalls", timeoutSec: 90, timeoutSay: "THE ICE HELD" },
  hud: [{ show: "balls", label: "dry" }, { show: "tiles", label: "ice" }],
  look: { palette: ["#7fd8ff", "#4dabf7", "#51cf66", "#ffd43b", "#b197fc", "#22d3ee"], background: "#07111f", rim: 0, teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"] },
  sound: { scale: "pentatonic", root: 2, voices: { wallHit: "none", ballHit: "none", obstacleHit: "none", spawn: "none" } },
  params: [
    { id: "per", label: "balls per side", at: "vars[0].start", min: 1, max: 3, step: 1 },
    { id: "hp", label: "ice strength", at: "tiles.hp", min: 3, max: 15, step: 1 },
    { id: "cols", label: "panes of ice", at: "tiles.cols", min: 6, max: 14, step: 1 },
    { id: "melt", label: "melt every", at: "rules[1].sec", min: 6, max: 40, step: 1 },
  ],
} as const;
