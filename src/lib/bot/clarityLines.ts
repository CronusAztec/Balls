import type { ClipPlan, RunFacts } from "./planner";
import { runOf, type RunFactsOptions } from "@/lib/insights/score";
import { crewClipOfPlan } from "@/lib/crew/clip";
import { clarityOf, type GateId, type GateName } from "@/lib/crew/clarity";
import type { SimpleBand } from "@/lib/crew/simplicity";

/*
 * --- bot-templates --- The crew's clarity check of one planned clip as the Bot section's "Why this clip" shows it
 * (sections/BotSection.tsx, under the checklist): the clip's Simple score and band, and the seven gates a plan is judged by
 * before any render (G1–G7; G8 reads a render), each with its verdict's key and values – the very lines the studio gives the
 * same plan (lib/crew/clarity.ts clarityOf on lib/crew/clip.ts crewClipOfPlan, the run of the plan's seed in its world). The run
 * is followed in slices (lib/insights/score.ts runOf, runSync's run), so the page stays responsive. The page loads this module
 * when a clip's lines are first opened and keeps the result in memory only: nothing is stored.
 */

// --- bot-templates ---

/** One gate's line: passed or not, its verdict's key (`<name><Verdict>`, its first problem when it fails) and that key's values. */
export interface ClarityLine {
  id: GateId;
  name: GateName;
  ok: boolean;
  key: string;
  values: Record<string, string | number>;
}

/** What "Why this clip" shows of the clarity check. */
export interface PlanClarity {
  /** The Simple score (0–100) and its band. */
  simple: number;
  band: SimpleBand;
  /** Every gate passes. */
  pass: boolean;
  gates: ClarityLine[];
}

/** The clarity lines of a plan and its run (null: judged on the plan alone, as the studio never does). Pure. */
export function planClarityOf(plan: ClipPlan, run: RunFacts | null): PlanClarity {
  const c = clarityOf(crewClipOfPlan(plan, { run }));
  return { simple: c.simple.score, band: c.simple.band, pass: c.pass, gates: c.gates.map((g) => ({ id: g.id, name: g.name, ok: g.ok, key: g.key, values: { ...g.values } })) };
}

/**
 * The clarity lines of a plan, its run followed in slices (runSync's run: the plan's seed in its world, past its clip, with its
 * payoff's moment and where it moves); null when `signal` aborts it.
 */
export async function planClarity(plan: ClipPlan, options: Pick<RunFactsOptions, "signal" | "now" | "pause"> = {}): Promise<PlanClarity | null> {
  const run = await runOf(plan.settings, plan.seed, { ...options, world: plan.world, recipe: plan.recipe, clipSec: plan.timing.clipSec, payoffSec: plan.payoff.atSec });
  return run ? planClarityOf(plan, run) : null;
}
// --- end bot-templates ---
