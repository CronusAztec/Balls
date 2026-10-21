"use client";

import { useTranslations } from "next-intl";
import { DESKTOP_CAPABILITIES, type DesktopCapability } from "@/lib/desktop/capabilities";
import { Card } from "./ui";

/*
 * --- old-bridge --- What a tab shows in an app older than its feature (lib/desktop/capabilities.ts): the app version that
 * brought it and where to update (the update button in the group's top bar, which every app version has).
 */
export default function NeedsNewerApp({ capability }: { capability: DesktopCapability }) {
  const t = useTranslations("Desktop");
  return (
    <Card title={t("needsNewerAppTitle")} testId="desktop-needs-update">
      <p className="text-xs text-ink-2" data-capability={capability} data-since={DESKTOP_CAPABILITIES[capability].since}>
        {t("needsNewerApp", { version: DESKTOP_CAPABILITIES[capability].since })}
      </p>
    </Card>
  );
}
