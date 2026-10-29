import type { SimulatorSettings } from "@/lib/settings";
import type { BotFamily, BotPlatform, BotRecipe, EndingStyle } from "./playbook";
import { HASHTAG_COUNT, PLATFORMS } from "./playbook";

/*
 * --- viral-bot --- The words of a clip, in the three site languages: the recipe copy under `ViralBot` in messages/*.json
 * (hooks, on-screen payoff texts and questions, post captions, keywords, hashtags, series names, posting notes) filled in
 * with the clip's numbers. Pure: the planner (in the page and in Node) hands in the `ViralBot` object of one locale. The
 * templates use plain `{name}` placeholders (no ICU plurals), so they read the same through next-intl and here.
 * --- templates --- A viral template without a recipe speaks with its format's words (`ViralBot.formats.<format>`), its
 * `{thing}` its mode's noun (`ViralBot.things.<mode>`), written so that nothing in a Polish or Spanish sentence has to agree
 * with it; a template's name is "{Mode name} · {Format name}"; the two looks have a name and a line (`ViralBot.looks`).
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

// --- insights ---
/**
 * A score reason's values as its words take them: the countdown's `kind` (a playbook COUNTDOWN_KINDS code, "walls") by its
 * name in the copy (`countdownKinds.<kind>`, "wall counter", pl "licznik ścian"), so no code reaches a sentence in any
 * language. `name` looks the name up: the bot's copy here and in the manifest, next-intl's `ViralBot` in the page.
 */
export function reasonValues(values: Readonly<Record<string, string | number>>, name: (path: string) => string): Record<string, string | number> {
  return typeof values.kind === "string" ? { ...values, kind: name(`countdownKinds.${values.kind}`) || values.kind } : { ...values };
}
// --- end insights ---

/**
 * A copy string of the recipe, filled (`field`: name, hook, cliffHook, payoff, cliffQuestion, postQuestion…). --- templates ---
 * A template's own recipe (BotRecipe.formatCopy) speaks with its format's words (formatText).
 */
export function recipeText(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey" | "formatCopy"> & Partial<Pick<BotRecipe, "postKey">>, field: string, vars: Record<string, string | number> = {}, keep: KeepUnfilled = false): string {
  // --- templates --- (studio2 review round 2, 11) a binding's own post question and hashtags, where its format's do not fit its hook
  if (recipe.postKey && (OWN_POST_FIELDS as readonly string[]).includes(field)) return fillSentences(copyString(copy, `ownPosts.${recipe.postKey.slice(OWN_POST_FIELD.length)}.${field}`), vars, keep);
  if (recipe.formatCopy) return formatText(copy, recipe.copyKey, field, vars, keep); // --- templates ---
  // --- templates --- (AI studio step 6) a recipe's template that speaks one of its format's words (FORMAT_FIELD: the boss rush's hook)
  if (field.startsWith(FORMAT_FIELD)) {
    const [format, ...rest] = field.slice(FORMAT_FIELD.length).split(".");
    return formatText(copy, format, rest.join("."), vars, keep);
  }
  return fillTemplate(copyString(copy, `recipes.${recipe.copyKey}.${field}`), vars).trim();
}

// --- templates --- the formats' words (ViralBot.formats.<format>), the modes' nouns (ViralBot.things) and the looks (ViralBot.looks)

/** --- templates --- Where a recipe's copy is under `ViralBot`: `recipes.<copyKey>`, or its format's `formats.<copyKey>` (BotRecipe.formatCopy). */
export function recipeCopyPath(recipe: Pick<BotRecipe, "copyKey" | "formatCopy">): string {
  return `${recipe.formatCopy ? "formats" : "recipes"}.${recipe.copyKey}`;
}

/**
 * The fields of a format's copy (`ViralBot.formats.<format>`, per format, not per template): its name, its hooks a, b and c, the
 * hook of a clip cut before its payoff, the payoff's words, the closing question and the post's question – --- templates --- (step
 * 2's review round 1, 16) and its own hashtags, which name its claim (clipHashtags posts them in place of its series').
 */
export const FORMAT_COPY_FIELDS = ["name", "hook", "hookB", "hookC", "cliffHook", "payoff", "cliffQuestion", "postQuestion", "hashtags"] as const;
export type FormatCopyField = (typeof FORMAT_COPY_FIELDS)[number];

/** A format's hook variants (crew/roles.ts HOOK_VARIANTS) and the field of its copy each one is. */
export const FORMAT_HOOK_FIELDS = { a: "hook", b: "hookB", c: "hookC" } as const satisfies Readonly<Record<string, FormatCopyField>>;

/**
 * The placeholders a format's words take: its mode's noun (`{thing}`: ViralBot.things), the clip's numbers (`{count}`,
 * `{seconds}`), a name (`{name}`; `{winner}`, the run's winner, as the recipes' payoffs and the planner have it) and a target
 * (`{target}`).
 */
export const FORMAT_PLACEHOLDERS = ["thing", "count", "seconds", "name", "winner", "target"] as const;

/**
 * --- templates --- (AI studio step 4) The field of a binding's own hook: `own.<key>` reads `ViralBot.ownHooks.<key>` ("How far can
 * it merge?", "It stops at zero."), for a binding whose run its format's three hooks do not describe (templates.ts hookKey).
 */
export const OWN_HOOK_FIELD = "own.";

/**
 * --- templates --- (AI studio step 6) The field of a format's own words in a recipe's copy: `format.<format>.<field>` reads
 * `ViralBot.formats.<format>.<field>` (formatText), for a template that wraps a recipe but draws its format's hook – Fight League's
 * boss rush, whose own hook names the boss and the division in one clause over the Simple look's 7 words (templates.ts wrappedRecipe).
 */
export const FORMAT_FIELD = "format.";

/**
 * --- templates --- (AI studio step 4b) The field of a binding's own payoff: `ownPayoff.<key>` reads `ViralBot.ownPayoffs.<key>`
 * ("Home! 🏠"), for a binding whose run's moment its format's payoff does not name (templates.ts payoffKey: the Journey's door
 * marked HOME, where the get-out format says "Out!").
 */
export const OWN_PAYOFF_FIELD = "ownPayoff.";

/**
 * --- templates --- (studio2 review round 2, 11) The field of a binding's own post: `ownPost.<key>` (BotRecipe.postKey) reads
 * `ViralBot.ownPosts.<key>.postQuestion` and `.hashtags` in place of its format's, for a binding whose own hook its format's post
 * does not fit – Bouncing Shapes' countdown ("It stops at zero.") was posted as "Did you think it would hit?" with "#bullseye
 * #trickshot #willithit", the conveyor's "7 balls. Will they all get out?" asked "What was your guess before the end?".
 */
export const OWN_POST_FIELD = "ownPost.";
/** The fields a binding's own post holds (OWN_POST_FIELD): every other field is its format's. */
export const OWN_POST_FIELDS = ["postQuestion", "hashtags"] as const;

/** A recipe's field a format's copy does not have, and the one that stands in for it: its name is its series, its closing question a cliffhanger's post question. */
const FORMAT_STAND_INS: Readonly<Record<string, FormatCopyField>> = { series: "name", cliffPostQuestion: "cliffQuestion" };

/** A value at the start of a sentence, with a capital: its first letter, after any mark before it. */
const capitalised = (value: string) => value.replace(/^(\P{L}*)(\p{Ll})/u, (_, lead: string, first: string) => `${lead}${first.toUpperCase()}`);

/**
 * `template` filled from `vars`: a value at the start of a sentence (the text's start, after ".", "!", "?" or "…", or after an
 * opening "¿" or "¡") starts with a capital ("{thing} vs the clock." → "The ball vs the clock."); a template with a placeholder
 * left unfilled – no value, or an empty one – is no text (""), so no clip draws a brace or a sentence with a hole in it.
 */
function fillSentences(template: string, vars: Readonly<Record<string, string | number>>, keep: KeepUnfilled = false): string {
  let unfilled = false;
  const text = template.replace(/\{(\w+)\}/g, (whole, key: string, at: number) => {
    const value = Object.hasOwn(vars, key) ? String(vars[key]).trim() : "";
    if (!value) {
      unfilled = true;
      return whole;
    }
    const before = template.slice(0, at).trimEnd();
    return before === "" || /[.!?…¿¡]$/u.test(before) ? capitalised(value) : value;
  });
  return unfilled && !keep ? "" : text.trim();
}

/**
 * --- templates --- (studio round 1, 12) Whether a text keeps a placeholder it cannot fill yet, in its braces: true where the words
 * are listed rather than drawn (the studio's templates tool and the brainstormer's menu show the conveyor's own hook as "{count}
 * balls. Will they all get out?", as a recipe's hook shows "{count}" there), false for anything a clip draws or posts.
 */
export type KeepUnfilled = boolean;

/**
 * A format's words for a field, filled (fillSentences: capitals at a sentence's start, "" while a placeholder is unfilled); a
 * recipe's field the format has none of reads the one that stands in for it (its name as the series, the closing question as
 * a cliffhanger's post question); "" for a field neither has (its keywords).
 */
export function formatText(copy: BotCopy, format: string, field: string, vars: Readonly<Record<string, string | number>> = {}, keep: KeepUnfilled = false): string {
  // --- templates --- (AI studio step 4) a binding's own hook, where its format's three do not say what its run does (OWN_HOOK_FIELD)
  if (field.startsWith(OWN_HOOK_FIELD)) return fillSentences(copyString(copy, `ownHooks.${field.slice(OWN_HOOK_FIELD.length)}`), vars, keep);
  // --- templates --- (AI studio step 4b) a binding's own payoff, where its format's does not name its run's moment (OWN_PAYOFF_FIELD)
  if (field.startsWith(OWN_PAYOFF_FIELD)) return fillSentences(copyString(copy, `ownPayoffs.${field.slice(OWN_PAYOFF_FIELD.length)}`), vars, keep);
  const own = copyString(copy, `formats.${format}.${field}`);
  const standIn = FORMAT_STAND_INS[field];
  return fillSentences(own || (standIn ? copyString(copy, `formats.${format}.${standIn}`) : ""), vars, keep);
}

/** A mode's noun, the one its format's `{thing}` takes (`ViralBot.things.<mode>`: "the ball", "piłka", "las esferas", "Gerald"); "" without one. */
export function thingOf(copy: BotCopy, mode: string): string {
  return copyString(copy, `things.${mode}`);
}

/**
 * A template's name: "{Mode name} · {Format name}" ("Shatter · Get out"), with the mode's name as the site shows it
 * (`Modes.<id>.name`, which the caller reads: this copy is the `ViralBot` namespace alone); a binding's further variant
 * (templates.ts templateNameOf) adds the name of the recipe it wraps ("Classic · Get out · Gerald escapes") – --- templates ---
 * (AI studio step 3) or, a variant without one, its own (`ViralBot.variants.<key>`: "Classic · Get out · One ring") –, so no two
 * templates share a name.
 */
export function templateName(copy: BotCopy, modeName: string, format: string, variantOf?: Pick<BotRecipe, "copyKey"> | { variant: string } | null): string {
  const parts = [modeName.trim(), copyString(copy, `formats.${format}.name`) || format];
  if (variantOf && "variant" in variantOf) parts.push(copyString(copy, `variants.${variantOf.variant}`) || variantOf.variant);
  else if (variantOf) parts.push(copyString(copy, `recipes.${variantOf.copyKey}.name`) || variantOf.copyKey);
  return parts.filter(Boolean).join(" · ");
}

/** A look's name and its one line (`ViralBot.looks.<look>`: "Simple", "Dark and calm. One line of text at a time."). */
export function lookCopy(copy: BotCopy, look: string): { name: string; line: string } {
  return { name: copyString(copy, `looks.${look}.name`) || look, line: copyString(copy, `looks.${look}.line`) };
}
// --- end templates ---

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
 * from the common list to at least HASHTAG_COUNT.min. --- templates --- (step 2's review round 1, 16) A template without a recipe
 * posts its format's own tags (`ViralBot.formats.<format>.hashtags`) and not its series': the escape series' "#escape" on a
 * target smashed, a conveyor counted or a bullseye shot was a claim the clip never made.
 */
export function clipHashtags(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey" | "family" | "formatCopy"> & Partial<Pick<BotRecipe, "postKey">>, platform: BotPlatform, vars: Record<string, string | number> = {}): string[] {
  // (--- templates --- studio2 review round 2, 11: a binding's own post tags, where its format's do not fit its hook)
  const ownPath = recipe.postKey ? `ownPosts.${recipe.postKey.slice(OWN_POST_FIELD.length)}.hashtags` : `${recipeCopyPath(recipe)}.hashtags`;
  const own = parseHashtags(fillTemplate(copyString(copy, ownPath), vars));
  const family = recipe.formatCopy ? [] : parseHashtags(copyString(copy, `hashtags.${recipe.family}`));
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
export function seriesLabel(copy: BotCopy, recipe: Pick<BotRecipe, "copyKey" | "formatCopy">, episode: number): string {
  return fillTemplate(copyString(copy, "post.seriesLabel") || "{series} · {episode}", { series: recipeText(copy, recipe, "series"), episode });
}

export interface PostCopyInput {
  recipe: Pick<BotRecipe, "copyKey" | "family" | "formatCopy"> & Partial<Pick<BotRecipe, "postKey">>;
  platform: BotPlatform;
  ending: EndingStyle;
  hook: string;
  episode: number;
  vars: Record<string, string | number>;
  postingTime: string;
  bucketLabel: string;
  /** A cut clip: the result to pin in the comments later ("" = none). */
  answer?: string;
  /** --- templates --- The series line of the caption, when it is not the day's label (the Simple look's: the clip's own label, which it does not draw). */
  series?: string;
  /**
   * --- templates --- (review round 2, 23) The caption's question, when it is not the recipe's post question: the Simple look's
   * cliffhanger asks the question its clip ends on.
   */
  question?: string;
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
  const question = input.question?.trim() || recipeText(copy, recipe, ending === "cliffhanger" ? "cliffPostQuestion" : "postQuestion", vars);
  const keywords = recipeText(copy, recipe, "keywords", vars);
  const hashtags = clipHashtags(copy, recipe, platform, vars);
  const series = input.series ?? seriesLabel(copy, recipe, episode);
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
