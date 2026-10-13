import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { DEFAULT_BUCKET, DEFAULT_URL, MAX_UPLOAD_BYTES, planUploads, putArgs, versionOfLatestYml } from "../scripts/release/publish-downloads.mjs";
import { DOWNLOADS_URL, PORTABLE_ASSET, SETUP_ASSET, versionedAssetNames } from "@/lib/desktop/release";

/*
 * scripts/release/publish-downloads.mjs puts a release on the downloads host (a Cloudflare R2 bucket). The site's download links
 * (src/lib/desktop/release.ts), the installed apps' update feed (desktop/electron-builder.config.cjs) and this script have to
 * agree on names and on the host, or a release is published where nobody looks.
 */

const V = "1.1.0";
const LATEST = `version: ${V}\nfiles:\n  - url: JumpingBallsLive-Setup-${V}.exe\n    sha512: abc\n    size: 150174632\npath: JumpingBallsLive-Setup-${V}.exe\nsha512: abc\nreleaseDate: '2026-10-13T00:00:00.000Z'\n`;
const namesFor = (v: string) => [
  `JumpingBallsLive-Setup-${v}.exe`,
  `JumpingBallsLive-Setup-${v}.exe.blockmap`,
  `JumpingBallsLive-${v}-portable.exe`,
  "JumpingBallsLive-Setup.exe",
  "JumpingBallsLive-portable.exe",
  "SHA256SUMS.txt",
  "latest.yml",
];
const NAMES = namesFor(V);
const folder = (over: Record<string, number> = {}, v = V) => namesFor(v).map((name) => ({ name, size: over[name] ?? 150_000_000 }));

describe("publish-downloads: the plan", () => {
  it("uploads the versioned files first, the fixed-name copies next and latest.yml last", () => {
    const plan = planUploads(folder(), V, LATEST);
    expect(plan.map((p) => p.key)).toEqual(NAMES);
    expect(plan[plan.length - 1].key).toBe("latest.yml");
  });

  it("names the files the way the site, the app and electron-builder do", () => {
    const { setup, portable } = versionedAssetNames(V);
    const keys = planUploads(folder(), V, LATEST).map((p) => p.key);
    expect(keys).toContain(setup);
    expect(keys).toContain(portable);
    expect(keys).toContain(SETUP_ASSET);
    expect(keys).toContain(PORTABLE_ASSET);
    expect(keys).toContain(`${setup}.blockmap`);
  });

  it("caches the versioned files for good, the fixed names briefly and the feed for a minute", () => {
    const by = Object.fromEntries(planUploads(folder(), V, LATEST).map((p) => [p.key, p]));
    expect(by[`JumpingBallsLive-Setup-${V}.exe`].cacheControl).toContain("immutable");
    expect(by["JumpingBallsLive-Setup.exe"].cacheControl).toBe("public, max-age=300");
    expect(by["latest.yml"].cacheControl).toBe("public, max-age=60");
    expect(by["JumpingBallsLive-Setup.exe"].contentDisposition).toBe('attachment; filename="JumpingBallsLive-Setup.exe"');
    expect(by["latest.yml"].contentType).toContain("yaml");
  });

  it("refuses a release that is incomplete, mislabelled, empty or too big for wrangler", () => {
    expect(() => planUploads(folder().filter((f) => f.name !== "SHA256SUMS.txt"), V, LATEST)).toThrow(/lacks SHA256SUMS\.txt/);
    expect(() => planUploads(folder({}, "1.1.1"), "1.1.1", LATEST)).toThrow(/names version 1\.1\.0, not 1\.1\.1/);
    expect(() => planUploads(folder(), V, LATEST.replace(`path: JumpingBallsLive-Setup-${V}.exe`, "path: other.exe").replaceAll(`JumpingBallsLive-Setup-${V}.exe`, "other.exe"))).toThrow(/does not point at/);
    expect(() => planUploads(folder({ "latest.yml": 0 }), V, LATEST)).toThrow(/latest\.yml is empty/);
    expect(() => planUploads(folder({ [`JumpingBallsLive-Setup-${V}.exe`]: MAX_UPLOAD_BYTES + 1 }), V, LATEST)).toThrow(/300 MiB/);
    expect(() => planUploads(folder(), "1.1", LATEST)).toThrow(/not x\.y\.z/);
  });

  it("reads the version of an electron-builder latest.yml", () => {
    expect(versionOfLatestYml(LATEST)).toBe(V);
    expect(versionOfLatestYml("version: '2.0.10'\n")).toBe("2.0.10");
    expect(versionOfLatestYml("files: []\n")).toBeNull();
    expect(versionOfLatestYml("version: 1.0\n")).toBeNull();
  });
});

describe("publish-downloads: wrangler's arguments and the host", () => {
  it("puts one object with its type, cache rule and (for an EXE) file name", () => {
    const item = planUploads(folder(), V, LATEST)[3];
    expect(putArgs("bucket-x", "dist", item)).toEqual([
      "r2", "object", "put", "bucket-x/JumpingBallsLive-Setup.exe",
      "--file", path.join("dist", "JumpingBallsLive-Setup.exe"),
      "--content-type", "application/octet-stream",
      "--cache-control", "public, max-age=300",
      "--content-disposition", 'attachment; filename="JumpingBallsLive-Setup.exe"',
    ]);
  });

  it("serves the host the site links to, and keeps its bucket name in the docs", () => {
    expect(DEFAULT_URL).toBe(DOWNLOADS_URL);
    expect(DOWNLOADS_URL).toBe("https://downloads.jumpingballslive.com");
    expect(DEFAULT_BUCKET).toBe("jumpingballslive-downloads");
  });
});

/* The script itself, end to end: the real uploads go through a stand-in `npx` that records how wrangler would have been called,
   and --verify talks to a local HTTP server standing in for the downloads host. */
const SCRIPT = path.join(__dirname, "..", "scripts", "release", "publish-downloads.mjs");
const REPO_ROOT = path.join(__dirname, "..");
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function releaseFolder(version = V, setupBytes = 1234): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-downloads-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of namesFor(version)) fs.writeFileSync(path.join(dir, name), name === "latest.yml" ? LATEST.replaceAll(V, version) : "x".repeat(name === "JumpingBallsLive-Setup.exe" ? setupBytes : 10));
  return dir;
}

describe("publish-downloads: the script", () => {
  it("uploads in plan order through wrangler, from an empty folder, with absolute file paths", () => {
    const dir = releaseFolder();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "publish-downloads-bin-"));
    cleanups.push(() => fs.rmSync(bin, { recursive: true, force: true }));
    const log = path.join(bin, "calls.log");
    fs.writeFileSync(path.join(bin, "npx"), `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> '${log}'\n`, { mode: 0o755 });
    const run = spawnSync(process.execPath, [SCRIPT, "--dir", path.relative(process.cwd(), dir), "--version", V], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    expect(run.status, run.stderr).toBe(0);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => l.split("|"));
    expect(calls).toHaveLength(NAMES.length);
    calls.forEach(([cwd, args], i) => {
      expect(cwd.startsWith(REPO_ROOT), "wrangler runs outside the repository: " + cwd).toBe(false);
      expect(args.startsWith(`--prefix ${path.join(REPO_ROOT, "billing")} wrangler r2 object put ${DEFAULT_BUCKET}/${NAMES[i]} --file ${path.join(dir, NAMES[i])} `), args).toBe(true);
    });
    expect(calls[calls.length - 1][1]).toContain(`${DEFAULT_BUCKET}/latest.yml `);
  });

  it("uploads nothing when the release folder is wrong", () => {
    const dir = releaseFolder();
    fs.rmSync(path.join(dir, "JumpingBallsLive-portable.exe"));
    const run = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--version", V], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/::error title=Publishing the downloads failed::the release folder lacks JumpingBallsLive-portable\.exe/);
  });

  /** A local stand-in for the downloads host. */
  async function host(feedVersion: string | null, setupLength: number): Promise<string> {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/latest.yml") {
        if (feedVersion === null) return void res.writeHead(404).end();
        return void res.writeHead(200, { "content-type": "text/yaml" }).end(`version: ${feedVersion}\n`);
      }
      if (url.pathname === "/JumpingBallsLive-Setup.exe") return void res.writeHead(200, { "content-length": String(setupLength) }).end(req.method === "HEAD" ? undefined : "x".repeat(setupLength));
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  // asynchronous: the stand-in host runs in this process, which must stay free to answer while the script asks
  const verify = (dir: string, url: string, version = V) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, "--verify", "--dir", dir, "--version", version, "--url", url], { env: { ...process.env, JBL_VERIFY_TRIES: "2", JBL_VERIFY_WAIT_MS: "20" } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  it("--verify accepts a host whose latest.yml names the version and whose installer has the built size", async () => {
    const dir = releaseFolder(V, 1234);
    const run = await verify(dir, await host(V, 1234));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`serves ${V}`);
  });

  it("--verify fails, saying what it saw, for an old feed, a wrong size or a missing feed", async () => {
    const dir = releaseFolder(V, 1234);
    let run = await verify(dir, await host("1.0.3", 1234));
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/latest\.yml names 1\.0\.3/);
    run = await verify(dir, await host(V, 999));
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/is 999 bytes, expected 1234/);
    run = await verify(dir, await host(null, 1234));
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/latest\.yml answers HTTP 404/);
    expect(run.stderr).toMatch(/Custom Domains/);
  });
});
