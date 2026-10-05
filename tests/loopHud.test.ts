import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOP_HUD_AMBER, LOOP_HUD_COUNTER_Y, LOOP_HUD_GREY_LIGHT, LOOP_HUD_MODE_TEXT, LOOP_HUD_TITLE_Y, drawLoopHud, hudCounterText, hudText, isLightColor, loopHudBands, loopHudCount, loopHudFrame, loopHudLayout, loopHudLiveLayout, loopHudRects } from "@/lib/loop/hud";
import { badgeMetrics, badgeRect, exportSquare, intersect } from "@/lib/watermark/layout";
import { LiveHud, liveBadgeBox, placeLiveBadge, type LivePlacement } from "@/lib/watermark/liveLayout";
import { RESOLUTIONS, resolutionToSize } from "@/lib/settings";
import { drawRecordingFrame, recordingTextLayout } from "@/lib/recording/recorder";
import { fakeCanvas, fakeDocument } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- loop-foundation --- The loop HUD (lib/loop/hud.ts): a bold lowercase title at ~16 % of the frame, a grey subtitle under a
 * rule, one amber counter (grey on a light page) at ~85 %, drawn into the export frame by the compositor – clear of the
 * watermark's badge at every export size.
 */

/** A 2D context that keeps what was written and in which colour and font. */
function recordingContext() {
  const texts: { text: string; x: number; y: number; fill: unknown; font: string }[] = [];
  const lines: { from: [number, number]; to: [number, number]; stroke: unknown }[] = [];
  let pending: [number, number] | null = null;
  const ctx = {
    font: "10px sans-serif",
    fillStyle: "#000" as unknown,
    strokeStyle: "#000" as unknown,
    lineWidth: 1,
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowColor: "",
    shadowBlur: 0,
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo(x: number, y: number) {
      pending = [x, y];
    },
    lineTo(x: number, y: number) {
      if (pending) lines.push({ from: pending, to: [x, y], stroke: ctx.strokeStyle });
    },
    stroke() {},
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: 0.6 * size * text.length };
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fill: ctx.fillStyle, font: ctx.font });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, lines };
}

afterEach(() => vi.unstubAllGlobals());

describe("loop HUD: layout", () => {
  it("puts the title at 16 % of the frame and the counter at about 85 % (just above the watermark's badge where it would meet it)", () => {
    for (const [w, h] of [[1080, 1920], [1080, 1080], [1920, 1080], [500, 500]]) {
      const l = loopHudLayout(w, h);
      expect(l.titleY).toBeCloseTo(LOOP_HUD_TITLE_Y * h, 9);
      if (h > w) expect(l.counterY).toBeCloseTo(LOOP_HUD_COUNTER_Y * h, 9);
      expect(l.counterY / h).toBeGreaterThan(0.8);
      expect(l.counterY / h).toBeLessThanOrEqual(LOOP_HUD_COUNTER_Y);
      expect(l.titleSize).toBeGreaterThan(l.counterSize);
      expect(l.counterSize).toBeGreaterThan(l.subtitleSize);
      expect(l.subtitleY).toBeGreaterThan(l.ruleY);
      expect(l.ruleY).toBeGreaterThan(l.titleY);
      expect(l.maxWidth).toBeLessThan(w);
    }
    expect([LOOP_HUD_TITLE_Y, LOOP_HUD_COUNTER_Y]).toEqual([0.16, 0.85]);
  });

  it("sits in the bars above and below the arena's square of a portrait frame", () => {
    const [w, h] = [1080, 1920];
    const square = exportSquare(w, h);
    const l = loopHudLayout(w, h);
    expect(l.titleY + 0.6 * l.titleSize).toBeLessThan(square.y);
    expect(l.subtitleY + 0.6 * l.subtitleSize).toBeLessThan(square.y);
    expect(l.counterY - 0.6 * l.counterSize).toBeGreaterThan(square.y + square.height);
  });

  it("keeps clear of the watermark's badge in both corners at every export size", () => {
    for (const res of RESOLUTIONS) {
      const { width, height } = resolutionToSize(res);
      const square = exportSquare(width, height);
      const metrics = badgeMetrics(square.width);
      const badge = { width: Math.round(0.42 * square.width), height: metrics.height, inset: metrics.inset }; // a long domain: the widest badge
      const rects = loopHudRects(loopHudLayout(width, height), width, true);
      for (const corner of ["bottom-left", "bottom-right"] as const) {
        const b = badgeRect(width, height, badge, corner, square);
        for (const r of rects) {
          const o = intersect(r, b);
          expect(o.width * o.height, `${res} ${corner}`).toBe(0);
        }
      }
    }
  });

  it("previews around the ring live: the title above it (below the page's buttons), the counter below", () => {
    const l = loopHudLiveLayout(800, 600, 300, 225, 0);
    expect(l.titleY).toBeLessThan(300 - 225);
    expect(l.counterY).toBeGreaterThan(300 + 225);
    const inset = loopHudLiveLayout(500, 500, 250, 187.5, 52);
    expect(inset.titleY - 0.5 * inset.titleSize).toBeGreaterThanOrEqual(52 - 1e-9);
    expect(inset.subtitleY).toBe(-1); // no room for the subtitle in a phone's square margin
  });

  it("keeps the live watermark's badge clear of the live HUD (its title a top band, its counter a bottom band)", () => {
    const frame = { title: "it grows with every bounce", subtitle: "how many bounces to fill the circle?", counter: "12 bounces", light: false };
    for (const [w, h] of [[800, 450], [1280, 720], [500, 500], [450, 450], [390, 844], [1080, 1920]]) {
      const side = Math.min(w, h);
      const layout = loopHudLiveLayout(w, h, h / 2, 0.375 * side, (w - side) / 2 < 170 ? 52 : 0);
      const bands = loopHudBands(layout, frame);
      const hud = new LiveHud().reset(1);
      hud.topBand(bands.top);
      hud.bottomBand(bands.bottom);
      const box = liveBadgeBox({ area: { x: (w - side) / 2, y: (h - side) / 2, width: side, height: side } });
      for (const clipMs of [0, 6000]) {
        const out: LivePlacement = { x: 0, y: 0, width: 0, height: 0, corner: "bottom-left", free: false };
        const place = placeLiveBadge(box, Math.round(0.42 * side), box.height, clipMs, hud, out); // a long domain: the widest badge
        expect(place.free).toBe(true);
        for (const r of loopHudRects(layout, w, true)) {
          const o = intersect(place, r);
          expect(o.width * o.height, `${w}x${h} at ${clipMs} ms`).toBe(0);
        }
      }
    }
    const none = loopHudBands(loopHudLiveLayout(800, 450, 225, 168.75, 0), { title: "", subtitle: "", counter: "", light: false });
    expect(none.top).toBe(-Infinity);
    expect(none.bottom).toBe(Infinity);
  });
});

describe("loop HUD: words and colours", () => {
  it("lowercases the lines, fills the counter's template and knows a light page", () => {
    expect(hudText("  Every BOUNCE  Grows ")).toBe("every bounce grows");
    expect(hudText("ŻÓŁĆ", "pl")).toBe("żółć");
    expect(hudCounterText("{count} BOUNCES", 12.4)).toBe("12 bounces");
    expect(hudCounterText("{count} bounces", null)).toBe("");
    expect([isLightColor("#ffffff"), isLightColor("#f4efe6"), isLightColor("#000000"), isLightColor("#0a0a0a"), isLightColor("nonsense")]).toEqual([true, true, false, false, false]);
    expect(loopHudFrame({ title: "It Grows", subtitle: "", counter: "{count} bounces", light: false }, 3)).toEqual({ title: "it grows", subtitle: "", counter: "3 bounces", light: false });
    expect(loopHudCount({ getCurrentModeName: () => "grow", getGrowView: () => ({ bounces: 7 }) })).toBe(7);
    expect(loopHudCount({ getCurrentModeName: () => "classic", getGrowView: () => ({ bounces: 7 }) })).toBeNull();
  });

  it("draws the title white, the subtitle grey under a rule and one amber counter – grey on a light page", () => {
    const dark = recordingContext();
    drawLoopHud(dark.ctx, 1080, { title: "it grows", subtitle: "will it fill?", counter: "12 bounces", light: false }, loopHudLayout(1080, 1920));
    expect(dark.texts.map((t) => t.text)).toEqual(["it grows", "will it fill?", "12 bounces"]);
    expect(dark.texts[0].fill).toBe("#ffffff");
    expect(dark.texts[0].font).toMatch(/^800 /);
    expect(dark.texts[2].fill).toBe(LOOP_HUD_AMBER);
    expect(dark.lines).toHaveLength(1);
    const light = recordingContext();
    drawLoopHud(light.ctx, 1080, { title: "it grows", subtitle: "", counter: "12 bounces", light: true }, loopHudLayout(1080, 1920));
    expect(light.texts.map((t) => t.text)).toEqual(["it grows", "12 bounces"]);
    expect(light.texts[1].fill).toBe(LOOP_HUD_GREY_LIGHT);
    expect(light.lines).toHaveLength(0);
    // a line too wide is shrunk to fit
    const wide = recordingContext();
    drawLoopHud(wide.ctx, 500, { title: "x".repeat(80), subtitle: "", counter: "", light: false }, loopHudLayout(500, 500));
    expect(Number(/(\d+)px/.exec(wide.texts[0].font)![1])).toBeLessThan(loopHudLayout(500, 500).titleSize);
  });

  it("is drawn into every export frame by the compositor (and not without it)", () => {
    vi.stubGlobal("document", fakeDocument()); // (a frame without a licence gets the watermark: its painter makes canvases)
    const frame = fakeCanvas(1080, 1920);
    const source = fakeCanvas(600, 600);
    const layout = recordingTextLayout(1080, 1920);
    drawRecordingFrame(frame.ctx as unknown as CanvasRenderingContext2D, source as unknown as HTMLCanvasElement, 1080, 1920, "#000", { loopHud: () => ({ title: "it grows", subtitle: "", counter: "4 bounces", light: false }) }, layout, { seal: null, clipMs: 0 });
    const texts = frame.ctx.calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(texts).toEqual(expect.arrayContaining(["it grows", "4 bounces"]));
    const plain = fakeCanvas(1080, 1920);
    drawRecordingFrame(plain.ctx as unknown as CanvasRenderingContext2D, source as unknown as HTMLCanvasElement, 1080, 1920, "#000", {}, layout, { seal: null, clipMs: 0 });
    expect(plain.ctx.calls.filter((c) => c.name === "fillText").map((c) => c.args[0])).not.toEqual(expect.arrayContaining(["it grows"]));
  });

  it("has the mode words in every language", () => {
    for (const keys of Object.values(LOOP_HUD_MODE_TEXT)) {
      for (const catalog of [en, pl, es] as Record<string, unknown>[]) {
        const hud = catalog.LoopHud as Record<string, string>;
        expect(typeof hud[keys!.title]).toBe("string");
        expect(typeof hud[keys!.subtitle]).toBe("string");
        expect(hud[keys!.counter]).toContain("{count}");
      }
    }
    expect(Object.keys(pl.LoopHud).sort()).toEqual(Object.keys(en.LoopHud).sort());
    expect(Object.keys(es.LoopHud).sort()).toEqual(Object.keys(en.LoopHud).sort());
  });
});
