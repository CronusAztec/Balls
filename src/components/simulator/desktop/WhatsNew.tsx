"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getDesktop } from "@/lib/desktop/bridge";
import { claimWhatsNew, pageStorage } from "@/lib/desktop/whatsNew";
import { appReleaseId } from "@/content/changelogId";
import { primaryBtn } from "./ui";

/*
 * --- changelog --- "What's new in x.y.z": a small notice in the Windows app, shown once after the app's version has risen (the
 * first run after an install shows nothing: lib/desktop/whatsNew.ts keeps the last version seen). It links to the bundled
 * /changelog page, at the release of this version, and has a Dismiss button. It renders nothing on the website (no bridge) and
 * nothing at all until the app has said which version runs, so it never changes the first paint. Reads the WhatsNew namespace.
 */
export default function WhatsNew() {
  const tw = useTranslations("WhatsNew"); // (not `t`: tests/desktopSite.test.ts reads every t("…") in this folder as a Desktop key)
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getDesktop()
      ?.info()
      .then((info) => {
        if (live && claimWhatsNew(pageStorage(), info.version)) setVersion(info.version);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!version) return null;
  return (
    <aside
      aria-label={tw("title", { version })}
      className="fixed inset-x-4 bottom-4 z-40 rounded-xl border border-accent-dim/60 bg-surface-1 p-4 shadow-lg sm:left-auto sm:max-w-sm"
      data-testid="desktop-whatsnew"
    >
      <p className="text-sm font-bold text-ink">{tw("title", { version })}</p>
      <p className="mt-1 text-xs text-ink-2">{tw("body")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/changelog#${appReleaseId(version)}`} onClick={() => setVersion(null)} className={primaryBtn} data-testid="desktop-whatsnew-link">
          {tw("link")}
        </Link>
        <button type="button" onClick={() => setVersion(null)} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-2 hover:text-ink" data-testid="desktop-whatsnew-dismiss">
          {tw("dismiss")}
        </button>
      </div>
    </aside>
  );
}
