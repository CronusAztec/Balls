import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@/lib/desktop/contract";
import { publishTargets, type PublishClip as LibraryClip } from "@/lib/desktop/publish";
import { publishClips, resetPublishClips } from "@/lib/publish/clips";
import { PublishController, type ControllerDeps } from "@/lib/publish/controller";
import { applyCopyToPublish, draftOfLibraryClip, publishPlatformOf, publishToAccounts, registerDesktopPublishTargets, shareLibraryClip, stageLibraryClip, type DesktopPublishLabels } from "@/lib/publish/desktopTargets";
import { PUBLISH_STORAGE_KEY } from "@/lib/publish/store";
import type { FetchLike } from "@/lib/publish/youtube";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- review fix (desktop-exe) --- The Windows app's Library publishes through the Publish feature: one click sends a clip to
 * the accounts ticked in the Publish block (the relay), or quick-shares it to its platform; the AI's post copy goes into the
 * Publish block's draft. Every network call against a mocked fetch.
 */

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
      for (const key of ["aiUseInPublish", "aiUsedInPublish", "aiPublishNoClip", "libTargetAccounts", "libTargetShare", "libPublishNoAccounts", "libPublishSomeFailed", "libShared", "libSharedNoCopy"]) expect(typeof m.Desktop[key], key).toBe("string");
      expect(typeof m.Publish.appYouTube).toBe("string");
      expect(m.Desktop.libTargetShare).toContain("{platform}");
    }
    expect(en.Desktop.aiPublishHint).not.toMatch(/once the Publish feature is installed/);
    expect(en.Desktop.libPublishHint).not.toMatch(/once the Publish feature is installed/);
    expect(pl.Desktop.libPublishHint).not.toMatch(/po zainstalowaniu/);
    expect(es.Desktop.libPublishHint).not.toMatch(/cuando esté instalada/);
  });
});
