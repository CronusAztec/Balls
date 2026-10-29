import { describe, expect, it } from "vitest";
import {
  COVER_ARMS,
  DIALS,
  DIAL_IDS,
  ENDING_ARMS,
  FORMAT_ARMS,
  FORMAT_IDS,
  L2_OPTIONS,
  L3_DIALS_ON,
  L3_OPTIONS,
  LENGTH_ARMS,
  NEWCOMER_TEMPLATES,
  TEMPLATE_ID,
  TEST_ORDER,
  activeDials,
  challengersOf,
  isDialArm,
  questionKey,
} from "@/lib/insights/dials";
import { DEFAULT_LEARNER, resolveLearner, sanitizeLearner } from "@/lib/insights/learnerSettings";
import { PAIRS_PER_DAY_DEFAULT, PAIRS_PER_DAY_MAX } from "@/lib/insights/learnerRules";
import { ENDING_STYLES, LENGTH_BUCKETS } from "@/lib/bot/playbook";
import { TEMPLATE_FORMAT_IDS, allTemplates } from "@/lib/bot/templates";
import type { PlanOptions } from "@/lib/bot/planner";

/*
 * --- learner --- The dials (lib/insights/dials.ts): a closed table of plan options the learner may pick, the test order and
 * the newcomers, and the learner's settings (lib/insights/learnerSettings.ts).
 */

// --- learner ---

describe("the dials", () => {
  it("mirror the planner's lists (the file imports types only, for the main process)", () => {
    expect([...LENGTH_ARMS]).toEqual([...LENGTH_BUCKETS]);
    expect([...ENDING_ARMS]).toEqual([...ENDING_STYLES]);
    expect([...FORMAT_IDS]).toEqual([...TEMPLATE_FORMAT_IDS]);
    expect(FORMAT_ARMS[0]).toBe("mix");
  });

  it("every L2 dial sets a plan option that exists on PlanOptions; the L3 ones wait for theirs, behind the flag", () => {
    // a type error here if any of these left PlanOptions
    const sample: Required<Pick<PlanOptions, (typeof L2_OPTIONS)[number]>> = { bucket: "short", ending: "resolved", template: "get-out-classic", postingTime: "18:00" };
    for (const d of Object.values(DIALS)) {
      if (d.level === "L2") expect(Object.keys(sample), d.id).toContain(d.option);
      else expect([...L3_OPTIONS], d.id).toContain(d.option);
    }
    expect(L3_DIALS_ON).toBe(false);
    expect(activeDials()).toEqual(["length", "ending", "format", "newcomer", "postTime"]);
    expect(activeDials(true)).toEqual([...DIAL_IDS]);
  });

  it("the arms are closed enums with today's default among them", () => {
    for (const id of DIAL_IDS) {
      const d = DIALS[id];
      expect(d.id).toBe(id);
      expect(new Set(d.arms).size, id).toBe(d.arms.length);
      expect(d.arms, id).toContain(d.defaultArm);
      for (const a of d.arms) expect(a, id).toMatch(/^[a-zA-Z0-9-]+$/);
      expect(isDialArm(id, d.defaultArm)).toBe(true);
      expect(isDialArm(id, "bold")).toBe(false);
    }
    // today's ways are the defaults: the platform's standard bucket, resolved, the mix of formats, the spread of times
    expect([DIALS.length.defaultArm, DIALS.ending.defaultArm, DIALS.format.defaultArm, DIALS.postTime.defaultArm]).toEqual(["standard", "resolved", "mix", "spread"]);
    expect(DIALS.cover.arms).toEqual([...COVER_ARMS]);
  });

  it("no look dial: the crew's busy gate keeps every clip Simple", () => {
    expect(DIAL_IDS as readonly string[]).not.toContain("look");
  });

  it("post time is the normal lane's only (followers' hours), and a dial that needs no new plan says so", () => {
    expect(DIALS.postTime.lanes).toEqual(["normal"]);
    expect(DIALS.postTime.replan).toBe(false);
    for (const id of ["length", "ending", "format", "newcomer"] as const) expect(DIALS[id].replan).toBe(true);
  });

  it("every finding key is its own, under Learner.findings (the sentences come with the Learning card)", () => {
    const keys = Object.values(DIALS).map((d) => d.finding);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of Object.values(DIALS)) expect(d.finding).toBe(`Learner.findings.${d.id}`);
  });

  it("the test order names only dials, each in a lane it applies to", () => {
    for (const [lane, order] of Object.entries(TEST_ORDER)) {
      expect(new Set(order).size, lane).toBe(order.length);
      for (const d of order) expect(DIALS[d].lanes, `${lane} ${d}`).toContain(lane === "trialReel" ? "trialReel" : "normal");
    }
    expect(TEST_ORDER.trialReel.slice(0, 4)).toEqual(["newcomer", "length", "format", "ending"]);
    expect(TEST_ORDER.normal[0]).toBe("postTime");
    expect(TEST_ORDER.normalWithoutTrials.slice(0, 5)).toEqual(["length", "ending", "newcomer", "format", "postTime"]);
  });

  it("the newcomers are real templates (the Journey and Spiral Glass first)", () => {
    const ids = new Set(allTemplates().map((t) => t.id));
    expect([...NEWCOMER_TEMPLATES]).toEqual(["get-out-journey", "smash-spiral-glass"]);
    for (const id of NEWCOMER_TEMPLATES) {
      expect(ids.has(id), id).toBe(true);
      expect(id).toMatch(TEMPLATE_ID);
    }
  });

  it("challengers come in order, never the best itself; a question's key ignores which arm was the best", () => {
    expect(challengersOf("length", "standard")).toEqual(["short", "long"]);
    expect(challengersOf("length", "short")).toEqual(["standard", "long"]);
    expect(challengersOf("ending", "resolved")).toEqual(["cliffhanger"]);
    expect(challengersOf("format", "mix", ["smash", "getOut"])).toEqual(["smash", "getOut"]);
    expect(challengersOf("format", "smash", ["smash", "getOut"])).toEqual(["getOut", "mix"]);
    expect(challengersOf("postTime", "spread")).toEqual(["noon", "evening", "night"]);
    expect(challengersOf("postTime", "noon")).toEqual(["evening", "night", "spread"]);
    expect(challengersOf("newcomer", "rotation")).toEqual([]);
    expect(questionKey("length", "standard", "short")).toBe(questionKey("length", "short", "standard"));
    expect(questionKey("newcomer", "rotation", "newcomer", "get-out-journey")).toBe("newcomer:newcomer~rotation:get-out-journey");
  });
});

describe("the learner's settings", () => {
  it("learning off, measuring on, one Trial Reel pair a day with the switch on, automatic sharing not yet confirmed off", () => {
    expect(DEFAULT_LEARNER).toMatchObject({ learn: false, measure: true, measureNoticeSeen: false, paused: false, trialReels: true, pairsPerDay: PAIRS_PER_DAY_DEFAULT, autoShareOff: false, makeClips: false });
    expect(PAIRS_PER_DAY_DEFAULT).toBe(1);
  });

  it("a patch keeps only valid values; stored settings fall back field by field", () => {
    expect(sanitizeLearner({ learn: "yes", pairsPerDay: 7, fixed: { length: "short", ending: "maybe", look: "bold" }, skipped: ["length:short~standard", "nonsense", 3], extra: 1 })).toEqual({
      pairsPerDay: PAIRS_PER_DAY_MAX,
      fixed: { length: "short" },
      skipped: ["length:short~standard"],
    });
    expect(sanitizeLearner(null)).toEqual({});
    expect(sanitizeLearner({ pairsPerDay: -2 }).pairsPerDay).toBe(0);
    const stored = resolveLearner({ learn: true, measure: "off" });
    expect(stored).toEqual({ ...DEFAULT_LEARNER, learn: true });
    expect(resolveLearner(undefined)).toEqual(DEFAULT_LEARNER);
    expect(resolveLearner(undefined).fixed).not.toBe(DEFAULT_LEARNER.fixed); // never the shared default object
  });
});

// --- end learner ---
