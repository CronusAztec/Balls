import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { LibraryItem } from "@/lib/desktop/contract";
import { clipVideoKey } from "@/lib/desktop/autopilot"; // --- cut-reedit ---
import { editCutJobId } from "@/lib/clipEdit/propose"; // --- cut-reedit ---
import { publishTargets, type PublishClip as LibraryClip } from "@/lib/desktop/publish";
import { PUBLISH_LIBRARY_KEYS, offerPublishClip, publishClips, publishLibraryOf, resetPublishClips, setPublishClipGenes } from "@/lib/publish/clips";
import { notifyLibraryChanged, onLibraryChanged } from "@/lib/desktop/libraryChanged"; // --- cut-reedit ---
import { PublishController, type ControllerDeps } from "@/lib/publish/controller";
import { applyCopyToPublish, draftOfLibraryClip, publishPlatformOf, publishToAccounts, registerDesktopPublishTargets, shareLibraryClip, stageLibraryClip, type DesktopPublishLabels } from "@/lib/publish/desktopTargets";
import { PUBLISH_STORAGE_KEY } from "@/lib/publish/store";
import { emptyDraft } from "@/lib/publish/caption";
import type { FetchLike } from "@/lib/publish/youtube";
import { EntitlementRequiredError, type EntitlementDecision } from "@/lib/billing/guard"; // --- social-postiz ---
import { genesOfEditorCut, genesOfSavedFile } from "@/lib/insights/genes"; // --- insights ---
import { planSource } from "@/lib/desktop/queueSources"; // --- insights ---
import { planClip } from "@/lib/bot/planner"; // --- insights ---
import { RECIPES } from "@/lib/bot/playbook"; // --- insights ---
import { DEFAULT_CLIP_EDIT } from "@/lib/clipEdit/spec"; // --- insights ---
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- review fix (desktop-exe) --- The Windows app's Library publishes through the Publish feature: one click sends a clip to
 * the accounts ticked in the Publish block (the relay), or quick-shares it to its platform; the AI's post copy goes into the
 * Publish block's draft. Every network call against a mocked fetch.
 */

// --- social-postiz --- the Pro guard as a spy over the real one (the page's entitlement store answers "free" in a test)
const requireEntitlementMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/guard")>();
  requireEntitlementMock.mockImplementation(actual.requireEntitlement);
  return { ...actual, requireEntitlement: requireEntitlementMock };
});

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

function relayFetch(published: boolean) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url: String(url), method, body: init.body });
    if (url.endsWith("/api/me")) return json({ key: { id: "k1", label: "Team" }, platforms: { tiktok: true, instagram: true, youtube: true } });
    if (url.endsWith("/api/accounts")) return json({ accounts: [{ id: "a_tt", platform: "tiktok", name: "Tok", handle: "@tok" }] });
    if (url.endsWith("/api/publish") && method === "POST") return json({ jobId: "j1" }, { status: 202 });
    if (url.endsWith("/api/jobs/j1"))
      return json({ id: "j1", status: published ? "done" : "partial", items: [{ accountId: "a_tt", platform: "tiktok", status: published ? "published" : "failed", link: published ? "https://www.tiktok.com/@tok/video/1" : null, error: published ? null : "TikTok refused the clip" }] });
    throw new TypeError(`Failed to fetch ${method} ${url}`);
  });
  return { fetchImpl: fetchImpl as unknown as FetchLike, calls };
}

function controller(fetchImpl: FetchLike, stored: Record<string, unknown> | null, win: ControllerDeps["window"] = () => null) {
  const mem = new Map<string, string>();
  if (stored) mem.set(PUBLISH_STORAGE_KEY, JSON.stringify(stored));
  return new PublishController({ fetch: () => fetchImpl, window: win, storage: () => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }), now: () => Date.now(), envClientId: "", envRelayUrl: "" });
}

const item = (platform: string | null): LibraryItem =>
  ({
    id: "lib1",
    path: "C:/Videos/glass.mp4",
    fileName: "glass.mp4",
    bytes: 4,
    durationSec: 12,
    width: 1080,
    height: 1920,
    encoder: "h264_nvenc",
    createdAt: 1,
    exists: true,
    thumbnail: null,
    meta: { title: "Glass smash", mode: "glass", seed: 7, link: "https://x/en/simulator/?mode=glass", platform, hook: "Pip vs glass", caption: "Which floor breaks first?", hashtags: ["#glass", "#asmr"], queueJobId: null },
  }) as unknown as LibraryItem;

const clipOf = (it: LibraryItem): LibraryClip => ({ item: it, file: new File([new Uint8Array([1, 2, 3, 4])], "glass.mp4", { type: "video/mp4" }), title: it.meta.title, caption: it.meta.caption ?? "", hashtags: it.meta.hashtags });

const labels: DesktopPublishLabels = {
  accounts: "your accounts",
  share: (p) => `${p} (quick share)`,
  noAccounts: "NO_ACCOUNTS",
  someFailed: (failed, total) => `FAILED ${failed}/${total}`,
  busy: "BUSY",
  shared: (p, copied) => `SHARED ${p} ${copied}`,
};

const relayState = { relayProfiles: [{ id: "p1", url: "https://relay.example", key: "jbl_team", label: "Team" }], activeRelay: "p1", checked: ["relay:p1:a_tt"], visibility: "public" };

describe("the Library's Publish targets (desktop app)", () => {
  afterEach(() => resetPublishClips());

  it("registers one target for the ticked accounts and a quick share for the clip's own platform", () => {
    const off = registerDesktopPublishTargets(labels, { controller: controller(relayFetch(true).fetchImpl, null) });
    try {
      const targets = publishTargets();
      expect(targets.map((t) => [t.id, t.label])).toEqual([
        ["publish", "your accounts"],
        ["share-tiktok", "tiktok (quick share)"],
        ["share-instagram", "instagram (quick share)"],
        ["share-youtube", "youtube (quick share)"],
      ]);
      const offered = (preset: string | null) => targets.filter((t) => !t.available || t.available(item(preset))).map((t) => t.id);
      expect(offered("reels")).toEqual(["publish", "share-instagram"]);
      expect(offered("shorts")).toEqual(["publish", "share-youtube"]);
      expect(offered("tiktok")).toEqual(["publish", "share-tiktok"]);
      expect(offered(null)).toEqual(["publish", "share-tiktok"]);
    } finally {
      off();
    }
    expect(publishTargets()).toEqual([]);
    expect([publishPlatformOf("reels"), publishPlatformOf("shorts"), publishPlatformOf("tiktok"), publishPlatformOf(undefined)]).toEqual(["instagram", "youtube", "tiktok", "tiktok"]);
  });

  it("sends a Library clip to the accounts ticked in the Publish block in one click, with the clip's post copy", async () => {
    const { fetchImpl, calls } = relayFetch(true);
    const c = controller(fetchImpl, relayState);
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().relay.status).toBe("ok"));
    const result = await publishToAccounts(c, clipOf(item("tiktok")), labels);
    expect(result).toEqual({ url: "https://www.tiktok.com/@tok/video/1" });
    // The clip joined the Publish block (on show) with its post copy as the draft, and went up through the relay once.
    const s = c.getSnapshot();
    expect(publishClips().map((x) => [x.name, x.source])).toEqual([["glass.mp4", "file"]]);
    expect(s.drafts[s.clipId!]).toEqual(draftOfLibraryClip(clipOf(item("tiktok"))));
    const publish = calls.filter((x) => x.url.endsWith("/api/publish"));
    expect(publish).toHaveLength(1);
    const posts = JSON.parse(String((publish[0].body as FormData).get("posts")));
    expect(posts.tiktok.text).toBe("Which floor breaks first?\n\n#glass #asmr #fyp");
    expect(s.sends.map((i) => i.status)).toEqual(["published"]);
  });

  it("leaves the clip in the Publish block and says so when no account is ticked or a send fails", async () => {
    const shown = vi.fn();
    const none = controller(relayFetch(true).fetchImpl, null);
    await expect(publishToAccounts(none, clipOf(item("reels")), labels, { showPublish: shown })).rejects.toThrow("NO_ACCOUNTS");
    expect(shown).toHaveBeenCalledTimes(1);
    expect(publishClips()).toHaveLength(1);
    const failing = controller(relayFetch(false).fetchImpl, relayState);
    failing.start();
    await vi.waitFor(() => expect(failing.getSnapshot().relay.status).toBe("ok"));
    await expect(publishToAccounts(failing, clipOf(item("tiktok")), labels, { showPublish: shown })).rejects.toThrow("FAILED 1/1");
    expect(shown).toHaveBeenCalledTimes(2);
  });

  it("leaves a send on its way alone: a click while the Publish block is sending says so and keeps the clip on show", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const relay = relayFetch(true);
    // The relay takes the upload only once released: the Publish block's own send is still on its way meanwhile.
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith("/api/publish")) await gate;
      return relay.fetchImpl(url, init);
    };
    const c = controller(fetchImpl, relayState);
    c.start();
    await vi.waitFor(() => expect(c.getSnapshot().relay.status).toBe("ok"));
    c.addFile(new File([new Uint8Array([5])], "first.mp4", { type: "video/mp4" }));
    const onShow = c.getSnapshot().clipId!;
    c.setDraft(onShow, { ...emptyDraft(), caption: "The first clip" });
    const sending = c.sendSelected();
    await vi.waitFor(() => expect(c.getSnapshot().sending).toBe(true));
    const shown = vi.fn();
    await expect(publishToAccounts(c, clipOf(item("tiktok")), labels, { showPublish: shown })).rejects.toThrow("BUSY");
    expect(shown).toHaveBeenCalledTimes(1);
    // Nothing changed under the send: the same clip on show, the Library clip not added, one upload.
    expect(c.getSnapshot().clipId).toBe(onShow);
    expect(publishClips().map((x) => x.name)).toEqual(["first.mp4"]);
    release();
    await sending;
    expect(c.getSnapshot().sends.map((i) => i.status)).toEqual(["published"]);
    expect(relay.calls.filter((x) => x.url.endsWith("/api/publish"))).toHaveLength(1);
  });

  it("quick-shares to the clip's platform: caption copied, upload page in the browser, the file shown in its folder – no second download", async () => {
    const copied: string[] = [];
    const opened: string[] = [];
    const revealed: string[] = [];
    const created: string[] = [];
    // A document whose <video> cannot decode (the thumbnail read gives up at once); a download would create an <a>.
    const createElement = (tag: string) => {
      created.push(tag);
      const el: Record<string, unknown> = { removeAttribute: () => {}, load: () => {}, click: () => {} };
      Object.defineProperty(el, "src", { set: () => setTimeout(() => (el.onerror as (() => void) | null)?.(), 0) });
      return el;
    };
    const win = { navigator: { userAgent: "Electron", maxTouchPoints: 0 }, document: { createElement, body: { appendChild: () => {}, removeChild: () => {} } }, open: vi.fn() } as unknown as Window & typeof globalThis;
    const c = controller(relayFetch(true).fetchImpl, null, () => win);
    const result = await shareLibraryClip(c, clipOf(item("shorts")), "youtube", labels, {
      navigator: { clipboard: { writeText: async (t: string) => void copied.push(t) } },
      openUrl: (url) => opened.push(url),
      reveal: (it) => revealed.push(it.id),
    });
    expect(result).toEqual({ message: "SHARED youtube true" });
    expect(opened).toEqual(["https://www.youtube.com/upload"]);
    expect(copied).toEqual(["Glass smash\n\nWhich floor breaks first?\n\n#Shorts #glass #asmr"]);
    expect(revealed).toEqual(["lib1"]);
    expect(created).not.toContain("a"); // no <a download>: the clip is a file on disk already
    expect(c.getSnapshot().share).toMatchObject({ platform: "youtube", kind: "desktop", copied: true, opened: true, downloaded: false });
  });

  it("shows a Library clip already in the Publish block again instead of adding it twice, keeping the draft written there", async () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const first = stageLibraryClip(c, clipOf(item("tiktok")));
    // The AI's post copy goes into the draft of the clip on show; a second Library click keeps it.
    expect(applyCopyToPublish([{ platform: "tiktok", title: "AI title", caption: "AI caption", hashtags: ["#ai"] }], c)).toBe(true);
    c.addFile(new File([new Uint8Array([9])], "other.mp4", { type: "video/mp4" }));
    expect(c.getSnapshot().clipId).not.toBe(first);
    await expect(publishToAccounts(c, clipOf(item("tiktok")), labels)).rejects.toThrow("NO_ACCOUNTS");
    const s = c.getSnapshot();
    expect(s.clipId).toBe(first);
    expect(publishClips().filter((x) => x.name === "glass.mp4")).toHaveLength(1);
    expect(s.drafts[first]).toMatchObject({ title: "AI title", caption: "AI caption", hashtags: "#ai" });
    // Once the clip has left the block, the next click adds it anew with the Library's post copy.
    resetPublishClips();
    const again = stageLibraryClip(c, clipOf(item("tiktok")));
    expect(again).not.toBe(first);
    expect(c.getSnapshot().drafts[again]).toEqual(draftOfLibraryClip(clipOf(item("tiktok"))));
  });

  // --- cut-reedit --- a Library cut staged in the block is a cut there too: its "Edit for TikTok" opens it as it is
  it("stages a Library cut as a cut file and any other item as a plain clip", () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const master = stageLibraryClip(c, clipOf({ ...item("reels"), id: "lib-master", meta: { ...item("reels").meta, queueJobId: "job-1" } }));
    const cut = stageLibraryClip(c, clipOf({ ...item("tiktok"), id: "lib-cut", meta: { ...item("tiktok").meta, queueJobId: "job-1-cut" } }));
    const plain = stageLibraryClip(c, clipOf({ ...item(null), id: "lib-plain" }));
    const byId = (id: string) => publishClips().find((x) => x.id === id);
    expect(byId(master)?.cutFile).toBe(false);
    expect(byId(cut)?.cutFile).toBe(true);
    expect(byId(plain)?.cutFile).toBe(false);
  });

  // --- cut-reedit --- "Edit for TikTok" in the block hands the editor the staged item's job and copy (PublishSection's
  // `meta: editing.library`): the cut is saved as `<job>-cut` with the master's words, so the autopilot sees one video
  it("stages a Library clip with its job and copy, so a cut made in the block is the master's cut", () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const masterItem = { ...item("reels"), id: "lib-master-x", meta: { ...item("reels").meta, queueJobId: "job-x" } } as LibraryItem;
    const masterId = stageLibraryClip(c, clipOf(masterItem));
    const master = publishClips().find((x) => x.id === masterId);
    expect(master?.library).toEqual({ title: "Glass smash", link: "https://x/en/simulator/?mode=glass", caption: "Which floor breaks first?", hashtags: ["#glass", "#asmr"], queueJobId: "job-x", hook: "Pip vs glass" /* --- insights --- */ });
    // the editor's job rule on that meta: the master's cut, under the master's video key
    const cutJob = editCutJobId(master?.library?.queueJobId);
    expect(cutJob).toBe("job-x-cut");
    expect(clipVideoKey({ meta: { ...masterItem.meta, queueJobId: cutJob } })).toBe(clipVideoKey(masterItem));
    // a staged cut keeps its own job (a trim of it stays that cut), and a picked file has none
    const cutId = stageLibraryClip(c, clipOf({ ...masterItem, id: "lib-cut-x", meta: { ...masterItem.meta, queueJobId: "job-x-cut" } }));
    const cut = publishClips().find((x) => x.id === cutId);
    expect(editCutJobId(cut?.library?.queueJobId)).toBe("job-x-cut");
    c.addFile(new File([new Uint8Array([9])], "other.mp4", { type: "video/mp4" }));
    expect(publishClips().find((x) => x.name === "other.mp4")?.library).toBeNull();
    // the block's editor gets it, and the queue's and the editor's own cuts are offered with theirs
    const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    // (--- cut-reedit --- and a cut saved there refreshes the Desktop group's open Library)
    expect(read("src/components/simulator/sections/PublishSection.tsx")).toContain("desktop={desktop ? { bridge: desktop, meta: editing.library ?? undefined, onSaved: notifyLibraryChanged } : null}");
    // (--- insights --- the cut's whole Library meta as the Publish clip keeps it: publishLibraryOf, tested below)
    expect(read("src/components/simulator/desktop/useRenderQueue.ts")).toMatch(/source: "edit",[^\n]*library: publishLibraryOf\(cutMeta\) /);
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).toContain("library = publishLibraryOf(meta);");
    expect(dialog).toMatch(/source: "edit",[^\n]*, library \}\);/);
    expect(dialog).toMatch(/desktop\.onSaved\?\.\(\);/);
  });

  // --- cut-reedit --- a cut saved from the Publish block's editor is in the Desktop group's open Library at once
  it("refreshes the Desktop group's Library when the Publish block's editor saves a cut", () => {
    let reads = 0;
    const off = onLibraryChanged(() => (reads += 1));
    notifyLibraryChanged();
    expect(reads).toBe(1);
    off();
    notifyLibraryChanged();
    expect(reads).toBe(1);
    const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    // the Desktop group reads the Library again on the signal; the block's editor gives it as its onSaved
    expect(read("src/components/simulator/sections/DesktopSection.tsx")).toContain("useEffect(() => onLibraryChanged(refreshLibrary), [refreshLibrary]);");
    expect(read("src/components/simulator/sections/PublishSection.tsx")).toMatch(/onSaved: notifyLibraryChanged \}/);
  });

  // --- cut-reedit --- the render queue's master is the Publish clip a Windows app user meets most: it reaches the block with
  // its Library job and copy, so "Edit for TikTok" there saves `<job>-cut` with the master's words (one video for the autopilot)
  it("offers the render queue's master with its Library job and copy", () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const queue = read("src/components/simulator/desktop/useRenderQueue.ts");
    // the job handed to runJobs carries the same title, link, caption and hashtags as the master's LibraryMeta, and its job
    expect(queue).toMatch(/library: \{ title: job\.meta\.title \|\| job\.name, link: job\.meta\.link \?\? jobLink\(job, page\.locale\), caption: job\.meta\.caption, hashtags: job\.meta\.hashtags, queueJobId: job\.id, hook: job\.meta\.hook, genes: planned \},\s+\},\s+\]\);/);
    // --- insights --- (with the job's hook and genes until it is saved, then the saved genes)
    expect(queue).toMatch(/const planned = jobGenes\(job\);/);
    expect(queue).toMatch(/markDone\([^\n]*\);\n\s+setPublishClipGenes\(job\.id, genes\);/);
    expect(queue).toMatch(/title: job\.meta\.title \|\| job\.name,\s+mode: job\.settings\.mode,\s+seed: job\.seed,\s+link: job\.meta\.link \?\? jobLink\(job, page\.locale\),/);
    // the batch renderer offers a handed-in job's clip with it
    const batch = read("src/components/simulator/useBatchRender.ts");
    expect(batch).toMatch(/library\?: PublishClipLibrary;/);
    expect(batch).toMatch(/offerPublishClip\(\{[^\n]*source: customJob \? "bot" : "batch",[^\n]*library: customJob\?\.library \?\? null/);
    // so a cut of it in the block is saved under the master's job, and the autopilot folds the two
    const library = { title: "Glass smash", link: "https://x/en/simulator/?mode=glass", caption: "Which floor breaks first?", hashtags: ["#glass"], queueJobId: "job-q1" };
    const offered = offerPublishClip({ blob: new Blob(["x"], { type: "video/mp4" }), name: "job-q1", source: "bot", botClipId: "job-q1", library });
    expect(offered.library).toEqual(library);
    expect(offered.cutFile).toBe(false);
    const cutJob = editCutJobId(offered.library?.queueJobId);
    expect(cutJob).toBe("job-q1-cut");
    const master = { ...item("tiktok"), meta: { ...item("tiktok").meta, queueJobId: "job-q1" } } as LibraryItem;
    expect(clipVideoKey({ meta: { ...master.meta, queueJobId: cutJob } })).toBe(clipVideoKey(master));
  });

  // --- insights --- "Edit for TikTok" in the block saves a cut of the clip's genes (recipe, family, score), not the editor's own
  it("hands the Clip editor a Publish clip's hook and genes, so a cut made in the block keeps the clip's genes", () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const copy = (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot;
    const plan = planClip(RECIPES.find((r) => r.id === "pip-escape")!, 9, "tiktok", { copy, search: false });
    const genes = genesOfSavedFile(planSource(plan).meta!.genes!, { durationSec: 24, cut: "master" });
    const masterItem = { ...item("tiktok"), id: "lib-genes", meta: { ...item("tiktok").meta, hook: plan.hook, queueJobId: "job-g", genes } } as LibraryItem;
    const stagedId = stageLibraryClip(c, clipOf(masterItem));
    const staged = publishClips().find((x) => x.id === stagedId)!;
    expect(staged.library).toMatchObject({ hook: plan.hook, genes, queueJobId: "job-g" });
    // the editor's cut of it (PublishSection hands it `editing.library` as its meta): the clip's genes as a cut, its hook told apart
    const cutOf = (hook: string) => genesOfEditorCut(staged.library, { mode: "glass", durationSec: 11.5, copy: { hook, caption: null, hashtags: [] } });
    expect(cutOf("Will Pip make it?")).toMatchObject({ source: "plan", recipe: "pip-escape", family: plan.family, planScore: null, cut: "tiktok", durationSec: 11.5, hookKey: "custom" }); // (a cut keeps no score of its clip's)
    expect(cutOf(plan.hook).hookKey).toBe("recipes.pipEscape");
    // the pick keeps every key the Publish clip holds of a Library item's meta, and nothing else of it
    const full = { ...masterItem.meta, cut: DEFAULT_CLIP_EDIT, fanMadeBurned: true };
    expect(Object.keys(publishLibraryOf(full)).sort()).toEqual([...PUBLISH_LIBRARY_KEYS].sort());
    expect(publishLibraryOf({ title: "t", genes: undefined })).toEqual({ title: "t" });
    // the queue's master: offered with the job's genes when its export is done, then given the genes it was saved with
    const blob = new Blob(["x"], { type: "video/mp4" });
    const offered = offerPublishClip({ blob, name: "job-q2", source: "bot", library: { queueJobId: "job-q2", hook: plan.hook, genes: planSource(plan).meta!.genes } });
    const other = offerPublishClip({ blob, name: "job-q3", source: "bot", library: { queueJobId: "job-q3", genes: planSource(plan).meta!.genes } });
    setPublishClipGenes("job-q2", genes);
    expect(publishClips().find((x) => x.id === offered.id)?.library).toEqual({ queueJobId: "job-q2", hook: plan.hook, genes });
    expect(publishClips().find((x) => x.id === other.id)?.library?.genes).toEqual(planSource(plan).meta!.genes);
  });

  it("writes the AI's posts into the Publish block's draft, per platform – or says there is no clip yet", () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const items = [
      { platform: "reels", title: "Reel title", hook: "h", caption: "Reel caption", hashtags: ["#a", "#b"] },
      { platform: "shorts", title: "Short title", hook: "h", caption: "Short caption", hashtags: ["#c"] },
    ];
    expect(applyCopyToPublish(items, c)).toBe(false);
    c.addFile(new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" }));
    expect(applyCopyToPublish(items, c)).toBe(true);
    const s = c.getSnapshot();
    expect(s.drafts[s.clipId!]).toEqual({
      title: "Reel title",
      caption: "Reel caption",
      hashtags: "#a #b",
      overrides: { instagram: { title: "Reel title", caption: "Reel caption", hashtags: "#a #b" }, youtube: { title: "Short title", caption: "Short caption", hashtags: "#c" } },
    });
  });

  it("says in every language what the Library and the AI studio do with the Publish block (no 'once installed' left)", () => {
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, string>; Publish: Record<string, unknown> }[]) {
      for (const key of ["aiUseInPublish", "aiUsedInPublish", "aiPublishNoClip", "libTargetAccounts", "libTargetShare", "libPublishNoAccounts", "libPublishSomeFailed", "libPublishBusy", "libShared", "libSharedNoCopy"]) expect(typeof m.Desktop[key], key).toBe("string");
      expect(typeof m.Publish.appYouTube).toBe("string");
      expect(m.Desktop.libTargetShare).toContain("{platform}");
    }
    expect(en.Desktop.aiPublishHint).not.toMatch(/once the Publish feature is installed/);
    expect(en.Desktop.libPublishHint).not.toMatch(/once the Publish feature is installed/);
    expect(pl.Desktop.libPublishHint).not.toMatch(/po zainstalowaniu/);
    expect(es.Desktop.libPublishHint).not.toMatch(/cuando esté instalada/);
  });
});

/* --- social-postiz --- phase 2: "Post with Postiz" in the Library, only with a stored key, Pro-gated, opening the card */
describe("the Library's Postiz target", () => {
  afterEach(() => resetPublishClips());

  it("registers only when a Postiz key is stored, with its own button text and no need for the clip's bytes", () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const open = vi.fn();
    const postiz = { configured: false, label: "Postiz", button: "Post with Postiz", opened: "OPENED", onOpenPostizCard: open };
    let off = registerDesktopPublishTargets(labels, { controller: c, postiz });
    try {
      expect(publishTargets().map((t) => t.id)).toEqual(["publish", "share-tiktok", "share-instagram", "share-youtube"]);
    } finally {
      off();
    }
    off = registerDesktopPublishTargets(labels, { controller: c, postiz: { ...postiz, configured: true } });
    try {
      const targets = publishTargets();
      expect(targets.map((t) => t.id)).toEqual(["publish", "postiz", "share-tiktok", "share-instagram", "share-youtube"]);
      const target = targets.find((t) => t.id === "postiz")!;
      expect(target.label).toBe("Postiz");
      expect(target.button).toBe("Post with Postiz");
      expect(target.needsFile).toBe(false);
      expect(target.available).toBeUndefined(); // every clip, whatever platform it was rendered for
    } finally {
      off();
    }
    expect(publishTargets()).toEqual([]);
  });

  it("is Pro-gated: without an entitlement the click opens the Unlock dialog and the card never opens", async () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const open = vi.fn();
    const off = registerDesktopPublishTargets(labels, { controller: c, postiz: { configured: true, label: "Postiz", button: "Post with Postiz", opened: "OPENED", onOpenPostizCard: open } });
    try {
      const target = publishTargets().find((t) => t.id === "postiz")!;
      // the page's entitlement store answers "free" in a test: the guard refuses before the card opens
      await expect(target.publish(clipOf(item("tiktok")))).rejects.toBeInstanceOf(EntitlementRequiredError);
      expect(open).not.toHaveBeenCalled();
      // the other targets are gated the same way
      await expect(publishTargets().find((t) => t.id === "publish")!.publish(clipOf(item("tiktok")))).rejects.toBeInstanceOf(EntitlementRequiredError);
    } finally {
      off();
    }
  });

  it("opens the card for the clip once the guard passes", async () => {
    const c = controller(relayFetch(true).fetchImpl, null);
    const open = vi.fn();
    const grant: EntitlementDecision = { ok: true, feature: "publish", plan: "monthly", expiresAt: Date.now() + 60_000 };
    requireEntitlementMock.mockResolvedValueOnce(grant);
    const off = registerDesktopPublishTargets(labels, { controller: c, postiz: { configured: true, label: "Postiz", button: "Post with Postiz", opened: "OPENED", onOpenPostizCard: open } });
    try {
      const target = publishTargets().find((t) => t.id === "postiz")!;
      await expect(target.publish(clipOf(item("reels")))).resolves.toEqual({ message: "OPENED" });
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toMatchObject({ id: "lib1" });
      // nothing was staged in the Publish block and nothing was sent: the card does the posting after the user approves
      expect(publishClips()).toEqual([]);
    } finally {
      off();
    }
  });
});
