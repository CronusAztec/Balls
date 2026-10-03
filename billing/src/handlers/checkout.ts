// The three checkout endpoints. Each validates the request, calls the provider and returns { url }.

import { flagOn, providerReady } from "../env";
import { ApiError, json, readJsonBody } from "../http";
import { randomId } from "../crypto";
import * as stripe from "../providers/stripe";
import * as paypal from "../providers/paypal";
import * as nowpayments from "../providers/nowpayments";
import { planDays } from "../entitlements";
import type { Ctx } from "./common";
import {
  appendQuery,
  optionalString,
  readLocale,
  requirePlan,
  requireString,
  validateReturnUrl,
} from "./common";

const BRAND_NAME = "JumpingBallsLive";

export async function checkoutStripe(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(request);
  const plan = requirePlan(body);
  const locale = readLocale(body);
  const email = optionalString(body, "email");
  const returnUrl = validateReturnUrl(requireString(body, "returnUrl"), ctx.env);

  const { STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY } = ctx.env;
  // the webhook secret too: a payment whose webhook cannot be verified would never be recorded
  if (!providerReady(ctx.env, "stripe") || !STRIPE_SECRET_KEY || !STRIPE_PRICE_MONTHLY || !STRIPE_PRICE_YEARLY) {
    throw new ApiError("provider_unavailable", "Card payments are not configured.", 503);
  }
  const priceId = plan === "yearly" ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;

  const url = await stripe.createCheckoutSession(STRIPE_SECRET_KEY, {
    priceId,
    // Stripe substitutes the session id into the literal {CHECKOUT_SESSION_ID} placeholder.
    successUrl: appendQuery(returnUrl, "claim=stripe&ref={CHECKOUT_SESSION_ID}"),
    cancelUrl: returnUrl,
    plan,
    locale,
    email,
    automaticTax: flagOn(ctx.env.STRIPE_AUTOMATIC_TAX),
  });
  return json({ url }, 200, ctx.cors);
}

export async function checkoutPaypal(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(request);
  const plan = requirePlan(body);
  readLocale(body); // validated; PayPal has no locale field on the subscription create
  const returnUrl = validateReturnUrl(requireString(body, "returnUrl"), ctx.env);

  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PLAN_MONTHLY, PAYPAL_PLAN_YEARLY } = ctx.env;
  if (!providerReady(ctx.env, "paypal") || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_PLAN_MONTHLY || !PAYPAL_PLAN_YEARLY) {
    throw new ApiError("provider_unavailable", "PayPal is not configured.", 503);
  }
  const planId = plan === "yearly" ? PAYPAL_PLAN_YEARLY : PAYPAL_PLAN_MONTHLY;

  const apiBase = paypal.paypalApiBase(ctx.env.PAYPAL_ENV);
  const token = await paypal.getAccessToken(apiBase, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
  const orderId = randomId();
  const result = await paypal.createSubscription(apiBase, token, {
    planId,
    customId: orderId,
    // PayPal appends &subscription_id=... to this on the way back; the claim accepts either id.
    returnUrl: appendQuery(returnUrl, `claim=paypal&ref=${orderId}`),
    cancelUrl: returnUrl,
    brandName: BRAND_NAME,
  });

  // Remember both directions: our order id -> the subscription, and each id -> (no e-mail yet; the
  // webhook fills that once the buyer approves and PayPal tells us their address).
  await ctx.repo.putPaypalOrder(orderId, { subscriptionId: result.id });
  return json({ url: result.approveUrl }, 200, ctx.cors);
}

export async function checkoutCrypto(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonBody(request);
  const plan = requirePlan(body);
  const locale = readLocale(body);
  const email = requireString(body, "email");
  const returnUrl = validateReturnUrl(requireString(body, "returnUrl"), ctx.env);

  const { NOWPAYMENTS_API_KEY } = ctx.env;
  if (!providerReady(ctx.env, "crypto") || !NOWPAYMENTS_API_KEY) {
    throw new ApiError("provider_unavailable", "Crypto payments are not configured.", 503);
  }
  const priceAmount = plan === "yearly" ? 79 : 10;
  const apiBase = nowpayments.nowPaymentsApiBase(flagOn(ctx.env.NOWPAYMENTS_SANDBOX));
  const orderId = randomId();

  const url = await nowpayments.createInvoice(apiBase, NOWPAYMENTS_API_KEY, {
    priceAmount,
    orderId,
    orderDescription: `${BRAND_NAME} Pro (${plan}, ${planDays(plan)} days) [${locale}]`,
    ipnCallbackUrl: `${ctx.workerOrigin}/webhooks/nowpayments`,
    successUrl: appendQuery(returnUrl, `claim=crypto&ref=${orderId}`),
    cancelUrl: returnUrl,
  });

  await ctx.repo.putCryptoOrder(orderId, {
    email,
    plan,
    status: "pending",
    paymentIds: [],
  });
  return json({ url }, 200, ctx.cors);
}
