// Shared test helpers: a fake environment backed by an in-memory KV, request builders and a fetch mock.

import { vi } from "vitest";
import testKey from "../../tests/fixtures/license-test-key.json";
import type { Env } from "../src/env";
import { MemoryKV, Repo } from "../src/store";

export const TEST_PRIVATE_JWK = JSON.stringify(testKey.privateJwk);
export const TEST_PUBLIC_SPKI = testKey.publicSpkiBase64url;

export const SITE_ORIGIN = "https://cronusaztec.github.io";
export const WORKER_ORIGIN = "https://billing.example.workers.dev";

/** A fixed clock the handlers use (2026-01-01T00:00:00Z), so expiries are predictable. */
export const NOW = 1767225600;

export interface TestHarness {
  env: Env;
  kv: MemoryKV;
  repo: Repo;
}

/** Build a test environment. `vars` overrides any field (set a provider's secrets to enable it). */
export function makeHarness(vars: Partial<Env> = {}): TestHarness {
  const kv = new MemoryKV(() => NOW);
  const env: Env = {
    ENTITLEMENTS: kv as unknown as KVNamespace,
    SITE_ORIGIN,
    LICENSE_PRIVATE_JWK: TEST_PRIVATE_JWK,
    ...vars,
  };
  return { env, kv, repo: new Repo(kv) };
}

/** Enable every provider with placeholder secrets. */
export function allProvidersEnv(extra: Partial<Env> = {}): Partial<Env> {
  return {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_PRICE_MONTHLY: "price_monthly",
    STRIPE_PRICE_YEARLY: "price_yearly",
    PAYPAL_CLIENT_ID: "pp_client",
    PAYPAL_CLIENT_SECRET: "pp_secret",
    PAYPAL_WEBHOOK_ID: "pp_webhook",
    PAYPAL_PLAN_MONTHLY: "P-MONTHLY",
    PAYPAL_PLAN_YEARLY: "P-YEARLY",
    PAYPAL_ENV: "sandbox",
    NOWPAYMENTS_API_KEY: "np_key",
    NOWPAYMENTS_IPN_SECRET: "np_ipn_secret",
    ...extra,
  };
}

export interface RequestInitLite {
  body?: string;
  headers?: Record<string, string>;
  origin?: string;
}

/** Build a Request against the Worker's origin. */
export function makeRequest(method: string, path: string, init: RequestInitLite = {}): Request {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(`${WORKER_ORIGIN}${path}`, { method, headers, body: init.body });
}

/** Read a Response's JSON body as a loose record (the Workers types return `unknown`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonOf(res: Response): Promise<any> {
  return res.json();
}

/** A JSON POST with the site origin set (so CORS passes). */
export function jsonRequest(path: string, body: unknown): Request {
  return makeRequest("POST", path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    origin: SITE_ORIGIN,
  });
}

/** A fake fetch Response carrying JSON. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type FetchStub = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * Replace the global fetch with a stub, and return the vi.fn so a test can inspect the calls. The
 * stub receives the URL string and the init; unmatched URLs should throw inside the handler.
 */
export function stubFetch(handler: FetchStub) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// --- seeding the store the way the webhooks record purchases --------------------------------------

type SeedRepo = Repo;

/** A Stripe subscription as checkout.session.completed (and, with periodEnd, invoice.paid) records it. */
export async function seedStripe(
  repo: SeedRepo,
  opts: { email?: string; sub?: string; session?: string; customer?: string; plan?: "monthly" | "yearly"; periodEnd?: number } = {},
): Promise<void> {
  const { email = "buyer@example.com", sub = "sub_1", session = "cs_1", customer = "cus_1", plan = "monthly" } = opts;
  await repo.linkSubscription("stripe", sub, { email, plan, customerId: customer, refs: [session] });
  if (opts.periodEnd !== undefined) await repo.recordPaid("stripe", sub, { email, periodEnd: opts.periodEnd, plan });
}

/** A PayPal subscription as BILLING.SUBSCRIPTION.ACTIVATED records it. */
export async function seedPaypal(
  repo: SeedRepo,
  opts: { email?: string; sub?: string; order?: string; plan?: "monthly" | "yearly"; periodEnd?: number } = {},
): Promise<void> {
  const { email = "buyer@example.com", sub = "I-SUB1", plan = "monthly" } = opts;
  await repo.linkSubscription("paypal", sub, { email, plan, refs: opts.order ? [opts.order] : [] });
  if (opts.periodEnd !== undefined) await repo.recordPaid("paypal", sub, { email, periodEnd: opts.periodEnd, plan });
}

/** A crypto payment's prepaid period as a finished IPN records it. */
export async function seedCrypto(
  repo: SeedRepo,
  opts: { email?: string; order?: string; payment?: string; plan?: "monthly" | "yearly"; at?: number } = {},
): Promise<void> {
  const { email = "buyer@example.com", order = "order-1", payment = "p1", plan = "monthly", at = NOW } = opts;
  await repo.putCryptoOrder(order, { email, plan, status: "granted", paymentIds: [payment] });
  await repo.putCryptoGrant(payment, { email, orderId: order, paymentId: payment, plan, days: plan === "yearly" ? 365 : 30, base: at, grantedAt: at });
}

/** A MemoryKV whose calls take 5–30 ms, like Workers KV seen from a Worker (for the race tests). */
export class SlowKV extends MemoryKV {
  private pause = () => new Promise((r) => setTimeout(r, 5 + Math.random() * 25));
  override async get(key: string) {
    await this.pause();
    return super.get(key);
  }
  override async put(key: string, value: string, options?: { expirationTtl?: number }) {
    await this.pause();
    return super.put(key, value, options);
  }
}
