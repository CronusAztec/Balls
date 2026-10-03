import { describe, expect, it } from "vitest";
import {
  addRef,
  cryptoBase,
  cryptoPeriodEnd,
  cryptoSource,
  deriveEntitlement,
  hasCurrentPeriod,
  normalizeEmail,
  planDays,
  subscriptionSource,
} from "../src/entitlements";
import type { CryptoGrant, Facts, SubscriptionFacts } from "../src/entitlements";

const DAY = 86400;
const NOW = 1767225600;

const stripeSub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  provider: "stripe",
  id: "sub_1",
  link: { email: "a@b.com", plan: "monthly", customerId: "cus_1", refs: ["cs_1"] },
  paid: { email: "a@b.com", periodEnd: NOW + 10 * DAY, plan: "monthly" },
  state: null,
  ended: null,
  ...over,
});
const grant = (over: Partial<CryptoGrant> = {}): CryptoGrant => ({
  email: "a@b.com",
  orderId: "o1",
  paymentId: "p1",
  plan: "monthly",
  days: 30,
  base: NOW,
  grantedAt: NOW,
  ...over,
});

describe("entitlement maths", () => {
  it("normalises e-mail", () => {
    expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("knows the prepaid days of each plan", () => {
    expect(planDays("monthly")).toBe(30);
    expect(planDays("yearly")).toBe(365);
  });

  it("stacks a crypto period on an unexpired one and restarts after a lapsed one", () => {
    expect(cryptoPeriodEnd(undefined, "monthly", NOW)).toBe(NOW + 30 * DAY);
    expect(cryptoPeriodEnd(NOW - 10 * DAY, "monthly", NOW)).toBe(NOW + 30 * DAY);
    expect(cryptoPeriodEnd(NOW + 10 * DAY, "yearly", NOW)).toBe(NOW + 375 * DAY);
  });

  it("chains crypto grants: each starts at the later of its base and the previous end, so simultaneous ones both count", () => {
    expect(cryptoSource([])).toBeNull();
    expect(cryptoSource([grant(), grant({ orderId: "o2", paymentId: "p2" })])!.periodEnd).toBe(NOW + 60 * DAY);
    // a payment 40 days after a lapsed month starts afresh
    expect(cryptoSource([grant(), grant({ orderId: "o2", paymentId: "p2", base: NOW + 40 * DAY, grantedAt: NOW + 40 * DAY })])!.periodEnd).toBe(NOW + 70 * DAY);
    // the order of the list does not matter
    const a = grant({ grantedAt: NOW + 1 });
    const b = grant({ orderId: "o2", paymentId: "p2" });
    expect(cryptoSource([a, b])!.periodEnd).toBe(cryptoSource([b, a])!.periodEnd);
    expect(cryptoSource([grant({ plan: "yearly", days: 365 })])!.refs).toEqual(["o1"]);
  });

  it("a subscription is paid until its paid fact, cut short where Stripe deleted it", () => {
    expect(subscriptionSource(stripeSub())).toMatchObject({ provider: "stripe", periodEnd: NOW + 10 * DAY, customerId: "cus_1", refs: ["cs_1", "sub_1"], status: "active" });
    expect(subscriptionSource(stripeSub({ ended: { at: NOW } }))).toMatchObject({ periodEnd: NOW, status: "canceled" });
    expect(subscriptionSource(stripeSub({ paid: null }))!.periodEnd).toBe(0);
    expect(subscriptionSource(stripeSub({ state: { status: "cancel_at_period_end", at: NOW } }))!.status).toBe("cancel_at_period_end");
    expect(subscriptionSource(stripeSub({ link: null, paid: null }))).toBeNull(); // nothing ties it to a buyer
  });

  it("derives the furthest period over every source, with that source's plan and provider", () => {
    const facts: Facts = {
      subscriptions: [stripeSub(), stripeSub({ provider: "paypal", id: "I-1", link: { email: "a@b.com", plan: "yearly", refs: ["ord"] }, paid: { email: "a@b.com", periodEnd: NOW + 200 * DAY } })],
      grants: [grant()],
    };
    const ent = deriveEntitlement("A@B.com", facts)!;
    expect(ent).toMatchObject({ email: "a@b.com", provider: "paypal", plan: "yearly", periodEnd: NOW + 200 * DAY });
    expect(ent.refs).toEqual(expect.arrayContaining(["cs_1", "sub_1", "I-1", "ord", "o1"]));
    expect(ent.sources).toHaveLength(3);
    expect(deriveEntitlement("a@b.com", { subscriptions: [], grants: [] })).toBeNull();
    // a subscription that belongs to another e-mail (indexed under this one by an old invoice) is not counted
    const foreign = stripeSub({ id: "sub_x", link: { email: "other@b.com", refs: [] }, paid: { email: "a@b.com", periodEnd: NOW + 900 * DAY } });
    expect(deriveEntitlement("a@b.com", { subscriptions: [foreign], grants: [] })).toBeNull();
  });

  it("starts a crypto payment after the subscriptions' paid end", () => {
    expect(cryptoBase({ subscriptions: [stripeSub()], grants: [] }, NOW)).toBe(NOW + 10 * DAY);
    expect(cryptoBase({ subscriptions: [stripeSub({ ended: { at: NOW - DAY } })], grants: [] }, NOW)).toBe(NOW);
  });

  it("has a current period while the paid end plus the grace days lies ahead", () => {
    const ent = deriveEntitlement("a@b.com", { subscriptions: [stripeSub()], grants: [] })!;
    expect(hasCurrentPeriod(ent, NOW)).toBe(true);
    expect(hasCurrentPeriod(ent, NOW + 12 * DAY)).toBe(true); // in the grace days
    expect(hasCurrentPeriod(ent, NOW + 13 * DAY + 1)).toBe(false);
    expect(hasCurrentPeriod({ ...ent, periodEnd: 0 }, NOW)).toBe(false);
    expect(hasCurrentPeriod(null, NOW)).toBe(false);
  });

  it("adds refs without duplicating", () => {
    const refs: string[] = [];
    addRef(refs, "r1");
    addRef(refs, "r1");
    addRef(refs, "r2");
    addRef(refs, undefined);
    expect(refs).toEqual(["r1", "r2"]);
  });
});
