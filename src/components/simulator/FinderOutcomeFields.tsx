"use client";

import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { selectClass, sliderStyle, type Translate } from "./ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { effectiveBallCount } from "@/lib/teams";
import { stringBattleBallName } from "@/lib/physics/modes/stringBattle"; // --- odd-string-battle ---
import { TY_PALETTE } from "@/lib/physics/modes/territory"; // --- odd-territory ---
import { mazeBallName } from "@/lib/physics/modes/maze"; // --- odd-maze ---
import { flSideNames } from "@/lib/physics/modes/fightLeague"; // --- fight-league ---
import { lcPaletteName } from "@/lib/physics/modes/landClaim"; // --- land-claim ---
import { circleLineup } from "@/lib/physics/modes/stringCircle"; // --- string-circle ---
import { ESCAPE_AT_TOLERANCE_SEC, type FinderOutcomeKind } from "@/lib/simulation/outcomes";
import { barLineDistanceMs } from "@/lib/simulation/outcomes"; // --- loop-foundation ---
import type { FinderProgress, FinderResult } from "@/lib/simulation/finder";
import NumberField from "./NumberField"; // --- uncap-all --- a number field next to every numeric control

/*
 * --- rigged --- The "Outcome" part of the Find Simulation panel (Simulator.tsx): what the found run must do – last the
 * chosen length (the classic search), never let a ball escape, have its first escape at a chosen second, or be won by
 * the chosen team. A compact select sits in the panel's title row (`FinderOutcomeSelect`), so the classic panel keeps
 * its height and its button stays where it was; an outcome search adds its explanation and its own field below
 * (`FinderOutcomeFields`). The text helpers give the panel and the canvas overlay their outcome-specific wording (null:
 * the classic duration wording applies). Strings live under `Rigged` in every messages file.
 */

const OUTCOME_LABELS: Record<FinderOutcomeKind, string> = {
  duration: "outcomeDuration",
  "never-escapes": "outcomeNeverEscapes",
  "escapes-at": "outcomeEscapesAt",
  winner: "outcomeWinner",
  // --- orb-grid ---
  "never-settles": "outcomeNeverSettles",
  "resolves-at": "outcomeResolvesAt",
  "double-ko": "outcomeDoubleKo", // --- fight-league ---
  close: "outcomeClose", // --- land-claim ---
  "fills-by": "outcomeFillsBy", // --- loop-foundation ---
  "fill-on-bar": "outcomeFillOnBar", // --- loop-foundation ---
  "star-set": "outcomeStarSet", // --- chord-stars ---
  "lift-order": "outcomeLiftOrder", // --- bead-hoops ---
  "all-up-by": "outcomeAllUpBy", // --- bead-hoops ---
};

const OUTCOME_HINTS: Record<FinderOutcomeKind, string> = {
  duration: "hintDuration",
  "never-escapes": "hintNeverEscapes",
  "escapes-at": "hintEscapesAt",
  winner: "hintWinner",
  // --- orb-grid ---
  "never-settles": "hintNeverSettles",
  "resolves-at": "hintResolvesAt",
  "double-ko": "hintDoubleKo", // --- fight-league ---
  close: "hintClose", // --- land-claim ---
  "fills-by": "hintFillsBy", // --- loop-foundation ---
  "fill-on-bar": "hintFillOnBar", // --- loop-foundation ---
  "star-set": "hintStarSet", // --- chord-stars ---
  "lift-order": "hintLiftOrder", // --- bead-hoops ---
  "all-up-by": "hintAllUpBy", // --- bead-hoops ---
};

/** The explanation of `outcome` (--- odd-string-battle --- a battle's winner is the last ball standing: its own hint; --- odd-territory --- Territory's the most tiles at the countdown). */
function hintKey(outcome: FinderOutcomeKind, battle: boolean | undefined, territory?: boolean, landClaim?: boolean): string {
  if (territory && outcome === "winner") return "hintWinnerTerritory";
  if (landClaim && outcome === "winner") return "hintWinnerLandClaim"; // --- land-claim --- (the most land at the end)
  return battle && outcome === "winner" ? "hintWinnerBattle" : OUTCOME_HINTS[outcome];
}

/**
 * The names of the balls that can win (one per start slot): the team roster's names ("Team 3" for an unnamed team), or
 * "Ball 1", "Ball 2" … without a roster. `name(kind, n)` translates the fallbacks.
 */
export function teamChoiceNames(settings: Pick<SimulatorSettings, "mode" | "ballCount" | "twoBalls" | "teams"> & { sbBalls?: number; tyTeams?: number; mzBalls?: number /* --- odd-maze --- */; lcTeams?: number /* --- land-claim --- */; sbStyle?: string /* --- string-circle --- */ } & Partial<Pick<SimulatorSettings, "flMatch" | "flFighterA" | "flFighterB" | "flFighterC" | "flFighterD">> /* --- fight-league --- */, name: (kind: "team" | "ball", n: number) => string): string[] {
  // --- fight-league --- Fight League's sides: "A · Thor", "B · Loki" (a random slot "A · ?"), in 2v2 "A+B · Naruto + Sasuke"
  if (settings.mode === "fightLeague") return flSideNames(settings.flMatch, [settings.flFighterA, settings.flFighterB, settings.flFighterC, settings.flFighterD]);
  const count = effectiveBallCount(settings);
  // --- string-circle --- the circle style's balls past the roster play the line-up's countries, named by their codes (TR, IN…) as on the canvas
  if (settings.mode === "stringBattle" && settings.sbStyle === "circle") return circleLineup(settings.teams.slice(0, count), count).map((l, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : l.name));
  // --- end string-circle ---
  // --- odd-string-battle --- the String Battle's balls go by the roster's names, then by their palette names (HOTPINK, AQUA…)
  if (settings.mode === "stringBattle") return Array.from({ length: count }, (_, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : stringBattleBallName(i)));
  // --- odd-territory --- Territory's teams go by the roster's names, then by their palette names (PINK, CYAN, LIME, GOLD)
  if (settings.mode === "territory") return Array.from({ length: count }, (_, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : TY_PALETTE[i % TY_PALETTE.length].name));
  // --- odd-maze --- the Maze's balls go by the roster's names, then by their palette names (SNOW, AQUA…)
  if (settings.mode === "maze") return Array.from({ length: count }, (_, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : mazeBallName(i)));
  // --- land-claim --- Land Claim's competitors go by the roster's names (its countries), then by their palette names (RED, BLUE…)
  if (settings.mode === "landClaim") return Array.from({ length: count }, (_, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : lcPaletteName(i) || name("team", i + 1)));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (settings.teams.length > 0) out.push(settings.teams[i]?.name || name("team", i + 1));
    else out.push(name("ball", i + 1));
  }
  return out;
}

export interface FinderOutcomeSelectProps {
  /** The outcomes the finder can search for in this mode (`availableOutcomes()`). */
  outcomes: readonly FinderOutcomeKind[];
  /** The outcome in effect (`effectiveOutcome()`). */
  outcome: FinderOutcomeKind;
  onOutcome: (outcome: FinderOutcomeKind) => void;
  disabled?: boolean;
  /** --- odd-string-battle --- a battle mode (`BATTLE_WINNER_MODES`): the winner is the last ball standing. */
  battle?: boolean;
  /** --- odd-territory --- Territory: the winner is the team with the most tiles when the countdown runs out. */
  territory?: boolean;
  /** --- land-claim --- Land Claim: the winner is the competitor with the most land when the run ends. */
  landClaim?: boolean;
}

/**
 * The compact Outcome select in the Find Simulation panel's title row (so the classic panel keeps its height); nothing
 * when the run length is all the finder can search in this mode.
 */
export function FinderOutcomeSelect({ outcomes, outcome, onOutcome, disabled, battle, territory, landClaim }: FinderOutcomeSelectProps) {
  const r = useTranslations("Rigged");
  if (outcomes.length === 0 || (outcomes.length === 1 && outcomes[0] === "duration")) return null;
  return (
    <span className="ml-auto flex items-center gap-1 min-w-0" data-testid="finder-outcome">
      <label className="text-xs font-bold uppercase tracking-wider text-ink-3 hidden sm:flex items-center shrink-0" htmlFor="find-outcome">
        {r("outcome")}
        <Tooltip text={r("outcomeTip")} />
      </label>
      <select
        id="find-outcome"
        value={outcome}
        aria-label={r("outcome")}
        title={r(hintKey(outcome, battle, territory, landClaim))}
        disabled={disabled}
        onChange={(e) => onOutcome(e.target.value as FinderOutcomeKind)}
        className="h-8 min-w-0 max-w-[11rem] px-2 bg-surface-2 text-ink text-xs rounded-md border border-line-strong focus:border-accent-dim cursor-pointer disabled:opacity-50 [@media(pointer:coarse)]:min-h-11" /* --- review fix (site-redesign) --- a 32 px target (44 px on touch) */
      >
        {outcomes.map((kind) => (
          <option key={kind} value={kind}>
            {r(OUTCOME_LABELS[kind])}
          </option>
        ))}
      </select>
    </span>
  );
}

export interface FinderOutcomeFieldsProps {
  /** The outcome in effect (`effectiveOutcome()`). */
  outcome: FinderOutcomeKind;
  /** Escapes at: the target second (--- orb-grid --- resolves at: the same field, the first resolve's second). */
  escapeAt: number;
  onEscapeAt: (sec: number) => void;
  /** Winner: the team slot and the names to pick from. */
  winner: number;
  onWinner: (team: number) => void;
  teamNames: readonly string[];
  disabled?: boolean;
  /** --- odd-string-battle --- a battle mode (`BATTLE_WINNER_MODES`): the winner is the last ball standing, the battle played to its end. */
  battle?: boolean;
  /** --- odd-territory --- Territory: the winner is the team with the most tiles when the countdown runs out. */
  territory?: boolean;
  /** --- land-claim --- Land Claim: the winner is the competitor with the most land when the run ends. */
  landClaim?: boolean;
}

/** An outcome search's one-line explanation and its own field (the escape second, the team to win); nothing for the classic run-length search. */
export default function FinderOutcomeFields({ outcome, escapeAt, onEscapeAt, winner, onWinner, teamNames, disabled, battle, territory, landClaim }: FinderOutcomeFieldsProps) {
  const r = useTranslations("Rigged");
  if (outcome === "duration") return null;
  const range = RANGES.findEscapeAt;
  return (
    <div className="space-y-3" data-testid="finder-outcome-fields">
      <p className="text-xs text-ink-3 leading-relaxed" data-testid="finder-outcome-hint">{r(hintKey(outcome, battle, territory, landClaim))}</p>
      {(outcome === "escapes-at" || outcome === "resolves-at") /* --- orb-grid --- */ && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-ink-3" htmlFor="find-escape-at">
              {r(outcome === "resolves-at" ? "resolveAt" : "escapeAt")}
            </label>
            <span className="text-xs font-mono text-accent">
              {escapeAt.toFixed(1)}s ±{ESCAPE_AT_TOLERANCE_SEC}s
            </span>
          </div>
          <input
            id="find-escape-at"
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={escapeAt}
            disabled={disabled}
            onChange={(e) => onEscapeAt(Number(e.target.value))}
            aria-label={r(outcome === "resolves-at" ? "resolveAt" : "escapeAt")}
            className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer disabled:opacity-50"
            style={sliderStyle(escapeAt, range.min, range.max)}
          />
          <NumberField value={escapeAt} onCommit={onEscapeAt} label={r(outcome === "resolves-at" ? "resolveAt" : "escapeAt")} range={range} rules={{ min: range.min }} disabled={disabled} settingKey="findEscapeAt" /* --- uncap-all --- */ />
        </div>
      )}
      {/* --- loop-foundation --- the fill's time limit (the escape slider's range and field) */}
      {outcome === "fills-by" && (
        <div className="space-y-1.5" data-testid="finder-fill-by">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-ink-3" htmlFor="find-fill-by">
              {r("fillBy")}
            </label>
            <span className="text-xs font-mono text-accent">≤ {escapeAt.toFixed(1)}s</span>
          </div>
          <input
            id="find-fill-by"
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={escapeAt}
            disabled={disabled}
            onChange={(e) => onEscapeAt(Number(e.target.value))}
            aria-label={r("fillBy")}
            className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer disabled:opacity-50"
            style={sliderStyle(escapeAt, range.min, range.max)}
          />
          <NumberField value={escapeAt} onCommit={onEscapeAt} label={r("fillBy")} range={range} rules={{ min: range.min }} disabled={disabled} settingKey="findEscapeAt" />
        </div>
      )}
      {/* --- end loop-foundation --- */}
      {/* --- bead-hoops --- every bead up within a time limit (the escape slider's range and field) */}
      {outcome === "all-up-by" && (
        <div className="space-y-1.5" data-testid="finder-all-up-by">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-ink-3" htmlFor="find-all-up-by">
              {r("allUpBy")}
            </label>
            <span className="text-xs font-mono text-accent">≤ {escapeAt.toFixed(1)}s</span>
          </div>
          <input
            id="find-all-up-by"
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={escapeAt}
            disabled={disabled}
            onChange={(e) => onEscapeAt(Number(e.target.value))}
            aria-label={r("allUpBy")}
            className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer disabled:opacity-50"
            style={sliderStyle(escapeAt, range.min, range.max)}
          />
          <NumberField value={escapeAt} onCommit={onEscapeAt} label={r("allUpBy")} range={range} rules={{ min: range.min }} disabled={disabled} settingKey="findEscapeAt" />
        </div>
      )}
      {/* --- end bead-hoops --- */}
      {outcome === "winner" && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-ink-3" htmlFor="find-winner">
            {r("winnerTeam")}
          </label>
          <select id="find-winner" value={Math.min(winner, teamNames.length - 1)} disabled={disabled} onChange={(e) => onWinner(Number(e.target.value))} className={`${selectClass} text-sm disabled:opacity-50`}>
            {teamNames.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ texts (root translator: "Rigged.*" keys) */

export interface OutcomeTextContext {
  /** The duration slider (the clip for never-escapes, the longest run for the winner). */
  duration: number;
  escapeAt: number;
  winnerName: string;
  /** --- loop-foundation --- The bar's length (s) a fill-on-bar search aims at (four beats at the page's BPM). */
  barSec?: number;
}

// --- loop-foundation ---
/** How far (s) a fill at `fillAt` s lands from the nearest bar line, as the panel shows it. */
function barOffsetText(fillAt: number | undefined, barSec: number | undefined): string {
  if (fillAt === undefined || !(barSec !== undefined && barSec > 0)) return "?";
  return (barLineDistanceMs(1000 * fillAt, 1000 * barSec) / 1000).toFixed(3);
}
// --- end loop-foundation ---

/** The finder button's label for an outcome search; null for the classic duration search. */
export function outcomeButtonText(t: Translate, outcome: FinderOutcomeKind | null, c: OutcomeTextContext): string | null {
  switch (outcome) {
    case "never-escapes":
      return t("Rigged.findNeverEscapes", { duration: c.duration });
    case "escapes-at":
      return t("Rigged.findEscapesAt", { time: c.escapeAt.toFixed(1) });
    case "winner":
      return t("Rigged.findWinner", { name: c.winnerName });
    // --- orb-grid ---
    case "never-settles":
      return t("Rigged.findNeverSettles", { duration: c.duration });
    case "resolves-at":
      return t("Rigged.findResolvesAt", { time: c.escapeAt.toFixed(1) });
    case "double-ko": // --- fight-league ---
      return t("Rigged.findDoubleKo");
    case "close": // --- land-claim ---
      return t("Rigged.findClose");
    case "fills-by": // --- loop-foundation ---
      return t("Rigged.findFillsBy", { time: c.escapeAt.toFixed(1) });
    case "fill-on-bar": // --- loop-foundation ---
      return t("Rigged.findFillOnBar");
    case "star-set": // --- chord-stars ---
      return t("Rigged.findStarSet", { duration: c.duration });
    case "lift-order": // --- bead-hoops ---
      return t("Rigged.findLiftOrder");
    case "all-up-by": // --- bead-hoops ---
      return t("Rigged.findAllUpBy", { time: c.escapeAt.toFixed(1) });
    default:
      return null;
  }
}

/** The panel's "Found!" line for an outcome result; null for a duration result. */
export function outcomeFoundText(t: Translate, result: FinderResult, c: OutcomeTextContext): string | null {
  switch (result.outcome) {
    case "never-escapes":
      return t("Rigged.foundNeverEscapes", { duration: result.duration.toFixed(1) });
    case "escapes-at":
      return t("Rigged.foundEscapesAt", { time: (result.escapeAt ?? 0).toFixed(1) });
    case "winner":
      return t("Rigged.foundWinner", { name: c.winnerName, duration: result.duration.toFixed(1) });
    // --- orb-grid ---
    case "never-settles":
      return t("Rigged.foundNeverSettles", { duration: result.duration.toFixed(1) });
    case "resolves-at":
      return t("Rigged.foundResolvesAt", { time: (result.resolveAt ?? 0).toFixed(1) });
    case "double-ko": // --- fight-league ---
      return t("Rigged.foundDoubleKo", { duration: result.duration.toFixed(1) });
    case "close": // --- land-claim ---
      return t("Rigged.foundClose", { duration: result.duration.toFixed(1) });
    case "fills-by": // --- loop-foundation ---
      return t("Rigged.foundFillsBy", { time: (result.fillAt ?? 0).toFixed(2) });
    case "fill-on-bar": // --- loop-foundation ---
      return t("Rigged.foundFillOnBar", { time: (result.fillAt ?? 0).toFixed(2) });
    case "star-set": // --- chord-stars --- (the stars found, the loops in the clip and the drawing time of each)
      return t("Rigged.foundStarSet", { stars: starSetText(result), loops: result.starChords?.loops ?? 0, cycle: (result.starChords?.cycleSec ?? 0).toFixed(2) });
    case "lift-order": // --- bead-hoops ---
      return t("Rigged.foundLiftOrder");
    case "all-up-by": // --- bead-hoops ---
      return t("Rigged.foundAllUpBy", { time: (result.allUpAt ?? 0).toFixed(2) });
    default:
      return null;
  }
}

/** The panel's short "closest" line for an outcome search that found nothing; null for a duration search. */
export function outcomeMissText(t: Translate, result: FinderResult, c: OutcomeTextContext): string | null {
  switch (result.outcome) {
    case "never-escapes":
      return t("Rigged.missNeverEscapes", { duration: result.duration.toFixed(1), seeds: result.seedsTested });
    case "escapes-at":
      return result.escapeAt === undefined ? t("Rigged.missNoEscape", { seeds: result.seedsTested }) : t("Rigged.missEscapesAt", { time: result.escapeAt.toFixed(1), seeds: result.seedsTested });
    case "winner":
      return t("Rigged.missWinner", { name: c.winnerName, seeds: result.seedsTested });
    // --- orb-grid ---
    case "never-settles":
      return t("Rigged.missNeverSettles", { duration: result.duration.toFixed(1), seeds: result.seedsTested });
    case "resolves-at":
      if (result.orbCycle !== undefined) return orbCycleText(t, result, c); // --- orb-rhythm --- (the cycle maths' answer: no seeds searched)
      return result.resolveAt === undefined ? t("Rigged.missNoResolve", { seeds: result.seedsTested }) : t("Rigged.missResolvesAt", { time: result.resolveAt.toFixed(1), seeds: result.seedsTested });
    case "double-ko": // --- fight-league ---
      return t("Rigged.missDoubleKo", { seeds: result.seedsTested });
    case "close": // --- land-claim --- (the closest gap between the top two, in percent of the land)
      return t("Rigged.missClose", { margin: result.duration.toFixed(1), seeds: result.seedsTested });
    case "fills-by": // --- loop-foundation ---
      return t("Rigged.missFillsBy", { time: c.escapeAt.toFixed(1), seeds: result.seedsTested });
    case "fill-on-bar": // --- loop-foundation ---
      return result.fillAt === undefined ? t("Rigged.missNoFill", { seeds: result.seedsTested }) : t("Rigged.missFillOnBar", { offset: barOffsetText(result.fillAt, c.barSec), seeds: result.seedsTested });
    case "star-set": // --- chord-stars --- (not even one loop fits the clip: `duration` is the shortest loop)
      return t("Rigged.missStarSet", { duration: result.duration.toFixed(1) });
    case "lift-order": // --- bead-hoops ---
      return t("Rigged.missLiftOrder", { seeds: result.seedsTested });
    case "all-up-by": // --- bead-hoops ---
      return result.allUpAt === undefined ? t("Rigged.missNoAllUp", { seeds: result.seedsTested }) : t("Rigged.missAllUpBy", { time: result.allUpAt.toFixed(1), seeds: result.seedsTested });
    default:
      return null;
  }
}

/** The canvas overlay's explanation for an outcome search that found nothing; null for a duration search. */
export function outcomeOverlayText(t: Translate, result: FinderResult, c: OutcomeTextContext): string | null {
  switch (result.outcome) {
    case "never-escapes":
      return t("Rigged.overlayNeverEscapes", { tested: result.seedsTested, closest: result.duration.toFixed(1), target: c.duration });
    case "escapes-at":
      return result.escapeAt === undefined
        ? t("Rigged.overlayNoEscape", { tested: result.seedsTested, target: c.escapeAt.toFixed(1) })
        : t("Rigged.overlayEscapesAt", { tested: result.seedsTested, closest: result.escapeAt.toFixed(1), target: c.escapeAt.toFixed(1), tolerance: ESCAPE_AT_TOLERANCE_SEC });
    case "winner":
      return t("Rigged.overlayWinner", { tested: result.seedsTested, name: c.winnerName });
    // --- orb-grid ---
    case "never-settles":
      return t("Rigged.overlayNeverSettles", { tested: result.seedsTested, closest: result.duration.toFixed(1), target: c.duration });
    case "resolves-at":
      if (result.orbCycle !== undefined) return orbCycleText(t, result, c); // --- orb-rhythm ---
      return result.resolveAt === undefined
        ? t("Rigged.overlayNoResolve", { tested: result.seedsTested, target: c.escapeAt.toFixed(1) })
        : t("Rigged.overlayResolvesAt", { tested: result.seedsTested, closest: result.resolveAt.toFixed(1), target: c.escapeAt.toFixed(1), tolerance: ESCAPE_AT_TOLERANCE_SEC });
    case "double-ko": // --- fight-league ---
      return t("Rigged.overlayDoubleKo", { tested: result.seedsTested });
    case "close": // --- land-claim ---
      return t("Rigged.overlayClose", { tested: result.seedsTested, margin: result.duration.toFixed(1) });
    case "fills-by": // --- loop-foundation ---
      return t("Rigged.overlayFillsBy", { tested: result.seedsTested, target: c.escapeAt.toFixed(1) });
    case "fill-on-bar": // --- loop-foundation ---
      return result.fillAt === undefined ? t("Rigged.overlayNoFill", { tested: result.seedsTested }) : t("Rigged.overlayFillOnBar", { tested: result.seedsTested, offset: barOffsetText(result.fillAt, c.barSec) });
    case "star-set": // --- chord-stars ---
      return t("Rigged.overlayStarSet", { duration: result.duration.toFixed(1), target: c.duration });
    case "lift-order": // --- bead-hoops ---
      return t("Rigged.overlayLiftOrder", { tested: result.seedsTested });
    case "all-up-by": // --- bead-hoops ---
      return t("Rigged.overlayAllUpBy", { tested: result.seedsTested, target: c.escapeAt.toFixed(1) });
    default:
      return null;
  }
}

// --- chord-stars ---
/** A Chord Stars result's stars as the panel shows them ("5/2, 7/3, 8/3"; the first twelve of a bigger set, then "…"). */
function starSetText(result: FinderResult): string {
  const stars = (result.starChords?.stars ?? "").split(",").filter(Boolean);
  return stars.length > 12 ? `${stars.slice(0, 12).join(", ")}, …` : stars.join(", ");
}
// --- end chord-stars ---

// --- orb-rhythm ---
/**
 * A rhythm field's "In phase at" that missed – answered by the cycle maths, not by seeds: the field is in phase at every
 * multiple of its cycle (the nearest one named, and the cycle that would put one on the target), or never with the
 * polyrhythm off.
 */
export function orbCycleText(t: Translate, result: FinderResult, c: OutcomeTextContext): string {
  const cycle = result.orbCycle ?? NaN;
  if (!Number.isFinite(cycle) || result.resolveAt === undefined) return t("Rigged.missResolvesNever");
  return t("Rigged.missResolvesCycle", { cycle: cycle.toFixed(1), time: result.resolveAt.toFixed(1), target: c.escapeAt.toFixed(1) });
}
// --- end orb-rhythm ---

/** The progress line of an outcome search (the closest run so far); null for a duration search or when there is nothing to say yet. */
export function outcomeProgressText(t: Translate, outcome: FinderOutcomeKind | null, progress: FinderProgress): string | null {
  if (outcome === "never-escapes") return t("Rigged.progressNeverEscapes", { duration: progress.bestDuration.toFixed(1) });
  if (outcome === "escapes-at") return progress.bestDuration > 0 ? t("Rigged.progressEscapesAt", { time: progress.bestDuration.toFixed(1) }) : null;
  // --- orb-grid ---
  if (outcome === "never-settles") return t("Rigged.progressNeverSettles", { duration: progress.bestDuration.toFixed(1) });
  if (outcome === "resolves-at") return progress.bestDuration > 0 ? t("Rigged.progressResolvesAt", { time: progress.bestDuration.toFixed(1) }) : null;
  if (outcome === "close") return progress.bestDuration < 100 ? t("Rigged.progressClose", { margin: progress.bestDuration.toFixed(1) }) : null; // --- land-claim ---
  if (outcome === "all-up-by") return progress.bestDuration > 0 ? t("Rigged.progressAllUpBy", { time: progress.bestDuration.toFixed(1) }) : null; // --- bead-hoops ---
  return null;
}
