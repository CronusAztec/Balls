import { CLOCK_SKEW_SEC, isPlan, isProvider, type Plan, type Provider } from "./config";

/*
 * --- paywall-gate --- The licence contract (shared with the billing backend, billing/): a licence is a JWT (RFC 7519)
 * signed with ES256 – ECDSA on P-256 with SHA-256, the JWS signature being the raw 64-byte r||s pair exactly as WebCrypto's
 * ECDSA sign() produces it and verify() takes it:
 *
 *   base64url(header) "." base64url(payload) "." base64url(signature)
 *   header  { "alg": "ES256", "typ": "JWT" }
 *   payload { "sub": email (lower-cased, trimmed), "plan": "monthly" | "yearly", "provider": "stripe" | "paypal" | "crypto",
 *             "iat": unix s, "exp": unix s (the paid period's end + 3 days of grace), "jti": random id }
 *
 * Verification is pure WebCrypto (no JWT library): import the SPKI public key, verify the signature over the ASCII bytes of
 * `header "." payload`, then refuse a header that is not alg ES256 / typ JWT (or that names critical extensions), a payload
 * without sub, plan or exp, and a licence whose exp is past (60 s of clock skew allowed). What a licence proves: the
 * backend that holds the private key issued it, for this email and plan, until exp – nobody else can make one.
 */

export interface LicensePayload {
  sub: string;
  plan: Plan;
  /** Who took the payment (null when an older licence does not say). */
  provider: Provider | null;
  /** Issued at (unix s), 0 when missing. */
  iat: number;
  /** Expires at (unix s): the paid period's end plus the grace days. */
  exp: number;
  /** The licence's random id ("" when missing). */
  jti: string;
}

/**
 * Why a licence was refused: not three base64url parts of JSON ("malformed"), a foreign header ("header"), a payload
 * without sub / plan / exp ("payload"), a signature that does not verify ("signature"), past its exp ("expired"), or the
 * site's own public key cannot be used ("key" – the build's configuration, not the licence, is at fault).
 */
export type LicenseError = "malformed" | "header" | "payload" | "signature" | "expired" | "key";

export type LicenseCheck = { ok: true; payload: LicensePayload } | { ok: false; error: LicenseError; payload?: LicensePayload };

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/*
 * The built-ins the decode path uses, captured when this module loads. A licence's payload decides whether a video's seal is
 * clean (lib/watermark/seal.ts), so the path that turns the token into that payload must not depend on functions a visitor
 * can redefine later: `atob = s => …`, `JSON.parse = …` or a patched `TextDecoder` / `TextEncoder` prototype typed into
 * DevTools reaches none of these (the method and its receiver are both grabbed here, so patching the prototype afterwards
 * cannot reach the bound copy). `UTF8_ENCODE` makes the exact bytes the signature is verified over – its capture keeps a
 * re-stamped payload from being verified against the original bytes.
 */
const ATOB: (data: string) => string = globalThis.atob.bind(globalThis);
const PARSE: (text: string) => unknown = JSON.parse;
const UTF8_DECODE = (() => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return decoder.decode.bind(decoder);
})();
const UTF8_ENCODE = (() => {
  const encoder = new TextEncoder();
  return encoder.encode.bind(encoder);
})();

/** base64url without padding (RFC 4648 §5), as JWS uses it. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of a base64url string (no padding expected, none of the standard alphabet's + / =); null when it is not one. */
export function base64UrlDecode(text: string): Uint8Array | null {
  if (typeof text !== "string" || !BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const binary = ATOB(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const utf8 = (bytes: Uint8Array): string | null => {
  try {
    return UTF8_DECODE(bytes);
  } catch {
    return null;
  }
};

const parseJsonObject = (part: string): Record<string, unknown> | null => {
  const bytes = base64UrlDecode(part);
  const text = bytes ? utf8(bytes) : null;
  if (text === null) return null;
  try {
    const value: unknown = PARSE(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** The email form a licence's `sub` carries: trimmed and lower-cased. */
export function normaliseEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/** The payload's fields the site relies on, typed – null when sub, plan or exp is missing or of the wrong kind. */
export function readLicensePayload(raw: Record<string, unknown>): LicensePayload | null {
  const { sub, plan, exp, iat, provider, jti } = raw;
  if (typeof sub !== "string" || normaliseEmail(sub) === "" || !isPlan(plan) || typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return {
    sub: normaliseEmail(sub),
    plan,
    provider: isProvider(provider) ? provider : null,
    iat: typeof iat === "number" && Number.isFinite(iat) ? iat : 0,
    exp,
    jti: typeof jti === "string" ? jti : "",
  };
}

export interface DecodedLicense {
  header: Record<string, unknown>;
  /** The typed payload, null when it lacks sub, plan or exp. */
  payload: LicensePayload | null;
  /** The signed bytes: ASCII of `header "." payload` (the token's first two parts as they are). */
  signingInput: Uint8Array;
  signature: Uint8Array;
}

/** Splits and decodes a licence without verifying it; null when it is not three base64url parts of JSON objects. */
export function decodeLicense(token: string): DecodedLicense | null {
  if (typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts.some((p) => p === "")) return null;
  const header = parseJsonObject(parts[0]);
  const payload = parseJsonObject(parts[1]);
  const signature = base64UrlDecode(parts[2]);
  if (!header || !payload || !signature) return null;
  return { header, payload: readLicensePayload(payload), signingInput: UTF8_ENCODE(`${parts[0]}.${parts[1]}`), signature };
}

/** True for exactly the header the contract names: alg ES256, typ JWT, and no critical extensions to honour. */
export function isLicenseHeader(header: Record<string, unknown>): boolean {
  return header.alg === "ES256" && header.typ === "JWT" && !("crit" in header);
}

/** The licence's end as a timestamp (ms). */
export const licenseExpiresAtMs = (payload: Pick<LicensePayload, "exp">) => payload.exp * 1000;

/** True when the licence is past its exp at `nowMs`, after the allowed clock skew. */
export function licenseExpired(payload: Pick<LicensePayload, "exp">, nowMs: number, skewSec = CLOCK_SKEW_SEC): boolean {
  return nowMs > (payload.exp + skewSec) * 1000;
}

type Subtle = Pick<SubtleCrypto, "importKey" | "verify">;

function defaultSubtle(): Subtle | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && c.subtle ? c.subtle : null;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Imports a P-256 public key given as base64url of its SPKI DER (cached per key). Rejects when it is not one. */
export function importLicenseKey(spkiBase64Url: string, subtle: Subtle | null = defaultSubtle()): Promise<CryptoKey> {
  if (!subtle) return Promise.reject(new Error("WebCrypto is not available (the page needs a secure context: https or localhost)"));
  const cacheable = subtle === defaultSubtle();
  const cached = cacheable ? keyCache.get(spkiBase64Url) : undefined;
  if (cached) return cached;
  const der = base64UrlDecode(spkiBase64Url.trim());
  const imported = der
    ? subtle.importKey("spki", der as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    : Promise.reject(new Error("The licence public key is not base64url"));
  if (cacheable) {
    keyCache.set(spkiBase64Url, imported);
    imported.catch(() => keyCache.delete(spkiBase64Url));
  }
  return imported;
}

export interface VerifyLicenseOptions {
  /** The SPKI public key (base64url) or an imported CryptoKey. */
  publicKey: string | CryptoKey;
  /** The clock (ms); Date.now() by default. */
  now?: number;
  subtle?: Subtle | null;
}

/** Verifies a licence against the contract. Never throws. */
export async function verifyLicense(token: string, options: VerifyLicenseOptions): Promise<LicenseCheck> {
  const decoded = decodeLicense(token);
  if (!decoded) return { ok: false, error: "malformed" };
  if (!isLicenseHeader(decoded.header)) return { ok: false, error: "header" };
  const payload = decoded.payload;
  if (!payload) return { ok: false, error: "payload" };
  // The JWS ES256 signature is the raw 64-byte r||s pair (DER is not accepted, as WebCrypto does not take it).
  if (decoded.signature.length !== 64) return { ok: false, error: "signature" };
  const subtle = options.subtle === undefined ? defaultSubtle() : options.subtle;
  let key: CryptoKey;
  try {
    key = typeof options.publicKey === "string" ? await importLicenseKey(options.publicKey, subtle) : options.publicKey;
  } catch {
    return { ok: false, error: "key" };
  }
  let valid = false;
  try {
    valid = !!subtle && (await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, decoded.signature as BufferSource, decoded.signingInput as BufferSource));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "signature" };
  if (licenseExpired(payload, options.now ?? Date.now())) return { ok: false, error: "expired", payload };
  return { ok: true, payload };
}
