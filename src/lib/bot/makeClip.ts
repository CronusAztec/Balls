import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { DEFAULT_FIND_SEC, clipPacingFindSec } from "@/lib/clipPacing"; // --- make-clip-start ---
import { startSettings } from "@/lib/studioLooks"; // --- make-clip-start ---
import { availableOutcomes, effectiveOutcome, type FinderOutcomeKind } from "@/lib/simulation/outcomes"; // --- make-clip-start ---
import { outcomeContextOfSettings } from "@/lib/simulation/outcomeContext"; // --- make-clip-start ---
import { PF_FINDER_TRIES } from "@/lib/simulation/perfectFitFinder"; // --- make-clip-start --- (A-g4 review: Perfect Fit's next tilings)
import { hashString } from "./planner";
import type { BotPlatform } from "./playbook";
import { readyTemplates, templateById, templatePlayOf, type TemplateInfo } from "./templates";

/*
 * --- make-clip --- "Make me a clip": the studio's one press into a finished clip of the page's mode (the Mode block's starter
 * area, the ready screen and a studio address with `?make=1`). A press makes one of two kinds of clip, and both stay on the
 * page's mode:
 *  - "template": one of the mode's own ready templates (templates.ts) that ends resolved, planned with the planner's own search
 *    (useViralBot.ts makeClip: planTemplateSteps, the template's Simple look) and opened: its settings, its hook, its melody, its
 *    seed pinned and the clip length its run needs. The mode's templates that end resolved come first.
 *  - (--- make-clip-start --- round two A7) "start": a mode whose own templates cannot end resolved (they cut before the payoff,
 *    on purpose: templates.ts ENDS_AT_ESCAPE and ENDS_AT_FINISH) or that has none. The press puts the page's start look on
 *    (lib/studioLooks.ts startSettings), runs the page's own Find Simulation at the look's target (lib/clipPacing.ts
 *    clipPacingFindSec), pins the found seed and sets the clip length to the run and its end hold, as Find does (Simulator.tsx
 *    runFinderWith). No hook: the run's own finale ends the clip. A start look whose run is a fixed loop is played as it is.
 *    Before, such a mode got another mode's clip (lines, paint, race …) or a clip cut before its finale (target, portal …).
 *    (A-g4 review) The press takes off what the start look has not (the melody, Paint's picture, whose run never ends), and a
 *    press that finds nothing or is stopped puts the page back as it was (useViralBot.ts makeStartClip), as a template's does.
 * "Another" is the next turn: the mode's next template and a new plan seed, or a new Find on the start look (a new seed;
 * Perfect Fit's next solution seeds). A fixed loop has no other clip, so its button never says "Another clip" (`makeClipAsIs`).
 * templates.ts stays as it is: the crew's corpus and the bot's digests pin its plans.
 */

/** The studio address's switch: `?make=1` makes a clip as the page opens. */
export const MAKE_PARAM = "make";

/** The ending a made clip asks for: the run's payoff inside the clip, where the template plays it (else its own: resolveEnding). */
export const MAKE_CLIP_ENDING = "resolved" as const;

/** --- make-clip-start --- What a press makes: a template's planned clip, or the mode's start look on a run Find found. */
export type MakeClipKind = "template" | "start";

/** The templates a press can plan on `platform`: the ready ones that plan a length it takes, those that end resolved first. */
function playable(templates: readonly TemplateInfo[], platform: BotPlatform): string[] {
  const fits = templates.filter((t) => templatePlayOf(t.id)?.platforms.includes(platform) === true);
  const resolved = (t: TemplateInfo) => templatePlayOf(t.id)?.endings.includes(MAKE_CLIP_ENDING) === true;
  return [...fits.filter(resolved), ...fits.filter((t) => !resolved(t))].map((t) => t.id);
}

/**
 * The mode's own ready templates that play on `platform`, those that end resolved first (`own`: it has one). (--- make-clip-start
 * --- round two A7) No other mode's: a mode without one gets a start clip (`makeClipKind`).
 */
export function makeClipTemplates(mode: ModeId, platform: BotPlatform): { own: boolean; ids: string[] } {
  const ids = playable(
    readyTemplates("all").filter((t) => t.mode === mode),
    platform,
  );
  return { own: ids.length > 0, ids };
}

// --- make-clip-start --- (round two A7)
/** The kind of clip a press makes for `mode` on `platform`: a template's while one of the mode's own ends resolved, else a start clip. */
export function makeClipKind(mode: ModeId, platform: BotPlatform): MakeClipKind {
  return makeClipTemplates(mode, platform).ids.some((id) => templatePlayOf(id)?.endings.includes(MAKE_CLIP_ENDING) === true) ? "template" : "start";
}

/** The tolerance of a start clip's Find (s): the Find panel's own default, the one every target below was measured with. */
export const MAKE_CLIP_TOLERANCE_SEC = 0.5;

/**
 * The start looks whose run is a fixed loop, played as they are with their own clip length: the Wave Tank's 30 s chapters (the
 * finder reads the water as endless; it has no randomness) and Beat Machines' tune, one 20.4 s loop that ends on its chord (the
 * same on every seed: a tune draws no random number; the finder's search is over seeded phrases, which the tune replaces).
 */
export const MAKE_CLIP_AS_IS: ReadonlySet<ModeId> = new Set<ModeId>(["waveTank", "beatMachine"]);

/**
 * (A-g4 review) Whether a press on `mode` plays its start look as it is (`MAKE_CLIP_AS_IS`): every press makes the same clip, so
 * the button says nothing of another one, and the note says what the press does instead of a run it finds.
 */
export function makeClipAsIs(mode: ModeId, platform: BotPlatform): boolean {
  return MAKE_CLIP_AS_IS.has(mode) && makeClipKind(mode, platform) === "start";
}

/**
 * A start clip's target (s) where the page's own (`clipPacingFindSec`) is the page's 30 and no run of the start look comes near
 * it: Ball Drop and Land Claim start on their link base, whose runs end far inside 30 s. Seeds 1–60 in the page's two worlds
 * (800 × 450 and 450 × 450), through the page's own request (lib/simulation/pageFinderRequest.ts), as the target at or above
 * the Find slider's 10 s with the most runs within ± 0.5 s (the first of a tie), as lib/clipPacing.ts picks its targets:
 *  - drop 14.5 (37 of 120; 30 s: 0): every run over at 12.5–17.6 s, median 14.5 s;
 *  - landClaim 10 (64 of 120; 30 s: 0): every battle decided at 9.0–12.4 s, median 10.3 s.
 * The page's Find panel keeps its own target: only the press searches here.
 */
const MAKE_CLIP_FIND_SEC: Readonly<Partial<Record<ModeId, number>>> = Object.freeze({ drop: 14.5, landClaim: 10 });

/** A start clip's Find: its target and tolerance (s), and the search when it is not the run's length. */
export interface MakeClipFind {
  targetSec: number;
  toleranceSec: number;
  /**
   * The Find panel's own search on the start look when a run has no length to search (lib/simulation/outcomes.ts
   * `effectiveOutcome`): Perfect Fit's loop, whose Find picks the solution with the most pieces on the floor and fits whole loops
   * to the target. Absent: the run's length, as on every other start look.
   */
  outcome?: FinderOutcomeKind;
  /**
   * (A-g4 review) The first solution seed Perfect Fit's search tests (the finder's `solutionSeedBase`; absent: 1, the Find
   * panel's own). Its search picks the tiling with the most pieces on the floor of the next `PF_FINDER_TRIES` seeds from here,
   * the same on every press from seed 1, so each "Another clip" starts after the last one's: the next best tiling.
   */
  seedBase?: number;
}

/**
 * The Find a start clip runs on `settings` (the mode's start look) on press number `turn` (0 first), or null: a fixed loop, played
 * as it is (`MAKE_CLIP_AS_IS`).
 */
export function makeClipFind(settings: SimulatorSettings, turn = 0): MakeClipFind | null {
  if (MAKE_CLIP_AS_IS.has(settings.mode)) return null;
  const own = clipPacingFindSec(settings);
  // the search the Find panel starts the look on (an outcome a visitor picked is their own search, never the press's)
  const outcome = effectiveOutcome("duration", availableOutcomes(settings.mode, outcomeContextOfSettings(settings)));
  const at = Math.max(0, Math.floor(turn));
  return {
    targetSec: own === DEFAULT_FIND_SEC ? (MAKE_CLIP_FIND_SEC[settings.mode] ?? own) : own,
    toleranceSec: MAKE_CLIP_TOLERANCE_SEC,
    ...(outcome && outcome !== "duration" ? { outcome } : {}),
    ...(outcome === "most-on-floor" && at > 0 ? { seedBase: 1 + at * PF_FINDER_TRIES } : {}), // (A-g4 review) Perfect Fit's next tilings
  };
}
// --- end make-clip-start ---

/** One press: the template and the plan seed of a template's clip, or (--- make-clip-start ---) the start look and its Find. */
export type MakeClipPick =
  | {
      kind: "template";
      template: string;
      /** The template's mode: the page's own. */
      mode: ModeId;
      /** The planner's seed for this press (the same mode, turn and salt give the same clip). */
      planSeed: number;
    }
  | {
      kind: "start";
      mode: ModeId;
      /** The page's start look of the mode (lib/studioLooks.ts startSettings). */
      settings: SimulatorSettings;
      /** The Find the page runs on it (null: a fixed loop, played as it is). */
      find: MakeClipFind | null;
      /** The seed pinned when the look is played as it is (the same mode, turn and salt give the same one). */
      seed: number;
    };

/**
 * Press number `turn` (0 first, then each "Another") for `mode`; `salt` is the page's own (a fresh one per visit), so visits get
 * different clips and a press is the same within one. Null: nothing to make (a template that no longer reads).
 */
export function makeClipPick(mode: ModeId, platform: BotPlatform, turn: number, salt: string): MakeClipPick | null {
  const at = Math.max(0, Math.floor(turn));
  // --- make-clip-start --- (round two A7) a mode without a template that ends resolved plays its start look
  if (makeClipKind(mode, platform) === "start") {
    const settings = startSettings(mode);
    return { kind: "start", mode, settings, find: makeClipFind(settings, at), seed: 1 + (hashString(`make|${mode}|${salt}|${at}`) % 100_000) };
  }
  const { ids } = makeClipTemplates(mode, platform);
  if (ids.length === 0) return null;
  // (the mode's own templates in their order, the best first)
  const template = ids[at % ids.length];
  const info = templateById(template);
  if (!info) return null;
  return { kind: "template", template, mode: info.mode, planSeed: hashString(`make|${template}|${salt}|${at}`) };
}

/** Whether a studio address asks for a clip as the page opens (`?make=1`). */
export function wantsMadeClip(search: string): boolean {
  return new URLSearchParams(search).get(MAKE_PARAM) === "1";
}
