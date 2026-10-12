// --- go-live-kit --- The one source of truth for the prices, the plan lengths, the Stripe API version and the webhook
// event lists: billing/billing-config.json. The Worker reads it here; billing/scripts/*.mjs, the site's tests and the
// go-live wizard and check (scripts/go-live*.mjs) read the same file, so a price is written down exactly once.

import raw from "../billing-config.json";
import type { Plan } from "./entitlements";

export interface PlanConfig {
  /** Price in US dollars. */
  usd: number;
  /** Days the plan's period lasts (what a crypto payment prepays). */
  days: number;
  /** The recurring interval of the Stripe price and the PayPal plan. */
  interval: "month" | "year";
}

export interface BillingConfig {
  plans: Record<Plan, PlanConfig>;
  stripe: { apiVersion: string; webhookPath: string; webhookEvents: string[] };
  paypal: { webhookPath: string; webhookEvents: string[] };
  nowpayments: { ipnPath: string };
}

export const BILLING_CONFIG: BillingConfig = raw as BillingConfig;

/** What each plan costs, in US dollars. */
export const PLAN_USD: Record<Plan, number> = {
  monthly: BILLING_CONFIG.plans.monthly.usd,
  yearly: BILLING_CONFIG.plans.yearly.usd,
};

/** How many days each plan's period lasts. */
export const PLAN_DAYS: Record<Plan, number> = {
  monthly: BILLING_CONFIG.plans.monthly.days,
  yearly: BILLING_CONFIG.plans.yearly.days,
};
