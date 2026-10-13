#!/usr/bin/env node
// Create the PayPal product and the two billing plans, then print their ids.
//
//   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=sandbox node scripts/paypal-create-plans.mjs
//
// PAYPAL_ENV is "sandbox" (default) or "live". The prices come from billing/billing-config.json (--- go-live-kit --- the one
// source of truth: $6.99/month, $49/year). Re-running it is safe: when a product named "JumpingBallsLive Pro" already exists,
// its ACTIVE plans with the same price and interval are reused instead of creating duplicates. Paste the printed ids into
// the Worker as PAYPAL_PLAN_MONTHLY / PAYPAL_PLAN_YEARLY (`npm run go-live` in the site's root does it for you).

import fs from "node:fs";

const PRODUCT_NAME = "JumpingBallsLive Pro";
const config = JSON.parse(fs.readFileSync(new URL("../billing-config.json", import.meta.url), "utf8"));

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  process.exit(1);
}
const base =
  process.env.PAYPAL_ENV?.trim().toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function token() {
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("PayPal token error:", data?.error_description ?? data?.error ?? `HTTP ${res.status}`);
    process.exit(1);
  }
  return data.access_token;
}

async function paypal(accessToken, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(method === "GET" ? { Prefer: "return=representation" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`PayPal error on ${path}:`, data?.message ?? data?.name ?? `HTTP ${res.status}`);
    process.exit(1);
  }
  return data;
}

function plan(productId, name, interval, value) {
  return {
    product_id: productId,
    name,
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: interval, interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value, currency_code: "USD" } },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: "CONTINUE",
      payment_failure_threshold: 3,
    },
  };
}

/** A plan's regular cycle as { interval, value } (null when it has no readable one). */
function regularCycle(p) {
  const cycle = (p.billing_cycles ?? []).find((c) => c.tenure_type === "REGULAR") ?? p.billing_cycles?.[0];
  const price = cycle?.pricing_scheme?.fixed_price;
  if (!cycle || !price) return null;
  return { interval: cycle.frequency?.interval_unit, count: cycle.frequency?.interval_count ?? 1, value: Number(price.value), currency: price.currency_code };
}

const accessToken = await token();
const products = await paypal(accessToken, "GET", "/v1/catalogs/products?page_size=20");
let product = (products.products ?? []).find((p) => p.name === PRODUCT_NAME);
let existing = [];
if (product) {
  const plans = await paypal(accessToken, "GET", `/v1/billing/plans?product_id=${encodeURIComponent(product.id)}&page_size=20`);
  existing = (plans.plans ?? []).filter((p) => p.status === "ACTIVE");
  // the list answer may leave the billing cycles out: read each plan in full
  existing = await Promise.all(existing.map((p) => (p.billing_cycles ? p : paypal(accessToken, "GET", `/v1/billing/plans/${encodeURIComponent(p.id)}`))));
} else {
  product = await paypal(accessToken, "POST", "/v1/catalogs/products", { name: PRODUCT_NAME, type: "SERVICE", category: "SOFTWARE" });
}

const ids = {};
let created = 0;
for (const which of ["monthly", "yearly"]) {
  const { usd, interval } = config.plans[which];
  const unit = interval.toUpperCase();
  const match = existing.find((p) => {
    const c = regularCycle(p);
    return c && c.interval === unit && c.count === 1 && c.value === usd && c.currency === "USD";
  });
  if (match) {
    ids[which] = match.id;
    continue;
  }
  const made = await paypal(accessToken, "POST", "/v1/billing/plans", plan(product.id, `${PRODUCT_NAME} ${which}`, unit, String(usd)));
  ids[which] = made.id;
  created++;
}

console.error(created ? `Product ${product.id}: created ${created} plan(s), reused ${2 - created}.\n` : `Product ${product.id}: reused both plans.\n`);
console.log(`PAYPAL_PLAN_MONTHLY=${ids.monthly}`);
console.log(`PAYPAL_PLAN_YEARLY=${ids.yearly}`);
