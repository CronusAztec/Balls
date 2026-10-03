# JumpingBallsLive billing backend

This is the small server the site needs to take payments. The website itself is a static export on
GitHub Pages and cannot keep secrets or verify a payment, so this **Cloudflare Worker** does three
things and nothing else:

1. starts a checkout with **Stripe** (cards), **PayPal**, or **NOWPayments** (crypto: BTC, ETH and the
   other popular coins);
2. listens for each provider's **webhook**, verifies it, and records who has paid and until when;
3. hands the browser a **signed licence** (a short JWT) that unlocks video creation on the site.

It is written in TypeScript with **no framework** and only dev dependencies (Wrangler, the Workers
types, Vitest). Everything the owner has to do is below. You do **not** need to be a developer, but you
do need to create a few free accounts and paste some keys.

> **What the visitor sees.** The playground (physics, sounds, all the controls) stays free. Exporting a
> video is behind the paywall: **$10/month** or **$79/year**. Cards and PayPal renew automatically;
> crypto buys a fixed prepaid period (30 or 365 days) because crypto cannot auto-renew.

---

## How it fits together

```
 Browser (GitHub Pages)                 This Worker (Cloudflare)              Payment provider
 ─────────────────────                  ───────────────────────              ────────────────
  "Go Pro" ─ POST /checkout/* ───────▶  create a checkout session  ──────▶   Stripe / PayPal / NOWPayments
                                                                                     │
  ◀──────────── { url } ──────────────  (the provider's hosted page) ◀──────────────┘
  visitor pays on the provider's page
                                        provider ─ POST /webhooks/* ───────▶  verify + record who paid
  back on the site ─ POST /license/claim ─▶ read the recorded payment ──▶ sign a licence ─▶ { token }
  the site stores the token and unlocks exporting; it checks the signature with the PUBLIC key only.
```

The **private** signing key lives only in the Worker. The site ships the matching **public** key and
can only *verify* licences, never mint them. A visitor who tampers with the stored licence just makes it
fail the signature check.

---

## One-time setup

### 0. Install the tools (on your computer)

```bash
cd billing
npm install
```

This installs Wrangler (Cloudflare's CLI) locally. Run everything below from this `billing/` folder.

### 1. Cloudflare account and login

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Log Wrangler in:
   ```bash
   npx wrangler login
   ```
   A browser window asks you to authorise it. (On a server with no browser, create an **API token**
   with the *Edit Cloudflare Workers* template instead and `export CLOUDFLARE_API_TOKEN=...`.)

### 2. Create the storage (KV namespace)

The Worker remembers who has paid in a Cloudflare KV namespace.

```bash
npx wrangler kv namespace create ENTITLEMENTS
```

It prints an `id`. Open `wrangler.toml` and paste it over `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`. (For a
local `wrangler dev` store, also run the same command with `--preview` and paste the `preview_id`.)

### 3. Generate the licence signing key pair

```bash
npm run keygen
```

It prints two lines:

- line 1 is a JSON object `{ "privateJwk": { ... } }` — this is the **Worker secret**;
- line 2 is a long base64url string — this is the **site's public key**.

Set the Worker secret now (paste the whole JSON object from line 1 when prompted; the bare JWK inside it
works too):

```bash
npx wrangler secret put LICENSE_PRIVATE_JWK
```

Keep line 2 for step 7 (the site's `LICENSE_PUBLIC_KEY` variable). **Never** put the private key in the
site or in Git. (The repository ships a *public* test key in `tests/fixtures/license-test-key.json` for
development only — do not use it in production.)

### 4. Stripe (card subscriptions)

1. Create an account at <https://stripe.com>. Stay in **Test mode** (toggle, top right) until you have
   tested everything.
2. Create the product and the two prices. The easiest way is the helper (it uses your secret key):
   ```bash
   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-create-prices.mjs
   ```
   It prints `STRIPE_PRICE_MONTHLY=price_...` and `STRIPE_PRICE_YEARLY=price_...`. (Or create a product
   "JumpingBallsLive Pro" by hand in the dashboard with a $10/month and a $79/year recurring price.)
3. Add a **webhook endpoint**: Dashboard → *Developers → Webhooks → Add endpoint*.
   - URL: `https://<your-worker-subdomain>.workers.dev/webhooks/stripe` (you will know the subdomain
     after step 7; you can add the endpoint afterwards).
   - Events to send (exactly these four):
     `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
     `customer.subscription.deleted`.
   - **API version:** pick `2025-02-24.acacia` for the endpoint (the version selector of the "Add
     endpoint" form; with the Stripe CLI, `--api-version 2025-02-24.acacia`). The Worker sends that
     version on every call it makes to Stripe, so the events and its own reads then have the same
     shape. (It also understands the newer event shapes, but matching versions is the tested setup.)
   - After saving, copy the endpoint's **Signing secret** (`whsec_...`).
   - **Card checkout stays off until this secret is set.** `/config` reports `stripe: false` and
     `/checkout/stripe` answers `503 provider_unavailable` while `STRIPE_WEBHOOK_SECRET` is missing:
     a payment whose webhook the Worker cannot verify would never be recorded. So the order is: deploy
     (step 7), add the endpoint with the Worker's URL, then `wrangler secret put STRIPE_WEBHOOK_SECRET`
     – the card button appears on the site after that. (The same holds for PayPal's
     `PAYPAL_WEBHOOK_ID` and NOWPayments' `NOWPAYMENTS_IPN_SECRET` below.)
4. Store the Stripe secrets in the Worker:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY        # sk_test_... (sk_live_... when you go live)
   npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_...
   npx wrangler secret put STRIPE_PRICE_MONTHLY     # price_...
   npx wrangler secret put STRIPE_PRICE_YEARLY      # price_...
   # optional, only if you have Stripe Tax set up:
   npx wrangler secret put STRIPE_AUTOMATIC_TAX     # the value 1
   ```

### 5. PayPal (subscriptions)

1. Create an app at <https://developer.paypal.com> → *Apps & Credentials*. Use **Sandbox** first.
   Copy the **Client ID** and **Secret**.
2. Create the product and the two plans:
   ```bash
   PAYPAL_CLIENT_ID=xxx PAYPAL_CLIENT_SECRET=yyy PAYPAL_ENV=sandbox node scripts/paypal-create-plans.mjs
   ```
   It prints `PAYPAL_PLAN_MONTHLY=P-...` and `PAYPAL_PLAN_YEARLY=P-...`.
3. Add a **webhook**: Developer dashboard → your app → *Add Webhook*.
   - URL: `https://<your-worker-subdomain>.workers.dev/webhooks/paypal`.
   - Events (exactly these five):
     `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`,
     `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`,
     `BILLING.SUBSCRIPTION.EXPIRED`.
   - After saving, copy the **Webhook ID**. (PayPal stays off on the site until `PAYPAL_WEBHOOK_ID`
     is set.)
4. Store the PayPal secrets:
   ```bash
   npx wrangler secret put PAYPAL_CLIENT_ID
   npx wrangler secret put PAYPAL_CLIENT_SECRET
   npx wrangler secret put PAYPAL_WEBHOOK_ID
   npx wrangler secret put PAYPAL_PLAN_MONTHLY
   npx wrangler secret put PAYPAL_PLAN_YEARLY
   npx wrangler secret put PAYPAL_ENV            # sandbox  (later: live)
   ```

### 6. NOWPayments (crypto)

1. Create an account at <https://nowpayments.io> and add a payout wallet (the coin you want to be paid
   out in). Turn on the **sandbox** first at <https://sandbox.nowpayments.io> if you want to test.
2. *Store settings → API keys*: create an **API key**.
3. *Store settings → Instant Payment Notifications (IPN)*: set an **IPN secret** and the callback URL to
   `https://<your-worker-subdomain>.workers.dev/webhooks/nowpayments`. (The Worker also sends this
   callback URL on every invoice, so it is set automatically; filling it in the dashboard is belt and
   braces.) Crypto stays off on the site until `NOWPAYMENTS_IPN_SECRET` is set.
4. Store the NOWPayments secrets:
   ```bash
   npx wrangler secret put NOWPAYMENTS_API_KEY
   npx wrangler secret put NOWPAYMENTS_IPN_SECRET
   npx wrangler secret put NOWPAYMENTS_SANDBOX    # the value 1 while testing; remove/0 for live
   ```

### 7. Deploy the Worker

Set the site origin in `wrangler.toml` under `[vars] SITE_ORIGIN` (it is `https://cronusaztec.github.io`
for this repository — the scheme and host only, no path). Then:

```bash
npm test          # make sure the suite is green
npm run deploy    # wrangler deploy
```

Wrangler prints the Worker's URL, e.g. `https://jumpingballslive-billing.<you>.workers.dev`. That is the
`BILLING_API_URL` for the next step. Go back and finish any webhook endpoint URLs (steps 4–6) with this
host.

### 8. Point the site at the Worker (two GitHub repository variables)

In the **site** repository: *Settings → Secrets and variables → Actions → Variables → New repository
variable*. Add two **variables** (not secrets — both values are public):

| Variable          | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `BILLING_API_URL` | the Worker URL from step 7 (e.g. `https://…workers.dev`)               |
| `LICENSE_PUBLIC_KEY` | line 2 from `npm run keygen` (the base64url public key)             |

The site's deploy workflow (`deploy.yml`) passes them to the build as `NEXT_PUBLIC_BILLING_API` and
`NEXT_PUBLIC_LICENSE_PUBLIC_KEY`, so the next site deploy knows where to send checkouts and which public
key verifies licences; the Windows app's release workflow (`desktop.yml`) builds the app with the same two.
The playground is always free and video creation is always Pro (see "Pricing and licences" in the main
README). Until `BILLING_API_URL` is set the pay buttons say that payments are not configured yet; until
`LICENSE_PUBLIC_KEY` is set the site runs in a visible **test mode** – it verifies licences with the public
test key, so it refuses the licences this Worker signs with your real key. Set both together.

---

## Testing before going live

- **Stripe:** keep Test mode on and pay with card `4242 4242 4242 4242`, any future expiry, any CVC. Use
  the Stripe CLI (`stripe listen --forward-to <worker>/webhooks/stripe`) or the dashboard's *Send test
  webhook* to exercise the endpoint. In the dashboard you will see the customer, the subscription and the
  paid invoices.
- **PayPal:** use your **sandbox** buyer account from *Testing Tools → Sandbox Accounts*. The developer
  dashboard shows the subscription moving to **ACTIVE** and the webhook deliveries with their response
  codes.
- **NOWPayments:** use the **sandbox** and its test payment flow. The dashboard shows the invoice and the
  payment status moving `waiting → confirming → confirmed → sending → finished`; the Worker grants the
  period on `confirmed` or `finished`, whichever arrives first – one payment buys one period (30 or 365
  days), however many statuses it reports.
- **The Worker itself:** `npx wrangler dev` runs it locally. Copy `.dev.vars.example` to `.dev.vars`
  first — out of the box it uses the public **test** signing key, so `/config` reports `"testMode": true`
  and the local site can verify the licences immediately. `curl http://localhost:8787/config` should list
  the plans and which providers you have configured. To point a local site at it, build the site without
  `NEXT_PUBLIC_LICENSE_PUBLIC_KEY` (test mode) and, in its browser console, run
  `localStorage.setItem("jbl.billingApi", "http://localhost:8787")` – a test-mode build only, a production
  build ignores that key.

When everything works in test/sandbox, switch each provider to live (real `sk_live_…`, `PAYPAL_ENV=live`,
remove `NOWPAYMENTS_SANDBOX`), re-run the secret commands with the live values, and `npm run deploy`.

---

## The endpoints (reference)

All JSON, all CORS-restricted to your site's origin (plus `localhost` for development and the Windows
app's own origin, `app://jumpingballslive`, which no web page can claim). Errors are
`{ "error": "<code>", "message": "..." }`.

| Method & path             | Body                                   | Returns                                        |
| ------------------------- | -------------------------------------- | ---------------------------------------------- |
| `GET /config`             | –                                      | plans, which providers are on, `testMode`      |
| `POST /checkout/stripe`   | `{ plan, email?, locale, returnUrl }`  | `{ url }` (Stripe Checkout)                     |
| `POST /checkout/paypal`   | `{ plan, locale, returnUrl }`          | `{ url }` (PayPal approve link)                 |
| `POST /checkout/crypto`   | `{ plan, email, locale, returnUrl }`   | `{ url }` (NOWPayments invoice)                 |
| `POST /webhooks/stripe`   | Stripe event (signed)                  | `{ received: true }`                            |
| `POST /webhooks/paypal`   | PayPal event (verified via PayPal)     | `{ received: true }`                            |
| `POST /webhooks/nowpayments` | NOWPayments IPN (signed)            | `{ received: true }`                            |
| `POST /license/claim`     | `{ provider, ref }`                     | `{ token }` \| `{ pending: true }` \| `{ error }` |
| `POST /license/restore`   | `{ email, ref }`                        | `{ token }` \| `{ error }`                      |
| `POST /portal/stripe`     | `{ email, ref, returnUrl? }`            | `{ url }` (Stripe Billing Portal)              |

`plan` is `"monthly"` or `"yearly"`. `returnUrl` must be a page on your own site: the site sends its
pricing page, which on GitHub Pages lives under the repository's path (`/Balls/…`). The portal's return
link goes there, or to `SITE_ORIGIN` when the request names none.

`ref` is a receipt reference: the Stripe Checkout Session id (`cs_…`) or subscription id (`sub_…`), the
PayPal subscription id (`I-…`) or our PayPal order id, or the crypto order id – the checkout returns to
the site with it (`?claim=<provider>&ref=<id>`), and the site shows it and keeps it. `/license/restore`
answers `404 unknown_reference` unless the reference belongs to that e-mail, and `402 not_active` once
its paid period (plus the grace days) has run out. `/portal/stripe` opens the portal only for the
customer of the card subscription the reference names, owned by that e-mail – otherwise `404
unknown_reference`, the same as an e-mail alone. A claim answers `{ pending: true }` until THIS
purchase's own paid period is recorded – it records what the provider itself says about the session
or subscription it fetched, so it does not wait for the webhooks, and a returning customer's old, lapsed
period never stands in for the new payment.

---

## Trust model (please read)

- **Every webhook is verified** before it changes anything: Stripe by an HMAC-SHA256 signature over the
  exact raw body (constant-time compare, with a timestamp tolerance); NOWPayments by its HMAC-SHA512
  signature over the body re-serialised with every object's keys sorted (NOWPayments' own scheme; the
  Worker rebuilds that form from the parsed body and compares in constant time); PayPal by calling
  PayPal's own verify-signature API. A forged or replayed webhook is rejected. Stripe and PayPal events
  are processed once per event id; a NOWPayments payment grants its period once, however many status
  updates (`confirmed`, `finished`, retries) arrive for it.
- **Every fact has its own record.** KV has no transactions, so nothing is one record per customer that
  several webhooks rewrite (Stripe sends three events for one purchase within a second). Each
  subscription's buyer, paid period, state and end, and each crypto payment's prepaid days, are stored
  under their own keys and the entitlement is derived from all of them when a licence is minted (see
  "How the records are kept" below). A provider's events only touch their own subscription: cancelling
  a card plan cannot wipe a prepaid crypto year, and two subscriptions on one e-mail stay apart. The
  paid period of a subscription moves only on a paid invoice (`invoice.paid`) or a completed PayPal sale –
  never on `customer.subscription.updated`, which Stripe sends when a subscription cycles, before the
  renewal is paid.
- **Licences are signed on the server** with a private key that never leaves the Worker. The site holds
  only the public key and can verify but never issue a licence. A licence states the buyer's e-mail, the
  plan, the provider and an expiry (the paid period plus three days of grace, capped at 400 days).
- **The browser gate is advisory.** A determined user can read the client-side code and bypass the
  check in their own browser — that is unavoidable for a static site, and no secret or unreleased content
  is exposed by doing so. What they cannot do is forge a licence that other installs or a server would
  accept, obtain anyone else's licence, or make a payment "stick" without the provider confirming it by a
  verified webhook. Nor can they open someone else's billing portal: like Restore, the portal needs the
  e-mail **and** a reference of that card subscription (an e-mail alone is not proof of anything). The
  paywall protects the revenue path, not the shipped JavaScript.
- **Secrets never touch Git.** The only key material in this repository is the clearly labelled public
  test key pair. Real keys live in Wrangler secrets (and, for local runs, in an un-committed `.dev.vars`).

---

## How the records are kept

All in the one KV namespace, every fact under its own key (`src/store.ts` owns the shapes):

| Key | What | Written by |
| --- | --- | --- |
| `sub:<stripe\|paypal>:<subscription id>:link` | who bought it: e-mail, plan, Stripe customer, the session / order id | `checkout.session.completed`, `BILLING.SUBSCRIPTION.ACTIVATED`, the claim |
| `sub:<stripe\|paypal>:<subscription id>:paid` | how far it is paid (only ever moves later) | `invoice.paid`, `PAYMENT.SALE.COMPLETED`, the activation, the claim |
| `sub:<stripe\|paypal>:<subscription id>:state` | its latest status (an older event never overwrites a newer one) | `customer.subscription.updated`, PayPal's cancel / suspend / expire |
| `sub:stripe:<subscription id>:ended` | when Stripe deleted it – its access ends there | `customer.subscription.deleted` |
| `grant:crypto:<payment id>` (`order-<order id>` when an IPN carries no payment id) | one crypto payment's prepaid days and where they start | the first `confirmed` / `finished` IPN of that payment |
| `idx:<e-mail>:<stripe\|paypal\|crypto>:<id>` | the e-mail's index – one key per subscription or payment, read by listing the prefix | with each of the above |
| `order:crypto:<id>`, `order:paypal:<id>` | the orders the checkouts created | the checkouts, the IPNs |
| `event:<provider>:<id>` | webhook idempotency, kept 30 days | the webhooks |

The entitlement of an e-mail is the furthest paid period over its sources: each subscription (its
paid end, cut short where Stripe deleted it) and the chain of crypto payments (each starts after the
e-mail's subscriptions' paid end at the time of payment, or after the previous crypto period). The
licence carries that end (plus three days of grace) and the plan and provider of the source that runs
furthest.

---

## Developing

```bash
npm run check   # tsc --noEmit (strict, with @cloudflare/workers-types)
npm test        # vitest: signatures, token round trip, entitlement maths, claims, races, CORS, routing…
npm run dev     # wrangler dev (needs .dev.vars)
npm run deploy  # wrangler deploy
```

The deploy can also be run from GitHub: *Actions → "Deploy billing worker" → Run workflow*. It needs two
repository **secrets**, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and it runs the test suite
before deploying.
