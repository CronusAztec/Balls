import type { SimulatorSettings } from "@/lib/settings";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import type { BotWorld } from "@/lib/bot/finderRequest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { hashString, localIsoDate, planClipSteps, planDaySteps, type ClipPlan } from "@/lib/bot/planner";
import { recipeById } from "@/lib/bot/playbook";
import { findSimulation } from "@/lib/simulation/finder";
import type { FindAnswer, FindRequest, PlanClipsRequest, StudioPorts } from "@/lib/desktop/ai/studio";

/*
 * --- desktop-exe --- The AI studio's tools in the page: the viral bot's planner (in slices, so the page stays responsive,
 * like the Bot block runs it) and the seed finder, both in the page's own world so a planned seed replays exactly in the
 * fast export.
 */

const SLICE_MS = 24;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function sliced<Y, T>(steps: Generator<Y, T>, onStep: (step: Y) => void, signal?: AbortSignal): Promise<T> {
  for (;;) {
    const t0 = performance.now();
    do {
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      const next = steps.next();
      if (next.done) return next.value;
      onStep(next.value);
    } while (performance.now() - t0 < SLICE_MS);
    await pause();
  }
}

export interface StudioPortOptions {
  copy: BotCopy;
  locale: BotLocale;
  getWorld: () => BotWorld | null;
}

export function studioPorts(options: StudioPortOptions): StudioPorts {
  return {
    async planClips(request: PlanClipsRequest, signal, progress) {
      const world = options.getWorld() ?? undefined;
      const base = { copy: options.copy, locale: options.locale, bucket: request.bucket, ending: request.ending, world };
      const salt = `ai-${Date.now().toString(36)}`;
      const recipe = request.recipe ? recipeById(request.recipe) : undefined;
      if (recipe) {
        const clips: ClipPlan[] = [];
        for (let i = 0; i < request.count; i++) {
          const plan = await sliced(planClipSteps(recipe, hashString(`${salt}|${recipe.id}|${i}`), request.platform, { ...base, index: i + 1, date: localIsoDate(new Date()) }), (p) => progress(`${i + 1}/${request.count}: ${p.seedsTested}/${p.maxSeeds}`), signal);
          clips.push(plan);
        }
        return clips;
      }
      const day = await sliced(planDaySteps(new Date(), request.platform, request.count, { ...base, family: request.family, salt }), (p) => progress(`${p.clip}/${p.clips}: ${p.seedsTested}/${p.maxSeeds}`), signal);
      return day.clips;
    },
    async findSimulation(settings: SimulatorSettings, request: FindRequest, signal, progress): Promise<FindAnswer> {
      const world = options.getWorld() ?? undefined;
      const base = finderRequestOfSettings(settings, world);
      const outcome = request.outcome === "duration" ? undefined : { kind: request.outcome, clipSec: request.targetSec, ...(request.atSec !== null ? { atSec: request.atSec } : {}) };
      const result = await findSimulation({ ...base, targetDurationSec: request.targetSec, toleranceSec: 0.5, maxSeeds: 300, ...(outcome ? { outcome } : {}) }, (p) => progress(`${p.seedsTested}/${p.maxSeeds}`), signal);
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      return { found: result.found, seed: result.seed, durationSec: result.duration, endless: result.endless };
    },
  };
}
