/*
 * --- blueprint --- Catalog: Peg Race (race). Four coloured balls drop through a field of pegs into a bowl whose only exit
 * keeps turning; the first ball out wins. Every peg a ball hits plays a note, higher up the board higher the note.
 * --- review fix (blueprint) --- The exit starts at the left and turns over the top towards the floor, where the balls
 * come to rest, so it always turns: below 15°/s the race is a long wait for it (a still exit was a minute of balls on the
 * floor), and above 35°/s it sweeps past them too fast to drop through – at its narrowest (8°) as at its widest.
 */
export const plinkoRace = {
  v: 1,
  meta: { name: "Peg Race", description: "Four balls fall through the pegs and chase a turning exit. First one out wins.", family: "rhythm", author: "builtin" },
  arena: { shape: "circle", size: 0.92, restitution: 0.9, gravity: { x: 0, y: 380 }, spinDegPerSec: 30, exits: [{ atDeg: 270, widthDeg: 14 }] },
  bodies: [
    { id: "red", radius: 8, color: 0, team: 0 },
    { id: "blue", radius: 8, color: 1, team: 1 },
    { id: "green", radius: 8, color: 2, team: 2 },
    { id: "gold", radius: 8, color: 3, team: 3 },
  ],
  obstacles: [{ kind: "pegGrid", x: 0, y: 0.1, w: 1.3, h: 0.9, rows: 6, cols: 7, r: 0.028, stagger: true }],
  spawners: [
    { body: "red", at: "top", count: 1, speed: 60 },
    { body: "blue", at: "top", count: 1, speed: 60 },
    { body: "green", at: "top", count: 1, speed: 60 },
    { body: "gold", at: "top", count: 1, speed: 60 },
  ],
  finish: { any: [{ when: "escaped", say: "{winner} WINS THE RACE" }], winner: "firstOut", timeoutSec: 60, timeoutSay: "NOBODY GOT OUT" },
  hud: [{ show: "time", label: "time" }],
  look: { teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"], rim: 4 },
  sound: { scale: "major", root: 7 },
  params: [
    { id: "exit", label: "exit width", at: "arena.exits[0].widthDeg", min: 8, max: 40, step: 1 },
    { id: "spin", label: "exit spin", at: "arena.spinDegPerSec", min: 15, max: 35, step: 5 },
    { id: "rows", label: "peg rows", at: "obstacles[0].rows", min: 2, max: 6, step: 1 },
  ],
} as const;
