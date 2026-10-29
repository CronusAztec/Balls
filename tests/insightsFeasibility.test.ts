import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import {
  LEARNER_FAMILIES,
  armKey,
  armPlans,
  armPossible,
  candidatesFor,
  checkArm,
  checkArms,
  isFeasible,
  isNewcomer,
  learnerCatalog,
  ruleGatePlanner,
  type ArmPlanner,
  type ArmSetting,
} from "@/lib/insights/feasibility";
import { learnPass } from "@/lib/insights/learner";
import { FEASIBILITY_PASS, FEASIBILITY_PLANS } from "@/lib/insights/learnerRules";
import { readyTemplates, templateRecipe } from "@/lib/bot/templates";
import { CATALOG, IG, ON, TT, passAll, runWorld } from "./learnerWorld";

/*
 * --- learner --- Feasibility (lib/insights/feasibility.ts): every arm is planned 3 times with the seed search and the crew's
 * rule gates, and no model, before its test opens; at least 2 of 3 must pass, or the dial is swapped for the next. On paper
 * first: a setting no template can play (the Journey is resolved only) never opens.
 */

// --- learner ---

const S = (over: Partial<ArmSetting> = {}): ArmSetting => ({ format: "mix", newcomer: null, bucket: "standard", ending: "resolved", ...over });
const none = new Set<string>();

describe("the templates an arm can play", () => {
  it("the mix: every format's rotation, formats first, without the newcomers that have not joined and without the battle family", () => {
    const ids = candidatesFor(S(), CATALOG, none).map((t) => t.id);
    expect(ids).toEqual(["get-out-classic", "smash-power-layers", "fill-grow", "count-multiply", "line-up-pendulum", "get-out-glass"]);
    expect(LEARNER_FAMILIES).not.toContain("battle");
    expect(candidatesFor(S(), CATALOG, new Set(["get-out-journey"])).map((t) => t.id)).toContain("get-out-journey");
  });

  it("one format, a bucket and an ending: only the templates that take them", () => {
    expect(candidatesFor(S({ format: "getOut", bucket: "short", ending: "cliffhanger" }), CATALOG, none).map((t) => t.id)).toEqual(["get-out-classic", "get-out-portal", "get-out-glass"]);
    expect(candidatesFor(S({ format: "fill", bucket: "long" }), CATALOG, none)).toEqual([]);
  });

  it("a newcomer arm is the newcomer alone; its rotation arm is the rest of its format", () => {
    const journey = { subject: "get-out-journey", arm: "newcomer" as const };
    expect(candidatesFor(S({ format: "getOut", newcomer: journey }), CATALOG, none).map((t) => t.id)).toEqual(["get-out-journey"]);
    expect(candidatesFor(S({ format: "getOut", newcomer: { ...journey, arm: "rotation" } }), CATALOG, none).map((t) => t.id)).toEqual(["get-out-classic", "get-out-glass"]);
    expect(isNewcomer({ id: "get-out-journey" })).toBe(true);
    expect(isNewcomer({ id: "get-out-classic" })).toBe(false);
    expect(isNewcomer({ id: "get-out-classic", newcomer: true })).toBe(true);
  });

  it("a Simple-only, resolved-only newcomer cannot take a cliffhanger, or a long clip, on paper", () => {
    const journey = { subject: "get-out-journey", arm: "newcomer" as const };
    expect(armPossible(S({ format: "getOut", newcomer: journey, ending: "cliffhanger" }), CATALOG, none)).toBe(false);
    expect(armPossible(S({ format: "getOut", newcomer: journey, bucket: "long" }), CATALOG, none)).toBe(false);
    expect(armPossible(S({ format: "getOut", newcomer: journey, bucket: "short" }), CATALOG, none)).toBe(true);
  });
});

describe("the check: 3 plans, 2 must pass every rule gate", () => {
  it("plans an arm 3 times, its candidates in turn, with seeds from the arm alone", () => {
    const plans = armPlans(S({ format: "getOut", bucket: "short", ending: "cliffhanger" }), CATALOG, none);
    expect(plans).toHaveLength(FEASIBILITY_PLANS);
    expect(plans.map((p) => p.template)).toEqual(["get-out-classic", "get-out-portal", "get-out-glass"]);
    expect(new Set(plans.map((p) => p.planSeed)).size).toBe(3);
    expect(armPlans(S({ format: "getOut", bucket: "short", ending: "cliffhanger" }), CATALOG, none)).toEqual(plans);
    expect(armPlans(S({ format: "fill", bucket: "long" }), CATALOG, none)).toEqual([]);
    expect(armKey(S({ format: "getOut", newcomer: { subject: "get-out-journey", arm: "rotation" } }))).toBe("getOut|get-out-journey:rotation|standard|resolved");
  });

  it("2 of 3 passing opens the arm, 1 of 3 does not, and an arm no template plays never does", () => {
    const failing = (bad: string): ArmPlanner => (p) => ({ pass: p.template !== bad, pick: 60 });
    const arm = S({ format: "getOut", bucket: "short", ending: "cliffhanger" });
    const two = checkArm(arm, CATALOG, none, failing("get-out-portal"));
    expect(two).toEqual({ key: armKey(arm), plans: 3, passed: 2, pick: 60 });
    expect(isFeasible(two)).toBe(true);
    const one = checkArm(arm, CATALOG, none, (p) => ({ pass: p.template === "get-out-glass", pick: null }));
    expect(one.passed).toBe(1);
    expect(isFeasible(one)).toBe(false);
    expect(FEASIBILITY_PASS).toBe(2);
    const impossible = checkArm(S({ format: "fill", bucket: "long" }), CATALOG, none, passAll);
    expect(impossible.plans).toBe(0);
    expect(isFeasible(impossible)).toBe(false);
    expect(isFeasible(undefined)).toBe(false);
    // known arms are not planned again
    expect(checkArms([arm, arm, S()], CATALOG, none, passAll, [two]).map((r) => r.key)).toEqual([armKey(S())]);
  });
});

describe("blocks and tests open only on feasible arms", () => {
  it("a Simple-only newcomer never shares a block with a dial it cannot take", () => {
    const r = runWorld({ seed: 5, channels: [IG, TT], settings: ON, effect: () => 0, days: 1 });
    const block = r.plans[0].block!;
    expect(block.questions.map((q) => q.dial)).toEqual(["newcomer", "length"]);
    expect(block.questions.some((q) => q.dial === "ending")).toBe(false);
    // and every setting of every pattern it opened with is one a template can play
    expect(r.plans[0].slots.filter((s) => s.lane === "trialReel").every((s) => CATALOG.find((t) => t.id === s.options.template)!.endings.includes(s.options.ending))).toBe(true);
  });

  it("a newcomer whose plans fail the rule gates is swapped for the next one (Spiral Glass after the Journey)", () => {
    const r = runWorld({ seed: 5, channels: [IG, TT], settings: ON, effect: () => 0, days: 1, planner: (p) => ({ pass: p.template !== "get-out-journey", pick: 70 }) });
    expect(r.plans[0].block!.questions.map((q) => [q.dial, q.subject])).toEqual([
      ["newcomer", "smash-spiral-glass"],
      ["length", null],
    ]);
  });

  it("a length whose short plans fail is swapped for the next dial", () => {
    const r = runWorld({ seed: 5, channels: [IG, TT], settings: ON, effect: () => 0, days: 1, planner: (p) => ({ pass: p.bucket !== "short", pick: 70 }) });
    const qs = r.plans[0].block!.questions;
    expect(qs.some((q) => q.dial === "length" && q.challenger === "short")).toBe(false);
    expect(qs[0]).toMatchObject({ dial: "newcomer", subject: "get-out-journey" });
  });

  it("nothing opens while arms wait to be planned; the pass names them", () => {
    const r = runWorld({ seed: 5, channels: [IG, TT], settings: ON, effect: () => 0, days: 1 });
    const plan = learnPass({ ...r.input, feasibility: [] })!;
    expect(plan.block).toBeNull();
    expect(plan.feasibilityNeeded.length).toBeGreaterThan(0);
    expect(plan.slots.some((s) => s.lane === "trialReel")).toBe(false);
  });
});

describe("the app's port: the real planner and the real gates", () => {
  const copy = (en as unknown as { ViralBot: Record<string, unknown> }).ViralBot;

  it("the catalog of the ready templates, with their recipes' buckets and endings", () => {
    const ready = readyTemplates("all");
    const catalog = learnerCatalog(ready);
    expect(catalog.map((t) => t.id)).toEqual(ready.map((t) => t.id));
    for (const t of catalog) {
      const recipe = templateRecipe(ready.find((r) => r.id === t.id)!)!;
      expect(t.buckets).toEqual(recipe.buckets ?? ["short", "standard", "long"]);
      expect(t.endings).toEqual(recipe.endings);
    }
    // the battle family is ready but never planned by the learner
    expect(catalog.some((t) => t.family === "battle")).toBe(true);
    expect(candidatesFor(S({ format: "whoWins" }), catalog, none)).toEqual([]);
  });

  it("plans an arm with the seed search and the clarity gates, deterministically (Get Out, short, cliffhanger: 1 of 3 passes here)", () => {
    const catalog = learnerCatalog(readyTemplates("all"));
    const planner = ruleGatePlanner(copy, { maxSeeds: 6 });
    const arm = S({ format: "getOut", bucket: "short", ending: "cliffhanger" });
    const result = checkArm(arm, catalog, none, planner);
    expect(result).toEqual({ key: armKey(arm), plans: 3, passed: 1, pick: result.pick });
    expect(isFeasible(result)).toBe(false); // so a short Get Out cliffhanger arm would be swapped
    expect(armPlans(arm, catalog, none).map((p) => p.template)).toEqual(["get-out-classic", "get-out-classic-gerald", "get-out-accumulation"]);
    expect(planner(armPlans(arm, catalog, none)[0])).toEqual(planner(armPlans(arm, catalog, none)[0]));
  });
});

// --- end learner ---
