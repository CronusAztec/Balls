/**
 * --- inspiration --- `npm run agent -- frames --json '{"path":"…"}'` (or `{"url":"…"}`): still frames of a video for a
 * vision-capable AI to look at – `count` frames spread evenly over it (frame-01.png …), the opening `hookSec` seconds every
 * `hookStepSec` (hook-01.png …: the hook a viewer decides on), and a contact sheet of each (sheet.png, hook-sheet.png) – in
 * .agent-out/frames/<name>/. The ffmpeg command lines are pure (src/lib/videoAnalysis/ffmpegArgs.ts): every input is
 * opened as a local file only, every output is a bare name in that folder, written under a fresh name and renamed into
 * place (a link a checkout carries there is replaced, never written through). A link is fetched into .agent-out/inbox/
 * first (videoSources.mjs); the frames of an earlier run in the folder are replaced. The work ceilings (ffmpegArgs.ts
 * framePlan, sheetPick): never more frames than the video has or than FRAMES_CEILING of each kind, and a sheet of
 * SHEET_TILES_CEILING frames at most (an even pick of them); the result's `limited` says what was cut, and a sheet ffmpeg
 * cannot make is null, the frames still returned.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NO_FFMPEG, pictureEnd, resolveFfmpeg, runFfmpeg } from "./analyse.mjs";
import { OUT_DIR, ROOT, defaultOutName, isInside, outFolder, repoRelative, resolveInputFile } from "./paths.mjs";

const OUR_FILES = /^(frame-\d+\.png|hook-\d+\.png|sheet\.png|hook-sheet\.png|sheet\.jpg)$/;
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
 * The frames and sheets of `file` (a real path inside the repository) in .agent-out/frames/<name>/ (--- studio --- or the
 * folder `folder` names under .agent-out/: a studio clip's own): { dir, durationSec, width, height, frames: [{ file, sec }],
 * hook: [{ file, sec }], sheet, hookSheet } with repository-relative paths.
 */
export async function extractFrames(tb, ffmpeg, file, { name, count = 12, hookSec = tb.HOOK_SEC, hookStepSec = tb.HOOK_STEP_SEC, width = tb.FRAME_WIDTH, sheet = true, folder = ["frames", name] }) {
  const banner = tb.parseMediaInfo((await runFfmpeg(ffmpeg.path, tb.infoArgs(file), { cwd: OUT_DIR })).stderr);
  if (!banner.hasVideo) throw new Error(`${repoRelative(file)} has no video stream ffmpeg can read`);
  if (!banner.durationSec) throw new Error(`${repoRelative(file)} has no duration ffmpeg can read`);
  // --- inspiration --- a sound that runs on past the picture: the frames are spread over the picture, not the sound
  const end = await pictureEnd(tb, ffmpeg, file, banner, OUT_DIR);
  const info = end === null ? banner : { ...banner, durationSec: end };
  const dir = outFolder(...folder);
  for (const f of fs.readdirSync(dir)) if (OUR_FILES.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const pad = (i, n) => String(i + 1).padStart(Math.max(2, String(n).length), "0");
  const plan = tb.framePlan(info.durationSec, info.fps, { count, hookSec, hookStepSec });
  const shots = [
    ...plan.frames.map((sec, i, all) => ({ kind: "frame", sec, name: `frame-${pad(i, all.length)}.png` })),
    ...plan.hook.map((sec, i, all) => ({ kind: "hook", sec, name: `hook-${pad(i, all.length)}.png` })),
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
  const limited = { ...plan.limited, ...(plan.limited?.count ? { count: { ...plan.limited.count, made: frames.length } } : {}) };
  const makeSheet = async (list, sheetName, key) => {
    if (!sheet || !list.length) return null;
    // --- inspiration --- at most SHEET_TILES_CEILING pictures, spread evenly; a sheet that fails leaves the frames as they are
    const names = tb.sheetPick(list.length).map((i) => path.basename(list[i].file));
    if (names.length < list.length) limited[key] = { frames: list.length, tiles: names.length };
    try {
      const ok = await writePng(ffmpeg, dir, sheetName, (tmpName) => tb.sheetArgs(names, tmpName, tb.sheetGrid(names.length, portrait), tileW, tileH));
      return ok ? rel(sheetName) : null;
    } catch (e) {
      process.stderr.write(`agent frames: no ${sheetName}: ${e instanceof Error ? e.message : String(e)}\n`);
      return null;
    }
  };
  const [sheetFile, hookSheet] = await Promise.all([makeSheet(frames, "sheet.png", "sheet"), makeSheet(hook, "hook-sheet.png", "hookSheet")]);
  return { dir: repoRelative(dir), durationSec: info.durationSec, width: info.width, height: info.height, frames, hook, sheet: sheetFile, hookSheet, ...(Object.keys(limited).length ? { limited } : {}) };
}

// --- studio --- an image block: a sheet as one JPEG of at most IMAGE_MAX_BYTES (before base64), for a model that cannot
// read files (Claude Desktop over MCP); the MCP server counts its base64 against the result's 200 KB
/**
 * The sheet `pngName` in `dir` as `jpegName` beside it, at the first width and quality of tb.JPEG_STEPS that fits in
 * `maxBytes`: { file, mimeType, bytes, width, quality, data } (data: base64), or null when none fits or ffmpeg fails.
 */
export async function jpegUnder(tb, ffmpeg, dir, pngName, jpegName = "sheet.jpg", maxBytes = tb.IMAGE_MAX_BYTES) {
  for (const width of tb.JPEG_STEPS.widths) {
    for (const quality of tb.JPEG_STEPS.qualities) {
      if (!(await writePng(ffmpeg, dir, jpegName, (tmpName) => tb.jpegArgs(pngName, tmpName, width, quality)))) return null;
      const full = path.join(dir, jpegName);
      const bytes = fs.statSync(full).size;
      if (bytes <= maxBytes) return { file: repoRelative(full), mimeType: "image/jpeg", bytes, width, quality, data: fs.readFileSync(full).toString("base64") };
    }
  }
  fs.rmSync(path.join(dir, jpegName), { force: true });
  return null;
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
  const result = await extractFrames(tb, ffmpeg, file, { name: args.out ?? framesName(file), count: args.count ?? 12, hookSec: args.hookSec ?? tb.HOOK_SEC, hookStepSec: args.hookStepSec ?? tb.HOOK_STEP_SEC, width: args.width ?? tb.FRAME_WIDTH, sheet: args.sheet !== false || args.image === true });
  // --- studio --- the whole video's sheet as an image block, on request
  let image;
  if (args.image === true) {
    const made = result.sheet ? await jpegUnder(tb, ffmpeg, path.join(ROOT, result.dir), "sheet.png") : null;
    image = made ?? { error: `no JPEG of the sheet fits in ${tb.IMAGE_MAX_BYTES} bytes: look at the PNG instead` };
  }
  return {
    video: repoRelative(file),
    ...(fetched ? { fetched: { url: fetched.url, cached: fetched.cached, meta: fetched.meta } } : {}),
    ...result,
    ...(image ? { image } : {}),
    note: "Look at sheet.png for the whole video and hook-sheet.png for its opening; the single frames are beside them.",
  };
}
