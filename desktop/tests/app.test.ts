import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_PREFS, resolvePrefs, restoreWindowState, sanitizePrefs } from "../src/prefs";
import { UpdateController, type UpdaterLike } from "../src/updater";
import { MENU, MENU_LABELS, menuLanguage } from "../src/menu";
import { MEDIA_EXTENSIONS, dialogFilters, filesInArgv, mediaKindOf, mimeOf } from "../src/media";
import { Library, uniquePath } from "../src/library";
import { RenderSaver } from "../src/render";
import { bundledFfmpegPath } from "../src/ffmpeg/run";
import { JSON_GBNF, checkLocalAi, jsonGrammar } from "../src/ai/local";
import { createRequire } from "module";
import type { EncoderProbe, RenderProgressEvent, SaveRenderRequest, UpdateStatus } from "@/lib/desktop/contract";

/* --- desktop-exe --- preferences, window state, the updater (never fails offline), menu, media, library and saving renders */

describe("preferences and window state", () => {
  it("keeps only valid preferences", () => {
    expect(sanitizePrefs({ preferHardware: false, aiProvider: "cloud", aiGpu: "turbo", evil: 1, outputFolder: 3 })).toEqual({ preferHardware: false, aiProvider: "cloud" });
    expect(resolvePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(resolvePrefs({ closeToTray: false }).closeToTray).toBe(false);
  });
  it("restores the window where it was, or centres it when that display is gone", () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(restoreWindowState({ x: 100, y: 80, width: 1200, height: 800, maximized: true }, [primary], primary)).toEqual({ x: 100, y: 80, width: 1200, height: 800, maximized: true });
    // The second monitor it was on is unplugged.
    expect(restoreWindowState({ x: 2500, y: 80, width: 1200, height: 800 }, [primary], primary)).toEqual({ x: 360, y: 120, width: 1200, height: 800, maximized: false });
    expect(restoreWindowState({ width: 99999, height: 10 }, [primary], primary)).toMatchObject({ width: 1920, height: 600 });
    expect(restoreWindowState("garbage", [primary], primary)).toMatchObject({ width: 1440, height: 920 });
  });
});

describe("auto-update", () => {
  function fakeUpdater(check: () => Promise<unknown>): UpdaterLike & { handlers: Map<string, (...a: never[]) => void> } {
    const handlers = new Map<string, (...a: never[]) => void>();
    return { handlers, autoDownload: false, autoInstallOnAppQuit: false, logger: undefined, on: (e, l) => handlers.set(e, l), checkForUpdates: check, quitAndInstall: () => {} };
  }
  it("never throws: offline, failing or disabled", async () => {
    const seen: UpdateStatus[] = [];
    const logs: string[] = [];
    const offline = new UpdateController(fakeUpdater(async () => ({})), { enabled: true, packaged: true, portable: false, online: () => false, log: (m) => logs.push(m), emit: (s) => seen.push(s) });
    await expect(offline.check()).resolves.toMatchObject({ state: "error", message: "offline" });
    const failing = new UpdateController(fakeUpdater(async () => Promise.reject(new Error("net::ERR_NAME_NOT_RESOLVED"))), { enabled: true, packaged: true, portable: false, online: () => true, log: (m) => logs.push(m), emit: () => {} });
    await expect(failing.check()).resolves.toMatchObject({ state: "error", message: "net::ERR_NAME_NOT_RESOLVED" });
    expect(logs.some((l) => l.includes("ERR_NAME_NOT_RESOLVED"))).toBe(true);
    const portable = new UpdateController(fakeUpdater(async () => ({})), { enabled: true, packaged: true, portable: true, online: () => true, log: () => {}, emit: () => {} });
    expect(portable.status).toMatchObject({ state: "disabled", message: "portable" });
    const dev = new UpdateController(null, { enabled: true, packaged: false, portable: false, online: () => true, log: () => {}, emit: () => {} });
    await expect(dev.check()).resolves.toMatchObject({ state: "disabled" });
  });
  it("follows electron-updater's events to 'ready'", async () => {
    const u = fakeUpdater(async () => ({}));
    const seen: UpdateStatus[] = [];
    const c = new UpdateController(u, { enabled: true, packaged: true, portable: false, online: () => true, log: () => {}, emit: (s) => seen.push(s) });
    expect(u.autoDownload).toBe(true);
    (u.handlers.get("update-available") as (i: { version: string }) => void)({ version: "1.2.0" });
    (u.handlers.get("download-progress") as (p: { percent: number }) => void)({ percent: 50 });
    (u.handlers.get("update-downloaded") as (i: { version: string }) => void)({ version: "1.2.0" });
    expect(seen.map((s) => s.state)).toEqual(["available", "downloading", "ready"]);
    expect(c.status).toMatchObject({ version: "1.2.0", progress: 1 });
  });
});

describe("menu and media", () => {
  it("has unique shortcuts and labels in every language", () => {
    const accelerators = MENU.flatMap((g) => g.entries).filter((e) => e !== "separator").map((e) => (e as { accelerator?: string }).accelerator).filter(Boolean);
    expect(new Set(accelerators).size).toBe(accelerators.length);
    const ids = [...MENU.map((g) => g.id), ...MENU.flatMap((g) => g.entries).filter((e) => e !== "separator").map((e) => (e as { id: string }).id)];
    for (const lang of ["en", "pl", "es"] as const) for (const id of ids) expect(MENU_LABELS[lang][id], `${lang}.${id}`).toBeTruthy();
    expect(Object.keys(MENU_LABELS.pl).sort()).toEqual(Object.keys(MENU_LABELS.en).sort());
    expect(Object.keys(MENU_LABELS.es).sort()).toEqual(Object.keys(MENU_LABELS.en).sort());
    expect(menuLanguage("es-MX")).toBe("es");
    expect(menuLanguage("fr")).toBe("en");
  });
  it("knows the media kinds and the files passed on the command line", () => {
    expect(mediaKindOf("C:/m/song.MP3")).toBe("song");
    expect(mediaKindOf("clip.webm")).toBe("video");
    expect(mediaKindOf("model.gguf")).toBe("model");
    expect(mediaKindOf("x.exe")).toBe("unknown");
    expect(mimeOf("a.wav")).toBe("audio/wav");
    expect(dialogFilters("midi")).toEqual([{ name: "midi", extensions: [...MEDIA_EXTENSIONS.midi] }]);
    const abs = path.resolve("/music/beat.wav");
    expect(filesInArgv(["app.exe", "--smoke", abs, "relative.wav", path.resolve("/x/evil.exe")])).toEqual([abs]);
    expect(bundledFfmpegPath("/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg")).toBe(process.platform === "win32" ? "/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg" : "/opt/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg");
  });
});

describe("saving renders and the library", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-render-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const meta = { title: "Glass", mode: "glass", seed: 7, link: "https://x/en/simulator/?mode=glass&seed=7", platform: "tiktok", hook: "Pip vs glass", caption: "Which floor?", hashtags: ["#physics"], queueJobId: "j1" };
  const request = (patch: Partial<SaveRenderRequest> = {}): SaveRenderRequest => ({ jobId: "j1", folder: path.join(dir, "out"), name: "glass smash", extension: "webm", data: new Uint8Array([1, 2, 3, 4]), durationSec: 10, transcode: null, meta, ...patch });
  const probe: EncoderProbe = { ffmpeg: { path: "ffmpeg", version: "7", bundled: true }, encoders: [], chosen: { h264: "h264_nvenc", hevc: null, av1: null }, error: null };

  it("saves the bytes to the output folder without a dialog and lists the clip", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const saver = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => null, probe: async () => probe, run: async () => ({ code: 0, stdout: "", stderr: "" }), library, emit: () => {}, log: () => {} });
    const first = await saver.save(request());
    const second = await saver.save(request());
    expect(first.path).toBe(path.join(dir, "out", "glass-smash.webm"));
    expect(second.path).toBe(path.join(dir, "out", "glass-smash-2.webm"));
    expect(fs.readFileSync(first.path)).toEqual(Buffer.from([1, 2, 3, 4]));
    const items = await library.list();
    expect(items.map((i) => [i.fileName, i.exists, i.meta.seed])).toEqual([
      ["glass-smash-2.webm", true, 7],
      ["glass-smash.webm", true, 7],
    ]);
    fs.rmSync(first.path);
    expect((await library.list()).find((i) => i.path === first.path)?.exists).toBe(false);
    const trashed: string[] = [];
    const left = await library.remove(items[0].id, true, async (f) => void trashed.push(f));
    expect(trashed).toEqual([second.path]);
    expect(left).toHaveLength(1);
    expect(uniquePath(dir, "a", "mp4", () => false)).toBe(path.join(dir, "a.mp4"));
  });

  it("transcodes on the chosen GPU encoder with progress, then removes the intermediate file", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const events: RenderProgressEvent[] = [];
    const runs: string[][] = [];
    const saver = new RenderSaver({
      outputFolder: () => dir,
      ffmpeg: () => "ffmpeg",
      probe: async () => probe,
      run: async (_bin, args, options) => {
        runs.push(args);
        const out = args[args.length - 1];
        if (args.includes("-progress")) {
          options?.onProgress?.(5_000_000);
          fs.writeFileSync(out, "mp4 bytes");
          return { code: 0, stdout: "", stderr: "" };
        }
        if (args.includes("-frames:v")) {
          fs.writeFileSync(out, "jpeg");
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "Duration: 00:00:10.02, start\n Stream #0:0: Video: h264, yuv420p, 1080x1920, 60 fps" };
      },
      library,
      emit: (e) => events.push(e),
      log: () => {},
    });
    const saved = await saver.save(request({ transcode: { codec: "h264", width: 1080, height: 1920, fps: 60, videoKbps: 10000, maxKbps: 12000, audioKbps: 192, sampleRate: 44100 } }));
    expect(saved).toMatchObject({ path: path.join(dir, "out", "glass-smash.mp4"), encoder: "h264_nvenc", durationSec: 10.02 });
    expect(runs[0]).toContain("h264_nvenc");
    expect(events).toContainEqual({ jobId: "j1", phase: "encoding", progress: 0.5 });
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual(["glass-smash.mp4"]); // the intermediate WebM is gone
    const [item] = await library.list();
    expect(item).toMatchObject({ width: 1080, height: 1920, encoder: "h264_nvenc" });
    expect(item.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("fails clearly without ffmpeg or without an encoder for the codec", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const spec = { codec: "hevc" as const, width: 1080, height: 1920, fps: 60, videoKbps: 1, maxKbps: 1, audioKbps: 128, sampleRate: 48000 };
    const none = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => null, probe: async () => probe, run: async () => ({ code: 0, stdout: "", stderr: "" }), library, emit: () => {}, log: () => {} });
    await expect(none.save(request({ transcode: spec }))).rejects.toThrow(/ffmpeg is not available/);
    const noHevc = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => "ffmpeg", probe: async () => probe, run: async () => ({ code: 0, stdout: "", stderr: "" }), library, emit: () => {}, log: () => {} });
    await expect(noHevc.save(request({ transcode: spec }))).rejects.toThrow(/No working HEVC encoder/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]);
  });

  // --- review fix (desktop-exe) --- a transcode that never finishes leaves no half-written MP4 that looks like a clip
  it("removes the half-written MP4 when the transcode is cancelled, times out or cannot start", async () => {
    const library = new Library(path.join(dir, "library.json"), path.join(dir, "thumbs"));
    const spec = { codec: "h264" as const, width: 1080, height: 1920, fps: 60, videoKbps: 1, maxKbps: 1, audioKbps: 128, sampleRate: 48000 };
    let started: () => void = () => {};
    const transcoding = new Promise<void>((resolve) => (started = resolve));
    const saver = new RenderSaver({
      outputFolder: () => dir,
      ffmpeg: () => "ffmpeg",
      probe: async () => probe,
      // ffmpeg writes part of the output, then the job is cancelled: the run rejects with an AbortError (as runFfmpeg does).
      run: (_bin, args, options) =>
        new Promise((_resolve, reject) => {
          fs.writeFileSync(args[args.length - 1], "half an mp4");
          options?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("ffmpeg cancelled"), { name: "AbortError" })));
          started();
        }),
      library,
      emit: () => {},
      log: () => {},
    });
    const saving = saver.save(request({ jobId: "job-1", name: "clip", transcode: spec }));
    await transcoding;
    expect(fs.readdirSync(path.join(dir, "out")).filter((f) => !f.startsWith("."))).toEqual(["clip.mp4"]);
    saver.cancel("job-1");
    await expect(saving).rejects.toThrow(/cancelled/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]); // neither the partial clip nor the intermediate file
    // A timeout or a failed spawn rejects the same way: nothing is left either, and a retry saves under the clip's own name.
    const failing = new RenderSaver({ outputFolder: () => dir, ffmpeg: () => "ffmpeg", probe: async () => probe, run: async (_bin, args) => { fs.writeFileSync(args[args.length - 1], "x"); throw new Error("ffmpeg timed out"); }, library, emit: () => {}, log: () => {} });
    await expect(failing.save(request({ name: "clip", transcode: spec }))).rejects.toThrow(/timed out/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual([]);
    expect(await library.list()).toEqual([]);
  });
});

// --- review fix (desktop-exe) --- the packaged app keeps node-llama-cpp's small llama/ files, and the smoke run checks the local AI starts
describe("packaging the local AI", () => {
  const builder = createRequire(import.meta.url)("../electron-builder.config.cjs") as { files: string[]; asarUnpack: string[] };

  it("ships llama/*.json and llama/grammars, leaving out only the source-build parts", () => {
    const llamaRules = builder.files.filter((f) => f.includes("node-llama-cpp/llama"));
    // node-llama-cpp's index reads llama/binariesGithubRelease.json while it loads: the whole folder must never be excluded.
    expect(llamaRules).not.toContain("!node_modules/node-llama-cpp/llama/**");
    expect(llamaRules.sort()).toEqual(
      ["!node_modules/node-llama-cpp/llama/gitRelease.bundle", "!node_modules/node-llama-cpp/llama/llama.cpp/**", "!node_modules/node-llama-cpp/llama/localBuilds/**", "!node_modules/node-llama-cpp/llama/xpack/**"].sort(),
    );
    for (const kept of ["binariesGithubRelease.json", "llama.cpp.info.json", "package.json", "grammars/json.gbnf"]) {
      const file = `node_modules/node-llama-cpp/llama/${kept}`;
      expect(llamaRules.some((rule) => file.startsWith(rule.slice(1).replace(/\*\*$/, ""))), file).toBe(false);
    }
  });

  it("reports the local AI ready when the module loads, its CPU backend starts and a grammar builds", async () => {
    const calls: string[] = [];
    const llama = {
      gpu: false as const,
      createGrammarForJsonSchema: async () => void calls.push("schema grammar"),
      getGrammarFor: async (t: string) => void calls.push(`grammar ${t}`),
      dispose: async () => void calls.push("dispose"),
    };
    const ok = await checkLocalAi(async () => ({ getLlama: async (o: unknown) => (calls.push(`getLlama ${JSON.stringify(o)}`), llama) }));
    expect(ok).toEqual({ ok: true, backend: "cpu", error: null });
    expect(calls).toEqual(['getLlama {"gpu":false,"build":"never"}', "schema grammar", "grammar json", "dispose"]);
  });

  it("builds the plain-JSON grammar from its own text where node-llama-cpp's grammars folder is out of reach (the asar archive)", async () => {
    const built: string[] = [];
    const llama = {
      getGrammarFor: async () => Promise.reject(new Error("Grammars folder not found")),
      createGrammar: async (o: { grammar: string }) => (built.push(o.grammar), { __grammar: true as const }),
    };
    await expect(jsonGrammar(llama)).resolves.toEqual({ __grammar: true });
    expect(built).toEqual([JSON_GBNF]);
    expect(built[0]).toMatch(/^root\s+::= object/);
    // The same text as node-llama-cpp's own json.gbnf, rule for rule (where the app's dependencies are installed).
    const ownPath = path.join(__dirname, "../node_modules/node-llama-cpp/llama/grammars/json.gbnf");
    const rules = (g: string) => g.replace(/#.*$/gm, "").replace(/\s+/g, " ").trim();
    if (fs.existsSync(ownPath)) expect(rules(JSON_GBNF)).toBe(rules(fs.readFileSync(ownPath, "utf8")));
  });

  it("fails the smoke check when the module cannot load (a package without llama/binariesGithubRelease.json)", async () => {
    const missing = await checkLocalAi(async () => {
      throw new Error("ENOENT, node_modules/node-llama-cpp/llama/binariesGithubRelease.json not found in app.asar");
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/binariesGithubRelease\.json/);
    const noBackend = await checkLocalAi(async () => ({ getLlama: async () => Promise.reject(new Error("no prebuilt binary")) }));
    expect(noBackend).toEqual({ ok: false, backend: null, error: "no prebuilt binary" });
  });
});
