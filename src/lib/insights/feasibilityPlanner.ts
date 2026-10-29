import { drain, planTemplateSteps, type PlanOptions } from "@/lib/bot/planner";
import { LENGTH_BUCKETS, type BotPlatform } from "@/lib/bot/playbook";
import { templateRecipe, type TemplateInfo } from "@/lib/bot/templates";
import { DEFAULT_BOT_WORLD, type BotWorld } from "@/lib/bot/finderRequest";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import { crewClipOfPlan } from "@/lib/crew/clip";
import { clarityOf } from "@/lib/crew/clarity";
import { pickScore } from "@/lib/crew/pick";
import { runSync } from "@/lib/insights/score";
import type { ArmPlanner, LearnerTemplate } from "./feasibility";
import { FORMAT_IDS } from "./dials";

/*
 * --- learner --- The page's side of feasibility (lib/insights/feasibility.ts): the learner's catalog of the ready templates
 * (`learnerCatalog`, from lib/bot/templates.ts) and the planner the page plugs into the check (`ruleGatePlanner`): the
 * planner's own template plan (lib/bot/planner.ts planTemplateSteps, its seed search included), the run followed past its
 * clip (lib/insights/score.ts runSync), the clip as the crew reads it (lib/crew/clip.ts crewClipOfPlan) and its clarity gates
 * (lib/crew/clarity.ts clarityOf), with the crew's pick score kept for the format challengers' order.
 *
 * Page only: it loads the planner, the engine and every mode, so the app's main process never bundles it. feasibility.ts and
 * lib/insights/learner.ts stay free of it.
 */

// --- learner ---

/**
 * The learner's catalog of the ready templates (lib/bot/templates.ts): each one's format, mode, family, buckets and endings.
 * A template of a format the dials do not know (dials.ts FORMAT_IDS) is left out: no dial's arm can name it, so the learner
 * neither tests it nor plans it.
 */
export function learnerCatalog(templates: readonly TemplateInfo[]): LearnerTemplate[] {
  const out: LearnerTemplate[] = [];
  for (const t of templates) {
    const recipe = t.ready ? templateRecipe(t) : null;
    if (!recipe || !(FORMAT_IDS as readonly string[]).includes(t.format.id)) continue;
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
