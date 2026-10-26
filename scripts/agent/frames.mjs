/**
 * --- inspiration --- `npm run agent -- frames --json '{"path":"…"}'` (or `{"url":"…"}`): still frames of a video for a
 * vision-capable AI to look at – `count` frames spread evenly over it (frame-01.png …), the opening `hookSec` seconds every
 * `hookStepSec` (hook-01.png …: the hook a viewer decides on), and a contact sheet of each (sheet.png, hook-sheet.png) – in
 * .agent-out/frames/<name>/. The ffmpeg command lines are pure (src/lib/videoAnalysis/ffmpegArgs.ts): every input is
 * opened as a local file only, every output is a bare name in that folder, written under a fresh name and renamed into
 * place (a link a checkout carries there is replaced, never written through). A link is fetched into .agent-out/inbox/
 * first (videoSources.mjs); the frames of an earlier run in the folder are replaced.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NO_FFMPEG, resolveFfmpeg, runFfmpeg } from "./analyse.mjs";
import { OUT_DIR, defaultOutName, isInside, outFolder, repoRelative, resolveInputFile } from "./paths.mjs";

const OUR_FILES = /^(frame-\d+\.png|hook-\d+\.png|sheet\.png|hook-sheet\.png)$/;
/** ffmpeg passes run at once. */
const PASSES = 4;

const fresh = (name) => `.${name}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.png`;

/** One PNG written by ffmpeg (args built for `tmpName`) and renamed to `name` in `dir`; false when ffmpeg wrote nothing. */
export async function writePng(ffmpeg, dir, name, makeArgs) {
  const tmpName = fresh(name);
  const tmp = path.join(dir, tmpName);
  try {
    const r = await runFfmpeg(ffmpeg.path, makeArgs(tmpName), { cwd: dir });
    if (r.code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) return false;
    fs.renameSync(tmp, path.join(dir, name));
    return true;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function eachLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/**
 * The frames and sheets of `file` (a real path inside the repository) in .agent-out/frames/<name>/: { dir, durationSec,
 * width, height, frames: [{ file, sec }], hook: [{ file, sec }], sheet, hookSheet } with repository-relative paths.
 */
export async function extractFrames(tb, ffmpeg, file, { name, count = 12, hookSec = tb.HOOK_SEC, hookStepSec = tb.HOOK_STEP_SEC, width = tb.FRAME_WIDTH, sheet = true }) {
  const info = tb.parseMediaInfo((await runFfmpeg(ffmpeg.path, tb.infoArgs(file), { cwd: OUT_DIR })).stderr);
  if (!info.hasVideo) throw new Error(`${repoRelative(file)} has no video stream ffmpeg can read`);
  if (!info.durationSec) throw new Error(`${repoRelative(file)} has no duration ffmpeg can read`);
  const dir = outFolder("frames", name);
  for (const f of fs.readdirSync(dir)) if (OUR_FILES.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const pad = (i, n) => String(i + 1).padStart(Math.max(2, String(n).length), "0");
  const shots = [
    ...tb.frameTimes(info.durationSec, count).map((sec, i, all) => ({ kind: "frame", sec, name: `frame-${pad(i, all.length)}.png` })),
    ...tb.hookTimes(info.durationSec, hookSec, hookStepSec).map((sec, i, all) => ({ kind: "hook", sec, name: `hook-${pad(i, all.length)}.png` })),
  ];
  const written = new Set();
  await eachLimit(shots, PASSES, async (s) => {
    if (await writePng(ffmpeg, dir, s.name, (tmpName) => tb.frameArgs(file, s.sec, tmpName, width))) written.add(s.name);
  });
  const rel = (n) => repoRelative(path.join(dir, n));
  const frames = shots.filter((s) => s.kind === "frame" && written.has(s.name)).map((s) => ({ file: rel(s.name), sec: s.sec }));
  const hook = shots.filter((s) => s.kind === "hook" && written.has(s.name)).map((s) => ({ file: rel(s.name), sec: s.sec }));
  if (!frames.length && !hook.length) throw new Error(`ffmpeg wrote no frame of ${repoRelative(file)}`);
  const portrait = info.width !== null && info.height !== null && info.height > info.width;
  const tileW = tb.SHEET_TILE_WIDTH;
  const tileH = info.width && info.height ? Math.round((tileW * info.height) / info.width) : Math.round(tileW * (portrait ? 16 / 9 : 9 / 16));
  const makeSheet = async (list, sheetName) => {
    if (!sheet || !list.length) return null;
    const names = list.map((f) => path.basename(f.file));
    const ok = await writePng(ffmpeg, dir, sheetName, (tmpName) => tb.sheetArgs(names, tmpName, tb.sheetGrid(names.length, portrait), tileW, tileH));
    return ok ? rel(sheetName) : null;
  };
  const [sheetFile, hookSheet] = await Promise.all([makeSheet(frames, "sheet.png"), makeSheet(hook, "hook-sheet.png")]);
  return { dir: repoRelative(dir), durationSec: info.durationSec, width: info.width, height: info.height, frames, hook, sheet: sheetFile, hookSheet };
}

/** The frames folder's default name: the inbox file's own (<platform>-<id>), else the file's name and a hash of its path. */
export function framesName(file) {
  const base = path.basename(file, path.extname(file));
  if (isInside(path.join(OUT_DIR, "inbox"), file) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base)) return base;
  return defaultOutName(base, { path: repoRelative(file) });
}

export async function framesTool(tb, args) {
  const ffmpeg = resolveFfmpeg();
  let file;
  let fetched = null;
  if (args.url !== undefined) {
    if (!ffmpeg) throw new Error(NO_FFMPEG);
    const { fetchVideo } = await import("./videoSources.mjs");
    fetched = await fetchVideo(tb, { url: args.url, maxHeight: args.maxHeight });
    file = fetched.absolute;
  } else {
    file = resolveInputFile(args.path);
    if (!ffmpeg) throw new Error(NO_FFMPEG);
  }
  const result = await extractFrames(tb, ffmpeg, file, { name: args.out ?? framesName(file), count: args.count ?? 12, hookSec: args.hookSec ?? tb.HOOK_SEC, hookStepSec: args.hookStepSec ?? tb.HOOK_STEP_SEC, width: args.width ?? tb.FRAME_WIDTH, sheet: args.sheet !== false });
  return {
    video: repoRelative(file),
    ...(fetched ? { fetched: { url: fetched.url, cached: fetched.cached, meta: fetched.meta } } : {}),
    ...result,
    note: "Look at sheet.png for the whole video and hook-sheet.png for its opening; the single frames are beside them.",
  };
}
