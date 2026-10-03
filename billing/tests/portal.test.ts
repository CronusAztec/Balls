import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/app";
import {
  allProvidersEnv,
  jsonOf,
  jsonRequest,
  jsonResponse,
  makeHarness,
  NOW,
  SITE_ORIGIN,
  stubFetch,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("stripe billing portal", () => {
  it("returns a portal URL for a known customer", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser({
      email: "buyer@example.com",
      plan: "monthly",
      provider: "stripe",
      periodEnd: NOW + 30 * 86400,
      status: "active",
      customerId: "cus_1",
      refs: ["cs_1"],
      updatedAt: NOW,
    });
    let returnUrl = "";
    stubFetch((url, init) => {
      if (url.includes("/v1/billing_portal/sessions")) {
        returnUrl = new URLSearchParams(init!.body as string).get("return_url") ?? "";
        return jsonResponse({ url: "https://billing.stripe.com/p/session/1" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "buyer@example.com" }), env, { now: NOW });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).url).toBe("https://billing.stripe.com/p/session/1");
    expect(returnUrl).toBe(SITE_ORIGIN);
  });

  it("comes back to the page the site names (its pricing page under the base path)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser({
      email: "buyer@example.com",
      plan: "yearly",
      provider: "stripe",
      periodEnd: NOW + 300 * 86400,
      status: "active",
      customerId: "cus_2",
      refs: ["cs_2"],
      updatedAt: NOW,
    });
    let returnUrl = "";
    stubFetch((url, init) => {
      if (url.includes("/v1/billing_portal/sessions")) {
        returnUrl = new URLSearchParams(init!.body as string).get("return_url") ?? "";
        return jsonResponse({ url: "https://billing.stripe.com/p/session/2" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const pricing = `${SITE_ORIGIN}/Balls/pl/pricing/`;
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "buyer@example.com", returnUrl: pricing }), env, { now: NOW });
    expect(res.status).toBe(200);
    expect(returnUrl).toBe(pricing);
  });

  it("refuses a returnUrl that is not on the site, before asking Stripe", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser({
      email: "buyer@example.com",
      plan: "monthly",
      provider: "stripe",
      periodEnd: NOW + 30 * 86400,
      status: "active",
      customerId: "cus_3",
      refs: ["cs_3"],
      updatedAt: NOW,
    });
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "buyer@example.com", returnUrl: "https://evil.example.com/" }), env, { now: NOW });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_return_url");
  });

  it("is unknown_reference when the e-mail has no card customer", async () => {
    const { env } = makeHarness(allProvidersEnv());
    stubFetch(() => {
      throw new Error("should not be called");
    });
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "nobody@example.com" }), env, { now: NOW });
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });
});
