import { MULTI_BALL_MODES, type BallStats } from "@/lib/physics/ballStats";
import { BATTLE_WINNER_MODES, RIG_ESCAPE_MODES, neverEscapeApplies } from "@/lib/physics/rigged"; // --- odd-string-battle --- (BATTLE_WINNER_MODES)
import type { ModeId } from "@/lib/physics/types";
import { teamResult } from "@/lib/teams";
import { LC_CLOSE } from "@/lib/physics/modes/landClaim"; // --- land-claim ---
import { FL_CLOSE } from "@/lib/physics/modes/fightLeagueShow"; // --- fl-overhaul --- (Stage 5)
import type { FlRunSummary } from "@/lib/physics/modes/fightLeague"; // --- fl-overhaul --- (Stage 5)

/**
 * Rigged outcomes for Find Simulation: besides a run of an exact length ("duration", the finder's classic search), the
 * seed finder can look for a run in which something happens – or never does:
 *
 * - **never-escapes**: no ball leaves the outer wall for the whole clip (and the run does not end before it),
 * - **escapes-at**: the first escape comes within ±0.5 s of a target time,
 * - **winner** (teams): the chosen team tops the scoreboard (escapes, then walls, then bounces, then the earlier first
 *   escape) when the run ends – or when the clip does, for a run that goes on – with no tie. In the modes that end on
 *   an escape the first team out wins, so this is "escapes first or has the top score". In the battle modes
 *   (`BATTLE_WINNER_MODES`) the winner is the last ball standing: the run is followed past the clip to the battle's end
 *   (`winnerNeedsEnd()`), and only a finished battle whose verdict crowned the chosen ball matches – never one that ended
 *   with nobody standing (`RunSummary.doubleKo`: String Battle's last balls shattering in the same step share the verdict).
 *
 * Everything here is pure: a headless run is boiled down to a `RunSummary` (finder.ts simulates it) and the predicates
 * judge it, so they can be tested on synthetic runs. Times are real (recording) time – what the clip shows.
 *
 * --- orb-grid --- Bouncing Orbs adds two of its own: **never-settles** (the field is still bouncing when the clip ends – it
 * came to rest at no moment of the clip, `RunSummary.settledMs`) and **resolves-at** (the first "in phase" moment of the
 * field – the resolve detector of modes/orbGrid.ts – comes within ±0.5 s of a target time).
 *
 * --- fight-league --- Fight League adds **double-ko**: the fight ends with its last two sides going down together (the run
 * is followed to its end, like a battle's winner).
 *
 * --- loop-foundation --- Grow's fill and loop adds two, while a fill ends the run ("finish"): **fills-by** – the ball fills
 * the circle within a time limit (`atSec`) – and **fill-on-bar** – the fill lands within `toleranceSec` (one 60 fps frame by
 * default) of a bar line of the song's tempo (`atSec` is the bar's length), so the completion chord hits on a downbeat.
 *
 * --- chord-stars --- Chord Stars adds **star-set**: its stars always close together, so the search is for the best-looking
 * star set and the drawing time that fits the clip in whole loops (starChordsFinder.ts; no seed is simulated).
 *
 * --- bead-hoops --- Spinning Hoops adds two: **lift-order** – the first cycle's beads leave their bottoms in strict size order,
 * the biggest hoop's first (at least one lift; a bigger hoop's bead never comes after a smaller one's) – and **all-up-by** –
 * every bead is up within a time limit (`atSec`).
 *
 * --- chaos-fan --- The Double Pendulum's chaos fan adds **diverges-at**: the fan first splits – a bob `divergePx` from the
 * leader's – within ±`toleranceSec` (0.5 s) of a target second, the window [a, b] the split must land in.
 *
 * --- ellipse-foci --- Focus Shot adds two (no seed's length to search: its loop goes on forever): **converge-on-beat** – every
 * convergence on a bar line: the transit becomes a whole number of bars of the song's tempo (`atSec` is the bar's length) and
 * the clip a whole number of loops – and **longest-collapse** – the start angle whose swarm takes the most passes to narrow under
 * two ball radii (ellipseFociFinder.ts; no seed is simulated, the seed only colours the run).
 *
 * --- funnel-spin --- The Sound Vortex's ring release adds **ring-on-bar**: the last ring of a cycle vanishes into the hole within
 * `toleranceSec` (±20 ms by default) of a bar line of the song's tempo (`atSec` is the bar's length); the wave interval and the
 * spin friction are searched, not seeds (funnelSpinFinder.ts).
 *
 * --- colour-sort --- Colour Sort adds three of its first sort (the run itself loops forever): **sorted-by** – every ball is
 * sorted within a time limit (`atSec`) –, **last-colour** – the final ball sorted is of the chosen colour (`team`: its index,
 * the core's colour 0 outward) – and **sorted-on-bar** – the final ball is sorted within `toleranceSec` (±20 ms by default) of
 * a bar line of the song's tempo (`atSec` is the bar's length), so the completion chord lands on a downbeat.
 *
 * --- fl-overhaul --- (Stage 5) Fight League's story adds its own, judged on the run's deciding match (`RunSummary.fl`, the run
 * followed to its end like a double KO): **upset** (the winner's simulated win chance under 40 % at the bout's start),
 * **clutch** (the winner ends at ≤ 10 % of its HP), **perfect** (no HP lost, nothing absorbed by the rig), **comeback** (the winner
 * trailed by 40 % of HP share), **ability-finish** (the final KO by an ability), **lead-changes** (at least `count` flips of the
 * lead), **both-low-at** (the cliffhanger: every side at ≤ 25 % with the fight still on within ±0.5 s of `atSec` – the clip is
 * cut there), **decider** (a series goes the distance), **sudden** (decided in sudden death), **champion** (a bracket won by the
 * pinned entrant `team`) and **boss-falls-at** (the boss falls at wave `count`); **close** takes the winner's HP share as its
 * margin (≤ FL_CLOSE).
 *
 * --- beat-machine --- Beat Machines' marble xylophone adds two (every note lands on its beat by construction, so the seeds
 * write the tune instead): **no-tube-conflict** – the first seeded phrase whose tubes never need a spare marble (a marble is
 * always back before its tube's next note) – and **most-in-flight** – the phrase with the most marbles out at once
 * (beatMachineFinder.ts; a plan per seed, nothing simulated).
 *
 * --- land-claim-pyramid --- Land Claim's pyramid adds **summit-last** – the first cycle's summit falls last: the centre column
 * is the last one standing (`RunSummary.summitLeft` 0: no block stood elsewhere when the summit's last block fell). The run is
 * followed to its first cycle's end (cleared, or out of time); a looping pyramid's clip is that whole cycle.
 *
 * --- perfect-fit --- Perfect Fit adds two (every box ends exactly full by construction, so nothing about the run is left to
 * chance): **most-on-floor** – the rectangles' solution seed whose pieces land on the box's floor most often – and
 * **landings-on-beat** – every landing on the beat of the page's tempo (the page turns Land on the beat on; perfectFitFinder.ts,
 * a plan per seed, nothing simulated).
 *
 * --- ring-escape --- Classic's Ring Escape adds **ring-at**: the first ring escaped – the innermost broken, the hook "it takes
 * three seconds to get through the first one" – within ±`toleranceSec` (0.5 s) of a target second (`RunSummary.firstRingMs`); a
 * match is followed to the run's end, so the clip is the whole escape.
 */

export const FINDER_OUTCOMES = ["duration", "never-escapes", "escapes-at", "winner", "never-settles", "resolves-at", "double-ko", "close", "fills-by", "fill-on-bar", "star-set", "lift-order", "all-up-by", "diverges-at" /* --- chaos-fan --- */, "converge-on-beat", "longest-collapse", "sorted-by", "last-colour", "sorted-on-bar", /* --- fl-overhaul --- (Stage 5) */ "upset", "clutch", "perfect", "comeback", "ability-finish", "lead-changes", "both-low-at", "decider", "sudden", "champion", "boss-falls-at", "no-tube-conflict", "most-in-flight" /* --- beat-machine --- */, "ring-on-bar" /* --- funnel-spin --- */, "summit-last" /* --- land-claim-pyramid --- */, "ring-at" /* --- ring-escape --- */, "most-on-floor", "landings-on-beat" /* --- perfect-fit --- */] as const; // --- orb-grid --- (never-settles, resolves-at) --- fight-league --- (double-ko) --- land-claim --- (close) --- loop-foundation --- (fills-by, fill-on-bar) --- chord-stars --- (star-set) --- bead-hoops --- (lift-order, all-up-by) --- chaos-fan --- (diverges-at) --- ellipse-foci --- (converge-on-beat, longest-collapse) --- colour-sort --- (sorted-by, last-colour, sorted-on-bar)
/** --- fl-overhaul --- (Stage 5) Fight League's story outcomes (judged on `RunSummary.fl`; the run followed to its end, both-low-at to its window). */
export const FL_STORY_OUTCOMES: readonly FinderOutcomeKind[] = ["upset", "clutch", "perfect", "comeback", "ability-finish", "lead-changes", "both-low-at", "decider", "sudden", "champion", "boss-falls-at"];
export type FinderOutcomeKind = (typeof FINDER_OUTCOMES)[number];

export function isFinderOutcome(value: unknown): value is FinderOutcomeKind {
  return typeof value === "string" && (FINDER_OUTCOMES as readonly string[]).includes(value);
}

/** How close (seconds) the first escape has to come to the "escapes at" target. */
export const ESCAPE_AT_TOLERANCE_SEC = 0.5;
/**
 * After a matching first escape the run is followed this much longer (ms) to learn how long the clip should be – the
 * modes that end on an escape finish a moment later (Classic once the ball is off-screen).
 */
export const ESCAPE_TAIL_MS = 5000;

export interface FinderOutcome {
  kind: FinderOutcomeKind;
  /** The clip (seconds): never-escapes must survive it, winner judges the scoreboard at its end at the latest (a battle's at the battle's end), escapes-at records at least it. */
  clipSec: number;
  /** escapes-at: when the first escape should come (seconds) and how close (± seconds; ESCAPE_AT_TOLERANCE_SEC by default). */
  atSec?: number;
  toleranceSec?: number;
  /** winner: the team slot that must win. */
  team?: number;
  /** --- fl-overhaul --- (Stage 5) lead-changes: the fewest lead changes (from 1); boss-falls-at: the wave the boss falls at (from 1). */
  count?: number;
  // --- fl-overhaul --- (Stage 6) Make a clip's constraints (lib/physics/modes/fightLeagueClip.ts)
  /** The run also ends (its own finish – Fight League's final KO) inside this window (seconds): a story with its KO at 82–88 % of the clip. */
  finishWithin?: { fromSec: number; toSec: number };
  /** both-low-at: the fight is still on when the window closes (the clip cut there leaves the question open). */
  cutWhileOn?: boolean;
  // --- end fl-overhaul ---
}

/** What a headless run of one seed amounted to (see `simulateOutcomeRun()` in finder.ts). */
export interface RunSummary {
  /** The mode the run was simulated in (a battle's winner is judged at its end – `winnerNeedsEnd()`); absent: any other mode. */
  mode?: ModeId;
  /** Real time simulated (ms): until the run finished, or until the search stopped following it. */
  durationMs: number;
  /** The run ended (the mode's own finish) within `durationMs`. */
  finished: boolean;
  /** Real time (ms) of the first escape of any ball, −1 when none came. */
  firstEscapeMs: number;
  /** The team totals at the end (one entry per team slot in play). */
  teams: readonly Readonly<BallStats>[];
  // --- orb-grid ---
  /** Real time (ms) of the field's first "in phase" moment (Bouncing Orbs' resolve detector), −1 or absent when none came. */
  firstResolveMs?: number;
  /**
   * Real time (ms) the field came to rest – its last orb settled, the canvas' ALL SETTLED banner – −1 or absent while an orb
   * still bounces. The mode's own end (`finished`) comes `SETTLE_HOLD_MS` (1.5 s) later, so a field at rest within the clip's
   * last 1.5 s ends only past the clip: never-settles goes by this moment, not by the end.
   */
  settledMs?: number;
  // --- end orb-grid ---
  // --- fight-league ---
  /**
   * Fight League: the run ended with a double KO (its last sides down in the same step). --- odd-string-battle --- String
   * Battle: its last balls shattered in the same step – nobody is left standing, and the mode shares the verdict between them
   * (the kills, then the bounces), so it may crown one of them.
   */
  doubleKo?: boolean;
  // --- end fight-league ---
  /** --- land-claim --- A finished battle's gap between its top two, as a share of the land (Land Claim's verdict); absent elsewhere. */
  margin?: number;
  /** --- loop-foundation --- Real time (ms) of Grow's first fill (the ball full), −1 or absent when none came. */
  firstFillMs?: number;
  // --- bead-hoops ---
  /** Spinning Hoops: real time (ms) every bead was first up, −1 or absent when that never came. */
  allUpMs?: number;
  /** Spinning Hoops: the first cycle's beads lifted in strict size order (decided, at least one lift). */
  liftOrderOk?: boolean;
  // --- end bead-hoops ---
  /** --- chaos-fan --- The chaos fan: real time (ms) it first split (a bob `divergePx` from the leader's), −1 or absent when it never did. */
  divergeMs?: number;
  // --- colour-sort ---
  /** Colour Sort: real time (ms) its first sort was complete (every ball in its own band), −1 when the time limit or the equilibrium ended it first or it has not ended. */
  sortedMs?: number;
  /** Colour Sort: the colour (0 = the core's) of the final ball its first sort sorted, −1 without a complete sort. */
  lastColour?: number;
  /** Colour Sort: the first cycle's length (ms) – the sort, the chord's hold and the remix back to frame 0 – once the sort ended. */
  cycleMs?: number;
  // --- end colour-sort ---
  /** --- fl-overhaul --- (Stage 5) Fight League's story of the run (`flRunSummary()`): the deciding match's and the show's. */
  fl?: FlRunSummary;
  // --- land-claim-pyramid ---
  /** Land Claim's pyramid: the blocks still standing elsewhere when the first cycle's summit fell (0: it fell last), −1 when it never fell. */
  summitLeft?: number;
  /** Land Claim's pyramid: when the first cycle's summit fell (real time, ms), −1 when it never did. */
  summitMs?: number;
  // --- end land-claim-pyramid ---
  /** --- ring-escape --- Classic: real time (ms) the first ring was escaped, −1 or absent when none was. */
  firstRingMs?: number;
}

// --- land-claim ---
/**
 * The modes whose verdict can be a close battle – the top two within `CLOSE_BATTLE_MARGIN` of the land when the run ends (Land
 * Claim's SUCH A CLOSE BATTLE): the "close" outcome searches for one, following every run to its end.
 */
export const CLOSE_BATTLE_MODES: readonly ModeId[] = ["landClaim", "fightLeague" /* --- fl-overhaul --- (Stage 5: the winner's HP share) */];
/** The gap (a share of the land) under which the top two of a battle make a close one: Land Claim's `LC_CLOSE`. */
export const CLOSE_BATTLE_MARGIN = LC_CLOSE;
/** --- fl-overhaul --- (Stage 5) A close battle's margin in `mode`: Fight League's winner's HP share at most FL_CLOSE, Land Claim's gap CLOSE_BATTLE_MARGIN. */
export function closeBattleMargin(mode: ModeId | undefined): number {
  return mode === "fightLeague" ? FL_CLOSE : CLOSE_BATTLE_MARGIN;
}
// --- end land-claim ---

/**
 * Whether the winner outcome follows a run of `mode` to its end: the battle modes (`BATTLE_WINNER_MODES`), whose winner
 * is the last ball standing – crowned (an escape in the team stats) only when the battle is over. Whoever leads a battle
 * still going when the clip ends may well lose it later, so the clip cannot be the verdict there.
 */
export function winnerNeedsEnd(outcome: Pick<FinderOutcome, "kind">, mode: ModeId | undefined): boolean {
  return outcome.kind === "winner" && mode !== undefined && BATTLE_WINNER_MODES.includes(mode);
}

/**
 * How far the run of `outcome` is simulated at most (ms); `maxSimMs` bounds the classic duration search – and a battle's
 * winner search (`winnerNeedsEnd()`), which follows the battle past the clip to its end.
 */
export function outcomeHorizonMs(outcome: FinderOutcome, maxSimMs: number, mode?: ModeId): number {
  const clipMs = 1000 * outcome.clipSec;
  switch (outcome.kind) {
    case "never-escapes":
      return clipMs;
    case "winner":
      return winnerNeedsEnd(outcome, mode) ? Math.max(clipMs, maxSimMs) : clipMs;
    case "double-ko": // --- fight-league --- (the fight is followed to its end)
      return Math.max(clipMs, maxSimMs);
    case "close": // --- land-claim --- (the verdict comes at the run's end)
      return Math.max(clipMs, maxSimMs);
    case "fills-by": // --- loop-foundation --- (until the limit has passed without a fill)
      return 1000 * (outcome.atSec ?? 0) + FILL_SLACK_MS;
    case "fill-on-bar": // --- loop-foundation --- (until the fill)
      return Math.max(clipMs, maxSimMs);
    case "lift-order": // --- bead-hoops --- (until the first cycle's order is decided)
      return Math.max(clipMs, maxSimMs);
    case "all-up-by": // --- bead-hoops --- (until the limit has passed without every bead up)
      return 1000 * (outcome.atSec ?? 0) + FILL_SLACK_MS;
    case "diverges-at": // --- chaos-fan --- (until the window has passed without a split)
      return 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + FILL_SLACK_MS;
    case "sorted-by": // --- colour-sort --- (until the limit has passed without a complete sort)
      return 1000 * (outcome.atSec ?? 0) + SORT_SLACK_MS;
    // --- fl-overhaul --- (Stage 5) the story is judged at the run's end; the cliffhanger until its window has passed
    case "both-low-at":
      return 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + FILL_SLACK_MS;
    case "last-colour": // --- colour-sort --- (until the first sort ends: the finder adds the mode's time limit)
    case "summit-last": // --- land-claim-pyramid --- (until the first cycle ends: the finder adds the run's duration)
    case "sorted-on-bar":
    case "upset":
    case "clutch":
    case "perfect":
    case "comeback":
    case "ability-finish":
    case "lead-changes":
    case "decider":
    case "sudden":
    case "champion":
    case "boss-falls-at":
      return Math.max(clipMs, maxSimMs);
    case "ring-at": // --- ring-escape --- (until the window has passed without a ring, or the end of a matching run)
      return Math.max(clipMs, maxSimMs);
    case "escapes-at":
      // Until the target has passed without an escape, or a moment after a matching one (the run's own end).
      return 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + ESCAPE_TAIL_MS;
    // --- orb-grid --- the clip (still bouncing at its end?); until the target's window has passed (the first resolve)
    case "never-settles":
      return clipMs;
    case "resolves-at":
      return 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + RESOLVE_SLACK_MS;
    default:
      return maxSimMs;
  }
}

// --- orb-grid ---
/** How far past the resolve target's window (ms) a resolves-at run is followed (the detector reports a step late at most). */
export const RESOLVE_SLACK_MS = 50;
// --- end orb-grid ---

// --- loop-foundation ---
/** How close (seconds) a fill has to land to a bar line for fill-on-bar: one frame at 60 fps. */
export const FILL_BAR_TOLERANCE_SEC = 1 / 60;
/** How far past the fills-by limit (ms) a run is followed: one 60 Hz step (the fill is seen at the end of its step). */
export const FILL_SLACK_MS = 1000 / 60;
/** The length (s) of a bar of four beats at `bpm` (2 s at 120 BPM; a bad tempo counts as 120). */
export function barSeconds(bpm: number): number {
  return 240 / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120);
}
/** How far (ms) `atMs` lies from the nearest bar line of bars `barMs` long (lines at 0, barMs, 2·barMs…). */
export function barLineDistanceMs(atMs: number, barMs: number): number {
  if (!(barMs > 0) || !Number.isFinite(atMs)) return Infinity;
  const k = Math.round(atMs / barMs);
  return Math.abs(atMs - k * barMs);
}
/** fill-on-bar: the first fill (ms) lands on a bar line – at least the first one – within the tolerance. */
function fillOnBar(outcome: FinderOutcome, fillMs: number): boolean {
  const barMs = 1000 * (outcome.atSec ?? barSeconds(120));
  const tolMs = 1000 * (outcome.toleranceSec ?? FILL_BAR_TOLERANCE_SEC);
  return fillMs >= 0 && fillMs >= barMs - tolMs && barLineDistanceMs(fillMs, barMs) <= tolMs + 1e-6;
}
// --- end loop-foundation ---

// --- colour-sort ---
/** How close (seconds) the final ball has to be sorted to a bar line for sorted-on-bar: ±20 ms. */
export const SORT_BAR_TOLERANCE_SEC = 0.02;
/** How far past the sorted-by limit (ms) a run is followed: one 60 Hz step (the sort is seen at the end of its step). */
export const SORT_SLACK_MS = 1000 / 60;
/** sorted-on-bar: the first complete sort (ms) lands on a bar line – at least the first one – within the tolerance. */
function sortedOnBar(outcome: FinderOutcome, sortedMs: number): boolean {
  const barMs = 1000 * (outcome.atSec ?? barSeconds(120));
  const tolMs = 1000 * (outcome.toleranceSec ?? SORT_BAR_TOLERANCE_SEC);
  return sortedMs >= 0 && sortedMs >= barMs - tolMs && barLineDistanceMs(sortedMs, barMs) <= tolMs + 1e-6;
}
// --- end colour-sort ---

/**
 * Whether a run being simulated can stop now: its outcome is settled (`elapsedMs` real time so far, `firstEscapeMs`
 * the first escape or −1, `finished` the mode's own end). A battle's winner is settled only by its end (`winnerNeedsEnd()`).
 * --- orb-grid --- `firstResolveMs` / `settledMs`: the field's first "in phase" moment / the moment it came to rest (−1: not yet).
 */
export function outcomeSettled(outcome: FinderOutcome, elapsedMs: number, firstEscapeMs: number, finished: boolean, mode?: ModeId, firstResolveMs = -1, settledMs = -1 /* --- orb-grid --- */, firstFillMs = -1 /* --- loop-foundation --- */): boolean {
  if (finished) return true;
  switch (outcome.kind) {
    // --- loop-foundation --- the first fill has come, or (fills-by) the limit has passed without one
    case "fills-by":
      return firstFillMs >= 0 || elapsedMs > 1000 * (outcome.atSec ?? 0) + FILL_SLACK_MS - 1e-6;
    case "fill-on-bar":
      return firstFillMs >= 0;
    // --- orb-grid --- still bouncing at the clip's end (a field that came to rest has missed it – its end, a hold later, may
    // fall past the clip); the first resolve has come (in the window or not) or the window is past
    case "never-settles":
      return settledMs >= 0 || elapsedMs >= 1000 * outcome.clipSec;
    case "resolves-at":
      return firstResolveMs >= 0 || elapsedMs > 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + RESOLVE_SLACK_MS;
    case "never-escapes":
      return firstEscapeMs >= 0 || elapsedMs >= 1000 * outcome.clipSec;
    case "escapes-at": {
      const tol = 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC);
      const at = 1000 * (outcome.atSec ?? 0);
      if (firstEscapeMs < 0) return elapsedMs > at + tol; // too late already
      if (Math.abs(firstEscapeMs - at) > tol) return true; // too early (or late)
      return elapsedMs >= firstEscapeMs + ESCAPE_TAIL_MS; // a match: follow it a moment longer (the run may end)
    }
    case "winner":
      return !winnerNeedsEnd(outcome, mode) && elapsedMs >= 1000 * outcome.clipSec;
    case "both-low-at": // --- fl-overhaul --- (Stage 5) the window has passed (a moment in it stops the run in finder.ts)
      return elapsedMs > 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + FILL_SLACK_MS - 1e-6;
    default:
      return false;
  }
}

/** --- fl-overhaul --- (Stage 5) Whether a Fight League run's story achieved `outcome` (the run finished; both-low-at in its window). */
function flStoryMatches(outcome: FinderOutcome, run: RunSummary): boolean {
  const fl = run.fl;
  if (!fl) return false;
  if (outcome.kind === "both-low-at") {
    const tol = 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC);
    return fl.bothLowMs >= 0 && Math.abs(fl.bothLowMs - 1000 * (outcome.atSec ?? 0)) <= tol + 1e-6;
  }
  if (!run.finished) return false;
  switch (outcome.kind) {
    case "upset":
      return fl.upset;
    case "clutch":
      return fl.clutch;
    case "perfect":
      return fl.perfect;
    case "comeback":
      return fl.comeback;
    case "ability-finish":
      return fl.abilityFinish;
    case "lead-changes":
      return fl.leadChanges >= Math.max(1, Math.round(outcome.count ?? 1));
    case "decider":
      return fl.decider;
    case "sudden":
      return fl.sudden;
    case "champion":
      return (outcome.team ?? -1) >= 0 && fl.championSide === outcome.team;
    case "boss-falls-at":
      return fl.bossDefeated > 0 && fl.bossDefeated === Math.max(1, Math.round(outcome.count ?? 1));
    default:
      return false;
  }
}

// --- fl-overhaul --- (Stage 6)
/** Whether a run meets Make a clip's constraints of `outcome`: its end inside `finishWithin`, the fight still on for `cutWhileOn`. */
export function clipConstraintsMet(outcome: Pick<FinderOutcome, "finishWithin" | "cutWhileOn">, run: Pick<RunSummary, "finished" | "durationMs">): boolean {
  const w = outcome.finishWithin;
  if (w && !(run.finished && run.durationMs >= 1000 * w.fromSec - 1e-6 && run.durationMs <= 1000 * w.toSec + 1e-6)) return false;
  if (outcome.cutWhileOn && run.finished) return false;
  return true;
}
/** How far a run's end missed `finishWithin` (s; 0 inside it or without one, Infinity for a run that never ended). */
export function finishWindowMiss(outcome: Pick<FinderOutcome, "finishWithin">, run: Pick<RunSummary, "finished" | "durationMs">): number {
  const w = outcome.finishWithin;
  if (!w) return 0;
  if (!run.finished) return Infinity;
  const sec = run.durationMs / 1000;
  return sec < w.fromSec ? w.fromSec - sec : sec > w.toSec ? sec - w.toSec : 0;
}
// --- end fl-overhaul ---

/** Whether a run achieved `outcome` (a battle's winner only once the battle is over and has crowned it – `winnerNeedsEnd()`). */
export function outcomeMatches(outcome: FinderOutcome, run: RunSummary): boolean {
  if ((outcome.finishWithin || outcome.cutWhileOn) && !clipConstraintsMet(outcome, run)) return false; // --- fl-overhaul --- (Stage 6)
  switch (outcome.kind) {
    case "never-escapes":
      return run.firstEscapeMs < 0 && !run.finished && run.durationMs >= 1000 * outcome.clipSec - 1;
    case "escapes-at": {
      const tol = 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC);
      return run.firstEscapeMs >= 0 && Math.abs(run.firstEscapeMs - 1000 * (outcome.atSec ?? 0)) <= tol + 1e-6;
    }
    // --- orb-grid --- followed through the clip, and the field came to rest at no moment of it (not merely "not ended yet")
    case "never-settles":
      return !run.finished && (run.settledMs ?? -1) < 0 && run.durationMs >= 1000 * outcome.clipSec - 1;
    case "resolves-at": {
      const at = run.firstResolveMs ?? -1;
      return at >= 0 && Math.abs(at - 1000 * (outcome.atSec ?? 0)) <= 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC) + 1e-6;
    }
    case "double-ko": // --- fight-league ---
      return run.finished && run.doubleKo === true;
    // --- fl-overhaul --- (Stage 5) the story's outcomes
    case "upset":
    case "clutch":
    case "perfect":
    case "comeback":
    case "ability-finish":
    case "lead-changes":
    case "both-low-at":
    case "decider":
    case "sudden":
    case "champion":
    case "boss-falls-at":
      return flStoryMatches(outcome, run);
    case "winner": {
      const team = outcome.team ?? -1;
      if (team < 0 || team >= run.teams.length || run.teams.length < 2) return false;
      if (winnerNeedsEnd(outcome, run.mode) && !(run.finished && run.teams[team].escapes > 0)) return false;
      // --- odd-string-battle --- a battle's winner is the last one standing: a battle that ended with nobody standing is no
      // find, even when its shared verdict crowned the chosen ball (it shattered with its rival in the final cut)
      if (winnerNeedsEnd(outcome, run.mode) && run.doubleKo === true) return false;
      const result = teamResult(run.teams, run.teams.length);
      return !result.tie && result.winner === team;
    }
    // --- land-claim --- a finished battle whose top two ended within the margin
    case "close":
      return run.finished && run.margin !== undefined && run.margin <= closeBattleMargin(run.mode) + 1e-9; // (--- fl-overhaul --- Stage 5: per mode)
    // --- loop-foundation --- the first fill within the limit; on a bar line
    case "fills-by": {
      const fill = run.firstFillMs ?? -1;
      return fill >= 0 && fill <= 1000 * (outcome.atSec ?? 0) + 1e-6;
    }
    case "fill-on-bar":
      return fillOnBar(outcome, run.firstFillMs ?? -1);
    // --- bead-hoops --- the first cycle in strict size order; every bead up within the limit
    case "lift-order":
      return run.liftOrderOk === true;
    case "all-up-by": {
      const at = run.allUpMs ?? -1;
      return at >= 0 && at <= 1000 * (outcome.atSec ?? 0) + 1e-6;
    }
    // --- chaos-fan --- the first split inside the window [target − tolerance, target + tolerance]
    case "diverges-at": {
      const at = run.divergeMs ?? -1;
      return at >= 0 && Math.abs(at - 1000 * (outcome.atSec ?? 0)) <= 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC) + 1e-6;
    }
    // --- colour-sort --- every ball sorted within the limit; the chosen colour's ball the final one sorted; the final ball on a bar line
    case "sorted-by": {
      const sorted = run.sortedMs ?? -1;
      return sorted >= 0 && sorted <= 1000 * (outcome.atSec ?? 0) + 1e-6;
    }
    case "last-colour":
      return (run.sortedMs ?? -1) >= 0 && (run.lastColour ?? -1) === (outcome.team ?? -1);
    case "sorted-on-bar":
      return sortedOnBar(outcome, run.sortedMs ?? -1);
    case "summit-last": // --- land-claim-pyramid --- (the centre column the last one standing)
      return run.summitLeft === 0;
    case "ring-at": // --- ring-escape ---
      return ringAtMatches(outcome, run);
    default:
      return false;
  }
}

/**
 * How far a run missed `outcome` (lower is better; 0 for a match): the seconds it fell short of the clip
 * (never-escapes), the seconds between its first escape and the target (escapes-at; Infinity without an escape), 0 / 1
 * for the winner. The search reports the closest run it saw.
 */
export function outcomeMiss(outcome: FinderOutcome, run: RunSummary): number {
  if (outcome.finishWithin) return outcomeMissOf({ ...outcome, finishWithin: undefined }, run) + finishWindowMiss(outcome, run); // --- fl-overhaul --- (Stage 6) the KO's distance from Make a clip's window too
  return outcomeMissOf(outcome, run);
}

function outcomeMissOf(outcome: FinderOutcome, run: RunSummary): number {
  switch (outcome.kind) {
    case "never-escapes":
      return Math.max(0, outcome.clipSec - survivalSec(run));
    case "escapes-at":
      return run.firstEscapeMs < 0 ? Infinity : Math.abs(run.firstEscapeMs / 1000 - (outcome.atSec ?? 0));
    case "winner":
    case "double-ko": // --- fight-league ---
      return outcomeMatches(outcome, run) ? 0 : 1;
    // --- orb-grid --- the seconds the field fell short of the clip (until it came to rest); the seconds between its first resolve and the target
    case "never-settles":
      return Math.max(0, outcome.clipSec - bouncingSec(run));
    case "resolves-at":
      return (run.firstResolveMs ?? -1) < 0 ? Infinity : Math.abs((run.firstResolveMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    case "close": // --- land-claim --- how far past the margin its top two ended (a run cut short: Infinity)
      return run.finished && run.margin !== undefined ? Math.max(0, run.margin - closeBattleMargin(run.mode)) : Infinity;
    // --- fl-overhaul --- (Stage 5) the lead changes short of the count; the seconds off the cliffhanger's target; the waves off; else 0 / 1
    case "lead-changes":
      return run.fl && run.finished ? Math.max(0, Math.max(1, Math.round(outcome.count ?? 1)) - run.fl.leadChanges) : Infinity;
    case "both-low-at":
      return run.fl && run.fl.bothLowMs >= 0 ? Math.abs(run.fl.bothLowMs / 1000 - (outcome.atSec ?? 0)) : Infinity;
    case "boss-falls-at":
      return run.fl && run.finished && run.fl.bossDefeated > 0 ? Math.abs(run.fl.bossDefeated - Math.max(1, Math.round(outcome.count ?? 1))) : Infinity;
    case "upset":
    case "clutch":
    case "perfect":
    case "comeback":
    case "ability-finish":
    case "decider":
    case "sudden":
    case "champion":
      return outcomeMatches(outcome, run) ? 0 : 1;
    // --- loop-foundation --- the seconds past the limit; the seconds off the nearest bar line (no fill: Infinity)
    case "fills-by":
      return (run.firstFillMs ?? -1) < 0 ? Infinity : Math.max(0, (run.firstFillMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    case "fill-on-bar":
      return (run.firstFillMs ?? -1) < 0 ? Infinity : barLineDistanceMs(run.firstFillMs ?? 0, 1000 * (outcome.atSec ?? barSeconds(120))) / 1000;
    // --- bead-hoops --- 0 / 1 for the order; the seconds past the limit (never all up: Infinity)
    case "lift-order":
      return run.liftOrderOk === true ? 0 : 1;
    case "all-up-by":
      return (run.allUpMs ?? -1) < 0 ? Infinity : Math.max(0, (run.allUpMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    case "diverges-at": // --- chaos-fan --- the seconds between the split and the target (never split: Infinity)
      return (run.divergeMs ?? -1) < 0 ? Infinity : Math.abs((run.divergeMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    // --- colour-sort --- the seconds past the limit; 0 / 1 for the last colour; the seconds off the nearest bar line (no complete sort: Infinity)
    case "sorted-by":
      return (run.sortedMs ?? -1) < 0 ? Infinity : Math.max(0, (run.sortedMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    case "last-colour":
      return (run.sortedMs ?? -1) < 0 ? Infinity : outcomeMatches(outcome, run) ? 0 : 1;
    case "sorted-on-bar":
      return (run.sortedMs ?? -1) < 0 ? Infinity : barLineDistanceMs(run.sortedMs ?? 0, 1000 * (outcome.atSec ?? barSeconds(120))) / 1000;
    case "summit-last": // --- land-claim-pyramid --- the blocks still standing elsewhere when the summit fell (never fell: Infinity)
      return (run.summitLeft ?? -1) < 0 ? Infinity : (run.summitLeft ?? 0);
    case "ring-at": // --- ring-escape --- the seconds between the first ring and the target (no ring: Infinity)
      return (run.firstRingMs ?? -1) < 0 ? Infinity : Math.abs((run.firstRingMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    default:
      return Infinity;
  }
}

/** How long a run went without an escape (seconds): until its first escape, or its end. */
export function survivalSec(run: RunSummary): number {
  return (run.firstEscapeMs >= 0 ? run.firstEscapeMs : run.durationMs) / 1000;
}

// --- orb-grid ---
/** How long a field kept bouncing (seconds): until it came to rest (`settledMs`), or – still bouncing – the run's end. */
export function bouncingSec(run: RunSummary): number {
  const settled = run.settledMs ?? -1;
  return (settled >= 0 ? settled : run.durationMs) / 1000;
}
// --- end orb-grid ---

/**
 * The figure the page shows for a run (seconds): its survival (never-escapes), its first escape (escapes-at, 0
 * without one), its length (winner); --- orb-grid --- how long the field bounced (never-settles: "came to rest after Ns").
 */
export function outcomeFigure(outcome: FinderOutcome, run: RunSummary): number {
  switch (outcome.kind) {
    case "never-escapes":
      return survivalSec(run);
    case "escapes-at":
      return run.firstEscapeMs >= 0 ? run.firstEscapeMs / 1000 : 0;
    case "never-settles": // --- orb-grid --- (until the field came to rest, not until its end a hold later)
      return bouncingSec(run);
    case "resolves-at": // --- orb-grid --- (the first resolve, 0 without one)
      return (run.firstResolveMs ?? -1) >= 0 ? (run.firstResolveMs ?? 0) / 1000 : 0;
    case "close": // --- land-claim --- the gap between its top two, in percent of the land (100 for a run cut short)
      return run.finished && run.margin !== undefined ? 100 * run.margin : 100;
    case "fills-by": // --- loop-foundation --- (the first fill, 0 without one)
    case "fill-on-bar":
      return (run.firstFillMs ?? -1) >= 0 ? (run.firstFillMs ?? 0) / 1000 : 0;
    case "all-up-by": // --- bead-hoops --- (every bead up, 0 when that never came)
      return (run.allUpMs ?? -1) >= 0 ? (run.allUpMs ?? 0) / 1000 : 0;
    case "both-low-at": // --- fl-overhaul --- (Stage 5) the cliffhanger's moment (0 without one)
      return run.fl && run.fl.bothLowMs >= 0 ? run.fl.bothLowMs / 1000 : 0;
    case "diverges-at": // --- chaos-fan --- (the split, 0 when it never came)
      return (run.divergeMs ?? -1) >= 0 ? (run.divergeMs ?? 0) / 1000 : 0;
    case "sorted-by": // --- colour-sort --- (the first complete sort, 0 without one)
    case "last-colour":
    case "sorted-on-bar":
      return (run.sortedMs ?? -1) >= 0 ? (run.sortedMs ?? 0) / 1000 : 0;
    case "summit-last": // --- land-claim-pyramid --- (the blocks still standing elsewhere when the summit fell; −1 when it never did)
      return run.summitLeft ?? -1;
    case "ring-at": // --- ring-escape --- (the first ring escaped, 0 without one)
      return (run.firstRingMs ?? -1) >= 0 ? (run.firstRingMs ?? 0) / 1000 : 0;
    default:
      return run.durationMs / 1000;
  }
}

/**
 * The clip to record for a found run (seconds): the whole clip for never-escapes; the run itself when it finished,
 * else the clip (a run that goes on – Multiply – is recorded for the clip the page set) for the others.
 */
export function outcomeClipSec(outcome: FinderOutcome, run: RunSummary): number {
  if (outcome.kind === "never-escapes") return outcome.clipSec;
  if (outcome.kind === "never-settles") return outcome.clipSec; // --- orb-grid --- (the field bounces through the whole clip)
  if (outcome.kind === "both-low-at" && run.fl && run.fl.bothLowMs >= 0) return run.fl.bothLowMs / 1000; // --- fl-overhaul --- (Stage 5: the clip is cut at the cliffhanger)
  if (run.cycleMs !== undefined && run.cycleMs > 0) return run.cycleMs / 1000; // --- colour-sort --- (a found sort: its whole loop – the sort, the chord's hold, the remix)
  if (run.finished) return run.durationMs / 1000;
  return outcome.clipSec;
}

export interface OutcomeContext {
  /** The run can never finish with these settings (an endless mode, Rain, the countdown off, "never escape"…): no duration to search for. */
  endless: boolean;
  /** "Never escape" is on. */
  neverEscape: boolean;
  /** Balls the multi-ball modes start with (the team roster's size). */
  ballCount: number;
  /** --- orb-rhythm --- Bouncing Orbs plays the rhythm model: ideal bouncers never settle (no never-settles), in phase on the cycle's clock. */
  orbRhythm?: boolean;
  /** --- loop-foundation --- Grow ends at the fill ("finish"): the fill's time can be searched (fills-by, fill-on-bar). */
  growFinish?: boolean;
  /** --- fl-overhaul --- (Stage 5) Fight League's show: a series (decider), a bracket (champion – its pinned entrants), a boss rush (boss-falls-at); absent: one match. */
  flShow?: "single" | "series" | "bracket" | "boss";
  /** --- fl-overhaul --- (Stage 5) Fight League's sides the finder can name (a bracket's pinned entrants) and whether a best-of is on (a series, a bracket's final). */
  flSides?: number;
  flDecider?: boolean;
  /**
   * --- colour-sort --- Colour Sort's gate rule lets balls back in (both ways, `csSortSettles()`): its sort settles at an
   * equilibrium instead of completing, so there is no first sort to search (no sorted-by, last-colour, sorted-on-bar).
   */
  colourSortSettles?: boolean;
  /** --- chaos-fan --- The Double Pendulum runs its chaos fan: the split's time can be searched (diverges-at). */
  dpFan?: boolean;
  /** --- perfect-fit --- Perfect Fit runs its pentomino rectangles: their solution seeds can be searched (most-on-floor). */
  pfPento?: boolean;
  /** --- beat-machine --- Beat Machines runs its marble xylophone: its seeded phrases can be searched (no-tube-conflict, most-in-flight). */
  bmMarbles?: boolean;
  /** --- funnel-spin --- The Sound Vortex releases ring waves: the last ring's vanish can be put on a bar line (ring-on-bar). */
  vortexRings?: boolean;
  /**
   * --- land-claim-pyramid --- Land Claim plays its pyramid (summit-last), and loops it (Rebuild and loop: it never ends, so no
   * battle verdict to search – no winner, no close battle – and no length).
   */
  lcPyramid?: boolean;
  lcPyramidLoop?: boolean;
  /** --- ring-escape --- Classic runs a Ring Escape option (`ringEscapeActive()`): the first ring's time can be searched (ring-at). */
  ringEscape?: boolean;
}

/**
 * The outcomes the finder can search for in `mode`: the run length when the run can end; never-escapes and escapes-at
 * where balls can escape (escapes-at not while "never escape" rules them out); the winner with two balls (teams) or
 * more in the multi-ball modes.
 */
export function availableOutcomes(mode: ModeId, ctx: OutcomeContext): FinderOutcomeKind[] {
  const out: FinderOutcomeKind[] = [];
  if (!ctx.endless) out.push("duration");
  if (RIG_ESCAPE_MODES.includes(mode)) {
    out.push("never-escapes");
    if (!(ctx.neverEscape && neverEscapeApplies(mode))) out.push("escapes-at");
  }
  if (MULTI_BALL_MODES.includes(mode) && ctx.ballCount >= 2) out.push("winner");
  // --- odd-string-battle --- a battle's winner is the last ball standing (every ball is a team)
  if (BATTLE_WINNER_MODES.includes(mode) && ctx.ballCount >= 2 && !out.includes("winner")) out.push("winner");
  // --- orb-grid --- Bouncing Orbs: still bouncing when the clip ends, the field's first resolve at a chosen second
  if (mode === "orbGrid") out.push("never-settles", "resolves-at");
  if (mode === "orbGrid" && ctx.orbRhythm) out.splice(out.indexOf("never-settles"), 1); // --- orb-rhythm --- (never settles: the decay model's alone)
  // --- fight-league --- Fight League: the fight ends with a double KO
  if (mode === "fightLeague" && (ctx.flShow ?? "single") === "single") out.push("double-ko"); // (--- fl-overhaul --- Stage 5: a show replays its double KOs)
  if (CLOSE_BATTLE_MODES.includes(mode) && ctx.ballCount >= 2) out.push("close"); // --- land-claim ---
  // --- fl-overhaul --- (Stage 5) Fight League's story; a series' decider, a bracket's champion (instead of a winner among its pinned entrants), a boss rush's fall
  if (mode === "fightLeague") {
    out.push("upset", "clutch", "perfect", "comeback", "ability-finish", "lead-changes", "both-low-at", "sudden");
    if (ctx.flShow === "series" || (ctx.flShow === "bracket" && ctx.flDecider)) out.push("decider");
    if (ctx.flShow === "bracket" && (ctx.flSides ?? ctx.ballCount) >= 1) out.push("champion");
    if (ctx.flShow === "boss") out.push("boss-falls-at");
  }
  if (mode === "grow" && ctx.growFinish) out.push("fills-by", "fill-on-bar"); // --- loop-foundation ---
  if (mode === "starChords") out.push("star-set"); // --- chord-stars --- (the best star set, its loop fitted to the clip)
  if (mode === "hoops") out.push("lift-order", "all-up-by"); // --- bead-hoops ---
  if (mode === "doublePendulum" && ctx.dpFan) out.push("diverges-at"); // --- chaos-fan --- (the split at a chosen second)
  if (mode === "ellipseFoci") out.push("converge-on-beat", "longest-collapse"); // --- ellipse-foci --- (the transit on the tempo; the start angle)
  if (mode === "colourSort" && !ctx.colourSortSettles) out.push("sorted-by", "last-colour", "sorted-on-bar"); // --- colour-sort --- (its first sort: the run loops forever; none when the sort only settles)
  if (mode === "beatMachine" && ctx.bmMarbles) out.push("no-tube-conflict", "most-in-flight"); // --- beat-machine --- (seeded phrases: the marble machine's tubes)
  if (mode === "vortex" && ctx.vortexRings) out.push("ring-on-bar"); // --- funnel-spin --- (the wave interval and the friction searched, no seed)
  // --- land-claim-pyramid --- the pyramid's summit last; a looping pyramid has no verdict to search
  if (mode === "landClaim" && ctx.lcPyramid) {
    if (ctx.lcPyramidLoop) for (const kind of ["winner", "close"] as const) if (out.includes(kind)) out.splice(out.indexOf(kind), 1);
    out.push("summit-last");
  }
  // --- end land-claim-pyramid ---
  if (mode === "classic" && ctx.ringEscape) out.push("ring-at"); // --- ring-escape --- (the first ring at a chosen second)
  if (mode === "perfectFit") out.push(...(ctx.pfPento ? (["most-on-floor"] as const) : []), "landings-on-beat"); // --- perfect-fit --- (solution seeds; the beat)
  return out;
}

// --- bead-hoops ---
/**
 * Whether a Spinning Hoops run being simulated can stop for its outcome: the first cycle's lift order is decided (every bead
 * up, the order broken, or the ramp back down – no lift can come any more), or every bead is up / the limit passed without it.
 */
export function hoopsOutcomeSettled(outcome: FinderOutcome, elapsedMs: number, allUpMs: number, orderDecided: boolean): boolean {
  if (outcome.kind === "lift-order") return orderDecided;
  if (outcome.kind === "all-up-by") return allUpMs >= 0 || elapsedMs > 1000 * (outcome.atSec ?? 0) + FILL_SLACK_MS - 1e-6;
  return false;
}
// --- end bead-hoops ---

// --- ring-escape ---
/**
 * Whether a Classic run being simulated can stop for ring-at: its first ring came outside the window, or the window passed
 * without one. A match is followed on (to the run's own end, which settles every outcome), so the found clip is the whole run.
 */
export function ringOutcomeSettled(outcome: FinderOutcome, elapsedMs: number, firstRingMs: number): boolean {
  if (outcome.kind !== "ring-at") return false;
  const tol = 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC);
  const at = 1000 * (outcome.atSec ?? 0);
  if (firstRingMs < 0) return elapsedMs > at + tol + FILL_SLACK_MS;
  return Math.abs(firstRingMs - at) > tol + 1e-6;
}
/** ring-at: the first ring escaped within the window around the target. */
function ringAtMatches(outcome: FinderOutcome, run: RunSummary): boolean {
  const at = run.firstRingMs ?? -1;
  return at >= 0 && Math.abs(at - 1000 * (outcome.atSec ?? 0)) <= 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC) + 1e-6;
}
// --- end ring-escape ---

// --- chaos-fan ---
/** Whether a chaos-fan run being simulated can stop for diverges-at: the fan has split (in the window or not), or the window passed without it. */
export function fanOutcomeSettled(outcome: FinderOutcome, elapsedMs: number, divergeMs: number): boolean {
  if (outcome.kind !== "diverges-at") return false;
  return divergeMs >= 0 || elapsedMs > 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + FILL_SLACK_MS - 1e-6;
}
// --- end chaos-fan ---

/** The outcome to search for: the one picked when it is available, else the first one available (null: none). */
export function effectiveOutcome(picked: FinderOutcomeKind, available: readonly FinderOutcomeKind[]): FinderOutcomeKind | null {
  if (available.includes(picked)) return picked;
  return available[0] ?? null;
}
