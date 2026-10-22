/**
 * --- agent-cli --- Where the agent toolbox may read and write (scripts/agent/*.mjs):
 *  - ROOT: the repository (this checkout). Every path a caller names is resolved – symbolic links included – and must stay
 *    inside it; URLs (http:, https:, data:, file: …) are refused, never opened.
 *  - OUT_DIR: <repo>/.agent-out/, the only place a tool writes files (PNG, MP4, JSON reports). It ignores itself (it holds a
 *    .gitignore of "*"), so nothing a tool writes ever shows in `git status`.
 *  - CACHE_DIR: the agent cache outside the repository – JBL_AGENT_CACHE, else jbl-agent/<hash of ROOT> in this user's own
 *    cache folder (XDG_CACHE_HOME or ~/.cache on Linux, ~/Library/Caches on macOS, %LOCALAPPDATA% on Windows): the bundled
 *    toolbox and the local export (a copy of the working tree, built there). Outside the repository on purpose: a source
 *    copy inside it would be type-checked and linted with the real one, and one under node_modules/ is not compiled by Next.
 *    Not in the shared temp folder (--- agent-cli ---): there another user could create the predictable folder first, and the
 *    toolbox would refuse it for good. The CLI imports and runs code from it, so it is private: created 0700, and refused –
 *    never used – when it is a link, or (on Linux and macOS) not this user's or writable by anyone else.
 * Files are written through writeFileSafe: under a fresh name, then renamed over the target, so a symbolic link a checkout
 * carries at .agent-out/… is replaced, never written through.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = path.join(ROOT, ".agent-out");

/**
 * --- agent-cli --- This user's own cache folder: %LOCALAPPDATA% on Windows, ~/Library/Caches on macOS, XDG_CACHE_HOME (when
 * absolute) or ~/.cache elsewhere – a folder no other user can create entries in, unlike the shared temp folder.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform]
 * @param {string} [home]
 * @returns {string}
 */
export function userCacheBase(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === "win32") return env.LOCALAPPDATA && path.win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.win32.join(home, "AppData", "Local");
  if (platform === "darwin") return path.posix.join(home, "Library", "Caches");
  return env.XDG_CACHE_HOME && path.posix.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.posix.join(home, ".cache");
}

/**
 * The agent cache of the checkout at `root`: JBL_AGENT_CACHE, else jbl-agent/<hash of the checkout> in userCacheBase().
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform]
 * @param {string} [home]
 * @returns {string}
 */
export function cacheDirFor(root, env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.JBL_AGENT_CACHE) return path.resolve(env.JBL_AGENT_CACHE);
  return path.join(userCacheBase(env, platform, home), "jbl-agent", crypto.createHash("sha1").update(root).digest("hex").slice(0, 10));
}

export const CACHE_DIR = cacheDirFor(ROOT);

/**
 * --- agent-cli --- Whether `metaUrl` is the module Node started (`argv1`): their real paths compared, so a start through a
 * symbolic link (macOS's /tmp, a linked home or workspace) runs the tool instead of exiting 0 having done nothing.
 * @param {string} metaUrl
 * @param {string | undefined} [argv1]
 * @returns {boolean}
 */
export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  const self = fileURLToPath(metaUrl);
  try {
    return fs.realpathSync(path.resolve(argv1)) === fs.realpathSync(self);
  } catch {
    return path.resolve(argv1) === self;
  }
}

export class PathError extends Error {}

const realRoot = () => fs.realpathSync(ROOT);

/** Throws unless `p` – or, while it does not exist yet, its nearest existing folder – really is inside `parent` (links resolved). */
function assertLeadsInside(parent, p, what) {
  let at = path.resolve(p);
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  if (!isInside(fs.realpathSync(parent), fs.realpathSync(at))) throw new PathError(`${what} leads outside ${path.relative(ROOT, parent) || "the repository"} (a symbolic link): remove the link`);
}

/**
 * Whether a cache folder may be trusted (null) or why not: a real folder (not a link), and on POSIX owned by this user and
 * writable by no one else. `stat` is fs.lstatSync's answer.
 */
export function untrustedCacheReason(stat, uid = typeof process.getuid === "function" ? process.getuid() : null) {
  if (stat.isSymbolicLink()) return "it is a symbolic link";
  if (!stat.isDirectory()) return "it is not a folder";
  if (uid === null) return null; // Windows: the cache folder is the user's own
  if (stat.uid !== uid) return `it belongs to another user (uid ${stat.uid})`;
  if ((stat.mode & 0o022) !== 0) return `others may write to it (mode ${(stat.mode & 0o777).toString(8)})`;
  return null;
}

let cacheChecked = false;

/** The cache folder itself: created private, else checked before anything in it is read or run. */
function cacheRoot() {
  if (cacheChecked) return CACHE_DIR;
  // (the folders above it this user's own, and private when created here: ~/.cache/jbl-agent)
  fs.mkdirSync(path.dirname(CACHE_DIR), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(CACHE_DIR, { mode: 0o700 });
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
  }
  const why = untrustedCacheReason(fs.lstatSync(CACHE_DIR));
  if (why) throw new PathError(`The agent cache ${CACHE_DIR} is not safe to use: ${why}. Remove it, or point JBL_AGENT_CACHE at a private folder.`);
  cacheChecked = true;
  return CACHE_DIR;
}

/**
 * Writes `data` to `file` without following a link there: under a fresh name in the same folder, then renamed over the target
 * (a rename replaces a link instead of writing through it). The folder must lead inside .agent-out/ or the agent cache.
 */
export function writeFileSafe(file, data) {
  const dir = path.dirname(path.resolve(file));
  const realDir = fs.realpathSync(dir);
  if (!isInside(fs.realpathSync(ensureOutDir()), realDir) && !isInside(fs.realpathSync(cacheRoot()), realDir)) throw new PathError(`${file} is outside .agent-out/ and the agent cache`);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, data, { flag: "wx" });
  fs.renameSync(tmp, file);
  return file;
}

/** A fresh name beside `file` for a program that writes the file itself (ffmpeg): rename it over `file` once written. */
export function freshSibling(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}${path.extname(file)}`);
}

/** True when `child` is `parent` or inside it (both absolute, already resolved). */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** A scheme in front of a path ("https://…", "data:…", "file:…"); a Windows drive letter ("C:\…") is not one. */
export function hasScheme(text) {
  return /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text);
}

/**
 * An existing file a caller names, as a real absolute path inside the repository – or a PathError saying why not (a URL, a
 * data: URI, a path outside the repository, a link that leads out of it, a folder, a missing file).
 */
export function resolveInputFile(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new PathError("No file given");
  if (/[\0\r\n]/.test(text)) throw new PathError("The path has a control character");
  if (hasScheme(text)) throw new PathError(`Only local files inside the repository are read: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}" is a URL or a data: URI, and the tools never fetch one`);
  const resolved = path.resolve(ROOT, text);
  if (!isInside(ROOT, resolved)) throw new PathError(`${text} is outside the repository: copy the file into .agent-out/inbox/ first`);
  if (!fs.existsSync(resolved)) throw new PathError(`${path.relative(ROOT, resolved) || text} does not exist`);
  const real = fs.realpathSync(resolved);
  if (!isInside(realRoot(), real)) throw new PathError(`${text} leads outside the repository (a symbolic link): copy the file into .agent-out/inbox/ first`);
  if (!fs.statSync(real).isFile()) throw new PathError(`${text} is not a file`);
  return real;
}

/** <repo>/.agent-out/, created with its own .gitignore ("*") the first time – checked to lead inside the repository first. */
export function ensureOutDir() {
  assertLeadsInside(ROOT, OUT_DIR, ".agent-out");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!isInside(realRoot(), fs.realpathSync(OUT_DIR))) throw new PathError(".agent-out leads outside the repository (a symbolic link): remove it");
  const ignore = path.join(OUT_DIR, ".gitignore");
  let ok = false;
  try {
    ok = fs.lstatSync(ignore).isFile();
  } catch {
    ok = false;
  }
  if (!ok) {
    const tmp = path.join(OUT_DIR, `.gitignore.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, "# --- agent-cli --- the agent toolbox's output (scripts/agent): never committed\n*\n", { flag: "wx" });
    fs.renameSync(tmp, ignore);
  }
  return OUT_DIR;
}

/** A fresh-or-reused folder .agent-out/<tool>/<name>/ for a tool's files; `name` is a bare folder name (checked again here). */
export function outputDir(tool, name) {
  if (!/^[a-z][a-z-]*$/.test(tool)) throw new PathError(`Bad tool name ${tool}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) throw new PathError(`The out name "${name}" must be a bare folder name (letters, digits, . _ -)`);
  const dir = path.join(ensureOutDir(), tool, name);
  if (!isInside(OUT_DIR, dir)) throw new PathError("The output folder must stay inside .agent-out/");
  assertLeadsInside(OUT_DIR, dir, `.agent-out/${tool}/${name}`); // (before mkdir: a linked .agent-out/<tool> would take it elsewhere)
  fs.mkdirSync(dir, { recursive: true });
  if (!isInside(fs.realpathSync(OUT_DIR), fs.realpathSync(dir))) throw new PathError("The output folder leads outside .agent-out/ (a symbolic link)");
  return dir;
}

/** A path for the JSON result: relative to the repository, with forward slashes. */
export function repoRelative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** A folder of the agent cache (created; the cache itself checked private first). */
export function cacheDir(...parts) {
  const dir = path.join(cacheRoot(), ...parts);
  if (!isInside(CACHE_DIR, dir)) throw new PathError("A cache folder must stay inside the agent cache");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** A default output name for a request: the tool's subject plus a short hash of the arguments (the same call, the same folder). */
export function defaultOutName(subject, args) {
  const hash = crypto.createHash("sha1").update(JSON.stringify(args ?? {})).digest("hex").slice(0, 8);
  return `${String(subject).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "out"}-${hash}`;
}
