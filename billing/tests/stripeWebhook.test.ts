import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { buildSignatureHeader } from "../src/providers/stripe";
import { allProvidersEnv, jsonResponse, makeHarness, makeRequest, NOW, stubFetch } from "./helpers";

const DAY = 86400;
const SECRET = "whsec_test";

afterEach(() => vi.unstubAllGlobals());

async function postWebhook(
  env: ReturnType<typeof makeHarness>["env"],
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

describe("stripe webhook signature", () => {
  it("accepts a correctly signed body", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
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
  it("stores the entitlement on checkout.session.completed", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
    const res = await postWebhook(env, {
      id: "evt_cs",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          subscription: "sub_1",
          customer_details: { email: "Buyer@Example.com" },
          metadata: { plan: "monthly" },
        },
      },
    });
    expect(res.status).toBe(200);
    const ent = await repo.getUser("buyer@example.com");
    expect(ent).not.toBeNull();
    expect(ent!.customerId).toBe("cus_1");
    expect(ent!.subscriptionId).toBe("sub_1");
    expect(ent!.plan).toBe("monthly");
    expect(ent!.refs).toContain("cs_1");
    expect(await repo.getRefEmail("stripe", "sub_1")).toBe("buyer@example.com");
  });

  it("sets the period on invoice.paid, from the invoice lines", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
    await repo.putRef("stripe", "sub_1", "buyer@example.com");
    const periodEnd = NOW + 30 * DAY;
    const res = await postWebhook(env, {
      id: "evt_inv",
      type: "invoice.paid",
      data: {
        object: {
          subscription: "sub_1",
          customer_email: "buyer@example.com",
          lines: { data: [{ period: { end: periodEnd }, price: { id: "price_monthly" } }] },
        },
      },
    });
    expect(res.status).toBe(200);
    const ent = await repo.getUser("buyer@example.com");
    expect(ent!.periodEnd).toBe(periodEnd);
    expect(ent!.plan).toBe("monthly");
    expect(ent!.status).toBe("active");
  });

  it("is idempotent per event id", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
    await repo.putRef("stripe", "sub_1", "buyer@example.com");
    const first = NOW + 30 * DAY;
    const second = NOW + 60 * DAY;
    const event = (end: number) => ({
      id: "evt_same",
      type: "invoice.paid",
      data: { object: { subscription: "sub_1", lines: { data: [{ period: { end } }] } } },
    });
    await postWebhook(env, event(first));
    await postWebhook(env, event(second)); // same id -> ignored
    expect((await repo.getUser("buyer@example.com"))!.periodEnd).toBe(first);
  });

  it("marks cancel-at-period-end without moving the period", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
    await repo.putRef("stripe", "sub_1", "buyer@example.com");
    const periodEnd = NOW + 20 * DAY;
    const res = await postWebhook(env, {
      id: "evt_upd",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "active", cancel_at_period_end: true, current_period_end: periodEnd } },
    });
    expect(res.status).toBe(200);
    const ent = await repo.getUser("buyer@example.com");
    expect(ent!.status).toBe("cancel_at_period_end");
    expect(ent!.periodEnd).toBe(periodEnd);
  });

  it("ends the period on customer.subscription.deleted", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
    await repo.putRef("stripe", "sub_1", "buyer@example.com");
    const res = await postWebhook(env, {
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", status: "canceled" } },
    });
    expect(res.status).toBe(200);
    const ent = await repo.getUser("buyer@example.com");
    expect(ent!.status).toBe("canceled");
    expect(ent!.periodEnd).toBe(NOW);
  });
});

describe("stripe webhook idempotency on failure", () => {
  it("releases the event key when processing fails, so the provider's retry succeeds", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putRef("stripe", "sub_1", "buyer@example.com");
    const periodEnd = NOW + 30 * DAY;
    let failNext = true;
    stubFetch((url) => {
      if (url.includes("/v1/subscriptions/sub_1")) {
        if (failNext) {
          failNext = false;
          return new Response("err", { status: 500 }); // first delivery: provider is down
        }
        return jsonResponse({ current_period_end: periodEnd }); // retry: provider recovers
      }
      throw new Error(`unexpected ${url}`);
    });
    // invoice.paid with no line period forces the subscription fetch (the failing call).
    const event = {
      id: "evt_retry",
      type: "invoice.paid",
      data: { object: { subscription: "sub_1", lines: { data: [] } } },
    };
    const first = await postWebhook(env, event);
    expect(first.status).toBe(502);
    expect(await repo.getUser("buyer@example.com")).toBeNull();

    const second = await postWebhook(env, event); // same event id, redelivered
    expect(second.status).toBe(200);
    expect((await repo.getUser("buyer@example.com"))!.periodEnd).toBe(periodEnd);
  });
});
