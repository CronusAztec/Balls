"use client";

import { useLocale, useTranslations } from "next-intl";
import { cx } from "@/components/ui/cx";
import { accountMessageKey, accountView, formatLicenseDate, renewsByItself } from "@/lib/billing/account";
import { useEntitlement } from "@/lib/billing/entitlement";
import { requestUnlock } from "@/lib/billing/unlock";
import { IconLock } from "./LockBadge";
import { pricingHref, useNewTabLinks } from "./useBilling";

/*
 * --- free-watermark --- "Free – your videos carry a watermark" with Remove watermark (the Unlock dialog) and Restore now.
 *
 * --- paywall-gate --- The account row of the studio, at the top of the Recording group (where video creation and the
 * Publish block live): "Free – unlock video creation" with Unlock and Restore, or "Pro – <plan> until <date>" ("renews /
 * ends on <date>" near the end) with Manage and Restore; for a subscription's licence that ran out, "Renewing your
 * licence…" while the page asks for the renewed one, then "has ended" with Unlock and – the subscription is still there to
 * manage or cancel – Manage. The pricing page opens in a new tab, so the studio's setup stays as it is.
 */
export default function AccountRow({ className }: { className?: string }) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const entitlement = useEntitlement();
  const newTab = useNewTabLinks();
  const view = accountView(entitlement, Date.now());
  const key = accountMessageKey(view);
  const text = view.kind === "pro" ? t(`account.${key}`, { plan: t(`plan.${view.plan}`), date: formatLicenseDate(view.date, locale) }) : t(`account.${key}`);
  const pro = view.kind === "pro";
  const lapsedSubscription = view.kind === "free" && !!view.lapsed && renewsByItself(view.lapsed.provider);
  const small = "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium cursor-pointer transition-colors duration-150 [@media(pointer:coarse)]:min-h-11";
  return (
    <div
      className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-surface-1 px-3 py-2.5", pro ? "border-accent-dim/50" : "border-line", className)}
      data-testid="billing-account"
      data-billing-status={entitlement.status}
      data-billing-renewing={entitlement.renewing ? "1" : "0"}
      aria-label={t("account.label")}
      role="group"
    >
      <span className={cx("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line", pro ? "text-accent" : "text-ink-3")}>
        <IconLock size={15} />
      </span>
      <span className="min-w-0 flex-1 text-sm text-ink" data-testid="billing-account-text" aria-live="polite">
        {text}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {view.kind === "free" && !view.renewing && (
          <button type="button" onClick={() => requestUnlock()} className={cx(small, "bg-accent text-accent-ink hover:bg-accent-strong")} data-testid="billing-account-unlock">
            {t("account.unlock")}
          </button>
        )}
        {(pro || lapsedSubscription) && (
          <a href={pricingHref(locale, "#account")} {...newTab} className={cx(small, "border border-line text-ink hover:bg-surface-2")} data-testid="billing-account-manage">
            {t("account.manage")}
          </a>
        )}
        <a href={pricingHref(locale, "#restore")} {...newTab} className={cx(small, "text-ink-2 hover:bg-surface-2 hover:text-ink")} data-testid="billing-account-restore">
          {t("account.restore")}
        </a>
      </span>
    </div>
  );
}
