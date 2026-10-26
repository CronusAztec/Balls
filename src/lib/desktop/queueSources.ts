import type { SimulatorSettings } from "@/lib/settings";
import type { ClipPlan } from "@/lib/bot/planner";
import type { BotPlatform } from "@/lib/bot/playbook";
import { clipCutSpec, type MadeClip } from "./ai/studio"; // --- ai-cut --- (clipCutSpec: the model's five fields plus the site's address)
import type { OutputPreset } from "./presets";
import type { BatchClipSource, QueueBatchOptions } from "./renderQueue";
import type { VideoCodec } from "./contract";
import { resolveFastExportFps } from "@/lib/recording/fastRenderPlan"; // --- uncap-all --- (review fix)
import { DEFAULT_CLIP_EDIT, type ClipEditSpec } from "@/lib/clipEdit/spec"; // --- ai-cut ---

/*
 * --- desktop-exe --- Where render-queue clips come from: the page's own setup with a list of seeds or links, the viral bot's
 * plan, or the clips the AI planned (its name, hook, caption and hashtags travel with the clip to the Library and Publish).
 */

/** The platform preset a planned clip renders with. */
export function presetForPlatform(platform: string | null | undefined): OutputPreset {
  return platform === "tiktok" || platform === "reels" || platform === "shorts" ? platform : "native";
}

/**
 * --- uncap-all --- (review fix) The batch of a Library item's re-render: one job at the settings' render size and frame rate,
 * the rate as typed (any from 30 up, `resolveFastExportFps()`; the re-render turned it into 30 or 60), with the codec and preset.
 */
export function rerenderOptions(settings: Pick<SimulatorSettings, "recordingResolution" | "fastExportFps">, codec: VideoCodec, preset: OutputPreset): QueueBatchOptions {
  return { resolutions: [settings.recordingResolution], fps: [resolveFastExportFps(settings.fastExportFps)], codecs: [codec], presets: [preset] };
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

/** A clip the AI planned: its plan's settings and seed, the AI's name and copy – and its TikTok cut when the run asked for one (--- ai-cut ---). */
export function aiClipSource(clip: MadeClip, plan: ClipPlan, base: ClipEditSpec = DEFAULT_CLIP_EDIT /* --- ai-cut --- the user's remembered spec: its address goes on the cut */): BatchClipSource {
  return {
    name: clip.name.trim() || plan.id,
    source: { kind: "ai", melodyId: plan.melodyId },
    settings: plan.settings,
    seed: plan.seed,
    meta: { title: clip.title, platform: clip.platform as BotPlatform, hook: clip.hook, caption: clip.caption, hashtags: clip.hashtags, link: plan.shareUrl },
    cut: clip.cut ? clipCutSpec(clip.cut, base) : null, // --- ai-cut --- the model never writes the address: the base's goes on
  };
}
