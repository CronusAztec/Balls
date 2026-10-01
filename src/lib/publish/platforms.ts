/*
 * --- social-publish --- The three platforms the Publish block sends to, their limits and upload pages. Pure data.
 *
 * Limits (what the platforms' APIs and apps accept, 2026):
 * - TikTok: the caption (the Content Posting API's `post_info.title`) up to 2,200 UTF-16 code units, hashtags inline;
 * - Instagram Reels: the caption up to 2,200 characters with at most 30 hashtags;
 * - YouTube: the title up to 100 characters, the description up to 5,000 bytes (UTF-8), neither may contain "<" or ">";
 *   the tags up to 500 characters in all (the commas between them count); more than 60 hashtags and YouTube ignores all of
 *   them.
 */

export const PUBLISH_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export function isPublishPlatform(value: unknown): value is PublishPlatform {
  return typeof value === "string" && (PUBLISH_PLATFORMS as readonly string[]).includes(value);
}

/** Who can see a sent clip. Instagram Reels are always public; TikTok maps these onto its privacy levels. */
export const VISIBILITIES = ["public", "unlisted", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);
}

export const LIMITS = {
  tiktok: { caption: 2200 },
  instagram: { caption: 2200, hashtags: 30 },
  youtube: { title: 100, descriptionBytes: 5000, tagsChars: 500, hashtags: 60 },
} as const;

/** The pages the quick share opens on a desktop, where the clip is uploaded by hand. */
export const UPLOAD_PAGES: Record<PublishPlatform, string> = {
  tiktok: "https://www.tiktok.com/upload",
  instagram: "https://www.instagram.com/",
  youtube: "https://www.youtube.com/upload",
};

/** The platform's own tag, added to the shared hashtags when it is missing (#Shorts marks a YouTube Short). */
export const PLATFORM_TAGS: Record<PublishPlatform, string> = { tiktok: "#fyp", instagram: "#reels", youtube: "#Shorts" };

/** Every platform tag the bot's copy may carry (the bot's own platforms: reels, tiktok, shorts) – dropped from shared hashtags. */
export const KNOWN_PLATFORM_TAGS = ["#fyp", "#foryou", "#reels", "#shorts", "#youtubeshorts"];

/** The other platforms' own tags, which a platform's post leaves out (#fyp means nothing on YouTube). */
export const FOREIGN_TAGS: Record<PublishPlatform, string[]> = {
  tiktok: ["#reels", "#shorts", "#youtubeshorts"],
  instagram: ["#fyp", "#foryou", "#shorts", "#youtubeshorts"],
  youtube: ["#fyp", "#foryou", "#reels"],
};
