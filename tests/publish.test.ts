import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { composeAll, composePost, editDraft, emptyDraft, fieldsFor, hasOverrides, normalizeHashtag, parseDraft, parseHashtagInput, platformHashtags, resetPlatform, utf8Bytes, withoutPlatformTags, youtubeTags, type PublishDraft } from "@/lib/publish/caption";
import { MAX_CLIPS, clipExtension, clipFileName, offerPublishClip, publishClips, resetPublishClips, subscribePublishClips } from "@/lib/publish/clips";
import { PublishController, accountViews, sendPlan, type ControllerDeps } from "@/lib/publish/controller";
import { defaultDraft, draftFromBotClip, modeHashtags, recipeForMode } from "@/lib/publish/copy";
import { LIMITS, UPLOAD_PAGES } from "@/lib/publish/platforms";
import { RelayClient, RelayError, fetchSendForm, jobFinished, normalizeRelayUrl, parseRelayAccount, parseRelayJob, relayErrorFor } from "@/lib/publish/relayClient";
import { canShareFile, isPhoneLike, quickShare, shareText, type ShareEnv, type ShareNavigator } from "@/lib/publish/share";
import { PUBLISH_STORAGE_KEY, RECENT_MAX, addRecent, defaultPublishState, loadPublishState, parsePublishState, relayKey, savePublishState, youtubeKey, type RecentSend } from "@/lib/publish/store";
import { YT_UPLOAD_SCOPE, YouTubeError, fetchMyChannel, nextOffsetFromRange, resumableStartUrl, startResumableSession, tokenFromResponse, uploadResumable, uploadToYouTube, youtubeErrorFor, type FetchLike } from "@/lib/publish/youtube";

/*
 * --- social-publish --- The Publish block's logic: the words per platform and their limits, the first draft from the bot's
 * copy, the relay client, the quick share's two paths, the YouTube resumable upload, what the browser remembers, the clip
 * inbox and a whole "Send to selected" through the controller – every network call against a mocked fetch.
 */

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fetch answering from handlers (method + URL test), recording every call. */
function mockFetch(handlers: { method?: string; url: string | RegExp; reply: (call: Call, calls: Call[]) => Response | Promise<Response> }[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = { url: String(url), method: String(init.method ?? "GET").toUpperCase(), headers: (init.headers as Record<string, string>) ?? {}, body: init.body };
    calls.push(call);
    for (const h of handlers) {
      if (h.method && h.method !== call.method) continue;
      if (typeof h.url === "string" ? !call.url.startsWith(h.url) : !h.url.test(call.url)) continue;
      return h.reply(call, calls);
    }
    throw new TypeError(`Failed to fetch ${call.method} ${call.url}`);
  });
  return { fetchImpl: fetchImpl as unknown as FetchLike, calls };
}

const draft = (patch: Partial<PublishDraft> = {}): PublishDraft => ({ ...emptyDraft(), title: "Can it escape?", caption: "Ring escape\n\nHow many walls?", hashtags: "#ringescape satisfying, #fyp", ...patch });

describe("hashtags and the words per platform", () => {
  it("normalises hashtags and drops repeats", () => {
    expect(normalizeHashtag("##Ball-Escape!")).toBe("#BallEscape");
    expect(normalizeHashtag("#piłka_ñ")).toBe("#piłka_ñ");
    expect(normalizeHashtag("###")).toBeNull();
    expect(parseHashtagInput("#a b, #A; c  #b")).toEqual(["#a", "#b", "#c"]);
    expect(withoutPlatformTags(["#fyp", "#ball", "#Reels", "#SHORTS", "#x"])).toEqual(["#ball", "#x"]);
    expect(platformHashtags("#ball #fyp", "tiktok")).toEqual(["#ball", "#fyp"]);
    expect(platformHashtags("#ball", "instagram")).toEqual(["#ball", "#reels"]);
    expect(platformHashtags("#ball #shorts", "youtube")).toEqual(["#Shorts", "#ball"]);
    expect(platformHashtags("#ball #fyp #reels", "youtube")).toEqual(["#Shorts", "#ball"]);
    expect(platformHashtags("#ball #fyp #reels", "tiktok")).toEqual(["#ball", "#fyp"]);
  });

  it("composes TikTok and Instagram captions with the hashtags and counts them", () => {
    const tt = composePost(draft(), "tiktok");
    expect(tt.text).toBe("Ring escape\n\nHow many walls?\n\n#ringescape #satisfying #fyp");
    expect(tt.counters).toEqual([{ id: "caption", used: tt.text.length, max: 2200, unit: "chars", over: false }]);
    expect(tt.ok).toBe(true);
    const ig = composePost(draft(), "instagram");
    // #fyp is TikTok's: Instagram gets #reels instead.
    expect(ig.text.endsWith("#ringescape #satisfying #reels")).toBe(true);
    expect(ig.counters.map((c) => [c.id, c.used, c.max])).toEqual([
      ["caption", [...ig.text].length, 2200],
      ["hashtags", 3, 30],
    ]);
    // 31 hashtags are too many for Instagram, fine for TikTok.
    const many = draft({ hashtags: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") });
    expect(composePost(many, "instagram").ok).toBe(false);
    expect(composePost(many, "tiktok").ok).toBe(true);
    // 2,200 is the limit: one character more is over.
    const long = draft({ caption: "x".repeat(2200 - " #fyp".length - "\n\n#ringescape #satisfying".length), hashtags: "#ringescape #satisfying" });
    expect(composePost(long, "tiktok").counters[0].used).toBe(2200 - " #fyp".length + " #fyp".length);
    expect(composePost({ ...long, caption: `${long.caption}x` }, "tiktok").ok).toBe(false);
  });

  it("gives YouTube a clean title, a description with #Shorts first and tags within 500 characters", () => {
    const yt = composePost(draft({ title: "Can it <escape>?", caption: "Line <1>" }), "youtube");
    expect(yt.title).toBe("Can it escape?");
    expect(yt.text).toBe("Line 1\n\n#Shorts #ringescape #satisfying");
    expect(yt.tags).toEqual(["Shorts", "ringescape", "satisfying"]);
    expect(yt.counters.map((c) => c.id)).toEqual(["title", "description", "hashtags"]);
    // No title: the caption's first line. An empty or too long title is over.
    expect(composePost(draft({ title: "" }), "youtube").title).toBe("Ring escape");
    expect(composePost(draft({ title: "", caption: "" }), "youtube").ok).toBe(false);
    expect(composePost(draft({ title: "é".repeat(101) }), "youtube").ok).toBe(false);
    expect(composePost(draft({ title: "é".repeat(100) }), "youtube").ok).toBe(true);
    // The description limit is in bytes: 2,000 three-byte characters are over 5,000 bytes.
    expect(utf8Bytes("€")).toBe(3);
    expect(composePost(draft({ caption: "€".repeat(2000) }), "youtube").counters[1].over).toBe(true);
    const tags = youtubeTags(Array.from({ length: 80 }, (_, i) => `#tag${String(i).padStart(3, "0")}`));
    expect(tags.join(",").length).toBeLessThanOrEqual(LIMITS.youtube.tagsChars);
    expect(tags.length).toBe(71);
  });

  it("keeps per-platform overrides and drops them when they match the shared words again", () => {
    let d = draft();
    d = editDraft(d, "youtube", "title", "A title for YouTube");
    expect(fieldsFor(d, "youtube").title).toBe("A title for YouTube");
    expect(fieldsFor(d, "tiktok").title).toBe("Can it escape?");
    expect(hasOverrides(d, "youtube")).toBe(true);
    d = editDraft(d, "youtube", "title", "Can it escape?");
    expect(hasOverrides(d, "youtube")).toBe(false);
    d = editDraft(d, "instagram", "hashtags", "#only #ig");
    expect(composeAll(d).instagram.hashtags).toEqual(["#only", "#ig", "#reels"]);
    expect(composeAll(d).tiktok.hashtags).toEqual(["#ringescape", "#satisfying", "#fyp"]);
    d = editDraft(d, null, "caption", "Shared caption");
    expect(fieldsFor(d, "instagram").caption).toBe("Shared caption");
    expect(resetPlatform(d, "instagram").overrides).toEqual({});
    expect(parseDraft({ title: 1, caption: "c", overrides: { tiktok: { caption: "t", bogus: 1 }, myspace: {} } })).toEqual({ title: "", caption: "c", hashtags: "", overrides: { tiktok: { caption: "t" } } });
    expect(parseDraft(null)).toBeNull();
  });
});

describe("the first draft (the bot's copy)", () => {
  it("uses a bot clip's hook, series line, question, keywords and hashtags without platform tags", () => {
    const d = draftFromBotClip({ hook: "Can it escape in 24 seconds?", series: { name: "Ring Escape", label: "Ring Escape · Day 3", episode: 3, roster: [] }, post: { caption: "", question: "How many walls?", hashtags: ["#ringescape", "#reels", "#bouncingball"], keywords: "A bouncing ball escape.", note: "", time: "" } });
    expect(d.title).toBe("Can it escape in 24 seconds?");
    expect(d.caption).toBe("Can it escape in 24 seconds?\n\nRing Escape · Day 3\n\nHow many walls?\n\nA bouncing ball escape.");
    expect(d.hashtags).toBe("#ringescape #bouncingball");
  });

  it("writes a mode's copy from its bot recipe in every language, else a plain one", () => {
    for (const messages of [en, pl, es]) {
      const d = defaultDraft({ copy: messages.ViralBot, strings: { title: messages.Publish.defaultTitle, caption: messages.Publish.defaultCaption }, modeName: "Classic", mode: "classic", site: "JumpingBallsLive" });
      expect(d.title).toContain("Classic");
      expect(d.caption).toContain("JumpingBallsLive");
      expect(d.caption).not.toMatch(/\{\w+\}/);
      const tags = parseHashtagInput(d.hashtags);
      expect(tags.length).toBeGreaterThanOrEqual(5);
      expect(tags.length).toBeLessThanOrEqual(10);
      expect(tags.map((t) => t.toLowerCase())).not.toContain("#reels");
      expect(composePost(d, "youtube").ok && composePost(d, "tiktok").ok && composePost(d, "instagram").ok).toBe(true);
    }
    expect(recipeForMode("classic")?.id).toBe("ring-escape");
    expect(recipeForMode("paint")).toBeNull();
    // Power Layers' tags need clip numbers ({ruleTag}): those are left out.
    expect(modeHashtags(en.ViralBot, "powerLayers").some((t) => t.includes("{"))).toBe(false);
    const plain = defaultDraft({ copy: en.ViralBot, strings: { title: en.Publish.defaultTitle, caption: en.Publish.defaultCaption }, modeName: "Paint", mode: "paint", site: "JumpingBallsLive" });
    expect(plain.caption).toBe("Every bounce is a note. Made with JumpingBallsLive.");
    expect(plain.hashtags).toContain("#bouncingball");
  });
});

describe("the relay client", () => {
  const profile = { url: "https://relay.example/", key: "jbl_secret" };

  it("normalises relay URLs", () => {
    expect(normalizeRelayUrl(" relay.example.com/ ")).toBe("https://relay.example.com");
    expect(normalizeRelayUrl("http://localhost:8787/?x=1#y")).toBe("http://localhost:8787");
    expect(normalizeRelayUrl("ftp://x")).toBeNull();
    expect(normalizeRelayUrl("")).toBeNull();
    expect(() => new RelayClient({ url: "nope://", key: "k" }, { fetch: vi.fn() as unknown as FetchLike })).toThrow(RelayError);
  });

  it("reads the key's info and accounts with the key in the Authorization header", async () => {
    const { fetchImpl, calls } = mockFetch([
      { url: "https://relay.example/api/me", reply: () => json({ name: "jumpingballslive-relay", version: "1.0.0", key: { id: "k_1", label: "Team" }, platforms: { tiktok: true, instagram: true, youtube: false } }) },
      { url: "https://relay.example/api/accounts", reply: () => json({ accounts: [{ id: "a_1", platform: "tiktok", name: "Tok", handle: "@tok", avatar: null, status: "ok" }, { id: "a_2", platform: "instagram", name: "IG", status: "expired" }, { id: "bad", platform: "myspace" }] }) },
    ]);
    const client = new RelayClient(profile, { fetch: fetchImpl });
    expect(await client.info()).toEqual({ name: "jumpingballslive-relay", version: "1.0.0", key: { id: "k_1", label: "Team" }, platforms: { tiktok: true, instagram: true, youtube: false } });
    const accounts = await client.accounts();
    expect(accounts.map((a) => [a.id, a.platform, a.status])).toEqual([
      ["a_1", "tiktok", "ok"],
      ["a_2", "instagram", "expired"],
    ]);
    expect(calls.every((c) => c.headers.Authorization === "Bearer jbl_secret")).toBe(true);
    expect(parseRelayAccount({ id: "x", platform: "youtube" })?.name).toBe("YouTube");
  });

  it("maps the relay's errors and a network failure to messages that say what to do", async () => {
    expect(relayErrorFor(401, null).code).toBe("unauthorized");
    expect(relayErrorFor(413, { error: { code: "too_large", message: "too big" } }).message).toBe("too big");
    expect(relayErrorFor(400, { error: { code: "not_configured", message: "no keys" } }).code).toBe("notConfigured");
    expect(relayErrorFor(502, null).code).toBe("server");
    const { fetchImpl } = mockFetch([]);
    const err = await new RelayClient(profile, { fetch: fetchImpl }).accounts().catch((e) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect(err.code).toBe("network");
    expect(err.message).toMatch(/RELAY_ALLOWED_ORIGINS/);
  });

  it("asks for a one-time sign-in link, uploads the clip with the words and polls the job to its end", async () => {
    let polls = 0;
    const { fetchImpl, calls } = mockFetch([
      { method: "POST", url: "https://relay.example/api/connect/tiktok", reply: () => json({ url: "https://relay.example/connect/tiktok?state=abc" }) },
      { method: "POST", url: "https://relay.example/api/publish", reply: () => json({ jobId: "j_1", job: { id: "j_1", status: "running", items: [{ accountId: "a_1", platform: "tiktok", status: "queued" }] } }, { status: 202 }) },
      { method: "DELETE", url: "https://relay.example/api/accounts/a_9", reply: () => json({ ok: true }) },
      {
        method: "GET",
        url: "https://relay.example/api/jobs/j_1",
        reply: () => {
          polls++;
          if (polls === 2) throw new TypeError("network hiccup");
          if (polls < 4) return json({ id: "j_1", status: "running", items: [{ accountId: "a_1", platform: "tiktok", status: "uploading", progress: 0.5 }, { accountId: "a_2", platform: "youtube", status: "queued" }] });
          return json({ id: "j_1", status: "partial", items: [{ accountId: "a_1", platform: "tiktok", status: "published", progress: 1, link: "https://www.tiktok.com/@tok/video/1" }, { accountId: "a_2", platform: "youtube", status: "failed", error: "quota" }] });
        },
      },
    ]);
    const client = new RelayClient(profile, { fetch: fetchImpl });
    expect(await client.connectLink("tiktok", "https://site.example")).toBe("https://relay.example/connect/tiktok?state=abc");
    expect(JSON.parse(String(calls[0].body))).toEqual({ origin: "https://site.example" });
    const progress: number[] = [];
    const started = await client.publish({ file: new Blob(["video"], { type: "video/mp4" }), fileName: "clip.mp4", accounts: ["a_1", "a_2"], posts: { tiktok: { title: "t", text: "caption #fyp", hashtags: ["#fyp"] } }, visibility: "unlisted", caption: "shared" }, (sent, total) => progress.push(sent / total));
    expect(started.jobId).toBe("j_1");
    expect(started.job?.items[0].status).toBe("queued");
    expect(progress).toEqual([1]);
    const form = calls.find((c) => c.url.endsWith("/api/publish"))!.body as FormData;
    expect(form.get("accounts")).toBe("a_1,a_2");
    expect(form.get("visibility")).toBe("unlisted");
    expect(form.get("caption")).toBe("shared");
    expect(JSON.parse(String(form.get("posts"))).tiktok.text).toBe("caption #fyp");
    expect((form.get("file") as File).name).toBe("clip.mp4");
    const updates: string[] = [];
    const job = await client.waitForJob("j_1", { intervalMs: 0, sleep: async () => {}, onUpdate: (j) => updates.push(j.status) });
    expect(job.status).toBe("partial");
    expect(jobFinished(job)).toBe(true);
    expect(updates).toEqual(["running", "running", "partial"]);
    expect(job.items[0].link).toBe("https://www.tiktok.com/@tok/video/1");
    await client.removeAccount("a_9");
    expect(parseRelayJob({ id: "x", items: "nope" })).toBeNull();
  });

  it("stops polling on a refused key and when the job takes too long", async () => {
    const { fetchImpl } = mockFetch([{ url: "https://relay.example/api/jobs/", reply: () => json({ error: { code: "unauthorized", message: "Unknown access key" } }, { status: 401 }) }]);
    await expect(new RelayClient(profile, { fetch: fetchImpl }).waitForJob("j_1", { sleep: async () => {} })).rejects.toMatchObject({ code: "unauthorized" });
    const running = mockFetch([{ url: "https://relay.example/api/jobs/", reply: () => json({ id: "j", status: "running", items: [{ accountId: "a", platform: "tiktok", status: "processing" }] }) }]);
    let t = 0;
    await expect(new RelayClient(profile, { fetch: running.fetchImpl }).waitForJob("j", { sleep: async () => void (t += 1000), now: () => t, timeoutMs: 3000 })).rejects.toMatchObject({ code: "timeout" });
    const upload = fetchSendForm(mockFetch([{ url: "https://relay.example/api/publish", reply: () => json({ error: { code: "too_large", message: "The clip is larger than this relay accepts (300 MB)." } }, { status: 413 }) }]).fetchImpl);
    const err = await new RelayClient(profile, { fetch: vi.fn() as unknown as FetchLike, sendForm: upload }).publish({ file: new Blob(["x"]), fileName: "c.mp4", accounts: ["a"] }).catch((e) => e);
    expect(err.code).toBe("tooLarge");
  });
});

describe("the quick share", () => {
  const file = new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" });
  const phoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

  function fakeDocument() {
    const clicks: { href: string; download: string }[] = [];
    const doc = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => {
        const a = { href: "", download: "", rel: "", click: () => clicks.push({ href: a.href, download: a.download }) };
        return a;
      },
    };
    return { doc: doc as unknown as ShareEnv["document"], clicks };
  }

  it("tells phones from computers and checks that the file can be shared", () => {
    expect(isPhoneLike({ userAgent: phoneUa })).toBe(true);
    expect(isPhoneLike({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile" })).toBe(true);
    expect(isPhoneLike({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
    expect(isPhoneLike({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", userAgentData: { mobile: false } })).toBe(false);
    expect(isPhoneLike(null)).toBe(false);
    expect(canShareFile({ share: async () => {}, canShare: () => true }, file)).toBe(true);
    expect(canShareFile({ canShare: () => true }, file)).toBe(false);
    expect(canShareFile({ share: async () => {}, canShare: () => { throw new Error("no"); } }, file)).toBe(false);
  });

  it("hands the video file to the share sheet on a phone and puts the caption on the clipboard", async () => {
    const shared: { files?: File[]; text?: string; title?: string }[] = [];
    const copied: string[] = [];
    const nav: ShareNavigator = { userAgent: phoneUa, canShare: (d) => !!d.files?.[0]?.type.startsWith("video/"), share: async (d) => void shared.push(d), clipboard: { writeText: async (t) => void copied.push(t) } };
    const open = vi.fn();
    const result = await quickShare({ platform: "tiktok", file, text: "Caption #fyp", title: "Hook", env: { navigator: nav, open } });
    expect(result).toEqual({ method: "share", outcome: "shared", copied: true });
    expect(shared).toHaveLength(1);
    expect(shared[0].files?.[0]).toBe(file);
    expect(shared[0].text).toBe("Caption #fyp");
    expect(copied).toEqual(["Caption #fyp"]);
    expect(open).not.toHaveBeenCalled();
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const cancelled = await quickShare({ platform: "instagram", file, text: "x", env: { navigator: { ...nav, share: async () => Promise.reject(abort) } } });
    expect(cancelled).toMatchObject({ method: "share", outcome: "cancelled" });
  });

  it("on a computer downloads the clip, copies the caption and opens the platform's upload page", async () => {
    const copied: string[] = [];
    const { doc, clicks } = fakeDocument();
    const tab = { opener: {} as unknown };
    const open = vi.fn(() => tab);
    const nav: ShareNavigator = { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", canShare: () => true, share: async () => {}, clipboard: { writeText: async (t) => void copied.push(t) } };
    const result = await quickShare({ platform: "youtube", file, text: shareText("youtube", { title: "Title", text: "Desc #Shorts" }), env: { navigator: nav, document: doc, open, createObjectURL: () => "blob:clip", revokeObjectURL: () => {} } });
    expect(result).toEqual({ method: "desktop", copied: true, downloaded: true, opened: true, url: UPLOAD_PAGES.youtube });
    expect(open).toHaveBeenCalledWith("https://www.youtube.com/upload", "_blank");
    expect(tab.opener).toBeNull();
    expect(clicks).toEqual([{ href: "blob:clip", download: "clip.mp4" }]);
    expect(copied).toEqual(["Title\n\nDesc #Shorts"]);
    // No clipboard, pop-ups blocked: still downloads, and says what did not work.
    const bare = await quickShare({ platform: "tiktok", file, text: "x", env: { navigator: { userAgent: "Windows" }, document: doc, open: () => null, createObjectURL: () => "blob:2" } });
    expect(bare).toEqual({ method: "desktop", copied: false, downloaded: true, opened: false, url: "https://www.tiktok.com/upload" });
    expect(shareText("tiktok", { title: "T", text: "caption" })).toBe("caption");
  });
});

describe("YouTube, straight from the browser", () => {
  const meta = { title: "Can it escape?", description: "Desc\n\n#Shorts", tags: ["Shorts"], privacy: "unlisted" as const };
  const video = (size: number) => new Blob([new Uint8Array(size).fill(1)], { type: "video/mp4" });

  it("turns token responses into tokens and refuses one without the upload permission", () => {
    expect(tokenFromResponse({ access_token: "ya29", expires_in: 3599, scope: `${YT_UPLOAD_SCOPE} other` }, 1000)).toEqual({ accessToken: "ya29", expiresAt: 1000 + 3599000, scope: `${YT_UPLOAD_SCOPE} other` });
    expect(() => tokenFromResponse({ access_token: "ya29", scope: "https://www.googleapis.com/auth/youtube.readonly" }, 0)).toThrow(/Manage your YouTube videos/);
    expect(() => tokenFromResponse({ error: "access_denied" }, 0)).toThrow(YouTubeError);
  });

  it("reads the channel's name and avatar", async () => {
    const { fetchImpl, calls } = mockFetch([{ url: "https://www.googleapis.com/youtube/v3/channels", reply: () => json({ items: [{ id: "UC1", snippet: { title: "Chan", customUrl: "@chan", thumbnails: { default: { url: "https://yt3/a.jpg" } } } }] }) }]);
    expect(await fetchMyChannel(fetchImpl, "tok")).toEqual({ id: "UC1", title: "Chan", handle: "@chan", avatar: "https://yt3/a.jpg" });
    expect(calls[0].url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    const none = mockFetch([{ url: "https://www.googleapis.com/", reply: () => json({ items: [] }) }]);
    await expect(fetchMyChannel(none.fetchImpl, "tok")).rejects.toMatchObject({ code: "noChannel" });
  });

  it("opens a resumable session with the video resource", async () => {
    const { fetchImpl, calls } = mockFetch([{ method: "POST", url: resumableStartUrl(), reply: () => new Response(null, { status: 200, headers: { Location: "https://upload.example/s1" } }) }]);
    expect(await startResumableSession(fetchImpl, "tok", meta, 1234, "video/mp4")).toBe("https://upload.example/s1");
    expect(calls[0].url).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
    expect(calls[0].headers).toMatchObject({ Authorization: "Bearer tok", "X-Upload-Content-Length": "1234", "X-Upload-Content-Type": "video/mp4" });
    expect(JSON.parse(String(calls[0].body))).toEqual({ snippet: { title: "Can it escape?", description: "Desc\n\n#Shorts", tags: ["Shorts"], categoryId: "24" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false, embeddable: true } });
  });

  it("sends 256 KiB-aligned chunks and resumes where a 308 says the server is", async () => {
    const size = 700 * 1024;
    const chunk = 256 * 1024;
    let puts = 0;
    const { fetchImpl, calls } = mockFetch([
      {
        method: "PUT",
        url: "https://upload.example/s1",
        reply: () => {
          puts++;
          // The server kept only 100 KiB of the first chunk: the client resends from there.
          if (puts === 1) return new Response(null, { status: 308, headers: { Range: `bytes=0-${100 * 1024 - 1}` } });
          if (puts === 2) return new Response(null, { status: 308, headers: { Range: `bytes=0-${100 * 1024 + chunk - 1}` } });
          if (puts === 3) return new Response(null, { status: 308, headers: { Range: `bytes=0-${100 * 1024 + 2 * chunk - 1}` } });
          return json({ id: "vid1" }, { status: 201 });
        },
      },
    ]);
    const progress: number[] = [];
    const out = await uploadResumable(fetchImpl, "https://upload.example/s1", video(size), { chunkSize: 300 * 1024, onProgress: (p) => progress.push(Math.round((100 * p.sent) / p.total)) });
    expect(out).toEqual({ id: "vid1", url: "https://www.youtube.com/shorts/vid1" });
    const ranges = calls.map((c) => c.headers["Content-Range"]);
    // 300 KiB is rounded down to 256 KiB.
    expect(ranges).toEqual([`bytes 0-${chunk - 1}/${size}`, `bytes ${100 * 1024}-${100 * 1024 + chunk - 1}/${size}`, `bytes ${100 * 1024 + chunk}-${100 * 1024 + 2 * chunk - 1}/${size}`, `bytes ${100 * 1024 + 2 * chunk}-${size - 1}/${size}`]);
    expect((calls[1].body as Blob).size).toBe(chunk);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("after a dropped connection or a 5xx asks the session how far it got and goes on", async () => {
    const size = 600 * 1024;
    let puts = 0;
    const sleeps: number[] = [];
    const { fetchImpl, calls } = mockFetch([
      {
        method: "PUT",
        url: "https://upload.example/s2",
        reply: (call) => {
          if (call.headers["Content-Range"] === `bytes */${size}`) return new Response(null, { status: 308, headers: { Range: "bytes=0-262143" } });
          puts++;
          if (puts === 1) throw new TypeError("network down");
          if (puts === 2) return new Response(null, { status: 308, headers: { Range: "bytes=0-524287" } });
          if (puts === 3) return json({ error: { code: 503, message: "backend" } }, { status: 503 });
          return json({ id: "vid2" });
        },
      },
    ]);
    const out = await uploadResumable(fetchImpl, "https://upload.example/s2", video(size), { chunkSize: 256 * 1024, sleep: async (ms) => void sleeps.push(ms), backoffMs: (n) => n * 10 });
    expect(out.id).toBe("vid2");
    // Dropped → asked (262144 arrived) → next chunk → 503 on the last → asked again (the server says 262144) → resent → done.
    expect(calls.map((c) => c.headers["Content-Range"])).toEqual([`bytes 0-262143/${size}`, `bytes */${size}`, `bytes 262144-524287/${size}`, `bytes 524288-${size - 1}/${size}`, `bytes */${size}`, `bytes 262144-524287/${size}`]);
    expect(sleeps.length).toBe(2);
    expect(nextOffsetFromRange("bytes=0-99")).toBe(100);
    expect(nextOffsetFromRange(null)).toBe(0);
  });

  it("names the errors: expired sign-in, quota, no channel, a lost session", async () => {
    expect(youtubeErrorFor(401, null).code).toBe("auth");
    expect(youtubeErrorFor(403, { error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } }).code).toBe("quota");
    expect(youtubeErrorFor(403, { error: { errors: [{ reason: "youtubeSignupRequired" }] } }).code).toBe("noChannel");
    expect(youtubeErrorFor(403, { error: { message: "nope" } }).message).toMatch(/Test users/);
    expect(youtubeErrorFor(404, null).code).toBe("session");
    const { fetchImpl } = mockFetch([
      { method: "POST", url: "https://www.googleapis.com/upload/", reply: () => new Response(null, { status: 200, headers: { Location: "https://upload.example/s3" } }) },
      { method: "PUT", url: "https://upload.example/s3", reply: () => json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 }) },
    ]);
    await expect(uploadToYouTube(fetchImpl, "old", video(1000), meta)).rejects.toMatchObject({ code: "auth" });
    let n = 0;
    const flaky = mockFetch([{ method: "PUT", url: "https://upload.example/s4", reply: () => (n++ >= 0 ? json({}, { status: 500 }) : json({})) }]);
    await expect(uploadResumable(flaky.fetchImpl, "https://upload.example/s4", video(1000), { maxRetries: 2, sleep: async () => {} })).rejects.toMatchObject({ code: "server" });
  });
});

describe("what the browser remembers", () => {
  it("validates the stored state and caps the recent sends at 50", () => {
    expect(parsePublishState(null)).toEqual(defaultPublishState());
    const parsed = parsePublishState({
      youtubeClientId: " 123.apps.googleusercontent.com ",
      youtubeAccounts: [{ id: "UC1", title: "Chan", accessToken: "tok", expiresAt: 5 }, { title: "no id" }],
      relayProfiles: [{ id: "p1", url: "relay.example", key: "k", label: "Team" }, { id: "p2", url: "ftp://x", key: "k" }],
      activeRelay: "gone",
      visibility: "secret",
      checked: ["yt:UC1", 3],
      recent: [{ id: "s1", at: 1, platform: "tiktok", via: "relay", status: "published", link: "javascript:alert(1)", clip: "c.mp4", account: "@a" }, { platform: "myspace" }],
    });
    expect(parsed.youtubeClientId).toBe("123.apps.googleusercontent.com");
    expect(parsed.youtubeAccounts.map((a) => a.id)).toEqual(["UC1"]);
    expect(parsed.relayProfiles).toEqual([{ id: "p1", url: "https://relay.example", key: "k", label: "Team" }]);
    expect(parsed.activeRelay).toBe("p1");
    expect(parsed.visibility).toBe("public");
    expect(parsed.checked).toEqual(["yt:UC1"]);
    expect(parsed.recent).toHaveLength(1);
    expect(parsed.recent[0].link).toBeNull();
    let list: RecentSend[] = [];
    for (let i = 0; i < 60; i++) list = addRecent(list, { id: `s${i}`, at: i, clip: "c", platform: "youtube", account: "a", via: "youtube", status: "published", link: null, error: null });
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe("s59");
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    savePublishState({ ...defaultPublishState(), youtubeClientId: "abc" }, storage);
    expect(JSON.parse(mem.get(PUBLISH_STORAGE_KEY)!).youtubeClientId).toBe("abc");
    expect(loadPublishState(storage).youtubeClientId).toBe("abc");
    expect(loadPublishState({ getItem: () => "{broken", setItem: () => {} })).toEqual(defaultPublishState());
    expect(youtubeKey("UC1")).toBe("yt:UC1");
    expect(relayKey("p1", "a_1")).toBe("relay:p1:a_1");
  });
});

describe("the clip inbox", () => {
  afterEach(() => resetPublishClips());

  it("names clips after their container, keeps the newest few and tells listeners", () => {
    expect(clipExtension("video/webm;codecs=vp9")).toBe("webm");
    expect(clipExtension("", "x.MOV")).toBe("mov");
    expect(clipFileName("jumpingballslive-export.webm", "video/mp4")).toBe("jumpingballslive-export.mp4");
    const seen = vi.fn();
    const off = subscribePublishClips(seen);
    const first = offerPublishClip({ blob: new Blob(["a"], { type: "video/webm" }), name: "jumpingballslive-export", source: "recording", mode: "classic", seed: 42 });
    expect(first).toMatchObject({ name: "jumpingballslive-export.webm", type: "video/webm", source: "recording", mode: "classic", seed: 42, durationSec: null, bytes: 1 });
    for (let i = 0; i < MAX_CLIPS + 2; i++) offerPublishClip({ blob: new Blob(["b"], { type: "video/mp4" }), name: `ep-${i}`, source: "bot", durationSec: 12.5, botClipId: `ep-${i}` });
    expect(publishClips()).toHaveLength(MAX_CLIPS);
    expect(publishClips()[0].name).toBe(`ep-${MAX_CLIPS + 1}.mp4`);
    expect(seen).toHaveBeenCalledTimes(MAX_CLIPS + 3);
    off();
  });
});

describe("Send to selected (the controller)", () => {
  afterEach(() => resetPublishClips());

  it("sends one clip to a direct YouTube channel and to relay accounts at once, and logs the results", async () => {
    const now = 1_700_000_000_000;
    const mem = new Map<string, string>();
    mem.set(
      PUBLISH_STORAGE_KEY,
      JSON.stringify({
        youtubeAccounts: [
          { id: "UC1", title: "Main channel", accessToken: "ya29.main", expiresAt: now + 3600e3, addedAt: 1 },
          { id: "UC2", title: "Old channel", accessToken: "ya29.old", expiresAt: now - 1000, addedAt: 1 },
        ],
        relayProfiles: [{ id: "p1", url: "https://relay.example", key: "jbl_team", label: "Team" }],
        activeRelay: "p1",
        checked: ["yt:UC1", "yt:UC2", "relay:p1:a_tt", "relay:p1:a_ig"],
        visibility: "private",
      }),
    );
    let jobPolls = 0;
    const { fetchImpl, calls } = mockFetch([
      { url: "https://relay.example/api/me", reply: () => json({ key: { id: "k1", label: "Team" }, platforms: { tiktok: true, instagram: true, youtube: true } }) },
      { url: "https://relay.example/api/accounts", reply: () => json({ accounts: [{ id: "a_tt", platform: "tiktok", name: "Tok", handle: "@tok" }, { id: "a_ig", platform: "instagram", name: "IG", handle: "@ig" }, { id: "a_ig2", platform: "instagram", name: "IG 2" }] }) },
      { method: "POST", url: "https://relay.example/api/publish", reply: () => json({ jobId: "j1" }, { status: 202 }) },
      {
        url: "https://relay.example/api/jobs/j1",
        reply: () =>
          ++jobPolls < 2
            ? json({ id: "j1", status: "running", items: [{ accountId: "a_tt", platform: "tiktok", status: "processing", progress: 0.9 }, { accountId: "a_ig", platform: "instagram", status: "uploading", progress: 0.2 }] })
            : json({ id: "j1", status: "partial", items: [{ accountId: "a_tt", platform: "tiktok", status: "published", link: "https://www.tiktok.com/@tok" }, { accountId: "a_ig", platform: "instagram", status: "failed", error: "Instagram refused: this Meta app is not yet approved" }] }),
      },
      { method: "POST", url: "https://www.googleapis.com/upload/youtube/v3/videos", reply: () => new Response(null, { status: 200, headers: { Location: "https://upload.example/yt" } }) },
      { method: "PUT", url: "https://upload.example/yt", reply: () => json({ id: "short1" }) },
    ]);
    const deps: ControllerDeps = { fetch: () => fetchImpl, window: () => null, storage: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }), now: () => now, envClientId: "", envRelayUrl: "" };
    const c = new PublishController(deps);
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().relay.status).toBe("ok"));
    const clip = offerPublishClip({ blob: new Blob([new Uint8Array(2048)], { type: "video/mp4" }), name: "clip", source: "fast", durationSec: 20, mode: "classic" });
    expect(c.getSnapshot().clipId).toBe(clip.id);
    c.ensureDraft(clip.id, () => ({ ...emptyDraft(), title: "Can it escape?", caption: "Ring escape", hashtags: "#ball" }));
    const views = accountViews(c.getSnapshot(), now);
    expect(views.map((v) => [v.key, v.checked, v.expired])).toEqual([
      ["relay:p1:a_tt", true, false],
      ["relay:p1:a_ig", true, false],
      ["relay:p1:a_ig2", false, false],
      ["yt:UC1", true, false],
      ["yt:UC2", true, true],
    ]);
    const plan = sendPlan(c.getSnapshot(), now);
    expect(plan.targets).toHaveLength(4);
    expect(plan.blocked).toEqual([]);
    await c.sendSelected();
    const s = c.getSnapshot();
    const byKey = Object.fromEntries(s.sends.map((i) => [i.key, i]));
    expect(byKey["yt:UC1"]).toMatchObject({ status: "published", link: "https://www.youtube.com/shorts/short1", progress: 1 });
    expect(byKey["yt:UC2"].status).toBe("needsAuth");
    expect(byKey["relay:p1:a_tt"]).toMatchObject({ status: "published", link: "https://www.tiktok.com/@tok" });
    expect(byKey["relay:p1:a_ig"]).toMatchObject({ status: "failed" });
    expect(byKey["relay:p1:a_ig"].error).toMatch(/not yet approved/);
    expect(s.sending).toBe(false);
    // The YouTube upload went out with the YouTube words and the chosen visibility; the relay got one upload for both accounts.
    const ytStart = calls.find((x) => x.url.startsWith("https://www.googleapis.com/upload/"))!;
    expect(ytStart.headers.Authorization).toBe("Bearer ya29.main");
    expect(JSON.parse(String(ytStart.body))).toMatchObject({ snippet: { title: "Can it escape?", description: "Ring escape\n\n#Shorts #ball", tags: ["Shorts", "ball"] }, status: { privacyStatus: "private" } });
    const publishes = calls.filter((x) => x.url.endsWith("/api/publish"));
    expect(publishes).toHaveLength(1);
    const form = publishes[0].body as FormData;
    expect(form.get("accounts")).toBe("a_tt,a_ig");
    const posts = JSON.parse(String(form.get("posts")));
    expect(Object.keys(posts).sort()).toEqual(["instagram", "tiktok", "youtube"]);
    expect(posts.tiktok.text).toBe("Ring escape\n\n#ball #fyp");
    expect(posts.instagram.text).toBe("Ring escape\n\n#ball #reels");
    // The recent sends (kept in storage) list the three finished accounts; the one waiting for a sign-in is not there yet.
    const stored = JSON.parse(mem.get(PUBLISH_STORAGE_KEY)!);
    expect(stored.recent.map((r: RecentSend) => [r.platform, r.status]).sort()).toEqual([
      ["instagram", "failed"],
      ["tiktok", "published"],
      ["youtube", "published"],
    ]);
    expect(JSON.stringify(stored.recent)).not.toContain("jbl_team");
  });

  it("does not send words over a platform's limit", () => {
    const c = new PublishController({ fetch: () => vi.fn() as unknown as FetchLike, window: () => null, storage: () => null, now: () => 0, envClientId: "", envRelayUrl: "" });
    const clip = offerPublishClip({ blob: new Blob(["x"], { type: "video/webm" }), name: "c", source: "file" });
    c.start();
    c.ensureDraft(clip.id, () => ({ ...emptyDraft(), title: "x".repeat(120), caption: "c" }));
    const snap = { ...c.getSnapshot(), stored: { ...c.getSnapshot().stored, youtubeAccounts: [{ id: "UC1", title: "C", handle: null, avatar: null, accessToken: "t", expiresAt: 1e15, addedAt: 0 }], checked: ["yt:UC1"] } };
    const plan = sendPlan(snap, 0);
    expect(plan.blocked).toEqual(["youtube"]);
    expect(plan.instagramNeedsMp4).toBe(false);
  });
});

describe("the bot CLI's --relay path", () => {
  it("parses --relay, --relay-key and --accounts and refuses them where they make no sense", async () => {
    const { parseArgs } = await import("../scripts/viral-bot.mjs");
    expect(parseArgs(["--relay", "https://relay.example", "--relay-key", "jbl_k", "--accounts", "a_1, a_2"])).toMatchObject({ relay: "https://relay.example", relayKey: "jbl_k", accounts: ["a_1", "a_2"] });
    expect(parseArgs(["--post-only", "--relay=https://relay.example", "--accounts=all"])).toMatchObject({ postOnly: true, relay: "https://relay.example", accounts: ["all"] });
    for (const bad of [["--relay", "relay.example", "--accounts", "a"], ["--relay", "https://relay.example"], ["--dry-run", "--relay", "https://r.example", "--accounts", "a"], ["--accounts", "a"], ["--relay-key", "k"]]) expect(() => parseArgs(bad)).toThrow();
  });

  it("posts every rendered clip through the relay with the bot's words and reports each account", async () => {
    const { postViaRelay, captionWithoutHashtags } = await import("../scripts/viral-bot.mjs");
    expect(captionWithoutHashtags("Hook\n\nQuestion?\n\n#a #b", ["#a", "#b"])).toBe("Hook\n\nQuestion?");
    expect(captionWithoutHashtags("Hook", ["#a"])).toBe("Hook");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bot-relay-"));
    fs.writeFileSync(path.join(out, "ep001-1-ring-escape-42.mp4"), Buffer.alloc(4096, 3));
    const forms: FormData[] = [];
    const { fetchImpl } = mockFetch([
      { url: "https://relay.example/api/accounts", reply: () => json({ accounts: [{ id: "a_1", platform: "tiktok", name: "Tok" }, { id: "a_2", platform: "youtube", name: "Chan" }] }) },
      {
        method: "POST",
        url: "https://relay.example/api/publish",
        reply: (call) => {
          forms.push(call.body as FormData);
          return json({ jobId: "j1" }, { status: 202 });
        },
      },
      { url: "https://relay.example/api/jobs/j1", reply: () => json({ id: "j1", status: "partial", items: [{ accountId: "a_1", platform: "tiktok", name: "Tok", status: "published", link: "https://www.tiktok.com/@tok" }, { accountId: "a_2", platform: "youtube", name: "Chan", status: "failed", error: "quota" }] }) },
    ]);
    const lines: string[] = [];
    const log = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const clips = [
      { id: "ep001-1-ring-escape-42", file: "ep001-1-ring-escape-42.mp4", caption: "Can it escape?\n\nRing Escape · Day 1\n\n#ringescape #reels", hook: "Can it escape?", hashtags: ["#ringescape", "#reels"] },
      { id: "ep001-2-grow-fill-7", file: null, caption: "", hook: "", hashtags: [] },
    ];
    const ok = await postViaRelay({ RelayClient }, clips, { relay: "https://relay.example", relayKey: "jbl_k", accounts: ["all"] }, out, { fetchImpl, log, intervalMs: 0 });
    expect(ok).toBe(false);
    expect(forms).toHaveLength(1);
    expect(forms[0].get("accounts")).toBe("a_1,a_2");
    expect(forms[0].get("title")).toBe("Can it escape?");
    expect(forms[0].get("caption")).toBe("Can it escape?\n\nRing Escape · Day 1");
    expect(forms[0].get("hashtags")).toBe("#ringescape #reels");
    expect((forms[0].get("file") as File).size).toBe(4096);
    expect(lines.join("\n")).toContain("✓ tiktok Tok – https://www.tiktok.com/@tok");
    expect(lines.join("\n")).toContain("✗ youtube Chan: quota");
    expect(lines.join("\n")).toContain("ep001-2-grow-fill-7: not rendered");
    const unknown = await postViaRelay({ RelayClient }, clips, { relay: "https://relay.example", relayKey: "jbl_k", accounts: ["a_9"] }, out, { fetchImpl, log, intervalMs: 0 });
    expect(unknown).toBe(false);
    expect(lines.some((l) => l.includes("no account a_9"))).toBe(true);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
