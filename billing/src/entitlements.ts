// What a paying customer is entitled to, and the pure maths that derives it.
//
// Nothing here is ONE record per e-mail that several webhooks rewrite: Workers KV has no
// transactions, and Stripe alone sends checkout.session.completed, invoice.paid and
// customer.subscription.updated for one purchase within a second, so a shared record loses whichever
// write lands first. Each fact lives under its own key instead (store.ts): a subscription's link to its
// buyer, its paid period, its state and its end, and every crypto payment's prepaid days. Every event
// writes only its own subscription's (or payment's) facts, and /license/claim, /license/restore and
// /portal/stripe derive the entitlement from all of an e-mail's facts here – so a card cancellation
// cannot wipe a prepaid crypto year and two subscriptions on one e-mail cannot clobber each other.
//
// Nothing here touches the network or storage, so the tests exercise the maths directly.

export type Plan = "monthly" | "yearly";
export type Provider = "stripe" | "paypal" | "crypto";
export type SubscriptionProvider = "stripe" | "paypal";

/** How a subscription or prepaid period stands. Informational: access follows the paid period alone. */
export type EntitlementStatus =
  | "active"
  | "cancel_at_period_end"
  | "canceled"
  | "suspended"
  | "expired";

export const DAY = 86400;
/** Days of grace a licence lasts past the paid period's end (its exp is the period's end plus these). */
export const GRACE_DAYS = 3;

/** Days a crypto plan prepays for. Crypto cannot renew itself, so each payment buys a fixed period. */
export function planDays(plan: Plan): number {
  return plan === "yearly" ? 365 : 30;
}

export function isPlan(value: unknown): value is Plan {
  return value === "monthly" || value === "yearly";
}

/** Lower-case and trim an e-mail so one address keys one set of facts however it was typed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// --- the stored facts ----------------------------------------------------------------------------

/** Who bought a subscription (checkout.session.completed / BILLING.SUBSCRIPTION.ACTIVATED, and the claim). */
export interface SubscriptionLink {
  email: string;
  plan?: Plan;
  /** Stripe's customer – the billing portal opens for it. */
  customerId?: string;
  /** The references besides the subscription id: the Stripe Checkout Session id, our PayPal order id. */
  refs: string[];
}

/** How far a subscription is paid (invoice.paid / PAYMENT.SALE.COMPLETED, and the claim). Only ever moves later. */
export interface SubscriptionPaid {
  email: string;
  /** Unix seconds the paid period runs until. */
  periodEnd: number;
  plan?: Plan;
}

/** A subscription's latest state (customer.subscription.updated, PayPal's cancel / suspend / expire). */
export interface SubscriptionState {
  status: EntitlementStatus;
  /** When the provider said so (its event time), so an older event never overwrites a newer state. */
  at: number;
}

/** A Stripe subscription that was deleted: its access ends here, whatever was paid. */
export interface SubscriptionEnded {
  at: number;
}

/** Everything known about one Stripe or PayPal subscription. */
export interface SubscriptionFacts {
  provider: SubscriptionProvider;
  id: string;
  link: SubscriptionLink | null;
  paid: SubscriptionPaid | null;
  state: SubscriptionState | null;
  ended: SubscriptionEnded | null;
}

/** One crypto payment's prepaid period (one per NOWPayments payment, however many statuses it reports). */
export interface CryptoGrant {
  email: string;
  orderId: string;
  /** NOWPayments' payment id ("" when the IPN carried none – the grant is then once per order). */
  paymentId: string;
  plan: Plan;
  days: number;
  /**
   * Where this period starts unless an earlier crypto period is still running then: the later of the
   * payment's time and the e-mail's subscriptions' paid end at that moment – a card plan that runs
   * out in 10 days is followed by the crypto year, not overlapped by it.
   */
  base: number;
  grantedAt: number;
}

export interface Facts {
  subscriptions: SubscriptionFacts[];
  grants: CryptoGrant[];
}

// --- the derived entitlement ---------------------------------------------------------------------

/** One source of paid time: a subscription, or the chain of crypto payments. */
export interface Source {
  provider: Provider;
  /** "stripe:<subscription id>", "paypal:<subscription id>" or "crypto". */
  key: string;
  subscriptionId?: string;
  customerId?: string;
  plan: Plan;
  /** Unix seconds this source is paid until (0: nothing paid yet). */
  periodEnd: number;
  status: EntitlementStatus;
  /** The references a buyer may restore with (subscription, session and order ids). */
  refs: string[];
}

/** What an e-mail is entitled to: the furthest paid period over all its sources. */
export interface Entitlement {
  email: string;
  /** The plan and provider of the source that runs furthest (what the licence states). */
  plan: Plan;
  provider: Provider;
  /** Unix seconds the furthest paid period runs until. The licence's exp is this plus the grace window. */
  periodEnd: number;
  status: EntitlementStatus;
  /** Every reference of every source. */
  refs: string[];
  sources: Source[];
}

/** Add a reference to a list without duplicating it. */
export function addRef(refs: string[], ref: string | undefined | null): void {
  if (ref && !refs.includes(ref)) refs.push(ref);
}

/** The e-mail a subscription belongs to: its link's (the purchase), else its paid fact's. */
export function subscriptionOwner(sub: SubscriptionFacts): string | null {
  const email = sub.link?.email ?? sub.paid?.email;
  return email ? normalizeEmail(email) : null;
}

/** A subscription as a source of paid time; null while nothing ties it to a buyer. */
export function subscriptionSource(sub: SubscriptionFacts): Source | null {
  if (!subscriptionOwner(sub)) return null;
  let periodEnd = sub.paid?.periodEnd ?? 0;
  if (sub.ended) periodEnd = Math.min(periodEnd, sub.ended.at);
  const refs: string[] = [];
  for (const ref of sub.link?.refs ?? []) addRef(refs, ref);
  addRef(refs, sub.id);
  return {
    provider: sub.provider,
    key: `${sub.provider}:${sub.id}`,
    subscriptionId: sub.id,
    customerId: sub.link?.customerId,
    plan: sub.paid?.plan ?? sub.link?.plan ?? "monthly",
    periodEnd,
    status: sub.ended ? "canceled" : (sub.state?.status ?? "active"),
    refs,
  };
}

/** The crypto grants in the order they stack: by grant time, then id (a stable order for equal times). */
function grantOrder(a: CryptoGrant, b: CryptoGrant): number {
  return a.grantedAt - b.grantedAt || (a.orderId + a.paymentId < b.orderId + b.paymentId ? -1 : 1);
}

/**
 * The crypto payments as one source: each period starts at the later of its base and the end of the
 * crypto periods before it, so paying again before a period runs out extends it rather than
 * restarting it, and two payments recorded at the same moment both count.
 */
export function cryptoSource(grants: CryptoGrant[]): Source | null {
  if (grants.length === 0) return null;
  const sorted = [...grants].sort(grantOrder);
  let end = 0;
  const refs: string[] = [];
  for (const g of sorted) {
    end = Math.max(end, g.base) + g.days * DAY;
    addRef(refs, g.orderId);
  }
  return { provider: "crypto", key: "crypto", plan: sorted[sorted.length - 1].plan, periodEnd: end, status: "active", refs };
}

/** How far the e-mail's subscriptions are paid (where a crypto payment made now starts). */
export function subscriptionsPaidEnd(facts: Facts): number {
  let end = 0;
  for (const sub of facts.subscriptions) end = Math.max(end, subscriptionSource(sub)?.periodEnd ?? 0);
  return end;
}

/** Where a crypto payment made at `now` starts: after whatever the e-mail's subscriptions have paid for. */
export function cryptoBase(facts: Facts, now: number): number {
  return Math.max(now, subscriptionsPaidEnd(facts));
}

/**
 * The new period end after a crypto payment for `plan`, stacked on `currentPeriodEnd`: start from
 * whichever is later, now or the current end, and add the plan's days.
 */
export function cryptoPeriodEnd(currentPeriodEnd: number | undefined, plan: Plan, now: number): number {
  return Math.max(now, currentPeriodEnd ?? 0) + planDays(plan) * DAY;
}

const PROVIDER_RANK: Record<Provider, number> = { stripe: 0, paypal: 1, crypto: 2 };

/** Every source of an e-mail's facts (only the subscriptions that belong to it). */
export function entitlementSources(email: string, facts: Facts): Source[] {
  const owner = normalizeEmail(email);
  const sources: Source[] = [];
  for (const sub of facts.subscriptions) {
    if (subscriptionOwner(sub) !== owner) continue;
    const source = subscriptionSource(sub);
    if (source) sources.push(source);
  }
  const crypto = cryptoSource(facts.grants.filter((g) => normalizeEmail(g.email) === owner));
  if (crypto) sources.push(crypto);
  return sources;
}

/** The entitlement an e-mail's facts add up to; null when it has none. */
export function deriveEntitlement(email: string, facts: Facts): Entitlement | null {
  const sources = entitlementSources(email, facts);
  if (sources.length === 0) return null;
  const primary = [...sources].sort((a, b) => b.periodEnd - a.periodEnd || PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider])[0];
  const refs: string[] = [];
  for (const s of sources) for (const ref of s.refs) addRef(refs, ref);
  return {
    email: normalizeEmail(email),
    plan: primary.plan,
    provider: primary.provider,
    periodEnd: primary.periodEnd,
    status: primary.status,
    refs,
    sources,
  };
}

/**
 * Whether an entitlement still has paid time a licence can carry: its period (plus the grace window)
 * reaches past now. A lapsed one is refused (not_active) rather than handed an already-expired token.
 */
export function hasCurrentPeriod(entitlement: Entitlement | null | undefined, now: number): entitlement is Entitlement {
  return !!entitlement && entitlement.periodEnd > 0 && entitlement.periodEnd + GRACE_DAYS * DAY > now;
}
