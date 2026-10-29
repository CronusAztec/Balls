import type { EndingStyle, LengthBucket } from "@/lib/bot/playbook";
import type { GenePrivacy } from "./genes";
import {
  CHECK_BACK_P,
  CHECK_OLD,
  CHECK_POSTS,
  CLIFF_EVERY,
  DROP_GAP,
  DROP_GAP_Z,
  DROP_MIN_ATTEMPTS,
  NEWCOMER_TEST_EVERY,
  NORMAL_BEST_MIN,
  NORMAL_TEST_CLIPS,
  PAIR_GAP_H,
  PAIRS_PER_DAY_MAX,
  POST_WINDOWS,
  PRIOR_SD,
  REST_DAYS,
  REST_TWICE_DAYS,
  SCORE_AGE_H,
  SCORE_RULE,
  TEMPLATE_SHARE_MAX,
  TEST_EVERY,
  TRIAL_WINDOWS,
  TRIAL_WINDOW_MIN,
  USUAL_MIN_POSTS,
  USUAL_MIN_VIEWS,
  VARIETY_DAYS,
  VARIETY_MIN_POSTS,
  VARIETY_MIN_TEMPLATES,
  BLOCK_PAIRS,
} from "./learnerRules";
import { hashText, measureRows, normalCdf, platformFamily, scoreOf, seededDraws, usualOf, type InsightLane, type InsightRow, type MeasuredPoint, type PostExclusion, type PostMeasure } from "./stats";
import { DIALS, FORMAT_IDS, NEWCOMER_TEMPLATES, TEMPLATE_ID, TEST_ORDER, activeDials, challengersOf, isDialArm, isDialId, questionKey, type DialId } from "./dials";
import { BLOCK_DIALS_MAX, aFirst, armOf, armsOfPattern, assemblePairs, dialCall, labStatus, levelsOf, nextPatterns, patternsOf, readBlock, type LabReel, type Level } from "./lab";
import { armKey, armPossible, candidatesFor, isFeasible, isNewcomer, type ArmSetting, type FeasibilityResult, type LearnerTemplate } from "./feasibility";
import type { LearnerSettings } from "./learnerSettings";

/*
 * --- learner --- The learner core: it reads the post record (which channel got which post, in which lane, for which test), the
 * clips' rendered facts, the raw reads (lib/insights/stats.ts) and the decision log, and returns what it learned (message keys
 * with numbers, never text) and the next pass's plan (`learnPass`). It holds no model between passes: each dial's best is
 * today's default followed by the log's kept, went-back and undone entries.
 *
 * The normal lane makes one change at a time: every dial at its best and exactly one different on a test clip, 1 clip in 3
 * (1 in 5 for a newcomer or format test without Trial Reels), one test or check at a time, Instagram normal Reels and public
 * TikTok pooled, each clip scored against its own channels' usual (the mean of its channel posts). It looks once, after 8
 * scored test clips against at least 8 best clips of the same window: d = mean(test) - mean(best), SE^2 = the pooled variance
 * x (1/n_test + 1/n_best), shrunk with the prior sd PRIOR_SD (w = (1/SE^2) / (1/SE^2 + 1/PRIOR_SD^2), m = w d,
 * sd = sqrt(1 / (1/SE^2 + 1/PRIOR_SD^2))), kept when Phi(m/sd) >= KEEP_P and e^m >= KEEP_RATIO. A newcomer joins unless its
 * format's rotation beats it with KEEP_P and KEEP_RATIO. The trial lane runs the lab's blocks (lib/insights/lab.ts).
 *
 * After any kept change the combined check runs on the next CHECK_POSTS normal posts: CHECK_OLD keep the old combination
 * (every change of that test or block undone together), the rest the new one, in a seeded order; the old one ahead with
 * CHECK_BACK_P sends every change back together ("wentBack"), else they hold ("held"). A losing question rests REST_DAYS
 * (REST_TWICE_DAYS after two losses in a row); Undo locks it.
 *
 * Who sees what (lanes per channel): a trial arm goes only to its Instagram channel as a Trial Reel; a test clip or a check's
 * old clip only to the scored channels (Instagram normal Reels and TikTok) whose usual is ready; YouTube Shorts gets best
 * clips only, never long. Free (watermarked) clips, TikTok posts set to Only me, clips whose rendered facts left their arm
 * (offPlan), posts outside their test's window and Trial Reels shared before their read never count.
 *
 * Variety caps, always on: at most TEMPLATE_SHARE_MAX of a channel's posts in VARIETY_DAYS from one template, never one
 * template twice in a row on a channel, at least VARIETY_MIN_TEMPLATES templates when that many are ready, modes rotating by
 * date inside a format, and 1 best clip in CLIFF_EVERY a cliffhanger while the ending is untested.
 *
 * Pure and deterministic: no clock (the caller passes the date, `now` and the UTC offset at a moment), draws from
 * seededDraws(hashText(date|test|slot)) only, every input sorted before use but the decision log, which is replayed in the
 * order it was written, so the same inputs give the same PassPlan. With no numbers, without Pro, with learning off or paused,
 * learnPass returns null and today's code path runs unchanged. Imported by nothing until the plan's L2.
 */

// --- learner ---

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/* ------------------------------------------------------------------ the inputs */

/** A clip's role in a pass: the best settings, a normal-lane test or check clip, or one reel of a Trial Reel pair. */
export const SLOT_ROLES = ["best", "test", "check", "trialA", "trialB"] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

/** A post's test membership, written into the post record at approval (never into the clip's genes). */
export interface TestMembership {
  id: string;
  /** The dial arm (a normal test), "old" or "new" (a check), or a reel's levels ("011", a block). */
  arm: string;
  role: SlotRole;
  /** The pair of a Trial Reel. */
  pair?: number;
}

/** How a clip was rendered: free (watermarked), sealed, or sealed by a build in licence test mode. */
export type RenderWatermark = "free" | "sealed" | "sealedTest";

/** What was rendered decides whether a clip counts for its arm: its template, bucket, ending and watermark (its genes). */
export interface ClipFacts {
  template: string | null;
  bucket: LengthBucket | null;
  ending: EndingStyle | null;
  watermark: RenderWatermark | null;
}

/** One channel post the app made, from the audit's post record. */
export interface LearnerPost {
  postId: string;
  channelId: string;
  platform: string;
  lane: InsightLane;
  clipId: string;
  /** When it was approved (ISO). */
  approvedAt: string;
  test: TestMembership | null;
  facts: ClipFacts;
  /** TikTok's audience as the card chose it (genes.tiktokPrivacy); null elsewhere. */
  privacy: GenePrivacy | null;
  /** "I shared it already" on a Trial Reel (ISO), when the person tapped it. */
  sharedAt?: string | null;
}

/** A channel the autopilot posts to, and whether it may post Trial Reels (Instagram, Postiz 2.18 or newer, the pilot passed). */
export interface LearnerChannel {
  id: string;
  platform: string;
  trialReels: boolean;
}

/** The verdicts a test can end with, written once to the decision log. */
export const VERDICTS = ["kept", "notKept", "noClearDifference", "notEnoughPairs", "rarelyPasses", "wentBack", "undone", "held"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One verdict of the decision log: one question of a test (a block writes one per dial). */
export interface LearnerDecision {
  testId: string;
  lane: InsightLane;
  dial: DialId;
  best: string;
  challenger: string;
  /** A newcomer's template. */
  subject: string | null;
  decidedAt: string;
  verdict: Verdict;
  /** The shrunken ratio of the challenger to the best (a check: of the new combination to the old). */
  ratio: number | null;
  /** P(the challenger is better). */
  p: number | null;
  nTest: number;
  nBest: number;
  scoreRule: number;
}

/** The crew's attempts per arm of a test: how many clips were judged, how many passed (lib/insights/drops.ts, L2). */
export interface ArmAttempts {
  testId: string;
  arm: string;
  tries: number;
  passed: number;
}

export interface LearnerInput {
  /** Today, "YYYY-MM-DD" (local). */
  date: string;
  /** The moment the pass runs (ms). */
  now: number;
  /**
   * The PC's offset from UTC at a moment (minutes east), for local days and post-time windows: each post is read at its own
   * moment's offset, so a summer post stays in its window after the clocks change (as C11's AutonomyContext.offsetMinAt). UTC
   * when absent.
   */
  offsetMinAt?: (at: number) => number;
  pro: boolean;
  settings: LearnerSettings;
  rows: readonly InsightRow[];
  posts: readonly LearnerPost[];
  /** The decision log in the order it was written, oldest first (the store appends): replayed as given, never by its times. */
  decisions: readonly LearnerDecision[];
  channels: readonly LearnerChannel[];
  /** The ready templates (lib/insights/feasibility.ts learnerCatalog). */
  catalog: readonly LearnerTemplate[];
  /** Normal clips a day (the autopilot's posts a day). */
  perDay: number;
  /** Quiet hours, "HH:MM" each; equal: none. */
  quiet?: { from: string; to: string };
  /** The arms planned so far (lib/insights/feasibility.ts checkArms). */
  feasibility?: readonly FeasibilityResult[];
  attempts?: readonly ArmAttempts[];
  /** A channel's usual restarts at this time (ISO): a metric break, a Postiz change, the owner's "something changed". */
  since?: Readonly<Record<string, string>>;
  /** The L3 dials on (lib/insights/dials.ts L3_DIALS_ON). */
  l3?: boolean;
}

/* ------------------------------------------------------------------ questions and test ids */

/** One question: a dial's best against one challenger (a newcomer: its format's rotation against the template). */
export interface Question {
  dial: DialId;
  best: string;
  challenger: string;
  subject: string | null;
}

export type TestKind = "normal" | "block" | "check";
export interface ParsedTest {
  id: string;
  kind: TestKind;
  seq: number;
  questions: Question[];
  /** A check's test. */
  source?: ParsedTest;
}

export const TEST_ID_MAX = 240;
const questionText = (q: Question) => [q.dial, q.best, q.challenger, ...(q.subject ? [q.subject] : [])].join(".");

function parseQuestion(text: string): Question | null {
  const parts = text.split(".");
  if (parts.length < 3 || parts.length > 4) return null;
  const [dial, best, challenger, subject] = parts;
  if (!isDialId(dial) || !isDialArm(dial, best) || !isDialArm(dial, challenger) || best === challenger) return null;
  if (dial === "newcomer") return best === "rotation" && challenger === "newcomer" && subject && TEMPLATE_ID.test(subject) ? { dial, best, challenger, subject } : null;
  return subject === undefined ? { dial, best, challenger, subject: null } : null;
}

/** The id of a normal-lane test, a block or a check: its kind, its place in its lane and its questions, so it parses back. */
export function testIdOf(kind: TestKind, seq: number, questions: readonly Question[], sourceId?: string): string {
  if (kind === "check") return `c${seq}.${sourceId}`;
  return `${kind === "normal" ? "n" : "t"}${seq}.${questions.map(questionText).join("~")}`;
}

/** A test id parsed back (null: not one the learner writes). */
export function parseTestId(id: unknown): ParsedTest | null {
  if (typeof id !== "string" || id.length > TEST_ID_MAX) return null;
  const m = /^([ntc])(\d{1,6})\.(.+)$/.exec(id);
  if (!m) return null;
  const seq = Number(m[2]);
  if (m[1] === "c") {
    const source = parseTestId(m[3]);
    return source && source.kind !== "check" ? { id, kind: "check", seq, questions: source.questions, source } : null;
  }
  const questions = m[3].split("~").map(parseQuestion);
  if (!questions.length || questions.some((q) => !q) || questions.length > BLOCK_DIALS_MAX) return null;
  const qs = questions as Question[];
  if (new Set(qs.map((q) => q.dial)).size !== qs.length) return null;
  if (m[1] === "n" && qs.length !== 1) return null;
  return { id, kind: m[1] === "n" ? "normal" : "block", seq, questions: qs };
}

const keyOf = (q: Pick<Question, "dial" | "best" | "challenger" | "subject">) => questionKey(q.dial, q.best, q.challenger, q.subject);

/* ------------------------------------------------------------------ small helpers */

const parseIso = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** The day index of "YYYY-MM-DD" (days since 1970-01-01). */
export function dayOfDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a date (YYYY-MM-DD): ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** The PC's offset from UTC at a moment (minutes east), DST included. */
export type OffsetAt = (at: number) => number;
/** UTC: no offset at any moment. */
export const UTC: OffsetAt = () => 0;
/** The local day index of a moment (ms), at that moment's own UTC offset. */
export const localDay = (ms: number, offsetMinAt: OffsetAt) => Math.floor((ms + offsetMinAt(ms) * 60_000) / DAY_MS);
/** The local minute of the day of a moment, at that moment's own UTC offset. */
const localMinute = (ms: number, offsetMinAt: OffsetAt) => Math.floor((((ms + offsetMinAt(ms) * 60_000) % DAY_MS) + DAY_MS) % DAY_MS / 60_000);
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** "YYYY-MM-DD" of a day index. */
const dateOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function inQuiet(minute: number, quiet: { from: string; to: string } | undefined): boolean {
  if (!quiet || !/^\d{2}:\d{2}$/.test(quiet.from) || !/^\d{2}:\d{2}$/.test(quiet.to)) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The shrunken difference of two groups of scores (see the header): mean(a) - mean(b) over the pooled standard error, shrunk
 * toward no difference with the prior sd PRIOR_SD. Returns the posterior mean and sd of the log ratio of a to b.
 */
export function shrunkDifference(a: readonly number[], b: readonly number[]): { m: number; sd: number } {
  const d = mean(a) - mean(b);
  const s2 = Math.max(((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / Math.max(1, a.length + b.length - 2), 1e-6);
  const se2 = s2 * (1 / a.length + 1 / b.length);
  const prec = 1 / se2 + 1 / PRIOR_SD ** 2;
  return { m: ((1 / se2) / prec) * d, sd: Math.sqrt(1 / prec) };
}

/**
 * The crew-drop rule: an arm that passes the crew's checks DROP_GAP less often than the other, after DROP_MIN_ATTEMPTS
 * attempts each, by at least DROP_GAP_Z standard errors (learnerRules.ts: the plan's words alone closed 39 % of fair tests).
 */
export function rarelyPasses(challenger: { tries: number; passed: number }, best: { tries: number; passed: number }): boolean {
  if (challenger.tries < DROP_MIN_ATTEMPTS || best.tries < DROP_MIN_ATTEMPTS) return false;
  const rc = challenger.passed / challenger.tries;
  const rb = best.passed / best.tries;
  const gap = rb - rc;
  const pool = (challenger.passed + best.passed) / (challenger.tries + best.tries);
  const se = Math.sqrt(Math.max(pool * (1 - pool), 1e-9) * (1 / challenger.tries + 1 / best.tries));
  return gap >= DROP_GAP && gap / se >= DROP_GAP_Z;
}

/* ------------------------------------------------------------------ the decision log */

/*
 * The log is replayed in the order it was written (the store appends, oldest first), never sorted by decidedAt: the PC's clock
 * can go back, and a "wentBack" or "undone" written after it did must still reverse the "kept" before it.
 */

/**
 * The time a new verdict is stamped with: the pass's `now`, but never before the newest verdict already in the log, so the
 * log's times only go forward even after the PC's clock went back, and a reader that compares them (C11's pause on a change
 * sent back) sees a new verdict as new. The store's Undo (the plan's C4) stamps its entries the same way.
 */
export function decisionTime(log: readonly Pick<LearnerDecision, "decidedAt">[], now: number): number {
  let t = now;
  for (const e of log) {
    const at = parseIso(e.decidedAt);
    if (at !== null && at > t) t = at;
  }
  return t;
}

/** Each dial's best and the newcomers that joined their rotation: today's defaults, then the log, then the owner's locks. */
export interface Bests {
  arms: Record<DialId, string>;
  joined: Set<string>;
}

export function bestsOf(log: readonly LearnerDecision[], settings: Pick<LearnerSettings, "fixed">, catalog: readonly LearnerTemplate[] = []): Bests {
  const arms = Object.fromEntries(Object.values(DIALS).map((d) => [d.id, d.defaultArm])) as Record<DialId, string>;
  const joined = new Set<string>();
  for (const e of log) {
    if (e.dial === "newcomer") {
      if (!e.subject) continue;
      if (e.verdict === "kept") joined.add(e.subject);
      else if (e.verdict === "wentBack" || e.verdict === "undone") joined.delete(e.subject);
      continue;
    }
    if (e.verdict === "kept" && isDialArm(e.dial, e.challenger)) arms[e.dial] = e.challenger;
    else if ((e.verdict === "wentBack" || e.verdict === "undone") && arms[e.dial] === e.challenger && isDialArm(e.dial, e.best)) arms[e.dial] = e.best;
  }
  for (const dial of Object.keys(settings.fixed) as DialId[]) {
    const arm = settings.fixed[dial];
    if (isDialId(dial) && isDialArm(dial, arm)) arms[dial] = arm;
  }
  // a format with nothing ready to play goes back to today's mix
  if (arms.format !== "mix" && catalog.length && !catalog.some((t) => t.format === arms.format)) arms.format = "mix";
  return { arms, joined };
}

const LOSSES: readonly Verdict[] = ["notKept", "rarelyPasses", "wentBack"];

/** Until when (ms) a question rests: never asked (0), after a verdict (REST_DAYS, or REST_TWICE_DAYS after two losses), Undo forever. */
export function restsUntil(q: Pick<Question, "dial" | "best" | "challenger" | "subject">, log: readonly LearnerDecision[]): number {
  const key = keyOf(q);
  const entries = log.filter((e) => keyOf(e) === key);
  const last = entries[entries.length - 1];
  if (!last) return 0;
  const at = parseIso(last.decidedAt) ?? 0;
  const prev = entries[entries.length - 2];
  if (last.verdict === "undone") return Number.POSITIVE_INFINITY;
  // the lab asks a question with no clear answer once more at once (block 2's length), then it rests
  if (last.verdict === "noClearDifference" && last.lane === "trialReel" && prev?.verdict !== "noClearDifference") return 0;
  if (LOSSES.includes(last.verdict) && prev && LOSSES.includes(prev.verdict)) return at + REST_TWICE_DAYS * DAY_MS;
  return at + REST_DAYS * DAY_MS;
}

/* ------------------------------------------------------------------ the settings of an arm */

/** The best settings as an arm setting (the ending's best arm; the mix of endings is a slot's, not an arm's). */
export function bestSetting(bests: Bests): ArmSetting {
  return { format: bests.arms.format, newcomer: null, bucket: bests.arms.length as LengthBucket, ending: bests.arms.ending as EndingStyle };
}

/** The setting of a clip whose questions sit at these levels (0: the best, 1: the challenger), over `base`. */
export function settingOf(base: ArmSetting, questions: readonly Question[], levels: readonly Level[], catalog: readonly LearnerTemplate[]): ArmSetting {
  const s: ArmSetting = { ...base, newcomer: base.newcomer ? { ...base.newcomer } : null };
  questions.forEach((q, j) => {
    const arm = levels[j] === 1 ? q.challenger : q.best;
    if (q.dial === "length") s.bucket = arm as LengthBucket;
    else if (q.dial === "ending") s.ending = arm as EndingStyle;
    else if (q.dial === "format") s.format = arm;
    else if (q.dial === "newcomer" && q.subject) {
      s.format = catalog.find((t) => t.id === q.subject)?.format ?? s.format;
      s.newcomer = { subject: q.subject, arm: arm as "rotation" | "newcomer" };
    }
  });
  return s;
}

/* ------------------------------------------------------------------ the day's windows */

export type PostWindow = keyof typeof POST_WINDOWS;
const POST_WINDOW_NAMES: readonly PostWindow[] = ["noon", "evening", "night"];

/** A seeded shuffle of a list (Fisher-Yates, from the last place down). */
function shuffled<T>(list: readonly T[], draw: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(draw() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The day's order of the post-time windows a "spread" clip takes (the slot at place j takes the (j mod n)th), from the date
 * alone, never from a slot's role: test and best clips, and a post-time test's challenger and its "spread" best, meet every
 * window as often (an order fixed by place put the day's one test clip in the same window every day, so post time leaked into
 * every verdict). Its first window walks every window once in each run of n days, in a seeded order per run, so one clip a
 * day still goes out at noon, evening and night by date; the day's other windows follow in a seeded order per date. Windows
 * that start in quiet hours are left out.
 */
export function spreadWindows(day: number, quiet: LearnerInput["quiet"]): PostWindow[] {
  const open = POST_WINDOW_NAMES.filter((n) => !inQuiet(minutesOf(POST_WINDOWS[n][0]), quiet));
  const list = open.length ? open : POST_WINDOW_NAMES;
  const n = list.length;
  const run = Math.floor(day / n);
  const first = shuffled(list, seededDraws(hashText(`spread|${list.join(",")}|${run}`)))[day - run * n];
  return [first, ...shuffled(list.filter((w) => w !== first), seededDraws(hashText(`spread|${list.join(",")}|day|${day}`)))];
}

/** The local window of a slot: a post-time arm's own, else ("spread") the day's order at the slot's place. */
function windowOf(arm: string, place: number, spread: readonly PostWindow[]): { from: string; to: string } {
  const name = arm === "noon" || arm === "evening" || arm === "night" ? arm : spread[place % spread.length];
  return { from: POST_WINDOWS[name][0], to: POST_WINDOWS[name][1] };
}

/**
 * The day's Trial Reel windows, pair by pair: the TRIAL_WINDOWS that start outside quiet hours, two by two in time order, the
 * two of a pair at least PAIR_GAP_H apart. Quiet hours over a window move its pair on to the next free ones, and a pair that
 * does not fit is not made that day: a reel planned in quiet hours could never go out (C11 refuses it as "missed its time"),
 * and its pair would break every day.
 */
export function trialPairWindows(quiet: LearnerInput["quiet"]): { from: string; to: string }[][] {
  const open = TRIAL_WINDOWS.filter((w) => !inQuiet(minutesOf(w), quiet)).map(minutesOf);
  const window = (from: number) => ({ from: hhmm(from), to: hhmm(from + TRIAL_WINDOW_MIN) });
  const pairs: { from: string; to: string }[][] = [];
  for (let i = 0; i + 1 < open.length && pairs.length < PAIRS_PER_DAY_MAX; ) {
    if (open[i + 1] - open[i] >= PAIR_GAP_H * 60) {
      pairs.push([window(open[i]), window(open[i + 1])]);
      i += 2;
    } else i += 1;
  }
  return pairs;
}

/* ------------------------------------------------------------------ lanes per channel */

/** A channel's scored family: Instagram normal Reels and TikTok are scored; YouTube is shown only. */
const scoredFamily = (platform: string) => {
  const f = platformFamily(platform);
  return f === "instagram" || f === "tiktok";
};

/**
 * The channels a slot's clip goes to, each with its lane. A trial reel: only its Instagram channel, as a Trial Reel. A test
 * clip or a check's old clip: only the scored channels whose usual is ready. A best clip or a check's new clip: every channel
 * that takes its bucket (never long on YouTube Shorts), as a normal post.
 */
export function channelsFor(role: SlotRole, arm: string | null, bucket: LengthBucket, channels: readonly LearnerChannel[], ctx: { trialChannel: string | null; usualReady: ReadonlySet<string> }): { id: string; lane: InsightLane }[] {
  if (role === "trialA" || role === "trialB") return ctx.trialChannel ? [{ id: ctx.trialChannel, lane: "trialReel" }] : [];
  const sorted = [...channels].sort((a, b) => byString(a.id, b.id));
  if (role === "test" || (role === "check" && arm === "old")) return sorted.filter((c) => scoredFamily(c.platform) && ctx.usualReady.has(c.id)).map((c) => ({ id: c.id, lane: "normal" as const }));
  return sorted.filter((c) => !(platformFamily(c.platform) === "youtube" && bucket === "long")).map((c) => ({ id: c.id, lane: "normal" as const }));
}

/* ------------------------------------------------------------------ whether a post counts */

/** Whether a post's rendered facts match its question at a level (what was rendered decides). */
function factsMatch(q: Question, level: Level, post: LearnerPost, catalog: readonly LearnerTemplate[], publishedAt: number | null, offsetMinAt: OffsetAt): boolean {
  const arm = level === 1 ? q.challenger : q.best;
  const f = post.facts;
  const template = f.template ? catalog.find((t) => t.id === f.template) : undefined;
  switch (q.dial) {
    case "length":
      return f.bucket === arm;
    case "ending":
      return f.ending === arm;
    case "format":
      return !!template && (arm === "mix" || template.format === arm);
    case "newcomer": {
      const subject = catalog.find((t) => t.id === q.subject);
      if (!template || !subject) return false;
      return arm === "newcomer" ? template.id === subject.id : template.format === subject.format && template.id !== subject.id;
    }
    case "postTime": {
      if (arm === "spread") return true;
      if (publishedAt === null) return false;
      const w = POST_WINDOWS[arm as keyof typeof POST_WINDOWS];
      const minute = localMinute(publishedAt, offsetMinAt);
      return !!w && minute >= minutesOf(w[0]) && minute <= minutesOf(w[1]);
    }
    default:
      return true; // the L3 dials' facts arrive with their genes (the plan's C8)
  }
}

/** The outcome of one channel post for a test: scored, measured (views only: no usual yet), pending, or left out. */
export type PostOutcome = { kind: "scored"; score: number; views72: number } | { kind: "measured"; views72: number } | { kind: "pending" } | { kind: "excluded"; why: PostExclusion };

/**
 * Whether one channel post counts for its test, and its score: the numbers' own state (stats.ts), then the learner's
 * exclusions: TikTok Only me or an unknown audience, a render that is not sealed, a Trial Reel shared before its 72-hour read,
 * a post published before its test opened, and facts that left the arm (`levels` of `questions`).
 */
export function postOutcome(post: LearnerPost, measure: PostMeasure | undefined, ctx: { questions: readonly Question[]; levels: readonly Level[]; openedAt: number; catalog: readonly LearnerTemplate[]; offsetMinAt: OffsetAt }): PostOutcome {
  if (platformFamily(post.platform) === "tiktok" && post.privacy !== "public") return { kind: "excluded", why: post.privacy === "self" ? "self" : "privacyUnknown" };
  if (post.facts.watermark !== "sealed") return { kind: "excluded", why: "free" };
  if (!measure) return { kind: "pending" };
  if (measure.state === "excluded") return { kind: "excluded", why: measure.why };
  const shared = parseIso(post.sharedAt);
  if (shared !== null && (measure.publishedAt === null || shared < measure.publishedAt + SCORE_AGE_H * HOUR_MS)) return { kind: "excluded", why: "shared" };
  if (measure.publishedAt !== null && measure.publishedAt < ctx.openedAt) return { kind: "excluded", why: "outOfWindow" };
  if (!ctx.questions.every((q, j) => factsMatch(q, ctx.levels[j], post, ctx.catalog, measure.publishedAt, ctx.offsetMinAt))) return { kind: "excluded", why: "offPlan" };
  if (measure.state === "pending") return { kind: "pending" };
  if (measure.state === "unscored") return { kind: "measured", views72: measure.views72 };
  return { kind: "scored", score: measure.score, views72: measure.views72 };
}

/** One clip of a normal-lane test or check: its role and arm, its score (the mean of its counted channel posts) and when it went out. */
export interface ClipOutcome {
  clipId: string;
  role: SlotRole;
  arm: string;
  state: "scored" | "pending" | "excluded";
  score: number | null;
  publishedAt: number | null;
  why?: PostExclusion;
}

/**
 * A clip's score in the normal lane: the mean of its scored channel posts; pending while one of them is; left out when none
 * counts (a measured post without a usual counts as left out: "noUsual").
 */
export function clipScore(clipId: string, outcomes: readonly { outcome: PostOutcome; publishedAt: number | null }[], role: SlotRole, arm: string): ClipOutcome {
  const scored = outcomes.filter((o) => o.outcome.kind === "scored").map((o) => (o.outcome as { score: number }).score);
  const published = outcomes.map((o) => o.publishedAt).filter((t): t is number => t !== null);
  const at = published.length ? Math.min(...published) : null;
  if (outcomes.some((o) => o.outcome.kind === "pending")) return { clipId, role, arm, state: "pending", score: null, publishedAt: at };
  if (!scored.length) {
    const first = outcomes.find((o) => o.outcome.kind === "excluded")?.outcome as { why: PostExclusion } | undefined;
    return { clipId, role, arm, state: "excluded", score: null, publishedAt: at, why: first?.why ?? "noUsual" };
  }
  return { clipId, role, arm, state: "scored", score: mean(scored), publishedAt: at };
}

/* ------------------------------------------------------------------ deciding */

/** The verdict a normal test, or one dial of a block, reaches from its call (a newcomer joins unless clearly beaten). */
function verdictOf(q: Question, call: { keep: boolean; bestBetter: boolean; bestClearlyBetter: boolean }): Verdict {
  if (q.dial === "newcomer") return call.bestClearlyBetter ? "notKept" : "kept";
  return call.keep ? "kept" : call.bestBetter ? "notKept" : "noClearDifference";
}

/** What a normal-lane test or check reads now. */
export interface NormalRead {
  clips: ClipOutcome[];
  nTest: number;
  nBest: number;
  pending: number;
  verdicts: LearnerDecision[];
}

const decision = (testId: string, lane: InsightLane, q: Question, verdict: Verdict, now: number, nums: { ratio: number | null; p: number | null; nTest: number; nBest: number }): LearnerDecision => ({
  testId,
  lane,
  dial: q.dial,
  best: q.best,
  challenger: q.challenger,
  subject: q.subject,
  decidedAt: new Date(now).toISOString(),
  verdict,
  ratio: nums.ratio === null ? null : round(nums.ratio, 3),
  p: nums.p === null ? null : round(nums.p, 3),
  nTest: nums.nTest,
  nBest: nums.nBest,
  scoreRule: SCORE_RULE,
});

/** The clips of a normal-lane test or check, each scored from its channel posts. */
function normalClips(test: ParsedTest, posts: readonly LearnerPost[], measures: ReadonlyMap<string, PostMeasure>, catalog: readonly LearnerTemplate[], offsetMinAt: OffsetAt): ClipOutcome[] {
  const mine = posts.filter((p) => p.test?.id === test.id && p.lane === "normal");
  if (!mine.length) return [];
  const openedAt = Math.min(...mine.map((p) => parseIso(p.approvedAt) ?? Number.POSITIVE_INFINITY));
  const byClip = new Map<string, LearnerPost[]>();
  for (const p of mine) byClip.set(p.clipId, [...(byClip.get(p.clipId) ?? []), p]);
  const out: ClipOutcome[] = [];
  for (const clipId of [...byClip.keys()].sort(byString)) {
    const list = byClip.get(clipId)!;
    const t = list[0].test!;
    const levels: Level[] = test.kind === "check" ? test.questions.map(() => (t.arm === "old" ? 0 : 1)) : test.questions.map((q) => (t.arm === q.challenger ? 1 : 0));
    const outcomes = list.filter((p) => scoredFamily(p.platform)).map((p) => {
      const m = measures.get(`${p.postId}|${p.channelId}`);
      return { outcome: postOutcome(p, m, { questions: test.questions, levels, openedAt, catalog, offsetMinAt }), publishedAt: m?.publishedAt ?? null };
    });
    if (!outcomes.length) continue;
    out.push(clipScore(clipId, outcomes, t.role, t.arm));
  }
  return out;
}

/** A normal-lane test at `now`: its clips, and its verdict once 8 test clips and at least 8 best clips are scored. */
export function readNormalTest(test: ParsedTest, posts: readonly LearnerPost[], measures: ReadonlyMap<string, PostMeasure>, catalog: readonly LearnerTemplate[], now: number, offsetMinAt: OffsetAt = UTC): NormalRead {
  const q = test.questions[0];
  const clips = normalClips(test, posts, measures, catalog, offsetMinAt);
  const tests = clips.filter((c) => c.role === "test" && c.state === "scored").sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0) || byString(a.clipId, b.clipId));
  const best = clips.filter((c) => c.role === "best" && c.state === "scored");
  const pending = clips.filter((c) => c.role === "test" && c.state === "pending").length;
  const read: NormalRead = { clips, nTest: tests.length, nBest: best.length, pending, verdicts: [] };
  if (tests.length < NORMAL_TEST_CLIPS || best.length < NORMAL_BEST_MIN) return read;
  const used = tests.slice(0, NORMAL_TEST_CLIPS);
  const { m, sd } = shrunkDifference(
    used.map((c) => c.score!),
    best.map((c) => c.score!),
  );
  const call = dialCall(m, sd);
  read.verdicts = [decision(test.id, "normal", q, verdictOf(q, call), now, { ratio: call.ratio, p: call.p, nTest: used.length, nBest: best.length })];
  return read;
}

/** A check at `now`: its old and new clips, and once CHECK_OLD old and the rest new are scored, wentBack or held for each change. */
export function readCheck(check: ParsedTest, kept: readonly Question[], posts: readonly LearnerPost[], measures: ReadonlyMap<string, PostMeasure>, catalog: readonly LearnerTemplate[], now: number, offsetMinAt: OffsetAt = UTC): NormalRead {
  const clips = normalClips({ ...check, questions: kept as Question[] }, posts, measures, catalog, offsetMinAt);
  const old = clips.filter((c) => c.arm === "old" && c.state === "scored").map((c) => c.score!);
  const fresh = clips.filter((c) => c.arm === "new" && c.state === "scored").map((c) => c.score!);
  const read: NormalRead = { clips, nTest: fresh.length, nBest: old.length, pending: clips.filter((c) => c.state === "pending").length, verdicts: [] };
  if (old.length < CHECK_OLD || fresh.length < CHECK_POSTS - CHECK_OLD) return read;
  const { m, sd } = shrunkDifference(old, fresh);
  const pOld = normalCdf(m / sd);
  const verdict: Verdict = pOld >= CHECK_BACK_P ? "wentBack" : "held";
  read.verdicts = kept.map((q) => decision(check.id, "normal", q, verdict, now, { ratio: Math.exp(-m), p: 1 - pOld, nTest: fresh.length, nBest: old.length }));
  return read;
}

/** What a block reads now. */
export interface BlockRead {
  clean: number;
  pending: number;
  broken: number;
  openedDay: number;
  verdicts: LearnerDecision[];
  /**
   * Each pair's pattern and state, for the next pairs' patterns, and whether its numbers came: true when a reel had a view at
   * 72 h, false when both reels had none or no answer at their 3-day read, null while that is not known.
   */
  pairs: { pair: number; pattern: number; state: "clean" | "pending" | "broken"; a: Level[] | null; numbers: boolean | null }[];
}

/**
 * Whether a reel's numbers came: at least one view at 72 h (true), none or no answer at its 3-day read (false; reads of 0
 * projected to 72 h stay under one view), not known yet (null).
 */
function numbersOf(o: PostOutcome): boolean | null {
  if (o.kind === "scored" || o.kind === "measured") return o.views72 >= 1;
  return o.kind === "excluded" && (o.why === "noAnswer" || o.why === "notMeasured") ? false : null;
}

/**
 * A Trial Reel block at `now`: its reels paired, each pair's difference s_B - s_A (the reels' scores against the trial usual
 * when both have one, else against the pair's own geometric mean: the difference needs no usual), its verdicts once 8 pairs are
 * clean, or "not enough clean pairs" after BLOCK_MAX_DAYS. Without a trial usual a pair is its own scale, so one whose larger
 * reel has fewer than USUAL_MIN_VIEWS views (the floor a usual needs) has nothing to compare: it is broken and made again,
 * never a clean difference of 0 (all zeros, should Postiz send zeros for Trial Reels). `attempts` closes a dial whose
 * challenger rarely passes the crew.
 */
export function readBlockTest(block: ParsedTest, posts: readonly LearnerPost[], measures: ReadonlyMap<string, PostMeasure>, catalog: readonly LearnerTemplate[], now: number, offsetMinAt: OffsetAt = UTC, attempts: readonly ArmAttempts[] = []): BlockRead {
  const k = block.questions.length;
  const mine = posts.filter((p) => p.test?.id === block.id && p.lane === "trialReel" && (p.test.role === "trialA" || p.test.role === "trialB") && typeof p.test.pair === "number");
  const today = localDay(now, offsetMinAt);
  const openedAt = mine.length ? Math.min(...mine.map((p) => parseIso(p.approvedAt) ?? Number.POSITIVE_INFINITY)) : now;
  const openedDay = localDay(openedAt, offsetMinAt);
  const reels: { pair: number; role: "trialA" | "trialB"; levels: Level[]; day: number; outcome: PostOutcome }[] = [];
  for (const p of [...mine].sort((a, b) => byString(a.postId, b.postId))) {
    const levels = levelsOf(p.test!.arm, k);
    const day = localDay(parseIso(p.approvedAt) ?? now, offsetMinAt);
    if (!levels) {
      reels.push({ pair: p.test!.pair!, role: p.test!.role as "trialA" | "trialB", levels: new Array(k).fill(0), day, outcome: { kind: "excluded", why: "offPlan" } });
      continue;
    }
    reels.push({ pair: p.test!.pair!, role: p.test!.role as "trialA" | "trialB", levels, day, outcome: postOutcome(p, measures.get(`${p.postId}|${p.channelId}`), { questions: block.questions, levels, openedAt, catalog, offsetMinAt }) });
  }
  const labReels: LabReel[] = [];
  const byPair = new Map<number, typeof reels>();
  for (const r of reels) byPair.set(r.pair, [...(byPair.get(r.pair) ?? []), r]);
  for (const [pair, list] of byPair) {
    const both = list.length === 2 && list.every((r) => r.outcome.kind === "scored" || r.outcome.kind === "measured");
    const usual = both && list.every((r) => r.outcome.kind === "scored");
    const views = both ? list.map((r) => (r.outcome as { views72: number }).views72) : [];
    const geo = both ? Math.sqrt((views[0] + 1) * (views[1] + 1)) - 1 : 0;
    const empty = both && !usual && Math.max(...views) < USUAL_MIN_VIEWS;
    list.forEach((r, i) => {
      const o = r.outcome;
      const outcome: LabReel["outcome"] = o.kind === "excluded" || empty ? { kind: "broken" } : !both ? { kind: "pending" } : { kind: "scored", score: usual ? (o as { score: number }).score : scoreOf(views[i], geo) };
      labReels.push({ pair, role: r.role, levels: r.levels, day: r.day, outcome });
    });
  }
  const pairs = assemblePairs(labReels, k, today);
  const status = labStatus(pairs, openedDay, today);
  const numbers = (pair: number) => {
    const known = (byPair.get(pair) ?? []).map((r) => numbersOf(r.outcome));
    return known.some((n) => n === true) ? true : known.length === 2 && known.every((n) => n === false) ? false : null;
  };
  const read: BlockRead = { clean: status.clean, pending: status.pending, broken: status.broken, openedDay, verdicts: [], pairs: pairs.map((p) => ({ pair: p.pair, pattern: p.pattern, state: p.state, a: p.a, numbers: numbers(p.pair) })) };
  // the crew-drop rule, dial by dial: the challenger's level against the best's, over the block's arms
  const dropped = block.questions.map((_, j) => {
    const sum = (level: Level) => attempts.filter((a) => a.testId === block.id && levelsOf(a.arm, k)?.[j] === level).reduce((s, a) => ({ tries: s.tries + a.tries, passed: s.passed + a.passed }), { tries: 0, passed: 0 });
    return rarelyPasses(sum(1), sum(0));
  });
  if (dropped.some(Boolean)) {
    read.verdicts = block.questions.flatMap((q, j) => (dropped[j] ? [decision(block.id, "trialReel", q, "rarelyPasses", now, { ratio: null, p: null, nTest: status.clean, nBest: status.clean })] : []));
    return read;
  }
  if (status.ready) {
    const { calls } = readBlock(pairs, k);
    read.verdicts = block.questions.map((q, j) => decision(block.id, "trialReel", q, verdictOf(q, calls[j]), now, { ratio: calls[j].ratio, p: calls[j].p, nTest: BLOCK_PAIRS, nBest: BLOCK_PAIRS }));
  } else if (status.expired) {
    read.verdicts = block.questions.map((q) => decision(block.id, "trialReel", q, "notEnoughPairs", now, { ratio: null, p: null, nTest: status.clean, nBest: status.clean }));
  }
  return read;
}

/* ------------------------------------------------------------------ choosing the next test */

/** The format challengers' order: by the mean pick score of each format's ready templates, best first, then FORMAT_IDS order. */
export function formatOrder(catalog: readonly LearnerTemplate[], feasibility: readonly FeasibilityResult[] = []): string[] {
  const score = (f: string) => {
    const picks = catalog.filter((t) => t.format === f).map((t) => t.pickScore).filter((x): x is number => typeof x === "number");
    const fromChecks = feasibility.filter((r) => r.key.startsWith(`${f}|-|`) && r.pick !== null).map((r) => r.pick as number);
    const all = [...picks, ...fromChecks];
    return all.length ? mean(all) : Number.NEGATIVE_INFINITY;
  };
  return [...FORMAT_IDS].filter((f) => catalog.some((t) => t.format === f)).sort((a, b) => score(b) - score(a) || FORMAT_IDS.indexOf(a as (typeof FORMAT_IDS)[number]) - FORMAT_IDS.indexOf(b as (typeof FORMAT_IDS)[number]));
}

/** The questions of a dial, in the order they are asked, that are not resting, skipped or locked. */
function questionsOf(dial: DialId, bests: Bests, ctx: { catalog: readonly LearnerTemplate[]; log: readonly LearnerDecision[]; now: number; skipped: ReadonlySet<string>; formats: readonly string[] }): Question[] {
  let qs: Question[];
  if (dial === "newcomer") {
    const listed = ctx.catalog.filter(isNewcomer).filter((t) => !bests.joined.has(t.id));
    const order = (id: string) => {
      const i = (NEWCOMER_TEMPLATES as readonly string[]).indexOf(id);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    };
    qs = listed.sort((a, b) => order(a.id) - order(b.id) || byString(a.id, b.id)).map((t) => ({ dial, best: "rotation", challenger: "newcomer", subject: t.id }));
  } else {
    qs = challengersOf(dial, bests.arms[dial], dial === "format" ? ctx.formats : undefined).map((c) => ({ dial, best: bests.arms[dial], challenger: c, subject: null }));
  }
  return qs.filter((q) => !ctx.skipped.has(keyOf(q)) && restsUntil(q, ctx.log) <= ctx.now);
}

/** Every combination of a block's (or test's) levels its pairs (or clips) use: each pattern's arm A and arm B. */
export function levelCombos(k: number): Level[][] {
  return patternsOf(k).flatMap((_, i) => {
    const { a, b } = armsOfPattern(k, i);
    return [a, b];
  });
}

interface Chosen {
  questions: Question[];
  needed: ArmSetting[];
}

/**
 * Picks the questions of the next test (`max` 1) or block (`max` up to 3) from `order`: the first question of each dial in
 * turn whose every arm is possible on paper and planned feasible; a dial that cannot share the block (the newcomer and the
 * format both choose the template), or whose arms fail their plans, is swapped for the next. Arms not planned yet are
 * returned as `needed`, and nothing opens until they are.
 */
function chooseQuestions(order: readonly DialId[], max: number, bests: Bests, ctx: { catalog: readonly LearnerTemplate[]; log: readonly LearnerDecision[]; now: number; skipped: ReadonlySet<string>; locked: ReadonlySet<DialId>; feasibility: ReadonlyMap<string, FeasibilityResult>; formats: readonly string[] }): Chosen {
  const chosen: Question[] = [];
  const base = bestSetting(bests);
  for (const dial of order) {
    if (chosen.length >= max) break;
    if (ctx.locked.has(dial) || chosen.some((q) => q.dial === dial)) continue;
    if ((dial === "format" || dial === "newcomer") && chosen.some((q) => q.dial === "format" || q.dial === "newcomer")) continue;
    for (const q of questionsOf(dial, bests, ctx)) {
      const tentative = [...chosen, q];
      if (q.dial === "postTime") {
        chosen.push(q); // post time is free: nothing to plan
        break;
      }
      const settings = levelCombos(tentative.length).map((levels) => settingOf(base, tentative, levels, ctx.catalog));
      if (!settings.every((s) => armPossible(s, ctx.catalog, bests.joined))) continue;
      const missing = settings.filter((s) => !ctx.feasibility.has(armKey(s)));
      if (missing.length) return { questions: chosen, needed: dedupe(missing) };
      if (!settings.every((s) => isFeasible(ctx.feasibility.get(armKey(s))))) continue;
      chosen.push(q);
      break;
    }
  }
  return { questions: chosen, needed: [] };
}

const dedupe = (list: readonly ArmSetting[]) => [...new Map(list.map((s) => [armKey(s), s])).values()];

/* ------------------------------------------------------------------ the plan */

/** One clip of the day's pass: its role, its plan options, its channels and lanes, and what approval writes. */
export interface PassSlot {
  /** Its place in the day: normal clips first, then the reels of the pairs. */
  index: number;
  role: SlotRole;
  lane: InsightLane;
  /** The plan options it sets (the planner plans the rest from the seed). */
  options: { template: string; bucket: LengthBucket; ending: EndingStyle; postingTime: string };
  /** The local window it goes out in. */
  window: { from: string; to: string };
  channels: { id: string; lane: InsightLane }[];
  /** The dials no crew fix may change on this clip (a test's dials, on every clip of its window). */
  locked: DialId[];
  /** The test membership approval writes (null: no test runs). */
  membership: TestMembership | null;
  planSeed: number;
  /** The variety caps could not all be kept with what is ready. */
  capsRelaxed?: boolean;
}

/** A finding as the Learning card says it: a message key and its values (never text). */
export interface Finding {
  key: string;
  values: Record<string, string | number>;
}

export interface OpenTest {
  id: string;
  kind: TestKind;
  questions: Question[];
  /** Test clips (a check: new clips) scored, and best (old) clips scored. */
  nTest: number;
  nBest: number;
  /** Clips still waiting for their numbers. */
  pending: number;
  /** About when its result is due ("YYYY-MM-DD"). */
  expected: string;
}

export interface OpenBlock {
  id: string;
  questions: Question[];
  clean: number;
  pending: number;
  broken: number;
  expected: string;
}

export interface LearnerStatus {
  /** Posts measured (views at 72 h known). */
  measured: number;
  /** Each scored channel's usual: posts measured against the USUAL_MIN_POSTS it needs. */
  usual: { channelId: string; have: number; need: number; ready: boolean }[];
  /** How past calls held up: changes kept, and changes that went back after their checks. */
  kept: number;
  wentBack: number;
  /** The Trial Reel lane runs. */
  trialLane: boolean;
  /**
   * Why the lab makes no pair while its block is open: its newest pair got no numbers while normal Reels on its channel did
   * ("noTrialNumbers": "Instagram gave no numbers for your Trial Reels through Postiz."), or while they got none either
   * ("noNumbers": the card's Postiz line); null: not paused.
   */
  trialPause: "noTrialNumbers" | "noNumbers" | null;
}

export interface PassPlan {
  scoreRule: number;
  date: string;
  passId: string;
  /** Each dial's best, and the newcomers that joined their format's rotation. */
  best: Record<DialId, string>;
  joined: string[];
  test: OpenTest | null;
  block: OpenBlock | null;
  slots: PassSlot[];
  /** Verdicts this pass reached: written once to the decision log by the caller. */
  verdicts: LearnerDecision[];
  /** Every finding, newest first. */
  findings: Finding[];
  status: LearnerStatus;
  /** Arms to plan (lib/insights/feasibility.ts checkArms) before the next test or block can open. */
  feasibilityNeeded: ArmSetting[];
}

/** The findings of a decision log, newest (last written) first: each verdict's dial sentence with its counts and its shrunken ratio. */
export function findingsOf(log: readonly LearnerDecision[]): Finding[] {
  return [...log]
    .reverse()
    .map((e) => ({
      key: `${DIALS[e.dial].finding}.${e.verdict}`,
      values: { from: e.best, to: e.challenger, ...(e.subject ? { template: e.subject } : {}), ...(e.ratio !== null ? { ratio: round(e.ratio, 1) } : {}), nTest: e.nTest, nBest: e.nBest },
    }));
}

/** A chooser of templates under the variety caps, over the channels' recent posts and the pass's own picks. */
class Variety {
  private readonly hist = new Map<string, string[]>();
  constructor(posts: readonly LearnerPost[], now: number) {
    const recent = posts.filter((p) => p.facts.template && (parseIso(p.approvedAt) ?? 0) >= now - VARIETY_DAYS * DAY_MS).sort((a, b) => (parseIso(a.approvedAt) ?? 0) - (parseIso(b.approvedAt) ?? 0) || byString(a.postId, b.postId));
    for (const p of recent) this.hist.set(p.channelId, [...(this.hist.get(p.channelId) ?? []), p.facts.template!]);
  }
  private ok(id: string, channels: readonly string[], strict: boolean, ready: number): boolean {
    for (const c of channels) {
      const h = this.hist.get(c) ?? [];
      if (h[h.length - 1] === id) return false;
      if (!strict) continue;
      const n = h.filter((t) => t === id).length;
      if (h.length >= VARIETY_MIN_POSTS && (n + 1) / (h.length + 1) > TEMPLATE_SHARE_MAX) return false;
      if (ready >= VARIETY_MIN_TEMPLATES && new Set(h).size < VARIETY_MIN_TEMPLATES && n > 0) return false;
    }
    return true;
  }
  /** The first candidate from `start` (the date's place in the rotation) the caps allow, `avoid` only when nothing else is left. */
  choose(cands: readonly LearnerTemplate[], channels: readonly string[], start: number, avoid: string | null): { id: string; relaxed: boolean } {
    const n = cands.length;
    const order = Array.from({ length: n }, (_, i) => cands[(start + i) % n].id);
    const pickFrom = (list: readonly string[]) => list.find((id) => this.ok(id, channels, true, n)) ?? null;
    const preferred = avoid && n > 1 ? order.filter((id) => id !== avoid) : order;
    let id = pickFrom(preferred);
    let relaxed = false;
    if (!id) {
      relaxed = true;
      id = preferred.find((x) => this.ok(x, channels, false, n)) ?? preferred[0];
    }
    for (const c of channels) this.hist.set(c, [...(this.hist.get(c) ?? []), id]);
    return { id, relaxed };
  }
}

/** The seeded order of a check's positions: CHECK_OLD "old" among CHECK_POSTS (a Fisher-Yates shuffle from the check's id). */
export function checkOrder(checkId: string): ("old" | "new")[] {
  const arms: ("old" | "new")[] = Array.from({ length: CHECK_POSTS }, (_, i) => (i < CHECK_OLD ? "old" : "new"));
  return shuffled(arms, seededDraws(hashText(`check|${checkId}`)));
}

/** Whether learnPass runs: Pro, learning on and not paused, and some numbers read. */
export function learnerRuns(input: Pick<LearnerInput, "pro" | "settings" | "rows">): boolean {
  return input.pro && input.settings.learn && !input.settings.paused && input.rows.some((r) => r.reads.some((x) => x.views !== null));
}

/**
 * The next pass (see the header): the verdicts due, each dial's best, the open test and block, and the day's slots. Null
 * with no numbers, without Pro, or with learning off or paused: today's code path runs unchanged.
 */
export function learnPass(input: LearnerInput): PassPlan | null {
  if (!learnerRuns(input)) return null;
  const now = input.now;
  const offset: OffsetAt = input.offsetMinAt ?? UTC;
  const today = dayOfDate(input.date);
  const catalog = [...input.catalog].sort((a, b) => byString(a.id, b.id));
  const posts = [...input.posts].sort((a, b) => byString(a.postId, b.postId) || byString(a.channelId, b.channelId));
  const channels = [...input.channels].sort((a, b) => byString(a.id, b.id));
  const settings = input.settings;
  const dials = new Set(activeDials(input.l3 ?? false));
  const feasibility = new Map((input.feasibility ?? []).map((r) => [r.key, r]));
  const skipped = new Set(settings.skipped);
  const measures = new Map(measureRows(input.rows, now, input.since ?? {}).map((m) => [`${m.postId}|${m.channelId}`, m]));
  let log = [...input.decisions];
  const verdicts: LearnerDecision[] = [];
  // a verdict is written once, after the log's newest (decisionTime), and replayed in the order written
  const write = (vs: readonly LearnerDecision[]) => {
    const decidedAt = new Date(decisionTime(log, now)).toISOString();
    const stamped = vs.map((v) => ({ ...v, decidedAt }));
    verdicts.push(...stamped);
    log = [...log, ...stamped];
  };

  // --- the usual of each scored channel, now
  const points = new Map<string, MeasuredPoint[]>();
  for (const m of measures.values()) if ((m.state === "scored" || m.state === "unscored") && m.lane === "normal" && m.publishedAt !== null) points.set(m.channelId, [...(points.get(m.channelId) ?? []), { publishedAt: m.publishedAt, views72: m.views72 }]);
  const usualReady = new Set<string>();
  const usual = channels.filter((c) => scoredFamily(c.platform)).map((c) => {
    const restart = parseIso(input.since?.[c.id]) ?? Number.NEGATIVE_INFINITY;
    const u = usualOf(points.get(c.id) ?? [], now + 1, restart);
    if (u.usual !== null) usualReady.add(c.id);
    return { channelId: c.id, have: u.n, need: USUAL_MIN_POSTS, ready: u.usual !== null };
  });

  // --- the lanes
  const trialChannel = channels.find((c) => c.trialReels && platformFamily(c.platform) === "instagram")?.id ?? null;
  // the day's pairs: the owner's pairs a day, as many as fit outside quiet hours (none fits: no lab)
  const trialPairs = trialPairWindows(input.quiet);
  const pairsPerDay = Math.min(trialPairs.length, Math.max(0, Math.min(PAIRS_PER_DAY_MAX, Math.round(settings.pairsPerDay))));
  const trialOn = settings.trialReels && pairsPerDay > 0 && settings.autoShareOff && !!trialChannel;
  const perDay = Math.max(0, Math.round(input.perDay));
  const seqOf = (lane: "normal" | "trialReel") => new Set(log.filter((e) => (lane === "trialReel" ? e.testId.startsWith("t") : !e.testId.startsWith("t"))).map((e) => e.testId)).size;
  const closed = (id: string) => log.some((e) => e.testId === id);
  const ids = [...new Set(posts.map((p) => p.test?.id).filter((x): x is string => !!x))].sort(byString);
  const openOf = (lane: "normal" | "trialReel") => {
    const seq = seqOf(lane);
    return (
      ids
        .map(parseTestId)
        .filter((t): t is ParsedTest => !!t && t.seq === seq && !closed(t.id) && (lane === "trialReel" ? t.kind === "block" : t.kind !== "block"))
        .filter((t) => t.questions.every((q) => dials.has(q.dial) && !skipped.has(keyOf(q)) && !settings.fixed[q.dial]))[0] ?? null
    );
  };
  // the kept changes still waiting for their check (oldest first), without the ones undone since. A newcomer that joined is not
  // checked: it is one template of its format's rotation, so 4 old clips against 12 new would mostly compare the rotation with
  // itself; it stays as long as the rotation does not clearly beat it.
  const pendingChecks = () => {
    const sources = [...new Set(log.filter((e) => e.verdict === "kept").map((e) => e.testId))];
    const checked = new Set(log.map((e) => parseTestId(e.testId)).filter((t): t is ParsedTest => !!t && t.kind === "check").map((t) => t.source!.id));
    const bests = bestsOf(log, settings, catalog);
    return sources
      .filter((s) => !checked.has(s))
      .map((s) => ({ source: s, kept: log.filter((e) => e.testId === s && e.verdict === "kept").map((e) => ({ dial: e.dial, best: e.best, challenger: e.challenger, subject: e.subject })) }))
      .map((c) => ({ ...c, kept: c.kept.filter((q) => q.dial !== "newcomer" && bests.arms[q.dial] === q.challenger) }))
      .filter((c) => c.kept.length > 0);
  };

  // --- read what is open; a verdict closes it and the next opens in the same pass
  let normalTest: ParsedTest | null = openOf("normal");
  let normalRead: NormalRead | null = null;
  let checkKept: Question[] = [];
  for (let guard = 0; guard < 4 && normalTest; guard++) {
    if (normalTest.kind === "check") {
      const pc = pendingChecks().find((c) => c.source === normalTest!.source!.id);
      if (!pc) {
        // every change it checks was undone since: nothing is left to check, and it closes so the normal lane moves on
        const undone = log.filter((e) => e.testId === normalTest!.source!.id && e.verdict === "kept").map((e) => ({ dial: e.dial, best: e.best, challenger: e.challenger, subject: e.subject }));
        normalRead = { clips: [], nTest: 0, nBest: 0, pending: 0, verdicts: (undone.length ? undone : normalTest.questions).map((q) => decision(normalTest!.id, "normal", q, "undone", now, { ratio: null, p: null, nTest: 0, nBest: 0 })) };
      } else {
        checkKept = pc.kept;
        normalRead = readCheck(normalTest, checkKept, posts, measures, catalog, now, offset);
      }
    } else {
      normalRead = readNormalTest(normalTest, posts, measures, catalog, now, offset);
      const q = normalTest.questions[0];
      const att = (arm: string) => (input.attempts ?? []).filter((a) => a.testId === normalTest!.id && a.arm === arm).reduce((s, a) => ({ tries: s.tries + a.tries, passed: s.passed + a.passed }), { tries: 0, passed: 0 });
      if (!normalRead.verdicts.length && rarelyPasses(att(q.challenger), att(q.best))) normalRead.verdicts = [decision(normalTest.id, "normal", q, "rarelyPasses", now, { ratio: null, p: null, nTest: normalRead.nTest, nBest: normalRead.nBest })];
    }
    if (!normalRead.verdicts.length) break;
    write(normalRead.verdicts);
    normalTest = openOf("normal");
    normalRead = null;
  }
  let block: ParsedTest | null = openOf("trialReel");
  let blockRead: BlockRead | null = block ? readBlockTest(block, posts, measures, catalog, now, offset, input.attempts ?? []) : null;
  if (blockRead?.verdicts.length) {
    write(blockRead.verdicts);
    block = null;
    blockRead = null;
  }
  // the lab's own check of its numbers (the plan: "the app's first pair is its own check"): when the newest pair of the open
  // block whose numbers are known got none (both reels 0 views, or no answer, at their 3-day read), no new pair is made while
  // that block stays open. It closes as "not enough clean pairs" after BLOCK_MAX_DAYS, and the next block tries one pair
  // again. The normal lane runs the whole list meanwhile.
  const newestKnown = blockRead ? [...blockRead.pairs].sort((a, b) => b.pair - a.pair).find((p) => p.numbers !== null) : undefined;
  const trialNoNumbers = trialOn && newestKnown?.numbers === false;
  const trialLane = trialOn && !trialNoNumbers;
  const channelNumbers = [...measures.values()].some((m) => m.channelId === trialChannel && m.lane === "normal" && (m.state === "scored" || m.state === "unscored") && m.views72 >= 1);
  const trialPause: LearnerStatus["trialPause"] = trialNoNumbers ? (channelNumbers ? "noTrialNumbers" : "noNumbers") : null;

  // --- the bests after this pass's verdicts, and what opens next
  const bests = bestsOf(log, settings, catalog);
  const formats = formatOrder(catalog, input.feasibility ?? []);
  const needed: ArmSetting[] = [];
  const lockedBy = (t: ParsedTest | null) => new Set<DialId>(t ? (t.kind === "check" ? checkKept : t.questions).map((q) => q.dial) : []);
  const fixedDials = new Set((Object.keys(settings.fixed) as DialId[]).filter((d) => settings.fixed[d]));
  const ctxBase = { catalog, log, now, skipped, feasibility, formats };
  if (!normalTest) {
    const checks = pendingChecks().filter((c) => !block || !c.kept.some((q) => lockedBy(block).has(q.dial)));
    if (checks.length) {
      checkKept = checks[0].kept;
      normalTest = parseTestId(testIdOf("check", seqOf("normal"), [], checks[0].source));
    } else if (usualReady.size) {
      const order = (trialLane ? TEST_ORDER.normal : TEST_ORDER.normalWithoutTrials).filter((d) => dials.has(d) && DIALS[d].lanes.includes("normal"));
      const pick = chooseQuestions(order, 1, bests, { ...ctxBase, locked: new Set([...fixedDials, ...lockedBy(block)]) });
      needed.push(...pick.needed);
      if (pick.questions.length) normalTest = parseTestId(testIdOf("normal", seqOf("normal"), pick.questions));
    }
  }
  if (!block && trialLane) {
    const order = TEST_ORDER.trialReel.filter((d) => dials.has(d) && DIALS[d].lanes.includes("trialReel"));
    const locked = new Set<DialId>([...fixedDials, ...lockedBy(normalTest), ...pendingChecks().flatMap((c) => c.kept.map((q) => q.dial))]);
    const pick = chooseQuestions(order, BLOCK_DIALS_MAX, bests, { ...ctxBase, locked });
    needed.push(...pick.needed);
    if (pick.questions.length && !pick.needed.length) block = parseTestId(testIdOf("block", seqOf("trialReel"), pick.questions));
  }
  if (normalTest && !normalRead) normalRead = normalTest.kind === "check" ? readCheck(normalTest, checkKept, posts, measures, catalog, now, offset) : readNormalTest(normalTest, posts, measures, catalog, now, offset);
  if (block && !blockRead) blockRead = readBlockTest(block, posts, measures, catalog, now, offset, input.attempts ?? []);

  // --- the day's slots
  const variety = new Variety(posts, now);
  const base = bestSetting(bests);
  const endingTested = log.some((e) => e.dial === "ending") || normalTest?.questions.some((q) => q.dial === "ending") || block?.questions.some((q) => q.dial === "ending");
  const slots: PassSlot[] = [];
  const seedOf = (testId: string | null, index: number) => 1 + (hashText(`${input.date}|${testId ?? "best"}|${index}`) % 0x7ffffffe);
  const every = normalTest?.kind === "normal" && !trialLane && (normalTest.questions[0].dial === "newcomer" || normalTest.questions[0].dial === "format") ? NEWCOMER_TEST_EVERY : TEST_EVERY;
  const checkArms = normalTest?.kind === "check" ? checkOrder(normalTest.id) : [];
  const checkUsed = normalTest?.kind === "check" ? new Set(posts.filter((p) => p.test?.id === normalTest!.id).map((p) => p.clipId)).size : 0;
  const oldLive = normalRead ? normalRead.clips.filter((c) => c.arm === "old" && c.state !== "excluded").length : 0;
  let checkPlace = checkUsed;
  // the day's test slots: as many as 1 clip in `every` gives today (counted over the days, so a week stays within one of it),
  // at places drawn per date (hash(date|test|slots)), so the test clip is not the same slot of the day every day
  const testPlaces = new Set<number>();
  if (normalTest?.kind === "normal" && usualReady.size > 0) {
    const phase = hashText(normalTest.id) % every;
    const count = Array.from({ length: perDay }, (_, j) => j).filter((j) => (today * perDay + j + phase) % every === 0).length;
    const places = shuffled(Array.from({ length: perDay }, (_, j) => j), seededDraws(hashText(`${input.date}|${normalTest.id}|slots`)));
    for (const j of places.slice(0, count)) testPlaces.add(j);
  }
  // the day's windows for "spread", from the date alone (never from a slot's role)
  const spread = spreadWindows(today, input.quiet);
  for (let j = 0; j < perDay; j++) {
    let role: SlotRole = "best";
    let arm: string | null = null;
    let setting: ArmSetting = { ...base };
    let membership: TestMembership | null = null;
    let windowArm = bests.arms.postTime;
    if (normalTest?.kind === "check") {
      role = "check";
      arm = checkPlace < CHECK_POSTS ? checkArms[checkPlace] : oldLive < CHECK_OLD ? "old" : "new";
      checkPlace++;
      if (arm === "old") setting = settingOf(base, checkKept.map((q) => ({ ...q })), checkKept.map(() => 0), catalog);
      if (arm === "old" && checkKept.some((q) => q.dial === "postTime")) windowArm = checkKept.find((q) => q.dial === "postTime")!.best;
      membership = { id: normalTest.id, arm, role };
    } else if (normalTest?.kind === "normal") {
      const q = normalTest.questions[0];
      const isTest = testPlaces.has(j);
      role = isTest ? "test" : "best";
      arm = isTest ? q.challenger : q.best;
      setting = settingOf(base, [q], [isTest ? 1 : 0], catalog);
      if (q.dial === "postTime") windowArm = arm;
      membership = { id: normalTest.id, arm, role };
    }
    // the ending: a test's or the best's, else, while the ending is untested, 1 normal clip in CLIFF_EVERY a cliffhanger, drawn
    // apart from the test slots so both arms of a test get the same share
    const cliff = seededDraws(hashText(`${input.date}|cliff|${j}`))() < 1 / CLIFF_EVERY;
    if (!endingTested && cliff && candidatesFor({ ...setting, ending: "cliffhanger" }, catalog, bests.joined).length) setting = { ...setting, ending: "cliffhanger" };
    const chs = channelsFor(role, arm, setting.bucket, channels, { trialChannel, usualReady });
    let cands = candidatesFor(setting, catalog, bests.joined);
    if (!cands.length && role === "best") cands = candidatesFor({ ...setting, ending: base.ending }, catalog, bests.joined);
    if (!cands.length || !chs.length) continue;
    const pick = variety.choose(cands, chs.map((c) => c.id), today + j, null);
    const w = windowOf(windowArm, j, spread);
    const testId = membership?.id ?? null;
    slots.push({
      index: slots.length,
      role,
      lane: "normal",
      options: { template: pick.id, bucket: setting.bucket, ending: catalog.find((t) => t.id === pick.id)!.endings.includes(setting.ending) ? setting.ending : base.ending, postingTime: w.from },
      window: w,
      channels: chs,
      locked: normalTest ? (normalTest.kind === "check" ? checkKept : normalTest.questions).map((q) => q.dial) : [],
      membership,
      planSeed: seedOf(testId, j),
      ...(pick.relaxed ? { capsRelaxed: true } : {}),
    });
  }
  if (block && trialLane && blockRead) {
    const k = block.questions.length;
    const recorded = new Map(blockRead.pairs.map((p) => [p.pair, p]));
    const fresh = Array.from({ length: pairsPerDay }, (_, p) => today * PAIRS_PER_DAY_MAX + p).filter((pair) => !recorded.has(pair));
    const patterns = nextPatterns(blockRead.pairs, k, fresh.length);
    for (let p = 0; p < pairsPerDay; p++) {
      const pair = today * PAIRS_PER_DAY_MAX + p;
      const rec = recorded.get(pair);
      if (rec && rec.pattern < 0) continue; // a broken pair of levels: made again on another day
      const a = armsOfPattern(k, rec ? rec.pattern : patterns[fresh.indexOf(pair)]).a;
      const b = a.map((l) => (l === 0 ? 1 : 0) as Level);
      const firstA = aFirst(block.id, input.date, pair);
      let used: string | null = null;
      for (const role of ["trialA", "trialB"] as const) {
        const levels = role === "trialA" ? a : b;
        const setting = settingOf(base, block.questions, levels, catalog);
        const cands = candidatesFor(setting, catalog, bests.joined);
        const chs = channelsFor(role, armOf(levels), setting.bucket, channels, { trialChannel, usualReady });
        if (!cands.length || !chs.length) continue;
        // two different modes of the format in a pair where the format is not one of the block's dials
        const formatFree = !block.questions.some((q) => q.dial === "format" || q.dial === "newcomer");
        const pick = variety.choose(cands, chs.map((c) => c.id), today + p, formatFree ? used : null);
        used = pick.id;
        const first = (role === "trialA") === firstA;
        const w = trialPairs[p][first ? 0 : 1];
        slots.push({
          index: slots.length,
          role,
          lane: "trialReel",
          options: { template: pick.id, bucket: setting.bucket, ending: setting.ending, postingTime: w.from },
          window: w,
          channels: chs,
          locked: block.questions.map((q) => q.dial),
          membership: { id: block.id, arm: armOf(levels), role, pair },
          planSeed: seedOf(block.id, 100 + 2 * p + (role === "trialA" ? 0 : 1)),
          ...(pick.relaxed ? { capsRelaxed: true } : {}),
        });
      }
    }
  }

  // --- what the card says
  const expectedDay = (days: number) => dateOfDay(today + Math.max(0, Math.ceil(days)));
  const test: OpenTest | null =
    normalTest && normalRead
      ? (() => {
          const live = normalRead.clips.filter((c) => (normalTest!.kind === "check" ? true : c.role === "test") && c.state !== "excluded").length;
          const need = normalTest.kind === "check" ? CHECK_POSTS : NORMAL_TEST_CLIPS;
          const perClip = normalTest.kind === "check" ? 1 / Math.max(1, perDay) : every / Math.max(1, perDay);
          return { id: normalTest.id, kind: normalTest.kind, questions: normalTest.kind === "check" ? checkKept : normalTest.questions, nTest: normalRead.nTest, nBest: normalRead.nBest, pending: normalRead.pending, expected: expectedDay(Math.max(0, need - live) * perClip + SCORE_AGE_H / 24) };
        })()
      : null;
  const openBlock: OpenBlock | null =
    block && blockRead ? { id: block.id, questions: block.questions, clean: blockRead.clean, pending: blockRead.pending, broken: blockRead.broken, expected: expectedDay(Math.max(0, BLOCK_PAIRS - blockRead.clean - blockRead.pending) / Math.max(1, pairsPerDay) + SCORE_AGE_H / 24) } : null;
  const allMeasured = [...measures.values()].filter((m) => m.state === "scored" || m.state === "unscored").length;
  const kept = log.filter((e) => e.verdict === "kept").length;
  const wentBack = new Set(log.filter((e) => e.verdict === "wentBack").map((e) => keyOf(e))).size;
  const best = Object.fromEntries([...dials].map((d) => [d, bests.arms[d]])) as Record<DialId, string>;
  return {
    scoreRule: SCORE_RULE,
    date: input.date,
    passId: hashText(`${input.date}|${normalTest?.id ?? "-"}|${block?.id ?? "-"}|${log.length}`).toString(16).padStart(8, "0"),
    best,
    joined: [...bests.joined].sort(byString),
    test,
    block: openBlock,
    slots,
    verdicts,
    findings: findingsOf(log),
    status: { measured: allMeasured, usual, kept, wentBack, trialLane, trialPause },
    feasibilityNeeded: dedupe(needed),
  };
}

// --- end learner ---
