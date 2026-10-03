/**
 * --- paywall-gate --- Generates a production licensing key pair (ES256: ECDSA on P-256 with SHA-256) and prints, on stdout:
 *
 *   line 1  {"privateJwk":{…}}   the billing Worker's secret – `wrangler secret put LICENSE_PRIVATE_JWK` (paste the line)
 *   line 2  MFkwEwYHKoZIzj0…     the public key, base64url of its SPKI DER – the site's NEXT_PUBLIC_LICENSE_PUBLIC_KEY
 *                                (the repository variable LICENSE_PUBLIC_KEY, which deploy.yml hands to the build)
 *
 * (billing/scripts/keygen.mjs prints the same two lines.) Keep the private line secret: whoever has it can sign licences.
 * Never commit it; the committed tests/fixtures/license-test-key.json is a public TEST pair for development only.
 *
 *   node scripts/billing-keygen.mjs
 */
import crypto from "crypto";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateJwk = privateKey.export({ format: "jwk" });
const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
console.log(JSON.stringify({ privateJwk }));
console.log(spki);
console.error("\nLine 1 → the billing Worker's secret LICENSE_PRIVATE_JWK (keep it secret, never commit it).\nLine 2 → the repository variable LICENSE_PUBLIC_KEY (the site's NEXT_PUBLIC_LICENSE_PUBLIC_KEY).");
