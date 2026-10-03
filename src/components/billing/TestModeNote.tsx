"use client";

import { useTranslations } from "next-intl";
import { IconWarning } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

/**
 * --- paywall-gate --- The yellow line of test mode: the build verifies licences with the committed TEST key (no
 * NEXT_PUBLIC_LICENSE_PUBLIC_KEY) or the backend runs on test keys – payments are not configured for real yet.
 */
export default function TestModeNote({ className }: { className?: string }) {
  const t = useTranslations("Billing");
  return (
    <p className={cx("flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-sm leading-relaxed text-warn", className)} data-testid="billing-test-mode" role="note">
      <IconWarning size={16} className="mt-0.5" />
      <span>{t("testMode")}</span>
    </p>
  );
}
