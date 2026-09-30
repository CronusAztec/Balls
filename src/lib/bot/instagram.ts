/*
 * --- viral-bot --- Publishing a Reel through the Instagram Graph API (content publishing), as request builders and one
 * flow that takes its `fetch` from the caller – so the CLI (scripts/viral-bot.mjs) uses it with Node's fetch and the tests
 * with a mock. Two steps, as the API wants them:
 *
 *   1. POST /{ig-user-id}/media  media_type=REELS, video_url (a public HTTPS URL of the MP4), caption, share_to_feed
 *      → { id: <container id> }; Instagram downloads and processes the video;
 *   2. GET /{container-id}?fields=status_code,status until status_code is FINISHED (ERROR / EXPIRED fail),
 *      then POST /{ig-user-id}/media_publish  creation_id=<container id> → { id: <media id> }.
 *
 * The access token goes in the POST bodies, never in a logged URL; `redact()` hides it in anything printed. Nothing here
 * posts on its own: the CLI only calls `publishReel()` with --post and the three settings below.
 */

export const DEFAULT_GRAPH_HOST = "https://graph.facebook.com";
export const DEFAULT_GRAPH_VERSION = "v23.0";

/** Environment variables the publisher reads (never committed; see .env.example and the README). */
export const INSTAGRAM_ENV = { userId: "IG_USER_ID", token: "IG_ACCESS_TOKEN", videoBaseUrl: "BOT_VIDEO_BASE_URL", graphVersion: "IG_GRAPH_VERSION", graphHost: "IG_GRAPH_HOST" } as const;

export interface InstagramConfig {
  /** The Instagram professional account's user id (IG_USER_ID). */
  userId: string;
  /** A long-lived access token with instagram_basic and instagram_content_publish (IG_ACCESS_TOKEN). */
  accessToken: string;
  /** "v23.0" by default (IG_GRAPH_VERSION). */
  graphVersion?: string;
  /** https://graph.facebook.com by default; https://graph.instagram.com for Instagram Login tokens (IG_GRAPH_HOST). */
  host?: string;
}

export interface GraphRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  /** application/x-www-form-urlencoded body of a POST. */
  body?: string;
}

export interface ReelInput {
  /** Public URL Instagram downloads the video from (HTTPS, MP4 / H.264 + AAC). */
  videoUrl: string;
  caption: string;
  /** Also show the Reel in the profile grid (default true). */
  shareToFeed?: boolean;
  /** Frame (ms) used as the cover. */
  thumbOffsetMs?: number;
}

const base = (config: InstagramConfig) => `${(config.host || DEFAULT_GRAPH_HOST).replace(/\/+$/, "")}/${config.graphVersion || DEFAULT_GRAPH_VERSION}`;
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/** Step 1: the REELS media container. */
export function createReelContainerRequest(config: InstagramConfig, input: ReelInput): GraphRequest {
  const body = new URLSearchParams({ media_type: "REELS", video_url: input.videoUrl, caption: input.caption, share_to_feed: input.shareToFeed === false ? "false" : "true" });
  if (input.thumbOffsetMs !== undefined && Number.isFinite(input.thumbOffsetMs)) body.set("thumb_offset", String(Math.max(0, Math.round(input.thumbOffsetMs))));
  body.set("access_token", config.accessToken);
  return { method: "POST", url: `${base(config)}/${encodeURIComponent(config.userId)}/media`, headers: { ...FORM }, body: body.toString() };
}

/** Step 2a: the container's processing status. */
export function containerStatusRequest(config: InstagramConfig, containerId: string): GraphRequest {
  const params = new URLSearchParams({ fields: "status_code,status", access_token: config.accessToken });
  return { method: "GET", url: `${base(config)}/${encodeURIComponent(containerId)}?${params.toString()}`, headers: {} };
}

/** Step 2b: publish the finished container. */
export function publishRequest(config: InstagramConfig, containerId: string): GraphRequest {
  const body = new URLSearchParams({ creation_id: containerId, access_token: config.accessToken });
  return { method: "POST", url: `${base(config)}/${encodeURIComponent(config.userId)}/media_publish`, headers: { ...FORM }, body: body.toString() };
}

/** The published media's permalink (for the log). */
export function permalinkRequest(config: InstagramConfig, mediaId: string): GraphRequest {
  const params = new URLSearchParams({ fields: "permalink", access_token: config.accessToken });
  return { method: "GET", url: `${base(config)}/${encodeURIComponent(mediaId)}?${params.toString()}`, headers: {} };
}

/** `text` with every occurrence of the secret (and of its URL-encoded form) replaced by "***". */
export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text;
  let out = text.split(secret).join("***");
  const encoded = encodeURIComponent(secret);
  if (encoded !== secret) out = out.split(encoded).join("***");
  return out;
}

/** The public URL of a file of the output folder: the base URL (BOT_VIDEO_BASE_URL) plus the encoded file name. */
export function publicVideoUrl(baseUrl: string, fileName: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
}

/** The publisher's settings from the environment, and the names of the ones missing. */
export function instagramConfigFromEnv(env: Record<string, string | undefined>): { config: InstagramConfig | null; videoBaseUrl: string | null; missing: string[] } {
  const userId = env[INSTAGRAM_ENV.userId]?.trim() ?? "";
  const accessToken = env[INSTAGRAM_ENV.token]?.trim() ?? "";
  const videoBaseUrl = env[INSTAGRAM_ENV.videoBaseUrl]?.trim() ?? "";
  const missing = [!userId && INSTAGRAM_ENV.userId, !accessToken && INSTAGRAM_ENV.token, !videoBaseUrl && INSTAGRAM_ENV.videoBaseUrl].filter((x): x is (typeof INSTAGRAM_ENV)["userId" | "token" | "videoBaseUrl"] => !!x);
  if (!userId || !accessToken) return { config: null, videoBaseUrl: videoBaseUrl || null, missing };
  return {
    config: { userId, accessToken, graphVersion: env[INSTAGRAM_ENV.graphVersion]?.trim() || undefined, host: env[INSTAGRAM_ENV.graphHost]?.trim() || undefined },
    videoBaseUrl: videoBaseUrl || null,
    missing,
  };
}

export type PublishStep = "container" | "status" | "publish";

export class InstagramError extends Error {
  constructor(
    readonly step: PublishStep,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

/** The error message of a Graph API response body ({ error: { message, type, code } }), or null. */
export function graphErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const error = (json as { error?: { message?: unknown; type?: unknown; code?: unknown; error_user_msg?: unknown } }).error;
  if (!error || typeof error !== "object") return null;
  const parts = [typeof error.message === "string" ? error.message : "Graph API error", typeof error.type === "string" ? `(${error.type}${error.code !== undefined ? ` ${String(error.code)}` : ""})` : ""];
  if (typeof error.error_user_msg === "string") parts.push(`– ${error.error_user_msg}`);
  return parts.filter(Boolean).join(" ");
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

async function send(fetchImpl: FetchLike, request: GraphRequest, step: PublishStep, secret: string): Promise<Record<string, unknown>> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body });
  } catch (err) {
    throw new InstagramError(step, redact(`Network error: ${err instanceof Error ? err.message : String(err)}`, secret));
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    /* not JSON */
  }
  const message = graphErrorMessage(json);
  if (!response.ok || message) throw new InstagramError(step, redact(message ?? `HTTP ${response.status}`, secret), response.status);
  return (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
}

export interface PublishOptions {
  /** Between two status checks (ms). */
  pollMs?: number;
  /** Status checks before giving up (the container stays; publish it later by its id). */
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (status: string, poll: number) => void;
}

export interface PublishResult {
  containerId: string;
  mediaId: string;
  permalink: string | null;
}

/** The whole flow: container → status until FINISHED → publish → permalink. Throws an InstagramError naming the step. */
export async function publishReel(fetchImpl: FetchLike, config: InstagramConfig, input: ReelInput, options: PublishOptions = {}): Promise<PublishResult> {
  const secret = config.accessToken;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const created = await send(fetchImpl, createReelContainerRequest(config, input), "container", secret);
  const containerId = typeof created.id === "string" ? created.id : typeof created.id === "number" ? String(created.id) : "";
  if (!containerId) throw new InstagramError("container", "The API returned no container id.");
  const maxPolls = Math.max(1, options.maxPolls ?? 60);
  let finished = false;
  for (let poll = 1; poll <= maxPolls; poll++) {
    const status = await send(fetchImpl, containerStatusRequest(config, containerId), "status", secret);
    const code = typeof status.status_code === "string" ? status.status_code : "";
    options.onStatus?.(code, poll);
    if (code === "FINISHED" || code === "PUBLISHED") {
      finished = true;
      break;
    }
    if (code === "ERROR" || code === "EXPIRED") throw new InstagramError("status", redact(`The video could not be processed (${code}${typeof status.status === "string" ? `: ${status.status}` : ""}).`, secret));
    await sleep(options.pollMs ?? 5000);
  }
  if (!finished) throw new InstagramError("status", `Still processing after ${maxPolls} checks – publish container ${containerId} later.`);
  const published = await send(fetchImpl, publishRequest(config, containerId), "publish", secret);
  const mediaId = typeof published.id === "string" ? published.id : typeof published.id === "number" ? String(published.id) : "";
  if (!mediaId) throw new InstagramError("publish", "The API returned no media id.");
  let permalink: string | null = null;
  try {
    const link = await send(fetchImpl, permalinkRequest(config, mediaId), "publish", secret);
    permalink = typeof link.permalink === "string" ? link.permalink : null;
  } catch {
    /* the Reel is published; the link is only for the log */
  }
  return { containerId, mediaId, permalink };
}
