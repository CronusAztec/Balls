"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { IconCheck, IconWarning } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { CLAIM_POLL_LIMIT_MS, CLAIM_POLL_MS, isEmail, isReceiptRef, parseClaimParams, pricingReturnUrl, type BillingClient } from "@/lib/billing/api";
import { PAYPAL_SUBSCRIPTIONS_URL, accountView, formatLicenseDate, paidUntilMs } from "@/lib/billing/account";
import { getEntitlementStore, useEntitlement } from "@/lib/billing/entitlement";
import { decodeLicense, type LicenseError } from "@/lib/billing/license";
import { isDesktopApp } from "@/lib/desktop/bridge";
import PlanCards from "./PlanCards";
import TestModeNote from "./TestModeNote";
import { siteBaseUrl, useBilling, useLicenseRenewal } from "./useBilling";

/*
 * --- paywall-gate --- The pricing page's live parts (src/app/[locale]/pricing/page.tsx renders the static ones): the
 * test-mode line, the purchase a checkout returned with (?claim=<provider>&ref=<id>: claiming, waiting for the network to
 * confirm a crypto payment – asked every 5 s for up to 10 minutes –, "You are Pro until <date>", or the failure with
 * Restore), the plans, this browser's licence with Manage subscription (Stripe → the customer portal, PayPal → its
 * subscriptions page, crypto → buy another period), and Restore purchase (the checkout email and the receipt reference).
 */

/** "until <date>": the paid period's end of a licence that expires at `expMs`, in the page's language. */
const until = (expMs: number, locale: string) => formatLicenseDate(paidUntilMs(expMs), locale);

/** Why a licence the backend sent could not be installed, in words. */
function licenseErrorText(t: ReturnType<typeof useTranslations>, error: LicenseError): string {
  return t(`licenseError.${error}`);
}

/** The page's live header line: test mode (the build's key or the backend's). */
export function PricingTestMode() {
  const { testMode } = useBilling();
  return testMode ? <TestModeNote className="mt-6 max-w-[680px]" /> : null;
}

type ClaimState = { kind: "idle" } | { kind: "claiming" } | { kind: "pending" } | { kind: "success"; until: number } | { kind: "failed"; message: string } | { kind: "timeout" } | { kind: "unconfigured" };

/** The purchase a checkout returned with: claims its licence (and waits for a crypto payment's confirmation). */
export function ClaimPanel() {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const { client, mounted } = useBilling();
  const [state, setState] = useState<ClaimState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const claim = useRef<{ provider: Parameters<BillingClient["claim"]>[0]; ref: string } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    claim.current = parseClaimParams(window.location.search);
    if (!claim.current) return;
    if (!client) {
      setState({ kind: "unconfigured" });
      return;
    }
    const { provider, ref } = claim.current;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const ask = async () => {
      const r = await client.claim(provider, ref);
      if (!alive) return;
      if (!r.ok) {
        setState({ kind: "failed", message: r.message });
        return;
      }
      const answer = r.value;
      if (answer.kind === "pending") {
        if (Date.now() - started + CLAIM_POLL_MS > CLAIM_POLL_LIMIT_MS) {
          setState({ kind: "timeout" });
          return;
        }
        setState({ kind: "pending" });
        timer = setTimeout(() => void ask(), CLAIM_POLL_MS);
        return;
      }
      if (answer.kind === "error") {
        setState({ kind: "failed", message: answer.message || answer.error });
        return;
      }
      const installed = await getEntitlementStore().install(answer.token, { provider, ref });
      if (!alive) return;
      if (!installed.ok) {
        setState({ kind: "failed", message: licenseErrorText(t, installed.error) });
        return;
      }
      setState({ kind: "success", until: installed.payload.exp * 1000 });
      // the purchase is in this browser now: a reload need not claim it again
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.hash);
      } catch {
        /* history unavailable */
      }
    };
    setState({ kind: "claiming" });
    void ask();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, mounted, attempt, t]);

  if (state.kind === "idle") return null;
  const tone = state.kind === "success" ? "ok" : state.kind === "failed" || state.kind === "timeout" || state.kind === "unconfigured" ? "danger" : "muted";
  const text =
    state.kind === "claiming"
      ? t("claim.claiming")
      : state.kind === "pending"
        ? t("claim.pending")
        : state.kind === "success"
          ? t("claim.success", { date: until(state.until, locale) })
          : state.kind === "failed"
            ? t("claim.failed", { message: state.message })
            : state.kind === "timeout"
              ? t("claim.timeout")
              : t("claim.notConfigured");
  return (
    <section
      aria-live="polite"
      data-testid="billing-claim"
      data-claim-state={state.kind}
      className={cx("mt-8 max-w-[680px] rounded-xl border p-5", tone === "ok" ? "border-ok/40 bg-ok/5" : tone === "danger" ? "border-danger/30 bg-danger/5" : "border-line bg-surface-1")}
    >
      <h2 className="eyebrow text-ink-3">{t("claim.title")}</h2>
      <p className={cx("mt-2 flex items-start gap-2 text-md", tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-ink")}>
        {tone === "ok" ? <IconCheck size={18} className="mt-0.5" /> : tone === "danger" ? <IconWarning size={18} className="mt-0.5" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent animate-[var(--animate-rec)]" aria-hidden="true" />}
        <span>{text}</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {state.kind === "success" && (
          <Link href="/simulator" className={buttonClass({ variant: "primary", size: "sm" })} data-testid="billing-claim-studio">
            {t("claim.openStudio")}
          </Link>
        )}
        {(state.kind === "failed" || state.kind === "timeout") && (
          <>
            <button type="button" className={buttonClass({ variant: "secondary", size: "sm" })} onClick={() => setAttempt((n) => n + 1)}>
              {t("claim.retry")}
            </button>
            <a href="#restore" className={buttonClass({ variant: "ghost", size: "sm" })}>
              {t("restore.title")}
            </a>
          </>
        )}
      </div>
    </section>
  );
}

/** The plans, under their heading. */
export function PricingPlans() {
  return <PlanCards variant="page" />;
}

/** This browser's licence: the plan and its date, Manage subscription per provider, copy the key, remove it. */
export function LicencePanel() {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const entitlement = useEntitlement();
  const { client } = useBilling();
  useLicenseRenewal();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const view = accountView(entitlement, Date.now());
  if (view.kind !== "pro") {
    return (
      <p className="text-md text-ink-2" data-testid="billing-licence" data-licence="free">
        {view.kind === "checking" ? t("account.checking") : t(view.dropped === "expired" ? "account.freeExpired" : view.dropped === "invalid" ? "account.freeInvalid" : "manage.free")}
      </p>
    );
  }
  const statusKey = view.phase === "active" ? "pro" : view.phase;
  const openPortal = async () => {
    if (!client || !view.email) {
      setNote(t("pay.notConfigured"));
      return;
    }
    setBusy(true);
    setNote(null);
    // back to this pricing page (with the base path; the public site's from the desktop app), as the checkouts come back
    const r = await client.portal(view.email, pricingReturnUrl(siteBaseUrl(), locale));
    setBusy(false);
    if (!r.ok) {
      setNote(t("manage.failed", { message: r.message }));
      return;
    }
    if (isDesktopApp()) window.open(r.value, "_blank");
    else window.location.assign(r.value);
  };
  const copyKey = async () => {
    const token = getEntitlementStore().token();
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const remove = () => {
    if (window.confirm(t("manage.removeConfirm"))) getEntitlementStore().clear();
  };
  return (
    <div className="space-y-4" data-testid="billing-licence" data-licence="pro" data-licence-plan={view.plan} data-licence-provider={view.provider ?? ""}>
      <div className="rounded-xl border border-accent-dim/50 bg-surface-1 p-5">
        <p className="text-md font-medium text-ink">{t(`account.${statusKey}`, { plan: t(`plan.${view.plan}`), date: formatLicenseDate(view.date, locale) })}</p>
        {view.email && <p className="mt-1 text-sm text-ink-2">{t("manage.email", { email: view.email })}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {view.provider === "stripe" && (
            <button type="button" className={buttonClass({ variant: "secondary", size: "sm" })} onClick={() => void openPortal()} disabled={busy} data-testid="billing-manage">
              {busy ? t("manage.opening") : t("manage.stripe")}
            </button>
          )}
          {view.provider === "paypal" && (
            <a href={PAYPAL_SUBSCRIPTIONS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })} data-testid="billing-manage">
              {t("manage.paypal")}
            </a>
          )}
          {(view.provider === "crypto" || view.provider === null) && (
            <a href="#plans" className={buttonClass({ variant: "secondary", size: "sm" })} data-testid="billing-manage">
              {t("manage.crypto")}
            </a>
          )}
          <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => void copyKey()} title={t("manage.copyHint")}>
            {copied ? t("manage.copied") : t("manage.copyKey")}
          </button>
          <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={remove}>
            {t("manage.remove")}
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">{view.provider === "stripe" ? t("manage.stripeHint") : view.provider === "paypal" ? t("manage.paypalHint") : t("manage.cryptoHint")}</p>
        {note && (
          <p className="mt-2 text-sm text-danger" role="status">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

type RestoreState = { kind: "idle" } | { kind: "working" } | { kind: "success"; until: number } | { kind: "failed"; message: string };

/** Restore purchase: the checkout email and the receipt reference → this browser's licence. */
export function RestoreForm() {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const { client } = useBilling();
  const entitlement = useEntitlement();
  const id = useId();
  const [email, setEmail] = useState("");
  const [ref, setRef] = useState("");
  const [state, setState] = useState<RestoreState>({ kind: "idle" });
  useEffect(() => {
    if (entitlement.email) setEmail((e) => e || entitlement.email || "");
  }, [entitlement.email]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) {
      setState({ kind: "failed", message: t("email.invalid") });
      return;
    }
    if (!isReceiptRef(ref)) {
      setState({ kind: "failed", message: t("restore.refInvalid") });
      return;
    }
    if (!client) {
      setState({ kind: "failed", message: t("pay.notConfigured") });
      return;
    }
    setState({ kind: "working" });
    const r = await client.restore(email, ref);
    if (!r.ok) {
      setState({ kind: "failed", message: r.message });
      return;
    }
    if (r.value.kind !== "token") {
      setState({ kind: "failed", message: r.value.kind === "error" ? r.value.message || r.value.error : r.value.kind });
      return;
    }
    const provider = decodeLicense(r.value.token)?.payload?.provider ?? null;
    const installed = await getEntitlementStore().install(r.value.token, provider ? { provider, ref: ref.trim() } : null);
    if (!installed.ok) {
      setState({ kind: "failed", message: licenseErrorText(t, installed.error) });
      return;
    }
    setState({ kind: "success", until: installed.payload.exp * 1000 });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-[680px] space-y-4" data-testid="billing-restore" data-restore-state={state.kind} noValidate>
      <p className="text-md text-ink-2">{t("restore.intro")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-email`} className="text-sm font-medium text-ink-2">
            {t("email.label")}
          </label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email.placeholder")} className={inputClass} data-testid="billing-restore-email" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-ref`} className="text-sm font-medium text-ink-2">
            {t("restore.ref")}
          </label>
          <input id={`${id}-ref`} type="text" autoComplete="off" spellCheck={false} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("restore.refPlaceholder")} className={cx(inputClass, "font-mono")} data-testid="billing-restore-ref" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass({ variant: "secondary", size: "md" })} disabled={state.kind === "working"} data-testid="billing-restore-submit">
          {state.kind === "working" ? t("restore.working") : t("restore.submit")}
        </button>
        {state.kind === "success" && (
          <p className="flex items-center gap-2 text-sm text-ok" role="status">
            <IconCheck size={16} />
            {t("restore.success", { date: until(state.until, locale) })}
          </p>
        )}
        {state.kind === "failed" && (
          <p className="text-sm text-danger" role="status">
            {t("restore.failed", { message: state.message })}
          </p>
        )}
      </div>
    </form>
  );
}
