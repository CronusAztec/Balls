/*
 * --- blueprint --- Small pure helpers for reading untrusted spec data: plain text, ids, colours and own-property access.
 * A Blueprint arrives from a stranger's link, so nothing here trusts a prototype, a getter or a string's length.
 */

/** A plain object (not an array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property's value (never one inherited from Object.prototype: `constructor`, `__proto__`…). */
export function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * A line of plain text: control and format characters (bidi overrides, zero-width marks), lone surrogates and angle brackets
 * become spaces, runs of spaces fold, the ends are trimmed, and it is cut to `max` characters (code points, so an emoji is
 * never split). Idempotent: plainText(plainText(x)) is plainText(x).
 */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const head = value.length > max * 4 + 64 ? value.slice(0, max * 4 + 64) : value; // (a megabyte of text costs no more than a line)
  const clean = head
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(clean).slice(0, max).join("").trim();
}

/** Ids of bodies and variables: a lower-case letter, then up to 7 lower-case letters or digits. */
export const BLUEPRINT_ID = /^[a-z][a-z0-9]{0,7}$/;

/** `#rgb` / `#rrggbb` (any case) as lower-case `#rrggbb`, or null. */
export function hexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let t = value.trim().toLowerCase();
  if (!t.startsWith("#")) return null;
  t = t.slice(1);
  if (/^[0-9a-f]{3}$/.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
}

/** UTF-8 bytes of a string (lone surrogates count as the 3 bytes of U+FFFD, as TextEncoder writes them). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
