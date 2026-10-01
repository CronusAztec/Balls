import { copyString, fillTemplate, parseHashtags, recipeText, type BotCopy } from "@/lib/bot/copy";
import { HASHTAG_COUNT, RECIPES, type BotRecipe } from "@/lib/bot/playbook";
import type { ClipPlan } from "@/lib/bot/planner";
import { withoutPlatformTags, type PublishDraft } from "./caption";

/*
 * --- social-publish --- The first draft of a clip's copy, from the viral bot's copy generator (lib/bot/copy.ts): a clip the
 * bot planned gets its own hook, series line, question, keywords and hashtags; any other clip the copy of the bot recipe
 * that plays in its mode (keywords, question, the recipe's, family's and common hashtags) under a title built from the mode
 * name. The platform tags (#fyp, #reels, #Shorts) are left out – composePost() adds the right one per platform. Pure.
 */

/** The page's own strings for clips the bot did not plan ({mode}, {site}). */
export interface DefaultCopyStrings {
  title: string;
  caption: string;
}

/** A bot clip's copy: what the planner wrote for it. */
export function draftFromBotClip(clip: Pick<ClipPlan, "hook" | "post" | "series">): PublishDraft {
  const caption = [clip.hook, clip.series?.label ?? "", clip.post.question, clip.post.keywords].map((s) => s.trim()).filter(Boolean).join("\n\n");
  return { title: clip.hook.trim(), caption, hashtags: withoutPlatformTags(clip.post.hashtags).join(" "), overrides: {} };
}

const hasPlaceholder = (text: string) => /\{\w+\}/.test(text);

/** The bot recipe that plays in a mode (the first one), if any. */
export function recipeForMode(mode: string | null | undefined): BotRecipe | null {
  if (!mode) return null;
  return RECIPES.find((r) => (r.modes as readonly string[]).includes(mode)) ?? null;
}

/** The hashtags of a mode: its recipe's own (those that need no clip numbers), its family's, then the common ones. */
export function modeHashtags(copy: BotCopy, mode: string | null | undefined): string[] {
  const recipe = recipeForMode(mode);
  const lists = [recipe ? copyString(copy, `recipes.${recipe.copyKey}.hashtags`) : "", recipe ? copyString(copy, `hashtags.${recipe.family}`) : "", copyString(copy, "hashtags.common")];
  const out: string[] = [];
  for (const list of lists) {
    for (const tag of parseHashtags(list.split(/\s+/).filter((w) => !hasPlaceholder(w)).join(" "))) {
      if (out.length < HASHTAG_COUNT.max && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    }
  }
  return withoutPlatformTags(out);
}

/** A clip's first draft: the bot's copy for a bot clip, else the mode's. */
export function defaultDraft(input: { copy: BotCopy; strings: DefaultCopyStrings; modeName: string | null; mode: string | null; site: string; botClip?: Pick<ClipPlan, "hook" | "post" | "series"> | null }): PublishDraft {
  if (input.botClip) return draftFromBotClip(input.botClip);
  const vars = { mode: input.modeName ?? input.site, site: input.site };
  const title = fillTemplate(input.strings.title, vars).trim();
  const recipe = recipeForMode(input.mode);
  const lines = [fillTemplate(input.strings.caption, vars).trim()];
  if (recipe) {
    for (const field of ["keywords", "postQuestion"]) {
      const text = recipeText(input.copy, recipe, field);
      if (text && !hasPlaceholder(text)) lines.push(text);
    }
  }
  return { title, caption: lines.filter(Boolean).join("\n\n"), hashtags: modeHashtags(input.copy, input.mode).join(" "), overrides: {} };
}
