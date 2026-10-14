"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getDesktop } from "@/lib/desktop/bridge";
import { appReleaseId } from "@/content/changelogId";

/*
 * --- changelog --- Inside the Windows app only (window.desktop exists nowhere else): which version this is, with a link to its
 * release on the page. The static HTML renders nothing (the same on the server and on the first client render), the note
 * appears after mount, so hydration never differs. Reads ChangelogLive (i18n/clientMessages.ts: PAGE_CLIENT_NAMESPACES["/changelog"]).
 * The page hands it the versions that have a release ("appVersions") instead of the changelog's data, so the client chunk stays small.
 */
export default function ChangelogYourVersion({ appVersions }: { appVersions: readonly string[] }) {
  const t = useTranslations("ChangelogLive");
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getDesktop()
      ?.info()
      .then((info) => live && setVersion(info.version))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!version) return null;
  const known = appVersions.includes(version);
  return (
    <p role="status" className="mb-8 rounded-lg border border-accent-dim/60 bg-surface-1 px-4 py-3 text-md text-ink-2" data-testid="changelog-your-version">
      {t("youRun", { version })}{" "}
      {known && (
        <a href={`#${appReleaseId(version)}`} className="font-medium text-accent hover:text-accent-strong">
          {t("jump")}
        </a>
      )}
    </p>
  );
}
