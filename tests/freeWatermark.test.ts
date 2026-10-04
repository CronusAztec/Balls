import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_STORAGE_KEY, LICENSE_TEST_PUBLIC_KEY } from "@/lib/billing/config";
import { base64UrlDecode, base64UrlEncode, verifyLicense } from "@/lib/billing/license";
import {
  BADGE_OPACITY,
  BADGE_SWITCH_MS,
  TILE_ANGLE_DEG,
  TILE_OPACITY,
  badgeCorner,
  badgeMetrics,
  badgeRect,
  badgeZone,
  exportSquare,
  intersect,
  safeZone,
  tileAnchors,
  tileLayout,
  tilePointInFrame,
  type FrameRect,
} from "@/lib/watermark/layout";
import { WatermarkUnavailableError, buildBadgeSprite, buildTileLayer, paintWatermark } from "@/lib/watermark/paint";
import { prepareStamp, sealVerdict, sealWatermark, stampFrame, watermarkDecision, type WatermarkSeal } from "@/lib/watermark/seal";
import { drawRecordingFrame, recordingTextLayout, VideoRecorder } from "@/lib/recording/recorder";
import { FastRenderHost, renderFast, type OfflineFrameRenderer } from "@/lib/recording/fastRender";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { signForeignLicense, signTestLicense } from "../scripts/lib/test-license.mjs";
import { drawsOf, fakeCanvas, fakeDocument, type FakeCanvas } from "./fakeCanvas";
import { fakeGraph } from "./fakeAudio";

/*
 * --- free-watermark --- Every video made without a verified Pro licence carries the watermark, drawn into its pixels.
 *
 * - the gate (lib/watermark/seal.ts): the decision comes from re-verifying the stored licence – free, Pro, expired, another
 *   key, a tampered payload, header or signature – and nothing exported can flip it: no setter, no look-alike seal, no flag in
 *   storage, no global, no WebCrypto or clock patched in the console (captured at load; a patch before load meets the canary);
 * - the layout (layout.ts): the badge alternates between the bottom-left and bottom-right corner every 6 s, inside the safe
 *   zone and the exported square of every export size; the diagonal tiles cover the whole frame;
 * - the painter (paint.ts): one cached sprite and one cached layer, two drawImage calls a frame, blank layers refused;
 * - the compositor of every output path: the page recorder and the fast export draw it (frames checked here), and the batch
 *   render, the viral bot and the desktop render queue produce videos only through the fast export (their sources checked).
 */

const ROOT = path.join(__dirname, "..");

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => (this.data.has(k) ? (this.data.get(k) as string) : null);
  setItem = (k: string, v: string) => void this.data.set(k, String(v));
  removeItem = (k: string) => void this.data.delete(k);
}

/** Puts `token` (or nothing) into a stand-in localStorage the gate reads. */
function storeLicence(token: string | null, extra: Record<string, string> = {}) {
  const storage = new MemoryStorage();
  if (token !== null) storage.setItem(LICENSE_STORAGE_KEY, token);
  for (const [k, v] of Object.entries(extra)) storage.setItem(k, v);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

/** The token with its payload replaced (base64url re-encoded, the signature kept): what editing it in DevTools gives. */
function tamperPayload(token: string, patch: Record<string, unknown>): string {
  const [head, body, sig] = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)!));
  return `${head}.${base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...payload, ...patch })))}.${sig}`;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {}); // the page's licence store says "test mode" once
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the gate: the decision comes from the verified licence", () => {
  it("is clean only for a verified, unexpired Pro licence (watermarkDecision)", async () => {
    const now = Date.now();
    const good = await verifyLicense(signTestLicense({ days: 30 }), { publicKey: LICENSE_TEST_PUBLIC_KEY, now });
    expect(watermarkDecision(good, now)).toBe("clean");
    expect(watermarkDecision(null, now)).toBe("marked");
    expect(watermarkDecision(undefined, now)).toBe("marked");
    expect(watermarkDecision({ ok: false, error: "signature" }, now)).toBe("marked");
    const expired = await verifyLicense(signTestLicense({ days: -2 }), { publicKey: LICENSE_TEST_PUBLIC_KEY, now });
    expect(expired.ok).toBe(false);
    expect(watermarkDecision(expired, now)).toBe("marked");
    // a verified licence checked against a later clock (it ran out since) is marked too
    expect(good.ok && watermarkDecision(good, (good.payload.exp + 3600) * 1000)).toBe("marked");
    // a payload without a known plan is never clean
    expect(good.ok && watermarkDecision({ ok: true, payload: { ...good.payload, plan: "lifetime" as never } }, now)).toBe("marked");
  });

  it("seals Free (no licence), Pro, expired, foreign-key, tampered and malformed licences from what is stored", async () => {
    const cases: [string, string | null, "clean" | "marked"][] = [
      ["no licence", null, "marked"],
      ["a Pro licence (test key)", signTestLicense({ days: 30 }), "clean"],
      ["the same, with whitespace around it", `  ${signTestLicense({ days: 30 })}\n`, "clean"],
      ["a monthly Pro licence", signTestLicense({ plan: "monthly", days: 3 }), "clean"],
      ["an expired licence", signTestLicense({ days: -2 }), "marked"],
      ["a licence signed with another key", signForeignLicense({ days: 30 }), "marked"],
      ["an expired licence whose exp was edited", tamperPayload(signTestLicense({ days: -2 }), { exp: Math.floor(Date.now() / 1000) + 86400 * 365 }), "marked"],
      ["a monthly licence turned yearly", tamperPayload(signTestLicense({ plan: "monthly", days: 30 }), { plan: "yearly" }), "marked"],
      ["a licence with a flipped signature", (() => {
        const t = signTestLicense({ days: 30 });
        return t.slice(0, -2) + (t.at(-2) === "A" ? "B" : "A") + t.at(-1);
      })(), "marked"],
      ["an unsigned token (alg none)", `${base64UrlEncode(new TextEncoder().encode('{"alg":"none","typ":"JWT"}'))}.${tamperPayload(signTestLicense(), {}).split(".")[1]}.`, "marked"],
      ["garbage", "not.a.licence", "marked"],
      ["an empty string", "", "marked"],
    ];
    for (const [name, token, verdict] of cases) {
      storeLicence(token);
      const seal = await sealWatermark();
      expect(sealVerdict(seal), name).toBe(verdict);
    }
  });

  it("ignores every flag a visitor could set: storage keys, globals, the page's DOM", async () => {
    storeLicence(null, { "jbl.pro": "true", pro: "1", isPro: "true", "jbl.watermark": "off", watermark: "false", license: "valid", "jbl.license.lapsed": JSON.stringify({ email: "a@b.co", plan: "yearly", provider: "stripe", expiresAt: Date.now() + 1e9 }) });
    vi.stubGlobal("isPro", true);
    vi.stubGlobal("__PRO__", true);
    vi.stubGlobal("document", { body: { dataset: { pro: "true" }, className: "pro licensed" }, documentElement: { dataset: { pro: "true" } } });
    expect(sealVerdict(await sealWatermark())).toBe("marked");
  });

  it("cannot be flipped through anything exported: no setter, frozen seals, look-alikes are marked", async () => {
    const api = await import("@/lib/watermark/seal");
    expect(Object.keys(api).sort()).toEqual(["prepareStamp", "sealVerdict", "sealWatermark", "stampFrame", "watermarkDecision"]);
    storeLicence(null);
    const marked = await sealWatermark();
    storeLicence(signTestLicense({ days: 30 }));
    const clean = await sealWatermark();
    expect([sealVerdict(marked), sealVerdict(clean)]).toEqual(["marked", "clean"]);
    // the seal carries no verdict and cannot be changed
    expect(Object.isFrozen(marked)).toBe(true);
    expect(Object.keys(marked).sort()).toEqual(["kind", "sealedAt"]);
    expect(() => {
      (marked as unknown as Record<string, unknown>).clean = true;
    }).toThrow(TypeError);
    // look-alikes: a copy of a clean seal, a hand-made object, a string, nothing
    for (const fake of [{ ...clean }, { kind: "watermark-seal", sealedAt: clean.sealedAt }, Object.create(clean), "clean", null, undefined, {}]) expect(sealVerdict(fake)).toBe("marked");
    // calling every export with a marked seal never cleans it
    watermarkDecision({ ok: true, payload: { sub: "a@b.co", plan: "yearly", provider: "stripe", iat: 0, exp: 4e9, jti: "" } }, Date.now());
    vi.stubGlobal("document", fakeDocument());
    prepareStamp(marked, { width: 500, height: 500 });
    stampFrame(fakeCanvas(500, 500).ctx as unknown as CanvasRenderingContext2D, marked, { width: 500, height: 500, clipMs: 0 });
    await sealWatermark();
    expect(sealVerdict(marked)).toBe("marked");
    // the recorder and the fast export take no option that could carry a decision
    const recorder = fs.readFileSync(path.join(ROOT, "src/lib/recording/recorder.ts"), "utf8");
    const fast = fs.readFileSync(path.join(ROOT, "src/lib/recording/fastRender.ts"), "utf8");
    for (const src of [recorder, fast]) {
      expect(src).toMatch(/const seal = await sealWatermark\(\);/);
      expect(src).not.toMatch(/options\.(watermark|seal|pro|licen)/i);
    }
  });

  it("ignores WebCrypto and the clock patched in the console after the page loaded", async () => {
    const subtle = globalThis.crypto.subtle as SubtleCrypto & { verify: SubtleCrypto["verify"] };
    const proto = Object.getPrototypeOf(subtle) as { verify: SubtleCrypto["verify"] };
    const realVerify = proto.verify;
    proto.verify = async () => true; // `crypto.subtle.verify = async () => true`
    try {
      storeLicence(signForeignLicense({ days: 30 }));
      expect(sealVerdict(await sealWatermark())).toBe("marked");
      storeLicence(signTestLicense({ days: 30 }));
      expect(sealVerdict(await sealWatermark())).toBe("clean");
    } finally {
      proto.verify = realVerify;
    }
    vi.spyOn(Date, "now").mockReturnValue(0); // `Date.now = () => 0`: an expired licence would look current
    storeLicence(signTestLicense({ days: -2, now: 1_700_000_000_000 }));
    expect(sealVerdict(await sealWatermark())).toBe("marked");
  });

  it("ignores the other built-ins its verdict path calls, patched in the console: WeakMap get/set and the licence's decoding", async () => {
    // What a visitor without a licence – or holding a lapsed subscription's genuine but expired one – could type into DevTools
    // to make the gate read clean. Each patch flips the verdict on the unhardened code; captured at load, it must reach nothing.
    const later = Math.floor(Date.now() / 1000) + 365 * 86400;
    const stale = signTestLicense({ days: -2 }); // a genuine, expired licence
    const [staleHead, staleBody] = stale.split(".");
    const restamped = tamperPayload(stale, { exp: later }); // its exp pushed a year ahead, the signature kept
    const restampedInput = restamped.split(".").slice(0, 2).join(".");
    const isSeal = (k: unknown) => typeof k === "object" && k !== null && (k as { kind?: unknown }).kind === "watermark-seal";
    const aYearAhead = (text: string) => text.replace(/"exp":\d+/, `"exp":${later}`);
    /** Redefines `key` of `target` like a console one-liner (`WeakMap.prototype.get = …`); returns the undo. */
    const redefine = (target: object, key: PropertyKey, value: unknown) => {
      const before = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: before?.enumerable ?? false });
      return () => (before ? Object.defineProperty(target, key, before) : void delete (target as Record<PropertyKey, unknown>)[key]);
    };
    const realGet = WeakMap.prototype.get;
    const realSet = WeakMap.prototype.set;
    const realAtob = globalThis.atob.bind(globalThis);
    const realParse = JSON.parse;
    const realDecode = TextDecoder.prototype.decode;
    const realEncode = TextEncoder.prototype.encode;
    storeLicence(null);
    const sealedBefore = await sealWatermark(); // a free recording already under way: a patch must not flip its mark either

    const attacks: [string, string | null, () => () => void][] = [
      ["WeakMap.prototype.get answers clean for every seal", null, () =>
        redefine(WeakMap.prototype, "get", function (this: WeakMap<object, unknown>, k: object) {
          return isSeal(k) ? true : realGet.call(this, k);
        })],
      ["WeakMap.prototype.set stores clean for every seal", null, () =>
        redefine(WeakMap.prototype, "set", function (this: WeakMap<object, unknown>, k: object, v: unknown) {
          return realSet.call(this, k, isSeal(k) ? true : v);
        })],
      ["atob rewrites an expired licence's exp", stale, () => redefine(globalThis, "atob", (s: string) => aYearAhead(realAtob(s)))],
      ["JSON.parse rewrites it", stale, () =>
        redefine(JSON, "parse", function (text: string, reviver?: (k: string, v: unknown) => unknown) {
          const value = realParse(text, reviver);
          if (value && typeof value === "object" && typeof (value as { exp?: unknown }).exp === "number") (value as { exp: number }).exp = later;
          return value;
        })],
      ["TextDecoder.prototype.decode rewrites it", stale, () =>
        redefine(TextDecoder.prototype, "decode", function (this: TextDecoder, ...args: Parameters<TextDecoder["decode"]>) {
          const text = realDecode.apply(this, args);
          return /"exp":\d+/.test(text) ? aYearAhead(text) : text;
        })],
      ["TextEncoder.prototype.encode feeds verify the originally signed bytes", restamped, () =>
        redefine(TextEncoder.prototype, "encode", function (this: TextEncoder, text?: string) {
          return realEncode.call(this, text === restampedInput ? `${staleHead}.${staleBody}` : text);
        })],
    ];
    for (const [name, token, patch] of attacks) {
      const verdicts: string[] = [];
      const undo = patch();
      try {
        storeLicence(token);
        verdicts.push(sealVerdict(await sealWatermark()), sealVerdict(sealedBefore));
        storeLicence(signTestLicense({ days: 30 })); // a real Pro licence under the same patch: the gate still reads it clean
        verdicts.push(sealVerdict(await sealWatermark()));
      } finally {
        undo();
      }
      expect.soft(verdicts, name).toEqual(["marked", "marked", "clean"]); // attack ignored, earlier seal unchanged, Pro still clean
    }
  });

  it("catches a WebCrypto patched before the page loaded: the canary (a broken signature must not verify)", async () => {
    const subtle = globalThis.crypto.subtle;
    const proto = Object.getPrototypeOf(subtle) as { verify: SubtleCrypto["verify"] };
    const realVerify = proto.verify;
    proto.verify = async () => true;
    try {
      vi.resetModules();
      const fresh = await import("@/lib/watermark/seal");
      storeLicence(signForeignLicense({ days: 30 }));
      expect(fresh.sealVerdict(await fresh.sealWatermark())).toBe("marked");
      storeLicence(signTestLicense({ days: 30 }));
      expect(fresh.sealVerdict(await fresh.sealWatermark())).toBe("marked"); // a patched platform gets no clean video at all
    } finally {
      proto.verify = realVerify;
      vi.resetModules();
    }
  });
});

describe("the badge: a bottom corner of the exported square, inside the safe zone, switching every 6 s", () => {
  it("alternates bottom-left / bottom-right every 6 s of the clip", () => {
    expect(BADGE_SWITCH_MS).toBe(6000);
    const at = (s: number) => badgeCorner(s * 1000);
    expect([0, 3, 5.999].map(at)).toEqual(["bottom-left", "bottom-left", "bottom-left"]);
    expect([6, 9, 11.999].map(at)).toEqual(["bottom-right", "bottom-right", "bottom-right"]);
    expect([12, 18, 24, 30].map(at)).toEqual(["bottom-left", "bottom-right", "bottom-left", "bottom-right"]);
    expect([-5, Number.NaN, Number.POSITIVE_INFINITY].map((ms) => badgeCorner(ms))).toEqual(["bottom-left", "bottom-left", "bottom-left"]);
  });

  const inside = (r: FrameRect, box: FrameRect) => r.x >= box.x - 0.5 && r.y >= box.y - 0.5 && r.x + r.width <= box.x + box.width + 0.5 && r.y + r.height <= box.y + box.height + 0.5;

  it("sits inside the frame's safe zone and the exported square of every export size, one corner each", () => {
    for (const [w, h] of [[1080, 1920], [500, 500], [1280, 720], [1920, 1080], [2160, 3840]]) {
      const square = exportSquare(w, h);
      const zone = badgeZone(w, h);
      const m = badgeMetrics(square.width);
      const badge = { width: Math.round(0.24 * square.width), height: m.height, inset: m.inset };
      const left = badgeRect(w, h, badge, "bottom-left");
      const right = badgeRect(w, h, badge, "bottom-right");
      for (const r of [left, right]) {
        expect(inside(r, safeZone(w, h)), `${w}×${h} safe zone`).toBe(true);
        expect(inside(r, square), `${w}×${h} square`).toBe(true);
        expect(r.y + r.height, `${w}×${h} bottom`).toBeCloseTo(zone.y + zone.height - m.inset, 0);
      }
      expect(left.x).toBeCloseTo(zone.x + m.inset, 0);
      expect(right.x + right.width).toBeCloseTo(zone.x + zone.width - m.inset, 0);
      // cropping one corner leaves the other: the two never overlap and sit on either side of the middle
      expect(intersect(left, right).width).toBe(0);
      expect(left.x + left.width).toBeLessThanOrEqual(w / 2);
      expect(right.x).toBeGreaterThanOrEqual(w / 2);
    }
  });

  it("keeps clear of the platforms' buttons and captions on a 1080×1920 frame", () => {
    const zone = safeZone(1080, 1920);
    expect(zone.x).toBeCloseTo(64.8, 1); // left margin
    expect(1080 - (zone.x + zone.width)).toBeCloseTo(135, 1); // the action buttons
    expect(zone.y).toBeCloseTo(153.6, 1); // the tabs
    expect(1920 - (zone.y + zone.height)).toBeCloseTo(384, 1); // caption, music line, navigation
    const square = exportSquare(1080, 1920);
    expect(square).toEqual({ x: 0, y: 420, width: 1080, height: 1080 });
    const zone1080 = badgeZone(1080, 1920);
    expect([zone1080.x, zone1080.y, zone1080.width, zone1080.height].map((v) => Math.round(v * 10) / 10)).toEqual([64.8, 420, 880.2, 1080]);
    expect(badgeMetrics(1080)).toMatchObject({ height: 56, inset: 27 });
  });
});

describe("the tiles: the domain diagonally across the whole frame", () => {
  it("rises at 30°, at 4 % opacity, the badge at 70 %", () => {
    expect(TILE_ANGLE_DEG).toBe(-30);
    expect(TILE_OPACITY).toBe(0.04);
    expect(BADGE_OPACITY).toBe(0.7);
    const layout = tileLayout(1080, 1920, 400);
    expect(layout.angle).toBeCloseTo((-30 * Math.PI) / 180);
    expect(layout.fontSize).toBe(32);
    expect(layout.stepX).toBeGreaterThan(400); // the texts of a row never touch
    expect(layout.tileHeight).toBe(2 * layout.stepY);
    expect(layout.cover).toBeGreaterThanOrEqual(Math.hypot(1080, 1920) / 2);
  });

  it("covers every part of the frame, so any crop keeps some of it", () => {
    for (const [w, h] of [[1080, 1920], [500, 500], [1920, 1080]]) {
      const layout = tileLayout(w, h, 0.56 * 27 * Math.max(10, Math.round(0.03 * Math.min(w, h))));
      const anchors = tileAnchors(w, h, layout);
      // every quarter-of-the-short-side cell of the frame holds the start of a tile text
      const cell = Math.min(w, h) / 2;
      for (let y = 0; y + cell <= h; y += cell)
        for (let x = 0; x + cell <= w; x += cell) expect(anchors.some((a) => a.x >= x && a.x < x + cell && a.y >= y && a.y < y + cell), `${w}×${h} cell ${x},${y}`).toBe(true);
    }
  });

  it("staggers the rows like bricks and turns the pattern about the frame's centre", () => {
    const layout = tileLayout(1080, 1920, 300);
    const centre = tilePointInFrame(layout, 1080, 1920, 0, 0);
    expect(centre).toEqual({ x: 540, y: 960 });
    const anchors = tileAnchors(1080, 1920, layout);
    // two anchors of neighbouring rows are half a step apart along the row
    const along = (p: { x: number; y: number }) => (p.x - 540) * Math.cos(layout.angle) + (p.y - 960) * Math.sin(layout.angle);
    const across = (p: { x: number; y: number }) => -(p.x - 540) * Math.sin(layout.angle) + (p.y - 960) * Math.cos(layout.angle);
    const row0 = anchors.filter((a) => Math.abs(across(a) - 0.5 * layout.stepY) < 1).map(along);
    const row1 = anchors.filter((a) => Math.abs(across(a) - 1.5 * layout.stepY) < 1).map(along);
    expect(row0.length).toBeGreaterThan(1);
    expect(row1.length).toBeGreaterThan(1);
    const offset = ((((row1[0] - row0[0]) % layout.stepX) + layout.stepX) % layout.stepX) / layout.stepX;
    expect(offset).toBeCloseTo(0.5, 5);
  });
});

describe("the painter: one sprite, one layer, two drawImage calls a frame", () => {
  it("draws the tile layer and the badge in its corner, building them once per size", () => {
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    const frame = fakeCanvas(1080, 1920);
    paintWatermark(frame.ctx as unknown as CanvasRenderingContext2D, { width: 1080, height: 1920, clipMs: 1000 });
    const made = doc.made.length;
    const first = drawsOf(frame.ctx);
    expect(first).toHaveLength(2);
    const layer = first[0].args[0] as FakeCanvas;
    const sprite = first[1].args[0] as FakeCanvas;
    expect([layer.width, layer.height, first[0].args[1], first[0].args[2]]).toEqual([1080, 1920, 0, 0]);
    const m = badgeMetrics(1080);
    const left = badgeRect(1080, 1920, { width: sprite.width - 2 * m.shadowPad, height: m.height, inset: m.inset }, "bottom-left");
    expect([first[1].args[1], first[1].args[2]]).toEqual([left.x - m.shadowPad, left.y - m.shadowPad]);
    // the next frames reuse both; past 6 s the badge is in the other corner
    paintWatermark(frame.ctx as unknown as CanvasRenderingContext2D, { width: 1080, height: 1920, clipMs: 6500 });
    expect(doc.made.length).toBe(made);
    const second = drawsOf(frame.ctx).slice(2);
    expect(second.map((c) => c.args[0])).toEqual([layer, sprite]);
    const right = badgeRect(1080, 1920, { width: sprite.width - 2 * m.shadowPad, height: m.height, inset: m.inset }, "bottom-right");
    expect([second[1].args[1], second[1].args[2]]).toEqual([right.x - m.shadowPad, right.y - m.shadowPad]);
    expect(right.x).toBeGreaterThan(left.x);
    expect(right.y).toBe(left.y);
  });

  it("bakes 70 % into the badge (name, domain, logo, soft shadow) and 4 % into the turned tiles", () => {
    vi.stubGlobal("document", fakeDocument());
    const badge = buildBadgeSprite(1080, "JumpingBallsLive", "example.com/Balls");
    const sprite = badge.canvas as unknown as FakeCanvas;
    expect(sprite.ctx.globalAlpha).toBe(0.7);
    expect(drawsOf(sprite.ctx)).toHaveLength(1);
    const full = drawsOf(sprite.ctx)[0].args[0] as FakeCanvas;
    const texts = full.ctx.calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(texts).toEqual(["JumpingBallsLive", "example.com/Balls"]);
    expect(full.ctx.calls.some((c) => c.name === "arc")).toBe(true); // the logo mark
    expect(badge.metrics.shadowBlur).toBeGreaterThan(0);
    const tiles = buildTileLayer(1080, 1920, "example.com/Balls");
    const layer = tiles.canvas as unknown as FakeCanvas;
    const names = layer.ctx.calls.map((c) => c.name);
    expect(names).toContain("rotate");
    expect(layer.ctx.calls.find((c) => c.name === "rotate")?.args[0]).toBeCloseTo((-30 * Math.PI) / 180);
    const fill = layer.ctx.calls.find((c) => c.name === "fillRect");
    expect(fill?.args.slice(2)).toEqual([2 * tiles.layout.cover, 2 * tiles.layout.cover]);
    expect(tiles.layout.cover).toBeGreaterThanOrEqual(Math.hypot(1080, 1920) / 2);
  });

  it("refuses a blank layer: the mark that cannot be drawn stops the export instead", () => {
    const doc = fakeDocument();
    const createElement = doc.createElement;
    doc.createElement = (tag: string) => {
      const c = createElement(tag) as FakeCanvas;
      c.blank = true; // a canvas patched to draw nothing
      return c;
    };
    vi.stubGlobal("document", doc);
    expect(() => buildBadgeSprite(777)).toThrow(WatermarkUnavailableError);
    expect(() => buildTileLayer(777, 777)).toThrow(WatermarkUnavailableError);
    vi.stubGlobal("document", undefined);
    expect(() => buildTileLayer(778, 778)).toThrow(WatermarkUnavailableError);
  });
});

describe("the compositor of every output path draws it", () => {
  /** One composed frame: what the compositor drew onto the frame's context. */
  async function composeOne(seal: WatermarkSeal | null, clipMs = 0, w = 1080, h = 1920) {
    vi.stubGlobal("document", fakeDocument());
    const frame = fakeCanvas(w, h);
    const source = fakeCanvas(800, 600);
    drawRecordingFrame(frame.ctx as unknown as CanvasRenderingContext2D, source as unknown as HTMLCanvasElement, w, h, "#000", { textOverlay: { topText: "Top" } }, recordingTextLayout(w, h), { seal, clipMs });
    return { frame, source, images: drawsOf(frame.ctx).map((c) => c.args[0]) };
  }

  it("drawRecordingFrame: the mark over everything for Free, a null seal or a look-alike – nothing for Pro", async () => {
    storeLicence(null);
    const free = await composeOne(await sealWatermark());
    expect(free.images[0]).toBe(free.source);
    expect(free.images).toHaveLength(3); // the source, the tile layer, the badge
    expect(free.frame.ctx.calls.at(-2)?.name).toBe("drawImage"); // drawn last, over the Top Text
    expect((await composeOne(null)).images).toHaveLength(3);
    expect((await composeOne({ kind: "watermark-seal", sealedAt: 0 })).images).toHaveLength(3);
    storeLicence(signTestLicense({ days: 30 }));
    const pro = await composeOne(await sealWatermark());
    expect(pro.images).toEqual([pro.source]);
  });

  /** The page recorder with a stand-in DOM and MediaRecorder; returns the compositor canvas and the stream's canvas. */
  async function record(token: string | null) {
    storeLicence(token);
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("MediaStream", class {});
    let streamFrom: unknown = null;
    vi.stubGlobal(
      "MediaRecorder",
      Object.assign(
        class {
          state = "recording";
          mimeType = "video/webm";
          start() {}
          stop() {}
        },
        { isTypeSupported: () => true },
      ),
    );
    const source = fakeCanvas(1600, 900);
    const recorder = new VideoRecorder(source as unknown as HTMLCanvasElement);
    const started = await recorder.startRecording({ resolution: { width: 1080, height: 1920 } });
    const frame = doc.made[0];
    streamFrom = frame;
    return { started, frame, streamFrom, source, images: drawsOf(frame.ctx).map((c) => c.args[0]) };
  }

  it("the page recorder: a free recording's frames carry the mark, a Pro one's do not; the stream comes from its own canvas", async () => {
    const free = await record(null);
    expect(free.started).toBe(true);
    expect(free.images[0]).toBe(free.source);
    expect(free.images.slice(1).map((c) => [(c as FakeCanvas).width, (c as FakeCanvas).height])[0]).toEqual([1080, 1920]);
    expect(free.images).toHaveLength(3);
    const pro = await record(signTestLicense({ days: 30 }));
    expect(pro.started).toBe(true);
    expect(pro.images).toEqual([pro.source]);
    const expired = await record(signTestLicense({ days: -1 }));
    expect(expired.images).toHaveLength(3);
  });

  /** A fast export of a few frames with stand-in WebCodecs: the frames handed to the encoder and what was drawn on them. */
  async function fastExport(token: string | null) {
    storeLicence(token);
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined });
    const frames: { source: FakeCanvas; drawn: unknown[] }[] = [];
    let output: ((chunk: unknown, meta?: unknown) => void) | null = null;
    // the muxer takes only real encoded chunks: stand-ins of both kinds
    class Chunk {
      constructor(init: Record<string, unknown>) {
        Object.assign(this, init);
      }
    }
    class FakeEncodedVideoChunk extends Chunk {}
    class FakeEncodedAudioChunk extends Chunk {}
    vi.stubGlobal("EncodedVideoChunk", FakeEncodedVideoChunk);
    vi.stubGlobal("EncodedAudioChunk", FakeEncodedAudioChunk);
    class FakeVideoEncoder {
      static isConfigSupported = async (c: { codec: string }) => ({ supported: c.codec.startsWith("vp09") || c.codec === "vp8", config: c });
      state = "unconfigured";
      encodeQueueSize = 0;
      constructor(init: { output: (chunk: unknown, meta?: unknown) => void }) {
        output = init.output;
      }
      configure() {
        this.state = "configured";
      }
      encode(frame: { source: FakeCanvas; init: { timestamp: number } }) {
        frames.push({ source: frame.source, drawn: drawsOf(frame.source.ctx).map((c) => c.args[0]) });
        frame.source.ctx.calls.length = 0;
        const bytes = new Uint8Array([1, 2, 3, 4]);
        output?.(new FakeEncodedVideoChunk({ type: frames.length === 1 ? "key" : "delta", timestamp: frame.init.timestamp, duration: 33333, byteLength: 4, copyTo: (dst: Uint8Array) => dst.set(bytes) }), frames.length === 1 ? { decoderConfig: { codec: "vp09.00.10.08", codedWidth: 500, codedHeight: 500 } } : undefined);
      }
      async flush() {}
      close() {
        this.state = "closed";
      }
      addEventListener() {}
      removeEventListener() {}
    }
    let audioOut: ((chunk: unknown, meta?: unknown) => void) | null = null;
    class FakeAudioEncoder {
      static isConfigSupported = async (c: { codec: string }) => ({ supported: c.codec === "opus" });
      state = "unconfigured";
      encodeQueueSize = 0;
      constructor(init: { output: (chunk: unknown, meta?: unknown) => void }) {
        audioOut = init.output;
      }
      configure() {
        this.state = "configured";
      }
      encode(data: { timestamp: number }) {
        audioOut?.(new FakeEncodedAudioChunk({ type: "key", timestamp: data.timestamp, duration: 20000, byteLength: 2, copyTo: (dst: Uint8Array) => dst.set([9, 9]) }), { decoderConfig: { codec: "opus", sampleRate: 48000, numberOfChannels: 2, description: new Uint8Array(19) } });
      }
      async flush() {}
      close() {
        this.state = "closed";
      }
      addEventListener() {}
      removeEventListener() {}
    }
    const graph = fakeGraph();
    const createGain = graph.ctx.createGain;
    // the offline mix's music bed smooths its volume (setTargetAtTime), which the plain fake graph's gains lack
    (graph.ctx as Record<string, unknown>).createGain = () => {
      const node = createGain();
      Object.assign(node.gain, { setTargetAtTime: () => undefined, cancelAndHoldAtTime: () => undefined });
      return node;
    };
    vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
    vi.stubGlobal("AudioEncoder", FakeAudioEncoder);
    vi.stubGlobal(
      "VideoFrame",
      class {
        constructor(
          public source: FakeCanvas,
          public init: { timestamp: number },
        ) {}
        close() {}
      },
    );
    vi.stubGlobal(
      "AudioData",
      class {
        timestamp: number;
        constructor(init: { timestamp: number }) {
          this.timestamp = init.timestamp;
        }
        close() {}
      },
    );
    vi.stubGlobal(
      "OfflineAudioContext",
      function FakeOffline(this: unknown, init: { length: number }) {
        return Object.assign(graph.ctx, { startRendering: async () => ({ length: init.length, numberOfChannels: 2, getChannelData: () => new Float32Array(init.length) }) });
      },
    );
    const host = new FastRenderHost();
    const world = fakeCanvas(500, 500);
    const renderer: OfflineFrameRenderer = {
      canvas: world as unknown as HTMLCanvasElement,
      renderFrame: () => undefined,
      noteWallBreak: () => undefined,
      setSongProgress: () => undefined,
      holdsEndScreen: () => false,
      slowLagMs: () => 0,
      paintBackground: () => undefined,
      ready: () => true,
    };
    host.subscribe(() => host.getJob()?.driver.attach(renderer));
    const engine = { consumeSoundEvents: () => [], isSimulationFinished: () => false, getUnlimitedView: () => ({ on: false }) } as unknown as PhysicsEngine;
    const result = await renderFast({ host, createEngine: () => engine, seed: 7, world: { width: 500, height: 500 }, resolution: { width: 500, height: 500 }, durationSec: 0.2, fps: 30, audio: null, textOverlay: {}, backgroundColor: "#000" });
    return { result, frames, world };
  }

  it("the fast export (and so the batch render, the viral bot and the desktop queue): every free frame carries the mark, a Pro export's none", async () => {
    const free = await fastExport(null);
    expect(free.result?.watermarked).toBe(true);
    expect(free.frames.length).toBeGreaterThanOrEqual(3);
    for (const f of free.frames) {
      expect(f.drawn[0]).toBe(free.world);
      expect(f.drawn).toHaveLength(3);
      expect([(f.drawn[1] as FakeCanvas).width, (f.drawn[1] as FakeCanvas).height]).toEqual([500, 500]);
    }
    const pro = await fastExport(signTestLicense({ days: 30 }));
    expect(pro.result?.watermarked).toBe(false);
    expect(pro.frames.length).toBe(free.frames.length);
    for (const f of pro.frames) expect(f.drawn).toEqual([pro.world]);
    // the same seed and settings give the same frames each time: the mark keeps the export reproducible
    const again = await fastExport(null);
    expect(again.result?.digest).toBe(free.result?.digest);
  });

  it("no other code makes a video: the batch, the bot and the desktop queue render through the fast export", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(ROOT, "src"));
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const makers = files.filter((f) => /new MediaRecorder\(|\.captureStream\(|new VideoEncoder\(|new VideoFrame\(/.test(strip(fs.readFileSync(f, "utf8")))).map((f) => path.relative(ROOT, f));
    expect(makers.sort()).toEqual(["src/lib/recording/fastRender.ts", "src/lib/recording/recorder.ts"]);
    // both compositors seal once and hand the seal to drawRecordingFrame with every frame; the compositor stamps it
    for (const f of makers) {
      const src = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
      expect(src, f).toMatch(/sealWatermark\(\)/);
      const calls = src.match(/drawRecordingFrame\([^;]*\);/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, f).toMatch(/\{ seal, clipMs: /);
    }
    expect(strip(fs.readFileSync(path.join(ROOT, "src/lib/recording/recorder.ts"), "utf8"))).toMatch(/stampFrame\(ctx, mark\?\.seal/);
    const read = (f: string) => strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
    expect(read("src/components/simulator/useBatchRender.ts")).toMatch(/startFastExport\(\)/); // the batch: the page's fast export
    expect(read("src/components/simulator/useViralBot.ts")).toMatch(/\.runJobs\(/); // the bot: the batch
    expect(read("src/components/simulator/desktop/useRenderQueue.ts")).toMatch(/\.runJobs\(\[/); // the desktop queue: the batch
    expect(read("src/components/simulator/Simulator.tsx")).toMatch(/await renderFast\(\{/);
    // the desktop bridge saves the bytes it is given; ffmpeg only scales and pads them (the mark stays in the pixels)
    const desktopRender = read("desktop/src/render.ts");
    expect(desktopRender).not.toMatch(/getContext|drawImage|VideoEncoder|captureStream/);
    const ffmpegArgs = read("desktop/src/ffmpeg/args.ts");
    expect(ffmpegArgs).toMatch(/force_original_aspect_ratio=decrease/);
    expect(ffmpegArgs).not.toMatch(/crop=|delogo|drawbox|removelogo/);
  });
});
