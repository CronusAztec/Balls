import { describe, expect, it } from "vitest";
import {
  INSIGHT_METRICS,
  LABELS,
  POST_EXCLUSIONS,
  ROW_EXCLUSIONS,
  channelWaits,
  dueReads,
  growthOf,
  hashText,
  measureRows,
  measuredCounts,
  median,
  metricOfLabel,
  noAnswerAt3Days,
  normalCdf,
  platformFamily,
  pruneInsightRows,
  readOfAnswer,
  sanitizeInsightRow,
  scoreOf,
  seededDraws,
  usualOf,
  viewsAt72,
  windowDue,
  type InsightRead,
  type InsightRow,
} from "@/lib/insights/stats";
import { GROWTH_PRIOR, INSIGHT_ROWS_MAX, NO_ANSWER_TRIES, SCORE_CLIP, SCORE_RULE, USUAL_MIN_POSTS, USUAL_POSTS } from "@/lib/insights/learnerRules";
import { hashString, seededRandom } from "@/lib/bot/planner";
import { familyOf } from "@/lib/desktop/socialCard";
import { importsOf, mainBundleInputs, valueImportsOutside } from "./mainBundle";

/*
 * --- learner --- The numbers on the PC (lib/insights/stats.ts): Postiz's labels, the rows as the app stores them, when a post
 * is read, views at exactly 72 h from the reads either side, the channel's usual and the score under its rule. Pure: every
 * moment is passed in.
 */

// --- learner ---

const H = 3_600_000;
const T0 = Date.parse("2026-10-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const read = (ageH: number, views: number | null, publishedAt = T0): InsightRead => ({ at: iso(publishedAt + ageH * H), ageH, views, reach: null, likes: null, comments: null, shares: null, saves: null });
const row = (over: Partial<InsightRow> = {}): InsightRow => ({ postId: "p1", channelId: "ig1", platform: "instagram", lane: "normal", publishedAt: iso(T0), state: "ok", reads: [], tries: null, ...over });

describe("the shared helpers", () => {
  it("hashes and draws as the planner does (one seed, one sequence everywhere)", () => {
    for (const text of ["", "a", "2026-10-29|n0.length.standard.short|3", "żółć"]) expect(hashText(text)).toBe(hashString(text));
    const a = seededDraws(12345);
    const b = seededRandom(12345);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it("reads Postiz's provider identifiers as the approval card does", () => {
    for (const id of ["instagram", "instagram-standalone", "tiktok", "youtube", "x", "linkedin", "tiktok-business", "threads"]) expect(platformFamily(id)).toBe(familyOf(id));
  });

  it("has a normal distribution function and a median", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(0.8416212)).toBeCloseTo(0.8, 6);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 6);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("Postiz's labels", () => {
  it("keeps the six numbers, spelling aside, and nothing else", () => {
    expect(Object.values(LABELS).sort()).toEqual([...INSIGHT_METRICS].sort());
    expect(metricOfLabel("Views")).toBe("views");
    expect(metricOfLabel(" VIEWS ")).toBe("views");
    expect(metricOfLabel("Saves")).toBe("saves");
    expect(metricOfLabel("Favorites")).toBeNull();
    expect(metricOfLabel(7)).toBeNull();
  });

  it("an empty answer is no read (no answer, never zero), and a missing total stays null", () => {
    expect(readOfAnswer([], iso(T0), 72).read).toBeNull();
    expect(readOfAnswer(null, iso(T0), 72).read).toBeNull();
    const { read: r, unknownLabels } = readOfAnswer(
      [
        { label: "Views", data: [{ total: "120", date: "2026-10-04" }] },
        { label: "Likes", data: [{ total: 7 }] },
        { label: "Favorites", data: [{ total: 3 }] },
        { label: "Shares", data: [] },
      ],
      iso(T0),
      72,
    );
    expect(r).toMatchObject({ views: 120, likes: 7, shares: null, saves: null, reach: null });
    expect(unknownLabels).toEqual(["Favorites"]);
    // only unknown labels: still no read
    expect(readOfAnswer([{ label: "Plays", data: [{ total: 5 }] }], iso(T0), 72).read).toBeNull();
    // the app's own series (desktop/src/social/postiz.ts PostizAnalyticsSeries): its total first
    const app = readOfAnswer([{ label: "Views", total: 2400, data: [{ date: "2026-10-04", total: 2400 }] }, { label: "Saves", total: null, data: [] }], iso(T0), 72).read;
    expect(app).toMatchObject({ views: 2400, saves: null });
  });
});

describe("the rows as the app stores them", () => {
  it("keeps a closed shape and drops what it does not know", () => {
    const raw = { ...row({ reads: [read(80, 100), read(20, 10), read(170, 300), read(30, 20)] }), name: "My channel", text: "hello" };
    const clean = sanitizeInsightRow(raw)!;
    expect(Object.keys(clean).sort()).toEqual(["channelId", "lane", "platform", "postId", "publishedAt", "reads", "state", "tries"]);
    expect(clean.reads.map((r) => r.ageH)).toEqual([20, 30, 80]); // at most 3, in age order
    expect(sanitizeInsightRow({ ...row(), postId: "a b" })).toBeNull();
    expect(sanitizeInsightRow({ ...row(), lane: "story" })).toBeNull();
    expect(sanitizeInsightRow({ ...row(), platform: "Instagram!" })).toBeNull();
    expect(sanitizeInsightRow([])).toBeNull();
  });

  it("a total that is not a count becomes null, never 0", () => {
    const clean = sanitizeInsightRow({ ...row(), reads: [{ ...read(72, 50), views: -3, likes: Number.NaN, shares: "9", saves: 4.6 }] })!;
    expect(clean.reads[0]).toMatchObject({ views: null, likes: null, shares: null, saves: 5 });
  });

  it("a row left out keeps a closed reason; the tries are bounded", () => {
    expect(sanitizeInsightRow({ ...row(), state: "excluded", excluded: "deleted" })!.excluded).toBe("deleted");
    expect(sanitizeInsightRow({ ...row(), state: "excluded", excluded: "hacked" })!.excluded).toBe("error");
    expect(sanitizeInsightRow({ ...row(), tries: { window: "day3", n: 99, lastAt: iso(T0) } })!.tries).toEqual({ window: "day3", n: NO_ANSWER_TRIES, lastAt: iso(T0) });
    expect(sanitizeInsightRow({ ...row(), tries: { window: "month", n: 1, lastAt: iso(T0) } })!.tries).toBeNull();
    expect(ROW_EXCLUSIONS.every((r) => (POST_EXCLUSIONS as readonly string[]).includes(r))).toBe(true);
  });

  it("keeps at most 1000 rows, none older than 180 days, YouTube's none older than 30", () => {
    const now = T0;
    const rows = [row({ postId: "old", publishedAt: iso(now - 181 * 24 * H) }), row({ postId: "yt", platform: "youtube", publishedAt: iso(now - 31 * 24 * H) }), row({ postId: "yt2", platform: "youtube", publishedAt: iso(now - 29 * 24 * H) }), row({ postId: "new", publishedAt: iso(now - H) }), row({ postId: "unpublished", publishedAt: null })];
    expect(pruneInsightRows(rows, now).map((r) => r.postId).sort()).toEqual(["new", "unpublished", "yt2"]);
    const many = Array.from({ length: INSIGHT_ROWS_MAX + 20 }, (_, i) => row({ postId: `p${i}`, publishedAt: iso(now - i * H) }));
    const kept = pruneInsightRows(many, now);
    expect(kept).toHaveLength(INSIGHT_ROWS_MAX);
    expect(kept[0].postId).toBe("p0");
  });
});

describe("when a post is read", () => {
  it("reads the early, the 3-day and the week window, and catches a missed 3-day read up until 168 h", () => {
    expect(windowDue([], 10)).toBeNull();
    expect(windowDue([], 20)).toBe("early");
    expect(windowDue([read(20, 5)], 30)).toBeNull();
    expect(windowDue([read(20, 5)], 50)).toBeNull();
    expect(windowDue([read(20, 5)], 61)).toBe("day3");
    expect(windowDue([read(20, 5)], 120)).toBe("day3"); // the app was closed: caught up
    expect(windowDue([read(20, 5), read(70, 40)], 120)).toBeNull();
    expect(windowDue([read(20, 5), read(70, 40)], 150)).toBe("week");
    expect(windowDue([read(20, 5)], 150)).toBe("day3"); // one read serves both
    expect(windowDue([read(20, 5), read(70, 40), read(150, 60)], 200)).toBeNull();
    expect(windowDue([read(20, 5), read(70, 40)], 300)).toBeNull();
  });

  it("oldest first, within the hour's budget, never twice within an hour, never a left-out row or a blocked channel", () => {
    const now = T0 + 70 * H;
    const rows = [
      row({ postId: "a", publishedAt: iso(T0) }), // 70 h: day3
      row({ postId: "b", publishedAt: iso(T0 - 2 * H) }), // 72 h: day3, older
      row({ postId: "c", publishedAt: iso(T0), reads: [read(69.5, 10)] }), // read 30 minutes ago
      row({ postId: "d", publishedAt: iso(T0), state: "excluded", excluded: "deleted" }),
      row({ postId: "e", channelId: "tt1", platform: "tiktok", publishedAt: iso(T0) }),
      row({ postId: "f", publishedAt: null }),
    ];
    expect(dueReads(rows, now, { callsLeft: 10 }).map((d) => d.postId)).toEqual(["b", "a", "e"]);
    expect(dueReads(rows, now, { callsLeft: 1 }).map((d) => d.postId)).toEqual(["b"]);
    expect(dueReads(rows, now, { callsLeft: 10, blocked: new Set(["tt1"]) }).map((d) => d.postId)).toEqual(["b", "a"]);
    expect(dueReads(rows, now, { callsLeft: 0 })).toEqual([]);
  });

  it("an empty answer is tried again 2 hours later, at most 3 times in its window", () => {
    const now = T0 + 80 * H;
    const tried = (n: number, agoH: number) => row({ tries: { window: "day3", n, lastAt: iso(now - agoH * H) } });
    expect(dueReads([tried(1, 1.5)], now, { callsLeft: 5 })).toEqual([]);
    expect(dueReads([tried(1, 2.5)], now, { callsLeft: 5 })).toHaveLength(1);
    expect(dueReads([tried(NO_ANSWER_TRIES, 5)], now, { callsLeft: 5 })).toEqual([]);
    // the next window starts its own tries
    expect(dueReads([row({ tries: { window: "early", n: 3, lastAt: iso(now - 50 * H) } })], now, { callsLeft: 5 })).toHaveLength(1);
  });

  it("a channel waits 6 hours after 3 empty or failed reads in a row", () => {
    expect(channelWaits({ failures: 2, lastAt: iso(T0) }, T0 + H)).toBe(false);
    expect(channelWaits({ failures: 3, lastAt: iso(T0) }, T0 + H)).toBe(true);
    expect(channelWaits({ failures: 3, lastAt: iso(T0) }, T0 + 7 * H)).toBe(false);
    expect(channelWaits(undefined, T0)).toBe(false);
  });
});

describe("views at exactly 72 h", () => {
  it("from reads at 30, 70 and 170 h: 170 h is past what a score may rest on, so 70 h projected with the growth", () => {
    const r = viewsAt72([read(30, 400), read(70, 900), read(170, 2000)], 200);
    expect(r.state).toBe("final");
    if (r.state !== "final") return;
    expect(r.via).toBe("projected");
    expect(r.views).toBeCloseTo(Math.exp(Math.log(901) + GROWTH_PRIOR * Math.log(72 / 70)) - 1, 6);
  });

  it("a read either side of 72 h: the straight line on log(views + 1) against log(age)", () => {
    const r = viewsAt72([read(30, 400), read(70, 900), read(100, 1300)], 101);
    expect(r).toMatchObject({ state: "final", via: "line", ageH: 100 });
    if (r.state !== "final") return;
    const t = (Math.log(72) - Math.log(70)) / (Math.log(100) - Math.log(70));
    expect(r.views).toBeCloseTo(Math.exp(Math.log(901) + t * (Math.log(1301) - Math.log(901))) - 1, 6);
    // the line is the hour's, not the read's: a read at 68 h and one at 84 h land between them
    const between = viewsAt72([read(68, 1000), read(84, 1200)], 85);
    expect(between.state === "final" && between.views > 1000 && between.views < 1200).toBe(true);
  });

  it("one read only: projected with the channel's growth; a read at exactly 72 h is the value", () => {
    const one = viewsAt72([read(80, 500)], 81, 0.5);
    expect(one.state === "final" && one.via === "projected").toBe(true);
    if (one.state === "final") expect(one.views).toBeCloseTo(Math.exp(Math.log(501) + 0.5 * Math.log(72 / 80)) - 1, 6);
    expect(viewsAt72([read(72, 500)], 73)).toMatchObject({ state: "final", views: 500 });
  });

  it("waits while a better read can come, and gives up past 168 h without a read between 48 h and 168 h", () => {
    expect(viewsAt72([read(50, 300)], 55)).toEqual({ state: "pending" });
    expect(viewsAt72([read(50, 300)], 169).state).toBe("final");
    expect(viewsAt72([read(30, 300)], 100)).toEqual({ state: "pending" });
    expect(viewsAt72([read(30, 300), read(200, 900)], 201)).toEqual({ state: "notMeasured" });
    expect(viewsAt72([read(70, null)], 75)).toEqual({ state: "pending" }); // an unread total is no read
  });

  it("the channel's growth: the prior until 5 posts have two reads from 48 h on, then their median slope", () => {
    expect(growthOf([])).toBe(GROWTH_PRIOR);
    const posts = [0.2, 0.3, 0.4, 0.5, 0.6].map((g) => ({ reads: [read(60, 99), read(180, Math.exp(Math.log(100) + g * Math.log(3)) - 1)] }));
    expect(growthOf(posts)).toBeCloseTo(0.4, 6);
    expect(growthOf(posts.slice(0, 4))).toBe(GROWTH_PRIOR);
    // an early read and a 3-day read are one read the slope may use: still the prior
    expect(growthOf([0.2, 0.3, 0.4, 0.5, 0.6].map((g) => ({ reads: [read(24, 99), read(72, Math.exp(Math.log(100) + g * Math.log(3)) - 1)] })))).toBe(GROWTH_PRIOR);
  });

  // Meta's numbers can lag up to 48 h, so the early read (18-36 h) is shown only: true views 1000 * (age / 72)^0.35, the early
  // read half in at 24 h, as the review's probe had it
  it("a lagged early read moves neither the views at 72 h nor the channel's growth", () => {
    const truth = (ageH: number) => 1000 * Math.pow(ageH / 72, 0.35);
    const lagged = read(24, Math.round(truth(24) * 0.5));
    for (const day3 of [62, 72, 84, 96]) {
      const without = viewsAt72([read(day3, truth(day3))], day3 + 1);
      const withEarly = viewsAt72([lagged, read(day3, truth(day3))], day3 + 1);
      expect(withEarly, `3-day read at ${day3} h`).toEqual(without);
      expect(withEarly.state === "final" && Math.round(withEarly.views)).toBe(1000);
    }
    // a late 3-day read with a week read past it: no read from 48 h up to 72 h, so the 3-day read is projected, never joined to
    // the early one by a line
    const late = viewsAt72([lagged, read(90, truth(90)), read(150, truth(150))], 151);
    expect(late).toMatchObject({ state: "final", via: "projected", ageH: 90 });
    if (late.state === "final") expect(Math.round(late.views)).toBe(1000);
    // the 3-day read caught up at 110 h: final at once (no read nearer 72 h can come), not held back for want of a read below
    const caughtUp = viewsAt72([lagged, read(110, truth(110))], 111);
    expect(caughtUp).toMatchObject({ state: "final", via: "projected", ageH: 110 });
    if (caughtUp.state === "final") expect(Math.round(caughtUp.views)).toBe(1000);
    const posts = Array.from({ length: 6 }, () => ({ reads: [read(24, Math.round(truth(24) * 0.5)), read(62, truth(62)), read(150, truth(150))] }));
    expect(growthOf(posts)).toBeCloseTo(0.35, 3); // the lagged early reads alone gave 0.727 (the review's probe)
    expect(growthOf(posts)).toBe(growthOf(posts.map((p) => ({ reads: p.reads.slice(1) }))));
  });
});

describe("the usual and the score", () => {
  const points = (views: number[], from = T0) => views.map((v, i) => ({ publishedAt: from + i * 24 * H, views72: v }));

  it("the median of the channel's last 20 measured posts before the post, within 120 days", () => {
    expect(usualOf(points([100, 200, 300, 400]), T0 + 30 * 24 * H)).toEqual({ usual: null, n: 4, why: "fewPosts" });
    expect(usualOf(points([100, 200, 300, 400, 500]), T0 + 30 * 24 * H)).toEqual({ usual: 300, n: 5 });
    expect(usualOf(points([1, 2, 3, 4, 5, 6]), T0 + 30 * 24 * H)).toEqual({ usual: null, n: 6, why: "fewViews" });
    // only posts published before it
    expect(usualOf(points([100, 200, 300, 400, 500, 9000]), T0 + 5 * 24 * H)).toEqual({ usual: 300, n: 5 });
    // the last 20
    const long = points([...Array.from({ length: 10 }, () => 10_000), ...Array.from({ length: USUAL_POSTS }, () => 50)]);
    expect(usualOf(long, T0 + 60 * 24 * H)).toEqual({ usual: 50, n: USUAL_POSTS });
    // 120 days, and a restart
    expect(usualOf(points([100, 200, 300, 400, 500]), T0 + 130 * 24 * H).n).toBe(0);
    expect(usualOf(points([100, 200, 300, 400, 500, 600, 700]), T0 + 30 * 24 * H, T0 + 2 * 24 * H)).toEqual({ usual: 500, n: USUAL_MIN_POSTS });
  });

  it("s = ln((views + 1) / (usual + 1)), clipped at ln 10 so one 30x hit cannot decide a test", () => {
    expect(scoreOf(0, 0)).toBe(0);
    expect(scoreOf(99, 99)).toBe(0);
    expect(scoreOf(199, 99)).toBeCloseTo(Math.log(2), 12);
    expect(scoreOf(30 * 100, 99)).toBe(SCORE_CLIP);
    expect(scoreOf(0, 999)).toBe(-SCORE_CLIP);
    expect(SCORE_RULE).toBe(1);
  });

  it("measures every row: scored, unscored before the usual, pending, and the reasons a post is left out", () => {
    const now = T0 + 30 * 24 * H;
    const day = 24 * H;
    const history = Array.from({ length: 6 }, (_, i) => row({ postId: `h${i}`, publishedAt: iso(T0 + i * day), reads: [read(72, 100 * (i + 1), T0 + i * day)] }));
    const rows: InsightRow[] = [
      ...history,
      row({ postId: "new", publishedAt: iso(T0 + 10 * day), reads: [read(72, 700, T0 + 10 * day)] }),
      row({ postId: "yt", channelId: "yt1", platform: "youtube", publishedAt: iso(T0 + 10 * day), reads: [read(72, 50, T0 + 10 * day)] }),
      row({ postId: "x", channelId: "x1", platform: "x", publishedAt: iso(T0 + 10 * day), reads: [read(72, 50, T0 + 10 * day)] }),
      row({ postId: "dead", publishedAt: iso(T0 + 10 * day), state: "excluded", excluded: "error" }),
      row({ postId: "draft", channelId: "tt1", platform: "tiktok", publishedAt: iso(T0 + 10 * day), state: "missing" }),
      row({ postId: "quiet", publishedAt: iso(T0 + 10 * day), state: "noAnswer" }),
      row({ postId: "fresh", publishedAt: iso(now - 10 * H) }),
      row({ postId: "old", publishedAt: "2025-03-01T12:00:00Z", reads: [read(72, 50, Date.parse("2025-03-01T12:00:00Z"))] }),
    ];
    const m = new Map(measureRows(rows, now).map((x) => [x.postId, x]));
    expect(m.get("h0")).toMatchObject({ state: "unscored", why: "fewPosts" });
    expect(m.get("h5")).toMatchObject({ state: "scored", usual: 300 });
    expect(m.get("new")).toMatchObject({ state: "scored", usual: 350, views72: 700 });
    if (m.get("new")!.state === "scored") expect((m.get("new") as { score: number }).score).toBeCloseTo(Math.log(701 / 351), 12);
    expect(m.get("yt")).toMatchObject({ state: "excluded", why: "youtube", views72: 50 });
    expect(m.get("x")).toMatchObject({ state: "excluded", why: "platform" });
    expect(m.get("dead")).toMatchObject({ state: "excluded", why: "error" });
    expect(m.get("draft")).toMatchObject({ state: "excluded", why: "draft" });
    expect(m.get("quiet")).toMatchObject({ state: "excluded", why: "noAnswer" });
    expect(m.get("fresh")).toMatchObject({ state: "pending" });
    expect(m.get("old")).toMatchObject({ state: "excluded", why: "beforeBreak" }); // before Instagram's plays became views
    expect(measuredCounts([...m.values()]).get("ig1|normal")).toBe(7);
  });

  // Postiz answers [] for a post it has no numbers for (no answer, never zero). That was known only at 168 h ("not measured"),
  // so the lab's check of its numbers paused on zeros at the 3-day read but on no answer 4 days later
  it("knows at the 3-day read that a post's numbers will not come: its tries spent, or the row's no answer past 96 h", () => {
    const spent = { window: "day3" as const, n: NO_ANSWER_TRIES, lastAt: iso(T0 + 64 * H) };
    expect(noAnswerAt3Days({ state: "noAnswer", reads: [], tries: spent }, 64)).toBe(true);
    expect(noAnswerAt3Days({ state: "noAnswer", reads: [], tries: { ...spent, n: NO_ANSWER_TRIES - 1 } }, 70)).toBe(false); // a try is left
    expect(noAnswerAt3Days({ state: "noAnswer", reads: [], tries: { window: "early", n: NO_ANSWER_TRIES, lastAt: iso(T0 + 22 * H) } }, 90)).toBe(false); // the 3-day read can still come
    expect(noAnswerAt3Days({ state: "noAnswer", reads: [], tries: null }, 97)).toBe(true);
    expect(noAnswerAt3Days({ state: "ok", reads: [], tries: null }, 97)).toBe(false); // not read yet (the app was closed): not known
    expect(noAnswerAt3Days({ state: "noAnswer", reads: [read(70, 500)], tries: spent }, 100)).toBe(false); // its 3-day read came
    expect(noAnswerAt3Days({ state: "excluded", reads: [], tries: spent }, 100)).toBe(false);
    // a measure carries it while pending, and "no answer" stays the reason after 168 h, as before
    const quiet = row({ postId: "quiet", state: "noAnswer", tries: spent });
    expect(measureRows([quiet], T0 + 70 * H)[0]).toMatchObject({ state: "pending", noAnswer: true });
    expect(measureRows([quiet], T0 + 170 * H)[0]).toMatchObject({ state: "excluded", why: "noAnswer" });
    expect(measureRows([row({ postId: "fresh" })], T0 + 70 * H)[0]).toEqual({ postId: "fresh", channelId: "ig1", platform: "instagram", lane: "normal", publishedAt: T0, state: "pending" });
  });

  it("scores are worked out on load: the same stored rows score anew under a restart, nothing is frozen in a row", () => {
    const day = 24 * H;
    const rows = Array.from({ length: 12 }, (_, i) => row({ postId: `p${String(i).padStart(2, "0")}`, publishedAt: iso(T0 + i * day), reads: [read(72, i < 6 ? 100 : 1000, T0 + i * day)] }));
    const now = T0 + 30 * day;
    const before = measureRows(rows, now).find((m) => m.postId === "p11")!;
    const after = measureRows(rows, now, { ig1: iso(T0 + 5.5 * day) }).find((m) => m.postId === "p11")!;
    expect(before).toMatchObject({ state: "scored", usual: 100 }); // 6 posts at 100 and 5 at 1000 before it
    expect(after).toMatchObject({ state: "scored", usual: 1000 }); // only the 5 since the restart
    const p10 = measureRows(rows, now).find((m) => m.postId === "p10")!;
    const p10Restarted = measureRows(rows, now, { ig1: iso(T0 + 5.5 * day) }).find((m) => m.postId === "p10")!;
    expect(p10).toMatchObject({ state: "scored", usual: 100 });
    expect(p10Restarted).toMatchObject({ state: "unscored", why: "fewPosts", n: 4 });
    // the rows themselves hold raw reads only
    for (const r of rows) expect(Object.keys(r).some((k) => /score|usual/i.test(k))).toBe(false);
  });
});

describe("what the app's main process bundles", () => {
  // the main process keeps the rows (social-insights.json): the score's rules come along, nothing of the page
  it("stats.ts loads values only from the learner's rules, and the rules import nothing", async () => {
    expect(valueImportsOutside("src/lib/insights/stats.ts", ["./learnerRules"])).toEqual([]);
    expect(await mainBundleInputs("src/lib/insights/stats.ts")).toEqual(["src/lib/insights/learnerRules.ts", "src/lib/insights/stats.ts"]);
    expect(importsOf("src/lib/insights/learnerRules.ts")).toEqual([]);
  });
});

// --- end learner ---
