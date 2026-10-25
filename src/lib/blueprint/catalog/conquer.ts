/*
 * --- blueprint --- Catalog: Colour Conquest (battle). Four teams bounce in a ring; when two balls of different teams touch,
 * the faster one paints the slower one in its colour. Every few seconds everything speeds up. The last colour standing wins.
 * The clashes are heard (the hits and a bar on every conversion); the wall bounces are not.
 * --- review fix (blueprint) --- Every colour starts at a speed of its own and every ball gets a kick of its own at the start.
 * With all 24 balls at the same 230 px/s, the first touches (balls dropped on top of each other, balls no other ball
 * has hit yet) were ties, which the older ball wins: the colour spawned first won 35 % of seeds 1-400 and the last 19 %.
 * Now no colour has the edge (seeds 1-800: red 27 %, blue 22 %, green 27 %, gold 24 %), and the fastest start wins only
 * 35 % of the games.
 */
export const conquer = {
  v: 1,
  meta: { name: "Colour Conquest", description: "Four colours collide: the faster ball converts the slower one. The last colour standing wins.", family: "battle", author: "builtin" },
  arena: { shape: "circle", size: 0.92 },
  bodies: [
    { id: "red", radius: 9, color: 0, team: 0 },
    { id: "blue", radius: 9, color: 1, team: 1 },
    { id: "green", radius: 9, color: 2, team: 2 },
    { id: "gold", radius: 9, color: 3, team: 3 },
  ],
  vars: [{ id: "per", start: 6 }],
  spawners: [
    { body: "red", at: "random", count: "per", speed: "200 + 20 * r" },
    { body: "blue", at: "random", count: "per", speed: "200 + 20 * r" },
    { body: "green", at: "random", count: "per", speed: "200 + 20 * r" },
    { body: "gold", at: "random", count: "per", speed: "200 + 20 * r" },
  ],
  rules: [
    { when: "ballHit", with: "otherTeam", do: [{ act: "team", target: "other", to: "self" }, { act: "recolor", target: "other", color: "team" }, { act: "sound", voice: "merge" }] },
    { when: "timer", sec: 6, do: [{ act: "speed", target: "all", scale: 1.12 }] },
    { when: "start", do: [{ act: "speed", target: "all", scale: "1 + 0.2 * r" }] },
  ],
  finish: { any: [{ when: "teamsLeft", atMost: 1, say: "{winner} WINS" }], winner: "mostBalls", timeoutSec: 90, timeoutSay: "{winner} LEADS" },
  hud: [{ show: "teams", label: "colours left" }, { show: "time", label: "time" }],
  look: { teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"] },
  sound: { scale: "minor", root: 9, voices: { wallHit: "none" } },
  params: [
    { id: "per", label: "balls per colour", at: "vars[0].start", min: 2, max: 8, step: 1 },
    { id: "boost", label: "speed-up every", at: "rules[1].sec", min: 2, max: 20, step: 1 },
  ],
} as const;
