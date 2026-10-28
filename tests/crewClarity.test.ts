import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { recipeById, RECIPES } from "@/lib/bot/playbook";
import { planClip, planTemplate, type ClipPlan, type PayoffMoment, type RunFacts } from "@/lib/bot/planner";
import { defaultCaption, type Caption } from "@/lib/captions";
import type { SimulatorSettings } from "@/lib/settings";
import { factsOfExport, runSync } from "@/lib/insights/score";
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
  asciiDigits,
  markObjection,
  publicDomain,
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
/** A render's features, its first sound with its first motion (a bounce is heard when it is seen); `sound` apart from it. */
const features = (first: number | null, sound: number | null = first): ClipFeatures => ({ v: 1, sampleHz: 4, motion: [0, 0.004, 0.006, 0.005, 0.004], firstMotionSec: first, peakMotionPos: 0.8, meanLuma: 0.08, meanSat: 0.5, darkShare: 0.85, soundEventsPerSec: 3, firstSoundSec: sound, gapEvents: 4, loopSeamDiff: 0.01, lufs: -14 });
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

  it("G1 after a render reads the export's first impact as the Playbook score does: its first motion or its first sound, the earlier", () => {
    // (the studio's real run: a small ball on the Simple look's dark background stays under the analyser's motion threshold for
    // 7.5 s while its first bounce is heard at 0.83 s – the Playbook score of the same file read 0.8 s and gave the motion item)
    expect(gateOf(rendered(clean, { features: features(7.5, 0.83) }), "G1")).toMatchObject({ ok: true, key: "motionEarlyOk", values: { sec: 0.8 } });
    expect(factsOfExport(features(7.5, 0.83), clean.timing.clipSec).firstImpactSec).toBe(0.83);
    expect(gateOf(rendered(clean, { features: features(null, 0.5) }), "G1").ok).toBe(true);
    expect(gateOf(rendered(clean, { features: features(0.4, null) }), "G1").ok).toBe(true);
    expect(gateOf(rendered(clean, { features: features(1.6, 1.7) }), "G1")).toMatchObject({ ok: false, key: "motionEarlyMeasuredLate", values: { sec: 1.6 } });
    expect(gateOf(rendered(clean, { features: features(null, null) }), "G1").key).toBe("motionEarlyNone");
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

  // --- crew --- the run's payoff moment (RunFacts.moment, lib/insights/score.ts payoffMomentSync): the studio's real run kept a
  // Ball Drop clip whose "Final chord. 🎹" came over a silent, settled board and a Pendulum Wave whose realignment was its quietest
  // moment, both at Playbook 94-96 with every gate passed
  it("G2 at the payoff's moment: a beat or a promised chord with no sound there, a chord promised and not played, a payoff silent and still", () => {
    const at = clean.payoff.atSec!;
    const moment = (m: Partial<PayoffMoment>): CrewClip => ({ ...clean, run: { ...clean.run!, moment: { atSec: at, sounds: 3, notes: 3, chordMax: 1, accent: false, motion: 200, motionMedian: 250, ...m } } });
    const words = (clip: CrewClip, payoff: string): CrewClip => setCaptions(clip, clip.captions.map((c, i) => (clip.captionRoles[i] === "payoff" ? { ...c, text: payoff } : c)));
    expect(gateOf(moment({}), "G2").ok).toBe(true);
    // a beat must be heard
    expect(gateOf({ ...moment({ sounds: 0, notes: 0, chordMax: 0 }), claim: "beat" }, "G2").problems).toEqual(["payoffLandsUnheard"]);
    // words that name a chord: heard, and the mode's own chord (an accented event), never a cluster of a few notes
    expect(gateOf(words(moment({ sounds: 0, notes: 0, chordMax: 0 }), "Final chord. 🎹"), "G2").problems).toEqual(["payoffLandsUnheard"]);
    expect(gateOf(words(moment({ sounds: 6, notes: 21, chordMax: 7 }), "Back in line. 🎼"), "G2").problems).toEqual(["payoffLandsNoChord"]);
    expect(gateOf(words(moment({ sounds: 6, notes: 21, chordMax: 16, accent: true }), "Back in line. 🎼"), "G2").ok).toBe(true);
    expect(gateOf(words(moment({ chordMax: 1 }), "Acorde final."), "G2").problems).toEqual(["payoffLandsNoChord"]);
    // whatever it claims: never silent and still (a quarter of the run's median motion or less)
    expect(gateOf(moment({ sounds: 0, notes: 0, chordMax: 0, motion: 2, motionMedian: 100 }), "G2").problems).toEqual(["payoffLandsStill"]);
    expect(gateOf(moment({ sounds: 0, notes: 0, chordMax: 0, motion: 40, motionMedian: 100 }), "G2").ok).toBe(true);
    expect(gateOf(moment({ sounds: 1, notes: 1, motion: 2, motionMedian: 100 }), "G2").ok).toBe(true);
    // no balls to move, or a moment read around another second (a fix moved the payoff): nothing to judge by
    expect(gateOf(moment({ sounds: 0, notes: 0, chordMax: 0, motion: null, motionMedian: null }), "G2").ok).toBe(true);
    expect(gateOf({ ...moment({ sounds: 0, notes: 0, chordMax: 0, motion: 0 }), claim: "beat", run: { ...clean.run!, moment: { atSec: at + 1, sounds: 0, notes: 0, chordMax: 0, accent: false, motion: 0, motionMedian: 100 } } }, "G2").ok).toBe(true);
    // a cliffhanger's payoff is not shown: its moment is not judged
    expect(gateOf({ ...cleanCliff, claim: "beat", run: { ...cleanCliff.run!, moment: { atSec: cleanCliff.payoff.atSec!, sounds: 0, notes: 0, chordMax: 0, accent: false, motion: 0, motionMedian: 100 } } }, "G2").ok).toBe(true);
  });

  it("G2 on the real runs: the bot's Ball Drop ends on a silent, settled board and its Pendulum Wave plays no chord at the realignment; the templates' payoffs land", { timeout: 60_000 }, () => {
    const runWithMoment = (plan: ClipPlan) => crewClipOfPlan(plan, { run: runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec) });
    // the bot's recipes, as the Simple look draws them (the daily bot's own plans are unchanged: tests/bot.test.ts)
    const drop = runWithMoment(planClip(recipeById("drop-symphony")!, 1, "reels", { copy, look: "simple" }));
    expect([drop.payoff.text, drop.run!.moment!.sounds, gateOf(drop, "G2").problems]).toEqual(["Final chord. 🎹", 0, ["payoffLandsUnheard", "payoffLandsStill"]]);
    const pendulum = runWithMoment(planClip(recipeById("pendulum-wave")!, 1, "reels", { copy, look: "simple" }));
    expect([pendulum.settings.pwSoundOn, pendulum.run!.moment!.accent, gateOf(pendulum, "G2").problems]).toEqual(["center", false, ["payoffLandsNoChord"]]);
    // the template that wraps Pendulum Wave: every bob at once (--- crew --- review round 2, 21: Ball Drop's template, timed by
    // its last note, is hidden – its plans fail G2 below)
    for (const id of ["line-up-pendulum"]) {
      for (const seed of [1, 2]) {
        const clip = runWithMoment(planTemplate(id, seed, "reels", { copy }));
        expect([id, seed, clip.run!.moment!.sounds > 0, gateOf(clip, "G2").problems]).toEqual([id, seed, true, []]);
        if (id === "line-up-pendulum") expect(clip.run!.moment!.accent).toBe(true);
      }
    }
  });

  // --- crew --- (the studio's second review round, 20 and 21) the payoff against the rest of the run: a promised chord heard as
  // large before or after it, a beat's last note no louder than a tick over a board at rest, and dead air at the end
  it("G2 against the rest of the run: a promised chord played as large elsewhere, a beat's lone faint note over a still board, a quiet end with nothing to read", () => {
    const at = clean.payoff.atSec!;
    const hookEnd = Math.max(...clean.captions.filter((_, i) => clean.captionRoles[i] === "hook").map((c) => c.end));
    const moment = (m: Partial<PayoffMoment>, clip: CrewClip = clean): CrewClip => ({ ...clip, run: { ...clip.run!, moment: { atSec: at, sounds: 3, notes: 3, chordMax: 1, accent: false, motion: 200, motionMedian: 250, ...m } } });
    const hooked = (clip: CrewClip, hook: string): CrewClip => {
      const lines = clip.captions.flatMap((c, i) => (clip.captionRoles[i] === "hook" ? [i] : []));
      return setCaptions(clip, clip.captions.map((c, i) => (i === lines[0] ? { ...c, text: hook } : lines.includes(i) ? { ...c, text: "" } : c)));
    };
    const chord = { sounds: 6, notes: 21, chordMax: 16, accent: true };
    // Outdone: a hook that promises a chord, and an accented event as large after the hook – before the payoff or after it
    const promised = hooked(moment({ ...chord, accents: [[0.03, 16], [at - 10, 16]] }), "Wait for the chord.");
    expect(gateOf(promised, "G2").problems).toEqual(["payoffLandsOutdone"]);
    expect(gateOf(promised, "G2").values).toMatchObject({ notes: 16, payoffNotes: 16 });
    expect(gateOf(hooked(moment({ ...chord, accents: [[at + 0.9, 20]] }), "Wait for the chord."), "G2").problems).toEqual(["payoffLandsOutdone"]);
    // …not one during the hook (the release), a smaller one, one past the clip's end, or a hook that promises none
    expect(gateOf(hooked(moment({ ...chord, accents: [[hookEnd - 0.5, 16], [at - 5, 11], [clean.timing.clipSec + 2, 16]] }), "Wait for the chord."), "G2").ok).toBe(true);
    expect(gateOf(hooked(moment({ ...chord, accents: [[at - 10, 16]] }), "Do they line up?"), "G2").ok).toBe(true);
    // Still, for a beat (its payoff is heard): a few lone notes, fewer than the run's usual moment, none accented, over a board at rest
    const beat = (m: Partial<PayoffMoment>): CrewClip => ({ ...moment(m), claim: "beat" });
    expect(gateOf(beat({ sounds: 2, notes: 2, motion: 3, motionMedian: 100, soundsMedian: 11 }), "G2").problems).toEqual(["payoffLandsStill"]);
    expect(gateOf(beat({ sounds: 12, notes: 12, motion: 3, motionMedian: 100, soundsMedian: 11 }), "G2").ok).toBe(true);
    expect(gateOf(beat({ sounds: 2, notes: 2, accent: true, motion: 3, motionMedian: 100, soundsMedian: 11 }), "G2").ok).toBe(true);
    expect(gateOf(beat({ sounds: 2, notes: 8, chordMax: 4, motion: 3, motionMedian: 100, soundsMedian: 11 }), "G2").ok).toBe(true);
    expect(gateOf(beat({ sounds: 2, notes: 2, motion: 60, motionMedian: 100, soundsMedian: 11 }), "G2").ok).toBe(true);
    // (a payoff the picture carries – a break, an escape – may be drawn beyond the balls: only silence counts there; and a record
    // without the windows' count keeps the old reading)
    expect(gateOf(moment({ sounds: 2, notes: 2, motion: 3, motionMedian: 100, soundsMedian: 11 }), "G2").ok).toBe(true);
    expect(gateOf(beat({ sounds: 2, notes: 2, motion: 3, motionMedian: 100 }), "G2").ok).toBe(true);
    // DeadTail: a clip that ends without words, on more than 1.5 s of silence over still balls
    const wordless = setCaptions(clean, clean.captions.filter((_, i) => clean.captionRoles[i] !== "payoff"), clean.captionRoles.filter((r) => r !== "payoff"));
    expect(gateOf(moment({ quietTailSec: 2.4 }, wordless), "G2").problems).toEqual(["payoffLandsDeadTail"]);
    expect(gateOf(moment({ quietTailSec: 1.4 }, wordless), "G2").ok).toBe(true);
    expect(gateOf(moment({ quietTailSec: 2.4 }), "G2").ok).toBe(true);
    expect(CLARITY.quietTailMaxSec).toBe(1.5);
  });

  it("G2 on the real runs (review round 2, 20 and 21): the pendulum template's chord plays at half its cycle too; Ball Drop's last note fades out", { timeout: 60_000 }, () => {
    const runWithMoment = (plan: ClipPlan) => crewClipOfPlan(plan, { run: runSync(plan.settings, plan.seed, plan.world, plan.recipe, plan.timing.clipSec, plan.payoff.atSec) });
    for (const seed of [1, 2]) {
      const clip = runWithMoment(planTemplate("line-up-pendulum", seed, "reels", { copy }));
      const m = clip.run!.moment!;
      // the same chord, as large, at the release and half a cycle later: no sound setting plays it at the realignment alone
      const hookEnd = Math.max(...clip.captions.filter((_, i) => clip.captionRoles[i] === "hook").map((c) => c.end));
      expect(m.accents!.some(([sec, notes]) => sec > hookEnd && sec < clip.payoff.atSec! && notes >= m.chordMax), `seed ${seed}`).toBe(true);
      // so the template's hook asks the question the line answers, and the gate passes; the recipe's own promise would not
      expect(/chord/i.test(clip.hook!), `seed ${seed}`).toBe(false);
      expect(gateOf(clip, "G2").ok, `seed ${seed}`).toBe(true);
      const lines = clip.captions.flatMap((c, i) => (clip.captionRoles[i] === "hook" ? [i] : []));
      const promised = setCaptions(clip, clip.captions.map((c, i) => (i === lines[0] ? { ...c, text: "Wait for the chord." } : lines.includes(i) ? { ...c, text: "" } : c)));
      expect(gateOf(promised, "G2").problems, `seed ${seed}`).toContain("payoffLandsOutdone");
    }
    // Ball Drop timed by its last note (the hidden template's strategy, no words over it): a lone faint note over a board at
    // rest, and the silence after it until the clip ends
    for (const seed of [1, 3]) {
      const plan = planClip({ ...recipeById("drop-symphony")!, strategy: "lastNote", payoffWords: false }, seed, "reels", { copy, look: "simple", ending: "resolved" });
      const clip = runWithMoment(plan);
      const m = clip.run!.moment!;
      expect([seed, m.chordMax, m.accent, m.sounds < m.soundsMedian!, m.motion! <= CLARITY.stillShareMax * m.motionMedian!]).toEqual([seed, 1, false, true, true]);
      expect(gateOf(clip, "G2").problems, `seed ${seed}`).toEqual(["payoffLandsStill", "payoffLandsDeadTail"]);
    }
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

  // --- crew --- (the studio's second review round, 22) a bar and a timer count the recording's seconds (lib/captions.ts): one
  // taken off at the payoff stops short ("84 %", "0:04"), and a viewer told to wait for 100 % never sees it
  it("G4: a counter of the clip's seconds that leaves before its end; the wall counter, which counts walls, may leave", () => {
    const total = clean.settings.recordingDuration;
    const at = clean.payoff.atSec!;
    const counter = clean.captionRoles.indexOf("countdown");
    expect(clean.captions[counter].type).toBe("wallCounter");
    const as = (type: Caption["type"], end: number): CrewClip => setCaptions(clean, clean.captions.map((c, i) => (i === counter ? { ...c, type, text: type === "progress" ? "[pct]" : type === "countdown" ? "⏱ [time]" : c.text, end } : c)));
    // the wall counter cut at the payoff, as the Simple look draws it: a count of walls, true when it leaves
    expect(gateOf(as("wallCounter", Math.floor(at)), "G4").ok).toBe(true);
    // a bar and a timer cut at the payoff
    const bar = gateOf(as("progress", Math.floor(at)), "G4");
    expect([bar.problems, bar.values]).toEqual([["wordsMatchPictureCounterCut"], { reads: `${Math.round((100 * Math.floor(at)) / total)}%` }]);
    const timer = gateOf(as("countdown", total - 4), "G4");
    expect([timer.problems, timer.values]).toEqual([["wordsMatchPictureCounterCut"], { reads: "0:04" }]);
    // to the end (open-ended, the bot look's), or within a second of it: 100 % or 0:00 on screen
    expect(gateOf(as("progress", 0), "G4").ok).toBe(true);
    expect(gateOf(as("countdown", total - 0.9), "G4").ok).toBe(true);
    expect(CLARITY.counterEndSec).toBe(1);
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

  // --- crew --- the toolbox's export once drew "localhost:3000" in every frame of the studio's clips, handed over to be posted
  it("G8: a free render whose watermark draws an address no viewer can open fails; the site's domain, or none known, passes", () => {
    expect(gateOf(rendered(clean, { watermarkDomain: "localhost:3000" }), "G8").problems).toEqual(["renderedWatermarkLocal"]);
    expect(gateOf(rendered(clean, { watermarkDomain: "localhost:3000" }), "G8").values).toEqual({ domain: "localhost:3000" });
    expect(gateOf(rendered(clean, { watermarkDomain: "jumpingballslive.com" }), "G8").ok).toBe(true);
    expect(gateOf(rendered(clean, { watermarkDomain: null }), "G8").ok).toBe(true);
    expect(gateOf(rendered(clean, { watermarkDomain: "localhost:3000", free: false }), "G8").ok).toBe(true);
    for (const d of ["jumpingballslive.com", "www.jumpingballslive.com", "example.org", "JumpingBallsLive.com."]) expect([d, publicDomain(d)]).toEqual([d, true]);
    for (const d of ["localhost:3000", "localhost", "127.0.0.1", "10.0.0.2", "studio.local", "site.test", "a.localhost", "jumpingballslive.com:443", "https://jumpingballslive.com", "jumpingballslive.com/smoke", "", "-a.com", "[::1]"]) expect([d, publicDomain(d)]).toEqual([d, false]);
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

  it("reads a thousands separator as one, not as a decimal point: '1,000' is a thousand, never one (always a fact)", () => {
    expect(numbersIn("Can 1,000 balls escape?")).toEqual([1000]);
    expect(numbersIn("1.000 kul")).toEqual([1000]);
    expect(numbersIn("2,500 rings")).toEqual([2500]);
    expect(numbersIn("2,000,000 rings")).toEqual([2000000]);
    // the spaces Polish groups with: a plain one, a no-break one, a narrow no-break one
    expect(["1 000 kul", "1\u00a0000 kul", "1\u202f000 kul"].map(numbersIn)).toEqual([[1000], [1000], [1000]]);
    expect([numbersIn("12,345.5"), numbersIn("1.234,5")]).toEqual([[12345.5], [1234.5]]);
    // a decimal stays a decimal: not three digits after the mark, or a leading zero
    expect([numbersIn("1,5"), numbersIn("2.5"), numbersIn("3,14"), numbersIn("0,500"), numbersIn("1234,567")]).toEqual([[1.5], [2.5], [3.14], [0.5], [1234.567]]);
    // a glued k or M multiplies
    expect([numbersIn("10k balls"), numbersIn("2.5M views"), numbersIn("10km")]).toEqual([[10000], [2500000], [10]]);
  });

  it("reads digits of any script and numbers spelled in words in en, pl and es (--- crew ---, review round 2)", () => {
    // fullwidth, Arabic-Indic, mathematical bold and Devanagari digits are the ASCII ones
    expect(["５０ rings", "٥٠ rings", "𝟓𝟎 rings", "𝟱𝟬 rings", "५० rings", "۵۰ rings"].map(numbersIn)).toEqual([[50], [50], [50], [50], [50], [50]]);
    expect(asciiDigits("x٢ in １,５ s")).toBe("x2 in 1,5 s");
    // words, in reading order with the digits, one number however many words it takes
    expect(numbersIn("Fifty rings. One way out.")).toEqual([50, 1]);
    expect(numbersIn("Twenty-one balls, 3 gaps")).toEqual([21, 3]);
    expect(numbersIn("a hundred and five rings")).toEqual([105]);
    expect(numbersIn("two thousand three hundred balls")).toEqual([2300]);
    expect(numbersIn("a dozen rings, fifteen hundred bounces")).toEqual([12, 1500]);
    expect(numbersIn("one, two, three")).toEqual([1, 2, 3]);
    expect(numbersIn("Pięćdziesiąt pierścieni, dwa tysiące odbić, sto dwadzieścia trzy kulki")).toEqual([50, 2000, 123]);
    expect(numbersIn("Trzech wojowników, ośmiu graczy")).toEqual([3, 8]);
    expect(numbersIn("Cincuenta anillos, treinta y tres bolas, doscientas veinte notas")).toEqual([50, 33, 220]);
    expect(numbersIn("dos mil millones de rebotes")).toEqual([2e9]);
    // a plural multiplier alone is no count; a word a language uses otherwise is read by the text's language
    expect([numbersIn("Hundreds of balls"), numbersIn("tysiące kulek"), numbersIn("docenas de bolas")]).toEqual([[], [], []]);
    expect([numbersIn("Ten rings, one gap"), numbersIn("Ten pierścień pęknie"), numbersIn("Czy ten klip wygra"), numbersIn("¡Ten cuidado!")]).toEqual([[10, 1], [], [], []]);
    expect([numbersIn("Watch it once"), numbersIn("¿Once bolas?"), numbersIn("Dos mil anillos"), numbersIn("Sto mil na godzinę? Nie")]).toEqual([[], [11], [2000], [100]]);
    // a word inside another word is no number ("someone", "tension"), nor an ordinal
    expect(numbersIn("Someone's tension: the second ring")).toEqual([]);
  });

  it("G4 and the skeptic's hookUntrue read a spelled number as one: a count the clip does not have fails, one it has passes (--- crew ---, review round 2)", () => {
    // (the hook in one line, its words the given ones)
    const first = clean.captionRoles.indexOf("hook");
    const keep = clean.captions.map((_, i) => clean.captionRoles[i] !== "hook" || i === first);
    const withHookText = (text: string): CrewClip => {
      const captions = clean.captions.map((c, i) => (i === first ? { ...c, text } : c)).filter((_, i) => keep[i]);
      return { ...setCaptions(clean, captions, clean.captionRoles.filter((_, i) => keep[i])), hook: null };
    };
    const untrue = (clip: CrewClip) => markObjection({ id: "o1", kind: "hookUntrue", evidence: ["words.hook"], severity: "fatal", note: "" }, clip, clarityOf(clip)).mark;
    for (const text of ["Fifty rings. One way out.", "５０ rings. One way out.", "Cincuenta anillos", "Pięćdziesiąt pierścieni"]) {
      expect([text, gateOf(withHookText(text), "G4").problems, untrue(withHookText(text))]).toEqual([text, ["wordsMatchPictureHookNumber"], "confirmed"]);
    }
    const n = clean.timing.recordingDuration;
    const spelled = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"][n];
    expect([spelled, gateOf(withHookText(`Out in ${spelled} seconds?`), "G4").ok, untrue(withHookText(`Out in ${spelled} seconds?`))]).toEqual([spelled, true, "refuted"]);
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
