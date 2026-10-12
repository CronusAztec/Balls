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
| The website | GitHub Pages, built from the repository | everyone |
| The payment server (the Worker) | Cloudflare Workers | the website, Stripe, PayPal, NOWPayments |
| The Windows app | GitHub Releases of the repository | people who download it |

**Monthly costs**

| What | Cost |
| --- | --- |
| GitHub (public repository, Pages, Actions, Releases) | free |
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

Your website is a folder of ready-made files. GitHub builds that folder from the code and serves it for free from
**GitHub Pages**. Today the address is <https://cronusaztec.github.io/Balls/>. The limits (1 GB of site, about 100 GB of
traffic a month) are far above what you need.

**How it is switched on:** repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. It already is.

**What happens on every push:** every time code is pushed to the default branch, GitHub runs the checks (lint, types, unit
tests, the build – about 6 minutes), then the browser test on four machines at once (about 12–15 minutes), and only when
everything is green it publishes the new site. **From push to live: about 25 minutes.** Other branches are checked but
never published.

**Your own address (optional).** Buy a name at a registrar (Cloudflare Registrar, Namecheap, Porkbun…), for example
`jumpingballs.live`. Then:

1. **First tell the Worker about the new address**, or checkouts from it will be refused. Run `npm run go-live` again (it
   asks "Do you have your own domain for the site?") – or add the address to `SITE_ORIGIN` in `billing/wrangler.toml`
   yourself (several addresses are separated by spaces) and deploy the Worker (section 3).
2. At the registrar, open the DNS settings and add:
   - a **CNAME** record: name `www`, value `cronusaztec.github.io` (no `/Balls`);
   - for the bare name (`@`) four **A** records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
     `185.199.111.153`.
3. In GitHub: **Settings → Pages → Custom domain** → type `www.yourdomain.com` → **Save**. GitHub checks the DNS and
   issues a certificate. This takes minutes to an hour (new DNS records can take up to 24–48 hours to spread).
4. When the box turns green, tick **Enforce HTTPS**.
5. Push anything (or **Actions → "Build and deploy to GitHub Pages" → Run workflow**). The workflow reads the Pages
   settings and builds the site for the new address by itself. Old `cronusaztec.github.io/Balls/…` links redirect.
6. Also protect the name: your GitHub profile → **Settings → Pages → Verified domains** → add it.

---

## 3. One push updates everything

| What | How it updates today | Where to watch |
| --- | --- | --- |
| Website | every push to the default branch (about 25 minutes) | Actions → "Build and deploy to GitHub Pages" |
| Payment Worker | by hand: **Actions → "Deploy billing worker" → Run workflow** (needs the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, section 9), or `npm run go-live` | Actions → "Deploy billing worker" |
| Windows app | push a tag such as `desktop-v1.0.4`, or **Actions → "Windows app" → Run workflow** with a version and "publish" ticked (section 11) | Actions → "Windows app"; GitHub → Releases |

The release kit (a separate change) makes the Worker and the Windows app update by themselves on a push as well; when it
lands, `docs/RELEASING.md` describes it.

If a run in the Actions tab is red, nothing was published: the live site, the Worker and the app are untouched. Open the
run, read the red step, fix, push again.

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
   one, your **bank account** (this is where the money goes), the website (`https://cronusaztec.github.io/Balls/` or your
   domain), and a product description – write "Pro subscription for a browser video tool".
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
5. **Stripe:** the secret key; the two prices (it finds or creates "JumpingBallsLive Pro" at $10 a month and $79 a year –
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

5. The wizard sets the GitHub variables. Push anything, or **Actions → "Build and deploy to GitHub Pages" → Run
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
- **PayPal:** from a second PayPal account (a friend's, or your personal one) buy Monthly for real ($10). It unlocks. Then
  PayPal → **Activity** → the payment → **Refund**, and cancel the subscription (**Settings → Payments → Manage automatic
  payments**, or in the PayPal app).
- **Crypto:** pay Monthly from your own wallet in a cheap coin – USDT on TRON, LTC or DOGE – about $10. It unlocks after
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
(`https://cronusaztec.github.io/Balls/en/terms/#refunds`). Stripe charges a fee per dispute (about $15), refunded if you
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
| `YOUTUBE_CLIENT_ID` / `PUBLISH_RELAY_URL` | variable | the Publish feature's YouTube upload and relay (optional) |
| `CLOUDFLARE_API_TOKEN` | secret | lets the "Deploy billing worker" workflow deploy the Worker |
| `CLOUDFLARE_ACCOUNT_ID` | secret | your Cloudflare account, for the same workflow |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | secret | a code-signing certificate for the Windows app (optional, section 11) |

**The production guard.** Every deploy checks the two billing variables first: **both set** (a real public key and the
Worker's `https://` address) or **both empty** (the site then deploys in test mode). One without the other, or the test
key, stops the deploy with a message saying which.

---

## 10. Why the repository stays public

Keep the repository **public**. The Windows app is downloaded from GitHub Releases, and the installed app checks GitHub
Releases for updates; both work without a login only while the repository is public – a private repository would break
every download and every self-update, and GitHub Pages would then need a paid plan (GitHub Pro, $4 a month). Being public
is safe: the website's code is scrambled (obfuscated) before it is published, and every secret – the payment keys, the
private licence key – lives in the Cloudflare Worker, never in the repository. If you ever want the source private, a
developer can first move the app's releases to a separate public repository; do not switch the visibility before that
(Settings → General → Danger zone → Change visibility).

---

## 11. Windows app releases

The app's version lives in two places that must match: `desktop/package.json` (`"version"`) and
`src/lib/desktop/release.ts` (`DESKTOP_VERSION`). To release, for example, 1.0.4:

1. Change both to `1.0.4`, commit and push.
2. Push a tag:

   ```bash
   git tag desktop-v1.0.4
   git push origin desktop-v1.0.4
   ```

   Or **Actions → "Windows app" → Run workflow** with version `1.0.4` and **publish** ticked.
3. About 10 minutes later **GitHub → Releases** shows "1.0.4" with the installer, the portable EXE and the update file.
   The website's download buttons point at the newest release by themselves; installed apps find the update on their own.

**Code signing is optional.** Without a certificate Windows SmartScreen shows a blue warning the first time; people press
**More info → Run anyway**. With a code-signing certificate (from a certificate authority, about $200–400 a year) set the
secrets `WIN_CSC_LINK` (the certificate file as base64) and `WIN_CSC_KEY_PASSWORD`, and the next release is signed.

---

## 12. Legal pages, support e-mail, operator details

Stripe's and PayPal's reviewers read your terms and privacy pages before they approve live payments. The terms now have:

- **Pro subscriptions** – the prices (filled in from the price file), what renews and what does not.
- **Delivery** – Pro is a digital licence, delivered at once, restorable on any device; nothing is shipped.
- **Cancellation and refunds** – cancel any time; a **first payment is refunded in full when asked within 14 days**;
  renewals and crypto are not refundable unless local law says otherwise; refunds take 5–10 business days.
- **Who you are buying from** – your name and address from the variables `LEGAL_NAME` and `LEGAL_ADDRESS`, or "the
  operator of <your site>" while they are empty.
- The **support e-mail** (`SUPPORT_EMAIL`) on the terms, the privacy policy and the pricing page.

The pages are dated (the "Last updated" line). Set the three variables (the wizard asks for them), and give Stripe
(**Settings → Business → Public details**) and PayPal (**Business information**) the same name, address and support
e-mail.

**Honouring the 14-day rule:** when someone writes within 14 days of their first payment, refund it in full – Stripe:
**Payments** → the payment → **Refund**; PayPal: **Activity** → the payment → **Refund**; crypto: NOWPayments' refund tool
with the buyer's wallet address (manual). Then cancel the subscription so it does not renew. The refund ends their Pro
access by itself.

---

## 13. Taxes in one paragraph

The prices ($10 a month, $79 a year) do not include tax. What you earn from Pro is your taxable income. Many countries also
charge VAT or sales tax on digital services sold to consumers: in the EU, VAT applies from the first sale to an EU consumer
for a seller outside the EU (inside the EU through the One-Stop-Shop scheme), and US states have their own thresholds.
**Stripe Tax** can work out and collect the tax on card payments (Stripe → **Settings → Tax** → add your registrations,
then answer **yes** to "Do you use Stripe Tax?" in the wizard); PayPal and NOWPayments do not do this for you. Keep the
monthly payout statements of all three, and ask an accountant in your country before the first sales.

---

## 14. Launch-day checklist

1. [ ] The repository stays public (section 10).
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
| "Too many requests from this connection" | the Worker's rate limit (10 checkouts per 10 minutes per connection) | wait 10 minutes |
| Webhooks answer 500, many claims pending | the Cloudflare free plan's daily storage quota is used up | upgrade to Workers Paid (section 4.1) |
| A red run in GitHub Actions | a check failed; nothing was published | open the run, read the red step |

To undo a website change: GitHub → the commit → **Revert**; about 25 minutes later the old site is back. To undo a Worker
change: Cloudflare → Workers & Pages → the Worker → **Deployments → Rollback**.

The technical details (endpoints, the trust model, how records are kept) are in [`billing/README.md`](../billing/README.md).
