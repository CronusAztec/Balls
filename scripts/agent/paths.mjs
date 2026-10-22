/**
 * --- agent-cli --- Where the agent toolbox may read and write (scripts/agent/*.mjs):
 *  - ROOT: the repository (this checkout). Every path a caller names is resolved – symbolic links included – and must stay
 *    inside it; URLs (http:, https:, data:, file: …) are refused, never opened.
 *  - OUT_DIR: <repo>/.agent-out/, the only place a tool writes files (PNG, MP4, JSON reports). It ignores itself (it holds a
 *    .gitignore of "*"), so nothing a tool writes ever shows in `git status`.
 *  - CACHE_DIR: the agent cache outside the repository – JBL_AGENT_CACHE, else <OS temp>/jbl-agent-<hash of ROOT>: the bundled
 *    toolbox and the local export (a copy of the working tree, built there). Outside the repository on purpose: a source copy
 *    inside it would be type-checked and linted with the real one, and one under node_modules/ is not compiled by Next.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = path.join(ROOT, ".agent-out");
export const CACHE_DIR = process.env.JBL_AGENT_CACHE ? path.resolve(process.env.JBL_AGENT_CACHE) : path.join(os.tmpdir(), `jbl-agent-${crypto.createHash("sha1").update(ROOT).digest("hex").slice(0, 10)}`);

export class PathError extends Error {}

const realRoot = () => fs.realpathSync(ROOT);

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

/** <repo>/.agent-out/, created with its own .gitignore ("*") the first time. */
export function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ignore = path.join(OUT_DIR, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "# --- agent-cli --- the agent toolbox's output (scripts/agent): never committed\n*\n");
  if (!isInside(realRoot(), fs.realpathSync(OUT_DIR))) throw new PathError(".agent-out leads outside the repository (a symbolic link): remove it");
  return OUT_DIR;
}

/** A fresh-or-reused folder .agent-out/<tool>/<name>/ for a tool's files; `name` is a bare folder name (checked again here). */
export function outputDir(tool, name) {
  if (!/^[a-z][a-z-]*$/.test(tool)) throw new PathError(`Bad tool name ${tool}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) throw new PathError(`The out name "${name}" must be a bare folder name (letters, digits, . _ -)`);
  const dir = path.join(ensureOutDir(), tool, name);
  if (!isInside(OUT_DIR, dir)) throw new PathError("The output folder must stay inside .agent-out/");
  fs.mkdirSync(dir, { recursive: true });
  if (!isInside(fs.realpathSync(OUT_DIR), fs.realpathSync(dir))) throw new PathError("The output folder leads outside .agent-out/ (a symbolic link)");
  return dir;
}

/** A path for the JSON result: relative to the repository, with forward slashes. */
export function repoRelative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** The agent cache folder (created). */
export function cacheDir(...parts) {
  const dir = path.join(CACHE_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A default output name for a request: the tool's subject plus a short hash of the arguments (the same call, the same folder). */
export function defaultOutName(subject, args) {
  const hash = crypto.createHash("sha1").update(JSON.stringify(args ?? {})).digest("hex").slice(0, 8);
  return `${String(subject).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "out"}-${hash}`;
}
