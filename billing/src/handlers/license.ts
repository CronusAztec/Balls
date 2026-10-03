// /license/claim and /license/restore: turn a verified payment into a signed licence token.
//
// The token is always minted from the STORED entitlement (written by the webhooks), never from
// anything in the request, so a forged ref or e-mail cannot conjure a licence.

import { ApiError, json, readJsonBody } from "../http";
import { timingSafeEqual } from "../crypto";
import { isEntitled, normalizeEmail } from "../entitlements";
import type { Entitlement } from "../entitlements";
import { parsePrivateJwk, signLicense } from "../license";
import * as stripe from "../providers/stripe";
import * as paypal from "../providers/paypal";
import type { Ctx } from "./common";
import { isoToUnix, requireString } from "./common";

// APPROVED / APPROVAL_PENDING PayPal subscriptions this recent are still "pending", not failed.
const PAYPAL_PENDING_WINDOW_SECONDS = 15 * 60;

/** Mint a token for an entitlement, or fail if licence signing is not configured. */
async function mintToken(ctx: Ctx, ent: Entitlement): Promise<Response> {
  const jwk = parsePrivateJwk(ctx.env.LICENSE_PRIVATE_JWK);
  if (!jwk) throw new ApiError("not_configured", "Licence signing is not configured.", 503);
  const token = await signLicense(jwk, {
    sub: ent.email,
    plan: ent.plan,
    provider: ent.provider,
    periodEnd: ent.periodEnd,
    now: ctx.now,
  });
  return json({ token }, 200, ctx.cors);
}

function pending(ctx: Ctx): Response {
  return json({ pending: true }, 200, ctx.cors);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export async function claim(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(request);
  const ref = requireString(body, "ref");
  const provider = body.provider;
  switch (provider) {
    case "stripe":
      return claimStripe(ctx, ref);
    case "paypal":
      return claimPaypal(ctx, ref);
    case "crypto":
      return claimCrypto(ctx, ref);
    default:
      throw new ApiError("invalid_request", 'provider must be "stripe", "paypal" or "crypto".', 400);
  }
}

async function claimStripe(ctx: Ctx, ref: string): Promise<Response> {
  const secret = ctx.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ApiError("provider_unavailable", "Card payments are not configured.", 503);

  const session = await stripe.getCheckoutSession(secret, ref);
  if (!session) throw new ApiError("unknown_reference", "No such checkout session.", 404);

  const subscription = asRecord(session.subscription);
  const subStatus = asString(subscription.status);
  const paid = session.payment_status === "paid";
  const active = subStatus === "active" || subStatus === "trialing";

  if (paid && active) {
    const email =
      asString(asRecord(session.customer_details).email) ?? asString(session.customer_email);
    if (!email) return pending(ctx);
    const ent = await ctx.repo.getUser(email);
    if (isEntitled(ent)) return mintToken(ctx, ent);
    return pending(ctx); // webhook has not written the period yet
  }
  if (session.status === "expired") {
    throw new ApiError("not_paid", "This checkout was not completed.", 402);
  }
  return pending(ctx);
}

async function claimPaypal(ctx: Ctx, ref: string): Promise<Response> {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = ctx.env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new ApiError("provider_unavailable", "PayPal is not configured.", 503);
  }
  // ref is our order id (maps to a subscription id) or the subscription id itself.
  const order = await ctx.repo.getPaypalOrder(ref);
  const subscriptionId = order?.subscriptionId ?? ref;

  const apiBase = paypal.paypalApiBase(ctx.env.PAYPAL_ENV);
  const token = await paypal.getAccessToken(apiBase, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
  const sub = await paypal.getSubscription(apiBase, token, subscriptionId);
  if (!sub) throw new ApiError("unknown_reference", "No such subscription.", 404);

  const status = asString(sub.status);
  if (status === "ACTIVE") {
    const email = asString(asRecord(sub.subscriber).email_address);
    if (!email) return pending(ctx);
    const ent = await ctx.repo.getUser(email);
    if (isEntitled(ent)) return mintToken(ctx, ent);
    return pending(ctx);
  }
  if (status === "APPROVED" || status === "APPROVAL_PENDING") {
    const created = isoToUnix(sub.create_time);
    if (created === null || ctx.now - created <= PAYPAL_PENDING_WINDOW_SECONDS) return pending(ctx);
  }
  throw new ApiError("not_paid", "This subscription is not active.", 402);
}

async function claimCrypto(ctx: Ctx, ref: string): Promise<Response> {
  const order = await ctx.repo.getCryptoOrder(ref);
  if (!order) throw new ApiError("unknown_reference", "No such order.", 404);

  if (order.status === "granted") {
    const ent = await ctx.repo.getUser(order.email);
    if (isEntitled(ent)) return mintToken(ctx, ent);
    return pending(ctx);
  }
  if (order.status === "failed" || order.status === "refunded" || order.status === "expired") {
    throw new ApiError("not_paid", "This payment did not complete.", 402);
  }
  return pending(ctx); // "pending" or "partially_paid"
}

export async function restore(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(request);
  const email = normalizeEmail(requireString(body, "email"));
  const ref = requireString(body, "ref");

  const ent = await ctx.repo.getUser(email);
  // The ref must belong to this e-mail's own record. Compare the e-mail in constant time, so this
  // cannot be used to probe which addresses have a record by timing.
  const emailMatches = !!ent && timingSafeEqual(email, ent.email);
  if (!ent || !emailMatches || !ent.refs.includes(ref)) {
    throw new ApiError("unknown_reference", "No subscription matches that e-mail and reference.", 404);
  }
  if (!isEntitled(ent)) {
    throw new ApiError("not_active", "This subscription is no longer active.", 402);
  }
  return mintToken(ctx, ent);
}
