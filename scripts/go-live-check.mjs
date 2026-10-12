#!/usr/bin/env node
// --- go-live-kit --- `npm run go-live:check`: proves the website, the billing Worker, the payment providers and GitHub agree.
//
//   npm run go-live:check                                   (live mode; the Worker from BILLING_API_URL or GitHub)
//   npm run go-live:check -- --mode test                    (while you test with test keys)
//   npm run go-live:check -- --site https://cronusaztec.github.io/Balls --worker https://….workers.dev --json
//   node scripts/go-live-check.mjs --deploy-guard           (deploy.yml's production guard: no network)
//
// Every check prints `PASS|FAIL|WARN|SKIP  <id>  <title> – <detail>`; the last line is `GO-LIVE CHECK: PASS` or
// `GO-LIVE CHECK: FAIL (n)`, and the exit code is 1 on any FAIL. The provider checks (P1–P3) run only when their keys are in
// the environment (STRIPE_SECRET_KEY; PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (+ PAYPAL_ENV); NOWPAYMENTS_API_KEY
// (+ NOWPAYMENTS_SANDBOX)) – they are never asked for, never read from a file and never printed. docs/GO-LIVE.md explains
// every check and what to do when one fails.

import path from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_KEY_RE,
  SERVICE_NAME,
  TEST_PUBLIC_KEY,
  ghRunner,
  isHttpsOrigin,
  pagesSiteUrl,
  parseOptions,
  readBillingConfig,
  repoFromGit,
} from "./lib/go-live-common.mjs";

const TIMEOUT_MS = 15_000;
const CHUNK_LIMIT = 60;

// --- the production guard (deploy.yml) -------------------------------------------------------------------------------

/**
 * deploy.yml's production guard: the two billing variables are set together (a real key, a Worker https origin) or both
 * empty (the site then deploys in test licensing mode). Never the public TEST key. No network.
 */
export function deployGuard(env) {
  const key = String(env.LICENSE_PUBLIC_KEY ?? "").trim();
  const url = String(env.BILLING_API_URL ?? "").trim();
  if (!key && !url) {
    return { ok: true, lines: ["::notice title=Billing in test mode::Payments are not configured: the site deploys in test licensing mode."] };
  }
  if (!key || !url) {
    return {
      ok: false,
      lines: [
        "::error title=Billing is half configured::Set LICENSE_PUBLIC_KEY and BILLING_API_URL together (Settings → Secrets and variables → Actions → Variables), or clear both.",
      ],
    };
  }
  const lines = [];
  if (key === TEST_PUBLIC_KEY) lines.push("::error::LICENSE_PUBLIC_KEY is the public TEST key – generate a real pair with npm run go-live");
  else if (!PUBLIC_KEY_RE.test(key)) {
    lines.push("::error::LICENSE_PUBLIC_KEY is not a licence public key (122 characters starting MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE) – copy line 2 of the key generator, or run npm run go-live -- --mode live");
  }
  if (!isHttpsOrigin(url)) {
    lines.push("::error::BILLING_API_URL must be the Worker's https:// address with no path, e.g. https://jumpingballslive-billing.<you>.workers.dev");
  }
  if (lines.length) return { ok: false, lines };
  return { ok: true, lines: [`Billing is live: the site verifies licences with ${key.slice(0, 12)}…${key.slice(-8)} and pays through ${url.replace(/\/+$/, "")}.`] };
}

// --- reading the site --------------------------------------------------------------------------------------------------

/**
 * The /_next/static/chunks/*.js files a page references – its <script src> and <link href> tags and the chunk paths in its
 * inline React payload – as absolute URLs (deduplicated, in page order). `siteOrigin` is the page's (or the site's) URL the
 * paths resolve against.
 */
export function chunkUrls(html, siteOrigin) {
  const out = [];
  const add = (u) => {
    try {
      const abs = new URL(u, siteOrigin).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      // not a URL
    }
  };
  let prefix = null; // where /_next/ lives on this site, e.g. "/Balls/_next/"
  for (const m of String(html).matchAll(/(?:src|href)=["']([^"']*?\/_next\/static\/chunks\/[^"']+?\.js)(?:\?[^"']*)?["']/g)) {
    add(m[1].replace(/&amp;/g, "&"));
    if (prefix === null) prefix = m[1].slice(0, m[1].indexOf("/_next/") + "/_next/".length);
  }
  if (prefix === null) {
    try {
      prefix = `${new URL(siteOrigin).pathname.replace(/\/+$/, "")}/_next/`;
    } catch {
      prefix = "/_next/";
    }
  }
  // the React Server Components payload names the rest relative to /_next/ ("static/chunks/…js", JSON-escaped)
  for (const m of String(html).matchAll(/["'\\](?:\/?[^"'\\\s]*\/_next\/)?(static\/chunks\/[A-Za-z0-9_~.\-/[\]%@]+?\.js)(?=\\?["'])/g)) {
    add(prefix + m[1]);
  }
  return out;
}

/** Every licence public key (a 122-character SPKI base64url) in a text, in order (duplicates kept). */
export function extractPublicKeys(text) {
  return [...String(text).matchAll(/(?<![A-Za-z0-9_-])MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{86}(?![A-Za-z0-9_-])/g)].map((m) => m[0]);
}

const short = (key) => (key ? `${key.slice(0, 12)}…${key.slice(-8)}` : "none");

// --- the checks --------------------------------------------------------------------------------------------------------

const result = (id, title, status, detail) => ({ id, title, status, detail });

async function request(fetchImpl, url, init = {}) {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: true, status: res.status, headers: res.headers, text, json };
  } catch (err) {
    const cause = err && typeof err === "object" && "cause" in err && err.cause ? `: ${err.cause.code ?? err.cause.message ?? err.cause}` : "";
    return { ok: false, status: 0, headers: new Headers(), text: "", json: null, error: `${err instanceof Error ? err.message : String(err)}${cause}` };
  }
}

const providerEnvName = { stripe: "STRIPE_WEBHOOK_SECRET", paypal: "PAYPAL_WEBHOOK_ID (and PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)", nowpayments: "NOWPAYMENTS_IPN_SECRET" };
const healthName = { stripe: "stripe", paypal: "paypal", nowpayments: "crypto" };

/**
 * Run every check. `site` is the site's address with its base path (https://cronusaztec.github.io/Balls), `worker` the
 * Worker's origin, `mode` "live" or "test", `env` the provider keys (never printed), `fetchImpl` and `gh` injectable.
 * Resolves with { ok, results }; ok is false when any check FAILs.
 * @param {{ site: string, worker: string, mode?: string, env?: Record<string, string>, fetchImpl?: (url: string, init?: any) => Promise<Response>, gh?: (args: string[], opts?: { input?: string }) => { ok: boolean, code: number, stdout: string, stderr: string }, repo?: string }} options
 * @returns {Promise<{ ok: boolean, results: { id: string, title: string, status: string, detail: string }[] }>}
 */
export async function runChecks({ site, worker, mode = "live", env = {}, fetchImpl = (u, i) => fetch(u, i), gh = ghRunner, repo } = {}) {
  const config = readBillingConfig();
  const results = [];
  const push = (...a) => results.push(result(...a));
  const siteUrl = String(site ?? "").replace(/\/+$/, "");
  const workerUrl = String(worker ?? "").replace(/\/+$/, "");
  let siteOrigin = "";
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    siteOrigin = "";
  }

  // W1 – /health
  let health = null;
  const h = await request(fetchImpl, `${workerUrl}/health`, { headers: { Accept: "application/json" } });
  if (!h.ok) push("W1", "worker-health", "FAIL", `${workerUrl}/health cannot be reached (${h.error}). Is the Worker deployed? Run npm run go-live, or Actions → "Deploy billing worker".`);
  else if (h.status !== 200 || !h.json || h.json.service !== SERVICE_NAME) {
    push("W1", "worker-health", "FAIL", `${workerUrl}/health answered ${h.status}${h.status === 404 ? " (an older Worker without /health – deploy this version)" : ""}, not the billing Worker's health report.`);
  } else {
    health = h.json;
    push("W1", "worker-health", "PASS", `the billing Worker answers at ${workerUrl}`);
  }
  const needsHealth = (id, title) => push(id, title, "SKIP", "needs /health (W1)");

  // W2 – mode
  if (!health) needsHealth("W2", "worker-mode");
  else if (health.mode === mode) push("W2", "worker-mode", "PASS", `the Worker runs in ${mode} mode`);
  else push("W2", "worker-mode", "FAIL", `the Worker runs in ${health.mode} mode, the check expected ${mode}${health.mode === "unset" ? " – no licence signing key is set (npm run go-live)" : ` (run npm run go-live -- --mode ${mode}, or this check with --mode ${health.mode})`}`);

  // W3 – signing key
  if (!health) needsHealth("W3", "signing-key");
  else {
    const key = health.signingKey ?? {};
    if (!key.configured) push("W3", "signing-key", "FAIL", "the Worker has no licence signing key (LICENSE_PRIVATE_JWK) – run npm run go-live");
    else if (mode === "live" && key.test) push("W3", "signing-key", "FAIL", "the Worker signs with the public TEST key – anyone could make licences; run npm run go-live -- --mode live");
    else if (mode === "test" && !key.test) push("W3", "signing-key", "FAIL", "the Worker signs with a real key, but this is a test-mode check");
    else push("W3", "signing-key", "PASS", `${mode === "live" ? "a real" : "the test"} signing key, public half ${short(key.publicKey)}`);
  }

  // W4 – providers
  if (!health) needsHealth("W4", "providers");
  else {
    const providers = health.providers ?? {};
    const mismatches = Array.isArray(health.mismatches) ? health.mismatches : [];
    const off = ["stripe", "paypal", "crypto"].filter((p) => !providers[p]?.configured);
    if (mismatches.length) push("W4", "providers", "FAIL", `switched off because live and test settings disagree: ${mismatches.join("; ")}`);
    else if (off.length) push("W4", "providers", "WARN", `not configured (no button on the site): ${off.join(", ")}`);
    else if (["stripe", "paypal", "crypto"].every((p) => providers[p]?.ready)) push("W4", "providers", "PASS", "Stripe, PayPal and crypto are ready");
    else push("W4", "providers", "FAIL", "a configured provider is not ready");
  }

  // W5 – the webhooks answer (an unsigned POST must be refused with 400 invalid_signature)
  {
    const problems = [];
    const notes = [];
    for (const [provider, p] of [["stripe", config.stripe.webhookPath], ["paypal", config.paypal.webhookPath], ["nowpayments", config.nowpayments.ipnPath]]) {
      const r = await request(fetchImpl, `${workerUrl}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const configured = health?.providers?.[healthName[provider]]?.configured;
      if (!r.ok) problems.push(`${p} cannot be reached (${r.error})`);
      else if (r.status === 400 && (r.json?.error === "invalid_signature" || provider !== "stripe")) notes.push(`${p} refuses unsigned events`);
      else if (r.status === 503 && configured === false) notes.push(`${p} off (provider not configured)`);
      else if (r.status === 503) problems.push(`${p} answers 503: its secret ${providerEnvName[provider]} is missing in the Worker`);
      else problems.push(`${p} answered ${r.status}${r.json?.error ? ` ${r.json.error}` : ""} to an unsigned event (expected 400 invalid_signature)`);
    }
    push("W5", "webhooks-answer", problems.length ? "FAIL" : "PASS", problems.length ? problems.join("; ") : notes.join("; "));
  }

  // W6 – CORS for the site's origin
  {
    const r = await request(fetchImpl, `${workerUrl}/config`, { method: "OPTIONS", headers: { Origin: siteOrigin, "Access-Control-Request-Method": "POST" } });
    const allowed = r.ok ? r.headers.get("access-control-allow-origin") : null;
    const listed = health ? (health.siteOrigins ?? []).includes(siteOrigin) : null;
    if (!r.ok) push("W6", "cors", "FAIL", `/config cannot be reached (${r.error})`);
    else if (r.status !== 204 || allowed !== siteOrigin || listed === false) {
      push("W6", "cors", "FAIL", `the Worker does not let ${siteOrigin} call it (add it to SITE_ORIGIN in billing/wrangler.toml – npm run go-live does it – and deploy the Worker)${health ? `; it allows: ${(health.siteOrigins ?? []).join(" ") || "nothing"}` : ""}`);
    } else push("W6", "cors", "PASS", `${siteOrigin} may call the Worker`);
  }

  // W7 – /config
  {
    const r = await request(fetchImpl, `${workerUrl}/config`, { headers: { Accept: "application/json" } });
    const plans = r.json?.plans;
    const priced = plans?.monthly?.usd === config.plans.monthly.usd && plans?.yearly?.usd === config.plans.yearly.usd;
    const testMode = r.json?.testMode === true;
    if (!r.ok || r.status !== 200 || !r.json) push("W7", "config", "FAIL", `/config ${r.ok ? `answered ${r.status}` : `cannot be reached (${r.error})`}`);
    else if (!priced) push("W7", "config", "FAIL", `/config states ${plans?.monthly?.usd}/${plans?.yearly?.usd} USD, billing/billing-config.json says ${config.plans.monthly.usd}/${config.plans.yearly.usd} – deploy the Worker`);
    else if (testMode !== (mode === "test")) push("W7", "config", "FAIL", `/config says testMode ${testMode}, expected ${mode === "test"}`);
    else push("W7", "config", "PASS", `$${config.plans.monthly.usd}/month and $${config.plans.yearly.usd}/year, testMode ${testMode}`);
  }

  // W8 – storage
  {
    const plan = "KV plan cannot be read here – confirm Workers Paid in the Cloudflare dashboard";
    if (!health) needsHealth("W8", "storage");
    else if (health.storage === true) push("W8", "storage", "PASS", `the KV store is bound; ${plan}`);
    else push("W8", "storage", "WARN", `the Worker has no KV store bound (ENTITLEMENTS in billing/wrangler.toml); ${plan}`);
  }

  // S1 – the pricing page
  const pricing = await request(fetchImpl, `${siteUrl}/en/pricing/`);
  const html = pricing.ok && pricing.status === 200 ? pricing.text : null;
  if (html !== null) push("S1", "site-online", "PASS", `${siteUrl}/en/pricing/ answers`);
  else push("S1", "site-online", "FAIL", `${siteUrl}/en/pricing/ ${pricing.ok ? `answered ${pricing.status}` : `cannot be reached (${pricing.error})`}`);

  // S2 – the site's mode
  if (html === null) push("S2", "site-mode", "SKIP", "needs the pricing page (S1)");
  else {
    const testLine = html.includes('data-testid="billing-test-mode"');
    if (mode === "live" && testLine) push("S2", "site-mode", "FAIL", "the live site still shows the test-mode line: set LICENSE_PUBLIC_KEY and BILLING_API_URL (npm run go-live -- --mode live), then push or re-run the site's deploy");
    else if (mode === "test" && !testLine) push("S2", "site-mode", "FAIL", "the site is built with a real public key, but this is a test-mode check");
    else push("S2", "site-mode", "PASS", mode === "live" ? "the site is not in test mode" : "the site is in test mode");
  }

  // S3 – the site verifies with the Worker's key
  let chunkTexts = null;
  if (html === null) push("S3", "site-key-matches-worker", "SKIP", "needs the pricing page (S1)");
  else {
    const urls = chunkUrls(html, `${siteUrl}/en/pricing/`).slice(0, CHUNK_LIMIT);
    chunkTexts = [];
    for (const u of urls) {
      const r = await request(fetchImpl, u);
      if (r.ok && r.status === 200) chunkTexts.push(r.text);
    }
    const keys = [...new Set(chunkTexts.flatMap((t) => extractPublicKeys(t)))];
    const real = keys.filter((k) => k !== TEST_PUBLIC_KEY);
    if (mode === "live") {
      const workerKey = health?.signingKey?.publicKey ?? null;
      if (real.length === 0) push("S3", "site-key-matches-worker", "FAIL", `the site's code holds ${keys.length ? "only the public TEST key" : "no licence key"} (${urls.length} files read) – set LICENSE_PUBLIC_KEY and redeploy the site`);
      else if (real.length > 1) push("S3", "site-key-matches-worker", "FAIL", `the site's code holds ${real.length} different keys: ${real.map(short).join(", ")}`);
      else if (!workerKey) push("S3", "site-key-matches-worker", "FAIL", `the site verifies with ${short(real[0])}, but the Worker's key cannot be read (W1)`);
      else if (real[0] !== workerKey) {
        push("S3", "site-key-matches-worker", "FAIL", `the site verifies with ${short(real[0])} but the Worker signs with ${short(workerKey)} – every buyer would see "the licence was not issued for this site". Set the GitHub variable LICENSE_PUBLIC_KEY to ${workerKey} and redeploy the site`);
      } else push("S3", "site-key-matches-worker", "PASS", `the site and the Worker use the same key ${short(workerKey)}`);
    } else if (keys.includes(TEST_PUBLIC_KEY) && real.length === 0) push("S3", "site-key-matches-worker", "PASS", "the site verifies with the public TEST key");
    else push("S3", "site-key-matches-worker", "FAIL", `test mode expects the public TEST key in the site's code; found ${keys.length ? keys.map(short).join(", ") : "no key"}`);
  }

  // S4 – the site points at the Worker
  if (mode !== "live") push("S4", "site-points-at-worker", "SKIP", "test mode: the site reaches the Worker through the jbl.billingApi override");
  else if (chunkTexts === null) push("S4", "site-points-at-worker", "SKIP", "needs the pricing page (S1)");
  else if (chunkTexts.some((t) => t.includes(workerUrl))) push("S4", "site-points-at-worker", "PASS", `the site's code calls ${workerUrl}`);
  else push("S4", "site-points-at-worker", "FAIL", `the site's code does not name ${workerUrl} – set the GitHub variable BILLING_API_URL to it and redeploy the site`);

  // S5 – the legal pages
  {
    const r = await request(fetchImpl, `${siteUrl}/en/terms/`);
    if (!r.ok || r.status !== 200) push("S5", "legal-pages", "FAIL", `${siteUrl}/en/terms/ ${r.ok ? `answered ${r.status}` : `cannot be reached (${r.error})`}`);
    else if (!r.text.includes('id="refunds"') || !r.text.includes('id="delivery"')) push("S5", "legal-pages", "FAIL", "the terms have no Delivery or Cancellation and refunds section – deploy the current site");
    else if (!r.text.includes("mailto:")) push("S5", "legal-pages", "WARN", "the terms show no support e-mail – set the GitHub variable SUPPORT_EMAIL (payment reviewers look for one)");
    else push("S5", "legal-pages", "PASS", "the terms carry delivery, refunds and a support e-mail");
  }

  // P1 – Stripe
  if (!env.STRIPE_SECRET_KEY) push("P1", "stripe", "SKIP", "set STRIPE_SECRET_KEY in this terminal to check Stripe");
  else results.push(await checkStripe({ env, mode, health, workerUrl, config, fetchImpl }));

  // P2 – PayPal
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) push("P2", "paypal", "SKIP", "set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (and PAYPAL_ENV) in this terminal to check PayPal");
  else results.push(await checkPaypal({ env, mode, health, workerUrl, config, fetchImpl }));

  // P3 – NOWPayments
  if (!env.NOWPAYMENTS_API_KEY) push("P3", "nowpayments", "SKIP", "set NOWPAYMENTS_API_KEY (and NOWPAYMENTS_SANDBOX) in this terminal to check NOWPayments");
  else results.push(await checkNowPayments({ env, mode, fetchImpl }));

  // G1 – GitHub
  results.push(checkGithub({ gh, repo, mode, workerUrl, health }));

  return { ok: !results.some((r) => r.status === "FAIL"), results };
}

async function checkStripe({ env, mode, health, workerUrl, config, fetchImpl }) {
  const key = String(env.STRIPE_SECRET_KEY).trim();
  const keyMode = /^(sk|rk)_live_/.test(key) ? "live" : /^(sk|rk)_test_/.test(key) ? "test" : null;
  if (keyMode !== mode) return result("P1", "stripe", "FAIL", `STRIPE_SECRET_KEY is ${keyMode ? `a ${keyMode} key` : "neither a live nor a test key"}; this is a ${mode}-mode check`);
  const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Stripe-Version": config.stripe.apiVersion };
  const api = (p) => request(fetchImpl, `https://api.stripe.com${p}`, { headers });
  const problems = [];
  const prices = health?.providers?.stripe?.prices;
  if (!prices) problems.push("the Worker reports no Stripe prices (W1/W4)");
  else {
    for (const plan of ["monthly", "yearly"]) {
      const want = config.plans[plan];
      const r = await api(`/v1/prices/${encodeURIComponent(prices[plan] ?? "")}`);
      const p = r.json ?? {};
      if (!r.ok || r.status !== 200) problems.push(`the ${plan} price ${prices[plan]} ${r.ok ? `answered ${r.status}${r.status === 404 ? " (a price of the other mode?)" : ""}` : "cannot be read"}`);
      else if (!p.active || p.currency !== "usd" || p.unit_amount !== Math.round(want.usd * 100) || p.recurring?.interval !== want.interval) {
        problems.push(`the ${plan} price ${prices[plan]} is ${p.active ? "" : "inactive, "}${p.unit_amount / 100} ${String(p.currency).toUpperCase()} per ${p.recurring?.interval}, expected ${want.usd} USD per ${want.interval}`);
      }
    }
  }
  const hooks = await api("/v1/webhook_endpoints?limit=100");
  const target = `${workerUrl}${config.stripe.webhookPath}`;
  const endpoint = (hooks.json?.data ?? []).find((e) => e.url === target && e.status === "enabled");
  if (!hooks.ok || hooks.status !== 200) problems.push("the webhook endpoints cannot be read");
  else if (!endpoint) problems.push(`no enabled webhook endpoint for ${target} (Developers → Webhooks → Add endpoint)`);
  else {
    const events = endpoint.enabled_events ?? [];
    const missing = events.includes("*") ? [] : config.stripe.webhookEvents.filter((e) => !events.includes(e));
    if (missing.length) problems.push(`the webhook endpoint does not send ${missing.join(", ")}`);
  }
  const portal = await api("/v1/billing_portal/configurations?limit=1&active=true");
  if (!portal.ok || portal.status !== 200) problems.push("the customer portal settings cannot be read");
  else if (!(portal.json?.data?.length >= 1)) problems.push("Save the Customer portal settings once: Settings → Billing → Customer portal");
  return problems.length ? result("P1", "stripe", "FAIL", problems.join("; ")) : result("P1", "stripe", "PASS", `${mode} prices, the webhook endpoint and the customer portal are set`);
}

async function checkPaypal({ env, mode, health, workerUrl, config, fetchImpl }) {
  const live = String(env.PAYPAL_ENV ?? "").trim().toLowerCase() === "live";
  if ((live ? "live" : "test") !== mode) return result("P2", "paypal", "FAIL", `PAYPAL_ENV is ${live ? "live" : "sandbox"}; this is a ${mode}-mode check`);
  const base = live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const tok = await request(fetchImpl, `${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const token = tok.json?.access_token;
  if (!token) return result("P2", "paypal", "FAIL", `PayPal refused the client id and secret (${tok.ok ? tok.status : tok.error}) – a ${live ? "live" : "sandbox"} app's credentials?`);
  const api = (p) => request(fetchImpl, `${base}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const problems = [];
  const plans = health?.providers?.paypal?.plans;
  if (!plans) problems.push("the Worker reports no PayPal plans (W1/W4)");
  else {
    for (const plan of ["monthly", "yearly"]) {
      const r = await api(`/v1/billing/plans/${encodeURIComponent(plans[plan] ?? "")}`);
      const price = r.json?.billing_cycles?.[0]?.pricing_scheme?.fixed_price;
      if (!r.ok || r.status !== 200) problems.push(`the ${plan} plan ${plans[plan]} ${r.ok ? `answered ${r.status}` : "cannot be read"}`);
      else if (r.json.status !== "ACTIVE" || Number(price?.value) !== config.plans[plan].usd || price?.currency_code !== "USD") {
        problems.push(`the ${plan} plan ${plans[plan]} is ${r.json.status} at ${price?.value} ${price?.currency_code}, expected ACTIVE at ${config.plans[plan].usd} USD`);
      }
    }
  }
  const hooks = await api("/v1/notifications/webhooks");
  const target = `${workerUrl}${config.paypal.webhookPath}`;
  const hook = (hooks.json?.webhooks ?? []).find((w) => w.url === target);
  if (!hooks.ok || hooks.status !== 200) problems.push("the webhooks cannot be read");
  else if (!hook) problems.push(`no webhook for ${target} (developer.paypal.com → your app → Webhooks)`);
  else {
    const names = (hook.event_types ?? []).map((e) => e.name);
    const missing = names.includes("*") ? [] : config.paypal.webhookEvents.filter((e) => !names.includes(e));
    if (missing.length) problems.push(`the webhook does not send ${missing.join(", ")}`);
  }
  return problems.length ? result("P2", "paypal", "FAIL", problems.join("; ")) : result("P2", "paypal", "PASS", `${live ? "live" : "sandbox"} plans and the webhook are set`);
}

async function checkNowPayments({ env, mode, fetchImpl }) {
  const sandbox = /^(1|true|yes|on)$/i.test(String(env.NOWPAYMENTS_SANDBOX ?? "").trim());
  if ((sandbox ? "test" : "live") !== mode) return result("P3", "nowpayments", "FAIL", `NOWPAYMENTS_SANDBOX says ${sandbox ? "sandbox" : "live"}; this is a ${mode}-mode check`);
  const base = sandbox ? "https://api-sandbox.nowpayments.io" : "https://api.nowpayments.io";
  const r = await request(fetchImpl, `${base}/v1/status`, { headers: { "x-api-key": String(env.NOWPAYMENTS_API_KEY) } });
  if (r.ok && r.status === 200 && r.json?.message === "OK") return result("P3", "nowpayments", "PASS", `the ${sandbox ? "sandbox" : "live"} API answers`);
  return result("P3", "nowpayments", "FAIL", `the ${sandbox ? "sandbox" : "live"} API ${r.ok ? `answered ${r.status}` : `cannot be reached (${r.error})`}`);
}

function checkGithub({ gh, repo, mode, workerUrl, health }) {
  const auth = gh(["auth", "status"]);
  if (!auth.ok || !repo) return result("G1", "github", "SKIP", "the GitHub CLI (gh) is not installed or not logged in – check Settings → Secrets and variables → Actions by hand");
  const variable = (name) => {
    const r = gh(["variable", "get", name, "--repo", repo]);
    return r.ok ? r.stdout.trim() : "";
  };
  const apiUrl = variable("BILLING_API_URL").replace(/\/+$/, "");
  const key = variable("LICENSE_PUBLIC_KEY");
  const secrets = gh(["secret", "list", "--repo", repo]);
  const names = secrets.ok ? secrets.stdout.split(/\s+/) : [];
  const missingSecrets = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((n) => !names.includes(n));
  const problems = [];
  if (mode === "live") {
    if (apiUrl !== workerUrl) problems.push(`BILLING_API_URL is ${apiUrl || "unset"}, the Worker is ${workerUrl}`);
    if (!health?.signingKey?.publicKey) problems.push("the Worker's public key cannot be read (W1)");
    else if (key !== health.signingKey.publicKey) problems.push(`LICENSE_PUBLIC_KEY is ${key ? short(key) : "unset"}, the Worker signs with ${short(health.signingKey.publicKey)}`);
  } else if (apiUrl || key) {
    return result("G1", "github", "WARN", "test mode, but LICENSE_PUBLIC_KEY / BILLING_API_URL are set on GitHub – the next deploy builds a live site");
  }
  if (problems.length) return result("G1", "github", "FAIL", `${problems.join("; ")} – npm run go-live -- --mode live sets them`);
  if (missingSecrets.length) return result("G1", "github", "WARN", `the secrets ${missingSecrets.join(" and ")} are missing: the GitHub 'Deploy billing worker' workflow cannot run`);
  return result("G1", "github", "PASS", mode === "live" ? "the variables match the Worker and the deploy secrets are set" : "no billing variables are set (test mode) and the deploy secrets are set");
}

/** The report: one line per check, then the verdict. */
export function formatReport(results) {
  const width = Math.max(...results.map((r) => r.title.length), 10);
  const lines = results.map((r) => `${r.status.padEnd(4)}  ${r.id.padEnd(2)}  ${r.title.padEnd(width)} – ${r.detail}`);
  const failed = results.filter((r) => r.status === "FAIL").length;
  lines.push("", failed ? `GO-LIVE CHECK: FAIL (${failed})` : "GO-LIVE CHECK: PASS");
  return lines;
}

// --- the command -------------------------------------------------------------------------------------------------------

async function ask(question) {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseOptions(argv, { booleans: ["json", "deploy-guard", "help"], strings: ["site", "worker", "mode"] });
  if (opts.help) {
    console.log("Usage: npm run go-live:check [-- --site <url> --worker <url> --mode live|test --json]   |   node scripts/go-live-check.mjs --deploy-guard");
    return 0;
  }
  if (opts["deploy-guard"]) {
    const guard = deployGuard(env);
    for (const line of guard.lines) (guard.ok ? console.log : console.error)(line);
    return guard.ok ? 0 : 1;
  }
  const mode = opts.mode ?? "live";
  if (mode !== "live" && mode !== "test") throw new Error("--mode is live or test");
  const remote = repoFromGit();
  const gh = ghRunner;
  let worker = opts.worker ?? env.BILLING_API_URL ?? "";
  if (!worker && remote) {
    const r = gh(["variable", "get", "BILLING_API_URL", "--repo", remote.slug]);
    if (r.ok) worker = r.stdout.trim();
  }
  if (!worker) worker = await ask("The Worker's address (https://….workers.dev, printed by npm run go-live): ");
  if (!isHttpsOrigin(worker)) throw new Error("The Worker's address must be an https:// address with no path, e.g. https://jumpingballslive-billing.<you>.workers.dev (--worker)");
  const site = (opts.site ?? pagesSiteUrl(remote)).replace(/\/+$/, "");
  const providerEnv = {};
  for (const name of ["STRIPE_SECRET_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "NOWPAYMENTS_API_KEY", "NOWPAYMENTS_SANDBOX"]) {
    if (env[name]) providerEnv[name] = env[name];
  }
  const { ok, results } = await runChecks({ site, worker, mode, env: providerEnv, gh, repo: remote?.slug });
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(`Checking ${site} (site) and ${worker.replace(/\/+$/, "")} (Worker) in ${mode} mode\n`);
    for (const line of formatReport(results)) console.log(line);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`go-live:check: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
