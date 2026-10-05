"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import { useEntitlement } from "@/lib/billing/entitlement";
import type { ProFeature } from "@/lib/billing/guard";
import { subscribeUnlock, type UnlockRequest } from "@/lib/billing/unlock";
import { IconLock } from "./LockBadge";
import PlanCards from "./PlanCards";
import TestModeNote from "./TestModeNote";
import { pricingHref, useBilling, useLicenseRenewal, useNewTabLinks } from "./useBilling";
import { SITE_NAME } from "@/lib/site"; // --- watermark-everywhere ---

/*
 * --- free-watermark --- Titled "Remove the watermark" now: the account row's button, the note under the stage and the lock
 * on Publish (the one action still refused without Pro) open it; the copy says what Free makes (watermarked videos) and Pro.
 *
 * --- paywall-gate --- The Unlock dialog every locked action opens (through the guard's refusal, lib/billing/unlock.ts):
 * one line of why, the two plans with their pay buttons, a link to the pricing page and to Restore purchase, the test-mode
 * line; Escape, the scrim and the close button close it (components/ui/Dialog.tsx). `UnlockDialogHost` listens for the
 * requests – the simulator mounts it once – and renews a subscription's licence quietly (near its end, and after it ran
 * out). Everything that leaves the studio from here – the checkout, the pricing page, Restore – opens in a new tab, so the
 * setup the visitor prepared stays as it is; the licence that comes back reaches this tab through the storage event and the
 * dialog says it is unlocked.
 */

export function UnlockDialogHost() {
  const [request, setRequest] = useState<UnlockRequest | null>(null);
  useEffect(() => subscribeUnlock(setRequest), []);
  useLicenseRenewal(); // the studio renews a subscription's licence quietly near its end (the host is always mounted there)
  if (!request) return null;
  return <UnlockDialog key={request.serial} feature={request.feature} onClose={() => setRequest(null)} />;
}

export default function UnlockDialog({ feature, onClose }: { feature: ProFeature | null; onClose: () => void }) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const { testMode } = useBilling();
  const entitlement = useEntitlement();
  const newTab = useNewTabLinks();
  // A licence that arrives while the dialog is open (claimed in another tab, restored) unlocks at once: the dialog says so.
  const unlocked = entitlement.status === "pro";
  return (
    <Dialog onClose={onClose} title={t("dialog.title")} closeLabel={t("dialog.close")} id="unlock-dialog" bodyClassName="p-4 sm:p-6">
      <div className="space-y-5" data-testid="unlock-dialog" data-unlock-feature={feature ?? ""} data-unlocked={unlocked ? "1" : "0"}>
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-accent">
            <IconLock size={18} />
          </span>
          {/* the focus lands on the reason, not on the email field (a phone would open its keyboard at once) */}
          <div className="min-w-0 space-y-1" data-autofocus="" data-no-ring="" tabIndex={-1}>
            <p className="text-md font-medium text-ink">{t("why")}</p>
            <p className="text-sm text-ink-2">{t("liveMark", { siteName: SITE_NAME }) /* --- watermark-everywhere --- (the live canvas carries it too) */}</p>
            {feature && <p className="text-sm text-ink-2">{t("dialog.feature", { feature: t(`features.${feature}`) })}</p>}
          </div>
        </div>
        {unlocked && (
          <p className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok" role="status">
            {t("dialog.unlocked")}
          </p>
        )}
        {testMode && <TestModeNote />}
        <PlanCards variant="dialog" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-sm">
          <a href={pricingHref(locale)} {...newTab} className="font-medium text-accent hover:text-accent-strong" data-testid="unlock-pricing-link">
            {t("dialog.seePricing")}
          </a>
          <a href={pricingHref(locale, "#restore")} {...newTab} className="text-ink-2 hover:text-ink" data-testid="unlock-restore-link">
            {t("dialog.restore")}
          </a>
        </div>
      </div>
    </Dialog>
  );
}
