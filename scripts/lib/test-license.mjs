/**
 * --- paywall-gate --- Licences for the tools that record against a test-mode build (a build without
 * NEXT_PUBLIC_LICENSE_PUBLIC_KEY verifies licences with the committed TEST key pair, tests/fixtures/license-test-key.json):
 * the smoke test installs one in every browser context it records in, the viral bot signs one when no BOT_LICENSE is set.
 * Node signs with `crypto.sign("sha256", data, { key, dsaEncoding: "ieee-p1363" })`, which gives the raw 64-byte r||s
 * signature JWS ES256 uses (the form WebCrypto verifies) – see src/lib/billing/license.ts for the contract.
 *
 *   node scripts/lib/test-license.mjs [--plan monthly|yearly] [--provider stripe|paypal|crypto] [--days N] [--email E] [--expired]
 *
 * prints such a licence; paste it into the browser's localStorage under "jbl.license" to be Pro on a test-mode build.
 * The TEST key is public: these licences mean nothing to a production build, which verifies with its own public key.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** localStorage key of the licence (src/lib/billing/config.ts LICENSE_STORAGE_KEY). */
export const LICENSE_STORAGE_KEY = "jbl.license";
export const TEST_KEY_FILE = path.join(ROOT, "tests", "fixtures", "license-test-key.json");

let testKey = null;
/** The committed TEST key pair ({ privateJwk, publicJwk, publicSpkiBase64url, note }). */
export function loadTestKey() {
  if (!testKey) testKey = JSON.parse(fs.readFileSync(TEST_KEY_FILE, "utf8"));
  return testKey;
}

const b64url = (data) => Buffer.from(data).toString("base64url");

/** Signs a licence payload (a JWT, ES256, raw r||s) with `privateKey`: a KeyObject or a private JWK. */
export function signLicense(payload, privateKey) {
  const key = privateKey instanceof crypto.KeyObject ? privateKey : crypto.createPrivateKey({ key: privateKey, format: "jwk" });
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(signature)}`;
}

/** A licence payload: Pro yearly through Stripe for smoke@example.com, good for `days` days from `now` (ms) – or as told. */
export function licensePayload({ sub = "smoke@example.com", plan = "yearly", provider = "stripe", now = Date.now(), days = 400, iat, exp, jti } = {}) {
  const issued = iat ?? Math.floor(now / 1000);
  return { sub: String(sub).trim().toLowerCase(), plan, provider, iat: issued, exp: exp ?? issued + Math.round(days * 86400), jti: jti ?? crypto.randomUUID() };
}

/** A licence signed with the committed TEST key (what a test-mode build accepts). */
export function signTestLicense(options = {}) {
  return signLicense(licensePayload(options), loadTestKey().privateJwk);
}

/** A licence signed with a fresh random P-256 key: well formed, but no build verifies it. */
export function signForeignLicense(options = {}) {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return signLicense(licensePayload(options), privateKey);
}

/**
 * The init script that puts a licence into localStorage before any page script runs – for Playwright's
 * `context.addInitScript(installLicenseScript, { key: LICENSE_STORAGE_KEY, token })`.
 */
export function installLicenseScript({ key, token }) {
  try {
    localStorage.setItem(key, token);
  } catch {
    /* an opaque origin (about:blank) has no storage */
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
  };
  const expired = args.includes("--expired");
  const options = { plan: value("--plan", "yearly"), provider: value("--provider", "stripe"), sub: value("--email", "smoke@example.com"), days: Number(value("--days", "400")) };
  if (expired) options.days = -5;
  console.log(signTestLicense(options));
}
