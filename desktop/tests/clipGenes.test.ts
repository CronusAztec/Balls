import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LibraryMeta, SocialAuditEntry, SocialPostRequest, SocialQueueItem } from "@/lib/desktop/contract";
import { sanitizeGenes, type ClipGenes } from "@/lib/insights/genes";
import { JsonFileStore } from "../src/journal";
import { Library, type StoredItem } from "../src/library";
import { SocialAudit } from "../src/social/audit";
import { ClipPoster } from "../src/social/posting";
import type { PostizClient } from "../src/social/postiz";
import { SocialQueue, sanitizeQueueItem } from "../src/social/queue";
import { toQueueProposals } from "@/lib/desktop/autopilot"; // --- insights --- (review fix) the autopilot's own words for a channel

/*
 * --- insights --- Clip genes in the app's main process (phase P2): the Library, the posting queue and the audit log sanitise
 * them on every write and every load, files written before 1.6.0 (no genes) load exactly as they were stored, and approving a
 * queued clip writes its genes, with the TikTok audience the card chose and the hashtag count and question of the text it
 * approved, into the post's audit line, where the post ids keep them after the Library file and the queue item are deleted
 * and the app restarts (the attribution ledger).
 */

const NOW = Date.parse("2026-10-26T12:00:00.000Z");

const GENES: ClipGenes = {
  v: 1,
  source: "plan",
  recipe: "pip-escape",
  family: "escape",
  mode: "classic",
  ending: "cliffhanger",
  bucket: "standard",
  durationSec: 21.5,
  melody: "fur-elise",
  hookKey: "recipes.pipEscape",
  hookChars: 24,
  hashtagCount: 6,
  captionQuestion: true,
  cut: "master",
  episode: 28,
  planScore: 86,
  checklist: { motion: 1, hook: 1, countdown: 1, payoff: 0.6, length: 1, sound: 1, ending: 1, series: 1, look: 1 },
  features: null,
  blueprintDigest: null,
  parent: null,
  tiktokPrivacy: null,
};

const JUNK = { v: 1, source: "hacker", recipe: "<script>alert(1)</script>", planScore: 1e9, hookChars: -4, cut: "director", tiktokPrivacy: "EVERYONE", extra: "x".repeat(10_000) };

const meta = (patch: Partial<LibraryMeta> = {}): LibraryMeta => ({ title: "Pip", mode: "classic", seed: 7, link: "https://jumpingballslive.com/en/simulator/?mode=classic&seed=7", platform: "tiktok", hook: "Can Pip escape the rings?", caption: "Will Pip make it?", hashtags: ["#pip"], queueJobId: "job-1", ...patch });

const request = (clipId: string): SocialPostRequest => ({
  clipId,
  channels: [
    { id: "int-tt", platform: "tiktok", text: "Will Pip make it? #pip", settings: { __type: "tiktok", privacy_level: "SELF_ONLY", comment: true, duet: false, stitch: false, brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: "DIRECT_POST", video_made_with_ai: true, autoAddMusic: "no" } },
    { id: "int-yt", platform: "youtube", text: "Pip vs the rings", settings: { __type: "youtube", title: "Pip vs the rings" } },
  ],
  when: "now",
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-genes-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (name: string) => path.join(dir, name);
const writeJson = (name: string, value: unknown) => fs.writeFileSync(file(name), JSON.stringify(value));
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(file(name), "utf8")) as T;

/** A stand-in Postiz that takes one upload and answers each create with a post id per channel. */
function fakePostiz() {
  const created: unknown[] = [];
  let n = 0;
  const client = {
    upload: async () => ({ id: "media-1", path: "https://cdn.postiz.example/media-1.mp4" }),
    createPosts: async (body: { posts: { integration: { id: string } }[] }) => {
      created.push(body);
      return body.posts.map((p) => ({ postId: `post-${++n}`, integration: p.integration.id, group: "grp-1" }));
    },
  } as unknown as PostizClient;
  return { client, created };
}

/** The main process's posting pieces over files in the temp folder, as main.ts wires them. */
function app() {
  const library = new Library(file("library.json"), file("thumbs"));
  const auditStore = new JsonFileStore<SocialAuditEntry[]>(file("social-audit.json"));
  const audit = new SocialAudit(auditStore, () => NOW);
  const postiz = fakePostiz();
  const poster = new ClipPoster({ library, client: () => postiz.client, ffmpeg: () => null, probe: async () => { throw new Error("no probe for an MP4"); }, run: async () => { throw new Error("no ffmpeg for an MP4"); }, audit, emit: () => {}, log: () => {}, now: () => NOW });
  let id = 0;
  const queue = new SocialQueue({ store: new JsonFileStore<SocialQueueItem[]>(file("social-queue.json")), poster, emit: () => {}, now: () => NOW, id: () => `q${++id}`, library });
  return { library, audit, poster, queue, postiz };
}

/** A clip in the Library: an MP4 on disk (it passes to Postiz as it is). */
async function addClip(library: Library, name: string, clipMeta: LibraryMeta) {
  fs.writeFileSync(file(name), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
  return library.add({ path: file(name), bytes: 8, durationSec: 21.5, width: 1080, height: 1920, encoder: "h264_nvenc", meta: clipMeta, thumbnailFile: null }, NOW);
}

describe("old files load unchanged", () => {
  it("reads a library.json, social-queue.json and social-audit.json written before genes as they were stored", async () => {
    const oldItem: StoredItem = { id: "old-1", path: file("old.mp4"), fileName: "old.mp4", bytes: 8, durationSec: 10, width: 1080, height: 1920, createdAt: 1, encoder: null, thumbnailFile: null, meta: meta({ cut: { startSec: 1, lengthSec: 9, zoom: 1.1, hook: "Watch", url: "jumpingballslive.com", cardSec: 1 } }) };
    writeJson("library.json", [oldItem]);
    const oldQueue: SocialQueueItem = { id: "q-old", clipId: "old-1", channels: [{ integrationId: "int-tt", platform: "tiktok", text: "t", settings: { __type: "tiktok" } }], when: "now", status: "posted", by: "user", origin: "ai", reason: "r", createdAt: new Date(NOW - 60_000).toISOString(), postIds: [{ channelId: "int-tt", postId: "post-old" }], error: null, log: [{ at: new Date(NOW - 60_000).toISOString(), text: "proposed by ai" }], video: "job:job-1" };
    writeJson("social-queue.json", [oldQueue]);
    const oldAudit: SocialAuditEntry = { at: new Date(NOW - 60_000).toISOString(), action: "createPosts", channels: ["int-tt"], postIds: ["post-old"], by: "user", clipId: "old-1", when: "now", video: "job:job-1" };
    writeJson("social-audit.json", [oldAudit, { at: oldAudit.at, action: "deletePost", channels: [], postIds: ["post-older"], by: "user", clipId: null, when: null }]);
    const { library, audit, queue } = app();
    expect(await library.get("old-1")).toEqual(oldItem);
    expect((await library.list())[0].meta).toEqual(oldItem.meta);
    expect((await library.list())[0].meta).not.toHaveProperty("genes");
    expect(await queue.list()).toEqual([oldQueue]);
    expect(sanitizeQueueItem(oldQueue)).toEqual(oldQueue);
    expect(await audit.recent()).toEqual(readJson<SocialAuditEntry[]>("social-audit.json"));
    // a write keeps the old lines as they were: no genes key appears on them
    await addClip(library, "new.mp4", meta({ queueJobId: "job-2" }));
    expect(readJson<StoredItem[]>("library.json")[1]).toEqual(oldItem);
    await audit.record({ action: "deletePost", channels: [], postIds: ["post-x"], clipId: null, when: null });
    expect(readJson<SocialAuditEntry[]>("social-audit.json").slice(1)).toEqual([oldAudit, { at: oldAudit.at, action: "deletePost", channels: [], postIds: ["post-older"], by: "user", clipId: null, when: null }]);
    expect(readJson<SocialAuditEntry[]>("social-audit.json")[0]).not.toHaveProperty("genes");
  });
});

describe("genes sanitised on every write and load", () => {
  it("keeps a record, repairs junk and drops what is not a record, in the Library, the queue and the audit", async () => {
    const stored: StoredItem = { id: "junk-1", path: file("junk.mp4"), fileName: "junk.mp4", bytes: 8, durationSec: 10, width: null, height: null, createdAt: 1, encoder: null, thumbnailFile: null, meta: { ...meta(), genes: JUNK as unknown as ClipGenes } };
    writeJson("library.json", [stored, { ...stored, id: "junk-2", meta: { ...meta(), genes: "plan" as unknown as ClipGenes } }, { ...stored, id: "good", meta: { ...meta(), genes: GENES } }]);
    const { library, audit } = app();
    const repaired = (await library.get("junk-1"))!.meta.genes!;
    expect(repaired).toMatchObject({ v: 1, source: null, recipe: null, planScore: 100, hookChars: 0, cut: null, tiktokPrivacy: null });
    expect(repaired).not.toHaveProperty("extra");
    expect((await library.get("junk-2"))!.meta).not.toHaveProperty("genes");
    expect((await library.get("good"))!.meta.genes).toEqual(GENES);
    // on write: what the page sent is stored sanitised
    const added = await addClip(library, "w.mp4", meta({ genes: { ...GENES, planScore: 400, mode: "x y" } }));
    expect(added.meta.genes).toEqual({ ...GENES, planScore: 100, mode: null });
    expect(readJson<StoredItem[]>("library.json")[0].meta.genes).toEqual({ ...GENES, planScore: 100, mode: null });
    // the queue file
    const item = sanitizeQueueItem({ id: "q1", clipId: "c", channels: [{ integrationId: "i", platform: "tiktok", text: "t" }], status: "proposed", createdAt: new Date(NOW).toISOString(), genes: JUNK })!;
    expect(item.genes).toMatchObject({ recipe: null, planScore: 100 });
    expect(sanitizeQueueItem({ ...item, genes: [GENES] })).not.toHaveProperty("genes");
    expect(sanitizeQueueItem({ ...item, genes: GENES })?.genes).toEqual(GENES);
    // the audit: on write and on load
    const line = await audit.record({ action: "createPosts", channels: ["int-tt"], postIds: ["p1"], clipId: "c", when: "now", genes: JUNK as unknown as ClipGenes });
    expect(line.genes).toMatchObject({ source: null, recipe: null });
    writeJson("social-audit.json", [{ ...line, genes: { v: 3 } }, { ...line, genes: { ...GENES, tiktokPrivacy: "self", melody: "Für Elise" } }]);
    const reloaded = await new SocialAudit(new JsonFileStore<SocialAuditEntry[]>(file("social-audit.json")), () => NOW).recent();
    expect(reloaded[0]).not.toHaveProperty("genes");
    expect(reloaded[1].genes).toEqual({ ...GENES, tiktokPrivacy: "self", melody: null });
  });
});

describe("the attribution ledger", () => {
  it("copies a queued clip's genes into the audit at approval, with TikTok's privacy, and keeps them after the clip and the item are deleted", async () => {
    const { library, queue, audit, postiz } = app();
    const clip = await addClip(library, "pip.mp4", meta({ genes: GENES }));
    // a proposal copies the clip's genes from the Library (never from the caller)
    const [proposed] = await queue.propose([{ clipId: clip.id, channels: [{ integrationId: "int-tt", platform: "tiktok", text: "Will Pip make it? #pip" }], when: "now", reason: "Evenings did well.", genes: { ...GENES, planScore: 1 } } as never], "ai");
    expect(proposed.genes).toEqual(GENES);
    const result = await queue.approve(proposed.id, request(clip.id));
    expect(result.postIds.map((p) => p.postId)).toEqual(["post-1", "post-2"]);
    expect(postiz.created).toHaveLength(1);
    const [line] = await audit.recent();
    expect(line).toMatchObject({ action: "createPosts", postIds: ["post-1", "post-2"], clipId: clip.id, video: "job:job-1" });
    expect(line.genes).toEqual({ ...GENES, tiktokPrivacy: "self", hashtagCount: 1 }); // (the TikTok text approved: "Will Pip make it? #pip")
    // the Library file and the queue item go; after a restart the post ids still name their genes
    await library.remove(clip.id, true, async (f) => fs.rmSync(f));
    await queue.remove(proposed.id);
    expect(await library.list()).toEqual([]);
    const restarted = app();
    expect(await restarted.queue.list()).toEqual([]);
    const ledger = (await restarted.audit.recent()).filter((e) => e.action === "createPosts");
    expect(ledger.flatMap((e) => e.postIds.map((postId) => [postId, e.genes]))).toEqual([
      ["post-1", { ...GENES, tiktokPrivacy: "self", hashtagCount: 1 }],
      ["post-2", { ...GENES, tiktokPrivacy: "self", hashtagCount: 1 }],
    ]);
  });

  it("writes the Library item's genes for a post approved on the card alone, and none for a clip without genes", async () => {
    const { library, poster, audit } = app();
    const withGenes = await addClip(library, "a.mp4", meta({ genes: { ...GENES, cut: "tiktok" }, queueJobId: "job-9-cut" }));
    await poster.postClip({ ...request(withGenes.id), channels: [{ ...request(withGenes.id).channels[0], settings: { ...request(withGenes.id).channels[0].settings, privacy_level: "PUBLIC_TO_EVERYONE" } }] });
    expect((await audit.recent())[0]).toMatchObject({ clipId: withGenes.id, video: "job:job-9", genes: { ...GENES, cut: "tiktok", tiktokPrivacy: "public", hashtagCount: 1 } });
    const without = await addClip(library, "b.mp4", meta({ queueJobId: null }));
    await poster.postClip({ ...request(without.id), channels: [request(without.id).channels[1]] });
    expect((await audit.recent())[0].clipId).toBe(without.id);
    expect((await audit.recent())[0]).not.toHaveProperty("genes");
    expect(sanitizeGenes((await audit.recent())[1].genes)).toEqual({ ...GENES, cut: "tiktok", tiktokPrivacy: "public", hashtagCount: 1 });
  });

  it("falls back to the Library item's genes for a queue item saved before genes", async () => {
    const first = app();
    const clip = await addClip(first.library, "c.mp4", meta({ genes: GENES }));
    writeJson("social-queue.json", [{ id: "q-old", clipId: clip.id, channels: [{ integrationId: "int-tt", platform: "tiktok", text: "t", settings: { __type: "tiktok" } }], when: "now", status: "proposed", by: "ai", origin: "ai", reason: "r", createdAt: new Date(NOW - 60_000).toISOString(), postIds: [], error: null, log: [] }]);
    const { queue, audit } = app();
    expect((await queue.list())[0]).not.toHaveProperty("genes");
    await queue.approve("q-old", { ...request(clip.id), channels: [{ ...request(clip.id).channels[0], settings: { ...request(clip.id).channels[0].settings, privacy_level: "MUTUAL_FOLLOW_FRIENDS" } }] });
    expect((await audit.recent())[0].genes).toEqual({ ...GENES, tiktokPrivacy: "friends", hashtagCount: 1 });
  });

  // --- insights --- (review fix) the copy genes of a post are the text it went out with: the autopilot writes each channel's
  // own text and hashtags (and the card may change them again), so the clip's caption at render time is not what was posted
  it("records the hashtag count and question of the text approved, not of the clip's own caption", async () => {
    const { library, queue, audit, postiz, poster } = app();
    const clip = await addClip(library, "ring.mp4", meta({ genes: GENES, caption: "Will Pip make it out?", hashtags: ["#pip", "#physics", "#satisfying", "#asmr", "#fyp", "#balls"] }));
    expect([GENES.hashtagCount, GENES.captionQuestion]).toEqual([6, true]);
    const channels = [{ id: "int-tt", platform: "tiktok", name: "tt", disabled: false }, { id: "int-yt", platform: "youtube", name: "yt", disabled: false }];
    const proposals = toQueueProposals([{ clipId: clip.id, channels: [{ integrationId: "int-yt", text: "Pip vs ring 3?", hashtags: ["#shorts"] }, { integrationId: "int-tt", text: "Ring 3 was close.", hashtags: ["#physics", "#satisfying"] }], when: "now", reason: "Evenings did well." }], channels as never, [clip]);
    const [item] = await queue.propose(proposals, "ai");
    const tiktokText = item.channels.find((c) => c.integrationId === "int-tt")!.text;
    expect(tiktokText).toBe("Ring 3 was close.\n\n#physics #satisfying");
    await queue.approve(item.id, { clipId: clip.id, channels: [{ ...request(clip.id).channels[1], text: "Pip vs ring 3?\n\n#shorts" }, { ...request(clip.id).channels[0], text: tiktokText }], when: "now" });
    expect(JSON.stringify(postiz.created)).toContain("Ring 3 was close.");
    expect((await audit.recent())[0].genes).toEqual({ ...GENES, hashtagCount: 2, captionQuestion: false, tiktokPrivacy: "self" });
    // a card the user edited before Approve: its words, a question and three hashtags
    const second = await addClip(library, "ring2.mp4", meta({ genes: GENES, queueJobId: "job-2" }));
    const tt = request(second.id).channels[0];
    await poster.postClip({ clipId: second.id, channels: [{ ...tt, id: "int-tt-2", text: "Which ring stops Pip? #a #b #c" }], when: "now" });
    expect((await audit.recent())[0].genes).toMatchObject({ hashtagCount: 3, captionQuestion: true, tiktokPrivacy: "self" });
  });
});
