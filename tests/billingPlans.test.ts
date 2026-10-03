import { describe, expect, it, vi } from "vitest";
import { BILLING_API_OVERRIDE_KEY, DAY_MS, GRACE_DAYS, LICENSE_REF_STORAGE_KEY, LICENSE_RENEWAL_STORAGE_KEY, LICENSE_STORAGE_KEY, LICENSE_TEST_PUBLIC_KEY, PLANS, billingApiBase, formatUsd, monthlyEquivalentUsd, plansFromConfig, yearlySavingPercent } from "@/lib/billing/config";
import { BillingClient, isEmail, isReceiptRef, parseClaim, parseClaimParams, parseConfig, parseRedirect, pricingReturnUrl } from "@/lib/billing/api";
import { accountMessageKey, accountView, renewQuietly, shouldRenew, storedReceipt } from "@/lib/billing/account";
import { createEntitlementStore, type Entitlement } from "@/lib/billing/entitlement";
import { verifyLicense } from "@/lib/billing/license";
import { signTestLicense } from "../scripts/lib/test-license.mjs";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- paywall-gate --- The plans and their maths, the billing backend's answers as the site reads them (defensively), the
 * claim URL a checkout returns with, the account row's wording and the quiet renewal of a subscription's licence; and the
 * Billing namespace, identical in every locale.
 */

describe("the plans", () => {
  it("are $10 a month or $79 a year, a saving of 34 %", () => {
    expect(PLANS.monthly.usd).toBe(10);
    expect(PLANS.yearly.usd).toBe(79);
    expect(yearlySavingPercent()).toBe(34);
    expect(monthlyEquivalentUsd("yearly")).toBe(6.58);
    expect(monthlyEquivalentUsd("monthly")).toBe(10);
    expect(yearlySavingPercent({ monthly: { usd: 10, months: 1 }, yearly: { usd: 120, months: 12 } })).toBe(0);
    expect(yearlySavingPercent({ monthly: { usd: 10, months: 1 }, yearly: { usd: 200, months: 12 } })).toBe(0);
  });

  it("buy 30 or 365 prepaid days with crypto, and the licence lasts 3 days of grace past the paid period", () => {
    expect(PLANS.monthly.prepaidDays).toBe(30);
    expect(PLANS.yearly.prepaidDays).toBe(365);
    expect(GRACE_DAYS).toBe(3);
  });

  it("take the backend's prices when they are sane", () => {
    expect(plansFromConfig({ plans: { monthly: { usd: 12 }, yearly: { usd: 99 } } })).toMatchObject({ monthly: { usd: 12, prepaidDays: 30 }, yearly: { usd: 99, prepaidDays: 365 } });
    expect(plansFromConfig({ plans: { monthly: { usd: -1 }, yearly: { usd: "79" } } })).toMatchObject({ monthly: { usd: 10 }, yearly: { usd: 79 } });
    expect(plansFromConfig(null)).toMatchObject({ monthly: { usd: 10 }, yearly: { usd: 79 } });
  });

  it("format in the page's language", () => {
    expect(formatUsd(10, "en")).toBe("$10");
    expect(formatUsd(6.58, "en")).toBe("$6.58");
    expect(formatUsd(79, "pl")).toContain("79");
    expect(formatUsd(79, "es")).toContain("79");
  });
});

describe("the billing backend's address", () => {
  const storage = (value: string | null) => ({ getItem: (k: string) => (k === BILLING_API_OVERRIDE_KEY ? value : null) });
  it("is the build's NEXT_PUBLIC_BILLING_API, or – in test mode only – a stored http(s) override", () => {
    expect(billingApiBase(storage(null), { api: "https://billing.example.workers.dev", testMode: false })).toBe("https://billing.example.workers.dev");
    expect(billingApiBase(storage("https://evil.example"), { api: "https://billing.example.workers.dev", testMode: true })).toBe("https://billing.example.workers.dev");
    expect(billingApiBase(storage("http://localhost:8787/"), { api: "", testMode: true })).toBe("http://localhost:8787");
    expect(billingApiBase(storage("http://localhost:8787/"), { api: "", testMode: false })).toBeNull();
    expect(billingApiBase(storage("javascript:alert(1)"), { api: "", testMode: true })).toBeNull();
    expect(billingApiBase(storage(null), { api: "", testMode: true })).toBeNull();
    expect(billingApiBase(null, { api: "", testMode: true })).toBeNull();
  });
});

describe("the backend's answers", () => {
  it("/config: plans, the providers that are on, test mode", () => {
    expect(parseConfig({ plans: { monthly: { usd: 10 }, yearly: { usd: 79 } }, providers: { stripe: true, paypal: false, crypto: true }, testMode: true })).toEqual({ plans: { monthly: { usd: 10 }, yearly: { usd: 79 } }, providers: { stripe: true, paypal: false, crypto: true }, testMode: true });
    expect(parseConfig({ plans: { monthly: { usd: 10 }, yearly: { usd: 79 } }, providers: { stripe: "yes" } })).toEqual({ plans: { monthly: { usd: 10 }, yearly: { usd: 79 } }, providers: { stripe: false, paypal: false, crypto: false }, testMode: false });
    for (const bad of [null, "x", [], { plans: {} }, { plans: { monthly: { usd: 10 } }, providers: {} }, { plans: { monthly: { usd: 0 }, yearly: { usd: 79 } }, providers: {} }]) expect(parseConfig(bad)).toBeNull();
  });

  it("checkouts and the portal: only an https address is followed (http too against a local test Worker)", () => {
    expect(parseRedirect({ url: "https://checkout.stripe.com/c/pay/cs_test_1" })).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(parseRedirect({ url: "http://localhost:8787/pay" })).toBeNull();
    expect(parseRedirect({ url: "http://localhost:8787/pay" }, true)).toBe("http://localhost:8787/pay");
    for (const bad of [{ url: "javascript:alert(1)" }, { url: "data:text/html,x" }, { url: "/relative" }, { url: 5 }, null, "https://x.y"]) expect(parseRedirect(bad, true)).toBeNull();
  });

  it("claims and restores: a token, pending, or an error with its message", () => {
    expect(parseClaim({ token: "a.b.c" })).toEqual({ kind: "token", token: "a.b.c" });
    expect(parseClaim({ pending: true })).toEqual({ kind: "pending" });
    expect(parseClaim({ error: "not_found", message: "No such payment" })).toEqual({ kind: "error", error: "not_found", message: "No such payment" });
    expect(parseClaim({ token: "nope" })).toBeNull();
    expect(parseClaim({ pending: "yes" })).toBeNull();
    expect(parseClaim(42)).toBeNull();
  });

  it("the client: JSON bodies, defensive about the network, HTTP errors and non-JSON", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reply = (status: number, body: unknown, json = true) => async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(json ? JSON.stringify(body) : String(body), { status, headers: { "Content-Type": json ? "application/json" : "text/html" } });
    };
    const ok = new BillingClient("https://billing.test", reply(200, { url: "https://checkout.stripe.com/x" }));
    expect(await ok.checkout("stripe", { plan: "yearly", email: " Me@Example.com ", locale: "pl", returnUrl: "https://site/Balls/pl/pricing/" })).toEqual({ ok: true, value: "https://checkout.stripe.com/x" });
    expect(calls[0].url).toBe("https://billing.test/checkout/stripe");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ plan: "yearly", email: "Me@Example.com", locale: "pl", returnUrl: "https://site/Balls/pl/pricing/" });
    await ok.checkout("paypal", { plan: "monthly", email: "me@example.com", locale: "en", returnUrl: "r" });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ plan: "monthly", locale: "en", returnUrl: "r" }); // PayPal brings its own email
    expect(await new BillingClient("https://billing.test", reply(200, { pending: true })).claim("crypto", "ord_1")).toEqual({ ok: true, value: { kind: "pending" } });
    expect(await new BillingClient("https://billing.test", reply(404, { error: "not_found", message: "Unknown order" })).restore("a@b.co", "ord_1")).toEqual({ ok: true, value: { kind: "error", error: "not_found", message: "Unknown order" } });
    expect(await new BillingClient("https://billing.test", reply(502, "<html>Bad gateway</html>", false)).config()).toMatchObject({ ok: false, kind: "http", status: 502 });
    expect(await new BillingClient("https://billing.test", reply(200, "<html>", false)).config()).toMatchObject({ ok: false, kind: "shape" });
    expect(await new BillingClient("https://billing.test", reply(200, { what: 1 })).claim("stripe", "cs_1")).toMatchObject({ ok: false, kind: "shape" });
    const offline = new BillingClient("https://billing.test", async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await offline.portal("a@b.co")).toEqual({ ok: false, kind: "network", message: "Failed to fetch" });
    expect(await new BillingClient("https://billing.test", reply(200, { error: "no_customer", message: "No subscription for this email" })).portal("a@b.co")).toEqual({ ok: false, kind: "server", message: "No subscription for this email" });
  });
});

describe("the claim a checkout returns with", () => {
  it("reads ?claim=<provider>&ref=<id> and refuses anything else", () => {
    expect(parseClaimParams("?claim=stripe&ref=cs_test_a1B2")).toEqual({ provider: "stripe", ref: "cs_test_a1B2" });
    expect(parseClaimParams("claim=paypal&ref=I-BW452GLLEP1G")).toEqual({ provider: "paypal", ref: "I-BW452GLLEP1G" });
    expect(parseClaimParams(new URLSearchParams({ claim: "crypto", ref: " 5077125051 " }))).toEqual({ provider: "crypto", ref: "5077125051" });
    for (const bad of ["", "?claim=stripe", "?ref=x", "?claim=bitcoin&ref=x", "?claim=stripe&ref=<script>", `?claim=stripe&ref=${"a".repeat(201)}`, "?claim=stripe&ref=a%20b"]) expect(parseClaimParams(bad), bad).toBeNull();
  });

  it("goes back to the pricing page of the buyer's language, without a query", () => {
    expect(pricingReturnUrl("https://cronusaztec.github.io/Balls/", "pl")).toBe("https://cronusaztec.github.io/Balls/pl/pricing/");
    expect(pricingReturnUrl("http://localhost:3000", "en")).toBe("http://localhost:3000/en/pricing/");
  });

  it("checks emails and receipt references loosely", () => {
    expect(isEmail(" me@example.com ")).toBe(true);
    for (const bad of ["", "me", "me@", "@x.y", "a b@c.d"]) expect(isEmail(bad), bad).toBe(false);
    expect(isReceiptRef("sub_1PqR")).toBe(true);
    expect(isReceiptRef("I-BW452GLLEP1G")).toBe(true);
    expect(isReceiptRef("x y")).toBe(false);
  });
});

describe("the account row's wording", () => {
  const now = Date.UTC(2026, 9, 3);
  const pro = (days: number, provider: Entitlement["provider"] = "stripe", plan: Entitlement["plan"] = "yearly"): Entitlement => ({ status: "pro", plan, provider, email: "a@b.co", expiresAt: now + days * DAY_MS, issuedAt: null, testMode: false, dropped: null });

  it("says Free, why a licence was dropped, or that it is checking", () => {
    const free: Entitlement = { status: "free", plan: null, provider: null, email: null, expiresAt: null, issuedAt: null, testMode: false, dropped: null };
    expect(accountMessageKey(accountView(free, now))).toBe("free");
    expect(accountMessageKey(accountView({ ...free, dropped: "expired" }, now))).toBe("freeExpired");
    expect(accountMessageKey(accountView({ ...free, dropped: "invalid" }, now))).toBe("freeInvalid");
    expect(accountMessageKey(accountView({ ...free, status: "checking" }, now))).toBe("checking");
  });

  it("says Pro until the paid period's end (exp minus the grace days)", () => {
    const view = accountView(pro(200), now);
    expect(view).toMatchObject({ kind: "pro", plan: "yearly", phase: "active", date: now + (200 - GRACE_DAYS) * DAY_MS });
    expect(accountMessageKey(view)).toBe("pro");
  });

  it("says renews / ends on <date> once exp is within 7 days – renews for Stripe and PayPal, ends for a crypto period", () => {
    expect(accountView(pro(7.5), now)).toMatchObject({ phase: "active" });
    expect(accountView(pro(7), now)).toMatchObject({ phase: "renews", date: now + 4 * DAY_MS });
    expect(accountMessageKey(accountView(pro(6, "paypal"), now))).toBe("renews");
    expect(accountMessageKey(accountView(pro(6, "crypto", "monthly"), now))).toBe("ends");
    expect(accountMessageKey(accountView(pro(6, null), now))).toBe("ends");
  });

  it("says payment pending in the grace days, then Free once exp has passed", () => {
    expect(accountView(pro(2), now)).toMatchObject({ phase: "grace", date: now + 2 * DAY_MS });
    expect(accountMessageKey(accountView(pro(2, "crypto"), now))).toBe("grace");
    expect(accountView(pro(-0.01), now)).toEqual({ kind: "free", dropped: "expired" });
  });
});

describe("the quiet renewal of a subscription's licence", () => {
  const now = Date.now();
  const memory = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  };
  const proIn = (days: number, provider: Entitlement["provider"] = "stripe"): Entitlement => ({ status: "pro", plan: "monthly", provider, email: "a@b.co", expiresAt: now + days * DAY_MS, issuedAt: null, testMode: true, dropped: null });

  it("asks only for a renewing subscription near its end, with a receipt to ask with, at most every few hours", () => {
    const receipt = { provider: "stripe" as const, ref: "cs_1" };
    expect(shouldRenew(proIn(5), receipt, now, null)).toBe(true);
    expect(shouldRenew(proIn(20), receipt, now, null)).toBe(false);
    expect(shouldRenew(proIn(5, "crypto"), receipt, now, null)).toBe(false);
    expect(shouldRenew(proIn(5), null, now, null)).toBe(false);
    expect(shouldRenew(proIn(5), receipt, now, now - 60_000)).toBe(false);
    expect(shouldRenew(proIn(5), receipt, now, now - 7 * 3600_000)).toBe(true);
    const storage = memory();
    expect(storedReceipt(storage)).toBeNull();
    storage.setItem(LICENSE_REF_STORAGE_KEY, "{bad json");
    expect(storedReceipt(storage)).toBeNull();
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify(receipt));
    expect(storedReceipt(storage)).toEqual(receipt);
  });

  it("installs a newer licence from /license/restore and keeps the stored one otherwise", async () => {
    const storage = memory();
    const store = createEntitlementStore({ storage: () => storage, verify: (t) => verifyLicense(t, { publicKey: LICENSE_TEST_PUBLIC_KEY }), testMode: true, info: () => {} });
    const current = signTestLicense({ sub: "a@b.co", plan: "monthly", provider: "stripe", days: 5 });
    storage.setItem(LICENSE_STORAGE_KEY, current);
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify({ provider: "stripe", ref: "cs_1" }));
    await store.refresh();
    const renewed = signTestLicense({ sub: "a@b.co", plan: "monthly", provider: "stripe", days: 35 });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: renewed }), { status: 200 }));
    const client = new BillingClient("https://billing.test", fetchImpl);
    expect(await renewQuietly(store, client, storage, Date.now())).toBe("renewed");
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBe(renewed);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ email: "a@b.co", ref: "cs_1" });
    expect(Number(storage.getItem(LICENSE_RENEWAL_STORAGE_KEY))).toBeGreaterThan(0);
    // asked lately: skipped; an older licence from the backend is not installed
    expect(await renewQuietly(store, client, storage, Date.now())).toBe("skipped");
    storage.removeItem(LICENSE_RENEWAL_STORAGE_KEY);
    expect(await renewQuietly(store, client, storage, Date.now())).toBe("skipped"); // 35 days left: not near its end
    storage.setItem(LICENSE_STORAGE_KEY, current);
    await store.refresh();
    const stale = new BillingClient("https://billing.test", async () => new Response(JSON.stringify({ token: signTestLicense({ sub: "a@b.co", days: 2 }) })));
    expect(await renewQuietly(store, stale, storage, Date.now())).toBe("unchanged");
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBe(current);
  });
});

describe("the Billing messages", () => {
  const keys = (node: unknown, prefix = ""): string[] =>
    node && typeof node === "object" && !Array.isArray(node) ? Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

  it("have the same keys in English, Polish and Spanish, and the navbar and footer link to the pricing page", () => {
    const b = (m: Record<string, unknown>) => keys(m.Billing).sort();
    expect(b(en).length).toBeGreaterThan(60);
    expect(b(pl)).toEqual(b(en));
    expect(b(es)).toEqual(b(en));
    for (const m of [en, pl, es] as unknown as Record<string, Record<string, string>>[]) {
      expect(m.Navbar.pricing.length).toBeGreaterThan(2);
      expect(m.Footer.pricing.length).toBeGreaterThan(2);
    }
  });

  it("are translated (no Polish or Spanish string left in English, the prices filled in)", () => {
    const strings = (m: Record<string, unknown>) => Object.fromEntries(keys(m.Billing).map((k) => [k, k.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], m.Billing)]));
    const enS = strings(en as Record<string, unknown>);
    for (const other of [pl, es] as Record<string, unknown>[]) {
      const s = strings(other);
      const same = Object.keys(enS).filter((k) => s[k] === enS[k] && /[a-z]{4}/i.test(String(enS[k])) && !/^(PayPal|Pro|Stripe)$/.test(String(enS[k])));
      expect(same, `untranslated: ${same.join(", ")}`).toEqual([]);
    }
  });
});
