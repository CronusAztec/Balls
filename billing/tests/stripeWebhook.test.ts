import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { buildIpnSignature } from "../src/providers/nowpayments";
import { buildSignatureHeader, STRIPE_API_VERSION } from "../src/providers/stripe";
import { Repo } from "../src/store";
import { verifyLicense } from "../src/license";
import type { Env } from "../src/env";
import {
  allProvidersEnv,
  jsonRequest,
  jsonResponse,
  makeHarness,
  makeRequest,
  NOW,
  seedStripe,
  SITE_ORIGIN,
  SlowKV,
  stubFetch,
  TEST_PRIVATE_JWK,
  TEST_PUBLIC_SPKI,
} from "./helpers";

const DAY = 86400;
const SECRET = "whsec_test";

afterEach(() => vi.unstubAllGlobals());

async function postWebhook(
  env: Env,
  event: unknown,
  opts: { secret?: string; timestamp?: number; tamper?: boolean } = {},
): Promise<Response> {
  const raw = JSON.stringify(event);
  const ts = opts.timestamp ?? NOW;
  const header = await buildSignatureHeader(raw, opts.secret ?? SECRET, ts);
  const body = opts.tamper ? raw + " " : raw;
  const req = makeRequest("POST", "/webhooks/stripe", {
    body,
    headers: { "stripe-signature": header, "content-type": "application/json" },
  });
  return handleRequest(req, env, { now: NOW });
}

const noNetwork = () =>
  stubFetch(() => {
    throw new Error("no network expected");
  });

const checkoutCompleted = (over: Record<string, unknown> = {}, id = "evt_cs") => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      customer: "cus_1",
      subscription: "sub_1",
      customer_details: { email: "Buyer@Example.com" },
      metadata: { plan: "monthly" },
      ...over,
    },
  },
});
const invoicePaid = (end: number, id = "evt_inv", over: Record<string, unknown> = {}) => ({
  id,
  type: "invoice.paid",
  data: {
    object: {
      subscription: "sub_1",
      customer_email: "buyer@example.com",
      lines: { data: [{ period: { end }, price: { id: "price_monthly" } }] },
      ...over,
    },
  },
});

describe("stripe webhook signature", () => {
  it("accepts a correctly signed body", async () => {
    const { env } = makeHarness(allProvidersEnv());
    noNetwork();
    const res = await postWebhook(env, { id: "evt_1", type: "ping", data: { object: {} } });
    expect(res.status).toBe(200);
  });

  it("rejects a tampered body", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await postWebhook(env, { id: "evt_2", type: "ping", data: { object: {} } }, { tamper: true });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_signature");
  });

  it("rejects the wrong secret", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await postWebhook(env, { id: "evt_3", type: "ping", data: { object: {} } }, { secret: "whsec_other" });
    expect(res.status).toBe(400);
  });

  it("rejects a stale timestamp", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await postWebhook(env, { id: "evt_4", type: "ping", data: { object: {} } }, { timestamp: NOW - 1000 });
    expect(res.status).toBe(400);
  });
});

describe("stripe webhook handling", () => {
  it("links the subscription to its buyer on checkout.session.completed", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    const res = await postWebhook(env, checkoutCompleted());
    expect(res.status).toBe(200);
    expect(await repo.getLink("stripe", "sub_1")).toEqual({ email: "buyer@example.com", plan: "monthly", customerId: "cus_1", refs: ["cs_1"] });
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent).toMatchObject({ provider: "stripe", plan: "monthly", periodEnd: 0 }); // nothing paid yet
    expect(ent!.refs).toEqual(expect.arrayContaining(["cs_1", "sub_1"]));
  });

  it("ignores another product's checkout (no plan of ours in its metadata)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await postWebhook(env, checkoutCompleted({ metadata: {} }));
    expect(await repo.getLink("stripe", "sub_1")).toBeNull();
  });

  it("sets the period on invoice.paid, from the invoice lines (the latest line end)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await postWebhook(env, checkoutCompleted());
    const periodEnd = NOW + 30 * DAY;
    const res = await postWebhook(
      env,
      invoicePaid(periodEnd, "evt_inv", { lines: { data: [{ period: { end: NOW } , price: { id: "price_monthly" } }, { period: { end: periodEnd }, price: { id: "price_monthly" } }] } }),
    );
    expect(res.status).toBe(200);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent).toMatchObject({ periodEnd, plan: "monthly", status: "active", provider: "stripe" });
  });

  it("reads the newer invoice shape (parent.subscription_details, pricing.price_details)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    const periodEnd = NOW + 365 * DAY;
    await postWebhook(env, {
      id: "evt_basil",
      type: "invoice.paid",
      data: {
        object: {
          parent: { type: "subscription_details", subscription_details: { subscription: "sub_9" } },
          customer_email: "new@example.com",
          lines: { data: [{ period: { end: periodEnd }, pricing: { price_details: { price: "price_yearly" } } }] },
        },
      },
    });
    expect(await repo.entitlementFor("new@example.com")).toMatchObject({ periodEnd, plan: "yearly" });
  });

  it("ignores an invoice for another product's subscription", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await postWebhook(env, invoicePaid(NOW + 30 * DAY, "evt_other", { subscription: "sub_other", customer_email: "other@example.com", lines: { data: [{ period: { end: NOW + 30 * DAY }, price: { id: "price_SOMETHING_ELSE" } }] } }));
    expect(await repo.entitlementFor("other@example.com")).toBeNull();
  });

  it("asks Stripe to deliver an invoice again when its buyer is not known yet, and records it then", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    const event = invoicePaid(NOW + 30 * DAY, "evt_early", { customer_email: null });
    expect((await postWebhook(env, event)).status).toBe(503);
    await postWebhook(env, checkoutCompleted());
    expect((await postWebhook(env, event)).status).toBe(200); // the retry
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
  });

  it("is idempotent per event id", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await seedStripe(repo);
    await postWebhook(env, invoicePaid(NOW + 30 * DAY, "evt_same"));
    await postWebhook(env, invoicePaid(NOW + 60 * DAY, "evt_same")); // same id -> ignored
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
  });

  it("marks cancel-at-period-end without moving the period", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await seedStripe(repo, { periodEnd: NOW + 20 * DAY });
    const res = await postWebhook(env, {
      id: "evt_upd",
      type: "customer.subscription.updated",
      created: NOW,
      data: { object: { id: "sub_1", status: "active", cancel_at_period_end: true, current_period_end: NOW + 50 * DAY } },
    });
    expect(res.status).toBe(200);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent!.status).toBe("cancel_at_period_end");
    expect(ent!.periodEnd).toBe(NOW + 20 * DAY);
  });

  it("never extends access when the subscription cycles: a renewal that fails keeps the old period", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await postWebhook(env, checkoutCompleted());
    await postWebhook(env, invoicePaid(NOW, "c2"));
    // the period boundary: Stripe cycles the subscription and drafts the renewal invoice, then the payment fails
    for (const [id, status] of [["c3", "active"], ["c4", "past_due"]]) {
      await postWebhook(env, { id, type: "customer.subscription.updated", created: NOW, data: { object: { id: "sub_1", status, cancel_at_period_end: false, current_period_end: NOW + 30 * DAY, items: { data: [{ current_period_end: NOW + 30 * DAY, price: { id: "price_monthly" } }] } } } });
    }
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW);
    const res = await handleRequest(jsonRequest("/license/restore", { email: "buyer@example.com", ref: "cs_1" }), env, { now: NOW });
    expect(res.status).toBe(200);
    const payload = await verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string);
    expect(payload!.exp).toBe(NOW + 3 * DAY); // the paid period (now) plus the grace days – not 33 days
  });

  it("ends only this subscription's period on customer.subscription.deleted", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await seedStripe(repo, { periodEnd: NOW + 20 * DAY });
    const res = await postWebhook(env, {
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", status: "canceled" } },
    });
    expect(res.status).toBe(200);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent!.status).toBe("canceled");
    expect(ent!.periodEnd).toBe(NOW);
  });

  it("keeps two subscriptions of one e-mail apart", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await seedStripe(repo, { sub: "sub_1", session: "cs_1", periodEnd: NOW + 200 * DAY, plan: "yearly" });
    await seedStripe(repo, { sub: "sub_2", session: "cs_2", customer: "cus_2", periodEnd: NOW + 20 * DAY });
    await postWebhook(env, { id: "evt_d2", type: "customer.subscription.deleted", data: { object: { id: "sub_2", status: "canceled" } } });
    expect(await repo.entitlementFor("buyer@example.com")).toMatchObject({ periodEnd: NOW + 200 * DAY, plan: "yearly" });
  });
});

describe("periods bought with different providers", () => {
  it("a card plan's cancellation and deletion leave a prepaid crypto year alone", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    noNetwork();
    await postWebhook(env, checkoutCompleted({ customer_details: { email: "sw@example.com" } }, "e1"));
    await postWebhook(env, invoicePaid(NOW + 10 * DAY, "e2", { customer_email: "sw@example.com" }));
    await repo.putCryptoOrder("ord-y", { email: "sw@example.com", plan: "yearly", status: "pending", paymentIds: [] });
    const ipn = { payment_id: 7001, order_id: "ord-y", payment_status: "finished" };
    const sig = await buildIpnSignature(ipn, "np_ipn_secret");
    await handleRequest(makeRequest("POST", "/webhooks/nowpayments", { body: JSON.stringify(ipn), headers: { "x-nowpayments-sig": sig } }), env, { now: NOW });
    // the crypto year follows the card period's remaining 10 days
    expect((await repo.entitlementFor("sw@example.com"))!.periodEnd).toBe(NOW + 375 * DAY);
    await postWebhook(env, { id: "e3", type: "customer.subscription.updated", created: NOW, data: { object: { id: "sub_1", status: "active", cancel_at_period_end: true, current_period_end: NOW + 10 * DAY } } });
    expect((await repo.entitlementFor("sw@example.com"))!.periodEnd).toBe(NOW + 375 * DAY);
    await postWebhook(env, { id: "e4", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } });
    expect(await repo.entitlementFor("sw@example.com")).toMatchObject({ periodEnd: NOW + 375 * DAY, provider: "crypto", plan: "yearly" });
  });
});

describe("stripe webhook races", () => {
  it("checkout.session.completed and invoice.paid at once lose nothing (KV with network latency)", async () => {
    for (let i = 0; i < 25; i++) {
      const kv = new SlowKV(() => NOW);
      const env: Env = { ENTITLEMENTS: kv as unknown as KVNamespace, SITE_ORIGIN, LICENSE_PRIVATE_JWK: TEST_PRIVATE_JWK, ...allProvidersEnv() };
      await Promise.all([postWebhook(env, checkoutCompleted()), postWebhook(env, invoicePaid(NOW + 30 * DAY)), postWebhook(env, { id: "evt_u", type: "customer.subscription.updated", created: NOW, data: { object: { id: "sub_1", status: "active", cancel_at_period_end: false, items: { data: [{ price: { id: "price_monthly" } }] } } } })]);
      const repo = new Repo(kv);
      const ent = await repo.entitlementFor("buyer@example.com");
      expect(ent, `run ${i}`).toMatchObject({ periodEnd: NOW + 30 * DAY, provider: "stripe" });
      expect(ent!.sources[0].customerId, `run ${i}`).toBe("cus_1");
      expect(ent!.refs, `run ${i}`).toEqual(expect.arrayContaining(["cs_1", "sub_1"]));
    }
  }, 60000);
});

describe("stripe webhook idempotency on failure", () => {
  it("releases the event key when processing fails, so the provider's retry succeeds", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo);
    const periodEnd = NOW + 30 * DAY;
    let failNext = true;
    const versions: (string | null)[] = [];
    stubFetch((url, init) => {
      if (url.includes("/v1/subscriptions/sub_1")) {
        versions.push(new Headers(init?.headers).get("stripe-version"));
        if (failNext) {
          failNext = false;
          return new Response("err", { status: 500 }); // first delivery: provider is down
        }
        return jsonResponse({ current_period_end: periodEnd }); // retry: provider recovers
      }
      throw new Error(`unexpected ${url}`);
    });
    // invoice.paid with no line period forces the subscription fetch (the failing call).
    const event = { id: "evt_retry", type: "invoice.paid", data: { object: { subscription: "sub_1", lines: { data: [] } } } };
    const first = await postWebhook(env, event);
    expect(first.status).toBe(502);
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(0);

    const second = await postWebhook(env, event); // same event id, redelivered
    expect(second.status).toBe(200);
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(periodEnd);
    expect(versions).toEqual([STRIPE_API_VERSION, STRIPE_API_VERSION]); // every Stripe call pins the API version
  });
});
