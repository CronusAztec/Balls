import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { containerStatusRequest, createReelContainerRequest, permalinkRequest, publishRequest } from "../src/lib/bot/instagram";
import {
  StateStore,
  Store,
  callbackPage,
  composeFor,
  createRelay,
  igContainerRequest,
  igPermalinkRequest,
  igPublishRequest,
  igStatusRequest,
  parseMultipart,
  publicAccount,
  readConfig,
  redact,
  sameSecret,
  tiktokChunks,
  tiktokErrorMessage,
} from "./server.mjs";

/*
 * --- social-publish --- The self-hosted relay (relay/server.mjs): the key / account store, the one-time OAuth states, the
 * sign-in flows and the publishing flows of TikTok, Instagram and YouTube – all against mocked platform endpoints (no
 * network: the relay's `fetch` is a script of answers; the tests talk to the relay itself on 127.0.0.1).
 */

const MB = 1024 * 1024;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

/** A scripted platform: handlers matched in order by method and URL prefix / regexp; every call is recorded. */
function platformMock(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body === undefined || init.body === null ? null : typeof init.body === "string" ? init.body : Buffer.from(init.body);
    const call = { url: String(url), method, headers: init.headers || {}, body };
    calls.push(call);
    for (const h of handlers) {
      if (h.method && h.method !== method) continue;
      if (typeof h.url === "string" ? !call.url.startsWith(h.url) : !h.url.test(call.url)) continue;
      const out = typeof h.reply === "function" ? await h.reply(call, calls) : h.reply;
      if (out instanceof Error) throw out;
      const payload = out.body === undefined || out.body === null ? null : typeof out.body === "string" ? out.body : JSON.stringify(out.body);
      return new Response(payload, { status: out.status ?? 200, headers: { "Content-Type": "application/json", ...(out.headers ?? {}) } });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

const ENV = {
  RELAY_ADMIN_KEY: "admin-secret-123456",
  RELAY_ALLOWED_ORIGINS: "https://site.example",
  RELAY_PUBLIC_URL: "http://relay.test",
  TIKTOK_CLIENT_KEY: "tt-client-key",
  TIKTOK_CLIENT_SECRET: "tt-secret-abcdef",
  IG_APP_ID: "ig-app-id",
  IG_APP_SECRET: "ig-secret-abcdef",
  YT_CLIENT_ID: "yt-client-id",
  YT_CLIENT_SECRET: "yt-secret-abcdef",
};

async function startRelay({ env = {}, fetchImpl, youtubeChunk = 256 * 1024 } = {}) {
  const dir = tmp();
  const relay = createRelay({ env: { ...ENV, RELAY_DATA_DIR: dir, ...env }, fetch: fetchImpl, sleep: async () => {}, pollMs: 0, retryDelayMs: 0, youtubeChunk, log: { warn() {}, error() {} } });
  const server = await relay.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${server.address().port}`;
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { relay, base, dir };
}

async function api(base, pathname, { method = "GET", key, body, headers = {}, origin } = {}) {
  const h = { ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  if (origin) h.Origin = origin;
  let payload = body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    payload = JSON.stringify(body);
    h["Content-Type"] = "application/json";
  }
  const res = await fetch(`${base}${pathname}`, { method, headers: h, body: payload, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const adminKey = async (base, label) => (await api(base, "/api/keys", { method: "POST", key: ENV.RELAY_ADMIN_KEY, body: { label } })).json;

/** Runs a whole OAuth sign-in through the relay: connect link → /connect redirect → callback. */
async function signIn(base, key, platform, code = "the-code") {
  const link = await api(base, `/api/connect/${platform}`, { method: "POST", key, body: { origin: "https://site.example" } });
  expect(link.status).toBe(200);
  const connectUrl = new URL(link.json.url);
  expect(connectUrl.origin).toBe("http://relay.test");
  const state = connectUrl.searchParams.get("state");
  const redirect = await api(base, `${connectUrl.pathname}${connectUrl.search}`);
  expect(redirect.status).toBe(302);
  const provider = new URL(redirect.headers.get("location"));
  expect(provider.searchParams.get("state")).toBe(state);
  const callback = await api(base, `/oauth/${platform}/callback?code=${code}&state=${state}`);
  return { provider, callback, state };
}

async function waitJob(base, key, id) {
  for (let i = 0; i < 500; i++) {
    const r = await api(base, `/api/jobs/${id}`, { key });
    if (r.json?.status && r.json.status !== "running") return r.json;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error("job did not finish");
}

describe("store: access keys and accounts", () => {
  it("keeps keys as hashes, finds them by the secret and scopes accounts to their key", () => {
    const dir = tmp();
    cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "relay.json");
    const store = new Store(file, { now: () => 1000 });
    const a = store.createKey("Alice");
    const b = store.createKey("Bob");
    expect(a.key).toMatch(/^jbl_[\w-]{20,}$/);
    expect(fs.readFileSync(file, "utf8")).not.toContain(a.key);
    expect(store.keyFor(a.key)?.id).toBe(a.id);
    expect(store.keyFor(`${a.key}x`)).toBeNull();
    expect(store.keyFor("")).toBeNull();
    const acc = store.upsertAccount(a.id, "tiktok", "open-1", { name: "Alice Tok", handle: "@alice", tokens: { access: "secret-access-token", refresh: "secret-refresh" } });
    // The same platform user again: updated, not duplicated.
    store.upsertAccount(a.id, "tiktok", "open-1", { name: "Alice Tok 2", tokens: { access: "newer-token" } });
    store.upsertAccount(b.id, "tiktok", "open-1", { name: "Bob's view of the same user", tokens: { access: "bob-token" } });
    expect(store.accountsFor(a.id)).toHaveLength(1);
    expect(store.accountsFor(a.id)[0].name).toBe("Alice Tok 2");
    expect(store.account(b.id, acc.id)).toBeNull();
    expect(JSON.stringify(publicAccount(store.accountsFor(a.id)[0]))).not.toContain("token");
    // Persisted and read back.
    const again = new Store(file);
    expect(again.keyFor(b.key)?.label).toBe("Bob");
    expect(again.listKeys().map((k) => [k.label, k.accounts])).toEqual([
      ["Alice", 1],
      ["Bob", 1],
    ]);
    expect(again.removeAccount(b.id, acc.id)).toBe(false);
    expect(again.deleteKey(a.id)).toBe(true);
    expect(again.accountsFor(a.id)).toHaveLength(0);
    expect(again.keyFor(a.key)).toBeNull();
    expect(sameSecret("x-secret", "x-secret")).toBe(true);
    expect(sameSecret("x-secret", "y-secret")).toBe(false);
  });
});

describe("OAuth state", () => {
  it("is single-use and expires after ten minutes", () => {
    let now = 0;
    const states = new StateStore({ now: () => now });
    const s = states.create({ keyId: "k1", platform: "tiktok", origin: "https://site.example" });
    expect(s).toMatch(/^[0-9a-f]{36}$/);
    expect(states.peek(s)?.platform).toBe("tiktok");
    expect(states.take(s)?.keyId).toBe("k1");
    expect(states.take(s)).toBeNull();
    const late = states.create({ keyId: "k1", platform: "youtube", origin: null });
    now = 10 * 60 * 1000 + 1;
    expect(states.peek(late)).toBeNull();
    expect(states.take("nope")).toBeNull();
  });
});

describe("helpers", () => {
  it("parses a multipart body made by FormData", async () => {
    const fd = new FormData();
    fd.append("accounts", "a_1,a_2");
    fd.append("caption", "Hello – ü\nline 2");
    fd.append("file", new Blob([Buffer.from("0123456789\r\n--x")], { type: "video/mp4" }), "clip.mp4");
    const res = new Response(fd);
    const { fields, files } = parseMultipart(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type"));
    expect(fields).toEqual({ accounts: "a_1,a_2", caption: "Hello – ü\nline 2" });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "file", filename: "clip.mp4", type: "video/mp4" });
    expect(files[0].data.toString()).toBe("0123456789\r\n--x");
    expect(() => parseMultipart(Buffer.from("x"), "text/plain")).toThrow();
  });

  it("cuts TikTok uploads the way the Content Posting API wants", () => {
    expect(tiktokChunks(3 * MB)).toEqual({ chunkSize: 3 * MB, total: 1, ranges: [[0, 3 * MB - 1]] });
    const big = tiktokChunks(23 * MB + 5);
    expect(big.chunkSize).toBe(10 * MB);
    expect(big.total).toBe(2);
    expect(big.ranges).toEqual([
      [0, 10 * MB - 1],
      [10 * MB, 23 * MB + 4],
    ]);
  });

  it("composes each platform's words (the page's own, or the shared ones of the CLI)", () => {
    const shared = { title: "Can it <escape>?", caption: "Ring escape\nDay 3", hashtags: "#ball, satisfying #fyp #shorts" };
    expect(composeFor("tiktok", shared)).toEqual({ title: "Can it <escape>?", text: "Ring escape\nDay 3\n\n#ball #satisfying #fyp", tags: [] });
    expect(composeFor("instagram", shared).text).toBe("Ring escape\nDay 3\n\n#ball #satisfying #reels");
    const yt = composeFor("youtube", shared);
    expect(yt.title).toBe("Can it escape?");
    expect(yt.text).toBe("Ring escape\nDay 3\n\n#Shorts #ball #satisfying");
    expect(yt.tags).toEqual(["Shorts", "ball", "satisfying"]);
    const own = composeFor("youtube", { posts: { youtube: { title: "T", text: "desc <b>", hashtags: ["#Shorts"], tags: ["Shorts", "x"] } } });
    expect(own).toEqual({ title: "T", text: "desc b", tags: ["Shorts", "x"] });
  });

  it("builds the Instagram requests exactly as src/lib/bot/instagram.ts does", () => {
    const shared = { userId: "17841400000000000", accessToken: "TOKEN/with+chars" };
    const relayConfig = { ...shared, base: "https://graph.facebook.com/v23.0" };
    const input = { videoUrl: "https://relay.example/media/abc.mp4", caption: "Hi #reels", thumbOffsetMs: 1500 };
    expect(igContainerRequest(relayConfig, input)).toEqual(createReelContainerRequest(shared, input));
    expect(igStatusRequest(relayConfig, "c1")).toEqual(containerStatusRequest(shared, "c1"));
    expect(igPublishRequest(relayConfig, "c1")).toEqual(publishRequest(shared, "c1"));
    expect(igPermalinkRequest(relayConfig, "m1")).toEqual(permalinkRequest(shared, "m1"));
  });

  it("explains TikTok's unaudited-app refusal and hides secrets in messages", () => {
    expect(tiktokErrorMessage("unaudited_client_can_only_post_to_private_accounts")).toMatch(/not yet approved/);
    expect(redact("token=abcdef123 and abcdef123", ["abcdef123"])).toBe("token=*** and ***");
  });

  it("ends the OAuth popup with a postMessage to the site's origin, never a token", () => {
    const html = callbackPage({ ok: true, platform: "tiktok", accounts: [{ id: "a_1", name: "<b>Tok</b>", handle: null, tokens: { access: "SECRET" } }], origin: "https://site.example" });
    expect(html).toContain('postMessage(d,"https://site.example")');
    expect(html).toContain("&lt;b&gt;Tok&lt;/b&gt;");
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("<b>Tok");
    const failed = callbackPage({ ok: false, platform: "tiktok", message: "nope", origin: null });
    expect(failed).not.toContain("postMessage");
    expect(failed).toContain("nope");
  });

  it("reads its configuration from the environment", () => {
    const cfg = readConfig({ PORT: "9000", RELAY_ALLOWED_ORIGINS: "https://a.example/, http://localhost:3000", IG_LOGIN: "instagram", TIKTOK_SOURCE: "pull", RELAY_MAX_UPLOAD_MB: "50" });
    expect(cfg.port).toBe(9000);
    expect(cfg.publicUrl).toBe("http://localhost:9000");
    expect(cfg.allowedOrigins).toEqual(["https://a.example", "http://localhost:3000"]);
    expect(cfg.instagram.login).toBe("instagram");
    expect(cfg.tiktok.source).toBe("pull");
    expect(cfg.maxUploadBytes).toBe(50 * MB);
  });
});

describe("the HTTP API", () => {
  it("answers health without a key, needs one for the rest and sends CORS only to allowed origins", async () => {
    const { base } = await startRelay({ fetchImpl: platformMock([]).fetchImpl, env: { YT_CLIENT_SECRET: "" } });
    const health = await api(base, "/api/health", { origin: "https://site.example" });
    expect(health.status).toBe(200);
    expect(health.json.platforms).toEqual({ tiktok: true, instagram: true, youtube: false });
    expect(health.headers.get("access-control-allow-origin")).toBe("https://site.example");
    const other = await api(base, "/api/health", { origin: "https://evil.example" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await fetch(`${base}/api/accounts`, { method: "OPTIONS", headers: { Origin: "https://site.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
    expect((await api(base, "/api/me")).status).toBe(401);
    expect((await api(base, "/api/accounts", { key: "wrong" })).status).toBe(401);
    expect((await api(base, "/api/keys", { method: "POST", key: "not-admin", body: { label: "x" } })).status).toBe(401);
    const alice = await adminKey(base, "Alice");
    expect(alice.label).toBe("Alice");
    const me = await api(base, "/api/me", { key: alice.key });
    expect(me.json.key).toEqual({ id: alice.id, label: "Alice" });
    const keys = await api(base, "/api/keys", { key: ENV.RELAY_ADMIN_KEY });
    expect(keys.json.keys).toEqual([expect.objectContaining({ id: alice.id, label: "Alice", accounts: 0 })]);
    expect(JSON.stringify(keys.json)).not.toContain(alice.key);
    // A platform without app keys, an unknown one and an origin that is not allowed are refused.
    expect((await api(base, "/api/connect/youtube", { method: "POST", key: alice.key, body: { origin: "https://site.example" } })).json.error.code).toBe("not_configured");
    expect((await api(base, "/api/connect/myspace", { method: "POST", key: alice.key, body: {} })).status).toBe(404);
    expect((await api(base, "/api/connect/tiktok", { method: "POST", key: alice.key, body: { origin: "https://evil.example" } })).json.error.code).toBe("origin_not_allowed");
    expect((await api(base, "/nothing")).status).toBe(404);
  });

  it("connects TikTok, Instagram (two Pages) and YouTube accounts per key, never showing a token", async () => {
    const { fetchImpl, calls } = platformMock([
      { method: "POST", url: "https://open.tiktokapis.com/v2/oauth/token/", reply: { body: { access_token: "tt-access-1", expires_in: 86400, open_id: "open-1", refresh_token: "tt-refresh-1", refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" } } },
      { method: "GET", url: "https://open.tiktokapis.com/v2/user/info/", reply: { body: { data: { user: { open_id: "open-1", display_name: "Smoke Tok", avatar_url: "https://p16.example/a.jpg" } }, error: { code: "ok" } } } },
      { method: "POST", url: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", reply: { body: { data: { creator_username: "smoketok", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } } } },
      { method: "GET", url: /graph\.facebook\.com\/v23\.0\/oauth\/access_token\?.*fb_exchange_token/, reply: { body: { access_token: "fb-long", expires_in: 5184000 } } },
      { method: "GET", url: "https://graph.facebook.com/v23.0/oauth/access_token", reply: { body: { access_token: "fb-short" } } },
      {
        method: "GET",
        url: "https://graph.facebook.com/v23.0/me/accounts",
        reply: { body: { data: [{ id: "page1", name: "Page One", access_token: "page-token-1", instagram_business_account: { id: "1784001", username: "ig_one", name: "IG One", profile_picture_url: "https://cdn.example/1.jpg" } }, { id: "page2", name: "Page Two", access_token: "page-token-2", instagram_business_account: { id: "1784002", username: "ig_two" } }, { id: "page3", name: "No IG" }] } },
      },
      { method: "POST", url: "https://oauth2.googleapis.com/token", reply: { body: { access_token: "ya29.first", expires_in: 3599, refresh_token: "yt-refresh-1", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly" } } },
      { method: "GET", url: "https://www.googleapis.com/youtube/v3/channels", reply: { body: { items: [{ id: "UC123", snippet: { title: "Smoke Channel", customUrl: "@smokechannel", thumbnails: { default: { url: "https://yt3.example/a.jpg" } } } }] } } },
    ]);
    const { base } = await startRelay({ fetchImpl });
    const alice = await adminKey(base, "Alice");
    const bob = await adminKey(base, "Bob");

    const tt = await signIn(base, alice.key, "tiktok", "tt-code");
    expect(tt.provider.origin + tt.provider.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(tt.provider.searchParams.get("client_key")).toBe("tt-client-key");
    expect(tt.provider.searchParams.get("scope")).toBe("user.info.basic,video.publish");
    expect(tt.provider.searchParams.get("redirect_uri")).toBe("http://relay.test/oauth/tiktok/callback");
    expect(tt.callback.status).toBe(200);
    expect(tt.callback.text).toContain('postMessage(d,"https://site.example")');
    expect(tt.callback.text).not.toContain("tt-access-1");
    const exchange = calls.find((c) => c.url.startsWith("https://open.tiktokapis.com/v2/oauth/token/"));
    expect(new URLSearchParams(exchange.body)).toEqual(new URLSearchParams({ client_key: "tt-client-key", client_secret: "tt-secret-abcdef", code: "tt-code", grant_type: "authorization_code", redirect_uri: "http://relay.test/oauth/tiktok/callback" }));
    // The state is used up: the same callback again fails.
    const replay = await api(base, `/oauth/tiktok/callback?code=tt-code&state=${tt.state}`);
    expect(replay.status).toBe(400);

    const ig = await signIn(base, alice.key, "instagram", "ig-code");
    expect(ig.provider.origin + ig.provider.pathname).toBe("https://www.facebook.com/v23.0/dialog/oauth");
    expect(ig.provider.searchParams.get("scope")).toContain("instagram_content_publish");
    expect(ig.callback.status).toBe(200);

    const yt = await signIn(base, bob.key, "youtube", "yt-code");
    expect(yt.provider.searchParams.get("access_type")).toBe("offline");
    expect(yt.provider.searchParams.get("scope")).toContain("youtube.upload");

    const aliceAccounts = (await api(base, "/api/accounts", { key: alice.key })).json.accounts;
    expect(aliceAccounts.map((a) => [a.platform, a.name, a.handle])).toEqual([
      ["tiktok", "Smoke Tok", "@smoketok"],
      ["instagram", "IG One", "@ig_one"],
      ["instagram", "ig_two", "@ig_two"],
    ]);
    const bobAccounts = (await api(base, "/api/accounts", { key: bob.key })).json.accounts;
    expect(bobAccounts).toEqual([expect.objectContaining({ platform: "youtube", name: "Smoke Channel", handle: "@smokechannel", avatar: "https://yt3.example/a.jpg", status: "ok" })]);
    const everything = JSON.stringify([aliceAccounts, bobAccounts]);
    for (const secret of ["tt-access-1", "tt-refresh-1", "page-token-1", "fb-long", "ya29.first", "yt-refresh-1"]) expect(everything).not.toContain(secret);

    // Bob cannot remove Alice's account; Alice can; revoking Bob's key forgets his accounts.
    expect((await api(base, `/api/accounts/${aliceAccounts[0].id}`, { method: "DELETE", key: bob.key })).status).toBe(404);
    expect((await api(base, `/api/accounts/${aliceAccounts[0].id}`, { method: "DELETE", key: alice.key })).status).toBe(200);
    expect((await api(base, "/api/accounts", { key: alice.key })).json.accounts).toHaveLength(2);
    expect((await api(base, `/api/keys/${bob.id}`, { method: "DELETE", key: ENV.RELAY_ADMIN_KEY })).status).toBe(200);
    expect((await api(base, "/api/accounts", { key: bob.key })).status).toBe(401);
  });

  it("connects an Instagram account with Instagram Login (IG_LOGIN=instagram) and publishes through graph.instagram.com", async () => {
    const { fetchImpl, calls } = platformMock([
      { method: "POST", url: "https://api.instagram.com/oauth/access_token", reply: { body: { data: [{ access_token: "ig-short", user_id: "9001", permissions: "instagram_business_basic,instagram_business_content_publish" }] } } },
      { method: "GET", url: "https://graph.instagram.com/access_token?", reply: { body: { access_token: "ig-long", token_type: "bearer", expires_in: 5184000 } } },
      { method: "GET", url: "https://graph.instagram.com/v23.0/me?", reply: { body: { user_id: "9001", username: "direct_ig", name: "Direct IG", profile_picture_url: "https://cdn.example/d.jpg" } } },
      { method: "POST", url: "https://graph.instagram.com/v23.0/9001/media_publish", reply: { body: { id: "m9" } } },
      { method: "POST", url: "https://graph.instagram.com/v23.0/9001/media", reply: { body: { id: "c9" } } },
      { method: "GET", url: "https://graph.instagram.com/v23.0/c9?", reply: { body: { status_code: "FINISHED" } } },
      { method: "GET", url: "https://graph.instagram.com/v23.0/m9?", reply: { body: { permalink: "https://www.instagram.com/reel/XYZ/" } } },
    ]);
    const { base } = await startRelay({ fetchImpl, env: { IG_LOGIN: "instagram" } });
    const alice = await adminKey(base, "Alice");
    const ig = await signIn(base, alice.key, "instagram", "ig-code");
    expect(ig.provider.origin + ig.provider.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(ig.provider.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(ig.callback.status).toBe(200);
    const [account] = (await api(base, "/api/accounts", { key: alice.key })).json.accounts;
    expect(account).toMatchObject({ platform: "instagram", name: "Direct IG", handle: "@direct_ig" });
    const fd = new FormData();
    fd.append("accounts", account.id);
    fd.append("caption", "Hello");
    fd.append("hashtags", "#ball");
    fd.append("file", new Blob([Buffer.alloc(2048)], { type: "video/mp4" }), "c.mp4");
    const started = await api(base, "/api/publish", { method: "POST", key: alice.key, body: fd });
    const job = await waitJob(base, alice.key, started.json.jobId);
    expect(job.items[0]).toMatchObject({ status: "published", link: "https://www.instagram.com/reel/XYZ/" });
    const container = new URLSearchParams(calls.find((c) => c.url === "https://graph.instagram.com/v23.0/9001/media").body);
    expect(container.get("access_token")).toBe("ig-long");
    expect(container.get("caption")).toBe("Hello\n\n#ball #reels");
  });

  it("reports a sign-in the user cancelled back to the page", async () => {
    const { base } = await startRelay({ fetchImpl: platformMock([]).fetchImpl });
    const alice = await adminKey(base, "Alice");
    const link = await api(base, "/api/connect/tiktok", { method: "POST", key: alice.key, body: { origin: "https://site.example" } });
    const state = new URL(link.json.url).searchParams.get("state");
    const r = await api(base, `/oauth/tiktok/callback?error=access_denied&error_description=User%20cancelled&state=${state}`);
    expect(r.status).toBe(400);
    expect(r.text).toContain('"type":"error"');
    expect(r.text).toContain("User cancelled");
    expect(r.text).toContain('postMessage(d,"https://site.example")');
  });

  it("publishes one upload to TikTok, two Instagram accounts and YouTube, with per-account results", async () => {
    let ttInit = 0;
    let ttStatus = 0;
    const igPolls = {};
    let ytPut = 0;
    const clip = Buffer.alloc(600 * 1024, 7);
    const { fetchImpl, calls } = platformMock([
      // TikTok: the app is not audited, so a public post is refused and the relay posts privately.
      { method: "POST", url: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", reply: { body: { data: { creator_username: "smoketok", privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } } } },
      {
        method: "POST",
        url: "https://open.tiktokapis.com/v2/post/publish/video/init/",
        reply: (call) => {
          ttInit++;
          const body = JSON.parse(call.body);
          if (body.post_info.privacy_level !== "SELF_ONLY") return { status: 403, body: { error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "Please review our integration guidelines" } } };
          return { body: { data: { publish_id: "v_pub_1", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" }, error: { code: "ok" } } };
        },
      },
      { method: "PUT", url: "https://open-upload.tiktokapis.com/video/", reply: { status: 201, body: "" } },
      { method: "POST", url: "https://open.tiktokapis.com/v2/post/publish/status/fetch/", reply: () => (++ttStatus < 2 ? { body: { data: { status: "PROCESSING_UPLOAD" }, error: { code: "ok" } } } : { body: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [777] }, error: { code: "ok" } } }) },
      // Instagram: account 1 publishes, account 2's container fails processing.
      { method: "POST", url: /graph\.facebook\.com\/v23\.0\/(1784001|1784002)\/media$/, reply: (call) => ({ body: { id: call.url.includes("1784001") ? "cont-1" : "cont-2" } }) },
      {
        method: "GET",
        url: /graph\.facebook\.com\/v23\.0\/cont-\d\?/,
        reply: (call) => {
          const id = /cont-\d/.exec(call.url)[0];
          igPolls[id] = (igPolls[id] ?? 0) + 1;
          if (id === "cont-2") return { body: { status_code: "ERROR", status: "Error: unsupported format" } };
          return { body: { status_code: igPolls[id] < 2 ? "IN_PROGRESS" : "FINISHED" } };
        },
      },
      { method: "POST", url: "https://graph.facebook.com/v23.0/1784001/media_publish", reply: { body: { id: "media-1" } } },
      { method: "GET", url: "https://graph.facebook.com/v23.0/media-1?", reply: { body: { permalink: "https://www.instagram.com/reel/ABC/" } } },
      // YouTube: the token has expired (refresh), then a resumable upload with a 308, a 503 and a resume.
      { method: "POST", url: "https://oauth2.googleapis.com/token", reply: { body: { access_token: "ya29.fresh", expires_in: 3599 } } },
      { method: "POST", url: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable", reply: { headers: { Location: "https://upload.youtube.test/session-1" }, body: "" } },
      {
        method: "PUT",
        url: "https://upload.youtube.test/session-1",
        reply: (call) => {
          const range = call.headers["Content-Range"];
          if (range === `bytes */${clip.length}`) return { status: 308, headers: { Range: "bytes=0-524287" }, body: null };
          ytPut++;
          if (ytPut === 1) return { status: 308, headers: { Range: "bytes=0-262143" }, body: null };
          if (ytPut === 2) return { status: 503, body: { error: { code: 503, message: "backend error" } } };
          return { status: 200, body: { id: "yt123" } };
        },
      },
    ]);
    const { relay, base } = await startRelay({ fetchImpl });
    const alice = await adminKey(base, "Alice");
    const bob = await adminKey(base, "Bob");
    const keyId = relay.store.keyFor(alice.key).id;
    const tt = relay.store.upsertAccount(keyId, "tiktok", "open-1", { name: "Smoke Tok", handle: "@smoketok", tokens: { access: "tt-access", refresh: "tt-refresh", expiresAt: Date.now() + 86400e3 } });
    const ig1 = relay.store.upsertAccount(keyId, "instagram", "1784001", { name: "IG One", handle: "@ig_one", tokens: { access: "page-token-1" }, meta: { login: "facebook", igUserId: "1784001" } });
    const ig2 = relay.store.upsertAccount(keyId, "instagram", "1784002", { name: "IG Two", handle: "@ig_two", tokens: { access: "page-token-2" }, meta: { login: "facebook", igUserId: "1784002" } });
    const yt = relay.store.upsertAccount(keyId, "youtube", "UC123", { name: "Smoke Channel", tokens: { access: "ya29.old", refresh: "yt-refresh", expiresAt: 0 } });

    const fd = new FormData();
    fd.append("accounts", [tt.id, ig1.id, ig2.id, yt.id].join(","));
    fd.append("posts", JSON.stringify({ tiktok: { title: "Hook", text: "Can it escape?\n\n#ball #fyp", hashtags: ["#ball", "#fyp"] }, instagram: { title: "Hook", text: "Can it escape?\n\n#ball #reels", hashtags: ["#ball", "#reels"] }, youtube: { title: "Can it escape?", text: "Desc\n\n#Shorts #ball", hashtags: ["#Shorts", "#ball"], tags: ["Shorts", "ball"] } }));
    fd.append("visibility", "public");
    fd.append("file", new Blob([clip], { type: "video/mp4" }), "clip.mp4");
    const started = await api(base, "/api/publish", { method: "POST", key: alice.key, body: fd });
    expect(started.status).toBe(202);
    expect(started.json.job.items.map((i) => i.platform)).toEqual(["tiktok", "instagram", "instagram", "youtube"]);
    const job = await waitJob(base, alice.key, started.json.jobId);
    const byId = Object.fromEntries(job.items.map((i) => [i.accountId, i]));

    expect(job.status).toBe("partial");
    expect(byId[tt.id]).toMatchObject({ status: "published", link: "https://www.tiktok.com/@smoketok/video/777" });
    expect(byId[tt.id].note).toMatch(/not yet approved/);
    expect(ttInit).toBe(2);
    const init = JSON.parse(calls.filter((c) => c.url.endsWith("/video/init/")).pop().body);
    expect(init).toMatchObject({ post_info: { title: "Can it escape?\n\n#ball #fyp", privacy_level: "SELF_ONLY" }, source_info: { source: "FILE_UPLOAD", video_size: clip.length, chunk_size: clip.length, total_chunk_count: 1 } });
    const ttPut = calls.find((c) => c.method === "PUT" && c.url.startsWith("https://open-upload.tiktokapis.com/"));
    expect(ttPut.headers["Content-Range"]).toBe(`bytes 0-${clip.length - 1}/${clip.length}`);
    expect(ttPut.body.equals(clip)).toBe(true);

    expect(byId[ig1.id]).toMatchObject({ status: "published", link: "https://www.instagram.com/reel/ABC/" });
    expect(byId[ig2.id].status).toBe("failed");
    expect(byId[ig2.id].error).toMatch(/could not process the video \(ERROR/);
    const container = calls.find((c) => c.url.endsWith("/1784001/media"));
    const containerBody = new URLSearchParams(container.body);
    expect(containerBody.get("media_type")).toBe("REELS");
    expect(containerBody.get("caption")).toBe("Can it escape?\n\n#ball #reels");
    expect(containerBody.get("access_token")).toBe("page-token-1");
    // Instagram pulls the clip from the relay's public URL, which serves the uploaded bytes (and ranges).
    const videoUrl = new URL(containerBody.get("video_url"));
    expect(videoUrl.origin).toBe("http://relay.test");
    expect(videoUrl.pathname).toMatch(/^\/media\/[0-9a-f]{32}\.mp4$/);
    const served = await fetch(`${base}${videoUrl.pathname}`);
    expect(served.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await served.arrayBuffer()).equals(clip)).toBe(true);
    const part = await fetch(`${base}${videoUrl.pathname}`, { headers: { Range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${clip.length}`);
    expect((await fetch(`${base}/media/${"0".repeat(32)}.mp4`)).status).toBe(404);

    expect(byId[yt.id]).toMatchObject({ status: "published", link: "https://www.youtube.com/shorts/yt123" });
    const ytStart = calls.find((c) => c.url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos"));
    expect(ytStart.headers.Authorization).toBe("Bearer ya29.fresh");
    expect(JSON.parse(ytStart.body)).toEqual({ snippet: { title: "Can it escape?", description: "Desc\n\n#Shorts #ball", tags: ["Shorts", "ball"], categoryId: "24" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true } });
    const ranges = calls.filter((c) => c.url === "https://upload.youtube.test/session-1").map((c) => c.headers["Content-Range"]);
    expect(ranges).toEqual([`bytes 0-262143/${clip.length}`, `bytes 262144-524287/${clip.length}`, `bytes */${clip.length}`, `bytes 524288-${clip.length - 1}/${clip.length}`]);
    const refresh = calls.find((c) => c.url === "https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(refresh.body).get("grant_type")).toBe("refresh_token");

    // Another key cannot see the job; the tokens never reach the page.
    expect((await api(base, `/api/jobs/${started.json.jobId}`, { key: bob.key })).status).toBe(404);
    expect(JSON.stringify(job)).not.toMatch(/tt-access|page-token|ya29/);
  });

  it("marks an account whose token cannot be refreshed and says to connect it again", async () => {
    const { fetchImpl } = platformMock([{ method: "POST", url: "https://open.tiktokapis.com/v2/oauth/token/", reply: { status: 400, body: { error: "invalid_grant", error_description: "refresh token expired" } } }]);
    const { relay, base } = await startRelay({ fetchImpl });
    const alice = await adminKey(base, "Alice");
    const acc = relay.store.upsertAccount(relay.store.keyFor(alice.key).id, "tiktok", "open-9", { name: "Old Tok", tokens: { access: "old", refresh: "stale", expiresAt: 0 } });
    const fd = new FormData();
    fd.append("accounts", acc.id);
    fd.append("caption", "Hi");
    fd.append("file", new Blob([Buffer.alloc(1000)], { type: "video/mp4" }), "c.mp4");
    const started = await api(base, "/api/publish", { method: "POST", key: alice.key, body: fd });
    const job = await waitJob(base, alice.key, started.json.jobId);
    expect(job.status).toBe("failed");
    expect(job.items[0].error).toMatch(/connect the account again/);
    const accounts = (await api(base, "/api/accounts", { key: alice.key })).json.accounts;
    expect(accounts[0].status).toBe("expired");
  });

  it("refuses unknown accounts, WebM for Instagram and uploads over the size limit", async () => {
    const { relay, base } = await startRelay({ fetchImpl: platformMock([]).fetchImpl, env: { RELAY_MAX_UPLOAD_MB: "1" } });
    const alice = await adminKey(base, "Alice");
    const ig = relay.store.upsertAccount(relay.store.keyFor(alice.key).id, "instagram", "1784001", { name: "IG", tokens: { access: "t" }, meta: { login: "facebook", igUserId: "1784001" } });
    const upload = (accounts, bytes, type = "video/mp4", name = "c.mp4") => {
      const fd = new FormData();
      fd.append("accounts", accounts);
      fd.append("file", new Blob([Buffer.alloc(bytes)], { type }), name);
      return api(base, "/api/publish", { method: "POST", key: alice.key, body: fd });
    };
    expect((await upload("a_nope", 100)).status).toBe(404);
    expect((await upload(ig.id, 2 * MB)).status).toBe(413);
    const webm = await upload(ig.id, 100, "video/webm", "c.webm");
    const job = await waitJob(base, alice.key, webm.json.jobId);
    expect(job.items[0].error).toMatch(/Instagram takes MP4/);
  });
});
