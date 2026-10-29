import path from "path";
import vm from "vm";
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
  type ArmPlanner,
  type ArmSetting,
} from "@/lib/insights/feasibility";
import { learnerCatalog, ruleGatePlanner } from "@/lib/insights/feasibilityPlanner";
import { BOT_DEFAULT_FAMILIES } from "@/lib/bot/playbook";
import { learnPass } from "@/lib/insights/learner";
import { FEASIBILITY_PASS, FEASIBILITY_PLANS } from "@/lib/insights/learnerRules";
import { readyTemplates, templateRecipe, type TemplateInfo } from "@/lib/bot/templates";
import { CATALOG, IG, ON, TT, passAll, runWorld } from "./learnerWorld";

/*
 * --- learner --- Feasibility (lib/insights/feasibility.ts): every arm is planned 3 times with the seed search and the crew's
 * rule gates, and no model, before its test opens; at least 2 of 3 must pass, or the dial is swapped for the next. On paper
 * first: a setting no template can play (the Journey is resolved only) never opens.
 */

// --- learner ---

const S = (over: Partial<ArmSetting> = {}): ArmSetting => ({ format: "mix", newcomer: null, bucket: "standard", ending: "resolved", ...over });
const none = new Set<string>();

/**
 * Calls `body` on a module of src/lib, bundled alone and run in a fresh context that is stopped after 10 s, and returns what
 * it returns (through JSON): a loop that never ends fails the test instead of hanging the whole run.
 */
async function bounded<T>(module: string, body: string): Promise<T> {
  const esbuild = await import("esbuild");
  const root = path.join(__dirname, "..");
  const contents = `import * as m from "${module}"; globalThis.__out = JSON.stringify((${body})(m));`;
  const built = await esbuild.build({ stdin: { contents, resolveDir: root, loader: "ts" }, bundle: true, write: false, format: "iife", platform: "neutral", alias: { "@": path.join(root, "src") }, logLevel: "error" });
  const sandbox: { __out?: string } = {};
  vm.runInNewContext(built.outputFiles[0].text, sandbox, { timeout: 10_000 });
  return JSON.parse(sandbox.__out ?? "null") as T;
}

describe("the templates an arm can play", () => {
  it("the mix: every format's rotation, formats first, without the newcomers that have not joined and without the battle family", () => {
    const ids = candidatesFor(S(), CATALOG, none).map((t) => t.id);
    expect(ids).toEqual(["get-out-classic", "smash-power-layers", "fill-grow", "count-multiply", "line-up-pendulum", "get-out-glass"]);
    expect(LEARNER_FAMILIES).not.toContain("battle");
    expect([...LEARNER_FAMILIES]).toEqual([...BOT_DEFAULT_FAMILIES]); // a copy, so feasibility.ts loads no module of the page
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

  // the mix's interleave looped while it had fewer templates than the list, and pushed only FORMAT_IDS' formats: one template
  // of any other format (a stand-in catalog, or a format templates.ts names before dials.ts follows) and it never returned
  it("lists a template of a format the dials do not know once, after the known formats of its round, and returns", async () => {
    const stray = { id: "a-x", format: "newFormat", mode: "classic", family: "escape" as const, buckets: ["short", "standard", "long"] as const, endings: ["resolved", "cliffhanger"] as const };
    const catalog = [stray, ...CATALOG, { ...stray, id: "a-y" }, { ...stray, id: "b-z", format: "otherFormat" }];
    const ids = await bounded<string[]>("@/lib/insights/feasibility", `(f) => f.candidatesFor(${JSON.stringify(S())}, ${JSON.stringify(catalog)}, new Set()).map((t) => t.id)`);
    // round 1: the first of each known format, then the first of each other format; round 2: the second of each
    expect(ids).toEqual(["get-out-classic", "smash-power-layers", "fill-grow", "count-multiply", "line-up-pendulum", "a-x", "b-z", "get-out-glass", "a-y"]);
    expect(candidatesFor(S(), catalog, none).map((t) => t.id)).toEqual(ids);
    expect(await bounded<boolean>("@/lib/insights/feasibility", `(f) => f.armPossible(${JSON.stringify(S())}, ${JSON.stringify([stray])}, new Set())`)).toBe(true);
    // the learner's pass, which reaches it through the mix, returns as well
    const r = runWorld({ seed: 5, channels: [IG, TT], settings: ON, effect: () => 0, planner: passAll, days: 1 });
    const input = { ...r.input, catalog: [...r.input.catalog, stray] };
    const plan = await bounded<{ slots: unknown[] } | null>("@/lib/insights/learner", `(l) => l.learnPass(${JSON.stringify(input)})`);
    expect(plan?.slots.length).toBeGreaterThan(0);
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
    // a ready template of a format the dials do not know is left out: no dial's arm can name it
    const stray: TemplateInfo = { ...ready[0], id: "stray-format", format: { ...ready[0].format, id: "newFormat" as TemplateInfo["format"]["id"] } };
    expect(templateRecipe(stray)).not.toBeNull();
    expect(learnerCatalog([...ready, stray]).map((t) => t.id)).toEqual(ready.map((t) => t.id));
  });

  // the port's contract, not the catalog's tuning: which plans pass moves with every template or clarity retune (AI studio
  // step 2 passes 2 of these 3 where step 1 passed 1), and the stand-in planner above pins the numbers
  it("plans an arm with the seed search and the clarity gates, deterministically, over the arm's own templates in turn", () => {
    const catalog = learnerCatalog(readyTemplates("all"));
    const planner = ruleGatePlanner(copy, { maxSeeds: 6 });
    const arm = S({ format: "getOut", bucket: "short", ending: "cliffhanger" });
    const result = checkArm(arm, catalog, none, planner);
    expect(result.key).toBe(armKey(arm));
    expect(result.plans).toBe(FEASIBILITY_PLANS);
    expect(Number.isInteger(result.passed) && result.passed >= 0 && result.passed <= result.plans).toBe(true);
    expect(isFeasible(result)).toBe(result.passed >= FEASIBILITY_PASS); // an arm under 2 of 3 is swapped
    expect(result.pick === null || (Number.isFinite(result.pick) && result.pick >= 0 && result.pick <= 100)).toBe(true);
    expect(checkArm(arm, catalog, none, planner)).toEqual(result);
    // its plans take the arm's own templates in rotation order, each with a seed from the arm's key
    const cands = candidatesFor(arm, catalog, none).map((t) => t.id);
    expect(cands.length).toBeGreaterThan(0);
    const plans = armPlans(arm, catalog, none);
    expect(plans.map((p) => p.template)).toEqual(Array.from({ length: FEASIBILITY_PLANS }, (_, i) => cands[i % cands.length]));
    expect(plans.every((p) => p.bucket === "short" && p.ending === "cliffhanger")).toBe(true);
    expect(planner(plans[0])).toEqual(planner(plans[0]));
    // a plan its template cannot play never passes: a resolved-only template asked for a cliffhanger, or no template at all
    const resolvedOnly = catalog.find((t) => !t.endings.includes("cliffhanger") && t.buckets.includes("short"));
    expect(resolvedOnly).toBeDefined();
    expect(planner({ template: resolvedOnly!.id, bucket: "short", ending: "cliffhanger", planSeed: 7 }).pass).toBe(false);
    expect(planner({ template: "no-such-template", bucket: "short", ending: "resolved", planSeed: 7 })).toEqual({ pass: false, pick: null });
  });
});

// --- end learner ---
