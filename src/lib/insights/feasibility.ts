import { drain, planTemplateSteps, type PlanOptions } from "@/lib/bot/planner";
import { BOT_DEFAULT_FAMILIES, LENGTH_BUCKETS, type BotFamily, type BotPlatform, type EndingStyle, type LengthBucket } from "@/lib/bot/playbook";
import { templateRecipe, type TemplateInfo } from "@/lib/bot/templates";
import { DEFAULT_BOT_WORLD, type BotWorld } from "@/lib/bot/finderRequest";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import { crewClipOfPlan } from "@/lib/crew/clip";
import { clarityOf } from "@/lib/crew/clarity";
import { pickScore } from "@/lib/crew/pick";
import { runSync } from "@/lib/insights/score";
import { FEASIBILITY_PASS, FEASIBILITY_PLANS } from "./learnerRules";
import { FORMAT_IDS, NEWCOMER_TEMPLATES } from "./dials";
import { hashText } from "./stats";

/*
 * --- learner --- Feasibility: before a test or a Trial Reel block opens, every arm (every pattern's arm A and arm B of a block)
 * is planned FEASIBILITY_PLANS times with the seed search and the crew's rule gates on, and no model. At least FEASIBILITY_PASS
 * of them must pass every rule gate, or the dial is swapped for the next one in the order (lib/insights/learner.ts). It catches
 * what the template bindings cannot say: an arm whose seed search finds no payoff in its bucket on half its plans.
 *
 * An arm is an ArmSetting: the format arm ("mix" or one format), the newcomer arm (its template, or its format's rotation as it
 * stands), the bucket and the ending. `candidatesFor` lists the templates that can play it, in rotation order, and an arm's
 * plans take them in turn. A setting no template can play is impossible on paper (`armPossible`): the Journey is resolved
 * only, so it never shares a block with the ending dial.
 *
 * The planner is a port (`ArmPlanner`), so the logic is tested with stand-ins and the app plugs in `ruleGatePlanner`: the
 * planner's own template plan (lib/bot/planner.ts planTemplateSteps, its seed search included), the run followed past its
 * clip (lib/insights/score.ts runSync), the clip as the crew reads it (lib/crew/clip.ts crewClipOfPlan) and its clarity gates
 * (lib/crew/clarity.ts clarityOf), with the crew's pick score kept for the format challengers' order. Deterministic: the
 * plans' seeds come from the arm's key alone. The app runs it in slices while idle and hands the results to learnPass.
 */

// --- learner ---

/** A ready template as the learner reads it (lib/bot/templates.ts TemplateInfo through `learnerCatalog`). */
export interface LearnerTemplate {
  id: string;
  /** Its format id (dials.ts FORMAT_IDS). */
  format: string;
  mode: string;
  family: BotFamily | null;
  /** The buckets and endings its recipe takes. */
  buckets: readonly LengthBucket[];
  endings: readonly EndingStyle[];
  /** A newcomer: tried before it joins its format's rotation (dials.ts NEWCOMER_TEMPLATES, or the caller's mark). */
  newcomer?: boolean;
  /** The crew's pick score of its plans (null: not planned yet). Orders the format challengers. */
  pickScore?: number | null;
}

/** What a clip asks of its template. */
export interface ArmSetting {
  format: string;
  newcomer: { subject: string; arm: "rotation" | "newcomer" } | null;
  bucket: LengthBucket;
  ending: EndingStyle;
}

/** One plan of an arm: the template, its options and the plan seed. */
export interface ArmPlan {
  template: string;
  bucket: LengthBucket;
  ending: EndingStyle;
  planSeed: number;
}

/** An arm's feasibility: of its plans, how many passed every rule gate, and their mean pick score. */
export interface FeasibilityResult {
  key: string;
  plans: number;
  passed: number;
  pick: number | null;
}

/** The planner the check runs: one plan of an arm, whether it passed every rule gate, and its pick score. */
export type ArmPlanner = (plan: ArmPlan) => { pass: boolean; pick: number | null };

/** The family the learner plans in: the default ones (the battle family's third-party names wait for the owner's switch). */
export const LEARNER_FAMILIES: readonly BotFamily[] = BOT_DEFAULT_FAMILIES;

/** The key of an arm setting (the feasibility results are keyed by it). */
export function armKey(s: ArmSetting): string {
  return `${s.format}|${s.newcomer ? `${s.newcomer.subject}:${s.newcomer.arm}` : "-"}|${s.bucket}|${s.ending}`;
}

/** Whether a template is a newcomer (listed, or marked by the caller). */
export const isNewcomer = (t: Pick<LearnerTemplate, "id" | "newcomer">): boolean => !!t.newcomer || (NEWCOMER_TEMPLATES as readonly string[]).includes(t.id);

/** A template that can play a bucket and an ending, in a family the learner plans. */
const takes = (t: LearnerTemplate, bucket: LengthBucket, ending: EndingStyle) => t.buckets.includes(bucket) && t.endings.includes(ending) && (t.family === null || LEARNER_FAMILIES.includes(t.family));

/** Formats first: the first template of each format in FORMAT_IDS order, then the second of each, and so on. */
function interleaved(list: readonly LearnerTemplate[]): LearnerTemplate[] {
  const byFormat = FORMAT_IDS.map((f) => list.filter((t) => t.format === f));
  const out: LearnerTemplate[] = [];
  for (let round = 0; out.length < list.length; round++) for (const group of byFormat) if (round < group.length) out.push(group[round]);
  return out;
}

/**
 * The templates that can play an arm setting, in rotation order. In a format's rotation: every template of the format but
 * the newcomers that have not joined it (`joined`). A newcomer arm: the newcomer alone; its rotation arm: the rest of its
 * format's rotation. "mix": every format's rotation, formats first.
 */
export function candidatesFor(s: ArmSetting, catalog: readonly LearnerTemplate[], joined: ReadonlySet<string>): LearnerTemplate[] {
  const ok = catalog.filter((t) => takes(t, s.bucket, s.ending));
  const inRotation = (t: LearnerTemplate) => !isNewcomer(t) || joined.has(t.id);
  if (s.newcomer) {
    const subject = catalog.find((t) => t.id === s.newcomer!.subject);
    if (!subject) return [];
    if (s.newcomer.arm === "newcomer") return ok.filter((t) => t.id === subject.id);
    return ok.filter((t) => t.format === subject.format && t.id !== subject.id && inRotation(t));
  }
  const pool = ok.filter((t) => inRotation(t) && (s.format === "mix" || t.format === s.format));
  return s.format === "mix" ? interleaved(pool) : pool;
}

/** Whether some template can play the arm setting (on paper, before any plan). */
export function armPossible(s: ArmSetting, catalog: readonly LearnerTemplate[], joined: ReadonlySet<string>): boolean {
  return candidatesFor(s, catalog, joined).length > 0;
}

/** The FEASIBILITY_PLANS plans of an arm: its candidates in turn, each with a seed from the arm's key. */
export function armPlans(s: ArmSetting, catalog: readonly LearnerTemplate[], joined: ReadonlySet<string>): ArmPlan[] {
  const list = candidatesFor(s, catalog, joined);
  if (!list.length) return [];
  const key = armKey(s);
  return Array.from({ length: FEASIBILITY_PLANS }, (_, i) => ({ template: list[i % list.length].id, bucket: s.bucket, ending: s.ending, planSeed: 1 + (hashText(`feasible|${key}|${i}`) % 0x7ffffffe) }));
}

/** Whether a result lets its arm open: all its plans made and at least FEASIBILITY_PASS of them passing every rule gate. */
export function isFeasible(r: FeasibilityResult | undefined): boolean {
  return !!r && r.plans >= FEASIBILITY_PLANS && r.passed >= FEASIBILITY_PASS;
}

/** Plans an arm with `planner` and counts the passes (an arm no template can play: no plans, never feasible). */
export function checkArm(s: ArmSetting, catalog: readonly LearnerTemplate[], joined: ReadonlySet<string>, planner: ArmPlanner): FeasibilityResult {
  const plans = armPlans(s, catalog, joined);
  const runs = plans.map((p) => planner(p));
  const picks = runs.map((r) => r.pick).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return { key: armKey(s), plans: plans.length, passed: runs.filter((r) => r.pass).length, pick: picks.length ? picks.reduce((a, b) => a + b, 0) / picks.length : null };
}

/** The results of the arms the learner asked for (PassPlan.feasibilityNeeded), skipping the ones already known. */
export function checkArms(settings: readonly ArmSetting[], catalog: readonly LearnerTemplate[], joined: ReadonlySet<string>, planner: ArmPlanner, known: readonly FeasibilityResult[] = []): FeasibilityResult[] {
  const have = new Set(known.map((r) => r.key));
  const out: FeasibilityResult[] = [];
  for (const s of settings) {
    const key = armKey(s);
    if (have.has(key)) continue;
    have.add(key);
    out.push(checkArm(s, catalog, joined, planner));
  }
  return out;
}

/* ------------------------------------------------------------------ the app's port: the real planner and the real gates */

/** The learner's catalog of the ready templates (lib/bot/templates.ts): each one's format, mode, family, buckets and endings. */
export function learnerCatalog(templates: readonly TemplateInfo[]): LearnerTemplate[] {
  const out: LearnerTemplate[] = [];
  for (const t of templates) {
    const recipe = t.ready ? templateRecipe(t) : null;
    if (!recipe) continue;
    out.push({ id: t.id, format: t.format.id, mode: t.mode, family: t.family, buckets: recipe.buckets ?? LENGTH_BUCKETS, endings: recipe.endings ?? ["resolved", "cliffhanger"] });
  }
  return out;
}

export interface RuleGatePlannerOptions {
  platform?: BotPlatform;
  locale?: BotLocale;
  world?: BotWorld;
  maxSeeds?: number;
}

/**
 * The planner the app plugs in: the template planned with its seed search (no model), its run followed past the clip, and the
 * crew's rule gates on the clip as planned (clarityOf at stage pre). Its pick score has no reviewer's confidence (the rules'
 * own, as the picker counts a keep no model weighed).
 */
export function ruleGatePlanner(copy: BotCopy, options: RuleGatePlannerOptions = {}): ArmPlanner {
  const platform = options.platform ?? "reels";
  return (plan) => {
    const planOptions: PlanOptions = { copy, locale: options.locale ?? "en", bucket: plan.bucket, ending: plan.ending, episode: 1, index: 1, date: null, world: options.world ?? DEFAULT_BOT_WORLD, ...(options.maxSeeds !== undefined ? { maxSeeds: options.maxSeeds } : {}) };
    try {
      const clip = drain(planTemplateSteps(plan.template, plan.planSeed, platform, planOptions));
      const run = runSync(clip.settings, clip.seed, clip.world, clip.recipe, clip.timing.clipSec, clip.payoff.atSec);
      const clarity = clarityOf(crewClipOfPlan(clip, { run }));
      return { pass: clarity.pass && clip.bucket === plan.bucket && clip.ending === plan.ending, pick: pickScore(clarity.playbook.score, clarity.simple.score, null) };
    } catch {
      return { pass: false, pick: null };
    }
  };
}

// --- end learner ---
