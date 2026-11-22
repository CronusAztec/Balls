import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { HOOPS_LOOK } from "@/lib/physics/hoopsFields"; // --- finales-in-clip ---
import { drawingMachineLook } from "@/lib/physics/drawingMachineFields"; // --- finales-in-clip ---
import { BULLSEYE_LAST_SHOT } from "@/lib/physics/modes/bullseye"; // --- finales-in-clip --- (review fix)

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
/**
 * Bullseye: ten shots, the last one steered into the bull (the mode's own 12 shots and no rig stay). (--- review fix --- the last
 * shot by name, BULLSEYE_LAST_SHOT: a visitor who changes Shots still gets the bull on the last one, never mid-run or not at all.)
 */
const BULLSEYE_PACE: Partial<SimulatorSettings> = Object.freeze({ byShots: 10, byPerfect: BULLSEYE_LAST_SHOT });
/** Race: a track of 6 screens (the mode's own 8 stay). */
const RACE_PACE: Partial<SimulatorSettings> = Object.freeze({ rcTrackLength: 6 });
/** Journey: five stages and home – rings, pegs, glass, multipliers, funnel (the mode's own seven stay). */
const JOURNEY_PACE: Partial<SimulatorSettings> = Object.freeze({ journeyStages: "rings,pegs,glass,multipliers,funnel,home" });
/** Bouncing Orbs: a 26 s cycle, so the landing, its card and its chord land inside the clip (the mode's own 30 s stay). */
const ORB_GRID_PACE: Partial<SimulatorSettings> = Object.freeze({ ogCycle: 26 });
/**
 * Maze: the run ends at the first ball out, the clip limit 25 s (the mode's own: every ball out, 60 s). (--- review fix --- and 14
 * columns, the mode's own 12: seeds 1–60, the finder's world – the first ball out under 10 s on 12 runs, 23 at 12 columns; a median
 * run of 14.6 s, 12.2 s; 2 time-ups as before, every run over by 27.5 s. 16 columns: a median 16.9 s, but 8 time-ups.)
 */
const MAZE_PACE: Partial<SimulatorSettings> = Object.freeze({ mzFirstOut: true, mzDuration: 25, mzCols: 14 });
/** Paddle Keep-Up: a goal of 20 catches – a win card or GAME OVER, the question every run answers (the mode's own: no goal). */
const PADDLE_PACE: Partial<SimulatorSettings> = Object.freeze({ pdGoal: 20 });
// --- end finales-in-clip ---

// --- finder-target --- (review fix B6)
/**
 * Find Simulation's target (s) on a paced mode's own page pace: the page's 30 s found no run where the pace ends every run well
 * inside the clip (Beat Runner 0 of 300 within 30 ± 0.5 s, Paddle Keep-Up 0 of 300, Bullseye, Journey and the Maze 0 of 150), so
 * the search went through its 1,000 seeds and said "closest X s". Picked from the page's default runs, seeds 1–40 in the finder's
 * worlds (800 × 600 and 450 × 450), as the target with the most runs within its ± 0.5 s:
 *  - runner 22 (10 of 40; median 22.1 s), paddle 28 (11; 26.4 s, the wins at 20 catches), bullseye 25 (11 and 19; 25.3 and 24.7 s),
 *    journey 21 (6 and 8; 22.9 and 20.6 s), maze 15 (6; 14.6 s), race 22 (11 and 10; 22.1 s);
 *  - one length on every seed: Sound Vortex 22.5 (its ring cycle), Pendulum Wave and Polyrhythm 24 (one cycle);
 *  - the earlier paces: Countdown 20 (4 and 6; 24.6 and 19.3 s), Color Match 22 (2 and 3; 28.8 and 18.7 s), Merge Ring 23 (5 and 6),
 *    Spiral Glass 24 (24 and 27), Shatter 15 (2 and 6; 17.4 and 14.6 s).
 * (Territory's countdown is 30 s on every seed, and Bouncing Orbs' rhythm field never ends: the page's 30 stays.) Only while the
 * mode's run fields are at their page pace (`clipPacingDefaults()`; the ring modes' glow is a look): a link that sets its own
 * course keeps the page's 30. Simulator.tsx sets it when the page starts a mode (a first visit, a mode picked).
 */
export const DEFAULT_FIND_SEC = 30;
const PACED_FIND_SEC: Readonly<Partial<Record<ModeId, number>>> = Object.freeze({
  target: 20,
  colorMatch: 22,
  pendulum: 24,
  polyrhythm: 24,
  mergeRing: 23,
  spiralGlass: 24,
  shatter: 15,
  runner: 22,
  vortex: 22.5,
  bullseye: 25,
  race: 22,
  journey: 21,
  maze: 15,
  paddle: 28,
});
const LOOK_ONLY_PACE: ReadonlySet<string> = new Set(["showGlow"]);
/**
 * (D3 review) The targets of the start looks that end a run (`clipStartSettings()`), while the run's fields are the start
 * look's: Lines' string art (rainbow strings, ball speed 700, 64 strings: rlines, s, lns) and Paint's full canvas (ball 12,
 * speed 600, Guide to the Gaps: r, s, pgu). The page's 30 found no Lines run (seeds 13–112: 22.1–24.8 s, none within 30 ± 0.5 s)
 * and Paint's only one at 29.5 s, its FULL CANVAS! in the clip's last half-second. Seeds 1–200 in the page's worlds (800 × 450
 * and 450 × 450 agree: the ring follows the shorter side), as the target with the most runs within its ± 0.5 s: Lines 23.5 (100
 * of 200; median 23.6 s, 21.6–25.6 s), Paint 21 (35 of 200; median 21.3 s, 15.4–29.5 s). Paint's link base (full in 73–118 s)
 * and Lines' (endless) keep the page's 30. --- portal-options --- Portal's five pairs of three jumps (ptc, ptu): 16.5 (17 of 200;
 * median 18.2 s, 4.0–39.8 s; 30 s: 5); its link base keeps the page's 30.
 */
const START_FIND_SEC: Readonly<Partial<Record<ModeId, number>>> = Object.freeze({
  lines: 23.5,
  paint: 21,
  portal: 16.5,
});

/**
 * The finder's target (s) for `settings`: the paced mode's own while its run is at the page's pace, a start look's own while
 * its run is the start look's (D3 review), else the page's 30.
 */
export function clipPacingFindSec(settings: Pick<SimulatorSettings, "mode"> & Partial<SimulatorSettings>): number {
  const own = settings as unknown as Record<string, unknown>;
  const runIs = (fields: Partial<SimulatorSettings>) => Object.entries(fields).every(([key, value]) => LOOK_ONLY_PACE.has(key) || own[key] === value);
  const target = PACED_FIND_SEC[settings.mode];
  if (target !== undefined) return runIs(clipPacingDefaults(settings.mode)) ? target : DEFAULT_FIND_SEC;
  const start = START_FIND_SEC[settings.mode];
  if (start !== undefined && runIs(clipStartSettings(settings.mode))) return start;
  return DEFAULT_FIND_SEC;
}
// --- end finder-target ---

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
 *  - box (--- box-finale --- Lane E, E4): the square box that fills the export's square (the tall 0.56 box covered 56 % of its
 *    width, a shape 6 %; square, every shape is 1.8× as big, and ball size 11 makes it 2.5×), the speeds at 4:5:6 (the last
 *    shape alone for about 5 s, at 3:4:5 for 7) and ball speed 575, with the corner finale – seeds 1–12, both worlds (the box
 *    follows the shorter side): 0 at a corner and the chord by 27 s on 24 of 24, median 23.1 s (18.1–24.7 s), never more than
 *    1.4 s without a sound (the square box at the link base's pace: 0 of 24, a median 38.7 s; the link base itself: 14 of 24,
 *    22.0–30.8 s). The link base stays: every shared link and the gallery's Countdown Squares keep the box they were made in.
 *  - glass (--- glass-real --- Lane E, E4): the leading camera (the next panes in view) and gravity 500 – the same four stages
 *    and panes, the hops 1.3× as quick – HOME and its
 *    celebration over by 27 s on 24 of 24 (seeds 1–12, both worlds), median 23.6 s (19.8–25.5 s), never more than 0.7 s without a
 *    sound (the link base: 4 of 24, a median 29.6 s, 26.3–32.7 s, HOME cut off on 7). The link base stays: the crew's
 *    role-eval corpus plays Glass Smash at it.
 *  - waveTank (--- wave-chapters ---): the clip opens on the double slit's stripes and climbs to the grating's beams – 2 gaps
 *    for 13 s, 1 gap for 8 s, 7 gaps for 9 s, the first section wrapping 5 s across the loop point, the gaps 2.5 wavelengths
 *    apart (all seven still inside the tank). The loop stays 30 s, so a 30 s clip is one whole loop: the 2-gap fan from the
 *    first frame (5 s of it already behind the wall; its stripes reach the front edge's pillars within a second), the single
 *    gap's even spread from 8 s, the grating's beams and the bells' chords from 16 s to 25 s, and the stripes forming again
 *    into the seam. (The link base: 1 gap for the first 5 s, the beams at 15–25 s, then 1 gap again; its links and the Seven
 *    Gaps card keep it.) The water has no randomness, so every seed plays this run.
 *  - beatMachine (--- beat-machine-tunes ---): the marble xylophone plays Ode to Joy (its first period, 32 beats at 100 BPM, on
 *    five bars tuned to its notes) with the note counter on, and every loop ends on the tune's chord over its bass with its
 *    name on the end banner: a loop of 34 beats, 20.4 s, so a 30 s clip is one whole loop that ends 2.4 s after the chord –
 *    the same on every seed (a tune draws no random number). A drop of 20 % instead of 28 % makes the machine's box less tall,
 *    so the five bars fill the square's width: the marbles 7.1 px in radius in the page's 450 px square (the link base's ten
 *    bars: 4.7 px). (The link base: a seeded original phrase over 10 pentatonic bars, 19.2 s, no chord; its links, the bot's
 *    no-tube-conflict plans and the Marble Xylophone card keep it, and so does the fingerprint.)
 *  - illusion (--- illusion-stage ---): the eight lines build the trick and reveal it – (D2 review) two balls across the hidden
 *    circle from the first frame, the next two at 0.5 and 1.5 s, then a ball every second on its rim touch with its note, in
 *    opposite pairs (the dim tracks of the others waiting, their slots a faint ghost of it and a bright dot on the rim), all eight
 *    by 6.25 s, the straight lines alone to 10 s, the tracks fading into the reveal at 12 s (a riser and a breath of three silent
 *    touches, then a ding, a held chord, the balls' notes rolled up and a flash as the rolling circle and its rainbow octagon come
 *    in), the end at 16.0 s under IT WAS A CIRCLE! (four cycles of 4 s; five left 6 s without a new event between the last join and
 *    the fade): the same on every seed (the seed picks only the way the circle rolls), a sound every 0.25 s but the breath. (The link base:
 *    eight balls on their lines from the first frame, a 4 s loop that never ends and never shows the circle; its links, the
 *    bot's reveal plans and the Hidden Heart card keep it, and so does the fingerprint.)
 *  - collide (--- collide-pour ---): a jar with a story – the 300 orbs drop together from a rainbow grid and squash on landing,
 *    break into chaos, pass through each other at 10 s (ANTI-COLLISION), and at 14 s the jar opens at the bottom: the opening
 *    widens from the smallest orb's width, so the small ones pour out first and the biggest last, a faint count of the orbs
 *    left, a pluck for every handful out, and EMPTY! with the completion chord. (D2 review) The pouring jar sits smaller at the
 *    square's top, so the pour is seen: a stream through the opening onto a catch floor, where the orbs heap up, the small ones
 *    at the bottom and the biggest on top; the last tenth drops together. The notes play on a 16th-note grid, swelling with the
 *    motion. Seeds 1–12 in the laptop (800 × 450) and phone (450 × 450) worlds: empty at 18.8–19.9 s on all 24 runs, median
 *    19.5 s, about 200 orbs still in at 16 s and 26–28 at 18 s, the first tenth out about half the size of the last tenth
 *    (0.42–0.58), about 24 sounds a second (the link base: 720), never more than 0.13 s without one. (The link
 *    base: a jar of orbs bouncing forever; its links, the bot's on-the-beat plans, timed by their own anti-collision second,
 *    and the fingerprint keep it.)
 *  - lines (--- string-art ---): rainbow string art that finishes – Rainbow Lines, ball speed 700 and Strings to Finish at 64: every
 *    bounce a note of the ring's circular keyboard, each bounce point tied to the next (the art) and to the ball (the fan), and at
 *    the 64th string the finished picture flashes with the completion chord under STRING ART!. Seeds 1–12, both worlds (the ring
 *    follows the shorter side): finished at 21.6–24.7 s on 24 of 24, median 23.4 s, about 2.8 notes a second, never 0.7 s without
 *    one (the link base: white strings that never end, 1.6 blips a second, up to 2.3 s without one).
 *  - paint (--- paint-full ---): the full canvas inside the clip – a ball of 12 at speed 600 with Guide to the Gaps (each rebound
 *    turned up to 30° toward the biggest patch under 97 % painted, a brush 1.3 × the ball): full at 16.9–25.0 s on 24 of 24, median
 *    19.7 s, with a chime at each quarter and the chord at the full canvas (the link base: 80 % at 30 s, full in 73–118 s; ball 12
 *    and speed 600 alone: 93 % at 30 s, full on none by 27 s).
 *  - portal (--- portal-options --- D3 review): five pairs of portals that hold three jumps each – seeds 1–60, both worlds (the ring
 *    follows the shorter side): out by 27 s on 110 of 120, median 17.5 s, 98 of them between 12 and 27 s, 4 under 8 s, the first
 *    jump at a median 0.8 s (the link base, three pairs of four: 54 of 120, median 28.1 s, 2 still in at 60 s; five pairs of four,
 *    the audit's: 80 of 120, median 23.4 s).
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
    case "box":
      return BOX_START; // --- box-finale ---
    case "glass":
      return GLASS_START; // --- glass-real ---
    // --- finales-in-clip --- (B6)
    case "hoops":
      return HOOPS_START;
    case "drawingMachine":
      return DRAWING_MACHINE_START;
    // --- end finales-in-clip ---
    case "waveTank":
      return WAVE_TANK_START; // --- wave-chapters ---
    case "beatMachine":
      return BEAT_MACHINE_START; // --- beat-machine-tunes ---
    case "illusion":
      return ILLUSION_START; // --- illusion-stage ---
    case "collide":
      return COLLIDE_START; // --- collide-pour ---
    case "lines":
      return LINES_START; // --- string-art ---
    case "paint":
      return PAINT_START; // --- paint-full ---
    case "portal":
      return PORTAL_START; // --- portal-options ---
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
/** --- box-finale --- Bouncing Shapes' start look: the square box, bigger shapes, the speeds at 4:5:6 and ball speed 575 (the finale by 27 s). */
const BOX_START: Partial<SimulatorSettings> = Object.freeze({ boxAspect: 1, boxSpeedRatio: "4:5:6", ballSpeed: 575, ballRadius: 11 } as const);
/** --- glass-real --- Glass Smash's start look: the leading camera, and gravity 500 so the smash reaches HOME inside the clip. */
const GLASS_START: Partial<SimulatorSettings> = Object.freeze({ glassLead: true, gravity: 500 } as const);
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
/** --- wave-chapters --- The Wave Tank's start look: stripes first, the beams last (one whole 30 s loop a clip). */
const WAVE_TANK_START: Partial<SimulatorSettings> = Object.freeze({ wtGaps: "2@13, 1@8, 7@9", wtWrap: 5, wtSpacing: 2.5 } as const);
/** --- beat-machine-tunes --- Beat Machines' start look: Ode to Joy on the marble xylophone, the note counter on, a shorter drop. */
const BEAT_MACHINE_START: Partial<SimulatorSettings> = Object.freeze({ bmSource: "tune", bmTune: "ode", bmCounter: true, bmDrop: 20 } as const);
/** --- illusion-stage --- The Circle Illusion's start look: the lines' staged build, revealed at 12 s, over at 16 s (D2 review: 4 cycles). */
const ILLUSION_START: Partial<SimulatorSettings> = Object.freeze({ ilStage: true, ilCycles: 4 } as const);
/** --- collide-pour --- Collision Playground's start look: the sync drop, squishy orbs, ANTI-COLLISION at 10 s, the jar pouring out from 14 s, notes on the beat. */
const COLLIDE_START: Partial<SimulatorSettings> = Object.freeze({ cpSyncStart: true, cpSquishy: true, cpAntiCollisionAt: 10, cpPourAt: 14, cpPulse: true } as const);
/** --- string-art --- Lines' start look: rainbow strings, ball speed 700, the art finished after 64 strings (about 23 s). */
const LINES_START: Partial<SimulatorSettings> = Object.freeze({ rainbowLines: true, ballSpeed: 700, lnStrings: 64 } as const);
/** --- paint-full --- Paint's start look: a ball of 12 at speed 600 with Guide to the Gaps (the full canvas in about 24 s). */
const PAINT_START: Partial<SimulatorSettings> = Object.freeze({ ballRadius: 12, ballSpeed: 600, paintGuide: true } as const);
/** --- portal-options --- (D3 review) Portal's start look: five pairs of portals that hold three jumps each (out in about 18 s). */
const PORTAL_START: Partial<SimulatorSettings> = Object.freeze({ ptCount: 5, ptUses: 3 } as const);

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
