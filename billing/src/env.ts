// The Worker's bindings and secrets. [vars] and the KV binding come from wrangler.toml; every secret
// is set with `wrangler secret put` (see billing/README.md and .dev.vars.example). All optional: a
// provider whose secrets are unset – its webhook secret included – is reported as unavailable by
// /config and refuses checkout (providerReady below).

import { isTestKey, parsePrivateJwk } from "./license";

export interface Env {
  /** KV namespace binding (wrangler.toml). */
  ENTITLEMENTS: KVNamespace;

  // [vars]
  /**
   * The site's public origin, e.g. https://cronusaztec.github.io. CORS and returnUrl are checked against it. --- go-live-kit
   * --- One or more, separated by spaces or commas (the GitHub Pages origin and a custom domain).
   */
  SITE_ORIGIN?: string;

  // Licence signing
  /** The P-256 private key as a JWK string. When it is the public test key, /config reports testMode. */
  LICENSE_PRIVATE_JWK?: string;

  // Stripe
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_MONTHLY?: string;
  STRIPE_PRICE_YEARLY?: string;
  /** "1" turns on Stripe automatic tax at checkout. */
  STRIPE_AUTOMATIC_TAX?: string;

  // PayPal
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_PLAN_MONTHLY?: string;
  PAYPAL_PLAN_YEARLY?: string;
  /** "sandbox" (default) or "live". */
  PAYPAL_ENV?: string;

  // NOWPayments (crypto)
  NOWPAYMENTS_API_KEY?: string;
  NOWPAYMENTS_IPN_SECRET?: string;
  /** "1" uses the NOWPayments sandbox API. */
  NOWPAYMENTS_SANDBOX?: string;
}

/** Whether a flag var is switched on ("1" / "true", case-insensitive). */
export function flagOn(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type PaymentProvider = "stripe" | "paypal" | "crypto";

// --- go-live-kit --- Live/test mode safety. Test providers (sk_test_, the PayPal sandbox, the NOWPayments sandbox) belong
// with the public TEST licence key; live providers with a real key. A real buyer's payment signed with the test key would
// be a licence anyone can forge, and a test card unlocking a real-key licence would be Pro for free – so a provider whose
// mode disagrees with the licence key's is switched off (/config hides its button, its checkout answers 503
// provider_misconfigured) and /health names the disagreement.

/** The licence signing key's mode: the committed TEST key, a real key, or none. */
export type SigningMode = "live" | "test" | "unset";

export function signingMode(env: Env): SigningMode {
  if (!parsePrivateJwk(env.LICENSE_PRIVATE_JWK)) return "unset";
  return isTestKey(env.LICENSE_PRIVATE_JWK) ? "test" : "live";
}

/** A provider's mode from its keys: live, test, or null (no key at all, or a key that is neither). */
export type ProviderMode = "live" | "test" | null;

export function providerMode(env: Env, provider: PaymentProvider): ProviderMode {
  switch (provider) {
    case "stripe": {
      const key = (env.STRIPE_SECRET_KEY ?? "").trim();
      if (!key) return null;
      if (/^(sk|rk)_live_/.test(key)) return "live";
      if (/^(sk|rk)_test_/.test(key)) return "test";
      return null;
    }
    case "paypal":
      if (!env.PAYPAL_CLIENT_ID) return null;
      return env.PAYPAL_ENV?.trim().toLowerCase() === "live" ? "live" : "test";
    case "crypto":
      if (!env.NOWPAYMENTS_API_KEY) return null;
      return flagOn(env.NOWPAYMENTS_SANDBOX) ? "test" : "live";
  }
}

/**
 * Whether a provider has every secret it needs: its API keys, its plans and – just as much – the secret its webhook is
 * verified with. A payment whose webhook the Worker cannot verify is never recorded, so a provider without one is not
 * offered (/config) and refuses checkout until the secret is set.
 */
export function providerConfigured(env: Env, provider: PaymentProvider): boolean {
  switch (provider) {
    case "stripe":
      return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_YEARLY);
    case "paypal":
      return !!(
        env.PAYPAL_CLIENT_ID &&
        env.PAYPAL_CLIENT_SECRET &&
        env.PAYPAL_WEBHOOK_ID &&
        env.PAYPAL_PLAN_MONTHLY &&
        env.PAYPAL_PLAN_YEARLY
      );
    case "crypto":
      return !!(env.NOWPAYMENTS_API_KEY && env.NOWPAYMENTS_IPN_SECRET);
  }
}

/** Why a configured provider must stay off (its mode disagrees with the licence key's), or null when it may run. */
export function providerMismatch(env: Env, provider: PaymentProvider): string | null {
  if (!providerConfigured(env, provider)) return null;
  const signing = signingMode(env);
  if (signing === "unset") return `${provider}: no licence signing key is set`;
  const mode = providerMode(env, provider);
  if (mode === null) return `${provider}: the key is neither a live nor a test key`;
  if (mode !== signing) return `${provider}: ${mode} provider keys with a ${signing} licence key`;
  return null;
}

/**
 * Whether a provider may take payments: every secret it needs is set (providerConfigured) and its live/test mode is the
 * licence key's (providerMismatch).
 */
export function providerReady(env: Env, provider: PaymentProvider): boolean {
  return providerConfigured(env, provider) && providerMismatch(env, provider) === null;
}
