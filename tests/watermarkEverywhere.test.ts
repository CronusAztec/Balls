import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_STORAGE_KEY } from "@/lib/billing/config";
import { BADGE_MIN_HEIGHT, BADGE_SWITCH_MS, badgeMetrics, badgeRect, exportSquare, intersect, type FrameRect } from "@/lib/watermark/layout";
import { LIVE_BADGE_HEIGHT, LIVE_MARGIN, LiveHud, liveBadgeBox, liveBadgeHeight, liveCornerOrder, liveMargin, placeLiveBadge, type LivePlacement } from "@/lib/watermark/liveLayout";
import { noteCornerReadouts, noteEdgeText, noteJourneyHud, noteRaceHud, noteTitleBlock } from "@/components/simulator/liveMarkHud";
import { FL_ARENA_FRAC, FL_ARENA_TOP } from "@/lib/physics/modes/fightLeague";
import { signForeignLicense, signTestLicense } from "../scripts/lib/test-license.mjs";
import { drawsOf, fakeCanvas, fakeDocument, type FakeCanvas } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- watermark-everywhere --- Every frame of a live simulation a visitor without a Pro licence sees carries the watermark,
 * drawn into the canvas' own pixels as the frame's last pass:
 *
 * - the live layout (lib/watermark/liveLayout.ts): the badge 4–5 % of the exported square's side tall (at least 18 px), 1–2 %
 *   from its edges, changing side every 6 s like the video mark, clear of the mode's HUD (a band or a block in its corner sends
 *   it to the free corner), and – while the page recorder records the canvas – exactly where the video layout puts it;
 * - the gate (lib/watermark/live.ts): free-watermark's sealed decision (seal.ts) – the stored licence verified again – held in
 *   module-private state, so a Pro licence removes the mark from the next frame on (mid-run too) and removing it brings the
 *   mark back at once; no flag, global, DOM attribute or export can flip it;
 * - the painter: one sprite and one tile layer cached per canvas (size), two drawImage calls a frame, never throwing;
 * - one badge per video frame: the page recorder adds none to a canvas frame that already carries the live mark, the fast
 *   export (a canvas never stamped live) keeps its own;
 * - the wiring: the studio's canvas stamps every live frame after everything else (never offline), the split-screen stage once
 *   per composed frame, the landing page's preview too; the Windows app runs the same page (no renderer of its own).
 */

const ROOT = path.join(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => (this.data.has(k) ? (this.data.get(k) as string) : null);
  setItem = (k: string, v: string) => void this.data.set(k, String(v));
  removeItem = (k: string) => void this.data.delete(k);
}

/** A stand-in localStorage holding `token` (or nothing) and any `extra` keys. */
function storeLicence(token: string | null, extra: Record<string, string> = {}) {
  const storage = new MemoryStorage();
  if (token !== null) storage.setItem(LICENSE_STORAGE_KEY, token);
  for (const [k, v] of Object.entries(extra)) storage.setItem(k, v);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

/** Fresh copies of the live gate, the entitlement store and the recorder (the gate's state is module-private). */
async function fresh() {
  vi.resetModules();
  const live = await import("@/lib/watermark/live");
  const { getEntitlementStore } = await import("@/lib/billing/entitlement");
  const recorder = await import("@/lib/recording/recorder");
  const seal = await import("@/lib/watermark/seal");
  return { live, store: getEntitlementStore(), recorder, seal };
}

/** The drawImage calls among `calls`. */
const draws = (calls: { name: string; args: unknown[] }[]) => calls.filter((c) => c.name === "drawImage");

/** The badge's height and the sprite's shadow padding, from the sprite canvas (paint.ts adds `shadowPad` on every side). */
function spriteGeometry(sprite: FakeCanvas): { height: number; pad: number } {
  for (let h = 18; h < 1000; h++) {
    const pad = badgeMetrics(h / 0.052).shadowPad;
    if (h + 2 * pad === sprite.height) return { height: h, pad };
  }
  throw new Error(`not a badge sprite: ${sprite.width}×${sprite.height}`);
}

/** One live frame drawn into `canvas`: what the frame drew last (the drawImage calls of the stamp). */
function stamp(live: typeof import("@/lib/watermark/live"), canvas: FakeCanvas, nowMs: number, extra: Partial<import("@/lib/watermark/live").LiveFrame> = {}) {
  const before = canvas.ctx.calls.length;
  live.stampLiveFrame({ canvas: canvas as unknown as HTMLCanvasElement, ctx: canvas.ctx as unknown as CanvasRenderingContext2D, nowMs, ...extra });
  return canvas.ctx.calls.slice(before);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {}); // the licence store says "test mode" once
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const placement = (): LivePlacement => ({ x: 0, y: 0, width: 0, height: 0, corner: "bottom-left", free: true });
const squareOf = (w: number, h: number): FrameRect => {
  const s = Math.min(w, h);
  return { x: (w - s) / 2, y: (h - s) / 2, width: s, height: s };
};
const inside = (r: FrameRect, box: FrameRect) => r.x >= box.x - 0.5 && r.y >= box.y - 0.5 && r.x + r.width <= box.x + box.width + 0.5 && r.y + r.height <= box.y + box.height + 0.5;
const overlaps = (a: FrameRect, b: FrameRect) => {
  const r = intersect(a, b);
  return r.width > 0 && r.height > 0;
};

describe("the live layout: a legible badge in a corner of the exported square, every 6 s on the other side", () => {
  it("is 4–5 % of the square's side tall (never below 18 px) and 1–2 % from its edges", () => {
    expect(LIVE_BADGE_HEIGHT).toBeGreaterThanOrEqual(0.04);
    expect(LIVE_BADGE_HEIGHT).toBeLessThanOrEqual(0.05);
    expect(LIVE_MARGIN).toBeGreaterThanOrEqual(0.01);
    expect(LIVE_MARGIN).toBeLessThanOrEqual(0.02);
    for (const side of [450, 600, 787, 900, 1080, 1800, 2160]) {
      const h = liveBadgeHeight(side);
      expect(h / side, `${side}`).toBeGreaterThanOrEqual(0.04);
      expect(h / side, `${side}`).toBeLessThanOrEqual(0.05);
      expect(liveMargin(side) / side, `${side}`).toBeGreaterThanOrEqual(0.0095);
      expect(liveMargin(side) / side, `${side}`).toBeLessThanOrEqual(0.02);
    }
    expect(liveBadgeHeight(200)).toBe(BADGE_MIN_HEIGHT);
    expect(BADGE_MIN_HEIGHT).toBe(18);
    expect(liveBadgeHeight(Number.NaN)).toBe(18);
  });

  it("alternates sides every 6 s like the video mark: left corners for 0–6 s, right ones for 6–12 s, bottom first", () => {
    expect(BADGE_SWITCH_MS).toBe(6000);
    const first = (s: number) => liveCornerOrder(s * 1000)[0];
    expect([0, 3, 5.99, 6, 9, 11.99, 12, 18.5].map(first)).toEqual(["bottom-left", "bottom-left", "bottom-left", "bottom-right", "bottom-right", "bottom-right", "bottom-left", "bottom-right"]);
    expect(liveCornerOrder(0)).toEqual(["bottom-left", "top-left", "bottom-right", "top-right"]);
    expect(liveCornerOrder(7000)).toEqual(["bottom-right", "top-right", "bottom-left", "top-left"]);
    // a 1400 × 787 canvas: the badge in the bottom corners of the centred square, 1.5 % in from its edges
    const area = squareOf(1400, 787);
    const box = liveBadgeBox({ area });
    const m = liveMargin(787);
    const w = 220;
    const left = placeLiveBadge(box, w, box.height, 1000, null, placement());
    expect(left).toMatchObject({ corner: "bottom-left", free: true, x: Math.round(area.x + m), y: Math.round(787 - m - box.height), height: liveBadgeHeight(787) });
    const right = { ...placeLiveBadge(box, w, box.height, 6500, null, placement()) };
    expect(right).toMatchObject({ corner: "bottom-right", x: Math.round(area.x + area.width - m - w), y: left.y });
    for (const r of [left, right]) expect(inside(r, area)).toBe(true);
    // any 7 s of a run sees both sides
    for (let t0 = 0; t0 < 12000; t0 += 500) {
      const corners = new Set<string>();
      for (let t = t0; t <= t0 + 7000; t += 250) corners.add(placeLiveBadge(box, w, box.height, t, null, placement()).corner);
      expect(corners.size, `from ${t0} ms`).toBe(2);
    }
  });

  it("keeps clear of HUD blocks: a held corner sends the badge to the free corner of its side, then to the other side", () => {
    const area = squareOf(800, 800);
    const box = liveBadgeBox({ area });
    const w = 180;
    const h = box.height;
    // the bottom-left corner holds a clock (Journey) – left phase: top-left; right phase: bottom-right
    const hud = new LiveHud().reset(1);
    hud.block(0, 700, 120, 100);
    const left = { ...placeLiveBadge(box, w, h, 1000, hud, placement()) };
    expect(left.corner).toBe("top-left");
    expect(left.free).toBe(true);
    expect(placeLiveBadge(box, w, h, 7000, hud, placement()).corner).toBe("bottom-right");
    const clock = { x: 0, y: 700, width: 120, height: 100 };
    expect(overlaps(left, clock)).toBe(false);
    // the badge still changes side within 7 s
    expect(new Set([1000, 7000].map((t) => placeLiveBadge(box, w, h, t, hud, placement()).corner)).size).toBe(2);
    // both left corners held: the other side
    hud.block(0, 0, 300, 80);
    expect(placeLiveBadge(box, w, h, 1000, hud, placement()).corner).toBe("bottom-right");
    // every corner held: over the HUD in the side's bottom corner, said so
    hud.block(500, 0, 300, 80);
    hud.block(500, 700, 300, 100);
    const covered = placeLiveBadge(box, w, h, 1000, hud, placement());
    expect([covered.corner, covered.free]).toEqual(["bottom-left", false]);
  });

  it("sits inside the free band between the HUD's top and bottom bands (Fight League: the names above, the ability boxes below)", () => {
    const side = 900;
    const area = squareOf(1600, side);
    const box = liveBadgeBox({ area });
    const hud = new LiveHud().reset(1);
    const namesBottom = area.y + FL_ARENA_TOP * side;
    const boxesTop = area.y + (FL_ARENA_TOP + FL_ARENA_FRAC) * side + 0.022 * side;
    hud.topBand(namesBottom);
    hud.bottomBand(boxesTop);
    const m = liveMargin(side);
    for (const t of [1000, 7000]) {
      const p = placeLiveBadge(box, 240, box.height, t, hud, placement());
      expect(p.free).toBe(true);
      expect(p.y + p.height).toBeLessThanOrEqual(boxesTop - m + 0.5);
      expect(p.y).toBeGreaterThanOrEqual(namesBottom);
    }
    // a top corner keeps below the names' band
    hud.block(area.x, boxesTop - 200, side, 200); // (everything above the boxes on both sides held)
    const top = placeLiveBadge(box, 240, box.height, 1000, hud, placement());
    expect(top.corner).toBe("top-left");
    expect(top.y).toBeGreaterThanOrEqual(namesBottom + m - 0.5);
    // a band leaving no room: the bottom corner of the whole square, not free
    const tight = new LiveHud().reset(1);
    tight.topBand(area.y + 0.5 * side);
    tight.bottomBand(area.y + 0.5 * side + 10);
    expect(placeLiveBadge(box, 240, box.height, 1000, tight, placement())).toMatchObject({ corner: "bottom-left", free: false, y: Math.round(area.y + side - m - box.height) });
  });

  it("reports the HUD in the canvas' units: world px times the drawing scale; empty and non-finite reports are ignored", () => {
    const hud = new LiveHud().reset(2);
    hud.topBand(30);
    hud.bottomBand(400);
    hud.bottomBand(Number.NaN);
    hud.topBand(Number.POSITIVE_INFINITY);
    hud.block(10, 20, 30, 40);
    hud.block(0, 0, 0, 10);
    hud.block(Number.NaN, 0, 5, 5);
    expect([hud.top, hud.bottom, hud.count, hud.blocks.slice(0, 4)]).toEqual([60, 800, 1, [20, 40, 60, 80]]);
    expect(hud.overlaps({ x: 70, y: 110, width: 10, height: 10 })).toBe(true);
    expect(hud.overlaps({ x: 80, y: 120, width: 10, height: 10 })).toBe(false);
    hud.reset(1);
    expect([hud.top, hud.bottom, hud.count]).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 0]);
  });

  it("knows where the modes' corner HUD sits: the readouts, the title blocks, a race's standings and mini-map, Journey's clock, the Top / Bottom Text", () => {
    const sq = { x0: 175, y0: 0, side: 450 };
    const hud = new LiveHud().reset(1);
    noteCornerReadouts(hud, sq, true, 2, 0);
    const readout = { x: hud.blocks[0], y: hud.blocks[1], width: hud.blocks[2], height: hud.blocks[3] };
    expect(readout.x + readout.width).toBeCloseTo(sq.x0 + sq.side - 0.025 * sq.side, 5);
    expect(readout.y + readout.height).toBeCloseTo(sq.y0 + sq.side - 0.025 * sq.side, 5);
    const box = liveBadgeBox({ area: { x: sq.x0, y: sq.y0, width: sq.side, height: sq.side } });
    expect(placeLiveBadge(box, 100, box.height, 7000, hud, placement()).corner).toBe("top-right"); // (the readouts hold the bottom right)
    hud.reset(1);
    noteTitleBlock(hud, sq, 0, 3, "both");
    expect(hud.count).toBe(2);
    hud.reset(1);
    noteJourneyHud(hud, { cx: sq.x0 + sq.side / 2, top: 0, bottom: sq.side, height: sq.side });
    expect(placeLiveBadge(box, 100, box.height, 1000, hud, placement()).corner).toBe("top-left"); // the clock holds the bottom left
    expect(placeLiveBadge(box, 100, box.height, 7000, hud, placement()).corner).toBe("bottom-right"); // the mini-map ends above it
    hud.reset(1);
    noteRaceHud(hud, { racers: 16, phase: "race", track: { field: { left: sq.x0, top: 0, bottom: sq.side, size: sq.side } } }, null, 0);
    expect(hud.count).toBe(2);
    hud.reset(1);
    noteRaceHud(hud, { racers: 16, phase: "podium", track: { field: { left: sq.x0, top: 0, bottom: sq.side, size: sq.side } } }, null, 0);
    expect(hud.count).toBe(0);
    hud.reset(1);
    noteEdgeText(hud, sq.x0 + sq.side / 2, { topY: 30, bottomY: 420, fontSize: 18 }, "", "A very long bottom line of text that spans the square");
    expect(hud.count).toBe(1);
    expect(hud.blocks[2]).toBeGreaterThan(0.6 * sq.side);
  });

  it("while the page recorder records the canvas, puts the badge where the video layout puts it in the export frame", () => {
    for (const [cw, ch, ew, eh] of [[1400, 787, 1080, 1920], [900, 900, 1080, 1920], [1400, 787, 1920, 1080], [1600, 900, 500, 500]]) {
      const area = squareOf(cw, ch);
      const box = liveBadgeBox({ area, recording: { width: ew, height: eh } });
      const square = exportSquare(ew, eh);
      const k = area.width / square.width;
      const m = badgeMetrics(square.width);
      expect(Math.abs(box.height - m.height * k)).toBeLessThanOrEqual(0.5);
      const spriteW = Math.round(4.2 * box.height);
      for (const [t, corner] of [[1000, "bottom-left"], [7000, "bottom-right"]] as const) {
        const p = placeLiveBadge(box, spriteW, box.height, t, null, placement());
        expect(p.corner).toBe(corner);
        // where the recorder's crop and scale put it in the export frame …
        const ex = square.x + (p.x - area.x) / k;
        const ey = square.y + (p.y - area.y) / k;
        // … is the video layout's badge of the same size
        const video = badgeRect(ew, eh, { width: spriteW / k, height: box.height / k, inset: m.inset }, corner, square);
        expect(Math.abs(ex - video.x), `${cw}×${ch} → ${ew}×${eh} ${corner} x`).toBeLessThanOrEqual(1.5 / k + 0.5);
        expect(Math.abs(ey - video.y), `${cw}×${ch} → ${ew}×${eh} ${corner} y`).toBeLessThanOrEqual(1.5 / k + 0.5);
      }
    }
  });
});

describe("the gate: free-watermark's sealed decision, held by the live canvas", () => {
  it("marks a visitor without a verified Pro licence – none, expired, another key's, edited, garbage – and only those", async () => {
    const cases: [string, string | null, boolean][] = [
      ["no licence", null, true],
      ["a Pro licence (test key)", signTestLicense({ days: 30 }), false],
      ["a monthly Pro licence", signTestLicense({ plan: "monthly", days: 3 }), false],
      ["an expired licence", signTestLicense({ days: -2 }), true],
      ["another key's licence", signForeignLicense({ days: 30 }), true],
      ["garbage", "not.a.licence", true],
    ];
    for (const [name, token, marked] of cases) {
      storeLicence(token);
      vi.stubGlobal("document", fakeDocument());
      const { live } = await fresh();
      await live.primeLiveWatermark();
      const canvas = fakeCanvas(1400, 787);
      const drawn = draws(stamp(live, canvas, 100));
      expect(drawn.length, name).toBe(marked ? 2 : 0);
      expect(live.liveMarkCovers(canvas), name).toBe(marked);
    }
  });

  it("draws the mark from the very first frame, before any licence check has answered (fail closed)", async () => {
    storeLicence(signTestLicense({ days: 30 }));
    vi.stubGlobal("document", fakeDocument());
    const { live } = await fresh();
    const canvas = fakeCanvas(800, 450);
    expect(draws(stamp(live, canvas, 0))).toHaveLength(2); // the seal is still being made
    await live.primeLiveWatermark();
    expect(draws(stamp(live, canvas, 16))).toHaveLength(0); // verified Pro: clean from now on
  });

  it("a Pro licence activated mid-run removes the mark from the next frames; removing it brings the mark back at once", async () => {
    const storage = storeLicence(null);
    vi.stubGlobal("document", fakeDocument());
    const { live, store } = await fresh();
    await live.primeLiveWatermark();
    const canvas = fakeCanvas(1400, 787);
    expect(draws(stamp(live, canvas, 0))).toHaveLength(2);
    // activated (pasted / restored / another tab): the store installs it and reports the change
    const check = await store.install(signTestLicense({ days: 30 }));
    expect(check.ok).toBe(true);
    await live.primeLiveWatermark();
    expect(draws(stamp(live, canvas, 1000))).toHaveLength(0);
    expect(live.liveMarkCovers(canvas)).toBe(false);
    // removed from this browser: marked on the very next frame, before anything is verified again
    store.clear();
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBeNull();
    expect(draws(stamp(live, canvas, 2000))).toHaveLength(2);
    // and back again
    await store.install(signTestLicense({ days: 30 }));
    await live.primeLiveWatermark();
    expect(draws(stamp(live, canvas, 3000))).toHaveLength(0);
  });

  it("ignores every flag a visitor could set: storage keys, a forged licence, globals, the page's DOM", async () => {
    const forged = (() => {
      const [head, , sig] = signForeignLicense({ days: 30 }).split(".");
      const body = Buffer.from(JSON.stringify({ sub: "x@y.z", plan: "yearly", provider: "stripe", iat: 1, exp: 4e9, jti: "f" })).toString("base64url");
      return `${head}.${body}.${sig}`;
    })();
    storeLicence(forged, { "jbl.pro": "true", pro: "1", isPro: "true", "jbl.watermark": "off", watermark: "false", license: "valid" });
    vi.stubGlobal("isPro", true);
    vi.stubGlobal("__PRO__", true);
    const doc = Object.assign(fakeDocument(), { body: { dataset: { pro: "true" }, className: "pro licensed no-watermark" }, documentElement: { dataset: { pro: "true", watermark: "off" } } });
    vi.stubGlobal("document", doc);
    const { live } = await fresh();
    await live.primeLiveWatermark();
    const canvas = fakeCanvas(1400, 787);
    (canvas as unknown as { dataset: Record<string, string> }).dataset = { pro: "true", watermark: "off", license: "valid" };
    expect(draws(stamp(live, canvas, 0))).toHaveLength(2);
  });

  it("exposes nothing that could flip it: no setter, the live module's exports are the frame pass and its helpers", async () => {
    const { live, seal } = await fresh();
    expect(Object.keys(live).sort()).toEqual(["LiveHud", "liveMarkCovers", "primeLiveWatermark", "stampLiveFrame"]);
    expect(Object.keys(seal).sort()).toEqual(["prepareStamp", "sealVerdict", "sealWatermark", "stampFrame", "watermarkDecision"]);
    const src = strip(read("src/lib/watermark/live.ts"));
    // the decision is free-watermark's: sealWatermark() / sealVerdict(), no second verification of its own
    expect(src).toMatch(/sealWatermark\(\)/);
    expect(src).toMatch(/sealVerdict\(liveSeal\) === "clean"/);
    expect(src).not.toMatch(/verifyLicense|importLicenseKey|crypto\.subtle/);
    // nothing written to the page, storage or globals
    expect(src).not.toMatch(/setItem|removeItem|dataset|classList|setAttribute|appendChild|\.style\b|innerHTML|globalThis\.\w+\s*=|window\.\w+\s*=/);
    // and nothing in the canvas' data attributes says whether the frame is marked
    for (const f of ["src/components/simulator/Canvas.tsx", "src/components/simulator/splitScreenCanvas.tsx"]) {
      const keys = [...strip(read(f)).matchAll(/set(?:Canvas)?Data\(\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(keys.length, f).toBeGreaterThan(10);
      expect(keys.filter((k) => /watermark|licen|^(is)?pro$|^live|^mark$|stamp|seal|clean/i.test(k)), f).toEqual([]);
      expect(strip(read(f)), f).not.toMatch(/dataset\.(watermark|licen|pro\b|live|mark\b)/i);
    }
  });
});

describe("the live painter: one sprite and one tile layer per canvas, two drawImage calls a frame", () => {
  it("draws the tiles over the whole canvas, then the badge, last, with the transform, opacity, compositing, shadow and filter reset", async () => {
    storeLicence(null);
    vi.stubGlobal("document", fakeDocument());
    const { live } = await fresh();
    await live.primeLiveWatermark();
    const canvas = fakeCanvas(1400, 787);
    canvas.ctx.globalAlpha = 0.3; // what a frame may leave behind
    canvas.ctx.globalCompositeOperation = "lighter";
    const calls = stamp(live, canvas, 500);
    expect(calls.map((c) => c.name)).toEqual(["save", "setTransform", "drawImage", "drawImage", "restore"]);
    expect(calls[1].args).toEqual([1, 0, 0, 1, 0, 0]);
    const [tiles, badge] = calls.filter((c) => c.name === "drawImage");
    const layer = tiles.args[0] as FakeCanvas;
    expect([layer.width, layer.height, tiles.args[1], tiles.args[2]]).toEqual([1400, 787, 0, 0]);
    const h = liveBadgeHeight(787);
    const { height, pad } = spriteGeometry(badge.args[0] as FakeCanvas);
    expect(height).toBe(h);
    const area = squareOf(1400, 787);
    expect(badge.args[1]).toBe(Math.round(area.x + liveMargin(787)) - pad); // bottom-left for the first 6 s
    expect(badge.args[2]).toBe(Math.round(787 - liveMargin(787) - h) - pad);
  });

  it("builds the sprite and the tile layer once per canvas size, keeps separate caches per canvas, rebuilds on a resize", async () => {
    storeLicence(null);
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    const { live } = await fresh();
    await live.primeLiveWatermark();
    const a = fakeCanvas(1400, 787);
    const b = fakeCanvas(1080, 1080);
    stamp(live, a, 0);
    stamp(live, b, 0);
    const made = doc.made.length;
    for (let i = 1; i <= 120; i++) {
      expect(draws(stamp(live, a, 16 * i))).toHaveLength(2);
      expect(draws(stamp(live, b, 16 * i))).toHaveLength(2);
    }
    expect(doc.made.length).toBe(made); // 240 frames, nothing rebuilt: no thrashing between the two canvases
    a.width = 1200;
    a.height = 675;
    stamp(live, a, 2000);
    const resized = doc.made.length;
    expect(resized).toBeGreaterThan(made); // a new tile layer (and sprite) for the new size …
    stamp(live, a, 2016);
    expect(doc.made.length).toBe(resized); // … once
  });

  it("never throws: a mark that cannot be built leaves the frame unmarked for the recorder and is tried again later", async () => {
    storeLicence(null);
    const doc = fakeDocument();
    const createElement = doc.createElement;
    let sabotaged = true;
    doc.createElement = (tag: string) => {
      const c = createElement(tag) as FakeCanvas;
      if (sabotaged) c.blank = true;
      return c;
    };
    vi.stubGlobal("document", doc);
    const { live } = await fresh();
    await live.primeLiveWatermark();
    const canvas = fakeCanvas(800, 450);
    expect(() => stamp(live, canvas, 0)).not.toThrow();
    expect(live.liveMarkCovers(canvas)).toBe(false);
    sabotaged = false;
    expect(draws(stamp(live, canvas, 500))).toHaveLength(0); // (waits a second before trying again)
    expect(draws(stamp(live, canvas, 1100))).toHaveLength(2);
    expect(live.liveMarkCovers(canvas)).toBe(true);
  });

  it("places the badge clear of the HUD the canvas reported, and in the video layout's place while the page recorder records", async () => {
    storeLicence(null);
    vi.stubGlobal("document", fakeDocument());
    const { live } = await fresh();
    await live.primeLiveWatermark();
    const canvas = fakeCanvas(900, 900);
    const hud = new live.LiveHud().reset(2); // world px at 2 canvas px each
    hud.block(0, 380, 100, 70); // the bottom-left corner of a 450-world-px square
    const badge = draws(stamp(live, canvas, 1000, { hud }))[1];
    const { pad } = spriteGeometry(badge.args[0] as FakeCanvas);
    expect([badge.args[1], badge.args[2]]).toEqual([liveMargin(900) - pad, liveMargin(900) - pad]); // top-left: the bottom-left corner is held
    // recording a 1080 × 1920 clip, 1 s in: the video layout's badge (5.2 % of the exported square) in its bottom-left corner
    const rec = draws(stamp(live, canvas, 5000, { recording: { startMs: 4000, width: 1080, height: 1920 } }))[1];
    const k = 900 / 1080;
    const m = badgeMetrics(1080);
    const g = spriteGeometry(rec.args[0] as FakeCanvas);
    expect(g.height).toBe(Math.round(m.height * k));
    const square = exportSquare(1080, 1920);
    const video = badgeRect(1080, 1920, { width: ((rec.args[0] as FakeCanvas).width - 2 * g.pad) / k, height: g.height / k, inset: m.inset }, "bottom-left", square);
    expect(Math.abs(square.x + ((rec.args[1] as number) + g.pad) / k - video.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(square.y + ((rec.args[2] as number) + g.pad) / k - video.y)).toBeLessThanOrEqual(2);
  });
});

describe("one badge per video frame: the page recorder adds none to a frame that carries the live mark", () => {
  /** The recorder's compositor over `source`: the images it drew into a 1080 × 1920 frame. */
  function compose(recorder: typeof import("@/lib/recording/recorder"), seal: unknown, source: FakeCanvas, clipMs = 1000) {
    const frame = fakeCanvas(1080, 1920);
    recorder.drawRecordingFrame(frame.ctx as unknown as CanvasRenderingContext2D, source as unknown as HTMLCanvasElement, 1080, 1920, "#000", {}, recorder.recordingTextLayout(1080, 1920), { seal: seal as never, clipMs });
    return drawsOf(frame.ctx).map((c) => c.args[0]);
  }

  it("a free recording of the live canvas: the canvas' frame carries the one badge, the compositor adds neither badge nor tiles", async () => {
    storeLicence(null);
    vi.stubGlobal("document", fakeDocument());
    const { live, recorder, seal } = await fresh();
    await live.primeLiveWatermark();
    const free = await seal.sealWatermark();
    const canvas = fakeCanvas(900, 900);
    const own = stamp(live, canvas, 1000, { recording: { startMs: 0, width: 1080, height: 1920 } });
    expect(draws(own).filter((c) => (c.args[0] as FakeCanvas).width < 900)).toHaveLength(1); // the canvas: one badge (and the tile layer)
    const images = compose(recorder, free, canvas);
    expect(images).toEqual([canvas]); // the recorder: the copied canvas only – no second badge, no second tile layer
    // its position in the clip: the video layout's bottom-left corner
    const square = exportSquare(1080, 1920);
    const k = 900 / square.width;
    const b = draws(own)[1];
    const sprite = b.args[0] as FakeCanvas;
    const { pad } = spriteGeometry(sprite);
    const clipBadge = { x: square.x + ((b.args[1] as number) + pad) / k, y: square.y + ((b.args[2] as number) + pad) / k, width: (sprite.width - 2 * pad) / k, height: (sprite.height - 2 * pad) / k };
    const video = badgeRect(1080, 1920, { width: clipBadge.width, height: clipBadge.height, inset: badgeMetrics(1080).inset }, "bottom-left", square);
    expect(Math.abs(clipBadge.x - video.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(clipBadge.y - video.y)).toBeLessThanOrEqual(2);
  });

  it("the compositor stamps its own when the source carries no live mark: the fast export's canvas, a resized canvas, a Pro canvas under a free seal", async () => {
    storeLicence(null);
    vi.stubGlobal("document", fakeDocument());
    const { live, recorder, seal, store } = await fresh();
    await live.primeLiveWatermark();
    const free = await seal.sealWatermark();
    // the fast export's offline canvas: never stamped live
    const offline = fakeCanvas(500, 500);
    expect(compose(recorder, free, offline)).toHaveLength(3); // the source, the tile layer, the badge
    // a live canvas resized since its last marked frame
    const canvas = fakeCanvas(900, 900);
    stamp(live, canvas, 0);
    expect(compose(recorder, free, canvas)).toEqual([canvas]);
    canvas.width = 1000;
    expect(compose(recorder, free, canvas)).toHaveLength(3);
    // a licence activated mid-recording: the canvas turns clean, the free recording's frames get the compositor's badge
    canvas.width = 900;
    stamp(live, canvas, 16);
    await store.install(signTestLicense({ days: 30 }));
    await live.primeLiveWatermark();
    stamp(live, canvas, 32);
    expect(live.liveMarkCovers(canvas)).toBe(false);
    expect(compose(recorder, free, canvas)).toHaveLength(3);
    // and a Pro recording of a clean canvas: nothing at all
    const pro = await seal.sealWatermark();
    expect(compose(recorder, pro, canvas)).toEqual([canvas]);
  });

  it("the page recorder end to end: a free recording's frames copy the marked canvas once and add no badge", async () => {
    storeLicence(null);
    const doc = fakeDocument();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("MediaStream", class {});
    vi.stubGlobal("MediaRecorder", Object.assign(class { state = "recording"; mimeType = "video/webm"; start() {} stop() {} }, { isTypeSupported: () => true }));
    const { live, recorder } = await fresh();
    await live.primeLiveWatermark();
    const source = fakeCanvas(900, 900);
    stamp(live, source, 0, { recording: { startMs: 0, width: 1080, height: 1920 } });
    const made = doc.made.length;
    const r = new recorder.VideoRecorder(source as unknown as HTMLCanvasElement);
    expect(await r.startRecording({ resolution: { width: 1080, height: 1920 } })).toBe(true);
    const frame = doc.made[made]; // the recorder's own canvas
    expect(drawsOf(frame.ctx).map((c) => c.args[0])).toEqual([source]);
  });
});

describe("the wiring: every live canvas stamps its frames last, offline canvases never", () => {
  /** The body of the canvas' draw routine. */
  const drawBody = () => {
    const src = read("src/components/simulator/Canvas.tsx");
    const start = src.indexOf("    const draw = (ts?: number) => {");
    const end = src.indexOf("    // --- fast-render --- offline, the export draws every frame itself");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("the studio's canvas: the live pass is the last drawing of every frame, skipped offline (the fast export, a race's arenas)", () => {
    const body = strip(drawBody());
    const at = body.indexOf("stampLiveFrame(liveFrame)");
    expect(at).toBeGreaterThan(0);
    expect(body.lastIndexOf("stampLiveFrame(")).toBe(at); // once a frame
    // nothing drawn after it in the frame: no fill, stroke, text, image or rectangle on the context
    const after = body.slice(at + "stampLiveFrame(liveFrame)".length);
    expect(after).not.toMatch(/ctx\.(fill|stroke|fillText|strokeText|drawImage|fillRect|clearRect|putImageData)\b/);
    // and only live: the block that reports the HUD and stamps is `if (!offline) { … }`
    expect(body).toMatch(/if \(!offline\) \{\s*const hud = liveHud\.reset\(scale\);[\s\S]*?stampLiveFrame\(liveFrame\);\s*\}/);
  });

  it("the split-screen stage stamps the composed frame once; its arenas are offline canvases", () => {
    const src = strip(read("src/components/simulator/splitScreenCanvas.tsx"));
    expect(src.match(/stampLiveFrame\(/g)).toHaveLength(1);
    expect(src).toMatch(/offline=\{driver\}/);
    // after the stamp, only the data attributes and the frame rate
    const after = src.slice(src.indexOf("stampLiveFrame(liveFrame)"));
    expect(after.slice(0, after.indexOf("return () => cancelAnimationFrame(raf);"))).not.toMatch(/ctx\.(fill|stroke|fillText|drawImage|fillRect)\b/);
  });

  it("the landing page's live preview stamps each frame after drawing it; the gallery, the daily challenge and share links play in the studio's canvas", () => {
    const src = strip(read("src/components/site/LivePreview.tsx"));
    expect(src).toMatch(/drawPreview\([^)]*\);\s*stampLiveFrame\(mark\);/);
    expect(src).toMatch(/drawPreview\([^)]*\);\s*mark\.nowMs = now;\s*stampLiveFrame\(mark\);/);
    // the gallery's cards open the studio, which is the only other canvas of the site
    expect(read("src/app/[locale]/gallery/page.tsx")).toMatch(/galleryHref|\/simulator/);
    const canvases: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name) && /<canvas\b/.test(read(p))) canvases.push(p);
      }
    };
    walk("src");
    // every canvas that plays a simulation stamps it; the panel's other two draw no simulation (the face icon of the ball
    // characters, the beats of an imported video's waveform)
    const notSimulations = ["src/components/simulator/sections/CharacterSection.tsx", "src/components/simulator/sections/VideoBeatsSection.tsx"];
    expect(canvases.filter((f) => !notSimulations.includes(f)).sort()).toEqual(["src/components/simulator/Canvas.tsx", "src/components/simulator/splitScreenCanvas.tsx", "src/components/site/LivePreview.tsx"]);
    for (const f of notSimulations) expect(read(f), f).not.toMatch(/PhysicsEngine|createEngineForSettings|engine\.update\(/);
  });

  it("the Windows app runs the same page and renderer: no canvas drawing of its own", () => {
    const main = read("desktop/src/main.ts");
    expect(main).toMatch(/loadURL\(startUrl\(/);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk("desktop/src");
    for (const f of files) expect(strip(read(f)), f).not.toMatch(/getContext\(|drawImage\(|captureStream\(/);
  });

  it("the page recorder's compositor stamps only frames the live pass did not mark", () => {
    const src = strip(read("src/lib/recording/recorder.ts"));
    expect(src).toMatch(/if \(!liveMarkCovers\(source\)\) stampFrame\(ctx, mark\?\.seal/);
  });
});

describe("the copy: free simulations and free videos carry a small watermark, Pro removes it", () => {
  it("every locale has the new keys (and the same keys in Watermark and Billing), and says so in its words", () => {
    const keys = (o: unknown, prefix = ""): string[] =>
      o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
    for (const ns of ["Watermark", "Billing"] as const) {
      const ref = keys((en as Record<string, unknown>)[ns]).sort();
      expect(keys((pl as Record<string, unknown>)[ns]).sort(), `pl ${ns}`).toEqual(ref);
      expect(keys((es as Record<string, unknown>)[ns]).sort(), `es ${ns}`).toEqual(ref);
    }
    expect(en.Billing.liveMark).toMatch(/simulations.*videos.*watermark.*Pro removes/i);
    expect(en.Watermark.liveTagTip).toMatch(/simulations and videos.*watermark.*Pro removes/i);
    expect(en.Watermark.liveNote).toMatch(/simulator and the videos.*watermark/i);
    expect(pl.Billing.liveMark).toMatch(/symulacje.*filmy.*znak wodny.*Pro usuwa/i);
    expect(es.Billing.liveMark).toMatch(/simulaciones.*vídeos.*marca de agua.*Pro la quita/i);
    for (const catalog of [en, pl, es]) {
      expect(catalog.Billing.liveMark).toContain("{siteName}");
      expect(catalog.Watermark.liveNote).toContain("{siteName}");
    }
  });

  it("the pricing page, the Unlock dialog, the line under the stage and the tag's tooltip use it", () => {
    expect(read("src/app/[locale]/pricing/page.tsx")).toMatch(/t\("liveMark", \{ siteName: SITE_NAME \}\)/);
    expect(read("src/components/billing/UnlockDialog.tsx")).toMatch(/t\("liveMark", \{ siteName: SITE_NAME \}\)/);
    expect(read("src/components/simulator/sections/FreeWatermarkNote.tsx")).toMatch(/t\("liveNote"/);
    expect(read("src/components/billing/WatermarkBadge.tsx")).toMatch(/t\("liveTagTip"\)/);
  });
});
