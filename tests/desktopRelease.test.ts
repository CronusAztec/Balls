import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { bumpFiles, checkConsistency, compareSemver, decideRelease, hasPrereleaseSuffix, isSemver, nextPatch, readVersion, VERSION_FILES } from "../scripts/release/desktop-version.mjs";
import { spawnSync } from "child_process"; // --- low-findings-2 ---

/*
 * --- desktop-autorelease --- the Windows app's release rules (scripts/release/desktop-version.mjs, the `decide` job of
 * .github/workflows/desktop.yml) and the one-command bump (npm run release:desktop -- <version>).
 */

const ROOT = path.join(__dirname, "..");

describe("decideRelease", () => {
  const base = { current: "1.0.4", previous: "1.0.3", tagExists: false, inputVersion: "", inputPublish: "" };

  it("releases a pushed desktop-v tag with the tag's version", () => {
    expect(decideRelease({ ...base, event: "push", ref: "refs/tags/desktop-v2.0.0", previous: "2.0.0", tagExists: true })).toEqual({ version: "2.0.0", build: true, release: true, reason: "tag", warning: null });
  });

  it("builds a manual run and releases it only with publish ticked", () => {
    expect(decideRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/claude/optimistic-johnson-46x3qg" })).toMatchObject({ version: "1.0.4", build: true, release: false, reason: "manual" });
    expect(decideRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/x", inputPublish: "true" })).toMatchObject({ version: "1.0.4", build: true, release: true });
    expect(decideRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/x", inputPublish: true, inputVersion: "1.2.0" })).toMatchObject({ version: "1.2.0", build: true, release: true });
    expect(decideRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/x", inputPublish: "false", inputVersion: "1.2.0-rc.1" })).toMatchObject({ version: "1.2.0-rc.1", release: false });
  });

  it("only builds a pull request", () => {
    expect(decideRelease({ ...base, event: "pull_request", ref: "refs/pull/7/merge" })).toEqual({ version: "1.0.4", build: true, release: false, reason: "pull request", warning: null });
  });

  it("does nothing for a branch push that leaves the version as it was", () => {
    expect(decideRelease({ ...base, event: "push", ref: "refs/heads/main", previous: "1.0.4" })).toEqual({ version: "1.0.4", build: false, release: false, reason: "version unchanged (1.0.4)", warning: null });
  });

  it("does not release a version whose tag exists already, and says what to do", () => {
    const d = decideRelease({ ...base, event: "push", ref: "refs/heads/main", tagExists: true });
    expect(d).toMatchObject({ version: "1.0.4", build: false, release: false, reason: "desktop-v1.0.4 exists already" });
    expect(d.warning).toContain("exists already");
    expect(d.warning).toContain("npm run release:desktop -- 1.0.5");
  });

  it("releases a changed version without a tag", () => {
    expect(decideRelease({ ...base, event: "push", ref: "refs/heads/claude/optimistic-johnson-46x3qg" })).toEqual({ version: "1.0.4", build: true, release: true, reason: "version 1.0.3 → 1.0.4", warning: null });
    // the file had no version before (or could not be read): released all the same
    expect(decideRelease({ ...base, event: "push", ref: "refs/heads/main", previous: null })).toMatchObject({ build: true, release: true, reason: "version none → 1.0.4", warning: null });
    // a lower version still releases (its tag does not exist), with a warning
    const lower = decideRelease({ ...base, event: "push", ref: "refs/heads/main", current: "1.0.2", previous: "1.0.3" });
    expect(lower).toMatchObject({ version: "1.0.2", build: true, release: true });
    expect(lower.warning).toBe("1.0.2 is not higher than 1.0.3");
  });

  it("builds other events without releasing", () => {
    expect(decideRelease({ ...base, event: "schedule", ref: "refs/heads/main" })).toMatchObject({ build: true, release: false, reason: "event schedule" });
  });

  it("refuses a version that is not semantic", () => {
    expect(() => decideRelease({ ...base, event: "push", ref: "refs/tags/desktop-v1.0" })).toThrow("'1.0' is not a semantic version (1.2.3)");
    expect(() => decideRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/x", inputVersion: "v1.2.3" })).toThrow("is not a semantic version");
    expect(() => decideRelease({ ...base, event: "push", ref: "refs/heads/main", current: "next", previous: "1.0.3" })).toThrow("'next' is not a semantic version");
  });
});

describe("semantic versions", () => {
  it("compares numerically, a pre-release below its release", () => {
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
    expect(compareSemver("1.1.0", "1.0.99")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    expect(compareSemver("0.9.9", "1.0.0")).toBe(-1);
  });
  it("knows what is one", () => {
    for (const v of ["1.0.3", "10.20.30", "1.0.0-rc.1", "1.0.0-beta-2"]) expect(isSemver(v), v).toBe(true);
    for (const v of ["1.0", "v1.0.3", "1.0.3 ", "", "1.0.x", null]) expect(isSemver(v), String(v)).toBe(false);
    expect(nextPatch("1.0.9")).toBe("1.0.10");
    expect(readVersion('{"name":"x","version":"1.2.3"}')).toBe("1.2.3");
    expect(() => readVersion('{"name":"x"}')).toThrow();
  });
});

describe("the version bump", () => {
  let tmp = "";
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("changes exactly the version lines of the three files", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-release-"));
    for (const rel of VERSION_FILES) {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
    }
    expect(bumpFiles(tmp, "9.9.9")).toEqual(["desktop/package.json", "desktop/package-lock.json", "src/lib/desktop/release.ts"]);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "desktop/package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(tmp, "desktop/package-lock.json"), "utf8"));
    expect(pkg.version).toBe("9.9.9");
    expect(lock.version).toBe("9.9.9");
    expect(lock.packages[""].version).toBe("9.9.9");
    expect(fs.readFileSync(path.join(tmp, "src/lib/desktop/release.ts"), "utf8")).toContain('export const DESKTOP_VERSION = "9.9.9";');
    expect(checkConsistency(tmp)).toEqual({ version: "9.9.9", problems: [] });
    // npm's own formatting is kept: the line-by-line diff is the version lines only
    const changed = (rel: string) => {
      const a = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
      const b = fs.readFileSync(path.join(tmp, rel), "utf8").split("\n");
      expect(b.length, rel).toBe(a.length);
      return a.filter((line, i) => line !== b[i]).length;
    };
    expect(changed("desktop/package.json")).toBe(1);
    expect(changed("desktop/package-lock.json")).toBe(2);
    expect(changed("src/lib/desktop/release.ts")).toBe(1);
    // a file without the field is refused before anything is written
    fs.writeFileSync(path.join(tmp, "src/lib/desktop/release.ts"), "export const OTHER = 1;\n");
    expect(() => bumpFiles(tmp, "9.9.10")).toThrow("DESKTOP_VERSION");
    expect(JSON.parse(fs.readFileSync(path.join(tmp, "desktop/package.json"), "utf8")).version).toBe("9.9.9");
    expect(() => bumpFiles(tmp, "9.9")).toThrow("not a semantic version");
    expect(checkConsistency(tmp).problems.length).toBeGreaterThan(0);
  });

  // --- low-findings-2 --- x.y.z only: a pre-release would pass the bump, then turn the site's build red and never show
  it("refuses a pre-release version: the bump writes nothing and a branch push releases none", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-release-"));
    for (const rel of VERSION_FILES) {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
    }
    const before = VERSION_FILES.map((rel) => fs.readFileSync(path.join(tmp, rel), "utf8"));
    const current = checkConsistency(tmp).version ?? "";
    expect(current).toMatch(/^\d+\.\d+\.\d+$/);
    const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/release/desktop-version.mjs"), "1.0.4-rc.1"], { cwd: tmp, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`1.0.4-rc.1 has a pre-release suffix: the website's checks and the download page only accept x.y.z (e.g. ${nextPatch(current)})`);
    expect(VERSION_FILES.map((rel) => fs.readFileSync(path.join(tmp, rel), "utf8"))).toEqual(before);
    expect([hasPrereleaseSuffix("1.0.4-rc.1"), hasPrereleaseSuffix("1.0.4"), isSemver("1.0.4-rc.1")]).toEqual([true, false, true]);
    expect(decideRelease({ event: "push", ref: "refs/heads/main", current: "1.0.4-rc.1", previous: "1.0.3", tagExists: false, inputVersion: "", inputPublish: "" })).toMatchObject({ build: false, release: false, reason: "pre-release 1.0.4-rc.1", warning: expect.stringContaining("only accept x.y.z") });
  });

  it("finds the repository's four version fields in agreement", () => {
    const { version, problems } = checkConsistency(ROOT);
    expect(problems).toEqual([]);
    expect(isSemver(version)).toBe(true);
  });
});
