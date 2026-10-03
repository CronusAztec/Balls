// Low-level crypto and encoding helpers used across the Worker.
//
// Everything here runs on the WebCrypto API that Cloudflare Workers expose as the global `crypto`
// (and that Node 20+ exposes as `globalThis.crypto`, so the vitest suite uses the very same code).
// There are no dependencies.

const encoder = new TextEncoder();

/** UTF-8 encode a string. */
export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

/** base64url-encode raw bytes (no padding), the form JWS and SPKI keys use. */
export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url (or plain base64) string back to bytes. */
export function base64urlToBytes(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** base64url-encode a UTF-8 string. */
export function stringToBase64url(s: string): string {
  return bytesToBase64url(utf8(s));
}

/** Lower-case hex of raw bytes. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** HMAC sign `data` with `secret`, returning the raw MAC bytes. */
export async function hmac(
  hash: "SHA-256" | "SHA-512",
  secret: string,
  data: string | Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const bytes = typeof data === "string" ? utf8(data) : data;
  const sig = await crypto.subtle.sign("HMAC", key, bytes);
  return new Uint8Array(sig);
}

/** HMAC-SHA256 of `data` with `secret` as lower-case hex (the Stripe scheme). */
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  return bytesToHex(await hmac("SHA-256", secret, data));
}

/** HMAC-SHA512 of `data` with `secret` as lower-case hex (the NOWPayments scheme). */
export async function hmacSha512Hex(secret: string, data: string): Promise<string> {
  return bytesToHex(await hmac("SHA-512", secret, data));
}

/**
 * Constant-time string compare. Returns true only when both strings are byte-for-byte equal;
 * the running time does not depend on where they first differ (it does reveal unequal lengths,
 * which for fixed-length hex digests and e-mail addresses is not a secret).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A fresh random identifier for order ids and the licence's jti. */
export function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Re-serialise a JSON value with every object's keys sorted, recursively (arrays keep their order,
 * their object elements are sorted). This is the canonical form NOWPayments signs its IPN callbacks
 * over, so the Worker rebuilds it to check `x-nowpayments-sig`.
 */
export function sortedJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) out[key] = sortKeys(input[key]);
    return out;
  }
  return value;
}
