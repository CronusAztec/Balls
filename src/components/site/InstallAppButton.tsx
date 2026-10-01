"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { SITE_NAME } from "@/lib/site";
import { installPromptAvailable, promptInstall, subscribeInstallPrompt } from "./installPrompt";
import { IconDownload } from "@/components/ui/icons";

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
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink cursor-pointer"
      >
        <IconDownload size={16} />
        {t("installApp")}
      </button>
    </div>
  );
}
