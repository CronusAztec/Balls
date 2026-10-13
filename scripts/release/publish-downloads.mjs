#!/usr/bin/env node
// Publishes a Windows release to the downloads repository: a second, PUBLIC GitHub repository that holds the installers and
// nothing else (https://github.com/CronusAztec/jumpingballslive-windows), so the source repository can be private. The website's
// download buttons (src/lib/desktop/release.ts) and every installed app (electron-updater's generic provider,
// desktop/electron-builder.config.cjs) read ".../releases/latest/download/<file>" there. Run by .github/workflows/desktop.yml's
// release job after the build:
//   node scripts/release/publish-downloads.mjs --dir dist --version 1.1.0 [--repo CronusAztec/jumpingballslive-windows] [--dry-run]
//   node scripts/release/publish-downloads.mjs --verify --dir dist --version 1.1.0 [--url <releases/latest/download address>]
// The release is created as a DRAFT with all its files and published in one step, so an installed app that asks in between sees
// the previous release and its files, never a new latest.yml whose installer is not there yet. `gh` uses GH_TOKEN from the
// environment: a token that can write to the downloads repository (the DOWNLOADS_REPO_TOKEN secret), not the workflow's own.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** GitHub accepts files up to 2 GiB per release asset. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 - 1;
export const DEFAULT_REPO = "CronusAztec/jumpingballslive-windows";
export const DEFAULT_URL = `https://github.com/${DEFAULT_REPO}/releases/latest/download`;

/** @param {string} v */
function assertVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`version "${v}" is not x.y.z`);
}

/** @param {string} repo */
function assertRepo(repo) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`repository "${repo}" is not owner/name`);
}

/** The `version:` of an electron-builder latest.yml, or null. @param {string} text @returns {string | null} */
export function versionOfLatestYml(text) {
  const m = /^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m.exec(String(text));
  return m ? m[1] : null;
}

/**
 * The files of one release, checked: all of them present, none empty or over GitHub's limit, latest.yml naming this version.
 * @param {{ name: string, size: number }[]} files the files of the release folder
 * @param {string} version
 * @param {string} latestYml the text of latest.yml
 * @returns {string[]} the file names to attach
 */
export function planUploads(files, version, latestYml) {
  assertVersion(version);
  const byName = new Map(files.map((f) => [f.name, f]));
  const setup = `JumpingBallsLive-Setup-${version}.exe`;
  const names = [
    setup,
    `${setup}.blockmap`,
    `JumpingBallsLive-${version}-portable.exe`,
    "JumpingBallsLive-Setup.exe",
    "JumpingBallsLive-portable.exe",
    "SHA256SUMS.txt",
    "latest.yml",
  ];
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) throw new Error(`the release folder lacks ${missing.join(", ")}`);
  const named = versionOfLatestYml(latestYml);
  if (named !== version) throw new Error(`latest.yml names version ${named ?? "(none)"}, not ${version}`);
  if (!String(latestYml).includes(setup)) throw new Error(`latest.yml does not point at ${setup}`);
  for (const n of names) {
    const size = /** @type {{ size: number }} */ (byName.get(n)).size;
    if (size <= 0) throw new Error(`${n} is empty`);
    if (size > MAX_UPLOAD_BYTES) throw new Error(`${n} is ${Math.round(size / 1048576)} MiB; GitHub accepts release files up to 2 GiB. Turn off DESKTOP_CUDA (the NVIDIA build adds about 180 MB).`);
  }
  return names;
}

/**
 * The `gh` calls that publish a release, in order: look for it, create it as a draft with every file (or add the files to the
 * existing one), then publish it as the latest.
 * @param {string} repo @param {string} dir @param {string} version @param {string[]} names @param {boolean} exists
 */
export function ghCalls(repo, dir, version, names, exists) {
  const tag = `v${version}`;
  const files = names.map((n) => path.join(dir, n));
  const notes = [
    `JumpingBallsLive for Windows ${version}.`,
    "",
    `- Installer (per user, no admin): JumpingBallsLive-Setup-${version}.exe – updates itself.`,
    `- Portable: JumpingBallsLive-${version}-portable.exe – runs without installing.`,
    "- Unsigned builds: Windows SmartScreen shows \"Windows protected your PC\" – click More info, then Run anyway. Checksums: SHA256SUMS.txt.",
  ].join("\n");
  return [
    exists
      ? ["release", "upload", tag, ...files, "--clobber", "--repo", repo]
      : ["release", "create", tag, ...files, "--draft", "--repo", repo, "--title", `JumpingBallsLive for Windows ${version}`, "--notes", notes],
    ["release", "edit", tag, "--draft=false", "--latest", "--repo", repo],
  ];
}

function readFolder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => ({ name: d.name, size: fs.statSync(path.join(dir, d.name)).size }));
}

function parseArgs(argv) {
  const out = { dir: "", version: "", repo: DEFAULT_REPO, url: DEFAULT_URL, dryRun: false, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verify") out.verify = true;
    else if (["--dir", "--version", "--repo", "--url"].includes(a)) out[a.slice(2)] = argv[++i] ?? "";
    else throw new Error(`unknown option ${a}`);
  }
  if (!out.dir || !out.version) throw new Error("usage: publish-downloads.mjs --dir <folder> --version <x.y.z> [--repo <owner/name>] [--url <https://…>] [--dry-run | --verify]");
  out.url = out.url.replace(/\/+$/, "");
  return out;
}

function upload(opts) {
  assertRepo(opts.repo);
  const files = readFolder(opts.dir);
  const latest = fs.readFileSync(path.join(opts.dir, "latest.yml"), "utf8");
  const names = planUploads(files, opts.version, latest);
  const dir = path.resolve(opts.dir);
  const tag = `v${opts.version}`;
  let exists = false;
  if (!opts.dryRun) {
    try {
      execFileSync("gh", ["release", "view", tag, "--repo", opts.repo], { stdio: "ignore" });
      exists = true;
    } catch {
      exists = false; // no such release yet (or the repository cannot be read: the create below then says why)
    }
  }
  for (const args of ghCalls(opts.repo, dir, opts.version, names, exists)) {
    console.log(`${opts.dryRun ? "would run" : "running"} gh ${args.slice(0, 3).join(" ")}${args.length > 3 ? " …" : ""}`);
    if (!opts.dryRun) execFileSync("gh", args, { stdio: "inherit" });
  }
  console.log(`${opts.dryRun ? "planned" : "published"} ${names.length} files as ${tag} in ${opts.repo}`);
}

/** Polls the downloads address until latest.yml names the version and the fixed-name installer has the size of the local file. */
async function verify(opts) {
  const files = readFolder(opts.dir);
  const setupSize = files.find((f) => f.name === "JumpingBallsLive-Setup.exe")?.size ?? -1;
  let last = "no answer";
  // 12 tries ten seconds apart (a new release can need a moment to be served as the latest); the tests shorten them
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
  throw new Error(`${opts.url} does not serve ${opts.version} after ${Math.round((tries * wait) / 1000)} seconds (${last}). Is the downloads repository public, and is this release its latest one (Releases → ${opts.version} → "Set as the latest release")?`);
}

async function main(argv) {
  try {
    const opts = parseArgs(argv);
    if (opts.verify) await verify(opts);
    else upload(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`::error title=Publishing the downloads failed::${message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
