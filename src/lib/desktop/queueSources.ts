import type { SimulatorSettings } from "@/lib/settings";
import { scoreClip, type ClipPlan } from "@/lib/bot/planner";
import { RECIPES, type BotPlatform } from "@/lib/bot/playbook";
// --- insights --- a clip's genes from its source (the main process only sanitises them: it never loads these modules)
import { genesFromPlan, genesFromSettings, genesOfCut, sanitizeGenes, type ClipGenes, type GeneSource, type GenesMeta } from "@/lib/insights/genes";
import { drawnHookOf, scoreRecipeFor } from "@/lib/insights/score"; // --- insights --- (review fix) the hook a clip draws, the recipe that plays it
import { SONGS } from "@/lib/audio/songs"; // --- insights --- (review fix) the melodies a re-render can select again
import { blueprintSettingsOf, resolveBlueprintSpec } from "@/lib/physics/modes/blueprint";
import { blueprintDigest } from "@/lib/blueprint/codec";
import { clipCutSpec, type MadeClip } from "./ai/studio"; // --- ai-cut --- (clipCutSpec: the model's five fields plus the site's address)
import type { OutputPreset } from "./presets";
import type { BatchClipSource, QueueBatchOptions, QueueJob } from "./renderQueue";
import type { LibraryItem, VideoCodec } from "./contract";
import { resolveFastExportFps } from "@/lib/recording/fastRenderPlan"; // --- uncap-all --- (review fix)
import { DEFAULT_CLIP_EDIT, type ClipEditSpec } from "@/lib/clipEdit/spec"; // --- ai-cut ---
import { isCutJob } from "@/lib/clipEdit/propose"; // --- insights --- (a cut file's re-render is its master alone)

/*
 * --- desktop-exe --- Where render-queue clips come from: the page's own setup with a list of seeds or links, the viral bot's
 * plan, or the clips the AI planned (its name, hook, caption and hashtags travel with the clip to the Library and Publish).
 *
 * --- insights --- Each source also writes the clip's genes into its meta (lib/insights/genes.ts): a bot plan's from the plan,
 * an AI clip's from its plan as the AI's tools left it with the AI's own caption and hashtags, a link's or the page's from the
 * settings. The hook genes are always the hook the clip draws (lib/insights/score.ts drawnHookOf): an AI clip's plan hook
 * captions (the AI's own hook goes on its TikTok cut's card alone), a page clip's hook caption before its Top Text. The
 * render queue completes them when it saves the file, and scores every clip but a bot plan's from the run the file was made
 * of (lib/insights/score.ts scoreSavedClip): an AI clip's plan score is only the estimate the queue shows until then, since
 * set_clip_settings and find_simulation change what the run plays (its length, its payoff, its mode) after the plan was
 * scored. A re-render plays the melody the clip was made with again (`jobMelody()`).
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

/**
 * The genes of a clip made from settings (a link, the page's setup, a job from before 1.6.0), Mode Lab's game resolved, with
 * the hook the settings draw by the score's rule (--- insights --- (review fix) `drawnHookOf()`: a hook caption first, the
 * Top Text where it is the hook; a bot plan's link draws its hook caption, not its series label on top).
 */
export function settingsGenes(settings: SimulatorSettings, meta: Pick<GenesMeta, "caption" | "hashtags">, source: GeneSource): ClipGenes {
  return genesFromSettings(settings, { caption: meta.caption, hashtags: meta.hashtags, hook: drawnHookOf(settings), blueprint: blueprintGenesOf(settings) }, source);
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
 * with what its source still names: a bot plan's recipe, family, series day (its plan id), melody and, while it draws the
 * plan's hook (its meta's), that hook's copy key; an AI clip's melody. With no score of its own, the queue scores it from its
 * run as it saves it (lib/insights/score.ts scoresFromSettings).
 */
export function jobGenes(job: Pick<QueueJob, "settings" | "source" | "meta">): ClipGenes {
  if (job.meta.genes) return job.meta.genes;
  const genes = settingsGenes(job.settings, { caption: job.meta.caption, hashtags: job.meta.hashtags }, job.source.kind);
  const source = job.source;
  if (source.kind === "ai") return sanitizeGenes({ ...genes, melody: source.melodyId }) ?? genes;
  if (source.kind !== "plan") return genes;
  const recipe = RECIPES.find((r) => r.id === source.recipe) ?? null;
  const melody = source.melodyId ?? (recipe ? (recipe.musicFirst ? "ladder" : "none") : null);
  const planHook = !!genes.hookKey && drawnHookOf(job.settings) === (job.meta.hook ?? "").trim(); // --- insights --- (review fix) the plan's hook, drawn
  return sanitizeGenes({ ...genes, recipe: recipe?.id ?? genes.recipe, family: recipe?.family ?? null, episode: episodeOfPlanId(source.planId), melody, ...(recipe && planHook ? { hookKey: `recipes.${recipe.copyKey}` } : {}) }) ?? genes;
}

// --- insights --- (review fix) the melody a job plays, and the genes of the melody it did play
/**
 * The melody a render-queue job selects before it renders (DesktopPageHooks.selectMelody): a bot plan's or an AI clip's own;
 * a re-render's (a link job with the genes it was made with) the one its genes name – a built-in melody, or none for the
 * mode's own notes or no melody – so it plays the clip again, not whatever the page has loaded. Undefined (no selection: the
 * page plays what it has): a link's or the page's clip, and genes that name no melody or one the page cannot select.
 */
export function jobMelody(job: Pick<QueueJob, "source"> & { meta?: { genes?: ClipGenes | null } }): string | null | undefined {
  if (job.source.kind === "plan" || job.source.kind === "ai") return job.source.melodyId;
  const named = job.meta?.genes?.melody;
  if (named === "ladder" || named === "none") return null;
  return named && SONGS.some((song) => song.id === named) ? named : undefined;
}

/**
 * The genes of a saved file with the melody it played (`played`: the page's melody after the render, DesktopPageHooks
 * .currentMelody): unchanged while that is the melody they name (no melody for the mode's own notes or none); else – the
 * melody could not be selected or loaded, or the page played its own – the melody played (null: none known) and no score of
 * the plan's, so the queue scores the run again with it (lib/insights/score.ts scoresFromSettings). Genes that name no
 * melody are left to the score, which reads the page's.
 */
export function genesWithPlayedMelody(genes: ClipGenes, played: string | null): ClipGenes {
  const named = genes.melody;
  if (named === null) return genes;
  if (named === "ladder" || named === "none" ? played === null : played === named) return genes;
  return sanitizeGenes({ ...genes, melody: played, planScore: null, checklist: null, reasons: undefined }) ?? genes;
}

/**
 * The genes of the queue's TikTok cut of a job's master: a cut of the master's genes, its card's hook told apart from the
 * hook the master draws (`drawnHookOf()` of the job's settings at the file's length), not from the job's copy: an AI clip's
 * own hook, drawn on the cut's card alone, is the cut's "custom" hook.
 */
export function jobCutGenes(genes: ClipGenes, job: Pick<QueueJob, "settings">, cut: { durationSec: number | null; hook: string }, clipSec?: number | null): ClipGenes {
  return genesOfCut(genes, { durationSec: cut.durationSec, hook: cut.hook, sameHook: cut.hook.trim() === (drawnHookOf(job.settings, clipSec) ?? "") });
}
// --- end insights ---

/** A clip of the page's setup (or a link's settings) with one seed. */
export function seedSource(settings: SimulatorSettings, seed: number, source: BatchClipSource["source"] = { kind: "seed" }): BatchClipSource {
  const name = `${settings.mode}-${seed}`;
  const hook = settings.topText || null;
  return { name, source, settings, seed, meta: { title: name, platform: null, hook, caption: null, hashtags: [], genes: settingsGenes(settings, { caption: null, hashtags: [] }, source.kind) /* --- insights --- (the hook it draws) */ } };
}

/**
 * A Library item's re-render: its link's settings and seed, with the item's copy. --- ai-cut --- A master's re-render makes its
 * cut again; a cut file's re-render is the master alone. --- insights --- A re-render is the same clip, so it keeps the genes it
 * was made with, and the queue completes them and scores the run again when it saves the file (a cut's genes keep no score:
 * its master's run is scored, genes.ts genesOfCut). Genes that name no source of the clip (the Clip editor's, of a cut of a
 * clip that had none) and a clip saved before 1.6.0 get the link's, with the item's own caption and hashtags and the hook the
 * link draws (a cut's card is not on the master): a link's clip, scored from its run. The job plays the melody the genes name
 * (`jobMelody()`).
 */
export function rerenderSource(item: Pick<LibraryItem, "fileName" | "meta">, settings: SimulatorSettings, seed: number): BatchClipSource {
  const { meta } = item;
  const copy = { hook: meta.hook, caption: meta.caption, hashtags: meta.hashtags };
  const genes = meta.genes && meta.genes.source !== "editor" ? meta.genes : settingsGenes(settings, copy, "link");
  return { name: item.fileName.replace(/\.[^.]+$/, ""), source: { kind: "link", link: meta.link }, settings, seed, meta: { title: meta.title, platform: meta.platform, ...copy, link: meta.link, genes }, cut: isCutJob(meta.queueJobId) ? null : (meta.cut ?? null) };
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
  // --- insights --- (review fix) the recipe that plays it (the plan's while it plays the mode set_clip_settings may have
  // changed, else the mode's own, as its score reads it) and the hook it draws (its plan's hook captions, not the AI's hook)
  const playing = scoreRecipeFor(plan.settings.mode, plan.recipe);
  const playedBy = playing?.id === plan.recipe ? {} : { playedBy: playing };
  const drawn = drawnHookOf(plan.settings);
  return {
    name: clip.name.trim() || plan.id,
    source: { kind: "ai", melodyId: plan.melodyId },
    settings: plan.settings,
    seed: plan.seed,
    // --- insights --- the plan as the AI's tools left it, scored again (set_clip_settings and find_simulation change what scoreClip
    // reads), with the AI's own caption and hashtags and the hook the clip draws: the queue's estimate until the file is saved
    // and scored on its run
    meta: { title: clip.title, platform: clip.platform as BotPlatform, hook: clip.hook, caption: clip.caption, hashtags: clip.hashtags, link: plan.shareUrl, genes: genesFromPlan(plan, scoreClip(plan), { source: "ai", recipe: recipeOf(plan), ...playedBy, copy: { hook: drawn, caption: clip.caption, hashtags: clip.hashtags } }) },
    cut: clip.cut ? clipCutSpec(clip.cut, base) : null, // --- ai-cut --- the model never writes the address: the base's goes on
  };
}
