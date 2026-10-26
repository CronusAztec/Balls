/**
 * --- inspiration --- The video sources of the agent toolbox, for learning from other creators' trending and viral videos
 * (the owner's decision, AGENTS.md): `trending` finds them, `fetch-video` downloads one into .agent-out/inbox/, and
 * fetchVideo() does the same for analyse, frames and inspire. yt-dlp does the fetching:
 *  1. JBL_YTDLP when set (an executable, or a .js / .mjs / .cjs script run with this Node: the tests' fake one);
 *  2. `yt-dlp` on the PATH. None: a clear message, nothing fetched.
 * Its command lines, the link check (http or https, never this machine or its private network), one video per link (a
 * playlist, channel or profile link reads one entry at most and is refused) and the parsers of what it prints are pure (src/lib/agentKit/videoSources.ts, tested in tests/inspiration.test.ts). yt-dlp runs with an argument array
 * (no shell) and a timeout, without the user's config (--ignore-config) or cache (--no-cache-dir). A download goes into a
 * fresh folder inside .agent-out/inbox/ and is renamed into place – a link at the target is replaced, never written through
 * – with its info JSON beside it; a video already there is reused unless the call says force.
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { resolveFfmpeg } from "./analyse.mjs";
import { ROOT, isInside, outFolder, repoRelative } from "./paths.mjs";

export const LIST_TIMEOUT_MS = 180_000;
export const INFO_TIMEOUT_MS = 600_000;
export const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
/** The most of yt-dlp's stdout kept (a page's JSON line can be half a megabyte). */
const MAX_STDOUT_CHARS = 128 * 1024 * 1024;
const MAX_STDERR_CHARS = 256 * 1024;
/** Pages read at once (one yt-dlp each). */
const PAGE_RUNS = 4;
/** The video files a download may end as. */
export const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v)$/i;

export const NO_YTDLP = 'No yt-dlp found: install it (pipx install "yt-dlp[default,curl-cffi]" – TikTok needs its browser impersonation –, or a release from github.com/yt-dlp/yt-dlp), put it on the PATH, or set JBL_YTDLP to it. Nothing was searched or fetched.';

/** How a yt-dlp is started: a script with this Node, anything else as it is. */
export function ytDlpCommand(file) {
  return /\.(mjs|cjs|js)$/i.test(file) ? { file: process.execPath, prefix: [file] } : { file, prefix: [] };
}

/** The yt-dlp to use: { path, source: "JBL_YTDLP" | "PATH", file, prefix, version } or null. */
export function resolveYtDlp(env = process.env) {
  const candidates = [];
  if (env.JBL_YTDLP) candidates.push({ path: env.JBL_YTDLP, source: "JBL_YTDLP" });
  candidates.push({ path: process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp", source: "PATH" });
  for (const c of candidates) {
    const cmd = ytDlpCommand(c.path);
    const r = spawnSync(cmd.file, [...cmd.prefix, "--version"], { encoding: "utf8", timeout: 30_000, windowsHide: true, env });
    if (!r.error && r.status === 0) return { ...c, ...cmd, version: r.stdout.trim().split("\n")[0] || "unknown" };
  }
  return null;
}

/**
 * One yt-dlp run: { code, stdout, stderr } (text); rejects when it cannot start or runs past its timeout – then the error
 * carries what it printed until it was stopped (stdout, stderr), so the pages it read already are not lost.
 */
export function runYtDlp(ytdlp, args, { timeoutMs = LIST_TIMEOUT_MS, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ytdlp.file, [...ytdlp.prefix, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    let out = "";
    let err = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      reject(Object.assign(new Error(`yt-dlp took longer than ${Math.round(timeoutMs / 1000)} s and was stopped`), { stdout: out, stderr: err }));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      if (out.length < MAX_STDOUT_CHARS) out += c;
    });
    child.stderr.on("data", (c) => {
      err = (err + c).slice(-MAX_STDERR_CHARS);
    });
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

/** Runs `fn` over `items`, at most `limit` at a time, results in the items' order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * The pages of `urls` read with yt-dlp -j, split over PAGE_RUNS runs: a Map from each link to its JSON object (matched by
 * the link yt-dlp was given, original_url), the error lines of the links it could not read, and (--- inspiration ---) the
 * links that are lists of videos, not one (`lists`: link → why it is refused; ytInfoArgs reads one entry of each at most).
 * A run stopped at its timeout keeps the pages it printed before.
 */
export async function readPages(tb, ytdlp, urls, { timeoutMs = INFO_TIMEOUT_MS } = {}) {
  const pages = new Map();
  const lists = new Map();
  const errors = [];
  if (!urls.length) return { pages, errors, lists };
  const size = Math.ceil(urls.length / PAGE_RUNS);
  const chunks = [];
  for (let i = 0; i < urls.length; i += size) chunks.push(urls.slice(i, i + size));
  await mapLimit(chunks, PAGE_RUNS, async (chunk) => {
    let r;
    try {
      r = await runYtDlp(ytdlp, tb.ytInfoArgs(chunk), { timeoutMs });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      if (!e || typeof e.stdout !== "string") return;
      r = { code: null, stdout: e.stdout, stderr: typeof e.stderr === "string" ? e.stderr : "" }; // (the pages read before the stop)
    }
    const infos = tb.parseJsonLines(r.stdout);
    for (const info of infos) {
      // --- inspiration --- a list's entry belongs to the list's link: refused, unless that link names one video by its id
      if (tb.isListEntry(info)) {
        const list = tb.listLinkOf(chunk, info);
        if (!list || pages.has(list) || lists.has(list)) continue;
        const why = tb.listLinkError(list, info);
        if (why) lists.set(list, why);
        else pages.set(list, info);
        continue;
      }
      const given = typeof info.original_url === "string" ? tb.checkVideoUrl(info.original_url) : null;
      const url = given?.ok && chunk.includes(given.url) ? given.url : chunk.find((u) => !pages.has(u) && typeof info.id === "string" && u.includes(info.id));
      if (url && !pages.has(url)) pages.set(url, info);
    }
    errors.push(...tb.ytErrorLines(r.stderr, 20));
  });
  return { pages, errors, lists };
}

/**
 * Trending videos (the `trending` tool, and inspire's first step): the search and the Shorts feed listed flat, the caller's
 * links added, the best rows' pages read for exact numbers (unless details is false), then ranked (videoSources.ts
 * rankVideos). `nowMs` is the clock the ages are measured on.
 */
export async function trending(tb, ytdlp, args, nowMs = Date.now()) {
  const limit = args.limit ?? 20;
  const sortBy = args.sortBy ?? "views";
  const urls = args.urls ?? [];
  const errors = [];
  const refused = [];
  const rows = [];
  const sources = { search: 0, shorts: 0, urls: 0 };
  let query = null;
  let feed = null;
  const queryText = args.query ?? (urls.length ? null : tb.DEFAULT_QUERY);
  if (queryText !== null) {
    const q = tb.checkQuery(queryText);
    if (!q.ok) throw new Error(q.error);
    query = q.query;
    const filtered = args.minViews !== undefined || args.maxDurationSec !== undefined;
    const searchCount = Math.ceil(limit * (filtered ? 3 : 1.5));
    const lists = [{ source: "search", target: tb.searchTarget(query, searchCount), count: searchCount }];
    // --- inspiration --- the Shorts feeds in turn (the query's hashtag, then shorter ones) until one has videos
    const feeds = args.maxDurationSec !== undefined && args.maxDurationSec <= tb.SHORT_MAX_SEC ? tb.shortsFeedUrls(query) : [];
    const list = async (l) => {
      try {
        return { l, r: await runYtDlp(ytdlp, tb.ytListArgs(l.target, l.count), { timeoutMs: LIST_TIMEOUT_MS }) };
      } catch (e) {
        return { l, r: { code: null, stdout: "", stderr: `ERROR: ${e instanceof Error ? e.message : String(e)}` } };
      }
    };
    const feedList = async () => {
      let last = null;
      for (const target of feeds) {
        last = await list({ source: "shorts", target, count: Math.ceil(limit * 1.5) });
        if (tb.parseJsonLines(last.r.stdout).length) break;
      }
      return last;
    };
    const listed = (await Promise.all([...lists.map(list), feeds.length ? feedList() : null])).filter(Boolean);
    for (const { l, r } of listed) {
      const found = tb.parseJsonLines(r.stdout).map((info) => tb.videoMetaOf(info, { source: l.source, nowMs })).filter(Boolean);
      sources[l.source] = found.length;
      if (l.source === "shorts") feed = l.target;
      rows.push(...found);
      if (!found.length) {
        const lines = tb.ytErrorLines(r.stderr);
        errors.push(...(lines.length ? lines : [`yt-dlp exit ${r.code}`]).map((e) => `${l.source}: ${e}`));
      }
    }
  }
  for (const u of urls) {
    const c = tb.checkVideoUrl(u);
    if (!c.ok) {
      refused.push({ url: String(u).slice(0, 200), error: c.error });
      continue;
    }
    const row = tb.videoMetaOf({ webpage_url: c.url }, { source: "url", nowMs, link: c.url });
    if (row) {
      rows.push(row);
      sources.urls++;
    }
  }
  // the pages: every link the caller gave, and the best rows of the search and the feed by what their rows say
  let read = 0;
  let unread = 0;
  let merged = rows;
  if (args.details !== false && rows.length) {
    const given = rows.filter((r) => r.source === "url");
    const pre = tb.rankVideos(
      rows.filter((r) => r.source !== "url"),
      { sortBy: "views", limit: Math.max(1, Math.ceil(limit * 1.5)), maxDurationSec: args.maxDurationSec },
    ).videos;
    const toRead = [...given, ...pre];
    const { pages, errors: pageErrors, lists } = await readPages(tb, ytdlp, [...new Set(toRead.map((r) => r.url))]);
    // --- inspiration --- a link that is a list of videos (a playlist, channel, profile…) is refused, not ranked
    for (const [url, error] of lists) {
      refused.push({ url: url.slice(0, 200), error });
      sources.urls = Math.max(0, sources.urls - 1);
    }
    const readRows = toRead.filter((row) => !lists.has(row.url)).map((row) => {
      const info = pages.get(row.url);
      const page = info ? tb.videoMetaOf(info, { source: row.source, nowMs, link: row.url, detailed: true }) : null;
      if (tb.hasNumbers(page)) {
        read++;
        return tb.mergeMeta(row, page);
      }
      unread++;
      return row;
    });
    errors.push(...pageErrors.slice(0, 10));
    merged = readRows;
  }
  const ranked = tb.rankVideos(merged, { sortBy, limit, minViews: args.minViews, maxDurationSec: args.maxDurationSec });
  if (!ranked.videos.length && errors.length) throw new Error(`No video found: ${errors.slice(0, 3).join("; ")}`);
  return {
    query,
    platform: "youtube",
    sortBy,
    filters: { minViews: args.minViews ?? null, maxDurationSec: args.maxDurationSec ?? null },
    count: ranked.videos.length,
    videos: ranked.videos,
    dropped: ranked.dropped,
    sources,
    ...(feed ? { feed } : {}),
    pages: { read, unread },
    ...(refused.length ? { refused } : {}),
    ...(errors.length ? { errors: errors.slice(0, 20) } : {}),
    ytdlp: { source: ytdlp.source, version: ytdlp.version },
    at: new Date(nowMs).toISOString(),
  };
}

export async function trendingTool(tb, args) {
  const ytdlp = resolveYtDlp();
  if (!ytdlp) throw new Error(NO_YTDLP);
  return trending(tb, ytdlp, args);
}

/** A regular file of this video already in the inbox (not a link), else null. */
function inboxVideo(inbox, name) {
  for (const ext of [".mp4", ".webm", ".mkv", ".mov", ".m4v"]) {
    const file = path.join(inbox, `${name}${ext}`);
    try {
      if (fs.lstatSync(file).isFile()) return file;
    } catch {
      /* not there */
    }
  }
  return null;
}

const regularFile = (file) => {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * One video fetched into .agent-out/inbox/<platform>-<id>.<ext> with its info JSON: { url, absolute, file, infoFile,
 * bytes, cached, meta, ytdlp } (meta: videoSources.ts VideoMeta from the video's page; ytdlp: the one that ran, the
 * caller's when it passes one).
 */
export async function fetchVideo(tb, { url, maxHeight = 1080, force = false, ytdlp: given = null }, nowMs = Date.now()) {
  const link = tb.checkVideoUrl(url);
  if (!link.ok) throw new Error(link.error); // (before anything runs: a refused link never reaches yt-dlp)
  const ytdlp = given ?? resolveYtDlp();
  if (!ytdlp) throw new Error(NO_YTDLP);
  const inbox = outFolder("inbox");
  // the page first: its id names the file, and its numbers come back with it
  const page = await runYtDlp(ytdlp, tb.ytInfoArgs([link.url]), { timeoutMs: INFO_TIMEOUT_MS });
  const info = tb.parseJsonLines(page.stdout)[0];
  const listError = info ? tb.listLinkError(link.url, info) : null; // (--- inspiration --- one video per link)
  if (listError) throw new Error(listError);
  const meta = info ? tb.videoMetaOf(info, { source: "url", nowMs, link: link.url, detailed: true }) : null;
  if (!meta) throw new Error(`yt-dlp could not read ${link.url}: ${tb.ytErrorLines(page.stderr).join("; ") || `exit ${page.code}`}`);
  const name = tb.videoFileName(meta);
  const infoTarget = path.join(inbox, `${name}.info.json`);
  const had = inboxVideo(inbox, name);
  if (had && !force) return { url: link.url, absolute: had, file: repoRelative(had), infoFile: regularFile(infoTarget) ? repoRelative(infoTarget) : null, bytes: fs.statSync(had).size, cached: true, meta, ytdlp };
  const ffmpeg = resolveFfmpeg();
  const tmp = fs.mkdtempSync(path.join(inbox, ".fetch-"));
  try {
    process.stderr.write(`agent fetch-video: ${link.url}\n`);
    const r = await runYtDlp(ytdlp, tb.ytDownloadArgs({ url: link.url, dir: tmp, name, maxHeight, ffmpeg: ffmpeg ? (ffmpeg.source === "system" ? "" : ffmpeg.path) : null }), { timeoutMs: DOWNLOAD_TIMEOUT_MS, cwd: tmp });
    const realTmp = fs.realpathSync(tmp);
    const printed = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => path.resolve(tmp, l))
      .reverse()
      .find((f) => isInside(realTmp, f) && VIDEO_EXT.test(f) && regularFile(f));
    const produced = printed ?? fs.readdirSync(tmp).map((f) => path.join(tmp, f)).find((f) => path.basename(f).startsWith(`${name}.`) && VIDEO_EXT.test(f) && regularFile(f));
    if (!produced) throw new Error(`yt-dlp could not download ${link.url}: ${tb.ytErrorLines(r.stderr).join("; ") || `exit ${r.code}, no video file`}`);
    for (const ext of [".mp4", ".webm", ".mkv", ".mov", ".m4v"]) fs.rmSync(path.join(inbox, `${name}${ext}`), { force: true }); // (an older download in another container)
    const target = path.join(inbox, `${name}${path.extname(produced).toLowerCase()}`);
    fs.renameSync(produced, target);
    const infoSource = path.join(tmp, `${name}.info.json`);
    if (regularFile(infoSource)) fs.renameSync(infoSource, infoTarget);
    return { url: link.url, absolute: target, file: repoRelative(target), infoFile: regularFile(infoTarget) ? repoRelative(infoTarget) : null, bytes: fs.statSync(target).size, cached: false, meta, ytdlp };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function fetchVideoTool(tb, args) {
  const r = await fetchVideo(tb, { url: args.url, maxHeight: args.maxHeight ?? 1080, force: args.force === true });
  const ytdlp = r.ytdlp;
  const ffmpeg = resolveFfmpeg();
  return {
    file: r.file,
    infoFile: r.infoFile,
    bytes: r.bytes,
    cached: r.cached,
    url: r.url,
    meta: r.meta,
    ytdlp: ytdlp ? { source: ytdlp.source, version: ytdlp.version } : null,
    ffmpeg: ffmpeg ? { source: ffmpeg.source, version: ffmpeg.version } : null,
  };
}
