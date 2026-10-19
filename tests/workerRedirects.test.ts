import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import worker, { redirectFor } from "../worker/redirects.mjs";
import { mailtoFromHtml, securityTxt } from "../scripts/lib/security-txt.mjs";

/*
 * --- canonical-redirects --- The site's Worker script (worker/redirects.mjs) and wrangler.toml: http goes to https and www to the
 * bare domain from the repository, not from a dashboard setting; everything else is served from the static assets.
 * --- security-txt --- /.well-known/security.txt written by scripts/postexport.mjs from the support address the build knows.
 */

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("worker/redirects.mjs", () => {
  it("sends http to https on the same host, path and query, and drops the port", () => {
    expect(redirectFor("http://jumpingballslive.com/en/pricing/?utm_source=x#top")).toBe("https://jumpingballslive.com/en/pricing/?utm_source=x#top");
    expect(redirectFor("http://jumpingballslive.com:8080/en/")).toBe("https://jumpingballslive.com/en/");
  });

  it("sends www to the bare domain, over https, in one hop", () => {
    expect(redirectFor("https://www.jumpingballslive.com/en/?x=1")).toBe("https://jumpingballslive.com/en/?x=1");
    expect(redirectFor("http://www.jumpingballslive.com/pl/download/")).toBe("https://jumpingballslive.com/pl/download/");
  });

  it("leaves a canonical address, the workers.dev preview and a local wrangler dev alone", () => {
    expect(redirectFor("https://jumpingballslive.com/en/")).toBeNull();
    expect(redirectFor("https://jumpingballslive.jumpingballslive.workers.dev/en/")).toBeNull();
    expect(redirectFor("http://localhost:8787/en/")).toBeNull();
    expect(redirectFor("http://127.0.0.1:8787/_next/static/a.js")).toBeNull();
    expect(redirectFor("https://www/")).toBeNull(); // a host that is only "www" is not a www subdomain
  });

  it("answers a redirect with 301 and hands every other request to the assets binding unchanged", async () => {
    const seen: Request[] = [];
    const env = { ASSETS: { fetch: async (request: Request) => (seen.push(request), new Response("asset", { status: 200 })) } };
    const redirected = await worker.fetch(new Request("http://www.jumpingballslive.com/en/?a=1"), env);
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get("location")).toBe("https://jumpingballslive.com/en/?a=1");
    expect(seen).toHaveLength(0);
    const request = new Request("https://jumpingballslive.com/en/download/", { headers: { accept: "text/html" } });
    const served = await worker.fetch(request, env);
    expect(await served.text()).toBe("asset");
    expect(seen[0]).toBe(request);
  });

  it("is the Worker's script in wrangler.toml, run before the assets, which it reaches through the ASSETS binding", () => {
    const wrangler = read("wrangler.toml");
    expect(wrangler).toMatch(/^main = "worker\/redirects\.mjs"$/m);
    const assets = /\n\[assets\]\n([\s\S]*?)(?:\n\[|$)/.exec(wrangler)?.[1] ?? "";
    expect(assets).toMatch(/^binding = "ASSETS"$/m);
    expect(assets).toMatch(/^run_worker_first = true$/m);
    expect(assets).toMatch(/^directory = "\.\/out"$/m);
    // the pinned Wrangler knows run_worker_first (3.114 does; the older experimental_serve_directly is not used)
    expect(wrangler).not.toContain("experimental_serve_directly");
  });
});

describe("security.txt", () => {
  it("has the two required fields, expires within a year, and names the canonical file and the policy page", () => {
    const now = new Date("2026-10-19T12:34:56Z");
    const text = securityTxt({ contact: "security@example.com", siteUrl: "https://jumpingballslive.com/", now });
    const lines = text.trimEnd().split("\n");
    expect(lines).toContain("Contact: mailto:security@example.com");
    const expires = lines.find((l) => l.startsWith("Expires: "))?.slice(9) ?? "";
    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    expect(Date.parse(expires) - now.getTime()).toBeLessThan(365 * 24 * 3600 * 1000);
    expect(Date.parse(expires) - now.getTime()).toBeGreaterThan(300 * 24 * 3600 * 1000);
    expect(lines).toContain("Canonical: https://jumpingballslive.com/.well-known/security.txt");
    expect(lines).toContain("Policy: https://jumpingballslive.com/en/privacy/");
    expect(lines).toContain("Preferred-Languages: en, pl, es");
    expect(text.endsWith("\n")).toBe(true);
    expect(() => securityTxt({ contact: "", siteUrl: "" })).toThrow();
    expect(securityTxt({ contact: "a@b.c", siteUrl: "", now })).not.toContain("Canonical");
  });

  it("reads the support address from the privacy page's mailto link when the build variables are absent", () => {
    expect(mailtoFromHtml('<p>write to <a href="mailto:help@jumpingballslive.com?subject=x">help</a></p>')).toBe("help@jumpingballslive.com");
    expect(mailtoFromHtml("<p>no link</p>")).toBe("");
  });

  it("is written by postexport into out/.well-known, a dot path the service worker never precaches", () => {
    const post = read("scripts/postexport.mjs");
    expect(post).toContain('import { mailtoFromHtml, securityTxt } from "./lib/security-txt.mjs"');
    expect(post).toContain('path.join(out, ".well-known", "security.txt")');
    expect(post).toContain("process.env.NEXT_PUBLIC_SUPPORT_EMAIL || process.env.JBL_SUPPORT_EMAIL");
    // scripts/pwa/build.mjs lists files with dot files skipped, so .well-known is never in the precache
    expect(read("scripts/pwa/build.mjs")).toMatch(/dot files skipped/);
  });
});
