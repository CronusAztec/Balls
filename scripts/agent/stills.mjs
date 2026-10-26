/**
 * --- inspiration --- inspire's stills fallback: when a trending video cannot be fetched (YouTube asks a server's address to
 * sign in, TikTok blocks it), its public stills are read instead, so the video is still seen and its colours measured.
 * YouTube's image host serves every video's opening frame, three frames at about 25, 50 and 75% of it and its cover to anyone
 * (src/lib/agentKit/videoSources.ts videoStills). They are saved in .agent-out/frames/<platform>-<id>/ (still-0.jpg …,
 * cover.jpg), cropped to the video's shape as PNGs (the 4:3 stills letterbox a Short), laid out on stills-sheet.png for a
 * vision-capable model, and their colours measured on 16 × 16 samples exactly as the analyser measures a video's
 * (lib/agentKit/inspiration.ts stillsColour).
 *
 * Only https://i.ytimg.com is read (JBL_STILLS_ORIGIN may name a server on this machine instead: the tests' own), with no
 * redirect followed, a timeout and a size cap per still; every file is written under a fresh name and renamed into place,
 * and ffmpeg opens each still as a local file with image demuxers only (ffmpegArgs.ts stillArgs).
 */
import fs from "fs";
import path from "path";
import { runFfmpeg } from "./analyse.mjs";
import { writePng } from "./frames.mjs";
import { outFolder, repoRelative, writeFileSafe } from "./paths.mjs";

export const STILL_TIMEOUT_MS = 20_000;
/** The largest still read (a Short's cover is about 200 KB). */
export const STILL_MAX_BYTES = 4 * 1024 * 1024;
/** Stills read at once. */
const READS = 3;
const OUR_FILES = /^(still-\d\.(jpg|png)|cover\.(jpg|png)|stills-sheet\.png)$/;

/** Where stills are read from: https://i.ytimg.com, or the local server JBL_STILLS_ORIGIN names (http on this machine only). */
export function stillsOrigin(tb, env = process.env) {
  const given = env.JBL_STILLS_ORIGIN;
  if (!given) return `https://${tb.STILLS_HOST}`;
  let url;
  try {
    url = new URL(given);
  } catch {
    throw new Error("JBL_STILLS_ORIGIN is not a link");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("JBL_STILLS_ORIGIN may only name a server on this machine (http://127.0.0.1:<port>), for tests");
  return url.origin;
}

/** One still's bytes, or null when the host has none (404), answers with something else than a picture, or is too slow. */
async function readStill(url) {
  let res;
  try {
    res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(STILL_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok || !/^image\/(jpeg|jpg|png|webp)\b/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > STILL_MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > STILL_MAX_BYTES) return null;
      chunks.push(chunk);
    }
  } catch {
    return null;
  }
  return total > 0 ? Buffer.concat(chunks) : null;
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
 * A video's stills (VideoMeta `meta`) in .agent-out/frames/<name>/: { dir, sheet, files: [{ file, label, at }], colour } with
 * repository-relative paths, or null when the platform has none or no still could be read.
 */
export async function fetchStills(tb, ffmpeg, meta, { name, origin = stillsOrigin(tb) }) {
  const list = tb.videoStills(meta, origin);
  if (!list.length) return null;
  const dir = outFolder("frames", name);
  for (const f of fs.readdirSync(dir)) if (OUR_FILES.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const aspect = tb.stillsAspect(meta);
  const written = new Map();
  await eachLimit(list, READS, async (s) => {
    const bytes = await readStill(s.url);
    if (!bytes) return;
    writeFileSafe(path.join(dir, s.name), bytes);
    const png = s.name.replace(/\.jpg$/, ".png");
    if (await writePng(ffmpeg, dir, png, (tmpName) => tb.stillArgs(s.name, tmpName, aspect))) written.set(s.name, png);
  });
  const kept = list.filter((s) => written.has(s.name));
  if (!kept.some((s) => s.at !== null)) return null;
  const samples = [];
  for (const s of kept.filter((x) => x.at !== null)) {
    const r = await runFfmpeg(ffmpeg.path, tb.stillSampleArgs(written.get(s.name)), { cwd: dir });
    if (r.code === 0 && r.stdout.length === tb.SAMPLE_BYTES) samples.push(r.stdout);
  }
  const portrait = aspect < 1;
  const tileW = tb.SHEET_TILE_WIDTH;
  const tileH = Math.round(tileW / aspect);
  const pngs = kept.map((s) => written.get(s.name));
  const sheet = (await writePng(ffmpeg, dir, "stills-sheet.png", (tmpName) => tb.sheetArgs(pngs, tmpName, tb.sheetGrid(pngs.length, portrait), tileW, tileH))) ? repoRelative(path.join(dir, "stills-sheet.png")) : null;
  return {
    dir: repoRelative(dir),
    sheet,
    files: kept.map((s) => ({ file: repoRelative(path.join(dir, written.get(s.name))), label: s.label, at: s.at })),
    colour: tb.stillsColour(samples),
  };
}
