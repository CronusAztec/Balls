import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import type { Source } from "../src/entitlements";
import { allProvidersEnv, jsonRequest, jsonResponse, makeHarness, makeRequest, NOW, seedCrypto, seedPaypal, stubFetch } from "./helpers";

const DAY = 86400;

afterEach(() => vi.unstubAllGlobals());

const TX_HEADERS = {
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-time": "2026-01-01T00:00:00Z",
  "paypal-transmission-sig": "sig",
  "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
  "paypal-auth-algo": "SHA256withRSA",
  "content-type": "application/json",
};

const iso = (unix: number) => new Date(unix * 1000).toISOString();

/** Mock the PayPal token + verify endpoints; `verifies` controls the verification result. */
function mockPaypal(verifies: boolean, extra?: (url: string) => Response | undefined) {
  return stubFetch((url) => {
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok" });
    if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
      return jsonResponse({ verification_status: verifies ? "SUCCESS" : "FAILURE" });
    }
    const handled = extra?.(url);
    if (handled) return handled;
    throw new Error(`unexpected fetch ${url}`);
  });
}

function postWebhook(env: ReturnType<typeof makeHarness>["env"], event: unknown, headers: Record<string, string> = TX_HEADERS) {
  const req = makeRequest("POST", "/webhooks/paypal", { body: JSON.stringify(event), headers });
  return handleRequest(req, env, { now: NOW });
}

const activated = (nextBilling: number, id = "ev-act", over: Record<string, unknown> = {}) => ({
  id,
  event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
  resource: {
    id: "I-SUB1",
    status: "ACTIVE",
    plan_id: "P-MONTHLY",
    custom_id: "order-1",
    subscriber: { email_address: "Buyer@Example.com" },
    billing_info: { next_billing_time: iso(nextBilling), failed_payments_count: 0 },
    ...over,
  },
});

describe("paypal webhook", () => {
  it("rejects when PayPal does not verify the signature", async () => {
    const { env } = makeHarness(allProvidersEnv());
    mockPaypal(false);
    const res = await postWebhook(env, { id: "ev1", event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource: {} });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_signature");
  });

  it("rejects when the transmission headers are missing", async () => {
    const { env } = makeHarness(allProvidersEnv());
    mockPaypal(true);
    const res = await postWebhook(env, { id: "ev1", event_type: "X", resource: {} }, { "content-type": "application/json" });
    expect(res.status).toBe(400);
  });

  it("links the subscription and records its paid period on BILLING.SUBSCRIPTION.ACTIVATED", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    mockPaypal(true);
    const nextBilling = NOW + 30 * DAY;
    const res = await postWebhook(env, activated(nextBilling));
    expect(res.status).toBe(200);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent).toMatchObject({ plan: "monthly", provider: "paypal", periodEnd: nextBilling });
    expect(ent!.sources[0].subscriptionId).toBe("I-SUB1");
    expect(ent!.refs).toEqual(expect.arrayContaining(["I-SUB1", "order-1"]));
  });

  it("does not count a period while a payment is failing", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    mockPaypal(true);
    await postWebhook(env, activated(NOW + 30 * DAY, "ev-f", { billing_info: { next_billing_time: iso(NOW + 30 * DAY), failed_payments_count: 1 } }));
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(0);
  });

  it("extends the period on PAYMENT.SALE.COMPLETED", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedPaypal(repo, { periodEnd: NOW + 30 * DAY });
    const nextBilling = NOW + 60 * DAY;
    mockPaypal(true, (url) => {
      if (url.includes("/v1/billing/subscriptions/I-SUB1")) {
        return jsonResponse({ id: "I-SUB1", status: "ACTIVE", plan_id: "P-MONTHLY", billing_info: { next_billing_time: iso(nextBilling) } });
      }
      return undefined;
    });
    const res = await postWebhook(env, { id: "ev-sale", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-SUB1" } });
    expect(res.status).toBe(200);
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(nextBilling);
  });

  it("does not reset a prepaid crypto period, and keeps two subscriptions apart", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedPaypal(repo, { periodEnd: NOW + 30 * DAY });
    await seedPaypal(repo, { sub: "I-SUB2", order: "order-2", plan: "yearly", periodEnd: NOW + 300 * DAY });
    await seedCrypto(repo, { order: "o-c", payment: "pc", plan: "yearly" }); // granted at NOW: NOW + 365 days
    mockPaypal(true, (url) => {
      if (url.includes("/v1/billing/subscriptions/I-SUB1")) {
        return jsonResponse({ id: "I-SUB1", status: "ACTIVE", plan_id: "P-MONTHLY", billing_info: { next_billing_time: iso(NOW + 60 * DAY) } });
      }
      return undefined;
    });
    await postWebhook(env, { id: "ev-sale2", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-SUB1" } });
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent).toMatchObject({ periodEnd: NOW + 365 * DAY, provider: "crypto" });
    expect(ent!.sources.find((s: Source) => s.subscriptionId === "I-SUB1")!.periodEnd).toBe(NOW + 60 * DAY);
    expect(ent!.sources.find((s: Source) => s.subscriptionId === "I-SUB2")!.periodEnd).toBe(NOW + 300 * DAY);
  });

  it("links a subscription whose first sale beats its activation", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    mockPaypal(true, (url) =>
      url.includes("/v1/billing/subscriptions/I-SUB3")
        ? jsonResponse({ id: "I-SUB3", status: "ACTIVE", plan_id: "P-YEARLY", custom_id: "order-3", subscriber: { email_address: "early@example.com" }, billing_info: { next_billing_time: iso(NOW + 365 * DAY) } })
        : undefined,
    );
    await postWebhook(env, { id: "ev-sale3", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-SUB3" } });
    const ent = await repo.entitlementFor("early@example.com");
    expect(ent).toMatchObject({ periodEnd: NOW + 365 * DAY, plan: "yearly", provider: "paypal" });
    expect(ent!.refs).toEqual(expect.arrayContaining(["I-SUB3", "order-3"]));
  });

  it("keeps the period on cancellation", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    const periodEnd = NOW + 15 * DAY;
    await seedPaypal(repo, { periodEnd });
    mockPaypal(true);
    const res = await postWebhook(env, { id: "ev-cancel", event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-SUB1" } });
    expect(res.status).toBe(200);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent!.status).toBe("canceled");
    expect(ent!.periodEnd).toBe(periodEnd); // unchanged
  });

  it("is idempotent per event id", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    mockPaypal(true);
    await postWebhook(env, activated(NOW + 30 * DAY, "ev-dup"));
    await postWebhook(env, activated(NOW + 90 * DAY, "ev-dup")); // same id -> ignored
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
  });
});

// --- go-live-kit --- a refunded or reversed sale ends its subscription's access
describe("paypal refunds and reversals", () => {
  const restore = (env: ReturnType<typeof makeHarness>["env"], email: string, ref: string) =>
    handleRequest(jsonRequest("/license/restore", { email, ref }), env, { now: NOW });

  it("ends access on PAYMENT.SALE.REFUNDED / REVERSED, looking the sale up when the event names none", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedPaypal(repo, { sub: "I-SUB1", order: "order-1", periodEnd: NOW + 30 * DAY });
    await seedPaypal(repo, { email: "two@example.com", sub: "I-SUB2", order: "order-2", plan: "yearly", periodEnd: NOW + 300 * DAY });
    await seedCrypto(repo, { email: "crypto@example.com", order: "o-c", payment: "pc" });
    const saleLookups: string[] = [];
    mockPaypal(true, (url) => {
      const m = /\/v1\/payments\/sale\/([^/?]+)/.exec(url);
      if (!m) return undefined;
      saleLookups.push(m[1]);
      if (m[1] === "SALE-1") return jsonResponse({ id: "SALE-1", billing_agreement_id: "I-SUB1", amount: { total: "10.00", currency: "USD" } });
      return new Response("{}", { status: 404 });
    });
    // a partial refund of the first sale: nothing changes
    await postWebhook(env, { id: "ev-pr", event_type: "PAYMENT.SALE.REFUNDED", create_time: iso(NOW), resource: { id: "REF-0", sale_id: "SALE-1", amount: { total: "4.00", currency: "USD" } } });
    expect((await restore(env, "buyer@example.com", "order-1")).status).toBe(200);
    // the full refund: the refund names its sale, the sale names the subscription
    const res = await postWebhook(env, { id: "ev-ref", event_type: "PAYMENT.SALE.REFUNDED", create_time: iso(NOW), resource: { id: "REF-1", sale_id: "SALE-1", amount: { total: "10.00", currency: "USD" } } });
    expect(res.status).toBe(200);
    expect(saleLookups).toContain("SALE-1");
    const refused = await restore(env, "buyer@example.com", "order-1");
    expect(refused.status).toBe(402);
    expect((await jsonOf(refused)).error).toBe("not_active");
    // a reversal (a chargeback) names its subscription itself
    await postWebhook(env, { id: "ev-rev", event_type: "PAYMENT.SALE.REVERSED", create_time: iso(NOW), resource: { id: "SALE-2", billing_agreement_id: "I-SUB2", amount: { total: "79.00", currency: "USD" } } });
    expect((await restore(env, "two@example.com", "order-2")).status).toBe(402);
    expect((await repo.entitlementFor("two@example.com"))!.status).toBe("canceled");
    // another buyer's crypto period is untouched
    expect(await repo.entitlementFor("crypto@example.com")).toMatchObject({ provider: "crypto", periodEnd: NOW + 30 * DAY });
  });

  it("ignores a refund it cannot place (unknown sale, a subscription that is not ours)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedPaypal(repo, { periodEnd: NOW + 30 * DAY });
    mockPaypal(true, (url) => (url.includes("/v1/payments/sale/") ? new Response("{}", { status: 404 }) : undefined));
    expect((await postWebhook(env, { id: "ev-u1", event_type: "PAYMENT.SALE.REFUNDED", resource: { id: "REF-9", sale_id: "SALE-9", amount: { total: "10.00" } } })).status).toBe(200);
    expect((await postWebhook(env, { id: "ev-u2", event_type: "PAYMENT.SALE.REVERSED", resource: { id: "SALE-8", billing_agreement_id: "I-NOT-OURS" } })).status).toBe(200);
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
  });
});
