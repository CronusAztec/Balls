/*
 * --- autonomy --- Postiz's own error messages, as a versioned table, so the app can tell what a failed post means: a Trial
 * Reel the account cannot post, the Trial Reel limit, a warning from the platform about the account, a daily limit, a media
 * problem, or something else. "Fully autonomous" (the learner plan's C11, lib/desktop/autonomy.ts) pauses on them, and the
 * Trial Reel lane (C1 and C2) turns trials off or waits on the two trial kinds.
 *
 * Why messages and not Meta's codes: Postiz keeps its own English sentence in post.error, never the platform's code. A
 * provider's handleErrors() reads the platform's answer for a code or a phrase and returns a sentence of its own; the post
 * then turns ERROR with that sentence (changeState). So the table holds Postiz's exact sentences, read in the Postiz source on
 * 29 Oct 2026 at tag v2.25.3 (unchanged at the main branch of 28 Oct 2026):
 *  - libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts: handleErrors() in its own order, then the
 *    create-time refusals of checkValidity() (instagram-standalone uses the same handleErrors);
 *  - libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts: handleErrors() and the upload's own sentences,
 *    because YouTube is the other platform Fully autonomous posts to;
 *  - libraries/nestjs-libraries/src/integrations/social.abstract.ts: the media read that failed.
 * Each entry keeps the markers Postiz looks for in the platform's answer (Meta's codes such as 2207051, or a phrase), so a
 * text that holds only the platform's answer is matched by its marker, in Postiz's own order. A code is matched as a whole
 * number. Postiz's catch-all "Unknown Error" is not in the table on purpose: a text the table does not know is "unknown", and
 * Fully autonomous pauses on it (fail closed). A later Postiz that rewords a sentence does the same until the table follows.
 *
 * Pure, no imports: the app's main process bundles it (tests/postizErrors.test.ts reads its imports and bundles it).
 */

// --- autonomy ---

/** Bumped whenever an entry changes. */
export const POSTIZ_ERRORS_VERSION = 1;
/** The Postiz release the sentences were read from. */
export const POSTIZ_ERRORS_POSTIZ = "2.25.3";

/**
 * What a failed post means:
 *  - trialUnsupported: the Instagram account cannot post Trial Reels (Meta 2207081);
 *  - trialLimit: the account's Trial Reel limit is reached (Meta 2207078);
 *  - accountHealth: the platform warned about the account, or its login must be renewed (blocked, spam, restricted, a revoked
 *    or invalidated session, Instagram's log-in checkpoint);
 *  - dailyLimit: the account's own posting limit for the day;
 *  - media: the file, its format, its thumbnail or its upload;
 *  - other: the text, the settings or the permissions of a post, a retry, or anything else Postiz names.
 */
export const POSTIZ_ERROR_KINDS = ["trialUnsupported", "trialLimit", "accountHealth", "dailyLimit", "media", "other"] as const;
export type PostizErrorKind = (typeof POSTIZ_ERROR_KINDS)[number];
/** The kinds that are about the account, not the post: Fully autonomous pauses every account on them, for 48 hours. */
export const ACCOUNT_HEALTH_KINDS: readonly PostizErrorKind[] = ["accountHealth", "dailyLimit"];

export interface PostizErrorEntry {
  /** Postiz's sentence, exactly. */
  message: string;
  kind: PostizErrorKind;
  /** The provider whose sentence it is ("any": the shared media read). */
  platform: "instagram" | "youtube" | "any";
  /** What Postiz looks for in the platform's answer (case as written; a leading or trailing digit is a whole-number edge). */
  markers?: readonly string[];
  /** What Postiz looks for in the lowercased answer. */
  lowerMarkers?: readonly string[];
}

const ig = (message: string, kind: PostizErrorKind, markers?: readonly string[], lowerMarkers?: readonly string[]): PostizErrorEntry => ({ message, kind, platform: "instagram", ...(markers ? { markers } : {}), ...(lowerMarkers ? { lowerMarkers } : {}) });
const yt = (message: string, kind: PostizErrorKind, markers?: readonly string[]): PostizErrorEntry => ({ message, kind, platform: "youtube", ...(markers ? { markers } : {}) });

/** The table, in Postiz's order within each provider. */
export const POSTIZ_ERRORS: readonly PostizErrorEntry[] = [
  // instagram.provider.ts handleErrors()
  ig("An unknown error occurred, please try again later", "other", ["An unknown error occurred"]),
  ig("This account doesn't support Trial Reels", "trialUnsupported", ["2207081"]),
  ig("Instagram Trial Reel publish limit reached for this account, please try again later or publish the post as a regular Reel", "trialLimit", ["2207078"]),
  ig("Something is wrong with your connected user, please re-authenticate", "accountHealth", ["REVOKED_ACCESS_TOKEN", '"error_subcode":33']),
  ig("Your Instagram account is not a business account, please convert it to a business account", "other", undefined, ["the user is not an instagram business"]),
  ig("You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again", "accountHealth", undefined, ["session has been invalidated"]),
  ig("Instagram user is restricted", "accountHealth", ["2207050"]),
  ig("Timeout downloading media, please try again", "media", ["2207003"]),
  ig("Media expired, please upload again", "media", ["2207020"]),
  ig("Failed to create media, please try again", "media", ["2207032"]),
  ig("Instagram failed to upload the video. If it exceeds Instagram's limits (300MB, 1920px width, 25Mbps bitrate), export a smaller version and try again", "media", ["2207053"]),
  ig("Media fetch failed, please try again", "media", ["2207052"]),
  ig("Invalid thumbnail offset for video", "media", ["2207057"]),
  ig("Unsupported video format", "media", ["2207026"]),
  ig("Unknown media type", "media", ["2207023"]),
  ig("Media not found, please upload again", "media", ["2207006"]),
  ig("Media builder expired, please try again", "media", ["2207008"]),
  ig("Carousel validation failed", "media", ["2207028"]),
  ig("Caption is too long", "other", ["2207010"]),
  ig("Product tag positions not supported for videos", "other", ["2207035"]),
  ig("Product tag positions required for photos", "other", ["2207036"]),
  ig("Product tag validation failed", "other", ["2207037"]),
  ig("Too many product tags", "other", ["2207040"]),
  ig("Image is too large", "media", ["2207004"]),
  ig("Unsupported image format", "media", ["2207005"]),
  ig("Aspect ratio not supported, must be between 4:5 to 1.91:1", "media", ["2207009"]),
  ig("Page posting for today is limited, please try again tomorrow", "dailyLimit", ["Page request limit reached"]),
  ig("You have reached the maximum of 25 posts per day, allowed for your account", "dailyLimit", ["2207042"]),
  ig("Facebook rejected the post due to missing permissions. Make sure your Facebook account has full content access to the Page linked to this Instagram account, then reconnect the channel.", "other", ["(#200)"]),
  ig("Not enough permissions to post", "other", ["Not enough permissions to post"]),
  ig("Aspect ratio not supported, must be between 4:5 to 1.91:1", "media", ["36003"]),
  ig("Instagram requires you to log in at instagram.com and follow its instructions before posting can resume. After that, please reconnect this channel.", "accountHealth", ["You cannot access the app till you log in to", "Session key is malformed"]),
  ig("The account is missing some permissions to perform this action, please re-add the account and allow all permissions", "other", ["190,"]),
  ig("Invalid Instagram image resolution max: 1920x1080px", "media", ["36001"]),
  ig("Instagram blocked your request", "accountHealth", ["2207051"]),
  ig("Instagram detected that your post is spam, please try again with different content", "accountHealth", ["2207001"]),
  ig("Instagram did not add the comment, the post itself was published. Please try again with different comment text", "other", ["1772107"]),
  ig("Instagram could not process this video. If you attached audio to a video that has no sound track, set the original video volume to 0 and try again", "media", ["2207082"]),
  ig("Instagram could not process the video, please check the video format, duration and resolution and try again", "media", ["2207085"]),
  ig("Instagram Video download failed", "media", ["2207077"]),
  ig("Instagram carousel should have between 2 and 10 media attachments", "media", ["too little or too many attachments"]),
  ig("Unknown error, please try again later or contact support", "other", ["2207027"]),
  ig("One of the collaborators could not be tagged, please check the username is correct, the account is public, and that it allows collaborator invites", "other", ["2207018"]),
  ig("Collaborators are not allowed for carousel", "other", ["param collaborators is not allowed"]),
  // instagram.provider.ts checkValidity(): refused when the post is created
  ig("Should have at least one media", "media"),
  ig("Instagram carousel only supports up to 10 media attachments", "media"),
  ig("Trial Reels can only have one video", "media"),
  ig("Trial Reels must be a video", "media"),
  ig("Audio can only be added to Reels, not to Stories", "other"),
  ig("Audio can only be added to a single video Reel", "other"),
  ig("Audio can only be added to a video Reel", "other"),
  // youtube.provider.ts handleErrors()
  yt("The maximum allowed is 500 characters in total.", "other", ["invalidTags"]),
  yt("We have uploaded your video but we could not set the title. Title is too long.", "other", ["invalidTitle"]),
  yt("Your video description is invalid, it may contain disallowed characters such as < or >.", "other", ["invalidDescription"]),
  yt("The selected video category is invalid.", "other", ["invalidCategoryId"]),
  yt("The scheduled publishing time is invalid.", "other", ["invalidPublishAt"]),
  yt("The recording details for the video are invalid.", "other", ["invalidRecordingDetails"]),
  yt("The video game rating is invalid.", "other", ["invalidVideoGameRating"]),
  yt("The video file name is invalid.", "media", ["invalidFilename"]),
  yt("We could not set the localized video details because no default language is set.", "other", ["defaultLanguageNotSet"]),
  yt("Some of the video details are invalid, please review the title, description and tags.", "other", ["invalidVideoMetadata"]),
  yt("The video file is missing or could not be read, please re-upload the video.", "media", ["mediaBodyRequired"]),
  yt("We have uploaded your video but the thumbnail format is not supported, please use JPEG or PNG.", "media", ["imageFormatUnsupported"]),
  yt("We have uploaded your video but the thumbnail image is too tall.", "media", ["imageTooTall"]),
  yt("We have uploaded your video but the thumbnail image is too wide.", "media", ["imageTooWide"]),
  // Postiz's own project quota on YouTube, not the account's
  yt("YouTube's daily upload quota is exhausted for today, please reschedule this post for a later time.", "other", ["defaultVideoInsertPerDayPerProject"]),
  yt("You are sending requests too quickly, please wait a little while and try again.", "other", ["rateLimitExceeded"]),
  yt("We have uploaded your video but we could not set the thumbnail. Thumbnail size is too large.", "media", ["failedPrecondition"]),
  yt("You have reached your daily upload limit, please try again tomorrow.", "dailyLimit", ["uploadLimitExceeded"]),
  yt("You have to link your youtube account to your google account first.", "other", ["youtubeSignupRequired"]),
  yt("Your video was uploaded to YouTube successfully, but we could not set the thumbnail: custom thumbnails require a phone-verified YouTube channel. Verify your channel at youtube.com/verify, and set this video's thumbnail manually in YouTube Studio.", "media", ["youtube.thumbnail"]),
  yt("Token expired or invalid, please reconnect your YouTube account.", "accountHealth", ["Unauthorized"]),
  yt("Please re-authenticate your YouTube account", "accountHealth", ["UNAUTHENTICATED", "invalid_grant"]),
  // youtube.provider.ts: the upload's own sentences
  yt("Could not determine the video size for the YouTube upload", "media"),
  yt("The media storage did not return the requested byte range, please try again", "media"),
  yt("The upload session expired before the video was uploaded, please post again", "media"),
  yt("Failed to check the video upload status", "media"),
  yt("Could not start the video upload, please try again", "media"),
  yt("Failed to upload the video to YouTube", "media"),
  yt("The video upload took too long, please try a smaller video", "media"),
  // social.abstract.ts
  { message: "We could not read the media for this post, so it was not published", kind: "media", platform: "any" },
];

/** A matched text: its kind, the entry, and how it matched (the sentence itself, or a marker of the platform's answer). */
export interface PostizErrorMatch {
  kind: PostizErrorKind | "unknown";
  entry: PostizErrorEntry | null;
  by: "message" | "marker" | null;
}

const UNKNOWN: PostizErrorMatch = { kind: "unknown", entry: null, by: null };

/** The text as Postiz may store it: trimmed, spaces collapsed, and a JSON string's quotes removed (changeState stringifies a non-string). */
function cleanText(text: string): string {
  let t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(t);
      if (typeof parsed === "string") t = parsed.trim();
    } catch {
      // not a JSON string: keep it as it is
    }
  }
  return t.replace(/\s+/g, " ");
}

/** Whether `marker` is in `text`, a leading or trailing digit of the marker being a whole-number edge ("2207051" is not in "22070510"). */
function hasMarker(text: string, marker: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(marker, from);
    if (at < 0) return false;
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + marker.length] ?? "";
    const leadOk = !/\d/.test(marker[0]) || !/\d/.test(before);
    const tailOk = !/\d/.test(marker[marker.length - 1]) || !/\d/.test(after);
    if (leadOk && tailOk) return true;
    from = at + 1;
  }
}

/**
 * The provider family of a Postiz identifier, for the markers (a sentence matches whatever the platform). It is the approval
 * card's familyOf (lib/desktop/socialCard.ts) for the two families the table knows, null for the rest: a copy, as this file
 * imports nothing, which tests/postizErrors.test.ts keeps equal across Postiz's provider identifiers.
 */
export function familyOfPlatform(platform: string | null | undefined): "instagram" | "youtube" | null {
  if (platform === "instagram" || platform === "instagram-standalone") return "instagram";
  if (platform === "youtube") return "youtube";
  return null;
}

/** Messages longest first, so a sentence that holds a shorter one is matched as itself. */
const BY_LENGTH = [...POSTIZ_ERRORS].sort((a, b) => b.message.length - a.message.length);

/**
 * What a post's error text means. First Postiz's sentence (exactly, then held inside a longer text), then the markers of the
 * platform's own answer in Postiz's order (only the post's own provider's markers when the platform is given). Empty or
 * missing text, or anything else, is "unknown".
 */
export function classifyPostizError(text: string | null | undefined, platform?: string | null): PostizErrorMatch {
  if (typeof text !== "string") return UNKNOWN;
  const t = cleanText(text);
  if (!t) return UNKNOWN;
  const exact = POSTIZ_ERRORS.find((e) => e.message === t);
  if (exact) return { kind: exact.kind, entry: exact, by: "message" };
  const held = BY_LENGTH.find((e) => t.includes(e.message));
  if (held) return { kind: held.kind, entry: held, by: "message" };
  const family = familyOfPlatform(platform);
  const lower = t.toLowerCase();
  for (const e of POSTIZ_ERRORS) {
    if (family && e.platform !== family && e.platform !== "any") continue;
    if (e.markers?.some((m) => hasMarker(t, m)) || e.lowerMarkers?.some((m) => lower.includes(m))) return { kind: e.kind, entry: e, by: "marker" };
  }
  return UNKNOWN;
}

/** The kind of a post's error text ("unknown" when the table does not know it). */
export function postizErrorKind(text: string | null | undefined, platform?: string | null): PostizErrorKind | "unknown" {
  return classifyPostizError(text, platform).kind;
}

/** Whether a kind is about the account (a warning from the platform, a login to renew, the day's limit). */
export function isAccountHealth(kind: PostizErrorKind | "unknown"): boolean {
  return kind !== "unknown" && ACCOUNT_HEALTH_KINDS.includes(kind);
}

// --- end autonomy ---
