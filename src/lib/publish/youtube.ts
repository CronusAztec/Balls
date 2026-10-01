import type { Visibility } from "./platforms";

/*
 * --- social-publish --- Path A, YouTube straight from the browser (no server): Google OAuth 2.0 through the Google Identity
 * Services token client (https://accounts.google.com/gsi/client, loaded on demand) for an access token with the
 * youtube.upload scope (plus youtube.readonly to show the channel's name and avatar), then a resumable upload to
 * https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable: a POST with the video resource (title,
 * description, tags, privacy, not made for kids) opens an upload session, PUTs send the file in 256 KiB-aligned chunks,
 * a 308 "Resume Incomplete" answer says how much arrived (the next chunk starts there), a network error or a 5xx asks the
 * session how far it got and resumes after a back-off. Tokens live in this browser only (localStorage, see store.ts);
 * Google gives browser apps no refresh token, so an expired token is renewed by asking again (a popup). `fetch` is
 * injected, so tests run the whole flow against a mock.
 */

export const GIS_SRC = "https://accounts.google.com/gsi/client";
export const YT_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YT_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YT_SCOPES = [YT_UPLOAD_SCOPE, YT_READONLY_SCOPE];
export const YT_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
export const YT_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
/** Upload chunks: a multiple of 256 KiB, as the resumable protocol wants. */
export const YT_CHUNK_ALIGN = 256 * 1024;
export const YT_DEFAULT_CHUNK = 8 * 1024 * 1024;
/** YouTube category "Entertainment". */
export const YT_CATEGORY = "24";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type YouTubeErrorCode = "auth" | "scope" | "quota" | "forbidden" | "noChannel" | "network" | "server" | "session" | "badRequest" | "cancelled" | "popup" | "config" | "unknown";

export class YouTubeError extends Error {
  readonly code: YouTubeErrorCode;
  readonly status?: number;
  readonly reason?: string;
  constructor(code: YouTubeErrorCode, message: string, status?: number, reason?: string) {
    super(message);
    this.name = "YouTubeError";
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ Google Identity Services */

export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GisTokenClient {
  requestAccessToken: (overrides?: { prompt?: string; hint?: string; login_hint?: string }) => void;
}

export interface GisOauth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    hint?: string;
    include_granted_scopes?: boolean;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => GisTokenClient;
  revoke?: (token: string, done?: () => void) => void;
}

type GisWindow = { google?: { accounts?: { oauth2?: GisOauth2 } } };

/** The GIS oauth2 object when the script has loaded. */
export function gisOf(win: unknown): GisOauth2 | null {
  return (win as GisWindow | null)?.google?.accounts?.oauth2 ?? null;
}

let gisLoading: Promise<GisOauth2> | null = null;

/** Loads the Google Identity Services script once (resolves at once when it is there already). */
export function loadGoogleIdentity(win: Window & typeof globalThis, doc: Document, timeoutMs = 15000): Promise<GisOauth2> {
  const ready = gisOf(win);
  if (ready) return Promise.resolve(ready);
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<GisOauth2>((resolve, reject) => {
    const done = () => {
      const gis = gisOf(win);
      if (gis) resolve(gis);
      else reject(new YouTubeError("network", "Google sign-in did not load."));
    };
    let script = doc.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = doc.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      doc.head.appendChild(script);
    }
    const timer = win.setTimeout(() => reject(new YouTubeError("network", "Google sign-in did not load (blocked or offline?).")), timeoutMs);
    script.addEventListener("load", () => {
      win.clearTimeout(timer);
      done();
    });
    script.addEventListener("error", () => {
      win.clearTimeout(timer);
      reject(new YouTubeError("network", "Google sign-in could not be loaded (blocked or offline?)."));
    });
  }).catch((err) => {
    gisLoading = null;
    throw err;
  });
  return gisLoading;
}

export interface YouTubeToken {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

/** A token response turned into a token, or the error it carries (a missing upload permission included). */
export function tokenFromResponse(response: GisTokenResponse, now: number): YouTubeToken {
  if (response.error || !response.access_token) {
    const msg = response.error_description || response.error || "no access token";
    throw new YouTubeError(response.error === "access_denied" ? "cancelled" : "auth", `Google sign-in failed: ${msg}.`);
  }
  const scope = response.scope ?? "";
  if (scope && !scope.split(/\s+/).includes(YT_UPLOAD_SCOPE)) throw new YouTubeError("scope", "Google did not grant the “Manage your YouTube videos” permission, which the upload needs – connect again and keep it ticked.");
  const expiresIn = Number(response.expires_in);
  return { accessToken: response.access_token, expiresAt: now + 1000 * (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600), scope };
}

/**
 * Asks Google for an access token in a popup. Call it straight from a click (after the script has loaded), or the browser
 * may block the popup. `prompt`: "select_account" to add another account, "" to renew a known one.
 */
export function requestYouTubeToken(gis: GisOauth2, clientId: string, options: { prompt?: string; hint?: string; now?: () => number } = {}): Promise<YouTubeToken> {
  if (!clientId.trim()) return Promise.reject(new YouTubeError("config", "No OAuth client ID is set up for YouTube."));
  const now = options.now ?? (() => Date.now());
  return new Promise<YouTubeToken>((resolve, reject) => {
    const client = gis.initTokenClient({
      client_id: clientId.trim(),
      scope: YT_SCOPES.join(" "),
      include_granted_scopes: true,
      callback: (response) => {
        try {
          resolve(tokenFromResponse(response, now()));
        } catch (err) {
          reject(err);
        }
      },
      error_callback: (error) => {
        const type = error?.type ?? "";
        if (type === "popup_failed_to_open") reject(new YouTubeError("popup", "The Google sign-in window was blocked – allow pop-ups for this site and try again."));
        else if (type === "popup_closed") reject(new YouTubeError("cancelled", "The Google sign-in window was closed."));
        else reject(new YouTubeError("auth", `Google sign-in failed${error?.message ? `: ${error.message}` : ""}.`));
      },
    });
    const overrides: { prompt?: string; hint?: string } = {};
    if (options.prompt !== undefined) overrides.prompt = options.prompt;
    if (options.hint) overrides.hint = options.hint;
    client.requestAccessToken(overrides);
  });
}

/* ------------------------------------------------------------------ errors */

/** Google's error body ({ error: { code, message, errors: [{ reason }] } }) as a message and a reason. */
export function googleErrorInfo(json: unknown): { message: string | null; reason: string | null } {
  if (!json || typeof json !== "object") return { message: null, reason: null };
  const error = (json as { error?: unknown }).error;
  if (typeof error === "string") return { message: (json as { error_description?: string }).error_description ?? error, reason: error };
  if (!error || typeof error !== "object") return { message: null, reason: null };
  const e = error as { message?: unknown; errors?: { reason?: unknown }[]; status?: unknown };
  const reason = Array.isArray(e.errors) && e.errors[0] && typeof e.errors[0].reason === "string" ? e.errors[0].reason : typeof e.status === "string" ? e.status : null;
  return { message: typeof e.message === "string" ? e.message : null, reason };
}

/** The YouTubeError of a failed API answer, with a message that says what to do. */
export function youtubeErrorFor(status: number, json: unknown): YouTubeError {
  const { message, reason } = googleErrorInfo(json);
  const detail = message ? ` (${message})` : "";
  if (status === 401) return new YouTubeError("auth", "The YouTube sign-in has expired – sign in again.", status, reason ?? undefined);
  if (reason === "quotaExceeded" || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return new YouTubeError("quota", `The YouTube API quota of this app is used up for today – try again tomorrow or raise the quota in Google Cloud${detail}.`, status, reason);
  if (reason === "uploadLimitExceeded") return new YouTubeError("quota", `This channel has reached YouTube's upload limit for now – try again later${detail}.`, status, reason);
  if (reason === "youtubeSignupRequired" || reason === "channelNotFound") return new YouTubeError("noChannel", "This Google account has no YouTube channel yet – create one on youtube.com first.", status, reason);
  if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || reason === "PERMISSION_DENIED") return new YouTubeError("scope", `The sign-in did not grant the YouTube permissions – connect again and allow them${detail}.`, status, reason);
  if (status === 403) return new YouTubeError("forbidden", `YouTube refused the upload${detail}. An app Google has not verified yet can only be used by its test users (OAuth consent screen → Test users).`, status, reason ?? undefined);
  if (status === 404) return new YouTubeError("session", "The upload session has expired – send again.", status, reason ?? undefined);
  if (status === 400) return new YouTubeError("badRequest", `YouTube refused the video details${detail}.`, status, reason ?? undefined);
  if (status >= 500 || status === 429) return new YouTubeError("server", `YouTube is not answering right now (HTTP ${status}) – try again.`, status, reason ?? undefined);
  return new YouTubeError("unknown", `YouTube answered HTTP ${status}${detail}.`, status, reason ?? undefined);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ channel */

export interface YouTubeChannel {
  id: string;
  title: string;
  handle: string | null;
  avatar: string | null;
}

/** The signed-in account's channel (youtube.channels list, mine=true). */
export async function fetchMyChannel(fetchImpl: FetchLike, accessToken: string): Promise<YouTubeChannel> {
  let res: Response;
  try {
    res = await fetchImpl(`${YT_CHANNELS_URL}?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    throw new YouTubeError("network", `Could not reach YouTube: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = await readJson(res);
  if (!res.ok) throw youtubeErrorFor(res.status, json);
  const item = (json as { items?: { id?: string; snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> } }[] } | null)?.items?.[0];
  if (!item?.id) throw new YouTubeError("noChannel", "This Google account has no YouTube channel yet – create one on youtube.com first.");
  const thumbs = item.snippet?.thumbnails ?? {};
  return { id: item.id, title: item.snippet?.title || "YouTube", handle: item.snippet?.customUrl || null, avatar: thumbs.default?.url ?? thumbs.medium?.url ?? thumbs.high?.url ?? null };
}

/* ------------------------------------------------------------------ the video */

export interface YouTubeVideoMeta {
  title: string;
  description: string;
  tags: string[];
  privacy: Visibility;
  madeForKids?: boolean;
  categoryId?: string;
}

/** The videos.insert resource (part=snippet,status). */
export function youtubeVideoResource(meta: YouTubeVideoMeta) {
  return {
    snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId ?? YT_CATEGORY },
    status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: meta.madeForKids ?? false, embeddable: true },
  };
}

/** The resumable session's start URL. */
export const resumableStartUrl = () => `${YT_UPLOAD_URL}?uploadType=resumable&part=snippet,status`;

/** Opens an upload session: its URL (the Location header). */
export async function startResumableSession(fetchImpl: FetchLike, accessToken: string, meta: YouTubeVideoMeta, size: number, type: string): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(resumableStartUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": type || "video/*" },
      body: JSON.stringify(youtubeVideoResource(meta)),
    });
  } catch (err) {
    throw new YouTubeError("network", `Could not reach YouTube: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw youtubeErrorFor(res.status, await readJson(res));
  const location = res.headers.get("Location") || res.headers.get("location");
  if (!location) throw new YouTubeError("server", "YouTube opened no upload session (no Location header).");
  return location;
}

/** The next byte to send after a 308's Range header ("bytes=0-524287" → 524288; no header → 0). */
export function nextOffsetFromRange(range: string | null): number {
  const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
  return m ? Number(m[2]) + 1 : 0;
}

export interface UploadProgress {
  sent: number;
  total: number;
}

export interface ResumableOptions {
  chunkSize?: number;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  /** Retries of one chunk (network errors, 5xx, 429) before giving up. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Back-off before retry n (1-based), ms. */
  backoffMs?: (attempt: number) => number;
}

export interface UploadedVideo {
  id: string;
  url: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A Short's link. */
export const shortsUrl = (id: string) => `https://www.youtube.com/shorts/${encodeURIComponent(id)}`;

/** Sends the file through an open session, resuming after 308s and errors; resolves with the video. */
export async function uploadResumable(fetchImpl: FetchLike, sessionUrl: string, blob: Blob, options: ResumableOptions = {}): Promise<UploadedVideo> {
  const total = blob.size;
  const type = blob.type || "video/*";
  const align = YT_CHUNK_ALIGN;
  const chunk = Math.max(align, Math.floor((options.chunkSize ?? YT_DEFAULT_CHUNK) / align) * align);
  const maxRetries = options.maxRetries ?? 5;
  const sleep = options.sleep ?? defaultSleep;
  const backoff = options.backoffMs ?? ((n: number) => Math.min(30000, 1000 * 2 ** (n - 1)) + Math.floor(Math.random() * 250));
  const aborted = () => options.signal?.aborted;
  const done = async (res: Response): Promise<UploadedVideo> => {
    const json = (await readJson(res)) as { id?: string } | null;
    if (!json?.id) throw new YouTubeError("server", "YouTube finished the upload but returned no video id.");
    options.onProgress?.({ sent: total, total });
    return { id: json.id, url: shortsUrl(json.id) };
  };
  /** Asks the session how much arrived: the next offset, or the finished video. */
  const status = async (): Promise<number | UploadedVideo> => {
    const res = await fetchImpl(sessionUrl, { method: "PUT", headers: { "Content-Range": `bytes */${total}` }, signal: options.signal });
    if (res.status === 200 || res.status === 201) return done(res);
    if (res.status === 308) return nextOffsetFromRange(res.headers.get("Range"));
    throw youtubeErrorFor(res.status, await readJson(res));
  };
  let offset = 0;
  let retries = 0;
  options.onProgress?.({ sent: 0, total });
  for (;;) {
    if (aborted()) throw new YouTubeError("cancelled", "The upload was cancelled.");
    const end = Math.min(total, offset + chunk);
    let res: Response | null = null;
    let failure: YouTubeError | null = null;
    try {
      res = await fetchImpl(sessionUrl, { method: "PUT", headers: { "Content-Range": total === 0 ? `bytes */0` : `bytes ${offset}-${end - 1}/${total}`, "Content-Type": type }, body: blob.slice(offset, end), signal: options.signal });
    } catch (err) {
      if (aborted()) throw new YouTubeError("cancelled", "The upload was cancelled.");
      failure = new YouTubeError("network", `The connection dropped during the upload: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res) {
      if (res.status === 200 || res.status === 201) return done(res);
      if (res.status === 308) {
        const next = nextOffsetFromRange(res.headers.get("Range"));
        if (next > offset) retries = 0;
        offset = next;
        options.onProgress?.({ sent: offset, total });
        continue;
      }
      if (res.status >= 500 || res.status === 429) failure = youtubeErrorFor(res.status, await readJson(res));
      else throw youtubeErrorFor(res.status, await readJson(res));
    }
    // A dropped connection or a server error: wait, ask the session how far it got, go on from there.
    retries += 1;
    if (retries > maxRetries) throw failure ?? new YouTubeError("server", "The upload kept failing.");
    await sleep(backoff(retries));
    try {
      const s = await status();
      if (typeof s !== "number") return s;
      offset = s;
      options.onProgress?.({ sent: offset, total });
    } catch (err) {
      if (err instanceof YouTubeError && (err.code === "server" || err.code === "network")) continue;
      if (aborted()) throw new YouTubeError("cancelled", "The upload was cancelled.");
      if (err instanceof YouTubeError) throw err;
      // A network error while asking: try the chunk again from the last known offset.
    }
  }
}

/** The whole direct upload: session, chunks, the Short's link. */
export async function uploadToYouTube(fetchImpl: FetchLike, accessToken: string, blob: Blob, meta: YouTubeVideoMeta, options: ResumableOptions = {}): Promise<UploadedVideo> {
  const session = await startResumableSession(fetchImpl, accessToken, meta, blob.size, blob.type);
  return uploadResumable(fetchImpl, session, blob, options);
}
