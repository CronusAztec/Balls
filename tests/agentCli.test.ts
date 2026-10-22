import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { GUARD_SCRIPT, guardCommand, parseArgv } from "../scripts/agent/cli.mjs";
import { PathError, defaultOutName, hasScheme, isInside, outputDir, resolveInputFile } from "../scripts/agent/paths.mjs";
import { buildEnv, patchNextConfig, siteFile } from "../scripts/agent/local-build.mjs";
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
});

describe("paths (--- agent-cli ---)", () => {
  it("reads only existing files inside the repository and refuses every URL", () => {
    expect(resolveInputFile("package.json")).toBe(fs.realpathSync(path.join(ROOT, "package.json")));
    for (const bad of ["https://x.test/a.mp4", "data:video/mp4;base64,AA", "file:///etc/hosts", "blob:abc", "/etc/hosts", "../x.mp4", "src", "missing.mp4", "a\nb", ""]) {
      expect(() => resolveInputFile(bad), bad).toThrow(PathError);
    }
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

describe("the local export (--- agent-cli ---)", () => {
  it("copies only what the site builds from, builds at the root path without the shell's public or statistics settings", () => {
    expect(siteFile("src/app/page.tsx")).toBe(true);
    expect(siteFile("scripts/postexport.mjs")).toBe(true);
    expect(siteFile("desktop/package.json")).toBe(true);
    for (const f of ["desktop/src/main.ts", "tests/x.test.ts", "scripts/agent/cli.mjs", "docs/a.md", "README.md", "billing/src/app.ts"]) expect(siteFile(f), f).toBe(false);
    const env = buildEnv({ PATH: "/bin", NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: "https://stats.example/s.js", NEXT_PUBLIC_LICENSE_PUBLIC_KEY: "k", JBL_ANALYTICS_SITE_ID: "x", NEXT_PUBLIC_BASE_PATH: "/Balls" }, "abc");
    expect(env).toEqual({ PATH: "/bin", NEXT_PUBLIC_BASE_PATH: "", NEXT_TELEMETRY_DISABLED: "1", OBFUSCATE: "0", JBL_BUILD_SHA: "abc", NODE_ENV: "production" });
  });

  it("skips Next's own type check in the copy's next.config.ts only (the repository's file is the real one)", () => {
    const real = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    const patched = patchNextConfig(real);
    expect(patched).toContain("typescript: { ignoreBuildErrors: true },");
    expect(real).not.toContain("ignoreBuildErrors");
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
