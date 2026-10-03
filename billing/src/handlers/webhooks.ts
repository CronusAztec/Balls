// The three webhook endpoints. Each verifies the provider's signature, is idempotent per event id,
// and writes the entitlement that /license/claim and /license/restore later turn into a token.

import { ApiError, json, readBodyText } from "../http";
import {
  addRef,
  cryptoPeriodEnd,
  newEntitlement,
  normalizeEmail,
} from "../entitlements";
import type { Entitlement, EntitlementStatus, Plan, Provider } from "../entitlements";
import * as stripe from "../providers/stripe";
import * as paypal from "../providers/paypal";
import * as nowpayments from "../providers/nowpayments";
import type { Ctx } from "./common";
import { isoToUnix } from "./common";

// --- shared entitlement writer ----------------------------------------------------------------

interface GrantInput {
  email: string;
  provider: Provider;
  plan?: Plan;
  periodEnd?: number;
  status?: EntitlementStatus;
  customerId?: string;
  subscriptionId?: string;
  refs?: string[];
}

/** Create or update the entitlement for an e-mail, only touching the fields that are supplied. */
async function writeGrant(ctx: Ctx, input: GrantInput): Promise<void> {
  const email = normalizeEmail(input.email);
  let ent: Entitlement | null = await ctx.repo.getUser(email);
  if (!ent) ent = newEntitlement(email, input.plan ?? "monthly", input.provider, ctx.now);
  if (input.plan) ent.plan = input.plan;
  ent.provider = input.provider;
  if (input.periodEnd !== undefined) ent.periodEnd = input.periodEnd;
  if (input.status !== undefined) ent.status = input.status;
  if (input.customerId !== undefined) ent.customerId = input.customerId;
  if (input.subscriptionId !== undefined) ent.subscriptionId = input.subscriptionId;
  for (const ref of input.refs ?? []) {
    addRef(ent, ref);
    await ctx.repo.putRef(input.provider, ref, email);
  }
  ent.updatedAt = ctx.now;
  await ctx.repo.putUser(ent);
}

function received(ctx: Ctx): Response {
  return json({ received: true }, 200, ctx.cors);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// --- Stripe -----------------------------------------------------------------------------------

function planFromStripePrice(priceId: string | undefined, ctx: Ctx): Plan | undefined {
  if (!priceId) return undefined;
  if (priceId === ctx.env.STRIPE_PRICE_YEARLY) return "yearly";
  if (priceId === ctx.env.STRIPE_PRICE_MONTHLY) return "monthly";
  return undefined;
}

function mapStripeStatus(status: string | undefined, cancelAtPeriodEnd: boolean): EntitlementStatus {
  if (cancelAtPeriodEnd) return "cancel_at_period_end";
  switch (status) {
    case "active":
    case "trialing":
    case "past_due": // still subscribed during dunning; the period governs access
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

/** The period end of a paid invoice: from its line items, or by fetching the subscription. */
async function stripeInvoicePeriodEnd(
  ctx: Ctx,
  invoice: Record<string, unknown>,
  subscriptionId: string | undefined,
): Promise<number | undefined> {
  const lines = asRecord(invoice.lines).data;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      const end = asRecord(asRecord(line).period).end;
      if (typeof end === "number") return end;
    }
  }
  if (subscriptionId && ctx.env.STRIPE_SECRET_KEY) {
    const sub = await stripe.getSubscription(ctx.env.STRIPE_SECRET_KEY, subscriptionId);
    const end = sub?.current_period_end;
    if (typeof end === "number") return end;
  }
  return undefined;
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
  switch (event.type) {
    case "checkout.session.completed": {
      const email =
        asString(asRecord(obj.customer_details).email) ?? asString(obj.customer_email);
      const plan = asString(asRecord(obj.metadata).plan) as Plan | undefined;
      const subscriptionId = asString(obj.subscription);
      if (email) {
        await writeGrant(ctx, {
          email,
          provider: "stripe",
          plan: plan === "yearly" || plan === "monthly" ? plan : undefined,
          status: "active",
          customerId: asString(obj.customer),
          subscriptionId,
          refs: [asString(obj.id), subscriptionId].filter(Boolean) as string[],
        });
      }
      return received(ctx);
    }
    case "invoice.paid": {
      const subscriptionId = asString(obj.subscription);
      const email =
        (subscriptionId ? await ctx.repo.getRefEmail("stripe", subscriptionId) : null) ??
        asString(obj.customer_email);
      if (email) {
        const periodEnd = await stripeInvoicePeriodEnd(ctx, obj, subscriptionId);
        const linePrice = asString(
          asRecord(asRecord((asRecord(obj.lines).data as unknown[])?.[0]).price).id,
        );
        await writeGrant(ctx, {
          email,
          provider: "stripe",
          plan: planFromStripePrice(linePrice, ctx),
          periodEnd,
          status: "active",
          subscriptionId,
          refs: subscriptionId ? [subscriptionId] : [],
        });
      }
      return received(ctx);
    }
    case "customer.subscription.updated": {
      const subscriptionId = asString(obj.id);
      const email = subscriptionId ? await ctx.repo.getRefEmail("stripe", subscriptionId) : null;
      if (email) {
        const periodEnd = typeof obj.current_period_end === "number" ? obj.current_period_end : undefined;
        await writeGrant(ctx, {
          email,
          provider: "stripe",
          periodEnd,
          status: mapStripeStatus(asString(obj.status), obj.cancel_at_period_end === true),
          subscriptionId,
        });
      }
      return received(ctx);
    }
    case "customer.subscription.deleted": {
      const subscriptionId = asString(obj.id);
      const email = subscriptionId ? await ctx.repo.getRefEmail("stripe", subscriptionId) : null;
      if (email) {
        await writeGrant(ctx, {
          email,
          provider: "stripe",
          periodEnd: ctx.now,
          status: "canceled",
          subscriptionId,
        });
      }
      return received(ctx);
    }
    default:
      return received(ctx);
  }
}

// --- PayPal -----------------------------------------------------------------------------------

function planFromPaypalPlanId(planId: string | undefined, ctx: Ctx): Plan | undefined {
  if (!planId) return undefined;
  if (planId === ctx.env.PAYPAL_PLAN_YEARLY) return "yearly";
  if (planId === ctx.env.PAYPAL_PLAN_MONTHLY) return "monthly";
  return undefined;
}

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
  switch (event.event_type) {
    case "BILLING.SUBSCRIPTION.ACTIVATED": {
      const email = asString(asRecord(resource.subscriber).email_address);
      const subscriptionId = asString(resource.id);
      const customId = asString(resource.custom_id);
      if (email && subscriptionId) {
        const periodEnd = isoToUnix(asRecord(resource.billing_info).next_billing_time) ?? undefined;
        await writeGrant(ctx, {
          email,
          provider: "paypal",
          plan: planFromPaypalPlanId(asString(resource.plan_id), ctx),
          periodEnd,
          status: "active",
          subscriptionId,
          refs: [subscriptionId, customId].filter(Boolean) as string[],
        });
      }
      return received(ctx);
    }
    case "PAYMENT.SALE.COMPLETED": {
      const subscriptionId = asString(resource.billing_agreement_id);
      const email = subscriptionId ? await ctx.repo.getRefEmail("paypal", subscriptionId) : null;
      if (email && subscriptionId) {
        const sub = await paypal.getSubscription(apiBase, token, subscriptionId);
        const periodEnd =
          isoToUnix(asRecord(sub?.billing_info).next_billing_time) ?? undefined;
        await writeGrant(ctx, {
          email,
          provider: "paypal",
          periodEnd,
          status: "active",
          subscriptionId,
        });
      }
      return received(ctx);
    }
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.EXPIRED": {
      const subscriptionId = asString(resource.id);
      const email = subscriptionId ? await ctx.repo.getRefEmail("paypal", subscriptionId) : null;
      if (email) {
        const status: EntitlementStatus =
          event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED"
            ? "suspended"
            : event.event_type === "BILLING.SUBSCRIPTION.EXPIRED"
              ? "expired"
              : "canceled";
        // The period end stays where it is: a cancelled subscription keeps access until it lapses.
        await writeGrant(ctx, { email, provider: "paypal", status, subscriptionId });
      }
      return received(ctx);
    }
    default:
      return received(ctx);
  }
}

// --- NOWPayments (crypto) ---------------------------------------------------------------------

const GRANT_STATUSES = new Set(["finished", "confirmed"]);
const RECORD_STATUSES = new Set(["partially_paid", "failed", "refunded", "expired"]);

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
  const paymentId = asString(payload.payment_id) ?? asString(payload.payment_id_string) ?? "";
  const status = asString(payload.payment_status) ?? "";
  if (!orderId) return received(ctx);

  // Idempotent per payment + status: the same payment moves through several statuses, each once.
  const eventKey = `${paymentId}:${status}`;
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
    const current = await ctx.repo.getUser(order.email);
    const periodEnd = cryptoPeriodEnd(current?.periodEnd, order.plan, ctx.now);
    await writeGrant(ctx, {
      email: order.email,
      provider: "crypto",
      plan: order.plan,
      periodEnd,
      status: "active",
      refs: [orderId],
    });
    order.status = "granted";
  } else if (RECORD_STATUSES.has(status)) {
    order.status = status as typeof order.status;
  }
  // "waiting", "confirming", "sending" leave the order pending (the payment id is still recorded).

  await ctx.repo.putCryptoOrder(orderId, order);
  return received(ctx);
}
