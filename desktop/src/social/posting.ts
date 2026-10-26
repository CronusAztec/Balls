/*
 * --- social-postiz --- Posting a Library clip through Postiz (phase 2 of docs/SOCIAL-AUTOPILOT.md). Two steps, both only on
 * the card's Approve or on its way there:
 *
 *  - `prepareClip(libraryItemId)`: the clip as Postiz takes it – an MP4 within 1 GB. The render queue's MP4s pass through as
 *    they are; a WebM (the fast export) or anything else is transcoded by the bundled ffmpeg (H.264 + AAC, the same encoder
 *    and command line the render queue's transcode uses) into a hidden temporary file next to the clip, removed after the
 *    upload.
 *  - `postClip(request)`: one upload, then ONE `POST /posts` with an entry per chosen channel – the text and the full provider
 *    settings the card collected, `now` / `schedule` (+ the UTC date) / `draft`. Progress goes to the page as `social:progress`.
 *
 * Guards: one clip on its way at a time (a second Approve while one runs is refused with a clear message); at most one created
 * post per channel every 20 minutes and under 60 create calls an hour, both read from the audit log (so they hold across a
 * restart); a 429 waits Postiz's Retry-After once, then the error surfaces. Every create is written to social-audit.json.
 *
 * --- insights --- The audit line of a create keeps the clip's genes (lib/insights/genes.ts) with the TikTok audience the card
 * chose: the queue item's copy when the post comes from the queue, else the Library item's, sanitised either way.
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { EncoderProbe, SocialPostRequest, SocialPostResult, SocialPreparedClip, SocialProgressEvent, TranscodeSpec } from "@/lib/desktop/contract";
import { clipVideoKey } from "@/lib/desktop/autopilot"; // --- ai-cut --- the video key a post keeps
import { genesAtApproval } from "@/lib/insights/genes"; // --- insights --- the genes a post keeps
import { buildInfoArgs, buildTranscodeArgs, parseDuration, parseVideoSize } from "../ffmpeg/args";
import type { runFfmpeg } from "../ffmpeg/run";
import type { Library } from "../library";
import { CHANNEL_COOLDOWN_MS, CREATE_CALLS_PER_HOUR, HOUR_MS, type SocialAudit } from "./audit";
import { POSTIZ_MAX_VIDEO_BYTES, PostizError, type PostizClient, type PostizCreatePostsBody, type PostizCreatedPost } from "./postiz";

/** The longest the app waits on a 429 before it gives up on the retry. */
export const MAX_RETRY_WAIT_MS = 5 * 60_000;
/** A transcode may take this long before it is killed. */
export const TRANSCODE_TIMEOUT_MS = 30 * 60_000;

export interface ClipPosterDeps {
  library: Pick<Library, "get">;
  /** The client over the stored key (null without one). */
  client: () => PostizClient | null;
  ffmpeg: () => string | null;
  probe: () => Promise<EncoderProbe>;
  run: typeof runFfmpeg;
  audit: SocialAudit;
  emit: (event: SocialProgressEvent) => void;
  log: (level: "info" | "warn" | "error", message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** The file system (the tests hand in a fake). `readdir` is optional: without it, stale temporary files are not swept. */
  files?: Pick<typeof fs, "stat" | "readFile" | "rm"> & Partial<Pick<typeof fs, "readdir">>;
}

/** "30 fps" / "59.94 fps" in ffmpeg's banner (null when absent). */
export function parseFrameRate(stderr: string): number | null {
  const m = /,\s*(\d+(?:\.\d+)?)\s*fps/.exec(stderr);
  return m ? Number(m[1]) : null;
}

/** The transcode of a clip into an MP4 Postiz takes: its own frame and rate, H.264 at a Reels-grade bitrate, AAC stereo. */
export function transcodeSpecFor(size: { width: number | null; height: number | null }, fps: number | null): TranscodeSpec {
  const width = size.width && size.width > 0 ? size.width : 1080;
  const height = size.height && size.height > 0 ? size.height : 1920;
  const rate = fps && Number.isFinite(fps) && fps >= 1 ? Math.min(120, Math.round(fps)) : 60;
  return { codec: "h264", width: width + (width % 2), height: height + (height % 2), fps: rate, videoKbps: 12000, maxKbps: 16000, audioKbps: 192, sampleRate: 48000 };
}

/** The hidden temporary MP4 next to the clip. */
export function tempMp4PathFor(clipPath: string, token: string = randomUUID().slice(0, 8)): string {
  const base = path.basename(clipPath).replace(/\.[^.]+$/, "");
  return path.join(path.dirname(clipPath), `.${base}-postiz-${token}.mp4`);
}

/** --- review fix (social-postiz) --- Whether `name` is a temporary MP4 of this clip left by an earlier run (a crash, a kill). */
export function isStaleTempMp4(clipPath: string, name: string): boolean {
  const base = path.basename(clipPath).replace(/\.[^.]+$/, "");
  return name.startsWith(`.${base}-postiz-`) && /^\.[^/\\]+-postiz-[0-9a-f]{8}\.mp4$/.test(name);
}

/** The Postiz body of an approved request: one entry per channel, the upload once in every entry. */
export function createPostsBodyOf(request: SocialPostRequest, upload: { id: string; path: string }, now: number): PostizCreatePostsBody {
  const type = request.when === "now" ? "now" : request.when === "draft" ? "draft" : "schedule";
  const date = type === "schedule" ? new Date(request.when).toISOString() : new Date(now).toISOString();
  return {
    type,
    date,
    shortLink: false,
    tags: [],
    posts: request.channels.map((c) => ({
      integration: { id: c.id },
      value: [{ content: c.text, image: [{ id: upload.id, path: upload.path, ...(request.thumbnailMs !== undefined ? { thumbnailTimestamp: request.thumbnailMs } : {}) }] }],
      settings: { ...c.settings },
    })),
  };
}

export class ClipPoster {
  /** The clip on its way (null: none). */
  private active: string | null = null;
  /** The prepared files by Library item id (a temporary MP4 is reused until the post removes it). */
  private readonly prepared = new Map<string, SocialPreparedClip>();
  /** --- review fix (social-postiz) --- The preparations under way by Library item id: a second call joins the first. */
  private readonly preparing = new Map<string, Promise<SocialPreparedClip>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly files: NonNullable<ClipPosterDeps["files"]>;

  constructor(private readonly deps: ClipPosterDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.files = deps.files ?? fs;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  /** The clip as Postiz takes it: the MP4 itself, or a transcoded temporary MP4 next to it, both within 1 GB. */
  prepareClip(clipId: string): Promise<SocialPreparedClip> {
    // --- review fix (social-postiz) --- one preparation per clip at a time: a concurrent call gets the same promise, so one
    // ffmpeg runs and one temporary file is made
    const running = this.preparing.get(clipId);
    if (running) return running;
    const work = this.prepareClipNow(clipId).finally(() => this.preparing.delete(clipId));
    this.preparing.set(clipId, work);
    return work;
  }

  /** --- review fix (social-postiz) --- Temporary MP4s of this clip left by an earlier run are removed (best effort). */
  private async sweepStaleTemp(clipPath: string): Promise<void> {
    if (!this.files.readdir) return;
    const names = await this.files.readdir(path.dirname(clipPath)).catch(() => null);
    if (!names) return;
    for (const name of names) if (isStaleTempMp4(clipPath, String(name))) await this.files.rm(path.join(path.dirname(clipPath), String(name)), { force: true }).catch(() => {});
  }

  private async prepareClipNow(clipId: string): Promise<SocialPreparedClip> {
    const item = await this.deps.library.get(clipId);
    if (!item) throw new Error("This clip is not in the Library any more");
    const stat = await this.files.stat(item.path).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error(`The clip's file is missing: ${item.fileName}`);
    const kept = this.prepared.get(clipId);
    if (kept?.transcoded && (await this.files.stat(kept.path).catch(() => null))) return kept;
    await this.sweepStaleTemp(item.path); // (a kept temporary file that still exists returned above, so it is never swept)
    const isMp4 = /\.(mp4|m4v)$/i.test(item.path);
    if (isMp4) {
      if (stat.size > POSTIZ_MAX_VIDEO_BYTES) throw new PostizError("tooLarge", `${item.fileName} is ${(stat.size / 1024 ** 3).toFixed(2)} GB: Postiz takes videos up to 1 GB`);
      const ready: SocialPreparedClip = { path: item.path, bytes: stat.size, type: "video/mp4", durationSec: item.durationSec, width: item.width, height: item.height, transcoded: false };
      this.prepared.set(clipId, ready);
      return ready;
    }
    // Anything else: the bundled ffmpeg makes an MP4 (H.264 + AAC) the way the render queue's transcode does.
    const ffmpeg = this.deps.ffmpeg();
    if (!ffmpeg) throw new Error("ffmpeg is not available, so this clip cannot be turned into an MP4 for Postiz. Pick an ffmpeg build in the GPU panel.");
    const probe = await this.deps.probe();
    const encoder = probe.chosen.h264;
    if (!encoder) throw new Error("No working H.264 encoder in this ffmpeg build");
    let durationSec = item.durationSec;
    let size = item.width && item.height ? { width: item.width, height: item.height } : null;
    let fps: number | null = null;
    const info = await this.deps.run(ffmpeg, buildInfoArgs(item.path), { timeoutMs: 20000 }).catch(() => null);
    if (info) {
      durationSec = parseDuration(info.stderr) ?? durationSec;
      size = parseVideoSize(info.stderr) ?? size;
      fps = parseFrameRate(info.stderr);
    }
    const spec = transcodeSpecFor(size ?? { width: null, height: null }, fps);
    const output = tempMp4PathFor(item.path);
    const durationUs = Math.max(1, (durationSec ?? 1) * 1_000_000);
    const args = buildTranscodeArgs(item.path, output, spec, encoder);
    this.deps.log("info", `postiz transcode ${item.fileName}: ffmpeg ${args.join(" ")}`);
    this.deps.emit({ clipId, phase: "transcoding", percent: 0 });
    let result: Awaited<ReturnType<typeof runFfmpeg>>;
    try {
      result = await this.deps.run(ffmpeg, args, { timeoutMs: TRANSCODE_TIMEOUT_MS, onProgress: (us) => this.deps.emit({ clipId, phase: "transcoding", percent: Math.min(100, Math.round((us / durationUs) * 100)) }) });
    } catch (err) {
      await this.files.rm(output, { force: true }).catch(() => {});
      throw err;
    }
    if (result.code !== 0) {
      await this.files.rm(output, { force: true }).catch(() => {});
      throw new Error(`ffmpeg failed (${result.code}): ${result.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ").slice(0, 400)}`);
    }
    const made = await this.files.stat(output);
    if (made.size > POSTIZ_MAX_VIDEO_BYTES) {
      await this.files.rm(output, { force: true }).catch(() => {});
      throw new PostizError("tooLarge", `${item.fileName} is ${(made.size / 1024 ** 3).toFixed(2)} GB as an MP4: Postiz takes videos up to 1 GB`);
    }
    this.deps.emit({ clipId, phase: "transcoding", percent: 100 });
    const ready: SocialPreparedClip = { path: output, bytes: made.size, type: "video/mp4", durationSec, width: spec.width, height: spec.height, transcoded: true };
    this.prepared.set(clipId, ready);
    return ready;
  }

  /** The guards before anything is sent: a clear message, or null when the post may go. */
  async refusal(request: SocialPostRequest): Promise<string | null> {
    // --- review fix (social-postiz) --- `postClip` has taken the slot by the time it asks, so "busy" is another clip's slot
    if (this.active !== null && this.active !== request.clipId) return "A clip is already on its way to Postiz. Wait for it to finish, then approve this one.";
    const now = this.now();
    for (const channel of request.channels) {
      const last = await this.deps.audit.lastCreateFor(channel.id);
      if (last !== null && now - last < CHANNEL_COOLDOWN_MS) {
        const wait = Math.max(1, Math.ceil((CHANNEL_COOLDOWN_MS - (now - last)) / 60_000));
        return `A post was created for this channel ${Math.max(1, Math.round((now - last) / 60_000))} min ago. The app creates at most one post per channel every 20 minutes: wait ${wait} min, or untick the channel.`;
      }
    }
    const calls = await this.deps.audit.createCallsSince(now - HOUR_MS);
    if (calls >= CREATE_CALLS_PER_HOUR) return `The app has created ${calls} posts in the last hour, its limit with one Postiz key. Try again in a while.`;
    return null;
  }

  /**
   * Approve: one upload, one create call with every channel; the post ids per channel. --- insights --- `from.genes`: the
   * queue item's copy of the clip's genes (the Library item's are read when it brings none).
   */
  async postClip(request: SocialPostRequest, from: { genes?: unknown } = {}): Promise<SocialPostResult> {
    // --- review fix (social-postiz) --- the slot is taken before the first await: two Approves in the same tick cannot both
    // pass the audit reads and both post (the second would also skip the 20-minute cooldown the first is about to write)
    if (this.active !== null) throw new Error("A clip is already on its way to Postiz. Wait for it to finish, then approve this one.");
    this.active = request.clipId;
    let prepared: SocialPreparedClip | null = null;
    try {
      const refused = await this.refusal(request);
      if (refused) throw new Error(refused);
      const client = this.deps.client();
      if (!client) throw new PostizError("unauthorized", "Paste the Postiz API key in the Accounts tab first");
      prepared = await this.prepareClip(request.clipId);
      // --- ai-cut --- the video the post shows (a master and its cut are one), kept with the post: the autopilot still knows it
      // once the Library forgets the clip
      const { video, libraryGenes } = await this.deps.library
        .get(request.clipId)
        .then((item) => ({ video: item ? clipVideoKey(item) : null, libraryGenes: item?.meta?.genes as unknown }))
        .catch(() => ({ video: null, libraryGenes: undefined }));
      // --- insights --- the clip's genes with the audience the card chose, kept with the post ids (the attribution ledger)
      const genes = genesAtApproval(from.genes ?? libraryGenes, request.channels);
      this.deps.emit({ clipId: request.clipId, phase: "uploading", percent: 0 });
      const bytes = await this.files.readFile(prepared.path);
      const upload = await client.upload({ name: path.basename(prepared.path).replace(/^\./, ""), type: "video/mp4", bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
      if (!upload.id) throw new PostizError("unknown", "Postiz did not return the uploaded file's id");
      this.deps.emit({ clipId: request.clipId, phase: "uploading", percent: 100 });
      this.deps.emit({ clipId: request.clipId, phase: "creating", percent: 0 });
      const body = createPostsBodyOf(request, upload, this.now());
      let created: PostizCreatedPost[];
      try {
        created = await client.createPosts(body);
      } catch (err) {
        // 429 once: wait what Postiz asked for (bounded), then try again; the second failure surfaces
        if (!(err instanceof PostizError) || err.code !== "rateLimited" || err.retryAfterMs === null || err.retryAfterMs > MAX_RETRY_WAIT_MS) throw err;
        this.deps.log("warn", `postiz create: 429, waiting ${err.retryAfterMs} ms once`);
        await this.sleep(err.retryAfterMs);
        created = await client.createPosts(body);
      }
      const postIds = created.filter((c) => c.postId).map((c) => ({ channelId: c.integration, postId: c.postId }));
      await this.deps.audit.record({ action: "createPosts", channels: request.channels.map((c) => c.id), postIds: postIds.map((p) => p.postId), clipId: request.clipId, when: request.when, ...(video ? { video } : {}), ...(genes ? { genes } : {}) /* --- insights --- */ });
      this.deps.log("info", `postiz: created ${postIds.length} post(s) for ${request.channels.length} channel(s), type ${body.type}, date ${body.date}`);
      this.deps.emit({ clipId: request.clipId, phase: "done", percent: 100 });
      return { postIds, group: created.find((c) => c.group)?.group ?? null };
    } finally {
      if (prepared?.transcoded) await this.files.rm(prepared.path, { force: true }).catch(() => {});
      if (prepared?.transcoded) this.prepared.delete(request.clipId);
      this.active = null;
    }
  }
}
