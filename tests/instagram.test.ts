import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GRAPH_HOST,
  DEFAULT_GRAPH_VERSION,
  InstagramError,
  containerStatusRequest,
  createReelContainerRequest,
  graphErrorMessage,
  instagramConfigFromEnv,
  permalinkRequest,
  publicVideoUrl,
  publishReel,
  publishRequest,
  redact,
  type InstagramConfig,
} from "@/lib/bot/instagram";

/** The Instagram Graph API request builders and the two-step Reel publishing flow, with a mocked fetch. */

const config: InstagramConfig = { userId: "17841400000000000", accessToken: "SECRET-TOKEN/with+chars" };
const reel = { videoUrl: "https://cdn.example.com/bot/ep001-1-ring-escape-42.mp4", caption: "Can it escape? 👇\n\n#bouncingball #reels" };

type Call = { url: string; method: string; body?: string };

/** A fetch that answers from a list of scripted responses and records every call. */
function mockFetch(responses: { status?: number; json: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    const status = next.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => next.json };
  });
  return { fetchImpl, calls };
}

describe("request builders", () => {
  it("step 1: a REELS container from a public video URL, the token in the body", () => {
    const r = createReelContainerRequest(config, { ...reel, thumbOffsetMs: 1500 });
    expect(r.method).toBe("POST");
    expect(r.url).toBe(`${DEFAULT_GRAPH_HOST}/${DEFAULT_GRAPH_VERSION}/17841400000000000/media`);
    expect(r.url).not.toContain("SECRET");
    expect(r.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(r.body);
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe(reel.videoUrl);
    expect(body.get("caption")).toBe(reel.caption);
    expect(body.get("share_to_feed")).toBe("true");
    expect(body.get("thumb_offset")).toBe("1500");
    expect(body.get("access_token")).toBe(config.accessToken);
    expect(new URLSearchParams(createReelContainerRequest(config, { ...reel, shareToFeed: false }).body).get("share_to_feed")).toBe("false");
  });

  it("step 2: the container status, publishing it, the permalink; another version and host", () => {
    const status = containerStatusRequest(config, "C123");
    expect(status.method).toBe("GET");
    const url = new URL(status.url);
    expect(url.pathname).toBe(`/${DEFAULT_GRAPH_VERSION}/C123`);
    expect(url.searchParams.get("fields")).toBe("status_code,status");
    expect(url.searchParams.get("access_token")).toBe(config.accessToken);
    const publish = publishRequest(config, "C123");
    expect(publish.method).toBe("POST");
    expect(publish.url).toBe(`${DEFAULT_GRAPH_HOST}/${DEFAULT_GRAPH_VERSION}/17841400000000000/media_publish`);
    expect(new URLSearchParams(publish.body).get("creation_id")).toBe("C123");
    expect(new URL(permalinkRequest(config, "M9").url).searchParams.get("fields")).toBe("permalink");
    const other = createReelContainerRequest({ ...config, graphVersion: "v24.0", host: "https://graph.instagram.com/" }, reel);
    expect(other.url).toBe("https://graph.instagram.com/v24.0/17841400000000000/media");
  });

  it("settings from the environment, the public video URL and redaction", () => {
    expect(instagramConfigFromEnv({}).missing).toEqual(["IG_USER_ID", "IG_ACCESS_TOKEN", "BOT_VIDEO_BASE_URL"]);
    expect(instagramConfigFromEnv({}).config).toBeNull();
    const full = instagramConfigFromEnv({ IG_USER_ID: " 1 ", IG_ACCESS_TOKEN: "t", BOT_VIDEO_BASE_URL: "https://x/y/", IG_GRAPH_VERSION: "v22.0" });
    expect(full.missing).toEqual([]);
    expect(full.config).toEqual({ userId: "1", accessToken: "t", graphVersion: "v22.0", host: undefined });
    expect(full.videoBaseUrl).toBe("https://x/y/");
    expect(instagramConfigFromEnv({ IG_USER_ID: "1", IG_ACCESS_TOKEN: "t" }).missing).toEqual(["BOT_VIDEO_BASE_URL"]);
    expect(publicVideoUrl("https://x/y/", "ep001-1 a#b.mp4")).toBe("https://x/y/ep001-1%20a%23b.mp4");
    expect(redact(`token=${config.accessToken}&x=${encodeURIComponent(config.accessToken)}`, config.accessToken)).toBe("token=***&x=***");
    expect(graphErrorMessage({ error: { message: "Invalid token", type: "OAuthException", code: 190 } })).toBe("Invalid token (OAuthException 190)");
    expect(graphErrorMessage({ id: "1" })).toBeNull();
  });
});

describe("publishReel", () => {
  it("creates the container, waits until it is FINISHED, publishes it and reads the permalink", async () => {
    const { fetchImpl, calls } = mockFetch([{ json: { id: "C1" } }, { json: { status_code: "IN_PROGRESS" } }, { json: { status_code: "FINISHED" } }, { json: { id: "M1" } }, { json: { permalink: "https://www.instagram.com/reel/abc/" } }]);
    const sleep = vi.fn(async () => {});
    const statuses: string[] = [];
    const result = await publishReel(fetchImpl, config, reel, { sleep, pollMs: 10, onStatus: (s) => statuses.push(s) });
    expect(result).toEqual({ containerId: "C1", mediaId: "M1", permalink: "https://www.instagram.com/reel/abc/" });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([`POST /${DEFAULT_GRAPH_VERSION}/17841400000000000/media`, `GET /${DEFAULT_GRAPH_VERSION}/C1`, `GET /${DEFAULT_GRAPH_VERSION}/C1`, `POST /${DEFAULT_GRAPH_VERSION}/17841400000000000/media_publish`, `GET /${DEFAULT_GRAPH_VERSION}/M1`]);
    expect(statuses).toEqual(["IN_PROGRESS", "FINISHED"]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("stops at the step that failed, with the API's message and never the token", async () => {
    const bad = mockFetch([{ status: 400, json: { error: { message: `Invalid parameter ${config.accessToken}`, type: "OAuthException", code: 100 } } }]);
    const err = await publishReel(bad.fetchImpl, config, reel).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramError);
    expect(err.step).toBe("container");
    expect(err.status).toBe(400);
    expect(err.message).toContain("Invalid parameter");
    expect(err.message).not.toContain(config.accessToken);

    const failed = mockFetch([{ json: { id: "C2" } }, { json: { status_code: "ERROR", status: "Error: video too long" } }]);
    const err2 = await publishReel(failed.fetchImpl, config, reel, { sleep: async () => {} }).catch((e) => e);
    expect(err2.step).toBe("status");
    expect(err2.message).toContain("ERROR");
    expect(failed.calls).toHaveLength(2);

    const slow = mockFetch([{ json: { id: "C3" } }, { json: { status_code: "IN_PROGRESS" } }, { json: { status_code: "IN_PROGRESS" } }]);
    const err3 = await publishReel(slow.fetchImpl, config, reel, { sleep: async () => {}, maxPolls: 2 }).catch((e) => e);
    expect(err3.step).toBe("status");
    expect(err3.message).toContain("C3");

    const offline = vi.fn(async () => {
      throw new Error(`getaddrinfo ENOTFOUND (token ${config.accessToken})`);
    });
    const err4 = await publishReel(offline, config, reel).catch((e) => e);
    expect(err4.step).toBe("container");
    expect(err4.message).toContain("Network error");
    expect(err4.message).not.toContain(config.accessToken);

    const noId = mockFetch([{ json: { id: "C4" } }, { json: { status_code: "FINISHED" } }, { json: {} }]);
    const err5 = await publishReel(noId.fetchImpl, config, reel, { sleep: async () => {} }).catch((e) => e);
    expect(err5.step).toBe("publish");
  });

  it("a missing permalink does not fail a published Reel", async () => {
    const { fetchImpl } = mockFetch([{ json: { id: "C5" } }, { json: { status_code: "FINISHED" } }, { json: { id: "M5" } }, { status: 500, json: {} }]);
    await expect(publishReel(fetchImpl, config, reel, { sleep: async () => {} })).resolves.toEqual({ containerId: "C5", mediaId: "M5", permalink: null });
  });
});
