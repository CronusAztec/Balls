import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWebAppManifest, canRegisterServiceWorker, PWA_BACKGROUND_COLOR, PWA_ICON_FILES, PWA_THEME_COLOR, serviceWorkerScope, serviceWorkerUrl } from "@/lib/pwa";
import {
  buildPwa,
  fileToUrlPath,
  hashExport,
  listFiles,
  MAX_PRECACHE_FILE_BYTES,
  readAccent,
  renderOfflinePage,
  renderServiceWorker,
  selectPrecache,
} from "../scripts/pwa/build.mjs";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * Installable offline app (feature pwa): the manifest, the registration rules, the build side (precache list,
 * version hash, offline page, sw.js) and the service worker itself, run against fake Cache Storage and network.
 */

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "scripts", "pwa", "sw.template.js"), "utf8");
const tmpDirs: string[] = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pwa-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("web app manifest", () => {
  it("starts on the default locale under the base path, standalone, with every icon", () => {
    const m = buildWebAppManifest({ basePath: "/Balls", name: "JumpingBallsLive", description: "d", locale: "en", simulatorLabel: "Simulator" });
    expect(m).toMatchObject({ id: "/Balls/", start_url: "/Balls/en/", scope: "/Balls/", display: "standalone", theme_color: PWA_THEME_COLOR, background_color: PWA_BACKGROUND_COLOR, name: "JumpingBallsLive", short_name: "JumpingBallsLive" });
    expect(m.icons.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/Balls/icon.svg", "any", "any"],
      ["/Balls/icons/icon-192.png", "192x192", "any"],
      ["/Balls/icons/icon-512.png", "512x512", "any"],
      ["/Balls/icons/icon-maskable-512.png", "512x512", "maskable"],
    ]);
    expect(m.shortcuts[0].url).toBe("/Balls/en/simulator/");
    const root = buildWebAppManifest({ basePath: "", name: "X", shortName: "Y", description: "d", locale: "pl", simulatorLabel: "S" });
    expect(root).toMatchObject({ id: "/", start_url: "/pl/", scope: "/", short_name: "Y" });
  });

  it("ships the committed PNG icons at their declared sizes", () => {
    for (const [file, size] of [[PWA_ICON_FILES.icon192, 192], [PWA_ICON_FILES.icon512, 512], [PWA_ICON_FILES.maskable512, 512], [PWA_ICON_FILES.appleTouch, 180]] as const) {
      const png = fs.readFileSync(path.join(ROOT, "public", file));
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
    }
  });
});

describe("service worker registration", () => {
  it("registers only in production builds, over HTTPS or on localhost", () => {
    const env = { production: true, protocol: "https:", hostname: "cronusaztec.github.io", supported: true };
    expect(canRegisterServiceWorker(env)).toBe(true);
    expect(canRegisterServiceWorker({ ...env, production: false })).toBe(false);
    expect(canRegisterServiceWorker({ ...env, supported: false })).toBe(false);
    expect(canRegisterServiceWorker({ ...env, protocol: "http:" })).toBe(false);
    for (const hostname of ["localhost", "127.0.0.1", "[::1]", "app.localhost"]) expect(canRegisterServiceWorker({ ...env, protocol: "http:", hostname })).toBe(true);
    expect(canRegisterServiceWorker({ ...env, protocol: "file:", hostname: "" })).toBe(false);
  });

  it("puts the worker and its scope under the base path", () => {
    expect(serviceWorkerUrl("/Balls")).toBe("/Balls/sw.js");
    expect(serviceWorkerScope("/Balls")).toBe("/Balls/");
    expect(serviceWorkerUrl("")).toBe("/sw.js");
    expect(serviceWorkerScope("")).toBe("/");
  });
});

const EXPORT_FILES = [
  "404.html",
  "404/index.html",
  "_next/static/BUILD/_buildManifest.js",
  "_next/static/chunks/app-123.js",
  "_next/static/css/abc.css",
  "en/about/index.html",
  "en/about/index.txt",
  "en/index.html",
  "en/index.txt",
  "en/simulator/index.html",
  "en/simulator/index.txt",
  "icon.svg",
  "icons/icon-192.png",
  "index.html",
  "index.txt",
  "manifest.webmanifest",
  "modes/classic.webp",
  "notes/fur-elise.mid",
  "offline.html",
  "og.png",
  "pl/index.html",
  "pl/index.txt",
  "pl/simulator/index.html",
  "pl/simulator/index.txt",
  "robots.txt",
  "samples/huge.wav",
  "sitemap.xml",
  "sw.js",
  "wallBreak/pop.wav",
];

describe("precache list and version", () => {
  it("maps index.html files to their folder URLs", () => {
    expect(fileToUrlPath("index.html")).toBe("");
    expect(fileToUrlPath("en/simulator/index.html")).toBe("en/simulator/");
    expect(fileToUrlPath("en/simulator/index.txt")).toBe("en/simulator/index.txt");
    expect(fileToUrlPath("_next/static/chunks/a.js")).toBe("_next/static/chunks/a.js");
  });

  it("precaches the shell pages of every locale and the app's assets, nothing else", () => {
    const list = selectPrecache(EXPORT_FILES, { locales: ["en", "pl"], sizes: { "samples/huge.wav": MAX_PRECACHE_FILE_BYTES + 1 } });
    expect(list.slice(0, 10)).toEqual(["", "offline.html", "en/", "en/index.txt", "en/simulator/", "en/simulator/index.txt", "pl/", "pl/index.txt", "pl/simulator/", "pl/simulator/index.txt"]);
    for (const url of ["_next/static/BUILD/_buildManifest.js", "_next/static/chunks/app-123.js", "_next/static/css/abc.css", "icon.svg", "icons/icon-192.png", "manifest.webmanifest", "modes/classic.webp", "notes/fur-elise.mid", "wallBreak/pop.wav"]) {
      expect(list).toContain(url);
    }
    for (const url of ["en/about/", "en/about/index.txt", "404.html", "404/", "og.png", "robots.txt", "sitemap.xml", "sw.js", "index.txt", "samples/huge.wav"]) {
      expect(list).not.toContain(url);
    }
    expect(new Set(list).size).toBe(list.length);
  });

  it("hashes every exported file but the worker itself into the version", () => {
    const dir = tmpDir();
    const write = (file: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), body);
    };
    write("en/index.html", "<h1>v1</h1>");
    write("_next/static/chunks/a.js", "a");
    write(".nojekyll", "");
    const files = listFiles(dir);
    expect(files).toEqual(["_next/static/chunks/a.js", "en/index.html"]);
    const v1 = hashExport(dir, files, "template");
    expect(v1).toMatch(/^[0-9a-f]{16}$/);
    write("sw.js", "anything");
    expect(hashExport(dir, listFiles(dir), "template")).toBe(v1);
    expect(hashExport(dir, files, "template 2")).not.toBe(v1);
    write("en/index.html", "<h1>v2</h1>");
    expect(hashExport(dir, files, "template")).not.toBe(v1);
  });
});

describe("offline page and sw.js rendering", () => {
  it("renders an offline page in every language that follows the URL", () => {
    const html = renderOfflinePage({
      basePath: "/Balls",
      siteName: "JumpingBallsLive",
      defaultLocale: "en",
      messages: { en, pl, es },
      iconSvg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
      backgroundColor: "#0b0b0d",
      accent: "#93d119",
      accentLight: "#b0f02a",
    });
    expect(html).toContain(`<title>${en.Pwa.offlinePageTitle.replace("{siteName}", "JumpingBallsLive")}</title>`);
    expect(html).toContain('href="/Balls/en/simulator/"');
    expect(html).toContain("data-pwa-offline");
    expect(html).toContain('<svg aria-hidden="true" class="icon"');
    for (const m of [en, pl, es]) expect(html).toContain(JSON.stringify(m.Pwa.offlineTitle));
    expect(html).not.toContain("{siteName}");
    // The page's own script is valid JavaScript.
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    expect(() => new Function(script)).not.toThrow();
    expect(() => renderOfflinePage({ basePath: "", siteName: "X", defaultLocale: "en", messages: { en: {} }, iconSvg: "<svg ></svg>", backgroundColor: "#000", accent: "#fff", accentLight: "#fff" })).toThrow(/Pwa/);
  });

  it("keeps the Pwa messages in step in every language", () => {
    expect(Object.keys(pl.Pwa)).toEqual(Object.keys(en.Pwa));
    expect(Object.keys(es.Pwa)).toEqual(Object.keys(en.Pwa));
    for (const m of [en, pl, es]) for (const value of Object.values(m.Pwa)) expect(value.trim().length).toBeGreaterThan(0);
  });

  it("reads the accent from site.ts and embeds the configuration into the template once", () => {
    expect(readAccent('export const ACCENT = "#123456";\nexport const ACCENT_LIGHT = "#abcdef";')).toEqual({ accent: "#123456", accentLight: "#abcdef" });
    expect(readAccent("")).toEqual({ accent: "#93d119", accentLight: "#b0f02a" });
    const js = renderServiceWorker(TEMPLATE, { version: "v1", cachePrefix: "app", offlinePage: "offline.html", concurrency: 2, precache: ["", "a</script>.js"] });
    expect(js).toContain('"version": "v1"');
    expect(js).not.toContain("__PWA_CONFIG__");
    expect(js).not.toContain("</script>");
    expect(() => new Function(js)).not.toThrow();
    expect(() => renderServiceWorker("no marker", {})).toThrow();
  });

  it("builds out/offline.html and out/sw.js from an export", () => {
    const out = tmpDir();
    const write = (file: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
      fs.writeFileSync(path.join(out, file), body);
    };
    write("manifest.webmanifest", JSON.stringify(buildWebAppManifest({ basePath: "/Balls", name: "JumpingBallsLive", description: "d", locale: "en", simulatorLabel: "Simulator" })));
    for (const file of ["index.html", "en/index.html", "en/index.txt", "en/simulator/index.html", "pl/index.html", "es/index.html", "en/about/index.html"]) write(file, `<p>${file}</p>`);
    write("_next/static/chunks/main.js", "console.log(1)");
    write("og.png", "png");
    const result = buildPwa(out, { root: ROOT });
    expect(result.basePath).toBe("/Balls");
    expect(result.locales).toEqual(["en", "es", "pl"]);
    expect(result.precache).toEqual(expect.arrayContaining(["", "offline.html", "en/", "en/index.txt", "en/simulator/", "pl/", "es/", "_next/static/chunks/main.js", "manifest.webmanifest"]));
    expect(result.precache).not.toContain("en/about/");
    expect(result.precache).not.toContain("og.png");
    const sw = fs.readFileSync(path.join(out, "sw.js"), "utf8");
    expect(sw).toContain(`"version": "${result.version}"`);
    expect(sw).toContain('"cachePrefix": "jumpingballslive"');
    expect(fs.readFileSync(path.join(out, "offline.html"), "utf8")).toContain("JumpingBallsLive");
    // A new export (one page changed) is a new version.
    write("en/about/index.html", "<p>changed</p>");
    expect(buildPwa(out, { root: ROOT }).version).not.toBe(result.version);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The service worker itself, in a fake worker scope: Cache Storage, the network and the lifecycle events.
// ---------------------------------------------------------------------------------------------------------

const ORIGIN = "https://example.github.io";
const SCOPE = `${ORIGIN}/Balls/`;

class FakeCache {
  store = new Map<string, Response>();
  private key(req: string | { url: string }) {
    const u = new URL(typeof req === "string" ? req : req.url);
    u.hash = "";
    return u.href;
  }
  async match(req: string | { url: string }) {
    return this.store.get(this.key(req))?.clone();
  }
  async put(req: string | { url: string }, res: Response) {
    this.store.set(this.key(req), res);
  }
}

class FakeCacheStorage {
  map = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache());
    return this.map.get(name)!;
  }
  async keys() {
    return [...this.map.keys()];
  }
  async delete(name: string) {
    return this.map.delete(name);
  }
}

interface Net {
  offline: boolean;
  pages: Map<string, { status?: number; body: string; type?: string }>;
  calls: { url: string; cache: string }[];
}

type FakeRequest = { url: string; method: string; mode: string; destination: string; headers: Headers; cache: string };

function makeNet(): Net {
  return { offline: false, pages: new Map(), calls: [] };
}

function fakeFetch(net: Net) {
  return async (input: string | FakeRequest | Request) => {
    const url = typeof input === "string" ? input : input.url;
    net.calls.push({ url, cache: typeof input === "string" ? "default" : input.cache });
    if (net.offline) throw new TypeError("Failed to fetch");
    const u = new URL(url);
    const page = net.pages.get(u.origin + u.pathname);
    if (!page) return typedResponse(new Response("not found", { status: 404 }), "basic");
    return typedResponse(new Response(page.body, { status: page.status ?? 200, headers: { "content-type": page.type ?? "text/html" } }), "basic");
  };
}

/** Node's Response has type "default"; a same-origin fetch in a browser answers "basic". */
function typedResponse(res: Response, type: string) {
  Object.defineProperty(res, "type", { value: type });
  const clone = res.clone.bind(res);
  res.clone = () => typedResponse(clone(), type);
  return res;
}

function loadWorker(opts: { version: string; precache: string[]; net: Net; storage: FakeCacheStorage; scope?: string }) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const state = { skipWaiting: 0, claimed: 0, preloadEnabled: 0 };
  const self = {
    registration: { scope: opts.scope ?? SCOPE, navigationPreload: { enable: async () => void state.preloadEnabled++ } },
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => void state.skipWaiting++,
    clients: { claim: async () => void state.claimed++ },
  };
  const js = renderServiceWorker(TEMPLATE, { version: opts.version, cachePrefix: "jbl", offlinePage: "offline.html", concurrency: 3, precache: opts.precache });
  new Function("self", "caches", "fetch", js)(self, opts.storage, fakeFetch(opts.net));

  const lifecycle = async (type: "install" | "activate") => {
    const waits: Promise<unknown>[] = [];
    listeners[type]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const request = (url: string, init: Partial<FakeRequest> = {}): FakeRequest => ({ url, method: "GET", mode: "cors", destination: "", headers: new Headers(), cache: "default", ...init });
  const navigate = (url: string) => request(url, { mode: "navigate", destination: "document" });
  const fetchEvent = async (req: FakeRequest, preload?: Response) => {
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({ request: req, preloadResponse: Promise.resolve(preload), respondWith: (p: Promise<Response>) => (responded = p), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    if (!responded) return null;
    const res = await (responded as Promise<Response>);
    await Promise.all(waits);
    return res;
  };
  return { state, lifecycle, request, navigate, fetchEvent };
}

const bodyOf = async (res: Response | null) => (res ? await res.text() : null);

function sitePages(net: Net, tag: string) {
  for (const p of ["", "offline.html", "en/", "en/simulator/", "en/simulator/index.txt", "_next/static/chunks/app.js", "modes/classic.webp", "en/about/"]) {
    net.pages.set(`${ORIGIN}/Balls/${p}`, { body: `${p || "root"} ${tag}`, type: p.endsWith(".txt") ? "text/plain" : "text/html" });
  }
}

const PRECACHE = ["", "offline.html", "en/", "en/simulator/", "en/simulator/index.txt", "_next/static/chunks/app.js", "modes/classic.webp"];

describe("service worker", () => {
  it("precaches the shell past the HTTP cache, takes over at once and clears this scope's old versions only", async () => {
    const net = makeNet();
    sitePages(net, "v1");
    const storage = new FakeCacheStorage();
    await storage.open("jbl:/Balls/:old");
    await storage.open("jbl:/Other/:old");
    await storage.open("someone-else");
    const sw = loadWorker({ version: "v1", precache: PRECACHE, net, storage });
    await sw.lifecycle("install");
    expect(net.calls.map((c) => c.cache)).toEqual(PRECACHE.map(() => "reload"));
    const cache = await storage.open("jbl:/Balls/:v1");
    expect([...cache.store.keys()].sort()).toEqual(PRECACHE.map((p) => `${SCOPE}${p}`).sort());
    expect(sw.state.skipWaiting).toBe(1);
    await sw.lifecycle("activate");
    expect((await storage.keys()).sort()).toEqual(["jbl:/Balls/:v1", "jbl:/Other/:old", "someone-else"]);
    expect(sw.state.claimed).toBe(1);
    expect(sw.state.preloadEnabled).toBe(1);
  });

  it("fails the install and drops its cache when a shell file is missing", async () => {
    const net = makeNet();
    sitePages(net, "v1");
    const storage = new FakeCacheStorage();
    const sw = loadWorker({ version: "v1", precache: [...PRECACHE, "missing.png"], net, storage });
    await expect(sw.lifecycle("install")).rejects.toThrow(/missing\.png/);
    expect(await storage.keys()).toEqual([]);
    expect(sw.state.skipWaiting).toBe(0);
  });

  it("serves pages network first – fresh when online, cached (query ignored) or the offline page when not", async () => {
    const net = makeNet();
    sitePages(net, "v1");
    const storage = new FakeCacheStorage();
    const sw = loadWorker({ version: "v1", precache: PRECACHE, net, storage });
    await sw.lifecycle("install");
    await sw.lifecycle("activate");

    // Online: the network's page, even though a cached copy exists – and the cache follows it.
    sitePages(net, "v1-hotfix");
    net.calls.length = 0;
    expect(await bodyOf(await sw.fetchEvent(sw.navigate(`${SCOPE}en/simulator/?mode=classic&seed=4`)))).toBe("en/simulator/ v1-hotfix");
    expect(net.calls).toHaveLength(1);
    expect(await bodyOf((await (await storage.open("jbl:/Balls/:v1")).match(`${SCOPE}en/simulator/`)) ?? null)).toBe("en/simulator/ v1-hotfix");
    // A navigation preload response is used instead of a second request.
    net.calls.length = 0;
    expect(await bodyOf(await sw.fetchEvent(sw.navigate(`${SCOPE}en/`), new Response("preloaded")))).toBe("preloaded");
    expect(net.calls).toHaveLength(0);
    // A 404 passes through untouched and is not cached.
    const missing = await sw.fetchEvent(sw.navigate(`${SCOPE}pl/nope/`));
    expect(missing?.status).toBe(404);
    expect(await (await storage.open("jbl:/Balls/:v1")).match(`${SCOPE}pl/nope/`)).toBeUndefined();

    // Offline.
    net.offline = true;
    expect(await bodyOf(await sw.fetchEvent(sw.navigate(`${SCOPE}en/simulator/?mode=drop`)))).toBe("en/simulator/ v1-hotfix");
    expect(await bodyOf(await sw.fetchEvent(sw.navigate(`${SCOPE}en/simulator`)))).toBe("en/simulator/ v1-hotfix");
    expect(await bodyOf(await sw.fetchEvent(sw.navigate(`${SCOPE}pl/about/`)))).toBe("offline.html v1");
    // Client-side navigation payloads: cached ones answer, others fail (Next then falls back to a page load).
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}en/simulator/index.txt?_rsc=abc`)))).toBe("en/simulator/index.txt v1");
    const rsc = await sw.fetchEvent(sw.request(`${SCOPE}en/about/index.txt?_rsc=abc`));
    expect(rsc?.type).toBe("error");
  });

  it("serves build files and assets cache first", async () => {
    const net = makeNet();
    sitePages(net, "v1");
    const storage = new FakeCacheStorage();
    net.pages.set(`${SCOPE}_next/static/chunks/app/[locale]/page-1.js`, { body: "locale page v1" });
    net.pages.set(`${SCOPE}_next/static/chunks/app/(static)/layout-1.js`, { body: "static layout v1" });
    const sw = loadWorker({ version: "v1", precache: [...PRECACHE, "_next/static/chunks/app/[locale]/page-1.js", "_next/static/chunks/app/(static)/layout-1.js"], net, storage });
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
    net.calls.length = 0;
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}_next/static/chunks/app.js`, { destination: "script" })))).toBe("_next/static/chunks/app.js v1");
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}modes/classic.webp`, { destination: "image" })))).toBe("modes/classic.webp v1");
    expect(net.calls).toHaveLength(0);
    // Pages ask for chunks/app/%5Blocale%5D/…, the precache list names chunks/app/[locale]/…: one cache entry.
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}_next/static/chunks/app/%5Blocale%5D/page-1.js`)))).toBe("locale page v1");
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}_next/static/chunks/app/(static)/layout-1.js`)))).toBe("static layout v1");
    expect(net.calls).toHaveLength(0);
    // Not cached yet: fetched once, then served from the cache.
    net.pages.set(`${SCOPE}_next/static/chunks/lazy.js`, { body: "lazy" });
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}_next/static/chunks/lazy.js`)))).toBe("lazy");
    net.offline = true;
    expect(await bodyOf(await sw.fetchEvent(sw.request(`${SCOPE}_next/static/chunks/lazy.js`)))).toBe("lazy");
  });

  it("leaves other requests to the network", async () => {
    const net = makeNet();
    const sw = loadWorker({ version: "v1", precache: [], net, storage: new FakeCacheStorage() });
    expect(await sw.fetchEvent(sw.request(`${SCOPE}en/`, { method: "POST" }))).toBeNull();
    expect(await sw.fetchEvent(sw.request("https://fonts.googleapis.com/css2?family=x"))).toBeNull();
    expect(await sw.fetchEvent(sw.navigate(`${ORIGIN}/Other/en/`))).toBeNull();
    expect(await sw.fetchEvent(sw.request(`${SCOPE}sw.js`))).toBeNull();
    expect(await sw.fetchEvent(sw.request(`${SCOPE}wallBreak/pop.wav`, { headers: new Headers({ range: "bytes=0-" }) }))).toBeNull();
  });

  it("never serves an old deploy's page: the new version replaces the cache and pages come from the network", async () => {
    const net = makeNet();
    sitePages(net, "deploy-1");
    const storage = new FakeCacheStorage();
    const v1 = loadWorker({ version: "v1", precache: PRECACHE, net, storage });
    await v1.lifecycle("install");
    await v1.lifecycle("activate");

    // Deploy 2 is live; the old worker still controls the page but asks the network first.
    sitePages(net, "deploy-2");
    expect(await bodyOf(await v1.fetchEvent(v1.navigate(`${SCOPE}en/`)))).toBe("en/ deploy-2");

    // The browser finds the new sw.js: it installs (reusing unchanged hashed build files), activates, drops v1.
    net.calls.length = 0;
    const v2 = loadWorker({ version: "v2", precache: PRECACHE, net, storage });
    await v2.lifecycle("install");
    expect(net.calls.map((c) => c.url)).not.toContain(`${SCOPE}_next/static/chunks/app.js`);
    await v2.lifecycle("activate");
    expect(await storage.keys()).toEqual(["jbl:/Balls/:v2"]);

    net.offline = true;
    expect(await bodyOf(await v2.fetchEvent(v2.navigate(`${SCOPE}en/simulator/`)))).toBe("en/simulator/ deploy-2");
    expect(await bodyOf(await v2.fetchEvent(v2.navigate(`${SCOPE}`)))).toBe("root deploy-2");
  });
});
