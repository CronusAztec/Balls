/*
 * --- social-postiz --- The Postiz public API, as the Windows app uses it (docs/SOCIAL-AUTOPILOT.md, section 2). Postiz holds
 * the platform logins and posts from its own servers; the app only needs the user's API key. Node 22's fetch and FormData,
 * nothing else: the client takes its `fetch` from main.ts (Electron's net.fetch with Node's as the fallback) and the tests
 * hand in a stand-in. Every call goes to `<base>/public/v1/...` with the raw key in the Authorization header (no "Bearer").
 *
 * Phase 1 uses the key check, the channels and the notices; the rest (upload, posts, slots, analytics) is here for phase 2,
 * so the whole surface is tested against one stand-in server. Errors come back as `PostizError` with a code the page can
 * act on and a message the user may read; the key never appears in a message or a log line.
 */

import type { PostizChannel, PostizNotice, PostizOrganization } from "@/lib/desktop/contract";

export type PostizErrorCode = "badUrl" | "network" | "unauthorized" | "noSubscription" | "forbidden" | "notFound" | "tooLarge" | "rateLimited" | "badRequest" | "server" | "unknown";

export class PostizError extends Error {
  readonly code: PostizErrorCode;
  /** The HTTP status when there was an answer (null: none). */
  readonly status: number | null;
  /** 429 only: how long Postiz asks to wait (from Retry-After), null when it did not say. */
  readonly retryAfterMs: number | null;

  constructor(code: PostizErrorCode, message: string, options: { status?: number | null; retryAfterMs?: number | null; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PostizError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/* ------------------------------------------------------------------ what Postiz answers */

/** `POST /upload`: the stored file the posts refer to. */
export interface PostizUpload {
  id: string;
  path: string;
}

export type PostizPostType = "now" | "schedule" | "draft";
export type PostizPostState = "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT";

/** One media item of a post's value (an upload's id and path; the thumbnail's position for a video). */
export interface PostizMedia {
  id: string;
  path: string;
  thumbnailTimestamp?: number;
}

export interface PostizPostValue {
  content: string;
  image?: PostizMedia[];
}

/** The provider's settings: `__type` is mandatory ("tiktok", "instagram", "youtube", …), the rest is the provider's schema. */
export type PostizProviderSettings = { __type: string } & Record<string, unknown>;

export interface PostizPostEntry {
  integration: { id: string };
  value: PostizPostValue[];
  settings: PostizProviderSettings;
  /** Postiz's group id: given on an edit, left out on a new post. */
  group?: string;
}

/** `POST /posts`: one call for every channel of one clip. */
export interface PostizCreatePostsBody {
  type: PostizPostType;
  /** UTC ISO time; the moment for `schedule`, now for `now`. */
  date: string;
  shortLink?: boolean;
  tags?: { value: string; label: string }[];
  posts: PostizPostEntry[];
}

export interface PostizCreatedPost {
  postId: string;
  integration: string;
  /** The group Postiz filed the posts under, when its answer carried it (phase 2 shows it with the result). */
  group?: string;
}

/** `GET /posts`: a post as Postiz lists it (one row per channel). */
export interface PostizPost {
  id: string;
  content: string;
  /** ISO time. */
  publishDate: string;
  state: PostizPostState;
  releaseURL: string | null;
  error: string | null;
  group: string | null;
  integration: { id: string; name: string; platform: string; picture: string | null } | null;
}

export interface PostizSlot {
  /** ISO time of Postiz's next free slot for the channel. */
  date: string;
}

/** The provider's rules and settings schema (`GET /integration-settings/:id`); kept as Postiz sends it. */
export type PostizIntegrationSettings = Record<string, unknown>;

export type PostizAnalyticsDays = 7 | 30 | 90;

/** One series of `GET /analytics/...`: a label, its total and the daily points. */
export interface PostizAnalyticsSeries {
  label: string;
  total: number;
  data: { date: string; total: number }[];
}

export type PostStatusChange = "draft" | "schedule";

/* ------------------------------------------------------------------ limits and the base URL */

export const POSTIZ_API_PATH = "/public/v1";
/** The Postiz limits for an upload: MP4 up to 1 GB, an image up to 10 MB. */
export const POSTIZ_MAX_VIDEO_BYTES = 1024 ** 3;
export const POSTIZ_MAX_IMAGE_BYTES = 10 * 1024 ** 2;
export const POSTIZ_VIDEO_TYPES: readonly string[] = ["video/mp4"];
export const POSTIZ_IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];
/** How long a call may take: an ordinary request, and an upload. */
export const POSTIZ_TIMEOUT_MS = 30_000;
export const POSTIZ_UPLOAD_TIMEOUT_MS = 10 * 60_000;

/**
 * The API root of what the user typed: `https://api.postiz.com`, `https://api.postiz.com/public/v1` or a self-hosted backend
 * with or without `/public/v1` all become `<base>/public/v1`. https, or http on localhost / 127.0.0.1 (a Postiz on this PC).
 */
export function normalisePostizBase(input: string): string {
  const text = String(input ?? "").trim();
  if (!text) throw new PostizError("badUrl", "Type the Postiz address first");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new PostizError("badUrl", "The Postiz address is not a valid URL");
  }
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new PostizError("badUrl", "The Postiz address must start with https:// (http only on localhost)");
  if (url.username || url.password) throw new PostizError("badUrl", "The Postiz address must not contain a user name or password");
  let pathname = url.pathname.replace(/\/+$/, "");
  pathname = pathname.replace(/\/public\/v1$/, "").replace(/\/public$/, "");
  return `${url.protocol}//${url.host}${pathname}${POSTIZ_API_PATH}`;
}

/** `text` with the key (and its URL-encoded form) replaced by "***" – like the relay's redact, so a message never carries it. */
/** The most a Postiz answer may weigh (the biggest, a page of posts or notices, is far below this). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function redactKey(text: string, key: string): string {
  let out = String(text);
  if (!key) return out;
  out = out.split(key).join("***");
  const enc = encodeURIComponent(key);
  if (enc !== key) out = out.split(enc).join("***");
  return out;
}

/** What Postiz says about an upload before anything is sent: null when it may go, else why not. */
export function checkUploadFile(file: { name: string; type: string; bytes: Uint8Array }): PostizError | null {
  const type = String(file.type || "").toLowerCase();
  const size = file.bytes?.byteLength ?? 0;
  if (POSTIZ_VIDEO_TYPES.includes(type)) {
    if (size > POSTIZ_MAX_VIDEO_BYTES) return new PostizError("tooLarge", `${file.name}: a video for Postiz may be at most 1 GB`);
    return null;
  }
  if (POSTIZ_IMAGE_TYPES.includes(type)) {
    if (size > POSTIZ_MAX_IMAGE_BYTES) return new PostizError("tooLarge", `${file.name}: an image for Postiz may be at most 10 MB`);
    return null;
  }
  return new PostizError("badRequest", `${file.name}: Postiz takes MP4 videos and JPEG, PNG, GIF or WebP images (not ${type || "an unknown type"})`);
}

/* ------------------------------------------------------------------ the client */

export interface PostizClientOptions {
  /** What the user typed (normalised here). */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
  /** main.log (never given the key). */
  log?: (level: "info" | "warn" | "error", message: string) => void;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
}

const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The seconds or the HTTP date of a Retry-After header as milliseconds (null when absent or unreadable). */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const text = header.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** The error code of an HTTP status Postiz answered with. */
export function codeOfStatus(status: number): PostizErrorCode {
  if (status === 400) return "badRequest";
  if (status === 401) return "unauthorized";
  if (status === 402) return "noSubscription";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 413) return "tooLarge";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "server";
  return "unknown";
}

/** What the user reads for an answer without a usable message of its own. */
const STATUS_TEXT: Record<PostizErrorCode, string> = {
  badUrl: "The Postiz address is not valid",
  network: "Postiz could not be reached",
  unauthorized: "Postiz does not accept this API key",
  noSubscription: "This Postiz workspace has no active subscription",
  forbidden: "Postiz refused this action for this key",
  notFound: "Postiz does not know this item",
  tooLarge: "The file is too large for Postiz",
  rateLimited: "Postiz is asking for a pause (too many requests)",
  badRequest: "Postiz did not accept the request",
  server: "Postiz answered with an error on its side",
  unknown: "Postiz answered unexpectedly",
};

export class PostizClient {
  readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly log: (level: "info" | "warn" | "error", message: string) => void;

  constructor(options: PostizClientOptions) {
    this.baseUrl = normalisePostizBase(options.baseUrl);
    this.key = String(options.apiKey ?? "").trim();
    if (!this.key) throw new PostizError("unauthorized", "Paste the Postiz API key first");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? POSTIZ_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? POSTIZ_UPLOAD_TIMEOUT_MS;
    this.log = options.log ?? (() => {});
  }

  /** A message without the key, wherever it got in. */
  private safe(text: string): string {
    return redactKey(text, this.key);
  }

  private async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: this.key, Accept: "application/json" };
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    const method = options.method ?? "GET";
    let response: Response;
    try {
      // (redirect: "error" – a Postiz API never redirects; this keeps the Authorization header from ever following a 3xx to
      // another host, whatever the network stack would do with it)
      response = await this.fetchImpl(url.toString(), { method, headers, body, signal: controller.signal, redirect: "error" });
    } catch (err) {
      clearTimeout(timer);
      const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
      const message = aborted ? `Postiz did not answer within ${Math.round((options.timeoutMs ?? this.timeoutMs) / 1000)} s` : `Postiz could not be reached (${this.safe(err instanceof Error ? err.message : String(err))})`;
      this.log("warn", `postiz ${method} ${path}: ${message}`);
      // (no `cause`: the handler's error chain would log the raw network error unredacted)
      throw new PostizError("network", message);
    }
    // The body is read before the timer is cleared: a host that sends headers and then stalls must not hang the request
    // (the abort cancels the body read too), and a body over the cap is refused rather than buffered whole.
    let text = "";
    try {
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > MAX_BODY_BYTES) throw new PostizError("server", "Postiz sent an answer that is too large");
      text = await response.text();
      if (text.length > MAX_BODY_BYTES) throw new PostizError("server", "Postiz sent an answer that is too large");
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof PostizError) throw err;
      const aborted = controller.signal.aborted || (err as { name?: string })?.name === "AbortError";
      const message = aborted ? `Postiz did not answer within ${Math.round((options.timeoutMs ?? this.timeoutMs) / 1000)} s` : "Postiz sent an answer that could not be read";
      this.log("warn", `postiz ${method} ${path}: ${message}`);
      throw new PostizError("network", message);
    }
    clearTimeout(timer);
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const code = codeOfStatus(response.status);
      const own = asRecord(data)?.message;
      const ownText = Array.isArray(own) ? own.filter((m) => typeof m === "string").join(", ") : asString(own);
      const message = this.safe(ownText.trim() || STATUS_TEXT[code]);
      const wait = code === "rateLimited" ? retryAfterMs(response.headers.get("retry-after")) : null;
      this.log("warn", `postiz ${method} ${path}: HTTP ${response.status} ${code}${wait !== null ? ` (retry after ${wait} ms)` : ""}: ${message}`);
      throw new PostizError(code, message, { status: response.status, retryAfterMs: wait });
    }
    return (data ?? (text as unknown)) as T;
  }

  /* ---------------------------------------------------------------- the key and the channels */

  /** `GET /is-connected`: whether Postiz accepts the key (true/false in the body; a 401 is false as well). */
  async isConnected(): Promise<boolean> {
    try {
      const data = await this.request<unknown>("/is-connected");
      const record = asRecord(data);
      if (typeof data === "boolean") return data;
      if (record && typeof record.connected === "boolean") return record.connected;
      if (typeof data === "string") return data.trim() === "true";
      // Anything else is not Postiz (a catch-all web server at a mistyped address answers 200 to everything): not accepted, so a
      // wrong address never gets the key saved for it.
      return false;
    } catch (err) {
      if (err instanceof PostizError && err.code === "unauthorized") return false;
      throw err;
    }
  }

  /** `GET /me`: the workspace (organisation) the key belongs to. */
  async me(): Promise<PostizOrganization> {
    const data = asRecord(await this.request<unknown>("/me")) ?? {};
    const org = asRecord(data.organization) ?? asRecord(data.org) ?? data;
    return { id: asString(org.id ?? data.id), name: asString(org.name ?? data.name ?? data.orgName ?? data.email, "Postiz workspace") };
  }

  /** `GET /integrations`: the channels connected in Postiz. */
  async integrations(): Promise<PostizChannel[]> {
    const data = await this.request<unknown>("/integrations");
    const list = Array.isArray(data) ? data : (asRecord(data)?.integrations as unknown[] | undefined) ?? [];
    return list.map((raw) => channelOf(asRecord(raw) ?? {})).filter((c) => c.id);
  }

  /** `GET /integration-settings/:id`: the provider's rules and settings schema, as Postiz sends them. */
  async integrationSettings(integrationId: string): Promise<PostizIntegrationSettings> {
    return asRecord(await this.request<unknown>(`/integration-settings/${encodeURIComponent(integrationId)}`)) ?? {};
  }

  /* ---------------------------------------------------------------- media and posts (phase 2) */

  /** `POST /upload` (multipart field `file`): MP4 up to 1 GB, images up to 10 MB – checked here before anything is sent. */
  async upload(file: { name: string; type: string; bytes: Uint8Array }): Promise<PostizUpload> {
    const refused = checkUploadFile(file);
    if (refused) throw refused;
    const form = new FormData();
    form.append("file", new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
    const data = asRecord(await this.request<unknown>("/upload", { method: "POST", form, timeoutMs: this.uploadTimeoutMs })) ?? {};
    return { id: asString(data.id), path: asString(data.path) };
  }

  /** `POST /posts`: creates (or edits, with a group) the posts of one clip for every channel in one call. */
  async createPosts(body: PostizCreatePostsBody): Promise<PostizCreatedPost[]> {
    const data = await this.request<unknown>("/posts", { method: "POST", body });
    const list = Array.isArray(data) ? data : (asRecord(data)?.posts as unknown[] | undefined) ?? [];
    return list.map((raw) => {
      const r = asRecord(raw) ?? {};
      const group = asString(r.group);
      return { postId: asString(r.postId ?? r.id), integration: asString(r.integration), ...(group ? { group } : {}) };
    });
  }

  /** `GET /posts?startDate&endDate` (ISO times): the posts and their state in that window. */
  async posts(range: { startDate: string; endDate: string }): Promise<PostizPost[]> {
    const data = await this.request<unknown>("/posts", { query: { startDate: range.startDate, endDate: range.endDate } });
    const list = Array.isArray(data) ? data : (asRecord(data)?.posts as unknown[] | undefined) ?? [];
    return list.map((raw) => postOf(asRecord(raw) ?? {}));
  }

  /** `PUT /posts/:id/status`: a draft becomes scheduled, or a scheduled post a draft. */
  async setPostStatus(postId: string, status: PostStatusChange): Promise<void> {
    await this.request(`/posts/${encodeURIComponent(postId)}/status`, { method: "PUT", body: { status } });
  }

  /** `PUT /posts/:id/settings`: the provider settings of one post. */
  async setPostSettings(postId: string, settings: PostizProviderSettings): Promise<void> {
    await this.request(`/posts/${encodeURIComponent(postId)}/settings`, { method: "PUT", body: { settings } });
  }

  /** `DELETE /posts/:id` – removes the whole group the post belongs to (every channel of that clip). */
  async deletePost(postId: string): Promise<void> {
    await this.request(`/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
  }

  /** `GET /find-slot/:id`: Postiz's next free slot for a channel. */
  async findSlot(integrationId: string): Promise<PostizSlot> {
    const data = await this.request<unknown>(`/find-slot/${encodeURIComponent(integrationId)}`);
    const record = asRecord(data);
    return { date: asString(record ? record.date ?? record.slot : data) };
  }

  /** `GET /analytics/:integration?date=7|30|90`: a channel's series. */
  async analytics(integrationId: string, days: PostizAnalyticsDays): Promise<PostizAnalyticsSeries[]> {
    const data = await this.request<unknown>(`/analytics/${encodeURIComponent(integrationId)}`, { query: { date: days } });
    return seriesOf(data);
  }

  /** `GET /analytics/post/:postId?date=…`: one post's series. */
  async postAnalytics(postId: string, days: PostizAnalyticsDays): Promise<PostizAnalyticsSeries[]> {
    const data = await this.request<unknown>(`/analytics/post/${encodeURIComponent(postId)}`, { query: { date: days } });
    return seriesOf(data);
  }

  /** `GET /notifications?page=`: Postiz's own notices (an expired login, a failed post). */
  async notifications(page = 0): Promise<PostizNotice[]> {
    const data = await this.request<unknown>("/notifications", { query: { page: Math.max(0, Math.floor(page)) } });
    const list = Array.isArray(data) ? data : (asRecord(data)?.notifications as unknown[] | undefined) ?? [];
    return list.map((raw) => {
      const r = asRecord(raw) ?? {};
      return { id: asString(r.id), content: asString(r.content ?? r.message), createdAt: asString(r.createdAt), read: r.read === true };
    });
  }
}

/* ------------------------------------------------------------------ shapes */

function channelOf(r: Record<string, unknown>): PostizChannel {
  const customer = asRecord(r.customer);
  return {
    id: asString(r.id),
    name: asString(r.name, asString(r.profile, "Channel")),
    platform: asString(r.identifier ?? r.providerIdentifier ?? r.platform),
    picture: asString(r.picture) || null,
    disabled: r.disabled === true,
    customer: customer && asString(customer.id) ? { id: asString(customer.id), name: asString(customer.name) } : null,
  };
}

function postOf(r: Record<string, unknown>): PostizPost {
  const integration = asRecord(r.integration);
  const state = asString(r.state).toUpperCase();
  return {
    id: asString(r.id),
    content: asString(r.content),
    publishDate: asString(r.publishDate),
    state: (["QUEUE", "PUBLISHED", "ERROR", "DRAFT"].includes(state) ? state : "QUEUE") as PostizPostState,
    releaseURL: asString(r.releaseURL) || null,
    error: asString(r.error) || null,
    group: asString(r.group) || null,
    integration: integration ? { id: asString(integration.id), name: asString(integration.name), platform: asString(integration.providerIdentifier ?? integration.identifier), picture: asString(integration.picture) || null } : null,
  };
}

function seriesOf(data: unknown): PostizAnalyticsSeries[] {
  const list = Array.isArray(data) ? data : (asRecord(data)?.analytics as unknown[] | undefined) ?? [];
  return list.map((raw) => {
    const r = asRecord(raw) ?? {};
    const points = Array.isArray(r.data) ? r.data : [];
    return {
      label: asString(r.label),
      total: Number(r.total ?? points.reduce((n: number, p) => n + Number(asRecord(p)?.total ?? 0), 0)) || 0,
      data: points.map((p) => {
        const point = asRecord(p) ?? {};
        return { date: asString(point.date), total: Number(point.total) || 0 };
      }),
    };
  });
}
