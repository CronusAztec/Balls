import { isPublishPlatform, type PublishPlatform, type Visibility } from "./platforms";

/*
 * --- social-publish --- Path B, the page's (and the bot CLI's) side of the self-hosted relay (relay/server.mjs). TikTok's
 * Content Posting API needs a client secret at the token exchange and Instagram publishes Reels only from a public video
 * URL, so a small server holds the app secrets and the accounts' refresh tokens and posts for the page. Every call carries
 * the relay's access key (Authorization: Bearer); each key sees only the accounts it connected, so several people can
 * share one relay. The relay never hands tokens to the page.
 *
 *   GET    /api/me                  the key's label and which platforms the relay has apps for
 *   GET    /api/accounts            the key's connected accounts
 *   DELETE /api/accounts/:id        disconnect one
 *   POST   /api/connect/:platform   a one-time sign-in link for a popup (the callback stores the account, closes the popup)
 *   POST   /api/publish             multipart: the clip, the words, the account ids → a job id
 *   GET    /api/jobs/:id            per-account status, links and errors
 *
 * `fetch` (and, for upload progress, `sendForm`) are injected: the page uploads with XMLHttpRequest for its progress
 * events, the CLI and the tests with fetch.
 */

export interface RelayProfile {
  id: string;
  label: string;
  url: string;
  key: string;
}

export interface RelayAccount {
  id: string;
  platform: PublishPlatform;
  name: string;
  handle: string | null;
  avatar: string | null;
  connectedAt: string | null;
  /** "expired": the relay could not refresh its token – connect it again. */
  status: "ok" | "expired";
  note: string | null;
}

export interface RelayInfo {
  name: string;
  version: string;
  key: { id: string; label: string } | null;
  /** The platforms whose app keys the relay has. */
  platforms: Record<PublishPlatform, boolean>;
}

export type RelayItemStatus = "queued" | "uploading" | "processing" | "published" | "failed";

export interface RelayJobItem {
  accountId: string;
  platform: PublishPlatform;
  name: string;
  status: RelayItemStatus;
  progress: number;
  link: string | null;
  error: string | null;
  code: string | null;
  note: string | null;
}

export interface RelayJob {
  id: string;
  status: "running" | "done" | "partial" | "failed";
  items: RelayJobItem[];
}

/** The words of one platform, as composed by the page (caption.ts `composePost`). */
export interface RelayPost {
  title: string;
  text: string;
  hashtags: string[];
  tags?: string[];
}

export interface RelayPublishInput {
  file: Blob;
  fileName: string;
  accounts: string[];
  /** Shared words (the CLI sends these; the relay composes them per platform when `posts` has none). */
  title?: string;
  caption?: string;
  hashtags?: string[];
  /** Per platform, what the page composed. */
  posts?: Partial<Record<PublishPlatform, RelayPost>>;
  visibility?: Visibility;
  /** The clip's length (s), when known: the relay checks it against TikTok's limit for the account. */
  durationSec?: number | null;
}

export type RelayErrorCode = "badUrl" | "network" | "unauthorized" | "forbidden" | "notFound" | "tooLarge" | "badRequest" | "server" | "notConfigured" | "timeout" | "cancelled" | "unknown";

export class RelayError extends Error {
  readonly code: RelayErrorCode;
  readonly status?: number;
  constructor(code: RelayErrorCode, message: string, status?: number) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SendForm = (url: string, form: FormData, headers: Record<string, string>, onProgress?: (sent: number, total: number) => void) => Promise<{ status: number; json: unknown }>;

/** The relay's base URL ("https://relay.example.com", no trailing slash), null when it is not an http(s) URL. */
export function normalizeRelayUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

const PLATFORM_NAMES: Record<PublishPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

/** The error of a failed relay answer ({ error: { code, message } }). */
export function relayErrorFor(status: number, json: unknown): RelayError {
  const e = json && typeof json === "object" ? (json as { error?: { code?: unknown; message?: unknown } | string }).error : undefined;
  const message = typeof e === "string" ? e : e && typeof e.message === "string" ? e.message : null;
  const serverCode = e && typeof e === "object" && typeof e.code === "string" ? e.code : null;
  if (serverCode === "not_configured") return new RelayError("notConfigured", message ?? "The relay has no app keys for this platform.", status);
  if (status === 401) return new RelayError("unauthorized", message ?? "The relay did not accept this access key.", status);
  if (status === 403) return new RelayError("forbidden", message ?? "The relay refused this request.", status);
  if (status === 404) return new RelayError("notFound", message ?? "Not found on the relay.", status);
  if (status === 413) return new RelayError("tooLarge", message ?? "The clip is larger than the relay accepts.", status);
  if (status >= 400 && status < 500) return new RelayError("badRequest", message ?? `The relay refused the request (HTTP ${status}).`, status);
  if (status >= 500) return new RelayError("server", message ?? `The relay failed (HTTP ${status}).`, status);
  return new RelayError("unknown", message ?? `Unexpected answer from the relay (HTTP ${status}).`, status);
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A relay account from its JSON, null when it is not one. */
export function parseRelayAccount(raw: unknown): RelayAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isPublishPlatform(r.platform)) return null;
  return { id: r.id, platform: r.platform, name: str(r.name) ?? PLATFORM_NAMES[r.platform], handle: str(r.handle), avatar: str(r.avatar), connectedAt: str(r.connectedAt), status: r.status === "expired" ? "expired" : "ok", note: str(r.note) };
}

const ITEM_STATUSES: RelayItemStatus[] = ["queued", "uploading", "processing", "published", "failed"];

export function parseRelayJob(raw: unknown): RelayJob | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !Array.isArray(r.items)) return null;
  const items: RelayJobItem[] = [];
  for (const it of r.items) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    if (typeof i.accountId !== "string" || !isPublishPlatform(i.platform)) continue;
    const status = ITEM_STATUSES.includes(i.status as RelayItemStatus) ? (i.status as RelayItemStatus) : "queued";
    const progress = Number(i.progress);
    items.push({ accountId: i.accountId, platform: i.platform, name: str(i.name) ?? PLATFORM_NAMES[i.platform], status, progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0, link: str(i.link), error: str(i.error), code: str(i.code), note: str(i.note) });
  }
  const status = r.status === "done" || r.status === "partial" || r.status === "failed" ? r.status : "running";
  return { id: r.id, status, items };
}

/** A job is over once every account has published or failed (or the relay says it is over). */
export const jobFinished = (job: RelayJob) => (job.items.length > 0 && job.items.every((i) => i.status === "published" || i.status === "failed")) || (job.status !== "running" && job.items.every((i) => i.status === "published" || i.status === "failed"));

/** Uploads a form with fetch (no progress events; the CLI and the tests). */
export function fetchSendForm(fetchImpl: FetchLike): SendForm {
  return async (url, form, headers, onProgress) => {
    const res = await fetchImpl(url, { method: "POST", headers, body: form });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    onProgress?.(1, 1);
    return { status: res.status, json };
  };
}

/** Uploads a form with XMLHttpRequest, reporting the upload's progress (the page). */
export function xhrSendForm(XHR: typeof XMLHttpRequest): SendForm {
  return (url, form, headers, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XHR();
      xhr.open("POST", url);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.responseType = "text";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onload = () => {
        let json: unknown = null;
        try {
          json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          json = null;
        }
        resolve({ status: xhr.status, json });
      };
      xhr.onerror = () => reject(new RelayError("network", "The upload to the relay failed (connection or CORS)."));
      xhr.onabort = () => reject(new RelayError("cancelled", "The upload was cancelled."));
      xhr.send(form);
    });
}

export interface RelayClientOptions {
  fetch: FetchLike;
  sendForm?: SendForm;
}

export class RelayClient {
  readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly sendForm: SendForm;

  constructor(
    readonly profile: Pick<RelayProfile, "url" | "key">,
    options: RelayClientOptions,
  ) {
    const base = normalizeRelayUrl(profile.url);
    if (!base) throw new RelayError("badUrl", "The relay URL is not a valid http(s) address.");
    this.base = base;
    this.fetchImpl = options.fetch;
    this.sendForm = options.sendForm ?? fetchSendForm(options.fetch);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.profile.key.trim()}`, ...extra };
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers: this.headers((init.headers as Record<string, string>) ?? {}) });
    } catch (err) {
      throw new RelayError("network", `Could not reach the relay at ${this.base} (offline, wrong URL, or this site's origin is not in RELAY_ALLOWED_ORIGINS): ${err instanceof Error ? err.message : String(err)}`);
    }
    let json: unknown = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw relayErrorFor(res.status, json);
    return json;
  }

  /** The key's label and the relay's platforms ("Test connection"). */
  async info(): Promise<RelayInfo> {
    const json = (await this.call("/api/me")) as Record<string, unknown> | null;
    const p = (json?.platforms ?? {}) as Record<string, unknown>;
    const key = json?.key && typeof json.key === "object" ? (json.key as Record<string, unknown>) : null;
    return {
      name: str(json?.name) ?? "relay",
      version: str(json?.version) ?? "",
      key: key && typeof key.id === "string" ? { id: key.id, label: str(key.label) ?? "" } : null,
      platforms: { tiktok: p.tiktok === true, instagram: p.instagram === true, youtube: p.youtube === true },
    };
  }

  async accounts(): Promise<RelayAccount[]> {
    const json = (await this.call("/api/accounts")) as { accounts?: unknown[] } | null;
    return (json?.accounts ?? []).map(parseRelayAccount).filter((a): a is RelayAccount => !!a);
  }

  async removeAccount(id: string): Promise<void> {
    await this.call(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** A one-time sign-in link for a popup; `origin` is where the popup reports back (the page's origin). */
  async connectLink(platform: PublishPlatform, origin: string): Promise<string> {
    const json = (await this.call(`/api/connect/${platform}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin }) })) as { url?: unknown } | null;
    const url = str(json?.url);
    if (!url) throw new RelayError("server", "The relay returned no sign-in link.");
    return url;
  }

  /** Uploads the clip and starts a job; resolves with the job id. */
  async publish(input: RelayPublishInput, onProgress?: (sent: number, total: number) => void): Promise<{ jobId: string; job: RelayJob | null }> {
    const form = new FormData();
    form.append("accounts", input.accounts.join(","));
    if (input.title !== undefined) form.append("title", input.title);
    if (input.caption !== undefined) form.append("caption", input.caption);
    if (input.hashtags) form.append("hashtags", input.hashtags.join(" "));
    if (input.posts) form.append("posts", JSON.stringify(input.posts));
    form.append("visibility", input.visibility ?? "public");
    if (input.durationSec && Number.isFinite(input.durationSec)) form.append("durationSec", String(Math.round(100 * input.durationSec) / 100));
    form.append("file", input.file, input.fileName);
    let answer: { status: number; json: unknown };
    try {
      answer = await this.sendForm(`${this.base}/api/publish`, form, this.headers(), onProgress);
    } catch (err) {
      if (err instanceof RelayError) throw err;
      throw new RelayError("network", `The upload to the relay failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (answer.status < 200 || answer.status >= 300) throw relayErrorFor(answer.status, answer.json);
    const json = answer.json as { jobId?: unknown; job?: unknown } | null;
    const jobId = str(json?.jobId);
    if (!jobId) throw new RelayError("server", "The relay started no job.");
    return { jobId, job: parseRelayJob(json?.job) };
  }

  async job(id: string): Promise<RelayJob> {
    const job = parseRelayJob(await this.call(`/api/jobs/${encodeURIComponent(id)}`));
    if (!job) throw new RelayError("server", "The relay answered with no job.");
    return job;
  }

  /** Polls a job until every account is done; `onUpdate` sees every state. */
  async waitForJob(id: string, options: { onUpdate?: (job: RelayJob) => void; intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<RelayJob> {
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = options.now ?? (() => Date.now());
    const until = now() + (options.timeoutMs ?? 20 * 60 * 1000);
    let failures = 0;
    for (;;) {
      if (options.signal?.aborted) throw new RelayError("cancelled", "Stopped waiting for the relay.");
      let job: RelayJob | null = null;
      try {
        job = await this.job(id);
        failures = 0;
      } catch (err) {
        // A few dropped polls are fine (a sleeping free host); a refused key or a lost job is not.
        if (!(err instanceof RelayError) || (err.code !== "network" && err.code !== "server") || ++failures > 5) throw err;
      }
      if (job) {
        options.onUpdate?.(job);
        if (jobFinished(job)) return job;
      }
      if (now() > until) throw new RelayError("timeout", "The relay is still publishing – check the job again later.");
      await sleep(options.intervalMs ?? 2000);
    }
  }
}
