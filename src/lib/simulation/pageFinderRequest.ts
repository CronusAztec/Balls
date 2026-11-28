import type { PhysicsConfig } from "@/lib/physics/types";
import type { OnBeatConfig } from "@/lib/physics/onBeat";
import { ctfFinderSettings, ctfSettingsOf } from "@/lib/physics/modes/arenaGames";
import { runnerSettingsOf, type RunnerBeatInput } from "@/lib/physics/modes/runner";
import { beatDropSettingsOf } from "@/lib/physics/modes/beatDrop";
import { beatMachineSettingsOf } from "@/lib/physics/beatMachine";
import { fightLeagueSettingsOf, flShowHorizonMs, flShowKind } from "@/lib/physics/modes/fightLeague";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import type { SimulatorSettings } from "@/lib/settings";
import type { FinderRequest, ModeSettings } from "@/lib/simulation/finder";
import type { FinderOutcome } from "@/lib/simulation/outcomes";

/*
 * --- page-finder-request --- (round two A2a) The page's Find Simulation request, built in one place. Its mode settings are
 * `modeSettingsOfSettings()`, the same ones the bot, the toolbox, the batch render and the fast export's engine get, so every
 * field a mode or an option adds there reaches the page's Find too. On top go only the inputs a page has and a settings
 * object does not (`PAGE_FINDER_OVERRIDES`): the loaded song's beat grid, the loaded melody, On beat as the page resolves it,
 * Capture the Flag's time limit widened to the Find panel's target, and whether Paint holds a picture.
 *
 * Before, Simulator.tsx built the request by hand and missed what came later: Lines' Strings to Finish (the Lines start look
 * read as endless, so Find said "never ends") and Paint's Guide to the Gaps (no seed in 1,000 at the start look's 21 s). The
 * split-screen search (multi.ts `arenaFinderRequest`) spreads this request, so its arenas get the same fields.
 */

/** The mode-settings keys the page sets from its own inputs, on top of `modeSettingsOfSettings()`: every other key is that one's. */
export const PAGE_FINDER_OVERRIDES = ["runner", "beatDrop", "beatMachine", "ctf", "onBeat", "paintPicture"] as const satisfies readonly (keyof ModeSettings)[];

/** What the page's Find knows that its settings do not. */
export interface PageFinderInputs {
  /** The page engine's live physics config: its world and every config effect (`{ ...engine.config }`). */
  physicsConfig: PhysicsConfig;
  /** The search's target and tolerance (s): the Find panel's, or the plan of Fight League's Make a clip. */
  targetSec: number;
  toleranceSec: number;
  maxSeeds: number;
  depthBudgetMs: number;
  /** The Find panel's own target and tolerance (s): Capture the Flag's widened time limit follows them, as it always did. */
  panelTargetSec: number;
  panelToleranceSec: number;
  /** The loaded song's beat grid the Beat Runner and Beat Drop follow (null: none, the BPM). */
  rhythmBeat: RunnerBeatInput | null;
  /** The loaded melody Beat Machines plays (empty: none). */
  melody: readonly number[];
  /** On beat as the page resolves it (a song's, a video's or the markers' grid). */
  onBeat: OnBeatConfig;
  /** A picture is loaded in Paint: Picture Paint follows the page's picture and song, so it is not searched. */
  paintPicture: boolean;
  /** --- rigged --- An outcome search instead of the run length (absent: the length). */
  outcome?: FinderOutcome;
  /** --- make-clip-start --- (A-g4 review) Perfect Fit's first solution seed to test: Make me a clip's next tilings (absent: 1). */
  solutionSeedBase?: number;
}

/** The page's mode settings for Find: the bot's and the export's for these settings, plus the page's own inputs. */
export function pageFinderModeSettings(settings: SimulatorSettings, page: Pick<PageFinderInputs, "panelTargetSec" | "panelToleranceSec" | "rhythmBeat" | "melody" | "onBeat" | "paintPicture">): ModeSettings {
  return {
    ...modeSettingsOfSettings(settings),
    runner: runnerSettingsOf(settings, page.rhythmBeat), // --- jdm-rhythm-runner --- (the course is planned for the loaded song's grid)
    beatDrop: beatDropSettingsOf(settings, page.rhythmBeat), // --- beat-drop --- (it cannot fail: the clip covers the target's beats)
    beatMachine: beatMachineSettingsOf(settings, page.melody), // --- beat-machine --- (seeded phrases are searched: a plan a seed)
    ctf: ctfFinderSettings(ctfSettingsOf(settings), page.panelTargetSec, page.panelToleranceSec), // --- jdm-arena-games --- (a time limit past the target, so a game won on the score can match it)
    onBeat: page.onBeat, // --- video-beats --- (the ring modes' flights timed onto the grid)
    paintPicture: page.paintPicture, // --- review fix (modes-rhythm) --- (Picture Paint is not searched)
  };
}

/** The page's Find Simulation request for these settings. */
export function pageFinderRequest(settings: SimulatorSettings, page: PageFinderInputs): FinderRequest {
  // --- fl-overhaul --- (Stage 5: a show, FL_SHOW_BOUT_SEC a match; Stage 6: raised by it, 90 s × bouts on top of the target)
  const showSec = settings.mode === "fightLeague" && flShowKind({ match: settings.flMatch, bestOf: settings.flBestOf }) !== "single" ? flShowHorizonMs(fightLeagueSettingsOf(settings)) / 1000 : 0;
  return {
    targetDurationSec: page.targetSec,
    toleranceSec: page.toleranceSec,
    maxSeeds: page.maxSeeds,
    depthBudgetMs: page.depthBudgetMs, // --- finder-depth --- (nothing in the first 1,000 seeds: on while the budget lasts, when seeds are cheap)
    maxSimTimeSec: page.targetSec + (settings.mode === "colorMatch" ? 90 : 30) + showSec,
    physicsConfig: page.physicsConfig,
    mode: settings.mode,
    modeSettings: pageFinderModeSettings(settings, page),
    ...(page.outcome ? { outcome: page.outcome } : {}), // --- rigged ---
    ...(page.solutionSeedBase !== undefined ? { solutionSeedBase: page.solutionSeedBase } : {}), // --- make-clip-start --- (A-g4 review)
  };
}
// --- end page-finder-request ---
