/*
 * --- blueprint --- Catalog: Colour Conquest (battle). Four teams bounce in a ring; when two balls of different teams touch,
 * the faster one paints the slower one in its colour. Every few seconds everything speeds up. The last colour standing wins.
 */
export const conquer = {
  v: 1,
  meta: { name: "Colour Conquest", description: "Four colours collide: the faster ball converts the slower one. The last colour standing wins.", family: "battle", author: "builtin" },
  arena: { shape: "circle", size: 0.92 },
  bodies: [
    { id: "red", radius: 11, color: 0, team: 0 },
    { id: "blue", radius: 11, color: 1, team: 1 },
    { id: "green", radius: 11, color: 2, team: 2 },
    { id: "gold", radius: 11, color: 3, team: 3 },
  ],
  spawners: [
    { body: "red", at: "random", count: 6, speed: 230 },
    { body: "blue", at: "random", count: 6, speed: 230 },
    { body: "green", at: "random", count: 6, speed: 230 },
    { body: "gold", at: "random", count: 6, speed: 230 },
  ],
  rules: [
    { when: "ballHit", with: "otherTeam", do: [{ act: "team", target: "other", to: "self" }, { act: "recolor", target: "other", color: "team" }, { act: "sound", voice: "merge" }] },
    { when: "timer", sec: 6, do: [{ act: "speed", target: "all", scale: 1.12 }] },
  ],
  finish: { any: [{ when: "teamsLeft", atMost: 1, say: "{winner} WINS" }], winner: "mostBalls", timeoutSec: 90, timeoutSay: "{winner} LEADS" },
  hud: [{ show: "teams", label: "colours left" }, { show: "time", label: "time" }],
  look: { teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"] },
  sound: { scale: "minor", root: 9 },
} as const;
