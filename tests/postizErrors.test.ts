import { describe, expect, it } from "vitest";
import { ACCOUNT_HEALTH_KINDS, POSTIZ_ERRORS, POSTIZ_ERRORS_POSTIZ, POSTIZ_ERROR_KINDS, TIKTOK_APP_PRIVATE_ONLY, TIKTOK_PAUSE_KINDS, classifyPostizError, familyOfPlatform, isAccountHealth, postizErrorKind } from "@/lib/desktop/postizErrors";
import { familyOf } from "@/lib/desktop/socialCard";
import { importsOf, mainBundleInputs } from "./mainBundle";

/*
 * --- autonomy --- Postiz's own error sentences (lib/desktop/postizErrors.ts): the literal strings of Postiz v2.25.3's
 * instagram.provider.ts, youtube.provider.ts and tiktok.provider.ts map to their kinds, a text holding only the platform's
 * code is matched by the code, and a text the table does not know is "unknown" (Fully autonomous pauses on it).
 */

// --- autonomy ---

describe("Postiz's error table", () => {
  it("is pinned to Postiz 2.25.3, with closed kinds and no sentence twice under two kinds", () => {
    expect(POSTIZ_ERRORS_POSTIZ).toBe("2.25.3");
    for (const e of POSTIZ_ERRORS) expect(POSTIZ_ERROR_KINDS).toContain(e.kind);
    const kinds = new Map<string, string>();
    for (const e of POSTIZ_ERRORS) {
      if (kinds.has(e.message)) expect(kinds.get(e.message), e.message).toBe(e.kind);
      kinds.set(e.message, e.kind);
    }
    expect(ACCOUNT_HEALTH_KINDS).toEqual(["accountHealth", "dailyLimit"]);
  });

  it("maps the Trial Reel sentences to their kinds", () => {
    expect(postizErrorKind("This account doesn't support Trial Reels")).toBe("trialUnsupported");
    expect(postizErrorKind("Instagram Trial Reel publish limit reached for this account, please try again later or publish the post as a regular Reel")).toBe("trialLimit");
  });

  it("maps every account warning the plan names to an account-health kind", () => {
    const health = [
      "Instagram blocked your request",
      "Instagram detected that your post is spam, please try again with different content",
      "Instagram user is restricted",
      "Something is wrong with your connected user, please re-authenticate",
      "You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again",
      "Instagram requires you to log in at instagram.com and follow its instructions before posting can resume. After that, please reconnect this channel.",
      "You have reached the maximum of 25 posts per day, allowed for your account",
      "Page posting for today is limited, please try again tomorrow",
      "Token expired or invalid, please reconnect your YouTube account.",
      "Please re-authenticate your YouTube account",
      "You have reached your daily upload limit, please try again tomorrow.",
    ];
    for (const text of health) {
      const kind = postizErrorKind(text);
      expect(isAccountHealth(kind), text).toBe(true);
    }
    expect(postizErrorKind("Instagram blocked your request")).toBe("accountHealth");
    expect(postizErrorKind("You have reached the maximum of 25 posts per day, allowed for your account")).toBe("dailyLimit");
  });

  it("keeps media and other sentences apart from the account's health", () => {
    for (const text of ["Unsupported video format", "Media expired, please upload again", "Failed to upload the video to YouTube", "We could not read the media for this post, so it was not published"]) {
      expect(postizErrorKind(text), text).toBe("media");
      expect(isAccountHealth(postizErrorKind(text)), text).toBe(false);
    }
    expect(postizErrorKind("Caption is too long")).toBe("other");
    expect(postizErrorKind("An unknown error occurred, please try again later")).toBe("other");
  });

  it("matches a sentence stored as a JSON string, with spaces, or inside a longer text", () => {
    expect(postizErrorKind('"Instagram blocked your request"')).toBe("accountHealth");
    expect(postizErrorKind("  Instagram   blocked your request \n")).toBe("accountHealth");
    expect(classifyPostizError("Error: Instagram user is restricted (code 2207050)").by).toBe("message");
    expect(postizErrorKind("Error: Instagram user is restricted (code 2207050)")).toBe("accountHealth");
  });

  it("matches a text holding only the platform's code by the code, as a whole number, on its own provider", () => {
    const meta = '{"error":{"message":"Action is blocked","code":-1,"error_subcode":2207051}}';
    expect(classifyPostizError(meta)).toMatchObject({ kind: "accountHealth", by: "marker" });
    expect(postizErrorKind('{"error_subcode":2207081}', "instagram")).toBe("trialUnsupported");
    expect(postizErrorKind('{"error_subcode":2207078}', "instagram-standalone")).toBe("trialLimit");
    expect(postizErrorKind('{"error":{"type":"OAuthException","code":190,"error_subcode":460}}', "instagram")).toBe("other");
    expect(postizErrorKind('{"error":{"code":1,"error_subcode":33}}', "instagram")).toBe("accountHealth");
    // a longer number is not the code
    expect(postizErrorKind("upload 22070510 failed", "instagram")).toBe("unknown");
    expect(postizErrorKind('{"error":{"error_subcode":330}}', "instagram")).toBe("unknown");
    // YouTube's markers on YouTube, Instagram's on Instagram
    expect(postizErrorKind('{"reason":"uploadLimitExceeded"}', "youtube")).toBe("dailyLimit");
    expect(postizErrorKind('{"reason":"uploadLimitExceeded"}', "instagram")).toBe("unknown");
    expect(postizErrorKind('{"code":2207051}', "youtube")).toBe("unknown");
    expect(postizErrorKind('{"code":"rateLimitExceeded"}', "youtube")).toBe("other");
    // Postiz lowercases the answer for two of its phrases
    expect(postizErrorKind("Error validating access token: The session has been invalidated because the user changed their password", "instagram")).toBe("accountHealth");
  });

  // the owner's answer of 30 Oct 2026: TikTok posts on its own too, so the app must know what Postiz's TikTok provider says
  // (tiktok.provider.ts at v2.25.3, unchanged at main of 28 Oct 2026, read 30 Oct 2026)
  it("maps every sentence of Postiz's TikTok provider to its kind", () => {
    const tiktok: [string, string][] = [
      ["Access token invalid, please re-authenticate your TikTok account", "accountFix"],
      ["Missing required permissions, please re-authenticate with all scopes", "accountFix"],
      ["Additional permissions required, please re-authenticate", "accountFix"],
      // TikTok's limit on the account's own access token (a few requests a minute), not on the app Postiz posts through
      ["TikTok API rate limit exceeded, please try again later", "rateLimit"],
      ["File format is invalid, please check video specifications", "media"],
      ["In order to use the TikTok upload feature, you have to update your app to the latest version", "accountFix"],
      ["Video duration is invalid, please check video specifications", "media"],
      ["Video frame rate is invalid, please check video specifications", "media"],
      ["Failed to pull video from URL, please check the URL", "media"],
      ["Failed to pull photo from URL, please check the URL", "media"],
      ["Account banned from posting, please check TikTok account status", "accountHealth"],
      ["TikTok detected potential spam in the post text", "accountHealth"],
      ["TikTok says your daily post limit reached, please try again tomorrow", "dailyLimit"],
      ["TikTok limits pending posts to 5 within any 24-hour period. Please check your TikTok inbox in the TikTok mobile app and try again after 24 hours.", "dailyLimit"],
      ["TikTok detected potential spam", "accountHealth"],
      ["TikTok daily user limit reached, please re-connect your account", "app"],
      ["App not approved for public posting, contact support", "app"],
      ["You have to upload the picture/video to Postiz when sending a URL", "media"],
      ["Privacy level mismatch, please check privacy settings", "privacy"],
      ["Invalid file format or specifications not met", "media"],
      ["Invalid request parameters, please check content format", "other"],
      ["There is a problem with TikTok servers, please try again later", "other"],
      ["Media size not supported by TikTok: images up to 1080px on the shorter side, videos at least 360px on both sides", "media"],
      ["TikTok API error, please try again", "other"],
      ["Failed to upload the video to TikTok", "media"],
      ["The media storage did not return the requested byte range, please try again", "media"],
      ["TikTok refused to publish your post", "other"],
      ["No video / images selected", "media"],
      ["Only pictures are supported when selecting multiple items", "media"],
      ["You need one media", "media"],
    ];
    for (const [text, kind] of tiktok) {
      expect(classifyPostizError(text, "tiktok"), text).toMatchObject({ kind, by: "message" });
      expect(postizErrorKind(text), text).toBe(kind);
    }
    expect(POSTIZ_ERRORS.filter((e) => e.platform === "tiktok").length + 1).toBe(tiktok.length); // the byte-range sentence is shared
    expect(POSTIZ_ERRORS.find((e) => e.message === "The media storage did not return the requested byte range, please try again")?.platform).toBe("any");
    expect(TIKTOK_APP_PRIVATE_ONLY).toBe("App not approved for public posting, contact support");
    expect(TIKTOK_PAUSE_KINDS).toEqual(["accountHealth", "dailyLimit", "accountFix", "app", "rateLimit", "privacy"]);
    expect(isAccountHealth("rateLimit")).toBe(false);
    // the longer spam sentence is itself, not the shorter one it holds
    expect(classifyPostizError("TikTok detected potential spam in the post text").entry?.message).toBe("TikTok detected potential spam in the post text");
  });

  it("matches a TikTok answer holding only its reason by the marker, in Postiz's order, and only on a TikTok post", () => {
    const status = (reason: string) => JSON.stringify({ data: { status: "FAILED", fail_reason: reason } });
    expect(classifyPostizError(status("spam_risk_too_many_posts"), "tiktok")).toMatchObject({ kind: "dailyLimit", by: "marker" });
    expect(classifyPostizError(status("spam_risk_too_many_pending_share"), "tiktok")).toMatchObject({ kind: "dailyLimit", by: "marker" });
    expect(classifyPostizError(status("spam_risk_user_banned_from_posting"), "tiktok")).toMatchObject({ kind: "accountHealth", by: "marker" });
    expect(classifyPostizError(status("spam_risk"), "tiktok")).toMatchObject({ kind: "accountHealth", by: "marker" });
    expect(classifyPostizError(status("privacy_level_option_mismatch"), "tiktok")).toMatchObject({ kind: "privacy", by: "marker" });
    expect(classifyPostizError(status("unaudited_client_can_only_post_to_private_accounts"), "tiktok")).toMatchObject({ kind: "app", by: "marker", entry: { message: TIKTOK_APP_PRIVATE_ONLY } });
    expect(classifyPostizError(status("reached_active_user_cap"), "tiktok")).toMatchObject({ kind: "app", by: "marker" });
    expect(classifyPostizError(status("rate_limit_exceeded"), "tiktok")).toMatchObject({ kind: "rateLimit", by: "marker" });
    // Postiz checks the privacy before its catch-all "internal"
    expect(postizErrorKind('{"error":{"code":"privacy_level_option_mismatch","message":"internal check"}}', "tiktok")).toBe("privacy");
    // TikTok's plain words are no marker elsewhere: an unknown text that holds them stays unknown (fail closed)
    expect(postizErrorKind('{"error":{"code":"internal"}}', "tiktok")).toBe("other");
    expect(postizErrorKind('{"error":{"code":"internal"}}', "instagram")).toBe("unknown");
    expect(postizErrorKind('{"error":{"code":"internal"}}')).toBe("unknown");
    expect(postizErrorKind(status("spam_risk"), "youtube")).toBe("unknown");
    expect(postizErrorKind(status("spam_risk"), "tiktok-business")).toBe("unknown");
    // a FAILED status Postiz does not map comes back with no text
    expect(postizErrorKind("", "tiktok")).toBe("unknown");
    expect(postizErrorKind("TikTok rejected the video", "tiktok")).toBe("unknown");
  });

  // social.abstract.ts at v2.25.3: TikTok's upload asks the media's size with a HEAD request (mediaSize) and reads a local file
  // only inside Postiz's upload folder (localMediaPath); both throw a bad body, so GET /posts shows them
  it("knows the media sentences TikTok's upload reads through, on every platform", () => {
    for (const text of ["Could not determine the media size for upload", "The media for this post is not in the upload directory, so it was not published"]) {
      for (const platform of ["tiktok", "instagram", "youtube", null]) expect(classifyPostizError(text, platform), `${text} on ${platform}`).toMatchObject({ kind: "media", by: "message" });
      expect(POSTIZ_ERRORS.find((e) => e.message === text)?.platform).toBe("any");
    }
  });

  // public.integrations.controller.ts: POST /posts refuses a text past the provider's maxLength (2000 on TikTok) before it
  // creates anything, with a 400 whose body holds the sentence
  it("names the public route's refusal of a text that is too long, in the 400's body too", () => {
    expect(classifyPostizError("post is too long, please fix it", "tiktok")).toMatchObject({ kind: "other", by: "message" });
    expect(postizErrorKind(JSON.stringify({ statusCode: 400, provider: "tiktok", name: "jbl", message: "post is too long, please fix it" }), "tiktok")).toBe("other");
    expect(POSTIZ_ERRORS.find((e) => e.message === "post is too long, please fix it")?.platform).toBe("any");
  });

  it("calls anything else unknown, Postiz's catch-all included", () => {
    for (const text of [null, undefined, "", "   ", "Unknown Error", "Something odd happened", "TikTok rejected the video"]) expect(postizErrorKind(text as string | null | undefined)).toBe("unknown");
    expect(classifyPostizError("Something odd happened")).toEqual({ kind: "unknown", entry: null, by: null });
    expect(isAccountHealth("unknown")).toBe(false);
  });
});

describe("what the main process bundles", () => {
  // the provider identifiers of Postiz 2.25.3 (libraries/nestjs-libraries/src/integrations/social/*.provider.ts), and a stray one
  const POSTIZ_IDENTIFIERS = ["bluesky", "devto", "discord", "dribbble", "facebook", "gmb", "hashnode", "instagram", "instagram-standalone", "kick", "lemmy", "linkedin", "linkedin-page", "listmonk", "mastodon", "mastodon-custom", "medium", "mewe", "moltbook", "nostr", "pinterest", "reddit", "skool", "slack", "telegram", "threads", "tiktok", "tiktok-business", "tumblr", "twitch", "vk", "whop", "wordpress", "wrapcast", "x", "youtube", "Instagram", ""];

  // its own copy of the card's familyOf (the file imports nothing): a family the card learns, or loses, fails here first
  it("reads Postiz's provider identifiers as the approval card does, for the three families its markers belong to", () => {
    for (const id of POSTIZ_IDENTIFIERS) {
      const card = familyOf(id);
      // TikTok is the table's third family since the owner's answer of 30 Oct 2026; tiktok-business stays outside it
      expect(familyOfPlatform(id), id).toBe(card === "instagram" || card === "youtube" || card === "tiktok" ? card : null);
    }
    expect(familyOfPlatform("tiktok")).toBe("tiktok");
    expect(familyOfPlatform("tiktok-business")).toBeNull();
    expect(familyOfPlatform(null)).toBeNull();
    expect(familyOfPlatform(undefined)).toBeNull();
  });

  it("imports nothing, so the app's main process bundles the file alone", async () => {
    expect(importsOf("src/lib/desktop/postizErrors.ts")).toEqual([]);
    expect(await mainBundleInputs("src/lib/desktop/postizErrors.ts")).toEqual(["src/lib/desktop/postizErrors.ts"]);
  });
});

// --- end autonomy ---
