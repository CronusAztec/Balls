import { describe, expect, it, vi } from "vitest";
import { BILLING_API_OVERRIDE_KEY, CHECKOUT_FROM_STORAGE_KEY, DAY_MS, GRACE_DAYS, LAPSED_RETRY_MS, LICENSE_LAPSED_STORAGE_KEY, LICENSE_REF_STORAGE_KEY, LICENSE_RENEWAL_STORAGE_KEY, LICENSE_STORAGE_KEY, LICENSE_TEST_PUBLIC_KEY, PLANS, billingApiBase, formatUsd, monthlyEquivalentUsd, plansFromConfig, yearlySavingPercent } from "@/lib/billing/config";
import { BillingClient, isEmail, isReceiptRef, parseClaim, parseClaimParams, parseConfig, parseRedirect, pricingReturnUrl } from "@/lib/billing/api";
import { accountMessageKey, accountView, isRenewableLapse, renewQuietly, shouldRenew, storedReceipt } from "@/lib/billing/account";
import { createEntitlementStore, type Entitlement } from "@/lib/billing/entitlement";
import { checkoutFrom, forgetCheckoutFrom, rememberCheckoutFrom, studioReturnPath } from "@/lib/billing/returnTo";
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
    // the Stripe portal: the email AND the receipt reference (an email alone opens nothing), back to the pricing page under
    // the base path (the backend's fallback is the bare site origin)
    expect(await ok.portal(" Me@Example.com ", " cs_test_1 ", "https://site/Balls/pl/pricing/")).toEqual({ ok: true, value: "https://checkout.stripe.com/x" });
    expect(calls[2].url).toBe("https://billing.test/portal/stripe");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ email: "me@example.com", ref: "cs_test_1", returnUrl: "https://site/Balls/pl/pricing/" });
    await ok.portal("me@example.com", "sub_1");
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({ email: "me@example.com", ref: "sub_1" });
    expect(await new BillingClient("https://billing.test", reply(200, { pending: true })).claim("crypto", "ord_1")).toEqual({ ok: true, value: { kind: "pending" } });
    expect(await new BillingClient("https://billing.test", reply(404, { error: "not_found", message: "Unknown order" })).restore("a@b.co", "ord_1")).toEqual({ ok: true, value: { kind: "error", error: "not_found", message: "Unknown order" } });
    expect(await new BillingClient("https://billing.test", reply(502, "<html>Bad gateway</html>", false)).config()).toMatchObject({ ok: false, kind: "http", status: 502 });
    expect(await new BillingClient("https://billing.test", reply(200, "<html>", false)).config()).toMatchObject({ ok: false, kind: "shape" });
    expect(await new BillingClient("https://billing.test", reply(200, { what: 1 })).claim("stripe", "cs_1")).toMatchObject({ ok: false, kind: "shape" });
    const offline = new BillingClient("https://billing.test", async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await offline.portal("a@b.co", "cs_1")).toEqual({ ok: false, kind: "network", message: "Failed to fetch" });
    expect(await new BillingClient("https://billing.test", reply(200, { error: "no_customer", message: "No subscription for this email" })).portal("a@b.co", "cs_1")).toEqual({ ok: false, kind: "server", message: "No subscription for this email" });
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
  const pro = (days: number, provider: Entitlement["provider"] = "stripe", plan: Entitlement["plan"] = "yearly"): Entitlement => ({ status: "pro", plan, provider, email: "a@b.co", expiresAt: now + days * DAY_MS, issuedAt: null, testMode: false, dropped: null, lapsed: null, renewing: false });

  it("says Free, why a licence was dropped, that a lapsed one is being renewed, or that it is checking", () => {
    const free: Entitlement = { status: "free", plan: null, provider: null, email: null, expiresAt: null, issuedAt: null, testMode: false, dropped: null, lapsed: null, renewing: false };
    expect(accountMessageKey(accountView(free, now))).toBe("free");
    expect(accountMessageKey(accountView({ ...free, dropped: "expired" }, now))).toBe("freeExpired");
    expect(accountMessageKey(accountView({ ...free, dropped: "invalid" }, now))).toBe("freeInvalid");
    expect(accountMessageKey(accountView({ ...free, status: "checking" }, now))).toBe("checking");
    const lapsed = { email: "a@b.co", plan: "monthly" as const, provider: "stripe" as const, expiresAt: now - DAY_MS };
    expect(accountView({ ...free, dropped: "expired", lapsed }, now)).toEqual({ kind: "free", dropped: "expired", lapsed, renewing: false });
    expect(accountMessageKey(accountView({ ...free, dropped: "expired", lapsed, renewing: true }, now))).toBe("renewing");
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
    expect(accountView(pro(-0.01), now)).toEqual({ kind: "free", dropped: "expired", lapsed: null, renewing: false });
  });
});

describe("the quiet renewal of a subscription's licence", () => {
  const now = Date.now();
  const memory = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  };
  const proIn = (days: number, provider: Entitlement["provider"] = "stripe"): Entitlement => ({ status: "pro", plan: "monthly", provider, email: "a@b.co", expiresAt: now + days * DAY_MS, issuedAt: null, testMode: true, dropped: null, lapsed: null, renewing: false });
  const lapsedOf = (provider: Entitlement["provider"] = "stripe"): Entitlement => ({ ...proIn(-1, provider), status: "free", plan: null, provider: null, email: null, expiresAt: null, dropped: "expired", lapsed: { email: "a@b.co", plan: "monthly", provider, expiresAt: now - DAY_MS } });
  const newStore = (storage: ReturnType<typeof memory>) => createEntitlementStore({ storage: () => storage, verify: (t) => verifyLicense(t, { publicKey: LICENSE_TEST_PUBLIC_KEY }), testMode: true, info: () => {} });

  it("asks only for a renewing subscription near its end, with a receipt to ask with, at most every few hours", () => {
    const receipt = { provider: "stripe" as const, ref: "cs_1" };
    expect(shouldRenew(proIn(5), receipt, now, null)).toBe(true);
    expect(shouldRenew(proIn(20), receipt, now, null)).toBe(false);
    expect(shouldRenew(proIn(5, "crypto"), receipt, now, null)).toBe(false);
    expect(shouldRenew(proIn(5), null, now, null)).toBe(false);
    expect(shouldRenew(proIn(5), receipt, now, now - 60_000)).toBe(false);
    expect(shouldRenew(proIn(5), receipt, now, now - 7 * 3600_000)).toBe(true);
    // a subscription's licence that ran out: asked every quarter of an hour (the visitor cannot record meanwhile)
    expect(isRenewableLapse(lapsedOf())).toBe(true);
    expect(isRenewableLapse(lapsedOf("crypto"))).toBe(false);
    expect(shouldRenew(lapsedOf(), receipt, now, now - 60_000)).toBe(false);
    expect(shouldRenew(lapsedOf(), receipt, now, now - LAPSED_RETRY_MS)).toBe(true);
    expect(shouldRenew(lapsedOf("paypal"), receipt, now, null)).toBe(true);
    expect(shouldRenew(lapsedOf("crypto"), receipt, now, null)).toBe(false);
    expect(shouldRenew(lapsedOf(), null, now, null)).toBe(false);
    const storage = memory();
    expect(storedReceipt(storage)).toBeNull();
    storage.setItem(LICENSE_REF_STORAGE_KEY, "{bad json");
    expect(storedReceipt(storage)).toBeNull();
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify(receipt));
    expect(storedReceipt(storage)).toEqual(receipt);
  });

  it("installs a newer licence from /license/restore and keeps the stored one otherwise", async () => {
    const storage = memory();
    const store = newStore(storage);
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

  /** An expired monthly Stripe licence (its exp passed yesterday) and the receipt it was claimed with, as the next page load finds them. */
  const lapsedSetup = async () => {
    const storage = memory();
    const exp = Math.floor(Date.now() / 1000) - 86400;
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense({ sub: "buyer@example.com", plan: "monthly", provider: "stripe", exp }));
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify({ provider: "stripe", ref: "cs_test_abc" }));
    const store = newStore(storage);
    await store.refresh();
    return { storage, store };
  };

  it("renews a subscription's licence that ran out: the stored receipt goes to /license/restore and the page ends Pro", async () => {
    const { storage, store } = await lapsedSetup();
    expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: "expired", lapsed: { email: "buyer@example.com", provider: "stripe" } });
    expect(storedReceipt(storage)).toEqual({ provider: "stripe", ref: "cs_test_abc" }); // the receipt survived the expiry
    const renewed = signTestLicense({ sub: "buyer@example.com", plan: "monthly", provider: "stripe", days: 30 });
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().renewing));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: renewed }), { status: 200 }));
    expect(await renewQuietly(store, new BillingClient("https://billing.test", fetchImpl), storage, Date.now())).toBe("renewed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://billing.test/license/restore");
    expect(JSON.parse(String(init.body))).toEqual({ email: "buyer@example.com", ref: "cs_test_abc" });
    expect(store.getSnapshot()).toMatchObject({ status: "pro", plan: "monthly", provider: "stripe", lapsed: null, renewing: false });
    expect(seen).toContain(true); // "Renewing your licence…" while the request ran
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBe(renewed);
    expect(storage.getItem(LICENSE_LAPSED_STORAGE_KEY)).toBeNull();
    expect(storedReceipt(storage)).toEqual({ provider: "stripe", ref: "cs_test_abc" });
  });

  it("forgets the receipt only when the backend says the subscription is over or unknown; a failure keeps it for the next visit", async () => {
    for (const [status, body] of [[402, { error: "not_active", message: "This subscription is no longer active." }], [404, { error: "unknown_reference", message: "No subscription matches" }]] as const) {
      const { storage, store } = await lapsedSetup();
      const client = new BillingClient("https://billing.test", async () => new Response(JSON.stringify(body), { status }));
      expect(await renewQuietly(store, client, storage, Date.now())).toBe("ended");
      expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: "expired", lapsed: null, renewing: false });
      expect(storage.getItem(LICENSE_REF_STORAGE_KEY)).toBeNull();
      expect(storage.getItem(LICENSE_LAPSED_STORAGE_KEY)).toBeNull();
    }
    const { storage, store } = await lapsedSetup();
    const offline = new BillingClient("https://billing.test", async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await renewQuietly(store, offline, storage, Date.now())).toBe("failed");
    expect(storedReceipt(storage)).toEqual({ provider: "stripe", ref: "cs_test_abc" });
    expect(store.getSnapshot()).toMatchObject({ dropped: "expired", lapsed: { email: "buyer@example.com" }, renewing: false });
    // asked a moment ago: the next try waits; a quarter of an hour later it asks again
    const later = new BillingClient("https://billing.test", async () => new Response(JSON.stringify({ token: signTestLicense({ sub: "buyer@example.com", plan: "monthly", provider: "stripe", days: 2 }) })));
    expect(await renewQuietly(store, later, storage, Date.now())).toBe("skipped");
    expect(await renewQuietly(store, later, storage, Date.now() + LAPSED_RETRY_MS)).toBe("renewed");
  });

  it("does not ask for a crypto period that ran out (it cannot renew by itself) or without a receipt", async () => {
    const storage = memory();
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense({ sub: "c@b.co", plan: "monthly", provider: "crypto", days: -1 }));
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify({ provider: "crypto", ref: "order-1" }));
    const store = newStore(storage);
    await store.refresh();
    const fetchImpl = vi.fn(async () => new Response("{}"));
    expect(await renewQuietly(store, new BillingClient("https://billing.test", fetchImpl), storage, Date.now())).toBe("skipped");
    const { storage: noReceipt, store: s2 } = await lapsedSetup();
    noReceipt.removeItem(LICENSE_REF_STORAGE_KEY);
    expect(await renewQuietly(s2, new BillingClient("https://billing.test", fetchImpl), noReceipt, Date.now())).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the way back to the studio after a same-tab checkout", () => {
  it("remembers this site's studio address with its setup, and nothing else", () => {
    const data = new Map<string, string>();
    const session = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    rememberCheckoutFrom(session, { pathname: "/en/simulator/", search: "?mode=bullseye&dur=12" });
    expect(data.get(CHECKOUT_FROM_STORAGE_KEY)).toBe("/en/simulator/?mode=bullseye&dur=12");
    expect(checkoutFrom(session)).toBe("/en/simulator/?mode=bullseye&dur=12");
    forgetCheckoutFrom(session);
    expect(checkoutFrom(session)).toBeNull();
    rememberCheckoutFrom(session, { pathname: "/en/pricing/", search: "" });
    expect(checkoutFrom(session)).toBeNull();
    data.set(CHECKOUT_FROM_STORAGE_KEY, "https://evil.example/en/simulator/");
    expect(checkoutFrom(session)).toBeNull();
    expect(studioReturnPath("/Balls/pl/simulator/?mode=classic", "/Balls")).toBe("/Balls/pl/simulator/?mode=classic");
    expect(studioReturnPath("/Balls/es/simulator/", "/Balls")).toBe("/Balls/es/simulator/");
    for (const bad of ["//evil.example/en/simulator/", "/en/simulator/", "/Balls/de/simulator/", "/Balls/en/simulator/#x", "/Balls/en/simulator/?a=1 b", "javascript:alert(1)"]) expect(studioReturnPath(bad, "/Balls"), bad).toBeNull();
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
