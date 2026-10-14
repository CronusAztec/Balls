"use client";

import { useEffect, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { isEmail, pricingReturnUrl } from "@/lib/billing/api";
import { PLAN_IDS, PROVIDERS, formatUsd, monthlyEquivalentUsd, plansFromConfig, yearlySavingPercent, type Plan, type Provider } from "@/lib/billing/config";
import { useEntitlement } from "@/lib/billing/entitlement";
import { isDesktopApp } from "@/lib/desktop/bridge";
import { rememberCheckoutFrom, sessionStore } from "@/lib/billing/returnTo";
import { assetPath } from "@/lib/site"; // --- legal-copy ---
import { track } from "@/lib/analytics/track"; // --- analytics ---
import { siteBaseUrl, useBilling } from "./useBilling";

/*
 * --- paywall-gate --- The two Pro plans side by side – $6.99 a month and $49 a year ("save 42%") – each with the pay buttons
 * of the providers the backend has on (all three while payments are not configured, which then only says so): "Card
 * (Stripe)" (Apple Pay and Google Pay come with Stripe Checkout), "PayPal" and "Crypto – BTC, ETH, USDT and 300+ coins";
 * one email field above them (the card and crypto checkouts use it; PayPal brings its own). A pay button asks the backend
 * for a hosted checkout and sends the buyer there; the checkout returns to the pricing page with ?claim=…&ref=….
 * The pricing page and the Unlock dialog both show it (`variant`). In the Unlock dialog – the studio, with the setup the
 * visitor just prepared – the checkout opens in a NEW TAB (opened within the click, so no popup blocker refuses it, and
 * pointed at the checkout once the backend answers) and the studio stays as it is: the claimed licence reaches it through
 * the storage event and the dialog says it is unlocked. When the browser refuses the tab, the checkout leaves in the studio's
 * own tab after remembering the studio's address, and the pricing page offers "Back to your setup" after the claim.
 */

type Note = { tone: "muted" | "warn" | "danger"; text: string } | null;

export default function PlanCards({ variant = "page" }: { variant?: "page" | "dialog" }) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const billing = useBilling();
  const entitlement = useEntitlement();
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  // the licence's email is the natural default for a renewal or another period
  useEffect(() => {
    if (entitlement.email) setEmail((e) => e || entitlement.email || "");
  }, [entitlement.email]);

  const plans = plansFromConfig(billing.config);
  const saving = yearlySavingPercent(plans);
  // --- legal-copy --- Until the backend has said which providers are on (the static page, a slow or failed /config), PayPal is not offered: it
  // is off on the live backend, and a pay button the page then takes back would be a promise the HTML made before payment.
  const shown: Provider[] = billing.config ? PROVIDERS.filter((p) => billing.config!.providers[p]) : billing.configState === "unconfigured" ? [...PROVIDERS] : PROVIDERS.filter((p) => p !== "paypal");
  const compact = variant === "dialog";

  const pay = async (plan: Plan, provider: Provider) => {
    if (busy) return;
    if (!billing.client) {
      setNote({ tone: "warn", text: t("pay.notConfigured") });
      return;
    }
    const mail = email.trim();
    if (provider === "crypto" && !isEmail(mail)) {
      setNote({ tone: "danger", text: t("pay.emailNeeded") });
      return;
    }
    if (provider === "stripe" && mail && !isEmail(mail)) {
      setNote({ tone: "danger", text: t("email.invalid") });
      return;
    }
    setBusy(`${plan}-${provider}`);
    setNote({ tone: "muted", text: t("pay.redirecting") });
    const desktop = isDesktopApp();
    // the studio's tab stays where it is: the checkout gets a tab of its own, opened now – inside the click
    let tab: Window | null = null;
    if (compact && !desktop) {
      try {
        tab = window.open("", "_blank");
        if (tab) {
          tab.opener = null; // the provider's page gets no handle on the studio
          tab.document.title = t("pay.redirecting");
          if (tab.document.body) tab.document.body.textContent = t("pay.redirecting");
        }
      } catch {
        /* refused or not scriptable: the checkout leaves in this tab below */
      }
    }
    const r = await billing.client.checkout(provider, { plan, email: mail || undefined, locale, returnUrl: pricingReturnUrl(siteBaseUrl(), locale) });
    if (!r.ok) {
      tab?.close();
      setBusy(null);
      setNote({ tone: "danger", text: t("pay.failed", { message: r.message }) });
      return;
    }
    track("checkout_start", { plan, provider, from: compact ? "dialog" : "page" }); // --- analytics --- (the backend gave a checkout address; README "Analytics events")
    if (desktop) {
      // the app sends web pages to the system browser: the purchase is restored here afterwards with the receipt's reference
      window.open(r.value, "_blank");
      setBusy(null);
      setNote({ tone: "muted", text: t("pay.desktop") });
      return;
    }
    if (tab) {
      setBusy(null);
      // closed by the visitor while the backend answered: the checkout was called off, the studio stays
      if (tab.closed) {
        setNote(null);
        return;
      }
      tab.location.href = r.value;
      setNote({ tone: "muted", text: t("pay.newTab") });
      return;
    }
    // no tab of its own: leave from here, and remember the studio so the pricing page can lead back to the setup
    if (compact) rememberCheckoutFrom(sessionStore(), window.location);
    window.location.assign(r.value);
  };

  const label = (provider: Provider) => t(`pay.${provider}`);
  return (
    <div className={compact ? "space-y-4" : "space-y-5"} data-testid="plan-cards" data-billing-config={billing.configState}>
      <div className={cx("space-y-1.5", compact ? "" : "max-w-md")}>
        <label htmlFor={emailId} className="text-sm font-medium text-ink-2">
          {t("email.label")}
        </label>
        <input id={emailId} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email.placeholder")} className={inputClass} data-testid="billing-email" />
        <p className="text-xs leading-relaxed text-ink-3">
          {t("email.hint")}
          {shown.includes("paypal") && ` ${t("email.hintPaypal")}` /* --- legal-copy --- the PayPal sentence only when PayPal is offered */}
        </p>
      </div>
      <div className={cx("grid grid-cols-1 gap-4", compact ? "sm:grid-cols-2" : "md:grid-cols-2")}>
        {PLAN_IDS.map((plan) => {
          const yearly = plan === "yearly";
          return (
            <section
              key={plan}
              aria-labelledby={`${emailId}-${plan}`}
              data-testid={`plan-${plan}`}
              className={cx("flex flex-col gap-3 rounded-xl border bg-surface-1", compact ? "p-4" : "p-6", yearly ? "border-accent-dim/60" : "border-line")}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 id={`${emailId}-${plan}`} className="eyebrow text-ink-3">
                  {t(`plan.${plan}`)}
                </h3>
                {yearly && saving > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink">{t("plan.save", { percent: saving })}</span>}
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className={cx("font-display font-bold text-ink", compact ? "text-xl" : "text-2xl")} data-testid={`price-${plan}`}>
                  {formatUsd(plans[plan].usd, locale)}
                </span>
                <span className="text-md text-ink-2">{t(yearly ? "plan.perYear" : "plan.perMonth")}</span>
              </p>
              <p className="text-sm text-ink-2">{yearly ? t("plan.yearlyNote", { price: formatUsd(monthlyEquivalentUsd("yearly", plans), locale) }) : t("plan.monthlyNote")}</p>
              <div className="mt-auto flex flex-col gap-2 pt-1" role="group" aria-label={t("pay.label")}>
                {shown.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    data-pay={provider}
                    disabled={billing.configState === "loading" || busy !== null}
                    onClick={() => void pay(plan, provider)}
                    className={buttonClass({ variant: yearly && provider === "stripe" && !compact ? "primary" : "secondary", size: "md", block: true, className: "whitespace-normal text-center" })}
                  >
                    {busy === `${plan}-${provider}` ? t("pay.redirecting") : label(provider)}
                  </button>
                ))}
              </div>
              <ul className="space-y-1 text-xs leading-relaxed text-ink-3">
                {shown.length === 0 && <li className="text-warn">{t("pay.notConfigured")}</li> /* the backend has every provider off */}
                {shown.includes("stripe") && <li>{t("pay.stripeNote")}</li>}
                {shown.includes("crypto") && <li>{t("pay.cryptoNote", { days: plans[plan].prepaidDays })}</li>}
              </ul>
            </section>
          );
        })}
      </div>
      {/* --- legal-copy --- under the pay buttons: the currency, the tax and the Terms (a plain link: the Unlock dialog is studio code, and it opens the Terms in a new tab so the setup stays) */}
      <p className="text-xs leading-relaxed text-ink-3" data-testid="billing-checkout-line">
        {t.rich("checkout.line", {
          terms: (chunks) => (
            <a href={assetPath(`/${locale}/terms/`)} className="underline hover:text-ink-2" {...(compact ? { target: "_blank", rel: "noopener" } : {})} data-testid="billing-checkout-terms">
              {chunks}
            </a>
          ),
        })}
      </p>
      {note && (
        <p role="status" data-testid="billing-pay-note" className={cx("text-sm leading-relaxed", note.tone === "danger" ? "text-danger" : note.tone === "warn" ? "text-warn" : "text-ink-2")}>
          {note.text}
        </p>
      )}
    </div>
  );
}
