import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ENGINE_TOOLS, GUARD_SCRIPT, guardCommand, guardFlags, guardReportFile, parseArgv, runCaptured, testSourceOf } from "../scripts/agent/cli.mjs";
import { parseArgs as parseGuardArgs } from "../scripts/agent/guard.mjs";
import { CACHE_DIR, PathError, cacheDirFor, defaultOutName, hasScheme, isInside, isMainModule, outputDir, resolveInputFile, untrustedCacheReason, userCacheBase, writeFileSafe } from "../scripts/agent/paths.mjs";
import { SETTLE_MS, STUDIOKIT_ENTRY, TOOLBOX_ENTRY, TOOLCORE_ENTRY, fresh, settled, toolboxListing } from "../scripts/agent/bundle.mjs";
import os from "os";
import { buildEnv, LOCAL_SITE_DOMAIN, lockPids, patchNextConfig, siteFile, TOOLBOX_SITE_DOMAIN } from "../scripts/agent/local-build.mjs";
import { siteStatsTool } from "../scripts/agent/site-stats.mjs";
import { postizProbeTool } from "../scripts/agent/postiz-probe.mjs";
import * as toolbox from "@/lib/agentKit/toolbox";
import { parseBaselineLiteral } from "@/lib/agentKit/fingerprint";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { simulateSeed } from "@/lib/simulation/finder";
import { defaultSettings } from "@/lib/settings";
import { roundNumber } from "@/lib/agentKit/jsonView";

// --- agent-cli --- `npm run agent -- <tool> --json '{…}'` (scripts/agent/cli.mjs) end to end: one JSON result per call,
// deterministic where it says so, read-only toward the source, confined paths, no licence, the owner-run commands quiet
// without keys. The browser tools (preview, render, site-shot) need a local export and Chromium; their pure parts are here.

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "agent", "cli.mjs");

function agent(args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  const lines = r.stdout.trim().split("\n");
  return { code: r.status, stdout: r.stdout, lines, json: JSON.parse(lines[lines.length - 1] || "null") };
}

const gitStatus = () => spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" }).stdout;

describe("the agent CLI (--- agent-cli ---)", () => {
  it("prints byte-identical JSON for the same simulate call, on one line, with the finder's finish time", () => {
    const call = ["simulate", "--json", JSON.stringify({ mode: "spiralGlass", seed: 12345, seconds: 10 })];
    const a = agent(call);
    const b = agent(call);
    expect(a.code).toBe(0);
    expect(a.lines).toHaveLength(1);
    expect(a.stdout).toBe(b.stdout);
    expect(a.json.result).toMatchObject({ mode: "spiralGlass", seed: 12345, link: "?mode=spiralGlass&seed=12345" });
    // not finished within 10 s – exactly when the finder's simulateSeed() runs out of time too
    const request = finderRequestOfSettings(defaultSettings("spiralGlass"), undefined, 10);
    expect(a.json.result.finished).toBe(simulateSeed(12345, request, 10_000) < 10_000);
    const classic = agent(["simulate", "--json", JSON.stringify({ link: "https://jumpingballslive.com/en/simulator/?mode=classic&seed=12345", seconds: 240 })]);
    const finderMs = simulateSeed(12345, finderRequestOfSettings(defaultSettings("classic"), undefined, 240), 240_000);
    expect(classic.json.result.finishSec).toBe(roundNumber(finderMs / 1000, 9));
  });

  it("gives classic's fingerprint equal to the BASELINE entry of tests/extras.test.ts", () => {
    const r = agent(["fingerprint", "--json", '{"mode":"classic"}']);
    expect(r.code).toBe(0);
    const baseline = parseBaselineLiteral(fs.readFileSync(path.join(ROOT, "tests", "extras.test.ts"), "utf8"));
    expect(r.json.result.equal).toBe(true);
    expect(r.json.result.fingerprint).toEqual(baseline.classic);
    expect(r.json.result.recipe).toEqual({ file: "tests/extras.test.ts", seed: 12345, frames: 600 });
  });

  it("answers usage errors with exit 2 and one JSON line, and lists its tools with --help", () => {
    for (const args of [["nope"], ["simulate", "--json", "{bad"], ["simulate", "--json", "[]"], ["simulate", "--json", '{"bogus":1}'], ["simulate", "--json"], ["simulate", "--frobnicate"], ["modes", "simulate"]]) {
      const r = agent(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.json.ok, args.join(" ")).toBe(false);
      expect(r.lines, args.join(" ")).toHaveLength(1);
    }
    const help = agent(["--help"]);
    expect(help.code).toBe(0);
    expect(help.json.result.tools.map((t: { name: string }) => t.name)).toEqual(toolbox.AGENT_TOOLS.map((t) => t.name));
    expect(agent(["modes", "--json", '{"mode":"nope"}']).code).toBe(1);
  });

  it("leaves the working tree as it was (it writes only to the self-ignoring .agent-out/)", () => {
    const before = gitStatus();
    agent(["modes"]);
    agent(["modes", "--json", '{"mode":"spiralGlass"}']);
    agent(["simulate", "--json", '{"mode":"mergeRing","seconds":5}']);
    agent(["fingerprint", "--json", '{"mode":"box"}']);
    agent(["explain", "--json", JSON.stringify({ failure: " FAIL  tests/freeWatermark.test.ts > x\nexpected 'a' to match /b/" })]);
    agent(["analyse", "--json", '{"path":"https://example.com/a.mp4"}']);
    agent(["site-stats", "--json", '{"days":7}']);
    expect(gitStatus()).toBe(before);
  });

  it("never installs a licence: no agent script touches the TEST key, the licence storage or an init script", () => {
    const dir = path.join(ROOT, "scripts", "agent");
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/test-license|signTestLicense|installLicenseScript|LICENSE_STORAGE_KEY|jbl\.license|addInitScript|license-test-key/);
    }
    // the browser tools refuse a picture or a clip the page reports as clean
    const browser = fs.readFileSync(path.join(dir, "browser.mjs"), "utf8");
    expect(browser).toMatch(/if \(!shot\.watermarked\) throw new Error/);
    expect(browser).toMatch(/if \(result\.watermarked !== true\) throw new Error/);
  });

  it("--- studio --- the studio kit installs no licence either: its sources name none, and its bundle carries no TEST key or init script", async () => {
    const LICENCE = /test-license|signTestLicense|installLicenseScript|LICENSE_STORAGE_KEY|jbl\.license|addInitScript|license-test-key/;
    for (const f of ["src/lib/agentKit/studioKit.ts", "scripts/agent/studio.mjs"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(LICENCE);
      expect(src, f).not.toMatch(/from "@\/lib\/(billing|bot\/node)|lib\/watermark\/seal/);
    }
    // the planner it bundles reads a free visitor's empty licence store, as the page does; nothing in it writes one or signs a TEST licence
    const esbuild = await import("esbuild");
    const built = await esbuild.build({ entryPoints: [STUDIOKIT_ENTRY], bundle: true, platform: "node", format: "esm", write: false, metafile: true, alias: { "@": path.join(ROOT, "src") }, logLevel: "silent", absWorkingDir: ROOT });
    const inputs = Object.keys(built.metafile.inputs);
    expect(inputs.filter((f) => /license-test-key|test-license|bot\/node\.ts|scripts\//.test(f))).toEqual([]);
    expect(built.outputFiles[0].text).not.toMatch(/signTestLicense|installLicenseScript|license-test-key|addInitScript/);
  }, 120_000);
});

describe("paths (--- agent-cli ---)", () => {
  it("reads only existing files inside the repository: a URL is no file, and its answer says where to download the video", () => {
    expect(resolveInputFile("package.json")).toBe(fs.realpathSync(path.join(ROOT, "package.json")));
    for (const bad of ["https://x.test/a.mp4", "data:video/mp4;base64,AA", "file:///etc/hosts", "blob:abc", "/etc/hosts", "../x.mp4", "src", "missing.mp4", "a\nb", ""]) {
      expect(() => resolveInputFile(bad), bad).toThrow(PathError);
    }
    expect(() => resolveInputFile("https://www.tiktok.com/@someone/video/1")).toThrow(/download the video into \.agent-out\/inbox\/ first/);
    expect(hasScheme("C:\\videos\\a.mp4")).toBe(false);
    expect(hasScheme("ftp://a")).toBe(true);
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
  });

  it("writes only to a bare-named folder under .agent-out/<tool>/", () => {
    for (const bad of ["../x", "a/b", ".hidden", "a..b", ""]) expect(() => outputDir("preview", bad), bad).toThrow(PathError);
    expect(() => outputDir("../x", "ok")).toThrow(PathError);
    const name = `test-out-${process.pid}`;
    const dir = outputDir("preview", name);
    expect(dir).toBe(path.join(ROOT, ".agent-out", "preview", name));
    expect(fs.readFileSync(path.join(ROOT, ".agent-out", ".gitignore"), "utf8")).toMatch(/^\*$/m); // the folder ignores itself
    fs.rmSync(dir, { recursive: true, force: true });
    expect(defaultOutName("classic-1", { a: 1 })).toMatch(/^classic-1-[0-9a-f]{8}$/);
    expect(defaultOutName("classic-1", { a: 1 })).toBe(defaultOutName("classic-1", { a: 1 }));
  });
});

describe("what the toolbox trusts and where it writes (--- agent-cli ---)", () => {
  const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "jbl-agent-test-"));
  const stat = (o: { link?: boolean; dir?: boolean; uid?: number; mode?: number }) => ({ isSymbolicLink: () => !!o.link, isDirectory: () => o.dir !== false, uid: o.uid ?? 1000, mode: o.mode ?? 0o40700 }) as unknown as fs.Stats;

  it("uses only a private cache: a real folder of this user that no one else may write to", () => {
    expect(untrustedCacheReason(stat({}), 1000)).toBeNull();
    expect(untrustedCacheReason(stat({ link: true }), 1000)).toMatch(/symbolic link/);
    expect(untrustedCacheReason(stat({ dir: false }), 1000)).toMatch(/not a folder/);
    expect(untrustedCacheReason(stat({ uid: 65534 }), 1000)).toMatch(/another user/);
    expect(untrustedCacheReason(stat({ mode: 0o40777 }), 1000)).toMatch(/others may write/);
    expect(untrustedCacheReason(stat({ mode: 0o40720 }), 1000)).toMatch(/others may write/);
    expect(untrustedCacheReason(stat({ uid: 65534 }), null)).toBeNull(); // Windows: the temp folder is the user's own
    // the CLI refuses an unsafe cache with its one JSON line, before it imports anything from it
    const dir = scratch();
    try {
      const shared = path.join(dir, "shared");
      fs.mkdirSync(shared);
      fs.chmodSync(shared, 0o777);
      const r = spawnSync(process.execPath, [CLI, "modes"], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env, JBL_AGENT_CACHE: shared } });
      expect(r.status).toBe(1);
      expect(r.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: expect.stringMatching(/not safe to use: others may write/) });
      expect(fs.readdirSync(shared)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--- agent-cli --- keeps its cache in this user's own cache folder, never the shared temp folder another user could squat", () => {
    expect(cacheDirFor("/repo", {}, "linux", "/home/u")).toMatch(/^\/home\/u\/\.cache\/jbl-agent\/[0-9a-f]{10}$/);
    expect(cacheDirFor("/repo", { XDG_CACHE_HOME: "/xdg" }, "linux", "/home/u")).toMatch(/^\/xdg\/jbl-agent\//);
    expect(cacheDirFor("/repo", { XDG_CACHE_HOME: "relative" }, "linux", "/home/u")).toMatch(/^\/home\/u\/\.cache\//);
    expect(userCacheBase({}, "darwin", "/Users/u")).toBe("/Users/u/Library/Caches");
    expect(userCacheBase({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u")).toBe("C:\\Users\\u\\AppData\\Local");
    expect(userCacheBase({}, "win32", "C:\\Users\\u")).toBe("C:\\Users\\u\\AppData\\Local");
    expect(cacheDirFor("/repo", { JBL_AGENT_CACHE: "/private/x" }, "linux", "/home/u")).toBe(path.resolve("/private/x"));
    expect(cacheDirFor("/repo", {}, "linux", "/h")).not.toBe(cacheDirFor("/other", {}, "linux", "/h"));
    // the real one: not in the temp folder (unless JBL_AGENT_CACHE says so)
    if (!process.env.JBL_AGENT_CACHE) expect(isInside(os.tmpdir(), CACHE_DIR)).toBe(false);
    // the finding's case: another user's folder at the old predictable temp name (uid and hash of the checkout) no longer
    // stops a tool (as root, the folder really is another user's)
    const squatted = path.join(os.tmpdir(), `jbl-agent-${process.getuid?.() ?? 0}-${crypto.createHash("sha1").update(ROOT).digest("hex").slice(0, 10)}`);
    const made = !fs.existsSync(squatted);
    if (made) fs.mkdirSync(squatted);
    if (made && process.getuid?.() === 0) fs.chownSync(squatted, 1234, 1234);
    try {
      const r = spawnSync(process.execPath, [CLI, "explain", "--json", JSON.stringify({ failure: " FAIL  tests/a.test.ts > x\nError: Test timed out in 5000ms." })], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
      expect(r.status, r.stdout).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, result: { kind: "timeout" } });
    } finally {
      if (made) fs.rmSync(squatted, { recursive: true, force: true });
    }
  });

  it("--- agent-cli --- keeps a bundle's list of inputs only when every input was saved before the build began", () => {
    const now = 1_000_000;
    const at = (t: number | null) => () => t;
    expect(settled(["a"], now, at(now - SETTLE_MS - 1))).toBe(true);
    expect(settled(["a"], now, at(now - 10))).toBe(false); // saved while esbuild read it (or within the file system's clock)
    expect(settled(["a"], now, at(now + 50))).toBe(false);
    expect(settled(["a"], now, at(null))).toBe(false);
    expect(settled([], now, at(null))).toBe(true);
    const bundle = fs.readFileSync(path.join(ROOT, "scripts/agent/bundle.mjs"), "utf8");
    expect(bundle).toMatch(/const started = Date\.now\(\);[\s\S]*?esbuild\.build\(/);
    expect(bundle).toMatch(/if \(settled\(files, started\)\) fs\.writeFileSync\(metaFile[\s\S]*?else fs\.rmSync\(metaFile/);
  });

  it("--- agent-cli --- runs when started through a symbolic link to the repository", () => {
    const dir = scratch();
    try {
      const link = path.join(dir, "balls-link");
      fs.symlinkSync(ROOT, link);
      expect(isMainModule(`file://${CLI}`, path.join(link, "scripts", "agent", "cli.mjs"))).toBe(true);
      expect(isMainModule(`file://${CLI}`, path.join(link, "scripts", "agent", "mcp.mjs"))).toBe(false);
      const r = spawnSync(process.execPath, [path.join(link, "scripts", "agent", "cli.mjs"), "explain", "--json", JSON.stringify({ failure: "error TS2322: Type 'string' is not assignable" })], { cwd: dir, encoding: "utf8", timeout: 60_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, tool: "explain", result: { kind: "typecheck" } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--- agent-cli --- gives every site-shot its own file, even for pages whose names agree", async () => {
    const { shotFileName } = await import("../scripts/agent/browser.mjs");
    const pages = ["/en/", "/en", "/en/a_b/", "/en/a/b/", "/"];
    const names = pages.map((p, i) => shotFileName(i, p, 390));
    expect(names).toEqual(["01-en-390.png", "02-en-390.png", "03-en_a_b-390.png", "04-en_a_b-390.png", "05-root-390.png"]);
    expect(new Set(names).size).toBe(pages.length);
  });

  it("never takes a bundle whose list of inputs is empty or lacks the entry for a fresh one", () => {
    const version = "0.0.0-test";
    const listing = toolboxListing();
    const entryStamp = (() => {
      const s = fs.statSync(TOOLBOX_ENTRY);
      return `${s.size}:${Math.floor(s.mtimeMs)}`;
    })();
    const good = { esbuild: version, entry: TOOLBOX_ENTRY, listing, inputs: { [TOOLBOX_ENTRY]: entryStamp } };
    expect(fresh(good, version, listing)).toBe(true);
    expect(fresh({ ...good, inputs: {} }, version, listing)).toBe(false);
    expect(fresh({ ...good, inputs: { [path.join(ROOT, "package.json")]: "1:1" } }, version, listing)).toBe(false);
    expect(fresh({ ...good, inputs: undefined }, version, listing)).toBe(false);
    expect(fresh({ ...good, inputs: { [TOOLBOX_ENTRY]: "0:0" } }, version, listing)).toBe(false);
  });

  it("replaces a symbolic link at an output file instead of writing through it, and never makes a folder through one", () => {
    const outside = scratch();
    const name = `test-link-${process.pid}`;
    const dir = outputDir("preview", name);
    try {
      const victim = path.join(outside, "victim.txt");
      fs.writeFileSync(victim, "victim\n");
      const target = path.join(dir, "sheet.png");
      fs.symlinkSync(victim, target);
      writeFileSafe(target, Buffer.from("png"));
      expect(fs.readFileSync(victim, "utf8")).toBe("victim\n");
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(target, "utf8")).toBe("png");
      expect(fs.readdirSync(dir)).toEqual(["sheet.png"]); // (no temporary file left)
      expect(() => writeFileSafe(path.join(outside, "x.png"), "x")).toThrow(PathError);
      // a linked .agent-out/<tool> folder: refused before anything is created on the other side
      const linkedTool = path.join(ROOT, ".agent-out", "linkprobe");
      fs.rmSync(linkedTool, { force: true });
      fs.symlinkSync(outside, linkedTool);
      try {
        expect(() => outputDir("linkprobe", "x")).toThrow(PathError);
        expect(fs.existsSync(path.join(outside, "x"))).toBe(false);
      } finally {
        fs.rmSync(linkedTool, { force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reads a failing test's source only inside tests/: no `..`, no link that leads out", () => {
    expect(toolbox.testFilesIn("FAIL tests/../../../../tmp/x/outside/tests/x.test.ts > something")).toEqual([]);
    expect(toolbox.testFilesIn("FAIL tests/freeWatermark.test.ts > x")).toEqual(["tests/freeWatermark.test.ts"]);
    const root = scratch();
    try {
      fs.mkdirSync(path.join(root, "tests"));
      fs.mkdirSync(path.join(root, "elsewhere"));
      fs.writeFileSync(path.join(root, "elsewhere", "secret.test.ts"), 'readFileSync("src/SECRET_leaked.ts")');
      fs.writeFileSync(path.join(root, "tests", "own.test.ts"), 'readFileSync("src/components/simulator/Canvas.tsx")');
      fs.symlinkSync(path.join(root, "elsewhere", "secret.test.ts"), path.join(root, "tests", "linked.test.ts"));
      expect(testSourceOf("tests/own.test.ts", root)).toContain("Canvas.tsx");
      expect(testSourceOf("tests/linked.test.ts", root)).toBe("");
      expect(testSourceOf("tests/../elsewhere/secret.test.ts", root)).toBe("");
      expect(testSourceOf("tests/missing.test.ts", root)).toBe("");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    // end to end: the leak the CLI had
    const r = agent(["explain", "--json", JSON.stringify({ failure: "FAIL tests/../package.json.test.ts > x\nexpected 'a' to match /b/" })]);
    expect(r.json.result.files).toEqual([]);
  });

  it("names every place a tool writes besides .agent-out/: the local export's cache, the guard's state and build output", () => {
    const also = (name: string) => toolbox.AGENT_TOOLS.find((t) => t.name === name)?.alsoWrites ?? [];
    // (--- agent-cli --- this user's own cache folder, never the shared temp folder another user could take the name in)
    for (const name of ["preview", "render", "site-shot"]) expect(also(name).join(" "), name).toMatch(/agent cache in this user's cache folder/);
    expect(also("guard").join(" ")).toMatch(/node_modules\/\.cache\/jbl-guard/);
    expect(also("guard").join(" ")).toMatch(/\.next\/ and out\//);
    for (const t of toolbox.AGENT_TOOLS.filter((x) => x.writes === "none")) expect(t.alsoWrites, t.name).toBeUndefined();
  });

  it("refuses arguments named after Object.prototype's members like any unknown one", () => {
    for (const args of ['{"constructor":1}', '{"toString":"x"}', '{"__proto__":{"mode":"classic"}}', '{"hasOwnProperty":[1,2]}']) {
      const r = agent(["modes", "--json", args]);
      expect(r.code, args).toBe(2);
      expect(r.json.error, args).toMatch(/unknown field/);
    }
    expect(agent(["simulate", "--json", JSON.stringify({ mode: "classic", seconds: 1, world: { width: 800, height: 600, valueOf: "zz" } })]).code).toBe(2);
  });
});

describe("the local export (--- agent-cli ---)", () => {
  it("keeps its build lock while the CLI or any build step it started lives (a killed call's next build still holds it)", () => {
    // the lock names the CLI's pid, then each build step's: it is taken over only when none of them is alive
    expect(lockPids("4100\n4123\n4188\n")).toEqual([4100, 4123, 4188]);
    expect(lockPids("4100\n")).toEqual([4100]);
    expect(lockPids("")).toEqual([]);
    expect(lockPids("x\n-3\n0\n12.5\n77")).toEqual([77]);
    const src = fs.readFileSync(path.join(ROOT, "scripts", "agent", "local-build.mjs"), "utf8");
    expect(src).toMatch(/if \(pids\.length && !pids\.some\(pidAlive\)\)/);
    expect(src).toMatch(/hold\?\.\(child\.pid\)/);
  });

  it("copies only what the site builds from, builds at the root path without the shell's public or statistics settings", () => {
    expect(siteFile("src/app/page.tsx")).toBe(true);
    expect(siteFile("scripts/postexport.mjs")).toBe(true);
    expect(siteFile("desktop/package.json")).toBe(true);
    for (const f of ["desktop/src/main.ts", "tests/x.test.ts", "scripts/agent/cli.mjs", "docs/a.md", "README.md", "billing/src/app.ts"]) expect(siteFile(f), f).toBe(false);
    const env = buildEnv({ PATH: "/bin", NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: "https://stats.example/s.js", NEXT_PUBLIC_LICENSE_PUBLIC_KEY: "k", JBL_ANALYTICS_SITE_ID: "x", NEXT_PUBLIC_BASE_PATH: "/Balls" }, "abc");
    expect(env).toEqual({ PATH: "/bin", NEXT_PUBLIC_BASE_PATH: "", NEXT_PUBLIC_SITE_DOMAIN: TOOLBOX_SITE_DOMAIN, NEXT_TELEMETRY_DISABLED: "1", OBFUSCATE: "0", JBL_BUILD_SKIP_TYPECHECK: "1", JBL_BUILD_SHA: "abc", NODE_ENV: "production" });
  });

  it("draws the live site's domain in its watermark, never the localhost fallback: the shell's domain or address changes nothing (--- studio ---)", () => {
    // the action that names the address every deploy builds for: its default domain is the toolbox's
    const action = fs.readFileSync(path.join(ROOT, ".github", "actions", "site-url", "action.yml"), "utf8");
    expect(action).toContain(`domain="${TOOLBOX_SITE_DOMAIN}"`);
    expect(TOOLBOX_SITE_DOMAIN).not.toBe(LOCAL_SITE_DOMAIN);
    // only the domain text: the site's address (canonical links, the share links the page builds) stays the build's own
    const env = buildEnv({ PATH: "/bin", NEXT_PUBLIC_SITE_DOMAIN: "elsewhere.example", NEXT_PUBLIC_SITE_URL: "https://elsewhere.example" }, "abc");
    expect([env.NEXT_PUBLIC_SITE_DOMAIN, "NEXT_PUBLIC_SITE_URL" in env]).toEqual([TOOLBOX_SITE_DOMAIN, false]);
    // the build's key names the domain (a change rebuilds), and the stamp records what the export draws
    const src = fs.readFileSync(path.join(ROOT, "scripts", "agent", "local-build.mjs"), "utf8");
    expect(src).toContain(".update(`domain ${TOOLBOX_SITE_DOMAIN}\\n`)");
    expect(src).toContain("siteDomain: env.NEXT_PUBLIC_SITE_DOMAIN");
  });

  it("skips Next's own type check in its own build only (the guard's knob in its environment; the repository's file is the real one)", () => {
    const real = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    // the repository's config skips it only under JBL_BUILD_SKIP_TYPECHECK=1 (set by buildEnv above), never unconditionally
    expect(real).toContain('ignoreBuildErrors: process.env.JBL_BUILD_SKIP_TYPECHECK === "1"');
    expect(real).not.toContain("ignoreBuildErrors: true");
    expect(patchNextConfig(real)).toBe(real); // (the knob is there: no patch)
    // a config without the knob gets the copy-only patch
    const older = real.replace(/\n {2}\/\/ --- ai-guard --- JBL_BUILD_SKIP_TYPECHECK[\s\S]*?ignoreBuildErrors:[^\n]*\n/, "\n");
    expect(older).not.toContain("ignoreBuildErrors");
    const patched = patchNextConfig(older);
    expect(patched).toContain("typescript: { ignoreBuildErrors: true },");
    expect(patchNextConfig("export default {}")).toBeNull();
  });
});

describe("guard (--- agent-cli ---)", () => {
  it("runs package.json's guard script directly when it is a plain node command, else the guard script once it exists", () => {
    const node = process.execPath;
    expect(guardCommand({ scripts: { guard: "node scripts/agent/guard.mjs" } }, ["--browser"])).toEqual({ file: node, args: ["scripts/agent/guard.mjs", "--browser"], shown: "npm run guard -- --browser" });
    expect(guardCommand({ scripts: { guard: "node scripts/agent/guard.mjs --tier 0" } }, [])).toMatchObject({ args: ["scripts/agent/guard.mjs", "--tier", "0"] });
    expect(guardCommand({ scripts: { guard: "x && y" } }, [], { npmExecPath: "/npm-cli.js" })).toMatchObject({ args: ["/npm-cli.js", "run", "guard"] });
    expect(guardCommand({ scripts: { guard: "x && y" } }, [], { npmExecPath: null })).toBeNull();
    expect(guardCommand({ scripts: {} }, ["--baseline"], { exists: (f) => f === GUARD_SCRIPT })).toMatchObject({ args: [GUARD_SCRIPT, "--baseline"] });
    expect(guardCommand({ scripts: {} }, [], { exists: () => false })).toBeNull();
  });

  it("runs the merged guard: package.json's guard script is scripts/agent/guard.mjs, and it accepts every flag the tool passes", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const all = guardFlags({ browser: true, baseline: true, plan: true, withSlow: true, base: "origin/main" });
    expect(all).toEqual(["--browser", "--baseline", "--plan", "--with-slow", "--base", "origin/main"]);
    expect(guardCommand(pkg, all)).toEqual({ file: process.execPath, args: [GUARD_SCRIPT, ...all], shown: `npm run guard -- ${all.join(" ")}` });
    expect(parseGuardArgs(all)).toMatchObject({ browser: true, baseline: true, plan: true, withSlow: true, base: "origin/main" });
    expect(guardFlags({})).toEqual([]);
    expect(toolbox.checkToolArgs("guard", { base: "--upload-pack=x" })).toMatchObject({ ok: false });
  });

  it("returns the guard's own report for a plan call (guard --plan: nothing runs), never an older one", () => {
    const cache = path.join(ROOT, ".agent-out", "cache", "test-cli-plan");
    const own = path.join(ROOT, ".agent-out", "guard-report.json");
    const before = fs.existsSync(own) ? fs.readFileSync(own, "utf8") : null;
    // (never the cache or the report of a guard run this test may be inside, nor the Actions job summary of a CI run)
    const env = { ...process.env, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "", JBL_GUARD_CACHE: cache, JBL_GUARD_REPORT: path.join(cache, "guard-report.json") };
    const r = spawnSync(process.execPath, [CLI, "guard", "--json", JSON.stringify({ plan: true, base: "HEAD" })], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env });
    const out = JSON.parse(r.stdout.trim().split("\n").pop() || "null");
    expect(out).toMatchObject({ ok: true, tool: "guard", result: { available: true, command: "npm run guard -- --plan --base HEAD", reportFile: ".agent-out/cache/test-cli-plan/guard-report.json" } });
    // (exit 1 when the working tree itself holds an unacknowledged fingerprint change or a weakened test: the plan still reports)
    expect([0, 1]).toContain(out.result.exitCode);
    expect(out.result.report).toMatchObject({ tool: "jbl-guard", mode: "plan", verdict: "planned (nothing ran)", base: { ref: "HEAD" }, runId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(out.result.verdict).toBe("planned (nothing ran)");
    expect(fs.existsSync(own) ? fs.readFileSync(own, "utf8") : null).toBe(before);
    expect(guardReportFile({})).toBe(own);
    // a guard that dies before it writes a report: the last one on disk is another run's, and is not returned as this one's
    const stale = path.join(cache, "stale-report.json");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(stale, JSON.stringify({ tool: "jbl-guard", mode: "plan", verdict: "green", runId: "an-older-run" }));
    const died = spawnSync(process.execPath, [CLI, "guard", "--json", JSON.stringify({ plan: true, base: "no-such-ref-at-all" })], { cwd: ROOT, encoding: "utf8", timeout: 120_000, env: { ...env, JBL_GUARD_REPORT: stale } });
    const dead = JSON.parse(died.stdout.trim().split("\n").pop() || "null");
    expect(dead.result).toMatchObject({ exitCode: 1, verdict: "failed", report: null, reportFile: null });
  });

  it("keeps a multi-byte character whole when the guard's output crosses a pipe read", async () => {
    const stub = "process.stdout.write('x'.repeat(65535) + '–'.repeat(30000) + '❯');";
    const { code, output } = await runCaptured(process.execPath, ["-e", stub], { keepChars: 200_000 });
    expect(code).toBe(0);
    expect(output).not.toContain("\uFFFD");
    expect(output.endsWith(`${"–".repeat(30000)}❯`)).toBe(true);
  });

  it("loads the engine only for the engine's tools: the tool core bundle holds no physics, settings or modes", async () => {
    expect([...ENGINE_TOOLS].sort()).toEqual(["fingerprint", "modes", "preview", "render", "simulate"]);
    const esbuild = await import("esbuild");
    const built = await esbuild.build({ entryPoints: [TOOLCORE_ENTRY], bundle: true, platform: "node", format: "esm", write: false, metafile: true, alias: { "@": path.join(ROOT, "src") }, logLevel: "silent", absWorkingDir: ROOT });
    const inputs = Object.keys(built.metafile.inputs);
    expect(inputs.filter((f) => /physics|settings|simulation|modes/.test(f))).toEqual([]);
    expect(inputs.length).toBeLessThan(12);
    // every name the CLI's non-engine tools and the MCP server take from it is there
    for (const name of ["AGENT_TOOLS", "checkToolArgs", "toolSpec", "explainFailure", "testFilesIn", "textReadsOf", "buildVideoFeatures", "parseMediaInfo", "infoArgs"]) expect(toolbox, name).toHaveProperty(name);
    const specifiers = [...fs.readFileSync(TOOLCORE_ENTRY, "utf8").matchAll(/\bfrom "([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.filter((x) => /physics|settings|runRequest|simulate|fingerprint/.test(x))).toEqual([]);
  });

  it("parses its command line", () => {
    expect(parseArgv(["simulate", "--json", '{"mode":"box"}', "--pretty"])).toEqual({ tool: "simulate", args: { mode: "box" }, pretty: true, help: false });
    expect(parseArgv(['--json={"a":1}', "modes"])).toMatchObject({ tool: "modes", args: { a: 1 } });
  });
});

describe("owner-run commands (--- agent-cli ---)", () => {
  it("say 'not configured' without keys and touch no network", async () => {
    const noFetch = () => {
      throw new Error("no network without a key");
    };
    expect(await siteStatsTool(toolbox, {}, { env: {}, fetchImpl: noFetch })).toEqual({ configured: false, message: expect.stringMatching(/^not configured: set PLAUSIBLE_API_KEY or UMAMI_API_KEY/) });
    expect(await postizProbeTool(toolbox, {}, { env: {}, fetchImpl: noFetch })).toEqual({ configured: false, message: expect.stringMatching(/^not configured: set POSTIZ_URL and POSTIZ_API_KEY/) });
  });

  it("site-stats asks only the owner's host and prints totals, never the key", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
      calls.push(url);
      const goals = JSON.parse(init.body ?? "{}").dimensions;
      return new Response(JSON.stringify(goals ? { results: [{ metrics: [3, 4], dimensions: ["sim_start"] }] } : { results: [{ metrics: [10, 12, 30, 50, 61] }] }), { status: 200 });
    };
    const out = await siteStatsTool(toolbox, { days: 7 }, { env: { PLAUSIBLE_API_KEY: "SECRET-KEY", PLAUSIBLE_SITE_ID: "example.com", PLAUSIBLE_HOST: "https://stats.example.com" }, fetchImpl, now: Date.parse("2026-10-22T00:00:00Z") });
    expect(calls).toEqual(["https://stats.example.com/api/v2/query", "https://stats.example.com/api/v2/query"]);
    expect(out).toEqual({ configured: true, provider: "plausible", host: "stats.example.com", days: 7, summary: { visitors: 10, visits: 12, pageviews: 30, bounceRate: 50, visitDurationSec: 61, events: { sim_start: 4 } } });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    await expect(siteStatsTool(toolbox, {}, { env: { PLAUSIBLE_API_KEY: "SECRET-KEY", PLAUSIBLE_SITE_ID: "s" }, fetchImpl: async () => new Response("no", { status: 401 }) })).rejects.toThrow(/401.*check the API key/);
  });

  it("postiz-probe prints series labels and point counts only, never values, names or the key", async () => {
    const client = {
      baseUrl: "https://postiz.example.com/public/v1",
      integrations: async () => [{ id: "c1", name: "My Channel", platform: "tiktok", picture: null, disabled: false, customer: null }],
      analytics: async () => [{ label: "Views", total: 999, data: [{ date: "2026-10-01", total: 500 }, { date: "2026-10-02", total: 499 }] }],
      posts: async () => [
        { id: "p2", publishDate: "2026-10-02T10:00:00Z", state: "PUBLISHED", integration: { id: "c1", name: "My Channel", platform: "tiktok", picture: null } },
        { id: "p1", publishDate: "2026-10-01T10:00:00Z", state: "ERROR", integration: null },
      ],
      postAnalytics: async () => {
        throw new Error("rate limited for SECRET-KEY");
      },
    };
    const out = await postizProbeTool(toolbox, { posts: 5 }, { env: { POSTIZ_URL: "https://postiz.example.com", POSTIZ_API_KEY: "SECRET-KEY" }, client });
    expect(out).toEqual({
      configured: true,
      host: "postiz.example.com",
      days: 30,
      channels: [{ index: 0, platform: "tiktok", disabled: false, series: [{ label: "Views", points: 2 }] }],
      posts: [{ index: 0, platform: "tiktok", error: "rate limited for [key]" }],
    });
    expect(JSON.stringify(out)).not.toMatch(/999|500|My Channel|SECRET/);
  });
});
