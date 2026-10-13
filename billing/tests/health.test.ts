import { describe, expect, it } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { allProvidersEnv, makeHarness, makeRequest, NOW, realPrivateJwk, SITE_ORIGIN, TEST_PUBLIC_SPKI } from "./helpers";

/** --- go-live-kit --- GET /health: the mode, the licence key's public half, the providers and what disagrees – no secret. */

async function health(vars: Parameters<typeof makeHarness>[0] = {}) {
  const { env } = makeHarness(vars);
  const res = await handleRequest(makeRequest("GET", "/health", { origin: SITE_ORIGIN }), env, { now: NOW });
  return { res, body: await jsonOf(res) };
}

describe("/health", () => {
  it("reports test mode, the test key's public half and no providers on the default harness, with CORS and no caching", async () => {
    const { res, body } = await health();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE_ORIGIN);
    expect(body).toMatchObject({
      ok: true,
      service: "jumpingballslive-billing",
      mode: "test",
      signingKey: { configured: true, test: true, publicKey: TEST_PUBLIC_SPKI },
      mismatches: [],
      siteOrigins: [SITE_ORIGIN],
      desktopOrigin: "app://jumpingballslive",
      storage: true,
      plans: { monthly: { usd: 6.99, days: 30 }, yearly: { usd: 49, days: 365 } },
      limits: { checkoutPer10Min: 10, licensePer10Min: 150, portalPer10Min: 10 },
    });
    for (const p of ["stripe", "paypal", "crypto"]) expect(body.providers[p]).toMatchObject({ configured: false, mode: null, ready: false });
    expect(body.providers.stripe.prices).toBeNull();
    expect(body.providers.paypal.plans).toBeNull();
    expect(body.webhooks.stripe).toMatchObject({ path: "/webhooks/stripe", apiVersion: "2025-02-24.acacia" });
    expect(body.webhooks.stripe.events).toHaveLength(6);
    expect(body.webhooks.paypal.events).toHaveLength(7);
    expect(body.webhooks.nowpayments).toEqual({ path: "/webhooks/nowpayments" });
  });

  it("reports every provider ready and nothing disagreeing with every test-mode provider set", async () => {
    const { body } = await health(allProvidersEnv());
    expect(body.ok).toBe(true);
    expect(body.mismatches).toEqual([]);
    expect(body.providers.stripe).toMatchObject({ configured: true, mode: "test", ready: true, webhookSecret: true, prices: { monthly: "price_monthly", yearly: "price_yearly" }, automaticTax: false });
    expect(body.providers.paypal).toMatchObject({ configured: true, mode: "test", ready: true, webhookId: true, plans: { monthly: "P-MONTHLY", yearly: "P-YEARLY" } });
    expect(body.providers.crypto).toMatchObject({ configured: true, mode: "test", ready: true, ipnSecret: true });
  });

  it("names a live provider next to the test licence key and is not ok", async () => {
    const { body } = await health(allProvidersEnv({ STRIPE_SECRET_KEY: "sk_live_x" }));
    expect(body.ok).toBe(false);
    expect(body.mismatches).toContain("stripe: live provider keys with a test licence key");
    expect(body.providers.stripe).toMatchObject({ configured: true, mode: "live", ready: false });
  });

  it("says live with a real key, unset without one, and reads several site origins", async () => {
    const real = await realPrivateJwk();
    const live = await health(allProvidersEnv({ LICENSE_PRIVATE_JWK: real, STRIPE_SECRET_KEY: "sk_live_x", PAYPAL_ENV: "live", NOWPAYMENTS_SANDBOX: "0", SITE_ORIGIN: "https://cronusaztec.github.io https://www.example.com/" }));
    expect(live.body).toMatchObject({ ok: true, mode: "live", signingKey: { configured: true, test: false }, mismatches: [], siteOrigins: ["https://cronusaztec.github.io", "https://www.example.com"] });
    expect(live.body.signingKey.publicKey).toMatch(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{86}$/);
    expect(live.body.signingKey.publicKey).not.toBe(TEST_PUBLIC_SPKI);
    const unset = await health(allProvidersEnv({ LICENSE_PRIVATE_JWK: undefined }));
    expect(unset.body).toMatchObject({ ok: false, mode: "unset", signingKey: { configured: false, test: false, publicKey: null } });
    expect(unset.body.mismatches).toEqual(["stripe: no licence signing key is set", "paypal: no licence signing key is set", "crypto: no licence signing key is set"]);
    const odd = await health(allProvidersEnv({ STRIPE_SECRET_KEY: "pk_test_x" }));
    expect(odd.body.mismatches).toEqual(["stripe: the key is neither a live nor a test key"]);
  });

  it("never carries a secret value: the keys, the webhook secrets and the private key are booleans only", async () => {
    const real = await realPrivateJwk();
    const secrets = {
      LICENSE_PRIVATE_JWK: real,
      // key-shaped fakes built at run time, so no Stripe-key-shaped literal sits in the repository (secret scanning)
      STRIPE_SECRET_KEY: ["sk", "live", "SECRETstripeKEY0123456789"].join("_"),
      STRIPE_WEBHOOK_SECRET: ["whsec", "SECRETwebhook0123456789"].join("_"),
      PAYPAL_CLIENT_ID: "SECRETpaypalClientId0123456789",
      PAYPAL_CLIENT_SECRET: "SECRETpaypalClientSecret0123456789",
      PAYPAL_WEBHOOK_ID: "SECRETWEBHOOKID01",
      NOWPAYMENTS_API_KEY: "SECRET-nowpayments-key-0123",
      NOWPAYMENTS_IPN_SECRET: "SECRETipnSecret0123456789",
    };
    const { res } = await (async () => {
      const { env } = makeHarness(allProvidersEnv({ ...secrets, PAYPAL_ENV: "live", NOWPAYMENTS_SANDBOX: "" }));
      return { res: await handleRequest(makeRequest("GET", "/health"), env, { now: NOW }) };
    })();
    const text = await res.text();
    for (const value of Object.values(secrets)) expect(text).not.toContain(value);
    const d = (JSON.parse(real) as { d: string }).d;
    expect(text).not.toContain(d);
    expect(JSON.parse(text).ok).toBe(true);
  });
});
