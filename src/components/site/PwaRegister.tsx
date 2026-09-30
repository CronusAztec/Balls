"use client";

import { useEffect } from "react";
import { BASE_PATH } from "@/lib/site";
import { canRegisterServiceWorker, serviceWorkerScope, serviceWorkerUrl } from "@/lib/pwa";
import { listenForInstallPrompt } from "./installPrompt";

/** How often a long-open tab looks for a new deploy when it becomes visible again. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * Registers the service worker (out/sw.js, written by scripts/postexport.mjs) from both root layouts –
 * feature pwa. Production builds only, over HTTPS or on localhost, with the base path as its scope. The
 * worker takes over at once (skipWaiting + clients.claim) and always asks the network for pages first, so
 * nothing here reloads the page: a running simulation or recording is never interrupted by an update.
 */
export default function PwaRegister() {
  useEffect(() => {
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
    const register = () => {
      navigator.serviceWorker
        .register(serviceWorkerUrl(BASE_PATH), { scope: serviceWorkerScope(BASE_PATH), updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
        })
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
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
