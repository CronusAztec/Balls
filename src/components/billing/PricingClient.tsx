"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { IconCheck, IconWarning } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { CLAIM_POLL_LIMIT_MS, CLAIM_POLL_MS, isEmail, isReceiptRef, parseClaimParams, pricingReturnUrl, type BillingClient } from "@/lib/billing/api";
import { PAYPAL_SUBSCRIPTIONS_URL, accountMessageKey, accountView, formatLicenseDate, paidUntilMs } from "@/lib/billing/account";
import type { Provider } from "@/lib/billing/config";
import { getEntitlementStore, useEntitlement } from "@/lib/billing/entitlement";
import { decodeLicense, type LicenseError } from "@/lib/billing/license";
import { checkoutFrom, forgetCheckoutFrom, sessionStore } from "@/lib/billing/returnTo";
import { isDesktopApp } from "@/lib/desktop/bridge";
import PlanCards from "./PlanCards";
import TestModeNote from "./TestModeNote";
import { siteBaseUrl, useBilling, useLicenseRenewal, useStoredReceipt } from "./useBilling";

/*
 * --- paywall-gate --- The pricing page's live parts (src/app/[locale]/pricing/page.tsx renders the static ones): the
 * test-mode line, the purchase a checkout returned with (?claim=<provider>&ref=<id>: claiming, waiting for the network to
 * confirm a crypto payment – asked every 5 s for up to 10 minutes –, "You are Pro until <date>" with the receipt reference
 * to keep and "Back to your setup" when the checkout left from the studio, or the failure with Restore), the plans, this
 * browser's licence – or the one that ran out – with Manage subscription (Stripe → the customer portal, PayPal → its
 * subscriptions page, crypto → buy another period), its receipt reference, Copy licence key and Remove, Restore purchase
 * (the checkout email and the receipt reference) and Paste a licence key.
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

/** Copies `text`, saying "Copied" on the button for a moment. */
function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const t = useTranslations("Billing");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the text is on screen to select */
    }
  };
  return (
    <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => void copy()} data-testid={testId}>
      {copied ? t("manage.copied") : label}
    </button>
  );
}

/** A receipt reference on screen – to restore the purchase on another device or in the desktop app – with Copy. */
function ReceiptReference({ value, hint, testId }: { value: string; hint: string; testId: string }) {
  const t = useTranslations("Billing");
  return (
    <div className="mt-3 rounded-md border border-line bg-surface-2/60 px-3 py-2" data-testid={testId} data-ref={value}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm text-ink-2">{t("manage.reference")}</span>
        <code className="min-w-0 break-all font-mono text-sm text-ink select-all">{value}</code>
        <CopyButton text={value} label={t("manage.copyRef")} testId={`${testId}-copy`} />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">{hint}</p>
    </div>
  );
}

/**
 * "Back to your setup": the studio address a same-tab checkout left from (sessionStorage), read after mounting – and whether
 * the address bar carries a purchase to claim (then the claim's own states lead back).
 */
function useCheckoutFrom(): { from: string | null; claimInUrl: boolean; done: () => void } {
  const [found, setFound] = useState<{ from: string | null; claimInUrl: boolean }>({ from: null, claimInUrl: false });
  useEffect(() => setFound({ from: checkoutFrom(sessionStore()), claimInUrl: !!parseClaimParams(window.location.search) }), []);
  return { ...found, done: () => forgetCheckoutFrom(sessionStore()) };
}

type ClaimState = { kind: "idle" } | { kind: "claiming" } | { kind: "pending" } | { kind: "success"; until: number; ref: string } | { kind: "failed"; message: string; ref: string } | { kind: "timeout"; ref: string } | { kind: "unconfigured" };

/** The purchase a checkout returned with: claims its licence (and waits for a crypto payment's confirmation). */
export function ClaimPanel() {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const { client, mounted } = useBilling();
  const [state, setState] = useState<ClaimState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const back = useCheckoutFrom();
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
      // a failure keeps the reference on screen too: Restore asks for it
      if (!r.ok) {
        setState({ kind: "failed", message: r.message, ref });
        return;
      }
      const answer = r.value;
      if (answer.kind === "pending") {
        if (Date.now() - started + CLAIM_POLL_MS > CLAIM_POLL_LIMIT_MS) {
          setState({ kind: "timeout", ref });
          return;
        }
        setState({ kind: "pending" });
        timer = setTimeout(() => void ask(), CLAIM_POLL_MS);
        return;
      }
      if (answer.kind === "error") {
        setState({ kind: "failed", message: answer.message || answer.error, ref });
        return;
      }
      const installed = await getEntitlementStore().install(answer.token, { provider, ref });
      if (!alive) return;
      if (!installed.ok) {
        setState({ kind: "failed", message: licenseErrorText(t, installed.error), ref });
        return;
      }
      // the reference stays on screen (and in this browser): it restores the purchase on another device or in the desktop app
      setState({ kind: "success", until: installed.payload.exp * 1000, ref });
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

  if (state.kind === "idle") {
    // a checkout that left from the studio's own tab and came back without a purchase (cancelled): the way back to the setup
    return back.from && !back.claimInUrl ? (
      <p className="mt-6 max-w-[680px]" data-testid="billing-back-to-setup">
        <a href={back.from} onClick={back.done} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t("claim.backToSetup")}
        </a>
      </p>
    ) : null;
  }
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
      {(state.kind === "success" || state.kind === "failed" || state.kind === "timeout") && <ReceiptReference value={state.ref} hint={t("claim.referenceHint")} testId="billing-claim-ref" />}
      <div className="mt-4 flex flex-wrap gap-2">
        {state.kind === "success" &&
          (back.from ? (
            // the studio the checkout left from, with its setup in the address
            <a href={back.from} onClick={back.done} className={buttonClass({ variant: "primary", size: "sm" })} data-testid="billing-claim-studio" data-back-to-setup="1">
              {t("claim.backToSetup")}
            </a>
          ) : (
            <Link href="/simulator" className={buttonClass({ variant: "primary", size: "sm" })} data-testid="billing-claim-studio">
              {t("claim.openStudio")}
            </Link>
          ))}
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

/** This browser's licence (or the one that ran out): its plan and date, Manage subscription per provider, its receipt reference, copy the key, remove it. */
export function LicencePanel() {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const entitlement = useEntitlement();
  const receipt = useStoredReceipt();
  const { client } = useBilling();
  useLicenseRenewal();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const view = accountView(entitlement, Date.now());
  const lapsed = view.kind === "free" ? view.lapsed : null;
  if (view.kind !== "pro" && !lapsed) {
    return (
      <p className="text-md text-ink-2" data-testid="billing-licence" data-licence="free">
        {view.kind === "checking" ? t("account.checking") : t(view.dropped === "expired" ? "account.freeExpired" : view.dropped === "invalid" ? "account.freeInvalid" : "manage.free")}
      </p>
    );
  }
  const plan = view.kind === "pro" ? view.plan : lapsed!.plan;
  const provider: Provider | null = view.kind === "pro" ? view.provider : lapsed!.provider;
  const email = view.kind === "pro" ? view.email : lapsed!.email;
  const status = view.kind === "pro" ? t(`account.${view.phase === "active" ? "pro" : view.phase}`, { plan: t(`plan.${view.plan}`), date: formatLicenseDate(view.date, locale) }) : t(`account.${accountMessageKey(view)}`);
  // Manage the subscription the licence – or the receipt kept with it – belongs to
  const manageStripe = provider === "stripe" || receipt?.provider === "stripe";
  const managePaypal = provider === "paypal" || receipt?.provider === "paypal";
  const openPortal = async () => {
    if (!client || !email) {
      setNote(t("pay.notConfigured"));
      return;
    }
    if (!receipt) {
      setNote(t("manage.needsRef"));
      return;
    }
    setBusy(true);
    setNote(null);
    // the reference proves the subscription is this buyer's; back to this pricing page (with the base path; the public
    // site's from the desktop app), as the checkouts come back
    const r = await client.portal(email, receipt.ref, pricingReturnUrl(siteBaseUrl(), locale));
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
    <div className="space-y-4" data-testid="billing-licence" data-licence={view.kind === "pro" ? "pro" : "lapsed"} data-licence-plan={plan} data-licence-provider={provider ?? ""}>
      <div className={cx("rounded-xl border bg-surface-1 p-5", view.kind === "pro" ? "border-accent-dim/50" : "border-line")}>
        <p className="text-md font-medium text-ink" aria-live="polite">
          {status}
        </p>
        {email && <p className="mt-1 text-sm text-ink-2">{t(view.kind === "pro" ? "manage.email" : "manage.lapsedEmail", { email })}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {manageStripe && (
            <button type="button" className={buttonClass({ variant: "secondary", size: "sm" })} onClick={() => void openPortal()} disabled={busy} data-testid="billing-manage">
              {busy ? t("manage.opening") : t("manage.stripe")}
            </button>
          )}
          {managePaypal && !manageStripe && (
            <a href={PAYPAL_SUBSCRIPTIONS_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })} data-testid="billing-manage">
              {t("manage.paypal")}
            </a>
          )}
          {(provider === "crypto" || provider === null) && !manageStripe && !managePaypal && (
            <a href="#plans" className={buttonClass({ variant: "secondary", size: "sm" })} data-testid="billing-manage">
              {t("manage.crypto")}
            </a>
          )}
          {view.kind === "pro" && (
            <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => void copyKey()} title={t("manage.copyHint")} data-testid="billing-copy-key">
              {copied ? t("manage.copied") : t("manage.copyKey")}
            </button>
          )}
          <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={remove} data-testid="billing-remove">
            {t("manage.remove")}
          </button>
        </div>
        {receipt && <ReceiptReference value={receipt.ref} hint={t("manage.referenceHint")} testId="billing-licence-ref" />}
        <p className="mt-3 text-xs leading-relaxed text-ink-3">{manageStripe ? t("manage.stripeHint") : managePaypal ? t("manage.paypalHint") : t("manage.cryptoHint")}</p>
        {note && (
          <p className="mt-2 text-sm text-danger" role="status" data-testid="billing-manage-note">
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
  const back = useCheckoutFrom();
  const knownEmail = entitlement.email ?? entitlement.lapsed?.email ?? null;
  useEffect(() => {
    if (knownEmail) setEmail((e) => e || knownEmail);
  }, [knownEmail]);
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
        {state.kind === "success" && back.from && (
          <a href={back.from} onClick={back.done} className={buttonClass({ variant: "primary", size: "sm" })} data-testid="billing-restore-studio">
            {t("claim.backToSetup")}
          </a>
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

type PasteState = { kind: "idle" } | { kind: "working" } | { kind: "success"; until: number } | { kind: "failed"; message: string };

/**
 * Paste a licence key: a key copied on another device ("Copy licence key") or taken into the desktop app goes in here and is
 * installed once it verifies. It works until its end date; Restore (email and receipt reference) also keeps it renewing.
 */
export function PasteKeyForm() {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const id = useId();
  const [key, setKey] = useState("");
  const [state, setState] = useState<PasteState>({ kind: "idle" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = key.trim();
    if (!token) {
      setState({ kind: "failed", message: t("paste.empty") });
      return;
    }
    setState({ kind: "working" });
    const installed = await getEntitlementStore().install(token);
    if (!installed.ok) {
      setState({ kind: "failed", message: licenseErrorText(t, installed.error) });
      return;
    }
    setKey("");
    setState({ kind: "success", until: installed.payload.exp * 1000 });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-10 max-w-[680px] space-y-3 border-t border-line pt-8" data-testid="billing-paste" data-paste-state={state.kind} noValidate>
      <h3 className="text-md font-medium text-ink">{t("paste.title")}</h3>
      <p className="text-sm text-ink-2">{t("paste.intro")}</p>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-key`} className="text-sm font-medium text-ink-2">
          {t("paste.label")}
        </label>
        <textarea
          id={`${id}-key`}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t("paste.placeholder")}
          className={cx(inputClass, "h-auto min-h-20 resize-y py-2 font-mono text-xs leading-relaxed break-all")}
          data-testid="billing-paste-key"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass({ variant: "secondary", size: "md" })} disabled={state.kind === "working"} data-testid="billing-paste-submit">
          {state.kind === "working" ? t("paste.working") : t("paste.submit")}
        </button>
        {state.kind === "success" && (
          <p className="flex items-center gap-2 text-sm text-ok" role="status">
            <IconCheck size={16} />
            {t("paste.success", { date: until(state.until, locale) })}
          </p>
        )}
        {state.kind === "failed" && (
          <p className="text-sm text-danger" role="status">
            {t("paste.failed", { message: state.message })}
          </p>
        )}
      </div>
    </form>
  );
}
