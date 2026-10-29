import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bestsOf,
  channelsFor,
  checkOrder,
  clipScore,
  dayOfDate,
  decisionTime,
  findingsOf,
  formatOrder,
  learnPass,
  learnerRuns,
  localDay,
  newestTrialNumbers,
  nextTest,
  numbersOf,
  parseTestId,
  postOutcome,
  postTimeOpen,
  rarelyPasses,
  readBlockTest,
  restsUntil,
  shrunkDifference,
  spreadWindows,
  testIdOf,
  trialPairWindows,
  type LearnerDecision,
  type LearnerInput,
  type LearnerPost,
  type NextTestChoice,
  type NextTestContext,
  type Question,
} from "@/lib/insights/learner";
import { dialCall } from "@/lib/insights/lab";
import { CHECK_OLD, CHECK_POSTS, KEEP_P, KEEP_RATIO, NORMAL_HORIZON_TIMES, NORMAL_TEST_CLIPS, PAIR_GAP_H, REST_DAYS, REST_TWICE_DAYS, SCORE_CLIP, TEMPLATE_SHARE_MAX, TEST_EVERY, TRIAL_PAUSE_DAYS } from "@/lib/insights/learnerRules";
import { inQuietMinutes } from "@/lib/desktop/autopilot";
import { DEFAULT_LEARNER } from "@/lib/insights/learnerSettings";
import { measureRows, type PostMeasure } from "@/lib/insights/stats";
import { CATALOG, DAY, H, IG, ON, TT, YT, dateOf, iso, normals, passAll, runWorld, type WorldResult } from "./learnerWorld";
import { armKey, checkArms, type ArmPlanner, type FeasibilityResult } from "@/lib/insights/feasibility";
import { activeDials, questionKey, TEST_ORDER, type DialId } from "@/lib/insights/dials";

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

  // the PC's clock ran ahead when the change was kept, and was put right before its check (or the owner's Undo) wrote
  it("the log is replayed in the order it was written: a went-back or an Undo stamped earlier still reverses the kept before it", () => {
    const kept = verdict({ decidedAt: "2026-11-20T09:00:00.000Z" });
    const back = verdict({ testId: "c1.n0.length.standard.short", verdict: "wentBack", decidedAt: "2026-11-19T09:00:00.000Z" });
    const undone = verdict({ verdict: "undone", decidedAt: "2026-11-19T09:00:00.000Z" });
    expect(bestsOf([kept, back], { fixed: {} }).arms.length).toBe("standard");
    expect(bestsOf([kept, undone], { fixed: {} }).arms.length).toBe("standard");
    expect(restsUntil(length, [kept, undone])).toBe(Number.POSITIVE_INFINITY);
    expect(findingsOf([kept, back]).map((f) => f.key)).toEqual(["Learner.findings.length.wentBack", "Learner.findings.length.kept"]);
    // a new verdict is stamped no earlier than the newest one in the log, so the log's times only go forward
    expect(decisionTime([kept, back], Date.parse("2026-11-19T12:00:00Z"))).toBe(Date.parse("2026-11-20T09:00:00Z"));
    expect(decisionTime([kept, back], Date.parse("2026-11-21T00:00:00Z"))).toBe(Date.parse("2026-11-21T00:00:00Z"));
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
  // worlds each (about 5 points of noise): the rates hold, and missed reads only make the result later. The pins moved when
  // the test slot and the "spread" windows were drawn by date (learner review round 1): over 400 other worlds (seeds 20000 on)
  // 2x was kept 0.667 and 0.662 of the time, no difference 0.122 and 0.113, against 0.647, 0.618, 0.090 and 0.110 before.
  const N = 100;
  /** The median days to the verdict with every read in: missed reads must only make it later. */
  const ALL_IN_MEDIAN = 10.5;
  it("short clips that truly do 2x, every read in", () => {
    const o = worlds(2, 0, 0, N);
    expect(o).toEqual({ kept: 73, undecided: 0, median: ALL_IN_MEDIAN });
    expect(o.kept / N).toBeGreaterThanOrEqual(0.45);
  });

  it("short clips that do nothing, every read in", () => {
    const o = worlds(1, 0, 0, N);
    expect(o).toEqual({ kept: 10, undecided: 0, median: ALL_IN_MEDIAN });
    expect(o.kept / N).toBeLessThanOrEqual(0.16);
  });

  it("short clips that truly do 2x, 25 % of reads missed: kept as often, a day later", () => {
    const o = worlds(2, 0.25, 0.1, N);
    expect(o).toEqual({ kept: 76, undecided: 0, median: 11.5 });
    expect(o.kept / N).toBeGreaterThanOrEqual(0.45);
    expect(o.median).toBeGreaterThan(ALL_IN_MEDIAN);
  });

  it("short clips that do nothing, 25 % of reads missed: no more false keeps than the rule allows, a day later", () => {
    const o = worlds(1, 0.25, 0.1, N);
    expect(o).toEqual({ kept: 9, undecided: 0, median: 11.5 });
    expect(o.kept / N).toBeLessThanOrEqual(0.16);
    expect(o.median).toBeGreaterThan(ALL_IN_MEDIAN);
  });

  // the review's world: post time matters (noon posts x1.25 or x0.8) and short clips do nothing. With the test clip in one
  // window every day, short was kept 0.258 or called worse 0.242 of the time (400 worlds); drawn by date, post time is noise
  it("post time that matters does not leak into a length verdict", () => {
    const rates = [1, 1.25, 0.8].map((noon) => {
      let kept = 0;
      let notKept = 0;
      for (let w = 0; w < N; w++) {
        const r = runWorld({ seed: 91000 + w, effect: (p) => (new Date(p.at).getUTCHours() >= 12 && new Date(p.at).getUTCHours() < 15 ? Math.log(noon) : 0), stopAt: "length", days: 45 });
        const v = r.decisions.find((d) => d.dial === "length");
        if (v?.verdict === "kept") kept++;
        if (v?.verdict === "notKept") notKept++;
      }
      return [kept, notKept];
    });
    expect(rates).toEqual([
      [5, 6],
      [5, 6],
      [6, 5],
    ]);
    for (const [kept, notKept] of rates) {
      expect(kept / N).toBeLessThanOrEqual(0.16);
      expect(notKept / N).toBeLessThanOrEqual(0.16);
    }
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

// Whether a Trial Reel's numbers come through Postiz is the plan's open question; Postiz passes Meta's totals on unchanged, so
// they may come as zeros rather than as no answer. Zeros once made clean pairs (D = 0): blocks completed on nothing, and the
// Journey and Spiral Glass joined their rotations on no evidence.
describe("Trial Reels that get no numbers", () => {
  const block = parseTestId("t0.length.standard.short")!;
  const reel = (postId: string, arm: "0" | "1", pair: number): LearnerPost => ({ postId, channelId: "ig1", platform: "instagram", lane: "trialReel", clipId: `c${postId}`, approvedAt: iso(T0), test: { id: block.id, arm, role: arm === "0" ? "trialA" : "trialB", pair }, facts: { template: "get-out-classic", bucket: arm === "0" ? "standard" : "short", ending: "resolved", watermark: "sealed" }, privacy: null });
  const measured = (postId: string, views72: number): PostMeasure => ({ postId, channelId: "ig1", platform: "instagram", lane: "trialReel", publishedAt: T0 + 3 * H, state: "unscored", views72, via: "line", why: "fewViews", n: 0 });
  const readPair = (va: number, vb: number) => {
    const posts = [reel("a", "0", 7), reel("b", "1", 7)];
    const measures = new Map([measured("a", va), measured("b", vb)].map((m) => [`${m.postId}|${m.channelId}`, m]));
    return readBlockTest(block, posts, measures, CATALOG, T0 + 4 * DAY).pairs[0];
  };

  it("without a trial usual, a pair whose larger reel is under 10 views has nothing to compare: broken, never a clean difference of 0", () => {
    expect(readPair(0, 0)).toMatchObject({ state: "broken", numbers: false });
    expect(readPair(3, 5)).toMatchObject({ state: "broken", numbers: true });
    expect(readPair(0, 40)).toMatchObject({ state: "clean", numbers: true }); // a reel with views against one without: a real difference
    expect(readPair(800, 1200)).toMatchObject({ state: "clean", numbers: true });
  });

  it("the lab pauses once its newest pair gets no numbers while normal Reels do; no question is answered and no newcomer joins on zeros", () => {
    const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, zeroTrials: true, effect: (p) => (p.lane === "trialReel" && p.template === "get-out-journey" ? Math.log(3) : 0), days: 40 });
    const trial = r.decisions.filter((d) => d.lane === "trialReel");
    expect(trial.length).toBeGreaterThan(0);
    expect(trial.every((d) => d.verdict === "notEnoughPairs")).toBe(true);
    expect(r.plans[r.plans.length - 1].joined).toEqual([]);
    const paused = r.plans.filter((p) => p.status.trialPause !== null);
    expect(paused.length).toBeGreaterThan(20);
    expect(paused.every((p) => p.status.trialPause === "noTrialNumbers" && !p.status.trialLane && p.slots.every((s) => s.lane === "normal"))).toBe(true);
    // a few pairs per block, against 80 reels in 40 days without the check
    expect(r.posts.filter((p) => p.lane === "trialReel").length).toBeLessThanOrEqual(20);
    // the normal lane runs the whole list meanwhile, on numbers that do come
    expect(r.decisions.some((d) => d.lane === "normal")).toBe(true);
  });

  it("the same world with Trial Reel numbers that come runs its blocks to answers", () => {
    const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, effect: (p) => (p.lane === "trialReel" && p.template === "get-out-journey" ? Math.log(3) : 0), days: 40 });
    expect(r.plans.every((p) => p.status.trialPause === null)).toBe(true);
    expect(r.decisions.some((d) => d.lane === "trialReel" && d.verdict !== "notEnoughPairs")).toBe(true);
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
    // written in the order of the kept changes they check
    expect(back.map((d) => [d.dial, d.verdict])).toEqual([
      ["length", "wentBack"],
      ["format", "wentBack"],
    ]);
    const after = bestsOf(r.decisions, { fixed: {} }, CATALOG).arms;
    expect([after.length, after.format]).toEqual(["standard", "mix"]);
    const at = Date.parse(back[0].decidedAt);
    expect(restsUntil({ dial: "length", best: "standard", challenger: "short", subject: null }, r.decisions)).toBe(at + REST_DAYS * DAY);
  });

  it("kept while the PC's clock ran 40 days ahead: the check written after the clock was put right still sends both back, stamped after them", () => {
    const block = "t0.length.standard.short~format.mix.smash";
    const ahead = T0 - DAY + 40 * DAY;
    const kept: LearnerDecision[] = [
      verdict({ testId: block, lane: "trialReel", dial: "length", best: "standard", challenger: "short", decidedAt: iso(ahead) }),
      verdict({ testId: block, lane: "trialReel", dial: "format", best: "mix", challenger: "smash", decidedAt: iso(ahead) }),
    ];
    const r = runWorld({ seed: 77, decisions: kept, effect: (p) => (p.bucket === "short" && p.template.startsWith("smash-") ? Math.log(0.2) : 0), until: (v) => v.verdict === "wentBack" || v.verdict === "held", days: 30 });
    const back = r.decisions.filter((d) => d.testId.startsWith("c"));
    expect(back.map((d) => [d.dial, d.verdict])).toEqual([
      ["length", "wentBack"],
      ["format", "wentBack"],
    ]);
    expect(back.every((d) => Date.parse(d.decidedAt) === ahead)).toBe(true); // not before the kept verdicts: the world's clock is still behind them
    const after = bestsOf(r.decisions, { fixed: {} }, CATALOG).arms;
    expect([after.length, after.format]).toEqual(["standard", "mix"]);
    // the next pass plans from the old settings again: no clip of the short bucket while length is not under test
    const next = learnPass({ ...r.input, decisions: r.decisions })!;
    expect(next.best.length).toBe("standard");
  });
});

describe("whether a post counts", () => {
  const post = (over: Partial<LearnerPost> = {}): LearnerPost => ({ postId: "p", channelId: "ig1", platform: "instagram", lane: "normal", clipId: "c", approvedAt: iso(T0), test: { id: "n0.length.standard.short", arm: "short", role: "test" }, facts: { template: "get-out-classic", bucket: "short", ending: "resolved", watermark: "sealed" }, privacy: null, ...over });
  const scored: PostMeasure = { postId: "p", channelId: "ig1", platform: "instagram", lane: "normal", publishedAt: T0 + 3 * H, state: "scored", views72: 900, via: "line", usual: 450, score: Math.log(901 / 451) };
  const ctx = { questions: [length], levels: [1 as const], openedAt: T0, catalog: CATALOG, offsetMinAt: () => 0 };

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

  // Poland: CEST (+120) until 01:00 UTC on 25 Oct 2026, then CET (+60)
  const changeAt = Date.parse("2026-10-25T01:00:00Z");
  const warsaw = (at: number) => (at < changeAt ? 120 : 60);

  it("reads each post at its own moment's UTC offset: a noon test post from before the clocks went back stays in its window", () => {
    const noon: Question = { dial: "postTime", best: "spread", challenger: "noon", subject: null };
    const c = { ...ctx, questions: [noon], openedAt: Date.parse("2026-10-19T00:00:00Z"), offsetMinAt: warsaw };
    const p = post({ test: { id: "n0.postTime.spread.noon", arm: "noon", role: "test" } });
    const summer: PostMeasure = { ...scored, publishedAt: Date.parse("2026-10-20T10:00:00Z") }; // 12:00 CEST
    const winter: PostMeasure = { ...scored, publishedAt: Date.parse("2026-11-03T11:00:00Z") }; // 12:00 CET
    expect(postOutcome(p, summer, c).kind).toBe("scored");
    expect(postOutcome(p, winter, c).kind).toBe("scored");
    // one offset for every post (today's, after the change) would have read the summer post as 11:00, off its window
    expect(postOutcome(p, summer, { ...c, offsetMinAt: () => 60 })).toEqual({ kind: "excluded", why: "offPlan" });
    // a Trial Reel approved at 00:30 local is that local day's, on either side of the change
    expect(localDay(Date.parse("2026-10-24T22:30:00Z"), warsaw)).toBe(dayOfDate("2026-10-25"));
    expect(localDay(Date.parse("2026-10-25T23:30:00Z"), warsaw)).toBe(dayOfDate("2026-10-26"));
  });

  it("learnPass takes the offset at each moment: a post-time test open across the change still counts its summer clips", () => {
    // the lab runs, so the normal lane's first question is post time (noon against today's spread), one clip a day in Warsaw
    const r = runWorld({ seed: 81, channels: [IG, TT], settings: ON, perDay: 1, offsetMinAt: warsaw, start: Date.parse("2026-10-12T09:00:00Z"), effect: () => 0, days: 20 });
    const input = r.input;
    expect(input.now).toBeGreaterThan(changeAt + 4 * DAY);
    const plan = learnPass(input)!;
    expect(plan.test?.id).toBe("n0.postTime.spread.noon");
    const summer = r.posts.filter((p) => p.test?.id === plan.test!.id && p.test.role === "test" && Date.parse(p.approvedAt) < changeAt).length;
    expect(summer).toBeGreaterThan(0);
    // read at today's offset alone, its summer noon clips would leave their window and the test would count fewer
    const oneOffset = learnPass({ ...input, offsetMinAt: () => 60 })!;
    expect(oneOffset.test?.id).toBe(plan.test!.id);
    expect(oneOffset.test!.nTest + oneOffset.test!.pending).toBeLessThan(plan.test!.nTest + plan.test!.pending);
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

  // a newcomer test's best arm is its format's rotation: given to every best slot, it locked the whole lane, YouTube included,
  // to one format for the test's weeks, and with two templates left the 40 % cap could not hold (43 % from one template)
  it("a newcomer test without Trial Reels: only its comparison clips take the format, the caps hold, Shorts keeps the best settings", () => {
    const lost = (testId: string, dial: "length" | "ending", best: string, challenger: string) => verdict({ testId, dial, best, challenger, verdict: "notKept", decidedAt: iso(T0 - 5 * DAY), ratio: 0.9, p: 0.3, nTest: 8, nBest: 8 });
    // length (short and long) and the ending were asked and lost: the next normal tests without Trial Reels are the newcomers
    const decisions = [lost("n0.length.standard.short", "length", "standard", "short"), lost("n1.length.standard.long", "length", "standard", "long"), lost("n2.ending.resolved.cliffhanger", "ending", "resolved", "cliffhanger")];
    const formatOf = (id: string) => CATALOG.find((t) => t.id === id)!.format;
    const worlds = [
      { seed: 5, perDay: 3 },
      { seed: 5, perDay: 5 },
      { seed: 7, perDay: 3, start: Date.parse("2026-12-03T09:00:00Z") },
    ];
    for (const w of worlds) {
      const name = JSON.stringify(w);
      const r = runWorld({ ...w, channels: [IG, TT, YT], settings: { ...ON, trialReels: false }, effect: () => 0, days: 40, decisions });
      const window = r.plans.filter((p) => p.test?.questions[0].dial === "newcomer");
      const subjects = [...new Set(window.map((p) => p.test!.questions[0].subject ?? ""))];
      expect(subjects, name).toEqual(["get-out-journey", "smash-spiral-glass"]);
      for (const subject of subjects) {
        const plans = window.filter((p) => p.test!.questions[0].subject === subject);
        const test = plans[0].test!;
        const slots = plans.flatMap((p) => p.slots);
        expect(slots.some((s) => s.capsRelaxed), `${name} ${subject}`).toBe(false);
        // 1 clip in 5 tests the newcomer, 2 per test clip are the rotation it is compared with (1 where the rotation has one
        // template: Smash beside Spiral Glass), the rest keep the best settings and count for no test
        const tests = slots.filter((s) => s.membership?.id === test.id && s.role === "test");
        const rotation = slots.filter((s) => s.membership?.id === test.id && s.role === "best");
        const perTest = subject === "get-out-journey" ? 2 : 1;
        expect(tests.length, `${name} ${subject}`).toBeLessThanOrEqual(slots.length / 5 + 1);
        expect(tests.length, `${name} ${subject}`).toBeGreaterThanOrEqual(slots.length / 5 - 2);
        expect(Math.abs(rotation.length - perTest * tests.length), `${name} ${subject}`).toBeLessThanOrEqual(2); // a clip the caps refused went out with the best settings
        expect(tests.every((s) => s.options.template === subject)).toBe(true);
        expect(rotation.every((s) => formatOf(s.options.template) === formatOf(subject) && s.options.template !== subject)).toBe(true);
        const rest = slots.filter((s) => !s.membership);
        expect(rest.length).toBe(slots.length - tests.length - rotation.length);
        expect(rest.every((s) => s.role === "best")).toBe(true);
        expect(new Set(rest.map((s) => formatOf(s.options.template))).size, `${name} ${subject}`).toBeGreaterThanOrEqual(3);
        // Shorts: the best settings only, never a test's arm, and every format
        const shorts = slots.filter((s) => s.channels.some((c) => c.id === "yt1"));
        expect(shorts.length).toBeGreaterThan(0);
        expect(shorts.every((s) => !s.membership)).toBe(true);
        expect(new Set(shorts.map((s) => formatOf(s.options.template))).size, `${name} ${subject}`).toBeGreaterThanOrEqual(3);
        // the test still reads: 8 test clips against at least 8 of its rotation
        const verdicts = r.decisions.filter((d) => d.testId === test.id);
        expect(verdicts.length, `${name} ${subject}`).toBe(1);
        expect(verdicts[0].nBest, `${name} ${subject}`).toBeGreaterThanOrEqual(8);
      }
      // the caps on every channel, pick by pick, over the 7 days before each pass
      let checked = 0;
      for (const plan of window) {
        const now = Date.parse(`${plan.date}T09:00:00Z`);
        for (const ch of ["ig1", "tt1", "yt1"]) {
          const week = r.posts.filter((p) => p.channelId === ch && Date.parse(p.approvedAt) >= now - 7 * DAY && Date.parse(p.approvedAt) < now).sort((a, b) => Date.parse(a.approvedAt) - Date.parse(b.approvedAt)).map((p) => p.facts.template!);
          for (const slot of plan.slots.filter((s) => s.channels.some((c) => c.id === ch))) {
            const id = slot.options.template;
            expect(id, `${name} ${ch} ${plan.date}`).not.toBe(week[week.length - 1]);
            if (week.length >= 5) {
              expect((week.filter((t) => t === id).length + 1) / (week.length + 1), `${name} ${ch} ${plan.date} ${id}`).toBeLessThanOrEqual(TEMPLATE_SHARE_MAX + 1e-9);
              checked++;
            }
            week.push(id);
          }
        }
      }
      expect(checked, name).toBeGreaterThan(150);
    }
  });

  it("a fixed dial is never tested, and the owner's skip takes a question out", () => {
    const fixed = runWorld({ seed: 61, settings: { ...ON, trialReels: false, fixed: { length: "short" } }, effect: () => 0, days: 2 });
    expect(fixed.plans[0].best.length).toBe("short");
    expect(fixed.plans[0].test?.questions[0].dial).not.toBe("length");
    const skipped = runWorld({ seed: 61, settings: { ...ON, trialReels: false, skipped: ["length:short~standard"] }, effect: () => 0, days: 2 });
    expect(skipped.plans[0].test?.questions[0]).toEqual({ dial: "length", best: "standard", challenger: "long", subject: null });
  });

  // a test clip that always took the same slot of the day took the same post-time window too, so post time leaked into every
  // verdict: at 3 clips a day the length test's clips all went out at noon, its best clips at 17:00 and 20:00
  it("test and best clips meet every post-time window as often, at 3 and at 5 clips a day, and the test slot moves by date", () => {
    const cases = [
      { perDay: 3, settings: { ...ON, trialReels: false } },
      // length and ending fixed: the newcomer test, 1 clip in 5
      { perDay: 5, settings: { ...ON, trialReels: false, fixed: { length: "standard", ending: "resolved" } } },
    ];
    for (const { perDay, settings } of cases) {
      const r = runWorld({ seed: 71, perDay, settings, effect: () => 0, days: 60 });
      const count = { test: new Map<string, number>(), best: new Map<string, number>() };
      const places = new Set<number>();
      for (const plan of r.plans)
        for (const s of plan.slots) {
          if (s.lane !== "normal" || !s.membership?.id.startsWith("n") || s.membership.id.includes(".postTime.")) continue;
          const role = s.role === "test" ? "test" : "best";
          count[role].set(s.window.from, (count[role].get(s.window.from) ?? 0) + 1);
          if (role === "test") places.add(s.index);
        }
      const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
      expect(total(count.test), `${perDay} a day`).toBeGreaterThanOrEqual(30);
      for (const w of ["12:00", "17:00", "20:00"]) {
        const test = (count.test.get(w) ?? 0) / total(count.test);
        const best = (count.best.get(w) ?? 0) / total(count.best);
        // the review's world had test 1.0 at noon against best 0; with ~40 test clips a share's noise is about 0.07
        expect(Math.abs(test - best), `${perDay} a day, ${w}: test ${test.toFixed(2)} best ${best.toFixed(2)}`).toBeLessThan(0.2);
        expect(test, `${perDay} a day, ${w}`).toBeGreaterThan(0.15);
      }
      expect(places.size, `${perDay} a day`).toBeGreaterThan(1);
    }
  });

  it("\"spread\" walks noon, evening and night by date: at one clip a day, and around a post-time test's challenger", () => {
    // every run of 3 days (from a day index that is a multiple of 3) starts its days in each window once
    for (let run = 6919; run < 6929; run++) expect(new Set([0, 1, 2].map((i) => spreadWindows(3 * run + i, undefined)[0])).size).toBe(3);
    // the day's windows are distinct; quiet hours over 20:00 leave two, walked by twos
    expect(new Set(spreadWindows(20758, undefined)).size).toBe(3);
    const twoLeft = { from: "19:00", to: "08:00" };
    for (let run = 10379; run < 10389; run++) expect(new Set([0, 1].map((i) => spreadWindows(2 * run + i, twoLeft)[0]))).toEqual(new Set(["noon", "evening"]));
    // the lab runs, so the normal lane asks post time first: noon against "spread", at one clip a day
    const r = runWorld({ seed: 4, channels: [IG, TT], settings: ON, perDay: 1, effect: () => 0, days: 30 });
    const slots = r.plans.flatMap((p) => p.slots).filter((s) => s.membership?.id === "n0.postTime.spread.noon");
    const windowsOf = (arm: string) => new Set(slots.filter((s) => s.membership!.arm === arm).map((s) => s.window.from));
    expect(windowsOf("noon")).toEqual(new Set(["12:00"]));
    expect(windowsOf("spread")).toEqual(new Set(["12:00", "17:00", "20:00"]));
  });

  // with quiet hours that cover 10:00, the first pair's 10:00 reel could never go out (C11 refuses it as "missed its time"),
  // so every pair broke, and every block closed as "not enough clean pairs"
  it("Trial Reel pairs go out only outside quiet hours, at least 2 hours apart, and no pair is made where none fits", () => {
    expect(trialPairWindows({ from: "23:00", to: "07:00" })).toEqual([
      [{ from: "10:00", to: "10:30" }, { from: "12:30", to: "13:00" }],
      [{ from: "15:00", to: "15:30" }, { from: "17:30", to: "18:00" }],
    ]);
    expect(trialPairWindows({ from: "23:00", to: "11:00" })).toEqual([[{ from: "12:30", to: "13:00" }, { from: "15:00", to: "15:30" }]]);
    expect(trialPairWindows({ from: "13:00", to: "12:00" })).toEqual([]);
    const minute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    const quiet = { from: "23:00", to: "11:00" };
    const r = runWorld({ seed: 31, channels: [IG, TT], settings: { ...ON, pairsPerDay: 2 }, quiet, effect: () => 0, days: 6 });
    const reels = r.plans.flatMap((p) => p.slots.filter((s) => s.lane === "trialReel"));
    expect(reels.length).toBeGreaterThan(0);
    for (const reel of reels) expect(inQuietMinutes(minute(reel.window.from), quiet.from, quiet.to), reel.window.from).toBe(false); // C11's own rule
    for (const plan of r.plans) {
      const day = plan.slots.filter((s) => s.lane === "trialReel");
      expect(day.length).toBeLessThanOrEqual(2); // one pair fits the day, though two were asked for
      if (day.length === 2) expect(Math.abs(minute(day[0].window.from) - minute(day[1].window.from))).toBeGreaterThanOrEqual(PAIR_GAP_H * 60);
    }
    const none = runWorld({ seed: 31, channels: [IG, TT], settings: ON, quiet: { from: "13:00", to: "12:00" }, effect: () => 0, days: 2 });
    expect(none.plans.every((p) => !p.status.trialLane && p.block === null && p.slots.every((s) => s.lane === "normal"))).toBe(true);
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

describe("choosing the next test or block (nextTest)", () => {
  const T = Date.parse("2026-11-02T09:00:00Z");
  const BLOCK_ORDER = TEST_ORDER.trialReel.filter((d) => (activeDials() as readonly DialId[]).includes(d));
  const bests = () => bestsOf([], { fixed: {} }, CATALOG);
  const ctxOf = (known: readonly FeasibilityResult[] = [], over: Partial<NextTestContext> = {}): NextTestContext => ({ catalog: CATALOG, log: [], now: T, skipped: new Set(), locked: new Set(), feasibility: new Map(known.map((r) => [r.key, r])), formats: formatOrder(CATALOG), ...over });
  /** As the app runs it: the arms it asks for are planned with `planner`, and it is asked again until it needs none. */
  const settle = (order: readonly DialId[], max: number, planner: ArmPlanner = passAll, over: Partial<NextTestContext> = {}): NextTestChoice & { known: FeasibilityResult[] } => {
    let known: FeasibilityResult[] = [];
    for (let i = 0; i < 20; i++) {
      const pick = nextTest(order, max, bests(), ctxOf(known, over));
      if (!pick.needed.length) return { ...pick, known };
      known = [...known, ...checkArms(pick.needed, CATALOG, bests().joined, planner, known)];
    }
    throw new Error("nextTest never stopped asking");
  };
  const asked = (c: NextTestChoice) => c.questions.map((q) => `${q.dial}:${q.subject ?? q.challenger}`);

  it("asks for the arms it has not planned, with the questions chosen before them, and opens nothing until they are", () => {
    const first = nextTest(BLOCK_ORDER, 3, bests(), ctxOf());
    expect(first.questions).toEqual([]);
    expect(first.needed.map(armKey)).toEqual(["getOut|get-out-journey:rotation|standard|resolved", "getOut|get-out-journey:newcomer|standard|resolved"]);
    // the newcomer's arms planned: it is chosen, and the length's arms with it are asked for next
    const known = checkArms(first.needed, CATALOG, bests().joined, passAll);
    const second = nextTest(BLOCK_ORDER, 3, bests(), ctxOf(known));
    expect(asked(second)).toEqual(["newcomer:get-out-journey"]);
    expect(second.needed.map(armKey)).toEqual(["getOut|get-out-journey:newcomer|short|resolved", "getOut|get-out-journey:rotation|short|resolved"]);
    // a test of one question asks or chooses, never both
    const one = nextTest(["length"], 1, bests(), ctxOf());
    expect([one.questions.length, one.needed.length > 0]).toEqual([0, true]);
  });

  it("never puts the format and the newcomer in one block: both choose the template", () => {
    expect(asked(settle(["newcomer", "format"], 3))).toEqual(["newcomer:get-out-journey"]);
    expect(asked(settle(["format", "newcomer"], 3))).toEqual([`format:${formatOrder(CATALOG).filter((f) => f !== "mix")[0]}`]);
    // either alone opens
    expect(asked(settle(["format"], 3))).toHaveLength(1);
    // block 1 of the Trial Reel order: the Journey and the length; the format waits, and the ending cannot play the Journey
    expect(asked(settle(BLOCK_ORDER, 3))).toEqual(["newcomer:get-out-journey", "length:short"]);
  });

  it("swaps a dial whose arms no template plays on paper for the next one", () => {
    // the Journey is resolved only: no ending question can share its block, and nothing of the ending is planned
    const withJourney = settle(["newcomer", "ending"], 3);
    expect(asked(withJourney)).toEqual(["newcomer:get-out-journey"]);
    expect(withJourney.known.some((r) => r.key.includes("cliffhanger"))).toBe(false);
    expect(asked(settle(["ending"], 3))).toEqual(["ending:cliffhanger"]);
    // the Journey takes no long clip: of the length's challengers, short is chosen beside it, never long
    expect(asked(settle(["newcomer", "length"], 3))).toEqual(["newcomer:get-out-journey", "length:short"]);
    expect(asked(settle(["newcomer", "length"], 3, passAll, { skipped: new Set([questionKey("length", "standard", "short", null)]) }))).toEqual(["newcomer:get-out-journey"]);
  });

  it("swaps a question whose arms fail their plans for the next, then the dial for the next dial", () => {
    // the Journey's plans fail: Spiral Glass is the newcomer tried instead
    const noJourney: ArmPlanner = (p) => ({ pass: p.template !== "get-out-journey", pick: 70 });
    expect(asked(settle(["newcomer"], 1, noJourney))).toEqual(["newcomer:smash-spiral-glass"]);
    // short clips fail their plans: the length tries long instead
    const noShort: ArmPlanner = (p) => ({ pass: p.bucket !== "short", pick: 70 });
    expect(asked(settle(["length"], 1, noShort))).toEqual(["length:long"]);
    // every other length fails: the dial is swapped for the ending
    const standardOnly: ArmPlanner = (p) => ({ pass: p.bucket === "standard", pick: 70 });
    expect(asked(settle(["length", "ending"], 1, standardOnly))).toEqual(["ending:cliffhanger"]);
  });

  it("skips locked dials, takes the post time with nothing to plan, and stops at its most", () => {
    expect(nextTest(["postTime", "length"], 1, bests(), ctxOf())).toMatchObject({ needed: [] });
    expect(asked(nextTest(["postTime", "length"], 1, bests(), ctxOf()))).toHaveLength(1);
    expect(asked(nextTest(["postTime", "length"], 1, bests(), ctxOf()))[0]).toMatch(/^postTime:/);
    expect(asked(settle(["postTime", "length"], 1, passAll, { locked: new Set<DialId>(["postTime"]) }))).toEqual(["length:short"]);
    expect(asked(settle(["length", "ending", "format"], 2))).toEqual(["length:short", "ending:cliffhanger"]);
    expect(asked(settle(["length"], 3, passAll, { locked: new Set<DialId>(["length"]) }))).toEqual([]);
  });
});

/** The day each test or block first opened in a world's passes. */
const openedOn = (r: WorldResult) => {
  const m = new Map<string, string>();
  for (const p of r.plans) for (const t of [p.test, p.block]) if (t && !m.has(t.id)) m.set(t.id, p.date);
  return m;
};
const firstOpened = (r: WorldResult, re: RegExp) => [...openedOn(r)].find(([id]) => re.test(id))?.[1] ?? null;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

// The plan: post time is "12-14, 17-19 or 20-22 local, never in quiet hours". The night arm was offered whatever the quiet
// hours, so with quiet hours from 20:00 its test clips were planned inside them, could never go out in their window, and the
// test never closed (open from 2026-11-23 to 2027-04-09 with no clip counted)
describe("post time and quiet hours", () => {
  const evening = { from: "20:00", to: "07:00" };
  const minute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const postTime = (challenger: string, best = "spread"): Question => ({ dial: "postTime", best, challenger, subject: null });

  it("a post-time arm is a window that starts outside quiet hours; a best inside them goes back to spread", () => {
    expect(postTimeOpen("night", evening)).toBe(false);
    expect(postTimeOpen("night", { from: "19:30", to: "07:00" })).toBe(false);
    expect(postTimeOpen("noon", { from: "22:00", to: "12:30" })).toBe(false);
    expect(postTimeOpen("night", { from: "21:00", to: "07:00" })).toBe(true); // its clips go out at 20:00
    expect(postTimeOpen("night", undefined)).toBe(true);
    expect(postTimeOpen("spread", { from: "00:00", to: "23:59" })).toBe(true);
    const night = verdict({ testId: "n0.postTime.spread.night", dial: "postTime", best: "spread", challenger: "night" });
    expect(bestsOf([night], { fixed: {} }).arms.postTime).toBe("night");
    expect(bestsOf([night], { fixed: {} }, CATALOG, evening).arms.postTime).toBe("spread");
    expect(bestsOf([], { fixed: { postTime: "night" } }, CATALOG, evening).arms.postTime).toBe("spread");
    // nextTest offers night only outside quiet hours
    const ctx: NextTestContext = { catalog: CATALOG, log: [], now: T0, skipped: new Set([questionKey("postTime", "spread", "noon"), questionKey("postTime", "spread", "evening")]), locked: new Set(), feasibility: new Map(), formats: formatOrder(CATALOG) };
    expect(nextTest(["postTime"], 1, bestsOf([], { fixed: {} }), ctx).questions).toEqual([postTime("night")]);
    expect(nextTest(["postTime"], 1, bestsOf([], { fixed: {} }), { ...ctx, quiet: evening }).questions).toEqual([]);
  });

  it("with quiet hours over a window no test of it opens, no clip is planned inside them, and the post-time tests close", () => {
    for (const quiet of [evening, { from: "19:30", to: "07:00" }, { from: "22:00", to: "12:30" }]) {
      const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, quiet, effect: () => 0, days: 70 });
      for (const s of r.plans.flatMap((p) => p.slots)) expect(inQuietMinutes(minute(s.window.from), quiet.from, quiet.to), `${quiet.from}: ${s.window.from}`).toBe(false);
      const tests = [...openedOn(r).keys()].filter((id) => id.includes(".postTime."));
      expect(tests.length, quiet.from).toBeGreaterThanOrEqual(2);
      for (const id of tests) expect(postTimeOpen(parseTestId(id)!.questions[0].challenger, quiet), id).toBe(true);
      const verdicts = r.decisions.filter((d) => d.dial === "postTime");
      expect(verdicts.length, quiet.from).toBeGreaterThanOrEqual(2);
      expect(verdicts.every((d) => d.verdict !== "stopped" && d.nTest === NORMAL_TEST_CLIPS)).toBe(true);
    }
  });

  it("a night test open when quiet hours move over 20:00 stops at once, rests nothing, and plans no clip at night", () => {
    const lost = (seq: number, challenger: string) => verdict({ testId: `n${seq}.postTime.spread.${challenger}`, dial: "postTime", best: "spread", challenger, verdict: "notKept", decidedAt: iso(T0 - 5 * DAY) });
    const decisions = [lost(0, "noon"), lost(1, "evening")];
    const r = runWorld({ seed: 81, channels: [IG, TT], settings: ON, decisions, effect: () => 0, days: 4 });
    expect(r.plans[r.plans.length - 1].test?.id).toBe("n2.postTime.spread.night");
    const plan = learnPass({ ...r.input, quiet: evening })!;
    expect(plan.verdicts.map((v) => [v.testId, v.verdict])).toEqual([["n2.postTime.spread.night", "stopped"]]);
    expect(plan.test).toBeNull(); // noon and evening rest, and night is shut out
    for (const s of plan.slots) expect(inQuietMinutes(minute(s.window.from), evening.from, evening.to), s.window.from).toBe(false);
    const log = [...r.input.decisions, ...plan.verdicts];
    expect(restsUntil(postTime("night"), log, "normal")).toBe(0);
    // the quiet hours move back: night is asked again at once, as a new test
    const again = learnPass({ ...r.input, decisions: log })!;
    expect(again.test?.id).toBe("n3.postTime.spread.night");
  });
});

// A block that could not make its pairs (Trial Reels switched off, or no numbers coming) held its dials away from the normal
// lane for 21 days, then rested them 60 days in both lanes, and a new block opened at once: with no Trial Reel numbers the
// normal lane first tested short clips on 2027-01-22 and never the Journey in 150 days
describe("a lab that cannot make its pairs", () => {
  const short = /^n\d+\.length\.standard\.short$/;
  const journey = /^n\d+\.newcomer\.rotation\.newcomer\.get-out-journey$/;

  it("'not enough clean pairs' rests a question in the lab only, 'not enough clips' in the normal lane only, 'stopped' nowhere", () => {
    const pairs = verdict({ testId: "t0.length.standard.short", lane: "trialReel", verdict: "notEnoughPairs" });
    expect(restsUntil(length, [pairs], "trialReel")).toBe(T0 + REST_DAYS * DAY);
    expect(restsUntil(length, [pairs], "normal")).toBe(0);
    const clips = verdict({ verdict: "notEnoughClips" });
    expect(restsUntil(length, [clips], "normal")).toBe(T0 + REST_DAYS * DAY);
    expect(restsUntil(length, [clips], "trialReel")).toBe(0);
    const stopped = verdict({ verdict: "stopped" });
    expect(restsUntil(length, [stopped], "normal")).toBe(0);
    expect(restsUntil(length, [stopped])).toBe(0);
    // an earlier answer still rests it, and a stopped test says nothing on the card
    const kept = verdict({ decidedAt: iso(T0 - DAY) });
    expect(restsUntil(length, [kept, stopped], "normal")).toBe(T0 - DAY + REST_DAYS * DAY);
    expect(findingsOf([kept, stopped]).map((f) => f.key)).toEqual(["Learner.findings.length.kept"]);
  });

  it("no Trial Reel numbers: the normal lane asks the whole list almost as soon as without Trial Reels", () => {
    const off = runWorld({ seed: 8, channels: [IG, TT], settings: { ...ON, trialReels: false }, effect: () => 0, days: 50 });
    const zeros = runWorld({ seed: 8, channels: [IG, TT], settings: ON, zeroTrials: true, effect: () => 0, days: 50 });
    expect([firstOpened(off, short), firstOpened(off, journey)]).toEqual(["2026-11-01", "2026-12-04"]);
    // with the lab running on day 0 the normal lane's first test is post time: one test later (11 days) it has the whole list
    expect([firstOpened(zeros, short), firstOpened(zeros, journey)]).toEqual(["2026-11-12", "2026-12-15"]);
    expect(daysBetween(firstOpened(off, short)!, firstOpened(zeros, short)!)).toBeLessThanOrEqual(14);
    expect(daysBetween(firstOpened(off, journey)!, firstOpened(zeros, journey)!)).toBeLessThanOrEqual(14);
  });

  it("no Trial Reel numbers: block 1 closes the day it knows, and a block tries again only TRIAL_PAUSE_DAYS on", () => {
    const zeros = runWorld({ seed: 8, channels: [IG, TT], settings: ON, zeroTrials: true, effect: () => 0, days: 106 });
    const trial = zeros.decisions.filter((d) => d.lane === "trialReel");
    expect(trial.every((d) => d.verdict === "notEnoughPairs")).toBe(true);
    expect(trial[0].decidedAt.slice(0, 10)).toBe(zeros.plans.find((p) => p.status.trialPause)!.date);
    const blocks = [...openedOn(zeros)].filter(([id]) => id.startsWith("t")).map(([, d]) => d);
    expect(blocks).toEqual(["2026-11-01", "2026-12-05", "2027-01-08", "2027-02-11"]);
    for (let i = 1; i < blocks.length; i++) expect(daysBetween(blocks[i - 1], blocks[i])).toBeGreaterThanOrEqual(TRIAL_PAUSE_DAYS);
    // while it waits nothing of the lab's is open, locked or posted: a clip's locked dials are the normal lane's test's alone
    const paused = zeros.plans.filter((p) => p.status.trialPause);
    expect(paused.length).toBe(90);
    for (const p of paused) {
      expect([p.block, p.status.trialLane, p.slots.some((s) => s.lane === "trialReel")]).toEqual([null, false, false]);
      expect(p.slots.every((s) => s.locked.every((d) => p.test?.questions.some((q) => q.dial === d)))).toBe(true);
    }
    expect(zeros.posts.filter((p) => p.lane === "trialReel").length).toBe(32); // 4 blocks of 4 pairs
  });

  it("the owner's 'Try Trial Reels again' lifts the pause at once, until the new block's own pair shows none", () => {
    const at = Date.parse("2026-11-11T08:00:00Z");
    const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, zeroTrials: true, settingsAt: (d) => (d >= 10 ? { ...ON, trialRetryAt: iso(at) } : null), effect: () => 0, days: 20 });
    expect([...openedOn(r)].filter(([id]) => id.startsWith("t")).map(([, d]) => d)).toEqual(["2026-11-01", "2026-11-11"]);
    expect(r.plans.map((p) => (p.status.trialPause ? "P" : ".")).join("")).toBe("....PPPPPP....PPPPPP");
  });

  it("Trial Reels switched off mid-block: the block stops that day, rests nothing, and the normal lane asks the length next", () => {
    const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, settingsAt: (d) => (d >= 5 ? { ...ON, trialReels: false } : null), effect: () => 0, days: 30 });
    const t0 = r.decisions.filter((d) => d.testId.startsWith("t0."));
    expect(t0.map((d) => [d.dial, d.verdict, d.decidedAt.slice(0, 10)])).toEqual([
      ["newcomer", "stopped", "2026-11-06"],
      ["length", "stopped", "2026-11-06"],
    ]);
    const then = r.decisions.slice(0, r.decisions.indexOf(t0[1]) + 1);
    for (const q of parseTestId(t0[0].testId)!.questions) for (const lane of ["normal", "trialReel"] as const) expect(restsUntil(q, then, lane), `${q.dial} ${lane}`).toBe(0);
    expect(r.plans.filter((p) => p.date >= "2026-11-06").every((p) => p.block === null && p.slots.every((s) => s.lane === "normal"))).toBe(true);
    // the post-time test opened while the lab ran closes, then the whole list: the length first
    expect(r.decisions.filter((d) => d.lane === "normal").map((d) => d.testId).slice(0, 2)).toEqual(["n0.postTime.spread.noon", "n1.length.standard.short"]);
  });
});

// Trial Reels that Postiz answers with [] counted as no numbers only at 168 h ("not measured"), so each block posted about 16
// reels with no numbers (32 in 40 days) where zeros paused it after 8
describe("Trial Reels with no answer", () => {
  it("a reel with no answer at its 3-day read has no numbers, and the lab pauses as early as on zeros", () => {
    const pending: PostMeasure = { postId: "a", channelId: "ig1", platform: "instagram", lane: "trialReel", publishedAt: T0, state: "pending" };
    expect(numbersOf({ ...pending, noAnswer: true })).toBe(false);
    expect(numbersOf(pending)).toBeNull();
    expect(numbersOf(undefined)).toBeNull();
    const world = (o: { zeroTrials?: boolean; noTrialAnswer?: boolean }) => runWorld({ seed: 8, channels: [IG, TT], settings: ON, ...o, effect: (p) => (p.lane === "trialReel" && p.template === "get-out-journey" ? Math.log(3) : 0), days: 40 });
    const zeros = world({ zeroTrials: true });
    const none = world({ noTrialAnswer: true });
    const reels = (r: WorldResult) => r.posts.filter((p) => p.lane === "trialReel").length;
    const firstPause = (r: WorldResult) => r.plans.find((p) => p.status.trialPause)!.date;
    expect([reels(zeros), reels(none)]).toEqual([16, 12]);
    expect(reels(none)).toBeLessThanOrEqual(20);
    expect([firstPause(zeros), firstPause(none)]).toEqual(["2026-11-05", "2026-11-04"]);
    expect(none.plans.filter((p) => p.status.trialPause).every((p) => p.status.trialPause === "noTrialNumbers")).toBe(true);
    expect(none.decisions.filter((d) => d.lane === "trialReel").every((d) => d.verdict === "notEnoughPairs")).toBe(true);
    expect(none.plans[none.plans.length - 1].joined).toEqual([]);
    // the newest pair whose numbers are known decides, across blocks: here the last block's, with none
    expect(newestTrialNumbers(none.posts, new Map())).toBeNull();
    const measures = new Map(measureRows(none.input.rows, none.input.now).map((m) => [`${m.postId}|${m.channelId}`, m]));
    const newest = newestTrialNumbers(none.posts, measures)!;
    expect(newest.numbers).toBe(false);
    expect(newest.at).toBe(Math.max(...none.posts.filter((p) => p.lane === "trialReel").map((p) => Date.parse(p.approvedAt)))); // the last pair made, before the pause
  });
});

// A normal test or check decided only once its clips were scored, and nothing closed one that could not get there: a template
// withdrawn mid-test, or reads that never come, held the normal lane for good
describe("a normal test that cannot finish", () => {
  it("a template withdrawn mid-test: its newcomer test stops that day and the next test opens", () => {
    const r = runWorld({ seed: 8, channels: [IG, TT], settings: { ...ON, trialReels: false }, catalogAt: (d) => (d >= 36 ? CATALOG.filter((t) => t.id !== "get-out-journey") : CATALOG), effect: () => 0, days: 60 });
    const journey = r.decisions.find((d) => d.subject === "get-out-journey")!;
    expect([journey.testId, journey.verdict, journey.decidedAt.slice(0, 10)]).toEqual(["n3.newcomer.rotation.newcomer.get-out-journey", "stopped", "2026-12-07"]);
    expect(openedOn(r).get("n4.newcomer.rotation.newcomer.smash-spiral-glass")).toBe("2026-12-07");
    expect(r.decisions.find((d) => d.testId.startsWith("n4."))?.verdict).toBe("kept");
  });

  it("clips whose numbers never come: the test closes as 'not enough clips' after NORMAL_HORIZON_TIMES its horizon, and the next opens", () => {
    const r = runWorld({ seed: 8, channels: [IG, TT], settings: { ...ON, trialReels: false }, effect: () => 0, days: 4 });
    const open = r.plans[r.plans.length - 1].test!;
    expect(open.id).toBe("n0.length.standard.short");
    // the app is not opened again for weeks: no read after the 4th day, so its clips are never measured
    const at = (days: number) => ({ ...r.input, now: r.input.now + days * DAY, date: dateOf(r.input.now + days * DAY) });
    expect(NORMAL_HORIZON_TIMES * ((NORMAL_TEST_CLIPS * TEST_EVERY) / 3 + 3)).toBe(33); // days, at 3 clips a day, from its first clip on day 0
    const still = learnPass(at(29))!;
    expect([still.verdicts, still.test?.id]).toEqual([[], open.id]);
    const closed = learnPass(at(31))!;
    expect(closed.verdicts.map((v) => [v.testId, v.verdict])).toEqual([[open.id, "notEnoughClips"]]);
    expect(restsUntil(length, closed.verdicts, "normal")).toBe(Date.parse(closed.verdicts[0].decidedAt) + REST_DAYS * DAY);
    expect(restsUntil(length, closed.verdicts, "trialReel")).toBe(0);
    const input = at(31);
    const planned = checkArms(closed.feasibilityNeeded, CATALOG, new Set(closed.joined), passAll, input.feasibility);
    const next = learnPass({ ...input, decisions: closed.verdicts, feasibility: [...(input.feasibility ?? []), ...planned] })!;
    expect(next.test?.id).toBe("n1.length.standard.long");
  });
});

// sim/l0.py 3 reads the check on exactly 4 old against 12 new clips. At 3 clips a day the fallback past the 16th place made
// old clips from a count fixed for the pass, so 58 % of checks read 5 or 6 old clips, and two old clips on one day share its
// luck: a change that does nothing went back 0.157 of the time against l0's 0.106 (300 worlds)
describe("the combined check at 3 clips a day", () => {
  const kept = verdict({ testId: "t0.length.standard.short", lane: "trialReel", decidedAt: iso(T0 - DAY) });
  const check = (seed: number, ratio: number) => runWorld({ seed, perDay: 3, settings: { ...ON, trialReels: false }, decisions: [kept], until: (v) => v.testId.startsWith("c"), days: 40, effect: (p) => (p.lane === "normal" && p.bucket === "short" ? Math.log(ratio) : 0) });

  it("makes exactly 4 old clips, never two in a day, and reads 4 against 12", () => {
    // its seeded order puts old clips at places 6, 9, 10 and 15: 9 and 10 fall on one day at 3 clips a day
    expect(checkOrder("c0.t0.length.standard.short").map((a) => a[0]).join("")).toBe("nnnnnnonnoonnnno");
    for (let w = 0; w < 6; w++) {
      const r = check(60000 + w, 1);
      const v = r.decisions.find((d) => d.testId.startsWith("c"))!;
      expect([v.testId, v.nBest, v.nTest]).toEqual(["c0.t0.length.standard.short", CHECK_OLD, CHECK_POSTS - CHECK_OLD]);
      const old = r.posts.filter((p) => p.test?.id === v.testId && p.test.arm === "old");
      const days = new Map<string, Set<string>>();
      for (const p of old) days.set(p.approvedAt.slice(0, 10), new Set([...(days.get(p.approvedAt.slice(0, 10)) ?? []), p.clipId]));
      expect([...days.values()].map((s) => s.size)).toEqual([1, 1, 1, 1]);
    }
  });

  // l0.py 3: x0.5 0.465, no difference 0.106, x2 0.011. A change that does nothing or truly wins goes back no more often (1000
  // worlds: 0.117 and 0.003); a real loss goes back more often here (0.571), as each clip is the mean of two channels and old
  // and new clips share their days. 150 worlds each
  const W = 150;
  const wentBack = (ratio: number) => Array.from({ length: W }, (_, w) => check(60000 + w, ratio).decisions.find((d) => d.testId.startsWith("c"))!.verdict).filter((v) => v === "wentBack").length;
  it("a change that does nothing goes back as rarely as in l0.py", () => {
    const back = wentBack(1);
    expect(back).toBe(16);
    expect(back / W).toBeLessThanOrEqual(0.106 + 0.05);
  });

  it("a change that truly wins almost never goes back", () => {
    const back = wentBack(2);
    expect(back).toBe(0);
    expect(back / W).toBeLessThanOrEqual(0.011 + 0.02);
  });

  it("a change followers like half as much goes back at least as often as in l0.py", () => {
    const back = wentBack(0.5);
    expect(back).toBe(89);
    expect(back / W).toBeGreaterThanOrEqual(0.465 - 0.05);
  });
});

// "Forget my numbers" deletes the numbers and the decision log, but the audit keeps each post's test membership: with an empty
// log the old ids matched again, and the next passes closed the forgotten tests as "not enough clean pairs", resting every
// question 60 days, and a fresh block shared its id with an old one
describe("after Forget my numbers", () => {
  const r = runWorld({ seed: 8, channels: [IG, TT], settings: ON, effect: (p) => (p.lane === "trialReel" && p.template === "get-out-journey" ? Math.log(3) : 0), days: 60 });
  const passes = (generation: number) => {
    let decisions: LearnerDecision[] = [];
    const plans = [];
    for (let d = 1; d <= 4; d++) {
      const now = r.input.now + d * DAY;
      const plan = learnPass({ ...r.input, now, date: dateOf(now), decisions, settings: { ...r.input.settings, generation } })!;
      decisions = [...decisions, ...plan.verdicts];
      plans.push(plan);
    }
    return plans;
  };

  it("test ids carry the generation, and a check's its test's", () => {
    const n = testIdOf("normal", 0, [length], undefined, 2);
    expect(n).toBe("n0g2.length.standard.short");
    expect(parseTestId(n)).toMatchObject({ kind: "normal", seq: 0, generation: 2, questions: [length] });
    expect(parseTestId("n0.length.standard.short")?.generation).toBe(0);
    const c = testIdOf("check", 3, [], n, 2);
    expect(c).toBe("c3g2.n0g2.length.standard.short");
    expect(parseTestId(c)).toMatchObject({ kind: "check", seq: 3, generation: 2, source: { id: n } });
    for (const bad of ["c3.n0g2.length.standard.short", "c3g2.n0.length.standard.short", "n0g0.length.standard.short", "n0g12345.length.standard.short"]) expect(parseTestId(bad), bad).toBeNull();
  });

  it("the next passes write no verdict for a forgotten test and open the first tests anew from today's defaults", () => {
    expect(r.decisions.length).toBeGreaterThan(10);
    const plans = passes(1);
    expect(plans.flatMap((p) => p.verdicts)).toEqual([]);
    for (const p of plans) {
      expect([p.test?.id, p.block?.id]).toEqual(["n0g1.postTime.spread.noon", "t0g1.newcomer.rotation.newcomer.get-out-journey~length.standard.short"]);
      expect(p.best).toEqual({ length: "standard", ending: "resolved", format: "mix", newcomer: "rotation", postTime: "spread" });
      expect(p.joined).toEqual([]);
      expect([p.test?.nTest, p.test?.pending, p.block?.clean, p.block?.pending]).toEqual([0, 0, 0, 0]);
    }
    // without the new generation the old memberships came back: verdicts on forgotten tests
    expect(passes(0).flatMap((p) => p.verdicts).length).toBeGreaterThan(0);
  });
});

describe("the app's main process", () => {
  it("bundles learner.ts with none of the page: only the learner's own pure modules (the decision log's shapes live here)", async () => {
    const esbuild = await import("esbuild");
    const root = path.join(__dirname, "..");
    // the main process's own settings (desktop/scripts/build.mjs)
    const result = await esbuild.build({ entryPoints: [path.join(root, "src/lib/insights/learner.ts")], bundle: true, write: false, platform: "node", target: "node22", format: "esm", alias: { "@": path.join(root, "src") }, metafile: true, logLevel: "error" });
    const inputs = Object.keys(result.metafile.inputs).map((f) => path.relative(root, path.resolve(root, f)).split(path.sep).join("/"));
    expect(inputs).toContain("src/lib/insights/learner.ts");
    expect(inputs).toContain("src/lib/insights/feasibility.ts");
    expect(inputs.filter((f) => !f.startsWith("src/lib/insights/"))).toEqual([]);
    expect(inputs).not.toContain("src/lib/insights/feasibilityPlanner.ts");
    expect(inputs).not.toContain("src/lib/insights/score.ts");
  });
});

// --- end learner ---
