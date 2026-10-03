import { PROVIDERS, isPlan, isProvider, type Plan, type Provider } from "./config";

/*
 * --- paywall-gate --- The billing backend's API as the site calls it (the Worker under billing/ implements it; base =
 * NEXT_PUBLIC_BILLING_API, JSON bodies, CORS):
 *
 *   GET  /config              → { plans: { monthly: { usd }, yearly: { usd } }, providers: { stripe, paypal, crypto }, testMode }
 *   POST /checkout/stripe     { plan, email?, locale, returnUrl } → { url }   hosted Stripe Checkout (Apple Pay, Google Pay)
 *   POST /checkout/paypal     { plan, locale, returnUrl }         → { url }   PayPal's approval page
 *   POST /checkout/crypto     { plan, email, locale, returnUrl }  → { url }   NOWPayments invoice (a prepaid period)
 *   POST /license/claim       { provider, ref }  → { token } | { pending: true } | { error, message }
 *   POST /license/restore     { email, ref }     → { token } | { error, message }
 *   POST /portal/stripe       { email }          → { url }   Stripe's customer portal
 *
 * Every checkout returns the buyer to returnUrl (the pricing page of the buyer's language, sent WITHOUT a query) with
 * `?claim=<provider>&ref=<id>` appended by the backend. Every answer is treated defensively: a network error, a non-JSON
 * body or an unknown shape is an error result, never a throw.
 */

export interface BillingConfig {
  plans: Record<Plan, { usd: number }>;
  providers: Record<Provider, boolean>;
  testMode: boolean;
}

export type BillingErrorKind = "network" | "http" | "shape" | "server";

export type BillingResult<T> = { ok: true; value: T } | { ok: false; kind: BillingErrorKind; message: string; status?: number };

export type ClaimAnswer = { kind: "token"; token: string } | { kind: "pending" } | { kind: "error"; error: string; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** How often a pending crypto claim asks again, and for how long. */
export const CLAIM_POLL_MS = 5000;
export const CLAIM_POLL_LIMIT_MS = 10 * 60 * 1000;
/** A receipt reference: the ids Stripe, PayPal and NOWPayments hand out (letters, digits, - _ . :), at most 200 long. */
const REF_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
/** A plausible email (the backend is the judge; this only spares a round trip for an obvious typo). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (value: string) => EMAIL_PATTERN.test(value.trim()) && value.trim().length <= 254;
export const isReceiptRef = (value: string) => REF_PATTERN.test(value.trim());

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** /config's answer, or null when it is not one. Missing providers are off, a missing testMode is false. */
export function parseConfig(raw: unknown): BillingConfig | null {
  if (!isRecord(raw) || !isRecord(raw.plans) || !isRecord(raw.providers)) return null;
  const plans = {} as Record<Plan, { usd: number }>;
  for (const plan of ["monthly", "yearly"] as const) {
    const entry = raw.plans[plan];
    const usd = isRecord(entry) ? entry.usd : undefined;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
    plans[plan] = { usd };
  }
  const providers = {} as Record<Provider, boolean>;
  for (const p of PROVIDERS) providers[p] = raw.providers[p] === true;
  return { plans, providers, testMode: raw.testMode === true };
}

/**
 * A checkout's or the portal's `{ url }`, or null: only an https URL is followed (http as well when `allowHttp`, i.e. in
 * test mode against a local Worker), never a javascript: or data: one.
 */
export function parseRedirect(raw: unknown, allowHttp = false): string | null {
  if (!isRecord(raw) || typeof raw.url !== "string") return null;
  try {
    const url = new URL(raw.url);
    if (url.protocol === "https:" || (allowHttp && url.protocol === "http:")) return url.href;
  } catch {
    /* not a URL */
  }
  return null;
}

/** /license/claim's and /license/restore's answer, or null for an unknown shape. */
export function parseClaim(raw: unknown): ClaimAnswer | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.token === "string" && raw.token.split(".").length === 3) return { kind: "token", token: raw.token.trim() };
  if (raw.pending === true) return { kind: "pending" };
  if (typeof raw.error === "string" || typeof raw.message === "string") return { kind: "error", error: String(raw.error ?? "error"), message: String(raw.message ?? raw.error ?? "") };
  return null;
}

/** The `?claim=<provider>&ref=<id>` a checkout returns with, or null when the URL carries none (or a malformed one). */
export function parseClaimParams(search: string | URLSearchParams): { provider: Provider; ref: string } | null {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const provider = params.get("claim");
  const ref = params.get("ref")?.trim() ?? "";
  if (!isProvider(provider) || !isReceiptRef(ref)) return null;
  return { provider, ref };
}

/** The address a checkout returns to: the pricing page in the buyer's language, without a query (the backend appends it). */
export function pricingReturnUrl(siteBase: string, locale: string): string {
  return `${siteBase.replace(/\/+$/, "")}/${locale}/pricing/`;
}

/** Talks to the billing backend at `base` (an origin, possibly with a path). */
export class BillingClient {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly allowHttpRedirects = false,
  ) {}

  private async call(path: string, body?: unknown): Promise<BillingResult<unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, body === undefined ? { method: "GET", headers: { Accept: "application/json" } } : { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    } catch (err) {
      return { ok: false, kind: "network", message: err instanceof Error ? err.message : String(err) };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = isRecord(data) && typeof data.message === "string" ? data.message : isRecord(data) && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      // A claim's or a restore's refusal comes as an error body with a 4xx: the caller reads it as an answer.
      if (isRecord(data) && (typeof data.error === "string" || typeof data.message === "string")) return { ok: true, value: data };
      return { ok: false, kind: "http", message, status: res.status };
    }
    if (data === null) return { ok: false, kind: "shape", message: "The billing server did not answer with JSON" };
    return { ok: true, value: data };
  }

  async config(): Promise<BillingResult<BillingConfig>> {
    const r = await this.call("/config");
    if (!r.ok) return r;
    const config = parseConfig(r.value);
    return config ? { ok: true, value: config } : { ok: false, kind: "shape", message: "Unexpected /config answer" };
  }

  /** Starts a checkout; resolves with the URL to send the buyer to. */
  async checkout(provider: Provider, request: { plan: Plan; email?: string; locale: string; returnUrl: string }): Promise<BillingResult<string>> {
    if (!isPlan(request.plan)) return { ok: false, kind: "shape", message: "Unknown plan" };
    const body: Record<string, string> = { plan: request.plan, locale: request.locale, returnUrl: request.returnUrl };
    if (provider !== "paypal" && request.email) body.email = request.email.trim();
    const r = await this.call(`/checkout/${provider}`, body);
    if (!r.ok) return r;
    const url = parseRedirect(r.value, this.allowHttpRedirects);
    if (url) return { ok: true, value: url };
    const message = isRecord(r.value) && typeof r.value.message === "string" ? r.value.message : "The checkout did not return an address";
    return { ok: false, kind: isRecord(r.value) && ("error" in r.value || "message" in r.value) ? "server" : "shape", message };
  }

  async claim(provider: Provider, ref: string): Promise<BillingResult<ClaimAnswer>> {
    const r = await this.call("/license/claim", { provider, ref });
    if (!r.ok) return r;
    const answer = parseClaim(r.value);
    return answer ? { ok: true, value: answer } : { ok: false, kind: "shape", message: "Unexpected /license/claim answer" };
  }

  async restore(email: string, ref: string): Promise<BillingResult<ClaimAnswer>> {
    const r = await this.call("/license/restore", { email: email.trim().toLowerCase(), ref: ref.trim() });
    if (!r.ok) return r;
    const answer = parseClaim(r.value);
    return answer && answer.kind !== "pending" ? { ok: true, value: answer } : { ok: false, kind: "shape", message: "Unexpected /license/restore answer" };
  }

  /** Stripe's customer portal for the email (change the card, cancel). */
  async portal(email: string): Promise<BillingResult<string>> {
    const r = await this.call("/portal/stripe", { email: email.trim().toLowerCase() });
    if (!r.ok) return r;
    const url = parseRedirect(r.value, this.allowHttpRedirects);
    if (url) return { ok: true, value: url };
    return { ok: false, kind: "server", message: isRecord(r.value) && typeof r.value.message === "string" ? r.value.message : "No portal address" };
  }
}
