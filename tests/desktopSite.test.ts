import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { DOWNLOADS_URL, PORTABLE_ASSET, SETUP_ASSET, latestAssetUrl, versionedAssetNames } from "@/lib/desktop/release";
import { extensionOfName, mediaKindOfName } from "@/lib/desktop/mediaKinds";
import { postText, publishTargets, registerPublishTarget } from "@/lib/desktop/publish";
import { bridgeChatModel } from "@/lib/desktop/ai/bridgeModel";
import type { DesktopApi, DesktopEventMap } from "@/lib/desktop/contract";

/* --- desktop-exe --- the site's side of the Windows app: messages, download links, media kinds, the publish extension point and the bridge chat model */

type Tree = { [k: string]: string | Tree };
function flat(o: Tree, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));
}

describe("Desktop messages", () => {
  const keys = (m: unknown) => flat((m as { Desktop: Tree }).Desktop).sort();
  it("has the same keys in English, Polish and Spanish", () => {
    expect(keys(pl)).toEqual(keys(en));
    expect(keys(es)).toEqual(keys(en));
  });
  it("has every key the Desktop group, the download page and the landing button use", () => {
    const root = path.join(__dirname, "..", "src");
    const files = [
      ...fs.readdirSync(path.join(root, "components/simulator/desktop")).map((f) => path.join(root, "components/simulator/desktop", f)),
      path.join(root, "components/simulator/sections/DesktopSection.tsx"),
      path.join(root, "app/[locale]/download/page.tsx"),
    ].filter((f) => f.endsWith(".tsx"));
    const all = new Set(keys(en));
    const used = new Set<string>();
    for (const file of files) for (const m of fs.readFileSync(file, "utf8").matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((k) => !all.has(k))).toEqual([]);
    // The landing button and the navbar / footer link read the small DesktopLink namespace (every page hands it to the client).
    // --- site-redesign --- the landing button's labels come from the hero (a server component) as props.
    const link = new Set(Object.keys((en as unknown as { DesktopLink: Record<string, string> }).DesktopLink));
    const linkUsed: string[] = [];
    for (const f of ["Hero.tsx", "Navbar.tsx", "Footer.tsx"]) for (const m of fs.readFileSync(path.join(root, "components/site", f), "utf8").matchAll(/\bdesktop\("([A-Za-z0-9_.]+)"/g)) linkUsed.push(m[1]);
    expect(new Set(linkUsed)).toEqual(link);
    expect(linkUsed.length).toBeGreaterThanOrEqual(3);
    expect(linkUsed.filter((k) => !link.has(k))).toEqual([]);
    for (const m of [pl, es] as unknown as { DesktopLink: Record<string, string> }[]) expect(Object.keys(m.DesktopLink).sort()).toEqual([...link].sort());
    // Keys built at run time: every status, tab, preset, codec, task and update state.
    for (const group of ["status", "tab", "preset", "codec", "aiTask", "aiTaskHint", "aiPlaceholder", "update", "queueSource", "open", "ending", "requirements", "features"]) expect(Object.keys((en.Desktop as unknown as Record<string, Tree>)[group]).length).toBeGreaterThan(1);
  });
  // --- desktop-autorelease --- the update banner's Later and its note while a render runs, and the download page's version line
  it("has the update banner's and the download page's new texts in every language", () => {
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, unknown>; DesktopAiFix: Record<string, unknown> }[]) {
      for (const key of ["updateLater", "updateWaitRender", "appRestartUpdate", "checksums"]) expect(typeof m.Desktop[key], key).toBe("string");
      expect(m.DesktopAiFix.downloadVersion).toContain("{version}");
    }
    const page = fs.readFileSync(path.join(__dirname, "..", "src", "app", "[locale]", "download", "page.tsx"), "utf8");
    expect(page).toContain('fix("downloadVersion", { version: DESKTOP_VERSION })');
  });
  // The repository is private: no text sends a visitor to GitHub for the downloads, the update source or the release notes.
  it("does not send anyone to GitHub for downloads, updates or release notes", () => {
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, string>; DesktopAiFix: Record<string, string> }[]) {
      for (const key of ["setupBody", "appAutoUpdate", "smartScreenBody", "privacyBody", "checksums"]) expect(m.Desktop[key], key).not.toMatch(/GitHub Releases|GitHubie|en GitHub|public source|publicznego kodu|código público/);
      expect(m.Desktop.allReleases).toBeUndefined();
      expect(m.DesktopAiFix.downloadWhatsNew).toBeUndefined();
    }
    const page = fs.readFileSync(path.join(__dirname, "..", "src", "app", "[locale]", "download", "page.tsx"), "utf8");
    expect(page).not.toMatch(/github\.com|DESKTOP_REPO|RELEASES_URL|LATEST_RELEASE_URL/);
  });
});

describe("download links", () => {
  it("point at the downloads repository with fixed and versioned names, and the app updates from the same place", () => {
    expect(DOWNLOADS_URL).toBe("https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download");
    expect(latestAssetUrl(SETUP_ASSET)).toBe("https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/JumpingBallsLive-Setup.exe");
    expect(latestAssetUrl(PORTABLE_ASSET)).toBe("https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/JumpingBallsLive-portable.exe");
    expect(versionedAssetNames("1.2.0")).toEqual({ setup: "JumpingBallsLive-Setup-1.2.0.exe", portable: "JumpingBallsLive-1.2.0-portable.exe" });
    // electron-builder names the artifacts the same way.
    const config = fs.readFileSync(path.join(__dirname, "..", "desktop", "electron-builder.config.cjs"), "utf8");
    expect(config).toContain('artifactName: "JumpingBallsLive-Setup-${version}.${ext}"');
    expect(config).toContain('artifactName: "JumpingBallsLive-${version}-portable.${ext}"');
    const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "desktop.yml"), "utf8");
    expect(workflow).toContain(SETUP_ASSET);
    expect(workflow).toContain(PORTABLE_ASSET);
    // electron-updater reads latest.yml from the same place (the generic provider on the downloads repository's latest release)
    expect(config).toContain('publish: [{ provider: "generic", url: updateUrl }]');
    expect(config).toContain('(process.env.JBL_UPDATE_URL || "https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download")');
    expect(config).not.toMatch(/provider: "github"/);
    // and the built config really says so (what electron-builder writes into the app's app-update.yml)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const built = require("../desktop/electron-builder.config.cjs") as { publish: { provider: string; url: string }[] };
    expect(built.publish).toEqual([{ provider: "generic", url: DOWNLOADS_URL }]);
  });
});

describe("media kinds, publish extension point and the bridge chat model", () => {
  it("sorts dropped files by extension", () => {
    expect(mediaKindOfName("Song.MP3")).toBe("song");
    expect(mediaKindOfName("clip.mov")).toBe("video");
    expect(mediaKindOfName("tune.mid")).toBe("midi");
    expect(mediaKindOfName("ball.webp")).toBe("image");
    expect(mediaKindOfName("my.jumpingballslive.json")).toBe("project");
    expect(mediaKindOfName("model.gguf")).toBe("model");
    expect(mediaKindOfName("readme")).toBe("unknown");
    expect(extensionOfName("a.b.C")).toBe("c");
  });
  it("registers publish targets and writes the post text", () => {
    expect(publishTargets()).toEqual([]);
    const off = registerPublishTarget({ id: "yt", label: "YouTube", publish: async () => ({ url: "https://youtu.be/x" }) });
    expect(publishTargets().map((t) => t.id)).toEqual(["yt"]);
    off();
    expect(publishTargets()).toEqual([]);
    expect(postText({ title: "T", caption: "Which ring?", hashtags: ["#a", "#b"] })).toBe("Which ring?\n\n#a #b");
    expect(postText({ title: "T", caption: null, hashtags: [] })).toBe("T");
  });
  it("streams the app's tokens for its own request and cancels in the app", async () => {
    const listeners: ((e: DesktopEventMap["aiToken"]) => void)[] = [];
    const cancelled: string[] = [];
    let resolveChat: (v: { text: string; provider: "local"; model: string; cancelled: boolean }) => void = () => {};
    const bridge = {
      on: (_e: string, l: (e: DesktopEventMap["aiToken"]) => void) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
      ai: {
        chat: (req: { requestId: string }) =>
          new Promise((resolve) => {
            resolveChat = resolve as typeof resolveChat;
            listeners.forEach((l) => l({ requestId: "other", text: "x" }));
            listeners.forEach((l) => l({ requestId: req.requestId, text: "{}" }));
          }),
        cancel: async (id: string) => void cancelled.push(id),
      },
    } as unknown as Pick<DesktopApi, "ai" | "on">;
    const model = bridgeChatModel(bridge);
    const tokens: string[] = [];
    const reply = model.complete([{ role: "user", content: "hi" }], { onToken: (t) => tokens.push(t) });
    resolveChat({ text: "{}", provider: "local", model: "m", cancelled: false });
    await expect(reply).resolves.toBe("{}");
    expect(tokens).toEqual(["{}"]);
    expect(listeners).toHaveLength(0);
    const controller = new AbortController();
    const stopped = model.complete([{ role: "user", content: "hi" }], { signal: controller.signal });
    controller.abort();
    resolveChat({ text: "", provider: "local", model: "m", cancelled: true });
    await expect(stopped).rejects.toThrow(/cancelled/);
    expect(cancelled).toHaveLength(1);
  });
});

describe("publish targets snapshot", () => {
  it("returns the same array until the targets change (useSyncExternalStore needs a stable snapshot)", () => {
    const a = publishTargets();
    expect(publishTargets()).toBe(a);
    const off = registerPublishTarget({ id: "relay", label: "Relay", publish: async () => {} });
    const b = publishTargets();
    expect(b).not.toBe(a);
    expect(publishTargets()).toBe(b);
    off();
  });
});

// --- low-findings-2 --- the studio reads the updater's status when it mounts, never checks: the app's quiet schedule checks 8 s
// after launch (a manual check at every start doubled it and showed "error" on an offline start); the GPU panel's button and the
// Help menu keep the manual check
describe("the desktop studio's update status", () => {
  it("reads the status on mount without a check, keeps listening to the status event, and checks only on the user's click", () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", file), "utf8");
    const section = read("sections/DesktopSection.tsx");
    const mount = section.slice(section.indexOf("bridge.prefs"), section.indexOf('return bridge.on("update", setUpdate);') + 40);
    expect(mount).toContain("bridge.update.status");
    expect(mount).not.toMatch(/update\.check\(/);
    expect(mount).toContain('bridge.on("update", setUpdate)');
    expect(read("desktop/GpuPanel.tsx")).toMatch(/onClick=\{\(\) => void bridge\.update\.check\(\)\}/);
    // and the status line of the update banner reads without a dash in every language
    for (const m of [en, pl, es]) for (const key of ["available", "ready"]) expect((m.Desktop.update as Record<string, string>)[key]).not.toMatch(/ – | — |;/);
  });
});
