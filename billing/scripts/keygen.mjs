#!/usr/bin/env node
// Generate a fresh ES256 (P-256) licensing key pair.
//
//   node scripts/keygen.mjs
//
// Prints two machine-readable lines to stdout:
//   1. a JSON object { "privateJwk": { ... } }  -> the billing Worker secret LICENSE_PRIVATE_JWK
//   2. the public key's SPKI DER, base64url     -> the site variable NEXT_PUBLIC_LICENSE_PUBLIC_KEY
//
// Keep the private JWK secret. The public key is safe to ship in the site bundle. (The site agent's
// scripts/billing-keygen.mjs prints the same two lines, so either generator works.)

import { webcrypto as crypto } from "node:crypto";

function bytesToBase64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const privateJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d };
const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
const publicSpkiBase64url = bytesToBase64url(new Uint8Array(spki));

console.error("Generated an ES256 (P-256) licensing key pair.\n");
console.error("1) Worker secret  ->  wrangler secret put LICENSE_PRIVATE_JWK  (paste the JSON below)");
console.error("2) Site variable  ->  NEXT_PUBLIC_LICENSE_PUBLIC_KEY           (the base64url below)\n");

console.log(JSON.stringify({ privateJwk }));
console.log(publicSpkiBase64url);
