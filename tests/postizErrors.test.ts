import { describe, expect, it } from "vitest";
import { ACCOUNT_HEALTH_KINDS, POSTIZ_ERRORS, POSTIZ_ERRORS_POSTIZ, POSTIZ_ERROR_KINDS, classifyPostizError, isAccountHealth, postizErrorKind } from "@/lib/desktop/postizErrors";

/*
 * --- autonomy --- Postiz's own error sentences (lib/desktop/postizErrors.ts): the literal strings of Postiz v2.25.3's
 * instagram.provider.ts and youtube.provider.ts map to their kinds, a text holding only the platform's code is matched by
 * the code, and a text the table does not know is "unknown" (Fully autonomous pauses on it).
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

  it("calls anything else unknown, Postiz's catch-all included", () => {
    for (const text of [null, undefined, "", "   ", "Unknown Error", "Something odd happened", "TikTok rejected the video"]) expect(postizErrorKind(text as string | null | undefined)).toBe("unknown");
    expect(classifyPostizError("Something odd happened")).toEqual({ kind: "unknown", entry: null, by: null });
    expect(isAccountHealth("unknown")).toBe(false);
  });
});

// --- end autonomy ---
