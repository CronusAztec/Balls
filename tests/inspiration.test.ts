import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, SHORT_MAX_SEC, STILLS_HOST, checkQuery, checkVideoUrl, cleanText, hasNumbers, isPrivateHost, mergeMeta, parseJsonLines, platformOfHost, rankVideos, searchTarget, shortsFeedUrl, shortsFeedUrls, stillsAspect, videoFileName, videoIdOfUrl, videoKey, videoMetaOf, videoStills, ytDownloadArgs, ytErrorLines, ytInfoArgs, ytListArgs, type VideoMeta } from "@/lib/agentKit/videoSources";
import {
  LEVERS,
  LOOP_MODES,
  MIN_VIDEOS_FOR_ADVICE,
  OUR_LOUDNESS_LUFS,
  OUR_SHORTEST_CLIP_SEC,
  GENERIC_THEMES,
  MIN_THEME_VIDEOS,
  THEMES,
  TITLE_FORMATS,
  buildInspirationReport,
  clipTraits,
  datasetAppend,
  inTheme,
  inspirationMarkdown,
  mdText,
  median,
  ranks,
  recommendations,
  runFolderName,
  spearman,
  stillsColour,
  themeShares,
  titleNumber,
  titleSummary,
  titleWords,
  topCount,
  traitSummaries,
} from "@/lib/agentKit/inspiration";
import { IMAGE_DEMUXERS, SAMPLE_BYTES, STILL_DEMUXERS, VIDEO_DEMUXERS, frameArgs, frameTimes, hookTimes, sheetArgs, sheetGrid, stillArgs, stillSampleArgs } from "@/lib/videoAnalysis/ffmpegArgs";
import type { VideoFeatures } from "@/lib/videoAnalysis/features";
import { LOUDNESS_TARGET_LUFS } from "@/lib/audio/loudness";
import { RANGES, defaultSettings, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS } from "@/lib/physics/types";
import { BLUEPRINT_CATALOG_IDS } from "@/lib/blueprint/catalog";
import { defaultCaption } from "@/lib/captions";

// --- inspiration --- The inspiration tools' pure halves (trending, fetch-video, frames, inspire; analyse with a url: the
// owner wants agents to learn from other creators' trending and viral simulation videos): the link check, yt-dlp's command
// lines and the parsers of what it prints, on recorded yt-dlp output (tests/fixtures/ytdlp/: real output, trimmed, channel
// names replaced), the frames' ffmpeg lines and the report's maths. The tools themselves: tests/inspirationCli.test.ts.

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "ytdlp");
const lines = (file: string) => parseJsonLines(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
const SEARCH = lines("search.jsonl");
const SHORTS = lines("shorts.jsonl");
const PAGES = lines("pages.jsonl");
const TIKTOK = JSON.parse(fs.readFileSync(path.join(FIXTURES, "tiktok-page.json"), "utf8")) as Record<string, unknown>;
/** The clock the ages are measured on: 26 October 2026. */
const NOW = Date.UTC(2026, 9, 26);

const meta = (info: Record<string, unknown>, source: VideoMeta["source"], detailed = false, link?: string) => videoMetaOf(info, { source, nowMs: NOW, detailed, link }) as VideoMeta;

describe("video links (--- inspiration ---)", () => {
  it("fetches only public http and https links: never another scheme, a password, a space, this machine or its private network", () => {
    for (const ok of ["https://www.tiktok.com/@someone/video/7400000000000000000", "https://www.instagram.com/reel/C0abc12/", "https://youtu.be/vyLcAYfbJ_k", "https://www.youtube.com/shorts/FFJ5THnzdDE", "http://example.com/clip.mp4", "https://8.8.8.8/v"]) expect(checkVideoUrl(ok).ok, ok).toBe(true);
    for (const bad of ["", "file:///etc/hosts", "data:video/mp4;base64,AA", "javascript:alert(1)", "ftp://x.test/a.mp4", "https://user:pw@x.test/a", "https://x.test/a b", "https://x.test/a\nb", "http://localhost:3101/", "http://app.localhost/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://10.1.2.3/", "http://172.20.0.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://0.0.0.0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/", `https://x.test/${"a".repeat(2100)}`, "not a link"]) {
      expect(checkVideoUrl(bad).ok, bad).toBe(false);
    }
    expect(checkVideoUrl(" https://www.youtube.com/watch?v=vyLcAYfbJ_k#t=3 ")).toEqual({ ok: true, url: "https://www.youtube.com/watch?v=vyLcAYfbJ_k", platform: "youtube" });
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });

  it("knows the platform and the video's own id of every link form, and names the downloaded file after them", () => {
    expect(["www.youtube.com", "m.youtube.com", "youtu.be", "www.tiktok.com", "vm.tiktok.com", "www.instagram.com", "vimeo.com"].map(platformOfHost)).toEqual(["youtube", "youtube", "youtube", "tiktok", "tiktok", "instagram", "other"]);
    expect(videoIdOfUrl("https://www.youtube.com/watch?v=vyLcAYfbJ_k&t=3")).toBe("vyLcAYfbJ_k");
    expect(videoIdOfUrl("https://www.youtube.com/shorts/FFJ5THnzdDE")).toBe("FFJ5THnzdDE");
    expect(videoIdOfUrl("https://youtu.be/vyLcAYfbJ_k")).toBe("vyLcAYfbJ_k");
    expect(videoIdOfUrl("https://www.tiktok.com/@someone/video/7508828818702978326?lang=en")).toBe("7508828818702978326");
    expect(videoIdOfUrl("https://www.instagram.com/reel/C0abc12/")).toBe("C0abc12");
    expect(videoIdOfUrl("https://vimeo.com/123")).toBeNull();
    expect(videoKey("youtube", "vyLcAYfbJ_k", "https://youtu.be/vyLcAYfbJ_k")).toBe("youtube:vyLcAYfbJ_k");
    expect(videoKey("other", null, "https://www.Example.com/v/1/?a=b#x")).toBe("other:example.com/v/1?a=b");
    expect(videoFileName({ platform: "tiktok", id: "7508828818702978326", url: "x" })).toBe("tiktok-7508828818702978326");
    // a link without an id of its own: a stable hash of it, never a path
    const other = videoFileName({ platform: "other", id: null, url: "https://example.com/a/../b" });
    expect(other).toMatch(/^other-[0-9a-f]{8}$/);
    expect(videoFileName({ platform: "other", id: null, url: "https://example.com/a/../b" })).toBe(other);
  });

  it("checks a query and builds the search and the Shorts feed of it", () => {
    expect(checkQuery("  ball   simulation ")).toEqual({ ok: true, query: "ball simulation" });
    for (const bad of ["", "   ", "a".repeat(201), "a\u0007b"]) expect(checkQuery(bad).ok, JSON.stringify(bad)).toBe(false);
    expect(searchTarget("ball simulation", 30)).toBe("ytsearch30:ball simulation");
    expect(shortsFeedUrl("Ball Simulation!")).toBe("https://www.youtube.com/hashtag/ballsimulation/shorts");
    expect(shortsFeedUrl("symulacja piłek")).toBe(`https://www.youtube.com/hashtag/${encodeURIComponent("symulacjapiłek")}/shorts`);
    expect(shortsFeedUrl("!!! ???")).toBeNull();
    expect(DEFAULT_QUERY).toBe("ball simulation");
  });
});

describe("yt-dlp's command lines (--- inspiration ---)", () => {
  it("never read a config or write a cache, and put every link after --, last", () => {
    const list = ytListArgs("ytsearch20:ball simulation", 20);
    const info = ytInfoArgs(["https://www.youtube.com/shorts/FFJ5THnzdDE", "https://www.tiktok.com/@a/video/1"]);
    const dl = ytDownloadArgs({ url: "https://www.youtube.com/shorts/FFJ5THnzdDE", dir: "/repo/.agent-out/inbox/.fetch-x", name: "youtube-FFJ5THnzdDE", maxHeight: 1080, ffmpeg: "/usr/bin/ffmpeg" });
    for (const args of [list, info, dl]) {
      expect(args.slice(0, 2)).toEqual(["--ignore-config", "--no-cache-dir"]);
      expect(args.filter((a) => a === "--")).toHaveLength(1);
      expect(args).not.toContain("--exec");
      expect(args).not.toContain("--cookies-from-browser");
    }
    expect(list.slice(-2)).toEqual(["--", "ytsearch20:ball simulation"]);
    expect(list).toEqual(expect.arrayContaining(["--flat-playlist", "--dump-json", "--playlist-end", "20"]));
    expect(info.slice(info.indexOf("--"))).toEqual(["--", "https://www.youtube.com/shorts/FFJ5THnzdDE", "https://www.tiktok.com/@a/video/1"]);
    expect(info).toEqual(expect.arrayContaining(["--skip-download", "--no-playlist", "--ignore-no-formats-error", "--ignore-errors"]));
    expect(() => ytInfoArgs(["http://127.0.0.1/a"])).toThrow(/Not a video link/);
    expect(() => ytListArgs("ytsearch1:a\nb", 1)).toThrow(/control character/);
  });

  it("download the best picture up to maxHeight into the fresh folder, merged into MP4 with ffmpeg, one file as it comes without", () => {
    const base = { url: "https://www.youtube.com/shorts/FFJ5THnzdDE", dir: "/r/100%/.agent-out/inbox/.fetch-x/", name: "youtube-FFJ5THnzdDE", maxHeight: 720 };
    const merged = ytDownloadArgs({ ...base, ffmpeg: "/opt/ffmpeg" });
    expect(merged).toEqual(expect.arrayContaining(["--format", "bv*+ba/b", "--format-sort", "res:720,vcodec:h264,acodec:aac,ext:mp4:m4a", "--merge-output-format", "mp4", "--remux-video", "mp4", "--ffmpeg-location", "/opt/ffmpeg", "--write-info-json", "--print", "after_move:filepath"]));
    expect(merged[merged.indexOf("--output") + 1]).toBe("/r/100%%/.agent-out/inbox/.fetch-x/youtube-FFJ5THnzdDE.%(ext)s"); // (% escaped: the template reads it)
    expect(merged.slice(-2)).toEqual(["--", base.url]);
    const onPath = ytDownloadArgs({ ...base, ffmpeg: "" });
    expect(onPath).toContain("--merge-output-format");
    expect(onPath).not.toContain("--ffmpeg-location");
    const single = ytDownloadArgs({ ...base, ffmpeg: null });
    expect(single[single.indexOf("--format") + 1]).toBe("b");
    expect(single).not.toContain("--merge-output-format");
    expect(() => ytDownloadArgs({ ...base, name: "../x", ffmpeg: null })).toThrow(/bare name/);
    expect(() => ytDownloadArgs({ ...base, url: "file:///etc/passwd", ffmpeg: null })).toThrow();
  });

  it("read its JSON lines and its errors", () => {
    expect(parseJsonLines('{"a":1}\nnot json\n[1,2]\n{"b":\n\n  {"c":3}  ')).toEqual([{ a: 1 }, { c: 3 }]);
    expect(ytErrorLines("WARNING: x\nERROR: [youtube] abc: Sign in to confirm\nERROR: [TikTok] 1: blocked\n")).toEqual(["[youtube] abc: Sign in to confirm", "[TikTok] 1: blocked"]);
  });
});

describe("a video's numbers (--- inspiration ---)", () => {
  it("reads a search row, a Shorts feed row, a video's page and a TikTok page", () => {
    const row = meta(SEARCH.find((r) => r.id === "vyLcAYfbJ_k")!, "search");
    expect(row).toMatchObject({ key: "youtube:vyLcAYfbJ_k", url: "https://www.youtube.com/watch?v=vyLcAYfbJ_k", platform: "youtube", views: 17310330, durationSec: 127, uploadDate: null, viewsPerDay: null, short: false, detailed: false, channel: "Channel 3" });
    const feed = meta(SHORTS[0], "shorts");
    expect(feed).toMatchObject({ key: "youtube:FFJ5THnzdDE", url: "https://www.youtube.com/shorts/FFJ5THnzdDE", views: 806000, short: true, title: null });
    const page = meta(PAGES.find((p) => p.id === "FFJ5THnzdDE")!, "shorts", true, feed.url);
    expect(page).toMatchObject({ views: 806359, likes: 2450, durationSec: 5, uploadDate: "2026-10-11", ageDays: 15, viewsPerDay: Math.round(806359 / 15), likeRate: Math.round((2450 / 806359) * 10000) / 10000, short: true, detailed: true });
    const tiktok = meta(TIKTOK, "url", true);
    expect(tiktok).toMatchObject({ key: "tiktok:7508828818702978326", platform: "tiktok", views: 4100000, likes: 280000, comments: 1900, shares: 12000, durationSec: 11, width: 576, height: 1024, short: true, uploadDate: "2025-05-27" });
    // the feed's rounded count gives way to the page's; the row's link, key and short-form stay
    const merged = mergeMeta(feed, page);
    expect(merged).toMatchObject({ url: feed.url, key: feed.key, views: 806359, uploadDate: "2026-10-11", short: true, detailed: true, source: "shorts" });
    expect(videoMetaOf({ id: "x", url: "http://127.0.0.1/a" }, { source: "search", nowMs: NOW })).toBeNull();
    // a removed video's page names it and nothing else: no numbers
    expect(hasNumbers(meta({ id: "xxxxxxxxxxx", title: "youtube video #xxxxxxxxxxx", webpage_url: "https://www.youtube.com/watch?v=xxxxxxxxxxx" }, "search", true))).toBe(false);
    expect(hasNumbers(page)).toBe(true);
  });

  it("keeps other people's text as one clean line", () => {
    expect(cleanText("a\u0000b‮c\n\n  d")).toBe("a b c d");
    expect(cleanText("x".repeat(500))).toHaveLength(200);
    expect(cleanText(42)).toBeNull();
    expect(cleanText("  ")).toBeNull();
  });

  it("ranks by views or views per day, short-form first for a short-form search, without duplicates, the same every time", () => {
    const rows = [...SEARCH.map((r) => meta(r, "search")), ...SHORTS.map((r) => meta(r, "shorts"))];
    const pages = new Map(PAGES.map((p) => [`youtube:${p.id}`, meta(p, "search", true)]));
    const all = rows.map((r) => mergeMeta(r, pages.get(r.key) ?? null));
    const byViews = rankVideos(all, { sortBy: "views", limit: 5 });
    expect(byViews.videos.map((v) => v.id)).toEqual(["vyLcAYfbJ_k", "wGN0hxfuqiE", "fREAnGGfSTA", "OKZltUoI7eE", "FFJ5THnzdDE"]);
    expect(byViews.dropped).toEqual({ duplicates: 0, belowMinViews: 0, overMaxDuration: 0, pastLimit: all.length - 5 });
    const shorts = rankVideos(all, { sortBy: "views", limit: 20, maxDurationSec: SHORT_MAX_SEC });
    expect(shorts.videos.map((v) => v.id)).toEqual(["FFJ5THnzdDE", "o-DtHwlRIqU", "8aj37SIIbQc", "WGZeukpDBMw", "iOjJe2bjOCg", "FoCAv5Svekk", "vyLcAYfbJ_k", "UyzbtAFGchM"]);
    expect(shorts.dropped.overMaxDuration).toBe(6);
    // views per day: only the videos with an upload date have it, the others follow
    const perDay = rankVideos(all, { sortBy: "viewsPerDay", limit: 3 });
    expect(perDay.videos.map((v) => v.id)).toEqual(["FFJ5THnzdDE", "OKZltUoI7eE", "wGN0hxfuqiE"]); // 15, 72 and 937 days old
    expect(perDay.videos.every((v) => v.viewsPerDay !== null)).toBe(true);
    expect(rankVideos(all, { sortBy: "views", limit: 100, minViews: 1_000_000 }).videos.map((v) => v.id)).toEqual(["vyLcAYfbJ_k", "wGN0hxfuqiE", "fREAnGGfSTA", "OKZltUoI7eE"]);
    const twice = rankVideos([...all, ...all.slice(0, 3)], { sortBy: "views", limit: 100 });
    expect(twice.dropped.duplicates).toBe(3);
    expect(JSON.stringify(rankVideos([...all].reverse(), { sortBy: "views", limit: 100 }).videos)).toBe(JSON.stringify(rankVideos(all, { sortBy: "views", limit: 100 }).videos));
  });
});

describe("frames for a vision-capable AI (--- inspiration ---)", () => {
  it("spreads the frames evenly, steps through the opening, and lays the sheet out by the picture's shape", () => {
    expect(frameTimes(12, 4)).toEqual([1.5, 4.5, 7.5, 10.5]);
    expect(frameTimes(0, 4)).toEqual([]);
    expect(frameTimes(10, 0)).toEqual([]);
    expect(hookTimes(10)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75]);
    expect(hookTimes(1, 3, 0.5)).toEqual([0, 0.5]);
    expect(hookTimes(10, 0)).toEqual([]);
    expect(sheetGrid(12, true)).toEqual({ cols: 6, rows: 2 });
    expect(sheetGrid(12, false)).toEqual({ cols: 4, rows: 3 });
    expect(sheetGrid(3, true)).toEqual({ cols: 3, rows: 1 });
  });

  it("open the video as a local file only, write bare names only, never over a file that is there", () => {
    const file = "/repo/.agent-out/inbox/youtube-FFJ5THnzdDE.mp4";
    const one = frameArgs(file, 1.5, ".frame-01.png.1.ab.png", 540);
    expect(one.indexOf("-ss")).toBeLessThan(one.indexOf("-i"));
    expect(one[one.indexOf("-i") + 1]).toBe(`file:${file}`);
    expect(one).toEqual(expect.arrayContaining(["-protocol_whitelist", "file", "-format_whitelist", VIDEO_DEMUXERS, "-frames:v", "1", "-n"]));
    expect(one[one.length - 1]).toBe("file:.frame-01.png.1.ab.png");
    const sheet = sheetArgs(["frame-01.png", "frame-02.png", "frame-03.png"], "sheet.png", { cols: 2, rows: 2 }, 240, 427);
    expect(sheet.filter((a) => a === "-i")).toHaveLength(3);
    expect(sheet.filter((a) => a === IMAGE_DEMUXERS)).toHaveLength(3);
    expect(sheet[sheet.indexOf("-filter_complex") + 1]).toContain("concat=n=3:v=1:a=0,tile=2x2");
    expect(sheet[sheet.indexOf("-filter_complex") + 1]).not.toContain(".png");
    for (const bad of ["../x.png", "/tmp/x.png", "http://x/y.png", "a/b.png", ""]) {
      expect(() => frameArgs(file, 1, bad), bad).toThrow(/bare file name/);
      expect(() => sheetArgs([bad], "sheet.png", { cols: 1, rows: 1 }, 240, 240), bad).toThrow(/bare file name/);
    }
    expect(() => sheetArgs([], "sheet.png", { cols: 1, rows: 1 }, 240, 240)).toThrow(/at least one frame/);
  });
});

/** A VideoFeatures record with the given numbers (the rest neutral). */
function features(p: Partial<VideoFeatures> = {}): VideoFeatures {
  return { v: 1, durationSec: 20, analysedSec: 20, fps: 30, width: 1080, height: 1920, hasAudio: true, sampleHz: 2, motion: [0, 0.04, 0.04, 0.02, 0.02, 0.02], firstMotionSec: 0.5, peakMotionPos: 0.2, meanLuma: 0.3, meanSat: 0.6, darkShare: 0.5, loopSeamDiff: 0.02, cuts: [], cutsPerMin: 0, lufs: -12, bpm: 128, bpmConfidence: 0.6, onsetsPerSec: 3, firstSoundSec: 0, silenceSec: 2, ...p };
}

describe("the report's maths (--- inspiration ---)", () => {
  it("takes medians, ranks with ties and Spearman's ρ", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect([1, 2, 3, 6, 9].map(topCount)).toEqual([1, 1, 1, 2, 3]);
  });

  it("measures a clip's traits: the first second's motion, the hook lift, the shape, a sure tempo only", () => {
    const t = clipTraits(features());
    expect(t).toMatchObject({ durationSec: 20, portrait: 1, motion: 0.028, hookMotion: 0.04, hookLift: Math.round((0.04 / 0.028) * 1000) / 1000, bpm: 128, silenceShare: 0.1, loopSeamDiff: 0.02 });
    expect(clipTraits(features({ bpmConfidence: 0.1 })).bpm).toBeNull();
    expect(clipTraits(features({ width: 1920, height: 1080 })).portrait).toBe(0);
    // a video not measured: what its page says
    expect(clipTraits(null, { durationSec: 42, width: null, height: null })).toMatchObject({ durationSec: 42, portrait: null, motion: null, bpm: null });
  });

  it("finds what separates the most viewed: shorter, faster openings, here", () => {
    // nine videos: the more views, the shorter and the busier the first second
    const rows = Array.from({ length: 9 }, (_, i) => ({ metric: (9 - i) * 100_000, traits: clipTraits(features({ durationSec: 10 + i * 5, motion: [0, 0.08 - i * 0.008, 0.08 - i * 0.008, 0.02, 0.02], meanSat: 0.6 })) }));
    const { summaries, patterns } = traitSummaries(rows);
    const length = summaries.find((s) => s.key === "durationSec")!;
    expect(length).toMatchObject({ n: 9, top: 15, rest: 37.5, rho: -1, effect: -4.5 });
    expect(patterns.map((p) => p.key)).toEqual(expect.arrayContaining(["durationSec", "hookMotion"]));
    expect(patterns.find((p) => p.key === "durationSec")).toMatchObject({ strength: "clear", sentence: expect.stringMatching(/^The most viewed have less length: 15 s against 37\.5 s for the rest \(ρ -1 over 9 videos\)\.$/) });
    // a trait that does not vary is no pattern
    expect(patterns.find((p) => p.key === "meanSat")).toBeUndefined();
    // our renders are compared with the same medians
    const withOurs = traitSummaries(rows, [clipTraits(features({ durationSec: 30 }))]).summaries.find((s) => s.key === "durationSec")!;
    expect(withOurs.ours).toBe(30);
  });

  it("reads titles: their words, the big numbers they state, their themes", () => {
    expect(titleWords("18,200 Colorful Balls Marble Run | Loop animation V11 #shorts")).toEqual(["colorful", "balls", "marble", "run", "loop", "animation", "v11"]);
    expect(titleNumber("18,200 Colorful Balls Marble Run V11")).toBe(18200);
    expect(titleNumber("20 000 balls")).toBe(20000);
    expect(titleNumber("no number")).toBeNull();
    expect(titleNumber("2023 Marble Run Compilation - 42 Minutes")).toBe(42); // (a year is no count)
    const marble = THEMES.find((t) => t.id === "marbleRun")!;
    expect(inTheme(marble, "Balls on escalator 3.0 - Marble run animation")).toBe(true);
    expect(inTheme(marble, "Pendulum wave")).toBe(false);
    const videos = SEARCH.map((r) => meta(r, "search"));
    const shares = themeShares(videos, MODE_IDS);
    expect(shares[0]).toMatchObject({ id: "marbleRun", modes: ["drop", "bullseye", "beatMachine", "conveyor", "race"], blueprints: ["plinkoRace"] });
    expect(shares[0].viewShare).toBeGreaterThan(0.9);
    expect(themeShares(videos, ["drop"])[0].modes).toEqual(["drop"]); // only modes that exist
    const titles = titleSummary(videos, videos.map((v) => v.views ?? 0));
    expect(titles.topWords.map((w) => w.word)).toEqual(expect.arrayContaining(["marble", "run", "animation"]));
    expect(titles.bigNumber.top).toBe(0.33);
  });

  it("names only levers that exist: settings with their link keys, modes, Blueprints", () => {
    const base = defaultSettings("classic");
    const changed: { [K in keyof typeof LEVERS]: Partial<SimulatorSettings> } = {
      clipLength: { recordingDuration: 45 },
      resolution: { recordingResolution: base.recordingResolution === "1280x720" ? "1920x1080" : "1280x720" },
      bpm: { bpm: base.bpm + 10 },
      musicStart: { musicStartOffset: 3 },
      captions: { captions: [defaultCaption("question", { text: "Will it get out?" })] },
      slowMo: { slowMoOnNearMiss: !base.slowMoOnNearMiss },
      shake: { screenShake: base.screenShake + 1 },
      trails: { showTrails: !base.showTrails },
      trailColors: { trailColors: ["#ff0000", "#00ff00"] },
      reactiveBackground: { reactiveBackground: !base.reactiveBackground },
      theme: { themeId: base.themeId === "neon" ? "pastel" : "neon" },
      backgroundType: { backgroundType: base.backgroundType === "gradient" ? "solid" : "gradient" },
    };
    for (const [id, lever] of Object.entries(LEVERS)) {
      const patch = changed[id as keyof typeof LEVERS];
      expect(Object.keys(patch), id).toEqual([lever.field]);
      expect(settingsToSearchParams({ ...base, ...patch }).has(lever.link), `${id}: ${lever.field} → ${lever.link}`).toBe(true);
    }
    for (const t of THEMES) {
      for (const m of t.modes) expect(MODE_IDS, `${t.id}: ${m}`).toContain(m);
      for (const b of t.blueprints) expect(BLUEPRINT_CATALOG_IDS, `${t.id}: ${b}`).toContain(b);
    }
    for (const m of LOOP_MODES) expect(MODE_IDS).toContain(m);
    expect(OUR_LOUDNESS_LUFS).toBe(LOUDNESS_TARGET_LUFS);
    expect(OUR_SHORTEST_CLIP_SEC).toBe(RANGES.recordingDuration.min);
  });

  it("turns the benchmarks into our levers, only from three videos up, and says where our renders are a step away", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ metric: (6 - i) * 1000, traits: clipTraits(features({ durationSec: 12 + i * 4, bpm: 140 - i, lufs: -9 })) }));
    const ours = [clipTraits(features({ durationSec: 30, bpm: 100 }))];
    const { summaries, patterns } = traitSummaries(rows, ours);
    const recs = recommendations(summaries, patterns, themeShares(SEARCH.map((r) => meta(r, "search")), MODE_IDS), titleSummary([], []));
    const length = recs.find((r) => r.area === "length")!;
    expect(length).toMatchObject({ basis: "gap", levers: [{ kind: "setting", name: "recordingDuration", link: "dur", value: 14 }] });
    expect(length.advice).toMatch(/^Render 14 s clips: ours run 30 s\.$/);
    expect(recs.find((r) => r.area === "sound" && r.levers.some((l) => l.name === "bpm"))?.levers[0]).toEqual({ kind: "setting", name: "bpm", link: "bpm", value: 140 });
    expect(recs.find((r) => r.area === "format")?.levers).toEqual([{ kind: "setting", name: "recordingResolution", link: "res", value: "1080x1920" }]);
    expect(recs.find((r) => r.area === "mode")?.levers.map((l) => l.name)).toEqual(["drop", "bullseye", "beatMachine", "conveyor", "race"]);
    expect(recs.find((r) => r.area === "blueprint")?.levers).toEqual([{ kind: "blueprint", name: "plinkoRace" }, { kind: "tool", name: "bp-check" }]);
    // gaps first, themes last
    expect(recs[0].basis).toBe("gap");
    expect(recs[recs.length - 1].basis).toBe("theme");
    // one or two videos are an anecdote: no advice from their picture or sound
    const few = traitSummaries(rows.slice(0, MIN_VIDEOS_FOR_ADVICE - 1));
    expect(recommendations(few.summaries, few.patterns, [], titleSummary([], [])).filter((r) => r.area !== "title")).toEqual([]);
  });

  it("builds the same report from the same input, keeps a failed video with its error, and writes Markdown that links nothing it should not", () => {
    const candidates = [meta(TIKTOK, "url", true), ...PAGES.map((p) => meta(p, "search", true))];
    const analysed = [
      { meta: candidates[0], file: ".agent-out/inbox/tiktok-7508828818702978326.mp4", features: features({ durationSec: 11 }), frames: { dir: ".agent-out/frames/tiktok-7508828818702978326", sheet: ".agent-out/frames/tiktok-7508828818702978326/sheet.png", hookSheet: null } },
      { meta: candidates[1], error: "[youtube] FFJ5THnzdDE: Sign in to confirm you're not a bot" },
    ];
    const input = { query: "ball simulation", at: "2026-10-26T12:00:00.000Z", sortBy: "views" as const, candidates, analysed, ours: [{ file: ".agent-out/render/a/clip.mp4", features: features({ durationSec: 30 }) }], modes: [...MODE_IDS] };
    const report = buildInspirationReport(input);
    expect(JSON.stringify(buildInspirationReport(input))).toBe(JSON.stringify(report));
    expect(report.counts).toEqual({ candidates: 8, analysed: 1, failed: 1, ours: 1 });
    expect(report.videos[1]).toMatchObject({ key: "youtube:FFJ5THnzdDE", analysed: false, error: expect.stringMatching(/Sign in/) });
    expect(report.videos[0]).toMatchObject({ analysed: true, frames: { sheet: expect.stringMatching(/sheet\.png$/) } });
    expect(report.notes.join(" ")).toMatch(/Only 1 video was measured/);
    expect(report.traits.find((t) => t.key === "durationSec")?.n).toBe(8); // the length comes from every page
    const md = inspirationMarkdown({ ...report, videos: report.videos.map((v, i) => (i === 0 ? { ...v, title: "evil | `x` [click](http://x.test) <img>" } : v)) });
    expect(md).toContain("# Inspiration: ball simulation");
    expect(md).not.toContain("[click]");
    expect(md).not.toContain("<img>");
    expect(mdText("a|b`c*d_e[f]g<h>#i\\j")).toBe("a b c d e f g h i j");
    expect(runFolderName("2026-10-26T12:00:00.000Z", "Ball Simulation ✨ #shorts")).toBe("2026-10-26-ball-simulation-shorts");
    expect(runFolderName("2026-10-26T12:00:00.000Z", null)).toBe("2026-10-26-links");
  });

  it("grows the dataset by videos it does not hold yet, once each", () => {
    const existing = `${JSON.stringify({ key: "youtube:a" })}\nnot json\n`;
    const out = datasetAppend(existing, [{ key: "youtube:a" }, { key: "tiktok:b" }, { key: "tiktok:b" }, { url: "no key" }]);
    expect(out).toEqual({ lines: [JSON.stringify({ key: "tiktok:b" })], added: 1, skipped: 3, total: 3 });
    expect(datasetAppend("", [{ key: "x" }]).total).toBe(1);
  });
});

// --- inspiration --- what the first live runs taught the tools (26 October 2026): downloads refused from a server's address
// (stills instead), long compilations among the Shorts (compared apart), a long query without a hashtag feed (shorter tags),
// "satisfying" in nearly every title (a theme by its lift), our renders far darker than every trending clip (the look advice)

describe("the stills fallback and the report's lessons from the live runs (--- inspiration ---)", () => {
  it("reads a YouTube video's public stills from one host only, and crops them to the video's shape", () => {
    const short = meta(SHORTS[0], "shorts");
    const stills = videoStills(short);
    expect(stills.map((s) => [s.name, s.at, s.label])).toEqual([
      ["still-0.jpg", 0, "start"],
      ["still-1.jpg", 0.25, "25%"],
      ["still-2.jpg", 0.5, "50%"],
      ["still-3.jpg", 0.75, "75%"],
      ["cover.jpg", null, "cover"],
    ]);
    for (const s of stills) expect(new URL(s.url).host, s.url).toBe(STILLS_HOST);
    expect(stills[0].url).toBe(`https://i.ytimg.com/vi/${short.id}/frame0.jpg`);
    expect(videoStills(short, "http://127.0.0.1:9/")[1].url).toBe(`http://127.0.0.1:9/vi/${short.id}/hq1.jpg`);
    expect(videoStills(meta(TIKTOK, "url", true))).toEqual([]); // TikTok has no such host
    expect(videoStills({ platform: "youtube", id: "../../x" })).toEqual([]);
    expect(videoStills({ platform: "youtube", id: null })).toEqual([]);
    expect(stillsAspect({ width: 1080, height: 1920, short: true })).toBeCloseTo(0.5625);
    expect(stillsAspect({ width: null, height: null, short: true })).toBeCloseTo(9 / 16);
    expect(stillsAspect({ width: null, height: null, short: false })).toBeCloseTo(16 / 9);
    // ffmpeg opens a still as a bare local file, with image demuxers only, and crops the letterbox away
    const crop = stillArgs("still-1.jpg", ".still-1.png.tmp.png", 9 / 16);
    expect(crop).toEqual(expect.arrayContaining(["-protocol_whitelist", "file", "-format_whitelist", STILL_DEMUXERS, "file:still-1.jpg", "file:.still-1.png.tmp.png", "-n"]));
    expect(crop.join(" ")).toContain("crop='min(iw,ih*0.5625)':'min(ih,iw/0.5625)'");
    expect(STILL_DEMUXERS.split(",")).not.toContain("mov");
    for (const bad of ["../x.jpg", "/etc/passwd", "http://x.test/a.jpg", "a/b.jpg"]) {
      expect(() => stillArgs(bad, "out.png", 1), bad).toThrow(/bare file name/);
      expect(() => stillSampleArgs(bad), bad).toThrow(/bare file name/);
    }
    expect(stillSampleArgs("still-0.png").slice(-3)).toEqual(["-f", "rawvideo", "pipe:1"]);
  });

  it("measures the stills' colours as a video's are measured, and never from the cover alone", () => {
    const grey = new Uint8Array(SAMPLE_BYTES).fill(128);
    const black = new Uint8Array(SAMPLE_BYTES);
    const red = new Uint8Array(SAMPLE_BYTES).map((_, i) => (i % 3 === 0 ? 255 : 0));
    expect(stillsColour([])).toBeNull();
    expect(stillsColour([black, black])).toEqual({ meanLuma: 0, meanSat: 0, darkShare: 1, stills: 2 });
    const mixed = stillsColour([grey, red])!;
    expect(mixed.stills).toBe(2);
    expect(mixed.meanSat).toBeCloseTo(0.5);
    expect(mixed.darkShare).toBe(0);
    // a video seen through its stills: its colours count, its motion and sound do not
    const t = clipTraits(null, { durationSec: 9, width: null, height: null }, { meanLuma: 0.4, meanSat: 0.3, darkShare: 0.1, stills: 4 });
    expect(t).toMatchObject({ durationSec: 9, meanLuma: 0.4, meanSat: 0.3, darkShare: 0.1, motion: null, hookMotion: null, bpm: null });
    // measured features win over stills
    expect(clipTraits(features({ durationSec: 10 }), null, { meanLuma: 0.9, meanSat: 0.9, darkShare: 0.9, stills: 4 }).meanLuma).not.toBe(0.9);
  });

  it("tries the Shorts feed of a long query's shorter hashtags, never the word shorts", () => {
    expect(shortsFeedUrls("ball simulation")).toEqual(["https://www.youtube.com/hashtag/ballsimulation/shorts"]);
    expect(shortsFeedUrls("satisfying physics simulation shorts")).toEqual([
      "https://www.youtube.com/hashtag/satisfyingphysicssimulation/shorts",
      "https://www.youtube.com/hashtag/physicssimulation/shorts",
      "https://www.youtube.com/hashtag/satisfyingphysics/shorts",
    ]);
    expect(shortsFeedUrl("ball simulation #shorts")).toBe("https://www.youtube.com/hashtag/ballsimulation/shorts");
    expect(shortsFeedUrls("shorts")).toEqual([]);
  });

  it("weighs a theme by its lift: a word in nearly every title is no advice, nor is one video", () => {
    const v = (title: string, views: number) => ({ title, views });
    const videos = [v("Satisfying maze run", 900), v("Satisfying maze escape", 800), v("Satisfying drop", 10), v("Satisfying drop two", 10), v("Satisfying grid", 10), v("Satisfying pile", 10), v("Glass smash", 5)];
    const shares = themeShares(videos, MODE_IDS);
    const by = (id: string) => shares.find((t) => t.id === id)!;
    expect(by("satisfying")).toMatchObject({ videos: 6, videoShare: 0.857 });
    expect(by("satisfying").lift).toBeGreaterThan(1); // the genre's word: listed, never advice
    expect(GENERIC_THEMES).toEqual(["satisfying"]);
    expect(by("maze")).toMatchObject({ videos: 2, videoShare: 0.286 });
    expect(by("maze").lift).toBeGreaterThan(3);
    expect(by("drop").lift).toBeLessThan(1); // four videos of few views
    const recs = recommendations([], [], shares, titleSummary([], []));
    const modes = recs.filter((r) => r.area === "mode").map((r) => r.levers.map((l) => l.name));
    expect(modes[0]).toEqual(["maze"]);
    expect(modes.flat()).not.toContain("drop");
    expect(recs.find((r) => r.area === "mode")?.advice).toMatch(/holds 97% of the views with 29% of the videos \(2 videos\)/);
    // one video's views are its own: no theme advice from it
    expect(recommendations([], [], themeShares([v("Glass smash", 1000), v("calm", 1)], MODE_IDS), titleSummary([], [])).filter((r) => r.area === "mode")).toEqual([]);
    expect(MIN_THEME_VIDEOS).toBe(2);
  });

  it("tells our renders to lighten up when they are far darker than every trending clip, and reads the title formats", () => {
    const bright = (luma: number) => ({ ...features({ durationSec: 12 }), meanLuma: luma, meanSat: 0.3, darkShare: 0.05 });
    const rows = Array.from({ length: 6 }, (_, i) => ({ metric: (6 - i) * 1000, traits: clipTraits(bright(0.4 + (i % 2) * 0.1)) }));
    const ours = [clipTraits({ ...features({ durationSec: 12 }), meanLuma: 0.06, meanSat: 0.2, darkShare: 0.9 })];
    const { summaries, patterns } = traitSummaries(rows, ours);
    const look = recommendations(summaries, patterns, [], titleSummary([], [])).find((r) => r.area === "look")!;
    expect(look.basis).toBe("gap");
    expect(look.advice).toMatch(/lighten the picture: ours are darker than the trending clips \(brightness 0\.06 against 0\.45\)/);
    expect(look.levers.map((l) => l.name)).toEqual(["themeId", "trailColors", "showTrails", "backgroundType"]);
    // a picture as bright as theirs: no such clause
    const even = traitSummaries(rows, [clipTraits(bright(0.45))]);
    expect(recommendations(even.summaries, even.patterns, [], titleSummary([], [])).find((r) => r.area === "look")?.advice).not.toMatch(/lighten|darken/);
    // the title formats: a question, a count, a versus, a scale stepped up, a numbered series
    const titles = ["Will the emojis make it to the end?", "0% vs 100% Softness", "Small to Big Balls vs Lava", "Day 56 → 1K Subscribers", "20,000 balls", "Glass Pipes vs Soft Body"];
    const summary = titleSummary(titles.map((title) => ({ title })), [6, 5, 4, 3, 2, 1]);
    const f = (id: string) => summary.formats.find((x) => x.id === id)!;
    expect(summary.formats.map((x) => x.id)).toEqual(TITLE_FORMATS.map((x) => x.id));
    expect(f("question")).toMatchObject({ top: 0.5, rest: 0, all: 0.17 });
    expect(f("versus").all).toBe(0.5);
    expect(f("escalation").all).toBe(0.33);
    expect(f("series").all).toBe(0.17);
    expect(f("bigNumber").all).toBe(0.17); // "20,000 balls"; a share ("100%") is no count
    expect(titleNumber("0% vs 100% Softness")).toBeNull();
    const asks = recommendations([], [], [], summary).find((r) => r.area === "title" && /question/.test(r.advice));
    expect(asks?.levers).toEqual([{ kind: "setting", name: "captions", link: "cap", value: "question at 0 s" }]);
  });

  it("compares only short-form videos in a short-form run, and says which were seen through their stills", () => {
    const shorts = PAGES.map((p) => meta(p, "search", true)).filter((v) => v.short);
    expect(shorts.length).toBeGreaterThanOrEqual(3);
    const long = { ...shorts[1], key: "youtube:longcompilation", id: "longcompilat", url: "https://www.youtube.com/watch?v=longcompilat", title: "Pendulum Wave Compilation", views: 99_000_000, durationSec: 170, short: false };
    const candidates = [long, ...shorts];
    const analysed = [{ meta: shorts[0], error: "Sign in to confirm you're not a bot", stills: { dir: ".agent-out/frames/x", sheet: ".agent-out/frames/x/stills-sheet.png", files: [{ file: ".agent-out/frames/x/still-0.png", label: "start", at: 0 }], colour: { meanLuma: 0.5, meanSat: 0.4, darkShare: 0, stills: 4 } } }];
    const input = { query: "ball simulation", at: "2026-10-26T12:00:00.000Z", sortBy: "views" as const, candidates, analysed, ours: [], modes: [...MODE_IDS] };
    const report = buildInspirationReport({ ...input, shortForm: true });
    expect(report.videos[0]).toMatchObject({ key: "youtube:longcompilation", compared: false });
    expect(report.videos.filter((v) => v.compared).map((v) => v.key)).toEqual(shorts.map((v) => v.key));
    expect(report.themes.some((t) => t.id === "wave")).toBe(false); // the long one's theme does not count
    expect(buildInspirationReport(input).themes.some((t) => t.id === "wave")).toBe(true);
    expect(report.traits.find((t) => t.key === "durationSec")?.n).toBe(shorts.length);
    expect(report.notes.join(" ")).toMatch(/1 long-form video is listed but left out of the numbers/);
    const seen = report.videos.find((v) => v.key === shorts[0].key)!;
    expect(seen).toMatchObject({ measured: "stills", analysed: false, traits: { meanLuma: 0.5, meanSat: 0.4 } });
    expect(report.stillsOnly).toBe(1);
    expect(report.notes.join(" ")).toMatch(/1 video could not be fetched and was seen through YouTube's public stills/);
    const md = inspirationMarkdown(report);
    expect(md).toContain("stills: `.agent-out/frames/x/stills-sheet.png`");
    expect(md).toContain("(1 seen from stills)");
    expect(md).toMatch(/\| 1 \(long-form\) \|/);
    // without shortForm (a long-form run) every video counts, as before
    expect(buildInspirationReport(input).videos.every((v) => v.compared)).toBe(true);
    // a run with no short-form video at all compares nothing and says how to find some
    const none = buildInspirationReport({ ...input, candidates: [long], analysed: [], shortForm: true });
    expect(none.traits.every((t) => t.n === 0)).toBe(true);
    expect(none.notes.join(" ")).toMatch(/No short-form video was found/);
  });
});
