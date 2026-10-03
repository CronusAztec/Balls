import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/app";
import {
  allProvidersEnv,
  jsonOf,
  jsonRequest,
  jsonResponse,
  makeHarness,
  makeRequest,
  NOW,
  seedStripe,
  SITE_ORIGIN,
  stubFetch,
} from "./helpers";

const DAY = 86400;

afterEach(() => vi.unstubAllGlobals());

/** Mock Stripe's portal endpoint; the returned object records which customer and return URL it got. */
function mockPortal() {
  const seen = { customer: "", returnUrl: "", calls: 0 };
  stubFetch((url, init) => {
    if (url.includes("/v1/billing_portal/sessions")) {
      const form = new URLSearchParams(init!.body as string);
      seen.customer = form.get("customer") ?? "";
      seen.returnUrl = form.get("return_url") ?? "";
      seen.calls++;
      return jsonResponse({ url: "https://billing.stripe.com/p/session/1" });
    }
    throw new Error(`unexpected ${url}`);
  });
  return seen;
}

describe("stripe billing portal", () => {
  it("returns a portal URL for the customer of the subscription the reference names", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { session: "cs_1", customer: "cus_1", periodEnd: NOW + 30 * DAY });
    await seedStripe(repo, { sub: "sub_2", session: "cs_2", customer: "cus_2", periodEnd: NOW + 60 * DAY });
    const seen = mockPortal();
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "buyer@example.com", ref: "cs_1" }), env, { now: NOW });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).url).toBe("https://billing.stripe.com/p/session/1");
    expect(seen).toMatchObject({ customer: "cus_1", returnUrl: SITE_ORIGIN });
    await handleRequest(jsonRequest("/portal/stripe", { email: "Buyer@Example.com", ref: "sub_2" }), env, { now: NOW });
    expect(seen.customer).toBe("cus_2");
  });

  it("comes back to the page the site names (its pricing page under the base path)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { session: "cs_2", customer: "cus_2", plan: "yearly", periodEnd: NOW + 300 * DAY });
    const seen = mockPortal();
    const pricing = `${SITE_ORIGIN}/Balls/pl/pricing/`;
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "buyer@example.com", ref: "cs_2", returnUrl: pricing }), env, { now: NOW });
    expect(res.status).toBe(200);
    expect(seen.returnUrl).toBe(pricing);
  });

  it("refuses a returnUrl that is not on the site, before asking Stripe", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { session: "cs_3", customer: "cus_3", periodEnd: NOW + 30 * DAY });
    const seen = mockPortal();
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "buyer@example.com", ref: "cs_3", returnUrl: "https://evil.example.com/" }), env, { now: NOW });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_return_url");
    expect(seen.calls).toBe(0);
  });

  it("needs the reference too: an e-mail alone, a wrong reference or someone else's opens nothing (Origin or not)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { email: "victim@example.com", session: "cs_v", customer: "cus_v", periodEnd: NOW + 10 * DAY });
    await seedStripe(repo, { email: "attacker@example.com", sub: "sub_a", session: "cs_a", customer: "cus_a", periodEnd: NOW + 10 * DAY });
    const seen = mockPortal();
    const bodies = [
      { email: "victim@example.com" },
      { email: "victim@example.com", ref: "" },
      { email: "victim@example.com", ref: "cs_wrong" },
      { email: "victim@example.com", ref: "cs_a" },
    ];
    for (const body of bodies) {
      for (const req of [
        jsonRequest("/portal/stripe", body),
        makeRequest("POST", "/portal/stripe", { body: JSON.stringify(body), headers: { "content-type": "application/json" } }), // a server-side call, no Origin
      ]) {
        const res = await handleRequest(req, env, { now: NOW });
        expect(res.status, JSON.stringify(body)).toBe(404);
        expect((await jsonOf(res)).error).toBe("unknown_reference");
      }
    }
    expect(seen.calls).toBe(0);
  });

  it("is unknown_reference when the e-mail has no card customer", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const seen = mockPortal();
    const res = await handleRequest(jsonRequest("/portal/stripe", { email: "nobody@example.com", ref: "cs_1" }), env, { now: NOW });
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
    expect(seen.calls).toBe(0);
  });
});
