#!/usr/bin/env node
/**
 * --- paywall-gate --- The owner's own Pro licence, signed with the PRODUCTION private key (the billing Worker's secret
 * LICENSE_PRIVATE_JWK), so the live site accepts it like one the Worker issued after a payment. Run it on your own machine:
 * the key is read from a file or the environment, used in memory and never written anywhere.
 *
 *   node scripts/owner-license.mjs --email you@example.com --key path/to/private.json [--plan monthly|yearly] [--days N]
 *                                  [--public-key MFkw…]
 *   LICENSE_PRIVATE_JWK='{"privateJwk":{…}}' node scripts/owner-license.mjs --email you@example.com
 *
 * The key file (or variable) holds line 1 of `node scripts/billing-keygen.mjs` as printed, or the bare private JWK inside it.
 * The licence is good for --days days (default and maximum 400, the Worker's MAX_LICENSE_DAYS) and names no payment
 * provider, so the pricing page shows no "manage subscription" button and says when it ends; run the script again to renew.
 * The public half of the key is printed on stderr: it must equal the site's LICENSE_PUBLIC_KEY, and --public-key (or
 * NEXT_PUBLIC_LICENSE_PUBLIC_KEY in the environment) makes the script check that and stop when they differ.
 *
 * The licence goes to stdout: paste it into the site's localStorage under "jbl.license", or set it as BOT_LICENSE.
 * Whoever holds the licence is Pro until it expires, so treat it like a password.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LICENSE_STORAGE_KEY, loadTestKey, signLicense } from "./lib/test-license.mjs";

/** The Worker never signs further ahead than this (billing/src/license.ts MAX_LICENSE_DAYS). */
export const MAX_DAYS = 400;

/** The private JWK in `raw`: line 1 of a keygen (`{"privateJwk":{…}}`) or the bare JWK – like the Worker's parsePrivateJwk. */
export function parsePrivateJwk(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw).trim());
  } catch {
    return null;
  }
  const jwk = parsed && typeof parsed.privateJwk === "object" && parsed.privateJwk ? parsed.privateJwk : parsed;
  return jwk && jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.d === "string" ? jwk : null;
}

/** The public half of a private JWK as the site spells it: base64url of the SPKI DER. */
export function publicKeyOf(jwk) {
  return crypto.createPublicKey({ key: jwk, format: "jwk" }).export({ format: "der", type: "spki" }).toString("base64url");
}

/** The owner's licence payload: Pro on `plan` for `email`, `days` days from `now` (ms), with no payment provider. */
export function ownerPayload({ email, plan = "yearly", days = MAX_DAYS, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  return { sub: String(email).trim().toLowerCase(), plan, iat, exp: iat + Math.round(days * 86400), jti: crypto.randomUUID() };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const email = value("--email");
  if (!email || !email.includes("@")) fail("Give the licence's e-mail: --email you@example.com");
  const plan = value("--plan") ?? "yearly";
  if (plan !== "monthly" && plan !== "yearly") fail('--plan is "monthly" or "yearly"');
  const days = Number(value("--days") ?? MAX_DAYS);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) fail(`--days is a number from 1 to ${MAX_DAYS}`);

  const keyFile = value("--key");
  const raw = keyFile ? fs.readFileSync(keyFile, "utf8") : process.env.LICENSE_PRIVATE_JWK;
  if (!raw) fail("Give the production private key: --key <file> or the LICENSE_PRIVATE_JWK environment variable.");
  const jwk = parsePrivateJwk(raw);
  if (!jwk) fail('The key is not a P-256 private JWK (line 1 of `node scripts/billing-keygen.mjs`, {"privateJwk":{…}}, or the JWK itself).');
  if (jwk.d === loadTestKey().privateJwk.d) fail("That is the public TEST key: a production build refuses its licences. Use node scripts/lib/test-license.mjs for test-mode builds.");

  const publicKey = publicKeyOf(jwk);
  const expected = value("--public-key") ?? process.env.NEXT_PUBLIC_LICENSE_PUBLIC_KEY;
  if (expected && expected.trim() !== publicKey) fail(`This key's public half is\n  ${publicKey}\nbut the site verifies with\n  ${expected.trim()}\nso the site would refuse the licence.`);

  const payload = ownerPayload({ email, plan, days });
  console.log(signLicense(payload, jwk));
  console.error(
    `\nPro (${plan}) for ${payload.sub} until ${new Date(payload.exp * 1000).toISOString().slice(0, 10)}.` +
      `\nSigned by the key whose public half is ${publicKey}${expected ? " (matches the site's)" : " – it must equal the site's LICENSE_PUBLIC_KEY"}.` +
      `\nPaste it into localStorage "${LICENSE_STORAGE_KEY}" on the site, or set it as BOT_LICENSE.`,
  );
}
