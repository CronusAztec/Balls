/**
 * --- agent-cli --- `npm run agent -- analyse --json '{"path":"…"}'` (or `{"url":"…"}`): the numeric features of a video
 * (src/lib/videoAnalysis: the ffmpeg arguments, their parsers and the VideoFeatures record), measured with ffmpeg:
 *  1. JBL_FFMPEG, else FFMPEG_PATH, when set; 2. the Windows app's bundled ffmpeg (desktop/node_modules/ffmpeg-static,
 *  after `npm ci` in desktop/); 3. `ffmpeg` on the PATH. None: a clear message, nothing measured.
 * Any video: the owner's own clips, or other creators' trending and viral videos from TikTok, Instagram, YouTube or any site.
 * --- inspiration --- A link (url) is fetched into .agent-out/inbox/ first (videoSources.mjs, as the fetch-video tool does)
 * and the file is then measured exactly as a path is; a path must be a file inside the repository (paths.mjs refuses links
 * that lead out of it). ffmpeg opens the file as `file:` with only the file protocol and video demuxers allowed, so a file
 * cannot make it reach the network. The file is read, never copied, uploaded or kept; ffmpeg's scratch output (scdet's metadata)
 * goes to a temp folder in the agent cache that is removed when the analysis ends. ffmpeg runs with argument arrays (no
 * shell) and a timeout per pass.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { ROOT, cacheDir, repoRelative, resolveInputFile } from "./paths.mjs";

export const PASS_TIMEOUT_MS = 120_000;
const MAX_STDOUT = 40 * 1024 * 1024;
const MAX_STDERR = 4 * 1024 * 1024;

/** The ffmpeg to use: { path, source: "JBL_FFMPEG" | "FFMPEG_PATH" | "bundled" | "system", version } or null. */
export function resolveFfmpeg(env = process.env) {
  const probe = (file) => {
    const r = spawnSync(file, ["-hide_banner", "-version"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return (/ffmpeg version (\S+)/.exec(r.stdout) ?? [])[1] ?? "unknown";
  };
  const candidates = [];
  if (env.JBL_FFMPEG) candidates.push({ path: env.JBL_FFMPEG, source: "JBL_FFMPEG" }); // --- inspiration --- the toolbox's own override
  if (env.FFMPEG_PATH) candidates.push({ path: env.FFMPEG_PATH, source: "FFMPEG_PATH" });
  const bundled = path.join(ROOT, "desktop", "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (fs.existsSync(bundled)) candidates.push({ path: bundled, source: "bundled" });
  candidates.push({ path: process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg", source: "system" });
  for (const c of candidates) {
    const version = probe(c.path);
    if (version) return { ...c, version };
  }
  return null;
}

/** One ffmpeg pass: its exit code, stdout (bytes) and stderr (text); rejects on a timeout or an output past its cap. */
export function runFfmpeg(ffmpeg, args, { cwd, timeoutMs = PASS_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out = [];
    let outBytes = 0;
    let err = "";
    let done = false;
    const stop = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(e);
    };
    const timer = setTimeout(() => stop(new Error(`ffmpeg took longer than ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    child.stdout.on("data", (c) => {
      outBytes += c.length;
      if (outBytes > MAX_STDOUT) stop(new Error("ffmpeg's output is larger than the analyser reads"));
      else out.push(c);
    });
    child.stderr.setEncoding("utf8"); // (one decoder for the stream: a character split between two reads stays whole)
    child.stderr.on("data", (c) => {
      if (err.length < MAX_STDERR) err += c;
    });
    child.on("error", (e) => stop(e));
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: new Uint8Array(Buffer.concat(out)), stderr: err });
    });
  });
}

const lastLine = (text) => text.trim().split("\n").pop()?.trim() ?? "";

/** --- inspiration --- What analyse and inspire say when there is no ffmpeg. */
export const NO_FFMPEG = "No ffmpeg found: install the Windows app's (cd desktop && npm ci – ffmpeg-static), install ffmpeg on the PATH, or set JBL_FFMPEG (or FFMPEG_PATH). Nothing was measured.";

/**
 * --- inspiration --- The VideoFeatures of one file (a real path inside the repository), measured with `ffmpeg`
 * (resolveFfmpeg's answer): analyse's own measurement, which inspire reuses for every fetched video and our renders.
 */
export async function measureFile(tb, ffmpeg, file, { sampleHz = 2, maxSec = 300 } = {}) {
  const window = { maxSec };
  const tmp = fs.mkdtempSync(path.join(cacheDir("analyse"), "run-"));
  try {
    const info = tb.parseMediaInfo((await runFfmpeg(ffmpeg.path, tb.infoArgs(file), { cwd: tmp })).stderr);
    if (!info.hasVideo) throw new Error(`${repoRelative(file)} has no video stream ffmpeg can read (an MP4, MOV, WebM, MKV, AVI or GIF file is needed)`);
    const check = (pass, r) => {
      if (r.code !== 0) throw new Error(`ffmpeg could not read ${repoRelative(file)} (${pass}: ${lastLine(r.stderr) || `exit ${r.code}`})`);
      return r;
    };
    const [frames, last, cuts, audioStats, pcm] = await Promise.all([
      runFfmpeg(ffmpeg.path, tb.sampleFramesArgs(file, sampleHz, window), { cwd: tmp }).then((r) => check("pictures", r)),
      runFfmpeg(ffmpeg.path, tb.lastFramesArgs(file), { cwd: tmp }),
      runFfmpeg(ffmpeg.path, tb.cutsArgs(file, "cuts.txt", window), { cwd: tmp }).then((r) => check("cuts", r)),
      info.hasAudio ? runFfmpeg(ffmpeg.path, tb.audioStatsArgs(file, window), { cwd: tmp }) : null,
      info.hasAudio ? runFfmpeg(ffmpeg.path, tb.pcmArgs(file, window), { cwd: tmp }) : null,
    ]);
    const cutsFile = path.join(tmp, "cuts.txt");
    const lastFrames = last.code === 0 ? tb.splitFrames(last.stdout, tb.SAMPLE_BYTES) : [];
    return tb.buildVideoFeatures({
      info,
      sampleHz,
      maxSec: window.maxSec,
      frames: tb.splitFrames(frames.stdout, tb.SAMPLE_BYTES),
      lastFrame: lastFrames[lastFrames.length - 1],
      cuts: fs.existsSync(cutsFile) ? tb.parseCuts(fs.readFileSync(cutsFile, "utf8")) : [],
      lufs: audioStats && audioStats.code === 0 ? tb.parseIntegratedLufs(audioStats.stderr) : null,
      silences: audioStats && audioStats.code === 0 ? tb.parseSilences(audioStats.stderr, info.durationSec) : [],
      sound: pcm && pcm.code === 0 ? tb.soundFeatures(tb.pcmSamples(pcm.stdout), tb.PCM_RATE) : null,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function analyseTool(tb, args) {
  const ffmpeg = resolveFfmpeg();
  // --- inspiration --- a link is fetched first (a file already in .agent-out/inbox/ is reused), then measured as a file
  let fetched = null;
  let file;
  if (args.url !== undefined) {
    if (!ffmpeg) throw new Error(NO_FFMPEG);
    const { fetchVideo } = await import("./videoSources.mjs");
    fetched = await fetchVideo(tb, { url: args.url, maxHeight: args.maxHeight });
    file = fetched.absolute;
  } else {
    file = resolveInputFile(args.path);
    if (!ffmpeg) throw new Error(NO_FFMPEG);
  }
  const features = await measureFile(tb, ffmpeg, file, { sampleHz: args.sampleHz ?? 2, maxSec: args.maxSec ?? 300 });
  return {
    file: repoRelative(file),
    bytes: fs.statSync(file).size,
    ffmpeg: { source: ffmpeg.source, version: ffmpeg.version },
    ...(fetched ? { fetched: { url: fetched.url, cached: fetched.cached, meta: fetched.meta } } : {}),
    features,
  };
}
