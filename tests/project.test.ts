import { describe, expect, it } from "vitest";
import {
  PROJECT_EXTENSION,
  PROJECT_FORMAT,
  PROJECT_MAX_BYTES,
  PROJECT_VERSION,
  PROJECT_WARN_BYTES,
  assetToDataUrl,
  buildProject,
  dataUrlByteLength,
  dataUrlToAsset,
  defaultAssetName,
  formatBytes,
  looksLikeProjectFile,
  migrateProject,
  parseProject,
  projectFileName,
  projectMediaPatch,
  projectNameFromFileName,
  projectSizeCheck,
  resolveExtras,
  resolveProjectSettings,
  sanitizeProjectName,
  serializeProject,
  type ProjectAsset,
  type ProjectAssets,
} from "@/lib/project";
import { bytesToBase64 } from "@/lib/base64";
import { WALL_BREAK_SOUNDS } from "@/lib/audio/songs";
import { defaultSettings, settingsFromSearchParams, type SimulatorSettings } from "@/lib/settings";

function bytesOf(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x >>> 16;
  }
  return out;
}

const asset = (name: string, type: string, length: number, seed = 3): ProjectAsset => ({ name, type, bytes: bytesOf(length, seed) });

/** Captions, a roster, obstacles, keyframes and a Ball Drop board: everything a project has to carry in its settings. */
function richSettings(): SimulatorSettings {
  const s = settingsFromSearchParams(
    new URLSearchParams(
      "mode=shatter&g=700&s=450&cc=%23ff3366&top=Can+it+escape%3F&teams=Red*ff0000*%2CBlue*0000ff*&obs=p%3A0.2%2C-0.3%2C6%3Bb%3A-0.4%2C0.1%2C8&kf=g_0_0_4_1500*r_0_8_3_20&cap=tx*t*0*5*f*1*ffffff*000000*Hello%20world,cd*c*0*0*p*1.5*ffcc00**&theme=neon&dbc=12",
    ),
  );
  s.hitSoundMode = "sample";
  s.hitSampleId = "custom";
  s.sliceSong = true;
  s.backgroundType = "image";
  s.wallBreakSound = "blob:http://localhost:3000/5f1c9d1e";
  return s;
}

const MEDIA: ProjectAssets = {
  ballImage: asset("", "image/png", 300, 1),
  hitSample: asset("clap.wav", "audio/wav", 2000, 2),
  wallBreakSound: asset("boom.mp3", "audio/mpeg", 1500, 3),
  sliceSong: asset("song.mp3", "audio/mpeg", 5000, 4),
  musicBed: asset("bed.ogg", "audio/ogg", 4000, 5),
  midi: asset("tune.mid", "audio/midi", 120, 6),
  paintPicture: asset("cat.jpg", "image/jpeg", 800, 7),
  backgroundImage: asset("sky.webp", "image/webp", 600, 8),
};

describe("project files", () => {
  it("round-trip the settings, the extras and every medium", () => {
    const settings = richSettings();
    const file = buildProject({ name: "My clip", settings, extras: { ballEmoji: "🔥", melody: "fur-elise" }, assets: MEDIA, createdAt: "2026-09-29T12:00:00.000Z" });
    expect(file.format).toBe(PROJECT_FORMAT);
    expect(file.version).toBe(PROJECT_VERSION);
    expect(file.settings.wallBreakSound).toBeNull(); // a blob: URL only lives in the tab that made it
    expect(file.assets.ballImage?.name).toBe("ball-image.png");
    expect(file.assets.musicBed).toMatchObject({ name: "bed.ogg", type: "audio/ogg", size: 4000 });
    const text = serializeProject(file);
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.project;
    expect(p.name).toBe("My clip");
    expect(p.createdAt).toBe("2026-09-29T12:00:00.000Z");
    expect(p.extras).toEqual({ ballEmoji: "🔥", melody: "fur-elise" });
    expect(p.skipped).toEqual([]);
    expect(p.settings).toEqual({ ...settings, wallBreakSound: null });
    expect(p.settings.obstacles).toHaveLength(2);
    expect(p.settings.teams).toHaveLength(2);
    expect(p.settings.keyframes).toHaveLength(4);
    expect(p.settings.captions).toHaveLength(2);
    expect(p.settings.hitSampleId).toBe("custom"); // its clip came along
    expect(p.settings.backgroundType).toBe("image"); // its picture came along
    for (const [kind, original] of Object.entries(MEDIA)) {
      const loaded = p.assets[kind as keyof ProjectAssets]!;
      expect(loaded.type).toBe(original!.type);
      expect(Array.from(loaded.bytes)).toEqual(Array.from(original!.bytes));
    }
    // The wall-break upload came along, so loading it selects it: the patch leaves that sound alone and puts the rest back.
    expect(projectMediaPatch(p)).toEqual({ hitSoundMode: "sample", hitSampleId: "custom", sliceSong: true, backgroundType: "image" });
  });

  it("drop a custom hit sample and a picture background whose media are missing", () => {
    const file = buildProject({ name: "x", settings: richSettings() });
    const result = parseProject(serializeProject(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.assets).toEqual({});
    expect(result.project.settings.hitSampleId).toBe(defaultSettings().hitSampleId);
    expect(result.project.settings.backgroundType).toBe("gradient"); // Neon's own background
    expect(projectMediaPatch(result.project)).toMatchObject({ wallBreakSound: null, sliceSong: true });
  });

  it("keep the built-in wall-break sound and refuse any other address", () => {
    const builtIn = WALL_BREAK_SOUNDS[1].url;
    expect(resolveProjectSettings({ mode: "classic", wallBreakSound: builtIn }).wallBreakSound).toBe(builtIn);
    expect(resolveProjectSettings({ mode: "classic", wallBreakSound: "https://tracker.example/x.wav" }).wallBreakSound).toBeNull();
    expect(resolveProjectSettings({ mode: "classic", wallBreakSound: 42 }).wallBreakSound).toBeNull();
  });

  it("validate the settings like a preset: unknown keys dropped, wrong types defaulted, numbers clamped", () => {
    const s = resolveProjectSettings({ mode: "shatter", gravity: "heavy", ballSpeed: 99999, wallCount: -3, topText: 12, bottomText: "x".repeat(2000), rainbowBall: "yes", evil: "<script>", obstacles: "p:0,0,6", ballInteraction: "explode" });
    const d = defaultSettings("shatter");
    expect(s.mode).toBe("shatter");
    expect(s.gravity).toBe(d.gravity);
    expect(s.ballSpeed).toBe(800);
    expect(s.wallCount).toBe(1);
    expect(s.topText).toBe("");
    expect(s.bottomText).toHaveLength(500);
    expect(s.rainbowBall).toBe(false);
    expect(s.obstacles).toEqual([]);
    expect(s.ballInteraction).toBe(d.ballInteraction);
    expect("evil" in s).toBe(false);
    expect(Object.keys(s).sort()).toEqual(Object.keys(d).sort());
    expect(resolveProjectSettings({ mode: "nope" }).mode).toBe("classic");
    expect(resolveProjectSettings(null)).toEqual(defaultSettings("classic"));
  });

  it("refuse what is not a project, and projects of a newer version", () => {
    expect(parseProject("{not json")).toEqual({ ok: false, error: "not-json" });
    expect(parseProject("[]")).toEqual({ ok: false, error: "not-project" });
    expect(parseProject(JSON.stringify({ format: "something-else", version: 1, settings: {} }))).toEqual({ ok: false, error: "not-project" });
    expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 0, settings: {} }))).toEqual({ ok: false, error: "not-project" });
    expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 1 }))).toEqual({ ok: false, error: "not-project" });
    expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1, settings: {} }))).toEqual({ ok: false, error: "newer-version" });
    const minimal = parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 1, settings: { mode: "drop" } }));
    expect(minimal.ok && minimal.project.settings).toEqual(defaultSettings("drop"));
    expect(minimal.ok && minimal.project.extras).toEqual({ ballEmoji: null, melody: null });
  });

  it("migrate files up to the current version and refuse newer ones", () => {
    expect(migrateProject({ format: PROJECT_FORMAT, version: 1, name: "a" })).toEqual({ format: PROJECT_FORMAT, version: 1, name: "a" });
    expect(migrateProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1 })).toBeNull();
  });

  it("leave out damaged media and ignore media of unknown kinds", () => {
    const file = JSON.parse(serializeProject(buildProject({ name: "m", settings: defaultSettings(), assets: { musicBed: MEDIA.musicBed, paintPicture: MEDIA.paintPicture, midi: MEDIA.midi, ballImage: MEDIA.ballImage } })));
    file.assets.musicBed.data = "%%% not base64 %%%";
    file.assets.paintPicture.type = "text/html"; // a picture must be an image
    file.assets.midi.size = 9999; // does not match its data
    file.assets.hologram = { name: "x", type: "model/gltf", size: 1, data: "AA==" }; // a medium of a later version
    const result = parseProject(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.skipped.sort()).toEqual(["midi", "musicBed", "paintPicture"]);
    expect(Object.keys(result.project.assets)).toEqual(["ballImage"]);
  });

  it("warn above 25 MB and refuse above 100 MB", () => {
    expect(projectSizeCheck(0)).toBe("ok");
    expect(projectSizeCheck(PROJECT_WARN_BYTES)).toBe("ok");
    expect(projectSizeCheck(PROJECT_WARN_BYTES + 1)).toBe("warn");
    expect(projectSizeCheck(PROJECT_MAX_BYTES)).toBe("warn");
    expect(projectSizeCheck(PROJECT_MAX_BYTES + 1)).toBe("too-large");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(12 * 1024 + 100)).toBe("12 KB");
    expect(formatBytes(3.14 * 1024 * 1024)).toBe("3.1 MB");
    expect(formatBytes(31.6 * 1024 * 1024)).toBe("32 MB");
  });

  it("name files safely", () => {
    expect(sanitizeProjectName('  My <clip>: "final"/v2?  ')).toBe("My clip final v2");
    expect(sanitizeProjectName("..hidden")).toBe("hidden");
    expect(sanitizeProjectName(42)).toBe("");
    expect(Array.from(sanitizeProjectName("🔥".repeat(100)))).toHaveLength(60);
    expect(projectFileName("Gerald vs glass")).toBe(`Gerald vs glass${PROJECT_EXTENSION}`);
    expect(projectFileName("///")).toBe(`jumpingballslive-project${PROJECT_EXTENSION}`);
    expect(projectNameFromFileName("Gerald vs glass.jumpingballslive.json")).toBe("Gerald vs glass");
    expect(projectNameFromFileName("old.JSON")).toBe("old");
    expect(looksLikeProjectFile({ name: "a.jumpingballslive.json" })).toBe(true);
    expect(looksLikeProjectFile({ name: "blob", type: "application/json" })).toBe(true);
    expect(looksLikeProjectFile({ name: "song.mid", type: "audio/midi" })).toBe(false);
    expect(defaultAssetName("ballImage", "image/png")).toBe("ball-image.png");
    expect(defaultAssetName("musicBed", "")).toBe("music-bed.bin");
  });

  it("convert data: URLs both ways", () => {
    const picture = asset("p.png", "image/png", 1234, 9);
    const url = assetToDataUrl(picture);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrlByteLength(url)).toBe(1234);
    const back = dataUrlToAsset("p.png", url)!;
    expect(back.type).toBe("image/png");
    expect(Array.from(back.bytes)).toEqual(Array.from(picture.bytes));
    const svg = dataUrlToAsset("s.svg", "data:image/svg+xml,%3Csvg%2F%3E")!;
    expect(new TextDecoder().decode(svg.bytes)).toBe("<svg/>");
    expect(dataUrlToAsset("x", "https://example.com/a.png")).toBeNull();
    expect(dataUrlToAsset("x", "data:image/png;base64,***")).toBeNull();
    expect(dataUrlByteLength(`data:image/png;base64,${bytesToBase64(new Uint8Array(5))}`)).toBe(5);
  });

  it("keep only known melodies and short emoji", () => {
    expect(resolveExtras({ ballEmoji: " 😂 ", melody: "ode-to-joy" })).toEqual({ ballEmoji: "😂", melody: "ode-to-joy" });
    expect(resolveExtras({ ballEmoji: "a very long text", melody: "../../etc/passwd" })).toEqual({ ballEmoji: null, melody: null });
    expect(resolveExtras("junk")).toEqual({ ballEmoji: null, melody: null });
  });
});
