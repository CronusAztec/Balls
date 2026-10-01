import type { MediaKind } from "./contract";

/* --- desktop-exe --- Media kinds by file extension (the app's dialogs and command line, the page's drag and drop). */

export const MEDIA_EXTENSIONS: Record<MediaKind | "model", readonly string[]> = {
  song: ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus"],
  video: ["mp4", "webm", "mov", "mkv", "m4v"],
  midi: ["mid", "midi"],
  image: ["png", "jpg", "jpeg", "webp", "gif"],
  project: ["json"],
  model: ["gguf"],
};

export function extensionOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function mediaKindOfName(name: string): MediaKind | "model" | "unknown" {
  const ext = extensionOfName(name);
  for (const [kind, list] of Object.entries(MEDIA_EXTENSIONS)) if (list.includes(ext)) return kind as MediaKind | "model";
  return "unknown";
}
