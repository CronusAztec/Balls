import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOP_HUD_AMBER, LOOP_HUD_COUNTER_Y, LOOP_HUD_GREY_LIGHT, LOOP_HUD_MODE_TEXT, LOOP_HUD_TITLE_Y, drawLoopHud, hudCounterText, hudText, isLightColor, loopHudCount, loopHudFrame, loopHudLayout, loopHudLiveLayout, loopHudRects } from "@/lib/loop/hud";
import { badgeMetrics, badgeRect, exportSquare, intersect } from "@/lib/watermark/layout";
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
