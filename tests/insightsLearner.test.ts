import { describe, expect, it } from "vitest";
import {
  bestsOf,
  channelsFor,
  checkOrder,
  clipScore,
  dayOfDate,
  findingsOf,
  learnPass,
  learnerRuns,
  parseTestId,
  postOutcome,
  rarelyPasses,
  restsUntil,
  shrunkDifference,
  testIdOf,
  type LearnerDecision,
  type LearnerInput,
  type LearnerPost,
  type Question,
} from "@/lib/insights/learner";
import { dialCall } from "@/lib/insights/lab";
import { CHECK_OLD, CHECK_POSTS, KEEP_P, KEEP_RATIO, NORMAL_TEST_CLIPS, REST_DAYS, REST_TWICE_DAYS, SCORE_CLIP, TEMPLATE_SHARE_MAX } from "@/lib/insights/learnerRules";
import { DEFAULT_LEARNER } from "@/lib/insights/learnerSettings";
import type { PostMeasure } from "@/lib/insights/stats";
import { CATALOG, DAY, H, IG, ON, TT, YT, iso, normals, passAll, runWorld } from "./learnerWorld";
import { checkArms } from "@/lib/insights/feasibility";

/*
 * --- learner --- The learner core (lib/insights/learner.ts): learnPass and what it decides, on seeded worlds. The decision
 * rule's own worlds pin how often a change of a given true size is kept (the plan: 2x at least 45 %, 0.67x at most 5 %, no
 * difference at most 16 %), and the pipeline's worlds run learnPass day by day with reads missed while the app is closed: the
 * horizon moves, the rates hold.
 */

// --- learner ---

const length: Question = { dial: "length", best: "standard", challenger: "short", subject: null };
const T0 = Date.parse("2026-11-01T09:00:00Z");

const verdict = (over: Partial<LearnerDecision> = {}): LearnerDecision => ({ testId: "n0.length.standard.short", lane: "normal", dial: "length", best: "standard", challenger: "short", subject: null, decidedAt: iso(T0), verdict: "kept", ratio: 1.6, p: 0.9, nTest: 8, nBest: 16, scoreRule: 1, ...over });

/** A small input: two days of measured history on Instagram and TikTok, learning on, no Trial Reels. */
function smallInput(over: Partial<LearnerInput> = {}): LearnerInput {
  const world = runWorld({ seed: 7, effect: () => 0, days: 1 });
  return { ...world.input, ...over };
}

describe("when learnPass runs", () => {
  it("returns null with zero rows, without numbers, without Pro, with learning off or paused: today's path runs", () => {
    const input = smallInput();
    expect(learnPass(input)).not.toBeNull();
    expect(learnPass({ ...input, rows: [] })).toBeNull();
    expect(learnPass({ ...input, rows: input.rows.map((r) => ({ ...r, reads: [] })) })).toBeNull();
    expect(learnPass({ ...input, rows: input.rows.map((r) => ({ ...r, reads: r.reads.map((x) => ({ ...x, views: null })) })) })).toBeNull();
    expect(learnPass({ ...input, pro: false })).toBeNull();
    expect(learnPass({ ...input, settings: { ...input.settings, learn: false } })).toBeNull();
    expect(learnPass({ ...input, settings: { ...input.settings, paused: true } })).toBeNull();
    expect(learnPass({ ...input, settings: DEFAULT_LEARNER })).toBeNull(); // learning is off until switched on
    expect(learnerRuns(input)).toBe(true);
  });

  it("the same inputs give the same plan, in whatever order the lists come", () => {
    const world = runWorld({ seed: 11, effect: (p) => (p.bucket === "short" ? 0.5 : 0), days: 9 });
    const input = world.input;
    const a = learnPass(input);
    const b = learnPass(JSON.parse(JSON.stringify(input)));
    const shuffled = { ...input, rows: [...input.rows].reverse(), posts: [...input.posts].reverse(), channels: [...input.channels].reverse(), catalog: [...input.catalog].reverse(), feasibility: [...(input.feasibility ?? [])].reverse() };
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(learnPass(shuffled)).toEqual(a);
  });

  it("changes nothing in the normal lane before a channel has 5 measured posts", () => {
    const fresh = runWorld({ seed: 3, effect: () => 0, days: 1, history: 4 });
    const plan = learnPass(fresh.input)!;
    expect(plan.status.usual.every((u) => !u.ready && u.have < 5 && u.need === 5)).toBe(true);
    expect(plan.test).toBeNull();
    expect(plan.slots.every((s) => s.role === "best" && s.membership === null)).toBe(true);
  });
});

describe("test ids, rests and the log", () => {
  it("a test id parses back to its questions; anything else is refused", () => {
    const n = testIdOf("normal", 3, [length]);
    expect(n).toBe("n3.length.standard.short");
    expect(parseTestId(n)).toMatchObject({ kind: "normal", seq: 3, questions: [length] });
    const newcomer: Question = { dial: "newcomer", best: "rotation", challenger: "newcomer", subject: "get-out-journey" };
    const t = testIdOf("block", 0, [newcomer, length]);
    expect(t).toBe("t0.newcomer.rotation.newcomer.get-out-journey~length.standard.short");
    expect(parseTestId(t)?.questions).toEqual([newcomer, length]);
    const c = testIdOf("check", 4, [], t);
    expect(parseTestId(c)).toMatchObject({ kind: "check", seq: 4, source: { id: t } });
    for (const bad of ["n1.length.standard.standard", "n1.length.standard.bold", "x1.length.standard.short", "n1.newcomer.rotation.newcomer", "t1.length.standard.short~length.standard.long", "c1.c0.n0.length.standard.short", "n1.length.standard.short~ending.resolved.cliffhanger", 5])
      expect(parseTestId(bad), String(bad)).toBeNull();
  });

  it("a question rests 60 days after its verdict, 120 after two losses in a row, forever after Undo; the lab asks a no-clear answer again at once", () => {
    expect(restsUntil(length, [])).toBe(0);
    expect(restsUntil(length, [verdict({ verdict: "notKept" })])).toBe(T0 + REST_DAYS * DAY);
    expect(restsUntil(length, [verdict({ verdict: "notKept", decidedAt: iso(T0 - 70 * DAY) }), verdict({ verdict: "notKept" })])).toBe(T0 + REST_TWICE_DAYS * DAY);
    expect(restsUntil(length, [verdict({ verdict: "kept" })])).toBe(T0 + REST_DAYS * DAY); // asked the other way round only after 60 days
    expect(restsUntil({ ...length, best: "short", challenger: "standard" }, [verdict({ verdict: "kept" })])).toBe(T0 + REST_DAYS * DAY);
    expect(restsUntil(length, [verdict({ verdict: "undone" })])).toBe(Number.POSITIVE_INFINITY);
    expect(restsUntil(length, [verdict({ verdict: "noClearDifference", lane: "trialReel" })])).toBe(0);
    expect(restsUntil(length, [verdict({ verdict: "noClearDifference", lane: "trialReel", decidedAt: iso(T0 - DAY) }), verdict({ verdict: "noClearDifference", lane: "trialReel" })])).toBe(T0 + REST_DAYS * DAY);
    expect(restsUntil(length, [verdict({ verdict: "noClearDifference" })])).toBe(T0 + REST_DAYS * DAY); // the normal lane rests it
  });

  it("each dial's best is today's default, then the log's kept, went-back and undone entries, then the owner's locks", () => {
    expect(bestsOf([], { fixed: {} }).arms).toMatchObject({ length: "standard", ending: "resolved", format: "mix", postTime: "spread" });
    expect(bestsOf([verdict()], { fixed: {} }).arms.length).toBe("short");
    expect(bestsOf([verdict(), verdict({ verdict: "wentBack", decidedAt: iso(T0 + DAY) })], { fixed: {} }).arms.length).toBe("standard");
    expect(bestsOf([verdict(), verdict({ verdict: "undone", decidedAt: iso(T0 + DAY) })], { fixed: {} }).arms.length).toBe("standard");
    expect(bestsOf([verdict()], { fixed: { length: "long" } }).arms.length).toBe("long");
    const joined = bestsOf([verdict({ dial: "newcomer", best: "rotation", challenger: "newcomer", subject: "get-out-journey" })], { fixed: {} }).joined;
    expect([...joined]).toEqual(["get-out-journey"]);
    expect(bestsOf([verdict({ dial: "format", best: "mix", challenger: "aim" })], { fixed: {} }, CATALOG).arms.format).toBe("mix"); // nothing ready to play it
  });

  it("findings are message keys with numbers, newest first, never text", () => {
    const f = findingsOf([verdict({ decidedAt: iso(T0 - DAY), verdict: "notKept", challenger: "long", ratio: 0.71 }), verdict({ ratio: 2.137 })]);
    expect(f[0]).toEqual({ key: "Learner.findings.length.kept", values: { from: "standard", to: "short", ratio: 2.1, nTest: 8, nBest: 16 } });
    expect(f[1].key).toBe("Learner.findings.length.notKept");
  });
});

describe("the decision rule", () => {
  it("keeps at 80 % certainty and a shrunken 1.25x; a newcomer joins unless the rotation clearly beats it", () => {
    const up = Array.from({ length: 8 }, (_, i) => Math.log(2) + (i % 2 ? 0.3 : -0.3));
    const flat = Array.from({ length: 16 }, (_, i) => (i % 2 ? 0.3 : -0.3));
    const { m, sd } = shrunkDifference(up, flat);
    const call = dialCall(m, sd);
    expect(call.keep).toBe(true);
    expect(call.ratio).toBeLessThan(2); // shrunken: the card never shows the raw ratio
    expect(call.ratio).toBeGreaterThanOrEqual(KEEP_RATIO);
    expect(call.p).toBeGreaterThanOrEqual(KEEP_P);
  });

  it("the crew-drop rule closes a test only on a clear gap (learnerRules: 2.58 standard errors, 20 points, 6 attempts each)", () => {
    expect(rarelyPasses({ tries: 6, passed: 3 }, { tries: 6, passed: 6 })).toBe(false); // 50 points, too few to be sure
    expect(rarelyPasses({ tries: 10, passed: 3 }, { tries: 24, passed: 22 })).toBe(true);
    expect(rarelyPasses({ tries: 10, passed: 7 }, { tries: 24, passed: 21 })).toBe(false);
    expect(rarelyPasses({ tries: 5, passed: 0 }, { tries: 24, passed: 24 })).toBe(false);
    expect(rarelyPasses({ tries: 24, passed: 24 }, { tries: 10, passed: 3 })).toBe(false); // only the challenger's arm closes it
  });

  // Pinned: the same seeds give the same worlds. sim/l0.py printed, at 3 clips a day with every read in: 2x 0.68, 1.5x 0.40,
  // no difference 0.11, 0.67x 0.01.
  it("seeded worlds, 8 test clips against 16 best clips, spread 1.0", () => {
    const W = 2000;
    const kept = [2, 1.5, 1, 0.67].map((lift) => {
      let n = 0;
      for (let w = 0; w < W; w++) {
        const z = normals(20261029 + w * 104729 + Math.round(lift * 1000));
        const hit = () => (z() > 2.326 ? Math.log(30) : 0); // 1 % of clips
        const clip = (y: number) => Math.max(-SCORE_CLIP, Math.min(SCORE_CLIP, y));
        const test: number[] = [];
        const best: number[] = [];
        for (let d = 0; d < 8; d++) {
          const day = z() * Math.sqrt(0.3);
          test.push(clip(day + Math.log(lift) + z() * Math.sqrt(0.7) + hit()));
          for (let b = 0; b < 2; b++) best.push(clip(day + z() * Math.sqrt(0.7) + hit()));
        }
        const { m, sd } = shrunkDifference(test, best);
        if (dialCall(m, sd).keep) n++;
      }
      return n;
    });
    expect(kept).toEqual([1391, 865, 200, 21]);
    const [twice, , none, worse] = kept.map((n) => n / W);
    expect(twice).toBeGreaterThanOrEqual(0.45);
    expect(none).toBeLessThanOrEqual(0.16);
    expect(worse).toBeLessThanOrEqual(0.05);
  });
});

describe("the pipeline's worlds: learnPass day by day", () => {
  const worlds = (lift: number, miss: number, excl: number, n: number) => {
    let kept = 0;
    const days: number[] = [];
    let undecided = 0;
    for (let w = 0; w < n; w++) {
      const r = runWorld({ seed: 9000 + w, effect: (p) => (p.bucket === "short" ? Math.log(lift) : 0), stopAt: "length", days: 45, miss, excl });
      const v = r.decisions.find((d) => d.dial === "length");
      if (!v) {
        undecided++;
        continue;
      }
      if (v.verdict === "kept" && v.challenger === "short") kept++;
      if (r.days !== null) days.push(r.days);
    }
    days.sort((a, b) => a - b);
    return { kept, undecided, median: Math.round(days[days.length >> 1] * 10) / 10 };
  };

  // 3 clips a day on Instagram and TikTok, the first test (short against standard) from day 0; with misses, 25 % of reads are
  // missed and 10 % of posts fail at publish time. sim/l0.py: 11.1 and 13.5 median days; kept 0.68 and 0.66 at 2x. 100
  // worlds each (about 5 points of noise): the rates hold, and missed reads only make the result later.
  const N = 100;
  it("short clips that truly do 2x, every read in", () => {
    const o = worlds(2, 0, 0, N);
    expect(o).toEqual({ kept: 58, undecided: 0, median: 10.9 });
    expect(o.kept / N).toBeGreaterThanOrEqual(0.45);
  });

  it("short clips that do nothing, every read in", () => {
    const o = worlds(1, 0, 0, N);
    expect(o).toEqual({ kept: 7, undecided: 0, median: 10.9 });
    expect(o.kept / N).toBeLessThanOrEqual(0.16);
  });

  it("short clips that truly do 2x, 25 % of reads missed: kept as often, a day later", () => {
    const o = worlds(2, 0.25, 0.1, N);
    expect(o).toEqual({ kept: 61, undecided: 0, median: 11.9 });
    expect(o.kept / N).toBeGreaterThanOrEqual(0.45);
    expect(o.median).toBeGreaterThan(10.9);
  });

  it("short clips that do nothing, 25 % of reads missed: no more false keeps than the rule allows, a day later", () => {
    const o = worlds(1, 0.25, 0.1, N);
    expect(o).toEqual({ kept: 12, undecided: 0, median: 11.9 });
    expect(o.kept / N).toBeLessThanOrEqual(0.16);
    expect(o.median).toBeGreaterThan(10.9);
  });
});

describe("a Trial Reel world", () => {
  // the Journey does 3x with strangers; nothing else does anything
  const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, effect: (p) => (p.lane === "trialReel" && p.template === "get-out-journey" ? Math.log(3) : 0), days: 40 });

  it("block 1 reads once, from its first 8 clean pairs: the Journey joins its rotation; block 2 asks the length again, with Spiral Glass", () => {
    const t0 = r.decisions.filter((d) => d.testId.startsWith("t0."));
    expect(t0.map((d) => [d.dial, d.verdict, d.nTest])).toEqual([
      ["newcomer", "kept", 8],
      ["length", "noClearDifference", 8],
    ]);
    expect(t0.every((d) => d.decidedAt === "2026-11-12T09:00:00.000Z")).toBe(true);
    const t1 = r.decisions.filter((d) => d.testId.startsWith("t1."));
    expect(t1.map((d) => [d.dial, d.subject, d.verdict])).toEqual([
      ["newcomer", "smash-spiral-glass", "notKept"],
      ["length", null, "noClearDifference"],
    ]);
    expect(r.plans[r.plans.length - 1].joined).toEqual(["get-out-journey"]);
    // every verdict is written once
    expect(new Set(r.decisions.map((d) => `${d.testId}|${d.dial}`)).size).toBe(r.decisions.length);
  });

  it("no decision before the horizon: every pass before a verdict had fewer than 8 scored clips or pairs", () => {
    for (const p of r.plans) {
      if (p.block && !p.verdicts.some((v) => v.testId === p.block!.id)) expect(p.block.clean).toBeLessThan(8);
      if (p.test?.kind === "normal") expect(p.test.nTest).toBeLessThan(NORMAL_TEST_CLIPS);
    }
    const n0 = r.decisions.find((d) => d.testId.startsWith("n0."))!;
    expect([n0.dial, n0.nTest, n0.nBest]).toEqual(["postTime", 8, 16]);
  });

  it("a kept change waits for its check while the normal lane is busy, and its dial stays out of the lab meanwhile", () => {
    const kept = r.decisions.find((d) => d.testId.startsWith("t2.") && d.verdict === "kept")!;
    expect(kept.dial).toBe("format");
    const later = r.plans.filter((p) => p.date > kept.decidedAt.slice(0, 10));
    expect(later.length).toBeGreaterThan(0);
    for (const p of later) expect(p.block?.questions.some((q) => q.dial === "format") ?? false).toBe(false);
  });
});

describe("the combined check", () => {
  it("4 old against 12 new in a seeded order", () => {
    const order = checkOrder("c1.n0.length.standard.short");
    expect(order).toHaveLength(CHECK_POSTS);
    expect(order.filter((a) => a === "old")).toHaveLength(CHECK_OLD);
    expect(checkOrder("c1.n0.length.standard.short")).toEqual(order);
    expect(checkOrder("c2.n0.length.standard.short")).not.toEqual(order);
  });

  it("a check whose change the owner undid closes, so the normal lane moves on", () => {
    const kept = [verdict({ testId: "t0.length.standard.short", lane: "trialReel", decidedAt: iso(T0 - DAY) })];
    const r = runWorld({ seed: 91, decisions: kept, effect: () => 0, days: 3 });
    const open = r.plans[r.plans.length - 1].test!;
    expect([open.id, open.kind, open.questions]).toEqual(["c0.t0.length.standard.short", "check", [length]]);
    expect(r.plans[r.plans.length - 1].slots.every((s) => s.locked.join() === "length")).toBe(true);
    const undo = verdict({ testId: "t0.length.standard.short", lane: "trialReel", verdict: "undone", decidedAt: iso(T0 + 1.5 * DAY) });
    const input = { ...r.input, decisions: [...r.input.decisions, undo] };
    const plan = learnPass(input)!;
    expect(plan.verdicts.map((v) => [v.testId, v.dial, v.verdict])).toEqual([["c0.t0.length.standard.short", "length", "undone"]]);
    expect(plan.best.length).toBe("standard");
    // the next question's arms are planned first, then it opens (short is locked by the Undo: long is next)
    expect(plan.test).toBeNull();
    const planned = checkArms(plan.feasibilityNeeded, CATALOG, new Set(plan.joined), passAll, input.feasibility);
    const next = learnPass({ ...input, feasibility: [...(input.feasibility ?? []), ...planned] })!;
    expect(next.test?.questions).toEqual([{ dial: "length", best: "standard", challenger: "long", subject: null }]);
  });

  it("a failed check sends every change of its block back together, and they are asked again after 60 days", () => {
    const block = "t0.length.standard.short~format.mix.smash";
    const kept: LearnerDecision[] = [
      verdict({ testId: block, lane: "trialReel", dial: "length", best: "standard", challenger: "short", decidedAt: iso(T0 - DAY) }),
      verdict({ testId: block, lane: "trialReel", dial: "format", best: "mix", challenger: "smash", decidedAt: iso(T0 - DAY) }),
    ];
    // followers dislike the new combination: short Smash clips do a fifth as well (a mild loss often holds: 0.5x goes back 47 %)
    const r = runWorld({ seed: 77, decisions: kept, effect: (p) => (p.bucket === "short" && p.template.startsWith("smash-") ? Math.log(0.2) : 0), until: (v) => v.verdict === "wentBack" || v.verdict === "held", days: 30 });
    const first = r.plans[0];
    expect(first.test?.kind).toBe("check");
    expect(first.slots.every((s) => s.role === "check" && (s.membership?.arm === "old" || s.membership?.arm === "new"))).toBe(true);
    expect(first.slots.filter((s) => s.membership?.arm === "old").every((s) => s.options.bucket === "standard")).toBe(true);
    expect(first.slots.filter((s) => s.membership?.arm === "new").every((s) => s.options.bucket === "short" && s.options.template.startsWith("smash-"))).toBe(true);
    const back = r.decisions.filter((d) => d.testId.startsWith("c"));
    expect(back.map((d) => [d.dial, d.verdict])).toEqual([
      ["format", "wentBack"],
      ["length", "wentBack"],
    ]);
    const after = bestsOf(r.decisions, { fixed: {} }, CATALOG).arms;
    expect([after.length, after.format]).toEqual(["standard", "mix"]);
    const at = Date.parse(back[0].decidedAt);
    expect(restsUntil({ dial: "length", best: "standard", challenger: "short", subject: null }, r.decisions)).toBe(at + REST_DAYS * DAY);
  });
});

describe("whether a post counts", () => {
  const post = (over: Partial<LearnerPost> = {}): LearnerPost => ({ postId: "p", channelId: "ig1", platform: "instagram", lane: "normal", clipId: "c", approvedAt: iso(T0), test: { id: "n0.length.standard.short", arm: "short", role: "test" }, facts: { template: "get-out-classic", bucket: "short", ending: "resolved", watermark: "sealed" }, privacy: null, ...over });
  const scored: PostMeasure = { postId: "p", channelId: "ig1", platform: "instagram", lane: "normal", publishedAt: T0 + 3 * H, state: "scored", views72: 900, via: "line", usual: 450, score: Math.log(901 / 451) };
  const ctx = { questions: [length], levels: [1 as const], openedAt: T0, catalog: CATALOG, offsetMin: 0 };

  it("counts a sealed clip whose rendered facts match its arm", () => {
    expect(postOutcome(post(), scored, ctx)).toEqual({ kind: "scored", score: scored.state === "scored" ? scored.score : 0, views72: 900 });
  });

  it("leaves out TikTok Only me or an unknown audience, YouTube, an unfinished upload, no answer, a free clip, off its arm, before its test, shared early", () => {
    const why = (p: LearnerPost, m: PostMeasure | undefined = scored) => {
      const o = postOutcome(p, m, ctx);
      return o.kind === "excluded" ? o.why : o.kind;
    };
    expect(why(post({ platform: "tiktok", channelId: "tt1", privacy: "self" }))).toBe("self");
    expect(why(post({ platform: "tiktok", channelId: "tt1", privacy: null }))).toBe("privacyUnknown");
    expect(why(post({ platform: "tiktok", channelId: "tt1", privacy: "public" }))).toBe("scored");
    expect(why(post({ platform: "youtube" }), { ...scored, platform: "youtube", state: "excluded", why: "youtube" } as PostMeasure)).toBe("youtube");
    expect(why(post(), { ...scored, state: "excluded", why: "draft" } as PostMeasure)).toBe("draft");
    expect(why(post(), { ...scored, state: "excluded", why: "noAnswer" } as PostMeasure)).toBe("noAnswer");
    expect(why(post({ facts: { ...post().facts, watermark: "free" } }))).toBe("free");
    expect(why(post({ facts: { ...post().facts, watermark: "sealedTest" } }))).toBe("free");
    expect(why(post({ facts: { ...post().facts, bucket: "standard" } }))).toBe("offPlan");
    expect(why(post(), { ...scored, publishedAt: T0 - H })).toBe("outOfWindow");
    expect(why(post({ lane: "trialReel", sharedAt: iso(T0 + 24 * H) }))).toBe("shared");
    expect(why(post({ lane: "trialReel", sharedAt: iso(T0 + 80 * H) }))).toBe("scored"); // shared after its read
    expect(why(post(), { ...scored, state: "pending" } as PostMeasure)).toBe("pending");
    expect(why(post(), { ...scored, state: "unscored", why: "fewPosts", n: 3 } as PostMeasure)).toBe("measured");
  });

  it("a clip scores the mean of its channel posts, waits while one is pending, and is left out when none counts", () => {
    const at = T0;
    expect(clipScore("c", [{ outcome: { kind: "scored", score: 0.2, views72: 1 }, publishedAt: at }, { outcome: { kind: "scored", score: 0.6, views72: 1 }, publishedAt: at + H }], "test", "short")).toMatchObject({ state: "scored", score: 0.4, publishedAt: at });
    expect(clipScore("c", [{ outcome: { kind: "scored", score: 0.2, views72: 1 }, publishedAt: at }, { outcome: { kind: "pending" }, publishedAt: at }], "test", "short").state).toBe("pending");
    expect(clipScore("c", [{ outcome: { kind: "excluded", why: "self" }, publishedAt: at }], "test", "short")).toMatchObject({ state: "excluded", why: "self" });
    expect(clipScore("c", [{ outcome: { kind: "measured", views72: 5 }, publishedAt: at }], "test", "short")).toMatchObject({ state: "excluded", why: "noUsual" });
  });
});

describe("lanes per channel", () => {
  const ctx = { trialChannel: "ig1", usualReady: new Set(["ig1", "tt1"]) };
  const channels = [IG, TT, YT, { id: "x1", platform: "x", trialReels: false }];

  it("a trial arm lists only its Instagram channel; a test clip only scored channels with their usual; Shorts never long", () => {
    expect(channelsFor("trialA", "01", "short", channels, ctx)).toEqual([{ id: "ig1", lane: "trialReel" }]);
    expect(channelsFor("trialB", "10", "short", channels, { ...ctx, trialChannel: null })).toEqual([]);
    expect(channelsFor("test", "short", "short", channels, ctx).map((c) => c.id)).toEqual(["ig1", "tt1"]);
    expect(channelsFor("test", "short", "short", channels, { ...ctx, usualReady: new Set(["ig1"]) }).map((c) => c.id)).toEqual(["ig1"]);
    expect(channelsFor("check", "old", "short", channels, ctx).map((c) => c.id)).toEqual(["ig1", "tt1"]);
    expect(channelsFor("check", "new", "short", channels, ctx).map((c) => c.id)).toEqual(["ig1", "tt1", "x1", "yt1"]);
    expect(channelsFor("best", null, "standard", channels, ctx).map((c) => c.id)).toEqual(["ig1", "tt1", "x1", "yt1"]);
    expect(channelsFor("best", null, "long", channels, ctx).map((c) => c.id)).toEqual(["ig1", "tt1", "x1"]);
    expect(channelsFor("best", null, "long", channels, ctx).every((c) => c.lane === "normal")).toBe(true);
  });

  it("over a world, no trial reel reaches a follower and no test clip reaches YouTube", () => {
    const r = runWorld({ seed: 21, channels: [IG, TT, YT], settings: ON, effect: () => 0, days: 14 });
    const slots = r.plans.flatMap((p) => p.slots);
    expect(slots.some((s) => s.role === "trialA")).toBe(true);
    for (const s of slots) {
      if (s.role === "trialA" || s.role === "trialB") expect(s.channels).toEqual([{ id: "ig1", lane: "trialReel" }]);
      if (s.role === "test") expect(s.channels.some((c) => c.id === "yt1")).toBe(false);
      if (s.options.bucket === "long") expect(s.channels.some((c) => c.id === "yt1")).toBe(false);
    }
  });
});

describe("the day's slots", () => {
  it("block 1 is the Journey as a newcomer and the length; its pairs differ in both, on one channel, at least 2 hours apart", () => {
    const r = runWorld({ seed: 31, channels: [IG, TT], settings: ON, effect: () => 0, days: 3 });
    const plan = r.plans[0];
    expect(plan.status.trialLane).toBe(true);
    expect(plan.block?.questions).toEqual([
      { dial: "newcomer", best: "rotation", challenger: "newcomer", subject: "get-out-journey" },
      { dial: "length", best: "standard", challenger: "short", subject: null },
    ]);
    const reels = plan.slots.filter((s) => s.lane === "trialReel");
    expect(reels.map((s) => s.role).sort()).toEqual(["trialA", "trialB"]);
    const [a, b] = [reels.find((s) => s.role === "trialA")!, reels.find((s) => s.role === "trialB")!];
    expect(a.membership!.pair).toBe(b.membership!.pair);
    expect([...a.membership!.arm].every((c, j) => c !== b.membership!.arm[j])).toBe(true);
    expect(a.options.template === "get-out-journey" || b.options.template === "get-out-journey").toBe(true);
    expect(a.options.bucket).not.toBe(b.options.bucket);
    const minutes = (s: { window: { from: string } }) => Number(s.window.from.slice(0, 2)) * 60 + Number(s.window.from.slice(3));
    expect(Math.abs(minutes(a) - minutes(b))).toBeGreaterThanOrEqual(120);
    expect(a.planSeed).not.toBe(b.planSeed);
    expect(a.locked).toEqual(["newcomer", "length"]);
    // the normal lane meanwhile tests what only followers can tell
    expect(plan.test?.questions[0].dial).toBe("postTime");
  });

  it("over a week, tests stay within one of 1 clip in 3, and every clip of the test window carries its locked dial", () => {
    const r = runWorld({ seed: 41, effect: () => 0, days: 7 });
    const slots = r.plans.flatMap((p) => p.slots).filter((s) => s.membership?.id.startsWith("n0."));
    const tests = slots.filter((s) => s.role === "test").length;
    expect(Math.abs(tests - slots.length / 3)).toBeLessThanOrEqual(1);
    expect(slots.every((s) => s.locked.includes("length"))).toBe(true);
    expect(slots.every((s) => s.options.bucket === (s.role === "test" ? "short" : "standard"))).toBe(true);
  });

  it("the variety caps: at most 40 % of a channel's last 7 days from one template, never twice in a row, no battle family", () => {
    const r = runWorld({ seed: 51, effect: () => 0, days: 21 });
    expect(r.plans.flatMap((p) => p.slots).some((s) => s.capsRelaxed)).toBe(false);
    let checked = 0;
    for (const plan of r.plans) {
      const now = Date.parse(`${plan.date}T09:00:00Z`);
      for (const ch of ["ig1", "tt1"]) {
        // the channel's posts of the 7 days before the pass (the world approves them at the pass), then this pass's own
        const week = r.posts.filter((p) => p.channelId === ch && Date.parse(p.approvedAt) >= now - 7 * DAY && Date.parse(p.approvedAt) < now).sort((a, b) => Date.parse(a.approvedAt) - Date.parse(b.approvedAt)).map((p) => p.facts.template!);
        for (const slot of plan.slots.filter((s) => s.channels.some((c) => c.id === ch))) {
          const id = slot.options.template;
          expect(id, `${ch} ${plan.date}`).not.toBe(week[week.length - 1]);
          if (week.length >= 5) {
            expect((week.filter((t) => t === id).length + 1) / (week.length + 1), `${ch} ${plan.date} ${id}`).toBeLessThanOrEqual(TEMPLATE_SHARE_MAX + 1e-9);
            checked++;
          }
          week.push(id);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(r.posts.some((p) => p.facts.template === "who-wins-battle")).toBe(false);
  });

  it("a fixed dial is never tested, and the owner's skip takes a question out", () => {
    const fixed = runWorld({ seed: 61, settings: { ...ON, trialReels: false, fixed: { length: "short" } }, effect: () => 0, days: 2 });
    expect(fixed.plans[0].best.length).toBe("short");
    expect(fixed.plans[0].test?.questions[0].dial).not.toBe("length");
    const skipped = runWorld({ seed: 61, settings: { ...ON, trialReels: false, skipped: ["length:short~standard"] }, effect: () => 0, days: 2 });
    expect(skipped.plans[0].test?.questions[0]).toEqual({ dial: "length", best: "standard", challenger: "long", subject: null });
  });

  it("asks for the arms to plan before a test opens, and opens it once they are planned", () => {
    const input = smallInput({ feasibility: [] });
    const plan = learnPass(input)!;
    expect(plan.test).toBeNull();
    expect(plan.feasibilityNeeded.length).toBeGreaterThan(0);
    expect(plan.slots.every((s) => s.role === "best")).toBe(true);
    expect(dayOfDate(plan.date)).toBe(Math.floor(input.now / DAY));
  });
});

// --- end learner ---
