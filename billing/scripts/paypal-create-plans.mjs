#!/usr/bin/env node
// Create the PayPal product and the two billing plans ($10/month, $79/year), then print their ids.
//
//   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=sandbox node scripts/paypal-create-plans.mjs
//
// PAYPAL_ENV is "sandbox" (default) or "live". Paste the printed ids into the Worker as
// PAYPAL_PLAN_MONTHLY / PAYPAL_PLAN_YEARLY.

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  process.exit(1);
}
const base =
  process.env.PAYPAL_ENV === "live"
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
  const data = await res.json();
  if (!res.ok) {
    console.error("PayPal token error:", data);
    process.exit(1);
  }
  return data.access_token;
}

async function paypal(accessToken, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`PayPal error on ${path}:`, data);
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

const accessToken = await token();
const product = await paypal(accessToken, "/v1/catalogs/products", {
  name: "JumpingBallsLive Pro",
  type: "SERVICE",
  category: "SOFTWARE",
});
const monthly = await paypal(
  accessToken,
  "/v1/billing/plans",
  plan(product.id, "JumpingBallsLive Pro monthly", "MONTH", "10"),
);
const yearly = await paypal(
  accessToken,
  "/v1/billing/plans",
  plan(product.id, "JumpingBallsLive Pro yearly", "YEAR", "79"),
);

console.error(`Created product ${product.id} with two plans.\n`);
console.log(`PAYPAL_PLAN_MONTHLY=${monthly.id}`);
console.log(`PAYPAL_PLAN_YEARLY=${yearly.id}`);
