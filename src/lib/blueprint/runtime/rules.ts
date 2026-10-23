/*
 * --- blueprint --- The rules: the one place a Blueprint's logic runs (the run's onPostUpdate). Event by event, in the order
 * the step recorded them, each event runs through the rules of its trigger in list order; a rule that matches passes its
 * filters (every, maxFires, cooldownSec, chance – a seeded draw only when the chance is below 1) and the step's firing
 * budget (BLUEPRINT_RULE_FIRINGS_PER_STEP; past it a firing is dropped and counted), then fires its actions in order.
 * `countReached` rules check their counts after the events: each fires when its count crosses its bound, and again only
 * after the count went back.
 *
 * --- review fix (blueprint) --- An event is judged once, as it is taken from the queue: one about a ball that is gone by
 * then (removed, merged or popped by an earlier event's rule this step) is skipped – an escaped ball still counts, the
 * event happened while it was in play. Then EVERY rule of its trigger runs, in list order, matched against the balls as
 * they were when the event was taken: a rule that merges or removes the ball never hides the rules after it (a counter
 * after a merge counts every merge); their actions on a ball that is gone are refused, as always. A countReached rule's
 * first look at its count is its baseline: a bound met from the start fires only after the count went back and crossed it.
 */
import { BLUEPRINT_STEP_BUDGETS as BUDGET } from "../limits";
import { act } from "./actions";
import type { CompiledRule } from "./compile";
import type { BlueprintRun } from "./run";
import type { WorldBall } from "./world";

/** What a ballHit rule matches on: a ball's body, tier and team when its event was taken. */
export interface BallFacts {
  body: number;
  tier: number;
  team: number;
}

const factsA: BallFacts = { body: 0, tier: 0, team: 0 };
const factsB: BallFacts = { body: 0, tier: 0, team: 0 };

function noteFacts(out: BallFacts, b: WorldBall): BallFacts {
  out.body = b.body;
  out.tier = b.tier;
  out.team = b.team;
  return out;
}

/** Whether the event's ball is still in play (an escaped one counts: it was when the event happened). */
const inPlay = (b: WorldBall) => b.alive || b.escaped;

/** Runs this step's queue through the rules. */
export function dispatch(run: BlueprintRun) {
  const rules = run.compiled.rules;
  const queue = run.queue;
  for (let q = 0; q < queue.length; q++) {
    const ev = queue.slots[q];
    const ids = ev.trigger === "timer" ? null : run.compiled.byTrigger[ev.trigger];
    const n = ids ? ids.length : 1;
    if (ev.trigger === "ballHit") {
      const a = ev.self!;
      const b = ev.other!;
      if (!a.alive || !b.alive) continue; // (a merge or a removal earlier this step)
      const fa = noteFacts(factsA, a);
      const fb = noteFacts(factsB, b);
      for (let k = 0; k < n; k++) {
        const rule = rules[ids![k]];
        if (matches(rule, fa, fb)) consider(run, rule, a, b, ev.tile);
        else if (matches(rule, fb, fa)) consider(run, rule, b, a, ev.tile);
      }
      continue;
    }
    const self = ev.self;
    if (self && !inPlay(self)) continue;
    const selfBody = self ? self.body : -1;
    for (let k = 0; k < n; k++) {
      const rule = rules[ids ? ids[k] : ev.rule];
      // (`of` filters the event's ball; a trigger without one acts on every ball of `of` – targets())
      if (rule.of >= 0 && self && selfBody !== rule.of) continue;
      consider(run, rule, self, null, ev.tile);
    }
  }
}

/** Whether a ballHit rule matches with `self` as self and `other` as the other ball (their facts when the event was taken). */
export function matches(rule: CompiledRule, self: BallFacts, other: BallFacts): boolean {
  if (rule.of >= 0 && self.body !== rule.of) return false;
  if (rule.withBody >= 0) return other.body === rule.withBody;
  switch (rule.relation) {
    case "same":
      return other.body === self.body;
    case "sameTier":
      return other.tier === self.tier;
    case "sameTeam":
      return other.team === self.team;
    case "otherTeam":
      return other.team !== self.team;
    default:
      return true;
  }
}

/** A matching event: the rule's filters (every, chance, cooldown, maxFires), the step's budget, then its actions. */
export function consider(run: BlueprintRun, rule: CompiledRule, self: WorldBall | null, other: WorldBall | null, tile: number) {
  const spec = rule.spec;
  const i = rule.index;
  run.ruleMatches[i]++;
  if (run.ruleMatches[i] % spec.every !== 0) return;
  if (spec.maxFires > 0 && run.ruleFires[i] >= spec.maxFires) return;
  if (spec.cooldownSec > 0 && run.timeSec - run.ruleLast[i] < spec.cooldownSec) return;
  if (spec.chance < 1 && !(run.random() < spec.chance)) return;
  if (run.firingsThisStep >= BUDGET.ruleFirings) {
    run.stats.droppedFirings++;
    return;
  }
  run.firingsThisStep++;
  run.stats.firings++;
  run.ruleFires[i]++;
  run.ruleLast[i] = run.timeSec;
  if (i === run.faultOnRule) throw new Error("injected fault");
  for (const action of rule.actions) act(run, rule, action, self, other, tile);
}

/** countReached rules: each fires when its count crosses its bound (again only after it went back); the first look is a baseline. */
export function countRules(run: BlueprintRun) {
  for (const i of run.compiled.byTrigger.countReached) {
    const rule = run.compiled.rules[i];
    const spec = rule.spec;
    const v = rule.whatVar >= 0 ? run.vars[rule.whatVar] : run.count(spec.what, rule.of);
    const met = (spec.atLeast !== null && v >= spec.atLeast) || (spec.atMost !== null && v <= spec.atMost);
    const was = run.countWas[i];
    run.countWas[i] = met ? 1 : 0;
    if (met && was === 0) consider(run, rule, null, null, -1);
  }
}
