/*
 * --- blueprint-catalog-c2 --- Catalog: Hot Potato (battle). Six balls in three colours fly round one ring with a lit bomb: the
 * spark (an orange ball) starts in the middle, and the first ball it touches holds the bomb. The holder is the big orange ball,
 * swelling as its fuse burns down (the HUD's fuse, in seconds). Touching a smaller ball passes the bomb on (`with: "smaller"`:
 * the bigger ball of the two is always the holder). When the fuse runs out the holder bursts and is out, the others speed up,
 * and a fresh spark flies out of the middle with a shorter fuse (12 % shorter each round). The last ball left wins for its
 * colour.
 * The bomb is a size, not a colour: the holder is `HOLDER` px, the others `BALL` px, so every rule reads it from `size` – the
 * pass sets the giver back to `BALL` and the taker to the bomb's swell, the burst pops every ball bigger than `BALL` by half the
 * gap, and a timer keeps every ball at the round's pace (balls of different sizes trade speed when they bounce: without it the
 * small ones would race). The spark is `BALL` px too, so it never takes a pass. Heard: the passes, the pick-up, the fuse's tick
 * twice a second and the burst; the wall bounces and the other clashes are not.
 * Seeds 1-100 headless (the portrait clip's world, and 800 × 450): the last ball stands 16.0-20.6 s in (median 17.5 s, 100 of
 * 100 between 15 and 25 s), the bomb is passed at least once in the final duel on every seed (twice at the median), a spark
 * finds its holder in 1 s at the median (3.4 s at most), 3.7 sounds a second at the median, and each colour wins 28 to 39 of
 * the 100.
 */
const BALL = 22;
const HOLDER = 32;
/** The bomb's size: the holder's, plus up to 12 px as its fuse burns down (a round's fuse is a share of the first one, `length`). */
const SWELL = `${HOLDER} + 12 * (1 - fuse / length)`;
/** 1 for the holder (bigger than BALL by more than half the gap), 0 for every other ball. */
const HOLDS = `min(1, floor((size - ${BALL}) / ${HOLDER - BALL} + 0.5))`;
/** The round's pace (px/s): 10 % faster after every burst. */
const PACE = "300 * 1.1 ^ (6 - left)";

export const hotPotato = {
  v: 1,
  meta: { name: "Hot Potato", description: "One ball holds the bomb and a touch passes it on. Whoever holds it when the fuse runs out is out.", family: "battle", author: "builtin" },
  arena: { shape: "circle", size: 0.92 },
  bodies: [
    { id: "spark", radius: BALL, color: 0, team: 0 },
    { id: "blue", radius: BALL, color: 1, team: 1 },
    { id: "green", radius: BALL, color: 2, team: 2 },
    { id: "purple", radius: BALL, color: 4, team: 4 },
  ],
  vars: [
    { id: "fuse", start: 4 },
    { id: "lit", start: 0 },
    { id: "left", start: 6 },
    { id: "length", start: 4 },
  ],
  spawners: [
    { body: "blue", at: "random", count: 2, speed: 300 },
    { body: "green", at: "random", count: 2, speed: 300 },
    { body: "purple", at: "random", count: 2, speed: 300 },
    { body: "spark", at: "center", count: 1, speed: 380 },
  ],
  rules: [
    // a touch passes the bomb: the bigger ball (the holder) gives it to the smaller one
    { when: "ballHit", with: "smaller", cooldownSec: 0.25, do: [{ act: "grow", target: "self", by: `${BALL} - size` }, { act: "recolor", target: "self", color: "team" }, { act: "grow", target: "other", by: `${SWELL} - size` }, { act: "recolor", target: "other", color: 0 }] },
    { when: "ballHit", with: "smaller", cooldownSec: 0.25, do: [{ act: "sound", voice: "hit", pitch: 5 }, { act: "fx", kind: "burst" }] },
    // the spark lights the bomb on the first ball it touches: this round's fuse, 12 % shorter than the last
    { when: "ballHit", of: "spark", do: [{ act: "sound", voice: "merge", pitch: 0 }, { act: "var", id: "fuse", op: "set", value: "length * 0.88 ^ (6 - left)" }] },
    { when: "ballHit", of: "spark", do: [{ act: "remove", target: "self" }, { act: "grow", target: "other", by: `${SWELL} - size` }, { act: "recolor", target: "other", color: 0 }, { act: "var", id: "lit", op: "set", value: 1 }] },
    // the fuse burns while the bomb is lit, and ticks twice a second
    { when: "timer", sec: 0.1, do: [{ act: "var", id: "fuse", op: "add", value: "-0.1 * lit" }] },
    { when: "timer", sec: 0.5, do: [{ act: "sound", voice: "hit", pitch: -4 }] },
    // the burst: the holder pops, the others speed up, and a new spark flies out while two balls or more are left (the fuse
    // reads 0 until the spark lights the next one: its last tenth of a second could have left it a hair under 0, "-0.0")
    { when: "countReached", what: "fuse", atMost: 0.05, do: [{ act: "sound", voice: "gap", pitch: 0 }, { act: "fx", kind: "flash" }, { act: "var", id: "left", op: "add", value: -1 }, { act: "fx", kind: "shake" }] },
    { when: "countReached", what: "fuse", atMost: 0.05, do: [{ act: "grow", target: "all", by: `-999 * ${HOLDS}` }, { act: "var", id: "lit", op: "set", value: 0 }, { act: "spawn", body: "spark", count: "min(1, balls - 1)", at: "center", speed: 380 }, { act: "var", id: "fuse", op: "set", value: 0 }] },
    // every ball at the round's pace (the spark faster), and the bomb swelling with its fuse, throbbing twice a second
    { when: "timer", sec: 0.25, do: [{ act: "speed", target: "all", scale: `${PACE} / max(speed, 1)` }, { act: "grow", target: "all", by: `${HOLDS} * (${SWELL} + 2 * cos(pi * n) - size)` }] },
    { when: "timer", sec: 0.25, of: "spark", do: [{ act: "speed", target: "all", scale: `1.6 * ${PACE} / max(speed, 1)` }] },
  ],
  finish: { any: [{ when: "count", what: "balls", atMost: 1, say: "{winner} SURVIVES" }], winner: "lastBall", timeoutSec: 60, timeoutSay: "THE FUSE IS STILL LIT" },
  hud: [{ show: "fuse", label: "fuse" }, { show: "left", label: "left" }],
  look: { palette: ["#ff5a1f", "#4dabf7", "#51cf66", "#ffd43b", "#b197fc", "#22d3ee"], rim: 3, trail: true, teamNames: ["RED", "BLUE", "GREEN", "GOLD", "PURPLE", "CYAN"] },
  sound: { scale: "pentatonic", root: 2, voices: { wallHit: "none", ballHit: "none", spawn: "none" } },
  params: [{ id: "fuse", label: "first fuse", at: "vars[3].start", min: 1.5, max: 8, step: 0.5 }],
} as const;
