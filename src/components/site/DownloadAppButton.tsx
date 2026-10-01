"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { isDesktopApp } from "@/lib/desktop/bridge";
import { buttonClass } from "@/components/ui/Button";
import { IconDownload } from "@/components/ui/icons";

/* --- desktop-exe --- "Download for Windows" on the landing page (links the download page; hidden inside the app itself).
   --- site-redesign --- the hero's secondary button; `fallback` shows instead inside the app. */
export default function DownloadAppButton({ fallback = null }: { fallback?: React.ReactNode }) {
  const t = useTranslations("Desktop");
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isDesktopApp()), []);
  if (inApp) return <>{fallback}</>;
  return (
    <Link href="/download" className={buttonClass({ variant: "secondary", size: "md" })} title={t("heroNote")} data-testid="hero-download">
      <IconDownload size={18} />
      {t("heroButton")}
    </Link>
  );
}
