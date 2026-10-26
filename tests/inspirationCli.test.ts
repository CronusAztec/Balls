import { spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_QUERY, parseJsonLines, type VideoMeta } from "@/lib/agentKit/videoSources";
import { runFolderName } from "@/lib/agentKit/inspiration";
import * as ffmpegArgs from "@/lib/videoAnalysis/ffmpegArgs";
import { hookTimes } from "@/lib/videoAnalysis/ffmpegArgs";
import { parseMediaInfo } from "@/lib/videoAnalysis/ffmpegParse";
import { AGENT_TOOLS, PATH_OR_URL_TOOLS, checkToolArgs } from "@/lib/agentKit/tools";
import { createMcpHandler } from "../scripts/agent/mcp.mjs";
import { resolveFfmpeg } from "../scripts/agent/analyse.mjs";
import { extractFrames } from "../scripts/agent/frames.mjs";
import * as videoSources from "@/lib/agentKit/videoSources";
import { readPages, ytDlpCommand } from "../scripts/agent/videoSources.mjs";
import { PathError, outFolder } from "../scripts/agent/paths.mjs";

// --- inspiration --- The inspiration tools of the agent toolbox (trending, fetch-video, frames, inspire; analyse with a
// url): the owner wants agents to learn from other creators' trending and viral simulation videos. Their tool table and MCP
// listing, and the CLI end to end with a fake yt-dlp on the PATH (tests/fixtures/fake-yt-dlp.mjs, answering from the
// recorded output in tests/fixtures/ytdlp/) and a clip ffmpeg makes here: no test reaches the network. Their pure halves:
// tests/inspiration.test.ts.

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "agent", "cli.mjs");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "ytdlp");
const FAKE = path.join(ROOT, "tests", "fixtures", "fake-yt-dlp.mjs");
const lines = (file: string) => parseJsonLines(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
const SEARCH = lines("search.jsonl");
const SHORTS = lines("shorts.jsonl");
const PAGES = lines("pages.jsonl");
const TIKTOK = JSON.parse(fs.readFileSync(path.join(FIXTURES, "tiktok-page.json"), "utf8")) as Record<string, unknown>;

describe("yt-dlp itself and where its files go (--- inspiration ---)", () => {
  it("runs a script given as JBL_YTDLP with this Node, anything else as it is", () => {
    expect(ytDlpCommand("/x/fake.mjs")).toEqual({ file: process.execPath, prefix: ["/x/fake.mjs"] });
    expect(ytDlpCommand("yt-dlp")).toEqual({ file: "yt-dlp", prefix: [] });
  });

  it("writes only into bare-named folders under .agent-out/, never through a link", () => {
    for (const bad of ["../x", "a/b", ".hidden", "", "a..b"]) expect(() => outFolder("frames", bad), bad).toThrow(PathError);
    expect(() => outFolder()).toThrow(PathError);
    const name = `test-link-${process.pid}`;
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-outside-"));
    const link = path.join(ROOT, ".agent-out", "frames", name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    try {
      expect(() => outFolder("frames", name)).toThrow(/outside|link/);
      expect(() => outFolder("frames", name, "inner")).toThrow(/outside|link/);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
    expect(outFolder("inbox")).toBe(path.join(ROOT, ".agent-out", "inbox"));
  });

  // --- inspiration --- a run stopped at its timeout: the pages it printed before are kept, not lost with the run
  it("keeps the pages a run printed before it was stopped at its timeout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-slow-ytdlp-"));
    const slow = path.join(dir, "slow-yt-dlp.mjs");
    // (prints the page of the first link it is given, then never ends)
    fs.writeFileSync(slow, 'const a = process.argv.slice(2); const t = a.slice(a.indexOf("--") + 1);\nprocess.stdout.write(JSON.stringify({ id: "x", original_url: t[0], webpage_url: t[0], view_count: 1 }) + "\\n");\nsetInterval(() => {}, 1000);\n');
    try {
      const urls = ["a", "b", "c", "d", "e"].map((c) => `https://www.youtube.com/shorts/${c.repeat(11)}`);
      const { pages, errors } = await readPages(videoSources, { ...ytDlpCommand(slow), source: "JBL_YTDLP", version: "slow" }, urls, { timeoutMs: 1500 });
      expect([...pages.keys()].sort()).toEqual([urls[0], urls[2], urls[4]]); // (five links in three runs: the first of each)
      expect(errors.filter((e: string) => /took longer than/.test(e))).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("the tool table (--- inspiration ---)", () => {
  it("takes one video a call as a file or a link, links that are http or https, and no maximum where none is needed", () => {
    expect([...PATH_OR_URL_TOOLS].sort()).toEqual(["analyse", "frames"]);
    for (const tool of ["analyse", "frames"]) {
      expect(checkToolArgs(tool, {}).ok, tool).toBe(false);
      expect(checkToolArgs(tool, { path: "a.mp4", url: "https://x.test/v" }).ok, tool).toBe(false);
      expect(checkToolArgs(tool, { url: "https://www.tiktok.com/@a/video/1" }).ok, tool).toBe(true);
      expect(checkToolArgs(tool, { url: "ftp://x.test/v" }).ok, tool).toBe(false);
    }
    expect(checkToolArgs("fetch-video", {}).ok).toBe(false);
    expect(checkToolArgs("fetch-video", { url: "https://youtu.be/vyLcAYfbJ_k", maxHeight: 4320 }).ok).toBe(true);
    expect(checkToolArgs("trending", { limit: 500, urls: ["https://www.instagram.com/reel/C0abc12/"], sortBy: "viewsPerDay" }).ok).toBe(true);
    expect(checkToolArgs("trending", { limit: 0 }).ok).toBe(false);
    expect(checkToolArgs("trending", { platform: "tiktok" }).ok).toBe(false);
    expect(checkToolArgs("inspire", { top: 50, dataset: "../x" }).ok).toBe(false);
    expect(checkToolArgs("inspire", { top: 50, dataset: "satisfying-2026" }).ok).toBe(true);
    const web = AGENT_TOOLS.filter((t) => t.network === "web").map((t) => t.name);
    expect(web).toEqual(["analyse", "frames", "trending", "fetch-video", "inspire"]);
    for (const t of AGENT_TOOLS.filter((x) => x.network === "web")) expect(t.mcp, t.name).toBe(true);
  });

  it("says over MCP which tools reach video sites (openWorldHint) and which only read", async () => {
    const { handle } = createMcpHandler({ tools: AGENT_TOOLS, run: async () => ({ ok: true, result: {} }) });
    const listed = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations: { openWorldHint: boolean; readOnlyHint: boolean } }[] } };
    const by = new Map(listed.result.tools.map((t) => [t.name, t.annotations]));
    for (const name of ["analyse", "frames", "trending", "fetch-video", "inspire"]) expect(by.get(name)?.openWorldHint, name).toBe(true);
    for (const name of ["modes", "simulate", "guard", "bp-check"]) expect(by.get(name)?.openWorldHint, name).toBe(false);
    expect(by.get("trending")?.readOnlyHint).toBe(true);
    expect(by.get("fetch-video")?.readOnlyHint).toBe(false);
  });
});

// --- inspiration --- the CLI end to end: the fake yt-dlp on the PATH, a clip ffmpeg makes here, nothing from the network

const TEST_DIR = path.join(ROOT, ".agent-out", `test-inspiration-${process.pid}`);
const BIN = path.join(TEST_DIR, "bin");
const LOG = path.join(TEST_DIR, "ytdlp.log");
const CLIP = path.join(TEST_DIR, "clip.mp4");
const QUERY = `ball simulation test ${process.pid}`;
const DATASET = `test-${process.pid}`;
// --- inspiration --- the stills fallback reads a stand-in for YouTube's image host (tests/fixtures/stills-server.mjs)
const STILLS_SERVER = path.join(ROOT, "tests", "fixtures", "stills-server.mjs");
const STILLS_DIR = path.join(TEST_DIR, "stills");
const STILLS_LOG = path.join(TEST_DIR, "stills.log");
/** Where stills are read from: the stand-in once it runs, else a port nothing listens on (never the network). */
let stillsOrigin = "http://127.0.0.1:9";
let stillsServer: ChildProcess | null = null;
const stillRequests = () => (fs.existsSync(STILLS_LOG) ? fs.readFileSync(STILLS_LOG, "utf8").trim().split("\n").filter(Boolean) : []);
/** What these tests write outside their own folder: moved aside first, put back after. */
const FIXTURE_NAMES = [...[...SEARCH, ...SHORTS, ...PAGES].map((r) => `youtube-${r.id}`), `tiktok-${TIKTOK.id}`];
const touched = () => [
  ...FIXTURE_NAMES.flatMap((n) => [".mp4", ".webm", ".info.json"].map((ext) => path.join(ROOT, ".agent-out", "inbox", `${n}${ext}`))),
  ...FIXTURE_NAMES.map((n) => path.join(ROOT, ".agent-out", "frames", n)),
  path.join(ROOT, ".agent-out", "frames", `test-inspiration-${process.pid}`),
  path.join(ROOT, ".agent-out", "inspiration", runFolderName(new Date().toISOString(), QUERY)),
  path.join(ROOT, ".agent-out", "inspiration", `${DATASET}.jsonl`),
];
const moved: [string, string][] = [];

function agent(tool: string, args: unknown, env: Record<string, string> = {}) {
  const base: NodeJS.ProcessEnv = { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_YTDLP_LOG: LOG, FAKE_YTDLP_CLIP: CLIP, JBL_STILLS_ORIGIN: stillsOrigin, ...env };
  if (!("JBL_YTDLP" in env)) delete base.JBL_YTDLP;
  const r = spawnSync(process.execPath, [CLI, tool, "--json", JSON.stringify(args)], { cwd: ROOT, env: base, encoding: "utf8", timeout: 240_000 });
  const last = r.stdout.trim().split("\n").pop() ?? "";
  return { code: r.status, json: JSON.parse(last || "null"), stderr: r.stderr };
}
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);

describe("the video tools end to end, with a fake yt-dlp (--- inspiration ---)", () => {
  const ffmpeg = resolveFfmpeg();
  beforeAll(async () => {
    fs.mkdirSync(BIN, { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, "backup"), { recursive: true });
    fs.writeFileSync(path.join(BIN, "yt-dlp"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\n`, { mode: 0o755 });
    touched().forEach((p, i) => {
      if (fs.existsSync(p)) {
        const aside = path.join(TEST_DIR, "backup", String(i));
        fs.renameSync(p, aside);
        moved.push([p, aside]);
      }
    });
    if (ffmpeg) {
      const make = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=880:beep_factor=4:d=6", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "aac", "-shortest", CLIP], { encoding: "utf8", timeout: 60_000 });
      if (make.status !== 0) throw new Error(make.stderr);
      // --- inspiration --- the stills the stand-in serves: the opening frame in the Short's shape, three letterboxed 4:3 ones, no cover
      fs.mkdirSync(STILLS_DIR, { recursive: true });
      for (const [name, size] of [["frame0", "270x480"], ["hq1", "480x360"], ["hq2", "480x360"], ["hq3", "480x360"]]) {
        const still = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=${size}:d=1`, "-frames:v", "1", path.join(STILLS_DIR, `${name}.jpg`)], { encoding: "utf8", timeout: 60_000 });
        if (still.status !== 0) throw new Error(still.stderr);
      }
      stillsServer = spawn(process.execPath, [STILLS_SERVER, STILLS_DIR, STILLS_LOG], { stdio: ["ignore", "pipe", "inherit"] });
      const port = await new Promise<string>((resolve, reject) => {
        stillsServer!.stdout!.once("data", (c: Buffer) => resolve(c.toString().trim()));
        stillsServer!.once("exit", (code) => reject(new Error(`the stills stand-in exited (${code})`)));
      });
      stillsOrigin = `http://127.0.0.1:${port}`;
    }
  });
  afterAll(() => {
    stillsServer?.kill();
    for (const p of touched()) fs.rmSync(p, { recursive: true, force: true });
    for (const [p, aside] of moved) fs.renameSync(aside, p);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("finds trending videos from the search, the Shorts feed and given links, each with its numbers, and never reaches the network", () => {
    const r = agent("trending", { query: DEFAULT_QUERY, limit: 6, maxDurationSec: 180, urls: ["https://www.tiktok.com/@channel_7/video/7508828818702978326", "http://169.254.169.254/latest/"] });
    expect(r.code, JSON.stringify(r.json)).toBe(0);
    const res = r.json.result;
    expect(res).toMatchObject({ query: DEFAULT_QUERY, count: 6, sources: { search: 8, shorts: 6, urls: 1 }, ytdlp: { source: "PATH", version: "2099.01.01-fake" }, refused: [{ url: "http://169.254.169.254/latest/", error: expect.stringMatching(/private network/) }] });
    expect(res.videos.map((v: VideoMeta) => v.key)).toEqual(["tiktok:7508828818702978326", "youtube:FFJ5THnzdDE", "youtube:o-DtHwlRIqU", "youtube:8aj37SIIbQc", "youtube:WGZeukpDBMw", "youtube:iOjJe2bjOCg"]);
    for (const v of res.videos as VideoMeta[]) {
      for (const k of ["url", "platform", "title", "channel", "views", "likes", "comments", "durationSec", "uploadDate", "viewsPerDay"]) expect(v, `${v.key} ${k}`).toHaveProperty(k);
      expect(v.short).toBe(true);
    }
    expect(res.videos[1]).toMatchObject({ views: 806359, likes: 2450, uploadDate: "2026-10-11", detailed: true });
    // every run without the user's config or a cache; every link after --
    const runs = calls().filter((c) => !c.includes("--version"));
    expect(runs.length).toBeGreaterThanOrEqual(3);
    for (const c of runs) {
      expect(c.slice(0, 2)).toEqual(["--ignore-config", "--no-cache-dir"]);
      expect(c).toContain("--");
    }
    expect(runs.some((c) => c.includes("https://www.youtube.com/hashtag/ballsimulation/shorts"))).toBe(true);
    expect(runs.flat().some((a) => a.includes("169.254"))).toBe(false); // the refused link never reached yt-dlp
  });

  it("says what is missing without yt-dlp, and takes JBL_YTDLP (a script runs with this Node)", () => {
    const empty = path.join(TEST_DIR, "empty");
    fs.mkdirSync(empty, { recursive: true });
    const none = agent("trending", { limit: 2 }, { PATH: empty });
    expect(none.code).toBe(1);
    expect(none.json.error).toMatch(/No yt-dlp found: .*JBL_YTDLP/);
    const viaEnv = agent("trending", { limit: 2, details: false }, { PATH: empty, JBL_YTDLP: FAKE });
    expect(viaEnv.code, JSON.stringify(viaEnv.json)).toBe(0);
    expect(viaEnv.json.result).toMatchObject({ count: 2, pages: { read: 0, unread: 0 }, ytdlp: { source: "JBL_YTDLP" } });
    // (a search asks for half as many again as it returns: the fake's first three rows, the two most viewed of them)
    expect(calls().some((c) => c[c.length - 1] === "ytsearch3:ball simulation")).toBe(true);
    expect(viaEnv.json.result.videos.map((v: VideoMeta) => v.id)).toEqual(["wGN0hxfuqiE", "OKZltUoI7eE"]);
  });

  it("fetches a video into .agent-out/inbox/<platform>-<id>.mp4 with its info JSON, reuses it, and refuses a private link before yt-dlp runs", () => {
    const url = "https://www.tiktok.com/@channel_7/video/7508828818702978326";
    const first = agent("fetch-video", { url });
    if (!ffmpeg) {
      // (without ffmpeg the fake still hands its file out; nothing here needs ffmpeg but the clip it copies)
      expect(first.json.error ?? "").toMatch(/FAKE_YTDLP_CLIP|No ffmpeg/);
      return;
    }
    expect(first.code, JSON.stringify(first.json)).toBe(0);
    expect(first.json.result).toMatchObject({ file: ".agent-out/inbox/tiktok-7508828818702978326.mp4", infoFile: ".agent-out/inbox/tiktok-7508828818702978326.info.json", cached: false, meta: { platform: "tiktok", views: 4100000 } });
    expect(fs.statSync(path.join(ROOT, first.json.result.file)).size).toBe(fs.statSync(CLIP).size);
    expect(fs.readdirSync(path.join(ROOT, ".agent-out", "inbox")).filter((f) => f.startsWith(".fetch-"))).toEqual([]); // the fresh folder is gone
    expect(agent("fetch-video", { url }).json.result.cached).toBe(true);
    expect(agent("fetch-video", { url, force: true }).json.result.cached).toBe(false);
    const before = calls().length;
    const refused = agent("fetch-video", { url: "http://192.168.0.1/v.mp4" });
    expect(refused.code).toBe(1);
    expect(refused.json.error).toMatch(/private network/);
    expect(calls().length).toBe(before);
  });

  // --- inspiration --- one video per link
  it("reads one entry of a playlist, channel or profile link at most and refuses it as a list, keeping the other links' pages", () => {
    const list = "https://www.youtube.com/@channel_1/shorts";
    const before = calls().length;
    const fetched = agent("fetch-video", { url: list });
    expect(fetched.code).toBe(1);
    expect(fetched.json.error).toMatch(/is a list of videos .*not one video/);
    const runs = calls().slice(before).filter((c) => !c.includes("--version"));
    expect(runs).toHaveLength(1); // the page, nothing downloaded
    expect(runs[0]).toContain("--skip-download");
    expect(runs[0][runs[0].indexOf("--playlist-items") + 1]).toBe("1");
    const tiktok = "https://www.tiktok.com/@channel_7/video/7508828818702978326";
    const r = agent("trending", { urls: [list, tiktok] });
    expect(r.code, JSON.stringify(r.json)).toBe(0);
    expect(r.json.result).toMatchObject({ count: 1, sources: { urls: 1 }, refused: [{ url: list, error: expect.stringMatching(/is a list of videos/) }] });
    expect(r.json.result.videos[0]).toMatchObject({ key: "tiktok:7508828818702978326", views: 4100000, detailed: true });
  });

  it("cuts frames and contact sheets for a vision-capable AI, and analyses a link exactly as a file", () => {
    if (!ffmpeg) {
      expect(agent("frames", { path: path.relative(ROOT, CLIP) }).json.error).toMatch(/No ffmpeg found/);
      return;
    }
    const out = `test-inspiration-${process.pid}`;
    const r = agent("frames", { path: path.relative(ROOT, CLIP), out });
    expect(r.code, JSON.stringify(r.json)).toBe(0);
    const res = r.json.result;
    expect(res.dir).toBe(`.agent-out/frames/${out}`);
    expect(res.frames).toHaveLength(12);
    expect(res.hook.map((h: { sec: number }) => h.sec)).toEqual(hookTimes(6));
    const png = (rel: string) => fs.readFileSync(path.join(ROOT, rel)).subarray(0, 8).toString("hex");
    for (const f of [res.sheet, res.hookSheet, res.frames[0].file, res.hook[0].file]) expect(png(f), f).toBe("89504e470d0a1a0a");
    // a second, smaller run replaces the first one's frames
    const again = agent("frames", { path: path.relative(ROOT, CLIP), out, count: 4, hookSec: 0, sheet: false });
    expect(again.json.result).toMatchObject({ hook: [], sheet: null, hookSheet: null });
    expect(fs.readdirSync(path.join(ROOT, res.dir)).sort()).toEqual(["frame-01.png", "frame-02.png", "frame-03.png", "frame-04.png"]);
    // analyse with a link: fetched first (here: reused), then measured as the file is
    const url = "https://www.tiktok.com/@channel_7/video/7508828818702978326";
    const byUrl = agent("analyse", { url });
    expect(byUrl.code, JSON.stringify(byUrl.json)).toBe(0);
    const byPath = agent("analyse", { path: byUrl.json.result.file });
    expect(byUrl.json.result.features).toEqual(byPath.json.result.features);
    expect(byUrl.json.result.fetched).toMatchObject({ url, meta: { key: "tiktok:7508828818702978326" } });
    // a link given as a path is still no file: the answer says how
    expect(agent("analyse", { path: url }).json.error).toMatch(/give a video link as url/);
  }, 240_000);

  // --- inspiration --- the frames' work ceilings end to end, and a contact sheet ffmpeg cannot make
  it("makes no more frames than the video has, says what it cut, and returns the frames when a sheet cannot be made", async () => {
    if (!ffmpeg) return;
    const small = path.join(TEST_DIR, "small.mp4");
    const make = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x112:r=10:d=2", "-c:v", "mpeg4", "-q:v", "4", small], { encoding: "utf8", timeout: 60_000 });
    expect(make.status, make.stderr).toBe(0);
    const out = `test-inspiration-${process.pid}`;
    const r = agent("frames", { path: path.relative(ROOT, small), out, count: 1_000_000_000, hookSec: 0, width: 64 });
    expect(r.code, JSON.stringify(r.json)).toBe(0);
    expect(r.json.result.frames).toHaveLength(20); // (2 s at 10 fps)
    expect(r.json.result.limited).toEqual({ count: { asked: 1_000_000_000, made: 20 } });
    expect(fs.readFileSync(path.join(ROOT, r.json.result.sheet)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // a sheet whose ffmpeg run fails to start (as E2BIG did) leaves the frames as they are, with no sheet
    const failing = { ...ffmpegArgs, parseMediaInfo, sheetArgs: () => { throw new Error("spawn E2BIG"); } };
    const res = await extractFrames(failing, ffmpeg, small, { name: out, count: 4, hookSec: 0 });
    expect(res.frames).toHaveLength(4);
    expect(res.sheet).toBeNull();
    expect(fs.readdirSync(path.join(ROOT, res.dir)).sort()).toEqual(["frame-01.png", "frame-02.png", "frame-03.png", "frame-04.png"]);
  }, 240_000);

  it("runs the whole inspiration pipeline: a report in our levers, a failed video kept with its error, the dataset grown once per video", () => {
    const ours = path.join(TEST_DIR, "ours");
    if (!ffmpeg) {
      expect(agent("inspire", { query: QUERY, top: 1 }).json.error).toMatch(/No ffmpeg found/);
      return;
    }
    fs.mkdirSync(ours, { recursive: true });
    fs.copyFileSync(CLIP, path.join(ours, "clip.mp4"));
    const args = { query: QUERY, limit: 6, top: 2, ours: path.relative(ROOT, ours), dataset: DATASET };
    const r = agent("inspire", args);
    expect(r.code, JSON.stringify(r.json)).toBe(0);
    const res = r.json.result;
    expect(res.counts).toEqual({ candidates: 6, analysed: 1, failed: 1, ours: 1 });
    expect(res.videos[0]).toMatchObject({ url: "https://www.youtube.com/shorts/FFJ5THnzdDE", analysed: true, sheet: ".agent-out/frames/youtube-FFJ5THnzdDE/sheet.png" });
    expect(res.videos[1]).toMatchObject({ url: "https://www.youtube.com/shorts/o-DtHwlRIqU", analysed: false, error: expect.stringMatching(/Video unavailable/) });
    const report = JSON.parse(fs.readFileSync(path.join(ROOT, res.report), "utf8"));
    expect(report).toMatchObject({ v: 1, query: QUERY, metric: "views", ours: { files: [path.relative(ROOT, path.join(ours, "clip.mp4")).split(path.sep).join("/")] } });
    expect(report.recommendations.some((x: { area: string; levers: { link?: string }[] }) => x.area === "length" && x.levers[0].link === "dur")).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, res.markdown), "utf8")).toMatch(/^# Inspiration: ball simulation test/);
    expect(res.dataset).toEqual({ file: `.agent-out/inspiration/${DATASET}.jsonl`, added: 1, total: 1 });
    const line = JSON.parse(fs.readFileSync(path.join(ROOT, res.dataset.file), "utf8").trim());
    expect(line).toMatchObject({ key: "youtube:FFJ5THnzdDE", query: QUERY, traits: { durationSec: expect.any(Number) }, features: { cuts: expect.any(Number) } });
    expect(line.features.motion).toBeUndefined();
    // a second run adds nothing it already holds
    expect(agent("inspire", { ...args, frames: false }).json.result.dataset).toEqual({ file: `.agent-out/inspiration/${DATASET}.jsonl`, added: 0, total: 1 });
  }, 240_000);

  // --- inspiration --- the stills fallback, read from the stand-in for YouTube's image host
  it("sees a video it cannot fetch through its public stills: a stills sheet, their colours, only that host and only that video's paths", () => {
    if (!resolveFfmpeg()) return;
    const before = stillRequests().length;
    const args = { query: QUERY, limit: 6, top: 2, oursMax: 0, dataset: DATASET, frames: false };
    const r = agent("inspire", args);
    expect(r.code, JSON.stringify(r.json)).toBe(0);
    const res = r.json.result;
    expect(res.stillsOnly).toBe(1);
    expect(res.videos[1]).toMatchObject({ url: "https://www.youtube.com/shorts/o-DtHwlRIqU", analysed: false, stillsSheet: ".agent-out/frames/youtube-o-DtHwlRIqU/stills-sheet.png", error: expect.stringMatching(/Video unavailable/) });
    const sheet = path.join(ROOT, res.videos[1].stillsSheet);
    expect(fs.readFileSync(sheet).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const report = JSON.parse(fs.readFileSync(path.join(ROOT, res.report), "utf8"));
    const seen = report.videos.find((v: { key: string }) => v.key === "youtube:o-DtHwlRIqU");
    expect(seen).toMatchObject({ measured: "stills", stills: { colour: { stills: 4 } } });
    expect(seen.stills.files.map((f: { label: string }) => f.label)).toEqual(["start", "25%", "50%", "75%"]); // no cover: the host has none
    expect(seen.traits.meanLuma).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(ROOT, res.markdown), "utf8")).toContain("(1 seen from stills)");
    const asked = stillRequests().slice(before);
    expect([...asked].sort()).toEqual(["frame0", "hq1", "hq2", "hq3", "oardefault"].map((n) => `/vi/o-DtHwlRIqU/${n}.jpg`));
    // stills false: none read; a stills host that is not this machine: refused before anything runs
    const quiet = agent("inspire", { ...args, stills: false });
    expect(quiet.json.result.stillsOnly).toBe(0);
    expect(stillRequests().length).toBe(before + asked.length);
    const elsewhere = agent("inspire", args, { JBL_STILLS_ORIGIN: "https://example.com" });
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.json.error).toMatch(/JBL_STILLS_ORIGIN may only name a server on this machine/);
  }, 240_000);
});
