// Signed licences.
//
// A licence is a JWT signed with ES256 (ECDSA P-256 + SHA-256), using the JWS raw r||s 64-byte
// signature exactly as WebCrypto produces it:
//
//   base64url(header) "." base64url(payload) "." base64url(signature)
//   header  = {"alg":"ES256","typ":"JWT"}
//   payload = { sub, plan, provider, iat, exp, jti }
//
// The Worker signs with the private key in the secret LICENSE_PRIVATE_JWK; the site verifies with
// the public half's SPKI DER (base64url) in NEXT_PUBLIC_LICENSE_PUBLIC_KEY. The two must come from
// one key pair (billing/scripts/keygen.mjs prints both halves).

import {
  base64urlToBytes,
  bytesToBase64url,
  randomId,
  stringToBase64url,
  utf8,
} from "./crypto";
import { DAY, GRACE_DAYS, normalizeEmail } from "./entitlements";
import type { Plan, Provider } from "./entitlements";

/** Days of grace added to the paid period's end before the licence expires (entitlements.ts owns it). */
export { GRACE_DAYS };
/** A licence never claims validity more than this many days ahead, whatever the paid period. */
export const MAX_LICENSE_DAYS = 400;

export interface LicensePayload {
  sub: string;
  plan: Plan;
  provider: Provider;
  iat: number;
  exp: number;
  jti: string;
}

/**
 * The expiry a licence gets for a paid period that ends at `periodEnd` (unix seconds): the period's
 * end plus the grace window, but never further than MAX_LICENSE_DAYS ahead of `now`.
 */
export function licenseExpiry(periodEnd: number, now: number): number {
  const withGrace = periodEnd + GRACE_DAYS * DAY;
  const cap = now + MAX_LICENSE_DAYS * DAY;
  return Math.min(withGrace, cap);
}

const JWT_HEADER = JSON.stringify({ alg: "ES256", typ: "JWT" });

async function importSigningKey(privateJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export interface SignLicenseInput {
  sub: string;
  plan: Plan;
  provider: Provider;
  periodEnd: number;
  now?: number;
}

/** Sign a licence token for the given subject, plan, provider and paid period. */
export async function signLicense(
  privateJwk: JsonWebKey,
  input: SignLicenseInput,
): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload: LicensePayload = {
    sub: normalizeEmail(input.sub),
    plan: input.plan,
    provider: input.provider,
    iat: now,
    exp: licenseExpiry(input.periodEnd, now),
    jti: randomId(),
  };
  const signingInput =
    stringToBase64url(JWT_HEADER) + "." + stringToBase64url(JSON.stringify(payload));
  const key = await importSigningKey(privateJwk);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput),
  );
  return signingInput + "." + bytesToBase64url(new Uint8Array(signature));
}

/**
 * Verify a token against a public key given as SPKI DER (base64url) — the exact path the site uses.
 * Returns the decoded payload when the signature is valid, otherwise null. (The Worker itself never
 * verifies licences; this is here so the test suite can prove the round trip, and so scripts can.)
 */
export async function verifyLicense(
  publicSpkiBase64url: string,
  token: string,
): Promise<LicensePayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      base64urlToBytes(publicSpkiBase64url),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64urlToBytes(signature),
    utf8(header + "." + payload),
  );
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBytes(payload))) as LicensePayload;
  } catch {
    return null;
  }
}

/**
 * The test licensing key pair (tests/fixtures/license-test-key.json) is public. The Worker runs in
 * "test mode" when LICENSE_PRIVATE_JWK is that key — compared by its private scalar `d`, which is
 * what makes a key secret — so /config can warn and nobody mistakes a demo deployment for a real
 * one. This value is the public fixture's `d`; it is deliberately not a secret.
 */
export const TEST_PRIVATE_D = "Gh0shGrJs8GvRL--b-ABeiqq1Z-MYbJ3Vi02ahCLQGo";

/**
 * Parse LICENSE_PRIVATE_JWK (a JSON string) into a JWK, or null when unset/invalid. Takes the bare
 * private JWK or line 1 of a keygen exactly as printed, `{"privateJwk":{…}}` – billing/scripts/keygen.mjs
 * and the site's scripts/billing-keygen.mjs both print that line, and the setup says to paste it whole.
 */
export function parsePrivateJwk(raw: string | undefined): JsonWebKey | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as (JsonWebKey & { privateJwk?: unknown }) | null;
    const jwk = (parsed && parsed.privateJwk && typeof parsed.privateJwk === "object" ? parsed.privateJwk : parsed) as JsonWebKey | null;
    if (jwk && jwk.kty === "EC" && typeof jwk.d === "string") return jwk;
    return null;
  } catch {
    return null;
  }
}

/** Whether the configured private key is the public test key pair. */
export function isTestKey(raw: string | undefined): boolean {
  const jwk = parsePrivateJwk(raw);
  return jwk?.d === TEST_PRIVATE_D;
}
