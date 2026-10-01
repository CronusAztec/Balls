"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { isDesktopApp } from "@/lib/desktop/bridge";
import { buttonClass } from "@/components/ui/Button";
import { IconDownload } from "@/components/ui/icons";

/* --- desktop-exe --- "Download for Windows" on the landing page (links the download page; hidden inside the app itself).
   --- site-redesign --- the hero's secondary button; `fallback` shows instead inside the app. The hero (a server component)
   passes the labels, so the landing page's client messages leave the Desktop namespace out (i18n/clientMessages.ts). */
export default function DownloadAppButton({ label, note, fallback = null }: { label: string; note: string; fallback?: React.ReactNode }) {
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isDesktopApp()), []);
  if (inApp) return <>{fallback}</>;
  return (
    <Link href="/download" className={buttonClass({ variant: "secondary", size: "md" })} title={note} data-testid="hero-download">
      <IconDownload size={18} />
      {label}
    </Link>
  );
}
