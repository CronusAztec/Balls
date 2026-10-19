import path from "path";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_METHODS, IPC, SOCIAL_MAX_CHANNELS, checkIpcArgs, checkSocialPostRequest, type IpcChannel, type SocialPostRequest, type SocialProgressEvent } from "@/lib/desktop/contract";
import { SecretBox, type SafeStorageLike } from "../src/ai/secrets";
import type { JsonFileStore } from "../src/journal";
import type { Library, StoredItem } from "../src/library";
import type { runFfmpeg } from "../src/ffmpeg/run";
import { AUDIT_MAX_ENTRIES, CHANNEL_COOLDOWN_MS, CREATE_CALLS_PER_HOUR, SocialAudit } from "../src/social/audit";
import { PostizKeyStore } from "../src/social/keys";
import { outcomeWindow, recentPosts } from "../src/social/outcomes";
import { ClipPoster, MAX_RETRY_WAIT_MS, createPostsBodyOf, isStaleTempMp4, parseFrameRate, tempMp4PathFor, transcodeSpecFor } from "../src/social/posting";
import { PostizClient, PostizError } from "../src/social/postiz";
import { SocialService } from "../src/social/service";
import { guarded } from "../src/handlers";

/*
 * --- social-postiz --- Phase 2 in the main process: a clip prepared for Postiz (an MP4 passes through, a WebM is transcoded
 * by a fake ffmpeg into a temporary file next to it, anything over 1 GB is refused), the post itself (one upload, then ONE
 * create call with every channel and the exact body Postiz expects), the progress events, the guards (one clip at a time,
 * one post per channel every 20 minutes, under 60 creates an hour, a 429 retried once), the audit log, the outcomes
 * mapping, deleting a post, the new bridge channels' argument checks and the `social:slot` call.
 */

const KEY = "pz_secret_key_0123456789abcdef";
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A stand-in Postiz for the posting calls (upload, posts, delete, find-slot, integration-settings). */
function postizServer(routes: Record<string, (call: Call, n: number) => Response | Promise<Response>> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const call: Call = { url, method, body: init.body };
    calls.push(call);
    const pathname = new URL(url).pathname.replace(/^.*\/public\/v1/, "");
    const key = `${method} ${pathname}`;
    const route = routes[key] ?? routes[pathname];
    if (route) return route(call, calls.filter((c) => `${c.method} ${new URL(c.url).pathname.replace(/^.*\/public\/v1/, "")}` === key).length);
    if (pathname === "/is-connected") return json({ connected: true });
    if (pathname === "/me") return json({ id: "org-1", name: "Gerald Studio" });
    if (pathname === "/integrations") return json([{ id: "int-tt", name: "Gerald on TikTok", identifier: "tiktok" }]);
    if (pathname === "/upload" && method === "POST") return json({ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4" });
    if (pathname === "/posts" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { posts: { integration: { id: string } }[] };
      return json(body.posts.map((p, i) => ({ postId: `post-${i + 1}`, integration: p.integration.id, group: "grp-1" })));
    }
    if (pathname === "/posts" && method === "GET")
      return json([
        { id: "post-2", content: "second", publishDate: "2026-10-19T10:00:00.000Z", state: "QUEUE", releaseURL: null, group: "grp-1", integration: { id: "int-yt", name: "Gerald Shorts", providerIdentifier: "youtube", picture: null } },
        { id: "post-1", content: "first", publishDate: "2026-10-18T10:00:00.000Z", state: "PUBLISHED", releaseURL: "https://www.tiktok.com/@gerald/video/1", group: "grp-1", integration: { id: "int-tt", name: "Gerald on TikTok", providerIdentifier: "tiktok", picture: "https://cdn.postiz.example/tt.png" } },
        { id: "post-3", content: "third", publishDate: "2026-10-17T10:00:00.000Z", state: "ERROR", error: "TikTok refused the video", group: "grp-2", integration: null },
      ]);
    if (/^\/posts\/[^/]+$/.test(pathname) && method === "DELETE") return json({ ok: true });
    if (pathname.startsWith("/find-slot/")) return json({ date: "2026-10-19T17:00:00.000Z" });
    if (pathname.startsWith("/integration-settings/")) return json({ identifier: "bluesky", maxLength: 300, settings: [] });
    return json({ message: "no such route" }, { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const client = (server: ReturnType<typeof postizServer>) => new PostizClient({ baseUrl: "https://api.postiz.com", apiKey: KEY, fetch: server.fetchImpl });

/** An in-memory stand-in for the crash-safe JSON file. */
function memoryStore<T>(initial: T | null = null) {
  let value: T | null = initial;
  const writes: T[] = [];
  const store = { read: async () => value, write: async (v: T) => void (writes.push(v), (value = v)) } as unknown as JsonFileStore<T>;
  return { store, writes, value: () => value };
}

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const GB = 1024 ** 3;

const items: Record<string, StoredItem> = {
  mp4: { id: "mp4", path: "C:/Videos/glass.mp4", fileName: "glass.mp4", bytes: 4, durationSec: 12, width: 1080, height: 1920, createdAt: 1, encoder: "h264_nvenc", thumbnailFile: null, meta: { title: "Glass smash", mode: "glass", seed: 7, link: "", platform: "tiktok", hook: null, caption: "Which floor breaks first?", hashtags: ["#glass"], queueJobId: null } },
  webm: { id: "webm", path: "C:/Videos/fast.webm", fileName: "fast.webm", bytes: 4, durationSec: 10, width: null, height: null, createdAt: 1, encoder: null, thumbnailFile: null, meta: { title: "Fast", mode: "classic", seed: 1, link: "", platform: null, hook: null, caption: null, hashtags: [], queueJobId: null } },
  big: { id: "big", path: "C:/Videos/big.mp4", fileName: "big.mp4", bytes: GB + 1, durationSec: 600, width: 1080, height: 1920, createdAt: 1, encoder: null, thumbnailFile: null, meta: { title: "Big", mode: "glass", seed: 1, link: "", platform: null, hook: null, caption: null, hashtags: [], queueJobId: null } },
  gone: { id: "gone", path: "C:/Videos/gone.mp4", fileName: "gone.mp4", bytes: 4, durationSec: 1, width: null, height: null, createdAt: 1, encoder: null, thumbnailFile: null, meta: { title: "Gone", mode: "glass", seed: 1, link: "", platform: null, hook: null, caption: null, hashtags: [], queueJobId: null } },
};

/** A poster over fakes: the files on disk (path → size), a fake ffmpeg that "writes" its output, a stand-in Postiz. */
function poster(server: ReturnType<typeof postizServer>, options: { ffmpeg?: string | null; encoder?: string | null; transcodeCode?: number; transcodedSize?: number; audit?: SocialAudit; now?: () => number; uploadGate?: Promise<void>; transcodeGate?: Promise<void>; extraFiles?: string[] } = {}) {
  const files = new Map<string, number>([
    ["C:/Videos/glass.mp4", 4],
    ["C:/Videos/fast.webm", 4],
    ["C:/Videos/big.mp4", GB + 1],
    ...(options.extraFiles ?? []).map((f): [string, number] => [f, 1]),
  ]);
  const removed: string[] = [];
  const runs: { args: string[]; options: Parameters<typeof runFfmpeg>[2] }[] = [];
  const run: typeof runFfmpeg = async (_binary, args, opts = {}) => {
    runs.push({ args, options: opts });
    if (args[args.length - 1] === args[3] && args[2] === "-i") return { code: 0, stdout: "", stderr: "Input #0, matroska,webm, from 'fast.webm':\n  Duration: 00:00:10.50, start: 0.000000\n  Stream #0:0: Video: vp9, yuv420p, 1080x1920, SAR 1:1, 30 fps, 30 tbr" };
    const output = args[args.length - 1];
    opts.onProgress?.(5_000_000);
    if (options.transcodeGate) await options.transcodeGate;
    if ((options.transcodeCode ?? 0) === 0) files.set(output, options.transcodedSize ?? 777);
    return { code: options.transcodeCode ?? 0, stdout: "", stderr: (options.transcodeCode ?? 0) === 0 ? "" : "Conversion failed!\nsomething broke" };
  };
  const events: SocialProgressEvent[] = [];
  const sleeps: number[] = [];
  const audit = options.audit ?? new SocialAudit(memoryStore<never[]>().store, options.now ?? (() => NOW));
  const keys = new PostizKeyStore({ settings: () => ({ baseUrl: "https://api.postiz.com", keySealed: Buffer.from(`enc:${KEY}`).toString("base64") }), setSettings: () => {}, secrets: new SecretBox(plainStorage), fetch: server.fetchImpl });
  const p = new ClipPoster({
    library: { get: async (id: string) => items[id] } as unknown as Pick<Library, "get">,
    client: () => keys.client(),
    ffmpeg: () => (options.ffmpeg === undefined ? "/bin/ffmpeg" : options.ffmpeg),
    probe: async () => ({ ffmpeg: { path: "/bin/ffmpeg", version: "7", bundled: true }, encoders: [], chosen: { h264: options.encoder === undefined ? "h264_nvenc" : options.encoder, hevc: null, av1: null }, error: null }),
    run,
    audit,
    emit: (e) => events.push(e),
    log: () => {},
    now: options.now ?? (() => NOW),
    sleep: async (ms) => void sleeps.push(ms),
    files: {
      stat: async (file: string) => {
        const size = files.get(String(file));
        if (size === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return { size, isFile: () => true };
      },
      readFile: async (file: string) => {
        if (options.uploadGate) await options.uploadGate;
        return Buffer.alloc(files.get(String(file)) ?? 0, 1);
      },
      rm: async (file: string) => void (removed.push(String(file)), files.delete(String(file))),
      readdir: async (dir: string) => [...files.keys()].filter((f) => path.dirname(f) === String(dir)).map((f) => path.basename(f)),
    } as unknown as NonNullable<ConstructorParameters<typeof ClipPoster>[0]["files"]>,
  });
  return { poster: p, files, removed, runs, events, sleeps, audit, keys };
}

const plainStorage: SafeStorageLike = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`enc:${t}`), decryptString: (b) => b.toString().replace(/^enc:/, "") };

const tiktok = { __type: "tiktok", privacy_level: "PUBLIC_TO_EVERYONE", comment: true, duet: false, stitch: false, brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: "DIRECT_POST", video_made_with_ai: true, autoAddMusic: "no" } as const; // --- review fix (social-postiz) --- autoAddMusic is required
const youtube = { __type: "youtube", title: "Glass smash", type: "public", selfDeclaredMadeForKids: "no", tags: [{ value: "glass", label: "glass" }] } as const;
const request = (over: Partial<SocialPostRequest> = {}): SocialPostRequest => ({
  clipId: "mp4",
  channels: [
    { id: "int-tt", platform: "tiktok", text: "Which floor breaks first?\n\n#glass", settings: { ...tiktok } },
    { id: "int-yt", platform: "youtube", text: "Which floor breaks first?", settings: { ...youtube } },
  ],
  when: "now",
  ...over,
});

/* ------------------------------------------------------------------ prepareClip */

describe("ClipPoster.prepareClip", () => {
  it("passes an MP4 through as it is: no ffmpeg, the file's size, the Library's length and frame", async () => {
    const { poster: p, runs } = poster(postizServer());
    const ready = await p.prepareClip("mp4");
    expect(ready).toEqual({ path: "C:/Videos/glass.mp4", bytes: 4, type: "video/mp4", durationSec: 12, width: 1080, height: 1920, transcoded: false });
    expect(runs).toHaveLength(0);
  });

  it("transcodes a WebM with the bundled ffmpeg into a hidden MP4 next to the clip (H.264 on the probe's encoder, AAC) and reports progress", async () => {
    const { poster: p, runs, events } = poster(postizServer());
    const ready = await p.prepareClip("webm");
    expect(ready.transcoded).toBe(true);
    expect(ready.type).toBe("video/mp4");
    expect(ready.bytes).toBe(777);
    expect(path.normalize(path.dirname(ready.path))).toBe(path.normalize("C:/Videos")); // path.join gives backslashes on Windows
    expect(path.basename(ready.path)).toMatch(/^\.fast-postiz-[0-9a-f]{8}\.mp4$/);
    // the banner was read for the length, the frame and the rate; then the transcode
    expect(runs).toHaveLength(2);
    expect(runs[0].args).toEqual(["-hide_banner", "-nostdin", "-i", "C:/Videos/fast.webm"]);
    const args = runs[1].args;
    expect(args).toContain("h264_nvenc");
    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2)).toEqual(["-c:a", "aac"]);
    expect(args).toContain("+faststart");
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=1080:1920");
    expect(args[args.indexOf("-r") + 1]).toBe("30");
    expect(args[args.length - 1]).toBe(ready.path);
    expect(ready.durationSec).toBe(10.5);
    expect(ready.width).toBe(1080);
    expect(ready.height).toBe(1920);
    expect(events.map((e) => [e.phase, e.percent])).toEqual([
      ["transcoding", 0],
      ["transcoding", 48], // 5 s of 10.5
      ["transcoding", 100],
    ]);
    // asked again, the same temporary file is reused (no second transcode)
    expect(await p.prepareClip("webm")).toEqual(ready);
    expect(runs).toHaveLength(2);
  });

  it("refuses a clip over 1 GB (as it is, or once transcoded) and says when ffmpeg or an H.264 encoder is missing", async () => {
    const { poster: p } = poster(postizServer());
    await expect(p.prepareClip("big")).rejects.toMatchObject({ code: "tooLarge", message: expect.stringContaining("1 GB") });
    const huge = poster(postizServer(), { transcodedSize: GB + 5 });
    await expect(huge.poster.prepareClip("webm")).rejects.toMatchObject({ code: "tooLarge" });
    expect(huge.removed).toHaveLength(1); // the oversized temporary file is gone
    const noFfmpeg = poster(postizServer(), { ffmpeg: null });
    await expect(noFfmpeg.poster.prepareClip("webm")).rejects.toThrow(/ffmpeg is not available/);
    const noEncoder = poster(postizServer(), { encoder: null });
    await expect(noEncoder.poster.prepareClip("webm")).rejects.toThrow(/H\.264 encoder/);
    const failed = poster(postizServer(), { transcodeCode: 1 });
    await expect(failed.poster.prepareClip("webm")).rejects.toThrow(/ffmpeg failed \(1\): Conversion failed! something broke/);
    expect(failed.removed).toHaveLength(1);
    await expect(p.prepareClip("gone")).rejects.toThrow(/file is missing/);
    await expect(p.prepareClip("nope")).rejects.toThrow(/not in the Library/);
  });

  // --- review fix (social-postiz) ---
  it("runs one ffmpeg and makes one temporary file when the same clip is prepared twice at once, and both callers get the same result", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { poster: p, runs, files } = poster(postizServer(), { transcodeGate: gate });
    const both = Promise.all([p.prepareClip("webm"), p.prepareClip("webm")]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [a, b] = await both;
    expect(a).toBe(b);
    expect(a.transcoded).toBe(true);
    expect(runs).toHaveLength(2); // one banner read, one transcode
    expect(runs[0].args).toEqual(["-hide_banner", "-nostdin", "-i", "C:/Videos/fast.webm"]);
    expect(runs[1].args[runs[1].args.length - 1]).toBe(a.path);
    expect([...files.keys()].filter((f) => /-postiz-/.test(f))).toEqual([a.path]);
    // once done, a later call reuses the kept file rather than joining a finished promise
    expect(await p.prepareClip("webm")).toBe(a);
    expect(runs).toHaveLength(2);
  });

  // --- review fix (social-postiz) ---
  it("sweeps stale temporary MP4s of the clip left by an earlier run, and nothing else", async () => {
    const stale = ["C:/Videos/.fast-postiz-deadbeef.mp4", "C:/Videos/.fast-postiz-0badf00d.mp4"];
    const others = ["C:/Videos/.glass-postiz-cafebabe.mp4", "C:/Videos/.fast-postiz-notes.txt", "C:/Videos/fast-postiz-deadbeef.mp4", "C:/Videos/.fastest-postiz-deadbeef.mp4"];
    const { poster: p, removed, files } = poster(postizServer(), { extraFiles: [...stale, ...others] });
    const ready = await p.prepareClip("webm");
    expect(removed.map((f) => f.replace(/\\/g, "/")).sort()).toEqual([...stale].sort()); // the sweep joins the directory and the name: backslashes on Windows
    for (const f of others) expect(files.has(f)).toBe(true);
    expect(files.has(ready.path)).toBe(true);
    // the kept file survives a second run
    expect(await p.prepareClip("webm")).toEqual(ready);
    expect(removed).toHaveLength(2);
    expect(isStaleTempMp4("C:/Videos/fast.webm", ".fast-postiz-deadbeef.mp4")).toBe(true);
    expect(isStaleTempMp4("C:/Videos/fast.webm", ".fast-postiz-dead.mp4")).toBe(false);
    expect(isStaleTempMp4("C:/Videos/fast.webm", ".glass-postiz-deadbeef.mp4")).toBe(false);
    // without `readdir` on the file system nothing is swept and nothing breaks
    const bare = poster(postizServer(), { extraFiles: stale });
    delete (bare.poster as unknown as { files: { readdir?: unknown } }).files.readdir;
    await expect(bare.poster.prepareClip("webm")).resolves.toMatchObject({ transcoded: true });
    expect(bare.removed).toEqual([]);
  });

  it("builds the transcode spec from the clip's frame and rate, with defaults where the banner says nothing", () => {
    expect(transcodeSpecFor({ width: 1080, height: 1920 }, 30)).toMatchObject({ codec: "h264", width: 1080, height: 1920, fps: 30, audioKbps: 192, sampleRate: 48000 });
    expect(transcodeSpecFor({ width: 1079, height: 1919 }, 59.94)).toMatchObject({ width: 1080, height: 1920, fps: 60 });
    expect(transcodeSpecFor({ width: null, height: null }, null)).toMatchObject({ width: 1080, height: 1920, fps: 60 });
    expect(parseFrameRate("Stream #0:0: Video: vp9, yuv420p, 1080x1920, SAR 1:1, 29.97 fps, 30 tbr")).toBe(29.97);
    expect(parseFrameRate("nothing")).toBeNull();
    expect(tempMp4PathFor("C:/Videos/fast.webm", "abcd1234")).toBe(path.join("C:/Videos", ".fast-postiz-abcd1234.mp4"));
  });
});

/* ------------------------------------------------------------------ postClip */

describe("ClipPoster.postClip", () => {
  it("uploads once, then creates once with every channel: the exact body (value, image, settings, type, date, shortLink, tags) and the post ids", async () => {
    const server = postizServer();
    const { poster: p, events, audit } = poster(server);
    const result = await p.postClip(request({ when: "2026-10-19T17:00:00.000Z" }));
    expect(result).toEqual({ postIds: [{ channelId: "int-tt", postId: "post-1" }, { channelId: "int-yt", postId: "post-2" }], group: "grp-1" });
    const uploads = server.calls.filter((c) => c.url.endsWith("/upload"));
    const creates = server.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"));
    expect(uploads).toHaveLength(1);
    expect(creates).toHaveLength(1);
    expect(server.calls.indexOf(uploads[0])).toBeLessThan(server.calls.indexOf(creates[0]));
    const file = (uploads[0].body as FormData).get("file") as File;
    expect(file.name).toBe("glass.mp4");
    expect(file.type).toBe("video/mp4");
    expect(file.size).toBe(4);
    expect(JSON.parse(String(creates[0].body))).toEqual({
      type: "schedule",
      date: "2026-10-19T17:00:00.000Z",
      shortLink: false,
      tags: [],
      posts: [
        { integration: { id: "int-tt" }, value: [{ content: "Which floor breaks first?\n\n#glass", image: [{ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4" }] }], settings: tiktok },
        { integration: { id: "int-yt" }, value: [{ content: "Which floor breaks first?", image: [{ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4" }] }], settings: youtube },
      ],
    });
    expect(events.map((e) => [e.phase, e.percent])).toEqual([
      ["uploading", 0],
      ["uploading", 100],
      ["creating", 0],
      ["done", 100],
    ]);
    expect(events.every((e) => e.clipId === "mp4")).toBe(true);
    // the audit line: time, channels, post ids, the clip, when, by the user
    expect(await audit.recent()).toEqual([{ at: "2026-10-18T12:00:00.000Z", action: "createPosts", channels: ["int-tt", "int-yt"], postIds: ["post-1", "post-2"], by: "user", clipId: "mp4", when: "2026-10-19T17:00:00.000Z" }]);
  });

  it("sends `now` and `draft` with the current time, a thumbnail position when chosen, and removes a transcoded temporary file afterwards", async () => {
    const server = postizServer();
    const { poster: p, removed, events } = poster(server);
    await p.postClip(request({ clipId: "webm", when: "now", thumbnailMs: 1500, channels: [{ id: "int-tt", platform: "tiktok", text: "hi", settings: { ...tiktok } }] }));
    const create = JSON.parse(String(server.calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!.body));
    expect(create.type).toBe("now");
    expect(create.date).toBe("2026-10-18T12:00:00.000Z");
    expect(create.posts[0].value[0].image).toEqual([{ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4", thumbnailTimestamp: 1500 }]);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/\.fast-postiz-[0-9a-f]{8}\.mp4$/);
    expect((server.calls.find((c) => c.url.endsWith("/upload"))!.body as FormData).get("file")).toHaveProperty("name", expect.stringMatching(/^fast-postiz-[0-9a-f]{8}\.mp4$/));
    expect(events.map((e) => e.phase)).toEqual(["transcoding", "transcoding", "transcoding", "uploading", "uploading", "creating", "done"]);
    const draft = postizServer();
    const other = poster(draft, { now: () => NOW + 25 * 60_000 });
    await other.poster.postClip(request({ when: "draft" }));
    expect(JSON.parse(String(draft.calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!.body))).toMatchObject({ type: "draft", date: "2026-10-18T12:25:00.000Z" });
    expect(createPostsBodyOf(request({ when: "draft" }), { id: "m", path: "p" }, NOW).posts[0].value[0].image).toEqual([{ id: "m", path: "p" }]);
  });

  it("allows at most one created post per channel every 20 minutes, remembered across a restart through the audit file", async () => {
    const store = memoryStore<never[]>();
    let now = NOW;
    const first = poster(postizServer(), { audit: new SocialAudit(store.store, () => now), now: () => now });
    await first.poster.postClip(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: { ...tiktok } }] }));
    await expect(first.poster.postClip(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "b", settings: { ...tiktok } }] }))).rejects.toThrow(/at most one post per channel every 20 minutes: wait 20 min/);
    // another channel may go; a request that mixes a fresh channel with the cooled one is refused whole (nothing sent)
    const server = postizServer();
    const second = poster(server, { audit: new SocialAudit(store.store, () => now), now: () => now });
    await expect(second.poster.postClip(request())).rejects.toThrow(/every 20 minutes/);
    expect(server.calls).toHaveLength(0);
    await second.poster.postClip(request({ channels: [{ id: "int-yt", platform: "youtube", text: "c", settings: { ...youtube } }] }));
    expect(server.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"))).toHaveLength(1);
    // 19 minutes later still refused, 20 minutes later fine – after a "restart" (a new audit over the same file)
    now = NOW + CHANNEL_COOLDOWN_MS - 60_000;
    const later = poster(postizServer(), { audit: new SocialAudit(store.store, () => now), now: () => now });
    await expect(later.poster.postClip(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "d", settings: { ...tiktok } }] }))).rejects.toThrow(/wait 1 min/);
    now = NOW + CHANNEL_COOLDOWN_MS;
    await expect(later.poster.postClip(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "e", settings: { ...tiktok } }] }))).resolves.toMatchObject({ postIds: [{ channelId: "int-tt" }] });
    expect(store.value()).toHaveLength(3);
  });

  it("stays under 60 create calls an hour from one key", async () => {
    const seed = Array.from({ length: CREATE_CALLS_PER_HOUR }, (_, i) => ({ at: new Date(NOW - (i + 1) * 30_000).toISOString(), action: "createPosts" as const, channels: [`c${i}`], postIds: [`p${i}`], by: "user" as const, clipId: null, when: null }));
    const store = memoryStore(seed);
    const server = postizServer();
    const { poster: p } = poster(server, { audit: new SocialAudit(store.store, () => NOW) });
    await expect(p.postClip(request())).rejects.toThrow(/60 posts in the last hour/);
    expect(server.calls).toHaveLength(0);
    // an hour later the oldest have aged out
    const ok = poster(postizServer(), { audit: new SocialAudit(store.store, () => NOW + 60 * 60_000), now: () => NOW + 60 * 60_000 });
    await expect(ok.poster.postClip(request())).resolves.toBeTruthy();
    expect(AUDIT_MAX_ENTRIES).toBeGreaterThan(CREATE_CALLS_PER_HOUR);
  });

  it("waits Postiz's Retry-After once on a 429, then surfaces the error", async () => {
    const once = postizServer({ "POST /posts": (_call, n) => (n === 1 ? json({ message: "Too many requests" }, { status: 429, headers: { "Retry-After": "2" } }) : json([{ postId: "post-9", integration: "int-tt" }])) });
    const a = poster(once);
    await expect(a.poster.postClip(request())).resolves.toMatchObject({ postIds: [{ postId: "post-9" }], group: null });
    expect(a.sleeps).toEqual([2000]);
    expect(once.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"))).toHaveLength(2);
    expect(once.calls.filter((c) => c.url.endsWith("/upload"))).toHaveLength(1); // the upload is not repeated
    const twice = postizServer({ "POST /posts": () => json({ message: "Too many requests" }, { status: 429, headers: { "Retry-After": "1" } }) });
    const b = poster(twice);
    await expect(b.poster.postClip(request())).rejects.toMatchObject({ code: "rateLimited", status: 429 });
    expect(b.sleeps).toEqual([1000]);
    expect(twice.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"))).toHaveLength(2);
    // without Retry-After, or with an unreasonable one, no retry
    const bare = postizServer({ "POST /posts": () => new Response("", { status: 429 }) });
    const c = poster(bare);
    await expect(c.poster.postClip(request())).rejects.toMatchObject({ code: "rateLimited" });
    expect(c.sleeps).toEqual([]);
    const long = postizServer({ "POST /posts": () => json({}, { status: 429, headers: { "Retry-After": String(MAX_RETRY_WAIT_MS / 1000 + 1) } }) });
    const d = poster(long);
    await expect(d.poster.postClip(request())).rejects.toMatchObject({ code: "rateLimited" });
    expect(d.sleeps).toEqual([]);
    // a failed post leaves no audit line and the poster free again
    expect(await d.audit.recent()).toEqual([]);
    expect(d.poster.busy).toBe(false);
  });

  it("refuses a second clip while one is on its way, and says so", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = postizServer();
    const { poster: p } = poster(server, { uploadGate: gate });
    const first = p.postClip(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: { ...tiktok } }] }));
    expect(p.busy).toBe(true); // --- review fix (social-postiz) --- taken before the first await
    await new Promise((r) => setTimeout(r, 0));
    expect(p.busy).toBe(true);
    await expect(p.postClip(request({ clipId: "webm", channels: [{ id: "int-yt", platform: "youtube", text: "b", settings: { ...youtube } }] }))).rejects.toThrow(/already on its way/);
    release();
    await first;
    expect(p.busy).toBe(false);
    expect(server.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"))).toHaveLength(1);
  });

  // --- review fix (social-postiz) ---
  it("lets exactly one of two Approves made in the same tick through: one create call, the other refused, the cooldown kept", async () => {
    const server = postizServer();
    const { poster: p, audit } = poster(server);
    const r = request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: { ...tiktok } }] });
    const settled = await Promise.allSettled([p.postClip(r), p.postClip(r)]);
    expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ message: expect.stringMatching(/already on its way/) });
    expect(server.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"))).toHaveLength(1);
    expect(server.calls.filter((c) => c.url.endsWith("/upload"))).toHaveLength(1);
    expect(await audit.recent()).toHaveLength(1);
    expect(p.busy).toBe(false);
    // and the channel's 20-minute cooldown now holds for a third
    await expect(p.postClip(r)).rejects.toThrow(/every 20 minutes/);
    expect(server.calls.filter((c) => c.method === "POST" && c.url.endsWith("/posts"))).toHaveLength(1);
  });

  it("needs a stored key, and gives Postiz's own message when the create is refused", async () => {
    const server = postizServer({ "POST /posts": () => json({ message: ["posts.0.settings.privacy_level must be one of the allowed values"] }, { status: 400 }) });
    const { poster: p } = poster(server);
    await expect(p.postClip(request())).rejects.toMatchObject({ code: "badRequest", message: "posts.0.settings.privacy_level must be one of the allowed values" });
    const noKey = poster(postizServer());
    (noKey.poster as unknown as { deps: { client: () => null } }).deps.client = () => null;
    await expect(noKey.poster.postClip(request())).rejects.toThrow(/Paste the Postiz API key/);
  });
});

/* ------------------------------------------------------------------ outcomes, delete, settings, slots */

describe("outcomes and the service", () => {
  it("asks for the window days back and forward, and maps the rows newest first", async () => {
    expect(outcomeWindow(14, NOW)).toEqual({ startDate: "2026-10-04T12:00:00.000Z", endDate: "2026-11-01T12:00:00.000Z" });
    const server = postizServer();
    const list = await recentPosts(client(server), 14, NOW);
    expect(server.calls[0].url).toBe("https://api.postiz.com/public/v1/posts?startDate=2026-10-04T12%3A00%3A00.000Z&endDate=2026-11-01T12%3A00%3A00.000Z");
    expect(list).toEqual([
      { id: "post-2", channel: { id: "int-yt", name: "Gerald Shorts", platform: "youtube", picture: null }, state: "QUEUE", publishDate: "2026-10-19T10:00:00.000Z", releaseUrl: null, error: null, content: "second" },
      { id: "post-1", channel: { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: "https://cdn.postiz.example/tt.png" }, state: "PUBLISHED", publishDate: "2026-10-18T10:00:00.000Z", releaseUrl: "https://www.tiktok.com/@gerald/video/1", error: null, content: "first" },
      { id: "post-3", channel: null, state: "ERROR", publishDate: "2026-10-17T10:00:00.000Z", releaseUrl: null, error: "TikTok refused the video", content: "third" },
    ]);
  });

  it("serves posts, delete (with its audit line), channel settings and the next free slot through the service – nothing without a key", async () => {
    const server = postizServer();
    const store = memoryStore<never[]>();
    const audit = new SocialAudit(store.store, () => NOW);
    const { keys } = poster(server, { audit });
    const service = new SocialService(keys, () => NOW, audit);
    expect(await service.recentPosts()).toHaveLength(3);
    expect(server.calls.at(-1)!.url).toContain("/posts?startDate=2026-10-04");
    await service.deletePost("post-1");
    expect(server.calls.at(-1)).toMatchObject({ method: "DELETE", url: "https://api.postiz.com/public/v1/posts/post-1" });
    expect(await audit.recent()).toEqual([{ at: "2026-10-18T12:00:00.000Z", action: "deletePost", channels: [], postIds: ["post-1"], by: "user", clipId: null, when: null }]);
    expect(await service.channelSettings("int-bs")).toEqual({ identifier: "bluesky", maxLength: 300, settings: [] });
    expect(await service.slot("int-tt")).toEqual({ date: "2026-10-19T17:00:00.000Z" });
    expect(server.calls.at(-1)!.url).toBe("https://api.postiz.com/public/v1/find-slot/int-tt");
    const noSlot = postizServer({ "/find-slot/int-tt": () => json({}) });
    await expect(new SocialService(poster(noSlot).keys, () => NOW, audit).slot("int-tt")).rejects.toThrow(/did not name a free slot/);
    // without a key: an empty list, and the calls that change something refuse
    const empty = new PostizKeyStore({ settings: () => ({ baseUrl: "https://api.postiz.com", keySealed: "" }), setSettings: () => {}, secrets: new SecretBox(plainStorage), fetch: server.fetchImpl });
    const bare = new SocialService(empty, () => NOW, audit);
    expect(await bare.recentPosts()).toEqual([]);
    await expect(bare.deletePost("post-1")).rejects.toBeInstanceOf(PostizError);
    await expect(bare.slot("int-tt")).rejects.toMatchObject({ code: "unauthorized" });
    await expect(new SocialService(keys, () => NOW).deletePost("post-1")).rejects.toThrow(/audit log/);
  });

  it("keeps the audit log bounded and readable after a damaged file", async () => {
    const store = memoryStore<never[]>(["garbage", null, { at: "2026-10-18T11:00:00.000Z", action: "createPosts", channels: ["int-tt"], postIds: ["old"], by: "user", clipId: null, when: null }] as unknown as never[]);
    const audit = new SocialAudit(store.store, () => NOW);
    expect(await audit.recent()).toHaveLength(1);
    expect(await audit.lastCreateFor("int-tt")).toBe(Date.parse("2026-10-18T11:00:00.000Z"));
    expect(await audit.lastCreateFor("int-yt")).toBeNull();
    for (let i = 0; i < AUDIT_MAX_ENTRIES + 5; i++) await audit.record({ action: "deletePost", channels: [], postIds: [`p${i}`], clipId: null, when: null });
    expect((await audit.recent(AUDIT_MAX_ENTRIES + 10)).length).toBe(AUDIT_MAX_ENTRIES);
    expect(await audit.createCallsSince(NOW - 2 * 60 * 60_000)).toBe(0); // the old create aged out of the bounded file
  });

  // --- review fix (social-postiz) ---
  it("drops a hand-edited entry whose channels or post ids are not lists, so the guards cannot throw on it", async () => {
    const damaged = [
      { at: "2026-10-18T11:50:00.000Z", action: "createPosts", channels: "int-tt", postIds: ["x"], by: "user", clipId: null, when: null },
      { at: "2026-10-18T11:45:00.000Z", action: "createPosts", channels: ["int-tt"], postIds: null, by: "user", clipId: null, when: null },
      { at: "2026-10-18T11:40:00.000Z", action: "createPosts", channels: ["int-tt"], postIds: ["old"], by: "user", clipId: null, when: null },
    ];
    const audit = new SocialAudit(memoryStore<never[]>(damaged as unknown as never[]).store, () => NOW);
    expect(await audit.recent()).toHaveLength(1);
    await expect(audit.lastCreateFor("int-tt")).resolves.toBe(Date.parse("2026-10-18T11:40:00.000Z"));
    expect(await audit.createCallsSince(NOW - 60 * 60_000)).toBe(1);
  });
});

/* ------------------------------------------------------------------ the bridge */

describe("the phase-2 bridge channels", () => {
  const page = "app://jumpingballslive/en/simulator/";

  it("are in the contract's method table under the same `social` namespace", () => {
    expect(BRIDGE_METHODS["social.prepare"]).toBe("social:prepare");
    expect(BRIDGE_METHODS["social.post"]).toBe("social:post");
    expect(BRIDGE_METHODS["social.posts"]).toBe("social:posts");
    expect(BRIDGE_METHODS["social.postDelete"]).toBe("social:post-delete");
    expect(BRIDGE_METHODS["social.audit"]).toBe("social:audit");
    expect(BRIDGE_METHODS["social.channelSettings"]).toBe("social:channel-settings");
    expect(BRIDGE_METHODS["social.slot"]).toBe("social:slot");
  });

  it("checks the post request: the clip id, 1 to 20 channels with bounded text and plain-object settings, `when` in the future, the thumbnail", () => {
    const now = NOW;
    expect(checkSocialPostRequest(request(), now)).toBeNull();
    expect(checkSocialPostRequest(request({ when: "draft" }), now)).toBeNull();
    expect(checkSocialPostRequest(request({ when: "2026-10-18T12:00:01.000Z" }), now)).toBeNull();
    expect(checkSocialPostRequest(request({ when: "2026-10-18T12:00:00.000Z" }), now)).toMatch(/when/); // not in the future
    expect(checkSocialPostRequest(request({ when: "tomorrow" }), now)).toMatch(/when/);
    expect(checkSocialPostRequest(request({ when: "schedule" }), now)).toMatch(/when/);
    expect(checkSocialPostRequest(request({ clipId: "" }), now)).toMatch(/clipId/);
    expect(checkSocialPostRequest(request({ channels: [] }), now)).toMatch(/channels/);
    expect(checkSocialPostRequest(request({ channels: Array.from({ length: SOCIAL_MAX_CHANNELS + 1 }, (_, i) => ({ id: `c${i}`, platform: "x", text: "", settings: { __type: "x" } })) }), now)).toMatch(/channels/);
    expect(checkSocialPostRequest(request({ channels: Array.from({ length: SOCIAL_MAX_CHANNELS }, (_, i) => ({ id: `c${i}`, platform: "x", text: "", settings: { __type: "x" } })) }), now)).toBeNull();
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "x".repeat(5001), settings: { ...tiktok } }] }), now)).toMatch(/text/);
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "x".repeat(5000), settings: { ...tiktok } }] }), now)).toBeNull();
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: { privacy_level: "SELF_ONLY" } as never }] }), now)).toMatch(/__type/);
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: [] as never }] }), now)).toMatch(/plain object/);
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: Object.create({ __type: "tiktok" }) as never }] }), now)).toMatch(/plain object/);
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "tiktok", text: "a", settings: { __type: "tiktok", big: "x".repeat(20_000) } }] }), now)).toMatch(/too large/);
    expect(checkSocialPostRequest(request({ channels: [{ id: "", platform: "tiktok", text: "a", settings: { ...tiktok } }] }), now)).toMatch(/channel id/);
    // --- review fix (social-postiz) --- the same channel twice would make Postiz create two posts
    expect(checkSocialPostRequest(request({ channels: [...request().channels, { id: "int-tt", platform: "tiktok", text: "again", settings: { ...tiktok } }] }), now)).toMatch(/duplicate channel id/);
    expect(checkSocialPostRequest(request({ channels: [{ id: "int-tt", platform: "", text: "a", settings: { ...tiktok } }] }), now)).toMatch(/platform/);
    expect(checkSocialPostRequest(request({ thumbnailMs: 1500 }), now)).toBeNull();
    for (const bad of [-1, 1.5, "0"]) expect(checkSocialPostRequest(request({ thumbnailMs: bad as never }), now)).toMatch(/thumbnailMs/);
    for (const bad of [undefined, null, "x", []]) expect(checkSocialPostRequest(bad, now)).toMatch(/social\.post/);
    // through checkIpcArgs (the real clock: a time in 2099 is in the future)
    expect(checkIpcArgs(IPC.socialPost, [request({ when: "2099-01-01T00:00:00.000Z" })])).toBeNull();
    expect(checkIpcArgs(IPC.socialPost, [request({ when: "2001-01-01T00:00:00.000Z" })])).toMatch(/when/);
  });

  it("checks the ids, the day window and the audit limit, and runs social:slot through the guard", async () => {
    for (const channel of [IPC.socialPrepare, IPC.socialPostDelete, IPC.socialChannelSettings, IPC.socialSlot]) {
      expect(checkIpcArgs(channel, ["int-tt"])).toBeNull();
      expect(checkIpcArgs(channel, ["x".repeat(511)])).toBeNull();
      expect(checkIpcArgs(channel, [""])).toMatch(/id/);
      expect(checkIpcArgs(channel, ["x".repeat(512)])).toMatch(/id/);
      expect(checkIpcArgs(channel, [7])).toMatch(/id/);
    }
    for (const ok of [undefined, 1, 14, 90]) expect(checkIpcArgs(IPC.socialPosts, [ok])).toBeNull();
    for (const bad of [0, 91, 1.5, "14"]) expect(checkIpcArgs(IPC.socialPosts, [bad])).toMatch(/days/);
    for (const ok of [undefined, 1, 500, 1000]) expect(checkIpcArgs(IPC.socialAudit, [ok])).toBeNull();
    for (const bad of [0, 1001, -1, "5"]) expect(checkIpcArgs(IPC.socialAudit, [bad])).toMatch(/limit/);
    const server = postizServer();
    const audit = new SocialAudit(memoryStore<never[]>().store, () => NOW);
    const service = new SocialService(poster(server, { audit }).keys, () => NOW, audit);
    const handler = vi.fn((id: unknown) => service.slot(id as string));
    await expect(guarded(IPC.socialSlot as IpcChannel, handler, page, ["int-tt"])).resolves.toEqual({ date: "2026-10-19T17:00:00.000Z" });
    await expect(guarded(IPC.socialSlot as IpcChannel, handler, page, [""])).rejects.toThrow(/invalid arguments/);
    await expect(guarded(IPC.socialSlot as IpcChannel, handler, "https://evil.example/", ["int-tt"])).rejects.toThrow(/not from the app/);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
