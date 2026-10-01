#!/usr/bin/env node
/**
 * JumpingBallsLive publish relay (feature social-publish) – one Node 22 file, no dependencies, no framework.
 *
 * The site is a static export (GitHub Pages): it cannot keep an app secret or serve a clip at a public URL. This small
 * server does both for the Publish block of the simulator (and for `scripts/viral-bot.mjs --relay`):
 *
 *   - it holds the app secrets in its environment (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET, IG_APP_ID / IG_APP_SECRET,
 *     YT_CLIENT_ID / YT_CLIENT_SECRET) and runs the OAuth sign-ins – TikTok Login Kit v2 (user.info.basic, video.publish),
 *     Instagram through Facebook Login for Business (instagram_basic + instagram_content_publish on the Instagram
 *     professional account connected to a Facebook Page) or the Instagram API with Instagram Login
 *     (instagram_business_basic + instagram_business_content_publish, IG_LOGIN=instagram), and Google for YouTube;
 *   - it keeps the connected accounts and their refresh tokens in a JSON file (RELAY_DATA_DIR) and never hands a token out;
 *   - it publishes: TikTok's Content Posting API (direct post: creator info, video/init with FILE_UPLOAD in chunks – or
 *     PULL_FROM_URL with TIKTOK_SOURCE=pull –, status polling), Instagram's Graph API (a REELS container from the clip's
 *     public URL on this relay, status polling, media_publish – the flow of src/lib/bot/instagram.ts), YouTube's resumable
 *     upload; with retries and messages that say what to do (an app not yet approved included);
 *   - ACCESS KEYS: the admin (RELAY_ADMIN_KEY) creates one per person (POST /api/keys); every key sees only the accounts
 *     it connected, so a team or several creators share one relay, each with their own TikTok / Instagram / YouTube accounts.
 *
 * API (JSON, CORS for RELAY_ALLOWED_ORIGINS; `Authorization: Bearer <key>`):
 *   GET    /api/health                   no key: name, version, the platforms with app keys
 *   GET    /api/me                       the key's label and the platforms
 *   POST   /api/keys        (admin)      { label } → { id, label, key } – the key is shown once
 *   GET    /api/keys        (admin)      the keys (no secrets) and their account counts
 *   DELETE /api/keys/:id    (admin)      revokes a key and forgets its accounts
 *   GET    /api/accounts                 the key's accounts
 *   DELETE /api/accounts/:id             disconnects one
 *   POST   /api/connect/:platform        { origin } → { url }: a one-time sign-in link for a popup
 *   GET    /connect/:platform?state=…    starts the OAuth sign-in (redirects to the platform)
 *   GET    /oauth/:platform/callback     stores the account, tells the opener (postMessage) and closes the popup
 *   POST   /api/publish                  multipart: file, accounts (ids, comma-separated), title, caption, hashtags,
 *                                        posts (JSON per platform: title, text, tags), visibility → { jobId, job }
 *   GET    /api/jobs/:id                 per-account status, progress, links, errors
 *   GET    /media/:id.:ext               the uploaded clip at a public URL (Range requests; Instagram and TikTok pull it)
 *
 * Run: node relay/server.mjs (see relay/README.md and relay/.env.example). Tests: npx vitest run relay.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELAY_NAME = "jumpingballslive-relay";
export const RELAY_VERSION = "1.0.0";
export const PLATFORMS = ["tiktok", "instagram", "youtube"];
export const VISIBILITIES = ["public", "unlisted", "private"];
const MB = 1024 * 1024;

/* ================================================================== configuration */

/** The relay's settings from the environment (see .env.example). */
export function readConfig(env = process.env) {
  const list = (v) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  const port = Number(env.PORT || env.RELAY_PORT || 8787);
  return {
    port,
    host: env.RELAY_HOST || "0.0.0.0",
    publicUrl: String(env.RELAY_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    allowedOrigins: list(env.RELAY_ALLOWED_ORIGINS),
    adminKey: String(env.RELAY_ADMIN_KEY || ""),
    dataDir: path.resolve(env.RELAY_DATA_DIR || "relay-data"),
    maxUploadBytes: Math.max(1, Number(env.RELAY_MAX_UPLOAD_MB || 300)) * MB,
    mediaTtlMs: Math.max(1, Number(env.RELAY_MEDIA_TTL_HOURS || 24)) * 3600 * 1000,
    tiktok: { clientKey: env.TIKTOK_CLIENT_KEY || "", clientSecret: env.TIKTOK_CLIENT_SECRET || "", source: env.TIKTOK_SOURCE === "pull" ? "pull" : "file", privateFallback: env.TIKTOK_PRIVATE_FALLBACK !== "0" },
    instagram: { appId: env.IG_APP_ID || "", appSecret: env.IG_APP_SECRET || "", login: env.IG_LOGIN === "instagram" ? "instagram" : "facebook", graphVersion: env.IG_GRAPH_VERSION || "v23.0", configId: env.IG_CONFIG_ID || "" },
    youtube: { clientId: env.YT_CLIENT_ID || "", clientSecret: env.YT_CLIENT_SECRET || "" },
  };
}

/** Which platforms the relay has app keys for. */
export function configuredPlatforms(cfg) {
  return {
    tiktok: !!(cfg.tiktok.clientKey && cfg.tiktok.clientSecret),
    instagram: !!(cfg.instagram.appId && cfg.instagram.appSecret),
    youtube: !!(cfg.youtube.clientId && cfg.youtube.clientSecret),
  };
}

/* ================================================================== small helpers */

const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");
const randomHex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const iso = (ms) => new Date(ms).toISOString();

/** Constant-time comparison of two secrets (by their hashes, so the lengths never leak). */
export function sameSecret(a, b) {
  if (!a || !b) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

/** An error with a code the API returns and an HTTP status. */
export class RelayHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** An error of a platform call: `retriable` ones are tried again, `expired` marks the account for a new sign-in. */
export class PlatformError extends Error {
  constructor(message, { code = "platform_error", status, retriable = false, expired = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retriable = retriable;
    this.expired = expired;
  }
}

/** `text` with every secret replaced by "***". */
export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) {
    if (!s || s.length < 6) continue;
    out = out.split(s).join("***");
    const enc = encodeURIComponent(s);
    if (enc !== s) out = out.split(enc).join("***");
  }
  return out;
}

/* ================================================================== the account store */

/**
 * The keys and accounts, in one JSON file (written atomically, mode 600). A key is kept as its SHA-256 only; an account
 * belongs to the key that connected it and carries its tokens, which never leave the relay.
 */
export class Store {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.data = { version: 1, keys: [], accounts: [] };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw && Array.isArray(raw.keys) && Array.isArray(raw.accounts)) this.data = { version: 1, keys: raw.keys, accounts: raw.accounts };
    } catch (err) {
      if (err && err.code !== "ENOENT") throw new Error(`Cannot read ${this.file}: ${err.message}`);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomHex(3)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** A new access key; the secret is returned once and stored only as its hash. */
  createKey(label) {
    const key = `jbl_${crypto.randomBytes(24).toString("base64url")}`;
    const record = { id: `k_${randomHex(6)}`, label: String(label || "").trim().slice(0, 80) || "key", hash: sha256(key), createdAt: iso(this.now()) };
    this.data.keys.push(record);
    this.save();
    return { id: record.id, label: record.label, key, createdAt: record.createdAt };
  }

  /** The key record of a secret, or null. */
  keyFor(secret) {
    if (!secret || typeof secret !== "string") return null;
    const hash = Buffer.from(sha256(secret), "hex");
    let found = null;
    for (const k of this.data.keys) {
      const other = Buffer.from(String(k.hash), "hex");
      if (other.length === hash.length && crypto.timingSafeEqual(other, hash)) found = k;
    }
    return found;
  }

  listKeys() {
    return this.data.keys.map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt, accounts: this.data.accounts.filter((a) => a.keyId === k.id).length }));
  }

  /** Revokes a key and forgets its accounts. */
  deleteKey(id) {
    const before = this.data.keys.length;
    this.data.keys = this.data.keys.filter((k) => k.id !== id);
    if (this.data.keys.length === before) return false;
    this.data.accounts = this.data.accounts.filter((a) => a.keyId !== id);
    this.save();
    return true;
  }

  /** Adds an account to a key, or updates the one it already has for this platform user. */
  upsertAccount(keyId, platform, providerId, fields) {
    let account = this.data.accounts.find((a) => a.keyId === keyId && a.platform === platform && a.providerId === String(providerId));
    if (!account) {
      account = { id: `a_${randomHex(8)}`, keyId, platform, providerId: String(providerId), connectedAt: iso(this.now()) };
      this.data.accounts.push(account);
    }
    Object.assign(account, fields, { status: "ok", note: fields.note ?? null, updatedAt: iso(this.now()) });
    this.save();
    return account;
  }

  accountsFor(keyId) {
    return this.data.accounts.filter((a) => a.keyId === keyId);
  }

  /** A key's own account (never another key's). */
  account(keyId, id) {
    return this.data.accounts.find((a) => a.keyId === keyId && a.id === id) ?? null;
  }

  removeAccount(keyId, id) {
    const before = this.data.accounts.length;
    this.data.accounts = this.data.accounts.filter((a) => !(a.keyId === keyId && a.id === id));
    if (this.data.accounts.length === before) return false;
    this.save();
    return true;
  }

  updateAccount(id, patch) {
    const account = this.data.accounts.find((a) => a.id === id);
    if (!account) return null;
    Object.assign(account, patch, { updatedAt: iso(this.now()) });
    this.save();
    return account;
  }
}

/** What the API shows of an account: never its tokens. */
export function publicAccount(a) {
  return { id: a.id, platform: a.platform, name: a.name || a.platform, handle: a.handle || null, avatar: a.avatar || null, connectedAt: a.connectedAt || null, status: a.status === "expired" ? "expired" : "ok", note: a.note || null };
}

/* ================================================================== OAuth state */

/** One-time OAuth states (10 minutes): which key started the sign-in, for which platform, and where to report back. */
export class StateStore {
  constructor({ now = () => Date.now(), ttlMs = 10 * 60 * 1000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  create(entry) {
    this.sweep();
    const state = randomHex(18);
    this.map.set(state, { ...entry, createdAt: this.now() });
    return state;
  }

  /** The entry, still valid, without using it up. */
  peek(state) {
    if (typeof state !== "string" || !state) return null;
    const entry = this.map.get(state);
    if (!entry) return null;
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.map.delete(state);
      return null;
    }
    return entry;
  }

  /** The entry, used up (a second callback with the same state fails). */
  take(state) {
    const entry = this.peek(state);
    if (entry) this.map.delete(state);
    return entry;
  }

  sweep() {
    for (const [state, entry] of this.map) if (this.now() - entry.createdAt > this.ttlMs) this.map.delete(state);
  }
}

/* ================================================================== media (public clip URLs) */

const MEDIA_TYPES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

export function mediaExtension(fileName, type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("quicktime")) return "mov";
  if (t.includes("mp4")) return "mp4";
  const m = /\.(mp4|webm|mov|m4v)$/i.exec(String(fileName || ""));
  return m ? (m[1].toLowerCase() === "m4v" ? "mp4" : m[1].toLowerCase()) : "mp4";
}

/** The uploaded clips, as files under an unguessable id, deleted after the TTL. */
export class MediaStore {
  constructor(dir, { ttlMs = 24 * 3600 * 1000, now = () => Date.now() } = {}) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    this.now = now;
    this.items = new Map();
  }

  save(buffer, fileName, type) {
    fs.mkdirSync(this.dir, { recursive: true });
    const id = randomHex(16);
    const ext = mediaExtension(fileName, type);
    const file = path.join(this.dir, `${id}.${ext}`);
    fs.writeFileSync(file, buffer);
    const item = { id, ext, file, size: buffer.length, type: MEDIA_TYPES[ext], name: String(fileName || `${id}.${ext}`), createdAt: this.now() };
    this.items.set(id, item);
    return item;
  }

  get(id) {
    const item = this.items.get(id);
    if (!item) return null;
    if (this.now() - item.createdAt > this.ttlMs) {
      this.remove(id);
      return null;
    }
    return item;
  }

  read(item) {
    return fs.readFileSync(item.file);
  }

  remove(id) {
    const item = this.items.get(id);
    this.items.delete(id);
    if (item) fs.rmSync(item.file, { force: true });
  }

  sweep() {
    for (const [id, item] of this.items) if (this.now() - item.createdAt > this.ttlMs) this.remove(id);
  }
}

/* ================================================================== multipart */

/** Parses a multipart/form-data body: its text fields and files ({ name, filename, type, data }). */
export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ""));
  if (!m) throw new RelayHttpError(400, "bad_request", "Expected multipart/form-data with a boundary.");
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const delimiter = Buffer.concat([Buffer.from("\r\n"), boundary]);
  const fields = {};
  const files = [];
  let pos = body.indexOf(boundary);
  if (pos < 0) throw new RelayHttpError(400, "bad_request", "Malformed multipart body.");
  for (;;) {
    pos += boundary.length;
    if (body[pos] === 45 && body[pos + 1] === 45) break; // "--": the closing boundary
    if (body[pos] === 13 && body[pos + 1] === 10) pos += 2;
    const headerEnd = body.indexOf("\r\n\r\n", pos);
    if (headerEnd < 0) throw new RelayHttpError(400, "bad_request", "Malformed multipart part.");
    const headers = body.subarray(pos, headerEnd).toString("utf8");
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next < 0) throw new RelayHttpError(400, "bad_request", "Unterminated multipart part.");
    const data = body.subarray(headerEnd + 4, next);
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    const type = /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim() ?? "";
    if (name !== undefined) {
      if (filename !== undefined) files.push({ name, filename, type, data });
      else fields[name] = data.toString("utf8").replace(/\r\n/g, "\n"); // form fields travel with CRLF line breaks
    }
    pos = next + 2;
  }
  return { fields, files };
}

/* ================================================================== the words per platform */

const PLATFORM_TAG = { tiktok: "#fyp", instagram: "#reels", youtube: "#Shorts" };

export function normalizeHashtags(value) {
  const words = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  const out = [];
  for (const raw of words) {
    const w = String(raw).trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (w && !out.some((t) => t.toLowerCase() === `#${w}`.toLowerCase())) out.push(`#${w}`);
  }
  return out;
}

/** The YouTube tags of hashtags: no "#", 500 characters in all (the commas count). */
export function youtubeTags(hashtags, budget = 500) {
  const out = [];
  let used = 0;
  for (const h of hashtags) {
    const w = String(h).replace(/^#/, "");
    if (!w) continue;
    const cost = w.length + (out.length ? 1 : 0);
    if (used + cost > budget) break;
    out.push(w);
    used += cost;
  }
  return out;
}

const cut = (text, max) => [...String(text)].slice(0, max).join("");

/**
 * What a platform gets: the page's own composition when it sent one (`posts[platform]`), else the shared title, caption
 * and hashtags composed here (the CLI) – the platform tag added, YouTube's title and description without "<" / ">".
 */
export function composeFor(platform, input) {
  const own = input.posts && typeof input.posts === "object" ? input.posts[platform] : null;
  if (own && typeof own.text === "string") {
    const hashtags = normalizeHashtags(own.hashtags ?? []);
    const tags = Array.isArray(own.tags) ? own.tags.map(String) : youtubeTags(hashtags);
    const title = String(own.title || "").trim();
    return platform === "youtube" ? { title: cut(title.replace(/[<>]/g, ""), 100) || "Short", text: own.text.replace(/[<>]/g, ""), tags: youtubeTags(tags.map((t) => `#${t}`)) } : { title, text: cut(own.text, 2200), tags: [] };
  }
  const caption = String(input.caption || "").trim();
  const shared = normalizeHashtags(input.hashtags || "").filter((t) => !["#fyp", "#foryou", "#reels", "#shorts"].includes(t.toLowerCase()));
  const tag = PLATFORM_TAG[platform];
  const hashtags = platform === "youtube" ? [tag, ...shared] : [...shared, tag];
  const text = [caption, hashtags.join(" ")].filter(Boolean).join("\n\n");
  const firstLine = caption.split("\n").find((l) => l.trim()) || "";
  const title = String(input.title || "").trim() || firstLine;
  if (platform === "youtube") return { title: cut(title.replace(/[<>]/g, "").replace(/\s+/g, " "), 100) || "Short", text: text.replace(/[<>]/g, ""), tags: youtubeTags(hashtags) };
  return { title, text: cut(text, 2200), tags: [] };
}

/* ================================================================== platform HTTP */

/**
 * One platform call with retries: network errors, 429 and 5xx are tried again (up to `retries` times, backing off).
 * Returns { status, ok, json, text, headers }.
 */
export async function platformCall(ctx, url, init = {}, { retries = 2, what = "request" } = {}) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await ctx.fetch(url, init);
    } catch (err) {
      if (attempt++ < retries) {
        await ctx.sleep(ctx.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }
      throw new PlatformError(`Network error during ${what}: ${err && err.message ? err.message : String(err)}`, { code: "network", retriable: true });
    }
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if ((res.status === 429 || res.status >= 500) && attempt++ < retries) {
      await ctx.sleep(ctx.retryDelayMs * 2 ** (attempt - 1));
      continue;
    }
    return { status: res.status, ok: res.ok, json, text, headers: res.headers };
  }
}

const form = (params) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });

/* ================================================================== TikTok */

export const TIKTOK = {
  authorize: "https://www.tiktok.com/v2/auth/authorize/",
  token: "https://open.tiktokapis.com/v2/oauth/token/",
  userInfo: "https://open.tiktokapis.com/v2/user/info/",
  creatorInfo: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
  init: "https://open.tiktokapis.com/v2/post/publish/video/init/",
  status: "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
  scopes: ["user.info.basic", "video.publish"],
};

/** TikTok's privacy levels for the page's visibilities. TikTok has no "unlisted": it posts for mutual friends and says so. */
const TIKTOK_PRIVACY = { public: "PUBLIC_TO_EVERYONE", unlisted: "MUTUAL_FOLLOW_FRIENDS", private: "SELF_ONLY" };
export const TIKTOK_UNLISTED_NOTE = "TikTok has no unlisted – the clip was posted for mutual friends (Friends).";

/** A clear message for a TikTok error code. */
export function tiktokErrorMessage(code, message) {
  switch (code) {
    case "unaudited_client_can_only_post_to_private_accounts":
      return "This TikTok app is not yet approved (audited): TikTok only lets it post privately (Only me). Submit the app for the Content Posting API audit in the TikTok developer portal to post publicly.";
    case "url_ownership_unverified":
      return "TikTok could not pull the video: verify this relay's domain (RELAY_PUBLIC_URL) as a URL prefix in the TikTok developer portal, or leave TIKTOK_SOURCE unset to upload the file.";
    case "spam_risk_too_many_posts":
    case "spam_risk_user_banned_from_posting":
      return "TikTok says this account has posted too much for today – try again tomorrow.";
    case "reached_active_user_cap":
      return "This TikTok app has reached its daily limit of posting users.";
    case "privacy_level_option_mismatch":
      return "This TikTok account does not allow that visibility.";
    case "access_token_invalid":
    case "scope_not_authorized":
    case "scope_permission_missed":
      return "The TikTok sign-in has expired or lacks the video.publish permission – connect the account again.";
    case "rate_limit_exceeded":
      return "TikTok's rate limit was hit – try again in a minute.";
    default:
      return `TikTok: ${message || code || "unknown error"}`;
  }
}

function tiktokCheck(res, what) {
  const err = res.json?.error;
  const code = err?.code;
  if (res.ok && (!code || code === "ok")) return res.json?.data ?? {};
  const expired = code === "access_token_invalid" || res.status === 401;
  throw new PlatformError(tiktokErrorMessage(code, err?.message || `HTTP ${res.status} during ${what}`), { code: code || `http_${res.status}`, status: res.status, retriable: code === "rate_limit_exceeded", expired });
}

export function tiktokAuthorizeUrl(cfg, state, redirectUri) {
  const q = new URLSearchParams({ client_key: cfg.tiktok.clientKey, response_type: "code", scope: TIKTOK.scopes.join(","), redirect_uri: redirectUri, state });
  return `${TIKTOK.authorize}?${q}`;
}

function tiktokTokens(json, now) {
  if (!json || !json.access_token) throw new PlatformError(`TikTok sign-in failed: ${json?.error_description || json?.error || "no access token"}`, { code: json?.error || "token_error" });
  return { access: json.access_token, refresh: json.refresh_token || null, expiresAt: now + 1000 * Number(json.expires_in || 86400), refreshExpiresAt: json.refresh_expires_in ? now + 1000 * Number(json.refresh_expires_in) : null, scope: json.scope || "", openId: json.open_id || null };
}

async function tiktokExchange(ctx, code, redirectUri) {
  const { cfg } = ctx;
  const res = await platformCall(ctx, TIKTOK.token, form({ client_key: cfg.tiktok.clientKey, client_secret: cfg.tiktok.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }), { what: "the TikTok token exchange" });
  const tokens = tiktokTokens(res.json, ctx.now());
  const scopes = tokens.scope.split(/[,\s]+/);
  const note = scopes.includes("video.publish") ? null : "video.publish was not granted – posting will fail; connect again and allow it.";
  const info = await platformCall(ctx, `${TIKTOK.userInfo}?fields=open_id,avatar_url,display_name`, { headers: { Authorization: `Bearer ${tokens.access}` } }, { what: "the TikTok profile" });
  const user = tiktokCheck(info, "the TikTok profile").user ?? {};
  let handle = null;
  try {
    const creator = await platformCall(ctx, TIKTOK.creatorInfo, { method: "POST", headers: { Authorization: `Bearer ${tokens.access}`, "Content-Type": "application/json; charset=UTF-8" }, body: "{}" }, { what: "the TikTok creator info" });
    const data = tiktokCheck(creator, "the TikTok creator info");
    handle = data.creator_username ? `@${data.creator_username}` : null;
  } catch {
    /* only the handle; posting checks again */
  }
  const providerId = user.open_id || tokens.openId;
  if (!providerId) throw new PlatformError("TikTok returned no user id.");
  return [{ providerId, name: user.display_name || handle || "TikTok", handle, avatar: user.avatar_url || null, tokens, note }];
}

async function tiktokRefresh(ctx, account) {
  const { cfg } = ctx;
  if (!account.tokens?.refresh) throw new PlatformError("The TikTok sign-in has expired – connect the account again.", { expired: true });
  const res = await platformCall(ctx, TIKTOK.token, form({ client_key: cfg.tiktok.clientKey, client_secret: cfg.tiktok.clientSecret, grant_type: "refresh_token", refresh_token: account.tokens.refresh }), { what: "the TikTok token refresh" });
  if (!res.json?.access_token) throw new PlatformError("The TikTok sign-in has expired – connect the account again.", { expired: true, code: res.json?.error || "refresh_failed" });
  return { ...account.tokens, ...tiktokTokens(res.json, ctx.now()) };
}

/**
 * How TikTok wants the file cut (Content Posting API, Media Transfer Guide): a file of up to 64 MB goes up whole, as one
 * chunk; a bigger one in chunks of 5–64 MB (10 MB here), `total_chunk_count` = video_size / chunk_size rounded down, the
 * remainder riding in the last chunk (which may be up to 128 MB). A 5–10 MB clip is one whole chunk – never a 10 MB
 * chunk_size bigger than the video with a chunk count that should round down to 0.
 */
export const TIKTOK_WHOLE_MAX = 64 * MB;
export function tiktokChunks(size, preferred = 10 * MB) {
  if (size <= TIKTOK_WHOLE_MAX) return { chunkSize: size, total: 1, ranges: [[0, size - 1]] };
  const chunkSize = Math.min(64 * MB, Math.max(5 * MB, preferred));
  const total = Math.max(1, Math.floor(size / chunkSize));
  const ranges = [];
  for (let i = 0; i < total; i++) ranges.push([i * chunkSize, i === total - 1 ? size - 1 : (i + 1) * chunkSize - 1]);
  return { chunkSize, total, ranges };
}

async function tiktokPublish(ctx, account, post, media, visibility, update) {
  const auth = { Authorization: `Bearer ${account.tokens.access}`, "Content-Type": "application/json; charset=UTF-8" };
  const creator = tiktokCheck(await platformCall(ctx, TIKTOK.creatorInfo, { method: "POST", headers: auth, body: "{}" }, { what: "the TikTok creator info" }), "the TikTok creator info");
  const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
  let privacy = TIKTOK_PRIVACY[visibility] || "PUBLIC_TO_EVERYONE";
  let note = null;
  if (options.length && !options.includes(privacy)) {
    if (!options.includes("SELF_ONLY")) throw new PlatformError(tiktokErrorMessage("privacy_level_option_mismatch"), { code: "privacy_level_option_mismatch" });
    note = `This TikTok account does not offer ${privacy}; the clip was posted as private (Only me).`;
    privacy = "SELF_ONLY";
  }
  if (creator.max_video_post_duration_sec && media.durationSec && media.durationSec > creator.max_video_post_duration_sec) throw new PlatformError(`This TikTok account takes videos up to ${creator.max_video_post_duration_sec} s.`, { code: "duration" });
  const pull = ctx.cfg.tiktok.source === "pull";
  const chunks = tiktokChunks(media.size);
  const init = async (level) => {
    const body = {
      post_info: { title: post.text, privacy_level: level, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
      source_info: pull ? { source: "PULL_FROM_URL", video_url: media.url } : { source: "FILE_UPLOAD", video_size: media.size, chunk_size: chunks.chunkSize, total_chunk_count: chunks.total },
    };
    const res = await platformCall(ctx, TIKTOK.init, { method: "POST", headers: auth, body: JSON.stringify(body) }, { what: "the TikTok upload start" });
    return tiktokCheck(res, "the TikTok upload start");
  };
  let started;
  try {
    started = await init(privacy);
  } catch (err) {
    // An app TikTok has not audited may only post privately: post as private instead, and say so.
    if (err instanceof PlatformError && err.code === "unaudited_client_can_only_post_to_private_accounts" && privacy !== "SELF_ONLY" && ctx.cfg.tiktok.privateFallback) {
      started = await init("SELF_ONLY");
      privacy = "SELF_ONLY";
      note = tiktokErrorMessage("unaudited_client_can_only_post_to_private_accounts").replace("TikTok only lets it post privately (Only me).", "TikTok only lets it post privately, so the clip was posted as Only me.");
    } else throw err;
  }
  const publishId = started.publish_id;
  if (!publishId) throw new PlatformError("TikTok started no upload (no publish_id).");
  if (!pull) {
    if (!started.upload_url) throw new PlatformError("TikTok returned no upload URL.");
    const buffer = ctx.media.read(media);
    for (let i = 0; i < chunks.ranges.length; i++) {
      const [start, end] = chunks.ranges[i];
      const res = await platformCall(ctx, started.upload_url, { method: "PUT", headers: { "Content-Type": media.type, "Content-Range": `bytes ${start}-${end}/${media.size}` }, body: buffer.subarray(start, end + 1) }, { retries: 3, what: `the TikTok upload (chunk ${i + 1}/${chunks.total})` });
      if (res.status !== 200 && res.status !== 201 && res.status !== 206) throw new PlatformError(`TikTok refused chunk ${i + 1}/${chunks.total} (HTTP ${res.status}).`, { status: res.status });
      update({ status: "uploading", progress: (0.8 * (end + 1)) / media.size });
    }
  }
  update({ status: "processing", progress: 0.85 });
  for (let poll = 1; poll <= ctx.maxPolls; poll++) {
    const res = await platformCall(ctx, TIKTOK.status, { method: "POST", headers: auth, body: JSON.stringify({ publish_id: publishId }) }, { what: "the TikTok status" });
    const data = tiktokCheck(res, "the TikTok status");
    if (data.status === "PUBLISH_COMPLETE") {
      const postId = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id[0] : null;
      const handle = account.handle ? account.handle.replace(/^@/, "") : null;
      const link = postId && handle ? `https://www.tiktok.com/@${handle}/video/${postId}` : handle ? `https://www.tiktok.com/@${handle}` : null;
      return { link, note: note ?? (privacy === "SELF_ONLY" && visibility !== "private" ? "Posted as private (Only me)." : privacy === "MUTUAL_FOLLOW_FRIENDS" && visibility === "unlisted" ? TIKTOK_UNLISTED_NOTE : null) };
    }
    if (data.status === "FAILED") throw new PlatformError(`TikTok could not publish the video: ${data.fail_reason || "unknown reason"}.`, { code: data.fail_reason || "failed" });
    if (data.status === "SEND_TO_USER_INBOX") return { link: null, note: "Sent to the TikTok app's inbox – finish the post in the app." };
    update({ status: "processing", progress: Math.min(0.98, 0.85 + poll * 0.01) });
    await ctx.sleep(ctx.pollMs);
  }
  throw new PlatformError("TikTok is still processing the video – it will appear on the profile when done.", { code: "timeout" });
}

/* ================================================================== Instagram (the flow of src/lib/bot/instagram.ts) */

export const INSTAGRAM = {
  facebookScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"],
  instagramScopes: ["instagram_business_basic", "instagram_business_content_publish"],
};

const igHost = (cfg) => (cfg.instagram.login === "instagram" ? "https://graph.instagram.com" : "https://graph.facebook.com");
const igBase = (cfg) => `${igHost(cfg)}/${cfg.instagram.graphVersion}`;
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/** Step 1 (as instagram.ts `createReelContainerRequest`): the REELS container from the clip's public URL. */
export function igContainerRequest(config, input) {
  const body = new URLSearchParams({ media_type: "REELS", video_url: input.videoUrl, caption: input.caption, share_to_feed: input.shareToFeed === false ? "false" : "true" });
  if (input.thumbOffsetMs !== undefined && Number.isFinite(input.thumbOffsetMs)) body.set("thumb_offset", String(Math.max(0, Math.round(input.thumbOffsetMs))));
  body.set("access_token", config.accessToken);
  return { method: "POST", url: `${config.base}/${encodeURIComponent(config.userId)}/media`, headers: { ...FORM }, body: body.toString() };
}

/** Step 2a (as `containerStatusRequest`). */
export function igStatusRequest(config, containerId) {
  const params = new URLSearchParams({ fields: "status_code,status", access_token: config.accessToken });
  return { method: "GET", url: `${config.base}/${encodeURIComponent(containerId)}?${params.toString()}`, headers: {} };
}

/** Step 2b (as `publishRequest`). */
export function igPublishRequest(config, containerId) {
  const body = new URLSearchParams({ creation_id: containerId, access_token: config.accessToken });
  return { method: "POST", url: `${config.base}/${encodeURIComponent(config.userId)}/media_publish`, headers: { ...FORM }, body: body.toString() };
}

/** The permalink (as `permalinkRequest`). */
export function igPermalinkRequest(config, mediaId) {
  const params = new URLSearchParams({ fields: "permalink", access_token: config.accessToken });
  return { method: "GET", url: `${config.base}/${encodeURIComponent(mediaId)}?${params.toString()}`, headers: {} };
}

/** A Graph API error as a message that says what to do. */
export function instagramErrorMessage(json, status) {
  const e = json?.error;
  const code = e?.code;
  const raw = [e?.message, e?.error_user_msg].filter(Boolean).join(" – ") || `HTTP ${status}`;
  if (code === 190 || e?.type === "OAuthException" && status === 401) return { message: "The Instagram sign-in has expired – connect the account again.", expired: true };
  if (code === 10 || code === 200 || (typeof code === "number" && code >= 200 && code < 300)) return { message: `Instagram refused: this Meta app is not yet approved for publishing (App Review for instagram_content_publish), or the account is not a tester of the app while it is in development mode – add it under App roles, or get the permission approved. (${raw})`, expired: false };
  if (code === 9 || code === 4 || code === 17 || code === 32 || e?.error_subcode === 2207042) return { message: `Instagram's publishing limit was reached (about 50 posts a day through the API) – try again later. (${raw})`, expired: false, retriable: false };
  if (code === 36003 || /aspect ratio|video format|codec/i.test(raw)) return { message: `Instagram could not use this video (Reels want MP4, H.264 + AAC, 9:16, 3–90 s): ${raw}`, expired: false };
  return { message: `Instagram: ${raw}`, expired: false };
}

async function igSend(ctx, request, what) {
  const res = await platformCall(ctx, request.url, { method: request.method, headers: request.headers, body: request.body }, { what });
  if (!res.ok || res.json?.error) {
    const info = instagramErrorMessage(res.json, res.status);
    throw new PlatformError(info.message, { code: String(res.json?.error?.code ?? `http_${res.status}`), status: res.status, expired: info.expired });
  }
  return res.json ?? {};
}

export function instagramAuthorizeUrl(cfg, state, redirectUri) {
  if (cfg.instagram.login === "instagram") {
    const q = new URLSearchParams({ client_id: cfg.instagram.appId, redirect_uri: redirectUri, response_type: "code", scope: INSTAGRAM.instagramScopes.join(","), state });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  }
  const q = new URLSearchParams({ client_id: cfg.instagram.appId, redirect_uri: redirectUri, state, response_type: "code" });
  if (cfg.instagram.configId) q.set("config_id", cfg.instagram.configId);
  else q.set("scope", INSTAGRAM.facebookScopes.join(","));
  return `https://www.facebook.com/${cfg.instagram.graphVersion}/dialog/oauth?${q}`;
}

async function instagramExchange(ctx, code, redirectUri) {
  const { cfg } = ctx;
  const v = cfg.instagram.graphVersion;
  if (cfg.instagram.login === "instagram") {
    const res = await platformCall(ctx, "https://api.instagram.com/oauth/access_token", form({ client_id: cfg.instagram.appId, client_secret: cfg.instagram.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }), { what: "the Instagram token exchange" });
    const short = Array.isArray(res.json?.data) ? res.json.data[0] : res.json;
    if (!short?.access_token) throw new PlatformError(`Instagram sign-in failed: ${res.json?.error_message || res.json?.error?.message || `HTTP ${res.status}`}`);
    let token = short.access_token;
    let expiresAt = ctx.now() + 3600 * 1000;
    const long = await platformCall(ctx, `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: cfg.instagram.appSecret, access_token: token })}`, {}, { what: "the Instagram long-lived token" });
    if (long.json?.access_token) {
      token = long.json.access_token;
      expiresAt = ctx.now() + 1000 * Number(long.json.expires_in || 60 * 86400);
    }
    const me = await igSend(ctx, { method: "GET", url: `https://graph.instagram.com/${v}/me?${new URLSearchParams({ fields: "user_id,username,name,profile_picture_url", access_token: token })}`, headers: {} }, "the Instagram profile");
    const userId = String(me.user_id || me.id || short.user_id || "");
    if (!userId) throw new PlatformError("Instagram returned no account id.");
    return [{ providerId: userId, name: me.name || me.username || "Instagram", handle: me.username ? `@${me.username}` : null, avatar: me.profile_picture_url || null, tokens: { access: token, refresh: null, expiresAt, obtainedAt: ctx.now() }, meta: { login: "instagram", igUserId: userId } }];
  }
  const tokenUrl = `https://graph.facebook.com/${v}/oauth/access_token`;
  const short = await igSend(ctx, { method: "GET", url: `${tokenUrl}?${new URLSearchParams({ client_id: cfg.instagram.appId, client_secret: cfg.instagram.appSecret, redirect_uri: redirectUri, code })}`, headers: {} }, "the Facebook token exchange");
  let userToken = short.access_token;
  if (!userToken) throw new PlatformError("Facebook returned no access token.");
  try {
    const long = await igSend(ctx, { method: "GET", url: `${tokenUrl}?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.instagram.appId, client_secret: cfg.instagram.appSecret, fb_exchange_token: userToken })}`, headers: {} }, "the long-lived Facebook token");
    if (long.access_token) userToken = long.access_token;
  } catch {
    /* the short-lived token still lists the pages */
  }
  const pages = await igSend(ctx, { method: "GET", url: `https://graph.facebook.com/${v}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}", limit: "100", access_token: userToken })}`, headers: {} }, "the Facebook Pages");
  const out = [];
  for (const page of Array.isArray(pages.data) ? pages.data : []) {
    const ig = page.instagram_business_account;
    if (!ig?.id) continue;
    // A Page token made from a long-lived user token does not expire.
    out.push({ providerId: String(ig.id), name: ig.name || ig.username || page.name || "Instagram", handle: ig.username ? `@${ig.username}` : null, avatar: ig.profile_picture_url || null, tokens: { access: page.access_token || userToken, refresh: null, expiresAt: null, obtainedAt: ctx.now() }, meta: { login: "facebook", igUserId: String(ig.id), pageId: page.id, pageName: page.name || null } });
  }
  if (out.length === 0) throw new PlatformError("No Instagram professional account is connected to the Facebook Pages you shared. Link the Instagram account to a Page (Instagram → Settings → Account type and tools, or Page settings → Linked accounts) and choose that Page when you connect.");
  return out;
}

async function instagramRefresh(ctx, account) {
  // Only Instagram Login tokens can be refreshed (60 days; at least 24 h old); Page tokens do not expire.
  if (account.meta?.login !== "instagram" || !account.tokens?.expiresAt) return account.tokens;
  const left = account.tokens.expiresAt - ctx.now();
  if (left > 10 * 86400 * 1000 || ctx.now() - (account.tokens.obtainedAt || 0) < 24 * 3600 * 1000) return account.tokens;
  const res = await platformCall(ctx, `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: account.tokens.access })}`, {}, { what: "the Instagram token refresh" });
  if (!res.json?.access_token) {
    if (left <= 0) throw new PlatformError("The Instagram sign-in has expired – connect the account again.", { expired: true });
    return account.tokens;
  }
  return { ...account.tokens, access: res.json.access_token, expiresAt: ctx.now() + 1000 * Number(res.json.expires_in || 60 * 86400), obtainedAt: ctx.now() };
}

async function instagramPublish(ctx, account, post, media, visibility, update) {
  // Reels are always public: a private or unlisted send is refused rather than quietly posted for everyone.
  if (visibility && visibility !== "public") throw new PlatformError("Instagram Reels are always public – send with visibility public.", { code: "visibility" });
  if (media.ext === "webm") throw new PlatformError("Instagram takes MP4 (H.264 + AAC) and this clip is WebM – export it as MP4 (Chrome or Safari) or convert it.", { code: "format" });
  const config = { userId: account.meta?.igUserId || account.providerId, accessToken: account.tokens.access, base: igBase(ctx.cfg) };
  update({ status: "uploading", progress: 0.2 });
  const created = await igSend(ctx, igContainerRequest(config, { videoUrl: media.url, caption: post.text }), "the Instagram container");
  const containerId = created.id !== undefined ? String(created.id) : "";
  if (!containerId) throw new PlatformError("Instagram returned no container id.");
  update({ status: "processing", progress: 0.4 });
  let finished = false;
  for (let poll = 1; poll <= ctx.maxPolls; poll++) {
    const status = await igSend(ctx, igStatusRequest(config, containerId), "the Instagram status");
    const code = typeof status.status_code === "string" ? status.status_code : "";
    if (code === "FINISHED" || code === "PUBLISHED") {
      finished = true;
      break;
    }
    if (code === "ERROR" || code === "EXPIRED") throw new PlatformError(`Instagram could not process the video (${code}${status.status ? `: ${status.status}` : ""}). Reels want MP4 (H.264 + AAC), 9:16, 3–90 s.`, { code: code.toLowerCase() });
    update({ status: "processing", progress: Math.min(0.9, 0.4 + poll * 0.02) });
    await ctx.sleep(ctx.pollMs);
  }
  if (!finished) throw new PlatformError(`Instagram is still processing the video (container ${containerId}).`, { code: "timeout" });
  const published = await igSend(ctx, igPublishRequest(config, containerId), "the Instagram publish");
  const mediaId = published.id !== undefined ? String(published.id) : "";
  if (!mediaId) throw new PlatformError("Instagram returned no media id.");
  let link = null;
  try {
    const perma = await igSend(ctx, igPermalinkRequest(config, mediaId), "the Instagram permalink");
    link = typeof perma.permalink === "string" ? perma.permalink : null;
  } catch {
    /* published; the link is only for the log */
  }
  return { link: link ?? (account.handle ? `https://www.instagram.com/${account.handle.replace(/^@/, "")}/` : null), note: null };
}

/* ================================================================== YouTube */

export const YOUTUBE = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  channels: "https://www.googleapis.com/youtube/v3/channels",
  upload: "https://www.googleapis.com/upload/youtube/v3/videos",
  scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
};

export function youtubeAuthorizeUrl(cfg, state, redirectUri) {
  const q = new URLSearchParams({ client_id: cfg.youtube.clientId, redirect_uri: redirectUri, response_type: "code", scope: YOUTUBE.scopes.join(" "), access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state });
  return `${YOUTUBE.authorize}?${q}`;
}

/** A Google API error as a message that says what to do. */
export function youtubeErrorMessage(json, status) {
  const e = json?.error;
  const reason = (typeof e === "object" && Array.isArray(e?.errors) && e.errors[0]?.reason) || (typeof e === "string" ? e : null);
  const raw = (typeof e === "object" ? e?.message : json?.error_description) || `HTTP ${status}`;
  if (status === 401 || reason === "invalid_grant") return { message: "The YouTube sign-in has expired or was revoked – connect the account again. (Apps whose OAuth consent screen is still in Testing get refresh tokens that expire after 7 days.)", expired: true };
  if (reason === "quotaExceeded") return { message: `The YouTube API quota of this app is used up for today (an upload costs about 1,600 of the default 10,000 units) – try tomorrow or ask Google for more. (${raw})` };
  if (reason === "uploadLimitExceeded") return { message: `This channel has reached YouTube's upload limit for now. (${raw})` };
  if (reason === "youtubeSignupRequired") return { message: "This Google account has no YouTube channel yet – create one on youtube.com first." };
  if (status === 403) return { message: `YouTube refused the upload (${raw}). Note: videos uploaded through an app Google has not audited are locked to private.` };
  return { message: `YouTube: ${raw}` };
}

function youtubeTokens(json, now, previous) {
  if (!json?.access_token) throw new PlatformError(`Google sign-in failed: ${json?.error_description || json?.error || "no access token"}`, { code: json?.error || "token_error", expired: json?.error === "invalid_grant" });
  return { access: json.access_token, refresh: json.refresh_token || previous?.refresh || null, expiresAt: now + 1000 * Number(json.expires_in || 3600), scope: json.scope || previous?.scope || "" };
}

async function youtubeChannel(ctx, access) {
  const res = await platformCall(ctx, `${YOUTUBE.channels}?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${access}` } }, { what: "the YouTube channel" });
  if (!res.ok) throw new PlatformError(youtubeErrorMessage(res.json, res.status).message, { status: res.status });
  const item = res.json?.items?.[0];
  if (!item?.id) throw new PlatformError("This Google account has no YouTube channel yet – create one on youtube.com first.");
  const thumbs = item.snippet?.thumbnails ?? {};
  return { providerId: item.id, name: item.snippet?.title || "YouTube", handle: item.snippet?.customUrl || null, avatar: thumbs.default?.url || thumbs.medium?.url || null };
}

async function youtubeExchange(ctx, code, redirectUri) {
  const { cfg } = ctx;
  const res = await platformCall(ctx, YOUTUBE.token, form({ code, client_id: cfg.youtube.clientId, client_secret: cfg.youtube.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }), { what: "the Google token exchange" });
  const tokens = youtubeTokens(res.json, ctx.now());
  const channel = await youtubeChannel(ctx, tokens.access);
  const note = tokens.refresh ? null : "Google sent no refresh token – remove the app under myaccount.google.com → Security → Third-party access, then connect again.";
  return [{ ...channel, tokens, note }];
}

async function youtubeRefresh(ctx, account) {
  const { cfg } = ctx;
  if (!account.tokens?.refresh) throw new PlatformError("The YouTube sign-in has expired – connect the account again.", { expired: true });
  const res = await platformCall(ctx, YOUTUBE.token, form({ client_id: cfg.youtube.clientId, client_secret: cfg.youtube.clientSecret, refresh_token: account.tokens.refresh, grant_type: "refresh_token" }), { what: "the Google token refresh" });
  if (!res.json?.access_token) throw new PlatformError(youtubeErrorMessage(res.json, res.status).message, { expired: true, code: res.json?.error || "refresh_failed" });
  return youtubeTokens(res.json, ctx.now(), account.tokens);
}

const nextOffset = (range) => {
  const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
  return m ? Number(m[2]) + 1 : 0;
};

async function youtubePublish(ctx, account, post, media, visibility, update) {
  const access = account.tokens.access;
  const resource = { snippet: { title: post.title, description: post.text, tags: post.tags, categoryId: "24" }, status: { privacyStatus: VISIBILITIES.includes(visibility) ? visibility : "public", selfDeclaredMadeForKids: false, embeddable: true } };
  const start = await platformCall(ctx, `${YOUTUBE.upload}?uploadType=resumable&part=snippet,status`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(media.size), "X-Upload-Content-Type": media.type }, body: JSON.stringify(resource) }, { what: "the YouTube upload start" });
  if (!start.ok) {
    const info = youtubeErrorMessage(start.json, start.status);
    throw new PlatformError(info.message, { status: start.status, expired: !!info.expired });
  }
  const session = start.headers.get("location");
  if (!session) throw new PlatformError("YouTube opened no upload session.");
  const buffer = ctx.media.read(media);
  const chunk = ctx.youtubeChunk;
  let offset = 0;
  let failures = 0;
  for (;;) {
    const end = Math.min(media.size, offset + chunk);
    let res = null;
    try {
      res = await ctx.fetch(session, { method: "PUT", redirect: "manual", headers: { "Content-Range": `bytes ${offset}-${end - 1}/${media.size}`, "Content-Type": media.type }, body: buffer.subarray(offset, end) });
    } catch {
      res = null;
    }
    if (res && (res.status === 200 || res.status === 201)) {
      const json = await res.json().catch(() => null);
      if (!json?.id) throw new PlatformError("YouTube finished the upload but returned no video id.");
      return { link: `https://www.youtube.com/shorts/${json.id}`, note: visibility === "public" ? null : `Uploaded as ${visibility}.` };
    }
    if (res && res.status === 308) {
      const next = nextOffset(res.headers.get("range"));
      if (next > offset) failures = 0;
      offset = next;
      update({ status: "uploading", progress: (0.95 * offset) / media.size });
      continue;
    }
    if (res && res.status < 500 && res.status !== 429) {
      const json = await res.json().catch(() => null);
      const info = youtubeErrorMessage(json, res.status);
      throw new PlatformError(info.message, { status: res.status, expired: !!info.expired });
    }
    // A dropped connection or a server error: ask the session how far it got, then go on.
    if (++failures > 5) throw new PlatformError("The YouTube upload kept failing – try again later.", { code: "upload_failed" });
    await ctx.sleep(ctx.retryDelayMs * 2 ** (failures - 1));
    const probe = await ctx.fetch(session, { method: "PUT", redirect: "manual", headers: { "Content-Range": `bytes */${media.size}` }, body: Buffer.alloc(0) }).catch(() => null);
    if (probe && (probe.status === 200 || probe.status === 201)) {
      const json = await probe.json().catch(() => null);
      if (json?.id) return { link: `https://www.youtube.com/shorts/${json.id}`, note: null };
    }
    if (probe && probe.status === 308) offset = nextOffset(probe.headers.get("range"));
    if (probe && probe.status === 404) throw new PlatformError("The YouTube upload session expired – send again.", { code: "session" });
  }
}

/* ================================================================== the adapters */

const ADAPTERS = {
  tiktok: { authorizeUrl: tiktokAuthorizeUrl, exchange: tiktokExchange, refresh: tiktokRefresh, publish: tiktokPublish, needsRefresh: (a, now) => typeof a.tokens?.expiresAt === "number" && a.tokens.expiresAt - now < 5 * 60 * 1000 },
  instagram: { authorizeUrl: instagramAuthorizeUrl, exchange: instagramExchange, refresh: instagramRefresh, publish: instagramPublish, needsRefresh: (a) => a.meta?.login === "instagram" },
  youtube: { authorizeUrl: youtubeAuthorizeUrl, exchange: youtubeExchange, refresh: youtubeRefresh, publish: youtubePublish, needsRefresh: (a, now) => !a.tokens?.expiresAt || a.tokens.expiresAt - now < 5 * 60 * 1000 },
};

/* ================================================================== HTTP plumbing */

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(text), ...extraHeaders });
  res.end(text);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) {
      reject(new RelayHttpError(413, "too_large", `The clip is larger than this relay accepts (${Math.round(limit / MB)} MB, RELAY_MAX_UPLOAD_MB).`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new RelayHttpError(413, "too_large", `The clip is larger than this relay accepts (${Math.round(limit / MB)} MB, RELAY_MAX_UPLOAD_MB).`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => !failed && resolve(Buffer.concat(chunks)));
    req.on("error", (err) => !failed && reject(err));
  });
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The page the OAuth popup ends on: it tells the opener (postMessage to the site's origin, no tokens) and closes. */
export function callbackPage({ ok, platform, accounts = [], message = "", origin = null }) {
  const payload = { source: RELAY_NAME, type: ok ? "connected" : "error", platform, accounts: accounts.map((a) => ({ id: a.id, name: a.name, handle: a.handle })), message: ok ? null : message };
  const data = JSON.stringify(payload).replace(/</g, "\\u003c");
  const target = origin ? JSON.stringify(origin).replace(/</g, "\\u003c") : null;
  const names = accounts.map((a) => a.handle || a.name).join(", ");
  const title = ok ? `Connected ${escapeHtml(names || platform)}` : "Sign-in failed";
  const body = ok ? `<p>${escapeHtml(names || platform)} ${accounts.length === 1 ? "is" : "are"} connected. This window closes by itself.</p>` : `<p>${escapeHtml(message)}</p><p>Close this window and try again.</p>`;
  const script = target ? `<script>(function(){var d=${data};try{if(window.opener){window.opener.postMessage(d,${target});}}catch(e){}${ok ? "setTimeout(function(){window.close();},1200);" : ""}})();</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:15px/1.5 system-ui,sans-serif;background:#0b0b0f;color:#e4e4e7;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:18px;color:${ok ? "#93d119" : "#f87171"}}</style></head><body><main><h1>${title}</h1>${body}</main>${script}</body></html>`;
}

/* ================================================================== the relay */

/**
 * Creates the relay: `{ handle(req, res), store, states, media, jobs, runJob, cfg }`. Options (for tests): `config` or
 * `env`, `fetch` (the platforms), `now`, `sleep`, `pollMs`, `retryDelayMs`, `maxPolls`, `youtubeChunk`, `log`.
 */
export function createRelay(options = {}) {
  const cfg = options.config ?? readConfig(options.env ?? process.env);
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? console;
  const store = new Store(path.join(cfg.dataDir, "relay.json"), { now });
  const states = new StateStore({ now });
  const media = new MediaStore(path.join(cfg.dataDir, "media"), { ttlMs: cfg.mediaTtlMs, now });
  const jobs = new Map();
  const ctx = {
    cfg,
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    now,
    sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    pollMs: options.pollMs ?? 4000,
    retryDelayMs: options.retryDelayMs ?? 1000,
    maxPolls: options.maxPolls ?? 150,
    youtubeChunk: options.youtubeChunk ?? 8 * MB,
    store,
    media,
    log,
  };
  const platforms = () => configuredPlatforms(cfg);
  const redirectUri = (platform) => `${cfg.publicUrl}/oauth/${platform}/callback`;
  const originAllowed = (origin) => !!origin && (cfg.allowedOrigins.includes("*") || cfg.allowedOrigins.includes(origin));
  const secrets = () => [cfg.adminKey, cfg.tiktok.clientSecret, cfg.instagram.appSecret, cfg.youtube.clientSecret];

  function cors(req, res, isPublic) {
    const origin = req.headers.origin;
    if (isPublic) res.setHeader("Access-Control-Allow-Origin", "*");
    else if (originAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  const bearer = (req) => {
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
    return m ? m[1].trim() : "";
  };
  const requireKey = (req) => {
    const key = store.keyFor(bearer(req));
    if (!key) throw new RelayHttpError(401, "unauthorized", "Unknown access key – ask the relay's admin for one (POST /api/keys).");
    return key;
  };
  const requireAdmin = (req) => {
    if (!cfg.adminKey) throw new RelayHttpError(403, "forbidden", "RELAY_ADMIN_KEY is not set on this relay.");
    if (!sameSecret(bearer(req), cfg.adminKey)) throw new RelayHttpError(401, "unauthorized", "Admin key required.");
  };
  const requirePlatform = (platform) => {
    if (!PLATFORMS.includes(platform)) throw new RelayHttpError(404, "not_found", `Unknown platform ${platform}.`);
    if (!platforms()[platform]) throw new RelayHttpError(400, "not_configured", `This relay has no ${platform} app keys (see relay/.env.example).`);
  };

  /** Refreshes an account's token when it needs it; marks it expired when that fails. */
  async function freshAccount(account) {
    const adapter = ADAPTERS[account.platform];
    if (!adapter.needsRefresh(account, now())) return account;
    try {
      const tokens = await adapter.refresh(ctx, account);
      return store.updateAccount(account.id, { tokens, status: "ok" }) ?? account;
    } catch (err) {
      if (err instanceof PlatformError && err.expired) store.updateAccount(account.id, { status: "expired" });
      throw err;
    }
  }

  function publicJob(job) {
    return { id: job.id, status: job.status, createdAt: job.createdAt, items: job.items.map((i) => ({ ...i })) };
  }

  /** Publishes a job's clip to every account of it, at once; each account's outcome lands in its item. */
  async function runJob(job, input, item) {
    await Promise.all(
      job.items.map(async (entry) => {
        const update = (patch) => Object.assign(entry, patch);
        try {
          let account = store.account(job.keyId, entry.accountId);
          if (!account) throw new PlatformError("This account is no longer connected.");
          account = await freshAccount(account);
          update({ status: "uploading", progress: 0.05 });
          const post = composeFor(account.platform, input);
          const result = await ADAPTERS[account.platform].publish(ctx, account, post, item, input.visibility, update);
          update({ status: "published", progress: 1, link: result.link ?? null, note: result.note ?? null, error: null });
        } catch (err) {
          const tokens = Object.values(store.account(job.keyId, entry.accountId)?.tokens ?? {}).filter((v) => typeof v === "string");
          const message = redact(err instanceof Error ? err.message : String(err), [...secrets(), ...tokens]);
          if (err instanceof PlatformError && err.expired) store.updateAccount(entry.accountId, { status: "expired" });
          update({ status: "failed", error: message, code: err instanceof PlatformError ? err.code : "error" });
        }
      }),
    );
    const published = job.items.filter((i) => i.status === "published").length;
    job.status = published === job.items.length ? "done" : published === 0 ? "failed" : "partial";
    job.finishedAt = now();
  }

  async function route(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method;

    if (parts[0] === "media") {
      cors(req, res, true);
      if (method === "OPTIONS") return void res.writeHead(204).end();
      if (method !== "GET" && method !== "HEAD") throw new RelayHttpError(405, "method", "Method not allowed.");
      const id = String(parts[1] || "").replace(/\.[a-z0-9]+$/i, "");
      const item = /^[0-9a-f]{32}$/.test(id) ? media.get(id) : null;
      if (!item) throw new RelayHttpError(404, "not_found", "No such clip (it may have expired).");
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
      let start = 0;
      let end = item.size - 1;
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(end, Number(range[2]));
        } else start = Math.max(0, item.size - Number(range[2]));
        if (start > end || start >= item.size) {
          res.writeHead(416, { "Content-Range": `bytes */${item.size}` });
          return void res.end();
        }
      }
      const partial = !!range && (start !== 0 || end !== item.size - 1);
      res.writeHead(partial ? 206 : 200, { "Content-Type": item.type, "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600", ...(partial ? { "Content-Range": `bytes ${start}-${end}/${item.size}` } : {}) });
      if (method === "HEAD") return void res.end();
      fs.createReadStream(item.file, { start, end }).pipe(res);
      return;
    }

    cors(req, res, false);
    if (method === "OPTIONS") return void res.writeHead(204).end();

    if (url.pathname === "/" && method === "GET") return sendJson(res, 200, { name: RELAY_NAME, version: RELAY_VERSION, docs: "https://github.com/CronusAztec/Balls/tree/main/relay" });
    if (url.pathname === "/api/health" && method === "GET") return sendJson(res, 200, { ok: true, name: RELAY_NAME, version: RELAY_VERSION, platforms: platforms() });
    if (url.pathname === "/api/me" && method === "GET") {
      const key = requireKey(req);
      return sendJson(res, 200, { name: RELAY_NAME, version: RELAY_VERSION, key: { id: key.id, label: key.label }, platforms: platforms() });
    }

    if (parts[0] === "api" && parts[1] === "keys") {
      requireAdmin(req);
      if (parts.length === 2 && method === "GET") return sendJson(res, 200, { keys: store.listKeys() });
      if (parts.length === 2 && method === "POST") {
        const body = await readBody(req, 64 * 1024);
        let label = "";
        try {
          label = body.length ? String(JSON.parse(body.toString("utf8")).label ?? "") : "";
        } catch {
          throw new RelayHttpError(400, "bad_request", "Expected JSON: { \"label\": \"…\" }.");
        }
        return sendJson(res, 201, store.createKey(label));
      }
      if (parts.length === 3 && method === "DELETE") return store.deleteKey(parts[2]) ? sendJson(res, 200, { ok: true }) : sendError(res, 404, "not_found", "No such key.");
      throw new RelayHttpError(405, "method", "Method not allowed.");
    }

    if (parts[0] === "api" && parts[1] === "accounts") {
      const key = requireKey(req);
      if (parts.length === 2 && method === "GET") return sendJson(res, 200, { accounts: store.accountsFor(key.id).map(publicAccount) });
      if (parts.length === 3 && method === "DELETE") return store.removeAccount(key.id, parts[2]) ? sendJson(res, 200, { ok: true }) : sendError(res, 404, "not_found", "No such account for this key.");
      throw new RelayHttpError(405, "method", "Method not allowed.");
    }

    if (parts[0] === "api" && parts[1] === "connect" && parts.length === 3 && method === "POST") {
      const key = requireKey(req);
      const platform = parts[2];
      requirePlatform(platform);
      const body = await readBody(req, 64 * 1024);
      let origin = null;
      try {
        origin = body.length ? JSON.parse(body.toString("utf8")).origin ?? null : null;
      } catch {
        throw new RelayHttpError(400, "bad_request", "Expected JSON: { \"origin\": \"https://…\" }.");
      }
      origin = origin ? String(origin).replace(/\/+$/, "") : null;
      if (origin && !originAllowed(origin)) throw new RelayHttpError(400, "origin_not_allowed", `${origin} is not in RELAY_ALLOWED_ORIGINS.`);
      const state = states.create({ keyId: key.id, platform, origin });
      return sendJson(res, 200, { url: `${cfg.publicUrl}/connect/${platform}?state=${state}` });
    }

    if (parts[0] === "connect" && parts.length === 2 && method === "GET") {
      const platform = parts[1];
      requirePlatform(platform);
      const entry = states.peek(url.searchParams.get("state"));
      if (!entry || entry.platform !== platform) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        return void res.end(callbackPage({ ok: false, platform, message: "This sign-in link has expired or was already used – start again from the site." }));
      }
      res.writeHead(302, { Location: ADAPTERS[platform].authorizeUrl(cfg, url.searchParams.get("state"), redirectUri(platform)), "Cache-Control": "no-store" });
      return void res.end();
    }

    if (parts[0] === "oauth" && parts[2] === "callback" && parts.length === 3 && method === "GET") {
      const platform = parts[1];
      const entry = states.take(url.searchParams.get("state"));
      const page = (status, args) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
        res.end(callbackPage({ platform, ...args }));
      };
      if (!entry || entry.platform !== platform) return page(400, { ok: false, message: "This sign-in has expired or was already used – start again from the site." });
      const error = url.searchParams.get("error") || url.searchParams.get("error_code");
      if (error) return page(400, { ok: false, origin: entry.origin, message: `The sign-in was not completed (${url.searchParams.get("error_description") || url.searchParams.get("error_message") || error}).` });
      const code = url.searchParams.get("code");
      if (!code) return page(400, { ok: false, origin: entry.origin, message: "The platform sent no authorization code." });
      if (!store.data.keys.some((k) => k.id === entry.keyId)) return page(400, { ok: false, origin: entry.origin, message: "The access key was revoked." });
      try {
        const found = await ADAPTERS[platform].exchange(ctx, code, redirectUri(platform));
        const saved = found.map((a) => store.upsertAccount(entry.keyId, platform, a.providerId, { name: a.name, handle: a.handle, avatar: a.avatar, tokens: a.tokens, meta: a.meta ?? null, note: a.note ?? null }));
        return page(200, { ok: true, origin: entry.origin, accounts: saved.map(publicAccount) });
      } catch (err) {
        log.warn?.(`[relay] ${platform} sign-in failed: ${redact(err instanceof Error ? err.message : String(err), secrets())}`);
        return page(502, { ok: false, origin: entry.origin, message: redact(err instanceof Error ? err.message : String(err), secrets()) });
      }
    }

    if (url.pathname === "/api/publish" && method === "POST") {
      const key = requireKey(req);
      const body = await readBody(req, cfg.maxUploadBytes);
      const { fields, files } = parseMultipart(body, req.headers["content-type"]);
      const file = files.find((f) => f.name === "file") ?? files[0];
      if (!file || file.data.length === 0) throw new RelayHttpError(400, "bad_request", "No clip in the upload (field \"file\").");
      const ids = String(fields.accounts || "")
        .split(/[\s,]+/)
        .filter(Boolean);
      if (ids.length === 0) throw new RelayHttpError(400, "bad_request", "No accounts chosen (field \"accounts\").");
      const accounts = ids.map((id) => store.account(key.id, id));
      const missing = ids.filter((_, i) => !accounts[i]);
      if (missing.length) throw new RelayHttpError(404, "not_found", `Unknown account(s) for this key: ${missing.join(", ")}.`);
      for (const a of accounts) if (!platforms()[a.platform]) throw new RelayHttpError(400, "not_configured", `This relay has no ${a.platform} app keys any more.`);
      let posts = null;
      if (fields.posts) {
        try {
          posts = JSON.parse(fields.posts);
        } catch {
          throw new RelayHttpError(400, "bad_request", "\"posts\" must be JSON.");
        }
      }
      const visibility = VISIBILITIES.includes(fields.visibility) ? fields.visibility : "public";
      const saved = media.save(file.data, file.filename, file.type);
      const item = { ...saved, url: `${cfg.publicUrl}/media/${saved.id}.${saved.ext}`, durationSec: Number(fields.durationSec) || null };
      const job = {
        id: `j_${randomHex(8)}`,
        keyId: key.id,
        createdAt: iso(now()),
        status: "running",
        mediaId: saved.id,
        items: accounts.map((a) => ({ accountId: a.id, platform: a.platform, name: a.handle ? `${a.name} (${a.handle})` : a.name, status: "queued", progress: 0, link: null, error: null, code: null, note: null })),
      };
      jobs.set(job.id, job);
      void runJob(job, { title: fields.title, caption: fields.caption, hashtags: fields.hashtags, posts, visibility }, item).catch((err) => log.error?.(`[relay] job ${job.id} crashed: ${err?.message ?? err}`));
      return sendJson(res, 202, { jobId: job.id, job: publicJob(job) });
    }

    if (parts[0] === "api" && parts[1] === "jobs" && parts.length === 3 && method === "GET") {
      const key = requireKey(req);
      const job = jobs.get(parts[2]);
      if (!job || job.keyId !== key.id) throw new RelayHttpError(404, "not_found", "No such job for this key (jobs are kept 24 hours).");
      return sendJson(res, 200, publicJob(job));
    }

    throw new RelayHttpError(404, "not_found", "Not found.");
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || "/", "http://relay.local");
    } catch {
      return sendError(res, 400, "bad_request", "Bad URL.");
    }
    try {
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof RelayHttpError) return sendError(res, err.status, err.code, err.message);
      log.error?.(`[relay] ${req.method} ${url.pathname}: ${redact(err instanceof Error ? err.stack || err.message : String(err), secrets())}`);
      return sendError(res, 500, "server_error", "The relay failed – see its log.");
    }
  }

  /** Drops old clips and finished jobs (every 10 minutes when listening). */
  function sweep() {
    media.sweep();
    states.sweep();
    for (const [id, job] of jobs) if (now() - Date.parse(job.createdAt) > cfg.mediaTtlMs) jobs.delete(id);
  }

  function listen(port = cfg.port, host = cfg.host) {
    const server = http.createServer((req, res) => void handle(req, res));
    const timer = setInterval(sweep, 10 * 60 * 1000);
    timer.unref?.();
    server.on("close", () => clearInterval(timer));
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }

  return { cfg, ctx, store, states, media, jobs, handle, runJob, sweep, listen };
}

/* ================================================================== main */

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#") || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  loadEnvFile(path.join(process.cwd(), ".env"));
  loadEnvFile(path.join(here, ".env"));
  const cfg = readConfig(process.env);
  const args = process.argv.slice(2);
  if (args[0] === "create-key") {
    // node relay/server.mjs create-key "Alice" – a key without the HTTP API (on the relay's own machine).
    const relay = createRelay({ config: cfg });
    const created = relay.store.createKey(args.slice(1).join(" ") || "key");
    console.log(`Access key for ${created.label} (${created.id}) – shown once, keep it safe:\n${created.key}`);
    return;
  }
  const relay = createRelay({ config: cfg });
  const warn = [];
  if (!cfg.adminKey) warn.push("RELAY_ADMIN_KEY is not set: POST /api/keys is off (use `node relay/server.mjs create-key <label>`).");
  if (cfg.allowedOrigins.length === 0) warn.push("RELAY_ALLOWED_ORIGINS is empty: browsers cannot call the relay (add e.g. https://cronusaztec.github.io).");
  if (!process.env.RELAY_PUBLIC_URL) warn.push(`RELAY_PUBLIC_URL is not set: OAuth callbacks and clip URLs use ${cfg.publicUrl}.`);
  const apps = configuredPlatforms(cfg);
  await relay.listen();
  console.log(`${RELAY_NAME} ${RELAY_VERSION} on ${cfg.host}:${cfg.port} (public ${cfg.publicUrl}) – apps: ${PLATFORMS.map((p) => `${p} ${apps[p] ? "✓" : "–"}`).join(", ")}; data in ${cfg.dataDir}`);
  for (const w of warn) console.warn(`! ${w}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`relay: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
