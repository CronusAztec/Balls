/*
 * --- paywall-gate --- The paywall's fixed points: the key the site verifies licences with, the billing backend's origin,
 * the plans and their maths. Pure (no DOM): the unit tests, the viral bot's Node bundle (src/lib/bot/node.ts) and the
 * page all read it.
 *
 * TEST MODE: a build without NEXT_PUBLIC_LICENSE_PUBLIC_KEY verifies licences with the committed TEST key pair
 * (tests/fixtures/license-test-key.json, whose public half is copied below – the fixture itself is never imported here).
 * Anyone can sign licences with that key, so test mode says so on the pricing page and in the Unlock dialog; a production
 * build sets NEXT_PUBLIC_LICENSE_PUBLIC_KEY (and NEXT_PUBLIC_BILLING_API) – see README "Pricing and licences".
 */

/** localStorage key of the raw licence token (a JWT). */
export const LICENSE_STORAGE_KEY = "jbl.license";
/** localStorage key of the receipt reference the licence was claimed or restored with ({ provider, ref }), for renewals. */
export const LICENSE_REF_STORAGE_KEY = "jbl.license.ref";
/** localStorage key of the last silent renewal attempt (ms), so a page load asks the backend at most every few hours. */
export const LICENSE_RENEWAL_STORAGE_KEY = "jbl.license.renewedAt";
/**
 * TEST MODE ONLY: a localStorage key that points the pricing page at another billing backend – a Worker under `wrangler dev`,
 * or the smoke test's mock. A production build (public key set) ignores it and only talks to NEXT_PUBLIC_BILLING_API.
 */
export const BILLING_API_OVERRIDE_KEY = "jbl.billingApi";

/** The committed TEST public key: tests/fixtures/license-test-key.json → publicSpkiBase64url (base64url of the SPKI DER). */
export const LICENSE_TEST_PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-VrvsDyDq0VpFeKfqI8l87Q2eosUd8aahdPHUMDc-TtNiCReADNxMtur3zPDfu-sH8xkl8iVIc6_ls8E7gLnfQ";

/** The public key baked into this build (empty: test mode). Read as `process.env.NEXT_PUBLIC_…` so Next inlines it. */
const BUILD_PUBLIC_KEY = (process.env.NEXT_PUBLIC_LICENSE_PUBLIC_KEY ?? "").trim();
/** The billing backend's origin baked into this build (empty: payments are not configured). */
const BUILD_BILLING_API = (process.env.NEXT_PUBLIC_BILLING_API ?? "").trim().replace(/\/+$/, "");

/** True when this build verifies licences with the committed TEST key (no NEXT_PUBLIC_LICENSE_PUBLIC_KEY). */
export const LICENSE_TEST_MODE = BUILD_PUBLIC_KEY === "";
/** The SPKI public key (base64url) licences are verified with. */
export const LICENSE_PUBLIC_KEY = BUILD_PUBLIC_KEY || LICENSE_TEST_PUBLIC_KEY;
/** The billing backend's origin of this build, "" when payments are not configured. */
export const BILLING_API = BUILD_BILLING_API;

/** Clock skew a licence's `exp` is allowed (s). */
export const CLOCK_SKEW_SEC = 60;
/** Days of grace the backend adds to the paid period's end in `exp`. */
export const GRACE_DAYS = 3;
/** The account row says "renews / ends on <date>" once `exp` is this close (days). */
export const RENEWAL_NOTICE_DAYS = 7;
/** A silent renewal asks the backend at most this often (ms). */
export const RENEWAL_RETRY_MS = 6 * 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const PLAN_IDS = ["monthly", "yearly"] as const;
export type Plan = (typeof PLAN_IDS)[number];
export const PROVIDERS = ["stripe", "paypal", "crypto"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const isPlan = (value: unknown): value is Plan => typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
export const isProvider = (value: unknown): value is Provider => typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);

export interface PlanInfo {
  /** Price in US dollars. */
  usd: number;
  /** Months the price covers (what the yearly saving is measured against). */
  months: number;
  /** Days a crypto payment buys (crypto cannot renew by itself: it buys a prepaid period). */
  prepaidDays: number;
}

/** The two plans: $10 a month or $79 a year. */
export const PLANS: Record<Plan, PlanInfo> = {
  monthly: { usd: 10, months: 1, prepaidDays: 30 },
  yearly: { usd: 79, months: 12, prepaidDays: 365 },
};

/** The yearly plan's saving against twelve monthly payments, in whole percent (34 for $79 against $120). */
export function yearlySavingPercent(plans: Record<Plan, Pick<PlanInfo, "usd" | "months">> = PLANS): number {
  const monthlyYear = (plans.monthly.usd / plans.monthly.months) * plans.yearly.months;
  if (!(monthlyYear > 0)) return 0;
  return Math.max(0, Math.round((1 - plans.yearly.usd / monthlyYear) * 100));
}

/** What a plan costs a month ($6.58 for the yearly plan), to the cent. */
export function monthlyEquivalentUsd(plan: Plan, plans: Record<Plan, Pick<PlanInfo, "usd" | "months">> = PLANS): number {
  return Math.round((plans[plan].usd / plans[plan].months) * 100) / 100;
}

/** A dollar price in the page's language: "$10", "$79", "$6.58" (no cents on whole dollars). */
export function formatUsd(amount: number, locale: string): string {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${whole ? amount : amount.toFixed(2)}`;
  }
}

/** The plans the backend's /config states (its prices win when they are sane numbers), else the built-in ones. */
export function plansFromConfig(config: { plans?: { monthly?: { usd?: unknown }; yearly?: { usd?: unknown } } } | null | undefined): Record<Plan, PlanInfo> {
  const price = (plan: Plan) => {
    const usd = config?.plans?.[plan]?.usd;
    return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : PLANS[plan].usd;
  };
  return { monthly: { ...PLANS.monthly, usd: price("monthly") }, yearly: { ...PLANS.yearly, usd: price("yearly") } };
}

/** Storage the override is read from (the page's localStorage; null outside a browser). */
type ReadableStorage = Pick<Storage, "getItem"> | null;

function browserStorage(): ReadableStorage {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The billing backend the page talks to: the build's NEXT_PUBLIC_BILLING_API, or – in test mode only – an http(s) origin
 * stored under `BILLING_API_OVERRIDE_KEY`. Null: payments are not configured (the pay buttons say so and nothing is sent).
 */
export function billingApiBase(storage: ReadableStorage = browserStorage(), build = { api: BILLING_API, testMode: LICENSE_TEST_MODE }): string | null {
  if (build.api) return build.api;
  if (!build.testMode || !storage) return null;
  let value: string | null = null;
  try {
    value = storage.getItem(BILLING_API_OVERRIDE_KEY);
  } catch {
    return null;
  }
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
