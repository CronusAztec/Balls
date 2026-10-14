import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { duplicatePaths, mergeDuplicateRules, mergeHeaderFile, parseRules, restoreStaticHeaders } from "../scripts/lib/headers-file.mjs";
import { HEADERS_MARKER, clearBuildFiles, headersWith } from "../scripts/lib/build-info.cjs";
import { isNotPrecached } from "../scripts/pwa/build.mjs";

/**
 * --- static-headers --- public/_headers (security and caching headers, read by Cloudflare Workers static assets), the one-block-per-path
 * rule of Wrangler, and the postexport steps that keep the X-Build header from replacing the security headers.
 * Proven by hand with the pinned Wrangler 3.114 (`wrangler dev` on a built export, `curl -I`): every rule below applied, /_headers
 * answered 404, and a second `/*` block replaced the first one entirely.
 */

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "public", "_headers"), "utf8");
const tmpDirs: string[] = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headers-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** What Wrangler deploys: a table by path, a later block replacing an earlier one of the same path (constructHeaders in workers-shared). */
function deployedTable(text: string): Record<string, Record<string, string>> {
  const { lines, rules } = parseRules(text);
  const table: Record<string, Record<string, string>> = {};
  for (const rule of rules) {
    const set: Record<string, string> = {};
    for (const at of rule.headerAts) {
      const [name, ...value] = lines[at].trim().split(":");
      const key = name.trim().toLowerCase();
      const v = value.join(":").trim();
      set[key] = key in set ? `${set[key]}, ${v}` : v;
    }
    table[rule.path] = set;
  }
  return table;
}

/** The headers that apply to a path: every matching rule's, a later rule's value replacing an earlier one's. */
function headersFor(text: string, pathname: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [pattern, set] of Object.entries(deployedTable(text))) {
    const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    if (re.test(pathname)) Object.assign(result, set);
  }
  return result;
}

describe("public/_headers", () => {
  const { rules } = parseRules(SOURCE);
  const table = deployedTable(SOURCE);

  it("is valid for Wrangler: paths start with a slash, every rule has headers, one block per path, within the platform's limits", () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(100);
    for (const rule of rules) {
      expect(rule.path.startsWith("/"), rule.path).toBe(true);
      expect(rule.headerAts.length, rule.path).toBeGreaterThan(0);
    }
    expect(duplicatePaths(SOURCE)).toEqual([]);
    expect(Math.max(...SOURCE.split("\n").map((l) => l.length))).toBeLessThanOrEqual(2000);
    for (const set of Object.values(table)) for (const name of Object.keys(set)) expect(name).toMatch(/^[a-z0-9-]+$/);
  });

  it("caches the content-hashed build output for a year, immutable, and the fixed-name media folders for a day", () => {
    expect(table["/_next/static/*"]).toEqual({ "cache-control": "public, max-age=31536000, immutable" });
    for (const folder of ["modes", "gallery", "icons", "notes", "hitSounds", "wallBreak"]) {
      expect(table[`/${folder}/*`], folder).toEqual({ "cache-control": "public, max-age=86400" });
      expect(fs.existsSync(path.join(ROOT, "public", folder)), `public/${folder} exists`).toBe(true);
    }
    // everything else keeps the host's revalidate-every-time default, so a deploy shows up at once
    for (const rule of rules) {
      if (rule.path === "/_next/static/*" || /^\/(modes|gallery|icons|notes|hitSounds|wallBreak)\/\*$/.test(rule.path)) continue;
      expect(table[rule.path]["cache-control"], rule.path).toBeUndefined();
    }
    for (const page of ["/en/", "/pl/simulator/", "/sw.js", "/offline.html", "/manifest.webmanifest", "/version.json", "/og.png", "/og/en/home.png", "/press/logo.svg"]) {
      expect(headersFor(SOURCE, page)["cache-control"], page).toBeUndefined();
    }
  });

  it("sets the security headers on every URL: nosniff, referrer policy, same-origin framing, no camera or microphone, HSTS for six months without subdomains or preload, no CSP", () => {
    for (const page of ["/", "/en/", "/pl/pricing/", "/_next/static/chunks/a.js", "/modes/classic.webp", "/sw.js", "/anything/at/all.txt"]) {
      const h = headersFor(SOURCE, page);
      expect(h["x-content-type-options"], page).toBe("nosniff");
      expect(h["referrer-policy"], page).toBe("strict-origin-when-cross-origin");
      expect(h["x-frame-options"], page).toBe("SAMEORIGIN");
      expect(h["permissions-policy"], page).toBe("camera=(), microphone=(), geolocation=(), display-capture=()");
      expect(h["strict-transport-security"], page).toBe("max-age=15552000");
    }
    expect(table["/*"]["strict-transport-security"]).not.toMatch(/includeSubDomains|preload/i);
    expect(SOURCE).not.toMatch(/^\s*Content-Security-Policy/im);
    // the permissions it switches off are really not used by the site
    const used = (re: RegExp) => {
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(tsx?|mjs)$/.test(entry.name) && re.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(ROOT, full));
        }
      };
      walk(path.join(ROOT, "src"));
      return hits;
    };
    expect(used(/getUserMedia|getDisplayMedia|navigator\.geolocation|<iframe/)).toEqual([]);
  });

  it("ends with the /* block (the one the X-Build header joins) and is never listed by the service worker", () => {
    expect(rules[rules.length - 1].path).toBe("/*");
    expect(isNotPrecached("_headers")).toBe(true);
    expect(isNotPrecached("_redirects")).toBe(true);
  });
});

describe("one block per path", () => {
  it("reads rules the way Wrangler does: a trimmed line that starts with a slash or scheme:// is a path, # starts a comment", () => {
    const { lines, rules } = parseRules("# c\n\n/a/*\n  X-One: 1\n  # inner comment\n  X-Two: 2\nhttps://:host.example.com/*\n  X-Three: 3\n");
    expect(rules.map((r) => r.path)).toEqual(["/a/*", "https://:host.example.com/*"]);
    expect(rules[0].headerAts.map((i) => lines[i].trim())).toEqual(["X-One: 1", "X-Two: 2"]);
    expect(rules[1].headerAts.map((i) => lines[i].trim())).toEqual(["X-Three: 3"]);
  });

  it("finds repeated paths and folds them into the last block, in order, without repeating identical lines", () => {
    const text = "/*\n  X-A: a\n  X-Shared: s\n\n/x/*\n  X-X: x\n\n# note\n/*\n  X-B: b\n  X-Shared: s\n\n/*\n  X-C: c\n";
    expect(duplicatePaths(text)).toEqual(["/*"]);
    const merged = mergeDuplicateRules(text);
    expect(duplicatePaths(merged)).toEqual([]);
    expect(merged).toBe("/x/*\n  X-X: x\n\n# note\n\n/*\n  X-A: a\n  X-Shared: s\n  X-B: b\n  X-C: c\n");
    expect(mergeDuplicateRules(merged)).toBe(merged);
    expect(mergeDuplicateRules("/a\n  X: 1\n/b\n  X: 2\n")).toBe("/a\n  X: 1\n/b\n  X: 2\n");
    expect(parseRules("").rules).toEqual([]);
  });

  it("is needed: appended as a second block, the X-Build rule replaces the security headers in what Wrangler deploys; merged, both are there", () => {
    const appended = headersWith(SOURCE, "1.10.0+abc1234");
    expect(duplicatePaths(appended)).toEqual(["/*"]);
    expect(Object.keys(deployedTable(appended)["/*"])).toEqual(["x-build"]); // the security headers are gone
    const merged = mergeDuplicateRules(appended);
    expect(duplicatePaths(merged)).toEqual([]);
    expect(deployedTable(merged)["/*"]).toEqual({ ...deployedTable(SOURCE)["/*"], "x-build": "1.10.0+abc1234" });
    expect(merged).toContain(HEADERS_MARKER);
    // the caching rules are untouched
    for (const [pattern, set] of Object.entries(deployedTable(SOURCE))) if (pattern !== "/*") expect(deployedTable(merged)[pattern]).toEqual(set);
    expect(headersFor(merged, "/en/")["x-build"]).toBe("1.10.0+abc1234");
    expect(headersFor(merged, "/_next/static/chunks/a.js")["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("gives the same out/_headers on a second postexport run over the same out/", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "public"));
    fs.writeFileSync(path.join(root, "public", "_headers"), SOURCE);
    const out = tmpDir();
    fs.writeFileSync(path.join(out, "_headers"), SOURCE); // what next build copies from public/
    const run = (id: string) => {
      clearBuildFiles(out);
      expect(restoreStaticHeaders(out, root)).toBe(true);
      const file = path.join(out, "_headers");
      fs.writeFileSync(file, headersWith(fs.readFileSync(file, "utf8"), id));
      return mergeHeaderFile(out);
    };
    expect(run("1.10.0+aaaaaaa")).toEqual(["/*"]);
    const first = fs.readFileSync(path.join(out, "_headers"), "utf8");
    expect(duplicatePaths(first)).toEqual([]);
    expect(first.match(/X-Build:/g)).toHaveLength(1);
    expect(run("1.10.1+bbbbbbb")).toEqual(["/*"]);
    const second = fs.readFileSync(path.join(out, "_headers"), "utf8");
    expect(second).toBe(first.replace("1.10.0+aaaaaaa", "1.10.1+bbbbbbb"));
    expect(second.match(/X-Build:/g)).toHaveLength(1);
    expect(Object.keys(deployedTable(second)["/*"]).sort()).toEqual(["permissions-policy", "referrer-policy", "strict-transport-security", "x-build", "x-content-type-options", "x-frame-options"]);
  });

  it("leaves a file with no repeated path alone, and a missing out/_headers or public/_headers is not an error", () => {
    const out = tmpDir();
    expect(mergeHeaderFile(out)).toEqual([]);
    expect(fs.existsSync(path.join(out, "_headers"))).toBe(false);
    expect(restoreStaticHeaders(out, tmpDir())).toBe(false);
    fs.writeFileSync(path.join(out, "_headers"), SOURCE);
    expect(mergeHeaderFile(out)).toEqual([]);
    expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toBe(SOURCE);
  });

  it("is wired into scripts/postexport.mjs: restored right after the build files are cleared, merged right after the X-Build rule is written", () => {
    const post = fs.readFileSync(path.join(ROOT, "scripts", "postexport.mjs"), "utf8");
    const order = ["buildInfo.clearBuildFiles(out)", "restoreStaticHeaders(out)", "buildPwa(out)", "buildInfo.writeBuildFiles(out", "mergeHeaderFile(out)"].map((s) => post.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
