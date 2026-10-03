import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { LICENSE_PUBLIC_KEY, LICENSE_STORAGE_KEY, LICENSE_TEST_MODE, LICENSE_TEST_PUBLIC_KEY } from "@/lib/billing/config";
import { base64UrlDecode, base64UrlEncode, decodeLicense, isLicenseHeader, licenseExpired, normaliseEmail, verifyLicense } from "@/lib/billing/license";
import { LICENSE_STORAGE_KEY as SCRIPT_STORAGE_KEY, licensePayload, loadTestKey, signForeignLicense, signLicense, signTestLicense } from "../scripts/lib/test-license.mjs";

/*
 * --- paywall-gate --- The licence contract (src/lib/billing/license.ts): ES256 JWTs verified with WebCrypto against the
 * build's public key – the committed TEST key here, as in every build without NEXT_PUBLIC_LICENSE_PUBLIC_KEY. Tokens are
 * signed in Node the way the smoke test and the bot sign them (scripts/lib/test-license.mjs, raw r||s signatures).
 */

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const nowSec = Math.floor(NOW / 1000);
const verify = (token: string, now = NOW) => verifyLicense(token, { publicKey: LICENSE_TEST_PUBLIC_KEY, now });
const b64json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** A token with any header and payload, signed with the TEST key (as a forger with the key would). */
const signed = (header: unknown, payload: unknown) => {
  const input = `${b64json(header)}.${b64json(payload)}`;
  const key = crypto.createPrivateKey({ key: loadTestKey().privateJwk, format: "jwk" });
  return `${input}.${crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};

describe("the licence contract (ES256 JWT)", () => {
  it("copies the committed TEST key and verifies with it in test mode", () => {
    expect(LICENSE_TEST_PUBLIC_KEY).toBe(loadTestKey().publicSpkiBase64url);
    expect(LICENSE_TEST_MODE).toBe(true);
    expect(LICENSE_PUBLIC_KEY).toBe(LICENSE_TEST_PUBLIC_KEY);
    expect(LICENSE_STORAGE_KEY).toBe("jbl.license");
    expect(SCRIPT_STORAGE_KEY).toBe(LICENSE_STORAGE_KEY);
  });

  it("accepts a good licence and reads its payload (the email trimmed and lower-cased)", async () => {
    const token = signTestLicense({ sub: "  Buyer@Example.COM ", plan: "monthly", provider: "paypal", now: NOW, days: 33, jti: "abc" });
    const r = await verify(token);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({ sub: "buyer@example.com", plan: "monthly", provider: "paypal", iat: nowSec, exp: nowSec + 33 * 86400, jti: "abc" });
    expect(normaliseEmail("  A@B.Co ")).toBe("a@b.co");
  });

  it("refuses an expired licence, with 60 s of clock skew allowed", async () => {
    const token = signTestLicense({ now: NOW, exp: nowSec - 30 });
    expect((await verify(token)).ok).toBe(true); // 30 s past exp: within the skew
    const late = await verify(token, NOW + 31_000);
    expect(late).toMatchObject({ ok: false, error: "expired" });
    expect(late.ok === false && late.payload?.sub).toBe("smoke@example.com");
    expect(licenseExpired({ exp: nowSec }, NOW + 60_000)).toBe(false);
    expect(licenseExpired({ exp: nowSec }, NOW + 60_001)).toBe(true);
  });

  it("refuses a licence signed with another key", async () => {
    expect(await verify(signForeignLicense({ now: NOW }))).toEqual({ ok: false, error: "signature" });
  });

  it("refuses a tampered payload (a monthly licence turned yearly, a later exp) and a tampered header", async () => {
    const token = signTestLicense({ plan: "monthly", now: NOW, days: 30 });
    const [head, body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    expect(await verify(`${head}.${b64json({ ...payload, plan: "yearly" })}.${sig}`)).toEqual({ ok: false, error: "signature" });
    expect(await verify(`${head}.${b64json({ ...payload, exp: payload.exp + 365 * 86400 })}.${sig}`)).toEqual({ ok: false, error: "signature" });
    expect(await verify(`${b64json({ typ: "JWT", alg: "ES256" })}.${body}.${sig}`)).toEqual({ ok: false, error: "signature" });
  });

  it("refuses a foreign algorithm or type, even when signed with the right key", async () => {
    const payload = licensePayload({ now: NOW });
    for (const header of [{ alg: "HS256", typ: "JWT" }, { alg: "none", typ: "JWT" }, { alg: "ES384", typ: "JWT" }, { alg: "ES256", typ: "JWS" }, { alg: "ES256" }, { alg: "ES256", typ: "JWT", crit: ["exp"] }]) {
      expect(await verify(signed(header, payload)), JSON.stringify(header)).toEqual({ ok: false, error: "header" });
    }
    expect(isLicenseHeader({ alg: "ES256", typ: "JWT" })).toBe(true);
    expect(isLicenseHeader({ alg: "ES256", typ: "JWT", kid: "2026" })).toBe(true);
    // an "alg: none" token without a signature is not even well formed
    expect(await verify(`${b64json({ alg: "none", typ: "JWT" })}.${b64json(payload)}.`)).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a payload without sub, plan or exp (or with a plan it does not know)", async () => {
    const full = licensePayload({ now: NOW });
    for (const drop of ["sub", "plan", "exp"] as const) {
      const rest: Record<string, unknown> = { ...full };
      delete rest[drop];
      expect(await verify(signed({ alg: "ES256", typ: "JWT" }, rest)), drop).toEqual({ ok: false, error: "payload" });
    }
    expect(await verify(signed({ alg: "ES256", typ: "JWT" }, { ...full, plan: "lifetime" }))).toEqual({ ok: false, error: "payload" });
    expect(await verify(signed({ alg: "ES256", typ: "JWT" }, { ...full, exp: "soon" }))).toEqual({ ok: false, error: "payload" });
    expect(await verify(signed({ alg: "ES256", typ: "JWT" }, { ...full, sub: "  " }))).toEqual({ ok: false, error: "payload" });
    // provider, iat and jti are read when they are there, never required
    const bare = await verify(signed({ alg: "ES256", typ: "JWT" }, { sub: "a@b.co", plan: "yearly", exp: nowSec + 100 }));
    expect(bare).toEqual({ ok: true, payload: { sub: "a@b.co", plan: "yearly", provider: null, iat: 0, exp: nowSec + 100, jti: "" } });
  });

  it("refuses malformed tokens without throwing", async () => {
    const good = signTestLicense({ now: NOW });
    const [head, body, sig] = good.split(".");
    for (const token of ["", "abc", "a.b", `${head}.${body}`, `${good}.x`, `${head}..${sig}`, `${head}.${body}.${sig}=`, `${head}.${body}.${sig.replace(/[A-Za-z]/, "+")}`, `${head}.bm90IGpzb24.${sig}`, `${head}.${b64json([1, 2])}.${sig}`, `${b64json("str")}.${body}.${sig}`]) {
      expect(await verify(token), token).toEqual({ ok: false, error: "malformed" });
    }
    expect(await verify(null as unknown as string)).toEqual({ ok: false, error: "malformed" });
    expect(decodeLicense("x.y.z")).toBeNull();
  });

  it("takes the raw 64-byte r||s signature only (a DER signature is refused)", async () => {
    const payload = licensePayload({ now: NOW });
    const input = `${b64json({ alg: "ES256", typ: "JWT" })}.${b64json(payload)}`;
    const key = crypto.createPrivateKey({ key: loadTestKey().privateJwk, format: "jwk" });
    const der = crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "der" }).toString("base64url");
    expect(await verify(`${input}.${der}`)).toEqual({ ok: false, error: "signature" });
    expect(decodeLicense(signLicense(payload, loadTestKey().privateJwk))?.signature.length).toBe(64);
  });

  it("says when the site's own key cannot be used, instead of blaming the licence", async () => {
    const token = signTestLicense({ now: NOW });
    expect(await verifyLicense(token, { publicKey: "not-a-key", now: NOW })).toEqual({ ok: false, error: "key" });
    expect(await verifyLicense(token, { publicKey: LICENSE_TEST_PUBLIC_KEY, now: NOW, subtle: null })).toEqual({ ok: false, error: "key" });
    const spki = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    expect(await verifyLicense(token, { publicKey: spki, now: NOW })).toEqual({ ok: false, error: "signature" });
  });

  it("encodes and decodes base64url strictly", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = base64UrlEncode(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64url"));
    expect(Array.from(base64UrlDecode(text) ?? [])).toEqual(Array.from(bytes));
    for (const bad of ["a+b", "a/b", "ab==", "a", "a b"]) expect(base64UrlDecode(bad), bad).toBeNull();
    expect(Array.from(base64UrlDecode("") ?? [9])).toEqual([]);
  });
});

describe("the viral bot's licence (scripts/viral-bot.mjs)", () => {
  it("renders with BOT_LICENSE, or signs a short test licence a test-mode build accepts", async () => {
    const { botLicense, licenceRefusal } = await import("../scripts/viral-bot.mjs");
    expect(botLicense({ BOT_LICENSE: "  a.b.c \n" })).toEqual({ token: "a.b.c", source: "BOT_LICENSE" });
    const test = botLicense({}, NOW);
    expect(test.source).toBe("test");
    const r = await verify(test.token);
    expect(r.ok && r.payload).toMatchObject({ plan: "yearly", sub: "viral-bot@localhost", exp: nowSec + 2 * 86400 });
    expect(licenceRefusal("BOT_LICENSE", false)).toMatch(/refused BOT_LICENSE/);
    expect(licenceRefusal("test", false)).toMatch(/set BOT_LICENSE/);
    expect(licenceRefusal("test", true)).toMatch(/test licence/);
  });
});
