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
  aiDiagnose: "ai:diagnose", // --- desktop-ai-fix --- the AI status / diagnostics panel
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
  "ai.diagnose": IPC.aiDiagnose, // --- desktop-ai-fix ---
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
      return isString(a) && a.length > 0 && a.length < 512 ? null : `${channel}(id)`;
    case IPC.libraryRemove:
      return isString(a) && typeof b === "boolean" ? null : "library.remove(id, deleteFile)";
    case IPC.journalSave:
      return a !== undefined ? null : "journal.save(journal)";
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
    default:
      return null;
  }
}
