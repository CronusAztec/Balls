import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * --- ai-guard --- The core guard end to end in a scratch clone of this repository (scripts/agent/guard.mjs, the build
 * job's "Core guard (static checks)" step of .github/workflows/deploy.yml): the clone's base commit is this working tree, and
 * each case commits on top of it what an agent might – a rewrite of the checks that judge it, a test renamed out of vitest's
 * include, a core test dropped from core.json, a baseline without the desktop and billing installs – and runs the guard on
 * it, as a person or CI would.
 */

const ROOT = path.resolve(__dirname, "..");
let dir = "";
let temp = "";
let base = "";

const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const edit = (file: string, from: string, to: string) => {
  const full = path.join(dir, file);
  const text = fs.readFileSync(full, "utf8");
  expect(text, `${file} holds ${from}`).toContain(from);
  fs.writeFileSync(full, text.replace(from, to));
};
const commit = (message: string) => {
  git("add", "-A");
  git("-c", "user.name=agent", "-c", "user.email=agent@example.com", "commit", "-q", "--no-verify", "-m", message);
};
/** A fresh branch from the base commit. */
const fromBase = (name: string) => {
  git("checkout", "-q", "-f", "-B", name, base);
  git("clean", "-q", "-fd", "--exclude=node_modules");
};
const plan = (env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, ["scripts/agent/guard.mjs", "--plan", "--json", "--base", base], { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env, GITHUB_ACTIONS: "", JBL_GUARD_CACHE: "", JBL_GUARD_REPORT: "", ...env } });
  return { status: r.status, stderr: r.stderr, report: r.stdout ? JSON.parse(r.stdout) : null };
};
/** The first digit of classic's first BASELINE sample, one up. */
const retuneClassic = () => {
  const file = path.join(dir, "tests/extras.test.ts");
  const src = fs.readFileSync(file, "utf8");
  const at = src.indexOf("classic: { samples: [[") + "classic: { samples: [[".length;
  fs.writeFileSync(file, `${src.slice(0, at)}${(Number(src[at]) + 1) % 10}${src.slice(at + 1)}`);
};

beforeAll(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-guard-e2e-"));
  dir = path.join(temp, "repo");
  const clone = spawnSync("git", ["clone", "-q", "--shared", "--no-checkout", ROOT, dir], { encoding: "utf8" });
  if (clone.status !== 0) throw new Error(clone.stderr);
  git("checkout", "-q", "-f", spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim());
  // the base commit is this working tree: committed or not, its guard is the one under test
  const tracked = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const f of [...tracked, ...untracked]) {
    if (fs.existsSync(path.join(ROOT, f))) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    } else fs.rmSync(path.join(dir, f), { force: true });
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  git("add", "-A");
  git("-c", "user.name=agent", "-c", "user.email=agent@example.com", "commit", "-q", "--allow-empty", "--no-verify", "-m", "base: the working tree under test");
  base = git("rev-parse", "HEAD");
}, 120_000);

afterAll(() => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

describe("the guard judged by the base commit's checks (--- ai-guard ---)", () => {
  it("still fails a fingerprint re-record after a commit that rewrote protectedDiff.ts to skip it", () => {
    fromBase("tamper-checks");
    // commit 1: the lock skips tests/extras.test.ts, the report skips the guard's own code
    edit("src/lib/agentKit/protectedDiff.ts", "  for (const locator of locators) {", '  for (const locator of locators.filter((l) => l.file !== "tests/extras.test.ts")) {');
    edit("src/lib/agentKit/protectedDiff.ts", "  for (const file of changed) {\n    for (const p of config.paths)", '  for (const file of changed.filter((f) => !f.startsWith("src/lib/agentKit/"))) {\n    for (const p of config.paths)');
    commit("Tidy the static checks");
    // commit 2: a BASELINE digit, no trailer
    retuneClassic();
    commit("Retune classic");
    const r = plan();
    expect(r.status, r.stderr).toBe(1);
    expect(r.report.fingerprints.changes).toEqual([expect.objectContaining({ file: "tests/extras.test.ts", mode: "classic", kind: "changed", acknowledged: false, by: "the base commit's checks" })]);
    expect(r.report.protected.findings.map((p: { path: string }) => p.path)).toContain("src/lib/agentKit/protectedDiff.ts");
    expect(r.report.notes.join(" ")).toMatch(/also ran with the base commit's version, and the stricter result counts/);
  }, 120_000);

  it("runs CI's step with the base commit's guard when a push rewrites guard.mjs too: error annotation, warning, summary", () => {
    fromBase("tamper-guard");
    edit("scripts/agent/guard.mjs", "else await print(summaryText(report) + annotations(report));", "else await print(summaryText(report));");
    edit("scripts/agent/guard.mjs", "    .then((code) => process.exit(code))", "    .then(() => process.exit(0))");
    edit("src/lib/agentKit/protectedDiff.ts", "  for (const locator of locators) {", "  for (const locator of locators.slice(1)) {");
    commit("Quieter guard");
    retuneClassic();
    commit("Retune classic");
    const deploy = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    const step = /- name: Core guard \(static checks\)\n[\s\S]*?\n {8}run: \|\n([\s\S]*?)\n\n/.exec(deploy);
    expect(step, "the step's script").not.toBeNull();
    const script = step![1].replace(/^ {10}/gm, "");
    const runnerTemp = path.join(temp, `runner-${Date.now()}`);
    fs.mkdirSync(runnerTemp);
    const summary = path.join(runnerTemp, "summary.md");
    const r = spawnSync("bash", ["-e", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, BEFORE: base, GITHUB_ACTIONS: "true", RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: dir, GITHUB_STEP_SUMMARY: summary, JBL_GUARD_CACHE: "", JBL_GUARD_REPORT: "" },
    });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toContain("::warning file=scripts/agent/guard.mjs,title=Owner review required (the guard's own code)::");
    expect(r.stdout).toContain("::warning file=src/lib/agentKit/protectedDiff.ts,title=Owner review required (the guard's own code)::");
    expect(r.stdout).toMatch(/::error file=tests\/extras\.test\.ts,title=Fingerprint changed without a trailer::/);
    expect(fs.readFileSync(summary, "utf8")).toMatch(/fingerprint changed \| tests\/extras\.test\.ts/);
  }, 120_000);
});

describe("the weakening detector and the baseline on real commits (--- ai-guard ---)", () => {
  it("fails a test renamed out of vitest's include, and a core test dropped from core.json", () => {
    fromBase("rename-out");
    git("mv", "tests/goLiveKit.test.ts", "tests/goLiveKit.ts");
    commit("Make the go-live kit a helper");
    const out = plan();
    expect(out.status, out.stderr).toBe(1);
    expect(out.report.weakening.findings.map((f: { kind: string; file: string }) => `${f.kind} ${f.file}`)).toEqual(expect.arrayContaining(["test-deleted tests/goLiveKit.test.ts", "expect-drop tests/goLiveKit.test.ts"]));

    fromBase("drop-core");
    git("mv", "tests/zip.test.ts", "tests/zipCrc.test.ts");
    const coreFile = path.join(dir, "scripts/agent/core.json");
    const core = JSON.parse(fs.readFileSync(coreFile, "utf8"));
    core.vitest.core = core.vitest.core.filter((t: { file: string }) => t.file !== "tests/zip.test.ts");
    for (const f of core.coreFunctions) f.tests = f.tests.filter((t: string) => t !== "tests/zip.test.ts");
    fs.writeFileSync(coreFile, `${JSON.stringify(core, null, 2)}\n`);
    commit("Rename the zip test");
    const dropped = plan();
    expect(dropped.status, dropped.stderr).toBe(1);
    const kinds = dropped.report.weakening.findings.map((f: { kind: string; file: string; acknowledged: boolean }) => `${f.kind} ${f.file} ${f.acknowledged}`);
    expect(kinds).toEqual(expect.arrayContaining(["test-moved tests/zip.test.ts true", "core-test-dropped tests/zip.test.ts false"]));
  }, 120_000);

  it("refuses a baseline while the desktop and billing installs are missing (it would excuse their checks for good)", () => {
    fromBase("baseline");
    expect(fs.existsSync(path.join(dir, "desktop", "node_modules"))).toBe(false);
    const r = spawnSync(process.execPath, ["scripts/agent/guard.mjs", "--baseline"], { cwd: dir, encoding: "utf8", timeout: 120_000, env: { ...process.env, GITHUB_ACTIONS: "", JBL_GUARD_CACHE: "", JBL_GUARD_REPORT: "" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--baseline needs every install the lanes use, and desktop\/node_modules and billing\/node_modules are missing – run npm ci --prefix desktop/);
    expect(fs.existsSync(path.join(dir, ".agent-out", "cache", "jbl-guard", "baseline.json"))).toBe(false);
  }, 120_000);
});
