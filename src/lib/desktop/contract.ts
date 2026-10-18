/*
 * --- desktop-exe --- The contract between the Windows desktop app (desktop/, Electron) and the page it shows.
 *
 * The app loads the site's static export through its app:// protocol; its preload script (desktop/src/preload.ts) exposes
 * `window.desktop` – a typed bridge over IPC, with context isolation on and Node integration off. This file is the single
 * source of truth for that bridge: the channel names the main process handles, the events it sends and the shapes that
 * travel both ways. It is pure (no Electron, no DOM), so the site builds without the app's dependencies and the app's
 * tests (desktop/tests/ipc.test.ts) check that the preload and the main process implement exactly these channels.
 */

/** Bumped when a channel changes shape; the page ignores a bridge of another major version (`getDesktop()`). */
export const DESKTOP_API_VERSION = 1;

/** Request / response channels (`ipcRenderer.invoke` ↔ `ipcMain.handle`). */
export const IPC = {
  info: "desktop:info",
  log: "desktop:log",
  openLogs: "desktop:open-logs",
  prefsGet: "prefs:get",
  prefsSet: "prefs:set",
  gpuStatus: "gpu:status",
  gpuProbe: "gpu:probe-encoders",
  gpuBenchmark: "gpu:benchmark",
  pickFolder: "dialog:pick-folder",
  pickMedia: "dialog:pick-media",
  renderSave: "render:save",
  renderCancel: "render:cancel",
  journalLoad: "journal:load",
  journalSave: "journal:save",
  customLoad: "custom:load", // --- custom-content --- the player's own fighters and modes (kept in the data folder)
  customSave: "custom:save",
  libraryList: "library:list",
  libraryRemove: "library:remove",
  libraryReveal: "library:reveal",
  libraryOpen: "library:open",
  libraryOpenFolder: "library:open-folder",
  libraryRead: "library:read",
  aiStatus: "ai:status",
  aiModels: "ai:models",
  aiModelDownload: "ai:model-download",
  aiModelCancel: "ai:model-cancel",
  aiModelImport: "ai:model-import",
  aiModelSelect: "ai:model-select",
  aiModelRemove: "ai:model-remove",
  aiChat: "ai:chat",
  aiCancel: "ai:cancel",
  aiSetCloud: "ai:set-cloud",
  aiClearCloudKey: "ai:clear-cloud-key",
  aiPlaybook: "ai:playbook",
  updateCheck: "update:check",
  updateInstall: "update:install",
  updateState: "update:state", // --- low-findings-2 --- the updater's status as it is (no check)
  aiDiagnose: "ai:diagnose", // --- desktop-ai-fix --- the AI status / diagnostics panel
  // --- social-postiz --- the Accounts tab: the Postiz key, the channels connected in Postiz and its notices (phase 1 of docs/SOCIAL-AUTOPILOT.md)
  socialKeyStatus: "social:key-status",
  socialKeySet: "social:key-set",
  socialKeyForget: "social:key-forget",
  socialChannels: "social:channels",
  socialNotices: "social:notices",
  // --- social-postiz --- phase 2: a Library clip through Postiz (prepare the MP4, post after the card's approval), the
  // outcomes, deleting a post, the audit log, a channel's settings schema and Postiz's next free slot
  socialPrepare: "social:prepare",
  socialPost: "social:post",
  socialPosts: "social:posts",
  socialPostDelete: "social:post-delete",
  socialAudit: "social:audit",
  socialChannelSettings: "social:channel-settings",
  socialSlot: "social:slot",
  // --- social-autopilot --- phases 3–4: the proposal queue (a proposal never reaches Postiz; approve runs the card's request)
  // and the autopilot's settings
  socialQueueList: "social:queue-list",
  socialQueuePropose: "social:queue-propose",
  socialQueueApprove: "social:queue-approve",
  socialQueueEdit: "social:queue-edit",
  socialQueueSkip: "social:queue-skip",
  socialQueueRemove: "social:queue-remove",
  socialAutopilotGet: "social:autopilot-get",
  socialAutopilotSet: "social:autopilot-set",
} as const;
export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Events the main process sends to the page (`webContents.send` → `ipcRenderer.on`). */
export const DESKTOP_EVENTS = {
  menu: "desktop:menu",
  openFile: "desktop:open-file",
  aiToken: "ai:token",
  modelProgress: "ai:model-progress",
  renderProgress: "render:progress",
  update: "update:status",
  socialProgress: "social:progress", // --- social-postiz --- a clip on its way to Postiz (transcode, upload, create)
  socialQueue: "social:queue", // --- social-autopilot --- the proposal queue changed (the whole list travels)
} as const;
export type DesktopEventChannel = (typeof DESKTOP_EVENTS)[keyof typeof DESKTOP_EVENTS];

/* ------------------------------------------------------------------ app */

export interface DesktopInfo {
  appName: string;
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
  /** Running from an installed / portable build (false: `electron .` from a checkout). */
  packaged: boolean;
  /** The app's data folder (models, library index, journal, logs). */
  dataDir: string;
  logFile: string;
  /** How the app was started: "--smoke" runs load the page, report and quit. */
  smoke: boolean;
  /** --- build-identity --- The portable EXE (data beside it, no self-update); absent or false: the installer (or a checkout). */
  portable?: boolean;
  /** --- build-identity --- Started with --safe-mode / JBL_SAFE_MODE=1 (GPU acceleration off). */
  safeMode?: boolean;
}

/**
 * --- build-identity --- The website build inside the app: the parts of the site export's version.json (scripts/lib/build-info.cjs)
 * the main process shows in About, the log, the diagnostics and the --smoke result. The page has the same facts compiled in
 * (src/lib/buildInfo.ts), so this never travels over the bridge.
 */
export interface SiteStamp {
  siteVersion: string;
  /** "1.10.0+8fa8dbb". */
  build: string;
  commit: string | null;
  commitShort: string | null;
  /** UTC, "2026-10-14T01:57:35Z". */
  commitDate: string | null;
  /** The Windows app version the export was built for (null: unknown). */
  desktopVersion: string | null;
}

export type LogLevel = "info" | "warn" | "error";

/** Preferences the app keeps (electron-store) – not simulator settings, which stay in the page. */
export interface DesktopPrefs {
  /** Folder the render queue saves clips to ("" = Videos/JumpingBallsLive). */
  outputFolder: string;
  /** Ask WebCodecs for the GPU encoder first (`hardwareAcceleration: "prefer-hardware"`, software fallback kept). */
  preferHardware: boolean;
  /** A full ffmpeg build the user picked instead of the bundled one ("" = bundled). */
  ffmpegPath: string;
  /** Force an ffmpeg encoder for H.264 ("" = automatic: NVENC, AMF, QSV, else libx264). */
  encoderOverride: string;
  /** Closing the window hides it in the tray while a queue is rendering. */
  closeToTray: boolean;
  autoUpdate: boolean;
  /** Which AI answers: the local model or the cloud provider. */
  aiProvider: AiProviderKind;
  /** The local model in use (a catalog id or "custom:<file name>"). */
  localModel: string;
  /** GPU layers for the local model: "auto" or 0 (CPU only). */
  aiGpu: "auto" | "off";
}

/** Menu, tray and shortcut actions the page carries out. */
export const MENU_ACTIONS = ["start", "restart", "fast-export", "record", "queue", "library", "ai", "gpu", "open-song", "open-video", "open-project", "find"] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

/** Kinds of media the native "Open…" dialogs pick. */
export const MEDIA_KINDS = ["song", "video", "midi", "image", "project"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** A file read by the main process (native dialog, drag and drop, second instance): the page turns it into a `File`. */
export interface PickedFile {
  name: string;
  path: string;
  mimeType: string;
  kind: MediaKind | "model" | "unknown";
  data: Uint8Array;
}

/* ------------------------------------------------------------------ GPU and encoders */

export type GpuVendor = "nvidia" | "amd" | "intel" | "microsoft" | "apple" | "other";

export interface GpuDevice {
  vendor: GpuVendor;
  vendorId: number;
  deviceId: number;
  name: string;
  driver: string;
  active: boolean;
}

export interface GpuStatus {
  devices: GpuDevice[];
  /** Chromium's feature status (chrome://gpu): gpu_compositing, rasterization, video_decode, video_encode, webgpu… */
  features: Record<string, string>;
  /** Chromium encodes video on the GPU (Media Foundation on Windows). */
  hardwareVideoEncode: boolean;
  hardwareVideoDecode: boolean;
  webgpu: boolean;
  /** The switches the app launched with (ignore-gpu-blocklist…). */
  switches: string[];
  /** GPU acceleration was turned off (safe mode). */
  disabled: boolean;
}

export const VIDEO_CODECS = ["h264", "hevc", "av1"] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

export type EncoderKind = "nvenc" | "amf" | "qsv" | "mf" | "vaapi" | "videotoolbox" | "software";

export interface EncoderInfo {
  /** ffmpeg's encoder name, e.g. h264_nvenc. */
  id: string;
  codec: VideoCodec;
  kind: EncoderKind;
  /** ffmpeg -encoders lists it. */
  listed: boolean;
  /** The 1 s test encode ran (null: not tested). */
  works: boolean | null;
}

export interface EncoderProbe {
  ffmpeg: { path: string; version: string; bundled: boolean } | null;
  encoders: EncoderInfo[];
  /** The encoder used per codec (null: none works). */
  chosen: Record<VideoCodec, string | null>;
  error: string | null;
}

export interface BenchmarkResult {
  encoder: string;
  codec: VideoCodec;
  /** Frames per second encoded (1080×1920 test pattern). */
  fps: number;
  /** × real time at 60 fps. */
  realtime: number;
  ok: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ render queue output */

/** A post-processing pass of a rendered clip through ffmpeg (platform preset, codec, upscale). */
export interface TranscodeSpec {
  codec: VideoCodec;
  width: number;
  height: number;
  fps: number;
  /** kbit/s of the video (target) and its cap. */
  videoKbps: number;
  maxKbps: number;
  audioKbps: number;
  sampleRate: number;
}

export interface SaveRenderRequest {
  /** The queue job it belongs to (progress events and cancel use it). */
  jobId: string;
  /** Folder to save into ("" = the preferred output folder). */
  folder: string;
  /** File name without extension. */
  name: string;
  /** Extension of `data` as the fast export wrote it (mp4 / webm). */
  extension: string;
  data: Uint8Array;
  /** Length of the clip as rendered (s). */
  durationSec: number | null;
  /** ffmpeg pass after saving (null: keep the file as rendered). */
  transcode: TranscodeSpec | null;
  /** What the library shows and re-renders from. */
  meta: LibraryMeta;
}

export interface LibraryMeta {
  title: string;
  mode: string;
  seed: number;
  /** The simulator link that re-renders the clip (settings + seed). */
  link: string;
  platform: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string[];
  queueJobId: string | null;
}

export interface SavedRender {
  path: string;
  bytes: number;
  durationSec: number | null;
  encoder: string | null;
  item: LibraryItem;
}

export interface RenderProgressEvent {
  jobId: string;
  phase: "saving" | "encoding" | "thumbnail";
  progress: number;
}

export interface LibraryItem {
  id: string;
  path: string;
  fileName: string;
  bytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: number;
  /** A data: URL of a small JPEG, null when ffmpeg could not make one. */
  thumbnail: string | null;
  exists: boolean;
  encoder: string | null;
  meta: LibraryMeta;
}

/* ------------------------------------------------------------------ AI */

export type AiProviderKind = "local" | "cloud";
export type CloudProvider = "anthropic" | "openai";

export interface ModelEntry {
  id: string;
  name: string;
  /** Bytes of the GGUF file. */
  size: number;
  /** Hex SHA-256 of the file (null for a file the user picked). */
  sha256: string | null;
  licence: string;
  licenceUrl: string;
  url: string | null;
  state: "missing" | "partial" | "downloading" | "verifying" | "ready" | "corrupt";
  /** Bytes on disk (a partial download resumes from here). */
  downloaded: number;
  path: string | null;
  custom: boolean;
  selected: boolean;
}

export interface ModelProgressEvent {
  id: string;
  downloaded: number;
  size: number;
  bytesPerSec: number;
  state: ModelEntry["state"];
  error?: string;
}

export interface AiStatus {
  provider: AiProviderKind;
  /** A model is ready to answer (the local file present, or a cloud key stored). */
  ready: boolean;
  local: {
    model: string | null;
    loaded: boolean;
    backend: string | null;
    gpuLayers: number | null;
    error: string | null;
    /** --- desktop-ai-fix --- The loaded context's size in tokens and the GPU llama.cpp runs on (null: none / not loaded). */
    contextSize?: number | null;
    gpuDevice?: string | null;
  };
  cloud: { provider: CloudProvider; baseUrl: string; model: string; hasKey: boolean; encryption: boolean };
  /** --- desktop-ai-fix --- The last failed request of each path (kept until the app quits). */
  lastError?: { local: AiLastError | null; cloud: AiLastError | null };
}

/** The cloud providers' defaults (the user can change the endpoint and the model; a local OpenAI-compatible server needs no key). */
export const CLOUD_DEFAULTS: Record<CloudProvider, { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

export interface CloudConfigInput {
  provider: CloudProvider;
  baseUrl: string;
  model: string;
  /** Only sent when the user typed a new key; stored with safeStorage, never returned. */
  apiKey?: string;
  use: boolean;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatRequest {
  requestId: string;
  messages: AiMessage[];
  /** A JSON schema the reply must follow (the local model is constrained to it by a grammar where possible). */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /** --- desktop-ai-fix --- The studio job asking ("videos", "copy", "settings", "ideas"): logged, and kept with a failure. */
  task?: string;
}

export interface AiChatResult {
  text: string;
  provider: AiProviderKind;
  model: string;
  cancelled: boolean;
}

export interface AiTokenEvent {
  requestId: string;
  text: string;
}

/* ------------------------------------------------------------------ AI status / diagnostics (--- desktop-ai-fix ---) */

/** A failed AI request, as the status and the report show it. */
export interface AiLastError {
  /** The message the page saw (with the cause codes explained). */
  message: string;
  /** ISO time. */
  at: string;
  task: string | null;
  /** "local", "anthropic" or "openai". */
  provider: string;
  model: string;
}

export const AI_CHECK_IDS = ["runtime", "model", "provider", "network", "lastError"] as const;
export type AiCheckId = (typeof AI_CHECK_IDS)[number];
/** green / amber / red, or not tested in this run. */
export type AiCheckLevel = "ok" | "warn" | "fail" | "skip";

/** One row of the AI status panel. */
export interface AiCheck {
  id: AiCheckId;
  level: AiCheckLevel;
  /** The reason, as a message key under `DesktopAiFix.check` (the page translates it) with its values. */
  code: string;
  params: Record<string, string | number>;
  /** Technical lines (backend, device, sizes, HTTP status, error codes) – shown under the row, copied into the report. */
  details: string[];
}

export interface AiDiagnoseOptions {
  /** Also start llama.cpp and load the model (an 8-token grammar test), and reach the network and the cloud endpoint. */
  deep?: boolean;
}

export interface AiDiagnosis {
  /** ISO time of the run. */
  at: string;
  deep: boolean;
  checks: AiCheck[];
  /** The copyable report: app / Electron / OS versions, RAM, GPU, backend, model, provider (never the key), the last errors and the log's tail. */
  report: Record<string, unknown>;
}

/* ------------------------------------------------------------------ Postiz (--- social-postiz ---) */

/** The Postiz cloud API; a self-hosted Postiz gives its backend address instead (with or without /public/v1). */
export const POSTIZ_DEFAULT_URL = "https://api.postiz.com";
/** The longest address and key the page may send. */
export const POSTIZ_FIELD_MAX = 500;

/** Whether a Postiz key is stored and where it points – never the key itself. */
export interface PostizKeyStatus {
  configured: boolean;
  baseUrl: string;
  /** This PC can seal a key (safeStorage works); without it no key is kept. */
  encryption: boolean;
}

export interface PostizKeyInput {
  baseUrl: string;
  /** Stored sealed, never returned. */
  apiKey: string;
}

/** The Postiz workspace a key belongs to. */
export interface PostizOrganization {
  id: string;
  name: string;
}

/** A channel connected inside Postiz (TikTok, Instagram, YouTube, …). */
export interface PostizChannel {
  id: string;
  name: string;
  /** Postiz's provider identifier: "tiktok", "instagram", "instagram-standalone", "youtube", "x", "linkedin", … */
  platform: string;
  picture: string | null;
  /** Postiz turned the channel off (an expired login, a plan limit). */
  disabled: boolean;
  /** The customer the channel is filed under in Postiz (agencies), null for the workspace itself. */
  customer: { id: string; name: string } | null;
}

/** One of Postiz's own notices (a login that expired, a post that failed). */
export interface PostizNotice {
  id: string;
  content: string;
  /** ISO time. */
  createdAt: string;
  read: boolean;
}

/** What a saved key answered with. */
export interface PostizConnection {
  organization: PostizOrganization;
  channels: PostizChannel[];
}

/* --- phase 2: posting a Library clip (docs/SOCIAL-AUTOPILOT.md, section 2) --- */

/** The most channels one post may go to, the longest text per channel and the biggest provider settings object (as JSON). */
export const SOCIAL_MAX_CHANNELS = 20;
export const SOCIAL_MAX_TEXT = 5000;
export const SOCIAL_MAX_SETTINGS_JSON = 20_000;
/** How many days of outcomes the Posts tab asks for by default, and the most it may ask for. */
export const SOCIAL_POSTS_DAYS = 14;
export const SOCIAL_POSTS_MAX_DAYS = 90;

/** The clip as Postiz will take it: an MP4 (the WebM fast export transcoded by the bundled ffmpeg), within 1 GB. */
export interface SocialPreparedClip {
  path: string;
  bytes: number;
  type: "video/mp4";
  durationSec: number | null;
  width: number | null;
  height: number | null;
  /** The file is a temporary MP4 made from the clip (removed after the upload), not the Library file itself. */
  transcoded: boolean;
}

/** One channel of a post as the card approved it: the text and the provider's settings (`__type` mandatory). */
export interface SocialPostChannel {
  id: string;
  platform: string;
  text: string;
  settings: { __type: string } & Record<string, unknown>;
}

/** What Approve sends: the clip, the channels with their text and settings, and when ("now", "draft" or a UTC ISO time in the future). */
export interface SocialPostRequest {
  clipId: string;
  channels: SocialPostChannel[];
  when: "now" | "draft" | string;
  /** The video frame (ms) Postiz uses as the thumbnail, when chosen. */
  thumbnailMs?: number;
}

export interface SocialPostResult {
  postIds: { channelId: string; postId: string }[];
  /** Postiz's group of the posts when it said (deleting one removes the group). */
  group: string | null;
}

/** A clip on its way: the bundled ffmpeg's transcode, the upload, the create call, done. */
export interface SocialProgressEvent {
  clipId: string;
  phase: "transcoding" | "uploading" | "creating" | "done";
  /** 0–100. */
  percent: number;
}

export type SocialPostState = "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT";

/** A post as Postiz lists it (one row per channel): how the app learns the outcome. */
export interface SocialPostOutcome {
  id: string;
  channel: { id: string; name: string; platform: string; picture: string | null } | null;
  state: SocialPostState;
  /** ISO time. */
  publishDate: string;
  releaseUrl: string | null;
  error: string | null;
  content: string;
}

/** One line of social-audit.json: every call that created or removed posts, with who approved it. */
export interface SocialAuditEntry {
  /** ISO time. */
  at: string;
  action: "createPosts" | "deletePost";
  channels: string[];
  postIds: string[];
  by: "user";
  clipId: string | null;
  when: string | null;
}

/** Postiz's next free slot for a channel. */
export interface SocialSlot {
  /** ISO time. */
  date: string;
}

/** The provider's rules and settings schema (`GET /integration-settings/:id`), as Postiz sends them. */
export type SocialChannelSettings = Record<string, unknown>;

/** Whether `when` is one of the two words or an ISO time that lies in the future. */
export function isSocialWhen(when: unknown, now: number = Date.now()): when is string {
  if (typeof when !== "string") return false;
  if (when === "now" || when === "draft") return true;
  if (when.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(when)) return false;
  const at = Date.parse(when);
  return Number.isFinite(at) && at > now;
}

/** Validates the card's post request before the main process acts on it (an error message, or null). */
export function checkSocialPostRequest(value: unknown, now: number = Date.now()): string | null {
  const r = value as Partial<SocialPostRequest> | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return "social.post(request)";
  if (typeof r.clipId !== "string" || r.clipId.length === 0 || r.clipId.length >= 512) return "social.post: clipId";
  if (!Array.isArray(r.channels) || r.channels.length === 0 || r.channels.length > SOCIAL_MAX_CHANNELS) return `social.post: channels (1 to ${SOCIAL_MAX_CHANNELS})`;
  const seen = new Set<string>(); // --- review fix (social-postiz) --- one entry per channel (Postiz would create two posts)
  for (const c of r.channels as Partial<SocialPostChannel>[]) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return "social.post: channel";
    if (typeof c.id !== "string" || c.id.length === 0 || c.id.length >= 512) return "social.post: channel id";
    if (seen.has(c.id)) return "social.post: duplicate channel id";
    seen.add(c.id);
    if (typeof c.platform !== "string" || c.platform.length === 0 || c.platform.length > 60) return "social.post: channel platform";
    if (typeof c.text !== "string" || c.text.length > SOCIAL_MAX_TEXT) return `social.post: channel text (at most ${SOCIAL_MAX_TEXT} characters)`;
    const s = c.settings as unknown;
    if (!s || typeof s !== "object" || Array.isArray(s) || Object.getPrototypeOf(s) !== Object.prototype) return "social.post: channel settings must be a plain object";
    if (typeof (s as { __type?: unknown }).__type !== "string") return "social.post: channel settings.__type";
    if (JSON.stringify(s).length > SOCIAL_MAX_SETTINGS_JSON) return "social.post: channel settings too large";
  }
  if (!isSocialWhen(r.when, now)) return 'social.post: when must be "now", "draft" or an ISO time in the future';
  if (r.thumbnailMs !== undefined && (typeof r.thumbnailMs !== "number" || !Number.isInteger(r.thumbnailMs) || r.thumbnailMs < 0)) return "social.post: thumbnailMs";
  return null;
}

/* --- social-autopilot --- phases 3–4: the proposal queue and the autopilot (docs/SOCIAL-AUTOPILOT.md, sections 3–4) --- */

/** How many items the queue keeps, how old a proposal may get before it is dropped, how many proposals one call may add. */
export const SOCIAL_QUEUE_MAX = 200;
export const SOCIAL_PROPOSAL_MAX_AGE_DAYS = 14;
export const SOCIAL_PROPOSALS_PER_CALL = 5;
/** The longest reason a planner may give and the longest log line an item keeps. */
export const SOCIAL_REASON_MAX = 300;
/** TikTok's settings the user must choose every time: never proposed, never accepted from the AI path. */
export const TIKTOK_USER_ONLY_KEYS: readonly string[] = ["privacy_level", "comment", "duet", "stitch"];

export type SocialQueueStatus = "proposed" | "approved" | "skipped" | "posted" | "failed";
export type SocialQueueBy = "ai" | "user";

/** One channel of a queued proposal: the text and whatever settings are known (incomplete: the card completes them). */
export interface SocialQueueChannel {
  integrationId: string;
  platform: string;
  text: string;
  settings: Record<string, unknown>;
}

/** An item of social-queue.json. */
export interface SocialQueueItem {
  id: string;
  clipId: string;
  channels: SocialQueueChannel[];
  /** "now", "draft", a UTC ISO time, or null (the card decides). */
  when: "now" | "draft" | string | null;
  status: SocialQueueStatus;
  /** Who wrote the text as it stands: the planner, or the user after an edit. */
  by: SocialQueueBy;
  /** The planner's one sentence: why this clip, why this time. */
  reason: string;
  /** ISO time. */
  createdAt: string;
  postIds: { channelId: string; postId: string }[];
  error: string | null;
  log: { at: string; text: string }[];
}

/** What `queue.propose` takes (from the planner or the AI panel's "Send to queue"). */
export interface SocialProposalInput {
  clipId: string;
  channels: { integrationId: string; platform: string; text: string; settings?: Record<string, unknown> }[];
  when: "now" | "draft" | string | null;
  reason: string;
}

/** What `queue.edit` changes: the text or settings of some channels, and when. */
export interface SocialQueueEdit {
  channels?: { integrationId: string; text?: string; settings?: Record<string, unknown> }[];
  when?: "now" | "draft" | string | null;
}

export const AUTOPILOT_LANGUAGES = ["en", "pl", "es"] as const;
export type AutopilotLanguage = (typeof AUTOPILOT_LANGUAGES)[number];

/** The autopilot's settings (the config's `autopilot` block). It only proposes, and only while the app is open. */
export interface AutopilotSettings {
  enabled: boolean;
  /** The Postiz channels (integration ids) it may propose for. */
  channels: string[];
  /** 1..5 proposals a day. */
  perDay: number;
  /** "HH:MM" local: no proposed time falls between them. */
  quietFrom: string;
  quietTo: string;
  language: AutopilotLanguage;
  /** At most one planning run every this many hours while the app is open. */
  proposeHours: number;
  /** ISO time of the last planning run (null: never). */
  lastPlannedAt: string | null;
}

/** The TikTok choices the user must make, found in a settings object (empty when none). */
export function tiktokUserOnlyKeysIn(settings: unknown): string[] {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return [];
  return Object.keys(settings as Record<string, unknown>).filter((k) => TIKTOK_USER_ONLY_KEYS.includes(k));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Whether `when` is one of the two words, null, or an ISO time in the future. */
export function isQueueWhen(when: unknown, now: number = Date.now()): boolean {
  return when === null || isSocialWhen(when, now);
}

/** Validates `queue.propose(proposals, by)` (an error message, or null). The AI path never carries TikTok's user-only settings. */
export function checkSocialProposals(value: unknown, by: unknown, now: number = Date.now()): string | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > SOCIAL_PROPOSALS_PER_CALL) return `social.queue.propose: 1 to ${SOCIAL_PROPOSALS_PER_CALL} proposals`;
  if (by !== "ai" && by !== "user") return 'social.queue.propose: by must be "ai" or "user"';
  for (const raw of value) {
    const p = raw as Partial<SocialProposalInput> | null;
    if (!isPlainObject(p)) return "social.queue.propose: proposal";
    if (typeof p.clipId !== "string" || p.clipId.length === 0 || p.clipId.length >= 512) return "social.queue.propose: clipId";
    if (!Array.isArray(p.channels) || p.channels.length === 0 || p.channels.length > SOCIAL_MAX_CHANNELS) return `social.queue.propose: channels (1 to ${SOCIAL_MAX_CHANNELS})`;
    const seen = new Set<string>();
    for (const c of p.channels as Partial<SocialProposalInput["channels"][number]>[]) {
      if (!isPlainObject(c)) return "social.queue.propose: channel";
      if (typeof c.integrationId !== "string" || c.integrationId.length === 0 || c.integrationId.length >= 512) return "social.queue.propose: channel integrationId";
      if (seen.has(c.integrationId)) return "social.queue.propose: duplicate channel";
      seen.add(c.integrationId);
      if (typeof c.platform !== "string" || c.platform.length === 0 || c.platform.length > 60) return "social.queue.propose: channel platform";
      if (typeof c.text !== "string" || c.text.length > SOCIAL_MAX_TEXT) return `social.queue.propose: channel text (at most ${SOCIAL_MAX_TEXT} characters)`;
      if (c.settings !== undefined) {
        if (!isPlainObject(c.settings) || JSON.stringify(c.settings).length > SOCIAL_MAX_SETTINGS_JSON) return "social.queue.propose: channel settings";
        const forbidden = tiktokUserOnlyKeysIn(c.settings);
        if (forbidden.length) return `social.queue.propose: TikTok's ${forbidden.join(", ")} are chosen by the user on the card, never proposed`;
      }
    }
    if (!isQueueWhen(p.when, now)) return 'social.queue.propose: when must be "now", "draft", null or an ISO time in the future';
    if (typeof p.reason !== "string" || p.reason.length > SOCIAL_REASON_MAX) return `social.queue.propose: reason (at most ${SOCIAL_REASON_MAX} characters)`;
  }
  return null;
}

/** Validates `queue.edit(id, patch)` (an error message, or null). */
export function checkSocialQueueEdit(value: unknown, now: number = Date.now()): string | null {
  const e = value as Partial<SocialQueueEdit> | null;
  if (!isPlainObject(e)) return "social.queue.edit(id, patch)";
  if (e.when !== undefined && !isQueueWhen(e.when, now)) return 'social.queue.edit: when must be "now", "draft", null or an ISO time in the future';
  if (e.channels !== undefined) {
    if (!Array.isArray(e.channels) || e.channels.length > SOCIAL_MAX_CHANNELS) return "social.queue.edit: channels";
    for (const c of e.channels as Partial<NonNullable<SocialQueueEdit["channels"]>[number]>[]) {
      if (!isPlainObject(c) || typeof c.integrationId !== "string" || c.integrationId.length === 0 || c.integrationId.length >= 512) return "social.queue.edit: channel integrationId";
      if (c.text !== undefined && (typeof c.text !== "string" || c.text.length > SOCIAL_MAX_TEXT)) return `social.queue.edit: channel text (at most ${SOCIAL_MAX_TEXT} characters)`;
      if (c.settings !== undefined) {
        if (!isPlainObject(c.settings) || JSON.stringify(c.settings).length > SOCIAL_MAX_SETTINGS_JSON) return "social.queue.edit: channel settings";
        const forbidden = tiktokUserOnlyKeysIn(c.settings);
        if (forbidden.length) return `social.queue.edit: TikTok's ${forbidden.join(", ")} are chosen on the card`;
      }
    }
  }
  for (const key of Object.keys(e)) if (key !== "channels" && key !== "when") return `social.queue.edit: unknown field "${key}"`;
  return null;
}

/* ------------------------------------------------------------------ updates */

export interface UpdateStatus {
  state: "idle" | "disabled" | "checking" | "available" | "none" | "downloading" | "ready" | "error";
  version: string | null;
  progress: number | null;
  message: string | null;
}

/* ------------------------------------------------------------------ the bridge */

export interface DesktopEventMap {
  menu: MenuAction;
  openFile: PickedFile;
  aiToken: AiTokenEvent;
  modelProgress: ModelProgressEvent;
  renderProgress: RenderProgressEvent;
  update: UpdateStatus;
  socialProgress: SocialProgressEvent; // --- social-postiz ---
  socialQueue: SocialQueueItem[]; // --- social-autopilot ---
}
export type DesktopEventName = keyof DesktopEventMap;

/** What `window.desktop` offers the page (desktop/src/preload.ts implements it). */
export interface DesktopApi {
  apiVersion: number;
  info(): Promise<DesktopInfo>;
  log(level: LogLevel, message: string): void;
  openLogs(): Promise<void>;
  prefs: {
    get(): Promise<DesktopPrefs>;
    set(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs>;
  };
  gpu: {
    status(): Promise<GpuStatus>;
    probeEncoders(force?: boolean): Promise<EncoderProbe>;
    benchmark(): Promise<BenchmarkResult[]>;
  };
  dialogs: {
    pickFolder(): Promise<string | null>;
    pickMedia(kind: MediaKind): Promise<PickedFile | null>;
  };
  render: {
    save(request: SaveRenderRequest): Promise<SavedRender>;
    cancel(jobId: string): Promise<void>;
  };
  journal: {
    load(): Promise<unknown>;
    save(journal: unknown): Promise<void>;
  };
  /** --- custom-content --- The player's own fighters and modes, as one document (src/lib/desktop/custom.ts); null until something is saved. */
  custom: {
    load(): Promise<unknown>;
    save(content: unknown): Promise<void>;
  };
  library: {
    list(): Promise<LibraryItem[]>;
    remove(id: string, deleteFile: boolean): Promise<LibraryItem[]>;
    reveal(id: string): Promise<void>;
    open(id: string): Promise<void>;
    openFolder(): Promise<void>;
    /** The clip's bytes (≤ 1 GB) for a publish target. */
    read(id: string): Promise<PickedFile>;
  };
  ai: {
    status(): Promise<AiStatus>;
    models(): Promise<ModelEntry[]>;
    downloadModel(id: string): Promise<ModelEntry[]>;
    cancelDownload(id: string): Promise<void>;
    importModel(): Promise<ModelEntry[]>;
    selectModel(id: string): Promise<AiStatus>;
    removeModel(id: string): Promise<ModelEntry[]>;
    chat(request: AiChatRequest): Promise<AiChatResult>;
    cancel(requestId: string): Promise<void>;
    setCloud(config: CloudConfigInput): Promise<AiStatus>;
    clearCloudKey(): Promise<AiStatus>;
    playbook(): Promise<string>;
    /** --- desktop-ai-fix --- The AI status panel's checks (and its copyable report). */
    diagnose(options?: AiDiagnoseOptions): Promise<AiDiagnosis>;
  };
  update: {
    check(): Promise<UpdateStatus>;
    install(): Promise<void>;
    /** --- low-findings-2 --- The updater's status as it is, without a check (the page's mount: the quiet schedule does the checking). */
    status(): Promise<UpdateStatus>;
  };
  /** --- social-postiz --- The Accounts tab: the Postiz key (stored sealed on this PC), the channels connected in Postiz and its notices. */
  social: {
    key: {
      status(): Promise<PostizKeyStatus>;
      /** Checks the key with Postiz and keeps it; a refused key throws and the previous key stays. */
      set(input: PostizKeyInput): Promise<PostizConnection>;
      forget(): Promise<PostizKeyStatus>;
    };
    channels: {
      /** Cached for a minute; `refresh` asks Postiz again. Empty without a key. */
      list(refresh?: boolean): Promise<PostizChannel[]>;
    };
    notices: {
      list(page?: number): Promise<PostizNotice[]>;
    };
    /** Phase 2: the clip as Postiz will take it (an MP4 within 1 GB; a WebM is transcoded first). */
    prepare(clipId: string): Promise<SocialPreparedClip>;
    /** Approve on the card: one upload, then one create call with every channel. Nothing reaches Postiz any other way. */
    post(request: SocialPostRequest): Promise<SocialPostResult>;
    /** The posts of the last `days` (and the next: scheduled ones too) with their state, link or error. */
    posts(days?: number): Promise<SocialPostOutcome[]>;
    /** Removes a post – and with it every channel of its group (the page confirms first). */
    postDelete(postId: string): Promise<void>;
    audit(limit?: number): Promise<SocialAuditEntry[]>;
    /** The provider's rules and settings schema for a channel (the generic settings form). */
    channelSettings(channelId: string): Promise<SocialChannelSettings>;
    /** Postiz's next free slot for a channel ("Next free slot" on the card). */
    slot(channelId: string): Promise<SocialSlot>;
    /** --- social-autopilot --- The proposal queue (social-queue.json). A proposal never reaches Postiz: `approve` runs the card's request. */
    queue: {
      list(): Promise<SocialQueueItem[]>;
      /** Adds proposals (at most 5 a call); a proposal for a clip and channel already proposed is merged into that item. */
      propose(proposals: SocialProposalInput[], by: SocialQueueBy): Promise<SocialQueueItem[]>;
      /** The card's Approve for a queued item: runs the post with the request the card produced, marks the item posted or failed. */
      approve(id: string, request: SocialPostRequest): Promise<SocialPostResult>;
      edit(id: string, patch: SocialQueueEdit): Promise<SocialQueueItem[]>;
      skip(id: string): Promise<SocialQueueItem[]>;
      remove(id: string): Promise<SocialQueueItem[]>;
    };
    /** --- social-autopilot --- The autopilot's settings (it only proposes, never posts). */
    autopilot: {
      get(): Promise<AutopilotSettings>;
      set(patch: Partial<AutopilotSettings>): Promise<AutopilotSettings>;
    };
  };
  /** Subscribes to an event from the main process; returns the unsubscribe. */
  on<K extends DesktopEventName>(event: K, listener: (payload: DesktopEventMap[K]) => void): () => void;
}

/** Event name → IPC channel. */
export const EVENT_CHANNELS: Record<DesktopEventName, DesktopEventChannel> = {
  menu: DESKTOP_EVENTS.menu,
  openFile: DESKTOP_EVENTS.openFile,
  aiToken: DESKTOP_EVENTS.aiToken,
  modelProgress: DESKTOP_EVENTS.modelProgress,
  renderProgress: DESKTOP_EVENTS.renderProgress,
  update: DESKTOP_EVENTS.update,
  socialProgress: DESKTOP_EVENTS.socialProgress, // --- social-postiz ---
  socialQueue: DESKTOP_EVENTS.socialQueue, // --- social-autopilot ---
};

/**
 * Which channel each bridge method uses – the preload builds `window.desktop` from this table, the main process registers a
 * handler for every channel in it and the tests check both against each other.
 */
export const BRIDGE_METHODS = {
  info: IPC.info,
  openLogs: IPC.openLogs,
  "prefs.get": IPC.prefsGet,
  "prefs.set": IPC.prefsSet,
  "gpu.status": IPC.gpuStatus,
  "gpu.probeEncoders": IPC.gpuProbe,
  "gpu.benchmark": IPC.gpuBenchmark,
  "dialogs.pickFolder": IPC.pickFolder,
  "dialogs.pickMedia": IPC.pickMedia,
  "render.save": IPC.renderSave,
  "render.cancel": IPC.renderCancel,
  "journal.load": IPC.journalLoad,
  "journal.save": IPC.journalSave,
  "custom.load": IPC.customLoad,
  "custom.save": IPC.customSave,
  "library.list": IPC.libraryList,
  "library.remove": IPC.libraryRemove,
  "library.reveal": IPC.libraryReveal,
  "library.open": IPC.libraryOpen,
  "library.openFolder": IPC.libraryOpenFolder,
  "library.read": IPC.libraryRead,
  "ai.status": IPC.aiStatus,
  "ai.models": IPC.aiModels,
  "ai.downloadModel": IPC.aiModelDownload,
  "ai.cancelDownload": IPC.aiModelCancel,
  "ai.importModel": IPC.aiModelImport,
  "ai.selectModel": IPC.aiModelSelect,
  "ai.removeModel": IPC.aiModelRemove,
  "ai.chat": IPC.aiChat,
  "ai.cancel": IPC.aiCancel,
  "ai.setCloud": IPC.aiSetCloud,
  "ai.clearCloudKey": IPC.aiClearCloudKey,
  "ai.playbook": IPC.aiPlaybook,
  "update.check": IPC.updateCheck,
  "update.install": IPC.updateInstall,
  "update.status": IPC.updateState, // --- low-findings-2 ---
  "ai.diagnose": IPC.aiDiagnose, // --- desktop-ai-fix ---
  // --- social-postiz ---
  "social.key.status": IPC.socialKeyStatus,
  "social.key.set": IPC.socialKeySet,
  "social.key.forget": IPC.socialKeyForget,
  "social.channels.list": IPC.socialChannels,
  "social.notices.list": IPC.socialNotices,
  "social.prepare": IPC.socialPrepare,
  "social.post": IPC.socialPost,
  "social.posts": IPC.socialPosts,
  "social.postDelete": IPC.socialPostDelete,
  "social.audit": IPC.socialAudit,
  "social.channelSettings": IPC.socialChannelSettings,
  "social.slot": IPC.socialSlot,
  // --- social-autopilot ---
  "social.queue.list": IPC.socialQueueList,
  "social.queue.propose": IPC.socialQueuePropose,
  "social.queue.approve": IPC.socialQueueApprove,
  "social.queue.edit": IPC.socialQueueEdit,
  "social.queue.skip": IPC.socialQueueSkip,
  "social.queue.remove": IPC.socialQueueRemove,
  "social.autopilot.get": IPC.socialAutopilotGet,
  "social.autopilot.set": IPC.socialAutopilotSet,
} as const satisfies Record<string, IpcChannel>;

/** `log` is fire-and-forget (`ipcRenderer.send`); every other channel is a request. */
export const SEND_CHANNELS: readonly IpcChannel[] = [IPC.log];

/* ------------------------------------------------------------------ argument checks (main process) */

const isString = (v: unknown): v is string => typeof v === "string";

/** Validates what the page sends before the main process acts on it; returns an error message or null. */
export function checkIpcArgs(channel: IpcChannel, args: readonly unknown[]): string | null {
  const [a, b] = args;
  switch (channel) {
    case IPC.log:
      return ["info", "warn", "error"].includes(a as string) && isString(b) ? null : "log(level, message)";
    case IPC.prefsSet:
      return a && typeof a === "object" && !Array.isArray(a) ? null : "prefs.set(patch)";
    case IPC.gpuProbe:
      return a === undefined || typeof a === "boolean" ? null : "gpu.probeEncoders(force?)";
    case IPC.pickMedia:
      return (MEDIA_KINDS as readonly string[]).includes(a as string) ? null : "dialogs.pickMedia(kind)";
    case IPC.renderSave: {
      const r = a as Partial<SaveRenderRequest> | null;
      if (!r || typeof r !== "object") return "render.save(request)";
      if (!isString(r.jobId) || !isString(r.name) || !isString(r.folder) || !isString(r.extension)) return "render.save: jobId, name, folder, extension";
      const data: unknown = r.data;
      if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) return "render.save: data must be bytes";
      if (!/^[a-z0-9]{2,5}$/.test(r.extension)) return "render.save: bad extension";
      if (!r.meta || typeof r.meta !== "object") return "render.save: meta";
      return null;
    }
    case IPC.renderCancel:
    case IPC.libraryReveal:
    case IPC.libraryOpen:
    case IPC.libraryRead:
    case IPC.aiModelDownload:
    case IPC.aiModelCancel:
    case IPC.aiModelSelect:
    case IPC.aiModelRemove:
    case IPC.aiCancel:
    case IPC.socialPrepare: // --- social-postiz --- a Library item's id, a Postiz post's or channel's id
    case IPC.socialPostDelete:
    case IPC.socialChannelSettings:
    case IPC.socialSlot:
    case IPC.socialQueueSkip: // --- social-autopilot --- a queue item's id
    case IPC.socialQueueRemove:
      return isString(a) && a.length > 0 && a.length < 512 ? null : `${channel}(id)`;
    case IPC.libraryRemove:
      return isString(a) && typeof b === "boolean" ? null : "library.remove(id, deleteFile)";
    case IPC.journalSave:
      return a !== undefined ? null : "journal.save(journal)";
    case IPC.customSave:
      // an object of at most ~1 MB once written (24 fighters and 24 modes are a few dozen kB)
      return a && typeof a === "object" && !Array.isArray(a) && JSON.stringify(a).length <= 1_000_000 ? null : "custom.save(content)";
    case IPC.aiChat: {
      const r = a as Partial<AiChatRequest> | null;
      if (!r || typeof r !== "object" || !isString(r.requestId) || !Array.isArray(r.messages) || r.messages.length === 0) return "ai.chat(request)";
      const ok = r.messages.every((m) => m && ["system", "user", "assistant"].includes(m.role) && isString(m.content));
      if (r.task !== undefined && (!isString(r.task) || r.task.length > 40)) return "ai.chat: task"; // --- desktop-ai-fix ---
      return ok ? null : "ai.chat: messages";
    }
    // --- desktop-ai-fix --- the diagnostics' options: nothing, or { deep: boolean }
    case IPC.aiDiagnose: {
      if (a === undefined) return null;
      const o = a as Partial<AiDiagnoseOptions> | null;
      return o && typeof o === "object" && !Array.isArray(o) && (o.deep === undefined || typeof o.deep === "boolean") ? null : "ai.diagnose(options?)";
    }
    case IPC.aiSetCloud: {
      const c = a as Partial<CloudConfigInput> | null;
      if (!c || typeof c !== "object") return "ai.setCloud(config)";
      if (c.provider !== "anthropic" && c.provider !== "openai") return "ai.setCloud: provider";
      if (!isString(c.baseUrl) || (!/^https:\/\//.test(c.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(c.baseUrl))) return "ai.setCloud: baseUrl must be https (or http on localhost)";
      if (!isString(c.model) || c.model.length === 0) return "ai.setCloud: model";
      if (c.apiKey !== undefined && !isString(c.apiKey)) return "ai.setCloud: apiKey";
      return null;
    }
    // --- social-postiz --- the Postiz key (both fields bounded; the main process checks the address's scheme), the channel
    // list's refresh flag and the notices' page
    case IPC.socialKeySet: {
      const k = a as Partial<PostizKeyInput> | null;
      if (!k || typeof k !== "object" || Array.isArray(k)) return "social.key.set(input)";
      if (!isString(k.baseUrl) || k.baseUrl.length > POSTIZ_FIELD_MAX) return "social.key.set: baseUrl";
      if (!isString(k.apiKey) || k.apiKey.length === 0 || k.apiKey.length > POSTIZ_FIELD_MAX) return "social.key.set: apiKey";
      return null;
    }
    case IPC.socialChannels:
      return a === undefined || typeof a === "boolean" ? null : "social.channels.list(refresh?)";
    case IPC.socialNotices:
      return a === undefined || (typeof a === "number" && Number.isInteger(a) && a >= 0) ? null : "social.notices.list(page?)";
    // --- social-postiz --- phase 2: the card's post request (every channel bounded, `when` in the future), the outcome window
    // in days and the audit's limit
    case IPC.socialPost:
      return checkSocialPostRequest(a);
    case IPC.socialPosts:
      return a === undefined || (typeof a === "number" && Number.isInteger(a) && a >= 1 && a <= SOCIAL_POSTS_MAX_DAYS) ? null : `social.posts(days? 1 to ${SOCIAL_POSTS_MAX_DAYS})`;
    case IPC.socialAudit:
      return a === undefined || (typeof a === "number" && Number.isInteger(a) && a >= 1 && a <= 1000) ? null : "social.audit(limit? 1 to 1000)";
    // --- social-autopilot --- the proposals (bounded like the post request, at most 5 a call, no TikTok user-only settings), an
    // approve with the card's request, an edit, and the autopilot's patch (sanitised field by field in the main process)
    case IPC.socialQueuePropose:
      return checkSocialProposals(a, b);
    case IPC.socialQueueApprove:
      if (!isString(a) || a.length === 0 || a.length >= 512) return "social.queue.approve(id, request)";
      return checkSocialPostRequest(b);
    case IPC.socialQueueEdit:
      if (!isString(a) || a.length === 0 || a.length >= 512) return "social.queue.edit(id, patch)";
      return checkSocialQueueEdit(b);
    case IPC.socialAutopilotSet:
      return a && typeof a === "object" && !Array.isArray(a) && JSON.stringify(a).length <= 20_000 ? null : "social.autopilot.set(patch)";
    default:
      return null;
  }
}
