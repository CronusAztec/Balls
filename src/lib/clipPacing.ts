import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { HOOPS_LOOK } from "@/lib/physics/hoopsFields"; // --- finales-in-clip ---
import { drawingMachineLook } from "@/lib/physics/drawingMachineFields"; // --- finales-in-clip ---

/*
 * --- clip-pacing --- The page's own defaults of the modes whose default run did not end inside the default 30 s clip: a
 * visitor who opened the mode and pressed Record got a clip without its ending (Countdown: 0 of 100 seeds done within 27 s;
 * Pendulum Wave: IN LINE! at 60.0 s; Merge Ring: 44–76 s). `clipPacingDefaults(mode)` is spread last into
 * `defaultSettings(mode)` (lib/settings.ts), so these are what the page, a bare `?mode=` link and a preset that leaves the
 * field out start from. A link that names the field keeps its value, and so does every recipe, template and gallery entry
 * that sets it.
 *
 * Not here, on purpose: Classic and Accumulation. Classic is the page's first mode and the run half the product is measured
 * on – the bot's ring recipes and their plans in the crew's role-eval corpus (tests/fixtures/crew, which a recorded eval
 * answers byte for byte), the daily deals, the split-screen arenas, the characters' reactions: a new default there is a new
 * run in all of them. Measured for the day its default can move: gap 1.0 rad at ball speed 500 with the seven rings brings
 * 88 of 100 seeds out by 27 s (now: 0), median 18.2 s, none under 8 s, the first ring broken at a median 1.1 s (6.5 s); a
 * link gets that run today with `gap=1&s=500`, and the gallery's Ring Ladder card plays it with the ring sounds. (Tried as
 * the default: every ring recipe names its own gap and speed, so no plan's run moves, but their share links are written
 * against the defaults – `s=500` falls out, `gap=0.4` comes in – and so are the briefs a recorded crew eval answered.)
 * Accumulation runs in the same recipes, and its length is the luck of one
 * gap: a 3 s timer, gap 0.35 and speed 450 bring 79 of 100 in (now 63).
 *
 * Only page defaults: the modes' own constants (DEFAULT_PENDULUM_SETTINGS, DEFAULT_MERGE_RING_SETTINGS …) and the
 * fingerprint recipe's config (lib/agentKit/fingerprint.ts) are what they were, so no pinned run moves.
 *
 * Measured with the seed finder's own engine on seeds 1–100 (Merge Ring and Spiral Glass: 1–40) in the laptop world
 * (800 × 450) and the phone world (450 × 450), which agree for these modes; "inside" means the run's own end by 27 s, so the
 * end banner's 2 s still fit a 30 s clip:
 *
 *  - target (Countdown): 7 numbers at ball speed 700 – 94 of 100 inside (0), median 17.6 s, the first hit at a median 1.8 s
 *    (13.1 s).
 *  - colorMatch: 8 segments in 3 colours at ball speed 700 – 87 of 100 inside (0; 9 of 100 were out within 90 s), median
 *    19.0 s, none under 8 s, the first match at a median 0.7 s (4.1 s).
 *  - pendulum: a 24 s cycle with 20 swings of the slowest bob (the same swing rate as 51 in 60 s) – IN LINE! at 24.0 s.
 *  - polyrhythm: a 24 s cycle – IN PHASE! at 24.0 s (30.0 s: one frame after a 30 s clip's last).
 *  - mergeRing (--- merge-ring-staged ---): its own 7 tiers, a ball every 0.4 s, three spawn tiers and gravity 3 – a verdict by
 *    27 s on 58 of 60 seeds, 37 final forms (13.5–23.7 s) and 23 overflows (14.9–33.4 s): the question has two answers.
 *    6 tiers at 0.6 s gave FINAL FORM on 40 of 40 at 17.0–26.5 s, a question with one answer; 7 tiers at 0.9 s ran 44–76 s,
 *    13 of 24 an overflow. (The audit's 0.4 s, gravity 1.5 and three spawn tiers: 14 final forms and 15 overflows of 30.)
 *  - territory (--- territory-swing ---; its run moved too: a power fires on the border, into the other colour): a reach of 4
 *    tiles every 2 s – seeds 1–48, the phone world: a winner by 5 % or more on 37 (27 with the old powers at 3 and 3), both
 *    sides ahead by 5 % at some point on 47 (6), 15 lead changes (4), 1,545 tiles flipped (221). Not its length: its promise.
 *  - spiralGlass: glass of 1 hit – GLASS CLEARED on 40 of 40 at 22.9–24.7 s (2 hits: 31.7–33.2 s), the first multiply at 7.3 s
 *    (11.1 s).
 *  - shatter (--- shatter-demolition ---, its run moved: a bounce no longer sticks to a ring): 6 rings of 36 segments that take 2
 *    hits, and (--- shatter-even-bricks --- review fix B3) the inner rings in bricks as long as the outer ring's – 47 of 50
 *    runs (seeds 1–50; the rings follow the shorter side, the same 450 px in both worlds) end by 27 s with the 1.5 s collapse,
 *    median 13.3 s, the ball out of the smallest ring at a median 3.2 s; about 10 hits a second, at most 2 in a frame. With
 *    36 segments on every ring the smallest one held the ball for half the run (out at a median 8.9 s, the run 18.6 s), and
 *    3 hits a segment ran a median 35 s. The old 10 rings sit closer than the ball is wide (15 px apart for a 16 px ball):
 *    wedged, it touched two rings every pass. With the fix and the old defaults (10 rings of 18 one-hit segments) a run was
 *    over in a median 10.1 s; 6 rings of one hit, 7.2 s.
 */
export function clipPacingDefaults(mode: ModeId): Partial<SimulatorSettings> {
  switch (mode) {
    case "target":
      return { targetCount: 7, ballSpeed: 700, ...RING_LOOK };
    case "colorMatch":
      return { colorMatchSegments: 8, colorMatchColorCount: 3, ballSpeed: 700, ...RING_LOOK };
    case "pendulum":
      return { pwCycleSeconds: 24, pwBaseOscillations: 20 };
    case "polyrhythm":
      return { prCycleSeconds: 24 };
    case "mergeRing":
      return MERGE_RING_PACE; // --- merge-ring-staged ---
    case "spiralGlass":
      return { sgGlassHp: 1 };
    case "shatter":
      return SHATTER_PACE; // --- shatter-demolition ---
    case "territory":
      return TERRITORY_PACE; // --- territory-swing ---
    // --- finales-in-clip --- (B6)
    case "runner":
      return RUNNER_PACE;
    case "vortex":
      return VORTEX_PACE;
    case "bullseye":
      return BULLSEYE_PACE;
    case "race":
      return RACE_PACE;
    case "journey":
      return JOURNEY_PACE;
    case "orbGrid":
      return ORB_GRID_PACE;
    case "maze":
      return MAZE_PACE;
    case "paddle":
      return PADDLE_PACE;
    // --- end finales-in-clip ---
    default:
      return NONE;
  }
}

const NONE: Partial<SimulatorSettings> = Object.freeze({});
/**
 * --- merge-ring-staged --- Merge Ring's page pace: the mode's seven tiers, a ball every 0.4 s (the chute's own pace: the next
 * ball waits for the one before it), three spawn tiers and gravity 3 – a question with two answers inside the clip.
 */
const MERGE_RING_PACE: Partial<SimulatorSettings> = Object.freeze({ mrInterval: 0.4, mrSpawnTiers: 3, mrGravity: 3 });
/**
 * --- territory-swing --- Territory's page pace: a power every 2 s with a reach of 4 tiles (the mode's own 3 and 3 stay, so the
 * bot's plans, which carry every mode's fields, are what they were).
 */
const TERRITORY_PACE: Partial<SimulatorSettings> = Object.freeze({ tyRadius: 4, tyPowerEvery: 2 });
/**
 * --- shatter-demolition --- Shatter's page pace: six rings (a ball fits between them), 36 segments a ring, two hits a segment,
 * and (--- shatter-even-bricks ---) the inner rings in bricks as long as the outer ring's.
 */
const SHATTER_PACE: Partial<SimulatorSettings> = Object.freeze({ wallCount: 6, shatterSegments: 36, shatterHits: 2, shatterEvenBricks: true /* --- shatter-even-bricks --- (review fix B3) */ });
// --- finales-in-clip --- (B6) the page paces of the modes whose finale fell after the default clip (measured: the comment above)
/** Beat Runner: a level of 18 obstacles that takes an obstacle on most beats (the mode's own 24 at 0.6 stay). */
const RUNNER_PACE: Partial<SimulatorSettings> = Object.freeze({ runnerObstacles: 18, runnerDensity: 0.85 });
/** Sound Vortex: the ring release – rainbow rings of 6, 12 and 24 marbles, one cycle of 22.5 s (the mode's own stagger stays). */
const VORTEX_PACE: Partial<SimulatorSettings> = Object.freeze({ vxRelease: "rings" } as const);
/** Bullseye: ten shots, the last one steered into the bull (the mode's own 12 shots and no rig stay). */
const BULLSEYE_PACE: Partial<SimulatorSettings> = Object.freeze({ byShots: 10, byPerfect: 10 });
/** Race: a track of 6 screens (the mode's own 8 stay). */
const RACE_PACE: Partial<SimulatorSettings> = Object.freeze({ rcTrackLength: 6 });
/** Journey: five stages and home – rings, pegs, glass, multipliers, funnel (the mode's own seven stay). */
const JOURNEY_PACE: Partial<SimulatorSettings> = Object.freeze({ journeyStages: "rings,pegs,glass,multipliers,funnel,home" });
/** Bouncing Orbs: a 26 s cycle, so the landing, its card and its chord land inside the clip (the mode's own 30 s stay). */
const ORB_GRID_PACE: Partial<SimulatorSettings> = Object.freeze({ ogCycle: 26 });
/** Maze: the run ends at the first ball out, the clip limit 25 s (the mode's own: every ball out, 60 s). */
const MAZE_PACE: Partial<SimulatorSettings> = Object.freeze({ mzFirstOut: true, mzDuration: 25 });
/** Paddle Keep-Up: a goal of 20 catches – a win card or GAME OVER, the question every run answers (the mode's own: no goal). */
const PADDLE_PACE: Partial<SimulatorSettings> = Object.freeze({ pdGoal: 20 });
// --- end finales-in-clip ---

// --- clip-start --- (review fix B2)
/**
 * The page's start look of a mode whose link base cannot move: what a visitor gets when the page itself starts the mode (a
 * bare studio visit, a mode picked on the page – Simulator.tsx), on top of `defaultSettings(mode)`. Never applied to a link:
 * links, presets, project files, share codes and the bot's plans are written against `defaultSettings(mode)`, which stays as
 * it was (the crew's role-eval corpus pins Classic's and Accumulation's defaults byte for byte: tests/fixtures/crew), so a page
 * in its start look writes these fields into its own link and a shared link replays the run it showed.
 *
 * Measured with the seed finder's own engine, seeds 1–50 in the laptop (800 × 450) and phone (450 × 450) worlds:
 *  - classic: the Ring Ladder card's run (gap 1.0 at ball speed 500, the ring sounds, a light shake, the glow, every break
 *    effect) – 87 of 100 runs out by 27 s, none within 5 s, median 17.7 s (the link base: 0 of 100, 82 still running at
 *    60 s), a note per ring and the chord at the way out, so a first visit sees and hears its ending inside the clip.
 *  - accumulation: a 3 s timer, gap 0.35 and ball speed 450 – 76 of 100 runs out by 27 s (the link base: 72), median 17.7 s
 *    (14.3 s), and 8 of 100 out within the first 5 s (14): the first ball's luck with the gap, which only a physics change
 *    removes.
 *  - grow (--- grow-fill-clip ---): the fill-and-finish Grow that was built and switched off – the multiply law from 15 % of the
 *    ring at 4 % a bounce (--- review fix (B5) ---: 8 % from 5 % barely moved for a third of the clip), the run ending at the fill
 *    with the completion chord, the colour by size, the contact markers and a pluck a bounce pitched by size. Seeds 1–12, both
 *    worlds (the ring follows the shorter side): full at 17.6–20.2 s on every seed, median 19.4 s (the link base: not full at
 *    240 s, and from about 85 s a nearly full ball buzzing at about 1,300 sounds a second); 2.5 sounds a second, at most 9 in a
 *    second (the last bounces), never more than 0.92 s without one. The link base stays: the
 *    bot's fill-grow plans and the crew's role-eval corpus run it (their plans read the mode's defaults, and a recorded eval
 *    answers that corpus byte for byte), and so does the gallery's Matrix Growth card.
 *  - multiply (--- multiply-race ---): the race to the limit through the page's own gap of 0.3 (--- review fix (B5) --- its
 *    pacer keeps one ball aimed at the gap and its balls pass through each other; the gap of 0.6 it had before the pacer ends at
 *    10–13 s, and without the pacer the count sat still for 4–8 s) – the start ball out at 0.4 s on every seed, the swarm at its
 *    limit of 200 and the run over at 17.3–24.4 s on 30 of 30 seeds in both worlds, median 19.5 s, the count never still for
 *    more than 1.6 s in the first 10 s, about 5 sounds a second, never more than 0.42 s without one (the link base: the first
 *    escape at a median 18.3 s, 6 balls at 30 s, never an end). The link base stays for the same reason as Grow's: the bot's
 *    count-multiply plans in the crew's corpus run it.
 */
export function clipStartSettings(mode: ModeId): Partial<SimulatorSettings> {
  switch (mode) {
    case "classic":
      return CLASSIC_START;
    case "accumulation":
      return ACCUMULATION_START;
    case "grow":
      return GROW_START; // --- grow-fill-clip ---
    case "multiply":
      return MULTIPLY_START; // --- multiply-race ---
    // --- finales-in-clip --- (B6)
    case "hoops":
      return HOOPS_START;
    case "drawingMachine":
      return DRAWING_MACHINE_START;
    // --- end finales-in-clip ---
    default:
      return NONE;
  }
}
const CLASSIC_START: Partial<SimulatorSettings> = Object.freeze({ gapSize: 1, ballSpeed: 500, screenShake: 0.3, showGlow: true, wallBreakStyle: "all", ringSound: true } as const);
const ACCUMULATION_START: Partial<SimulatorSettings> = Object.freeze({ accumulationTime: 3, gapSize: 0.35, ballSpeed: 450, showGlow: true } as const);
/**
 * --- grow-fill-clip --- Grow's start look: the multiply law, the run ending at the fill, colour and pitch by size, the markers.
 * (--- review fix (B5) --- the ball starts at 15 % of the ring and grows 4 % a bounce, so the first seconds already move: 8 % from
 * the law's 5 % start read 5–11 % for the first 6 s and did all its visible growing in the last 3.)
 */
const GROW_START: Partial<SimulatorSettings> = Object.freeze({ growLaw: "multiply", growStep: 4, growStart: 15, growOnFill: "finish", growHue: true, growMarkers: true, growPitch: true } as const);
/** --- multiply-race --- Multiply's start look: the race to the limit (through the page's gap of 0.3: --- review fix (B5) ---). */
const MULTIPLY_START: Partial<SimulatorSettings> = Object.freeze({ multiplyRace: true } as const);
// --- finales-in-clip --- (B6; the crew's corpus runs both modes' link bases, so the page's start look carries them)
/**
 * Spinning Hoops' start look: the look its presets put on the page – the navy page, the rainbow hoops and the loop HUD's title
 * and live counter – and a spin that starts at 0.5 turns a second: the first bead up at 4 s, all eight by 19 s, back down by
 * 29 s (the link base, 0.13: nothing for 11 s, 5 sounds in the first 11, a clip without a word).
 */
const HOOPS_START: Partial<SimulatorSettings> = Object.freeze({ ...HOOPS_LOOK, backgroundColors: [...HOOPS_LOOK.backgroundColors], hpOmegaStart: 0.5 });
/**
 * Drawing Machines' start look: Earth and Venus on their dark sky – the five-petal rose and its star drawn in 14 s, with its chord
 * bed and plucks (the link base, the harmonograph: one pale figure in 22.5 s over a drone, then the same one again).
 */
const DRAWING_MACHINE_START: Partial<SimulatorSettings> = Object.freeze({ dmMachine: "orbits" as const, ...drawingMachineLook("orbits") });
// --- end finales-in-clip ---

/**
 * A studio address the page starts itself (`clipStartSettings()`): no mode, no seed, no daily challenge, no share code and
 * no setting of its own – only what is not a setting (the language, the campaign tags). Any of them makes it a link, read as
 * it was written.
 */
export function isBareStudioVisit(params: URLSearchParams, linkedQuery: string): boolean {
  for (const key of ["mode", "seed", "daily", "c"]) if (params.has(key)) return false;
  return linkedQuery === "mode=classic";
}
// --- end clip-start ---
/** The look the ring modes start with, render only: a glow round the ball (the bot's own look has it: planner.ts). The camera stays off in every mode. */
const RING_LOOK = { showGlow: true } as const;
