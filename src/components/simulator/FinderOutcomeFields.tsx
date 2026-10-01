"use client";

import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { selectClass, sliderStyle, type Translate } from "./ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { effectiveBallCount } from "@/lib/teams";
import { stringBattleBallName } from "@/lib/physics/modes/stringBattle"; // --- odd-string-battle ---
import { TY_PALETTE } from "@/lib/physics/modes/territory"; // --- odd-territory ---
import { ESCAPE_AT_TOLERANCE_SEC, type FinderOutcomeKind } from "@/lib/simulation/outcomes";
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
};

const OUTCOME_HINTS: Record<FinderOutcomeKind, string> = {
  duration: "hintDuration",
  "never-escapes": "hintNeverEscapes",
  "escapes-at": "hintEscapesAt",
  winner: "hintWinner",
};

/** The explanation of `outcome` (--- odd-string-battle --- a battle's winner is the last ball standing: its own hint; --- odd-territory --- Territory's the most tiles at the countdown). */
function hintKey(outcome: FinderOutcomeKind, battle: boolean | undefined, territory?: boolean): string {
  if (territory && outcome === "winner") return "hintWinnerTerritory";
  return battle && outcome === "winner" ? "hintWinnerBattle" : OUTCOME_HINTS[outcome];
}

/**
 * The names of the balls that can win (one per start slot): the team roster's names ("Team 3" for an unnamed team), or
 * "Ball 1", "Ball 2" … without a roster. `name(kind, n)` translates the fallbacks.
 */
export function teamChoiceNames(settings: Pick<SimulatorSettings, "mode" | "ballCount" | "twoBalls" | "teams"> & { sbBalls?: number; tyTeams?: number }, name: (kind: "team" | "ball", n: number) => string): string[] {
  const count = effectiveBallCount(settings);
  // --- odd-string-battle --- the String Battle's balls go by the roster's names, then by their palette names (HOTPINK, AQUA…)
  if (settings.mode === "stringBattle") return Array.from({ length: count }, (_, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : stringBattleBallName(i)));
  // --- odd-territory --- Territory's teams go by the roster's names, then by their palette names (PINK, CYAN, LIME, GOLD)
  if (settings.mode === "territory") return Array.from({ length: count }, (_, i) => (i < settings.teams.length ? settings.teams[i].name || name("team", i + 1) : TY_PALETTE[i % TY_PALETTE.length].name));
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
}

/**
 * The compact Outcome select in the Find Simulation panel's title row (so the classic panel keeps its height); nothing
 * when the run length is all the finder can search in this mode.
 */
export function FinderOutcomeSelect({ outcomes, outcome, onOutcome, disabled, battle, territory }: FinderOutcomeSelectProps) {
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
        title={r(hintKey(outcome, battle, territory))}
        disabled={disabled}
        onChange={(e) => onOutcome(e.target.value as FinderOutcomeKind)}
        className="min-w-0 max-w-[11rem] px-2 py-1 bg-surface-2 text-ink text-xs rounded-lg border border-line-strong focus:border-accent-dim cursor-pointer disabled:opacity-50"
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
  /** Escapes at: the target second. */
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
}

/** An outcome search's one-line explanation and its own field (the escape second, the team to win); nothing for the classic run-length search. */
export default function FinderOutcomeFields({ outcome, escapeAt, onEscapeAt, winner, onWinner, teamNames, disabled, battle, territory }: FinderOutcomeFieldsProps) {
  const r = useTranslations("Rigged");
  if (outcome === "duration") return null;
  const range = RANGES.findEscapeAt;
  return (
    <div className="space-y-3" data-testid="finder-outcome-fields">
      <p className="text-xs text-ink-3 leading-relaxed" data-testid="finder-outcome-hint">{r(hintKey(outcome, battle, territory))}</p>
      {outcome === "escapes-at" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-ink-3" htmlFor="find-escape-at">
              {r("escapeAt")}
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
            aria-label={r("escapeAt")}
            className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer disabled:opacity-50"
            style={sliderStyle(escapeAt, range.min, range.max)}
          />
          <NumberField value={escapeAt} onCommit={onEscapeAt} label={r("escapeAt")} range={range} rules={{ min: range.min }} disabled={disabled} settingKey="findEscapeAt" /* --- uncap-all --- */ />
        </div>
      )}
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
}

/** The finder button's label for an outcome search; null for the classic duration search. */
export function outcomeButtonText(t: Translate, outcome: FinderOutcomeKind | null, c: OutcomeTextContext): string | null {
  switch (outcome) {
    case "never-escapes":
      return t("Rigged.findNeverEscapes", { duration: c.duration });
    case "escapes-at":
      return t("Rigged.findEscapesAt", { time: c.escapeAt.toFixed(1) });
    case "winner":
      return t("Rigged.findWinner", { name: c.winnerName });
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
    default:
      return null;
  }
}

/** The progress line of an outcome search (the closest run so far); null for a duration search or when there is nothing to say yet. */
export function outcomeProgressText(t: Translate, outcome: FinderOutcomeKind | null, progress: FinderProgress): string | null {
  if (outcome === "never-escapes") return t("Rigged.progressNeverEscapes", { duration: progress.bestDuration.toFixed(1) });
  if (outcome === "escapes-at") return progress.bestDuration > 0 ? t("Rigged.progressEscapesAt", { time: progress.bestDuration.toFixed(1) }) : null;
  return null;
}
