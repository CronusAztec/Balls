import {
  CHANNEL_BACKOFF_H,
  CHANNEL_FAIL_STREAK,
  DAY3_WINDOW_H,
  EARLY_WINDOW_H,
  GROWTH_BOUNDS,
  GROWTH_MIN_POSTS,
  GROWTH_PRIOR,
  INSIGHT_ROWS_MAX,
  INSIGHT_ROW_MAX_DAYS,
  MEASURED_FROM_H,
  MEASURED_UNTIL_H,
  METRIC_BREAKS,
  NO_ANSWER_RETRY_H,
  NO_ANSWER_TRIES,
  READ_SPACING_H,
  SCORE_AGE_H,
  SCORE_CLIP,
  SCORE_RULE,
  USUAL_MIN_POSTS,
  USUAL_MIN_VIEWS,
  USUAL_POSTS,
  USUAL_WINDOW_DAYS,
  WEEK_WINDOW_H,
  YOUTUBE_ROW_MAX_DAYS,
} from "./learnerRules";

/*
 * --- learner --- The numbers on the PC, as pure code: the raw timed reads of each post the app made (one InsightRow per
 * channel post, kept by the app's main process in social-insights.json: desktop/src/social/insights.ts, a later step), when
 * each post is due to be read again (`dueReads`), Postiz's labels (`LABELS`), the views at exactly 72 h drawn from the reads
 * either side (`viewsAt72`), the channel's usual (`usualOf`) and the score (`scoreOf`, under SCORE_RULE).
 *
 * Postiz answers a post's lifetime totals stamped today, so the app's own timing is the only way to compare posts at one age:
 * the early read (18-36 h, shown only), the 3-day read (60-96 h, caught up until 168 h) and the week read (144-240 h), each
 * stored with its real age. Rows hold raw reads only; scores are worked out on every load, so a later fix to the score reaches
 * every old row. An empty answer is "no answer", never zero, and a missing total stays null.
 *
 * The score: s = ln((views at 72 h + 1) / (usual + 1)), clipped at plus or minus ln 10. The usual is the median views at 72 h
 * of the channel's last 20 measured posts in the same lane, published before the post and within 120 days of it; it needs 5
 * posts and a median of 10 views. YouTube is read and shown, never scored. Nothing here leaves the PC.
 *
 * Pure and deterministic: no clock (the caller passes `now`), no randomness of its own, no imports but types and the rules, so
 * the main process can bundle it (like lib/insights/genes.ts; tests/insightsStats.test.ts reads its imports and bundles it).
 * Every number it reads comes through `sanitizeInsightRow`.
 */

// --- learner ---

export { SCORE_RULE };

/** The numbers a read keeps, by Postiz's labels (Instagram: Views, Reach, Saves, Likes, Comments, Shares). */
export const INSIGHT_METRICS = ["views", "reach", "likes", "comments", "shares", "saves"] as const;
export type InsightMetric = (typeof INSIGHT_METRICS)[number];
/** Normal posts (followers and everyone) and Instagram Trial Reels (people who do not follow, first). */
export const INSIGHT_LANES = ["normal", "trialReel"] as const;
export type InsightLane = (typeof INSIGHT_LANES)[number];
/** A row's state: read fine, no answer after its tries, a TikTok upload not finished yet, or left out for good. */
export const INSIGHT_STATES = ["ok", "noAnswer", "missing", "excluded"] as const;
export type InsightState = (typeof INSIGHT_STATES)[number];
/** Why the main process left a row out for good: the post failed, was deleted, is a Story, or its channel is off in Postiz. */
export const ROW_EXCLUSIONS = ["error", "deleted", "story", "disabled"] as const;
export type RowExclusion = (typeof ROW_EXCLUSIONS)[number];
/**
 * Why a post does not count, as the card names it: the row's own reasons, then the score's (YouTube shown only, a platform
 * that is not scored, no answer, an unfinished TikTok upload, no read between 48 h and 168 h, before a metric's break), then
 * the learner's (lib/insights/learner.ts: TikTok Only me or privacy unknown, a free clip, off its arm, outside its test's
 * window, a Trial Reel shared before its read, a test clip on a channel whose usual is not ready).
 */
export const POST_EXCLUSIONS = [...ROW_EXCLUSIONS, "youtube", "platform", "noAnswer", "draft", "notMeasured", "beforeBreak", "self", "privacyUnknown", "free", "offPlan", "outOfWindow", "shared", "noUsual"] as const;
export type PostExclusion = (typeof POST_EXCLUSIONS)[number];

/** One timed read: when it was taken, the post's age then, and each total (null when Postiz gave none: never 0). */
export interface InsightRead {
  at: string;
  ageH: number;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

/** The read windows: the early read, the 3-day read and the week read. */
export const READ_WINDOWS = ["early", "day3", "week"] as const;
export type ReadWindow = (typeof READ_WINDOWS)[number];

/** The tries of the window being read: how many empty answers, and the last. */
export interface InsightTries {
  window: ReadWindow;
  n: number;
  lastAt: string;
}

/** One channel post the app made, with its raw reads (ids only: never a channel name or post text). */
export interface InsightRow {
  postId: string;
  channelId: string;
  /** Postiz's provider identifier ("instagram", "instagram-standalone", "tiktok", "youtube", ...). */
  platform: string;
  lane: InsightLane;
  /** Postiz's publishDate (ISO), null while it is not published. */
  publishedAt: string | null;
  state: InsightState;
  excluded?: RowExclusion;
  /** At most 3: one per window, in age order. */
  reads: InsightRead[];
  tries: InsightTries | null;
}

export const INSIGHT_ID_MAX = 128;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const PLATFORM = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The largest count a read keeps (a total beyond it is not a number Postiz sends). */
export const METRIC_MAX = 1e12;
/** The oldest age a read keeps (h): ten years. */
export const READ_AGE_MAX_H = 87_600;

/* ------------------------------------------------------------------ small pure helpers */

/** FNV-1a of a string, unsigned 32-bit (the planner's hashString, lib/bot/planner.ts; tests keep the two equal). */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 (the planner's seededRandom, lib/bot/planner.ts; tests keep the two equal): 0 <= x < 1. */
export function seededDraws(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26: error under 1.5e-7). */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** The median of a list (null for none). */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const parseIso = (v: unknown): number | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Which family a Postiz provider identifier scores as (lib/desktop/socialCard.ts familyOf; tests keep the two equal). */
export function platformFamily(platform: string): "instagram" | "tiktok" | "youtube" | "other" {
  if (platform === "tiktok") return "tiktok";
  if (platform === "instagram" || platform === "instagram-standalone") return "instagram";
  if (platform === "youtube") return "youtube";
  return "other";
}

/* ------------------------------------------------------------------ Postiz's labels */

/** Spelling aside (case, spaces, underscores and dashes ignored), the labels a read keeps. Favorites (YouTube) is not one. */
export const LABELS: Readonly<Record<string, InsightMetric>> = { views: "views", reach: "reach", likes: "likes", comments: "comments", shares: "shares", saves: "saves" };

/** A label as LABELS keys it. */
export const normalizeLabel = (label: string): string => label.toLowerCase().replace(/[\s_-]+/g, "");

/** The metric of one of Postiz's labels (null: a label the app does not keep). */
export function metricOfLabel(label: unknown): InsightMetric | null {
  if (typeof label !== "string" || label.length > 64) return null;
  const key = normalizeLabel(label);
  return Object.prototype.hasOwnProperty.call(LABELS, key) ? LABELS[key] : null;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(METRIC_MAX, Math.round(v)) : typeof v === "string" && /^\d{1,13}$/.test(v.trim()) ? Math.min(METRIC_MAX, Number(v.trim())) : null);

/**
 * A read of Postiz's answer for one post: each kept label's total (the series' total, else its last point), null for a label
 * it did not send or sent without a count, and the labels it sent that the app does not keep (counted as "labels seen", never
 * an error). An empty answer is no read at all (null): "no answer", never zero.
 */
export function readOfAnswer(series: unknown, at: string, ageH: number): { read: InsightRead | null; unknownLabels: string[] } {
  const unknownLabels: string[] = [];
  if (!Array.isArray(series) || !series.length) return { read: null, unknownLabels };
  const read: InsightRead = { at, ageH, views: null, reach: null, likes: null, comments: null, shares: null, saves: null };
  let any = false;
  for (const s of series.slice(0, 32)) {
    if (!s || typeof s !== "object") continue;
    const label = (s as { label?: unknown }).label;
    const metric = metricOfLabel(label);
    if (!metric) {
      if (typeof label === "string" && label.length <= 64 && !unknownLabels.includes(label)) unknownLabels.push(label);
      continue;
    }
    // the series' total (desktop/src/social/postiz.ts PostizAnalyticsSeries), else its last point: Postiz answers a post's
    // lifetime totals as one point stamped today
    const data = (s as { data?: unknown }).data;
    const last = Array.isArray(data) && data.length ? data[data.length - 1] : null;
    const total = count((s as { total?: unknown }).total) ?? count(last && typeof last === "object" ? (last as { total?: unknown }).total : undefined);
    if (total === null) continue;
    read[metric] = total;
    any = true;
  }
  return { read: any ? read : null, unknownLabels };
}

/* ------------------------------------------------------------------ the rows: sanitised on every read and write */

function sanitizeRead(raw: unknown): InsightRead | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const at = parseIso(r.at);
  const ageH = typeof r.ageH === "number" && Number.isFinite(r.ageH) && r.ageH >= 0 && r.ageH <= READ_AGE_MAX_H ? Math.round(r.ageH * 100) / 100 : null;
  if (at === null || ageH === null) return null;
  const out: InsightRead = { at: new Date(at).toISOString(), ageH, views: null, reach: null, likes: null, comments: null, shares: null, saves: null };
  for (const m of INSIGHT_METRICS) out[m] = typeof r[m] === "number" ? count(r[m]) : null;
  return out;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

/**
 * A row as the app stores it, or null when `raw` is not one: ids from a strict alphabet, a closed lane, state and reason,
 * an ISO date or null, at most 3 reads in age order (each total a whole number or null), the tries bounded; unknown keys
 * dropped.
 */
export function sanitizeInsightRow(raw: unknown): InsightRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const postId = typeof r.postId === "string" && ID.test(r.postId) ? r.postId : null;
  const channelId = typeof r.channelId === "string" && ID.test(r.channelId) ? r.channelId : null;
  const platform = typeof r.platform === "string" && PLATFORM.test(r.platform) ? r.platform : null;
  const lane = oneOf(INSIGHT_LANES, r.lane);
  const state = oneOf(INSIGHT_STATES, r.state) ?? "ok";
  if (!postId || !channelId || !platform || !lane) return null;
  const published = parseIso(r.publishedAt);
  const reads = (Array.isArray(r.reads) ? r.reads.slice(0, 16) : []).map(sanitizeRead).filter((x): x is InsightRead => !!x).sort((a, b) => a.ageH - b.ageH).slice(0, 3);
  let tries: InsightTries | null = null;
  if (r.tries && typeof r.tries === "object" && !Array.isArray(r.tries)) {
    const t = r.tries as Record<string, unknown>;
    const window = oneOf(READ_WINDOWS, t.window);
    const lastAt = parseIso(t.lastAt);
    const n = typeof t.n === "number" && Number.isFinite(t.n) ? Math.max(0, Math.min(NO_ANSWER_TRIES, Math.round(t.n))) : null;
    if (window && lastAt !== null && n !== null) tries = { window, n, lastAt: new Date(lastAt).toISOString() };
  }
  const row: InsightRow = { postId, channelId, platform, lane, publishedAt: published === null ? null : new Date(published).toISOString(), state, reads, tries };
  if (state === "excluded") {
    const why = oneOf(ROW_EXCLUSIONS, r.excluded);
    row.excluded = why ?? "error";
  }
  return row;
}

/** The rows the store keeps: none older than 180 days, YouTube's none older than 30, then the newest 1000 (by publish date). */
export function pruneInsightRows(rows: readonly InsightRow[], now: number): InsightRow[] {
  const kept = rows.filter((row) => {
    const t = parseIso(row.publishedAt);
    if (t === null) return true;
    const ageDays = (now - t) / DAY_MS;
    return ageDays <= INSIGHT_ROW_MAX_DAYS && !(platformFamily(row.platform) === "youtube" && ageDays > YOUTUBE_ROW_MAX_DAYS);
  });
  const time = (row: InsightRow) => parseIso(row.publishedAt) ?? Number.POSITIVE_INFINITY;
  return kept.sort((a, b) => time(b) - time(a) || (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0)).slice(0, INSIGHT_ROWS_MAX);
}

/* ------------------------------------------------------------------ when to read */

const inRange = (h: number, w: { from: number; to: number }) => h >= w.from && h <= w.to;

/** The window a post of age `ageH` with these reads is due to be read in (null: none now). */
export function windowDue(reads: readonly InsightRead[], ageH: number): ReadWindow | null {
  if (inRange(ageH, EARLY_WINDOW_H) && !reads.some((r) => inRange(r.ageH, EARLY_WINDOW_H))) return "early";
  // the 3-day read, caught up until 168 h when the app was closed in its window
  if (ageH >= DAY3_WINDOW_H.from && ageH <= MEASURED_UNTIL_H && !reads.some((r) => r.ageH >= MEASURED_FROM_H && r.ageH <= MEASURED_UNTIL_H)) return "day3";
  if (inRange(ageH, WEEK_WINDOW_H) && !reads.some((r) => r.ageH >= WEEK_WINDOW_H.from)) return "week";
  return null;
}

/** A channel's read streak: empty or failed reads in a row, and the last one (the main process keeps it per channel). */
export interface ChannelStreak {
  failures: number;
  lastAt: string | null;
}

/** A channel waits CHANNEL_BACKOFF_H after CHANNEL_FAIL_STREAK empty or failed reads in a row. */
export function channelWaits(streak: ChannelStreak | undefined, now: number): boolean {
  if (!streak || streak.failures < CHANNEL_FAIL_STREAK) return false;
  const last = parseIso(streak.lastAt);
  return last !== null && now - last < CHANNEL_BACKOFF_H * HOUR_MS;
}

export interface DueRead {
  postId: string;
  channelId: string;
  window: ReadWindow;
}

/**
 * The reads due now, oldest post first, at most `callsLeft` (the hour's budget left: READS_PER_HOUR less the calls made in
 * the last hour). A post is read in a window it has no read in yet, never twice within an hour, and after an empty answer
 * again only 2 hours later and at most 3 times in that window. Rows left out, rows not published yet and channels in
 * `blocked` (disabled in Postiz, or waiting after failed reads: `channelWaits`) are not read.
 */
export function dueReads(rows: readonly InsightRow[], now: number, options: { callsLeft: number; blocked?: ReadonlySet<string> }): DueRead[] {
  const due: { at: number; read: DueRead }[] = [];
  for (const row of rows) {
    if (row.state === "excluded" || options.blocked?.has(row.channelId)) continue;
    const published = parseIso(row.publishedAt);
    if (published === null || published > now) continue;
    const ageH = (now - published) / HOUR_MS;
    const lastRead = Math.max(...row.reads.map((r) => parseIso(r.at) ?? Number.NEGATIVE_INFINITY), parseIso(row.tries?.lastAt) ?? Number.NEGATIVE_INFINITY);
    if (now - lastRead < READ_SPACING_H * HOUR_MS) continue;
    const window = windowDue(row.reads, ageH);
    if (!window) continue;
    if (row.tries && row.tries.window === window) {
      if (row.tries.n >= NO_ANSWER_TRIES) continue;
      const last = parseIso(row.tries.lastAt);
      if (last !== null && now - last < NO_ANSWER_RETRY_H * HOUR_MS) continue;
    }
    due.push({ at: published, read: { postId: row.postId, channelId: row.channelId, window } });
  }
  due.sort((a, b) => a.at - b.at || (a.read.postId < b.read.postId ? -1 : a.read.postId > b.read.postId ? 1 : 0));
  return due.slice(0, Math.max(0, Math.floor(options.callsLeft))).map((d) => d.read);
}

/* ------------------------------------------------------------------ views at 72 h */

export type At72 = { state: "final"; views: number; via: "line" | "projected"; ageH: number } | { state: "pending" } | { state: "notMeasured" };

const lnv = (v: number) => Math.log(v + 1);
const fromLn = (y: number) => Math.max(0, Math.exp(y) - 1);

/**
 * Views at exactly 72 h, from the reads between 48 h and 168 h old: the early read (18-36 h) is shown only, as Meta's numbers
 * can still lag then, so it never anchors the line. A read either side of 72 h: the straight line on log(views + 1) against
 * log(age) through the two nearest. Else a read in the 3-day window (60-96 h), or else the read past 72 h nearest it (a 3-day
 * read caught up late: no read nearer 72 h can come), projected to 72 h with the channel's growth (views ~ age^growth).
 * Otherwise, once the post is older than 168 h, the read nearest 72 h projected the same way; until then pending, as a nearer
 * read can still come. No read between 48 h and 168 h: not measured. `postAgeH` is the post's age now.
 */
export function viewsAt72(reads: readonly InsightRead[], postAgeH: number, growth: number = GROWTH_PRIOR): At72 {
  // only the reads a score may rest on (MEASURED_FROM_H to MEASURED_UNTIL_H): a lagged early read would pull the line down for
  // a post whose 3-day read came late, by an amount that follows the hours the app was open
  const inWindow = reads.filter((r) => r.views !== null && r.ageH >= MEASURED_FROM_H && r.ageH <= MEASURED_UNTIL_H).sort((a, b) => a.ageH - b.ageH);
  if (!inWindow.length) return postAgeH > MEASURED_UNTIL_H ? { state: "notMeasured" } : { state: "pending" };
  const below = inWindow.filter((r) => r.ageH <= SCORE_AGE_H);
  const above = inWindow.filter((r) => r.ageH >= SCORE_AGE_H);
  if (below.length && above.length) {
    const r0 = below[below.length - 1];
    const r1 = above[0];
    if (r1.ageH === r0.ageH) return { state: "final", views: r0.views as number, via: "line", ageH: r0.ageH };
    const t = (Math.log(SCORE_AGE_H) - Math.log(r0.ageH)) / (Math.log(r1.ageH) - Math.log(r0.ageH));
    return { state: "final", views: fromLn(lnv(r0.views as number) + t * (lnv(r1.views as number) - lnv(r0.views as number))), via: "line", ageH: r1.ageH };
  }
  const nearest = (list: readonly InsightRead[]) => list.reduce((a, b) => (Math.abs(Math.log(b.ageH / SCORE_AGE_H)) < Math.abs(Math.log(a.ageH / SCORE_AGE_H)) ? b : a));
  const day3 = inWindow.filter((r) => inRange(r.ageH, DAY3_WINDOW_H));
  // a read past 72 h with none from 48 h up to 72 h is final at once: every later read is further from 72 h
  const from = day3.length ? nearest(day3) : above.length ? above[0] : postAgeH > MEASURED_UNTIL_H ? nearest(inWindow) : null;
  if (!from) return { state: "pending" };
  return { state: "final", views: fromLn(lnv(from.views as number) + growth * Math.log(SCORE_AGE_H / from.ageH)), via: "projected", ageH: from.ageH };
}

/**
 * A channel's growth exponent: the median slope of log(views + 1) against log(age) between the first and last reads at or after
 * MEASURED_FROM_H of its posts with two such reads (the 3-day and the week read), inside GROWTH_BOUNDS; GROWTH_PRIOR until
 * GROWTH_MIN_POSTS posts have two. The early read is shown only: a lagged one would steepen the slope, and with it every lone
 * read's projection to 72 h.
 */
export function growthOf(rows: readonly Pick<InsightRow, "reads">[]): number {
  const slopes: number[] = [];
  for (const row of rows) {
    const use = row.reads.filter((r) => r.views !== null && r.ageH >= MEASURED_FROM_H).sort((a, b) => a.ageH - b.ageH);
    if (use.length < 2) continue;
    const a = use[0];
    const b = use[use.length - 1];
    if (b.ageH <= a.ageH) continue;
    slopes.push((lnv(b.views as number) - lnv(a.views as number)) / (Math.log(b.ageH) - Math.log(a.ageH)));
  }
  if (slopes.length < GROWTH_MIN_POSTS) return GROWTH_PRIOR;
  return Math.max(GROWTH_BOUNDS.min, Math.min(GROWTH_BOUNDS.max, median(slopes) as number));
}

/* ------------------------------------------------------------------ the usual and the score */

/** A measured post of a channel and lane: when it was published (ms) and its views at 72 h. */
export interface MeasuredPoint {
  publishedAt: number;
  views72: number;
}

export type Usual = { usual: number; n: number } | { usual: null; n: number; why: "fewPosts" | "fewViews" };

/**
 * The usual of a post published at `at` (ms): the median views at 72 h of the channel's last USUAL_POSTS measured posts in
 * its lane published before it, within USUAL_WINDOW_DAYS, and not before `since` (a restart: a metric break, a Postiz label
 * or version change, or the owner's "something changed"). It needs USUAL_MIN_POSTS posts and a median of USUAL_MIN_VIEWS.
 */
export function usualOf(points: readonly MeasuredPoint[], at: number, since: number = Number.NEGATIVE_INFINITY): Usual {
  const from = Math.max(since, at - USUAL_WINDOW_DAYS * DAY_MS);
  const last = points.filter((p) => p.publishedAt < at && p.publishedAt >= from).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, USUAL_POSTS);
  if (last.length < USUAL_MIN_POSTS) return { usual: null, n: last.length, why: "fewPosts" };
  const m = median(last.map((p) => p.views72)) as number;
  return m < USUAL_MIN_VIEWS ? { usual: null, n: last.length, why: "fewViews" } : { usual: m, n: last.length };
}

/** The score of a post under SCORE_RULE 1: ln((views at 72 h + 1) / (usual + 1)), clipped at plus or minus ln 10. */
export function scoreOf(views72: number, usual: number): number {
  const s = Math.log((views72 + 1) / (usual + 1));
  return Math.max(-SCORE_CLIP, Math.min(SCORE_CLIP, s));
}

/** What the numbers say of one channel post: scored, measured without a usual yet, pending, or left out with its reason. */
export type PostMeasure = {
  postId: string;
  channelId: string;
  platform: string;
  lane: InsightLane;
  publishedAt: number | null;
} & (
  | { state: "scored"; views72: number; via: "line" | "projected"; usual: number; score: number }
  | { state: "unscored"; views72: number; via: "line" | "projected"; why: "fewPosts" | "fewViews"; n: number }
  | { state: "pending" }
  | { state: "excluded"; why: PostExclusion; views72?: number }
);

/** The date a platform's numbers are comparable from (METRIC_BREAKS), as ms. */
function breakOf(platform: string): number {
  const family = platformFamily(platform);
  const day = family === "instagram" ? METRIC_BREAKS.instagram : family === "youtube" ? METRIC_BREAKS.youtube : null;
  return day ? Date.parse(`${day}T00:00:00Z`) : Number.NEGATIVE_INFINITY;
}

/**
 * Every row's measure at `now` (ms), under SCORE_RULE: views at 72 h by the channel's growth, the usual of its channel and
 * lane, and the score. `since` restarts a channel's usual (a channel id to an ISO time). YouTube and other platforms are
 * measured and shown, never scored; TikTok is scored here and the learner leaves out what was posted Only me.
 */
export function measureRows(rows: readonly InsightRow[], now: number, since: Readonly<Record<string, string>> = {}): PostMeasure[] {
  const byChannel = new Map<string, InsightRow[]>();
  for (const row of rows) byChannel.set(row.channelId, [...(byChannel.get(row.channelId) ?? []), row]);
  const out: PostMeasure[] = [];
  const points = new Map<string, MeasuredPoint[]>(); // channel|lane -> measured points
  const finals = new Map<string, { views72: number; via: "line" | "projected" }>();
  for (const [channelId, list] of byChannel) {
    const growth = growthOf(list);
    for (const row of list) {
      const published = parseIso(row.publishedAt);
      if (published === null || row.state === "excluded") continue;
      const at = viewsAt72(row.reads, (now - published) / HOUR_MS, growth);
      if (at.state !== "final") continue;
      finals.set(row.postId + "|" + channelId, { views72: at.views, via: at.via });
      if (published < breakOf(row.platform)) continue;
      const key = `${channelId}|${row.lane}`;
      points.set(key, [...(points.get(key) ?? []), { publishedAt: published, views72: at.views }]);
    }
  }
  const sorted = [...rows].sort((a, b) => (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0));
  for (const row of sorted) {
    const published = parseIso(row.publishedAt);
    const base = { postId: row.postId, channelId: row.channelId, platform: row.platform, lane: row.lane, publishedAt: published };
    const family = platformFamily(row.platform);
    const final = finals.get(row.postId + "|" + row.channelId);
    const shown = final ? { views72: final.views72 } : {};
    if (row.state === "excluded") out.push({ ...base, state: "excluded", why: row.excluded ?? "error" });
    else if (published === null) out.push({ ...base, state: "pending" });
    else if (!final && row.state === "missing") out.push(now - published > MEASURED_UNTIL_H * HOUR_MS ? { ...base, state: "excluded", why: "draft" } : { ...base, state: "pending" });
    else if (family === "youtube") out.push({ ...base, state: "excluded", why: "youtube", ...shown });
    else if (family === "other") out.push({ ...base, state: "excluded", why: "platform", ...shown });
    else if (published < breakOf(row.platform)) out.push({ ...base, state: "excluded", why: "beforeBreak", ...shown });
    else if (!final) {
      const notMeasured = now - published > MEASURED_UNTIL_H * HOUR_MS;
      out.push(notMeasured ? { ...base, state: "excluded", why: row.state === "noAnswer" ? "noAnswer" : "notMeasured" } : { ...base, state: "pending" });
    } else {
      const restart = parseIso(since[row.channelId]) ?? Number.NEGATIVE_INFINITY;
      const usual = usualOf(points.get(`${row.channelId}|${row.lane}`) ?? [], published, restart);
      out.push(usual.usual === null ? { ...base, state: "unscored", views72: final.views72, via: final.via, why: usual.why, n: usual.n } : { ...base, state: "scored", views72: final.views72, via: final.via, usual: usual.usual, score: scoreOf(final.views72, usual.usual) });
    }
  }
  return out;
}

/** Of a measure list, how many posts each channel has measured in each lane (for "Learning your usual: 3 of 5"). */
export function measuredCounts(measures: readonly PostMeasure[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of measures) if (m.state === "scored" || m.state === "unscored") out.set(`${m.channelId}|${m.lane}`, (out.get(`${m.channelId}|${m.lane}`) ?? 0) + 1);
  return out;
}

// --- end learner ---
