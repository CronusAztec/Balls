import { MULTI_BALL_MODES, type BallStats } from "@/lib/physics/ballStats";
import { BATTLE_WINNER_MODES, RIG_ESCAPE_MODES, neverEscapeApplies } from "@/lib/physics/rigged"; // --- odd-string-battle --- (BATTLE_WINNER_MODES)
import type { ModeId } from "@/lib/physics/types";
import { teamResult } from "@/lib/teams";

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
 *   (`winnerNeedsEnd()`), and only a finished battle whose verdict crowned the chosen ball matches.
 *
 * Everything here is pure: a headless run is boiled down to a `RunSummary` (finder.ts simulates it) and the predicates
 * judge it, so they can be tested on synthetic runs. Times are real (recording) time – what the clip shows.
 */

export const FINDER_OUTCOMES = ["duration", "never-escapes", "escapes-at", "winner"] as const;
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
}

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
    case "escapes-at":
      // Until the target has passed without an escape, or a moment after a matching one (the run's own end).
      return 1000 * ((outcome.atSec ?? 0) + (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC)) + ESCAPE_TAIL_MS;
    default:
      return maxSimMs;
  }
}

/**
 * Whether a run being simulated can stop now: its outcome is settled (`elapsedMs` real time so far, `firstEscapeMs`
 * the first escape or −1, `finished` the mode's own end). A battle's winner is settled only by its end (`winnerNeedsEnd()`).
 */
export function outcomeSettled(outcome: FinderOutcome, elapsedMs: number, firstEscapeMs: number, finished: boolean, mode?: ModeId): boolean {
  if (finished) return true;
  switch (outcome.kind) {
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
    default:
      return false;
  }
}

/** Whether a run achieved `outcome` (a battle's winner only once the battle is over and has crowned it – `winnerNeedsEnd()`). */
export function outcomeMatches(outcome: FinderOutcome, run: RunSummary): boolean {
  switch (outcome.kind) {
    case "never-escapes":
      return run.firstEscapeMs < 0 && !run.finished && run.durationMs >= 1000 * outcome.clipSec - 1;
    case "escapes-at": {
      const tol = 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC);
      return run.firstEscapeMs >= 0 && Math.abs(run.firstEscapeMs - 1000 * (outcome.atSec ?? 0)) <= tol + 1e-6;
    }
    case "winner": {
      const team = outcome.team ?? -1;
      if (team < 0 || team >= run.teams.length || run.teams.length < 2) return false;
      if (winnerNeedsEnd(outcome, run.mode) && !(run.finished && run.teams[team].escapes > 0)) return false;
      const result = teamResult(run.teams, run.teams.length);
      return !result.tie && result.winner === team;
    }
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
  switch (outcome.kind) {
    case "never-escapes":
      return Math.max(0, outcome.clipSec - survivalSec(run));
    case "escapes-at":
      return run.firstEscapeMs < 0 ? Infinity : Math.abs(run.firstEscapeMs / 1000 - (outcome.atSec ?? 0));
    case "winner":
      return outcomeMatches(outcome, run) ? 0 : 1;
    default:
      return Infinity;
  }
}

/** How long a run went without an escape (seconds): until its first escape, or its end. */
export function survivalSec(run: RunSummary): number {
  return (run.firstEscapeMs >= 0 ? run.firstEscapeMs : run.durationMs) / 1000;
}

/**
 * The figure the page shows for a run (seconds): its survival (never-escapes), its first escape (escapes-at, 0
 * without one), its length (winner).
 */
export function outcomeFigure(outcome: FinderOutcome, run: RunSummary): number {
  switch (outcome.kind) {
    case "never-escapes":
      return survivalSec(run);
    case "escapes-at":
      return run.firstEscapeMs >= 0 ? run.firstEscapeMs / 1000 : 0;
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
  return out;
}

/** The outcome to search for: the one picked when it is available, else the first one available (null: none). */
export function effectiveOutcome(picked: FinderOutcomeKind, available: readonly FinderOutcomeKind[]): FinderOutcomeKind | null {
  if (available.includes(picked)) return picked;
  return available[0] ?? null;
}
