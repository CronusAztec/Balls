/**
 * --- project-files --- Project files: `<name>.jumpingballslive.json`.
 *
 * A project holds everything needed to pick a clip up again on another computer: the whole settings object (with its
 * obstacle layout, keyframes, captions, team roster, arena and mode settings – they all live in `SimulatorSettings`),
 * the page state that is not a setting (the ball emoji, the built-in melody) and the media uploaded in this session,
 * base64-encoded: the ball image, the hit sample, the wall-break sound, the song slicer's song, the music bed, a
 * custom MIDI melody, the Picture Paint picture and the background picture.
 *
 *   { "format": "jumpingballslive-project", "version": 1, "name": "…", "app": "JumpingBallsLive", "createdAt": "…",
 *     "settings": { … }, "extras": { "ballEmoji": null, "melody": "fur-elise" },
 *     "assets": { "musicBed": { "name": "bed.mp3", "type": "audio/mpeg", "size": 123456, "data": "<base64>" } } }
 *
 * `parseProject()` validates a file the way presets and links are validated – unknown settings are dropped, values of
 * the wrong type fall back to the defaults, numbers are clamped to their slider ranges, every other check is
 * `presetToSettings()`'s – and refuses files of a newer format version. Older versions go through `MIGRATIONS`.
 * Media above 25 MB in total gets a warning before the export; above 100 MB a project is refused.
 * Pure (no DOM), so it is unit-tested; components/simulator/useProjectFiles.ts does the downloads and uploads.
 */
import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import { SONGS, WALL_BREAK_SOUNDS, normalizeWallBreakSound } from "@/lib/audio/songs";
import { CUSTOM_HIT_SAMPLE_ID } from "@/lib/audio/sampler";
import { RANGES, defaultSettings, presetToSettings, type SimulatorSettings } from "@/lib/settings";
import { SITE_NAME, SITE_SLUG } from "@/lib/site";
import { themeById } from "@/lib/themes";
import { isModeId } from "@/lib/physics/types";

export const PROJECT_FORMAT = "jumpingballslive-project";
/** Format ids written before the rename to JumpingBallsLive; still opened. */
export const LEGACY_PROJECT_FORMATS: readonly string[] = ["viralballs-project"];
/** Current format version; bump it (and add a step to MIGRATIONS) when the file layout changes. */
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".jumpingballslive.json";
/** Media above this total (bytes) get a warning before the export. */
export const PROJECT_WARN_BYTES = 25 * 1024 * 1024;
/** Media above this total (bytes) are refused, on export and on import. */
export const PROJECT_MAX_BYTES = 100 * 1024 * 1024;
/** Largest project file an import reads: base64 grows the media by a third, the settings add a little. */
export const PROJECT_MAX_FILE_BYTES = Math.ceil((PROJECT_MAX_BYTES * 4) / 3) + 4 * 1024 * 1024;
/** Longest project name (it becomes the file name). */
export const PROJECT_NAME_MAX = 60;
/** Longest text setting kept from a file (the panel's text fields are far shorter). */
const MAX_TEXT_SETTING = 500;

export const PROJECT_ASSET_KINDS = ["ballImage", "hitSample", "wallBreakSound", "sliceSong", "musicBed", "midi", "paintPicture", "backgroundImage", "beatMedia"] as const; // --- video-beats --- (beatMedia: the imported video / audio)
export type ProjectAssetKind = (typeof PROJECT_ASSET_KINDS)[number];
/** The media that are pictures (restored as data: URLs, so their type must be an image type). */
export const IMAGE_ASSET_KINDS: readonly ProjectAssetKind[] = ["ballImage", "paintPicture", "backgroundImage"];

export function isProjectAssetKind(value: unknown): value is ProjectAssetKind {
  return typeof value === "string" && (PROJECT_ASSET_KINDS as readonly string[]).includes(value);
}

/** A medium in memory: its bytes plus the file name and MIME type it had. */
export interface ProjectAsset {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** A medium as the file stores it. */
export interface ProjectAssetRecord {
  name: string;
  type: string;
  /** Byte length of the decoded data (checked on import). */
  size: number;
  /** Standard base64. */
  data: string;
}

/** Page state that is not a setting but belongs to the project. */
export interface ProjectExtras {
  /** The emoji drawn as the ball, or null. */
  ballEmoji: string | null;
  /** Id of the built-in melody the bounces play (lib/audio/songs.ts), or null; a custom MIDI travels as the `midi` asset. */
  melody: string | null;
}

export const DEFAULT_PROJECT_EXTRAS: ProjectExtras = { ballEmoji: null, melody: null };

export type ProjectAssets = Partial<Record<ProjectAssetKind, ProjectAsset>>;

/** The file's JSON. */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  app: string;
  createdAt: string;
  settings: SimulatorSettings;
  extras: ProjectExtras;
  assets: Partial<Record<ProjectAssetKind, ProjectAssetRecord>>;
}

/** A validated project, ready to load. */
export interface LoadedProject {
  name: string;
  version: number;
  createdAt: string | null;
  settings: SimulatorSettings;
  extras: ProjectExtras;
  assets: ProjectAssets;
  /** Media of a known kind the file held but that failed validation (bad base64, wrong type, size mismatch): left out. */
  skipped: ProjectAssetKind[];
}

export type ProjectError = "not-json" | "not-project" | "newer-version" | "too-large";
export type ProjectParseResult = { ok: true; project: LoadedProject } | { ok: false; error: ProjectError };

/* ------------------------------------------------------------------ names and sizes */

/** A project name that is safe as a file name: no path or reserved characters, no control characters, trimmed, at most 60 characters. */
export function sanitizeProjectName(name: unknown): string {
  if (typeof name !== "string") return "";
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return Array.from(cleaned).slice(0, PROJECT_NAME_MAX).join("").trim();
}

/** `<name>.jumpingballslive.json` (the name sanitised; `<SITE_SLUG>-project` without one). */
export function projectFileName(name: string): string {
  return `${sanitizeProjectName(name) || `${SITE_SLUG}-project`}${PROJECT_EXTENSION}`;
}

/** The project name a file name suggests: "My clip.jumpingballslive.json" → "My clip". */
export function projectNameFromFileName(fileName: string): string {
  return sanitizeProjectName(fileName.replace(/\.(jumpingballslive|viralballs)\.json$/i, "").replace(/\.json$/i, ""));
}

/** True for a file the importer should read (`.jumpingballslive.json`, any `.json`, or a JSON MIME type). */
export function looksLikeProjectFile(file: { name: string; type?: string }): boolean {
  return /\.json$/i.test(file.name) || file.type === "application/json";
}

/** "812 B", "12 KB", "3.1 MB". */
export function formatBytes(bytes: number): string {
  if (!(bytes >= 1024)) return `${Math.max(0, Math.round(bytes || 0))} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Total byte length of a set of media. */
export function assetTotalBytes(assets: ProjectAssets): number {
  let total = 0;
  for (const asset of Object.values(assets)) if (asset) total += asset.bytes.byteLength;
  return total;
}

/** What an export of media of this total size needs: nothing, a warning (above 25 MB) or a refusal (above 100 MB). */
export function projectSizeCheck(totalBytes: number): "ok" | "warn" | "too-large" {
  if (totalBytes > PROJECT_MAX_BYTES) return "too-large";
  if (totalBytes > PROJECT_WARN_BYTES) return "warn";
  return "ok";
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "audio/midi": "mid",
  "audio/mid": "mid",
};

/** A file name for a medium that has none (the ball image is kept as a bare data: URL): "ball-image.png". */
export function defaultAssetName(kind: ProjectAssetKind, type: string): string {
  const base = kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const ext = EXTENSIONS[type] ?? (type.startsWith("image/") ? "img" : kind === "midi" ? "mid" : "bin");
  return `${base}.${ext}`;
}

/* ------------------------------------------------------------------ data: URLs */

/** Byte length of a data: URL's payload without decoding it (for the panel's size list). */
export function dataUrlByteLength(url: string): number {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return 0;
  const body = url.slice(comma + 1);
  if (!/;base64$/i.test(url.slice(0, comma))) return body.length;
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/** A medium from a data: URL (base64 or percent-encoded), or null when it is not one. */
export function dataUrlToAsset(name: string, url: string): ProjectAsset | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const isBase64 = /;base64$/i.test(meta);
  const type = (meta.replace(/;base64$/i, "").split(";")[0] || "").trim().toLowerCase();
  let bytes: Uint8Array | null;
  if (isBase64) bytes = base64ToBytes(body.replace(/\s+/g, ""));
  else {
    try {
      bytes = new TextEncoder().encode(decodeURIComponent(body));
    } catch {
      bytes = null;
    }
  }
  return bytes ? { name, type, bytes } : null;
}

/** The data: URL of a medium (pictures are restored this way). */
export function assetToDataUrl(asset: ProjectAsset): string {
  return `data:${asset.type || "application/octet-stream"};base64,${bytesToBase64(asset.bytes)}`;
}

/* ------------------------------------------------------------------ export */

/**
 * The file's JSON for a project. Settings are copied whole; an uploaded wall-break sound's blob: URL only lives in this
 * tab, so it is stored as "none" and the `wallBreakSound` medium (when present) selects the upload again on import.
 */
export function buildProject(input: { name: string; settings: SimulatorSettings; extras?: Partial<ProjectExtras>; assets?: ProjectAssets; createdAt?: string }): ProjectFile {
  const settings: SimulatorSettings = JSON.parse(JSON.stringify(input.settings));
  settings.wallBreakSound = normalizeWallBreakSound(settings.wallBreakSound);
  const assets: Partial<Record<ProjectAssetKind, ProjectAssetRecord>> = {};
  for (const kind of PROJECT_ASSET_KINDS) {
    const asset = input.assets?.[kind];
    if (!asset) continue;
    assets[kind] = { name: asset.name || defaultAssetName(kind, asset.type), type: asset.type, size: asset.bytes.byteLength, data: bytesToBase64(asset.bytes) };
  }
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: sanitizeProjectName(input.name),
    app: SITE_NAME,
    createdAt: input.createdAt ?? new Date().toISOString(),
    settings,
    extras: resolveExtras(input.extras),
    assets,
  };
}

/** The file's text: settings indented for people reading it, each medium's base64 on one line. */
export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}

/* ------------------------------------------------------------------ import */

/** Steps that lift a file of version N to version N + 1 (none yet: version 1 is the first). */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** Lifts a file to the current version; null for a file of a newer (unknown) version. */
export function migrateProject(raw: Record<string, unknown>): Record<string, unknown> | null {
  let version = Number(raw.version);
  if (version > PROJECT_VERSION) return null;
  let out = raw;
  while (version < PROJECT_VERSION) {
    const step = MIGRATIONS[version];
    out = step ? step(out) : out;
    version += 1;
  }
  return { ...out, version: PROJECT_VERSION };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The settings of a file, validated like a preset: only known fields of the right type are kept (the rest falls back
 * to the mode's defaults), numbers are finite and clamped to their slider ranges, then `presetToSettings()` checks the
 * enumerations, lists and feature settings. A custom hit sample stays selected only when its medium came along; a
 * picture background without its picture falls back to the picked theme's background, and the wall-break sound is one
 * of the built-in clips or none.
 */
export function resolveProjectSettings(raw: unknown, assets: ProjectAssets = {}): SimulatorSettings {
  const source = isPlainObject(raw) ? raw : {};
  const mode = isModeId(source.mode) ? source.mode : "classic";
  const defaults = defaultSettings(mode) as unknown as Record<string, unknown>;
  const ranges = RANGES as unknown as Record<string, { min: number; max: number } | undefined>;
  const clean: Record<string, unknown> = { mode };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === "mode" || !Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (key === "wallBreakSound") {
      // Only the built-in clips: a file must not make the page fetch some other address.
      const url = typeof value === "string" ? normalizeWallBreakSound(value) : null;
      clean[key] = url && WALL_BREAK_SOUNDS.some((snd) => snd.url === url) ? url : null;
    } else if (Array.isArray(fallback)) {
      if (Array.isArray(value)) clean[key] = value;
    } else if (typeof fallback === "number") {
      if (typeof value === "number" && Number.isFinite(value)) {
        const range = ranges[key];
        clean[key] = range ? Math.max(range.min, Math.min(range.max, value)) : value;
      }
    } else if (typeof fallback === "string") {
      if (typeof value === "string") clean[key] = value.slice(0, MAX_TEXT_SETTING);
    } else if (typeof value === typeof fallback) clean[key] = value;
  }
  const settings = presetToSettings(clean as Partial<SimulatorSettings>);
  if (clean.hitSampleId === CUSTOM_HIT_SAMPLE_ID && assets.hitSample) settings.hitSampleId = CUSTOM_HIT_SAMPLE_ID;
  if (settings.backgroundType === "image" && !assets.backgroundImage) settings.backgroundType = themeById(settings.themeId)?.background.type ?? "solid";
  return settings;
}

/** The extras of a file: an emoji of at most a few characters, a melody id the site knows. */
export function resolveExtras(raw: unknown): ProjectExtras {
  const source = isPlainObject(raw) ? raw : {};
  const emoji = typeof source.ballEmoji === "string" ? source.ballEmoji.trim() : "";
  const melody = typeof source.melody === "string" && SONGS.some((song) => song.id === source.melody) ? source.melody : null;
  return { ballEmoji: emoji && Array.from(emoji).length <= 8 ? emoji : null, melody };
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** One stored medium, validated: base64 that decodes to the stated size, a sane MIME type (an image type for pictures). */
export function resolveAssetRecord(kind: ProjectAssetKind, raw: unknown): ProjectAsset | null {
  if (!isPlainObject(raw) || typeof raw.data !== "string") return null;
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
  if (type && !MIME_RE.test(type)) return null;
  if (IMAGE_ASSET_KINDS.includes(kind) && !type.startsWith("image/")) return null;
  const bytes = base64ToBytes(raw.data);
  if (!bytes || bytes.byteLength === 0) return null;
  if (raw.size !== undefined && raw.size !== bytes.byteLength) return null;
  const baseName = typeof raw.name === "string" ? raw.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) : "";
  return { name: baseName || defaultAssetName(kind, type), type, bytes };
}

/** Reads and validates a project file's text. */
export function parseProject(text: string): ProjectParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  if (!isPlainObject(raw) || (raw.format !== PROJECT_FORMAT && !LEGACY_PROJECT_FORMATS.includes(raw.format as string)) || !Number.isInteger(raw.version) || (raw.version as number) < 1 || !isPlainObject(raw.settings)) return { ok: false, error: "not-project" };
  const migrated = migrateProject(raw);
  if (!migrated) return { ok: false, error: "newer-version" };
  const assets: ProjectAssets = {};
  const skipped: ProjectAssetKind[] = [];
  let total = 0;
  if (isPlainObject(migrated.assets)) {
    for (const [kind, record] of Object.entries(migrated.assets)) {
      if (!isProjectAssetKind(kind)) continue; // a medium of a later version: ignored
      const asset = resolveAssetRecord(kind, record);
      if (!asset) {
        skipped.push(kind);
        continue;
      }
      total += asset.bytes.byteLength;
      if (total > PROJECT_MAX_BYTES) return { ok: false, error: "too-large" };
      assets[kind] = asset;
    }
  }
  return {
    ok: true,
    project: {
      name: sanitizeProjectName(migrated.name),
      version: PROJECT_VERSION,
      createdAt: typeof migrated.createdAt === "string" ? migrated.createdAt : null,
      settings: resolveProjectSettings(migrated.settings, assets),
      extras: resolveExtras(migrated.extras),
      assets,
      skipped,
    },
  };
}

/**
 * Loading a medium switches its feature on (a hit sample selects "sample", a song turns the slicer on, a picture makes
 * the background a picture): this patch, applied after the media are loaded, puts the project's own choices back.
 * The wall-break sound is left alone when the project brought its upload (loading it selected it).
 */
export function projectMediaPatch(project: Pick<LoadedProject, "settings" | "assets">): Partial<SimulatorSettings> {
  const s = project.settings;
  const patch: Partial<SimulatorSettings> = { hitSoundMode: s.hitSoundMode, hitSampleId: s.hitSampleId, sliceSong: s.sliceSong, backgroundType: s.backgroundType };
  if (!project.assets.wallBreakSound) patch.wallBreakSound = s.wallBreakSound;
  return patch;
}
