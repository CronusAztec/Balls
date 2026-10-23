/**
 * --- project-files --- Short share codes: `?c=<code>`.
 *
 * The code carries the same non-default settings as the long link (`settingsToSearchParams`, which only writes what
 * differs from the mode's defaults), as a JSON object keyed by the link's short parameter names – canonical numbers as
 * JSON numbers, everything else as strings –, compressed with `deflate-raw` (CompressionStream) and written in
 * base64url, so nothing in it needs escaping:
 *
 *   code = base64url(deflate-raw(JSON.stringify({ mode: "shatter", g: 500, top: "Can it escape?" })))
 *
 * Reading a link, the code's pairs are applied first and the link's other parameters on top of them (they win), so
 * `?c=…&g=800` is the shared setup with a different gravity, and every long link keeps working as it did. The code
 * gains most where the long link escapes most – obstacle layouts, captions, team rosters, keyframes, colours.
 *
 * Browsers without CompressionStream / DecompressionStream (deflate-raw) cannot make or open codes: the page then
 * shares the long link. Everything here is DOM-free apart from the streams (Node 22 has them), so it is unit-tested.
 *
 * --- unlimited-sizes --- A code carries its values whole or not at all: the page makes no code it could not open again
 * exactly (`makeShareCode()` says "too-large" and the page shares the long link), and a code with a value past the limit
 * is refused, never cut (a 1,000-obstacle layout was cut at 20,000 characters, mid-entry).
 */
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/base64";

/** The link parameter that holds a share code. */
export const SHARE_CODE_PARAM = "c";
/** Longest code read from a link, in characters. */
export const SHARE_CODE_MAX_LENGTH = 16_000;
/** Largest decompressed payload accepted, in bytes – a guard against deflate bombs. */
export const SHARE_PAYLOAD_MAX_BYTES = 256 * 1024;
/** Most parameters a payload may hold. */
const MAX_ENTRIES = 1000;
/** --- unlimited-sizes --- The longest value a code holds: the payload's own bound, so no value of a code is ever cut (was 20,000). */
const MAX_VALUE_LENGTH = SHARE_PAYLOAD_MAX_BYTES;

/** A share code's JSON: link parameter → value. */
export type SharePayload = Record<string, string | number>;

export type ShareDecodeResult = { ok: true; params: URLSearchParams } | { ok: false; error: "unsupported" | "invalid" };
/** --- unlimited-sizes --- A code, or why there is none: no CompressionStream, or settings too big for a code the page can open again. */
export type ShareEncodeResult = { ok: true; code: string } | { ok: false; error: "unsupported" | "too-large" };

/** True when the browser (or Node) can compress and decompress deflate-raw streams. */
export function supportsShareCodes(): boolean {
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") return false;
  try {
    new CompressionStream("deflate-raw");
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/** The link's parameters as a share payload: canonical numbers ("500", "0.25", "1") become JSON numbers, the rest stays text; `c` itself is left out. */
export function paramsToPayload(params: URLSearchParams): SharePayload {
  const out: SharePayload = {};
  for (const [key, value] of params) {
    if (key === SHARE_CODE_PARAM || key === "__proto__") continue;
    const n = Number(value);
    out[key] = value.trim() !== "" && Number.isFinite(n) && String(n) === value ? n : value;
  }
  return out;
}

/**
 * The link parameters of a decoded payload, or null when it is not a flat JSON object of strings, numbers and booleans.
 * Numbers go back through `String()` – the inverse of `paramsToPayload`, so every value comes back exactly as the long link had it.
 * --- unlimited-sizes --- Null too for more than MAX_ENTRIES parameters or a value longer than MAX_VALUE_LENGTH: refused, never cut.
 */
export function payloadToParams(payload: unknown): URLSearchParams | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length > MAX_ENTRIES) return null;
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (key === SHARE_CODE_PARAM) continue;
    if (typeof value === "string") {
      if (value.length > MAX_VALUE_LENGTH) return null; // --- unlimited-sizes --- (was cut there)
      params.set(key, value);
    }
    else if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(value));
    else if (typeof value === "boolean") params.set(key, value ? "1" : "0");
    else return null;
  }
  return params;
}

/** Runs bytes through a (de)compression stream; rejects when the output would exceed `limit` bytes or the input is corrupt. */
async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // Errors surface on the reader; the write side only needs its rejection swallowed.
  const writing = writer
    .write(bytes as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("share payload too large");
      }
      chunks.push(value);
    }
  } finally {
    await writing;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * --- unlimited-sizes --- The share code of a link's parameters (only `settingsToSearchParams` output is meant to go in), or
 * why there is none: "unsupported" without CompressionStream, "too-large" when `decodeShareCode()` would not give every
 * value back whole (more than SHARE_CODE_MAX_LENGTH characters, a payload over SHARE_PAYLOAD_MAX_BYTES, too many
 * parameters). The page then shares the long link, which carries everything.
 */
export async function makeShareCode(params: URLSearchParams): Promise<ShareEncodeResult> {
  if (!supportsShareCodes()) return { ok: false, error: "unsupported" };
  const payload = paramsToPayload(params);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.byteLength > SHARE_PAYLOAD_MAX_BYTES || !payloadToParams(payload)) return { ok: false, error: "too-large" };
  const code = bytesToBase64Url(await transform(bytes, new CompressionStream("deflate-raw")));
  return code.length <= SHARE_CODE_MAX_LENGTH ? { ok: true, code } : { ok: false, error: "too-large" };
}

/** The share code of a link's parameters, or null without CompressionStream or (--- unlimited-sizes ---) when the settings do not fit one: `makeShareCode()`. */
export async function encodeShareCode(params: URLSearchParams): Promise<string | null> {
  const made = await makeShareCode(params);
  return made.ok ? made.code : null;
}

/** The link parameters a share code holds; `unsupported` without DecompressionStream, `invalid` for anything that is not a code this page wrote. */
export async function decodeShareCode(code: string): Promise<ShareDecodeResult> {
  if (!supportsShareCodes()) return { ok: false, error: "unsupported" };
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > SHARE_CODE_MAX_LENGTH) return { ok: false, error: "invalid" };
  const bytes = base64UrlToBytes(trimmed);
  if (!bytes || bytes.length === 0) return { ok: false, error: "invalid" };
  try {
    const raw = await transform(bytes, new DecompressionStream("deflate-raw"), SHARE_PAYLOAD_MAX_BYTES);
    const params = payloadToParams(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    return params ? { ok: true, params } : { ok: false, error: "invalid" };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

/** The code's parameters first, then the link's other parameters on top of them (they win); the code parameter itself is dropped. */
export function mergeShareParams(codeParams: URLSearchParams, linkParams: URLSearchParams): URLSearchParams {
  const merged = new URLSearchParams(codeParams);
  for (const [key, value] of linkParams) if (key !== SHARE_CODE_PARAM) merged.set(key, value);
  return merged;
}

/** The short link of a page: its address without query or hash, plus `?c=<code>` (`base` is e.g. origin + pathname). */
export function shareCodeUrl(base: string, code: string): string {
  return `${base.replace(/[?#].*$/, "")}?${SHARE_CODE_PARAM}=${code}`;
}
