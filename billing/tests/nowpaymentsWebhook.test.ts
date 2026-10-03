import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { ipnPaymentId } from "../src/handlers/webhooks";
import { buildIpnSignature } from "../src/providers/nowpayments";
import { allProvidersEnv, makeHarness, makeRequest, NOW, seedStripe, stubFetch } from "./helpers";

const DAY = 86400;
const IPN_SECRET = "np_ipn_secret";

afterEach(() => vi.unstubAllGlobals());

async function postIpn(
  env: ReturnType<typeof makeHarness>["env"],
  payload: Record<string, unknown>,
  opts: { secret?: string; tamper?: boolean } = {},
): Promise<Response> {
  const sig = await buildIpnSignature(payload, opts.secret ?? IPN_SECRET);
  const body = opts.tamper ? JSON.stringify({ ...payload, extra: "x" }) : JSON.stringify(payload);
  const req = makeRequest("POST", "/webhooks/nowpayments", {
    body,
    headers: { "x-nowpayments-sig": sig, "content-type": "application/json" },
  });
  return handleRequest(req, env, { now: NOW });
}

async function seedOrder(repo: ReturnType<typeof makeHarness>["repo"], plan: "monthly" | "yearly", id = "order-1", email = "buyer@example.com") {
  await repo.putCryptoOrder(id, { email, plan, status: "pending", paymentIds: [] });
}

/** An IPN shaped like NOWPayments' documented example: a numeric payment_id and amounts, a nested fee object. */
function documentedIpn(paymentId: number, orderId: string, status: string): Record<string, unknown> {
  return {
    payment_id: paymentId,
    parent_payment_id: null,
    invoice_id: 4522625843,
    payment_status: status,
    pay_address: "0xd1cDE08A07cD25adEbEd35c3867a59228C09B606",
    payin_extra_id: null,
    price_amount: 10,
    price_currency: "usd",
    pay_amount: 155.38559757,
    actually_paid: status === "waiting" ? 0 : 155.38559757,
    actually_paid_at_fiat: 0,
    pay_currency: "mana",
    order_id: orderId,
    order_description: "JumpingBallsLive Pro (monthly, 30 days) [en]",
    purchase_id: "6084744717",
    outcome_amount: 1131.7812095,
    outcome_currency: "trx",
    payment_extra_ids: null,
    fee: { currency: "btc", depositFee: 0, withdrawalFee: 0, serviceFee: 0 },
    created_at: "2021-04-12T14:22:54.942Z",
    updated_at: "2021-04-12T14:23:06.244Z",
  };
}

describe("nowpayments IPN signature", () => {
  it("accepts a correct signature", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("no network expected");
    });
    await seedOrder(repo, "monthly");
    const res = await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "waiting" });
    expect(res.status).toBe(200);
  });

  it("rejects a tampered body", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    const res = await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" }, { tamper: true });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_signature");
  });

  it("rejects the wrong secret", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    const res = await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" }, { secret: "wrong" });
    expect(res.status).toBe(400);
  });
});

describe("nowpayments IPN handling", () => {
  it("grants a prepaid period when finished", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    const res = await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" });
    expect(res.status).toBe(200);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent!.periodEnd).toBe(NOW + 30 * DAY);
    expect(ent!.provider).toBe("crypto");
    expect(ent!.refs).toContain("order-1");
    const order = await repo.getCryptoOrder("order-1");
    expect(order!.status).toBe("granted");
    expect(order!.paymentIds).toContain("p1");
  });

  it("grants every buyer whose IPN carries a numeric payment_id (NOWPayments' documented shape)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly", "orderA", "a@example.com");
    await seedOrder(repo, "monthly", "orderB", "b@example.com");
    expect((await postIpn(env, documentedIpn(5077125051, "orderA", "finished"))).status).toBe(200);
    expect((await postIpn(env, documentedIpn(5077125999, "orderB", "finished"))).status).toBe(200);
    expect((await repo.entitlementFor("a@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
    expect((await repo.entitlementFor("b@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
    expect((await repo.getCryptoOrder("orderB"))).toMatchObject({ status: "granted", paymentIds: ["5077125999"] });
  });

  it("grants one payment once, however many statuses it goes through (confirmed and finished both arrive)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    for (const status of ["waiting", "confirming", "confirmed", "sending", "finished"]) {
      expect((await postIpn(env, documentedIpn(777, "order-1", status))).status).toBe(200);
    }
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
    await seedOrder(repo, "yearly", "order-y", "y@example.com");
    for (const status of ["confirmed", "finished"]) await postIpn(env, documentedIpn(888, "order-y", status));
    expect((await repo.entitlementFor("y@example.com"))!.periodEnd).toBe(NOW + 365 * DAY);
  });

  it("grants an IPN without a payment id once per order", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    await postIpn(env, { order_id: "order-1", payment_status: "confirmed" });
    await postIpn(env, { order_id: "order-1", payment_status: "finished" });
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY);
  });

  it("stacks a second prepaid period on the first", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" });
    // A fresh order (crypto cannot renew itself) for the same buyer stacks.
    await seedOrder(repo, "monthly", "order-2");
    await postIpn(env, { payment_id: "p2", order_id: "order-2", payment_status: "finished" });
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 60 * DAY);
  });

  it("starts after a card plan's paid period", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { periodEnd: NOW + 10 * DAY });
    await seedOrder(repo, "monthly");
    await postIpn(env, { payment_id: 42, order_id: "order-1", payment_status: "finished" });
    expect(await repo.entitlementFor("buyer@example.com")).toMatchObject({ periodEnd: NOW + 40 * DAY, provider: "crypto" });
  });

  it("does not grant on partially_paid", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    const res = await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "partially_paid" });
    expect(res.status).toBe(200);
    expect(await repo.entitlementFor("buyer@example.com")).toBeNull();
    expect((await repo.getCryptoOrder("order-1"))!.status).toBe("partially_paid");
  });

  it("is idempotent per payment id and status", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" });
    await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" }); // dup
    expect((await repo.entitlementFor("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY); // not doubled
  });

  it("reads the payment id as NOWPayments sends it", () => {
    expect(ipnPaymentId({ payment_id: 5077125051 })).toBe("5077125051");
    expect(ipnPaymentId({ payment_id: " 77 " })).toBe("77");
    expect(ipnPaymentId({ payment_id_string: "5077125051" })).toBe("5077125051");
    expect(ipnPaymentId({ payment_id: null })).toBe("");
    expect(ipnPaymentId({})).toBe("");
  });
});
