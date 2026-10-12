// Wires the endpoints together. `handleRequest` is the whole app; the Worker entry (index.ts) and the
// test suite both call it. `now` is injectable so tests pin the clock.

import type { Env } from "./env";
import { providerReady } from "./env";
import { corsHeaders, json, Router } from "./http";
import type { RouteHandler } from "./http";
import { PLAN_USD } from "./config";
import { MemoryRateLimiter } from "./ratelimit";
import { healthResponse } from "./handlers/health";
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
      plans: { monthly: { usd: PLAN_USD.monthly }, yearly: { usd: PLAN_USD.yearly } }, // --- go-live-kit --- billing-config.json
      // On only with every secret it needs – the webhook's included (providerReady).
      providers: {
        stripe: providerReady(env, "stripe"),
        paypal: providerReady(env, "paypal"),
        crypto: providerReady(env, "crypto"),
      },
      testMode: isTestKey(env.LICENSE_PRIVATE_JWK),
    },
    200,
    ctx.cors,
  );
}

// --- go-live-kit --- Rate limits per connection (cf-connecting-ip) and 10 minutes, kept in this isolate's memory
// (ratelimit.ts says what that does and does not stop). Webhooks, /config and /health are never limited.
const WINDOW_SECONDS = 600;
export const RATE_LIMITS = { checkoutPer10Min: 10, licensePer10Min: 60, portalPer10Min: 10 } as const;
const checkoutLimiter = new MemoryRateLimiter(RATE_LIMITS.checkoutPer10Min, WINDOW_SECONDS);
const licenseLimiter = new MemoryRateLimiter(RATE_LIMITS.licensePer10Min, WINDOW_SECONDS);
const portalLimiter = new MemoryRateLimiter(RATE_LIMITS.portalPer10Min, WINDOW_SECONDS);

export interface RateLimiters {
  checkout: MemoryRateLimiter;
  license: MemoryRateLimiter;
  portal: MemoryRateLimiter;
}

/** The 429 a connection over its limit gets: a stable code, a plain message, Retry-After and the CORS headers. */
function rateLimited(retryAfterSeconds: number, cors: Record<string, string>): Response {
  return json(
    { error: "rate_limited", message: "Too many requests from this connection. Please wait a minute and try again." },
    429,
    { ...cors, "Retry-After": String(retryAfterSeconds) },
  );
}

/** A route handler counted against `limiter` per connection; a request without cf-connecting-ip (local dev) is not limited. */
function limited(limiter: MemoryRateLimiter, cors: Record<string, string>, handler: RouteHandler): RouteHandler {
  return async (request, path) => {
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) {
      const verdict = limiter.hit(ip);
      if (!verdict.allowed) return rateLimited(verdict.retryAfterSeconds, cors);
    }
    return handler(request, path);
  };
}

export interface HandleOptions {
  /** unix seconds; defaults to the wall clock. */
  now?: number;
  /** --- go-live-kit --- the rate limiters (tests inject fresh ones; the Worker shares the module's). */
  limiters?: RateLimiters;
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

  const limiters = options.limiters ?? { checkout: checkoutLimiter, license: licenseLimiter, portal: portalLimiter };
  const router = new Router()
    .get("/config", async () => configResponse(ctx))
    .get("/health", () => healthResponse(ctx, RATE_LIMITS)) // --- go-live-kit ---
    .post("/checkout/stripe", limited(limiters.checkout, cors, (req) => checkoutStripe(req, ctx)))
    .post("/checkout/paypal", limited(limiters.checkout, cors, (req) => checkoutPaypal(req, ctx)))
    .post("/checkout/crypto", limited(limiters.checkout, cors, (req) => checkoutCrypto(req, ctx)))
    .post("/webhooks/stripe", (req) => webhookStripe(req, ctx))
    .post("/webhooks/paypal", (req) => webhookPaypal(req, ctx))
    .post("/webhooks/nowpayments", (req) => webhookNowPayments(req, ctx))
    .post("/license/claim", limited(limiters.license, cors, (req) => claim(req, ctx)))
    .post("/license/restore", limited(limiters.license, cors, (req) => restore(req, ctx)))
    .post("/portal/stripe", limited(limiters.portal, cors, (req) => portalStripe(req, ctx)));

  return router.handle(request, cors);
}
