"use client";

import { useEffect } from "react";
import { BASE_PATH } from "@/lib/site";
import { canRegisterServiceWorker, PRECACHE_REST_DELAY_MS, PRECACHE_REST_MESSAGE, serviceWorkerScope, serviceWorkerUrl, shouldPrecacheRest, type ConnectionHints } from "@/lib/pwa";
import { listenForInstallPrompt } from "./installPrompt";
import { isDesktopApp } from "@/lib/desktop/bridge"; // --- desktop-exe ---

/** How often a long-open tab looks for a new deploy when it becomes visible again. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * Registers the service worker (out/sw.js, written by scripts/postexport.mjs) from both root layouts –
 * feature pwa. Production builds only, over HTTPS or on localhost, with the base path as its scope. The
 * worker takes over at once (skipWaiting + clients.claim) and always asks the network for pages first, so
 * nothing here reloads the page: a running simulation or recording is never interrupted by an update.
 * --- precache-split --- The worker's install only fetches the critical files (the landing pages, the offline page, icons, CSS and
 * fonts). The rest of the app (the studio, the mode pictures, the sounds: several megabytes) is cached when this component asks
 * for it, a few seconds after the worker is ready and only on a connection that can bear it (shouldPrecacheRest): never on
 * Save-Data, cellular or 3g, so a visitor who clicked an ad on a phone does not pay for an offline copy they did not ask for.
 */
export default function PwaRegister() {
  useEffect(() => {
    // --- desktop-exe --- the Windows app serves the export itself (app://): no service worker, no install prompt
    if (isDesktopApp()) return;
    listenForInstallPrompt();
    const supported = "serviceWorker" in navigator;
    const production = process.env.NODE_ENV === "production";
    const scope = new URL(serviceWorkerScope(BASE_PATH), window.location.href).href;
    if (!canRegisterServiceWorker({ production, protocol: window.location.protocol, hostname: window.location.hostname, supported })) {
      // A worker left behind by a production build on localhost must not serve a dev server's pages.
      if (supported && !production) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.filter((r) => r.scope === scope).map((r) => r.unregister())))
          .catch(() => {});
      }
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = Date.now();
    // --- precache-split --- a returning visitor: the worker already controlled this page when it loaded
    const returning = !!navigator.serviceWorker.controller;
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRest = () => {
      if (restTimer !== null) return;
      restTimer = setTimeout(() => {
        restTimer = null;
        const connection = (navigator as Navigator & { connection?: ConnectionHints }).connection;
        if (!shouldPrecacheRest(connection, { returning })) return;
        // The active worker is the newest one by now; a worker that takes over later (a new deploy) is asked again on controllerchange.
        (registration?.active ?? navigator.serviceWorker.controller)?.postMessage({ type: PRECACHE_REST_MESSAGE });
      }, PRECACHE_REST_DELAY_MS);
    };
    const register = () => {
      navigator.serviceWorker
        .register(serviceWorkerUrl(BASE_PATH), { scope: serviceWorkerScope(BASE_PATH), updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
          return navigator.serviceWorker.ready;
        })
        .then(scheduleRest)
        .catch((err: unknown) => console.warn("Service worker registration failed:", err));
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !registration || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };
    // After the page has loaded, so the first visit's precaching never competes with the page itself.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.addEventListener("controllerchange", scheduleRest);
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", scheduleRest);
      if (restTimer !== null) clearTimeout(restTimer);
    };
  }, []);
  return null;
}
