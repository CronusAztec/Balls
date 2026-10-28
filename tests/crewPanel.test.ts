import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { recipeById } from "@/lib/bot/playbook";
import { planClip, type ClipPlan, type RunFacts } from "@/lib/bot/planner";
import type { SimulatorSettings } from "@/lib/settings";
import { runSync } from "@/lib/insights/score";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import { TRENDS } from "@/content/trends";
import {
  DOSSIER_KEYS,
  SHARED_RUBRIC,
  applyVerdict,
  cancelPanel,
  clarityOf,
  clipReviewOf,
  createPanel,
  crewClipOfPlan,
  drawnHookText,
  failedGates,
  nextStep,
  panelDecision,
  playbookOf,
  researchDigest,
  runPanel,
  sanitizeReview,
  tokensLower,
  type CrewClip,
  type CrewMeasured,
  type CrewModel,
  type PanelCandidate,
  type PanelInput,
  type PanelState,
  type RoleBrief,
} from "@/lib/crew";

/*
 * --- crew --- The panel (lib/crew/panel.ts, C3 of the AI studio plan) on real bot plans with scripted models: the measure step and
 * its rule fix, the role order (one clip at a time, the viewer first at Thorough, the reviewer at Quick only where something is
 * in doubt), the evidence check before the reviewer, the reviewer held to the rules (a confirmed objection answered and fixed,
 * no keep while a gate fails), one fix round with harmful fixes reverted, the stop rule and every cap (calls and retries, time,
 * cost), the rules-only fallback of a broken model, a cancel that queues nothing, the after-render look with its offered fix,
 * an open request from research to the producer's words (the hook locked), and the same decision by hand and by runPanel.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;

/** A plan in a calm look (the look settings that leave the run alone), its countdown after its hook. */
function calm(plan: ClipPlan): ClipPlan {
  const s: SimulatorSettings = { ...plan.settings, showWallGlow: false, colorTrail: false, rainbowWalls: false, screenShake: 0, wallBreakStyle: "shatter", particleStyle: "sparks", rainbowBall: false, topText: "", bottomText: "" };
  const hookEnd = Math.max(...s.captions.filter((_, i) => plan.captionRoles[i] === "hook").map((c) => c.end));
  s.captions = s.captions.map((c, i) => (plan.captionRoles[i] === "countdown" ? { ...c, start: hookEnd } : c));
  return { ...plan, settings: s };
}
const runOf = (plan: ClipPlan): RunFacts => runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec);
const withRun = (plan: ClipPlan): CrewClip => crewClipOfPlan(plan, { run: runOf(plan) });
/** A clip whose Playbook score is its own fields' (after a hand edit). */
const fresh = (clip: CrewClip): CrewClip => ({ ...clip, playbook: playbookOf(clip) });
const features = (first: number | null): ClipFeatures => ({ v: 1, sampleHz: 4, motion: [0, 0.004, 0.006, 0.005, 0.004], firstMotionSec: first, peakMotionPos: 0.8, meanLuma: 0.08, meanSat: 0.5, darkShare: 0.85, soundEventsPerSec: 3, firstSoundSec: 0.1, gapEvents: 4, loopSeamDiff: 0.01, lufs: -14 });
const rendered = (clip: CrewClip, m: Partial<CrewMeasured> = {}): CrewClip => ({ ...clip, measured: { features: features(0.4), durationSec: clip.timing.clipSec, laggedFrames: 0, frames: 1000, watermarked: true, free: true, ...m } });

const PLANS = {
  ring: planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 }),
  pendulum: planClip(recipeById("pendulum-wave")!, 1, "reels", { copy, ending: "resolved", episode: 3 }),
  drop: planClip(recipeById("drop-symphony")!, 1, "reels", { copy, ending: "resolved", episode: 3 }),
  ringCliff: planClip(recipeById("ring-escape")!, 1, "reels", { copy, ending: "cliffhanger", episode: 3 }),
  grow: planClip(recipeById("grow-fill")!, 1, "reels", { copy, ending: "resolved", episode: 3 }),
};
const CLIPS = { ring: withRun(PLANS.ring), pendulum: withRun(PLANS.pendulum), drop: withRun(PLANS.drop), ringCliff: withRun(PLANS.ringCliff), grow: withRun(PLANS.grow) };
/** The bot's five clips as they come (its busy look): c5 (Grow) cannot pass G5 and G7 whatever the look. */
const batch = (): PanelCandidate[] => [
  { id: "c1", clip: CLIPS.ring },
  { id: "c2", clip: CLIPS.pendulum },
  { id: "c3", clip: CLIPS.drop },
  { id: "c4", clip: CLIPS.ringCliff },
  { id: "c5", clip: CLIPS.grow },
];
/** A calm ring escape that passes every gate. */
const calmRing = fresh(withRun(calm(PLANS.ring)));

/* ------------------------------------------------------------------ scripted models */

type Script = (brief: RoleBrief, attempt: number, errors: string[]) => unknown;
const NOTHING = { oneIdea: "Will the ball get out of the rings?", objections: [] };
const KEEP = { verdict: "keep", confidence: "high", answers: [], viewerAnswer: null, fixes: [], why: "clear and simple" };
const enumOf = (schema: unknown, ...path: string[]) => path.reduce((s: Record<string, unknown>, k) => s[k] as Record<string, unknown>, schema as Record<string, unknown>) as unknown as { enum: string[] };
function produced(brief: RoleBrief) {
  const item = enumOf(brief.final, "properties", "clips", "items") as unknown as { properties: Record<string, { enum: string[] }> };
  return { clips: item.properties.planId.enum.map((id) => ({ planId: id, name: `clip ${id}`, title: "Can it get out?", hook: "A hook the producer made up", caption: "Which ring falls last?", hashtags: ["#physics", "#satisfying", "#asmr"], platform: item.properties.platform.enum[0] })), summary: "words for the kept clips" };
}
/** What each candidate's run shows (its claim): a viewer that gets the clip names it. */
const CLAIM_OF: Readonly<Record<string, string>> = { c1: "out", c2: "inSync", c3: "beat", c4: "out", i2: "inSync", k2: "full" };
const defaults: Script = (brief) => {
  if (brief.role === "skeptic") return NOTHING;
  if (brief.role === "reviewer") return KEEP;
  if (brief.role === "producer") return produced(brief);
  if (brief.role === "viewer") return { whatHappens: CLAIM_OF[brief.clipId ?? ""] ?? "out", understood: "it does what it says", waitingFor: "the end", clearBySec: 1, distractions: [], watchToEnd: "yes" };
  return {};
};
function scripted(script: Script = defaults, extras: { usd?: number } = {}) {
  const calls: { role: string; clipId: string | null; attempt: number; errors: string[]; brief: RoleBrief }[] = [];
  const model: CrewModel = async ({ brief, attempt, errors }) => {
    calls.push({ role: brief.role, clipId: brief.clipId, attempt, errors, brief });
    return { reply: script(brief, attempt, errors), ...(extras.usd !== undefined ? { usd: extras.usd } : {}) };
  };
  return { model, calls, seq: () => calls.map((c) => `${c.role}${c.clipId ? ` ${c.clipId}` : ""}`) };
}
const run = (input: PanelInput, script?: Script, more: Partial<Parameters<typeof runPanel>[1]> = {}) => {
  const m = scripted(script);
  return runPanel(createPanel(input), { model: m.model, ...more }).then((state) => ({ state, ...m }));
};
const clip = (s: PanelState, id: string) => s.clips.find((c) => c.id === id)!;
const done = (s: PanelState) => {
  const { step } = nextStep(s);
  if (step.type !== "done") throw new Error(`not done: ${step.type}`);
  return step.decision;
};

/* ------------------------------------------------------------------ the tests */

describe("the measure step", () => {
  it("gives a failed G5 or G6 its rule fix, drops any other failure before a model is asked, and ranks the rest", () => {
    const s = createPanel({ stage: "pre", wanted: 3, candidates: batch() });
    expect(clarityOf(CLIPS.ring).pass).toBe(false); // (the bot's busy look fails G6)
    for (const id of ["c1", "c2", "c3", "c4"]) {
      const c = clip(s, id);
      expect([id, c.ruleFix, c.clarity.pass, c.verdict, c.clarity.simple.score >= 80]).toEqual([id, ["simplifyLook", "oneTextAtATime"], true, null, true]);
    }
    const grow = clip(s, "c5");
    expect([grow.verdict, grow.dropWhy, grow.status]).toEqual(["drop", "gate:G5", "done"]);
    expect(failedGates(grow.clarity)).toEqual(["G5", "G7"]);
    // the review order: the rules-only pick score, ties by plan order
    expect(s.clips.map((c) => c.id)).toEqual(["c1", "c2", "c4", "c3", "c5"]);
  });

  it("an empty batch of plans ends at once, with no idea pitched and nothing to queue", () => {
    const { step } = nextStep(createPanel({ stage: "pre", wanted: 3, candidates: [], request: { text: "anything", open: true, platform: "reels", locale: "en" } }));
    expect(step.type).toBe("done");
    expect(step.type === "done" && [step.decision.keeps, step.decision.ideas, step.decision.spent.calls]).toEqual([[], [], 0]);
  });
});

describe("the role order", () => {
  it("Quick: one skeptic call a clip in rank order, no reviewer on a clean clip, then the producer", async () => {
    const { state, seq } = await run({ stage: "pre", wanted: 3, candidates: batch() });
    // c4 is a second ring escape: the picker keeps one of a template in a batch of three, so the run goes on to c3
    expect(seq()).toEqual(["skeptic c1", "skeptic c2", "skeptic c4", "skeptic c3", "producer"]);
    const d = done(state);
    expect(d.keeps.map((k) => [k.id, k.reason])).toEqual([["c1", "reviewed"], ["c2", "reviewed"], ["c3", "reviewed"]]);
    expect(d.left.map((k) => [k.id, k.reason])).toEqual([["c4", "sameTemplate"]]);
    expect(d.drops.map((k) => [k.id, k.reason])).toEqual([["c5", "gate:G5"]]);
    for (const id of ["c1", "c2", "c3", "c4"]) expect([id, clip(state, id).reviewer.source, clip(state, id).reviewer.why, clip(state, id).verdict]).toEqual([id, "skipped", "quick", "keep"]);
  });

  it("Thorough: the viewer, the skeptic and the reviewer on each clip, back to back", async () => {
    const { state, seq } = await run({ stage: "pre", depth: "thorough", wanted: 2, candidates: batch() });
    expect(seq()).toEqual(["viewer c1", "skeptic c1", "reviewer c1", "viewer c2", "skeptic c2", "reviewer c2", "producer"]);
    expect(done(state).keeps.map((k) => k.id)).toEqual(["c1", "c2"]);
    expect(clip(state, "c3").notReviewed).toBe("enough");
  });

  it("stops once N clips are kept: the rest are not reviewed, and fill only what the reviewed cannot", async () => {
    const { state, seq } = await run({ stage: "pre", wanted: 1, candidates: batch() });
    expect(seq()).toEqual(["skeptic c1", "producer"]);
    expect(["c2", "c3", "c4"].map((id) => clip(state, id).notReviewed)).toEqual(["enough", "enough", "enough"]);
    expect(done(state).keeps).toEqual([{ id: "c1", score: expect.any(Number), reason: "reviewed" }]);
  });
});

describe("what each role reads", () => {
  it("the skeptic's and the reviewer's prefix are the same bytes; the reviewer reads the objections as data, never the skeptic's words", async () => {
    const script: Script = (brief) => (brief.role === "skeptic" ? { oneIdea: "IDEA-WORDS", objections: [{ id: "o1", kind: "notShareable", evidence: ["beats.payoff"], severity: "major", note: "NOTE-WORDS" }] } : defaults(brief, 1, []));
    const { calls } = await run({ stage: "pre", depth: "thorough", wanted: 1, candidates: batch() }, script);
    const skeptic = calls.find((c) => c.role === "skeptic")!.brief;
    const reviewer = calls.find((c) => c.role === "reviewer")!.brief;
    expect(reviewer.prefix).toBe(skeptic.prefix);
    expect(skeptic.prefix.startsWith(SHARED_RUBRIC)).toBe(true);
    expect(tokensLower(skeptic.prefix)).toBeGreaterThanOrEqual(512);
    expect(reviewer.user).toContain('"kind":"notShareable"');
    expect(reviewer.user).toContain('"mark":"opinion"');
    expect(reviewer.user).not.toMatch(/IDEA-WORDS|NOTE-WORDS/);
    expect(skeptic.task).toBe("crew.skeptic");
    expect([reviewer.task, reviewer.effort]).toEqual(["crew.reviewer.thorough", "medium"]);
  });

  it("the viewer reads the screen view alone: no rubric, no dossier key, no template, recipe or claim", async () => {
    const { calls } = await run({ stage: "pre", depth: "thorough", wanted: 1, candidates: batch() });
    const viewer = calls.find((c) => c.role === "viewer")!.brief;
    const text = `${viewer.prefix}\n${viewer.card}\n${viewer.user}\n${viewer.finalHint}`;
    expect(text).not.toContain(SHARED_RUBRIC.slice(0, 60));
    expect(text).not.toMatch(/ring-escape|recipe|template|intent|idea|payoff|dossier/i);
    for (const key of DOSSIER_KEYS) expect([key, text.includes(`${key}:`)]).toEqual([key, false]);
    expect(viewer.user.startsWith("scene: ")).toBe(true);
  });
});

describe("the evidence check and the reviewer", () => {
  it("Quick asks the reviewer only where something is in doubt: a refuted or minor objection is not doubt, a major opinion is", async () => {
    const script: Script = (brief) => {
      if (brief.role !== "skeptic") return defaults(brief, 1, []);
      if (brief.clipId === "c1") return { ...NOTHING, objections: [{ id: "o1", kind: "notShareable", evidence: ["words.payoff"], severity: "minor", note: "" }] };
      if (brief.clipId === "c2") return { ...NOTHING, objections: [{ id: "o1", kind: "notShareable", evidence: ["words.payoff"], severity: "major", note: "" }] };
      return { ...NOTHING, objections: [{ id: "o1", kind: "payoffEarly", evidence: ["beats.payoff"], severity: "major", note: "" }] };
    };
    const { state, seq } = await run({ stage: "pre", wanted: 3, candidates: batch() }, script);
    expect(seq()).toEqual(["skeptic c1", "skeptic c2", "reviewer c2", "skeptic c4", "skeptic c3", "producer"]);
    expect([clip(state, "c4").marks.map((m) => m.mark), clip(state, "c3").marks.map((m) => m.mark)]).toEqual([["refuted"], ["refuted"]]);
    expect(state.log).toContain(`skeptic c4: o1 payoffEarly major refuted – not supported by the run: cut ${Math.round(CLIPS.ringCliff.payoff.cutGapSec! * 10) / 10} s before the payoff`);
  });

  it("a confirmed objection must be answered and accepted with a fix that answers it; the fix round applies it, once", async () => {
    // a calm ring escape with a few effects back: it passes G6 (Simple 60 or more) but is a bit busy (below 80)
    const busyish = fresh({ ...calmRing, settings: { ...calmRing.settings, screenShake: 0.3, showWallGlow: true, colorTrail: true, rainbowWalls: true, rainbowBall: true, reactiveBackground: true } });
    const k = clarityOf(busyish);
    expect([k.pass, k.simple.score < 80]).toEqual([true, true]);
    const replies = [
      KEEP,
      { ...KEEP, answers: [{ objection: "o1", accept: false, reason: "rulePasses", fix: null }] },
      { verdict: "fix", confidence: "medium", answers: [{ objection: "o1", accept: true, reason: null, fix: { action: "simplifyLook" } }], viewerAnswer: null, fixes: [], why: "calm the look" },
    ];
    const script: Script = (brief, attempt) => (brief.role === "skeptic" ? { ...NOTHING, objections: [{ id: "o1", kind: "tooBusy", evidence: ["score.simple"], severity: "major", note: "" }] } : brief.role === "reviewer" ? replies[attempt - 1] : defaults(brief, attempt, []));
    const { state, calls, seq } = await run({ stage: "pre", wanted: 1, candidates: [{ id: "b1", clip: busyish }] }, script);
    expect(seq()).toEqual(["skeptic b1", "reviewer b1", "reviewer b1", "reviewer b1", "producer"]);
    const reviews = calls.filter((c) => c.role === "reviewer");
    expect(reviews[1].errors.some((e) => e.includes("answer o1"))).toBe(true);
    expect(reviews[2].errors.some((e) => e.includes("cannot be rejected"))).toBe(true);
    expect(state.spent).toMatchObject({ calls: 5, retries: 2 });
    const b = clip(state, "b1");
    expect([b.marks[0].mark, b.verdict, b.fix?.state, b.fix?.actions]).toEqual(["confirmed", "fix", "applied", [{ action: "simplifyLook" }]]);
    expect(b.clarity.simple.score).toBeGreaterThan(k.simple.score);
    expect(b.original).toEqual(busyish);
    expect(done(state).keeps.map((x) => x.id)).toEqual(["b1"]);
  });

  it("a fix that lowers the pick score is reverted and the clip kept as it was (an opinion stood, nothing confirmed)", async () => {
    const script: Script = (brief) =>
      brief.role === "skeptic"
        ? { ...NOTHING, objections: [{ id: "o1", kind: "twoIdeas", evidence: ["text.timeline"], severity: "major", note: "" }] }
        : brief.role === "reviewer"
          ? { verdict: "fix", confidence: "medium", answers: [{ objection: "o1", accept: true, reason: null, fix: { action: "dropCountdownCaption" } }], viewerAnswer: null, fixes: [{ action: "dropCountdownCaption" }], why: "one text" }
          : defaults(brief, 1, []);
    const { state } = await run({ stage: "pre", wanted: 1, candidates: [{ id: "r1", clip: calmRing }] }, script);
    const r = clip(state, "r1");
    expect([r.verdict, r.fix?.state, r.dropWhy]).toEqual(["fix", "reverted", null]);
    expect(r.fix?.why).toMatch(/^pick /);
    expect(r.clip).toEqual(calmRing);
    expect(done(state).keeps.map((x) => x.id)).toEqual(["r1"]);
  });

  it("a fix that needs the seed search goes to the caller; a worse clip back, or none, is reverted, and a confirmed major objection then drops the clip", async () => {
    const c = calmRing.timing.clipSec;
    const late = fresh({ ...calmRing, payoff: { ...calmRing.payoff, atSec: 0.93 * c, position: 0.93 } });
    expect(clarityOf(late).pass).toBe(true);
    const script: Script = (brief) =>
      brief.role === "skeptic"
        ? { ...NOTHING, objections: [{ id: "o1", kind: "payoffLate", evidence: ["beats.payoff"], severity: "major", note: "" }] }
        : brief.role === "reviewer"
          ? { verdict: "fix", confidence: "medium", answers: [{ objection: "o1", accept: true, reason: null, fix: { action: "retimePayoff", targetPos: 0.85 } }], viewerAnswer: null, fixes: [], why: "retime" }
          : defaults(brief, 1, []);
    const needs: unknown[] = [];
    const better = fresh({ ...late, payoff: { ...late.payoff, atSec: 0.85 * c, position: 0.85 } });
    const worse = fresh({ ...late, timing: { ...late.timing, firstImpactSec: 1.8 } });
    for (const [back, verdict, state_] of [[better, "fix", "applied"], [worse, "drop", "reverted"], [null, "drop", "reverted"]] as const) {
      const { state } = await run({ stage: "pre", wanted: 1, candidates: [{ id: "l1", clip: late }] }, script, { replan: (_clip, need) => (needs.push(need), back) });
      const l = clip(state, "l1");
      expect([l.verdict, l.fix?.state, l.dropWhy]).toEqual([verdict, state_, verdict === "drop" ? "fixReverted" : null]);
      if (back === better) expect(l.clip.payoff.position).toBe(0.85);
      else expect(l.clip).toEqual(late);
      expect(done(state).keeps.map((x) => x.id)).toEqual(verdict === "drop" ? [] : ["l1"]);
    }
    expect(needs[0]).toEqual({ ending: "resolved", bucket: late.bucket, targetPos: 0.85, firstImpactMaxSec: null, settings: {}, actions: ["retimePayoff"] });
  });

  it("a refuted objection never reaches the reviewer, and the reviewer cannot answer it", () => {
    let s = createPanel({ stage: "pre", wanted: 1, candidates: [{ id: "r1", clip: calmRing }], depth: "thorough" });
    let step = nextStep(s);
    s = applyVerdict(step.state, { role: "viewer", clipId: "r1", reply: defaults((step.step as { brief: RoleBrief }).brief, 1, []) }).state;
    s = applyVerdict(s, { role: "skeptic", clipId: "r1", reply: { ...NOTHING, objections: [{ id: "o1", kind: "payoffLate", evidence: ["beats.payoff"], severity: "fatal", note: "" }] } }).state;
    step = nextStep(s);
    expect(step.step.type === "call" && step.step.role).toBe("reviewer");
    const brief = (step.step as { brief: RoleBrief }).brief;
    expect(brief.user).toContain("Objections (JSON; mark: confirmed by the facts, or opinion): []");
    const out = applyVerdict(step.state, { role: "reviewer", clipId: "r1", reply: { ...KEEP, answers: [{ objection: "o1", accept: false, reason: "notSupported", fix: null }] } });
    expect(out.ok).toBe(false);
    expect(out.errors.join(" ")).toMatch(/must have at most 0 items|not an objection that stands/);
  });
});

describe("the caps and the fallbacks", () => {
  it("every call and every retry counts; the clips past the budget are not reviewed and the template writes the words", async () => {
    const script: Script = (brief, attempt) => (brief.role === "skeptic" && brief.clipId === "c1" && attempt === 1 ? { oneIdea: "x", objections: [{ id: "o1", kind: "boring" }] } : defaults(brief, attempt, []));
    const { state, seq } = await run({ stage: "pre", wanted: 3, candidates: batch(), caps: { maxCalls: 3 } }, script);
    expect(seq()).toEqual(["skeptic c1", "skeptic c1", "skeptic c2"]);
    expect(state.spent).toMatchObject({ calls: 3, retries: 1 });
    expect(["c4", "c3"].map((id) => clip(state, id).notReviewed)).toEqual(["budget", "budget"]);
    const d = done(state);
    expect(d.keeps.map((k) => [k.id, k.reason])).toEqual([["c1", "reviewed"], ["c2", "reviewed"], ["c3", "notReviewed"]]);
    expect(d.copy?.source).toBe("template");
    expect(state.producer).toMatchObject({ source: "rules", why: "budget" });
  });

  it("the time cap and the cost cap stop the run the same way (the caller's clock, the caller's cost)", async () => {
    let now = 0;
    const timed = scripted();
    const byTime = await runPanel(createPanel({ stage: "pre", wanted: 3, candidates: batch(), caps: { maxMs: 15 * 60_000 } }), {
      model: async (r) => {
        now += 6 * 60_000;
        return timed.model(r);
      },
      clock: () => now,
    });
    expect(timed.seq()).toEqual(["skeptic c1", "skeptic c2", "skeptic c4"]);
    expect(byTime.spent.ms).toBe(18 * 60_000);
    expect(clip(byTime, "c3").notReviewed).toBe("budget");
    const priced = scripted(defaults, { usd: 0.6 });
    const byCost = await runPanel(createPanel({ stage: "pre", wanted: 3, candidates: batch(), caps: { maxUsd: 1.5 } }), { model: priced.model });
    expect(priced.seq()).toEqual(["skeptic c1", "skeptic c2", "skeptic c4"]);
    expect(byCost.spent.usd).toBeCloseTo(1.8, 9);
  });

  it("a broken model falls back to the rules for that step, labelled so, after its retries", async () => {
    let thrown = 0;
    const m = scripted((brief) => {
      if (brief.role === "skeptic") return "Sure! Here is my review: the clip is great.";
      if (brief.role === "reviewer") return "{ not json";
      return defaults(brief, 1, []);
    });
    const model: CrewModel = async (r) => {
      if (r.brief.role === "skeptic" && r.attempt === 2) {
        thrown++;
        throw new Error("the model crashed");
      }
      return m.model(r);
    };
    const state = await runPanel(createPanel({ stage: "pre", wanted: 1, candidates: [{ id: "r1", clip: calmRing }] }), { model });
    expect(thrown).toBe(1);
    const r = clip(state, "r1");
    expect([r.skeptic.source, r.skeptic.why, r.skeptic.attempts]).toEqual(["rules", "broken", 4]);
    expect(state.log).toContain("skeptic r1: rules only (broken)");
    expect(r.verdict).toBe("keep");
    const record = clipReviewOf(state, "r1")!;
    expect(record.roles[0]).toEqual({ role: "skeptic", source: "rules", verdict: null, note: "broken" });
    // a broken reviewer: the rules decide, and say so
    const script: Script = (brief) => (brief.role === "skeptic" ? { ...NOTHING, objections: [{ id: "o1", kind: "notShareable", evidence: ["words.payoff"], severity: "major", note: "" }] } : brief.role === "reviewer" ? "{ not json" : defaults(brief, 1, []));
    const second = await run({ stage: "pre", wanted: 1, candidates: [{ id: "r1", clip: calmRing }] }, script);
    expect(second.seq().filter((x) => x === "reviewer r1").length).toBe(4);
    expect(clip(second.state, "r1").reviewer).toMatchObject({ source: "rules", why: "broken" });
    expect(clip(second.state, "r1").verdict).toBe("keep");
  });

  it("Rules only makes no model call, and every record says so", async () => {
    const state = await runPanel(createPanel({ stage: "pre", depth: "rules", wanted: 2, candidates: batch() }), {
      model: async () => {
        throw new Error("no model at Rules only");
      },
    });
    expect(state.spent.calls).toBe(0);
    const d = done(state);
    expect(d.keeps.map((k) => k.id)).toEqual(["c1", "c2"]);
    expect(d.copy?.source).toBe("template");
    for (const id of ["c1", "c2", "c3", "c4"]) {
      const record = clipReviewOf(state, id)!;
      expect([id, record.depth, record.verdict, record.roles.map((x) => x.source)]).toEqual([id, "rules", "keep", ["rules", "rules", "rules"]]);
    }
  });

  it("a cancel ends the run at the next step and queues nothing", async () => {
    const control = new AbortController();
    const m = scripted();
    const state = await runPanel(createPanel({ stage: "pre", wanted: 3, candidates: batch() }), {
      model: async (r) => {
        const out = await m.model(r);
        if (m.calls.length === 2) control.abort();
        return out;
      },
      signal: control.signal,
    });
    expect(m.seq()).toEqual(["skeptic c1", "skeptic c2"]);
    const d = done(state);
    expect([d.cancelled, d.keeps, d.copy]).toEqual([true, [], null]);
    expect(["c4", "c3"].map((id) => clip(state, id).notReviewed)).toEqual(["cancelled", "cancelled"]);
    expect(nextStep(cancelPanel(createPanel({ stage: "pre", wanted: 1, candidates: batch() }))).step.type).toBe("done");
  });

  it("an answer out of order is refused and changes nothing", () => {
    const { state } = nextStep(createPanel({ stage: "pre", wanted: 1, candidates: batch() }));
    const out = applyVerdict(state, { role: "reviewer", clipId: "c1", reply: KEEP });
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(["out of order: the panel asks for the skeptic of c1, not the reviewer of c1"]);
    expect(out.state).toEqual(state);
    expect(applyVerdict(state, { role: "skeptic", clipId: "c2", reply: NOTHING }).errors[0]).toMatch(/^out of order/);
  });
});

describe("after a render", () => {
  it("the viewer looks at every clip; the reviewer only where the read or the rules disagree; a fix is offered, never applied", async () => {
    const a = rendered(calmRing);
    const b = rendered(fresh(withRun(calm(PLANS.pendulum))));
    const late = rendered(calmRing, { features: features(2.2) });
    expect([clarityOf(a).pass, clarityOf(b).pass, clarityOf(late).pass]).toEqual([true, true, false]);
    const hook = { action: "rewriteHook", text: "Watch them line up" };
    const script: Script = (brief, attempt) => {
      if (brief.role === "viewer") return { whatHappens: brief.clipId === "s2" ? "nothing" : "out", understood: "", waitingFor: "", clearBySec: 1, distractions: [], watchToEnd: "yes" };
      if (brief.role === "reviewer" && brief.clipId === "s2") return attempt === 1 ? { ...KEEP, viewerAnswer: { accept: true, fix: null } } : { verdict: "fix", confidence: "medium", answers: [], viewerAnswer: { accept: true, fix: hook }, fixes: [hook], why: "say what to watch" };
      if (brief.role === "reviewer" && brief.clipId === "s3") return attempt === 1 ? KEEP : { verdict: "drop", confidence: "high", answers: [], viewerAnswer: null, fixes: [], why: "nothing moves at first" };
      return defaults(brief, attempt, []);
    };
    // (two calls a clip by default: the reviewer's retries here need a little more)
    const { state, seq, calls } = await run({ stage: "post", candidates: [{ id: "s1", clip: a }, { id: "s2", clip: b }, { id: "s3", clip: late }], caps: { maxCalls: 10 } }, script);
    expect(seq()).toEqual(["viewer s1", "viewer s2", "reviewer s2", "reviewer s2", "viewer s3", "reviewer s3", "reviewer s3"]);
    expect(calls.filter((c) => c.role === "reviewer")[1].errors.some((e) => e.includes("did not get the clip"))).toBe(true);
    expect(calls.filter((c) => c.role === "reviewer")[3].errors.some((e) => e.includes("a gate fails"))).toBe(true);
    expect([clip(state, "s1").verdict, clip(state, "s1").reviewer.why, clip(state, "s1").makesSense]).toEqual(["keep", "quick", "yes"]);
    const s2 = clip(state, "s2");
    expect([s2.verdict, s2.makesSense, s2.fix?.state, s2.fix?.compiled?.hook]).toEqual(["fix", "no", "offered", "Watch them line up"]);
    expect(s2.clip).toEqual(b);
    expect(clip(state, "s3").verdict).toBe("drop");
    const record = clipReviewOf(state, "s2", { model: "qwen3-4b", date: "2026-10-28" })!;
    expect([record.stage, record.verdict, record.fixState, record.fixes, record.issues, record.makesSense]).toEqual(["post", "fix", "offered", ["rewriteHook"], ["misread"], "no"]);
    // (after a render every kept clip is ranked, best first: no N, no template rule)
    const keeps = done(state).keeps;
    expect(keeps.map((k) => k.id).sort()).toEqual(["s1", "s2"]);
    expect(keeps[0].score).toBeGreaterThanOrEqual(keeps[1].score);
    expect(done(state).drops.map((k) => k.id)).toEqual(["s3"]);
  });

  it("a clip the budget does not reach is not reviewed, never passed off as seen", async () => {
    const { state, seq } = await run({ stage: "post", candidates: [{ id: "s1", clip: rendered(calmRing) }, { id: "s2", clip: rendered(calmRing) }], caps: { maxCalls: 1 } });
    expect(seq()).toEqual(["viewer s1"]);
    expect([clip(state, "s2").verdict, clip(state, "s2").notReviewed]).toEqual(["notReviewed", "budget"]);
    expect(clipReviewOf(state, "s2")!.verdict).toBe("notReviewed");
  });
});

describe("a whole run", () => {
  it("an open request: the research brief by code, the brainstormer's ideas, the planner's clips, the producer's words with the hook locked", async () => {
    const digest = researchDigest({ trends: TRENDS, now: Date.parse("2026-10-28T12:00:00Z") });
    const ideas = { ideas: [{ template: "ring-escape", mode: "classic", hook: "a", ending: "resolved", bucket: "standard", angle: "the last ring", basis: "r1" }, { template: "pendulum-wave", mode: "pendulum", hook: "a", ending: "resolved", bucket: "standard", angle: "they line up", basis: "none" }] };
    const script: Script = (brief) => (brief.role === "brainstormer" ? ideas : defaults(brief, 1, []));
    const planned: string[] = [];
    const { state, seq, calls } = await run({ stage: "pre", wanted: 2, request: { text: "make me something satisfying", open: true, platform: "reels", locale: "en" }, digest }, script, {
      plan: (list) => list.map((idea, i) => (planned.push(idea.template), { id: `i${i + 1}`, clip: idea.template === "ring-escape" ? CLIPS.ring : CLIPS.pendulum, idea: i, post: { name: `idea ${i + 1}`, title: "t", caption: "c", hashtags: ["#physics"] } })),
    });
    expect(seq()).toEqual(["brainstormer", "skeptic i1", "skeptic i2", "producer"]);
    expect(planned).toEqual(["ring-escape", "pendulum-wave"]);
    expect(state.researcher.source).toBe("skipped");
    expect(state.brief!.points.length).toBeGreaterThan(0);
    expect(calls[0].brief.user).toContain("[r1]");
    expect(calls[0].brief.user).toContain("Pitch 4 ideas.");
    // the skeptic never sees the brainstormer's angle
    expect(calls.find((c) => c.role === "skeptic")!.brief.prefix).not.toContain("the last ring");
    const d = done(state);
    expect(d.copy?.source).toBe("producer");
    for (const c of d.copy!.clips) expect(c.hook).toBe(drawnHookText(clip(state, c.planId).clip));
  });

  it("a request no model pitches, or a broken brainstormer: the ideas by code, a format of each first", async () => {
    const { state, seq } = await run({ stage: "pre", wanted: 2, request: { text: "two ring escapes", open: false, namedTemplate: true, platform: "reels", locale: "en" } }, defaults, {
      plan: (list) => list.map((idea, i) => ({ id: `k${i + 1}`, clip: idea.template === "ring-escape" ? CLIPS.ring : CLIPS.pendulum })),
    });
    expect(state.brainstormer).toMatchObject({ source: "skipped", why: "notOpen" });
    expect(state.ideas.map((i) => [i.template, i.hook, i.basis])).toEqual([["ring-escape", "a", "none"], ["grow-fill", "a", "none"]]);
    expect(seq()[0]).toBe("skeptic k1");
    const broken = await run({ stage: "pre", wanted: 2, request: { text: "anything", open: true, platform: "reels", locale: "en" } }, (brief) => (brief.role === "brainstormer" ? "no" : defaults(brief, 1, [])), { plan: () => [] });
    expect(broken.state.brainstormer).toMatchObject({ source: "rules", why: "broken" });
    expect(broken.state.ideas.length).toBe(4);
  });

  it("live research: the researcher's pass on the digest, its points with an unknown basis dropped", async () => {
    const digest = researchDigest({ trends: TRENDS, now: Date.parse("2026-10-28T12:00:00Z") });
    const first = digest.sources[0].id;
    const script: Script = (brief) =>
      brief.role === "researcher"
        ? { points: [{ id: "r1", area: "pace", advice: "Put the busiest moment late.", lever: { kind: "setting", name: "recordingDuration" }, basis: "zz9", strength: "weak" }, { id: "r2", area: "hook", advice: "Move in the first second.", lever: null, basis: first, strength: "weak" }], stale: false }
        : defaults(brief, 1, []);
    const { state, seq, calls } = await run({ stage: "pre", wanted: 1, candidates: [{ id: "r1", clip: calmRing }], digest, liveResearch: true }, script);
    expect(seq()[0]).toBe("researcher");
    expect(calls[0].brief.user).toBe(digest.text);
    expect(state.brief!.points).toEqual([{ id: "r1", area: "hook", advice: "Move in the first second.", lever: null, basis: first, strength: "weak" }]);
    expect(clip(state, "r1").dossier).toContain("Move in the first second.");
  });

  it("the same verdicts reach the same decision by hand (nextStep, applyVerdict) and through runPanel", async () => {
    const script: Script = (brief, attempt) => (brief.role === "skeptic" && brief.clipId === "c2" ? { ...NOTHING, objections: [{ id: "o1", kind: "notShareable", evidence: ["words.payoff"], severity: "major", note: "" }] } : defaults(brief, attempt, []));
    const input: PanelInput = { stage: "pre", wanted: 3, candidates: batch() };
    const { state: auto } = await run(input, script);
    let s = createPanel(input);
    for (let i = 0; i < 50; i++) {
      const { state, step } = nextStep(s);
      s = state;
      if (step.type === "done") break;
      if (step.type !== "call") throw new Error(step.type);
      s = applyVerdict(s, { role: step.role, clipId: step.clipId, reply: script(step.brief, step.attempt, step.errors) }).state;
    }
    expect(JSON.stringify(done(s))).toBe(JSON.stringify(done(auto)));
    expect(s.log).toEqual(auto.log);
    expect(JSON.stringify(panelDecision(s))).toBe(JSON.stringify(panelDecision(auto)));
  });

  it("every clip's record is a valid review record", async () => {
    const { state } = await run({ stage: "pre", depth: "thorough", wanted: 2, candidates: batch() });
    for (const c of state.clips) {
      const record = clipReviewOf(state, c.id, { model: "claude-opus-5-5", date: "2026-10-28T03:00:00Z" });
      expect(record).not.toBeNull();
      expect(sanitizeReview(record)).toEqual(record);
      expect([c.id, record!.who, record!.separation]).toEqual([c.id, "app", "contexts"]);
    }
    expect(clipReviewOf(state, "c1")!.promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(clipReviewOf(state, "c5")!.verdict).toBe("drop");
  });
});
