import { describe, expect, it } from "vitest";
import testKey from "../../tests/fixtures/license-test-key.json";
import {
  GRACE_DAYS,
  isTestKey,
  licenseExpiry,
  MAX_LICENSE_DAYS,
  parsePrivateJwk,
  signLicense,
  verifyLicense,
} from "../src/license";

const DAY = 86400;
const NOW = 1767225600; // 2026-01-01T00:00:00Z

describe("licence token round trip", () => {
  it("signs a token the fixture's public key verifies, with the agreed claims", async () => {
    const periodEnd = NOW + 30 * DAY;
    const token = await signLicense(testKey.privateJwk, {
      sub: "  Buyer@Example.COM ",
      plan: "monthly",
      provider: "stripe",
      periodEnd,
      now: NOW,
    });

    expect(token.split(".")).toHaveLength(3);

    const payload = await verifyLicense(testKey.publicSpkiBase64url, token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("buyer@example.com"); // lower-cased and trimmed
    expect(payload!.plan).toBe("monthly");
    expect(payload!.provider).toBe("stripe");
    expect(payload!.iat).toBe(NOW);
    expect(payload!.exp).toBe(periodEnd + GRACE_DAYS * DAY); // grace added
    expect(typeof payload!.jti).toBe("string");
    expect(payload!.jti.length).toBeGreaterThan(0);
  });

  it("verifies the ES256 header is correct", async () => {
    const token = await signLicense(testKey.privateJwk, {
      sub: "a@b.com",
      plan: "yearly",
      provider: "crypto",
      periodEnd: NOW + 365 * DAY,
      now: NOW,
    });
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(header).toEqual({ alg: "ES256", typ: "JWT" });
  });

  it("caps the expiry at 400 days ahead", () => {
    const farPeriodEnd = NOW + 1000 * DAY;
    expect(licenseExpiry(farPeriodEnd, NOW)).toBe(NOW + MAX_LICENSE_DAYS * DAY);
  });

  it("adds exactly the grace window under the cap", () => {
    const periodEnd = NOW + 20 * DAY;
    expect(licenseExpiry(periodEnd, NOW)).toBe(periodEnd + GRACE_DAYS * DAY);
  });

  it("rejects a tampered token", async () => {
    const token = await signLicense(testKey.privateJwk, {
      sub: "a@b.com",
      plan: "monthly",
      provider: "stripe",
      periodEnd: NOW + 30 * DAY,
      now: NOW,
    });
    const [h, p, s] = token.split(".");
    const forged = JSON.parse(Buffer.from(p, "base64url").toString());
    forged.plan = "yearly";
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${s}`;
    expect(await verifyLicense(testKey.publicSpkiBase64url, tampered)).toBeNull();
  });

  it("recognises the public test key by its private scalar", () => {
    expect(isTestKey(JSON.stringify(testKey.privateJwk))).toBe(true);
    expect(isTestKey(undefined)).toBe(false);
    expect(isTestKey("not json")).toBe(false);
    const other = { ...testKey.privateJwk, d: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
    expect(isTestKey(JSON.stringify(other))).toBe(false);
  });

  it("parses a private JWK and rejects a public-only one", () => {
    expect(parsePrivateJwk(JSON.stringify(testKey.privateJwk))).not.toBeNull();
    expect(parsePrivateJwk(JSON.stringify(testKey.publicJwk))).toBeNull();
    expect(parsePrivateJwk(undefined)).toBeNull();
  });

  it("takes line 1 of a keygen as printed, {\"privateJwk\":{…}}, and signs with it", async () => {
    // billing/scripts/keygen.mjs and the site's scripts/billing-keygen.mjs print this line for the secret
    const keygenLine = JSON.stringify({ privateJwk: testKey.privateJwk });
    const jwk = parsePrivateJwk(keygenLine);
    expect(jwk).toEqual(testKey.privateJwk);
    expect(isTestKey(keygenLine)).toBe(true);
    expect(parsePrivateJwk(JSON.stringify({ privateJwk: testKey.publicJwk }))).toBeNull();
    expect(parsePrivateJwk(JSON.stringify({ privateJwk: null }))).toBeNull();
    expect(parsePrivateJwk("null")).toBeNull();
    const token = await signLicense(jwk!, { sub: "buyer@example.com", plan: "monthly", provider: "crypto", periodEnd: NOW + 30 * DAY, now: NOW });
    expect((await verifyLicense(testKey.publicSpkiBase64url, token))?.sub).toBe("buyer@example.com");
  });
});
