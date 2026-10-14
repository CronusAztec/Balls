// --- build-identity --- Which build is this? One record (release version, commit, commit date) collected in one place that every
// build path runs: next.config.ts inlines it into the pages (NEXT_PUBLIC_BUILD_*), scripts/postexport.mjs writes out/version.json
// and the X-Build header rule from it. Plain CommonJS on purpose: next.config.ts is compiled to CommonJS (a `require` works there,
// an ES module would depend on require(esm)), postexport.mjs and the tests `import` it, and it has no dependencies.
//
// Where the values come from (first one that gives a valid answer wins):
//   commit      JBL_BUILD_SHA (40 lowercase hex) > `git rev-parse HEAD` > GITHUB_SHA > none
//   commitDate  JBL_BUILD_DATE > `git log -1 --format=%cI <commit>` > SITEMAP_LASTMOD (ISO only) > none, always normalised to UTC
//   siteVersion the root package.json "version" (the website's release number; read from disk, never imported into a bundle)
// A shallow, detached checkout (the VPS, Actions) has no tags, branch name or commit count: only these two git calls are used. A
// missing git, a timeout or a non-repository never fails a build: the answer falls back and the label says "dev".
// Nothing here prints or copies process.env, and no commit subject is ever read (this repository's messages carry session links).
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const NAME = "JumpingBallsLive";
const ROOT = path.resolve(__dirname, "..", "..");
const SHA = /^[0-9a-f]{40}$/;
const SEP = " · ";
/** The marker line of the block this module appends to out/_headers (a re-run replaces it instead of adding a second one). */
const HEADERS_MARKER = "# --- build-identity --- written by scripts/postexport.mjs";

/** `git <args>` in `cwd` as trimmed text, or "" when git is missing, times out or fails (no shell, stderr dropped). */
function defaultGit(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, timeout: 5000, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** A date string as UTC "YYYY-MM-DDTHH:MM:SSZ", or null when it is not a valid ISO date (git's %cI and SITEMAP_LASTMOD are). */
function toUtcIso(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const validVersion = (v) => (typeof v === "string" && /^\d+\.\d+\.\d+/.test(v) ? v : null);

/**
 * @typedef {{ name: string, siteVersion: string, commit: string | null, commitShort: string | null, commitDate: string | null, desktopVersion: string | null, source: { commit: string | null, date: string | null } }} BuildInfo
 */

/**
 * The build record. `run(args, cwd)` and `env` are injectable (the tests hand in a fake git and a plain object), `root` is the
 * repository root (package.json and desktop/package.json are read from it).
 * @param {{ root?: string, env?: Record<string, string | undefined>, run?: (args: string[], cwd: string) => string }} [options]
 * @returns {BuildInfo}
 */
function resolveBuildInfo({ root = ROOT, env = process.env, run = defaultGit } = {}) {
  const git = (args) => {
    try {
      return String(run(args, root) || "").trim();
    } catch {
      return "";
    }
  };
  let commit = null;
  let commitSource = null;
  const fromEnv = (env.JBL_BUILD_SHA || "").trim();
  if (SHA.test(fromEnv)) {
    commit = fromEnv;
    commitSource = "JBL_BUILD_SHA";
  }
  if (!commit) {
    const head = git(["rev-parse", "HEAD"]);
    if (SHA.test(head)) {
      commit = head;
      commitSource = "git";
    }
  }
  if (!commit) {
    const github = (env.GITHUB_SHA || "").trim();
    if (SHA.test(github)) {
      commit = github;
      commitSource = "GITHUB_SHA";
    }
  }

  let commitDate = toUtcIso(env.JBL_BUILD_DATE);
  let dateSource = commitDate ? "JBL_BUILD_DATE" : null;
  if (!commitDate && commit) {
    commitDate = toUtcIso(git(["log", "-1", "--format=%cI", commit]));
    if (commitDate) dateSource = "git";
  }
  if (!commitDate) {
    commitDate = toUtcIso(env.SITEMAP_LASTMOD);
    if (commitDate) dateSource = "SITEMAP_LASTMOD";
  }

  const siteVersion = validVersion((readJson(path.join(root, "package.json")) || {}).version) || "0.0.0-dev";
  const desktopVersion = validVersion((readJson(path.join(root, "desktop", "package.json")) || {}).version);

  return {
    name: NAME,
    siteVersion,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    commitDate,
    desktopVersion,
    source: { commit: commitSource, date: dateSource },
  };
}

/** `v1.10.0 · 8fa8dbb · 2026-10-14` (the footer), `v1.10.0 · 8fa8dbb` without a date, `v1.10.0 · dev` without a commit. */
function formatBuildLabel(version, commit, commitDate) {
  if (!commit) return `v${version}${SEP}dev`;
  return [`v${version}`, commit.slice(0, 7), commitDate ? commitDate.slice(0, 10) : ""].filter(Boolean).join(SEP);
}

/** `1.10.0+8fa8dbb` (semver build metadata), `1.10.0+dev` without a commit. */
function formatBuildId(version, commit) {
  return `${version}+${commit ? commit.slice(0, 7) : "dev"}`;
}

const buildLabel = (info) => formatBuildLabel(info.siteVersion, info.commit, info.commitDate);
const buildId = (info) => formatBuildId(info.siteVersion, info.commit);

/** The env entries next.config.ts hands to Next (inlined wherever the code reads the literal process.env.NEXT_PUBLIC_BUILD_*). */
function nextEnv(info) {
  return {
    NEXT_PUBLIC_BUILD_VERSION: info.siteVersion,
    NEXT_PUBLIC_BUILD_COMMIT: info.commit || "",
    NEXT_PUBLIC_BUILD_COMMIT_DATE: info.commitDate || "",
  };
}

/** Whether the export is meant for a public address (not localhost): version.json says "production" or "development". */
function channelOf(info, siteUrl) {
  let host = "";
  try {
    host = new URL(siteUrl).hostname;
  } catch {
    host = "";
  }
  const local = !host || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return info.commit && !local ? "production" : "development";
}

/** The keys of out/version.json, in order. Nothing else is ever written (tests/buildInfo.test.ts pins the list). */
const VERSION_JSON_KEYS = ["schema", "name", "siteVersion", "build", "commit", "commitShort", "commitDate", "builtAt", "channel", "desktopVersion", "siteUrl", "changelogUrl"];

/** @typedef {{ siteUrl?: string, basePath?: string, now?: Date }} FileOptions */

/**
 * The out/version.json object: no commit subject, no branch, no host path, no environment.
 * @param {BuildInfo} info
 * @param {FileOptions} [options]
 */
function versionJson(info, { siteUrl, basePath = "", now = new Date() } = {}) {
  const base = (siteUrl || `http://localhost:3000${basePath}`).replace(/\/+$/, "");
  return {
    schema: 1,
    name: info.name,
    siteVersion: info.siteVersion,
    build: buildId(info),
    commit: info.commit,
    commitShort: info.commitShort,
    commitDate: info.commitDate,
    builtAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    channel: channelOf(info, base),
    desktopVersion: info.desktopVersion,
    siteUrl: base,
    changelogUrl: `${base}/en/changelog/`,
  };
}

/** `existing` _headers text plus the X-Build rule (a block written earlier by this module is replaced, other rules are kept). */
function headersWith(existing, id) {
  let head = typeof existing === "string" ? existing : "";
  const at = head.indexOf(HEADERS_MARKER);
  if (at >= 0) head = head.slice(0, at);
  head = head.replace(/\s+$/, "");
  return `${head ? `${head}\n\n` : ""}${HEADERS_MARKER}\n/*\n  X-Build: ${id}\n`;
}

/**
 * Writes out/version.json and, when the commit is known, the X-Build rule into out/_headers (created when absent, appended
 * otherwise). Call it LAST, after the service worker is built (scripts/pwa/build.mjs hashes and precaches what is in out/ at that
 * moment; a file added afterwards is neither). Returns the paths written. Never throws for a missing git.
 * @param {string} outDir
 * @param {BuildInfo} info
 * @param {FileOptions} [options]
 * @returns {{ versionJson: string, headers: string | null }}
 */
function writeBuildFiles(outDir, info, { siteUrl, basePath = "", now = new Date() } = {}) {
  const written = { versionJson: path.join(outDir, "version.json"), headers: null };
  fs.writeFileSync(written.versionJson, `${JSON.stringify(versionJson(info, { siteUrl, basePath, now }), null, 2)}\n`);
  if (info.commit) {
    const file = path.join(outDir, "_headers");
    let existing = "";
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      existing = "";
    }
    fs.writeFileSync(file, headersWith(existing, buildId(info)));
    written.headers = file;
  }
  return written;
}

/**
 * Removes what writeBuildFiles wrote into `outDir` earlier (version.json, its block in _headers, the file itself when nothing else
 * is left), so a second postexport run over the same out/ starts clean: the service worker would otherwise find both files and
 * precache them. Returns the names it touched.
 * @param {string} outDir
 * @returns {string[]}
 */
function clearBuildFiles(outDir) {
  const touched = [];
  const version = path.join(outDir, "version.json");
  if (fs.existsSync(version)) {
    fs.rmSync(version);
    touched.push("version.json");
  }
  const file = path.join(outDir, "_headers");
  try {
    const text = fs.readFileSync(file, "utf8");
    const at = text.indexOf(HEADERS_MARKER);
    if (at >= 0) {
      const rest = text.slice(0, at).replace(/\s+$/, "");
      if (rest) fs.writeFileSync(file, `${rest}\n`);
      else fs.rmSync(file);
      touched.push("_headers");
    }
  } catch {
    /* no _headers file */
  }
  return touched;
}

/**
 * The address the export was built for, read back from out/robots.txt (`Sitemap: <site url>/sitemap.xml`, written by `next build`
 * from NEXT_PUBLIC_SITE_URL), for a postexport that runs without that variable: the VPS deployer passes the build's settings to
 * `next build` only, and a copy of it that was installed before this existed keeps doing so. null when robots.txt has no such line.
 * @param {string} outDir
 * @returns {string | null}
 */
function siteUrlFromRobots(outDir) {
  try {
    const text = fs.readFileSync(path.join(outDir, "robots.txt"), "utf8");
    const m = /^\s*Sitemap:\s*(https?:\/\/\S+?)\/sitemap\.xml\s*$/im.exec(text);
    return m ? m[1].replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

module.exports = {
  HEADERS_MARKER,
  VERSION_JSON_KEYS,
  buildId,
  buildLabel,
  channelOf,
  clearBuildFiles,
  defaultGit,
  formatBuildId,
  formatBuildLabel,
  headersWith,
  nextEnv,
  resolveBuildInfo,
  siteUrlFromRobots,
  toUtcIso,
  versionJson,
  writeBuildFiles,
};
