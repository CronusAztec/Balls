import { MULTI_BALL_MODES, type BallStats } from "@/lib/physics/ballStats";
import { BATTLE_WINNER_MODES, RIG_ESCAPE_MODES, neverEscapeApplies } from "@/lib/physics/rigged"; // --- odd-string-battle --- (BATTLE_WINNER_MODES)
import type { ModeId } from "@/lib/physics/types";
import { teamResult } from "@/lib/teams";
import { LC_CLOSE } from "@/lib/physics/modes/landClaim"; // --- land-claim ---

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
 */

export const FINDER_OUTCOMES = ["duration", "never-escapes", "escapes-at", "winner", "never-settles", "resolves-at", "double-ko", "close", "fills-by", "fill-on-bar"] as const; // --- orb-grid --- (never-settles, resolves-at) --- fight-league --- (double-ko) --- land-claim --- (close) --- loop-foundation --- (fills-by, fill-on-bar)
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
  /** Fight League: the run ended with a double KO (its last sides down in the same step). */
  doubleKo?: boolean;
  // --- end fight-league ---
  /** --- land-claim --- A finished battle's gap between its top two, as a share of the land (Land Claim's verdict); absent elsewhere. */
  margin?: number;
  /** --- loop-foundation --- Real time (ms) of Grow's first fill (the ball full), −1 or absent when none came. */
  firstFillMs?: number;
}

// --- land-claim ---
/**
 * The modes whose verdict can be a close battle – the top two within `CLOSE_BATTLE_MARGIN` of the land when the run ends (Land
 * Claim's SUCH A CLOSE BATTLE): the "close" outcome searches for one, following every run to its end.
 */
export const CLOSE_BATTLE_MODES: readonly ModeId[] = ["landClaim"];
/** The gap (a share of the land) under which the top two of a battle make a close one: Land Claim's `LC_CLOSE`. */
export const CLOSE_BATTLE_MARGIN = LC_CLOSE;
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
    // --- orb-grid --- followed through the clip, and the field came to rest at no moment of it (not merely "not ended yet")
    case "never-settles":
      return !run.finished && (run.settledMs ?? -1) < 0 && run.durationMs >= 1000 * outcome.clipSec - 1;
    case "resolves-at": {
      const at = run.firstResolveMs ?? -1;
      return at >= 0 && Math.abs(at - 1000 * (outcome.atSec ?? 0)) <= 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC) + 1e-6;
    }
    case "double-ko": // --- fight-league ---
      return run.finished && run.doubleKo === true;
    case "winner": {
      const team = outcome.team ?? -1;
      if (team < 0 || team >= run.teams.length || run.teams.length < 2) return false;
      if (winnerNeedsEnd(outcome, run.mode) && !(run.finished && run.teams[team].escapes > 0)) return false;
      const result = teamResult(run.teams, run.teams.length);
      return !result.tie && result.winner === team;
    }
    // --- land-claim --- a finished battle whose top two ended within the margin
    case "close":
      return run.finished && run.margin !== undefined && run.margin <= CLOSE_BATTLE_MARGIN + 1e-9;
    // --- loop-foundation --- the first fill within the limit; on a bar line
    case "fills-by": {
      const fill = run.firstFillMs ?? -1;
      return fill >= 0 && fill <= 1000 * (outcome.atSec ?? 0) + 1e-6;
    }
    case "fill-on-bar":
      return fillOnBar(outcome, run.firstFillMs ?? -1);
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
    case "double-ko": // --- fight-league ---
      return outcomeMatches(outcome, run) ? 0 : 1;
    // --- orb-grid --- the seconds the field fell short of the clip (until it came to rest); the seconds between its first resolve and the target
    case "never-settles":
      return Math.max(0, outcome.clipSec - bouncingSec(run));
    case "resolves-at":
      return (run.firstResolveMs ?? -1) < 0 ? Infinity : Math.abs((run.firstResolveMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    case "close": // --- land-claim --- how far past the margin its top two ended (a run cut short: Infinity)
      return run.finished && run.margin !== undefined ? Math.max(0, run.margin - CLOSE_BATTLE_MARGIN) : Infinity;
    // --- loop-foundation --- the seconds past the limit; the seconds off the nearest bar line (no fill: Infinity)
    case "fills-by":
      return (run.firstFillMs ?? -1) < 0 ? Infinity : Math.max(0, (run.firstFillMs ?? 0) / 1000 - (outcome.atSec ?? 0));
    case "fill-on-bar":
      return (run.firstFillMs ?? -1) < 0 ? Infinity : barLineDistanceMs(run.firstFillMs ?? 0, 1000 * (outcome.atSec ?? barSeconds(120))) / 1000;
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
  if (mode === "fightLeague") out.push("double-ko");
  if (CLOSE_BATTLE_MODES.includes(mode) && ctx.ballCount >= 2) out.push("close"); // --- land-claim ---
  if (mode === "grow" && ctx.growFinish) out.push("fills-by", "fill-on-bar"); // --- loop-foundation ---
  return out;
}

/** The outcome to search for: the one picked when it is available, else the first one available (null: none). */
export function effectiveOutcome(picked: FinderOutcomeKind, available: readonly FinderOutcomeKind[]): FinderOutcomeKind | null {
  if (available.includes(picked)) return picked;
  return available[0] ?? null;
}
