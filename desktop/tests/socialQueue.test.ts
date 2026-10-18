import { describe, expect, it, vi } from "vitest";
import { IPC, SOCIAL_QUEUE_MAX, checkIpcArgs, type IpcChannel, type SocialPostRequest, type SocialProposalInput, type SocialQueueItem } from "@/lib/desktop/contract";
import { DEFAULT_AUTOPILOT, isHHMM, resolveAutopilot, sanitizeAutopilot } from "@/lib/desktop/autopilot";
import type { JsonFileStore } from "../src/journal";
import { QUEUE_LOG_MAX, SocialQueue, sanitizeQueueItem, trimQueue } from "../src/social/queue";
import { AutopilotStore } from "../src/social/autopilot";
import { guarded } from "../src/handlers";

/*
 * --- social-autopilot --- Phases 3–4 in the main process: the proposal queue (persisted and restored, duplicates merged, the
 * cap and the 14-day drop, approve running the poster exactly once and only with the card's request, skip / remove / edit,
 * the `social:queue` event on every change) and the autopilot's settings block (sanitised field by field, quiet hours as
 * "HH:MM"). A proposed item never reaches the poster: the only call to `postClip` in this file comes from `approve`.
 */

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

/** An in-memory stand-in for the crash-safe JSON file. */
function memoryStore<T>(initial: T | null = null) {
  let value: T | null = initial;
  const writes: T[] = [];
  const store = { read: async () => value, write: async (v: T) => void (writes.push(v), (value = v)) } as unknown as JsonFileStore<T>;
  return { store, writes, value: () => value };
}

function queue(options: { store?: ReturnType<typeof memoryStore<SocialQueueItem[]>>; now?: () => number; postClip?: (r: SocialPostRequest) => Promise<{ postIds: { channelId: string; postId: string }[]; group: string | null }> } = {}) {
  const store = options.store ?? memoryStore<SocialQueueItem[]>();
  const events: SocialQueueItem[][] = [];
  const postClip = vi.fn(options.postClip ?? (async (r: SocialPostRequest) => ({ postIds: r.channels.map((c, i) => ({ channelId: c.id, postId: `post-${i + 1}` })), group: "grp-1" })));
  let n = 0;
  const q = new SocialQueue({ store: store.store, poster: { postClip }, emit: (items) => events.push(items), now: options.now ?? (() => NOW), id: () => `q${++n}` });
  return { q, store, events, postClip };
}

const proposal = (clipId: string, channels: SocialProposalInput["channels"] = [{ integrationId: "int-tt", platform: "tiktok", text: "Which floor breaks first? #glass" }], when: SocialProposalInput["when"] = "2026-10-18T18:00:00.000Z"): SocialProposalInput => ({ clipId, channels, when, reason: "Evenings did well last week." });

const request = (clipId = "clip-1"): SocialPostRequest => ({
  clipId,
  channels: [{ id: "int-tt", platform: "tiktok", text: "Which floor breaks first? #glass", settings: { __type: "tiktok", privacy_level: "SELF_ONLY", comment: true, duet: false, stitch: false, brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: "DIRECT_POST", video_made_with_ai: true, autoAddMusic: "no" } }],
  when: "2026-10-18T18:00:00.000Z",
});

describe("the proposal queue", () => {
  it("proposes, persists, and restores on start (the whole list travels with every change)", async () => {
    const { q, store, events, postClip } = queue();
    const items = await q.propose([proposal("clip-1"), proposal("clip-2", [{ integrationId: "int-yt", platform: "youtube", text: "A glass drop", settings: { __type: "youtube", title: "Glass drop" } }], "now")], "ai");
    expect(items.map((i) => i.clipId)).toEqual(["clip-2", "clip-1"]); // newest first
    expect(items[1]).toMatchObject({ id: "q1", status: "proposed", by: "ai", when: "2026-10-18T18:00:00.000Z", reason: "Evenings did well last week.", postIds: [], error: null, createdAt: "2026-10-18T12:00:00.000Z" });
    expect(items[1].channels).toEqual([{ integrationId: "int-tt", platform: "tiktok", text: "Which floor breaks first? #glass", settings: { __type: "tiktok" } }]);
    expect(items[0].channels[0].settings).toEqual({ __type: "youtube", title: "Glass drop" });
    expect(items[1].log).toEqual([{ at: "2026-10-18T12:00:00.000Z", text: "proposed by ai" }]);
    expect(store.writes).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(items);
    expect(postClip).not.toHaveBeenCalled(); // a proposal never reaches Postiz
    // a new queue over the same file: the same items, announced
    const restored = queue({ store });
    const back = await restored.q.load();
    expect(back).toEqual(items);
    expect(restored.events).toEqual([items]);
  });

  it("restores defensively: damaged entries dropped, TikTok's user-only settings stripped, a half-finished approve marked failed", async () => {
    const good = (await queue().q.propose([proposal("clip-1")], "ai"))[0];
    const stored = memoryStore<SocialQueueItem[]>([
      good,
      { ...good, id: "q-approved", clipId: "clip-9", status: "approved" },
      { ...good, id: "q-tiktok", clipId: "clip-8", channels: [{ integrationId: "int-tt", platform: "tiktok", text: "t", settings: { __type: "tiktok", privacy_level: "PUBLIC_TO_EVERYONE", comment: true, title: "ok" } }] },
      { id: "no-channels", clipId: "c", channels: [], status: "proposed", createdAt: good.createdAt } as unknown as SocialQueueItem,
      { id: "bad-status", clipId: "c", channels: good.channels, status: "flying", createdAt: good.createdAt } as unknown as SocialQueueItem,
      "garbage" as unknown as SocialQueueItem,
    ]);
    const { q, postClip } = queue({ store: stored });
    const items = await q.load();
    expect(items.map((i) => i.id).sort()).toEqual(["q-approved", "q-tiktok", "q1"]);
    const approved = items.find((i) => i.id === "q-approved")!;
    expect(approved.status).toBe("failed");
    expect(approved.error).toMatch(/closed while this post was on its way/);
    expect(approved.log.at(-1)?.text).toMatch(/restored after a restart/);
    expect(items.find((i) => i.id === "q-tiktok")!.channels[0].settings).toEqual({ __type: "tiktok", title: "ok" });
    expect(postClip).not.toHaveBeenCalled();
    expect(sanitizeQueueItem(null)).toBeNull();
    expect(sanitizeQueueItem({ ...good, createdAt: "yesterday" })).toBeNull();
  });

  it("merges a duplicate proposal for the same clip and channel while one is proposed, and keeps the user's edits", async () => {
    const { q } = queue();
    await q.propose([proposal("clip-1")], "ai");
    let items = await q.propose([proposal("clip-1", [{ integrationId: "int-tt", platform: "tiktok", text: "Newer text #glass" }, { integrationId: "int-ig", platform: "instagram", text: "Reel text" }], "now")], "ai");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("q1");
    expect(items[0].channels.map((c) => [c.integrationId, c.text])).toEqual([
      ["int-tt", "Newer text #glass"],
      ["int-ig", "Reel text"],
    ]);
    expect(items[0].when).toBe("now");
    expect(items[0].log.at(-1)?.text).toMatch(/merged a new proposal \(tiktok, instagram\)/);
    // the user edits the text: a later proposal adds channels but leaves the user's text, time and reason alone
    await q.edit("q1", { channels: [{ integrationId: "int-tt", text: "My own words" }], when: "draft" });
    items = await q.propose([proposal("clip-1", [{ integrationId: "int-tt", platform: "tiktok", text: "AI again" }, { integrationId: "int-yt", platform: "youtube", text: "Shorts" }], "2026-10-19T10:00:00.000Z")], "ai");
    expect(items).toHaveLength(1);
    expect(items[0].by).toBe("user");
    expect(items[0].when).toBe("draft");
    expect(items[0].channels.map((c) => c.text)).toEqual(["My own words", "Reel text", "Shorts"]);
    // a skipped or posted item does not absorb a new proposal: a fresh item is made
    await q.skip("q1");
    items = await q.propose([proposal("clip-1")], "ai");
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ["q2", "proposed"],
      ["q1", "skipped"],
    ]);
    // another clip, same channel: its own item
    items = await q.propose([proposal("clip-2")], "user");
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ clipId: "clip-2", by: "user" });
  });

  it("keeps at most 200 items (finished ones go first) and drops proposals older than 14 days", async () => {
    let t = NOW - 300 * 60_000;
    const { q } = queue({ now: () => (t += 60_000) });
    for (let i = 0; i < 205; i++) await q.propose([proposal(`clip-${i}`)], "ai");
    let items = await q.list();
    expect(items).toHaveLength(SOCIAL_QUEUE_MAX);
    expect(items.some((i) => i.clipId === "clip-0")).toBe(false); // the oldest went
    expect(items[0].clipId).toBe("clip-204");
    // finished items are the first to go when the cap bites
    const skipped = items[100];
    await q.skip(skipped.id);
    await q.propose([proposal("clip-new")], "ai");
    items = await q.list();
    expect(items).toHaveLength(SOCIAL_QUEUE_MAX);
    expect(items.some((i) => i.id === skipped.id)).toBe(false);
    expect(items.some((i) => i.clipId === "clip-5")).toBe(true); // older than the skipped one, but still proposed
    // 14 days: a proposal that old is dropped on load; a posted one that old stays
    const old = { ...items[0], id: "old-proposed", clipId: "old", createdAt: new Date(NOW - 15 * DAY).toISOString() };
    const oldPosted: SocialQueueItem = { ...old, id: "old-posted", clipId: "old2", status: "posted" };
    const fresh = { ...old, id: "fresh", clipId: "fresh", createdAt: new Date(NOW - 13 * DAY).toISOString() };
    const restored = queue({ store: memoryStore<SocialQueueItem[]>([old, oldPosted, fresh]) });
    expect((await restored.q.load()).map((i) => i.id).sort()).toEqual(["fresh", "old-posted"]);
    expect(trimQueue([old, oldPosted, fresh], NOW).map((i) => i.id)).toEqual(["old-posted", "fresh"]);
    expect(trimQueue([old, oldPosted, fresh], NOW, 1).map((i) => i.id)).toEqual(["fresh"]);
  });

  it("approve runs the poster exactly once, with the card's request as it is, and marks the item posted", async () => {
    const { q, postClip, events } = queue();
    await q.propose([proposal("clip-1")], "ai");
    const r = request();
    const result = await q.approve("q1", r);
    expect(postClip).toHaveBeenCalledTimes(1);
    expect(postClip).toHaveBeenCalledWith(r); // the request the card produced, settings and all, untouched
    expect(result.postIds).toEqual([{ channelId: "int-tt", postId: "post-1" }]);
    const item = (await q.list())[0];
    expect(item).toMatchObject({ status: "posted", by: "user", postIds: [{ channelId: "int-tt", postId: "post-1" }], error: null, when: "2026-10-18T18:00:00.000Z" });
    expect(item.log.map((l) => l.text)).toEqual(["proposed by ai", "approved by the user for 1 channel(s), 2026-10-18T18:00:00.000Z", "posted: post-1"]);
    // the file saw "approved" first (a crash in between is restored as failed), then "posted"; every change was announced
    expect(events.map((e) => e[0].status)).toEqual(["proposed", "approved", "posted"]);
    // a second approve is refused and the poster is not called again
    await expect(q.approve("q1", r)).rejects.toThrow(/already posted/);
    expect(postClip).toHaveBeenCalledTimes(1);
  });

  it("approve refuses another clip's request, an unknown item and a skipped item without calling the poster; a failed post can be approved again", async () => {
    const { q, postClip } = queue({ postClip: vi.fn().mockRejectedValueOnce(new Error("Postiz: 413")).mockResolvedValue({ postIds: [{ channelId: "int-tt", postId: "p2" }], group: null }) });
    await q.propose([proposal("clip-1"), proposal("clip-2")], "ai");
    await expect(q.approve("q1", request("clip-2"))).rejects.toThrow(/another clip/);
    await expect(q.approve("nope", request())).rejects.toThrow(/not in the queue/);
    await q.skip("q2");
    await expect(q.approve("q2", request("clip-2"))).rejects.toThrow(/already skipped/);
    expect(postClip).not.toHaveBeenCalled();
    // the poster fails: the item is failed with the error, and Approve may run again
    await expect(q.approve("q1", request())).rejects.toThrow(/413/);
    let item = (await q.list()).find((i) => i.id === "q1")!;
    expect(item).toMatchObject({ status: "failed", error: "Postiz: 413" });
    await q.approve("q1", request());
    item = (await q.list()).find((i) => i.id === "q1")!;
    expect(item).toMatchObject({ status: "posted", error: null, postIds: [{ channelId: "int-tt", postId: "p2" }] });
    expect(postClip).toHaveBeenCalledTimes(2);
  });

  it("edit changes the text, the settings (never TikTok's choices) and the time and marks the text the user's; skip and remove", async () => {
    const { q, postClip, events } = queue();
    await q.propose([proposal("clip-1", [{ integrationId: "int-tt", platform: "tiktok", text: "a" }, { integrationId: "int-yt", platform: "youtube", text: "b" }])], "ai");
    let items = await q.edit("q1", { channels: [{ integrationId: "int-yt", text: "better", settings: { title: "A title", privacy_level: "PUBLIC_TO_EVERYONE", comment: true } }], when: null });
    expect(items[0].by).toBe("user");
    expect(items[0].when).toBeNull();
    expect(items[0].channels).toEqual([
      { integrationId: "int-tt", platform: "tiktok", text: "a", settings: { __type: "tiktok" } },
      { integrationId: "int-yt", platform: "youtube", text: "better", settings: { __type: "youtube", title: "A title" } },
    ]);
    expect(items[0].log.at(-1)?.text).toBe("edited by the user");
    items = await q.skip("q1");
    expect(items[0].status).toBe("skipped");
    await expect(q.edit("q1", { when: "now" })).rejects.toThrow(/already skipped/);
    await expect(q.skip("q1")).rejects.toThrow(/already skipped/);
    items = await q.remove("q1");
    expect(items).toEqual([]);
    await expect(q.edit("q1", { when: "now" })).rejects.toThrow(/not in the queue/);
    expect(events).toHaveLength(4);
    expect(postClip).not.toHaveBeenCalled();
    // the log is bounded
    const { q: q2 } = queue();
    await q2.propose([proposal("clip-1")], "ai");
    for (let i = 0; i < 30; i++) await q2.edit("q1", { when: i % 2 ? "now" : "draft" });
    expect((await q2.list())[0].log).toHaveLength(QUEUE_LOG_MAX);
  });

  it("keeps the origin of a proposal through an edit and an approval (the daily budget counts the planner's, not the user's)", async () => {
    const { q, store } = queue();
    await q.propose([proposal("clip-1")], "ai");
    await q.propose([proposal("clip-2")], "user");
    let items = await q.edit("q1", { channels: [{ integrationId: "int-tt", text: "Edited by hand" }] });
    expect(items.find((i) => i.id === "q1")).toMatchObject({ by: "user", origin: "ai" });
    expect(items.find((i) => i.id === "q2")).toMatchObject({ by: "user", origin: "user" });
    await q.approve("q1", request("clip-1"));
    items = await q.list();
    expect(items.find((i) => i.id === "q1")).toMatchObject({ status: "posted", by: "user", origin: "ai" });
    // an older file without the field: the planner's text that the user edited is counted as the user's (never over-counted)
    const legacy = (store.value() ?? []).map(({ origin: _origin, ...rest }) => rest);
    const { q: restored } = queue({ store: memoryStore<SocialQueueItem[]>(legacy as unknown as SocialQueueItem[]) });
    expect((await restored.list()).map((i) => [i.id, i.origin])).toEqual([["q2", "user"], ["q1", "user"]]);
  });

  it("reads the file once: a propose that lands while the first read is pending is not undone by it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stored: SocialQueueItem[] = [];
    const writes: SocialQueueItem[][] = [];
    const store = { read: async () => (await gate, stored), write: async (v: SocialQueueItem[]) => void writes.push(v) } as unknown as JsonFileStore<SocialQueueItem[]>;
    let n = 0;
    const q = new SocialQueue({ store, poster: { postClip: vi.fn() }, emit: () => undefined, now: () => NOW, id: () => `q${++n}` });
    const loading = q.load();
    const proposing = q.propose([proposal("clip-1")], "ai");
    release();
    await Promise.all([loading, proposing]);
    expect((await q.list()).map((i) => i.id)).toEqual(["q1"]);
    expect(writes.at(-1)?.map((i) => i.id)).toEqual(["q1"]);
  });

  it("approve refuses while another clip is on its way, before the item is marked approved", async () => {
    const postClip = vi.fn();
    const q = new SocialQueue({ store: memoryStore<SocialQueueItem[]>().store, poster: { postClip, busy: true }, emit: () => undefined, now: () => NOW, id: () => "q1" });
    await q.propose([proposal("clip-1")], "ai");
    await expect(q.approve("q1", request("clip-1"))).rejects.toThrow(/already on its way/);
    expect(postClip).not.toHaveBeenCalled();
    expect((await q.get("q1"))?.status).toBe("proposed");
  });

  it("remove refuses an item that is on its way to Postiz", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { q } = queue({ postClip: async () => (await gate, { postIds: [], group: null }) });
    await q.propose([proposal("clip-1")], "ai");
    const approving = q.approve("q1", request());
    await new Promise((r) => setTimeout(r, 0));
    await expect(q.remove("q1")).rejects.toThrow(/on its way/);
    release();
    await approving;
    expect((await q.remove("q1")).length).toBe(0);
  });
});

describe("the autopilot's settings", () => {
  it("sanitises a patch field by field: unknown keys and wrong types dropped, numbers clamped, quiet hours as HH:MM", () => {
    expect(sanitizeAutopilot(null)).toEqual({});
    expect(sanitizeAutopilot([1])).toEqual({});
    expect(sanitizeAutopilot({ enabled: "yes", perDay: "3", quietFrom: "22", quietTo: "8:00", language: "de", proposeHours: "6", nope: 1, channels: "int-tt" })).toEqual({});
    expect(sanitizeAutopilot({ enabled: true, perDay: 9, quietFrom: "23:30", quietTo: "07:05", language: "pl", proposeHours: 0.2, channels: ["int-tt", "int-tt", 5, "", "int-yt"], lastPlannedAt: "2026-10-18T10:00:00Z" })).toEqual({
      enabled: true,
      perDay: 5,
      quietFrom: "23:30",
      quietTo: "07:05",
      language: "pl",
      proposeHours: 1,
      channels: ["int-tt", "int-yt"],
      lastPlannedAt: "2026-10-18T10:00:00.000Z",
    });
    expect(sanitizeAutopilot({ perDay: 0, proposeHours: 100, lastPlannedAt: "not a time" })).toEqual({ perDay: 1, proposeHours: 48 });
    expect(sanitizeAutopilot({ lastPlannedAt: null })).toEqual({ lastPlannedAt: null });
    expect(sanitizeAutopilot({ perDay: Number.NaN, proposeHours: Number.POSITIVE_INFINITY })).toEqual({});
    for (const ok of ["00:00", "08:00", "23:59", "12:05"]) expect(isHHMM(ok), ok).toBe(true);
    for (const bad of ["24:00", "8:00", "08:60", "0800", "", "08:00:00", 8]) expect(isHHMM(bad), String(bad)).toBe(false);
  });

  it("resolves stored settings over the defaults, with the app's language, and the store keeps the sanitised result", () => {
    expect(resolveAutopilot(undefined)).toEqual(DEFAULT_AUTOPILOT);
    expect(DEFAULT_AUTOPILOT).toMatchObject({ enabled: false, channels: [], perDay: 1, quietFrom: "22:00", quietTo: "08:00", proposeHours: 6, lastPlannedAt: null });
    expect(resolveAutopilot({ enabled: true, perDay: 2, quietFrom: "25:00" }, "es")).toEqual({ ...DEFAULT_AUTOPILOT, language: "es", enabled: true, perDay: 2 });
    expect(resolveAutopilot("garbage", "pl").language).toBe("pl");
    let stored: unknown = { language: "en", perDay: 2 };
    const log: string[] = [];
    const store = new AutopilotStore({ settings: () => stored, setSettings: (s) => (stored = s), defaultLanguage: "pl", log: (_l, m) => log.push(m) });
    expect(store.get()).toEqual({ ...DEFAULT_AUTOPILOT, language: "en", perDay: 2 });
    const next = store.set({ enabled: true, channels: ["int-tt"], quietFrom: "21:00", quietTo: "09:00", bogus: 1, perDay: 7 });
    expect(next).toEqual({ ...DEFAULT_AUTOPILOT, language: "en", enabled: true, channels: ["int-tt"], quietFrom: "21:00", quietTo: "09:00", perDay: 5 });
    expect(stored).toEqual(next);
    expect(log).toEqual(["autopilot on: 1 channel(s), 5 a day, quiet 21:00–09:00, every 6 h (it only proposes)"]);
    expect(store.set({ lastPlannedAt: "2026-10-18T12:00:00.000Z" }).lastPlannedAt).toBe("2026-10-18T12:00:00.000Z");
    expect(log).toHaveLength(1); // only an on/off change is logged
  });
});

describe("the queue's bridge channels", () => {
  const page = "app://jumpingballslive/en/simulator/";
  it("check their arguments before the handler runs: proposals bounded and free of TikTok's choices, approve with the card's request", async () => {
    const handler = vi.fn(async () => "ok");
    const ok: SocialProposalInput = proposal("clip-1", [{ integrationId: "int-tt", platform: "tiktok", text: "t", settings: { __type: "tiktok", title: "x" } }], "2027-01-01T10:00:00.000Z");
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[ok], "ai"])).resolves.toBe("ok");
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[ok], "bot"])).rejects.toThrow(/by must be/);
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[], "ai"])).rejects.toThrow(/1 to 5/);
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[ok, ok, ok, ok, ok, ok], "ai"])).rejects.toThrow(/1 to 5/);
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[{ ...ok, channels: [{ ...ok.channels[0], settings: { __type: "tiktok", privacy_level: "SELF_ONLY" } }] }], "ai"])).rejects.toThrow(/privacy_level.*never proposed/);
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[{ ...ok, when: "2020-01-01T00:00:00.000Z" }], "ai"])).rejects.toThrow(/when must be/);
    await expect(guarded(IPC.socialQueuePropose as IpcChannel, handler, page, [[{ ...ok, reason: "x".repeat(301) }], "ai"])).rejects.toThrow(/reason/);
    expect(checkIpcArgs(IPC.socialQueuePropose, [[{ ...ok, when: null }], "user"])).toBeNull();
    expect(checkIpcArgs(IPC.socialQueuePropose, [[{ ...ok, channels: [ok.channels[0], ok.channels[0]] }], "ai"])).toMatch(/duplicate channel/);
    const future = { ...request("clip-1"), when: "2027-01-01T10:00:00.000Z" }; // (the check reads the real clock)
    expect(checkIpcArgs(IPC.socialQueueApprove, ["q1", future])).toBeNull();
    expect(checkIpcArgs(IPC.socialQueueApprove, ["q1", request("clip-1")])).toMatch(/when must be/); // a time that has passed
    expect(checkIpcArgs(IPC.socialQueueApprove, ["", future])).toMatch(/approve\(id, request\)/);
    expect(checkIpcArgs(IPC.socialQueueApprove, ["q1", { ...future, channels: [] }])).toMatch(/channels/);
    expect(checkIpcArgs(IPC.socialQueueEdit, ["q1", { when: "draft", channels: [{ integrationId: "int-tt", text: "t" }] }])).toBeNull();
    expect(checkIpcArgs(IPC.socialQueueEdit, ["q1", { channels: [{ integrationId: "int-tt", settings: { comment: true } }] }])).toMatch(/comment.*chosen on the card/);
    expect(checkIpcArgs(IPC.socialQueueEdit, ["q1", { status: "posted" }])).toMatch(/unknown field "status"/);
    expect(checkIpcArgs(IPC.socialQueueSkip, ["q1"])).toBeNull();
    expect(checkIpcArgs(IPC.socialQueueRemove, [""])).toMatch(/id/);
    expect(checkIpcArgs(IPC.socialAutopilotSet, [{ enabled: true }])).toBeNull();
    expect(checkIpcArgs(IPC.socialAutopilotSet, [["enabled"]])).toMatch(/patch/);
    expect(checkIpcArgs(IPC.socialQueueList, [])).toBeNull();
    expect(checkIpcArgs(IPC.socialAutopilotGet, [])).toBeNull();
    await expect(guarded(IPC.socialQueueList as IpcChannel, handler, "https://evil.example/", [])).rejects.toThrow(/not from the app/);
  });
});
