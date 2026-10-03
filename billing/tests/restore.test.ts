import { describe, expect, it } from "vitest";
import testKey from "../../tests/fixtures/license-test-key.json";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { verifyLicense } from "../src/license";
import { allProvidersEnv, jsonRequest, makeHarness, NOW, seedCrypto, seedStripe, TEST_PUBLIC_SPKI } from "./helpers";

const DAY = 86400;

async function seedBuyer(repo: ReturnType<typeof makeHarness>["repo"], periodEnd: number) {
  await seedStripe(repo, { session: "cs_known", plan: "yearly", periodEnd });
}

function restore(env: ReturnType<typeof makeHarness>["env"], email: string, ref: string) {
  return handleRequest(jsonRequest("/license/restore", { email, ref }), env, { now: NOW });
}

describe("restore", () => {
  it("issues a token when the e-mail owns the reference (the session or the subscription id)", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedBuyer(repo, NOW + 300 * DAY);
    for (const ref of ["cs_known", "sub_1"]) {
      const res = await restore(env, "  Buyer@Example.com ", ref);
      expect(res.status, ref).toBe(200);
      const payload = await verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string);
      expect(payload!.sub).toBe("buyer@example.com");
      expect(payload!.exp).toBe(NOW + 303 * DAY);
    }
  });

  it("signs with LICENSE_PRIVATE_JWK set to a keygen's line 1 as printed ({\"privateJwk\":{…}})", async () => {
    const { env, repo } = makeHarness(allProvidersEnv({ LICENSE_PRIVATE_JWK: JSON.stringify({ privateJwk: testKey.privateJwk }) }));
    await seedBuyer(repo, NOW + 300 * DAY);
    const res = await restore(env, "buyer@example.com", "cs_known");
    expect(res.status).toBe(200);
    const payload = await verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string);
    expect(payload!.plan).toBe("yearly");
  });

  it("restores the e-mail's whole entitlement with any of its references", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedBuyer(repo, NOW + 10 * DAY);
    await seedCrypto(repo, { order: "order-9", payment: "p9", plan: "yearly", at: NOW });
    const res = await restore(env, "buyer@example.com", "cs_known");
    const payload = await verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string);
    expect(payload).toMatchObject({ provider: "crypto", plan: "yearly", exp: NOW + 368 * DAY });
  });

  it("refuses a reference that does not belong to the e-mail", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedBuyer(repo, NOW + 300 * DAY);
    await seedStripe(repo, { email: "someone@else.com", sub: "sub_x", session: "cs_someone_else", periodEnd: NOW + 30 * DAY });
    const res = await restore(env, "buyer@example.com", "cs_someone_else");
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });

  it("refuses an unknown e-mail", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await restore(env, "nobody@example.com", "cs_known");
    expect(res.status).toBe(404);
  });

  it("refuses when the subscription has lapsed: nothing paid, or past the grace days", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedStripe(repo, { session: "cs_known" }); // linked, never paid
    const res = await restore(env, "buyer@example.com", "cs_known");
    expect(res.status).toBe(402);
    expect((await jsonOf(res)).error).toBe("not_active");
    await seedStripe(repo, { session: "cs_known", periodEnd: NOW - 4 * DAY });
    expect((await restore(env, "buyer@example.com", "cs_known")).status).toBe(402);
  });

  it("still restores in the grace days after the paid period", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedBuyer(repo, NOW - DAY);
    const res = await restore(env, "buyer@example.com", "cs_known");
    expect(res.status).toBe(200);
    expect((await verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string))!.exp).toBe(NOW + 2 * DAY);
  });
});
