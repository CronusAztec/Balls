// NOWPayments (crypto) REST calls and IPN verification. Plain fetch; no SDK.
//
// NOWPayments accepts BTC, ETH and the other popular coins on its side; the Worker only creates a USD
// invoice and lets the buyer pick the coin in the NOWPayments checkout.

import { hmacSha512Hex, sortedJsonStringify, timingSafeEqual } from "../crypto";
import { ApiError } from "../http";

export function nowPaymentsApiBase(sandbox: boolean): string {
  return sandbox ? "https://api-sandbox.nowpayments.io" : "https://api.nowpayments.io";
}

export interface NowPaymentsInvoiceInput {
  priceAmount: number;
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
}

/** Create an invoice and return its hosted URL. */
export async function createInvoice(
  apiBase: string,
  apiKey: string,
  input: NowPaymentsInvoiceInput,
): Promise<string> {
  const res = await fetch(`${apiBase}/v1/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: input.priceAmount,
      price_currency: "usd",
      order_id: input.orderId,
      order_description: input.orderDescription,
      ipn_callback_url: input.ipnCallbackUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.invoice_url !== "string") {
    throw new ApiError("crypto_error", "Could not reach the payment provider.", 502);
  }
  return data.invoice_url;
}

/**
 * Verify an IPN callback. The signature `x-nowpayments-sig` is the HMAC-SHA512 (hex) of the JSON
 * body re-serialised with every object's keys sorted recursively, keyed with the IPN secret. The
 * comparison is constant-time.
 */
export async function verifyIpnSignature(
  signature: string | null,
  payload: unknown,
  ipnSecret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacSha512Hex(ipnSecret, sortedJsonStringify(payload));
  return timingSafeEqual(signature.trim().toLowerCase(), expected);
}

/** Build the `x-nowpayments-sig` for a payload (used by the tests). */
export async function buildIpnSignature(payload: unknown, ipnSecret: string): Promise<string> {
  return hmacSha512Hex(ipnSecret, sortedJsonStringify(payload));
}
