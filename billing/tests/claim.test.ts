import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { verifyLicense } from "../src/license";
import { STRIPE_API_VERSION } from "../src/providers/stripe";
import {
  allProvidersEnv,
  jsonRequest,
  jsonResponse,
  makeHarness,
  NOW,
  seedCrypto,
  seedPaypal,
  seedStripe,
  stubFetch,
  TEST_PUBLIC_SPKI,
} from "./helpers";

const DAY = 86400;
const iso = (unix: number) => new Date(unix * 1000).toISOString();

afterEach(() => vi.unstubAllGlobals());

async function claim(env: ReturnType<typeof makeHarness>["env"], provider: string, ref: string) {
  return handleRequest(jsonRequest("/license/claim", { provider, ref }), env, { now: NOW });
}

async function tokenPayload(res: Response) {
  return verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string);
}

/** A completed, paid Checkout Session as Stripe returns it with the subscription and its latest invoice expanded. */
function paidSession(over: { email?: string; periodEnd?: number; invoiceStatus?: string; subStatus?: string; price?: string } = {}) {
  const { email = "buyer@example.com", periodEnd = NOW + 30 * DAY, invoiceStatus = "paid", subStatus = "active", price = "price_monthly" } = over;
  return {
    id: "cs_new",
    status: "complete",
    payment_status: "paid",
    customer: "cus_9",
    customer_details: { email },
    metadata: { plan: "monthly" },
    subscription: {
      id: "sub_9",
      status: subStatus,
      latest_invoice: { id: "in_1", status: invoiceStatus, lines: { data: [{ period: { end: periodEnd }, price: { id: price } }] } },
    },
  };
}

describe("claim – stripe", () => {
  it("records the purchase from the session itself and issues a token, before any webhook (the Stripe version pinned)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    let version: string | null = null;
    let url = "";
    stubFetch((u, init) => {
      if (u.includes("/v1/checkout/sessions/")) {
        url = u;
        version = new Headers(init?.headers).get("stripe-version");
        return jsonResponse(paidSession());
      }
      throw new Error(`unexpected ${u}`);
    });
    const res = await claim(env, "stripe", "cs_new");
    expect(res.status).toBe(200);
    const payload = await tokenPayload(res);
    expect(payload).toMatchObject({ sub: "buyer@example.com", provider: "stripe", plan: "monthly", exp: NOW + 33 * DAY });
    expect(version).toBe(STRIPE_API_VERSION);
    expect(url).toContain("expand[]=subscription.latest_invoice");
    // the facts a webhook would have written are there for restore and the portal
    expect(await repo.getLink("stripe", "sub_9")).toEqual({ email: "buyer@example.com", plan: "monthly", customerId: "cus_9", refs: ["cs_new"] });
  });

  it("gives a returning customer this purchase's period, not their old lapsed one", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedCrypto(repo, { order: "old-order", payment: "old", at: NOW - 90 * DAY }); // ended 60 days ago
    await seedStripe(repo, { sub: "sub_old", session: "cs_old", periodEnd: NOW - 30 * DAY });
    stubFetch(() => jsonResponse(paidSession()));
    const res = await claim(env, "stripe", "cs_new");
    expect(res.status).toBe(200);
    expect((await tokenPayload(res))!.exp).toBe(NOW + 33 * DAY);
  });

  it("is pending (never an expired token) while the payment is not recorded", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { sub: "sub_old", session: "cs_old", periodEnd: NOW - 30 * DAY }); // a lapsed record
    // checkout.session.completed has linked the new subscription, invoice.paid has not arrived, the invoice is not paid yet
    await seedStripe(repo, { sub: "sub_9", session: "cs_new" });
    stubFetch(() => jsonResponse(paidSession({ invoiceStatus: "open" })));
    const res = await claim(env, "stripe", "cs_new");
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ pending: true });
  });

  it("issues the token once invoice.paid has recorded the period, even without the expansion", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { sub: "sub_9", session: "cs_new", customer: "cus_9", periodEnd: NOW + 30 * DAY });
    const session = { ...paidSession(), subscription: { id: "sub_9", status: "active", latest_invoice: "in_1" } };
    stubFetch(() => jsonResponse(session));
    const res = await claim(env, "stripe", "cs_new");
    expect(res.status).toBe(200);
    expect((await tokenPayload(res))!.exp).toBe(NOW + 33 * DAY);
  });

  it("is not_active for a subscription that has been cancelled", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => jsonResponse(paidSession({ subStatus: "canceled", invoiceStatus: "open" })));
    const res = await claim(env, "stripe", "cs_new");
    expect(res.status).toBe(402);
    expect((await jsonOf(res)).error).toBe("not_active");
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
  const subscription = (over: Record<string, unknown> = {}) => ({
    id: "I-SUB1",
    status: "ACTIVE",
    plan_id: "P-YEARLY",
    custom_id: "order-1",
    subscriber: { email_address: "Buyer@Example.com" },
    billing_info: { next_billing_time: iso(NOW + 365 * DAY), failed_payments_count: 0, outstanding_balance: { currency_code: "USD", value: "0.0" } },
    ...over,
  });
  const paypalApi = (sub: Record<string, unknown> | null) =>
    stubFetch((url) => {
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok" });
      if (url.includes("/v1/billing/subscriptions/")) return sub ? jsonResponse(sub) : new Response("", { status: 404 });
      throw new Error(`unexpected ${url}`);
    });

  it("records an ACTIVE subscription from PayPal itself and issues a token, before any webhook", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putPaypalOrder("order-1", { subscriptionId: "I-SUB1" });
    paypalApi(subscription());
    const res = await claim(env, "paypal", "order-1");
    expect(res.status).toBe(200);
    expect(await tokenPayload(res)).toMatchObject({ sub: "buyer@example.com", plan: "yearly", provider: "paypal", exp: NOW + 368 * DAY });
    expect((await repo.entitlementFor("buyer@example.com"))!.refs).toEqual(expect.arrayContaining(["I-SUB1", "order-1"]));
  });

  it("gives a returning customer this subscription's period, not an old lapsed one", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedPaypal(repo, { sub: "I-OLD", periodEnd: NOW - 40 * DAY });
    await repo.putPaypalOrder("order-1", { subscriptionId: "I-SUB1" });
    paypalApi(subscription());
    const res = await claim(env, "paypal", "order-1");
    expect((await tokenPayload(res))!.exp).toBe(NOW + 368 * DAY);
  });

  it("is pending while the first payment is failing", async () => {
    const { env } = makeHarness(allProvidersEnv());
    paypalApi(subscription({ billing_info: { next_billing_time: iso(NOW + 365 * DAY), failed_payments_count: 1 } }));
    const res = await claim(env, "paypal", "I-SUB1");
    expect(await jsonOf(res)).toEqual({ pending: true });
  });

  it("is pending for a freshly approved subscription", async () => {
    const { env } = makeHarness(allProvidersEnv());
    paypalApi({ status: "APPROVAL_PENDING", create_time: iso(NOW) });
    const res = await claim(env, "paypal", "I-SUB1");
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).pending).toBe(true);
  });

  it("is unknown_reference when PayPal has no such subscription", async () => {
    const { env } = makeHarness(allProvidersEnv());
    paypalApi(null);
    const res = await claim(env, "paypal", "I-GONE");
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });

  it("still issues a cancelled subscription's remaining paid time, and refuses one that has none", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedPaypal(repo, { periodEnd: NOW + 10 * DAY });
    paypalApi(subscription({ status: "CANCELLED", billing_info: {} }));
    const res = await claim(env, "paypal", "I-SUB1");
    expect((await tokenPayload(res))!.exp).toBe(NOW + 13 * DAY);
    const { env: env2, repo: repo2 } = makeHarness(allProvidersEnv());
    await seedPaypal(repo2, { periodEnd: NOW - 10 * DAY });
    paypalApi(subscription({ status: "CANCELLED", billing_info: {} }));
    const lapsed = await claim(env2, "paypal", "I-SUB1");
    expect(lapsed.status).toBe(402);
  });
});

describe("claim – crypto", () => {
  it("issues a token once the payment is granted", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedCrypto(repo);
    const res = await claim(env, "crypto", "order-1");
    expect(res.status).toBe(200);
    expect((await tokenPayload(res))!.exp).toBe(NOW + 33 * DAY);
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

  it("is not_paid for a failed order, not_active for one whose period ran out long ago", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putCryptoOrder("order-1", { email: "buyer@example.com", plan: "monthly", status: "failed", paymentIds: ["p1"] });
    const res = await claim(env, "crypto", "order-1");
    expect(res.status).toBe(402);
    expect((await jsonOf(res)).error).toBe("not_paid");
    await seedCrypto(repo, { order: "order-old", payment: "p-old", at: NOW - 90 * DAY });
    const old = await claim(env, "crypto", "order-old");
    expect(old.status).toBe(402);
    expect((await jsonOf(old)).error).toBe("not_active");
  });
});
