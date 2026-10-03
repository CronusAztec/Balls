// Stripe REST calls and webhook verification. Plain fetch against api.stripe.com; no SDK.

import { hmacSha256Hex, timingSafeEqual } from "../crypto";
import { ApiError } from "../http";

const STRIPE_API = "https://api.stripe.com";

function authHeader(secretKey: string): string {
  return "Basic " + btoa(`${secretKey}:`);
}

async function stripeFetch(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  form?: URLSearchParams,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: authHeader(secretKey),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? form.toString() : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Keep the provider's message out of our response; log-free, code-stable error instead.
    throw new ApiError("stripe_error", "Could not reach the payment provider.", 502);
  }
  return data;
}

export interface StripeCheckoutInput {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  plan: string;
  locale: string;
  email?: string;
  automaticTax: boolean;
}

/** Create a subscription Checkout Session and return its hosted URL. */
export async function createCheckoutSession(
  secretKey: string,
  input: StripeCheckoutInput,
): Promise<string> {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", input.priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("allow_promotion_codes", "true");
  form.set("metadata[plan]", input.plan);
  form.set("metadata[locale]", input.locale);
  if (input.email) form.set("customer_email", input.email);
  if (input.automaticTax) form.set("automatic_tax[enabled]", "true");

  const session = await stripeFetch(secretKey, "POST", "/v1/checkout/sessions", form);
  const url = session.url;
  if (typeof url !== "string") {
    throw new ApiError("stripe_error", "The payment provider did not return a checkout URL.", 502);
  }
  return url;
}

/** Fetch a Checkout Session with its subscription expanded. Returns null on a 4xx (unknown id). */
export async function getCheckoutSession(
  secretKey: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${STRIPE_API}/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
    { headers: { Authorization: authHeader(secretKey) } },
  );
  if (res.status === 404 || res.status === 400) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError("stripe_error", "Could not reach the payment provider.", 502);
  return data;
}

/** Fetch a subscription by id. Returns null on a 4xx. */
export async function getSubscription(
  secretKey: string,
  subscriptionId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${STRIPE_API}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: authHeader(secretKey) } },
  );
  if (res.status === 404 || res.status === 400) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError("stripe_error", "Could not reach the payment provider.", 502);
  return data;
}

/** Create a Billing Portal session for a customer and return its URL. */
export async function createPortalSession(
  secretKey: string,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", returnUrl);
  const session = await stripeFetch(secretKey, "POST", "/v1/billing_portal/sessions", form);
  const url = session.url;
  if (typeof url !== "string") {
    throw new ApiError("stripe_error", "The payment provider did not return a portal URL.", 502);
  }
  return url;
}

/** The tolerance for a webhook's timestamp, in seconds (Stripe's recommended default). */
export const STRIPE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a Stripe-Signature header against the raw body. The header is `t=<ts>,v1=<hex>[,v1=<hex>]`;
 * the signed payload is `<ts>.<rawBody>`, HMAC-SHA256 with the webhook secret. Any v1 may match, the
 * compare is constant-time, and the timestamp must be within tolerance of `now`.
 */
export async function verifyWebhookSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  now: number,
  toleranceSeconds: number = STRIPE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

/** Build the `t=...,v1=...` header for a payload (used by the tests and, in principle, by replays). */
export async function buildSignatureHeader(
  rawBody: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const sig = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return `t=${timestamp},v1=${sig}`;
}
