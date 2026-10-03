import { describe, expect, it } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { allProvidersEnv, makeHarness, makeRequest, NOW, SITE_ORIGIN } from "./helpers";

describe("CORS and preflight", () => {
  it("answers an OPTIONS preflight from the site origin with the CORS headers", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(makeRequest("OPTIONS", "/checkout/stripe", { origin: SITE_ORIGIN }), env, { now: NOW });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("allows any localhost origin for development", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(makeRequest("OPTIONS", "/config", { origin: "http://localhost:4173" }), env, { now: NOW });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:4173");
  });

  it("grants the Windows app's origin (app://jumpingballslive) and no other app:// host", async () => {
    const { env } = makeHarness();
    const app = await handleRequest(makeRequest("OPTIONS", "/license/restore", { origin: "app://jumpingballslive" }), env, { now: NOW });
    expect(app.status).toBe(204);
    expect(app.headers.get("access-control-allow-origin")).toBe("app://jumpingballslive");
    expect(app.headers.get("access-control-allow-headers")).toContain("Content-Type");
    const other = await handleRequest(makeRequest("GET", "/config", { origin: "app://elsewhere" }), env, { now: NOW });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not grant CORS to a foreign origin", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(makeRequest("GET", "/config", { origin: "https://evil.example.com" }), env, { now: NOW });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(makeRequest("GET", "/nope", { origin: SITE_ORIGIN }), env, { now: NOW });
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("not_found");
  });

  it("405s a known path with the wrong method", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(makeRequest("GET", "/checkout/stripe", { origin: SITE_ORIGIN }), env, { now: NOW });
    expect(res.status).toBe(405);
    expect((await jsonOf(res)).error).toBe("method_not_allowed");
    expect(res.headers.get("allow")).toContain("POST");
  });

  it("refuses a body over the size limit", async () => {
    const { env } = makeHarness();
    const big = JSON.stringify({ provider: "crypto", ref: "x".repeat(21000) });
    const res = await handleRequest(
      makeRequest("POST", "/license/claim", { body: big, origin: SITE_ORIGIN, headers: { "content-type": "application/json" } }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(413);
    expect((await jsonOf(res)).error).toBe("body_too_large");
  });
});

describe("/config", () => {
  it("reports the plans, no providers and test mode by default", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(makeRequest("GET", "/config", { origin: SITE_ORIGIN }), env, { now: NOW });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.plans).toEqual({ monthly: { usd: 10 }, yearly: { usd: 79 } });
    expect(body.providers).toEqual({ stripe: false, paypal: false, crypto: false });
    expect(body.testMode).toBe(true); // the harness uses the public test key
  });

  it("reports a provider as available once its secrets are set", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await handleRequest(makeRequest("GET", "/config", { origin: SITE_ORIGIN }), env, { now: NOW });
    const body = await jsonOf(res);
    expect(body.providers).toEqual({ stripe: true, paypal: true, crypto: true });
  });

  it("keeps a provider off until its webhook secret is set too (a payment it could not verify would never count)", async () => {
    const { env } = makeHarness(allProvidersEnv({ STRIPE_WEBHOOK_SECRET: "", PAYPAL_WEBHOOK_ID: "", NOWPAYMENTS_IPN_SECRET: "" }));
    const res = await handleRequest(makeRequest("GET", "/config", { origin: SITE_ORIGIN }), env, { now: NOW });
    expect((await jsonOf(res)).providers).toEqual({ stripe: false, paypal: false, crypto: false });
    const { env: onlyStripe } = makeHarness(allProvidersEnv({ PAYPAL_WEBHOOK_ID: undefined, NOWPAYMENTS_IPN_SECRET: undefined }));
    const res2 = await handleRequest(makeRequest("GET", "/config", { origin: SITE_ORIGIN }), onlyStripe, { now: NOW });
    expect((await jsonOf(res2)).providers).toEqual({ stripe: true, paypal: false, crypto: false });
  });
});
