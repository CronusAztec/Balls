import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";

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
 *  - mergeRing: 6 tiers, a ball every 0.6 s – FINAL FORM on 40 of 40 seeds at 17.0–26.5 s (7 tiers at 0.9 s: 44–76 s, 13 of
 *    24 an overflow).
 *  - spiralGlass: glass of 1 hit – GLASS CLEARED on 40 of 40 at 22.9–24.7 s (2 hits: 31.7–33.2 s), the first multiply at 7.3 s
 *    (11.1 s).
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
      return { mrTiers: 6, mrInterval: 0.6 };
    case "spiralGlass":
      return { sgGlassHp: 1 };
    default:
      return NONE;
  }
}

const NONE: Partial<SimulatorSettings> = Object.freeze({});

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
 */
export function clipStartSettings(mode: ModeId): Partial<SimulatorSettings> {
  switch (mode) {
    case "classic":
      return CLASSIC_START;
    case "accumulation":
      return ACCUMULATION_START;
    default:
      return NONE;
  }
}
const CLASSIC_START: Partial<SimulatorSettings> = Object.freeze({ gapSize: 1, ballSpeed: 500, screenShake: 0.3, showGlow: true, wallBreakStyle: "all", ringSound: true } as const);
const ACCUMULATION_START: Partial<SimulatorSettings> = Object.freeze({ accumulationTime: 3, gapSize: 0.35, ballSpeed: 450, showGlow: true } as const);

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
