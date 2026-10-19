# Going live: the launch guide

This guide takes JumpingBallsLive from "it works on GitHub" to "strangers pay for Pro and the money reaches your bank and
your crypto wallets". You do not need to be a developer. Follow the sections in order the first time; later, use the two
checklists at the end.

Three commands do most of the typing for you:

- `npm run go-live` – the **wizard**. It asks for each key once, checks it, and puts it where it belongs.
- `npm run go-live:check` – the **check**. It proves that the website, the payment server and the payment companies agree.
- `npm run go-live -- --mode live` – the wizard again, for real money.

A few words used below:

- **Repository** – the project's folder on GitHub (`CronusAztec/Balls`).
- **Worker** – the small payment server on Cloudflare. It starts checkouts, hears from Stripe, PayPal and NOWPayments
  when someone has paid, and hands the buyer a signed licence.
- **Webhook** – a message a payment company sends to the Worker ("this person just paid").
- **Variable** and **secret** – settings stored on GitHub or Cloudflare. A variable is public; a secret is hidden and
  cannot be read back, only replaced.
- **Licence** – the signed key that turns a browser into Pro. It is checked with a public key; only the Worker can make one.

---

## 1. What you are launching and what it costs

Three parts:

| Part | Where it lives | Who visits it |
| --- | --- | --- |
| The website | Cloudflare (a Worker serving jumpingballslive.com), built from the repository by GitHub Actions | everyone |
| The payment server (the Worker) | Cloudflare Workers | the website, Stripe, PayPal, NOWPayments |
| The Windows app | the Releases of a public installers-only GitHub repository (jumpingballslive-windows), built from this repository by GitHub Actions | people who download it |

**Monthly costs**

| What | Cost |
| --- | --- |
| GitHub (the private repository and Actions: 2,000 free minutes a month) | free |
| Cloudflare **Workers Paid** (needed before launch – see section 4.1) | $5 a month |
| Your own domain name (optional) | about $10–15 a year |
| Payment fees | a share of each sale – see the table in section 15 |

**Accounts to create** (section 4 walks through each one):

- GitHub – you have it.
- Cloudflare – for the Worker.
- Stripe – cards, Apple Pay and Google Pay. Pays out to your bank.
- PayPal **Business** – PayPal payments. Pays out to your bank.
- NOWPayments – crypto. Pays out to your own wallets.
- A domain registrar – only if you want your own address.

**Have these at hand** before you start the sign-ups: an ID document (passport or ID card), your bank account details
(IBAN or account and routing number), the name you trade under (your own name is fine), your address, and an e-mail
address for customer questions (for example a new `support@…` or a separate Gmail address).

---

## 2. The website address and hosting

Your website is a folder of ready-made files. GitHub builds that folder from the code and **Cloudflare** serves it, at
<https://jumpingballslive.com> (and `www.jumpingballslive.com`): the folder is the static assets of a Cloudflare Worker named
`jumpingballslive`, and `wrangler.toml` at the repository root attaches both addresses to it. GitHub only keeps the code, so
the repository can be private (section 10).

**How it is switched on:** two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` – the same two the
payment Worker uses (section 9). Without them the deploy stops with a message that says which one is missing.

**What happens on every push:** every time code is pushed to the product branch (`claude/optimistic-johnson-46x3qg`, or
`main` once you rename it), GitHub runs the checks (lint, types, unit tests, the build – about 6 minutes), then the browser
test on four machines at once (about 12–15 minutes), and only when everything is green it publishes the new site to
Cloudflare and asks jumpingballslive.com for the new build. **From push to live: about 25 minutes.** Other branches only get
the lint and the type check (a private repository has a monthly allowance of Actions minutes) and are never published.

**Another address (optional).** `jumpingballslive.com` is the default. To serve the site from another domain that is on your
Cloudflare account:

1. **First tell the Worker about the new address**, or checkouts from it will be refused. Run `npm run go-live` again (it
   asks "Do you have your own domain for the site?") – or add the address to `SITE_ORIGIN` in `billing/wrangler.toml`
   yourself (several addresses are separated by spaces) and deploy the Worker (section 3).
2. In `wrangler.toml` (the repository root) change the two `routes` patterns – the bare name and `www` – to the new domain.
3. **Settings → Secrets and variables → Actions → Variables** → add `CUSTOM_DOMAIN` = your domain without `https://`
   (for example `example.com`). Then push anything (or **Actions → "Build and deploy the site" → Run workflow**): the site is
   built for the new address and the next Windows release uses it for its links.
4. If you run the publish relay, add the new address to its `RELAY_ALLOWED_ORIGINS`.

---

## 3. One push updates everything

| What | How it updates | Where to watch |
| --- | --- | --- |
| Website | every push to the product branch (about 25 minutes) | Actions → "Build and deploy the site" |
| Payment Worker | the first time by hand: **Actions → "Deploy billing worker" → Run workflow** (needs the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, section 9), or `npm run go-live`. After that, once the repository variable `BILLING_AUTODEPLOY` is `1`, every push that changes `billing/` | Actions → "Deploy billing worker" |
| Windows app | a push that raises the version in `desktop/package.json` (`npm run release:desktop -- 1.0.4`, section 11) | Actions → "Windows app"; <https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/latest.yml> |

[`docs/RELEASING.md`](RELEASING.md) describes each of these step by step, and how to undo a bad release.

If a run in the Actions tab is red, nothing was published: the live site, the Worker and the app are untouched. Open the
run, read the red step, fix, push again.

**Which build is live?** The footer of every page shows `v1.10.0 · 8fa8dbb · 2026-10-14` (the release in `package.json`, the
commit and its date), and <https://jumpingballslive.com/version.json> names the same build for whoever asks the server
(`curl -s https://jumpingballslive.com/version.json`, with the full commit and `build` = `1.10.0+8fa8dbb`; `curl -sI
https://jumpingballslive.com/en/ | grep -i x-build` shows the id as a header). Nothing in this setup needs a change for that:
the build reads its own commit. The Windows app shows its version in the title bar and in Help → About, together with the
website build inside it.

---

## 4. Payments: create the accounts

Do all four sign-ups first; they need a day or two of checking on the companies' side. Keep everything in **test mode**
until section 6 says otherwise.

### 4.1 Cloudflare (the payment server)

1. Sign up at <https://dash.cloudflare.com/sign-up> and confirm your e-mail.
2. **Workers & Pages → Plans → Workers Paid** ($5 a month). Do this before launch: the free plan allows only 1,000 storage
   writes a day, and a launch day with a few hundred buyers runs out (payments then wait instead of unlocking).
3. **API token** (for GitHub's deploy workflow): top right, your profile icon → **My Profile → API Tokens → Create Token** →
   template **"Edit Cloudflare Workers"** → **Use template** → under *Permissions* add **Account → Workers KV Storage →
   Edit** → **Continue to summary → Create Token**. Copy it somewhere safe for a minute; the wizard asks for it.
4. **Account ID**: **Workers & Pages** → on the right, **Account details → Account ID**. The wizard usually finds it by
   itself.

### 4.2 Stripe (cards → your bank)

1. Sign up at <https://dashboard.stripe.com/register>.
2. **Activate payments** (the banner on the home page). The questionnaire asks for: your country, whether you are an
   individual or a company, your legal name, address, date of birth, an ID document, a tax number where your country has
   one, your **bank account** (this is where the money goes), the website (`https://jumpingballslive.com`), and a product description – write "Pro subscription for a browser video tool".
3. **Settings → Business → Public details**: the support e-mail, and the **statement descriptor** `JUMPINGBALLSLIVE`
   (what buyers see on their card statement).
4. **Settings → Emails → Successful payments: on.** Stripe then e-mails each buyer a receipt.
5. **Settings → Billing → Customer portal**: allow customers to **cancel subscriptions** and to **update payment methods**,
   then press **Save**. Without this one press the "Manage subscription" button on the pricing page cannot open.
6. **Developers → API keys**: the **Secret key** (`sk_test_…` in Test mode). The wizard asks for it.

Stripe has two separate worlds, **Test mode** and **live mode** (the switch at the top). Settings 3–6 must be done in
each.

### 4.3 PayPal (PayPal → your bank)

1. Open a **PayPal Business** account at <https://www.paypal.com/business> (or upgrade your personal one).
2. **Link and confirm your bank account** (Wallet → Link a bank). PayPal sends two small deposits to confirm it.
3. **Account settings → Business information → Customer service** – the support e-mail buyers see.
4. Go to <https://developer.paypal.com> and log in with the same account. **Apps & Credentials**:
   - **Sandbox** tab (for testing) → **Create App** → name "JumpingBallsLive" → under *Features* tick **Subscriptions** →
     **Create**. You see a **Client ID** and a **Secret**.
   - Test buyers: **Testing Tools → Sandbox Accounts** – PayPal made a "Personal" test account; its e-mail and password
     (⋯ → View/Edit) are what you pay with in the sandbox.
   - Later, the **Live** tab → **Create App** the same way, for real money.

### 4.4 NOWPayments (crypto → your wallets)

1. Sign up at <https://nowpayments.io> and switch on **two-factor authentication** (Settings → Security).
2. **Store settings → Payout wallets** – add **your own wallet address** for every coin you want to be paid in (for
   example a USDT on TRON address, a Bitcoin address). This is "connecting your crypto wallets": NOWPayments sends each
   payment there automatically. Or turn on **auto-conversion** to one coin (such as USDT) and add just that one wallet.
   The repository never holds a wallet address.
3. **Store settings → API keys → Add new key**. The wizard asks for it.
4. **Store settings → Instant Payment Notifications**: create the **IPN secret key** (the wizard asks for it) and paste the
   callback URL the wizard prints.
5. For tests, the sandbox at <https://account-sandbox.nowpayments.io> has its own sign-up, API key and IPN secret.
6. As your volume grows NOWPayments may ask for identity checks (KYC). Answer them promptly; payouts can pause meanwhile.

---

## 5. Run the wizard

On your computer (Windows, macOS or Linux) you need **Node.js 20 or newer** (<https://nodejs.org>, the "LTS" button) and
**Git**. The **GitHub CLI** (<https://cli.github.com>, then `gh auth login`) is optional: with it the wizard sets the GitHub
settings for you; without it, it prints them for you to paste.

Open a terminal and run, once:

```bash
git clone https://github.com/CronusAztec/Balls.git
cd Balls
npm install
cd billing && npm install && npx wrangler login && cd ..
```

`npx wrangler login` opens your browser: press **Allow**. Then, **test mode first**:

```bash
npm run go-live
```

Later, for real money (section 6):

```bash
npm run go-live -- --mode live
```

**What it asks, in order**

1. Test or live (Enter means test).
2. Your own domain, if you have one.
3. It then finds or creates the Worker's storage and deploys the Worker once, to learn its address
   (`https://jumpingballslive-billing.<your-name>.workers.dev`).
4. The licence key: in test mode the public test key; in live mode it makes your own key pair (or keeps the one the Worker
   already has).
5. **Stripe:** the secret key; the two prices (it finds or creates "JumpingBallsLive Pro" at $6.99 a month and $49 a year –
   running it twice never makes duplicates); whether you use Stripe Tax; then it shows the webhook to add (below) and asks
   for its **signing secret** (`whsec_…`).
6. **PayPal:** the Client ID and the Secret; the two plans (found or created the same way); the webhook to add, then its
   **Webhook ID**.
7. **NOWPayments:** the API key and the IPN secret; it prints the IPN callback URL to paste.
8. It deploys the Worker again.
9. **GitHub** (live mode only): the Worker's address and the public key become the variables `BILLING_API_URL` and
   `LICENSE_PUBLIC_KEY`; it asks for your support e-mail and, optionally, your name or business name and address for the
   terms; and it offers to set the two secrets the "Deploy billing worker" workflow needs.

Every secret prompt hides what you type. Pasting the wrong kind of value (a test key in live mode, a publishable key
instead of the secret one) makes it ask again and say why. Pressing **Enter** at a secret keeps what the Worker already
has, so a second run only changes what you change. `npm run go-live -- --dry-run` shows every step without doing anything.

**Where things end up**

| What | Where | Can it be read back? |
| --- | --- | --- |
| API keys, webhook secrets, the private licence key | Cloudflare → the Worker → Settings → Variables and Secrets | no (only replaced) |
| The Worker's address, the public licence key, support e-mail, name, address | GitHub variables | yes – they are public |
| The storage id and the site addresses | `billing/wrangler.toml` | yes – commit and push it |

Nothing secret is printed, logged or saved on your computer.

**The webhooks the wizard asks you to add** (the lists come from `billing/billing-config.json`):

- **Stripe** – Developers → Webhooks → **Add endpoint**. URL `https://<your Worker>/webhooks/stripe`. API version
  `2025-02-24.acacia`. Events, exactly these six: `checkout.session.completed`, `invoice.paid`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`. After
  saving: **Signing secret → Reveal**.
- **PayPal** – developer.paypal.com → your app → **Webhooks → Add Webhook**. URL `https://<your Worker>/webhooks/paypal`.
  Events, exactly these seven: `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`,
  `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`,
  `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED`. After saving: the **Webhook ID** column.
- **NOWPayments** – Store settings → Instant Payment Notifications → callback URL
  `https://<your Worker>/webhooks/nowpayments`.

The Worker refuses to mix worlds: test keys work only with the test licence key, live keys only with your own key. If you
mix them, that payment button disappears from the site and `https://<your Worker>/health` names the problem.

---

## 6. Test first, then go live

### (a) Test with test money

1. `npm run go-live` (test mode) with the Stripe **Test mode** key, the PayPal **Sandbox** app and the NOWPayments
   **sandbox** keys.
2. `npm run go-live:check -- --mode test` – every line should say PASS (some WARN lines are fine while a provider is
   skipped).
3. Open the live site. It is still in test mode (a yellow line on the pricing page says so). Press **F12** → **Console**
   and run:

   ```js
   localStorage.setItem("jbl.billingApi", "https://jumpingballslive-billing.<your-name>.workers.dev")
   ```

   Reload and go to **Pricing**. (A live build ignores this setting – it only works in test mode.)
4. **Card:** choose Monthly → card `4242 4242 4242 4242`, any future date, any CVC, any name → you come back to
   "You are Pro until …".
5. Open the studio: a recording has no watermark.
6. On Pricing, **Manage subscription** opens Stripe's customer portal.
7. In another browser (or a private window) set the same `jbl.billingApi`, go to Pricing → **Restore purchase** with the
   e-mail and the `cs_…` reference shown after the payment: Pro again.
8. **PayPal:** pay Monthly with the sandbox buyer from section 4.3.
9. **Crypto:** create an invoice and pay it in the NOWPayments sandbox.
10. **A refund:** in Stripe (Test mode) open the payment → **Refund** in full. Restoring that purchase now says the
    subscription is no longer active.

### (b) Go live

1. In Stripe switch Test mode **off** and repeat section 4.2 steps 3–6 in live mode (public details, e-mails, customer
   portal → Save, the live secret key) and add the live webhook endpoint.
2. In PayPal create the **Live** app (section 4.3).
3. In NOWPayments use the real account's API key and IPN secret.
4. Run:

   ```bash
   npm run go-live -- --mode live
   ```

5. The wizard sets the GitHub variables. Push anything, or **Actions → "Build and deploy the site" → Run
   workflow**. About 25 minutes later the site is live (the yellow test line is gone).
6. Run:

   ```bash
   npm run go-live:check -- --mode live
   ```

   It must end with `GO-LIVE CHECK: PASS`. To include the providers in the check, put their keys into the terminal first
   (they are only read, never printed or saved), for example on macOS/Linux `export STRIPE_SECRET_KEY=…` or in Windows
   PowerShell `$env:STRIPE_SECRET_KEY="…"`, and the same for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`,
   `NOWPAYMENTS_API_KEY`.

### (c) The first real purchases (do all three)

- **Card, for free:** Stripe → **Products → Coupons → Create coupon**: 100 % off, duration **once**, maximum
  redemptions **1**, with a customer-facing **promotion code** `GOLIVE`. Buy Monthly on the live pricing page with that
  code. The licence arrives. Then Stripe → **Customers** → that customer → cancel the subscription, and deactivate the
  coupon.
- **PayPal:** from a second PayPal account (a friend's, or your personal one) buy Monthly for real ($6.99). It unlocks. Then
  PayPal → **Activity** → the payment → **Refund**, and cancel the subscription (**Settings → Payments → Manage automatic
  payments**, or in the PayPal app).
- **Crypto:** pay Monthly from your own wallet in a cheap coin – USDT on TRON, LTC or DOGE – about $7. It unlocks after
  the network confirms it (minutes). The money arrives in your payout wallet minus about 0.5 % and the network fee.

---

## 7. Where the money goes (payouts)

- **Stripe → your bank.** Sales collect in your Stripe balance and go to your bank on the payout schedule (**Settings →
  Business → Bank accounts and currencies**, and **Balance → Payouts**). The first payout comes about 7 days after the first
  charge (up to 14 in some countries), then on a rolling schedule – 2 business days in the US, about 7 days in much of
  Europe.
- **PayPal → your bank.** Money lands in your PayPal balance at once. New sellers can see holds of up to 21 days on the
  first sales. Move it with **Wallet → Transfer money → Transfer to your bank**: 1–3 business days (instant for a fee).
- **NOWPayments → your wallets.** Automatically, to the payout wallets you set, once the network confirms the payment –
  usually the same day.

**Refunds.** Stripe: **Payments** → the payment → **Refund**. PayPal: **Activity** → the payment → **Refund**. Crypto:
cannot be reversed on the network; NOWPayments has a manual refund tool (you need the buyer's wallet address). A full
refund – and any dispute or chargeback – ends that subscription's Pro access in the Worker automatically. A licence already
in the buyer's browser runs to its own end date (at most the paid period plus three days). Cancel the refunded
subscription too, so it does not charge again.

**Disputes (chargebacks).** Stripe → **Payments → Disputes**: answer before the deadline with the evidence – the
purchase, the licence activation (the receipt reference), the terms link
(`https://jumpingballslive.com/en/terms/#refunds`). Stripe charges a fee per dispute (about $15), refunded if you
win. PayPal: **Resolution Center**.

---

## 8. Licence keys

A licence key pair has two halves:

- the **private half** lives only in the Worker (the secret `LICENSE_PRIVATE_JWK`). It signs licences. It cannot be read
  back from Cloudflare – not even by you.
- the **public half** is built into the website (the GitHub variable `LICENSE_PUBLIC_KEY`). It checks licences. It is safe
  to show anyone.

The repository contains one more pair, the **test key**, which is public on purpose and only for testing: anyone could
sign licences with it. The deploy refuses to publish a live site with it, and the Worker refuses live payment keys next to
it.

**If the private key is lost or leaked**, make a new pair: run `npm run go-live -- --mode live` and answer **No** to "Keep
it?". The wizard makes a new pair, stores it and updates `LICENSE_PUBLIC_KEY`. After the site has redeployed, every
existing buyer's licence stops working until they press **Restore purchase** once (with their e-mail and receipt
reference). E-mail your buyers before you do this.

**The viral bot** renders with your own Pro licence: on the pricing page press **Copy licence key** and give it to the bot
as `BOT_LICENSE`.

---

## 9. GitHub variables and secrets

Where: the repository → **Settings → Secrets and variables → Actions**. The **Variables** tab holds public values, the
**Secrets** tab hidden ones. The wizard sets the billing ones for you when the GitHub CLI is logged in.

| Name | Kind | What it does |
| --- | --- | --- |
| `LICENSE_PUBLIC_KEY` | variable | the public half of your licence key; without it the site is in test mode |
| `BILLING_API_URL` | variable | the Worker's address; without it the pay buttons say payments are not configured |
| `SUPPORT_EMAIL` | variable | the support address on the terms, privacy and pricing pages; also the feedback form's channel |
| `LEGAL_NAME` | variable | your name or business name in the terms ("Who you are buying from") |
| `LEGAL_ADDRESS` | variable | your business address in the terms |
| `FEEDBACK_EMAIL` / `FEEDBACK_ENDPOINT` | variable | where the feedback form sends messages (optional) |
| `ANALYTICS_SCRIPT_URL` / `ANALYTICS_SITE_ID` | variable | a privacy-friendly analytics script (optional) |
| `YOUTUBE_CLIENT_ID` / `PUBLISH_RELAY_URL` | variable | the Publish feature's YouTube upload and relay, and the relay the Account page (website and Windows app) signs in to (optional) |
| `CLOUDFLARE_API_TOKEN` | secret | lets the "Deploy billing worker" workflow deploy the Worker |
| `CLOUDFLARE_ACCOUNT_ID` | secret | your Cloudflare account, for the same workflow |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | secret | a code-signing certificate for the Windows app (optional, section 11) |

**The production guard.** Every deploy checks the two billing variables first: **both set** (a real public key and the
Worker's `https://` address) or **both empty** (the site then deploys in test mode). One without the other, or the test
key, stops the deploy with a message saying which.

---

## 10. The repository can be private

GitHub only keeps the code and runs the builds. Nothing a visitor or an installed app needs lives in the repository: the
website is served by Cloudflare, the Windows app's downloads and updates by the Releases of a public installers-only repository (`jumpingballslive-windows`,
[RELEASING.md](RELEASING.md), "The downloads repository"), the payment keys and the licence signing key sit in the Cloudflare
Worker, and the accounts in the publish relay on your server. So the repository can be switched to private (Settings →
General → Danger zone → Change visibility) – **after** the steps in [RELEASING.md](RELEASING.md), "Making the repository
private": the older Windows app versions look for updates in GitHub Releases, which a private repository hides.

Two things change with it. A private repository has **2,000 free Actions minutes a month** (a website deploy takes about 60,
a Windows release about 25, the daily viral-video bot about 6) – when they run out nothing deploys until the next month, so
watch Settings → Billing, or take GitHub Pro. And the feedback form can no longer open a GitHub issue (visitors cannot see
the repository): set the repository variable `FEEDBACK_EMAIL` (or `SUPPORT_EMAIL`) to the address that should get feedback.

---

## 11. Windows app releases

The app's version lives in places that must match: `desktop/package.json` (`"version"`), `desktop/package-lock.json`
and `src/lib/desktop/release.ts` (`DESKTOP_VERSION`). To release, for example, 1.0.4:

1. Run `npm run release:desktop -- 1.0.4`. It writes the version into all three files and prints three git lines.
2. Run those lines (add, commit, push). The push that raises the version builds and publishes the release by itself.
   A tag such as `desktop-v1.0.4`, or **Actions → "Windows app" → Run workflow** with version `1.0.4` and **publish**
   ticked, still works too. [`docs/RELEASING.md`](RELEASING.md) has the details.
3. About 10 minutes later **GitHub → Releases** shows "1.0.4" with the installer, the portable EXE and the update file.
   The website's download buttons point at the newest release by themselves; installed apps find the update on their own.
4. On a Windows PC, install it once and look: the title bar says `JumpingBallsLive 1.0.4`, **Help → About** names the same version
   and the website build inside the app, and **Help → What's new** opens the changelog. (The release job's smoke run already
   fails when the app's site has no `version.json`.)

**Code signing is optional.** Without a certificate Windows SmartScreen shows a blue warning the first time; people press
**More info → Run anyway**. With a code-signing certificate (from a certificate authority, about $200–400 a year) set the
secrets `WIN_CSC_LINK` (the certificate file as base64) and `WIN_CSC_KEY_PASSWORD`, and the next release is signed.

---

## 12. Legal pages, support e-mail, operator details

Stripe's and PayPal's reviewers read your terms and privacy pages before they approve live payments. The terms now have:

- **Pro subscriptions** – the prices (filled in from the price file), what renews and what does not.
- **Delivery** – Pro is a digital licence, delivered at once, restorable on any device; nothing is shipped.
- **Cancellation and refunds** – cancel a card subscription any time; a **first card payment is refunded in full when asked
  within 14 days**; renewals and crypto payments are not refundable unless local law says otherwise (the pricing page says the
  same); refunds take 5–10 business days.
- **Who you are buying from** – your name and address from the variables `LEGAL_NAME` and `LEGAL_ADDRESS`, or "the
  operator of <your site>" while they are empty.
- The **support e-mail** (`SUPPORT_EMAIL`) on the terms, the privacy policy and the pricing page.
- The **privacy policy** opens with *Who is responsible* (the same name, address and support e-mail; while they are empty it
  sends people to the feedback form), says the site sets no cookies, and names Cloudflare Web Analytics, the counter
  Cloudflare adds to the site by itself. If you switch that off in the Cloudflare dashboard, delete its sentence
  (`Privacy.information.analytics` in `messages/*.json`) the same day.
- The legal and pricing copy does not mention **PayPal** while it is off. When you turn it on, restore PayPal in
  `Billing.terms` (the content, refunds and operator texts) and `Billing.privacy.content`; the pay button and the email
  hint appear by themselves once the Worker lists it. `tests/legalCopy.test.ts` names the strings that may mention it.

The pages are dated (the "Last updated" line). Set the three variables (the wizard asks for them), and give Stripe
(**Settings → Business → Public details**) and PayPal (**Business information**) the same name, address and support
e-mail.

**Honouring the 14-day rule:** when someone writes within 14 days of their first card payment, refund it in full – Stripe:
**Payments** → the payment → **Refund** (PayPal, if it is ever switched on, is treated like a card: **Activity** → the payment →
**Refund**). Then cancel the subscription so it does not renew. The refund ends their Pro access by itself. A crypto buyer has no
14-day right in the terms, because a crypto payment cannot be reversed on the network: refund one by hand (NOWPayments' refund
tool, which needs the buyer's wallet address) only where the law of their country requires it, or as goodwill.

---

## 13. Taxes in one paragraph

The prices ($6.99 a month, $49 a year) do not include tax. What you earn from Pro is your taxable income. Many countries also
charge VAT or sales tax on digital services sold to consumers: in the EU, VAT applies from the first sale to an EU consumer
for a seller outside the EU (inside the EU through the One-Stop-Shop scheme), and US states have their own thresholds.
**Stripe Tax** can work out and collect the tax on card payments (Stripe → **Settings → Tax** → add your registrations,
then answer **yes** to "Do you use Stripe Tax?" in the wizard); PayPal and NOWPayments do not do this for you. Keep the
monthly payout statements of all three, and ask an accountant in your country before the first sales.

---

## 14. Launch-day checklist

1. [ ] The downloads repository works and this repository can go private (section 10; RELEASING.md).
2. [ ] Cloudflare **Workers Paid** is active.
3. [ ] The bank account is linked and confirmed at **Stripe** and at **PayPal**.
4. [ ] The **payout wallets** are set at NOWPayments (or auto-conversion with one wallet).
5. [ ] Stripe live mode: public details, statement descriptor, receipts e-mail on, customer portal **saved**.
6. [ ] `npm run go-live -- --mode live` has finished without an error.
7. [ ] The GitHub variables are set: `LICENSE_PUBLIC_KEY`, `BILLING_API_URL`, `SUPPORT_EMAIL` (and `LEGAL_NAME`,
   `LEGAL_ADDRESS` if you use them).
8. [ ] The site has redeployed and `npm run go-live:check -- --mode live` says `GO-LIVE CHECK: PASS`.
9. [ ] The three first purchases of section 6(c) are done – and refunded or cancelled.
10. [ ] Someone watches the support inbox.
11. [ ] The terms show today's "Last updated" date and your details.
12. [ ] A note in a safe place (a password manager): the Worker's address, the public licence key, and today's date.
13. [ ] The footer shows the release you intend to launch, <https://jumpingballslive.com/version.json> names the commit that is
    on the product branch, and `curl -sI https://jumpingballslive.com/en/ | grep -i x-build` answers with the same id. The Windows
    app's title bar and Help → About show the version you released.

### 14.1 Search and sharing (once, after the site is live)

The site publishes its sitemap, its robots rules and a social card for every page. Three things only you can do, because they need
your accounts:

1. **Google Search Console** (<https://search.google.com/search-console>): **Add property → Domain** → `jumpingballslive.com`. Google shows
   a TXT record; add it in **Cloudflare → DNS → Records → Add record** (type TXT, name `@`, the value pasted) and press **Verify**.
   Then **Sitemaps → Add a new sitemap** → `sitemap.xml`. Then **URL inspection**: paste `https://jumpingballslive.com/en/` and
   `https://jumpingballslive.com/en/simulator/` and press **Request indexing**. Never use the bare domain as an address to
   inspect or to advertise: it only redirects to a language.
2. **Bing Webmaster Tools** (<https://www.bing.com/webmasters>): **Add a site → Import from Google Search Console**. The sitemap comes
   with it.
3. **Check the cards.** Chat apps and social sites keep the first picture they saw for a link, so paste the address of a page
   into **Facebook's Sharing Debugger** (<https://developers.facebook.com/tools/debug/>) and press **Scrape Again**: the title, the
   description and the 1200×630 card should be the page's own. Do it for `/en/`, `/pl/`, `/es/` and `/en/simulator/`. For X, use its
   card validator if it still offers one, else start a new post with the link (you do not have to send it) and look at the preview.
   Repeat this after every change to a card (`npm run og:cards`, commit, deploy).

Nothing else is needed for the contact details: once `SUPPORT_EMAIL` and `LEGAL_NAME` are set (section 12) the next deploy adds
them to the site's structured data by itself.

### 14.2 Publish and ads (before any money is spent)

The website has a press page (`/press`: facts, descriptions in three lengths, logo files, colours, a contact) and an ad kit,
[`docs/ADS.md`](ADS.md): what to say and never say, where a click lands, the copy of every platform in English, Polish and
Spanish, how to make the creatives with the product itself, how to measure without pixels, and the list below in full. Do these in
this order. Each one is only yours to do:

1. **Put the current build live.** The deployer (section 3) does it when you push; check with `curl -s https://jumpingballslive.com/version.json`
   (the commit and the `build` id) and `curl -s https://jumpingballslive.com/build.txt`. An older build is missing the press page,
   the changelog, the fixed claims and the headers.
2. **Say who runs the site, and answer the mailbox.** Create the support address (Cloudflare → **Email Routing**), put
   `JBL_SUPPORT_EMAIL`, `JBL_FEEDBACK_EMAIL`, `JBL_LEGAL_NAME` and `JBL_LEGAL_ADDRESS` in `/etc/jbl-deploy/env` and rebuild the live
   commit (`deploy/vps/README.md`, "Say who runs the site"). Ad platforms and card networks expect a visible contact.
3. **The two canonical redirects** (http → https, `www` → the bare domain) are made by the site's Worker itself
   (`worker/redirects.mjs`, `run_worker_first` in `wrangler.toml`) since website 1.11.1, so a deploy of that build is enough.
   `npm run launch:check` (A10) confirms both from outside. The dashboard settings (**SSL/TLS → Edge Certificates → Always Use
   HTTPS**, **Rules → Redirect Rules**) are no longer needed and may stay on. The build also writes `/.well-known/security.txt`
   with the support address, so a security researcher knows where to write.
4. **The statistics service**, if you want conversions in the report: Plausible or Umami, then `JBL_ANALYTICS_SCRIPT_URL` and
   `JBL_ANALYTICS_SITE_ID`, then the goals `clip_export`, `checkout_start` and `purchase` (README, "Analytics events"). Without it
   you read clicks, plus Stripe.
5. **Decide PayPal and Publish.** Both are off today and no ad may mention either. Turn PayPal on in the Worker, or leave it off.
   Register the TikTok, Meta and Google apps for Publish, or keep selling share and export only.
6. **Sign the Windows app** (section 11) before any ad for it. Until then ads send people to the website, never to the download.
7. **Ad accounts.** Google Ads, Meta Business (verify the business and the domain, name the EU beneficiary and payer) and TikTok
   Ads, with the same legal name and address everywhere; the brand handles; a lawyer's read of the privacy and refund text and of the
   ad wording ([`docs/ADS.md`](ADS.md) section 12).
8. **Render the creatives** with the viral bot (`--family escape` or `rhythm`, never the default: it includes Fight League clips),
   name each file as its `utm_content`, preview them in each platform, then **start small**: one campaign per platform, three creatives, a
   daily cap, and read it after 7 days.

**Before any paid click: the Fight League card.** The landing pages (`/en/`, `/pl/`, `/es/`) show the Fight League mode card, and
its picture is a frame with third-party character names (see [`docs/ADS.md`](ADS.md), section 2, and the legal audit). Until you
have decided what to do about it (take the card and its picture off the landing page, replace them with a neutral picture, or
accept the risk after a lawyer's read), do not send paid traffic from TikTok, Meta or Google to those three pages. The pages that
do not show it are the gallery, `/en/tiktok-ball-videos/`, `/en/pricing/` and `/en/download/`; none of them pitches the product to
a creator as well as the landing page does, so use them only as `docs/ADS.md` section 4 says (Meta viewer ads to the gallery,
Google Search to the TikTok page) and hold the TikTok creator ads until the card is decided.

**Run the launch check** from a checkout (Node 22, no install needed for the default run) against the live site:

```
npm run launch:check                                  # about 5 seconds, GET and HEAD requests only
npm run launch:check -- --browser                     # also opens the landing page and the studio in Chromium (npx playwright install chromium)
npm run launch:check -- --analytics stats.example.com # the site's code must name your statistics service
npm run launch:check -- --commit HEAD                 # FAIL unless the live build is this checkout's commit
npm run launch:check -- --json                        # the results as JSON
```

(Behind an HTTPS proxy add `NODE_USE_ENV_PROXY=1`. The `http://` and `www` checks read what a proxy answers, so run those from a
direct connection.) Each line is `PASS`, `FAIL`, `WARN` or `SKIP`; the last line is `LAUNCH CHECK: PASS`, `PASS (n warnings)` or
`FAIL (n failed, m warnings)` and the exit code is 1 on any FAIL. What the checks look at: `A1` the build names itself (`/build.txt`,
`/version.json`, the `jbl-build` meta and the `X-Build` header agree), `A2` every public page in every language answers 200 with its
own canonical address, the hreflang set, a social card (a reachable 1200×630 PNG), a title of at most 60 characters and a description
of 70 to 160, `A3` the privacy page has a mailto, `A4` no visitor sees a build variable or an unfilled placeholder, `A5` the pricing
page names only the payment methods the billing Worker has on, `A6` the pricing page does not sell Publish while no channel can be
connected, `A7` the installer, the portable EXE and the checksums download and `latest.yml` is the version the site names, `A8` the
statistics service is in the site's code, `A9` the campaign names survive the landing page and the studio, `A10` `http` and `www`
redirect, `A11` the security headers, and `B1` to `B6` the sitemap and robots, no page kept out of search, valid structured data, the
Fight League notice, the ad copy's price and mode count against the live site, and `security.txt`.

**What must be green before you spend on ads**

- `npm run go-live:check` has no FAIL, and a real card payment and a refund worked in live mode (section 6c).
- `npm run launch:check` has **no FAIL**, and these warnings are cleared: `A3` (a contact), `A5b` and `A6` (the claims), `A10` (http and
  www), `B4` (the Fight League notice). `A11` and `B6` can wait. Run it with `--browser` once: `A9` must pass, or the studio must
  stay out of every ad.
- The support mailbox answers, the privacy page names the statistics service if you installed one, and nothing in an ad is on the
  banned list ([`docs/ADS.md`](ADS.md) section 2).
- Windows ads: only after step 6.

---

## 15. Monthly operations checklist

1. [ ] **Payouts arrived:** Stripe → **Balance → Payouts**; PayPal → **Activity**; your crypto wallets.
2. [ ] **Disputes and refund requests** answered within their deadlines (Stripe → Payments → Disputes; PayPal → Resolution
   Center; the support inbox).
3. [ ] **Failed webhooks:** Stripe → Developers → Webhooks → your endpoint (failed deliveries are red); PayPal → your app →
   Webhooks → **Events**. A few retries are normal; many failures are not.
4. [ ] `npm run go-live:check` still passes (it also proves the keys have not changed).
5. [ ] Cloudflare → Workers & Pages → the Worker → **Metrics**: errors, and the KV usage.
6. [ ] Renewals: the domain name, the Cloudflare plan.
7. [ ] E-mails from Stripe, PayPal or NOWPayments about verification or policy – answer them.

**Fees per payment** (typical; check each provider's current pricing page):

| | Stripe | PayPal | NOWPayments |
| --- | --- | --- | --- |
| Fee per payment (typical; check the provider's current pricing page) | ~2.9 % + $0.30 (US cards; +1.5 % international) + ~0.5 % Stripe Billing on recurring; disputes ~$15 | ~3.49 % + $0.49 (US commercial; +1.5 % international); chargebacks ~$20 | 0.5 % (about 1 % with auto-conversion) + the network fee |
| First money in your account | ~7 days after the first charge (up to 14), then rolling | balance at once, bank in 1–3 business days (holds up to 21 days possible at first) | your wallet, same day after confirmations |

---

## 16. If something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| "Payments are not configured yet" on the pay buttons | `BILLING_API_URL` is not set, or the deploy guard stopped the deploy | set both variables with `npm run go-live -- --mode live`; look at the latest "Build and deploy" run |
| The yellow test-mode line on the live site | `LICENSE_PUBLIC_KEY` is not set (or the site has not redeployed since) | set it, then push or re-run the deploy |
| "the licence was not issued for this site" | the site's public key is not the Worker's | `npm run go-live:check` (check S3) says which key to set |
| A payment button is missing | that provider is off: a secret is missing, or test and live keys are mixed | open `https://<your Worker>/health` – `mismatches` names the problem; run the wizard again |
| "The customer portal could not open" | the Stripe customer portal was never saved in live mode | Stripe (live) → Settings → Billing → Customer portal → **Save** |
| A purchase stays "pending" | crypto: the network is still confirming (normal for a few minutes); card/PayPal: the webhook does not reach the Worker | check the webhook page at Stripe/PayPal for red deliveries; the URL and the events must match section 5 |
| "Too many requests from this connection" | the Worker's rate limit per connection and 10 minutes: 10 checkouts, 150 licence checks (a page waiting for a payment uses about 120), 10 portal links | wait 10 minutes; a page waiting for a payment waits by itself and keeps checking |
| Webhooks answer 500, many claims pending | the Cloudflare free plan's daily storage quota is used up | upgrade to Workers Paid (section 4.1) |
| A red run in GitHub Actions | a check failed; nothing was published | open the run, read the red step |

To undo a website change: GitHub → the commit → **Revert**; about 25 minutes later the old site is back. To undo a Worker
change: Cloudflare → Workers & Pages → the Worker → **Deployments → Rollback**.

The technical details (endpoints, the trust model, how records are kept) are in [`billing/README.md`](../billing/README.md).
