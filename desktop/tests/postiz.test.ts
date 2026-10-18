import { describe, expect, it, vi } from "vitest";
import { BRIDGE_METHODS, IPC, checkIpcArgs, type IpcChannel, type PostizChannel } from "@/lib/desktop/contract";
import { SecretBox, type SafeStorageLike } from "../src/ai/secrets";
import { PostizClient, PostizError, checkUploadFile, codeOfStatus, normalisePostizBase, redactKey, retryAfterMs } from "../src/social/postiz";
import { DEFAULT_POSTIZ, PostizKeyStore, validatePostizUrl, type PostizSettings } from "../src/social/keys";
import { CHANNELS_CACHE_MS, SocialService } from "../src/social/service";
import { guarded, registerHandlers, type HandlerTable } from "../src/handlers";

/*
 * --- social-postiz --- The Postiz client against a stand-in server (every endpoint of docs/SOCIAL-AUTOPILOT.md section 2, the
 * base URL forms, the raw Authorization header, every error mapping, the upload rules), the sealed key store (status never
 * returns the key, a refused key keeps the old one, forget), the service's channel cache and the bridge's new channels.
 */

const KEY = "pz_secret_key_0123456789abcdef";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

/** A stand-in Postiz: records every call and answers from the routes (a route may be a Response or a thrower). */
function postizServer(routes: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  const calls: Call[] = [];
  const channels = [
    { id: "int-tt", name: "Gerald on TikTok", identifier: "tiktok", picture: "https://cdn.postiz.example/tt.png", disabled: false, profile: "gerald", customer: null },
    { id: "int-yt", name: "Gerald Shorts", identifier: "youtube", picture: null, disabled: true, profile: "gerald", customer: { id: "c1", name: "Studio" } },
  ];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { url, method, headers, body: init.body, signal: init.signal };
    calls.push(call);
    const path = new URL(url).pathname.replace(/^.*\/public\/v1/, "") + (new URL(url).search || "");
    const route = Object.entries(routes).find(([k]) => (k.includes(" ") ? `${method} ${path}` === k || `${method} ${path.split("?")[0]}` === k : path === k || path.split("?")[0] === k));
    if (route) return route[1](call);
    if (headers.authorization !== KEY) return json({ message: "Unauthorized" }, { status: 401 });
    if (path === "/is-connected") return json({ connected: true });
    if (path === "/me") return json({ id: "org-1", name: "Gerald Studio" });
    if (path === "/integrations") return json(channels);
    if (path.startsWith("/integration-settings/")) return json({ identifier: "tiktok", maxLength: 2200, settings: [{ name: "privacy_level" }] });
    if (path === "/upload" && method === "POST") return json({ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4" });
    if (path === "/posts" && method === "POST") return json([{ postId: "post-1", integration: "int-tt" }]);
    if (path.startsWith("/posts?")) return json({ posts: [{ id: "post-1", content: "hi", publishDate: "2026-10-18T10:00:00.000Z", state: "PUBLISHED", releaseURL: "https://www.tiktok.com/@gerald/video/1", group: "g1", integration: { id: "int-tt", name: "Gerald on TikTok", providerIdentifier: "tiktok", picture: null } }] });
    if (/^\/posts\/[^/]+\/status$/.test(path) && method === "PUT") return json({ ok: true });
    if (/^\/posts\/[^/]+\/settings$/.test(path) && method === "PUT") return json({ ok: true });
    if (/^\/posts\/[^/]+$/.test(path) && method === "DELETE") return json({ ok: true });
    if (path.startsWith("/find-slot/")) return json({ date: "2026-10-19T17:00:00.000Z" });
    if (path.startsWith("/analytics/post/")) return json([{ label: "Views", total: 12, data: [{ date: "2026-10-18", total: 12 }] }]);
    if (path.startsWith("/analytics/")) return json([{ label: "Views", data: [{ date: "2026-10-17", total: 5 }, { date: "2026-10-18", total: 7 }] }]);
    if (path.startsWith("/notifications")) return json([{ id: "n1", content: "TikTok login expired", createdAt: "2026-10-18T09:00:00.000Z", read: false }]);
    return json({ message: "no such route" }, { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, channels };
}

const client = (server: ReturnType<typeof postizServer>, baseUrl = "https://api.postiz.com", extra: Partial<ConstructorParameters<typeof PostizClient>[0]> = {}) => new PostizClient({ baseUrl, apiKey: KEY, fetch: server.fetchImpl, ...extra });

describe("Postiz base URL", () => {
  it("normalises every form the user may type to <base>/public/v1", () => {
    expect(normalisePostizBase("https://api.postiz.com")).toBe("https://api.postiz.com/public/v1");
    expect(normalisePostizBase("https://api.postiz.com/")).toBe("https://api.postiz.com/public/v1");
    expect(normalisePostizBase("https://api.postiz.com/public/v1")).toBe("https://api.postiz.com/public/v1");
    expect(normalisePostizBase("https://api.postiz.com/public/v1/")).toBe("https://api.postiz.com/public/v1");
    expect(normalisePostizBase("https://postiz.example.com/api")).toBe("https://postiz.example.com/api/public/v1");
    expect(normalisePostizBase("https://postiz.example.com/api/public/v1")).toBe("https://postiz.example.com/api/public/v1");
    expect(normalisePostizBase("  https://postiz.example.com:5000  ")).toBe("https://postiz.example.com:5000/public/v1");
    expect(normalisePostizBase("api.postiz.com")).toBe("https://api.postiz.com/public/v1");
    expect(normalisePostizBase("http://localhost:3000")).toBe("http://localhost:3000/public/v1");
    expect(normalisePostizBase("http://127.0.0.1:3000/public/v1")).toBe("http://127.0.0.1:3000/public/v1");
  });
  it("refuses plain http elsewhere, credentials in the address and nonsense", () => {
    for (const bad of ["", "   ", "http://postiz.example.com", "ftp://api.postiz.com", "https://user:pw@api.postiz.com", "not a url at all", "https://"]) {
      let caught: unknown;
      try {
        normalisePostizBase(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught, bad).toBeInstanceOf(PostizError);
      expect((caught as PostizError).code, bad).toBe("badUrl");
    }
    expect(() => validatePostizUrl("https://" + "a".repeat(500))).toThrow(/too long/);
    expect(validatePostizUrl("https://api.postiz.com/")).toBe("https://api.postiz.com");
  });
});

describe("PostizClient", () => {
  it("calls every endpoint under /public/v1 with the raw key in Authorization (no Bearer) and typed results", async () => {
    const server = postizServer();
    const c = client(server);
    expect(await c.isConnected()).toBe(true);
    expect(await c.me()).toEqual({ id: "org-1", name: "Gerald Studio" });
    const channels = await c.integrations();
    expect(channels).toEqual<PostizChannel[]>([
      { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: "https://cdn.postiz.example/tt.png", disabled: false, customer: null },
      { id: "int-yt", name: "Gerald Shorts", platform: "youtube", picture: null, disabled: true, customer: { id: "c1", name: "Studio" } },
    ]);
    expect(await c.integrationSettings("int-tt")).toMatchObject({ identifier: "tiktok", maxLength: 2200 });
    const upload = await c.upload({ name: "glass.mp4", type: "video/mp4", bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) });
    expect(upload).toEqual({ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4" });
    const created = await c.createPosts({ type: "schedule", date: "2026-10-19T17:00:00.000Z", posts: [{ integration: { id: "int-tt" }, value: [{ content: "Which floor breaks first?", image: [{ id: upload.id, path: upload.path }] }], settings: { __type: "tiktok", privacy_level: "SELF_ONLY" } }] });
    expect(created).toEqual([{ postId: "post-1", integration: "int-tt" }]);
    const posts = await c.posts({ startDate: "2026-10-18T00:00:00.000Z", endDate: "2026-10-19T00:00:00.000Z" });
    expect(posts).toEqual([{ id: "post-1", content: "hi", publishDate: "2026-10-18T10:00:00.000Z", state: "PUBLISHED", releaseURL: "https://www.tiktok.com/@gerald/video/1", error: null, group: "g1", integration: { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: null } }]);
    await c.setPostStatus("post-1", "draft");
    await c.setPostSettings("post-1", { __type: "tiktok", privacy_level: "PUBLIC_TO_EVERYONE" });
    await c.deletePost("post-1");
    expect(await c.findSlot("int-tt")).toEqual({ date: "2026-10-19T17:00:00.000Z" });
    expect(await c.analytics("int-tt", 7)).toEqual([{ label: "Views", total: 12, data: [{ date: "2026-10-17", total: 5 }, { date: "2026-10-18", total: 7 }] }]);
    expect(await c.postAnalytics("post-1", 30)).toEqual([{ label: "Views", total: 12, data: [{ date: "2026-10-18", total: 12 }] }]);
    expect(await c.notifications(2)).toEqual([{ id: "n1", content: "TikTok login expired", createdAt: "2026-10-18T09:00:00.000Z", read: false }]);

    const seen = server.calls.map((x) => `${x.method} ${x.url.replace("https://api.postiz.com/public/v1", "")}`);
    expect(seen).toEqual([
      "GET /is-connected",
      "GET /me",
      "GET /integrations",
      "GET /integration-settings/int-tt",
      "POST /upload",
      "POST /posts",
      "GET /posts?startDate=2026-10-18T00%3A00%3A00.000Z&endDate=2026-10-19T00%3A00%3A00.000Z",
      "PUT /posts/post-1/status",
      "PUT /posts/post-1/settings",
      "DELETE /posts/post-1",
      "GET /find-slot/int-tt",
      "GET /analytics/int-tt?date=7",
      "GET /analytics/post/post-1?date=30",
      "GET /notifications?page=2",
    ]);
    for (const call of server.calls) {
      expect(call.url.startsWith("https://api.postiz.com/public/v1/")).toBe(true);
      expect(call.headers.authorization).toBe(KEY);
      expect(call.headers.authorization).not.toMatch(/bearer/i);
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
    // JSON bodies as JSON, the upload as multipart with the field `file` (the browser sets the boundary: no Content-Type of ours)
    const create = server.calls.find((x) => x.method === "POST" && x.url.endsWith("/posts"))!;
    expect(create.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(create.body as string)).toMatchObject({ type: "schedule", posts: [{ integration: { id: "int-tt" }, settings: { __type: "tiktok" } }] });
    expect(JSON.parse((server.calls.find((x) => x.url.endsWith("/status"))!).body as string)).toEqual({ status: "draft" });
    expect(JSON.parse((server.calls.find((x) => x.url.endsWith("/settings"))!).body as string)).toEqual({ settings: { __type: "tiktok", privacy_level: "PUBLIC_TO_EVERYONE" } });
    const up = server.calls.find((x) => x.url.endsWith("/upload"))!;
    expect(up.body).toBeInstanceOf(FormData);
    expect(up.headers["content-type"]).toBeUndefined();
    const file = (up.body as FormData).get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("glass.mp4");
    expect((file as Blob).type).toBe("video/mp4");
    expect((file as Blob).size).toBe(8);
  });

  it("works against a self-hosted backend with or without /public/v1", async () => {
    for (const base of ["https://postiz.example.com/api", "https://postiz.example.com/api/public/v1/"]) {
      const server = postizServer();
      await client(server, base).me();
      expect(server.calls[0].url).toBe("https://postiz.example.com/api/public/v1/me");
    }
  });

  it("maps the HTTP statuses to codes with Postiz's own message, and 429's Retry-After", async () => {
    const cases: [number, string, string][] = [
      [400, "badRequest", "posts.0.value must not be empty"],
      [401, "unauthorized", "Unauthorized"],
      [402, "noSubscription", "No active subscription"],
      [403, "forbidden", "Forbidden"],
      [404, "notFound", "Not Found"],
      [413, "tooLarge", "Payload too large"],
      [500, "server", "Internal server error"],
      [503, "server", ""],
      [418, "unknown", ""],
    ];
    for (const [status, code, message] of cases) {
      const server = postizServer({ "/me": () => json(message ? { message } : {}, { status }) });
      const err = await client(server).me().catch((e: unknown) => e);
      expect(err, String(status)).toBeInstanceOf(PostizError);
      expect((err as PostizError).code, String(status)).toBe(code);
      expect((err as PostizError).status, String(status)).toBe(status);
      if (message) expect((err as PostizError).message).toBe(message);
      else expect((err as PostizError).message.length).toBeGreaterThan(5);
      expect((err as PostizError).retryAfterMs).toBeNull();
    }
    // a validation error lists its messages
    const list = postizServer({ "/me": () => json({ message: ["date must be a date", "posts must be an array"] }, { status: 400 }) });
    await expect(client(list).me()).rejects.toMatchObject({ code: "badRequest", message: "date must be a date, posts must be an array" });
    // 429: the wait from Retry-After (seconds, or none)
    const limited = postizServer({ "/me": () => json({ message: "Too many requests" }, { status: 429, headers: { "Retry-After": "30" } }) });
    await expect(client(limited).me()).rejects.toMatchObject({ code: "rateLimited", status: 429, retryAfterMs: 30_000, message: "Too many requests" });
    const limitedBare = postizServer({ "/me": () => new Response("", { status: 429 }) });
    await expect(client(limitedBare).me()).rejects.toMatchObject({ code: "rateLimited", retryAfterMs: null });
    expect(retryAfterMs("5")).toBe(5000);
    expect(retryAfterMs(new Date(1_000_000 + 7000).toUTCString(), 1_000_000)).toBe(7000);
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
    expect(codeOfStatus(429)).toBe("rateLimited");
    expect(codeOfStatus(502)).toBe("server");
    // is-connected treats a 401 as "no"
    const no = postizServer({ "/is-connected": () => json({ message: "Unauthorized" }, { status: 401 }) });
    expect(await client(no).isConnected()).toBe(false);
    const down = postizServer({ "/is-connected": () => json({}, { status: 500 }) });
    await expect(client(down).isConnected()).rejects.toMatchObject({ code: "server" });
  });

  it("reports a network failure and a timeout as `network`, with the key nowhere in the message or the log", async () => {
    const log = vi.fn();
    const offline = postizServer({
      "/me": () => {
        throw new TypeError(`fetch failed for ${KEY}`);
      },
    });
    const err = (await client(offline, "https://api.postiz.com", { log }).me().catch((e: unknown) => e)) as PostizError;
    expect(err).toBeInstanceOf(PostizError);
    expect(err.code).toBe("network");
    expect(err.status).toBeNull();
    expect(err.message).toContain("could not be reached");
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain("***");
    const slow = postizServer({ "/me": (call) => new Promise((_, reject) => call.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
    const timeout = (await client(slow, "https://api.postiz.com", { timeoutMs: 20, log }).me().catch((e: unknown) => e)) as PostizError;
    expect(timeout.code).toBe("network");
    expect(timeout.message).toMatch(/did not answer/);
    // an answer that quotes the key back is redacted too
    const echo = postizServer({ "/me": () => json({ message: `bad key ${KEY}` }, { status: 401 }) });
    const quoted = (await client(echo, "https://api.postiz.com", { log }).me().catch((e: unknown) => e)) as PostizError;
    expect(quoted.message).toBe("bad key ***");
    const logged = log.mock.calls.map((c) => String(c[1])).join("\n");
    expect(logged).not.toContain(KEY);
    expect(logged).toMatch(/postiz GET \/me: HTTP 401 unauthorized/);
    expect(redactKey(`a=${encodeURIComponent("k/e+y secret1")}`, "k/e+y secret1")).toBe("a=***");
    expect(redactKey("short", "abc")).toBe("short");
  });

  it("never follows a redirect, bounds the body read by the timeout and the size, logs no raw cause, and redacts short keys", async () => {
    // --- review fix (social-postiz) --- a 3xx is refused (the Authorization header never follows one to another host)
    const server = postizServer();
    await client(server).me();
    expect((server.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ redirect: "error" });
    // headers arrive, the body never does: the timer still ends the request
    const stall = postizServer({ "/me": (call) => new Response(new ReadableStream({ start(controller) { call.signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); } }), { status: 200, headers: { "content-type": "application/json" } }) });
    const stalled = (await client(stall, "https://api.postiz.com", { timeoutMs: 20 }).me().catch((e: unknown) => e)) as PostizError;
    expect(stalled.code).toBe("network");
    expect(stalled.message).toMatch(/did not answer/);
    // an answer over the cap is refused, not buffered
    const huge = postizServer({ "/me": () => new Response("{}", { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } }) });
    await expect(client(huge).me()).rejects.toMatchObject({ code: "server", message: /too large/ });
    // a network failure carries no raw cause (the handler's error chain would log it unredacted)
    const offline = postizServer({ "/me": () => { throw new TypeError(`fetch failed for ${KEY}`); } });
    const err = (await client(offline).me().catch((e: unknown) => e)) as Error & { cause?: unknown };
    expect(err.cause).toBeUndefined();
    // a 1-character key is redacted too
    expect(redactKey("key x here", "x")).toBe("key *** here");
  });

  it("is-connected takes only a Postiz-shaped yes: a catch-all web server answering 200 to everything is not accepted", async () => {
    const catchAll = postizServer({ "/is-connected": () => new Response("<html>welcome</html>", { status: 200, headers: { "content-type": "text/html" } }) });
    expect(await client(catchAll).isConnected()).toBe(false);
    const yes = postizServer({ "/is-connected": () => json(true) });
    expect(await client(yes).isConnected()).toBe(true);
  });

  it("refuses an upload Postiz would refuse before anything is sent: MP4 or an allowed image, within the size limits", async () => {
    const server = postizServer();
    const c = client(server);
    const big = { name: "big.mp4", type: "video/mp4", bytes: { byteLength: 1024 ** 3 + 1 } as unknown as Uint8Array };
    await expect(c.upload(big)).rejects.toMatchObject({ code: "tooLarge" });
    await expect(c.upload({ name: "clip.webm", type: "video/webm", bytes: new Uint8Array(4) })).rejects.toMatchObject({ code: "badRequest", message: expect.stringContaining("MP4") });
    await expect(c.upload({ name: "clip.mov", type: "video/quicktime", bytes: new Uint8Array(4) })).rejects.toMatchObject({ code: "badRequest" });
    await expect(c.upload({ name: "x.bin", type: "", bytes: new Uint8Array(4) })).rejects.toMatchObject({ code: "badRequest" });
    await expect(c.upload({ name: "thumb.png", type: "image/png", bytes: { byteLength: 10 * 1024 ** 2 + 1 } as unknown as Uint8Array })).rejects.toMatchObject({ code: "tooLarge", message: expect.stringContaining("10 MB") });
    expect(server.calls).toHaveLength(0);
    expect(checkUploadFile({ name: "ok.mp4", type: "video/mp4", bytes: new Uint8Array(10) })).toBeNull();
    expect(checkUploadFile({ name: "ok.jpg", type: "image/jpeg", bytes: new Uint8Array(10) })).toBeNull();
    expect(checkUploadFile({ name: "ok.mp4", type: "video/mp4", bytes: { byteLength: 1024 ** 3 } as unknown as Uint8Array })).toBeNull();
    await c.upload({ name: "thumb.png", type: "image/png", bytes: new Uint8Array(16) });
    expect(server.calls).toHaveLength(1);
    // a 413 from Postiz on an upload of a size we let through
    const strict = postizServer({ "POST /upload": () => json({ message: "File too large" }, { status: 413 }) });
    await expect(client(strict).upload({ name: "ok.mp4", type: "video/mp4", bytes: new Uint8Array(16) })).rejects.toMatchObject({ code: "tooLarge", status: 413 });
  });

  it("needs a key and a valid address to be built", () => {
    expect(() => new PostizClient({ baseUrl: "https://api.postiz.com", apiKey: "  " })).toThrow(PostizError);
    expect(() => new PostizClient({ baseUrl: "http://postiz.example.com", apiKey: KEY })).toThrow(/https/);
  });
});

/* ------------------------------------------------------------------ the key store */

const plainStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (t) => Buffer.from(`enc:${t}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ""),
};

function keyStore(server: ReturnType<typeof postizServer>, storage: SafeStorageLike = plainStorage, initial: PostizSettings = { ...DEFAULT_POSTIZ }) {
  let settings = initial;
  const log = vi.fn();
  const store = new PostizKeyStore({ settings: () => settings, setSettings: (s) => (settings = s), secrets: new SecretBox(storage), fetch: server.fetchImpl, log, timeoutMs: 2000 });
  return { store, log, settings: () => settings };
}

describe("PostizKeyStore", () => {
  it("starts without a key, seals a checked key, and never returns it", async () => {
    const server = postizServer();
    const { store, log, settings } = keyStore(server);
    expect(store.status()).toEqual({ configured: false, baseUrl: "https://api.postiz.com", encryption: true });
    expect(store.client()).toBeNull();
    const connection = await store.set({ baseUrl: "https://api.postiz.com/", apiKey: ` ${KEY} ` });
    expect(connection.organization).toEqual({ id: "org-1", name: "Gerald Studio" });
    expect(connection.channels.map((c) => c.id)).toEqual(["int-tt", "int-yt"]);
    expect(server.calls.map((c) => c.url.replace(/^.*\/public\/v1/, ""))).toEqual(["/is-connected", "/me", "/integrations"]);
    expect(settings()).toEqual({ baseUrl: "https://api.postiz.com", keySealed: Buffer.from(`enc:${KEY}`).toString("base64") });
    expect(settings().keySealed).not.toContain(KEY);
    const status = store.status();
    expect(status).toEqual({ configured: true, baseUrl: "https://api.postiz.com", encryption: true });
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(JSON.stringify(connection)).not.toContain(KEY);
    expect(log.mock.calls.map((c) => String(c[1])).join("\n")).not.toContain(KEY);
    expect(store.client()?.baseUrl).toBe("https://api.postiz.com/public/v1");
  });

  it("keeps the previous key when the new one is refused, unreachable or the address is bad", async () => {
    const server = postizServer();
    const { store, settings } = keyStore(server);
    await store.set({ baseUrl: "https://api.postiz.com", apiKey: KEY });
    const before = settings();
    await expect(store.set({ baseUrl: "https://api.postiz.com", apiKey: "wrong-key-123456" })).rejects.toMatchObject({ code: "unauthorized" });
    expect(settings()).toEqual(before);
    const down = postizServer({
      "/is-connected": () => {
        throw new TypeError("fetch failed");
      },
    });
    const other = keyStore(down, plainStorage, before);
    await expect(other.store.set({ baseUrl: "https://api.postiz.com", apiKey: "another-key-123456" })).rejects.toMatchObject({ code: "network" });
    expect(other.settings()).toEqual(before);
    await expect(store.set({ baseUrl: "http://postiz.example.com", apiKey: KEY })).rejects.toMatchObject({ code: "badUrl" });
    await expect(store.set({ baseUrl: "https://api.postiz.com", apiKey: "   " })).rejects.toMatchObject({ code: "unauthorized" });
    expect(settings()).toEqual(before);
    expect(store.status().configured).toBe(true);
    // a self-hosted address is kept as typed (without the trailing slash) and the client adds /public/v1
    const own = postizServer();
    const self = keyStore(own);
    await self.store.set({ baseUrl: "https://postiz.example.com/api/", apiKey: KEY });
    expect(self.settings().baseUrl).toBe("https://postiz.example.com/api");
    expect(own.calls[0].url).toBe("https://postiz.example.com/api/public/v1/is-connected");
  });

  it("does not save the key for an address that answers like a web page instead of Postiz", async () => {
    const page = postizServer({ "/is-connected": () => json({ connected: true }), "/me": () => json({ title: "Welcome" }) });
    const { store, settings } = keyStore(page);
    await expect(store.set({ baseUrl: "https://typo.example.com", apiKey: KEY })).rejects.toMatchObject({ message: /does not answer like Postiz/ });
    expect(settings().keySealed).toBe("");
    expect(store.status().configured).toBe(false);
  });

  it("forgets the key (the address stays) and refuses to store one without secure storage", async () => {
    const server = postizServer();
    const { store, settings } = keyStore(server);
    await store.set({ baseUrl: "https://postiz.example.com", apiKey: KEY });
    expect(store.forget()).toEqual({ configured: false, baseUrl: "https://postiz.example.com", encryption: true });
    expect(settings()).toEqual({ baseUrl: "https://postiz.example.com", keySealed: "" });
    expect(store.client()).toBeNull();
    const noCrypto = keyStore(server, { ...plainStorage, isEncryptionAvailable: () => false });
    expect(noCrypto.store.status()).toEqual({ configured: false, baseUrl: "https://api.postiz.com", encryption: false });
    await expect(noCrypto.store.set({ baseUrl: "https://api.postiz.com", apiKey: KEY })).rejects.toThrow(/Secure storage/);
    expect(noCrypto.settings().keySealed).toBe("");
    // a sealed key this PC cannot open counts as not configured
    const broken = keyStore(server, { ...plainStorage, decryptString: () => { throw new Error("DPAPI"); } }, { baseUrl: "https://api.postiz.com", keySealed: "Zm9v" });
    expect(broken.store.status().configured).toBe(false);
    expect(broken.store.client()).toBeNull();
  });
});

/* ------------------------------------------------------------------ the service */

describe("SocialService", () => {
  it("serves the channels from a one-minute cache, refresh skips it, and nothing without a key", async () => {
    const server = postizServer();
    let now = 1_000_000;
    const { store } = keyStore(server);
    const service = new SocialService(store, () => now);
    expect(await service.listChannels()).toEqual([]);
    expect(await service.listNotices()).toEqual([]);
    expect(server.calls).toHaveLength(0);
    const connection = await service.setKey({ baseUrl: "https://api.postiz.com", apiKey: KEY });
    expect(connection.channels).toHaveLength(2);
    const integrationCalls = () => server.calls.filter((c) => c.url.endsWith("/integrations")).length;
    expect(integrationCalls()).toBe(1);
    expect(await service.listChannels()).toHaveLength(2); // the set's answer fills the cache
    expect(integrationCalls()).toBe(1);
    now += CHANNELS_CACHE_MS - 1;
    await service.listChannels();
    expect(integrationCalls()).toBe(1);
    await service.listChannels(true);
    expect(integrationCalls()).toBe(2);
    now += CHANNELS_CACHE_MS;
    await service.listChannels();
    expect(integrationCalls()).toBe(3);
    expect(await service.listNotices(1)).toEqual([{ id: "n1", content: "TikTok login expired", createdAt: "2026-10-18T09:00:00.000Z", read: false }]);
    expect(server.calls.at(-1)!.url).toMatch(/\/notifications\?page=1$/);
    expect(service.forgetKey().configured).toBe(false);
    expect(await service.listChannels()).toEqual([]);
    expect(integrationCalls()).toBe(3);
  });
});

/* ------------------------------------------------------------------ the bridge */

describe("the social bridge channels", () => {
  const page = "app://jumpingballslive/en/simulator/";
  it("are in the contract's method table and registered by the main process", () => {
    expect(BRIDGE_METHODS["social.key.status"]).toBe("social:key-status");
    expect(BRIDGE_METHODS["social.key.set"]).toBe("social:key-set");
    expect(BRIDGE_METHODS["social.key.forget"]).toBe("social:key-forget");
    expect(BRIDGE_METHODS["social.channels.list"]).toBe("social:channels");
    expect(BRIDGE_METHODS["social.notices.list"]).toBe("social:notices");
    // phase 1's five channels and phase 2's seven (postizPosting.test.ts checks the latter's arguments)
    expect(Object.values(IPC).filter((c) => c.startsWith("social:")).sort()).toEqual(["social:audit", "social:channel-settings", "social:channels", "social:key-forget", "social:key-set", "social:key-status", "social:notices", "social:post", "social:post-delete", "social:posts", "social:prepare", "social:slot"]);
    const table = Object.fromEntries(Object.values(IPC).map((c) => [c, vi.fn()])) as unknown as HandlerTable;
    const handled: string[] = [];
    registerHandlers({ handle: (c) => handled.push(c), on: () => {} }, table);
    for (const c of ["social:key-status", "social:key-set", "social:key-forget", "social:channels", "social:notices"]) expect(handled).toContain(c);
  });

  it("checks the arguments: a bounded address and key, a boolean refresh, a page number", async () => {
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: "https://api.postiz.com", apiKey: KEY }])).toBeNull();
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: "", apiKey: "k" }])).toBeNull();
    expect(checkIpcArgs(IPC.socialKeySet, [])).toMatch(/social\.key\.set/);
    expect(checkIpcArgs(IPC.socialKeySet, ["key"])).toMatch(/social\.key\.set/);
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: "https://api.postiz.com" }])).toMatch(/apiKey/);
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: "https://api.postiz.com", apiKey: "" }])).toMatch(/apiKey/);
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: "https://api.postiz.com", apiKey: "k".repeat(501) }])).toMatch(/apiKey/);
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: "https://" + "a".repeat(500), apiKey: "k" }])).toMatch(/baseUrl/);
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: 7, apiKey: "k" }])).toMatch(/baseUrl/);
    for (const ok of [undefined, true, false]) expect(checkIpcArgs(IPC.socialChannels, [ok])).toBeNull();
    expect(checkIpcArgs(IPC.socialChannels, ["yes"])).toMatch(/refresh/);
    for (const ok of [undefined, 0, 3]) expect(checkIpcArgs(IPC.socialNotices, [ok])).toBeNull();
    for (const bad of [-1, 1.5, "0", NaN]) expect(checkIpcArgs(IPC.socialNotices, [bad])).toMatch(/page/);
    expect(checkIpcArgs(IPC.socialKeyStatus, [])).toBeNull();
    expect(checkIpcArgs(IPC.socialKeyForget, [])).toBeNull();
    const handler = vi.fn(async () => ({ configured: true }));
    await expect(guarded(IPC.socialKeySet as IpcChannel, handler, page, [{ baseUrl: "https://api.postiz.com", apiKey: KEY }])).resolves.toEqual({ configured: true });
    await expect(guarded(IPC.socialKeySet as IpcChannel, handler, page, [{ baseUrl: "https://api.postiz.com" }])).rejects.toThrow(/invalid arguments/);
    await expect(guarded(IPC.socialKeyStatus as IpcChannel, handler, "https://evil.example/", [])).rejects.toThrow(/not from the app/);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
