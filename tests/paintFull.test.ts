import { describe, expect, it } from "vitest";
import { PAINT_GUIDE_BRUSH, PAINT_MILESTONES, PAINT_MILESTONE_MIDI, paintHueFrequency } from "@/lib/physics/modes/paint";
import { COVERAGE_DONE } from "@/lib/physics/picturePaint";
import { midiToFrequency } from "@/lib/audio/scales";
import type { SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, runNeverFinishes } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { SPECK_DAB_CELLS, drawPaintFull, drawPaintProgressRing, paintShownShare } from "@/components/simulator/paintRenderer";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- paint-full --- Paint's full canvas inside a clip (lib/physics/modes/paint.ts, components/simulator/paintRenderer.ts): Guide to
 * the Gaps (classic Paint's rebounds steered toward the biggest unpainted patch, a wider brush), the bounces pitched by the stroke's
 * hue, the milestone chimes and the full canvas' chord, the page's start look, and the link base untouched.
 */

const WORLD = { width: 450, height: 450 } as const;
function engineOf(patch: Partial<SimulatorSettings>, seed: number) {
  const s = { ...defaultSettings("paint"), ...patch } as SimulatorSettings;
  return createEngineForSettings(physicsConfigOfSettings(s, WORLD as never), "paint", modeSettingsOfSettings(s), seed);
}
const startLook = (): Partial<SimulatorSettings> => clipStartSettings("paint");

describe("Paint: the full canvas inside the clip (paint-full)", () => {
  it("pitches a bounce by the stroke's hue on C major pentatonic, red low and violet high", () => {
    expect(paintHueFrequency(0)).toBeCloseTo(midiToFrequency(60), 9);
    expect(paintHueFrequency(359)).toBeCloseTo(midiToFrequency(81), 9);
    expect(paintHueFrequency(360)).toBeCloseTo(paintHueFrequency(0), 9);
    expect(paintHueFrequency(180)).toBeGreaterThan(paintHueFrequency(90));
  });

  it("fills the canvas on every seed of the start look inside the clip, chiming each milestone and ringing the chord at the full canvas", { timeout: 120_000 }, () => {
    const ends: number[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const e = engineOf(startLook(), seed);
      const log: { t: number; e: SoundEvent }[] = [];
      for (let k = 0; k < 40 * 60 && !e.isSimulationFinished(); k++) {
        e.update(1000 / 60, 0);
        for (const ev of e.consumeSoundEvents()) log.push({ t: e.getElapsedMs() / 1000, e: ev });
      }
      const pv = e.getPaintProgressView();
      expect([e.isSimulationFinished(), pv.done, pv.milestones]).toEqual([true, true, PAINT_MILESTONES.length]);
      expect(e.getPaintCoverage()).toBeGreaterThanOrEqual(COVERAGE_DONE);
      // the chimes: one a milestone, rising, decorative; the chord with the last
      const chimes = log.filter((x) => x.e.loop === "chime");
      expect(chimes.map((x) => x.e.frequency)).toEqual(PAINT_MILESTONE_MIDI.map((m) => midiToFrequency(m)));
      expect(chimes.every((x) => x.e.ringVoice === "extra" && x.e.melody === false)).toBe(true);
      for (let i = 1; i < chimes.length; i++) expect(chimes[i].t).toBeGreaterThan(chimes[i - 1].t);
      const chords = log.filter((x) => x.e.loop === "chord");
      expect(chords).toHaveLength(1);
      expect([chords[0].e.ringVoice, chords[0].t]).toEqual(["extra", chimes[chimes.length - 1].t]);
      // every bounce plays the hue's note as a pluck marked as a contact, never the plain hit
      expect(log.filter((x) => x.e.type === "hit" && !x.e.loop)).toHaveLength(0);
      const plucks = log.filter((x) => x.e.loop === "pluck");
      expect(plucks.length).toBeGreaterThan(20);
      expect(plucks.every((x) => x.e.frequency !== undefined && x.e.ringVoice === "contact")).toBe(true);
      ends.push(e.getElapsedMs() / 1000);
    }
    expect(Math.max(...ends)).toBeLessThan(27);
  });

  it("guides only when asked: the link base's trajectory, brush and finder request stay what they were", () => {
    const a = engineOf({}, 5);
    const b = engineOf({ paintGuide: false }, 5);
    for (let k = 0; k < 10 * 60; k++) {
      a.update(1000 / 60, 0);
      b.update(1000 / 60, 0);
    }
    expect(b.getBalls().map((x) => [x.x, x.y])).toEqual(a.getBalls().map((x) => [x.x, x.y]));
    const ball = a.getBalls()[0];
    expect(a.getPaintPoints().every((p) => p.r === ball.radius)).toBe(true);
    expect("paintGuide" in modeSettingsOfSettings(defaultSettings("paint"))).toBe(false);
    // with the guide, the dabs reach past the ball
    const g = engineOf({ paintGuide: true }, 5);
    for (let k = 0; k < 60; k++) g.update(1000 / 60, 0);
    expect(g.getPaintPoints().every((p) => Math.abs(p.r - PAINT_GUIDE_BRUSH * g.getBalls()[0].radius) < 1e-9)).toBe(true);
  });

  it("is the page's start look and a setting a link carries only when on", () => {
    expect(clipStartSettings("paint")).toEqual({ ballRadius: 12, ballSpeed: 600, paintGuide: true });
    expect(defaultSettings("paint").paintGuide).toBe(false);
    expect(settingsToSearchParams(defaultSettings("paint")).has("pgu")).toBe(false);
    const link = settingsToSearchParams({ ...defaultSettings("paint"), paintGuide: true });
    expect(link.get("pgu")).toBe("1");
    expect(settingsFromSearchParams(link).paintGuide).toBe(true);
    expect(presetToSettings({ mode: "paint", paintGuide: "yes" } as never).paintGuide).toBe(false);
    expect(runNeverFinishes("paint", { paintPicture: false } as never)).toBe(false);
  });
});

describe("Paint: the progress and the full canvas drawn (paint-full)", () => {
  it("draws the progress round the ring, fills the last specks once the canvas is full and counts up to 100 %", { timeout: 60_000 }, () => {
    const e = engineOf(startLook(), 2);
    for (let k = 0; k < 40 * 60 && !e.isSimulationFinished(); k++) {
      e.update(1000 / 60, 0);
      e.consumeSoundEvents();
    }
    const pv = e.getPaintProgressView();
    const coverage = e.getPaintCoverage();
    // (D3 review) the counter reads 100 % from the frame the canvas is full, with its card (it counted up over 600 ms under the
    // card's 100 % before); until then the coverage
    expect(paintShownShare(coverage, pv)).toBe(1);
    expect(paintShownShare(coverage, { ...pv, done: false })).toBeCloseTo(coverage, 9);
    const o = { cx: 225, cy: 225, radius: e.getWallBaseRadii()[0], nowMs: pv.doneMs };
    const ctx = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    const g = e.getPaintGrid();
    drawPaintFull(ctx, g.grid, g.size, pv, o, e.getPaintPoints());
    // on the full canvas' own frame, one round dab a speck still unpainted in the grid (inside the circle), and no square cell
    let specks = 0;
    const c = g.size / 2;
    for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.grid[y * g.size + x] && (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= c * c) specks++;
    expect(specks).toBeGreaterThan(0);
    const dab = SPECK_DAB_CELLS * ((2 * o.radius) / g.size);
    expect(ctx.calls.filter((x) => x.name === "arc" && x.args[2] === dab)).toHaveLength(specks);
    expect(ctx.calls.filter((x) => x.name === "rect")).toHaveLength(0);
    const ring = fakeCanvas(450, 450).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    drawPaintProgressRing(ring, 0.5, pv, o);
    // the faint track, the arc's glow and its line, half way round, and the quarter ticks
    expect(ring.calls.filter((x) => x.name === "stroke").length).toBe(4);
    const arc = ring.calls.filter((x) => x.name === "arc")[1];
    expect([arc.args[3], arc.args[4]]).toEqual([-Math.PI / 2, -Math.PI / 2 + Math.PI]);
  });
});
