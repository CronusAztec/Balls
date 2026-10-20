import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { verifyLicense } from "@/lib/billing/license";
import { MAX_DAYS, ownerPayload, parsePrivateJwk, publicKeyOf } from "../scripts/owner-license.mjs";
import { signLicense } from "../scripts/lib/test-license.mjs";

/*
 * --- paywall-gate --- The owner's licence (scripts/owner-license.mjs): signed with a production-style key pair – a fresh one
 * here – it verifies against that key's public half on the site's own path, and a build with another key refuses it.
 */

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const pair = () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ format: "jwk" });
};

describe("the owner's licence", () => {
  it("reads line 1 of the keygen and the bare JWK, nothing else", () => {
    const jwk = pair();
    expect(parsePrivateJwk(JSON.stringify({ privateJwk: jwk }))).toEqual(jwk);
    expect(parsePrivateJwk(JSON.stringify(jwk))).toEqual(jwk);
    expect(parsePrivateJwk(JSON.stringify({ ...jwk, d: undefined }))).toBeNull();
    expect(parsePrivateJwk("not json")).toBeNull();
  });

  it("verifies on the site with the key's public half, as Pro for the e-mail, for at most 400 days", async () => {
    const jwk = pair();
    const token = signLicense(ownerPayload({ email: " Owner@Example.com ", plan: "monthly", now: NOW }), jwk);
    const check = await verifyLicense(token, { publicKey: publicKeyOf(jwk), now: NOW });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.payload).toMatchObject({ sub: "owner@example.com", plan: "monthly", provider: null });
    expect(check.payload.exp - check.payload.iat).toBe(MAX_DAYS * 86400);
    expect((await verifyLicense(token, { publicKey: publicKeyOf(jwk), now: NOW + (MAX_DAYS + 1) * 86400_000 })).ok).toBe(false);
  });

  it("is refused by a build that verifies with another key", async () => {
    const token = signLicense(ownerPayload({ email: "owner@example.com", now: NOW }), pair());
    expect(await verifyLicense(token, { publicKey: publicKeyOf(pair()), now: NOW })).toMatchObject({ ok: false, error: "signature" });
  });
});
