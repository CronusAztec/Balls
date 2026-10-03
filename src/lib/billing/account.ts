import { BillingClient } from "./api";
import { CLOCK_SKEW_SEC, DAY_MS, GRACE_DAYS, LAPSED_RETRY_MS, LICENSE_REF_STORAGE_KEY, LICENSE_RENEWAL_STORAGE_KEY, RENEWAL_NOTICE_DAYS, RENEWAL_RETRY_MS, isProvider, type Plan, type Provider } from "./config";
import type { Entitlement, EntitlementStore, LapsedLicence } from "./entitlement";
import { decodeLicense } from "./license";

/*
 * --- paywall-gate --- What the account row (the studio) and the pricing page say about this browser's licence, as pure
 * functions of the entitlement and the clock: "Free – unlock video creation", or "Pro – <plan> until <date>"; once the
 * licence's exp is within RENEWAL_NOTICE_DAYS, "renews on <date>" for a subscription (Stripe, PayPal) and "ends on <date>"
 * for a prepaid crypto period; in the grace days after the paid period, "payment pending, works until <exp>"; for a licence
 * that ran out, "has ended" – or "Renewing your licence…" while the page asks for the renewed one. The dates are the paid
 * period's end (exp minus the grace days) – what the buyer paid for.
 *
 * It also renews a subscription's licence quietly: a licence carries the paid period's end, so after Stripe or PayPal has
 * renewed the subscription the browser needs a newer one. Near the end (at most every RENEWAL_RETRY_MS), and after the
 * licence has run out (at most every LAPSED_RETRY_MS – a subscriber who did not open the site in the grace days is renewed
 * on the next visit, not told to pay again), the page asks the backend's /license/restore with the licence's email and the
 * receipt reference it was claimed with. Only the backend's "not_active" or "unknown_reference" forgets that receipt.
 */

export type AccountPhase = "active" | "renews" | "ends" | "grace";

export type AccountView =
  | { kind: "checking" }
  | { kind: "free"; dropped: "expired" | "invalid" | null; lapsed: LapsedLicence | null; renewing: boolean }
  | { kind: "pro"; plan: Plan; provider: Provider | null; email: string | null; phase: AccountPhase; /** ms */ date: number };

/** The paid period's end of a licence (ms): its exp minus the grace days. */
export const paidUntilMs = (expiresAtMs: number) => expiresAtMs - GRACE_DAYS * DAY_MS;

/** Stripe and PayPal renew by themselves; a crypto payment buys a prepaid period. */
export const renewsByItself = (provider: Provider | null | undefined) => provider === "stripe" || provider === "paypal";

export function accountView(e: Entitlement, now: number): AccountView {
  if (e.status === "checking") return { kind: "checking" };
  if (e.status !== "pro" || !e.plan || e.expiresAt === null) return { kind: "free", dropped: e.dropped, lapsed: e.lapsed ?? null, renewing: !!e.renewing };
  if (now > e.expiresAt + CLOCK_SKEW_SEC * 1000) return { kind: "free", dropped: "expired", lapsed: null, renewing: !!e.renewing };
  const periodEnd = paidUntilMs(e.expiresAt);
  const base = { kind: "pro" as const, plan: e.plan, provider: e.provider, email: e.email };
  if (now >= periodEnd) return { ...base, phase: "grace", date: e.expiresAt };
  if (e.expiresAt - now <= RENEWAL_NOTICE_DAYS * DAY_MS) return { ...base, phase: renewsByItself(e.provider) ? "renews" : "ends", date: periodEnd };
  return { ...base, phase: "active", date: periodEnd };
}

/** The `Billing.account.*` message of a view (with its plan and date to fill in). */
export function accountMessageKey(view: AccountView): "checking" | "free" | "freeExpired" | "freeInvalid" | "renewing" | "pro" | "renews" | "ends" | "grace" {
  if (view.kind === "checking") return "checking";
  if (view.kind === "free") return view.renewing ? "renewing" : view.dropped === "expired" ? "freeExpired" : view.dropped === "invalid" ? "freeInvalid" : "free";
  return view.phase === "active" ? "pro" : view.phase;
}

/** A licence date in the page's language ("Oct 3, 2026" / "3 paź 2026" / "3 oct 2026"). */
export function formatLicenseDate(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** PayPal's page where a buyer manages (and cancels) automatic payments. */
export const PAYPAL_SUBSCRIPTIONS_URL = "https://www.paypal.com/myaccount/autopay/";

/* ------------------------------------------------------------------ the receipt reference and quiet renewals */

type Storage3 = Pick<Storage, "getItem" | "setItem">;
export type Receipt = { provider: Provider; ref: string };

/** The receipt reference the stored licence was claimed or restored with, if this browser kept it. */
export function storedReceipt(storage: Pick<Storage, "getItem"> | null): Receipt | null {
  try {
    const raw = storage?.getItem(LICENSE_REF_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && isProvider((value as { provider?: unknown }).provider) && typeof (value as { ref?: unknown }).ref === "string") {
      return { provider: (value as { provider: Provider }).provider, ref: (value as { ref: string }).ref };
    }
  } catch {
    /* unreadable: none */
  }
  return null;
}

/** Whether a licence ran out that its subscription may have renewed since (Free, dropped as expired, a Stripe or PayPal one). */
export function isRenewableLapse(e: Entitlement): e is Entitlement & { lapsed: LapsedLicence } {
  return e.status === "free" && e.dropped === "expired" && !!e.lapsed && renewsByItself(e.lapsed.provider);
}

/**
 * Whether to ask the backend for a newer licence now: a subscription's licence near its end, or one that ran out, a
 * reference to ask with, not asked lately.
 */
export function shouldRenew(e: Entitlement, receipt: Receipt | null, now: number, lastAttempt: number | null): boolean {
  if (!receipt) return false;
  const since = (ms: number) => lastAttempt === null || !(now - lastAttempt < ms);
  if (isRenewableLapse(e)) return since(LAPSED_RETRY_MS);
  if (e.status !== "pro" || e.expiresAt === null || !e.email || !renewsByItself(e.provider)) return false;
  if (e.expiresAt - now > RENEWAL_NOTICE_DAYS * DAY_MS) return false;
  return since(RENEWAL_RETRY_MS);
}

export type RenewalOutcome = "renewed" | "unchanged" | "skipped" | "failed" | "ended";

/**
 * Asks /license/restore for a newer licence of a renewing subscription and installs it when it reaches further than the one
 * stored – or, for a licence that ran out, when it is valid at all. Quiet: a failure (the network, the server) leaves
 * everything as it is and asks again later; "not_active" or "unknown_reference" ends the subscription's renewals here
 * (its receipt and the lapsed licence are forgotten).
 */
export async function renewQuietly(store: EntitlementStore, client: BillingClient, storage: Storage3 | null, now: number): Promise<RenewalOutcome> {
  const e = store.getSnapshot();
  const receipt = storedReceipt(storage);
  let last: number | null = null;
  try {
    const raw = storage?.getItem(LICENSE_RENEWAL_STORAGE_KEY);
    last = raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
  } catch {
    last = null;
  }
  const lapsed = isRenewableLapse(e);
  const email = lapsed ? e.lapsed?.email : e.email;
  if (!shouldRenew(e, receipt, now, last) || !receipt || !email) return "skipped";
  try {
    storage?.setItem(LICENSE_RENEWAL_STORAGE_KEY, String(now));
  } catch {
    /* storage blocked: asks again next time */
  }
  if (lapsed) store.setRenewing(true);
  try {
    const answer = await client.restore(email, receipt.ref);
    if (!answer.ok) return "failed";
    if (answer.value.kind === "error") {
      if (answer.value.error === "not_active" || answer.value.error === "unknown_reference") {
        store.forgetReceipt();
        return "ended";
      }
      return "failed";
    }
    if (answer.value.kind !== "token") return "failed";
    const next = decodeLicense(answer.value.token)?.payload;
    if (!next) return "failed";
    if (!lapsed && e.expiresAt !== null && next.exp * 1000 <= e.expiresAt) return "unchanged";
    const installed = await store.install(answer.value.token, receipt);
    if (installed.ok) return "renewed";
    return installed.error === "expired" ? "unchanged" : "failed";
  } finally {
    if (lapsed) store.setRenewing(false);
  }
}
