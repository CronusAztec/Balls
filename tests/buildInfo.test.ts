import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  HEADERS_MARKER,
  VERSION_JSON_KEYS,
  buildId,
  buildLabel,
  clearBuildFiles,
  formatBuildId,
  formatBuildLabel,
  headersWith,
  nextEnv,
  resolveBuildInfo,
  toUtcIso,
  versionJson,
  writeBuildFiles,
} from "../scripts/lib/build-info.cjs";
import { buildPwa, selectPrecache } from "../scripts/pwa/build.mjs";
import { buildWebAppManifest } from "@/lib/pwa";
import * as client from "@/lib/buildInfo";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- build-identity --- Which build is this? The collector (scripts/lib/build-info.cjs: where the commit, its date and the release
 * version come from, in which order, and what happens when git is missing), its client twin (src/lib/buildInfo.ts formats the
 * same strings), the files postexport writes (version.json, the X-Build rule) and why they cannot hurt the service worker, the
 * footer's stamp, and next.config.ts wiring it all in.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const SHA = "8fa8dbb" + "0123456789abcdef0123456789abcdef0";
const HEAD = "a".repeat(7) + "b".repeat(33);
const tmpDirs: string[] = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buildinfo-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A repository root with a package.json (and desktop/package.json when asked). */
function fakeRoot(version = "1.10.0", desktop: string | null = "1.3.0") {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x", version }));
  if (desktop) {
    fs.mkdirSync(path.join(root, "desktop"));
    fs.writeFileSync(path.join(root, "desktop", "package.json"), JSON.stringify({ version: desktop }));
  }
  return root;
}

/** A git that answers `rev-parse HEAD` and `log -1 --format=%cI <sha>` (or fails like a missing binary: ""). */
const fakeGit = (head: string, date: string) => (args: string[]) => (args[0] === "rev-parse" ? head : args[0] === "log" ? date : "");

describe("the collector: where the commit, its date and the version come from", () => {
  it("takes the commit from JBL_BUILD_SHA first, then git, then GITHUB_SHA, then nothing", () => {
    const root = fakeRoot();
    const run = fakeGit(HEAD, "2026-10-14T01:57:35+00:00");
    expect(resolveBuildInfo({ root, run, env: { JBL_BUILD_SHA: SHA, GITHUB_SHA: "c".repeat(40) } }).commit).toBe(SHA);
    expect(resolveBuildInfo({ root, run, env: { GITHUB_SHA: "c".repeat(40) } }).commit).toBe(HEAD);
    expect(resolveBuildInfo({ root, run: () => "", env: { GITHUB_SHA: "c".repeat(40) } }).commit).toBe("c".repeat(40));
    const none = resolveBuildInfo({ root, run: () => "", env: {} });
    expect(none.commit).toBeNull();
    expect(none.commitShort).toBeNull();
    expect(resolveBuildInfo({ root, run, env: { JBL_BUILD_SHA: SHA } }).source.commit).toBe("JBL_BUILD_SHA");
    expect(resolveBuildInfo({ root, run, env: {} }).source.commit).toBe("git");
    expect(resolveBuildInfo({ root, run: () => "", env: { GITHUB_SHA: "c".repeat(40) } }).source.commit).toBe("GITHUB_SHA");
  });

  it("ignores a commit that is not 40 lowercase hex digits", () => {
    const root = fakeRoot();
    for (const bad of ["8fa8dbb", "A".repeat(40), "a".repeat(41), "g".repeat(40), " ", "HEAD"]) {
      expect(resolveBuildInfo({ root, run: () => "", env: { JBL_BUILD_SHA: bad, GITHUB_SHA: bad } }).commit, bad).toBeNull();
      expect(resolveBuildInfo({ root, run: fakeGit(bad, ""), env: {} }).commit, bad).toBeNull();
    }
    // a bad override falls through to git, a trailing newline from git is trimmed
    expect(resolveBuildInfo({ root, run: fakeGit(`${HEAD}\n`, ""), env: { JBL_BUILD_SHA: "nope" } }).commit).toBe(HEAD);
  });

  it("survives a git that throws or is missing", () => {
    const root = fakeRoot();
    const run = () => {
      throw new Error("spawn git ENOENT");
    };
    expect(resolveBuildInfo({ root, run, env: {} })).toMatchObject({ commit: null, commitDate: null, siteVersion: "1.10.0" });
    expect(resolveBuildInfo({ root, run, env: { GITHUB_SHA: "c".repeat(40), SITEMAP_LASTMOD: "2026-10-12" } })).toMatchObject({ commit: "c".repeat(40), commitDate: "2026-10-12T00:00:00Z" });
  });

  it("defaultGit gives '' for a missing repository instead of throwing", async () => {
    const { defaultGit } = await import("../scripts/lib/build-info.cjs");
    const empty = tmpDir();
    expect(defaultGit(["rev-parse", "HEAD"], empty)).toBe("");
    expect(defaultGit(["no-such-subcommand"], empty)).toBe("");
    expect(defaultGit(["rev-parse", "HEAD"], path.join(empty, "does-not-exist"))).toBe("");
  });

  it("normalises the commit date to UTC, falls back to SITEMAP_LASTMOD and lets JBL_BUILD_DATE win", () => {
    const root = fakeRoot();
    const date = (env: Record<string, string>, git = "2026-10-13T18:28:27-07:00") => resolveBuildInfo({ root, run: fakeGit(HEAD, git), env }).commitDate;
    expect(date({})).toBe("2026-10-14T01:28:27Z");
    expect(date({}, "2026-10-14T03:26:25+02:00")).toBe("2026-10-14T01:26:25Z");
    expect(date({}, "2026-10-14T01:57:35Z")).toBe("2026-10-14T01:57:35Z");
    // git fails: SITEMAP_LASTMOD, when it is an ISO date
    expect(date({ SITEMAP_LASTMOD: "2026-10-12T10:00:00.000Z" }, "")).toBe("2026-10-12T10:00:00Z");
    expect(date({ SITEMAP_LASTMOD: "2026-10-12" }, "")).toBe("2026-10-12T00:00:00Z");
    for (const bad of ["", "not a date", "Wed Oct 14 02:00:00 UTC 2026", "99999-99-99"]) expect(date({ SITEMAP_LASTMOD: bad }, ""), bad).toBeNull();
    // git garbage is not a date either
    expect(date({}, "tomorrow")).toBeNull();
    expect(date({ JBL_BUILD_DATE: "2026-01-02T03:04:05+01:00", SITEMAP_LASTMOD: "2026-10-12" })).toBe("2026-01-02T02:04:05Z");
    expect(toUtcIso("2026-10-14T01:57:35.123Z")).toBe("2026-10-14T01:57:35Z");
    expect(toUtcIso(undefined)).toBeNull();
    expect(toUtcIso(42 as unknown as string)).toBeNull();
  });

  it("never uses the build time as the commit date", () => {
    const root = fakeRoot();
    const info = resolveBuildInfo({ root, run: () => "", env: { GITHUB_SHA: "c".repeat(40) } });
    expect(info.commit).toBe("c".repeat(40));
    expect(info.commitDate).toBeNull();
    expect(info.source.date).toBeNull();
  });

  it("reads the website version from the root package.json and the app version from desktop/package.json", () => {
    const info = resolveBuildInfo({ root: fakeRoot("2.4.6", "1.9.9"), run: () => "", env: {} });
    expect(info.siteVersion).toBe("2.4.6");
    expect(info.desktopVersion).toBe("1.9.9");
    expect(info.name).toBe("JumpingBallsLive");
    const bare = resolveBuildInfo({ root: fakeRoot("3.0.0", null), run: () => "", env: {} });
    expect(bare.desktopVersion).toBeNull();
    const broken = tmpDir();
    fs.writeFileSync(path.join(broken, "package.json"), "{ not json");
    expect(resolveBuildInfo({ root: broken, run: () => "", env: {} }).siteVersion).toBe("0.0.0-dev");
    expect(resolveBuildInfo({ root: path.join(broken, "missing"), run: () => "", env: {} }).siteVersion).toBe("0.0.0-dev");
  });

  it("collects this repository's own build: the real package.json version and a real or absent git", () => {
    const info = resolveBuildInfo();
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(info.siteVersion).toBe(pkg.version);
    expect(info.desktopVersion).toBe((JSON.parse(read("desktop/package.json")) as { version: string }).version);
    if (info.commit) expect(info.commit).toMatch(/^[0-9a-f]{40}$/);
    if (info.commitDate) expect(info.commitDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("labels, ids and the client twin", () => {
  const info = resolveBuildInfo({ root: fakeRoot("1.10.0"), run: fakeGit(HEAD, "2026-10-13T18:28:27-07:00"), env: {} });
  const unknown = resolveBuildInfo({ root: fakeRoot("1.10.0"), run: () => "", env: {} });

  it("formats the label and the compact id", () => {
    expect(buildLabel(info)).toBe("v1.10.0 · aaaaaaa · 2026-10-14");
    expect(buildId(info)).toBe("1.10.0+aaaaaaa");
    expect(buildLabel(unknown)).toBe("v1.10.0 · dev");
    expect(buildId(unknown)).toBe("1.10.0+dev");
    // a commit without a date shows no date, never a made-up one
    expect(formatBuildLabel("1.10.0", HEAD, null)).toBe("v1.10.0 · aaaaaaa");
  });

  it("is formatted identically by src/lib/buildInfo.ts", () => {
    for (const [version, commit, date] of [
      ["1.10.0", HEAD, "2026-10-14T01:28:27Z"],
      ["1.10.0", HEAD, null],
      ["1.10.0", null, null],
      ["0.0.0-dev", "", ""],
    ] as const) {
      expect(client.formatBuildLabel(version, commit, date)).toBe(formatBuildLabel(version, commit, date));
      expect(client.formatBuildId(version, commit)).toBe(formatBuildId(version, commit));
    }
  });

  it("falls back to 'dev' where nothing is inlined (vitest) and reads the inlined values elsewhere", async () => {
    expect(client.BUILD_VERSION).toBe("0.0.0-dev");
    expect(client.BUILD_COMMIT).toBe("");
    expect(client.BUILD_COMMIT_DATE).toBe("");
    expect(client.buildLabel()).toBe("v0.0.0-dev · dev");
    expect(client.buildId()).toBe("0.0.0-dev+dev");
    const env = nextEnv(info);
    expect(env).toEqual({ NEXT_PUBLIC_BUILD_VERSION: "1.10.0", NEXT_PUBLIC_BUILD_COMMIT: HEAD, NEXT_PUBLIC_BUILD_COMMIT_DATE: "2026-10-14T01:28:27Z" });
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    const inlined = await import("@/lib/buildInfo");
    expect(inlined.buildLabel()).toBe(buildLabel(info));
    expect(inlined.buildId()).toBe(buildId(info));
    expect(inlined.BUILD_SHORT).toBe("aaaaaaa");
    expect(inlined.BUILD_DAY).toBe("2026-10-14");
    expect(nextEnv(unknown)).toEqual({ NEXT_PUBLIC_BUILD_VERSION: "1.10.0", NEXT_PUBLIC_BUILD_COMMIT: "", NEXT_PUBLIC_BUILD_COMMIT_DATE: "" });
  });
});

describe("version.json and the X-Build rule", () => {
  const info = resolveBuildInfo({ root: fakeRoot("1.10.0", "1.3.0"), run: fakeGit(HEAD, "2026-10-13T18:28:27-07:00"), env: {} });
  const now = new Date("2026-10-14T02:05:11.456Z");

  it("writes version.json with exactly the documented keys", () => {
    const out = tmpDir();
    const written = writeBuildFiles(out, info, { siteUrl: "https://jumpingballslive.com", now });
    expect(written.versionJson).toBe(path.join(out, "version.json"));
    const raw = fs.readFileSync(written.versionJson, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const json = JSON.parse(raw);
    expect(Object.keys(json)).toEqual([...VERSION_JSON_KEYS]);
    expect(json).toEqual({
      schema: 1,
      name: "JumpingBallsLive",
      siteVersion: "1.10.0",
      build: "1.10.0+aaaaaaa",
      commit: HEAD,
      commitShort: "aaaaaaa",
      commitDate: "2026-10-14T01:28:27Z",
      builtAt: "2026-10-14T02:05:11Z",
      channel: "production",
      desktopVersion: "1.3.0",
      siteUrl: "https://jumpingballslive.com",
      changelogUrl: "https://jumpingballslive.com/en/changelog/",
    });
    // builtAt lives in version.json only: it is the one value that changes with every build
    expect(Object.keys(nextEnv(info)).join()).not.toMatch(/BUILT|TIME/i);
  });

  it("carries no commit subject, branch, host path or environment", () => {
    const json = versionJson(info, { siteUrl: "https://jumpingballslive.com", now });
    const text = JSON.stringify(json);
    for (const key of ["subject", "message", "branch", "author", "email", "env", "cwd", "path", "token"]) expect(Object.keys(json), key).not.toContain(key);
    expect(text).not.toContain(os.tmpdir());
    expect(text).not.toMatch(/claude\.ai|Claude-Session|session_/);
    expect(text.length).toBeLessThan(700);
  });

  it("says 'development' for a localhost build or an unknown commit, and names the base path of a local build", () => {
    expect(versionJson(info, { siteUrl: "http://localhost:3000/smoke", now }).channel).toBe("development");
    const unknown = resolveBuildInfo({ root: fakeRoot(), run: () => "", env: {} });
    const dev = versionJson(unknown, { siteUrl: "https://jumpingballslive.com", now });
    expect(dev).toMatchObject({ channel: "development", commit: null, commitShort: null, build: "1.10.0+dev" });
    const local = versionJson(info, { basePath: "/Balls", now });
    expect(local.siteUrl).toBe("http://localhost:3000/Balls");
    expect(local.changelogUrl).toBe("http://localhost:3000/Balls/en/changelog/");
    expect(versionJson(info, { siteUrl: "https://jumpingballslive.com///", now }).siteUrl).toBe("https://jumpingballslive.com");
  });

  it("creates _headers with one X-Build rule for a known commit", () => {
    const out = tmpDir();
    const written = writeBuildFiles(out, info, { siteUrl: "https://jumpingballslive.com", now });
    expect(written.headers).toBe(path.join(out, "_headers"));
    expect(fs.readFileSync(written.headers!, "utf8")).toBe(`${HEADERS_MARKER}\n/*\n  X-Build: 1.10.0+aaaaaaa\n`);
  });

  it("appends to an existing _headers and replaces its own block when run again", () => {
    const out = tmpDir();
    const own = "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/*\n  X-Content-Type-Options: nosniff\n";
    fs.writeFileSync(path.join(out, "_headers"), own);
    writeBuildFiles(out, info, { siteUrl: "https://jumpingballslive.com", now });
    const first = fs.readFileSync(path.join(out, "_headers"), "utf8");
    expect(first.startsWith(own)).toBe(true);
    expect(first).toContain("X-Content-Type-Options: nosniff");
    expect(first.match(/X-Build:/g)).toHaveLength(1);
    const next = { ...info, siteVersion: "1.10.1", commit: "b".repeat(40), commitShort: "bbbbbbb" };
    writeBuildFiles(out, next, { siteUrl: "https://jumpingballslive.com", now });
    const second = fs.readFileSync(path.join(out, "_headers"), "utf8");
    expect(second.startsWith(own)).toBe(true);
    expect(second.match(/X-Build:/g)).toHaveLength(1);
    expect(second).toContain("X-Build: 1.10.1+bbbbbbb");
    expect(second).not.toContain("1.10.0+aaaaaaa");
    expect(headersWith("", "1.0.0+abc")).toBe(`${HEADERS_MARKER}\n/*\n  X-Build: 1.0.0+abc\n`);
  });

  it("writes no _headers for an unknown commit (a dev build claims no id) but still writes version.json", () => {
    const out = tmpDir();
    const unknown = resolveBuildInfo({ root: fakeRoot(), run: () => "", env: {} });
    const written = writeBuildFiles(out, unknown, { siteUrl: "https://jumpingballslive.com", now });
    expect(written.headers).toBeNull();
    expect(fs.existsSync(path.join(out, "_headers"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(out, "version.json"), "utf8"))).toMatchObject({ build: "1.10.0+dev", commit: null, commitDate: null });
  });
});

describe("the service worker cannot be hurt by the identity files", () => {
  const files = ["index.html", "en/index.html", "en/index.txt", "en/simulator/index.html", "pl/index.html", "es/index.html", "_next/static/chunks/main.js"];
  const info = resolveBuildInfo({ root: fakeRoot(), run: fakeGit(HEAD, "2026-10-14T01:57:35Z"), env: {} });

  function fakeExport() {
    const out = tmpDir();
    const write = (file: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
      fs.writeFileSync(path.join(out, file), body);
    };
    write("manifest.webmanifest", JSON.stringify(buildWebAppManifest({ basePath: "", name: "JumpingBallsLive", description: "d", locale: "en", simulatorLabel: "Simulator" })));
    for (const file of files) write(file, `<p>${file}</p>`);
    return out;
  }

  it("writing version.json and _headers after the worker leaves sw.js and its version untouched", () => {
    const out = fakeExport();
    const built = buildPwa(out, { root: ROOT });
    const before = fs.readFileSync(path.join(out, "sw.js"), "utf8");
    writeBuildFiles(out, info, { siteUrl: "https://jumpingballslive.com", now: new Date() });
    writeBuildFiles(out, info, { siteUrl: "https://jumpingballslive.com", now: new Date(Date.now() + 86_400_000) });
    expect(fs.readFileSync(path.join(out, "sw.js"), "utf8")).toBe(before);
    for (const name of ["version.json", "_headers", "build.txt"]) {
      expect(before, name).not.toContain(name);
      expect(built.precache, name).not.toContain(name);
    }
    expect(fs.existsSync(path.join(out, "version.json"))).toBe(true);
  });

  it("never precaches version.json, build.txt or _headers, even when they are in the export (a second guard)", () => {
    const list = selectPrecache([...files, "version.json", "build.txt", "_headers", "_redirects", "robots.txt"], { locales: ["en", "pl", "es"] });
    for (const name of ["version.json", "build.txt", "_headers", "_redirects"]) expect(list, name).not.toContain(name);
    // while a real asset is still there
    expect(list).toContain("_next/static/chunks/main.js");
  });

  it("scripts/postexport.mjs writes the identity files after the service worker, clears an earlier run's first and stops on a bad precache", () => {
    const post = read("scripts/postexport.mjs");
    const pwa = post.indexOf("buildPwa(out");
    const identity = post.indexOf("writeBuildFiles(");
    expect(pwa).toBeGreaterThan(0);
    expect(identity).toBeGreaterThan(pwa);
    // nothing is written to out/ after it except the log line
    const after = post.slice(identity);
    expect(after).not.toMatch(/writeFileSync|copyFileSync|buildPwa\(/);
    // a second run over the same out/ finds neither file when the worker is built
    const clear = post.indexOf("clearBuildFiles(out)");
    expect(clear).toBeGreaterThan(0);
    expect(clear).toBeLessThan(pwa);
    // and the build stops, rather than ships a worker that cannot install, when the precache lists a file the host does not serve
    expect(post).toMatch(/pwa\.precache\.filter\([\s\S]{0,60}"_headers"[\s\S]{0,60}"version\.json"/);
    expect(post).toContain("process.exit(1)");
  });

  it("a second postexport run starts clean: clearBuildFiles removes version.json and only its own _headers block", () => {
    const out = tmpDir();
    const own = "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n";
    fs.writeFileSync(path.join(out, "_headers"), own);
    writeBuildFiles(out, info, { siteUrl: "https://jumpingballslive.com" });
    expect(clearBuildFiles(out).sort()).toEqual(["_headers", "version.json"]);
    expect(fs.existsSync(path.join(out, "version.json"))).toBe(false);
    expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toBe(own);
    // with nothing else in it the file goes away; with nothing there it does nothing
    const bare = tmpDir();
    writeBuildFiles(bare, info, { siteUrl: "https://jumpingballslive.com" });
    expect(clearBuildFiles(bare).sort()).toEqual(["_headers", "version.json"]);
    expect(fs.readdirSync(bare)).toEqual([]);
    expect(clearBuildFiles(bare)).toEqual([]);
    expect(clearBuildFiles(path.join(bare, "missing"))).toEqual([]);
  });

});

describe("next.config.ts", () => {
  const config = read("next.config.ts");
  const code = config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

  it("inlines the build identity as NEXT_PUBLIC_BUILD_* through env", () => {
    expect(code).toMatch(/import \{[^}]*\bnextEnv\b[^}]*\} from "\.\/scripts\/lib\/build-info\.cjs"/);
    expect(code).toMatch(/env:\s*nextEnv\(resolveBuildInfo\(\)\)/);
    // every literal read in src/lib/buildInfo.ts is one nextEnv() provides
    const reads = [...read("src/lib/buildInfo.ts").matchAll(/process\.env\.(NEXT_PUBLIC_BUILD_[A-Z_]+)/g)].map((m) => m[1]);
    expect(reads.sort()).toEqual(Object.keys(nextEnv(resolveBuildInfo())).sort());
  });

  it("does not set generateBuildId (a commit hash can contain 'ad', which ad blockers match), and says why", () => {
    expect(code).not.toContain("generateBuildId");
    expect(config).toMatch(/generateBuildId[\s\S]{0,200}"ad"/);
  });
});

describe("the page: footer stamp, imprint and the jbl-build meta tag", () => {
  (globalThis as { React?: unknown }).React = React;
  const MESSAGES = { en, pl, es } as const;

  /** The footer, rendered for one language with the given build env (the constants are read when the module loads). */
  async function renderFooter(locale: "en" | "pl" | "es", env: Record<string, string> = {}) {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.doMock("@/i18n/navigation", () => ({
      Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href: `/${locale}${href}`, ...rest }, children),
      usePathname: () => "/",
    }));
    const { default: Footer } = await import("@/components/site/Footer");
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale, messages: MESSAGES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(Footer)),
    );
    vi.doUnmock("@/i18n/navigation");
    return html;
  }
  const paragraph = (html: string, needle: string) => (html.match(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<\/p>/g) ?? []).find((p) => p.includes(needle)) ?? "";

  it("shows the stamp in its own element, away from the © line, and links the changelog and press pages", async () => {
    const html = await renderFooter("en", {
      NEXT_PUBLIC_BUILD_VERSION: "1.10.0",
      NEXT_PUBLIC_BUILD_COMMIT: HEAD,
      NEXT_PUBLIC_BUILD_COMMIT_DATE: "2026-10-14T01:28:27Z",
    });
    const stamp = /<a [^>]*data-testid="build-stamp"[^>]*>([^<]*)<\/a>/.exec(html);
    expect(stamp?.[1]).toBe("v1.10.0 · aaaaaaa · 2026-10-14");
    expect(stamp?.[0]).toContain('href="/en/changelog"');
    expect(stamp?.[0]).toContain(`title="Build ${HEAD} · 2026-10-14T01:28:27Z. See what changed."`);
    // the © line is exactly what the smoke test pins, in a paragraph of its own
    const copyright = paragraph(html, "©");
    expect(copyright).toMatch(/^<p>© \d{4} JumpingBallsLive<\/p>$/);
    expect(copyright).not.toContain("build-stamp");
    expect(copyright).not.toMatch(/\.(com|io)/i);
    expect(html).not.toContain("footer-imprint");
    // the Product list
    expect(html).toMatch(/<a [^>]*href="\/en\/changelog"[^>]*>Changelog<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/en\/press"[^>]*>Press<\/a>/);
  });

  it("says 'dev' without a commit and carries the pl and es link texts", async () => {
    const dev = await renderFooter("en");
    expect(/data-testid="build-stamp"[^>]*>([^<]*)</.exec(dev)?.[1]).toBe("v0.0.0-dev · dev");
    expect(dev).toContain('title="Local build. See what changed."');
    const pol = await renderFooter("pl", { NEXT_PUBLIC_BUILD_VERSION: "1.10.0", NEXT_PUBLIC_BUILD_COMMIT: HEAD, NEXT_PUBLIC_BUILD_COMMIT_DATE: "2026-10-14T01:28:27Z" });
    expect(pol).toContain(">Dziennik zmian</a>");
    expect(pol).toContain(">Dla prasy</a>");
    expect(pol).toContain(`title="Kompilacja ${HEAD} · 2026-10-14T01:28:27Z. Zobacz, co się zmieniło."`);
    const spa = await renderFooter("es");
    expect(spa).toContain(">Registro de cambios</a>");
    expect(spa).toContain(">Prensa</a>");
  });

  it("shows 'Operated by {name}' as a separate element only when the operator's name is set", async () => {
    const none = await renderFooter("en", { NEXT_PUBLIC_LEGAL_NAME: "" });
    expect(none).not.toContain("Operated by");
    const set = await renderFooter("en", { NEXT_PUBLIC_LEGAL_NAME: "Example Studio Ltd" });
    const imprint = /<p data-testid="footer-imprint">([^<]*)<\/p>/.exec(set);
    expect(imprint?.[1]).toBe("Operated by Example Studio Ltd");
    expect(paragraph(set, "©")).not.toContain("Example Studio");
    expect((await renderFooter("pl", { NEXT_PUBLIC_LEGAL_NAME: "Example Studio Ltd" })).includes("Serwis prowadzi Example Studio Ltd")).toBe(true);
    expect((await renderFooter("es", { NEXT_PUBLIC_LEGAL_NAME: "Example Studio Ltd" })).includes("Gestionado por Example Studio Ltd")).toBe(true);
  });

  it("has the new Footer keys in every language", () => {
    for (const key of ["changelog", "press", "operatedBy", "buildTip", "buildTipDev"] as const) {
      for (const [locale, m] of Object.entries(MESSAGES)) expect(typeof (m.Footer as Record<string, string>)[key], `${locale} Footer.${key}`).toBe("string");
    }
    for (const m of Object.values(MESSAGES)) {
      expect(m.Footer.operatedBy).toContain("{name}");
      expect(m.Footer.buildTip).toContain("{commit}");
      expect(m.Footer.buildTip).toContain("{date}");
    }
  });

  it("puts <meta name=\"jbl-build\"> on every localised page through the layout's metadata", () => {
    const layout = read("src/app/[locale]/layout.tsx");
    expect(layout).toContain('import { buildId } from "@/lib/buildInfo"');
    expect(layout).toContain('other: { "jbl-build": buildId() }');
  });
});

describe("package.json and the lock file name the same website version", () => {
  it("is x.y.z in package.json, package-lock.json (both places) and what the build reads", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version: string }> };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(resolveBuildInfo().siteVersion).toBe(pkg.version);
  });
});
