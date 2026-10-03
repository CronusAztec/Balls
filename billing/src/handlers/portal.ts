// /portal/stripe: a Stripe Billing Portal link so a customer can manage or cancel their card plan.

import { ApiError, json, readJsonBody } from "../http";
import { normalizeEmail } from "../entitlements";
import * as stripe from "../providers/stripe";
import type { Ctx } from "./common";
import { requireString } from "./common";

export async function portalStripe(request: Request, ctx: Ctx): Promise<Response> {
  const secret = ctx.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ApiError("provider_unavailable", "Card payments are not configured.", 503);

  const body = await readJsonBody(request);
  const email = normalizeEmail(requireString(body, "email"));
  const ent = await ctx.repo.getUser(email);
  if (!ent || !ent.customerId) {
    throw new ApiError("unknown_reference", "No card subscription for that e-mail.", 404);
  }

  const returnUrl = ctx.env.SITE_ORIGIN?.replace(/\/$/, "") || ctx.workerOrigin;
  const url = await stripe.createPortalSession(secret, ent.customerId, returnUrl);
  return json({ url }, 200, ctx.cors);
}
