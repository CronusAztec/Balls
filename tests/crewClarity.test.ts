import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { recipeById, RECIPES } from "@/lib/bot/playbook";
import { planClip, type ClipPlan, type RunFacts } from "@/lib/bot/planner";
import { defaultCaption, type Caption } from "@/lib/captions";
import type { SimulatorSettings } from "@/lib/settings";
import { runSync } from "@/lib/insights/score";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import {
  CLARITY,
  GATES,
  SIMPLE_BANDS,
  clarityOf,
  claimSeen,
  crewClipOfPlan,
  factNumbersOf,
  failedGates,
  numbersIn,
  runWinnerOf,
  simpleScore,
  type CrewClip,
  type CrewMeasured,
  type GateId,
} from "@/lib/crew";

/*
 * --- crew --- The clarity check (lib/crew/clarity.ts, C1 of the AI studio plan): the gates G1–G8 that decide for free whether a
 * clip is clear and simple enough for a model's time. A calm, one-line-at-a-time version of a real ring-escape plan passes them
 * all; one planted defect per gate fails exactly that gate; each gate's other problems are caught by a case of their own; and
 * today's recipe plans say what their run does (G3 and G4) on the planner's own runs.
 */

const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;

/** A plan in a calm look (the look settings that leave the run alone: the cinematic camera stays, it moves the run). */
function calm(plan: ClipPlan): ClipPlan {
  const s: SimulatorSettings = { ...plan.settings, showWallGlow: false, colorTrail: false, rainbowWalls: false, screenShake: 0, wallBreakStyle: "shatter", particleStyle: "sparks", rainbowBall: false, topText: "", bottomText: "" };
  const hookEnd = Math.max(...s.captions.filter((_, i) => plan.captionRoles[i] === "hook").map((c) => c.end));
  s.captions = s.captions.map((c, i) => (plan.captionRoles[i] === "countdown" ? { ...c, start: hookEnd } : c));
  return { ...plan, settings: s };
}
const runOf = (plan: ClipPlan): RunFacts => runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec);
const withRun = (plan: ClipPlan): CrewClip => crewClipOfPlan(plan, { run: runOf(plan) });
const setCaptions = (clip: CrewClip, captions: Caption[], roles = clip.captionRoles): CrewClip => ({ ...clip, captions, captionRoles: roles, settings: { ...clip.settings, captions } });
const failed = (clip: CrewClip) => failedGates(clarityOf(clip));
const gateOf = (clip: CrewClip, id: GateId) => clarityOf(clip).gates.find((g) => g.id === id)!;
const features = (first: number | null): ClipFeatures => ({ v: 1, sampleHz: 4, motion: [0, 0.004, 0.006, 0.005, 0.004], firstMotionSec: first, peakMotionPos: 0.8, meanLuma: 0.08, meanSat: 0.5, darkShare: 0.85, soundEventsPerSec: 3, firstSoundSec: 0.1, gapEvents: 4, loopSeamDiff: 0.01, lufs: -14 });
const rendered = (clip: CrewClip, m: Partial<CrewMeasured> = {}): CrewClip => ({ ...clip, measured: { features: features(0.4), durationSec: clip.timing.clipSec, laggedFrames: 3, frames: 1000, watermarked: true, free: true, ...m } });

const resolvedPlan = calm(planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 }));
const cliffPlan = calm(planClip(recipeById("ring-escape")!, 1, "reels", { copy, ending: "cliffhanger", episode: 3 }));
const clean = withRun(resolvedPlan);
const cleanCliff = withRun(cliffPlan);

describe("a clean clip", () => {
  it("passes every gate before a render, resolved and cliffhanger, with G8 left for the render", () => {
    for (const clip of [clean, cleanCliff]) {
      const c = clarityOf(clip);
      expect([clip.ending, c.pass, failedGates(c)]).toEqual([clip.ending, true, []]);
      expect(c.stage).toBe("pre");
      expect(c.gates.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
      expect(c.simple.score).toBeGreaterThanOrEqual(SIMPLE_BANDS.simple);
      expect(c.playbook).toEqual({ score: clip.playbook.score, reasons: clip.playbook.reasons });
      for (const g of c.gates) expect([g.id, g.ok, g.problems, g.key.startsWith(g.name)]).toEqual([g.id, true, [], true]);
    }
  });

  it("passes all eight after a clean render", () => {
    const c = clarityOf(rendered(clean));
    expect([c.stage, c.pass, c.gates.map((g) => g.id)]).toEqual(["post", true, GATES.map((g) => g.id)]);
  });

  it("is deterministic: the same clip, the same verdict to the byte", () => {
    expect(JSON.stringify(clarityOf(clean))).toBe(JSON.stringify(clarityOf(withRun(calm(planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 }))))));
  });
});

describe("one planted defect per gate fails exactly that gate", () => {
  const hookIdx = clean.captionRoles.map((r, i) => (r === "hook" ? i : -1)).filter((i) => i >= 0);
  const defects: Record<GateId, () => CrewClip> = {
    // the first impact at 1.8 s
    G1: () => ({ ...clean, timing: { ...clean.timing, firstImpactSec: 1.8 } }),
    // the payoff at half the clip
    G2: () => ({ ...clean, payoff: { ...clean.payoff, atSec: clean.timing.clipSec / 2, position: 0.5 } }),
    // the mode switched since the plan (between two ring modes the recipe plays)
    G3: () => ({ ...clean, settings: { ...clean.settings, mode: "accumulation" } }),
    // a number in the hook the clip does not have
    G4: () => {
      const captions = clean.captions.map((c, i) => (hookIdx.includes(i) ? { ...c, text: c.text.replace(/\d+/, "99") } : c));
      return { ...setCaptions(clean, captions), hook: clean.hook!.replace(/\d+/, "99") };
    },
    // the hook's two lines in 2 s: 1 s a line
    G5: () => setCaptions(clean, clean.captions.map((c, i) => (hookIdx.includes(i) ? { ...c, end: 2 } : c))),
    // every effect on and the loop HUD
    G6: () => ({ ...clean, settings: { ...clean.settings, showWallGlow: true, colorTrail: true, rainbowWalls: true, rainbowBall: true, reactiveBackground: true, screenShake: 1, particleStyle: "confetti", wallBreakStyle: "all", loopHud: true, ringTimer: true } }),
    // 40 s on Shorts, which takes 8–30 s
    G7: () => ({ ...clean, platform: "shorts", timing: { ...clean.timing, clipSec: 40 } }),
    // a render that lagged on 5 % of its frames
    G8: () => rendered(clean, { laggedFrames: 50, frames: 1000 }),
  };

  for (const g of GATES) {
    it(`${g.id} ${g.name}`, () => {
      expect(clarityOf(clean).pass).toBe(true);
      const clip = defects[g.id]();
      expect(failed(clip)).toEqual([g.id]);
      expect(clarityOf(clip).pass).toBe(false);
    });
  }

  it("the hook in the G4 defect is two lines, as the planner splits it", () => {
    expect(hookIdx.length).toBe(2);
    expect(numbersIn(clean.hook!)).toEqual([clean.timing.recordingDuration]);
  });
});

describe("each gate's other problems", () => {
  it("G1: an unknown first impact fails; after a render the measured first motion decides (1.5 s), and none at all fails", () => {
    expect(gateOf({ ...clean, timing: { ...clean.timing, firstImpactSec: null } }, "G1").key).toBe("motionEarlyUnknown");
    const late = { ...clean, timing: { ...clean.timing, firstImpactSec: 1.4 } };
    expect(gateOf(late, "G1").ok).toBe(false);
    expect(gateOf(rendered(late, { features: features(1.4) }), "G1").ok).toBe(true);
    expect(gateOf(rendered(clean, { features: features(1.6) }), "G1").key).toBe("motionEarlyMeasuredLate");
    expect(gateOf(rendered(clean, { features: features(null) }), "G1").key).toBe("motionEarlyNone");
  });

  it("G2: a resolved payoff too late or not shown long enough; a cliffhanger cut too far or with no question at its end", () => {
    const c = clean.timing.clipSec;
    expect(gateOf({ ...clean, payoff: { ...clean.payoff, atSec: 0.98 * c, position: 0.98 } }, "G2").problems).toEqual(["payoffLandsLate", "payoffLandsNotShown"]);
    expect(gateOf({ ...clean, payoff: { ...clean.payoff, atSec: c - 0.5, position: 0.9 } }, "G2").problems).toEqual(["payoffLandsNotShown"]);
    expect(gateOf({ ...clean, payoff: { ...clean.payoff, atSec: null, position: null } }, "G2").key).toBe("payoffLandsMissing");
    expect(gateOf({ ...cleanCliff, payoff: { ...cleanCliff.payoff, cutGapSec: 4 } }, "G2").key).toBe("payoffLandsCutFar");
    expect(gateOf({ ...cleanCliff, payoff: { ...cleanCliff.payoff, atSec: null, cutGapSec: null } }, "G2").key).toBe("payoffLandsNever");
    const noQuestion = setCaptions(cleanCliff, cleanCliff.captions.filter((_, i) => cleanCliff.captionRoles[i] !== "question"), cleanCliff.captionRoles.filter((r) => r !== "question"));
    expect(gateOf(noQuestion, "G2").problems).toEqual(["payoffLandsNoQuestion"]);
  });

  it("G3: two hook messages, or a payoff and a closing question in one clip", () => {
    const twoHooks = setCaptions(clean, [...clean.captions, { ...defaultCaption("text", { text: "Watch" }), start: 0.5, end: 2.6, position: "bottom" }], [...clean.captionRoles, "hook"]);
    expect(gateOf(twoHooks, "G3").problems).toEqual(["oneIdeaTwoHooks"]);
    const twoEndings = setCaptions(clean, [...clean.captions, { ...defaultCaption("question", { text: "Did it?" }), start: clean.timing.clipSec - 2, end: 0 }], [...clean.captionRoles, "question"]);
    expect(gateOf(twoEndings, "G3").problems).toEqual(["oneIdeaTwoEndings"]);
    // a second text after the hook is no second ending: it costs Simple points instead
    const secondText = setCaptions(clean, [...clean.captions, { ...defaultCaption("text", { text: "Again" }), start: 6, end: 8 }], [...clean.captionRoles, "payoff"]);
    expect(gateOf(secondText, "G3").ok).toBe(true);
    expect(simpleScore(secondText).score).toBeLessThan(simpleScore(clean).score);
  });

  it("G4: a hook the clip does not draw, a winner the run did not crown, a recipe that does not play the mode, a claim the run does not show", () => {
    expect(gateOf({ ...clean, hook: "A different hook" }, "G4").problems).toEqual(["wordsMatchPictureHookNotDrawn"]);
    expect(gateOf({ ...clean, recipe: "power-layers", claim: "out" }, "G4").problems).toContain("wordsMatchPictureHookElsewhere");
    const noEscape: RunFacts = { ...clean.run!, firstEscapeSec: -1, homeSec: -1 };
    expect(gateOf({ ...clean, run: noEscape }, "G4").problems).toEqual(["wordsMatchPictureClaimUnseen"]);
    expect(gateOf({ ...clean, run: null, simulated: false }, "G4").problems).toEqual(["wordsMatchPictureClaimUnmeasured"]);
    // a battle: the payoff names its winner, which must be the run's
    const battle = withRun(planClip(recipeById("battle-royale")!, 3, "reels", { copy, ending: "resolved", episode: 3 }));
    const winner = runWinnerOf(battle);
    expect(winner).not.toBeNull();
    expect(battle.payoff.winner).toBe(winner);
    expect(gateOf(battle, "G4").ok).toBe(true);
    const other = battle.settings.teams.find((t) => t.name !== winner)!.name;
    expect(gateOf({ ...battle, payoff: { ...battle.payoff, winner: other } }, "G4").key).toBe("wordsMatchPictureWrongWinner");
    // a string battle names its winner in its payoff words
    const sb = withRun(planClip(recipeById("string-battle")!, 3, "reels", { copy, ending: "resolved", episode: 3 }));
    const sbWinner = runWinnerOf(sb)!;
    const pIdx = sb.captionRoles.indexOf("payoff");
    expect(sb.captions[pIdx].text).toContain(sbWinner);
    const liar = sb.settings.teams.find((t) => t.name !== sbWinner)!.name;
    const lying = setCaptions({ ...sb, payoff: { ...sb.payoff, winner: null } }, sb.captions.map((c, i) => (i === pIdx ? { ...c, text: c.text.replace(sbWinner, liar) } : c)));
    expect(gateOf(lying, "G4").key).toBe("wordsMatchPictureWrongWinner");
  });

  it("G5: a caption out of the safe zone, a Top Text over an arena's band, three lines, a long hook, a hurried line", () => {
    const wide = setCaptions(clean, [...clean.captions, { ...defaultCaption("text", { text: "This caption is far too wide to fit inside the safe zone of a phone" }), start: 5, end: 9 }], [...clean.captionRoles, "payoff"]);
    expect(gateOf(wide, "G5").problems).toContain("readableUnsafe");
    const battle = crewClipOfPlan(planClip(recipeById("battle-royale")!, 3, "reels", { copy, ending: "resolved", search: false }));
    expect(gateOf({ ...battle, topText: "Day 3" }, "G5").problems).toContain("readableOverBand");
    const three = setCaptions(clean, [...clean.captions, ...["a", "b", "c"].map((t) => ({ ...defaultCaption("text", { text: t }), start: 5, end: 9 }))], [...clean.captionRoles, "payoff", "payoff", "payoff"]);
    expect(gateOf(three, "G5").problems).toContain("readableLines");
    // eight short words on the hook's two lines: each line fits, the hook is too long to read in time
    const lines = ["one two three four", "five six seven eight"];
    let k = 0;
    const wordy = setCaptions(clean, clean.captions.map((c, i) => (clean.captionRoles[i] === "hook" ? { ...c, text: lines[k++] } : c)));
    expect(k).toBe(2);
    expect(gateOf({ ...wordy, hook: null }, "G5").problems).toEqual(["readableHookWords"]);
  });

  it("G7: a cut is judged by its own length", () => {
    expect(gateOf({ ...clean, cut: { startSec: 2, lengthSec: 11, hook: "", url: "", cardSec: 1.5 } }, "G7").ok).toBe(true);
    expect(gateOf({ ...clean, cut: { startSec: 2, lengthSec: 4, hook: "", url: "", cardSec: 0 } }, "G7").key).toBe("lengthFitsOut");
  });

  it("G8: a free render without the watermark, or one not known to carry it, fails; a Pro render need not carry it", () => {
    expect(gateOf(rendered(clean, { watermarked: false }), "G8").problems).toEqual(["renderedNoWatermark"]);
    expect(gateOf(rendered(clean, { watermarked: null }), "G8").problems).toEqual(["renderedWatermarkUnknown"]);
    expect(gateOf(rendered(clean, { watermarked: false, free: false }), "G8").ok).toBe(true);
    expect(gateOf(rendered(clean, { laggedFrames: 20, frames: 1000 }), "G8").ok).toBe(true); // 2 % exactly
  });

  it("G6: the threshold is the Simple band's 60", () => {
    expect(CLARITY.simpleMin).toBe(60);
    const s = simpleScore(clean).score;
    expect(gateOf(clean, "G6").values).toEqual({ simple: s });
  });
});

describe("the facts a hook may state", () => {
  it("reads numbers, not multiplier labels or numbers glued to letters", () => {
    expect(numbersIn("x2 x4 x8… until it breaks.")).toEqual([]);
    expect(numbersIn("8 fighters. 1 champion.")).toEqual([8, 1]);
    expect(numbersIn("×4 in 1,5 s, ep12 #3 and 37%")).toEqual([1.5, 3, 37]);
  });

  it("knows the recipe's hook values, the clip's length and the day", () => {
    const f = factNumbersOf(clean);
    expect(f).toEqual(expect.arrayContaining([1, clean.timing.recordingDuration, clean.settings.wallCount, clean.episode]));
  });
});

describe("today's recipe plans say what their run does", () => {
  // the planner's real search (a few seeds a clip), each plan's seed run again from its settings, in the plan's world
  const plans = RECIPES.flatMap((recipe) => (["resolved", "cliffhanger"] as const).map((ending) => planClip(recipe, 11, "reels", { copy, ending, episode: 4, maxSeeds: 6 })));

  it("one idea, words that match the picture, and a claim the run shows (G3, G4)", () => {
    let checked = 0;
    for (const plan of plans) {
      const clip = withRun(plan);
      const c = clarityOf(clip);
      expect([plan.id, c.gates.find((g) => g.id === "G3")!.problems]).toEqual([plan.id, []]);
      // a plan whose seed search found no accepted seed may miss its claim: the planner keeps its closest candidate
      if (!plan.timing.found) continue;
      checked++;
      expect([plan.id, c.gates.find((g) => g.id === "G4")!.problems]).toEqual([plan.id, []]);
      expect([plan.id, claimSeen(clip)]).toEqual([plan.id, true]);
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });
});
