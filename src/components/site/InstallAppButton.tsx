"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { SITE_NAME } from "@/lib/site";
import { installPromptAvailable, promptInstall, subscribeInstallPrompt } from "./installPrompt";

/**
 * "Install app" button (feature pwa): shown only while the browser offers to install the site
 * (Chrome, Edge, Android), hidden once installed or when the app already runs in its own window.
 */
export default function InstallAppButton() {
  const t = useTranslations("Pwa");
  const available = useSyncExternalStore(subscribeInstallPrompt, installPromptAvailable, () => false);
  if (!available) return null;
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void promptInstall()}
        title={t("installAppTip", { siteName: SITE_NAME })}
        data-testid="pwa-install"
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-600/40 bg-cyan-600/10 px-3 py-1 text-xs font-semibold text-cyan-400 transition-colors hover:bg-cyan-600/20"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" />
        </svg>
        {t("installApp")}
      </button>
    </div>
  );
}
