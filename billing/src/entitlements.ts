// What a paying customer is entitled to, and the pure maths that moves the paid period around.
//
// An entitlement is the single source of truth per e-mail: the webhooks write it, and /license/claim
// and /license/restore read it to mint a token. Nothing here touches the network or storage, so the
// tests exercise the maths directly.

export type Plan = "monthly" | "yearly";
export type Provider = "stripe" | "paypal" | "crypto";

/** The status a subscription or prepaid period is in. `active` is the only one that keeps selling. */
export type EntitlementStatus =
  | "active"
  | "cancel_at_period_end"
  | "canceled"
  | "suspended"
  | "expired";

export interface Entitlement {
  email: string;
  plan: Plan;
  provider: Provider;
  /** Unix seconds the paid period runs until. The licence's exp is this plus the grace window. */
  periodEnd: number;
  status: EntitlementStatus;
  customerId?: string;
  subscriptionId?: string;
  /** Every provider reference (session / subscription / order id) that fed this record. */
  refs: string[];
  updatedAt: number;
}

const DAY = 86400;

/** Days a crypto plan prepays for. Crypto cannot renew itself, so each payment buys a fixed period. */
export function planDays(plan: Plan): number {
  return plan === "yearly" ? 365 : 30;
}

/** Lower-case and trim an e-mail so one address keys one record however it was typed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The new period end after a crypto payment for `plan`. A renewal stacks on top of the current
 * period: start from whichever is later, now or the existing end, and add the plan's days. So paying
 * again before the period runs out extends it rather than restarting it.
 */
export function cryptoPeriodEnd(
  currentPeriodEnd: number | undefined,
  plan: Plan,
  now: number,
): number {
  const base = Math.max(now, currentPeriodEnd ?? 0);
  return base + planDays(plan) * DAY;
}

/** A fresh entitlement record. */
export function newEntitlement(
  email: string,
  plan: Plan,
  provider: Provider,
  now: number,
): Entitlement {
  return {
    email: normalizeEmail(email),
    plan,
    provider,
    periodEnd: 0,
    status: "active",
    refs: [],
    updatedAt: now,
  };
}

/** Add a reference to a record without duplicating it. */
export function addRef(entitlement: Entitlement, ref: string | undefined | null): void {
  if (ref && !entitlement.refs.includes(ref)) entitlement.refs.push(ref);
}

/**
 * Whether a token should be issued for this record: it needs a real paid period. The status only
 * records how the period will end (a `cancel_at_period_end` record still entitles until its period
 * runs out — the customer paid for it), while the grace window and the final expiry live entirely in
 * the licence's exp, so a lapsed period just yields a short-lived (soon or already expired) token
 * that the site stops honouring on its own.
 */
export function isEntitled(entitlement: Entitlement | null | undefined): entitlement is Entitlement {
  return !!entitlement && entitlement.periodEnd > 0;
}
