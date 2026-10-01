/*
 * --- social-publish --- The clips the Publish block can send: the page hands every finished video in here – the last
 * recording (Record Video), a fast export, every clip of a batch or of the viral bot's render – and the block lists the
 * newest few (a picked file joins them too). A small module-level store, so a clip made while the Recording section is
 * closed is there when it opens; kept in memory only (never in storage), the oldest dropped past MAX_CLIPS.
 */
import { SITE_SLUG } from "@/lib/site";

export const CLIP_SOURCES = ["recording", "fast", "batch", "bot", "file"] as const;
export type ClipSource = (typeof CLIP_SOURCES)[number];

export interface PublishClip {
  id: string;
  /** File name, with the extension of its container. */
  name: string;
  blob: Blob;
  /** MIME type ("video/mp4", "video/webm"). */
  type: string;
  bytes: number;
  source: ClipSource;
  /** Length in seconds when known (a fast export knows it; a recording's is read from the file). */
  durationSec: number | null;
  mode: string | null;
  seed: number | null;
  /** The viral bot's clip id (its file base) for a bot render: its copy comes from the bot's plan. */
  botClipId: string | null;
  createdAt: number;
}

export interface OfferClipInput {
  blob: Blob;
  /** A file name or a base; the extension follows the blob's container. */
  name: string;
  source: ClipSource;
  durationSec?: number | null;
  mode?: string | null;
  seed?: number | null;
  botClipId?: string | null;
}

/** Clips kept (each can be tens of MB). */
export const MAX_CLIPS = 8;

/** "mp4" / "webm" / "mov" from a MIME type, else from the name, else "mp4". */
export function clipExtension(type: string, name = ""): string {
  const t = type.toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("quicktime")) return "mov";
  if (t.includes("mp4")) return "mp4";
  const m = /\.([a-z0-9]{2,4})$/i.exec(name);
  return m ? m[1].toLowerCase() : "mp4";
}

/** A MIME type for the clip: the blob's, else guessed from the name. */
export function clipType(blob: Blob, name: string): string {
  if (blob.type) return blob.type.split(";")[0].trim() || blob.type;
  const ext = clipExtension("", name);
  return ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4";
}

/** The clip's file name with the right extension. */
export function clipFileName(name: string, type: string): string {
  const ext = clipExtension(type, name);
  const base = name.replace(/\.(mp4|webm|mov|m4v|mkv)$/i, "").trim() || `${SITE_SLUG}-clip`;
  return `${base}.${ext}`;
}

let clips: PublishClip[] = [];
let serial = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

/** Hands a finished video to the Publish block; returns the clip (the newest now). */
export function offerPublishClip(input: OfferClipInput): PublishClip {
  const type = clipType(input.blob, input.name);
  serial += 1;
  const clip: PublishClip = {
    id: `clip-${Date.now().toString(36)}-${serial}`,
    name: clipFileName(input.name, type),
    blob: input.blob,
    type,
    bytes: input.blob.size,
    source: input.source,
    durationSec: input.durationSec !== undefined && input.durationSec !== null && Number.isFinite(input.durationSec) && input.durationSec > 0 ? input.durationSec : null,
    mode: input.mode ?? null,
    seed: input.seed ?? null,
    botClipId: input.botClipId ?? null,
    createdAt: Date.now(),
  };
  clips = [clip, ...clips].slice(0, MAX_CLIPS);
  emit();
  return clip;
}

/** The clips, newest first. */
export function publishClips(): readonly PublishClip[] {
  return clips;
}

/** Sets a clip's length once it is known (read from the file). */
export function setClipDuration(id: string, durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  let changed = false;
  clips = clips.map((c) => {
    if (c.id !== id || c.durationSec !== null) return c;
    changed = true;
    return { ...c, durationSec };
  });
  if (changed) emit();
}

export function removePublishClip(id: string): void {
  const next = clips.filter((c) => c.id !== id);
  if (next.length === clips.length) return;
  clips = next;
  emit();
}

export function subscribePublishClips(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** For the tests. */
export function resetPublishClips(): void {
  clips = [];
  emit();
}
