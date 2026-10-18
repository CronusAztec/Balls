import { LIMITS } from "@/lib/publish/platforms";
import type { LibraryMeta, SocialChannelSettings, SocialPostChannel, SocialPostRequest } from "./contract";
import { postText } from "./publish";

/*
 * --- social-postiz --- The approval card's rules (phase 2 of docs/SOCIAL-AUTOPILOT.md), pure so the tests run them without
 * React: the per-platform settings the card collects (TikTok, Instagram, YouTube, and a generic form from Postiz's schema for
 * the rest), their defaults (TikTok's privacy and interaction settings have none, as TikTok's audit rules require), what
 * stops Approve (a message key with its values), the clip's default text per channel (the Library item's caption and
 * hashtags within the platform's limits of lib/publish/platforms.ts), and the request the bridge gets once the user approves.
 */

/* ------------------------------------------------------------------ settings */

export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];
export const TIKTOK_INTERACTIONS = ["comment", "duet", "stitch"] as const;
export type TikTokInteraction = (typeof TIKTOK_INTERACTIONS)[number];
/** TikTok's `title` setting is at most 90 characters. */
export const TIKTOK_TITLE_MAX = 90;
export const YOUTUBE_VISIBILITIES = ["public", "private", "unlisted"] as const;
export type YouTubeVisibility = (typeof YOUTUBE_VISIBILITIES)[number];
export const YOUTUBE_TITLE_MIN = 2;

export interface TikTokSettings {
  __type: "tiktok";
  /** Unset until the user picks one (no default, by TikTok's audit rules). */
  privacy_level?: TikTokPrivacy;
  comment?: boolean;
  duet?: boolean;
  stitch?: boolean;
  /** Content disclosure: branded content (a paid partnership) and the creator's own brand. */
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
  /** DIRECT_POST publishes; UPLOAD puts the video in the creator's TikTok inbox to finish in the app within 24 h. */
  content_posting_method: "DIRECT_POST" | "UPLOAD";
  video_made_with_ai: boolean;
  /** --- review fix (social-postiz) --- Postiz requires it ("yes" | "no"): whether TikTok may add music to the video. */
  autoAddMusic: "yes" | "no";
  title?: string;
}

export interface InstagramSettings {
  __type: "instagram" | "instagram-standalone";
  /** A post with one video is a Reel (always public); a story disappears after 24 h. */
  post_type: "post" | "story";
  /** Collaborator user names as typed (comma-separated, no @); turned into Postiz's list on send. */
  collaborators?: string;
}

export interface YouTubeSettings {
  __type: "youtube";
  title: string;
  /** Unset until the user picks one. */
  type?: YouTubeVisibility;
  /** --- review fix (social-postiz) --- Postiz takes the string "yes" | "no", not a boolean. Unset until the user picks one. */
  selfDeclaredMadeForKids?: "yes" | "no";
  /** Tags as typed (comma-separated); turned into Postiz's list on send. */
  tags?: string;
}

export type GenericSettings = { __type: string } & Record<string, unknown>;
export type CardSettings = TikTokSettings | InstagramSettings | YouTubeSettings | GenericSettings;

export type CardFamily = "tiktok" | "instagram" | "youtube" | "other";

/** Which form a Postiz provider identifier gets. */
export function familyOf(platform: string): CardFamily {
  if (platform === "tiktok") return "tiktok";
  if (platform === "instagram" || platform === "instagram-standalone") return "instagram";
  if (platform === "youtube") return "youtube";
  return "other";
}

/** The settings a channel starts with. TikTok: privacy and the three interactions unset; the clip is marked as made with AI. */
export function defaultSettingsFor(platform: string, meta?: Pick<LibraryMeta, "title">): CardSettings {
  switch (familyOf(platform)) {
    case "tiktok":
      return { __type: "tiktok", brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: "DIRECT_POST", video_made_with_ai: true, autoAddMusic: "no" };
    case "instagram":
      return { __type: platform as InstagramSettings["__type"], post_type: "post" };
    case "youtube":
      return { __type: "youtube", title: (meta?.title ?? "").trim().slice(0, LIMITS.youtube.title) };
    default:
      return { __type: platform };
  }
}

/* ------------------------------------------------------------------ the generic form (other platforms) */

export interface GenericField {
  name: string;
  type: "string" | "boolean" | "enum";
  required: boolean;
  options: string[];
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * The fields Postiz's settings schema requires, as simple inputs: a list of `{ name, type, required, options }` entries, or a
 * JSON-schema-like `{ properties, required }`. Anything else, or no required field: caption only.
 */
export function genericFieldsOf(schema: SocialChannelSettings | null | undefined): GenericField[] {
  const root = asRecord(schema);
  if (!root) return [];
  const settings = root.settings ?? root.schema ?? root;
  const out: GenericField[] = [];
  const push = (name: string, raw: Record<string, unknown>, required: boolean) => {
    if (!name || name === "__type" || out.some((f) => f.name === name)) return;
    const options = Array.isArray(raw.enum) ? raw.enum : Array.isArray(raw.options) ? raw.options : Array.isArray(raw.values) ? raw.values : [];
    const names = options.map((o) => (typeof o === "string" ? o : String(asRecord(o)?.value ?? asRecord(o)?.label ?? ""))).filter(Boolean);
    const kind = String(raw.type ?? "").toLowerCase();
    const type: GenericField["type"] = names.length > 0 ? "enum" : kind === "boolean" || kind === "checkbox" ? "boolean" : "string";
    out.push({ name, type, required, options: names });
  };
  if (Array.isArray(settings)) {
    for (const raw of settings) {
      const r = asRecord(raw);
      if (r && typeof r.name === "string") push(r.name, r, r.required === true || r.optional === false);
    }
  } else {
    const obj = asRecord(settings);
    const properties = asRecord(obj?.properties);
    const requiredNames = Array.isArray(obj?.required) ? obj.required.filter((n): n is string => typeof n === "string") : [];
    if (properties) for (const [name, raw] of Object.entries(properties)) push(name, asRecord(raw) ?? {}, requiredNames.includes(name));
  }
  return out.filter((f) => f.required);
}

/** The caption limit of a channel: the platform's, or Postiz's `maxLength` for one the card has no form of (null: none known). */
export function captionLimitOf(platform: string, schema?: SocialChannelSettings | null): number | null {
  switch (familyOf(platform)) {
    case "tiktok":
      return LIMITS.tiktok.caption;
    case "instagram":
      return LIMITS.instagram.caption;
    case "youtube":
      return LIMITS.youtube.descriptionBytes;
    default: {
      const max = Number(asRecord(schema)?.maxLength);
      return Number.isFinite(max) && max > 0 ? max : null;
    }
  }
}

/* ------------------------------------------------------------------ the draft */

export interface CardChannel {
  id: string;
  platform: string;
  name: string;
  text: string;
  settings: CardSettings;
}

export type CardWhen = { kind: "now" } | { kind: "draft" } | { kind: "schedule"; local: string };

export interface CardDraft {
  clipId: string;
  /** The chosen channels only, in the order they were ticked. */
  channels: CardChannel[];
  when: CardWhen;
  thumbnailMs?: number;
}

export function hashtagCount(text: string): number {
  return (text.match(/(^|\s)#[^\s#]+/g) ?? []).length;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The clip's default text for a channel: its caption and hashtags, cut to the platform's limit. */
export function defaultTextFor(meta: Pick<LibraryMeta, "caption" | "hashtags" | "title">, platform: string): string {
  const text = postText(meta);
  const limit = captionLimitOf(platform);
  if (limit === null || text.length <= limit) return text;
  return text.slice(0, limit).replace(/\s+\S*$/, "");
}

/** A new channel of the draft with the clip's text and the platform's default settings. */
export function cardChannelOf(channel: { id: string; platform: string; name: string }, meta: Pick<LibraryMeta, "caption" | "hashtags" | "title">, text?: string): CardChannel {
  return { id: channel.id, platform: channel.platform, name: channel.name, text: text ?? defaultTextFor(meta, channel.platform), settings: defaultSettingsFor(channel.platform, meta) };
}

/* ------------------------------------------------------------------ what stops Approve */

/** A reason Approve is disabled: a message key under `Desktop` with its values. */
export interface CardProblem {
  key: string;
  params?: Record<string, string | number>;
  /** The channel it concerns (none: the whole card). */
  channelId?: string;
}

/** The reasons one channel is not ready. */
export function channelProblems(channel: CardChannel, generic: GenericField[] = [], schema?: SocialChannelSettings | null): CardProblem[] {
  const out: CardProblem[] = [];
  const add = (key: string, params?: Record<string, string | number>) => out.push({ key, params, channelId: channel.id });
  const family = familyOf(channel.platform);
  const limit = captionLimitOf(channel.platform, schema);
  if (family === "youtube") {
    if (utf8Bytes(channel.text) > LIMITS.youtube.descriptionBytes) add("postizProblemTextLong", { max: LIMITS.youtube.descriptionBytes });
  } else if (limit !== null && channel.text.length > limit) add("postizProblemTextLong", { max: limit });
  if (family === "instagram" && hashtagCount(channel.text) > LIMITS.instagram.hashtags) add("postizProblemHashtags", { max: LIMITS.instagram.hashtags });
  if (family === "tiktok") {
    const s = channel.settings as TikTokSettings;
    if (!s.privacy_level) add("postizProblemTikTokPrivacy");
    if (TIKTOK_INTERACTIONS.some((k) => typeof s[k] !== "boolean")) add("postizProblemTikTokInteractions");
    if ((s.brand_content_toggle || s.brand_organic_toggle) && s.privacy_level === "SELF_ONLY") add("postizProblemTikTokBrandedPrivate");
    if ((s.title ?? "").length > TIKTOK_TITLE_MAX) add("postizProblemTikTokTitle", { max: TIKTOK_TITLE_MAX });
  } else if (family === "youtube") {
    const s = channel.settings as YouTubeSettings;
    const title = (s.title ?? "").trim();
    if (title.length < YOUTUBE_TITLE_MIN || title.length > LIMITS.youtube.title || /[<>]/.test(title)) add("postizProblemYouTubeTitle", { min: YOUTUBE_TITLE_MIN, max: LIMITS.youtube.title });
    if (!s.type) add("postizProblemYouTubeVisibility");
    if (s.selfDeclaredMadeForKids !== "yes" && s.selfDeclaredMadeForKids !== "no") add("postizProblemYouTubeKids");
    if ((s.tags ?? "").length > LIMITS.youtube.tagsChars) add("postizProblemYouTubeTags", { max: LIMITS.youtube.tagsChars });
  } else if (family === "other") {
    for (const field of generic) {
      const v = (channel.settings as GenericSettings)[field.name];
      const missing = field.type === "boolean" ? typeof v !== "boolean" : typeof v !== "string" || v.trim() === "";
      if (missing) add("postizProblemRequired", { field: field.name });
    }
  }
  return out;
}

/** "yyyy-MM-ddTHH:mm" of a `datetime-local` input, in this PC's time zone, as a UTC ISO time (null when it is not a time). */
export function localToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return null;
  const at = new Date(local).getTime();
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** An ISO time as the `datetime-local` input shows it (this PC's time zone, minutes). */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The reason the chosen time is not usable (null: fine). */
export function whenProblem(when: CardWhen, now: number = Date.now()): CardProblem | null {
  if (when.kind !== "schedule") return null;
  const iso = localToIso(when.local);
  if (!iso) return { key: "postizProblemWhenInvalid" };
  if (Date.parse(iso) <= now) return { key: "postizProblemWhenPast" };
  return null;
}

/** Everything that stops Approve, in the order the card shows it. */
export function cardProblems(draft: CardDraft, now: number = Date.now(), generic: Record<string, GenericField[]> = {}, schemas: Record<string, SocialChannelSettings | null> = {}): CardProblem[] {
  const out: CardProblem[] = [];
  if (draft.channels.length === 0) out.push({ key: "postizProblemNoChannel" });
  for (const c of draft.channels) out.push(...channelProblems(c, generic[c.id] ?? [], schemas[c.id]));
  const when = whenProblem(draft.when, now);
  if (when) out.push(when);
  return out;
}

/* ------------------------------------------------------------------ the request */

/** The channel's settings as Postiz takes them (the typed lists built from the card's comma-separated fields). */
export function providerSettingsOf(channel: CardChannel): SocialPostChannel["settings"] {
  const family = familyOf(channel.platform);
  if (family === "instagram") {
    const s = channel.settings as InstagramSettings;
    const names = (s.collaborators ?? "").split(",").map((n) => n.trim().replace(/^@/, "")).filter(Boolean);
    return { __type: s.__type, post_type: s.post_type, ...(names.length > 0 ? { collaborators: names.map((label) => ({ label })) } : {}) };
  }
  if (family === "youtube") {
    const s = channel.settings as YouTubeSettings;
    const tags = (s.tags ?? "").split(",").map((n) => n.trim()).filter(Boolean);
    return { __type: "youtube", title: s.title.trim(), type: s.type, selfDeclaredMadeForKids: s.selfDeclaredMadeForKids === "yes" ? "yes" : "no", tags: tags.map((value) => ({ value, label: value })) };
  }
  if (family === "tiktok") {
    const s = channel.settings as TikTokSettings;
    const title = (s.title ?? "").trim();
    return {
      __type: "tiktok",
      privacy_level: s.privacy_level,
      comment: s.comment === true,
      duet: s.duet === true,
      stitch: s.stitch === true,
      brand_content_toggle: s.brand_content_toggle === true,
      brand_organic_toggle: s.brand_organic_toggle === true,
      content_posting_method: s.content_posting_method,
      video_made_with_ai: s.video_made_with_ai === true,
      autoAddMusic: s.autoAddMusic === "yes" ? "yes" : "no",
      ...(title ? { title } : {}),
    };
  }
  return { ...(channel.settings as GenericSettings) };
}

/** The bridge's request of an approved draft (the card checked `cardProblems()` is empty first). */
export function toRequest(draft: CardDraft): SocialPostRequest {
  const when = draft.when.kind === "schedule" ? (localToIso(draft.when.local) ?? "now") : draft.when.kind;
  return {
    clipId: draft.clipId,
    channels: draft.channels.map((c) => ({ id: c.id, platform: c.platform, text: c.text, settings: providerSettingsOf(c) })),
    when,
    ...(draft.thumbnailMs !== undefined ? { thumbnailMs: draft.thumbnailMs } : {}),
  };
}

/** Which "what will happen" label Approve carries. */
export function approveLabelKey(when: CardWhen): "postizApproveNow" | "postizApproveSchedule" | "postizApproveDraft" {
  return when.kind === "now" ? "postizApproveNow" : when.kind === "schedule" ? "postizApproveSchedule" : "postizApproveDraft";
}
