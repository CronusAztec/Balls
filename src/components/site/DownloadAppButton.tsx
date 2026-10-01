"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { isDesktopApp } from "@/lib/desktop/bridge";

/* --- desktop-exe --- "Download for Windows" on the landing page (links the download page; hidden inside the app itself). */
export default function DownloadAppButton() {
  const t = useTranslations("Desktop");
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isDesktopApp()), []);
  if (inApp) return null;
  return (
    <Link href="/download" className="inline-flex flex-col items-center px-8 py-2.5 rounded-xl font-bold text-slate-200 border border-zinc-700 hover:border-[#93d119] hover:text-[#b0f02a] transition-all" data-testid="hero-download">
      <span>⊞ {t("heroButton")}</span>
      <span className="text-[10px] font-medium text-slate-500">{t("heroNote")}</span>
    </Link>
  );
}
