import type { SimulatorSettings } from "@/lib/settings";
import { scoreClip, type ClipPlan } from "@/lib/bot/planner";
import { RECIPES, type BotPlatform } from "@/lib/bot/playbook";
// --- insights --- a clip's genes from its source (the main process only sanitises them: it never loads these modules)
import { genesFromPlan, genesFromSettings, sanitizeGenes, type ClipGenes, type GeneSource, type GenesMeta } from "@/lib/insights/genes";
import { blueprintSettingsOf, resolveBlueprintSpec } from "@/lib/physics/modes/blueprint";
import { blueprintDigest } from "@/lib/blueprint/codec";
import { clipCutSpec, type MadeClip } from "./ai/studio"; // --- ai-cut --- (clipCutSpec: the model's five fields plus the site's address)
import type { OutputPreset } from "./presets";
import type { BatchClipSource, QueueBatchOptions, QueueJob } from "./renderQueue";
import type { VideoCodec } from "./contract";
import { resolveFastExportFps } from "@/lib/recording/fastRenderPlan"; // --- uncap-all --- (review fix)
import { DEFAULT_CLIP_EDIT, type ClipEditSpec } from "@/lib/clipEdit/spec"; // --- ai-cut ---

/*
 * --- desktop-exe --- Where render-queue clips come from: the page's own setup with a list of seeds or links, the viral bot's
 * plan, or the clips the AI planned (its name, hook, caption and hashtags travel with the clip to the Library and Publish).
 *
 * --- insights --- Each source also writes the clip's genes into its meta (lib/insights/genes.ts): a bot plan's from the plan,
 * an AI clip's from its plan as the AI's tools left it with the AI's own copy, a link's or the page's from the settings. The
 * render queue completes them when it saves the file, and scores every clip but a bot plan's from the run the file was made
 * of (lib/insights/score.ts scoreSavedClip): an AI clip's plan score is only the estimate the queue shows until then, since
 * set_clip_settings and find_simulation change what the run plays (its length, its payoff) after the plan was scored.
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

// --- insights ---
/** Mode Lab's game for a clip's genes: the catalog entry played (null for a link's spec) and the spec's digest; null in any other mode. */
export function blueprintGenesOf(settings: SimulatorSettings): GenesMeta["blueprint"] {
  if (settings.mode !== "blueprint") return null;
  const resolved = resolveBlueprintSpec(blueprintSettingsOf(settings)); // (never throws: an unreadable link plays the catalog entry)
  return { catalogId: resolved.catalogId || null, digest: blueprintDigest(resolved.blueprint) };
}

/** The genes of a clip made from settings (a link, the page's setup, a job from before 1.6.0), Mode Lab's game resolved. */
export function settingsGenes(settings: SimulatorSettings, meta: Pick<GenesMeta, "hook" | "caption" | "hashtags">, source: GeneSource): ClipGenes {
  return genesFromSettings(settings, { ...meta, blueprint: blueprintGenesOf(settings) }, source);
}

/** The recipe of a plan, for its genes (its copy key and whether the mode's own notes are the melody). */
const recipeOf = (plan: ClipPlan) => RECIPES.find((r) => r.id === plan.recipe) ?? null;

/** The series day a bot plan's id names ("ep012-1-…": the planner's episodeCode), else null. */
export function episodeOfPlanId(planId: string): number | null {
  const m = /^ep(\d{1,7})-\d+-/.exec(planId);
  return m ? Number(m[1]) : null;
}

/**
 * The genes a render-queue job is saved with: its own, else – a job journalled before 1.6.0, which had none – its settings'
 * with what its source still names: a bot plan's recipe, family, series day (its plan id) and melody, an AI clip's melody. With
 * no score of its own, the queue scores it from its run as it saves it (lib/insights/score.ts scoresFromSettings).
 */
export function jobGenes(job: Pick<QueueJob, "settings" | "source" | "meta">): ClipGenes {
  if (job.meta.genes) return job.meta.genes;
  const genes = settingsGenes(job.settings, { hook: job.meta.hook, caption: job.meta.caption, hashtags: job.meta.hashtags }, job.source.kind);
  const source = job.source;
  if (source.kind === "ai") return sanitizeGenes({ ...genes, melody: source.melodyId }) ?? genes;
  if (source.kind !== "plan") return genes;
  const recipe = RECIPES.find((r) => r.id === source.recipe) ?? null;
  const melody = source.melodyId ?? (recipe ? (recipe.musicFirst ? "ladder" : "none") : null);
  return sanitizeGenes({ ...genes, recipe: recipe?.id ?? genes.recipe, family: recipe?.family ?? null, episode: episodeOfPlanId(source.planId), melody }) ?? genes;
}
// --- end insights ---

/** A clip of the page's setup (or a link's settings) with one seed. */
export function seedSource(settings: SimulatorSettings, seed: number, source: BatchClipSource["source"] = { kind: "seed" }): BatchClipSource {
  const name = `${settings.mode}-${seed}`;
  const hook = settings.topText || null;
  return { name, source, settings, seed, meta: { title: name, platform: null, hook, caption: null, hashtags: [], genes: settingsGenes(settings, { hook, caption: null, hashtags: [] }, source.kind) /* --- insights --- */ } };
}

/** A clip of the viral bot's plan. */
export function planSource(plan: ClipPlan): BatchClipSource {
  return {
    name: plan.id,
    source: { kind: "plan", planId: plan.id, recipe: plan.recipe, melodyId: plan.melodyId },
    settings: plan.settings,
    seed: plan.seed,
    meta: { title: plan.hook, platform: plan.platform, hook: plan.hook, caption: [plan.post.caption, plan.post.question].filter(Boolean).join("\n\n"), hashtags: plan.post.hashtags, link: plan.shareUrl, genes: genesFromPlan(plan, plan, { source: "plan", recipe: recipeOf(plan) }) /* --- insights --- */ },
  };
}

/** A clip the AI planned: its plan's settings and seed, the AI's name and copy – and its TikTok cut when the run asked for one (--- ai-cut ---). */
export function aiClipSource(clip: MadeClip, plan: ClipPlan, base: ClipEditSpec = DEFAULT_CLIP_EDIT /* --- ai-cut --- the user's remembered spec: its address goes on the cut */): BatchClipSource {
  return {
    name: clip.name.trim() || plan.id,
    source: { kind: "ai", melodyId: plan.melodyId },
    settings: plan.settings,
    seed: plan.seed,
    // --- insights --- the plan as the AI's tools left it, scored again (set_clip_settings and find_simulation change what scoreClip
    // reads), with the AI's own hook, caption and hashtags: the queue's estimate until the file is saved and scored on its run
    meta: { title: clip.title, platform: clip.platform as BotPlatform, hook: clip.hook, caption: clip.caption, hashtags: clip.hashtags, link: plan.shareUrl, genes: genesFromPlan(plan, scoreClip(plan), { source: "ai", recipe: recipeOf(plan), copy: { hook: clip.hook, caption: clip.caption, hashtags: clip.hashtags } }) },
    cut: clip.cut ? clipCutSpec(clip.cut, base) : null, // --- ai-cut --- the model never writes the address: the base's goes on
  };
}
