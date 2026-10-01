import path from "path";
import type { MediaKind, PickedFile } from "@/lib/desktop/contract";
import { MEDIA_EXTENSIONS, mediaKindOfName } from "@/lib/desktop/mediaKinds";

export { MEDIA_EXTENSIONS };

/*
 * --- desktop-exe --- Media the app opens (native "Open…" dialogs, files passed on the command line or to a second
 * instance): the kind by extension, the MIME type the page's upload handlers expect, the dialog filters and a size cap
 * (the bytes travel to the page over IPC).
 */

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mid: "audio/midi",
  midi: "audio/midi",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  json: "application/json",
  gguf: "application/octet-stream",
};

/** Bytes a picked file may have (it is read into memory and handed to the page). */
export const MAX_PICKED_BYTES = 1024 * 1024 * 1024;

export function extensionOf(file: string): string {
  return path.extname(file).slice(1).toLowerCase();
}

export function mediaKindOf(file: string): PickedFile["kind"] {
  return mediaKindOfName(path.basename(file));
}

export function mimeOf(file: string): string {
  return MIME[extensionOf(file)] ?? "application/octet-stream";
}

/** The dialog filter of a kind. */
export function dialogFilters(kind: MediaKind | "model"): { name: string; extensions: string[] }[] {
  return [{ name: kind, extensions: [...MEDIA_EXTENSIONS[kind]] }];
}

/** Command-line arguments that are files the app can open (a second instance, "Open with"). */
export function filesInArgv(argv: readonly string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith("-") && mediaKindOf(a) !== "unknown" && path.isAbsolute(a));
}
