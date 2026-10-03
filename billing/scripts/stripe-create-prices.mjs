#!/usr/bin/env node
// Create the Stripe product and the two recurring prices ($10/month, $79/year), then print their ids.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-create-prices.mjs
//
// Use a test key (sk_test_...) first; re-run with the live key when you go live. Paste the printed
// ids into the Worker as STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY (wrangler secret put, or [vars]).

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...).");
  process.exit(1);
}

async function stripe(path, form) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Stripe error on ${path}:`, data?.error?.message ?? data);
    process.exit(1);
  }
  return data;
}

const product = await stripe("/v1/products", { name: "JumpingBallsLive Pro" });
const monthly = await stripe("/v1/prices", {
  product: product.id,
  currency: "usd",
  unit_amount: "1000",
  "recurring[interval]": "month",
  nickname: "JumpingBallsLive Pro monthly",
});
const yearly = await stripe("/v1/prices", {
  product: product.id,
  currency: "usd",
  unit_amount: "7900",
  "recurring[interval]": "year",
  nickname: "JumpingBallsLive Pro yearly",
});

console.error(`Created product ${product.id} with two prices.\n`);
console.log(`STRIPE_PRICE_MONTHLY=${monthly.id}`);
console.log(`STRIPE_PRICE_YEARLY=${yearly.id}`);
