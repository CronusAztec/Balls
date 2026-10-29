import type { EndingStyle, LengthBucket } from "@/lib/bot/playbook";
import { checkArms, type ArmPlanner, type FeasibilityResult, type LearnerTemplate } from "@/lib/insights/feasibility";
import { learnPass, type LearnerChannel, type LearnerDecision, type LearnerInput, type LearnerPost, type PassPlan } from "@/lib/insights/learner";
import { DEFAULT_LEARNER, type LearnerSettings } from "@/lib/insights/learnerSettings";
import { SCORE_CLIP } from "@/lib/insights/learnerRules";
import { seededDraws, type InsightRead, type InsightRow, type InsightTries } from "@/lib/insights/stats";

/*
 * --- learner --- Seeded worlds for the learner's tests (tests/insightsLearner.test.ts, tests/insightsFeasibility.test.ts): a
 * catalog of ready templates shaped like lib/bot/templates.ts's (with the Journey and Spiral Glass ready, as in AI studio
 * step 2), an input builder, and a world that runs learnPass day by day the way the app will: it proposes the day's slots,
 * "posts" them, and Postiz's numbers come in through timed reads that the app may miss while it is closed.
 *
 * The toy world is the plan's (sim/l0.py): a clip's score is a shared day effect (30 % of the variance at a spread of 1.0) plus
 * its own noise plus its arm's true effect, 1 % of clips a 30x hit; each channel post adds a little noise of its own; views
 * grow with age as age^g, g ~ N(0.35, 0.10) per post. Everything is seeded: the same seed is the same world.
 */

// --- learner ---

export const H = 3_600_000;
export const DAY = 24 * H;

const both: EndingStyle[] = ["resolved", "cliffhanger"];
const all: LengthBucket[] = ["short", "standard", "long"];
const T = (id: string, format: string, mode: string, buckets: LengthBucket[], endings: EndingStyle[], family: LearnerTemplate["family"] = "escape", extra: Partial<LearnerTemplate> = {}): LearnerTemplate => ({ id, format, mode, family, buckets, endings, ...extra });

/** Ready templates as in AI studio step 2: the Journey and Spiral Glass resolved only (and newcomers), a battle template. */
export const CATALOG: LearnerTemplate[] = [
  T("get-out-classic", "getOut", "classic", all, both),
  T("get-out-portal", "getOut", "portal", ["short", "standard"], ["cliffhanger"]),
  T("get-out-glass", "getOut", "glass", all, both, "rhythm"),
  T("get-out-journey", "getOut", "journey", ["short", "standard"], ["resolved"]),
  T("smash-power-layers", "smash", "powerLayers", all, both),
  T("smash-spiral-glass", "smash", "spiralGlass", ["short", "standard"], ["resolved"]),
  T("fill-grow", "fill", "grow", ["short", "standard"], ["resolved"]),
  T("count-multiply", "count", "multiply", all, ["resolved"]),
  T("line-up-pendulum", "lineUp", "pendulum", all, ["resolved"], "rhythm"),
  T("who-wins-battle", "whoWins", "battle", ["standard"], both, "battle"),
];

export const IG: LearnerChannel = { id: "ig1", platform: "instagram", trialReels: true };
export const TT: LearnerChannel = { id: "tt1", platform: "tiktok", trialReels: false };
export const YT: LearnerChannel = { id: "yt1", platform: "youtube", trialReels: false };

export const ON: LearnerSettings = { ...DEFAULT_LEARNER, learn: true, autoShareOff: true, fixed: {}, skipped: [] };

/** A seeded standard normal (Box-Muller over seededDraws). */
export function normals(seed: number): () => number {
  const u = seededDraws(seed);
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

export const iso = (ms: number) => new Date(ms).toISOString();
export const dateOf = (ms: number) => iso(ms).slice(0, 10);

/** A stand-in planner: every plan passes every rule gate, at a pick score of 70. */
export const passAll: ArmPlanner = () => ({ pass: true, pick: 70 });

export interface WorldOptions {
  seed: number;
  /** The true effect of each arm (a log ratio), by what the clip was rendered with and when it went out (`at`, ms). */
  effect: (post: { bucket: LengthBucket; ending: EndingStyle; template: string; lane: "normal" | "trialReel"; at: number }) => number;
  channels?: LearnerChannel[];
  perDay?: number;
  settings?: LearnerSettings;
  /** Each read is missed with this probability (the app closed). */
  miss?: number;
  /** This share of channel posts is left out (an error at publish time). */
  excl?: number;
  /** The days the world runs at most. */
  days?: number;
  /** Stop at the first verdict whose dial is this one... */
  stopAt?: LearnerDecision["dial"];
  /** ...or the first verdict this says yes to. */
  until?: (v: LearnerDecision) => boolean;
  /** The decision log the world starts from. */
  decisions?: LearnerDecision[];
  planner?: ArmPlanner;
  /** Days of history (best clips, before learning) per channel: their usual. */
  history?: number;
  start?: number;
  /** Postiz answers 0 for every Trial Reel total (whether a Trial Reel's numbers come through Postiz is the plan's open question). */
  zeroTrials?: boolean;
  /** Quiet hours (the world's default: 23:00 to 07:00). */
  quiet?: { from: string; to: string };
  /** The PC's UTC offset at a moment (minutes east): slots go out at their local window, and learnPass is given it. UTC when absent. */
  offsetMinAt?: (at: number) => number;
  /**
   * Postiz answers [] for every Trial Reel (no answer): no read ever comes, and the app's tries are spent as the main process
   * spends them, three 2 hours apart in each window: the early window's by 22 h, the 3-day window's by 64 h.
   */
  noTrialAnswer?: boolean;
  /** The owner's settings from a day on (null: `settings`). */
  settingsAt?: (day: number) => LearnerSettings | null;
  /** The ready templates on a day (an app update can take a template's readiness away). */
  catalogAt?: (day: number) => LearnerTemplate[];
}

export interface WorldResult {
  decisions: LearnerDecision[];
  /** Days from the first test post to the first stopping verdict (null: none). */
  days: number | null;
  plans: PassPlan[];
  posts: LearnerPost[];
  rows: InsightRow[];
  input: LearnerInput;
}

/** The reads a post gets: early, 3-day (else a catch-up), week; each missed with `miss`. Views ~ v72 (age/72)^g. */
function readsOf(publishedAt: number, v72: number, g: number, miss: number, u: () => number): InsightRead[] {
  const ages: number[] = [];
  if (u() >= miss) ages.push(18 + u() * 18);
  if (u() >= miss) ages.push(60 + u() * 24);
  else if (u() >= miss) ages.push(96 + u() * 72);
  if (u() >= miss) ages.push(144 + u() * 96);
  return ages.map((ageH) => ({ at: iso(publishedAt + ageH * H), ageH: Math.round(ageH * 100) / 100, views: Math.round(Math.max(0, (v72 + 1) * Math.pow(ageH / 72, g) - 1)), reach: null, likes: null, comments: null, shares: null, saves: null }));
}

/**
 * Runs learnPass once a day (at 09:00 UTC) for `days` days: each day's slots are posted at their windows, their reads arrive
 * as the days pass, and the verdicts are written to the log. Feasibility is planned with `planner` whenever a pass asks.
 */
export function runWorld(o: WorldOptions): WorldResult {
  const z = normals(o.seed);
  const u = seededDraws(o.seed ^ 0x2545f491);
  const channels = o.channels ?? [IG, TT];
  const perDay = o.perDay ?? 3;
  const settings = o.settings ?? { ...ON, trialReels: false };
  const miss = o.miss ?? 0;
  const excl = o.excl ?? 0;
  const start = o.start ?? Date.parse("2026-11-01T09:00:00Z");
  const usualViews = 500;
  const allRows: { row: InsightRow; reads: InsightRead[]; noAnswer?: boolean }[] = [];
  /** A row as the app holds it at `now`: the reads taken by then, and an unanswered post's spent tries. */
  const rowAt = ({ row, reads, noAnswer }: (typeof allRows)[number], now: number): InsightRow => {
    if (!noAnswer) return { ...row, reads: reads.filter((r) => Date.parse(r.at) <= now) };
    const published = Date.parse(row.publishedAt!);
    const spent = (window: InsightTries["window"], h: number): InsightTries => ({ window, n: 3, lastAt: iso(published + h * H) });
    const tries = now >= published + 64 * H ? spent("day3", 64) : now >= published + 22 * H ? spent("early", 22) : null;
    return { ...row, reads: [], state: tries ? "noAnswer" : "ok", tries };
  };
  const posts: LearnerPost[] = [];
  let decisions: LearnerDecision[] = [...(o.decisions ?? [])];
  let feasibility: FeasibilityResult[] = [];
  const plans: PassPlan[] = [];
  let clipN = 0;
  const post = (approvedAt: number, at: number, template: string, bucket: LengthBucket, ending: EndingStyle, chs: { id: string; lane: "normal" | "trialReel" }[], membership: LearnerPost["test"], dayEffect: number) => {
    const clipId = `c${String(clipN++).padStart(5, "0")}`;
    const lane = chs[0]?.lane ?? "normal";
    const own = z() * Math.sqrt(0.7) + (u() < 0.01 ? Math.log(30) : 0) + o.effect({ bucket, ending, template, lane, at });
    for (const c of chs) {
      const ch = channels.find((x) => x.id === c.id)!;
      const postId = `${clipId}-${c.id}`;
      const s = Math.max(-SCORE_CLIP, Math.min(SCORE_CLIP, dayEffect + own + z() * 0.3));
      const v72 = Math.round(usualViews * Math.exp(s));
      const g = 0.35 + z() * 0.1;
      const left = u() < excl;
      posts.push({ postId, channelId: c.id, platform: ch.platform, lane: c.lane, clipId, approvedAt: iso(approvedAt), test: membership, facts: { template, bucket, ending, watermark: "sealed" }, privacy: ch.platform === "tiktok" ? "public" : null });
      const noAnswer = !!o.noTrialAnswer && c.lane === "trialReel" && !left;
      const reads = left || noAnswer ? [] : readsOf(at, v72, g, miss, u).map((r) => (o.zeroTrials && c.lane === "trialReel" ? { ...r, views: 0, reach: 0 } : r));
      allRows.push({ row: { postId, channelId: c.id, platform: ch.platform, lane: c.lane, publishedAt: iso(at), state: left ? "excluded" : "ok", ...(left ? { excluded: "error" as const } : {}), reads: [], tries: null }, reads, noAnswer });
    }
  };
  // the history: best clips before learning, one a day per channel
  for (let d = -(o.history ?? 12); d < 0; d++) post(start + d * DAY + 7 * H, start + d * DAY + 9 * H, "get-out-classic", "standard", "resolved", channels.map((c) => ({ id: c.id, lane: "normal" as const })), null, z() * Math.sqrt(0.3));
  let firstTestAt: number | null = null;
  let days: number | null = null;
  let input: LearnerInput | null = null;
  for (let d = 0; d < (o.days ?? 40); d++) {
    const now = start + d * DAY;
    const rows = allRows.map((r) => rowAt(r, now));
    const make = (): LearnerInput => ({ date: dateOf(now), now, pro: true, settings: o.settingsAt?.(d) ?? settings, rows, posts: [...posts], decisions, channels, catalog: o.catalogAt?.(d) ?? CATALOG, perDay, quiet: o.quiet ?? { from: "23:00", to: "07:00" }, feasibility, ...(o.offsetMinAt ? { offsetMinAt: o.offsetMinAt } : {}) });
    input = make();
    let plan = learnPass(input);
    for (let tries = 0; plan && plan.feasibilityNeeded.length && tries < 6; tries++) {
      feasibility = [...feasibility, ...checkArms(plan.feasibilityNeeded, CATALOG, new Set(plan.joined), o.planner ?? passAll, feasibility)];
      input = make();
      plan = learnPass(input);
    }
    if (!plan) continue;
    plans.push(plan);
    if (plan.verdicts.length) {
      decisions = [...decisions, ...plan.verdicts];
      if (plan.verdicts.some((v) => (o.stopAt && v.dial === o.stopAt) || o.until?.(v))) {
        days = firstTestAt === null ? null : (now - firstTestAt) / DAY;
        break;
      }
    }
    const dayEffect = z() * Math.sqrt(0.3);
    for (const slot of plan.slots) {
      const [hh, mm] = slot.window.from.split(":").map(Number);
      const utc = Date.parse(`${dateOf(now)}T00:00:00Z`) + (hh * 60 + mm + 30) * 60_000;
      const at = utc - (o.offsetMinAt?.(utc) ?? 0) * 60_000; // the local window's time
      if (slot.membership && firstTestAt === null && slot.role !== "best") firstTestAt = at;
      post(now + slot.index * 60_000, at, slot.options.template, slot.options.bucket, slot.options.ending, slot.channels, slot.membership, dayEffect);
    }
  }
  const rows = allRows.map((r) => rowAt(r, Number.POSITIVE_INFINITY));
  return { decisions, days, plans, posts, rows, input: input! };
}

// --- end learner ---
