import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { verifyLicense } from "../src/license";
import type { Entitlement } from "../src/entitlements";
import {
  allProvidersEnv,
  jsonRequest,
  jsonResponse,
  makeHarness,
  NOW,
  stubFetch,
  TEST_PUBLIC_SPKI,
} from "./helpers";

const DAY = 86400;

afterEach(() => vi.unstubAllGlobals());

function activeEnt(provider: Entitlement["provider"], overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    email: "buyer@example.com",
    plan: "monthly",
    provider,
    periodEnd: NOW + 30 * DAY,
    status: "active",
    refs: [],
    updatedAt: NOW,
    ...overrides,
  };
}

async function claim(env: ReturnType<typeof makeHarness>["env"], provider: string, ref: string) {
  return handleRequest(jsonRequest("/license/claim", { provider, ref }), env, { now: NOW });
}

describe("claim – stripe", () => {
  it("issues a token for a paid, active session with a stored entitlement", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser(activeEnt("stripe"));
    stubFetch((url) => {
      if (url.includes("/v1/checkout/sessions/")) {
        return jsonResponse({
          id: "cs_1",
          payment_status: "paid",
          status: "complete",
          customer_details: { email: "buyer@example.com" },
          subscription: { status: "active" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await claim(env, "stripe", "cs_1");
    expect(res.status).toBe(200);
    const token = (await jsonOf(res)).token as string;
    const payload = await verifyLicense(TEST_PUBLIC_SPKI, token);
    expect(payload!.sub).toBe("buyer@example.com");
    expect(payload!.provider).toBe("stripe");
  });

  it("is pending when the webhook has not stored the entitlement yet", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() =>
      jsonResponse({
        payment_status: "paid",
        status: "complete",
        customer_details: { email: "buyer@example.com" },
        subscription: { status: "active" },
      }),
    );
    const res = await claim(env, "stripe", "cs_1");
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).pending).toBe(true);
  });

  it("is unknown_reference when Stripe has no such session", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => new Response("", { status: 404 }));
    const res = await claim(env, "stripe", "cs_missing");
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });

  it("is not_paid for an expired checkout", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => jsonResponse({ payment_status: "unpaid", status: "expired" }));
    const res = await claim(env, "stripe", "cs_1");
    expect(res.status).toBe(402);
    expect((await jsonOf(res)).error).toBe("not_paid");
  });
});

describe("claim – paypal", () => {
  it("issues a token for an ACTIVE subscription with a stored entitlement", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser(activeEnt("paypal", { subscriptionId: "I-SUB1" }));
    await repo.putPaypalOrder("order-1", { subscriptionId: "I-SUB1" });
    stubFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok" });
      if (url.includes("/v1/billing/subscriptions/I-SUB1")) {
        return jsonResponse({ status: "ACTIVE", subscriber: { email_address: "buyer@example.com" } });
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await claim(env, "paypal", "order-1");
    expect(res.status).toBe(200);
    expect(typeof (await jsonOf(res)).token).toBe("string");
  });

  it("is pending for a freshly approved subscription", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok" });
      return jsonResponse({ status: "APPROVAL_PENDING", create_time: new Date(NOW * 1000).toISOString() });
    });
    const res = await claim(env, "paypal", "I-SUB1");
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).pending).toBe(true);
  });

  it("is unknown_reference when PayPal has no such subscription", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok" });
      return new Response("", { status: 404 });
    });
    const res = await claim(env, "paypal", "I-GONE");
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });
});

describe("claim – crypto", () => {
  it("issues a token once the order is granted", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser(activeEnt("crypto"));
    await repo.putCryptoOrder("order-1", { email: "buyer@example.com", plan: "monthly", status: "granted", paymentIds: ["p1"] });
    const res = await claim(env, "crypto", "order-1");
    expect(res.status).toBe(200);
    expect(typeof (await jsonOf(res)).token).toBe("string");
  });

  it("is pending while the payment is still being confirmed", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putCryptoOrder("order-1", { email: "buyer@example.com", plan: "monthly", status: "pending", paymentIds: [] });
    const res = await claim(env, "crypto", "order-1");
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).pending).toBe(true);
  });

  it("is unknown_reference for an order we never created", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await claim(env, "crypto", "nope");
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });

  it("is not_paid for a failed order", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putCryptoOrder("order-1", { email: "buyer@example.com", plan: "monthly", status: "failed", paymentIds: ["p1"] });
    const res = await claim(env, "crypto", "order-1");
    expect(res.status).toBe(402);
    expect((await jsonOf(res)).error).toBe("not_paid");
  });
});
