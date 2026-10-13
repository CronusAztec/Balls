import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { DEFAULT_REPO, DEFAULT_URL, MAX_UPLOAD_BYTES, ghCalls, planUploads, versionOfLatestYml } from "../scripts/release/publish-downloads.mjs";
import { DOWNLOADS_REPO, DOWNLOADS_URL, PORTABLE_ASSET, SETUP_ASSET, versionedAssetNames } from "@/lib/desktop/release";

/*
 * scripts/release/publish-downloads.mjs puts a release on the downloads repository (public, releases only). The site's download
 * links (src/lib/desktop/release.ts), the installed apps' update feed (desktop/electron-builder.config.cjs) and this script have
 * to agree on names and on the place, or a release is published where nobody looks.
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
  it("attaches the versioned files, the fixed-name copies, the checksums and latest.yml", () => {
    expect(planUploads(folder(), V, LATEST)).toEqual(NAMES);
  });

  it("names the files the way the site, the app and electron-builder do", () => {
    const { setup, portable } = versionedAssetNames(V);
    const names = planUploads(folder(), V, LATEST);
    expect(names).toContain(setup);
    expect(names).toContain(portable);
    expect(names).toContain(SETUP_ASSET);
    expect(names).toContain(PORTABLE_ASSET);
    expect(names).toContain(`${setup}.blockmap`);
  });

  it("refuses a release that is incomplete, mislabelled, empty or over GitHub's limit", () => {
    expect(() => planUploads(folder().filter((f) => f.name !== "SHA256SUMS.txt"), V, LATEST)).toThrow(/lacks SHA256SUMS\.txt/);
    expect(() => planUploads(folder({}, "1.1.1"), "1.1.1", LATEST)).toThrow(/names version 1\.1\.0, not 1\.1\.1/);
    expect(() => planUploads(folder(), V, LATEST.replace(`path: JumpingBallsLive-Setup-${V}.exe`, "path: other.exe").replaceAll(`JumpingBallsLive-Setup-${V}.exe`, "other.exe"))).toThrow(/does not point at/);
    expect(() => planUploads(folder({ "latest.yml": 0 }), V, LATEST)).toThrow(/latest\.yml is empty/);
    expect(() => planUploads(folder({ [`JumpingBallsLive-Setup-${V}.exe`]: MAX_UPLOAD_BYTES + 1 }), V, LATEST)).toThrow(/2 GiB/);
    expect(() => planUploads(folder(), "1.1", LATEST)).toThrow(/not x\.y\.z/);
  });

  it("reads the version of an electron-builder latest.yml", () => {
    expect(versionOfLatestYml(LATEST)).toBe(V);
    expect(versionOfLatestYml("version: '2.0.10'\n")).toBe("2.0.10");
    expect(versionOfLatestYml("files: []\n")).toBeNull();
    expect(versionOfLatestYml("version: 1.0\n")).toBeNull();
  });
});

describe("publish-downloads: gh's calls and the place", () => {
  it("creates a draft with every file, then publishes it as the latest", () => {
    const [create, publish] = ghCalls("o/r", "dist", V, NAMES, false);
    expect(create.slice(0, 2)).toEqual(["release", "create"]);
    expect(create[2]).toBe(`v${V}`);
    expect(create.slice(3, 3 + NAMES.length)).toEqual(NAMES.map((n) => path.join("dist", n)));
    expect(create).toContain("--draft");
    expect(create.slice(create.indexOf("--repo"), create.indexOf("--repo") + 2)).toEqual(["--repo", "o/r"]);
    expect(publish).toEqual(["release", "edit", `v${V}`, "--draft=false", "--latest", "--repo", "o/r"]);
  });

  it("adds the files to a release that exists (a re-run) instead of creating it again", () => {
    const [upload, publish] = ghCalls("o/r", "dist", V, NAMES, true);
    expect(upload.slice(0, 3)).toEqual(["release", "upload", `v${V}`]);
    expect(upload).toContain("--clobber");
    expect(publish[1]).toBe("edit");
  });

  it("serves the place the site links to", () => {
    expect(DEFAULT_REPO).toBe(DOWNLOADS_REPO);
    expect(DEFAULT_URL).toBe(DOWNLOADS_URL);
    expect(DOWNLOADS_URL).toBe("https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download");
  });
});

/* The script itself, end to end: the real publishing goes through a stand-in `gh` that records its calls, and --verify talks to a
   local HTTP server standing in for GitHub's "latest release" downloads. */
const SCRIPT = path.join(__dirname, "..", "scripts", "release", "publish-downloads.mjs");
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
  it("creates the draft release, then publishes it, through gh with the given repository", () => {
    const dir = releaseFolder();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "publish-downloads-bin-"));
    cleanups.push(() => fs.rmSync(bin, { recursive: true, force: true }));
    const log = path.join(bin, "calls.log");
    // `gh release view` fails (no such release yet); every other call is recorded
    fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '@@%s\\n' "$*" >> '${log}'\n[ "$2" = view ] && exit 1\nexit 0\n`, { mode: 0o755 });
    const run = spawnSync(process.execPath, [SCRIPT, "--dir", path.relative(process.cwd(), dir), "--version", V, "--repo", "o/r"], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    expect(run.status, run.stderr).toBe(0);
    const calls = fs.readFileSync(log, "utf8").split("@@").slice(1).map((c) => c.trimEnd());
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe(`release view v${V} --repo o/r`);
    expect(calls[1].startsWith(`release create v${V} ${path.join(dir, NAMES[0])} `), calls[1]).toBe(true);
    for (const n of NAMES) expect(calls[1], n).toContain(path.join(dir, n));
    expect(calls[1]).toContain("--draft");
    expect(calls[2]).toBe(`release edit v${V} --draft=false --latest --repo o/r`);
  });

  it("--dry-run runs nothing, and a repository that is not owner/name is refused", () => {
    const dir = releaseFolder();
    let run = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--version", V, "--dry-run"], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`planned ${NAMES.length} files as v${V} in ${DEFAULT_REPO}`);
    run = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--version", V, "--repo", "no-slash"], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/is not owner\/name/);
  });

  it("publishes nothing when the release folder is wrong", () => {
    const dir = releaseFolder();
    fs.rmSync(path.join(dir, "JumpingBallsLive-portable.exe"));
    const run = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--version", V], { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent" } });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/::error title=Publishing the downloads failed::the release folder lacks JumpingBallsLive-portable\.exe/);
  });

  /** A local stand-in for the latest release's downloads. */
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
    expect(run.stderr).toMatch(/Is the downloads repository public/);
  });
});
