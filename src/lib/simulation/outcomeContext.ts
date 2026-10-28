import { growFillSettingsOf, growRunFinishes } from "@/lib/physics/growFill";
import { hoopsSettingsOf } from "@/lib/physics/hoopsFields";
import { boxSettingsOf } from "@/lib/physics/modes/box";
import { csSortSettles } from "@/lib/physics/modes/colourSort";
import { doublePendulumSettingsOf } from "@/lib/physics/modes/doublePendulum";
import { dropSettingsOf } from "@/lib/physics/modes/drop";
import { flShowKind, flSideCount } from "@/lib/physics/modes/fightLeague";
import { flBestOfGames } from "@/lib/physics/modes/fightLeagueShow";
import { illusionSettingsOf } from "@/lib/physics/modes/illusion";
import { jdmRhythmFinderSettingsOf } from "@/lib/physics/modes/jdmRhythmFields";
import { landClaimSettingsOf } from "@/lib/physics/modes/landClaim";
import { orbGridNeverSettles, orbGridSettingsOf } from "@/lib/physics/modes/orbGrid";
import { pendulumSettingsOf } from "@/lib/physics/modes/pendulum";
import { polyrhythmSettingsOf } from "@/lib/physics/modes/polyrhythm";
import { vortexSettingsOf } from "@/lib/physics/modes/vortex";
import { rigNeverFinishes } from "@/lib/physics/rigged";
import { ringEscapeActive } from "@/lib/physics/ringEscape";
import type { SimulatorSettings } from "@/lib/settings";
import { effectiveBallCount } from "@/lib/teams";
import { runNeverFinishes } from "./finder";
import type { OutcomeContext } from "./outcomes";

/*
 * --- outcome-context --- What the seed finder can search for with a settings object, without a page: the OutcomeContext that
 * availableOutcomes() (outcomes.ts) reads – whether the run can end at all, "never escape", the balls the multi-ball modes
 * start with, and every mode's own switch that makes one of its outcomes searchable (Grow's fill that ends the run, the chaos
 * fan, the marble xylophone, the vortex's ring waves, the pentomino rectangles, Classic's Ring Escape options, a Colour Sort
 * rule whose sort only settles, Land Claim's pyramid, Bouncing Orbs' rhythm model, Fight League's shows).
 *
 * The Simulator page computed it inline for its Find Simulation panel; it calls this now, and so does the viral bot's
 * template planner (lib/bot/templates.ts), which checks a binding's outcome against its own settings, never the defaults. The
 * one thing a settings object does not carry is the page's state: Picture Paint's uploaded picture (`page.paintPicture`), which
 * the finder cannot replay. Pure.
 */

// --- outcome-context ---

/** What the page knows beside the settings: Picture Paint has a picture loaded (its run follows the picture and the song). */
export interface OutcomeContextPage {
  paintPicture?: boolean;
}

/** The finder's context for these settings (the page's Find Simulation panel and the bot's templates read the same one). */
export function outcomeContextOfSettings(s: SimulatorSettings, page: OutcomeContextPage = {}): OutcomeContext {
  // the run can never finish (an endless mode, Rain, the countdown off, "never escape" in a mode that ends on an escape…)
  const finderEndless =
    runNeverFinishes(s.mode, {
      drop: dropSettingsOf(s),
      box: boxSettingsOf(s),
      pendulum: pendulumSettingsOf(s),
      polyrhythm: polyrhythmSettingsOf(s),
      doublePendulum: doublePendulumSettingsOf(s),
      illusion: illusionSettingsOf(s),
      ...jdmRhythmFinderSettingsOf(s), // --- jdm-rhythm-runner ---
      vortex: vortexSettingsOf(s), // --- gerald-vortex --- (the loop)
      paintPicture: !!page.paintPicture, // --- review fix (modes-rhythm) ---
      orbGrid: orbGridSettingsOf(s), // --- orb-rhythm --- (the model decides)
      grow: growFillSettingsOf(s), // --- loop-foundation --- ("finish" ends at the fill)
      hoops: hoopsSettingsOf(s), // --- bead-hoops --- (the return loops forever)
      landClaim: landClaimSettingsOf(s), // --- land-claim-pyramid --- (a looping pyramid never ends)
    }) || rigNeverFinishes(s.mode, s);
  // --- orb-grid --- a field that never settles (the period property, no gravity): no run length to search for (the other outcomes stay)
  const orbEndless = s.mode === "orbGrid" && orbGridNeverSettles(orbGridSettingsOf(s), s.gravity);
  const flShow = s.mode === "fightLeague" ? flShowKind({ match: s.flMatch, bestOf: s.flBestOf }) : undefined; // --- fl-overhaul --- (Stage 5) the show's own outcomes
  return {
    endless: finderEndless || orbEndless,
    neverEscape: s.neverEscape,
    ballCount: effectiveBallCount(s),
    orbRhythm: s.ogModel === "rhythm", // --- orb-rhythm ---
    growFinish: s.mode === "grow" && growRunFinishes(growFillSettingsOf(s)), // --- loop-foundation ---
    flShow,
    flSides: s.mode === "fightLeague" ? flSideCount(s.flMatch, [s.flFighterA, s.flFighterB, s.flFighterC, s.flFighterD, s.flFighterE, s.flFighterF]) : 0,
    flDecider: flBestOfGames(s.flBestOf) > 1, // --- fl-overhaul --- (Stage 5)
    dpFan: s.mode === "doublePendulum" && s.dpFan, // --- chaos-fan ---
    colourSortSettles: s.mode === "colourSort" && csSortSettles(s.csRule), // --- colour-sort ---
    bmMarbles: s.mode === "beatMachine" && s.bmVariant === "marbles", // --- beat-machine ---
    vortexRings: s.mode === "vortex" && s.vxRelease === "rings", // --- funnel-spin ---
    lcPyramid: s.mode === "landClaim" && s.lcLayout === "pyramid",
    lcPyramidLoop: s.mode === "landClaim" && s.lcLayout === "pyramid" && s.lcRebuild, // --- land-claim-pyramid ---
    ringEscape: s.mode === "classic" && ringEscapeActive(s), // --- ring-escape ---
    pfPento: s.mode === "perfectFit" && s.pfVariant === "pento", // --- perfect-fit ---
  };
}
// --- end outcome-context ---
