import { FOREIGN_TAGS, KNOWN_PLATFORM_TAGS, LIMITS, PLATFORM_TAGS, PUBLISH_PLATFORMS, type PublishPlatform } from "./platforms";

/*
 * --- social-publish --- The words sent with a clip: one shared draft (title, caption, hashtags) with optional per-platform
 * overrides, composed into what each platform takes – TikTok and Instagram a caption ending in the hashtags, YouTube a
 * title, a description ending in the hashtags (#Shorts first) and the hashtags as tags – with a counter per limit. Pure.
 */

/** The editable copy of a clip: shared fields and, per platform, the fields that differ. */
export interface PublishDraft {
  title: string;
  caption: string;
  /** Free text: "#a #b, c" – normalised when composed. */
  hashtags: string;
  overrides: Partial<Record<PublishPlatform, Partial<DraftFields>>>;
}

export interface DraftFields {
  title: string;
  caption: string;
  hashtags: string;
}

export const DRAFT_FIELDS = ["title", "caption", "hashtags"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

export function emptyDraft(): PublishDraft {
  return { title: "", caption: "", hashtags: "", overrides: {} };
}

/** A hashtag as the platforms take it ("#word": letters, digits and underscores), null when nothing is left. */
export function normalizeHashtag(raw: string): string | null {
  const word = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return word ? `#${word}` : null;
}

/** The hashtags of a free-text list (spaces, commas or semicolons between them), normalised, without repeats (case-insensitive). */
export function parseHashtagInput(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const tag = normalizeHashtag(raw);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** The hashtags without the platform tags a shared list should not carry (#fyp, #reels, #shorts…). */
export function withoutPlatformTags(tags: readonly string[]): string[] {
  const known = new Set(KNOWN_PLATFORM_TAGS.map((t) => t.toLowerCase()));
  return tags.filter((t) => !known.has(t.toLowerCase()));
}

/** The fields a platform sends: its overrides over the shared ones. */
export function fieldsFor(draft: PublishDraft, platform: PublishPlatform): DraftFields {
  const o = draft.overrides[platform] ?? {};
  return { title: o.title ?? draft.title, caption: o.caption ?? draft.caption, hashtags: o.hashtags ?? draft.hashtags };
}

/** Whether a platform has fields of its own. */
export function hasOverrides(draft: PublishDraft, platform: PublishPlatform): boolean {
  const o = draft.overrides[platform];
  return !!o && DRAFT_FIELDS.some((f) => o[f] !== undefined);
}

/** Length in characters (code points: an emoji counts once). */
export const charCount = (text: string) => [...text].length;
/** Length in UTF-16 code units (TikTok's "UTF-16 runes"). */
export const utf16Count = (text: string) => text.length;
/** Length in UTF-8 bytes (YouTube's description limit). */
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/** YouTube refuses "<" and ">" in titles and descriptions. */
export const stripAngleBrackets = (text: string) => text.replace(/[<>]/g, "");

export type CounterId = "caption" | "title" | "description" | "hashtags" | "tags";

export interface Counter {
  id: CounterId;
  used: number;
  max: number;
  unit: "chars" | "bytes" | "tags";
  over: boolean;
}

/** What one platform gets. */
export interface ComposedPost {
  platform: PublishPlatform;
  /** YouTube's title; for TikTok and Instagram the caption's first line (for logs). */
  title: string;
  /** The caption (TikTok, Instagram) or the description (YouTube), hashtags included. */
  text: string;
  hashtags: string[];
  /** YouTube tags (the hashtags without "#", cut to the 500-character budget); empty elsewhere. */
  tags: string[];
  counters: Counter[];
  /** Every counter within its limit. */
  ok: boolean;
}

const counter = (id: CounterId, used: number, max: number, unit: Counter["unit"]): Counter => ({ id, used, max, unit, over: used > max });

const joinBlocks = (...blocks: string[]) => blocks.map((b) => b.trim()).filter(Boolean).join("\n\n");

/** The YouTube tags of a hashtag list: without "#", as many as fit 500 characters (commas between them included). */
export function youtubeTags(hashtags: readonly string[], budget: number = LIMITS.youtube.tagsChars): string[] {
  const out: string[] = [];
  let used = 0;
  for (const tag of hashtags) {
    const word = tag.replace(/^#/, "");
    if (!word) continue;
    const cost = word.length + (out.length > 0 ? 1 : 0);
    if (used + cost > budget) break;
    out.push(word);
    used += cost;
  }
  return out;
}

/** The platform's hashtags: the list without the other platforms' tags, with its own added (#Shorts first on YouTube, else last). */
export function platformHashtags(list: string, platform: PublishPlatform): string[] {
  const tags = parseHashtagInput(list);
  const own = PLATFORM_TAGS[platform];
  const foreign = new Set(FOREIGN_TAGS[platform]);
  const rest = tags.filter((t) => t.toLowerCase() !== own.toLowerCase() && !foreign.has(t.toLowerCase()));
  return platform === "youtube" ? [own, ...rest] : [...rest, own];
}

/** What the draft gives one platform, with its counters. */
export function composePost(draft: PublishDraft, platform: PublishPlatform): ComposedPost {
  const f = fieldsFor(draft, platform);
  const hashtags = platformHashtags(f.hashtags, platform);
  const tagLine = hashtags.join(" ");
  if (platform === "youtube") {
    const firstLine = f.caption.split("\n").find((l) => l.trim()) ?? "";
    const title = stripAngleBrackets((f.title.trim() || firstLine).replace(/\s+/g, " ").trim());
    const text = stripAngleBrackets(joinBlocks(f.caption, tagLine));
    const counters = [counter("title", charCount(title), LIMITS.youtube.title, "chars"), counter("description", utf8Bytes(text), LIMITS.youtube.descriptionBytes, "bytes"), counter("hashtags", hashtags.length, LIMITS.youtube.hashtags, "tags")];
    // An empty title is refused too.
    if (!title) counters[0] = { ...counters[0], over: true };
    return { platform, title, text, hashtags, tags: youtubeTags(hashtags), counters, ok: counters.every((c) => !c.over) };
  }
  const text = joinBlocks(f.caption, tagLine);
  const title = (f.title.trim() || f.caption.split("\n").find((l) => l.trim()) || "").trim();
  const counters = platform === "tiktok" ? [counter("caption", utf16Count(text), LIMITS.tiktok.caption, "chars")] : [counter("caption", charCount(text), LIMITS.instagram.caption, "chars"), counter("hashtags", hashtags.length, LIMITS.instagram.hashtags, "tags")];
  return { platform, title, text, hashtags, tags: [], counters, ok: counters.every((c) => !c.over) };
}

/** Every platform's post. */
export function composeAll(draft: PublishDraft): Record<PublishPlatform, ComposedPost> {
  return Object.fromEntries(PUBLISH_PLATFORMS.map((p) => [p, composePost(draft, p)])) as Record<PublishPlatform, ComposedPost>;
}

/**
 * The draft after an edit of one field – of the shared fields (`platform` null) or of one platform's. A platform field set
 * back to the shared value stops being an override.
 */
export function editDraft(draft: PublishDraft, platform: PublishPlatform | null, field: DraftField, value: string): PublishDraft {
  if (!platform) return { ...draft, [field]: value };
  const own = { ...(draft.overrides[platform] ?? {}) };
  if (value === draft[field]) delete own[field];
  else own[field] = value;
  const overrides = { ...draft.overrides };
  if (DRAFT_FIELDS.some((f) => own[f] !== undefined)) overrides[platform] = own;
  else delete overrides[platform];
  return { ...draft, overrides };
}

/** The draft without a platform's overrides. */
export function resetPlatform(draft: PublishDraft, platform: PublishPlatform): PublishDraft {
  const overrides = { ...draft.overrides };
  delete overrides[platform];
  return { ...draft, overrides };
}

/** A stored draft, validated. */
export function parseDraft(raw: unknown): PublishDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 6000) : "");
  const overrides: PublishDraft["overrides"] = {};
  if (r.overrides && typeof r.overrides === "object") {
    for (const p of PUBLISH_PLATFORMS) {
      const o = (r.overrides as Record<string, unknown>)[p];
      if (!o || typeof o !== "object") continue;
      const own: Partial<DraftFields> = {};
      for (const f of DRAFT_FIELDS) if (typeof (o as Record<string, unknown>)[f] === "string") own[f] = str((o as Record<string, unknown>)[f]);
      if (Object.keys(own).length) overrides[p] = own;
    }
  }
  return { title: str(r.title), caption: str(r.caption), hashtags: str(r.hashtags), overrides };
}
