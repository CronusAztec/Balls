// /license/claim and /license/restore: turn a verified payment into a signed licence token.
//
// The token is always minted from the STORED facts of the buyer's e-mail (written by the webhooks and
// by the claim from what it fetched from the provider itself), never from anything in the request, so a
// forged ref or e-mail cannot conjure a licence. A claim signs only once THIS purchase's own paid
// period is recorded and reaches past now – a returning customer's old, lapsed records never stand in
// for a payment that has not been recorded yet.

import { ApiError, json, readJsonBody } from "../http";
import { timingSafeEqual } from "../crypto";
import { deriveEntitlement, hasCurrentPeriod, isPlan, normalizeEmail } from "../entitlements";
import type { Entitlement, SubscriptionEnded, SubscriptionFacts, SubscriptionPaid, SubscriptionProvider } from "../entitlements";
import { withSubscription } from "../store";
import { parsePrivateJwk, signLicense } from "../license";
import * as stripe from "../providers/stripe";
import * as paypal from "../providers/paypal";
import type { Ctx } from "./common";
import { asRecord, asString, isoToUnix, planFromPaypalPlanId, planFromStripePrice, requireString } from "./common";

// APPROVED / APPROVAL_PENDING PayPal subscriptions this recent are still "pending", not failed.
const PAYPAL_PENDING_WINDOW_SECONDS = 15 * 60;
/** Stripe subscription states that will never be paid for again. */
const STRIPE_ENDED_STATES = new Set(["canceled", "unpaid", "incomplete_expired"]);

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

function notActive(): never {
  throw new ApiError("not_active", "This subscription is no longer active.", 402);
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

/**
 * The e-mail's entitlement with one subscription's facts as just written (put in directly, so KV's
 * propagation delay cannot hide them), and that subscription's own paid end.
 */
async function entitlementWith(
  ctx: Ctx,
  email: string,
  provider: SubscriptionProvider,
  id: string,
  written: Partial<Pick<SubscriptionFacts, "link" | "paid" | "ended">>,
): Promise<{ ent: Entitlement | null; ownEnd: number }> {
  const sub = await ctx.repo.getSubscriptionFacts(provider, id);
  if (written.link) sub.link = written.link;
  if (written.paid && (!sub.paid || written.paid.periodEnd > sub.paid.periodEnd)) sub.paid = written.paid;
  if (written.ended && (!sub.ended || written.ended.at < sub.ended.at)) sub.ended = written.ended;
  const ent = deriveEntitlement(email, withSubscription(await ctx.repo.factsFor(email), sub));
  const own = ent?.sources.find((s) => s.provider === provider && s.subscriptionId === id);
  return { ent, ownEnd: own?.periodEnd ?? 0 };
}

async function claimStripe(ctx: Ctx, ref: string): Promise<Response> {
  const secret = ctx.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ApiError("provider_unavailable", "Card payments are not configured.", 503);

  const session = await stripe.getCheckoutSession(secret, ref);
  if (!session) throw new ApiError("unknown_reference", "No such checkout session.", 404);
  if (session.status === "expired") throw new ApiError("not_paid", "This checkout was not completed.", 402);

  const email = asString(asRecord(session.customer_details).email) ?? asString(session.customer_email);
  const subscription = asRecord(session.subscription);
  const subscriptionId = asString(session.subscription) ?? asString(subscription.id);
  const settled =
    session.status === "complete" && (session.payment_status === "paid" || session.payment_status === "no_payment_required");
  if (!settled || !email || !subscriptionId) return pending(ctx);

  // Record what Stripe itself says about this purchase, so a webhook that is late (or lost) can neither
  // keep the claim waiting nor let an older record of the e-mail stand in for it.
  const metaPlan = asString(asRecord(session.metadata).plan);
  const invoice = asRecord(subscription.latest_invoice);
  const invoicePlan = stripe
    .invoiceLines(invoice)
    .map((line) => planFromStripePrice(stripe.linePriceId(line), ctx.env))
    .find((p) => !!p);
  const plan = invoicePlan ?? (isPlan(metaPlan) ? metaPlan : undefined);
  const link = await ctx.repo.linkSubscription("stripe", subscriptionId, {
    email,
    plan,
    customerId: asString(session.customer) ?? asString(asRecord(session.customer).id),
    refs: [asString(session.id) ?? ref],
  });
  let paid: SubscriptionPaid | null = null;
  // Only a PAID invoice moves the period: the subscription's own current period moves when it cycles,
  // before the renewal is paid.
  const invoiceEnd = invoice.status === "paid" ? stripe.invoicePeriodEnd(invoice) : undefined;
  if (invoiceEnd !== undefined) paid = await ctx.repo.recordPaid("stripe", subscriptionId, { email: link.email, periodEnd: invoiceEnd, plan });
  const subStatus = asString(subscription.status);
  let ended: SubscriptionEnded | null = null;
  if (subStatus === "canceled" && typeof subscription.ended_at === "number") {
    await ctx.repo.recordEnded("stripe", subscriptionId, subscription.ended_at);
    ended = { at: subscription.ended_at };
  }

  const { ent, ownEnd } = await entitlementWith(ctx, link.email, "stripe", subscriptionId, { link, paid, ended });
  if (ent && ownEnd > ctx.now) return mintToken(ctx, ent);
  if (subStatus && STRIPE_ENDED_STATES.has(subStatus)) notActive();
  return pending(ctx); // the payment is not recorded yet (invoice.paid will move the period)
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
  const subscriberEmail = asString(asRecord(sub.subscriber).email_address);
  const stored = await ctx.repo.getLink("paypal", subscriptionId);
  const email = stored?.email ?? subscriberEmail;
  if (status === "ACTIVE" && email) {
    // Record what PayPal says about this subscription – its buyer, plan and paid-through time – so
    // the claim does not depend on the webhooks having arrived (PayPal's often lag the redirect).
    const plan = planFromPaypalPlanId(asString(sub.plan_id), ctx.env);
    const refs = [order ? ref : undefined, asString(sub.custom_id)].filter((r): r is string => !!r);
    const link = await ctx.repo.linkSubscription("paypal", subscriptionId, { email, plan, refs });
    const periodEnd = paypal.paidThrough(sub);
    const paid = periodEnd !== null ? await ctx.repo.recordPaid("paypal", subscriptionId, { email: link.email, periodEnd, plan }) : null;
    const { ent, ownEnd } = await entitlementWith(ctx, link.email, "paypal", subscriptionId, { link, paid });
    if (ent && ownEnd > ctx.now) return mintToken(ctx, ent);
    return pending(ctx); // the first payment has not cleared yet
  }
  if (email && stored) {
    // cancelled or suspended: what was paid for still counts until it runs out
    const { ent, ownEnd } = await entitlementWith(ctx, email, "paypal", subscriptionId, {});
    if (ent && ownEnd > ctx.now) return mintToken(ctx, ent);
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

  const facts = await ctx.repo.factsFor(order.email);
  if (facts.grants.some((g) => g.orderId === ref)) {
    const ent = deriveEntitlement(order.email, facts);
    const crypto = ent?.sources.find((s) => s.provider === "crypto");
    if (ent && crypto && crypto.periodEnd > ctx.now) return mintToken(ctx, ent);
    notActive(); // granted long ago, and the prepaid time has run out
  }
  if (order.status === "failed" || order.status === "refunded" || order.status === "expired") {
    throw new ApiError("not_paid", "This payment did not complete.", 402);
  }
  return pending(ctx); // waiting for the network to confirm the payment
}

export async function restore(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(request);
  const email = normalizeEmail(requireString(body, "email"));
  const ref = requireString(body, "ref");

  const ent = await ctx.repo.entitlementFor(email);
  // The ref must belong to this e-mail's own purchases. Compare the e-mail in constant time, so this
  // cannot be used to probe which addresses have a record by timing.
  const emailMatches = !!ent && timingSafeEqual(email, ent.email);
  if (!ent || !emailMatches || !ent.refs.includes(ref.trim())) {
    throw new ApiError("unknown_reference", "No subscription matches that e-mail and reference.", 404);
  }
  if (!hasCurrentPeriod(ent, ctx.now)) notActive();
  return mintToken(ctx, ent);
}
