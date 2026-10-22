import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { fileToUrlPath, listFiles, MAX_CRITICAL_PRECACHE_BYTES } from "../scripts/pwa/build.mjs";
import { duplicatePaths } from "../scripts/lib/headers-file.mjs";

/**
 * --- perf-pass --- Guard rails for the speed of a cold mobile visit (the audit's section 5): they keep the fixes of the perf pass from
 * being undone by an innocent change.
 *  - source level, always: the default of every <Link>, the landing page's client modules, the pricing table's scroller, the
 *    footer's touch targets;
 *  - against a built export, when there is one (`npm run build` leaves ./out; PERF_GUARD_OUT=<folder> names another): the initial
 *    scripts of the marketing pages, the _headers file and the service worker's list. Without an export these are skipped, and the
 *    unit tests in tests/pwa.test.ts and tests/staticHeaders.test.ts cover the same rules on synthetic exports; the precache budget
 *    is also enforced by every build itself (scripts/pwa/build.mjs throws).
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ------------------------------------------------------------------------------------------------ links never prefetch */

const routerSpy = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock("next-intl/navigation", () => ({
  createNavigation: () => ({
    Link: function NextIntlLink() {
      return null;
    },
    redirect: () => undefined,
    usePathname: () => "/",
    useRouter: () => routerSpy,
    getPathname: () => "/",
  }),
}));

describe("links do not prefetch by default", () => {
  it("renders next-intl's Link with prefetch off, unless a link says otherwise", async () => {
    const { Link } = await import("@/i18n/navigation");
    const props = (extra: Record<string, unknown>) => (Link({ href: "/simulator", className: "x", ...extra } as never) as unknown as { props: Record<string, unknown>; type: { name: string } });
    const plain = props({});
    expect(plain.type.name).toBe("NextIntlLink");
    expect(plain.props).toMatchObject({ href: "/simulator", className: "x", prefetch: false });
    expect(props({ prefetch: undefined }).props.prefetch).toBe(false);
    expect(props({ prefetch: true }).props.prefetch).toBe(true);
    expect(props({ prefetch: null }).props.prefetch).toBeNull();
  });

  it("warms the studio up on intent (pointer over, finger down, focus) and swallows a failure", async () => {
    const { useWarmUp } = await import("@/i18n/navigation");
    const warm = useWarmUp("/simulator");
    expect(Object.keys(warm).sort()).toEqual(["onFocus", "onPointerEnter", "onTouchStart"]);
    routerSpy.prefetch.mockClear();
    warm.onPointerEnter();
    warm.onTouchStart();
    warm.onFocus();
    expect(routerSpy.prefetch).toHaveBeenCalledTimes(3);
    expect(routerSpy.prefetch).toHaveBeenCalledWith("/simulator");
    routerSpy.prefetch.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    expect(() => warm.onFocus()).not.toThrow();
  });

  it("is on the links that lead to the studio only: the hero button, the header's studio link and call to action, and the mobile sheet's", () => {
    expect(read("src/components/site/Hero.tsx")).toContain("<StudioLink");
    expect(read("src/components/site/StudioLink.tsx")).toContain('useWarmUp("/simulator")');
    const navbar = read("src/components/site/Navbar.tsx");
    expect((navbar.match(/\{\.\.\.warm\}/g) ?? []).length).toBe(2);
    expect(navbar).toContain('link.href === "/simulator" ? warm : {}');
  });

  it("is the only Link the site uses: nothing imports next/link or next-intl's navigation directly, and no page opts back in", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|mjs)$/.test(entry.name)) {
          const rel = path.relative(ROOT, full).replace(/\\/g, "/");
          const text = fs.readFileSync(full, "utf8");
          if (rel !== "src/i18n/navigation.ts" && /from ["'](next\/link|next-intl\/navigation)["']/.test(text)) hits.push(`${rel}: imports a Link of its own`);
          if (rel !== "src/i18n/navigation.ts") {
            text.split("\n").forEach((line, i) => {
              if (/prefetch/i.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
            });
          }
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });
});

/* -------------------------------------------------------------------- the landing page's client modules stay light */

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

/** The static value imports of a module (`import type` and dynamic `import()` are not followed: they load nothing up front). */
function staticImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) if (!m[1]) found.push(m[2]);
  return found.map((spec) => resolveImport(spec, file)).filter((f): f is string => !!f);
}

/** Every module reachable from `entries` by static imports, with the module each was reached from. */
function reach(entries: string[]): Map<string, string | null> {
  const from = new Map<string, string | null>(entries.map((e) => [e, null]));
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const dep of staticImports(file)) {
      if (!from.has(dep)) {
        from.set(dep, file);
        queue.push(dep);
      }
    }
  }
  return from;
}

const chain = (from: Map<string, string | null>, target: string) => {
  const names: string[] = [];
  for (let at: string | null | undefined = target; at; at = from.get(at)) names.push(path.relative(SRC, at));
  return names.reverse().join(" -> ");
};

describe("the marketing pages' client modules do not pull in the simulator's engine", () => {
  const siteDir = path.join(SRC, "components", "site");
  const entries = fs
    .readdirSync(siteDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(siteDir, f))
    .filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));

  it("finds the site's client components", () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.map((e) => path.basename(e))).toEqual(expect.arrayContaining(["Navbar.tsx", "Footer.tsx", "DailyChallengeCard.tsx", "LivePreview.tsx", "ModesOverview.tsx", "PwaRegister.tsx"]));
  });

  it("reaches no settings, no physics mode, no engine and no seed finder by static imports (the hero's live engine is a dynamic import)", () => {
    const from = reach(entries);
    const forbidden = [path.join(SRC, "lib", "settings.ts"), path.join(SRC, "lib", "daily.ts"), path.join(SRC, "lib", "physics", "engine.ts"), path.join(SRC, "lib", "simulation", "finder.ts")];
    for (const file of forbidden) expect(from.has(file) ? chain(from, file) : null, path.relative(SRC, file)).toBeNull();
    const modes = [...from.keys()].filter((f) => f.includes(`${path.sep}lib${path.sep}physics${path.sep}modes${path.sep}`));
    expect(modes).toEqual([]);
    expect(from.size).toBeLessThan(120);
  });

  it("would notice: the settings-bound half of the daily challenge does reach the settings", () => {
    const from = reach([path.join(SRC, "lib", "daily.ts")]);
    expect(from.has(path.join(SRC, "lib", "settings.ts"))).toBe(true);
    expect([...from.keys()].some((f) => f.includes(`${path.sep}physics${path.sep}modes${path.sep}`))).toBe(true);
    // ... and the card imports the other half
    const card = read("src/components/site/DailyChallengeCard.tsx");
    expect(card).toContain('from "@/lib/dailyCore"');
    expect(card).not.toMatch(/from "@\/lib\/daily"/);
    expect(reach([path.join(SRC, "lib", "dailyCore.ts")]).size).toBe(1);
  });
});

/* -------------------------------------------------------------------------------------- small fixes that must stay */

describe("small fixes of the perf pass", () => {
  it("keeps the pricing table's scroller positioned, so its screen-reader-only labels cannot widen the page on a phone", () => {
    expect(read("src/app/[locale]/pricing/page.tsx")).toMatch(/className="relative [^"]*overflow-x-auto[^"]*"/);
  });

  it("gives the footer's links a touch-sized target on coarse pointers and keeps the logo link's name its visible text", () => {
    expect(read("src/components/site/Footer.tsx")).toMatch(/const linkClass = "[^"]*\[@media\(pointer:coarse\)\]:py-1\.5[^"]*"/);
    const navbar = read("src/components/site/Navbar.tsx");
    const logo = navbar.match(/<Link href="\/"[^>]*font-display[^>]*>/)?.[0] ?? "";
    expect(logo).not.toBe("");
    expect(logo).not.toContain("aria-label");
  });

  it("keeps the hero preview's badges outside its link, so the link's name is its label and not a mismatch with visible text", () => {
    const live = read("src/components/site/LivePreview.tsx");
    const link = live.slice(live.indexOf("<Link"), live.indexOf("</Link>"));
    expect(link).toContain('data-testid="live-preview"');
    expect(link).toContain("aria-label=");
    expect(link).not.toContain("hero.live");
    expect(link).not.toContain("9:16");
  });
});

/* ------------------------------------------------------------------------------------------------- a built export */

const OUT = path.resolve(process.env.PERF_GUARD_OUT || path.join(ROOT, "out"));
// an old ./out (built before the critical/deferred split, so its worker has no "critical" list) is not this tree's export: skipped too
const builtExport = fs.existsSync(path.join(OUT, "en", "index.html")) && fs.existsSync(path.join(OUT, "sw.js")) && /"critical": \[/.test(fs.readFileSync(path.join(OUT, "sw.js"), "utf8"));
// --- ai-guard --- ./out must also be built from HEAD: out/version.json names the commit it was built from, and an export of an older
// commit checks yesterday's site (PERF_GUARD_OUT names an export on purpose, so it is taken as it is). A stale export is skipped with
// the reason; under the core guard (JBL_GUARD=1) it fails instead.
const exportCommit = (() => {
  try {
    return String((JSON.parse(fs.readFileSync(path.join(OUT, "version.json"), "utf8")) as { commit?: unknown }).commit ?? "");
  } catch {
    return "";
  }
})();
const headCommit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
})();
const staleExport = builtExport && !process.env.PERF_GUARD_OUT && (exportCommit === "" || exportCommit !== headCommit);
const hasExport = builtExport && !staleExport;
const staleReason = `./out was built from ${exportCommit ? exportCommit.slice(0, 7) : "an unknown commit (no out/version.json)"}, HEAD is ${headCommit ? headCommit.slice(0, 7) : "unknown"} – rebuild it (\`npm run build\`) or set PERF_GUARD_OUT=<export folder>`;
/** The marketing pages a paid visitor lands on. */
const LANDING_PAGES = ["en", "pl", "es", "en/download", "en/pricing", "en/account", "en/feedback", "en/about", "en/gallery"];
/** One initial script, unpacked: the largest today is the framework's 170 KB (the 1.2 MB all-modes chunk this guards against is 7 times that). */
const MAX_INITIAL_SCRIPT_BYTES = 600 * 1024;
/** All initial scripts of a page, unpacked (579 KB on the landing today). */
const MAX_INITIAL_SCRIPTS_TOTAL_BYTES = 1500 * 1024;

describe.runIf(staleExport && process.env.JBL_GUARD === "1")("built export freshness (the core guard)", () => {
  it("is built from HEAD, not an older commit", () => {
    expect(exportCommit, staleReason).toBe(headCommit);
  });
});

describe.skipIf(!hasExport)(
  staleExport
    ? `built export (skipped: stale export – ${staleReason})`
    : `built export (skipped: no export built by this tree in ${process.env.PERF_GUARD_OUT ? "PERF_GUARD_OUT" : "./out"} – run \`npm run build\` or set PERF_GUARD_OUT=<export folder>)`,
  () => {
  const initialScripts = (page: string) => {
    const html = fs.readFileSync(path.join(OUT, page, "index.html"), "utf8");
    return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => decodeURIComponent(m[1]).replace(/^\//, "").split("?")[0]);
  };

  it("loads no oversized script before a marketing page is interactive (the all-modes chunk, the studio)", () => {
    for (const page of LANDING_PAGES) {
      if (!fs.existsSync(path.join(OUT, page, "index.html"))) continue;
      let total = 0;
      let found = 0;
      for (const script of initialScripts(page)) {
        // an export built under a base path (the CI smoke build: /smoke) names its scripts /smoke/_next/..., the files are under out/_next/...
        const file = path.join(OUT, script.includes("_next/") ? script.slice(script.indexOf("_next/")) : script);
        if (!fs.existsSync(file)) continue; // a script of another host
        found++;
        const bytes = fs.statSync(file).size;
        total += bytes;
        expect(bytes, `${page}: ${script} is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(MAX_INITIAL_SCRIPT_BYTES);
      }
      expect(found, `${page}: the guard resolved only ${found} of its initial scripts to files in the export`).toBeGreaterThan(5); // never a vacuous pass
      expect(total, `${page}: initial scripts are ${(total / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(MAX_INITIAL_SCRIPTS_TOTAL_BYTES);
    }
  });

  it("has a _headers file with the immutable rule for the build output and one block per path", () => {
    const headers = fs.readFileSync(path.join(OUT, "_headers"), "utf8");
    expect(headers).toMatch(/^\/_next\/static\/\*\s*\n\s+Cache-Control: public, max-age=31536000, immutable\s*$/m);
    expect(duplicatePaths(headers)).toEqual([]);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
    expect(headers).toMatch(/Strict-Transport-Security: max-age=\d+\s*$/m);
  });

  it("lists in sw.js only files that exist, never _headers, the build stamps or the social cards, and keeps the install small", () => {
    const sw = fs.readFileSync(path.join(OUT, "sw.js"), "utf8");
    const config = JSON.parse(sw.match(/const CONFIG = (\{[\s\S]*?\n\});/)?.[1] ?? "null") as { critical: string[]; deferred: string[] };
    expect(config).not.toBeNull();
    const files = listFiles(OUT);
    const byUrl = new Map(files.map((f) => [fileToUrlPath(f), f]));
    const all = [...config.critical, ...config.deferred];
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((u) => !byUrl.has(u))).toEqual([]);
    expect(all.filter((u) => /^(_headers|_redirects|version\.json|build\.txt)$/.test(u) || u.startsWith("og/") || u.startsWith("press/"))).toEqual([]);
    const criticalBytes = config.critical.reduce((sum, u) => sum + fs.statSync(path.join(OUT, byUrl.get(u) as string)).size, 0);
    expect(criticalBytes).toBeLessThanOrEqual(MAX_CRITICAL_PRECACHE_BYTES);
    expect(config.critical).toEqual(expect.arrayContaining(["", "offline.html", "manifest.webmanifest", "en/"]));
    expect(config.critical.some((u) => u.includes("simulator") || u.startsWith("modes/"))).toBe(false);
  });
});
