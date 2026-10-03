// The Worker's bindings and secrets. [vars] and the KV binding come from wrangler.toml; every secret
// is set with `wrangler secret put` (see billing/README.md and .dev.vars.example). All optional: a
// provider whose secrets are unset is simply reported as unavailable by /config and refuses checkout.

export interface Env {
  /** KV namespace binding (wrangler.toml). */
  ENTITLEMENTS: KVNamespace;

  // [vars]
  /** The site's public origin, e.g. https://cronusaztec.github.io. CORS and returnUrl are checked against it. */
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
