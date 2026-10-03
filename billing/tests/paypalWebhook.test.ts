import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import type { Source } from "../src/entitlements";
import { allProvidersEnv, jsonResponse, makeHarness, makeRequest, NOW, seedCrypto, seedPaypal, stubFetch } from "./helpers";

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
