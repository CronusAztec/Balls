#!/usr/bin/env node
// Create the Stripe product and the two recurring prices, then print their ids.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-create-prices.mjs
//
// The prices come from billing/billing-config.json (--- go-live-kit --- the one source of truth: $10/month, $79/year).
// Re-running it is safe: when a product named "JumpingBallsLive Pro" already exists, its active recurring prices with the
// same amount and interval are reused instead of creating duplicates. Use a test key (sk_test_...) first; re-run with the
// live key when you go live (live and test mode are separate in Stripe). Paste the printed ids into the Worker as
// STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY (`npm run go-live` in the site's root does it for you).

import fs from "node:fs";

const PRODUCT_NAME = "JumpingBallsLive Pro";
const config = JSON.parse(fs.readFileSync(new URL("../billing-config.json", import.meta.url), "utf8"));

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...).");
  process.exit(1);
}

async function stripe(method, path, form) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:`).toString("base64"),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Stripe error on ${path}:`, data?.error?.message ?? `HTTP ${res.status}`);
    process.exit(1);
  }
  return data;
}

// An existing product of ours (active), else a new one.
const products = await stripe("GET", "/v1/products?active=true&limit=100");
let product = (products.data ?? []).find((p) => p.name === PRODUCT_NAME);
const existing = product ? (await stripe("GET", `/v1/prices?product=${encodeURIComponent(product.id)}&active=true&limit=100`)).data ?? [] : [];
if (!product) product = await stripe("POST", "/v1/products", { name: PRODUCT_NAME });

const ids = {};
let created = 0;
for (const plan of ["monthly", "yearly"]) {
  const { usd, interval } = config.plans[plan];
  const cents = Math.round(usd * 100);
  const match = existing.find((p) => p.currency === "usd" && p.unit_amount === cents && p.recurring?.interval === interval && (p.recurring?.interval_count ?? 1) === 1);
  if (match) {
    ids[plan] = match.id;
    continue;
  }
  const price = await stripe("POST", "/v1/prices", {
    product: product.id,
    currency: "usd",
    unit_amount: String(cents),
    "recurring[interval]": interval,
    nickname: `${PRODUCT_NAME} ${plan}`,
  });
  ids[plan] = price.id;
  created++;
}

console.error(created ? `Product ${product.id}: created ${created} price(s), reused ${2 - created}.\n` : `Product ${product.id}: reused both prices.\n`);
console.log(`STRIPE_PRICE_MONTHLY=${ids.monthly}`);
console.log(`STRIPE_PRICE_YEARLY=${ids.yearly}`);
