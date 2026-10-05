import { SITE_NAME } from "@/lib/site";
import { copyString, fillTemplate, type BotCopy } from "./copy";
import { recipeById, type BotPlatform } from "./playbook";
import type { ClipPlan, ScoreReason } from "./planner";
import { coverFrameOf, type CoverFrame } from "./cover"; // --- mode-thumbnails ---

/*
 * --- viral-bot --- What a rendered (or planned) batch of clips is delivered as – the same files from the Bot section's ZIP
 * and from the CLI's output folder: `<episode>-<recipe>-<seed>.mp4|webm` per clip, a caption `.txt` beside it (caption,
 * hashtags, posting notes), `manifest.json` (recipe, seed, share link, caption, score, ending, posting time per clip) and
 * `posting-schedule.md`. Pure: the page, the CLI and the tests build them from the plans.
 */

export const MANIFEST_FORMAT = "jumpingballslive-bot-manifest";
export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const SCHEDULE_FILE = "posting-schedule.md";

export type ClipStatus = "planned" | "done" | "failed" | "skipped";

/** How a clip's render went (absent: only planned). */
export interface RenderedClip {
  /** The plan's id. */
  id: string;
  status: ClipStatus;
  /** The video's file name (with its extension) once rendered. */
  file: string | null;
  durationSec: number | null;
  bytes: number | null;
  error?: string;
}

export interface ManifestClip {
  episode: string;
  day: number;
  index: number;
  recipe: string;
  family: string;
  mode: string;
  seed: number;
  planSeed: number;
  status: ClipStatus;
  file: string | null;
  captionFile: string;
  durationSec: number;
  recordingDuration: number;
  bucket: string;
  ending: string;
  payoff: { type: string; atSec: number | null; position: number | null; cutGapSec: number | null; winner: string | null };
  /** --- mode-thumbnails --- The frame to post as the clip's cover (its hero moment: the payoff on screen; lib/bot/cover.ts). */
  cover: CoverFrame;
  hook: string;
  score: number;
  reasons: { id: string; points: number; max: number; text: string }[];
  shareUrl: string;
  caption: string;
  hashtags: string[];
  postingTime: string;
  postingNote: string;
  melody: string | null;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  version: number;
  date: string | null;
  platform: BotPlatform;
  locale: string;
  world: { width: number; height: number };
  clips: ManifestClip[];
}

/** A reason of the score in words (the copy's `reasons.<key>`). */
export function reasonText(copy: BotCopy, reason: Pick<ScoreReason, "key" | "values">): string {
  return fillTemplate(copyString(copy, `reasons.${reason.key}`) || reason.key, reason.values);
}

/** `<episode>-<recipe>-<seed>` – the video, its caption file and the manifest all use it. */
export function clipFileBase(plan: Pick<ClipPlan, "id">): string {
  return plan.id;
}

export function captionFileName(plan: Pick<ClipPlan, "id">): string {
  return `${clipFileBase(plan)}.txt`;
}

/** "2026-09-30 18:00" (the date left out for a plan without one). */
export function postingStamp(plan: Pick<ClipPlan, "date" | "post">): string {
  return plan.date ? `${plan.date} ${plan.post.time}` : plan.post.time;
}

/** --- mode-thumbnails --- A clip's cover frame in words: "12.4 s – the payoff on screen". */
export function coverText(cover: CoverFrame, copy: BotCopy): string {
  return fillTemplate(copyString(copy, "cover.at") || "{sec} s – {why}", { sec: cover.atSec.toFixed(1), why: copyString(copy, `cover.sources.${cover.source}`) || cover.source });
}

/**
 * The caption file of a clip: the caption to paste (it ends with the hashtags), then the posting notes and the details.
 * --- mode-thumbnails --- `renderedSec`: the rendered clip's length, which its cover frame stays inside.
 */
export function captionFileText(plan: ClipPlan, copy: BotCopy, renderedSec?: number | null): string {
  const lines = [
    plan.post.caption,
    "",
    "---",
    `${copyString(copy, "schedule.time") || "Time"}: ${postingStamp(plan)} (${copyString(copy, `platforms.${plan.platform}`) || plan.platform})`,
    plan.post.note,
    `${copyString(copy, "schedule.ending") || "Ending"}: ${copyString(copy, `endings.${plan.ending}`) || plan.ending} · ${copyString(copy, "schedule.score") || "Score"}: ${plan.score}/100`,
    `${copyString(copy, "schedule.recipe") || "Recipe"}: ${plan.recipe} · seed ${plan.seed}`,
    `${copyString(copy, "cover.label") || "Cover"}: ${coverText(coverFrameOf(plan, renderedSec), copy)}`, // --- mode-thumbnails ---
    plan.shareUrl,
    "",
    `${copyString(copy, "manual.title") || "Posting by hand"}: ${copyString(copy, "manual.steps")}`,
  ];
  return `${lines.join("\n").trim()}\n`;
}

/** The manifest of a batch: one entry per plan, with its render when there is one. */
export function buildManifest(plans: readonly ClipPlan[], copy: BotCopy, meta: { date: string | null; platform: BotPlatform; locale: string }, rendered: readonly RenderedClip[] = []): Manifest {
  const world = plans[0]?.world ?? { width: 800, height: 600 };
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    date: meta.date,
    platform: meta.platform,
    locale: meta.locale,
    world: { width: world.width, height: world.height },
    clips: plans.map((plan) => {
      const r = rendered.find((x) => x.id === plan.id);
      return {
        episode: plan.episodeCode,
        day: plan.episode,
        index: plan.index,
        recipe: plan.recipe,
        family: plan.family,
        mode: plan.mode,
        seed: plan.seed,
        planSeed: plan.planSeed,
        status: r?.status ?? "planned",
        file: r?.file ?? null,
        captionFile: captionFileName(plan),
        durationSec: Math.round(100 * (r?.durationSec ?? plan.timing.clipSec)) / 100,
        recordingDuration: plan.timing.recordingDuration,
        bucket: plan.bucket,
        ending: plan.ending,
        payoff: { type: plan.payoff.type, atSec: plan.payoff.atSec, position: plan.payoff.position, cutGapSec: plan.payoff.cutGapSec, winner: plan.payoff.winner },
        cover: coverFrameOf(plan, r?.durationSec ?? null), // --- mode-thumbnails ---
        hook: plan.hook,
        score: plan.score,
        reasons: plan.reasons.map((reason) => ({ id: reason.id, points: reason.points, max: reason.max, text: reasonText(copy, reason) })),
        shareUrl: plan.shareUrl,
        caption: plan.post.caption,
        hashtags: [...plan.post.hashtags],
        postingTime: postingStamp(plan),
        postingNote: plan.post.note,
        melody: plan.melodyId,
      };
    }),
  };
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** posting-schedule.md: when to post which file, its recipe, ending, score and hook, then the manual steps. */
export function scheduleMarkdown(plans: readonly ClipPlan[], copy: BotCopy, meta: { date: string | null; platform: BotPlatform }, rendered: readonly RenderedClip[] = []): string {
  const h = (key: string, fallback: string) => copyString(copy, `schedule.${key}`) || fallback;
  const platform = copyString(copy, `platforms.${meta.platform}`) || meta.platform;
  const out = [
    `# ${h("title", "Posting schedule")}`,
    "",
    fillTemplate(h("intro", "Planned for {date} ({platform})."), { date: meta.date ?? "–", platform, siteName: SITE_NAME }),
    "",
    `| # | ${h("time", "Time")} | ${h("file", "File")} | ${h("recipe", "Recipe")} | ${h("ending", "Ending")} | ${h("score", "Score")} | ${h("hook", "Hook")} |`,
    "|---|---|---|---|---|---|---|",
  ];
  for (const plan of plans) {
    const r = rendered.find((x) => x.id === plan.id);
    const file = r?.file ?? `${clipFileBase(plan)}.mp4`;
    const recipe = copyString(copy, `recipes.${recipeById(plan.recipe)?.copyKey ?? plan.recipe}.name`) || plan.recipe;
    out.push(`| ${plan.index} | ${cell(postingStamp(plan))} | ${cell(file)} | ${cell(recipe)} | ${cell(copyString(copy, `endings.${plan.ending}`) || plan.ending)} | ${plan.score} | ${cell(plan.hook)} |`);
  }
  out.push("", `## ${copyString(copy, "manual.title") || "Posting by hand"}`, "", copyString(copy, "manual.steps"), "");
  for (const plan of plans) out.push(`- **${plan.index}.** ${cell(plan.post.note)}`);
  // --- mode-thumbnails --- the cover frame of every clip (its hero moment), for posting by hand
  if (plans.length) {
    out.push("", `## ${copyString(copy, "cover.title") || "Covers"}`, "", copyString(copy, "cover.intro") || "The frame to set as each clip's cover:", "");
    for (const plan of plans) out.push(`- **${plan.index}.** ${cell(coverText(coverFrameOf(plan, rendered.find((x) => x.id === plan.id)?.durationSec ?? null), copy))}`);
  }
  return `${out.join("\n").trim()}\n`;
}

/** Every text file of a batch (name → contents): a caption file per clip, the manifest and the schedule. */
export function batchTextFiles(plans: readonly ClipPlan[], copy: BotCopy, meta: { date: string | null; platform: BotPlatform; locale: string }, rendered: readonly RenderedClip[] = []): { name: string; text: string }[] {
  return [
    ...plans.map((plan) => ({ name: captionFileName(plan), text: captionFileText(plan, copy, rendered.find((x) => x.id === plan.id)?.durationSec ?? null /* --- mode-thumbnails --- */) })),
    { name: MANIFEST_FILE, text: `${JSON.stringify(buildManifest(plans, copy, meta, rendered), null, 2)}\n` },
    { name: SCHEDULE_FILE, text: scheduleMarkdown(plans, copy, meta, rendered) },
  ];
}
