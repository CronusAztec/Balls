import { RANGES } from "@/lib/settings";
import { createEngineForSettings, simulateOutcomeRun, stepPlaybackMs, type FinderRequest } from "@/lib/simulation/finder";
import { ESCAPE_AT_TOLERANCE_SEC, outcomeClipSec, outcomeMatches, winnerNeedsEnd, type FinderOutcome, type FinderOutcomeKind, type RunSummary } from "@/lib/simulation/outcomes";
import { BUCKET_SECONDS, CLIFF_GAP_SEC, PAYOFF_BAND, snapStep, type EndingStyle, type LengthBucket } from "./playbook";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- templates --- The two payoff strategies of the viral templates that no playbook recipe uses (lib/bot/templates.ts binds
 * them, lib/bot/planner.ts plans them):
 *
 *  - **outcome**: the payoff is a finder outcome's moment (lib/simulation/outcomes.ts). The planner asks the seed finder for the
 *    binding's outcome around its payoff target – the window strategyOutcome() makes of payoffWindow() – and reads the moment off
 *    the finder's own run of the seed (simulateOutcomeRun, finder.ts): the first escape for escapes-at, the field's first resolve
 *    for resolves-at, the fill, the split, the sort, the verdict at the run's end for winner. outcomeMatches() says whether the
 *    run met the window, outcomeClipSec() where a run that ends on its own (or closes its loop) ends. Only the outcomes whose
 *    moment a seed's run shows plan this way (OUTCOME_MOMENTS); the ones the finder searches over settings instead of seeds –
 *    Chord Stars' star sets, Focus Shot's transit, Beat Machines' phrases, the vortex's ring waves, Brick Smash's first smash,
 *    Perfect Fit's solution seeds – have their own searches, and plan where a run of its own reads a seed's moment once the
 *    binding's settings drew what the finder would search (OWN_RUN_MOMENTS: AI studio steps 3 and 5). --- templates --- (AI
 *    studio step 4) A mode may read an outcome with a run of its own too: the Maze's winner, the first one out (OWN_RUN_MODE_MOMENTS).
 *  - **atEnd**: the payoff is the clip's last AT_END_SEC – for a mode whose run loops or has no moment to search (Conveyor, Merge
 *    Ring, Collide, Wave Tank, Lines, Drawing Machine, Illusion). Analytic: the clip's length is drawn from the payoff target
 *    (atEndRecordingSec), the seed changes nothing about the timing, and its hook promises no event, so it ends resolved only and
 *    fills the buckets whose payoff then lands inside the planner's band (AT_END_BUCKETS).
 *
 * The playbook's own strategies and every recipe's plan are untouched: these run only for a template whose binding names them.
 * Imports only from the finder (finder.ts, outcomes.ts): nothing there changes. Pure and deterministic: no clock, no randomness.
 */

// --- templates ---

/** How an outcome's window is put to the finder: `at` a target ± a tolerance, `by` a limit (the window's end), `end` none (its verdict at the run's end). */
export type OutcomeWindowKind = "at" | "by" | "end";

/** The run's moment of an outcome (ms of real time, −1 when it never came in the run followed). */
type MomentOf = (run: RunSummary) => number;

/** The moment of a winner: a battle's at its end (its verdict, winnerNeedsEnd), else the first escape – the team out first – or the run's end. */
function winnerMomentMs(run: RunSummary): number {
  if (winnerNeedsEnd({ kind: "winner" }, run.mode)) return run.finished ? run.durationMs : -1;
  return run.firstEscapeMs >= 0 ? run.firstEscapeMs : run.finished ? run.durationMs : -1;
}

/**
 * The outcomes the "outcome" strategy plans, each with its window and the moment simulateOutcomeRun() records for it. The others
 * are no payoff moment of a seed's run: never-escapes and never-settles hold for the whole clip, lift-order and the Fight League
 * stories have no second, the bar-line ones time a song, and star-set, converge-on-beat, longest-collapse, no-tube-conflict,
 * most-in-flight, ring-on-bar, bricks-cleared-by, last-brick-on-bar, final-balls, most-on-floor and landings-on-beat are searched
 * over settings by their own finders (six of them read with a run of their own: OWN_RUN_MOMENTS).
 */
export const OUTCOME_MOMENTS: Readonly<Partial<Record<FinderOutcomeKind, { window: OutcomeWindowKind; ms: MomentOf }>>> = {
  "escapes-at": { window: "at", ms: (r) => r.firstEscapeMs },
  "resolves-at": { window: "at", ms: (r) => r.firstResolveMs ?? -1 }, // --- orb-grid ---
  "diverges-at": { window: "at", ms: (r) => r.divergeMs ?? -1 }, // --- chaos-fan ---
  "ring-at": { window: "at", ms: (r) => r.firstRingMs ?? -1 }, // --- ring-escape ---
  "fills-by": { window: "by", ms: (r) => r.firstFillMs ?? -1 }, // --- loop-foundation ---
  "all-up-by": { window: "by", ms: (r) => r.allUpMs ?? -1 }, // --- bead-hoops ---
  "sorted-by": { window: "by", ms: (r) => r.sortedMs ?? -1 }, // --- colour-sort ---
  winner: { window: "end", ms: winnerMomentMs },
  close: { window: "end", ms: (r) => (r.finished ? r.durationMs : -1) }, // --- land-claim ---
  "summit-last": { window: "end", ms: (r) => r.summitMs ?? -1 }, // --- land-claim-pyramid ---
};

// --- templates --- (AI studio step 3) the outcomes whose seed's moment a run of its own reads
/** What a run of its own reads of an outcome: the run summed up, the outcome's moment and where the run ended (ms; −1 / null: never). */
interface OwnRun {
  summary: RunSummary;
  ms: number;
  endMs: number | null;
  /** The end is a loop's seam: the page's whole-loop export ends the clip right there (Export whole loops). */
  seam?: true;
  /** --- templates --- (AI studio step 4) The team a winner outcome's run crowned (−1 or absent: none). */
  winner?: number;
}

/** The engine's view of a run of its own, stepped as the page plays it (stepPlaybackMs) until `done` says so or `horizonSec`. */
function stepOwnRun(request: FinderRequest, seed: number, horizonSec: number, done: (engine: ReturnType<typeof createEngineForSettings>) => boolean): { elapsedMs: number; reached: boolean } {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const step = 1000 / 60;
  let elapsed = 0;
  while (elapsed < 1000 * horizonSec - 1e-6) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step);
    engine.consumeSoundEvents();
    if (done(engine)) return { elapsedMs: elapsed, reached: true };
  }
  return { elapsedMs: elapsed, reached: false };
}

/**
 * Brick Smash's first smash (bricks-cleared-by: brickRebuildFinder.ts steps the same run): the moment its last brick falls, the
 * run followed until its first smash ends – cleared, or its time limit. The run loops on (the settle, the rebuild, the next
 * smash), so it never ends: a clip around the clear is cut where the planner puts its end.
 */
function brickSmashRun(request: FinderRequest, seed: number, horizonSec: number): OwnRun {
  let cleared = false;
  const { elapsedMs, reached } = stepOwnRun(request, seed, horizonSec, (engine) => {
    const view = engine.getBrickRebuildView();
    if (view.firstEnd === "") return false;
    cleared = view.firstEnd === "cleared";
    return true;
  });
  return { summary: { mode: request.mode, durationMs: elapsedMs, finished: false, firstEscapeMs: -1, teams: [] }, ms: reached && cleared ? elapsedMs : -1, endMs: null };
}

/**
 * Perfect Fit's first box full (most-on-floor: the binding's settings take the finder's solution seed with the most pieces on
 * the floor, perfectFitFinder.ts, so the seed's run is that tiling's): the moment its last piece lands and the completion chord
 * plays. The run loops on (the scatter, the next box) and never finishes, but the page exports whole loops only (the loop
 * contract: Export whole loops), so a clip of it ends on its loop's seam – the box empty again after the scatter (the studio's
 * render of step 3: 22.9 s rendered of a 25 s plan).
 */
function perfectFitRun(request: FinderRequest, seed: number, horizonSec: number): OwnRun {
  let loopMs = -1;
  const { elapsedMs, reached } = stepOwnRun(request, seed, horizonSec, (engine) => {
    const view = engine.getPerfectFitView();
    loopMs = 1000 * view.plan.loopSec;
    return view.rects >= 1;
  });
  const seam = reached && loopMs > 0;
  return { summary: { mode: request.mode, durationMs: elapsedMs, finished: false, firstEscapeMs: -1, teams: [] }, ms: reached ? elapsedMs : -1, endMs: seam ? loopMs : null, ...(seam ? { seam: true as const } : {}) };
}

/**
 * --- templates --- (AI studio step 4) The Maze's winner (winner: the first ball out of the exit – the maze names it there, its
 * banner "AQUA ESCAPED", and the others go on): the moment its verdict comes, the run followed on as far as a clip around that
 * moment reaches (the payoff at 85 %, PAYOFF_BAND) to learn whether it ends first – every ball out, then MZ_FINISH_HOLD_MS. The
 * finder's own run of a winner reads the run's end instead (OUTCOME_MOMENTS: the first escape or the end), which in the maze
 * comes when the last ball is out.
 */
function mazeWinnerRun(request: FinderRequest, seed: number, horizonSec: number): OwnRun {
  let verdictMs = -1;
  let winner = -1;
  const reach = { ms: Infinity };
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const step = 1000 / 60;
  let elapsed = 0;
  let finished = false;
  while (elapsed < Math.min(1000 * horizonSec, reach.ms) - 1e-6) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step);
    engine.consumeSoundEvents();
    const view = engine.getMazeView();
    if (verdictMs < 0 && view.verdict === "exit" && view.winner >= 0) {
      verdictMs = elapsed;
      winner = view.winner;
      reach.ms = elapsed / ((PAYOFF_BAND.from + PAYOFF_BAND.to) / 2) + 1000;
    }
    if (engine.isSimulationFinished()) {
      finished = true;
      break;
    }
  }
  const teams = engine.getMazeView().teamCount;
  const summary: RunSummary = { mode: request.mode, durationMs: elapsed, finished, firstEscapeMs: -1, teams: engine.getTeamStats().slice(0, teams).map((t) => ({ ...t })) };
  return { summary, ms: verdictMs, endMs: finished ? elapsed : null, winner };
}

// --- templates --- (AI studio step 5) the four outcomes the finder searches over settings, each with the seed's moment a run of its
// own reads (the binding's settings draw what the finder would search: lib/bot/templates.ts)
/** A summary of a run that ends at most at `endMs` (null: it goes on) and has no escape or teams of its own. */
const plainSummary = (mode: ModeId, durationMs: number, finished: boolean): RunSummary => ({ mode, durationMs, finished, firstEscapeMs: -1, teams: [] });

/**
 * Chord Stars' close (star-set: the finder fits the star set's drawing time to the clip, starChordsFinder.ts): the moment every star
 * closes on the same frame, its chord, and the end of its loop – the hold and the fade after the close –, its seam: the page's
 * whole-loop export ends the clip there.
 */
function starChordsRun(request: FinderRequest, seed: number, horizonSec: number): OwnRun {
  let periodMs = -1;
  const { elapsedMs, reached } = stepOwnRun(request, seed, horizonSec, (engine) => {
    const view = engine.getStarChordsView();
    periodMs = 1000 * view.periodSec;
    return view.closings >= 1;
  });
  const seam = reached && periodMs > 0;
  return { summary: plainSummary(request.mode, elapsedMs, false), ms: reached ? elapsedMs : -1, endMs: seam ? periodMs : null, ...(seam ? { seam: true as const } : {}) };
}

/**
 * Focus Shot's first convergence (converge-on-beat: the transit whole bars of the bed's tempo, ellipseFociFinder.ts): the moment the
 * volley fired from one focus lands on the other, all at once. The loop goes on (the next pass, the refire): no end of its own.
 */
function ellipseFociRun(request: FinderRequest, seed: number, horizonSec: number): OwnRun {
  const { elapsedMs, reached } = stepOwnRun(request, seed, horizonSec, (engine) => engine.getEllipseFociView().convergences >= 1);
  return { summary: plainSummary(request.mode, elapsedMs, false), ms: reached ? elapsedMs : -1, endMs: null };
}

/**
 * Beat Machines' phrase (no-tube-conflict: the seed writes the marbles' phrase, beatMachineFinder.ts, a plan per seed): a seed whose
 * phrase no tube needs a spare marble for has its moment at the note of its loop's last bars nearest 85 % of the loop (the band's
 * middle), the loop's end its seam; a seed that needs a spare has none. Nothing is simulated: the plan is the run's.
 */
function beatMachineRun(request: FinderRequest, seed: number): OwnRun {
  const plan = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed).getBeatMachineView().plan;
  const loopMs = 1000 * plan.loopSec;
  const aim = ((PAYOFF_BAND.from + PAYOFF_BAND.to) / 2) * loopMs;
  let ms = -1;
  for (const note of plan.notes) {
    const at = 1000 * note.beat * plan.beatSec;
    if (at > 0 && at < loopMs && (ms < 0 || Math.abs(at - aim) < Math.abs(ms - aim))) ms = at;
  }
  const ok = plan.spares === 0 && ms >= 0 && loopMs > 0;
  return { summary: plainSummary(request.mode, loopMs, false), ms: ok ? ms : -1, endMs: loopMs > 0 ? loopMs : null, ...(loopMs > 0 ? { seam: true as const } : {}) };
}

/**
 * The Sound Vortex's last ring (ring-on-bar: the wave interval and the friction that put it on a bar line, funnelSpinFinder.ts): the
 * moment its last ball is swallowed, the run followed to its end – its final banner, a second later.
 */
function vortexRingRun(request: FinderRequest, seed: number, horizonSec: number): OwnRun {
  let lastMs = -1;
  const { elapsedMs, reached } = stepOwnRun(request, seed, horizonSec, (engine) => {
    const view = engine.getVortexView();
    lastMs = view.lastSwallowMs ?? -1;
    return view.finished;
  });
  return { summary: plainSummary(request.mode, elapsedMs, reached), ms: reached && lastMs >= 0 ? lastMs : -1, endMs: reached ? elapsedMs : null };
}
// --- end of the four

/**
 * --- templates --- (AI studio step 4) The outcomes a mode's own run reads for that mode only (ownRunOf): the Maze's winner, the
 * first one out (mazeWinnerRun).
 */
export const OWN_RUN_MODE_MOMENTS: Readonly<Partial<Record<ModeId, Partial<Record<FinderOutcomeKind, { window: OutcomeWindowKind; run: (request: FinderRequest, seed: number, horizonSec: number) => OwnRun }>>>>> = {
  maze: { winner: { window: "end", run: mazeWinnerRun } }, // --- odd-maze ---
};

/**
 * --- templates --- (AI studio step 3) The outcomes the finder searches with a run of their own (not simulateOutcomeRun's) that
 * still have a seed's moment, each with its window and the run that reads it.
 */
export const OWN_RUN_MOMENTS: Readonly<Partial<Record<FinderOutcomeKind, { window: OutcomeWindowKind; run: (request: FinderRequest, seed: number, horizonSec: number) => OwnRun }>>> = {
  "bricks-cleared-by": { window: "by", run: brickSmashRun }, // --- brick-rebuild ---
  "most-on-floor": { window: "at", run: perfectFitRun }, // --- perfect-fit ---
  // --- templates --- (AI studio step 5)
  "star-set": { window: "at", run: starChordsRun }, // --- chord-stars ---
  "converge-on-beat": { window: "at", run: ellipseFociRun }, // --- ellipse-foci ---
  "no-tube-conflict": { window: "at", run: beatMachineRun }, // --- beat-machine ---
  "ring-on-bar": { window: "at", run: vortexRingRun }, // --- funnel-spin ---
};

/** --- templates --- (AI studio step 3) The outcomes whose moment is a fill (Grow's ring filled, Perfect Fit's first box full): a fill's fact. */
export const FILL_OUTCOMES: readonly FinderOutcomeKind[] = ["fills-by", "most-on-floor"];

/** The window kind of an outcome the strategy plans (OUTCOME_MOMENTS, else OWN_RUN_MOMENTS). */
function windowOf(kind: FinderOutcomeKind): OutcomeWindowKind | undefined {
  return OUTCOME_MOMENTS[kind]?.window ?? OWN_RUN_MOMENTS[kind]?.window;
}

/** --- templates --- (AI studio step 4) The run of its own that reads an outcome in a mode: the mode's own (OWN_RUN_MODE_MOMENTS), else the outcome's. */
function ownRunOf(kind: FinderOutcomeKind, mode: ModeId): (typeof OWN_RUN_MOMENTS)[FinderOutcomeKind] {
  return OWN_RUN_MODE_MOMENTS[mode]?.[kind] ?? OWN_RUN_MOMENTS[kind];
}

/** Whether a run's moment (ms; −1: never) meets the outcome's window. */
function inWindow(outcome: FinderOutcome, ms: number): boolean {
  if (ms < 0) return false;
  switch (windowOf(outcome.kind)) {
    case "at":
      return Math.abs(ms - 1000 * (outcome.atSec ?? 0)) <= 1000 * (outcome.toleranceSec ?? ESCAPE_AT_TOLERANCE_SEC) + 1e-6;
    case "by":
      return ms <= 1000 * (outcome.atSec ?? 0) + 1e-6;
    default:
      return true;
  }
}
// --- end templates ---

/**
 * Whether the "outcome" strategy can plan this outcome: its moment is a seed's run's (OUTCOME_MOMENTS, or – --- templates --- – a
 * run of its own: OWN_RUN_MOMENTS).
 */
export function outcomeStrategyPlans(kind: FinderOutcomeKind | undefined): kind is FinderOutcomeKind {
  return kind !== undefined && (OUTCOME_MOMENTS[kind] !== undefined || OWN_RUN_MOMENTS[kind] !== undefined);
}

/**
 * The seconds a payoff of a clip in `bucket` can come at: a resolved clip's inside the planner's band (80–97 %) of a clip of the
 * bucket's length (its half second of slack each way), a cut one's 0.5–1 s after a cut at the recorder's least (10 s) or the
 * bucket's least, and at its most.
 */
export function bucketPayoffSec(bucket: LengthBucket, ending: EndingStyle): { fromSec: number; toSec: number } {
  const range = BUCKET_SECONDS[bucket];
  if (ending === "cliffhanger") return { fromSec: Math.max(RANGES.recordingDuration.min, range.min) + CLIFF_GAP_SEC.min, toSec: range.max + CLIFF_GAP_SEC.max };
  return { fromSec: PAYOFF_BAND.from * (range.min - 0.5), toSec: PAYOFF_BAND.accept * (range.max + 0.5) };
}

/**
 * Where the planner asks the finder for the outcome: at its payoff target (s), as far either way as the bucket's payoffs reach
 * (bucketPayoffSec), so the finder refuses only a moment no clip of the bucket could show – the clip around a moment it takes in
 * is the planner's own timing's to accept (planner.ts clipTiming), as for every strategy.
 */
export function payoffWindow(payoffTarget: number, bucket: LengthBucket, ending: EndingStyle): { atSec: number; toleranceSec: number } {
  const reach = bucketPayoffSec(bucket, ending);
  return { atSec: payoffTarget, toleranceSec: Math.max(ESCAPE_AT_TOLERANCE_SEC, payoffTarget - reach.fromSec, reach.toSec - payoffTarget) };
}

/**
 * The finder outcome the planner asks for: `kind` in the window (`at`: the target ± the tolerance; `by`: by the window's end;
 * `end`: no window, the verdict at the run's end), followed at most `horizonSec`. Without a window (a clip scored after the fact,
 * lib/insights/score.ts) the window is the whole run followed, so its moment is read wherever it comes.
 */
export function strategyOutcome(kind: FinderOutcomeKind, horizonSec: number, window?: { atSec: number; toleranceSec: number }): FinderOutcome {
  const w = window ?? { atSec: horizonSec / 2, toleranceSec: horizonSec / 2 };
  switch (windowOf(kind) /* --- templates --- (a run of its own too) */) {
    case "at":
      return { kind, clipSec: horizonSec, atSec: w.atSec, toleranceSec: w.toleranceSec };
    case "by":
      return { kind, clipSec: horizonSec, atSec: w.atSec + w.toleranceSec };
    default:
      return { kind, clipSec: horizonSec };
  }
}

/** What the bound outcome's run of one seed showed (RunFacts.outcomeRun). */
export interface OutcomeRunFacts {
  kind: FinderOutcomeKind;
  /** The outcome's moment (s of the clip; −1: it never came in the run followed). */
  atSec: number;
  /** The run met the outcome the finder was asked for (a winner: some team won). */
  matched: boolean;
  /** The team a winner outcome crowned (−1: none, or not a winner outcome). */
  winner: number;
  /** Where the run ended on its own, or closed its loop (outcomeClipSec, s); null: it went on past the run followed. */
  endSec: number | null;
  /**
   * --- templates --- (AI studio step 3) The end is a loop's seam the page's whole-loop export cuts on: the clip ends there, with
   * no stop after it (planner.ts clipTiming). Absent otherwise.
   */
  seam?: true;
}

/**
 * One seed's run for the bound outcome (the finder's own simulateOutcomeRun on `request`): the run's summary as the finder sums
 * it up and the outcome's facts – its moment, the match, the winner, the run's own end. `outcome`: the one the planner asked for
 * (the request's), else (scoring a clip after the fact) a window over the whole run followed.
 */
export function outcomeRunOf(request: FinderRequest, seed: number, kind: FinderOutcomeKind, horizonSec: number): { summary: RunSummary; facts: OutcomeRunFacts } {
  const outcome = request.outcome && request.outcome.kind === kind ? request.outcome : strategyOutcome(kind, horizonSec);
  // --- templates --- (AI studio step 3) an outcome a run of its own reads: its moment, the window, a run that loops on
  const own = ownRunOf(kind, request.mode); // (--- templates --- AI studio step 4: a mode's own first)
  if (own) {
    const run = own.run(request, seed, horizonSec);
    const endSec = run.endMs !== null && run.endMs >= 0 ? run.endMs / 1000 : null;
    const winner = run.winner ?? -1;
    return { summary: run.summary, facts: { kind, atSec: run.ms >= 0 ? run.ms / 1000 : -1, matched: inWindow(outcome, run.ms) && (kind !== "winner" || winner >= 0), winner, endSec, ...(run.seam && endSec !== null ? { seam: true as const } : {}) } };
  }
  const summary = simulateOutcomeRun(seed, request, outcome);
  const ms = OUTCOME_MOMENTS[kind]?.ms(summary) ?? -1;
  let winner = -1;
  if (kind === "winner") for (let team = 0; team < summary.teams.length; team++) if (outcomeMatches({ ...outcome, team }, summary)) winner = team;
  // (--- templates --- studio2 review round 2, 6: a mode's own refusal of a run its outcome matched – Colour Sort's stalled sort)
  const matched = (kind === "winner" ? winner >= 0 : outcomeMatches(outcome, summary)) && !OUTCOME_REFUSALS[request.mode]?.[kind]?.(request, seed, ms);
  const closes = summary.finished || (summary.cycleMs ?? 0) > 0;
  // --- templates --- (AI studio step 5) a run that closes its loop without finishing (Colour Sort: the sort, the chord's hold, the
  // remix) ends the clip on that loop's seam: the page's whole-loop export cuts it there, with no stop after it (clipTiming)
  const seam = !summary.finished && (summary.cycleMs ?? 0) > 0;
  return { summary, facts: { kind, atSec: ms >= 0 ? ms / 1000 : -1, matched, winner, endSec: closes ? outcomeClipSec(outcome, summary) : null, ...(seam ? { seam: true as const } : {}) } };
}

// --- templates --- (studio2 review round 2, 6)
/**
 * The longest a Colour Sort run may go, before its first sort completes, without a ball reaching its own band (s): the census's
 * longest still stretch. Past it the bands look formed long before the last straggler sets the chord off – the review watched
 * 5 s of nothing (3.35 s of it silent, no gate's pluck) before a payoff timed to the last ball. Every rise of the census is a
 * gate's pluck too, so no stretch of a kept seed is silent for longer. Measured at the binding's 160 balls (templates.ts
 * colourSortSettings), over 40 seeds: the longest still stretch is 1.7 s at the median at the speed of 240 (12 seeds refused)
 * and 2.55 s at 140 (21 of the 39 that sort refused), so the seed search still finds a seed within its 24: every plan of the
 * readiness grid did (36 of 36, and 4 of 4 in the studio's world).
 */
export const CS_STALL_SEC = 2.5;

/**
 * Colour Sort's longest still stretch before its first sort completes (s): the seed's run stepped as the page plays it, its
 * census (the balls in their own band; the gates are one-way, so it only rises) read every step from the start until the sort
 * completes – at most `sortedMs` (the finder's moment of it) and a second.
 */
export function colourSortStallSec(request: FinderRequest, seed: number, sortedMs: number): number {
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const step = 1000 / 60;
  let elapsed = 0;
  let census = engine.getColourSortView().sorted;
  let rose = 0;
  let longest = 0;
  while (elapsed < sortedMs + 1000) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step);
    engine.consumeSoundEvents();
    const v = engine.getColourSortView();
    if (v.sorted > census || v.completions > 0) {
      longest = Math.max(longest, elapsed - rose);
      rose = elapsed;
      census = v.sorted;
    }
    if (v.completions > 0) break;
  }
  return longest / 1000;
}

/**
 * --- templates --- (studio2 review round 2, 6) The runs a mode refuses although they meet its outcome (a seed of them never plans
 * when another does): Colour Sort's first sort that stalls before its last ball longer than CS_STALL_SEC.
 */
const OUTCOME_REFUSALS: Readonly<Partial<Record<ModeId, Partial<Record<FinderOutcomeKind, (request: FinderRequest, seed: number, ms: number) => boolean>>>>> = {
  colourSort: { "sorted-by": (request, seed, ms) => ms >= 0 && colourSortStallSec(request, seed, ms) > CS_STALL_SEC + 1e-9 },
};
// --- end templates ---

/* ------------------------------------------------------------------ atEnd */

/** The atEnd payoff: the clip's last this many seconds. */
export const AT_END_SEC = 1.5;

/**
 * The buckets an atEnd binding fills: its payoff, the clip's last AT_END_SEC, lands inside the planner's band (at most 97 % of the
 * clip) in a clip of 50 s or less – the short and the standard length, never the long one (60–90 s: 97.5 % and later).
 */
export const AT_END_BUCKETS: readonly LengthBucket[] = ["short", "standard"];

/** The payoff second of an atEnd clip `recordingDuration` long. */
export function atEndPayoffSec(recordingDuration: number): number {
  return recordingDuration - AT_END_SEC;
}

/**
 * The length (whole seconds, on the recording's step, from its least up) an atEnd clip takes for the planner's payoff target: the
 * clip the target is 85 % of, the middle of the planner's band, as for every resolved clip. Never capped.
 */
export function atEndRecordingSec(payoffTarget: number): number {
  return snapStep(Math.round(payoffTarget / ((PAYOFF_BAND.from + PAYOFF_BAND.to) / 2)), RANGES.recordingDuration);
}
// --- end templates ---
