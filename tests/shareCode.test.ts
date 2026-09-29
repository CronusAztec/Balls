import { afterEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url } from "@/lib/base64";
import { SHARE_CODE_PARAM, decodeShareCode, encodeShareCode, mergeShareParams, paramsToPayload, payloadToParams, shareCodeUrl, supportsShareCodes } from "@/lib/shareCode";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

/** Deterministic pseudo-random bytes (no Math.random in tests either). */
function bytesOf(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A setup that uses most of what a link can carry: colours, texts, extras, an obstacle layout, a roster, captions, keyframes. */
const HEAVY_LINK =
  "mode=shatter&g=800&s=500&r=10&spin=0.5&wb=1.1&drag=0.002&cc=%23ff3366&top=Will+it+escape%3F&bottom=Follow+%E2%9D%A4%EF%B8%8F+%C5%BC%C3%B3%C5%82w&theme=neon" +
  "&teams=Red*ff0000*%F0%9F%94%A5%2CBlue*0000ff*%2CGreen*00ff00*&obs=p%3A0.2%2C-0.3%2C6%3Bb%3A-0.4%2C0.1%2C8%3Bp%3A0.5%2C0.5%2C5%3Bp%3A-0.5%2C0.5%2C5%3Bp%3A0.5%2C-0.5%2C5" +
  "&kf=g_0_0_4_1500*r_0_8_3_20&res=1080x1920&dur=45";

function settingsOf(link: string): SimulatorSettings {
  return settingsFromSearchParams(new URLSearchParams(link));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base64 helpers", () => {
  it("round-trip every length and every byte value", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 31, 32, 33, 100, 0x8000 + 7]) {
      const bytes = bytesOf(length, length + 3);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)) ?? [])).toEqual(Array.from(bytes));
      const url = bytesToBase64Url(bytes);
      expect(url).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(base64UrlToBytes(url) ?? [])).toEqual(Array.from(bytes));
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(all)) ?? [])).toEqual(Array.from(all));
    expect(bytesToBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
  });

  it("refuse what is not base64", () => {
    expect(base64ToBytes("not base64!")).toBeNull();
    expect(base64ToBytes("QUJD\nREVG")).toBeNull();
    expect(base64ToBytes("QUJDR")).toBeNull(); // a length of 4n + 1 cannot be base64
    expect(base64UrlToBytes("a+b/")).toBeNull(); // standard alphabet in a base64url field
    expect(base64UrlToBytes("abcde")).toBeNull();
    expect(Array.from(base64UrlToBytes("QUJD==") ?? [])).toEqual([65, 66, 67]); // padding is tolerated
  });
});

describe("share payload", () => {
  it("writes canonical numbers as JSON numbers and keeps everything else as text", () => {
    const params = new URLSearchParams("mode=classic&g=500&gap=0.25&two=1&top=007&wm=1e3&bottom=&x=-0&c=ignored");
    const payload = paramsToPayload(params);
    expect(payload).toEqual({ mode: "classic", g: 500, gap: 0.25, two: 1, top: "007", wm: "1e3", bottom: "", x: "-0" });
    expect(JSON.stringify(payload)).toBe('{"mode":"classic","g":500,"gap":0.25,"two":1,"top":"007","wm":"1e3","bottom":"","x":"-0"}');
    // …and payloadToParams gives every value back exactly as the long link had it (the code parameter never travels).
    const back = payloadToParams(JSON.parse(JSON.stringify(payload)));
    const expected = new URLSearchParams(params);
    expected.delete(SHARE_CODE_PARAM);
    expect(back?.toString()).toBe(expected.toString());
  });

  it("refuses payloads that are not a flat object of plain values", () => {
    expect(payloadToParams(null)).toBeNull();
    expect(payloadToParams([1, 2])).toBeNull();
    expect(payloadToParams("mode=classic")).toBeNull();
    expect(payloadToParams({ mode: "classic", nested: { g: 1 } })).toBeNull();
    expect(payloadToParams({ g: Number.NaN })).toBeNull();
    expect(payloadToParams({ mode: "classic", two: true })?.get("two")).toBe("1");
  });
});

describe("share codes", () => {
  it("are supported in Node 22 (CompressionStream with deflate-raw)", () => {
    expect(supportsShareCodes()).toBe(true);
  });

  it("round-trip the settings of a link, for defaults and for a heavy setup", async () => {
    for (const settings of [defaultSettings("classic"), defaultSettings("glass"), settingsOf("mode=paint&g=0&pbeat=1&pbs=manual&bpm=96"), settingsOf(HEAVY_LINK)]) {
      const params = settingsToSearchParams(settings);
      const code = await encodeShareCode(params);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      const decoded = await decodeShareCode(code!);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.params.toString()).toBe(params.toString());
      expect(settingsFromSearchParams(decoded.params)).toEqual(settingsFromSearchParams(params));
    }
  });

  it("keep the heavy setup exactly (obstacles, roster, keyframes, unicode text) and are shorter than its long link", async () => {
    const settings = settingsOf(HEAVY_LINK);
    expect(settings.obstacles).toHaveLength(5);
    expect(settings.teams).toHaveLength(3);
    expect(settings.keyframes).toHaveLength(4);
    const long = settingsToSearchParams(settings).toString();
    const code = (await encodeShareCode(settingsToSearchParams(settings)))!;
    const decoded = await decodeShareCode(code);
    expect(decoded.ok && settingsFromSearchParams(decoded.params)).toEqual(settings);
    expect(`c=${code}`.length).toBeLessThan(long.length);
  });

  it("apply the code first and the link's other parameters on top", async () => {
    const code = (await encodeShareCode(settingsToSearchParams(settingsOf("mode=shatter&g=500&s=600&top=Hello"))))!;
    const link = new URLSearchParams(`c=${code}&g=800&top=&trails=1`);
    const decoded = await decodeShareCode(link.get("c")!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const merged = mergeShareParams(decoded.params, link);
    expect(merged.has("c")).toBe(false);
    const s = settingsFromSearchParams(merged);
    expect(s.mode).toBe("shatter");
    expect(s.gravity).toBe(800); // the link wins
    expect(s.ballSpeed).toBe(600); // the code fills in the rest
    expect(s.topText).toBe(""); // an explicit value wins even when it is the default
    // Without other parameters the code alone decides; a mode in the link switches the mode and keeps the code's values.
    expect(settingsFromSearchParams(mergeShareParams(decoded.params, new URLSearchParams(`c=${code}`))).gravity).toBe(500);
    const otherMode = settingsFromSearchParams(mergeShareParams(decoded.params, new URLSearchParams(`c=${code}&mode=classic`)));
    expect(otherMode.mode).toBe("classic");
    expect(otherMode.ballSpeed).toBe(600);
  });

  it("reject damaged, foreign and oversized codes", async () => {
    const good = (await encodeShareCode(settingsToSearchParams(settingsOf("mode=classic&g=900"))))!;
    for (const bad of ["", "!!!", "abcde", good.slice(0, Math.max(1, Math.floor(good.length / 2)) - 1) + "A", "x".repeat(20_000)]) {
      expect((await decodeShareCode(bad)).ok).toBe(false);
    }
    // Valid deflate, but not a payload: plain text, a JSON array, a nested object.
    for (const text of ["mode=classic&g=900", "[1,2,3]", '{"mode":{"x":1}}']) {
      const code = bytesToBase64Url(await deflateRaw(new TextEncoder().encode(text)));
      expect(await decodeShareCode(code)).toEqual({ ok: false, error: "invalid" });
    }
    // A deflate bomb: 1 MB of spaces compresses to about a kilobyte but inflates past the payload limit.
    const bomb = bytesToBase64Url(await deflateRaw(new TextEncoder().encode(`{"mode":"classic"${" ".repeat(1024 * 1024)}}`)));
    expect(bomb.length).toBeLessThan(3000);
    expect(await decodeShareCode(bomb)).toEqual({ ok: false, error: "invalid" });
  });

  it("fall back without CompressionStream: no code to make, an 'unsupported' code to read", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    expect(supportsShareCodes()).toBe(false);
    expect(await encodeShareCode(settingsToSearchParams(defaultSettings()))).toBeNull();
    expect(await decodeShareCode("q1bKzc9LLcpMzilWsgKyAQ")).toEqual({ ok: false, error: "unsupported" });
  });

  it("build the short link from the page address", () => {
    expect(shareCodeUrl("https://cronusaztec.github.io/Balls/en/simulator/", "abc_-1")).toBe("https://cronusaztec.github.io/Balls/en/simulator/?c=abc_-1");
    expect(shareCodeUrl("http://localhost:3000/pl/simulator/?mode=classic&g=5#x", "Z")).toBe("http://localhost:3000/pl/simulator/?c=Z");
  });
});
