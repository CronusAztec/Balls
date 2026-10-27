import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  COUNTER_CAPTIONS,
  HOOK_LOOK_SEC,
  HOOK_START_SEC,
  HOOK_WINDOW_SEC,
  SCORE_PAYOFF_REACH_SEC,
  SCORE_PLAN_FIELDS,
  SCORE_RUN_MARGIN_SEC,
  captionRolesOf,
  factsOfExport,
  hookedSettings,
  mergeFacts,
  planLikeFromSettings,
  platformForBucket,
  platformOf,
  runFactsOf,
  runFactsSync,
  scoreOfSettings,
  scorePlanLike,
  scoreRecipeFor,
  scoreRecipeOf,
  scoreSavedClip,
  scoresFromSettings,
  type ScoreFacts,
} from "@/lib/insights/score";
import { GENE_CHECKLIST, GENE_COUNTDOWN_KINDS, GENE_REASON_KEYS, bucketOfSeconds, genesWithScore, reasonsOf, sanitizeGenes, type ClipGenes } from "@/lib/insights/genes";
import { BOT_PLATFORMS, CHECKLIST, COUNTDOWN_KINDS, HOOK_SEC, LENGTH_BUCKETS, PLATFORMS, RECIPES } from "@/lib/bot/playbook";
import { FACTS_SLICE_STEPS, drain, edgeTextBox, hasTopHud, planClip, scoreClip, simulateFacts, simulateFactsSteps, type ClipPlan } from "@/lib/bot/planner";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultCaption, type Caption } from "@/lib/captions";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS } from "@/lib/physics/types";
import { aiClipSource, planSource, seedSource } from "@/lib/desktop/queueSources";
import { genesOfSavedFile } from "@/lib/insights/genes";
import { PlanStore, makeVideosTools } from "@/lib/desktop/ai/studio";
import { EMPTY_QUEUE, enqueue, expandBatch, journalOf, markDone, markRendering, restoreQueue } from "@/lib/desktop/renderQueue";
import en from "../messages/en.json";

/*
 * --- insights --- A score on every clip (lib/insights/score.ts, C6 part 2 of the AI platform): the viral bot's checklist
 * score for a clip with no plan. These tests prove the plan-like holds exactly what scoreClip reads, that a bot plan scored
 * from its settings and its run alone gets its own verdicts (the caption roles, the run's facts and the ending all come out
 * as the planner had them), that a link's or the page's clip gets a 0–100 score with reasons in its genes, and that the run
 * in slices is the very run the planner simulates.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;
const melodyOf = (plan: ClipPlan) => plan.melodyId ?? (RECIPES.find((r) => r.id === plan.recipe)?.musicFirst ? "ladder" : "none");
const caption = (type: Caption["type"], text: string, start: number, end = 0): Caption => ({ ...defaultCaption(type, { text }), start, end });
const quickPlans = () => RECIPES.flatMap((recipe) => (["resolved", "cliffhanger"] as const).map((ending) => planClip(recipe, 17, "reels", { copy, ending, search: false, episode: 3 })));

describe("the plan-like", () => {
  it("holds every field scoreClip reads and nothing it does not: a recording proxy over real plans", () => {
    const read = new Set<string>();
    const watch = <T extends object>(target: T, prefix: string): T =>
      new Proxy(target, {
        get(obj, key, receiver) {
          if (typeof key === "string") read.add(prefix + key);
          const value = Reflect.get(obj, key, receiver);
          return prefix === "" && typeof key === "string" && ["countdown", "timing", "payoff"].includes(key) && value && typeof value === "object" ? watch(value as object, `${key}.`) : value;
        },
      });
    for (const plan of quickPlans()) {
      const plain = scoreClip(plan);
      expect(scoreClip(watch(plan, ""))).toEqual(plain);
    }
    const tops = new Set(SCORE_PLAN_FIELDS.map((f) => f.split(".")[0]));
    const nested = [...read].filter((k) => k.includes("."));
    const top = [...read].filter((k) => !k.includes("."));
    expect(top.filter((k) => !tops.has(k))).toEqual([]);
    expect(nested.filter((k) => !(SCORE_PLAN_FIELDS as readonly string[]).includes(k))).toEqual([]);
    // and every field it lists is read by some verdict
    expect(SCORE_PLAN_FIELDS.filter((f) => !read.has(f))).toEqual([]);
  });

  it("scores a bot plan's own fields as scoreClip scores the plan", () => {
    for (const plan of quickPlans()) {
      const like = { settings: plan.settings, recipe: plan.recipe, platform: plan.platform, bucket: plan.bucket, ending: plan.ending, episode: plan.episode, melodyId: plan.melodyId, captionRoles: plan.captionRoles, countdown: { kind: plan.countdown.kind, source: plan.countdown.source }, timing: { clipSec: plan.timing.clipSec, firstImpactSec: plan.timing.firstImpactSec }, payoff: { atSec: plan.payoff.atSec, position: plan.payoff.position, cutGapSec: plan.payoff.cutGapSec } };
      expect([plan.id, scorePlanLike(like)]).toEqual([plan.id, { score: plan.score, reasons: plan.reasons }]);
    }
  });
});

describe("the captions' roles", () => {
  it("come out as the planner gave them, for every recipe and both endings", () => {
    for (const plan of quickPlans()) expect([plan.id, captionRolesOf(plan.settings.captions)]).toEqual([plan.id, plan.captionRoles]);
  });

  it("read a counter as the countdown, an early caption as the hook, then a question, a number token, a question mark", () => {
    const roles = captionRolesOf([
      caption("text", "Can it escape 5 rings?", 0, 2.5), // hook (its digit does not make it a countdown: it enters at the start)
      caption("text", "Second line of the hook", HOOK_START_SEC, 2.5), // hook: the edge counts
      caption("wallCounter", "Walls left", 0), // a counter at the start is still the countdown
      caption("text", "Late", HOOK_WINDOW_SEC), // not the hook any more: it enters as the hook's window closes – the payoff's words
      caption("question", "Will it make it in 10 s?", 8), // a question caption, digit or not
      caption("text", "3 walls to go", 4), // a number token
      caption("text", "[n] left", 4), // a counter's placeholder
      caption("text", "Who wins?", 9), // asks
      caption("text", "¿Quién gana", 9), // asks (Spanish)
      caption("text", "Out!", 12), // the payoff's words
    ]);
    expect(roles).toEqual(["hook", "hook", "countdown", "payoff", "question", "countdown", "countdown", "question", "question", "payoff"]);
    for (const type of COUNTER_CAPTIONS) expect(captionRolesOf([caption(type, "", 6)])).toEqual(["countdown"]);
    expect(captionRolesOf([])).toEqual([]);
  });

  // --- insights --- (review fix) a hook that enters a moment late is still the hook, and only a question on screen at the clip's
  // end is its closing question (the bot's enters 2 s before the end and stays)
  it("read a caption entering inside the hook's window as the hook, and a question as the closing one only while it is on screen at the end", () => {
    expect(HOOK_WINDOW_SEC).toBe(HOOK_SEC.max);
    const roles = captionRolesOf(
      [
        caption("text", "Can it escape?", 0.3, 3), // a late hook (it asks, and it has left long before the end)
        caption("question", "Will it make it?", HOOK_WINDOW_SEC - 0.01, 2.99), // still inside the window: the hook
        caption("question", "Gone by the end?", 6, 9), // a question that has left by the end: the payoff's words
        caption("text", "Who wins?", 6, 9), // the same for a question mark
        caption("text", "Who wins now?", 6, 20), // on screen to the clip's end: the closing question
        caption("question", "And now?", 18), // no end of its own: on screen to the end
      ],
      20,
    );
    expect(roles).toEqual(["hook", "hook", "payoff", "payoff", "question", "question"]);
    // without the clip's length only a caption with no end of its own is on screen at the end
    expect(captionRolesOf([caption("text", "Who wins now?", 6, 20), caption("question", "And now?", 18)])).toEqual(["payoff", "question"]);
  });

  // --- insights --- (review fix) a caption that enters at or after the clip's end is never on screen: no role scoreClip reads
  it("read a caption that enters at or after the clip's end as none of the hook, the countdown or the closing question", () => {
    const captions = [caption("text", "Can it escape?", 0, 2.5), caption("question", "Will it get out?", 25), caption("text", "Who wins?", 20), caption("wallCounter", "Walls", 25), caption("text", "3 left", 21), caption("countdown", "", 19.99)];
    expect(captionRolesOf(captions, 20)).toEqual(["hook", "payoff", "payoff", "payoff", "payoff", "countdown"]);
    expect(captionRolesOf(captions)).toEqual(["hook", "question", "question", "countdown", "countdown", "countdown"]); // (no length: every one is shown)
    expect(captionRolesOf([caption("text", "A late hook", 2, 2.9)], 1.5)).toEqual(["payoff"]); // a clip shorter than its hook's start
  });
});

// --- insights --- (review fix) what a clip never shows scores nothing: the closing question an AI clip's plan kept after
// set_clip_settings cut it short gave it the cliffhanger's points (12 + 10 of 20 + 20 for a question nobody saw)
describe("a caption that enters after the clip's end", () => {
  it("counts for nothing in a page clip's score: a question, a question mark or a counter set past its end", () => {
    const hook = { ...caption("text", "Can it escape?", 0, 2.5), position: "top" as const };
    const page = { ...defaultSettings("classic"), recordingDuration: 20, captions: [hook] };
    const facts: ScoreFacts = { firstImpactSec: 0.3, payoffSec: null, clipSec: 20 };
    const plain = scoreOfSettings(page, facts);
    for (const late of [caption("question", "Will it get out?", 25), caption("text", "Who wins?", 20), caption("wallCounter", "Walls", 25), caption("progress", "", 22), caption("countdown", "[time]", 20)]) {
      expect([late.type, late.start, scoreOfSettings({ ...page, captions: [hook, late] }, facts)]).toEqual([late.type, late.start, plain]);
    }
    // the same question entering before the end is the closing question
    const asked = scoreOfSettings({ ...page, captions: [hook, caption("question", "Will it get out?", 18)] }, facts);
    expect([plain.reasons.find((r) => r.id === "ending")?.key, asked.reasons.find((r) => r.id === "ending")?.key]).toEqual(["endingLongTail", "endingQuestion"]);
    expect(asked.score).toBeGreaterThan(plain.score);
  });

  it("counts for nothing in an AI clip set_clip_settings cut short: its plan's closing question enters after its file ends", async () => {
    const ring = planClip(RECIPES.find((r) => r.id === "ring-escape")!, 17, "reels", { copy, ending: "cliffhanger", episode: 3, maxSeeds: 6 });
    const question = ring.settings.captions[ring.captionRoles.indexOf("question")];
    expect([ring.ending, question.end]).toEqual(["cliffhanger", 0]);
    expect(question.start).toBeGreaterThan(11);
    const store = new PlanStore();
    store.add(ring);
    await makeVideosTools(store, { planClips: async () => [ring], findSimulation: async () => ({ found: false, seed: ring.seed, durationSec: 0 }) }).find((t) => t.name === "set_clip_settings")!.run({ planId: ring.id, changes: [{ setting: "recordingDuration", value: 11 }] }, { signal: undefined, progress: () => {} } as never);
    const short = store.get(ring.id)!;
    expect(short.settings.captions).toEqual(ring.settings.captions); // (set_clip_settings moves no caption)
    const save = (settings: SimulatorSettings) => {
      const clip = { ...short, settings };
      const genes = aiClipSource({ planId: clip.id, name: "x", title: "x", hook: clip.hook, caption: "Will it?", hashtags: ["#a"], platform: "reels" }, clip).meta!.genes!;
      return scoreSavedClip(genesOfSavedFile(genes, { durationSec: 11, cut: "master" }), { settings, seed: clip.seed, world: clip.world, durationSec: 11, features: null, platform: "reels", melody: null, pause: async () => {} });
    };
    const saved = await save(short.settings);
    const shown = await save({ ...short.settings, captions: short.settings.captions.filter((c) => c.start < 11) });
    expect(saved.reasons?.ending?.key).not.toBe("endingQuestion");
    expect(saved.reasons?.payoff?.key).not.toBe("payoffNever");
    expect([saved.planScore, saved.reasons, saved.ending]).toEqual([shown.planScore, shown.reasons, shown.ending]);
  });
});

describe("a bot plan scored from its settings and its run alone", () => {
  // the planner's real search (a few seeds a clip) for every recipe and both endings
  const plans = RECIPES.flatMap((recipe) => (["resolved", "cliffhanger"] as const).map((ending) => planClip(recipe, 17, "reels", { copy, ending, episode: 3, maxSeeds: 6 })));
  // each plan's seed run again from its settings alone, in the plan's world
  const runs = plans.map((plan) => runFactsSync(plan.settings, plan.seed, plan.world));

  it("replays the planner's run: the same first impact and the same payoff", () => {
    plans.forEach((plan, k) => expect([plan.id, runs[k].firstImpactSec, runs[k].payoffSec]).toEqual([plan.id, plan.timing.firstImpactSec, plan.payoff.atSec]));
  });

  // --- insights --- (review fix) Ball Drop's payoff is its run's end less its rest: a cut 1.2–1.4 s before it was read as none
  // (the planner's real search, as above: reels and TikTok cliffhangers whose best seed is cut 1.2 and 1.4 s before the payoff)
  const drops = (["reels", "tiktok"] as const).map((platform) => planClip(RECIPES.find((r) => r.id === "drop-symphony")!, 5, platform, { copy, ending: "cliffhanger", episode: 3, maxSeeds: 6 }));
  it("gives a Ball Drop cliffhanger cut 1–1.5 s before its payoff the plan's own payoff verdict", () => {
    for (const plan of drops) {
      const own = plan.reasons.find((r) => r.id === "payoff")!;
      expect([plan.platform, own.key, plan.payoff.cutGapSec! > 1]).toEqual([plan.platform, "payoffCutFar", true]);
      const run = runFactsSync(plan.settings, plan.seed, plan.world, plan.recipe);
      expect([plan.platform, run.payoffSec]).toEqual([plan.platform, plan.payoff.atSec]);
      const scored = scoreOfSettings(plan.settings, mergeFacts(run, { firstImpactSec: null, clipSec: plan.timing.clipSec }), { platform: plan.platform, episode: plan.episode, melody: melodyOf(plan), recipe: plan.recipe, bucket: plan.bucket });
      expect([plan.platform, scored.reasons.find((r) => r.id === "payoff")]).toEqual([plan.platform, own]);
    }
  });

  it("gets the plan's verdict on every item, the length judged against the bucket of the clip's own length", () => {
    plans.forEach((plan, k) => {
      const run = runs[k];
      const scored = scoreOfSettings(plan.settings, mergeFacts(run, { firstImpactSec: null, clipSec: plan.timing.clipSec }), { platform: plan.platform, episode: plan.episode, melody: melodyOf(plan) });
      const like = planLikeFromSettings(plan.settings, mergeFacts(run, { firstImpactSec: null, clipSec: plan.timing.clipSec }), { platform: plan.platform, episode: plan.episode, melody: melodyOf(plan) });
      expect([plan.id, like.ending]).toEqual([plan.id, plan.ending]);
      for (const reason of scored.reasons) {
        const own = plan.reasons.find((r) => r.id === reason.id)!;
        if (reason.id === "length" && !["lengthOk", "lengthPlatform"].includes(own.key)) {
          // the plan's clip fell outside its planned bucket: a clip with no plan is judged in the bucket its length is in
          expect([plan.id, like.bucket]).toEqual([plan.id, bucketOfSeconds(plan.timing.clipSec)]);
          continue;
        }
        expect([plan.id, reason.id, reason.key, reason.points]).toEqual([plan.id, own.id, own.key, own.points]);
      }
    });
  });
});

describe("planLikeFromSettings", () => {
  const settings = (over: Partial<SimulatorSettings> = {}): SimulatorSettings => ({ ...defaultSettings("classic"), ...over });
  const facts = (over: Partial<ScoreFacts> = {}): ScoreFacts => ({ firstImpactSec: 0.4, payoffSec: 20, clipSec: 24, ...over });

  // --- insights --- (review fix) delaying the hook by 0.3 s made the clip a cliffhanger with no hook, and raised its score
  it("scores a hook that enters after 0.05 s as a late hook, never as a closing question, and never above one on time", () => {
    const at = (start: number) => settings({ recordingDuration: 20, captions: [caption("text", "Can it escape?", start, 3)] });
    const scored = (start: number) => scoreOfSettings(at(start), facts({ payoffSec: null, clipSec: 20 }));
    const keys = (start: number) => scored(start).reasons.filter((r) => ["hook", "payoff", "ending"].includes(r.id)).map((r) => r.key);
    expect(keys(0)).toEqual(["hookOk", "payoffMissing", "endingLongTail"]);
    for (const start of [0.1, 0.3, 1, 2.5]) {
      expect([start, planLikeFromSettings(at(start), facts({ payoffSec: null, clipSec: 20 })).ending]).toEqual([start, "resolved"]);
      // where it sits is measured once it is on screen (scoreClip looks at 0.1 s): late, but inside the safe zone
      expect([start, keys(start)]).toEqual([start, ["hookTiming", "payoffMissing", "endingLongTail"]]);
      expect([start, scored(start).score]).toEqual([start, scored(0).score - 5]);
    }
    expect(HOOK_LOOK_SEC).toBeGreaterThan(HOOK_START_SEC);
    // the hook's own verdict for a hook on time is scoreClip's: nothing is moved
    const own = scoreOfSettings(at(0), facts({ payoffSec: null, clipSec: 20 }));
    expect(own).toEqual(scoreClip(planLikeFromSettings(at(0), facts({ payoffSec: null, clipSec: 20 })) as unknown as ClipPlan));
    // a clip that does end on a question with no payoff is still the bot's never-escapes cut
    const asking = settings({ recordingDuration: 20, captions: [caption("text", "Can it escape?", 0.3, 3), caption("question", "Who gets out first?", 18)] });
    expect(scoreOfSettings(asking, facts({ payoffSec: null, clipSec: 20 })).reasons.filter((r) => ["hook", "payoff", "ending"].includes(r.id)).map((r) => r.key)).toEqual(["hookTiming", "payoffNever", "endingQuestion"]);
  });

  // --- insights --- (review fix) the run is followed as far as scoreClip grades a cut, and a payoff past that is none, whatever times it
  it("reads a payoff up to 3 s after the end as a clip cut before it, and one farther off as none, for every strategy", () => {
    expect(SCORE_RUN_MARGIN_SEC).toBeGreaterThanOrEqual(SCORE_PAYOFF_REACH_SEC + 1); // (+ Ball Drop's rest: its payoff is a second before its run's end)
    const near = planLikeFromSettings(settings(), facts({ payoffSec: 24 + SCORE_PAYOFF_REACH_SEC }));
    expect([near.ending, near.payoff.cutGapSec]).toEqual(["cliffhanger", SCORE_PAYOFF_REACH_SEC]);
    expect(scoreOfSettings(settings(), facts({ payoffSec: 24 + SCORE_PAYOFF_REACH_SEC })).reasons.find((r) => r.id === "payoff")!.key).toBe("payoffCutFar");
    const far = planLikeFromSettings(settings(), facts({ payoffSec: 24 + SCORE_PAYOFF_REACH_SEC + 0.01 }));
    expect([far.ending, far.payoff]).toEqual(["resolved", { atSec: null, position: null, cutGapSec: null }]);
    // a pendulum's cycle is known 40 s past a 20 s clip: no payoff inside it, as a simulated one that far off would be
    const wave = { ...defaultSettings("pendulum"), pwCycleSeconds: 60, recordingDuration: 20 };
    const run = mergeFacts(runFactsSync(wave, 1), null);
    expect(run.payoffSec).toBe(60);
    expect(planLikeFromSettings(wave, run).payoff).toEqual({ atSec: null, position: null, cutGapSec: null });
    // Classic cut 2.6 s before its escape: the run sees the escape (it was followed 2 s past the end, and read as no payoff)
    const classic = settings({ gapSize: 0.5, recordingDuration: 32 });
    const escape = runFactsSync({ ...classic, recordingDuration: 60 }, 6).payoffSec!;
    expect(escape - 32).toBeGreaterThan(2);
    expect(escape - 32).toBeLessThanOrEqual(SCORE_PAYOFF_REACH_SEC);
    const cut = runFactsSync(classic, 6);
    expect(cut.payoffSec).toBe(escape);
    expect(scoreOfSettings(classic, mergeFacts(cut, null)).reasons.filter((r) => r.id === "payoff" || r.id === "ending").map((r) => r.key)).toEqual(["payoffCutFar", "endingNoQuestion"]);
  });

  it("ends a clip as its payoff falls: inside it resolved, after its end cut before the result", () => {
    const inside = planLikeFromSettings(settings(), facts());
    expect([inside.ending, inside.payoff]).toEqual(["resolved", { atSec: 20, position: 20 / 24, cutGapSec: null }]);
    const after = planLikeFromSettings(settings(), facts({ payoffSec: 24.75 }));
    expect([after.ending, after.payoff.cutGapSec, after.payoff.position]).toEqual(["cliffhanger", 0.75, 24.75 / 24]);
    expect(scoreOfSettings(settings(), facts({ payoffSec: 24.75 })).reasons.find((r) => r.id === "payoff")!.key).toBe("payoffCut");
  });

  // --- insights --- (review fix) a run that ends with the clip: its 1/60 s steps add up to a hair past 20 or 30 s (and a hair
  // short of 12 or 45 s), and a payoff 1.0000000000000013 of the way in scored 0 of 20 where the same clip scores 8 at 12 s
  it("puts a payoff that comes with the clip's last frame 100 % in, never past it: a Double Pendulum run to its clip length", async () => {
    const pendulum = (sec: number) => ({ ...defaultSettings("doublePendulum"), recordingDuration: sec });
    expect([20, 30].map((sec) => runFactsSync(pendulum(sec), 1).payoffSec! > sec)).toEqual([true, true]); // (the steps' sum, past the end)
    for (const sec of [12, 20, 25, 30, 45]) {
      const run = runFactsSync(pendulum(sec), 1);
      expect([sec, Math.abs(run.payoffSec! - sec) < 1e-9]).toEqual([sec, true]); // (the run ends with the clip)
      const like = planLikeFromSettings(pendulum(sec), mergeFacts(run, factsOfExport(null, sec)));
      expect([sec, like.ending, like.payoff.position! <= 1, like.payoff.atSec! <= sec]).toEqual([sec, "resolved", true, true]);
      const payoff = scoreOfSettings(pendulum(sec), mergeFacts(run, factsOfExport(null, sec))).reasons.find((r) => r.id === "payoff")!;
      expect([sec, payoff.key, payoff.points, payoff.values]).toEqual([sec, "payoffOff", 8, { sec: sec.toFixed(1), pct: 100 }]);
    }
    // through the queue's save path: the page's clip of that setup, saved as a 30 s file
    const saved = await scoreSavedClip(genesOfSavedFile(seedSource(pendulum(30), 1).meta!.genes!, { durationSec: 30, cut: "master" }), { settings: pendulum(30), seed: 1, world: null, durationSec: 30, features: null, platform: null, pause: async () => {} });
    expect([saved.reasons?.payoff, saved.checklist?.payoff]).toEqual([{ key: "payoffOff", values: { sec: 30, pct: 100 } }, 0.4]);
    // a payoff that does come after the end is still a clip cut before it
    const after = planLikeFromSettings(settings(), facts({ payoffSec: 24 + 1e-6 }));
    expect([after.ending, after.payoff.atSec]).toEqual(["cliffhanger", 24 + 1e-6]);
  });

  // --- insights --- (review fix) a planned cliffhanger asking at its end, its payoff inside the clip: the result, then the question
  it("keeps a clip planned as a cliffhanger one while its question is on screen at its end, wherever its payoff falls", () => {
    const asking = settings({ captions: [caption("text", "Who wins?", 0, 2.5), caption("question", "Alien or T-Rex? 👇", 22)] });
    const items = (s: SimulatorSettings, f: ScoreFacts, context: Parameters<typeof scoreOfSettings>[2]) => scoreOfSettings(s, f, context).reasons.filter((r) => r.id === "payoff" || r.id === "ending").map((r) => r.key);
    // the payoff inside the clip: with no plan resolved; planned as a cliffhanger, the bot's verdict (the gap before the cut negative)
    expect(planLikeFromSettings(asking, facts()).ending).toBe("resolved");
    const planned = planLikeFromSettings(asking, facts(), { ending: "cliffhanger" });
    expect([planned.ending, planned.payoff]).toEqual(["cliffhanger", { atSec: 20, position: 20 / 24, cutGapSec: -4 }]);
    expect(items(asking, facts(), { ending: "cliffhanger" })).toEqual(["payoffCutWrong", "endingQuestion"]);
    // a planned cliffhanger whose question is gone by its end, and a planned resolved clip, end as their payoff falls
    const gone = settings({ captions: [caption("text", "Who wins?", 0, 2.5), caption("question", "Alien or T-Rex? 👇", 10, 14)] });
    expect([planLikeFromSettings(gone, facts(), { ending: "cliffhanger" }).ending, planLikeFromSettings(asking, facts(), { ending: "resolved" }).ending]).toEqual(["resolved", "resolved"]);
    // after the end or none inside it: cut before the result, as ever
    expect([items(asking, facts({ payoffSec: 24.75 }), { ending: "cliffhanger" }), items(asking, facts({ payoffSec: null }), { ending: "cliffhanger" })]).toEqual([
      ["payoffCut", "endingQuestion"],
      ["payoffNever", "endingQuestion"],
    ]);
  });

  it("calls a clip with no payoff and a question on screen a cut one, and one without a question a clip that misses it", () => {
    const asking = settings({ captions: [caption("text", "Can it escape?", 0, 2.5), caption("question", "Who gets out first?", 20)] });
    const cut = scoreOfSettings(asking, facts({ payoffSec: null }));
    expect(cut.reasons.filter((r) => r.id === "payoff" || r.id === "ending").map((r) => r.key)).toEqual(["payoffNever", "endingQuestion"]);
    const silent = scoreOfSettings(settings(), facts({ payoffSec: null }));
    expect(silent.reasons.find((r) => r.id === "payoff")!.key).toBe("payoffMissing");
  });

  it("takes the platform it is for, else the one whose bucket the clip's length is in", () => {
    for (const bucket of LENGTH_BUCKETS) expect(PLATFORMS[platformForBucket(bucket)].buckets).toContain(bucket);
    expect([platformForBucket("short"), platformForBucket("standard")]).toEqual(["shorts", "reels"]);
    expect(planLikeFromSettings(settings(), facts({ clipSec: 12 })).platform).toBe("shorts");
    expect(planLikeFromSettings(settings(), facts({ clipSec: 12 }), { platform: "tiktok" }).platform).toBe("tiktok");
    expect([platformOf("tiktok", "native"), platformOf(null, "shorts"), platformOf(null, "native"), platformOf("instagram", null)]).toEqual(["tiktok", "shorts", null, null]);
  });

  it("counts the mode's own notes and a melody as the melody, and nothing else", () => {
    const sound = (melody: string | null) => scoreOfSettings(settings({ scale: "major" }), facts(), { melody }).reasons.find((r) => r.id === "sound")!;
    expect([sound("ladder").key, sound("ode-to-joy").key, sound("none").key, sound(null).key]).toEqual(["soundOk", "soundOk", "soundFlat", "soundFlat"]);
  });

  it("reads the countdown of a counter caption, else the mode's own HUD", () => {
    const walls = planLikeFromSettings(settings({ captions: [caption("wallCounter", "", 0)] }), facts());
    expect(walls.countdown).toEqual({ kind: "walls", source: "caption" });
    const race = planLikeFromSettings({ ...defaultSettings("race") }, facts());
    expect(race.countdown.source).toBe("hud");
    expect(scoreOfSettings({ ...defaultSettings("race") }, facts()).reasons.find((r) => r.id === "countdown")!.key).toBe("countdownHud");
  });

  it("plays every mode with a recipe of the playbook where there is one, and the run's own end where there is none", () => {
    for (const recipe of RECIPES) for (const mode of recipe.modes) expect(scoreRecipeOf(mode)?.modes).toContain(mode);
    expect(scoreRecipeOf("classic")?.id).toBe("ring-escape");
    expect(scoreRecipeOf("portal")?.id).toBe("ring-escape");
    expect(scoreRecipeOf("blueprint")).toBeNull();
  });

  // --- insights --- a link's or the page's one-liner on top is the hook a viewer reads, not a series label
  it("takes a clip's Top Text as its hook when no caption is, out of the series label's slot", () => {
    const top = settings({ topText: "Can it escape 5 rings?", captions: [], recordingDuration: 20 });
    const like = planLikeFromSettings(top, facts({ clipSec: 20, payoffSec: 18 }));
    expect([like.settings.topText, like.captionRoles, like.settings.captions.map((c) => [c.text, c.position, c.start, c.end])]).toEqual(["", ["hook"], [["Can it escape 5 rings?", "top", 0, 0]]]);
    // drawn at the Top Text's own size (the recorder's line over the captions' base size)
    expect(like.settings.captions[0].style.size).toBeCloseTo(0.04 / 0.045, 6);
    const scored = scoreOfSettings(top, facts({ clipSec: 20, payoffSec: 18 }));
    const reason = (id: string) => scored.reasons.find((r) => r.id === id)!;
    expect(reason("hook").key).not.toBe("hookMissing");
    expect(reason("hook")).toMatchObject({ key: "hookTiming", values: { text: "Can it escape 5 rings?" } }); // on screen from the start, and for the whole clip
    expect(reason("series").key).toBe("seriesWeak");
    // the settings stay as they were, and a hook caption keeps the Top Text out of the hook
    expect(top.topText).toBe("Can it escape 5 rings?");
    const captioned = settings({ topText: "Day 3", captions: [caption("text", "Can it escape?", 0, 2.5)] });
    expect(hookedSettings(captioned)).toEqual({ settings: captioned, roles: ["hook"] });
    expect(hookedSettings(settings())).toEqual({ settings: settings(), roles: [] });
    // over an arena game's scoreboard the Top Text covers the band: no hook there, as scoreClip says
    const arena = { ...defaultSettings("battle"), topText: "Who wins?" };
    expect(hasTopHud(arena.mode)).toBe(true);
    expect(hookedSettings(arena).settings).toBe(arena);
    expect(scoreOfSettings(arena, facts()).reasons.find((r) => r.id === "series")!.key).toBe("seriesCovered");
    // the genes of that page clip say the same hook the score reads
    const genes = seedSource(top, 7).meta!.genes!;
    expect([genes.hookKey, genes.hookChars]).toEqual(["custom", 22]);
  });

  it("never calls a clip that is not part of the series (day 0) part of one; a series day keeps its label", () => {
    const labelled = settings({ topText: "Ring Escape #3", captions: [caption("text", "Can it escape?", 0, 2.5)] });
    expect(edgeTextBox("Ring Escape #3", "top").left).toBeGreaterThanOrEqual(0); // (the label is on screen)
    const seriesOf = (context: Parameters<typeof scoreOfSettings>[2]) => scoreOfSettings(labelled, facts(), context).reasons.find((r) => r.id === "series")!;
    const oneOff = seriesOf({});
    const unlabelled = scoreClip({ ...planLikeFromSettings(labelled, facts()), settings: { ...labelled, topText: "", bottomText: "" } } as unknown as ClipPlan).reasons.find((r) => r.id === "series")!;
    expect(oneOff).toEqual(unlabelled);
    expect(oneOff.key).toBe("seriesWeak");
    expect(seriesOf({ episode: 0 })).toEqual(oneOff);
    expect(seriesOf({ episode: 3 })).toMatchObject({ key: "seriesOk" });
    // the total is the items' sum
    const scored = scoreOfSettings(labelled, facts());
    expect(scored.score).toBe(scored.reasons.reduce((sum, r) => sum + r.points, 0));
    // a bot plan (series day 1 and up) scores as scoreClip scores it
    for (const plan of quickPlans()) expect(plan.episode).toBeGreaterThanOrEqual(1);
  });

  it("scores with the plan's recipe while it plays the clip's mode, else the mode's own", () => {
    for (const recipe of RECIPES) for (const mode of recipe.modes) expect([recipe.id, mode, scoreRecipeFor(mode, recipe.id)?.id]).toEqual([recipe.id, mode, recipe.id]);
    const other = RECIPES.find((r) => !r.modes.includes("classic"))!;
    expect(scoreRecipeFor("classic", other.id)?.id).toBe(scoreRecipeOf("classic")?.id);
    expect([scoreRecipeFor("classic", null)?.id, scoreRecipeFor("classic", "blueprint:ringBreaker")?.id, scoreRecipeFor("blueprint", "pip-escape")]).toEqual(["ring-escape", "ring-escape", null]);
    // a plan's bucket stays while the clip's length fits it
    expect([planLikeFromSettings(settings(), facts({ clipSec: 31 }), { bucket: "standard" }).bucket, planLikeFromSettings(settings(), facts({ clipSec: 40 }), { bucket: "standard" }).bucket, planLikeFromSettings(settings(), facts({ clipSec: 70 }), { bucket: "standard" }).bucket]).toEqual(["standard", "standard", "long"]);
    expect(planLikeFromSettings(settings(), facts({ clipSec: 12 }), { bucket: "standard" }).bucket).toBe("short");
  });

  it("falls back to the settings' clip length, and never takes a negative or unknown fact for one", () => {
    const like = planLikeFromSettings(settings({ recordingDuration: 30 }), { firstImpactSec: -1, payoffSec: Number.NaN, clipSec: null });
    expect([like.timing, like.payoff, like.bucket]).toEqual([{ clipSec: 30, firstImpactSec: null }, { atSec: null, position: null, cutGapSec: null }, "standard"]);
  });
});

describe("the facts", () => {
  it("of the export: the file's length and its first motion or sound, the earlier", () => {
    expect(factsOfExport({ firstMotionSec: 0.5, firstSoundSec: 0.25 }, 21.3)).toEqual({ firstImpactSec: 0.25, clipSec: 21.3 });
    expect(factsOfExport({ firstMotionSec: null, firstSoundSec: null }, 0)).toEqual({ firstImpactSec: null, clipSec: null });
    expect(factsOfExport(null, null)).toEqual({ firstImpactSec: null, clipSec: null });
  });

  it("merge with the run's: the run's first impact first, the file's length first, the payoff the run's alone", () => {
    const run: ScoreFacts = { firstImpactSec: 0.4, payoffSec: 9, clipSec: 12 };
    expect(mergeFacts(run, { firstImpactSec: 0.1, clipSec: 11.5 })).toEqual({ firstImpactSec: 0.4, payoffSec: 9, clipSec: 11.5 });
    expect(mergeFacts({ ...run, firstImpactSec: null }, { firstImpactSec: 0.1, clipSec: null })).toEqual({ firstImpactSec: 0.1, payoffSec: 9, clipSec: 12 });
    expect(mergeFacts(run, null)).toEqual(run);
  });

  it("of a run in slices are the planner's run: simulateFacts is the drained generator, and the slices change nothing", async () => {
    const s = { ...defaultSettings("classic"), recordingDuration: 12 };
    const horizon = s.recordingDuration + SCORE_RUN_MARGIN_SEC;
    const request = finderRequestOfSettings(s, { width: 800, height: 600 }, horizon);
    expect(drain(simulateFactsSteps(request, 7, { strategy: "escape" }, horizon))).toEqual(simulateFacts(request, 7, { strategy: "escape" }, horizon));
    let pauses = 0;
    let t = 0;
    const sliced = await runFactsOf(s, 7, { world: { width: 800, height: 600 }, now: () => (t += 20), pause: async () => void pauses++ });
    expect(sliced).toEqual(runFactsSync(s, 7, { width: 800, height: 600 }));
    expect(pauses).toBeGreaterThan(0);
    // a pause comes only between whole slices of steps
    let yields = 0;
    for (const steps = simulateFactsSteps(request, 7, { strategy: "escape" }, horizon); !steps.next().done; ) yields++;
    expect(yields).toBeLessThanOrEqual(Math.ceil((horizon * 60) / FACTS_SLICE_STEPS));
  });

  it("stop when the queue cancels the run", async () => {
    let calls = 0;
    const signal = { get aborted() { return ++calls > 3; } };
    expect(await runFactsOf(defaultSettings("classic"), 7, { signal, now: () => 1e9 * calls, pause: async () => {} })).toBeNull();
  });
});

describe("a link's or the page's clip", () => {
  const page = { ...defaultSettings("classic"), recordingDuration: 20, captions: [caption("text", "Can it escape?", 0, 2.5)] };

  it("gets a 0–100 score with a verdict on every checklist item, stored in its genes", async () => {
    const source = seedSource(page, 42);
    const genes = source.meta!.genes!;
    expect([genes.source, genes.planScore, genes.checklist]).toEqual(["seed", null, null]);
    const scored = await scoreSavedClip(genes, { settings: page, seed: 42, world: { width: 800, height: 600 }, durationSec: 20.5, features: null, platform: null, pause: async () => {} });
    expect(scored.planScore).toBeGreaterThanOrEqual(0);
    expect(scored.planScore).toBeLessThanOrEqual(100);
    expect(Object.keys(scored.checklist ?? {})).toEqual([...GENE_CHECKLIST]);
    expect(Object.keys(scored.reasons ?? {})).toEqual([...GENE_CHECKLIST]);
    const direct = scoreOfSettings(page, mergeFacts(runFactsSync(page, 42, { width: 800, height: 600 }), { firstImpactSec: null, clipSec: 20.5 }));
    expect(scored.planScore).toBe(direct.score);
    for (const r of direct.reasons) expect([r.id, scored.reasons?.[r.id]?.key, scored.checklist?.[r.id]]).toEqual([r.id, r.key, Math.round((1000 * r.points) / r.max) / 1000]);
    expect(sanitizeGenes(scored)).toEqual(scored);
    // the same clip scores the same, again
    expect(await scoreSavedClip(genes, { settings: page, seed: 42, world: { width: 800, height: 600 }, durationSec: 20.5, features: null, platform: null, pause: async () => {} })).toEqual(scored);
  });

  it("takes a link's genes too, and leaves a plan's (its plan's score) and anything it cannot run as they were", async () => {
    const link = seedSource(page, 9, { kind: "link", link: "https://example.com/en/simulator/?mode=classic" }).meta!.genes!;
    expect(scoresFromSettings(link)).toBe(true);
    expect((await scoreSavedClip(link, { settings: page, seed: 9, world: null, durationSec: null, features: null, platform: "tiktok", pause: async () => {} })).planScore).not.toBeNull();
    const plan = planClip(RECIPES[0], 3, "reels", { copy, search: false });
    const planned = planSource(plan).meta!.genes!;
    expect(scoresFromSettings(planned)).toBe(false);
    expect(await scoreSavedClip(planned, { settings: page, seed: 9, world: null, durationSec: 10, features: null, platform: null })).toBe(planned);
    const broken = { ...page, captions: null } as unknown as SimulatorSettings;
    expect(await scoreSavedClip(link, { settings: broken, seed: 9, world: null, durationSec: 10, features: null, platform: null, pause: async () => {} })).toBe(link);
    expect(await scoreSavedClip(link, { settings: page, seed: 9, world: null, durationSec: 10, features: null, platform: null, signal: { aborted: true } })).toBe(link);
  });

  // --- insights --- an AI clip's plan was scored before its tools changed what the run plays; an old bot plan job has no score
  it("scores an AI clip and a bot plan's clip without a score from their run, with the plan's recipe, series day and bucket", async () => {
    const plan = planClip(RECIPES[0], 3, "reels", { copy, search: false });
    const ai = { ...planSource(plan).meta!.genes!, source: "ai" as const };
    const unscored = { ...planSource(plan).meta!.genes!, planScore: null, checklist: null };
    delete (unscored as Partial<ClipGenes>).reasons;
    expect([scoresFromSettings(ai), scoresFromSettings(unscored), scoresFromSettings(planSource(plan).meta!.genes), scoresFromSettings({ ...ai, source: "editor" }), scoresFromSettings(null)]).toEqual([true, true, false, false, false]);
    for (const genes of [ai, unscored]) {
      const saved = await scoreSavedClip(genes, { settings: plan.settings, seed: plan.seed, world: plan.world, durationSec: plan.timing.clipSec, features: null, platform: plan.platform, pause: async () => {} });
      const run = runFactsSync(plan.settings, plan.seed, plan.world, plan.recipe);
      const direct = scoreOfSettings(plan.settings, mergeFacts(run, { firstImpactSec: null, clipSec: plan.timing.clipSec }), { platform: plan.platform, episode: plan.episode, melody: genes.melody, recipe: plan.recipe, bucket: plan.bucket });
      expect([genes.source, saved.planScore]).toEqual([genes.source, direct.score]);
      expect(saved).toMatchObject({ recipe: plan.recipe, episode: plan.episode, ending: plan.ending });
      for (const r of direct.reasons) expect([genes.source, r.id, saved.reasons?.[r.id]?.key]).toEqual([genes.source, r.id, r.key]);
    }
  });

  it("keeps the melody the page played it with when its genes knew none", async () => {
    const genes = seedSource({ ...page, scale: "major" }, 5).meta!.genes!;
    const scored = await scoreSavedClip(genes, { settings: { ...page, scale: "major" }, seed: 5, world: null, durationSec: 20, features: null, platform: null, melody: "ode-to-joy", pause: async () => {} });
    expect([scored.melody, scored.reasons?.sound?.key]).toEqual(["ode-to-joy", "soundOk"]);
  });

  for (const mode of MODE_IDS) {
    it(`scores in ${mode}, with every verdict's key one the genes keep`, () => {
      const s = { ...defaultSettings(mode), recordingDuration: 6 };
      const scored = scoreOfSettings(s, mergeFacts(runFactsSync(s, 1), null));
      expect([mode, scored.score >= 0 && scored.score <= 100, scored.reasons.map((r) => r.id)]).toEqual([mode, true, CHECKLIST.map((c) => c.id)]);
      for (const r of scored.reasons) expect((GENE_REASON_KEYS as readonly string[]).includes(r.key)).toBe(true);
    });
  }
});

describe("the verdicts in the genes", () => {
  it("are the bot's reason keys and countdown kinds", () => {
    expect([...GENE_REASON_KEYS].sort()).toEqual(Object.keys(en.ViralBot.reasons).sort());
    expect([...GENE_COUNTDOWN_KINDS]).toEqual([...COUNTDOWN_KINDS]);
  });

  it("keep a verdict's numbers and countdown kind, never its words", () => {
    const plan = planClip(RECIPES[0], 3, "reels", { copy, search: false });
    const reasons = reasonsOf(plan.reasons)!;
    expect(reasons.hook).toEqual({ key: plan.reasons.find((r) => r.id === "hook")!.key, values: {} });
    expect(JSON.stringify(reasons)).not.toContain(plan.hook);
    expect(JSON.stringify(reasons)).not.toContain(plan.settings.topText);
    const length = plan.reasons.find((r) => r.id === "length")!;
    expect(reasons.length).toEqual({ key: length.key, values: { sec: Number(length.values.sec), min: length.values.min, max: length.values.max } });
    expect(reasonsOf([{ id: "ending", points: 2, max: 10, key: "endingLongTail", values: { tail: "–" } }])).toEqual({ ending: { key: "endingLongTail", values: {} } });
    expect(reasonsOf([{ id: "countdown", points: 10, max: 10, key: "countdownCaption", values: { kind: "walls" } }])).toEqual({ countdown: { key: "countdownCaption", values: { kind: "walls" } } });
  });

  it("survive absurd answers: an unknown key, a word for a number, a stranger's kind or a whole document are dropped", () => {
    const genes = genesWithScore(seedSource(defaultSettings("classic"), 1).meta!.genes!, { score: 50, reasons: [] });
    const absurd = sanitizeGenes({
      ...genes,
      reasons: {
        motion: { key: "motionOk", values: { sec: 1e99, pct: "12", text: "<script>", kind: "nukes" } },
        hook: { key: "hookOk; DROP TABLE", values: {} },
        payoff: { key: "payoffOk", values: "everything" },
        evil: { key: "lookOk", values: {} },
        series: "seriesOk",
        __proto__: { polluted: 1 },
      },
    })!;
    expect(absurd.reasons).toEqual({ motion: { key: "motionOk", values: { sec: 1_000_000 } } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect("reasons" in sanitizeGenes({ ...genes, reasons: { hook: { key: "nope", values: {} } } })!).toBe(false);
    expect("reasons" in sanitizeGenes({ ...genes, reasons: undefined })!).toBe(false);
  });

  it("are dropped before the checklist when a record would weigh more than 4 KB", () => {
    const plan = planClip(RECIPES[0], 3, "reels", { copy, search: false });
    const full = planSource(plan).meta!.genes!;
    expect(full.reasons).toBeDefined();
    const heavy = { ...full, features: { v: 1, ...Object.fromEntries(Object.keys(full.features ?? {}).map((k) => [k, 1])) }, mode: "m".repeat(40), melody: "a".repeat(64), hookKey: `recipes.${"k".repeat(55)}`, recipe: `blueprint:${"x".repeat(40)}`, parent: "0123abcd", blueprintDigest: "0123abcd" } as ClipGenes;
    const kept = sanitizeGenes(heavy)!;
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(4096);
    expect(kept.checklist).not.toBeNull();
  });
});

describe("the render queue", () => {
  it("keeps the saved clip's genes, its score among them, in the done job and through the journal", () => {
    const clip = seedSource(defaultSettings("classic"), 4);
    let n = 0;
    let state = enqueue(EMPTY_QUEUE, expandBatch([clip], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: ["tiktok"] }), 1, () => `job-${++n}`);
    const genes = genesWithScore(clip.meta!.genes!, scoreOfSettings(clip.settings, { firstImpactSec: 0.3, payoffSec: 18, clipSec: 21 }));
    state = markRendering(state, "job-1", 2);
    state = markDone(state, "job-1", { path: "C:/out/a.mp4", bytes: 1, durationSec: 21, encoder: null }, 3, genes);
    expect(state.jobs[0].meta.genes).toEqual(genes);
    expect(restoreQueue(journalOf(state, 4), 5).state.jobs[0].meta.genes).toEqual(genes);
    // without genes the job's meta stays as it was
    const plain = markDone(markRendering(enqueue(EMPTY_QUEUE, expandBatch([clip], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: ["native"] }), 1, () => "j"), "j", 2), "j", { path: "x", bytes: 1, durationSec: 1, encoder: null }, 3);
    expect(plain.jobs[0].meta.genes).toEqual(clip.meta!.genes);
  });

  it("scores a link's or the page's clip as it saves it, cancels with the job, and never fails the save", () => {
    const hook = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "useRenderQueue.ts"), "utf8");
    expect(hook).toMatch(/const genes = await scoreSavedClip\(saved0, \{ settings: job\.settings, seed: job\.seed, world,/);
    expect(hook).toMatch(/signal: \{ get aborted\(\) \{ return cancelled\.current\.has\(job\.id\); \} \} \}\);\n\s+if \(cancelled\.current\.has\(job\.id\)\) return;/);
    expect(hook).toMatch(/markDone\(s, job\.id, \{[^}]*\}, Date\.now\(\), genes/);
    expect(platformOf(null, "reels")).toBe("reels");
    expect(BOT_PLATFORMS).toContain(platformOf("shorts", "native"));
  });
});

describe("the score module", () => {
  it("draws nothing at random and reads no clock but the one timing its slices", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "insights", "score.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random|new Date\(/);
    expect(src.match(/Date\.now\(\)|performance\.now\(\)/g)).toEqual(["performance.now()", "Date.now()"]); // (the slices' clock alone)
    expect(src).not.toMatch(/telemetry/i);
  });
});
