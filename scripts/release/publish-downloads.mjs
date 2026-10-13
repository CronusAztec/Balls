#!/usr/bin/env node
// Publishes a Windows release to the downloads host: a Cloudflare R2 bucket that https://downloads.jumpingballslive.com serves.
// The website's download buttons (src/lib/desktop/release.ts) and every installed app (electron-updater's generic provider,
// desktop/electron-builder.config.cjs) read it, so the repository can be private. Run by .github/workflows/desktop.yml's
// release job after the build:
//   node scripts/release/publish-downloads.mjs --dir dist --version 1.1.0 --bucket jumpingballslive-downloads [--dry-run]
//   node scripts/release/publish-downloads.mjs --verify --dir dist --version 1.1.0 --url https://downloads.jumpingballslive.com
// Upload order matters: the versioned files first, the fixed-name copies next and latest.yml LAST, so an installed app that
// asks in between still sees the old version and its files, never a new latest.yml whose installer is not there yet.
// Wrangler (the version billing/package-lock.json pins) uploads with CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID from the
// environment; it refuses files over 300 MiB (a build with DESKTOP_CUDA=1 would be over it).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
export const DEFAULT_BUCKET = "jumpingballslive-downloads";
export const DEFAULT_URL = "https://downloads.jumpingballslive.com";

const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300";
const FEED = "public, max-age=60";

/** @param {string} v */
function assertVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`version "${v}" is not x.y.z`);
}

/** The `version:` of an electron-builder latest.yml, or null. @param {string} text @returns {string | null} */
export function versionOfLatestYml(text) {
  const m = /^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m.exec(String(text));
  return m ? m[1] : null;
}

/**
 * What to upload, in order, for one release.
 * @param {{ name: string, size: number }[]} files the files of the release folder
 * @param {string} version
 * @param {string} latestYml the text of latest.yml
 * @returns {{ key: string, file: string, contentType: string, cacheControl: string, contentDisposition?: string }[]}
 */
export function planUploads(files, version, latestYml) {
  assertVersion(version);
  const byName = new Map(files.map((f) => [f.name, f]));
  const setup = `JumpingBallsLive-Setup-${version}.exe`;
  const portable = `JumpingBallsLive-${version}-portable.exe`;
  const exe = "application/octet-stream";
  const attach = (name) => `attachment; filename="${name}"`;
  /** @type {{ key: string, contentType: string, cacheControl: string, contentDisposition?: string }[]} */
  const plan = [
    { key: setup, contentType: exe, cacheControl: IMMUTABLE, contentDisposition: attach(setup) },
    { key: `${setup}.blockmap`, contentType: "application/octet-stream", cacheControl: IMMUTABLE },
    { key: portable, contentType: exe, cacheControl: IMMUTABLE, contentDisposition: attach(portable) },
    { key: "JumpingBallsLive-Setup.exe", contentType: exe, cacheControl: SHORT, contentDisposition: attach("JumpingBallsLive-Setup.exe") },
    { key: "JumpingBallsLive-portable.exe", contentType: exe, cacheControl: SHORT, contentDisposition: attach("JumpingBallsLive-portable.exe") },
    { key: "SHA256SUMS.txt", contentType: "text/plain; charset=utf-8", cacheControl: SHORT },
    { key: "latest.yml", contentType: "text/yaml; charset=utf-8", cacheControl: FEED },
  ];
  const missing = plan.filter((p) => !byName.has(p.key)).map((p) => p.key);
  if (missing.length) throw new Error(`the release folder lacks ${missing.join(", ")}`);
  const named = versionOfLatestYml(latestYml);
  if (named !== version) throw new Error(`latest.yml names version ${named ?? "(none)"}, not ${version}`);
  if (!String(latestYml).includes(setup)) throw new Error(`latest.yml does not point at ${setup}`);
  for (const p of plan) {
    const size = /** @type {{ size: number }} */ (byName.get(p.key)).size;
    if (size <= 0) throw new Error(`${p.key} is empty`);
    if (size > MAX_UPLOAD_BYTES) {
      throw new Error(`${p.key} is ${Math.round(size / 1048576)} MiB; wrangler uploads at most 300 MiB to R2. Turn off DESKTOP_CUDA (the NVIDIA build adds about 180 MB), or have the upload switched to R2's S3 API.`);
    }
  }
  return plan.map((p) => ({ ...p, file: p.key }));
}

/** The arguments of `wrangler r2 object put` for one planned upload. */
export function putArgs(bucket, dir, item) {
  const args = ["r2", "object", "put", `${bucket}/${item.key}`, "--file", path.join(dir, item.file), "--content-type", item.contentType, "--cache-control", item.cacheControl];
  if (item.contentDisposition) args.push("--content-disposition", item.contentDisposition);
  return args;
}

function readFolder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => ({ name: d.name, size: fs.statSync(path.join(dir, d.name)).size }));
}

function parseArgs(argv) {
  const out = { dir: "", version: "", bucket: DEFAULT_BUCKET, url: DEFAULT_URL, dryRun: false, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verify") out.verify = true;
    else if (["--dir", "--version", "--bucket", "--url"].includes(a)) out[a.slice(2)] = argv[++i] ?? "";
    else throw new Error(`unknown option ${a}`);
  }
  if (!out.dir || !out.version) throw new Error("usage: publish-downloads.mjs --dir <folder> --version <x.y.z> [--bucket <name>] [--url <https://…>] [--dry-run | --verify]");
  out.url = out.url.replace(/\/+$/, "");
  return out;
}

async function upload(opts) {
  const files = readFolder(opts.dir);
  const latest = fs.readFileSync(path.join(opts.dir, "latest.yml"), "utf8");
  const plan = planUploads(files, opts.version, latest);
  const billing = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "billing");
  // Wrangler runs in an empty folder, so that no wrangler.toml (the site's Worker, the billing Worker) is read for an upload.
  const neutral = opts.dryRun ? "" : fs.mkdtempSync(path.join(os.tmpdir(), "jbl-r2-"));
  const dir = path.resolve(opts.dir);
  try {
    for (const item of plan) {
      const args = putArgs(opts.bucket, dir, item);
      console.log(`${opts.dryRun ? "would upload" : "uploading"} ${item.key}`);
      if (opts.dryRun) continue;
      execFileSync("npx", ["--prefix", billing, "wrangler", ...args], { cwd: neutral, stdio: "inherit" });
    }
  } finally {
    if (neutral) fs.rmSync(neutral, { recursive: true, force: true });
  }
  console.log(`${opts.dryRun ? "planned" : "uploaded"} ${plan.length} files to ${opts.bucket}`);
}

/** Polls the downloads host until latest.yml names the version and the fixed-name installer has the size of the local file. */
async function verify(opts) {
  const files = readFolder(opts.dir);
  const setupSize = files.find((f) => f.name === "JumpingBallsLive-Setup.exe")?.size ?? -1;
  let last = "no answer";
  // 12 tries ten seconds apart (the bucket's custom domain can need a moment); the tests shorten them
  const tries = Number(process.env.JBL_VERIFY_TRIES) || 12;
  const wait = process.env.JBL_VERIFY_WAIT_MS !== undefined ? Number(process.env.JBL_VERIFY_WAIT_MS) : 10_000;
  for (let i = 0; i < tries; i++) {
    try {
      const feed = await fetch(`${opts.url}/latest.yml?x=${Date.now()}`, { signal: AbortSignal.timeout(20_000) });
      const seen = feed.ok ? versionOfLatestYml(await feed.text()) : null;
      if (seen !== opts.version) {
        last = feed.ok ? `latest.yml names ${seen ?? "no version"}` : `latest.yml answers HTTP ${feed.status}`;
      } else {
        const head = await fetch(`${opts.url}/JumpingBallsLive-Setup.exe`, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
        const length = Number(head.headers.get("content-length"));
        if (head.ok && length === setupSize) {
          console.log(`${opts.url}/latest.yml serves ${opts.version}; JumpingBallsLive-Setup.exe is ${length} bytes`);
          return;
        }
        last = head.ok ? `JumpingBallsLive-Setup.exe is ${length} bytes, expected ${setupSize}` : `JumpingBallsLive-Setup.exe answers HTTP ${head.status}`;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`${opts.url} does not serve ${opts.version} after ${Math.round((tries * wait) / 1000)} seconds (${last}). Is the bucket connected to that domain (Cloudflare dashboard → R2 → the bucket → Settings → Custom Domains)?`);
}

async function main(argv) {
  try {
    const opts = parseArgs(argv);
    if (opts.verify) await verify(opts);
    else await upload(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`::error title=Publishing the downloads failed::${message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
