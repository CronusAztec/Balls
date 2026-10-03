// Shared context and request-validation helpers for the endpoint handlers.

import type { Env } from "../env";
import { ApiError, isAllowedOrigin } from "../http";
import type { Plan } from "../entitlements";
import type { Repo } from "../store";

/** A non-empty string, else undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** An object to read fields from ({} for anything else). */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The plan a Stripe price id stands for – only this Worker's two prices count. */
export function planFromStripePrice(priceId: string | undefined, env: Env): Plan | undefined {
  if (!priceId) return undefined;
  if (priceId === env.STRIPE_PRICE_YEARLY) return "yearly";
  if (priceId === env.STRIPE_PRICE_MONTHLY) return "monthly";
  return undefined;
}

/** The plan a PayPal plan id stands for – only this Worker's two plans count. */
export function planFromPaypalPlanId(planId: string | undefined, env: Env): Plan | undefined {
  if (!planId) return undefined;
  if (planId === env.PAYPAL_PLAN_YEARLY) return "yearly";
  if (planId === env.PAYPAL_PLAN_MONTHLY) return "monthly";
  return undefined;
}

/** Everything a handler needs: the environment, the store, the CORS headers, a clock and our origin. */
export interface Ctx {
  env: Env;
  repo: Repo;
  cors: Record<string, string>;
  /** unix seconds; injectable so tests pin time. */
  now: number;
  /** The Worker's own origin (scheme + host), e.g. https://billing.example.workers.dev. */
  workerOrigin: string;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError("invalid_request", `Missing or invalid "${key}".`, 400);
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError("invalid_request", `Invalid "${key}".`, 400);
  }
  return value;
}

export function requirePlan(body: Record<string, unknown>): Plan {
  const plan = body.plan;
  if (plan === "monthly" || plan === "yearly") return plan;
  throw new ApiError("invalid_plan", 'Plan must be "monthly" or "yearly".', 400);
}

/** The locale, defaulting to "en" and never longer than a short tag. */
export function readLocale(body: Record<string, unknown>): string {
  const locale = body.locale;
  if (typeof locale === "string" && /^[a-zA-Z-]{2,10}$/.test(locale)) return locale;
  return "en";
}

/**
 * Validate a returnUrl: its origin must be the site origin (or a localhost origin in development).
 * Returns the cleaned URL. Refuses anything else so the Worker cannot be made to send buyers off-site.
 */
export function validateReturnUrl(returnUrl: string, env: Env): string {
  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    throw new ApiError("invalid_return_url", "returnUrl is not a valid URL.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError("invalid_return_url", "returnUrl must be http(s).", 400);
  }
  if (!isAllowedOrigin(url.origin, env.SITE_ORIGIN)) {
    throw new ApiError("invalid_return_url", "returnUrl is not on this site.", 400);
  }
  return url.toString();
}

/** Append a query string to a URL that may or may not already have one. */
export function appendQuery(url: string, query: string): string {
  return url + (url.includes("?") ? "&" : "?") + query;
}

/** Parse an ISO-8601 instant to unix seconds, or null. */
export function isoToUnix(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
