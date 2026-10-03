import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import {
  allProvidersEnv,
  jsonRequest,
  jsonResponse,
  makeHarness,
  NOW,
  SITE_ORIGIN,
  stubFetch,
  WORKER_ORIGIN,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const RETURN_URL = `${SITE_ORIGIN}/Balls/en/simulator/`;

interface Captured {
  url: string;
  init?: RequestInit;
}

describe("checkout – stripe", () => {
  it("creates a subscription Checkout Session and returns its URL", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const calls: Captured[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      return jsonResponse({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    });
    const res = await handleRequest(
      jsonRequest("/checkout/stripe", { plan: "monthly", email: "buyer@example.com", locale: "en", returnUrl: RETURN_URL }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).url).toBe("https://checkout.stripe.com/c/pay/cs_1");

    const form = new URLSearchParams(calls[0].init!.body as string);
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("line_items[0][price]")).toBe("price_monthly");
    expect(form.get("customer_email")).toBe("buyer@example.com");
    expect(form.get("metadata[plan]")).toBe("monthly");
    expect(form.get("success_url")).toBe(`${RETURN_URL}?claim=stripe&ref={CHECKOUT_SESSION_ID}`);
    expect(form.get("cancel_url")).toBe(RETURN_URL);
  });

  it("refuses a returnUrl that is not on the site", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const res = await handleRequest(
      jsonRequest("/checkout/stripe", { plan: "monthly", locale: "en", returnUrl: "https://evil.example.com/x" }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_return_url");
  });

  it("is 503 when Stripe is not configured", async () => {
    const { env } = makeHarness();
    const res = await handleRequest(
      jsonRequest("/checkout/stripe", { plan: "monthly", locale: "en", returnUrl: RETURN_URL }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(503);
    expect((await jsonOf(res)).error).toBe("provider_unavailable");
  });
});

describe("checkout – paypal", () => {
  it("creates a subscription and stores the order, returning the approve URL", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    let createBody: Record<string, unknown> = {};
    stubFetch((url, init) => {
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok" });
      if (url.endsWith("/v1/billing/subscriptions")) {
        createBody = JSON.parse(init!.body as string);
        return jsonResponse({ id: "I-SUB1", links: [{ rel: "approve", href: "https://www.paypal.com/approve" }] });
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await handleRequest(
      jsonRequest("/checkout/paypal", { plan: "yearly", locale: "en", returnUrl: RETURN_URL }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).url).toBe("https://www.paypal.com/approve");

    expect(createBody.plan_id).toBe("P-YEARLY");
    const orderId = createBody.custom_id as string;
    const appCtx = createBody.application_context as Record<string, unknown>;
    expect(appCtx.return_url).toBe(`${RETURN_URL}?claim=paypal&ref=${orderId}`);
    expect(appCtx.brand_name).toBe("JumpingBallsLive");
    expect((await repo.getPaypalOrder(orderId))!.subscriptionId).toBe("I-SUB1");
  });
});

describe("checkout – crypto", () => {
  it("creates a NOWPayments invoice and stores the pending order", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    let invoiceBody: Record<string, unknown> = {};
    stubFetch((url, init) => {
      if (url.endsWith("/v1/invoice")) {
        invoiceBody = JSON.parse(init!.body as string);
        return jsonResponse({ invoice_url: "https://nowpayments.io/invoice/1" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await handleRequest(
      jsonRequest("/checkout/crypto", { plan: "yearly", email: "buyer@example.com", locale: "en", returnUrl: RETURN_URL }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).url).toBe("https://nowpayments.io/invoice/1");

    expect(invoiceBody.price_amount).toBe(79);
    expect(invoiceBody.price_currency).toBe("usd");
    expect(invoiceBody.ipn_callback_url).toBe(`${WORKER_ORIGIN}/webhooks/nowpayments`);
    const orderId = invoiceBody.order_id as string;
    expect(invoiceBody.success_url).toBe(`${RETURN_URL}?claim=crypto&ref=${orderId}`);
    const order = await repo.getCryptoOrder(orderId);
    expect(order).toMatchObject({ email: "buyer@example.com", plan: "yearly", status: "pending" });
  });

  it("requires an e-mail", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const res = await handleRequest(
      jsonRequest("/checkout/crypto", { plan: "monthly", locale: "en", returnUrl: RETURN_URL }),
      env,
      { now: NOW },
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_request");
  });
});
