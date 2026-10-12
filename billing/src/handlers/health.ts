// --- go-live-kit --- GET /health: what the Worker runs with, in one answer the owner (and `npm run go-live:check`) can read.
//
// Always 200 – the body says what is wrong. It reports the licence key's mode and PUBLIC half, each provider's mode and
// readiness, the live/test disagreements that switch a provider off, the site origins, the storage binding, the plans, the
// webhook paths and events and the rate limits. Price and plan ids are public identifiers; every secret (API keys, webhook
// secrets, the private key) is reported as a boolean only and never appears in the body.

import { BILLING_CONFIG, PLAN_DAYS, PLAN_USD } from "../config";
import { flagOn, providerConfigured, providerMismatch, providerMode, providerReady, signingMode } from "../env";
import type { PaymentProvider } from "../env";
import { DESKTOP_APP_ORIGIN, json, siteOrigins } from "../http";
import { isTestKey, parsePrivateJwk, publicKeyFromPrivateJwk } from "../license";
import type { Ctx } from "./common";

export const SERVICE_NAME = "jumpingballslive-billing";

/** The rate limits app.ts applies, per connection and 10 minutes (reported on /health). */
export interface HealthLimits {
  checkoutPer10Min: number;
  licensePer10Min: number;
  portalPer10Min: number;
}

const PROVIDERS: PaymentProvider[] = ["stripe", "paypal", "crypto"];

export async function healthResponse(ctx: Ctx, limits: HealthLimits): Promise<Response> {
  const env = ctx.env;
  const jwk = parsePrivateJwk(env.LICENSE_PRIVATE_JWK);
  let publicKey: string | null = null;
  if (jwk) {
    try {
      publicKey = await publicKeyFromPrivateJwk(jwk);
    } catch {
      publicKey = null; // a JWK WebCrypto refuses: reported as configured, with no public key to compare
    }
  }
  const base = (p: PaymentProvider) => ({ configured: providerConfigured(env, p), mode: providerMode(env, p), ready: providerReady(env, p) });
  const stripe = base("stripe");
  const paypal = base("paypal");
  const crypto = base("crypto");
  const mismatches = PROVIDERS.map((p) => providerMismatch(env, p)).filter((m): m is string => m !== null);
  const storage = !!env.ENTITLEMENTS;
  const signingKey = { configured: !!jwk, test: isTestKey(env.LICENSE_PRIVATE_JWK), publicKey };
  const body = {
    ok: signingKey.configured && mismatches.length === 0 && storage,
    service: SERVICE_NAME,
    mode: signingMode(env),
    signingKey,
    providers: {
      stripe: {
        ...stripe,
        webhookSecret: !!env.STRIPE_WEBHOOK_SECRET,
        prices: stripe.configured ? { monthly: env.STRIPE_PRICE_MONTHLY ?? null, yearly: env.STRIPE_PRICE_YEARLY ?? null } : null,
        automaticTax: flagOn(env.STRIPE_AUTOMATIC_TAX),
      },
      paypal: {
        ...paypal,
        webhookId: !!env.PAYPAL_WEBHOOK_ID,
        plans: paypal.configured ? { monthly: env.PAYPAL_PLAN_MONTHLY ?? null, yearly: env.PAYPAL_PLAN_YEARLY ?? null } : null,
      },
      crypto: { ...crypto, ipnSecret: !!env.NOWPAYMENTS_IPN_SECRET },
    },
    mismatches,
    siteOrigins: siteOrigins(env.SITE_ORIGIN),
    desktopOrigin: DESKTOP_APP_ORIGIN,
    storage,
    plans: {
      monthly: { usd: PLAN_USD.monthly, days: PLAN_DAYS.monthly },
      yearly: { usd: PLAN_USD.yearly, days: PLAN_DAYS.yearly },
    },
    webhooks: {
      stripe: { path: BILLING_CONFIG.stripe.webhookPath, apiVersion: BILLING_CONFIG.stripe.apiVersion, events: BILLING_CONFIG.stripe.webhookEvents },
      paypal: { path: BILLING_CONFIG.paypal.webhookPath, events: BILLING_CONFIG.paypal.webhookEvents },
      nowpayments: { path: BILLING_CONFIG.nowpayments.ipnPath },
    },
    limits,
  };
  return json(body, 200, { ...ctx.cors, "Cache-Control": "no-store" });
}
