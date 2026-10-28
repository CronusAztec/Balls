import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * --- ai-guard --- The three npm installs (the site's, desktop/'s and billing/'s) stay out of git as folders and as links.
 * A linked worktree, whose node_modules are symlinks to the main checkout's installs, then lists no untracked file: its
 * `git status` is clean, and tests/guardEndToEnd.test.ts, which copies every untracked file of the tree under test, never
 * meets a linked install. Checked in a scratch repository that holds only this checkout's .gitignore.
 */

const ROOT = path.resolve(__dirname, "..");
const INSTALLS = ["node_modules", "desktop/node_modules", "billing/node_modules"];
let temp = "";

/** A scratch repository whose index holds this checkout's .gitignore. */
const scratch = (name: string) => {
  const dir = path.join(temp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, ".gitignore"), path.join(dir, ".gitignore"));
  for (const args of [["init", "-q"], ["add", ".gitignore"]]) {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  }
  return dir;
};
/** The untracked, not ignored files, as the guard and tests/guardEndToEnd.test.ts list them (no personal excludes file). */
const untracked = (dir: string) => {
  const r = spawnSync("git", ["-c", `core.excludesFile=${path.join(temp, "no-excludes")}`, "ls-files", "--others", "--exclude-standard"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split("\n").filter(Boolean).sort();
};
const write = (file: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
};

beforeAll(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-ignored-installs-"));
});

afterAll(() => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

describe("the npm installs stay out of git (--- ai-guard ---)", () => {
  it("ignores each install as a folder, and nothing beside it", () => {
    const dir = scratch("folders");
    for (const install of INSTALLS) write(path.join(dir, install, "pkg", "index.js"));
    write(path.join(dir, "desktop", "node_modules_x"));
    write(path.join(dir, "billing", "node_modules_x"));
    expect(untracked(dir)).toEqual(["billing/node_modules_x", "desktop/node_modules_x"]);
  });

  it("ignores each install as a link, so a linked worktree lists no untracked file", () => {
    const dir = scratch("linked");
    for (const install of INSTALLS) {
      const target = path.join(temp, "main", install);
      write(path.join(target, "pkg", "index.js"));
      fs.mkdirSync(path.dirname(path.join(dir, install)), { recursive: true });
      fs.symlinkSync(target, path.join(dir, install));
    }
    expect(untracked(dir)).toEqual([]);
  });
});

/*
 * --- react-hydration-replay --- A plain `npm install` rewrites no lock file either. npm records `"hasInstallScript": true` in
 * a lock's root entry when its package.json has a preinstall, install or postinstall script (@npmcli/arborist, Node's
 * hasInstallScript), and leaves it out without one. A lock that disagrees is rewritten by the next plain `npm install` (the
 * README's "Getting started"), and the tree it leaves is no longer clean: `npm run guard -- --baseline` refuses it. `npm ci`
 * (CI, the VPS deployer) never writes the lock, so only a local install shows it. The site's postinstall
 * (scripts/patch-react-hydration-replay.mjs) brought the first such script.
 */
describe("a plain npm install leaves every lock file as it is (--- react-hydration-replay ---)", () => {
  it("records hasInstallScript in each lock's root entry exactly when its package.json has an install script", () => {
    for (const install of INSTALLS) {
      const dir = path.join(ROOT, path.dirname(install));
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      const lockFile = path.join(dir, "package-lock.json");
      const lock = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { packages: Record<string, { hasInstallScript?: boolean }> };
      const scripts = pkg.scripts ?? {};
      const hasInstallScript = Boolean(scripts.preinstall || scripts.install || scripts.postinstall);
      expect(lock.packages[""].hasInstallScript, path.relative(ROOT, lockFile)).toBe(hasInstallScript ? true : undefined);
    }
  });
});
