// Wires the endpoints together. `handleRequest` is the whole app; the Worker entry (index.ts) and the
// test suite both call it. `now` is injectable so tests pin the clock.

import type { Env } from "./env";
import { corsHeaders, json, Router } from "./http";
import { Repo } from "./store";
import type { KV } from "./store";
import { isTestKey } from "./license";
import type { Ctx } from "./handlers/common";
import { checkoutCrypto, checkoutPaypal, checkoutStripe } from "./handlers/checkout";
import { webhookNowPayments, webhookPaypal, webhookStripe } from "./handlers/webhooks";
import { claim, restore } from "./handlers/license";
import { portalStripe } from "./handlers/portal";

function configResponse(ctx: Ctx): Response {
  const env = ctx.env;
  return json(
    {
      plans: { monthly: { usd: 10 }, yearly: { usd: 79 } },
      providers: {
        stripe: !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_YEARLY),
        paypal: !!(
          env.PAYPAL_CLIENT_ID &&
          env.PAYPAL_CLIENT_SECRET &&
          env.PAYPAL_PLAN_MONTHLY &&
          env.PAYPAL_PLAN_YEARLY
        ),
        crypto: !!env.NOWPAYMENTS_API_KEY,
      },
      testMode: isTestKey(env.LICENSE_PRIVATE_JWK),
    },
    200,
    ctx.cors,
  );
}

export interface HandleOptions {
  /** unix seconds; defaults to the wall clock. */
  now?: number;
}

export async function handleRequest(
  request: Request,
  env: Env,
  options: HandleOptions = {},
): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, env.SITE_ORIGIN);
  const ctx: Ctx = {
    env,
    repo: new Repo(env.ENTITLEMENTS as unknown as KV),
    cors,
    now: options.now ?? Math.floor(Date.now() / 1000),
    workerOrigin: new URL(request.url).origin,
  };

  const router = new Router()
    .get("/config", async () => configResponse(ctx))
    .post("/checkout/stripe", (req) => checkoutStripe(req, ctx))
    .post("/checkout/paypal", (req) => checkoutPaypal(req, ctx))
    .post("/checkout/crypto", (req) => checkoutCrypto(req, ctx))
    .post("/webhooks/stripe", (req) => webhookStripe(req, ctx))
    .post("/webhooks/paypal", (req) => webhookPaypal(req, ctx))
    .post("/webhooks/nowpayments", (req) => webhookNowPayments(req, ctx))
    .post("/license/claim", (req) => claim(req, ctx))
    .post("/license/restore", (req) => restore(req, ctx))
    .post("/portal/stripe", (req) => portalStripe(req, ctx));

  return router.handle(request, cors);
}
