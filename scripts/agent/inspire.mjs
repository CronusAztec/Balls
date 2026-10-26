/**
 * --- inspiration --- `npm run agent -- inspire --json '{"query":"ball simulation"}'`: learn from other creators' trending
 * and viral simulation videos (the owner's decision, AGENTS.md) in one call:
 *  1. trending (videoSources.mjs): the search, the Shorts feed (short-form by default) and the caller's links, ranked;
 *  2. the top `top` of them fetched into .agent-out/inbox/ (two at a time), each measured exactly as analyse measures a file
 *     (analyse.mjs measureFile) and, unless frames is false, cut into frames and contact sheets (.agent-out/frames/<name>/);
 *  3. our own renders (the newest `oursMax` video files under .agent-out/render, or the folder `ours` names) measured alike;
 *  4. the report (src/lib/agentKit/inspiration.ts: the traits, the patterns that separate the most viewed, the themes and the
 *     recommendations in our levers) written to .agent-out/inspiration/<date>-<slug>/report.json and report.md;
 *  5. every measured video appended to .agent-out/inspiration/dataset.jsonl (or <dataset>.jsonl), once per video (its key),
 *     so the dataset grows across runs.
 * A video that cannot be fetched or measured stays in the report with its error; the run goes on. Unless stills is false, a
 * YouTube video that cannot be fetched is seen through its public stills instead (stills.mjs: the opening frame, 25, 50 and
 * 75%, the cover, on stills-sheet.png, and their colours measured). Every file is written through paths.mjs (fresh name,
 * then renamed into place) and stays under .agent-out/.
 */
import fs from "fs";
import path from "path";
import { NO_FFMPEG, measureFile, resolveFfmpeg } from "./analyse.mjs";
import { extractFrames, framesName } from "./frames.mjs";
import { fetchStills, stillsOrigin } from "./stills.mjs";
import { NO_YTDLP, fetchVideo, mapLimit, resolveYtDlp, trending } from "./videoSources.mjs";
import { OUT_DIR, PathError, ROOT, isInside, outFolder, repoRelative, writeFileSafe } from "./paths.mjs";

/** Videos fetched and measured at once. */
const FETCHES = 2;
const OWN_VIDEO = /\.(mp4|webm|mov|mkv|m4v)$/i;

/**
 * The newest video files under `dir` (three folders deep at most, links not followed), newest first: one per clip (the
 * render tool writes clip.webm and its clip.mp4 beside it: the MP4 is kept).
 */
export function ownRenders(dir, max) {
  const found = [];
  const walk = (d, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && OWN_VIDEO.test(e.name)) found.push({ file: p, mtime: fs.statSync(p).mtimeMs });
    }
  };
  walk(dir, 0);
  const byClip = new Map();
  for (const f of found) {
    const stem = f.file.slice(0, -path.extname(f.file).length);
    const had = byClip.get(stem);
    if (!had || (/\.mp4$/i.test(f.file) && !/\.mp4$/i.test(had.file))) byClip.set(stem, f);
  }
  return [...byClip.values()]
    .sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? -1 : 1))
    .slice(0, Math.max(0, max))
    .map((f) => f.file);
}

/** The folder of our renders: `ours` (inside the repository, links resolved), else .agent-out/render when it exists. */
function oursFolder(ours) {
  if (ours === undefined) {
    const def = path.join(OUT_DIR, "render");
    return fs.existsSync(def) && isInside(fs.realpathSync(ROOT), fs.realpathSync(def)) ? fs.realpathSync(def) : null;
  }
  const resolved = path.resolve(ROOT, String(ours));
  if (!isInside(ROOT, resolved) || !fs.existsSync(resolved)) throw new PathError(`${ours} is not a folder inside the repository`);
  const real = fs.realpathSync(resolved);
  if (!isInside(fs.realpathSync(ROOT), real) || !fs.statSync(real).isDirectory()) throw new PathError(`${ours} is not a folder inside the repository (or leads out of it)`);
  return real;
}

/** The site's mode ids (messages/en.json Modes: the entries with a name). */
function modeIds() {
  try {
    const modes = JSON.parse(fs.readFileSync(path.join(ROOT, "messages", "en.json"), "utf8")).Modes ?? {};
    return Object.keys(modes).filter((k) => modes[k] && typeof modes[k] === "object" && typeof modes[k].name === "string");
  } catch {
    return [];
  }
}

const note = (text) => process.stderr.write(`agent inspire: ${text}\n`);

export async function inspireTool(tb, args) {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error(NO_FFMPEG);
  const ytdlp = resolveYtDlp();
  if (!ytdlp) throw new Error(NO_YTDLP);
  const oursDir = oursFolder(args.ours);
  const origin = args.stills === false ? null : stillsOrigin(tb);
  const nowMs = Date.now();
  const at = new Date(nowMs).toISOString();
  const sortBy = args.sortBy ?? "views";
  note(`finding trending videos${args.query ? ` for "${args.query}"` : ""}`);
  const found = await trending(tb, ytdlp, { query: args.query, limit: args.limit ?? 20, urls: args.urls, minViews: args.minViews, maxDurationSec: args.maxDurationSec ?? tb.SHORT_MAX_SEC, sortBy, details: true }, nowMs);
  const picked = found.videos.slice(0, Math.max(0, args.top ?? 8));
  const featuresByKey = new Map();
  const analysed = await mapLimit(picked, FETCHES, async (meta, i) => {
    note(`${i + 1}/${picked.length} ${meta.url}`);
    try {
      const got = await fetchVideo(tb, { url: meta.url, maxHeight: args.maxHeight ?? 1080, ytdlp }, nowMs);
      const features = await measureFile(tb, ffmpeg, got.absolute, {});
      featuresByKey.set(meta.key, features);
      let frames = null;
      if (args.frames !== false) {
        try {
          const f = await extractFrames(tb, ffmpeg, got.absolute, { name: framesName(got.absolute) });
          frames = { dir: f.dir, sheet: f.sheet, hookSheet: f.hookSheet };
        } catch (e) {
          frames = null;
          note(`no frames of ${got.file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { meta: tb.mergeMeta(meta, got.meta), file: got.file, features, frames, error: null };
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
      // --- inspiration --- the stills fallback: the video is still seen, and its colours measured
      let stills = null;
      if (origin) {
        try {
          stills = await fetchStills(tb, ffmpeg, meta, { name: tb.videoFileName(meta), origin });
        } catch (s) {
          note(`no stills of ${meta.url}: ${s instanceof Error ? s.message : String(s)}`);
        }
      }
      return { meta, error, stills };
    }
  });
  const ours = [];
  if (oursDir && (args.oursMax ?? 8) > 0) {
    for (const file of ownRenders(oursDir, args.oursMax ?? 8)) {
      try {
        ours.push({ file: repoRelative(file), features: await measureFile(tb, ffmpeg, file, {}) });
      } catch (e) {
        note(`skipped our render ${repoRelative(file)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const candidates = found.videos.map((v) => analysed.find((a) => a.meta.key === v.key)?.meta ?? v);
  const report = tb.buildInspirationReport({ query: found.query, at, sortBy, candidates, analysed, ours, modes: modeIds(), shortForm: (args.maxDurationSec ?? tb.SHORT_MAX_SEC) <= tb.SHORT_MAX_SEC });
  const runDir = outFolder("inspiration", tb.runFolderName(at, found.query));
  const reportFile = writeFileSafe(path.join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const markdownFile = writeFileSafe(path.join(runDir, "report.md"), tb.inspirationMarkdown(report));
  // the dataset: a line per measured video, once per key, kept across runs (rewritten whole under a fresh name, so a link
  // at its place is replaced, never written through)
  const datasetFile = path.join(outFolder("inspiration"), `${args.dataset ?? "dataset"}.jsonl`);
  let existing = "";
  try {
    if (fs.lstatSync(datasetFile).isFile()) existing = fs.readFileSync(datasetFile, "utf8");
  } catch {
    existing = "";
  }
  const records = report.videos.filter((v) => v.analysed).map((v) => tb.datasetRecord(v, featuresByKey.get(v.key) ?? null, found.query, at));
  const appended = tb.datasetAppend(existing, records);
  if (appended.added || !existing) writeFileSafe(datasetFile, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${appended.lines.map((l) => `${l}\n`).join("")}`);
  return {
    dir: repoRelative(runDir),
    report: repoRelative(reportFile),
    markdown: repoRelative(markdownFile),
    dataset: { file: repoRelative(datasetFile), added: appended.added, total: appended.total },
    counts: report.counts,
    stillsOnly: report.stillsOnly,
    recommendations: report.recommendations.slice(0, 12).map((r) => ({ area: r.area, basis: r.basis, advice: r.advice, levers: r.levers })),
    patterns: report.patterns.slice(0, 8),
    themes: report.themes.slice(0, 4).map((t) => ({ label: t.label, viewShare: t.viewShare, videos: t.videos, modes: t.modes, blueprints: t.blueprints })),
    videos: report.videos.map((v) => ({ rank: v.rank, url: v.url, title: v.title, views: v.views, viewsPerDay: v.viewsPerDay, durationSec: v.durationSec, analysed: v.analysed, sheet: v.frames?.sheet ?? null, hookSheet: v.frames?.hookSheet ?? null, ...(v.stills ? { stillsSheet: v.stills.sheet } : {}), ...(v.compared ? {} : { longForm: true }), ...(v.error ? { error: v.error } : {}) })),
    ...(found.errors ? { errors: found.errors } : {}),
    note: "report.md is the readable report; look at each video's sheet.png and hook-sheet.png (or stills-sheet.png for a video seen only through its stills) to see what the numbers describe.",
  };
}
