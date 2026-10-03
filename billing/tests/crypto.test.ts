import { describe, expect, it } from "vitest";
import {
  base64urlToBytes,
  bytesToBase64url,
  hmacSha256Hex,
  hmacSha512Hex,
  sortedJsonStringify,
  stringToBase64url,
  timingSafeEqual,
} from "../src/crypto";

describe("crypto helpers", () => {
  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes);
    expect(stringToBase64url("héllo+/=")).not.toContain("+");
    expect(stringToBase64url("héllo+/=")).not.toContain("/");
    expect(stringToBase64url("héllo+/=")).not.toContain("=");
  });

  it("compares in constant time", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("sorts object keys recursively for the NOWPayments canonical form", () => {
    const a = sortedJsonStringify({ b: 1, a: { d: 2, c: 3 }, list: [{ y: 1, x: 2 }] });
    const b = sortedJsonStringify({ list: [{ x: 2, y: 1 }], a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1,"list":[{"x":2,"y":1}]}');
  });

  it("keeps array order while sorting element keys", () => {
    expect(sortedJsonStringify([{ b: 1, a: 2 }, { d: 1, c: 2 }])).toBe(
      '[{"a":2,"b":1},{"c":2,"d":1}]',
    );
  });

  it("produces hex MACs of the right length", async () => {
    expect(await hmacSha256Hex("secret", "data")).toHaveLength(64);
    expect(await hmacSha512Hex("secret", "data")).toHaveLength(128);
    // Known vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
});
