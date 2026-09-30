import type { SimulatorSettings } from "@/lib/settings";
import type { BotFamily, BotPlatform, BotRecipe, EndingStyle } from "./playbook";
import { HASHTAG_COUNT, PLATFORMS } from "./playbook";

/*
 * --- viral-bot --- The words of a clip, in the three site languages: the recipe copy under `ViralBot` in messages/*.json
 * (hooks, on-screen payoff texts and questions, post captions, keywords, hashtags, series names, posting notes) filled in
 * with the clip's numbers. Pure: the planner (in the page and in Node) hands in the `ViralBot` object of one locale. The
 * templates use plain `{name}` placeholders (no ICU plurals), so they read the same through next-intl and here.
 */

export const BOT_LOCALES = ["en", "pl", "es"] as const;
export type BotLocale = (typeof BOT_LOCALES)[number];

export function isBotLocale(value: unknown): value is BotLocale {
  return typeof value === "string" && (BOT_LOCALES as readonly string[]).includes(value);
}

/** The `ViralBot` namespace of one messages file. */
export type BotCopy = Record<string, unknown>;

/** The string at a dotted path of the copy ("recipes.ringEscape.hook"), "" when there is none. */
export function copyString(copy: BotCopy, path: string): string {
  let node: unknown = copy;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : "";
}

/** Fills `{name}` placeholders; unknown ones are left as they are. */
export function fillTemplate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** A copy string of the recipe, filled (`field`: name, hook, cliffHook, payoff, cliffQuestion, postQuestion…). */
export function recipeText(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey">, field: string, vars: Record<string, string | number> = {}): string {
  return fillTemplate(copyString(copy, `recipes.${recipe.copyKey}.${field}`), vars).trim();
}

/** The words of a hashtag list ("#a #b, #c"), each starting with "#", without repeats (case-insensitive). */
export function parseHashtags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const word = raw.trim();
    if (!/^#[\p{L}\p{N}_]+$/u.test(word)) continue;
    if (!out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out;
}

/** The copy variables of a recipe for these settings (`BotRecipe.copyVars`: variable → path under `ViralBot`), filled in. */
export function recipeCopyVars(copy: BotCopy, recipe: Pick<BotRecipe, "copyVars">, settings: SimulatorSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, path] of Object.entries(recipe.copyVars?.(settings) ?? {})) out[name] = copyString(copy, path);
  return out;
}

/**
 * 5–10 niche hashtags (§3.10): the recipe's own first (its list filled with `vars` – a tag that fills in empty is left
 * out), then the family's, the platform's tag and the locale's common ones – never more than HASHTAG_COUNT.max, and padded
 * from the common list to at least HASHTAG_COUNT.min.
 */
export function clipHashtags(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey" | "family">, platform: BotPlatform, vars: Record<string, string | number> = {}): string[] {
  const own = parseHashtags(fillTemplate(copyString(copy, `recipes.${recipe.copyKey}.hashtags`), vars));
  const family = parseHashtags(copyString(copy, `hashtags.${recipe.family}`));
  const common = parseHashtags(copyString(copy, "hashtags.common"));
  const out: string[] = [];
  const add = (tag: string) => {
    if (out.length < HASHTAG_COUNT.max && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  };
  for (const tag of own.slice(0, 4)) add(tag);
  for (const tag of family.slice(0, 2)) add(tag);
  add(PLATFORMS[platform].tag);
  for (const tag of common) add(tag);
  return out;
}

/** "Ring Escape · Day 12": the series label on the clip (Top Text) and in the caption. */
export function seriesLabel(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey">, episode: number): string {
  return fillTemplate(copyString(copy, "post.seriesLabel") || "{series} · {episode}", { series: recipeText(copy, recipe, "series"), episode });
}

export interface PostCopyInput {
  recipe: Pick<BotRecipe, "copyKey" | "family">;
  platform: BotPlatform;
  ending: EndingStyle;
  hook: string;
  episode: number;
  vars: Record<string, string | number>;
  postingTime: string;
  bucketLabel: string;
  /** A cut clip: the result to pin in the comments later ("" = none). */
  answer?: string;
}

export interface PostCopy {
  /** The whole caption, ready to paste: hook, series line, question, keywords, hashtags. */
  caption: string;
  /** The specific question of the caption (§2: specific questions beat "what do you think?"). */
  question: string;
  keywords: string;
  hashtags: string[];
  /** What to do when posting (Trial Reels, first-hour replies, the pinned answer of a cliffhanger…). */
  note: string;
  series: string;
}

/** The post: caption (§3.10), hashtags and the posting note (§3.12), in the copy's language. */
export function postCopy(copy: BotCopy, input: PostCopyInput): PostCopy {
  const { recipe, platform, ending, hook, episode, vars } = input;
  const question = recipeText(copy, recipe, ending === "cliffhanger" ? "cliffPostQuestion" : "postQuestion", vars);
  const keywords = recipeText(copy, recipe, "keywords", vars);
  const hashtags = clipHashtags(copy, recipe, platform, vars);
  const series = seriesLabel(copy, recipe, episode);
  const caption = [hook, series, question, keywords, hashtags.join(" ")].filter((line) => line.trim()).join("\n\n");
  const noteParts = [
    fillTemplate(copyString(copy, "post.noteTime"), { time: input.postingTime, platform: copyString(copy, `platforms.${platform}`) || platform }),
    copyString(copy, ending === "cliffhanger" ? "post.noteCliff" : "post.noteResolved"),
    ending === "cliffhanger" && input.answer ? fillTemplate(copyString(copy, "post.noteAnswer"), { answer: input.answer }) : "",
    copyString(copy, "post.noteReplies"),
    fillTemplate(copyString(copy, "post.noteLength"), { bucket: input.bucketLabel }),
    copyString(copy, "post.noteTrial"),
  ];
  return { caption, question, keywords, hashtags, note: noteParts.filter(Boolean).join(" "), series };
}

/** The family's display name ("Escape"). */
export function familyName(copy: BotCopy, family: BotFamily): string {
  return copyString(copy, `families.${family}`) || family;
}
