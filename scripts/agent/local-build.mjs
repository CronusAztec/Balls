/**
 * --- agent-cli --- The local export the browser tools look at (preview, render, site-shot): the site as the working tree
 * builds it – committed or not – so an agent sees its own change. It is built in the agent cache (paths.mjs CACHE_DIR,
 * outside the repository), never in out/ or .next/ of the checkout:
 *  1. the working tree's files (`git ls-files -c -o --exclude-standard`: tracked and new, never ignored ones such as .env)
 *     are copied to <cache>/site/tree – without the other packages, the tests, the docs and the smoke and agent tooling,
 *     which the site does not build from (SKIPPED) –
 *     and node_modules is linked in;
 *  2. `next build --no-lint` runs there with a clean environment: no NEXT_PUBLIC_* or analytics variables from the shell (a
 *     test-mode build at the root path, no statistics script), Next's telemetry off, and – in the copy's next.config.ts only
 *     – Next's own type check skipped (`npm run typecheck` / the guard check types; this build is for looking);
 *  3. scripts/postexport.mjs finishes the export there with OBFUSCATE=0.
 * The build's key is HEAD plus the content of every changed or new file; `auto` rebuilds only when it differs from the last
 * build's (<cache>/site/stamp.json), `reuse` takes the last build as it is, `force` always rebuilds. One build at a time
 * (a lock folder); the build's output goes to <cache>/site/build.log, never to the CLI's stdout.
 */
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ROOT, cacheDir } from "./paths.mjs";

/**
 * What the site's build never reads – the other packages, the tests, the docs, the smoke and agent tooling – so editing them
 * neither lands in the copy nor triggers a rebuild (desktop/package.json is kept: the build records the app's version).
 */
const SKIPPED = ["desktop/", "billing/", "relay/", "tests/", ".github/", "deploy/", "docs/", "scripts/agent/", "scripts/smoke/", "scripts/smoke-test.mjs", "scripts/smoke-timing.json", "scripts/release/", "README.md", "CHANGELOG.md", "AGENTS.md", "CLAUDE.md", ".mcp.json"];
const KEPT_IN_SKIPPED = new Set(["desktop/package.json"]);
const BUILD_TIMEOUT_MS = 15 * 60_000;
const LOCK_WAIT_MS = 20 * 60_000;

export function siteFile(rel) {
  return KEPT_IN_SKIPPED.has(rel) || !SKIPPED.some((p) => rel.startsWith(p));
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr ?? "").toString().trim() || r.error?.message}`);
  return r.stdout;
}

const nulList = (buf) => buf.toString("utf8").split("\0").filter(Boolean);

/** The working tree's site files (tracked and new, not ignored, still on disk), repository-relative with forward slashes. */
export function siteFiles() {
  return nulList(git(["ls-files", "-z", "-c", "-o", "--exclude-standard"]))
    .filter(siteFile)
    .filter((rel) => {
      try {
        return fs.lstatSync(path.join(ROOT, rel)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** HEAD plus the content of every changed, deleted or new site file: equal keys build equal exports. */
export function workingTreeKey() {
  const head = git(["rev-parse", "HEAD"]).toString().trim();
  const hash = crypto.createHash("sha256").update(`head ${head}\n`);
  const changed = new Set();
  // porcelain v1 -z: "XY path\0" (a rename adds "\0orig"); every changed or untracked path, not ignored ones
  const entries = nulList(git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const status = e.slice(0, 2);
    changed.add(e.slice(3));
    if (status.includes("R") || status.includes("C")) changed.add(entries[++i]);
  }
  for (const rel of [...changed].filter(siteFile).sort()) {
    const file = path.join(ROOT, rel);
    let content = "deleted";
    try {
      const st = fs.lstatSync(file);
      content = st.isFile() ? crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex") : `not a file`;
    } catch {
      content = "deleted";
    }
    hash.update(`${rel}\0${content}\n`);
  }
  return { head, key: hash.digest("hex").slice(0, 16), dirty: changed.size > 0 };
}

function readStamp(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Holds <cache>/site/build.lock while `fn` runs (a lock left by a process that is gone is taken over). */
async function withLock(dir, fn) {
  const lock = path.join(dir, "build.lock");
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
      break;
    } catch {
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(path.join(lock, "pid"), "utf8")) || 0;
      } catch {
        pid = 0; // released meanwhile, or not written yet: try again
      }
      if (pid && !pidAlive(pid)) fs.rmSync(lock, { recursive: true, force: true });
      else if (Date.now() - started > LOCK_WAIT_MS) throw new Error("Another local export build has held its lock for 20 minutes");
      else await sleep(1000);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** Copies the site files into `tree` (everything in it but .next/ and node_modules is replaced) and links node_modules. */
function syncTree(tree) {
  fs.mkdirSync(tree, { recursive: true });
  for (const entry of fs.readdirSync(tree)) {
    if (entry === ".next" || entry === "node_modules") continue;
    fs.rmSync(path.join(tree, entry), { recursive: true, force: true });
  }
  const files = siteFiles();
  for (const rel of files) {
    const dst = path.join(tree, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  const link = path.join(tree, "node_modules");
  if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(path.join(ROOT, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  return files.length;
}

/** The copy's next.config.ts without Next's own type check and lint (the copy only; false when the config changed form). */
export function patchNextConfig(source) {
  const at = /const nextConfig: NextConfig = \{\n/;
  if (!at.test(source)) return null;
  return source.replace(at, (m) => `${m}  // --- agent-cli --- the agent's local export (scripts/agent/local-build.mjs): types and lint are checked by npm run typecheck / lint\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },\n`);
}

/** The build's environment: the shell's, minus the site's public and statistics settings; a test-mode build at "/". */
export function buildEnv(env, head) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("NEXT_PUBLIC_") || k.startsWith("JBL_ANALYTICS_") || k === "BASE_URL") continue;
    out[k] = v;
  }
  return { ...out, NEXT_PUBLIC_BASE_PATH: "", NEXT_TELEMETRY_DISABLED: "1", OBFUSCATE: "0", JBL_BUILD_SHA: head, NODE_ENV: "production" };
}

function run(file, args, { cwd, env, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(args[0] ?? file)} took longer than ${BUILD_TIMEOUT_MS / 60000} minutes`));
    }, BUILD_TIMEOUT_MS);
    child.stdout.on("data", (c) => fs.appendFileSync(log, c));
    child.stderr.on("data", (c) => fs.appendFileSync(log, c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const tail = (file, lines = 30) => {
  try {
    return fs.readFileSync(file, "utf8").trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
};

/**
 * The local export, built if needed: { dir (the export: serve it), key, head, dirty, rebuilt, buildSec? }.
 * `mode`: "auto" (default) | "reuse" | "force". Throws when the build fails (with the end of its log).
 */
export async function ensureLocalExport(mode = "auto", note = (m) => process.stderr.write(`${m}\n`)) {
  const site = cacheDir("site");
  const tree = path.join(site, "tree");
  const outDir = path.join(tree, "out");
  const stampFile = path.join(site, "stamp.json");
  const { head, key, dirty } = workingTreeKey();
  const ready = () => fs.existsSync(path.join(outDir, "en", "index.html"));
  const current = () => {
    const stamp = readStamp(stampFile);
    return stamp && ready() ? stamp : null;
  };
  const have = current();
  if (mode === "reuse" && have) return { dir: outDir, key: have.key, head: have.head, dirty: have.dirty, rebuilt: false };
  if (mode !== "force" && have && have.key === key) return { dir: outDir, key, head, dirty, rebuilt: false };
  return withLock(site, async () => {
    const again = current(); // a parallel call may have built it while this one waited
    if (mode !== "force" && again && again.key === key) return { dir: outDir, key, head, dirty, rebuilt: false };
    const started = Date.now();
    const log = path.join(site, "build.log");
    fs.writeFileSync(log, `--- agent-cli local export of ${head}${dirty ? " + working-tree changes" : ""} (key ${key})\n`);
    fs.rmSync(stampFile, { force: true });
    note(`agent: building the local export of the working tree (${head.slice(0, 7)}${dirty ? " + changes" : ""}) – about a minute or two; log: ${log}`);
    const count = syncTree(tree);
    const configFile = path.join(tree, "next.config.ts");
    const patched = fs.existsSync(configFile) ? patchNextConfig(fs.readFileSync(configFile, "utf8")) : null;
    if (patched) fs.writeFileSync(configFile, patched);
    else fs.appendFileSync(log, "next.config.ts changed form: building with Next's own type check (slower)\n");
    const env = buildEnv(process.env, head);
    const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
    const buildCode = await run(process.execPath, [nextBin, "build", "--no-lint"], { cwd: tree, env, log });
    if (buildCode !== 0) throw new Error(`The local export did not build (next build exit ${buildCode}; ${count} files). The end of ${log}:\n${tail(log)}`);
    const postCode = await run(process.execPath, [path.join(tree, "scripts", "postexport.mjs")], { cwd: tree, env, log });
    if (postCode !== 0 || !ready()) throw new Error(`The local export did not finish (postexport exit ${postCode}). The end of ${log}:\n${tail(log)}`);
    const buildSec = Math.round((Date.now() - started) / 1000);
    fs.writeFileSync(stampFile, JSON.stringify({ key, head, dirty, files: count, buildSec }));
    note(`agent: local export ready in ${buildSec} s`);
    return { dir: outDir, key, head, dirty, rebuilt: true, buildSec };
  });
}
