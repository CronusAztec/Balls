import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { allProvidersEnv, jsonResponse, makeHarness, makeRequest, NOW, stubFetch } from "./helpers";

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

  it("stores the entitlement on BILLING.SUBSCRIPTION.ACTIVATED", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    mockPaypal(true);
    const nextBilling = NOW + 30 * DAY;
    const res = await postWebhook(env, {
      id: "ev-act",
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: {
        id: "I-SUB1",
        plan_id: "P-MONTHLY",
        custom_id: "order-1",
        subscriber: { email_address: "Buyer@Example.com" },
        billing_info: { next_billing_time: new Date(nextBilling * 1000).toISOString() },
      },
    });
    expect(res.status).toBe(200);
    const ent = await repo.getUser("buyer@example.com");
    expect(ent!.plan).toBe("monthly");
    expect(ent!.provider).toBe("paypal");
    expect(ent!.subscriptionId).toBe("I-SUB1");
    expect(ent!.periodEnd).toBe(nextBilling);
    expect(await repo.getRefEmail("paypal", "I-SUB1")).toBe("buyer@example.com");
    expect(await repo.getRefEmail("paypal", "order-1")).toBe("buyer@example.com");
  });

  it("extends the period on PAYMENT.SALE.COMPLETED", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putRef("paypal", "I-SUB1", "buyer@example.com");
    const nextBilling = NOW + 60 * DAY;
    mockPaypal(true, (url) => {
      if (url.includes("/v1/billing/subscriptions/I-SUB1")) {
        return jsonResponse({ billing_info: { next_billing_time: new Date(nextBilling * 1000).toISOString() } });
      }
      return undefined;
    });
    const res = await postWebhook(env, {
      id: "ev-sale",
      event_type: "PAYMENT.SALE.COMPLETED",
      resource: { billing_agreement_id: "I-SUB1" },
    });
    expect(res.status).toBe(200);
    expect((await repo.getUser("buyer@example.com"))!.periodEnd).toBe(nextBilling);
  });

  it("keeps the period on cancellation", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putRef("paypal", "I-SUB1", "buyer@example.com");
    const periodEnd = NOW + 15 * DAY;
    await repo.putUser({
      email: "buyer@example.com",
      plan: "monthly",
      provider: "paypal",
      periodEnd,
      status: "active",
      subscriptionId: "I-SUB1",
      refs: ["I-SUB1"],
      updatedAt: NOW,
    });
    mockPaypal(true);
    const res = await postWebhook(env, {
      id: "ev-cancel",
      event_type: "BILLING.SUBSCRIPTION.CANCELLED",
      resource: { id: "I-SUB1" },
    });
    expect(res.status).toBe(200);
    const ent = await repo.getUser("buyer@example.com");
    expect(ent!.status).toBe("canceled");
    expect(ent!.periodEnd).toBe(periodEnd); // unchanged
  });

  it("is idempotent per event id", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    mockPaypal(true);
    const event = (nextBilling: number) => ({
      id: "ev-dup",
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: {
        id: "I-SUB1",
        plan_id: "P-MONTHLY",
        subscriber: { email_address: "buyer@example.com" },
        billing_info: { next_billing_time: new Date(nextBilling * 1000).toISOString() },
      },
    });
    await postWebhook(env, event(NOW + 30 * DAY));
    await postWebhook(env, event(NOW + 90 * DAY)); // same id -> ignored
    expect((await repo.getUser("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
  });
});
