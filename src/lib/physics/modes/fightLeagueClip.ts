import { CAPTION_WINNER_TOKEN, defaultCaption, sanitizeCaptionText, type Caption } from "@/lib/captions";
import type { FinderOutcome, FinderOutcomeKind } from "@/lib/simulation/outcomes";
import type { FightLeagueView } from "./fightLeague";
import { FL_UNDERDOG, type FlShowKind } from "./fightLeagueShow";
import { FL_INTRO_MS } from "./fightLeague";

/*
 * --- fl-overhaul --- (Stage 6) "Make a clip": the pure planning of a Fight League clip (no DOM, no clock, no random numbers).
 *
 * The panel (sections/FightLeagueCreatorSection.tsx) picks a length bucket (short 15 s, standard 25 s, long 75 s) and a story
 * (any KO, an upset, a clutch win, a comeback, an ability finish, a cliffhanger; a bracket's champion, the boss falling); the
 * page (Simulator.tsx, `components/simulator/fightLeague/makeClip.ts`) measures how long the current matchup takes to a KO
 * (`FL_CLIP_PACE_SEEDS` seeds headless), asks `planFlClip()` for the plan and runs Find Simulation with it – the existing
 * finder plumbing and its UI:
 *
 *  - one match (1v1, 2v2, 3v3, a free-for-all): the final KO lands at 82–88 % of the bucket (`FL_CLIP_KO_WINDOW`) – "any KO"
 *    through the duration search (its target and tolerance), a story through its Stage 5 outcome with the KO window
 *    (`FinderOutcome.finishWithin`); the match is paced to the clip first (`flPacedHp()`: the HP that puts the measured median
 *    KO at 85 %, so the window is reachable for any matchup – Thor vs Loki at 100 HP is over in 11–19 s);
 *  - the cliffhanger: every side at or under 25 % within the clip's last second with the fight still on at its end (the
 *    both-low-at outcome, `cutWhileOn`): the clip is cut there and the question stays open;
 *  - a show (a series, a bracket, a boss rush): its verdict ends the clip – the champion (a pinned entrant), the boss falling at
 *    its last wave, any finished show or a story of its deciding match; the clip is the bucket or the whole show with its finale
 *    and the winner's hold when that is longer (`flClipRecordingSec()`).
 *
 * The found clip gets a question caption ("Who wins?", 0–2.5 s, answered with "[winner] wins!" – `CAPTION_WINNER_TOKEN`; the
 * cliffhanger asks again at the end and never answers) and a Top Text for viewers with the sound off ("Thor vs Loki", "Can
 * Gerald beat all 6?", "8 fighters. 1 champion."). No reference branding in any of it.
 */

export const FL_CLIP_BUCKETS = ["short", "standard", "long"] as const;
export type FlClipBucket = (typeof FL_CLIP_BUCKETS)[number];
/** The clip length of each bucket (s). */
export const FL_CLIP_BUCKET_SEC: Readonly<Record<FlClipBucket, number>> = { short: 15, standard: 25, long: 75 };

export const FL_CLIP_STORIES = ["any", "upset", "clutch", "comeback", "ability", "cliffhanger", "champion", "boss"] as const;
export type FlClipStory = (typeof FL_CLIP_STORIES)[number];

/** Where the final KO lands in a clip of one match (fractions of the clip). */
export const FL_CLIP_KO_WINDOW = { from: 0.82, to: 0.88 } as const;
export const FL_CLIP_KO_MID = (FL_CLIP_KO_WINDOW.from + FL_CLIP_KO_WINDOW.to) / 2;
/** The question caption's window (s). */
export const FL_CLIP_QUESTION_SEC = 2.5;
/** The cliffhanger asks again for the clip's last seconds. */
export const FL_CLIP_CLOSING_SEC = 2;
/** A cliffhanger's match is paced so the median KO comes a little after the cut (the both-low moment comes before it). */
export const FL_CLIP_CLIFF_PACE = 1.08;
/** The seeds the page measures a matchup's pace on (median KO), always the same so the pace is reproducible. */
export const FL_CLIP_PACE_SEEDS: readonly number[] = [104729, 209459, 314189, 418919, 523649, 628379, 733109, 837839];
/** A measured pace this close to the target keeps the HP as it is (no restart for a nudge). */
export const FL_CLIP_PACE_SLACK = 0.04;
/** The fight's KO is at least the VS card's intro into the run (s). */
const INTRO_SEC = FL_INTRO_MS / 1000;

export function isFlClipBucket(value: unknown): value is FlClipBucket {
  return typeof value === "string" && (FL_CLIP_BUCKETS as readonly string[]).includes(value);
}
export function isFlClipStory(value: unknown): value is FlClipStory {
  return typeof value === "string" && (FL_CLIP_STORIES as readonly string[]).includes(value);
}

/** The Stage 5 finder outcome of a story (null: "any KO" – the duration search, or any finished show). */
export function flClipStoryOutcome(story: FlClipStory): FinderOutcomeKind | null {
  switch (story) {
    case "upset":
      return "upset";
    case "clutch":
      return "clutch";
    case "comeback":
      return "comeback";
    case "ability":
      return "ability-finish";
    case "cliffhanger":
      return "both-low-at";
    case "champion":
      return "champion";
    case "boss":
      return "boss-falls-at";
    default:
      return null;
  }
}

export interface FlClipStoryContext {
  /** The run's show kind (`flShowKind()`). */
  kind: FlShowKind;
  /** A bracket's pinned entrants (the champion story names one of them: slot A's). */
  pinned: number;
  /** Whether a side can be an underdog (a win chance under 40 %): random slots can, a measured even pairing cannot. */
  upsetPossible: boolean;
}

/** The stories the format offers: the match's own for one match (the cliffhanger too), a bracket's champion, the boss falling. */
export function flClipStories(ctx: FlClipStoryContext): FlClipStory[] {
  const out: FlClipStory[] = ["any"];
  if (ctx.upsetPossible) out.push("upset");
  out.push("clutch", "comeback", "ability");
  if (ctx.kind === "single") out.push("cliffhanger");
  if (ctx.kind === "bracket" && ctx.pinned >= 1) out.push("champion");
  if (ctx.kind === "boss") out.push("boss");
  return out;
}

/** Whether an upset is possible between these sides' win chances (`flWinChances()`; null: a side is drawn by the seed). */
export function flClipUpsetPossible(chances: readonly number[] | null): boolean {
  if (!chances) return true;
  return chances.some((c) => c < FL_UNDERDOG - 1e-9);
}

/** The median of some run lengths (s); null without any. */
export function flMedianSec(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * The HP that paces a match so its median KO lands at `targetSec` (s into the run), from the median KO `baseSec` measured at
 * `hp`: the fight after the VS card scales with the HP. A whole number from 1 (the setting is uncapped above); `hp` itself when
 * the measured pace is within `FL_CLIP_PACE_SLACK` of the target, or when nothing was measured.
 */
export function flPacedHp(hp: number, baseSec: number | null, targetSec: number): number {
  if (baseSec === null || !(baseSec > INTRO_SEC + 0.05) || !(targetSec > INTRO_SEC)) return hp;
  if (Math.abs(baseSec - targetSec) <= FL_CLIP_PACE_SLACK * targetSec) return hp;
  const k = (targetSec - INTRO_SEC) / (baseSec - INTRO_SEC);
  return Math.max(1, Math.round(hp * k));
}

export interface FlClipInput {
  kind: FlShowKind;
  bucket: FlClipBucket;
  story: FlClipStory;
  /** The HP now and the matchup's median KO measured at it (s into the run; one match only, null otherwise). */
  hp: number;
  baseKoSec: number | null;
  /** A boss rush's waves (the boss story: it falls at the last one). */
  bossWaves: number;
  /** The panel's estimate of a show's clip (s; `flShowClipEstimateSec()`). */
  showEstimateSec: number;
}

export interface FlClipPlan {
  bucket: FlClipBucket;
  story: FlClipStory;
  kind: FlShowKind;
  /** The bucket's clip (s); a show's clip grows to the whole show (`flClipRecordingSec()`). */
  clipSec: number;
  /** One match: the KO window (s into the run); null for a show (its verdict ends the clip). */
  window: { fromSec: number; toSec: number } | null;
  /** The HP the match plays with (paced to the clip; the HP as it was for a show). */
  hp: number;
  /** The finder's outcome (null: the duration search – `targetSec` ± `toleranceSec`). */
  outcome: FinderOutcome | null;
  targetSec: number;
  toleranceSec: number;
  /** The cliffhanger: the clip ends with every side low and the fight on, the question unanswered. */
  cliffhanger: boolean;
}

/** Plans a clip (pure): the window, the pace, the finder's outcome or duration target. */
export function planFlClip(input: FlClipInput): FlClipPlan {
  const clipSec = FL_CLIP_BUCKET_SEC[input.bucket];
  const story = input.story;
  const kind = input.kind;
  if (kind !== "single") {
    // a show: its verdict ends the clip (no window); "any" accepts any show that finishes (about its estimate, within twice it)
    const estimate = Math.max(clipSec, input.showEstimateSec);
    const outcomeKind = flClipStoryOutcome(story);
    const outcome: FinderOutcome | null =
      outcomeKind === null || outcomeKind === "both-low-at"
        ? null
        : { kind: outcomeKind, clipSec, ...(outcomeKind === "champion" ? { team: 0 } : {}), ...(outcomeKind === "boss-falls-at" ? { count: Math.max(1, Math.round(input.bossWaves)) } : {}) };
    return { bucket: input.bucket, story, kind, clipSec, window: null, hp: input.hp, outcome, targetSec: estimate, toleranceSec: estimate, cliffhanger: false };
  }
  if (story === "cliffhanger") {
    // every side low within the clip's last second, the fight still on at its end – the clip is cut there
    const hp = flPacedHp(input.hp, input.baseKoSec, FL_CLIP_CLIFF_PACE * clipSec);
    const outcome: FinderOutcome = { kind: "both-low-at", clipSec, atSec: clipSec - 0.5, toleranceSec: 0.5, cutWhileOn: true };
    return { bucket: input.bucket, story, kind, clipSec, window: null, hp, outcome, targetSec: clipSec, toleranceSec: 0.5, cliffhanger: true };
  }
  const fromSec = round3(FL_CLIP_KO_WINDOW.from * clipSec);
  const toSec = round3(FL_CLIP_KO_WINDOW.to * clipSec);
  const targetSec = round3(FL_CLIP_KO_MID * clipSec);
  const toleranceSec = round3((toSec - fromSec) / 2);
  const hp = flPacedHp(input.hp, input.baseKoSec, targetSec);
  const outcomeKind = flClipStoryOutcome(story);
  const outcome: FinderOutcome | null = outcomeKind === null || outcomeKind === "champion" || outcomeKind === "boss-falls-at" ? null : { kind: outcomeKind, clipSec, finishWithin: { fromSec, toSec } };
  return { bucket: input.bucket, story, kind, clipSec, window: { fromSec, toSec }, hp, outcome, targetSec, toleranceSec, cliffhanger: false };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The clip a found run is recorded for (s, whole): the bucket for one match (its KO at 82–88 %, the finale and the start of the
 * winner's card after it) and for a cliffhanger (cut while every side is low); a show's whole run with its finale and the
 * winner's hold – ceil(duration + finale + hold) – when that is longer than the bucket.
 */
export function flClipRecordingSec(plan: FlClipPlan, foundSec: number, finaleSec: number, holdSec: number): number {
  if (plan.kind === "single") return plan.clipSec;
  return Math.max(plan.clipSec, Math.ceil(foundSec + finaleSec + holdSec - 1e-9));
}

/** Where the final KO lands in the recorded clip (0–1; null for a cliffhanger, which never shows it). */
export function flClipKoFraction(plan: FlClipPlan, koSec: number, recordingSec: number): number | null {
  if (plan.cliffhanger || !(recordingSec > 0) || !(koSec >= 0)) return null;
  return koSec / recordingSec;
}

/** Whether a KO second lands in the plan's window (one match). */
export function flClipKoInWindow(plan: FlClipPlan, koSec: number): boolean {
  return !!plan.window && koSec >= plan.window.fromSec - 1e-6 && koSec <= plan.window.toSec + 1e-6;
}

/** The data attribute of a plan (`data-fl-clip-plan`): bucket|story|the KO window in % (or "show" / "cut"). */
export function flClipPlanAttr(plan: Pick<FlClipPlan, "bucket" | "story" | "kind" | "cliffhanger">): string {
  const window = plan.kind !== "single" ? "show" : plan.cliffhanger ? "cut" : `${Math.round(100 * FL_CLIP_KO_WINDOW.from)}-${Math.round(100 * FL_CLIP_KO_WINDOW.to)}`;
  return `${plan.bucket}|${plan.story}|${window}`;
}

/** The words of a clip (the Controls messages: flClipQuestion, flClipAnswer). */
export interface FlClipTexts {
  question: string;
  /** The answer with the winner's token: "[winner] wins!". */
  answer: string;
}

/**
 * The question captions of a clip: "Who wins?" at the top for its first 2.5 s, answered with "[winner] wins!" when the fight is
 * decided; a cliffhanger never answers and asks again for the clip's last seconds.
 */
export function flClipCaptions(plan: Pick<FlClipPlan, "cliffhanger" | "clipSec">, texts: FlClipTexts): Caption[] {
  const question = sanitizeCaptionText(texts.question, 80);
  const answer = plan.cliffhanger ? "" : sanitizeCaptionText(texts.answer, 40);
  const first: Caption = { ...defaultCaption("question", { text: question, answer }), position: "top", start: 0, end: FL_CLIP_QUESTION_SEC, animation: "pop" };
  if (!plan.cliffhanger) return [first];
  const start = Math.max(FL_CLIP_QUESTION_SEC + 0.5, Math.floor(2 * (plan.clipSec - FL_CLIP_CLOSING_SEC)) / 2);
  const closing: Caption = { ...defaultCaption("question", { text: question, answer: "" }), position: "top", start, end: 0, animation: "pop" };
  return [first, closing];
}

/** Whether a caption is one Make a clip added (a question with the clip's text): a new clip replaces them. */
export function isFlClipCaption(c: Pick<Caption, "type" | "text">, question: string): boolean {
  return c.type === "question" && c.text === sanitizeCaptionText(question, 80);
}

/** The Top Text templates (the Controls messages flClipTopDuel "{a} vs {b}", flClipTopBoss, flClipTopBracket). */
export interface FlClipTopTemplates {
  duel: (a: string, b: string) => string;
  boss: (boss: string, n: number) => string;
  bracket: (n: number) => string;
}

/** The names a Top Text needs: the two sides (a team's names joined by " + "), the boss, the count. */
export interface FlClipTopNames {
  a: string;
  b: string;
  boss: string;
  n: number;
}

/** The Top Text for viewers with the sound off: "Thor vs Loki", "Can Gerald beat all 6?", "8 fighters. 1 champion." (≤ 60 characters). */
export function flClipTopText(kind: FlShowKind, names: FlClipTopNames, t: FlClipTopTemplates): string {
  const text = kind === "boss" ? t.boss(names.boss, names.n) : kind === "bracket" ? t.bracket(names.n) : t.duel(names.a, names.b);
  return sanitizeCaptionText(text, 60);
}

/** The Top Text's names from a run's view: the sides of its first match (a team's members joined by " + "), the boss, the entrants. */
export function flClipNamesOf(view: Pick<FightLeagueView, "fighters" | "show" | "match">): FlClipTopNames {
  const side = (team: number) =>
    view.fighters
      .filter((f) => f.team === team)
      .map((f) => f.row.name)
      .join(" + ");
  const sh = view.show;
  if (sh.kind === "boss") return { a: "", b: "", boss: sh.entrants[0]?.row.name ?? view.fighters[0]?.row.name ?? "", n: sh.waves };
  if (sh.kind === "bracket") return { a: "", b: "", boss: "", n: sh.entrants.length };
  if (view.match === "ffa3" || view.match === "ffa4") {
    const all = view.fighters.map((f) => f.row.name);
    return { a: all.slice(0, -1).join(", "), b: all[all.length - 1] ?? "", boss: "", n: all.length };
  }
  return { a: side(0), b: side(1), boss: "", n: 2 };
}

/**
 * The winner a question's "[winner]" names once the run is over (the caption tracker reveals the answer at the finish): the
 * winning side's names, a bracket's champion, a boss rush's boss or the challenger who beat it; "" without a winner (a draw).
 */
export function flClipWinnerName(view: Pick<FightLeagueView, "finished" | "winnerTeam" | "doubleKo" | "fighters" | "show">): string {
  if (!view.finished || view.doubleKo) return "";
  const sh = view.show;
  if (sh.kind === "bracket" && sh.champion >= 0) return sh.entrants[sh.champion]?.row.name ?? "";
  if (view.winnerTeam < 0) return "";
  return view.fighters
    .filter((f) => f.team === view.winnerTeam)
    .map((f) => f.row.name)
    .join(" + ");
}

export { CAPTION_WINNER_TOKEN };
