// PayPal REST calls and webhook verification. Plain fetch; no SDK.

import { ApiError } from "../http";

export function paypalApiBase(env: string | undefined): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/** An OAuth client-credentials access token. */
export async function getAccessToken(
  apiBase: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new ApiError("paypal_error", "Could not reach the payment provider.", 502);
  }
  return data.access_token;
}

export interface PaypalSubscriptionInput {
  planId: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  brandName: string;
}

export interface PaypalSubscriptionResult {
  id: string;
  approveUrl: string;
}

/** Create a subscription and return its id and the buyer's "approve" link. */
export async function createSubscription(
  apiBase: string,
  token: string,
  input: PaypalSubscriptionInput,
): Promise<PaypalSubscriptionResult> {
  const res = await fetch(`${apiBase}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plan_id: input.planId,
      custom_id: input.customId,
      application_context: {
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        user_action: "SUBSCRIBE_NOW",
        brand_name: input.brandName,
        shipping_preference: "NO_SHIPPING",
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.id !== "string") {
    throw new ApiError("paypal_error", "Could not reach the payment provider.", 502);
  }
  const links = Array.isArray(data.links) ? (data.links as Array<Record<string, unknown>>) : [];
  const approve = links.find((l) => l.rel === "approve");
  const approveUrl = approve && typeof approve.href === "string" ? approve.href : "";
  if (!approveUrl) {
    throw new ApiError("paypal_error", "The payment provider did not return an approval URL.", 502);
  }
  return { id: data.id, approveUrl };
}

/** Fetch a subscription by id. Returns null on a 4xx (unknown id). */
export async function getSubscription(
  apiBase: string,
  token: string,
  subscriptionId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${apiBase}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError("paypal_error", "Could not reach the payment provider.", 502);
  return data;
}

/** The five transmission headers PayPal signs a webhook with. */
export interface PaypalTransmissionHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

/** Pull the transmission headers off a request (null when any is missing). */
export function readTransmissionHeaders(headers: Headers): PaypalTransmissionHeaders | null {
  const transmissionId = headers.get("paypal-transmission-id");
  const transmissionTime = headers.get("paypal-transmission-time");
  const transmissionSig = headers.get("paypal-transmission-sig");
  const certUrl = headers.get("paypal-cert-url");
  const authAlgo = headers.get("paypal-auth-algo");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return null;
  }
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

/**
 * Verify a webhook by asking PayPal (POST /v1/notifications/verify-webhook-signature). The event
 * body is passed through as the already-parsed object so PayPal sees exactly the structure it sent.
 * Returns true only on verification_status SUCCESS.
 */
export async function verifyWebhookSignature(
  apiBase: string,
  token: string,
  webhookId: string,
  tx: PaypalTransmissionHeaders,
  event: unknown,
): Promise<boolean> {
  const res = await fetch(`${apiBase}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: tx.authAlgo,
      cert_url: tx.certUrl,
      transmission_id: tx.transmissionId,
      transmission_sig: tx.transmissionSig,
      transmission_time: tx.transmissionTime,
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return data.verification_status === "SUCCESS";
}

/**
 * How far an ACTIVE subscription is paid: its next billing time, as long as no payment is failing or
 * outstanding (PayPal keeps a subscription ACTIVE through up to three failed renewal attempts). Null
 * for any other state, and while the first payment has not cleared.
 */
export function paidThrough(subscription: Record<string, unknown>): number | null {
  if (subscription.status !== "ACTIVE") return null;
  const info =
    subscription.billing_info && typeof subscription.billing_info === "object"
      ? (subscription.billing_info as Record<string, unknown>)
      : {};
  if (typeof info.failed_payments_count === "number" && info.failed_payments_count > 0) return null;
  const outstanding = info.outstanding_balance as { value?: unknown } | undefined;
  if (outstanding && Number(outstanding.value ?? 0) > 0) return null;
  const next = typeof info.next_billing_time === "string" ? Date.parse(info.next_billing_time) : NaN;
  return Number.isFinite(next) ? Math.floor(next / 1000) : null;
}
