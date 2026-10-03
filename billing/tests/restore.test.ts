import { describe, expect, it } from "vitest";
import testKey from "../../tests/fixtures/license-test-key.json";
import { jsonOf } from "./helpers";
import { handleRequest } from "../src/app";
import { verifyLicense } from "../src/license";
import { allProvidersEnv, jsonRequest, makeHarness, NOW, TEST_PUBLIC_SPKI } from "./helpers";

const DAY = 86400;

async function seedBuyer(repo: ReturnType<typeof makeHarness>["repo"], periodEnd: number) {
  await repo.putUser({
    email: "buyer@example.com",
    plan: "yearly",
    provider: "stripe",
    periodEnd,
    status: "active",
    refs: ["cs_known"],
    updatedAt: NOW,
  });
}

function restore(env: ReturnType<typeof makeHarness>["env"], email: string, ref: string) {
  return handleRequest(jsonRequest("/license/restore", { email, ref }), env, { now: NOW });
}

describe("restore", () => {
  it("issues a token when the e-mail owns the reference", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedBuyer(repo, NOW + 300 * DAY);
    const res = await restore(env, "  Buyer@Example.com ", "cs_known");
    expect(res.status).toBe(200);
    const token = (await jsonOf(res)).token as string;
    const payload = await verifyLicense(TEST_PUBLIC_SPKI, token);
    expect(payload!.sub).toBe("buyer@example.com");
  });

  it("signs with LICENSE_PRIVATE_JWK set to a keygen's line 1 as printed ({\"privateJwk\":{…}})", async () => {
    const { env, repo } = makeHarness(allProvidersEnv({ LICENSE_PRIVATE_JWK: JSON.stringify({ privateJwk: testKey.privateJwk }) }));
    await seedBuyer(repo, NOW + 300 * DAY);
    const res = await restore(env, "buyer@example.com", "cs_known");
    expect(res.status).toBe(200);
    const payload = await verifyLicense(TEST_PUBLIC_SPKI, (await jsonOf(res)).token as string);
    expect(payload!.plan).toBe("yearly");
  });

  it("refuses a reference that does not belong to the e-mail", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await seedBuyer(repo, NOW + 300 * DAY);
    const res = await restore(env, "buyer@example.com", "cs_someone_else");
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toBe("unknown_reference");
  });

  it("refuses an unknown e-mail", async () => {
    const { env } = makeHarness(allProvidersEnv());
    const res = await restore(env, "nobody@example.com", "cs_known");
    expect(res.status).toBe(404);
  });

  it("refuses when the subscription has lapsed", async () => {
    const { env, repo } = makeHarness(allProvidersEnv());
    await repo.putUser({
      email: "buyer@example.com",
      plan: "monthly",
      provider: "stripe",
      periodEnd: 0,
      status: "canceled",
      refs: ["cs_known"],
      updatedAt: NOW,
    });
    const res = await restore(env, "buyer@example.com", "cs_known");
    expect(res.status).toBe(402);
    expect((await jsonOf(res)).error).toBe("not_active");
  });
});
