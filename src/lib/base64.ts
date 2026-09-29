/**
 * --- project-files --- Base64 helpers shared by the project files (lib/project.ts: media stored as base64) and the
 * short share codes (lib/shareCode.ts: base64url). Plain `btoa` / `atob` over binary strings, built in chunks so a
 * 25 MB song does not overflow the argument limit of `String.fromCharCode` – they work the same in the browser and
 * in Node (the unit tests).
 */

/** Bytes per `String.fromCharCode` call (well below every engine's argument limit). */
const CHUNK = 0x8000;

/** Standard base64 (with padding) of a byte array. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

/** Standard base64 characters (A–Z a–z 0–9 + /) with at most two "=" of padding and no whitespace; `atob` checks the length. */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** The bytes of a standard base64 string, or null when it is not valid base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (!BASE64_RE.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** URL-safe base64 without padding (RFC 4648 §5): "-" and "_" instead of "+" and "/", nothing to escape in a link. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of a base64url string (padding optional), or null when it is not valid base64url. */
export function base64UrlToBytes(text: string): Uint8Array | null {
  const bare = text.replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(bare) || bare.length % 4 === 1) return null;
  return base64ToBytes(bare.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((bare.length + 3) % 4));
}
