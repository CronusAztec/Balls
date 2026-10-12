import { describe, expect, it } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest, RATE_LIMITS } from "../src/app";
import type { RateLimiters } from "../src/app";
import { MemoryRateLimiter, RATE_LIMIT_MAX_KEYS } from "../src/ratelimit";
import { buildSignatureHeader } from "../src/providers/stripe";
import { allProvidersEnv, makeHarness, makeRequest, NOW, SITE_ORIGIN } from "./helpers";

/** --- go-live-kit --- The per-connection rate limits on checkouts, licences and the portal. */

const fresh = (): RateLimiters => ({
  checkout: new MemoryRateLimiter(RATE_LIMITS.checkoutPer10Min, 600, () => NOW),
  license: new MemoryRateLimiter(RATE_LIMITS.licensePer10Min, 600, () => NOW),
  portal: new MemoryRateLimiter(RATE_LIMITS.portalPer10Min, 600, () => NOW),
});

const RETURN_URL = `${SITE_ORIGIN}/Balls/en/pricing/`;

function checkout(ip: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ip) headers["cf-connecting-ip"] = ip;
  // plan "nope" answers 400 without any network call: the limiter counts the request before the handler runs
  return makeRequest("POST", "/checkout/stripe", { body: JSON.stringify({ plan: "nope", returnUrl: RETURN_URL }), headers, origin: SITE_ORIGIN });
}

describe("MemoryRateLimiter", () => {
  it("allows the limit, refuses the next with a retry time, and opens a new window once it ends", () => {
    let now = 1000;
    const limiter = new MemoryRateLimiter(10, 600, () => now);
    for (let i = 0; i < 10; i++) expect(limiter.hit("a"), `hit ${i + 1}`).toMatchObject({ allowed: true, remaining: 9 - i, retryAfterSeconds: 0 });
    const refused = limiter.hit("a");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(600);
    expect(limiter.hit("b").allowed).toBe(true); // another key has its own window
    now += 599;
    expect(limiter.hit("a")).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    now += 1;
    expect(limiter.hit("a")).toMatchObject({ allowed: true, remaining: 9 });
  });

  it("forgets the oldest windows first beyond its key limit", () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(1, 600, () => now);
    for (let i = 0; i < RATE_LIMIT_MAX_KEYS + 5; i++) {
      now = i / 1000;
      limiter.hit(`ip-${i}`);
    }
    expect(limiter.size).toBe(RATE_LIMIT_MAX_KEYS);
    expect(limiter.hit(`ip-${RATE_LIMIT_MAX_KEYS + 4}`).allowed).toBe(false); // the newest is still counted
    expect(limiter.hit("ip-0").allowed).toBe(true); // the oldest was forgotten
  });
});

describe("rate limits through the Worker", () => {
  it("answers the 11th checkout of a connection in 10 minutes with 429, Retry-After and CORS, while another connection passes", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const limiters = fresh();
    for (let i = 0; i < 10; i++) {
      const res = await handleRequest(checkout("1.2.3.4"), env, { now: NOW, limiters });
      expect(res.status, `request ${i + 1}`).toBe(400);
    }
    const res = await handleRequest(checkout("1.2.3.4"), env, { now: NOW, limiters });
    expect(res.status).toBe(429);
    const body = (await jsonOf(res)) as { retryAfter: number };
    expect(body).toEqual({ error: "rate_limited", message: "Too many requests from this connection. Please wait a minute and try again.", retryAfter: 600 });
    // the seconds in the body as well: the site's page cannot read Retry-After across origins (CORS does not expose it)
    expect(Number(res.headers.get("retry-after"))).toBe(body.retryAfter);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_ORIGIN);
    expect((await handleRequest(checkout("5.6.7.8"), env, { now: NOW, limiters })).status).toBe(400);
  });

  it("does not limit a request without cf-connecting-ip (local development), nor the webhooks, /config or /health", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const limiters = fresh();
    for (let i = 0; i < 15; i++) expect((await handleRequest(checkout(null), env, { now: NOW, limiters })).status).toBe(400);
    for (let i = 0; i < 15; i++) {
      const raw = JSON.stringify({ id: `evt_${i}`, type: "ping", data: { object: {} } });
      const header = await buildSignatureHeader(raw, "whsec_test", NOW);
      const res = await handleRequest(
        makeRequest("POST", "/webhooks/stripe", { body: raw, headers: { "stripe-signature": header, "cf-connecting-ip": "9.9.9.9" } }),
        env,
        { now: NOW, limiters },
      );
      expect(res.status).toBe(200);
      for (const path of ["/config", "/health"]) {
        expect((await handleRequest(makeRequest("GET", path, { headers: { "cf-connecting-ip": "9.9.9.9" } }), env, { now: NOW, limiters })).status).toBe(200);
      }
    }
  });

  it("limits the licence calls at 150 and the portal at 10 per connection", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const limiters = fresh();
    const post = (path: string) =>
      handleRequest(makeRequest("POST", path, { body: "{}", headers: { "cf-connecting-ip": "1.1.1.1", "content-type": "application/json" } }), env, { now: NOW, limiters });
    expect(RATE_LIMITS.licensePer10Min).toBe(150);
    for (let i = 0; i < 150; i++) expect((await post(i % 2 ? "/license/claim" : "/license/restore")).status).toBe(400);
    expect((await post("/license/claim")).status).toBe(429);
    for (let i = 0; i < 10; i++) expect((await post("/portal/stripe")).status).toBe(400);
    expect((await post("/portal/stripe")).status).toBe(429);
  });

  // The pricing page polls a pending claim every 5 s for up to 10 minutes (src/lib/billing/api.ts CLAIM_POLL_MS and
  // CLAIM_POLL_LIMIT_MS): one page's whole poll – the first ask and 120 more – plus a restore stays under the limit.
  it("lets one pricing page poll a pending claim for its full 10 minutes without a 429", async () => {
    const { env } = makeHarness(allProvidersEnv());
    let now = NOW;
    const limiters: RateLimiters = { ...fresh(), license: new MemoryRateLimiter(RATE_LIMITS.licensePer10Min, 600, () => now) };
    const post = (path: string) =>
      handleRequest(makeRequest("POST", path, { body: "{}", headers: { "cf-connecting-ip": "2.2.2.2", "content-type": "application/json" } }), env, { now, limiters });
    const statuses = new Set<number>();
    expect((await post("/license/restore")).status).toBe(400);
    for (let t = 0; t <= 600_000; t += 5000) {
      now = NOW + t / 1000;
      statuses.add((await post("/license/claim")).status);
    }
    expect([...statuses]).toEqual([400]);
  });
});
