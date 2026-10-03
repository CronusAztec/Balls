// The three webhook endpoints. Each verifies the provider's signature, is idempotent per event, and
// records the facts the event carries – each under its own key (store.ts), never a shared record – for
// /license/claim and /license/restore to turn into a token.

import { ApiError, json, readBodyText } from "../http";
import { cryptoBase, isPlan, normalizeEmail, planDays } from "../entitlements";
import type { EntitlementStatus, Plan } from "../entitlements";
import * as stripe from "../providers/stripe";
import * as paypal from "../providers/paypal";
import * as nowpayments from "../providers/nowpayments";
import type { Ctx } from "./common";
import { asRecord, asString, isoToUnix, planFromPaypalPlanId, planFromStripePrice } from "./common";

function received(ctx: Ctx): Response {
  return json({ received: true }, 200, ctx.cors);
}

/** An event the Worker cannot place yet (its buyer is not known): 503, so the provider delivers it again later. */
function notYet(): never {
  throw new ApiError("not_ready", "The event cannot be placed yet; it will be retried.", 503);
}

// --- Stripe -----------------------------------------------------------------------------------

function mapStripeStatus(status: string | undefined, cancelAtPeriodEnd: boolean): EntitlementStatus {
  if (cancelAtPeriodEnd) return "cancel_at_period_end";
  switch (status) {
    case "active":
    case "trialing":
    case "past_due": // still subscribed during dunning; the paid period governs access
      return "active";
    case "paused":
      return "suspended";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    default:
      return "active";
  }
}

/** The plan of an invoice's lines – only this Worker's prices count (undefined: not our product). */
function invoicePlan(invoice: Record<string, unknown>, ctx: Ctx): Plan | undefined {
  for (const line of stripe.invoiceLines(invoice)) {
    const plan = planFromStripePrice(stripe.linePriceId(line), ctx.env);
    if (plan) return plan;
  }
  return undefined;
}

/** Whether a subscription event concerns one of ours: a known subscription, or one of our prices. */
async function isOurStripeSubscription(ctx: Ctx, subscription: Record<string, unknown>, id: string): Promise<boolean> {
  if (await ctx.repo.getLink("stripe", id)) return true;
  return stripe.subscriptionPriceIds(subscription).some((price) => !!planFromStripePrice(price, ctx.env));
}

export async function webhookStripe(request: Request, ctx: Ctx): Promise<Response> {
  if (!ctx.env.STRIPE_WEBHOOK_SECRET) {
    throw new ApiError("provider_unavailable", "Stripe is not configured.", 503);
  }
  const raw = await readBodyText(request);
  const ok = await stripe.verifyWebhookSignature(
    request.headers.get("stripe-signature"),
    raw,
    ctx.env.STRIPE_WEBHOOK_SECRET,
    ctx.now,
  );
  if (!ok) throw new ApiError("invalid_signature", "Signature verification failed.", 400);

  const event = asRecord(JSON.parse(raw));
  const eventId = asString(event.id);
  if (!eventId) throw new ApiError("invalid_event", "Event has no id.", 400);
  if (!(await ctx.repo.markEventSeen("stripe", eventId))) return received(ctx);
  try {
    return await processStripeEvent(ctx, event);
  } catch (err) {
    await ctx.repo.forgetEvent("stripe", eventId); // release the key so Stripe's retry re-processes
    throw err;
  }
}

async function processStripeEvent(ctx: Ctx, event: Record<string, unknown>): Promise<Response> {
  const obj = asRecord(asRecord(event.data).object);
  const eventTime = typeof event.created === "number" ? event.created : ctx.now;
  switch (event.type) {
    case "checkout.session.completed": {
      // Our sessions carry metadata.plan (createCheckoutSession); anything else is another product's.
      const plan = asString(asRecord(obj.metadata).plan);
      const email = asString(asRecord(obj.customer_details).email) ?? asString(obj.customer_email);
      const subscriptionId = asString(obj.subscription) ?? asString(asRecord(obj.subscription).id);
      if (email && subscriptionId && isPlan(plan)) {
        await ctx.repo.linkSubscription("stripe", subscriptionId, {
          email,
          plan,
          customerId: asString(obj.customer) ?? asString(asRecord(obj.customer).id),
          refs: [asString(obj.id)].filter((r): r is string => !!r),
        });
      }
      return received(ctx);
    }
    case "invoice.paid": {
      // The only event that moves a subscription's paid period: the invoice for it has been paid.
      const subscriptionId = stripe.invoiceSubscriptionId(obj);
      if (!subscriptionId) return received(ctx);
      const link = await ctx.repo.getLink("stripe", subscriptionId);
      const plan = invoicePlan(obj, ctx);
      if (!link && !plan) return received(ctx); // neither a known subscription nor one of our prices
      const email = link?.email ?? asString(obj.customer_email);
      if (!email) notYet(); // the checkout event that names the buyer has not been processed yet
      let periodEnd = stripe.invoicePeriodEnd(obj);
      if (periodEnd === undefined && ctx.env.STRIPE_SECRET_KEY) {
        const sub = await stripe.getSubscription(ctx.env.STRIPE_SECRET_KEY, subscriptionId);
        periodEnd = sub ? stripe.subscriptionPeriodEnd(sub) : undefined;
      }
      if (periodEnd !== undefined) {
        await ctx.repo.recordPaid("stripe", subscriptionId, { email, periodEnd, plan: plan ?? link?.plan });
      }
      return received(ctx);
    }
    case "customer.subscription.updated": {
      // Only the status and the cancel flag: Stripe sends this when the subscription cycles into its
      // next period – before the renewal invoice is paid – so the period itself waits for invoice.paid.
      const subscriptionId = asString(obj.id);
      if (subscriptionId && (await isOurStripeSubscription(ctx, obj, subscriptionId))) {
        await ctx.repo.recordState("stripe", subscriptionId, {
          status: mapStripeStatus(asString(obj.status), obj.cancel_at_period_end === true),
          at: eventTime,
        });
      }
      return received(ctx);
    }
    case "customer.subscription.deleted": {
      // Ends this subscription's access now – only this subscription's: other periods of the e-mail stay.
      const subscriptionId = asString(obj.id);
      if (subscriptionId && (await isOurStripeSubscription(ctx, obj, subscriptionId))) {
        await ctx.repo.recordEnded("stripe", subscriptionId, typeof obj.ended_at === "number" ? obj.ended_at : ctx.now);
        await ctx.repo.recordState("stripe", subscriptionId, { status: "canceled", at: eventTime });
      }
      return received(ctx);
    }
    default:
      return received(ctx);
  }
}

// --- PayPal -----------------------------------------------------------------------------------

export async function webhookPaypal(request: Request, ctx: Ctx): Promise<Response> {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID } = ctx.env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_WEBHOOK_ID) {
    throw new ApiError("provider_unavailable", "PayPal is not configured.", 503);
  }
  const raw = await readBodyText(request);
  const tx = paypal.readTransmissionHeaders(request.headers);
  if (!tx) throw new ApiError("invalid_signature", "Missing transmission headers.", 400);

  const event = asRecord(JSON.parse(raw));
  const apiBase = paypal.paypalApiBase(ctx.env.PAYPAL_ENV);
  const token = await paypal.getAccessToken(apiBase, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
  const verified = await paypal.verifyWebhookSignature(apiBase, token, PAYPAL_WEBHOOK_ID, tx, event);
  if (!verified) throw new ApiError("invalid_signature", "Signature verification failed.", 400);

  const eventId = asString(event.id);
  if (!eventId) throw new ApiError("invalid_event", "Event has no id.", 400);
  if (!(await ctx.repo.markEventSeen("paypal", eventId))) return received(ctx);
  try {
    return await processPaypalEvent(ctx, event, apiBase, token);
  } catch (err) {
    await ctx.repo.forgetEvent("paypal", eventId); // release the key so PayPal's retry re-processes
    throw err;
  }
}

async function processPaypalEvent(
  ctx: Ctx,
  event: Record<string, unknown>,
  apiBase: string,
  token: string,
): Promise<Response> {
  const resource = asRecord(event.resource);
  const eventTime = isoToUnix(event.create_time) ?? ctx.now;
  switch (event.event_type) {
    case "BILLING.SUBSCRIPTION.ACTIVATED": {
      const email = asString(asRecord(resource.subscriber).email_address);
      const subscriptionId = asString(resource.id);
      if (email && subscriptionId) {
        const plan = planFromPaypalPlanId(asString(resource.plan_id), ctx.env);
        await ctx.repo.linkSubscription("paypal", subscriptionId, {
          email,
          plan,
          refs: [asString(resource.custom_id)].filter((r): r is string => !!r),
        });
        const periodEnd = paypal.paidThrough({ ...resource, status: resource.status ?? "ACTIVE" });
        if (periodEnd !== null) await ctx.repo.recordPaid("paypal", subscriptionId, { email, periodEnd, plan });
      }
      return received(ctx);
    }
    case "PAYMENT.SALE.COMPLETED": {
      // A renewal (or the first) payment came in: the subscription's next billing time is paid for.
      const subscriptionId = asString(resource.billing_agreement_id);
      if (!subscriptionId) return received(ctx);
      const link = await ctx.repo.getLink("paypal", subscriptionId);
      const sub = await paypal.getSubscription(apiBase, token, subscriptionId);
      if (!sub) return received(ctx);
      const plan = planFromPaypalPlanId(asString(sub.plan_id), ctx.env);
      if (!link && !plan) return received(ctx); // not one of our plans
      const email = link?.email ?? asString(asRecord(sub.subscriber).email_address);
      if (!email) notYet();
      if (!link) {
        // the sale beat the activation: link it now (the same facts the activation writes)
        await ctx.repo.linkSubscription("paypal", subscriptionId, {
          email,
          plan,
          refs: [asString(sub.custom_id)].filter((r): r is string => !!r),
        });
      }
      const periodEnd = paypal.paidThrough(sub);
      if (periodEnd !== null) {
        await ctx.repo.recordPaid("paypal", subscriptionId, { email, periodEnd, plan: plan ?? link?.plan });
      }
      return received(ctx);
    }
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.EXPIRED": {
      // The paid period stays where it is: a cancelled subscription keeps access until it lapses.
      const subscriptionId = asString(resource.id);
      if (subscriptionId && (await ctx.repo.getLink("paypal", subscriptionId))) {
        const status: EntitlementStatus =
          event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED"
            ? "suspended"
            : event.event_type === "BILLING.SUBSCRIPTION.EXPIRED"
              ? "expired"
              : "canceled";
        await ctx.repo.recordState("paypal", subscriptionId, { status, at: eventTime });
      }
      return received(ctx);
    }
    default:
      return received(ctx);
  }
}

// --- NOWPayments (crypto) ---------------------------------------------------------------------

/** The statuses that mean the payment arrived. A payment reports both on its way; only the first grants. */
const GRANT_STATUSES = new Set(["finished", "confirmed"]);
const RECORD_STATUSES = new Set(["partially_paid", "failed", "refunded", "expired"]);

/** NOWPayments' payment id: a JSON number in its IPNs (a string in some), "" when there is none. */
export function ipnPaymentId(payload: Record<string, unknown>): string {
  const raw = payload.payment_id ?? payload.payment_id_string;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") return raw.trim();
  return "";
}

export async function webhookNowPayments(request: Request, ctx: Ctx): Promise<Response> {
  if (!ctx.env.NOWPAYMENTS_IPN_SECRET) {
    throw new ApiError("provider_unavailable", "Crypto payments are not configured.", 503);
  }
  const raw = await readBodyText(request);
  const payload = asRecord(JSON.parse(raw));
  const verified = await nowpayments.verifyIpnSignature(
    request.headers.get("x-nowpayments-sig"),
    payload,
    ctx.env.NOWPAYMENTS_IPN_SECRET,
  );
  if (!verified) throw new ApiError("invalid_signature", "Signature verification failed.", 400);

  const orderId = asString(payload.order_id);
  const paymentId = ipnPaymentId(payload);
  const status = asString(payload.payment_status) ?? "";
  if (!orderId) return received(ctx);

  // Idempotent per order + payment + status (never a key shared by every buyer).
  const eventKey = `${orderId}:${paymentId || "-"}:${status}`;
  if (!(await ctx.repo.markEventSeen("nowpayments", eventKey))) return received(ctx);
  try {
    return await processNowPaymentsEvent(ctx, orderId, paymentId, status);
  } catch (err) {
    await ctx.repo.forgetEvent("nowpayments", eventKey); // release the key so a retry re-processes
    throw err;
  }
}

async function processNowPaymentsEvent(
  ctx: Ctx,
  orderId: string,
  paymentId: string,
  status: string,
): Promise<Response> {
  const order = await ctx.repo.getCryptoOrder(orderId);
  if (!order) return received(ctx);
  if (paymentId && !order.paymentIds.includes(paymentId)) order.paymentIds.push(paymentId);

  if (GRANT_STATUSES.has(status)) {
    // One payment buys one period: "confirmed" and "finished" both arrive, only the first grants. The
    // grant is a key of its own, so even both arriving at once write the same single grant.
    const grantId = paymentId || `order-${orderId}`;
    if (!(await ctx.repo.getCryptoGrant(grantId))) {
      const email = normalizeEmail(order.email);
      const base = cryptoBase(await ctx.repo.factsFor(email), ctx.now);
      await ctx.repo.putCryptoGrant(grantId, {
        email,
        orderId,
        paymentId,
        plan: order.plan,
        days: planDays(order.plan),
        base,
        grantedAt: ctx.now,
      });
    }
    order.status = "granted";
  } else if (RECORD_STATUSES.has(status) && order.status !== "granted") {
    order.status = status as typeof order.status;
  }
  // "waiting", "confirming", "sending" leave the order as it is (the payment id is still recorded).

  await ctx.repo.putCryptoOrder(orderId, order);
  return received(ctx);
}
