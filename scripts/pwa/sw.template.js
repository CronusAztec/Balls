/*
 * Service worker of the installable offline app (feature pwa). scripts/postexport.mjs writes out/sw.js from
 * this template (scripts/pwa/build.mjs fills in CONFIG below), so the exported site knows exactly which
 * files it has: the list below is generated, and the version is a hash of every exported file – a new deploy
 * is a new worker with new caches.
 *
 * Strategies (every request outside the scope, cross-origin, not a GET or a byte range goes straight to the
 * network):
 *  - pages (navigations, *.html, the RSC payloads *.txt, the manifest and other data): NETWORK FIRST – the
 *    network's answer is returned (and cached) whenever there is one, so a new deploy is never hidden behind
 *    a cached page; the cache (and offline.html for pages that were never cached) only answers offline;
 *  - /_next/static (content-hashed) and the public assets (icons, previews, melodies, sounds): CACHE FIRST.
 * install precaches the app shell and takes over at once (skipWaiting); activate deletes this site's caches
 * of older versions and claims the open pages.
 */
/* eslint-disable */
"use strict";

const CONFIG = __PWA_CONFIG__;

/** "/Balls/" – the registration scope's path; the site's files are listed relative to it. */
function scopePath() {
  return new URL(self.registration.scope).pathname;
}

/** Cache names carry the scope (several sites can share a github.io origin) and the version. */
function cachePrefix() {
  return `${CONFIG.cachePrefix}:${scopePath()}:`;
}

function cacheName() {
  return cachePrefix() + CONFIG.version;
}

/**
 * Cache key: the URL without its query or hash – every URL of a static export is one file, whatever its query –
 * with each path segment percent-encoded one canonical way (pages ask for chunks/app/%5Blocale%5D/…, the precache
 * list names the file chunks/app/[locale]/…).
 */
function cacheKey(url) {
  const u = new URL(url);
  const path = u.pathname
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch (err) {
        return segment;
      }
    })
    .join("/");
  return u.origin + path;
}

function scopeUrl(relative) {
  return new URL(relative, self.registration.scope).href;
}

const NETWORK_FIRST_EXT = /\.(html?|txt|json|webmanifest|xml)$/i;

/** "network-first" or "cache-first" for a request in the scope; `relative` is its path inside the scope. */
function strategyFor(request, relative) {
  if (request.mode === "navigate" || request.destination === "document" || request.destination === "iframe") return "network-first";
  if (relative.startsWith("_next/static/")) return "cache-first";
  if (relative === "" || relative.endsWith("/") || NETWORK_FIRST_EXT.test(relative)) return "network-first";
  if (/\.[a-z0-9]+$/i.test(relative)) return "cache-first";
  return "network-first";
}

function cacheable(response) {
  return !!response && response.ok && response.type === "basic" && !response.redirected;
}

/** Fetches the precache list into `cache`, a few at a time, past the HTTP cache (a new version must not pick up old copies). */
async function precache(cache, relatives) {
  const oldCaches = (await caches.keys()).filter((k) => k.startsWith(cachePrefix()) && k !== cacheName());
  let next = 0;
  const worker = async () => {
    while (next < relatives.length) {
      const url = scopeUrl(relatives[next++]);
      // Content-hashed build files never change: reuse the previous version's copy instead of downloading it again.
      if (url.includes("/_next/static/")) {
        let reused = null;
        for (const name of oldCaches) {
          reused = await (await caches.open(name)).match(cacheKey(url), { ignoreVary: true });
          if (reused) break;
        }
        if (reused) {
          await cache.put(cacheKey(url), reused);
          continue;
        }
      }
      const response = await fetch(new Request(url, { cache: "reload", credentials: "same-origin" }));
      if (!response.ok) throw new Error(`precache: ${url} answered ${response.status}`);
      await cache.put(cacheKey(url), response);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency || 6, relatives.length) }, worker));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName());
      try {
        await precache(cache, CONFIG.precache);
      } catch (err) {
        // A half-filled cache of a version that failed to install is useless; the next navigation retries.
        await caches.delete(cacheName());
        throw err;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const prefix = cachePrefix();
      const current = cacheName();
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(prefix) && k !== current).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (err) {
          // Navigation preload is an optimisation only.
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** Cached copy of a page: the URL itself, the folder it redirects to (/en/simulator → /en/simulator/) or the folder of an index.html. */
async function matchPage(cache, url) {
  const key = cacheKey(url);
  const keys = [key];
  if (!key.endsWith("/") && !/\.[a-z0-9]+$/i.test(key)) keys.push(`${key}/`);
  if (key.endsWith("/index.html")) keys.push(key.slice(0, -"index.html".length));
  for (const candidate of keys) {
    const hit = await cache.match(candidate, { ignoreVary: true });
    if (hit) return hit;
  }
  return null;
}

async function networkFirst(event) {
  const request = event.request;
  const cache = await caches.open(cacheName());
  try {
    const preloaded = request.mode === "navigate" ? await event.preloadResponse : undefined;
    const response = preloaded || (await fetch(request));
    if (cacheable(response)) event.waitUntil(cache.put(cacheKey(request.url), response.clone()).catch(() => {}));
    return response;
  } catch (err) {
    const cached = await matchPage(cache, request.url);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const offline = await cache.match(cacheKey(scopeUrl(CONFIG.offlinePage)), { ignoreVary: true });
      if (offline) return offline;
    }
    return Response.error();
  }
}

async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(cacheName());
  const cached = await cache.match(cacheKey(request.url), { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) event.waitUntil(cache.put(cacheKey(request.url), response.clone()).catch(() => {}));
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const scope = scopePath();
  if (!url.pathname.startsWith(scope)) return;
  const relative = url.pathname.slice(scope.length);
  if (relative === "sw.js") return;
  const strategy = strategyFor(request, relative);
  if (strategy === "network-first") event.respondWith(networkFirst(event));
  else if (strategy === "cache-first") event.respondWith(cacheFirst(event));
});
