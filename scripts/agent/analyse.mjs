/**
 * --- agent-cli --- `npm run agent -- analyse --json '{"path":"…"}'`: the numeric features of a video file
 * (src/lib/videoAnalysis: the ffmpeg arguments, their parsers and the VideoFeatures record), measured with ffmpeg:
 *  1. FFMPEG_PATH when set; 2. the Windows app's bundled ffmpeg (desktop/node_modules/ffmpeg-static, after `npm ci` in
 *  desktop/); 3. `ffmpeg` on the PATH. None: a clear message, nothing measured.
 * Any video: the owner's own clips, or other creators' trending and viral videos from TikTok, Instagram, YouTube or any site,
 * downloaded into .agent-out/inbox/ first (paths.mjs answers a URL with that, and refuses links that lead out of the
 * repository); ffmpeg opens the file as `file:` with only the file protocol and video demuxers allowed, so a file cannot make
 * it reach the network. The file is read, never copied, uploaded or kept; ffmpeg's scratch output (scdet's metadata)
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

/** The ffmpeg to use: { path, source: "FFMPEG_PATH" | "bundled" | "system", version } or null. */
export function resolveFfmpeg(env = process.env) {
  const probe = (file) => {
    const r = spawnSync(file, ["-hide_banner", "-version"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return (/ffmpeg version (\S+)/.exec(r.stdout) ?? [])[1] ?? "unknown";
  };
  const candidates = [];
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

export async function analyseTool(tb, args) {
  const file = resolveInputFile(args.path);
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("No ffmpeg found: install the Windows app's (cd desktop && npm ci – ffmpeg-static), install ffmpeg on the PATH, or set FFMPEG_PATH. Nothing was measured.");
  const sampleHz = args.sampleHz ?? 2;
  const window = { maxSec: args.maxSec ?? 300 };
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
    const features = tb.buildVideoFeatures({
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
    return { file: repoRelative(file), bytes: fs.statSync(file).size, ffmpeg: { source: ffmpeg.source, version: ffmpeg.version }, features };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
