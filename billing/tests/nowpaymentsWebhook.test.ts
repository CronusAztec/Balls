import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { buildIpnSignature } from "../src/providers/nowpayments";
import { allProvidersEnv, makeHarness, makeRequest, NOW, stubFetch } from "./helpers";

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

async function seedOrder(repo: ReturnType<typeof makeHarness>["repo"], plan: "monthly" | "yearly") {
  await repo.putCryptoOrder("order-1", { email: "buyer@example.com", plan, status: "pending", paymentIds: [] });
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
    const ent = await repo.getUser("buyer@example.com");
    expect(ent!.periodEnd).toBe(NOW + 30 * DAY);
    expect(ent!.provider).toBe("crypto");
    const order = await repo.getCryptoOrder("order-1");
    expect(order!.status).toBe("granted");
    expect(order!.paymentIds).toContain("p1");
  });

  it("stacks a second prepaid period on the first", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" });
    // A fresh order (crypto cannot renew itself) for the same buyer stacks.
    await repo.putCryptoOrder("order-2", { email: "buyer@example.com", plan: "monthly", status: "pending", paymentIds: [] });
    await postIpn(env, { payment_id: "p2", order_id: "order-2", payment_status: "finished" });
    expect((await repo.getUser("buyer@example.com"))!.periodEnd).toBe(NOW + 60 * DAY);
  });

  it("does not grant on partially_paid", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    const res = await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "partially_paid" });
    expect(res.status).toBe(200);
    expect(await repo.getUser("buyer@example.com")).toBeNull();
    expect((await repo.getCryptoOrder("order-1"))!.status).toBe("partially_paid");
  });

  it("is idempotent per payment id and status", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedOrder(repo, "monthly");
    await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" });
    await postIpn(env, { payment_id: "p1", order_id: "order-1", payment_status: "finished" }); // dup
    expect((await repo.getUser("buyer@example.com"))!.periodEnd).toBe(NOW + 30 * DAY); // not doubled
  });
});
