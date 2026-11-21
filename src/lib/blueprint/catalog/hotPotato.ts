/*
 * --- blueprint-catalog-c2 --- Catalog: Hot Potato (battle). Four balls in four colours fly round one ring with a lit bomb:
 * the spark (an orange ball) starts in the middle, and the first ball it touches holds the bomb. The holder swells and throbs
 * in its own colour as its fuse burns down (the HUD's fuse, in whole seconds). Touching a smaller ball passes the bomb on
 * (`with: "smaller"`: the bigger ball of the two is always the holder). When the fuse runs out the holder bursts and is out,
 * the others speed up, and a fresh spark flies out of the middle. The last ball left wins for its colour.
 * The bomb is a size, not a colour: the holder is `HOLDER` px, the others `BALL` px, so every rule reads it from `size` – the
 * pass sets the giver back to `BALL` and the taker to the bomb's swell, the burst pops every ball bigger than `BALL` by half the
 * gap, and a timer keeps every ball at the round's pace (balls of different sizes trade speed when they bounce: without it the
 * small ones would race). The spark is `BALL` px too, so it never takes a pass. Heard: the passes, the pick-up, the fuse's tick
 * twice a second and the burst; the wall bounces and the other clashes are not.
 * --- review fix (C2) --- One ball a colour, so the final two are always two colours (three bodies and a spark are the
 * language's four: the start rule moves the top ball to the fourth team and adds the blue one on the left). They start on
 * four sides of the ring, never on top of each other. The holder keeps its colour (the orange holder hid who held the bomb
 * and which colour went out). The second round's fuse is 12 % shorter, and the final duel's 30 % longer than the first, and a
 * random nudge every 0.4 s breaks the balls' fixed orbits: at one pace in a ring, two balls can circle for seconds without
 * meeting (27 of 100 duels of the old six had no pass).
 * Seeds 1-100 headless (the portrait clip's world, and 800 × 450 the same): the last ball stands 16.1-19.6 s in (median
 * 17.4 s, 100 of 100 between 15 and 25 s), the final duel has no pass on 3 of 100 (4 passes at the median), 3.1 sounds a
 * second, and each colour wins 18 to 32 of the 100.
 */
const BALL = 22;
const HOLDER = 32;
/** The bomb's size: the holder's, plus up to 12 px as its fuse burns down (a round's fuse is a share of the first one, `length`). */
const SWELL = `${HOLDER} + 12 * (1 - fuse / length)`;
/** 1 for the holder (bigger than BALL by more than half the gap), 0 for every other ball. */
const HOLDS = `min(1, floor((size - ${BALL}) / ${HOLDER - BALL} + 0.5))`;
/** The round's pace (px/s): 25 % faster after every burst. */
const PACE = "300 * 1.25 ^ (4 - left)";
/** A round's fuse: the first's `length`, 12 % shorter in the second round, 30 % longer in the final duel. */
const FUSE = "length * 0.88 ^ ((4 - left) * (left - 2)) * (1 + 0.15 * (4 - left) * (3 - left))";

export const hotPotato = {
  v: 1,
  meta: { name: "Hot Potato", description: "One ball holds the bomb and a touch passes it on. Whoever holds it when the fuse runs out is out.", family: "battle", author: "builtin" },
  arena: { shape: "circle", size: 0.92 },
  bodies: [
    { id: "spark", radius: BALL, color: 0, team: 0 },
    { id: "blue", radius: BALL, color: 1, team: 1 },
    { id: "green", radius: BALL, color: 2, team: 2 },
    { id: "gold", radius: BALL, color: 3, team: 3 },
  ],
  vars: [
    { id: "fuse", start: 5 },
    { id: "secs", start: 5 },
    { id: "left", start: 4 },
    { id: "length", start: 5 },
  ],
  spawners: [
    { body: "blue", at: "top", count: 1, speed: 300 },
    { body: "green", at: "right", count: 1, speed: 300 },
    { body: "gold", at: "bottom", count: 1, speed: 300 },
    { body: "spark", at: "center", count: 1, speed: 380 },
  ],
  rules: [
    // four colours from three bodies: the top ball plays purple, and the blue one joins on the left
    { when: "start", of: "blue", do: [{ act: "team", target: "all", to: 4 }, { act: "recolor", target: "all", color: "team" }, { act: "spawn", body: "blue", count: 1, at: "left", speed: 300 }] },
    // a touch passes the bomb: the bigger ball (the holder) gives it to the smaller one
    { when: "ballHit", with: "smaller", cooldownSec: 0.25, do: [{ act: "grow", target: "self", by: `${BALL} - size` }, { act: "grow", target: "other", by: `${SWELL} - size` }] },
    { when: "ballHit", with: "smaller", cooldownSec: 0.25, do: [{ act: "sound", voice: "hit", pitch: 5 }, { act: "fx", kind: "burst" }] },
    // the spark lights the bomb on the first ball it touches: this round's fuse
    { when: "ballHit", of: "spark", do: [{ act: "sound", voice: "merge", pitch: 0 }, { act: "var", id: "fuse", op: "set", value: FUSE }] },
    { when: "ballHit", of: "spark", do: [{ act: "remove", target: "self" }, { act: "grow", target: "other", by: `${SWELL} - size` }] },
    // the fuse burns while the bomb is lit (while no spark is out: then the balls are the players left), the HUD shows its whole
    // seconds, and it ticks twice a second
    { when: "timer", sec: 0.1, do: [{ act: "var", id: "fuse", op: "add", value: "-0.1 * (1 - min(1, balls - left))" }, { act: "var", id: "secs", op: "set", value: "ceil(fuse)" }] },
    { when: "timer", sec: 0.5, do: [{ act: "sound", voice: "hit", pitch: -4 }] },
    // the burst: the holder pops, the others speed up, and a new spark flies out while two balls or more are left (the fuse
    // reads 0 until the spark lights the next one)
    { when: "countReached", what: "fuse", atMost: 0.05, do: [{ act: "sound", voice: "gap", pitch: 0 }, { act: "fx", kind: "flash" }, { act: "var", id: "left", op: "add", value: -1 }, { act: "fx", kind: "shake" }] },
    { when: "countReached", what: "fuse", atMost: 0.05, do: [{ act: "grow", target: "all", by: `-999 * ${HOLDS}` }, { act: "spawn", body: "spark", count: "min(1, balls - 1)", at: "center", speed: 380 }, { act: "var", id: "fuse", op: "set", value: 0 }] },
    // every ball at the round's pace (the spark faster), and the bomb swelling with its fuse, throbbing twice a second
    { when: "timer", sec: 0.25, do: [{ act: "speed", target: "all", scale: `${PACE} / max(speed, 1)` }, { act: "grow", target: "all", by: `${HOLDS} * (${SWELL} + 2 * cos(pi * n) - size)` }] },
    { when: "timer", sec: 0.25, of: "spark", do: [{ act: "speed", target: "all", scale: `1.6 * ${PACE} / max(speed, 1)` }] },
    // a nudge every 0.4 s: no two balls keep circling the ring on orbits that never meet
    { when: "timer", sec: 0.4, do: [{ act: "impulse", target: "all", dir: "random", amount: 250 }] },
  ],
  finish: { any: [{ when: "count", what: "balls", atMost: 1, say: "{winner} SURVIVES" }], winner: "lastBall", timeoutSec: 60, timeoutSay: "THE FUSE IS STILL LIT" },
  hud: [{ show: "secs", label: "fuse" }, { show: "left", label: "left" }],
  look: { palette: ["#ff5a1f", "#4dabf7", "#51cf66", "#ffd43b", "#b197fc", "#22d3ee"], rim: 3, trail: true, teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"] },
  sound: { scale: "pentatonic", root: 2, voices: { wallHit: "none", ballHit: "none", spawn: "none" } },
  params: [{ id: "fuse", label: "first fuse", at: "vars[3].start", min: 1.5, max: 8, step: 0.5 }],
} as const;
