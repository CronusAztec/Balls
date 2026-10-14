import { PLANS, formatUsd } from "@/lib/billing/config";

/**
 * --- legal-copy --- The prices the FAQ answers are written with ({monthly}, {yearly} in messages FAQ.q1), read from the plans
 * (lib/billing/config.ts, which tests/billingPlans.test.ts holds equal to billing/billing-config.json). The home page formats the
 * accordion's and the FAQPage data's answers with them, so a price change cannot leave an answer stale. A module of its own, used
 * by server code only: the accordion (a client component) gets the two strings as props and bundles no billing code.
 */
export function faqPrices(locale: string): { monthly: string; yearly: string } {
  return { monthly: formatUsd(PLANS.monthly.usd, locale), yearly: formatUsd(PLANS.yearly.usd, locale) };
}
