import { generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  FROM_EARLIER_STEP,
  VALIDATORS,
  describeCommand,
  parseAccountId,
  parseEnvLines,
  parseGitRemote,
  parseKeygenOutput,
  parseKvCreateOutput,
  parseKvList,
  parseSecretList,
  parseWorkerUrl,
  patchWranglerToml,
  planCommands,
  publicKeyFromPrivateJwk,
  readWranglerToml,
  yesValueAnswer, // --- low-findings-2 ---
} from "../scripts/go-live.mjs";
import { spawn } from "child_process"; // --- low-findings-2 ---
import { chunkUrls, deployGuard, extractPublicKeys, formatReport, runChecks } from "../scripts/go-live-check.mjs";
import { TEST_PRIVATE_D, TEST_PUBLIC_KEY, pagesSiteUrl } from "../scripts/lib/go-live-common.mjs";
import { LICENSE_TEST_PUBLIC_KEY } from "@/lib/billing/config";
import testKey from "./fixtures/license-test-key.json";

/**
 * --- go-live-kit --- The launch wizard (scripts/go-live.mjs) and the go-live check (scripts/go-live-check.mjs): every pasted
 * value is checked by its shape, the tools' output is read back, billing/wrangler.toml is patched line by line, secret values
 * only ever travel on standard input, the deploy guard keeps a deploy all-live or all-test, and the check proves the site,
 * the Worker, the providers and GitHub agree – all without network (fake fetch, fake gh).
 */

const ROOT = path.resolve(__dirname, "..");
// The committed file carries the live storage id and origins; the wizard's job is to patch a fresh copy of it, so these tests
// start from the file with its placeholder id and the single Pages origin it is first generated with.
const WRANGLER = fs
  .readFileSync(path.join(ROOT, "billing", "wrangler.toml"), "utf8")
  .replace(/^(\s*id\s*=\s*)"[0-9a-f]{32}"/m, '$1"REPLACE_WITH_YOUR_KV_NAMESPACE_ID"')
  .replace(/^SITE_ORIGIN\s*=.*$/m, 'SITE_ORIGIN = "https://cronusaztec.github.io"');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "billing", "billing-config.json"), "utf8"));

/** A fresh real P-256 key pair: { privateJwk, publicKey } as the key generator prints them. */
function realPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string; d: string };
  return {
    privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    publicKey: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64url"),
  };
}

/** A key-shaped fake built at run time, so no Stripe-key-shaped literal sits in the repository (secret scanning). */
const fakeKey = (prefix: string, body: string) => `${prefix}_${body}`;

describe("the shared constants", () => {
  it("know the committed TEST key exactly as the fixture and the site do", () => {
    expect(TEST_PUBLIC_KEY).toBe(testKey.publicSpkiBase64url);
    expect(TEST_PUBLIC_KEY).toBe(LICENSE_TEST_PUBLIC_KEY);
    expect(TEST_PRIVATE_D).toBe(testKey.privateJwk.d);
    expect(pagesSiteUrl({ owner: "CronusAztec", repo: "Balls" })).toBe("https://cronusaztec.github.io/Balls");
    expect(pagesSiteUrl({ owner: "Me", repo: "me.github.io" })).toBe("https://me.github.io");
  });
});

describe("the wizard's validators", () => {
  const accepts = (name: keyof typeof VALIDATORS, value: string, ...rest: unknown[]) =>
    expect((VALIDATORS[name] as (...a: unknown[]) => { ok: boolean }).call(null, value, ...rest).ok, `${name} accepts ${value.slice(0, 30)}`).toBe(true);
  const refuses = (name: keyof typeof VALIDATORS, value: string, ...rest: unknown[]) => {
    const r = (VALIDATORS[name] as (...a: unknown[]) => { ok: boolean; reason?: string }).call(null, value, ...rest);
    expect(r.ok, `${name} refuses ${value.slice(0, 30)}`).toBe(false);
    expect(r.reason, name).toMatch(/\w{4}/); // a reason in words
  };

  it("take Stripe keys of the wizard's mode only, and the webhook secret and price shapes", () => {
    accepts("stripeSecretKey", ` ${fakeKey("sk_live", "51ABCDEFGHIJKLMNOPqrstuv")} `, "live");
    accepts("stripeSecretKey", fakeKey("rk_test", "51ABCDEFGHIJKLMNOPqrstuv"), "test");
    refuses("stripeSecretKey", fakeKey("sk_test", "51ABCDEFGHIJKLMNOPqrstuv"), "live");
    refuses("stripeSecretKey", fakeKey("sk_live", "51ABCDEFGHIJKLMNOPqrstuv"), "test");
    refuses("stripeSecretKey", fakeKey("pk_live", "51ABCDEFGHIJKLMNOPqrstuv"), "live");
    refuses("stripeSecretKey", "sk_live_short", "live");
    accepts("stripeWebhookSecret", fakeKey("whsec", "ABCDEFGHIJKLMNOP1234"));
    refuses("stripeWebhookSecret", "whsec_short");
    refuses("stripeWebhookSecret", fakeKey("sk_live", "ABCDEFGHIJKLMNOP1234"));
    accepts("stripePriceId", "price_1QaBcDeFgH");
    refuses("stripePriceId", "prod_1QaBcDeFgH");
    expect(VALIDATORS.stripeSecretKey(fakeKey("sk_live", "51ABCDEFGHIJKLMNOPqrstuv"), "test").reason).toContain("Test mode");
  });

  it("take PayPal, NOWPayments and Cloudflare values by their shapes", () => {
    accepts("paypalClientId", "A".repeat(20) + "b-_".repeat(10));
    refuses("paypalClientId", "too-short");
    accepts("paypalClientSecret", "E".repeat(80));
    refuses("paypalClientSecret", "E".repeat(39));
    accepts("paypalWebhookId", "8PT597110X687430LKGECATA");
    refuses("paypalWebhookId", "lowercase123456");
    accepts("paypalPlanId", "P-5ML4271244454362WXNWU5NQ");
    refuses("paypalPlanId", "I-BW452GLLEP1G");
    accepts("nowpaymentsApiKey", "AB12CD3-EF45GH6-IJ78KL9-MN01OP2");
    refuses("nowpaymentsApiKey", "has spaces in it 1234");
    accepts("nowpaymentsIpnSecret", "s3cr3t!+/=x");
    refuses("nowpaymentsIpnSecret", "short");
    refuses("nowpaymentsIpnSecret", "with a space");
    accepts("cloudflareApiToken", "a".repeat(40));
    refuses("cloudflareApiToken", "a".repeat(29));
    accepts("cloudflareAccountId", "0123456789abcdef0123456789abcdef");
    accepts("kvNamespaceId", "0123456789ABCDEF0123456789ABCDEF"); // lower-cased
    expect(VALIDATORS.kvNamespaceId("0123456789ABCDEF0123456789ABCDEF").value).toBe("0123456789abcdef0123456789abcdef");
    refuses("kvNamespaceId", "0123456789abcdef");
  });

  it("take a licence key pair that belongs together, and never the TEST key in live mode", () => {
    const pair = realPair();
    accepts("publicKey", pair.publicKey, "live");
    accepts("publicKey", TEST_PUBLIC_KEY, "test");
    refuses("publicKey", TEST_PUBLIC_KEY, "live");
    refuses("publicKey", pair.publicKey.slice(0, -1), "live");
    const line1 = JSON.stringify({ privateJwk: pair.privateJwk });
    const r = VALIDATORS.privateJwk(line1, "live", pair.publicKey);
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.value as string)).toEqual(pair.privateJwk);
    accepts("privateJwk", JSON.stringify(pair.privateJwk), "live"); // the bare JWK works too
    refuses("privateJwk", line1, "live", realPair().publicKey); // the other pair's public half
    refuses("privateJwk", JSON.stringify(testKey.privateJwk), "live");
    accepts("privateJwk", JSON.stringify(testKey.privateJwk), "test", TEST_PUBLIC_KEY);
    refuses("privateJwk", JSON.stringify(testKey.publicJwk), "test");
    refuses("privateJwk", "not json", "live");
  });

  it("take an e-mail, a site origin and the Worker's address", () => {
    accepts("email", "help@example.com");
    refuses("email", "help@example");
    refuses("email", "not an email");
    expect(VALIDATORS.origin("HTTPS://WWW.Example.com/").value).toBe("https://www.example.com");
    refuses("origin", "http://www.example.com");
    refuses("origin", "https://www.example.com/shop");
    expect(VALIDATORS.workerUrl("https://jumpingballslive-billing.me.workers.dev/").value).toBe("https://jumpingballslive-billing.me.workers.dev");
    accepts("workerUrl", "https://billing.example.com");
    refuses("workerUrl", "http://jumpingballslive-billing.me.workers.dev");
    refuses("workerUrl", "https://jumpingballslive-billing.me.workers.dev/health");
  });
});

describe("what the tools print, read back", () => {
  it("the key generator's two lines (its stderr notes and blank lines ignored)", () => {
    const out = `Generated an ES256 (P-256) licensing key pair.\n\n1) Worker secret ...\n${JSON.stringify({ privateJwk: testKey.privateJwk })}\n${testKey.publicSpkiBase64url}\n`;
    const pair = parseKeygenOutput(out);
    expect(pair).not.toBeNull();
    expect(pair!.publicKey).toBe(testKey.publicSpkiBase64url);
    expect(pair!.privateJwk).toEqual({ kty: "EC", crv: "P-256", x: testKey.privateJwk.x, y: testKey.privateJwk.y, d: testKey.privateJwk.d });
    expect(JSON.parse(pair!.privateJwkJson)).toEqual(pair!.privateJwk);
    expect(parseKeygenOutput(testKey.publicSpkiBase64url)).toBeNull();
  });

  it("the new KV namespace's id, the namespace list, the secret list and the account id", () => {
    expect(parseKvCreateOutput('🌀 Creating namespace…\n✨ Success!\nAdd the following…\n{ binding = "ENTITLEMENTS", id = "0123456789abcdef0123456789abcdef" }')).toBe("0123456789abcdef0123456789abcdef");
    expect(parseKvCreateOutput('[[kv_namespaces]]\nbinding = "ENTITLEMENTS"\nid = "fedcba9876543210fedcba9876543210"\n')).toBe("fedcba9876543210fedcba9876543210");
    expect(parseKvCreateOutput('preview_id = "fedcba9876543210fedcba9876543210"')).toBeNull();
    expect(parseKvList(' ⛅️ wrangler 3.114\n[\n  { "id": "aa", "title": "jumpingballslive-billing-ENTITLEMENTS", "supports_url_encoding": true },\n  { "id": "bb", "title": "other" }\n]')).toEqual([
      { id: "aa", title: "jumpingballslive-billing-ENTITLEMENTS" },
      { id: "bb", title: "other" },
    ]);
    expect(parseKvList("no list")).toEqual([]);
    expect(parseSecretList('[{"name":"STRIPE_SECRET_KEY","type":"secret_text"},{"name":"LICENSE_PRIVATE_JWK","type":"secret_text"}]')).toEqual(["STRIPE_SECRET_KEY", "LICENSE_PRIVATE_JWK"]);
    expect(parseAccountId("│ Account Name │ Account ID │\n│ Me │ 0123456789abcdef0123456789abcdef │")).toBe("0123456789abcdef0123456789abcdef");
  });

  it("NAME=value lines, the Worker's address and the git remote", () => {
    expect(parseEnvLines("Product prod_1: reused both prices.\nSTRIPE_PRICE_MONTHLY=price_1\nSTRIPE_PRICE_YEARLY=price_2")).toEqual({ STRIPE_PRICE_MONTHLY: "price_1", STRIPE_PRICE_YEARLY: "price_2" });
    expect(parseWorkerUrl("Uploaded jumpingballslive-billing (2.1 sec)\nDeployed jumpingballslive-billing triggers (0.4 sec)\n  https://jumpingballslive-billing.Me-123.workers.dev\nCurrent Version ID: x")).toBe("https://jumpingballslive-billing.me-123.workers.dev");
    expect(parseWorkerUrl("no address")).toBeNull();
    for (const url of ["https://github.com/CronusAztec/Balls", "https://github.com/CronusAztec/Balls.git", "git@github.com:CronusAztec/Balls.git", "ssh://git@github.com/CronusAztec/Balls.git", "http://proxy@127.0.0.1:9000/git/CronusAztec/Balls"]) {
      expect(parseGitRemote(url), url).toMatchObject({ owner: "CronusAztec", repo: "Balls", slug: "CronusAztec/Balls" });
    }
    expect(parseGitRemote("not a remote")).toBeNull();
  });

  it("derives the public key of the fixture's private key", () => {
    expect(publicKeyFromPrivateJwk(testKey.privateJwk)).toBe(testKey.publicSpkiBase64url);
    const pair = realPair();
    expect(publicKeyFromPrivateJwk(pair.privateJwk)).toBe(pair.publicKey);
  });
});

describe("billing/wrangler.toml, patched", () => {
  const ID1 = "0123456789abcdef0123456789abcdef";
  const ID2 = "fedcba9876543210fedcba9876543210";
  const ORIGINS = "https://cronusaztec.github.io https://www.example.com";

  it("writes the storage id over the placeholder and the site origins, and touches no other line", () => {
    expect(WRANGLER).toContain('id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"');
    const patched = patchWranglerToml(WRANGLER, { kvId: ID1, siteOrigin: ORIGINS });
    const before = WRANGLER.split("\n");
    const after = patched.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
    expect(changed).toEqual([
      ['SITE_ORIGIN = "https://cronusaztec.github.io"', `SITE_ORIGIN = "${ORIGINS}"`],
      ['id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"', `id = "${ID1}"`],
    ]);
    expect(patched).toContain('# preview_id = "REPLACE_WITH_YOUR_PREVIEW_KV_NAMESPACE_ID"'); // the comment stays
    expect(readWranglerToml(patched)).toEqual({ name: "jumpingballslive-billing", kvId: ID1, siteOrigins: ORIGINS.split(" ") });
    expect(readWranglerToml(WRANGLER).kvId).toBe("");
  });

  it("replaces an existing id, and is idempotent", () => {
    const once = patchWranglerToml(WRANGLER, { kvId: ID1, siteOrigin: ORIGINS });
    expect(patchWranglerToml(once, { kvId: ID1, siteOrigin: ORIGINS })).toBe(once);
    const moved = patchWranglerToml(once, { kvId: ID2 });
    expect(moved).toContain(`id = "${ID2}"`);
    expect(moved).not.toContain(ID1);
    expect(moved).toContain(`SITE_ORIGIN = "${ORIGINS}"`);
    expect(patchWranglerToml(WRANGLER, {})).toBe(WRANGLER);
  });

  it("adds what is missing in a minimal file", () => {
    const minimal = 'name = "w"\nmain = "src/index.ts"\n\n[[kv_namespaces]]\nbinding = "ENTITLEMENTS"\n';
    const patched = patchWranglerToml(minimal, { kvId: ID1, siteOrigin: "https://a.example" });
    expect(patched).toContain(`binding = "ENTITLEMENTS"\nid = "${ID1}"`);
    expect(patched).toContain('[vars]\nSITE_ORIGIN = "https://a.example"');
    expect(readWranglerToml(patched)).toMatchObject({ kvId: ID1, siteOrigins: ["https://a.example"] });
  });
});

describe("the wizard's command plan", () => {
  const pair = realPair();
  const answers = {
    mode: "live",
    repo: "CronusAztec/Balls",
    kv: { create: true },
    licence: { privateJwkJson: JSON.stringify(pair.privateJwk) },
    stripe: { secretKey: fakeKey("sk_live", "SECRETstripe0123456789"), prices: "create", automaticTax: false, webhookSecret: fakeKey("whsec", "SECRETwebhook0123456789") },
    paypal: { clientId: "SECRETclientIdSECRETclientIdSECRETclientId0", clientSecret: "SECRETclientSecretSECRETclientSecretSECRET", plans: { monthly: "P-MONTHLY0123", yearly: "P-YEARLY01234" }, webhookId: "WEBHOOKID0123" },
    crypto: { apiKey: "SECRET-nowpayments-0123", ipnSecret: "SECRETipn0123456789" },
    github: { variables: { BILLING_API_URL: "https://jumpingballslive-billing.me.workers.dev", LICENSE_PUBLIC_KEY: pair.publicKey, SUPPORT_EMAIL: "help@example.com", LEGAL_NAME: "", LEGAL_ADDRESS: undefined }, secrets: { CLOUDFLARE_API_TOKEN: "SECRETcloudflareToken0123456789abc", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" } },
  };
  const SECRET_VALUES = [answers.licence.privateJwkJson, pair.privateJwk.d, answers.stripe.secretKey, answers.stripe.webhookSecret, answers.paypal.clientId, answers.paypal.clientSecret, answers.crypto.apiKey, answers.crypto.ipnSecret, answers.github.secrets.CLOUDFLARE_API_TOKEN];

  it("stores every secret with `wrangler secret put` – the value only on standard input", () => {
    const plan = planCommands(answers);
    const puts = plan.filter((c: { args: string[] }) => c.args[0] === "wrangler" && c.args[1] === "secret");
    expect(puts.map((c: { args: string[] }) => c.args[3])).toEqual([
      "LICENSE_PRIVATE_JWK",
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_MONTHLY",
      "STRIPE_PRICE_YEARLY",
      "STRIPE_AUTOMATIC_TAX",
      "STRIPE_WEBHOOK_SECRET",
      "PAYPAL_CLIENT_ID",
      "PAYPAL_CLIENT_SECRET",
      "PAYPAL_ENV",
      "PAYPAL_PLAN_MONTHLY",
      "PAYPAL_PLAN_YEARLY",
      "PAYPAL_WEBHOOK_ID",
      "NOWPAYMENTS_API_KEY",
      "NOWPAYMENTS_IPN_SECRET",
      "NOWPAYMENTS_SANDBOX",
    ]);
    for (const c of puts) {
      expect(c.secret, c.label).toBe(true);
      expect(c.cwd).toBe("billing");
      expect(typeof c.stdin).toBe("string");
    }
    expect(puts.find((c: { args: string[] }) => c.args[3] === "STRIPE_SECRET_KEY").stdin).toBe(answers.stripe.secretKey);
    expect(puts.find((c: { args: string[] }) => c.args[3] === "PAYPAL_ENV").stdin).toBe("live");
    expect(puts.find((c: { args: string[] }) => c.args[3] === "NOWPAYMENTS_SANDBOX").stdin).toBe("0");
    expect(puts.find((c: { args: string[] }) => c.args[3] === "STRIPE_PRICE_MONTHLY").stdin).toBe(FROM_EARLIER_STEP); // made by the price script
    // no secret value in any command line, nor in how a command is shown
    for (const c of plan) {
      for (const v of SECRET_VALUES) {
        expect(c.args.join(" "), c.label).not.toContain(v);
        expect(describeCommand(c), c.label).not.toContain(v);
      }
    }
  });

  it("runs in the wizard's order: storage, first deploy, key, providers, final deploy, GitHub", () => {
    const labels = planCommands(answers).map((c: { cmd: string; args: string[] }) => [c.cmd.replace(/\.cmd$/, "").replace(/^.*[\\/]node(\.exe)?$/, "node"), ...c.args.slice(0, 3)].join(" "));
    expect(labels[0]).toBe("npx wrangler kv namespace");
    expect(labels[1]).toBe("npx wrangler deploy");
    expect(labels[2]).toBe("npx wrangler secret put");
    expect(labels).toContain("node billing/scripts/stripe-create-prices.mjs");
    const finalDeploy = labels.lastIndexOf("npx wrangler deploy");
    expect(finalDeploy).toBeGreaterThan(2);
    expect(labels.slice(finalDeploy + 1)).toEqual([
      "gh variable set BILLING_API_URL",
      "gh variable set LICENSE_PUBLIC_KEY",
      "gh variable set SUPPORT_EMAIL",
      "gh secret set CLOUDFLARE_API_TOKEN",
      "gh secret set CLOUDFLARE_ACCOUNT_ID",
    ]);
    const plan = planCommands(answers);
    const ghSecret = plan.find((c: { args: string[] }) => c.args[0] === "secret" && c.args[2] === "CLOUDFLARE_API_TOKEN");
    expect(ghSecret).toMatchObject({ cmd: "gh", secret: true, stdin: answers.github.secrets.CLOUDFLARE_API_TOKEN });
    const prices = plan.find((c: { args: string[] }) => c.args[0] === "billing/scripts/stripe-create-prices.mjs");
    expect(prices).toMatchObject({ secret: true, env: { STRIPE_SECRET_KEY: answers.stripe.secretKey } });
    expect(describeCommand(prices)).toBe("STRIPE_SECRET_KEY=[hidden] node billing/scripts/stripe-create-prices.mjs");
  });

  it("keeps what the Worker has (no secret put for a kept value) and sets nothing on GitHub in test mode", () => {
    const plan = planCommands({ mode: "test", repo: "o/r", licence: { privateJwkJson: JSON.stringify(testKey.privateJwk) }, stripe: { secretKey: undefined, webhookSecret: fakeKey("whsec", "SECRETwebhook0123456789") }, github: answers.github });
    const names = plan.filter((c: { args: string[] }) => c.args[1] === "secret").map((c: { args: string[] }) => c.args[3]);
    expect(names).toEqual(["LICENSE_PRIVATE_JWK", "STRIPE_WEBHOOK_SECRET"]);
    expect(plan.some((c: { cmd: string }) => c.cmd === "gh")).toBe(false);
    expect(plan.filter((c: { args: string[] }) => c.args[1] === "deploy")).toHaveLength(2);
  });
});

describe("the deploy guard", () => {
  const pair = realPair();
  it("passes both empty (test mode) and a real key with a Worker address; fails half, the TEST key and bad shapes", () => {
    const empty = deployGuard({});
    expect(empty.ok).toBe(true);
    expect(empty.lines.join("\n")).toContain("Payments are not configured: the site deploys in test licensing mode.");
    expect(deployGuard({ LICENSE_PUBLIC_KEY: " ", BILLING_API_URL: "" }).ok).toBe(true);
    const half = deployGuard({ BILLING_API_URL: "https://x.workers.dev" });
    expect(half.ok).toBe(false);
    expect(half.lines[0]).toContain("::error title=Billing is half configured::Set LICENSE_PUBLIC_KEY and BILLING_API_URL together");
    expect(deployGuard({ LICENSE_PUBLIC_KEY: pair.publicKey }).ok).toBe(false);
    const test = deployGuard({ LICENSE_PUBLIC_KEY: TEST_PUBLIC_KEY, BILLING_API_URL: "https://x.workers.dev" });
    expect(test).toEqual({ ok: false, lines: ["::error::LICENSE_PUBLIC_KEY is the public TEST key – generate a real pair with npm run go-live"] });
    expect(deployGuard({ LICENSE_PUBLIC_KEY: pair.publicKey.slice(0, 100), BILLING_API_URL: "https://x.workers.dev" }).ok).toBe(false);
    expect(deployGuard({ LICENSE_PUBLIC_KEY: pair.publicKey, BILLING_API_URL: "http://x.workers.dev" }).ok).toBe(false);
    expect(deployGuard({ LICENSE_PUBLIC_KEY: pair.publicKey, BILLING_API_URL: "https://x.workers.dev/api" }).ok).toBe(false);
    expect(deployGuard({ LICENSE_PUBLIC_KEY: pair.publicKey, BILLING_API_URL: "https://x.workers.dev" }).ok).toBe(true);
    expect(deployGuard({ LICENSE_PUBLIC_KEY: pair.publicKey, BILLING_API_URL: "https://x.workers.dev/" }).ok).toBe(true);
  });

  it("is the step deploy.yml runs before the build, on deploys only, with the two variables", () => {
    const deploy = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
    const step = deploy.slice(deploy.indexOf("      - name: Production guard (billing)"));
    expect(step).toMatch(/^ {6}- name: Production guard \(billing\)\n {8}if: env\.DEPLOY == 'true'\n {8}env:\n {10}LICENSE_PUBLIC_KEY: \$\{\{ vars\.LICENSE_PUBLIC_KEY \}\}\n {10}BILLING_API_URL: \$\{\{ vars\.BILLING_API_URL \}\}\n {8}run: node scripts\/go-live-check\.mjs --deploy-guard\n/);
    expect(deploy.indexOf("Production guard (billing)")).toBeLessThan(deploy.indexOf("- name: Build static site"));
    for (const file of ["deploy.yml", "desktop.yml"]) {
      const text = fs.readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8");
      for (const v of ["SUPPORT_EMAIL", "LEGAL_NAME", "LEGAL_ADDRESS"]) expect(text, file).toContain(`NEXT_PUBLIC_${v}: \${{ vars.${v} }}`);
    }
  });
});

// --- the go-live check against a fake world ----------------------------------------------------------------------------

const SITE = "https://cronusaztec.github.io/Balls";
const WORKER = "https://jumpingballslive-billing.me.workers.dev";

interface World {
  key: string;
  chunkKey: string;
  mismatches: string[];
  webhookStatus: Record<string, number>;
  testMode: boolean;
  terms: string;
}

function fakeWorld(over: Partial<World> = {}) {
  const pair = realPair();
  const w: World = { key: pair.publicKey, chunkKey: pair.publicKey, mismatches: [], webhookStatus: {}, testMode: false, terms: '<section id="delivery"></section><section id="refunds"></section><a href="mailto:help@example.com">', ...over };
  const health = {
    ok: w.mismatches.length === 0,
    service: "jumpingballslive-billing",
    mode: "live",
    signingKey: { configured: true, test: false, publicKey: w.key },
    providers: {
      stripe: { configured: true, mode: "live", ready: w.mismatches.length === 0, webhookSecret: true, prices: { monthly: "price_monthly1", yearly: "price_yearly01" }, automaticTax: false },
      paypal: { configured: true, mode: "live", ready: true, webhookId: true, plans: { monthly: "P-MONTHLY0123", yearly: "P-YEARLY01234" } },
      crypto: { configured: true, mode: "live", ready: true, ipnSecret: true },
    },
    mismatches: w.mismatches,
    siteOrigins: ["https://cronusaztec.github.io"],
    desktopOrigin: "app://jumpingballslive",
    storage: true,
    plans: { monthly: { usd: CONFIG.plans.monthly.usd, days: 30 }, yearly: { usd: CONFIG.plans.yearly.usd, days: 365 } },
    webhooks: {},
    limits: { checkoutPer10Min: 10, licensePer10Min: 150, portalPer10Min: 10 },
  };
  const pricing = `<!DOCTYPE html><html><head><script src="/Balls/_next/static/chunks/webpack-1.js" async=""></script></head><body><main>Pricing</main><script>self.__next_f.push([1,"3:I[1234,[\\"static/chunks/app/%5Blocale%5D/pricing/page-2.js\\"],\\"PricingPlans\\"]"])</script></body></html>`;
  const chunks: Record<string, string> = {
    [`https://cronusaztec.github.io/Balls/_next/static/chunks/webpack-1.js`]: "(()=>{})();",
    [`https://cronusaztec.github.io/Balls/_next/static/chunks/app/%5Blocale%5D/pricing/page-2.js`]: `var a="${w.chunkKey}",b="${WORKER}";`,
  };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url === `${WORKER}/health`) return json(health);
    if (url === `${WORKER}/config` && method === "OPTIONS") {
      const origin = new Headers(init.headers).get("origin") ?? "";
      return new Response(null, { status: 204, headers: origin === "https://cronusaztec.github.io" ? { "access-control-allow-origin": origin } : {} });
    }
    if (url === `${WORKER}/config`) return json({ plans: { monthly: { usd: CONFIG.plans.monthly.usd }, yearly: { usd: CONFIG.plans.yearly.usd } }, providers: { stripe: true, paypal: true, crypto: true }, testMode: w.testMode });
    for (const p of ["/webhooks/stripe", "/webhooks/paypal", "/webhooks/nowpayments"]) {
      if (url === `${WORKER}${p}` && method === "POST") {
        const status = w.webhookStatus[p] ?? 400;
        return json(status === 400 ? { error: "invalid_signature", message: "x" } : { error: "provider_unavailable", message: "x" }, status);
      }
    }
    if (url === `${SITE}/en/pricing/`) return new Response(pricing, { status: 200 });
    if (url === `${SITE}/en/terms/`) return new Response(w.terms, { status: 200 });
    if (chunks[url] !== undefined) return new Response(chunks[url], { status: 200 });
    // Stripe
    if (url === "https://api.stripe.com/v1/prices/price_monthly1") return json({ id: "price_monthly1", active: true, currency: "usd", unit_amount: Math.round(CONFIG.plans.monthly.usd * 100), recurring: { interval: "month" } });
    if (url === "https://api.stripe.com/v1/prices/price_yearly01") return json({ id: "price_yearly01", active: true, currency: "usd", unit_amount: Math.round(CONFIG.plans.yearly.usd * 100), recurring: { interval: "year" } });
    if (url.startsWith("https://api.stripe.com/v1/webhook_endpoints")) return json({ data: [{ url: `${WORKER}/webhooks/stripe`, status: "enabled", enabled_events: CONFIG.stripe.webhookEvents }] });
    if (url.startsWith("https://api.stripe.com/v1/billing_portal/configurations")) return json({ data: [{ id: "bpc_1", active: true }] });
    // PayPal
    if (url === "https://api-m.paypal.com/v1/oauth2/token") return json({ access_token: "tok" });
    if (url === "https://api-m.paypal.com/v1/billing/plans/P-MONTHLY0123") return json({ status: "ACTIVE", billing_cycles: [{ pricing_scheme: { fixed_price: { value: String(CONFIG.plans.monthly.usd), currency_code: "USD" } } }] });
    if (url === "https://api-m.paypal.com/v1/billing/plans/P-YEARLY01234") return json({ status: "ACTIVE", billing_cycles: [{ pricing_scheme: { fixed_price: { value: CONFIG.plans.yearly.usd.toFixed(2), currency_code: "USD" } } }] });
    if (url === "https://api-m.paypal.com/v1/notifications/webhooks") return json({ webhooks: [{ url: `${WORKER}/webhooks/paypal`, event_types: CONFIG.paypal.webhookEvents.map((name: string) => ({ name })) }] });
    // NOWPayments
    if (url === "https://api.nowpayments.io/v1/status") return json({ message: "OK" });
    return new Response("not found", { status: 404 });
  };
  const ghCalls: string[][] = [];
  const gh = (args: string[]) => {
    ghCalls.push(args);
    if (args[0] === "auth") return { ok: true, code: 0, stdout: "", stderr: "" };
    if (args[0] === "variable" && args[2] === "BILLING_API_URL") return { ok: true, code: 0, stdout: `${WORKER}\n`, stderr: "" };
    if (args[0] === "variable" && args[2] === "LICENSE_PUBLIC_KEY") return { ok: true, code: 0, stdout: `${w.key}\n`, stderr: "" };
    if (args[0] === "secret") return { ok: true, code: 0, stdout: "CLOUDFLARE_ACCOUNT_ID\tUpdated 2026-10-12\nCLOUDFLARE_API_TOKEN\tUpdated 2026-10-12\n", stderr: "" };
    return { ok: false, code: 1, stdout: "", stderr: "" };
  };
  const env = {
    STRIPE_SECRET_KEY: fakeKey("sk_live", "SECRETstripe0123456789"),
    PAYPAL_CLIENT_ID: "SECRETclientIdSECRETclientIdSECRETclientId0",
    PAYPAL_CLIENT_SECRET: "SECRETclientSecretSECRETclientSecretSECRET",
    PAYPAL_ENV: "live",
    NOWPAYMENTS_API_KEY: "SECRET-nowpayments-0123",
    NOWPAYMENTS_SANDBOX: "0",
  };
  return { fetchImpl, gh, env, calls, ghCalls, key: w.key };
}

const statusOf = (results: { id: string; status: string }[]) => Object.fromEntries(results.map((r) => [r.id, r.status]));

describe("the go-live check", () => {
  it("passes every check when the site, the Worker, Stripe, PayPal, NOWPayments and GitHub agree (live mode)", async () => {
    const world = fakeWorld();
    const { ok, results } = await runChecks({ site: SITE, worker: WORKER, mode: "live", env: world.env, fetchImpl: world.fetchImpl, gh: world.gh, repo: "CronusAztec/Balls" });
    expect(results.map((r: { id: string }) => r.id)).toEqual(["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "S1", "S2", "S3", "S4", "S5", "P1", "P2", "P3", "G1"]);
    const notPassing = results.filter((r: { status: string }) => r.status !== "PASS");
    expect(notPassing, JSON.stringify(notPassing, null, 1)).toEqual([]);
    expect(ok).toBe(true);
    // the check read both chunks (the script tag's and the one the page's payload names)
    expect(world.calls).toContain("GET https://cronusaztec.github.io/Balls/_next/static/chunks/app/%5Blocale%5D/pricing/page-2.js");
    // no secret value in what the check reports
    const report = formatReport(results).join("\n");
    for (const v of Object.values(world.env)) if (v.length > 6) expect(report).not.toContain(v);
  });

  it("fails S3 when the site's code holds the TEST key instead of the Worker's", async () => {
    const world = fakeWorld({ chunkKey: TEST_PUBLIC_KEY });
    const { ok, results } = await runChecks({ site: SITE, worker: WORKER, mode: "live", env: {}, fetchImpl: world.fetchImpl, gh: world.gh, repo: "o/r" });
    expect(ok).toBe(false);
    expect(statusOf(results).S3).toBe("FAIL");
    expect(results.find((r: { id: string }) => r.id === "S3")?.detail).toContain("only the public TEST key");
    expect(statusOf(results)).toMatchObject({ P1: "SKIP", P2: "SKIP", P3: "SKIP" }); // no provider keys in the environment
  });

  it("fails S3 when the site verifies with another real key, W4 on a live/test disagreement and W5 on a missing webhook secret", async () => {
    const other = fakeWorld({ chunkKey: realPair().publicKey });
    expect(statusOf((await runChecks({ site: SITE, worker: WORKER, mode: "live", env: {}, fetchImpl: other.fetchImpl, gh: other.gh, repo: "o/r" })).results).S3).toBe("FAIL");
    const mismatch = fakeWorld({ mismatches: ["stripe: test provider keys with a live licence key"] });
    const r1 = await runChecks({ site: SITE, worker: WORKER, mode: "live", env: {}, fetchImpl: mismatch.fetchImpl, gh: mismatch.gh, repo: "o/r" });
    expect(statusOf(r1.results).W4).toBe("FAIL");
    expect(r1.results.find((r: { id: string }) => r.id === "W4")?.detail).toContain("stripe: test provider keys with a live licence key");
    const noSecret = fakeWorld({ webhookStatus: { "/webhooks/paypal": 503 } });
    const r2 = await runChecks({ site: SITE, worker: WORKER, mode: "live", env: {}, fetchImpl: noSecret.fetchImpl, gh: noSecret.gh, repo: "o/r" });
    expect(statusOf(r2.results).W5).toBe("FAIL");
    expect(r2.results.find((r: { id: string }) => r.id === "W5")?.detail).toContain("PAYPAL_WEBHOOK_ID");
  });

  it("warns about a missing support e-mail, fails a site without the legal sections, and skips GitHub without gh", async () => {
    const noMail = fakeWorld({ terms: '<section id="delivery"></section><section id="refunds"></section>' });
    const r1 = await runChecks({ site: SITE, worker: WORKER, mode: "live", env: {}, fetchImpl: noMail.fetchImpl, gh: () => ({ ok: false, code: 1, stdout: "", stderr: "" }), repo: "o/r" });
    expect(statusOf(r1.results)).toMatchObject({ S5: "WARN", G1: "SKIP" });
    const old = fakeWorld({ terms: "<section id=\"pro\"></section>" });
    expect(statusOf((await runChecks({ site: SITE, worker: WORKER, mode: "live", env: {}, fetchImpl: old.fetchImpl, gh: old.gh, repo: "o/r" })).results).S5).toBe("FAIL");
  });

  it("fails W1 without a stack trace when the Worker cannot be reached, and skips what needs /health", async () => {
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    const { ok, results } = await runChecks({ site: SITE, worker: "https://127.0.0.1:1", mode: "live", env: {}, fetchImpl: down, gh: () => ({ ok: false, code: 1, stdout: "", stderr: "" }) });
    expect(ok).toBe(false);
    expect(statusOf(results)).toMatchObject({ W1: "FAIL", W2: "SKIP", W3: "SKIP", W4: "SKIP", W8: "SKIP", S1: "FAIL", S2: "SKIP", S3: "SKIP" });
    expect(results.find((r: { id: string }) => r.id === "W1")?.detail).toContain("cannot be reached");
  });

  it("formats one line per check and the verdict", () => {
    const lines = formatReport([
      { id: "W1", title: "worker-health", status: "PASS", detail: "ok" },
      { id: "S5", title: "legal-pages", status: "WARN", detail: "no mail" },
      { id: "G1", title: "github", status: "FAIL", detail: "unset" },
    ]);
    expect(lines[0]).toBe("PASS  W1  worker-health – ok");
    expect(lines[1]).toBe("WARN  S5  legal-pages   – no mail");
    expect(lines.at(-1)).toBe("GO-LIVE CHECK: FAIL (1)");
    expect(formatReport([{ id: "W1", title: "worker-health", status: "PASS", detail: "ok" }]).at(-1)).toBe("GO-LIVE CHECK: PASS");
  });

  it("finds the page's chunks and every licence key in a text", () => {
    const html = '<script src="/Balls/_next/static/chunks/a-1.js?dpl=x" async></script><link rel="preload" href="/Balls/_next/static/chunks/b-2.js" as="script"/><script>self.__next_f.push([1,"[\\"static/chunks/c-3.js\\",\\"static/chunks/a-1.js\\"]"])</script>';
    expect(chunkUrls(html, `${SITE}/en/pricing/`)).toEqual([
      "https://cronusaztec.github.io/Balls/_next/static/chunks/a-1.js",
      "https://cronusaztec.github.io/Balls/_next/static/chunks/b-2.js",
      "https://cronusaztec.github.io/Balls/_next/static/chunks/c-3.js",
    ]);
    const k = realPair().publicKey;
    expect(extractPublicKeys(`x="${k}";y="${TEST_PUBLIC_KEY}";z="${k}"`)).toEqual([k, TEST_PUBLIC_KEY, k]);
    expect(extractPublicKeys(`"${k}A"`)).toEqual([]); // not a key on its own
  });
});

// --- low-findings-2 --- --yes takes the default of a value question too (the mode, the own domain, the optional GitHub values),
// not only of a yes/no question: run on an open input with --yes the wizard never waits there
describe("go-live wizard: --yes", () => {
  it("answers a value with a default or an optional one without asking, and asks for a needed one", () => {
    expect(yesValueAnswer(true, { fallback: "test" })).toEqual({ ask: false, value: "test" });
    expect(yesValueAnswer(true, { optional: true })).toEqual({ ask: false, value: undefined });
    expect(yesValueAnswer(true, {})).toEqual({ ask: true });
    expect(yesValueAnswer(false, { fallback: "test" })).toEqual({ ask: true });
    expect(yesValueAnswer(false, { optional: true })).toEqual({ ask: true });
  });

  it("runs a dry run on an open input with --yes to its end without waiting at the mode or the domain question", { timeout: 60_000 }, async () => {
    const root = path.join(__dirname, "..");
    const toml = fs.readFileSync(path.join(root, "billing", "wrangler.toml"), "utf8");
    const result = await new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
      // (stdin stays open, like a terminal nobody types in: a question that waits would hang here)
      const child = spawn(process.execPath, ["scripts/go-live.mjs", "--yes", "--dry-run", "--skip", "stripe,paypal,crypto,github"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (out += String(d)));
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: null, out, timedOut: true });
      }, 45_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, out, timedOut: false });
      });
    });
    expect([result.timedOut, result.code], result.out.slice(-400)).toEqual([false, 0]);
    expect(result.out).toMatch(/\[test\/live\] \(Enter = test\): test \(--yes\)/);
    expect(result.out).toMatch(/Do you have your own domain for the site\?[\s\S]*\(skipped\) \(--yes\)/);
    // a dry run changes no file
    expect(fs.readFileSync(path.join(root, "billing", "wrangler.toml"), "utf8")).toBe(toml);
  });
});
