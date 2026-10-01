import type { SimulatorSettings } from "@/lib/settings";
import type { ClipPlan } from "@/lib/bot/planner";
import type { BotPlatform } from "@/lib/bot/playbook";
import type { MadeClip } from "./ai/studio";
import type { OutputPreset } from "./presets";
import type { BatchClipSource } from "./renderQueue";

/*
 * --- desktop-exe --- Where render-queue clips come from: the page's own setup with a list of seeds or links, the viral bot's
 * plan, or the clips the AI planned (its name, hook, caption and hashtags travel with the clip to the Library and Publish).
 */

/** The platform preset a planned clip renders with. */
export function presetForPlatform(platform: string | null | undefined): OutputPreset {
  return platform === "tiktok" || platform === "reels" || platform === "shorts" ? platform : "native";
}

/** A clip of the page's setup (or a link's settings) with one seed. */
export function seedSource(settings: SimulatorSettings, seed: number, source: BatchClipSource["source"] = { kind: "seed" }): BatchClipSource {
  const name = `${settings.mode}-${seed}`;
  return { name, source, settings, seed, meta: { title: name, platform: null, hook: settings.topText || null, caption: null, hashtags: [] } };
}

/** A clip of the viral bot's plan. */
export function planSource(plan: ClipPlan): BatchClipSource {
  return {
    name: plan.id,
    source: { kind: "plan", planId: plan.id, recipe: plan.recipe, melodyId: plan.melodyId },
    settings: plan.settings,
    seed: plan.seed,
    meta: { title: plan.hook, platform: plan.platform, hook: plan.hook, caption: [plan.post.caption, plan.post.question].filter(Boolean).join("\n\n"), hashtags: plan.post.hashtags, link: plan.shareUrl },
  };
}

/** A clip the AI planned: its plan's settings and seed, the AI's name and copy. */
export function aiClipSource(clip: MadeClip, plan: ClipPlan): BatchClipSource {
  return {
    name: clip.name.trim() || plan.id,
    source: { kind: "ai", melodyId: plan.melodyId },
    settings: plan.settings,
    seed: plan.seed,
    meta: { title: clip.title, platform: clip.platform as BotPlatform, hook: clip.hook, caption: clip.caption, hashtags: clip.hashtags, link: plan.shareUrl },
  };
}
