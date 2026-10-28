import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { recipeById } from "@/lib/bot/playbook";
import { planClip, planTemplate, type ClipPlan, type RunFacts } from "@/lib/bot/planner";
import type { SimulatorSettings } from "@/lib/settings";
import { runSync } from "@/lib/insights/score";
import type { ClipFeatures } from "@/lib/recording/clipFeatures";
import {
  EVIDENCE,
  MEASURABLE_KINDS,
  OBJECTION_KINDS,
  clarityOf,
  confirmedDistractions,
  crewClipOfPlan,
  crowding,
  hudsOn,
  makesSenseOf,
  markObjection,
  markObjections,
  overlaysOf,
  shownSecOf,
  standing,
  type CrewClip,
  type CrewMeasured,
  type ObjectionKind,
  type Severity,
  type SkepticObjection,
} from "@/lib/crew";

/*
 * --- crew --- The evidence check (lib/crew/evidence.ts, C3 of the AI studio plan): each measurable objection the skeptic may
 * raise is confirmed where the clip's facts cross its threshold and refuted where they do not – one case each way per kind –
 * a judgement is an opinion (half weight, never a blocker, standing only at major or fatal), a fact the clip does not have makes
 * an opinion too, and the viewer's read and distractions are held to the claim and the measures.
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
/** A ready template's Simple plan (reels, plan seed 1), with its run. */
const templateClip = (id: string): CrewClip => withRun(planTemplate(id, 1, "reels", { copy, look: "simple" }));
/** A render's features, its first sound with its first motion (a bounce is heard when it is seen); `sound` apart from it. */
const features = (first: number | null, sound: number | null = first): ClipFeatures => ({ v: 1, sampleHz: 4, motion: [0, 0.004, 0.006, 0.005, 0.004], firstMotionSec: first, peakMotionPos: 0.8, meanLuma: 0.08, meanSat: 0.5, darkShare: 0.85, soundEventsPerSec: 3, firstSoundSec: sound, gapEvents: 4, loopSeamDiff: 0.01, lufs: -14 });
const rendered = (clip: CrewClip, m: Partial<CrewMeasured> = {}): CrewClip => ({ ...clip, measured: { features: features(0.4), durationSec: clip.timing.clipSec, laggedFrames: 0, frames: 1000, watermarked: true, free: true, ...m } });

const resolvedPlan = planClip(recipeById("ring-escape")!, 2, "reels", { copy, ending: "resolved", episode: 3 });
const cliffPlan = planClip(recipeById("ring-escape")!, 1, "reels", { copy, ending: "cliffhanger", episode: 3 });
const busy = withRun(resolvedPlan);
const clean = withRun(calm(resolvedPlan));
const cleanCliff = withRun(calm(cliffPlan));
const hookIdx = clean.captionRoles.map((r, i) => (r === "hook" ? i : -1)).filter((i) => i >= 0);
/** One text at a time: the counter leaves when the payoff's words come. */
const payoffStart = Math.min(...clean.captions.filter((_, i) => clean.captionRoles[i] === "payoff").map((c) => c.start));
const single: CrewClip = (() => {
  const captions = clean.captions.map((c, i) => (clean.captionRoles[i] === "countdown" ? { ...c, end: payoffStart } : c));
  return { ...clean, captions, settings: { ...clean.settings, captions } };
})();
/** …and no effect the Simple score charges for (the cinematic camera off: the run handed in stays the planner's). */
const quiet: CrewClip = { ...single, settings: { ...single.settings, cinematicEnabled: false } };

const objection = (kind: ObjectionKind, severity: Severity = "major", evidence: SkepticObjection["evidence"] = ["beats.payoff"]): SkepticObjection => ({ id: "o1", kind, evidence, severity, note: "" });
const markOf = (clip: CrewClip, kind: ObjectionKind, severity: Severity = "major") => markObjection(objection(kind, severity), clip, clarityOf(clip));
const withPayoff = (clip: CrewClip, payoff: Partial<CrewClip["payoff"]>): CrewClip => ({ ...clip, payoff: { ...clip.payoff, ...payoff } });
const setCaptions = (clip: CrewClip, captions: CrewClip["captions"]): CrewClip => ({ ...clip, captions, settings: { ...clip.settings, captions } });

describe("the clean clips", () => {
  it("pass every gate, so each measurable objection on them is the facts' to settle", () => {
    expect(clarityOf(clean).pass).toBe(true);
    expect(clarityOf(cleanCliff).pass).toBe(true);
    expect(clean.payoff.position!).toBeGreaterThan(EVIDENCE.payoffEarlyBelow);
    expect(clean.payoff.position!).toBeLessThanOrEqual(EVIDENCE.payoffLateFrom);
  });
});

describe("each measurable kind: confirmed past its threshold, refuted short of it", () => {
  const c = clean.timing.clipSec;
  const cases: Record<(typeof MEASURABLE_KINDS)[number], { confirmed: () => CrewClip; refuted: () => CrewClip }> = {
    payoffLate: { confirmed: () => withPayoff(clean, { atSec: 0.93 * c, position: 0.93 }), refuted: () => clean },
    payoffEarly: { confirmed: () => withPayoff(clean, { atSec: 0.62 * c, position: 0.62 }), refuted: () => clean },
    payoffMissing: { confirmed: () => withPayoff(clean, { atSec: null, position: null }), refuted: () => clean },
    slowStart: { confirmed: () => ({ ...clean, timing: { ...clean.timing, firstImpactSec: 1.4 } }), refuted: () => clean },
    hookUntrue: {
      confirmed: () => setCaptions(clean, clean.captions.map((x, i) => (hookIdx.includes(i) ? { ...x, text: x.text.replace(/\d+/, "99") } : x))),
      refuted: () => clean,
    },
    tooBusy: { confirmed: () => busy, refuted: () => single },
    textUnreadable: { confirmed: () => setCaptions(clean, clean.captions.map((x, i) => (hookIdx.includes(i) ? { ...x, end: 2 } : x))), refuted: () => clean },
  };
  for (const kind of MEASURABLE_KINDS) {
    it(kind, () => {
      const yes = markOf(cases[kind].confirmed(), kind);
      expect([yes.mark, yes.stands, yes.weight, yes.blocker]).toEqual(["confirmed", true, 1, false]);
      const no = markOf(cases[kind].refuted(), kind);
      expect([no.mark, no.stands, no.weight, no.blocker]).toEqual(["refuted", false, 0, false]);
      expect(no.basis).toMatch(/^not supported by the run: /);
    });
  }

  it("a cliffhanger: late when cut more than 1 s before its payoff, early when the payoff comes before the cut, never missing for coming after it", () => {
    expect(markOf(withPayoff(cleanCliff, { cutGapSec: 1.5 }), "payoffLate").mark).toBe("confirmed");
    expect(markOf(cleanCliff, "payoffLate").mark).toBe("refuted");
    expect(markOf(withPayoff(cleanCliff, { cutGapSec: -0.5 }), "payoffEarly").mark).toBe("confirmed");
    expect(markOf(cleanCliff, "payoffEarly").mark).toBe("refuted");
    expect(markOf(cleanCliff, "payoffMissing").mark).toBe("refuted");
    expect(markOf(withPayoff(cleanCliff, { atSec: null, cutGapSec: null }), "payoffMissing").mark).toBe("confirmed");
  });

  it("payoffLate also when too little is shown after the payoff, payoffMissing when the run never shows the claim", () => {
    expect(markOf(withPayoff(clean, { atSec: c - 0.3, position: (c - 0.3) / c }), "payoffLate").mark).toBe("confirmed");
    const noEscape: RunFacts = { ...clean.run!, firstEscapeSec: -1, homeSec: -1 };
    expect(markOf({ ...clean, run: noEscape }, "payoffMissing").mark).toBe("confirmed");
  });

  it("slowStart after a render reads the measured first motion (1.5 s), and no motion at all confirms it", () => {
    expect(markOf(rendered(clean, { features: features(2) }), "slowStart").mark).toBe("confirmed");
    expect(markOf(rendered(clean, { features: features(null) }), "slowStart").mark).toBe("confirmed");
    expect(markOf(rendered(clean, { features: features(1.2) }), "slowStart").mark).toBe("refuted");
    // (the plan's first impact past 1 s, but the render moved by 1.2 s: the render decides)
    expect(markOf(rendered({ ...clean, timing: { ...clean.timing, firstImpactSec: 1.3 } }, { features: features(1.2) }), "slowStart").mark).toBe("refuted");
  });

  it("slowStart after a render reads the export's first impact as gate G1 does: a first bounce heard early refutes it", () => {
    // (the picture's motion measured late on a calm dark clip, its first bounce heard at 0.83 s: the clip starts well)
    const heard = markOf(rendered(clean, { features: features(7.5, 0.83) }), "slowStart");
    expect([heard.mark, heard.basis]).toEqual(["refuted", "not supported by the run: first impact measured at 0.8 s (motion 7.5 s, sound 0.8 s)"]);
    expect(markOf(rendered(clean, { features: features(2, 1.9) }), "slowStart").mark).toBe("confirmed");
  });

  it("tooBusy with two messages on screen at once, even at a high Simple score", () => {
    // (the calm clip's counter stays on after the payoff's words come: two at once for a while)
    expect(clarityOf(clean).simple.score).toBeGreaterThanOrEqual(EVIDENCE.busySimpleBelow);
    expect(markOf(clean, "tooBusy").mark).toBe("confirmed");
    expect(markOf(single, "tooBusy").mark).toBe("refuted");
  });

  it("tooBusy leaves out the HUDs a clip draws by design: the mode's own, and the one it keeps for its countdown (--- crew ---, review round 2)", () => {
    // (Power Layers' layer count is on screen beside the hook – two at once, Simple 91 –, and no listed fix takes it away)
    const layers = templateClip("smash-power-layers");
    expect(crowding(overlaysOf(layers), shownSecOf(layers)).most).toBe(2);
    expect(clarityOf(layers).simple.score).toBeGreaterThanOrEqual(EVIDENCE.busySimpleBelow);
    expect(markOf(layers, "tooBusy")).toMatchObject({ mark: "refuted", basis: expect.stringMatching(/1 at once at most beside the HUD the clip keeps$/) });
    // (String Battle's lives panel: kept, it is the template's countdown; a clip that does not keep it can turn it off)
    const strings = templateClip("who-wins-string-battle");
    expect(hudsOn(strings.settings).map((h) => h.id)).toContain("sbHud");
    expect(markOf(strings, "tooBusy").mark).toBe("refuted");
    const unkept = markObjection(objection("tooBusy"), strings, clarityOf(strings, { keepHuds: [] }), { keepHuds: [] });
    expect([unkept.mark, unkept.basis]).toEqual(["confirmed", `Simple ${clarityOf(strings, { keepHuds: [] }).simple.score}, 2 at once at most`]);
    // (and a busy look stays busy: the line below 80 is the Simple score's, HUDs and all)
    expect(markOf(busy, "tooBusy").mark).toBe("confirmed");
  });
});

describe("what the facts cannot settle is an opinion", () => {
  const judgements = OBJECTION_KINDS.filter((k) => !(MEASURABLE_KINDS as readonly string[]).includes(k));

  it("the judgement kinds: half weight at major or fatal, nothing at minor, never a blocker", () => {
    expect(judgements).toEqual(["hookMismatch", "twoIdeas", "endingConfusing", "notShareable", "sameAsOther"]);
    for (const kind of judgements) {
      for (const [severity, stands, weight] of [["minor", false, 0], ["major", true, 0.5], ["fatal", true, 0.5]] as const) {
        const m = markOf(busy, kind, severity);
        expect([kind, severity, m.mark, m.stands, m.weight, m.blocker]).toEqual([kind, severity, "opinion", stands, weight, false]);
      }
    }
  });

  it("a measurable kind whose fact is unknown: no run, nothing simulated, no first impact", () => {
    const unsimulated: CrewClip = { ...clean, run: null, simulated: false, timing: { ...clean.timing, firstImpactSec: null } };
    expect(markOf(unsimulated, "slowStart").mark).toBe("opinion");
    expect(markOf(withPayoff(unsimulated, { atSec: null, position: null }), "payoffMissing").mark).toBe("opinion");
    // (a simulated plan without its run: its payoff second is a fact either way)
    expect(markOf(withPayoff({ ...clean, run: null }, { atSec: null, position: null }), "payoffMissing").mark).toBe("confirmed");
    expect(markOf({ ...clean, run: null }, "payoffMissing").mark).toBe("refuted");
  });

  it("a confirmed fatal objection blocks a keep; a confirmed minor one stands without blocking", () => {
    const late = withPayoff(clean, { atSec: 0.95 * clean.timing.clipSec, position: 0.95 });
    expect(markOf(late, "payoffLate", "fatal").blocker).toBe(true);
    const minor = markOf(late, "payoffLate", "minor");
    expect([minor.mark, minor.stands, minor.blocker]).toEqual(["confirmed", true, false]);
  });

  it("standing() keeps the confirmed and the major opinions, in the skeptic's order", () => {
    const marks = markObjections(
      [
        { id: "o1", kind: "payoffLate", evidence: ["beats.payoff"], severity: "major", note: "" },
        { id: "o2", kind: "notShareable", evidence: ["words.payoff"], severity: "minor", note: "" },
        { id: "o3", kind: "tooBusy", evidence: ["score.simple"], severity: "major", note: "" },
      ],
      busy,
      clarityOf(busy),
    );
    expect(marks.map((m) => m.mark)).toEqual(["refuted", "opinion", "confirmed"]);
    expect(standing(marks).map((m) => m.id)).toEqual(["o3"]);
  });

  it("is deterministic: the same objection on the same clip, the same mark to the byte", () => {
    expect(JSON.stringify(markOf(busy, "tooBusy"))).toBe(JSON.stringify(markOf(withRun(resolvedPlan), "tooBusy")));
  });
});

describe("the viewer's read", () => {
  it("makes sense when it names the claim; partly when not sure or the clip has no claim; not when it reads nothing or another claim", () => {
    expect(clean.claim).toBe("out");
    expect(makesSenseOf("out", "out")).toBe("yes");
    expect(makesSenseOf("winner", "out")).toBe("no");
    expect(makesSenseOf("notSure", "out")).toBe("partly");
    expect(makesSenseOf("nothing", "out")).toBe("no");
    expect(makesSenseOf("out", null)).toBe("partly");
    expect(makesSenseOf("nothing", null)).toBe("no");
  });

  it("a distraction it names stands only where a measure confirms it", () => {
    const all = ["text", "effects", "hud", "background", "shake", "watermarkOverlap", "nothingHappens", "tooFast"] as const;
    expect(confirmedDistractions(all, quiet, clarityOf(quiet))).toEqual([]);
    expect(confirmedDistractions(all, clean, clarityOf(clean))).toEqual(["text", "effects"]);
    expect(confirmedDistractions(all, busy, clarityOf(busy))).toEqual(["text", "effects", "shake"]);
    const pulsing: CrewClip = { ...quiet, settings: { ...quiet.settings, reactiveBackground: true, loopHud: true } };
    expect(confirmedDistractions(["background", "hud"], pulsing, clarityOf(pulsing))).toEqual(["background", "hud"]);
    const still: CrewClip = { ...quiet, timing: { ...quiet.timing, firstImpactSec: 1.8 } };
    expect(confirmedDistractions(["nothingHappens", "nothingHappens"], still, clarityOf(still))).toEqual(["nothingHappens"]);
    const wide = setCaptions(quiet, quiet.captions.map((x, i) => (hookIdx[0] === i ? { ...x, text: "W".repeat(40) } : x)));
    expect(confirmedDistractions(["watermarkOverlap"], wide, clarityOf(wide))).toEqual(["watermarkOverlap"]);
    // --- templates --- a text over the action is text in the way: balls moving under the top hook (the second row of the
    // square's 20 × 20 cells) while the bottom stays clear, the whole clip
    const covered: CrewClip = { ...quiet, run: { ...quiet.run!, action: { stepSec: 0.5, grid: 20, samples: Array.from({ length: 60 }, () => "0t0u") } } };
    expect(clarityOf(covered).simple.deductions.some((d) => d.id === "textOverAction")).toBe(true);
    expect(confirmedDistractions(["text"], quiet, clarityOf(quiet))).toEqual([]);
    expect(confirmedDistractions(["text"], covered, clarityOf(covered))).toEqual(["text"]);
  });
});
