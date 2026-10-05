import { BOT_PLATFORMS, type BotPlatform } from "@/lib/bot/playbook";

/*
 * --- desktop-ai-fix --- Per-task reply normalisers: they run on a model's answer BEFORE it is validated (agent.ts,
 * `AgentTask.normaliseFinal`) and fix what a small local model gets wrong in an obvious, unambiguous way – so it is not sent
 * back for a retry that costs a minute on a CPU and often comes back the same. Recorded in 1.0.2 (Qwen2.5-1.5B and
 * Llama-3.2-3B on CPU): hashtags without "#", every hashtag in one string, a platform that was not asked for, planIds "1",
 * "2", "3" and placeholders copied from the prompt ("Can it escape in {seconds} seconds?"). Nothing here invents content:
 * text is trimmed and cut to its limit, hashtags are split / prefixed / cleaned / de-duplicated and clamped to 3–15 (padded
 * from the plan's own hashtags when the model wrote fewer than 3), clip names are slugified, platforms mapped from their
 * common names. Whatever is still wrong afterwards fails the checks as before.
 */

export const HASHTAGS_MIN = 3;
export const HASHTAGS_MAX = 15;
/** Characters of a hashtag after its "#" (the schema's `^#[^\s#]{1,60}$`). */
export const HASHTAG_MAX_CHARS = 60;
/** A clip's file name (the schema's `^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$`). */
export const CLIP_NAME_MAX = 60;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** One hashtag's word: letters, digits and "_" only (no "#", spaces or punctuation), at most 60 characters; "" when nothing is left. */
export function hashtagWord(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_]+/gu, "")
    .slice(0, HASHTAG_MAX_CHARS);
}

/**
 * Hashtags as the schema wants them: a list of "#word" strings – one string with several tags ("#a #b, c") is split, the
 * "#" added, punctuation removed, repeats dropped (case-insensitive), at most 15 kept and, below 3, the list topped up from
 * `fallback`. A value that is neither a string nor a list is returned as it is (the checks report it).
 */
export function normaliseHashtags(value: unknown, fallback: readonly string[] = []): unknown {
  const items = typeof value === "string" ? [value] : value;
  if (!Array.isArray(items)) return value;
  const words: string[] = [];
  const add = (raw: string) => {
    const word = hashtagWord(raw);
    if (word && !words.some((w) => w.toLowerCase() === word.toLowerCase())) words.push(word);
  };
  const split = (text: string) => text.replace(/#/g, " #").split(/[\s,;|/]+/);
  for (const item of items) if (typeof item === "string") for (const part of split(item)) add(part);
  for (const tag of fallback) {
    if (words.length >= HASHTAGS_MIN) break;
    for (const part of split(String(tag))) if (words.length < HASHTAGS_MIN) add(part);
  }
  return words.slice(0, HASHTAGS_MAX).map((w) => `#${w}`);
}

const TRANSLITERATION: Readonly<Record<string, string>> = { ł: "l", Ł: "L", ß: "ss", æ: "ae", Æ: "AE", ø: "o", Ø: "O", đ: "d", Đ: "D", œ: "oe", Œ: "OE", þ: "th", Þ: "Th", ð: "d", Ð: "D", ı: "i" };

/** A clip's file name from what the model wrote: ASCII letters, digits, spaces, "_" and "-", starting with a letter or digit, at most 60 characters. */
export function slugifyClipName(value: unknown, fallback = "clip"): string {
  const slug = (raw: string) =>
    raw
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/[łŁßæÆøØđĐœŒþÞðÐı]/g, (c) => TRANSLITERATION[c] ?? "")
      .replace(/[^A-Za-z0-9 _-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/-{2,}/g, "-")
      .replace(/^[^A-Za-z0-9]+/, "")
      .slice(0, CLIP_NAME_MAX)
      .trim();
  return slug(typeof value === "string" ? value : "") || slug(fallback) || "clip";
}

const PLATFORM_ALIASES: Readonly<Record<string, BotPlatform>> = {
  tiktok: "tiktok",
  "tik tok": "tiktok",
  tt: "tiktok",
  reels: "reels",
  reel: "reels",
  instagram: "reels",
  "instagram reels": "reels",
  "instagram reel": "reels",
  insta: "reels",
  ig: "reels",
  shorts: "shorts",
  short: "shorts",
  youtube: "shorts",
  "youtube shorts": "shorts",
  "youtube short": "shorts",
  yt: "shorts",
};

/** A platform from its common names ("TikTok", "Instagram", "YouTube Shorts" → tiktok / reels / shorts); anything else as it is. */
export function normalisePlatform(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const key = value.trim().toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return PLATFORM_ALIASES[key] ?? PLATFORM_ALIASES[key.replace(/ /g, "")] ?? value;
}

/** Example values for the recipe hooks' placeholders in a prompt (a prompt must never show a model "{seconds}"). */
export const PLACEHOLDER_EXAMPLES: Readonly<Record<string, string>> = { seconds: "30", episode: "1", count: "3", layers: "5", stages: "10", lives: "3" };

/** A template without `{name}` placeholders: the known ones filled from `vars`, a sentence that keeps an unknown one left out. */
export function withoutPlaceholders(text: string, vars: Readonly<Record<string, string | number>> = PLACEHOLDER_EXAMPLES): string {
  const filled = text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
  if (!/\{\w+\}/.test(filled)) return filled.trim();
  return filled
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !/\{\w+\}/.test(sentence))
    .join(" ")
    .trim();
}

/** A text field: trimmed, placeholders a model copied filled in (or removed), cut to `max` characters (at a space when one is close). */
export function fitText(value: unknown, max: number, vars: Readonly<Record<string, string | number>> = {}): unknown {
  if (typeof value !== "string") return value;
  let text = value
    .replace(/\{(\w+)\}/g, (_whole, key: string) => (key in vars ? String(vars[key]) : ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim();
  if (text.length > max) {
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(" ");
    text = (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
  }
  return text;
}

/** The fields of an object that a schema knows (an extra field would only fail `additionalProperties: false`). */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
}

const COPY_ITEM_KEYS = ["platform", "title", "hook", "caption", "hashtags"] as const;

/**
 * The Captions & hashtags answer: every item's text fitted, its hashtags normalised (topped up from `fallbackHashtags`), its
 * platform mapped – and one item per requested platform: an item for a platform that was not asked for, or a second one for
 * the same platform, takes a requested platform that has none yet (in the request's order); what is left over is dropped.
 */
export function normaliseCopyResult(result: unknown, platforms: readonly BotPlatform[], fallbackHashtags: readonly string[] = []): unknown {
  if (!isObject(result) || !Array.isArray(result.items)) return result;
  const wanted: readonly BotPlatform[] = platforms.length ? platforms : BOT_PLATFORMS;
  const items = result.items.filter(isObject).map((raw) => {
    const item = pick(raw, COPY_ITEM_KEYS);
    if ("platform" in item) item.platform = normalisePlatform(item.platform);
    if ("title" in item) item.title = fitText(item.title, 100);
    if ("hook" in item) item.hook = fitText(item.hook, 120);
    if ("caption" in item) item.caption = fitText(item.caption, 2200);
    if ("hashtags" in item) item.hashtags = normaliseHashtags(item.hashtags, fallbackHashtags);
    return item;
  });
  const used = new Set<string>();
  const kept: Record<string, unknown>[] = [];
  const spill: Record<string, unknown>[] = [];
  for (const item of items) {
    const p = item.platform as BotPlatform;
    if (wanted.includes(p) && !used.has(p)) {
      used.add(p);
      kept.push(item);
    } else spill.push(item);
  }
  for (const item of spill) {
    const free = wanted.find((p) => !used.has(p));
    if (!free) break;
    used.add(free);
    kept.push({ ...item, platform: free });
  }
  kept.sort((a, b) => wanted.indexOf(a.platform as BotPlatform) - wanted.indexOf(b.platform as BotPlatform));
  return { ...result, items: kept };
}

/** What the Make videos normaliser needs to know of a planned clip. */
export interface PlanFacts {
  id: string;
  platform: BotPlatform;
  /** The planner's own hashtags (to top up a list the model wrote too short). */
  hashtags: readonly string[];
  /** Values for placeholders a model copied into its text ({seconds}, {episode}). */
  vars: Readonly<Record<string, string | number>>;
}

/** The plan a clip names: its id as written, trimmed, in any case – or "1", "2"… for the first, second… plan of the run. */
export function resolvePlanId(value: unknown, plans: readonly PlanFacts[]): PlanFacts | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  const exact = plans.find((p) => p.id === id) ?? plans.find((p) => p.id.toLowerCase() === id.toLowerCase());
  if (exact) return exact;
  if (/^\d{1,2}$/.test(id)) {
    const n = Number(id);
    if (n >= 1 && n <= plans.length) return plans[n - 1];
  }
  return undefined;
}

const CLIP_KEYS = ["planId", "name", "title", "hook", "caption", "hashtags", "platform"] as const;

/**
 * The Make videos answer: each clip's planId resolved against the run's plans, its platform the plan's (a clip renders with
 * the preset its plan was made for), its name slugified, its text fitted (placeholders filled from the plan), its hashtags
 * normalised and topped up from the plan's own; a second clip for the same plan is dropped and a missing summary is "".
 */
export function normaliseMakeVideosResult(result: unknown, plans: readonly PlanFacts[]): unknown {
  if (!isObject(result) || !Array.isArray(result.clips)) return result;
  const seen = new Set<string>();
  const clips: Record<string, unknown>[] = [];
  result.clips.filter(isObject).forEach((raw, i) => {
    const clip = pick(raw, CLIP_KEYS);
    const plan = resolvePlanId(clip.planId, plans);
    const vars = plan?.vars ?? {};
    if (plan) {
      clip.planId = plan.id;
      clip.platform = plan.platform;
    } else if ("platform" in clip) clip.platform = normalisePlatform(clip.platform);
    clip.name = slugifyClipName(clip.name, typeof clip.title === "string" ? clip.title : plan?.id ?? `clip ${i + 1}`);
    if ("title" in clip) clip.title = fitText(clip.title, 100, vars);
    if ("hook" in clip) clip.hook = fitText(clip.hook, 120, vars);
    if ("caption" in clip) clip.caption = fitText(clip.caption, 2200, vars);
    if ("hashtags" in clip) clip.hashtags = normaliseHashtags(clip.hashtags, plan?.hashtags ?? []);
    const key = typeof clip.planId === "string" ? clip.planId : `#${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    clips.push(clip);
  });
  return { ...result, summary: typeof result.summary === "string" ? fitText(result.summary, 600) : "", clips };
}
