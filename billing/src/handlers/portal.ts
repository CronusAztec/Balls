// /portal/stripe: a Stripe Billing Portal link so a customer can manage or cancel their card plan.
//
// The portal shows the customer's invoices (name and address), payment method and lets them cancel, so
// knowing an e-mail is not enough: like /license/restore, the request must also carry a reference of
// that e-mail's card subscription (its Checkout Session id or its subscription id – the site keeps the
// one the licence was claimed with), and the portal opens for that subscription's customer.

import { ApiError, json, readJsonBody } from "../http";
import { timingSafeEqual } from "../crypto";
import { normalizeEmail, subscriptionOwner } from "../entitlements";
import * as stripe from "../providers/stripe";
import type { Ctx } from "./common";
import { optionalString, requireString, validateReturnUrl } from "./common";

export async function portalStripe(request: Request, ctx: Ctx): Promise<Response> {
  const secret = ctx.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ApiError("provider_unavailable", "Card payments are not configured.", 503);

  const body = await readJsonBody(request);
  const email = normalizeEmail(requireString(body, "email"));
  const ref = (optionalString(body, "ref") ?? "").trim();
  // Where the portal's "return" link goes: the page the site names (its pricing page – the site may
  // live under a path, e.g. /Balls/ on GitHub Pages), checked like a checkout's returnUrl; without one,
  // the site's origin.
  const requested = optionalString(body, "returnUrl");
  const returnUrl = requested
    ? validateReturnUrl(requested, ctx.env)
    : ctx.env.SITE_ORIGIN?.replace(/\/$/, "") || ctx.workerOrigin;

  const facts = await ctx.repo.factsFor(email);
  const subscription = ref
    ? facts.subscriptions.find(
        (s) =>
          s.provider === "stripe" &&
          (s.id === ref || !!s.link?.refs.includes(ref)) &&
          timingSafeEqual(subscriptionOwner(s) ?? "", email),
      )
    : undefined;
  const customerId = subscription?.link?.customerId;
  if (!customerId) {
    throw new ApiError("unknown_reference", "No card subscription matches that e-mail and reference.", 404);
  }

  const url = await stripe.createPortalSession(secret, customerId, returnUrl);
  return json({ url }, 200, ctx.cors);
}
